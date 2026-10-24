-- Apartment form (0014): save_apartment, the committee flag, standing orders (apply_standing_orders), EV charger.
-- Independent of seed.sql: wipes finance rows and apartments inside a rolled-back transaction.
begin;
create extension if not exists pgtap with schema extensions;

select plan(41);

insert into auth.users (id, email, aud, role) values
  ('a9600000-0000-0000-0000-000000000001', 'form-admin@test.local', 'authenticated', 'authenticated'),
  ('a9600000-0000-0000-0000-000000000002', 'form-res@test.local', 'authenticated', 'authenticated');
update public.profiles set role = 'admin', status = 'approved'
  where user_id = 'a9600000-0000-0000-0000-000000000001';

delete from public.ev_readings;
delete from public.ev_chargers;
delete from public.charges;
delete from public.payments;
delete from public.apartment_fee_overrides;
delete from public.fee_schedule;
delete from public.apartments;

insert into public.apartments (id, number) values ('b9600000-0000-0000-0000-00000000000a', 960);
insert into public.residents (id, apartment_id, full_name)
  values ('c9600000-0000-0000-0000-000000000001', 'b9600000-0000-0000-0000-00000000000a', 'דייר בדיקה');
update public.profiles set status = 'approved', resident_id = 'c9600000-0000-0000-0000-000000000001'
  where user_id = 'a9600000-0000-0000-0000-000000000002';
-- Billing starts with the standing order, so a standing-order apartment with only fees owes nothing.
update public.buildings set billing_start = '2024-03-01';
insert into public.fee_schedule (amount, effective_from) values (400, '2024-01-01'), (350, '2024-07-01');

-- ---------------------------------------------------------------- schema
select has_column('public', 'apartments', 'is_committee', 'apartments.is_committee');
select has_column('public', 'apartments', 'payment_method', 'apartments.payment_method');
select throws_ok($$update public.apartments set payment_method = 'standing_order', standing_order_from = '2024-01-15'
  where number = 960$$, '23514', null, 'standing_order_from must be the first of a month');
select throws_ok($$update public.apartments set payment_method = 'standing_order' where number = 960$$,
  '23514', null, 'a standing order needs its first month');

create temp table ids (k text primary key, id uuid) on commit drop;
grant all on ids to authenticated;
create function pg_temp.auto(k text) returns table (paid_on date, amount numeric) language sql as $$
  select p.paid_on, p.amount from public.payments p where p.apartment_id = (select id from ids where ids.k = auto.k)
    and p.source = 'auto' order by p.paid_on
$$;
create function pg_temp.mismatches(k text) returns bigint language sql as $$
  select count(*) from (
    select f.month, f.amount from public.monthly_fees f
    where f.apartment_id = (select id from ids where ids.k = mismatches.k) and f.amount > 0
      and f.month >= (select a.standing_order_from from public.apartments a where a.id = (select id from ids where ids.k = mismatches.k))
    except select paid_on, amount from pg_temp.auto(k)
  ) x
$$;

grant execute on function pg_temp.auto(text), pg_temp.mismatches(text) to authenticated;

-- Monthly run: 01:00 UTC on the 1st (03:00 / 04:00 in Israel). The local stack and Supabase both ship pg_cron.
select is((select count(*)::int from cron.job where jobname = 'apply-standing-orders' and schedule = '0 1 1 * *'
  and command = 'select public.apply_standing_orders()'), 1, 'standing orders are scheduled monthly');

-- ---------------------------------------------------------------- residents can't call either RPC
set local role authenticated;
set local request.jwt.claims = '{"sub":"a9600000-0000-0000-0000-000000000002","role":"authenticated"}';
select throws_ok($$select public.save_apartment(null, 999, null, null, null, false, 'manual', null, false, 0)$$,
  '42501', null, 'a resident cannot save an apartment');
select throws_ok($$select public.apply_standing_orders()$$, '42501', null, 'a resident cannot apply standing orders');

set local request.jwt.claims = '{"sub":"a9600000-0000-0000-0000-000000000001","role":"authenticated"}';

-- ---------------------------------------------------------------- validation
select throws_ok($$select public.save_apartment(null, 0, null, null, null, false, 'manual', null, false, 0)$$,
  '22023', null, 'the number must be positive');
select throws_ok($$select public.save_apartment(null, 970, null, null, -1, false, 'manual', null, false, 0)$$,
  '22023', null, 'the fee must not be negative');
