import { EMAIL_KINDS, type EmailKind, type EmailRequest } from './types.ts'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const MAX_APARTMENTS = 500
const MAX_NOTE = 1000

type Parsed = { ok: true; value: EmailRequest } | { ok: false; error: string }

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const isKind = (v: unknown): v is EmailKind => EMAIL_KINDS.some((k) => k === v)
const isUuid = (v: unknown): v is string => typeof v === 'string' && UUID.test(v)

function parseApartments(v: unknown): string[] | 'all' | undefined | null {
  if (v === undefined || v === 'all') return v
  if (!Array.isArray(v) || v.length === 0 || v.length > MAX_APARTMENTS || !v.every(isUuid)) return null
  return [...new Set(v.map((id) => id.toLowerCase()))]
}

/** Validates the JSON body: { kind, id?, apartmentIds?: uuid[] | 'all', note?, preview? }. */
export function parseRequest(body: unknown): Parsed {
  if (!isRecord(body) || !isKind(body.kind)) return { ok: false, error: 'kind' }
  const { kind } = body
  const needsId = kind === 'announcement' || kind === 'ticket'
  if (needsId ? !isUuid(body.id) : body.id !== undefined) return { ok: false, error: 'id' }
  const apartmentIds = parseApartments(body.apartmentIds)
  if (apartmentIds === null || (kind === 'test' && apartmentIds !== undefined)) return { ok: false, error: 'apartmentIds' }
  if (body.note !== undefined && (typeof body.note !== 'string' || body.note.length > MAX_NOTE)) return { ok: false, error: 'note' }
  if (body.preview !== undefined && typeof body.preview !== 'boolean') return { ok: false, error: 'preview' }
  const value: EmailRequest = { kind, preview: body.preview === true }
  if (needsId) value.id = String(body.id).toLowerCase()
  if (apartmentIds !== undefined) value.apartmentIds = apartmentIds
  const note = typeof body.note === 'string' ? body.note.trim() : ''
  if (note) value.note = note
  return { ok: true, value }
}
