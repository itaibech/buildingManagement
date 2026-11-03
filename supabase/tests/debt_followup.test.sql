-- Automatic debt follow-up (0035): step selection by days overdue (oldest unpaid month, settlement_plan), skips,
-- once per debt episode, the 09:00 Israel gate of the hourly job, admin-only RLS and the function grants.
-- Independent of seed.sql: wipes finance rows and apartments inside a rolled-back transaction.
begin;
create extension if not exists pgtap with schema extensions;

select plan(76);

insert into auth.users (id, email, aud, role) values
  ('a9350000-0000-0000-0000-000000000001', 'fu-admin@test.local', 'authenticated', 'authenticated'),
  ('a9350000-0000-0000-0000-000000000002', 'fu-res@test.local', 'authenticated', 'authenticated'),
  ('a9350000-0000-0000-0000-000000000003', 'fu-pending@test.local', 'authenticated', 'authenticated');
update public.profiles set role = 'admin', status = 'approved' where user_id = 'a9350000-0000-0000-0000-000000000001';

delete from public.debt_followups;
delete from public.debt_followup_settings;
delete from public.ev_readings;
delete from public.ev_chargers;
delete from public.charges;
delete from public.apartment_billing;
delete from public.payments;
delete from public.apartment_fee_overrides;
delete from public.fee_schedule;
delete from public.apartments;
-- Billing from two months ago with a building fee of 0: only apartment 987 (standing order) pays a fee.
update public.buildings set billing_start = (public.current_month() - interval '2 months')::date;
insert into public.fee_schedule (building_id, effective_from, amount)
values (public.default_building_id(), (public.current_month() - interval '2 months')::date, 0);

create function pg_temp.m(n int) returns date language sql as $$ select (public.current_month() - make_interval(months => n))::date $$;
grant execute on function pg_temp.m(int) to authenticated;

insert into public.apartments (id, number) values
  ('b9350000-0000-0000-0000-000000000980', 980), ('b9350000-0000-0000-0000-000000000981', 981),
  ('b9350000-0000-0000-0000-000000000982', 982), ('b9350000-0000-0000-0000-000000000983', 983),
  ('b9350000-0000-0000-0000-000000000984', 984), ('b9350000-0000-0000-0000-000000000985', 985),
  ('b9350000-0000-0000-0000-000000000986', 986), ('b9350000-0000-0000-0000-000000000987', 987),
  ('b9350000-0000-0000-0000-000000000988', 988);
insert into public.residents (id, apartment_id, full_name) values
  ('c9350000-0000-0000-0000-000000000001', 'b9350000-0000-0000-0000-000000000980', 'דיירת 980');
update public.profiles set status = 'approved', resident_id = 'c9350000-0000-0000-0000-000000000001'
  where user_id = 'a9350000-0000-0000-0000-000000000002';
insert into public.group_permissions (group_id, permission)
select g.id, 'finance_own' from public.user_groups g where g.is_default on conflict do nothing;

