import { supabase } from '../../lib/supabase'
import { PROOF_BUCKET } from './ledger'

/**
 * Removes the proof objects 0037 queued (deleted payments, replaced or removed proofs) and clears them from the queue.
 * True when some stayed behind (they stay queued for the next sweep). Non-admins see an empty queue.
 * Its own module so the tenants and EV features can call it without importing the finance hooks.
 */
export async function sweepProofs(): Promise<boolean> {
  try {
    const { data, error } = await supabase.from('payment_proof_trash').select('path').limit(100)
    if (error) return true
    const queued = (data ?? []).map((r) => r.path)
    if (queued.length === 0) return false
    if ((await supabase.storage.from(PROOF_BUCKET).remove(queued)).error) return true
    return !!(await supabase.from('payment_proof_trash').delete().in('path', queued)).error
  } catch {
    return true
  }
}
