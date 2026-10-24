-- 0014 apartment form (Task 16): the committee flag, the payment method with standing orders, and one atomic
-- save_apartment() RPC behind the add / edit apartment form.
--   * apartments.is_committee: a committee representative ("נציג ועד") doesn't pay the monthly fee. A public role
--     label (like the apartment number), so it lives on apartments. The exemption itself lives in the fee timeline
--     (0010); save_apartment sets the flag and the exempt row together.
--   * apartment_billing (1:1, finance-private): payment_method 'standing_order' ("הוראת קבע") means the monthly fee
--     is collected automatically, so the system records one payment (source 'auto') per month from
--     standing_order_from through the current month, equal to that month's fee (none when it is 0, e.g. exempt).
--     Levies, extras and EV charges are still owed. No row = 'manual'.
--   * apply_standing_orders() keeps those rows in step. It runs from save_apartment, after any write to the fee
--     timeline or the building fee schedule (statement triggers below), and daily via pg_cron.
--   * apartment_fee_overrides.restore_mode / restore_amount: when an exempt row replaces a row of the same month,
--     what that row said, so ending the exemption can restore it.

-- ---------------------------------------------------------------- apartments: committee flag (public)
alter table public.apartments add column is_committee boolean not null default false;

-- ---------------------------------------------------------------- apartment_billing (finance-private)
-- Readable like the apartment's money (admins, its approved residents); written only by save_apartment.
create table public.apartment_billing (
  apartment_id uuid primary key references public.apartments on delete cascade,
  building_id uuid not null default public.default_building_id() references public.buildings on delete cascade,
  payment_method text not null default 'manual' check (payment_method in ('manual', 'standing_order')),
  standing_order_from date check (extract(day from standing_order_from) = 1),
  created_at timestamptz not null default now(),
  constraint apartment_billing_standing_order_from check ((payment_method = 'standing_order') = (standing_order_from is not null))
);
create index apartment_billing_building_id_idx on public.apartment_billing (building_id);
alter table public.apartment_billing enable row level security;
create policy apartment_billing_select on public.apartment_billing for select to authenticated
  using (public.can_read_apartment_finance(apartment_id));

-- ---------------------------------------------------------------- payments
alter table public.payments drop constraint payments_method_check;
alter table public.payments add constraint payments_method_check
  check (method in ('cash', 'transfer', 'cheque', 'app', 'other', 'standing_order'));
alter table public.payments drop constraint payments_source_check;
alter table public.payments add constraint payments_source_check
  check (source in ('manual', 'import', 'ev-import', 'auto'));
-- One automatic payment per apartment-month; apply_standing_orders upserts on it, so it is idempotent.
create unique index payments_auto_month_key on public.payments (apartment_id, paid_on) where source = 'auto';

-- ---------------------------------------------------------------- building fee helper
-- The building fee in force in p_month (latest fee_schedule row by then), else 0. Security invoker, like the views.
create function public.building_fee_at(p_building_id uuid, p_month date) returns numeric
language sql stable security invoker set search_path = ''
as $$
  select coalesce((select f.amount from public.fee_schedule f
    where f.building_id = p_building_id and f.effective_from <= p_month
    order by f.effective_from desc limit 1), 0)::numeric(12,2);
$$;
revoke execute on function public.building_fee_at(uuid, date) from anon, public;
grant execute on function public.building_fee_at(uuid, date) to authenticated;

-- Same as 0010, with the building fee from building_fee_at.
create or replace function public.apartment_fee_at(p_apartment_id uuid, p_month date)
returns table (fee_mode text, amount numeric)
language sql stable security invoker set search_path = ''
as $$
  select coalesce(o.mode, 'building'),
    (case coalesce(o.mode, 'building')
      when 'custom' then o.amount
      when 'exempt' then 0
      else (select public.building_fee_at(a.building_id, p_month) from public.apartments a where a.id = p_apartment_id)
    end)::numeric(12,2)
  from (select 1) one
  left join lateral (
    select x.mode, x.amount from public.apartment_fee_overrides x
    where x.apartment_id = p_apartment_id and x.effective_from <= p_month
    order by x.effective_from desc limit 1
  ) o on true;
$$;

-- ---------------------------------------------------------------- exempt rows remember what they replaced
alter table public.apartment_fee_overrides
  add column restore_mode text check (restore_mode in ('building', 'custom')),
  add column restore_amount numeric(12,2) check (restore_amount >= 0);
