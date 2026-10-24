// @vitest-environment jsdom
import { MantineProvider } from '@mantine/core'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { todayISO } from '../../lib/dates'
import { HEBREW_MONTHS, he } from '../../lib/he'
import { theme } from '../../ui/theme'
import type { Expense } from './api'
import { expenseExportName } from '../export/buildWorkbook'
import { ExpenseExportDialog } from './ExpenseExport'
import { exportYears } from './ledger'
import { ExpensesTab } from './ExpensesTab'
import { ReceiptControl } from './ReceiptControl'

const db = vi.hoisted(() => ({
  tables: {} as Record<string, unknown[]>,
  /** Every write, in order: `upload:<path>`, `update:<json>`, `remove:<paths>`. */
  log: [] as string[],
  uploadError: null as { message: string } | null,
  coarse: false,
}))
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }))

function builder(table: string) {
  const chain: Record<string, unknown> = {}
  for (const op of ['select', 'eq', 'lt', 'gte', 'order', 'in', 'limit', 'delete', 'insert']) chain[op] = () => chain
  chain.update = (values: unknown) => { db.log.push(`update:${JSON.stringify(values)}`); return chain }
  chain.then = (resolve: (v: unknown) => unknown) => Promise.resolve({ data: db.tables[table] ?? [], error: null }).then(resolve)
  return chain
}

vi.mock('../../lib/supabase', () => ({
  supabase: {
    from: (table: string) => builder(table),
    rpc: () => Promise.resolve({ data: null, error: null }),
    storage: {
      from: () => ({
        upload: (path: string) => { db.log.push(`upload:${path}`); return Promise.resolve({ error: db.uploadError }) },
        remove: (paths: string[]) => { db.log.push(`remove:${paths.join(',')}`); return Promise.resolve({ error: null }) },
        createSignedUrl: () => Promise.resolve({ data: { signedUrl: 'https://signed.example.test/r' }, error: null }),
      }),
    },
  },
}))
vi.mock('../../auth/AuthProvider', () => ({ useAuth: () => ({ isAdmin: true, session: { user: { id: 'me' } }, can: () => true }) }))
vi.mock('../../ui/notify', () => ({ notifySuccess: toast.success, notifyError: toast.error }))
vi.mock('../../ui', async (orig) => ({ ...(await orig<typeof import('../../ui')>()), notifySuccess: toast.success, notifyError: toast.error }))
vi.mock('@mantine/hooks', async (orig) => ({
  ...(await orig<typeof import('@mantine/hooks')>()),
  useMediaQuery: (q: string) => (q.includes('pointer') ? db.coarse : false),
}))

const wrap = (node: ReactNode) => render(
  <MantineProvider theme={theme}>
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{node}</QueryClientProvider>
  </MantineProvider>,
)

const R = he.finance.receipts
const expense = (over: Partial<Expense> = {}): Expense => ({
  id: 'e1', category_id: 'c1', category: 'ניקיון', spent_on: '2026-10-05', amount: 100, vendor: 'ספק', note: '',
  receipt_path: null, receipt_name: null, source: 'manual', template_id: null, special_id: null, ...over,
})
const pdf = new File(['%PDF'], 'חשבונית.pdf', { type: 'application/pdf' })
const fileInput = (container: HTMLElement, camera = false): HTMLInputElement => {
  const input = container.querySelector<HTMLInputElement>(camera ? 'input[type=file][capture]' : 'input[type=file]:not([capture])')
  if (!input) throw new Error('no file input')
  return input
}
const pick = (input: HTMLInputElement, file: File) => fireEvent.change(input, { target: { files: [file] } })

// jsdom has no scrollIntoView; Mantine's Select scrolls the chosen option into view when it opens.
Element.prototype.scrollIntoView ??= () => undefined

beforeEach(() => {
  db.tables = {}
  db.log = []
  db.uploadError = null
  db.coarse = false
  toast.success.mockReset()
  toast.error.mockReset()
})

