-- EV charging: meter readings -> monthly charges (record/delete RPCs, import, RLS).
-- Independent of seed.sql: uses its own apartments and rates inside a rolled-back transaction.
begin;
create extension if not exists pgtap with schema extensions;

select plan(42);

-- ---------------------------------------------------------------- fixtures (as postgres)
insert into auth.users (id, email, aud, role) values
  ('a9400000-0000-0000-0000-000000000001', 'ev-admin@test.local', 'authenticated', 'authenticated'),
  ('a9400000-0000-0000-0000-000000000002', 'ev-res@test.local', 'authenticated', 'authenticated'),
  ('a9400000-0000-0000-0000-000000000003', 'ev-res2@test.local', 'authenticated', 'authenticated');
update public.profiles set role = 'admin', status = 'approved'
  where user_id = 'a9400000-0000-0000-0000-000000000001';

delete from public.ev_rates;
insert into public.apartments (id, number) values
  ('b9400000-0000-0000-0000-000000000001', 941),
  ('b9400000-0000-0000-0000-000000000002', 942),
  ('b9400000-0000-0000-0000-000000000003', 943);
insert into public.residents (id, apartment_id, full_name) values
  ('c9400000-0000-0000-0000-000000000001', 'b9400000-0000-0000-0000-000000000001', 'דייר טעינה'),
  ('c9400000-0000-0000-0000-000000000003', 'b9400000-0000-0000-0000-000000000003', 'דייר בלי עמדה');
update public.profiles set status = 'approved', resident_id = 'c9400000-0000-0000-0000-000000000001'
  where user_id = 'a9400000-0000-0000-0000-000000000002';
update public.profiles set status = 'approved', resident_id = 'c9400000-0000-0000-0000-000000000003'
  where user_id = 'a9400000-0000-0000-0000-000000000003';

insert into public.ev_rates (rate, effective_from) values (0.5, '2030-01-01'), (0.6, '2030-03-01');
insert into public.ev_chargers (id, apartment_id, initial_reading) values
  ('d9400000-0000-0000-0000-000000000001', 'b9400000-0000-0000-0000-000000000001', 100),
  ('d9400000-0000-0000-0000-000000000002', 'b9400000-0000-0000-0000-000000000002', 0);

create temp view ev_charge as
select r.month, r.reading, r.kwh, r.rate, c.amount, c.kind, c.label, c.source, c.apartment_id
from public.ev_readings r join public.charges c on c.ev_reading_id = r.id
where r.charger_id = 'd9400000-0000-0000-0000-000000000001';
grant select on ev_charge to authenticated;

select has_function('public', 'record_ev_reading', array['uuid', 'date', 'numeric', 'date', 'text'], 'record_ev_reading exists');
select has_function('public', 'delete_ev_reading', array['uuid'], 'delete_ev_reading exists');
select has_function('public', 'import_ev', array['jsonb'], 'import_ev exists');

-- ---------------------------------------------------------------- admin records readings
set local role authenticated;
set local request.jwt.claims = '{"sub":"a9400000-0000-0000-0000-000000000001","role":"authenticated"}';

create temp table res as
select public.record_ev_reading('d9400000-0000-0000-0000-000000000001', '2030-01-01', 150.55, '2030-01-31', '') as j;
select is((select (j ->> 'previous')::numeric from res), 100::numeric, 'first reading uses initial_reading as previous');
select is((select (j ->> 'kwh')::numeric from res), 50.55::numeric, 'kwh = reading - initial_reading');
select is((select (j ->> 'amount')::numeric from res), 25.28::numeric, 'kwh x rate rounds to agorot (25.275 -> 25.28)');
select is((select row(amount, kind, label, source)::text from ev_charge where month = '2030-01-01'),
  '(25.28,extra,"טעינת רכב חשמלי",ev)', 'the apartment gets an extra charge linked to the reading');
select is((select apartment_id from ev_charge where month = '2030-01-01'), 'b9400000-0000-0000-0000-000000000001'::uuid,
  'the charge belongs to the charger''s apartment');

select is((public.record_ev_reading('d9400000-0000-0000-0000-000000000001', '2030-02-01', 200, null, '') ->> 'amount')::numeric,
  24.73::numeric, 'second month: (200 - 150.55) x 0.5 = 24.725 -> 24.73');
select is((public.record_ev_reading('d9400000-0000-0000-0000-000000000001', '2030-03-01', 300, null, '') ->> 'rate')::numeric,
  0.6::numeric, 'the rate switches by effective date');
select is((select amount from ev_charge where month = '2030-03-01'), 60::numeric, 'March: 100 kWh x 0.6 = 60');

select throws_ok($$ select public.record_ev_reading('d9400000-0000-0000-0000-000000000001', '2030-04-01', 250, null, '') $$,
  '22023', null, 'a reading lower than the previous one is rejected');
select is((select count(*) from ev_charge where month = '2030-04-01'), 0::bigint, 'nothing is stored for the rejected reading');

select lives_ok($$ select public.record_ev_reading('d9400000-0000-0000-0000-000000000001', '2030-03-01', 310, null, 'תיקון') $$,
  'recording the same month again succeeds');
select is((select count(*) from public.ev_readings where charger_id = 'd9400000-0000-0000-0000-000000000001' and month = '2030-03-01'),
  1::bigint, 'the same month twice updates the reading (no duplicate)');
select is((select count(*)::text || ':' || max(amount)::text from ev_charge where month = '2030-03-01'), '1:66.00',
  'and updates its one charge');

select lives_ok($$ select public.record_ev_reading('d9400000-0000-0000-0000-000000000001', '2030-02-01', 220, null, '') $$,
  'editing a middle month succeeds');