-- Null-safe on purpose: every branch is true or false, so a CHECK can't pass on NULL.
alter table public.apartment_fee_overrides
  add constraint apartment_fee_overrides_restore check (
    (restore_mode is null or mode = 'exempt')
    and ((restore_mode is null and restore_amount is null)
      or (restore_mode is not distinct from 'custom' and restore_amount is not null)
      or (restore_mode is not distinct from 'building' and restore_amount is null)));

-- Same as 0010, except: an exempt row written over a non-exempt row of the same month keeps that row's mode and
-- amount in restore_mode / restore_amount ("ביטול פטור" restores them). Any other write clears them.
create or replace function public.set_apartment_fee(p_apartment_id uuid, p_effective_from date, p_mode text, p_amount numeric default null)
returns boolean
language plpgsql security definer set search_path = ''
as $$
declare
  v_amount numeric := round(p_amount, 2);
  v_prev record;
  v_cur record;
begin
  if not public.is_admin() then
    raise exception 'admin only' using errcode = '42501';
  end if;
  if p_effective_from is null or extract(day from p_effective_from) <> 1 then
    raise exception 'effective_from must be the first of a month' using errcode = '22023';
  end if;
  if p_mode is null or p_mode not in ('building', 'custom', 'exempt') then
    raise exception 'mode must be building, custom or exempt' using errcode = '22023';
  end if;
  if (p_mode = 'custom') <> (p_amount is not null) then
    raise exception 'an amount is required for custom and not allowed otherwise' using errcode = '22023';
  end if;
  if v_amount < 0 then
    raise exception 'amount must not be negative' using errcode = '22023';
  end if;
  -- Serialises edits of one apartment's timeline.
  perform 1 from public.apartments where id = p_apartment_id for update;
  if not found then
    raise exception 'apartment not found' using errcode = 'P0002';
  end if;
  select x.mode, x.amount into v_cur from public.apartment_fee_overrides x
    where x.apartment_id = p_apartment_id and x.effective_from = p_effective_from;
  if found and v_cur.mode = p_mode and v_cur.amount is not distinct from v_amount then
    return false;
  end if;
  select x.mode, x.amount into v_prev from public.apartment_fee_overrides x
    where x.apartment_id = p_apartment_id and x.effective_from < p_effective_from
    order by x.effective_from desc limit 1;
  if coalesce(v_prev.mode, 'building') = p_mode and v_prev.amount is not distinct from v_amount then
    delete from public.apartment_fee_overrides where apartment_id = p_apartment_id and effective_from = p_effective_from;
    return found;
  end if;
  insert into public.apartment_fee_overrides (building_id, apartment_id, effective_from, mode, amount, source, restore_mode, restore_amount)
  select a.building_id, a.id, p_effective_from, p_mode, v_amount, 'manual',
    case when p_mode = 'exempt' and v_cur.mode <> 'exempt' then v_cur.mode end,
    case when p_mode = 'exempt' and v_cur.mode = 'custom' then v_cur.amount end
  from public.apartments a where a.id = p_apartment_id
  on conflict (apartment_id, effective_from) do update set mode = excluded.mode, amount = excluded.amount, source = 'manual',
    restore_mode = excluded.restore_mode, restore_amount = excluded.restore_amount;
  return true;
end;
$$;

-- ---------------------------------------------------------------- apply_standing_orders
-- The auto payments that should exist: standing-order months (from standing_order_from) with a fee above 0.
-- Internal (no API role executes it); monthly_fees reads as the definer caller, so every apartment counts.
create function public.standing_order_due(p_apartment_id uuid)
returns table (apartment_id uuid, building_id uuid, month date, amount numeric)
language sql stable set search_path = ''
as $$
  select b.apartment_id, b.building_id, f.month, f.amount
  from public.apartment_billing b
  join public.monthly_fees f on f.apartment_id = b.apartment_id
  where b.payment_method = 'standing_order' and f.month >= b.standing_order_from and f.amount > 0
    and (p_apartment_id is null or b.apartment_id = p_apartment_id);
$$;
revoke execute on function public.standing_order_due(uuid) from public, anon, authenticated;

