-- Meeting flexibility (0022, Task 25): quick start, the "ללא דרישת מניין" rule, opening without quorum (override,
-- also after a postponement), cancelling a postponement, late arrivals during the meeting, votes validated against
-- the attendance at the time of each vote, archived apartments out of the quorum.
-- Own fixtures inside a rolled-back transaction (a separate building with 5 apartments: majority quorum = 3).
begin;
create extension if not exists pgtap with schema extensions;

select plan(38);

insert into auth.users (id, email, aud, role) values
  ('a2500000-0000-0000-0000-000000000001', 'flex-admin@test.local', 'authenticated', 'authenticated'),
  ('a2500000-0000-0000-0000-000000000002', 'flex-res@test.local', 'authenticated', 'authenticated');
update public.profiles set role = 'admin', status = 'approved' where user_id = 'a2500000-0000-0000-0000-000000000001';
update public.profiles set status = 'approved' where user_id = 'a2500000-0000-0000-0000-000000000002';
insert into public.buildings (id, name) values ('b2500000-0000-0000-0000-000000000001', 'בניין גמיש');
insert into public.apartments (id, building_id, number)
select ('b2500000-0000-0000-0000-00000000000' || n)::uuid, 'b2500000-0000-0000-0000-000000000001', n from generate_series(1, 6) n;
-- Apartment 6 is archived: not a voting unit.
update public.apartments set archived_at = now() where id = 'b2500000-0000-0000-0000-000000000006';
update public.profiles set building_id = 'b2500000-0000-0000-0000-000000000001'
  where user_id in ('a2500000-0000-0000-0000-000000000001', 'a2500000-0000-0000-0000-000000000002');

set local role authenticated;
set local request.jwt.claims = '{"sub":"a2500000-0000-0000-0000-000000000001","role":"authenticated"}';
insert into public.meetings (id, building_id, kind, title, scheduled_at, quorum_mode) values
  ('e2500000-0000-0000-0000-000000000001', 'b2500000-0000-0000-0000-000000000001', 'committee', 'ועד מיידי', now() + interval '3 days', 'none'),
  ('e2500000-0000-0000-0000-000000000002', 'b2500000-0000-0000-0000-000000000001', 'general', 'אסיפה מיידית', now() + interval '3 days', 'majority'),
  ('e2500000-0000-0000-0000-000000000003', 'b2500000-0000-0000-0000-000000000001', 'general', 'אסיפה נדחית', now() + interval '10 days', 'majority'),
  ('e2500000-0000-0000-0000-000000000004', 'b2500000-0000-0000-0000-000000000001', 'general', 'אסיפה בזמן', now() + interval '10 days', 'majority'),
  ('e2500000-0000-0000-0000-000000000005', 'b2500000-0000-0000-0000-000000000001', 'general', 'נדחתה ואז הגיעו', now() + interval '10 days', 'majority'),
  ('e2500000-0000-0000-0000-000000000006', 'b2500000-0000-0000-0000-000000000001', 'general', 'נדחתה והזמן עבר', now() + interval '10 days', 'majority');
insert into public.meeting_agenda_items (meeting_id, position, title) values
  ('e2500000-0000-0000-0000-000000000003', 1, 'סעיף'), ('e2500000-0000-0000-0000-000000000004', 1, 'סעיף'),
  ('e2500000-0000-0000-0000-000000000005', 1, 'סעיף'), ('e2500000-0000-0000-0000-000000000006', 1, 'סעיף');

-- ---------------------------------------------------------------- the "ללא דרישת מניין" rule
select is((select row(total, required, met)::text from public.meeting_quorum('e2500000-0000-0000-0000-000000000001')),
  '(5,0,t)', 'none: no quorum is required (and the archived apartment is not counted)');
select is((select total from public.meeting_quorum('e2500000-0000-0000-0000-000000000002')), 5, 'archived apartments are not voting units');
select throws_ok($$update public.meetings set quorum_value = 3 where id = 'e2500000-0000-0000-0000-000000000001'$$,
  '23514', null, 'none takes no value');

-- ---------------------------------------------------------------- quick start (draft → in_progress, no invitation)
select lives_ok($$select public.quick_start_meeting('e2500000-0000-0000-0000-000000000001', 'יו"ר', 'מזכיר')$$,
  'quick start: a committee meeting with no quorum rule opens right away');
select is((select row(status, quick_started, opened_without_quorum, invited_at is null)::text from public.meetings
  where id = 'e2500000-0000-0000-0000-000000000001'), '(in_progress,t,f,t)', 'quick start: in progress, marked, never invited');
