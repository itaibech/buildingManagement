import type { Session } from '@supabase/supabase-js'
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { makeCan, type PermissionNeed } from '../lib/permissions'
import { supabase } from '../lib/supabase'
import { usePermissions } from './usePermissions'
import { useProfile, type Profile } from './useProfile'

export type { Profile }

export interface AuthState {
  session: Session | null
  profile: Profile | null
  isAdmin: boolean
  /** Whether the user may open a page or feature (admins: always). UX only: RLS enforces every key. */
  can(need: PermissionNeed): boolean
  loading: boolean
  error: string | null
  retry(): void
  signOut(): Promise<void>
  /** The session came from a password-reset link: the app routes to #/reset-password until it is used. */
  recovery: boolean
  endRecovery(): void
}

const AuthContext = createContext<AuthState | null>(null)

// oxlint-disable-next-line react/only-export-components -- useAuth must live beside its provider
export function useAuth(): AuthState {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>')
  return ctx
}

function useSession(): { session: Session | null; loaded: boolean; recovery: boolean; endRecovery: () => void } {
  const [session, setSession] = useState<Session | null>(null)
  const [loaded, setLoaded] = useState(false)
  const [recovery, setRecovery] = useState(false)
  useEffect(() => {
    void supabase.auth.getSession().then(({ data }) => {
      setSession(data.session)
      setLoaded(true)
    })
    const { data } = supabase.auth.onAuthStateChange((event, next) => {
      if (event === 'PASSWORD_RECOVERY') setRecovery(true)
      setSession(next)
      setLoaded(true)
    })
    return () => data.subscription.unsubscribe()
  }, [])
  const endRecovery = useCallback(() => setRecovery(false), [])
  return { session, loaded, recovery, endRecovery }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const { session, loaded, recovery, endRecovery } = useSession()
  const { profile, loading, error, retry } = useProfile(session?.user.id)
  const approved = profile?.status === 'approved'
  const isAdmin = approved && profile.role === 'admin'
  const permissions = usePermissions(profile?.user_id, approved && !isAdmin)
  const value = useMemo<AuthState>(
    () => ({
      session,
      profile,
      isAdmin,
      can: makeCan(isAdmin, permissions.granted),
      loading: !loaded || loading || permissions.loading,
      error,
      retry,
      signOut: async () => {
        await supabase.auth.signOut()
      },
      recovery,
      endRecovery,
    }),
    [session, profile, isAdmin, permissions.granted, permissions.loading, loaded, loading, error, retry, recovery, endRecovery],
  )
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}
