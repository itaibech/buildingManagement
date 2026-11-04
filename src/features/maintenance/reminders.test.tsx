// @vitest-environment jsdom
import { MantineProvider } from '@mantine/core'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { he } from '../../lib/he'
import { theme } from '../../ui/theme'
import { ReminderLine, ReminderSettingsCard } from './ReminderSettingsCard'

const R = he.maintenance.reminders
const db = vi.hoisted(() => ({
  settings: null as Record<string, unknown> | null,
  history: [] as Record<string, unknown>[],
  upserts: [] as Record<string, unknown>[],
}))

vi.mock('../../lib/supabase', () => ({
  supabase: {
    from: (table: string) => {
      if (table === 'buildings') {
        const q = { select: () => q, order: () => q, limit: () => Promise.resolve({ data: [{ id: 'b1', name: 'הבניין' }], error: null }) }
        return q
      }
      if (table === 'maintenance_reminders_log') {
        const q = { select: () => q, order: () => q, limit: () => Promise.resolve({ data: db.history, error: null }) }
        return q
      }
      return {
        select: () => ({ maybeSingle: () => Promise.resolve({ data: db.settings, error: null }) }),
        upsert: (row: Record<string, unknown>) => { db.upserts.push(row); return Promise.resolve({ error: null }) },
      }
    },
  },
}))

const wrap = (node: ReactNode) => render(
  <MantineProvider theme={theme}><QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{node}</QueryClientProvider></MantineProvider>,
)

beforeEach(() => { db.settings = null; db.history = []; db.upserts = [] })

describe('daysPhrase', () => {
  it('reads naturally in Hebrew', () => {
    expect(R.daysPhrase([1, 7])).toBe('7 ימים ויום')
    expect(R.daysPhrase([14, 7])).toBe('14 ימים ו-7 ימים')
    expect(R.daysPhrase([30, 2, 1])).toBe('30 ימים, יומיים ויום')
    expect(R.daysPhrase([3])).toBe('3 ימים')
  })
})

describe('ReminderLine', () => {
  it('defaults (no row): "תזכורת במייל תישלח 7 ימים ויום לפני"', async () => {
    wrap(<ReminderLine />)
    expect(await screen.findByText('תזכורת במייל תישלח 7 ימים ויום לפני')).toBeTruthy()
  })
  it('nothing while reminders are off', async () => {
    db.settings = { enabled: false, days_before: [7, 1], include_overdue: true }
    wrap(<><ReminderLine /><ReminderSettingsCard /></>)
    await screen.findByRole('button', { name: R.save })
    expect(screen.queryByText(/תזכורת במייל תישלח/)).toBeNull()
  })
})

describe('ReminderSettingsCard', () => {
  it('on by default with 7 and 1 days; saves the chosen days, largest first', async () => {
    wrap(<ReminderSettingsCard />)
    const week = await screen.findByRole('button', { name: R.dayToggle('7 ימים') })
    expect(week.getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByRole('button', { name: R.dayToggle('יום') }).getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByRole('button', { name: R.dayToggle('3 ימים') }).getAttribute('aria-pressed')).toBe('false')
    fireEvent.click(screen.getByRole('button', { name: R.dayToggle('3 ימים') }))
    fireEvent.click(screen.getByRole('button', { name: R.dayToggle('יום') }))
    fireEvent.click(screen.getByLabelText(R.includeOverdue))
    fireEvent.click(screen.getByRole('button', { name: R.save }))
    await waitFor(() => expect(db.upserts).toHaveLength(1))
    expect(db.upserts[0]).toMatchObject({ building_id: 'b1', enabled: true, days_before: [7, 3], include_overdue: false })
  })
  it('shows the history: title, offset, dates, and dry runs marked', async () => {
    db.history = [
      { id: 'l1', item_kind: 'task', title: 'בדיקת מז"חים שנתית', due_on: '2026-11-03', offset_days: -1, sent_on: '2026-11-04', dry_run: false },
      { id: 'l2', item_kind: 'contract', title: 'שירות מעלית', due_on: '2026-11-11', offset_days: 7, sent_on: '2026-11-04', dry_run: true },
    ]
    wrap(<ReminderSettingsCard />)
    expect(await screen.findByText('בדיקת מז"חים שנתית')).toBeTruthy()
    expect(screen.getByText('נשלח 04/11/2026 · באיחור · מועד 03/11/2026')).toBeTruthy()
    expect(screen.getByText(`${R.contract}: שירות מעלית`)).toBeTruthy()
    expect(screen.getByText(R.dryRun)).toBeTruthy()
  })
  it('an empty history says so', async () => {
    wrap(<ReminderSettingsCard />)
    expect(await screen.findByText(R.historyEmpty)).toBeTruthy()
  })
})
