/**
 * cron-reminders: the daily maintenance digest (pure request handling; no Deno or network imports, so Vitest can
 * load it). Called by pg_cron (0038) with x-cron-secret; per building: what is due today → claim it in
 * maintenance_reminders_log (once only) → one digest email to each approved admin → the log rows link the email_log.
 */
import { readCap } from '../../send-email/lib/cap.ts'
import { APP_URL, MAX_PER_CALL, THROTTLE_MS } from '../../send-email/lib/handler.ts'
import { fail, reply, type Reply } from '../../send-email/lib/plan.ts'
import { render, type Brand } from '../../send-email/lib/template.ts'
import type { MailMessage, Transport } from '../../send-email/lib/transport.ts'
import type { Admin, Env, Outcome } from '../../send-email/lib/types.ts'
import { secretMatches } from './auth.ts'
import { digestContent } from './content.ts'
import { DEFAULT_SETTINGS, entryKey, israelDate, selectDue, type DueEntry, type ItemKind, type ReminderItem, type ReminderSettings } from './digest.ts'

export const KIND = 'maintenance_reminder'

/** A maintenance_reminders_log row (0038). */
export interface ClaimRow {
  building_id: string; item_kind: ItemKind; item_id: string; title: string; due_on: string; offset_days: number
  sent_on: string; dry_run: boolean
}
export interface Claimed { id: string; key: string }
/** An email_log row written by the job (sent_by null: no person sent it). */
export interface CronLogRow extends Outcome { building_id: string; kind: typeof KIND; recipients: number; dry_run: boolean }

