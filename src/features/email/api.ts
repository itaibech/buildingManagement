import { FunctionsHttpError } from '@supabase/supabase-js'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { he } from '../../lib/he'
import { supabase } from '../../lib/supabase'
import { notifyError, notifyInfo, notifySuccess } from '../../ui/notify'

export type EmailKind = 'announcement' | 'ticket' | 'debt' | 'test'

/** What to send. apartmentIds omitted = the kind's default (ticket: the opener's apartment; others: all). */
export interface EmailRequest {
  kind: EmailKind
  id?: string
  apartmentIds?: string[] | 'all'
  note?: string
}

export interface EmailPreview { recipients: number; skipped: number[]; dryRun: boolean; remainingToday: number }
export interface EmailResult { recipients: number; sent: number; failed: number; skipped: number[]; dryRun: boolean }
export interface EmailLogRow {
  id: string
  created_at: string
  kind: string
  recipients: number
  sent: number
  failed: number
  dry_run: boolean
}

type Json = Record<string, unknown>
const isJson = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v)
const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0)
const nums = (v: unknown): number[] => (Array.isArray(v) ? v.filter((n): n is number => typeof n === 'number') : [])

/** The function's Hebrew error (e.g. the daily cap), else a generic failure. */
async function errorMessage(error: unknown): Promise<string> {
  if (error instanceof FunctionsHttpError && error.context instanceof Response) {
    const body: unknown = await error.context.json().catch(() => null)
    if (isJson(body) && typeof body.error === 'string') return body.error
  }
  return he.mail.failed
}

async function invoke(body: Json): Promise<Json> {
  const { data, error } = await supabase.functions.invoke<unknown>('send-email', { body })
  if (error) throw new Error(await errorMessage(error))
  if (!isJson(data)) throw new Error(he.mail.failed)
  return data
}

/** Recipient count (no email is sent); null request = nothing to count yet. */
export function useEmailPreview(req: EmailRequest | null) {
  return useQuery({
    queryKey: ['email', 'preview', req],
    enabled: req !== null,
    retry: false,
    queryFn: async (): Promise<EmailPreview> => {
      const d = await invoke({ ...req, preview: true })
      return { recipients: num(d.recipients), skipped: nums(d.skipped), dryRun: d.dryRun === true, remainingToday: num(d.remainingToday) }
    },
  })
}

function toastResult(r: EmailResult): void {
  if (r.dryRun) notifyInfo(he.mail.dryRunSent(r.sent))
  else if (r.failed > 0) notifyError(he.mail.someFailed(r.sent, r.failed))
  else notifySuccess(he.mail.sent(r.sent))
}

/** Sends (admin only; the function checks). Toasts the outcome and refreshes the history. */
export function useSendEmail() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: async (req: EmailRequest): Promise<EmailResult> => {
      const d = await invoke({ ...req })
      return { recipients: num(d.recipients), sent: num(d.sent), failed: num(d.failed), skipped: nums(d.skipped), dryRun: d.dryRun === true }
    },
    onSuccess: toastResult,
    onError: (e) => notifyError(e.message || he.mail.failed),
    onSettled: () => client.invalidateQueries({ queryKey: ['email'] }),
  })
}

/** The latest sends ("היסטוריית מיילים"); RLS: admins only. */
export function useEmailLog() {
  return useQuery({
    queryKey: ['email', 'log'],
    queryFn: async (): Promise<EmailLogRow[]> => {
      const { data, error } = await supabase.from('email_log')
        .select('id, created_at, kind, recipients, sent, failed, dry_run').order('created_at', { ascending: false }).limit(20)
      if (error) throw new Error(error.message)
      return data
    },
  })
}
