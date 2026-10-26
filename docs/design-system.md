# Design system — "שלט הבית"

The idea: the app should feel like the building's own lobby rather than a
generic SaaS dashboard. One memorable element carries the identity: the
**Israeli enamel house-number sign**, with white numerals on deep blue, a thin
white inner border and rounded corners. It's used wherever an apartment is
identified, and nowhere else. Everything around it stays quiet.

The reference products (Hombi, Bllink, Darimpo) share some patterns that
we keep:
- a building-at-a-glance home screen
- collection rate as a percentage
- clear payment status
- one warm call-to-action color against a calm blue

We leave out their marketing-site gradients and stock photos.

## Tokens

| Token | Hex | Use |
|---|---|---|
| `enamel` | `#1F4E9C` | Primary: nav active state, primary buttons, the apartment plate |
| `ink` | `#1B2330` | Text |
| `stone` | `#6B7480` | Secondary text, icons, borders at 30% |
| `plaster` | `#F4F6F9` | App background (cool, not cream). Cards are `#FFFFFF` |
| `signal` | `#E8962E` | The single warm accent: "needs attention", due soon, unread dot, primary CTA on resident home |
| `debt` | `#C2372C` | Money owed, overdue, destructive |
| `paid` | `#2C8A5A` | Paid / closed / done |

Status mapping (never deviate):
- calls: פתוחה = `signal`, בטיפול = `enamel`, סגורה = `stone`
- maintenance: overdue = `debt`, soon = `signal`, later = `stone`
- balance: > 0 is owed (`debt`), 0 is settled (`paid`), < 0 is credit (`paid` with the label "זיכוי")
- fee source: building = `stone`, custom amount = `enamel`, exempt = `stone` (a neutral state)
- meetings: טיוטה = `stone`, זימון נשלח = `enamel`, מתקיימת / ממתינה לפרסום = `signal`, פורסם = `paid`
- budget line source: קבוע (recurring yearly default) = `enamel`, חד פעמי = `stone`
- apartment tags (`ApartmentTags`): נציג ועד = `stone`, הוראת קבע = `enamel`, עמדת טעינה = `stone` with a bolt icon
- `paid` and `debt` may also be used for success progress (e.g. the collection bar) and for destructive actions / error alerts.

## Type

Fonts are self-hosted via `@fontsource`, with no Google Fonts requests.
- **Secular One** for page titles, amounts (₪), the apartment plate, and big
  numbers. It's chunky and sign-like, with a single weight.
- **Assistant** for everything else (400 body, 600 labels and buttons). It has
  excellent Hebrew legibility at small sizes.
- Scale (rem): 0.875 caption · 1 body · 1.125 lead · 1.375 h3 · 1.75 h2 · 2.25 h1/amount.
  Body line-height is 1.55, headings 1.2.
- Numbers use `font-variant-numeric: tabular-nums` in tables and ledgers.
- Use sentence case and no all-caps labels. Don't put an eyebrow text above headings.

## Layout

```
Mobile (<768)                        Desktop (≥768)
┌──────────────────────┐            ┌───────────────────────────┬────────┐
│ ‹building›    [ 7 ]  │ header     │ content (max 1100, padded)│ nav    │
├──────────────────────┤            │                           │ (right,│
│ page title           │            │ title                     │  240px)│
│ content (16px pad)   │            │ ┌─────────┐ ┌───────────┐ │ [ 7 ]  │
│                      │            │ │ primary │ │ secondary │ │ items  │
│                      │            │ └─────────┘ └───────────┘ │        │
├──────────────────────┤            └───────────────────────────┴────────┘
│ ⌂  ✉  🔧  ₪  ⋯       │ tab bar 64px + safe-area-inset-bottom
└──────────────────────┘
```

- **Exit (יציאה)** is always one tap away. On mobile it's an icon button
  (`IconLogout`, with the label "יציאה" as its aria-label and tooltip) at the
  end of the header. On desktop it's a "יציאה" item pinned to the bottom of
  the side nav. It signs out and lands on `#/login`, with no confirm dialog.
- RTL throughout. Text is start-aligned (right). Amounts in tables are
  end-aligned so the digits line up.
