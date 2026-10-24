-- 0015 notifications (Task 17): live toasts and "unseen" badges for announcements and service calls.
--   * tickets.updated_at / last_activity_by / last_activity_kind: set by the tickets_touch trigger on every real
--     change, so the client can tell who did what (status change, opener's edit) from a Realtime payload alone.
--     It runs after tickets_guard (BEFORE triggers fire in name order), so the guard still sees the caller's row,
--     and a resident who tries to write the tracking columns is refused by the guard.
--   * ticket_seen: when each user last opened each call. Own rows only; written through mark_tickets_seen().
--   * my_ticket_activity(): the calls the user is notified about (admins: every call; others: the calls they
--     opened), with the latest activity by someone else and whether it is unseen. Security invoker, so the
--     tickets RLS still applies. No ticket_seen row = seen as of the account's creation; existing users are
--     backfilled as having seen everything, so the rollout doesn't light every badge.
--   * The supabase_realtime publication gains announcements, tickets and ticket_comments. Realtime applies the
--     tables' SELECT policies per subscriber, so pending users receive nothing.

-- ---------------------------------------------------------------- tickets: activity tracking
alter table public.tickets
  add column updated_at timestamptz,
  add column last_activity_by uuid references auth.users on delete set null,
  add column last_activity_kind text;
update public.tickets set updated_at = created_at, last_activity_by = opened_by, last_activity_kind = 'created';
alter table public.tickets
  alter column updated_at set default now(),
  alter column updated_at set not null,
  alter column last_activity_kind set default 'created',
  alter column last_activity_kind set not null,
  add constraint tickets_last_activity_kind_check check (last_activity_kind in ('created', 'status', 'edited', 'other'));
create index tickets_last_activity_by_idx on public.tickets (last_activity_by);

create function public.tickets_touch() returns trigger
language plpgsql set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    new.updated_at := new.created_at;
    new.last_activity_by := coalesce(auth.uid(), new.opened_by);
    new.last_activity_kind := 'created';
  elsif (to_jsonb(new) - 'updated_at' - 'last_activity_by' - 'last_activity_kind')
      is not distinct from (to_jsonb(old) - 'updated_at' - 'last_activity_by' - 'last_activity_kind') then
    new.updated_at := old.updated_at;
    new.last_activity_by := old.last_activity_by;
    new.last_activity_kind := old.last_activity_kind;
  else
    new.updated_at := now();
    new.last_activity_by := auth.uid();
    new.last_activity_kind := case
      when new.status is distinct from old.status then 'status'
      when (new.title, new.description, new.location) is distinct from (old.title, old.description, old.location) then 'edited'
      else 'other'
    end;
  end if;
  return new;
end;
$$;
revoke execute on function public.tickets_touch() from public, anon, authenticated;

create trigger tickets_touch
  before insert or update on public.tickets
  for each row execute function public.tickets_touch();

-- ---------------------------------------------------------------- ticket_seen
create table public.ticket_seen (
  ticket_id uuid not null references public.tickets on delete cascade,
  user_id uuid not null references auth.users on delete cascade,
  seen_at timestamptz not null default now(),
  primary key (ticket_id, user_id)
);
create index ticket_seen_user_id_idx on public.ticket_seen (user_id);
alter table public.ticket_seen enable row level security;

create policy ticket_seen_select on public.ticket_seen
  for select to authenticated using (user_id = (select auth.uid()));
create policy ticket_seen_insert on public.ticket_seen
  for insert to authenticated with check (user_id = (select auth.uid()) and public.is_approved());
create policy ticket_seen_update on public.ticket_seen
  for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

-- Existing users have "seen" every existing call.
insert into public.ticket_seen (ticket_id, user_id, seen_at)
select t.id, p.user_id, now() from public.tickets t cross join public.profiles p where p.status = 'approved';

-- ---------------------------------------------------------------- my_ticket_activity()
create function public.my_ticket_activity()
returns table (
  ticket_id uuid, title text, status text, opened_by uuid, apartment_number integer,
  activity_at timestamptz, activity_by uuid, activity_kind text, unseen boolean
)
language sql stable set search_path = ''
as $$
  with me as (
    select auth.uid() as id, public.is_admin() as admin,
      (select p.created_at from public.profiles p where p.user_id = auth.uid()) as joined
  )
  select t.id, t.title, t.status, t.opened_by, a.number,
    x.at, x.by, x.kind,
    coalesce(x.at > coalesce(s.seen_at, me.joined, '-infinity'::timestamptz), false)
  from me
  join public.tickets t on me.admin or t.opened_by = me.id
  left join public.ticket_seen s on s.ticket_id = t.id and s.user_id = me.id
  left join lateral (
    select c.created_at, c.author_id from public.ticket_comments c
    where c.ticket_id = t.id and c.author_id is distinct from me.id
    order by c.created_at desc limit 1
  ) lc on true
  left join lateral (
    select v.at, v.by, v.kind from (values
      (case when t.last_activity_by is distinct from me.id then t.updated_at end, t.last_activity_by, t.last_activity_kind, 0),
      (lc.created_at, lc.author_id, 'comment', 1)
    ) v(at, by, kind, pri)
    where v.at is not null order by v.at desc, v.pri desc limit 1
  ) x on true
  left join public.profiles p on p.user_id = t.opened_by
  left join public.residents r on r.id = p.resident_id
  left join public.apartments a on a.id = r.apartment_id
  where me.id is not null;
$$;
revoke execute on function public.my_ticket_activity() from public, anon;
grant execute on function public.my_ticket_activity() to authenticated;

-- Marks the given calls (null = every call in my_ticket_activity) seen now, by the server clock.
create function public.mark_tickets_seen(p_ids uuid[] default null) returns void
language sql set search_path = ''
as $$
  insert into public.ticket_seen (ticket_id, user_id, seen_at)
  select a.ticket_id, auth.uid(), now() from public.my_ticket_activity() a
  where p_ids is null or a.ticket_id = any (p_ids)
  on conflict (ticket_id, user_id) do update set seen_at = excluded.seen_at;
$$;
revoke execute on function public.mark_tickets_seen(uuid[]) from public, anon;
grant execute on function public.mark_tickets_seen(uuid[]) to authenticated;

-- ---------------------------------------------------------------- Realtime publication
do $$
declare
  t text;
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;
  foreach t in array array['announcements', 'tickets', 'ticket_comments'] loop
    if not exists (
      select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end;
$$;