describe('ReceiptControl', () => {
  it('no receipt: a 44px paperclip "הוספת קבלה" that uploads, links and confirms', async () => {
    const { container } = wrap(<ReceiptControl expense={expense()} />)
    const add = screen.getByRole('button', { name: R.add })
    expect(add.style.getPropertyValue('--ai-size')).toContain('2.75rem')
    expect(fileInput(container).accept).toBe('image/*,application/pdf,.doc,.docx,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document')
    pick(fileInput(container), pdf)
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith(R.saved))
    expect(db.log[0]).toMatch(/^upload:e1\/[0-9a-f-]{36}\.pdf$/)
    expect(db.log[1]).toContain('"receipt_name":"חשבונית.pdf"')
    expect(db.log).toHaveLength(2)
  })

  it('refuses an unsupported or oversized file before uploading, in Hebrew', async () => {
    const { container } = wrap(<ReceiptControl expense={expense()} />)
    pick(fileInput(container), new File(['MZ'], 'setup.exe', { type: 'application/x-msdownload' }))
    expect(toast.error).toHaveBeenCalledWith('סוג קובץ לא נתמך')
    const big = new File(['x'], 'big.pdf', { type: 'application/pdf' })
    Object.defineProperty(big, 'size', { value: 11 * 1024 * 1024 })
    pick(fileInput(container), big)
    expect(toast.error).toHaveBeenCalledWith('הקובץ גדול מ-10MB')
    expect(db.log).toEqual([])
  })

  it('on a touch screen the paperclip offers the camera or a file', async () => {
    db.coarse = true
    const { container } = wrap(<ReceiptControl expense={expense()} />)
    fireEvent.click(screen.getByRole('button', { name: R.add }))
    expect(await screen.findByRole('menuitem', { name: R.takePhoto, hidden: true })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: R.pickFile, hidden: true })).toBeInTheDocument()
    expect(fileInput(container, true).getAttribute('capture')).toBe('environment')
    expect(fileInput(container, true).accept).toBe('image/*')
  })

  it('has a receipt: a "קבלה" chip with view, replace and remove', async () => {
    wrap(<ReceiptControl expense={expense({ receipt_path: 'e1/old.pdf', receipt_name: 'ישן.pdf' })} />)
    expect(screen.queryByRole('button', { name: R.add })).toBeNull()
    const chip = screen.getByRole('button', { name: R.actions('ישן.pdf') })
    expect(chip).toHaveTextContent(R.chip)
    fireEvent.click(chip)
    for (const item of [R.view, R.replace, R.remove]) expect(await screen.findByRole('menuitem', { name: item, hidden: true })).toBeInTheDocument()
  })

  it('view opens the signed URL in a new tab with no opener', async () => {
    const win = { opener: {}, location: { href: '' }, close: vi.fn() }
    const open = vi.spyOn(window, 'open').mockReturnValue(win as unknown as Window)
    wrap(<ReceiptControl expense={expense({ receipt_path: 'e1/old.pdf', receipt_name: 'ישן.pdf' })} />)
    fireEvent.click(screen.getByRole('button', { name: R.actions('ישן.pdf') }))
    fireEvent.click(await screen.findByRole('menuitem', { name: R.view, hidden: true }))
    expect(open).toHaveBeenCalledWith('', '_blank')
    expect(win.opener).toBeNull()
    await waitFor(() => expect(win.location.href).toBe('https://signed.example.test/r'))
    open.mockRestore()
  })

  it('replace uploads and links the new file first, then removes the old object', async () => {
    const { container } = wrap(<ReceiptControl expense={expense({ receipt_path: 'e1/old.pdf', receipt_name: 'ישן.pdf' })} />)
    pick(fileInput(container), new File(['img'], 'new.png', { type: 'image/png' }))
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith(R.saved))
    expect(db.log.map((l) => l.split(':')[0])).toEqual(['upload', 'update', 'remove'])
    expect(db.log[2]).toBe('remove:e1/old.pdf')
  })

  it('a failed replace keeps the old receipt', async () => {
    db.uploadError = { message: 'too big' }
    const { container } = wrap(<ReceiptControl expense={expense({ receipt_path: 'e1/old.pdf', receipt_name: 'ישן.pdf' })} />)
    pick(fileInput(container), pdf)
    await waitFor(() => expect(toast.error).toHaveBeenCalled())
    expect(db.log.some((l) => l.startsWith('remove') || l.startsWith('update'))).toBe(false)
  })

  it('remove asks for confirmation, then clears the link and deletes the object', async () => {
    wrap(<ReceiptControl expense={expense({ receipt_path: 'e1/old.pdf', receipt_name: 'ישן.pdf' })} />)
    fireEvent.click(screen.getByRole('button', { name: R.actions('ישן.pdf') }))
    fireEvent.click(await screen.findByRole('menuitem', { name: R.remove, hidden: true }))
    const dialog = await screen.findByRole('dialog', { name: R.removeConfirm })
    expect(db.log).toEqual([])
    fireEvent.click(within(dialog).getByRole('button', { name: R.remove }))
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith(R.removed))
    expect(db.log).toEqual(['update:{"receipt_path":null,"receipt_name":null}', 'remove:e1/old.pdf'])
  })
})

