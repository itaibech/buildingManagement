import { FunctionsHttpError } from '@supabase/supabase-js'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { Database } from '../../lib/db.types'
import { he } from '../../lib/he'
import { supabase } from '../../lib/supabase'

export type CommitteeMessage = Database['public']['Tables']['committee_messages']['Row']
export interface CommitteeMember { userId: string; name: string }
/** to: 'committee' (every committee member) or one member's user id. */
export interface ContactInput { to: string; subject: string; body: string }
/** emailed: at least one email went out; otherwise the message is only in the app (dry run, no addresses, quota). */
export interface ContactResult { emailed: boolean }

export const MAX_SUBJECT = 150
export const MAX_BODY = 3000
const KEY = ['committee-messages'] as const

type Json = Record<string, unknown>
const isJson = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v)

/** The function's Hebrew error (e.g. the daily limit), else a generic failure. */
async function errorMessage(error: unknown): Promise<string> {
  if (error instanceof FunctionsHttpError && error.context instanceof Response) {
    const body: unknown = await error.context.json().catch(() => null)
    if (isJson(body) && typeof body.error === 'string') return body.error
  }
  return he.committee.failed
}

/** The committee members the user may write to (committee_members(), 0029): names only. */
export function useCommitteeMembers(enabled = true) {
  return useQuery({
    queryKey: ['committee-members'],
    enabled,
    queryFn: async (): Promise<CommitteeMember[]> => {
      const { data, error } = await supabase.rpc('committee_members')
      if (error) throw new Error(error.message)
      return (data ?? []).map((r) => ({ userId: r.user_id, name: r.full_name }))
    },
  })
}

/** Sends a message to the committee (send-email, kind 'contact'). The function stores it before any email goes out. */
export async function sendContact(input: ContactInput): Promise<ContactResult> {
  const { data, error } = await supabase.functions.invoke<unknown>('send-email', { body: { kind: 'contact', ...input } })
  if (error) throw new Error(await errorMessage(error))
  if (!isJson(data)) throw new Error(he.committee.failed)
  return { emailed: data.dryRun !== true && typeof data.sent === 'number' && data.sent > 0 }
}

export function useSendContact() {
  const client = useQueryClient()
  return useMutation({ mutationFn: sendContact, onSettled: () => client.invalidateQueries({ queryKey: KEY }) })
}

/**
 * mailto: with the subject prefilled. The address is the sender's own, validated by the function at send time (no
 * whitespace or , ; < > "), so it goes in as is: encoding it would turn "@" into %40, which some mail apps keep.
 */
export const replyHref = (m: Pick<CommitteeMessage, 'sender_email' | 'subject'>): string | null =>
  m.sender_email ? `mailto:${m.sender_email}?subject=${encodeURIComponent(he.committee.inbox.replySubject(m.subject))}` : null

/** Admin inbox: the messages to the whole committee or to this admin (RLS), newest first. */
export function useCommitteeMessages() {
  return useQuery({
    queryKey: [...KEY, 'list'],
    queryFn: async (): Promise<CommitteeMessage[]> => {
      const { data, error } = await supabase.from('committee_messages').select('*').order('created_at', { ascending: false }).limit(200)
      if (error) throw new Error(error.message)
      return data
    },
  })
}

/**
 * After a new ticket: emails the committee (send-email, kind 'ticket_new'). Fire and forget: never awaited by the
 * form and never throws; a failure is dropped silently (the in-app notification still reaches the admins).
 */
export function notifyCommitteeOfTicket(ticketId: string): void {
  try {
    void supabase.functions.invoke('send-email', { body: { kind: 'ticket_new', id: ticketId } }).catch(() => undefined)
  } catch {
    // Email is best effort; the ticket is already saved.
  }
}
