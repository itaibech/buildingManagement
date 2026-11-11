// @vitest-environment jsdom
import { MemoryRouter } from 'react-router'
import { MantineProvider } from '@mantine/core'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { todayISO } from '../../lib/dates'
import { HEBREW_MONTHS, he } from '../../lib/he'
import { paste } from '../../test/paste'
import { theme } from '../../ui/theme'
import type { Expense } from './api'
import { expenseExportName } from '../export/buildWorkbook'
import { ExpenseExportDialog } from './ExpenseExport'
import { exportYears } from './ledger'
import { ExpenseForm } from './ExpenseForms'
import { ExpensesTab } from './ExpensesTab'
import { ReceiptControl } from './ReceiptControl'
import type { ExpenseReceipt } from './receiptsApi'

const db = vi.hoisted(() => ({
  tables: {} as Record<string, unknown[]>,
  /** Every write, in order: `upload:<path>`, `insert:<table>:<json>`, `delete:<table>`, `remove:<paths>`. */
  log: [] as string[],
  uploadError: null as { message: string } | null,
  coarse: false,
  admin: true,
  /** `table.op` keys whose statement resolves with an error (code 23505 for expense_categories.insert). */
  fail: new Set<string>(),
  /** Storage answers a remove with an error (e.g. RLS). */
  removeError: false,
}))
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }))

function failure(table: string, ops: string[]) {
  if (!ops.some((op) => db.fail.has(`${table}.${op}`))) return null
  return { message: 'boom', code: table === 'expense_categories' ? '23505' : 'P0001' }
}

function builder(table: string) {
  const ops: string[] = []
  let inserted: Record<string, unknown> = {}
  const chain: Record<string, unknown> = {}
  for (const op of ['select', 'eq', 'lt', 'gte', 'order', 'in', 'limit', 'range']) chain[op] = () => { ops.push(op); return chain }
  chain.insert = (values: Record<string, unknown>) => {
    ops.push('insert')
    inserted = values
    db.log.push(`insert:${table}:${JSON.stringify(values)}`)
    // A new category is there when the list is fetched again.
    if (table === 'expense_categories' && !db.fail.has('expense_categories.insert')) db.tables[table] = [...(db.tables[table] ?? []), { id: 'c-new', ...values }]
    return chain
  }
  chain.delete = () => { ops.push('delete'); db.log.push(`delete:${table}`); return chain }
  chain.single = () => {
    const error = failure(table, ops)
    return Promise.resolve(error ? { data: null, error } : { data: { id: table === 'expenses' ? 'e-new' : 'c-new', name: inserted.name }, error: null })
  }
  chain.then = (resolve: (v: unknown) => unknown) => {
    const error = failure(table, ops)
    const data = ops.includes('delete') ? [{ id: 'x' }] : (db.tables[table] ?? [])
    return Promise.resolve(error ? { data: null, error } : { data, error: null }).then(resolve)
  }
  return chain
}

vi.mock('../../lib/supabase', () => ({
  supabase: {
    from: (table: string) => builder(table),
    rpc: (fn: string, args: unknown) => { db.log.push(`rpc:${fn}:${JSON.stringify(args)}`); return Promise.resolve({ data: null, error: null }) },
    storage: {
      from: (bucket: string) => ({
        upload: (path: string) => { db.log.push(`upload:${path}`); return Promise.resolve({ error: db.uploadError }) },
        download: (path: string) => {
          db.log.push(`download:${bucket}:${path}`)
          return Promise.resolve(db.fail.has(`download:${path}`) ? { data: null, error: { message: 'gone' } } : { data: new Blob(['x'], { type: 'image/jpeg' }), error: null })
        },
        remove: (paths: string[]) => {
          db.log.push(`remove:${paths.join(',')}`)
          return Promise.resolve(db.removeError ? { data: null, error: { message: 'refused' } } : { data: paths.map((name) => ({ name })), error: null })
        },
        createSignedUrl: () => Promise.resolve({ data: { signedUrl: 'https://signed.example.test/r' }, error: null }),
        createSignedUrls: () => Promise.resolve({ data: [], error: null }),
      }),
    },
  },
}))
vi.mock('../../auth/AuthProvider', () => ({ useAuth: () => ({ isAdmin: db.admin, session: { user: { id: 'me' } }, can: () => true }) }))
vi.mock('../../ui/notify', () => ({ notifySuccess: toast.success, notifyError: toast.error }))
vi.mock('../../ui', async (orig) => ({ ...(await orig<typeof import('../../ui')>()), notifySuccess: toast.success, notifyError: toast.error }))
vi.mock('@mantine/hooks', async (orig) => ({
  ...(await orig<typeof import('@mantine/hooks')>()),
  useMediaQuery: (q: string) => (q.includes('pointer') ? db.coarse : false),
}))

