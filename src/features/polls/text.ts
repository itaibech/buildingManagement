// Poll wording built from the majority math: the rule's name and preview, the math line, the decision, and the
// result text pasted into a meeting protocol as an addendum.
import { he } from '../../lib/he'
import { meetingDate, meetingTime } from '../meetings/fmt'
import type { PollPhase } from './lifecycle'
import { evaluate, requiredVotes, type Outcome, type Rule } from './majority'
import { choiceLabels, type Poll, type Tally } from './types'

const P = he.polls

export const ruleOf = (p: Pick<Poll, 'kind' | 'majority' | 'majority_percent' | 'majority_base'>): Rule =>
  ({ kind: p.kind, majority: p.majority, percent: p.majority_percent, base: p.majority_base })

/** "רוב רגיל", "שני שלישים מכלל הדירות", "60% מהדירות המשתתפות". */
export function ruleName(rule: Rule): string {
  if (rule.majority === 'simple') return P.rules.simple
  if (rule.majority === 'percent') return P.percentName(rule.percent ?? 0, P.bases[rule.base])
  return P.ruleName(P.rules.two_thirds, P.bases[rule.base])
}

/** The form's preview: what passes, in numbers for the base it counts. */
export function rulePreview(rule: Rule, base: number): string {
  const required = requiredVotes(rule.majority, rule.percent, base)
  if (required === null) return rule.kind === 'yes_no' ? P.preview.simpleYesNo : P.preview.simpleChoice
  return rule.kind === 'yes_no' ? P.preview.share(required, base) : P.preview.shareChoice(required, base)
}

/** The math: "נדרשו 13 מתוך 19, הצביעו בעד 11", or the simple-majority counts. */
export function mathLine(rule: Rule, o: Outcome, labels: readonly string[]): string {
  const M = P.majority
  if (rule.kind === 'yes_no') {
    if (o.required !== null) return M.requiredOf(o.required, o.base, o.top)
    return o.tie && o.top > 0 ? M.simpleTie(o.top, o.next) : M.simpleYesNo(o.top, o.next)
  }
  if (o.top === 0) return M.noVotes
  if (o.tie) return M.optionTie(o.top)
  const leader = o.leader ?? -1
  const name = labels[leader] ?? labels[0] ?? ''
  return o.required !== null ? M.requiredOfOption(o.required, o.base, name, o.top) : M.simpleOption(name, o.top, o.next)
}

/** The decision in words: closed polls say what was decided, open ones whether there is a majority so far. */
export function decisionLabel(kind: Poll['kind'], o: Outcome, closed: boolean, labels: readonly string[]): string {
  const M = P.majority
  if (!closed) return o.reached ? M.reached : M.notReached
  if (kind === 'yes_no') return o.reached ? M.passed : M.failed
  return o.reached && o.leader !== null ? M.chosen(labels[o.leader] ?? '') : M.noDecision
}

const at = (iso: string): string => `${meetingDate(iso)} ${meetingTime(iso)}`

/** The result as plain text, for "הוספה לפרוטוקול" (copied, then pasted as a meeting addendum). */
export function protocolText(poll: Poll, tally: Tally, scopeNumbers: readonly number[]): string {
  const rule = ruleOf(poll)
  const labels = choiceLabels(poll, P.yesNo)
  const o = tally.outcome ?? evaluate(rule, tally)
  const counts = labels.map((l, i) => `${l}: ${tally.counts?.[i] ?? 0}`).join(' · ')
  return [
    P.protocol.heading,
    P.protocol.question(poll.question),
    P.protocol.window(at(poll.opens_at), at(poll.closed_at ?? poll.closes_at)),
    poll.scope === 'selected' ? P.protocol.scope(scopeNumbers.join(', ')) : null,
    P.participation(tally.voted, tally.eligible),
    counts,
    P.protocol.rule(`${ruleName(rule)}. ${mathLine(rule, o, labels)}`),
    P.protocol.outcome(decisionLabel(poll.kind, o, poll.status === 'closed', labels)),
  ].filter((l): l is string => l !== null).join('\n')
}

/** The poll's time in words: when it opens, until when it runs, or when it ended. */
export function windowText(p: Poll, phase: PollPhase): string | null {
  if (phase === 'draft') return null
  if (phase === 'upcoming') return P.opensAt(meetingDate(p.opens_at), meetingTime(p.opens_at))
  if (phase === 'voting') return P.until(meetingDate(p.closes_at), meetingTime(p.closes_at))
  return P.endedOn(meetingDate(p.closed_at ?? p.closes_at))
}
