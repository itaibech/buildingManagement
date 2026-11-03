/** Projects: the progress math, the quote comparison and the status timeline. Pure; money summed in agorot. */
import { PROJECT_STATUSES, type LevyOption, type Progress, type Project, type ProjectEvent, type ProjectStatus, type Quote } from './types'

const ag = (n: number): number => Math.round(n * 100)
const ils = (agorot: number): number => agorot / 100

/** A whole percentage of `part` in `whole`, 0–100 (0 when there is no whole). */
export function percent(part: number, whole: number): number {
  const w = ag(whole)
  if (w <= 0) return 0
  return Math.min(100, Math.max(0, Math.round((ag(part) / w) * 100)))
}

export type CostSource = 'final' | 'chosen' | 'estimated'

/** What the project costs: the final cost once known, else the chosen quote, else the estimate (null: not set). */
export function projectCost(p: Pick<Project, 'final_cost' | 'estimated_cost' | 'chosen_amount'>): { amount: number; source: CostSource } | null {
  if (p.final_cost !== null) return { amount: p.final_cost, source: 'final' }
  if (p.chosen_amount !== null) return { amount: p.chosen_amount, source: 'chosen' }
  if (p.estimated_cost !== null) return { amount: p.estimated_cost, source: 'estimated' }
  return null
}

export interface ProgressSummary {
  cost: number | null
  costSource: CostSource | null
  hasLevy: boolean
  collected: number
  due: number
  /** Written off ("נמחק"), neither collected nor owed. */
  writtenOff: number
  /** Levy charged for later months (not owed yet). */
  scheduled: number
  collectedPct: number
  spent: number
  spentPct: number
  /** Cost minus what was collected (never negative); null without a cost. */
  gap: number | null
}

/** The progress card's numbers: collected of the levy owed so far, and spent of the cost. */
export function summarize(project: Project, progress: Progress): ProgressSummary {
  const cost = projectCost(project)
  const hasLevy = project.levy_label !== null
  return {
    cost: cost?.amount ?? null,
    costSource: cost?.source ?? null,
    hasLevy,
    collected: progress.levyCollected,
    due: progress.levyDue,
    writtenOff: progress.levyWrittenOff,
    scheduled: ils(Math.max(ag(progress.levyTotal) - ag(progress.levyDue), 0)),
    collectedPct: percent(progress.levyCollected, progress.levyDue),
    spent: progress.spent,
    spentPct: cost ? percent(progress.spent, cost.amount) : 0,
    gap: cost ? ils(Math.max(ag(cost.amount) - ag(progress.levyCollected), 0)) : null,
  }
}

/** The list's single bar: the levy collection when there is a levy, else the spending against the cost. */
export function listBar(s: ProgressSummary): { kind: 'collected' | 'spent'; pct: number } | null {
  if (s.hasLevy && s.due > 0) return { kind: 'collected', pct: s.collectedPct }
  if (s.cost !== null && s.cost > 0) return { kind: 'spent', pct: s.spentPct }
  return null
}

export interface ComparedQuote {
  quote: Quote
  cheapest: boolean
  /** Above the cheapest quote, in ₪ and whole percent (0 for the cheapest). */
  aboveCheapest: number
  abovePct: number
  /** Against the project's estimate (positive = above it); null without an estimate. */
  vsEstimate: number | null
}

/** Side-by-side comparison: cheapest first (ties by vendor, then oldest), each against the cheapest and the estimate. */
export function compareQuotes(quotes: readonly Quote[], estimate: number | null): ComparedQuote[] {
  const sorted = [...quotes].sort((a, b) => ag(a.amount) - ag(b.amount) || a.vendor.localeCompare(b.vendor, 'he') || a.created_at.localeCompare(b.created_at))
  const min = sorted[0] ? ag(sorted[0].amount) : 0
  return sorted.map((quote) => {
    const above = ag(quote.amount) - min
    return {
      quote,
      cheapest: above === 0,
      aboveCheapest: ils(above),
      abovePct: min > 0 ? Math.round((above / min) * 100) : 0,
      vsEstimate: estimate === null ? null : ils(ag(quote.amount) - ag(estimate)),
    }
  })
}

export type StepState = 'done' | 'current' | 'upcoming'
export interface TimelineStep { status: ProjectStatus; state: StepState; at: string | null }

const PATH: readonly ProjectStatus[] = PROJECT_STATUSES.filter((s) => s !== 'cancelled')

/**
 * The status timeline: the normal path (planning → done) with the date each step was last reached. Steps before the
 * current one count as done even when skipped. A cancelled project shows the steps it reached, then "בוטל".
 */
export function timeline(status: ProjectStatus, events: readonly ProjectEvent[]): TimelineStep[] {
  const at = new Map<ProjectStatus, string>()
  for (const e of [...events].sort((a, b) => a.created_at.localeCompare(b.created_at))) at.set(e.status, e.created_at)
  if (status === 'cancelled') {
    const reached = PATH.filter((s) => at.has(s)).map((s): TimelineStep => ({ status: s, state: 'done', at: at.get(s) ?? null }))
    return [...reached, { status: 'cancelled', state: 'current', at: at.get('cancelled') ?? null }]
  }
  const current = PATH.indexOf(status)
  return PATH.map((s, i) => ({
    status: s,
    state: i < current ? 'done' : i === current ? (s === 'done' ? 'done' : 'current') : 'upcoming',
    at: i <= current ? at.get(s) ?? null : null,
  }))
}

/** Distinct trimmed labels (empty ones skipped), each with its months ascending; labels in Hebrew order. */
export function groupLevies(rows: readonly { label: string; month: string }[]): LevyOption[] {
  const by = new Map<string, Set<string>>()
  for (const r of rows) {
    const label = r.label.trim()
    if (label) by.set(label, (by.get(label) ?? new Set()).add(r.month))
  }
  return [...by].map(([label, months]) => ({ label, months: [...months].sort() })).sort((a, b) => a.label.localeCompare(b.label, 'he'))
}
