-- 0028 editing the protocol before publication ("עריכת הפרוטוקול"): reopening a closed, unsigned meeting.
--   * reopen_meeting (admin only): closed → in_progress, only while the protocol has no signatures and no addenda
--     (after either, corrections go through add_addendum as before). Refusals carry 'meeting:<reason>' tokens:
--     state (not closed: published or any other state), signed, has_addenda.
--   * meetings.reopened_from: the closing time of the close being corrected. Set by reopen_meeting, cleared by
--     close_meeting; non-null exactly while the meeting is open for correction (status in_progress), which is how the
--     triggers and the app tell a correction from a live meeting. opened_at is kept.
--   * The existing guards lock by status only, so attendance, agenda items and votes are editable again while
--     in_progress and locked again once closed: no guard changes.
--   * Arrival times: meeting_attendance_times stamps arrivals / departures with now() during a live meeting. During a
--     correction it stamps nothing: an apartment marked present counts from the opening (arrived_at null) unless the
--     admin explicitly sets arrived_at (or left_at for an early departure), within the opening and the original close.
--   * close_meeting: the closing time defaults (p_closed_at null) to reopened_from, so re-closing keeps the original
--     time; the vote re-check, the decision numbering and the absent list run again as on the first close (decision
--     numbers may change; nothing is signed yet). Logged as 'reopened' (with the original closed_at) and 'closed'.

alter table public.meetings add column reopened_from timestamptz;

alter table public.meeting_events drop constraint meeting_events_kind_check;
alter table public.meeting_events add constraint meeting_events_kind_check
  check (kind in ('invited', 'edited', 'agenda_edited', 'invitation_updated', 'postponed', 'opened',
    'closed', 'signed', 'published', 'addendum', 'postponement_cancelled', 'reopened'));

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
-- Same as 0022 for a live meeting. During a correction (reopened_from set) there are no clock stamps. A time counts
-- as set by the admin when it differs from the stored one (on insert: when given), and must then lie between the
-- opening and the original close. Otherwise:
--   becoming present: from the opening (no arrival time, no departure);
--   becoming absent: absent all along (both times cleared), unless the admin set the departure time;
--   no status change: the stored times stay (a present row never has a departure).
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
    if v_is and not v_was and new.arrived_at is not distinct from v_old_arrival then
      new.arrived_at := null;
    elsif v_was and not v_is and new.left_at is not distinct from v_old_left then
      new.arrived_at := null;
      new.left_at := null;
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

-- ---------------------------------------------------------------- closing again
-- Same as 0022, except p_closed_at null = the original closing time after a correction (else now()), and
-- reopened_from is cleared. The default stays now() (a parameter default can't be dropped in place); the app always
-- sends the time, prefilled with the original one during a correction.
create or replace function public.close_meeting(p_meeting uuid, p_closed_at timestamptz default now()) returns void
language plpgsql security definer set search_path = ''
as $$
declare
  m public.meetings := public.meeting_lock(p_meeting);
begin
  perform public.meeting_require(m.status = 'in_progress', 'state');
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
    closed_at = greatest(coalesce(p_closed_at, m.reopened_from, now()), opened_at)
  where id = p_meeting;
  insert into public.meeting_events (meeting_id, kind, details)
  values (p_meeting, 'closed', case when m.reopened_from is not null then jsonb_build_object('reclosed', true) else '{}' end);
end;
$$;
