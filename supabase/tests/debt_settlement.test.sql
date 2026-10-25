-- Debt settlement (0017): settlement_plan, settle_debt (pay / write-off), undo_settlement, adjustments under RLS.
-- Independent of seed.sql: wipes finance rows and apartments inside a rolled-back transaction.
begin;
create extension if not exists pgtap with schema extensions;

select plan(52);

insert into auth.users (id, email, aud, role) values
  ('a9700000-0000-0000-0000-000000000001', 'settle-admin@test.local', 'authenticated', 'authenticated'),
  ('a9700000-0000-0000-0000-000000000002', 'settle-res@test.local', 'authenticated', 'authenticated'),
  ('a9700000-0000-0000-0000-000000000003', 'settle-other@test.local', 'authenticated', 'authenticated');
update public.profiles set role = 'admin', status = 'approved' where user_id = 'a9700000-0000-0000-0000-000000000001';

delete from public.ev_readings;
delete from public.ev_chargers;
delete from public.charges;
delete from public.apartment_billing;
delete from public.payments;
delete from public.apartment_fee_overrides;
delete from public.fee_schedule;
delete from public.apartments;
-- No monthly fee here: the months below are charges and payments only, so the numbers stay readable.
update public.buildings set billing_start = null, opening_cash = 1000, opening_cash_date = '2020-01-01';

insert into public.apartments (id, number) values
  ('b9700000-0000-0000-0000-00000000000a', 970), ('b9700000-0000-0000-0000-00000000000b', 971);
insert into public.residents (id, apartment_id, full_name) values
  ('c9700000-0000-0000-0000-000000000001', 'b9700000-0000-0000-0000-00000000000a', 'דייר בדיקה'),
  ('c9700000-0000-0000-0000-000000000002', 'b9700000-0000-0000-0000-00000000000b', 'דייר שכן');
update public.profiles set status = 'approved', resident_id = 'c9700000-0000-0000-0000-000000000001'
  where user_id = 'a9700000-0000-0000-0000-000000000002';
update public.profiles set status = 'approved', resident_id = 'c9700000-0000-0000-0000-000000000002'
  where user_id = 'a9700000-0000-0000-0000-000000000003';
-- Task 18: residents here hold finance_own (permissions.test.sql covers the gate itself).
insert into public.group_permissions (group_id, permission)
select g.id, 'finance_own' from public.user_groups g where g.is_default;

-- Apartment 970:
--   2024-01  EV charge 300                     open 300
--   2024-02  levy 200, paid 50                 open 150 (partial)
--   2024-03  extra 100, paid 180               credit 80 (overpaid)
--   2025-05  extra 100                         open 100
-- Balance 470. Oldest first, capped by the balance: Jan 300, Feb 150, then only 20 of May (the credit covers 80).
insert into public.charges (apartment_id, month, amount, kind, label) values
  ('b9700000-0000-0000-0000-00000000000a', '2024-01-01', 300, 'extra', 'טעינת רכב חשמלי'),
  ('b9700000-0000-0000-0000-00000000000a', '2024-02-01', 200, 'levy', 'שיפוץ'),
  ('b9700000-0000-0000-0000-00000000000a', '2024-03-01', 100, 'extra', 'תיקון'),
  ('b9700000-0000-0000-0000-00000000000a', '2025-05-01', 100, 'extra', 'תיקון'),
  ('b9700000-0000-0000-0000-00000000000b', '2024-01-01', 50, 'extra', 'שכן');
insert into public.payments (apartment_id, paid_on, amount, method) values
  ('b9700000-0000-0000-0000-00000000000a', '2024-02-10', 50, 'cash'),
  ('b9700000-0000-0000-0000-00000000000a', '2024-03-10', 180, 'cash');

create function pg_temp.bal() returns numeric language sql as $$
  select balance from public.apartment_balances where apartment_id = 'b9700000-0000-0000-0000-00000000000a'
$$;
create function pg_temp.cash() returns numeric language sql as $$
  select public.building_cash_balance(public.default_building_id())
