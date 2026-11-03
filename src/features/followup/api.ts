import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { he } from '../../lib/he'
import { supabase } from '../../lib/supabase'
import { notifyError, notifyInfo, notifySuccess } from '../../ui/notify'
import { invoke } from '../email/api'
import { DEFAULT_SETTINGS, isFollowupStatus, isSkipReason, isStep, type Followup, type FollowupSettings } from './followup'

const KEY = ['followups'] as const
const H = he.followup

type Json = Record<string, unknown>
const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : Number(v) || 0)
const nums = (v: unknown): number[] => (Array.isArray(v) ? v.filter((n): n is number => typeof n === 'number') : [])

function must<T>({ data, error }: { data: T | null; error: { message: string } | null }): T {
  if (error) throw new Error(error.message)
  if (data === null) throw new Error('no data')
  return data
}

interface SettingsRow {
  enabled: boolean; min_amount: number; friendly_on: boolean; friendly_days: number; firm_on: boolean; firm_days: number
  letter_on: boolean; letter_days: number
}

const fromRow = (r: SettingsRow): FollowupSettings => ({
  enabled: r.enabled, minAmount: num(r.min_amount), friendlyOn: r.friendly_on, friendlyDays: r.friendly_days,
  firmOn: r.firm_on, firmDays: r.firm_days, letterOn: r.letter_on, letterDays: r.letter_days,
})

const toRow = (s: FollowupSettings): SettingsRow => ({
  enabled: s.enabled, min_amount: s.minAmount, friendly_on: s.friendlyOn, friendly_days: s.friendlyDays,
  firm_on: s.firmOn, firm_days: s.firmDays, letter_on: s.letterOn, letter_days: s.letterDays,
})

/** The building's follow-up settings (admins; RLS). No row yet = the defaults (off). */
export function useFollowupSettings() {
  return useQuery({
    queryKey: [...KEY, 'settings'],
    queryFn: async (): Promise<FollowupSettings> => {
      const { data, error } = await supabase.from('debt_followup_settings')
        .select('enabled, min_amount, friendly_on, friendly_days, firm_on, firm_days, letter_on, letter_days').maybeSingle()
      if (error) throw new Error(error.message)
      return data ? fromRow(data) : DEFAULT_SETTINGS
    },
  })
}

const isJson = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v)

/** "בדיקה עכשיו": the daily run for the admin's building now. Returns how many steps were recorded. */
async function refresh(): Promise<number> {
  const r: unknown = must(await supabase.rpc('refresh_debt_followups'))
  return isJson(r) ? num(r.created) : 0
}

/**
 * Admin: saves the settings (one row per building), then runs the check when the automation is on. The save is what
 * can fail; a failed check after it only says so (null = not run): the 09:00 job runs it anyway.
 */
export function useSaveFollowupSettings() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: async ({ buildingId, settings }: { buildingId: string; settings: FollowupSettings }): Promise<number | null> => {
      const { error } = await supabase.from('debt_followup_settings')
        .upsert({ building_id: buildingId, ...toRow(settings), updated_at: new Date().toISOString() })
      if (error) throw new Error(error.message)
      if (!settings.enabled) return null
      return refresh().catch(() => { notifyInfo(H.settings.checkLater); return null })
    },
    onSettled: () => client.invalidateQueries({ queryKey: KEY }),
  })
}

export function useRefreshFollowups() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: refresh,
    onSuccess: (n) => notifySuccess(H.settings.checked(n)),
    onError: () => notifyError(he.toast.failed),
    onSettled: () => client.invalidateQueries({ queryKey: KEY }),
  })
}

interface FollowupRow {
  id: string; apartment_id: string; step: number; status: string; skip_reason: string | null; debt_amount: number
  oldest_month: string; days_overdue: number; created_at: string; sent_at: string | null; done_at: string | null
  recipients: number | null; episode_closed_at: string | null
}

