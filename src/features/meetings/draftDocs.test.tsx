// @vitest-environment jsdom
import { MantineProvider } from '@mantine/core'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { he } from '../../lib/he'
import { theme } from '../../ui'
import type { MeetingDocument } from './api'
import { meetingFixture } from './fixture'
import { ImportDraftDialog } from './ImportDraftDialog'
import { InviteDialog } from './InviteDialog'
import { MeetingDocuments } from './MeetingDocuments'
import { MeetingForm } from './MeetingForm'

const callMutate = vi.fn()
const docMutate = vi.fn()
const save = vi.fn()
let docs: MeetingDocument[] = []
vi.mock('./api', async (orig) => ({
  ...(await orig<typeof import('./api')>()),
  useMeetingCall: () => ({ mutate: callMutate, isPending: false, isError: false }),
  useSaveMeeting: () => ({ mutate: save, isPending: false, isError: false }),
  useMeetingDocuments: () => ({ data: docs }),
  useDocumentCall: () => ({ mutate: docMutate, isPending: false, isError: false }),
}))
vi.mock('../tenants/api', () => ({ useApartments: () => ({ data: [] }) }))
vi.mock('../../lib/supabase', () => ({ supabase: {} }))

const T = he.meetings.importDraft
const D = he.meetings.documents
const wrap = (node: ReactNode) => render(
  <MantineProvider theme={theme}><QueryClientProvider client={new QueryClient()}>{node}</QueryClientProvider></MantineProvider>,
)
const paste = (text: string) => fireEvent.change(screen.getByLabelText(T.text), { target: { value: text } })
const DRAFT = 'סדר היום\n\n1. אישור תקציב\nהצעת התקציב מצורפת.\n- רזרבה 10%\n2. בחירת ועד'

beforeEach(() => { callMutate.mockReset(); docMutate.mockReset(); save.mockReset(); docs = [] })
afterEach(cleanup)

describe('ImportDraftDialog', () => {
  it('shows the PDF hint and a live preview of the topics, then imports with the chosen mode', () => {
    const onImport = vi.fn()
    wrap(<ImportDraftDialog opened hasRows onClose={vi.fn()} onImport={onImport} />)
    expect(screen.getByText(T.pdfHint)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: T.docx })).toBeInTheDocument()
    paste(DRAFT)
    expect(screen.getByText(T.preview(2))).toBeInTheDocument()
    expect(screen.getByText('אישור תקציב')).toBeInTheDocument()
    expect(screen.getByText('בחירת ועד')).toBeInTheDocument()
    fireEvent.click(screen.getByText(T.replace))
    fireEvent.click(screen.getByRole('button', { name: T.confirm(2) }))
    expect(onImport).toHaveBeenCalledWith([
      { title: 'אישור תקציב', discussion: 'הצעת התקציב מצורפת.\n- רזרבה 10%' },
      { title: 'בחירת ועד', discussion: '' },
    ], 'replace')
  })

  it('refuses a .docx over 10 MB before reading it', () => {
    wrap(<ImportDraftDialog opened hasRows={false} onClose={vi.fn()} onImport={vi.fn()} />)
    const file = new File(['x'], 'big.docx')
    Object.defineProperty(file, 'size', { value: 10 * 1024 * 1024 + 1 })
    fireEvent.change(document.querySelector('input[type=file]') as HTMLInputElement, { target: { files: [file] } })
    expect(screen.getByText(T.docxTooBig)).toBeInTheDocument()
  })

  it('refuses text with no topics or with more than 30', () => {
    wrap(<ImportDraftDialog opened hasRows={false} onClose={vi.fn()} onImport={vi.fn()} />)
    paste('משפט אחד בלבד.')
    expect(screen.getByText(T.empty)).toBeInTheDocument()
    paste(Array.from({ length: 31 }, (_, i) => `${i + 1}. נושא ${i + 1}`).join('\n'))
    expect(screen.getByText(T.tooMany(31, 30))).toBeInTheDocument()
    expect(screen.getByRole('button', { name: T.confirm(31) })).toBeDisabled()
  })
})

