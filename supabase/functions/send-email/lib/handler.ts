import { checkCap, readCap } from './cap.ts'
import { announcementContent, debtContent, testContent, ticketContent } from './content.ts'
import { openMonths, splitDebtors } from './debt.ts'
import { buildRecipients } from './recipients.ts'
import { render, type Brand, type EmailContent } from './template.ts'
import type { MailMessage, Transport } from './transport.ts'
import type { Apartment, Caller, Context, DataSource, EmailRequest, Env, Recipient } from './types.ts'
import { parseRequest } from './validate.ts'

export interface Deps {
  caller(): Promise<Caller | null>
  data: DataSource
  transport: Transport
  env: Env
  sleep(ms: number): Promise<void>
  /** Function log (dry runs print what would have been sent, with masked addresses). */
  log?: (line: string) => void
}
export interface Reply { status: number; body: Record<string, unknown> }
interface Plan { messages: MailMessage[]; apartmentIds: string[] | null; skipped: number[] }

export const THROTTLE_MS = 500
const APP_URL = 'https://itaibech.github.io/buildingManagement/'
const SAMPLES = 3

const reply = (status: number, body: Record<string, unknown>): Reply => ({ status, body })
const fail = (status: number, error: string): Reply => reply(status, { error })
const mask = (email: string): string => email.replace(/^(.).*(@.*)$/, '$1***$2')

const toMessages = (brand: Brand, recipients: Recipient[], content: (r: Recipient) => EmailContent): MailMessage[] =>
  recipients.map((r) => ({ to: r.email, ...render(brand, content(r)) }))

/** The selected apartments that belong to the building ('all' = every one). */
const resolveIds = (sel: string[] | 'all', apartments: Apartment[]): string[] =>
  apartments.filter((a) => sel === 'all' || sel.includes(a.id)).map((a) => a.id)

async function planAnnouncement(req: EmailRequest, ctx: Context, data: DataSource, brand: Brand): Promise<Plan | Reply> {
  const a = await data.announcement(req.id ?? '', ctx.building.id)
  if (!a) return fail(404, 'ההודעה לא נמצאה')
  const [apartments, residents] = await Promise.all([data.apartments(ctx.building.id), data.residents(ctx.building.id)])
  const sel = req.apartmentIds ?? 'all'
  const ids = resolveIds(sel, apartments)
  const messages = toMessages(brand, buildRecipients(residents, ids), (r) => announcementContent(a, r.name, brand.appUrl))
  return { messages, apartmentIds: sel === 'all' ? null : ids, skipped: [] }
}

async function planTicket(req: EmailRequest, ctx: Context, data: DataSource, brand: Brand): Promise<Plan | Reply> {
  const t = await data.ticket(req.id ?? '', ctx.building.id)
  if (!t) return fail(404, 'קריאת השירות לא נמצאה')
  const [apartments, residents] = await Promise.all([data.apartments(ctx.building.id), data.residents(ctx.building.id)])
  const sel = req.apartmentIds ?? (t.openerApartmentId ? [t.openerApartmentId] : [])
  const ids = resolveIds(sel, apartments)
  const messages = toMessages(brand, buildRecipients(residents, ids), (r) => ticketContent(t, req.note, r.name, brand.appUrl))
  return { messages, apartmentIds: sel === 'all' ? null : ids, skipped: [] }
}

async function planDebt(req: EmailRequest, ctx: Context, data: DataSource, brand: Brand): Promise<Plan> {
  const [apartments, residents] = await Promise.all([data.apartments(ctx.building.id), data.residents(ctx.building.id)])
  const sel = req.apartmentIds ?? 'all'
  const ids = resolveIds(sel, apartments)
  const { debtors, skipped } = splitDebtors(ids.length ? await data.balances(ids) : [])
  const ledger = debtors.length ? await data.ledger(debtors.map((d) => d.apartmentId)) : []
  const numberOf = (id: string): number => apartments.find((a) => a.id === id)?.number ?? 0
  const messages = debtors.flatMap((d) => {
    const open = openMonths(ledger.filter((l) => l.apartmentId === d.apartmentId), d.balance)
    const info = { number: numberOf(d.apartmentId), balance: d.balance, open,
      instructions: ctx.building.payment_instructions, contact: ctx.building.committee_contact }
    return toMessages(brand, buildRecipients(residents, [d.apartmentId]), (r) => debtContent(info, r.name, brand.appUrl))
  })
  return { messages, apartmentIds: sel === 'all' ? null : ids, skipped: skipped.map(numberOf).sort((a, b) => a - b) }
}

