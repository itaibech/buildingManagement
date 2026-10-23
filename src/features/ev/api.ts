import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { he } from '../../lib/he'
import { supabase } from '../../lib/supabase'
import { notifyError } from '../../ui/notify'
import { useMyApartmentId } from '../finance/api'
import type { EvImportPayload } from './buildEvImport'
import type { HistoryReading, Rate } from './evMath'

export interface Charger { id: string; apartment_id: string; number: number; label: string; initial_reading: number; active: boolean }
export interface EvRate extends Rate { id: string }
export interface Reading extends HistoryReading { charger_id: string; read_on: string | null; note: string; source: string }
export interface ReadingInput { charger_id: string; month: string; reading: number; read_on: string | null; note: string }
export interface ReadingResult { kwh: number; rate: number; amount: number; previous: number }
export interface EvPayment { apartment_id: string; paid_on: string; amount: number; note: string; source: string }
export type EvImportCounts = Partial<Record<'chargers' | 'readings' | 'kept_manual' | 'rates' | 'payments' | 'main_charges', number>>

// Under ['finance'] so finance mutations (payments) refresh EV views, and EV mutations refresh balances.
const KEY = ['finance', 'ev'] as const

/** A Postgres error with its code: 22023 carries a Hebrew message from the RPC that the admin should see. */
class EvError extends Error {
  readonly code: string | undefined
  constructor(e: { message: string; code?: string }) {
    super(e.message)
    this.code = e.code
  }
}
const fail = (error: { message: string; code?: string } | null): void => {
  if (error) throw new EvError(error)
}
function must<T>({ data, error }: { data: T | null; error: { message: string; code?: string } | null }): T {
  fail(error)
  if (data === null) throw new Error('No data')
  return data
}
const num = (v: number | string | null | undefined): number => Number(v ?? 0)
const numOrNull = (v: number | string | null | undefined): number | null => (v === null || v === undefined ? null : Number(v))
const field = (data: unknown, k: string): number => {
  const v: unknown = typeof data === 'object' && data !== null ? Reflect.get(data, k) : undefined
  return typeof v === 'number' ? v : Number(v ?? 0)
}

/** The RPC's own Hebrew message for a rejected value (22023), else the generic failure toast. */
export const errorMessage = (e: unknown): string => (e instanceof EvError && e.code === '22023' ? e.message : he.toast.failed)

function useEvMutation<A, R>(fn: (args: A) => Promise<R>) {
  const client = useQueryClient()
  return useMutation({
    mutationFn: fn,
    onSettled: () => client.invalidateQueries({ queryKey: ['finance'] }),
    onError: (e) => notifyError(errorMessage(e)),
  })
}

/** Every charger (RLS: residents get only their own), by apartment number. */
export function useChargers(enabled = true) {
  return useQuery({
    queryKey: [...KEY, 'chargers'],
    enabled,
    queryFn: async (): Promise<Charger[]> =>
      must(await supabase.from('ev_chargers').select('id, apartment_id, label, initial_reading, active, apartments(number)'))
        .map(({ apartments, ...c }) => ({ ...c, number: apartments?.number ?? 0, initial_reading: num(c.initial_reading) }))
        .sort((a, b) => a.number - b.number),
  })
}

/** Readings, newest first; one charger's when `chargerId` is given. */
export function useEvReadings(chargerId?: string) {
  return useQuery({
    queryKey: [...KEY, 'readings', chargerId ?? 'all'],
    enabled: chargerId !== '',
    queryFn: async (): Promise<Reading[]> => {
      let q = supabase.from('ev_readings').select('id, charger_id, month, reading, read_on, note, source, kwh, rate, amount').order('month', { ascending: false })
      if (chargerId) q = q.eq('charger_id', chargerId)
      return must(await q).map((r) => ({ ...r, reading: num(r.reading), kwh: numOrNull(r.kwh), rate: numOrNull(r.rate), amount: numOrNull(r.amount) }))
    },
  })
}

export function useEvRates() {
  return useQuery({
    queryKey: [...KEY, 'rates'],
    queryFn: async (): Promise<EvRate[]> =>
      must(await supabase.from('ev_rates').select('id, rate, effective_from').order('effective_from', { ascending: false }))
        .map((r) => ({ ...r, rate: num(r.rate) })),
  })
}

