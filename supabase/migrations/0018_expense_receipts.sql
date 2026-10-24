-- 0018 expense receipts (Task 22): Word documents next to images and PDF, the receipt's original file name,
-- and storage writes limited to `<expense_id>/<uuid>.<ext>` with a whitelisted extension. Storage stays admin-only.

-- ---------------------------------------------------------------- bucket: types and size
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('receipts', 'receipts', false, 10485760, array[
  'image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif', 'image/gif', 'application/pdf',
  'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'])
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- ---------------------------------------------------------------- path rule
-- Lower-case uuids (gen_random_uuid / crypto.randomUUID) and the extensions the client maps mimetypes to.
create or replace function public.is_receipt_path(p_name text) returns boolean
language sql immutable set search_path = ''
as $$
  select coalesce(p_name ~ ('^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/'
    || '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|jpeg|png|webp|heic|heif|gif|pdf|doc|docx)$'), false);
$$;
revoke execute on function public.is_receipt_path(text) from public, anon;
grant execute on function public.is_receipt_path(text) to authenticated;

-- Insert and update check the path; read and delete stay admin-only (so any older object can still be removed).
drop policy if exists receipts_storage_upload on storage.objects;
create policy receipts_storage_upload on storage.objects
  for insert to authenticated
  with check (bucket_id = 'receipts' and public.is_admin() and public.is_receipt_path(name));
drop policy if exists receipts_storage_update on storage.objects;
create policy receipts_storage_update on storage.objects
  for update to authenticated
  using (bucket_id = 'receipts' and public.is_admin())
  with check (bucket_id = 'receipts' and public.is_admin() and public.is_receipt_path(name));

-- ---------------------------------------------------------------- the file name shown in the app and the export
alter table public.expenses add column if not exists receipt_name text
  check (receipt_name is null or length(receipt_name) between 1 and 255);
