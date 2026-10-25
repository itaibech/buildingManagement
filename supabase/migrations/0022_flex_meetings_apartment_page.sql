-- 0022 (Task 25): the standing-order duplicate fix, deleting users and apartments, and meeting flexibility.

-- ================================================================ A. standing orders never pay a month twice
-- A standing-order month's auto payment is max(0, fee - that month's fee-type payments). Fee-type = source
-- 'import' / 'manual', not EV-noted, not a settlement or special-charge payment; "that month" = for_month, else
-- paid_on's month. A month already paid gets no auto row (an existing one is deleted by apply_standing_orders,
-- whose body is unchanged: it removes in-range auto rows with nothing due and upserts the rest).
create or replace function public.standing_order_due(p_apartment_id uuid)
returns table (apartment_id uuid, building_id uuid, month date, amount numeric)
language sql stable set search_path = ''
as $$
  select b.apartment_id, b.building_id, f.month, (f.amount - coalesce(paid.amount, 0))::numeric(12,2)
  from public.apartment_billing b
  join public.monthly_fees f on f.apartment_id = b.apartment_id
  left join lateral (
    select sum(p.amount) as amount from public.payments p
    where p.apartment_id = b.apartment_id and p.source in ('import', 'manual')
      and p.settlement_id is null and p.special_id is null and p.note not like 'טעינת רכב חשמלי%'
      and coalesce(p.for_month, date_trunc('month', p.paid_on::timestamp)::date) = f.month
  ) paid on true
  where b.payment_method = 'standing_order' and f.month >= b.standing_order_from
    and f.amount - coalesce(paid.amount, 0) > 0
    and (p_apartment_id is null or b.apartment_id = p_apartment_id);
$$;
revoke execute on function public.standing_order_due(uuid) from public, anon, authenticated;

-- A write to non-auto payments (manual entry, import, undo) re-syncs the standing orders in the same transaction.
-- apply_standing_orders' own writes (depth > 1) don't re-enter.
create function public.payments_standing_orders_resync() returns trigger
language plpgsql set search_path = ''
as $$
begin
  if pg_trigger_depth() = 1 then
    perform public.apply_standing_orders();
  end if;
  return null;
end;
$$;
revoke execute on function public.payments_standing_orders_resync() from public, anon, authenticated;
create trigger payments_standing_orders after insert or update or delete on public.payments
  for each statement execute function public.payments_standing_orders_resync();

-- ================================================================ reconcile production on deploy (keep last)
select public.apply_standing_orders();
