-- 0040 several receipts per expense ("קבלות"), and receipts copied from a ticket's files.
--   * expense_receipts: one row per receipt object in the private 'receipts' bucket (same `<expense_id>/<uuid>.<ext>`
--     paths as 0018), up to 10 per expense. Admin-only (read, add, remove), like the bucket; rows are never updated.
--   * Backfill: one row per expense that has a receipt_path today, with its name, and the type and size Storage
--     recorded for the object (else the type from the extension).
--   * expenses.receipt_path / receipt_name are no longer written or read by the app: they stay until a later cleanup.
--     Removing the receipt row of such a path clears them, so they never point at a removed file.
--   * receipt_trash: objects of removed receipt rows, whichever way the row went (removed in the app, its expense
--     deleted, undo_special_charge, a re-import). The admin client removes them through the Storage API (SQL can't
--     delete stored files) and clears the queue, like payment_proof_trash (0037).
--   * Storage: 0018's policies already allow any number of files in one expense folder (admin-only). Unchanged.
--   No new permission key.

-- ---------------------------------------------------------------- the table
create table public.expense_receipts (
  id uuid primary key default gen_random_uuid(),
  expense_id uuid not null references public.expenses on delete cascade,
  path text not null unique,
  file_name text not null check (char_length(file_name) between 1 and 255),
  mime text not null,
  size_bytes bigint check (size_bytes is null or size_bytes between 0 and 10485760),
  created_at timestamptz not null default now()
);
create index expense_receipts_expense_idx on public.expense_receipts (expense_id, created_at);

-- ---------------------------------------------------------------- backfill (before the path rules: older paths stay)
-- A function so the pgTAP tests can run it again; no API role may call it. Returns how many rows it added.
create function public.expense_receipts_backfill() returns integer
language sql set search_path = ''
as $$
with added as (
insert into public.expense_receipts (expense_id, path, file_name, mime, size_bytes, created_at)
select e.id, e.receipt_path,
  left(coalesce(nullif(trim(e.receipt_name), ''), nullif(regexp_replace(e.receipt_path, '^.*/', ''), ''), 'receipt'), 255),
  coalesce(o.metadata ->> 'mimetype', case lower(substring(e.receipt_path from '\.([A-Za-z0-9]+)$'))
    when 'jpg' then 'image/jpeg' when 'jpeg' then 'image/jpeg' when 'png' then 'image/png' when 'webp' then 'image/webp'
    when 'heic' then 'image/heic' when 'heif' then 'image/heif' when 'gif' then 'image/gif' when 'pdf' then 'application/pdf'
    when 'doc' then 'application/msword'
    when 'docx' then 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    else 'application/octet-stream' end),
  case when (o.metadata ->> 'size') ~ '^\d+$' and (o.metadata ->> 'size')::bigint <= 10485760
    then (o.metadata ->> 'size')::bigint end,
  e.created_at
from public.expenses e
left join storage.objects o on o.bucket_id = 'receipts' and o.name = e.receipt_path
where e.receipt_path is not null
on conflict (path) do nothing
returning 1
) select count(*)::integer from added;
$$;
revoke execute on function public.expense_receipts_backfill() from public, anon, authenticated;
select public.expense_receipts_backfill();

-- New rows: a well-formed path inside the expense's own folder, a type the bucket accepts. (not valid: the backfilled
-- rows keep whatever path and type they had.)
alter table public.expense_receipts
  add constraint expense_receipts_path_rule
    check (public.is_receipt_path(path) and split_part(path, '/', 1) = expense_id::text) not valid,
  add constraint expense_receipts_mime_rule check (mime in ('image/jpeg', 'image/png', 'image/webp', 'image/heic',
    'image/heif', 'image/gif', 'application/pdf', 'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document')) not valid,
  add constraint expense_receipts_size_rule check (size_bytes between 1 and 10485760) not valid;

-- At most 10 per expense (the expense row is locked, so two parallel uploads can't both slip in). The time is the
-- server's for API callers.
create function public.expense_receipts_guard() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  perform 1 from public.expenses e where e.id = new.expense_id for update;
  if (select count(*) from public.expense_receipts r where r.expense_id = new.expense_id) >= 10 then
    raise exception 'An expense has at most 10 receipts' using errcode = '23514';
  end if;
  if current_user in ('authenticated', 'anon') then
    new.created_at := now();
  end if;
  return new;
end;
$$;
revoke execute on function public.expense_receipts_guard() from public, anon, authenticated;
create trigger expense_receipts_guard before insert on public.expense_receipts
  for each row execute function public.expense_receipts_guard();

alter table public.expense_receipts enable row level security;
revoke all on public.expense_receipts from anon;
revoke update on public.expense_receipts from authenticated;
create policy expense_receipts_select on public.expense_receipts for select to authenticated
  using ((select public.is_admin()));
create policy expense_receipts_insert on public.expense_receipts for insert to authenticated
  with check ((select public.is_admin()));
create policy expense_receipts_delete on public.expense_receipts for delete to authenticated
  using ((select public.is_admin()));

-- ---------------------------------------------------------------- objects to remove
-- No path rule here: a backfilled (older) path must still be queued, or its delete would fail.
create table public.receipt_trash (
  path text primary key,
  queued_at timestamptz not null default now()
);
alter table public.receipt_trash enable row level security;
revoke all on public.receipt_trash from anon;
revoke insert, update on public.receipt_trash from authenticated;
-- Admins read the queue and clear what they removed; only the trigger and queue_receipt add to it.
create policy receipt_trash_select on public.receipt_trash for select to authenticated
  using ((select public.is_admin()));
create policy receipt_trash_delete on public.receipt_trash for delete to authenticated
  using ((select public.is_admin()));

create function public.expense_receipts_queue() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  insert into public.receipt_trash (path) values (old.path) on conflict do nothing;
  -- The old single-receipt columns: never left pointing at a removed file.
  update public.expenses set receipt_path = null, receipt_name = null
    where id = old.expense_id and receipt_path = old.path;
  return null;
end;
$$;
revoke execute on function public.expense_receipts_queue() from public, anon, authenticated;
create trigger expense_receipts_queue after delete on public.expense_receipts
  for each row execute function public.expense_receipts_queue();

-- Admin: queue an object whose row was refused and whose cleanup remove failed too, so the next sweep removes it.
create function public.queue_receipt(p_path text) returns void
language plpgsql security definer set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'admin only' using errcode = '42501';
  end if;
  if not public.is_receipt_path(p_path) then
    raise exception 'not a receipt path' using errcode = '22023';
  end if;
  insert into public.receipt_trash (path) values (p_path) on conflict do nothing;
end;
$$;
revoke execute on function public.queue_receipt(text) from public, anon;
grant execute on function public.queue_receipt(text) to authenticated;
