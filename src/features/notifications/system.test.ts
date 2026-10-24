// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  disableSystem, enableSystem, onNotificationOpen, resetSystemState, systemEnabled, systemNotify, systemSupported,
} from './system'

interface FakeNotification {
  title: string
  options?: NotificationOptions
  onclick: (() => void) | null
  close: () => void
}

const created: FakeNotification[] = []
const fake = { permission: 'default' as NotificationPermission, answer: 'granted' as NotificationPermission, throws: false }

class MockNotification implements FakeNotification {
  static get permission(): NotificationPermission { return fake.permission }
  static requestPermission = vi.fn(async (): Promise<NotificationPermission> => {
    fake.permission = fake.answer
    return fake.answer
  })
  onclick: (() => void) | null = null
  close = vi.fn()
  title: string
  options?: NotificationOptions
  constructor(title: string, options?: NotificationOptions) {
    // Android Chrome: the page may not construct notifications ("Illegal constructor").
    if (fake.throws) throw new TypeError('Illegal constructor')
    this.title = title
    this.options = options
    created.push(this)
  }
}

type Listener = (e: MessageEvent) => void
function mockServiceWorker(showNotification = vi.fn(async () => undefined)) {
  const listeners = new Set<Listener>()
  const registration = { showNotification }
  const sw = {
    register: vi.fn(async () => registration),
    ready: Promise.resolve(registration),
    addEventListener: (_t: string, l: Listener) => listeners.add(l),
    removeEventListener: (_t: string, l: Listener) => listeners.delete(l),
    emit: (data: unknown) => listeners.forEach((l) => l(new MessageEvent('message', { data }))),
  }
  Object.defineProperty(navigator, 'serviceWorker', { configurable: true, value: sw })
  return { sw, showNotification }
}

const setHidden = (hidden: boolean) => Object.defineProperty(document, 'hidden', { configurable: true, get: () => hidden })
const NOTICE = { kind: 'announcement' as const, text: 'הודעה חדשה: מים', path: '/announcements' }

beforeEach(() => {
  vi.stubGlobal('Notification', MockNotification)
  fake.permission = 'default'
  fake.answer = 'granted'
  fake.throws = false
  created.length = 0
  localStorage.clear()
  setHidden(true)
  resetSystemState()
  Reflect.deleteProperty(navigator, 'serviceWorker')
})
afterEach(() => vi.unstubAllGlobals())

describe('system notifications preference (no service worker)', () => {
  it('asks for permission on enable, confirms with a notification and stores the choice', async () => {
    expect(systemEnabled()).toBe(false)
    expect(await enableSystem()).toBe('granted')
    expect(MockNotification.requestPermission).toHaveBeenCalled()
    expect(created).toHaveLength(1)
    expect(systemEnabled()).toBe(true)
    disableSystem()
    expect(systemEnabled()).toBe(false)
  })

  it('stays off when the user blocks it', async () => {
    fake.answer = 'denied'
    expect(await enableSystem()).toBe('denied')
    expect(systemEnabled()).toBe(false)
  })

  it('reports unsupported browsers', async () => {
    vi.stubGlobal('Notification', undefined)
    expect(systemSupported()).toBe(false)
    expect(await enableSystem()).toBe('unsupported')
  })

  it('is unsupported when there is no service worker and the constructor throws', async () => {
    fake.throws = true
    expect(await enableSystem()).toBe('unsupported')
    expect(systemEnabled()).toBe(false)
  })
})

describe('system notifications through the service worker (Android)', () => {
  it('registers notify-sw.js and shows notifications with the item URL in data', async () => {
    fake.throws = true
    const { sw, showNotification } = mockServiceWorker()
    expect(await enableSystem()).toBe('granted')
    expect(sw.register).toHaveBeenCalledWith('/notify-sw.js', { scope: '/' })
    await systemNotify(NOTICE, vi.fn())
    expect(showNotification).toHaveBeenLastCalledWith('הודעה חדשה: מים', expect.objectContaining({
      data: { path: '/announcements', url: expect.stringMatching(/#\/announcements$/) },
    }))
    expect(created).toHaveLength(0)
  })

  it('falls back to the page constructor when showNotification fails', async () => {
    mockServiceWorker(vi.fn(async () => { throw new TypeError('No active registration') }))
    expect(await enableSystem()).toBe('granted')
    expect(created).toHaveLength(1)
  })

  it('a click in the service worker reaches the page as a path to open', () => {
    const { sw } = mockServiceWorker()
    const open = vi.fn()
    const stop = onNotificationOpen(open)
    sw.emit({ type: 'bm-notification-open', path: '/tickets/t1' })
    sw.emit({ type: 'something-else' })
    expect(open).toHaveBeenCalledTimes(1)
    expect(open).toHaveBeenCalledWith('/tickets/t1')
    stop()
    sw.emit({ type: 'bm-notification-open', path: '/x' })
    expect(open).toHaveBeenCalledTimes(1)
  })
})

describe('systemNotify', () => {
  it('shows only while enabled and the tab is hidden; a click focuses and opens', async () => {
    const onOpen = vi.fn()
    await systemNotify(NOTICE, onOpen)
    expect(created).toHaveLength(0)
    await enableSystem()
    created.length = 0
    setHidden(false)
    await systemNotify(NOTICE, onOpen)
    expect(created).toHaveLength(0)
    setHidden(true)
    const focus = vi.spyOn(window, 'focus').mockImplementation(() => undefined)
    await systemNotify(NOTICE, onOpen)
    expect(created).toHaveLength(1)
    expect(created[0].title).toBe('הודעה חדשה: מים')
    created[0].onclick?.()
    expect(focus).toHaveBeenCalled()
    expect(onOpen).toHaveBeenCalled()
    expect(created[0].close).toHaveBeenCalled()
  })

  it('turns itself off if showing starts failing', async () => {
    await enableSystem()
    fake.throws = true
    await systemNotify(NOTICE, vi.fn())
    expect(systemEnabled()).toBe(false)
  })
})
