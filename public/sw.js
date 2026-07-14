/* JZac Lead Generator - service worker
   App-shell caching so the PWA opens instantly and works offline for the UI.
   API requests are always network-only (never cached). */

const CACHE = 'jzac-shell-v2';
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

  // Never cache API or cross-origin requests.
  if (url.pathname.startsWith('/api/')) return;
  if (request.method !== 'GET') return;
  if (url.origin !== self.location.origin) return;

  const isShell =
    request.mode === 'navigate' || url.pathname === '/' || url.pathname === '/index.html';

  // NETWORK-FIRST for the app shell. index.html references build-hashed asset
  // filenames, so serving a cached copy after a redeploy points the app at
  // files that no longer exist and it fails to start. Fall back to cache only
  // when genuinely offline.
  if (isShell) {
    event.respondWith(
      fetch(request)
        .then((resp) => {
          const copy = resp.clone();
          caches.open(CACHE).then((c) => c.put('/index.html', copy)).catch(() => {});
          return resp;
        })
        .catch(() => caches.match('/index.html'))
    );
    return;
  }

  // Cache-first is safe for everything else: Vite fingerprints asset filenames,
  // so a new build produces new URLs rather than reusing stale ones.
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