$$;
create temp table saved (k text primary key, v jsonb) on commit drop;
grant execute on function pg_temp.bal(), pg_temp.cash() to authenticated;
grant all on saved to authenticated;

-- ---------------------------------------------------------------- schema
select has_column('public', 'charges', 'settlement_id', 'charges.settlement_id');
select has_column('public', 'payments', 'settlement_id', 'payments.settlement_id');
select has_column('public', 'payments', 'for_month', 'payments.for_month');
select has_column('public', 'apartment_ledger', 'adjusted', 'the ledger carries the month''s write-offs');
select throws_ok($$insert into public.charges (apartment_id, month, amount, kind, label, note)
  values ('b9700000-0000-0000-0000-00000000000a', '2024-01-01', 10, 'adjustment', 'x', 'y')$$, '23514', null,
  'an adjustment is never positive');
select throws_ok($$insert into public.charges (apartment_id, month, amount, kind, label)
  values ('b9700000-0000-0000-0000-00000000000a', '2024-01-01', -10, 'adjustment', 'x')$$, '23514', null,
  'an adjustment needs a reason');
select throws_ok($$insert into public.charges (apartment_id, month, amount, kind, label)
  values ('b9700000-0000-0000-0000-00000000000a', '2024-01-01', -10, 'levy', 'x')$$, '23514', null,
  'a levy still cannot be negative');

-- ---------------------------------------------------------------- the plan (server side)
select is(pg_temp.bal(), 470.00, 'fixture balance');
select results_eq($$select month, amount from public.settlement_plan('b9700000-0000-0000-0000-00000000000a',
    array['2024-01-01', '2024-02-01', '2024-03-01', '2025-05-01']::date[])$$,
  $$values ('2024-01-01'::date, 300.00::numeric), ('2024-02-01', 150.00), ('2025-05-01', 20.00)$$,
  'oldest first, overpaid months skipped, capped by the balance');
select results_eq($$select month, amount from public.settlement_plan('b9700000-0000-0000-0000-00000000000a',
    array['2025-05-15']::date[])$$,
  $$values ('2025-05-01'::date, 20.00::numeric)$$, 'a subset takes its share of the full plan (any day of the month)');

-- ---------------------------------------------------------------- residents cannot settle or undo
set local role authenticated;
set local request.jwt.claims = '{"sub":"a9700000-0000-0000-0000-000000000002","role":"authenticated"}';
select throws_ok($$select public.settle_debt('b9700000-0000-0000-0000-00000000000a', array['2024-01-01']::date[], 'pay', 'cash')$$,
  '42501', null, 'a resident cannot settle debt');
select throws_ok($$select public.undo_settlement(gen_random_uuid())$$, '42501', null, 'a resident cannot undo a settlement');
select throws_ok($$select * from public.settlement_plan('b9700000-0000-0000-0000-00000000000a', array['2024-01-01']::date[])$$,
  '42501', null, 'settlement_plan is internal');

-- ---------------------------------------------------------------- validation (admin)
set local request.jwt.claims = '{"sub":"a9700000-0000-0000-0000-000000000001","role":"authenticated"}';
select throws_ok($$select public.settle_debt('b9700000-0000-0000-0000-00000000000a', array['2024-01-01']::date[], 'gift')$$,
  '22023', null, 'unknown mode');
select throws_ok($$select public.settle_debt('b9700000-0000-0000-0000-00000000000a', array['2024-01-01']::date[], 'pay', 'bitcoin')$$,
  '22023', null, 'unknown method');
select throws_ok($$select public.settle_debt('b9700000-0000-0000-0000-00000000000a', array['2024-01-01']::date[], 'pay', 'cash', 'tomorrow')$$,
  '22023', null, 'unknown date mode');
select throws_ok($$select public.settle_debt('b9700000-0000-0000-0000-00000000000a', array['2024-01-01']::date[], 'write_off', null, null, '  ')$$,
  '22023', null, 'a write-off needs a reason');
