-- Standing orders vs. payments already recorded (0022): the auto payment of a standing-order month is
-- max(0, fee - the month's fee-type payments), so an imported / manual payment is never paid twice.
-- Independent of seed.sql: wipes finance rows and apartments inside a rolled-back transaction.
begin;
create extension if not exists pgtap with schema extensions;

select plan(11);

delete from public.ev_readings;
delete from public.ev_chargers;
delete from public.charges;
delete from public.apartment_billing;
delete from public.payments;
delete from public.apartment_fee_overrides;
delete from public.fee_schedule;
delete from public.apartments;
update public.buildings set billing_start = '2026-02-01';
insert into public.fee_schedule (amount, effective_from) values (300, '2026-01-01');
insert into public.apartments (id, number) values ('b9800000-0000-0000-0000-00000000000a', 980);

-- Months already in the books before the standing order is set: Feb fully paid by import, Mar half paid by
-- hand, Apr has only an EV-noted payment (not the fee), May on are unpaid.
insert into public.payments (apartment_id, paid_on, amount, method, note, source) values
  ('b9800000-0000-0000-0000-00000000000a', '2026-02-10', 300, 'transfer', '', 'import'),
  ('b9800000-0000-0000-0000-00000000000a', '2026-03-05', 120, 'cash', '', 'manual'),
  ('b9800000-0000-0000-0000-00000000000a', '2026-04-05', 80, 'cash', 'טעינת רכב חשמלי 4/2026', 'import');
insert into public.apartment_billing (apartment_id, payment_method, standing_order_from)
  values ('b9800000-0000-0000-0000-00000000000a', 'standing_order', '2026-02-01');
select public.apply_standing_orders();

create function pg_temp.auto(m date) returns numeric language sql as $$
  select p.amount from public.payments p where p.source = 'auto' and p.paid_on = m
    and p.apartment_id = 'b9800000-0000-0000-0000-00000000000a'
$$;

select is((select count(*)::int from public.payments where source = 'auto' and paid_on = '2026-02-01'), 0,
  'a month already paid by import gets no auto row');
select is(pg_temp.auto('2026-03-01'), 180::numeric, 'a partially paid month gets an auto row for the difference');
select is(pg_temp.auto('2026-04-01'), 300::numeric, 'an EV-noted payment does not count as the fee');
select is(pg_temp.auto('2026-05-01'), 300::numeric, 'an unpaid month gets the full fee');
select is((select balance from public.apartment_balances where apartment_id = 'b9800000-0000-0000-0000-00000000000a'),
  -80::numeric, 'no false credit: only the EV payment is extra');

-- A later manual payment reconciles the auto row down, and a full one removes it.
insert into public.payments (apartment_id, paid_on, amount, method, source)
  values ('b9800000-0000-0000-0000-00000000000a', '2026-05-20', 100, 'cash', 'manual');
select is(pg_temp.auto('2026-05-01'), 200::numeric, 'a later manual payment reconciles the auto row down');
insert into public.payments (apartment_id, paid_on, for_month, amount, method, source)
  values ('b9800000-0000-0000-0000-00000000000a', '2026-07-02', '2026-04-01', 300, 'transfer', 'import');
select is((select count(*)::int from public.payments where source = 'auto' and paid_on = '2026-04-01'), 0,
  'a later import for the month (by for_month) removes the auto row');
delete from public.payments where source = 'manual' and paid_on = '2026-05-20';
select is(pg_temp.auto('2026-05-01'), 300::numeric, 'deleting the manual payment restores the full auto amount');

-- An apartment whose standing order starts next month (2026-11) gets nothing for earlier months.
insert into public.apartments (id, number) values ('b9800000-0000-0000-0000-00000000000b', 981);
insert into public.apartment_billing (apartment_id, payment_method, standing_order_from)
  values ('b9800000-0000-0000-0000-00000000000b', 'standing_order', (public.current_month() + interval '1 month')::date);
select public.apply_standing_orders();
select is((select count(*)::int from public.payments where apartment_id = 'b9800000-0000-0000-0000-00000000000b'), 0,
  'a standing order starting next month creates no auto rows for earlier months');
select is((select count(*)::int from public.payments p join public.apartment_billing b on b.apartment_id = p.apartment_id
  where p.source = 'auto' and p.paid_on < b.standing_order_from), 0, 'no auto row is ever before standing_order_from');

select is(public.apply_standing_orders(), 0, 'idempotent: a second run changes nothing');

select * from finish();
rollback;
