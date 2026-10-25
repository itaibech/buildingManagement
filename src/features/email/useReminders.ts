import { useMemo } from 'react'
import { todayISO } from '../../lib/dates'
import { he } from '../../lib/he'
import { useResidents } from '../tenants/api'
import { useDebtReminderLog } from './api'
import { daysSince, lastReminders, type LastReminder } from './reminders'

const D = he.mail.debt
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/** Apartment ids with at least one resident email (send-email writes to residents' addresses). */
export function useEmailApartments(): ReadonlySet<string> {
  const residents = useResidents()
  return useMemo(() => new Set((residents.data ?? []).filter((r) => EMAIL.test((r.email ?? '').trim())).map((r) => r.apartment_id)), [residents.data])
}

/** Apartment id → its last debt reminder (admins only). */
export function useLastReminders(): ReadonlyMap<string, LastReminder> {
  const q = useDebtReminderLog()
  return useMemo(() => lastReminders(q.data ?? []), [q.data])
}

/** "נשלחה תזכורת לפני 5 ימים" under a debtor row; nothing when none was sent. */
export function reminderStamp(last: LastReminder | undefined): string | undefined {
  if (!last) return undefined
  return D.sentAgo(daysSince(last.at, todayISO())) + (last.dryRun ? D.testSuffix : '')
}

