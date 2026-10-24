import type { Recipient, Resident } from './types.ts'

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/**
 * One recipient per address (trimmed, lower-cased): residents of the selected apartments ('all' = every apartment)
 * with a valid email. The first resident listed with an address gives the greeting name.
 */
export function buildRecipients(residents: readonly Resident[], apartmentIds: readonly string[] | 'all'): Recipient[] {
  const pick = apartmentIds === 'all' ? null : new Set(apartmentIds)
  const seen = new Map<string, Recipient>()
  for (const r of residents) {
    const email = (r.email ?? '').trim().toLowerCase()
    if (!EMAIL.test(email) || seen.has(email) || (pick && !pick.has(r.apartment_id))) continue
    seen.set(email, { email, name: r.full_name.trim(), apartmentId: r.apartment_id })
  }
  return [...seen.values()]
}
