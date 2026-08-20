const CACHE_NAME = 'banopolis-' + Date.now();
const urlsToCache = [
  './',
  './index.html',
  './manifest.json',
  './icons/android-chrome-192x192.png',
  './icons/android-chrome-512x512.png',
  './src/css/styles.css',
  './src/js/app.js'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(urlsToCache))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((names) =>
      Promise.all(names.filter(n => n !== CACHE_NAME).map(n => caches.delete(n)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  // Cache-first strategy for same-origin requests
  if (event.request.url.startsWith(self.location.origin)) {
    event.respondWith(
      caches.match(event.request).then((cached) => cached || fetch(event.request).then(res => {
        // Optionally put runtime-cached responses into a runtime cache
        const copy = res.clone();
        caches.open('runtime-' + CACHE_NAME).then(cache => cache.put(event.request, copy));
        return res;
      }).catch(() => {
        // fallback to cache if network fails
        return caches.match('./index.html');
      }))
    );
  }
});
