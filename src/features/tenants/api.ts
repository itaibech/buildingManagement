import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback, useMemo } from 'react'
import type { Database } from '../../lib/db.types'
import { supabase } from '../../lib/supabase'

type Tables = Database['public']['Tables']
export type Apartment = Tables['apartments']['Row']
export type Resident = Tables['residents']['Row']
export type Profile = Tables['profiles']['Row']
export type Role = 'admin' | 'resident'

export interface ApartmentInput {
  id?: string
  number: number
  floor: number | null
  notes: string | null
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

function useInvalidate() {
  const client = useQueryClient()
  return useCallback(
    (...keys: (keyof typeof KEYS)[]) =>
      Promise.all(keys.map((k) => client.invalidateQueries({ queryKey: KEYS[k] }))).then(() => undefined),
    [client],
  )
}

export function useSaveApartment() {
  const invalidate = useInvalidate()
  return useMutation({
    mutationFn: async ({ id, ...values }: ApartmentInput) => {
      const table = supabase.from('apartments')
      check((await (id ? table.update(values).eq('id', id) : table.insert(values))).error)
    },
    onSuccess: () => invalidate('apartments'),
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
