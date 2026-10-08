// Offline support: keep the app files and the OCR library on the phone.
// Change VERSION after editing any app file so phones pick up the new copy.
const VERSION = 'sts-expenses-v5';
const SHELL = ['./', 'index.html', 'styles.css', 'config.js', 'db.js', 'fx.js', 'ocr.js', 'ai.js', 'graph.js',
  'app.js', 'manifest.json', 'icon-180.png', 'icon-192.png', 'icon-512.png'];
const CACHE_HOSTS = ['cdn.jsdelivr.net', 'tessdata.projectnaptha.com', 'fonts.googleapis.com', 'fonts.gstatic.com'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET') return;
  const own = url.origin === location.origin;
  if (!own && !CACHE_HOSTS.includes(url.hostname)) return; // APIs (Graph, Gemini, rates) always go to the network
  e.respondWith(
    caches.match(e.request).then((hit) => hit || fetch(e.request).then((res) => {
      if (res.ok || res.type === 'opaque') {
        const copy = res.clone();
        caches.open(VERSION).then((c) => c.put(e.request, copy));
      }
      return res;
    }))
  );
});
