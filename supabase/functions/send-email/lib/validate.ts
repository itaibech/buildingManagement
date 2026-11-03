import { EMAIL_KINDS, MEETING_VARIANTS, type ContactInput, type EmailKind, type EmailRequest, type MeetingVariant } from './types.ts'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const MAX_APARTMENTS = 500
const MAX_NOTE = 1000
/** kind 'contact': the same limits as the dialog and committee_messages (0029). */
export const MAX_CONTACT_SUBJECT = 150
export const MAX_CONTACT_BODY = 3000

type Parsed = { ok: true; value: EmailRequest } | { ok: false; error: string }

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const isKind = (v: unknown): v is EmailKind => EMAIL_KINDS.some((k) => k === v)
const isUuid = (v: unknown): v is string => typeof v === 'string' && UUID.test(v)
const isVariant = (v: unknown): v is MeetingVariant => MEETING_VARIANTS.some((x) => x === v)

function parseApartments(v: unknown): string[] | 'all' | undefined | null {
  if (v === undefined || v === 'all') return v
  if (!Array.isArray(v) || v.length === 0 || v.length > MAX_APARTMENTS || !v.every(isUuid)) return null
  return [...new Set(v.map((id) => id.toLowerCase()))]
}

const text = (v: unknown, max: number): string | null =>
  typeof v === 'string' && v.trim().length > 0 && v.trim().length <= max ? v.trim() : null

/** kind 'contact': { to: 'committee' | uuid, subject (≤ 150), body (≤ 3000) }, both trimmed and required. */
function parseContact(body: Record<string, unknown>): ContactInput | string {
  const to = body.to === 'committee' ? 'committee' : isUuid(body.to) ? body.to.toLowerCase() : null
  if (!to) return 'to'
  const subject = text(body.subject, MAX_CONTACT_SUBJECT)
  if (!subject) return 'subject'
  const message = text(body.body, MAX_CONTACT_BODY)
  if (!message) return 'body'
  return { to, subject, body: message }
}

const ONLY_KIND = ['kind', 'id', 'to', 'subject', 'body']

/** The kinds any approved user may send: ticket_new { id } and contact { to, subject, body }; nothing else. */
function parseResident(kind: 'ticket_new' | 'contact', body: Record<string, unknown>): Parsed {
  const extra = Object.keys(body).find((k) => !ONLY_KIND.includes(k))
  if (extra) return { ok: false, error: extra }
  if (kind === 'ticket_new') {
    if (!isUuid(body.id) || body.to !== undefined || body.subject !== undefined || body.body !== undefined) return { ok: false, error: 'id' }
    return { ok: true, value: { kind, id: body.id.toLowerCase(), preview: false } }
  }
  if (body.id !== undefined) return { ok: false, error: 'id' }
  const contact = parseContact(body)
  return typeof contact === 'string' ? { ok: false, error: contact } : { ok: true, value: { kind, contact, preview: false } }
}

/**
 * Validates the JSON body: { kind, id?, apartmentIds?: uuid[] | 'all', note?, variant? (meeting only),
 * details? (meeting invite / update only), preview?, status? (test preview only) }; or, from any approved user,
 * { kind: 'ticket_new', id } / { kind: 'contact', to, subject, body } (parseResident).
 */
export function parseRequest(body: unknown): Parsed {
  if (!isRecord(body) || !isKind(body.kind)) return { ok: false, error: 'kind' }
  const { kind } = body
  if (kind === 'ticket_new' || kind === 'contact') return parseResident(kind, body)
  const needsId = kind === 'announcement' || kind === 'ticket' || kind === 'meeting'
  if (needsId ? !isUuid(body.id) : body.id !== undefined) return { ok: false, error: 'id' }
  if (kind === 'meeting' ? !isVariant(body.variant) : body.variant !== undefined) return { ok: false, error: 'variant' }
  const apartmentIds = parseApartments(body.apartmentIds)
  if (apartmentIds === null || (kind === 'test' && apartmentIds !== undefined)) return { ok: false, error: 'apartmentIds' }
  if (body.note !== undefined && (typeof body.note !== 'string' || body.note.length > MAX_NOTE)) return { ok: false, error: 'note' }
  if (body.details !== undefined && (typeof body.details !== 'boolean' || kind !== 'meeting' || body.variant === 'published')) {
    return { ok: false, error: 'details' }
  }
  if (body.preview !== undefined && typeof body.preview !== 'boolean') return { ok: false, error: 'preview' }
  if (body.status !== undefined && (body.status !== true || kind !== 'test' || body.preview !== true)) return { ok: false, error: 'status' }
  const value: EmailRequest = { kind, preview: body.preview === true }
  if (body.status === true) value.status = true
  if (needsId) value.id = String(body.id).toLowerCase()
  if (isVariant(body.variant)) value.variant = body.variant
  if (body.details === true) value.details = true
  if (apartmentIds !== undefined) value.apartmentIds = apartmentIds
  const note = typeof body.note === 'string' ? body.note.trim() : ''
  if (note) value.note = note
  return { ok: true, value }
}
