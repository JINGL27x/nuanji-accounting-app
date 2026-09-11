// 暖记 · 记账本 Service Worker：缓存应用外壳，支持离线使用与「安装」。
const CACHE = 'nuanji-v7';
const SHELL = [
  './',
  './index.html',
  './manifest.webmanifest',
  './styles.css',
  './js/app.js',
  './js/db.js',
  './js/speech.js',
  './js/charts.js',
  './js/format.js',
  './assets/icon.svg',
  './assets/icon-maskable.svg',
  './assets/icon-512.png',
  './assets/icon-maskable-512.png'
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  // 网络优先，失败回退缓存（保证数据类请求不走缓存，仅静态资源离线可用）
  e.respondWith(
    fetch(req).catch(() => caches.match(req).then((r) => r || caches.match('./index.html')))
  );
});
