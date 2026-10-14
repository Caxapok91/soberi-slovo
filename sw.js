/* ============================================================
   SERVICE WORKER — офлайн-режим
   Игра полностью кэшируется при первом запуске: нужные файлы
   кладутся в кэш, остальное отдаётся из сети.

   Два решения, на которые стоит обратить внимание:

   1. Файлы кэшируем по одному, а не пачкой. Если хотя бы один
      файл не найден, addAll обрывает всю установку — и офлайн
      не работает вовсе. Здесь каждый файл — отдельной попыткой,
      ошибка не мешает остальным.

   2. Сначала сеть, потом кэш (для кода) — чтобы выложенная на
      GitHub Pages новая версия доезжала до игроков. Раньше файл
      мог годами лежать в кэше, и правки в GitHub были бы не видны.
      Сеть медленная или недоступна — отдаём кэш, офлайн работает.
   ============================================================ */

// При выкладке новой версии подними число: старый кэш удалится сам.
const CACHE = 'soberi-slovo-v6';

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
      .then((cache) => Promise.all(
        ASSETS.map((url) => fetch(url, { cache: 'reload' })
          .then((res) => {
            if (res && res.ok) return cache.put(url, res);
            return null;
          })
          .catch(() => null))
      ))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;

  const req = e.request;
  const url = new URL(req.url);

  // Чужие домены (аналитика, шрифты) не трогаем
  if (url.origin !== self.location.origin) return;

  // Навигация: сеть, при неудаче — главная из кэша
  if (req.mode === 'navigate') {
    e.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put('./index.html', copy));
          return res;
        })
        .catch(() => caches.match('./index.html')
          .then((hit) => hit || caches.match('./')))
    );
    return;
  }

  // Код и оформление: сеть вперёд, кэш — если сеть молчит.
  // Кэш при этом обновляется, чтобы следующий запуск был быстрым.
  const netFirst = ASSETS.includes(url.pathname.replace(/^.*\/soberi-slovo\//, './'))
                || /\.(?:js|css|json|png|svg)$/.test(url.pathname);

  if (netFirst) {
    e.respondWith(
      fetch(req)
        .then((res) => {
          if (res && res.ok && res.type === 'basic') {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(req, copy));
          }
          return res;
        })
        .catch(() => caches.match(req))
    );
    return;
  }

  e.respondWith(
    caches.match(req).then((hit) => hit || fetch(req))
  );
});