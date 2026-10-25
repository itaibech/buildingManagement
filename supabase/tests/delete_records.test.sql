-- Deleting users and apartments (0022): admin_audit, user FKs keep history, apartment archive / restore,
-- apartment_history() counts and delete_apartment_cascade().
-- Independent of seed.sql: wipes finance rows and apartments inside a rolled-back transaction.
begin;
create extension if not exists pgtap with schema extensions;

select plan(31);

insert into auth.users (id, email, aud, role) values
  ('a9900000-0000-0000-0000-000000000001', 'del-admin@test.local', 'authenticated', 'authenticated'),
  ('a9900000-0000-0000-0000-000000000002', 'del-res@test.local', 'authenticated', 'authenticated');
update public.profiles set role = 'admin', status = 'approved' where user_id = 'a9900000-0000-0000-0000-000000000001';

delete from public.ev_readings;
delete from public.ev_chargers;
delete from public.charges;
delete from public.apartment_billing;
delete from public.payments;
delete from public.apartment_fee_overrides;
delete from public.fee_schedule;
delete from public.meetings;
delete from public.apartments;
update public.buildings set billing_start = (public.current_month() - interval '3 months')::date;
insert into public.fee_schedule (amount, effective_from) values (100, '2020-01-01');

insert into public.apartments (id, number) values
  ('b9900000-0000-0000-0000-00000000000a', 990), ('b9900000-0000-0000-0000-00000000000b', 991),
  ('b9900000-0000-0000-0000-00000000000c', 992);
insert into public.residents (id, apartment_id, full_name) values
  ('c9900000-0000-0000-0000-000000000001', 'b9900000-0000-0000-0000-00000000000a', 'דיירת בדיקה'),
  ('c9900000-0000-0000-0000-000000000002', 'b9900000-0000-0000-0000-00000000000c', 'דייר ריק');
update public.profiles set status = 'approved', resident_id = 'c9900000-0000-0000-0000-000000000001'
  where user_id = 'a9900000-0000-0000-0000-000000000002';
insert into public.payments (apartment_id, paid_on, amount, method) values
  ('b9900000-0000-0000-0000-00000000000a', public.current_month(), 100, 'cash');
insert into public.ev_chargers (apartment_id, initial_reading) values ('b9900000-0000-0000-0000-00000000000a', 0);
insert into public.ev_readings (charger_id, month, reading)
  select id, public.current_month(), 50 from public.ev_chargers where apartment_id = 'b9900000-0000-0000-0000-00000000000a';
insert into public.apartment_billing (apartment_id, payment_method, standing_order_from)
  values ('b9900000-0000-0000-0000-00000000000b', 'standing_order', public.current_month());
insert into public.meetings (id, title, scheduled_at, status, opened_at, closed_at)
  values ('e9900000-0000-0000-0000-000000000001', 'ישיבה סגורה', now() - interval '1 day', 'closed', now() - interval '1 day', now());
insert into public.meeting_attendance (meeting_id, apartment_id, status)
  values ('e9900000-0000-0000-0000-000000000001', 'b9900000-0000-0000-0000-00000000000a', 'present');
select public.apply_standing_orders();

-- ---------------------------------------------------------------- schema: history survives a deleted user
select has_table('public', 'admin_audit', 'admin_audit exists');
select has_column('public', 'apartments', 'archived_at', 'apartments.archived_at');
select is((select count(*)::int from pg_constraint c where c.contype = 'f' and c.confrelid = 'auth.users'::regclass
  and c.conrelid::regclass::text not like 'auth.%' and c.confdeltype not in ('n', 'c')), 0,
  'every FK to auth.users is on delete set null / cascade, so deleting a user never fails');
select is((select count(*)::int from pg_constraint c join pg_attribute a on a.attrelid = c.conrelid and a.attnum = any (c.conkey)
  where c.contype = 'f' and c.confrelid = 'auth.users'::regclass and c.confdeltype = 'c'
    and c.conrelid::regclass::text not like 'auth.%'
    and a.attname in ('opened_by', 'author_id', 'sent_by', 'recorded_by', 'created_by', 'actor', 'last_activity_by')), 0,
  'no authorship column cascades: history keeps its rows when a user is deleted');
select ok(not has_table_privilege('authenticated', 'public.admin_audit', 'insert'), 'API users cannot write admin_audit');

-- ---------------------------------------------------------------- residents cannot
set local role authenticated;
set local request.jwt.claims = '{"sub":"a9900000-0000-0000-0000-000000000002","role":"authenticated"}';
select throws_ok($$select public.archive_apartment('b9900000-0000-0000-0000-00000000000a')$$, '42501', null,
  'a resident cannot archive an apartment');
