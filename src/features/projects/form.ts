// The project form's values and their mapping to the projects row. Pure.
import { he } from '../../lib/he'
import type { Project, ProjectInput, ProjectStatus } from './types'

export interface ProjectValues {
  title: string
  description: string
  status: ProjectStatus
  estimated: number | string
  final: number | string
  start: string
  end: string
  /** '' = no levy. */
  levy: string
  /** '' = every month of the levy. */
  levyMonth: string
}

const F = he.projects.form

export function toValues(p?: Project): ProjectValues {
  return {
    title: p?.title ?? '', description: p?.description ?? '', status: p?.status ?? 'planning',
    estimated: p?.estimated_cost ?? '', final: p?.final_cost ?? '', start: p?.start_date ?? '', end: p?.end_date ?? '',
    levy: p?.levy_label ?? '', levyMonth: p?.levy_month ?? '',
  }
}

const money = (v: number | string): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null)
const date = (v: string): string | null => (v ? v : null)

export function toInput(v: ProjectValues): ProjectInput {
  const levy = v.levy.trim()
  return {
    title: v.title.trim(), description: v.description.trim(), status: v.status,
    estimated_cost: money(v.estimated), final_cost: money(v.final), start_date: date(v.start), end_date: date(v.end),
    levy_label: levy || null, levy_month: levy && v.levyMonth ? v.levyMonth : null,
  }
}

const amount = (v: number | string): string | null => (v === '' || (typeof v === 'number' && v >= 0 && v <= 100_000_000) ? null : F.positive)

export const validate = {
  title: (v: string): string | null => (!v.trim() ? F.required : v.trim().length > 200 ? F.tooLong(200) : null),
  description: (v: string): string | null => (v.length > 4000 ? F.tooLong(4000) : null),
  estimated: amount,
  final: amount,
  end: (v: string, all: ProjectValues): string | null => (v && all.start && v < all.start ? F.endBeforeStart : null),
}
