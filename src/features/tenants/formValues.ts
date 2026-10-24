// Pure helpers for the add / edit apartment form: initial values from what applies now, and the form → input mapping.
import type { FeeMode } from '../../ui'
import { restoreAfterExempt, type TimelineRow } from '../finance/feeTimeline'
import type { Apartment, ApartmentInput, Billing, PayMethod } from './api'

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

export interface InitialInputs { fee: number | string; billing: Billing; hasCharger: boolean; month: string }

export function initialValues(apartment: Apartment | undefined, { fee, billing, hasCharger, month }: InitialInputs): FormValues {
  return {
    number: apartment?.number ?? '',
    floor: apartment?.floor ?? '',
    notes: apartment?.notes ?? '',
    fee,
    isCommittee: apartment?.is_committee ?? false,
    paymentMethod: billing.paymentMethod,
    standingOrderFrom: billing.standingOrderFrom ?? month,
    ev: hasCharger,
    evInitial: 0,
  }
}

/** A standing order whose first month moves later keeps the automatic payments of the earlier months. */
export const movesStandingOrderLater = (saved: Billing, v: Pick<FormValues, 'paymentMethod' | 'standingOrderFrom'>): boolean =>
  saved.paymentMethod === 'standing_order' && saved.standingOrderFrom !== null && v.paymentMethod === 'standing_order'
    && v.standingOrderFrom > saved.standingOrderFrom

/**
 * After the fee history sheet changed the timeline: the fee field and the committee box as the data now says,
 * so saving the form doesn't undo the sheet's change (committee stays only while the exemption does).
 */
export function rederived(apartment: Apartment, now: FeeNow | undefined, timeline: readonly TimelineRow[], month: string): Pick<FormValues, 'fee' | 'isCommittee'> {
  return { fee: initialFee(apartment, now, timeline, month), isCommittee: apartment.is_committee && now?.feeMode === 'exempt' }
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
