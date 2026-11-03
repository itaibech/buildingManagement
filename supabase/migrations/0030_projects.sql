-- 0030 projects ("פרויקטים"): building projects (a new entrance door, a sewage pipe) with their price quotes, the
-- committee's decision, the levy that funds them and the expenses that paid for them.
--   * projects: title, description, status (planning → quotes → approved → in_progress → done, or cancelled), estimated
--     and final cost, start / end dates, the decision note and an optional meeting the decision was taken in.
--   * Levy link: levy_label (+ optional levy_month). A levy is one 'levy' charge row per apartment with the same label
--     (ChargeForms → LevyForm), so the project matches the label (and the month when given, else every month: a levy
--     split into instalments). Matching by label picks up apartments charged later too, unlike a stored id list.
--   * Expense link: expenses.project_id (nullable, on delete set null), set by admins through the expenses policies.
--   * project_quotes: vendor, amount, notes and an optional file in the private 'project-files' bucket
--     (`<project_id>/<uuid>.<ext>`, the receipts whitelist, 10 MB). At most one quote per project is_chosen; the choice
--     (with the decision note and meeting) is written by choose_project_quote() only.
--   * project_events: the status timeline, written by a trigger (created + every status change). Read-only for API users.
--   * project_progress(): aggregates only (levy charged / due / collected / written off, apartments charged / still
--     owing, spent). Never an apartment id or one apartment's amount; apartment counts are hidden from non-admins when
--     fewer than 3 apartments are charged. "Collected" follows the app's allocation (see project_levy_lines).
--   * One levy is linked to one project at most: unique (building, label, month), and an all-months link excludes any
--     other link of the label.
--   * Column privileges keep created_by / actor uuids away from API users (the app never reads them).
-- Permissions: new key 'projects' (granted to the default group "דייר"). Residents with it read projects, the timeline,
-- the progress aggregates and the chosen quote; the other quotes and every quote file only when the admin ticks
-- show_quotes ("הצג הצעות לדיירים", default off). Raw expense rows stay admin-only (0016). Admins do everything.

-- ---------------------------------------------------------------- permission
insert into public.permissions (key, label, description, sort_order) values
  ('projects', 'פרויקטים', 'פרויקטים בבניין: התקדמות, עלות, גבייה והצעת המחיר שנבחרה', 10);
insert into public.group_permissions (group_id, permission)
select id, 'projects' from public.user_groups where is_default
on conflict do nothing;

-- ---------------------------------------------------------------- storage path rule
-- `<project_id>/<uuid>.<ext>` with the receipts whitelist (images, PDF, Word). Lower-case uuids only.
create function public.is_project_storage_path(p_name text) returns boolean
language sql immutable set search_path = ''
as $$
  select coalesce(p_name ~ ('^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/'
    || '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|jpeg|png|webp|heic|heif|gif|pdf|doc|docx)$'), false);
$$;
revoke execute on function public.is_project_storage_path(text) from public, anon;
grant execute on function public.is_project_storage_path(text) to authenticated;

-- ---------------------------------------------------------------- tables
create table public.projects (
  id uuid primary key default gen_random_uuid(),
  building_id uuid not null default public.default_building_id() references public.buildings on delete cascade,
  title text not null check (char_length(trim(title)) between 1 and 200),
  description text not null default '' check (char_length(description) <= 4000),
  status text not null default 'planning'
    check (status in ('planning', 'quotes', 'approved', 'in_progress', 'done', 'cancelled')),
  estimated_cost numeric(12,2) check (estimated_cost between 0 and 100000000),
  final_cost numeric(12,2) check (final_cost between 0 and 100000000),
  start_date date,
  end_date date,
  levy_label text check (char_length(trim(levy_label)) between 1 and 200),
  levy_month date check (extract(day from levy_month) = 1),
  show_quotes boolean not null default false,
  decision_note text not null default '' check (char_length(decision_note) <= 1000),
  decision_meeting_id uuid references public.meetings on delete set null,
  created_by uuid default auth.uid() references auth.users on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint projects_dates check (end_date is null or start_date is null or end_date >= start_date),
  constraint projects_levy_month check (levy_month is null or levy_label is not null)
);
create index projects_building_idx on public.projects (building_id, created_at desc);
create index projects_decision_meeting_idx on public.projects (decision_meeting_id);
create index projects_created_by_idx on public.projects (created_by);

