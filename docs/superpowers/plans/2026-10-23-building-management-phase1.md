# Building Management Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Hebrew RTL React app on GitHub Pages, backed by Supabase. Phase 1
covers tenants, announcements, service calls, maintenance, finance (including
debts) and Excel import.

**Architecture:** A static Vite SPA talks directly to Supabase using the anon
key. Every authorization rule lives in Postgres RLS and is tested with pgTAP.
Monthly fees are computed by a SQL view, not stored. Levies, extras and opening
balances are rows in `charges`. GitHub Actions builds, tests, deploys Pages and
pushes migrations.

**Tech Stack:**
- Frontend: React 19, TypeScript (strict), Vite 8, react-router 8 (`HashRouter`),
  Mantine 9 (RTL via `DirectionProvider`), @tanstack/react-query 5,
  @supabase/supabase-js 2
- Excel: SheetJS from `https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz`,
  lazy-loaded
- Tests: Vitest + Testing Library for the app, Supabase CLI + pgTAP
  (`supabase test db`) for the DB

**Spec:** `docs/superpowers/specs/2026-10-23-building-management-design.md`

## Global Constraints

- Hebrew default, `<html lang="he" dir="rtl">`. All UI strings live in `src/lib/he.ts`.
- Format money with `Intl.NumberFormat('he-IL',{style:'currency',currency:'ILS'})` and dates as DD/MM/YYYY.
- Strict TS, no `any`. Functions under 40 lines. No `console.log` in committed code.
- Only the anon key ships to the browser. The service-role key and DB password live only in GitHub secrets.
- RLS is enabled on every table. Role checks go through `public.is_admin()` / `public.is_approved()` (`SECURITY DEFINER`).
- Every table has `id uuid pk default gen_random_uuid()`, `building_id uuid not null references buildings`, `created_at timestamptz default now()`.
- Amount columns are `numeric(12,2) check (amount >= 0)`, except `charges` of kind `opening`, which may be negative (a credit).
- **Never commit the sample workbook or any real resident name or phone number. The repo is public.** Fixtures use invented names and numbers.
- The repo `.npmrc` pins `registry=https://registry.npmjs.org/`. The dev machine's global npm points at a corporate Artifactory, and the lockfile must resolve in CI.
- Free tiers only. Supabase project in org `cqwywcmjujjgjbmaapwe`. Site at `https://itaibech.github.io/buildingManagement/` (Vite `base: '/buildingManagement/'`).
- Mobile first. Bottom tab bar under 768px (בית, הודעות, תקלות, כספים, עוד), side nav above that.

## Delivery (user requirement)

- Each task is built by its own agent, followed by a reviewer agent.
- One branch and one PR per task: `feat/01-scaffold`, `feat/02-core-schema`, … `feat/12-hardening`.
  - PRs are stacked: each branch is cut from the previous task's branch, and its PR targets that branch.
  - Once a base PR merges, retarget the next PR to `main`.
  - PRs are opened with `gh pr create` and never merged by an agent.
- Local environment, available from Task 2 on:
  - `npm run db:start` (`supabase start`): local Postgres, Auth and Storage in Docker, with local Studio at :54323.
  - `npm run db:reset` re-applies migrations plus `supabase/seed.sql`.
  - `npm run dev` runs Vite, reading `.env.local` (copied from `.env.example`, which points at `http://127.0.0.1:54321` and the local anon key).
  - The seed has invented data only: one building, 5 apartments, local test users `admin@example.test` / `resident@example.test` (password `password123`, local only), plus sample rows for each feature as its task lands.
  - Email confirmation is off locally (`config.toml`).
- Responsive: every page task checks 375px (mobile) and 1280px (desktop) in the browser before its PR.

## Prerequisites from the user (blocking where noted)