select throws_ok($$select public.settle_debt(gen_random_uuid(), array['2024-01-01']::date[], 'pay', 'cash')$$,
  'P0002', null, 'unknown apartment');

-- ---------------------------------------------------------------- pay, dated at each debt month
insert into saved select 'pay1', public.settle_debt('b9700000-0000-0000-0000-00000000000a',
  array['2024-01-01', '2024-02-01']::date[], 'pay', 'transfer', 'debt_month', 'הסדר');
select is((select (v->>'months')::int from saved where k = 'pay1'), 2, 'pay: two months settled');
select is((select (v->>'total')::numeric from saved where k = 'pay1'), 450.00, 'pay: total from the server');
select results_eq($$select paid_on, for_month, amount, method, note, source from public.payments
    where settlement_id = (select (v->>'settlement_id')::uuid from saved where k = 'pay1') order by paid_on$$,
  $$values ('2024-01-01'::date, '2024-01-01'::date, 300.00::numeric, 'transfer', 'הסדר', 'manual'),
           ('2024-02-01', '2024-02-01', 150.00, 'transfer', 'הסדר', 'manual')$$,
  'pay: one manual payment per month, dated the first of that month');
select is(pg_temp.bal(), 20.00, 'pay: balance after');
select is((select charged - paid from public.apartment_ledger
    where apartment_id = 'b9700000-0000-0000-0000-00000000000a' and month = '2024-02-01'), 0.00, 'the partial month now shows paid');

-- A second identical call writes nothing.
insert into saved select 'pay1-again', public.settle_debt('b9700000-0000-0000-0000-00000000000a',
  array['2024-01-01', '2024-02-01']::date[], 'pay', 'transfer', 'debt_month', 'הסדר');
select is((select (v->>'months')::int from saved where k = 'pay1-again'), 0, 'second call: no months');
select is((select v->'settlement_id' from saved where k = 'pay1-again'), 'null'::jsonb, 'second call: no settlement id');
select is((select count(*)::int from public.payments where apartment_id = 'b9700000-0000-0000-0000-00000000000a'), 4,
  'second call: no new payments');

-- Settling everything stops at the balance: never negative.
insert into saved select 'pay-all', public.settle_debt('b9700000-0000-0000-0000-00000000000a',
  array['2024-01-01', '2024-02-01', '2024-03-01', '2025-05-01']::date[], 'pay', 'cash', 'debt_month', '');
select is((select (v->>'total')::numeric from saved where k = 'pay-all'), 20.00, 'all debts: only what is still owed');
select is(pg_temp.bal(), 0.00, 'all debts: balance is zero, not negative');
select is((select (v->>'balance')::numeric from saved where k = 'pay-all'), 0.00, 'the result reports the new balance');
select is((select (public.settle_debt('b9700000-0000-0000-0000-00000000000a',
  array['2025-05-01']::date[], 'pay', 'cash') ->> 'months')::int), 0, 'nothing open: no-op');
select is(pg_temp.bal(), 0.00, 'still zero');

-- ---------------------------------------------------------------- undo
select is(public.undo_settlement((select (v->>'settlement_id')::uuid from saved where k = 'pay-all')),
  '{"charges": 0, "payments": 1}'::jsonb, 'undo deletes that settlement''s payment');
select is(pg_temp.bal(), 20.00, 'undo restores the previous balance');
select is((public.undo_settlement((select (v->>'settlement_id')::uuid from saved where k = 'pay1')) ->> 'payments')::int, 2,
  'undo the first settlement');
select is(pg_temp.bal(), 470.00, 'back to the original balance');
select is((select count(*)::int from public.payments where settlement_id is not null), 0, 'no settlement payments left');

-- ---------------------------------------------------------------- pay, dated today
insert into saved select 'today', public.settle_debt('b9700000-0000-0000-0000-00000000000a',
  array['2024-01-01']::date[], 'pay', 'cash', 'today', '');
