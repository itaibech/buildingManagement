-- Polls (0031): one vote per apartment, revote replaces, the window and state checks, scope, no voting for another
-- apartment, admin-recorded votes, result visibility, the frozen result on close, archived apartments excluded,
-- drafts hidden, the 'polls' permission, anon and pending denied.
-- Own fixtures inside a rolled-back transaction: a separate building with 6 apartments (no. 6 archived).
begin;
create extension if not exists pgtap with schema extensions;

select plan(71);

-- ---------------------------------------------------------------- fixtures (as postgres)
-- a1 admin; r1 and r1b both live in apartment 1; r2 in 2; r0 approved without an apartment; pd pending, linked to 3.
insert into auth.users (id, email, aud, role) values
  ('a3100000-0000-0000-0000-000000000001', 'poll-admin@test.local', 'authenticated', 'authenticated'),
  ('a3100000-0000-0000-0000-000000000002', 'poll-r1@test.local', 'authenticated', 'authenticated'),
  ('a3100000-0000-0000-0000-000000000003', 'poll-r1b@test.local', 'authenticated', 'authenticated'),
  ('a3100000-0000-0000-0000-000000000004', 'poll-r2@test.local', 'authenticated', 'authenticated'),
  ('a3100000-0000-0000-0000-000000000005', 'poll-r0@test.local', 'authenticated', 'authenticated'),
  ('a3100000-0000-0000-0000-000000000006', 'poll-pending@test.local', 'authenticated', 'authenticated');
insert into public.buildings (id, name) values ('b3100000-0000-0000-0000-000000000001', 'בניין סקרים');
insert into public.apartments (id, building_id, number)
select ('b3100000-0000-0000-0000-00000000000' || n)::uuid, 'b3100000-0000-0000-0000-000000000001', n from generate_series(1, 6) n;
update public.apartments set archived_at = now() - interval '1 day' where id = 'b3100000-0000-0000-0000-000000000006';
insert into public.residents (id, building_id, apartment_id, full_name) values
  ('c3100000-0000-0000-0000-000000000001', 'b3100000-0000-0000-0000-000000000001', 'b3100000-0000-0000-0000-000000000001', 'דייר אחד'),
  ('c3100000-0000-0000-0000-000000000002', 'b3100000-0000-0000-0000-000000000001', 'b3100000-0000-0000-0000-000000000001', 'דיירת אחת'),
  ('c3100000-0000-0000-0000-000000000003', 'b3100000-0000-0000-0000-000000000001', 'b3100000-0000-0000-0000-000000000002', 'דייר שתיים'),
  ('c3100000-0000-0000-0000-000000000004', 'b3100000-0000-0000-0000-000000000001', 'b3100000-0000-0000-0000-000000000003', 'ממתין');
update public.profiles set building_id = 'b3100000-0000-0000-0000-000000000001', status = 'approved'
  where user_id::text like 'a3100000-%';
update public.profiles set role = 'admin' where user_id = 'a3100000-0000-0000-0000-000000000001';
update public.profiles set resident_id = 'c3100000-0000-0000-0000-000000000001' where user_id = 'a3100000-0000-0000-0000-000000000002';
update public.profiles set resident_id = 'c3100000-0000-0000-0000-000000000002' where user_id = 'a3100000-0000-0000-0000-000000000003';
update public.profiles set resident_id = 'c3100000-0000-0000-0000-000000000003' where user_id = 'a3100000-0000-0000-0000-000000000004';
update public.profiles set resident_id = 'c3100000-0000-0000-0000-000000000004', status = 'pending'
  where user_id = 'a3100000-0000-0000-0000-000000000006';
-- The test building's default group, with the default keys (as the migration grants them in every building).
insert into public.user_groups (id, building_id, name, is_default)
values ('d3100000-0000-0000-0000-000000000001', 'b3100000-0000-0000-0000-000000000001', 'דייר', true);
insert into public.group_permissions (group_id, permission) values
  ('d3100000-0000-0000-0000-000000000001', 'polls'), ('d3100000-0000-0000-0000-000000000001', 'announcements');

-- ---------------------------------------------------------------- catalog, privileges, RLS
select is((select label from public.permissions where key = 'polls'), 'סקרים', 'catalog: the polls key');
select ok(exists (select 1 from public.group_permissions gp join public.user_groups g on g.id = gp.group_id
  where g.is_default and g.building_id = public.default_building_id() and gp.permission = 'polls'), 'the default group has polls');
