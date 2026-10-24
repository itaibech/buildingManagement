-- Meetings (0021, Task 24): lifecycle RPCs and their preconditions, quorum with the postponement override, the vote
-- total rule, locking after close, resident visibility per state, the meetings permission, storage access, email kind.
-- Own fixtures inside a rolled-back transaction (a separate building with 5 apartments: majority quorum = 3).
begin;
create extension if not exists pgtap with schema extensions;

select plan(105);

-- ---------------------------------------------------------------- fixtures (as postgres)
insert into auth.users (id, email, aud, role) values
  ('a2400000-0000-0000-0000-000000000001', 'mt-admin@test.local', 'authenticated', 'authenticated'),
  ('a2400000-0000-0000-0000-000000000002', 'mt-res@test.local', 'authenticated', 'authenticated'),
  ('a2400000-0000-0000-0000-000000000003', 'mt-noperm@test.local', 'authenticated', 'authenticated');
update public.profiles set role = 'admin', status = 'approved' where user_id = 'a2400000-0000-0000-0000-000000000001';
update public.profiles set status = 'approved' where user_id in ('a2400000-0000-0000-0000-000000000002', 'a2400000-0000-0000-0000-000000000003');
-- A group without "meetings" for the third user.
insert into public.user_groups (id, name) values ('a2400000-0000-0000-0000-0000000000a1', 'ללא ישיבות (בדיקה)');
update public.profiles set group_id = 'a2400000-0000-0000-0000-0000000000a1' where user_id = 'a2400000-0000-0000-0000-000000000003';

insert into public.buildings (id, name) values ('b2400000-0000-0000-0000-000000000001', 'בניין ישיבות');
insert into public.apartments (id, building_id, number)
select ('b2400000-0000-0000-0000-00000000000' || n)::uuid, 'b2400000-0000-0000-0000-000000000001', n from generate_series(1, 5) n;

create temp table ids (k text primary key, v text) on commit drop;
insert into ids values
  ('m1', 'e2400000-0000-0000-0000-000000000001'),
  ('m2', 'e2400000-0000-0000-0000-000000000002'),
  ('m3', 'e2400000-0000-0000-0000-000000000003'),
  ('sig', 'e2400000-0000-0000-0000-000000000001/0b9a54c4-3e1f-4b8e-9f0a-2c6d1e7f8a90.png'),
  ('sig2', 'e2400000-0000-0000-0000-000000000001/1b9a54c4-3e1f-4b8e-9f0a-2c6d1e7f8a90.png'),
  ('m3file', 'e2400000-0000-0000-0000-000000000003/2b9a54c4-3e1f-4b8e-9f0a-2c6d1e7f8a90.pdf'),
  ('late', 'e2400000-0000-0000-0000-000000000001/3b9a54c4-3e1f-4b8e-9f0a-2c6d1e7f8a90.png');
grant select on ids to authenticated;

-- ---------------------------------------------------------------- catalog
select is((select label from public.permissions where key = 'meetings'), 'ישיבות ופרוטוקולים', 'catalog: meetings key');
select ok(exists (select 1 from public.group_permissions gp join public.user_groups g on g.id = gp.group_id
  where g.is_default and gp.permission = 'meetings'), 'the default group "דייר" has meetings');
select ok(has_function_privilege('authenticated', 'public.meeting_quorum(uuid)', 'execute'), 'authenticated may compute the quorum');
select is((select row(public, file_size_limit)::text from storage.buckets where id = 'meeting-files'), '(f,10485760)',
  'meeting-files bucket: private, 10 MB');

-- ---------------------------------------------------------------- admin: draft
set local role authenticated;
set local request.jwt.claims = '{"sub":"a2400000-0000-0000-0000-000000000001","role":"authenticated"}';
select throws_ok($$insert into public.meetings (building_id, title, scheduled_at, status)
  values ('b2400000-0000-0000-0000-000000000001', 'x', now() + interval '10 days', 'invited')$$,
  '42501', null, 'admin: a meeting is created as a draft only');
