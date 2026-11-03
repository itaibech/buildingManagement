// @vitest-environment jsdom
import { MantineProvider } from '@mantine/core'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import type { ReactNode } from 'react'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { formatILS } from '../../lib/format'
import { he } from '../../lib/he'
import { theme } from '../../ui/theme'
import { ProgressCard } from './Overview'
import { ProjectForm } from './ProjectForm'
import { QuotesTab } from './QuotesTab'
import { NO_PROGRESS, type Project, type Quote } from './types'

const m = vi.hoisted(() => ({ quotes: [] as unknown[], quotesFailed: false, show: vi.fn(), choose: vi.fn(), saveError: null as Error | null }))
const idle = (mutate: () => void = vi.fn()) => ({ mutate, isPending: false, isError: false })

vi.mock('../../lib/supabase', () => ({ supabase: {} }))
vi.mock('./api', () => ({
  useQuotes: () => (m.quotesFailed ? { data: undefined, isLoading: false, isError: true } : { data: m.quotes, isLoading: false, isError: false }),
  useProjectProgress: () => ({ data: new Map() }), useLevyOptions: () => ({ data: [{ label: 'דלת כניסה', months: ['2026-10-01'] }] }),
}))
vi.mock('./mutations', () => ({
  useShowQuotes: () => idle(m.show), useDeleteQuote: () => idle(), useSaveQuote: () => idle(), useChooseQuote: () => idle(m.choose),
  useSaveProject: () => ({ mutate: vi.fn(), isPending: false, isError: m.saveError !== null, error: m.saveError }),
  LEVY_TAKEN: 'project:levy_taken',
}))
vi.mock('../meetings/api', () => ({ useMeetings: () => ({ data: [{ id: 'mt1', title: 'ישיבת ועד', scheduled_at: '2026-10-20T17:00:00Z' }] }) }))
vi.mock('../../auth/AuthProvider', () => ({ useAuth: () => ({ isAdmin: true, can: () => true }) }))

const project: Project = {
  id: 'p1', title: 'דלת כניסה חדשה', description: '', status: 'quotes', estimated_cost: 16000, final_cost: null, start_date: null,
  end_date: null, levy_label: 'דלת כניסה', levy_month: null, show_quotes: false, decision_note: '', decision_meeting_id: null,
  created_at: '2026-10-01T08:00:00Z', chosen_amount: null,
}
const quote = (id: string, vendor: string, amount: number, over: Partial<Quote> = {}): Quote => ({
  id, project_id: 'p1', vendor, amount, notes: '', file_path: null, file_name: null, is_chosen: false, created_at: '2026-10-01T08:00:00Z', url: null, ...over,
})

const ui = (node: ReactNode) => render(<MantineProvider theme={theme}><MemoryRouter>{node}</MemoryRouter></MantineProvider>)
const norm = (t: string | null | undefined): string => (t ?? '').replace(/\s+/g, ' ')
const cards = (): HTMLElement[] => screen.getAllByRole('listitem')

beforeEach(() => {
  m.quotes = [quote('a', 'דלתות בע"מ', 17000, { file_path: 'p1/x.pdf', file_name: 'הצעה.pdf', url: 'https://files.test/x' }), quote('b', 'שערים', 15000)]
  m.show.mockClear()
  m.quotesFailed = false
  m.saveError = null
  m.choose.mockClear()
})
afterEach(cleanup)

