-- 0003 announcements: building notices (admin-authored) and per-user read receipts.

create table public.announcements (
  id uuid primary key default gen_random_uuid(),
  building_id uuid not null default public.default_building_id() references public.buildings on delete cascade,
  title text not null check (length(trim(title)) > 0),
  body text not null default '',
  pinned boolean not null default false,
  expires_at date,
  author_id uuid default auth.uid() references auth.users on delete set null,
  created_at timestamptz not null default now()
);
create index announcements_author_id_idx on public.announcements (author_id);
create index announcements_building_id_idx on public.announcements (building_id);

create table public.announcement_reads (
  announcement_id uuid not null references public.announcements on delete cascade,
  user_id uuid not null references auth.users on delete cascade,
  building_id uuid not null default public.default_building_id() references public.buildings on delete cascade,
  created_at timestamptz not null default now(),
  primary key (announcement_id, user_id)
);
create index announcement_reads_user_id_idx on public.announcement_reads (user_id);
create index announcement_reads_building_id_idx on public.announcement_reads (building_id);

alter table public.announcements enable row level security;
alter table public.announcement_reads enable row level security;

create policy announcements_select on public.announcements
  for select to authenticated using (public.is_approved());
create policy announcements_admin on public.announcements
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

create policy announcement_reads_select on public.announcement_reads
  for select to authenticated using (user_id = (select auth.uid()));
create policy announcement_reads_insert on public.announcement_reads
  for insert to authenticated
  with check (user_id = (select auth.uid()) and public.is_approved());
