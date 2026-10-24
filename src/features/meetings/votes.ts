import { he } from '../../lib/he'
import type { Votes } from './types'

export const voteTotal = (v: Votes): number => v.for + v.against + v.abstain

/** Why the counts can't be saved, or null: no negatives, and the total at most the attendees (proxies included). */
export function voteError(v: Votes, attending: number): string | null {
  if ([v.for, v.against, v.abstain].some((n) => !Number.isInteger(n) || n < 0)) return he.meetings.vote.invalid
  const total = voteTotal(v)
  return total > attending ? he.meetings.vote.tooMany(total, attending) : null
}

/** "פה אחד": everyone present votes for. */
export const unanimous = (attending: number): Votes => ({ for: attending, against: 0, abstain: 0 })