- Before Task 2: a Supabase personal access token (dashboard → Account → Access Tokens), or the user creates project `building-management` themselves and shares its ref. Also the DB password.
- Before Task 1 deploys: GitHub → Settings → Pages → Source: **GitHub Actions**.
- Before Task 3's Google button works: a Google Cloud OAuth client (Web), with redirect URI `https://<ref>.supabase.co/auth/v1/callback`, pasted into Supabase → Auth → Providers → Google. Steps go in the README.
- GitHub secrets: `SUPABASE_ACCESS_TOKEN`, `SUPABASE_DB_PASSWORD`, `SUPABASE_PROJECT_REF`. GitHub variables: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`.

## File Structure

```
.github/workflows/ci.yml          lint, typecheck, vitest, build on every PR / push
.github/workflows/deploy.yml      on main: build → Pages; supabase db push
.github/workflows/keepalive.yml   cron every 3 days: GET <url>/rest/v1/ (prevents the free-tier pause)
.github/dependabot.yml
.npmrc
index.html  vite.config.ts  tsconfig.json  eslint.config.js
src/main.tsx                      providers: Mantine (rtl), QueryClient, HashRouter, AuthProvider
src/App.tsx                       route table, lazy routes
src/lib/supabase.ts               typed client
src/lib/db.types.ts               generated: supabase gen types typescript
src/lib/he.ts                     Hebrew strings + HEBREW_MONTHS
src/lib/format.ts                 formatILS, formatDate, monthLabel
src/auth/AuthProvider.tsx         session + profile context, useAuth()
src/auth/LoginPage.tsx            Google + email/password, sign-up toggle
src/auth/PendingPage.tsx
src/auth/Guard.tsx                <RequireApproved>, <RequireAdmin>
src/layout/Shell.tsx              responsive nav
src/features/home/HomePage.tsx
src/features/tenants/*            ApartmentsPage, ApartmentForm, ResidentForm, DirectoryPage, UsersPage, api.ts
src/features/announcements/*      AnnouncementsPage, AnnouncementForm, api.ts
src/features/tickets/*            TicketsPage, TicketPage, TicketForm, api.ts
src/features/maintenance/*        MaintenancePage, TaskForm, nextDue.ts, api.ts
src/features/finance/*            FinancePage, ApartmentLedger, PaymentForm, ExpensesPage, BudgetPage, ChargesPage, ledger.ts, api.ts
src/features/import/*             ImportPage, parseWorkbook.ts, buildImport.ts, api.ts, fixture.ts
supabase/config.toml
supabase/migrations/0001_core.sql  0002_announcements.sql  0003_tickets.sql  0004_maintenance.sql  0005_finance.sql  0006_import.sql
supabase/tests/*.test.sql         pgTAP, one file per migration
```

Each `api.ts` exports react-query hooks for its feature (`useX()` / `useSaveX()` / `useDeleteX()`). It's the only place a feature touches `supabase`.

## Review Focus

1. **A resident calls the REST API directly** for another apartment's `payments`, `charges` or `apartment_balances`: they get zero rows. Pinned in Task 9's pgTAP tests.
2. **The fee changes mid-year** (₪390 from 2026-01, ₪330 from 2026-07): the Jul–Dec rows of `monthly_fees` say 330, Jan–Jun say 390, and an override beats both. Pinned in Task 9.
3. **A pending user opens a deep link** like `#/finance`: they see PendingPage, and every table query returns empty. Pinned in Task 3 (component) and Task 2 (pgTAP).
4. **The workbook's header row mixes things up.** It has date serials (46023), Hebrew month names (`אוגוסט`), a mislabeled duplicate month (`אוקטובר` before the Sep serial), empty columns and a total column. The parser maps serials and names to months, flags the duplicate, and ignores the empty and total columns. Pinned in Task 11.
5. **Re-importing the same year** leaves the row counts unchanged, because the import replaces earlier `source='import'` rows for that year. Pinned in Task 11's pgTAP test.

---

### Task 1: Scaffold, RTL shell page, CI and Pages deploy

**Files:** Create everything at the root listed above, plus `.github/*`, `src/main.tsx`, `src/App.tsx`, `src/lib/he.ts` and `src/lib/format.ts`. Test: `src/lib/format.test.ts`.

**Interfaces:**
- Produces: `formatILS(n: number): string`, `formatDate(d: string | Date): string` (DD/MM/YYYY), `monthLabel(month: string /* 'YYYY-MM' */): string` (e.g. `'ינואר 2026'`), `HEBREW_MONTHS: readonly string[]` (12 items, starting `'ינואר'`), `he` (string dictionary object).

- [ ] Step 1: `npm create vite@latest . -- --template react-ts`, add `.npmrc`, install deps, and set `base: '/buildingManagement/'`.
- [ ] Step 2: Write the failing tests: `formatILS(4160)` contains `'4,160'` and `'₪'`; `formatDate('2026-01-05') === '05/01/2026'`; `monthLabel('2026-10') === 'אוקטובר 2026'`.
- [ ] Step 3: Run `npx vitest run src/lib`. Expected: FAIL.
- [ ] Step 4: Implement `format.ts` and `he.ts`. `main.tsx` wraps the app in `DirectionProvider initialDirection="rtl"` + `MantineProvider` + `HashRouter`, and `App` renders `he.appName`.
- [ ] Step 5: Run `npx vitest run && npm run lint && npx tsc -b && npm run build`. Expected: all pass.
- [ ] Step 6: Add `ci.yml` (Node 22, `npm ci`, lint, tsc, vitest, build), `deploy.yml` (on push to `main`: build with `VITE_*` vars → `actions/upload-pages-artifact` → `actions/deploy-pages`), `dependabot.yml` (npm + actions, weekly), and `npm audit --audit-level=high` in CI.
- [ ] Step 7: Commit (`feat: scaffold RTL app with CI and Pages deploy`), open a PR, and confirm CI is green.

### Task 2: Supabase project and core schema (buildings, profiles, apartments, residents)

**Files:** Create `supabase/config.toml`, `supabase/migrations/0001_core.sql`, `supabase/tests/core.test.sql`, `src/lib/supabase.ts` and `src/lib/db.types.ts`.

**Interfaces:**
- Produces SQL:
  - `buildings(name, address, opening_cash numeric, opening_cash_date date, billing_start date)`
  - `profiles(user_id uuid pk → auth.users, building_id, full_name, email, role text check in ('admin','resident') default 'resident', status text check in ('pending','approved') default 'pending', resident_id uuid null)`
  - `apartments(number int unique per building, floor int null, notes)`
  - `residents(apartment_id, full_name, phone, email, is_owner bool)`
  - `app_settings(key text pk, value text)`
  - functions `is_admin() returns bool`, `is_approved() returns bool`, `my_apartment_id() returns uuid` (via profiles → residents)
  - trigger `on_auth_user_created` inserts a profile; if the email equals `app_settings['bootstrap_admin_email']`, it sets role admin and status approved
  - one seeded building row
- Produces TS: `supabase` (a typed `SupabaseClient<Database>`).

- [ ] Step 1: `npx supabase init`, create the project with the CLI (`supabase projects create building-management --org-id cqwywcmjujjgjbmaapwe`) using the user's token, then `supabase link`.
- [ ] Step 2: Write the failing pgTAP tests in `core.test.sql`:
  - a pending user selecting `apartments` gets 0 rows
  - an approved resident gets every row and their `insert` is rejected (`throws_ok`)
  - an admin can insert
  - a user can `update` their own profile's `full_name` but not their own `role`/`status` (role escalation blocked)
  - a new auth user whose email matches the bootstrap email gets an approved admin profile
- [ ] Step 3: Run `npx supabase start && npx supabase test db`. Expected: FAIL (tables missing). If Docker isn't running locally, run it in CI and add a `db-test` job to `ci.yml` (`supabase start` + `supabase test db`).
- [ ] Step 4: Write `0001_core.sql`:
  - policies: `select` for `is_approved()` and `all` for `is_admin()` on apartments and residents
  - profiles: select own or admin; update own `full_name` only, enforced with a trigger that rejects role or status changes unless `is_admin()`
- [ ] Step 5: Run `npx supabase test db`. Expected: PASS.
- [ ] Step 6: `supabase db push`. Set the bootstrap email once with `insert into app_settings values ('bootstrap_admin_email','<user email>')` via the SQL editor or CLI, not in a migration (the repo is public). Generate `db.types.ts`.
- [ ] Step 7: Add `supabase db push` to `deploy.yml` (with `SUPABASE_ACCESS_TOKEN`, `SUPABASE_DB_PASSWORD`, `SUPABASE_PROJECT_REF`), then commit (`feat: core schema with RLS`).

### Task 3: Auth (Google + email/password), pending gate, app shell

**Files:** Create `src/auth/{AuthProvider,LoginPage,PendingPage,Guard}.tsx`, `src/layout/Shell.tsx` and `src/features/home/HomePage.tsx`. Test: `src/auth/Guard.test.tsx`.

**Interfaces:**
- Consumes: `supabase`, `he`.
- Produces: `useAuth(): { session: Session|null; profile: Profile|null; isAdmin: boolean; loading: boolean; signOut(): Promise<void> }`, `<RequireApproved>`, `<RequireAdmin>`, and `<Shell>` (renders `<Outlet/>`).

- [ ] Step 1: Write the failing Guard tests, mocking `useAuth`:
  - no session → redirects to `/login`
  - `status:'pending'` → renders the PendingPage text `he.pendingApproval` at route `/finance`
  - approved resident on `<RequireAdmin>` → redirects to `/`
  - admin → renders the children
- [ ] Step 2: Run `npx vitest run src/auth`. Expected: FAIL.
- [ ] Step 3: Implement them.
  - LoginPage: Google uses `signInWithOAuth({provider:'google', options:{redirectTo: location.origin + import.meta.env.BASE_URL}})`. Email uses `signInWithPassword` / `signUp`, with Hebrew error messages.
  - Shell: Mantine `AppShell`, bottom bar under `sm`, navbar above.
  - Routes are lazy-loaded with `React.lazy`.
- [ ] Step 4: Run `npx vitest run && npx tsc -b`. Expected: PASS.
- [ ] Step 5: Manually check with the `run` skill: sign up by email → pending screen; the bootstrap email gets in as admin; check at 375px and 1280px widths.
- [ ] Step 6: Add the Google OAuth and Supabase redirect-URL steps to the README (Site URL = Pages URL, plus `http://localhost:5173/buildingManagement/`). Commit (`feat: auth and app shell`).

