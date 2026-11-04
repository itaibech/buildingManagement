import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useMemo } from 'react'
import { he } from '../../lib/he'
import { fetchAll } from '../../lib/fetchAll'
import { supabase } from '../../lib/supabase'
import { isFeeMode, type FeeMode } from '../../ui/feeBadge'
import { notifyError } from '../../ui/notify'
import { billingOf, useApartmentBilling, useApartments, useResidents } from '../tenants/api'
import { isBudgetSource, type BudgetPayload, type BudgetSource, type BudgetSummary } from './budget'
import type { TimelineRow } from './feeTimeline'
import { sweepProofs } from './proofSweep'
import { PROOF_BUCKET, proofMime, proofPath, RECEIPT_BUCKET, receiptMime, receiptPath, shiftMonth, sortBalances, type LedgerRow } from './ledger'

// 'standing_order' is written only by apply_standing_orders (automatic payments); the payment form offers the rest.
export type PaymentMethod = 'cash' | 'transfer' | 'cheque' | 'app' | 'other' | 'standing_order'
export const PAYMENT_METHODS: readonly PaymentMethod[] = ['transfer', 'cash', 'cheque', 'app', 'other']
// 'adjustment' is a write-off ("מחיקת חוב"), written only by settle_debt.
export type ChargeKind = 'levy' | 'extra' | 'opening' | 'adjustment'
export type SettleMode = 'pay' | 'write_off'
export const SETTLE_METHODS: readonly PaymentMethod[] = ['transfer', 'cash', 'cheque', 'app', 'standing_order', 'other']

export interface ApartmentBalance {
  apartmentId: string
  number: number
  names: string[]
  balance: number
  scheduled: number
  /** This month's fee and where it comes from (building fee, custom amount, exempt). */
  fee: number
  feeMode: FeeMode
  /** Committee representative ("נציג ועד"). */
  isCommittee: boolean
  /** The monthly fee is collected by standing order ("הוראת קבע"). */
  standingOrder: boolean
}
export interface Payment {
  id: string; apartment_id: string; paid_on: string; amount: number; method: PaymentMethod; note: string; is_special?: boolean | null
  /** 'manual', 'import', 'ev-import' or 'auto' (standing order, system-managed). */
  source?: string
  /** The transfer proof ("אסמכתת העברה") in the payment-proofs bucket, or null. */
  proof_path?: string | null
}
export interface PaymentInput { apartment_id: string; paid_on: string; amount: number; method: PaymentMethod; note: string }
export interface Charge { id: string; apartment_id: string; month: string; amount: number; kind: ChargeKind; label: string; ev_reading_id: string | null; special_id?: string | null }
export interface ChargeInput { apartment_ids: string[]; month: string; amount: number; kind: ChargeKind; label: string }
/** One apartment's charge for the ledger sheet: EV kWh when the reading is readable, write-off reason and settlement. */
export interface ApartmentCharge {
  id: string; month: string; amount: number; kind: ChargeKind; label: string; note: string
  settlementId: string | null; ev: boolean; kwh: number | null
  /** Set on a "חיוב מיוחד" (shared with its payment and expense, undone together). */
  specialId: string | null
}
/** The payment recorded with a special charge ("התשלום כבר התקבל"), in the month it settles. */
export interface SpecialPayment { id: string; specialId: string; month: string; amount: number }
export interface SpecialInput {
  apartmentId: string; month: string; amount: number; label: string; note: string
  paid: boolean; method: PaymentMethod; dateMode: 'debt_month' | 'today'; expense: boolean; categoryId: string | null
}
export interface SettleInput {
  apartmentId: string; months: string[]; mode: SettleMode; method: PaymentMethod; dateMode: 'debt_month' | 'today'; note: string
  /** The transfer proof, attached to each payment the settlement records ('pay' only). */
  proof?: File | null
}
export interface SettleResult { months: number; total: number; proofFailed: boolean }
export interface Fee { id: string; effective_from: string; amount: number }
export interface FeeChange { apartment_id: string; effective_from: string; mode: FeeMode; amount: number | null }
export interface Expense {
  id: string; category_id: string; category: string; spent_on: string; amount: number
  vendor: string; note: string; receipt_path: string | null; receipt_name?: string | null; source: string; template_id: string | null; special_id?: string | null
}
export interface ExpenseInput { category_id: string; spent_on: string; amount: number; vendor: string; note: string }
export interface Template { id: string; category_id: string; category: string; amount: number; vendor: string; label: string }
export interface TemplateInput { id?: string; category_id: string; amount: number; vendor: string; label: string }
export interface Budget { id: string; year: number; category_id: string; category: string; amount: number }
export interface Collection { total: number; paidUp: number; due: number }

