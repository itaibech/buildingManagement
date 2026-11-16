import { afterEach, describe, expect, it, vi } from 'vitest'
import { whenIdle, yieldToMain } from './schedule'

const g = globalThis as Record<string, unknown>

afterEach(() => {
  delete g.scheduler
  delete g.requestIdleCallback
  delete g.cancelIdleCallback
  vi.useRealTimers()
})

describe('yieldToMain', () => {
  it('uses scheduler.yield() where the browser has it', async () => {
    const yieldFn = vi.fn(() => Promise.resolve())
    g.scheduler = { yield: yieldFn }
    await yieldToMain()
    expect(yieldFn).toHaveBeenCalledOnce()
  })

  it('falls back to a timer task (Safari)', async () => {
    vi.useFakeTimers()
    let done = false
    const p = yieldToMain().then(() => { done = true })
    await Promise.resolve()
    expect(done).toBe(false)
    await vi.runAllTimersAsync()
    await p
    expect(done).toBe(true)
  })
})

describe('whenIdle', () => {
  it('waits for requestIdleCallback and can be cancelled', () => {
    const ric = vi.fn((cb: () => void) => { cb(); return 7 })
    const cancel = vi.fn()
    g.requestIdleCallback = ric
    g.cancelIdleCallback = cancel
    const work = vi.fn()
    whenIdle(work)()
    expect(work).toHaveBeenCalledOnce()
    expect(cancel).toHaveBeenCalledWith(7)
  })

  it('falls back to a delay, cancelled by the effect cleanup', () => {
    vi.useFakeTimers()
    const work = vi.fn()
    whenIdle(work, 1000)
    const cancelled = vi.fn()
    whenIdle(cancelled, 1000)()
    vi.advanceTimersByTime(1000)
    expect(work).toHaveBeenCalledOnce()
    expect(cancelled).not.toHaveBeenCalled()
  })
})
