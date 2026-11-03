-- 0036 community board ("לוח קהילה"): residents' neighbourly posts (lost and found, recommended tradespeople, give away /
-- lend, requests for help) with comments and one optional photo.
--   * Permission 'community' (on for the default "דייר" group). Every read and write below asks for it.
--   * community_posts: the author edits their own (category, title, body, photo, status active/resolved) and deletes it.
--     A post expires 30 days after it was created or last renewed: others no longer see it, the author still does and
--     may renew it (expires_at is set by the server: any change to it means "now + 30 days").
--   * community_comments: approved users with the permission comment on posts they can see. The author edits or deletes
--     their own. post_author_id is copied from the post by trigger, so the in-app notice ("a comment on your post")
--     can be decided from the Realtime payload alone.
--   * Moderation: admins hide, unhide or delete any post or comment through community_moderate(), always with a reason.
--     A hidden item stays visible to its author (with the reason) and to admins only. A deleted item leaves a
--     community_removals row (title snapshot + reason) that only its author reads and dismisses.
--   * Text: title, body and comments may not be only whitespace / zero-width characters (body may be empty).
--   * building_id is never the caller's choice: a post takes the author's building, a comment its post's.
--   * Rate limits (API callers): at most 5 posts and 30 comments per user in any 24 hours, counted from the append-only
--     community_quota_events log (no user grants), so deleting a post or comment never gives room back. Each insert
--     takes a per-user advisory lock, counts and logs (community_*_stamp triggers), so parallel requests can't pass the
--     limit. Tokens: 'community:post_limit' and 'community:comment_limit' (P0001).
--   * A hidden post can't be edited by its author (deleting it stays possible). One photo per post: the upload needs
--     an empty folder and a post without a photo, and photo_path is set once, to an object that exists.
--   * community_authors(ids): names of authors of posts / comments the caller can see, plus the apartment number only
--     when the caller may read the directory (the directory permission is the existing privacy rule for who lives where).
--   * Storage: private bucket 'community-photos', images only, 5 MB. Paths <post_id>/<uuid>.<ext>; the post's author
--     uploads; anyone who can see the post reads (the posts RLS decides, so hidden and expired posts' photos stay
--     private); the uploader or an admin deletes.
--   * community_comments joins the supabase_realtime publication; Realtime applies the select policy per subscriber.

-- ---------------------------------------------------------------- permission
insert into public.permissions (key, label, description, sort_order) values
  ('community', 'לוח קהילה', 'פרסום ותגובה בלוח הקהילה: אבדות ומציאות, המלצות, מסירה והשאלה ובקשות עזרה', 14);
insert into public.group_permissions (group_id, permission)
select id, 'community' from public.user_groups where is_default
on conflict do nothing;

