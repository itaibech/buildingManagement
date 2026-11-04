/**
 * cron-reminders: the daily maintenance digest (pure request handling; no Deno or network imports, so Vitest can
 * load it). Called by pg_cron (0038) with x-cron-secret; per building and admin: what is due and not yet sent to them
 * → claim it in maintenance_reminders_log (once only) → one digest email → the claims link the email_log row, or are
 * released when that admin's email failed (the next hourly retry sends it).
 */
import { readCap } from '../../send-email/lib/cap.ts'
import { APP_URL, MAX_PER_CALL, THROTTLE_MS } from '../../send-email/lib/handler.ts'
import { fail, reply, type Reply } from '../../send-email/lib/plan.ts'
import { render, type Brand } from '../../send-email/lib/template.ts'
import type { MailMessage, Transport } from '../../send-email/lib/transport.ts'
import type { Admin, Env, Outcome } from '../../send-email/lib/types.ts'
import { looksLikeSecret, secretMatches } from './auth.ts'
import { digestContent } from './content.ts'
import { DEFAULT_SETTINGS, entryKey, israelDate, selectDue, type DueEntry, type ItemKind, type ReminderItem, type ReminderSettings } from './digest.ts'

export const KIND = 'maintenance_reminder'

/** A maintenance_reminders_log row (0038). */
export interface ClaimRow {
  building_id: string; item_kind: ItemKind; item_id: string; title: string; due_on: string; offset_days: number
  recipient: string; sent_on: string; dry_run: boolean
}
/** key: recipientKey(recipient, entryKey). */
export interface Claimed { id: string; key: string }
/** An email_log row written by the job (sent_by null: no person sent it). */
export interface CronLogRow extends Outcome { building_id: string; kind: typeof KIND; recipients: number; dry_run: boolean }

export const recipientKey = (recipient: string, key: string): string => `${recipient}|${key}`

/** Reads and writes, with the service role. Fakes stand in for it in tests. */
export interface ReminderData {
  buildings(): Promise<{ id: string; name: string }[]>
  settings(buildingId: string): Promise<ReminderSettings | null>
  /** Tasks with a next_due and contracts with an end date, near `today` (current values: re-read at send time). */
  items(buildingId: string, today: string): Promise<ReminderItem[]>
  admins(buildingId: string): Promise<Admin[]>
  /**
   * recipientKey of the log rows already written for the building. Real runs count real rows only (a dry run never
   * blocks a real send); dry runs count every row (so the hourly retries don't repeat a dry run).
   */
  sentKeys(buildingId: string, today: string, dryRun: boolean): Promise<Set<string>>
  /** claim_maintenance_reminders (0038): inserts the rows, skipping real ones already logged; the ones inserted now. */
  claim(rows: ClaimRow[]): Promise<Claimed[]>
  /** Removes claimed rows whose email didn't go out (so a retry can send them). */
  release(ids: string[]): Promise<void>
  linkLog(ids: string[], logId: string): Promise<void>
  /** reserve_email_quota (0020) for the job: a pending email_log id, or null when the cap is full. */
  reserve(buildingId: string, count: number, cap: number): Promise<string | null>
  finish(id: string, outcome: Outcome): Promise<void>
  log(row: CronLogRow): Promise<string>
}

export interface CronDeps {
  /** cron_reminders_secret() (0038): the value pg_cron sends. */
  expectedSecret(): Promise<string | null>
  data: ReminderData
  transport: Transport
  env: Env
  now(): number
  sleep(ms: number): Promise<void>
  log?: (line: string) => void
}

export interface BuildingResult { buildingId: string; items: number; sent: number; failed?: number; skipped?: string }
interface Recipient { userId: string; email: string; name: string }
/** One admin's digest: their entries, the claimed row ids, the message. */
interface Digest { to: Recipient; entries: DueEntry[]; ids: string[]; message: MailMessage }

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const mask = (email: string): string => email.replace(/^(.).*(@.*)$/, '$1***$2')

/** One address per admin (trimmed, lower-cased, valid), at most MAX_PER_CALL. */
export function adminRecipients(admins: readonly Admin[]): Recipient[] {
  const seen = new Map<string, Recipient>()
  for (const a of admins) {
    const email = (a.email ?? '').trim().toLowerCase()
    if (EMAIL.test(email) && !seen.has(email)) seen.set(email, { userId: a.userId, email, name: a.name })
  }
  return [...seen.values()].slice(0, MAX_PER_CALL)
}

const keyOf = (to: Recipient, e: DueEntry): string => recipientKey(to.userId, entryKey(e.item.kind, e.item.id, e.item.dueOn ?? '', e.offset))

const claimRow = (buildingId: string, today: string, dryRun: boolean, to: Recipient) => (e: DueEntry): ClaimRow => ({
  building_id: buildingId, item_kind: e.item.kind, item_id: e.item.id, title: e.item.title.slice(0, 200),
  due_on: e.item.dueOn ?? '', offset_days: e.offset, recipient: to.userId, sent_on: today, dry_run: dryRun,
})

/** Sends one by one, THROTTLE_MS apart (real sends only): each message's outcome. */
async function deliver(messages: MailMessage[], deps: CronDeps): Promise<{ outcome: Outcome; oks: boolean[] }> {
  const outcome: Outcome = { sent: 0, failed: 0, skipped: 0, error: null }
  const oks: boolean[] = []
  for (const [i, m] of messages.entries()) {
    if (i > 0 && !deps.transport.dryRun) await deps.sleep(THROTTLE_MS)
    const r = await deps.transport.send(m)
    if (deps.transport.dryRun) deps.log?.(`dry run → ${mask(m.to)}: ${m.subject}`)
    oks.push(r.ok)
    if (r.ok) outcome.sent += 1
    else { outcome.failed += 1; outcome.error ??= r.error ?? 'failed' }
  }
  return { outcome, oks }
}