function planTest(ctx: Context, brand: Brand): Plan | Reply {
  if (!ctx.email) return fail(400, 'לא נמצאה כתובת מייל בפרופיל שלכם')
  return { messages: [{ to: ctx.email, ...render(brand, testContent(ctx.name, brand.appUrl)) }], apartmentIds: null, skipped: [] }
}

function buildPlan(req: EmailRequest, ctx: Context, data: DataSource, brand: Brand): Promise<Plan | Reply> | Plan | Reply {
  if (req.kind === 'announcement') return planAnnouncement(req, ctx, data, brand)
  if (req.kind === 'ticket') return planTicket(req, ctx, data, brand)
  if (req.kind === 'debt') return planDebt(req, ctx, data, brand)
  return planTest(ctx, brand)
}

/** Sends one by one, ~500 ms apart (real sends only); counts successes and failures. */
async function deliver(messages: MailMessage[], deps: Deps): Promise<{ sent: number; failed: number; error: string | null }> {
  const { transport } = deps
  let sent = 0
  let failed = 0
  let error: string | null = null
  for (const [i, m] of messages.entries()) {
    if (i > 0 && !transport.dryRun) await deps.sleep(THROTTLE_MS)
    const r = await transport.send(m)
    if (transport.dryRun) deps.log?.(`dry run → ${mask(m.to)}: ${m.subject}`)
    if (r.ok) sent += 1
    else { failed += 1; error ??= r.error ?? 'failed' }
  }
  return { sent, failed, error }
}

async function authorize(body: unknown, deps: Deps): Promise<{ caller: Caller; req: EmailRequest } | Reply> {
  const caller = await deps.caller()
  if (!caller) return fail(401, 'נדרשת התחברות')
  if (!caller.isAdmin) return fail(403, 'רק מנהלי הבניין יכולים לשלוח מיילים')
  const parsed = parseRequest(body)
  if (!parsed.ok) return fail(400, `בקשה לא תקינה (${parsed.error})`)
  return { caller, req: parsed.value }
}

/** POST body → reply. Admin only; preview counts without sending; real sends respect the daily cap and are logged. */
export async function handle(body: unknown, deps: Deps): Promise<Reply> {
  const auth = await authorize(body, deps)
  if ('status' in auth) return auth
  const { caller, req } = auth
  const ctx = await deps.data.context(caller.userId)
  const brand: Brand = { buildingName: ctx.building.name, appUrl: deps.env.APP_URL || APP_URL }
  const plan = await buildPlan(req, ctx, deps.data, brand)
  if ('status' in plan) return plan
  const { dryRun, reason } = deps.transport
  const count = plan.messages.length
  const cap = checkCap(dryRun ? 0 : await deps.data.sentToday(), readCap(deps.env.EMAIL_DAILY_CAP), req.preview ? 0 : count)
  if (req.preview) return reply(200, { preview: true, recipients: count, skipped: plan.skipped, dryRun, reason, remainingToday: cap.remaining })
  if (!cap.ok) return reply(429, { error: cap.message, remainingToday: cap.remaining })
  const r = await deliver(plan.messages, deps)
  await deps.data.log({ building_id: ctx.building.id, sent_by: caller.userId, kind: req.kind, ref_id: req.id ?? null,
    apartment_ids: plan.apartmentIds, recipients: count, sent: r.sent, failed: r.failed, skipped: plan.skipped.length, dry_run: dryRun, error: r.error })
  const samples = dryRun ? plan.messages.slice(0, SAMPLES).map((m) => ({ subject: m.subject, text: m.text })) : undefined
  return reply(200, { sent: r.sent, failed: r.failed, skipped: plan.skipped, recipients: count, dryRun, reason, ...(samples ? { samples } : {}) })
}
