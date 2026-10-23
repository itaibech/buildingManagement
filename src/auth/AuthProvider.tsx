import type { Session } from '@supabase/supabase-js'
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { supabase } from '../lib/supabase'
import { useProfile, type Profile } from './useProfile'

export type { Profile }

export interface AuthState {
  session: Session | null
  profile: Profile | null
  isAdmin: boolean
  loading: boolean
  error: string | null
  retry(): void
  signOut(): Promise<void>
}

const AuthContext = createContext<AuthState | null>(null)

// oxlint-disable-next-line react/only-export-components -- useAuth must live beside its provider
export function useAuth(): AuthState {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>')
  return ctx
}

function useSession(): { session: Session | null; loaded: boolean } {
  const [session, setSession] = useState<Session | null>(null)
  const [loaded, setLoaded] = useState(false)
  useEffect(() => {
    void supabase.auth.getSession().then(({ data }) => {
      setSession(data.session)
      setLoaded(true)
    })
    const { data } = supabase.auth.onAuthStateChange((_event, next) => {
      setSession(next)
      setLoaded(true)
    })
    return () => data.subscription.unsubscribe()
  }, [])
  return { session, loaded }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const { session, loaded } = useSession()
  const { profile, loading, error, retry } = useProfile(session?.user.id)
  const value = useMemo<AuthState>(
    () => ({
      session,
      profile,
      isAdmin: profile?.role === 'admin' && profile.status === 'approved',
      loading: !loaded || loading,
      error,
      retry,
      signOut: async () => {
        await supabase.auth.signOut()
      },
    }),
    [session, profile, loaded, loading, error, retry],
  )
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}
