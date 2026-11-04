-- Maintenance reminders (0038): the private cron config (no API access), the once-only log, admin-only RLS on the
-- settings and the log, the 08:00 Israel gate of the hourly pg_cron → pg_net job and the function grants.
begin;
create extension if not exists pgtap with schema extensions;

select plan(36);

insert into auth.users (id, email, aud, role) values
  ('a9380000-0000-0000-0000-000000000001', 'mr-admin@test.local', 'authenticated', 'authenticated'),
  ('a9380000-0000-0000-0000-000000000002', 'mr-res@test.local', 'authenticated', 'authenticated');
update public.profiles set role = 'admin', status = 'approved' where user_id = 'a9380000-0000-0000-0000-000000000001';
update public.profiles set status = 'approved' where user_id = 'a9380000-0000-0000-0000-000000000002';

-- ---------------------------------------------------------------- private config
select has_table('private', 'cron_config', 'private.cron_config exists');
select is((select count(*)::int from private.cron_config), 1, 'one config row');
select ok((select secret ~ '^[0-9a-f]{64}$' from private.cron_config), 'a random 32-byte secret was generated in the database');
select is((select functions_url from private.cron_config), null, 'no functions_url until the deploy sets it');
select ok(not has_schema_privilege('anon', 'private', 'usage') and not has_schema_privilege('authenticated', 'private', 'usage'),
  'private schema: no usage for the API roles');
select ok(not has_table_privilege('anon', 'private.cron_config', 'select')
  and not has_table_privilege('authenticated', 'private.cron_config', 'select')
  and not has_table_privilege('authenticated', 'private.cron_config', 'update'), 'cron_config: no access for anon / authenticated');
select ok(not has_function_privilege('anon', 'public.cron_reminders_secret()', 'execute')
  and not has_function_privilege('authenticated', 'public.cron_reminders_secret()', 'execute'), 'cron_reminders_secret: not for the API users');
select ok(has_function_privilege('service_role', 'public.cron_reminders_secret()', 'execute'), 'cron_reminders_secret: the function''s service role');
select is(public.cron_reminders_secret(), (select secret from private.cron_config), 'cron_reminders_secret returns the stored secret');
select throws_ok($$update private.cron_config set functions_url = 'javascript:alert(1)'$$, '23514', null, 'functions_url must be http(s)');

-- ---------------------------------------------------------------- functions: grants and search_path
select ok(not has_function_privilege('anon', 'public.maintenance_reminders_cron(timestamptz)', 'execute')
  and not has_function_privilege('authenticated', 'public.maintenance_reminders_cron(timestamptz)', 'execute'),
  'cron function: no API role executes it');
select ok(not has_function_privilege('authenticated', 'public.maintenance_reminders_due_hour(timestamptz)', 'execute'),
  'due-hour helper: not for the API users');
select is((select array_agg(p.proname::text order by p.proname) from pg_proc p
  where p.pronamespace = 'public'::regnamespace and p.proname in ('cron_reminders_secret', 'maintenance_reminders_cron', 'maintenance_reminders_due_hour')
    and coalesce('search_path=""' = any (p.proconfig), false)),
  array['cron_reminders_secret', 'maintenance_reminders_cron', 'maintenance_reminders_due_hour'], 'every new function pins search_path to empty');
select is((select command from cron.job where jobname = 'maintenance-reminders'), 'select public.maintenance_reminders_cron()',
  'the scheduled command carries no secret (read inside the function)');

-- ---------------------------------------------------------------- the job (pg_cron → pg_net)
select is((select count(*)::int from cron.job where jobname = 'maintenance-reminders' and schedule = '10 * * * *'), 1, 'pg_cron: hourly job scheduled');
select is(public.maintenance_reminders_cron('2026-11-04 06:10+00'), null, 'no functions_url (local / CI): the job does nothing');
select is((select count(*)::int from net.http_request_queue), 0, 'nothing queued');
update private.cron_config set functions_url = 'https://abcdefghijklmnopqrst.supabase.co/functions/v1';
select is(public.maintenance_reminders_cron('2026-11-04 09:10+00'), null, '11:10 Israel: the hourly job waits');
select isnt(public.maintenance_reminders_cron('2026-11-04 06:10+00'), null, '08:10 Israel in winter (UTC+2): the job calls');
select isnt(public.maintenance_reminders_cron('2026-07-04 05:10+00'), null, '08:10 Israel in summer (UTC+3): the job calls');
select is(public.maintenance_reminders_cron('2026-07-04 06:10+00'), null, '09:10 Israel in summer: the job waits');
select is((select count(*)::int from net.http_request_queue
  where method = 'POST' and url = 'https://abcdefghijklmnopqrst.supabase.co/functions/v1/cron-reminders'
    and headers ->> 'x-cron-secret' = (select secret from private.cron_config)), 2, 'POSTs to cron-reminders with the x-cron-secret header');

