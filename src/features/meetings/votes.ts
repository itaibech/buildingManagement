import { he } from '../../lib/he'
import type { AgendaItem, Votes } from './types'

export const voteTotal = (v: Votes): number => v.for + v.against + v.abstain

/** Why the counts can't be saved, or null: no negatives, and the total at most the attendees (proxies included). */
export function voteError(v: Votes, attending: number): string | null {
  if ([v.for, v.against, v.abstain].some((n) => !Number.isInteger(n) || n < 0)) return he.meetings.vote.invalid
  const total = voteTotal(v)
  return total > attending ? he.meetings.vote.tooMany(total, attending) : null
}

/**
 * The attendee count a vote is checked against: the attendance stored when it was entered (attendees_at_vote, so
 * later arrivals and departures don't change it), or the current attendance for a vote being entered now.
 */
export const voteLimit = (item: Pick<AgendaItem, 'attendees_at_vote'>, attending: number): number => item.attendees_at_vote ?? attending

/** "פה אחד": everyone present votes for. */
export const unanimous = (attending: number): Votes => ({ for: attending, against: 0, abstain: 0 })
