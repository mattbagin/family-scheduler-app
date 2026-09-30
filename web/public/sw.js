// Homebase service worker: shows nudges pushed by the home server, and lets the app be installed.

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

self.addEventListener('push', (event) => {
  let msg = {};
  try {
    msg = event.data ? event.data.json() : {};
  } catch {
    msg = { title: 'Homebase', body: event.data ? event.data.text() : '' };
  }
  event.waitUntil(
    self.registration.showNotification(msg.title || 'Homebase', {
      body: msg.body || '',
      tag: msg.tag,
      renotify: !!msg.tag,
      requireInteraction: !!msg.urgent,
      icon: '/icon-192.png',
      badge: '/icon-192.png',
      data: { id: msg.id, url: msg.url || '/' },
      actions: msg.id ? [{ action: 'ack', title: 'Got it' }] : [],
    }),
  );
});

// Tapping "Got it" (or the notification itself) tells the server someone saw it, which stops repeats.
self.addEventListener('notificationclick', (event) => {
  const { id, url } = event.notification.data || {};
  event.notification.close();
  event.waitUntil((async () => {
    if (id) await fetch(`/api/nudges/${id}/ack`, { method: 'POST', credentials: 'same-origin' }).catch(() => {});
    if (event.action === 'ack') return;
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const open = windows.find((w) => new URL(w.url).origin === self.location.origin);
    if (open) {
      await open.focus();
      if (url && 'navigate' in open) await open.navigate(url).catch(() => {});
    } else {
      await self.clients.openWindow(url || '/');
    }
  })());
});

// Browsers occasionally replace a subscription; register the new one so nudges keep arriving.
self.addEventListener('pushsubscriptionchange', (event) => {
  event.waitUntil((async () => {
    const { publicKey } = await (await fetch('/api/push/key', { credentials: 'same-origin' })).json();
    const sub = await self.registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: publicKey });
    await fetch('/api/push/subscribe', {
      method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...sub.toJSON(), label: 'Renewed' }),
    });
  })());
});
