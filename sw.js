// WynnPages Studio — Service Worker for iOS PWA & Push Notifications
const CACHE_NAME = 'wynn-studio-pwa-v4';
const PRECACHE_ASSETS = [
  '/admin.html',
  '/manifest.json',
  '/assets/favicon.png',
  '/assets/icon-192.png?v=3',
  '/assets/icon-512.png?v=3',
  '/assets/apple-touch-icon.png?v=3',
  '/assets/fonts.css'
];

self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(PRECACHE_ASSETS).catch(() => {});
    })
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    Promise.all([
      self.clients.claim(),
      caches.keys().then((keys) => {
        return Promise.all(
          keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
        );
      })
    ])
  );
});

// Real-Time Web Push Event Listener
self.addEventListener('push', (event) => {
  let data = {};
  if (event.data) {
    try {
      data = event.data.json();
    } catch (_) {
      data = { title: 'WynnPages Studio Alert', body: event.data.text() };
    }
  }

  const title = data.title || 'WynnPages Studio Alert';
  const options = {
    body: data.body || 'Client activity detected on WynnPages.',
    icon: data.icon || '/assets/icon-192.png',
    badge: '/assets/apple-touch-icon.png',
    tag: data.tag || 'wynn-activity-' + Date.now(),
    renotify: true,
    vibrate: [200, 100, 200],
    data: {
      url: data.url || '/admin.html',
      timestamp: Date.now()
    }
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

// Tap Notification -> Focus or Open Admin
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const targetUrl = (event.notification.data && event.notification.data.url) || '/admin.html';

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if (client.url.includes('/admin') && 'focus' in client) {
          return client.focus();
        }
      }
      if (clients.openWindow) {
        return clients.openWindow(targetUrl);
      }
    })
  );
});

// Network-First with Cache Fallback for Navigation
self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);

  // Skip API endpoints, non-GET, or external requests
  if (req.method !== 'GET' || url.pathname.startsWith('/api/') || url.origin !== self.location.origin) {
    return;
  }

  event.respondWith(
    fetch(req)
      .then((res) => {
        if (res && res.status === 200 && res.type === 'basic') {
          const resClone = res.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(req, resClone)).catch(() => {});
        }
        return res;
      })
      .catch(() => {
        return caches.match(req).then((cached) => cached || caches.match('/admin.html'));
      })
  );
});

