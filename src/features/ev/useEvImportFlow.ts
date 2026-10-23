// State and derived data for the EV import. Choices live here so going back a step never loses an edit.
import { useMemo, useState } from 'react'
import { todayISO } from '../../lib/dates'
import { monthOf } from '../finance/ledger'
import { useApartments } from '../tenants/api'
import { useChargers, useEvPayments, useMainEvCharges } from './api'
import {
  buildEvPayload, coveredKeys, derivePayments, deriveRates, deriveReadings, paymentKey, summarizeEv, type ChargerPlan, type EvPaymentRow,
} from './buildEvImport'
import { formatKwh } from '../../lib/format'
import { he } from '../../lib/he'
import type { Rate } from './evMath'
import type { EvSheet } from './parseEvWorkbook'

export function useEvImportState() {
  const [sheet, setSheet] = useState<EvSheet | null>(null)
  const [ratesEdit, setRates] = useState<Rate[] | null>(null)
  const [includePayments, setIncludePayments] = useState(true)
  const [importOverlaps, setImportOverlaps] = useState(false)
  const [replaceMain, setReplaceMain] = useState(true)
  const load = (s: EvSheet): void => {
    setSheet(s)
    setRates(null)
    setIncludePayments(true)
    setImportOverlaps(false)
    setReplaceMain(true)
  }
  return { sheet, load, ratesEdit, setRates, includePayments, setIncludePayments, importOverlaps, setImportOverlaps, replaceMain, setReplaceMain }
}
export type EvImportState = ReturnType<typeof useEvImportState>

/**
 * What the system holds already: chargers (with initial readings) and apartments by number, EV payments by
 * apartment-month (manual ones, and the main workbook's 'import' ones apart), and the main workbook's EV charges.
 */
export function useEvImportContext() {
  const chargers = useChargers()
  const apartments = useApartments()
  const ids = useMemo(() => (apartments.data ?? []).map((a) => a.id), [apartments.data])
  const payments = useEvPayments(ids)
  const mainCharges = useMainEvCharges(ids)
  return useMemo(() => {
    const numberOf = new Map((apartments.data ?? []).map((a) => [a.id, a.number]))
    const key = (id: string, month: string) => paymentKey(numberOf.get(id) ?? 0, month)
    const pays = payments.data ?? []
    return {
      chargerNumbers: new Set((chargers.data ?? []).map((c) => c.number)),
      initial: new Map((chargers.data ?? []).map((c) => [c.number, c.initial_reading])),
      apartmentNumbers: new Set(numberOf.values()),
      existing: new Set(pays.filter((p) => p.source !== 'ev-import' && p.source !== 'import').map((p) => key(p.apartment_id, p.paid_on))),
      mainPayments: new Set(pays.filter((p) => p.source === 'import').map((p) => key(p.apartment_id, p.paid_on))),
      mainCharges: (mainCharges.data ?? []).map((c) => key(c.apartment_id, c.month)),
      loading: chargers.isLoading || apartments.isLoading || (ids.length > 0 && (payments.isLoading || mainCharges.isLoading)),
    }
  }, [chargers.data, apartments.data, payments.data, mainCharges.data, ids.length, chargers.isLoading, apartments.isLoading, payments.isLoading, mainCharges.isLoading])
}
export type EvImportContext = ReturnType<typeof useEvImportContext>

/** First reading month that has no rate in force, or null. */
function uncoveredMonth(rates: readonly Rate[], months: string[]): string | null {
  const first = [...months].sort()[0]
  const earliest = [...rates].map((r) => r.effective_from).sort()[0]
  return first && (!earliest || first < earliest) ? first : null
}

export function ratesValid(rates: readonly Rate[]): boolean {
  return rates.length > 0 && rates.every((r) => r.rate > 0) && new Set(rates.map((r) => r.effective_from)).size === rates.length
}

/** An existing charger whose initial reading the import would change. */
const initialWarnings = (chargers: ChargerPlan[], initial: ReadonlyMap<number, number>): string[] => chargers.flatMap((c) => {
  const old = initial.get(c.apartment)
  return old !== undefined && old !== c.initial_reading ? [he.ev.import.warnInitial(c.apartment, formatKwh(old), formatKwh(c.initial_reading))] : []
})

export function useEvDerived(st: EvImportState, ctx: EvImportContext) {
  return useMemo(() => {
    if (!st.sheet) return null
    const now = monthOf(todayISO())
    const readings = deriveReadings(st.sheet, now)
    const rates = st.ratesEdit ?? deriveRates(st.sheet, readings.chargers, now)
    const payments = derivePayments(st.sheet)
    const covered = coveredKeys(readings.chargers, payments)
    const mainCharges = ctx.mainCharges.filter((k) => covered.has(k)).length
    const replaceMain = st.replaceMain && (mainCharges > 0 || [...ctx.mainPayments].some((k) => covered.has(k)))
    // Main-import EV payments are deleted when replacing, so those months are no longer overlaps.
    const taken = (k: string) => ctx.existing.has(k) || (!replaceMain && ctx.mainPayments.has(k))
    const overlaps: EvPaymentRow[] = payments.filter((p) => taken(paymentKey(p.apartment, p.paid_on)))
    const skip = new Set(st.importOverlaps ? [] : overlaps.map((p) => paymentKey(p.apartment, p.paid_on)))
    const payload = buildEvPayload(readings.chargers, rates, payments, { includePayments: st.includePayments, skipPayments: skip, replaceMain })
    const missing = uncoveredMonth(rates, readings.chargers.flatMap((c) => c.readings.map((r) => r.month)))
    const warnings = [...initialWarnings(readings.chargers, ctx.initial), ...readings.warnings]
    return { ...readings, warnings, rates, payments, overlaps, payload, missing, mainCharges, summary: summarizeEv(readings.chargers, rates) }
  }, [st.sheet, st.ratesEdit, st.includePayments, st.importOverlaps, st.replaceMain, ctx])
}
export type EvDerived = NonNullable<ReturnType<typeof useEvDerived>>
