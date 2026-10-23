-- Per-apartment fee timeline (0010): building / custom / exempt rows, set_apartment_fee, and the views.
-- Independent of seed.sql: wipes finance rows and apartments inside a rolled-back transaction.
begin;
create extension if not exists pgtap with schema extensions;

select plan(37);

insert into auth.users (id, email, aud, role) values
  ('a9500000-0000-0000-0000-000000000001', 'fee-admin@test.local', 'authenticated', 'authenticated'),
  ('a9500000-0000-0000-0000-000000000002', 'fee-res@test.local', 'authenticated', 'authenticated');
update public.profiles set role = 'admin', status = 'approved'
  where user_id = 'a9500000-0000-0000-0000-000000000001';

delete from public.charges;
delete from public.payments;
delete from public.apartment_fee_overrides;
delete from public.fee_schedule;
delete from public.apartments;

insert into public.apartments (id, number) values
  ('b9500000-0000-0000-0000-00000000000a', 951),
  ('b9500000-0000-0000-0000-00000000000b', 952),
  ('b9500000-0000-0000-0000-00000000000c', 953);
insert into public.residents (id, apartment_id, full_name)
  values ('c9500000-0000-0000-0000-000000000001', 'b9500000-0000-0000-0000-00000000000a', 'דייר בדיקה');
update public.profiles set status = 'approved', resident_id = 'c9500000-0000-0000-0000-000000000001'
  where user_id = 'a9500000-0000-0000-0000-000000000002';
update public.buildings set billing_start = '2020-01-01';
insert into public.fee_schedule (amount, effective_from) values (400, '2020-01-01'), (350, '2020-07-01');

-- Migrated / direct rows default to 'custom'; the mode and the amount must agree.
insert into public.apartment_fee_overrides (apartment_id, amount, effective_from)
  values ('b9500000-0000-0000-0000-00000000000c', 123, '2019-01-01');
select is((select mode from public.apartment_fee_overrides where apartment_id = 'b9500000-0000-0000-0000-00000000000c'),
  'custom', 'an amount-only row is custom');
delete from public.apartment_fee_overrides;
select throws_ok($$insert into public.apartment_fee_overrides (apartment_id, mode, amount, effective_from)
  values ('b9500000-0000-0000-0000-00000000000c', 'custom', null, '2020-01-01')$$, '23514', null, 'custom needs an amount');
select throws_ok($$insert into public.apartment_fee_overrides (apartment_id, mode, amount, effective_from)
  values ('b9500000-0000-0000-0000-00000000000c', 'exempt', 5, '2020-01-01')$$, '23514', null, 'exempt has no amount');
select throws_ok($$insert into public.apartment_fee_overrides (apartment_id, mode, amount, effective_from)
  values ('b9500000-0000-0000-0000-00000000000c', 'free', null, '2020-01-01')$$, '23514', null, 'unknown mode rejected');

set local role authenticated;
set local request.jwt.claims = '{"sub":"a9500000-0000-0000-0000-000000000001","role":"authenticated"}';

-- ---------------------------------------------------------------- exempt range, then building resumes
select is(public.set_apartment_fee('b9500000-0000-0000-0000-00000000000a', '2020-03-01', 'exempt', null), true, 'exempt from 03/2020');
select is(public.set_apartment_fee('b9500000-0000-0000-0000-00000000000a', '2020-06-01', 'building', null), true, 'building from 06/2020');
select is((select row(amount, fee_mode)::text from public.monthly_fees
  where apartment_id = 'b9500000-0000-0000-0000-00000000000a' and month = '2020-02-01'), '(400.00,building)', 'before: building fee');
select is((select row(amount, fee_mode)::text from public.monthly_fees
  where apartment_id = 'b9500000-0000-0000-0000-00000000000a' and month = '2020-03-01'), '(0.00,exempt)', 'exempt month is 0');
select is((select sum(amount) from public.monthly_fees where apartment_id = 'b9500000-0000-0000-0000-00000000000a'
  and month between '2020-03-01' and '2020-05-01'), 0::numeric, 'the whole exempt range is 0');
select is((select row(amount, fee_mode)::text from public.monthly_fees
  where apartment_id = 'b9500000-0000-0000-0000-00000000000a' and month = '2020-06-01'), '(400.00,building)', 'building resumes the schedule');
select is((select amount from public.monthly_fees
  where apartment_id = 'b9500000-0000-0000-0000-00000000000a' and month = '2020-07-01'), 350::numeric, 'and follows schedule changes');

-- ---------------------------------------------------------------- custom 450 -> custom 300 -> building
select is(public.set_apartment_fee('b9500000-0000-0000-0000-00000000000b', '2020-02-01', 'custom', 450), true, 'custom 450');
select is(public.set_apartment_fee('b9500000-0000-0000-0000-00000000000b', '2020-04-01', 'custom', 300), true, 'custom 300');
select is(public.set_apartment_fee('b9500000-0000-0000-0000-00000000000b', '2020-08-01', 'building', null), true, 'back to building');
select is((select array_agg(amount::int order by month)::text from public.monthly_fees
  where apartment_id = 'b9500000-0000-0000-0000-00000000000b' and month between '2020-01-01' and '2020-09-01'),
  '{400,450,450,300,300,300,300,350,350}', 'timeline amounts month by month');
