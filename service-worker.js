const CACHE_NAME = 'the-stacks-v22';
const APP_SHELL = [
  './',
  './index.html',
  './manifest.json',
  './logo.png',
  './icon-192.png',
  './icon-512.png'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(APP_SHELL))
  );
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// App shell: cache-first (works offline).
// Everything else (fonts, MusicBrainz lookups, Quagga): network-first,
// falling back to cache if offline — lookups just won't work offline.
self.addEventListener('fetch', event => {
  const isAppShell = APP_SHELL.some(path =>
    event.request.url.endsWith(path.replace('./', '/'))
  ) || event.request.mode === 'navigate';

  if (isAppShell) {
    event.respondWith(
      caches.match(event.request).then(cached => cached || fetch(event.request))
    );
  } else {
    event.respondWith(
      fetch(event.request)
        .then(res => {
          const resClone = res.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, resClone));
          return res;
        })
        .catch(() => caches.match(event.request))
    );
  }
});
