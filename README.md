# Building Management · ניהול בניין

A Hebrew-first (RTL) web app for running a residential building's committee
(ועד בית): tenants, announcements, service calls, maintenance and finances, all in
one place, on phone and desktop. It's inspired by Hombi, Bllink and Darimpo.

> Status: phase 1 complete.
> Design: [docs/superpowers/specs/2026-10-23-building-management-design.md](docs/superpowers/specs/2026-10-23-building-management-design.md)

## Features (phase 1)

| | Feature | What it does |
|---|---|---|
| 1 | **דיירים** Tenants | Apartments, residents and the building directory. Admins approve new users and link each one to an apartment. Each apartment has one admin page with everything about it. See [Apartments and users](#apartments-and-users-דירות-ומשתמשים) |
| 2 | **הודעות** Announcements | Committee posts with pinning, expiry dates and unread markers |
| 3 | **קריאות ותקלות** Service calls | Residents report faults with photos and comments. Admins track each call: open → in progress → closed |
| 4 | **משימות תחזוקה** Maintenance | Recurring tasks (elevator, fire safety, backflow preventers…) with due dates and a done log |
| 5 | **הכנסות והוצאות** Finance | Monthly fees, levies, payments, debts per apartment, expenses by category, and budget vs actual |
| 6 | **ייבוא מאקסל** Excel import | Imports the committee's existing payments and expenses workbook |
| 7 | **מיילים** Email | Admins email an announcement or a service call to all or chosen apartments, and personalised debt reminders (one apartment or every debtor). See [Email setup](#email-setup) |
| 8 | **ישיבות ועד** Meetings | Formal committee meetings and tenants' assemblies: invitation (or an immediate start), quorum with a one-hour postponement or an explicit no-quorum opening, attendance with proxies, votes and numbered decisions, signatures, a printable protocol and an archive. See [Meetings](#meetings-ישיבות-ועד) |

**Roles:** *admin* (committee, full access) and *resident* (read-only, plus
opening service calls). A resident sees only their own apartment's finances.

**Sign-in:** Google, or email and password. New users wait for an admin's approval.

## הסדרת חוב, חיובים מיוחדים וחישובים מחדש

From the apartment ledger sheet (כספים → apartment), admins can:
- **הסדרת חוב** (`settle_debt`). Choose open months, then either "התקבל תשלום" (one payment per month) or "מחיקת חוב" (a negative `adjustment` charge with a reason; no money moves and building cash is unchanged).
  - The server computes each month's open amount: charged − paid, oldest first, capped by the balance.
  - Months from past years default to today's date, so the money lands in this year's cash and reports. Each payment still settles its own month (`payments.for_month`).
- **חיוב מיוחד** (`add_special_charge`). A one-off charge, optionally already paid and/or also a building expense, all linked by `special_id`.
- **Undo** (both confirmed): "ביטול מחיקת חוב" (`undo_settlement`) and "ביטול חיוב מיוחד" (`undo_special_charge`, which also removes the linked payment, the expense and its receipt file).

**Recomputes can reopen a settled month.** A settlement fixes amounts at the time it runs. These change a month's charge afterwards:
- an EV rate change or a corrected meter reading (EV charges are recomputed)
- a retroactive fee change (`set_apartment_fee`, the building fee)
- an Excel re-import of that year

After such a change, a settled month can show a small open amount again, or a credit, if the charge went down. The balance is always charges − payments, so nothing is lost; the month just needs attention:
- **Open again:** settle it again ("הסדרת חוב" offers only what is still open).
- **Over-credited by a write-off:** undo that write-off ("ביטול מחיקת חוב"), then settle the remaining amount.
- **Over-credited by a settlement payment:** delete that payment in "תשלומים", then settle again.

The import preview warns when the target year contains settlements.

## Apartments and users (דירות ומשתמשים)

**The apartment page** (`#/apartments/:id`, admins only) holds everything about one apartment, in tabs on desktop and a stacked accordion on mobile. Each section loads when opened:
סקירה (balance with its breakdown, current fee and its source, payment method, badges, the charger's last reading, and quick actions: רישום תשלום, חיוב מיוחד, הסדרת חוב, שליחת תזכורת חוב, עריכה) · תשלומים (by year, with source and totals) · חיובים ויתרה (the month-by-month ledger; "לכרטסת" opens it) · דמי ועד (the fee timeline) · טעינת רכב (only with a charger) · דיירים · קריאות שירות (opened by its residents) · ישיבות (attendance in published protocols) · היסטוריה (`admin_audit` and emails sent to it).

**Deleting an apartment** ("מחיקה") first shows what it holds. With no history it is simply deleted. With history:
- **העברה לארכיון** (recommended, `archive_apartment`): hidden from lists, balances, collection, meeting quorums and email recipients; the archive month is still billed and counted in collection, and monthly fees (and standing orders) stop from the month after; past months stay in reports and the year export. It's listed under "ארכיון" on the apartments page and restored from its page (`restore_apartment`), which writes the archived months into the fee timeline as exempt and resumes the previous fee from the restore month, so nothing is billed for the gap.
- **מחיקה לצמיתות כולל כל ההיסטוריה** (`delete_apartment_cascade`): the admin types the apartment number. Payments, charges, fee timeline, billing, EV, residents (their logins stay, unlinked) and attendance in unfinished meetings go in one transaction. Kept, and listed in the dialog: attendance in closed protocols (by apartment number), tickets (they belong to their openers), building expenses, and the email and audit logs.

**Deleting a user** (משתמשים → ⋯ → מחיקת משתמש) calls the Edge Function `admin-delete-user` (it needs the service role for `auth.admin.deleteUser`). It checks the caller is an admin and refuses the super admin and yourself. The login and profile go; the resident record stays unless "גם להסיר את הדייר" is ticked. Authorship columns are `on delete set null`, so history stays. Archive, restore, deletes and user deletions are logged in `admin_audit` (admins read it).

**Standing orders never double-pay** (0022): a standing-order month's automatic payment is the fee minus that month's imported or manual fee payments (EV-noted, settlement and special-charge payments don't count). A fully paid month has no automatic row, and any later payment write re-syncs.

## Meetings (ישיבות ועד)

Admins open **עוד → ישיבות ועד**. Tabs: קרובות (draft, invited, in progress), ממתינות לפרסום (closed) and ארכיון (published, searchable by subject, decision text and year). Every state change goes through an admin-only RPC in `0021_meetings.sql`, and triggers lock edits by state.

1. **Draft.** Type (ישיבת ועד / אסיפת דיירים כללית), subject, date and time, place, the agenda (add, remove, reorder) and the quorum rule: ללא דרישת מניין (default for a ישיבת ועד), more than half of the apartments (default for an assembly), a % or a fixed number, with a "לפי התקנון" note.
2. **שליחת זימון.** Posts a pinned announcement until the meeting date (it links to the meeting) and can email everyone (`send-email`, kind `meeting`). Under 5 days ahead, the app warns "לפי חוק המקרקעין יש להודיע 4–5 ימים מראש" and asks for a confirmation (the RPC refuses without it). After the invitation the details can still change, then **עדכון זימון** re-announces them. Every change is logged in the meeting's history.
3. **ניהול הישיבה** (the live screen, built for a phone):
   - Attendance per apartment: נוכח / ייפוי כוח / נעדר, the attendee's name or the proxy holder (and the proxy form). A live meter shows "נוכחות: X מתוך N דירות · נדרש מניין: R".
   - Without a quorum: **דחיית האסיפה בשעה** (an hour from the later of now and the scheduled time). After that the meeting may open with any attendance, and the protocol says so. The screen shows when (with the day when it isn't today) and the wait in hours and minutes. **ביטול הדחייה** undoes a postponement made by mistake.
   - Once the quorum is met, a postponement no longer holds the opening back.
   - **פתיחה ללא מניין**: open now without a quorum (also skipping a postponement's wait; not offered once the postponed time has passed) after ticking "ידוע לי שהחלטות שיתקבלו ללא מניין חוקי עלולות שלא להיות מחייבות". It is logged and stated in the protocol.
   - The rule **ללא דרישת מניין** (the default for a ישיבת ועד) opens at once. Attendance doesn't have to be filled in before opening.
   - **פתיחת ישיבה מיידית** (from the list or a draft) skips the invitation and opens now; the protocol says "הישיבה התקיימה ללא זימון מוקדם", and a tenants' assembly gets a warning.
   - Attendance stays editable during the meeting: late arrivals and departures get their time, shown live and in the protocol. Each vote is checked against the attendance when it was entered (`attendees_at_vote`).
   - Opening needs a chair and a recorder. Then, per item: discussion summary, בעד / נגד / נמנעו (the total can't exceed the attendees, proxies included; "פה אחד" fills it in), the decision wording and its number. Items can be marked ירד מסדר היום / נדחה לישיבה הבאה, and items can be added during the meeting.
   - Everything autosaves. Changes are kept on the device while offline and sync when the connection returns.
4. **סיום הישיבה** records the closing time and the absent apartments, and numbers the decisions. From then on attendance, items and votes are locked; corrections go in a **תיקון לפרוטוקול**, printed as an appendix.
5. **חתימות.** The chair and the recorder each sign on the screen (stored as a PNG in the private `meeting-files` bucket), or a scanned signed protocol is uploaded. Attendees may add signatures.
6. **פרסום הפרוטוקול** (needs both signatures) posts an announcement linking to the protocol, can email everyone, and moves the meeting to the archive (read-only, files kept). A closed meeting left unpublished for more than 3 days shows a reminder.

**Residents** with the `meetings` permission ("ישיבות ופרוטוקולים", on for the default group "דייר" because the law requires publishing to all members) see invitations and published protocols, with print. RLS hides drafts, the live meeting and unpublished protocols.

**Protocol print.** "הדפסה / PDF" prints the protocol alone on A4 (file name `פרוטוקול-<date>`). Word export is not included.

## Stack

All of it runs on free tiers.

- **Frontend:** React + TypeScript + Vite, hosted on GitHub Pages
- **Backend:** Supabase (Postgres, Auth, Storage). There's no custom
  server; security is enforced with Postgres Row Level Security
- **CI/CD:** GitHub Actions runs lint, type checks, tests and the build, then
  deploys to Pages and applies the DB migrations

## Live site

https://itaibech.github.io/buildingManagement/ (once the first deploy runs).
On a phone, use the browser's "Add to Home Screen" (הוספה למסך הבית) to install it like an app.

## Hosted setup (one time)

The Supabase project (ref `kttyozquueaoacrwbnmx`) already exists. The remaining steps, in order:

### 1. GitHub secrets and variables

Repo → Settings → Secrets and variables → Actions.

| Kind | Name | Value | Used by |
|---|---|---|---|
| Secret | `SUPABASE_ACCESS_TOKEN` | A personal access token (supabase.com → Account → Access Tokens) | `deploy.yml` (migrate) |
| Secret | `SUPABASE_DB_PASSWORD` | The project's database password | `deploy.yml` (migrate) |
| Secret | `SUPABASE_PROJECT_REF` | `kttyozquueaoacrwbnmx` | `deploy.yml` (migrate) |
| Variable | `VITE_SUPABASE_URL` | `https://kttyozquueaoacrwbnmx.supabase.co` | `deploy.yml` (build), `keepalive.yml` |
| Variable | `VITE_SUPABASE_ANON_KEY` | The project's **anon / publishable** key (Settings → API) | `deploy.yml` (build), `keepalive.yml` |

Only the anon key ships to the browser; it's public by design, and RLS is the security boundary.
**Never** put the `service_role` / secret key in a variable, in `.env*`, or anywhere in the app.

### 2. GitHub Pages

Repo → Settings → Pages → Build and deployment → Source: **GitHub Actions**. The `github-pages`
environment (created by the first deploy) should only allow the `main` branch.

### 3. First deploy (applies the migrations)

Merge to `main` (see [Deploy flow](#deploy-flow)). `deploy.yml` builds the site, runs
`supabase db push` against the hosted project, then publishes Pages.

### 4. Bootstrap the super admin

Automatic: migration `0013_bootstrap_admin.sql` sets the `bootstrap_admin_email` app setting to
`itai.bechor@gmail.com` (it doesn't overwrite a value that is already set). Only if you need another
address, or the setting is missing, set it manually in Supabase → SQL Editor (fallback):

```sql
insert into public.app_settings (key, value)
values ('bootstrap_admin_email', 'itai.bechor@gmail.com')
on conflict (key) do update set value = excluded.value;
```

The first **Google** sign-in with that email (while no admin exists yet) becomes the approved **super
admin**, whom nobody can demote, block or delete. An email/password sign-up with the same address does
not; the grant needs Google, which has verified the address. Every other new user waits for an admin's
approval. Sign in with Google right after the first deploy, before sharing the site URL.

If that account had already signed in before the setting existed (so it's a pending resident), promote
it once from the SQL Editor (it runs as `postgres`, which the profile guards allow). First check
Authentication → Users: if that user has an **email** identity you didn't create, delete that identity
(or the whole user, and sign in with Google again). The SQL only promotes a user who has a Google
identity:

```sql
update public.profiles p set role = 'admin', status = 'approved', is_super_admin = true
where lower(p.email) = 'itai.bechor@gmail.com'
  and exists (select 1 from auth.identities i where i.user_id = p.user_id and i.provider = 'google');
```

### 5. Auth settings

Supabase → Authentication:

- **URL Configuration:** Site URL `https://itaibech.github.io/buildingManagement/`. Redirect URLs:
  just that URL. Don't add `localhost` URLs to the hosted project; local development uses the local stack.
- **Providers → Email:** keep **Confirm email** ON (the Supabase default). With it off, anyone could
  sign up with the owner's address (auto-confirmed) before the owner does; the owner's later Google
  sign-in would then be linked into that attacker-created account (pre-account takeover). With it on,
  GoTrue drops unverified email identities when a verified Google identity signs in with the same
  address. A minimum password length of 8 or more is recommended.
- **Mail delivery:** Supabase's built-in mailer is for testing only: heavily rate-limited, and it only
  delivers to the project's team-member addresses. Until custom SMTP is set up, residents should sign in
  with **Google** (the login page recommends it). Email/password sign-up, confirmation and password
  reset ("שכחת סיסמה?") work for everyone once custom SMTP is configured: create a free account at
  Resend or Brevo, verify a sender, then Supabase → Authentication → SMTP Settings → enable custom SMTP
  and enter the host, port, user, password and sender. The reset link lands on the Site URL above, so no
  extra redirect URL is needed.

### 6. Google sign-in

1. Google Cloud Console → APIs & Services → OAuth consent screen: app name "ניהול בניין", user type
   External, scopes `email`, `profile`, `openid` only.
2. Credentials → Create credentials → OAuth client ID, type **Web application**.
   - Authorized JavaScript origins: `https://itaibech.github.io`
   - Authorized redirect URIs: `https://kttyozquueaoacrwbnmx.supabase.co/auth/v1/callback`, and for
     local testing `http://127.0.0.1:54321/auth/v1/callback`
3. Supabase → Authentication → Providers → Google: enable it and paste the client ID and secret.

The Google button only shows when Google is enabled on the Supabase instance. It's off on the local
stack by default. To enable it locally, put `SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_ID` and
`SUPABASE_AUTH_EXTERNAL_GOOGLE_SECRET` in the git-ignored `supabase/.env` and set `enabled = true` under
`[auth.external.google]` in `supabase/config.toml` (don't commit that change).

### 7. Keep-alive

Free-tier projects pause after a week without activity. `.github/workflows/keepalive.yml` runs every
3 days (and on demand: Actions → Keep-alive → Run workflow) and makes one anon REST read, which RLS
answers with `[]`. Scheduled workflows only run from the default branch, so it starts after the first
merge to `main`. GitHub disables schedules after 60 days without repo activity; re-enable it there if so.

## Email setup

Admins send email from the app: **"שליחה במייל"** on an announcement (its ⋯ menu) or a service call, **"שליחת
תזכורת חוב"** in an apartment's ledger, **"תזכורת לכל החייבים"** on the **יתרות** tab, and **"שליחת מייל בדיקה"**
on **עוד → הגדרות בניין** (with the **"היסטוריית מיילים"** list). Every email goes out one recipient at a time
(no one sees other residents' addresses) from the Supabase Edge Function `supabase/functions/send-email`. The
browser never holds mail credentials, and the function checks that the caller is an admin.

Until a provider is configured the function runs in **dry run**: it prepares the emails, logs them and records
them in the history, but sends nothing. The app then shows **"שליחת מיילים טרם הוגדרה (מצב בדיקה)"**.

CI deploys the function on every push to `main`, but it never sets its secrets. You set them once, by hand,
with one of the two options below. Supabase Edge Functions block outbound SMTP, so both options send over HTTPS.

### Option A: Gmail through Google Apps Script (free, no domain needed)

1. Sign in to the sending Gmail account, e.g. `vaad.havatzelet6@gmail.com`. A dedicated account for the committee is
   recommended over a personal one.
2. Go to [script.google.com](https://script.google.com) and click **New project**. Replace the editor's contents
   with [`docs/email/apps-script.gs`](docs/email/apps-script.gs). In the line `var TOKEN = 'CHANGE_ME';`, replace
   `CHANGE_ME` with a long random string you generate yourself, for example the output of `openssl rand -hex 32`.
   Keep it private: it is what stops strangers from sending mail through your account. Save the project.
3. Click **Deploy → New deployment**, and pick the type **Web app**. Set **Execute as: Me** and **Who has access:
   Anyone**, then **Deploy**. Google asks you to authorize the script: choose the account, then **Advanced → Go to
   (project name) (unsafe)** (the warning appears because the script is yours and unverified), and **Allow**.
   Copy the **Web app URL** (it ends in `/exec`).
4. On your computer (not in a chat or an issue), run once:
   ```bash
   npx supabase secrets set --project-ref kttyozquueaoacrwbnmx \
     EMAIL_PROVIDER=appsscript \
     APPS_SCRIPT_URL='<web app URL>' \
     APPS_SCRIPT_TOKEN='<the token from step 2>' \
     EMAIL_FROM_NAME="ועד הבית חבצלת השרון 6"
   ```
   (`npx supabase login` first if the CLI asks for it.)
5. In the app, open **עוד → הגדרות בניין** and press **"שליחת מייל בדיקה"**. The email arrives at the address in
   your own profile, and the history shows it without the **מצב בדיקה** badge.

### Option B: Resend (when you own a domain)

1. Create an account at [resend.com](https://resend.com).
2. Under **Domains**, add your domain and add the DNS records Resend shows at your registrar. Wait until the domain
   shows **Verified**.
3. Under **API Keys**, create a key with sending access.
4. Run once:
   ```bash
   npx supabase secrets set --project-ref kttyozquueaoacrwbnmx \
     EMAIL_PROVIDER=resend \
     RESEND_API_KEY='<key>' \
     EMAIL_FROM="ועד הבית <vaad@yourdomain>"
   ```
5. Press **"שליחת מייל בדיקה"** in the app.

### Settings (Supabase secrets)

| Secret | Default | Meaning |
|---|---|---|
| `EMAIL_PROVIDER` | `appsscript` | `appsscript` or `resend`. To switch providers, set the other option's secrets and change this. |
| `APPS_SCRIPT_URL`, `APPS_SCRIPT_TOKEN` | | Option A. |
| `EMAIL_FROM_NAME` | `ועד הבית` | Option A: the sender name recipients see. |
| `RESEND_API_KEY`, `EMAIL_FROM` | | Option B. `EMAIL_FROM` must be on the verified domain. |
| `EMAIL_DAILY_CAP` | `90` | The most real emails sent per day (Israel time), across all sends. |
| `EMAIL_DRY_RUN` | | `true` forces dry run even when a provider is configured. |

`npx supabase secrets list --project-ref kttyozquueaoacrwbnmx` shows which secrets are set (not their values).
Secrets take effect on the next call; no redeploy is needed.

### Limits

- A consumer Gmail account sends to about **100 recipients a day** through Apps Script; Resend's free tier allows
  100 a day and 3,000 a month. The app stops at `EMAIL_DAILY_CAP` (default 90, per building, which in phase 1 is
  the one sending account). Before sending, the dialog compares the recipients with what remains today; if they don't
  fit, the send button is disabled and it says "נותרו היום X מיילים — יש לבחור פחות נמענים או לשלוח מחר", so a send
  (even one split into several calls) doesn't start unless all of it fits.
- Each recipient is one email, sent about every half second. One call to the function sends at most 40 emails (about
  20 seconds); the app splits a larger send into several calls by apartment and shows "נשלחו X מתוך Y". Each call
  also reserves its share of the daily cap before sending, so two admins sending at once can't pass it (the second
  one gets the "remaining today" message instead of sending).
- Debt reminders skip apartments that owe nothing (the dialog lists them) and residents without an email address.

### Troubleshooting

- **Every call returns 401 after deploy** (even the test email, while signed in as an admin): the platform's JWT check
  (`verify_jwt`) doesn't accept the project's tokens, which happens with the newer asymmetric JWT signing keys. Set
  `verify_jwt = false` under `[functions.send-email]` in `supabase/config.toml` and redeploy (merge to `main`, or
  `npx supabase functions deploy send-email --project-ref kttyozquueaoacrwbnmx`). This is safe: the function still
  verifies the session itself (`auth.getUser()`) and requires `is_admin()`.
- **Still "מצב בדיקה" after setup:** a secret is missing or misspelled (`secrets list`), or `EMAIL_PROVIDER` doesn't
  match the secrets you set, or `EMAIL_DRY_RUN=true` is set.
- **Every email fails after you edited the script:** a **New deployment** gets a new URL. Either update
  `APPS_SCRIPT_URL`, or redeploy with **Deploy → Manage deployments → ✏️ → Version: New version**, which keeps the URL.
- **"unauthorized" in the failures:** `APPS_SCRIPT_TOKEN` and the script's `TOKEN` differ.
- **"daily quota exhausted" / "Service invoked too many times":** Gmail's daily quota is used up; it resets within
  24 hours. Lower `EMAIL_DAILY_CAP` if it happens often.
- **The authorization screen says "Google hasn't verified this app":** expected for your own script; use
  **Advanced → Go to …**. If you change the script to use more Google services, it asks again.
- **Resend `HTTP 403`/`422`:** the domain isn't verified yet, or `EMAIL_FROM` isn't on it.
- Function logs: Supabase dashboard → Edge Functions → `send-email` → Logs. Dry runs log each email with a masked
  address; tokens and keys are never logged.

## Development

Requires Node 22 and Docker (for the local Supabase stack).

```bash
npm install
npm run db:start            # local Postgres, Auth, Storage; Studio at http://127.0.0.1:54323
cp .env.example .env.local  # then paste the anon key from `npx supabase status`
npm run db:reset            # re-applies migrations + supabase/seed.sql (+ seed.local.sql if present)
npm run dev                 # http://localhost:5173/buildingManagement/
```

`.env.local` holds `VITE_SUPABASE_URL=http://127.0.0.1:54321` and the **local** anon key. It's
git-ignored, as are `supabase/.env` and `supabase/seed.local.sql`.

Local test accounts (seeded, local only, password `password123`):
`admin@example.test` (approved admin) and `resident@example.test`
(approved resident of apartment 1). Email confirmation is off locally.

`supabase/seed.sql` has invented sample data only (the repo is public). For your own data, use the
optional, git-ignored `supabase/seed.local.sql`; `db:reset` loads it after `seed.sql` when it exists.
Never commit real names, phone numbers or the committee's workbook.

The Content-Security-Policy is injected at build time from `VITE_SUPABASE_URL` (`vite.plugins.ts`), so
dev, preview and production each allow only their own Supabase origin. To check the production build
locally against the local stack: `npm run build && npm run preview` (http://localhost:4173/buildingManagement/).

To try email locally, serve the function in dry run (nothing is delivered):

```bash
printf 'EMAIL_DRY_RUN=true\n' > supabase/functions/.env   # git-ignored; never put real secrets in the repo
npx supabase functions serve send-email --env-file supabase/functions/.env
```

### Tests

```bash
npm test                    # unit/component tests (Vitest)
npm run lint                # oxlint
npm run typecheck           # tsc -b
npm run db:test             # pgTAP tests in supabase/tests (needs the local stack)
```

Before pushing: `npm test && npm run lint && npm run typecheck && npm run build && npm run db:reset && npm run db:test`.
`npm run db:types` regenerates `src/lib/db.types.ts` after a migration.

### Deploy flow

1. Each feature is a branch stacked on the previous one, with a PR into its parent. CI (`ci.yml`: audit,
   lint, types, tests, build, pgTAP) must pass.
2. Merge the stack down into `main`. A push to `main` runs `deploy.yml`: it first runs the whole CI
   (`ci.yml` as a reusable workflow, pgTAP included); only when that passes does it build with the repo
   variables, apply new migrations in `supabase/migrations` to the hosted project (`supabase db push`),
   deploy the `send-email` and `admin-delete-user` Edge Functions (`supabase functions deploy`, JWT verification on), and publish
   GitHub Pages.
3. Migrations are forward-only: fix a bad one with a new migration, never by editing an applied one.
   Protect `main` (Settings → Branches) so it only takes PRs with a green CI.

#### First-deploy checklist

Before merging:
- `SUPABASE_ACCESS_TOKEN`, `SUPABASE_DB_PASSWORD` and `SUPABASE_PROJECT_REF` are set as repo secrets
  (without the token, `migrate` fails and nothing is deployed).
- `supabase migration list` against the hosted project shows no history under old migration names;
  a mismatch makes `db push` refuse.
- If the direct DB host is unreachable from the runner (IPv6), switch `db push` to the session pooler with
  `--db-url`. A failure here is safe: deploy needs migrate.

Then, in this order:
1. Merge to `main`: CI, then migrations, then Pages.
2. The bootstrap email is set by migration 0013 (step 4; the SQL there is only a fallback).
3. The super admin signs in with **Google** immediately, before the URL is shared with anyone.
4. Standing orders (migration 0014) run daily through pg_cron. In the Supabase SQL editor, check that
   `select jobname, schedule from cron.job;` lists `apply-standing-orders` with `15 1 * * *`. If it's missing
   (the migration logs a WARNING when pg_cron can't be enabled), enable pg_cron (Database → Extensions) and run
   `select cron.schedule('apply-standing-orders', '15 1 * * *', 'select public.apply_standing_orders()');`.

## License

[MIT](LICENSE)