/** Real send: reserve under the job's share of the cap, deliver, finish; each failed admin's claims are released. */
async function sendReal(buildingId: string, digests: Digest[], deps: CronDeps): Promise<Outcome | null> {
  // Like the debt follow-ups: the committee's own sends keep MAX_PER_CALL of the day's cap.
  const cap = Math.max(0, readCap(deps.env.EMAIL_DAILY_CAP) - MAX_PER_CALL)
  const logId = cap > 0 ? await deps.data.reserve(buildingId, digests.length, cap) : null
  if (!logId) {
    await deps.data.release(digests.flatMap((d) => d.ids))
    return null
  }
  const { outcome, oks } = await deliver(digests.map((d) => d.message), deps)
  await deps.data.finish(logId, outcome)
  await deps.data.release(digests.filter((_, i) => !oks[i]).flatMap((d) => d.ids))
  await deps.data.linkLog(digests.filter((_, i) => oks[i]).flatMap((d) => d.ids), logId)
  return outcome
}

async function sendDry(buildingId: string, digests: Digest[], deps: CronDeps): Promise<Outcome> {
  const { outcome } = await deliver(digests.map((d) => d.message), deps)
  const logId = await deps.data.log({ building_id: buildingId, kind: KIND, recipients: digests.length, dry_run: true, ...outcome })
  await deps.data.linkLog(digests.flatMap((d) => d.ids), logId)
  return outcome
}

/** The entryKeys already sent to one admin. */
function sentTo(sent: ReadonlySet<string>, userId: string): Set<string> {
  const prefix = recipientKey(userId, '')
  return new Set([...sent].filter((k) => k.startsWith(prefix)).map((k) => k.slice(prefix.length)))
}

/** Each admin's entries not yet sent to them; a reason instead when there's nothing to do. */
async function prepare(b: { id: string }, today: string, deps: CronDeps): Promise<{ to: Recipient; entries: DueEntry[] }[] | string> {
  const s = (await deps.data.settings(b.id)) ?? DEFAULT_SETTINGS
  if (!s.enabled) return 'off'
  const [items, sent, admins] = await Promise.all([deps.data.items(b.id, today),
    deps.data.sentKeys(b.id, today, deps.transport.dryRun), deps.data.admins(b.id)])
  const to = adminRecipients(admins)
  if (!to.length) return 'no_recipients'
  const due = to.map((r) => ({ to: r, entries: selectDue(items, s, today, sentTo(sent, r.userId)) })).filter((d) => d.entries.length)
  return due.length ? due : 'nothing_due'
}

/** Claims everything at once, then keeps, per admin, the entries this run claimed (a concurrent run gets none). */
async function claimAll(b: { id: string; name: string }, ready: { to: Recipient; entries: DueEntry[] }[], today: string, deps: CronDeps): Promise<Digest[]> {
  const rows = ready.flatMap((d) => d.entries.map(claimRow(b.id, today, deps.transport.dryRun, d.to)))
  const claimed = new Map((await deps.data.claim(rows)).map((c) => [c.key, c.id]))
  const brand: Brand = { buildingName: b.name, appUrl: deps.env.APP_URL || APP_URL }
  return ready.flatMap(({ to, entries }) => {
    const mine = entries.filter((e) => claimed.has(keyOf(to, e)))
    if (!mine.length) return []
    const message = { to: to.email, ...render(brand, digestContent(mine, to.name, brand.appUrl)) }
    return [{ to, entries: mine, ids: mine.map((e) => claimed.get(keyOf(to, e)) ?? ''), message }]
  })
}

async function runBuilding(b: { id: string; name: string }, today: string, deps: CronDeps): Promise<BuildingResult> {
  const ready = await prepare(b, today, deps)
  if (typeof ready === 'string') return { buildingId: b.id, items: 0, sent: 0, skipped: ready }
  const digests = await claimAll(b, ready, today, deps)
  if (!digests.length) return { buildingId: b.id, items: 0, sent: 0, skipped: 'already_sent' }
  const items = new Set(digests.flatMap((d) => d.entries.map((e) => `${e.item.kind}:${e.item.id}`))).size
  const r = deps.transport.dryRun ? await sendDry(b.id, digests, deps) : await sendReal(b.id, digests, deps)
  if (!r) return { buildingId: b.id, items: 0, sent: 0, skipped: 'daily_cap' }
  return { buildingId: b.id, items, sent: r.sent, ...(r.failed ? { failed: r.failed } : {}) }
}

/** POST from pg_cron → reply. Without a well-formed header: 401 before any database call; a wrong one: 401 too. */
export async function handleCron(secret: string | null, deps: CronDeps): Promise<Reply> {
  if (!looksLikeSecret(secret)) return fail(401, 'unauthorized')
  if (!secretMatches(secret, await deps.expectedSecret())) return fail(401, 'unauthorized')
  const today = israelDate(deps.now())
  const results: BuildingResult[] = []
  for (const b of await deps.data.buildings()) results.push(await runBuilding(b, today, deps))
  deps.log?.(`${today}: ${results.map((r) => `${r.buildingId} ${r.skipped ?? `${r.items} items, ${r.sent} sent`}`).join('; ')}`)
  return reply(200, { today, dryRun: deps.transport.dryRun, results })
}
