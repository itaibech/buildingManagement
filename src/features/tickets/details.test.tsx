// @vitest-environment jsdom
import { MantineProvider } from '@mantine/core'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { he } from '../../lib/he'
import { paste } from '../../test/paste'
import { theme } from '../../ui/theme'
import type { TicketDetail } from './api'
import type { AdminDetails, LinkedExpense, TicketFile } from './detailsApi'
import { defaultVisible, expensePrefill, fileType, validateFiles } from './files'
import TicketPage from './TicketPage'

const T = he.ticketDetails

const m = vi.hoisted(() => ({
  isAdmin: true,
  detail: null as unknown,
  details: null as unknown,
  linked: [] as unknown[],
  files: [] as unknown[],
  suppliers: [] as unknown[],
  adminDetailsCalls: vi.fn(),
  linkedCalls: vi.fn(),
  save: vi.fn(),
  update: vi.fn(),
  upload: vi.fn(),
  saveExpense: vi.fn(),
  success: vi.fn(),
  error: vi.fn(),
}))

const mutation = (fn: (v: unknown, o?: { onSuccess?: (d: unknown) => void }) => void) => ({ mutate: fn, isPending: false, isError: false })

vi.mock('../../lib/supabase', () => ({ supabase: {} }))
vi.mock('./api', async (orig) => ({
  ...(await orig<typeof import('./api')>()),
  useTicket: () => ({ data: m.detail, isLoading: false, isError: false }),
  useUpdateTicket: () => mutation(m.update),
  useCreateTicket: () => mutation(vi.fn()),
  useAddComment: () => mutation(vi.fn()),
  useDeleteTicket: () => mutation(vi.fn()),
}))
vi.mock('./detailsApi', () => {
  const idle = () => ({ mutate: () => undefined, isPending: false, isError: false })
  return {
    useAdminDetails: (id: string, enabled: boolean) => { m.adminDetailsCalls(id, enabled); return { data: m.details, isSuccess: true } },
    useLinkedExpenses: (id: string, enabled: boolean) => { m.linkedCalls(id, enabled); return { data: m.linked } },
    useActiveSuppliers: () => m.suppliers,
    useTicketFiles: () => ({ data: m.files }),
    useThumbnails: () => ({ data: {} }),
    useSaveTicketDetails: () => ({ mutate: m.save, isPending: false, isError: false }),
    useUploadTicketFiles: () => ({ mutate: m.upload, isPending: false, isError: false }),
    useSetFileVisibility: idle,
    useDeleteTicketFile: idle,
    signTicketFile: async () => 'https://signed',
  }
})
vi.mock('../finance/api', async (orig) => ({
  ...(await orig<typeof import('../finance/api')>()),
  useSaveExpense: () => ({ mutate: m.saveExpense, isPending: false, isError: false }),
}))
vi.mock('../maintenance/api', () => ({ useExpenseCategories: () => ({ data: [{ id: 'cat1', name: 'תיקונים' }] }) }))
vi.mock('../notifications/api', () => ({ useMarkTicketsSeen: () => ({ mutate: vi.fn() }), useUnseenTicketIds: () => new Set() }))
vi.mock('../../auth/AuthProvider', () => ({ useAuth: () => ({ isAdmin: m.isAdmin, session: { user: { id: 'me' } } }) }))
vi.mock('../../ui', async (orig) => ({ ...(await orig<typeof import('../../ui')>()), notifySuccess: m.success, notifyError: m.error }))

const detail = (o: Partial<TicketDetail> = {}): TicketDetail => ({
  id: 't1', building_id: 'b', title: 'נזילה במטבח', description: '', location: 'לובי', status: 'in_progress', opened_by: 'res',
  vendor: 'אינסטלטור', created_at: '2026-10-01T10:00:00Z', updated_at: '2026-10-02T10:00:00Z', last_activity_by: 'me',
  last_activity_kind: 'status', suggested_solution: 'להחליף צינור', fix_details: 'הוחלף צינור', openerName: 'דנה', photos: [],
  comments: [{ id: 'e1', body: 'in_progress', created_at: '2026-10-02T10:00:00Z', author_id: 'me', authorName: 'יוסי', event: 'status' }],
  ...o,
})
const file = (o: Partial<TicketFile> = {}): TicketFile => ({
  id: 'f1', path: 't1/0b9a54c4-3e1f-4b8e-9f0a-2c6d1e7f8a90.jpg', file_name: 'leak.jpg', size_bytes: 10, visible_to_residents: true,
  created_at: '2026-10-02T10:00:00Z', ...o,
})
const blob = (name: string, type: string, size = 10) => new File([new Uint8Array(size)], name, { type })

