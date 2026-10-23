-- 0006 finance: fee schedule, per-apartment overrides, charges, payments, expenses, templates, budgets,
-- the ledger/balance/cash views, the admin collection summary, and the private receipts bucket.
-- Money amounts are numeric(12,2) and never negative, except an 'opening' charge (credit carried over).
-- Months are stored as a date on the first of the month. Balance sign: positive = the apartment owes.
-- Isolation: per-apartment rows (charges, payments, overrides) are readable by admins or by the approved
-- residents of that apartment. Views are security_invoker, so they inherit that RLS; the per-apartment
-- views also filter apartments explicitly (apartments themselves are readable by every approved user).

-- ---------------------------------------------------------------- tables
create table public.fee_schedule (
  id uuid primary key default gen_random_uuid(),
  building_id uuid not null default public.default_building_id() references public.buildings on delete cascade,
  amount numeric(12,2) not null check (amount >= 0),
  effective_from date not null check (extract(day from effective_from) = 1),
  created_at timestamptz not null default now(),
  unique (building_id, effective_from)
);

create table public.apartment_fee_overrides (
  id uuid primary key default gen_random_uuid(),
  building_id uuid not null default public.default_building_id() references public.buildings on delete cascade,
  apartment_id uuid not null references public.apartments on delete cascade,
  amount numeric(12,2) not null check (amount >= 0),
  effective_from date not null check (extract(day from effective_from) = 1),
  created_at timestamptz not null default now(),
  unique (apartment_id, effective_from)
);
create index apartment_fee_overrides_building_id_idx on public.apartment_fee_overrides (building_id);

-- Money history must not vanish with an apartment: charges and payments block deleting it.
create table public.charges (
  id uuid primary key default gen_random_uuid(),
  building_id uuid not null default public.default_building_id() references public.buildings on delete cascade,
  apartment_id uuid not null references public.apartments on delete restrict,
  month date not null check (extract(day from month) = 1),
  amount numeric(12,2) not null,
  kind text not null check (kind in ('levy', 'extra', 'opening')),
  label text not null default '',
  source text not null default 'manual' check (source in ('manual', 'import')),
  created_at timestamptz not null default now(),
  check (kind = 'opening' or amount >= 0)
);
create index charges_apartment_month_idx on public.charges (apartment_id, month);
create index charges_building_id_idx on public.charges (building_id);

create table public.payments (
  id uuid primary key default gen_random_uuid(),
  building_id uuid not null default public.default_building_id() references public.buildings on delete cascade,
  apartment_id uuid not null references public.apartments on delete restrict,
  paid_on date not null default (now() at time zone 'Asia/Jerusalem')::date,
  amount numeric(12,2) not null check (amount >= 0),
  method text not null check (method in ('cash', 'transfer', 'cheque', 'app', 'other')),
  note text not null default '',
  source text not null default 'manual' check (source in ('manual', 'import')),
  created_at timestamptz not null default now()
);
create index payments_apartment_paid_on_idx on public.payments (apartment_id, paid_on);
create index payments_building_paid_on_idx on public.payments (building_id, paid_on);

create table public.expense_categories (
  id uuid primary key default gen_random_uuid(),
  building_id uuid not null default public.default_building_id() references public.buildings on delete cascade,
  name text not null check (length(trim(name)) > 0),
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  unique (building_id, name)
);

create table public.expenses (
  id uuid primary key default gen_random_uuid(),
  building_id uuid not null default public.default_building_id() references public.buildings on delete cascade,
  category_id uuid not null references public.expense_categories on delete restrict,
  spent_on date not null default (now() at time zone 'Asia/Jerusalem')::date,
  amount numeric(12,2) not null check (amount >= 0),
  vendor text not null default '',
  note text not null default '',
  receipt_path text,
  source text not null default 'manual' check (source in ('manual', 'import', 'maintenance')),
  created_at timestamptz not null default now()
);
create index expenses_building_spent_on_idx on public.expenses (building_id, spent_on);
create index expenses_category_id_idx on public.expenses (category_id);

