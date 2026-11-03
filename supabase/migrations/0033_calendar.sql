-- 0033 calendar: the building's calendar ("לוח שנה של הבניין"): cleaning days, pest control, water / electricity
-- shutoffs, maintenance visits, meetings and anything else residents should plan around.
--   * calendar_events: one row per event. Timed events have starts_at (and an optional ends_at); all-day events store
--     the Israel midnight of their first day in starts_at and of their last day (inclusive) in ends_at.
--   * Recurrence is a simple rule read from starts_at in Israel time: 'weekly' (same weekday) or 'monthly' (same day
--     of the month, the month's last day when it is shorter), until recurrence_until (a date, inclusive) or forever.
--     Occurrences are expanded on the client; the server stores only the rule.
--   * Other events (meetings, and later polls / inspections) are computed on the client from their own tables, under
--     their own RLS. Nothing is copied here.
--   * Visibility (RLS): admins see and write everything. Approved users with the new 'calendar' permission (on for
--     the default group "דייר") read events with visibility 'residents'; 'committee' events are admin-only.

-- ---------------------------------------------------------------- permission
insert into public.permissions (key, label, description, sort_order) values
  ('calendar', 'לוח שנה', 'אירועים בבניין: ימי ניקיון, הדברה, הפסקות מים וחשמל, תחזוקה וישיבות', 13);
insert into public.group_permissions (group_id, permission)
select id, 'calendar' from public.user_groups where is_default
on conflict do nothing;

-- ---------------------------------------------------------------- table
create table public.calendar_events (
  id uuid primary key default gen_random_uuid(),
  building_id uuid not null default public.default_building_id() references public.buildings on delete cascade,
  title text not null check (char_length(trim(title)) between 1 and 200),
  description text not null default '' check (char_length(description) <= 5000),
  location text not null default '' check (char_length(location) <= 200),
  category text not null default 'other'
    check (category in ('cleaning', 'pest_control', 'shutoff', 'maintenance', 'meeting', 'other')),
  all_day boolean not null default false,
  starts_at timestamptz not null,
  ends_at timestamptz,
  recurrence text not null default 'none' check (recurrence in ('none', 'weekly', 'monthly')),
  recurrence_until date,
  visibility text not null default 'residents' check (visibility in ('residents', 'committee')),
  created_by uuid default auth.uid() references auth.users on delete set null,
  created_at timestamptz not null default now(),
  constraint calendar_events_ends_after check (ends_at is null or ends_at >= starts_at),
  constraint calendar_events_until check (
    recurrence_until is null
    or (recurrence <> 'none' and recurrence_until >= (starts_at at time zone 'Asia/Jerusalem')::date))
);
create index calendar_events_building_starts_idx on public.calendar_events (building_id, starts_at);
create index calendar_events_created_by_idx on public.calendar_events (created_by);

alter table public.calendar_events enable row level security;
-- Signed-in users only: anon gets no table privileges at all (RLS would return nothing anyway).
revoke all on public.calendar_events from anon;
create policy calendar_events_admin on public.calendar_events for all to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));
create policy calendar_events_select on public.calendar_events for select to authenticated
  using ((select public.has_permission('calendar')) and visibility = 'residents');