### Task 4: דיירים — apartments, residents, directory, user approval

**Files:** Create `src/features/tenants/{api.ts,ApartmentsPage.tsx,ApartmentForm.tsx,ResidentForm.tsx,DirectoryPage.tsx,UsersPage.tsx}`. Test: `src/features/tenants/UsersPage.test.tsx`.

**Interfaces:**
- Consumes: `useAuth`, `supabase`.
- Produces hooks: `useApartments()`, `useSaveApartment()`, `useDeleteApartment()`, `useResidents(apartmentId?)`, `useSaveResident()`, `usePendingProfiles()`, `useApproveProfile(): (args:{userId; residentId; role}) => Promise<void>`.

- [ ] Step 1: Write the failing test: UsersPage lists pending profiles, and approving calls `update profiles set status='approved', resident_id, role` with the chosen values.
- [ ] Step 2: Run it. Expected: FAIL.
- [ ] Step 3: Implement.
  - ApartmentsPage (admin): list sorted by number, add, edit, delete with a confirm dialog.
  - DirectoryPage (everyone): residents grouped by apartment, with `tel:` links.
  - UsersPage (admin): approve, change role.
  - Forms use `@mantine/form` with validation: phone matches `/^0\d{1,2}-?\d{7}$/`, apartment number > 0.
