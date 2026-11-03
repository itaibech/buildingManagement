/**
 * Automatic debt follow-up ("מעקב חובות", 0035). Pure, no I/O. Mirrors public.debt_followup_candidates / _step / _run:
 * the server decides and records; the app uses this for the apartment timeline ("הצעד הבא בעוד X ימים").
 * Days overdue count from the first day of the oldest unpaid month, the month settlementPlan (0017) allocates first.
 */
import type { LedgerRow } from '../finance/ledger'
import { ledgerBalance, settlementPlan } from '../finance/settlement'

export type Step = 1 | 2 | 3
export const STEPS: readonly Step[] = [1, 2, 3]

export interface FollowupSettings {
  enabled: boolean
  minAmount: number
  friendlyOn: boolean
  friendlyDays: number
  firmOn: boolean
  firmDays: number
  letterOn: boolean
  letterDays: number
}

/** The server's defaults (a building without a settings row): off, ₪50, 10 / 30 / 60 days. */
export const DEFAULT_SETTINGS: FollowupSettings = {
  enabled: false, minAmount: 50, friendlyOn: true, friendlyDays: 10, firmOn: true, firmDays: 30, letterOn: true, letterDays: 60,
}

/** review: a send died after claiming the row; unknown whether the email went out (the admin resolves it). */
export const FOLLOWUP_STATUSES = ['pending', 'sending', 'sent', 'review', 'open', 'done', 'skipped'] as const
export type FollowupStatus = (typeof FOLLOWUP_STATUSES)[number]
export const SKIP_REASONS = ['paid', 'archived', 'exempt', 'below_min', 'stale', 'superseded'] as const
export type SkipReason = (typeof SKIP_REASONS)[number]

export const isStep = (v: unknown): v is Step => v === 1 || v === 2 || v === 3
export const isFollowupStatus = (v: unknown): v is FollowupStatus => FOLLOWUP_STATUSES.some((s) => s === v)
export const isSkipReason = (v: unknown): v is SkipReason => SKIP_REASONS.some((s) => s === v)

/** A debt_followups row as the app reads it. */
export interface Followup {
  id: string
  apartmentId: string
  step: Step
  status: FollowupStatus
  skipReason: SkipReason | null
  debtAmount: number
  oldestMonth: string
  daysOverdue: number
  createdAt: string
  sentAt: string | null
  doneAt: string | null
  recipients: number | null
  episodeClosedAt: string | null
}

/** Why an apartment gets no follow-up today (null = it does, if a step is due). */
export type Skip = 'paid' | 'archived' | 'exempt' | 'below_min' | null

export interface DebtState { balance: number; oldestMonth: string | null; days: number | null; skip: Skip }

const DAY = 86_400_000

/** The first open month after credit and partial payments are allocated oldest first; null when nothing is owed. */
export function oldestOpenMonth(rows: readonly LedgerRow[]): string | null {
  return settlementPlan(rows, ledgerBalance(rows))[0]?.month ?? null
}

/** Whole days from the first of `month` to `today` (both YYYY-MM-DD). */
export const daysOverdue = (month: string, today: string): number => Math.round((Date.parse(today) - Date.parse(month)) / DAY)

/** One apartment's debt as the daily job sees it. `exempt`: this month's fee mode is exempt. */
export function debtState(rows: readonly LedgerRow[], flags: { archived: boolean; exempt: boolean }, settings: FollowupSettings, today: string): DebtState {
  const balance = ledgerBalance(rows)
  const oldestMonth = oldestOpenMonth(rows)
  const days = oldestMonth ? daysOverdue(oldestMonth, today) : null
  const skip: Skip = flags.archived ? 'archived'
    : balance <= 0 || !oldestMonth ? 'paid'
      : flags.exempt ? 'exempt'
        : Math.round(balance * 100) < Math.round(settings.minAmount * 100) ? 'below_min' : null
  return { balance, oldestMonth, days, skip }
}

/** The days threshold of a step, or null while that step is switched off. */
export function stepDays(step: Step, s: FollowupSettings): number | null {
  if (step === 1) return s.friendlyOn ? s.friendlyDays : null
  if (step === 2) return s.firmOn ? s.firmDays : null
  return s.letterOn ? s.letterDays : null
}

/** The days limit of each step (the database's checks). */
export const maxDays = (step: Step): number => (step === 3 ? 730 : 365)

/** Whether `step` itself is due at `days`: switched on and its threshold passed (public.debt_followup_step_due). */
export function stepDue(step: Step, days: number, s: FollowupSettings): boolean {
  const d = stepDays(step, s)
  return d !== null && days >= d
}

/** The highest switched-on step whose threshold `days` has reached. */
export function stepFor(days: number, s: FollowupSettings): Step | null {
  return [...STEPS].reverse().find((step) => { const d = stepDays(step, s); return d !== null && days >= d }) ?? null
}

/** A row that counts as done in its episode: anything not skipped before it happened. */
export const counts = (f: Followup): boolean => f.status !== 'skipped'

/** The current episode's rows (not closed by a payoff). */
export const openEpisode = (rows: readonly Followup[]): Followup[] => rows.filter((f) => f.episodeClosedAt === null)

/** The episode's debt: its earliest recorded oldest month (null with no rows). */
const episodeMonth = (episode: readonly Followup[]): string | null =>
  episode.reduce<string | null>((m, f) => (m === null || f.oldestMonth < m ? f.oldestMonth : m), null)

/**
 * Whether the episode is over: paid off, archived, or the oldest unpaid month moved past the episode's (the debt it
 * was about was paid; what is open now is a new debt).
 */
export function episodeOver(state: DebtState, episode: readonly Followup[]): boolean {
  if (!episode.length) return false
  const month = episodeMonth(episode)
  return state.skip === 'paid' || state.skip === 'archived' || (state.oldestMonth !== null && month !== null && state.oldestMonth > month)
}

/**
 * What a run does for one apartment: close the episode, and the step to record today, if any (once per episode:
 * never a step at or below one already done; a closed episode starts over).
 */
export function runDecision(state: DebtState, episode: readonly Followup[], s: FollowupSettings): { close: boolean; create: Step | null } {
  if (!s.enabled) return { close: false, create: null }
  const close = episodeOver(state, episode)
  if (state.skip || state.days === null) return { close, create: null }
  const step = stepFor(state.days, s)
  const open = close ? [] : episode
  const done = open.some((f) => counts(f) && step !== null && f.step >= step)
  return { close, create: step !== null && !done ? step : null }
}

/** Whether a pending email may still be sent now (public.debt_followup_sendable): same debt, eligible, step still due. */
export function sendable(f: Followup, state: DebtState, episode: readonly Followup[], s: FollowupSettings): boolean {
  return s.enabled && f.status === 'pending' && f.step !== 3 && !state.skip && state.days !== null
    && !episodeOver(state, episode) && stepDue(f.step, state.days, s)
}

/** The next step still ahead in this episode and how many days until it is due (0 = due at the next run). */
export function nextStep(state: DebtState, episode: readonly Followup[], s: FollowupSettings): { step: Step; inDays: number } | null {
  if (!s.enabled || state.skip || state.days === null) return null
  const top = Math.max(0, ...episode.filter(counts).map((f) => f.step))
  for (const step of STEPS) {
    const d = stepDays(step, s)
    if (step > top && d !== null) return { step, inDays: Math.max(0, d - state.days) }
  }
  return null
}

/** A timestamp's calendar day in Israel, YYYY-MM-DD. */
export const israelDay = (iso: string): string => new Date(iso).toLocaleDateString('en-CA', { timeZone: 'Asia/Jerusalem' })
