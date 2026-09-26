/* Puja el número de VERSIO cada cop que publiquis canvis: això fa que els
   mòbils esborrin la còpia antiga i es quedin només amb la nova. */
const VERSIO = 'v16';
const CACHE = 'rendiment-mcbf-' + VERSIO;

// L'app sencera es precarrega: al vestidor sovint no hi ha cobertura i el
// formulari s'ha de poder omplir igualment.
const APP = [
  './', './index.html', './app.js', './manifest.json',
  './icon-192.png', './icon-512.png', './icon-512-maskable.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(APP)));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);

  // L'Apps Script va sempre a la xarxa: cap dada de salut es guarda a la
  // cache del navegador. El que cal conservar ja és al magatzem de l'app.
  if (url.origin !== self.location.origin) return;
  if (req.method !== 'GET') return;

  const esCodi = req.mode === 'navigate' || req.destination === 'document' ||
                 url.pathname.endsWith('.html') || url.pathname.endsWith('.js') ||
                 url.pathname.endsWith('/');

  if (esCodi) {
    // Xarxa primer, amb la còpia local com a xarxa de seguretat.
    event.respondWith(
      fetch(req.url, { cache: 'no-store', credentials: 'same-origin' })
        .then((res) => {
          const copia = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copia));
          return res;
        })
        .catch(() => caches.match(req).then((c) => c || caches.match('./index.html')))
    );
    return;
  }

  event.respondWith(
    caches.match(req).then((cached) => cached || fetch(req).then((res) => {
      if (res.ok) {
        const copia = res.clone();
        caches.open(CACHE).then((c) => c.put(req, copia));
      }
      return res;
    }))
  );
});
