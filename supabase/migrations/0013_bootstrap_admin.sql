-- 0013 bootstrap admin: the production super-admin email, so no manual SQL is needed after the first deploy.
-- The address is public by the owner's choice (spec §4, README). The grant still needs a Google sign-in (0012).
-- `do nothing`: an environment that already set the key keeps it; the local seed overrides it afterwards.
insert into public.app_settings (key, value)
values ('bootstrap_admin_email', 'itai.bechor@gmail.com')
on conflict (key) do nothing;
