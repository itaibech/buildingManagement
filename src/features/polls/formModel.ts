// The poll form's values, rules and conversion (shared by PollForm and its field groups).
import { useForm } from '@mantine/form'
import { he } from '../../lib/he'
import { fromInputs, toInputs } from '../meetings/fmt'
import type { PollInput } from './api'
import type { MajorityBase, MajorityRule, Poll, PollKind, PollScope, Visibility } from './types'

const E = he.polls.form.errors
const WEEK_MS = 7 * 86_400_000

export interface OptionRow { key: string; label: string }

export interface Values {
  question: string
  description: string
  kind: PollKind
  options: OptionRow[]
  opensDate: string
  opensTime: string
  closesDate: string
  closesTime: string
  majority: MajorityRule
  percent: number | string
  base: MajorityBase
  scope: PollScope
  apartmentIds: string[]
  visibility: Visibility
}

const row = (label = ''): OptionRow => ({ key: crypto.randomUUID(), label })

export function initial(p: Poll | undefined, now: Date = new Date()): Values {
  const opens = toInputs(p?.opens_at ?? now)
  const closes = p ? toInputs(p.closes_at) : { date: toInputs(new Date(now.getTime() + WEEK_MS)).date, time: '20:00' }
  return {
    question: p?.question ?? '', description: p?.description ?? '', kind: p?.kind ?? 'yes_no',
    options: p?.options.length ? p.options.map((o) => row(o)) : [row(), row()],
    opensDate: opens.date, opensTime: opens.time, closesDate: closes.date, closesTime: closes.time,
    majority: p?.majority ?? 'simple', percent: p?.majority_percent ?? '', base: p?.majority_base ?? 'building',
    scope: p?.scope ?? 'all', apartmentIds: p?.apartmentIds ?? [], visibility: p?.results_visibility ?? 'live',
  }
}

const closesOk = (v: Values): boolean => {
  if (!v.opensDate || !v.opensTime || !v.closesDate || !v.closesTime) return false
  const closes = Date.parse(fromInputs(v.closesDate, v.closesTime))
  return closes > Date.parse(fromInputs(v.opensDate, v.opensTime)) && closes > Date.now()
}

export const validate = {
  question: (v: string) => (v.trim() && v.trim().length <= 300 ? null : E.question),
  options: (rows: OptionRow[], all: Values) =>
    all.kind === 'yes_no' || (rows.length >= 2 && rows.length <= 10 && rows.every((r) => r.label.trim())) ? null : E.options,
  opensDate: (v: string, all: Values) => (v && all.opensTime ? null : E.date),
  closesDate: (_v: string, all: Values) => (closesOk(all) ? null : E.closes),
  percent: (v: number | string, all: Values) => (all.majority !== 'percent' || (typeof v === 'number' && v >= 1 && v <= 100) ? null : E.percent),
  apartmentIds: (v: string[], all: Values) => (all.scope === 'all' || v.length > 0 ? null : E.apartments),
}

export function toInput(v: Values): PollInput {
  return {
    question: v.question.trim(), description: v.description.trim(), kind: v.kind,
    options: v.kind === 'yes_no' ? [] : v.options.map((o) => o.label.trim()),
    opens_at: fromInputs(v.opensDate, v.opensTime), closes_at: fromInputs(v.closesDate, v.closesTime),
    majority: v.majority, majority_percent: v.majority === 'percent' && typeof v.percent === 'number' ? v.percent : null,
    majority_base: v.base, scope: v.scope, results_visibility: v.visibility,
    apartmentIds: v.scope === 'selected' ? v.apartmentIds : [],
  }
}

export const newOption = (): OptionRow => row()

export const usePollForm = (poll: Poll | undefined) => useForm<Values>({ mode: 'controlled', initialValues: initial(poll), validate })
export type PollFormApi = ReturnType<typeof usePollForm>
