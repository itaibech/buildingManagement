// @vitest-environment jsdom
import { MantineProvider } from '@mantine/core'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { he } from '../../lib/he'
import { theme } from '../../ui/theme'
import PermissionsPage from './PermissionsPage'

type Done = { onSuccess?: () => void; onError?: (e: unknown) => void }
const m = vi.hoisted(() => ({
  toggle: vi.fn((_args: unknown, opts?: { onSuccess?: () => void }) => opts?.onSuccess?.()),
  save: vi.fn(),
  remove: vi.fn(),
  setDefault: vi.fn(),
  success: vi.fn(),
}))

vi.mock('../../lib/supabase', () => ({ supabase: {} }))
vi.mock('./api', () => ({
  useGroups: () => ({
    data: [
      { id: 'g1', name: 'דייר', description: 'ברירת מחדל', isDefault: true, permissions: new Set(['announcements', 'tickets']) },
      { id: 'g2', name: 'רואה חשבון', description: '', isDefault: false, permissions: new Set(['finance_reports']) },
    ],
    isLoading: false, isError: false, refetch: vi.fn(),
  }),
  useTogglePermission: () => ({ mutate: m.toggle, isPending: false }),
  useSaveGroup: () => ({ mutate: (a: unknown, o?: Done) => { m.save(a); o?.onSuccess?.() }, isPending: false, isError: false }),
  useDeleteGroup: () => ({ mutate: (a: unknown, o?: Done) => { m.remove(a); o?.onSuccess?.() }, isPending: false, isError: false }),
  useSetDefaultGroup: () => ({ mutate: (a: unknown, o?: Done) => { m.setDefault(a); o?.onSuccess?.() }, isPending: false }),
  isNameTaken: () => false,
}))
vi.mock('../tenants/api', () => ({
  useProfiles: () => ({
    data: [
      { user_id: 'u1', role: 'resident', status: 'approved', group_id: null },
      { user_id: 'u2', role: 'resident', status: 'approved', group_id: 'g1' },
      { user_id: 'u3', role: 'resident', status: 'approved', group_id: 'g2' },
      { user_id: 'u4', role: 'admin', status: 'approved', group_id: null },
      { user_id: 'u5', role: 'resident', status: 'pending', group_id: null },
    ],
    isLoading: false, isError: false,
  }),
}))
vi.mock('../../ui/notify', () => ({ notifySuccess: m.success, notifyError: vi.fn(), notifyInfo: vi.fn() }))

const renderPage = () =>
  render(
    <MantineProvider theme={theme}>
      <MemoryRouter><PermissionsPage /></MemoryRouter>
    </MantineProvider>,
  )

const groupCard = (name: string) => screen.getByTestId(`group-${name}`)

beforeEach(() => {
  for (const f of Object.values(m)) f.mockClear()
})

describe('PermissionsPage', () => {
  it('lists the groups with member counts and the default badge, and states the confidentiality rule', () => {
    renderPage()
    expect(within(groupCard('דייר')).getByText(he.permissions.default)).toBeInTheDocument()
    // u1 (no group) + u2 are in the default group; admins and pending users are not counted.
    expect(within(groupCard('דייר')).getByText(he.permissions.members(2))).toBeInTheDocument()
    expect(within(groupCard('רואה חשבון')).getByText(he.permissions.members(1))).toBeInTheDocument()
    expect(screen.getByText(he.permissions.confidential)).toBeInTheDocument()
  })

  it('shows one toggle per catalog entry, home locked on', () => {
    renderPage()
    const home = screen.getByRole('switch', { name: /דף הבית/ })
    expect(home).toBeChecked()
    expect(home).toBeDisabled()
    expect(screen.getByRole('switch', { name: /^הודעות/ })).toBeChecked()
    expect(screen.getByRole('switch', { name: /^דיירים/ })).not.toBeChecked()
    expect(screen.getAllByRole('switch')).toHaveLength(9)
  })

  it('a toggle calls the mutation for that group and key, then confirms', () => {
    renderPage()
    fireEvent.click(screen.getByRole('switch', { name: /^דיירים/ }))
    expect(m.toggle).toHaveBeenCalledWith({ groupId: 'g1', key: 'directory', on: true }, expect.anything())
    fireEvent.click(screen.getByRole('switch', { name: /^תקלות/ }))
    expect(m.toggle).toHaveBeenLastCalledWith({ groupId: 'g1', key: 'tickets', on: false }, expect.anything())
    expect(m.success).toHaveBeenCalledWith(he.permissions.saved)
  })

  it('editing another group toggles that group; it can become the default or be deleted', async () => {
    renderPage()
    fireEvent.click(within(groupCard('רואה חשבון')).getByRole('button', { name: he.permissions.edit }))
    fireEvent.click(screen.getByRole('switch', { name: /^דוחות כספיים כלליים/ }))
    expect(m.toggle).toHaveBeenCalledWith({ groupId: 'g2', key: 'finance_reports', on: false }, expect.anything())
    fireEvent.click(screen.getByRole('button', { name: he.permissions.setDefault }))
    expect(m.setDefault).toHaveBeenCalledWith('g2')
    fireEvent.click(screen.getByRole('button', { name: he.permissions.delete }))
    fireEvent.click(await screen.findByRole('button', { name: he.permissions.deleteConfirm }))
    expect(m.remove).toHaveBeenCalledWith('g2')
  })

  it('the default group cannot be deleted', () => {
    renderPage()
    expect(screen.getByRole('button', { name: he.permissions.delete })).toBeDisabled()
    expect(screen.queryByRole('button', { name: he.permissions.setDefault })).not.toBeInTheDocument()
  })

  it('creates a new group with a name and description', async () => {
    renderPage()
    fireEvent.click(screen.getAllByRole('button', { name: he.permissions.newGroup })[0])
    fireEvent.change(await screen.findByLabelText(new RegExp(he.permissions.name)), { target: { value: 'חבר ועד צופה' } })
    fireEvent.change(screen.getByLabelText(he.permissions.description), { target: { value: 'צפייה בדוחות' } })
    fireEvent.click(screen.getByRole('button', { name: he.permissions.create }))
    expect(m.save).toHaveBeenCalledWith({ name: 'חבר ועד צופה', description: 'צפייה בדוחות' })
  })
})
