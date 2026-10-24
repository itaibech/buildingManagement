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

-- Real (non dry-run) emails sent since midnight, Israel time. The provider quota is per sending account,
-- so the count spans the whole table.
create function public.email_sent_today() returns int
language sql stable security invoker set search_path = ''
as $$
  select coalesce(sum(sent), 0)::int from public.email_log
  where not dry_run
    and created_at >= (date_trunc('day', now() at time zone 'Asia/Jerusalem') at time zone 'Asia/Jerusalem');
$$;
revoke execute on function public.email_sent_today() from public, anon, authenticated;
grant execute on function public.email_sent_today() to service_role;
