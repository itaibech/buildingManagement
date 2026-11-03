// @vitest-environment jsdom
import { MantineProvider } from '@mantine/core'
import { fireEvent, render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { MemoryRouter } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { he } from '../../lib/he'
import { theme } from '../../ui/theme'
import { PollForm } from './PollForm'
import { ResultsCard } from './ResultsCard'
import type { Poll } from './types'
import { VotePanel } from './VotePanel'

const m = vi.hoisted(() => ({ cast: vi.fn() }))

vi.mock('../../lib/supabase', () => ({ supabase: {} }))
vi.mock('./api', () => ({
  useCastVote: () => ({ mutate: m.cast, isPending: false }),
  useSavePoll: () => ({ mutate: vi.fn(), isPending: false, isError: false }),
}))
vi.mock('../tenants/api', () => ({
  useApartments: () => ({ data: Array.from({ length: 19 }, (_, i) => ({ id: `a${i + 1}`, number: i + 1 })) }),
}))

const wrap = (ui: ReactNode) => render(<MantineProvider theme={theme}><MemoryRouter>{ui}</MemoryRouter></MantineProvider>)
const V = he.polls.vote

const poll = (over: Partial<Poll> = {}): Poll => ({
  id: 'p1', question: 'תחזוקת מתקן החניה', description: '', kind: 'yes_no', options: [], opens_at: '2026-11-01T08:00:00Z',
  closes_at: '2099-11-08T18:00:00Z', majority: 'two_thirds', majority_percent: null, majority_base: 'building', scope: 'all',
  results_visibility: 'live', status: 'open', opened_at: '2026-11-01T08:00:00Z', closed_at: null, apartmentIds: [], ...over,
})

beforeEach(() => m.cast.mockClear())

describe('VotePanel', () => {
  it('tells a user without an apartment link why they cannot vote', () => {
    wrap(<VotePanel poll={poll()} phase="voting" apartmentId={null} vote={undefined} />)
    expect(screen.getByText(V.noApartment)).toBeTruthy()
    expect(screen.queryByRole('button', { name: V.choose('בעד') })).toBeNull()
  })

  it('an apartment outside the scope cannot vote', () => {
    wrap(<VotePanel poll={poll({ scope: 'selected', apartmentIds: ['a2'] })} phase="voting" apartmentId="a1" vote={undefined} />)
    expect(screen.getByText(V.outOfScope)).toBeTruthy()
  })

  it('shows the current vote (by the committee) and changes it with a big button', () => {
    const vote = { poll_id: 'p1', apartment_id: 'a1', choice: 1, voted_by: 'x', by_admin: true, voted_at: '2026-11-02T10:00:00Z' }
    wrap(<VotePanel poll={poll()} phase="voting" apartmentId="a1" vote={vote} />)
    expect(screen.getByText(V.yourVote('נגד'))).toBeTruthy()
    expect(screen.getByText(`· ${V.byCommittee}`, { exact: false })).toBeTruthy()
    expect(screen.getByRole('button', { name: V.choose('נגד') }).getAttribute('aria-pressed')).toBe('true')
    fireEvent.click(screen.getByRole('button', { name: V.choose('בעד') }))
    expect(m.cast).toHaveBeenCalledWith({ poll: 'p1', choice: 0 }, expect.anything())
  })

  it('after the window: no buttons', () => {
    wrap(<VotePanel poll={poll()} phase="ended" apartmentId="a1" vote={undefined} />)
    expect(screen.getByText(V.ended)).toBeTruthy()
    expect(screen.queryAllByRole('button')).toHaveLength(0)
  })
})

describe('ResultsCard', () => {
  it('shows counts, participation and the majority math', () => {
    wrap(<ResultsCard poll={poll()} tally={{ counts: [11, 2, 1], voted: 14, eligible: 19, building: 19 }} loading={false} />)
    expect(screen.getByText(he.polls.participation(14, 19))).toBeTruthy()
    expect(screen.getByText('נדרשו 13 מתוך 19, הצביעו בעד 11')).toBeTruthy()
    expect(screen.getByText(he.polls.majority.notReached)).toBeTruthy()
  })

  it('a closed poll shows the outcome stored at closing', () => {
    const outcome = { reached: true, required: 13, base: 19, top: 13, next: 2, leader: 0, tie: false }
    wrap(<ResultsCard poll={poll({ status: 'closed' })} tally={{ counts: [13, 2, 1], voted: 16, eligible: 19, building: 19, outcome }} loading={false} />)
    expect(screen.getByText(he.polls.majority.passed)).toBeTruthy()
    expect(screen.getByText('נדרשו 13 מתוך 19, הצביעו בעד 13')).toBeTruthy()
  })

  it('hides the counts until closing when the poll says so', () => {
    wrap(<ResultsCard poll={poll({ results_visibility: 'after_close' })} tally={{ counts: null, voted: 3, eligible: 19, building: 19 }} loading={false} />)
    expect(screen.getByText(he.polls.results.hidden)).toBeTruthy()
    expect(screen.queryByTestId('majority-status')).toBeNull()
  })
})

describe('PollForm', () => {
  it('previews the majority rule in numbers', () => {
    wrap(<PollForm poll={poll({ status: 'draft' })} onDone={vi.fn()} />)
    expect(screen.getByTestId('majority-preview').textContent).toBe(he.polls.preview.share(13, 19))
  })
})