select lives_ok($$insert into public.meetings (id, building_id, kind, title, scheduled_at, location) values
  ('e2400000-0000-0000-0000-000000000001', 'b2400000-0000-0000-0000-000000000001', 'general', 'אסיפה שנתית', now() + interval '2 days', 'מקלט הבניין'),
  ('e2400000-0000-0000-0000-000000000002', 'b2400000-0000-0000-0000-000000000001', 'committee', 'ריקה', now() + interval '10 days', 'לובי'),
  ('e2400000-0000-0000-0000-000000000003', 'b2400000-0000-0000-0000-000000000001', 'committee', 'ישיבה 3', now() + interval '10 days', 'זום')$$,
  'admin: creates draft meetings');
select lives_ok($$insert into public.meeting_agenda_items (meeting_id, position, title) values
  ('e2400000-0000-0000-0000-000000000001', 1, 'אישור תקציב'),
  ('e2400000-0000-0000-0000-000000000001', 2, 'צביעת חדר המדרגות'),
  ('e2400000-0000-0000-0000-000000000003', 1, 'שונות')$$, 'admin: adds agenda items');
select is((select added_during_meeting from public.meeting_agenda_items where title = 'אישור תקציב'), false, 'items added before the meeting are not marked');

-- quorum rules
select is((select row(total, attending, required, met)::text from public.meeting_quorum('e2400000-0000-0000-0000-000000000001')),
  '(5,0,3,f)', 'quorum: majority of 5 apartments = 3');
update public.meetings set quorum_mode = 'percent', quorum_value = 60 where id = 'e2400000-0000-0000-0000-000000000001';
select is((select required from public.meeting_quorum('e2400000-0000-0000-0000-000000000001')), 3, 'quorum: 60% of 5 = 3');
update public.meetings set quorum_value = 41 where id = 'e2400000-0000-0000-0000-000000000001';
select is((select required from public.meeting_quorum('e2400000-0000-0000-0000-000000000001')), 3, 'quorum: a percentage rounds up (41% of 5 = 3)');
update public.meetings set quorum_mode = 'fixed', quorum_value = 2 where id = 'e2400000-0000-0000-0000-000000000001';
select is((select required from public.meeting_quorum('e2400000-0000-0000-0000-000000000001')), 2, 'quorum: a fixed number');
select throws_ok($$update public.meetings set quorum_mode = 'percent', quorum_value = 120 where id = 'e2400000-0000-0000-0000-000000000001'$$,
  '23514', null, 'quorum: a percentage above 100 is rejected');
update public.meetings set quorum_mode = 'majority', quorum_value = null where id = 'e2400000-0000-0000-0000-000000000001';

select throws_ok($$update public.meetings set status = 'invited' where id = 'e2400000-0000-0000-0000-000000000001'$$,
  '42501', null, 'admin: the state cannot be changed directly');
select throws_ok($$insert into public.meeting_attendance (meeting_id, apartment_id, status)
  values ('e2400000-0000-0000-0000-000000000001', 'b2400000-0000-0000-0000-000000000001', 'present')$$,
  '42501', null, 'attendance: not before the invitation');

-- ---------------------------------------------------------------- residents: drafts are hidden
set local request.jwt.claims = '{"sub":"a2400000-0000-0000-0000-000000000002","role":"authenticated"}';
select is((select count(*) from public.meetings where building_id = 'b2400000-0000-0000-0000-000000000001'), 0::bigint, 'resident: drafts are hidden');
select is((select count(*) from public.meeting_agenda_items where meeting_id = 'e2400000-0000-0000-0000-000000000001'), 0::bigint,
  'resident: a draft agenda is hidden');
select throws_ok($$insert into public.meetings (building_id, title, scheduled_at) values ('b2400000-0000-0000-0000-000000000001', 'x', now())$$,
  '42501', null, 'resident: cannot create a meeting');
select throws_ok($$select public.invite_meeting('e2400000-0000-0000-0000-000000000001', true)$$, '42501', null, 'resident: cannot invite');

-- ---------------------------------------------------------------- invite
set local request.jwt.claims = '{"sub":"a2400000-0000-0000-0000-000000000001","role":"authenticated"}';
select throws_like($$select public.invite_meeting('e2400000-0000-0000-0000-000000000002', false)$$,
  'meeting:empty_agenda%', 'invite: an empty agenda is refused');
