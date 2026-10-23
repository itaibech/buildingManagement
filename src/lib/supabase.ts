import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import type { Database } from './db.types'

export interface SupabaseEnv {
  url: string
  anonKey: string
}

/** Validates the Vite env vars; throws a clear error instead of running half-configured. */
export function readSupabaseEnv(env: Partial<Record<string, string>>): SupabaseEnv {
  const url = env.VITE_SUPABASE_URL
  const anonKey = env.VITE_SUPABASE_ANON_KEY
  const missing = [
    url ? null : 'VITE_SUPABASE_URL',
    anonKey ? null : 'VITE_SUPABASE_ANON_KEY',
  ].filter((name): name is string => name !== null)
  if (!url || !anonKey) {
    throw new Error(
      `Missing ${missing.join(', ')}. Copy .env.example to .env.local (see README → Development).`,
    )
  }
  return { url, anonKey }
}

const { url, anonKey } = readSupabaseEnv(import.meta.env)

export const supabase: SupabaseClient<Database> = createClient<Database>(url, anonKey)