select is((select fee_mode from public.monthly_fees
  where apartment_id = 'b9500000-0000-0000-0000-00000000000b' and month = '2020-03-01'), 'custom', 'custom mode exposed');

-- ---------------------------------------------------------------- no-op and same-month edits
select is(public.set_apartment_fee('b9500000-0000-0000-0000-00000000000b', '2020-05-01', 'custom', 300), false,
  'same effect as the previous row: no-op');
select is(public.set_apartment_fee('b9500000-0000-0000-0000-00000000000c', '2020-05-01', 'building', null), false,
  'building with no earlier row: no-op');
select is(public.set_apartment_fee('b9500000-0000-0000-0000-00000000000b', '2020-04-01', 'custom', 300), false,
  'same as the existing row: no-op');
select is((select count(*) from public.apartment_fee_overrides where apartment_id = 'b9500000-0000-0000-0000-00000000000b'),
  3::bigint, 'no-ops write nothing');
select is(public.set_apartment_fee('b9500000-0000-0000-0000-00000000000b', '2020-04-01', 'custom', 320), true, 'same month is updated');
select is((select amount from public.monthly_fees
  where apartment_id = 'b9500000-0000-0000-0000-00000000000b' and month = '2020-05-01'), 320::numeric, 'updated amount applies');

-- ---------------------------------------------------------------- validation
select throws_ok($$select public.set_apartment_fee('b9500000-0000-0000-0000-00000000000c', '2020-05-01', 'custom', null)$$,
  '22023', null, 'custom without amount rejected');
select throws_ok($$select public.set_apartment_fee('b9500000-0000-0000-0000-00000000000c', '2020-05-01', 'exempt', 10)$$,
  '22023', null, 'exempt with amount rejected');
select throws_ok($$select public.set_apartment_fee('b9500000-0000-0000-0000-00000000000c', '2020-05-01', 'custom', -1)$$,
  '22023', null, 'negative amount rejected');
select throws_ok($$select public.set_apartment_fee('b9500000-0000-0000-0000-00000000000c', '2020-05-15', 'exempt', null)$$,
  '22023', null, 'month must be the first');
select throws_ok($$select public.set_apartment_fee('b9500000-0000-0000-0000-00000000000c', '2020-05-01', 'free', null)$$,
  '22023', null, 'unknown mode rejected');

-- ---------------------------------------------------------------- current fee, past months stable
select public.set_apartment_fee('b9500000-0000-0000-0000-00000000000c', '2020-01-01', 'exempt', null);
create temp table past as
  select apartment_id, sum(amount) as total from public.monthly_fees group by apartment_id;
select is(public.set_apartment_fee('b9500000-0000-0000-0000-00000000000a',
  (public.current_month() + interval '1 month')::date, 'custom', 999), true, 'a future change is scheduled');
select is((select array_agg(row(p.total = s.total)::text order by p.apartment_id)::text from past p
  join (select apartment_id, sum(amount) as total from public.monthly_fees group by apartment_id) s using (apartment_id)),
  '{(t),(t),(t)}', 'past months unchanged by a future row');
select is((select row(current_fee, current_fee_mode)::text from public.apartment_balances
  where apartment_id = 'b9500000-0000-0000-0000-00000000000a'), '(350.00,building)', 'current fee: building until the future row');
select is((select row(current_fee, current_fee_mode)::text from public.apartment_balances
  where apartment_id = 'b9500000-0000-0000-0000-00000000000c'), '(0.00,exempt)', 'current fee: exempt');
select is((select row(current_fee, current_fee_mode)::text from public.apartment_balances
  where apartment_id = 'b9500000-0000-0000-0000-00000000000b'), '(350.00,building)', 'current fee: back on building');

-- ---------------------------------------------------------------- collection summary skips exempt apartments
select is((select apartments_total from public.collection_summary('2020-04-01')), 1, '04/2020: two exempt, one paying');
select is((select apartments_total from public.collection_summary(public.current_month())), 2, 'now: one exempt apartment');

-- ---------------------------------------------------------------- resident
set local request.jwt.claims = '{"sub":"a9500000-0000-0000-0000-000000000002","role":"authenticated"}';
select is((select count(*) from public.apartment_fee_overrides), 3::bigint, 'resident reads their own timeline');
select is((select count(*) from public.apartment_fee_overrides where apartment_id <> 'b9500000-0000-0000-0000-00000000000a'),
  0::bigint, 'and nobody else''s');
select throws_ok($$select public.set_apartment_fee('b9500000-0000-0000-0000-00000000000a', '2020-05-01', 'exempt', null)$$,
  '42501', null, 'resident cannot call the RPC');

select * from finish();
rollback;