- Navigation: the tab bar has the five main items; secondary pages keep "עוד" active. The desktop side
  nav adds the secondary pages directly: a "כללי" group and, for admins, a "ניהול" group.
- Home has a hierarchy, not a grid of equal cards:
  - **Resident:** the hero is their own balance as a large Secular One
    amount, with the state in words ("הכול שולם" or "יתרה לתשלום ₪660"), then
    "איך משלמים" while they owe, then the latest announcement, then their open calls (with the
    `signal` "דיווח על תקלה" button; no FAB on home).
  - **Admin:** the hero is the month's collection rate ("נגבו 14 מתוך 17
    דירות", plus a progress bar), then debtors and open calls beside maintenance due and the latest
    announcement (two columns from `md`).
- Cards: `radius 12`, `1px` border `stone/15%`, no shadow. Elevated surfaces
  (modals, menus) use one shadow. Inputs and buttons use `radius 10`. The plate
  uses `radius 6`.
- Touch targets are at least 44px. Primary actions on mobile are full-width
  at the bottom of forms, and list pages use a floating "+" FAB above the tab
  bar (admins, or residents for calls).
- Lists over tables on mobile: each row is a tappable item with the plate on
  the start side. Desktop may use tables.

## Components (in `src/ui/`)

- `AptPlate({ number, size })`: the enamel sign, in sizes `sm` (24px, inline
  in lists), `md` and `lg` (header and hero).
- `Money({ amount, tone? })`: formats with `formatILS`, Secular One, tabular
  numerals, and colours from the balance rules.
- `StatusBadge({ kind, value })`: the only place the status colour mapping
  lives.
- `PageHeader({ title, action? })`: title in Secular One, with an optional
  primary action (a FAB on mobile).
- `EmptyState({ title, body, action? })`: plain direction, such as "אין עדיין
  הודעות. מנהלי הוועד יפרסמו כאן עדכונים לבניין." Admins get the action
  button.
- `ListSkeleton`: loading uses skeleton rows, not spinners. A page's first load renders it inside the
  shell, so the header and nav never disappear.
- `DateInput`: the native date field with a Hebrew "יום/חודש/שנה" hint while empty (the OS-locale mask
  is hidden).
- `BackLink({ to, label })`: the chevron link above a detail page.
- `UnreadDot({ label })`: the `signal` dot for something not yet opened (unread announcement, call with unseen activity).
- Notification center (`features/notifications`): an `IconBell` with the unseen total, beside exit in the mobile header
  (a full-screen sheet) and in the side-nav header (a popover). Live notices are top-centre toasts with a "לצפייה"
  action, at most 3 on screen; further ones collapse into "ועוד N עדכונים".
  Badge = any unseen activity by others; toast = the interruptive subset (the rules in `notifications/rules.ts`).
- `focusFirstError`: pass as `form.onSubmit(handler, focusFirstError)`.
- Sheets: every Modal close is named "סגירה" and is 44px (theme). Short sheets use
  `FormModal compact` (centred, not full screen).
- Pages with a FAB reserve room for it at scroll end on mobile (`.bm-main:has(.bm-fab)`).
- Header secondary actions (export) show icon + short text on mobile ("ייצוא"), never an icon alone.
- Desktop side-nav header: the building name wraps to two lines (never "ה…"), beside the plate and bell; quick search
  is a field-like bar under it showing its "/" shortcut. The mobile header keeps the search icon.

## Motion and quality floor

- Motion only in response to user actions (sheet open, item marked done).
  Honor `prefers-reduced-motion`.
- Visible focus ring (`enamel`, 2px offset). AA contrast.
- Dates are DD/MM/YYYY and money is ₪ via `formatILS`.
- Copy: plain verbs, sentence case. Errors say what happened and what to do.
  An action keeps the same name throughout ("פרסום הודעה" → toast "ההודעה פורסמה").

## Icons

`@tabler/icons-react`, stroke 1.75, 22px in navigation:
- בית `IconHome2`
- הודעות `IconSpeakerphone`
- תקלות `IconTool`
- כספים `IconCoin`
- עוד `IconDots`
