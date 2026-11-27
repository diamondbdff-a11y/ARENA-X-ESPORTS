// ARENA X ESPORTS - সহজ Service Worker (সবসময় নতুন কোড নেয়, নেট না থাকলে শুধু হোম পেজ দেখায়)
const CACHE = 'arenax-v1';
self.addEventListener('install', e => { self.skipWaiting(); e.waitUntil(caches.open(CACHE).then(c => c.add('/')).catch(() => {})); });
self.addEventListener('activate', e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET' || req.mode !== 'navigate') return;
  e.respondWith(fetch(req).then(r => { const copy = r.clone(); caches.open(CACHE).then(c => c.put('/', copy)).catch(() => {}); return r; }).catch(() => caches.match('/')));
});
