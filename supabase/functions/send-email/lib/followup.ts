/**
 * kind 'debt_followup' (0035): the automatic debt reminders the daily job recorded, sent when an admin presses
 * "שליחה". The server picks the apartments (debt_followups_ready rechecks today's balances); step 1 is the existing
 * debt template, step 2 the firmer one. Sends stay inside the follow-ups' share of the daily cap (cap − MAX_PER_CALL,
 * so the committee's own sends always fit); whole apartments that don't fit stay pending for the next send.
 * A real send claims its rows first (debt_followups_ready with claim: a concurrent send gets none) and always
 * finishes them: sent, or released to pending (failed, deferred, no resident email yet). Preview and dry run read
 * only: nothing is claimed, skipped or marked sent.
 */
import { debtContent, debtFirmContent } from './content.ts'
import { openMonths } from './debt.ts'
import { reply, type Reply } from './plan.ts'
import { buildRecipients } from './recipients.ts'
import { render, type Brand } from './template.ts'
import type { MailMessage, Transport } from './transport.ts'
import type { Caller, Context, DataSource, FollowupDue, LogRow } from './types.ts'

export interface FollowupBatch { due: FollowupDue; number: number; messages: MailMessage[] }
export interface Delivery { sent: number; failed: number; error: string | null; oks: boolean[] }

export interface FollowupJob {
  caller: Caller
  ctx: Context
  data: DataSource
  transport: Transport
  brand: Brand
  /** The follow-ups' share of today's cap. */
  cap: number
  maxPerCall: number
  preview: boolean
  deliver(messages: MailMessage[]): Promise<Delivery>
}

const SAMPLES = 3

/** One batch per sendable follow-up (claimed when `claim`): its apartment's recipients, each with the step's email. */
export async function followupBatches(ctx: Context, data: DataSource, brand: Brand, claim = false): Promise<FollowupBatch[]> {
  const b = ctx.building
  const due = await data.followupsReady(b.id, claim)
  if (!due.length) return []
  const ids = [...new Set(due.map((d) => d.apartmentId))]
  const [apartments, residents, ledger] = await Promise.all([data.apartments(b.id), data.residents(b.id), data.ledger(ids)])
  return due.map((d) => {
    const number = apartments.find((a) => a.id === d.apartmentId)?.number ?? 0
    const open = openMonths(ledger.filter((l) => l.apartmentId === d.apartmentId), d.balance)
    const info = { number, balance: d.balance, open, instructions: b.payment_instructions, contact: b.committee_contact }
    const messages = buildRecipients(residents, [d.apartmentId]).map((r) => ({
      to: r.email,
      ...render(brand, d.step === 2 ? debtFirmContent(info, r.name, brand.appUrl, d.days) : debtContent(info, r.name, brand.appUrl)),
    }))
    return { due: d, number, messages }
  })
}

/** Whole apartments, in order, while their emails fit in `room`; the rest is deferred. Batches without email are left out. */
export function fitBatches(batches: readonly FollowupBatch[], room: number): { take: FollowupBatch[]; deferred: FollowupBatch[] } {
  const take: FollowupBatch[] = []
  const deferred: FollowupBatch[] = []
  let used = 0
  for (const b of batches) {
    if (!b.messages.length) continue
    if (used + b.messages.length <= room) {
      take.push(b)
      used += b.messages.length
    } else deferred.push(b)
  }
  return { take, deferred }
}

/** Follow-up id → emails delivered, for the batches with at least one (an apartment whose emails all failed stays pending). */
export function sentPerFollowup(take: readonly FollowupBatch[], oks: readonly boolean[]): Record<string, number> {
  const out: Record<string, number> = {}
  let i = 0
  for (const b of take) {
    const ok = oks.slice(i, i + b.messages.length).filter(Boolean).length
    i += b.messages.length
    if (ok > 0) out[b.due.id] = ok
  }
  return out
}

type Summary = Record<string, unknown> & { deferred: number }

