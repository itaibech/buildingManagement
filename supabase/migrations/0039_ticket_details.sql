-- 0039 ticket details ("ניהול התקלה"): richer handling of a service call by the committee.
--   * tickets.suggested_solution / fix_details: the treatment, shown read-only to everyone who can see the call
--     ('tickets'). Only admins write them (tickets_guard already refuses any other column from non-admins; the
--     insert policy now also keeps them empty for residents).
--   * ticket_admin_details: one row per call with the cost, the linked supplier (0032) and "last edited". A separate,
--     admin-only table rather than column privileges on tickets: tickets is read with `select *` and is in the
--     supabase_realtime publication, and a hidden column there would either break those reads or leak through them.
--     A table no resident policy ever matches can't leak through any path.
--   * save_ticket_details(): vendor, supplier, treatment and cost in one transaction (security invoker: RLS decides).
--   * ticket_files: attachments (images, PDF, Word), up to 10 per call, 10 MB each. visible_to_residents decides
--     whether everyone with 'tickets' may read the file; admins read all. Only that flag can be updated.
--   * Storage: a new private bucket 'ticket-files' (`<ticket_id>/<uuid>.<ext>`). Not the ticket-photos bucket:
--     its read policy lets everyone with 'tickets' read every object, which an admin-only file must not be.
--     ticket_file_readable() (SECURITY DEFINER) answers per object, so a committee-only file can't be read or signed
--     by a resident even with its path. Admin-only upload and delete, no update (files are never overwritten).
--   * expenses.ticket_id: the expense recorded for a call ("רישום כהוצאה"); set null when the call is deleted.
--   * Timeline: ticket_comments.event marks automatic lines (status change, "עודכנו פרטי התיקון"), written by
--     triggers. Residents and admins can't insert them directly. One details line per transaction at most.

-- ---------------------------------------------------------------- tickets: the treatment
alter table public.tickets
  add column suggested_solution text not null default '' check (char_length(suggested_solution) <= 3000),
  add column fix_details text not null default '' check (char_length(fix_details) <= 5000);

drop policy if exists tickets_insert on public.tickets;
create policy tickets_insert on public.tickets for insert to authenticated
  with check (
    (select public.has_permission('tickets')) and opened_by = (select auth.uid())
    and ((select public.is_admin())
      or (status = 'open' and vendor is null and suggested_solution = '' and fix_details = ''))
  );

-- ---------------------------------------------------------------- admin-only details
create table public.ticket_admin_details (
  ticket_id uuid primary key references public.tickets on delete cascade,
  building_id uuid not null default public.default_building_id() references public.buildings on delete cascade,
  cost numeric(12,2) check (cost >= 0),
  supplier_id uuid references public.suppliers on delete set null,
  updated_by uuid default auth.uid() references auth.users on delete set null,
  updated_at timestamptz not null default now()
);
create index ticket_admin_details_building_idx on public.ticket_admin_details (building_id);
create index ticket_admin_details_supplier_idx on public.ticket_admin_details (supplier_id);
create index ticket_admin_details_updated_by_idx on public.ticket_admin_details (updated_by);

alter table public.ticket_admin_details enable row level security;
revoke all on public.ticket_admin_details from anon;
create policy ticket_admin_details_admin on public.ticket_admin_details for all to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));

-- Admin: the "ניהול התקלה" form in one go. An empty supplier/vendor is stored as null.
create function public.save_ticket_details(p_ticket_id uuid, p_vendor text, p_suggested_solution text,
  p_fix_details text, p_supplier_id uuid default null, p_cost numeric default null)
returns void
language plpgsql set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'Only an admin can edit the ticket details' using errcode = '42501';
  end if;
  update public.tickets
    set vendor = nullif(trim(coalesce(p_vendor, '')), ''),
        suggested_solution = coalesce(p_suggested_solution, ''),
        fix_details = coalesce(p_fix_details, '')
    where id = p_ticket_id;
  if not found then
    raise exception 'Ticket not found' using errcode = 'P0002';
  end if;
  insert into public.ticket_admin_details (ticket_id, cost, supplier_id)
  values (p_ticket_id, p_cost, p_supplier_id)
  on conflict (ticket_id) do update
    set cost = excluded.cost, supplier_id = excluded.supplier_id, updated_by = auth.uid(), updated_at = now();
end;
$$;
revoke execute on function public.save_ticket_details(uuid, text, text, text, uuid, numeric) from public, anon;
grant execute on function public.save_ticket_details(uuid, text, text, text, uuid, numeric) to authenticated;

-- ---------------------------------------------------------------- expenses link
alter table public.expenses add column ticket_id uuid references public.tickets on delete set null;
create index expenses_ticket_id_idx on public.expenses (ticket_id) where ticket_id is not null;

-- ---------------------------------------------------------------- timeline
alter table public.ticket_comments
  add column event text check (event in ('status', 'details')),
  add constraint ticket_comments_event_body check (
    event is null
    or (event = 'status' and body in ('open', 'in_progress', 'closed'))
    or (event = 'details' and body = 'details'));

drop policy if exists ticket_comments_insert on public.ticket_comments;
create policy ticket_comments_insert on public.ticket_comments for insert to authenticated
  with check ((select public.has_permission('tickets')) and author_id = (select auth.uid()) and event is null);

