import { useEffect, useState } from 'react'

/** True only when the Supabase instance reports the Google provider as enabled. */
export function useGoogleEnabled(): boolean {
  const [enabled, setEnabled] = useState(false)
  useEffect(() => {
    let cancelled = false
    const url = `${import.meta.env.VITE_SUPABASE_URL}/auth/v1/settings`
    fetch(url, { headers: { apikey: import.meta.env.VITE_SUPABASE_ANON_KEY } })
      .then((r) => r.json() as Promise<{ external?: { google?: boolean } }>)
      .then((s) => {
        if (!cancelled) setEnabled(s.external?.google === true)
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [])
  return enabled
}