const wrap = (node: ReactNode) => render(
  <MantineProvider theme={theme}>
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><MemoryRouter>{node}</MemoryRouter></QueryClientProvider>
  </MantineProvider>,
)

const R = he.finance.receipts
const receipt = (path: string, file_name: string, mime = 'application/pdf'): ExpenseReceipt =>
  ({ id: `r-${path}`, path, file_name, mime, size_bytes: 10, created_at: '2026-10-05T10:00:00Z' })
const expense = (over: Partial<Expense> = {}): Expense => ({
  id: 'e1', category_id: 'c1', category: 'ניקיון', spent_on: '2026-10-05', amount: 100, vendor: 'ספק', note: '',
  receipts: [], source: 'manual', template_id: null, special_id: null, ticket_id: null, ...over,
})
const pdf = new File(['%PDF'], 'חשבונית.pdf', { type: 'application/pdf' })
const png = (name: string) => new File(['png'], name, { type: 'image/png' })
const fileInput = (root: HTMLElement, camera = false): HTMLInputElement => {
  const input = root.querySelector<HTMLInputElement>(camera ? 'input[type=file][capture]' : 'input[type=file]:not([capture])')
  if (!input) throw new Error('no file input')
  return input
}
const pick = (input: HTMLInputElement, ...files: File[]) => fireEvent.change(input, { target: { files } })
const uploads = () => db.log.filter((l) => l.startsWith('upload:'))
const openSheet = async (name: string): Promise<HTMLElement> => {
  fireEvent.click(screen.getByRole('button', { name }))
  return screen.findByRole('dialog', { name: R.title })
}

// jsdom has no scrollIntoView; Mantine's Select scrolls the chosen option into view when it opens.
Element.prototype.scrollIntoView ??= () => undefined
URL.createObjectURL = () => 'blob:preview'
URL.revokeObjectURL = () => undefined

beforeEach(() => {
  db.tables = {}
  db.log = []
  db.uploadError = null
  db.coarse = false
  db.admin = true
  db.fail = new Set()
  db.removeError = false
  toast.success.mockReset()
  toast.error.mockReset()
})

