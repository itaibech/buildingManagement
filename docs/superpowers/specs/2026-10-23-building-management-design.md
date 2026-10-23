# Building Management — Design

Status: draft, awaiting approval · Date: 2026-10-23 · Owner: Itai Bechor

## 1. Intent

A Hebrew-first web app for running one residential building, in the spirit of
Hombi (hombi.co), with ideas from Bllink and Darimpo. Today the building
committee (ועד בית) tracks fees and expenses in an Excel workbook by hand.
Residents can't see what they owe, report a fault, or read announcements in one
place. The app replaces the workbook and becomes the building's shared hub.

Success for phase 1: the committee stops using the Excel file. Last year's
data is imported, residents log in on their phones and see their balance and
the building's announcements, and the whole thing costs ₪0 to run.

## 2. Goals / non-goals / anti-goals

**Goals (phase 1, built in this order)**
1. דיירים — Tenants and apartments
2. הודעות — Announcements
3. קריאות ותקלות — Service calls and faults
4. משימות תחזוקה — Maintenance tasks
5. הכנסות והוצאות — Income and expenses, including who owes what
6. Excel import (the committee's existing workbook)

Later phases (not designed here): more Hombi/Bllink/Darimpo features such as
documents, votes and surveys, a vendor directory, payment reminders by
WhatsApp or SMS, finer-grained permissions, and multiple buildings.

**Non-goals for phase 1**
- Online payment (credit card, bank transfer) inside the app.
- More than one building. The schema carries `building_id` so this can be
  added later without a migration rewrite.
- Native mobile apps. The web app is responsive and installable as a PWA
  only if that's cheap (builder's call).
- Permission levels beyond admin and resident.

**Anti-goals (failure even if it "works")**
- Any resident can see another apartment's payments or debts.
- Any recurring cost: everything stays on free tiers.
- The UI feels like a translated English app. RTL must be native, with
  Hebrew labels, ₪ amounts, Hebrew month names and dates as DD/MM/YYYY.
- It's painful on a phone. Most residents will only ever use it on mobile.

## 3. Constraints and decided stack

| Concern | Decision | Notes |
|---|---|---|
| Frontend | React + TypeScript (strict, no `any`) via Vite | User requirement |
| Hosting | GitHub Pages, public repo `itaibech/buildingManagement` (site: itaibech.github.io/buildingManagement) | Free. Use `HashRouter` (or a 404.html redirect) so deep links work on Pages |
| Backend / DB | Supabase free tier (Postgres + Auth + Storage), user's existing org `cqwywcmjujjgjbmaapwe` | Replaces MySQL by user's decision. No custom server: the browser talks to Supabase directly and security is enforced by Row Level Security |
| Auth | Supabase Auth: Google OAuth **and** email + password sign-up | Google requires an OAuth client in Google Cloud Console, which the user creates (see §9) |
| Language | Hebrew default, `dir="rtl"`; strings kept in one file so English can be added later | |
| CI/CD | GitHub Actions: lint → typecheck → test → build → deploy to Pages on push to `main`. DB migrations applied with the Supabase CLI from Actions | |
| Scale | 1 building, up to ~20 users | Free tier is far above this |

Known free-tier limit: Supabase pauses a free project after ~7 days with no
activity. Mitigation: a scheduled GitHub Action pings the API every few days.

Global user rules apply: functions < 40 lines, no `console.log` in committed
code, strict types, tests run after every change.

## 4. Users, roles and onboarding

Two roles in phase 1:
- **admin**: committee members. Full create, edit and delete on everything.
- **resident**: read-only view of building data, plus their own apartment's
  finances (exceptions in §5.3).

Onboarding flow (agreed with user):
1. The person signs up with Google or with email and password.
2. They see a "waiting for approval" screen and no building data.
3. An admin approves them, links them to an apartment and sets their role.
4. Bootstrap: the email `itai.bechor@gmail.com` (the `bootstrap_admin_email` app setting, set per
   environment, never hard-coded in the client) becomes the **super admin** on its first sign-in,
   while no admin exists yet. The grant is made **only for a Google sign-in** (Google has verified the
   address); an email/password sign-up with that address gets a pending resident profile like
   everyone else.
5. The super admin can't be demoted, blocked or deleted, by anyone (enforced by database triggers,
   not the UI).
6. Any admin can promote a resident to admin, and demote or block another admin (except the super
   admin and themselves).

## 5. Features

### 5.1 דיירים — Tenants and apartments
- An apartment has a number, floor (optional) and notes. A resident has a
  name, phone, email (optional), owner or renter, and the apartment they're
  linked to. An apartment can have several residents.
- Admins create, edit and delete apartments and residents, and approve
  pending users (linking a login to a resident and apartment).
- Residents see a building directory (names, apartment numbers, and phone
  numbers with tap-to-call on mobile). **Residents see each other's phone
  numbers** (user decision).

### 5.2 הודעות — Announcements
- Admins post an announcement with a title, body, optional pin-to-top and
  optional expiry date.
- Everyone sees the list newest first, pinned on top, with an unread
  indicator per user.
- Phase 1 has no push or email notifications.

