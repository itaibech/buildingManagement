-- 0029 committee messages: residents write to the committee ("פנייה לוועד"), and the committee hears about new tickets.
--   * Permission 'contact_committee' (on for the default "דייר" group): send a message to the whole committee or to
--     one committee member (an approved admin of the building).
--   * committee_messages: every message, stored by the send-email Edge Function (service role) before it emails the
--     committee, so a message survives a dry run or a full daily quota. RLS: the sender reads their own; an admin
--     reads the ones sent to the whole committee (recipient_id null) or to them. No API writes at all: no insert,
--     update or delete for anon / authenticated. The sender's name, email and apartment are a snapshot at send time.
--   * committee_members(): the approved admins of the caller's building by name (the dialog's recipient list), for
--     users with contact_committee. Names only, never emails.
--   * email_log.kind gains 'ticket_new' (a resident's new ticket → the committee) and 'contact' (a message). A ticket
--     is announced once: a partial unique index on email_log (ref_id) for 'ticket_new' backs the function's check.
--   * committee_messages joins the supabase_realtime publication (the admins' in-app notice); Realtime applies the
--     select policy per subscriber.

-- ---------------------------------------------------------------- permission
insert into public.permissions (key, label, description, sort_order) values
  ('contact_committee', 'פנייה לוועד', 'שליחת פנייה לכל חברי הוועד או לחבר ועד מסוים', 9);
insert into public.group_permissions (group_id, permission)
select id, 'contact_committee' from public.user_groups where is_default
on conflict do nothing;

-- ---------------------------------------------------------------- email kinds
alter table public.email_log drop constraint email_log_kind_check;
alter table public.email_log add constraint email_log_kind_check
  check (kind in ('announcement', 'ticket', 'debt', 'test', 'meeting', 'ticket_new', 'contact'));
create unique index email_log_ticket_new_once on public.email_log (ref_id) where kind = 'ticket_new';
create index email_log_sent_by_kind_idx on public.email_log (sent_by, kind, created_at desc);

-- ---------------------------------------------------------------- committee_messages
create table public.committee_messages (
  id uuid primary key default gen_random_uuid(),
  building_id uuid not null references public.buildings on delete cascade,
  sender_id uuid references auth.users on delete set null,
  -- null = the whole committee. A message to one member goes with that member's account.
  recipient_id uuid references auth.users on delete cascade,
  sender_name text not null default '' check (char_length(sender_name) <= 200),
  sender_email text check (char_length(sender_email) <= 320),
  apartment_number int,
  subject text not null check (char_length(trim(subject)) between 1 and 150),
  body text not null check (char_length(trim(body)) between 1 and 3000),
  created_at timestamptz not null default now()
);
create index committee_messages_building_created_idx on public.committee_messages (building_id, created_at desc);
create index committee_messages_sender_idx on public.committee_messages (sender_id, created_at desc);
create index committee_messages_recipient_idx on public.committee_messages (recipient_id);

alter table public.committee_messages enable row level security;
revoke all on public.committee_messages from anon, authenticated, public;
grant select on public.committee_messages to authenticated;
create policy committee_messages_select on public.committee_messages for select to authenticated
  using (
    sender_id = (select auth.uid())
    or ((select public.is_admin())
      and building_id = (select p.building_id from public.profiles p where p.user_id = (select auth.uid()))
      and (recipient_id is null or recipient_id = (select auth.uid())))
  );

-- ---------------------------------------------------------------- committee_members()
create function public.committee_members() returns table (user_id uuid, full_name text)
language sql stable security definer set search_path = ''
as $$
  select p.user_id, p.full_name from public.profiles p
  where public.has_permission('contact_committee') and p.role = 'admin' and p.status = 'approved'
    and p.building_id = (select me.building_id from public.profiles me where me.user_id = (select auth.uid()))
  order by p.full_name, p.user_id;
$$;
revoke execute on function public.committee_members() from public, anon;
grant execute on function public.committee_members() to authenticated;

-- ---------------------------------------------------------------- Realtime publication
do $$
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;
  if not exists (
    select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'committee_messages'
  ) then
    alter publication supabase_realtime add table public.committee_messages;
  end if;
end;
$$;