-- ---------------------------------------------------------------- tables
create table public.community_posts (
  id uuid primary key default gen_random_uuid(),
  building_id uuid not null default public.default_building_id() references public.buildings on delete cascade,
  author_id uuid default auth.uid() references auth.users on delete set null,
  category text not null default 'general'
    check (category in ('lost_found', 'pros', 'giveaway', 'help', 'general')),
  title text not null check (char_length(title) <= 120 and regexp_replace(title, '[\s\u00a0\u200b-\u200d\u2060\ufeff]', '', 'g') <> ''),
  body text not null default '' check (char_length(body) <= 2000 and (body = '' or regexp_replace(body, '[\s\u00a0\u200b-\u200d\u2060\ufeff]', '', 'g') <> '')),
  photo_path text check (photo_path ~ ('^' || id::text || '/[0-9a-f-]{36}\.(jpg|jpeg|png|webp|heic|heif|gif)$')),
  status text not null default 'active' check (status in ('active', 'resolved')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '30 days',
  hidden_at timestamptz,
  hidden_by uuid references auth.users on delete set null,
  hidden_reason text check (char_length(hidden_reason) <= 300),
  constraint community_posts_hidden_reason check ((hidden_at is null) = (hidden_reason is null))
);
create index community_posts_building_created_idx on public.community_posts (building_id, created_at desc);
create index community_posts_author_created_idx on public.community_posts (author_id, created_at desc);
create index community_posts_hidden_by_idx on public.community_posts (hidden_by);

create table public.community_comments (
  id uuid primary key default gen_random_uuid(),
  building_id uuid not null default public.default_building_id() references public.buildings on delete cascade,
  post_id uuid not null references public.community_posts on delete cascade,
  author_id uuid default auth.uid() references auth.users on delete set null,
  post_author_id uuid references auth.users on delete set null,
  body text not null check (char_length(body) <= 1000 and regexp_replace(body, '[\s\u00a0\u200b-\u200d\u2060\ufeff]', '', 'g') <> ''),
  created_at timestamptz not null default now(),
  hidden_at timestamptz,
  hidden_by uuid references auth.users on delete set null,
  hidden_reason text check (char_length(hidden_reason) <= 300),
  constraint community_comments_hidden_reason check ((hidden_at is null) = (hidden_reason is null))
);
create index community_comments_post_created_idx on public.community_comments (post_id, created_at);
create index community_comments_author_created_idx on public.community_comments (author_id, created_at desc);
create index community_comments_post_author_idx on public.community_comments (post_author_id);
create index community_comments_building_idx on public.community_comments (building_id);
create index community_comments_hidden_by_idx on public.community_comments (hidden_by);

create table public.community_removals (
  id uuid primary key default gen_random_uuid(),
  building_id uuid not null references public.buildings on delete cascade,
  user_id uuid not null references auth.users on delete cascade,
  kind text not null check (kind in ('post', 'comment')),
  title text not null,
  reason text not null check (char_length(trim(reason)) between 1 and 300),
  created_at timestamptz not null default now()
);
create index community_removals_user_idx on public.community_removals (user_id, created_at desc);
create index community_removals_building_idx on public.community_removals (building_id);

-- ---------------------------------------------------------------- quota log
-- One row per post or comment an API user created; never updated or deleted by users (no grants, RLS without
-- policies), so the daily limits hold even after the rows themselves are deleted.
create table public.community_quota_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  kind text not null check (kind in ('post', 'comment')),
  created_at timestamptz not null default now()
);
create index community_quota_events_user_idx on public.community_quota_events (user_id, kind, created_at desc);
alter table public.community_quota_events enable row level security;
revoke all on public.community_quota_events from public, anon, authenticated;

-- The daily quota: one caller at a time (advisory lock), count their log rows in the last 24 hours, then log this one.
-- A refused or rolled-back insert leaves no log row (same transaction). Only the stamp triggers call it.
create function public.community_check_quota(p_kind text) returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_me constant uuid := (select auth.uid());
  v_limit constant int := case p_kind when 'post' then 5 else 30 end;
begin
  perform pg_advisory_xact_lock(hashtextextended('community_' || p_kind || ':' || coalesce(v_me::text, ''), 0));
  if (select count(*) from public.community_quota_events
      where user_id = v_me and kind = p_kind and created_at > now() - interval '24 hours') >= v_limit then
    raise exception 'community:%_limit', p_kind using errcode = 'P0001';
  end if;
  insert into public.community_quota_events (user_id, kind) values (v_me, p_kind);
end;
$$;
revoke execute on function public.community_check_quota(text) from public, anon, authenticated;

-- Server-set fields that need rows the caller may not read (SECURITY DEFINER; trigger functions need no EXECUTE grant).
-- The API role comes from the role setting, which a SECURITY DEFINER function doesn't change.
create function public.community_posts_stamp() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if current_setting('role', true) in ('authenticated', 'anon') then
    perform public.community_check_quota('post');
    new.building_id := (select p.building_id from public.profiles p where p.user_id = (select auth.uid()));
  end if;
  return new;
