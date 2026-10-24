-- Email audit log (0020, Task 23): admin-only reads, no API writes, email_sent_today() for the daily cap.
-- Independent of seed.sql: everything runs inside a rolled-back transaction.
begin;
create extension if not exists pgtap with schema extensions;

select plan(14);

insert into auth.users (id, email, aud, role) values
  ('a9900000-0000-0000-0000-000000000001', 'mail-admin@test.local', 'authenticated', 'authenticated'),
  ('a9900000-0000-0000-0000-000000000002', 'mail-res@test.local', 'authenticated', 'authenticated');
update public.profiles set role = 'admin', status = 'approved' where user_id = 'a9900000-0000-0000-0000-000000000001';
update public.profiles set status = 'approved' where user_id = 'a9900000-0000-0000-0000-000000000002';
delete from public.email_log;

-- Server-side rows (the Edge Function writes with the service role): two real sends today, a dry run today,
-- a real send yesterday (Israel time).
insert into public.email_log (building_id, sent_by, kind, recipients, sent, failed, skipped, dry_run, created_at) values
  (public.default_building_id(), 'a9900000-0000-0000-0000-000000000001', 'announcement', 5, 5, 0, 0, false, now()),
  (public.default_building_id(), 'a9900000-0000-0000-0000-000000000001', 'debt', 3, 2, 1, 1, false, now()),
  (public.default_building_id(), 'a9900000-0000-0000-0000-000000000001', 'ticket', 9, 0, 0, 0, true, now()),
  (public.default_building_id(), 'a9900000-0000-0000-0000-000000000001', 'test', 1, 1, 0, 0, false,
    (date_trunc('day', now() at time zone 'Asia/Jerusalem') - interval '1 minute') at time zone 'Asia/Jerusalem');

-- ---------------------------------------------------------------- shape
select ok((select relrowsecurity from pg_class where oid = 'public.email_log'::regclass), 'email_log: RLS enabled');
select throws_ok(
  $$insert into public.email_log (building_id, kind) values (public.default_building_id(), 'sms')$$,
  '23514', null, 'kind: only announcement / ticket / debt / test');
select throws_ok(
  $$insert into public.email_log (building_id, kind, sent) values (public.default_building_id(), 'test', -1)$$,
  '23514', null, 'counts: never negative');

-- ---------------------------------------------------------------- daily cap counter
select is(public.email_sent_today(), 7, 'email_sent_today: real sends since Israel midnight (dry runs and yesterday excluded)');

-- ---------------------------------------------------------------- resident
set local role authenticated;
set local request.jwt.claims = '{"sub":"a9900000-0000-0000-0000-000000000002","role":"authenticated"}';
select is((select count(*)::int from public.email_log), 0, 'resident: reads no email_log rows');
select throws_ok(
  $$insert into public.email_log (building_id, kind) values (public.default_building_id(), 'test')$$,
  '42501', null, 'resident: cannot insert');
select throws_ok($$select public.email_sent_today()$$, '42501', null, 'resident: cannot call email_sent_today');

-- ---------------------------------------------------------------- admin
set local request.jwt.claims = '{"sub":"a9900000-0000-0000-0000-000000000001","role":"authenticated"}';
select is((select count(*)::int from public.email_log), 4, 'admin: reads every email_log row');
select throws_ok(
  $$insert into public.email_log (building_id, kind) values (public.default_building_id(), 'test')$$,
  '42501', null, 'admin: cannot insert from the API (only the Edge Function''s service role)');
select throws_ok($$update public.email_log set sent = 99$$, '42501', null, 'admin: cannot update rows');
select throws_ok($$delete from public.email_log$$, '42501', null, 'admin: cannot delete rows');
select throws_ok($$select public.email_sent_today()$$, '42501', null, 'admin: email_sent_today is server-only');

-- ---------------------------------------------------------------- anon / service role
set local role anon;
select throws_ok($$select count(*) from public.email_log$$, '42501', null, 'anon: no access');
reset role;
set local role service_role;
select is(public.email_sent_today(), 7, 'service_role: may call email_sent_today');
reset role;

select * from finish();
rollback;
