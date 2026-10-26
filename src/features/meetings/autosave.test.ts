import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createAutosaver, memoryStore } from './autosave'

describe('autosaver', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('debounces: only the latest value per key is saved, once, after the delay', async () => {
    const save = vi.fn(async () => undefined)
    const a = createAutosaver({ delay: 800, save, store: memoryStore(), online: () => true })
    a.push('item:1', { decision: 'א' })
    await vi.advanceTimersByTimeAsync(500)
    a.push('item:1', { decision: 'אב' })
    a.push('att:7', { status: 'present' })
    await vi.advanceTimersByTimeAsync(700)
    expect(save).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(100)
    expect(save).toHaveBeenCalledTimes(2)
    expect(save).toHaveBeenCalledWith('item:1', { decision: 'אב' })
    expect(save).toHaveBeenCalledWith('att:7', { status: 'present' })
    expect(a.status()).toBe('saved')
  })

  it('offline: keeps the draft locally and syncs when the connection returns', async () => {
    const store = memoryStore()
    let online = false
    const save = vi.fn(async () => undefined)
    const a = createAutosaver({ delay: 100, save, store, online: () => online })
    a.push('item:1', { discussion: 'טיוטה' })
    await vi.advanceTimersByTimeAsync(200)
    expect(save).not.toHaveBeenCalled()
    expect(a.status()).toBe('offline')
    expect(store.load()).toEqual({ 'item:1': { discussion: 'טיוטה' } })
    online = true
    await a.flush()
    expect(save).toHaveBeenCalledWith('item:1', { discussion: 'טיוטה' })
    expect(store.load()).toEqual({})
  })

  it('a failed save stays pending (stored) and is retried', async () => {
    const store = memoryStore()
    const save = vi.fn().mockRejectedValueOnce(new Error('network')).mockResolvedValue(undefined)
    const a = createAutosaver({ delay: 100, save, store, online: () => true, retryMs: 1000 })
    a.push('item:1', { decision: 'x' })
    await vi.advanceTimersByTimeAsync(100)
    expect(a.status()).toBe('error')
    expect(store.load()).toEqual({ 'item:1': { decision: 'x' } })
    await vi.advanceTimersByTimeAsync(1000)
    expect(save).toHaveBeenCalledTimes(2)
    expect(a.status()).toBe('saved')
    expect(store.load()).toEqual({})
  })

  it('a value pushed while saving is saved afterwards, not lost', async () => {
    let release: () => void = () => undefined
    const save = vi.fn(() => new Promise<void>((r) => { release = r }))
    const a = createAutosaver({ delay: 100, save, store: memoryStore(), online: () => true })
    a.push('item:1', { decision: '1' })
    await vi.advanceTimersByTimeAsync(100)
    a.push('item:1', { decision: '2' })
    release()
    await vi.advanceTimersByTimeAsync(100)
    release()
    await vi.advanceTimersByTimeAsync(0)
    expect(save).toHaveBeenLastCalledWith('item:1', { decision: '2' })
  })

  it('flush() during a save in flight resolves only after the server has everything (open/close wait for it)', async () => {
    let release: () => void = () => undefined
    const save = vi.fn(() => new Promise<void>((r) => { release = r }))
    const a = createAutosaver({ delay: 100, save, store: memoryStore(), online: () => true })
    a.push('att:1', { status: 'present' })
    await vi.advanceTimersByTimeAsync(100)
    expect(save).toHaveBeenCalledTimes(1)
    let done = false
    const flushed = a.flush().then(() => { done = true })
    await vi.advanceTimersByTimeAsync(0)
    expect(done).toBe(false)
    release()
    await flushed
    expect(a.pending()).toEqual({})
  })

  it('hold: kept in the device draft but never sent until a normal push replaces it', async () => {
    const store = memoryStore()
    const save = vi.fn(async () => undefined)
    const a = createAutosaver({ delay: 100, save, store, online: () => true })
    a.hold('item:1', { votes_for: 9 })
    a.push('att:2', { status: 'present' })
    await vi.advanceTimersByTimeAsync(200)
    expect(save).toHaveBeenCalledTimes(1)
    expect(save).toHaveBeenCalledWith('att:2', { status: 'present' })
    expect(store.load()).toEqual({ 'item:1': { votes_for: 9, __held: true } })
    expect(a.status()).toBe('saved')
    a.push('item:1', { votes_for: 2 })
    await vi.advanceTimersByTimeAsync(200)
    expect(save).toHaveBeenLastCalledWith('item:1', { votes_for: 2 })
    expect(store.load()).toEqual({})
  })

  it('restores a stored draft from an earlier session', () => {
    const store = memoryStore({ 'item:1': { decision: 'נשמר במכשיר' } })
    const a = createAutosaver({ delay: 100, save: vi.fn(async () => undefined), store, online: () => true })
    expect(a.pending()).toEqual({ 'item:1': { decision: 'נשמר במכשיר' } })
  })
})
