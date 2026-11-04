import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { Database } from '../../lib/db.types'
import { supabase } from '../../lib/supabase'

/** maintenance_reminder_settings (0038). No row = the defaults: on, 7 and 1 days before, plus overdue. */
export interface ReminderSettings { enabled: boolean; daysBefore: number[]; includeOverdue: boolean }
export const DEFAULT_REMINDERS: ReminderSettings = { enabled: true, daysBefore: [7, 1], includeOverdue: true }
/** The day choices in the settings card (the database allows 1-60, at most 6). */
export const DAY_OPTIONS = [30, 14, 7, 3, 2, 1] as const
export const MAX_DAYS = 6

export type ReminderLogRow = Pick<Database['public']['Tables']['maintenance_reminders_log']['Row'],
  'id' | 'item_kind' | 'item_id' | 'title' | 'due_on' | 'offset_days' | 'sent_on' | 'dry_run'>

const KEY = ['maintenance', 'reminders'] as const
export const HISTORY_ROWS = 30

/** Distinct whole days 1-60, largest first. */
export const normalizeDays = (days: readonly number[]): number[] =>
  [...new Set(days.filter((d) => Number.isInteger(d) && d >= 1 && d <= 60))].sort((a, b) => b - a)

/** The building's reminder settings (admins; RLS). */
export function useReminderSettings(enabled = true) {
  return useQuery({
    queryKey: [...KEY, 'settings'],
    enabled,
    queryFn: async (): Promise<ReminderSettings> => {
      const { data, error } = await supabase.from('maintenance_reminder_settings')
        .select('enabled, days_before, include_overdue').maybeSingle()
      if (error) throw new Error(error.message)
      return data ? { enabled: data.enabled, daysBefore: normalizeDays(data.days_before), includeOverdue: data.include_overdue } : DEFAULT_REMINDERS
    },
  })
}

export function useSaveReminderSettings() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: async ({ buildingId, settings }: { buildingId: string; settings: ReminderSettings }) => {
      const { error } = await supabase.from('maintenance_reminder_settings').upsert({
        building_id: buildingId, enabled: settings.enabled, days_before: normalizeDays(settings.daysBefore),
        include_overdue: settings.includeOverdue, updated_at: new Date().toISOString(),
      })
      if (error) throw new Error(error.message)
    },
    onSettled: () => client.invalidateQueries({ queryKey: KEY }),
  })
}

/** The log has a row per admin emailed: one history line per reminder (the newest row of each). */
export function distinctReminders(rows: readonly ReminderLogRow[], limit = HISTORY_ROWS): ReminderLogRow[] {
  const seen = new Set<string>()
  return rows.filter((r) => {
    const key = `${r.item_kind}:${r.item_id}:${r.due_on}:${r.offset_days}:${r.dry_run}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  }).slice(0, limit)
}

/** "היסטוריית תזכורות": the last 30 reminders sent (admins; RLS). */
export function useReminderHistory() {
  return useQuery({
    queryKey: [...KEY, 'history'],
    queryFn: async (): Promise<ReminderLogRow[]> => {
      const { data, error } = await supabase.from('maintenance_reminders_log')
        .select('id, item_kind, item_id, title, due_on, offset_days, sent_on, dry_run')
        .order('created_at', { ascending: false }).limit(HISTORY_ROWS * 5)
      if (error) throw new Error(error.message)
      return distinctReminders(data)
    },
  })
}
