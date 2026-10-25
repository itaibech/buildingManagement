import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useMemo } from 'react'
import { he } from '../../lib/he'
import { supabase } from '../../lib/supabase'
import { isFeeMode, type FeeMode } from '../../ui/feeBadge'
import { notifyError } from '../../ui/notify'
import { billingOf, useApartmentBilling, useApartments, useResidents } from '../tenants/api'
import { isBudgetSource, type BudgetPayload, type BudgetSource, type BudgetSummary } from './budget'
import type { TimelineRow } from './feeTimeline'
import { RECEIPT_BUCKET, receiptMime, receiptPath, shiftMonth, sortBalances, type LedgerRow } from './ledger'

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
export interface Payment { id: string; apartment_id: string; paid_on: string; amount: number; method: PaymentMethod; note: string; is_special?: boolean | null }
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
}
export interface SettleResult { months: number; total: number }
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

/** The resident's own balance and scheduled charges; null when they aren't linked to an apartment. */
export function useMyBalance() {
  const mine = useMyApartmentId()
  const id = mine.data ?? null
  const q = useQuery({
    queryKey: [...KEY, 'my-balance', id],
    enabled: mine.isSuccess,
    queryFn: async () => {
      if (!id) return null
      const rows = must(await supabase.from('apartment_balances').select(BALANCE_COLUMNS).eq('apartment_id', id))
      const row = rows[0]
      return { apartmentId: id, balance: num(row?.balance), scheduled: num(row?.scheduled_charges), fee: num(row?.current_fee), feeMode: feeMode(row?.current_fee_mode) }
    },
  })
  return { ...q, isLoading: mine.isLoading || q.isLoading, isError: mine.isError || q.isError }
}

/** Ledger rows up to the end of `year` (earlier years feed the running balance). Optionally one apartment. */
export function useLedger(year: number, apartmentId?: string) {
  return useQuery({
    queryKey: [...KEY, 'ledger', year, apartmentId ?? 'all'],
    enabled: apartmentId !== '',
    queryFn: async (): Promise<LedgerRow[]> => {
      let q = supabase.from('apartment_ledger').select('apartment_id, month, charged, paid, adjusted').lt('month', `${year + 1}-01-01`).order('month')
      if (apartmentId) q = q.eq('apartment_id', apartmentId)
      return must(await q).flatMap((r) =>
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
export function useBuildingCash() {
  return useQuery({
    queryKey: [...KEY, 'cash'],
    queryFn: async () => num(must(await supabase.from('building_cash').select('balance'))[0]?.balance),
  })
}

// ---------------------------------------------------------------- payments

/** Payments received in `month` (first of the month), newest first. */
export function usePayments(month: string) {
  return useQuery({
    queryKey: [...KEY, 'payments', month],
    queryFn: async (): Promise<Payment[]> =>
      must(await supabase.from('payments').select('id, apartment_id, paid_on, amount, method, note, is_special')
        .gte('paid_on', month).lt('paid_on', shiftMonth(month, 1))
        .order('paid_on', { ascending: false }).order('created_at', { ascending: false }))
        .map((p) => ({ ...p, amount: num(p.amount), method: p.method as PaymentMethod })),
  })
}

export function useSavePayment() {
  return useFinanceMutation(async (values: PaymentInput) => fail((await supabase.from('payments').insert(values)).error))
}

/** rpc('settle_debt'): the server works out each month's open amount; the client only sends the months. */
export function useSettleDebt() {
  return useFinanceMutation(async (v: SettleInput): Promise<SettleResult> => {
    const { data, error } = await supabase.rpc('settle_debt', {
      p_apartment_id: v.apartmentId, p_months: v.months, p_mode: v.mode, p_method: v.method, p_date_mode: v.dateMode, p_note: v.note,
    })
    fail(error)
    const r = data !== null && typeof data === 'object' && !Array.isArray(data) ? data : {}
    return { months: num(Number(r.months ?? 0)), total: num(Number(r.total ?? 0)) }
  })
}

/** rpc('undo_settlement'): deletes every row one settlement wrote (here: a write-off). */
export function useUndoSettlement() {
  return useFinanceMutation(async (settlementId: string) => fail((await supabase.rpc('undo_settlement', { p_settlement_id: settlementId })).error))
}

export function useDeletePayment() {
  return useFinanceMutation(async (id: string) => fail((await supabase.from('payments').delete().eq('id', id)).error))
}

// ---------------------------------------------------------------- charges, building fees, apartment fee timeline

/** Levies, extras and openings for `year`, newest month first. */
export function useCharges(year: number) {
  return useQuery({
    queryKey: [...KEY, 'charges', year],
    queryFn: async (): Promise<Charge[]> =>
      must(await supabase.from('charges').select('id, apartment_id, month, amount, kind, label, ev_reading_id, special_id')
        .gte('month', `${year}-01-01`).lt('month', `${year + 1}-01-01`).order('month', { ascending: false }))
        .map((c) => ({ ...c, amount: num(c.amount), kind: c.kind as ChargeKind })),
  })
}

/** EV charging: from a meter reading, or an imported/manual extra under the EV label (Excel imports have no reading). */
const isEvCharge = (c: { ev_reading_id: string | null; kind: string; label: string }): boolean =>
  c.ev_reading_id !== null || (c.kind === 'extra' && c.label === he.import.evLabel)

/** Every charge of one apartment, oldest first, with the EV reading's kWh (null when the reading isn't readable). */
export function useApartmentCharges(apartmentId: string) {
  return useQuery({
    queryKey: [...KEY, 'apartment-charges', apartmentId],
    queryFn: async (): Promise<ApartmentCharge[]> =>
      must(await supabase.from('charges').select('id, month, amount, kind, label, note, settlement_id, special_id, ev_reading_id, ev_readings(kwh)')
        .eq('apartment_id', apartmentId).order('month').order('created_at'))
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
      must(await supabase.from('payments').select('id, special_id, for_month, paid_on, amount').eq('apartment_id', apartmentId).eq('is_special', true))
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
      const pay = must(await supabase.from('payments').select('amount').eq('special_id', id))[0]
      const exp = must(await supabase.from('expenses').select('amount, expense_categories(name)').eq('special_id', id))[0]
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
    must(await supabase.from('expenses').select(EXPENSE_COLUMNS)
      .gte('spent_on', `${year}-01-01`).lt('spent_on', `${year + 1}-01-01`)
      .order('spent_on', { ascending: false }).order('created_at', { ascending: false }).order('id'))
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