describe('quote comparison view', () => {
  it('shows the quotes side by side, cheapest first, against the cheapest and the estimate', () => {
    ui(<QuotesTab project={project} isAdmin />)
    const [first, second] = cards()
    expect(within(first as HTMLElement).getByText('שערים')).toBeTruthy()
    expect(within(first as HTMLElement).getByText(he.projects.quotes.cheapest)).toBeTruthy()
    expect(norm(first?.textContent)).toContain(norm(he.projects.quotes.vsEstimate(formatILS(1000), false)))
    expect(norm(second?.textContent)).toContain(norm(he.projects.quotes.aboveCheapest(formatILS(2000), 13)))
    expect(within(second as HTMLElement).getByRole('link', { name: he.projects.quotes.open('הצעה.pdf') }).getAttribute('href')).toBe('https://files.test/x')
  })

  it('admin: toggles "הצג הצעות לדיירים" and chooses a quote with the decision note', async () => {
    ui(<QuotesTab project={project} isAdmin />)
    fireEvent.click(screen.getByRole('switch', { name: new RegExp(he.projects.quotes.show) }))
    expect(m.show).toHaveBeenCalledWith({ id: 'p1', show: true })
    fireEvent.click(within(cards()[0] as HTMLElement).getByRole('button', { name: he.projects.quotes.choose }))
    fireEvent.change(await screen.findByLabelText(he.projects.choose.note), { target: { value: 'נבחרה ההצעה הזולה, הורדנו ₪1,000' } })
    fireEvent.click(screen.getByRole('button', { name: he.projects.choose.confirm }))
    expect(m.choose).toHaveBeenCalledWith({ projectId: 'p1', quoteId: 'b', note: 'נבחרה ההצעה הזולה, הורדנו ₪1,000', meetingId: null }, expect.anything())
  })

  it('resident: no admin controls, and a note when only the chosen quote is shared', () => {
    m.quotes = [quote('b', 'שערים', 15000, { is_chosen: true })]
    ui(<QuotesTab project={project} isAdmin={false} />)
    expect(screen.queryByRole('switch')).toBeNull()
    expect(screen.queryByRole('button', { name: he.projects.quotes.add })).toBeNull()
    expect(within(cards()[0] as HTMLElement).getByText(he.projects.quotes.chosen)).toBeTruthy()
    expect(screen.getByText(he.projects.quotes.hiddenNote)).toBeTruthy()
  })

  it('empty: guidance, with the add action for admins only', () => {
    m.quotes = []
    ui(<QuotesTab project={project} isAdmin />)
    expect(screen.getByText(he.projects.quotes.emptyAdmin)).toBeTruthy()
    cleanup()
    ui(<QuotesTab project={project} isAdmin={false} />)
    expect(screen.getByText(he.projects.quotes.emptyResident)).toBeTruthy()
  })
})

describe('quotes and project form errors', () => {
  it('quotes that fail to load say so', () => {
    m.quotesFailed = true
    ui(<QuotesTab project={project} isAdmin />)
    expect(screen.getByText(he.projects.quotes.loadFailed)).toBeTruthy()
  })

  it('a levy already linked to another project gets the Hebrew explanation', () => {
    m.saveError = new Error('project:levy_taken')
    ui(<ProjectForm project={project} onDone={vi.fn()} />)
    expect(screen.getByText(he.projects.form.levyTaken)).toBeTruthy()
  })
})

describe('progress card', () => {
  it('a write-off shows as "נמחק", and few apartments hide the counts', () => {
    const progress = { ...NO_PROGRESS, levyTotal: 1500, levyDue: 1500, levyCollected: 1000, levyWrittenOff: 500, apartmentsCharged: 3, apartmentsOpen: 0 }
    ui(<ProgressCard project={project} progress={progress} />)
    expect(norm(document.body.textContent)).toContain(norm(he.projects.progress.writtenOff(formatILS(500))))
    expect(norm(document.body.textContent)).toContain(he.projects.progress.apartmentsOwing(0, 3))
    cleanup()
    const hidden = { ...NO_PROGRESS, countsHidden: true, spent: 4000, expenseCount: 1 }
    ui(<ProgressCard project={project} progress={hidden} />)
    const text = norm(document.body.textContent)
    expect(text).toContain(he.projects.progress.committeeOnly)
    expect(text).not.toContain(he.projects.progress.apartmentsOwing(0, 3))
    expect(text).not.toContain('נמחק')
    expect(screen.queryByRole('progressbar', { name: he.projects.progress.collectedBar(0) })).toBeNull()
    expect(text).toContain(he.projects.progress.costEstimated)
    expect(text).toContain(he.projects.progress.spentOf(1))
  })

  it('cost, collected of the levy with the apartments still owing, and spent', () => {
    const progress = { ...NO_PROGRESS, levyTotal: 17000, levyDue: 16000, levyCollected: 8000, apartmentsCharged: 16, apartmentsOpen: 9, spent: 4000, expenseCount: 2 }
    ui(<ProgressCard project={{ ...project, chosen_amount: 15000 }} progress={progress} />)
    const text = norm(document.body.textContent)
    expect(text).toContain(he.projects.progress.costChosen)
    expect(text).toContain(norm(he.projects.progress.collectedOf(formatILS(8000), formatILS(16000))))
    expect(text).toContain(he.projects.progress.apartmentsOwing(9, 16))
    expect(text).toContain(norm(he.projects.progress.scheduled(formatILS(1000))))
    expect(text).toContain(he.projects.progress.spentOf(2))
    expect(screen.getByRole('progressbar', { name: he.projects.progress.collectedBar(50) })).toBeTruthy()
  })

  it('without a levy it says so', () => {
    ui(<ProgressCard project={{ ...project, levy_label: null }} progress={NO_PROGRESS} />)
    expect(screen.getByText(he.projects.progress.noLevy)).toBeTruthy()
  })
})