select ok(not has_function_privilege('anon', 'public.cast_poll_vote(uuid, int)', 'execute'), 'anon may not execute cast_poll_vote');
select ok(not has_function_privilege('anon', 'public.admin_record_vote(uuid, uuid, int)', 'execute'), 'anon may not execute admin_record_vote');
select ok(not has_function_privilege('anon', 'public.poll_results(uuid)', 'execute'), 'anon may not execute poll_results');
select ok(not has_function_privilege('anon', 'public.open_poll(uuid)', 'execute'), 'anon may not execute open_poll');
select ok(not has_function_privilege('authenticated', 'public.poll_write_vote(uuid, uuid, int, boolean)', 'execute'),
  'poll_write_vote is internal');
select ok(not has_function_privilege('authenticated', 'public.poll_tally(uuid)', 'execute'), 'poll_tally is internal');
select ok(not has_function_privilege('anon', 'public.poll_options_ok(text, text[])', 'execute'), 'anon may not execute poll_options_ok');
select is((select prosecdef from pg_proc where oid = 'public.cast_poll_vote(uuid, int)'::regprocedure), true, 'cast_poll_vote is security definer');
select is((select proconfig from pg_proc where oid = 'public.cast_poll_vote(uuid, int)'::regprocedure), array['search_path=""'],
  'cast_poll_vote pins an empty search_path');
select ok((select bool_and(relrowsecurity) from pg_class where oid in ('public.polls'::regclass, 'public.poll_votes'::regclass,
  'public.poll_apartments'::regclass)), 'RLS on polls, poll_votes and poll_apartments');

-- ---------------------------------------------------------------- admin creates polls
set local role authenticated;
set local request.jwt.claims = '{"sub":"a3100000-0000-0000-0000-000000000001","role":"authenticated"}';
-- q1: yes/no, every apartment, 2/3 of the building, live. q2: apartments 2 and 3 only. q3: results after closing.
-- q4: opens tomorrow. q5: a draft to delete.
select set_config('t.q1', public.save_poll('  תחזוקת מתקן החניה  ', 'פירוט', 'yes_no', array['ignored'], now(), now() + interval '7 days',
  'two_thirds', 'building', 'all', 'live', 50)::text, true);
select set_config('t.q2', public.save_poll('מעלון חניה', '', 'single_choice', array[' חברה א ', 'חברה ב'], now(), now() + interval '7 days',
  'simple', 'eligible', 'selected', 'live', null, array['b3100000-0000-0000-0000-000000000002', 'b3100000-0000-0000-0000-000000000003',
  'b3100000-0000-0000-0000-000000000006']::uuid[])::text, true);
select set_config('t.q3', public.save_poll('צבע הלובי', '', 'yes_no', '{}', now(), now() + interval '7 days',
  'percent', 'building', 'all', 'after_close', 60)::text, true);
select set_config('t.q4', public.save_poll('בעתיד', '', 'yes_no', '{}', now() + interval '1 day', now() + interval '2 days',
  'simple', 'building', 'all', 'live')::text, true);
select set_config('t.q5', public.save_poll('למחיקה', '', 'yes_no', '{}', now(), now() + interval '2 days',
  'simple', 'building', 'all', 'live')::text, true);
select is((select (question, options, majority_percent, status) from public.polls where id = current_setting('t.q1')::uuid),
  ('תחזוקת מתקן החניה'::text, '{}'::text[], null::int, 'draft'::text), 'save_poll trims, drops yes/no options and an unused percent; a draft');
select is((select options from public.polls where id = current_setting('t.q2')::uuid), array['חברה א', 'חברה ב'], 'options are trimmed');
select is((select array_agg(a.number order by a.number) from public.poll_apartments s join public.apartments a on a.id = s.apartment_id
  where s.poll_id = current_setting('t.q2')::uuid), array[2, 3], 'the scope keeps active apartments only');
select throws_like($$select public.save_poll('ריק', '', 'yes_no', '{}', now(), now() + interval '1 day', 'simple', 'building',
  'selected', 'live', null, '{}')$$, 'poll:empty_scope%', 'a selected scope needs an apartment');
select throws_ok($$select public.save_poll('אפשרות אחת', '', 'single_choice', array['רק אחת'], now(), now() + interval '1 day', 'simple',
  'building', 'all', 'live')$$, '23514', null, 'single choice needs 2–10 options');
select throws_ok($$select public.save_poll('כפולות', '', 'single_choice', array['חברה א', ' חברה א '], now(), now() + interval '1 day', 'simple',
  'building', 'all', 'live')$$, '23514', null, 'option labels must differ after trimming');
