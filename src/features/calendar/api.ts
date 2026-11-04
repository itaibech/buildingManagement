// Calendar data access (the only place the feature touches its table). RLS decides who sees and writes what.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { fetchAll } from '../../lib/fetchAll'
import { supabase } from '../../lib/supabase'
import { isCategory, isRecurrence, type CalendarEventRow, type CalendarItem } from './types'

const KEY = ['calendar_events'] as const

export type EventInput = Pick<CalendarEventRow,
  'title' | 'description' | 'location' | 'category' | 'all_day' | 'starts_at' | 'ends_at' | 'recurrence' | 'recurrence_until' | 'visibility'>

/** A row as a calendar item (unknown categories from a newer DB show as "אחר"). */
export function toItem(row: CalendarEventRow): CalendarItem {
  return {
    id: row.id, source: 'event', title: row.title, description: row.description, location: row.location,
    category: isCategory(row.category) ? row.category : 'other', allDay: row.all_day, startsAt: row.starts_at, endsAt: row.ends_at,
    recurrence: isRecurrence(row.recurrence) ? row.recurrence : 'none', until: row.recurrence_until,
    committee: row.visibility === 'committee', row,
  }
}

/** Every event the user may see (residents: not committee-only), as items. */
export function useCalendarEvents(enabled: boolean) {
  return useQuery({
    queryKey: KEY,
    enabled,
    queryFn: async (): Promise<CalendarItem[]> => {
      const data = await fetchAll((f, t) => supabase.from('calendar_events').select('*').order('starts_at').order('id').range(f, t))
      return data.map(toItem)
    },
  })
}

export function useSaveEvent() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, values }: { id?: string; values: EventInput }) => {
      const table = supabase.from('calendar_events')
      const { error } = await (id ? table.update(values).eq('id', id) : table.insert(values))
      if (error) throw new Error(error.message)
    },
    onSuccess: () => client.invalidateQueries({ queryKey: KEY }),
  })
}

export function useDeleteEvent() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('calendar_events').delete().eq('id', id)
      if (error) throw new Error(error.message)
    },
    onSuccess: () => client.invalidateQueries({ queryKey: KEY }),
  })
}