const show = () => render(
  <MantineProvider theme={theme}>
    <MemoryRouter initialEntries={['/tickets/t1']}>
      <Routes><Route path="/tickets/:id" element={<TicketPage />} /><Route path="/finance" element={<div>finance</div>} /></Routes>
    </MemoryRouter>
  </MantineProvider>,
)

// Mantine's Select scrolls its options into view; jsdom has no layout.
Element.prototype.scrollIntoView ??= () => undefined

beforeEach(() => {
  vi.clearAllMocks()
  m.isAdmin = true
  m.detail = detail()
  m.details = { cost: 450.5, supplier_id: null, updated_at: new Date().toISOString() } satisfies AdminDetails
  m.linked = []
  m.files = []
  m.suppliers = []
})

describe('files logic', () => {
  it('accepts images, PDF and Word (untyped by extension); rejects others, empties, > 10 MB and an 11th file', () => {
    expect(fileType(blob('a.heic', ''))).toBe('image/heic')
    expect(fileType(blob('a.docx', ''))).toBe('application/vnd.openxmlformats-officedocument.wordprocessingml.document')
    expect(fileType(blob('a.gif', 'image/gif'))).toBeNull()
    expect(validateFiles([blob('a.exe', 'application/x-msdownload')], 0)).toBe(T.errors.type('a.exe'))
    expect(validateFiles([blob('e.pdf', 'application/pdf', 0)], 0)).toBe(T.errors.empty('e.pdf'))
    expect(validateFiles([blob('b.pdf', 'application/pdf', 10 * 1024 * 1024 + 1)], 0)).toBe(T.errors.size('b.pdf'))
    expect(validateFiles([blob('c.pdf', 'application/pdf')], 10)).toBe(T.errors.tooMany)
    expect(validateFiles([blob('c.pdf', 'application/pdf')], 9)).toBeNull()
  })

  it('images default to visible for residents, PDF / Word to the committee', () => {
    expect(defaultVisible(blob('a.png', 'image/png'))).toBe(true)
    expect(defaultVisible(blob('a.pdf', 'application/pdf'))).toBe(false)
  })

  it('builds the expense prefill from the ticket', () => {
    expect(expensePrefill('נזילה', 450.5, ' אינסטלטור ', 'cat1')).toEqual({ amount: 450.5, vendor: 'אינסטלטור', note: 'תיקון תקלה: נזילה', categoryId: 'cat1' })
  })
})

