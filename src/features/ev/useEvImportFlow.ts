// State and derived data for the EV import. Choices live here so going back a step never loses an edit.
import { useMemo, useState } from 'react'
import { todayISO } from '../../lib/dates'
import { monthOf } from '../finance/ledger'
import { useApartments } from '../tenants/api'
import { useChargers, useEvPayments } from './api'
import {
  buildEvPayload, derivePayments, deriveRates, deriveReadings, paymentKey, summarizeEv, type EvPaymentRow,
} from './buildEvImport'
import type { Rate } from './evMath'
import type { EvSheet } from './parseEvWorkbook'

export function useEvImportState() {
  const [sheet, setSheet] = useState<EvSheet | null>(null)
  const [ratesEdit, setRates] = useState<Rate[] | null>(null)
  const [includePayments, setIncludePayments] = useState(true)
  const [importOverlaps, setImportOverlaps] = useState(false)
  const load = (s: EvSheet): void => {
    setSheet(s)
    setRates(null)
    setIncludePayments(true)
    setImportOverlaps(false)
  }
  return { sheet, load, ratesEdit, setRates, includePayments, setIncludePayments, importOverlaps, setImportOverlaps }
}
export type EvImportState = ReturnType<typeof useEvImportState>

/** What the system holds already: chargers and apartments by number, and EV payments not from this import. */
export function useEvImportContext() {
  const chargers = useChargers()
  const apartments = useApartments()
  const ids = useMemo(() => (apartments.data ?? []).map((a) => a.id), [apartments.data])
  const payments = useEvPayments(ids)
  return useMemo(() => {
    const numberOf = new Map((apartments.data ?? []).map((a) => [a.id, a.number]))
    const existing = new Set((payments.data ?? []).filter((p) => p.source !== 'ev-import')
      .map((p) => paymentKey(numberOf.get(p.apartment_id) ?? 0, p.paid_on)))
    return {
      chargerNumbers: new Set((chargers.data ?? []).map((c) => c.number)),
      apartmentNumbers: new Set(numberOf.values()),
      existing,
      loading: chargers.isLoading || apartments.isLoading || (ids.length > 0 && payments.isLoading),
    }
  }, [chargers.data, apartments.data, payments.data, ids.length, chargers.isLoading, apartments.isLoading, payments.isLoading])
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

export function useEvDerived(st: EvImportState, ctx: EvImportContext) {
  return useMemo(() => {
    if (!st.sheet) return null
    const now = monthOf(todayISO())
    const readings = deriveReadings(st.sheet, now)
    const rates = st.ratesEdit ?? deriveRates(st.sheet, readings.chargers, now)
    const payments = derivePayments(st.sheet)
    const overlaps: EvPaymentRow[] = payments.filter((p) => ctx.existing.has(paymentKey(p.apartment, p.paid_on)))
    const skip = new Set(st.importOverlaps ? [] : overlaps.map((p) => paymentKey(p.apartment, p.paid_on)))
    const payload = buildEvPayload(readings.chargers, rates, payments, { includePayments: st.includePayments, skipPayments: skip })
    const missing = uncoveredMonth(rates, readings.chargers.flatMap((c) => c.readings.map((r) => r.month)))
    return { ...readings, rates, payments, overlaps, payload, missing, summary: summarizeEv(readings.chargers, rates) }
  }, [st.sheet, st.ratesEdit, st.includePayments, st.importOverlaps, ctx.existing])
}
export type EvDerived = NonNullable<ReturnType<typeof useEvDerived>>
