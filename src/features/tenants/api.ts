import { FunctionsHttpError } from '@supabase/supabase-js'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback, useMemo } from 'react'
import type { Database } from '../../lib/db.types'
import { he } from '../../lib/he'
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

export type ProfilePatch = Partial<Pick<Profile, 'role' | 'status' | 'resident_id' | 'group_id'>>

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

const apartmentsQuery = {
  queryKey: KEYS.apartments,
  queryFn: async () => rows(await supabase.from('apartments').select('*').order('number')),
}
const active = (list: Apartment[]): Apartment[] => list.filter((a) => !a.archived_at)
const archived = (list: Apartment[]): Apartment[] => list.filter((a) => a.archived_at)

/** The building's apartments, without archived ones (every list, picker and charge form). */
export function useApartments() {
  return useQuery({ ...apartmentsQuery, select: active })
}

/** Every apartment, archived included: the apartment page and the exports of past periods. */
export function useAllApartments() {
  return useQuery(apartmentsQuery)
}

/** Archived apartments only ("ארכיון" on the apartments page). */
export function useArchivedApartments() {
  return useQuery({ ...apartmentsQuery, select: archived })
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

/** What an apartment holds (apartment_history, admin only), for the delete dialog. */
export interface ApartmentHistory { residents: number; payments: number; charges: number; ev_readings: number; tickets: number; meetings: number }
const HISTORY_KEYS = ['residents', 'payments', 'charges', 'ev_readings', 'tickets', 'meetings'] as const

export function toHistory(v: unknown): ApartmentHistory {
  const o = typeof v === 'object' && v !== null ? (v as Record<string, unknown>) : {}
  const n = (k: string): number => (typeof o[k] === 'number' ? (o[k] as number) : 0)
  return { residents: n('residents'), payments: n('payments'), charges: n('charges'), ev_readings: n('ev_readings'), tickets: n('tickets'), meetings: n('meetings') }
}

/** Anything beyond residents is history: with none, the apartment can simply be deleted. */
export const hasHistory = (h: ApartmentHistory): boolean => HISTORY_KEYS.some((k) => k !== 'residents' && h[k] > 0)

export function useApartmentHistory(id: string, enabled: boolean) {
  return useQuery({
    queryKey: ['apartment-history', id],
    enabled,
    staleTime: 0,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('apartment_history', { p_id: id })
      check(error)
      return toHistory(data)
    },
  })
}

function useApartmentRpc<T>(fn: (v: T) => Promise<void>) {
  const invalidate = useInvalidate()
  const client = useQueryClient()
  return useMutation({
    mutationFn: fn,
    onSuccess: () => Promise.all([invalidate('apartments', 'residents', 'profiles'), client.invalidateQueries({ queryKey: ['finance'] })]).then(() => undefined),
  })
}

export function useArchiveApartment() {
  return useApartmentRpc(async (id: string) => check((await supabase.rpc('archive_apartment', { p_id: id })).error))
}

export function useRestoreApartment() {
  return useApartmentRpc(async (id: string) => check((await supabase.rpc('restore_apartment', { p_id: id })).error))
}

interface StoragePath { bucket: string; path: string }
const toPaths = (v: unknown): StoragePath[] => {
  const list = typeof v === 'object' && v !== null ? (v as { paths?: unknown }).paths : null
  return Array.isArray(list) ? list.filter((p): p is StoragePath =>
    typeof p === 'object' && p !== null && typeof (p as StoragePath).bucket === 'string' && typeof (p as StoragePath).path === 'string') : []
}

/** delete_apartment_cascade, then the storage objects it reports (best effort: the rows are already gone). */
export function useDeleteApartmentCascade() {
  return useApartmentRpc(async ({ id, number }: { id: string; number: number }) => {
    const { data, error } = await supabase.rpc('delete_apartment_cascade', { p_id: id, p_confirm_number: number })
    check(error)
    const byBucket = new Map<string, string[]>()
    for (const p of toPaths(data)) byBucket.set(p.bucket, [...(byBucket.get(p.bucket) ?? []), p.path])
    await Promise.all([...byBucket].map(([bucket, paths]) => supabase.storage.from(bucket).remove(paths)))
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

/** Approves with the chosen resident link, role and group (admins see everything: no group). */
export function useApproveProfile(): (args: { userId: string; residentId: string | null; role: Role; groupId: string | null }) => Promise<void> {
  const { mutateAsync } = useUpdateProfile()
  return useCallback(
    ({ userId, residentId, role, groupId }) =>
      mutateAsync({ userId, patch: { status: 'approved', resident_id: residentId, role, group_id: role === 'admin' ? null : groupId } }),
    [mutateAsync],
  )
}

/** The admin-delete-user function's Hebrew error (self, super admin, …), else a generic failure. */
async function functionError(error: unknown): Promise<string> {
  if (error instanceof FunctionsHttpError && error.context instanceof Response) {
    const body: unknown = await error.context.json().catch(() => null)
    if (typeof body === 'object' && body !== null && typeof (body as { error?: unknown }).error === 'string') return (body as { error: string }).error
  }
  return he.users.deleteFailed
}

/** Deletes a user's login (Edge Function admin-delete-user); removeResident also removes their resident record. */
export function useDeleteUser() {
  const invalidate = useInvalidate()
  return useMutation({
    mutationFn: async (args: { userId: string; removeResident: boolean }) => {
      const { error } = await supabase.functions.invoke('admin-delete-user', { body: args })
      if (error) throw new Error(await functionError(error))
    },
    onSuccess: () => invalidate('profiles', 'residents'),
  })
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
