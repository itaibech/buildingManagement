// Minimal service worker for system notifications (Android Chrome can only show them from a worker).
// No fetch handler and no caching: it never touches the app's requests. Its only job is to open the app at the
// notification's item when one is tapped (registered from src/features/notifications/system.ts).
self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()))

async function openItem(data) {
  const path = data && typeof data.path === 'string' ? data.path : '/'
  const url = data && typeof data.url === 'string' ? data.url : self.registration.scope
  const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
  const client = windows.find((c) => c.url.startsWith(self.registration.scope))
  if (client) {
    await client.focus()
    client.postMessage({ type: 'bm-notification-open', path })
    return
  }
  await self.clients.openWindow(url)
}

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  event.waitUntil(openItem(event.notification.data))
})