- [ ] Step 4: Run the tests. Expected: PASS. Then commit (`feat: tenants`).

### Task 5: הודעות — announcements

**Files:** Create `supabase/migrations/0002_announcements.sql`, `supabase/tests/announcements.test.sql` and `src/features/announcements/*`.

**Interfaces:**
- Produces SQL: `announcements(title, body, pinned bool, expires_at date null, author_id)` and `announcement_reads(announcement_id, user_id, pk(both))`.
- Produces TS: `useAnnouncements()` returns non-expired items sorted pinned first then newest, with `isRead`; also `useMarkRead()` and `useSaveAnnouncement()`.

- [ ] Step 1: Write the failing pgTAP tests:
  - a resident can select announcements but not insert them
  - a resident can insert an `announcement_reads` row only with their own `user_id`
- [ ] Step 2: Run `npx supabase test db`. Expected: FAIL.
- [ ] Step 3: Write the migration.
- [ ] Step 4: Run the tests. Expected: PASS.
- [ ] Step 5: Build the UI.
  - Write a Vitest for the sort and filter helper `visibleAnnouncements(list, today)`: expired items are hidden, pinned items come first, newest next.
  - Unread badge on the nav tab.
  - Admin form.
- [ ] Step 6: Commit (`feat: announcements`).