select throws_ok($$select public.save_poll('הפוך', '', 'yes_no', '{}', now(), now() - interval '1 day', 'simple', 'building',
  'all', 'live')$$, '23514', null, 'closing must come after opening');

-- ---------------------------------------------------------------- drafts are the admin's
set local request.jwt.claims = '{"sub":"a3100000-0000-0000-0000-000000000002","role":"authenticated"}';
select is((select count(*)::int from public.polls where id::text = any (array[current_setting('t.q1'), current_setting('t.q5')])), 0,
  'residents do not see drafts');
select throws_like($$select public.cast_poll_vote(current_setting('t.q1')::uuid, 0)$$, 'poll:not_found%', 'no voting on a draft');
select throws_ok($$select public.open_poll(current_setting('t.q1')::uuid)$$, '42501', null, 'a resident cannot open a poll');
select throws_ok($$select public.save_poll('של דייר', '', 'yes_no', '{}', now(), now() + interval '1 day', 'simple', 'building',
  'all', 'live')$$, '42501', null, 'a resident cannot create a poll');

set local request.jwt.claims = '{"sub":"a3100000-0000-0000-0000-000000000001","role":"authenticated"}';
select isnt(public.open_poll(current_setting('t.q1')::uuid), null, 'open_poll returns the announcement');
select public.open_poll(current_setting('t.q2')::uuid);
select public.open_poll(current_setting('t.q3')::uuid);
select public.open_poll(current_setting('t.q4')::uuid);
select is((select (a.link, a.title) from public.announcements a join public.polls p on p.announcement_id = a.id
  where p.id = current_setting('t.q1')::uuid), ('/polls/' || current_setting('t.q1'), 'סקר חדש: תחזוקת מתקן החניה'::text),
  'opening posts an announcement linking to the poll');
select ok((select body like '%ההצבעה תיפתח ב-%ותיסגר ב-%' from public.announcements a join public.polls p on p.announcement_id = a.id
  where p.id = current_setting('t.q4')::uuid), 'a poll opening later announces its start time');
select ok((select body like '%ההצבעה פתוחה עד %' from public.announcements a join public.polls p on p.announcement_id = a.id
  where p.id = current_setting('t.q1')::uuid), 'a poll open now announces its end only');
select ok((select body like '%הסקר מיועד לדירות: 2, 3%' from public.announcements a join public.polls p on p.announcement_id = a.id
  where p.id = current_setting('t.q2')::uuid), 'the announcement names a selected scope');
select throws_like($$select public.open_poll(current_setting('t.q1')::uuid)$$, 'poll:state%', 'an open poll cannot be opened again');
select throws_like($$select public.save_poll('שינוי', '', 'yes_no', '{}', now(), now() + interval '1 day',
  'simple', 'building', 'all', 'live', p_poll => current_setting('t.q1')::uuid)$$, 'poll:not_draft%', 'an open poll cannot be edited');

-- ---------------------------------------------------------------- one vote per apartment, revote replaces
set local request.jwt.claims = '{"sub":"a3100000-0000-0000-0000-000000000002","role":"authenticated"}';
select is((select count(*)::int from public.polls where id = current_setting('t.q1')::uuid), 1, 'residents see an open poll');
select lives_ok($$select public.cast_poll_vote(current_setting('t.q1')::uuid, 0)$$, 'r1 votes for apartment 1');
set local request.jwt.claims = '{"sub":"a3100000-0000-0000-0000-000000000003","role":"authenticated"}';
select lives_ok($$select public.cast_poll_vote(current_setting('t.q1')::uuid, 1)$$, 'r1b (same apartment) votes too');
select is((select (count(*), min(choice), bool_and(voted_by = 'a3100000-0000-0000-0000-000000000003')) from public.poll_votes
  where poll_id = current_setting('t.q1')::uuid and apartment_id = 'b3100000-0000-0000-0000-000000000001'), (1::bigint, 1::smallint, true),
  'one vote for the apartment: the second user''s vote replaced the first, stamped with who');
set local request.jwt.claims = '{"sub":"a3100000-0000-0000-0000-000000000002","role":"authenticated"}';
select public.cast_poll_vote(current_setting('t.q1')::uuid, 0);
select is((select choice from public.poll_votes where poll_id = current_setting('t.q1')::uuid), 0::smallint, 'a revote replaces the choice');
select throws_like($$select public.cast_poll_vote(current_setting('t.q1')::uuid, 3)$$, 'poll:bad_choice%', 'yes/no has choices 0–2 only');

