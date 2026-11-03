import { describe, expect, it } from 'vitest'
import { buildIcs, escapeText, foldLine, googleCalendarUrl, rruleOf } from './ics'
import { addMonthsClamped, expandAll, expandItem, groupByDay, upcoming } from './recurrence'
import type { CalendarItem } from './types'

const item = (over: Partial<CalendarItem>): CalendarItem => ({
  id: 'e1', source: 'event', title: 'ניקיון', description: '', location: '', category: 'cleaning', allDay: false,
  startsAt: '2026-11-05T07:00:00.000Z', endsAt: null, recurrence: 'none', until: null, committee: false, ...over,
})

const octets = (s: string): number => new TextEncoder().encode(s).length

describe('recurrence expansion', () => {
  it('a single event appears once, inside the range only', () => {
    expect(expandItem(item({}), '2026-11-01', '2026-11-30').map((o) => o.day)).toEqual(['2026-11-05'])
    expect(expandItem(item({}), '2026-11-06', '2026-11-30')).toEqual([])
  })

  it('weekly keeps the Israel wall time across the October DST change', () => {
    // Thursday 09:00 IDT (06:00Z); IST from Sunday 25/10/2026, so 09:00 becomes 07:00Z.
    const weekly = item({ startsAt: '2026-10-15T06:00:00.000Z', endsAt: '2026-10-15T08:00:00.000Z', recurrence: 'weekly' })
    const occ = expandItem(weekly, '2026-10-15', '2026-11-05')
    expect(occ.map((o) => o.start)).toEqual([
      '2026-10-15T06:00:00.000Z', '2026-10-22T06:00:00.000Z', '2026-10-29T07:00:00.000Z', '2026-11-05T07:00:00.000Z',
    ])
    expect(occ[2].end).toBe('2026-10-29T09:00:00.000Z')
  })

  it('weekly keeps the wall time across the March DST change (Friday 26/03/2027)', () => {
    const weekly = item({ startsAt: '2027-03-21T18:00:00.000Z', recurrence: 'weekly' }) // Sunday 20:00 IST
    expect(expandItem(weekly, '2027-03-21', '2027-03-28').map((o) => o.start)).toEqual(['2027-03-21T18:00:00.000Z', '2027-03-28T17:00:00.000Z'])
  })

  it('a series that started decades ago still expands in a far window (no step cap from the start)', () => {
    const weekly = item({ startsAt: '1990-01-04T07:00:00.000Z', recurrence: 'weekly' }) // Thursday 09:00
    expect(expandItem(weekly, '2026-11-01', '2026-11-14').map((o) => o.day)).toEqual(['2026-11-05', '2026-11-12'])
    const monthly = item({ startsAt: '1990-01-31T07:00:00.000Z', recurrence: 'monthly' })
    expect(expandItem(monthly, '2027-02-01', '2027-03-31').map((o) => o.day)).toEqual(['2027-02-28', '2027-03-31'])
    const shutoff = item({ allDay: true, startsAt: '2000-01-02T22:00:00.000Z', endsAt: '2000-01-04T22:00:00.000Z', recurrence: 'weekly' })
    expect(expandItem(shutoff, '2026-11-10', '2026-11-10').map((o) => [o.day, o.lastDay])).toEqual([['2026-11-09', '2026-11-11']])
  })

  it('weekly stops at the end date (inclusive)', () => {
    const weekly = item({ recurrence: 'weekly', until: '2026-11-19' })
    expect(expandItem(weekly, '2026-11-01', '2026-12-31').map((o) => o.day)).toEqual(['2026-11-05', '2026-11-12', '2026-11-19'])
  })

  it('monthly on the 31st falls on each month\'s last day, then back on the 31st', () => {
    const monthly = item({ startsAt: '2027-01-31T08:00:00.000Z', recurrence: 'monthly' })
    expect(expandItem(monthly, '2027-01-01', '2027-05-31').map((o) => o.day)).toEqual([
      '2027-01-31', '2027-02-28', '2027-03-31', '2027-04-30', '2027-05-31',
    ])
  })

  it('monthly clamps in leap years and at month ends', () => {
    expect(addMonthsClamped('2028-01-30', 1)).toBe('2028-02-29')
    expect(addMonthsClamped('2026-12-15', 1)).toBe('2027-01-15')
    expect(addMonthsClamped('2026-03-31', 11)).toBe('2027-02-28')
  })

  it('monthly keeps the time across DST', () => {
    const monthly = item({ startsAt: '2026-09-10T06:00:00.000Z', recurrence: 'monthly' }) // 09:00 IDT
    expect(expandItem(monthly, '2026-09-01', '2026-11-30').map((o) => o.start)).toEqual([
      '2026-09-10T06:00:00.000Z', '2026-10-10T06:00:00.000Z', '2026-11-10T07:00:00.000Z',
    ])
  })

  it('an all-day multi-day event overlaps the range and shows on each day it covers', () => {
    const shutoff = item({ allDay: true, startsAt: '2026-11-08T22:00:00.000Z', endsAt: '2026-11-10T22:00:00.000Z' })
    const occ = expandItem(shutoff, '2026-11-10', '2026-11-30')
    expect(occ.map((o) => [o.day, o.lastDay])).toEqual([['2026-11-09', '2026-11-11']])
    expect([...groupByDay(occ, '2026-11-10', '2026-11-30').keys()]).toEqual(['2026-11-10', '2026-11-11'])
  })

  it('sorts every item by start and keeps upcoming ones only', () => {
    const all = expandAll([item({ id: 'b', startsAt: '2026-11-06T07:00:00.000Z' }), item({ id: 'a' })], '2026-11-01', '2026-11-30')
    expect(all.map((o) => o.item.id)).toEqual(['a', 'b'])
    expect(upcoming(all, new Date('2026-11-05T09:00:00Z'), '2026-11-05').map((o) => o.item.id)).toEqual(['b'])
  })
})