const logRow = (job: FollowupJob, take: readonly FollowupBatch[]): Omit<LogRow, 'recipients' | 'sent' | 'failed' | 'skipped' | 'dry_run' | 'error'> => ({
  building_id: job.ctx.building.id, sent_by: job.caller.userId, kind: 'debt_followup', ref_id: null,
  apartment_ids: take.map((b) => b.due.apartmentId),
})

/** Sends the batches that fit (reserved under the follow-ups' cap); null delivery = nothing went out. */
async function deliverTake(job: FollowupJob, take: FollowupBatch[], skipped: number, state: { started: boolean }): Promise<{ id: string | null; r: Delivery | null }> {
  const messages = take.flatMap((b) => b.messages)
  if (!messages.length) return { id: null, r: null }
  const id = await job.data.reserve({ ...logRow(job, take), count: messages.length, cap: job.cap })
  if (!id) return { id: null, r: null }
  state.started = true
  const r = await job.deliver(messages)
  await job.data.finish(id, { sent: r.sent, failed: r.failed, skipped, error: r.error })
  return { id, r }
}

/**
 * Real send of claimed batches: deliver what fits, then finish every claimed row (sent, or back to pending). If the
 * send fails before anything went out, the claim is released at once; after that it is left to the 15-minute release.
 */
async function sendReal(job: FollowupJob, all: FollowupBatch[], take: FollowupBatch[], summary: Summary): Promise<Reply> {
  const claimed = all.map((b) => b.due.id)
  const noEmail = all.filter((b) => !b.messages.length).length
  const state = { started: false }
  try {
    const reserved = await deliverTake(job, take, noEmail, state)
    const sent = reserved.r ? sentPerFollowup(take, reserved.r.oks) : {}
    if (claimed.length) await job.data.finishFollowups(job.ctx.building.id, claimed, sent, reserved.id)
    if (take.length && !reserved.r) {
      return reply(200, { ...summary, sent: 0, failed: 0, apartments: 0, deferred: summary.deferred + take.length, quotaFull: true })
    }
    return reply(200, { ...summary, sent: reserved.r?.sent ?? 0, failed: reserved.r?.failed ?? 0 })
  } catch (e) {
    if (!state.started && claimed.length) await job.data.finishFollowups(job.ctx.building.id, claimed, {}, null).catch(() => undefined)
    throw e
  }
}

/** Dry run: the would-be emails are logged (masked) and recorded as a dry-run row; the follow-ups stay pending. */
async function sendDry(job: FollowupJob, take: FollowupBatch[], summary: Summary): Promise<Reply> {
  const messages = take.flatMap((b) => b.messages)
  const r = messages.length ? await job.deliver(messages) : { sent: 0, failed: 0, error: null, oks: [] }
  if (messages.length) {
    await job.data.log({ ...logRow(job, take), recipients: messages.length, sent: r.sent, failed: r.failed, skipped: 0, dry_run: true, error: r.error })
  }
  const samples = messages.slice(0, SAMPLES).map((m) => ({ subject: m.subject, text: m.text }))
  return reply(200, { ...summary, sent: r.sent, failed: r.failed, samples })
}

/** Preview (counts only) or send of the pending follow-up emails. Admin only (handler.authorize). */
export async function handleFollowup(job: FollowupJob): Promise<Reply> {
  const { transport } = job
  const real = !job.preview && !transport.dryRun
  const all = await followupBatches(job.ctx, job.data, job.brand, real)
  const noEmail = all.filter((b) => !b.messages.length)
  const used = transport.dryRun ? 0 : await job.data.sentToday(job.ctx.building.id)
  const remainingToday = Math.max(0, job.cap - used)
  const { take, deferred } = fitBatches(all, Math.min(job.maxPerCall, remainingToday))
  const summary: Summary = {
    pending: all.length, apartments: take.length, recipients: take.reduce((t, b) => t + b.messages.length, 0),
    deferred: deferred.length, noEmail: noEmail.map((b) => b.number).sort((a, b) => a - b),
    quotaFull: take.length === 0 && deferred.length > 0, dryRun: transport.dryRun, reason: transport.reason, remainingToday,
  }
  if (job.preview) return reply(200, { preview: true, ...summary })
  return real ? sendReal(job, all, take, summary) : sendDry(job, take, summary)
}
