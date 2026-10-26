// @vitest-environment jsdom
import { MantineProvider } from '@mantine/core'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { he } from '../../lib/he'
import { theme } from '../../ui/theme'
import UsersPage from './UsersPage'

interface Call {
  table: string
  op: 'select' | 'update' | 'insert' | 'delete'
  values?: unknown
  filters: [string, unknown][]
}

const db = vi.hoisted(() => ({ calls: [] as Call[], rows: {} as Record<string, unknown[]>, invoked: [] as [string, unknown][] }))

vi.mock('../../lib/supabase', () => {
  function query(table: string) {
    const call: Call = { table, op: 'select', filters: [] }
    const q = {
      select: () => q,
      order: () => q,
      update: (values: unknown) => Object.assign(call, { op: 'update', values }) && q,
      eq: (col: string, val: unknown) => {
        call.filters.push([col, val])
        return q
      },
      then: (resolve: (r: { data: unknown; error: null }) => unknown) => {
        db.calls.push(call)
        return Promise.resolve(resolve({ data: call.op === 'select' ? (db.rows[table] ?? []) : null, error: null }))
      },
    }
    return q
  }
  const functions = { invoke: async (name: string, opts: { body: unknown }) => { db.invoked.push([name, opts.body]); return { data: name === 'admin-invite-user' ? { results: [{ email: 'd1@example.test', outcome: 'resent' }] } : { deleted: true }, error: null } } }
  const rpc = async (name: string) => ({ data: name === 'user_sign_in_status' ? [{ user_id: 'd1', invited_at: '2026-10-20', last_sign_in_at: null }, { user_id: 'a1', invited_at: '2026-10-01', last_sign_in_at: '2026-10-02' }] : null, error: null })
  return { supabase: { from: query, functions, rpc } }
})

vi.mock('../../auth/AuthProvider', () => ({ useAuth: () => ({ profile: { user_id: 'me' }, isAdmin: true }) }))

function profile(user_id: string, full_name: string, over: Record<string, unknown> = {}) {
  return {
    user_id, full_name, email: `${user_id}@example.test`, building_id: 'b1', role: 'resident',
    status: 'approved', resident_id: null, is_super_admin: false, created_at: '2026-10-01', ...over,
  }
}

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <MantineProvider theme={theme}>
      <QueryClientProvider client={client}>
        <UsersPage />
      </QueryClientProvider>
    </MantineProvider>,
  )
}

beforeEach(() => {
  db.calls = []
  db.invoked = []
  db.rows = {
    profiles: [
      profile('p1', 'נועה ממתינה', { status: 'pending' }),
      profile('s1', 'ראש הוועד', { role: 'admin', is_super_admin: true }),
      profile('a1', 'מנהל נוסף', { role: 'admin' }),
      profile('me', 'אני המנהל', { role: 'admin' }),
      profile('d1', 'דייר רגיל', { group_id: null }),
    ],
    user_groups: [
      { id: 'g1', name: 'דייר', description: '', is_default: true, group_permissions: [] },
      { id: 'g2', name: 'רואה חשבון', description: '', is_default: false, group_permissions: [] },
    ],
    apartments: [{ id: 'apt7', number: 7, floor: 3, notes: null, building_id: 'b1', created_at: '' }],
    residents: [{ id: 'r1', apartment_id: 'apt7', full_name: 'נועה ממתינה', phone: null, email: null, is_owner: true, building_id: 'b1', created_at: '' }],
  }
})

// Mantine's Select scrolls the selected option into view; jsdom has no scrollIntoView.
Element.prototype.scrollIntoView ??= () => undefined

async function pick(select: HTMLElement, option: string): Promise<void> {
  fireEvent.click(select)
  const listbox = await waitFor(() => {
    const el = document.getElementById(select.getAttribute('aria-controls') ?? '')
    if (!el) throw new Error('listbox not open')
    return el
  })
  fireEvent.click(within(listbox).getByRole('option', { name: option, hidden: true }))
}