### Task 6: קריאות ותקלות — service calls

**Files:** Create `supabase/migrations/0003_tickets.sql`, `supabase/tests/tickets.test.sql` and `src/features/tickets/*`.

**Interfaces:**
- Produces SQL:
  - `tickets(title, description, location, status text check in ('open','in_progress','closed') default 'open', opened_by uuid default auth.uid(), vendor text null)`
  - `ticket_comments(ticket_id, author_id default auth.uid(), body)`
  - `ticket_photos(ticket_id, path)`
  - private storage bucket `ticket-photos`
- Produces TS: `useTickets(status?)`, `useTicket(id)`, `useCreateTicket()` (uploads photos, then inserts rows), `useUpdateTicket()` (admin), `useAddComment()`.

- [ ] Step 1: Write the failing pgTAP tests:
  - an approved resident can insert a ticket, and `opened_by` is forced to `auth.uid()` by a `with check`
  - a resident can't update `status` (only an admin can)
  - a resident can comment on any ticket
  - a pending user can't insert
  - storage policy: approved users can upload to and read from `ticket-photos`, only image mimetypes, under 5 MB (bucket `file_size_limit`, `allowed_mime_types`)
- [ ] Step 2: Run the tests. Expected: FAIL.
- [ ] Step 3: Write the migration.
- [ ] Step 4: Run the tests. Expected: PASS.
- [ ] Step 5: Build the UI.
  - List with status chips (פתוחה / בטיפול / סגורה).
  - Detail page with comments and photos (via `createSignedUrl`, 1 hour).
  - Mobile form with `<input type="file" accept="image/*" capture="environment" multiple>`.
- [ ] Step 6: Commit (`feat: service calls`).

### Task 7: משימות תחזוקה — maintenance tasks

**Files:** Create `supabase/migrations/0004_maintenance.sql`, `supabase/tests/maintenance.test.sql`, `src/features/maintenance/*` and `src/features/maintenance/nextDue.test.ts`.

**Interfaces:**
- Produces SQL:
  - `maintenance_tasks(title, vendor, frequency text check in ('once','monthly','quarterly','yearly'), next_due date null)`
  - `maintenance_log(task_id, done_on date, note, cost numeric null, expense_id uuid null)`
  - one seed task per item in the spec's §5.4 list
- Produces TS: `nextDue(doneOn: string, frequency: Frequency): string | null`, `dueBucket(nextDue: string|null, today: string): 'overdue'|'soon'|'later'|'none'` (soon means within 30 days), `useTasks()`, `useMarkDone()`.

