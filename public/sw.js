/* JZac Lead Generator - service worker
   App-shell caching so the PWA opens instantly and works offline for the UI.
   API requests are always network-only (never cached). */

const CACHE = 'jzac-shell-v1';
const SHELL = ['/', '/index.html', '/icon.svg', '/manifest.webmanifest'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Never cache API or cross-origin tile/data requests.
  if (url.pathname.startsWith('/api/')) return;
  if (request.method !== 'GET') return;
  if (url.origin !== self.location.origin) return;

  // Cache-first for same-origin GET assets, falling back to the app shell.
  event.respondWith(
    caches.match(request).then(
      (cached) =>
        cached ||
        fetch(request)
          .then((resp) => {
            const copy = resp.clone();
            caches.open(CACHE).then((c) => c.put(request, copy)).catch(() => {});
            return resp;
          })
          .catch(() => caches.match('/index.html'))
    )
  );
});