const lastUpdate = () => db.calls.filter((c) => c.table === 'profiles' && c.op === 'update').at(-1)

describe('UsersPage groups', () => {
  it('approving a resident puts them in the default group (stored as null, so they follow default changes)', async () => {
    renderPage()
    const row = await screen.findByTestId('pending-p1')
    const group = await within(row).findByLabelText(he.permissions.group)
    expect(group).toHaveValue('דייר')
    fireEvent.click(within(row).getByRole('button', { name: he.users.approve }))
    await waitFor(() => expect(lastUpdate()?.values).toEqual({ status: 'approved', resident_id: null, role: 'resident', group_id: null }))
  })

  it('the approval can pick another group', async () => {
    renderPage()
    const row = await screen.findByTestId('pending-p1')
    await pick(await within(row).findByLabelText(he.permissions.group), 'רואה חשבון')
    fireEvent.click(within(row).getByRole('button', { name: he.users.approve }))
    await waitFor(() => expect(lastUpdate()?.values).toMatchObject({ group_id: 'g2' }))
  })

  it('an approved resident shows their group and can be moved to another', async () => {
    renderPage()
    const row = await screen.findByTestId('user-d1')
    expect(await within(row).findByText(/דייר · ללא שיוך · קבוצה: דייר/)).toBeInTheDocument()
    fireEvent.click(within(row).getByRole('button', { name: he.users.edit }))
    await pick(within(row).getByLabelText(he.permissions.group), 'רואה חשבון')
    await waitFor(() => expect(lastUpdate()).toEqual({ table: 'profiles', op: 'update', values: { group_id: 'g2' }, filters: [['user_id', 'd1']] }))
  })

  it('an admin can rename a user (e.g. to Hebrew); saved on blur, trimmed, and an unchanged name is not saved', async () => {
    renderPage()
    const row = await screen.findByTestId('user-d1')
    fireEvent.click(within(row).getByRole('button', { name: he.users.edit }))
    const name = within(row).getByLabelText(he.users.nameLabel)
    fireEvent.blur(name)
    expect(lastUpdate()).toBeUndefined()
    fireEvent.change(name, { target: { value: '  איתי בכור  ' } })
    fireEvent.blur(name)
    await waitFor(() => expect(lastUpdate()).toEqual({ table: 'profiles', op: 'update', values: { full_name: 'איתי בכור' }, filters: [['user_id', 'd1']] }))
  })

  it('moving a user to the default group stores null', async () => {
    db.rows.profiles = [...(db.rows.profiles ?? []), profile('d2', 'דיירת בקבוצה', { group_id: 'g2' })]
    renderPage()
    const row = await screen.findByTestId('user-d2')
    fireEvent.click(within(row).getByRole('button', { name: he.users.edit }))
    await pick(within(row).getByLabelText(he.permissions.group), 'דייר')
    await waitFor(() => expect(lastUpdate()).toEqual({ table: 'profiles', op: 'update', values: { group_id: null }, filters: [['user_id', 'd2']] }))
  })

  it('admins have no group select (they see everything)', async () => {
    renderPage()
    const row = await screen.findByTestId('user-a1')
    fireEvent.click(within(row).getByRole('button', { name: he.users.edit }))
    expect(within(row).queryByLabelText(he.permissions.group)).toBeNull()
  })
})

