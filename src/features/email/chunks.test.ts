import { describe, expect, it } from 'vitest'
import { chunkApartments, planCalls } from './chunks'

describe('chunkApartments', () => {
  it('groups apartments in order without passing the limit', () => {
    expect(chunkApartments({ a: 20, b: 15, c: 10, d: 30, e: 5 }, 40)).toEqual([['a', 'b'], ['c', 'd'], ['e']])
  })
  it('skips apartments with no emails and puts an oversized one alone', () => {
    expect(chunkApartments({ a: 0, b: 50, c: 3 }, 40)).toEqual([['b'], ['c']])
    expect(chunkApartments({})).toEqual([])
  })
})

describe('planCalls', () => {
  const req = { kind: 'announcement', id: 'n1', apartmentIds: 'all' as const }
  it('one call (as asked) when it fits', () => {
    expect(planCalls(req, { recipients: 40, perApartment: { a: 40 } })).toEqual([req])
  })
  it('splits a larger send into apartment chunks', () => {
    const calls = planCalls(req, { recipients: 70, perApartment: { a: 30, b: 20, c: 20 }, maxPerCall: 40 })
    expect(calls).toEqual([{ ...req, apartmentIds: ['a'] }, { ...req, apartmentIds: ['b', 'c'] }])
  })
})
