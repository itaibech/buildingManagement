-- 0011 hardening (Task 12 security pass).
-- * The role helpers and trigger functions kept PostgreSQL's default EXECUTE for PUBLIC/anon, so anon could
--   call is_admin()/is_approved()/my_apartment_id() over /rest/v1/rpc. Harmless (they answer false/null for
--   anon) but needless surface: every RLS policy is `to authenticated`, so anon never needs them.
-- * Trigger functions are never called directly (firing a trigger doesn't check EXECUTE), so no API role
--   gets them.
-- * Default privileges: functions created by later migrations start with no PUBLIC/anon EXECUTE; each one
--   grants authenticated explicitly, as every RPC here already does.

revoke execute on function public.is_admin() from public, anon;
revoke execute on function public.is_approved() from public, anon;
revoke execute on function public.my_apartment_id() from public, anon;
grant execute on function public.is_admin() to authenticated;
grant execute on function public.is_approved() to authenticated;
grant execute on function public.my_apartment_id() to authenticated;

revoke execute on function public.handle_new_user() from public, anon, authenticated;
revoke execute on function public.profiles_guard() from public, anon, authenticated;
revoke execute on function public.profiles_delete_guard() from public, anon, authenticated;
revoke execute on function public.tickets_guard() from public, anon, authenticated;

-- PUBLIC's built-in EXECUTE can only be removed by a global (not per-schema) default; anon's grant is per-schema.
alter default privileges for role postgres revoke execute on functions from public;
alter default privileges for role postgres in schema public revoke execute on functions from anon;