end;
$$;
revoke execute on function public.community_posts_stamp() from public, anon, authenticated;
create trigger community_posts_stamp
  before insert on public.community_posts
  for each row execute function public.community_posts_stamp();

-- Comments: the post's author (for the notice) and building, for every role; the quota for API callers.
create function public.community_comments_stamp() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  select p.author_id, p.building_id into new.post_author_id, new.building_id
  from public.community_posts p where p.id = new.post_id;
  if current_setting('role', true) in ('authenticated', 'anon') then
    perform public.community_check_quota('comment');
  end if;
  return new;
end;
$$;
revoke execute on function public.community_comments_stamp() from public, anon, authenticated;
create trigger community_comments_stamp
  before insert on public.community_comments
  for each row execute function public.community_comments_stamp();

-- ---------------------------------------------------------------- guards (API callers only; server roles pass)
-- Posts: the server sets author, dates, status and moderation fields on insert. An author may change category, title,
-- body and status while the post isn't hidden; touching expires_at renews it for 30 days from now; photo_path is set
-- once, to an object already uploaded. Security invoker, like tickets_guard: inside community_moderate() (SECURITY
-- DEFINER) current_user is the owner, so moderation passes.
create function public.community_posts_guard() returns trigger
language plpgsql set search_path = ''
as $$
declare
  v_own constant text[] := array['category', 'title', 'body', 'photo_path', 'status', 'expires_at', 'updated_at'];
begin
  if current_user not in ('authenticated', 'anon') then
    return new;
  end if;
  if tg_op = 'INSERT' then
    new.created_at := now();
    new.updated_at := now();
    new.expires_at := now() + interval '30 days';
    new.status := 'active';
    new.hidden_at := null;
    new.hidden_by := null;
    new.hidden_reason := null;
    return new;
  end if;
  if old.hidden_at is not null then
    raise exception 'A hidden post cannot be edited' using errcode = '42501';
  end if;
  if (to_jsonb(new) - v_own) is distinct from (to_jsonb(old) - v_own) then
    raise exception 'Only the category, title, body, photo and status of a post can be changed' using errcode = '42501';
  end if;
  if new.photo_path is distinct from old.photo_path and (old.photo_path is not null or not exists (
      select 1 from storage.objects o where o.bucket_id = 'community-photos' and o.name = new.photo_path)) then
    raise exception 'The photo is set once, to an uploaded file' using errcode = '42501';
  end if;
  if new.expires_at is distinct from old.expires_at then
    new.expires_at := now() + interval '30 days';
  end if;
  new.updated_at := now();
  return new;
end;
$$;
revoke execute on function public.community_posts_guard() from public, anon, authenticated;
create trigger community_posts_guard
  before insert or update on public.community_posts
  for each row execute function public.community_posts_guard();

-- Comments: API callers get server-set date and moderation fields, and may change only the body.
create function public.community_comments_guard() returns trigger
language plpgsql set search_path = ''
as $$
begin
  if current_user not in ('authenticated', 'anon') then
    return new;
  end if;
  if tg_op = 'UPDATE' then
    if (to_jsonb(new) - 'body') is distinct from (to_jsonb(old) - 'body') then
      raise exception 'Only the text of a comment can be changed' using errcode = '42501';
    end if;
    return new;
  end if;
  new.created_at := now();
  new.hidden_at := null;
  new.hidden_by := null;
  new.hidden_reason := null;
  return new;
end;
$$;
revoke execute on function public.community_comments_guard() from public, anon, authenticated;
create trigger community_comments_guard
  before insert or update on public.community_comments
  for each row execute function public.community_comments_guard();

-- ---------------------------------------------------------------- RLS
alter table public.community_posts enable row level security;
alter table public.community_comments enable row level security;
alter table public.community_removals enable row level security;
revoke all on public.community_posts, public.community_comments, public.community_removals from anon;