/** Reads and writes, with the service role. Fakes stand in for it in tests. */
export interface ReminderData {
  buildings(): Promise<{ id: string; name: string }[]>
  settings(buildingId: string): Promise<ReminderSettings | null>
  /** Tasks with a next_due and contracts with an end date, near `today` (current values: re-read at send time). */
  items(buildingId: string, today: string): Promise<ReminderItem[]>
  admins(buildingId: string): Promise<Admin[]>
  /** entryKey of the log rows already written for the building around `today`. */
  sentKeys(buildingId: string, today: string): Promise<Set<string>>
  /** Inserts the rows, skipping any the unique index already holds: the ones inserted now. */
  claim(rows: ClaimRow[]): Promise<Claimed[]>
  /** Removes claimed rows when nothing went out (so a re-run can send them). */
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

export interface BuildingResult { buildingId: string; items: number; sent: number; skipped?: string }

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const mask = (email: string): string => email.replace(/^(.).*(@.*)$/, '$1***$2')

/** One address per admin (trimmed, lower-cased, valid), at most MAX_PER_CALL. */
export function adminRecipients(admins: readonly Admin[]): { email: string; name: string }[] {
  const seen = new Map<string, string>()
  for (const a of admins) {
    const email = (a.email ?? '').trim().toLowerCase()
    if (EMAIL.test(email) && !seen.has(email)) seen.set(email, a.name)
  }
  return [...seen].slice(0, MAX_PER_CALL).map(([email, name]) => ({ email, name }))
}

const claimRow = (buildingId: string, today: string, dryRun: boolean) => (e: DueEntry): ClaimRow => ({
  building_id: buildingId, item_kind: e.item.kind, item_id: e.item.id, title: e.item.title.slice(0, 200),
  due_on: e.item.dueOn ?? '', offset_days: e.offset, sent_on: today, dry_run: dryRun,
})

/** Sends one by one, THROTTLE_MS apart (real sends only). */
async function deliver(messages: MailMessage[], deps: CronDeps): Promise<Outcome> {
  const out: Outcome = { sent: 0, failed: 0, skipped: 0, error: null }
  for (const [i, m] of messages.entries()) {
    if (i > 0 && !deps.transport.dryRun) await deps.sleep(THROTTLE_MS)
    const r = await deps.transport.send(m)
    if (deps.transport.dryRun) deps.log?.(`dry run → ${mask(m.to)}: ${m.subject}`)
    if (r.ok) out.sent += 1
    else { out.failed += 1; out.error ??= r.error ?? 'failed' }
  }
  return out
}

interface Job { building: { id: string; name: string }; claimed: Claimed[]; messages: MailMessage[] }
interface Ready { entries: DueEntry[]; to: { email: string; name: string }[] }

/** Real send: reserve under the job's share of the cap, deliver, finish; nothing out = the claims are released. */
async function sendReal(job: Job, deps: CronDeps): Promise<number> {
  const ids = job.claimed.map((c) => c.id)
  // Like the debt follow-ups: the committee's own sends keep MAX_PER_CALL of the day's cap.
  const cap = Math.max(0, readCap(deps.env.EMAIL_DAILY_CAP) - MAX_PER_CALL)
  const logId = cap > 0 ? await deps.data.reserve(job.building.id, job.messages.length, cap) : null
  if (!logId) {
    await deps.data.release(ids)
    return -1
  }
  const r = await deliver(job.messages, deps)
  await deps.data.finish(logId, r)
  if (r.sent === 0) await deps.data.release(ids)
  else await deps.data.linkLog(ids, logId)
  return r.sent
}

async function sendDry(job: Job, deps: CronDeps): Promise<number> {
  const r = await deliver(job.messages, deps)
  const logId = await deps.data.log({ building_id: job.building.id, kind: KIND, recipients: job.messages.length, dry_run: true, ...r })
  await deps.data.linkLog(job.claimed.map((c) => c.id), logId)
  return r.sent
}

/** What is due for the building and who gets it; a reason instead when there's nothing to do. */
async function prepare(b: { id: string; name: string }, today: string, deps: CronDeps): Promise<Ready | string> {
  const s = (await deps.data.settings(b.id)) ?? DEFAULT_SETTINGS
  if (!s.enabled) return 'off'
  const [items, sent, admins] = await Promise.all([deps.data.items(b.id, today), deps.data.sentKeys(b.id, today), deps.data.admins(b.id)])
  const entries = selectDue(items, s, today, sent)
  if (!entries.length) return 'nothing_due'
  const to = adminRecipients(admins)
  return to.length ? { entries, to } : 'no_recipients'
}

async function runBuilding(b: { id: string; name: string }, today: string, deps: CronDeps): Promise<BuildingResult> {
  const ready = await prepare(b, today, deps)
  if (typeof ready === 'string') return { buildingId: b.id, items: 0, sent: 0, skipped: ready }
  const { dryRun } = deps.transport
  const claimed = await deps.data.claim(ready.entries.map(claimRow(b.id, today, dryRun)))
  const keys = new Set(claimed.map((c) => c.key))
  const entries = ready.entries.filter((e) => keys.has(entryKey(e.item.kind, e.item.id, e.item.dueOn ?? '', e.offset)))
  if (!entries.length) return { buildingId: b.id, items: 0, sent: 0, skipped: 'already_sent' }
  const brand: Brand = { buildingName: b.name, appUrl: deps.env.APP_URL || APP_URL }
  const messages = ready.to.map((r) => ({ to: r.email, ...render(brand, digestContent(entries, r.name, brand.appUrl)) }))
  const job = { building: b, claimed, messages }
  const sent = dryRun ? await sendDry(job, deps) : await sendReal(job, deps)
  return sent < 0 ? { buildingId: b.id, items: 0, sent: 0, skipped: 'daily_cap' } : { buildingId: b.id, items: entries.length, sent }
}

/** POST from pg_cron → reply. Anything without the database's secret is 401 before any data is read. */
export async function handleCron(secret: string | null, deps: CronDeps): Promise<Reply> {
  if (!secretMatches(secret, await deps.expectedSecret())) return fail(401, 'unauthorized')
  const today = israelDate(deps.now())
  const results: BuildingResult[] = []
  for (const b of await deps.data.buildings()) results.push(await runBuilding(b, today, deps))
  deps.log?.(`${today}: ${results.map((r) => `${r.buildingId} ${r.skipped ?? `${r.items} items, ${r.sent} sent`}`).join('; ')}`)
  return reply(200, { today, dryRun: deps.transport.dryRun, results })
}
