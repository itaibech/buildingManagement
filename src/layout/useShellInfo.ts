import { useEffect, useState } from 'react'
import { useAuth } from '../auth/AuthProvider'
import { useBuilding } from '../features/settings/api'
import { supabase } from '../lib/supabase'

export interface ShellInfo {
  buildingName: string | null
  /** The signed-in user's apartment number, or null when the profile isn't linked to a resident. */
  apartmentNumber: number | null
}

async function loadApartmentNumber(residentId: string): Promise<number | null> {
  const r = await supabase.from('residents').select('apartments(number)').eq('id', residentId).maybeSingle()
  return r.data?.apartments?.number ?? null
}

/** Building name (shared query, so a rename in הגדרות בניין shows at once) and the user's apartment number. */
export function useShellInfo(): ShellInfo {
  const { profile } = useAuth()
  const building = useBuilding()
  const residentId = profile?.resident_id ?? null
  const [apartment, setApartment] = useState<{ key: string; value: number | null } | null>(null)

  useEffect(() => {
    if (!residentId) return
    let cancelled = false
    loadApartmentNumber(residentId).then(
      (value) => !cancelled && setApartment({ key: residentId, value }),
      () => !cancelled && setApartment({ key: residentId, value: null }),
    )
    return () => {
      cancelled = true
    }
  }, [residentId])

  return {
    buildingName: building.data?.name ?? null,
    apartmentNumber: residentId && apartment?.key === residentId ? apartment.value : null,
  }
}
