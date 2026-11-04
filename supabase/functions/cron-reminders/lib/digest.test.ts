import { describe, expect, it } from 'vitest'
import { render } from '../../send-email/lib/template.ts'
import { digestContent, digestSections, digestSubject, offsetHeading } from './content.ts'
import { addDays } from './db.ts'
import { cleanDays, daysBetween, DEFAULT_SETTINGS, entryKey, israelDate, OVERDUE, selectDue, TODAY, type ReminderItem } from './digest.ts'

const TODAY_ISO = '2026-11-04'
const item = (over: Partial<ReminderItem>): ReminderItem => ({
  kind: 'task', id: 't1', title: 'בדיקת מז"חים שנתית', dueOn: TODAY_ISO, supplierId: null, supplierName: null, supplierPhone: null, ...over,
})
const none = new Set<string>()

describe('israelDate (Asia/Jerusalem day boundaries)', () => {
  it('winter (UTC+2): 21:59 UTC is still the same day, 22:00 UTC is the next', () => {
    expect(israelDate(Date.parse('2026-11-04T21:59:00Z'))).toBe('2026-11-04')
    expect(israelDate(Date.parse('2026-11-04T22:00:00Z'))).toBe('2026-11-05')
  })
  it('summer (UTC+3): 20:59 UTC vs 21:00 UTC', () => {
    expect(israelDate(Date.parse('2026-07-04T20:59:00Z'))).toBe('2026-07-04')
    expect(israelDate(Date.parse('2026-07-04T21:00:00Z'))).toBe('2026-07-05')
  })
  it('the 08:00 run (06:10 UTC in winter) is that Israeli day', () => {
    expect(israelDate(Date.parse('2026-11-04T06:10:00Z'))).toBe('2026-11-04')
  })
})

describe('daysBetween / addDays', () => {
  it('counts calendar days across months and the DST change', () => {
    expect(daysBetween('2026-10-24', '2026-10-31')).toBe(7)
    expect(daysBetween('2026-03-25', '2026-03-28')).toBe(3)
    expect(daysBetween('2026-11-04', '2026-11-03')).toBe(-1)
    expect(daysBetween('nope', '2026-11-03')).toBeNull()
    expect(addDays('2026-02-28', 1)).toBe('2026-03-01')
    expect(addDays('2026-11-04', -1)).toBe('2026-11-03')
  })
})

describe('selectDue', () => {
  const items = [
    item({ id: 'week', dueOn: '2026-11-11' }),
    item({ id: 'day', dueOn: '2026-11-05' }),
    item({ id: 'today', dueOn: TODAY_ISO }),
    item({ id: 'overdue', dueOn: '2026-11-03' }),
    item({ id: 'old', dueOn: '2026-11-01' }),
    item({ id: 'six', dueOn: '2026-11-10' }),
    item({ id: 'done-once', dueOn: null }),
  ]
  const ids = (s = DEFAULT_SETTINGS, list = items, sent = none) => selectDue(list, s, TODAY_ISO, sent).map((e) => [e.item.id, e.offset])

  it('7 and 1 days before, the day itself and the day after (overdue), nothing else', () => {
    expect(ids()).toEqual([['week', 7], ['day', 1], ['today', TODAY], ['overdue', OVERDUE]])
  })
  it('configurable offsets; overdue can be turned off; off = nothing', () => {
    expect(ids({ enabled: true, daysBefore: [6], includeOverdue: false })).toEqual([['today', TODAY], ['six', 6]])
    expect(ids({ ...DEFAULT_SETTINGS, enabled: false })).toEqual([])
  })
  it('a task marked done (next_due moved on, or none for a one-off) is skipped', () => {
    const done = [item({ id: 'week', dueOn: '2027-11-11' }), item({ id: 'day', dueOn: null })]
    expect(ids(DEFAULT_SETTINGS, done)).toEqual([])
  })
  it('contracts get the same offsets and today, but are never overdue', () => {
    const list = [
      item({ kind: 'contract', id: 'c7', dueOn: '2026-11-11' }), item({ kind: 'contract', id: 'c1', dueOn: '2026-11-05' }),
      item({ kind: 'contract', id: 'c0', dueOn: TODAY_ISO }), item({ kind: 'contract', id: 'cx', dueOn: '2026-11-03' }),
    ]
    expect(ids(DEFAULT_SETTINGS, list)).toEqual([['c7', 7], ['c1', 1], ['c0', TODAY]])
  })
  it('once only: an (item, due date, offset) already logged is not sent again; a new due date is', () => {
    const sent = new Set([entryKey('task', 'week', '2026-11-11', 7), entryKey('task', 'today', '2026-11-04', 7)])
    expect(ids(DEFAULT_SETTINGS, items, sent)).toEqual([['day', 1], ['today', TODAY], ['overdue', OVERDUE]])
    expect(entryKey('task', 'a', '2026-11-11', 7)).not.toBe(entryKey('contract', 'a', '2026-11-11', 7))
  })
  it('cleans the offsets: whole days 1-60, distinct', () => {
    expect(cleanDays([7, 1, 7, 0, 61, 2.5, 30])).toEqual([30, 7, 1])
  })
})

describe('digest content', () => {
  const entries = [
    { item: item({ id: 'a', title: 'ניקוי <גג>', dueOn: '2026-11-11', supplierId: 's1', supplierName: 'אינסטלציה & בניו', supplierPhone: '050-1234567' }), offset: 7 },
    { item: item({ id: 'b', dueOn: '2026-11-03' }), offset: OVERDUE },
    { item: item({ id: 'c', title: 'מעליות', dueOn: TODAY_ISO }), offset: TODAY },
    { item: item({ kind: 'contract', id: 'k', title: 'שירות מעלית', dueOn: '2026-11-05', supplierId: 's2', supplierName: 'מעליות בע"מ' }), offset: 1 },
  ]
  it('sections in order: היום, בעוד יום, בעוד שבוע, באיחור', () => {
    expect(digestSections(entries, 'https://app/').map((s) => s.heading)).toEqual(['היום', 'בעוד יום', 'בעוד שבוע', 'באיחור'])
    expect(offsetHeading(3)).toBe('בעוד 3 ימים')
  })
  it('subject counts the items', () => {
    expect(digestSubject(4)).toBe('תזכורת תחזוקה: 4 משימות קרובות')
    expect(digestContent(entries, 'דנה', 'https://app/').subject).toBe('תזכורת תחזוקה: 4 משימות קרובות')
  })
  it('each item: title, supplier name and phone, the due date and a link; all text escaped', () => {
    const r = render({ buildingName: 'הבניין', appUrl: 'https://app/' }, digestContent(entries, 'דנה', 'https://app/'))
    expect(r.html).toContain('ניקוי &lt;גג&gt;')
    expect(r.html).not.toContain('<גג>')
    expect(r.html).toContain('ספק: אינסטלציה &amp; בניו · 050-1234567')
    expect(r.html).toContain('מועד: 11/11/2026')
    expect(r.html).toContain('href="https://app/#/maintenance?task=a"')
    expect(r.html).toContain('href="https://app/#/suppliers?supplier=s2"')
    expect(r.html).toContain('חוזה: שירות מעלית')
    expect(r.html).toContain('dir="rtl"')
    expect(r.text).toContain('בעוד שבוע:')
    expect(r.text).toContain('- ניקוי <גג> · מועד: 11/11/2026 · ספק: אינסטלציה & בניו · 050-1234567')
  })
})