const KEY = ['finance'] as const
const fail = (error: { message: string } | null): void => {
  if (error) throw new Error(error.message)
}
function must<T>({ data, error }: { data: T | null; error: { message: string } | null }): T {
  fail(error)
  if (data === null) throw new Error('No data')
  return data
}
const num = (v: number | string | null | undefined): number => Number(v ?? 0)
const catName = (c: { name: string } | null): string => c?.name ?? ''
const feeMode = (v: string | null | undefined): FeeMode => (isFeeMode(v) ? v : 'building')
const restoreMode = (v: string | null): 'building' | 'custom' | null => (v === 'building' || v === 'custom' ? v : null)
const BALANCE_COLUMNS = 'apartment_id, balance, scheduled_charges, current_fee, current_fee_mode'

/** Every finance mutation refreshes every finance query: the numbers all depend on each other. */
function useFinanceMutation<A, R>(fn: (args: A) => Promise<R>) {
  const client = useQueryClient()
  return useMutation({
    mutationFn: fn,
    onSettled: () => client.invalidateQueries({ queryKey: KEY }),
    onError: () => notifyError(he.toast.failed),
  })
}

// ---------------------------------------------------------------- balances

/** Admin: every apartment's balance with its number and residents, by apartment number. */
export function useBalances() {
  const apartments = useApartments()
  const residents = useResidents()
  const billing = useApartmentBilling()
  const balances = useQuery({
    queryKey: [...KEY, 'balances'],
    queryFn: async () => must(await supabase.from('apartment_balances').select(BALANCE_COLUMNS)),
  })
  const data = useMemo((): ApartmentBalance[] | undefined => {
    if (!apartments.data || !residents.data || !balances.data || !billing.data) return undefined
    const byId = new Map(balances.data.map((b) => [b.apartment_id, b]))
    return sortBalances(apartments.data.map((a) => ({
      apartmentId: a.id,
      number: a.number,
      names: residents.data.filter((r) => r.apartment_id === a.id).map((r) => r.full_name),
      balance: num(byId.get(a.id)?.balance),
      scheduled: num(byId.get(a.id)?.scheduled_charges),
      fee: num(byId.get(a.id)?.current_fee),
      feeMode: feeMode(byId.get(a.id)?.current_fee_mode),
      isCommittee: a.is_committee,
      standingOrder: billingOf(billing.data, a.id).paymentMethod === 'standing_order',
    })), 'number')
  }, [apartments.data, residents.data, balances.data, billing.data])
  const all = [apartments, residents, balances, billing]
  return { data, isLoading: all.some((q) => q.isLoading), isError: all.some((q) => q.isError), refetch: () => all.forEach((q) => void q.refetch()) }
}

/** The signed-in resident's apartment id (null when not linked). */
export function useMyApartmentId() {
  return useQuery({
    queryKey: [...KEY, 'my-apartment'],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('my_apartment_id')
      fail(error)
      return data ?? null
    },
  })
}

/** The resident's own apartment (id and number only); null when not linked. */
export function useMyApartment() {
  const mine = useMyApartmentId()
  const id = mine.data ?? null
  const q = useQuery({
    queryKey: [...KEY, 'my-apartment-row', id],
    enabled: mine.isSuccess,
    queryFn: async () => (id ? must(await supabase.from('apartments').select('id, number').eq('id', id))[0] ?? null : null),
  })
  return { ...q, isLoading: mine.isLoading || q.isLoading, isError: mine.isError || q.isError, refetch: () => { void mine.refetch(); void q.refetch() } }
}

/** The resident's own balance and scheduled charges; null when they aren't linked. `enabled`: false without finance_own. */
export function useMyBalance(enabled = true) {
  const mine = useMyApartmentId()
  const id = mine.data ?? null
  const q = useQuery({
    queryKey: [...KEY, 'my-balance', id],
    enabled: enabled && mine.isSuccess,
    queryFn: async () => {
      if (!id) return null
      const rows = must(await supabase.from('apartment_balances').select(BALANCE_COLUMNS).eq('apartment_id', id))
      const row = rows[0]
      return { apartmentId: id, balance: num(row?.balance), scheduled: num(row?.scheduled_charges), fee: num(row?.current_fee), feeMode: feeMode(row?.current_fee_mode) }
    },
  })
  return { ...q, isLoading: mine.isLoading || q.isLoading, isError: mine.isError || q.isError }
}

const LEDGER_COLUMNS = 'apartment_id, month, charged, paid, adjusted'

/** Ledger rows up to the end of `year` (earlier years feed the running balance). Optionally one apartment. */
export function useLedger(year: number, apartmentId?: string) {
  return useQuery({
    queryKey: [...KEY, 'ledger', year, apartmentId ?? 'all'],
    enabled: apartmentId !== '',
    queryFn: async (): Promise<LedgerRow[]> => {
      const rows = await fetchAll((from, to) => {
        const q = supabase.from('apartment_ledger').select(LEDGER_COLUMNS).lt('month', `${year + 1}-01-01`)
        return (apartmentId ? q.eq('apartment_id', apartmentId) : q).order('month').order('apartment_id').range(from, to)
      })
      return rows.flatMap((r) =>
        r.apartment_id && r.month ? [{ apartment_id: r.apartment_id, month: r.month, charged: num(r.charged), paid: num(r.paid), adjusted: num(r.adjusted) }] : [])
    },
  })
}