create table public.expense_templates (
  id uuid primary key default gen_random_uuid(),
  building_id uuid not null default public.default_building_id() references public.buildings on delete cascade,
  category_id uuid not null references public.expense_categories on delete cascade,
  amount numeric(12,2) not null check (amount >= 0),
  vendor text not null default '',
  label text not null check (length(trim(label)) > 0),
  created_at timestamptz not null default now()
);
create index expense_templates_building_id_idx on public.expense_templates (building_id);
create index expense_templates_category_id_idx on public.expense_templates (category_id);

create table public.budgets (
  id uuid primary key default gen_random_uuid(),
  building_id uuid not null default public.default_building_id() references public.buildings on delete cascade,
  year int not null check (year between 2000 and 2100),
  category_id uuid not null references public.expense_categories on delete cascade,
  amount numeric(12,2) not null check (amount >= 0),
  created_at timestamptz not null default now(),
  unique (year, category_id)
);
create index budgets_building_id_idx on public.budgets (building_id);
create index budgets_category_id_idx on public.budgets (category_id);

-- maintenance_log.expense_id (0005) becomes a real link; "today" means today in Israel.
alter table public.maintenance_log alter column done_on set default (now() at time zone 'Asia/Jerusalem')::date;
alter table public.maintenance_log
  add constraint maintenance_log_expense_id_fkey foreign key (expense_id) references public.expenses on delete set null;
create index maintenance_log_expense_id_idx on public.maintenance_log (expense_id);

-- ---------------------------------------------------------------- RLS
alter table public.fee_schedule enable row level security;
alter table public.apartment_fee_overrides enable row level security;
alter table public.charges enable row level security;
alter table public.payments enable row level security;
alter table public.expense_categories enable row level security;
alter table public.expenses enable row level security;
alter table public.expense_templates enable row level security;
alter table public.budgets enable row level security;

-- Per-apartment tables: admins, or approved residents of that apartment.
create policy apartment_fee_overrides_select on public.apartment_fee_overrides for select to authenticated
  using ((select public.is_admin())
    or ((select public.is_approved()) and apartment_id = (select public.my_apartment_id())));
create policy charges_select on public.charges for select to authenticated
  using ((select public.is_admin())
    or ((select public.is_approved()) and apartment_id = (select public.my_apartment_id())));
create policy payments_select on public.payments for select to authenticated
  using ((select public.is_admin())
    or ((select public.is_approved()) and apartment_id = (select public.my_apartment_id())));

-- Building-wide tables: every approved user reads.
create policy fee_schedule_select on public.fee_schedule
  for select to authenticated using ((select public.is_approved()));
create policy expense_categories_select on public.expense_categories
  for select to authenticated using ((select public.is_approved()));
create policy expenses_select on public.expenses
  for select to authenticated using ((select public.is_approved()));
create policy expense_templates_select on public.expense_templates
  for select to authenticated using ((select public.is_approved()));
create policy budgets_select on public.budgets
  for select to authenticated using ((select public.is_approved()));

-- Admin-only writes everywhere.
create policy fee_schedule_admin on public.fee_schedule for all to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));
create policy apartment_fee_overrides_admin on public.apartment_fee_overrides for all to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));
create policy charges_admin on public.charges for all to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));
create policy payments_admin on public.payments for all to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));
create policy expense_categories_admin on public.expense_categories for all to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));
create policy expenses_admin on public.expenses for all to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));
create policy expense_templates_admin on public.expense_templates for all to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));
create policy budgets_admin on public.budgets for all to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));

-- ---------------------------------------------------------------- views
-- The current billing month (first of the month, Israel time). Balances count nothing after it.
create function public.current_month() returns date
language sql stable security invoker set search_path = ''
as $$
  select date_trunc('month', now() at time zone 'Asia/Jerusalem')::date;
$$;
revoke execute on function public.current_month() from anon, public;
grant execute on function public.current_month() to authenticated;

-- True when the caller may see this apartment's money: admins, its approved residents, or server
-- roles (postgres / service_role, which bypass RLS anyway). Security invoker: evaluated as the caller.
-- API roles are exactly 'authenticated' and 'anon' (what PostgREST switches to); any other role is
-- treated as a trusted server session. building_cash_balance() uses the same rule. Pinned by pgTAP.
create function public.can_read_apartment_finance(p_apartment_id uuid) returns boolean
language sql stable security invoker set search_path = ''
as $$
  select current_user not in ('authenticated', 'anon') or public.is_admin()
    or (public.is_approved() and p_apartment_id = public.my_apartment_id());
