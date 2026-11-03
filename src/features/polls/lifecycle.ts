import type { Poll } from './types'

/** Where a poll stands now: an open poll is upcoming before opens_at and ended (awaiting closing) after closes_at. */
export type PollPhase = 'draft' | 'upcoming' | 'voting' | 'ended' | 'closed'
export type PollTab = 'open' | 'ended' | 'drafts'

export function phaseOf(p: Pick<Poll, 'status' | 'opens_at' | 'closes_at'>, now: Date = new Date()): PollPhase {
  if (p.status !== 'open') return p.status
  const t = now.getTime()
  if (t < Date.parse(p.opens_at)) return 'upcoming'
  return t < Date.parse(p.closes_at) ? 'voting' : 'ended'
}

/** פתוחים (upcoming or voting) / שהסתיימו (ended or closed) / טיוטות (admins). */
export function tabOf(p: Pick<Poll, 'status' | 'opens_at' | 'closes_at'>, now: Date = new Date()): PollTab {
  const phase = phaseOf(p, now)
  if (phase === 'draft') return 'drafts'
  return phase === 'ended' || phase === 'closed' ? 'ended' : 'open'
}

/** The badge state: the stored status, with an open poll past its closing time shown as awaiting closing. */
export const badgeOf = (phase: PollPhase): 'draft' | 'open' | 'ended' | 'closed' =>
  phase === 'upcoming' || phase === 'voting' ? 'open' : phase

/** May this apartment vote in the poll (scope only; the window is the phase)? */
export const inScope = (p: Pick<Poll, 'scope' | 'apartmentIds'>, apartmentId: string | null): boolean =>
  apartmentId !== null && (p.scope === 'all' || p.apartmentIds.includes(apartmentId))
