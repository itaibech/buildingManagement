import { describe, expect, it } from 'vitest'
import { evaluate, requiredVotes, type Rule } from './majority'
import { decisionLabel, mathLine, protocolText, ruleName, rulePreview } from './text'
import type { Poll, Tally } from './types'

const yesNo = (majority: Rule['majority'], base: Rule['base'] = 'building', percent: number | null = null): Rule =>
  ({ kind: 'yes_no', majority, base, percent })
const tally = (counts: number[], building = 19, eligible = building): Tally =>
  ({ counts, voted: counts.reduce((a, b) => a + b, 0), building, eligible })

describe('requiredVotes', () => {
  it('2/3 rounds up, in integers', () => {
    expect(requiredVotes('two_thirds', null, 19)).toBe(13)
    expect(requiredVotes('two_thirds', null, 18)).toBe(12)
    expect(requiredVotes('two_thirds', null, 6)).toBe(4)
    expect(requiredVotes('two_thirds', null, 3)).toBe(2)
  })
  it('a percent rounds up, never below one vote', () => {
    expect(requiredVotes('percent', 60, 19)).toBe(12)
    expect(requiredVotes('percent', 50, 20)).toBe(10)
    expect(requiredVotes('percent', 75, 6)).toBe(5)
    expect(requiredVotes('percent', 1, 5)).toBe(1)
    expect(requiredVotes('two_thirds', null, 0)).toBe(1)
  })
  it('simple has no threshold', () => expect(requiredVotes('simple', null, 19)).toBeNull())
})

describe('simple majority', () => {
  it('passes with more for than against; abstentions do not count', () => {
    const o = evaluate(yesNo('simple'), tally([4, 3, 9]))
    expect(o.reached).toBe(true)
    expect(mathLine(yesNo('simple'), o, [])).toBe('רוב רגיל: בעד 4, נגד 3')
  })
  it('a tie fails', () => {
    const o = evaluate(yesNo('simple'), tally([5, 5, 1]))
    expect(o.reached).toBe(false)
    expect(o.tie).toBe(true)
    expect(mathLine(yesNo('simple'), o, [])).toMatch(/^תיקו/)
  })
  it('no votes: no majority', () => expect(evaluate(yesNo('simple'), tally([0, 0, 0])).reached).toBe(false))
})

describe('2/3 of all apartments', () => {
  const rule = yesNo('two_thirds', 'building')
  it('11 for out of 19 is short of 13', () => {
    const o = evaluate(rule, tally([11, 0, 2]))
    expect(o.reached).toBe(false)
    expect(mathLine(rule, o, [])).toBe('נדרשו 13 מתוך 19, הצביעו בעד 11')
    expect(decisionLabel('yes_no', o, true, [])).toBe('ההצעה לא התקבלה')
  })
  it('13 for out of 19 passes, even when against is close', () => {
    expect(evaluate(rule, tally([13, 6, 0])).reached).toBe(true)
  })
  it('abstentions and non-voters count as not for', () => {
    expect(evaluate(rule, tally([12, 0, 7])).reached).toBe(false)
  })
})

describe('2/3 of the participating apartments', () => {
  const rule = yesNo('two_thirds', 'eligible')
  it('the 6 parking-lift owners: 4 for is enough', () => {
    const o = evaluate(rule, tally([4, 2, 0], 19, 6))
    expect(o).toMatchObject({ reached: true, required: 4, base: 6 })
    expect(mathLine(rule, o, [])).toBe('נדרשו 4 מתוך 6, הצביעו בעד 4')
  })
  it('the same scope counted of all apartments needs 13', () => {
    expect(evaluate(yesNo('two_thirds', 'building'), tally([6, 0, 0], 19, 6))).toMatchObject({ reached: false, required: 13 })
  })
})

describe('custom percent', () => {
  const rule = yesNo('percent', 'building', 60)
  it('needs ceil(60% of 19) = 12', () => {
    expect(evaluate(rule, tally([11, 0, 0])).reached).toBe(false)
    expect(evaluate(rule, tally([12, 7, 0])).reached).toBe(true)
  })
  it('names the rule', () => expect(ruleName(rule)).toBe('60% מכלל הדירות'))
})

describe('single choice', () => {
  const rule: Rule = { kind: 'single_choice', majority: 'simple', percent: null, base: 'building' }
  const labels = ['חברה א', 'חברה ב', 'חברה ג']
  it('picks the option strictly ahead', () => {
    const o = evaluate(rule, tally([2, 5, 1]))
    expect(o).toMatchObject({ reached: true, leader: 1, top: 5, next: 2 })
    expect(decisionLabel('single_choice', o, true, labels)).toBe('נבחרה: חברה ב')
  })
  it('a tie at the top decides nothing', () => {
    const o = evaluate(rule, tally([4, 4, 1]))
    expect(o).toMatchObject({ reached: false, leader: null, tie: true })
    expect(decisionLabel('single_choice', o, true, labels)).toBe('לא התקבלה החלטה')
  })
  it('with a share rule the leader must also reach it', () => {
    const share: Rule = { ...rule, majority: 'two_thirds' }
    expect(evaluate(share, tally([9, 3, 1])).reached).toBe(false)
    expect(evaluate(share, tally([13, 3, 1])).reached).toBe(true)
  })
})

describe('wording', () => {
  it('previews a share rule in numbers', () => {
    expect(rulePreview(yesNo('two_thirds'), 19)).toContain('לפחות 13 קולות בעד מתוך 19 דירות')
  })
  it('builds the protocol addendum', () => {
    const poll: Poll = {
      id: 'p1', question: 'תחזוקת מתקן החניה', description: '', kind: 'yes_no', options: [], opens_at: '2026-11-01T08:00:00Z',
      closes_at: '2026-11-08T18:00:00Z', majority: 'two_thirds', majority_percent: null, majority_base: 'building', scope: 'all',
      results_visibility: 'live', status: 'closed', opened_at: '2026-11-01T08:00:00Z', closed_at: '2026-11-08T18:00:00Z', apartmentIds: [],
    }
    const text = protocolText(poll, tally([11, 2, 1]), [])
    expect(text).toContain('השאלה: תחזוקת מתקן החניה')
    expect(text).toContain('הצביעו 14 מתוך 19 דירות')
    expect(text).toContain('בעד: 11 · נגד: 2 · נמנע: 1')
    expect(text).toContain('נדרשו 13 מתוך 19, הצביעו בעד 11')
    expect(text).toContain('תוצאה: ההצעה לא התקבלה')
  })
})
