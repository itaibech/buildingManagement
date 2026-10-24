// @vitest-environment jsdom
import { MantineProvider } from '@mantine/core'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { configure, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { he } from '../../lib/he'
import { theme } from '../../ui/theme'
import type { Apartment, DirectoryEntry } from './api'
import DirectoryPage from './DirectoryPage'
import { directoryRows, type DirectoryGroup } from './directoryExport'

// The print-only table repeats every name; keep it out of text queries.
configure({ defaultIgnore: 'script, style, .bm-print, .bm-print *' })

const apt = (id: string, number: number, floor: number, is_committee = false): Apartment =>
  ({ id, number, floor, is_committee, notes: null, building_id: 'b', created_at: '' })
const res = (id: string, apartment_id: string, apartmentNumber: number, full_name: string, phone: string | null, is_owner = true): DirectoryEntry =>
  ({ id, apartment_id, apartmentNumber, full_name, phone, email: `${id}@example.test`, is_owner, building_id: 'b', created_at: '' })

const apartments = [apt('a1', 1, 0, true), apt('a2', 2, 1), apt('a3', 3, 1)]
const groups: DirectoryGroup[] = [
  { apartmentId: 'a3', number: 3, entries: [] },
  { apartmentId: 'a1', number: 1, entries: [res('r2', 'a1', 1, 'תמר', null, false), res('r1', 'a1', 1, 'אבי', '0501234567')] },
]

describe('directoryRows', () => {
  const rows = directoryRows(groups, apartments)

  it('has the seven columns', () => {
    expect(rows[0]).toEqual([he.export.headers.apartment, he.export.headers.floor, he.export.headers.name, he.export.headers.phone,
      he.export.headers.email, he.tenants.directoryExport.ownerOrTenant, he.export.headers.committee])
  })

  it('sorts by apartment then name, with an empty-name row for an empty apartment', () => {
    expect(rows.slice(1).map((r) => [r[0], r[2]])).toEqual([[1, 'אבי'], [1, 'תמר'], [3, '']])
  })

  it('keeps the phone a string and the apartment a number', () => {
    expect(rows[1]?.[3]).toBe('0501234567')
    expect(typeof rows[1]?.[0]).toBe('number')
    expect(rows[2]?.[3]).toBe('')
  })

  it('fills owner/tenant and committee', () => {
    expect(rows[1]?.slice(5)).toEqual([he.tenants.owner, he.export.yes])
    expect(rows[2]?.slice(5)).toEqual([he.tenants.tenant, he.export.yes])
    expect(rows[3]?.slice(1)).toEqual([1, '', '', '', '', ''])
  })
})

const auth = vi.hoisted(() => ({ isAdmin: true }))
const xlsx = vi.hoisted(() => vi.fn(() => Promise.resolve()))
vi.mock('../../auth/AuthProvider', () => ({ useAuth: () => ({ isAdmin: auth.isAdmin }) }))
vi.mock('../export/exportXlsx', () => ({ exportXlsx: xlsx }))
vi.mock('../../lib/supabase', () => {
  const data: Record<string, unknown[]> = {
    apartments: [{ id: 'a1', number: 1, floor: 1 }, { id: 'a2', number: 2, floor: 2 }],
    residents: [
      { id: 'r1', apartment_id: 'a1', full_name: 'דנה בדיקה', phone: '050-0000001', email: 'dana@example.test', is_owner: true },
      { id: 'r2', apartment_id: 'a2', full_name: 'יוסי לדוגמה', phone: '050-0000002', is_owner: false },
    ],
  }
  return {
    supabase: {
      from: (table: string) => {
        const q = {
          select: () => q, order: () => q, limit: () => q,
          then: (resolve: (r: { data: unknown; error: null }) => unknown) => Promise.resolve(resolve({ data: data[table] ?? [], error: null })),
        }
        return q
      },
    },
  }
})

type Sheets = Record<string, unknown[][]>
const sheetOf = (call: unknown[] | undefined): unknown[][] => ((call as [string, Sheets])[1])[he.nav.directory] ?? []

function renderPage() {
  return render(
    <MantineProvider theme={theme}>
      <QueryClientProvider client={new QueryClient()}>
        <DirectoryPage />
      </QueryClientProvider>
    </MantineProvider>,
  )
}

const openMenu = () => fireEvent.click(screen.getAllByText(he.export.short)[0] as HTMLElement)

describe('directory export menu', () => {
  beforeEach(() => { auth.isAdmin = true; xlsx.mockClear() })
  afterEach(() => { document.title = 'orig' })

  it('is hidden for non-admins', async () => {
    auth.isAdmin = false
    renderPage()
    await screen.findByText('דנה בדיקה')
    expect(screen.queryByText(he.export.short)).toBeNull()
    expect(screen.queryByTestId('directory-print')).toBeNull()
  })

  it('print calls window.print with the title set, then restores it', async () => {
    document.title = 'orig'
    let during = ''
    const print = vi.fn(() => { during = document.title })
    window.print = print
    renderPage()
    await screen.findByText('דנה בדיקה')
    openMenu()
    fireEvent.click(await screen.findByText(he.tenants.directoryExport.print))
    expect(print).toHaveBeenCalledOnce()
    expect(during).toMatch(new RegExp(`^${he.nav.directory}-\\d{4}-\\d{2}-\\d{2}$`))
    expect(document.title).toBe('orig')
  })

  it('exports everything with no filter, only the filtered list with one', async () => {
    renderPage()
    await screen.findByText('דנה בדיקה')
    openMenu()
    fireEvent.click(await screen.findByRole('menuitem', { name: he.tenants.directoryExport.excel }))
    expect(sheetOf(xlsx.mock.calls[0]).slice(1).map((r) => r[2])).toEqual(['דנה בדיקה', 'יוסי לדוגמה'])

  })

  it('exports and prints only the filtered list when a search is typed', async () => {
    renderPage()
    await screen.findByText('דנה בדיקה')
    fireEvent.change(screen.getByLabelText(he.tenants.search), { target: { value: 'יוסי' } })
    openMenu()
    fireEvent.click(await screen.findByRole('menuitem', { name: he.tenants.directoryExport.excelFiltered(1) }))
    expect(sheetOf(xlsx.mock.calls[0]).slice(1).map((r) => r[2])).toEqual(['יוסי לדוגמה'])
    expect(screen.getByTestId('directory-print').textContent).not.toContain('דנה בדיקה')
  })
})

describe('resident email', () => {
  beforeEach(() => { auth.isAdmin = false })

  it('shows a mailto action with an LTR address, for non-admins too', async () => {
    renderPage()
    await screen.findByText('דנה בדיקה')
    const links = screen.getAllByRole('link', { name: he.tenants.emailAction('דנה בדיקה') })
    expect(links).toHaveLength(2) // desktop button + mobile icon
    for (const l of links) {
      expect(l).toHaveAttribute('href', 'mailto:dana@example.test')
      expect(l).toHaveAttribute('title', 'dana@example.test')
    }
    const bdis = screen.getAllByText('dana@example.test').map((e) => e.closest('bdi'))
    expect(bdis.length).toBeGreaterThanOrEqual(2) // desktop button text + small line under the name (mobile)
    expect(bdis.every((b) => b?.getAttribute('dir') === 'ltr')).toBe(true)
  })

  it('shows nothing when the resident has no email', async () => {
    renderPage()
    await screen.findByText('יוסי לדוגמה')
    expect(screen.queryByRole('link', { name: he.tenants.emailAction('יוסי לדוגמה') })).toBeNull()
  })
})
