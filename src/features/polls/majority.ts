// The majority math (pure): whether a poll's required majority is reached, with the numbers to show it.
// Mirrors public.poll_outcome() (0031), which stores the outcome at closing; both are tested against the cases in
// supabase/tests/poll_outcome.test.sql. This one serves the live view of open polls.
//   * simple: yes/no passes with more for than against (abstentions and non-voters don't count, a tie fails);
//     single choice picks the option strictly ahead of every other one.
//   * two_thirds / percent: the for votes (single choice: the leading option, without a tie) reach
//     ceil(base × share), the base being every active apartment or the apartments in scope.
import type { MajorityBase, MajorityRule, PollKind, Tally } from './types'

export interface Rule {
  kind: PollKind
  majority: MajorityRule
  percent: number | null
  base: MajorityBase
}

export interface Outcome {
  reached: boolean
  /** Votes needed under a share rule (null for simple). */
  required: number | null
  /** The base apartments counted for a share rule. */
  base: number
  /** Yes/no: the for votes; single choice: the leading option's votes. */
  top: number
  /** Yes/no: the against votes; single choice: the runner-up's votes. */
  next: number
  /** Single choice: the leading option (null when nothing leads or there is a tie). */
  leader: number | null
  tie: boolean
}

/** How many apartments the share is taken of. */
export const baseCount = (base: MajorityBase, t: Pick<Tally, 'building' | 'eligible'>): number =>
  base === 'eligible' ? t.eligible : t.building

/** Votes needed: ceil(base × 2/3) or ceil(base × p / 100), in integers, at least 1; null for simple. */
export function requiredVotes(majority: MajorityRule, percent: number | null, base: number): number | null {
  if (majority === 'simple') return null
  const need = majority === 'two_thirds' ? Math.floor((2 * base + 2) / 3) : Math.floor((base * (percent ?? 100) + 99) / 100)
  return Math.max(1, need)
}

/** The top two counts and whether the top is shared. */
function topTwo(counts: readonly number[]): { top: number; next: number; leader: number | null; tie: boolean } {
  const sorted = [...counts].sort((a, b) => b - a)
  const top = sorted[0] ?? 0
  const next = sorted[1] ?? 0
  const tie = top > 0 && top === next
  return { top, next, tie, leader: top > 0 && !tie ? counts.indexOf(top) : null }
}

export function evaluate(rule: Rule, tally: Tally): Outcome {
  const counts = tally.counts ?? []
  const base = baseCount(rule.base, tally)
  const required = requiredVotes(rule.majority, rule.percent, base)
  if (rule.kind === 'yes_no') {
    const top = counts[0] ?? 0
    const next = counts[1] ?? 0
    const reached = required === null ? top > next : top >= required
    return { reached, required, base, top, next, leader: reached ? 0 : null, tie: top === next }
  }
  const t = topTwo(counts)
  const reached = t.leader !== null && (required === null || t.top >= required)
  return { ...t, reached, required, base, leader: reached ? t.leader : null }
}