-- One automatic line. A details line is written once per transaction (a save that changes both text and cost).
create function public.ticket_log_event(p_ticket_id uuid, p_event text, p_body text) returns void
language plpgsql security definer set search_path = ''
as $$
begin
  if p_event = 'details' and exists (select 1 from public.ticket_comments
      where ticket_id = p_ticket_id and event = 'details' and created_at = now()) then
    return;
  end if;
  insert into public.ticket_comments (ticket_id, building_id, author_id, body, event)
  select t.id, t.building_id, auth.uid(), p_body, p_event from public.tickets t where t.id = p_ticket_id;
end;
$$;
revoke execute on function public.ticket_log_event(uuid, text, text) from public, anon, authenticated;

create function public.tickets_log_changes() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if new.status is distinct from old.status then
    perform public.ticket_log_event(new.id, 'status', new.status);
  end if;
  if (new.suggested_solution, new.fix_details) is distinct from (old.suggested_solution, old.fix_details) then
    perform public.ticket_log_event(new.id, 'details', 'details');
  end if;
  return null;
end;
$$;
revoke execute on function public.tickets_log_changes() from public, anon, authenticated;
create trigger tickets_log_changes after update on public.tickets
  for each row execute function public.tickets_log_changes();

create function public.ticket_admin_details_log() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if (tg_op = 'INSERT' and new.cost is not null) or (tg_op = 'UPDATE' and new.cost is distinct from old.cost) then
    perform public.ticket_log_event(new.ticket_id, 'details', 'details');
  end if;
  return null;
end;
$$;
revoke execute on function public.ticket_admin_details_log() from public, anon, authenticated;
create trigger ticket_admin_details_log after insert or update on public.ticket_admin_details
  for each row execute function public.ticket_admin_details_log();

-- ---------------------------------------------------------------- attachments
-- `<ticket_id>/<uuid>.<ext>`, lower-case uuids (gen_random_uuid / crypto.randomUUID).
create function public.is_ticket_file_path(p_name text) returns boolean
language sql immutable set search_path = ''
as $$
  select coalesce(p_name ~ ('^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/'
    || '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|jpeg|png|webp|heic|heif|pdf|doc|docx)$'), false);
$$;
revoke execute on function public.is_ticket_file_path(text) from public, anon;
grant execute on function public.is_ticket_file_path(text) to authenticated;

create table public.ticket_files (
  id uuid primary key default gen_random_uuid(),
  building_id uuid not null default public.default_building_id() references public.buildings on delete cascade,
  ticket_id uuid not null references public.tickets on delete cascade,
  path text not null unique check (public.is_ticket_file_path(path) and split_part(path, '/', 1) = ticket_id::text),
  file_name text not null check (char_length(trim(file_name)) between 1 and 200),
  size_bytes int not null check (size_bytes between 1 and 10485760),
  visible_to_residents boolean not null default false,
  created_by uuid default auth.uid() references auth.users on delete set null,
  created_at timestamptz not null default now()
);
create index ticket_files_ticket_idx on public.ticket_files (ticket_id, created_at);
create index ticket_files_building_idx on public.ticket_files (building_id);
create index ticket_files_created_by_idx on public.ticket_files (created_by);

-- At most 10 per call (the call's row is locked, so two parallel uploads can't both slip in). The author is the caller.
create function public.ticket_files_guard() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  perform 1 from public.tickets where id = new.ticket_id for update;
  if (select count(*) from public.ticket_files where ticket_id = new.ticket_id) >= 10 then
    raise exception 'A ticket has at most 10 files' using errcode = '23514';
  end if;
  if current_user in ('authenticated', 'anon') then
    new.created_by := auth.uid();
    new.created_at := now();
  end if;
  return new;
end;
$$;
revoke execute on function public.ticket_files_guard() from public, anon, authenticated;
create trigger ticket_files_guard before insert on public.ticket_files
  for each row execute function public.ticket_files_guard();

alter table public.ticket_files enable row level security;
revoke all on public.ticket_files from anon;
revoke update on public.ticket_files from authenticated;
grant update (visible_to_residents) on public.ticket_files to authenticated;
create policy ticket_files_admin on public.ticket_files for all to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));
create policy ticket_files_select on public.ticket_files for select to authenticated
  using ((select public.has_permission('tickets')) and visible_to_residents);

-- ---------------------------------------------------------------- storage
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('ticket-files', 'ticket-files', false, 10485760, array['image/jpeg', 'image/png', 'image/webp', 'image/heic',
  'image/heif', 'application/pdf', 'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document'])
on conflict (id) do update set
  public = excluded.public, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

-- May the caller read this object? Admins: any well-formed path. Others: 'tickets' and a file row for exactly this
-- path that is visible to residents. Never casts a non-uuid; never depends on the caller's table RLS.
create function public.ticket_file_readable(p_name text) returns boolean
language sql stable security definer set search_path = ''
as $$
  select case when public.is_ticket_file_path(p_name)
    then public.is_admin() or (public.has_permission('tickets') and exists (select 1 from public.ticket_files f
      where f.path = p_name and f.visible_to_residents))
    else false end;
$$;
revoke execute on function public.ticket_file_readable(text) from public, anon;
grant execute on function public.ticket_file_readable(text) to authenticated;

create policy ticket_files_storage_read on storage.objects for select to authenticated
  using (bucket_id = 'ticket-files' and public.ticket_file_readable(name));
create policy ticket_files_storage_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'ticket-files' and (select public.is_admin()) and public.is_ticket_file_path(name));
create policy ticket_files_storage_delete on storage.objects for delete to authenticated
  using (bucket_id = 'ticket-files' and (select public.is_admin()));
