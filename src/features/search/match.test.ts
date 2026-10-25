import { describe, expect, it } from 'vitest'
import { matches, normalize, searchAll, type SearchData } from './match'

describe('normalize', () => {
  it('trims, collapses spaces and lower-cases', () => {
    expect(normalize('  דנה   כהן ')).toBe('דנה כהן')
    expect(normalize('A@Example.TEST')).toBe('a@example.test')
  })
})

describe('matches', () => {
  it('partial Hebrew names', () => {
    expect(matches('כה', { text: ['דנה כהן'] })).toBe(true)
    expect(matches('דנה  כ', { text: ['דנה כהן'] })).toBe(true)
    expect(matches('לוי', { text: ['דנה כהן'] })).toBe(false)
  })
  it('phones with and without dashes, both ways', () => {
    expect(matches('0501234567', { phones: ['050-1234567'] })).toBe(true)
    expect(matches('050-123', { phones: ['0501234567'] })).toBe(true)
    expect(matches('1234', { phones: ['050-123-4567'] })).toBe(true)
    expect(matches('99', { phones: ['050-1234567'] })).toBe(false)
  })
  it('a short digit query does not match phones (too noisy), but matches the apartment number exactly', () => {
    expect(matches('5', { phones: ['050-1234567'] })).toBe(false)
    expect(matches('5', { numbers: [5] })).toBe(true)
    expect(matches('5', { numbers: [15] })).toBe(false)
  })
  it('an empty query matches nothing', () => {
    expect(matches('  ', { text: ['דנה'] })).toBe(false)
  })
})

describe('searchAll', () => {
  const data: SearchData = {
    apartments: [{ id: 'a3', number: 3, names: ['דנה כהן'] }, { id: 'a12', number: 12, names: [] }],
    people: [{ id: 'r1', name: 'דנה כהן', phone: '050-1234567', email: 'dana@example.test', apartmentId: 'a3', apartmentNumber: 3 }],
    announcements: [{ id: 'n1', title: 'ניקיון חדר מדרגות' }],
    tickets: [{ id: 't1', title: 'נזילה בחדר מדרגות' }],
  }
  it('groups results: apartments, people, announcements, tickets', () => {
    const r = searchAll('מדרגות', data)
    expect(r.announcements.map((x) => x.id)).toEqual(['n1'])
    expect(r.tickets.map((x) => x.id)).toEqual(['t1'])
    expect(r.people).toEqual([])
  })
  it('a name finds the person and their apartment; an email finds the person', () => {
    const r = searchAll('דנה', data)
    expect(r.people.map((x) => x.id)).toEqual(['r1'])
    expect(r.apartments.map((x) => x.id)).toEqual(['a3'])
    expect(searchAll('DANA@', data).people.map((x) => x.id)).toEqual(['r1'])
  })
  it('an apartment number', () => {
    expect(searchAll('12', data).apartments.map((x) => x.id)).toEqual(['a12'])
  })
})