/**
 * Admin, "דוח שנתי": every apartment's ledger rows of `year`, paged (no 1000-row cap). `fromStart`: also the earlier
 * years (the per-apartment appendix carries them into the year-end balance).
 */
export function useReportLedger(year: number, fromStart: boolean, enabled: boolean) {
  return useQuery({
    queryKey: [...KEY, 'report-ledger', year, fromStart],
    enabled,
    queryFn: async (): Promise<LedgerRow[]> => {
      const rows = await fetchAll((from, to) => {
        const q = supabase.from('apartment_ledger').select(LEDGER_COLUMNS).lte('month', `${year}-12-01`)
        return (fromStart ? q : q.gte('month', `${year}-01-01`)).order('month').order('apartment_id').range(from, to)
      })
      return rows.flatMap((r) =>
        r.apartment_id && r.month ? [{ apartment_id: r.apartment_id, month: r.month, charged: num(r.charged), paid: num(r.paid), adjusted: num(r.adjusted) }] : [])
    },
  })
}

/** Admin home: how many apartments are paid up as of the end of `month`. */
export function useCollectionSummary(month: string, enabled = true) {
  return useQuery({
    queryKey: [...KEY, 'collection', month],
    enabled,
    queryFn: async (): Promise<Collection> => {
      const row = must(await supabase.rpc('collection_summary', { p_month: month }))[0]
      return { total: row?.apartments_total ?? 0, paidUp: row?.apartments_paid_up ?? 0, due: num(row?.amount_due_total) }
    },
  })
}

export interface ExpenseReportRow { categoryId: string; category: string; month: string; total: number }

/** rpc('building_expense_report'): what the building spent in `year` per category and month (sums only). */
export function useExpenseReport(year: number) {
  return useQuery({
    queryKey: [...KEY, 'expense-report', year],
    queryFn: async (): Promise<ExpenseReportRow[]> =>
      must(await supabase.rpc('building_expense_report', { p_year: year })).map((r) => ({ categoryId: r.category_id, category: r.category, month: r.month, total: num(r.total) })),
  })
}

/** Money actually in the building's account today. */
export function useBuildingCash(enabled = true) {
  return useQuery({
    queryKey: [...KEY, 'cash'],
    enabled,
    queryFn: async () => num(must(await supabase.from('building_cash').select('balance'))[0]?.balance),
  })
}

export interface CashFlow { date: string; amount: number }

/**
 * Admin: the payments and expenses that moved the building's cash from `from` through today (Israel), the same rows
 * building_cash_balance sums (payments by paid_on, expenses by spent_on), so the cash can be rolled back to a date.
 * Paged: a year of payments can pass the 1000-row cap.
 */
export function useCashFlows(from: string, today: string, enabled = true) {
  return useQuery({
    queryKey: [...KEY, 'cash-flows', from, today],
    enabled,
    queryFn: async (): Promise<{ payments: CashFlow[]; expenses: CashFlow[] }> => {
      const [p, e] = await Promise.all([
        fetchAll((f, t) => supabase.from('payments').select('paid_on, amount').gte('paid_on', from).lte('paid_on', today).order('paid_on').order('id').range(f, t)),
        fetchAll((f, t) => supabase.from('expenses').select('spent_on, amount').gte('spent_on', from).lte('spent_on', today).order('spent_on').order('id').range(f, t)),
      ])
      return {
        payments: p.map((r) => ({ date: r.paid_on, amount: num(r.amount) })),
        expenses: e.map((r) => ({ date: r.spent_on, amount: num(r.amount) })),
      }
    },
  })
}

/** Admin: the date of the building's first payment or expense (null when there are none): where cash data begins. */
export function useFirstCashDate(enabled = true) {
  return useQuery({
    queryKey: [...KEY, 'first-cash-date'],
    enabled,
    queryFn: async (): Promise<string | null> => {
      const [p, e] = await Promise.all([
        supabase.from('payments').select('paid_on').order('paid_on', { ascending: true }).limit(1),
        supabase.from('expenses').select('spent_on').order('spent_on', { ascending: true }).limit(1),
      ])
      const dates = [must(p)[0]?.paid_on, must(e)[0]?.spent_on].filter((d): d is string => !!d).sort()
      return dates[0] ?? null
    },
  })
}

// ---------------------------------------------------------------- payments

/** Payments received in `month` (first of the month), newest first. */
export function usePayments(month: string) {
  return useQuery({
    queryKey: [...KEY, 'payments', month],
    queryFn: async (): Promise<Payment[]> =>
      (await fetchAll((f, t) => supabase.from('payments').select('id, apartment_id, paid_on, amount, method, note, is_special, source, proof_path')
        .gte('paid_on', month).lt('paid_on', shiftMonth(month, 1))
        .order('paid_on', { ascending: false }).order('created_at', { ascending: false }).order('id').range(f, t)))
        .map((p) => ({ ...p, amount: num(p.amount), method: p.method as PaymentMethod })),
  })
}

