/** Building documents: categories, expiry, version order and the grouped, searchable list. Pure. */
import { normalize } from '../search/match'

/** The categories in display order (mirrors the check in 0034). */
export const CATEGORIES = ['legal', 'insurance', 'warranty', 'plans', 'engineering', 'approvals', 'contracts', 'other'] as const
export type Category = (typeof CATEGORIES)[number]
export type Visibility = 'residents' | 'committee'
/** expired: the expiry date has passed; soon: within EXPIRY_SOON_DAYS (the expiry day itself still counts as valid). */
export type ExpiryStatus = 'expired' | 'soon' | 'valid'

export const EXPIRY_SOON_DAYS = 30
const DAY = 86_400_000

const isCategory = (v: string): v is Category => (CATEGORIES as readonly string[]).includes(v)
/** A category from the DB, or 'other' for a value this client doesn't know. */
export const toCategory = (v: string): Category => (isCategory(v) ? v : 'other')

/** Whole days from `from` to `to` (both YYYY-MM-DD). */
const daysBetween = (from: string, to: string): number => Math.round((Date.parse(to) - Date.parse(from)) / DAY)

/** The expiry state on `today` (YYYY-MM-DD, Israel); null for a document without an expiry date. */
export function expiryStatus(expiresOn: string | null, today: string): ExpiryStatus | null {
  if (!expiresOn) return null
  if (expiresOn < today) return 'expired'
  return daysBetween(today, expiresOn) <= EXPIRY_SOON_DAYS ? 'soon' : 'valid'
}

export interface VersionLike { id: string; created_at: string }

/** Newest first (the current version leads), each with its number: the oldest is 1. */
export function orderVersions<V extends VersionLike>(versions: readonly V[]): (V & { number: number })[] {
  const sorted = [...versions].sort((a, b) => b.created_at.localeCompare(a.created_at) || b.id.localeCompare(a.id))
  return sorted.map((v, i) => ({ ...v, number: sorted.length - i }))
}

export interface DocLike { title: string; category: Category; expires_on: string | null }
export interface DocGroup<D> { category: Category; docs: D[] }

/** Documents whose title contains the query, by category in the fixed order, each group by title. */
export function groupDocuments<D extends DocLike>(docs: readonly D[], query: string): DocGroup<D>[] {
  const q = normalize(query)
  const shown = q ? docs.filter((d) => normalize(d.title).includes(q)) : docs
  return CATEGORIES.map((category) => ({
    category,
    docs: shown.filter((d) => d.category === category).sort((a, b) => a.title.localeCompare(b.title, 'he')),
  })).filter((g) => g.docs.length > 0)
}

/** How many documents expire within the next EXPIRY_SOON_DAYS (the admin inbox). */
export const expiringSoon = (docs: readonly DocLike[], today: string): number =>
  docs.filter((d) => expiryStatus(d.expires_on, today) === 'soon').length
