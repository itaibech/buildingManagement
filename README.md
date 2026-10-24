# Building Management · ניהול בניין

A Hebrew-first (RTL) web app for running a residential building's committee
(ועד בית): tenants, announcements, service calls, maintenance and finances, all in
one place, on phone and desktop. It's inspired by Hombi, Bllink and Darimpo.

> Status: phase 1 complete.
> Design: [docs/superpowers/specs/2026-10-23-building-management-design.md](docs/superpowers/specs/2026-10-23-building-management-design.md)

## Features (phase 1)

| | Feature | What it does |
|---|---|---|
| 1 | **דיירים** Tenants | Apartments, residents and the building directory. Admins approve new users and link each one to an apartment |
| 2 | **הודעות** Announcements | Committee posts with pinning, expiry dates and unread markers |
| 3 | **קריאות ותקלות** Service calls | Residents report faults with photos and comments. Admins track each call: open → in progress → closed |
| 4 | **משימות תחזוקה** Maintenance | Recurring tasks (elevator, fire safety, backflow preventers…) with due dates and a done log |
| 5 | **הכנסות והוצאות** Finance | Monthly fees, levies, payments, debts per apartment, expenses by category, and budget vs actual |
| 6 | **ייבוא מאקסל** Excel import | Imports the committee's existing payments and expenses workbook |

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
   and publish GitHub Pages.
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
