// @vitest-environment jsdom
import { MantineProvider } from '@mantine/core'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { he } from '../../lib/he'
import { theme } from '../../ui'
import { SignaturePad } from './SignaturePad'

const S = he.meetings.sign

describe('SignaturePad', () => {
  const ctx = { beginPath: vi.fn(), moveTo: vi.fn(), lineTo: vi.fn(), stroke: vi.fn(), clearRect: vi.fn(), scale: vi.fn(), setTransform: vi.fn(),
    lineWidth: 0, lineCap: '', lineJoin: '', strokeStyle: '' }
  beforeEach(() => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => ctx as unknown as CanvasRenderingContext2D)
    vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(function (cb: BlobCallback, type?: string) {
      cb(new Blob(['png'], { type: type ?? 'image/png' }))
    })
  })
  afterEach(() => vi.restoreAllMocks())

  const renderPad = (onSave = vi.fn()) => {
    render(<MantineProvider theme={theme}><SignaturePad onSave={onSave} saving={false} /></MantineProvider>)
    return { onSave, canvas: screen.getByRole('img', { name: S.pad }) }
  }

  it('refuses to save before anything is drawn', () => {
    const { onSave } = renderPad()
    fireEvent.click(screen.getByRole('button', { name: S.save }))
    expect(onSave).not.toHaveBeenCalled()
    expect(screen.getByText(S.empty)).toBeInTheDocument()
  })

  it('a drawn signature is saved as a PNG blob', async () => {
    const { onSave, canvas } = renderPad()
    fireEvent.pointerDown(canvas, { clientX: 10, clientY: 10, pointerId: 1 })
    fireEvent.pointerMove(canvas, { clientX: 40, clientY: 30, pointerId: 1 })
    fireEvent.pointerUp(canvas, { pointerId: 1 })
    expect(ctx.lineTo).toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: S.save }))
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1))
    const blob: unknown = onSave.mock.calls[0]?.[0]
    expect(blob).toBeInstanceOf(Blob)
    expect((blob as Blob).type).toBe('image/png')
  })

  it('clearing empties the pad again', () => {
    const { onSave, canvas } = renderPad()
    fireEvent.pointerDown(canvas, { clientX: 10, clientY: 10, pointerId: 1 })
    fireEvent.pointerMove(canvas, { clientX: 20, clientY: 20, pointerId: 1 })
    fireEvent.pointerUp(canvas, { pointerId: 1 })
    fireEvent.click(screen.getByRole('button', { name: S.clear }))
    expect(ctx.clearRect).toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: S.save }))
    expect(onSave).not.toHaveBeenCalled()
  })
})