/** Records a payment, then its optional proof. `proofFailed` is true when the proof didn't make it (the payment stays). */
export function useSavePayment() {
  return useFinanceMutation(async ({ values, proof }: { values: PaymentInput; proof?: File | null }) => {
    const { id } = must<{ id: string }>(await supabase.from('payments').insert(values).select('id').single())
    return { id, proofFailed: proof ? !(await attachProofs([id], proof).catch(() => false)) : false }
  })
}

/** rpc('settle_debt'): the server works out each month's open amount; the client only sends the months. */
export function useSettleDebt() {
  return useFinanceMutation(async (v: SettleInput): Promise<SettleResult> => {
    const { data, error } = await supabase.rpc('settle_debt', {
      p_apartment_id: v.apartmentId, p_months: v.months, p_mode: v.mode, p_method: v.method, p_date_mode: v.dateMode, p_note: v.note,
    })
    fail(error)
    const r = data !== null && typeof data === 'object' && !Array.isArray(data) ? data : {}
    const settlement = typeof r.settlement_id === 'string' ? r.settlement_id : null
    const proofFailed = v.proof && v.mode === 'pay' && settlement ? !(await attachSettlementProof(settlement, v.proof).catch(() => false)) : false
    return { months: num(Number(r.months ?? 0)), total: num(Number(r.total ?? 0)), proofFailed }
  })
}

/** rpc('undo_settlement'): deletes every row one settlement wrote (here: a write-off). */
export function useUndoSettlement() {
  return useFinanceMutation(async (settlementId: string) => fail((await supabase.rpc('undo_settlement', { p_settlement_id: settlementId })).error))
}

/** Deletes the payment row first; 0037 queues its proof, which the sweep then removes. */
export function useDeletePayment() {
  return useFinanceMutation(async (id: string) => {
    fail((await supabase.from('payments').delete().eq('id', id)).error)
    // The payment is gone either way; only tell the admin that its proof file stayed behind.
    if (await sweepProofs()) notifyError(he.finance.proof.fileStayed)
  })
}

// ---------------------------------------------------------------- charges, building fees, apartment fee timeline

/** Levies, extras and openings for `year`, newest month first. */
export function useCharges(year: number, enabled = true) {
  return useQuery({
    queryKey: [...KEY, 'charges', year],
    enabled,
    queryFn: async (): Promise<Charge[]> =>
      (await fetchAll((f, t) => supabase.from('charges').select('id, apartment_id, month, amount, kind, label, ev_reading_id, special_id')
        .gte('month', `${year}-01-01`).lt('month', `${year + 1}-01-01`).order('month', { ascending: false }).order('id').range(f, t)))
        .map((c) => ({ ...c, amount: num(c.amount), kind: c.kind as ChargeKind })),
  })
}

/** EV charging: from a meter reading, or an imported/manual extra under the EV label (Excel imports have no reading). */
export const isEvCharge = (c: { ev_reading_id: string | null; kind: string; label: string }): boolean =>
  c.ev_reading_id !== null || (c.kind === 'extra' && c.label === he.import.evLabel)

/** Every charge of one apartment, oldest first, with the EV reading's kWh (null when the reading isn't readable). */
export function useApartmentCharges(apartmentId: string) {
  return useQuery({
    queryKey: [...KEY, 'apartment-charges', apartmentId],
    queryFn: async (): Promise<ApartmentCharge[]> =>
      (await fetchAll((f, t) => supabase.from('charges').select('id, month, amount, kind, label, note, settlement_id, special_id, ev_reading_id, ev_readings(kwh)')
        .eq('apartment_id', apartmentId).order('month').order('created_at').order('id').range(f, t)))
        .map((c) => ({
          id: c.id, month: c.month, amount: num(c.amount), kind: c.kind as ChargeKind, label: c.label, note: c.note,
          settlementId: c.settlement_id, ev: isEvCharge(c), kwh: c.ev_readings ? num(c.ev_readings.kwh) : null, specialId: c.special_id,
        })),
  })
}

/** The payments recorded with special charges of one apartment (for the ledger's ✦ details). */
export function useSpecialPayments(apartmentId: string) {
  return useQuery({
    queryKey: [...KEY, 'special-payments', apartmentId],
    queryFn: async (): Promise<SpecialPayment[]> =>
      (await fetchAll((f, t) => supabase.from('payments').select('id, special_id, for_month, paid_on, amount')
        .eq('apartment_id', apartmentId).eq('is_special', true).order('id').range(f, t)))
        .flatMap((p) => (p.special_id ? [{ id: p.id, specialId: p.special_id, month: p.for_month ?? `${p.paid_on.slice(0, 7)}-01`, amount: num(p.amount) }] : [])),
  })
}