select throws_like($$select public.invite_meeting('e2400000-0000-0000-0000-000000000001', false)$$,
  'meeting:short_notice%', 'invite: less than 5 days ahead needs the confirmation');
select lives_ok($$select public.invite_meeting('e2400000-0000-0000-0000-000000000001', true)$$, 'invite: confirmed short notice');
select is((select status from public.meetings where id = 'e2400000-0000-0000-0000-000000000001'), 'invited', 'invite: state is invited');
select ok((select invited_at is not null from public.meetings where id = 'e2400000-0000-0000-0000-000000000001'), 'invite: invited_at recorded');
select is((select row(a.pinned, a.link, a.expires_at = (m.scheduled_at at time zone 'Asia/Jerusalem')::date)::text
  from public.meetings m join public.announcements a on a.id = m.invite_announcement_id where m.id = 'e2400000-0000-0000-0000-000000000001'),
  '(t,/meetings/e2400000-0000-0000-0000-000000000001,t)', 'invite: a pinned announcement until the meeting date, linking to it');
select ok((select a.body like '%1. אישור תקציב%2. צביעת חדר המדרגות%' and a.body like '%מקלט הבניין%' and a.title like 'זימון לאסיפת דיירים כללית%'
  from public.meetings m join public.announcements a on a.id = m.invite_announcement_id where m.id = 'e2400000-0000-0000-0000-000000000001'),
  'invite: the announcement holds the type, place and numbered agenda');
select is((select kind from public.meeting_events where meeting_id = 'e2400000-0000-0000-0000-000000000001' order by created_at desc, kind limit 1),
  'invited', 'invite: logged');
select throws_like($$select public.invite_meeting('e2400000-0000-0000-0000-000000000001', true)$$, 'meeting:state%', 'invite: only once');
select lives_ok($$select public.invite_meeting('e2400000-0000-0000-0000-000000000003', false)$$, 'invite: 10 days ahead needs no confirmation');

-- update after invitation: edits are logged; the update re-announces
update public.meetings set location = 'לובי' where id = 'e2400000-0000-0000-0000-000000000001';
select is((select details -> 'location' ->> 'to' from public.meeting_events where meeting_id = 'e2400000-0000-0000-0000-000000000001' and kind = 'edited'),
  'לובי', 'invited: a field change is logged');
insert into public.meeting_agenda_items (meeting_id, position, title) values ('e2400000-0000-0000-0000-000000000001', 3, 'בחירת ועד');
select is((select count(*) from public.meeting_events where meeting_id = 'e2400000-0000-0000-0000-000000000001' and kind = 'agenda_edited'),
  1::bigint, 'invited: an agenda change is logged');
select lives_ok($$select public.update_meeting_invitation('e2400000-0000-0000-0000-000000000001')$$, 'invited: the update is sent');
select is((select count(*) from public.announcements where link = '/meetings/e2400000-0000-0000-0000-000000000001' and pinned), 1::bigint,
  'update: only the newest invitation stays pinned');
select ok((select a.title like 'עדכון זימון%' and a.body like '%3. בחירת ועד%' from public.meetings m join public.announcements a on a.id = m.invite_announcement_id
  where m.id = 'e2400000-0000-0000-0000-000000000001'), 'update: a new announcement with the current agenda');

-- ---------------------------------------------------------------- residents: invited is visible
set local request.jwt.claims = '{"sub":"a2400000-0000-0000-0000-000000000002","role":"authenticated"}';
select is((select count(*) from public.meetings where building_id = 'b2400000-0000-0000-0000-000000000001'), 2::bigint, 'resident: sees invited meetings');
select is((select count(*) from public.meeting_agenda_items where meeting_id = 'e2400000-0000-0000-0000-000000000001'), 3::bigint, 'resident: sees the agenda');
set local request.jwt.claims = '{"sub":"a2400000-0000-0000-0000-000000000003","role":"authenticated"}';
select is((select count(*) from public.meetings where building_id = 'b2400000-0000-0000-0000-000000000001'), 0::bigint, 'no meetings permission: sees nothing');
select is((select count(*) from public.meeting_agenda_items), 0::bigint, 'no meetings permission: no agenda');