-- For every standing-order apartment (or just p_apartment_id): months from standing_order_from through the current
-- month get one auto payment equal to that month's fee (amounts re-synced when the fee changed); a month whose fee
-- is 0 (exempt) or that no longer bills gets none. Auto rows after the current month are removed for every
-- apartment in scope (a switch back to manual stops future months); earlier rows stay: they were really collected,
-- so an apartment that left the standing order keeps them as they were. Returns how many rows changed.
-- API callers must be admins; server sessions (pg_cron, migrations, seed) may run it. Same role rule as 0006.
create function public.apply_standing_orders(p_apartment_id uuid default null) returns int
language plpgsql security definer set search_path = ''
as $$
declare
  cm constant date := public.current_month();
  n int := 0;
  k int;
begin
  if current_setting('role') in ('authenticated', 'anon') and not public.is_admin() then
    raise exception 'admin only' using errcode = '42501';
  end if;
  with due as materialized (select * from public.standing_order_due(p_apartment_id))
  delete from public.payments p
  using public.apartments a left join public.apartment_billing b on b.apartment_id = a.id
  where p.source = 'auto' and a.id = p.apartment_id and (p_apartment_id is null or a.id = p_apartment_id)
    and (p.paid_on > cm
      or (b.payment_method = 'standing_order' and p.paid_on >= b.standing_order_from
        and not exists (select 1 from due d where d.apartment_id = p.apartment_id and d.month = p.paid_on)));
  get diagnostics k = row_count;
  n := n + k;

  insert into public.payments (building_id, apartment_id, paid_on, amount, method, note, source)
  select d.building_id, d.apartment_id, d.month, d.amount, 'standing_order', 'הוראת קבע', 'auto'
  from public.standing_order_due(p_apartment_id) d
  on conflict (apartment_id, paid_on) where source = 'auto'
    do update set amount = excluded.amount where payments.amount is distinct from excluded.amount;
  get diagnostics k = row_count;
  return n + k;
end;
$$;
revoke execute on function public.apply_standing_orders(uuid) from public, anon;
grant execute on function public.apply_standing_orders(uuid) to authenticated;

-- Any write to the building fee schedule or an apartment's fee timeline (set_apartment_fee, a deleted timeline row,
-- the Excel import) re-syncs the standing orders in the same transaction.
create function public.standing_orders_resync() returns trigger
language plpgsql set search_path = ''
as $$
begin
  perform public.apply_standing_orders();
  return null;
end;
$$;
revoke execute on function public.standing_orders_resync() from public, anon, authenticated;
create trigger fee_schedule_standing_orders after insert or update or delete on public.fee_schedule
  for each statement execute function public.standing_orders_resync();
create trigger apartment_fee_overrides_standing_orders after insert or update or delete on public.apartment_fee_overrides
  for each statement execute function public.standing_orders_resync();

