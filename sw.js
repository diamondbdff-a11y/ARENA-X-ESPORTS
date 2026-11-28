// ARENA X ESPORTS - Service Worker
// হোম পেজ ফোনে জমা থাকে, তাই অ্যাপ খুললে সাথে সাথে লোগো স্ক্রিন আসে। পেছনে নতুন কপি নামিয়ে রাখে (পরের বার খুললে নতুন দেখাবে)।
const CACHE = 'arenax-v2';

self.addEventListener('install', e => {
  self.skipWaiting();
  e.waitUntil(caches.open(CACHE).then(c => c.add('/')).catch(() => {}));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET' || req.mode !== 'navigate') return;
  const p = new URL(req.url).pathname;
  // শুধু হোম পেজ; admin.html বা অন্য পেজ সরাসরি নেট থেকে আসবে
  if (p !== '/' && p !== '/index.html') return;

  const net = fetch(req)
    .then(r => {
      if (r && r.ok) {
        const copy = r.clone();
        caches.open(CACHE).then(c => c.put('/', copy)).catch(() => {});
      }
      return r;
    })
    .catch(() => null);

  e.waitUntil(net);
  e.respondWith(
    caches.match('/').then(cached => cached || net.then(r => r || Response.error()))
  );
});