create table public.project_quotes (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects on delete cascade,
  vendor text not null check (char_length(trim(vendor)) between 1 and 200),
  amount numeric(12,2) not null check (amount between 0 and 100000000),
  notes text not null default '' check (char_length(notes) <= 2000),
  file_path text unique check (file_path is null
    or (public.is_project_storage_path(file_path) and split_part(file_path, '/', 1) = project_id::text)),
  file_name text check (char_length(trim(file_name)) between 1 and 255),
  file_size int check (file_size between 1 and 10485760),
  is_chosen boolean not null default false,
  created_by uuid default auth.uid() references auth.users on delete set null,
  created_at timestamptz not null default now(),
  constraint project_quotes_file check ((file_path is null) = (file_name is null) and (file_path is null) = (file_size is null))
);
create index project_quotes_project_idx on public.project_quotes (project_id, amount);
create unique index project_quotes_one_chosen on public.project_quotes (project_id) where is_chosen;
create index project_quotes_created_by_idx on public.project_quotes (created_by);

create table public.project_events (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects on delete cascade,
  status text not null,
  actor uuid default auth.uid() references auth.users on delete set null,
  -- clock_timestamp: two changes in one transaction still sort in order.
  created_at timestamptz not null default clock_timestamp()
);
create index project_events_project_idx on public.project_events (project_id, created_at);
create index project_events_actor_idx on public.project_events (actor);

alter table public.expenses add column project_id uuid references public.projects on delete set null;
create index expenses_project_id_idx on public.expenses (project_id) where project_id is not null;

-- ---------------------------------------------------------------- triggers
-- The timeline: a row when the project is created and on every status change. updated_at follows every edit.
-- SECURITY DEFINER: API users can't write project_events directly.
create function public.projects_track() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' then
    new.updated_at := now();
    if new.status is distinct from old.status then
      insert into public.project_events (project_id, status) values (new.id, new.status);
    end if;
    return new;
  end if;
  insert into public.project_events (project_id, status) values (new.id, new.status);
  return new;
end;
$$;
revoke execute on function public.projects_track() from public, anon, authenticated;
create trigger projects_track_insert after insert on public.projects
  for each row execute function public.projects_track();
create trigger projects_track_update before update on public.projects
  for each row execute function public.projects_track();

-- API users: is_chosen moves only through choose_project_quote() (a definer, so it runs as a server role here); a
-- quote never moves to another project.
create function public.project_quotes_guard() returns trigger
language plpgsql set search_path = ''
as $$
begin
  if current_user not in ('authenticated', 'anon') then
    return new;
  end if;
  if tg_op = 'INSERT' and new.is_chosen then
    raise exception 'Use choose_project_quote() to choose a quote' using errcode = '42501';
  end if;
  if tg_op = 'UPDATE' and (new.is_chosen is distinct from old.is_chosen or new.project_id is distinct from old.project_id) then
    raise exception 'Use choose_project_quote() to choose a quote' using errcode = '42501';
  end if;
  if tg_op = 'INSERT' then
    new.created_by := auth.uid();
  end if;
  return new;
end;
$$;
revoke execute on function public.project_quotes_guard() from public, anon, authenticated;
create trigger project_quotes_guard before insert or update on public.project_quotes
  for each row execute function public.project_quotes_guard();

-- A deleted chosen quote takes the decision with it: no note, no meeting, and an approved project is back to quotes.
-- Definer: runs whoever deletes (an admin, or the cascade of a deleted project, which then updates nothing).
create function public.project_quotes_unchoose() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  update public.projects set decision_note = '', decision_meeting_id = null,
    status = case when status = 'approved' then 'quotes' else status end
  where id = old.project_id;
  return old;
end;
$$;
revoke execute on function public.project_quotes_unchoose() from public, anon, authenticated;
create trigger project_quotes_unchoose after delete on public.project_quotes
  for each row when (old.is_chosen) execute function public.project_quotes_unchoose();

-- ---------------------------------------------------------------- one project per levy
-- The same levy (label + month, or label in every month) is linked to one project at most. The index covers equal
-- links; the trigger also refuses an all-months link next to any other link of the label (and the reverse).
create unique index projects_levy_unique on public.projects
  (building_id, trim(levy_label), coalesce(levy_month, 'epoch'::date)) where levy_label is not null;

