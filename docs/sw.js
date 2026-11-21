// Service worker: permite instalar la app y abrirla sin conexión
// (la generación con IA sí necesita internet; el editor de fotos funciona offline).
const CACHE = 'lumina-v1';
const SHELL = ['./', 'index.html', 'styles.css', 'app.js', 'engine.js', 'models.js', 'manifest.webmanifest',
  'icons/icon-192.png', 'icons/icon-512.png',
  'https://cdn.jsdelivr.net/npm/@gradio/client@2.8.0/dist/index.min.js'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  const isShell = e.request.method === 'GET' && (url.origin === location.origin || url.href.startsWith('https://cdn.jsdelivr.net/npm/@gradio/client@'));
  if (!isShell) return; // las llamadas a la IA van directas a la red
  // Red primero (para recibir actualizaciones), caché si no hay conexión
  e.respondWith(fetch(e.request).then((r) => {
    if (r.ok) { const copy = r.clone(); caches.open(CACHE).then((c) => c.put(e.request, copy)); }
    return r;
  }).catch(() => caches.match(e.request, { ignoreSearch: true }).then((r) => r || caches.match('index.html'))));
});