/** rpc('add_special_charge'): the charge, plus its payment and/or building expense when asked, in one go. */
export function useAddSpecialCharge() {
  return useFinanceMutation(async (v: SpecialInput) => fail((await supabase.rpc('add_special_charge', {
    p_apartment_id: v.apartmentId, p_month: v.month, p_amount: v.amount, p_label: v.label, p_note: v.note,
    p_paid: v.paid, ...(v.paid ? { p_method: v.method } : {}), p_expense: v.expense,
    ...(v.expense && v.categoryId ? { p_category_id: v.categoryId } : {}), p_date_mode: v.dateMode,
  })).error))
}

export interface SpecialLinks { payment: number | null; expense: { amount: number; category: string } | null }

/** What undo_special_charge would also delete: the linked payment and building expense (admins read both). */
export function useSpecialLinks(specialId: string | null) {
  return useQuery({
    queryKey: [...KEY, 'special-links', specialId],
    enabled: specialId !== null,
    queryFn: async (): Promise<SpecialLinks> => {
      const id = specialId ?? ''
      const pay = must(await supabase.from('payments').select('amount').eq('special_id', id).limit(1))[0]
      const exp = must(await supabase.from('expenses').select('amount, expense_categories(name)').eq('special_id', id).limit(1))[0]
      return { payment: pay ? num(pay.amount) : null, expense: exp ? { amount: num(exp.amount), category: catName(exp.expense_categories) } : null }
    },
  })
}

/** Receipt paths in undo_special_charge's answer (only strings; anything else is ignored). */
export function receiptsOf(data: unknown): string[] {
  const list = data !== null && typeof data === 'object' && 'receipts' in data ? data.receipts : null
  return Array.isArray(list) ? list.filter((p): p is string => typeof p === 'string') : []
}

/** rpc('undo_special_charge'): deletes the special charge, its linked payment and expense, then the expense's receipt file. */
export function useUndoSpecialCharge() {
  return useFinanceMutation(async (specialId: string) => {
    const { data, error } = await supabase.rpc('undo_special_charge', { p_special_id: specialId })
    fail(error)
    // The rows are gone either way; only tell the admin that the receipt file stayed behind.
    if (await removeReceiptFiles(receiptsOf(data))) notifyError(he.finance.receiptRemoveFailed)
    // A proof on the special charge's payment was queued by its delete.
    void sweepProofs()
  })
}

/** One charge row per chosen apartment (a levy to many, or a single extra/opening). */
export function useSaveCharge() {
  return useFinanceMutation(async ({ apartment_ids, ...rest }: ChargeInput) =>
    fail((await supabase.from('charges').insert(apartment_ids.map((apartment_id) => ({ ...rest, apartment_id })))).error))
}

export function useDeleteCharge() {
  return useFinanceMutation(async (id: string) => fail((await supabase.from('charges').delete().eq('id', id)).error))
}

/** The building's monthly fee history, newest first. */
export function useFeeSchedule() {
  return useQuery({
    queryKey: [...KEY, 'fees'],
    queryFn: async (): Promise<Fee[]> =>
      must(await supabase.from('fee_schedule').select('id, effective_from, amount').order('effective_from', { ascending: false }))
        .map((f) => ({ ...f, amount: num(f.amount) })),
  })
}

/** Sets the fee from a month on (replaces an existing entry for the same month). */
export function useSaveFee() {
  return useFinanceMutation(async (values: { effective_from: string; amount: number }) =>
    fail((await supabase.from('fee_schedule').upsert(values, { onConflict: 'building_id,effective_from' })).error))
}

/** Fee timeline rows (every apartment, or one), newest first. Residents only ever get their own (RLS). */
export function useFeeTimeline(apartmentId?: string) {
  return useQuery({
    queryKey: [...KEY, 'fee-timeline', apartmentId ?? 'all'],
    queryFn: async (): Promise<TimelineRow[]> => {
      let q = supabase.from('apartment_fee_overrides').select('id, apartment_id, effective_from, mode, amount, restore_mode, restore_amount')
        .order('effective_from', { ascending: false })
      if (apartmentId) q = q.eq('apartment_id', apartmentId)
      return must(await q).map((r) => ({
        ...r, mode: feeMode(r.mode), amount: r.amount === null ? null : num(r.amount),
        restore_mode: restoreMode(r.restore_mode), restore_amount: r.restore_amount === null ? null : num(r.restore_amount),
      }))
    },
  })
}

/** This month's fee of one apartment (for the apartment page badge). */
export function useApartmentFee(apartmentId: string) {
  return useQuery({
    queryKey: [...KEY, 'apartment-fee', apartmentId],
    queryFn: async () => {
      const row = must(await supabase.from('apartment_balances').select(BALANCE_COLUMNS).eq('apartment_id', apartmentId))[0]
      return { fee: num(row?.current_fee), feeMode: feeMode(row?.current_fee_mode) }
    },
  })
}

/** rpc('set_apartment_fee'): resolves to false when the change was a no-op (same as what applies already). */
export function useSetApartmentFee() {
  return useFinanceMutation(async (c: FeeChange): Promise<boolean> => {
    const { data, error } = await supabase.rpc('set_apartment_fee', {
      p_apartment_id: c.apartment_id, p_effective_from: c.effective_from, p_mode: c.mode, ...(c.amount === null ? {} : { p_amount: c.amount }),
    })
    fail(error)
    return data === true
  })
}