/** EV payments (noted "טעינת רכב חשמלי…") of the given apartments, for the "שולם" column. */
export function useEvPayments(apartmentIds: readonly string[]) {
  return useQuery({
    queryKey: [...KEY, 'payments', [...apartmentIds].sort().join(',')],
    enabled: apartmentIds.length > 0,
    queryFn: async (): Promise<EvPayment[]> =>
      must(await supabase.from('payments').select('apartment_id, paid_on, amount, note, source')
        .in('apartment_id', [...apartmentIds]).like('note', `${he.ev.chargeLabel}%`).order('paid_on'))
        .map((p) => ({ ...p, amount: num(p.amount) })),
  })
}

export function useAddCharger() {
  return useEvMutation(async (values: { apartment_id: string; initial_reading: number }) =>
    fail((await supabase.from('ev_chargers').insert(values)).error))
}

/** rpc('save_ev_rate'): a rate from a month on (same month replaces it). Returns how many charges were recomputed. */
export function useSaveRate() {
  return useEvMutation(async (values: { rate: number; effective_from: string }): Promise<number> =>
    num(must(await supabase.rpc('save_ev_rate', { p_effective_from: values.effective_from, p_rate: values.rate }))))
}

/** rpc('delete_ev_rate'): refused (22023) when recorded months would be left without a rate. Returns recomputed count. */
export function useDeleteRate() {
  return useEvMutation(async (id: string): Promise<number> => num(must(await supabase.rpc('delete_ev_rate', { p_id: id }))))
}

/** The main workbook's imported EV charges (source 'import', labelled EV) of these apartments. */
export function useMainEvCharges(apartmentIds: readonly string[]) {
  return useQuery({
    queryKey: [...KEY, 'main-charges', [...apartmentIds].sort().join(',')],
    enabled: apartmentIds.length > 0,
    queryFn: async (): Promise<{ apartment_id: string; month: string }[]> =>
      must(await supabase.from('charges').select('apartment_id, month').in('apartment_id', [...apartmentIds])
        .eq('source', 'import').eq('kind', 'extra').eq('label', he.ev.chargeLabel)),
  })
}

/** rpc('record_ev_reading'): upserts the month's reading and its charge, and recomputes the next month. */
export function useRecordReading() {
  return useEvMutation(async (v: ReadingInput): Promise<ReadingResult> => {
    const data: unknown = must(await supabase.rpc('record_ev_reading', {
      p_charger_id: v.charger_id, p_month: v.month, p_reading: v.reading, p_read_on: v.read_on ?? undefined, p_note: v.note,
    }))
    return { kwh: field(data, 'kwh'), rate: field(data, 'rate'), amount: field(data, 'amount'), previous: field(data, 'previous') }
  })
}

export function useDeleteReading() {
  return useEvMutation(async (id: string) => fail((await supabase.rpc('delete_ev_reading', { p_reading_id: id })).error))
}

/** rpc('import_ev'): one transaction; replaces earlier imported readings, charges and payments for those months. */
export function useImportEv() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: async (payload: EvImportPayload): Promise<EvImportCounts> => {
      const data: unknown = must(await supabase.rpc('import_ev', { payload }))
      const keys = ['chargers', 'readings', 'kept_manual', 'rates', 'payments', 'main_charges'] as const
      return Object.fromEntries(keys.map((k) => [k, field(data, k)]))
    },
    onSettled: () => client.invalidateQueries(),
  })
}

/** The signed-in resident's charger (null when their apartment has none) and its readings. */
export function useMyCharger() {
  const mine = useMyApartmentId()
  const id = mine.data ?? null
  const q = useQuery({
    queryKey: [...KEY, 'my-charger', id],
    enabled: mine.isSuccess,
    queryFn: async () => {
      if (!id) return null
      const charger = must(await supabase.from('ev_chargers').select('id').eq('apartment_id', id))[0]
      if (!charger) return null
      const readings = must(await supabase.from('ev_readings').select('id, month, kwh, amount').eq('charger_id', charger.id)
        .order('month', { ascending: false }).limit(12))
      return readings.map((r) => ({ id: r.id, month: r.month, kwh: numOrNull(r.kwh), amount: numOrNull(r.amount) }))
    },
  })
  return { ...q, isLoading: mine.isLoading || q.isLoading, isError: mine.isError || q.isError }
}
