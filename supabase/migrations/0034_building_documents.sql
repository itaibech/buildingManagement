-- 0034 building documents ("מסמכי הבניין"): the building's permanent library (bylaws, insurance, warranties, plans,
-- engineering reports, approvals, contracts), separate from the meeting documents of 0027.
--   * building_documents: title, category, description, document date, optional expiry, and visibility
--     ('residents' = everyone with the 'documents' permission, 'committee' = admins only).
--   * building_document_versions: the files. Uploading a new version adds a row and keeps the old ones; the newest
--     (created_at) is the current one. Versions are never edited and never deleted one by one: only the document's
--     delete removes them (on delete cascade).
--   * Storage: private bucket 'building-docs', `<document_id>/<uuid>.<ext>`, PDF / Word / images up to 20 MB.
--     A file is readable exactly when its document is: admins always; others with 'documents' only for
--     residents-visibility documents, so a committee file can't be read (or signed) by a resident even with its path.
--     Writes are admin-only; files are never overwritten.
--   * Permission 'documents', on for the default group "דייר".

insert into public.permissions (key, label, description, sort_order) values
  ('documents', 'מסמכי הבניין', 'תקנון, ביטוח, אחריות, תוכניות ואישורים של הבניין שהוועד שיתף עם הדיירים', 12);
insert into public.group_permissions (group_id, permission)
select id, 'documents' from public.user_groups where is_default
on conflict do nothing;

-- ---------------------------------------------------------------- file paths
-- `<document_id>/<uuid>.<ext>` with the extensions the client maps types to. The regex expects LOWER-CASE uuids
-- (gen_random_uuid / crypto.randomUUID both produce them): an upper-case path is rejected, never matched loosely.
create function public.is_building_doc_storage_path(p_name text) returns boolean
language sql immutable set search_path = ''
as $$
  select coalesce(p_name ~ ('^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/'
    || '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(pdf|docx|png|jpg|jpeg|webp|heic|heif)$'), false);
$$;
-- The same, inside one document's folder.
create function public.is_building_doc_file_path(p_name text, p_document uuid) returns boolean
language sql immutable set search_path = ''
as $$
  select public.is_building_doc_storage_path(p_name) and split_part(p_name, '/', 1) = p_document::text;
$$;
revoke execute on function public.is_building_doc_storage_path(text) from public, anon;
revoke execute on function public.is_building_doc_file_path(text, uuid) from public, anon;
grant execute on function public.is_building_doc_storage_path(text) to authenticated;
grant execute on function public.is_building_doc_file_path(text, uuid) to authenticated;

-- ---------------------------------------------------------------- tables
create table public.building_documents (
  id uuid primary key default gen_random_uuid(),
  building_id uuid not null default public.default_building_id() references public.buildings on delete cascade,
  title text not null check (char_length(trim(title)) between 1 and 200),
  category text not null default 'other'
    check (category in ('legal', 'insurance', 'warranty', 'plans', 'engineering', 'approvals', 'contracts', 'other')),
  description text not null default '' check (char_length(description) <= 2000),
  document_date date,
  expires_on date,
  visibility text not null default 'residents' check (visibility in ('residents', 'committee')),
  created_by uuid default auth.uid() references auth.users on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (expires_on is null or document_date is null or expires_on >= document_date)
);
create index building_documents_building_idx on public.building_documents (building_id, category);
create index building_documents_created_by_idx on public.building_documents (created_by);

create table public.building_document_versions (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.building_documents on delete cascade,
  file_path text not null unique check (public.is_building_doc_file_path(file_path, document_id)),
  file_name text not null check (char_length(trim(file_name)) between 1 and 200),
  size_bytes int not null check (size_bytes between 1 and 20971520),
  created_by uuid default auth.uid() references auth.users on delete set null,
  created_at timestamptz not null default now()
);
create index building_document_versions_document_idx on public.building_document_versions (document_id, created_at);
create index building_document_versions_created_by_idx on public.building_document_versions (created_by);

-- API users: the author is the caller, the creation time stays, updated_at follows edits.
create function public.building_documents_stamp() returns trigger
language plpgsql set search_path = ''
as $$
begin
  if current_user not in ('authenticated', 'anon') then
    return new;
  end if;
  if tg_op = 'INSERT' then
    new.created_by := auth.uid();
    new.created_at := now();
  else
    new.created_by := old.created_by;
    new.created_at := old.created_at;
    new.building_id := old.building_id;
  end if;
  new.updated_at := now();
  return new;