describe('expenses tab receipts', () => {
  it('each category header counts its receipts, imported rows included', async () => {
    const month = todayISO().slice(0, 8)
    db.tables.expenses = [
      { ...expense({ id: 'e1', spent_on: `${month}02`, receipt_path: 'e1/a.pdf' }), expense_categories: { name: 'ניקיון' } },
      { ...expense({ id: 'e2', spent_on: `${month}03`, source: 'import' }), expense_categories: { name: 'ניקיון' } },
      { ...expense({ id: 'e3', spent_on: `${month}04`, receipt_path: 'e3/b.pdf', source: 'import' }), expense_categories: { name: 'ניקיון' } },
    ]
    wrap(<ExpensesTab adding={false} onAdd={vi.fn()} onAddingClose={vi.fn()} />)
    expect(await screen.findByText(R.count(2, 3))).toBeInTheDocument()
    // The imported row without a receipt can get one too.
    expect(screen.getAllByRole('button', { name: R.add })).toHaveLength(1)
  })
})

describe('expense export dialog', () => {
  const selectIn = (root: HTMLElement, label: string): HTMLElement => {
    const el = within(root).getAllByLabelText(label).find((e) => e.getAttribute('aria-haspopup') === 'listbox')
    if (!el) throw new Error(`no select ${label}`)
    return el
  }
  const current = Number(todayISO().slice(0, 4))

  it('lists every year back to the earliest expense (newest first)', () => {
    expect(exportYears(2022, 2026, 2026)).toEqual([2026, 2025, 2024, 2023, 2022])
    expect(exportYears(null, 2026, 2026)).toEqual([2026])
    // The month on screen is always offered, even before any expense or after this year.
    expect(exportYears(2025, 2026, 2021)).toEqual([2026, 2025, 2024, 2023, 2022, 2021])
    expect(exportYears(2025, 2026, 2027)).toEqual([2027, 2026, 2025])
  })

  it('names the file by month or year', () => {
    expect(expenseExportName('month', '2026-10-01', 2026)).toBe('הוצאות-2026-10')
    expect(expenseExportName('year', '2026-10-01', 2025)).toBe('הוצאות-2025')
  })

  it('defaults to the month on screen; the year scope defaults to this year', async () => {
    db.tables.expenses = [{ spent_on: '2023-04-01' }]
    wrap(<ExpenseExportDialog opened month="2025-03-01" onClose={vi.fn()} />)
    const dialog = await screen.findByRole('dialog', { name: he.finance.expenseExport.title })
    expect(within(dialog).getByRole('radio', { name: he.finance.expenseExport.month })).toBeChecked()
    expect(selectIn(dialog, he.finance.monthName)).toHaveValue(HEBREW_MONTHS[2])
    expect(selectIn(dialog, he.finance.year)).toHaveValue('2025')
    fireEvent.click(within(dialog).getByRole('radio', { name: he.finance.expenseExport.year }))
    const year = selectIn(dialog, he.finance.year)
    expect(year).toHaveValue(String(current))
    fireEvent.click(year)
    await waitFor(() => expect(screen.getByRole('option', { name: '2023', hidden: true })).toBeInTheDocument())
    expect(screen.queryByRole('option', { name: '2022', hidden: true })).toBeNull()
    expect(within(dialog).getByRole('button', { name: he.finance.expenseExport.run })).toBeEnabled()
  })
})
