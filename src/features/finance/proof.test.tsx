// @vitest-environment jsdom
import { MemoryRouter } from 'react-router'
import { MantineProvider } from '@mantine/core'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { he } from '../../lib/he'
import { theme } from '../../ui/theme'
import { proofError, proofMime, proofPath } from './ledger'
import { PaymentForm } from './PaymentForm'
import { PaymentsTab } from './PaymentsTab'
import { ProofButton, ProofControl } from './ProofControl'

const db = vi.hoisted(() => ({
  tables: {} as Record<string, unknown[]>,
  /** Every write, in order: `insert:<table>`, `upload:<path>`, `update:<json>`, `remove:<paths>`, `delete:<table>`, `sign:<path>:<s>`. */
  log: [] as string[],
  /** The payment update matches no row (deleted meanwhile, or RLS). */
  updateMissing: false,
}))
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }))

function builder(table: string) {
  const chain: Record<string, unknown> = {}
  for (const op of ['select', 'eq', 'lt', 'gte', 'order', 'in', 'limit', 'not']) chain[op] = () => chain
  chain.insert = () => { db.log.push(`insert:${table}`); return chain }
  chain.delete = () => { db.log.push(`delete:${table}`); return chain }
  chain.update = (values: unknown) => { db.log.push(`update:${JSON.stringify(values)}`); return chain }
  chain.single = () => Promise.resolve(db.updateMissing && db.log.at(-1)?.startsWith('update:')
    ? { data: null, error: { message: 'no rows' } } : { data: { id: 'p1' }, error: null })
  chain.then = (resolve: (v: unknown) => unknown) => Promise.resolve({ data: db.tables[table] ?? [], error: null }).then(resolve)
  return chain
}

vi.mock('../../lib/supabase', () => ({
  supabase: {
    from: (table: string) => builder(table),
    rpc: () => Promise.resolve({ data: null, error: null }),
    storage: {
      from: () => ({
        upload: (path: string) => { db.log.push(`upload:${path}`); return Promise.resolve({ error: null }) },
        copy: (from: string, to: string) => { db.log.push(`copy:${from}>${to}`); return Promise.resolve({ error: null }) },
        remove: (paths: string[]) => { db.log.push(`remove:${paths.join(',')}`); return Promise.resolve({ data: paths.map((name) => ({ name })), error: null }) },
        createSignedUrl: (path: string, seconds: number) => {
          db.log.push(`sign:${path}:${seconds}`)
          return Promise.resolve({ data: { signedUrl: 'https://signed.example.test/p' }, error: null })
        },
      }),
    },
  },
}))
vi.mock('../../auth/AuthProvider', () => ({ useAuth: () => ({ isAdmin: true, session: { user: { id: 'me' } }, can: () => true }) }))
vi.mock('../../ui/notify', () => ({ notifySuccess: toast.success, notifyError: toast.error }))
vi.mock('../../ui', async (orig) => ({ ...(await orig<typeof import('../../ui')>()), notifySuccess: toast.success, notifyError: toast.error }))

const wrap = (node: ReactNode) => render(
  <MantineProvider theme={theme}>
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><MemoryRouter>{node}</MemoryRouter></QueryClientProvider>
  </MantineProvider>,
)

const P = he.finance.proof
const jpg = new File(['jpg'], 'העברה.jpg', { type: 'image/jpeg' })
const pdf = new File(['%PDF'], 'אסמכתה.pdf', { type: 'application/pdf' })
const fileInput = (container: HTMLElement): HTMLInputElement => {
  const input = container.ownerDocument.querySelector<HTMLInputElement>('input[type=file]')
  if (!input) throw new Error('no file input')
  return input
}
const pick = (input: HTMLInputElement, file: File) => fireEvent.change(input, { target: { files: [file] } })
const big = (): File => {
  const f = new File(['x'], 'big.pdf', { type: 'application/pdf' })
  Object.defineProperty(f, 'size', { value: 11 * 1024 * 1024 })
  return f
}