select is((select row(kwh, amount)::text from ev_charge where month = '2030-03-01'), '(90.00,54.00)',
  'editing a middle month recomputes the following month');
select throws_ok($$ select public.record_ev_reading('d9400000-0000-0000-0000-000000000001', '2030-02-01', 400, null, '') $$,
  '22023', null, 'an edit that makes the next month negative is rejected');
select is((select reading from ev_charge where month = '2030-02-01'), 220::numeric, 'and leaves the reading unchanged');

select throws_ok($$ select public.record_ev_reading('d9400000-0000-0000-0000-000000000001', '2029-12-01', 120, null, '') $$,
  '22023', null, 'a month with no rate in force is rejected');
select throws_ok($$ select public.record_ev_reading('d9400000-0000-0000-0000-000000000001', '2030-05-15', 400, null, '') $$,
  '22023', null, 'the month must be the first of a month');

select public.record_ev_reading('d9400000-0000-0000-0000-000000000002', '2030-01-01', 40, null, '');

select lives_ok($$ select public.delete_ev_reading((select id from public.ev_readings
  where charger_id = 'd9400000-0000-0000-0000-000000000001' and month = '2030-02-01')) $$, 'admin deletes a reading');
select is((select count(*) from ev_charge where month = '2030-02-01'), 0::bigint, 'its charge is deleted with it');
select is((select row(kwh, amount)::text from ev_charge where month = '2030-03-01'), '(159.45,95.67)',
  'deleting recomputes the next month against the earlier reading');

-- ---------------------------------------------------------------- residents
set local request.jwt.claims = '{"sub":"a9400000-0000-0000-0000-000000000002","role":"authenticated"}';
select is((select count(*) from public.ev_chargers), 1::bigint, 'a resident sees only their own charger');
select is((select count(*) from public.ev_readings), 2::bigint, 'a resident sees only their own readings');
select is((select count(*) from public.ev_rates), 2::bigint, 'residents can read the rates');
select throws_ok($$ select public.record_ev_reading('d9400000-0000-0000-0000-000000000001', '2030-04-01', 400, null, '') $$,
  '42501', null, 'a resident cannot record a reading');
select throws_ok($$ select public.delete_ev_reading((select id from public.ev_readings limit 1)) $$,
  '42501', null, 'a resident cannot delete a reading');
select throws_ok($$ select public.import_ev('{"chargers":[],"rates":[],"payments":[]}') $$,
  '42501', null, 'a resident cannot import');
select throws_ok($$ insert into public.ev_rates (rate, effective_from) values (1, '2031-01-01') $$,
  '42501', null, 'a resident cannot add a rate');

set local request.jwt.claims = '{"sub":"a9400000-0000-0000-0000-000000000003","role":"authenticated"}';
select is((select count(*)::text || ':' || (select count(*) from public.ev_readings)::text from public.ev_chargers), '0:0',
  'an apartment without a charger has nothing');

-- ---------------------------------------------------------------- import
set local request.jwt.claims = '{"sub":"a9400000-0000-0000-0000-000000000001","role":"authenticated"}';
create temp table p as select $json$
{
  "chargers": [
    {"apartment": 945, "initial_reading": 10, "readings": [{"month": "2030-01-01", "reading": 20}, {"month": "2030-02-01", "reading": 33.3}]},
    {"apartment": 941, "initial_reading": 100, "readings": [{"month": "2030-01-01", "reading": 999}]}
  ],
  "rates": [{"effective_from": "2030-01-01", "rate": 0.5}],
  "payments": [{"apartment": 945, "paid_on": "2030-01-01", "amount": 5}]
}
$json$::jsonb as j;

insert into public.ev_rates (rate, effective_from) values (0.9, '2030-02-01');
create temp table imp as select public.import_ev((select j from p)) as j;
select is((select row(j ->> 'chargers', j ->> 'readings', j ->> 'kept_manual', j ->> 'payments')::text from imp), '(1,2,1,1)',
  'import creates the missing charger, imports 2 readings, keeps the manual one, adds the payment');
select is((select string_agg(c.amount::text, ',' order by r.month) from public.ev_readings r
  join public.ev_chargers ch on ch.id = r.charger_id join public.apartments a on a.id = ch.apartment_id
  join public.charges c on c.ev_reading_id = r.id where a.number = 945), '5.00,6.65',
  'imported readings get the same charges as record_ev_reading (10 kWh x 0.5, 13.3 kWh x 0.5)');
select is((select reading from ev_charge where month = '2030-01-01'), 150.55::numeric, 'a manual reading in an imported month is kept');
select is((select string_agg(rate::text, ',' order by effective_from) from public.ev_rates), '0.5000,0.6000',
  'a rate inside the imported span that the import does not have is replaced; later rates are kept');
select is((select amount from ev_charge where month = '2030-03-01'), 95.67::numeric, 'other chargers are recomputed with the imported rates');
select lives_ok($$ select public.import_ev((select j from p)) $$, 're-import succeeds');
select is((select count(*)::text || ':' || (select count(*) from public.payments where source = 'ev-import')::text
  from public.charges where source = 'ev-import'), '2:1', 're-import replaces the imported readings, charges and payments');
select throws_ok($$ select public.import_ev('{"chargers":[{"apartment":945,"initial_reading":0,"readings":[{"month":"2030-01-01","reading":-1}]}],"rates":[],"payments":[]}') $$,
  '22023', null, 'a negative reading in the payload is rejected');
select throws_ok($$ select public.import_ev('{"chargers":[{"apartment":945,"initial_reading":0,"readings":[{"month":"2030-01-01","reading":"5"}]}],"rates":[],"payments":[]}') $$,
  '22023', null, 'a string reading in the payload is rejected');

select * from finish();
rollback;