/** A row as the app types it; a step or status this app doesn't know is left out. */
const toFollowup = (r: FollowupRow): Followup[] => {
  const { step, status } = r
  if (!isStep(step) || !isFollowupStatus(status)) return []
  return [{
    id: r.id, apartmentId: r.apartment_id, step, status, skipReason: isSkipReason(r.skip_reason) ? r.skip_reason : null,
    debtAmount: num(r.debt_amount), oldestMonth: r.oldest_month, daysOverdue: r.days_overdue, createdAt: r.created_at,
    sentAt: r.sent_at, doneAt: r.done_at, recipients: r.recipients, episodeClosedAt: r.episode_closed_at,
  }]
}

const COLUMNS = 'id, apartment_id, step, status, skip_reason, debt_amount, oldest_month, days_overdue, created_at, sent_at, done_at, recipients, episode_closed_at'

/** The follow-up rows, newest first (admins; RLS): one apartment's, or the building's. */
export function useFollowups(apartmentId?: string) {
  return useQuery({
    queryKey: [...KEY, 'rows', apartmentId ?? 'all'],
    queryFn: async (): Promise<Followup[]> => {
      let q = supabase.from('debt_followups').select(COLUMNS).order('created_at', { ascending: false }).limit(500)
      if (apartmentId) q = q.eq('apartment_id', apartmentId)
      return must(await q).flatMap(toFollowup)
    },
  })
}

/** "טופל" on a step-3 task. */
export function useCompleteTask() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: async (id: string): Promise<void> => { must(await supabase.rpc('complete_debt_followup_task', { p_id: id })) },
    onError: () => notifyError(he.toast.failed),
    onSettled: () => client.invalidateQueries({ queryKey: KEY }),
  })
}

/** A 'review' row: sent (seen in the email log), or back to the queue. */
export function useResolveFollowup() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, sent }: { id: string; sent: boolean }): Promise<void> => {
      must(await supabase.rpc('resolve_debt_followup', { p_id: id, p_sent: sent }))
    },
    onError: () => notifyError(he.toast.failed),
    onSettled: () => client.invalidateQueries({ queryKey: KEY }),
  })
}

/** send-email's answer for kind 'debt_followup' (preview or send). */
export interface FollowupSend {
  pending: number
  apartments: number
  recipients: number
  deferred: number
  noEmail: number[]
  quotaFull: boolean
  dryRun: boolean
  sent: number
}

const toSend = (d: Json): FollowupSend => ({
  pending: num(d.pending), apartments: num(d.apartments), recipients: num(d.recipients), deferred: num(d.deferred),
  noEmail: nums(d.noEmail), quotaFull: d.quotaFull === true, dryRun: d.dryRun === true, sent: num(d.sent),
})

/** What one "שליחה" would send now (no email is sent). */
export function useFollowupPreview(enabled: boolean) {
  return useQuery({
    queryKey: [...KEY, 'preview'],
    enabled,
    retry: false,
    queryFn: async (): Promise<FollowupSend> => toSend(await invoke({ kind: 'debt_followup', preview: true })),
  })
}

function toastSend(r: FollowupSend): void {
  if (r.dryRun) notifyInfo(H.home.dryRunResult(r.sent))
  else if (r.quotaFull) notifyInfo(H.home.quotaFull)
  else if (r.sent > 0) notifySuccess(H.home.sentResult(r.sent))
  else notifyInfo(H.home.nothingSent)
}

/** "שליחה": the pending follow-up emails (the server picks them and keeps inside the quota). */
export function useSendFollowups() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: async (): Promise<FollowupSend> => toSend(await invoke({ kind: 'debt_followup' })),
    onSuccess: toastSend,
    onError: (e) => notifyError(e.message || he.mail.failed),
    onSettled: () => { void client.invalidateQueries({ queryKey: KEY }); void client.invalidateQueries({ queryKey: ['email'] }) },
  })
}
