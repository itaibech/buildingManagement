// @vitest-environment jsdom
import { MantineProvider } from '@mantine/core'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type { ReactNode } from 'react'
import { MemoryRouter } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { formatILS } from '../../lib/format'
import { he } from '../../lib/he'
import { ApartmentTags } from '../../ui'
import { theme } from '../../ui/theme'
import { currentMonth } from '../finance/feeTimeline'
import { ApartmentForm } from './ApartmentForm'
import { toApartmentInput, type FormValues } from './formValues'
import { toSaveApartmentArgs, type Apartment } from './api'

const db = vi.hoisted(() => ({
  tables: {} as Record<string, unknown[]>,
  rpcs: [] as { name: string; args: unknown }[],
  /** Runs on each rpc call, to change what the next queries return. */
  onRpc: (() => undefined) as (name: string) => void,
}))

vi.mock('../../lib/supabase', () => {
  // Every query method returns the same builder; awaiting it yields that table's rows.
  const builder = (table: string): unknown => {
    const result = () => Promise.resolve({ data: db.tables[table] ?? [], error: null })
    return new Proxy({}, {
      get: (_t, key) => (key === 'then' ? (ok: (v: unknown) => unknown) => result().then(ok) : () => builder(table)),
    })
  }
  return {
    supabase: {
      from: (table: string) => builder(table),
      rpc: (name: string, args: unknown) => {
        db.rpcs.push({ name, args })
        db.onRpc(name)
        return Promise.resolve({ data: name === 'set_apartment_fee' ? true : 'apt-new', error: null })
      },
    },
  }
})

const APT: Apartment = {
  id: 'apt1', building_id: 'b1', number: 4, floor: 2, notes: null, created_at: '2026-01-01',
  is_committee: false, archived_at: null,
}

function wrap(node: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <MantineProvider theme={theme}>
      <QueryClientProvider client={client}><MemoryRouter>{node}</MemoryRouter></QueryClientProvider>
    </MantineProvider>,
  )
}

const F = he.tenants.form
const type = (label: string, value: string) => fireEvent.change(screen.getByLabelText(label, { exact: false }), { target: { value } })

// jsdom has no scrollIntoView; Mantine's Select calls it when its list opens.
Element.prototype.scrollIntoView ??= () => undefined

beforeEach(() => {
  db.rpcs = []
  db.onRpc = () => undefined
  db.tables = { fee_schedule: [{ id: 'f1', effective_from: '2026-01-01', amount: 390 }] }
})

