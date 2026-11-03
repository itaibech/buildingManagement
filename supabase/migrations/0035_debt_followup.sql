-- 0035 automatic debt follow-up ("מעקב חובות אוטומטי"): escalation steps by days overdue, recorded daily by pg_cron.
--   * debt_followup_settings: one row per building (admins read and write it; RLS). enabled defaults to false, so
--     nothing happens until an admin turns it on. Three steps, each "days overdue → action" with its own switch:
--     1 friendly email (the existing debt template), 2 firmer email, 3 no email: an admin task ("חוב מעל 60 יום") and
--     a printable formal letter in the app. min_amount (default ₪50): smaller debts are skipped.
--   * Days overdue = today (Israel) − the first day of the oldest unpaid month, the month settlement_plan (0017)
--     allocates first (credit from overpaid months is used up first). Skipped: archived apartments, exempt apartments
--     (current fee mode), balance ≤ 0 (standing-order apartments are paid by their auto payments, so they only show
--     up with a real debt), and debts below min_amount.
--   * debt_followups: what was done or is due, per apartment and step. Each step happens once per debt episode: a
--     partial unique index on (apartment_id, step) over the open episode (episode_closed_at null, not skipped).
--     The episode closes when the balance returns to ≤ 0, the apartment is archived, or the oldest unpaid month is
--     later than the episode's (the debt it was about was paid; what is open now is a new debt, with its own steps).
--     Only the highest step reached is recorded (an apartment found at 65 days gets the task, not three emails).
--     Admins read it (RLS); nothing is written through the API: the definer functions below and send-email
--     (service role) write it.
--   * pg_cron runs public.debt_followup_cron() every hour (UTC) and it acts only at 09:00 Israel time, so DST needs
--     no second schedule. The job only RECORDS due rows: it never sends email. Emails (steps 1-2) go out when an
--     admin presses "שליחה" on the home card (send-email kind 'debt_followup'), under their own JWT, inside the daily
--     quota minus the committee's reserved share (cap − MAX_PER_CALL, like residents' sends in 0029); what doesn't
--     fit stays pending for the next send. We chose this over pg_net + a service-role key in Vault: no secret is
--     stored in the database, a bug in the job can't email residents, and dry run / quota are enforced in one place.
--   * Sending is claimed: a real send moves its rows pending → 'sending' atomically (serialised per building), so two
--     concurrent sends never email the same step twice; finish marks them 'sent' or releases them to 'pending'
--     (failed, deferred by the quota, no resident email yet). A claim older than 15 minutes (a send that died, maybe
--     after delivering) is NOT re-queued: it becomes 'review' ("לא ידוע אם נשלחה"), and the admin checks the email log
--     and resolves it (resolve_debt_followup: sent, or send again). Preview and dry run read only: no claim, no sweep.
--   * A pending email is sent only while its step is still due now: the step switched on and the CURRENT days
--     overdue past its threshold. Otherwise the sweep skips it ('stale').
--   * email_log.kind gains 'debt_followup' (added to whatever the constraint allows at this point, so kinds added
--     by earlier migrations are kept).

-- ---------------------------------------------------------------- email kind
do $$
declare
  v_kinds text[];
begin
  select array_agg(distinct m[1] order by m[1]) into v_kinds
  from pg_constraint c, regexp_matches(pg_get_constraintdef(c.oid), '''([a-z_]+)''', 'g') m
  where c.conrelid = 'public.email_log'::regclass and c.conname = 'email_log_kind_check';
  v_kinds := array(select distinct k from unnest(coalesce(v_kinds, '{}') || array['debt_followup']) k order by k);
  alter table public.email_log drop constraint if exists email_log_kind_check;
  execute format('alter table public.email_log add constraint email_log_kind_check check (kind in (%s))',
    (select string_agg(quote_literal(k), ', ') from unnest(v_kinds) k));
end;
$$;