describe('import in the meeting form', () => {
  it('appends the topics to the agenda rows without saving', async () => {
    const meeting = { ...meetingFixture(), status: 'draft' as const }
    wrap(<MeetingForm meeting={meeting} onDone={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: T.open }))
    await screen.findByLabelText(T.text)
    paste(DRAFT)
    fireEvent.click(screen.getByRole('button', { name: T.confirm(2) }))
    expect(save).not.toHaveBeenCalled()
    const titles = screen.getAllByRole('textbox', { name: /^נושא \d+$/ }).map((el) => (el as HTMLInputElement).value)
    expect(titles).toEqual(['אישור תקציב 2027', 'צביעת חדר המדרגות', 'שונות: חניה', 'אישור תקציב', 'בחירת ועד'])
    expect(screen.getByRole('textbox', { name: he.meetings.form.agendaDetails(4) })).toHaveValue('הצעת התקציב מצורפת.\n- רזרבה 10%')
  })
})

describe('MeetingDocuments', () => {
  const doc: MeetingDocument = { id: 'd1', file_path: 'm1/x.pdf', file_name: 'סדר יום.pdf', size_bytes: 2 * 1024 * 1024, created_at: '', url: 'https://signed/x' }

  it('lists documents with a download link; admins upload and remove while the meeting is open', async () => {
    docs = [doc]
    wrap(<MeetingDocuments meetingId="m1" status="invited" isAdmin />)
    expect(screen.getByRole('heading', { name: D.title })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: D.download('סדר יום.pdf') })).toHaveAttribute('href', 'https://signed/x')
    expect(screen.getByText('2.0 MB')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: D.upload })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: D.remove('סדר יום.pdf') }))
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: D.removeConfirm }))
    expect(docMutate).toHaveBeenCalled()
  })

  it('closed: upload yes, remove no; published: neither', () => {
    docs = [doc]
    const { unmount } = wrap(<MeetingDocuments meetingId="m1" status="closed" isAdmin />)
    expect(screen.getByRole('button', { name: D.upload })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: D.remove('סדר יום.pdf') })).not.toBeInTheDocument()
    unmount()
    wrap(<MeetingDocuments meetingId="m1" status="published" isAdmin />)
    expect(screen.queryByRole('button', { name: D.upload })).not.toBeInTheDocument()
  })

  it('residents: read-only links, nothing when there are none', () => {
    docs = [doc]
    const { unmount } = wrap(<MeetingDocuments meetingId="m1" status="published" isAdmin={false} />)
    expect(screen.getByRole('link', { name: D.download('סדר יום.pdf') })).toBeInTheDocument()
    expect(screen.queryAllByRole('button')).toHaveLength(0)
    unmount()
    docs = []
    wrap(<MeetingDocuments meetingId="m1" status="published" isAdmin={false} />)
    expect(screen.queryByText(D.title)).not.toBeInTheDocument()
  })

  it('refuses other file types before uploading', () => {
    wrap(<MeetingDocuments meetingId="m1" status="draft" isAdmin />)
    const input = document.querySelector('input[type=file]') as HTMLInputElement
    fireEvent.change(input, { target: { files: [new File(['x'], 'a.exe', { type: 'application/x-msdownload' })] } })
    expect(docMutate).not.toHaveBeenCalled()
    fireEvent.change(input, { target: { files: [new File([], 'empty.pdf', { type: 'application/pdf' })] } })
    expect(docMutate).not.toHaveBeenCalled()
    fireEvent.change(input, { target: { files: [new File(['x'], 'a.docx', { type: '' })] } })
    expect(docMutate).toHaveBeenCalled()
  })
})

describe('InviteDialog: topic details', () => {
  it('the details checkbox is off by default and is passed on', () => {
    const onSent = vi.fn()
    const meeting = { ...meetingFixture(), status: 'invited' as const }
    wrap(<InviteDialog opened meeting={meeting} mode="update" onClose={vi.fn()} onSent={onSent} />)
    const box = screen.getByRole('checkbox', { name: he.meetings.invite.details })
    expect(box).not.toBeChecked()
    fireEvent.click(box)
    fireEvent.click(screen.getByRole('button', { name: he.meetings.invite.sendUpdate }))
    expect(callMutate).toHaveBeenCalled()
    callMutate.mock.calls[0][1].onSuccess()
    expect(onSent).toHaveBeenCalledWith(false, true)
  })
})
