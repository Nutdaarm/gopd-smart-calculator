// ===== Service Worker v18 — Network First (dev-friendly) =====
// HTML/CSS/JS = network first (เห็นการแก้ทันที, ออฟไลน์ใช้ cache)
// รูป/manifest = cache first (โหลดเร็ว)
const CACHE_NAME = 'gopd-app-v18';
const FILES_TO_CACHE = [
  './', './index.html', './styles.css', './app.js', './auth.js',
  './manifest.json', './icon-192.png', './icon-512.png'
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME)
      .then(c => c.addAll(FILES_TO_CACHE))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then(keys => Promise.all(
      keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))
    )).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  if (!e.request.url.startsWith(self.location.origin)) return;

  const url = new URL(e.request.url);
  const isCode = /\.(html|css|js)$/i.test(url.pathname) ||
                 url.pathname.endsWith('/') ||
                 e.request.mode === 'navigate';

  if (isCode) {
    // Network first: โหลดของใหม่ก่อนเสมอ ถ้าเน็ตล่มค่อยใช้ cache
    e.respondWith(
      fetch(e.request).then(net => {
        if (net && net.status === 200) {
          const clone = net.clone();
          caches.open(CACHE_NAME).then(c => c.put(e.request, clone));
        }
        return net;
      }).catch(() =>
        caches.match(e.request).then(c => c || caches.match('./index.html'))
      )
    );
  } else {
    // Cache first: รูป/ไอคอน/manifest
    e.respondWith(
      caches.match(e.request).then(cached => {
        if (cached) return cached;
        return fetch(e.request).then(net => {
          if (net && net.status === 200) {
            const clone = net.clone();
            caches.open(CACHE_NAME).then(c => c.put(e.request, clone));
          }
          return net;
        });
      })
    );
  }
});

self.addEventListener('message', (e) => {
  if (e.data && e.data.type === 'SKIP_WAITING') self.skipWaiting();
});