-- ---------------------------------------------------------------- attendance, postponement, opening
set local request.jwt.claims = '{"sub":"a2400000-0000-0000-0000-000000000001","role":"authenticated"}';
select lives_ok($$insert into public.meeting_attendance (meeting_id, apartment_id, status, attendee_name) values
  ('e2400000-0000-0000-0000-000000000001', 'b2400000-0000-0000-0000-000000000001', 'present', 'דיירת אחת'),
  ('e2400000-0000-0000-0000-000000000001', 'b2400000-0000-0000-0000-000000000002', 'present', 'דייר שתיים'),
  ('e2400000-0000-0000-0000-000000000001', 'b2400000-0000-0000-0000-000000000003', 'absent', '')$$, 'attendance: recorded');
select is((select apartment_number from public.meeting_attendance where apartment_id = 'b2400000-0000-0000-0000-000000000002'
  and meeting_id = 'e2400000-0000-0000-0000-000000000001'), 2, 'attendance: keeps the apartment number');
select throws_ok($$insert into public.meeting_attendance (meeting_id, apartment_id, status)
  select 'e2400000-0000-0000-0000-000000000001', id, 'present' from public.apartments where building_id <> 'b2400000-0000-0000-0000-000000000001' limit 1$$,
  '23514', null, 'attendance: an apartment of another building is refused');
select is((select row(attending, met)::text from public.meeting_quorum('e2400000-0000-0000-0000-000000000001')), '(2,f)',
  'quorum: 2 of 5 is not enough (absent is not counted)');
select throws_like($$select public.open_meeting('e2400000-0000-0000-0000-000000000001', now(), 'יו"ר', 'מזכירה')$$,
  'meeting:no_quorum%', 'open: refused without quorum');
select throws_ok($$update public.meeting_agenda_items set votes_for = 1, votes_against = 0, votes_abstain = 0 where title = 'אישור תקציב'$$,
  '42501', null, 'votes: not before the meeting opens');
select lives_ok($$select public.postpone_meeting('e2400000-0000-0000-0000-000000000001')$$, 'postpone: by one hour');
select ok((select postponed_at is not null and postponed_to = greatest(scheduled_at, postponed_at) + interval '1 hour'
  from public.meetings where id = 'e2400000-0000-0000-0000-000000000001'), 'postpone: the new opening time is +1 hour');
select throws_like($$select public.postpone_meeting('e2400000-0000-0000-0000-000000000001')$$, 'meeting:already_postponed%', 'postpone: once');
select throws_like($$select public.open_meeting('e2400000-0000-0000-0000-000000000001', now(), ' ', 'מזכירה')$$,
  'meeting:roles%', 'open: a chair and a recorder are required');
select lives_ok($$select public.open_meeting('e2400000-0000-0000-0000-000000000001', now(), 'יו"ר האסיפה', 'רושמת הפרוטוקול')$$,
  'open: after the postponement any attendance is valid');
select is((select row(status, chair_name, secretary_name)::text from public.meetings where id = 'e2400000-0000-0000-0000-000000000001'),
  '(in_progress,"יו""ר האסיפה","רושמת הפרוטוקול")', 'open: in progress, with the roles');

-- quorum met: opens without postponing, and postponing is refused
insert into public.meeting_attendance (meeting_id, apartment_id, status, attendee_name)
select 'e2400000-0000-0000-0000-000000000003', id, 'present', 'נוכח' from public.apartments where building_id = 'b2400000-0000-0000-0000-000000000001' and number <= 3;
select throws_like($$select public.postpone_meeting('e2400000-0000-0000-0000-000000000003')$$, 'meeting:quorum_met%', 'postpone: not when there is a quorum');
select lives_ok($$select public.open_meeting('e2400000-0000-0000-0000-000000000003', now(), 'א', 'ב')$$, 'open: with a quorum');

