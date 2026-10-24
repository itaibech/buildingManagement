import { useMediaQuery } from '@mantine/hooks'
import { useMemo } from 'react'
import { he } from '../../lib/he'
import { useApartments, useResidents } from '../tenants/api'
import { useBalances, useBudgets, useExpenseReport, useExpenses, useFeeTimeline, type ApartmentBalance } from './api'
import { currentMonth, nextChange, type TimelineRow } from './feeTimeline'
import { budgetVsActual } from './ledger'

/** Desktop (≥768px) gets tables; mobile gets lists. */
export function useDesktop(): boolean {
  return useMediaQuery('(min-width: 768px)') ?? false
}

export interface ApartmentOption {
  value: string
  label: string
  number: number
  names: string
}

/** Apartments as select options: "דירה 3 · שם הדייר". */
export function useApartmentOptions(): ApartmentOption[] {
  const apartments = useApartments()
  const residents = useResidents()
  return useMemo(() => (apartments.data ?? []).map((a) => {
    const names = (residents.data ?? []).filter((r) => r.apartment_id === a.id).map((r) => r.full_name).join(', ')
    return { value: a.id, number: a.number, names, label: names ? `${he.apartment(a.number)} · ${names}` : he.apartment(a.number) }
  }), [apartments.data, residents.data])
}

/** Apartment id → number and residents, for plates in lists. */
export function useApartmentInfo(): Map<string, ApartmentOption> {
  const options = useApartmentOptions()
  return useMemo(() => new Map(options.map((o) => [o.value, o])), [options])
}

/** Planned vs actual for a year, from the budgets and expenses queries. */
export function useBudgetRows(year: number) {
  const budgets = useBudgets(year)
  const expenses = useExpenses(year)
  const rows = useMemo(() => (budgets.data && expenses.data ? budgetVsActual(budgets.data, expenses.data, year) : undefined), [budgets.data, expenses.data, year])
  const refetch = () => { void budgets.refetch(); void expenses.refetch() }
  return { rows, isLoading: budgets.isLoading || expenses.isLoading, isError: budgets.isError || expenses.isError, refetch }
}

/** Planned vs actual from the aggregate report (residents with finance_reports: no raw expense rows). */
export function useReportBudgetRows(year: number) {
  const budgets = useBudgets(year)
  const report = useExpenseReport(year)
  const rows = useMemo(() => (budgets.data && report.data
    ? budgetVsActual(budgets.data, report.data.map((r) => ({ category: r.category, spent_on: r.month, amount: r.total })), year)
    : undefined), [budgets.data, report.data, year])
  const refetch = () => { void budgets.refetch(); void report.refetch() }
  return { rows, isLoading: budgets.isLoading || report.isLoading, isError: budgets.isError || report.isError, refetch }
}

/** Ids of the templates already posted as expenses on the first of `month`. */
export function useAppliedTemplates(month: string): ReadonlySet<string> {
  const expenses = useExpenses(Number(month.slice(0, 4)))
  return useMemo(() => new Set((expenses.data ?? []).flatMap((e) => (e.template_id && e.spent_on === month ? [e.template_id] : []))), [expenses.data, month])
}

export interface ApartmentFeeRow extends ApartmentBalance {
  /** This apartment's timeline, newest first. */
  timeline: TimelineRow[]
  /** The next scheduled change after this month, if any. */
  next: TimelineRow | null
}

/** Every apartment's current fee, its source, its history and the next scheduled change (by apartment number). */
export function useApartmentFees() {
  const balances = useBalances()
  const timeline = useFeeTimeline()
  const data = useMemo((): ApartmentFeeRow[] | undefined => {
    if (!balances.data || !timeline.data) return undefined
    const month = currentMonth()
    return [...balances.data].sort((a, b) => a.number - b.number).map((b) => {
      const rows = timeline.data.filter((t) => t.apartment_id === b.apartmentId)
      return { ...b, timeline: rows, next: nextChange(rows, month) }
    })
  }, [balances.data, timeline.data])
  const refetch = () => { balances.refetch(); void timeline.refetch() }
  return { data, isLoading: balances.isLoading || timeline.isLoading, isError: balances.isError || timeline.isError, refetch }
}