- [ ] Step 1: Write the failing tests:
  - `nextDue('2026-01-31','monthly') === '2026-02-28'` (clamped to month end)
  - `nextDue('2026-03-15','quarterly') === '2026-06-15'`
  - `nextDue('2026-03-15','yearly') === '2027-03-15'`
  - `nextDue(x,'once') === null`
  - `dueBucket('2026-10-01','2026-10-23') === 'overdue'`, `dueBucket('2026-11-10','2026-10-23') === 'soon'`
  - pgTAP: admin-only write, approved read
- [ ] Step 2: Run them. Expected: FAIL.
- [ ] Step 3: Implement.
  - `useMarkDone` inserts a log row, updates `next_due`, and, if a cost was entered, inserts an `expenses` row (once Task 9 exists; until then hide the cost field).
  - The UI groups tasks by `dueBucket`.
- [ ] Step 4: Run the tests. Expected: PASS. Commit (`feat: maintenance tasks`).

### Task 8: Home dashboard

**Files:** Modify `src/features/home/HomePage.tsx`.

**Interfaces:**
- Consumes: `useAnnouncements`, `useTickets('open')`, `useTasks`, and (after Task 9) `useMyBalance` / `useBalances`.

- [ ] Step 1: Build four cards:
  - latest 3 announcements
  - open calls count
  - overdue/soon maintenance
  - balance card: residents see their own balance, admins see the debtors count and total (filled in after Task 9)
- [ ] Step 2: Check visually at 375px and 1280px. Commit (`feat: home dashboard`).

### Task 9: Finance schema — fees, charges, payments, expenses, budgets, balances

**Files:** Create `supabase/migrations/0005_finance.sql` and `supabase/tests/finance.test.sql`.

**Interfaces:**
- Produces tables:
  - `fee_schedule(amount, effective_from date)` (first of month)
  - `apartment_fee_overrides(apartment_id, amount, effective_from)`
  - `charges(apartment_id, month date, amount numeric(12,2), kind text check in ('levy','extra','opening'), label text, source text default 'manual')`. Only `opening` may be negative.
  - `payments(apartment_id, paid_on date, amount, method text check in ('cash','transfer','cheque','app','other'), note, source text check in ('manual','import') default 'manual')`
  - `expense_categories(name unique per building)`
  - `expenses(category_id, spent_on date, amount, vendor, note, receipt_path, source)`
  - `expense_templates(category_id, amount, vendor, label)`
  - `budgets(year int, category_id, amount, unique(year,category_id))`
  - a seed for categories from spec §5.5
- Produces views, all `with (security_invoker = true)`:
  - `monthly_fees(apartment_id, month, amount)`: `generate_series(buildings.billing_start, date_trunc('month', now()), '1 month')` × apartments. Amount is the latest override with `effective_from <= month`, else the latest `fee_schedule` with `effective_from <= month`.
  - `apartment_ledger(apartment_id, month, charged, paid)`: monthly_fees + charges + payments grouped by `date_trunc('month', paid_on)`.
  - `apartment_balances(apartment_id, charged, paid, balance)`.
  - `building_cash(balance)`: `opening_cash` + payments − expenses since `opening_cash_date`.
- RLS: `charges`, `payments` and `apartment_fee_overrides` can be selected `using (is_admin() or apartment_id = my_apartment_id())`. Everything else is approved-read / admin-write. The views inherit this through security_invoker.

- [ ] Step 1: Write the failing pgTAP tests:
  - Fee change: with billing_start 2026-01-01, fee 390 from 2026-01-01 and 330 from 2026-07-01, apt 1's `monthly_fees` shows 390 for 2026-06 and 330 for 2026-07.
  - An override of 270 from 2026-08 wins for 2026-08.
  - Balance: apt with fees Jan–Mar = 1170, one payment of 2340 in Feb → `apartment_balances.balance = -1170` (credit).
  - Isolation: resident of apt 1 selecting `payments`, `charges`, `apartment_balances` or `apartment_ledger` sees only apt 1 rows. A pending user sees 0 rows.
  - Opening charge of −200 allowed; a levy of −1 rejected.
  - A resident can select `expenses` and `building_cash` but can't insert expenses.
