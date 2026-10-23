// @vitest-environment jsdom
import { MantineProvider } from '@mantine/core'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { describe, expect, it, vi } from 'vitest'
import { he } from '../lib/he'
import ResetPasswordPage from './ResetPasswordPage'

const m = vi.hoisted(() => ({
  session: { user: { id: 'u1' } } as unknown,
  endRecovery: vi.fn(),
  updateUser: vi.fn(async (_v: unknown) => ({ error: null })),
}))
vi.mock('./AuthProvider', () => ({ useAuth: () => ({ session: m.session, loading: false, endRecovery: m.endRecovery }) }))
vi.mock('../lib/supabase', () => ({ supabase: { auth: { updateUser: m.updateUser } } }))
vi.mock('../ui', async (orig) => ({ ...(await orig<typeof import('../ui')>()), notifySuccess: vi.fn() }))

const renderPage = () => render(<MantineProvider><MemoryRouter><ResetPasswordPage /></MemoryRouter></MantineProvider>)
const type = (label: string, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } })

describe('ResetPasswordPage', () => {
  it('checks length and match, then sets the new password and ends recovery', async () => {
    renderPage()
    type(he.reset.newPassword, 'short')
    type(he.reset.confirm, 'other')
    fireEvent.click(screen.getByRole('button', { name: he.reset.save }))
    expect(await screen.findByText(he.reset.tooShort)).toBeInTheDocument()
    expect(screen.getByText(he.reset.mismatch)).toBeInTheDocument()
    type(he.reset.newPassword, 'long-enough-1')
    type(he.reset.confirm, 'long-enough-1')
    fireEvent.click(screen.getByRole('button', { name: he.reset.save }))
    await waitFor(() => expect(m.updateUser).toHaveBeenCalledWith({ password: 'long-enough-1' }))
    expect(m.endRecovery).toHaveBeenCalled()
  })

  it('explains an expired link when there is no session', () => {
    m.session = null
    renderPage()
    expect(screen.getByText(he.reset.expired)).toBeInTheDocument()
  })
})
