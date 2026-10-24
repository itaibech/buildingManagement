// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { reloadOnStaleBuild } from './staleBuild'

describe('reloadOnStaleBuild', () => {
  it('reloads once on a stale chunk, then stops', () => {
    const reload = vi.fn()
    const win = Object.assign(new EventTarget(), {
      sessionStorage: window.sessionStorage,
      location: { reload },
      setTimeout: vi.fn(),
    }) as unknown as Window
    window.sessionStorage.clear()
    reloadOnStaleBuild(win)
    win.dispatchEvent(new Event('vite:preloadError', { cancelable: true }))
    win.dispatchEvent(new Event('vite:preloadError', { cancelable: true }))
    expect(reload).toHaveBeenCalledTimes(1)
  })
})
