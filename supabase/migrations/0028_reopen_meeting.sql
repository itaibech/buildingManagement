-- 0028 editing the protocol before publication ("עריכת הפרוטוקול"): reopening a closed, unsigned meeting.
--   * reopen_meeting (admin only): closed → in_progress, only while the protocol has no signatures and no addenda
--     (after either, corrections go through add_addendum as before). Refusals carry 'meeting:<reason>' tokens:
--     state (not closed: published or any other state), signed, has_addenda.
--   * meetings.reopened_from: the closing time of the close being corrected. Set by reopen_meeting, cleared by
--     close_meeting; non-null exactly while the meeting is open for correction (status in_progress), which is how the
--     triggers and the app tell a correction from a live meeting. opened_at is kept.
--   * The status guards are unchanged: attendance, agenda items and votes are editable again while in_progress and
--     locked again once closed. Documents and the meeting's stored files stay as they were at the close.
--   * Arrival times: meeting_attendance_times stamps arrivals / departures with now() during a live meeting. During a
--     correction it stamps nothing: an apartment marked present counts from the opening unless an arrival time is
--     stored or the admin sets one (within the opening and the original close).
--   * Votes: during a correction every vote is checked against the corrected attendance (attendees_at_vote is the
--     attendance now); items added then are not marked "added during the meeting".
--   * close_meeting after a correction keeps the original closing time exactly (p_closed_at ignored), refuses
--     ('meeting:votes') an open item whose votes exceed the corrected attendance, and runs the decision numbering and
--     the absent list again (numbers may change; nothing is signed yet). Logged as 'reopened' (with the original
--     closed_at) and 'reclosed'.

alter table public.meetings add column reopened_from timestamptz;

alter table public.meeting_events drop constraint meeting_events_kind_check;
alter table public.meeting_events add constraint meeting_events_kind_check
  check (kind in ('invited', 'edited', 'agenda_edited', 'invitation_updated', 'postponed', 'opened',
    'closed', 'signed', 'published', 'addendum', 'postponement_cancelled', 'reopened', 'reclosed'));

-- ---------------------------------------------------------------- reopen
create function public.reopen_meeting(p_meeting uuid) returns void
language plpgsql security definer set search_path = ''
as $$
declare
  m public.meetings := public.meeting_lock(p_meeting);
begin
  perform public.meeting_require(m.status = 'closed', 'state');
  perform public.meeting_require(not exists (select 1 from public.meeting_signatures where meeting_id = p_meeting), 'signed');
  perform public.meeting_require(not exists (select 1 from public.meeting_addenda where meeting_id = p_meeting), 'has_addenda');
  update public.meetings set status = 'in_progress', reopened_from = m.closed_at where id = p_meeting;
  insert into public.meeting_events (meeting_id, kind, details)
  values (p_meeting, 'reopened', jsonb_build_object('closed_at', m.closed_at));
end;
$$;
revoke execute on function public.reopen_meeting(uuid) from public, anon;
grant execute on function public.reopen_meeting(uuid) to authenticated;

