-- Editing the protocol before publication (0028): reopen_meeting on a closed, unsigned meeting without addenda;
-- refusals per state; residents and anon denied; attendance and agenda editable after reopening and locked after
-- re-closing; the original closing time kept; no arrival stamps during the correction.
-- Own fixtures inside a rolled-back transaction (a separate building with 5 apartments).
begin;
create extension if not exists pgtap with schema extensions;

select plan(36);

insert into auth.users (id, email, aud, role) values
  ('a2800000-0000-0000-0000-000000000001', 'reopen-admin@test.local', 'authenticated', 'authenticated'),
  ('a2800000-0000-0000-0000-000000000002', 'reopen-res@test.local', 'authenticated', 'authenticated');
update public.profiles set role = 'admin', status = 'approved' where user_id = 'a2800000-0000-0000-0000-000000000001';
update public.profiles set status = 'approved' where user_id = 'a2800000-0000-0000-0000-000000000002';
insert into public.buildings (id, name) values ('b2800000-0000-0000-0000-000000000001', 'בניין תיקונים');
insert into public.apartments (id, building_id, number)
select ('b2800000-0000-0000-0000-00000000000' || n)::uuid, 'b2800000-0000-0000-0000-000000000001', n from generate_series(1, 5) n;
update public.profiles set building_id = 'b2800000-0000-0000-0000-000000000001'
  where user_id in ('a2800000-0000-0000-0000-000000000001', 'a2800000-0000-0000-0000-000000000002');

