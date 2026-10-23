import { useEffect, useState } from 'react'
import { useAuth } from '../auth/AuthProvider'
import { supabase } from '../lib/supabase'

export interface ShellInfo {
  buildingName: string | null
  /** The signed-in user's apartment number, or null when the profile isn't linked to a resident. */
  apartmentNumber: number | null
}

const EMPTY: ShellInfo = { buildingName: null, apartmentNumber: null }

async function loadShellInfo(buildingId: string, residentId: string | null): Promise<ShellInfo> {
  const building = supabase.from('buildings').select('name').eq('id', buildingId).maybeSingle()
  const resident = residentId
    ? supabase.from('residents').select('apartments(number)').eq('id', residentId).maybeSingle()
    : Promise.resolve(null)
  const [b, r] = await Promise.all([building, resident])
  return { buildingName: b.data?.name ?? null, apartmentNumber: r?.data?.apartments?.number ?? null }
}

/** Building name and the user's apartment number for the header plate. */
export function useShellInfo(): ShellInfo {
  const { profile } = useAuth()
  const buildingId = profile?.building_id
  const residentId = profile?.resident_id ?? null
  const [info, setInfo] = useState<{ key: string; value: ShellInfo } | null>(null)
  const key = `${buildingId ?? ''}:${residentId ?? ''}`

  useEffect(() => {
    if (!buildingId) return
    let cancelled = false
    loadShellInfo(buildingId, residentId).then(
      (value) => !cancelled && setInfo({ key, value }),
      () => !cancelled && setInfo({ key, value: EMPTY }),
    )
    return () => {
      cancelled = true
    }
  }, [buildingId, residentId, key])

  return info?.key === key ? info.value : EMPTY
}
