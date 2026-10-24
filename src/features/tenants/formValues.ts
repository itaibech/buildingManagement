// Pure helpers for the add / edit apartment form: initial values from what applies now, and the form → input mapping.
import type { FeeMode } from '../../ui'
import { restoreAfterExempt, type TimelineRow } from '../finance/feeTimeline'
import type { Apartment, ApartmentInput, PayMethod } from './api'

export interface FormValues {
  number: number | string
  floor: number | string
  notes: string
  /** Empty = the building rate. */
  fee: number | string
  isCommittee: boolean
  paymentMethod: PayMethod
  standingOrderFrom: string
  ev: boolean
  evInitial: number | string
}

export interface FeeNow { fee: number; feeMode: FeeMode }

/** The building fee in force in `month` (the schedule is any order), else 0. */
export function buildingRateAt(fees: readonly { effective_from: string; amount: number }[], month: string): number {
  const inForce = fees.filter((f) => f.effective_from <= month).sort((a, b) => b.effective_from.localeCompare(a.effective_from))
  return inForce[0]?.amount ?? 0
}

/**
 * What the fee field starts with: a custom amount shows it; the building rate is the empty field. For a committee
 * representative (exempt) it holds what unchecking restores, so the field is right the moment the box is cleared.
 * Any other exemption (imported, or set in the fee timeline) leaves it empty, which keeps that exemption.
 */
export function initialFee(apartment: Apartment, now: FeeNow | undefined, timeline: readonly TimelineRow[], month: string): number | string {
  if (now?.feeMode === 'custom') return now.fee
  if (now?.feeMode !== 'exempt' || !apartment.is_committee) return ''
  const restore = restoreAfterExempt(timeline, month)
  return restore.mode === 'custom' && restore.amount !== null ? restore.amount : ''
}

export function initialValues(apartment: Apartment | undefined, fee: number | string, hasCharger: boolean, month: string): FormValues {
  return {
    number: apartment?.number ?? '',
    floor: apartment?.floor ?? '',
    notes: apartment?.notes ?? '',
    fee,
    isCommittee: apartment?.is_committee ?? false,
    paymentMethod: apartment?.payment_method === 'standing_order' ? 'standing_order' : 'manual',
    standingOrderFrom: apartment?.standing_order_from ?? month,
    ev: hasCharger,
    evInitial: 0,
  }
}

const numberOr = <T>(v: number | string, fallback: T): number | T => (typeof v === 'number' ? v : fallback)

export function toApartmentInput(v: FormValues, id?: string): ApartmentInput {
  return {
    ...(id ? { id } : {}),
    number: Number(v.number),
    floor: numberOr(v.floor, null),
    notes: v.notes.trim() || null,
    fee: numberOr(v.fee, null),
    isCommittee: v.isCommittee,
    paymentMethod: v.paymentMethod,
    standingOrderFrom: v.paymentMethod === 'standing_order' ? v.standingOrderFrom : null,
    ev: v.ev,
    evInitial: numberOr(v.evInitial, 0),
  }
}
