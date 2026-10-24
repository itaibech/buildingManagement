// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { disableSystem, enableSystem, systemEnabled, systemNotify, systemSupported } from './system'

interface FakeNotification {
  title: string
  options?: NotificationOptions
  onclick: (() => void) | null
  close: () => void
}

const created: FakeNotification[] = []
const fake = { permission: 'default' as NotificationPermission, answer: 'granted' as NotificationPermission }

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
    this.title = title
    this.options = options
    created.push(this)
  }
}

const setHidden = (hidden: boolean) => Object.defineProperty(document, 'hidden', { configurable: true, get: () => hidden })
const NOTICE = { kind: 'announcement' as const, text: 'הודעה חדשה: מים', path: '/announcements' }

beforeEach(() => {
  vi.stubGlobal('Notification', MockNotification)
  fake.permission = 'default'
  fake.answer = 'granted'
  created.length = 0
  localStorage.clear()
  setHidden(true)
})
afterEach(() => vi.unstubAllGlobals())

describe('system notifications preference', () => {
  it('asks for permission on enable and stores the choice', async () => {
    expect(systemEnabled()).toBe(false)
    expect(await enableSystem()).toBe('granted')
    expect(MockNotification.requestPermission).toHaveBeenCalled()
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
})

describe('systemNotify', () => {
  it('shows a system notification only while enabled and the tab is hidden; a click focuses and opens', async () => {
    const onOpen = vi.fn()
    systemNotify(NOTICE, onOpen)
    expect(created).toHaveLength(0)
    await enableSystem()
    setHidden(false)
    systemNotify(NOTICE, onOpen)
    expect(created).toHaveLength(0)
    setHidden(true)
    const focus = vi.spyOn(window, 'focus').mockImplementation(() => undefined)
    systemNotify(NOTICE, onOpen)
    expect(created).toHaveLength(1)
    expect(created[0].title).toBe('הודעה חדשה: מים')
    created[0].onclick?.()
    expect(focus).toHaveBeenCalled()
    expect(onOpen).toHaveBeenCalled()
    expect(created[0].close).toHaveBeenCalled()
  })
})