-- Thresholds far apart so "today" can't cross them: step 1 from 1 day, step 2 from 200, step 3 from 400.
--   980  300 from last month                         → step 1 (28-61 days)
--   981  300 from 8 months ago                       → step 2 (≥ 240)
--   982  300 from 15 months ago                      → step 3 (≥ 450): a task, no email
--   983  30 from 8 months ago                        → below the ₪50 minimum
--   984  300 from 8 months ago, exempt               → skipped
--   985  300 from 8 months ago, archived             → skipped
--   986  300 from 15 months ago paid in full (partial payments: the 300 of last month is what's left) → step 1
--   987  standing order, fee 100 a month, all paid by the order → no debt
--   988  300 from 8 months ago                       → step 2; later the arrears are paid and a newer month opens
insert into public.charges (apartment_id, month, amount, kind, label) values
  ('b9350000-0000-0000-0000-000000000980', pg_temp.m(1), 300, 'extra', 'x'),
  ('b9350000-0000-0000-0000-000000000981', pg_temp.m(8), 300, 'extra', 'x'),
  ('b9350000-0000-0000-0000-000000000982', pg_temp.m(15), 300, 'extra', 'x'),
  ('b9350000-0000-0000-0000-000000000983', pg_temp.m(8), 30, 'extra', 'x'),
  ('b9350000-0000-0000-0000-000000000984', pg_temp.m(8), 300, 'extra', 'x'),
  ('b9350000-0000-0000-0000-000000000985', pg_temp.m(8), 300, 'extra', 'x'),
  ('b9350000-0000-0000-0000-000000000986', pg_temp.m(15), 300, 'extra', 'x'),
  ('b9350000-0000-0000-0000-000000000986', pg_temp.m(1), 300, 'extra', 'x'),
  ('b9350000-0000-0000-0000-000000000988', pg_temp.m(8), 300, 'extra', 'x');
insert into public.payments (apartment_id, paid_on, for_month, amount, method) values
  ('b9350000-0000-0000-0000-000000000986', pg_temp.m(1), pg_temp.m(15), 200, 'cash'),
  ('b9350000-0000-0000-0000-000000000986', pg_temp.m(1), pg_temp.m(15), 100, 'cash');
insert into public.apartment_fee_overrides (apartment_id, effective_from, mode)
values ('b9350000-0000-0000-0000-000000000984', pg_temp.m(15), 'exempt');
insert into public.apartment_fee_overrides (apartment_id, effective_from, mode, amount)
values ('b9350000-0000-0000-0000-000000000987', pg_temp.m(2), 'custom', 100);
insert into public.apartment_billing (apartment_id, payment_method, standing_order_from)
values ('b9350000-0000-0000-0000-000000000987', 'standing_order', pg_temp.m(2));
do $$ begin perform public.apply_standing_orders(); end $$;
update public.apartments set archived_at = now() where id = 'b9350000-0000-0000-0000-000000000985';

create function pg_temp.rows(p_number int) returns text language sql as $$
  select coalesce(string_agg(f.step || ':' || f.status || coalesce(':' || f.skip_reason, ''), ','
    order by f.episode_closed_at is null, f.step, f.status), '')
  from public.debt_followups f join public.apartments a on a.id = f.apartment_id where a.number = p_number
$$;
grant execute on function pg_temp.rows(int) to authenticated;
-- 09:30 today in Israel (the run's clock), so days overdue match the ledger's current month.
create function pg_temp.nine() returns timestamptz language sql as $$
  select (date_trunc('day', now() at time zone 'Asia/Jerusalem') + interval '9 hours 30 minutes') at time zone 'Asia/Jerusalem'
$$;
create function pg_temp.ready(p_claim boolean) returns int[] language sql as $$
  select coalesce(array_agg(a.number order by a.number), '{}')
  from public.debt_followups_ready(public.default_building_id(), p_claim) r join public.apartments a on a.id = r.apartment_id
$$;
create function pg_temp.fid(p_number int, p_status text) returns uuid language sql as $$
  select f.id from public.debt_followups f join public.apartments a on a.id = f.apartment_id
  where a.number = p_number and f.status = p_status and f.step in (1, 2) limit 1
$$;
grant execute on function pg_temp.fid(int, text) to authenticated;

-- ---------------------------------------------------------------- shape and grants
select ok((select relrowsecurity from pg_class where oid = 'public.debt_followups'::regclass), 'debt_followups: RLS enabled');
select ok((select relrowsecurity from pg_class where oid = 'public.debt_followup_settings'::regclass), 'debt_followup_settings: RLS enabled');
select is((select count(*)::int from public.debt_followup_settings), 0, 'settings: no row until an admin saves');
insert into public.debt_followup_settings (building_id) values (public.default_building_id());
select ok(not (select enabled from public.debt_followup_settings), 'settings: enabled defaults to false');
select throws_ok($$update public.debt_followup_settings set firm_days = 5$$, '23514', null, 'settings: steps must be in order');
select throws_ok($$update public.debt_followup_settings set firm_days = 366$$, '23514', null, 'settings: firm at most 365 days');
select lives_ok($$insert into public.email_log (building_id, kind) values (public.default_building_id(), 'debt_followup')$$,
  'email_log: kind debt_followup');
select lives_ok($$insert into public.email_log (building_id, kind, ref_id) values (public.default_building_id(), 'contact', gen_random_uuid())$$,
  'email_log: the kinds of earlier migrations are kept');
select ok(not has_function_privilege('authenticated', 'public.debt_followup_cron(timestamptz)', 'execute')
  and not has_function_privilege('anon', 'public.debt_followup_cron(timestamptz)', 'execute'), 'cron function: no API role executes it');
select ok(not has_function_privilege('authenticated', 'public.debt_followup_run(uuid, timestamptz)', 'execute')
  and not has_function_privilege('anon', 'public.debt_followup_run(uuid, timestamptz)', 'execute')
  and not has_function_privilege('authenticated', 'public.debt_followup_sweep(uuid, timestamptz)', 'execute')
  and not has_function_privilege('authenticated', 'public.debt_followup_candidates(uuid, timestamptz)', 'execute')
  and not has_function_privilege('authenticated', 'public.debt_followup_sendable(uuid)', 'execute')
  and not has_function_privilege('anon', 'public.debt_followup_sendable(uuid)', 'execute'), 'run / sweep / candidates / sendable: internal');
select ok(has_function_privilege('service_role', 'public.debt_followups_ready(uuid, boolean)', 'execute')
  and not has_function_privilege('authenticated', 'public.debt_followups_ready(uuid, boolean)', 'execute')
  and not has_function_privilege('anon', 'public.debt_followups_ready(uuid, boolean)', 'execute'), 'ready: service role only');
select ok(has_function_privilege('service_role', 'public.finish_debt_followups(uuid, uuid[], jsonb, uuid)', 'execute')
  and not has_function_privilege('authenticated', 'public.finish_debt_followups(uuid, uuid[], jsonb, uuid)', 'execute'), 'finish: service role only');
select ok(has_function_privilege('authenticated', 'public.refresh_debt_followups()', 'execute')
  and not has_function_privilege('anon', 'public.refresh_debt_followups()', 'execute'), 'refresh: authenticated (admin checked inside), not anon');
select is((select count(*)::int from cron.job where jobname = 'debt-followup' and schedule = '5 * * * *'), 1, 'pg_cron: hourly job scheduled');

-- ---------------------------------------------------------------- the 09:00 Israel gate (DST)
select ok(public.debt_followup_due_hour('2026-01-15 07:30+00'), '07:30 UTC in winter = 09:30 Israel (UTC+2): due');
select ok(not public.debt_followup_due_hour('2026-01-15 06:30+00'), '06:30 UTC in winter = 08:30 Israel: not yet');
select ok(public.debt_followup_due_hour('2026-07-15 06:30+00'), '06:30 UTC in summer = 09:30 Israel (UTC+3): due');
select ok(not public.debt_followup_due_hour('2026-07-15 07:30+00'), '07:30 UTC in summer = 10:30 Israel: past');

-- ---------------------------------------------------------------- off by default
select is(public.debt_followup_run(public.default_building_id()) ->> 'enabled', 'false', 'off: the run does nothing');
select is(public.debt_followup_cron(pg_temp.nine()), 0, 'off: the 09:00 job skips the building');
select is((select count(*)::int from public.debt_followups), 0, 'off: no rows');

-- ---------------------------------------------------------------- the run
update public.debt_followup_settings set enabled = true, friendly_days = 1, firm_days = 200, letter_days = 400;
select is(pg_temp.ready(false), '{}'::int[], 'ready: nothing recorded yet');
select is(public.debt_followup_cron(pg_temp.nine() + interval '2 hours'), 0, '11:30 Israel: the hourly job waits');
select is(public.debt_followup_cron(pg_temp.nine()), 1, '09:30 Israel: the job runs');
select is(pg_temp.rows(980), '1:pending', '980: last month → step 1 email, pending');
select is(pg_temp.rows(981), '2:pending', '981: 8 months → only step 2 (no friendly email first)');
select is(pg_temp.rows(982), '3:open', '982: 15 months → the admin task, no email');
select is(pg_temp.rows(983) || pg_temp.rows(984) || pg_temp.rows(985) || pg_temp.rows(987), '',
  'below the minimum, exempt, archived, standing order without real debt → nothing');
select is(pg_temp.rows(986), '1:pending', '986: partial payments cleared the old month → days from last month (step 1)');
select is((select oldest_month from public.debt_followups f join public.apartments a on a.id = f.apartment_id where a.number = 986),
  pg_temp.m(1), '986: oldest unpaid month follows settlement_plan');
select is((select row(debt_amount, oldest_month)::text from public.debt_followups f join public.apartments a on a.id = f.apartment_id where a.number = 981),
  row(300.00::numeric(12,2), pg_temp.m(8))::text, 'a row records the debt and the oldest month');

select is((public.debt_followup_run(public.default_building_id()) ->> 'created')::int, 0, 'once per episode: a second run adds nothing');
select throws_ok($$insert into public.debt_followups (building_id, apartment_id, step, status, debt_amount, oldest_month, days_overdue)
  values (public.default_building_id(), 'b9350000-0000-0000-0000-000000000981', 2, 'pending', 1, public.current_month(), 0)$$,
  '23505', null, 'unique: a step once per open episode');

-- A higher step supersedes a pending lower one.
update public.debt_followup_settings set firm_days = 20;
select is((public.debt_followup_run(public.default_building_id()) ->> 'created')::int, 2, 'firm from 20 days: 980 and 986 move to step 2');
select is(pg_temp.rows(980), '1:skipped:superseded,2:pending', '980: the pending friendly email is superseded');

-- ---------------------------------------------------------------- ready: read only (preview, dry run)
select is(pg_temp.ready(false), '{980,981,986,988}'::int[], 'ready (read): the pending emails, no task');
-- 986 pays in full; 988 pays its arrears and a newer month opens: neither may get the step-2 email.
insert into public.payments (apartment_id, paid_on, for_month, amount, method) values
  ('b9350000-0000-0000-0000-000000000986', public.current_month(), pg_temp.m(1), 300, 'cash'),
  ('b9350000-0000-0000-0000-000000000988', public.current_month(), pg_temp.m(8), 300, 'cash');
insert into public.charges (apartment_id, month, amount, kind, label)
values ('b9350000-0000-0000-0000-000000000988', pg_temp.m(1), 300, 'extra', 'חודש חדש');
select is(pg_temp.ready(false), '{980,981}'::int[], 'ready (read): a paid debt and a stale step (arrears paid, newer month open) are not sendable');
select is(pg_temp.rows(986) || ' ' || pg_temp.rows(988), '1:skipped:superseded,2:pending 2:pending', 'ready (read): writes nothing');
select is((select count(*)::int from public.debt_followups where status = 'sending'), 0, 'ready (read): claims nothing');

-- ---------------------------------------------------------------- ready: claim (a real send)
select is(pg_temp.ready(true), '{980,981}'::int[], 'ready (claim): claims the sendable rows');
select is(pg_temp.ready(true), '{}'::int[], 'ready (claim): a second, concurrent send gets nothing');
select is(pg_temp.ready(false), '{}'::int[], 'ready (read): claimed rows are not pending');
select is(pg_temp.rows(986), '1:skipped:superseded,2:skipped:paid', '986: the claim''s sweep skipped it as paid');
select is(pg_temp.rows(988), '2:skipped:paid', '988: the episode of the paid arrears closed; no step-2 email');
select ok((select bool_and(episode_closed_at is not null) from public.debt_followups
  where apartment_id in ('b9350000-0000-0000-0000-000000000986', 'b9350000-0000-0000-0000-000000000988')), '986, 988: episodes closed');
-- A send that died after claiming 980 (maybe after delivering): never re-queued, flagged for review.
update public.debt_followups set claimed_at = now() - interval '20 minutes' where id = pg_temp.fid(980, 'sending');
select is(pg_temp.ready(true), '{}'::int[], 'ready (claim): a claim older than 15 minutes is not claimed again');
select is(pg_temp.rows(980), '1:skipped:superseded,2:review', 'a stuck claim becomes review (unknown whether sent)');
select throws_ok($$insert into public.debt_followups (building_id, apartment_id, step, status, debt_amount, oldest_month, days_overdue)
  values (public.default_building_id(), 'b9350000-0000-0000-0000-000000000980', 2, 'pending', 1, public.current_month(), 0)$$,
  '23505', null, 'review counts for the episode: the step is not recorded again');
select is(public.finish_debt_followups(public.default_building_id(), array[pg_temp.fid(980, 'review')], '{}', null), 0,
  'finish: never touches a review row');
select is(pg_temp.rows(980), '1:skipped:superseded,2:review', 'still review');
-- The admin checked the email log: not sent, re-queue it.
set local role authenticated;
set local request.jwt.claims = '{"sub":"a9350000-0000-0000-0000-000000000002","role":"authenticated"}';
select throws_ok($$select public.resolve_debt_followup((select id from public.debt_followups limit 1), false)$$, '42501', null,
  'resident: resolve is admin only');
set local request.jwt.claims = '{"sub":"a9350000-0000-0000-0000-000000000001","role":"authenticated"}';
select ok(public.resolve_debt_followup(pg_temp.fid(980, 'review'), false), 'admin: re-queues a review row');
reset role;
select is(pg_temp.ready(true), '{980}'::int[], 'ready (claim): the re-queued row is claimed again');
select is(public.finish_debt_followups(public.default_building_id(),
  array[pg_temp.fid(980, 'sending'), pg_temp.fid(981, 'sending')],
  jsonb_build_object(pg_temp.fid(981, 'sending')::text, 2),
  (select id from public.email_log where kind = 'debt_followup' limit 1)), 1, 'finish: one sent');
select is(pg_temp.rows(981) || ' ' || pg_temp.rows(980), '2:sent 1:skipped:superseded,2:pending',
  'finish: the sent one is sent; the other (failed, deferred or no email) is pending again');
select is((select count(*)::int from public.debt_followups where status = 'sending'), 0, 'finish: no claim left');
-- A claimed row whose episode closed during the send is not released to pending.
select is(pg_temp.ready(true), '{980}'::int[], 'claim 980 again');
update public.debt_followups set episode_closed_at = now() where id = pg_temp.fid(980, 'sending');
select is(public.finish_debt_followups(public.default_building_id(), array[pg_temp.fid(980, 'sending')], '{}', null), 0, 'finish: nothing sent');
select is((select status || ':' || skip_reason from public.debt_followups where apartment_id = 'b9350000-0000-0000-0000-000000000980' and step = 2),
  'skipped:paid', 'finish: released into a closed episode → skipped, not pending');
-- A pending row left in a closed episode is cleaned by the sweep.
update public.debt_followups set status = 'pending', skip_reason = null
where apartment_id = 'b9350000-0000-0000-0000-000000000980' and step = 2;
select ok(public.debt_followup_sweep(public.default_building_id()) >= 1, 'sweep runs');
select is((select status || ':' || skip_reason from public.debt_followups where apartment_id = 'b9350000-0000-0000-0000-000000000980' and step = 2),
  'skipped:paid', 'sweep: a pending row of a closed episode → skipped');
update public.debt_followups set episode_closed_at = null where apartment_id = 'b9350000-0000-0000-0000-000000000980';
update public.debt_followups set status = 'pending', skip_reason = null
where apartment_id = 'b9350000-0000-0000-0000-000000000980' and step = 2;

-- ---------------------------------------------------------------- stale steps
-- The firm email's threshold is raised past 980's days: its pending step 2 is stale, never sent.
update public.debt_followup_settings set firm_days = 300;
select is(pg_temp.ready(false), '{}'::int[], 'ready: a step no longer due (threshold raised) is not sendable');
select is((public.debt_followup_run(public.default_building_id()) ->> 'created')::int, 2, 'run: 980 and 988 (new episode) get step 1');
select is(pg_temp.rows(980), '1:pending,1:skipped:superseded,2:skipped:stale', '980: step 2 skipped as stale; step 1 now');
select is(pg_temp.rows(988), '2:skipped:paid,1:pending', '988: the newer debt starts its own episode at step 1');
select is(pg_temp.rows(981), '2:sent', '981: a sent step still counts (no step 1 after it)');

-- A new debt after payoff is a new episode: the steps start over.
insert into public.charges (apartment_id, month, amount, kind, label)
values ('b9350000-0000-0000-0000-000000000986', pg_temp.m(1), 300, 'extra', 'חדש');
select is((public.debt_followup_run(public.default_building_id()) ->> 'created')::int, 1, 'new debt after payoff: one row');
select is(pg_temp.rows(986), '1:skipped:superseded,2:skipped:paid,1:pending', '986: new episode → step 1 again');

-- ---------------------------------------------------------------- RLS
set local role anon;
select throws_ok($$select count(*) from public.debt_followups$$, '42501', null, 'anon: no access to debt_followups');
select throws_ok($$select count(*) from public.debt_followup_settings$$, '42501', null, 'anon: no access to the settings');

set local role authenticated;
set local request.jwt.claims = '{"sub":"a9350000-0000-0000-0000-000000000002","role":"authenticated"}';
select is((select count(*)::int from public.debt_followups) + (select count(*)::int from public.debt_followup_settings), 0,
  'resident: sees no follow-ups and no settings (not even their own apartment''s)');
select throws_ok($$select public.refresh_debt_followups()$$, '42501', null, 'resident: refresh is admin only');

set local request.jwt.claims = '{"sub":"a9350000-0000-0000-0000-000000000003","role":"authenticated"}';
select is((select count(*)::int from public.debt_followups), 0, 'pending user: sees nothing');

set local request.jwt.claims = '{"sub":"a9350000-0000-0000-0000-000000000001","role":"authenticated"}';
select is((select count(*)::int from public.debt_followups), 10, 'admin: reads every follow-up');
select ok(public.complete_debt_followup_task((select id from public.debt_followups where step = 3)), 'admin: closes the step-3 task');
select throws_ok($$update public.debt_followups set status = 'sent'$$, '42501', null, 'admin: no direct writes to follow-ups');

reset role;
select * from finish();
rollback;