/** Removes one timeline row: from that month the previous row (or the building fee) applies again. */
export function useDeleteFeeRow() {
  return useFinanceMutation(async (id: string) => fail((await supabase.from('apartment_fee_overrides').delete().eq('id', id)).error))
}

// ---------------------------------------------------------------- expenses

const EXPENSE_COLUMNS = 'id, category_id, spent_on, amount, vendor, note, receipt_path, receipt_name, source, template_id, special_id, expense_categories(name)'

/** The query behind useExpenses, also fetched on demand by the expense export. */
export const expensesQuery = (year: number) => ({
  queryKey: [...KEY, 'expenses', year],
  queryFn: async (): Promise<Expense[]> =>
    (await fetchAll((f, t) => supabase.from('expenses').select(EXPENSE_COLUMNS)
      .gte('spent_on', `${year}-01-01`).lt('spent_on', `${year + 1}-01-01`)
      .order('spent_on', { ascending: false }).order('created_at', { ascending: false }).order('id').range(f, t)))
      .map(({ expense_categories, ...e }) => ({ ...e, amount: num(e.amount), category: catName(expense_categories) })),
})

/** Every expense in `year` with its category name, newest first. */
export function useExpenses(year: number) {
  return useQuery(expensesQuery(year))
}

/** The year of the building's earliest expense (null when there are none), so exports can reach back to it. */
export function useFirstExpenseYear() {
  return useQuery({
    queryKey: [...KEY, 'expenses', 'first-year'],
    queryFn: async (): Promise<number | null> => {
      const rows = must(await supabase.from('expenses').select('spent_on').order('spent_on', { ascending: true }).limit(1))
      return rows[0] ? Number(rows[0].spent_on.slice(0, 4)) : null
    },
  })
}

/** Uploads the receipt and links it with its file name; returns false when either step fails (the expense itself is kept). */
async function attachReceipt(expenseId: string, file: File): Promise<boolean> {
  const mime = receiptMime(file)
  const path = mime ? receiptPath(expenseId, mime) : null
  if (!mime || !path) return false
  const up = await supabase.storage.from(RECEIPT_BUCKET).upload(path, file, { contentType: mime })
  if (up.error) return false
  const receipt = { receipt_path: path, receipt_name: file.name.slice(0, 255) || null }
  // .single(): an update that matched no row (deleted meanwhile, or RLS) is a failure too.
  const { error } = await supabase.from('expenses').update(receipt).eq('id', expenseId).select('id').single()
  // Don't leave an orphaned object behind when the link couldn't be saved.
  if (error) await supabase.storage.from(RECEIPT_BUCKET).remove([path])
  return !error
}

/**
 * Removes receipt objects; true when any stayed behind (the caller tells the admin). Storage answers a refused
 * or missing object with fewer (or no) removed entries rather than an error, so that counts as staying behind.
 */
export async function removeReceiptFiles(paths: string[]): Promise<boolean> {
  if (paths.length === 0) return false
  const { data, error } = await supabase.storage.from(RECEIPT_BUCKET).remove(paths)
  return !!error || (data?.length ?? 0) < paths.length
}
const removeReceiptFile = (path: string | null): Promise<boolean> => removeReceiptFiles(path ? [path] : [])

type ReceiptOwner = Pick<Expense, 'id' | 'receipt_path'>

/** Attaches a receipt to an expense, or replaces it: the old file is removed only after the new one is linked. */
export function useSetReceipt() {
  return useFinanceMutation(async ({ expense, file }: { expense: ReceiptOwner; file: File }) => {
    if (!(await attachReceipt(expense.id, file))) throw new Error('Receipt upload failed')
    return { oldStayed: await removeReceiptFile(expense.receipt_path) }
  })
}

/** Unlinks an expense's receipt, then removes the file. `fileStayed` is true when the file couldn't be removed. */
export function useRemoveReceipt() {
  return useFinanceMutation(async (expense: ReceiptOwner) => {
    fail((await supabase.from('expenses').update({ receipt_path: null, receipt_name: null }).eq('id', expense.id)).error)
    return { fileStayed: await removeReceiptFile(expense.receipt_path) }
  })
}

/** Records an expense, then its optional receipt. `receiptFailed` is true when the receipt didn't make it. */
export function useSaveExpense() {
  return useFinanceMutation(async ({ values, file }: { values: ExpenseInput; file: File | null }) => {
    const { id } = must<{ id: string }>(await supabase.from('expenses').insert(values).select('id').single())
    const receiptFailed = file ? !(await attachReceipt(id, file).catch(() => false)) : false
    return { id, receiptFailed }
  })
}