### 5.3 קריאות ותקלות — Service calls and faults
- A call has a title, description, location (free text, e.g. "lobby",
  "elevator"), optional photos (Supabase Storage), status
  (פתוחה / בטיפול / סגורה), and who opened it and when.
- Admins change status, add comments and assign a vendor (free text).
- **Residents can open calls**, attach photos and add comments (user decision). Everyone approved sees all calls in the building (author's call); only admins change status or assign a vendor. This is the one exception to "residents are read-only".

### 5.4 משימות תחזוקה — Maintenance tasks
- Recurring building tasks, mirroring the "planned annual costs" sheet:
  elevator inspection, fire-extinguisher check, backflow preventer (מז"ח)
  test, water-tank disinfection, pest control, lobby polish, and so on.
- Each task has a title, vendor, frequency (one-off, monthly, quarterly,
  yearly), next due date, and a done log (date, note, optional cost that can
  turn into an expense).
- The dashboard shows overdue and upcoming items (next 30 days).
- Residents get a read-only view.

### 5.5 הכנסות והוצאות — Income and expenses
**Charges (what's owed)**
- Monthly fee: a building-wide amount with an effective-from date, because
  the fee changes during the year (₪390, later ₪330). The app generates one
  charge per apartment per month.
- Per-apartment override for the fee, for the few apartments that differ.
- One-off levy: an amount charged to all apartments (or chosen ones) for a
  given month, e.g. the ₪500 special charge.
- Extra charge to one apartment, e.g. the EV charging block for apartment 15,
  with a monthly amount.

**Payments (what's paid)**
- An admin records a payment: apartment, date, amount, method (cash, bank
  transfer, cheque, Bit/PayBox, other) and a note. A payment isn't tied to a
  specific month. Balance = total charges − total payments. This matches the
  Excel, where one cell sometimes covers several months (e.g. ₪2,340, ₪780).

**Balances and debts**
- Each apartment shows its running balance and a month-by-month grid
  (charged vs paid), similar to the income sheet.
- Admins see all apartments' balances, with debtors highlighted.
- A resident sees only their own apartment.

**Expenses**
- An expense has a category (seeded from the Excel rows: חברת ניהול, ניקיון,
  חשמל, בנק, הדברה, נורות, תרבות דיור, ביטוחים, מעלית, בזק, פחים, ...), a
  date or month, amount, vendor and note, plus an optional receipt photo.
- Recurring expense templates (cleaning, management company, elevator
  maintenance, Bezeq, bank fees) can be added to a month in one click. They
  are not posted automatically.

**Budget and reports**
- A yearly budget per category, mirroring "עלויות שנתיות מתוכננות".
- The finance view shows a year at a glance: income vs expenses per month,
  budget vs actual per category, and the building's cash balance.
- Residents see building-level totals and expenses by category, never
  per-apartment payments.
- CSV/Excel export of any table is a nice-to-have (builder's call).

### 5.6 Excel import
Import the committee's workbook (sample: `תשלומי וועד בית עד אוקטובר.xlsx`):
- **הכנסות sheet:** one row per apartment, with apartment number, name and
  phone, then one column per month of payment amounts and a total.
  - The import creates apartments and residents, plus one payment per
    non-empty cell, dated to the first of that month, with a note saying it
    was imported.
  - The header row is messy: some cells are Excel date serials (46023 = Jan
    2026), some are Hebrew month names, and there's an empty column. The
    importer maps each column to a month and shows that mapping for the
    admin to confirm before saving.
  - The EV charging block (columns S–AD, apartment 15) becomes payments and
    a matching EV charge for that apartment.
- **הוצאות sheet:** one row per category, one column per month. Each non-empty
  cell becomes an expense on the first of that month. Categories that don't
  exist are created.
- **עלויות שנתיות מתוכננות sheet:** category plus yearly amount becomes the
  budget.
- Flow: upload → parse in the browser → preview of what will be created
  (counts plus a table, with warnings for cells it couldn't read) → confirm
  → write. Re-importing the same year must not double the data: either
  replace that year's imported rows or refuse, and the builder picks one.
- Admins only.

### 5.7 טעינת רכב חשמלי — EV chargers (phase 1, task 14)
- Admins register a charger per apartment (label, opening meter reading) and record a monthly meter
  reading. Each reading creates that apartment's EV charge: (reading − previous) × the kWh rate in
  force that month. Rates have a history (effective from a month).
- Charges are written only by server functions (meter math under a per-charger lock); they can't be
  edited directly, and re-recording a month recomputes the following month.
- An EV workbook import (the "רכב חשמלי" sheet) creates chargers, readings, rates and "שולם" payments.
  Once an apartment has a charger, the main workbook's EV block is no longer imported for it.
- Residents see their own EV usage and charges. The page lives at `/ev` (admins), linked from the
  כספים header.

### 5.8 דמי ועד לדירה — Apartment fee timeline and exemption (phase 1, task 15)
- The building fee schedule applies to every apartment by default. An apartment can have its own
  timeline: from a month on, a custom amount, exempt, or back to the building fee.
- Exempt apartments are left out of the collection rate; levies still apply to them.
- Admins edit the timeline from כספים › דמי ועד; residents see their own monthly fee (or that they
  are exempt). The Excel import can mark apartments with no payments all year as exempt (opt-in).

## 6. Data model (sketch — builder refines)

All tables have `id uuid`, `building_id`, `created_at`. RLS is on for every
table.

- `buildings` (name, address)
- `profiles` (user_id → auth.users, full_name, role `admin|resident`,
  status `pending|approved`, resident_id)
- `apartments` (number, floor, notes)
- `residents` (apartment_id, full_name, phone, email, is_owner)
- `announcements` (title, body, pinned, expires_at, author_id) and
  `announcement_reads` (announcement_id, user_id)
- `tickets` (title, description, location, status, opened_by, vendor),
  `ticket_comments`, and `ticket_photos` (storage path)
- `maintenance_tasks` (title, vendor, frequency, next_due) and
  `maintenance_log` (task_id, done_on, note, expense_id)
- `fee_schedule` (amount, effective_from), `apartment_fee_overrides`,
  `charges` (apartment_id, month, amount, kind `monthly|levy|extra`, label)
- `payments` (apartment_id, paid_on, amount, method, note, source
  `manual|import`)
- `expense_categories`, `expenses` (category_id, spent_on, amount, vendor,
  note, receipt_path, source)
- `budgets` (year, category_id, amount)

RLS in short:
- An approved user can read building-wide tables.
- Only admins can write, except that approved residents can insert tickets,
  ticket comments and ticket photos (their own rows).
- `charges` and `payments` are readable by admins, or by residents whose
  apartment matches.
- Pending users can read only their own profile.
- Role checks use a `SECURITY DEFINER` helper (`is_admin()`), never a value
  the client sends.

## 7. UX

- Mobile first. Bottom tab bar on phones (בית, הודעות, תקלות, כספים, עוד),
  side navigation on desktop.
- Home dashboard: my balance (residents) or the debtors summary (admins),
  latest announcements, open calls, and upcoming maintenance.
- Hebrew month names, ₪ via `Intl.NumberFormat('he-IL', {style:'currency',
  currency:'ILS'})`, dates as DD/MM/YYYY.
- Forms are big-touch-target and keyboard-friendly, with native date inputs.
- Accessibility basics: labels, contrast, focus states (Israeli accessibility
  standard IS 5568 is the long-term target).
- Light theme in phase 1; dark mode is optional.

## 8. Security and performance

- Only the Supabase anon key ships to the browser. The service-role key lives
  in GitHub Actions secrets only.
- RLS is the security boundary, and each policy gets a test (a SQL test or an
  integration test against a local Supabase).
- Uploads: images only, with a size cap, in a private bucket served through
  signed URLs.
- Inputs are validated on both sides: DB constraints (amount ≥ 0, valid enums)
  and form validation.
- Code-split per route and keep the bundle small. The Excel parser is
  lazy-loaded only on the import page.
- Dependabot and `npm audit` run in CI.

## 9. What the user must do (can't be automated)

1. ~~Create the GitHub repo~~ — done: `itaibech/buildingManagement`. Optionally install the `gh`
   CLI and run `gh auth login` so it can be created for them. SSH push access
   already works.
2. Create the Supabase project in their org (or give a personal access token
   so the CLI can create it), and provide the project URL and anon key.
3. Create a Google OAuth client in Google Cloud Console and paste its client
   ID and secret into Supabase Auth. Step-by-step instructions go in the
   README.
4. Add the secrets to GitHub Actions: `SUPABASE_ACCESS_TOKEN`,
   `SUPABASE_DB_PASSWORD`, `SUPABASE_PROJECT_REF`.

## 10. Left to the builder

The UI component library (it must handle RTL well), the state and data
fetching library, the Excel parsing library (avoid the outdated `xlsx` npm
package because of known CVEs), the test tooling, the folder layout, and how
monthly charges are generated (a DB view computed on the fly or materialized
rows).

## 11. Decisions from the builder check (author's calls — user to review)

- **Import also writes charges.** The import step asks the admin for the
  year's fee schedule (e.g. ₪390 from Jan, ₪330 from Jul) and per-apartment
  overrides, and the admin tags which month column is a levy (the ₪500
  column). The import then back-fills `charges` for the imported months, so
  balances are right on day one.
- **Opening balance.** Each apartment has an opening balance (debt or credit
  carried over from before the imported period), default 0 and editable by an
  admin. It's stored as a charge of kind `opening`.
- **EV charging is usage-based.** The sample amounts vary month to month
  (₪103.51, ₪293.41, …). The admin enters each month's amount per apartment as
  an `extra` charge. The import creates one EV charge per non-empty cell, equal
  to the paid amount, so EV nets to zero.
- **Building cash balance.** A building setting holds the opening bank balance
  and its date. Cash = opening + payments − expenses since then.
- **Several people per apartment.** Everyone linked to an apartment (owner or
  renter) sees that apartment's finances. Owner-only visibility can come with
  the later permissions phase.

## 12. User decisions after review

- Residents can open service calls, with photos and comments.
- Residents see each other's phone numbers in the directory.
