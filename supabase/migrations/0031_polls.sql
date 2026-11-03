-- 0031 polls (סקרים והצבעות): committee votes between assemblies, one vote per apartment.
--   * polls: a yes/no (בעד / נגד / נמנע = choices 0 / 1 / 2) or single-choice (2–10 options, choice = option index)
--     question with a voting window (opens_at, closes_at), a required majority (simple: more for than against /
--     the leader ahead of every other option; two_thirds or percent: the for votes reach ceil(base × share)), the
--     base for that share ('building' = every active apartment, 'eligible' = the apartments in scope), the scope
--     (all apartments or the ones in poll_apartments) and when residents see the counts (live / after_close).
--   * Lifecycle draft → open → closed, only through admin RPCs: save_poll (drafts), open_poll (posts an announcement
--     linking to the poll, so the 0015 notifications toast it), close_poll (freezes the tally into final_result).
--     Admins may delete drafts. There are no insert/update policies: every write is an RPC.
--   * Votes (poll_votes): one row per (poll, apartment), replaced on revote, stamped with who voted and when (and
--     whether an admin recorded it for the apartment, "נרשם ע"י הוועד"). cast_poll_vote votes for the caller's own
--     apartment (my_apartment_id()); admin_record_vote for any apartment. Both check: open, inside the window,
--     the apartment active and in scope, a valid choice.
--   * Visibility (RLS): admins see everything. Users with 'polls' (on for the default group) see open and closed
--     polls, their scope, and their own apartment's vote only. Counts come from poll_results(): always for admins,
--     for residents live or once the window ended / the poll closed (participation only before that).
--   * Archived apartments are excluded from the tally (and from scope) until the poll closes; the frozen result
--     then stays as it was.

-- ---------------------------------------------------------------- permission
insert into public.permissions (key, label, description, sort_order) values
  ('polls', 'סקרים', 'סקרים והצבעות של הוועד בין האסיפות: הצבעה בשם הדירה וצפייה בתוצאות', 11);
insert into public.group_permissions (group_id, permission)
select id, 'polls' from public.user_groups where is_default
on conflict do nothing;

-- ---------------------------------------------------------------- tables
-- Single-choice options: 2–10 non-empty labels of up to 120 characters; yes/no has none (fixed choices).
create function public.poll_options_ok(p_kind text, p_options text[]) returns boolean
language sql immutable set search_path = ''
as $$
  select case p_kind
    when 'yes_no' then cardinality(p_options) = 0
    else cardinality(p_options) between 2 and 10
      and not exists (select 1 from unnest(p_options) o where o is null or char_length(trim(o)) not between 1 and 120)
  end;
$$;

create table public.polls (
  id uuid primary key default gen_random_uuid(),
  building_id uuid not null default public.default_building_id() references public.buildings on delete cascade,
  question text not null check (char_length(trim(question)) between 1 and 300),
  description text not null default '' check (char_length(description) <= 4000),
  kind text not null default 'yes_no' check (kind in ('yes_no', 'single_choice')),
  options text[] not null default '{}',
  opens_at timestamptz not null default now(),
  closes_at timestamptz not null,
  majority text not null default 'simple' check (majority in ('simple', 'two_thirds', 'percent')),
  majority_percent int check (majority_percent between 1 and 100),
  majority_base text not null default 'building' check (majority_base in ('building', 'eligible')),
  scope text not null default 'all' check (scope in ('all', 'selected')),
  results_visibility text not null default 'live' check (results_visibility in ('live', 'after_close')),
  status text not null default 'draft' check (status in ('draft', 'open', 'closed')),
  final_result jsonb,
  announcement_id uuid references public.announcements on delete set null,
  created_by uuid default auth.uid() references auth.users on delete set null,
  created_at timestamptz not null default now(),
  opened_at timestamptz,
  closed_at timestamptz,
  constraint polls_window check (closes_at > opens_at),
  constraint polls_options check (public.poll_options_ok(kind, options)),
  constraint polls_percent check ((majority = 'percent') = (majority_percent is not null)),
  constraint polls_frozen check ((status = 'closed') = (final_result is not null))
);
create index polls_building_id_idx on public.polls (building_id);
create index polls_announcement_id_idx on public.polls (announcement_id);
create index polls_created_by_idx on public.polls (created_by);

create table public.poll_apartments (
  poll_id uuid not null references public.polls on delete cascade,
  apartment_id uuid not null references public.apartments on delete cascade,
  primary key (poll_id, apartment_id)
);
create index poll_apartments_apartment_id_idx on public.poll_apartments (apartment_id);

create table public.poll_votes (
  poll_id uuid not null references public.polls on delete cascade,
  apartment_id uuid not null references public.apartments on delete cascade,
  choice smallint not null check (choice between 0 and 9),
  voted_by uuid references auth.users on delete set null,
  by_admin boolean not null default false,
  voted_at timestamptz not null default now(),
  primary key (poll_id, apartment_id)
);
create index poll_votes_apartment_id_idx on public.poll_votes (apartment_id);
create index poll_votes_voted_by_idx on public.poll_votes (voted_by);

-- ---------------------------------------------------------------- RLS (read only; writes go through the RPCs)
alter table public.polls enable row level security;
alter table public.poll_apartments enable row level security;
alter table public.poll_votes enable row level security;

create policy polls_select on public.polls for select to authenticated
  using ((select public.is_admin()) or ((select public.has_permission('polls')) and status <> 'draft'));
create policy polls_delete_draft on public.polls for delete to authenticated
  using ((select public.is_admin()) and status = 'draft');
-- The scope of a poll the user may see (the subquery applies the polls policy).
create policy poll_apartments_select on public.poll_apartments for select to authenticated
  using (exists (select 1 from public.polls p where p.id = poll_id));
create policy poll_votes_select on public.poll_votes for select to authenticated
  using ((select public.is_admin())
    or ((select public.has_permission('polls')) and apartment_id = (select public.my_apartment_id())));

-- ---------------------------------------------------------------- helpers (internal)
create function public.poll_require(p_ok boolean, p_reason text) returns void
language plpgsql set search_path = ''
as $$
begin
  if not coalesce(p_ok, false) then
    raise exception 'poll:%', p_reason using errcode = '22023';
  end if;
end;
$$;
revoke execute on function public.poll_require(boolean, text) from public, anon, authenticated;

create function public.poll_choice_count(p_kind text, p_options text[]) returns int
language sql immutable set search_path = ''
as $$ select case p_kind when 'yes_no' then 3 else cardinality(p_options) end; $$;
revoke execute on function public.poll_choice_count(text, text[]) from public, anon, authenticated;

-- The live tally: votes per choice of the active in-scope apartments, how many voted, and both majority bases.
create function public.poll_tally(p_poll uuid) returns jsonb
language sql stable security definer set search_path = ''
as $$
  with p as (select * from public.polls where id = p_poll),
  active as (select a.id from public.apartments a join p on a.building_id = p.building_id where a.archived_at is null),
  eligible as (
    select active.id from active, p
    where p.scope = 'all' or exists (select 1 from public.poll_apartments s where s.poll_id = p.id and s.apartment_id = active.id)),
  votes as (select v.choice from public.poll_votes v join eligible e on e.id = v.apartment_id where v.poll_id = p_poll)
  select jsonb_build_object(
    'counts', (select jsonb_agg((select count(*) from votes where choice = i) order by i)
               from p, generate_series(0, public.poll_choice_count(p.kind, p.options) - 1) i),
    'voted', (select count(*) from votes),
    'eligible', (select count(*) from eligible),
    'building', (select count(*) from active))
  from p;
$$;
revoke execute on function public.poll_tally(uuid) from public, anon, authenticated;

-- Writes one apartment's vote after every check (the poll row is locked against a concurrent close).
create function public.poll_write_vote(p_poll uuid, p_apartment uuid, p_choice int, p_by_admin boolean) returns void
language plpgsql security definer set search_path = ''
as $$
declare
  p public.polls;
begin
  select * into p from public.polls where id = p_poll for share;
  perform public.poll_require(p.id is not null and p.status <> 'draft', 'not_found');
  perform public.poll_require(p.status = 'open', 'closed');
  perform public.poll_require(now() >= p.opens_at, 'not_started');
  perform public.poll_require(now() < p.closes_at, 'ended');
  perform public.poll_require(exists (
    select 1 from public.apartments a
    where a.id = p_apartment and a.building_id = p.building_id and a.archived_at is null
      and (p.scope = 'all' or exists (select 1 from public.poll_apartments s where s.poll_id = p.id and s.apartment_id = a.id))
  ), 'out_of_scope');
  perform public.poll_require(p_choice between 0 and public.poll_choice_count(p.kind, p.options) - 1, 'bad_choice');
  insert into public.poll_votes (poll_id, apartment_id, choice, voted_by, by_admin, voted_at)
  values (p.id, p_apartment, p_choice, auth.uid(), p_by_admin, now())
  on conflict (poll_id, apartment_id) do update
    set choice = excluded.choice, voted_by = excluded.voted_by, by_admin = excluded.by_admin, voted_at = excluded.voted_at;
end;
$$;
revoke execute on function public.poll_write_vote(uuid, uuid, int, boolean) from public, anon, authenticated;

create function public.poll_require_admin() returns void
language plpgsql stable security definer set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'admin only' using errcode = '42501';
  end if;
end;
$$;
revoke execute on function public.poll_require_admin() from public, anon, authenticated;

-- ---------------------------------------------------------------- voting
-- A user with 'polls' votes for their own apartment (profiles.resident_id → residents.apartment_id).
create function public.cast_poll_vote(p_poll uuid, p_choice int) returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_apartment uuid;
begin
  if not public.has_permission('polls') then
    raise exception 'poll:forbidden' using errcode = '42501';
  end if;
  v_apartment := public.my_apartment_id();
  perform public.poll_require(v_apartment is not null, 'no_apartment');
  perform public.poll_write_vote(p_poll, v_apartment, p_choice, false);
end;
$$;
revoke execute on function public.cast_poll_vote(uuid, int) from public, anon;
grant execute on function public.cast_poll_vote(uuid, int) to authenticated;

-- Admin: record an apartment's vote on its behalf (an apartment without the app).
create function public.admin_record_vote(p_poll uuid, p_apartment uuid, p_choice int) returns void
language plpgsql security definer set search_path = ''
as $$
begin
  perform public.poll_require_admin();
  perform public.poll_write_vote(p_poll, p_apartment, p_choice, true);
end;
$$;
revoke execute on function public.admin_record_vote(uuid, uuid, int) from public, anon;
grant execute on function public.admin_record_vote(uuid, uuid, int) to authenticated;

-- The counts the caller may see: admins always; others for open or closed polls, the counts only when live or
-- once the window ended (participation only before that). A closed poll returns its frozen result.
create function public.poll_results(p_poll uuid) returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  p public.polls;
begin
  select * into p from public.polls where id = p_poll;
  if p.id is null or not (public.is_admin() or (public.has_permission('polls') and p.status <> 'draft')) then
    return null;
  end if;
  if p.status = 'closed' then
    return p.final_result;
  end if;
  if not public.is_admin() and p.results_visibility = 'after_close' and now() < p.closes_at then
    return public.poll_tally(p_poll) - 'counts';
  end if;
  return public.poll_tally(p_poll);
end;
$$;
revoke execute on function public.poll_results(uuid) from public, anon;
grant execute on function public.poll_results(uuid) to authenticated;

-- ---------------------------------------------------------------- admin lifecycle
-- Create (p_poll null) or edit a draft, with its scope. Options are trimmed; yes/no keeps none.
create function public.save_poll(p_question text, p_description text, p_kind text, p_options text[],
  p_opens_at timestamptz, p_closes_at timestamptz, p_majority text, p_majority_base text, p_scope text, p_results_visibility text,
  p_majority_percent int default null, p_apartments uuid[] default null, p_poll uuid default null) returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  v_id uuid;
  v_building uuid := (select building_id from public.profiles where user_id = auth.uid());
  v_options text[] := case when p_kind = 'yes_no' then '{}'::text[]
    else coalesce((select array_agg(trim(o) order by n) from unnest(p_options) with ordinality u(o, n)), '{}') end;
  v_percent int := case when p_majority = 'percent' then p_majority_percent end;
begin
  perform public.poll_require_admin();
  if p_poll is null then
    insert into public.polls (building_id, question, description, kind, options, opens_at, closes_at, majority, majority_percent,
      majority_base, scope, results_visibility)
    values (v_building, trim(p_question), coalesce(p_description, ''), p_kind, v_options, p_opens_at, p_closes_at, p_majority, v_percent,
      p_majority_base, p_scope, p_results_visibility)
    returning id into v_id;
  else
    update public.polls set question = trim(p_question), description = coalesce(p_description, ''), kind = p_kind, options = v_options,
      opens_at = p_opens_at, closes_at = p_closes_at, majority = p_majority, majority_percent = v_percent,
      majority_base = p_majority_base, scope = p_scope, results_visibility = p_results_visibility
    where id = p_poll and status = 'draft' and building_id = v_building
    returning id into v_id;
    perform public.poll_require(v_id is not null, 'not_draft');
  end if;
  delete from public.poll_apartments where poll_id = v_id;
  if p_scope = 'selected' then
    insert into public.poll_apartments (poll_id, apartment_id)
    select v_id, a.id from public.apartments a
    where a.id = any (p_apartments) and a.building_id = v_building and a.archived_at is null;
    perform public.poll_require(exists (select 1 from public.poll_apartments where poll_id = v_id), 'empty_scope');
  end if;
  return v_id;
end;
$$;
revoke execute on function public.save_poll(text, text, text, text[], timestamptz, timestamptz, text, text, text, text, int, uuid[], uuid)
  from public, anon;
grant execute on function public.save_poll(text, text, text, text[], timestamptz, timestamptz, text, text, text, text, int, uuid[], uuid)
  to authenticated;

-- The announcement text: the question, the description, the window and the scope.
create function public.poll_announcement_body(p_poll uuid) returns text
language sql stable set search_path = ''
as $$
  select concat_ws(E'\n',
    nullif(trim(p.description), ''),
    'ההצבעה פתוחה עד ' || to_char(p.closes_at at time zone 'Asia/Jerusalem', 'DD/MM/YYYY') || ' בשעה '
      || to_char(p.closes_at at time zone 'Asia/Jerusalem', 'HH24:MI') || '. קול אחד לכל דירה.',
    case when p.scope = 'selected' then 'הסקר מיועד לדירות: ' || (
      select string_agg(a.number::text, ', ' order by a.number)
      from public.poll_apartments s join public.apartments a on a.id = s.apartment_id where s.poll_id = p.id) end)
  from public.polls p where p.id = p_poll;
$$;
revoke execute on function public.poll_announcement_body(uuid) from public, anon, authenticated;

-- Draft → open: votes start at opens_at (now if earlier), and an announcement links to the poll until it closes.
create function public.open_poll(p_poll uuid) returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  p public.polls;
  v_announcement uuid;
begin
  perform public.poll_require_admin();
  select * into p from public.polls where id = p_poll for update;
  perform public.poll_require(p.id is not null, 'not_found');
  perform public.poll_require(p.status = 'draft', 'state');
  perform public.poll_require(p.closes_at > now(), 'ended');
  insert into public.announcements (building_id, title, body, pinned, expires_at, link)
  values (p.building_id, left('סקר חדש: ' || p.question, 300), public.poll_announcement_body(p.id), false,
    (p.closes_at at time zone 'Asia/Jerusalem')::date, '/polls/' || p.id)
  returning id into v_announcement;
  update public.polls set status = 'open', opens_at = greatest(opens_at, now()), opened_at = now(), announcement_id = v_announcement
  where id = p_poll;
  return v_announcement;
end;
$$;
revoke execute on function public.open_poll(uuid) from public, anon;
grant execute on function public.open_poll(uuid) to authenticated;

-- Open → closed: the tally is frozen into final_result; no vote is accepted after this.
create function public.close_poll(p_poll uuid) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  p public.polls;
  v_result jsonb;
begin
  perform public.poll_require_admin();
  select * into p from public.polls where id = p_poll for update;
  perform public.poll_require(p.id is not null, 'not_found');
  perform public.poll_require(p.status = 'open', 'state');
  v_result := public.poll_tally(p_poll);
  update public.polls set status = 'closed', closed_at = now(), final_result = v_result where id = p_poll;
  update public.announcements set expires_at = least(expires_at, (now() at time zone 'Asia/Jerusalem')::date)
  where id = p.announcement_id;
  return v_result;
end;
$$;
revoke execute on function public.close_poll(uuid) from public, anon;
grant execute on function public.close_poll(uuid) to authenticated;
