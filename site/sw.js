const CACHE = 'offerte-agenti-v24';
const ASSETS = [
  '/',
  '/index.html',
  '/offerta',
  '/configurazione.html',
  '/gestione-ordini.html',
  '/giro-visite.html',
  '/offer-app.js',
  '/config/companyConfig.js',
  '/styles.css',
  '/dense.css',
  '/roles.css',
  '/data.css',
  '/seed-data.json',
  '/manifest.webmanifest',
  '/favicon.svg'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE).then(cache => cache.addAll(ASSETS)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (url.pathname.startsWith('/api/')) return;

  // Network-First for HTML, JS and JSON configuration so updates are immediately visible on all devices
  const isNetworkFirst = event.request.mode === 'navigate' ||
    url.pathname.endsWith('.html') ||
    url.pathname.endsWith('.js') ||
    url.pathname.endsWith('.json') ||
    url.pathname === '/offerta' ||
    url.pathname === '/';

  if (isNetworkFirst) {
    event.respondWith(
      fetch(event.request)
        .then(response => {
          if (response && response.status === 200) {
            const copy = response.clone();
            caches.open(CACHE).then(c => c.put(event.request, copy));
          }
          return response;
        })
        .catch(() => caches.match(event.request).then(hit => hit || caches.match('/')))
    );
    return;
  }

  event.respondWith(
    caches.match(event.request).then(hit => hit || fetch(event.request).then(response => {
      const copy = response.clone();
      caches.open(CACHE).then(c => c.put(event.request, copy));
      return response;
    }))
  );
});
