-- 0014 apartment form (Task 16): the committee flag, the payment method with standing orders, and one atomic
-- save_apartment() RPC behind the add / edit apartment form.
--   * apartments.is_committee: a committee representative ("נציג ועד") doesn't pay the monthly fee. The exemption
--     itself lives in the fee timeline (0010); save_apartment sets the flag and the exempt row together.
--   * apartments.payment_method 'standing_order' ("הוראת קבע"): the monthly fee is collected automatically, so the
--     system records one payment (source 'auto') per month from standing_order_from through the current month,
--     equal to that month's fee (none when it is 0, e.g. exempt). Levies, extras and EV charges are still owed.
--   * apply_standing_orders() keeps those rows in step. It runs from save_apartment, after any write to the fee
--     timeline or the building fee schedule (statement triggers below), and monthly via pg_cron.

-- ---------------------------------------------------------------- apartments
alter table public.apartments
  add column is_committee boolean not null default false,
  add column payment_method text not null default 'manual' check (payment_method in ('manual', 'standing_order')),
  add column standing_order_from date check (extract(day from standing_order_from) = 1);
alter table public.apartments add constraint apartments_standing_order_from
  check ((payment_method = 'standing_order') = (standing_order_from is not null));

-- ---------------------------------------------------------------- payments
alter table public.payments drop constraint payments_method_check;
alter table public.payments add constraint payments_method_check
  check (method in ('cash', 'transfer', 'cheque', 'app', 'other', 'standing_order'));
alter table public.payments drop constraint payments_source_check;
alter table public.payments add constraint payments_source_check
  check (source in ('manual', 'import', 'ev-import', 'auto'));
-- One automatic payment per apartment-month; apply_standing_orders upserts on it, so it is idempotent.
create unique index payments_auto_month_key on public.payments (apartment_id, paid_on) where source = 'auto';

-- ---------------------------------------------------------------- apply_standing_orders
-- The auto payments that should exist: standing-order months (from standing_order_from) with a fee above 0.
-- Internal (no API role executes it); monthly_fees reads as the definer caller, so every apartment counts.
create function public.standing_order_due(p_apartment_id uuid)
returns table (apartment_id uuid, building_id uuid, month date, amount numeric)
language sql stable set search_path = ''
as $$
  select a.id, a.building_id, f.month, f.amount
  from public.apartments a
  join public.monthly_fees f on f.apartment_id = a.id
  where a.payment_method = 'standing_order' and f.month >= a.standing_order_from and f.amount > 0
    and (p_apartment_id is null or a.id = p_apartment_id);
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
  using public.apartments a
  where p.source = 'auto' and a.id = p.apartment_id and (p_apartment_id is null or a.id = p_apartment_id)
    and (p.paid_on > cm
      or (a.payment_method = 'standing_order' and p.paid_on >= a.standing_order_from
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
    raise exception 'apartment number must be positive' using errcode = '22023';
  end if;
  if p_fee < 0 or p_fee > 1000000 then
    raise exception 'fee must not be negative' using errcode = '22023';
  end if;
  if p_payment_method is null or p_payment_method not in ('manual', 'standing_order') then
    raise exception 'payment method must be manual or standing_order' using errcode = '22023';
  end if;
  if extract(day from p_standing_order_from) <> 1 then
    raise exception 'standing order month must be the first of a month' using errcode = '22023';
  end if;
  if p_ev_initial < 0 or p_ev_initial > 1000000000 then
    raise exception 'initial reading must not be negative' using errcode = '22023';
  end if;
end;
$$;
revoke execute on function public.save_apartment_validate(int, numeric, text, date, numeric) from public, anon, authenticated;

-- The fee part of the form, from p_month on: committee = exempt; otherwise an empty fee or the building rate =
-- building, any other amount = custom. An exemption that isn't the committee's (imported, or set in the fee
-- timeline) is kept while the fee field is left empty. Writes only when the result differs from what applies.
create function public.save_apartment_fee(p_id uuid, p_month date, p_fee numeric, p_committee boolean, p_was_committee boolean)
returns void
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
    return;
  elsif p_fee is not null and round(p_fee, 2) <> coalesce((select s.amount from public.fee_schedule s
      join public.apartments a on a.building_id = s.building_id
      where a.id = p_id and s.effective_from <= p_month order by s.effective_from desc limit 1), 0) then
    v_mode := 'custom';
    v_amount := round(p_fee, 2);
  end if;
  if cur.fee_mode = v_mode and (v_mode <> 'custom' or cur.amount = v_amount) then
    return;
  end if;
  perform public.set_apartment_fee(p_id, p_month, v_mode, v_amount);
end;
$$;
revoke execute on function public.save_apartment_fee(uuid, date, numeric, boolean, boolean) from public, anon, authenticated;

-- One transaction: upsert the apartment, its fee from the current month, the committee flag with the exemption,
-- the payment method, the EV charger (created when asked; an existing one is never removed here), then the
-- standing orders. Every parameter defaults to null so the client can omit p_id (new) and the optional ones.
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
    is_committee = coalesce(p_is_committee, false), payment_method = p_payment_method, standing_order_from = v_from
  where id = v_id;
  perform public.save_apartment_fee(v_id, cm, p_fee, coalesce(p_is_committee, false), v_was_committee);
  if coalesce(p_ev, false) and not exists (select 1 from public.ev_chargers c where c.apartment_id = v_id) then
    insert into public.ev_chargers (building_id, apartment_id, initial_reading)
    select a.building_id, a.id, round(coalesce(p_ev_initial, 0), 2) from public.apartments a where a.id = v_id;
  end if;
  perform public.apply_standing_orders(v_id);
  return v_id;
end;
$$;
revoke execute on function public.save_apartment(uuid, int, int, text, numeric, boolean, text, date, boolean, numeric) from public, anon;
grant execute on function public.save_apartment(uuid, int, int, text, numeric, boolean, text, date, boolean, numeric) to authenticated;

-- ---------------------------------------------------------------- monthly run (pg_cron)
-- 01:00 UTC on the 1st = 03:00 Israel winter time (04:00 in summer): always after midnight of the 1st in Israel,
-- when current_month() has moved on. pg_cron runs in UTC on Supabase. Where the extension isn't available the
-- schedule is skipped; standing orders are then applied on every save / fee change only.
do $$
begin
  begin
    create extension if not exists pg_cron with schema pg_catalog;
  exception when others then
    raise notice 'pg_cron is not available: standing orders are not scheduled (%)', sqlerrm;
    return;
  end;
  perform cron.schedule('apply-standing-orders', '0 1 1 * *', 'select public.apply_standing_orders()');
end;
$$;
