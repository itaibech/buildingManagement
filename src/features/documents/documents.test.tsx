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
  admin: false, rows: [] as unknown[], signed: [] as string[][], removed: [] as string[][], deleted: [] as string[],
}))
vi.mock('../../lib/supabase', () => {
  const select = { order: async () => ({ data: db.rows, error: null }) }
  const bucket = {
    createSignedUrls: async (paths: string[]) => {
      db.signed.push(paths)
      return { data: paths.map((path) => ({ path, signedUrl: `https://x.test/${path}?token=t` })), error: null }
    },
    remove: async (paths: string[]) => { db.removed.push(paths); return { data: paths.map((name) => ({ name })), error: null } },
  }
  return {
    supabase: {
      from: () => ({ select: () => select, delete: () => ({ eq: async (_c: string, id: string) => { db.deleted.push(id); return { error: null } } }) }),
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
  <MantineProvider theme={theme}><QueryClientProvider client={new QueryClient()}><MemoryRouter><DocumentsPage /></MemoryRouter></QueryClientProvider></MantineProvider>,
)

beforeEach(() => {
  db.admin = false
  db.signed = []
  db.removed = []
  db.deleted = []
  db.rows = [
    row('d1', 'פוליסת ביטוח מבנה', 'insurance', { expires_on: inDays(10),
      building_document_versions: [version('old', 'd1', '2025-01-01T00:00:00Z'), version('new', 'd1', '2026-01-01T00:00:00Z')] }),
    row('d2', 'תקנון הבית המשותף', 'legal'),
  ]
})

describe('DocumentsPage', () => {
  it('groups by category, badges expiring documents, signs every file in one call and downloads the current version', async () => {
    wrap()
    const insurance = await screen.findByRole('region', { name: T.categories.insurance })
    expect(screen.getByRole('region', { name: T.categories.legal })).toBeInTheDocument()
    expect(within(insurance).getByText(T.expiry.soon)).toBeInTheDocument()
    expect(db.signed).toHaveLength(1)
    expect(db.signed[0]).toHaveLength(3)
    expect(within(insurance).getByRole('link', { name: T.downloadLabel('new.pdf') })).toHaveAttribute('href', expect.stringContaining('d1/new.pdf'))
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

  it('admins delete after confirming: every version\'s file, then the document', async () => {
    db.admin = true
    wrap()
    fireEvent.click(await screen.findByRole('button', { name: T.actions('פוליסת ביטוח מבנה') }))
    fireEvent.click(await screen.findByRole('menuitem', { name: T.delete }))
    const dialog = await screen.findByRole('dialog', { name: T.deleteConfirm('פוליסת ביטוח מבנה') })
    fireEvent.click(within(dialog).getByRole('button', { name: T.delete }))
    await waitFor(() => expect(db.deleted).toEqual(['d1']))
    expect(db.removed).toEqual([['d1/new.pdf', 'd1/old.pdf']])
  })
})