describe('ApartmentForm', () => {
  it('requires an apartment number above 0', async () => {
    wrap(<ApartmentForm onDone={() => undefined} />)
    await screen.findByLabelText(he.tenants.number, { exact: false })
    type(he.tenants.number, '0')
    fireEvent.click(await screen.findByRole('button', { name: he.tenants.save }))
    expect(await screen.findByText(he.tenants.errors.number)).toBeInTheDocument()
    expect(db.rpcs).toHaveLength(0)
  })

  it('shows the building rate as the fee placeholder', async () => {
    wrap(<ApartmentForm onDone={() => undefined} />)
    const fee = await screen.findByLabelText(F.fee, { exact: false })
    expect(fee).toHaveAttribute('placeholder', F.feePlaceholder(formatILS(390)))
  })

  it('shows the EV initial reading only while the charger box is checked', async () => {
    wrap(<ApartmentForm onDone={() => undefined} />)
    const box = await screen.findByLabelText(F.ev)
    expect(screen.queryByLabelText(F.evInitial, { exact: false })).not.toBeInTheDocument()
    fireEvent.click(box)
    expect(screen.getByLabelText(F.evInitial, { exact: false })).toBeInTheDocument()
    fireEvent.click(box)
    expect(screen.queryByLabelText(F.evInitial, { exact: false })).not.toBeInTheDocument()
  })

  it('disables the fee field for a committee representative', async () => {
    wrap(<ApartmentForm onDone={() => undefined} />)
    const fee = await screen.findByLabelText(F.fee, { exact: false })
    expect(fee).toBeEnabled()
    fireEvent.click(screen.getByLabelText(F.committee))
    expect(fee).toBeDisabled()
    expect(screen.getByText(F.committeeHint)).toBeInTheDocument()
  })

  it('shows the standing order month only for "הוראת קבע"', async () => {
    wrap(<ApartmentForm onDone={() => undefined} />)
    fireEvent.click(await screen.findByText(F.methods.standing_order))
    expect(screen.getByText(F.standingFrom)).toBeInTheDocument()
    expect(screen.getByText(F.standingScope)).toBeInTheDocument()
  })

  it('saves everything through save_apartment', async () => {
    const onDone = vi.fn()
    wrap(<ApartmentForm onDone={onDone} />)
    await screen.findByLabelText(he.tenants.number, { exact: false })
    type(he.tenants.number, '8')
    type(F.fee, '450')
    fireEvent.click(screen.getByText(F.methods.standing_order))
    fireEvent.click(screen.getByLabelText(F.ev))
    type(F.evInitial, '12.5')
    fireEvent.click(screen.getByRole('button', { name: he.tenants.save }))
    await waitFor(() => expect(onDone).toHaveBeenCalled())
    expect(db.rpcs).toEqual([{ name: 'save_apartment', args: {
      p_number: 8, p_fee: 450, p_is_committee: false, p_payment_method: 'standing_order',
      p_standing_order_from: currentMonth(), p_ev: true, p_ev_initial: 12.5,
    } }])
  })

  it('locks the charger box when the apartment already has one, with a link to it', async () => {
    db.tables.ev_chargers = [{ id: 'ch1', apartment_id: 'apt1', label: 'x', initial_reading: 0, active: true, apartments: { number: 4 } }]
    wrap(<ApartmentForm apartment={APT} onDone={() => undefined} />)
    const box = await screen.findByLabelText(F.ev)
    await waitFor(() => expect(box).toBeChecked())
    expect(box).toBeDisabled()
    expect(screen.getByRole('link', { name: F.evManage })).toHaveAttribute('href', '/ev/ch1')
  })

  it('restores the pre-exemption fee when the committee box is unchecked', async () => {
    db.tables.apartment_balances = [{ apartment_id: 'apt1', balance: 0, scheduled_charges: 0, current_fee: 0, current_fee_mode: 'exempt' }]
    db.tables.apartment_fee_overrides = [
      { id: 't2', apartment_id: 'apt1', effective_from: '2026-02-01', mode: 'exempt', amount: null },
      { id: 't1', apartment_id: 'apt1', effective_from: '2026-01-01', mode: 'custom', amount: 300 },
    ]
    db.tables.apartments = [{ ...APT, is_committee: true }]
    wrap(<ApartmentForm apartment={{ ...APT, is_committee: true }} onDone={() => undefined} />)
    const box = await screen.findByLabelText(F.committee)
    expect(box).toBeChecked()
    fireEvent.click(box)
    await waitFor(() => expect(screen.getByLabelText(F.fee, { exact: false })).toHaveValue('₪300'))
  })
})

