import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'

export interface Building {
  id: string
  name: string
  address: string | null
  payment_instructions: string | null
  committee_contact: string | null
}
export type BuildingPatch = Pick<Building, 'name' | 'address' | 'payment_instructions' | 'committee_contact'>

const KEY = ['building'] as const

/** The single building (approved users read it; RLS). */
export function useBuilding() {
  return useQuery({
    queryKey: KEY,
    queryFn: async (): Promise<Building | null> => {
      const { data, error } = await supabase.from('buildings')
        .select('id, name, address, payment_instructions, committee_contact').order('created_at').limit(1)
      if (error) throw new Error(error.message)
      return data[0] ?? null
    },
    staleTime: 5 * 60_000,
  })
}

/** Admin: name, address and the "how to pay" details residents see. */
export function useSaveBuilding() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, ...patch }: BuildingPatch & { id: string }): Promise<void> => {
      const { error } = await supabase.from('buildings').update(patch).eq('id', id)
      if (error) throw new Error(error.message)
    },
    onSettled: () => client.invalidateQueries({ queryKey: KEY }),
  })
}

/** A tel: href from a free-text phone ("050-123 4567" → "tel:0501234567"). */
export const telHref = (phone: string): string => `tel:${phone.replace(/[^\d+]/g, '')}`
