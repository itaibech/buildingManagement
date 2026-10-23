-- Repo-wide security invariants (pgTAP). Catches regressions from any later migration.
begin;
create extension if not exists pgtap with schema extensions;

select plan(10);

-- ---------------------------------------------------------------- functions
select is(
  (select array_agg(p.proname::text order by p.proname) from pg_proc p
    where p.pronamespace = 'public'::regnamespace and has_function_privilege('anon', p.oid, 'execute')),
  null, 'anon can execute no function in public'
);
select is(
  (select array_agg(p.proname::text order by p.proname) from pg_proc p
    where p.pronamespace = 'public'::regnamespace and p.prosecdef
      and not coalesce('search_path=""' = any (p.proconfig), false)),
  null, 'every SECURITY DEFINER function in public pins search_path to empty'
);
select is(
  (select array_agg(p.proname::text order by p.proname) from pg_proc p
    where p.pronamespace = 'public'::regnamespace and p.prorettype = 'trigger'::regtype
      and has_function_privilege('authenticated', p.oid, 'execute')),
  null, 'trigger functions are not callable by API roles'
);
-- A function a later migration creates (as postgres) isn't executable by anon unless granted explicitly.
create function public.hardening_probe() returns int language sql as 'select 1';
select ok(not has_function_privilege('anon', 'public.hardening_probe()', 'execute'),
  'new functions default to no anon execute');
select ok(has_function_privilege('authenticated', 'public.is_admin()', 'execute'), 'authenticated keeps is_admin()');
select ok(has_function_privilege('authenticated', 'public.is_approved()', 'execute'), 'authenticated keeps is_approved()');
select ok(has_function_privilege('authenticated', 'public.my_apartment_id()', 'execute'), 'authenticated keeps my_apartment_id()');

-- ---------------------------------------------------------------- tables, views, storage
select is(
  (select array_agg(c.relname::text) from pg_class c
    where c.relnamespace = 'public'::regnamespace and c.relkind = 'r' and not c.relrowsecurity),
  null, 'RLS is enabled on every table in public'
);
select is(
  (select array_agg(c.relname::text) from pg_class c
    where c.relnamespace = 'public'::regnamespace and c.relkind = 'v'
      and not coalesce('security_invoker=true' = any (c.reloptions), false)),
  null, 'every view in public is security_invoker'
);
select is(
  (select array_agg(id) from storage.buckets where public), null, 'no storage bucket is public'
);

select * from finish();
rollback;