create function public.projects_levy_guard() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if new.levy_label is not null and exists (
    select 1 from public.projects p
    where p.building_id = new.building_id and p.id <> new.id and trim(p.levy_label) = trim(new.levy_label)
      and (p.levy_month is null or new.levy_month is null or p.levy_month = new.levy_month)
  ) then
    raise exception 'This levy is already linked to another project' using errcode = '23505';
  end if;
  return new;
end;
$$;
revoke execute on function public.projects_levy_guard() from public, anon, authenticated;
create trigger projects_levy_guard before insert or update of levy_label, levy_month, building_id on public.projects
  for each row execute function public.projects_levy_guard();

-- ---------------------------------------------------------------- RLS
alter table public.projects enable row level security;
alter table public.project_quotes enable row level security;
alter table public.project_events enable row level security;
revoke all on public.projects, public.project_quotes, public.project_events from anon;
revoke insert, update, delete on public.project_events from authenticated;
-- Who created a project or quote and who changed a status stay server-side: API users read every other column.
revoke select on public.projects, public.project_quotes, public.project_events from authenticated;
grant select (id, building_id, title, description, status, estimated_cost, final_cost, start_date, end_date, levy_label,
  levy_month, show_quotes, decision_note, decision_meeting_id, created_at, updated_at) on public.projects to authenticated;
grant select (id, project_id, vendor, amount, notes, file_path, file_name, file_size, is_chosen, created_at)
  on public.project_quotes to authenticated;
grant select (id, project_id, status, created_at) on public.project_events to authenticated;

create policy projects_admin on public.projects for all to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));
create policy projects_select on public.projects for select to authenticated
  using ((select public.has_permission('projects')));

create policy project_quotes_admin on public.project_quotes for all to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));
-- Residents: the chosen quote always; the others only when the admin shows the quotes to residents.
create policy project_quotes_select on public.project_quotes for select to authenticated
  using ((select public.has_permission('projects')) and (is_chosen or exists (
    select 1 from public.projects p where p.id = project_id and p.show_quotes)));

create policy project_events_select on public.project_events for select to authenticated
  using ((select public.has_permission('projects')));

-- ---------------------------------------------------------------- storage
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('project-files', 'project-files', false, 10485760, array[
  'image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif', 'image/gif', 'application/pdf',
  'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'])
on conflict (id) do update set
  public = excluded.public, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

-- Whether the project a storage object belongs to shows its quotes to residents (false for a malformed path).
create function public.project_file_shown(p_name text) returns boolean
language sql stable security definer set search_path = ''
as $$
  select case when public.is_project_storage_path(p_name)
    then coalesce((select p.show_quotes from public.projects p where p.id = split_part(p_name, '/', 1)::uuid), false)
    else false end;
$$;
revoke execute on function public.project_file_shown(text) from public, anon;
grant execute on function public.project_file_shown(text) to authenticated;

create policy project_files_read on storage.objects for select to authenticated
  using (bucket_id = 'project-files' and ((select public.is_admin())
    or ((select public.has_permission('projects')) and public.project_file_shown(name))));
create policy project_files_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'project-files' and (select public.is_admin()) and public.is_project_storage_path(name));
create policy project_files_update on storage.objects for update to authenticated
  using (bucket_id = 'project-files' and (select public.is_admin()))
  with check (bucket_id = 'project-files' and (select public.is_admin()) and public.is_project_storage_path(name));
create policy project_files_delete on storage.objects for delete to authenticated
  using (bucket_id = 'project-files' and (select public.is_admin()));

-- ---------------------------------------------------------------- choose a quote (admin)
-- Marks p_quote chosen (null / omitted: no quote is chosen) and records the decision note and meeting. A project still in
-- planning / quotes moves to approved. The meeting must belong to the project's building.
create function public.choose_project_quote(p_project uuid, p_quote uuid default null, p_note text default '',
  p_meeting uuid default null)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_building uuid;
  v_note text := coalesce(trim(p_note), '');
