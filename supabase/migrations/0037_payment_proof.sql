-- 0037 payment proof ("אסמכתת העברה"): a photo, screenshot or PDF of the transfer, attached to a payment.
--   * payments.proof_path: `<payment_id>/<uuid>.<ext>` in the private bucket 'payment-proofs' (images and PDF, 10 MB).
--     A new bucket rather than the 'receipts' one: receipts are admin-only, a proof is also readable by its apartment.
--   * Reading a file: admins always; a resident with finance_own only the proof linked to a payment of their own
--     apartment (the rule of can_read_apartment_finance), so another apartment's file can't be read or signed, even
--     with its path. Writes are admin-only; files are never overwritten (a replacement is a new object).
--   * Old files: deleting a payment, or replacing / removing its proof, queues the old path in payment_proof_trash
--     (whichever way the row went: the app, an RPC like undo_special_charge, an import, an apartment delete). The admin
--     client removes the queued objects through the Storage API (SQL can't delete stored files) and clears the queue.
--   * Standing-order payments (source 'auto') are system-managed: apply_standing_orders deletes and re-inserts them,
--     so they never carry a proof (check below; the app hides the control). Imports replace their own payments
--     ('import', 'ev-import'); the import dialogs warn before a re-import deletes proofs and ask to confirm.
--   No new permission key.

-- ---------------------------------------------------------------- file paths
-- `<payment_id>/<uuid>.<ext>`, lower-case uuids (gen_random_uuid / crypto.randomUUID), the extensions the client maps.
create function public.is_payment_proof_storage_path(p_name text) returns boolean
language sql immutable set search_path = ''
as $$
  select coalesce(p_name ~ ('^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/'
    || '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|png|webp|heic|heif|pdf)$'), false);
$$;
-- The same, inside one payment's folder.
create function public.is_payment_proof_file_path(p_name text, p_payment uuid) returns boolean
language sql immutable set search_path = ''
as $$
  select public.is_payment_proof_storage_path(p_name) and split_part(p_name, '/', 1) = p_payment::text;
$$;
revoke execute on function public.is_payment_proof_storage_path(text) from public, anon;
revoke execute on function public.is_payment_proof_file_path(text, uuid) from public, anon;
grant execute on function public.is_payment_proof_storage_path(text) to authenticated;
grant execute on function public.is_payment_proof_file_path(text, uuid) to authenticated;

-- ---------------------------------------------------------------- the column
-- Unique: one object belongs to one payment (and the read rule looks it up by path).
alter table public.payments add column proof_path text unique
  check (proof_path is null or public.is_payment_proof_file_path(proof_path, id));
alter table public.payments add constraint payments_auto_no_proof check (proof_path is null or source <> 'auto');

-- ---------------------------------------------------------------- objects to remove
create table public.payment_proof_trash (
  path text primary key check (public.is_payment_proof_storage_path(path)),
  queued_at timestamptz not null default now()
);
alter table public.payment_proof_trash enable row level security;
revoke all on public.payment_proof_trash from anon;
revoke insert, update on public.payment_proof_trash from authenticated;
-- Admins read the queue and clear what they removed; only the trigger below adds to it.
create policy payment_proof_trash_select on public.payment_proof_trash for select to authenticated
  using ((select public.is_admin()));
create policy payment_proof_trash_delete on public.payment_proof_trash for delete to authenticated
  using ((select public.is_admin()));

create function public.payments_queue_proof() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if old.proof_path is null then
    return null;
  end if;
  if tg_op = 'DELETE' or new.proof_path is distinct from old.proof_path then
    insert into public.payment_proof_trash (path) values (old.proof_path) on conflict do nothing;
  end if;
  return null;
end;
$$;
revoke execute on function public.payments_queue_proof() from public, anon, authenticated;
create trigger payments_queue_proof after delete or update of proof_path on public.payments
  for each row execute function public.payments_queue_proof();

-- Admin: queue an object whose link failed and whose cleanup remove failed too, so the next sweep removes it.
create function public.queue_payment_proof(p_path text) returns void
language plpgsql security definer set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'admin only' using errcode = '42501';
  end if;
  if not public.is_payment_proof_storage_path(p_path) then
    raise exception 'not a payment proof path' using errcode = '22023';
  end if;
  insert into public.payment_proof_trash (path) values (p_path) on conflict do nothing;
end;
$$;
revoke execute on function public.queue_payment_proof(text) from public, anon;
grant execute on function public.queue_payment_proof(text) to authenticated;

-- ---------------------------------------------------------------- storage
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('payment-proofs', 'payment-proofs', false, 10485760, array[
  'image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif', 'application/pdf'])
on conflict (id) do update set
  public = excluded.public, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

-- May the caller read this object? Admins: any well-formed path. Others: finance_own and the payment it's linked to is
-- of their own apartment. SECURITY DEFINER so the answer never depends on table RLS; the apartment rule is spelled out
-- (can_read_apartment_finance itself trusts every non-API role, which a definer function runs as).
create function public.payment_proof_readable(p_name text) returns boolean
language sql stable security definer set search_path = ''
as $$
  select case when public.is_payment_proof_storage_path(p_name)
    then public.is_admin() or (public.has_permission('finance_own') and exists (select 1 from public.payments p
      where p.proof_path = p_name and p.apartment_id = public.my_apartment_id()))
    else false end;
$$;
revoke execute on function public.payment_proof_readable(text) from public, anon;
grant execute on function public.payment_proof_readable(text) to authenticated;

-- The read rule depends on each object's name, so it can't be hoisted into a once-per-statement (select ...); the
-- cheap bucket_id test runs first and the helper is one indexed lookup (proof_path is unique).
-- No update policy: overwriting a file (update, or an upsert hitting an existing name) is refused for everyone.
create policy payment_proofs_read on storage.objects for select to authenticated
  using (bucket_id = 'payment-proofs' and public.payment_proof_readable(name));
create policy payment_proofs_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'payment-proofs' and (select public.is_admin()) and public.is_payment_proof_storage_path(name));
create policy payment_proofs_delete on storage.objects for delete to authenticated
  using (bucket_id = 'payment-proofs' and (select public.is_admin()));
