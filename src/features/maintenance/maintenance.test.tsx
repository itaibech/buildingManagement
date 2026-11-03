// @vitest-environment jsdom
import { MemoryRouter } from 'react-router'
import { MantineProvider } from '@mantine/core'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { he } from '../../lib/he'
import { theme } from '../../ui/theme'
import { DoneForm } from './DoneForm'
import MaintenancePage from './MaintenancePage'
import { supplierFields, useMarkDone, useSaveTask, type Task } from './api'

const db = vi.hoisted(() => ({
  rpcs: [] as unknown[], tasks: [] as unknown[], admin: true, rpcError: null as { message: string } | null,
  uploads: [] as string[], removed: [] as string[], inserts: [] as { table: string; row: unknown }[], logError: null as { message: string } | null,
}))
const CATEGORIES = [{ id: 'c1', name: 'ניקיון', sort_order: 2 }, { id: 'c2', name: 'מעלית', sort_order: 9 }]
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }))

vi.mock('../../lib/supabase', () => ({
  supabase: {
    rpc: (fn: string, args: unknown) => { db.rpcs.push({ fn, args }); return Promise.resolve({ error: db.rpcError }) },
    from: (table: string) => {
      const rows = { data: table === 'maintenance_tasks' ? db.tasks : table === 'expense_categories' ? CATEGORIES : [], error: null }
      const select = { order: () => select, eq: () => select, then: (r: (v: typeof rows) => unknown) => Promise.resolve(rows).then(r) }
      const insert = (row: unknown) => {
        db.inserts.push({ table, row })
        const result = { data: { id: 'new-task' }, error: table === 'maintenance_log' ? db.logError : null }
        return { select: () => ({ single: () => Promise.resolve(result) }), then: (r: (v: typeof result) => unknown) => Promise.resolve(result).then(r) }
      }
      return { select: () => select, insert }
    },
    storage: {
      from: () => ({
        upload: (path: string) => { db.uploads.push(path); return Promise.resolve({ error: null }) },
        remove: (paths: string[]) => { db.removed.push(...paths); return Promise.resolve({ error: null }) },
      }),
    },
  },
}))
vi.mock('../../auth/AuthProvider', () => ({ useAuth: () => ({ isAdmin: db.admin, session: { user: { id: 'me' } } }) }))
vi.mock('../../ui/notify', () => ({ notifySuccess: toast.success, notifyError: toast.error }))
vi.mock('../../ui', async (orig) => ({ ...(await orig<typeof import('../../ui')>()), notifySuccess: toast.success }))

const wrap = (node: React.ReactNode) =>
  render(<MantineProvider theme={theme}><QueryClientProvider client={new QueryClient()}><MemoryRouter>{node}</MemoryRouter></QueryClientProvider></MantineProvider>)

const task = (o: Partial<Task> = {}): Task => ({
  id: 't1', building_id: 'b', title: 'בדיקת מעלית', vendor: 'ספק', frequency: 'yearly', next_due: '2020-01-01', created_at: '2020-01-01T00:00:00Z', remind_days: 30, supplier_id: null, ...o,
})

beforeEach(() => {
  db.rpcs = []; db.tasks = []; db.admin = true; db.rpcError = null; db.uploads = []; db.removed = []; db.inserts = []; db.logError = null
  toast.success.mockClear(); toast.error.mockClear()
})

const hookWrapper = ({ children }: { children: React.ReactNode }) => <QueryClientProvider client={new QueryClient()}>{children}</QueryClientProvider>

