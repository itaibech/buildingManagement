// @vitest-environment jsdom
import { MantineProvider } from '@mantine/core'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { todayISO } from '../../lib/dates'
import { he } from '../../lib/he'
import { theme } from '../../ui/theme'
import DocumentsPage from './DocumentsPage'

const T = he.documents
const db = vi.hoisted(() => ({
  admin: false, rows: [] as unknown[], listError: null as { message: string } | null, calls: [] as unknown[][],
}))
vi.mock('../../lib/supabase', () => {
  const select = { order: () => select, range: async () => ({ data: db.listError ? null : db.rows, error: db.listError }) }
  const bucket = {
    createSignedUrls: async (paths: string[]) => { db.calls.push(['signMany', paths]); return { data: [], error: null } },
    createSignedUrl: async (path: string, ttl: number, o: unknown) => {
      db.calls.push(['sign', path, ttl, o])
      return { data: { signedUrl: `http://localhost/#signed` }, error: null }
    },
    remove: async (paths: string[]) => { db.calls.push(['remove', paths]); return { data: paths.map((name) => ({ name })), error: null } },
  }
  return {
    supabase: {
      from: () => ({ select: () => select, delete: () => ({ eq: async (_c: string, id: string) => { db.calls.push(['deleteRow', id]); return { error: null } } }) }),
      storage: { from: () => bucket },
    },
  }
})
vi.mock('../../auth/AuthProvider', () => ({ useAuth: () => ({ isAdmin: db.admin }) }))

const inDays = (n: number): string => todayISO(new Date(Date.now() + n * 86_400_000))
const version = (id: string, doc: string, at: string) => ({ id, file_path: `${doc}/${id}.pdf`, file_name: `${id}.pdf`, size_bytes: 2048, created_at: at })
const row = (id: string, title: string, category: string, o: Record<string, unknown> = {}) => ({
  id, title, category, building_id: 'b', description: '', document_date: null, expires_on: null, visibility: 'residents',
  created_by: null, created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z',
  building_document_versions: [version(`${id}v1`, id, '2026-01-01T00:00:00Z')], ...o,
})

const wrap = () => render(
  <MantineProvider theme={theme}><QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><MemoryRouter><DocumentsPage /></MemoryRouter></QueryClientProvider></MantineProvider>,
)

beforeEach(() => {
  db.admin = false
  db.listError = null
  db.calls = []
  db.rows = [
    row('d1', 'פוליסת ביטוח מבנה', 'insurance', { expires_on: inDays(10),
      building_document_versions: [version('old', 'd1', '2025-01-01T00:00:00Z'), version('new', 'd1', '2026-01-01T00:00:00Z')] }),
    row('d2', 'תקנון הבית המשותף', 'legal'),
  ]
})

describe('DocumentsPage', () => {
  it('groups by category and badges expiring documents, without signing any file', async () => {
    wrap()
    const insurance = await screen.findByRole('region', { name: T.categories.insurance })
    expect(screen.getByRole('region', { name: T.categories.legal })).toBeInTheDocument()
    expect(within(insurance).getByText(T.expiry.soon)).toBeInTheDocument()
    expect(db.calls).toEqual([])
  })

  it('signs only the clicked file, for 60 seconds, under its own name: the current version, or one from the history', async () => {
    wrap()
    const insurance = await screen.findByRole('region', { name: T.categories.insurance })
    fireEvent.click(within(insurance).getByRole('button', { name: T.downloadLabel('new.pdf') }))
    await waitFor(() => expect(db.calls).toEqual([['sign', 'd1/new.pdf', 60, { download: 'new.pdf' }]]))
    fireEvent.click(within(insurance).getByRole('button', { name: T.versionsLabel('פוליסת ביטוח מבנה') }))
    const drawer = await screen.findByRole('dialog', { name: T.versionsTitle('פוליסת ביטוח מבנה') })
    expect(within(drawer).getByText(T.version(2))).toBeInTheDocument()
    fireEvent.click(within(drawer).getByRole('button', { name: T.downloadLabel('old.pdf') }))
    await waitFor(() => expect(db.calls).toHaveLength(2))
    expect(db.calls[1]).toEqual(['sign', 'd1/old.pdf', 60, { download: 'old.pdf' }])
  })

  it('a load error offers a retry', async () => {
    db.listError = { message: 'offline' }
    wrap()
    const retry = await screen.findByRole('button', { name: he.retry })
    db.listError = null
    fireEvent.click(retry)
    expect(await screen.findByText('תקנון הבית המשותף')).toBeInTheDocument()
  })

  it('residents only download: no upload button, no admin menu', async () => {
    wrap()
    await screen.findByText('תקנון הבית המשותף')
    expect(screen.queryByRole('button', { name: T.add })).toBeNull()
    expect(screen.queryByRole('button', { name: T.actions('תקנון הבית המשותף') })).toBeNull()
  })

  it('search filters by title', async () => {
    wrap()
    fireEvent.change(await screen.findByRole('searchbox', { name: T.search }), { target: { value: 'תקנון' } })
    expect(screen.queryByText('פוליסת ביטוח מבנה')).toBeNull()
    expect(screen.getByText('תקנון הבית המשותף')).toBeInTheDocument()
  })

  it('admins delete after confirming: the document first, then every version\'s file', async () => {
    db.admin = true
    wrap()
    fireEvent.click(await screen.findByRole('button', { name: T.actions('פוליסת ביטוח מבנה') }))
    fireEvent.click(await screen.findByRole('menuitem', { name: T.delete }))
    const dialog = await screen.findByRole('dialog', { name: T.deleteConfirm('פוליסת ביטוח מבנה') })
    fireEvent.click(within(dialog).getByRole('button', { name: T.delete }))
    await waitFor(() => expect(db.calls).toEqual([['deleteRow', 'd1'], ['remove', ['d1/new.pdf', 'd1/old.pdf']]]))
  })
})
