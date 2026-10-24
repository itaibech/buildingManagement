// Optional browser (system) notifications while the app is open in a hidden tab. Not Web Push: that needs a
// push server, a service worker and VAPID keys, which this app doesn't have.
import type { Notice } from './rules'

const KEY = 'bm-system-notifications'

export type EnableResult = 'granted' | 'denied' | 'unsupported'

export function systemSupported(): boolean {
  return typeof window !== 'undefined' && typeof window.Notification === 'function'
}

/** On when the user turned it on here and the browser still allows it. */
export function systemEnabled(): boolean {
  return systemSupported() && localStorage.getItem(KEY) === '1' && Notification.permission === 'granted'
}

/** Asks the browser for permission (once) and remembers the choice. */
export async function enableSystem(): Promise<EnableResult> {
  if (!systemSupported()) return 'unsupported'
  const permission = Notification.permission === 'granted' ? 'granted' : await Notification.requestPermission()
  if (permission !== 'granted') return 'denied'
  localStorage.setItem(KEY, '1')
  return 'granted'
}

export function disableSystem(): void {
  localStorage.removeItem(KEY)
}

/** Shows a system notification when enabled and the tab is hidden; a click focuses the tab and opens the item. */
export function systemNotify(notice: Notice, onOpen: () => void): void {
  if (!document.hidden || !systemEnabled()) return
  const n = new Notification(notice.text, { body: notice.detail, tag: notice.path, lang: 'he', dir: 'rtl' })
  n.onclick = () => {
    window.focus()
    onOpen()
    n.close()
  }
}
