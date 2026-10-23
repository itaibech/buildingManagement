import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useMemo } from 'react'
import { he } from '../../lib/he'
import { supabase } from '../../lib/supabase'
import { notifyError } from '../../ui/notify'
import { useApartments, useResidents } from '../tenants/api'
import { RECEIPT_BUCKET, receiptPath, shiftMonth, sortByDebt, type LedgerRow } from './ledger'

export type PaymentMethod = 'cash' | 'transfer' | 'cheque' | 'app' | 'other'
export const PAYMENT_METHODS: readonly PaymentMethod[] = ['transfer', 'cash', 'cheque', 'app', 'other']
export type ChargeKind = 'levy' | 'extra' | 'opening'

export interface ApartmentBalance {
  apartmentId: string
  number: number
  names: string[]
  balance: number
  scheduled: number
}
export interface Payment { id: string; apartment_id: string; paid_on: string; amount: number; method: PaymentMethod; note: string }
export interface PaymentInput { apartment_id: string; paid_on: string; amount: number; method: PaymentMethod; note: string }
export interface Charge { id: string; apartment_id: string; month: string; amount: number; kind: ChargeKind; label: string }
export interface ChargeInput { apartment_ids: string[]; month: string; amount: number; kind: ChargeKind; label: string }
export interface Fee { id: string; effective_from: string; amount: number }
export interface FeeOverride { id: string; apartment_id: string; effective_from: string; amount: number }
export interface Expense {
  id: string; category_id: string; category: string; spent_on: string; amount: number
  vendor: string; note: string; receipt_path: string | null; source: string
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

/** Admin: every apartment's balance with its number and residents, largest debt first. */
export function useBalances() {
  const apartments = useApartments()
  const residents = useResidents()
  const balances = useQuery({
    queryKey: [...KEY, 'balances'],
    queryFn: async () => must(await supabase.from('apartment_balances').select('apartment_id, balance, scheduled_charges')),
  })
  const data = useMemo((): ApartmentBalance[] | undefined => {
    if (!apartments.data || !residents.data || !balances.data) return undefined
    const byId = new Map(balances.data.map((b) => [b.apartment_id, b]))
    return sortByDebt(apartments.data.map((a) => ({
      apartmentId: a.id,
      number: a.number,
      names: residents.data.filter((r) => r.apartment_id === a.id).map((r) => r.full_name),
      balance: num(byId.get(a.id)?.balance),
      scheduled: num(byId.get(a.id)?.scheduled_charges),
    })).sort((x, y) => x.number - y.number))
  }, [apartments.data, residents.data, balances.data])
  const all = [apartments, residents, balances]
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

/** The resident's own balance and scheduled charges; null when they aren't linked to an apartment. */
export function useMyBalance() {
  const mine = useMyApartmentId()
  const id = mine.data ?? null
  const q = useQuery({
    queryKey: [...KEY, 'my-balance', id],
    enabled: mine.isSuccess,
    queryFn: async () => {
      if (!id) return null
      const rows = must(await supabase.from('apartment_balances').select('apartment_id, balance, scheduled_charges').eq('apartment_id', id))
      const row = rows[0]
      return { apartmentId: id, balance: num(row?.balance), scheduled: num(row?.scheduled_charges) }
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
      let q = supabase.from('apartment_ledger').select('apartment_id, month, charged, paid').lt('month', `${year + 1}-01-01`).order('month')
      if (apartmentId) q = q.eq('apartment_id', apartmentId)
      return must(await q).flatMap((r) =>
        r.apartment_id && r.month ? [{ apartment_id: r.apartment_id, month: r.month, charged: num(r.charged), paid: num(r.paid) }] : [])
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
      must(await supabase.from('payments').select('id, apartment_id, paid_on, amount, method, note')
        .gte('paid_on', month).lt('paid_on', shiftMonth(month, 1))
        .order('paid_on', { ascending: false }).order('created_at', { ascending: false }))
        .map((p) => ({ ...p, amount: num(p.amount), method: p.method as PaymentMethod })),
  })
}

export function useSavePayment() {
  return useFinanceMutation(async (values: PaymentInput) => fail((await supabase.from('payments').insert(values)).error))
}

export function useDeletePayment() {
  return useFinanceMutation(async (id: string) => fail((await supabase.from('payments').delete().eq('id', id)).error))
}

// ---------------------------------------------------------------- charges, fees, overrides

/** Levies, extras and openings for `year`, newest month first. */
export function useCharges(year: number) {
  return useQuery({
    queryKey: [...KEY, 'charges', year],
    queryFn: async (): Promise<Charge[]> =>
      must(await supabase.from('charges').select('id, apartment_id, month, amount, kind, label')
        .gte('month', `${year}-01-01`).lt('month', `${year + 1}-01-01`).order('month', { ascending: false }))
        .map((c) => ({ ...c, amount: num(c.amount), kind: c.kind as ChargeKind })),
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

export function useOverrides() {
  return useQuery({
    queryKey: [...KEY, 'overrides'],
    queryFn: async (): Promise<FeeOverride[]> =>
      must(await supabase.from('apartment_fee_overrides').select('id, apartment_id, effective_from, amount').order('effective_from', { ascending: false }))
        .map((o) => ({ ...o, amount: num(o.amount) })),
  })
}

export function useSaveOverride() {
  return useFinanceMutation(async (values: { apartment_id: string; effective_from: string; amount: number }) =>
    fail((await supabase.from('apartment_fee_overrides').upsert(values, { onConflict: 'apartment_id,effective_from' })).error))
}

/** Reverting an override deletes it; the apartment falls back to the building fee. */
export function useDeleteOverride() {
  return useFinanceMutation(async (id: string) => fail((await supabase.from('apartment_fee_overrides').delete().eq('id', id)).error))
}

// ---------------------------------------------------------------- expenses

/** Every expense in `year` with its category name, newest first. */
export function useExpenses(year: number) {
  return useQuery({
    queryKey: [...KEY, 'expenses', year],
    queryFn: async (): Promise<Expense[]> =>
      must(await supabase.from('expenses')
        .select('id, category_id, spent_on, amount, vendor, note, receipt_path, source, expense_categories(name)')
        .gte('spent_on', `${year}-01-01`).lt('spent_on', `${year + 1}-01-01`)
        .order('spent_on', { ascending: false }).order('created_at', { ascending: false }))
        .map(({ expense_categories, ...e }) => ({ ...e, amount: num(e.amount), category: catName(expense_categories) })),
  })
}

/** Uploads the receipt and links it; returns false when either step fails (the expense itself is kept). */
async function attachReceipt(expenseId: string, file: File): Promise<boolean> {
  const path = receiptPath(expenseId, file.type)
  if (!path) return false
  const up = await supabase.storage.from(RECEIPT_BUCKET).upload(path, file, { contentType: file.type })
  if (up.error) return false
  const { error } = await supabase.from('expenses').update({ receipt_path: path }).eq('id', expenseId)
  return !error
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
    if (expense.receipt_path) await supabase.storage.from(RECEIPT_BUCKET).remove([expense.receipt_path])
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
export function useApplyTemplates(month: string) {
  return useFinanceMutation(async (templates: readonly Template[]) => {
    const rows = templates.map((t) => ({ category_id: t.category_id, amount: t.amount, vendor: t.vendor, note: t.label, spent_on: month }))
    fail((await supabase.from('expenses').insert(rows)).error)
    return rows.length
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

/** Sets a category's planned amount for a year (one line per year and category). */
export function useSaveBudget() {
  return useFinanceMutation(async (values: { year: number; category_id: string; amount: number }) =>
    fail((await supabase.from('budgets').upsert(values, { onConflict: 'year,category_id' })).error))
}