-- ---------------------------------------------------------------- never for another apartment
set local request.jwt.claims = '{"sub":"a3100000-0000-0000-0000-000000000004","role":"authenticated"}';
select public.cast_poll_vote(current_setting('t.q1')::uuid, 1);
set local request.jwt.claims = '{"sub":"a3100000-0000-0000-0000-000000000002","role":"authenticated"}';
select is((select count(*)::int from public.poll_votes), 1, 'a resident sees their own apartment''s vote only');
select throws_ok($$select public.admin_record_vote(current_setting('t.q1')::uuid, 'b3100000-0000-0000-0000-000000000002', 0)$$, '42501', null,
  'a resident cannot record a vote for another apartment');
select throws_ok($$insert into public.poll_votes (poll_id, apartment_id, choice) values (current_setting('t.q1')::uuid,
  'b3100000-0000-0000-0000-000000000002', 0)$$, '42501', null, 'no direct insert into poll_votes');
update public.poll_votes set choice = 0 where apartment_id = 'b3100000-0000-0000-0000-000000000002';
update public.polls set status = 'closed' where id = current_setting('t.q1')::uuid;
reset role;
select is((select choice from public.poll_votes where poll_id = current_setting('t.q1')::uuid
  and apartment_id = 'b3100000-0000-0000-0000-000000000002'), 1::smallint, 'a resident cannot change another apartment''s vote');
select is((select status from public.polls where id = current_setting('t.q1')::uuid), 'open', 'nor write polls directly');

-- ---------------------------------------------------------------- who may vote
set local role authenticated;
set local request.jwt.claims = '{"sub":"a3100000-0000-0000-0000-000000000005","role":"authenticated"}';
select throws_like($$select public.cast_poll_vote(current_setting('t.q1')::uuid, 0)$$, 'poll:no_apartment%', 'no apartment link: refused');
set local request.jwt.claims = '{"sub":"a3100000-0000-0000-0000-000000000006","role":"authenticated"}';
select throws_ok($$select public.cast_poll_vote(current_setting('t.q1')::uuid, 0)$$, '42501', null, 'a pending user is refused');
select is((select count(*)::int from public.polls), 0, 'a pending user sees no polls');
reset role;
set local role anon;
set local request.jwt.claims = '{"role":"anon"}';
select throws_ok($$select public.cast_poll_vote(current_setting('t.q1')::uuid, 0)$$, '42501', null, 'anon cannot vote');
select is((select count(*)::int from public.polls) + (select count(*)::int from public.poll_votes), 0, 'anon sees no polls or votes');
reset role;
set local role authenticated;

-- ---------------------------------------------------------------- scope and window
set local request.jwt.claims = '{"sub":"a3100000-0000-0000-0000-000000000002","role":"authenticated"}';
select throws_like($$select public.cast_poll_vote(current_setting('t.q2')::uuid, 0)$$, 'poll:out_of_scope%', 'out of scope: refused');
select throws_like($$select public.cast_poll_vote(current_setting('t.q4')::uuid, 0)$$, 'poll:not_started%', 'before opens_at: refused');
set local request.jwt.claims = '{"sub":"a3100000-0000-0000-0000-000000000004","role":"authenticated"}';
select lives_ok($$select public.cast_poll_vote(current_setting('t.q2')::uuid, 1)$$, 'in scope: accepted');
reset role;
update public.polls set opens_at = now() - interval '2 days', closes_at = now() - interval '1 second' where id = current_setting('t.q3')::uuid;
set local role authenticated;
select throws_like($$select public.cast_poll_vote(current_setting('t.q3')::uuid, 0)$$, 'poll:ended%', 'after closes_at: refused');
select ok(not (public.poll_results(current_setting('t.q3')::uuid) ? 'counts'),
  'after_close: ended but not closed, a resident still gets no counts');
reset role;
update public.polls set opens_at = now(), closes_at = now() + interval '7 days' where id = current_setting('t.q3')::uuid;
set local role authenticated;

-- ---------------------------------------------------------------- admin records on behalf of an apartment
set local request.jwt.claims = '{"sub":"a3100000-0000-0000-0000-000000000001","role":"authenticated"}';
select lives_ok($$select public.admin_record_vote(current_setting('t.q1')::uuid, 'b3100000-0000-0000-0000-000000000003', 2)$$,
  'the admin records apartment 3''s vote');
select is((select (by_admin, voted_by) from public.poll_votes where poll_id = current_setting('t.q1')::uuid
  and apartment_id = 'b3100000-0000-0000-0000-000000000003'), (true, 'a3100000-0000-0000-0000-000000000001'::uuid), 'marked as recorded by the committee');
