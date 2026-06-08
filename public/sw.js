// NovaFi service worker — installability + fast static loads, WITHOUT ever
// serving stale financial data. Strategy:
//   • /api/*           → not handled here (network-only; always live data)
//   • navigations      → network-first, fall back to cache, then offline page
//   • static assets    → stale-while-revalidate (instant loads, refresh in bg)
// Bump VERSION to invalidate old caches on deploy.
const VERSION = 'v1';
const STATIC_CACHE = `novafi-static-${VERSION}`;
const OFFLINE_URL = '/offline.html';
const PRECACHE = [OFFLINE_URL, '/manifest.json', '/icon-192.png', '/icon-512.png'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(STATIC_CACHE);
      await cache.addAll(PRECACHE);
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter((k) => k.startsWith('novafi-') && k !== STATIC_CACHE)
          .map((k) => caches.delete(k)),
      );
      await self.clients.claim();
    })(),
  );
});

// Let a waiting worker activate immediately when the page asks it to.
self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  // Only handle same-origin; let Google APIs/fonts/auth pass straight through.
  if (url.origin !== self.location.origin) return;
  // Never cache financial data or auth endpoints.
  if (url.pathname.startsWith('/api/')) return;

  // Page navigations: prefer the network so data is always current; fall back
  // to any cached copy, then the offline shell.
  if (request.mode === 'navigate') {
    event.respondWith(
      (async () => {
        try {
          return await fetch(request);
        } catch {
          return (await caches.match(request)) || (await caches.match(OFFLINE_URL));
        }
      })(),
    );
    return;
  }

  // Static assets: serve from cache instantly, revalidate in the background.
  const isStatic =
    url.pathname.startsWith('/_next/static') ||
    url.pathname === '/manifest.json' ||
    /\.(?:js|css|png|svg|jpg|jpeg|webp|gif|ico|woff2?)$/.test(url.pathname);

  if (isStatic) {
    event.respondWith(
      (async () => {
        const cache = await caches.open(STATIC_CACHE);
        const cached = await cache.match(request);
        const network = fetch(request)
          .then((res) => {
            if (res && res.status === 200) cache.put(request, res.clone());
            return res;
          })
          .catch(() => cached);
        return cached || network;
      })(),
    );
  }
});
