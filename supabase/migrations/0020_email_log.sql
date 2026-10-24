-- 0020 email log (Task 23): the audit trail of emails sent by the `send-email` Edge Function.
-- Admins read it in the app ("היסטוריית מיילים"). Only the function writes it, with the service role:
-- the API roles get select only (RLS: admins), never insert / update / delete.
-- email_sent_today() feeds the daily cap; it is server-only (service_role).

create table public.email_log (
  id uuid primary key default gen_random_uuid(),
  building_id uuid not null references public.buildings on delete cascade,
  sent_by uuid references auth.users on delete set null,
  kind text not null check (kind in ('announcement', 'ticket', 'debt', 'test')),
  ref_id uuid,
  apartment_ids uuid[],
  recipients int not null default 0 check (recipients >= 0),
  sent int not null default 0 check (sent >= 0),
  failed int not null default 0 check (failed >= 0),
  skipped int not null default 0 check (skipped >= 0),
  dry_run boolean not null default false,
  status text not null default 'done' check (status in ('pending', 'done')),
  error text check (char_length(error) <= 1000),
  created_at timestamptz not null default now()
);
create index email_log_building_created_idx on public.email_log (building_id, created_at desc);
create index email_log_sent_by_idx on public.email_log (sent_by);

alter table public.email_log enable row level security;
revoke all on public.email_log from anon, authenticated, public;
grant select on public.email_log to authenticated;
create policy email_log_admin_select on public.email_log for select to authenticated
  using ((select public.is_admin()));

-- Real (non dry-run) emails used since midnight, Israel time, for one building: 'done' rows count what was sent,
-- 'pending' rows (a send in progress, or one that died midway, however old) count every recipient reserved.
-- Conservative: a crashed send never frees quota that may already have been spent.
create function public.email_sent_today(p_building uuid) returns int
language sql stable security invoker set search_path = ''
as $$
  select coalesce(sum(case when status = 'pending' then recipients else sent end), 0)::int from public.email_log
  where building_id = p_building and not dry_run
    and created_at >= (date_trunc('day', now() at time zone 'Asia/Jerusalem') at time zone 'Asia/Jerusalem');
$$;
revoke execute on function public.email_sent_today(uuid) from public, anon, authenticated;
grant execute on function public.email_sent_today(uuid) to service_role;

-- Atomically reserves p_count emails under today's cap: serialized per building by an advisory lock, so two
-- concurrent sends can't both pass the check. Room → inserts a 'pending' email_log row (recipients = p_count) and
-- returns its id; no room → null. The caller updates the row to 'done' with sent / failed / skipped after delivery.
create function public.reserve_email_quota(p_building uuid, p_count int, p_cap int, p_kind text, p_sent_by uuid,
  p_ref_id uuid default null, p_apartment_ids uuid[] default null) returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  v_id uuid;
begin
  if p_count is null or p_count < 1 or p_cap is null or p_cap < 1 then
    raise exception 'p_count and p_cap must be positive' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('email_quota:' || p_building::text, 0));
  if public.email_sent_today(p_building) + p_count > p_cap then
    return null;
  end if;
  insert into public.email_log (building_id, sent_by, kind, ref_id, apartment_ids, recipients, status)
  values (p_building, p_sent_by, p_kind, p_ref_id, p_apartment_ids, p_count, 'pending')
  returning id into v_id;
  return v_id;
end;
$$;
revoke execute on function public.reserve_email_quota(uuid, int, int, text, uuid, uuid, uuid[]) from public, anon, authenticated;
grant execute on function public.reserve_email_quota(uuid, int, int, text, uuid, uuid, uuid[]) to service_role;