begin
  if not public.is_admin() then
    raise exception 'admin only' using errcode = '42501';
  end if;
  select building_id into v_building from public.projects where id = p_project for update;
  if v_building is null then
    raise exception 'project not found' using errcode = 'P0002';
  end if;
  if p_quote is not null and not exists (select 1 from public.project_quotes where id = p_quote and project_id = p_project) then
    raise exception 'quote not found' using errcode = 'P0002';
  end if;
  if p_meeting is not null and not exists (select 1 from public.meetings where id = p_meeting and building_id = v_building) then
    raise exception 'meeting not found' using errcode = 'P0002';
  end if;
  if char_length(v_note) > 1000 then
    raise exception 'decision note is too long' using errcode = '22023';
  end if;
  update public.project_quotes set is_chosen = false where project_id = p_project and is_chosen and id is distinct from p_quote;
  update public.project_quotes set is_chosen = true where id = p_quote and not is_chosen;
  update public.projects set decision_note = case when p_quote is null then '' else v_note end,
    decision_meeting_id = case when p_quote is null then null else p_meeting end,
    status = case when p_quote is not null and status in ('planning', 'quotes') then 'approved' else status end
  where id = p_project;
end;
$$;
revoke execute on function public.choose_project_quote(uuid, uuid, text, uuid) from public, anon;
grant execute on function public.choose_project_quote(uuid, uuid, text, uuid) to authenticated;

-- ---------------------------------------------------------------- progress (aggregates)
-- The levy's open part per apartment and month, by the app's own allocation (settlement_plan / settlement.ts):
--   * the apartment's balance goes to its open months (charged > paid) oldest first: take(m) = least(open(m), what the
--     balance still leaves);
--   * within a month the open amount is attributed to EV, then special, then other charges, then levies, then the fee
--     (debtBreakdown / monthParts): levy_open(m) = least(levy(m), max(take(m) - ev - special - other, 0)).
--   * write-offs ('adjustment' charges) lower charged, so they would look paid. The same formula with the month's
--     write-off added back to take(m) gives the levy's open part before it; the difference is written off ("נמחק"),
--     never collected.
--   * several levies in one month share the month's levy part in proportion to their amounts.
-- Levy charges of an apartment archived before the levy's month are left out (the 0022 rule). Internal: invoker, read
-- as the definer that calls it (project_progress), so the ledger sees every apartment of the building.
create function public.project_levy_lines(p_building uuid)
returns table (project_id uuid, apartment_id uuid, month date, amount numeric, open numeric, written_off numeric)
language sql stable set search_path = ''
as $$
  with links as (
    select pr.id as pid, c.apartment_id, c.month, c.amount
    from public.projects pr
    join public.charges c on c.building_id = pr.building_id and c.kind = 'levy' and c.ev_reading_id is null
      and c.special_id is null and trim(c.label) = trim(pr.levy_label) and (pr.levy_month is null or c.month = pr.levy_month)
    join public.apartments a on a.id = c.apartment_id
    where pr.building_id = p_building and pr.levy_label is not null
      and (a.archived_at is null or date_trunc('month', a.archived_at at time zone 'Asia/Jerusalem') >= c.month)
  ), apts as (
    select distinct links.apartment_id from links
  ), ledger as (
    select l.apartment_id, l.month, l.charged - l.paid as open, coalesce(l.adjusted, 0) as adjusted,
      sum(l.charged - l.paid) over (partition by l.apartment_id) as balance
    from public.apartment_ledger l join apts on apts.apartment_id = l.apartment_id
  ), opened as (
    select ledger.apartment_id, ledger.month, ledger.open, ledger.balance,
      coalesce(sum(ledger.open) over (partition by ledger.apartment_id order by ledger.month
        rows between unbounded preceding and 1 preceding), 0) as prior
    from ledger where ledger.open > 0
  ), parts as (
    select c.apartment_id, c.month,
      greatest(coalesce(sum(c.amount) filter (where c.ev_reading_id is not null), 0), 0) as ev,
      greatest(coalesce(sum(c.amount) filter (where c.ev_reading_id is null and c.special_id is not null), 0), 0) as special,
      greatest(coalesce(sum(c.amount) filter (where c.ev_reading_id is null and c.special_id is null
        and c.kind not in ('levy', 'adjustment')), 0), 0) as other,
      coalesce(sum(c.amount) filter (where c.ev_reading_id is null and c.special_id is null and c.kind = 'levy'), 0) as levy
    from public.charges c join apts on apts.apartment_id = c.apartment_id
    where c.month <= public.current_month()
    group by c.apartment_id, c.month
  ), months as (
    select p.apartment_id, p.month, p.levy,
      least(p.levy, greatest(t.take - p.ev - p.special - p.other, 0)) as open_now,
      least(p.levy, greatest(t.take - coalesce(lg.adjusted, 0) - p.ev - p.special - p.other, 0)) as open_before
    from parts p
    left join ledger lg on lg.apartment_id = p.apartment_id and lg.month = p.month
    cross join lateral (select coalesce((select least(o.open, greatest(o.balance - o.prior, 0)) from opened o
      where o.apartment_id = p.apartment_id and o.month = p.month), 0) as take) t
    where p.levy > 0
  )
  select links.pid, links.apartment_id, links.month, links.amount,
    coalesce(round(m.open_now * links.amount / m.levy, 2), 0),
    coalesce(round((m.open_before - m.open_now) * links.amount / m.levy, 2), 0)
  from links left join months m on m.apartment_id = links.apartment_id and m.month = links.month;
