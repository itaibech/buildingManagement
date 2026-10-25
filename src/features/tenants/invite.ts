import { he } from '../../lib/he'
import type { Apartment, DirectoryEntry, InviteInput, InviteOutcome, InviteResult, Profile } from './api'

/** The function's batch limit. */
export const MAX_INVITES = 40
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export const normalizeEmail = (v: string): string => v.trim().toLowerCase()
export const isValidEmail = (v: string): boolean => v.length <= 254 && EMAIL.test(v)

/** Whether a resident already has a login: linked to it, or a profile with the same address. */
export function hasAccount(r: DirectoryEntry, profiles: Profile[]): boolean {
  const email = r.email ? normalizeEmail(r.email) : null
  return profiles.some((p) => p.resident_id === r.id || (email !== null && p.email !== null && normalizeEmail(p.email) === email))
}

/** Residents of active apartments with an email and no login, by address (the first resident wins). */
export function inviteSuggestions(directory: DirectoryEntry[], apartments: Apartment[], profiles: Profile[]): Map<string, DirectoryEntry> {
  const active = new Set(apartments.filter((a) => !a.archived_at).map((a) => a.id))
  const map = new Map<string, DirectoryEntry>()
  for (const r of directory) {
    const email = r.email ? normalizeEmail(r.email) : ''
    if (email && isValidEmail(email) && active.has(r.apartment_id) && !map.has(email) && !hasAccount(r, profiles)) map.set(email, r)
  }
  return map
}

/** Typed/pasted values: normalized and deduplicated; the invalid ones are returned separately (not added). */
export function acceptRecipients(values: string[]): { valid: string[]; invalid: string[] } {
  const valid: string[] = []
  const invalid: string[] = []
  for (const v of values.map(normalizeEmail).filter(Boolean)) {
    if (!isValidEmail(v)) invalid.push(v)
    else if (!valid.includes(v)) valid.push(v)
  }
  return { valid, invalid }
}

/** Picked residents carry their resident; typed addresses get the apartment, and the name when there is one of them. */
export function buildInvites(recipients: string[], suggestions: ReadonlyMap<string, DirectoryEntry>, apartmentId: string | null, fullName: string): InviteInput[] {
  const typed = recipients.filter((e) => !suggestions.has(e))
  const name = typed.length === 1 ? fullName.trim() : ''
  return recipients.map((email) => {
    const r = suggestions.get(email)
    if (r) return { email, residentId: r.id }
    return { email, ...(apartmentId ? { apartmentId } : {}), ...(name ? { fullName: name } : {}) }
  })
}

const ORDER: readonly InviteOutcome[] = ['sent', 'resent', 'exists', 'failed', 'skipped']

/** The toast: one recipient sent → "ההזמנה נשלחה ל-…"; otherwise counts per outcome. */
export function summarize(results: InviteResult[]): string {
  const only = results.length === 1 ? results[0] : undefined
  if (only?.outcome === 'sent') return he.invite.sentTo(only.email)
  if (only?.outcome === 'resent') return he.invite.resent(only.email)
  return ORDER.map((o) => [o, results.filter((r) => r.outcome === o).length] as const)
    .filter(([, n]) => n > 0).map(([o, n]) => he.invite.summaryPart[o](n)).join(' · ')
}

/** Something the admin must see in the dialog: not sent, or sent with a step that failed. */
export const needsAttention = (r: InviteResult): boolean => (r.outcome !== 'sent' && r.outcome !== 'resent') || Boolean(r.warnings?.length)
