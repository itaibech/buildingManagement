-- 0017 debt settlement and special charges (Task 19): "הסדרת חוב" and "חיוב מיוחד" from the apartment ledger
-- sheet, atomically and admin-only. Special charges are at the end of the file.
--   * charges.kind gains 'adjustment': a write-off ("מחיקת חוב"). Always negative, always with a reason (note).
--     No money moves, so building cash and the expense reports are untouched; only the apartment's balance drops.
--   * payments.for_month: the month a settlement payment settles (null = the month of paid_on, as before). The
--     ledger lands a payment in that month, so "רשום בתאריך היום" still shows each settled month as paid, while
--     cash keeps using paid_on (money counts in the account from the day it arrived).
--   * settlement_id on charges and payments groups the rows one settle_debt call wrote; undo_settlement deletes them.
--   * A month's open amount: charged - paid in that month (apartment_ledger), allocated oldest first and capped by
--     the apartment's balance, so credit from overpaid months is used up first and the balance never goes negative.
--     settlement_plan() computes it on the server; src/features/finance/settlement.ts mirrors it for the dialog.
-- Reads stay under the existing RLS: charges/payments select = can_read_apartment_finance (admins, or a resident
-- with finance_own for their own apartment). Writes go through the definer RPCs (or the existing admin policies).

-- ---------------------------------------------------------------- columns and checks
alter table public.charges drop constraint charges_kind_check;
alter table public.charges add constraint charges_kind_check
  check (kind in ('levy', 'extra', 'opening', 'adjustment'));
-- 0006's unnamed "kind = 'opening' or amount >= 0"; adjustments may be negative too (and only negative).
alter table public.charges drop constraint charges_check;
alter table public.charges add constraint charges_amount_sign_check
  check (kind in ('opening', 'adjustment') or amount >= 0);
alter table public.charges add constraint charges_adjustment_negative_check
  check (kind <> 'adjustment' or amount < 0);

alter table public.charges add column note text not null default '';
alter table public.charges add constraint charges_adjustment_note_check
  check (kind <> 'adjustment' or length(trim(note)) > 0);
alter table public.charges add column settlement_id uuid;
create index charges_settlement_id_idx on public.charges (settlement_id) where settlement_id is not null;

alter table public.payments add column for_month date check (extract(day from for_month) = 1);
alter table public.payments add column settlement_id uuid;
create index payments_settlement_id_idx on public.payments (settlement_id) where settlement_id is not null;

-- ---------------------------------------------------------------- ledger (same columns, one appended)
-- adjusted: the month's write-offs (<= 0), already inside charged. The sheet shows charged - adjusted as the
-- month's charge and marks the write-off. Payments land in for_month when set (settlements), else paid_on's month.
create or replace view public.apartment_ledger with (security_invoker = true) as
select t.apartment_id, t.month,
  sum(t.charged)::numeric(12,2) as charged, sum(t.paid)::numeric(12,2) as paid,
  sum(t.adjusted)::numeric(12,2) as adjusted
from (
  select apartment_id, month, amount as charged, 0::numeric as paid, 0::numeric as adjusted from public.monthly_fees
  union all
  select apartment_id, month, amount, 0, case when kind = 'adjustment' then amount else 0 end from public.charges
  union all
  select apartment_id, coalesce(for_month, date_trunc('month', paid_on::timestamp)::date), 0, amount, 0
  from public.payments
) t
where t.month <= public.current_month()
group by t.apartment_id, t.month;