select throws_ok($$select public.delete_apartment_cascade('b9900000-0000-0000-0000-00000000000a', 990)$$, '42501', null,
  'a resident cannot delete an apartment with its history');
select throws_ok($$select public.apartment_history('b9900000-0000-0000-0000-00000000000a')$$, '42501', null,
  'a resident cannot read the history counts');
select is((select count(*)::int from public.admin_audit), 0, 'a resident reads no audit rows');

-- ---------------------------------------------------------------- admin: counts
set local request.jwt.claims = '{"sub":"a9900000-0000-0000-0000-000000000001","role":"authenticated"}';
select is(public.apartment_history('b9900000-0000-0000-0000-00000000000a') - 'tickets' - 'meetings',
  '{"residents": 1, "payments": 1, "charges": 0, "ev_readings": 1}'::jsonb, 'history counts per kind');
select is((public.apartment_history('b9900000-0000-0000-0000-00000000000c') ->> 'payments')::int, 0, 'an empty apartment has no payments');

-- ---------------------------------------------------------------- archive: hidden from balances, fees stop
select lives_ok($$select public.archive_apartment('b9900000-0000-0000-0000-00000000000b')$$, 'admin archives an apartment');
select isnt((select archived_at from public.apartments where id = 'b9900000-0000-0000-0000-00000000000b'), null, 'archived_at is set');
select is((select count(*)::int from public.apartment_balances where apartment_id = 'b9900000-0000-0000-0000-00000000000b'), 0,
  'an archived apartment is hidden from the balances');
select is((select apartments_total from public.collection_summary(public.current_month())), 2,
  'an archived apartment is not in the collection summary');
reset role;
update public.apartments set archived_at = (public.current_month() - interval '2 months')::timestamptz
  where id = 'b9900000-0000-0000-0000-00000000000b';
select is((select max(month) from public.monthly_fees where apartment_id = 'b9900000-0000-0000-0000-00000000000b'),
  (public.current_month() - interval '2 months')::date, 'monthly fees stop after the archive month');
select is((select count(*)::int from public.monthly_fees where apartment_id = 'b9900000-0000-0000-0000-00000000000b'), 2,
  'past months stay (for reports)');
select public.apply_standing_orders();
select is((select count(*)::int from public.payments where apartment_id = 'b9900000-0000-0000-0000-00000000000b' and source = 'auto'), 0,
  'no standing-order payment after the archive');
set local role authenticated;
set local request.jwt.claims = '{"sub":"a9900000-0000-0000-0000-000000000001","role":"authenticated"}';
select lives_ok($$select public.restore_apartment('b9900000-0000-0000-0000-00000000000b')$$, 'admin restores it');
select is((select count(*)::int from public.apartment_balances where apartment_id = 'b9900000-0000-0000-0000-00000000000b'), 1,
  'a restored apartment is back in the balances');
select is((select array_agg(action order by created_at, action) from public.admin_audit
  where apartment_id = 'b9900000-0000-0000-0000-00000000000b'), array['archive_apartment', 'restore_apartment'],
  'archive and restore are logged');

-- ---------------------------------------------------------------- cascade delete
select throws_ok($$select public.delete_apartment_cascade('b9900000-0000-0000-0000-00000000000a', 991)$$, '22023', null,
  'the wrong confirm number is refused');
select is((select count(*)::int from public.apartments where id = 'b9900000-0000-0000-0000-00000000000a'), 1, 'nothing was deleted');
select ok((public.delete_apartment_cascade('b9900000-0000-0000-0000-00000000000a', 990) -> 'paths') = '[]'::jsonb,
  'the cascade delete returns the storage paths to remove');
select is((select count(*)::int from public.apartments where id = 'b9900000-0000-0000-0000-00000000000a'), 0, 'the apartment is gone');
select is((select count(*)::int from public.payments where apartment_id = 'b9900000-0000-0000-0000-00000000000a'), 0, 'its payments are gone');
select is((select count(*)::int from public.ev_readings), 0, 'its EV readings are gone');
select is((select count(*)::int from public.residents where id = 'c9900000-0000-0000-0000-000000000001'), 0, 'its residents are gone');
select is((select details ->> 'number' from public.admin_audit where action = 'delete_apartment'
  and apartment_id = 'b9900000-0000-0000-0000-00000000000a'), '990', 'the cascade delete is logged with the number');
reset role;
select is((select row(apartment_id, apartment_number)::text from public.meeting_attendance
  where meeting_id = 'e9900000-0000-0000-0000-000000000001'), '(,990)', 'a closed protocol keeps the deleted apartment''s number');
select is((select resident_id from public.profiles where user_id = 'a9900000-0000-0000-0000-000000000002'), null::uuid,
  'the resident''s login stays, unlinked');

select * from finish();
rollback;
