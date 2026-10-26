-- 0025 text limits: caps on the free text non-admins can write.
--   * Sign-up is open, and a pending user may update their own full_name (0002). With no cap, one REST call stored
--     50 MB, so a few calls from a throwaway account could fill the free-tier database and hang the users page.
--   * Residents with the tickets permission write ticket titles, descriptions, locations and comments
--     (photo paths are already pinned to a fixed pattern by 0004).
-- not valid: existing rows aren't re-checked (a long legacy value can't block the deploy); every new write is.
-- The sign-up trigger trims the name to the cap instead of failing the sign-up.

alter table public.profiles
  add constraint profiles_full_name_length check (char_length(full_name) <= 200) not valid;
alter table public.tickets
  add constraint tickets_title_length check (char_length(title) <= 200) not valid,
  add constraint tickets_location_length check (char_length(location) <= 200) not valid,
  add constraint tickets_description_length check (char_length(description) <= 5000) not valid;
alter table public.ticket_comments
  add constraint ticket_comments_body_length check (char_length(body) <= 5000) not valid;

-- Same as 0012, with the metadata name cut to 200 characters.
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  is_bootstrap boolean;
begin
  -- One-shot: the bootstrap email only grants admin while no admin exists yet, and only via Google.
  select coalesce(new.raw_app_meta_data ->> 'provider', '') = 'google'
  and exists (
    select 1 from public.app_settings
    where key = 'bootstrap_admin_email' and lower(trim(value)) = lower(trim(new.email))
  ) and not exists (
    select 1 from public.profiles where role = 'admin'
  ) into is_bootstrap;

  insert into public.profiles (user_id, building_id, full_name, email, role, status, is_super_admin)
  values (
    new.id,
    public.default_building_id(),
    left(coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name', ''), 200),
    new.email,
    case when is_bootstrap then 'admin' else 'resident' end,
    case when is_bootstrap then 'approved' else 'pending' end,
    is_bootstrap
  );
  return new;
end;
$$;
revoke execute on function public.handle_new_user() from public, anon, authenticated;