-- ---------------------------------------------------------------- arrival times during a correction
-- Same as 0022 for a live meeting. During a correction (reopened_from set) there are no clock stamps: the stored
-- times stay (marked present with none = from the opening), a present row never keeps a departure, and a time the
-- admin sets (one that differs from the stored one; on insert: one given) must lie between the opening and the
-- original close. Toggling absent and back keeps a stored arrival time.
-- (Inline, not a helper: the trigger runs as the API user, who can't execute the owner-only helpers.)
create or replace function public.meeting_attendance_times() returns trigger
language plpgsql set search_path = ''
as $$
declare
  m record;
  v_was boolean := tg_op = 'UPDATE' and old.status in ('present', 'proxy');
  v_is boolean := new.status in ('present', 'proxy');
  v_old_arrival timestamptz := case when tg_op = 'UPDATE' then old.arrived_at end;
  v_old_left timestamptz := case when tg_op = 'UPDATE' then old.left_at end;
begin
  select status, opened_at, reopened_from into m from public.meetings where id = new.meeting_id;
  if m.status = 'in_progress' and m.reopened_from is not null then
    if (new.arrived_at is distinct from v_old_arrival and new.arrived_at not between m.opened_at and m.reopened_from)
        or (new.left_at is distinct from v_old_left and new.left_at not between m.opened_at and m.reopened_from) then
      raise exception 'meeting:times the time is outside the meeting' using errcode = '22023';
    end if;
    if v_is then
      new.left_at := null;
    end if;
    if new.arrived_at > new.left_at then
      raise exception 'meeting:times the arrival is after the departure' using errcode = '22023';
    end if;
    return new;
  end if;
  new.arrived_at := v_old_arrival;
  new.left_at := v_old_left;
  if m.status = 'in_progress' and v_is and not v_was then
    new.arrived_at := now();
    new.left_at := null;
  elsif m.status = 'in_progress' and v_was and not v_is then
    new.left_at := now();
  end if;
  return new;
end;
$$;

-- ---------------------------------------------------------------- votes during a correction
-- Same as 0022, except during a correction: an item added then is not marked added during the meeting, and a vote's
-- attendance (attendees_at_vote) is always the corrected attendance now, so any write to an item with votes is
-- checked against it.
create or replace function public.meeting_items_rules() returns trigger
language plpgsql set search_path = ''
as $$
declare
  m record;
  v_fix boolean;
  v_changed boolean;
begin
  select status, reopened_from into m from public.meetings where id = new.meeting_id;
  v_fix := m.status = 'in_progress' and m.reopened_from is not null;
  v_changed := tg_op = 'INSERT' or row(new.votes_for, new.votes_against, new.votes_abstain)
    is distinct from row(old.votes_for, old.votes_against, old.votes_abstain);
  if current_user in ('authenticated', 'anon') then
    if new.decision_number is distinct from (case when tg_op = 'UPDATE' then old.decision_number end) then
      raise exception 'Decision numbers are assigned when the meeting closes' using errcode = '42501';
    end if;
    if m.status <> 'in_progress' and new.votes_for is not null and v_changed then
      raise exception 'Votes are recorded during the meeting' using errcode = '42501';
    end if;
    new.added_during_meeting := case when tg_op = 'INSERT' then m.status = 'in_progress' and not v_fix else old.added_during_meeting end;
  end if;
  if new.votes_for is null then
    new.attendees_at_vote := null;
  elsif v_changed or v_fix or (tg_op = 'UPDATE' and old.attendees_at_vote is null) then
    new.attendees_at_vote := (select count(*) from public.meeting_attendance
      where meeting_id = new.meeting_id and status in ('present', 'proxy'));
  else
    new.attendees_at_vote := old.attendees_at_vote;
  end if;
  if new.votes_for is not null and new.votes_for + new.votes_against + new.votes_abstain > new.attendees_at_vote then
    raise exception 'meeting:votes the vote total exceeds the attendees' using errcode = '23514';
  end if;
  new.updated_at := now();
  return new;
end;
$$;

-- ---------------------------------------------------------------- documents and files stay during a correction
-- Same as 0027, except that a correction also keeps documents (they were final at the close).
create or replace function public.meeting_documents_guard() returns trigger
language plpgsql set search_path = ''
as $$
declare
  v_status text;
  v_fix boolean;
begin
  if current_user not in ('authenticated', 'anon') then
    return coalesce(new, old);
  end if;
  select status, status = 'in_progress' and reopened_from is not null into v_status, v_fix
  from public.meetings where id = coalesce(new.meeting_id, old.meeting_id);
  if tg_op = 'INSERT' and v_status = 'published' then
    raise exception 'The protocol is published: documents are final' using errcode = '42501';
  end if;
  if tg_op = 'DELETE' and (v_status in ('closed', 'published') or v_fix) then
    raise exception 'The meeting is closed: documents stay as recorded' using errcode = '42501';
  end if;
  if tg_op = 'INSERT' then
    new.created_by := auth.uid();
  end if;
  return coalesce(new, old);
end;
$$;

-- Same as 0021, except that a meeting open for correction reads as 'closed', so the storage policies keep its files
-- (no overwrite or delete; new uploads such as a proxy form are still allowed).
create or replace function public.meeting_file_status(p_name text) returns text
language sql stable security definer set search_path = ''
as $$
  select case when public.is_meeting_storage_path(p_name)
    then (select case when status = 'in_progress' and reopened_from is not null then 'closed' else status end
      from public.meetings where id = split_part(p_name, '/', 1)::uuid
      and (public.is_admin() or status = 'published')) end;
$$;

-- ---------------------------------------------------------------- closing again
-- Same as 0022 for a live meeting. After a correction: the closing time is the original one (p_closed_at is ignored),
-- every open item's votes are checked against the corrected attendance (present + proxy now) and its
-- attendees_at_vote refreshed to it, reopened_from is cleared, and the event is 'reclosed'.
create or replace function public.close_meeting(p_meeting uuid, p_closed_at timestamptz default now()) returns void
language plpgsql security definer set search_path = ''
as $$
declare
  m public.meetings := public.meeting_lock(p_meeting);
  v_fix constant boolean := m.reopened_from is not null;
  v_attending constant int := (select count(*) from public.meeting_attendance
    where meeting_id = p_meeting and status in ('present', 'proxy'));
begin
  perform public.meeting_require(m.status = 'in_progress', 'state');
  perform public.meeting_require(not v_fix or not exists (select 1 from public.meeting_agenda_items where meeting_id = p_meeting
    and item_status = 'open' and votes_for is not null and votes_for + votes_against + votes_abstain > v_attending), 'votes');
  if v_fix then
    update public.meeting_agenda_items set attendees_at_vote = v_attending
    where meeting_id = p_meeting and item_status = 'open' and votes_for is not null;
  end if;
  perform public.meeting_require(not exists (select 1 from public.meeting_agenda_items where meeting_id = p_meeting
    and votes_for is not null and votes_for + votes_against + votes_abstain > coalesce(attendees_at_vote, 0)), 'votes');
  update public.meeting_agenda_items i set decision_number = n.rn from (
    select id, case when item_status = 'open' and trim(decision) <> ''
      then count(*) filter (where item_status = 'open' and trim(decision) <> '') over (order by position, created_at, id) end as rn
    from public.meeting_agenda_items where meeting_id = p_meeting) n
  where i.id = n.id;
  insert into public.meeting_attendance (meeting_id, apartment_id, status)
  select p_meeting, a.id, 'absent' from public.apartments a
  where a.building_id = m.building_id and a.archived_at is null
    and not exists (select 1 from public.meeting_attendance t where t.meeting_id = p_meeting and t.apartment_id = a.id);
  update public.meetings set status = 'closed', reopened_from = null,
    closed_at = case when v_fix then m.reopened_from else greatest(coalesce(p_closed_at, now()), opened_at) end
  where id = p_meeting;
  insert into public.meeting_events (meeting_id, kind) values (p_meeting, case when v_fix then 'reclosed' else 'closed' end);
end;
$$;
