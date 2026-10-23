export interface AnnouncementLike {
  pinned: boolean
  expires_at: string | null
  created_at: string
}

const pad = (n: number): string => String(n).padStart(2, '0')

/** Local calendar date as YYYY-MM-DD (the format of a Postgres `date`). */
export function todayISO(now: Date = new Date()): string {
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
}

const isExpired = (a: AnnouncementLike, today: string): boolean => a.expires_at !== null && a.expires_at < today

const newestFirst = (a: AnnouncementLike, b: AnnouncementLike): number => b.created_at.localeCompare(a.created_at)

/** Non-expired items: pinned first, then newest first. An item is still visible on its expiry date. */
export function visibleAnnouncements<T extends AnnouncementLike>(list: readonly T[], today: string): T[] {
  return list
    .filter((a) => !isExpired(a, today))
    .sort((a, b) => Number(b.pinned) - Number(a.pinned) || newestFirst(a, b))
}

/** Expired items, newest first (shown to admins only). */
export function expiredAnnouncements<T extends AnnouncementLike>(list: readonly T[], today: string): T[] {
  return list.filter((a) => isExpired(a, today)).sort(newestFirst)
}
