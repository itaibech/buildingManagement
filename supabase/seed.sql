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

-- The bootstrap grant needs a Google sign-up (0012), so the local email admin is made the super admin
-- directly, as postgres.
update public.profiles set role = 'admin', status = 'approved', is_super_admin = true
where email = 'admin@example.test';

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

-- Maintenance: spread of due dates so overdue / soon / later / none all show locally.
update public.maintenance_tasks set next_due = v.d, vendor = v.vendor
from (values
  ('בדיקת מעלית', (current_date - 20)::date, 'מעליות דוגמה בע"מ'),
  ('מהנדס בודק מעלית', (current_date - 3)::date, 'מהנדס דוגמה'),
  ('בדיקת מטפים ועמדות כיבוי אש', (current_date + 10)::date, 'בטיחות דוגמה'),
  ('בדיקת מז"חים שנתית', (current_date + 25)::date, 'בטיחות דוגמה'),
  ('חיטוי מאגר מים', (current_date + 90)::date, 'מים נקיים בע"מ'),
  ('הדברה', (current_date + 45)::date, 'הדברה דוגמה'),
  ('פוליש לובי', (current_date + 200)::date, '')
) as v(title, d, vendor)
where maintenance_tasks.title = v.title;

insert into public.maintenance_log (task_id, done_on, note)
select id, current_date - 365, 'בוצע, הכול תקין' from public.maintenance_tasks where title = 'בדיקת מעלית';

-- Finance: ₪390 from Jan 2026, ₪330 from Jul 2026; a few payments, charges and expenses.
-- Apartment 1 (the resident) is paid up, 2 is in credit, the rest owe something.
update public.buildings set billing_start = '2026-01-01', opening_cash = 12000, opening_cash_date = '2026-01-01';
insert into public.fee_schedule (amount, effective_from) values (390, '2026-01-01'), (330, '2026-07-01');
-- Per-apartment fee timeline: apartment 6 pays a custom fee (₪270, ₪350 from 2027), apartment 5 is exempt from Aug 2026.
insert into public.apartment_fee_overrides (apartment_id, mode, amount, effective_from) values
  ('10000000-0000-0000-0000-000000000006', 'custom', 270, '2026-01-01'),
  ('10000000-0000-0000-0000-000000000006', 'custom', 350, '2027-01-01'),
  ('10000000-0000-0000-0000-000000000005', 'exempt', null, '2026-08-01');

insert into public.charges (apartment_id, month, amount, kind, label) values
  ('10000000-0000-0000-0000-000000000001', '2026-03-01', 500, 'levy', 'היטל שיפוץ לובי'),
  ('10000000-0000-0000-0000-000000000002', '2026-03-01', 500, 'levy', 'היטל שיפוץ לובי'),
  ('10000000-0000-0000-0000-000000000003', '2026-03-01', 500, 'levy', 'היטל שיפוץ לובי'),
  ('10000000-0000-0000-0000-000000000005', '2026-05-01', 103.51, 'extra', 'טעינת רכב חשמלי'),
  ('10000000-0000-0000-0000-000000000004', '2026-01-01', -200, 'opening', 'יתרת פתיחה');

insert into public.payments (apartment_id, paid_on, amount, method, note) values
  ('10000000-0000-0000-0000-000000000001', '2026-01-05', 2340, 'transfer', 'ינואר–יוני'),
  ('10000000-0000-0000-0000-000000000001', '2026-03-10', 500, 'transfer', 'היטל'),
  ('10000000-0000-0000-0000-000000000001', '2026-07-03', 1650, 'app', ''),
  ('10000000-0000-0000-0000-000000000002', '2026-01-04', 5000, 'cheque', 'תשלום שנתי מראש'),
  ('10000000-0000-0000-0000-000000000003', '2026-02-01', 780, 'cash', ''),
  ('10000000-0000-0000-0000-000000000004', '2026-04-12', 1170, 'transfer', ''),
  ('10000000-0000-0000-0000-000000000005', '2026-06-01', 1950, 'app', '');

