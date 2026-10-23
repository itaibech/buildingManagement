-- 0004 tickets: service calls opened by residents, with comments and photos (private storage bucket).
-- Approved users read everything and comment. The opener may edit title/description/location while the
-- ticket is open. Only admins change status/vendor or delete.

-- ---------------------------------------------------------------- tables
create table public.tickets (
  id uuid primary key default gen_random_uuid(),
  building_id uuid not null default public.default_building_id() references public.buildings on delete cascade,
  title text not null check (length(trim(title)) > 0),
  description text not null default '',
  location text not null default '',
  status text not null default 'open' check (status in ('open', 'in_progress', 'closed')),
  opened_by uuid default auth.uid() references auth.users on delete set null,
  vendor text,
  created_at timestamptz not null default now()
);
create index tickets_building_id_idx on public.tickets (building_id);
create index tickets_opened_by_idx on public.tickets (opened_by);
create index tickets_status_created_idx on public.tickets (status, created_at desc);

create table public.ticket_comments (
  id uuid primary key default gen_random_uuid(),
  building_id uuid not null default public.default_building_id() references public.buildings on delete cascade,
  ticket_id uuid not null references public.tickets on delete cascade,
  author_id uuid default auth.uid() references auth.users on delete set null,
  body text not null check (length(trim(body)) > 0),
  created_at timestamptz not null default now()
);
create index ticket_comments_ticket_id_idx on public.ticket_comments (ticket_id, created_at);
create index ticket_comments_author_id_idx on public.ticket_comments (author_id);
create index ticket_comments_building_id_idx on public.ticket_comments (building_id);

create table public.ticket_photos (
  id uuid primary key default gen_random_uuid(),
  building_id uuid not null default public.default_building_id() references public.buildings on delete cascade,
  ticket_id uuid not null references public.tickets on delete cascade,
  path text not null unique
    check (path ~ ('^' || ticket_id::text || '/[0-9a-f-]{36}\.(jpg|jpeg|png|webp|heic|heif|gif)$')),
  created_at timestamptz not null default now()
);
create index ticket_photos_ticket_id_idx on public.ticket_photos (ticket_id);
create index ticket_photos_building_id_idx on public.ticket_photos (building_id);

-- ---------------------------------------------------------------- guard
-- Non-admin API users may change only title, description and location (RLS limits them to their own
-- open tickets). Server roles (postgres, service_role) are not restricted.
create function public.tickets_guard() returns trigger
language plpgsql set search_path = ''
as $$
begin
  if current_user in ('authenticated', 'anon') and not public.is_admin()
    and (to_jsonb(new) - 'title' - 'description' - 'location')
      is distinct from (to_jsonb(old) - 'title' - 'description' - 'location') then
    raise exception 'Only an admin can change the status or vendor of a ticket' using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger tickets_guard
  before update on public.tickets
  for each row execute function public.tickets_guard();

-- True when the caller is an admin, or opened the ticket and it is still open (photos are added then).
create function public.can_manage_ticket(p_ticket_id uuid) returns boolean
language sql stable security definer set search_path = ''
as $$
  select public.is_approved() and (public.is_admin() or exists (
    select 1 from public.tickets
    where id = p_ticket_id and opened_by = (select auth.uid()) and status = 'open'
  ));
$$;
revoke execute on function public.can_manage_ticket(uuid) from anon, public;
grant execute on function public.can_manage_ticket(uuid) to authenticated;

-- ---------------------------------------------------------------- display names
-- Residents can't read other profiles; approved users may look up names (for comments and openers).
create function public.user_names(ids uuid[]) returns table (user_id uuid, full_name text)
language sql stable security definer set search_path = ''
as $$
  select p.user_id, p.full_name from public.profiles p
  where public.is_approved() and p.status = 'approved' and p.user_id = any (ids);
$$;
revoke execute on function public.user_names(uuid[]) from anon, public;
grant execute on function public.user_names(uuid[]) to authenticated;

-- ---------------------------------------------------------------- RLS
alter table public.tickets enable row level security;
alter table public.ticket_comments enable row level security;
alter table public.ticket_photos enable row level security;

create policy tickets_select on public.tickets
  for select to authenticated using (public.is_approved());
create policy tickets_insert on public.tickets
  for insert to authenticated
  with check (
    public.is_approved() and opened_by = (select auth.uid())
    and (public.is_admin() or (status = 'open' and vendor is null))
  );
create policy tickets_update_own on public.tickets
  for update to authenticated
  using (opened_by = (select auth.uid()) and status = 'open' and public.is_approved())
  with check (opened_by = (select auth.uid()) and status = 'open');
create policy tickets_update_admin on public.tickets
  for update to authenticated using (public.is_admin()) with check (public.is_admin());
create policy tickets_delete_admin on public.tickets
  for delete to authenticated using (public.is_admin());

create policy ticket_comments_select on public.ticket_comments
  for select to authenticated using (public.is_approved());
create policy ticket_comments_insert on public.ticket_comments
  for insert to authenticated
  with check (public.is_approved() and author_id = (select auth.uid()));
create policy ticket_comments_delete_admin on public.ticket_comments
  for delete to authenticated using (public.is_admin());

create policy ticket_photos_select on public.ticket_photos
  for select to authenticated using (public.is_approved());
create policy ticket_photos_insert on public.ticket_photos
  for insert to authenticated with check (public.can_manage_ticket(ticket_id));
create policy ticket_photos_delete_admin on public.ticket_photos
  for delete to authenticated using (public.is_admin());

-- ---------------------------------------------------------------- storage
-- Paths: <ticket_id>/<uuid>.<ext> (enforced by the upload policy). Images only, 5 MB each.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('ticket-photos', 'ticket-photos', false, 5242880,
  array['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/heic', 'image/heif'])
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create policy ticket_photos_storage_read on storage.objects
  for select to authenticated
  using (bucket_id = 'ticket-photos' and public.is_approved());
create policy ticket_photos_storage_upload on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'ticket-photos'
    and name ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}\.(jpg|jpeg|png|webp|heic|heif|gif)$'
    and public.can_manage_ticket(case
      when name ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/' then split_part(name, '/', 1)::uuid
    end)
  );
create policy ticket_photos_storage_delete on storage.objects
  for delete to authenticated
  using (bucket_id = 'ticket-photos' and public.is_admin());
