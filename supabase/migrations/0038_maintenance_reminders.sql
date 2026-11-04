-- 0038 maintenance reminders by email ("תזכורות תחזוקה במייל"): a daily digest to the committee before maintenance
-- tasks / inspections and supplier contracts are due. The first path from pg_cron to email, built to be reused.
--   * maintenance_reminder_settings: one row per building (admins read and write it; RLS). No row = the defaults:
--     on, 7 and 1 days before, plus overdue. The due date itself ("היום") and each item's own remind_days (tasks and
--     contracts, 0032) are always included while on.
--   * maintenance_reminders_log: one row per (item, due date, offset, recipient admin); a real reminder is emailed at
--     most once (partial unique index over the rows that aren't dry runs, so a dry run never blocks a real send).
--     offset_days: days before the due date, 0 = the day itself, -1 = overdue (tasks only). Admins read their
--     building's rows (RLS); only the cron-reminders Edge Function (service role) writes them, through
--     claim_maintenance_reminders().
--   * email_log.kind gains 'maintenance_reminder' (added to whatever the constraint allows, like 0035).
--   * The schedule: pg_cron runs public.maintenance_reminders_cron() hourly; it acts only during the 08:00 hour in
--     Israel, retried at 09:00 and 10:00 (DST-safe, as in 0035; the log keeps the retries idempotent), and POSTs to the cron-reminders function with pg_net. The function picks what is
--     due at send time (a task marked done meanwhile has a new next_due, so it is skipped) and sends the digest.
--   * Auth with no secret handled by a person: private.cron_config (schema not exposed by the API, no grants to the
--     API roles) holds a random secret generated here. pg_cron sends it as x-cron-secret; the function (verify_jwt
--     off) reads it with its service role through cron_reminders_secret() and compares in constant time.
--   * functions_url is null until the deploy workflow sets it (it knows the project ref); while null the job does
--     nothing (local and CI databases).

-- ---------------------------------------------------------------- extensions
-- Its functions and request queue live in schema net, which the Data API doesn't expose (config.toml api.schemas)
-- and which is not on the API's search_path, so no API call can reach them. A queued request (with its x-cron-secret
-- header) is removed as soon as the worker sends it.
create extension if not exists pg_net with schema extensions;

-- ---------------------------------------------------------------- email kind
do $$
declare
  v_kinds text[];
begin
  select array_agg(distinct m[1] order by m[1]) into v_kinds
  from pg_constraint c, regexp_matches(pg_get_constraintdef(c.oid), '''([a-z_]+)''', 'g') m
  where c.conrelid = 'public.email_log'::regclass and c.conname = 'email_log_kind_check';
  v_kinds := array(select distinct k from unnest(coalesce(v_kinds, '{}') || array['maintenance_reminder']) k order by k);
  alter table public.email_log drop constraint if exists email_log_kind_check;
  execute format('alter table public.email_log add constraint email_log_kind_check check (kind in (%s))',
    (select string_agg(quote_literal(k), ', ') from unnest(v_kinds) k));
end;
$$;

-- ---------------------------------------------------------------- settings
create table public.maintenance_reminder_settings (
  building_id uuid primary key references public.buildings on delete cascade,
  enabled boolean not null default true,
  days_before int[] not null default '{7,1}' check (cardinality(days_before) <= 6
    and array_position(days_before, null) is null and 1 <= all (days_before) and 60 >= all (days_before)),
  include_overdue boolean not null default true,
  updated_at timestamptz not null default now()
);
alter table public.maintenance_reminder_settings enable row level security;
revoke all on public.maintenance_reminder_settings from anon, authenticated, public;
grant select, insert, update on public.maintenance_reminder_settings to authenticated;
grant all on public.maintenance_reminder_settings to service_role;
create policy maintenance_reminder_settings_admin on public.maintenance_reminder_settings for all to authenticated
  using ((select public.is_admin())
    and building_id = (select p.building_id from public.profiles p where p.user_id = (select auth.uid())))
  with check ((select public.is_admin())
    and building_id = (select p.building_id from public.profiles p where p.user_id = (select auth.uid())));

-- ---------------------------------------------------------------- what was sent
create table public.maintenance_reminders_log (
  id uuid primary key default gen_random_uuid(),
  building_id uuid not null references public.buildings on delete cascade,
  item_kind text not null check (item_kind in ('task', 'contract')),
  -- A maintenance task or a supplier contract (no FK: either table; the title keeps the history readable).
  item_id uuid not null,
  title text not null check (char_length(title) <= 200),
  due_on date not null,
  offset_days int not null check (offset_days between -1 and 365),
  -- The admin it was emailed to (one digest each, so a failed send to one admin is retried for them only).
  recipient uuid not null references auth.users on delete cascade,
  sent_on date not null,
  dry_run boolean not null default false,
  email_log_id uuid references public.email_log on delete set null,
  created_at timestamptz not null default now()
);
create unique index maintenance_reminders_log_once
  on public.maintenance_reminders_log (item_kind, item_id, due_on, offset_days, recipient) where not dry_run;
create index maintenance_reminders_log_recipient_idx on public.maintenance_reminders_log (recipient);
create index maintenance_reminders_log_building_idx on public.maintenance_reminders_log (building_id, created_at desc);
create index maintenance_reminders_log_email_log_idx on public.maintenance_reminders_log (email_log_id)
  where email_log_id is not null;