- [ ] Step 2: Run `npx supabase test db`. Expected: FAIL.
- [ ] Step 3: Write the migration.
- [ ] Step 4: Run the tests. Expected: PASS.
- [ ] Step 5: Regenerate types, then commit (`feat: finance schema`).

### Task 10: Finance UI

**Files:** Create `src/features/finance/*`. Test: `src/features/finance/ledger.test.ts`.

**Interfaces:**
- Consumes: the Task 9 views and tables.
- Produces: `toLedgerGrid(rows: LedgerRow[], year: number): { months: string[]; byApartment: Map<string, {cells: {charged:number; paid:number}[]; balance:number}> }`, `budgetVsActual(budgets, expenses, year): {category:string; planned:number; actual:number}[]`, and hooks `useBalances()`, `useMyBalance()`, `useLedger(year)`, `useSavePayment()`, `useExpenses(year)`, `useSaveExpense()`, `useApplyTemplates(month)`, `useBudgets(year)`, `useSaveCharge()`, `useFeeSchedule()`.

- [ ] Step 1: Write the failing tests:
  - `toLedgerGrid` fills 12 months, with zeros for months without rows
  - `budgetVsActual` sums expenses per category in that year only, and lists budgeted categories with no expenses as actual 0
- [ ] Step 2: Run them. Expected: FAIL.
- [ ] Step 3: Implement the pages.
  - Admin "כספים": tabs for יתרות (debtors highlighted in red, sorted by debt), תשלומים (add a payment), חיובים (fee schedule, overrides, levy to all or chosen apartments, extra and opening charges), הוצאות (list, add, "apply recurring templates to month", receipt upload to private bucket `receipts`), תקציב (budget vs actual, building cash).
  - Resident "כספים": own ledger grid, own balance, building expense totals by category, building cash.
- [ ] Step 4: Run the tests. Expected: PASS.
- [ ] Step 5: Fill in the Task 8 balance card. Commit (`feat: finance UI`).

### Task 11: Excel import

**Files:** Create `src/features/import/{parseWorkbook.ts,buildImport.ts,ImportPage.tsx,api.ts,fixture.ts}`, `supabase/migrations/0006_import.sql` and `supabase/tests/import.test.sql`. Test: `src/features/import/parseWorkbook.test.ts`.

**Interfaces:**
- Produces:
  - `type ColumnMap = { col: number; header: string; proposal: { kind:'month'; month:string } | { kind:'levy'; month:string|null } | { kind:'ignore' }; warning?: 'duplicate'|'unrecognized' }`
  - `parseIncomeSheet(rows: unknown[][]): { year:number; columns: ColumnMap[]; apartments: {number:number; name:string; phone:string; cells: Record<number, number>}[]; ev: {apartment:number; byMonth: Record<string, number>}[]; warnings:string[] }`
  - `parseExpensesSheet(rows: unknown[][], year:number): { category:string; byMonth: Record<string, number> }[]`
  - `parseBudgetSheet(rows: unknown[][]): { year:number; items:{category:string; amount:number}[] }`
  - `buildImport(parsed, confirmedColumns: ColumnMap[], feeSchedule:{amount:number; effective_from:string}[]): ImportPayload` (payload = apartments, residents, payments, charges, expenses, categories, budgets, year)
  - SQL `import_year(payload jsonb) returns jsonb` (counts): `SECURITY DEFINER`, checks `is_admin()`, runs in one transaction, deletes that year's `source='import'` payments, charges and expenses, upserts apartments by number and categories by name, then inserts.
