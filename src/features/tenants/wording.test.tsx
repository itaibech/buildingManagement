// @vitest-environment jsdom
import { MantineProvider } from '@mantine/core'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { describe, expect, it, vi } from 'vitest'
import { he } from '../../lib/he'
import { theme } from '../../ui/theme'
import ApartmentsPage from './ApartmentsPage'

const q = <T,>(data: T) => ({ data, isLoading: false, isError: false, refetch: vi.fn() })
vi.mock('../../lib/supabase', () => ({ supabase: {} }))
vi.mock('../export/useExport', () => ({ useExportAction: () => undefined }))
vi.mock('../ev/api', () => ({ useChargers: () => q([]) }))
vi.mock('../finance/api', () => ({ useBalances: () => q([{ apartmentId: 'a1', fee: 330 }, { apartmentId: 'a2', fee: 330 }]) }))
vi.mock('./api', async (orig) => ({
  ...(await orig<typeof import('./api')>()),
  useApartments: () => q([{ id: 'a1', number: 1, floor: 0, is_committee: false }, { id: 'a2', number: 2, floor: 1, is_committee: false }]),
  useArchivedApartments: () => q([]),
  useResidents: () => q([{ id: 'r1', apartment_id: 'a1', full_name: 'דנה' }]),
  useApartmentBilling: () => q(new Map()),
}))

describe('apartments page wording (Task 26)', () => {
  it('explains the page, labels the amounts and says "ללא דיירים" for an empty apartment', () => {
    render(<MantineProvider theme={theme}><MemoryRouter><ApartmentsPage /></MemoryRouter></MantineProvider>)
    expect(screen.getByText(he.nav.hints.apartments)).toBeInTheDocument()
    expect(screen.getAllByText(he.tenants.monthlyFeeLabel)).toHaveLength(2)
    expect(screen.getByText(new RegExp(he.tenants.noResidentsShort))).toBeInTheDocument()
    expect(he.tenants.residentsCount(0)).toBe('ללא דיירים')
    expect(he.finance.noResidents).toBe('ללא דיירים')
  })
})