-- Others see a post while it is neither hidden nor expired; the author and admins always do.
create policy community_posts_select on public.community_posts for select to authenticated
  using ((select public.has_permission('community'))
    and (author_id = (select auth.uid()) or (select public.is_admin()) or (hidden_at is null and expires_at > now())));
create policy community_posts_insert on public.community_posts for insert to authenticated
  with check ((select public.has_permission('community')) and author_id = (select auth.uid()) and photo_path is null);
create policy community_posts_update_own on public.community_posts for update to authenticated
  using (author_id = (select auth.uid()) and (select public.has_permission('community')))
  with check (author_id = (select auth.uid()));
create policy community_posts_delete_own on public.community_posts for delete to authenticated
  using (author_id = (select auth.uid()) and (select public.has_permission('community')));

-- A comment is visible with its post (the subquery goes through the posts policy); a hidden one only to its author
-- and admins. New comments only on a post the caller can see that isn't hidden.
create policy community_comments_select on public.community_comments for select to authenticated
  using ((select public.has_permission('community'))
    and exists (select 1 from public.community_posts p where p.id = post_id)
    and (hidden_at is null or author_id = (select auth.uid()) or (select public.is_admin())));
create policy community_comments_insert on public.community_comments for insert to authenticated
  with check ((select public.has_permission('community')) and author_id = (select auth.uid())
    and exists (select 1 from public.community_posts p where p.id = post_id and p.hidden_at is null));
create policy community_comments_update_own on public.community_comments for update to authenticated
  using (author_id = (select auth.uid()) and (select public.has_permission('community')))
  with check (author_id = (select auth.uid()));
create policy community_comments_delete_own on public.community_comments for delete to authenticated
  using (author_id = (select auth.uid()) and (select public.has_permission('community')));

-- Removal notices: the author reads and dismisses their own; rows are written only by community_moderate().
revoke insert, update on public.community_removals from anon, authenticated;
create policy community_removals_select on public.community_removals for select to authenticated
  using (user_id = (select auth.uid()));
create policy community_removals_delete on public.community_removals for delete to authenticated
  using (user_id = (select auth.uid()));

-- ---------------------------------------------------------------- community_moderate()
-- Admin: p_action 'hide' | 'unhide' | 'delete' on a post or comment of their building. Hide and delete need a reason
-- (1-300 characters). Deleting someone else's item leaves them a community_removals notice.
create function public.community_moderate(p_kind text, p_id uuid, p_action text, p_reason text default null) returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_reason constant text := nullif(trim(coalesce(p_reason, '')), '');
  v_building constant uuid := (select p.building_id from public.profiles p where p.user_id = (select auth.uid()));
  v_author uuid;
  v_title text;
begin
  if not public.is_admin() then
    raise exception 'admin only' using errcode = '42501';
  end if;
  if p_kind not in ('post', 'comment') or p_action not in ('hide', 'unhide', 'delete') then
    raise exception 'unknown kind or action' using errcode = '22023';
  end if;
  if p_action <> 'unhide' and (v_reason is null or char_length(v_reason) > 300) then
    raise exception 'community:reason_required' using errcode = '22023';
  end if;
  if p_kind = 'post' then
    select p.author_id, p.title into v_author, v_title from public.community_posts p
    where p.id = p_id and p.building_id = v_building;
  else
    select c.author_id, p.title into v_author, v_title from public.community_comments c
    join public.community_posts p on p.id = c.post_id
    where c.id = p_id and c.building_id = v_building;
  end if;
  if not found then
    raise exception 'not found' using errcode = 'P0002';
  end if;
  if p_action = 'delete' then
    if v_author is not null and v_author <> (select auth.uid()) then
      insert into public.community_removals (building_id, user_id, kind, title, reason)
      values (v_building, v_author, p_kind, v_title, v_reason);
    end if;
    if p_kind = 'post' then
      delete from public.community_posts where id = p_id;
    else
      delete from public.community_comments where id = p_id;
    end if;
  elsif p_kind = 'post' then
    update public.community_posts set hidden_at = case when p_action = 'hide' then now() end,
      hidden_by = case when p_action = 'hide' then (select auth.uid()) end,
      hidden_reason = case when p_action = 'hide' then v_reason end
    where id = p_id;
  else
    update public.community_comments set hidden_at = case when p_action = 'hide' then now() end,
      hidden_by = case when p_action = 'hide' then (select auth.uid()) end,
      hidden_reason = case when p_action = 'hide' then v_reason end
    where id = p_id;
  end if;