describe('ניהול התקלה (admin)', () => {
  it('saves supplier, solution, fix details and cost with one button', async () => {
    m.save.mockImplementation((_v, o) => o?.onSuccess?.(undefined))
    show()
    fireEvent.change(screen.getByLabelText(T.fixDetails), { target: { value: 'הוחלף צינור ונבדקה נזילה' } })
    fireEvent.change(screen.getByLabelText(T.cost, { exact: false }), { target: { value: '600' } })
    fireEvent.click(screen.getByRole('button', { name: T.save }))
    await waitFor(() => expect(m.save).toHaveBeenCalledWith({
      ticketId: 't1', vendor: 'אינסטלטור', supplierId: null, suggestedSolution: 'להחליף צינור', fixDetails: 'הוחלף צינור ונבדקה נזילה', cost: 600,
    }, expect.anything()))
    expect(m.success).toHaveBeenCalledWith(T.saved)
    expect(screen.getByText(/נערך לאחרונה/)).toBeInTheDocument()
  })

  it('an empty cost is saved as null; overlong fix details are refused in Hebrew', async () => {
    show()
    fireEvent.change(screen.getByLabelText(T.cost, { exact: false }), { target: { value: '' } })
    fireEvent.change(screen.getByLabelText(T.fixDetails), { target: { value: 'x'.repeat(5001) } })
    fireEvent.click(screen.getByRole('button', { name: T.save }))
    expect(await screen.findByText(T.errors.tooLong(5000))).toBeInTheDocument()
    expect(m.save).not.toHaveBeenCalled()
    fireEvent.change(screen.getByLabelText(T.fixDetails), { target: { value: 'ok' } })
    fireEvent.click(screen.getByRole('button', { name: T.save }))
    await waitFor(() => expect(m.save).toHaveBeenCalledWith(expect.objectContaining({ cost: null, fixDetails: 'ok' }), expect.anything()))
  })

  it('a pasted screenshot is attached as a visible image; a pasted PDF stays with the committee', () => {
    show()
    const png = blob('image.png', 'image/png')
    paste(document.body, { files: [png] })
    expect(m.upload).toHaveBeenCalledWith({ ticketId: 't1', files: [{ file: expect.any(File), visible: true }] }, expect.anything())
    paste(document.body, { files: [blob('quote.pdf', 'application/pdf')] })
    expect(m.upload).toHaveBeenLastCalledWith({ ticketId: 't1', files: [{ file: expect.any(File), visible: false }] }, expect.anything())
  })

  it('lists files with the residents toggle and a committee-only badge', () => {
    m.files = [file(), file({ id: 'f2', path: 't1/1b9a54c4-3e1f-4b8e-9f0a-2c6d1e7f8a90.pdf', file_name: 'quote.pdf', visible_to_residents: false })]
    show()
    expect(screen.getAllByTestId('ticket-file')).toHaveLength(2)
    expect(screen.getByRole('switch', { name: `${T.visible}: quote.pdf` })).not.toBeChecked()
    const [image, pdf] = screen.getAllByTestId('ticket-file')
    expect(within(pdf as HTMLElement).getByText(T.committeeOnly)).toBeInTheDocument()
    expect(within(image as HTMLElement).queryByText(T.committeeOnly)).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: T.deleteFile('quote.pdf') })).toBeInTheDocument()
  })

  it('"רישום כהוצאה" opens the new-expense form prefilled and links it to the ticket', async () => {
    m.suppliers = [{ id: 's1', name: 'אינסטלטור', category: '', expense_category_id: 'cat1', is_draft: false }]
    m.details = { cost: 450.5, supplier_id: 's1', updated_at: '2026-10-02T10:00:00Z' }
    show()
    fireEvent.click(screen.getByRole('button', { name: T.recordExpense }))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByLabelText(he.finance.vendor)).toHaveValue('אינסטלטור')
    expect(within(dialog).getByLabelText(he.finance.note)).toHaveValue(T.expenseNote('נזילה במטבח'))
    fireEvent.click(within(dialog).getByRole('button', { name: he.finance.saveExpense }))
    await waitFor(() => expect(m.saveExpense).toHaveBeenCalled())
    expect(m.saveExpense).toHaveBeenCalledWith(expect.objectContaining({
      values: expect.objectContaining({ category_id: 'cat1', amount: 450.5, vendor: 'אינסטלטור', note: T.expenseNote('נזילה במטבח'), ticket_id: 't1' }),
    }), expect.anything())
  })

  it('with an expense already linked, shows it and asks before recording another', async () => {
    m.linked = [{ id: 'x1', amount: 450.5, spent_on: '2026-10-05' }] satisfies LinkedExpense[]
    show()
    expect(screen.getByTestId('expense-linked')).toHaveTextContent(T.expenseRecorded)
    expect(screen.getByRole('link', { name: T.viewExpense })).toHaveAttribute('href', '/finance?tab=expenses&month=2026-10-01')
    fireEvent.click(screen.getByRole('button', { name: T.recordExpense }))
    const confirm = await screen.findByRole('dialog')
    expect(within(confirm).getByText(T.duplicateBody)).toBeInTheDocument()
    expect(screen.queryByLabelText(he.finance.note)).not.toBeInTheDocument()
    fireEvent.click(within(confirm).getByRole('button', { name: T.duplicateConfirm }))
    expect(await screen.findByLabelText(he.finance.note)).toBeInTheDocument()
  })

  it('no cost, no expense button', () => {
    m.details = null
    show()
    expect(screen.queryByRole('button', { name: T.recordExpense })).not.toBeInTheDocument()
  })

  it('shows a status change as a timeline line', () => {
    show()
    expect(screen.getByTestId('ticket-event')).toHaveTextContent(T.event.status(he.ticketStatus.in_progress))
  })
})

const openEdit = async () => {
  fireEvent.click(screen.getByRole('button', { name: he.tickets.actions }))
  fireEvent.click(await screen.findByRole('menuitem', { name: he.tickets.edit }))
  return screen.findByRole('dialog')
}

