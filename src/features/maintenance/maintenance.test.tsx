// @vitest-environment jsdom
import { MantineProvider } from '@mantine/core'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { he } from '../../lib/he'
import { theme } from '../../ui/theme'
import { DoneForm } from './DoneForm'
import MaintenancePage from './MaintenancePage'
import type { Task } from './api'

const db = vi.hoisted(() => ({ inserts: [] as unknown[], updates: [] as unknown[], tasks: [] as unknown[], admin: true }))
const toast = vi.hoisted(() => ({ success: vi.fn() }))

vi.mock('../../lib/supabase', () => ({
  supabase: {
    from: (table: string) => {
      const rows = { data: table === 'maintenance_tasks' ? db.tasks : [], error: null }
      const select = { order: () => select, eq: () => select, then: (r: (v: typeof rows) => unknown) => Promise.resolve(rows).then(r) }
      return {
        select: () => select,
        insert: (v: unknown) => { db.inserts.push({ table, v }); return Promise.resolve({ error: null }) },
        update: (v: unknown) => ({ eq: () => { db.updates.push({ table, v }); return Promise.resolve({ error: null }) } }),
      }
    },
  },
}))
vi.mock('../../auth/AuthProvider', () => ({ useAuth: () => ({ isAdmin: db.admin, session: { user: { id: 'me' } } }) }))
vi.mock('../../ui', async (orig) => ({ ...(await orig<typeof import('../../ui')>()), notifySuccess: toast.success }))

const wrap = (node: React.ReactNode) =>
  render(<MantineProvider theme={theme}><QueryClientProvider client={new QueryClient()}>{node}</QueryClientProvider></MantineProvider>)

const task = (o: Partial<Task> = {}): Task => ({
  id: 't1', building_id: 'b', title: 'בדיקת מעלית', vendor: 'ספק', frequency: 'yearly', next_due: '2020-01-01', created_at: '2020-01-01T00:00:00Z', ...o,
})

beforeEach(() => { db.inserts = []; db.updates = []; db.tasks = []; db.admin = true; toast.success.mockClear() })

describe('DoneForm', () => {
  it('logs the completion, moves next_due forward and toasts', async () => {
    const onDone = vi.fn()
    wrap(<DoneForm task={task()} onDone={onDone} />)
    fireEvent.change(screen.getByLabelText(new RegExp(he.maintenance.doneOn)), { target: { value: '2026-03-15' } })
    fireEvent.change(screen.getByLabelText(he.maintenance.note), { target: { value: 'הכול תקין' } })
    expect(screen.queryByText(/עלות/)).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: he.maintenance.markDone }))
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith(he.maintenance.markedDone))
    expect(db.inserts).toEqual([{ table: 'maintenance_log', v: { task_id: 't1', done_on: '2026-03-15', note: 'הכול תקין', cost: null } }])
    expect(db.updates).toEqual([{ table: 'maintenance_tasks', v: { next_due: '2027-03-15' } }])
    expect(onDone).toHaveBeenCalled()
  })
})

describe('MaintenancePage', () => {
  it('groups tasks by bucket and shows admin controls only to admins', async () => {
    db.tasks = [task({ id: 'a', title: 'ישנה' }), task({ id: 'b2', title: 'ללא תאריך', next_due: null })]
    wrap(<MaintenancePage />)
    expect(await screen.findByRole('heading', { name: he.dueStatus.overdue })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: he.dueStatus.none })).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: he.maintenance.markDone })).toHaveLength(2)
  })

  it('is read-only for residents', async () => {
    db.admin = false
    db.tasks = [task()]
    wrap(<MaintenancePage />)
    await screen.findByText('בדיקת מעלית')
    expect(screen.queryByRole('button', { name: he.maintenance.markDone })).toBeNull()
    expect(screen.queryByRole('button', { name: he.maintenance.add })).toBeNull()
  })
})