$$;
revoke execute on function public.can_read_apartment_finance(uuid) from anon, public;
grant execute on function public.can_read_apartment_finance(uuid) to authenticated;

-- One fee per apartment per month, from billing_start through the current month (Israel time).
-- Amount: the latest override effective by that month, else the latest building fee, else 0.
create view public.monthly_fees with (security_invoker = true) as
select a.id as apartment_id, g.month,
  coalesce(o.amount, f.amount, 0)::numeric(12,2) as amount
from public.apartments a
join public.buildings b on b.id = a.building_id
cross join lateral (
  select s::date as month
  from generate_series(date_trunc('month', b.billing_start::timestamp),
    public.current_month()::timestamp, interval '1 month') s
) g
left join lateral (
  select x.amount from public.apartment_fee_overrides x
  where x.apartment_id = a.id and x.effective_from <= g.month
  order by x.effective_from desc limit 1
) o on true
left join lateral (
  select x.amount from public.fee_schedule x
  where x.building_id = a.building_id and x.effective_from <= g.month
  order by x.effective_from desc limit 1
) f on true
where b.billing_start is not null and public.can_read_apartment_finance(a.id);

-- Month-by-month charged vs paid, through the current month only: pre-entered future charges (and
-- post-dated payments) aren't owed/paid yet. Payments land in the month of paid_on.
create view public.apartment_ledger with (security_invoker = true) as
select t.apartment_id, t.month,
  sum(t.charged)::numeric(12,2) as charged, sum(t.paid)::numeric(12,2) as paid
from (
  select apartment_id, month, amount as charged, 0::numeric as paid from public.monthly_fees
  union all
  select apartment_id, month, amount, 0 from public.charges
  union all
  select apartment_id, date_trunc('month', paid_on::timestamp)::date, 0, amount from public.payments
) t
where t.month <= public.current_month()
group by t.apartment_id, t.month;

-- Running totals per apartment through the current month (every visible apartment, zeros when nothing
-- is recorded). scheduled_charges: charges entered for later months ("חיובים עתידיים"), not in balance.
create view public.apartment_balances with (security_invoker = true) as
select a.id as apartment_id,
  coalesce(sum(l.charged), 0)::numeric(12,2) as charged,
  coalesce(sum(l.paid), 0)::numeric(12,2) as paid,
  (coalesce(sum(l.charged), 0) - coalesce(sum(l.paid), 0))::numeric(12,2) as balance,
  coalesce((select sum(c.amount) from public.charges c
    where c.apartment_id = a.id and c.month > public.current_month()), 0)::numeric(12,2) as scheduled_charges
from public.apartments a
left join public.apartment_ledger l on l.apartment_id = a.id
where public.can_read_apartment_finance(a.id)
group by a.id;

-- Cash needs every payment, which residents can't read row by row, so the total is computed by a
-- definer function that only answers approved users. Opening cash is the balance at the start of
-- opening_cash_date: payments and expenses on or after that date count, up to today (Israel time) —
-- cash is money actually in the account, so a post-dated cheque counts only from its date. Server sessions (no API role
-- set, or service_role) also get an answer; current_setting('role') is the API role even inside a definer.
-- Only 'authenticated' and 'anon' count as API roles here (same rule as can_read_apartment_finance).
create function public.building_cash_balance(p_building_id uuid) returns numeric
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
    and (public.is_approved() or current_setting('role') not in ('authenticated', 'anon'));
$$;
revoke execute on function public.building_cash_balance(uuid) from anon, public;
grant execute on function public.building_cash_balance(uuid) to authenticated;

create view public.building_cash with (security_invoker = true) as
select b.id as building_id, public.building_cash_balance(b.id) as balance
from public.buildings b;

