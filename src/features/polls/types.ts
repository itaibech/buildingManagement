// Polls (0031): the shapes the feature works with, narrowed from the generated row types.
import type { Database, Json } from '../../lib/db.types'
import type { Outcome } from './majority'

export const POLL_KINDS = ['yes_no', 'single_choice'] as const
export type PollKind = (typeof POLL_KINDS)[number]
export const MAJORITY_RULES = ['simple', 'two_thirds', 'percent'] as const
export type MajorityRule = (typeof MAJORITY_RULES)[number]
export const MAJORITY_BASES = ['building', 'eligible'] as const
export type MajorityBase = (typeof MAJORITY_BASES)[number]
export const POLL_SCOPES = ['all', 'selected'] as const
export type PollScope = (typeof POLL_SCOPES)[number]
export const VISIBILITIES = ['live', 'after_close'] as const
export type Visibility = (typeof VISIBILITIES)[number]
export const POLL_STATUSES = ['draft', 'open', 'closed'] as const
export type PollStatus = (typeof POLL_STATUSES)[number]

export type PollRow = Database['public']['Tables']['polls']['Row']
export type VoteRow = Database['public']['Tables']['poll_votes']['Row']

export interface Poll {
  id: string
  question: string
  description: string
  kind: PollKind
  /** Single choice: the option labels; yes/no: none (the choices are בעד / נגד / נמנע). */
  options: string[]
  opens_at: string
  closes_at: string
  majority: MajorityRule
  majority_percent: number | null
  majority_base: MajorityBase
  scope: PollScope
  results_visibility: Visibility
  status: PollStatus
  opened_at: string | null
  closed_at: string | null
  /** The apartments in scope (selected scope only). */
  apartmentIds: string[]
}

/**
 * poll_results(): votes per choice (absent while hidden), how many apartments voted, both majority bases, and for a
 * closed poll the outcome stored at closing (poll_outcome() in SQL).
 */
export interface Tally {
  counts: number[] | null
  voted: number
  eligible: number
  building: number
  outcome?: Outcome | null
}

export interface PollVote {
  poll_id: string
  apartment_id: string
  choice: number
  voted_by: string | null
  by_admin: boolean
  voted_at: string
}

const oneOf = <T extends string>(list: readonly T[], v: string, fallback: T): T => list.find((x) => x === v) ?? fallback

export function toPoll(r: PollRow & { poll_apartments?: { apartment_id: string }[] }): Poll {
  return {
    id: r.id, question: r.question, description: r.description, options: r.options, opens_at: r.opens_at, closes_at: r.closes_at,
    kind: oneOf(POLL_KINDS, r.kind, 'yes_no'),
    majority: oneOf(MAJORITY_RULES, r.majority, 'simple'),
    majority_percent: r.majority_percent,
    majority_base: oneOf(MAJORITY_BASES, r.majority_base, 'building'),
    scope: oneOf(POLL_SCOPES, r.scope, 'all'),
    results_visibility: oneOf(VISIBILITIES, r.results_visibility, 'live'),
    status: oneOf(POLL_STATUSES, r.status, 'draft'),
    opened_at: r.opened_at, closed_at: r.closed_at,
    apartmentIds: (r.poll_apartments ?? []).map((a) => a.apartment_id),
  }
}

const isRecord = (v: Json): v is { [key: string]: Json | undefined } => typeof v === 'object' && v !== null && !Array.isArray(v)
const int = (v: Json | undefined): number => (typeof v === 'number' ? v : 0)

const intOrNull = (v: Json | undefined): number | null => (typeof v === 'number' ? v : null)

function toOutcome(o: Json | undefined): Outcome | null {
  if (o === undefined || !isRecord(o)) return null
  return {
    reached: o.reached === true, required: intOrNull(o.required), base: int(o.base), top: int(o.top), next: int(o.next),
    leader: intOrNull(o.leader), tie: o.tie === true,
  }
}

/** The RPC's JSON as a Tally; null when the caller may not see the poll. */
export function toTally(j: Json | null): Tally | null {
  if (j === null || !isRecord(j)) return null
  const counts = Array.isArray(j.counts) ? j.counts.map((c) => int(c)) : null
  return { counts, voted: int(j.voted), eligible: int(j.eligible), building: int(j.building), outcome: toOutcome(j.outcome) }
}

/** The labels of a poll's choices, in choice order. */
export const choiceLabels = (p: Pick<Poll, 'kind' | 'options'>, yesNo: readonly string[]): readonly string[] =>
  p.kind === 'yes_no' ? yesNo : p.options
