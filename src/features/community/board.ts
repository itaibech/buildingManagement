// Community board rules that don't need the network (pure): categories, expiry and the board's filter.
import { he } from '../../lib/he'
import { MAX_PHOTO_BYTES, photoMime } from '../tickets/photos'

export type Category = 'lost_found' | 'pros' | 'giveaway' | 'help' | 'general'
export const CATEGORIES: readonly Category[] = ['lost_found', 'pros', 'giveaway', 'help', 'general']
export const asCategory = (v: string): Category => CATEGORIES.find((c) => c === v) ?? 'general'

export type PostStatus = 'active' | 'resolved'
export const asStatus = (v: string): PostStatus => (v === 'resolved' ? 'resolved' : 'active')

export const MAX_TITLE = 120
export const MAX_BODY = 2000
export const MAX_COMMENT = 1000
/** The author is told when this many days or fewer are left. */
export const EXPIRY_WARN_DAYS = 3

const DAY_MS = 86400_000

/** The fields the board's rules read. */
export interface BoardPost {
  category: Category
  author_id: string | null
  expires_at: string
  hidden_at: string | null
  created_at: string
}

export function isExpired(expiresAt: string, now: Date = new Date()): boolean {
  return new Date(expiresAt).getTime() <= now.getTime()
}

/** Whole days until the post leaves the board (0 once expired). */
export function daysLeft(expiresAt: string, now: Date = new Date()): number {
  return Math.max(0, Math.ceil((new Date(expiresAt).getTime() - now.getTime()) / DAY_MS))
}

/** The author sees a countdown in the post's last days. */
export function expiresSoon(expiresAt: string, now: Date = new Date()): boolean {
  return !isExpired(expiresAt, now) && daysLeft(expiresAt, now) <= EXPIRY_WARN_DAYS
}

/**
 * What the board lists: the chosen category (null = all), newest first. Expired posts are shown only to their author
 * (to renew them); RLS already hides them from everyone else except admins, who don't need them on the board.
 */
export function boardPosts<T extends BoardPost>(posts: readonly T[], category: Category | null, userId: string | undefined,
  now: Date = new Date()): T[] {
  return posts
    .filter((p) => category === null || p.category === category)
    .filter((p) => !isExpired(p.expires_at, now) || (userId !== undefined && p.author_id === userId))
    .sort((a, b) => b.created_at.localeCompare(a.created_at))
}

/** The home card: the newest posts everyone can see (not hidden, not expired). */
export function newestPosts<T extends BoardPost>(posts: readonly T[], n: number, now: Date = new Date()): T[] {
  return boardPosts(posts.filter((p) => p.hidden_at === null && !isExpired(p.expires_at, now)), null, undefined, now).slice(0, n)
}

/** The badge a post shows: hidden by the committee, then expired, then its own status. */
export function postState(p: BoardPost & { status: PostStatus }, now: Date = new Date()): 'active' | 'resolved' | 'expired' | 'hidden' {
  if (p.hidden_at !== null) return 'hidden'
  if (isExpired(p.expires_at, now)) return 'expired'
  return p.status
}

/** The Hebrew message for a known server refusal (the rate limits), or null. */
export function limitMessage(error: unknown, messages: { post: string; comment: string }): string | null {
  const text = error instanceof Error ? error.message : ''
  if (text.includes('community:post_limit')) return messages.post
  if (text.includes('community:comment_limit')) return messages.comment
  return null
}

/** Hebrew error for a picked photo (images only, 5 MB), or null when it can be attached. */
export function photoError(file: Pick<File, 'name' | 'type' | 'size'>): string | null {
  if (!photoMime(file)) return he.community.errors.notImage
  return file.size > MAX_PHOTO_BYTES ? he.community.errors.tooBig : null
}
