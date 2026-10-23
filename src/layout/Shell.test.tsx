// @vitest-environment jsdom
import { MantineProvider } from '@mantine/core'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router'
import { describe, expect, it, vi } from 'vitest'
import { theme } from '../ui/theme'
import Shell from './Shell'

const signOut = vi.hoisted(() => vi.fn(async () => undefined))
vi.mock('../auth/AuthProvider', () => ({
  useAuth: () => ({ signOut, profile: { resident_id: 'r1' }, isAdmin: false }),
}))
vi.mock('./useShellInfo', () => ({
  useShellInfo: () => ({ buildingName: 'הבניין שלי', apartmentNumber: 7 }),
}))

function renderShell() {
  return render(
    <MantineProvider theme={theme}>
      <MemoryRouter initialEntries={['/']}>
        <Routes>
          <Route path="/login" element={<div>LOGIN</div>} />
          <Route element={<Shell />}>
            <Route index element={<div>HOME</div>} />
          </Route>
        </Routes>
      </MemoryRouter>
    </MantineProvider>,
  )
}

describe('Shell', () => {
  it('shows the building name and the apartment plate', () => {
    renderShell()
    expect(screen.getAllByText('הבניין שלי').length).toBeGreaterThan(0)
    expect(screen.getAllByLabelText('דירה 7').length).toBeGreaterThan(0)
  })

  it('exit button signs out and lands on /login', async () => {
    renderShell()
    fireEvent.click(screen.getAllByRole('button', { name: 'יציאה' })[0])
    await waitFor(() => expect(screen.getByText('LOGIN')).toBeInTheDocument())
    expect(signOut).toHaveBeenCalled()
  })
})
