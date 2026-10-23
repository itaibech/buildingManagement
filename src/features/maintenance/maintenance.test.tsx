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

const db = vi.hoisted(() => ({ rpcs: [] as unknown[], tasks: [] as unknown[], admin: true, rpcError: null as { message: string } | null }))
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }))

vi.mock('../../lib/supabase', () => ({
  supabase: {
    rpc: (fn: string, args: unknown) => { db.rpcs.push({ fn, args }); return Promise.resolve({ error: db.rpcError }) },
    from: (table: string) => {
      const rows = { data: table === 'maintenance_tasks' ? db.tasks : [], error: null }
      const select = { order: () => select, eq: () => select, then: (r: (v: typeof rows) => unknown) => Promise.resolve(rows).then(r) }
      return { select: () => select }
    },
  },
}))
vi.mock('../../auth/AuthProvider', () => ({ useAuth: () => ({ isAdmin: db.admin, session: { user: { id: 'me' } } }) }))
vi.mock('../../ui/notify', () => ({ notifySuccess: toast.success, notifyError: toast.error }))
vi.mock('../../ui', async (orig) => ({ ...(await orig<typeof import('../../ui')>()), notifySuccess: toast.success }))

const wrap = (node: React.ReactNode) =>
  render(<MantineProvider theme={theme}><QueryClientProvider client={new QueryClient()}>{node}</QueryClientProvider></MantineProvider>)

const task = (o: Partial<Task> = {}): Task => ({
  id: 't1', building_id: 'b', title: 'בדיקת מעלית', vendor: 'ספק', frequency: 'yearly', next_due: '2020-01-01', created_at: '2020-01-01T00:00:00Z', ...o,
})

beforeEach(() => { db.rpcs = []; db.tasks = []; db.admin = true; db.rpcError = null; toast.success.mockClear(); toast.error.mockClear() })

describe('DoneForm', () => {
  it('logs the completion, moves next_due forward and toasts', async () => {
    const onDone = vi.fn()
    wrap(<DoneForm task={task()} onDone={onDone} />)
    fireEvent.change(screen.getByLabelText(new RegExp(he.maintenance.doneOn)), { target: { value: '2026-03-15' } })
    fireEvent.change(screen.getByLabelText(he.maintenance.note), { target: { value: 'הכול תקין' } })
    expect(screen.queryByText(/עלות/)).toBeNull()
    expect(screen.getByText(he.maintenance.nextDuePreview('15/03/2027'))).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: he.maintenance.markDone }))
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith(he.maintenance.markedDone))
    expect(db.rpcs).toEqual([{ fn: 'mark_task_done', args: { p_task_id: 't1', p_done_on: '2026-03-15', p_note: 'הכול תקין' } }])
    expect(onDone).toHaveBeenCalled()
  })
})

describe('DoneForm failure', () => {
  it('shows the error toast and stays open when the RPC fails', async () => {
    db.rpcError = { message: 'boom' }
    const onDone = vi.fn()
    wrap(<DoneForm task={task()} onDone={onDone} />)
    fireEvent.click(screen.getByRole('button', { name: he.maintenance.markDone }))
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(he.toast.failed))
    expect(toast.success).not.toHaveBeenCalled()
    expect(onDone).not.toHaveBeenCalled()
  })
})

describe('MaintenancePage', () => {
  it('shows soon and later sections', async () => {
    const day = (n: number) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10)
    db.tasks = [task({ id: 's', title: 'קרובה', next_due: day(5) }), task({ id: 'l', title: 'רחוקה', next_due: day(100) })]
    wrap(<MaintenancePage />)
    expect(await screen.findByRole('heading', { name: he.dueStatus.soon })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: he.dueStatus.later })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: he.dueStatus.overdue })).toBeNull()
  })

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