select ok((select abs(extract(epoch from (opened_at - now()))) < 5 and abs(extract(epoch from (scheduled_at - now()))) < 5
  from public.meetings where id = 'e2500000-0000-0000-0000-000000000001'), 'quick start: the time is set to now');
select is((select details ->> 'quick_start' from public.meeting_events
  where meeting_id = 'e2500000-0000-0000-0000-000000000001' and kind = 'opened'), 'true', 'quick start: logged as opened');
select throws_like($$select public.quick_start_meeting('e2500000-0000-0000-0000-000000000002', 'יו"ר', 'מזכיר')$$,
  'meeting:no_quorum%', 'quick start: an assembly without attendance needs the explicit override');
select lives_ok($$select public.quick_start_meeting('e2500000-0000-0000-0000-000000000002', 'יו"ר', 'מזכיר', true)$$,
  'quick start: with the override');
select is((select opened_without_quorum from public.meetings where id = 'e2500000-0000-0000-0000-000000000002'), true,
  'quick start: the override is recorded on the meeting');
select is((select details ->> 'override' from public.meeting_events
  where meeting_id = 'e2500000-0000-0000-0000-000000000002' and kind = 'opened'), 'true', 'the override is logged in meeting_events');
select throws_like($$select public.quick_start_meeting('e2500000-0000-0000-0000-000000000002', 'יו"ר', 'מזכיר', true)$$,
  'meeting:state%', 'quick start: only from a draft');

-- ---------------------------------------------------------------- postponement: +1h from max(now, scheduled), cancel, override
select lives_ok($$select public.invite_meeting('e2500000-0000-0000-0000-000000000003')$$, 'invite the assembly');
select lives_ok($$select public.postpone_meeting('e2500000-0000-0000-0000-000000000003')$$, 'postpone before the scheduled time');
select ok((select postponed_to = scheduled_at + interval '1 hour' from public.meetings where id = 'e2500000-0000-0000-0000-000000000003'),
  'postponed before the scheduled time: the hour counts from the scheduled time');
select lives_ok($$select public.cancel_postponement('e2500000-0000-0000-0000-000000000003')$$, 'cancel the postponement');
select is((select row(postponed_at, postponed_to)::text from public.meetings where id = 'e2500000-0000-0000-0000-000000000003'),
  '(,)', 'cancelled: no postponement left');
select is((select count(*)::int from public.meeting_events where meeting_id = 'e2500000-0000-0000-0000-000000000003'
  and kind = 'postponement_cancelled'), 1, 'cancelling is logged');
select throws_like($$select public.cancel_postponement('e2500000-0000-0000-0000-000000000003')$$, 'meeting:not_postponed%',
  'nothing to cancel twice');
reset role;
update public.meetings set scheduled_at = now() - interval '10 minutes' where id = 'e2500000-0000-0000-0000-000000000003';
set local role authenticated;
set local request.jwt.claims = '{"sub":"a2500000-0000-0000-0000-000000000001","role":"authenticated"}';
select lives_ok($$select public.postpone_meeting('e2500000-0000-0000-0000-000000000003')$$, 'postpone after the scheduled time');
select ok((select abs(extract(epoch from (postponed_to - (now() + interval '1 hour')))) < 5 from public.meetings
  where id = 'e2500000-0000-0000-0000-000000000003'), 'postponed after the scheduled time: the hour counts from now');
select throws_like($$select public.open_meeting('e2500000-0000-0000-0000-000000000003', null, 'יו"ר', 'מזכירה')$$,
  'meeting:too_early%', 'without the override the real-clock postponement rule still holds');
select lives_ok($$select public.open_meeting('e2500000-0000-0000-0000-000000000003', null, 'יו"ר', 'מזכירה', true)$$,
  'the override opens a postponed meeting right away');
select is((select row(status, opened_without_quorum)::text from public.meetings where id = 'e2500000-0000-0000-0000-000000000003'),
  '(in_progress,t)', 'opened without quorum, recorded');

