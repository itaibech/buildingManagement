import { useMediaQuery } from '@mantine/hooks'
import { useMemo } from 'react'
import { he } from '../../lib/he'
import { useApartments, useResidents } from '../tenants/api'
import { useBudgets, useExpenses } from './api'
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

/** Ids of the templates already posted as expenses on the first of `month`. */
export function useAppliedTemplates(month: string): ReadonlySet<string> {
  const expenses = useExpenses(Number(month.slice(0, 4)))
  return useMemo(() => new Set((expenses.data ?? []).flatMap((e) => (e.template_id && e.spent_on === month ? [e.template_id] : []))), [expenses.data, month])
}
