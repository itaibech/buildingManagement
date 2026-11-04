import { describe, expect, it } from 'vitest'
import { render } from '../../send-email/lib/template.ts'
import { daysLeftHeading, digestContent, digestSections, digestSubject } from './content.ts'
import { addDays } from './db.ts'
import { cleanDays, daysBetween, DEFAULT_SETTINGS, entryKey, israelDate, offsetsFor, OVERDUE, selectDue, TODAY, type ReminderItem } from './digest.ts'

const TODAY_ISO = '2026-11-04'
const item = (over: Partial<ReminderItem>): ReminderItem => ({
  kind: 'task', id: 't1', title: 'בדיקת מז"חים שנתית', dueOn: TODAY_ISO, remindDays: 0, supplierId: null, supplierName: null, supplierPhone: null, ...over,
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
    item({ id: 'later', dueOn: '2026-11-20' }),
    item({ id: 'done-once', dueOn: null }),
  ]
  const ids = (s = DEFAULT_SETTINGS, list = items, sent = none, today = TODAY_ISO) =>
    selectDue(list, s, today, sent).map((e) => [e.item.id, e.offset])

  it('7 and 1 days before, the day itself and overdue; nothing before the first offset day', () => {
    expect(ids()).toEqual([['week', 7], ['day', 1], ['today', TODAY], ['overdue', OVERDUE]])
  })
  it('configurable offsets; overdue can be turned off; off = nothing', () => {
    expect(ids({ enabled: true, daysBefore: [16], includeOverdue: false })).toEqual([['week', 16], ['day', 16], ['today', TODAY], ['later', 16]])
    expect(ids({ ...DEFAULT_SETTINGS, enabled: false })).toEqual([])
  })
  it('a task marked done (next_due moved on, or none for a one-off) is skipped', () => {
    const done = [item({ id: 'week', dueOn: '2027-11-11' }), item({ id: 'day', dueOn: null })]
    expect(ids(DEFAULT_SETTINGS, done)).toEqual([])
  })
  it('an item\'s own remind_days is one more offset, alongside the building\'s 7 and 1', () => {
    expect(offsetsFor(item({ remindDays: 30 }), DEFAULT_SETTINGS)).toEqual([0, 1, 7, 30])
    expect(offsetsFor(item({ remindDays: 7 }), DEFAULT_SETTINGS)).toEqual([0, 1, 7])
    expect(ids(DEFAULT_SETTINGS, [item({ id: 'x', dueOn: '2026-11-24', remindDays: 30 })])).toEqual([['x', 30]])
  })

  /** Runs every day from `from` for `days` days, logging what was sent: [date, offset]. */
  function simulate(list: ReminderItem[], from: string, days: number, skip: string[] = []): [string, number][] {
    const sent = new Set<string>()
    const out: [string, number][] = []
    for (let i = 0; i < days; i += 1) {
      const today = addDays(from, i)
      if (skip.includes(today)) continue
      for (const e of selectDue(list, DEFAULT_SETTINGS, today, sent)) {
        sent.add(entryKey(e.item.kind, e.item.id, e.item.dueOn ?? '', e.offset))
        out.push([today, e.offset])
      }
    }
    return out
  }

  it('a contract with remind_days 30 emails at 30, 7, 1 and 0 days, once each, never overdue', () => {
    const c = item({ kind: 'contract', id: 'c', dueOn: '2026-12-04', remindDays: 30 })
    expect(simulate([c], '2026-10-01', 90)).toEqual([['2026-11-04', 30], ['2026-11-27', 7], ['2026-12-03', 1], ['2026-12-04', 0]])
  })
  it('a task: 30, 7, 1, 0 and once overdue (the first run after the due date)', () => {
    const t = item({ id: 't', dueOn: '2026-12-04', remindDays: 30 })
    expect(simulate([t], '2026-10-01', 90)).toEqual([['2026-11-04', 30], ['2026-11-27', 7], ['2026-12-03', 1], ['2026-12-04', 0], ['2026-12-05', OVERDUE]])
  })
  it('catch-up: a missed day is sent on the next run, still once', () => {
    const t = item({ id: 't', dueOn: '2026-11-11' })
    expect(simulate([t], '2026-11-01', 20, ['2026-11-04', '2026-11-10', '2026-11-11', '2026-11-12']))
      .toEqual([['2026-11-05', 7], ['2026-11-13', OVERDUE]])
  })
  it('once only: an (item, due date, offset) already logged is not sent again; a new due date is', () => {
    const sent = new Set([entryKey('task', 'week', '2026-11-11', 7), entryKey('task', 'overdue', '2026-11-03', OVERDUE)])
    expect(ids(DEFAULT_SETTINGS, items, sent)).toEqual([['day', 1], ['today', TODAY]])
    expect(ids(DEFAULT_SETTINGS, [item({ id: 'week', dueOn: '2027-11-11' })], sent, '2027-11-04')).toEqual([['week', 7]])
    expect(entryKey('task', 'a', '2026-11-11', 7)).not.toBe(entryKey('contract', 'a', '2026-11-11', 7))
  })
  it('cleans the offsets: whole days 1-60, distinct', () => {
    expect(cleanDays([7, 1, 7, 0, 61, 2.5, 30])).toEqual([30, 7, 1])
  })
})

describe('digest content', () => {
  const entries = [
    { item: item({ id: 'a', title: 'ניקוי <גג>', dueOn: '2026-11-11', supplierId: 's1', supplierName: 'אינסטלציה & בניו', supplierPhone: '050-1234567' }), offset: 7, daysLeft: 7 },
    { item: item({ id: 'b', dueOn: '2026-11-03' }), offset: OVERDUE, daysLeft: -1 },
    { item: item({ id: 'c', title: 'מעליות', dueOn: TODAY_ISO }), offset: TODAY, daysLeft: 0 },
    { item: item({ kind: 'contract', id: 'k', title: 'שירות מעלית', dueOn: '2026-11-05', supplierId: 's2', supplierName: 'מעליות בע"מ' }), offset: 7, daysLeft: 1 },
    { item: item({ id: 'd', dueOn: '2026-10-01' }), offset: OVERDUE, daysLeft: -34 },
  ]
  it('sections by days left, in order: היום, בעוד יום, בעוד שבוע, באיחור (all overdue together)', () => {
    const sections = digestSections(entries, 'https://app/')
    expect(sections.map((s) => s.heading)).toEqual(['היום', 'בעוד יום', 'בעוד שבוע', 'באיחור'])
    expect(sections[3].items).toHaveLength(2)
    expect(daysLeftHeading(5)).toBe('בעוד 5 ימים')
    expect(daysLeftHeading(30)).toBe('בעוד חודש')
  })
  it('subject counts the items', () => {
    expect(digestSubject(1)).toBe('תזכורת תחזוקה: פריט אחד לטיפול')
    expect(digestContent(entries, 'דנה', 'https://app/').subject).toBe('תזכורת תחזוקה: 5 פריטים לטיפול')
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