select throws_ok($$select public.save_apartment(null, 970, null, null, null, false, 'cash', null, false, 0)$$,
  '22023', null, 'unknown payment method');
select throws_ok($$select public.save_apartment(null, 970, null, null, null, false, 'standing_order', '2024-03-15', false, 0)$$,
  '22023', null, 'the standing order month must be the first of a month');
select throws_ok($$select public.save_apartment(null, 960, null, null, null, false, 'manual', null, false, 0)$$,
  '23505', null, 'apartment numbers are unique');

-- ---------------------------------------------------------------- standing order: one payment per month at that month's fee
insert into ids select 'so', public.save_apartment(null, 961, 2, 'הערה', null, false, 'standing_order', '2024-03-01', false, 0);
select is((select count(*) from pg_temp.auto('so')),
  (select count(*) from public.monthly_fees where apartment_id = (select id from ids where k = 'so') and month >= '2024-03-01'),
  'one auto payment per month from standing_order_from through the current month');
select is(pg_temp.mismatches('so'), 0::bigint, 'each auto payment equals that month''s fee');
select is((select row(p.method, p.note, extract(day from p.paid_on)::int)::text from public.payments p
  where p.apartment_id = (select id from ids where k = 'so') and p.source = 'auto' limit 1),
  '(standing_order,"הוראת קבע",1)', 'method standing_order, note, paid on the 1st');
select is((select min(paid_on) from pg_temp.auto('so')), '2024-03-01'::date, 'nothing before the first month');
select is((select balance from public.apartment_balances where apartment_id = (select id from ids where k = 'so')),
  0::numeric, 'a standing-order apartment with only fees has no balance');

-- ---------------------------------------------------------------- idempotent
select is(public.apply_standing_orders(), 0, 'a second run changes nothing');
select is((select count(*) from public.payments where source = 'auto'),
  (select count(*) from public.monthly_fees where apartment_id = (select id from ids where k = 'so') and month >= '2024-03-01'),
  'running it again does not duplicate');

-- ---------------------------------------------------------------- re-sync after fee changes
select public.set_apartment_fee((select id from ids where k = 'so'), '2025-01-01', 'custom', 500);
select is((select amount from public.payments where apartment_id = (select id from ids where k = 'so')
  and source = 'auto' and paid_on = '2025-02-01'), 500::numeric, 'an apartment fee change re-syncs the auto rows');
reset role;
insert into public.fee_schedule (amount, effective_from) values (360, '2024-09-01');
set local role authenticated;
select is((select amount from public.payments where apartment_id = (select id from ids where k = 'so')
  and source = 'auto' and paid_on = '2024-10-01'), 360::numeric, 'a building rate change re-syncs them too');
select is(pg_temp.mismatches('so'), 0::bigint, 'still equal to the fees after both changes');

-- ---------------------------------------------------------------- exempt months generate nothing
select public.set_apartment_fee((select id from ids where k = 'so'), '2024-05-01', 'exempt', null);
select public.set_apartment_fee((select id from ids where k = 'so'), '2024-06-01', 'building', null);
select is((select count(*) from pg_temp.auto('so') where paid_on = '2024-05-01'), 0::bigint, 'no payment for an exempt month');
select is((select count(*) from pg_temp.auto('so') where paid_on = '2024-06-01'), 1::bigint, 'payments resume after it');
select is((select balance from public.apartment_balances where apartment_id = (select id from ids where k = 'so')),
  0::numeric, 'still no balance');

-- ---------------------------------------------------------------- back to manual: future auto rows go, past ones stay
reset role;
insert into public.payments (apartment_id, paid_on, amount, method, note, source)
  select id, (public.current_month() + interval '1 month')::date, 1, 'standing_order', 'הוראת קבע', 'auto' from ids where k = 'so';
set local role authenticated;
reset role;
create temp table before_manual on commit drop as select count(*) as n from pg_temp.auto('so') where paid_on <= public.current_month();
grant select on before_manual to authenticated;
set local role authenticated;
select public.save_apartment((select id from ids where k = 'so'), 961, 2, 'הערה', null, false, 'manual', null, false, 0);
select is((select count(*) from pg_temp.auto('so') where paid_on > public.current_month()), 0::bigint, 'future auto rows are removed');
select is((select count(*) from pg_temp.auto('so')), (select n from before_manual), 'past auto rows are kept');
select is((select standing_order_from from public.apartments where id = (select id from ids where k = 'so')), null::date,
  'a manual apartment has no standing order month');