alter table public.maintenance_reminders_log enable row level security;
revoke all on public.maintenance_reminders_log from anon, authenticated, public;
grant select on public.maintenance_reminders_log to authenticated;
grant all on public.maintenance_reminders_log to service_role;
create policy maintenance_reminders_log_admin_select on public.maintenance_reminders_log for select to authenticated
  using ((select public.is_admin())
    and building_id = (select p.building_id from public.profiles p where p.user_id = (select auth.uid())));

-- Claims rows for the function: real rows already logged are skipped (the partial unique index), so concurrent or
-- retried runs send each reminder once; dry-run rows are always inserted. Returns the rows inserted now.
create function public.claim_maintenance_reminders(p_rows jsonb)
returns table (id uuid, item_kind text, item_id uuid, due_on date, offset_days int, recipient uuid)
language sql volatile set search_path = ''
as $$
  insert into public.maintenance_reminders_log as l
    (building_id, item_kind, item_id, title, due_on, offset_days, recipient, sent_on, dry_run)
  select r.building_id, r.item_kind, r.item_id, left(r.title, 200), r.due_on, r.offset_days, r.recipient, r.sent_on, r.dry_run
  from jsonb_to_recordset(p_rows) as r (building_id uuid, item_kind text, item_id uuid, title text, due_on date,
    offset_days int, recipient uuid, sent_on date, dry_run boolean)
  on conflict (item_kind, item_id, due_on, offset_days, recipient) where not dry_run do nothing
  returning l.id, l.item_kind, l.item_id, l.due_on, l.offset_days, l.recipient;
$$;
revoke execute on function public.claim_maintenance_reminders(jsonb) from public, anon, authenticated;
grant execute on function public.claim_maintenance_reminders(jsonb) to service_role;

-- ---------------------------------------------------------------- the cron secret (never exposed)
create schema if not exists private;
revoke all on schema private from public, anon, authenticated, service_role;

create table private.cron_config (
  id boolean primary key default true check (id),
  secret text not null default encode(extensions.gen_random_bytes(32), 'hex') check (char_length(secret) >= 32),
  -- https://<project-ref>.supabase.co/functions/v1, set by the deploy workflow; null = the job does nothing.
  functions_url text check (functions_url is null or functions_url ~ '^https?://[^\s/''"]+(/[^\s''"]*)?$'),
  updated_at timestamptz not null default now()
);
revoke all on private.cron_config from public, anon, authenticated, service_role;
insert into private.cron_config default values on conflict do nothing;

-- The expected x-cron-secret, for the cron-reminders function only (its service role).
create function public.cron_reminders_secret() returns text
language sql stable security definer set search_path = ''
as $$
  select c.secret from private.cron_config c where c.id;
$$;
revoke execute on function public.cron_reminders_secret() from public, anon, authenticated;
grant execute on function public.cron_reminders_secret() to service_role;

-- ---------------------------------------------------------------- the daily job (pg_cron → pg_net)
-- True from 08:00 to 10:59 in Israel (both UTC+2 and UTC+3): 08:10 runs, 09:10 and 10:10 retry what failed.
create function public.maintenance_reminders_due_hour(p_now timestamptz) returns boolean
language sql stable set search_path = ''
as $$
  select extract(hour from p_now at time zone 'Asia/Jerusalem') between 8 and 10;
$$;
revoke execute on function public.maintenance_reminders_due_hour(timestamptz) from public, anon, authenticated;

-- Scheduled hourly in UTC; at 08:xx-10:xx Israel time it queues a POST to cron-reminders (p_now: tests pin the clock).
-- Returns the pg_net request id, or null when it didn't call (another hour, or no functions_url yet).
create function public.maintenance_reminders_cron(p_now timestamptz default now()) returns bigint
language plpgsql security definer set search_path = ''
as $$
declare
  v_url text;
  v_secret text;
begin
  if not public.maintenance_reminders_due_hour(p_now) then
    return null;
  end if;
  select c.functions_url, c.secret into v_url, v_secret from private.cron_config c where c.id;
  if v_url is null then
    return null;
  end if;
  return net.http_post(
    url := rtrim(v_url, '/') || '/cron-reminders',
    body := '{}'::jsonb,
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', v_secret),
    timeout_milliseconds := 60000
  );
end;
$$;
revoke execute on function public.maintenance_reminders_cron(timestamptz) from public, anon, authenticated;

-- Hourly at :10 UTC (winter UTC+2 → 06:10-08:10 UTC, summer UTC+3 → 05:10-07:10 UTC act). Same fallback as 0035 where pg_cron
-- is missing: a WARNING, nothing scheduled.
do $$
begin
  begin
    create extension if not exists pg_cron with schema pg_catalog;
  exception when others then
    raise warning 'pg_cron is NOT available, so maintenance reminders are NOT scheduled. Schedule "select public.maintenance_reminders_cron()" hourly. (%)', sqlerrm;
    return;
  end;
  perform cron.schedule('maintenance-reminders', '10 * * * *', 'select public.maintenance_reminders_cron()');
end;
$$;
