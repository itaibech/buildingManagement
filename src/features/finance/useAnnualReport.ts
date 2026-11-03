import { useMemo } from 'react'
import { useAuth } from '../../auth/AuthProvider'
import { todayISO } from '../../lib/dates'
import { useBuilding } from '../settings/api'
import { useAllApartments } from '../tenants/api'
import { isEvCharge, useBudgetSummary, useBuildingCash, useCashFlows, useCharges, useCollectionSummary, useExpenseReport, useLedger } from './api'
import { buildAnnualReport, collectionMonthFor, type AdminInput, type AnnualReport } from './annualReport'
import { useReportBudgetRows } from './hooks'

/** The admin-only inputs (ledger, charges, cash, cash flows, apartment numbers); nothing is requested for residents. */
function useAdminInput(year: number, enabled: boolean, today: string) {
  const ledger = useLedger(year, undefined, enabled)
  const charges = useCharges(year, enabled)
  const cash = useBuildingCash(enabled)
  const building = useBuilding()
  const opening = building.data?.opening_cash_date ?? null
  const first = `${year}-01-01`
  const from = opening !== null && opening > first ? opening : first
  const flows = useCashFlows(from, today, enabled && building.isSuccess)
  const apartments = useAllApartments()
  const data = useMemo((): AdminInput | null => {
    if (!enabled || !ledger.data || !charges.data || !apartments.data) return null
    const cashInput = cash.data !== undefined && flows.data ? { today: cash.data, openingDate: opening, ...flows.data } : null
    return {
      ledger: ledger.data,
      charges: charges.data.map((c) => ({ month: c.month, amount: c.amount, kind: c.kind, ev: isEvCharge(c), special: c.special_id != null })),
      cash: cashInput,
      numbers: new Map(apartments.data.map((a) => [a.id, a.number])),
    }
  }, [enabled, ledger.data, charges.data, cash.data, flows.data, apartments.data, opening])
  const pending = enabled && (ledger.isLoading || charges.isLoading || cash.isLoading || flows.isLoading || building.isLoading)
  const failed = enabled && (ledger.isError || charges.isError || cash.isError || flows.isError)
  const refetch = () => { void ledger.refetch(); void charges.refetch(); void cash.refetch(); void flows.refetch() }
  return { data, pending, failed, refetch }
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
  const admin = useAdminInput(year, isAdmin, today)
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