end;
$$;
revoke execute on function public.building_documents_stamp() from public, anon, authenticated;
create trigger building_documents_stamp
  before insert or update on public.building_documents
  for each row execute function public.building_documents_stamp();

create function public.building_document_versions_stamp() returns trigger
language plpgsql set search_path = ''
as $$
begin
  if current_user in ('authenticated', 'anon') then
    new.created_by := auth.uid();
    new.created_at := now();
  end if;
  return new;
end;
$$;
revoke execute on function public.building_document_versions_stamp() from public, anon, authenticated;
create trigger building_document_versions_stamp
  before insert on public.building_document_versions
  for each row execute function public.building_document_versions_stamp();

alter table public.building_documents enable row level security;
alter table public.building_document_versions enable row level security;
revoke all on public.building_documents from anon;
revoke all on public.building_document_versions from anon;
revoke update, delete on public.building_document_versions from authenticated;

create policy building_documents_admin on public.building_documents for all to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));
create policy building_documents_select on public.building_documents for select to authenticated
  using ((select public.has_permission('documents')) and visibility = 'residents');
-- Admins read and add versions; no update or delete policy (and no grant): the cascade from the document removes them.
create policy building_document_versions_admin_select on public.building_document_versions for select to authenticated
  using ((select public.is_admin()));
create policy building_document_versions_admin_insert on public.building_document_versions for insert to authenticated
  with check ((select public.is_admin()));
create policy building_document_versions_select on public.building_document_versions for select to authenticated
  using ((select public.has_permission('documents')) and exists (
    select 1 from public.building_documents d where d.id = document_id and d.visibility = 'residents'));

-- A new document with its first file, atomically (the file is uploaded first under the client-chosen id).
-- SECURITY INVOKER: the admin-only RLS above decides.
create function public.create_building_document(p_id uuid, p_title text, p_category text, p_visibility text,
  p_file_path text, p_file_name text, p_size_bytes int, p_description text default '', p_document_date date default null,
  p_expires_on date default null)
returns uuid
language plpgsql set search_path = ''
as $$
begin
  insert into public.building_documents (id, title, category, description, document_date, expires_on, visibility)
  values (p_id, trim(p_title), p_category, coalesce(p_description, ''), p_document_date, p_expires_on, p_visibility);
  insert into public.building_document_versions (document_id, file_path, file_name, size_bytes)
  values (p_id, p_file_path, p_file_name, p_size_bytes);
  return p_id;
end;
$$;
revoke execute on function public.create_building_document(uuid, text, text, text, text, text, int, text, date, date)
  from public, anon;
grant execute on function public.create_building_document(uuid, text, text, text, text, text, int, text, date, date)
  to authenticated;

-- ---------------------------------------------------------------- storage
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('building-docs', 'building-docs', false, 20971520, array['application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'image/png', 'image/jpeg', 'image/webp', 'image/heic', 'image/heif'])
on conflict (id) do update set
  public = excluded.public, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

-- May the caller read this storage object? Admins: any well-formed path. Others: 'documents' and the document of the
-- folder is residents-visible. Never casts a non-uuid. SECURITY DEFINER so the answer never depends on table RLS.
create function public.building_doc_readable(p_name text) returns boolean
language sql stable security definer set search_path = ''
as $$
  select case when public.is_building_doc_storage_path(p_name)
    then public.is_admin() or (public.has_permission('documents') and exists (select 1 from public.building_documents d
      where d.id = split_part(p_name, '/', 1)::uuid and d.visibility = 'residents'))
    else false end;
$$;
revoke execute on function public.building_doc_readable(text) from public, anon;
grant execute on function public.building_doc_readable(text) to authenticated;

-- No update policy: overwriting a file (update, or an upsert hitting an existing name) is refused for everyone.
create policy building_docs_read on storage.objects for select to authenticated
  using (bucket_id = 'building-docs' and public.building_doc_readable(name));
create policy building_docs_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'building-docs' and (select public.is_admin()) and public.is_building_doc_storage_path(name));
create policy building_docs_delete on storage.objects for delete to authenticated
  using (bucket_id = 'building-docs' and (select public.is_admin()));