describe('עריכת התקלה dialog', () => {
  it('admin: holds supplier, repair fields and files; one call saves the text and the details', async () => {
    m.save.mockImplementation((_v, o) => o?.onSuccess?.(undefined))
    m.details = { cost: 450.5, supplier_id: 's1', updated_at: '2026-10-02T10:00:00Z' }
    m.suppliers = [{ id: 's1', name: 'אינסטלטור', category: '', expense_category_id: null, is_draft: false },
      { id: 's2', name: 'חשמלאי', category: '', expense_category_id: null, is_draft: false }]
    show()
    const dialog = await openEdit()
    expect(within(dialog).getByLabelText(T.suggestedSolution)).toHaveValue('להחליף צינור')
    expect(within(dialog).getByLabelText(he.tickets.vendor)).toHaveValue('אינסטלטור')
    expect(within(dialog).getByRole('button', { name: T.addFiles })).toBeInTheDocument()
    const select = within(dialog).getByLabelText(T.supplier)
    fireEvent.click(select)
    const listbox = await waitFor(() => {
      const el = document.getElementById(select.getAttribute('aria-controls') ?? '')
      if (!el) throw new Error('listbox not open')
      return el
    })
    fireEvent.click(within(listbox).getByRole('option', { name: 'חשמלאי', hidden: true }))
    expect(within(dialog).getByLabelText(he.tickets.vendor)).toHaveValue('חשמלאי')
    fireEvent.change(within(dialog).getByLabelText(he.tickets.title, { exact: false }), { target: { value: ' נזילה גדולה ' } })
    fireEvent.change(within(dialog).getByLabelText(T.fixDetails), { target: { value: 'הוחלף צינור ראשי' } })
    fireEvent.click(within(dialog).getByRole('button', { name: he.tickets.save }))
    await waitFor(() => expect(m.save).toHaveBeenCalledTimes(1))
    expect(m.update).not.toHaveBeenCalled()
    expect(m.save).toHaveBeenCalledWith({ ticketId: 't1', vendor: 'חשמלאי', supplierId: 's2', suggestedSolution: 'להחליף צינור',
      fixDetails: 'הוחלף צינור ראשי', cost: 450.5, text: { title: 'נזילה גדולה', description: '', location: 'לובי' } }, expect.anything())
    expect(m.success).toHaveBeenCalledWith(he.tickets.updated)
  })

  it('admin: the dialog sends the vendor it shows, not the prop it opened with', async () => {
    m.save.mockImplementation((_v, o) => o?.onSuccess?.(undefined))
    show()
    const dialog = await openEdit()
    fireEvent.change(within(dialog).getByLabelText(he.tickets.vendor), { target: { value: 'קבלן חדש' } })
    fireEvent.click(within(dialog).getByRole('button', { name: he.tickets.save }))
    await waitFor(() => expect(m.save).toHaveBeenCalledWith(expect.objectContaining({ vendor: 'קבלן חדש' }), expect.anything()))
  })

  it('admin: a screenshot pasted inside the dialog is attached', async () => {
    show()
    const dialog = await openEdit()
    paste(within(dialog).getByLabelText(T.fixDetails), { files: [blob('image.png', 'image/png')] })
    expect(m.upload).toHaveBeenCalledTimes(1)
    expect(m.upload).toHaveBeenCalledWith({ ticketId: 't1', files: [{ file: expect.any(File), visible: true }] }, expect.anything())
  })

  it('the opener editing their own ticket sees only the three original fields', async () => {
    m.isAdmin = false
    m.detail = detail({ status: 'open', opened_by: 'me' })
    show()
    const dialog = await openEdit()
    expect(within(dialog).getByLabelText(he.tickets.description)).toBeInTheDocument()
    expect(within(dialog).queryByLabelText(T.fixDetails)).not.toBeInTheDocument()
    expect(within(dialog).queryByLabelText(T.cost, { exact: false })).not.toBeInTheDocument()
    expect(within(dialog).queryByRole('button', { name: T.addFiles })).not.toBeInTheDocument()
  })
})

describe('פרטי הטיפול (resident)', () => {
  it('shows the solution, fix details and the files RLS returns; no cost, no admin data, no editing', () => {
    m.isAdmin = false
    m.files = [file()]
    show()
    expect(screen.getByText(T.treatment)).toBeInTheDocument()
    expect(screen.getByText('להחליף צינור')).toBeInTheDocument()
    expect(screen.getByText('הוחלף צינור')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: T.openFile('leak.jpg') })).toBeInTheDocument()
    expect(screen.queryByText(he.tickets.adminControls)).not.toBeInTheDocument()
    expect(screen.queryByText(T.cost, { exact: false })).not.toBeInTheDocument()
    expect(screen.queryByText(/450/)).not.toBeInTheDocument()
    expect(screen.queryByRole('switch')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: T.deleteFile('leak.jpg') })).not.toBeInTheDocument()
    expect(m.adminDetailsCalls).not.toHaveBeenCalled()
    expect(m.linkedCalls).not.toHaveBeenCalled()
  })

  it('no treatment and no files: no card', () => {
    m.isAdmin = false
    m.detail = detail({ suggested_solution: '', fix_details: '' })
    show()
    expect(screen.queryByText(T.treatment)).not.toBeInTheDocument()
  })
})
