/* ============================================================
   SERVICE WORKER вЂ” РѕС„Р»Р°Р№РЅ-СЂРµР¶РёРј
   РРіСЂР° РїРѕР»РЅРѕСЃС‚СЊСЋ СЂР°Р±РѕС‚Р°РµС‚ Р±РµР· РёРЅС‚РµСЂРЅРµС‚Р°: РєСЌС€РёСЂСѓРµРј РІСЃРµ С„Р°Р№Р»С‹.
   ============================================================ */

const CACHE = 'soberi-slovo-v4';

const ASSETS = [
  './',
  './index.html',
  './css/style.css',
  './js/words.js',
  './js/levels.js',
  './js/game.js',
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon.svg',
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE)
      .then((cache) => cache.addAll(ASSETS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  e.respondWith(
    caches.match(e.request).then((hit) => {
      if (hit) return hit;
      return fetch(e.request)
        .then((res) => {
          // РљСЌС€РёСЂСѓРµРј С‚РѕР»СЊРєРѕ СѓСЃРїРµС€РЅС‹Рµ РѕС‚РІРµС‚С‹ СЃРІРѕРµРіРѕ РїСЂРѕРёСЃС…РѕР¶РґРµРЅРёСЏ
          if (res && res.ok && res.type === 'basic') {
            const copy = res.clone();
            caches.open(CACHE).then((cache) => cache.put(e.request, copy));
          }
          return res;
        })
        .catch(() => caches.match('./index.html'));
    })
  );
});