// jsdom has no object URLs or scrollIntoView.
URL.createObjectURL = () => 'blob:preview'
URL.revokeObjectURL = () => undefined
Element.prototype.scrollIntoView ??= () => undefined

beforeEach(() => {
  db.tables = {}
  db.log = []
  db.updateMissing = false
  toast.success.mockReset()
  toast.error.mockReset()
})

describe('proof rules', () => {
  it('accepts images and PDF (by type, or by name when the type is missing) under 10MB', () => {
    expect(proofMime(jpg)).toBe('image/jpeg')
    expect(proofMime({ name: 'IMG_1.HEIC', type: '' })).toBe('image/heic')
    expect(proofMime({ name: 'x.docx', type: '' })).toBeNull()
    expect(proofMime({ name: 'x.gif', type: 'image/gif' })).toBeNull()
    expect(proofPath('p1', 'application/pdf', 'u1')).toBe('p1/u1.pdf')
    expect(proofError(pdf)).toBeNull()
    expect(proofError(big())).toBe('הקובץ גדול מ-10MB')
    expect(proofError(new File(['x'], 'a.docx', { type: 'application/msword' }))).toBe(P.errors.type)
  })
})

describe('the payment dialog', () => {
  it('offers an optional proof picker that takes the camera, gallery or a PDF', () => {
    const { container } = wrap(<PaymentForm apartmentId="a1" onDone={vi.fn()} />)
    expect(screen.getByText(P.label)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: P.attach })).toBeInTheDocument()
    const input = fileInput(container)
    expect(input.accept).toBe('image/*,application/pdf')
    expect(input.hasAttribute('capture')).toBe(false)
  })

  it('shows a preview of the picked image, and the proof can be removed before saving', async () => {
    const { container } = wrap(<PaymentForm apartmentId="a1" onDone={vi.fn()} />)
    pick(fileInput(container), jpg)
    expect(await screen.findByRole('img', { name: P.preview })).toHaveAttribute('src', 'blob:preview')
    expect(screen.getByText('העברה.jpg')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: P.removePicked }))
    expect(screen.queryByText('העברה.jpg')).toBeNull()
    expect(screen.getByRole('button', { name: P.attach })).toBeInTheDocument()
  })

  it('a PDF gets an icon preview', async () => {
    const { container } = wrap(<PaymentForm apartmentId="a1" onDone={vi.fn()} />)
    pick(fileInput(container), pdf)
    expect(await screen.findByLabelText(P.preview)).toBeInTheDocument()
    expect(screen.queryByRole('img', { name: P.preview })).toBeNull()
  })

  it('refuses a wrong type or an oversized file in Hebrew, and keeps nothing', async () => {
    const { container } = wrap(<PaymentForm apartmentId="a1" onDone={vi.fn()} />)
    pick(fileInput(container), new File(['MZ'], 'setup.exe', { type: 'application/x-msdownload' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(P.errors.type)
    pick(fileInput(container), big())
    expect(await screen.findByRole('alert')).toHaveTextContent('הקובץ גדול מ-10MB')
    expect(screen.queryByText('big.pdf')).toBeNull()
  })

  it('saves the payment, then uploads the proof into its folder and links it', async () => {
    const onDone = vi.fn()
    const { container } = wrap(<PaymentForm apartmentId="a1" onDone={onDone} />)
    fireEvent.change(screen.getByLabelText(new RegExp(he.finance.amount)), { target: { value: '300' } })
    pick(fileInput(container), jpg)
    fireEvent.click(screen.getByRole('button', { name: he.finance.recordPayment }))
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith(he.finance.paymentRecorded))
    expect(db.log[0]).toBe('insert:payments')
    expect(db.log[1]).toMatch(/^upload:p1\/[0-9a-f-]{36}\.jpg$/)
    expect(db.log[2]).toBe(`update:${JSON.stringify({ proof_path: db.log[1]?.slice('upload:'.length) })}`)
    expect(onDone).toHaveBeenCalled()
  })

  it('when the link fails, the payment stays, the uploaded file is removed and the admin is told', async () => {
    db.updateMissing = true
    const { container } = wrap(<PaymentForm apartmentId="a1" onDone={vi.fn()} />)
    fireEvent.change(screen.getByLabelText(new RegExp(he.finance.amount)), { target: { value: '300' } })
    pick(fileInput(container), pdf)
    fireEvent.click(screen.getByRole('button', { name: he.finance.recordPayment }))
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(P.failed))
    const uploaded = db.log[1]?.slice('upload:'.length)
    expect(db.log).toContain(`remove:${uploaded}`)
  })
})

