import { he } from '../../lib/he'
import { meetingDate, meetingTime } from '../meetings/fmt'
import type { Meeting } from '../meetings/types'

/** The live app; HashRouter paths follow the `#`. */
export const APP_URL = 'https://itaibech.github.io/buildingManagement/#'
/** WhatsApp handles long texts, but a share should stay a short teaser that points into the app. */
export const MAX_SHARE_LENGTH = 600
const MAX_LINE = 120
const MAX_BODY_LINES = 3

export interface ShareItems {
  announcement: { id: string; title: string; body: string }
  meeting: Pick<Meeting, 'id' | 'title' | 'kind' | 'scheduled_at' | 'location'>
  protocol: Pick<Meeting, 'id' | 'title' | 'kind' | 'scheduled_at'>
}
export type ShareKind = keyof ShareItems

// Lines that could carry private data (phone numbers, amounts) never leave the app.
const PHONE = /(?:\+?972|\b0)[\s-]?\d(?:[\s-]?\d){6,8}\b/
const MONEY = /₪|ש"ח|ש״ח|\bNIS\b|\bILS\b/i

export const isPrivateLine = (line: string): boolean => PHONE.test(line) || MONEY.test(line)

const clip = (s: string, max: number): string => (s.length <= max ? s : `${s.slice(0, max - 1).trimEnd()}…`)

/** The first few non-empty, non-private lines of a body, each clipped. */
function excerpt(body: string): string[] {
  return body.split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !isPrivateLine(l)).slice(0, MAX_BODY_LINES).map((l) => clip(l, MAX_LINE))
}

/** The in-app route for an item (without the hash). */
export function shareRoute(kind: ShareKind, id: string): string {
  return kind === 'announcement' ? `/announcements?open=${encodeURIComponent(id)}` : `/meetings/${encodeURIComponent(id)}`
}

function keyLines<K extends ShareKind>(kind: K, item: ShareItems[K]): string[] {
  if (kind === 'announcement') return excerpt((item as ShareItems['announcement']).body)
  const m = item as ShareItems['meeting']
  if (kind === 'protocol') return [he.meetings.kinds[m.kind], he.share.protocolPublished(meetingDate(m.scheduled_at))]
  const place = m.location?.trim()
  return [
    he.meetings.kinds[m.kind],
    he.share.meetingWhen(meetingDate(m.scheduled_at), meetingTime(m.scheduled_at)),
    ...(place && !isPrivateLine(place) ? [he.share.meetingPlace(clip(place, MAX_LINE))] : []),
  ]
}

/**
 * The text shared to WhatsApp: the title (bold), 2–3 key lines and a deep link into the app, at most
 * MAX_SHARE_LENGTH characters (the middle lines are dropped first; the link always stays whole).
 */
export function buildShareText<K extends ShareKind>(kind: K, item: ShareItems[K]): string {
  const link = `${he.share.details}\n${APP_URL}${shareRoute(kind, item.id)}`
  const title = `*${clip(item.title.trim(), MAX_LINE)}*`
  const lines = keyLines(kind, item)
  const compose = (ls: string[]) => [title, ...ls].join('\n') + `\n\n${link}`
  while (lines.length > 0 && compose(lines).length > MAX_SHARE_LENGTH) lines.pop()
  return compose(lines)
}

export const whatsappUrl = (text: string): string => `https://wa.me/?text=${encodeURIComponent(text)}`

export interface ShareEnv {
  share?: (data: ShareData) => Promise<void>
  /** A touch-first device (phone/tablet): the OS share sheet is the natural choice there. */
  mobile: boolean
}

/** Which way a share goes: the OS sheet on mobile when the Web Share API exists, otherwise a wa.me link. */
export const shareChannel = (env: ShareEnv): 'native' | 'whatsapp' => (env.mobile && typeof env.share === 'function' ? 'native' : 'whatsapp')

/**
 * Shares the text: the OS sheet when available, falling back to wa.me when it fails (not when the user
 * cancels). Returns what happened.
 */
export async function shareText(text: string, env: ShareEnv, open: (url: string) => void): Promise<'native' | 'whatsapp' | 'cancelled'> {
  if (shareChannel(env) === 'native' && env.share) {
    try {
      await env.share({ text })
      return 'native'
    } catch (e) {
      if (e instanceof Error && e.name === 'AbortError') return 'cancelled'
    }
  }
  open(whatsappUrl(text))
  return 'whatsapp'
}

/** The browser's share environment. */
export function browserShareEnv(): ShareEnv {
  const nav = typeof navigator === 'undefined' ? undefined : navigator
  const mobile = typeof window !== 'undefined' && window.matchMedia('(pointer: coarse)').matches
  return { share: nav?.share ? (data) => nav.share(data) : undefined, mobile }
}