select results_eq($$select paid_on, for_month, amount from public.payments
    where settlement_id = (select (v->>'settlement_id')::uuid from saved where k = 'today')$$,
  $$values ((now() at time zone 'Asia/Jerusalem')::date, '2024-01-01'::date, 300.00::numeric)$$,
  'today: dated today, settling January 2024');
select is((select paid from public.apartment_ledger
    where apartment_id = 'b9700000-0000-0000-0000-00000000000a' and month = '2024-01-01'), 300.00,
  'today: the ledger shows January paid');
select is((select (public.settle_debt('b9700000-0000-0000-0000-00000000000a',
  array['2024-01-01']::date[], 'pay', 'cash', 'today', '') ->> 'months')::int), 0, 'today: a second call is a no-op too');
select lives_ok($$select public.undo_settlement((select (v->>'settlement_id')::uuid from saved where k = 'today'))$$, 'undo today');

-- ---------------------------------------------------------------- write-off
insert into saved select 'cash-before', to_jsonb(pg_temp.cash());
insert into saved select 'wo', public.settle_debt('b9700000-0000-0000-0000-00000000000a',
  array['2024-01-01', '2024-02-01', '2025-05-01']::date[], 'write_off', null, null, 'הדייר עזב, לא ייגבה');
select is((select (v->>'total')::numeric from saved where k = 'wo'), 470.00, 'write-off: total');
select results_eq($$select month, amount, kind, label, note from public.charges
    where settlement_id = (select (v->>'settlement_id')::uuid from saved where k = 'wo') order by month$$,
  $$values ('2024-01-01'::date, -300.00::numeric, 'adjustment', 'מחיקת חוב', 'הדייר עזב, לא ייגבה'),
           ('2024-02-01', -150.00, 'adjustment', 'מחיקת חוב', 'הדייר עזב, לא ייגבה'),
           ('2025-05-01', -20.00, 'adjustment', 'מחיקת חוב', 'הדייר עזב, לא ייגבה')$$,
  'write-off: one negative adjustment per month, with the reason');
select is(pg_temp.bal(), 0.00, 'write-off: balance zero');
select is(pg_temp.cash(), (select (v #>> '{}')::numeric from saved where k = 'cash-before'), 'write-off: building cash unchanged');
select is((select count(*)::int from public.payments where settlement_id is not null), 0, 'write-off: no payments');
select is((select adjusted from public.apartment_ledger
    where apartment_id = 'b9700000-0000-0000-0000-00000000000a' and month = '2024-01-01'), -300.00, 'the ledger marks the write-off');
select is((select (public.settle_debt('b9700000-0000-0000-0000-00000000000a',
  array['2024-01-01', '2024-02-01', '2025-05-01']::date[], 'write_off', null, null, 'שוב') ->> 'months')::int), 0,
  'write-off: a second call is a no-op');

-- ---------------------------------------------------------------- adjustments under RLS
set local request.jwt.claims = '{"sub":"a9700000-0000-0000-0000-000000000002","role":"authenticated"}';
select is((select count(*)::int from public.charges where kind = 'adjustment'), 3, 'a resident sees the adjustments on their own apartment');
set local request.jwt.claims = '{"sub":"a9700000-0000-0000-0000-000000000003","role":"authenticated"}';
select is((select count(*)::int from public.charges where kind = 'adjustment'), 0, 'another resident sees none of them');
select is((select count(*)::int from public.apartment_ledger where apartment_id = 'b9700000-0000-0000-0000-00000000000a'), 0,
  'nor that apartment''s ledger');

-- Undo the write-off: the balance comes back.
set local request.jwt.claims = '{"sub":"a9700000-0000-0000-0000-000000000001","role":"authenticated"}';
select is((public.undo_settlement((select (v->>'settlement_id')::uuid from saved where k = 'wo')) ->> 'charges')::int, 3,
  'undo deletes the write-off rows');
select is(pg_temp.bal(), 470.00, 'undo write-off restores the balance');

select * from finish();
rollback;
