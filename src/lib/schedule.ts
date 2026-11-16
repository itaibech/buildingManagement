// Main-thread scheduling helpers (Modern Web Guidance → break up long tasks). scheduler.yield() is not in Safari
// yet, and requestIdleCallback only arrived in Safari 26, so both fall back to a plain timer.

interface SchedulerLike { yield?: () => Promise<void> }
interface IdleWindow {
  requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number
  cancelIdleCallback?: (id: number) => void
}

/** Lets the browser paint and handle input between heavy steps (workbook parsing, sheet building). */
export function yieldToMain(): Promise<void> {
  const scheduler = (globalThis as { scheduler?: SchedulerLike }).scheduler
  if (typeof scheduler?.yield === 'function') return scheduler.yield()
  return new Promise((resolve) => setTimeout(resolve, 0))
}

/** Runs `work` once the page is idle (or after `fallbackMs`). Returns a cancel function for effect cleanups. */
export function whenIdle(work: () => void, fallbackMs = 2000): () => void {
  const w = globalThis as IdleWindow
  if (w.requestIdleCallback && w.cancelIdleCallback) {
    const id = w.requestIdleCallback(work, { timeout: fallbackMs * 2 })
    return () => w.cancelIdleCallback?.(id)
  }
  const id = setTimeout(work, fallbackMs)
  return () => clearTimeout(id)
}
