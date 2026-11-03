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
--   * Rate limits (API callers): at most 5 posts and 30 comments per user in any 24 hours. Each insert takes a per-user
--     advisory lock before counting (community_check_quota), so parallel requests can't pass the limit. Tokens: 'community:post_limit' and
--     'community:comment_limit' (P0001).
--   * community_authors(ids): names for the board, plus the apartment number only when the caller may read the
--     directory (the directory permission is the existing privacy rule for who lives where).
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
  title text not null check (char_length(trim(title)) between 1 and 120),
  body text not null default '' check (char_length(body) <= 2000),
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
  body text not null check (char_length(trim(body)) between 1 and 1000),
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

-- ---------------------------------------------------------------- guards (API callers only; server roles pass)
-- The daily quota: one caller at a time (advisory lock), then a count of their rows in the last 24 hours. SECURITY
-- DEFINER so the count also sees their rows on posts that are now hidden or expired.
create function public.community_check_quota(p_kind text) returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_me constant uuid := (select auth.uid());
begin
  perform pg_advisory_xact_lock(hashtextextended('community_' || p_kind || ':' || coalesce(v_me::text, ''), 0));
  if p_kind = 'post' and (select count(*) from public.community_posts
      where author_id = v_me and created_at > now() - interval '24 hours') >= 5 then
    raise exception 'community:post_limit' using errcode = 'P0001';
  end if;
  if p_kind = 'comment' and (select count(*) from public.community_comments
      where author_id = v_me and created_at > now() - interval '24 hours') >= 30 then
    raise exception 'community:comment_limit' using errcode = 'P0001';
  end if;
end;
$$;
revoke execute on function public.community_check_quota(text) from public, anon;
grant execute on function public.community_check_quota(text) to authenticated;

-- Posts: the server sets author, dates and moderation fields. An author may change category, title, body, photo and
-- status; touching expires_at renews the post for 30 days from now. Security invoker, like tickets_guard: inside
-- community_moderate() (SECURITY DEFINER) current_user is the owner, so moderation passes.
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
    perform public.community_check_quota('post');
    new.created_at := now();
    new.updated_at := now();
    new.expires_at := now() + interval '30 days';
    new.hidden_at := null;
    new.hidden_by := null;
    new.hidden_reason := null;
    return new;
  end if;
  if (to_jsonb(new) - v_own) is distinct from (to_jsonb(old) - v_own) then
    raise exception 'Only the category, title, body, photo and status of a post can be changed' using errcode = '42501';
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

-- Comments: post_author_id comes from the post on insert (every role). API callers: server-set date and moderation
-- fields, only the body may change, and at most 30 comments in 24 hours.
create function public.community_comments_guard() returns trigger
language plpgsql set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    new.post_author_id := (select p.author_id from public.community_posts p where p.id = new.post_id);
  end if;
  if current_user not in ('authenticated', 'anon') then
    return new;
  end if;
  if tg_op = 'UPDATE' then
    if (to_jsonb(new) - 'body') is distinct from (to_jsonb(old) - 'body') then
      raise exception 'Only the text of a comment can be changed' using errcode = '42501';
    end if;
    return new;
  end if;
  perform public.community_check_quota('comment');
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
-- Names of approved users for the board; the apartment number only for callers who may read the directory.
create function public.community_authors(ids uuid[]) returns table (user_id uuid, full_name text, apartment_number int)
language sql stable security definer set search_path = ''
as $$
  select p.user_id, p.full_name, case when public.has_permission('directory') then a.number end
  from public.profiles p
  left join public.residents r on r.id = p.resident_id
  left join public.apartments a on a.id = r.apartment_id
  where public.has_permission('community') and p.status = 'approved' and p.user_id = any (ids)
    and p.building_id = (select me.building_id from public.profiles me where me.user_id = (select auth.uid()));
$$;
revoke execute on function public.community_authors(uuid[]) from public, anon;
grant execute on function public.community_authors(uuid[]) to authenticated;

-- ---------------------------------------------------------------- storage
-- True when the caller has the permission and wrote the post (the photo is added right after the post is created).
create function public.can_manage_community_post(p_post_id uuid) returns boolean
language sql stable security definer set search_path = ''
as $$
  select public.has_permission('community') and exists (
    select 1 from public.community_posts where id = p_post_id and author_id = (select auth.uid())
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