describe('ApartmentForm with saved data', () => {
  const custom = (fee: number) => [{ apartment_id: 'apt1', balance: 0, scheduled_charges: 0, current_fee: fee, current_fee_mode: 'custom' }]
  beforeEach(() => {
    db.tables.apartments = [APT]
    db.tables.apartment_balances = custom(300)
    db.tables.apartment_fee_overrides = [{ id: 't1', apartment_id: 'apt1', effective_from: '2026-01-01', mode: 'custom', amount: 300 }]
  })

  it('keeps a change made in the fee history sheet when the form is saved', async () => {
    db.onRpc = (name) => {
      if (name === 'set_apartment_fee') db.tables.apartment_balances = custom(450)
    }
    const onDone = vi.fn()
    wrap(<ApartmentForm apartment={APT} onDone={onDone} />)
    await waitFor(() => expect(screen.getByLabelText(F.fee, { exact: false })).toHaveValue('₪300'))
    fireEvent.click(screen.getByRole('button', { name: F.feeHistory }))
    const sheet = await screen.findByRole('dialog', { name: he.fees.open(4) })
    fireEvent.click(within(sheet).getByRole('button', { name: he.fees.change }))
    fireEvent.change(within(sheet).getByLabelText(he.fees.amount, { exact: false }), { target: { value: '450' } })
    fireEvent.click(within(sheet).getByRole('button', { name: he.fees.save }))
    await waitFor(() => expect(screen.getByLabelText(F.fee, { exact: false })).toHaveValue('₪450'))
    fireEvent.click(within(sheet).getByRole('button', { name: he.close }))
    fireEvent.click(screen.getByRole('button', { name: he.tenants.save }))
    await waitFor(() => expect(onDone).toHaveBeenCalled())
    const saves = db.rpcs.filter((r) => r.name === 'save_apartment')
    expect(saves).toHaveLength(1)
    expect(saves[0]?.args).toMatchObject({ p_fee: 450 })
  })

  it('keeps an unsaved committee choice when the sheet refreshes the fee', async () => {
    db.onRpc = (name) => {
      if (name === 'set_apartment_fee') db.tables.apartment_balances = custom(450)
    }
    wrap(<ApartmentForm apartment={APT} onDone={() => undefined} />)
    await waitFor(() => expect(screen.getByLabelText(F.fee, { exact: false })).toHaveValue('₪300'))
    fireEvent.click(screen.getByLabelText(F.committee))
    fireEvent.click(screen.getByRole('button', { name: F.feeHistory }))
    const sheet = await screen.findByRole('dialog', { name: he.fees.open(4) })
    fireEvent.click(within(sheet).getByRole('button', { name: he.fees.change }))
    fireEvent.change(within(sheet).getByLabelText(he.fees.amount, { exact: false }), { target: { value: '450' } })
    fireEvent.click(within(sheet).getByRole('button', { name: he.fees.save }))
    await waitFor(() => expect(screen.getByLabelText(F.fee, { exact: false })).toHaveValue('₪450'))
    expect(screen.getByLabelText(F.committee)).toBeChecked()
  })

  it('reads the payment method from apartment_billing and warns when the standing order moves later', async () => {
    db.tables.apartment_billing = [{ apartment_id: 'apt1', payment_method: 'standing_order', standing_order_from: '2026-01-01' }]
    wrap(<ApartmentForm apartment={APT} onDone={() => undefined} />)
    expect(await screen.findByText(F.standingFrom)).toBeInTheDocument()
    expect(screen.queryByText(F.standingLater)).not.toBeInTheDocument()
    const year = screen.getAllByLabelText(he.finance.year).find((el) => el.getAttribute('aria-haspopup') === 'listbox') as HTMLElement
    fireEvent.click(year)
    const listbox = await waitFor(() => {
      const el = document.getElementById(year.getAttribute('aria-controls') ?? '')
      if (!el) throw new Error('listbox not open')
      return el
    })
    fireEvent.click(within(listbox).getByRole('option', { name: '2027', hidden: true }))
    expect(await screen.findByText(F.standingLater)).toBeInTheDocument()
  })
})

describe('save_apartment payload', () => {
  const values: FormValues = {
    number: 3, floor: '', notes: '  ', fee: '', isCommittee: true, paymentMethod: 'manual',
    standingOrderFrom: '2026-05-01', ev: false, evInitial: 7,
  }

  it('omits empty optional values and the standing order month for manual payment', () => {
    expect(toSaveApartmentArgs(toApartmentInput(values, 'apt1'))).toEqual({
      p_id: 'apt1', p_number: 3, p_is_committee: true, p_payment_method: 'manual', p_ev: false, p_ev_initial: 0,
    })
  })

  it('maps floor, notes, fee, standing order month and the initial reading', () => {
    const v: FormValues = { ...values, floor: 2, notes: ' ליד המעלית ', fee: 410, isCommittee: false, paymentMethod: 'standing_order', ev: true }
    expect(toSaveApartmentArgs(toApartmentInput(v))).toEqual({
      p_number: 3, p_floor: 2, p_notes: 'ליד המעלית', p_fee: 410, p_is_committee: false,
      p_payment_method: 'standing_order', p_standing_order_from: '2026-05-01', p_ev: true, p_ev_initial: 7,
    })
  })
})

describe('ApartmentTags', () => {
  it('renders a badge per flag', () => {
    render(<MantineProvider theme={theme}><ApartmentTags committee standingOrder ev /></MantineProvider>)
    for (const label of [he.tags.committee, he.tags.standingOrder, he.tags.ev]) expect(screen.getByText(label)).toBeInTheDocument()
  })

  it('renders nothing without flags', () => {
    const { container } = render(<MantineProvider theme={theme}><ApartmentTags /></MantineProvider>)
    expect(container.querySelector('[data-tag]')).toBeNull()
  })
})
