// @vitest-environment jsdom
import { MantineProvider } from '@mantine/core'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { useState, type ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { proofError, PROOF_ACCEPT } from '../features/finance/ledger'
import { he } from '../lib/he'
import { paste } from '../test/paste'
import { clipboardFile, matchesAccept, usePasteFile } from './paste'
import { PasteButton, PasteHint } from './PasteButton'
import { theme } from './theme'

const info = vi.hoisted(() => vi.fn())
vi.mock('./notify', () => ({ notifyInfo: info, notifyError: vi.fn(), notifySuccess: vi.fn() }))

const wrap = (node: ReactNode) => render(<MantineProvider theme={theme}>{node}</MantineProvider>)
const png = (name = 'image.png') => new File(['png'], name, { type: 'image/png' })

/** A field like the payment proof's: the picker's own check decides, and shows its Hebrew error. */
function Field({ label, onPicked }: { label: string; onPicked: (f: File) => void }) {
  const [error, setError] = useState<string | null>(null)
  const pick = (f: File) => { const err = proofError(f); setError(err); if (!err) onPicked(f) }
  const ref = usePasteFile({ accept: PROOF_ACCEPT, onFile: pick })
  return (
    <div ref={ref}>
      <button type="button">{label}</button>
      {error && <p role="alert">{error}</p>}
    </div>
  )
}

describe('clipboardFile / matchesAccept', () => {
  afterEach(() => vi.restoreAllMocks())
  it('names a nameless or generic clipboard image clipboard-<timestamp>.<ext>, with its MIME type', () => {
    vi.spyOn(Date, 'now').mockReturnValue(1730700000000)
    expect(clipboardFile(new Blob(['x'], { type: 'image/png' })).name).toBe('clipboard-1730700000000.png')
    const jpg = clipboardFile(new Blob(['x'], { type: 'image/jpeg' }), 'image.jpg')
    expect([jpg.name, jpg.type]).toEqual(['clipboard-1730700000000.jpg', 'image/jpeg'])
    expect(clipboardFile(new File(['x'], 'חוזה.pdf', { type: 'application/pdf' }), 'חוזה.pdf').name).toBe('חוזה.pdf')
  })
  it('matches an accept list by MIME, wildcard and extension', () => {
    expect(matchesAccept(png(), 'image/*,application/pdf')).toBe(true)
    expect(matchesAccept(new File(['x'], 'a.docx'), '.docx')).toBe(true)
    expect(matchesAccept(new File(['x'], 'a.txt', { type: 'text/plain' }), 'image/*,application/pdf')).toBe(false)
  })
})

describe('usePasteFile', () => {
  it('attaches a pasted image to the only attach field, named and typed', () => {
    const onPicked = vi.fn()
    wrap(<Field label="a" onPicked={onPicked} />)
    const event = paste(document.body, { files: [png()] })
    expect(event.defaultPrevented).toBe(true)
    const file = onPicked.mock.calls[0][0] as File
    expect(file.name).toMatch(/^clipboard-\d+\.png$/)
    expect(file.type).toBe('image/png')
  })
  it('leaves a text-only paste alone', () => {
    const onPicked = vi.fn()
    wrap(<Field label="a" onPicked={onPicked} />)
    expect(paste(document.body, { text: 'hello' }).defaultPrevented).toBe(false)
    expect(onPicked).not.toHaveBeenCalled()
  })
  it('lets text be pasted into a text input even when the clipboard also holds an image', () => {
    const onPicked = vi.fn()
    wrap(<><input aria-label="note" /><Field label="a" onPicked={onPicked} /></>)
    expect(paste(screen.getByLabelText('note'), { text: 'x', files: [png()] }).defaultPrevented).toBe(false)
    expect(onPicked).not.toHaveBeenCalled()
  })
  it('a screenshot pasted while a text input has focus still attaches', () => {
    const onPicked = vi.fn()
    wrap(<><input aria-label="note" /><Field label="a" onPicked={onPicked} /></>)
    paste(screen.getByLabelText('note'), { files: [png()] })
    expect(onPicked).toHaveBeenCalledTimes(1)
  })
  it("shows the picker's Hebrew error for a wrong type or a too-large file", () => {
    const onPicked = vi.fn()
    wrap(<Field label="a" onPicked={onPicked} />)
    act(() => { paste(document.body, { files: [new File(['x'], 'a.txt', { type: 'text/plain' })] }) })
    expect(screen.getByRole('alert')).toHaveTextContent(he.finance.proof.errors.type)
    act(() => { paste(document.body, { files: [new File([new Uint8Array(11 * 1024 * 1024)], 'big.png', { type: 'image/png' })] }) })
    expect(screen.getByRole('alert')).toHaveTextContent(he.finance.proof.errors.size)
    expect(onPicked).not.toHaveBeenCalled()
  })
  it('with two fields, only the focused one takes the paste; unfocused, neither does', () => {
    const a = vi.fn()
    const b = vi.fn()
    wrap(<><Field label="a" onPicked={a} /><Field label="b" onPicked={b} /></>)
    paste(document.body, { files: [png()] })
    paste(screen.getByRole('button', { name: 'b' }), { files: [png()] })
    expect([a.mock.calls.length, b.mock.calls.length]).toEqual([0, 1])
  })
  it("a dialog's only field takes pastes inside that dialog, not the page's", () => {
    const page = vi.fn()
    const dialog = vi.fn()
    wrap(<><Field label="page" onPicked={page} /><div role="dialog"><input aria-label="amount" /><Field label="d" onPicked={dialog} /></div></>)
    paste(screen.getByLabelText('amount'), { files: [png()] })
    expect([page.mock.calls.length, dialog.mock.calls.length]).toEqual([0, 1])
  })
})

describe('PasteButton', () => {
  const setClipboard = (value: unknown) => Object.defineProperty(navigator, 'clipboard', { value, configurable: true })
  const click = () => fireEvent.click(screen.getByRole('button', { name: he.paste.button }))
  beforeEach(() => info.mockReset())
  afterEach(() => setClipboard(undefined))

  it('supported: reads the first image from the clipboard and hands it over as a named file', async () => {
    const blob = new Blob(['png'], { type: 'image/png' })
    setClipboard({ read: vi.fn().mockResolvedValue([{ types: ['text/plain', 'image/png'], getType: vi.fn().mockResolvedValue(blob) }]) })
    const onFile = vi.fn()
    wrap(<PasteButton onFile={onFile} />)
    click()
    await waitFor(() => expect(onFile).toHaveBeenCalled())
    expect((onFile.mock.calls[0][0] as File).name).toMatch(/^clipboard-\d+\.png$/)
    expect(info).not.toHaveBeenCalled()
  })
  it('unsupported: hints at Ctrl+V', () => {
    setClipboard(undefined)
    wrap(<PasteButton onFile={vi.fn()} />)
    click()
    expect(info).toHaveBeenCalledWith(he.paste.desktopHint)
  })
  it('permission denied, or no image: hints at Ctrl+V and attaches nothing', async () => {
    setClipboard({ read: vi.fn().mockRejectedValue(new DOMException('denied', 'NotAllowedError')) })
    const onFile = vi.fn()
    wrap(<PasteButton onFile={onFile} />)
    click()
    await waitFor(() => expect(info).toHaveBeenCalledWith(he.paste.desktopHint))
    setClipboard({ read: vi.fn().mockResolvedValue([{ types: ['text/plain'], getType: vi.fn() }]) })
    click()
    await waitFor(() => expect(info).toHaveBeenCalledTimes(2))
    expect(onFile).not.toHaveBeenCalled()
  })
  it('the field hint shows on desktop', () => {
    wrap(<PasteHint />)
    expect(screen.getByText(he.paste.fieldHint)).toBeInTheDocument()
  })
})
