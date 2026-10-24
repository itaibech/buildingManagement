import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback, useMemo } from 'react'
import type { Database } from '../../lib/db.types'
import { supabase } from '../../lib/supabase'

type Tables = Database['public']['Tables']
type SaveApartmentArgs = Database['public']['Functions']['save_apartment']['Args']
export type Apartment = Tables['apartments']['Row']
export type Resident = Tables['residents']['Row']
export type Profile = Tables['profiles']['Row']
export type Role = 'admin' | 'resident'

/** How the apartment pays its monthly fee: manually, or collected automatically by standing order. */
export type PayMethod = 'manual' | 'standing_order'
export const isPayMethod = (v: unknown): v is PayMethod => v === 'manual' || v === 'standing_order'

/** An apartment's payment method (apartment_billing, finance-private). */
export interface Billing { paymentMethod: PayMethod; standingOrderFrom: string | null }
const MANUAL: Billing = { paymentMethod: 'manual', standingOrderFrom: null }
/** The apartment's billing; no row (or a row RLS hides) = manual. */
export const billingOf = (billing: ReadonlyMap<string, Billing> | undefined, apartmentId: string): Billing => billing?.get(apartmentId) ?? MANUAL

/** Everything the apartment form saves in one save_apartment call. fee null = the building rate. */
export interface ApartmentInput {
  id?: string
  number: number
  floor: number | null
  notes: string | null
  fee: number | null
  isCommittee: boolean
  paymentMethod: PayMethod
  /** First of the month the standing order starts; ignored for manual payment. */
  standingOrderFrom: string | null
  ev: boolean
  evInitial: number
}

export interface ResidentInput {
  id?: string
  apartment_id: string
  full_name: string
  phone: string | null
  email: string | null
  is_owner: boolean
}

export type ProfilePatch = Partial<Pick<Profile, 'role' | 'status' | 'resident_id'>>

interface DbError {
  message: string
  code?: string
}

/** Postgres error carried through react-query so forms can map codes (e.g. 23505) to messages. */
export class DbFailure extends Error {
  readonly code: string | undefined
  constructor(e: DbError) {
    super(e.message)
    this.code = e.code
  }
}

function check(error: DbError | null): void {
  if (error) throw new DbFailure(error)
}

function rows<T>({ data, error }: { data: T[] | null; error: DbError | null }): T[] {
  check(error)
  return data ?? []
}

const KEYS = { apartments: ['apartments'], residents: ['residents'], profiles: ['profiles'] } as const

export function useApartments() {
  return useQuery({
    queryKey: KEYS.apartments,
    queryFn: async () => rows(await supabase.from('apartments').select('*').order('number')),
  })
}

export function useResidents(apartmentId?: string) {
  return useQuery({
    queryKey: [...KEYS.residents, apartmentId ?? 'all'],
    queryFn: async () => {
      const q = supabase.from('residents').select('*').order('full_name')
      return rows(await (apartmentId ? q.eq('apartment_id', apartmentId) : q))
    },
  })
}

/**
 * Payment methods by apartment id. RLS: admins get every apartment, a resident only their own (others read as
 * manual). Under ['finance'] so save_apartment (and every finance mutation) refreshes it.
 */
export function useApartmentBilling() {
  return useQuery({
    queryKey: ['finance', 'billing'],
    queryFn: async (): Promise<ReadonlyMap<string, Billing>> => {
      const data = rows(await supabase.from('apartment_billing').select('apartment_id, payment_method, standing_order_from'))
      return new Map(data.map((b) => [b.apartment_id, {
        paymentMethod: isPayMethod(b.payment_method) ? b.payment_method : 'manual', standingOrderFrom: b.standing_order_from,
      }]))
    },
  })
}

function useInvalidate() {
  const client = useQueryClient()
  return useCallback(
    (...keys: (keyof typeof KEYS)[]) =>
      Promise.all(keys.map((k) => client.invalidateQueries({ queryKey: KEYS[k] }))).then(() => undefined),
    [client],
  )
}