-- ---------------------------------------------------------------- email kind
select lives_ok($$insert into public.email_log (building_id, kind, recipients) values (public.default_building_id(), 'maintenance_reminder', 1)$$,
  'email_log accepts maintenance_reminder');
select lives_ok($$insert into public.email_log (building_id, kind, recipients) values (public.default_building_id(), 'debt_followup', 1)$$,
  'earlier kinds are kept');

-- ---------------------------------------------------------------- the log: once only
insert into public.maintenance_reminders_log (building_id, item_kind, item_id, title, due_on, offset_days, sent_on)
values (public.default_building_id(), 'task', 'd9380000-0000-0000-0000-000000000001', 'בדיקת מז"חים', '2026-11-11', 7, '2026-11-04');
select throws_ok($$insert into public.maintenance_reminders_log (building_id, item_kind, item_id, title, due_on, offset_days, sent_on)
  values (public.default_building_id(), 'task', 'd9380000-0000-0000-0000-000000000001', 'x', '2026-11-11', 7, '2026-11-05')$$,
  '23505', null, 'the same item, due date and offset is logged once');
select lives_ok($$insert into public.maintenance_reminders_log (building_id, item_kind, item_id, title, due_on, offset_days, sent_on)
  values (public.default_building_id(), 'task', 'd9380000-0000-0000-0000-000000000001', 'x', '2026-11-11', 1, '2026-11-10')$$,
  'another offset of the same due date is its own reminder');
select throws_ok($$insert into public.maintenance_reminders_log (building_id, item_kind, item_id, title, due_on, offset_days, sent_on)
  values (public.default_building_id(), 'task', 'd9380000-0000-0000-0000-000000000002', 'x', '2026-11-11', -2, '2026-11-10')$$,
  '23514', null, 'offset_days: -1 (overdue) to 60');

-- ---------------------------------------------------------------- RLS
set local role anon;
select throws_ok('select * from public.maintenance_reminders_log', '42501', null, 'anon: no log');
select throws_ok('select * from public.maintenance_reminder_settings', '42501', null, 'anon: no settings');

set local role authenticated;
set local request.jwt.claims = '{"sub":"a9380000-0000-0000-0000-000000000002","role":"authenticated"}';
select is((select count(*)::int from public.maintenance_reminders_log), 0, 'resident: sees no log rows');
select throws_ok($$insert into public.maintenance_reminder_settings (building_id) values (public.default_building_id())$$,
  '42501', null, 'resident: cannot write the settings');

set local request.jwt.claims = '{"sub":"a9380000-0000-0000-0000-000000000001","role":"authenticated"}';
select is((select count(*)::int from public.maintenance_reminders_log), 2, 'admin: sees the building''s log');
select throws_ok($$insert into public.maintenance_reminders_log (building_id, item_kind, item_id, title, due_on, offset_days, sent_on)
  values (public.default_building_id(), 'task', gen_random_uuid(), 'x', '2026-11-11', 7, '2026-11-04')$$,
  '42501', null, 'admin: the log is written by the function only');
select lives_ok($$insert into public.maintenance_reminder_settings (building_id, enabled, days_before, include_overdue)
  values (public.default_building_id(), true, '{14,3}', false)$$, 'admin: saves the settings');
select throws_ok($$update public.maintenance_reminder_settings set days_before = '{0}'$$, '23514', null, 'days before: 1-60');
select is((select days_before from public.maintenance_reminder_settings), '{14,3}'::int[], 'admin: reads the settings back');

reset role;
select * from finish();
rollback;
