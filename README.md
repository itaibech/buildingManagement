# Building Management · ניהול בניין

A Hebrew-first (RTL) web app for running a residential building's committee
(ועד בית): tenants, announcements, service calls, maintenance and finances, all in
one place, on phone and desktop. It's inspired by Hombi, Bllink and Darimpo.

> Status: design approved, implementation in progress.
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

## Stack

All of it runs on free tiers.

- **Frontend:** React + TypeScript + Vite, hosted on GitHub Pages
- **Backend:** Supabase (Postgres, Auth, Storage). There's no custom
  server; security is enforced with Postgres Row Level Security
- **CI/CD:** GitHub Actions runs lint, type checks, tests and the build, then
  deploys to Pages and applies the DB migrations

## Live site

https://itaibech.github.io/buildingManagement/ (once the first deploy runs)

## Development

Requires Node 22 and Docker (for the local Supabase stack).

```bash
npm install
npm run db:start            # local Postgres, Auth, Storage; Studio at http://127.0.0.1:54323
cp .env.example .env.local  # then paste the anon key from `npx supabase status`
npm run db:reset            # re-applies migrations + supabase/seed.sql
npm run dev                 # http://localhost:5173/buildingManagement/
```

Local test accounts (seeded, local only, password `password123`):
`admin@example.test` (approved admin) and `resident@example.test`
(approved resident of apartment 1). Email confirmation is off locally.

Other scripts: `npm run db:test` (pgTAP tests in `supabase/tests`),
`npm run db:types` (regenerate `src/lib/db.types.ts`), `npm run db:stop`.

Migrations live in `supabase/migrations` and are applied to the hosted
project by the deploy workflow on push to `main`. The hosted bootstrap admin
email is set once outside the repo:
`insert into app_settings values ('bootstrap_admin_email', '<email>')`.

## License

[MIT](LICENSE)