-- ---------------------------------------------------------------- residents: live data is hidden
set local request.jwt.claims = '{"sub":"a2400000-0000-0000-0000-000000000002","role":"authenticated"}';
select is((select count(*) from public.meetings where building_id = 'b2400000-0000-0000-0000-000000000001'), 0::bigint, 'resident: a meeting in progress is hidden');
select is((select count(*) from public.meeting_attendance), 0::bigint, 'resident: live attendance is hidden');

-- ---------------------------------------------------------------- votes and decisions
set local request.jwt.claims = '{"sub":"a2400000-0000-0000-0000-000000000001","role":"authenticated"}';
select throws_ok($$update public.meeting_agenda_items set votes_for = 3, votes_against = 0, votes_abstain = 0
  where meeting_id = 'e2400000-0000-0000-0000-000000000001' and title = 'אישור תקציב'$$,
  '23514', null, 'votes: the total may not exceed the attendees (3 > 2)');
select throws_ok($$update public.meeting_agenda_items set votes_for = 1 where meeting_id = 'e2400000-0000-0000-0000-000000000001' and title = 'אישור תקציב'$$,
  '23514', null, 'votes: all three counts or none');
select lives_ok($$insert into public.meeting_attendance (meeting_id, apartment_id, status, proxy_name) values
  ('e2400000-0000-0000-0000-000000000001', 'b2400000-0000-0000-0000-000000000004', 'proxy', 'מיופה כוח')$$, 'attendance: a proxy during the meeting');
select lives_ok($$update public.meeting_agenda_items set votes_for = 2, votes_against = 1, votes_abstain = 0,
  discussion = 'נדון התקציב', decision = 'התקציב אושר' where meeting_id = 'e2400000-0000-0000-0000-000000000001' and title = 'אישור תקציב'$$,
  'votes: a proxy counts as an attendee (3 of 3)');
update public.meeting_agenda_items set item_status = 'removed' where meeting_id = 'e2400000-0000-0000-0000-000000000001' and title = 'צביעת חדר המדרגות';
select lives_ok($$insert into public.meeting_agenda_items (meeting_id, position, title, decision, votes_for, votes_against, votes_abstain)
  values ('e2400000-0000-0000-0000-000000000001', 9, 'שונות: חניה', 'נקבע סידור חניה', 3, 0, 0)$$, 'item added during the meeting');
select is((select added_during_meeting from public.meeting_agenda_items where title = 'שונות: חניה'), true, 'it is marked as added during the meeting');
select throws_ok($$update public.meeting_agenda_items set decision_number = 7 where title = 'שונות: חניה'$$,
  '42501', null, 'decision numbers are assigned by the server only');
select throws_like($$select public.sign_meeting('e2400000-0000-0000-0000-000000000001', 'chair', 'יו"ר', (select v from ids where k = 'sig'))$$,
  'meeting:state%', 'sign: not before the meeting closes');
select throws_like($$select public.publish_meeting('e2400000-0000-0000-0000-000000000001')$$, 'meeting:state%', 'publish: not before close');

-- ---------------------------------------------------------------- close and lock
select lives_ok($$select public.close_meeting('e2400000-0000-0000-0000-000000000001', now())$$, 'close');
select is((select array_agg(coalesce(decision_number, 0) order by position) from public.meeting_agenda_items
  where meeting_id = 'e2400000-0000-0000-0000-000000000001'), array[1, 0, 0, 2],
  'close: decisions are numbered in agenda order, skipping removed and undecided items');
select ok((select closed_at is not null and status = 'closed' from public.meetings where id = 'e2400000-0000-0000-0000-000000000001'), 'close: closed_at recorded');
select is((select array_agg(apartment_number || ':' || status order by apartment_number) from public.meeting_attendance
  where meeting_id = 'e2400000-0000-0000-0000-000000000001'), array['1:present', '2:present', '3:absent', '4:proxy', '5:absent'],
  'close: apartments without a record are recorded absent');
select throws_ok($$update public.meeting_agenda_items set decision = 'שונה' where meeting_id = 'e2400000-0000-0000-0000-000000000001'$$,
  '42501', null, 'locked: items');
select throws_ok($$update public.meeting_agenda_items set votes_for = 0, votes_against = 0, votes_abstain = 0 where title = 'אישור תקציב'$$,
  '42501', null, 'locked: votes');
