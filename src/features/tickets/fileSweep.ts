import { supabase } from '../../lib/supabase'
import { FILE_BUCKET } from './files'

/**
 * Removes the ticket-file objects 0039 queued (deleted file rows, a deleted ticket's files, failed uploads) and clears
 * them from the queue. True when some stayed behind (they stay queued for the next sweep). Non-admins see an empty queue.
 */
export async function sweepTicketFiles(): Promise<boolean> {
  try {
    const { data, error } = await supabase.from('ticket_file_trash').select('path').limit(100)
    if (error) return true
    const queued = (data ?? []).map((r) => r.path)
    if (queued.length === 0) return false
    if ((await supabase.storage.from(FILE_BUCKET).remove(queued)).error) return true
    return !!(await supabase.from('ticket_file_trash').delete().in('path', queued)).error
  } catch {
    return true
  }
}

/** An upload whose row was refused and whose cleanup failed too: queued, so the next sweep removes it. */
export async function queueTicketFile(path: string): Promise<void> {
  await supabase.rpc('queue_ticket_file', { p_path: path })
}
