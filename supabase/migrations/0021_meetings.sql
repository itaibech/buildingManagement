-- 0021 meetings (Task 24): committee / tenants meetings (ישיבת ועד / אסיפת דיירים), run formally and archived.
--   * Lifecycle draft → invited → in_progress → closed → published. The state moves only through admin-only
--     SECURITY DEFINER RPCs (invite_meeting, update_meeting_invitation, postpone_meeting, open_meeting, close_meeting,
--     sign_meeting, publish_meeting, add_addendum), each checking its preconditions. Precondition errors carry a
--     machine token in the message ('meeting:<reason>') that the app maps to Hebrew.
--   * Guard triggers lock edits by state for API users: lifecycle columns are RPC-only; attendance, agenda items and
--     votes are rejected once the meeting is closed (corrections go through addenda).
--   * Quorum: meeting_quorum() counts present + proxy apartments against the rule (majority floor(N/2)+1, a % rounded
--     up, or a fixed number). Opening needs the quorum or a recorded one-hour postponement.
--   * Visibility (RLS): admins see everything. Residents with the new 'meetings' permission (on for the default group,
--     since the law requires publishing to all members) see invited and published meetings, the agenda titles of an
--     invited one (meeting_agenda_titles), the full agenda rows only once published;
--     attendance, signatures and addenda only once published; never drafts, live or unpublished closed meetings.
--   * Storage: private bucket 'meeting-files' (signatures, proxy forms, scanned protocols), `<meeting_id>/<uuid>.<ext>`.
--   * announcements.link: an in-app path (the invitation and the publication link to the meeting page).
--   * email_log.kind gains 'meeting' (the send-email function's invite / update / published emails).

-- ---------------------------------------------------------------- permission
insert into public.permissions (key, label, description, sort_order) values
  ('meetings', 'ישיבות ופרוטוקולים', 'זימונים לישיבות ועד ולאסיפות דיירים, ופרוטוקולים שפורסמו', 8);
insert into public.group_permissions (group_id, permission)
select id, 'meetings' from public.user_groups where is_default
on conflict do nothing;

-- ---------------------------------------------------------------- announcements link, email kind
alter table public.announcements add column link text
  check (link is null or link ~ '^/[a-z0-9/-]{1,100}$');
alter table public.email_log drop constraint email_log_kind_check;
alter table public.email_log add constraint email_log_kind_check
  check (kind in ('announcement', 'ticket', 'debt', 'test', 'meeting'));

-- ---------------------------------------------------------------- file paths
-- `<meeting_id>/<uuid>.<ext>`, lower-case uuids, images and PDF only.
create function public.is_meeting_storage_path(p_name text) returns boolean
language sql immutable set search_path = ''
as $$
  select coalesce(p_name ~ ('^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/'
    || '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(png|jpg|jpeg|webp|heic|heif|pdf)$'), false);
$$;
-- The same, inside one meeting's folder.
create function public.is_meeting_file_path(p_name text, p_meeting uuid) returns boolean
language sql immutable set search_path = ''
as $$
  select public.is_meeting_storage_path(p_name) and split_part(p_name, '/', 1) = p_meeting::text;
$$;
revoke execute on function public.is_meeting_storage_path(text) from public, anon;
revoke execute on function public.is_meeting_file_path(text, uuid) from public, anon;
grant execute on function public.is_meeting_storage_path(text) to authenticated;
grant execute on function public.is_meeting_file_path(text, uuid) to authenticated;

-- ---------------------------------------------------------------- tables
create table public.meetings (
  id uuid primary key default gen_random_uuid(),
  building_id uuid not null default public.default_building_id() references public.buildings on delete cascade,
  kind text not null default 'committee' check (kind in ('committee', 'general')),
  title text not null check (char_length(trim(title)) between 1 and 200),
  scheduled_at timestamptz not null,
  location text not null default '' check (char_length(location) <= 200),
  quorum_mode text not null default 'majority' check (quorum_mode in ('majority', 'percent', 'fixed')),
  quorum_value int,
  quorum_note text not null default '' check (char_length(quorum_note) <= 300),
  status text not null default 'draft' check (status in ('draft', 'invited', 'in_progress', 'closed', 'published')),
  invited_at timestamptz,
  invite_announcement_id uuid references public.announcements on delete set null,
  postponed_at timestamptz,
  postponed_to timestamptz,
  opened_at timestamptz,
  chair_name text not null default '' check (char_length(chair_name) <= 120),
  secretary_name text not null default '' check (char_length(secretary_name) <= 120),
  closed_at timestamptz,
  published_at timestamptz,
  publish_announcement_id uuid references public.announcements on delete set null,
  created_by uuid default auth.uid() references auth.users on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint meetings_quorum_value check (
    (quorum_mode = 'majority' and quorum_value is null)
    or (quorum_mode = 'percent' and quorum_value between 1 and 100)
    or (quorum_mode = 'fixed' and quorum_value between 1 and 10000))
);
create index meetings_building_status_idx on public.meetings (building_id, status, scheduled_at desc);
create index meetings_invite_announcement_idx on public.meetings (invite_announcement_id);
create index meetings_publish_announcement_idx on public.meetings (publish_announcement_id);
create index meetings_created_by_idx on public.meetings (created_by);

create table public.meeting_agenda_items (
  id uuid primary key default gen_random_uuid(),
  meeting_id uuid not null references public.meetings on delete cascade,
  position int not null default 0,
  title text not null check (char_length(trim(title)) between 1 and 300),
  discussion text not null default '' check (char_length(discussion) <= 10000),
  votes_for int check (votes_for >= 0),
  votes_against int check (votes_against >= 0),
  votes_abstain int check (votes_abstain >= 0),
  decision text not null default '' check (char_length(decision) <= 5000),
  decision_number int,
  item_status text not null default 'open' check (item_status in ('open', 'removed', 'deferred')),
  added_during_meeting boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint meeting_votes_all_or_none check (
    (votes_for is null) = (votes_against is null) and (votes_for is null) = (votes_abstain is null))
);
create index meeting_agenda_items_meeting_idx on public.meeting_agenda_items (meeting_id, position);

-- apartment_number is a snapshot, so the protocol stays whole if an apartment is later removed.
create table public.meeting_attendance (
  id uuid primary key default gen_random_uuid(),
  meeting_id uuid not null references public.meetings on delete cascade,
  apartment_id uuid references public.apartments on delete set null,
  apartment_number int not null default 0,
  status text not null check (status in ('present', 'proxy', 'absent')),
  attendee_name text not null default '' check (char_length(attendee_name) <= 120),
  proxy_name text not null default '' check (char_length(proxy_name) <= 120),
  proxy_file_path text check (proxy_file_path is null or public.is_meeting_file_path(proxy_file_path, meeting_id)),
  updated_at timestamptz not null default now(),
  unique (meeting_id, apartment_id)
);
create index meeting_attendance_apartment_idx on public.meeting_attendance (apartment_id);

create table public.meeting_signatures (
  id uuid primary key default gen_random_uuid(),
  meeting_id uuid not null references public.meetings on delete cascade,
  role text not null check (role in ('chair', 'secretary', 'attendee')),
  method text not null default 'drawn' check (method in ('drawn', 'scan')),
  signer_name text not null check (char_length(trim(signer_name)) between 1 and 120),
  image_path text not null check (public.is_meeting_file_path(image_path, meeting_id)),
  signed_at timestamptz not null default now(),
  recorded_by uuid default auth.uid() references auth.users on delete set null
);
create unique index meeting_signatures_one_per_role on public.meeting_signatures (meeting_id, role) where role in ('chair', 'secretary');
create index meeting_signatures_meeting_idx on public.meeting_signatures (meeting_id);
create index meeting_signatures_recorded_by_idx on public.meeting_signatures (recorded_by);

create table public.meeting_addenda (
  id uuid primary key default gen_random_uuid(),
  meeting_id uuid not null references public.meetings on delete cascade,
  body text not null check (char_length(trim(body)) between 1 and 5000),
  created_by uuid default auth.uid() references auth.users on delete set null,
  created_at timestamptz not null default now()
);
create index meeting_addenda_meeting_idx on public.meeting_addenda (meeting_id, created_at);
create index meeting_addenda_created_by_idx on public.meeting_addenda (created_by);

create table public.meeting_events (
  id uuid primary key default gen_random_uuid(),
  meeting_id uuid not null references public.meetings on delete cascade,
  kind text not null check (kind in ('invited', 'edited', 'agenda_edited', 'invitation_updated', 'postponed', 'opened',
    'closed', 'signed', 'published', 'addendum')),
  details jsonb not null default '{}',
  actor uuid default auth.uid() references auth.users on delete set null,
  created_at timestamptz not null default clock_timestamp()
);
create index meeting_events_meeting_idx on public.meeting_events (meeting_id, created_at);
create index meeting_events_actor_idx on public.meeting_events (actor);

-- ---------------------------------------------------------------- quorum
-- Voting units are the building's apartments. Security invoker: a resident sees attendance only once published.
create function public.meeting_quorum(p_meeting uuid)
returns table (total int, attending int, required int, met boolean)
language sql stable security invoker set search_path = ''
as $$
  with m as (select * from public.meetings where id = p_meeting),
  n as (select count(a.id)::int as c from m left join public.apartments a on a.building_id = m.building_id),
  att as (select count(*)::int as c from public.meeting_attendance where meeting_id = p_meeting and status in ('present', 'proxy')),
  req as (
    select case m.quorum_mode
      when 'majority' then n.c / 2 + 1
      when 'percent' then greatest(1, ceil(n.c * m.quorum_value / 100.0)::int)
      else m.quorum_value end as r
    from m, n
  )
  select n.c, att.c, req.r, att.c >= req.r from n, att, req;
$$;
revoke execute on function public.meeting_quorum(uuid) from public, anon;
grant execute on function public.meeting_quorum(uuid) to authenticated;

-- ---------------------------------------------------------------- guards (API users; RPCs run as the owner)
create function public.meetings_guard() returns trigger
language plpgsql set search_path = ''
as $$
declare
  v_editable text[];
begin
  if current_user not in ('authenticated', 'anon') then
    return coalesce(new, old);
  end if;
  if tg_op = 'INSERT' then
    if new.status <> 'draft' or coalesce(new.invited_at, new.postponed_at, new.postponed_to, new.opened_at, new.closed_at,
        new.published_at) is not null or coalesce(new.invite_announcement_id, new.publish_announcement_id) is not null then
      raise exception 'A meeting starts as a draft' using errcode = '42501';
    end if;
    new.created_by := auth.uid();
    return new;
  end if;
  if tg_op = 'DELETE' then
    if old.status <> 'draft' then
      raise exception 'Only a draft meeting can be deleted' using errcode = '42501';
    end if;
    return old;
  end if;
  if old.status in ('closed', 'published') then
    raise exception 'The meeting is closed: add a correction instead' using errcode = '42501';
  end if;
  v_editable := case when old.status = 'in_progress' then array['chair_name', 'secretary_name', 'updated_at']
    else array['title', 'kind', 'scheduled_at', 'location', 'quorum_mode', 'quorum_value', 'quorum_note', 'chair_name',
      'secretary_name', 'updated_at'] end;
  if (to_jsonb(new) - v_editable) is distinct from (to_jsonb(old) - v_editable) then
    raise exception 'Use the meeting actions to change its state' using errcode = '42501';
  end if;
  new.updated_at := now();
  return new;
end;
$$;
revoke execute on function public.meetings_guard() from public, anon, authenticated;
create trigger meetings_guard
  before insert or update or delete on public.meetings
  for each row execute function public.meetings_guard();

-- Agenda and attendance rows: never once closed; the meeting can't change under them.
create function public.meeting_children_guard() returns trigger
language plpgsql set search_path = ''
as $$
declare
  v_meeting uuid;
  v_status text;
begin
  if current_user not in ('authenticated', 'anon') then
    return coalesce(new, old);
  end if;
  v_meeting := case when tg_op = 'DELETE' then old.meeting_id else new.meeting_id end;
  if tg_op = 'UPDATE' and new.meeting_id is distinct from old.meeting_id then
    raise exception 'A row cannot move to another meeting' using errcode = '42501';
  end if;
  select status into v_status from public.meetings where id = v_meeting;
  if v_status in ('closed', 'published') then
    raise exception 'The meeting is closed: add a correction instead' using errcode = '42501';
  end if;
  if tg_table_name = 'meeting_attendance' and v_status not in ('invited', 'in_progress') then
    raise exception 'Attendance is taken once the meeting is invited' using errcode = '42501';
  end if;
  return coalesce(new, old);
end;
$$;
revoke execute on function public.meeting_children_guard() from public, anon, authenticated;
create trigger meeting_agenda_items_guard
  before insert or update or delete on public.meeting_agenda_items
  for each row execute function public.meeting_children_guard();
create trigger meeting_attendance_guard
  before insert or update or delete on public.meeting_attendance
  for each row execute function public.meeting_children_guard();

-- Agenda items: votes only during the meeting, decision numbers by close_meeting only, items added during the
-- meeting are marked; for every role, a vote total never exceeds the attendees (present + proxy).
create function public.meeting_items_rules() returns trigger
language plpgsql set search_path = ''
as $$
declare
  v_status text;
  v_attending int;
begin
  select status into v_status from public.meetings where id = new.meeting_id;
  if current_user in ('authenticated', 'anon') then
    if new.decision_number is distinct from (case when tg_op = 'UPDATE' then old.decision_number end) then
      raise exception 'Decision numbers are assigned when the meeting closes' using errcode = '42501';
    end if;
    if v_status <> 'in_progress' and new.votes_for is not null
        and (tg_op = 'INSERT' or row(new.votes_for, new.votes_against, new.votes_abstain)
          is distinct from row(old.votes_for, old.votes_against, old.votes_abstain)) then
      raise exception 'Votes are recorded during the meeting' using errcode = '42501';
    end if;
    if tg_op = 'INSERT' then
      new.added_during_meeting := v_status = 'in_progress';
    else
      new.added_during_meeting := old.added_during_meeting;
    end if;
  end if;
  if new.votes_for is not null then
    select count(*) into v_attending from public.meeting_attendance
    where meeting_id = new.meeting_id and status in ('present', 'proxy');
    if new.votes_for + new.votes_against + new.votes_abstain > v_attending then
      raise exception 'meeting:votes the vote total exceeds the attendees' using errcode = '23514';
    end if;
  end if;
  new.updated_at := now();
  return new;
end;
$$;
revoke execute on function public.meeting_items_rules() from public, anon, authenticated;
create trigger meeting_items_rules
  before insert or update on public.meeting_agenda_items
  for each row execute function public.meeting_items_rules();

-- Attendance: the apartment must be in the meeting's building; its number is kept with the row.
create function public.meeting_attendance_rules() returns trigger
language plpgsql set search_path = ''
as $$
declare
  v_number int;
begin
  if tg_op = 'UPDATE' and new.apartment_id is not distinct from old.apartment_id then
    new.apartment_number := old.apartment_number;
  else
    select a.number into v_number from public.apartments a join public.meetings m on m.building_id = a.building_id
    where a.id = new.apartment_id and m.id = new.meeting_id;
    if v_number is null then
      raise exception 'The apartment is not in the meeting''s building' using errcode = '23514';
    end if;
    new.apartment_number := v_number;
  end if;
  new.updated_at := now();
  return new;
end;
$$;
revoke execute on function public.meeting_attendance_rules() from public, anon, authenticated;
create trigger meeting_attendance_rules
  before insert or update on public.meeting_attendance
  for each row execute function public.meeting_attendance_rules();

-- ---------------------------------------------------------------- audit log of edits after the invitation
create function public.meetings_log_edit() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_key text;
  v_diff jsonb := '{}';
begin
  if old.status = 'invited' and new.status = 'invited' then
    foreach v_key in array array['title', 'kind', 'scheduled_at', 'location', 'quorum_mode', 'quorum_value', 'quorum_note'] loop
      if to_jsonb(old) -> v_key is distinct from to_jsonb(new) -> v_key then
        v_diff := v_diff || jsonb_build_object(v_key, jsonb_build_object('from', to_jsonb(old) -> v_key, 'to', to_jsonb(new) -> v_key));
      end if;
    end loop;
    if v_diff <> '{}' then
      insert into public.meeting_events (meeting_id, kind, details) values (new.id, 'edited', v_diff);
    end if;
  end if;
  return null;
end;
$$;
revoke execute on function public.meetings_log_edit() from public, anon, authenticated;
create trigger meetings_log_edit
  after update on public.meetings
  for each row execute function public.meetings_log_edit();

create function public.meeting_agenda_log() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_row public.meeting_agenda_items := case when tg_op = 'DELETE' then old else new end;
begin
  if tg_op = 'UPDATE' and new.title is not distinct from old.title and new.position is not distinct from old.position then
    return null;
  end if;
  if exists (select 1 from public.meetings where id = v_row.meeting_id and status = 'invited') then
    insert into public.meeting_events (meeting_id, kind, details)
    values (v_row.meeting_id, 'agenda_edited', jsonb_build_object('op', lower(tg_op), 'title', v_row.title, 'position', v_row.position));
  end if;
  return null;
end;
$$;
revoke execute on function public.meeting_agenda_log() from public, anon, authenticated;
create trigger meeting_agenda_log
  after insert or update or delete on public.meeting_agenda_items
  for each row execute function public.meeting_agenda_log();

-- ---------------------------------------------------------------- RPC helpers (owner only)
-- The admin's meeting, row-locked; raises 42501 for non-admins and P0002 when missing.
create function public.meeting_lock(p_meeting uuid) returns public.meetings
language plpgsql security definer set search_path = ''
as $$
declare
  m public.meetings;
begin
  if not public.is_admin() then
    raise exception 'admin only' using errcode = '42501';
  end if;
  select * into m from public.meetings where id = p_meeting for update;
  if m.id is null then
    raise exception 'meeting:not_found' using errcode = 'P0002';
  end if;
  return m;
end;
$$;
revoke execute on function public.meeting_lock(uuid) from public, anon, authenticated;

create function public.meeting_require(p_ok boolean, p_reason text) returns void
language plpgsql set search_path = ''
as $$
begin
  if not coalesce(p_ok, false) then
    raise exception 'meeting:%', p_reason using errcode = '22023';
  end if;
end;
$$;
revoke execute on function public.meeting_require(boolean, text) from public, anon, authenticated;

create function public.meeting_local(p_at timestamptz, p_format text) returns text
language sql stable set search_path = ''
as $$ select to_char(p_at at time zone 'Asia/Jerusalem', p_format); $$;
revoke execute on function public.meeting_local(timestamptz, text) from public, anon, authenticated;

-- The invitation text: type, date and time, place and the numbered agenda.
create function public.meeting_invitation_body(p_meeting uuid) returns text
language sql stable set search_path = ''
as $$
  select concat_ws(E'\n',
    case m.kind when 'general' then 'אסיפת דיירים כללית' else 'ישיבת ועד' end || ': ' || m.title,
    'מועד: ' || public.meeting_local(m.scheduled_at, 'DD/MM/YYYY') || ' בשעה ' || public.meeting_local(m.scheduled_at, 'HH24:MI'),
    'מקום: ' || coalesce(nullif(trim(m.location), ''), '—'),
    '',
    'סדר היום:',
    (select string_agg(row_number || '. ' || title, E'\n' order by row_number) from (
      select row_number() over (order by position, created_at, id) as row_number, title
      from public.meeting_agenda_items where meeting_id = m.id and item_status = 'open') items),
    '',
    'הנוכחות חשובה לקיום מניין חוקי. דייר שאינו יכול להגיע רשאי למנות מיופה כוח.')
  from public.meetings m where m.id = p_meeting;
$$;
revoke execute on function public.meeting_invitation_body(uuid) from public, anon, authenticated;

create function public.meeting_announce(m public.meetings, p_title text, p_body text, p_pinned boolean) returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  v_id uuid;
begin
  insert into public.announcements (building_id, title, body, pinned, expires_at, link)
  values (m.building_id, left(p_title, 300), p_body, p_pinned,
    case when p_pinned then (m.scheduled_at at time zone 'Asia/Jerusalem')::date end, '/meetings/' || m.id)
  returning id into v_id;
  return v_id;
end;
$$;
revoke execute on function public.meeting_announce(public.meetings, text, text, boolean) from public, anon, authenticated;

create function public.meeting_kind_label(p_kind text) returns text
language sql immutable set search_path = ''
as $$ select case p_kind when 'general' then 'אסיפת דיירים כללית' else 'ישיבת ועד' end; $$;
revoke execute on function public.meeting_kind_label(text) from public, anon, authenticated;

-- ---------------------------------------------------------------- RPCs (admin only)
-- Draft → invited: a pinned announcement until the meeting date. Under 5 days needs p_confirm_short_notice.
create function public.invite_meeting(p_meeting uuid, p_confirm_short_notice boolean default false) returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  m public.meetings := public.meeting_lock(p_meeting);
  v_short boolean := m.scheduled_at < now() + interval '5 days';
  v_ann uuid;
begin
  perform public.meeting_require(m.status = 'draft', 'state');
  perform public.meeting_require(exists (select 1 from public.meeting_agenda_items where meeting_id = p_meeting), 'empty_agenda');
  perform public.meeting_require(m.scheduled_at > now(), 'past');
  perform public.meeting_require(not v_short or p_confirm_short_notice, 'short_notice');
  v_ann := public.meeting_announce(m, 'זימון ל' || public.meeting_kind_label(m.kind) || ': ' || m.title,
    public.meeting_invitation_body(p_meeting), true);
  update public.meetings set status = 'invited', invited_at = now(), invite_announcement_id = v_ann where id = p_meeting;
  insert into public.meeting_events (meeting_id, kind, details)
  values (p_meeting, 'invited', jsonb_build_object('announcement_id', v_ann, 'short_notice', v_short));
  return v_ann;
end;
$$;

-- Invited: re-announces the current details ("עדכון זימון"); the previous invitation is unpinned and expired.
create function public.update_meeting_invitation(p_meeting uuid) returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  m public.meetings := public.meeting_lock(p_meeting);
  v_ann uuid;
begin
  perform public.meeting_require(m.status = 'invited', 'state');
  perform public.meeting_require(exists (select 1 from public.meeting_agenda_items where meeting_id = p_meeting), 'empty_agenda');
  update public.announcements set pinned = false, expires_at = (now() at time zone 'Asia/Jerusalem')::date - 1
  where id = m.invite_announcement_id;
  v_ann := public.meeting_announce(m, 'עדכון זימון ל' || public.meeting_kind_label(m.kind) || ': ' || m.title,
    public.meeting_invitation_body(p_meeting), true);
  update public.meetings set invite_announcement_id = v_ann where id = p_meeting;
  insert into public.meeting_events (meeting_id, kind, details) values (p_meeting, 'invitation_updated', jsonb_build_object(
    'announcement_id', v_ann, 'scheduled_at', m.scheduled_at, 'location', m.location));
  return v_ann;
end;
$$;

-- No quorum: postponed by one hour, after which the meeting is valid with whoever is present.
create function public.postpone_meeting(p_meeting uuid) returns timestamptz
language plpgsql security definer set search_path = ''
as $$
declare
  m public.meetings := public.meeting_lock(p_meeting);
  v_to timestamptz := greatest(m.scheduled_at, now()) + interval '1 hour';
begin
  perform public.meeting_require(m.status = 'invited', 'state');
  perform public.meeting_require(m.postponed_at is null, 'already_postponed');
  perform public.meeting_require(not (select q.met from public.meeting_quorum(p_meeting) q), 'quorum_met');
  update public.meetings set postponed_at = now(), postponed_to = v_to where id = p_meeting;
  insert into public.meeting_events (meeting_id, kind, details)
  values (p_meeting, 'postponed', (select to_jsonb(q) from public.meeting_quorum(p_meeting) q) || jsonb_build_object('to', v_to));
  return v_to;
end;
$$;

-- Invited → in_progress: needs the quorum (or a recorded postponement, and then not before the postponed time),
-- a chair and a recorder.
-- p_opened_at null = now() (the app sends null unless the recorder typed a time).
create function public.open_meeting(p_meeting uuid, p_opened_at timestamptz default null, p_chair text default '',
  p_secretary text default '') returns void
language plpgsql security definer set search_path = ''
as $$
declare
  m public.meetings := public.meeting_lock(p_meeting);
begin
  perform public.meeting_require(m.status = 'invited', 'state');
  perform public.meeting_require(m.postponed_at is not null or (select q.met from public.meeting_quorum(p_meeting) q), 'no_quorum');
  -- After a postponement the meeting opens no earlier than the postponed time, by the real clock and by the
  -- recorded opening time; an opening time may not be in the future (5 minutes' leeway for clock drift).
  perform public.meeting_require(m.postponed_at is null or (now() >= m.postponed_to
    and coalesce(p_opened_at, now()) >= m.postponed_to), 'too_early');
  perform public.meeting_require(coalesce(p_opened_at, now()) <= now() + interval '5 minutes', 'future');
  perform public.meeting_require(trim(coalesce(p_chair, '')) <> '' and trim(coalesce(p_secretary, '')) <> '', 'roles');
  update public.meetings set status = 'in_progress', opened_at = coalesce(p_opened_at, now()),
    chair_name = left(trim(p_chair), 120), secretary_name = left(trim(p_secretary), 120)
  where id = p_meeting;
  insert into public.meeting_events (meeting_id, kind, details)
  values (p_meeting, 'opened', (select to_jsonb(q) from public.meeting_quorum(p_meeting) q)
    || jsonb_build_object('postponed', m.postponed_at is not null));
end;
$$;

-- In progress → closed: re-checks every vote total, numbers the decisions (agenda order; open items with a
-- decision), records the absent apartments and the closing time. The content locks.
create function public.close_meeting(p_meeting uuid, p_closed_at timestamptz default now()) returns void
language plpgsql security definer set search_path = ''
as $$
declare
  m public.meetings := public.meeting_lock(p_meeting);
  v_attending int := (select q.attending from public.meeting_quorum(p_meeting) q);
begin
  perform public.meeting_require(m.status = 'in_progress', 'state');
  perform public.meeting_require(not exists (select 1 from public.meeting_agenda_items where meeting_id = p_meeting
    and votes_for is not null and votes_for + votes_against + votes_abstain > v_attending), 'votes');
  update public.meeting_agenda_items i set decision_number = n.rn from (
    select id, case when item_status = 'open' and trim(decision) <> ''
      then count(*) filter (where item_status = 'open' and trim(decision) <> '') over (order by position, created_at, id) end as rn
    from public.meeting_agenda_items where meeting_id = p_meeting) n
  where i.id = n.id;
  -- Freeze the absent list: every apartment without a record is recorded absent.
  insert into public.meeting_attendance (meeting_id, apartment_id, status)
  select p_meeting, a.id, 'absent' from public.apartments a
  where a.building_id = m.building_id
    and not exists (select 1 from public.meeting_attendance t where t.meeting_id = p_meeting and t.apartment_id = a.id);
  update public.meetings set status = 'closed', closed_at = greatest(coalesce(p_closed_at, now()), opened_at) where id = p_meeting;
  insert into public.meeting_events (meeting_id, kind) values (p_meeting, 'closed');
end;
$$;

-- Closed: a drawn signature (PNG) or a scanned signed protocol, stored in the meeting's folder. The chair and the
-- recorder sign once each (a new signature replaces theirs); attendees may add signatures.
create function public.sign_meeting(p_meeting uuid, p_role text, p_signer_name text, p_image_path text,
  p_method text default 'drawn') returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  m public.meetings := public.meeting_lock(p_meeting);
  v_id uuid;
begin
  perform public.meeting_require(m.status = 'closed', 'state');
  perform public.meeting_require(p_role in ('chair', 'secretary', 'attendee') and p_method in ('drawn', 'scan'), 'role');
  perform public.meeting_require(trim(coalesce(p_signer_name, '')) <> '', 'name');
  perform public.meeting_require(public.is_meeting_file_path(p_image_path, p_meeting), 'path');
  perform public.meeting_require(p_method <> 'drawn' or p_image_path like '%.png', 'png');
  perform public.meeting_require(exists (select 1 from storage.objects
    where bucket_id = 'meeting-files' and name = p_image_path), 'missing_file');
  if p_role <> 'attendee' then
    delete from public.meeting_signatures where meeting_id = p_meeting and role = p_role;
  end if;
  insert into public.meeting_signatures (meeting_id, role, method, signer_name, image_path)
  values (p_meeting, p_role, p_method, left(trim(p_signer_name), 120), p_image_path) returning id into v_id;
  insert into public.meeting_events (meeting_id, kind, details)
  values (p_meeting, 'signed', jsonb_build_object('role', p_role, 'method', p_method, 'name', trim(p_signer_name)));
  return v_id;
end;
$$;

-- Closed → published (the archive): needs the chair's and the recorder's signatures; announces the protocol and
-- unpins the invitation.
create function public.publish_meeting(p_meeting uuid) returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  m public.meetings := public.meeting_lock(p_meeting);
  v_ann uuid;
begin
  perform public.meeting_require(m.status = 'closed', 'state');
  perform public.meeting_require((select count(distinct role) from public.meeting_signatures
    where meeting_id = p_meeting and role in ('chair', 'secretary')) = 2, 'signatures');
  v_ann := public.meeting_announce(m, 'פורסם פרוטוקול ' || m.title || ' מתאריך ' || public.meeting_local(coalesce(m.opened_at, m.scheduled_at), 'DD/MM/YYYY'),
    'פרוטוקול ה' || public.meeting_kind_label(m.kind) || ' פורסם וזמין לכל הדיירים באפליקציה, כולל מי שלא נכח.', false);
  update public.announcements set pinned = false where id = m.invite_announcement_id;
  update public.meetings set status = 'published', published_at = now(), publish_announcement_id = v_ann where id = p_meeting;
  insert into public.meeting_events (meeting_id, kind, details) values (p_meeting, 'published', jsonb_build_object('announcement_id', v_ann));
  return v_ann;
end;
$$;

-- Closed or published: a correction ("תיקון לפרוטוקול"), printed as an appendix.
create function public.add_addendum(p_meeting uuid, p_body text) returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  m public.meetings := public.meeting_lock(p_meeting);
  v_id uuid;
begin
  perform public.meeting_require(m.status in ('closed', 'published'), 'state');
  perform public.meeting_require(char_length(trim(coalesce(p_body, ''))) between 1 and 5000, 'body');
  insert into public.meeting_addenda (meeting_id, body) values (p_meeting, trim(p_body)) returning id into v_id;
  insert into public.meeting_events (meeting_id, kind, details) values (p_meeting, 'addendum', jsonb_build_object('addendum_id', v_id));
  return v_id;
end;
$$;

do $$
declare
  f text;
begin
  foreach f in array array['invite_meeting(uuid, boolean)', 'update_meeting_invitation(uuid)', 'postpone_meeting(uuid)',
    'open_meeting(uuid, timestamptz, text, text)', 'close_meeting(uuid, timestamptz)',
    'sign_meeting(uuid, text, text, text, text)', 'publish_meeting(uuid)', 'add_addendum(uuid, text)'] loop
    execute format('revoke execute on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end;
$$;

-- ---------------------------------------------------------------- RLS
alter table public.meetings enable row level security;
alter table public.meeting_agenda_items enable row level security;
alter table public.meeting_attendance enable row level security;
alter table public.meeting_signatures enable row level security;
alter table public.meeting_addenda enable row level security;
alter table public.meeting_events enable row level security;

-- Signatures, addenda and the audit log are written by the RPCs only.
revoke insert, update, delete on public.meeting_signatures, public.meeting_addenda, public.meeting_events from anon, authenticated;
revoke all on public.meetings, public.meeting_agenda_items, public.meeting_attendance from anon;

create policy meetings_admin on public.meetings for all to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));
create policy meetings_select on public.meetings for select to authenticated
  using ((select public.has_permission('meetings')) and status in ('invited', 'published'));

create policy meeting_agenda_admin on public.meeting_agenda_items for all to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));
-- Residents read agenda rows (discussion, votes, decisions) only once published. While invited they get the order
-- and titles only, through meeting_agenda_titles() (RLS hides rows, not columns).
create policy meeting_agenda_select on public.meeting_agenda_items for select to authenticated
  using ((select public.has_permission('meetings')) and exists (
    select 1 from public.meetings m where m.id = meeting_id and m.status = 'published'));