describe('ICS', () => {
  it('escapes commas, semicolons, backslashes and newlines', () => {
    expect(escapeText('מים, חשמל; גז\\אחר\nשורה\r\nשנייה')).toBe('מים\\, חשמל\\; גז\\\\אחר\\nשורה\\nשנייה')
  })

  it('folds at 75 octets with CRLF + space, never splitting a Hebrew character', () => {
    const line = `DESCRIPTION:${'א'.repeat(100)}`
    const parts = foldLine(line).split('\r\n')
    expect(parts.length).toBeGreaterThan(1)
    expect(octets(parts[0])).toBeLessThanOrEqual(75)
    parts.slice(1).forEach((p) => { expect(p.startsWith(' ')).toBe(true); expect(octets(p)).toBeLessThanOrEqual(75) })
    expect(parts.map((p, i) => (i === 0 ? p : p.slice(1))).join('')).toBe(line)
    expect(foldLine('SUMMARY:short')).toBe('SUMMARY:short')
  })

  it('builds a timed recurring event with TZID Asia/Jerusalem and a UTC UNTIL', () => {
    const ics = buildIcs(item({ recurrence: 'weekly', until: '2026-12-31', location: 'לובי, קומה 0' }), new Date('2026-11-01T10:00:00Z'))
    expect(ics.endsWith('\r\n')).toBe(true)
    expect(ics.split('\r\n').every((l) => octets(l) <= 75)).toBe(true)
    expect(ics).toContain('BEGIN:VTIMEZONE\r\nTZID:Asia/Jerusalem')
    expect(ics).toContain('DTSTART;TZID=Asia/Jerusalem:20261105T090000')
    expect(ics).toContain('DTEND;TZID=Asia/Jerusalem:20261105T100000')
    expect(ics).toContain('RRULE:FREQ=WEEKLY;BYDAY=TH;UNTIL=20261231T215959Z')
    expect(ics).toContain('LOCATION:לובי\\, קומה 0')
    expect(ics).toContain('DTSTAMP:20261101T100000Z')
    expect(ics).not.toMatch(/[^\r]\n/)
  })

  it('builds an all-day event with DATE values and an exclusive end', () => {
    const ics = buildIcs(item({ allDay: true, startsAt: '2026-11-08T22:00:00.000Z', endsAt: '2026-11-10T22:00:00.000Z' }))
    expect(ics).toContain('DTSTART;VALUE=DATE:20261109')
    expect(ics).toContain('DTEND;VALUE=DATE:20261112')
    expect(ics).not.toContain('VTIMEZONE')
  })

  it('monthly rules: a plain day, or the month\'s end for the 29th–31st', () => {
    expect(rruleOf(item({ recurrence: 'monthly' }))).toBe('FREQ=MONTHLY;BYMONTHDAY=5')
    expect(rruleOf(item({ recurrence: 'monthly', startsAt: '2027-01-31T08:00:00.000Z' }))).toBe('FREQ=MONTHLY;BYMONTHDAY=28,29,30,31;BYSETPOS=-1')
    expect(rruleOf(item({ recurrence: 'monthly', allDay: true, startsAt: '2026-11-29T22:00:00.000Z', until: '2027-06-30' })))
      .toBe('FREQ=MONTHLY;BYMONTHDAY=28,29,30;BYSETPOS=-1;UNTIL=20270630')
    expect(rruleOf(item({}))).toBeNull()
  })
})

describe('Google Calendar link', () => {
  it('a timed event: local times with ctz, details, location and the rule', () => {
    const url = new URL(googleCalendarUrl(item({ description: 'הביאו מפתח', location: 'מקלט', recurrence: 'weekly' })))
    expect(url.origin + url.pathname).toBe('https://calendar.google.com/calendar/render')
    expect(url.searchParams.get('action')).toBe('TEMPLATE')
    expect(url.searchParams.get('text')).toBe('ניקיון')
    expect(url.searchParams.get('dates')).toBe('20261105T090000/20261105T100000')
    expect(url.searchParams.get('ctz')).toBe('Asia/Jerusalem')
    expect(url.searchParams.get('details')).toBe('הביאו מפתח')
    expect(url.searchParams.get('location')).toBe('מקלט')
    expect(url.searchParams.get('recur')).toBe('RRULE:FREQ=WEEKLY;BYDAY=TH')
  })

  it('an all-day event: dates only, end exclusive, no ctz', () => {
    const url = new URL(googleCalendarUrl(item({ allDay: true, startsAt: '2026-11-08T22:00:00.000Z' })))
    expect(url.searchParams.get('dates')).toBe('20261109/20261110')
    expect(url.searchParams.has('ctz')).toBe(false)
    expect(url.searchParams.has('recur')).toBe(false)
  })
})
