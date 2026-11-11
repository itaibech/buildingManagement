-- 0040 several receipts per expense ("קבלות"), and receipts copied from a ticket's files.
--   * expense_receipts: one row per receipt object in the private 'receipts' bucket (same `<expense_id>/<uuid>.<ext>`
--     paths as 0018), up to 10 per expense. Admin-only (read, add, remove), like the bucket; rows are never updated.
--   * Backfill: one row per expense that has a receipt_path today, with its name, and the type and size Storage
--     recorded for the object (else the type from the extension). The migration fails if any path is left out.
--   * expenses.receipt_path / receipt_name are no longer written or read by the app: they stay until a later cleanup.
--     Removing the receipt row of such a path clears them, so they never point at a removed file. Until then, a
--     temporary trigger mirrors writes from app tabs opened before this release into expense_receipts.
--   * receipt_trash: objects of removed receipt rows, whichever way the row went (removed in the app, its expense
--     deleted, undo_special_charge, a re-import). The admin client removes them through the Storage API (SQL can't
--     delete stored files) and clears the queue, like payment_proof_trash (0037). A referenced object is never
--     removed: a row recorded for a queued path takes it off the queue, and the client reads the queue through
--     receipt_trash_pending, which leaves out every path a receipt row still uses.
--   * Storage: 0018's policies already allow any number of files in one expense folder (admin-only). Unchanged.
--   * expense_categories (the dialog's "+ קטגוריה חדשה"): names of 1-60 characters, unique per building ignoring
--     case and outer spaces. Existing rows that break either rule keep the old rules (the check stays NOT VALID / no
--     index), so the migration never fails on them.
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

-- The type a receipt path's extension stands for (0018's whitelist), else application/octet-stream.
create function public.receipt_mime_of(p_path text) returns text
language sql immutable set search_path = ''
as $$
  select case lower(substring(p_path from '\.([A-Za-z0-9]+)$'))
    when 'jpg' then 'image/jpeg' when 'jpeg' then 'image/jpeg' when 'png' then 'image/png' when 'webp' then 'image/webp'
    when 'heic' then 'image/heic' when 'heif' then 'image/heif' when 'gif' then 'image/gif' when 'pdf' then 'application/pdf'
    when 'doc' then 'application/msword'
    when 'docx' then 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    else 'application/octet-stream' end;
$$;
revoke execute on function public.receipt_mime_of(text) from public, anon;
grant execute on function public.receipt_mime_of(text) to authenticated;

-- The name shown for an older receipt: its receipt_name, else the path's file name.
create function public.receipt_name_of(p_name text, p_path text) returns text
language sql immutable set search_path = ''
as $$
  select left(coalesce(nullif(trim(p_name), ''), nullif(regexp_replace(p_path, '^.*/', ''), ''), 'receipt'), 255);
$$;
revoke execute on function public.receipt_name_of(text, text) from public, anon;
grant execute on function public.receipt_name_of(text, text) to authenticated;

-- ---------------------------------------------------------------- backfill (before the path rules: older paths stay)
-- A function so the pgTAP tests can run it again; no API role may call it. Returns how many rows it added.
create function public.expense_receipts_backfill() returns integer
language sql set search_path = ''
as $$
with added as (
  insert into public.expense_receipts (expense_id, path, file_name, mime, size_bytes, created_at)
  select e.id, e.receipt_path, public.receipt_name_of(e.receipt_name, e.receipt_path),
    coalesce(o.metadata ->> 'mimetype', public.receipt_mime_of(e.receipt_path)),
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

-- Self-check: every receipt_path became a row (a path shared by two expenses would be skipped: stop instead).
do $$
declare
  v_added integer := public.expense_receipts_backfill();
  v_expected integer := (select count(*) from public.expenses where receipt_path is not null);
begin
  if v_added <> v_expected then
    raise exception 'expense_receipts backfill added % rows for % receipt paths', v_added, v_expected;
  end if;
end;
$$;

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
  if coalesce(auth.role(), '') in ('authenticated', 'anon') then
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
-- Admins read the queue and clear what they removed; only the triggers and queue_receipt add to it.
create policy receipt_trash_select on public.receipt_trash for select to authenticated
  using ((select public.is_admin()));
create policy receipt_trash_delete on public.receipt_trash for delete to authenticated
  using ((select public.is_admin()));

-- What the sweep may remove: queued paths no receipt row uses (security invoker: the tables' RLS applies).
create view public.receipt_trash_pending with (security_invoker = true) as
  select t.path, t.queued_at from public.receipt_trash t
  where not exists (select 1 from public.expense_receipts r where r.path = t.path);
revoke all on public.receipt_trash_pending from anon;
grant select on public.receipt_trash_pending to authenticated;

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

-- A path that is recorded (again) is in use: off the queue, so no sweep removes it.
create function public.expense_receipts_unqueue() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  delete from public.receipt_trash where path = new.path;
  return null;
end;
$$;
revoke execute on function public.expense_receipts_unqueue() from public, anon, authenticated;
create trigger expense_receipts_unqueue after insert on public.expense_receipts
  for each row execute function public.expense_receipts_unqueue();

-- Admin: queue an object whose row was refused and whose cleanup remove failed too, so the next sweep removes it.
-- A path a receipt row uses is never queued.
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
  if exists (select 1 from public.expense_receipts r where r.path = p_path) then
    return;
  end if;
  insert into public.receipt_trash (path) values (p_path) on conflict do nothing;
end;
$$;
revoke execute on function public.queue_receipt(text) from public, anon;
grant execute on function public.queue_receipt(text) to authenticated;

-- ---------------------------------------------------------------- rollout: app tabs opened before this release
-- TEMPORARY, remove in the receipt_path cleanup migration (with the columns). A tab still running the old app writes
-- expenses.receipt_path: mirror it. Set (or replaced): record the new path as a receipt; cleared or replaced: remove
-- the row of the old path (which queues its object, as the old app then removes it itself).
create function public.expenses_mirror_receipt_path() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if old.receipt_path is not null then
    delete from public.expense_receipts where expense_id = old.id and path = old.receipt_path;
  end if;
  if new.receipt_path is not null and public.is_receipt_path(new.receipt_path)
    and split_part(new.receipt_path, '/', 1) = new.id::text
    and public.receipt_mime_of(new.receipt_path) <> 'application/octet-stream'
    and (select count(*) from public.expense_receipts r where r.expense_id = new.id) < 10 then
    insert into public.expense_receipts (expense_id, path, file_name, mime)
    values (new.id, new.receipt_path, public.receipt_name_of(new.receipt_name, new.receipt_path),
      public.receipt_mime_of(new.receipt_path))
    on conflict (path) do nothing;
  end if;
  return null;
end;
$$;
revoke execute on function public.expenses_mirror_receipt_path() from public, anon, authenticated;
create trigger expenses_mirror_receipt_path after update of receipt_path on public.expenses
  for each row when (old.receipt_path is distinct from new.receipt_path)
  execute function public.expenses_mirror_receipt_path();

-- ---------------------------------------------------------------- category names
alter table public.expense_categories add constraint expense_categories_name_length
  check (char_length(trim(name)) between 1 and 60) not valid;
do $$
begin
  if not exists (select 1 from public.expense_categories where char_length(trim(name)) not between 1 and 60) then
    alter table public.expense_categories validate constraint expense_categories_name_length;
  end if;
  if not exists (select 1 from public.expense_categories group by building_id, lower(trim(name)) having count(*) > 1) then
    create unique index expense_categories_name_ci_key on public.expense_categories (building_id, lower(trim(name)));
  end if;
end;
$$;
