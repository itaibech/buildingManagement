import { FunctionsHttpError } from '@supabase/supabase-js'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { he } from '../../lib/he'
import { supabase } from '../../lib/supabase'
import { notifyError, notifyInfo, notifySuccess } from '../../ui/notify'
import { planCalls } from './chunks'
import { emailStatusOf, type DebtLogRow, type EmailStatus } from './reminders'

export type EmailKind = 'announcement' | 'ticket' | 'debt' | 'test' | 'meeting'
export type MeetingEmailVariant = 'invite' | 'update' | 'published'

/** What to send. apartmentIds omitted = the kind's default (ticket: the opener's apartment; others: all). */
export interface EmailRequest {
  kind: EmailKind
  id?: string
  apartmentIds?: string[] | 'all'
  note?: string
  /** kind 'meeting' only: which email (invitation, its update, or the published protocol). */
  variant?: MeetingEmailVariant
}

export interface EmailPreview {
  recipients: number
  skipped: number[]
  dryRun: boolean
  remainingToday: number
  /** Emails per apartment id (for splitting a large send) and the function's per-call limit. */
  perApartment: Record<string, number>
  maxPerCall: number
}
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
const counts = (v: unknown): Record<string, number> =>
  isJson(v) ? Object.fromEntries(Object.entries(v).filter((e): e is [string, number] => typeof e[1] === 'number')) : {}

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

/** True when a real (not dry-run) send wouldn't fit in what remains of today's cap: sending is refused up front. */
export const overQuota = (p: EmailPreview): boolean => !p.dryRun && p.recipients > p.remainingToday

/** How many emails the send button may send: 0 (disabled) when unknown, empty, or over today's remaining quota. */
export const sendableCount = (p: EmailPreview | undefined): number => (p && !overQuota(p) ? p.recipients : 0)

/** Recipient count (no email is sent); null request = nothing to count yet. */
export function useEmailPreview(req: EmailRequest | null) {
  return useQuery({
    queryKey: ['email', 'preview', req],
    enabled: req !== null,
    retry: false,
    queryFn: async (): Promise<EmailPreview> => {
      const d = await invoke({ ...req, preview: true })
      return { recipients: num(d.recipients), skipped: nums(d.skipped), dryRun: d.dryRun === true, remainingToday: num(d.remainingToday),
        perApartment: counts(d.perApartment), maxPerCall: num(d.maxPerCall) }
    },
  })
}

function toastResult(r: EmailResult): void {
  if (r.dryRun) notifyInfo(he.mail.dryRunSent(r.sent))
  else if (r.failed > 0) notifyError(he.mail.someFailed(r.sent, r.failed))
  else notifySuccess(he.mail.sent(r.sent))
}

const toResult = (d: Json): EmailResult =>
  ({ recipients: num(d.recipients), sent: num(d.sent), failed: num(d.failed), skipped: nums(d.skipped), dryRun: d.dryRun === true })

/**
 * Sends the calls one after another (each reserves its own quota), reporting progress as emails go out. A failed call
 * stops the rest; if some were already sent, the error says how many.
 */
export async function sendInCalls(calls: readonly EmailRequest[], total: number, onProgress?: (done: number, total: number) => void): Promise<EmailResult> {
  const sum: EmailResult = { recipients: 0, sent: 0, failed: 0, skipped: [], dryRun: false }
  for (const call of calls) {
    try {
      const r = toResult(await invoke({ ...call }))
      Object.assign(sum, { recipients: sum.recipients + r.recipients, sent: sum.sent + r.sent, failed: sum.failed + r.failed,
        skipped: [...new Set([...sum.skipped, ...r.skipped])], dryRun: sum.dryRun || r.dryRun })
      onProgress?.(sum.sent + sum.failed, total)
    } catch (e) {
      const message = e instanceof Error ? e.message : he.mail.failed
      throw new Error(sum.sent > 0 ? `${he.mail.progress(sum.sent, total)}. ${message}` : message)
    }
  }
  return sum
}

/**
 * Sends one request, or several (a large send split by planCalls). Toasts the outcome and refreshes the history.
 * `onProgress` reports "נשלחו X מתוך Y" while a split send runs. Admin only; the function checks.
 */
export function useSendEmail(onProgress?: (done: number, total: number) => void) {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (job: EmailRequest | { calls: EmailRequest[]; total: number }): Promise<EmailResult> =>
      'calls' in job ? sendInCalls(job.calls, job.total, onProgress) : sendInCalls([job], 0),
    onSuccess: toastResult,
    onError: (e) => notifyError(e.message || he.mail.failed),
    onSettled: () => client.invalidateQueries({ queryKey: ['email'] }),
  })
}

export interface SendProgress { done: number; total: number }

/** Sends a request, split into calls of at most maxPerCall emails when the preview says it is larger; tracks progress. */
export function useSplitSend() {
  const [progress, setProgress] = useState<SendProgress | null>(null)
  const send = useSendEmail((done, total) => setProgress({ done, total }))
  const start = (req: EmailRequest, preview: EmailPreview | undefined, onDone: () => void) => {
    if (!preview) return
    const calls = planCalls(req, preview)
    const split = calls.length > 1
    setProgress(split ? { done: 0, total: preview.recipients } : null)
    send.mutate(split ? { calls, total: preview.recipients } : req, { onSuccess: onDone, onSettled: () => setProgress(null) })
  }
  return { start, progress, isPending: send.isPending }
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

/** send-email's status reply (kind 'test', preview, status): the HTTP status (null on a network error) and the body. */
async function fetchEmailStatus(): Promise<Exclude<EmailStatus, 'loading'>> {
  const { data, error } = await supabase.functions.invoke<unknown>('send-email', { body: { kind: 'test', preview: true, status: true } })
  if (!error) return emailStatusOf(200, data)
  if (error instanceof FunctionsHttpError && error.context instanceof Response) {
    return emailStatusOf(error.context.status, await error.context.json().catch(() => null))
  }
  return emailStatusOf(null, null)
}

/** Whether send-email can send (no email is sent): live, dry run (test mode), or unreachable. */
export function useEmailStatus(): EmailStatus {
  const q = useQuery({ queryKey: ['email', 'status'], retry: false, staleTime: 10 * 60_000, queryFn: fetchEmailStatus })
  if (q.isLoading) return 'loading'
  return q.data ?? 'unavailable'
}

/** The debt reminders sent (email_log; RLS: admins only), for "נשלחה תזכורת לפני X ימים". */
export function useDebtReminderLog(enabled = true) {
  return useQuery({
    queryKey: ['email', 'debt-log'],
    enabled,
    queryFn: async (): Promise<DebtLogRow[]> => {
      const { data, error } = await supabase.from('email_log').select('created_at, apartment_ids, dry_run')
        .eq('kind', 'debt').order('created_at', { ascending: false }).limit(500)
      if (error) throw new Error(error.message)
      return data
    },
  })
}