describe('the payments list', () => {
  const rows = [
    { id: 'p1', apartment_id: 'a1', paid_on: '2026-10-05', amount: 300, method: 'transfer', note: '', is_special: false,
      proof_path: 'p1/0b9a54c4-3e1f-4b8e-9f0a-2c6d1e7f8a90.jpg' },
    { id: 'p2', apartment_id: 'a1', paid_on: '2026-10-04', amount: 200, method: 'cash', note: '', is_special: false, proof_path: null },
  ]

  it('a row with a proof shows the 📎 "אסמכתה" chip; one without offers to add it', async () => {
    db.tables.payments = rows
    wrap(<PaymentsTab adding={false} onAdd={vi.fn()} onAddingClose={vi.fn()} />)
    const chip = await screen.findByRole('button', { name: P.actions })
    expect(chip).toHaveTextContent(P.chip)
    expect(screen.getAllByRole('button', { name: P.actions })).toHaveLength(1)
    expect(screen.getAllByRole('button', { name: P.add })).toHaveLength(1)
    fireEvent.click(chip)
    for (const item of [P.view, P.replace, P.remove]) expect(await screen.findByRole('menuitem', { name: item, hidden: true })).toBeInTheDocument()
  })

  it('📎 opens the proof through a 60-second signed URL in a new tab', async () => {
    const win = { opener: {}, location: { href: '' }, close: vi.fn() }
    const open = vi.spyOn(window, 'open').mockReturnValue(win as unknown as Window)
    wrap(<ProofButton path="p1/x.pdf" />)
    fireEvent.click(screen.getByRole('button', { name: P.open }))
    await waitFor(() => expect(win.location.href).toBe('https://signed.example.test/p'))
    expect(db.log).toEqual(['sign:p1/x.pdf:60'])
    expect(win.opener).toBeNull()
    open.mockRestore()
  })

  it('replacing links the new file first, then removes the queued old one', async () => {
    db.tables.payment_proof_trash = [{ path: 'p1/old.jpg' }]
    wrap(<ProofControl payment={{ id: 'p1', proof_path: 'p1/old.jpg' }} />)
    pick(fileInput(document.body), pdf)
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith(P.saved))
    expect(db.log[0]).toMatch(/^upload:p1\/[0-9a-f-]{36}\.pdf$/)
    expect(db.log.slice(2)).toEqual(['remove:p1/old.jpg', 'delete:payment_proof_trash'])
  })

  it('removing asks first, unlinks, then removes the file', async () => {
    db.tables.payment_proof_trash = [{ path: 'p1/old.jpg' }]
    wrap(<ProofControl payment={{ id: 'p1', proof_path: 'p1/old.jpg' }} />)
    fireEvent.click(screen.getByRole('button', { name: P.actions }))
    fireEvent.click(await screen.findByRole('menuitem', { name: P.remove, hidden: true }))
    const dialog = await screen.findByRole('dialog', { name: P.removeConfirm })
    fireEvent.click(within(dialog).getByRole('button', { name: P.remove }))
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith(P.removed))
    expect(db.log).toEqual(['update:{"proof_path":null}', 'remove:p1/old.jpg', 'delete:payment_proof_trash'])
  })
})
