import { useMemo } from 'react'
import { useAuth } from '../../auth/AuthProvider'
import { todayISO } from '../../lib/dates'
import { useBuilding } from '../settings/api'
import { useAllApartments } from '../tenants/api'
import { isEvCharge, useBudgetSummary, useBuildingCash, useCashFlows, useCharges, useCollectionSummary, useExpenseReport, useFirstCashDate, useReportLedger } from './api'
import { buildAnnualReport, collectionMonthFor, type AdminInput, type AnnualReport, type CashInput } from './annualReport'
import { useReportBudgetRows } from './hooks'

/** Admin: today's cash and the flows since the year began (or the opening-cash date), to roll the cash back. */
function useAdminCash(year: number, enabled: boolean, today: string) {
  const cash = useBuildingCash(enabled)
  const building = useBuilding()
  const firstDate = useFirstCashDate(enabled)
  const opening = building.data?.opening_cash_date ?? null
  const first = `${year}-01-01`
  const from = opening !== null && opening > first ? opening : first
  const flows = useCashFlows(from, today, enabled && building.isSuccess)
  const data = useMemo((): CashInput | null => (cash.data !== undefined && flows.data && firstDate.data !== undefined
    ? { today: cash.data, openingDate: opening, firstDate: firstDate.data, ...flows.data } : null), [cash.data, flows.data, firstDate.data, opening])
  const failed = enabled && (cash.isError || building.isError || firstDate.isError || flows.isError)
  const refetch = () => { void cash.refetch(); void building.refetch(); void firstDate.refetch(); void flows.refetch() }
  return { data, failed, refetch }
}

/**
 * The admin-only inputs (ledger, charges, cash, apartment numbers): null until every one has loaded. Nothing is
 * requested for residents.
 */
function useAdminInput(year: number, enabled: boolean, today: string, fromStart: boolean) {
  const ledger = useReportLedger(year, fromStart, enabled)
  const charges = useCharges(year, enabled)
  const cash = useAdminCash(year, enabled, today)
  const apartments = useAllApartments(enabled)
  const data = useMemo((): AdminInput | null => {
    if (!enabled || !ledger.data || !charges.data || !apartments.data || !cash.data) return null
    return {
      ledger: ledger.data,
      charges: charges.data.map((c) => ({ month: c.month, amount: c.amount, kind: c.kind, ev: isEvCharge(c), special: c.special_id != null })),
      cash: cash.data,
      numbers: new Map(apartments.data.map((a) => [a.id, a.number])),
    }
  }, [enabled, ledger.data, charges.data, cash.data, apartments.data])
  const failed = enabled && (ledger.isError || charges.isError || apartments.isError || cash.failed)
  const refetch = () => { void ledger.refetch(); void charges.refetch(); void apartments.refetch(); cash.refetch() }
  return { data, failed, refetch }
}

/** Everything "דוח שנתי" shows for `year`, by role (buildAnnualReport drops the admin-only parts for residents). */
export function useAnnualReport(year: number, withAppendix: boolean) {
  const { isAdmin } = useAuth()
  const today = todayISO()
  const collectionMonth = collectionMonthFor(year, isAdmin, today)
  const summary = useBudgetSummary(year)
  const expenses = useExpenseReport(year)
  const budget = useReportBudgetRows(year)
  const collection = useCollectionSummary(collectionMonth)
  const admin = useAdminInput(year, isAdmin, today, withAppendix)
  const report = useMemo((): AnnualReport | undefined => {
    if (!summary.data || !expenses.data || !budget.rows || !collection.data || (isAdmin && !admin.data)) return undefined
    return buildAnnualReport({
      year, today, admin: isAdmin, summary: summary.data, expenses: expenses.data, budget: budget.rows,
      collection: collection.data, collectionMonth, adminData: admin.data, withAppendix,
    })
  }, [year, today, isAdmin, summary.data, expenses.data, budget.rows, collection.data, collectionMonth, admin.data, withAppendix])
  const isError = summary.isError || expenses.isError || budget.isError || collection.isError || admin.failed
  const refetch = () => { void summary.refetch(); void expenses.refetch(); budget.refetch(); void collection.refetch(); admin.refetch() }
  return { report, isError, isLoading: !report && !isError, refetch, admin: isAdmin }
}