describe('ReceiptControl (0040: several receipts per expense)', () => {
  it('no receipt: a 44px paperclip "הוספת קבלה" that opens the sheet; picking several uploads each and records its row', async () => {
    wrap(<ReceiptControl expense={expense()} />)
    expect(screen.getByRole('button', { name: R.add }).style.getPropertyValue('--ai-size')).toContain('2.75rem')
    const sheet = await openSheet(R.add)
    expect(within(sheet).getByText(R.none)).toBeInTheDocument()
    expect(fileInput(sheet).accept).toBe('image/*,application/pdf,.doc,.docx,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document')
    expect(fileInput(sheet).multiple).toBe(true)
    pick(fileInput(sheet), pdf, png('b.png'))
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith(R.saved(2)))
    expect(uploads()[0]).toMatch(/^upload:e1\/[0-9a-f-]{36}\.pdf$/)
    expect(uploads()[1]).toMatch(/^upload:e1\/[0-9a-f-]{36}\.png$/)
    const rows = db.log.filter((l) => l.startsWith('insert:expense_receipts:'))
    expect(rows).toHaveLength(2)
    expect(rows[0]).toContain('"file_name":"חשבונית.pdf"')
    expect(rows[0]).toContain('"mime":"application/pdf"')
    expect(rows[1]).toContain('"size_bytes":3')
  })

  it('shows 📎 with the count; the sheet lists them and opens a signed URL on tap, with no opener', async () => {
    const win = { opener: {}, location: { href: '' }, close: vi.fn() }
    const open = vi.spyOn(window, 'open').mockReturnValue(win as unknown as Window)
    wrap(<ReceiptControl expense={expense({ receipts: [receipt('e1/a.pdf', 'א.pdf'), receipt('e1/b.png', 'ב.png', 'image/png')] })} />)
    expect(screen.queryByRole('button', { name: R.add })).toBeNull()
    expect(screen.getByRole('button', { name: R.open(2) })).toHaveTextContent('2')
    const sheet = await openSheet(R.open(2))
    expect(within(sheet).getAllByTestId('receipt-line')).toHaveLength(2)
    fireEvent.click(within(sheet).getByRole('button', { name: R.view('ב.png') }))
    expect(open).toHaveBeenCalledWith('', '_blank')
    expect(win.opener).toBeNull()
    await waitFor(() => expect(win.location.href).toBe('https://signed.example.test/r'))
    open.mockRestore()
  })

  it('refuses an unsupported, empty or oversized file before uploading, in Hebrew', async () => {
    wrap(<ReceiptControl expense={expense()} />)
    const sheet = await openSheet(R.add)
    pick(fileInput(sheet), new File(['MZ'], 'setup.exe', { type: 'application/x-msdownload' }))
    expect(toast.error).toHaveBeenCalledWith('סוג קובץ לא נתמך')
    pick(fileInput(sheet), new File([], 'empty.pdf', { type: 'application/pdf' }))
    expect(toast.error).toHaveBeenCalledWith(he.finance.errors.receiptEmpty)
    const big = new File(['x'], 'big.pdf', { type: 'application/pdf' })
    Object.defineProperty(big, 'size', { value: 11 * 1024 * 1024 })
    pick(fileInput(sheet), big)
    expect(toast.error).toHaveBeenCalledWith('הקובץ גדול מ-10MB')
    expect(db.log).toEqual([])
  })

  it('at most 10: more than the room left is refused, and a full expense disables adding', async () => {
    const nine = Array.from({ length: 9 }, (_, i) => receipt(`e1/${i}.pdf`, `${i}.pdf`))
    const { rerender } = wrap(<ReceiptControl expense={expense({ receipts: nine })} />)
    const sheet = await openSheet(R.open(9))
    pick(fileInput(sheet), pdf, png('b.png'))
    expect(toast.error).toHaveBeenCalledWith(he.finance.errors.tooManyReceipts)
    expect(uploads()).toEqual([])
    const ten = [...nine, receipt('e1/9.pdf', '9.pdf')]
    rerender(<MantineProvider theme={theme}><QueryClientProvider client={new QueryClient()}><MemoryRouter><ReceiptControl expense={expense({ receipts: ten })} /></MemoryRouter></QueryClientProvider></MantineProvider>)
    expect(await screen.findByText(R.full)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: R.addMore })).toBeDisabled()
  })

  it('on a touch screen "הוספת קבלות" offers the camera or files', async () => {
    db.coarse = true
    wrap(<ReceiptControl expense={expense()} />)
    const sheet = await openSheet(R.add)
    fireEvent.click(within(sheet).getByRole('button', { name: R.addMore }))
    expect(await screen.findByRole('menuitem', { name: R.takePhoto, hidden: true })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: R.pickFile, hidden: true })).toBeInTheDocument()
    expect(fileInput(sheet, true).getAttribute('capture')).toBe('environment')
    expect(fileInput(sheet, true).accept).toBe('image/*')
  })

  it('a refused row removes its upload again; the file is named in the error', async () => {
    db.fail.add('expense_receipts.insert')
    wrap(<ReceiptControl expense={expense()} />)
    const sheet = await openSheet(R.add)
    pick(fileInput(sheet), pdf)
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(R.failed(['חשבונית.pdf'])))
    expect(db.log.map((l) => l.split(':')[0])).toEqual(['upload', 'insert', 'remove'])
    expect(toast.success).not.toHaveBeenCalled()
  })

  it('a failed upload records no row', async () => {
    db.uploadError = { message: 'too big' }
    wrap(<ReceiptControl expense={expense()} />)
    const sheet = await openSheet(R.add)
    pick(fileInput(sheet), pdf)
    await waitFor(() => expect(toast.error).toHaveBeenCalled())
    expect(db.log.some((l) => l.startsWith('insert') || l.startsWith('remove'))).toBe(false)
  })

  it('remove asks for confirmation, deletes the row, then removes the queued object', async () => {
    db.tables.receipt_trash = [{ path: 'e1/a.pdf' }]
    wrap(<ReceiptControl expense={expense({ receipts: [receipt('e1/a.pdf', 'א.pdf'), receipt('e1/b.pdf', 'ב.pdf')] })} />)
    const sheet = await openSheet(R.open(2))
    fireEvent.click(within(sheet).getByRole('button', { name: R.removeOne('א.pdf') }))
    const dialog = await screen.findByRole('dialog', { name: R.removeConfirm })
    expect(db.log).toEqual([])
    fireEvent.click(within(dialog).getByRole('button', { name: R.remove }))
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith(R.removed))
    expect(db.log).toEqual(['delete:expense_receipts', 'remove:e1/a.pdf', 'delete:receipt_trash'])
  })

  it('a file storage refuses to remove counts as staying behind', async () => {
    db.tables.receipt_trash = [{ path: 'e1/a.pdf' }]
    db.removeError = true
    wrap(<ReceiptControl expense={expense({ receipts: [receipt('e1/a.pdf', 'א.pdf')] })} />)
    const sheet = await openSheet(R.open(1))
    fireEvent.click(within(sheet).getByRole('button', { name: R.removeOne('א.pdf') }))
    fireEvent.click(within(await screen.findByRole('dialog', { name: R.removeConfirm })).getByRole('button', { name: R.remove }))
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(R.fileStayed))
    expect(toast.success).not.toHaveBeenCalled()
  })

  it('an expense recorded for a ticket: its files not copied yet can be copied from the row (the retry)', async () => {
    db.tables.ticket_files = [
      { id: 'f1', path: 't1/0b9a54c4-3e1f-4b8e-9f0a-2c6d1e7f8a90.jpg', file_name: 'leak.jpg', size_bytes: 10, visible_to_residents: true, created_at: '2026-10-01' },
      { id: 'f2', path: 't1/1b9a54c4-3e1f-4b8e-9f0a-2c6d1e7f8a90.pdf', file_name: 'quote.pdf', size_bytes: 20, visible_to_residents: false, created_at: '2026-10-02' },
    ]
    const copied = { ...receipt('e1/a.jpg', 'leak.jpg', 'image/jpeg'), size_bytes: 10 }
    wrap(<ReceiptControl expense={expense({ ticket_id: 't1', receipts: [copied] })} />)
    const sheet = await openSheet(R.open(1))
    const done = await within(sheet).findByRole('checkbox', { name: R.pickTicketFile('leak.jpg') })
    expect(done).toBeDisabled()
    expect(within(sheet).getByRole('checkbox', { name: R.pickTicketFile('quote.pdf') })).toBeChecked()
    fireEvent.click(within(sheet).getByRole('button', { name: R.copy(1) }))
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith(R.saved(1)))
    expect(db.log[0]).toBe('download:ticket-files:t1/1b9a54c4-3e1f-4b8e-9f0a-2c6d1e7f8a90.pdf')
    expect(db.log[1]).toMatch(/^upload:e1\/[0-9a-f-]{36}\.pdf$/)
    expect(db.log[2]).toContain('"file_name":"quote.pdf"')
    // The ticket keeps its file: nothing is removed from its bucket.
    expect(db.log.some((l) => l.startsWith('remove') || l.startsWith('delete'))).toBe(false)
  })
})