create function public.meeting_agenda_titles(p_meeting uuid) returns table (id uuid, item_position int, title text)
language sql stable security definer set search_path = ''
as $$
  select i.id, i.position, i.title from public.meeting_agenda_items i join public.meetings m on m.id = i.meeting_id
  where i.meeting_id = p_meeting and i.item_status = 'open'
    and (public.is_admin() or (public.has_permission('meetings') and m.status in ('invited', 'published')))
  order by i.position, i.created_at, i.id;
$$;
revoke execute on function public.meeting_agenda_titles(uuid) from public, anon;
grant execute on function public.meeting_agenda_titles(uuid) to authenticated;

create policy meeting_attendance_admin on public.meeting_attendance for all to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));
create policy meeting_attendance_select on public.meeting_attendance for select to authenticated
  using ((select public.has_permission('meetings')) and exists (
    select 1 from public.meetings m where m.id = meeting_id and m.status = 'published'));

create policy meeting_signatures_select on public.meeting_signatures for select to authenticated
  using ((select public.is_admin()) or ((select public.has_permission('meetings')) and exists (
    select 1 from public.meetings m where m.id = meeting_id and m.status = 'published')));

create policy meeting_addenda_select on public.meeting_addenda for select to authenticated
  using ((select public.is_admin()) or ((select public.has_permission('meetings')) and exists (
    select 1 from public.meetings m where m.id = meeting_id and m.status = 'published')));

