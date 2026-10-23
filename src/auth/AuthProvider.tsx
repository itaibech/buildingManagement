import type { Session } from '@supabase/supabase-js'
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import type { Database } from '../lib/db.types'
import { supabase } from '../lib/supabase'

export type Profile = Database['public']['Tables']['profiles']['Row']

export interface AuthState {
  session: Session | null
  profile: Profile | null
  isAdmin: boolean
  loading: boolean
  signOut(): Promise<void>
}

const AuthContext = createContext<AuthState | null>(null)

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>')
  return ctx
}

async function fetchProfile(userId: string): Promise<Profile | null> {
  const { data } = await supabase.from('profiles').select('*').eq('user_id', userId).maybeSingle()
  return data
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [loaded, setLoaded] = useState<{ userId: string; profile: Profile | null } | null>(null)
  const [sessionLoaded, setSessionLoaded] = useState(false)

  useEffect(() => {
    void supabase.auth.getSession().then(({ data }) => {
      setSession(data.session)
      setSessionLoaded(true)
    })
    const { data } = supabase.auth.onAuthStateChange((_event, next) => {
      setSession(next)
      setSessionLoaded(true)
    })
    return () => data.subscription.unsubscribe()
  }, [])

  const userId = session?.user.id
  useEffect(() => {
    if (!userId) return
    let cancelled = false
    void fetchProfile(userId).then((row) => {
      if (!cancelled) setLoaded({ userId, profile: row })
    })
    return () => {
      cancelled = true
    }
  }, [userId])

  const profile = userId && loaded?.userId === userId ? loaded.profile : null
  const profileLoading = Boolean(userId) && loaded?.userId !== userId

  const value = useMemo<AuthState>(
    () => ({
      session,
      profile,
      isAdmin: profile?.role === 'admin' && profile.status === 'approved',
      loading: !sessionLoaded || profileLoading,
      signOut: async () => {
        await supabase.auth.signOut()
      },
    }),
    [session, profile, sessionLoaded, profileLoading],
  )
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}
