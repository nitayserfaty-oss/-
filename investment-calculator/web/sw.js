// Offline cache for the PWA build.
const CACHE = 'invcalc-v1';
const FILES = ['./', './index.html', './css/styles.css', './js/data.js', './js/calc.js', './js/charts.js', './js/app.js',
  './icon.svg', './manifest.webmanifest'];
self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  // network first, fall back to cache (so updates arrive when online)
  e.respondWith(fetch(e.request).then((res) => {
    const copy = res.clone();
    caches.open(CACHE).then((c) => c.put(e.request, copy)).catch(() => {});
    return res;
  }).catch(() => caches.match(e.request)));
});