-- e1: the meeting to correct (run through the RPCs). e2 signed, e3 with an addendum, e4 published, e5 draft,
-- e6 invited: written directly as the owner (the guards don't apply to it).
insert into public.meetings (id, building_id, kind, title, scheduled_at, quorum_mode) values
  ('e2800000-0000-0000-0000-000000000001', 'b2800000-0000-0000-0000-000000000001', 'committee', 'ועד לתיקון', now(), 'none'),
  ('e2800000-0000-0000-0000-000000000005', 'b2800000-0000-0000-0000-000000000001', 'committee', 'טיוטה', now() + interval '9 days', 'none');
insert into public.meetings (id, building_id, kind, title, scheduled_at, quorum_mode, status, invited_at, opened_at, closed_at, published_at,
  chair_name, secretary_name) values
  ('e2800000-0000-0000-0000-000000000002', 'b2800000-0000-0000-0000-000000000001', 'committee', 'חתומה', now() - interval '3 hours', 'none', 'closed',
    null, now() - interval '3 hours', now() - interval '2 hours', null, 'יו"ר', 'רושם'),
  ('e2800000-0000-0000-0000-000000000003', 'b2800000-0000-0000-0000-000000000001', 'committee', 'עם תיקון', now() - interval '3 hours', 'none', 'closed',
    null, now() - interval '3 hours', now() - interval '2 hours', null, 'יו"ר', 'רושם'),
  ('e2800000-0000-0000-0000-000000000004', 'b2800000-0000-0000-0000-000000000001', 'committee', 'פורסמה', now() - interval '3 hours', 'none', 'published',
    null, now() - interval '3 hours', now() - interval '2 hours', now() - interval '1 hour', 'יו"ר', 'רושם'),
  ('e2800000-0000-0000-0000-000000000006', 'b2800000-0000-0000-0000-000000000001', 'committee', 'זומנה', now() + interval '9 days', 'none', 'invited',
    now(), null, null, null, '', '');
insert into public.meeting_signatures (meeting_id, role, signer_name, image_path) values ('e2800000-0000-0000-0000-000000000002', 'chair', 'יו"ר',
  'e2800000-0000-0000-0000-000000000002/0b9a54c4-3e1f-4b8e-9f0a-2c6d1e7f8a90.png');
insert into public.meeting_agenda_items (meeting_id, position, title) values ('e2800000-0000-0000-0000-000000000001', 1, 'אישור תקציב');

-- ---------------------------------------------------------------- privileges
select ok(not has_function_privilege('anon', 'public.reopen_meeting(uuid)', 'execute'), 'anon may not execute reopen_meeting');
select ok(has_function_privilege('authenticated', 'public.reopen_meeting(uuid)', 'execute'), 'authenticated may call it (admin checked inside)');
select is((select prosecdef from pg_proc where oid = 'public.reopen_meeting(uuid)'::regprocedure), true, 'reopen_meeting is security definer');

-- ---------------------------------------------------------------- run and close e1 (opened 2 hours ago, closed 1 hour ago)
set local role authenticated;
set local request.jwt.claims = '{"sub":"a2800000-0000-0000-0000-000000000001","role":"authenticated"}';
select public.quick_start_meeting('e2800000-0000-0000-0000-000000000001', 'יו"ר', 'רושמת');
reset role;
update public.meetings set opened_at = now() - interval '2 hours' where id = 'e2800000-0000-0000-0000-000000000001';
set local role authenticated;
set local request.jwt.claims = '{"sub":"a2800000-0000-0000-0000-000000000001","role":"authenticated"}';
insert into public.meeting_attendance (meeting_id, apartment_id, status) select 'e2800000-0000-0000-0000-000000000001',
  ('b2800000-0000-0000-0000-00000000000' || n)::uuid, 'present' from generate_series(1, 2) n;
update public.meeting_agenda_items set votes_for = 2, votes_against = 0, votes_abstain = 0, decision = 'אושר'
  where meeting_id = 'e2800000-0000-0000-0000-000000000001';
select public.close_meeting('e2800000-0000-0000-0000-000000000001', now() - interval '1 hour');
create temp table orig on commit drop as select opened_at, closed_at from public.meetings where id = 'e2800000-0000-0000-0000-000000000001';

select throws_ok($$update public.meeting_attendance set status = 'present' where meeting_id = 'e2800000-0000-0000-0000-000000000001'
  and apartment_id = 'b2800000-0000-0000-0000-000000000003'$$, '42501', null, 'closed: attendance is locked');

-- ---------------------------------------------------------------- residents and anon
set local request.jwt.claims = '{"sub":"a2800000-0000-0000-0000-000000000002","role":"authenticated"}';
select throws_ok($$select public.reopen_meeting('e2800000-0000-0000-0000-000000000001')$$, '42501', null, 'a resident cannot reopen');
reset role;
set local role anon;
set local request.jwt.claims = '{"role":"anon"}';
select throws_ok($$select public.reopen_meeting('e2800000-0000-0000-0000-000000000001')$$, '42501', null, 'anon cannot reopen');
reset role;
select is((select status from public.meetings where id = 'e2800000-0000-0000-0000-000000000001'), 'closed', 'still closed after the denials');

-- ---------------------------------------------------------------- refusals
set local role authenticated;
set local request.jwt.claims = '{"sub":"a2800000-0000-0000-0000-000000000001","role":"authenticated"}';
select public.add_addendum('e2800000-0000-0000-0000-000000000003', 'תיקון');
select throws_like($$select public.reopen_meeting('e2800000-0000-0000-0000-000000000002')$$, 'meeting:signed%', 'refused once signed');
select throws_like($$select public.reopen_meeting('e2800000-0000-0000-0000-000000000003')$$, 'meeting:has_addenda%', 'refused with an addendum');
select throws_like($$select public.reopen_meeting('e2800000-0000-0000-0000-000000000004')$$, 'meeting:state%', 'refused when published');
select throws_like($$select public.reopen_meeting('e2800000-0000-0000-0000-000000000005')$$, 'meeting:state%', 'refused for a draft');
select throws_like($$select public.reopen_meeting('e2800000-0000-0000-0000-000000000006')$$, 'meeting:state%', 'refused when invited');

-- ---------------------------------------------------------------- reopen
select lives_ok($$select public.reopen_meeting('e2800000-0000-0000-0000-000000000001')$$, 'admin reopens a closed, unsigned meeting');
select is((select row(m.status, m.opened_at = o.opened_at, m.reopened_from = o.closed_at)::text
  from public.meetings m, orig o where m.id = 'e2800000-0000-0000-0000-000000000001'), '(in_progress,t,t)',
  'in progress again, opening kept, the original closing time stored');
select is((select (details ->> 'closed_at')::timestamptz from public.meeting_events
  where meeting_id = 'e2800000-0000-0000-0000-000000000001' and kind = 'reopened'), (select closed_at from orig), 'logged as reopened');
select throws_like($$select public.reopen_meeting('e2800000-0000-0000-0000-000000000001')$$, 'meeting:state%', 'refused while in progress');
select throws_ok($$update public.meetings set reopened_from = null where id = 'e2800000-0000-0000-0000-000000000001'$$, '42501', null,
  'reopened_from is RPC-only');

-- ---------------------------------------------------------------- correction: attendance without arrival stamps
select lives_ok($$update public.meeting_attendance set status = 'present', attendee_name = 'דיירת 3'
  where meeting_id = 'e2800000-0000-0000-0000-000000000001' and apartment_id = 'b2800000-0000-0000-0000-000000000003'$$,
  'attendance is editable after reopening');
select is((select row(arrived_at, left_at)::text from public.meeting_attendance where meeting_id = 'e2800000-0000-0000-0000-000000000001'
  and apartment_id = 'b2800000-0000-0000-0000-000000000003'), '(,)', 'marked present in a correction: no arrival stamp (from the opening)');
select lives_ok($$insert into public.meeting_attendance (meeting_id, apartment_id, status) values
  ('e2800000-0000-0000-0000-000000000001', 'b2800000-0000-0000-0000-000000000005', 'proxy')
  on conflict (meeting_id, apartment_id) do update set status = excluded.status$$, 'the app''s upsert works in a correction');
select is((select arrived_at from public.meeting_attendance where meeting_id = 'e2800000-0000-0000-0000-000000000001'
  and apartment_id = 'b2800000-0000-0000-0000-000000000005'), null, 'upserted as proxy: no arrival stamp');
update public.meeting_attendance set status = 'present', arrived_at = (select opened_at + interval '30 minutes' from orig)
  where meeting_id = 'e2800000-0000-0000-0000-000000000001' and apartment_id = 'b2800000-0000-0000-0000-000000000004';
select is((select arrived_at from public.meeting_attendance where meeting_id = 'e2800000-0000-0000-0000-000000000001'
  and apartment_id = 'b2800000-0000-0000-0000-000000000004'), (select opened_at + interval '30 minutes' from orig),
  'an arrival time the admin enters is kept');
select throws_like($$update public.meeting_attendance set arrived_at = now() where meeting_id = 'e2800000-0000-0000-0000-000000000001'
  and apartment_id = 'b2800000-0000-0000-0000-000000000004'$$, 'meeting:times%', 'an arrival after the original close is refused');
select lives_ok($$update public.meeting_attendance set arrived_at = null where meeting_id = 'e2800000-0000-0000-0000-000000000001'
  and apartment_id = 'b2800000-0000-0000-0000-000000000004'$$, 'the arrival time can be cleared (from the opening)');
update public.meeting_attendance set status = 'absent' where meeting_id = 'e2800000-0000-0000-0000-000000000001'
  and apartment_id = 'b2800000-0000-0000-0000-000000000002';
select is((select row(status, arrived_at, left_at)::text from public.meeting_attendance where meeting_id = 'e2800000-0000-0000-0000-000000000001'
  and apartment_id = 'b2800000-0000-0000-0000-000000000002'), '(absent,,)', 'corrected to absent: no departure stamp, absent all along');

-- ---------------------------------------------------------------- correction: agenda and votes
select lives_ok($$update public.meeting_agenda_items set votes_for = 4, votes_against = 0, votes_abstain = 0
  where meeting_id = 'e2800000-0000-0000-0000-000000000001'$$, 'votes are editable after reopening');
select is((select attendees_at_vote from public.meeting_agenda_items where meeting_id = 'e2800000-0000-0000-0000-000000000001'), 4,
  'the vote is checked against the corrected attendance');
select lives_ok($$insert into public.meeting_agenda_items (meeting_id, position, title, decision)
  values ('e2800000-0000-0000-0000-000000000001', 0, 'נושא שנשכח', 'הוחלט')$$, 'items can be added after reopening');

-- ---------------------------------------------------------------- closing again
select lives_ok($$select public.close_meeting('e2800000-0000-0000-0000-000000000001', null)$$, 'closes again');
select is((select row(m.status, m.closed_at = o.closed_at, m.reopened_from is null)::text from public.meetings m, orig o
  where m.id = 'e2800000-0000-0000-0000-000000000001'), '(closed,t,t)', 'closed again at the original closing time');
select is((select string_agg(title || '=' || decision_number, ',' order by decision_number) from public.meeting_agenda_items
  where meeting_id = 'e2800000-0000-0000-0000-000000000001'), 'נושא שנשכח=1,אישור תקציב=2', 'decisions renumbered on re-close');
select is((select count(*)::int from public.meeting_events where meeting_id = 'e2800000-0000-0000-0000-000000000001' and kind = 'closed'), 2,
  'both closes are logged');
select throws_ok($$update public.meeting_attendance set status = 'absent' where meeting_id = 'e2800000-0000-0000-0000-000000000001'
  and apartment_id = 'b2800000-0000-0000-0000-000000000003'$$, '42501', null, 're-closed: attendance is locked again');
select throws_ok($$update public.meeting_agenda_items set decision = 'שונה' where meeting_id = 'e2800000-0000-0000-0000-000000000001'$$,
  '42501', null, 're-closed: the agenda is locked again');
select throws_ok($$update public.meeting_agenda_items set votes_for = 1 where meeting_id = 'e2800000-0000-0000-0000-000000000001'$$,
  '42501', null, 're-closed: votes are locked again');

-- ---------------------------------------------------------------- a live meeting still stamps arrivals
reset role;
update public.meetings set status = 'in_progress', reopened_from = null where id = 'e2800000-0000-0000-0000-000000000006';
set local role authenticated;
set local request.jwt.claims = '{"sub":"a2800000-0000-0000-0000-000000000001","role":"authenticated"}';
insert into public.meeting_attendance (meeting_id, apartment_id, status, arrived_at)
  values ('e2800000-0000-0000-0000-000000000006', 'b2800000-0000-0000-0000-000000000001', 'present', now() - interval '1 day');
select ok((select abs(extract(epoch from (arrived_at - now()))) < 5 from public.meeting_attendance
  where meeting_id = 'e2800000-0000-0000-0000-000000000006'), 'live: a late arrival is stamped now, a client time ignored');

select * from finish();
rollback;
