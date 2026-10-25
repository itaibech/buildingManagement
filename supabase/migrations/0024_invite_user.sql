-- 0024: inviting users by email (Edge Function admin-invite-user).
--   * admin_audit accepts 'invite_user'.
--   * user_sign_in_status(): admins see who was invited and never signed in (auth.users is not readable by RLS).
--   * auth_user_by_email(): the function's existing-account check (service role only).

-- ---------------------------------------------------------------- admin_audit
alter table public.admin_audit drop constraint admin_audit_action_check;
alter table public.admin_audit add constraint admin_audit_action_check
  check (action in ('delete_user', 'archive_apartment', 'restore_apartment', 'delete_apartment', 'invite_user'));

-- ---------------------------------------------------------------- user_sign_in_status
-- One row per profile in the caller's building: when the login was invited and last signed in. Admins only.
create function public.user_sign_in_status()
returns table (user_id uuid, invited_at timestamptz, last_sign_in_at timestamptz)
language plpgsql stable security definer set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'Only admins can read sign-in status' using errcode = '42501';
  end if;
  return query
    select p.user_id, u.invited_at, u.last_sign_in_at
    from public.profiles p
    join auth.users u on u.id = p.user_id
    where p.building_id = (select me.building_id from public.profiles me where me.user_id = (select auth.uid()));
end;
$$;
revoke execute on function public.user_sign_in_status() from public, anon;
grant execute on function public.user_sign_in_status() to authenticated;

-- ---------------------------------------------------------------- auth_user_by_email
-- The login with this address (case-insensitive), if any. Server only: the Edge Function calls it with the service role.
create function public.auth_user_by_email(p_email text)
returns table (user_id uuid, invited_at timestamptz, last_sign_in_at timestamptz)
language sql stable security definer set search_path = ''
as $$
  select u.id, u.invited_at, u.last_sign_in_at from auth.users u where lower(u.email) = lower(trim(p_email)) limit 1;
$$;
revoke execute on function public.auth_user_by_email(text) from public, anon, authenticated;
grant execute on function public.auth_user_by_email(text) to service_role;
