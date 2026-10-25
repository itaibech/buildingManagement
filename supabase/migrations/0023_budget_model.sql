-- Task 26: building cash for admins only, one collection-count rule, recurring yearly budgets and the yearly
-- budget summary (expected income from the fees vs actual income and expenses).

-- ---------------------------------------------------------------- building cash: admins only
-- Same as 0016, answering admins (and server sessions) only: residents with finance_reports no longer see the cash.
create or replace function public.building_cash_balance(p_building_id uuid) returns numeric
language sql stable security definer set search_path = ''
as $$
  select (b.opening_cash
    + coalesce((select sum(p.amount) from public.payments p where p.building_id = b.id
        and (b.opening_cash_date is null or p.paid_on >= b.opening_cash_date)
        and p.paid_on <= (now() at time zone 'Asia/Jerusalem')::date), 0)
    - coalesce((select sum(e.amount) from public.expenses e where e.building_id = b.id
        and (b.opening_cash_date is null or e.spent_on >= b.opening_cash_date)
        and e.spent_on <= (now() at time zone 'Asia/Jerusalem')::date), 0))::numeric(12,2)
  from public.buildings b
  where b.id = p_building_id
    and (public.is_admin() or current_setting('role') not in ('authenticated', 'anon'));
$$;

-- Same columns as 0006; rows only for admins (and server sessions).
create or replace view public.building_cash with (security_invoker = true) as
select b.id as building_id, public.building_cash_balance(b.id) as balance
from public.buildings b
where public.is_admin() or current_setting('role') not in ('authenticated', 'anon');

-- ---------------------------------------------------------------- collection: one rule
-- Same as 0022, with one counting rule shared with the balances list (collectionCounts in the app): an apartment
-- counts when its fee for the month is above 0 (so exempt and zero-fee apartments are out) and it isn't archived
-- before that month. "Paid up" = nothing owed as of the end of the month. The amount due still sums every apartment.
create or replace function public.collection_summary(p_month date)
returns table (apartments_total int, apartments_paid_up int, amount_due_total numeric)
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_admin constant boolean := public.is_admin();
  m constant date := case when v_admin then date_trunc('month', p_month::timestamp)::date else public.current_month() end;
  v_building constant uuid := (select p.building_id from public.profiles p where p.user_id = (select auth.uid()));
begin
  if not (v_admin or public.has_permission('finance_reports')) then
    raise exception 'not permitted' using errcode = '42501';
  end if;
  return query
  with bal as (
    select a.id, coalesce(sum(l.charged - l.paid), 0) as balance,
      coalesce((select f.amount from public.apartment_fee_at(a.id, m) f), 0) > 0 as paying
    from public.apartments a
    left join public.apartment_ledger l on l.apartment_id = a.id and l.month <= m
    where a.building_id = v_building
      and (a.archived_at is null or date_trunc('month', a.archived_at at time zone 'Asia/Jerusalem') >= m)
    group by a.id
  )
  select (count(*) filter (where bal.paying))::int,
    (count(*) filter (where bal.paying and bal.balance <= 0))::int,
    coalesce(sum(greatest(bal.balance, 0)), 0)::numeric(12,2)
  from bal;
end;
$$;

-- ---------------------------------------------------------------- recurring yearly budgets
-- A category's planned amount for a year: the explicit budgets row of that year ("לשנה זו בלבד") if any, else the
-- latest budget_defaults row with effective_from_year <= year ("לשנה זו ולשנים הבאות"), else none (0).
create table public.budget_defaults (
  id uuid primary key default gen_random_uuid(),
  building_id uuid not null default public.default_building_id() references public.buildings on delete cascade,
  category_id uuid not null references public.expense_categories on delete cascade,
  amount numeric(12,2) not null check (amount >= 0),
  effective_from_year int not null check (effective_from_year between 2000 and 2100),
  created_at timestamptz not null default now(),
  unique (category_id, effective_from_year)
);
create index budget_defaults_building_id_idx on public.budget_defaults (building_id);
alter table public.budget_defaults enable row level security;
-- Reads like budgets (finance_reports; admins have every permission). Writes go through set_budgets only.
revoke all on public.budget_defaults from anon, authenticated, public;
grant select on public.budget_defaults to authenticated;
create policy budget_defaults_select on public.budget_defaults for select to authenticated
  using ((select public.has_permission('finance_reports')));

-- Security invoker: the RLS of budgets, budget_defaults and expense_categories decides what the caller sees.
create function public.budget_for_year(p_year int)
returns table (category_id uuid, category text, sort_order int, amount numeric, source text)
language sql stable security invoker set search_path = ''
as $$
  select c.id, c.name, c.sort_order, coalesce(o.amount, d.amount)::numeric(12,2),
    case when o.amount is not null then 'one_off' else 'default' end
  from public.expense_categories c
  left join public.budgets o on o.category_id = c.id and o.year = p_year
  left join lateral (
    select x.amount from public.budget_defaults x
    where x.category_id = c.id and x.effective_from_year <= p_year
    order by x.effective_from_year desc limit 1
  ) d on true
  where o.amount is not null or d.amount is not null
  order by c.sort_order, c.name;
$$;
revoke execute on function public.budget_for_year(int) from anon, public;
grant execute on function public.budget_for_year(int) to authenticated;

