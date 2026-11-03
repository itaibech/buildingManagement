import { describe, expect, it } from 'vitest'
import { toInput, toValues, validate } from './form'
import { compareQuotes, groupLevies, listBar, percent, projectCost, summarize, timeline } from './logic'
import { NO_PROGRESS, type Progress, type Project, type Quote } from './types'

const project = (over: Partial<Project> = {}): Project => ({
  id: 'p1', title: 'דלת כניסה חדשה', description: '', status: 'quotes', estimated_cost: 16000, final_cost: null,
  start_date: null, end_date: null, levy_label: 'דלת כניסה', levy_month: null, show_quotes: false, decision_note: '',
  decision_meeting_id: null, created_at: '2026-10-01T08:00:00Z', chosen_amount: null, ...over,
})
const quote = (id: string, vendor: string, amount: number, over: Partial<Quote> = {}): Quote => ({
  id, project_id: 'p1', vendor, amount, notes: '', file_path: null, file_name: null, is_chosen: false,
  created_at: '2026-10-01T08:00:00Z', url: null, ...over,
})
// The brief's example: ₪1,000 per apartment from 16 apartments, ₪500 collected from each so far.
const progress = (over: Partial<Progress> = {}): Progress => ({
  ...NO_PROGRESS, levyTotal: 16000, levyDue: 16000, levyCollected: 8000, apartmentsCharged: 16, apartmentsOpen: 16, spent: 4000, expenseCount: 1, ...over,
})

describe('progress math', () => {
  it('percent: whole numbers, capped 0–100, 0 without a whole', () => {
    expect(percent(500, 1000)).toBe(50)
    expect(percent(1, 3)).toBe(33)
    expect(percent(1500, 1000)).toBe(100)
    expect(percent(100, 0)).toBe(0)
    expect(percent(0.1 + 0.2, 0.3)).toBe(100)
  })

  it('cost: the final cost, else the chosen quote, else the estimate', () => {
    expect(projectCost(project())).toEqual({ amount: 16000, source: 'estimated' })
    expect(projectCost(project({ chosen_amount: 15000 }))).toEqual({ amount: 15000, source: 'chosen' })
    expect(projectCost(project({ chosen_amount: 15000, final_cost: 15400.5 }))).toEqual({ amount: 15400.5, source: 'final' })
    expect(projectCost(project({ estimated_cost: null }))).toBeNull()
  })

  it('summarize: collected of the levy owed so far, spent of the cost, the rest scheduled', () => {
    const s = summarize(project({ chosen_amount: 15000 }), progress({ levyTotal: 20000 }))
    expect(s).toMatchObject({ cost: 15000, costSource: 'chosen', hasLevy: true, collected: 8000, due: 16000, scheduled: 4000, collectedPct: 50, spent: 4000, spentPct: 27, gap: 7000 })
  })

  it('summarize: a write-off is neither collected nor in the collection rate', () => {
    const s = summarize(project(), progress({ levyDue: 1500, levyCollected: 1000, levyWrittenOff: 500 }))
    expect(s).toMatchObject({ collected: 1000, writtenOff: 500, collectedPct: 100 })
    expect(summarize(project(), progress({ levyDue: 1500, levyCollected: 500, levyWrittenOff: 500 })).collectedPct).toBe(50)
  })

  it('summarize: agorot, so cents add up exactly', () => {
    const s = summarize(project({ estimated_cost: 0.3 }), progress({ levyTotal: 0.3, levyDue: 0.1, levyCollected: 0.2, spent: 0.1 }))
    expect(s.scheduled).toBe(0.2)
    expect(s.gap).toBe(0.1)
    expect(s.spentPct).toBe(33)
  })

  it('list bar: collection with a levy, else spending, else none', () => {
    expect(listBar(summarize(project(), progress()))).toEqual({ kind: 'collected', pct: 50 })
    expect(listBar(summarize(project({ levy_label: null }), progress()))).toEqual({ kind: 'spent', pct: 25 })
    expect(listBar(summarize(project({ levy_label: null, estimated_cost: null }), NO_PROGRESS))).toBeNull()
    // A levy only charged for later months: nothing owed yet, so the spending shows.
    expect(listBar(summarize(project(), progress({ levyDue: 0, levyCollected: 0 })))).toEqual({ kind: 'spent', pct: 25 })
  })
})

