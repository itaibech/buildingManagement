// The admin form's values <-> a calendar_events row. Dates and times are typed in Israel time.
import { todayISO } from '../../lib/dates'
import { he } from '../../lib/he'
import { fromInputs, meetingISODate, meetingTime } from '../meetings/fmt'
import type { EventInput } from './api'
import { isCategory, isRecurrence, type CalendarEventRow, type Category, type Recurrence, type Visibility } from './types'

const E = he.calendar.form.errors

export interface EventValues {
  title: string
  category: Category
  all_day: boolean
  date: string
  time: string
  end_date: string
  end_time: string
  location: string
  description: string
  recurrence: Recurrence
  until: string
  visibility: Visibility
}

export function toValues(row: CalendarEventRow | undefined, today: string = todayISO()): EventValues {
  if (!row) {
    return {
      title: '', category: 'other', all_day: false, date: today, time: '09:00', end_date: '', end_time: '', location: '', description: '',
      recurrence: 'none', until: '', visibility: 'residents',
    }
  }
  const end = row.ends_at
  return {
    title: row.title, category: isCategory(row.category) ? row.category : 'other', all_day: row.all_day, date: meetingISODate(row.starts_at),
    time: row.all_day ? '09:00' : meetingTime(row.starts_at), end_date: end ? meetingISODate(end) : '',
    end_time: end && !row.all_day ? meetingTime(end) : '', location: row.location, description: row.description,
    recurrence: isRecurrence(row.recurrence) ? row.recurrence : 'none', until: row.recurrence_until ?? '', visibility: row.visibility === 'committee' ? 'committee' : 'residents',
  }
}

/** The end timestamp the values describe, or null (no end). */
function endOf(v: EventValues): string | null {
  if (v.all_day) return v.end_date && v.end_date !== v.date ? fromInputs(v.end_date, '00:00') : null
  return v.end_time ? fromInputs(v.end_date || v.date, v.end_time) : null
}

export function toInput(v: EventValues): EventInput {
  return {
    title: v.title.trim(), description: v.description.trim(), location: v.location.trim(), category: v.category, all_day: v.all_day,
    starts_at: fromInputs(v.date, v.all_day ? '00:00' : v.time), ends_at: endOf(v), recurrence: v.recurrence,
    recurrence_until: v.recurrence === 'none' ? null : v.until || null, visibility: v.visibility,
  }
}

/** The form's checks (the table enforces the same). */
export const validateEvent = {
  title: (t: string) => (t.trim() ? null : E.title),
  date: (d: string) => (d ? null : E.date),
  time: (t: string, v: EventValues) => (v.all_day || t ? null : E.time),
  end_date: (_: string, v: EventValues) => {
    if (!v.date || (v.all_day ? !v.end_date : !v.end_time)) return null
    const end = endOf(v)
    return end && end < fromInputs(v.date, v.all_day ? '00:00' : v.time || '00:00') ? E.endBeforeStart : null
  },
  until: (u: string, v: EventValues) => (v.recurrence !== 'none' && u && v.date && u < v.date ? E.untilBeforeStart : null),
}