export function useDeleteExpense() {
  return useFinanceMutation(async (expense: Pick<Expense, 'id' | 'receipt_path'>) => {
    fail((await supabase.from('expenses').delete().eq('id', expense.id)).error)
    // The expense is gone either way; only tell the admin that its receipt file stayed behind.
    if (await removeReceiptFile(expense.receipt_path)) notifyError(he.finance.receiptRemoveFailed)
  })
}

// ---------------------------------------------------------------- payment proofs ("אסמכתת העברה", 0037)

export { sweepProofs }

type PutObject = (path: string) => Promise<{ error: { message: string } | null }>

/** Stores the object at `path` and links it to the payment; the object is removed again when the link fails. */
async function linkProof(paymentId: string, path: string, put: PutObject): Promise<boolean> {
  if ((await put(path)).error) return false
  // .single(): an update that matched no row (deleted meanwhile, or RLS) is a failure too.
  const { error } = await supabase.from('payments').update({ proof_path: path }).eq('id', paymentId).select('id').single()
  if (error) await dropUnlinked(path)
  return !error
}

/** Removes an upload whose link failed; when that fails too, queues it so the next sweep removes it. */
async function dropUnlinked(path: string): Promise<void> {
  const { data, error } = await supabase.storage.from(PROOF_BUCKET).remove([path])
  if (error || (data?.length ?? 0) === 0) await supabase.rpc('queue_payment_proof', { p_path: path })
}

/** Uploads the proof for the first payment and copies it to the others (a settlement's months); true when all are linked. */
async function attachProofs(ids: readonly string[], file: File): Promise<boolean> {
  const mime = proofMime(file)
  const [first, ...rest] = ids
  const path = mime && first ? proofPath(first, mime) : null
  if (!mime || !first || !path) return false
  const bucket = supabase.storage.from(PROOF_BUCKET)
  if (!(await linkProof(first, path, (p) => bucket.upload(p, file, { contentType: mime })))) return false
  const copies = await Promise.all(rest.map((id) => {
    const to = proofPath(id, mime)
    return to ? linkProof(id, to, (p) => bucket.copy(path, p)) : Promise.resolve(false)
  }))
  return copies.every(Boolean)
}

/** The payments one settle_debt call recorded, oldest month first, each with the proof. */
async function attachSettlementProof(settlementId: string, file: File): Promise<boolean> {
  const rows = await fetchAll((f, t) => supabase.from('payments').select('id').eq('settlement_id', settlementId).order('for_month').order('id').range(f, t))
  return attachProofs(rows.map((r) => r.id), file)
}

type ProofOwner = Pick<Payment, 'id'>

/** Attaches a proof to a payment, or replaces it: the old object is removed only after the new one is linked. */
export function useSetProof() {
  return useFinanceMutation(async ({ payment, file }: { payment: ProofOwner; file: File }) => {
    if (!(await attachProofs([payment.id], file))) throw new Error('Proof upload failed')
    return { oldStayed: await sweepProofs() }
  })
}

/** Unlinks a payment's proof, then removes the file. `fileStayed` is true when the file couldn't be removed yet. */
export function useRemoveProof() {
  return useFinanceMutation(async (payment: ProofOwner) => {
    fail((await supabase.from('payments').update({ proof_path: null }).eq('id', payment.id)).error)
    return { fileStayed: await sweepProofs() }
  })
}

/** A 60-second link to a private proof, made when it's tapped. */
export async function proofUrl(path: string): Promise<string> {
  const { data, error } = await supabase.storage.from(PROOF_BUCKET).createSignedUrl(path, 60)
  fail(error)
  if (!data) throw new Error('No URL')
  return data.signedUrl
}

export interface ProofPayment { id: string; month: string; paidOn: string; amount: number; path: string }

/** One apartment's payments that carry a proof, in the ledger month they land in (for_month, else paid_on's month). */
export function useApartmentProofs(apartmentId: string) {
  return useQuery({
    queryKey: [...KEY, 'proofs', apartmentId],
    queryFn: async (): Promise<ProofPayment[]> =>
      (await fetchAll((f, t) => supabase.from('payments').select('id, paid_on, for_month, amount, proof_path').eq('apartment_id', apartmentId)
        .not('proof_path', 'is', null).order('paid_on').order('id').range(f, t)))
        .flatMap((p) => (p.proof_path ? [{ id: p.id, month: p.for_month ?? `${p.paid_on.slice(0, 7)}-01`, paidOn: p.paid_on, amount: num(p.amount), path: p.proof_path }] : [])),
  })
}

/** A short-lived link to a private receipt. */
export async function receiptUrl(path: string): Promise<string> {
  const { data, error } = await supabase.storage.from(RECEIPT_BUCKET).createSignedUrl(path, 60 * 5)
  fail(error)
  if (!data) throw new Error('No URL')
  return data.signedUrl
}

export function useTemplates() {
  return useQuery({
    queryKey: [...KEY, 'templates'],
    queryFn: async (): Promise<Template[]> =>
      must(await supabase.from('expense_templates').select('id, category_id, amount, vendor, label, expense_categories(name)').order('label'))
        .map(({ expense_categories, ...t }) => ({ ...t, amount: num(t.amount), category: catName(expense_categories) })),
  })
}