describe('quote comparison', () => {
  it('cheapest first, each against the cheapest and the estimate', () => {
    const rows = compareQuotes([quote('a', 'דלתות בע"מ', 17000), quote('b', 'שערים', 15000), quote('c', 'אלומיניום', 16000)], 16000)
    expect(rows.map((r) => r.quote.id)).toEqual(['b', 'c', 'a'])
    expect(rows.map((r) => r.cheapest)).toEqual([true, false, false])
    expect(rows.map((r) => r.aboveCheapest)).toEqual([0, 1000, 2000])
    expect(rows.map((r) => r.abovePct)).toEqual([0, 7, 13])
    expect(rows.map((r) => r.vsEstimate)).toEqual([-1000, 0, 1000])
  })

  it('ties: both cheapest, ordered by vendor; no estimate means no comparison with it', () => {
    const rows = compareQuotes([quote('a', 'ב', 5000), quote('b', 'א', 5000)], null)
    expect(rows.map((r) => r.quote.id)).toEqual(['b', 'a'])
    expect(rows.every((r) => r.cheapest && r.vsEstimate === null)).toBe(true)
  })

  it('empty and zero amounts', () => {
    expect(compareQuotes([], 100)).toEqual([])
    expect(compareQuotes([quote('a', 'א', 0), quote('b', 'ב', 10)], null)[1]?.abovePct).toBe(0)
  })
})

describe('timeline', () => {
  const ev = (status: Project['status'], at: string) => ({ status, created_at: at })

  it('the normal path: done up to the current step, with the dates reached', () => {
    const steps = timeline('approved', [ev('planning', '2026-10-01T08:00:00Z'), ev('approved', '2026-10-20T08:00:00Z')])
    expect(steps.map((s) => [s.status, s.state, s.at])).toEqual([
      ['planning', 'done', '2026-10-01T08:00:00Z'],
      ['quotes', 'done', null],
      ['approved', 'current', '2026-10-20T08:00:00Z'],
      ['in_progress', 'upcoming', null],
      ['done', 'upcoming', null],
    ])
  })

  it('a step reached twice keeps its latest date; done is done', () => {
    const steps = timeline('done', [ev('quotes', '2026-10-01T08:00:00Z'), ev('done', '2026-11-01T08:00:00Z'), ev('quotes', '2026-10-05T08:00:00Z')])
    expect(steps.find((s) => s.status === 'quotes')?.at).toBe('2026-10-05T08:00:00Z')
    expect(steps.every((s) => s.state === 'done')).toBe(true)
  })

  it('cancelled: the steps reached, then cancelled', () => {
    const steps = timeline('cancelled', [ev('planning', '2026-10-01T08:00:00Z'), ev('cancelled', '2026-10-03T08:00:00Z')])
    expect(steps.map((s) => [s.status, s.state])).toEqual([['planning', 'done'], ['cancelled', 'current']])
  })
})

describe('project form', () => {
  it('round-trips a project and maps empty fields to null', () => {
    const p = project({ start_date: '2026-11-01', levy_month: '2026-10-01' })
    expect(toInput(toValues(p))).toEqual({
      title: p.title, description: '', status: 'quotes', estimated_cost: 16000, final_cost: null,
      start_date: '2026-11-01', end_date: null, levy_label: 'דלת כניסה', levy_month: '2026-10-01',
    })
    expect(toInput({ ...toValues(), title: '  דלת  ', levy: ' ', levyMonth: '2026-10-01' })).toMatchObject({ title: 'דלת', levy_label: null, levy_month: null })
  })

  it('validates title, amounts and the date order', () => {
    const v = toValues()
    expect(validate.title('  ')).toBeTruthy()
    expect(validate.estimated(-1)).toBeTruthy()
    expect(validate.estimated('')).toBeNull()
    expect(validate.end('2026-01-01', { ...v, start: '2026-02-01' })).toBeTruthy()
    expect(validate.end('2026-03-01', { ...v, start: '2026-02-01' })).toBeNull()
  })

  it('levy options: distinct trimmed labels with their months; empty labels skipped', () => {
    expect(groupLevies([
      { label: 'דלת ', month: '2026-11-01' }, { label: 'דלת', month: '2026-10-01' }, { label: 'דלת', month: '2026-10-01' },
      { label: '', month: '2026-10-01' }, { label: 'ביוב', month: '2026-09-01' },
    ])).toEqual([{ label: 'ביוב', months: ['2026-09-01'] }, { label: 'דלת', months: ['2026-10-01', '2026-11-01'] }])
  })
})