-- ---------------------------------------------------------------- collection summary (admin home)
-- As of the end of p_month: apartments, how many are paid up (balance <= 0), and the total owed.
create function public.collection_summary(p_month date)
returns table (apartments_total int, apartments_paid_up int, amount_due_total numeric)
language plpgsql stable security invoker set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'admin only' using errcode = '42501';
  end if;
  return query
  with bal as (
    select a.id, coalesce(sum(l.charged - l.paid), 0) as balance
    from public.apartments a
    left join public.apartment_ledger l
      on l.apartment_id = a.id and l.month <= date_trunc('month', p_month::timestamp)::date
    group by a.id
  )
  select count(*)::int, (count(*) filter (where bal.balance <= 0))::int,
    coalesce(sum(greatest(bal.balance, 0)), 0)::numeric(12,2)
  from bal;
end;
$$;
revoke execute on function public.collection_summary(date) from anon, public;
grant execute on function public.collection_summary(date) to authenticated;

-- ---------------------------------------------------------------- maintenance done + cost
-- Replaces the 0005 version (new signature, so drop first to avoid an ambiguous overload).
-- A cost > 0 posts an expense (spent_on = done date, vendor = task vendor, note = task title) and links it.
drop function public.mark_task_done(uuid, date, text);
create function public.mark_task_done(
  p_task_id uuid, p_done_on date, p_note text, p_cost numeric default null, p_category_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_task public.maintenance_tasks%rowtype;
  v_log uuid;
  v_expense uuid;
  v_latest date;
begin
  if not public.is_admin() then
    raise exception 'admin only' using errcode = '42501';
  end if;
  select * into v_task from public.maintenance_tasks where id = p_task_id for update;
  if not found then
    raise exception 'task not found' using errcode = 'P0002';
  end if;
  if p_cost > 0 then
    if p_category_id is null then
      raise exception 'an expense category is required with a cost' using errcode = '22023';
    end if;
    insert into public.expenses (building_id, category_id, spent_on, amount, vendor, note, source)
    values (v_task.building_id, p_category_id, p_done_on, p_cost, v_task.vendor, v_task.title, 'maintenance')
    returning id into v_expense;
  end if;
  insert into public.maintenance_log (task_id, building_id, done_on, note, cost, expense_id)
  values (p_task_id, v_task.building_id, p_done_on, coalesce(p_note, ''), p_cost, v_expense)
  returning id into v_log;
  select max(done_on) into v_latest from public.maintenance_log where task_id = p_task_id;
  update public.maintenance_tasks set next_due = (case v_task.frequency
      when 'monthly' then v_latest + interval '1 month'
      when 'quarterly' then v_latest + interval '3 months'
      when 'yearly' then v_latest + interval '1 year'
      else null end)::date
    where id = p_task_id;
  return v_log;
end;
$$;
revoke execute on function public.mark_task_done(uuid, date, text, numeric, uuid) from public, anon;
grant execute on function public.mark_task_done(uuid, date, text, numeric, uuid) to authenticated;

-- ---------------------------------------------------------------- receipts storage (admin only)
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('receipts', 'receipts', false, 10485760,
  array['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/heic', 'image/heif', 'application/pdf'])
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create policy receipts_storage_read on storage.objects
  for select to authenticated using (bucket_id = 'receipts' and public.is_admin());
create policy receipts_storage_upload on storage.objects
  for insert to authenticated with check (bucket_id = 'receipts' and public.is_admin());
create policy receipts_storage_update on storage.objects
  for update to authenticated
  using (bucket_id = 'receipts' and public.is_admin()) with check (bucket_id = 'receipts' and public.is_admin());
create policy receipts_storage_delete on storage.objects
  for delete to authenticated using (bucket_id = 'receipts' and public.is_admin());

-- ---------------------------------------------------------------- categories (spec §5.5, Excel order)
insert into public.expense_categories (name, sort_order)
select v.name, v.ord::int
from unnest(array[
  'חברת ניהול', 'ניקיון', 'חשמל', 'בנק', 'הדברה', 'נורות', 'תרבות דיור', 'ביטוחים', 'מעלית',
  'תיקון מעלית', 'מהנדס מעליות', 'משאבות ומז"חים', 'כיבוי אש', 'פחים', 'בזק', 'גינון', 'תיקוני חשמל', 'שונות'
]) with ordinality as v(name, ord);