-- ---------------------------------------------------------------- settings
create table public.debt_followup_settings (
  building_id uuid primary key references public.buildings on delete cascade,
  enabled boolean not null default false,
  min_amount numeric(12,2) not null default 50 check (min_amount >= 0 and min_amount <= 100000),
  friendly_on boolean not null default true,
  friendly_days int not null default 10 check (friendly_days between 1 and 365),
  firm_on boolean not null default true,
  firm_days int not null default 30 check (firm_days between 1 and 365),
  letter_on boolean not null default true,
  letter_days int not null default 60 check (letter_days between 1 and 730),
  updated_at timestamptz not null default now(),
  constraint debt_followup_settings_order check (friendly_days < firm_days and firm_days < letter_days)
);
alter table public.debt_followup_settings enable row level security;
revoke all on public.debt_followup_settings from anon, authenticated, public;
grant select, insert, update on public.debt_followup_settings to authenticated;
create policy debt_followup_settings_admin on public.debt_followup_settings for all to authenticated
  using ((select public.is_admin())
    and building_id = (select p.building_id from public.profiles p where p.user_id = (select auth.uid())))
  with check ((select public.is_admin())
    and building_id = (select p.building_id from public.profiles p where p.user_id = (select auth.uid())));

-- ---------------------------------------------------------------- follow-ups
-- status: steps 1-2 'pending' (due, waiting for the send) → 'sending' (claimed by a send) → 'sent', or 'review'
-- (the send died; unknown whether it went out: the admin resolves it); step 3 'open'
-- (the admin task) → 'done'; any step may end 'skipped' with a reason (paid / archived / exempt / below_min before
-- the send, stale: the step is no longer due, superseded by a higher step).
create table public.debt_followups (
  id uuid primary key default gen_random_uuid(),
  building_id uuid not null references public.buildings on delete cascade,
  apartment_id uuid not null references public.apartments on delete cascade,
  step smallint not null check (step in (1, 2, 3)),
  status text not null check (status in ('pending', 'sending', 'sent', 'review', 'open', 'done', 'skipped')),
  debt_amount numeric(12,2) not null check (debt_amount > 0),
  oldest_month date not null check (extract(day from oldest_month) = 1),
  days_overdue int not null check (days_overdue >= 0),
  created_at timestamptz not null default now(),
  claimed_at timestamptz,
  sent_at timestamptz,
  email_log_id uuid references public.email_log on delete set null,
  recipients int check (recipients >= 0),
  done_at timestamptz,
  done_by uuid references auth.users on delete set null,
  skip_reason text check (skip_reason in ('paid', 'archived', 'exempt', 'below_min', 'stale', 'superseded')),
  episode_closed_at timestamptz,
  constraint debt_followups_status_step check (
    case when step = 3 then status in ('open', 'done', 'skipped') else status in ('pending', 'sending', 'sent', 'review', 'skipped') end),
  constraint debt_followups_skip_reason check ((status = 'skipped') = (skip_reason is not null)),
  constraint debt_followups_claim check ((status = 'sending') = (claimed_at is not null))
);
-- A step counts as done in its episode unless it was skipped before it happened.
create unique index debt_followups_once_per_episode on public.debt_followups (apartment_id, step)
  where episode_closed_at is null and status <> 'skipped';
create index debt_followups_building_status_idx on public.debt_followups (building_id, status);
create index debt_followups_apartment_idx on public.debt_followups (apartment_id, created_at desc);
create index debt_followups_email_log_idx on public.debt_followups (email_log_id) where email_log_id is not null;
create index debt_followups_done_by_idx on public.debt_followups (done_by) where done_by is not null;

alter table public.debt_followups enable row level security;
revoke all on public.debt_followups from anon, authenticated, public;
grant select on public.debt_followups to authenticated;
create policy debt_followups_admin_select on public.debt_followups for select to authenticated
  using ((select public.is_admin())
    and building_id = (select p.building_id from public.profiles p where p.user_id = (select auth.uid())));

