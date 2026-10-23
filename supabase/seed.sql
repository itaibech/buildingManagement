-- LOCAL DEVELOPMENT SEED ONLY (applied by `npm run db:reset`; never pushed to the hosted project).
-- All names, phones and emails are invented. The building row comes from the migration.
-- Test accounts (password `password123`): admin@example.test, resident@example.test,
-- pending@example.test (left pending so the users page has someone to approve).

-- Bootstrap admin for the local stack. Must exist before the auth users are inserted,
-- because the on_auth_user_created trigger reads it.
insert into public.app_settings (key, value)
values ('bootstrap_admin_email', 'admin@example.test')
on conflict (key) do update set value = excluded.value;

insert into public.apartments (id, building_id, number, floor)
select v.id::uuid, b.id, v.number, v.floor
from public.buildings b,
  (values
    ('10000000-0000-0000-0000-000000000001', 1, 1),
    ('10000000-0000-0000-0000-000000000002', 2, 1),
    ('10000000-0000-0000-0000-000000000003', 3, 2),
    ('10000000-0000-0000-0000-000000000004', 4, 2),
    ('10000000-0000-0000-0000-000000000005', 5, 3),
    ('10000000-0000-0000-0000-000000000006', 6, 3)
  ) as v(id, number, floor);

insert into public.residents (id, building_id, apartment_id, full_name, phone, email, is_owner)
select v.id::uuid, b.id, v.apartment_id::uuid, v.full_name, v.phone, v.email, v.is_owner
from public.buildings b,
  (values
    ('20000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001',
      'דנה בדיקה', '050-0000001', 'resident@example.test', true),
    ('20000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000002',
      'יוסי לדוגמה', '050-0000002', null, true),
    ('20000000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-000000000003',
      'מיכל ניסיון', '050-0000003', null, true),
    ('20000000-0000-0000-0000-000000000004', '10000000-0000-0000-0000-000000000003',
      'אבי שוכר', '050-0000004', null, false),
    ('20000000-0000-0000-0000-000000000005', '10000000-0000-0000-0000-000000000004',
      'רונית דמה', '050-0000005', null, true),
    ('20000000-0000-0000-0000-000000000006', '10000000-0000-0000-0000-000000000005',
      'עמית פיקטיבי', '050-0000006', null, true)
  ) as v(id, apartment_id, full_name, phone, email, is_owner);

-- Local auth users (standard Supabase local-seed pattern). The trigger creates their profiles.
insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, email_change, email_change_token_new, recovery_token
)
select '00000000-0000-0000-0000-000000000000', v.id::uuid, 'authenticated', 'authenticated',
  v.email, extensions.crypt('password123', extensions.gen_salt('bf')), now(),
  '{"provider":"email","providers":["email"]}', jsonb_build_object('full_name', v.full_name),
  now(), now(), '', '', '', ''
from (values
  ('30000000-0000-0000-0000-000000000001', 'admin@example.test', 'מנהל ועד'),
  ('30000000-0000-0000-0000-000000000002', 'resident@example.test', 'דנה בדיקה'),
  ('30000000-0000-0000-0000-000000000003', 'pending@example.test', 'נועם ממתין')
) as v(id, email, full_name);

insert into auth.identities (
  id, user_id, provider_id, provider, identity_data, last_sign_in_at, created_at, updated_at
)
select gen_random_uuid(), u.id, u.id::text, 'email',
  jsonb_build_object('sub', u.id::text, 'email', u.email, 'email_verified', true),
  now(), now(), now()
from auth.users u
where u.email in ('admin@example.test', 'resident@example.test', 'pending@example.test');

-- Approve the resident and link them to apartment 1.
update public.profiles
set status = 'approved', resident_id = '20000000-0000-0000-0000-000000000001'
where email = 'resident@example.test';

-- Sample announcements: one pinned, one regular, one already expired (admins see it under "שפג תוקפן").
insert into public.announcements (title, body, pinned, expires_at, author_id, created_at)
select v.title, v.body, v.pinned, v.expires_at, '30000000-0000-0000-0000-000000000001'::uuid, v.created_at
from (values
  ('ניקיון חדר המדרגות ביום שלישי',
   E'שלום לכולם,\nביום שלישי בבוקר ינקו את חדר המדרגות. נא לא להשאיר חפצים על המדרגות.',
   true, null::date, now() - interval '2 days'),
  ('אסיפת דיירים בסוף החודש',
   'אסיפת הדיירים השנתית תתקיים בלובי. פרטים נוספים יישלחו בקרוב.',
   false, null::date, now() - interval '5 days'),
  ('הפסקת מים זמנית',
   'בשבוע שעבר הייתה הפסקת מים מתוכננת לצורך תיקון צנרת. הנושא הסתיים.',
   false, (current_date - 14)::date, now() - interval '20 days')
) as v(title, body, pinned, expires_at, created_at);

-- Sample service calls across statuses (no photos), with a short comment thread on one.
insert into public.tickets (id, title, description, location, status, vendor, opened_by, created_at)
select v.id::uuid, v.title, v.description, v.location, v.status, v.vendor, v.opened_by::uuid, v.created_at
from (values
  ('40000000-0000-0000-0000-000000000001', 'נורה שרופה בחדר המדרגות',
   'הנורה בין קומה 2 לקומה 3 לא נדלקת כבר יומיים.', 'חדר מדרגות', 'open', null,
   '30000000-0000-0000-0000-000000000002', now() - interval '3 days'),
  ('40000000-0000-0000-0000-000000000002', 'המעלית נתקעת בקומה 3',
   'הדלת לא נסגרת עד הסוף ולפעמים המעלית לא זזה.', 'מעלית', 'in_progress', 'מעליות לדוגמה בע"מ',
   '30000000-0000-0000-0000-000000000002', now() - interval '6 days'),
  ('40000000-0000-0000-0000-000000000003', 'דליפת מים בחניה',
   'שלולית ליד חניה 4 אחרי כל גשם.', 'חניה', 'closed', 'אינסטלציה פיקטיבית',
   '30000000-0000-0000-0000-000000000001', now() - interval '20 days')
) as v(id, title, description, location, status, vendor, opened_by, created_at);

insert into public.ticket_comments (ticket_id, author_id, body, created_at)
values
  ('40000000-0000-0000-0000-000000000002', '30000000-0000-0000-0000-000000000001',
   'הזמנו טכנאי, הוא יגיע ביום ראשון.', now() - interval '5 days'),
  ('40000000-0000-0000-0000-000000000002', '30000000-0000-0000-0000-000000000002',
   'תודה! הבעיה חזרה גם היום בבוקר.', now() - interval '1 day');
