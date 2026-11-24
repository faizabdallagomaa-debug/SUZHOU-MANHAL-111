/* Suzhou Manhal — admin service worker: push notifications for new customer messages */
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));

self.addEventListener('push', event => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch { data = { body: event.data && event.data.text() }; }
  const title = data.title || 'سوجو منهل — رسالة جديدة';
  event.waitUntil(self.registration.showNotification(title, {
    body: data.body || '',
    icon: '/assets/img/icon-192.png',
    badge: '/assets/img/icon-192.png',
    tag: data.tag || 'sm-message',
    renotify: true,
    requireInteraction: false,
    dir: 'rtl',
    lang: 'ar',
    vibrate: [200, 100, 200],
    data: { url: data.url || '/admin/#messages' }
  }));
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || '/admin/#messages';
  event.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const c of all) {
      if (c.url.includes('/admin/')) { c.postMessage({ url }); return c.focus(); }
    }
    return self.clients.openWindow(url);
  })());
});

// network-only fetch handler (required by some browsers for installability)
self.addEventListener('fetch', () => {});
