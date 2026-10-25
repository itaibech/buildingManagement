/** Header search (Task 26): client-side matching over data the user may already see. Pure. */

export interface SearchFields { text?: readonly string[]; phones?: readonly string[]; numbers?: readonly number[] }
export interface AptHit { id: string; number: number; names: string[] }
export interface PersonHit { id: string; name: string; phone: string | null; email: string | null; apartmentId: string; apartmentNumber: number }
export interface TitleHit { id: string; title: string }
export interface SearchData { apartments: AptHit[]; people: PersonHit[]; announcements: TitleHit[]; tickets: TitleHit[] }
export interface SearchResults { apartments: AptHit[]; people: PersonHit[]; announcements: TitleHit[]; tickets: TitleHit[] }

const MIN_PHONE_DIGITS = 3
const MAX_PER_GROUP = 6

/** Trim, collapse runs of spaces, lower-case (Latin emails; Hebrew has no case). */
export const normalize = (s: string): string => s.trim().replace(/\s+/g, ' ').toLowerCase()
const digits = (s: string): string => s.replace(/\D/g, '')

/** Text contains the query; a phone contains its digits (dashes ignored, 3+ digits); a number equals it. */
export function matches(query: string, f: SearchFields): boolean {
  const q = normalize(query)
  if (!q) return false
  if (f.text?.some((t) => normalize(t).includes(q))) return true
  const d = digits(q)
  if (/^[\d\s\-+()]+$/.test(q) && d.length >= MIN_PHONE_DIGITS && f.phones?.some((p) => digits(p).includes(d))) return true
  return /^\d+$/.test(q) && !!f.numbers?.some((n) => String(n) === q)
}

/** Every group's matches, at most a few each. */
export function searchAll(query: string, data: SearchData): SearchResults {
  const pick = <T>(list: T[], f: (x: T) => SearchFields): T[] => list.filter((x) => matches(query, f(x))).slice(0, MAX_PER_GROUP)
  return {
    apartments: pick(data.apartments, (a) => ({ numbers: [a.number], text: a.names })),
    people: pick(data.people, (p) => ({ text: [p.name, p.email ?? ''], phones: p.phone ? [p.phone] : [] })),
    announcements: pick(data.announcements, (a) => ({ text: [a.title] })),
    tickets: pick(data.tickets, (t) => ({ text: [t.title] })),
  }
}

export const resultCount = (r: SearchResults): number => r.apartments.length + r.people.length + r.announcements.length + r.tickets.length
