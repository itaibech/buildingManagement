// @vitest-environment jsdom
import { MantineProvider } from '@mantine/core'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { he } from '../lib/he'
import { AuthProvider } from './AuthProvider'
import { RequireApproved, RequirePermission } from './Guard'

const m = vi.hoisted(() => ({ failPermissions: true, rpcCalls: 0 }))

vi.mock('../lib/supabase', () => {
  const profile = { user_id: 'u1', building_id: 'b1', role: 'resident', status: 'approved', full_name: 'דנה', group_id: null }
  const query = { select: () => query, eq: () => query, maybeSingle: () => Promise.resolve({ data: profile, error: null }) }
  return {
    supabase: {
      auth: {
        getSession: () => Promise.resolve({ data: { session: { user: { id: 'u1' } } } }),
        onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => undefined } } }),
      },
      from: () => query,
      rpc: () => {
        m.rpcCalls += 1
        return Promise.resolve(m.failPermissions
          ? { data: null, error: { message: 'boom' } }
          : { data: ['home', 'announcements', 'tickets'], error: null })
      },
    },
  }
})

function renderApp() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <MantineProvider>
      <QueryClientProvider client={client}>
        <AuthProvider>
          <MemoryRouter initialEntries={['/tickets']}>
            <Routes>
              <Route path="/" element={<div>HOME</div>} />
              <Route element={<RequireApproved />}>
                <Route element={<RequirePermission need="tickets" />}>
                  <Route path="/tickets" element={<div>TICKETS</div>} />
                </Route>
              </Route>
            </Routes>
          </MemoryRouter>
        </AuthProvider>
      </QueryClientProvider>
    </MantineProvider>,
  )
}

beforeEach(() => {
  m.failPermissions = true
  m.rpcCalls = 0
})

describe('AuthProvider permissions', () => {
  it('a failed my_permissions shows the load error with retry, not "no access"; retry recovers', async () => {
    renderApp()
    expect(await screen.findByText(he.permissions.loadError)).toBeInTheDocument()
    expect(screen.queryByText(he.permissions.noAccess)).toBeNull()
    m.failPermissions = false
    fireEvent.click(screen.getByRole('button', { name: he.retry }))
    expect(await screen.findByText('TICKETS')).toBeInTheDocument()
    expect(m.rpcCalls).toBe(2)
  })
})
