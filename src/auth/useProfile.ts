import { useEffect, useState } from 'react'
import type { Database } from '../lib/db.types'
import { supabase } from '../lib/supabase'

export type Profile = Database['public']['Tables']['profiles']['Row']

interface Loaded {
  userId: string
  attempt: number
  profile: Profile | null
  error: string | null
}

export interface ProfileState {
  profile: Profile | null
  loading: boolean
  error: string | null
  retry(): void
}

/** Loads the signed-in user's profile; a failed request is reported as `error`, not as a missing row. */
export function useProfile(userId: string | undefined): ProfileState {
  const [attempt, setAttempt] = useState(0)
  const [loaded, setLoaded] = useState<Loaded | null>(null)

  useEffect(() => {
    if (!userId) return
    let cancelled = false
    void supabase
      .from('profiles')
      .select('*')
      .eq('user_id', userId)
      .maybeSingle()
      .then(
        ({ data, error }) => {
          if (!cancelled) setLoaded({ userId, attempt, profile: data, error: error?.message ?? null })
        },
        (e: unknown) => {
          if (!cancelled) setLoaded({ userId, attempt, profile: null, error: String(e) })
        },
      )
    return () => {
      cancelled = true
    }
  }, [userId, attempt])

  const current = userId && loaded?.userId === userId && loaded.attempt === attempt ? loaded : null
  return {
    profile: current?.profile ?? null,
    loading: Boolean(userId) && current === null,
    error: current?.error ?? null,
    retry: () => setAttempt((n) => n + 1),
  }
}