-- Once the quorum arrives, a postponement no longer binds: it opens before the postponed time (and isn't "without
-- quorum", even if the override was ticked).
select public.invite_meeting('e2500000-0000-0000-0000-000000000005');
select public.postpone_meeting('e2500000-0000-0000-0000-000000000005');
insert into public.meeting_attendance (meeting_id, apartment_id, status) select 'e2500000-0000-0000-0000-000000000005',
  ('b2500000-0000-0000-0000-00000000000' || n)::uuid, 'present' from generate_series(1, 3) n;
select lives_ok($$select public.open_meeting('e2500000-0000-0000-0000-000000000005', null, 'יו"ר', 'מזכירה', true)$$,
  'postponed, then the quorum arrives: opens before the postponed time');
select is((select row(opened_at < postponed_to, opened_without_quorum)::text from public.meetings
  where id = 'e2500000-0000-0000-0000-000000000005'), '(t,f)', 'opened with its quorum, not recorded as without quorum');

-- Past the postponed time the override is ignored: the meeting is valid with whoever is present.
select public.invite_meeting('e2500000-0000-0000-0000-000000000006');
select public.postpone_meeting('e2500000-0000-0000-0000-000000000006');
reset role;
update public.meetings set postponed_at = now() - interval '61 minutes', postponed_to = now() - interval '1 minute'
  where id = 'e2500000-0000-0000-0000-000000000006';
set local role authenticated;
set local request.jwt.claims = '{"sub":"a2500000-0000-0000-0000-000000000001","role":"authenticated"}';
select lives_ok($$select public.open_meeting('e2500000-0000-0000-0000-000000000006', null, 'יו"ר', 'מזכירה', true)$$,
  'past the postponed time it opens with whoever is present');
select is((select opened_without_quorum from public.meetings where id = 'e2500000-0000-0000-0000-000000000006'), false,
  'the override is ignored after the postponed time (the protocol says postponed, not without quorum)');

-- ---------------------------------------------------------------- late arrivals and votes at the time of the vote
select lives_ok($$select public.invite_meeting('e2500000-0000-0000-0000-000000000004')$$, 'invite the second assembly');
insert into public.meeting_attendance (meeting_id, apartment_id, status) select 'e2500000-0000-0000-0000-000000000004',
  ('b2500000-0000-0000-0000-00000000000' || n)::uuid, 'present' from generate_series(1, 3) n;
select is((select count(*)::int from public.meeting_attendance where meeting_id = 'e2500000-0000-0000-0000-000000000004'
  and arrived_at is not null), 0, 'attendance before the opening has no arrival time');
select lives_ok($$select public.open_meeting('e2500000-0000-0000-0000-000000000004', null, 'יו"ר', 'מזכירה')$$,
  'quorum met (3 of 5): opens normally');
insert into public.meeting_attendance (meeting_id, apartment_id, status)
  values ('e2500000-0000-0000-0000-000000000004', 'b2500000-0000-0000-0000-000000000004', 'present');
select isnt((select arrived_at from public.meeting_attendance where meeting_id = 'e2500000-0000-0000-0000-000000000004'
  and apartment_id = 'b2500000-0000-0000-0000-000000000004'), null, 'a late arrival during the meeting gets its time');
update public.meeting_agenda_items set votes_for = 3, votes_against = 1, votes_abstain = 0
  where meeting_id = 'e2500000-0000-0000-0000-000000000004';
select is((select attendees_at_vote from public.meeting_agenda_items where meeting_id = 'e2500000-0000-0000-0000-000000000004'), 4,
  'the vote stores the attendance at the time of the vote');
update public.meeting_attendance set status = 'absent' where meeting_id = 'e2500000-0000-0000-0000-000000000004'
  and apartment_id in ('b2500000-0000-0000-0000-000000000003', 'b2500000-0000-0000-0000-000000000004');
select isnt((select left_at from public.meeting_attendance where meeting_id = 'e2500000-0000-0000-0000-000000000004'
  and apartment_id = 'b2500000-0000-0000-0000-000000000004'), null, 'leaving during the meeting gets its time');
select lives_ok($$update public.meeting_agenda_items set decision = 'אושר' where meeting_id = 'e2500000-0000-0000-0000-000000000004'$$,
  'an earlier vote stays valid after people leave');
select throws_ok($$insert into public.meeting_agenda_items (meeting_id, position, title, votes_for, votes_against, votes_abstain)
  values ('e2500000-0000-0000-0000-000000000004', 2, 'סעיף חדש', 3, 0, 0)$$, '23514', null,
  'a new vote is validated against the attendance now (2)');
select lives_ok($$select public.close_meeting('e2500000-0000-0000-0000-000000000004')$$,
  'close validates each vote against its own attendance');

-- ---------------------------------------------------------------- residents cannot
set local request.jwt.claims = '{"sub":"a2500000-0000-0000-0000-000000000002","role":"authenticated"}';
select throws_ok($$select public.cancel_postponement('e2500000-0000-0000-0000-000000000003')$$, '42501', null,
  'a resident cannot cancel a postponement');

select * from finish();
rollback;