-- ---------------------------------------------------------------- save_apartment (admin)
-- Rejects bad input with 22023 (the duplicate number keeps the table's 23505). Internal: no API role executes it.
create function public.save_apartment_validate(p_number int, p_fee numeric, p_payment_method text,
  p_standing_order_from date, p_ev_initial numeric) returns void
language plpgsql immutable set search_path = ''
as $$
begin
  if p_number is null or p_number <= 0 or p_number > 9999 then
    raise exception 'apartment number must be between 1 and 9999' using errcode = '22023';
  end if;
  if p_fee < 0 or p_fee > 1000000 then
    raise exception 'fee must be between 0 and 1,000,000' using errcode = '22023';
  end if;
  if p_payment_method is null or p_payment_method not in ('manual', 'standing_order') then
    raise exception 'payment method must be manual or standing_order' using errcode = '22023';
  end if;
  if extract(day from p_standing_order_from) <> 1 then
    raise exception 'standing order month must be the first of a month' using errcode = '22023';
  end if;
  if p_ev_initial < 0 or p_ev_initial > 1000000000 then
    raise exception 'initial reading must be between 0 and 1,000,000,000' using errcode = '22023';
  end if;
end;
$$;
revoke execute on function public.save_apartment_validate(int, numeric, text, date, numeric) from public, anon, authenticated;

-- The fee part of the form, from p_month on: committee = exempt; otherwise an empty fee or the building rate =
-- building, any other amount = custom. An exemption that isn't the committee's (imported, or set in the fee
-- timeline) is kept while the fee field is left empty. Writes only when the result differs from what applies;
-- returns whether the timeline changed (its trigger has then already re-synced the standing orders).
create function public.save_apartment_fee(p_id uuid, p_month date, p_fee numeric, p_committee boolean, p_was_committee boolean)
returns boolean
language plpgsql set search_path = ''
as $$
declare
  cur record;
  v_mode text := 'building';
  v_amount numeric;
begin
  select f.fee_mode, f.amount into cur from public.apartment_fee_at(p_id, p_month) f;
  if p_committee then
    v_mode := 'exempt';
  elsif cur.fee_mode = 'exempt' and not p_was_committee and p_fee is null then
    return false;
  elsif p_fee is not null and round(p_fee, 2) <> (select public.building_fee_at(a.building_id, p_month)
      from public.apartments a where a.id = p_id) then
    v_mode := 'custom';
    v_amount := round(p_fee, 2);
  end if;
  if cur.fee_mode = v_mode and (v_mode <> 'custom' or cur.amount = v_amount) then
    return false;
  end if;
  return public.set_apartment_fee(p_id, p_month, v_mode, v_amount);
end;
$$;
revoke execute on function public.save_apartment_fee(uuid, date, numeric, boolean, boolean) from public, anon, authenticated;

-- One transaction: upsert the apartment, the committee flag, the payment method (apartment_billing), its fee from
-- the current month with the exemption, the EV charger (created when asked; an existing one is never removed here),
-- then the standing orders, once: a fee change already re-synced them through the timeline trigger.
-- Every parameter defaults to null so the client can omit p_id (new) and the optional ones.
create function public.save_apartment(p_id uuid default null, p_number int default null, p_floor int default null,
  p_notes text default null, p_fee numeric default null, p_is_committee boolean default false,
  p_payment_method text default 'manual', p_standing_order_from date default null, p_ev boolean default false,
  p_ev_initial numeric default 0)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  cm constant date := public.current_month();
  v_id uuid := p_id;
  v_was_committee boolean := false;
  v_from date := case when p_payment_method = 'standing_order' then coalesce(p_standing_order_from, cm) end;
begin
  if not public.is_admin() then
    raise exception 'admin only' using errcode = '42501';
  end if;
  perform public.save_apartment_validate(p_number, p_fee, p_payment_method, v_from, p_ev_initial);
  if v_id is null then
    insert into public.apartments (building_id, number, floor, notes)
    values (public.default_building_id(), p_number, p_floor, nullif(trim(p_notes), '')) returning id into v_id;
  else
    select a.is_committee into v_was_committee from public.apartments a where a.id = v_id for update;
    if not found then
      raise exception 'apartment not found' using errcode = 'P0002';
    end if;
  end if;
  update public.apartments set number = p_number, floor = p_floor, notes = nullif(trim(p_notes), ''),
    is_committee = coalesce(p_is_committee, false)
  where id = v_id;
  insert into public.apartment_billing (apartment_id, building_id, payment_method, standing_order_from)
  select a.id, a.building_id, p_payment_method, v_from from public.apartments a where a.id = v_id
  on conflict (apartment_id) do update set payment_method = excluded.payment_method, standing_order_from = excluded.standing_order_from;
  if coalesce(p_ev, false) and not exists (select 1 from public.ev_chargers c where c.apartment_id = v_id) then
    insert into public.ev_chargers (building_id, apartment_id, initial_reading)
    select a.building_id, a.id, round(coalesce(p_ev_initial, 0), 2) from public.apartments a where a.id = v_id;
  end if;
  if not public.save_apartment_fee(v_id, cm, p_fee, coalesce(p_is_committee, false), v_was_committee) then
    perform public.apply_standing_orders(v_id);
  end if;
  return v_id;
end;
$$;
revoke execute on function public.save_apartment(uuid, int, int, text, numeric, boolean, text, date, boolean, numeric) from public, anon;
grant execute on function public.save_apartment(uuid, int, int, text, numeric, boolean, text, date, boolean, numeric) to authenticated;

-- ---------------------------------------------------------------- daily run (pg_cron)
-- Every day at 01:15 UTC (03:15 / 04:15 in Israel): idempotent, so the run on the 1st records the new month and a
-- missed run heals the next day. pg_cron runs in UTC on Supabase. Where the extension isn't available the schedule
-- is skipped with a WARNING (standing orders then only follow saves and fee changes): check `cron.job` after deploy.
do $$
begin
  begin
    create extension if not exists pg_cron with schema pg_catalog;
  exception when others then
    raise warning 'pg_cron is NOT available, so standing orders are NOT scheduled: new months get their automatic payment only on the next apartment save or fee change. Enable pg_cron and schedule "select public.apply_standing_orders()" daily. (%)', sqlerrm;
    return;
  end;
  perform cron.schedule('apply-standing-orders', '15 1 * * *', 'select public.apply_standing_orders()');
end;
$$;