describe('pasting a receipt', () => {
  const shot = new File(['png'], '', { type: 'image/png' })
  it('the new-expense dialog: each pasted screenshot is added; a wrong type gets the picker\'s Hebrew error', async () => {
    wrap(<ExpenseForm onDone={vi.fn()} />)
    expect(screen.getByRole('button', { name: he.paste.button })).toBeInTheDocument()
    paste(screen.getByLabelText(he.finance.vendor), { files: [new File(['x'], 'a.zip', { type: 'application/zip' })] })
    expect(await screen.findByText(he.finance.errors.receiptType)).toBeInTheDocument()
    paste(screen.getByLabelText(he.finance.vendor), { files: [shot] })
    paste(screen.getByLabelText(he.finance.vendor), { files: [shot] })
    await waitFor(() => expect(screen.getAllByTestId('picked-receipt')).toHaveLength(2))
    expect(screen.getAllByText(/^clipboard-\d+\.png$/)).toHaveLength(2)
  })
  it('an expense row: Ctrl+V on the focused paperclip uploads the screenshot as a receipt', async () => {
    wrap(<><ReceiptControl expense={expense()} /><ReceiptControl expense={expense({ id: 'e2' })} /></>)
    paste(document.body, { files: [shot] })
    expect(db.log).toHaveLength(0)
    paste(screen.getAllByRole('button', { name: R.add })[1], { files: [shot] })
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith(R.saved(1)))
    expect(db.log[0]).toMatch(/^upload:e2\/[0-9a-f-]{36}\.png$/)
    expect(db.log[1]).toMatch(/"file_name":"clipboard-\d+\.png"/)
  })
})