-- Admin: writes budget lines for p_year. p_lines = [{category_id, amount}]. p_scope 'once' upserts the year's
-- explicit row; 'recurring' upserts the default from p_year on and removes that year's explicit row, so the default
-- applies. Later defaults and other years' one-offs are kept. Returns the number of lines written.
create function public.set_budgets(p_year int, p_scope text, p_lines jsonb) returns int
language plpgsql security definer set search_path = ''
as $$
declare
  v_building constant uuid := (select p.building_id from public.profiles p where p.user_id = (select auth.uid()));
  l record;
  n int := 0;
begin
  if not public.is_admin() then
    raise exception 'admin only' using errcode = '42501';
  end if;
  if p_year is null or p_year not between 2000 and 2100 or p_scope not in ('once', 'recurring')
    or jsonb_typeof(p_lines) is distinct from 'array' then
    raise exception 'bad year, scope or lines' using errcode = '22023';
  end if;
  for l in
    select c.id as category_id, (e ->> 'amount')::numeric as amount
    from jsonb_array_elements(p_lines) e
    left join public.expense_categories c on c.id = (e ->> 'category_id')::uuid and c.building_id = v_building
  loop
    if l.category_id is null or l.amount is null or l.amount < 0 then
      raise exception 'bad budget line' using errcode = '22023';
    end if;
    if p_scope = 'once' then
      insert into public.budgets (building_id, year, category_id, amount) values (v_building, p_year, l.category_id, l.amount)
      on conflict (year, category_id) do update set amount = excluded.amount;
    else
      insert into public.budget_defaults (building_id, category_id, amount, effective_from_year)
      values (v_building, l.category_id, l.amount, p_year)
      on conflict (category_id, effective_from_year) do update set amount = excluded.amount;
      delete from public.budgets b where b.year = p_year and b.category_id = l.category_id;
    end if;
    n := n + 1;
  end loop;
  return n;
end;
$$;
revoke execute on function public.set_budgets(int, text, jsonb) from anon, public;
grant execute on function public.set_budgets(int, text, jsonb) to authenticated;

-- ---------------------------------------------------------------- yearly budget summary
-- Aggregates only, for admins and finance_reports holders, in the caller's building:
--   expected_income: every apartment's fee for each month of the year (apartment_fee_at: the fee in force that month,
--     so months ahead use the current fee and mode, or a change already scheduled; exempt = 0; from billing_start;
--     archived apartments stop after their archive month) plus the year's levies and extras (EV charging excluded).
--   actual_income: payments received in the year up to today, without EV payments.
--   actual_expenses: the year's expenses.
--   projected_expenses: each expense template for every month from the current one to December not yet posted.
--   expected_balance = expected_income - actual_expenses - projected_expenses.
create function public.budget_summary(p_year int)
returns table (expected_income numeric, actual_income numeric, actual_expenses numeric, projected_expenses numeric, expected_balance numeric)
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_building constant uuid := (select p.building_id from public.profiles p where p.user_id = (select auth.uid()));
  v_today constant date := (now() at time zone 'Asia/Jerusalem')::date;
  y0 date;
  y1 date;
  v_fees numeric;
  v_charges numeric;
  v_income numeric;
  v_spent numeric;
  v_projected numeric;
begin
  if not (public.is_admin() or public.has_permission('finance_reports')) then
    raise exception 'not permitted' using errcode = '42501';
  end if;
  if p_year is null or p_year not between 2000 and 2100 then
    raise exception 'year must be between 2000 and 2100' using errcode = '22023';
  end if;
  y0 := make_date(p_year, 1, 1);
  y1 := make_date(p_year + 1, 1, 1);
  select coalesce(sum(f.amount), 0) into v_fees
  from public.apartments a
  join public.buildings b on b.id = a.building_id
  cross join lateral generate_series(y0::timestamp, (y1 - 1)::timestamp, interval '1 month') g(m)
  cross join lateral public.apartment_fee_at(a.id, g.m::date) f
  where a.building_id = v_building and b.billing_start is not null
    and g.m >= date_trunc('month', b.billing_start::timestamp)
    and (a.archived_at is null or g.m <= date_trunc('month', a.archived_at at time zone 'Asia/Jerusalem'));
  select coalesce(sum(c.amount), 0) into v_charges
  from public.charges c
  where c.building_id = v_building and c.month >= y0 and c.month < y1 and c.kind in ('levy', 'extra')
    and c.ev_reading_id is null and not (c.kind = 'extra' and c.label = 'טעינת רכב חשמלי');
  select coalesce(sum(p.amount), 0) into v_income
  from public.payments p
  where p.building_id = v_building and p.paid_on >= y0 and p.paid_on < y1 and p.paid_on <= v_today
    and p.source <> 'ev-import' and coalesce(p.note, '') not like 'טעינת רכב חשמלי%';
  select coalesce(sum(e.amount), 0) into v_spent
  from public.expenses e where e.building_id = v_building and e.spent_on >= y0 and e.spent_on < y1;
  select coalesce(sum(t.amount), 0) into v_projected
  from public.expense_templates t
  cross join lateral generate_series(greatest(y0, public.current_month())::timestamp, (y1 - 1)::timestamp, interval '1 month') g(m)
  where t.building_id = v_building
    and not exists (select 1 from public.expenses e where e.template_id = t.id and e.spent_on = g.m::date);
  return query select (v_fees + v_charges)::numeric(12,2), v_income::numeric(12,2), v_spent::numeric(12,2),
    v_projected::numeric(12,2), (v_fees + v_charges - v_spent - v_projected)::numeric(12,2);
end;
$$;
revoke execute on function public.budget_summary(int) from anon, public;
grant execute on function public.budget_summary(int) to authenticated;
