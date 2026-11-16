const CACHE = '1991-speedrun-20261116-4';
const localUrl = path => new URL(path, self.registration.scope).href;
const INDEX_URL = localUrl('index.html');
const MATTER_URL = 'https://cdnjs.cloudflare.com/ajax/libs/matter-js/0.19.0/matter.min.js';
const IMAGE_PATHS = new Set([
  'suika1.png', 'suika2.png', 'suika3.png', 'suika4.png', 'suika5.png',
  'suika6.png', 'suika7.png', 'suika8_new.png', 'suika9.png', 'suika10.png', 'suika11.png', 'cloud.png',
].map(path => new URL(path, self.registration.scope).pathname));
const ASSETS = [
  'index.html', 'style.css?v=20260519-review2',
  'speedrun.css?v=20261116-speedrun-4', 'game.js?v=20261116-speedrun-4',
  'speedrun.js?v=20261116-speedrun-4', 'speedrun-core.js?v=20261116-speedrun-4',
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
  const gameImage = url.origin === self.location.origin && IMAGE_PATHS.has(url.pathname);
  if (gameImage || url.href === MATTER_URL) {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE);
      // 같은 URL이어도 불투명한 외부 응답을 CORS 요청에 재사용하지 않는다.
      const cached = await cache.match(request);
      if (cached && (cached.type !== 'opaque' || request.mode === 'no-cors')) return cached;
      const response = await fetch(request);
      if (response.ok || response.type === 'opaque') {
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
        const cache = await caches.open(CACHE);
        const cached = await cache.match(INDEX_URL);
        if (cached) return cached;
        throw error;
      }
    })());
  } else if (ASSETS.includes(url.href)) {
    event.respondWith(caches.open(CACHE).then(cache => cache.match(request)).then(cached => cached || fetch(request)));
  }
});