describe('UsersPage', () => {
  it('lists pending profiles and approves with the chosen resident and role', async () => {
    renderPage()
    const row = await screen.findByTestId('pending-p1')
    expect(within(row).getByText('נועה ממתינה')).toBeInTheDocument()

    const select = within(row).getByLabelText(he.users.linkResident)
    fireEvent.click(select)
    const listbox = await waitFor(() => {
      const el = document.getElementById(select.getAttribute('aria-controls') ?? '')
      if (!el) throw new Error('listbox not open')
      return el
    })
    fireEvent.click(within(listbox).getByRole('option', { name: he.users.residentOption(7, 'נועה ממתינה'), hidden: true }))
    fireEvent.click(within(row).getByText(he.users.roleAdmin))
    fireEvent.click(within(row).getByRole('button', { name: he.users.approve }))

    await waitFor(() => {
      const update = db.calls.find((c) => c.table === 'profiles' && c.op === 'update')
      expect(update).toEqual({
        table: 'profiles',
        op: 'update',
        values: { status: 'approved', resident_id: 'r1', role: 'admin', group_id: null },
        filters: [['user_id', 'p1']],
      })
    })
  })

  it('marks the super admin and disables its role and approval controls', async () => {
    renderPage()
    const row = await screen.findByTestId('user-s1')
    expect(within(row).getByText(he.users.superAdmin)).toBeInTheDocument()
    expect(within(row).queryByRole('radio')).toBeNull()
    fireEvent.click(within(row).getByRole('button', { name: he.users.edit }))
    expect(within(row).getByRole('radio', { name: he.users.roleResident })).toBeDisabled()
    expect(within(row).getByRole('button', { name: he.users.block })).toBeDisabled()
  })

  it('lets an admin demote another admin with the role toggle', async () => {
    renderPage()
    const row = await screen.findByTestId('user-a1')
    fireEvent.click(within(row).getByRole('button', { name: he.users.edit }))
    const toResident = within(row).getByRole('radio', { name: he.users.roleResident })
    expect(toResident).toBeEnabled()
    fireEvent.click(toResident)
    await waitFor(() => {
      const update = db.calls.find((c) => c.table === 'profiles' && c.op === 'update')
      expect(update?.values).toEqual({ role: 'resident' })
      expect(update?.filters).toEqual([['user_id', 'a1']])
    })
  })
})

describe('UsersPage delete user', () => {
  const openMenu = async (id: string, name: string) => {
    const row = await screen.findByTestId(`user-${id}`)
    fireEvent.click(within(row).getByRole('button', { name: he.users.actions(name) }))
    return screen.findByRole('menuitem', { name: new RegExp(he.users.deleteUser) })
  }

  it('the delete option is disabled for yourself and for the super admin', async () => {
    renderPage()
    expect(await openMenu('me', 'אני המנהל')).toBeDisabled()
    expect(screen.getByText(he.users.cannotDeleteSelf)).toBeInTheDocument()
    fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' })
    expect(await openMenu('s1', 'ראש הוועד')).toBeDisabled()
  })

  it('confirms, then calls admin-delete-user (keeping the resident unless ticked)', async () => {
    db.rows.profiles = [...db.rows.profiles, profile('r9', 'דיירת מקושרת', { resident_id: 'r1' })]
    renderPage()
    fireEvent.click(await openMenu('r9', 'דיירת מקושרת'))
    expect(await screen.findByText(he.users.deleteUserBody('דיירת מקושרת'))).toBeInTheDocument()
    fireEvent.click(screen.getByRole('checkbox', { name: new RegExp(he.users.alsoRemoveResident) }))
    fireEvent.click(screen.getByRole('button', { name: he.users.deleteUser }))
    await waitFor(() => expect(db.invoked).toEqual([['admin-delete-user', { userId: 'r9', removeResident: true }]]))
  })

  it('marks invited users who never signed in, and resends their invite', async () => {
    renderPage()
    const row = await screen.findByTestId('user-d1')
    expect(await within(row).findByText(he.users.invitedBadge)).toBeInTheDocument()
    expect(within(screen.getByTestId('user-a1')).queryByText(he.users.invitedBadge)).toBeNull()
    fireEvent.click(within(row).getByRole('button', { name: he.users.resend }))
    await waitFor(() => expect(db.invoked).toEqual([['admin-invite-user', { invites: [{ email: 'd1@example.test' }], groupId: null }]]))
  })

  it('opens the invite dialog from the header', async () => {
    renderPage()
    await screen.findByTestId('user-d1')
    fireEvent.click(screen.getAllByRole('button', { name: he.invite.open })[0] as HTMLElement)
    expect(await screen.findByText(he.invite.title)).toBeInTheDocument()
  })
})
