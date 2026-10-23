// @vitest-environment jsdom
import { MantineProvider } from '@mantine/core'
import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { he } from '../lib/he'
import { RequireAdmin, RequireApproved } from './Guard'
import type { AuthState, Profile } from './AuthProvider'

const auth = vi.hoisted(() => ({ current: null as unknown as AuthState }))
vi.mock('./AuthProvider', () => ({ useAuth: () => auth.current }))

function makeProfile(over: Partial<Profile>): Profile {
  return {
    user_id: 'u1',
    building_id: 'b1',
    full_name: 'דייר בדיקה',
    email: 'a@example.test',
    role: 'resident',
    status: 'approved',
    resident_id: null,
    ...over,
  } as Profile
}

const retry = vi.fn()

function setAuth(profile: Profile | null): void {
  auth.current = {
    session: profile ? ({ user: { id: 'u1' } } as AuthState['session']) : null,
    profile,
    isAdmin: profile?.role === 'admin',
    loading: false,
    error: null,
    retry,
    signOut: async () => undefined,
  }
}

function renderAt(path: string) {
  return render(
    <MantineProvider>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/login" element={<div>LOGIN</div>} />
          <Route path="/" element={<div>HOME</div>} />
          <Route element={<RequireApproved />}>
            <Route path="/finance" element={<div>FINANCE</div>} />
            <Route element={<RequireAdmin />}>
              <Route path="/users" element={<div>USERS</div>} />
            </Route>
          </Route>
        </Routes>
      </MemoryRouter>
    </MantineProvider>,
  )
}

describe('guards', () => {
  beforeEach(() => setAuth(null))

  it('redirects to /login without a session', () => {
    renderAt('/finance')
    expect(screen.getByText('LOGIN')).toBeInTheDocument()
  })

  it('shows the pending screen for pending users', () => {
    setAuth(makeProfile({ status: 'pending' }))
    renderAt('/finance')
    expect(screen.getByText(he.pendingApproval)).toBeInTheDocument()
    expect(screen.queryByText('FINANCE')).not.toBeInTheDocument()
  })

  it('shows an error screen with retry when the profile fails to load', () => {
    setAuth(makeProfile({}))
    auth.current = { ...auth.current, profile: null, error: 'boom' }
    renderAt('/finance')
    expect(screen.queryByText(he.pendingApproval)).not.toBeInTheDocument()
    fireEvent.click(screen.getByText(he.retry))
    expect(retry).toHaveBeenCalled()
  })

  it('sends an approved resident away from admin routes', () => {
    setAuth(makeProfile({}))
    renderAt('/users')
    expect(screen.getByText('HOME')).toBeInTheDocument()
  })

  it('renders admin routes for admins', () => {
    setAuth(makeProfile({ role: 'admin' }))
    renderAt('/users')
    expect(screen.getByText('USERS')).toBeInTheDocument()
  })
})
