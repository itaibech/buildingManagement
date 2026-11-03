import { describe, expect, it } from 'vitest'
import { fetchAll } from './fetchAll'

const source = Array.from({ length: 5 }, (_, i) => i)

describe('fetchAll', () => {
  it('reads two full pages and a short one, asking for consecutive ranges', async () => {
    const ranges: [number, number][] = []
    const rows = await fetchAll((from, to) => {
      ranges.push([from, to])
      return Promise.resolve({ data: source.slice(from, to + 1), error: null })
    }, 2)
    expect(rows).toEqual([0, 1, 2, 3, 4])
    expect(ranges).toEqual([[0, 1], [2, 3], [4, 5]])
  })

  it('stops at an empty page when the rows fill the last page exactly', async () => {
    let calls = 0
    const four = source.slice(0, 4)
    const rows = await fetchAll((from, to) => { calls += 1; return Promise.resolve({ data: four.slice(from, to + 1), error: null }) }, 2)
    expect(rows).toEqual([0, 1, 2, 3])
    expect(calls).toBe(3)
  })

  it('throws the error of any page', async () => {
    await expect(fetchAll(() => Promise.resolve({ data: null, error: { message: 'boom' } }))).rejects.toThrow('boom')
  })
})