describe('the new-expense dialog: several receipts', () => {
  it('picks several files with thumbnails, removes one, saves the rest as receipts of the new expense', async () => {
    db.tables.expense_categories = [{ id: 'c1', name: 'ניקיון' }]
    const done = vi.fn()
    wrap(<ExpenseForm onDone={done} initial={{ categoryId: 'c1', amount: 50 }} />)
    const input = fileInput(document.body)
    expect(input.multiple).toBe(true)
    pick(input, pdf, png('a.png'), png('b.png'))
    expect(screen.getAllByTestId('picked-receipt')).toHaveLength(3)
    fireEvent.click(screen.getByRole('button', { name: he.finance.removeReceipt('a.png') }))
    expect(screen.getAllByTestId('picked-receipt')).toHaveLength(2)
    fireEvent.click(screen.getByRole('button', { name: he.finance.saveExpense }))
    await waitFor(() => expect(done).toHaveBeenCalled())
    expect(toast.success).toHaveBeenCalledWith(he.finance.expenseSaved)
    expect(uploads().map((u) => u.replace(/[0-9a-f-]{36}/, 'id'))).toEqual(['upload:e-new/id.pdf', 'upload:e-new/id.png'])
  })

  it('more than 10 files are refused in Hebrew, and nothing is added', () => {
    wrap(<ExpenseForm onDone={vi.fn()} />)
    pick(fileInput(document.body), ...Array.from({ length: 11 }, (_, i) => png(`${i}.png`)))
    expect(screen.getByText(he.finance.errors.tooManyReceipts)).toBeInTheDocument()
    expect(screen.queryAllByTestId('picked-receipt')).toHaveLength(0)
  })

  it('a receipt that fails still saves the expense and names the file', async () => {
    db.tables.expense_categories = [{ id: 'c1', name: 'ניקיון' }]
    db.uploadError = { message: 'nope' }
    const done = vi.fn()
    wrap(<ExpenseForm onDone={done} initial={{ categoryId: 'c1', amount: 50 }} />)
    pick(fileInput(document.body), pdf)
    fireEvent.click(screen.getByRole('button', { name: he.finance.saveExpense }))
    await waitFor(() => expect(done).toHaveBeenCalled())
    expect(toast.error).toHaveBeenCalledWith(he.finance.receiptFailed(['חשבונית.pdf']))
  })
})

