// @vitest-environment jsdom
import { MantineProvider } from '@mantine/core'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { he } from '../lib/he'
import LoginPage from './LoginPage'

vi.mock('./AuthProvider', () => ({ useAuth: () => ({ session: null }) }))
const reset = vi.hoisted(() => vi.fn(async (_email: string, _opts: unknown) => ({ error: null })))
vi.mock('../lib/supabase', () => ({ supabase: { auth: { resetPasswordForEmail: reset } } }))

function renderLogin() {
  return render(
    <MantineProvider>
      <MemoryRouter>
        <LoginPage />
      </MemoryRouter>
    </MantineProvider>,
  )
}

function mockSettings(impl: () => Promise<unknown>): void {
  vi.stubGlobal('fetch', vi.fn(impl))
}

afterEach(() => vi.unstubAllGlobals())

describe('Google button', () => {
  it('shows when Google is enabled', async () => {
    mockSettings(async () => ({ json: async () => ({ external: { google: true } }) }))
    renderLogin()
    expect(await screen.findByText(he.signInWithGoogle)).toBeInTheDocument()
  })

  it('is hidden when Google is disabled', async () => {
    mockSettings(async () => ({ json: async () => ({ external: { google: false } }) }))
    renderLogin()
    await waitFor(() => expect(fetch).toHaveBeenCalled())
    expect(screen.queryByText(he.signInWithGoogle)).not.toBeInTheDocument()
  })

  it('is hidden when the settings fetch fails', async () => {
    mockSettings(async () => {
      throw new Error('network')
    })
    renderLogin()
    await waitFor(() => expect(fetch).toHaveBeenCalled())
    expect(screen.queryByText(he.signInWithGoogle)).not.toBeInTheDocument()
  })
})

describe('forgot password', () => {
  it('sends a reset link and says what to do when no mail arrives', async () => {
    mockSettings(async () => ({ json: async () => ({ external: { google: false } }) }))
    renderLogin()
    fireEvent.click(screen.getByRole('button', { name: he.reset.forgot }))
    expect(screen.queryByLabelText(he.password)).not.toBeInTheDocument()
    const email = screen.getByLabelText(new RegExp(he.email))
    expect(email.closest('[dir="ltr"]')).not.toBeNull()
    fireEvent.change(email, { target: { value: 'a@b.test' } })
    fireEvent.click(screen.getByRole('button', { name: he.reset.send }))
    expect(await screen.findByText(he.reset.noMail)).toBeInTheDocument()
    expect(reset).toHaveBeenCalledWith('a@b.test', expect.objectContaining({ redirectTo: expect.any(String) }))
  })
})