export function useSaveTemplate() {
  return useFinanceMutation(async ({ id, ...values }: TemplateInput) => {
    const table = supabase.from('expense_templates')
    fail((await (id ? table.update(values).eq('id', id) : table.insert(values))).error)
  })
}

export function useDeleteTemplate() {
  return useFinanceMutation(async (id: string) => fail((await supabase.from('expense_templates').delete().eq('id', id)).error))
}

/** Posts one expense per template, dated the first of `month`. */
export interface ApplyResult { added: number; existing: number }

/**
 * Posts one expense per template, dated the first of `month`. Idempotent in the DB: a template
 * already posted for that date is skipped (unique template_id + spent_on), and counted as existing.
 */
export function useApplyTemplates(month: string) {
  return useFinanceMutation(async (templates: readonly Template[]): Promise<ApplyResult> => {
    const rows = templates.map((t) => ({ category_id: t.category_id, amount: t.amount, vendor: t.vendor, note: t.label, spent_on: month, template_id: t.id }))
    const added = must(await supabase.from('expenses')
      .upsert(rows, { onConflict: 'template_id,spent_on', ignoreDuplicates: true }).select('id')).length
    return { added, existing: rows.length - added }
  })
}

// ---------------------------------------------------------------- budgets

/** Budget lines for `year`, in the categories' order. */
export function useBudgets(year: number) {
  return useQuery({
    queryKey: [...KEY, 'budgets', year],
    queryFn: async (): Promise<Budget[]> =>
      must(await supabase.from('budgets').select('id, year, category_id, amount, expense_categories(name, sort_order)').eq('year', year))
        .sort((a, b) => (a.expense_categories?.sort_order ?? 0) - (b.expense_categories?.sort_order ?? 0))
        .map(({ expense_categories, ...b }) => ({ ...b, amount: num(b.amount), category: catName(expense_categories) })),
  })
}

export interface PlannedBudget extends Budget { source: BudgetSource }

const planKey = (year: number) => [...KEY, 'budget-plan', year] as const

/** rpc('budget_for_year'): each category's planned amount for `year` (one-off, else the recurring default). */
export function useBudgetPlan(year: number) {
  return useQuery({
    queryKey: planKey(year),
    queryFn: async (): Promise<PlannedBudget[]> =>
      must(await supabase.rpc('budget_for_year', { p_year: year })).map((r) => ({
        id: `${r.category_id}:${year}`, year, category_id: r.category_id, category: r.category, amount: num(r.amount),
        source: isBudgetSource(r.source) ? r.source : 'default',
      })),
  })
}

/** Applies a write to the cached plan at once, so the table's difference column updates before the server answers. */
function applyToPlan(plan: PlannedBudget[], p: BudgetPayload, names: ReadonlyMap<string, string>): PlannedBudget[] {
  const source: BudgetSource = p.scope === 'once' ? 'one_off' : 'default'
  const next = plan.filter((b) => !p.lines.some((l) => l.category_id === b.category_id))
  const added = p.lines.map((l) => ({ id: `${l.category_id}:${p.year}`, year: p.year, category_id: l.category_id, category: names.get(l.category_id) ?? '', amount: l.amount, source }))
  return [...next, ...added]
}

/** rpc('set_budgets'): writes lines for a year as a recurring default or a one-off (admins only; the server checks). */
export function useSetBudgets(names: ReadonlyMap<string, string> = new Map()) {
  const client = useQueryClient()
  return useMutation({
    mutationFn: async (p: BudgetPayload): Promise<number> => {
      const { data, error } = await supabase.rpc('set_budgets', { p_year: p.year, p_scope: p.scope, p_lines: p.lines.map((l) => ({ ...l })) })
      fail(error)
      return data ?? 0
    },
    onMutate: async (p: BudgetPayload) => {
      await client.cancelQueries({ queryKey: planKey(p.year) })
      const before = client.getQueryData<PlannedBudget[]>(planKey(p.year))
      if (before) client.setQueryData(planKey(p.year), applyToPlan(before, p, names))
      return { before }
    },
    onError: (_e, p, ctx) => {
      if (ctx?.before) client.setQueryData(planKey(p.year), ctx.before)
      notifyError(he.toast.failed)
    },
    onSettled: () => client.invalidateQueries({ queryKey: KEY }),
  })
}

/** rpc('budget_summary'): the year's expected income, actual income and expenses, and the expected balance. */
export function useBudgetSummary(year: number) {
  return useQuery({
    queryKey: [...KEY, 'budget-summary', year],
    queryFn: async (): Promise<BudgetSummary> => {
      const r = must(await supabase.rpc('budget_summary', { p_year: year }))[0]
      return {
        expectedIncome: num(r?.expected_income), actualIncome: num(r?.actual_income), actualExpenses: num(r?.actual_expenses),
        projectedExpenses: num(r?.projected_expenses), expectedBalance: num(r?.expected_balance),
      }
    },
  })
}