$$;
revoke execute on function public.project_levy_lines(uuid) from public, anon, authenticated;

-- One row per project of the caller's building: levy_total (every linked charge), levy_due (through the current
-- month), levy_collected (due minus open minus written off), levy_written_off, apartments_charged / apartments_open,
-- spent (linked expenses) and expense_count. Admins and holders of 'projects' only; definer so residents get
-- building-wide sums. For non-admins, a levy charged to fewer than 3 apartments returns no apartment counts and no
-- write-off (counts_hidden), so the numbers can't single out one apartment.
create function public.project_progress()
returns table (project_id uuid, levy_total numeric, levy_due numeric, levy_collected numeric, levy_written_off numeric,
  apartments_charged int, apartments_open int, counts_hidden boolean, spent numeric, expense_count int)
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_admin constant boolean := public.is_admin();
  v_building constant uuid := (select p.building_id from public.profiles p where p.user_id = (select auth.uid()));
begin
  if not (v_admin or public.has_permission('projects')) then
    raise exception 'not permitted' using errcode = '42501';
  end if;
  return query
  with lines as (
    select * from public.project_levy_lines(v_building)
  ), apt as (
    select l.project_id as pid, l.apartment_id, sum(l.amount) as total,
      coalesce(sum(l.amount) filter (where l.month <= public.current_month()), 0) as due,
      sum(l.open) as open, sum(l.written_off) as written_off
    from lines l group by l.project_id, l.apartment_id
  ), levy as (
    select apt.pid, sum(apt.total) as total, sum(apt.due) as due, sum(apt.open) as open, sum(apt.written_off) as written_off,
      count(*) filter (where apt.due > 0) as charged, count(*) filter (where apt.open > 0) as owing
    from apt group by apt.pid
  ), spend as (
    select e.project_id as pid, sum(e.amount) as total, count(*) as n
    from public.expenses e join public.projects pr on pr.id = e.project_id
    where pr.building_id = v_building group by e.project_id
  ), res as (
    select pr.id, coalesce(levy.total, 0) as total, coalesce(levy.due, 0) as due, coalesce(levy.open, 0) as open,
      coalesce(levy.written_off, 0) as written_off, coalesce(levy.charged, 0)::int as charged,
      coalesce(levy.owing, 0)::int as owing, (not v_admin and coalesce(levy.charged, 0) between 1 and 2) as hidden,
      coalesce(spend.total, 0) as spent, coalesce(spend.n, 0)::int as n
    from public.projects pr
    left join levy on levy.pid = pr.id
    left join spend on spend.pid = pr.id
    where pr.building_id = v_building
  )
  select res.id, res.total::numeric(12,2), res.due::numeric(12,2),
    (res.due - res.open - res.written_off)::numeric(12,2),
    case when res.hidden then 0 else res.written_off end::numeric(12,2),
    case when res.hidden then 0 else res.charged end, case when res.hidden then 0 else res.owing end, res.hidden,
    res.spent::numeric(12,2), res.n
  from res;
end;
$$;
revoke execute on function public.project_progress() from public, anon;
grant execute on function public.project_progress() to authenticated;