insert into public.expenses (category_id, spent_on, amount, vendor, note)
select c.id, v.spent_on::date, v.amount, v.vendor, v.note
from (values
  ('חברת ניהול', '2026-01-31', 850, 'ניהול דוגמה בע"מ', ''),
  ('ניקיון', '2026-01-31', 600, 'ניקיון לדוגמה', ''),
  ('חשמל', '2026-02-15', 412.30, 'חברת החשמל', 'חשבון דו-חודשי'),
  ('בנק', '2026-02-28', 35, 'בנק', 'עמלות'),
  ('ניקיון', '2026-02-28', 600, 'ניקיון לדוגמה', ''),
  ('מעלית', '2026-03-01', 1200, 'מעליות דוגמה בע"מ', 'שירות רבעוני'),
  ('בזק', '2026-03-05', 120, 'בזק', 'אינטרנט ללובי')
) as v(category, spent_on, amount, vendor, note)
join public.expense_categories c on c.name = v.category;

insert into public.expense_templates (category_id, amount, vendor, label)
select c.id, v.amount, v.vendor, v.label
from (values
  ('ניקיון', 600, 'ניקיון לדוגמה', 'ניקיון חודשי'),
  ('חברת ניהול', 850, 'ניהול דוגמה בע"מ', 'דמי ניהול'),
  ('בזק', 120, 'בזק', 'אינטרנט')
) as v(category, amount, vendor, label)
join public.expense_categories c on c.name = v.category;

insert into public.budgets (year, category_id, amount)
select 2026, c.id, v.amount
from (values ('חברת ניהול', 10200), ('ניקיון', 7200), ('חשמל', 2500), ('מעלית', 4800), ('בזק', 1440)) as v(category, amount)
join public.expense_categories c on c.name = v.category;

-- Rows as the Excel import (Task 11) writes them: source 'import', replaced by the next import of 2026.
insert into public.payments (apartment_id, paid_on, amount, method, note, source) values
  ('10000000-0000-0000-0000-000000000006', '2026-01-01', 390, 'other', 'יובא מאקסל', 'import'),
  ('10000000-0000-0000-0000-000000000006', '2026-02-01', 390, 'other', 'יובא מאקסל', 'import');
insert into public.expenses (category_id, spent_on, amount, note, source)
select id, '2026-01-01', 36, 'יובא מאקסל', 'import' from public.expense_categories where name = 'בנק';

-- EV charging (Task 14, invented readings): chargers on apartments 4 and 5, two per-kWh rates.
-- Apartment 4 already has October's reading; apartment 5 is still waiting for it.
insert into public.ev_rates (rate, effective_from) values (0.538, '2026-01-01'), (0.574, '2026-07-01');
insert into public.ev_chargers (id, apartment_id, initial_reading) values
  ('50000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000004', 1200),
  ('50000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000005', 350.5);
insert into public.ev_readings (charger_id, month, reading, read_on) values
  ('50000000-0000-0000-0000-000000000001', '2026-06-01', 1385.2, '2026-06-30'),
  ('50000000-0000-0000-0000-000000000001', '2026-07-01', 1561.75, '2026-07-31'),
  ('50000000-0000-0000-0000-000000000001', '2026-08-01', 1702.4, '2026-08-31'),
  ('50000000-0000-0000-0000-000000000001', '2026-09-01', 1890, '2026-09-30'),
  ('50000000-0000-0000-0000-000000000001', '2026-10-01', 2044.35, '2026-10-20'),
  ('50000000-0000-0000-0000-000000000002', '2026-07-01', 512.8, '2026-07-31'),
  ('50000000-0000-0000-0000-000000000002', '2026-08-01', 640.15, '2026-08-31'),
  ('50000000-0000-0000-0000-000000000002', '2026-09-01', 801.9, '2026-09-30');
-- Same computation as record_ev_reading: sets kWh, rate and amount and creates each month's charge.
select public.ev_charge_reading(id) from public.ev_readings;
insert into public.payments (apartment_id, paid_on, amount, method, note) values
  ('10000000-0000-0000-0000-000000000004', '2026-07-05', 99.62, 'transfer', 'טעינת רכב חשמלי'),
  ('10000000-0000-0000-0000-000000000004', '2026-08-04', 100, 'transfer', 'טעינת רכב חשמלי'),
  ('10000000-0000-0000-0000-000000000005', '2026-08-06', 93.1, 'app', 'טעינת רכב חשמלי');