select throws_ok($$delete from public.meeting_attendance where meeting_id = 'e2400000-0000-0000-0000-000000000001'$$, '42501', null, 'locked: attendance delete');
select throws_ok($$insert into public.meeting_attendance (meeting_id, apartment_id, status) values
  ('e2400000-0000-0000-0000-000000000001', 'b2400000-0000-0000-0000-000000000005', 'present')$$, '42501', null, 'locked: attendance insert');
select throws_ok($$update public.meetings set title = 'אחר' where id = 'e2400000-0000-0000-0000-000000000001'$$, '42501', null, 'locked: meeting details');
select throws_ok($$delete from public.meetings where id = 'e2400000-0000-0000-0000-000000000001'$$, '42501', null, 'locked: a closed meeting cannot be deleted');

-- vote total re-checked at close: an attendee removed after the vote blocks closing
update public.meeting_agenda_items set votes_for = 3, votes_against = 0, votes_abstain = 0, decision = 'אושר'
  where meeting_id = 'e2400000-0000-0000-0000-000000000003';
update public.meeting_attendance set status = 'absent' where meeting_id = 'e2400000-0000-0000-0000-000000000003' and apartment_number = 3;
select throws_like($$select public.close_meeting('e2400000-0000-0000-0000-000000000003', now())$$, 'meeting:votes%', 'close: refused when a vote exceeds the attendees');

-- ---------------------------------------------------------------- storage
set local storage.allow_delete_query = 'true';
select lives_ok($$insert into storage.objects (bucket_id, name) select 'meeting-files', v from ids where k in ('sig', 'sig2', 'm3file')$$,
  'storage: admin uploads signatures and a proxy form');
select throws_ok($$insert into storage.objects (bucket_id, name) values ('meeting-files', 'e2400000-0000-0000-0000-000000000001/x.exe')$$,
  '42501', null, 'storage: a path outside <meeting_id>/<uuid>.<ext> is refused');

-- ---------------------------------------------------------------- residents: closed is still hidden
set local request.jwt.claims = '{"sub":"a2400000-0000-0000-0000-000000000002","role":"authenticated"}';
select is((select count(*) from public.meetings where id = 'e2400000-0000-0000-0000-000000000001'), 0::bigint, 'resident: an unpublished closed meeting is hidden');
select is((select count(*) from storage.objects where bucket_id = 'meeting-files'), 0::bigint, 'resident: files of unpublished meetings are hidden');
select throws_ok($$insert into storage.objects (bucket_id, name) select 'meeting-files', v from ids where k = 'late'$$,
  '42501', null, 'resident: cannot upload');
select throws_ok($$select public.sign_meeting('e2400000-0000-0000-0000-000000000001', 'chair', 'x', (select v from ids where k = 'sig'))$$,
  '42501', null, 'resident: cannot sign');

-- ---------------------------------------------------------------- sign and publish
set local request.jwt.claims = '{"sub":"a2400000-0000-0000-0000-000000000001","role":"authenticated"}';
select throws_like($$select public.publish_meeting('e2400000-0000-0000-0000-000000000001')$$, 'meeting:signatures%', 'publish: needs signatures');
select throws_like($$select public.sign_meeting('e2400000-0000-0000-0000-000000000001', 'chair', 'יו"ר', 'e2400000-0000-0000-0000-000000000003/0b9a54c4-3e1f-4b8e-9f0a-2c6d1e7f8a90.png')$$,
  'meeting:path%', 'sign: the file must be in the meeting''s folder');
select lives_ok($$select public.sign_meeting('e2400000-0000-0000-0000-000000000001', 'chair', 'יו"ר האסיפה', (select v from ids where k = 'sig'))$$, 'sign: chair');
select throws_like($$select public.publish_meeting('e2400000-0000-0000-0000-000000000001')$$, 'meeting:signatures%', 'publish: needs the recorder too');
select lives_ok($$select public.sign_meeting('e2400000-0000-0000-0000-000000000001', 'secretary', 'רושמת הפרוטוקול', (select v from ids where k = 'sig2'))$$, 'sign: recorder');
select is((select recorded_by::text from public.meeting_signatures where role = 'secretary' and meeting_id = 'e2400000-0000-0000-0000-000000000001'),
  'a2400000-0000-0000-0000-000000000001', 'sign: records who recorded it');