-- ---------------------------------------------------------------- the plan
-- What settling p_months would write: every month with charged > paid, oldest first, each taking its open amount
-- until the balance is used up; then only the chosen months are returned. Invoker (reads the ledger under the
-- caller's RLS); only settle_debt (definer) calls it, so API roles get no execute.
create function public.settlement_plan(p_apartment_id uuid, p_months date[])
returns table (month date, amount numeric)
language plpgsql stable security invoker set search_path = ''
as $$
declare
  v_remaining numeric := coalesce((select sum(l.charged - l.paid) from public.apartment_ledger l
    where l.apartment_id = p_apartment_id), 0);
  v_take numeric;
  r record;
begin
  for r in select l.month as m, l.charged - l.paid as open from public.apartment_ledger l
    where l.apartment_id = p_apartment_id and l.charged - l.paid > 0 order by l.month
  loop
    exit when v_remaining <= 0;
    v_take := least(r.open, v_remaining);
    v_remaining := v_remaining - v_take;
    if r.m = any (select date_trunc('month', x::timestamp)::date from unnest(p_months) x) then
      month := r.m;
      amount := v_take::numeric(12,2);
      return next;
    end if;
  end loop;
end;
$$;
revoke execute on function public.settlement_plan(uuid, date[]) from anon, public, authenticated;

-- ---------------------------------------------------------------- settle_debt (admin)
-- p_mode 'pay': one manual payment per month (method p_method, note p_note), paid_on = the month's first day
--   (p_date_mode 'debt_month') or today in Israel ('today'); for_month = the month either way.
-- p_mode 'write_off': one 'adjustment' charge per month, minus the open amount, label "מחיקת חוב", reason p_note.
-- Amounts come from settlement_plan, never from the client. Months with nothing open are skipped, so a repeated
-- call writes nothing. Serialised per apartment. Returns {settlement_id, months, total, balance}.
create function public.settle_debt(p_apartment_id uuid, p_months date[], p_mode text, p_method text default null,
  p_date_mode text default 'debt_month', p_note text default '')
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_building uuid;
  v_id uuid := gen_random_uuid();
  v_note text := coalesce(trim(p_note), '');
  v_today date := (now() at time zone 'Asia/Jerusalem')::date;
  v_count int;
  v_total numeric;
begin
  if not public.is_admin() then
    raise exception 'admin only' using errcode = '42501';
  end if;
  if p_mode is null or p_mode not in ('pay', 'write_off') then
    raise exception 'mode must be pay or write_off' using errcode = '22023';
  end if;
  if p_mode = 'pay' and (p_method is null or p_method not in ('cash', 'transfer', 'cheque', 'app', 'standing_order', 'other')) then
    raise exception 'unknown payment method' using errcode = '22023';
  end if;
  if p_mode = 'pay' and (p_date_mode is null or p_date_mode not in ('debt_month', 'today')) then
    raise exception 'date mode must be debt_month or today' using errcode = '22023';
  end if;
  if p_mode = 'write_off' and v_note = '' then
    raise exception 'a write-off needs a reason' using errcode = '22023';
  end if;
  select a.building_id into v_building from public.apartments a
  where a.id = p_apartment_id
    and a.building_id = (select p.building_id from public.profiles p where p.user_id = (select auth.uid()));
  if v_building is null then
    raise exception 'apartment not found' using errcode = 'P0002';
  end if;
  perform pg_advisory_xact_lock(hashtext('public.settle:' || p_apartment_id::text));

  if p_mode = 'pay' then
    with ins as (
      insert into public.payments (building_id, apartment_id, paid_on, for_month, amount, method, note, source, settlement_id)
      select v_building, p_apartment_id, case when p_date_mode = 'today' then v_today else s.month end, s.month,
        s.amount, p_method, v_note, 'manual', v_id
      from public.settlement_plan(p_apartment_id, p_months) s
      returning amount
    ) select count(*), coalesce(sum(amount), 0) into v_count, v_total from ins;
  else
    with ins as (
      insert into public.charges (building_id, apartment_id, month, amount, kind, label, source, note, settlement_id)
      select v_building, p_apartment_id, s.month, -s.amount, 'adjustment', 'מחיקת חוב', 'manual', v_note, v_id
      from public.settlement_plan(p_apartment_id, p_months) s
      returning amount
    ) select count(*), coalesce(-sum(amount), 0) into v_count, v_total from ins;
  end if;

  return jsonb_build_object(
    'settlement_id', case when v_count > 0 then v_id end,
    'months', v_count,
    'total', v_total::numeric(12,2),
    'balance', (select coalesce(sum(l.charged - l.paid), 0)::numeric(12,2) from public.apartment_ledger l
      where l.apartment_id = p_apartment_id));
end;
$$;
revoke execute on function public.settle_debt(uuid, date[], text, text, text, text) from anon, public;
grant execute on function public.settle_debt(uuid, date[], text, text, text, text) to authenticated;

-- ---------------------------------------------------------------- undo_settlement (admin)
-- Deletes every row one settlement wrote (its write-offs or its payments). Returns {charges, payments}.
create function public.undo_settlement(p_settlement_id uuid)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_building uuid := (select p.building_id from public.profiles p where p.user_id = (select auth.uid()));
  v_charges int;
  v_payments int;
begin
  if not public.is_admin() then
    raise exception 'admin only' using errcode = '42501';
  end if;
  delete from public.charges where settlement_id = p_settlement_id and building_id = v_building;
  get diagnostics v_charges = row_count;
  delete from public.payments where settlement_id = p_settlement_id and building_id = v_building;
  get diagnostics v_payments = row_count;
  return jsonb_build_object('charges', v_charges, 'payments', v_payments);
end;
$$;
revoke execute on function public.undo_settlement(uuid) from anon, public;
grant execute on function public.undo_settlement(uuid) to authenticated;

-- ---------------------------------------------------------------- special charges ("חיוב מיוחד")
-- A one-off charge on one apartment (e.g. "תיקון נזק בלובי"), optionally with the payment that already came in
-- (same month, so the item nets to 0) and optionally mirrored as a building expense (the building paid for it).
-- special_id links the rows one add_special_charge call wrote; is_special marks them (charges stay kind 'extra',
-- so EV and other extras keep their meaning). undo_special_charge deletes every linked row.
alter table public.charges add column special_id uuid;
alter table public.charges add column is_special boolean generated always as (special_id is not null) stored;
create index charges_special_id_idx on public.charges (special_id) where special_id is not null;
alter table public.payments add column special_id uuid;
alter table public.payments add column is_special boolean generated always as (special_id is not null) stored;
create index payments_special_id_idx on public.payments (special_id) where special_id is not null;
alter table public.expenses add column special_id uuid;
create index expenses_special_id_idx on public.expenses (special_id) where special_id is not null;

-- p_month: any month up to the current one (a later month would only be a scheduled charge). p_paid: also record
-- the payment (p_method; paid_on = the month's first day, or today with p_date_mode 'today'; for_month = p_month).
-- p_expense: also record a building expense (p_category_id, default the building's "שונות") on the same date.
-- Returns {special_id, charge_id, payment_id, expense_id}.
create function public.add_special_charge(p_apartment_id uuid, p_month date, p_amount numeric, p_label text,
  p_note text default '', p_paid boolean default false, p_method text default null, p_expense boolean default false,
  p_category_id uuid default null, p_date_mode text default 'debt_month')
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_building uuid;
  v_id uuid := gen_random_uuid();
  v_month date := date_trunc('month', p_month::timestamp)::date;
  v_label text := coalesce(trim(p_label), '');
  v_date date;
  v_category uuid;
  v_charge uuid;
  v_payment uuid;
  v_expense uuid;
begin
  if not public.is_admin() then
    raise exception 'admin only' using errcode = '42501';
  end if;
  if v_label = '' then
    raise exception 'a special charge needs a description' using errcode = '22023';
  end if;
  if p_amount is null or p_amount <= 0 or p_amount > 1000000 then
    raise exception 'amount must be between 0 and 1,000,000' using errcode = '22023';
  end if;
  if v_month is null or v_month > public.current_month() then
    raise exception 'the month must not be in the future' using errcode = '22023';
  end if;
  if p_date_mode is null or p_date_mode not in ('debt_month', 'today') then
    raise exception 'date mode must be debt_month or today' using errcode = '22023';
  end if;
  if coalesce(p_paid, false) and (p_method is null or p_method not in ('cash', 'transfer', 'cheque', 'app', 'standing_order', 'other')) then
    raise exception 'unknown payment method' using errcode = '22023';
  end if;
  select a.building_id into v_building from public.apartments a
  where a.id = p_apartment_id
    and a.building_id = (select p.building_id from public.profiles p where p.user_id = (select auth.uid()));
  if v_building is null then
    raise exception 'apartment not found' using errcode = 'P0002';
  end if;
  if coalesce(p_expense, false) then
    v_category := (select c.id from public.expense_categories c where c.building_id = v_building
      and (c.id = p_category_id or (p_category_id is null and c.name = 'שונות')) limit 1);
    if v_category is null then
      raise exception 'unknown expense category' using errcode = '22023';
    end if;
  end if;
  v_date := case when p_date_mode = 'today' then (now() at time zone 'Asia/Jerusalem')::date else v_month end;

  insert into public.charges (building_id, apartment_id, month, amount, kind, label, note, source, special_id)
  values (v_building, p_apartment_id, v_month, round(p_amount, 2), 'extra', v_label, coalesce(trim(p_note), ''), 'manual', v_id)
  returning id into v_charge;
  if coalesce(p_paid, false) then
    insert into public.payments (building_id, apartment_id, paid_on, for_month, amount, method, note, source, special_id)
    values (v_building, p_apartment_id, v_date, v_month, round(p_amount, 2), p_method, v_label, 'manual', v_id)
    returning id into v_payment;
  end if;
  if coalesce(p_expense, false) then
    insert into public.expenses (building_id, category_id, spent_on, amount, note, source, special_id)
    values (v_building, v_category, v_date, round(p_amount, 2), v_label, 'manual', v_id)
    returning id into v_expense;
  end if;
  return jsonb_build_object('special_id', v_id, 'charge_id', v_charge, 'payment_id', v_payment, 'expense_id', v_expense);
end;
$$;
revoke execute on function public.add_special_charge(uuid, date, numeric, text, text, boolean, text, boolean, uuid, text) from anon, public;
grant execute on function public.add_special_charge(uuid, date, numeric, text, text, boolean, text, boolean, uuid, text) to authenticated;

-- "ביטול חיוב מיוחד": deletes the charge and its linked payment and expense. Returns {charges, payments, expenses}.
create function public.undo_special_charge(p_special_id uuid)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_building uuid := (select p.building_id from public.profiles p where p.user_id = (select auth.uid()));
  v_charges int;
  v_payments int;
  v_expenses int;
begin
  if not public.is_admin() then
    raise exception 'admin only' using errcode = '42501';
  end if;
  delete from public.charges where special_id = p_special_id and building_id = v_building;
  get diagnostics v_charges = row_count;
  delete from public.payments where special_id = p_special_id and building_id = v_building;
  get diagnostics v_payments = row_count;
  delete from public.expenses where special_id = p_special_id and building_id = v_building;
  get diagnostics v_expenses = row_count;
  return jsonb_build_object('charges', v_charges, 'payments', v_payments, 'expenses', v_expenses);
end;
$$;
revoke execute on function public.undo_special_charge(uuid) from anon, public;
grant execute on function public.undo_special_charge(uuid) to authenticated;
