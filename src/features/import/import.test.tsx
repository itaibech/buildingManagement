// @vitest-environment jsdom
import { MantineProvider } from '@mantine/core'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as XLSX from 'xlsx'
import { he } from '../../lib/he'
import { theme } from '../../ui/theme'
import type { ImportPayload } from './buildImport'
import { budgetFixture, expensesFixture, incomeFixture } from './fixture'
import ImportPage from './ImportPage'
import { ImportError } from './parseWorkbook'
import { readWorkbook, SHEETS } from './readWorkbook'

const db = vi.hoisted(() => ({ rpcCalls: [] as { fn: string; args: unknown }[], categories: [] as unknown[] }))
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }))

vi.mock('../../lib/supabase', () => {
  const chain = (): Record<string, unknown> => {
    const c: Record<string, unknown> = {}
    c.select = () => c
    c.order = () => c
    c.then = (resolve: (v: unknown) => unknown) => Promise.resolve({ data: db.categories, error: null }).then(resolve)
    return c
  }
  return {
    supabase: {
      from: () => chain(),
      rpc: (fn: string, args: unknown) => {
        db.rpcCalls.push({ fn, args })
        return Promise.resolve({ data: { apartments: 3, residents: 4, payments: 30, expenses: 8 }, error: null })
      },
    },
  }
})
vi.mock('../../ui', async (orig) => ({ ...(await orig<typeof import('../../ui')>()), notifySuccess: toast.success, notifyError: toast.error }))

function workbook(sheets: Record<string, unknown[][]>): ArrayBuffer {
  const wb = XLSX.utils.book_new()
  for (const [name, rows] of Object.entries(sheets)) XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), name)
  const out: ArrayBuffer = XLSX.write(wb, { type: 'array', bookType: 'xlsx' })
  return out
}
const FULL = { [SHEETS.income]: incomeFixture, [SHEETS.expenses]: expensesFixture, גיליון1: [], [SHEETS.budget]: budgetFixture }

beforeEach(() => {
  // jsdom has no scrollIntoView; Mantine's searchable Select calls it on the selected option.
  Element.prototype.scrollIntoView ??= () => undefined
  db.rpcCalls = []
  db.categories = [{ id: 'c1', name: 'חברת ניהול' }, { id: 'c2', name: 'ניקיון' }, { id: 'c3', name: 'בנק' }]
  toast.success.mockClear()
  toast.error.mockClear()
})

describe('readWorkbook', () => {
  it('reads the three sheets by name from real xlsx bytes', async () => {
    const { parsed, warnings } = await readWorkbook(workbook(FULL))
    expect(parsed.income.year).toBe(2026)
    expect(parsed.income.apartments.map((a) => a.number)).toEqual([1, 2, 3, 2])
    expect(parsed.expenses).toHaveLength(3)
    expect(parsed.budget.year).toBe(2025)
    expect(warnings.length).toBeGreaterThan(0)
  })

  it('refuses a workbook without the income sheet, and oversized files', async () => {
    await expect(readWorkbook(workbook({ אחר: [['x']] }))).rejects.toThrow(he.import.errors.noIncome)
    await expect(readWorkbook(new ArrayBuffer(6 * 1024 * 1024))).rejects.toBeInstanceOf(ImportError)
  })
})

const pick = async (label: string, option: string): Promise<void> => {
  const field = screen.getByLabelText(label)
  fireEvent.click(field)
  const listbox = await waitFor(() => {
    const el = document.getElementById(field.getAttribute('aria-controls') ?? '')
    if (!el) throw new Error('listbox not open')
    return el
  })
  fireEvent.click(within(listbox).getByRole('option', { name: option, hidden: true }))
}
const next = (): boolean => fireEvent.click(screen.getByRole('button', { name: he.import.next }))

describe('ImportPage', () => {
  it('walks upload → columns → fees → categories → preview → done and sends the confirmed payload', async () => {
    const { container } = render(
      <MantineProvider theme={theme}>
        <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
          <MemoryRouter><ImportPage /></MemoryRouter>
        </QueryClientProvider>
      </MantineProvider>,
    )
    const input = container.querySelector('input[type="file"]')
    if (!input) throw new Error('no file input')
    fireEvent.change(input, { target: { files: [new File([workbook(FULL)], 'book.xlsx')] } })

    expect(await screen.findByText(he.import.columnsIntro)).toBeInTheDocument()
    expect(screen.getByText(he.import.duplicate)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: he.import.next })).toBeDisabled()
    await pick(he.import.monthFor('אוקטובר'), 'אוקטובר')
    next()

    expect(await screen.findByText(he.import.feesIntro)).toBeInTheDocument()
    expect(screen.getAllByRole('textbox', { name: he.import.feeAmount }).map((i) => (i as HTMLInputElement).value)).toEqual(['₪390', '₪330'])
    next()

    await pick(he.import.categoryFor('ניקיון חברה א'), 'ניקיון')
    next()

    expect(await screen.findByText(he.import.replaceNote(2026))).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: he.import.confirm }))

    expect(await screen.findByText(he.import.doneTitle)).toBeInTheDocument()
    expect(toast.success).toHaveBeenCalledWith(he.toast.imported)
    expect(db.rpcCalls).toHaveLength(1)
    const { payload } = db.rpcCalls[0].args as { payload: ImportPayload }
    expect(payload.year).toBe(2026)
    expect(payload.charges.filter((c) => c.kind === 'levy').map((c) => c.month)).toEqual(['2026-10-01', '2026-10-01', '2026-10-01'])
    expect(payload.expenses.filter((e) => e.category === 'ניקיון')).toHaveLength(2)
    expect(payload.categories).not.toContain('ניקיון חברה א')
  })
})