select throws_ok($$insert into public.meeting_signatures (meeting_id, role, signer_name, image_path)
  select 'e2400000-0000-0000-0000-000000000001', 'attendee', 'x', v from ids where k = 'sig'$$, '42501', null, 'signatures: only through sign_meeting');
select lives_ok($$select public.publish_meeting('e2400000-0000-0000-0000-000000000001')$$, 'publish');
select ok((select m.status = 'published' and m.published_at is not null and a.title like 'פורסם פרוטוקול אסיפה שנתית מתאריך %'
  and a.link = '/meetings/e2400000-0000-0000-0000-000000000001'
  from public.meetings m join public.announcements a on a.id = m.publish_announcement_id where m.id = 'e2400000-0000-0000-0000-000000000001'),
  'publish: published, with an announcement linking to the protocol');
select throws_ok($$insert into storage.objects (bucket_id, name) select 'meeting-files', v from ids where k = 'late'$$,
  '42501', null, 'storage: a published meeting''s folder is read-only');
select is((select count(*) from storage.objects where bucket_id = 'meeting-files' and name like 'e2400000-0000-0000-0000-000000000001/%'), 2::bigint,
  'storage: admin reads the files');
delete from storage.objects where bucket_id = 'meeting-files' and name like 'e2400000-0000-0000-0000-000000000001/%';
select is((select count(*) from storage.objects where bucket_id = 'meeting-files' and name like 'e2400000-0000-0000-0000-000000000001/%'), 2::bigint,
  'storage: a published meeting''s files are kept');
select lives_ok($$select public.add_addendum('e2400000-0000-0000-0000-000000000001', 'תיקון: שם המזכירה')$$, 'addendum after publishing');
select throws_ok($$insert into public.meeting_addenda (meeting_id, body) values ('e2400000-0000-0000-0000-000000000001', 'x')$$,
  '42501', null, 'addenda: only through add_addendum');
select throws_like($$select public.add_addendum('e2400000-0000-0000-0000-000000000002', 'x')$$, 'meeting:state%', 'addendum: not on a draft');

-- ---------------------------------------------------------------- residents: the published protocol
set local request.jwt.claims = '{"sub":"a2400000-0000-0000-0000-000000000002","role":"authenticated"}';
select is((select count(*) from public.meetings where id = 'e2400000-0000-0000-0000-000000000001'), 1::bigint, 'resident: sees the published meeting');
select is((select count(*) from public.meeting_attendance where meeting_id = 'e2400000-0000-0000-0000-000000000001'), 5::bigint,
  'resident: sees the published attendance');
select is((select count(*) from public.meeting_signatures), 2::bigint, 'resident: sees the signatures');
select is((select count(*) from public.meeting_addenda), 1::bigint, 'resident: sees the addenda');
select is((select count(*) from public.meeting_events), 0::bigint, 'resident: never sees the audit log');
select is((select count(*) from storage.objects where bucket_id = 'meeting-files'), 2::bigint, 'resident: reads files of the published meeting only');
set local request.jwt.claims = '{"sub":"a2400000-0000-0000-0000-000000000003","role":"authenticated"}';
select is((select count(*) from public.meetings), 0::bigint, 'no meetings permission: no published meeting');
select is((select count(*) from storage.objects where bucket_id = 'meeting-files'), 0::bigint, 'no meetings permission: no files');

-- ---------------------------------------------------------------- deleting a draft; email kind
set local request.jwt.claims = '{"sub":"a2400000-0000-0000-0000-000000000001","role":"authenticated"}';
select lives_ok($$delete from public.meetings where id = 'e2400000-0000-0000-0000-000000000002'$$, 'admin: deletes a draft');
reset role;
select lives_ok($$insert into public.email_log (building_id, kind, recipients) values ('b2400000-0000-0000-0000-000000000001', 'meeting', 1)$$,
  'email_log accepts the meeting kind');

select * from finish();
rollback;
