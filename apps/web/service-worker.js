const allowed = new Set(shellUrls);

self.addEventListener('install', event => {
  event.waitUntil(caches.open(shellCache).then(cache => cache.addAll(shellUrls.map(path =>
    new Request(path, { cache: 'reload', credentials: 'omit' })
  ))));
});
self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) {
      if (key.startsWith('tala-shell-') && key !== shellCache) await caches.delete(key);
    }
    await self.clients.claim();
  })());
});
self.addEventListener('message', event => {
  if (event.data === 'ACTIVATE_UPDATE') event.waitUntil(self.skipWaiting());
});
self.addEventListener('fetch', event => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin || /^\/api(?:\/|$)/i.test(url.pathname) ||
      request.headers.has('Authorization')) return;
  if (request.mode === 'navigate') {
    event.respondWith(fetch(request).catch(async () => (await caches.open(shellCache)).match('/index.html')));
  } else if (!url.search && allowed.has(url.pathname)) {
    event.respondWith(caches.open(shellCache).then(async cache => (await cache.match(url.pathname)) || fetch(request)));
  }
});