select public.set_apartment_fee((select id from ids where k = 'so'), '2024-04-01', 'custom', 410);
select is((select amount from public.payments where apartment_id = (select id from ids where k = 'so')
  and source = 'auto' and paid_on = '2024-04-01'), 400::numeric, 'kept rows were collected: a later fee change leaves them');

-- ---------------------------------------------------------------- fee field: building / custom / unchanged
insert into ids select 'fee', public.save_apartment(null, 962, null, null, 360, false, 'manual', null, false, 0);
select is((select count(*) from public.apartment_fee_overrides where apartment_id = (select id from ids where k = 'fee')),
  0::bigint, 'a fee equal to the building rate stays on the building rate');
select public.save_apartment((select id from ids where k = 'fee'), 962, null, null, 450, false, 'manual', null, false, 0);
select is((select row(fee_mode, amount)::text from public.apartment_fee_at((select id from ids where k = 'fee'), public.current_month())),
  '(custom,450.00)', 'another amount sets a custom fee from the current month');
select is((select effective_from from public.apartment_fee_overrides where apartment_id = (select id from ids where k = 'fee')),
  public.current_month(), 'the change takes effect from the current month');
select public.save_apartment((select id from ids where k = 'fee'), 962, 3, null, 450, false, 'manual', null, false, 0);
select is((select count(*) from public.apartment_fee_overrides where apartment_id = (select id from ids where k = 'fee')),
  1::bigint, 'saving the same fee writes nothing to the timeline');

-- ---------------------------------------------------------------- committee flag in sync with the exemption
select public.save_apartment((select id from ids where k = 'fee'), 962, 3, null, 450, true, 'manual', null, false, 0);
select is((select row(a.is_committee, f.fee_mode)::text from public.apartments a,
  public.apartment_fee_at(a.id, public.current_month()) f where a.id = (select id from ids where k = 'fee')),
  '(t,exempt)', 'committee: flag set and exempt from the current month');
select public.save_apartment((select id from ids where k = 'fee'), 962, 3, null, 450, false, 'manual', null, false, 0);
select is((select row(a.is_committee, f.fee_mode, f.amount)::text from public.apartments a,
  public.apartment_fee_at(a.id, public.current_month()) f where a.id = (select id from ids where k = 'fee')),
  '(f,custom,450.00)', 'unchecking clears the flag and applies the restored fee');

-- An exemption that isn't the committee's (e.g. imported) is kept while the fee field is left empty.
select public.set_apartment_fee((select id from ids where k = 'fee'), public.current_month(), 'exempt', null);
select public.save_apartment((select id from ids where k = 'fee'), 962, 3, null, null, false, 'manual', null, false, 0);
select is((select fee_mode from public.apartment_fee_at((select id from ids where k = 'fee'), public.current_month())),
  'exempt', 'a timeline exemption is kept when the fee field is empty');

-- ---------------------------------------------------------------- EV charger
insert into ids select 'ev', public.save_apartment(null, 963, null, null, null, false, 'manual', null, true, 1234.56);
select is((select row(initial_reading, active)::text from public.ev_chargers where apartment_id = (select id from ids where k = 'ev')),
  '(1234.56,t)', 'save_apartment creates the charger with its initial reading');
select public.save_apartment((select id from ids where k = 'ev'), 963, null, null, null, false, 'manual', null, true, 0);
select public.save_apartment((select id from ids where k = 'ev'), 963, null, null, null, false, 'manual', null, false, 0);
select is((select count(*) from public.ev_chargers where apartment_id = (select id from ids where k = 'ev')), 1::bigint,
  'an existing charger is neither duplicated nor removed');
select is((select initial_reading from public.ev_chargers where apartment_id = (select id from ids where k = 'ev')), 1234.56::numeric,
  'and its initial reading is left alone');

-- ---------------------------------------------------------------- standing order starting this month (default)
insert into ids select 'now', public.save_apartment(null, 964, null, null, null, false, 'standing_order', null, false, 0);
select is((select standing_order_from from public.apartments where id = (select id from ids where k = 'now')),
  public.current_month(), 'the standing order defaults to the current month');
select is((select count(*) from pg_temp.auto('now')), 1::bigint, 'and pays the current month right away');

select * from finish();
rollback;
