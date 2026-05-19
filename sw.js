const CACHE = '1991-v1';
const ASSETS = [
  '/suikagame/',
  '/suikagame/index.html',
  '/suikagame/style.css',
  '/suikagame/game.js',
  'https://cdnjs.cloudflare.com/ajax/libs/matter-js/0.19.0/matter.min.js',
  'https://raw.githubusercontent.com/kimazang/suikagame/main/1991_favicon.png',
  'https://raw.githubusercontent.com/kimazang/suikagame/main/suika1.png?v=1991-9',
  'https://raw.githubusercontent.com/kimazang/suikagame/main/suika2.png?v=1991-9',
  'https://raw.githubusercontent.com/kimazang/suikagame/main/suika3.png?v=1991-9',
  'https://raw.githubusercontent.com/kimazang/suikagame/main/suika4.png?v=1991-9',
  'https://raw.githubusercontent.com/kimazang/suikagame/main/suika5.png?v=1991-9',
  'https://raw.githubusercontent.com/kimazang/suikagame/main/suika6.png?v=1991-9',
  'https://raw.githubusercontent.com/kimazang/suikagame/main/suika7.png?v=1991-9',
  'https://raw.githubusercontent.com/kimazang/suikagame/main/suika8.png?v=1991-9',
  'https://raw.githubusercontent.com/kimazang/suikagame/main/suika9.png?v=1991-9',
  'https://raw.githubusercontent.com/kimazang/suikagame/main/suika10.png?v=1991-9',
  'https://raw.githubusercontent.com/kimazang/suikagame/main/suika11.png?v=1991-9',
  'https://raw.githubusercontent.com/kimazang/suikagame/main/cloud.png?v=1991-9',
];

// 설치: 핵심 파일 캐시
self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting())
  );
});

// 활성화: 이전 캐시 삭제
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

// 요청: 캐시 우선, 없으면 네트워크
self.addEventListener('fetch', e => {
  // Firebase / Firestore 요청은 캐시 안 함 (항상 최신 랭킹 필요)
  if (e.request.url.includes('firestore') || e.request.url.includes('firebase')) return;

  e.respondWith(
    caches.match(e.request).then(cached => cached || fetch(e.request))
  );
});