end;
$$;
revoke execute on function public.community_moderate(text, uuid, text, text) from public, anon;
grant execute on function public.community_moderate(text, uuid, text, text) to authenticated;

-- ---------------------------------------------------------------- community_authors()
-- Names of the approved authors of posts and comments the caller can see (the same rules as the select policies);
-- the apartment number only for callers who may read the directory.
create function public.community_authors(ids uuid[]) returns table (user_id uuid, full_name text, apartment_number int)
language sql stable security definer set search_path = ''
as $$
  with me as (select (select auth.uid()) as id, public.is_admin() as admin),
  visible_posts as (
    select p.id, p.author_id from public.community_posts p, me
    where p.author_id = me.id or me.admin or (p.hidden_at is null and p.expires_at > now())
  ),
  visible_authors as (
    select v.author_id from visible_posts v
    union
    select c.author_id from public.community_comments c join visible_posts v on v.id = c.post_id, me
    where c.hidden_at is null or c.author_id = me.id or me.admin
  )
  select p.user_id, p.full_name, case when public.has_permission('directory') then a.number end
  from public.profiles p
  left join public.residents r on r.id = p.resident_id
  left join public.apartments a on a.id = r.apartment_id
  where public.has_permission('community') and p.status = 'approved' and p.user_id = any (ids)
    and p.user_id in (select va.author_id from visible_authors va)
    and p.building_id = (select pr.building_id from public.profiles pr where pr.user_id = (select auth.uid()));
$$;
revoke execute on function public.community_authors(uuid[]) from public, anon;
grant execute on function public.community_authors(uuid[]) to authenticated;

-- ---------------------------------------------------------------- storage
-- True when the caller has the permission, wrote the post, and the post has no photo yet (no photo_path and nothing in
-- its folder): one photo per post, added right after the post is created.
create function public.can_manage_community_post(p_post_id uuid) returns boolean
language sql stable security definer set search_path = ''
as $$
  select public.has_permission('community') and exists (
    select 1 from public.community_posts
    where id = p_post_id and author_id = (select auth.uid()) and photo_path is null
  ) and not exists (
    select 1 from storage.objects o where o.bucket_id = 'community-photos' and o.name like p_post_id::text || '/%'
  );
$$;
revoke execute on function public.can_manage_community_post(uuid) from anon, public;
grant execute on function public.can_manage_community_post(uuid) to authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('community-photos', 'community-photos', false, 5242880,
  array['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/heic', 'image/heif'])
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create policy community_photos_storage_read on storage.objects for select to authenticated
  using (bucket_id = 'community-photos' and (select public.has_permission('community'))
    and exists (select 1 from public.community_posts p where p.id::text = split_part(name, '/', 1)));
create policy community_photos_storage_upload on storage.objects for insert to authenticated
  with check (
    bucket_id = 'community-photos'
    and name ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f-]{36}\.(jpg|jpeg|png|webp|heic|heif|gif)$'
    and public.can_manage_community_post(case
      when name ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/' then split_part(name, '/', 1)::uuid
    end)
  );
create policy community_photos_storage_delete on storage.objects for delete to authenticated
  using (bucket_id = 'community-photos' and (owner_id = (select auth.uid())::text or (select public.is_admin())));

-- ---------------------------------------------------------------- Realtime publication
do $$
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;
  if not exists (
    select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'community_comments'
  ) then
    alter publication supabase_realtime add table public.community_comments;
  end if;
end;
$$;
