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

const db = vi.hoisted(() => ({
  rpcCalls: [] as { fn: string; args: unknown }[], tables: {} as Record<string, unknown[]>,
  /** Receipt paths import_year answers with, what storage was asked to remove, and whether it removes nothing. */
  rpcReceipts: [] as string[], removed: [] as string[][], removeNothing: false,
}))
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }))

vi.mock('../../lib/supabase', () => {
  const chain = (table: string): Record<string, unknown> => {
    const c: Record<string, unknown> = {}
    for (const op of ['select', 'order', 'eq', 'gte', 'lt']) c[op] = () => c
    c.then = (resolve: (v: unknown) => unknown) => Promise.resolve({ data: db.tables[table] ?? [], error: null }).then(resolve)
    return c
  }
  return {
    supabase: {
      from: (table: string) => chain(table),
      rpc: (fn: string, args: unknown) => {
        db.rpcCalls.push({ fn, args })
        return Promise.resolve({ data: { apartments: 3, residents: 4, payments: 30, expenses: 8, receipts: db.rpcReceipts }, error: null })
      },
      storage: {
        from: () => ({
          remove: (paths: string[]) => {
            db.removed.push(paths)
            return Promise.resolve({ data: db.removeNothing ? [] : paths.map((name) => ({ name })), error: null })
          },
        }),
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
  db.rpcReceipts = []
  db.removed = []
  db.removeNothing = false
  db.tables = { expense_categories: [{ id: 'c1', name: 'חברת ניהול' }, { id: 'c2', name: 'ניקיון' }, { id: 'c3', name: 'בנק' }] }
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

  it('stays bounded when a sheet claims a huge range', async () => {
    const zip = XLSX.CFB.read(new Uint8Array(workbook(FULL)), { type: 'array' })
    const entry = (zip.FileIndex as { name: string; content?: unknown }[]).find((f) => f.name === 'sheet1.xml')
    if (!entry?.content) throw new Error('no sheet1.xml')
    const xml = new TextDecoder().decode(entry.content as Uint8Array).replace(/<dimension ref="[^"]+"\/>/, '<dimension ref="A1:XFD1048576"/>')
    expect(xml).toContain('XFD1048576')
    entry.content = new TextEncoder().encode(xml)
    const huge: ArrayBuffer = XLSX.CFB.write(zip, { fileType: 'zip', type: 'array' })
    const started = Date.now()
    const { parsed } = await readWorkbook(huge)
    expect(Date.now() - started).toBeLessThan(3000)
    expect(parsed.income.apartments.map((a) => a.number)).toEqual([1, 2, 3, 2])
  }, 20000)

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

const renderPage = (): HTMLElement => render(
  <MantineProvider theme={theme}>
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter><ImportPage /></MemoryRouter>
    </QueryClientProvider>
  </MantineProvider>,
).container

async function upload(container: HTMLElement): Promise<void> {
  const input = container.querySelector('input[type="file"]')
  if (!input) throw new Error('no file input')
  fireEvent.change(input, { target: { files: [new File([workbook(FULL)], 'book.xlsx')] } })
  expect(await screen.findByText(he.import.columnsIntro)).toBeInTheDocument()
}
const feeValues = (): string[] => screen.getAllByRole('textbox', { name: he.import.feeAmount }).map((i) => (i as HTMLInputElement).value)
const sentPayload = (): ImportPayload => (db.rpcCalls[0].args as { payload: ImportPayload }).payload

describe('ImportPage', () => {
  it('walks upload → columns → fees → categories → preview → done and sends the confirmed payload', async () => {
    await upload(renderPage())
    expect(screen.getByText(he.import.duplicate)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: he.import.next })).toBeDisabled()
    await pick(he.import.monthFor('אוקטובר'), 'אוקטובר')
    next()

    expect(await screen.findByText(he.import.feesIntro)).toBeInTheDocument()
    expect(feeValues()).toEqual(['₪390', '₪330'])
    expect(screen.queryByText(he.import.existingFee)).not.toBeInTheDocument()
    next()

    await pick(he.import.categoryFor('ניקיון חברה א'), 'ניקיון')
    next()

    expect(await screen.findByText(he.import.replaceNote(2026))).toBeInTheDocument()
    expect(screen.getByText(he.import.levyNotice('‏500.00 ‏₪', 3, 'אוקטובר 2026'))).toBeInTheDocument()
    expect(screen.getByText(he.import.evNotice('3', '‏546.90 ‏₪'))).toBeInTheDocument()
    expect(screen.queryByText(he.import.replaceFees(2))).not.toBeInTheDocument()
    fireEvent.change(screen.getByLabelText(he.import.levyAmountFor('אוקטובר 2026')), { target: { value: '450' } })
    expect(await screen.findByText(he.import.levyNotice('‏450.00 ‏₪', 3, 'אוקטובר 2026'))).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: he.import.confirm }))

    expect(await screen.findByText(he.import.doneTitle)).toBeInTheDocument()
    expect(toast.success).toHaveBeenCalledWith(he.toast.imported)
    expect(db.rpcCalls).toHaveLength(1)
    const payload = sentPayload()
    expect(payload.year).toBe(2026)
    expect(payload.charges.filter((c) => c.kind === 'levy').map((c) => [c.month, c.amount])).toEqual([
      ['2026-10-01', 450], ['2026-10-01', 450], ['2026-10-01', 450],
    ])
    expect(payload.expenses.filter((e) => e.category === 'ניקיון')).toHaveLength(2)
    expect(payload.categories).not.toContain('ניקיון חברה א')
  })

  it('prefills the year\'s existing fees, warns about replacing fees and budgets, and skips overlapping expenses', async () => {
    db.tables.fee_schedule = [
      { id: 'f1', effective_from: '2026-01-01', amount: 400 }, { id: 'f2', effective_from: '2026-05-01', amount: 350 },
      { id: 'f0', effective_from: '2025-01-01', amount: 300 },
    ]
    db.tables.budgets = [{ id: 'b1', year: 2025, category_id: 'cx', amount: 1, expense_categories: { name: 'דמי ניהול', sort_order: 1 } }]
    db.tables.expenses = [{ id: 'e1', category_id: 'c1', spent_on: '2026-01-20', amount: 850, vendor: '', note: '', receipt_path: null,
      source: 'manual', template_id: null, expense_categories: { name: 'חברת ניהול' } }]
    await upload(renderPage())
    await pick(he.import.monthFor('אוקטובר'), 'אוקטובר')
    next()

    expect(await screen.findByText(he.import.feesFromSystem)).toBeInTheDocument()
    expect(feeValues()).toEqual(['₪400', '₪350'])
    expect(screen.getAllByText(he.import.existingFee)).toHaveLength(2)
    next()
    next()

    expect(await screen.findByText(he.import.replaceFees(2))).toBeInTheDocument()
    expect(screen.getByText(he.import.updateBudgets(1))).toBeInTheDocument()
    expect(screen.getByText(he.import.overlapTitle(1))).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: he.import.confirm }))
    await screen.findByText(he.import.doneTitle)
    const payload = sentPayload()
    expect(payload.fees).toEqual([{ amount: 400, effective_from: '2026-01-01' }, { amount: 350, effective_from: '2026-05-01' }])
    expect(payload.expenses.filter((e) => e.category === 'חברת ניהול').map((e) => e.spent_on)).toEqual(['2026-02-01', '2026-03-01'])
  })

  it('defaults the EV block to excluded when EV chargers exist, with a hint that the meter module handles EV', async () => {
    db.tables.ev_chargers = [{ id: 'ch1', apartment_id: 'a3', label: 'עמדת טעינה', initial_reading: 0, active: true, apartments: { number: 3 } }]
    await upload(renderPage())
    await pick(he.import.monthFor('אוקטובר'), 'אוקטובר')
    next()
    await screen.findByText(he.import.feesIntro)
    next()
    next()
    expect(await screen.findByText(he.import.evManaged)).toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: he.import.evInclude })).not.toBeChecked()
    expect(screen.getByText(/חיובי טעינה דולגו/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: he.import.confirm }))
    await screen.findByText(he.import.doneTitle)
    expect(sentPayload().charges.filter((c) => c.kind === 'extra')).toEqual([])
    expect(sentPayload().payments.some((p) => p.note === he.import.evNote)).toBe(true)
    expect(screen.getByText(/חיובי טעינה דולגו/)).toBeInTheDocument()
  })

  it('skips payments already recorded in the same apartment-month by default, and can import them anyway', async () => {
    db.tables.payments = [{ paid_on: '2026-01-15', amount: 100, source: 'manual', apartments: { number: 1 } }]
    await upload(renderPage())
    await pick(he.import.monthFor('אוקטובר'), 'אוקטובר')
    next()
    await screen.findByText(he.import.feesIntro)
    next()
    next()
    expect(await screen.findByText(he.import.paidTitle(1))).toBeInTheDocument()
    expect(screen.getByText(he.import.paidItem(1, 'ינואר 2026', '‏390.00 ‏₪', '‏100.00 ‏₪'))).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: he.import.confirm }))
    await screen.findByText(he.import.doneTitle)
    const jan = (p: ImportPayload): number[] => p.payments.filter((x) => x.apartment === 1 && x.paid_on === '2026-01-01').map((x) => x.amount)
    expect(jan(sentPayload())).toEqual([290])
    expect(sentPayload().keep_prior_levies).toBe(true)
  })

  it('never re-imports months already paid by standing order, and says so in the preview', async () => {
    db.tables.payments = [{ paid_on: '2026-01-01', amount: 390, source: 'auto', apartments: { number: 1 } }]
    await upload(renderPage())
    await pick(he.import.monthFor('אוקטובר'), 'אוקטובר')
    next()
    await screen.findByText(he.import.feesIntro)
    next()
    next()
    expect(await screen.findByText(he.import.autoSkipped(1))).toBeInTheDocument()
    expect(screen.queryByText(he.import.paidTitle(1))).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: he.import.confirm }))
    await screen.findByText(he.import.doneTitle)
    expect(sentPayload().payments.filter((x) => x.apartment === 1 && x.paid_on === '2026-01-01')).toEqual([])
  })

  it('warns in the preview when the year has debt settlements (a re-import may reopen them)', async () => {
    db.tables.charges = [{ month: '2026-02-01', kind: 'adjustment', source: 'manual', apartments: { number: 2 } }]
    db.tables.payments = [{ paid_on: '2026-10-24', amount: 390, source: 'manual', apartments: { number: 3 }, settlement_id: 's1' }]
    await upload(renderPage())
    await pick(he.import.monthFor('אוקטובר'), 'אוקטובר')
    next()
    await screen.findByText(he.import.feesIntro)
    next()
    next()
    expect(await screen.findByText(he.import.settledHint(2))).toBeInTheDocument()
  })

  it('no settlement hint for a year without settlements', async () => {
    db.tables.payments = [{ paid_on: '2026-01-15', amount: 100, source: 'manual', apartments: { number: 1 } }]
    await upload(renderPage())
    await pick(he.import.monthFor('אוקטובר'), 'אוקטובר')
    next()
    await screen.findByText(he.import.feesIntro)
    next()
    next()
    await screen.findByText(he.import.paidTitle(1))
    expect(screen.queryByText(he.import.settledHint(1))).toBeNull()
  })

  describe('receipts on previously imported expenses (Task 22)', () => {
    const imported = (id: string, receipt: string | null, source = 'import') =>
      ({ id, category_id: 'c1', spent_on: '2026-03-01', amount: 10, vendor: '', note: '', receipt_path: receipt, source, template_id: null, expense_categories: { name: 'בנק' } })
    async function toPreview(): Promise<void> {
      await upload(renderPage())
      await pick(he.import.monthFor('אוקטובר'), 'אוקטובר')
      next()
      await screen.findByText(he.import.feesIntro)
      next()
      next()
      await screen.findByText(he.import.replaceNote(2026))
    }

    it('warns before confirming that the imported expenses\' receipts will be deleted', async () => {
      db.tables.expenses = [imported('e1', 'e1/a.pdf'), imported('e2', 'e2/b.jpg'), imported('e3', null), imported('e4', 'e4/c.pdf', 'manual')]
      await toPreview()
      expect(screen.getByText(he.import.receiptsDeleted(2))).toBeInTheDocument()
      expect(he.import.receiptsDeleted(2)).toBe('2 קבלות יימחקו')
    })

    it('no receipt warning when no imported expense has one', async () => {
      db.tables.expenses = [imported('e3', null), imported('e4', 'e4/c.pdf', 'manual')]
      await toPreview()
      expect(screen.queryByText(he.import.receiptsDeleted(1))).toBeNull()
    })

    it('removes the deleted rows\' receipt files after a successful import', async () => {
      db.rpcReceipts = ['e1/a.pdf', 'e2/b.jpg']
      await toPreview()
      fireEvent.click(screen.getByRole('button', { name: he.import.confirm }))
      expect(await screen.findByText(he.import.doneTitle)).toBeInTheDocument()
      expect(db.removed).toEqual([['e1/a.pdf', 'e2/b.jpg']])
      expect(toast.error).not.toHaveBeenCalled()
    })

    it('tells the admin when the files stayed behind; no storage call when there are none', async () => {
      db.rpcReceipts = ['e1/a.pdf']
      db.removeNothing = true
      await toPreview()
      fireEvent.click(screen.getByRole('button', { name: he.import.confirm }))
      expect(await screen.findByText(he.import.doneTitle)).toBeInTheDocument()
      expect(toast.error).toHaveBeenCalledWith(he.finance.receiptRemoveFailed)
    })
  })
})