describe('a new category from the expense dialog', () => {
  const categoryInput = (): HTMLElement => {
    const el = screen.getAllByLabelText(new RegExp(he.finance.category)).find((e) => e.tagName === 'INPUT')
    if (!el) throw new Error('no category input')
    return el
  }
  // Mantine treats a change to an unfocused input as autofill, so focus it first, as typing would.
  const typeCategory = async (name: string) => {
    categoryInput().focus()
    fireEvent.click(categoryInput())
    // The building's categories have loaded.
    await screen.findAllByRole('option', { hidden: true })
    fireEvent.change(categoryInput(), { target: { value: name } })
  }

  it('an admin types a new name: "+ קטגוריה חדשה" adds it (trimmed, at the end of the order) and selects it', async () => {
    db.tables.expense_categories = [{ id: 'c1', name: 'ניקיון', sort_order: 4 }]
    wrap(<ExpenseForm onDone={vi.fn()} />)
    await typeCategory('  גינון  ')
    fireEvent.click(await screen.findByRole('option', { name: he.finance.newCategory('גינון'), hidden: true }))
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith(he.finance.categoryCreated('גינון')))
    expect(db.log).toContain('insert:expense_categories:{"name":"גינון","sort_order":5}')
    await waitFor(() => expect(categoryInput()).toHaveValue('גינון'))
  })

  it('a name that is already taken gets a Hebrew error, and nothing is selected', async () => {
    db.tables.expense_categories = [{ id: 'c1', name: 'ניקיון', sort_order: 1 }]
    db.fail.add('expense_categories.insert')
    wrap(<ExpenseForm onDone={vi.fn()} />)
    await typeCategory('גינון')
    fireEvent.click(await screen.findByRole('option', { name: he.finance.newCategory('גינון'), hidden: true }))
    expect(await screen.findByText(he.finance.errors.categoryDuplicate)).toBeInTheDocument()
    expect(toast.success).not.toHaveBeenCalled()
  })

  it('an existing name (any case, extra spaces) is offered as itself, not as a new one; over 60 characters is refused', async () => {
    db.tables.expense_categories = [{ id: 'c1', name: 'Elevator', sort_order: 1 }]
    wrap(<ExpenseForm onDone={vi.fn()} />)
    await typeCategory(' elevator ')
    expect(screen.queryByRole('option', { name: he.finance.newCategory('elevator'), hidden: true })).toBeNull()
    await typeCategory('א'.repeat(61))
    fireEvent.click(await screen.findByRole('option', { name: he.finance.newCategory('א'.repeat(61)), hidden: true }))
    expect(await screen.findByText(he.finance.errors.categoryLength)).toBeInTheDocument()
    expect(db.log.some((l) => l.startsWith('insert:expense_categories'))).toBe(false)
  })

  it('not offered to a non-admin', async () => {
    db.admin = false
    db.tables.expense_categories = [{ id: 'c1', name: 'ניקיון' }]
    wrap(<ExpenseForm onDone={vi.fn()} />)
    await typeCategory('גינון')
    expect(screen.queryByRole('option', { name: he.finance.newCategory('גינון'), hidden: true })).toBeNull()
  })
})

describe('expenses tab receipts', () => {
  it('each category header counts the expenses with receipts; each row shows 📎 with its count', async () => {
    const month = todayISO().slice(0, 8)
    const row = (e: Expense) => {
      const { receipts, category, ...rest } = e
      return { ...rest, expense_categories: { name: category }, expense_receipts: receipts }
    }
    db.tables.expenses = [
      row(expense({ id: 'e1', spent_on: `${month}02`, receipts: [receipt('e1/a.pdf', 'a.pdf'), receipt('e1/b.pdf', 'b.pdf')] })),
      row(expense({ id: 'e2', spent_on: `${month}03`, source: 'import' })),
      row(expense({ id: 'e3', spent_on: `${month}04`, receipts: [receipt('e3/b.pdf', 'b.pdf')], source: 'import' })),
    ]
    wrap(<ExpensesTab adding={false} onAdd={vi.fn()} onAddingClose={vi.fn()} />)
    expect(await screen.findByText(R.count(2, 3))).toBeInTheDocument()
    expect(screen.getByRole('button', { name: R.open(2) })).toHaveTextContent('2')
    expect(screen.getByRole('button', { name: R.open(1) })).toHaveTextContent('1')
    // The imported row without a receipt can get some too.
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
