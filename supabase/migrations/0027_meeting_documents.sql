-- 0027 meeting documents and topic details in the invitation.
--   * meeting_documents: source documents attached to a meeting (the draft agenda as PDF / Word / a scan), stored in
--     the existing private 'meeting-files' bucket under the same `<meeting_id>/<uuid>.<ext>` scheme. The row keeps the
--     original file name. Visibility follows the bucket and the agenda rows: admins always; residents with the
--     'meetings' permission only once the meeting is published. Admins add documents until publication and remove
--     them until the meeting closes (the bucket's insert / delete rules), so a row and its file never disagree.
--   * The bucket and the path check also accept .docx.
--   * invite_meeting / update_meeting_invitation gain p_include_details (default false): the announcement then lists
--     each topic's details under its title. This is the admin's explicit choice to publish them; RLS is unchanged
--     (residents still read only titles of an unpublished agenda through meeting_agenda_titles).

-- ---------------------------------------------------------------- .docx in the bucket
create or replace function public.is_meeting_storage_path(p_name text) returns boolean
language sql immutable set search_path = ''
as $$
  select coalesce(p_name ~ ('^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/'
    || '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(png|jpg|jpeg|webp|heic|heif|pdf|docx)$'), false);
$$;

update storage.buckets set allowed_mime_types = array['image/png', 'image/jpeg', 'image/webp', 'image/heic', 'image/heif',
  'application/pdf', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document']
where id = 'meeting-files';

-- ---------------------------------------------------------------- documents
create table public.meeting_documents (
  id uuid primary key default gen_random_uuid(),
  meeting_id uuid not null references public.meetings on delete cascade,
  file_path text not null unique check (public.is_meeting_file_path(file_path, meeting_id)),
  file_name text not null check (char_length(trim(file_name)) between 1 and 200),
  size_bytes int not null check (size_bytes between 1 and 10485760),
  created_by uuid default auth.uid() references auth.users on delete set null,
  created_at timestamptz not null default now()
);
create index meeting_documents_meeting_idx on public.meeting_documents (meeting_id, created_at);
create index meeting_documents_created_by_idx on public.meeting_documents (created_by);

-- API users: add until published, remove until closed (as the bucket allows for the file itself).
create function public.meeting_documents_guard() returns trigger
language plpgsql set search_path = ''
as $$
declare
  v_status text;
begin
  if current_user not in ('authenticated', 'anon') then
    return coalesce(new, old);
  end if;
  select status into v_status from public.meetings where id = coalesce(new.meeting_id, old.meeting_id);
  if tg_op = 'INSERT' and v_status = 'published' then
    raise exception 'The protocol is published: documents are final' using errcode = '42501';
  end if;
  if tg_op = 'DELETE' and v_status in ('closed', 'published') then
    raise exception 'The meeting is closed: documents stay as recorded' using errcode = '42501';
  end if;
  if tg_op = 'INSERT' then
    new.created_by := auth.uid();
  end if;
  return coalesce(new, old);
end;
$$;
revoke execute on function public.meeting_documents_guard() from public, anon, authenticated;
create trigger meeting_documents_guard
  before insert or delete on public.meeting_documents
  for each row execute function public.meeting_documents_guard();

alter table public.meeting_documents enable row level security;
revoke all on public.meeting_documents from anon;
revoke update on public.meeting_documents from authenticated;

create policy meeting_documents_admin on public.meeting_documents for all to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));
create policy meeting_documents_select on public.meeting_documents for select to authenticated
  using ((select public.has_permission('meetings')) and exists (
    select 1 from public.meetings m where m.id = meeting_id and m.status = 'published'));

-- ---------------------------------------------------------------- invitation with topic details
drop function public.invite_meeting(uuid, boolean);
drop function public.update_meeting_invitation(uuid);
drop function public.meeting_invitation_body(uuid);

-- The invitation text: type, date and time, place and the numbered agenda; with p_details, each topic's details
-- indented under its title.
create function public.meeting_invitation_body(p_meeting uuid, p_details boolean default false) returns text
language sql stable set search_path = ''
as $$
  select concat_ws(E'\n',
    case m.kind when 'general' then 'אסיפת דיירים כללית' else 'ישיבת ועד' end || ': ' || m.title,
    'מועד: ' || public.meeting_local(m.scheduled_at, 'DD/MM/YYYY') || ' בשעה ' || public.meeting_local(m.scheduled_at, 'HH24:MI'),
    'מקום: ' || coalesce(nullif(trim(m.location), ''), '—'),
    '',
    'סדר היום:',
    (select string_agg(row_number || '. ' || title || case when p_details and trim(discussion) <> ''
        then E'\n' || regexp_replace(trim(discussion), '^', '   ', 'gn') else '' end, E'\n' order by row_number) from (
      select row_number() over (order by position, created_at, id) as row_number, title, discussion
      from public.meeting_agenda_items where meeting_id = m.id and item_status = 'open') items),
    '',
    'הנוכחות חשובה לקיום מניין חוקי. דייר שאינו יכול להגיע רשאי למנות מיופה כוח.')
  from public.meetings m where m.id = p_meeting;
$$;
revoke execute on function public.meeting_invitation_body(uuid, boolean) from public, anon, authenticated;

-- Draft → invited: a pinned announcement until the meeting date. Under 5 days needs p_confirm_short_notice.
create function public.invite_meeting(p_meeting uuid, p_confirm_short_notice boolean default false,
  p_include_details boolean default false) returns uuid
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
    public.meeting_invitation_body(p_meeting, p_include_details), true);
  update public.meetings set status = 'invited', invited_at = now(), invite_announcement_id = v_ann where id = p_meeting;
  insert into public.meeting_events (meeting_id, kind, details) values (p_meeting, 'invited',
    jsonb_build_object('announcement_id', v_ann, 'short_notice', v_short, 'details', p_include_details));
  return v_ann;
end;
$$;

-- Invited: re-announces the current details ("עדכון זימון"); the previous invitation is unpinned and expired.
create function public.update_meeting_invitation(p_meeting uuid, p_include_details boolean default false) returns uuid
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
    public.meeting_invitation_body(p_meeting, p_include_details), true);
  update public.meetings set invite_announcement_id = v_ann where id = p_meeting;
  insert into public.meeting_events (meeting_id, kind, details) values (p_meeting, 'invitation_updated', jsonb_build_object(
    'announcement_id', v_ann, 'scheduled_at', m.scheduled_at, 'location', m.location, 'details', p_include_details));
  return v_ann;
end;
$$;

revoke execute on function public.invite_meeting(uuid, boolean, boolean) from public, anon;
revoke execute on function public.update_meeting_invitation(uuid, boolean) from public, anon;
grant execute on function public.invite_meeting(uuid, boolean, boolean) to authenticated;
grant execute on function public.update_meeting_invitation(uuid, boolean) to authenticated;