/** rpc('save_apartment') arguments. Nulls are left out: every parameter defaults to null (p_id null = new). */
export function toSaveApartmentArgs(v: ApartmentInput): SaveApartmentArgs {
  const from = v.paymentMethod === 'standing_order' ? v.standingOrderFrom : null
  return {
    ...(v.id ? { p_id: v.id } : {}),
    p_number: v.number,
    ...(v.floor === null ? {} : { p_floor: v.floor }),
    ...(v.notes === null ? {} : { p_notes: v.notes }),
    ...(v.fee === null ? {} : { p_fee: v.fee }),
    p_is_committee: v.isCommittee,
    p_payment_method: v.paymentMethod,
    ...(from === null ? {} : { p_standing_order_from: from }),
    p_ev: v.ev,
    p_ev_initial: v.ev ? v.evInitial : 0,
  }
}

/** Saves the apartment, its fee, committee flag, payment method and charger atomically; refreshes finance and EV. */
export function useSaveApartment() {
  const invalidate = useInvalidate()
  const client = useQueryClient()
  return useMutation({
    mutationFn: async (input: ApartmentInput) => {
      const { data, error } = await supabase.rpc('save_apartment', toSaveApartmentArgs(input))
      check(error)
      return data
    },
    onSuccess: () => Promise.all([invalidate('apartments'), client.invalidateQueries({ queryKey: ['finance'] })]).then(() => undefined),
  })
}

/**
 * Deleting an apartment with money history is refused on purpose: charges/payments restrict the apartment (23503),
 * and EV charges can't be removed by API roles (42501, charges_guard_ev).
 */
export function isMoneyHistoryError(e: unknown): boolean {
  return e instanceof DbFailure && (e.code === '23503' || e.code === '42501')
}

export function useDeleteApartment() {
  const invalidate = useInvalidate()
  return useMutation({
    mutationFn: async (id: string) => check((await supabase.from('apartments').delete().eq('id', id)).error),
    onSuccess: () => invalidate('apartments', 'residents', 'profiles'),
  })
}

export function useSaveResident() {
  const invalidate = useInvalidate()
  return useMutation({
    mutationFn: async ({ id, ...values }: ResidentInput) => {
      const table = supabase.from('residents')
      check((await (id ? table.update(values).eq('id', id) : table.insert(values))).error)
    },
    onSuccess: () => invalidate('residents'),
  })
}

export function useDeleteResident() {
  const invalidate = useInvalidate()
  return useMutation({
    mutationFn: async (id: string) => check((await supabase.from('residents').delete().eq('id', id)).error),
    onSuccess: () => invalidate('residents', 'profiles'),
  })
}

const profilesQuery = {
  queryKey: KEYS.profiles,
  queryFn: async () => rows(await supabase.from('profiles').select('*').order('created_at')),
}

export function useProfiles() {
  return useQuery(profilesQuery)
}

export function usePendingProfiles() {
  return useQuery({ ...profilesQuery, select: (ps: Profile[]) => ps.filter((p) => p.status === 'pending') })
}

export function useUpdateProfile() {
  const invalidate = useInvalidate()
  return useMutation({
    mutationFn: async ({ userId, patch }: { userId: string; patch: ProfilePatch }) =>
      check((await supabase.from('profiles').update(patch).eq('user_id', userId)).error),
    onSuccess: () => invalidate('profiles'),
  })
}

export function useApproveProfile(): (args: { userId: string; residentId: string | null; role: Role }) => Promise<void> {
  const { mutateAsync } = useUpdateProfile()
  return useCallback(
    ({ userId, residentId, role }) =>
      mutateAsync({ userId, patch: { status: 'approved', resident_id: residentId, role } }),
    [mutateAsync],
  )
}

export interface DirectoryEntry extends Resident {
  apartmentNumber: number
}

/** Residents joined to their apartment number, sorted by apartment then name. */
export function useDirectory() {
  const apartments = useApartments()
  const residents = useResidents()
  const data = useMemo(() => {
    if (!apartments.data || !residents.data) return undefined
    const numberOf = new Map(apartments.data.map((a) => [a.id, a.number]))
    return residents.data
      .map((r) => ({ ...r, apartmentNumber: numberOf.get(r.apartment_id) ?? 0 }))
      .sort((a, b) => a.apartmentNumber - b.apartmentNumber || a.full_name.localeCompare(b.full_name, 'he'))
  }, [apartments.data, residents.data])
  return { data, isLoading: apartments.isLoading || residents.isLoading, isError: apartments.isError || residents.isError }
}