create policy meeting_events_admin_select on public.meeting_events for select to authenticated
  using ((select public.is_admin()));

-- ---------------------------------------------------------------- storage
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('meeting-files', 'meeting-files', false, 10485760,
  array['image/png', 'image/jpeg', 'image/webp', 'image/heic', 'image/heif', 'application/pdf'])
on conflict (id) do update set
  public = excluded.public, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

-- The state of the meeting a storage object belongs to: for admins always, for others only once published (null
-- otherwise, and for a malformed path). Never casts a non-uuid.
create function public.meeting_file_status(p_name text) returns text
language sql stable security definer set search_path = ''
as $$
  select case when public.is_meeting_storage_path(p_name)
    then (select status from public.meetings where id = split_part(p_name, '/', 1)::uuid
      and (public.is_admin() or status = 'published')) end;
$$;
revoke execute on function public.meeting_file_status(text) from public, anon;
grant execute on function public.meeting_file_status(text) to authenticated;

-- Read: admins; residents with 'meetings' for published meetings only. Upload: admins, valid path, not yet published.
create policy meeting_files_read on storage.objects for select to authenticated
  using (bucket_id = 'meeting-files' and ((select public.is_admin())
    or ((select public.has_permission('meetings')) and public.meeting_file_status(name) = 'published')));
create policy meeting_files_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'meeting-files' and (select public.is_admin())
    and coalesce(public.meeting_file_status(name), 'published') <> 'published');
-- Overwrite and delete only before the meeting closes: signatures and scans of a closed meeting stay as recorded.
create policy meeting_files_update on storage.objects for update to authenticated
  using (bucket_id = 'meeting-files' and (select public.is_admin())
    and coalesce(public.meeting_file_status(name), 'closed') in ('draft', 'invited', 'in_progress'))
  with check (bucket_id = 'meeting-files' and (select public.is_admin())
    and coalesce(public.meeting_file_status(name), 'closed') in ('draft', 'invited', 'in_progress'));
create policy meeting_files_delete on storage.objects for delete to authenticated
  using (bucket_id = 'meeting-files' and (select public.is_admin())
    and coalesce(public.meeting_file_status(name), 'closed') in ('draft', 'invited', 'in_progress'));
