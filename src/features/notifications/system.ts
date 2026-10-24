// Optional browser (system) notifications while the app is open in a hidden tab. Not Web Push: that needs a
// push server and VAPID keys, which this app doesn't have. Android Chrome can't construct notifications from the
// page ("Illegal constructor"), so they go through a minimal service worker (public/notify-sw.js: no fetch handler,
// no caching; it only opens the app when a notification is tapped). Elsewhere `new Notification()` is the fallback.
import { he } from '../../lib/he'
import type { Notice } from './rules'

const KEY = 'bm-system-notifications'
const OPEN_MESSAGE = 'bm-notification-open'
const BASE = import.meta.env.BASE_URL

export type EnableResult = 'granted' | 'denied' | 'unsupported'

let worker: Promise<ServiceWorkerRegistration | null> | null = null

/** Forget the cached worker registration (tests). */
export function resetSystemState(): void {
  worker = null
}

export function systemSupported(): boolean {
  return typeof window !== 'undefined' && typeof window.Notification === 'function'
}

/** On when the user turned it on here and the browser still allows it. */
export function systemEnabled(): boolean {
  return systemSupported() && localStorage.getItem(KEY) === '1' && Notification.permission === 'granted'
}

/** The browser already refuses notifications for this site. */
export function systemDenied(): boolean {
  return systemSupported() && Notification.permission === 'denied'
}

export function disableSystem(): void {
  localStorage.removeItem(KEY)
}

/** Registers notify-sw.js once and waits until it is active; null where service workers aren't available. */
export function registerNotifyWorker(): Promise<ServiceWorkerRegistration | null> {
  if (worker) return worker
  const sw = typeof navigator !== 'undefined' ? navigator.serviceWorker : undefined
  worker = sw
    ? sw.register(`${BASE}notify-sw.js`, { scope: BASE }).then(() => sw.ready, () => null)
    : Promise.resolve(null)
  return worker
}

const appUrl = (path: string): string => `${location.origin}${location.pathname}#${path}`

function showFromPage(title: string, options: NotificationOptions, onOpen?: () => void): boolean {
  try {
    const n = new Notification(title, options)
    n.onclick = () => {
      window.focus()
      onOpen?.()
      n.close()
    }
    return true
  } catch {
    return false
  }
}

/** Shows a system notification (service worker first, then the page); false when neither can. */
async function showSystem(title: string, body: string | undefined, path: string, onOpen?: () => void): Promise<boolean> {
  const options: NotificationOptions = {
    body, tag: path, lang: 'he', dir: 'rtl', icon: `${BASE}icon-192.png`, data: { path, url: appUrl(path) },
  }
  const registration = await registerNotifyWorker()
  if (registration) {
    try {
      await registration.showNotification(title, options)
      return true
    } catch {
      // fall through to the page constructor
    }
  }
  return showFromPage(title, options, onOpen)
}

/** Asks the browser for permission, confirms with a notification and remembers the choice. */
export async function enableSystem(): Promise<EnableResult> {
  if (!systemSupported()) return 'unsupported'
  const permission = Notification.permission === 'granted' ? 'granted' : await Notification.requestPermission()
  if (permission !== 'granted') return 'denied'
  if (!(await showSystem(he.notifications.systemOn, undefined, '/'))) return 'unsupported'
  localStorage.setItem(KEY, '1')
  return 'granted'
}

/** Shows a system notification when enabled and the tab is hidden; turns itself off if showing fails. */
export async function systemNotify(notice: Notice, onOpen: () => void): Promise<void> {
  if (!document.hidden || !systemEnabled()) return
  if (!(await showSystem(notice.text, notice.detail, notice.path, onOpen))) disableSystem()
}

/** Paths the service worker asks the page to open after a notification tap. Returns the unsubscribe function. */
export function onNotificationOpen(open: (path: string) => void): () => void {
  const sw = typeof navigator !== 'undefined' ? navigator.serviceWorker : undefined
  if (!sw) return () => undefined
  const listener = (e: MessageEvent<unknown>) => {
    const data = e.data
    if (typeof data === 'object' && data !== null && 'type' in data && data.type === OPEN_MESSAGE && 'path' in data && typeof data.path === 'string') {
      open(data.path)
    }
  }
  sw.addEventListener('message', listener)
  return () => sw.removeEventListener('message', listener)
}