-- ---------------------------------------------------------------- candidates (internal)
-- Every apartment of the building with its balance, oldest unpaid month (settlement_plan's allocation), days
-- overdue at p_now and why it is skipped (null = eligible). Runs inside the definer functions below (finance views
-- read every apartment for a server role, as in apply_standing_orders); no API role executes it.
create function public.debt_followup_candidates(p_building uuid, p_now timestamptz default now())
returns table (apartment_id uuid, balance numeric, oldest_month date, days_overdue int, skip text)
language sql stable set search_path = ''
as $$
  select a.id, bal.balance, om.oldest, greatest(0, (p_now at time zone 'Asia/Jerusalem')::date - om.oldest)::int,
    case
      when a.archived_at is not null then 'archived'
      when bal.balance <= 0 or om.oldest is null then 'paid'
      when fee.fee_mode = 'exempt' then 'exempt'
      when bal.balance < s.min_amount then 'below_min'
    end
  from public.apartments a
  join public.debt_followup_settings s on s.building_id = a.building_id
  cross join lateral (select coalesce(sum(l.charged - l.paid), 0)::numeric(12,2) as balance
    from public.apartment_ledger l where l.apartment_id = a.id) bal
  cross join lateral (select f.fee_mode from public.apartment_fee_at(a.id,
    date_trunc('month', p_now at time zone 'Asia/Jerusalem')::date) f) fee
  cross join lateral (select min(p.month) as oldest from public.settlement_plan(a.id,
    (select array_agg(l.month) from public.apartment_ledger l where l.apartment_id = a.id)) p) om
  where a.building_id = p_building;
$$;
revoke execute on function public.debt_followup_candidates(uuid, timestamptz) from public, anon, authenticated;

-- The step `days` reaches under the building's settings: the highest switched-on step whose threshold has passed.
create function public.debt_followup_step(s public.debt_followup_settings, days int) returns smallint
language sql immutable set search_path = ''
as $$
  select (case
    when s.letter_on and days >= s.letter_days then 3
    when s.firm_on and days >= s.firm_days then 2
    when s.friendly_on and days >= s.friendly_days then 1
  end)::smallint;
$$;
revoke execute on function public.debt_followup_step(public.debt_followup_settings, int) from public, anon, authenticated;

-- Whether `step` itself is still due at `days`: switched on and its threshold passed.
create function public.debt_followup_step_due(s public.debt_followup_settings, step int, days int) returns boolean
language sql immutable set search_path = ''
as $$
  select coalesce(case step
    when 1 then s.friendly_on and days >= s.friendly_days
    when 2 then s.firm_on and days >= s.firm_days
    when 3 then s.letter_on and days >= s.letter_days
  end, false);
$$;
revoke execute on function public.debt_followup_step_due(public.debt_followup_settings, int, int) from public, anon, authenticated;

-- ---------------------------------------------------------------- sweep (internal)
-- 1. Closes the episode of every apartment that no longer owes, was archived, or whose oldest unpaid month moved
--    past the episode's (a new debt); its pending emails are skipped ('paid' / 'archived').
-- 2. Skips the pending emails of an open episode that may not be sent now: the apartment is exempt or below the
--    minimum, or the step is no longer due ('stale': switched off, or its threshold raised past the current days).
-- 3. A pending row left in an already-closed episode (released after its episode closed) is skipped ('paid').
create function public.debt_followup_sweep(p_building uuid, p_now timestamptz default now()) returns int
language plpgsql security definer set search_path = ''
as $$
declare
  s public.debt_followup_settings;
  n int;
  k int;
begin
  select * into s from public.debt_followup_settings where building_id = p_building;
  with c as materialized (select * from public.debt_followup_candidates(p_building, p_now)),
  ep as (select f.apartment_id, min(f.oldest_month) as oldest from public.debt_followups f
    where f.building_id = p_building and f.episode_closed_at is null group by f.apartment_id)
  update public.debt_followups f set episode_closed_at = now(),
    status = case when f.status = 'pending' then 'skipped' else f.status end,
    skip_reason = case when f.status = 'pending' then case when c.skip = 'archived' then 'archived' else 'paid' end else f.skip_reason end
  from c join ep on ep.apartment_id = c.apartment_id
  where f.apartment_id = c.apartment_id and f.episode_closed_at is null
    and (c.skip in ('paid', 'archived') or c.oldest_month > ep.oldest);
  get diagnostics n = row_count;
  with c as materialized (select * from public.debt_followup_candidates(p_building, p_now))
  update public.debt_followups f set status = 'skipped',
    skip_reason = coalesce(c.skip, 'stale')
  from c where f.apartment_id = c.apartment_id and f.episode_closed_at is null and f.status = 'pending'
    and (c.skip in ('exempt', 'below_min') or not public.debt_followup_step_due(s, f.step, c.days_overdue));
  get diagnostics k = row_count;
  n := n + k;
  update public.debt_followups f set status = 'skipped', skip_reason = 'paid'
  where f.building_id = p_building and f.status = 'pending' and f.episode_closed_at is not null;
  get diagnostics k = row_count;
  return n + k;
end;
$$;
revoke execute on function public.debt_followup_sweep(uuid, timestamptz) from public, anon, authenticated;

-- ---------------------------------------------------------------- run (internal)
-- One building: sweep, then record the step each eligible apartment reached, unless that step or a higher one was
-- already done in the episode; a lower pending email is superseded. Off (or no settings row) = nothing.
-- Serialised per building. Returns {enabled, swept, created}.
create function public.debt_followup_run(p_building uuid, p_now timestamptz default now()) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  s public.debt_followup_settings;
  v_swept int;
  v_created int;
begin
  select * into s from public.debt_followup_settings where building_id = p_building;
  if not found or not s.enabled then
    return jsonb_build_object('enabled', false, 'swept', 0, 'created', 0);
  end if;
  perform pg_advisory_xact_lock(hashtextextended('debt_followup:' || p_building::text, 0));
  v_swept := public.debt_followup_sweep(p_building, p_now);
  with t as (
    select c.*, public.debt_followup_step(s, c.days_overdue) as step
    from public.debt_followup_candidates(p_building, p_now) c where c.skip is null
  ), ins as (
    insert into public.debt_followups (building_id, apartment_id, step, status, debt_amount, oldest_month, days_overdue)
    select p_building, t.apartment_id, t.step, case when t.step = 3 then 'open' else 'pending' end,
      t.balance, t.oldest_month, t.days_overdue
    from t where t.step is not null and not exists (
      select 1 from public.debt_followups f where f.apartment_id = t.apartment_id and f.episode_closed_at is null
        and f.status <> 'skipped' and f.step >= t.step)
    on conflict do nothing
    returning apartment_id, step
  ), sup as (
    update public.debt_followups f set status = 'skipped', skip_reason = 'superseded'
    from ins where f.apartment_id = ins.apartment_id and f.episode_closed_at is null and f.status = 'pending'
      and f.step < ins.step
    returning f.id
  ) select count(*)::int into v_created from ins;
  return jsonb_build_object('enabled', true, 'swept', v_swept, 'created', v_created);
end;
$$;
revoke execute on function public.debt_followup_run(uuid, timestamptz) from public, anon, authenticated;

-- ---------------------------------------------------------------- the daily job (pg_cron, internal)
-- True during the 09:00 hour in Israel (both UTC+2 and UTC+3).
create function public.debt_followup_due_hour(p_now timestamptz) returns boolean
language sql immutable set search_path = ''
as $$
  select extract(hour from p_now at time zone 'Asia/Jerusalem') = 9;
$$;
revoke execute on function public.debt_followup_due_hour(timestamptz) from public, anon, authenticated;

-- Scheduled hourly in UTC; acts only at 09:xx in Israel (p_now: tests pin the clock). Returns the buildings run.
create function public.debt_followup_cron(p_now timestamptz default now()) returns int
language plpgsql security definer set search_path = ''
as $$
declare
  n int := 0;
  b uuid;
begin
  if not public.debt_followup_due_hour(p_now) then
    return 0;
  end if;
  for b in select building_id from public.debt_followup_settings where enabled loop
    perform public.debt_followup_run(b, p_now);
    n := n + 1;
  end loop;
  return n;
end;
$$;
revoke execute on function public.debt_followup_cron(timestamptz) from public, anon, authenticated;

-- ---------------------------------------------------------------- admin RPCs
-- "בדיקה עכשיו" (and after saving the settings): the same run for the admin's own building, without waiting for 09:00.
create function public.refresh_debt_followups() returns jsonb
language plpgsql security definer set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'admin only' using errcode = '42501';
  end if;
  return public.debt_followup_run((select p.building_id from public.profiles p where p.user_id = (select auth.uid())));
end;
$$;
revoke execute on function public.refresh_debt_followups() from public, anon;
grant execute on function public.refresh_debt_followups() to authenticated;

-- "טופל": closes a step-3 task of the admin's building. True when a task was closed.
create function public.complete_debt_followup_task(p_id uuid) returns boolean
language plpgsql security definer set search_path = ''
as $$
declare
  n int;
begin
  if not public.is_admin() then
    raise exception 'admin only' using errcode = '42501';
  end if;
  update public.debt_followups set status = 'done', done_at = now(), done_by = (select auth.uid())
  where id = p_id and step = 3 and status = 'open'
    and building_id = (select p.building_id from public.profiles p where p.user_id = (select auth.uid()));
  get diagnostics n = row_count;
  return n > 0;
end;
$$;
revoke execute on function public.complete_debt_followup_task(uuid) from public, anon;
grant execute on function public.complete_debt_followup_task(uuid) to authenticated;

-- A 'review' row (unknown whether its email went out): p_sent true → 'sent' (the admin saw it in the email log);
-- false → back to 'pending' for the next send (skipped as 'paid' if its episode closed). True when a row changed.
create function public.resolve_debt_followup(p_id uuid, p_sent boolean) returns boolean
language plpgsql security definer set search_path = ''
as $$
declare
  n int;
begin
  if not public.is_admin() then
    raise exception 'admin only' using errcode = '42501';
  end if;
  if p_sent is null then
    raise exception 'p_sent is required' using errcode = '22023';
  end if;
  update public.debt_followups f set
    status = case when p_sent then 'sent' when f.episode_closed_at is null then 'pending' else 'skipped' end,
    skip_reason = case when not p_sent and f.episode_closed_at is not null then 'paid' end,
    sent_at = case when p_sent then now() end
  where f.id = p_id and f.status = 'review'
    and f.building_id = (select p.building_id from public.profiles p where p.user_id = (select auth.uid()));
  get diagnostics n = row_count;
  return n > 0;
end;
$$;
revoke execute on function public.resolve_debt_followup(uuid, boolean) from public, anon;
grant execute on function public.resolve_debt_followup(uuid, boolean) to authenticated;

-- ---------------------------------------------------------------- send-email (service role)
-- The pending emails (steps 1-2) that may be sent now: the apartment still eligible, the episode still about the
-- same debt (oldest unpaid month not later than the episode's), and the step still due at the current days overdue.
-- Read only. Internal.
create function public.debt_followup_sendable(p_building uuid)
returns table (id uuid, apartment_id uuid, step smallint, balance numeric, days_overdue int)
language sql stable set search_path = ''
as $$
  select f.id, f.apartment_id, f.step, c.balance, c.days_overdue
  from public.debt_followup_settings s
  join public.debt_followups f on f.building_id = s.building_id
  join public.debt_followup_candidates(p_building) c on c.apartment_id = f.apartment_id and c.skip is null
  where s.building_id = p_building and s.enabled and f.status = 'pending' and f.step in (1, 2)
    and f.episode_closed_at is null
    and c.oldest_month <= (select min(e.oldest_month) from public.debt_followups e
      where e.apartment_id = f.apartment_id and e.episode_closed_at is null)
    and public.debt_followup_step_due(s, f.step, c.days_overdue)
  order by f.step desc, c.days_overdue desc, f.created_at;
$$;
revoke execute on function public.debt_followup_sendable(uuid) from public, anon, authenticated;

-- The emails to send now. p_claim false (preview, dry run): read only. p_claim true (a real send): serialised per
-- building, moves claims older than 15 minutes to 'review' (never back to pending: that send may have delivered), sweeps,
-- then claims the sendable rows (pending → 'sending') and
-- returns them, so a concurrent send gets nothing. Nothing while the automation is off.
create function public.debt_followups_ready(p_building uuid, p_claim boolean default false)
returns table (id uuid, apartment_id uuid, step smallint, balance numeric, days_overdue int)
language plpgsql security definer set search_path = ''
as $$
begin
  if not coalesce(p_claim, false) then
    return query select * from public.debt_followup_sendable(p_building);
    return;
  end if;
  if not exists (select 1 from public.debt_followup_settings s where s.building_id = p_building and s.enabled) then
    return;
  end if;
  perform pg_advisory_xact_lock(hashtextextended('debt_followup:' || p_building::text, 0));
  update public.debt_followups f set status = 'review', claimed_at = null
  where f.building_id = p_building and f.status = 'sending' and f.claimed_at < now() - interval '15 minutes';
  perform public.debt_followup_sweep(p_building);
  return query
  with c as materialized (select * from public.debt_followup_sendable(p_building)),
  claimed as (
    update public.debt_followups f set status = 'sending', claimed_at = now()
    from c where f.id = c.id and f.status = 'pending'
    returning f.id
  )
  select c.* from c join claimed using (id)
  order by c.step desc, c.days_overdue desc;
end;
$$;
revoke execute on function public.debt_followups_ready(uuid, boolean) from public, anon, authenticated;
grant execute on function public.debt_followups_ready(uuid, boolean) to service_role;

-- After a real send, for every row the send claimed: those in p_sent (id → emails delivered) → 'sent', linked to the
-- email_log row; the rest (failed, deferred by the quota, no resident email yet) go back to 'pending' for the next
-- send (skipped as 'paid' when their episode closed meanwhile). Only 'sending' rows of the building change. Returns
-- how many were marked sent.
create function public.finish_debt_followups(p_building uuid, p_claimed uuid[], p_sent jsonb, p_log uuid)
returns int
language plpgsql security definer set search_path = ''
as $$
declare
  n int;
begin
  update public.debt_followups f set status = 'sent', sent_at = now(), claimed_at = null, email_log_id = p_log,
    recipients = (x.value)::int
  from jsonb_each_text(coalesce(p_sent, '{}'::jsonb)) x
  where f.id = (x.key)::uuid and f.id = any (coalesce(p_claimed, '{}')) and f.building_id = p_building
    and f.status = 'sending';
  get diagnostics n = row_count;
  update public.debt_followups f set claimed_at = null,
    status = case when f.episode_closed_at is null then 'pending' else 'skipped' end,
    skip_reason = case when f.episode_closed_at is null then null else 'paid' end
  where f.id = any (coalesce(p_claimed, '{}')) and f.building_id = p_building and f.status = 'sending';
  return n;
end;
$$;
revoke execute on function public.finish_debt_followups(uuid, uuid[], jsonb, uuid) from public, anon, authenticated;
grant execute on function public.finish_debt_followups(uuid, uuid[], jsonb, uuid) to service_role;

-- ---------------------------------------------------------------- schedule (pg_cron)
-- Hourly at :05 UTC; debt_followup_cron() acts at 09:xx Israel time only (winter UTC+2 → 07:05 UTC, summer UTC+3 →
-- 06:05 UTC). Same fallback as 0014 where pg_cron is missing: a WARNING, and "בדיקה עכשיו" still works.
do $$
begin
  begin
    create extension if not exists pg_cron with schema pg_catalog;
  exception when others then
    raise warning 'pg_cron is NOT available, so debt follow-ups are NOT scheduled. Enable pg_cron and schedule "select public.debt_followup_cron()" hourly. (%)', sqlerrm;
    return;
  end;
  perform cron.schedule('debt-followup', '5 * * * *', 'select public.debt_followup_cron()');
end;
$$;
