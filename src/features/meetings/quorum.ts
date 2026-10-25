import { he } from '../../lib/he'
import { ruleOf, type AttendanceStatus, type Meeting, type QuorumRule } from './types'

/** Apartments needed (mirrors public.meeting_quorum): none 0, majority floor(N/2)+1, a % rounded up (≥ 1), or a fixed number. */
export function requiredQuorum(rule: QuorumRule, total: number): number {
  if (rule.mode === 'none') return 0
  if (rule.mode === 'percent') return Math.max(1, Math.ceil((total * (rule.value ?? 0)) / 100))
  if (rule.mode === 'fixed') return rule.value ?? 1
  return Math.floor(total / 2) + 1
}

export const isAttending = (s: AttendanceStatus): boolean => s === 'present' || s === 'proxy'

export const attendingCount = (rows: readonly { status: AttendanceStatus }[]): number => rows.filter((r) => isAttending(r.status)).length

/** none: the rule is "ללא דרישת מניין" (always met). */
export interface QuorumState { total: number; attending: number; required: number; met: boolean; postponed: boolean; valid: boolean; none: boolean }

/** `valid`: the meeting may open — the quorum is met, or it was postponed by an hour (then any attendance counts). */
export function quorumState(rule: QuorumRule, total: number, rows: readonly { status: AttendanceStatus }[], postponed: boolean): QuorumState {
  const attending = attendingCount(rows)
  const required = requiredQuorum(rule, total)
  const met = attending >= required
  return { total, attending, required, met, postponed, valid: met || postponed, none: rule.mode === 'none' }
}

/** The rule in words: "נדרש מניין: 9 מתוך 17 דירות" (plus the bylaws note). */
export function quorumText(m: Pick<Meeting, 'quorum_mode' | 'quorum_value' | 'quorum_note'>, total: number): string {
  const base = m.quorum_mode === 'none' ? he.meetings.form.quorumModes.none : he.meetings.form.quorumRequired(requiredQuorum(ruleOf(m), total), total)
  return m.quorum_note ? `${base} · ${m.quorum_note}` : base
}
