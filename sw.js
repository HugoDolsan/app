/* Service worker — cache-first app shell, so the PWA works offline */
const CACHE = 'planej-hd-v10';
const SHELL = ['./', './index.html', './styles.css', './app.js', './seed.js',
               './manifest.json', './icon-192.png', './icon-512.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  /* never intercept the Apps Script sync calls */
  if (url.hostname.includes('script.google')) return;
  if (e.request.method !== 'GET') return;
  e.respondWith(
    caches.match(e.request).then(hit => hit ||
      fetch(e.request).then(res => {
        /* runtime-cache fonts and same-origin files */
        if (res.ok && (url.origin === location.origin || url.hostname.includes('fonts.'))) {
          const copy = res.clone();
          caches.open(CACHE).then(c => c.put(e.request, copy));
        }
        return res;
      }).catch(() => caches.match('./index.html'))
    )
  );
});
