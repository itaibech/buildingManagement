-- Email audit log (0020, Task 23): admin-only reads, no API writes, email_sent_today() and the atomic quota
-- reservation behind the daily cap. Independent of seed.sql: everything runs inside a rolled-back transaction.
begin;
create extension if not exists pgtap with schema extensions;

select plan(26);

insert into auth.users (id, email, aud, role) values
  ('a9900000-0000-0000-0000-000000000001', 'mail-admin@test.local', 'authenticated', 'authenticated'),
  ('a9900000-0000-0000-0000-000000000002', 'mail-res@test.local', 'authenticated', 'authenticated');
update public.profiles set role = 'admin', status = 'approved' where user_id = 'a9900000-0000-0000-0000-000000000001';
update public.profiles set status = 'approved' where user_id = 'a9900000-0000-0000-0000-000000000002';
delete from public.email_log;

create temp table ids (k text primary key, v uuid) on commit drop;
grant select on ids to authenticated, anon;
insert into ids values ('b', public.default_building_id()), ('admin', 'a9900000-0000-0000-0000-000000000001');

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
select throws_ok(
  $$insert into public.email_log (building_id, kind, status) values (public.default_building_id(), 'test', 'sent')$$,
  '23514', null, 'status: only pending / done');

-- ---------------------------------------------------------------- daily counter
select is(public.email_sent_today((select v from ids where k = 'b')), 7,
  'email_sent_today: real sends since Israel midnight (dry runs and yesterday excluded)');
select is(public.email_sent_today(gen_random_uuid()), 0, 'email_sent_today: per building');

-- ---------------------------------------------------------------- reservation (cap 20, 7 used)
select isnt(public.reserve_email_quota((select v from ids where k = 'b'), 8, 20, 'announcement', (select v from ids where k = 'admin')),
  null, 'reserve: 8 fits under 20 (7 used) → a row id');
select is((select row(status, recipients, sent)::text from public.email_log where status = 'pending'), '(pending,8,0)',
  'reserve: inserts a pending row with the reserved count');
select is(public.email_sent_today((select v from ids where k = 'b')), 15, 'pending rows count every reserved recipient');
-- A second, concurrent-style reservation sees the first one (not yet delivered) and must not overshoot the cap.
select is(public.reserve_email_quota((select v from ids where k = 'b'), 6, 20, 'debt', (select v from ids where k = 'admin')),
  null, 'reserve: a second reservation that would pass the cap is refused');
select isnt(public.reserve_email_quota((select v from ids where k = 'b'), 5, 20, 'debt', (select v from ids where k = 'admin')),
  null, 'reserve: exactly up to the cap is allowed');
select is(public.email_sent_today((select v from ids where k = 'b')), 20, 'cap reached: 20 of 20');
select is(public.reserve_email_quota((select v from ids where k = 'b'), 1, 20, 'test', (select v from ids where k = 'admin')),
  null, 'reserve: nothing more once the cap is reached');
-- Finalizing frees what wasn't sent.
update public.email_log set status = 'done', sent = 3, failed = 5 where recipients = 8 and status = 'pending';
select is(public.email_sent_today((select v from ids where k = 'b')), 15, 'done: counts only what was actually sent');
-- A stale pending row (a send that died) keeps counting in full: conservative.
update public.email_log set created_at = now() - interval '20 minutes' where status = 'pending';
select is(public.email_sent_today((select v from ids where k = 'b')), 15, 'stale pending rows still count in full');
select throws_ok(
  $$select public.reserve_email_quota((select v from ids where k = 'b'), 0, 20, 'test', null)$$,
  '22023', null, 'reserve: the count must be positive');

-- ---------------------------------------------------------------- resident
set local role authenticated;
set local request.jwt.claims = '{"sub":"a9900000-0000-0000-0000-000000000002","role":"authenticated"}';
select is((select count(*)::int from public.email_log), 0, 'resident: reads no email_log rows');
select throws_ok(
  $$insert into public.email_log (building_id, kind) values (public.default_building_id(), 'test')$$,
  '42501', null, 'resident: cannot insert');
select throws_ok($$select public.email_sent_today(public.default_building_id())$$, '42501', null,
  'resident: cannot call email_sent_today');
select throws_ok($$select public.reserve_email_quota(public.default_building_id(), 1, 90, 'test', null)$$, '42501', null,
  'resident: cannot reserve quota');

-- ---------------------------------------------------------------- admin
set local request.jwt.claims = '{"sub":"a9900000-0000-0000-0000-000000000001","role":"authenticated"}';
select is((select count(*)::int from public.email_log), 6, 'admin: reads every email_log row');
select throws_ok(
  $$insert into public.email_log (building_id, kind) values (public.default_building_id(), 'test')$$,
  '42501', null, 'admin: cannot insert from the API (only the Edge Function''s service role)');
select throws_ok($$update public.email_log set sent = 99$$, '42501', null, 'admin: cannot update rows');
select throws_ok($$select public.reserve_email_quota(public.default_building_id(), 1, 90, 'test', null)$$, '42501', null,
  'admin: reserve_email_quota is server-only');

-- ---------------------------------------------------------------- anon / service role
set local role anon;
select throws_ok($$select count(*) from public.email_log$$, '42501', null, 'anon: no access');
reset role;
set local role service_role;
select is(public.email_sent_today(public.default_building_id()), 15, 'service_role: may call email_sent_today');
reset role;

select * from finish();
rollback;