describe('completion and save follow-ups', () => {
  it('passes the uploaded report to the RPC, so the log row and its report are written in one call', async () => {
    const { result } = renderHook(() => useMarkDone(), { wrapper: hookWrapper })
    const report = new File(['x'], 'דוח.pdf', { type: 'application/pdf' })
    await act(() => result.current.mutateAsync({ task: task(), doneOn: '2026-11-03', note: '', cost: null, categoryId: null, report }))
    expect(db.uploads).toHaveLength(1)
    expect(db.uploads[0]).toMatch(/^t1\/[0-9a-f-]{36}\.pdf$/)
    expect(db.rpcs[0]).toMatchObject({ fn: 'mark_task_done', args: { p_report_path: db.uploads[0], p_report_name: 'דוח.pdf' } })
  })

  it('removes the upload when the RPC fails (a retry starts clean)', async () => {
    db.rpcError = { message: 'boom' }
    const { result } = renderHook(() => useMarkDone(), { wrapper: hookWrapper })
    const report = new File(['x'], 'r.pdf', { type: 'application/pdf' })
    await act(() => result.current.mutateAsync({ task: task(), doneOn: '2026-11-03', note: '', cost: null, categoryId: null, report }).catch(() => undefined))
    expect(db.removed).toEqual(db.uploads)
  })

  it('a new task saves even when its "last done" history entry fails: warns instead of throwing', async () => {
    db.logError = { message: 'nope' }
    const { result } = renderHook(() => useSaveTask(), { wrapper: hookWrapper })
    await act(() => result.current.mutateAsync({ title: 'חדש', vendor: '', frequency: 'monthly', next_due: '2026-12-01', supplier_id: null, remind_days: 7, lastDone: '2026-11-01' }))
    expect(db.inserts.map((i) => i.table)).toEqual(['maintenance_tasks', 'maintenance_log'])
    expect(toast.error).toHaveBeenCalledWith(he.maintenance.lastDoneFailed)
  })

  it('supplierFields keeps the picked supplier while the list is missing and never copies a draft name', () => {
    expect(supplierFields({ supplier_id: 's1', vendor: 'ישן' }, undefined)).toEqual({ supplier_id: 's1', vendor: 'ישן' })
    expect(supplierFields({ supplier_id: 's1', vendor: '' }, [{ id: 's1', name: 'חברת מעליות', is_draft: true }])).toEqual({ supplier_id: 's1', vendor: '' })
    expect(supplierFields({ supplier_id: 's1', vendor: '' }, [{ id: 's1', name: 'מעליות הצפון', is_draft: false }])).toEqual({ supplier_id: 's1', vendor: 'מעליות הצפון' })
    expect(supplierFields({ supplier_id: 'gone', vendor: 'x' }, [])).toEqual({ supplier_id: null, vendor: 'x' })
  })
})

describe('DoneForm', () => {
  it('logs the completion, moves next_due forward and toasts', async () => {
    const onDone = vi.fn()
    wrap(<DoneForm task={task()} onDone={onDone} />)
    fireEvent.change(screen.getByLabelText(new RegExp(he.maintenance.doneOn)), { target: { value: '2026-03-15' } })
    fireEvent.change(screen.getByLabelText(he.maintenance.note), { target: { value: 'הכול תקין' } })
    expect(screen.getByText(he.maintenance.nextDuePreview('15/03/2027'))).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: he.maintenance.markDone }))
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith(he.maintenance.markedDone))
    expect(db.rpcs).toEqual([{ fn: 'mark_task_done', args: { p_task_id: 't1', p_done_on: '2026-03-15', p_note: 'הכול תקין' } }])
    expect(onDone).toHaveBeenCalled()
  })

  it('posts the cost as an expense in the chosen category', async () => {
    wrap(<DoneForm task={task()} onDone={vi.fn()} />)
    fireEvent.change(screen.getByLabelText(he.maintenance.cost), { target: { value: '250' } })
    fireEvent.click(screen.getAllByLabelText(new RegExp(he.maintenance.category))[0])
    fireEvent.click(await screen.findByRole('option', { name: 'מעלית', hidden: true }))
    fireEvent.click(screen.getByRole('button', { name: he.maintenance.markDone }))
    await waitFor(() => expect(db.rpcs).toHaveLength(1))
    expect(db.rpcs[0]).toMatchObject({ args: { p_cost: 250, p_category_id: 'c2' } })
  })

  it('requires a category when a cost is entered', async () => {
    wrap(<DoneForm task={task()} onDone={vi.fn()} />)
    fireEvent.change(screen.getByLabelText(he.maintenance.cost), { target: { value: '80' } })
    fireEvent.click(screen.getByRole('button', { name: he.maintenance.markDone }))
    expect(await screen.findByText(he.maintenance.errors.category)).toBeInTheDocument()
    expect(db.rpcs).toEqual([])
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