select throws_like($$select public.admin_record_vote(current_setting('t.q1')::uuid, 'b3100000-0000-0000-0000-000000000006', 0)$$,
  'poll:out_of_scope%', 'an archived apartment cannot vote');
select throws_like($$select public.admin_record_vote(current_setting('t.q2')::uuid, 'b3100000-0000-0000-0000-000000000001', 0)$$,
  'poll:out_of_scope%', 'nor an apartment outside the scope');
select is((select count(*)::int from public.poll_votes where poll_id = current_setting('t.q1')::uuid), 3, 'admins see every vote');
select public.admin_record_vote(current_setting('t.q3')::uuid, 'b3100000-0000-0000-0000-000000000004', 0);

-- ---------------------------------------------------------------- results
select is(public.poll_results(current_setting('t.q1')::uuid), '{"counts": [1, 1, 1], "voted": 3, "eligible": 5, "building": 5}'::jsonb,
  'tally: counts per choice, participation and bases (the archived apartment excluded)');
select is(public.poll_results(current_setting('t.q2')::uuid), '{"counts": [0, 1], "voted": 1, "eligible": 2, "building": 5}'::jsonb,
  'tally of a scoped poll');
set local request.jwt.claims = '{"sub":"a3100000-0000-0000-0000-000000000002","role":"authenticated"}';
select is(public.poll_results(current_setting('t.q1')::uuid) -> 'counts', '[1, 1, 1]'::jsonb, 'live results for residents');
select is(public.poll_results(current_setting('t.q3')::uuid), '{"voted": 1, "eligible": 5, "building": 5}'::jsonb,
  'after_close: residents see participation only while open');

-- ---------------------------------------------------------------- closing freezes
select throws_ok($$select public.close_poll(current_setting('t.q1')::uuid)$$, '42501', null, 'a resident cannot close a poll');
set local request.jwt.claims = '{"sub":"a3100000-0000-0000-0000-000000000001","role":"authenticated"}';
select is(public.close_poll(current_setting('t.q1')::uuid) -> 'voted', '3'::jsonb, 'close_poll returns the frozen tally');
select is((select final_result -> 'outcome' from public.polls where id = current_setting('t.q1')::uuid),
  '{"reached": false, "required": 4, "base": 5, "top": 1, "next": 1, "leader": null, "tie": true}'::jsonb,
  'the outcome is stored at closing (2/3 of 5 = 4, one for)');
select is((select expires_at from public.announcements a join public.polls p on p.announcement_id = a.id
  where p.id = current_setting('t.q1')::uuid), (now() at time zone 'Asia/Jerusalem')::date - 1, 'closing expires the announcement');
select public.close_poll(current_setting('t.q3')::uuid);
select throws_like($$select public.admin_record_vote(current_setting('t.q1')::uuid, 'b3100000-0000-0000-0000-000000000004', 0)$$,
  'poll:closed%', 'no votes recorded after closing');
set local request.jwt.claims = '{"sub":"a3100000-0000-0000-0000-000000000002","role":"authenticated"}';
select throws_like($$select public.cast_poll_vote(current_setting('t.q1')::uuid, 1)$$, 'poll:closed%', 'a closed poll refuses votes');
select is(public.poll_results(current_setting('t.q3')::uuid) -> 'counts', '[1, 0, 0]'::jsonb, 'after_close: counts once closed');
reset role;
update public.apartments set archived_at = now() where id = 'b3100000-0000-0000-0000-000000000002';
set local role authenticated;
select is(public.poll_results(current_setting('t.q1')::uuid) - 'outcome', '{"counts": [1, 1, 1], "voted": 3, "eligible": 5, "building": 5}'::jsonb,
  'the closed result stays frozen when an apartment is archived later');
select is(public.poll_results(current_setting('t.q2')::uuid) -> 'voted', '0'::jsonb, 'an open poll drops a newly archived apartment');

-- ---------------------------------------------------------------- delete drafts only
delete from public.polls where id = current_setting('t.q5')::uuid;
set local request.jwt.claims = '{"sub":"a3100000-0000-0000-0000-000000000001","role":"authenticated"}';
select is((select count(*)::int from public.polls where id = current_setting('t.q5')::uuid), 1, 'a resident cannot delete a poll');
delete from public.polls where id::text = any (array[current_setting('t.q5'), current_setting('t.q1')]);
select is((select array_agg(id::text) from public.polls where id::text = any (array[current_setting('t.q5'), current_setting('t.q1')])),
  array[current_setting('t.q1')], 'the admin deletes a draft, never a held poll');

reset role;
select * from finish();
rollback;
