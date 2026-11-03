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
--   * project_progress(): aggregates only (levy charged / due / collected, apartments charged / still owing, spent).
--     Never an apartment id or one apartment's amount. "Collected" applies the ledger's rule that an apartment's payments
--     cover the fee and other charges first, the levy last: the levy's open part is min(levy due, the apartment's balance).
-- Permissions: new key 'projects' (granted to the default group "דייר"). Residents with it read projects, the timeline,
-- the progress aggregates and the chosen quote; the other quotes and every quote file only when the admin ticks
-- show_quotes ("הצג הצעות לדיירים", default off). Raw expense rows stay admin-only (0016). Admins do everything.

-- ---------------------------------------------------------------- permission
insert into public.permissions (key, label, description, sort_order) values
  ('projects', 'פרויקטים', 'פרויקטים בבניין: התקדמות, עלות, גבייה והצעת המחיר שנבחרה', 9);
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

-- ---------------------------------------------------------------- RLS
alter table public.projects enable row level security;
alter table public.project_quotes enable row level security;
alter table public.project_events enable row level security;
revoke all on public.projects, public.project_quotes, public.project_events from anon;
revoke insert, update, delete on public.project_events from authenticated;

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
  select public.is_project_storage_path(p_name) and coalesce((select p.show_quotes from public.projects p
    where p.id = split_part(p_name, '/', 1)::uuid), false);
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
-- One row per project of the caller's building: levy_total (every linked charge), levy_due (through the current
-- month), levy_collected (levy_due minus what is still open), apartments_charged / apartments_open, spent (linked
-- expenses) and expense_count. Admins and holders of 'projects' only. Definer so residents get building-wide sums;
-- the ledger is read as the owner (can_read_apartment_finance lets server sessions through), as collection_summary does.
create function public.project_progress()
returns table (project_id uuid, levy_total numeric, levy_due numeric, levy_collected numeric,
  apartments_charged int, apartments_open int, spent numeric, expense_count int)
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_building constant uuid := (select p.building_id from public.profiles p where p.user_id = (select auth.uid()));
begin
  if not (public.is_admin() or public.has_permission('projects')) then
    raise exception 'not permitted' using errcode = '42501';
  end if;
  return query
  with lc as (
    select pr.id as pid, c.apartment_id, sum(c.amount) as total,
      coalesce(sum(c.amount) filter (where c.month <= public.current_month()), 0) as due
    from public.projects pr
    join public.charges c on c.building_id = pr.building_id and c.kind = 'levy'
      and trim(c.label) = trim(pr.levy_label) and (pr.levy_month is null or c.month = pr.levy_month)
    where pr.building_id = v_building and pr.levy_label is not null
    group by pr.id, c.apartment_id
  ), apt as (
    select lc.pid, lc.total, lc.due, least(lc.due, greatest(coalesce((select sum(l.charged - l.paid)
      from public.apartment_ledger l where l.apartment_id = lc.apartment_id), 0), 0)) as open
    from lc
  ), levy as (
    select apt.pid, sum(apt.total) as total, sum(apt.due) as due, sum(apt.open) as open,
      count(*) filter (where apt.due > 0) as charged, count(*) filter (where apt.open > 0) as owing
    from apt group by apt.pid
  ), spend as (
    select e.project_id as pid, sum(e.amount) as total, count(*) as n
    from public.expenses e join public.projects pr on pr.id = e.project_id
    where pr.building_id = v_building group by e.project_id
  )
  select pr.id, coalesce(levy.total, 0)::numeric(12,2), coalesce(levy.due, 0)::numeric(12,2),
    coalesce(levy.due - levy.open, 0)::numeric(12,2), coalesce(levy.charged, 0)::int, coalesce(levy.owing, 0)::int,
    coalesce(spend.total, 0)::numeric(12,2), coalesce(spend.n, 0)::int
  from public.projects pr
  left join levy on levy.pid = pr.id
  left join spend on spend.pid = pr.id
  where pr.building_id = v_building;
end;
$$;
revoke execute on function public.project_progress() from public, anon;
grant execute on function public.project_progress() to authenticated;
