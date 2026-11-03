/**
 * The two kinds any approved user may send, both to the committee (the building's approved admins):
 *   * ticket_new: the caller's own ticket, at most 15 minutes old, announced once (email_log, plus a unique index).
 *   * contact: a message to the whole committee or one member, stored in committee_messages first, at most
 *     MAX_CONTACTS_PER_DAY per user in 24 hours, with Reply-To set to the sender.
 */
import { contactContent, ticketNewContent, type Sender } from './content.ts'
import { fail, type Plan, type Reply } from './plan.ts'
import { render, type Brand } from './template.ts'
import type { MailMessage } from './transport.ts'
import type { Admin, Caller, Context, DataSource, EmailRequest } from './types.ts'

export const TICKET_FRESH_MS = 15 * 60_000
/** Clock skew allowed for a created_at slightly ahead of the function's clock. */
const SKEW_MS = 60_000
export const MAX_CONTACTS_PER_DAY = 5
const DAY_MS = 24 * 60 * 60_000
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export const validEmail = (v: string | null | undefined): string | null => {
  const e = (v ?? '').trim().toLowerCase()
  return EMAIL.test(e) ? e : null
}

/** One email per address: the given admins with a valid email, except the caller (never emailed about their own act). */
function adminTargets(admins: readonly Admin[], callerId: string): { email: string; name: string }[] {
  const seen = new Map<string, { email: string; name: string }>()
  for (const a of admins) {
    const email = validEmail(a.email)
    if (!email || a.userId === callerId || seen.has(email)) continue
    seen.set(email, { email, name: a.name.trim() })
  }
  return [...seen.values()]
}

const plan = (messages: MailMessage[], refId?: string): Plan =>
  ({ messages, apartmentIds: null, skipped: [], perApartment: {}, ...(refId ? { refId } : {}) })

export interface Scope { req: EmailRequest; caller: Caller; ctx: Context; data: DataSource; brand: Brand; now: number }

/** ticket_new: only the reporter, only while fresh, only once. */
export async function planTicketNew({ req, caller, ctx, data, brand, now }: Scope): Promise<Plan | Reply> {
  const t = await data.newTicket(req.id ?? '', ctx.building.id)
  if (!t) return fail(404, 'התקלה לא נמצאה')
  if (t.openedBy !== caller.userId) return fail(403, 'רק מי שפתח את התקלה יכול לעדכן עליה את הוועד')
  const age = now - Date.parse(t.createdAt)
  if (!(age >= -SKEW_MS && age <= TICKET_FRESH_MS)) return fail(409, 'התקלה כבר אינה חדשה')
  if (await data.logged('ticket_new', t.id)) return fail(409, 'הוועד כבר עודכן על התקלה הזו')
  const [admins, apartment] = await Promise.all([data.admins(ctx.building.id), data.apartmentNumber(caller.userId)])
  const reporter: Sender = { name: ctx.name, apartment }
  const messages = adminTargets(admins, caller.userId)
    .map((r) => ({ to: r.email, ...render(brand, ticketNewContent(t, reporter, r.name, brand.appUrl)) }))
  return plan(messages)
}

/** contact: rate limit, recipient check, store the message, then one email per recipient with Reply-To the sender. */
export async function planContact({ req, caller, ctx, data, brand, now }: Scope): Promise<Plan | Reply> {
  const c = req.contact
  if (!c) return fail(400, 'בקשה לא תקינה (contact)')
  const used = await data.countSince(caller.userId, 'contact', new Date(now - DAY_MS).toISOString())
  if (used >= MAX_CONTACTS_PER_DAY) return fail(429, `אפשר לשלוח עד ${MAX_CONTACTS_PER_DAY} פניות לוועד ביממה. נסו שוב מחר.`)
  const admins = await data.admins(ctx.building.id)
  const toAll = c.to === 'committee'
  if (!toAll && !admins.some((a) => a.userId === c.to)) return fail(404, 'חבר הוועד שבחרתם לא נמצא')
  const replyTo = validEmail(ctx.email)
  const sender: Sender = { name: ctx.name, apartment: await data.apartmentNumber(caller.userId), email: replyTo }
  const refId = await data.storeMessage({
    building_id: ctx.building.id, sender_id: caller.userId, recipient_id: toAll ? null : c.to, sender_name: ctx.name.slice(0, 200),
    sender_email: replyTo, apartment_number: sender.apartment, subject: c.subject, body: c.body,
  })
  const messages = adminTargets(admins.filter((a) => toAll || a.userId === c.to), caller.userId).map((r) => ({
    to: r.email, ...render(brand, contactContent(c, sender, toAll, r.name, brand.appUrl)), ...(replyTo ? { replyTo } : {}),
  }))
  return plan(messages, refId)
}
