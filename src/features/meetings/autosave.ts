// Debounced autosave with a local draft: every change is kept on the device until the server has it, so a lost
// connection (a shelter with no signal) never loses what the recorder typed. Keys name rows ('item:<id>', 'att:<id>');
// the latest value per key wins.
import { useEffect, useMemo, useState } from 'react'

export type Draft = Record<string, Record<string, unknown>>
export type SaveStatus = 'idle' | 'saving' | 'saved' | 'offline' | 'error'

export interface DraftStore { load(): Draft; save(d: Draft): void }

export const memoryStore = (initial: Draft = {}): DraftStore => {
  let d: Draft = { ...initial }
  return { load: () => ({ ...d }), save: (next) => { d = { ...next } } }
}

/** localStorage under one key per meeting; a broken or missing entry reads as empty. */
export function localStore(key: string): DraftStore {
  return {
    load: () => {
      try {
        const v: unknown = JSON.parse(localStorage.getItem(key) ?? '{}')
        return typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Draft) : {}
      } catch {
        return {}
      }
    },
    save: (d) => (Object.keys(d).length ? localStorage.setItem(key, JSON.stringify(d)) : localStorage.removeItem(key)),
  }
}

export interface AutosaverOptions {
  delay: number
  save: (key: string, value: Record<string, unknown>) => Promise<void>
  store: DraftStore
  online?: () => boolean
  retryMs?: number
  onStatus?: (s: SaveStatus) => void
}

export interface Autosaver {
  push(key: string, value: Record<string, unknown>): void
  /** Keeps the value in the device draft only (e.g. a vote the server would refuse); a later push sends it. */
  hold(key: string, value: Record<string, unknown>): void
  flush(): Promise<void>
  pending(): Draft
  status(): SaveStatus
  dispose(): void
}

export function createAutosaver(o: AutosaverOptions): Autosaver {
  let draft: Draft = o.store.load()
  let status: SaveStatus = 'idle'
  let timer: ReturnType<typeof setTimeout> | undefined
  let inFlight: Promise<void> | null = null
  const online = o.online ?? (() => navigator.onLine)
  const set = (s: SaveStatus) => { status = s; o.onStatus?.(s) }
  const schedule = (ms: number) => { clearTimeout(timer); timer = setTimeout(() => void flush(), ms) }

  async function saveOne(key: string, value: Record<string, unknown>): Promise<boolean> {
    try {
      await o.save(key, value)
    } catch {
      return false
    }
    if (draft[key] === value) { const { [key]: _, ...rest } = draft; draft = rest }
    o.store.save(draft)
    return true
  }

  const sendable = (): [string, Record<string, unknown>][] => Object.entries(draft).filter(([, v]) => v.__held !== true)

  async function flush(): Promise<void> {
    clearTimeout(timer)
    // A save in flight: wait for it, then send what is left, so `await flush()` means the server has everything.
    if (inFlight) { await inFlight; return flush() }
    if (!sendable().length) return set(status === 'idle' ? 'idle' : 'saved')
    if (!online()) return set('offline')
    set('saving')
    const run = Promise.all(sendable().map(([k, v]) => saveOne(k, v)))
    inFlight = run.then(() => undefined)
    const results = await run
    inFlight = null
    if (results.includes(false)) { set('error'); schedule(o.retryMs ?? 5000); return }
    if (sendable().length) return flush()
    set('saved')
  }

  return {
    push(key, value) {
      draft = { ...draft, [key]: value }
      o.store.save(draft)
      schedule(o.delay)
    },
    hold(key, value) {
      draft = { ...draft, [key]: { ...value, __held: true } }
      o.store.save(draft)
    },
    flush,
    pending: () => ({ ...draft }),
    status: () => status,
    dispose: () => clearTimeout(timer),
  }
}

/**
 * React wrapper (`save` must be stable, e.g. useCallback): one autosaver per storage key, flushed when the connection returns and when the page hides.
 * `restored` is the draft found on the device at mount (apply it over the server data).
 */
export function useAutosave(storageKey: string, save: AutosaverOptions['save'], delay = 800) {
  const [status, setStatus] = useState<SaveStatus>('idle')
  const saver = useMemo(() => createAutosaver({ delay, store: localStore(storageKey), onStatus: setStatus, save }), [storageKey, delay, save])
  const [restored] = useState(() => saver.pending())
  useEffect(() => {
    const flush = () => void saver.flush()
    window.addEventListener('online', flush)
    window.addEventListener('pagehide', flush)
    flush()
    return () => { window.removeEventListener('online', flush); window.removeEventListener('pagehide', flush); saver.dispose() }
  }, [saver])
  return { push: saver.push, hold: saver.hold, flush: saver.flush, status, restored }
}
