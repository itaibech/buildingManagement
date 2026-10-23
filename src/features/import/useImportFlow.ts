// State and derived data for the import flow. All the admin's choices live here, so going back a step never
// loses an edit; what the system already holds (fees, budgets, expenses, categories) feeds the guards.
import { useMemo, useState } from 'react'
import { useBudgets, useExpenses, useFeeSchedule } from '../finance/api'
import { useChargers } from '../ev/api'
import { useExpenseCategories } from '../maintenance/api'
import {
  budgetUpdates, buildImport, feesToReplace, findOverlaps, initialFees, NEW_CATEGORY, overlapKey,
  type ExistingExpense, type ExistingFee, type FeeEntry, type ImportOptions,
} from './buildImport'
import type { ColumnMap } from './parseWorkbook'
import type { EvInfo, LevyLine } from './PreviewStep'
import type { ReadResult } from './readWorkbook'

export interface ImportContext {
  fees: ExistingFee[]; budgets: string[]; expenses: ExistingExpense[]; categories: string[]
  /** EV chargers exist: EV is billed from meter readings, so the workbook's EV block defaults to excluded. */
  hasChargers: boolean
  loading: boolean
}

export function useImportContext(year: number, budgetYear: number): ImportContext {
  const fees = useFeeSchedule()
  const budgets = useBudgets(budgetYear)
  const expenses = useExpenses(year)
  const categories = useExpenseCategories()
  const chargers = useChargers()
  return useMemo(() => ({
    fees: fees.data ?? [],
    budgets: (budgets.data ?? []).map((b) => b.category),
    expenses: (expenses.data ?? []).map((e) => ({ category: e.category, spent_on: e.spent_on, source: e.source })),
    categories: (categories.data ?? []).map((c) => c.name),
    hasChargers: (chargers.data ?? []).length > 0,
    loading: fees.isLoading || budgets.isLoading || expenses.isLoading || categories.isLoading || chargers.isLoading,
  }), [fees.data, budgets.data, expenses.data, categories.data, chargers.data, fees.isLoading, budgets.isLoading, expenses.isLoading, categories.isLoading, chargers.isLoading])
}

export function useImportState() {
  const [read, setRead] = useState<ReadResult | null>(null)
  const [columns, setColumns] = useState<ColumnMap[]>([])
  const [feesEdit, setFees] = useState<FeeEntry[] | null>(null)
  const [choice, setChoice] = useState<Record<string, string>>({})
  const [year, setYear] = useState(0)
  const [budgetYear, setBudgetYear] = useState(0)
  /** null = the default (exclude when EV chargers exist). */
  const [includeEv, setIncludeEv] = useState<boolean | null>(null)
  const [importOverlaps, setImportOverlaps] = useState(false)
  const load = (r: ReadResult): void => {
    setRead(r)
    setColumns(r.parsed.income.columns)
    setFees(null)
    setChoice({})
    setYear(r.parsed.income.year)
    setBudgetYear(r.parsed.budget.year)
    setIncludeEv(null)
    setImportOverlaps(false)
  }
  return {
    read, load, columns, setColumns, feesEdit, setFees, choice, setChoice, year, setYear, budgetYear, setBudgetYear,
    includeEv, setIncludeEv, importOverlaps, setImportOverlaps,
  }
}
export type ImportState = ReturnType<typeof useImportState>

function categoryChoices(st: ImportState, existing: string[]) {
  const names = [...new Set([
    ...(st.read?.parsed.expenses.map((e) => e.category) ?? []), ...(st.read?.parsed.budget.items.map((i) => i.category) ?? []),
  ])]
  const resolved = Object.fromEntries(names.map((n) => [n, st.choice[n] ?? (existing.includes(n) ? n : NEW_CATEGORY)]))
  const categoryMap = Object.fromEntries(Object.entries(resolved).filter(([, v]) => v !== NEW_CATEGORY))
  return { names, resolved, categoryMap }
}

const levyLines = (columns: ColumnMap[]): LevyLine[] => columns.flatMap((c) =>
  c.proposal.kind === 'levy' && c.proposal.month ? [{ col: c.col, month: c.proposal.month, amount: c.proposal.amount ?? 0 }] : [])

/** Everything computed from the state: fees prefill, category mapping, the payload and the guard notices. */
export function useDerived(st: ImportState, ctx: ImportContext) {
  return useMemo(() => {
    const { names, resolved, categoryMap } = categoryChoices(st, ctx.categories)
    if (!st.read) return { names, resolved, fees: [], fromSystem: false, payload: null, overlaps: [], levies: [], ev: { apartments: [], total: 0 }, includeEv: false, feesReplaced: 0, budgetsUpdated: 0 }
    const { income } = st.read.parsed
    const init = initialFees(ctx.fees, income, income.columns, st.year)
    const fees = st.feesEdit ?? init.fees
    const includeEv = st.includeEv ?? !ctx.hasChargers
    const opts: ImportOptions = { year: st.year, budgetYear: st.budgetYear, categoryMap, includeEv }
    const base = buildImport(st.read.parsed, st.columns, fees, opts)
    const overlaps = findOverlaps(base.expenses, ctx.expenses)
    const payload = st.importOverlaps || overlaps.length === 0 ? base
      : buildImport(st.read.parsed, st.columns, fees, { ...opts, skipExpenses: overlaps.map((o) => overlapKey(o.category, o.month)) })
    const ev: EvInfo = {
      apartments: income.ev.map((e) => e.apartment).sort((a, b) => a - b),
      total: income.ev.reduce((s, e) => s + Object.values(e.byMonth).reduce((t, v) => t + v, 0), 0),
    }
    return {
      names, resolved, fees, fromSystem: init.fromSystem, payload, overlaps, levies: levyLines(st.columns), ev, includeEv,
      feesReplaced: payload.fees.length > 0 ? feesToReplace(ctx.fees, st.year) : 0,
      budgetsUpdated: budgetUpdates(payload.budgets, ctx.budgets),
    }
  }, [st, ctx])
}
export type Derived = ReturnType<typeof useDerived>