- Header rules:
  - A number between 40000 and 60000 is an Excel serial → convert to `'YYYY-MM'`.
  - A Hebrew month name → that month in the sheet's year (the year comes from the majority of the serials).
  - `'סה"כ'` or empty → ignore.
  - A second column for the same month → `warning:'duplicate'`, `proposal: {kind:'levy', month: null}`.
  - EV block: the header row with Hebrew months to the right of the total column, labeled by a cell containing `'טעינה'`.
  - A cell that is empty, 0 or non-numeric is skipped. A non-numeric cell also adds a warning.

- [ ] Step 1: Write `fixture.ts`: a 2D array with the same layout as the real income sheet. Header row: serials 46023…46204, `'אוגוסט'`, `'אוקטובר'`, 46266, 46296, 46327, `''`, 46357, `'סה"כ'`. Three invented apartments (`'דייר א'`, phone `'050-0000001'`…), one with a 2340 cell and an EV block. Add an expenses fixture and a budget fixture. No real data.
- [ ] Step 2: Write the failing tests:
  - year is 2026
  - the col for 46023 maps to `'2026-01'`, `'אוגוסט'` to `'2026-08'`, 46266 to `'2026-09'`
  - the `'אוקטובר'` column before 46296 has `warning:'duplicate'` and a levy proposal
  - the empty and `'סה"כ'` columns are ignored
  - a 0 cell creates no payment
  - EV byMonth for the EV apartment sums correctly
  - `buildImport` gives each payment `paid_on` = first of month and `source:'import'`, puts the levy column into a `charges` row of kind levy per apartment, and makes the EV entries into extra charges equal to the paid amounts
- [ ] Step 3: Run `npx vitest run src/features/import`. Expected: FAIL.
- [ ] Step 4: Implement the parsers as pure functions with no SheetJS import. `ImportPage` lazy-imports `xlsx`, reads sheets by name (`הכנסות`, `הוצאות`, `עלויות שנתיות מתוכננות`), and calls `sheet_to_json(ws, {header:1, raw:true})`.
- [ ] Step 5: Run the tests. Expected: PASS.
- [ ] Step 6: Write the failing pgTAP test: calling `import_year` twice with the same payload leaves the payments, charges and expenses counts unchanged, and a resident calling it gets an exception. Implement `0006_import.sql`. Run the tests. Expected: PASS.
- [ ] Step 7: Build `ImportPage` (admin): upload → column-mapping table with editable proposals → fee-schedule inputs (prefilled: ₪390 from the first month) → preview counts and warnings → confirm → `rpc('import_year')` → success summary.
- [ ] Step 8: Manual test with the real workbook in the running app (from `~/Downloads`, never copied into the repo). Commit (`feat: excel import`).

### Task 12: Keep-alive, README setup guide, security pass

**Files:** Create `.github/workflows/keepalive.yml`. Modify `README.md`.

- [ ] Step 1: Add `keepalive.yml`, which runs `schedule: '0 6 */3 * *'` and on `workflow_dispatch`, and does `curl -fsS "$VITE_SUPABASE_URL/rest/v1/apartments?select=id&limit=1" -H "apikey: $VITE_SUPABASE_ANON_KEY"`. RLS returns `[]` and the request still counts as activity.
- [ ] Step 2: Add a Content-Security-Policy `<meta>` in `index.html` (`default-src 'self'; connect-src 'self' https://<ref>.supabase.co wss://<ref>.supabase.co; img-src 'self' data: blob: https://<ref>.supabase.co; style-src 'self' 'unsafe-inline'`). Check that the app still works.
- [ ] Step 3: README: setup steps (Supabase project, bootstrap admin SQL, Google OAuth, GitHub secrets and variables, enabling Pages), local dev, and how to run DB tests.
- [ ] Step 4: Run the `security-review` skill on the branch and fix the findings.
- [ ] Step 5: Commit (`chore: keepalive, CSP, setup docs`) and deploy. Confirm the live URL loads and Google login round-trips.
