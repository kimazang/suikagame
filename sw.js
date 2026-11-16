const CACHE = '1991-speedrun-20261116-2';
const localUrl = path => new URL(path, self.registration.scope).href;
const INDEX_URL = localUrl('index.html');
const MATTER_URL = 'https://cdnjs.cloudflare.com/ajax/libs/matter-js/0.19.0/matter.min.js';
const ASSETS = [
  'index.html', 'style.css?v=20260519-review2',
  'speedrun.css?v=20261116-speedrun-2', 'game.js?v=20261116-speedrun-2',
  'speedrun.js?v=20261116-speedrun-2', 'speedrun-core.js?v=20261116-speedrun-2',
].map(localUrl);

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(key => key.startsWith('1991-') && key !== CACHE).map(key => caches.delete(key)));
    await self.clients.claim();
    // Do not reload somebody's active game. The next navigation gets fresh HTML.
  })());
});

self.addEventListener('fetch', event => {
  const request = event.request;
  const url = new URL(request.url);
  // In particular, do not intercept Auth/Firestore or other cross-origin APIs.
  if (request.method !== 'GET') return;
  const gameImage = request.destination === 'image'
    && url.origin === 'https://raw.githubusercontent.com'
    && url.pathname.startsWith('/kimazang/suikagame/main/');
  if (gameImage || url.href === MATTER_URL) {
    event.respondWith((async () => {
      const cached = await caches.match(request);
      if (cached) return cached;
      const response = await fetch(request);
      if (response.ok || response.type === 'opaque') {
        const cache = await caches.open(CACHE);
        await cache.put(request, response.clone());
      }
      return response;
    })());
    return;
  }
  if (url.origin !== self.location.origin) return;
  if (request.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        const response = await fetch(request);
        if (response.ok) {
          const cache = await caches.open(CACHE);
          await cache.put(INDEX_URL, response.clone());
        }
        return response;
      } catch (error) {
        const cached = await caches.match(INDEX_URL);
        if (cached) return cached;
        throw error;
      }
    })());
  } else if (ASSETS.includes(url.href)) {
    event.respondWith(caches.match(request).then(cached => cached || fetch(request)));
  }
});
