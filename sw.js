// ARENA X ESPORTS - Service Worker
// হোম পেজ ফোনে জমা থাকে, তাই অ্যাপ খুললে সাথে সাথে স্ক্রিন আসে। পেছনে নতুন কপি নামায়।
// নতুন ভার্সন পেলে পেজকে জানায়, আর পেজ নিজে একবার রিলোড হয়ে নতুন ভার্সন দেখায়।
const CACHE = 'arenax-v3';

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
    .then(async r => {
      if (r && r.ok) {
        try {
          const cache = await caches.open(CACHE);
          const old = await cache.match('/');
          let changed = !old;
          if (old) changed = (await old.text()) !== (await r.clone().text());
          await cache.put('/', r.clone());
          if (old && changed) {
            const cs = await self.clients.matchAll({ type: 'window' });
            cs.forEach(c => c.postMessage({ type: 'NEW_VERSION' }));
          }
        } catch (_) {}
      }
      return r;
    })
    .catch(() => null);

  e.waitUntil(net);
  e.respondWith(
    caches.match('/').then(cached => cached || net.then(r => r || Response.error()))
  );
});
