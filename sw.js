// Service Worker สำหรับ Ball Sticker — ทำให้ "เพิ่มลงหน้าจอโฮม" แล้วเปิดได้เหมือนแอป
// และเปิดได้แม้เน็ตหลุดชั่วคราว (ใช้เวอร์ชันที่เคยโหลดไว้ค้างไว้ในเครื่อง)
const CACHE_NAME = 'ball-sticker-v6';
const APP_SHELL = ['./', './index.html', './manifest.json', './icon-192.png', './icon-512.png', './logo.jpg', './logo-160.webp'];
// หน้าแอปเปิดจากแคชทันที (เร็ว) แล้วค่อยเช็กเวอร์ชันใหม่เบื้องหลัง ถ้ามีของใหม่จะขึ้นปุ่มให้แตะโหลด
const FAST_PAGES = /(^\/$|\/index\.html$|\/ball-sticker\.html$|\/preview\.html$)/;

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(APP_SHELL)).catch(() => {})
  );
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))))
  );
  self.clients.claim();
});

// หน้า HTML หลัก: ลองโหลดจากเน็ตก่อนเสมอ (จะได้เห็นเวอร์ชันล่าสุดทันทีที่มีเน็ต) ถ้าโหลดไม่ได้ค่อย fallback ไปใช้ที่แคชไว้
// ไฟล์อื่น (ไอคอน ฯลฯ): ใช้จากแคชก่อนเพื่อความเร็ว ถ้าไม่มีค่อยไปโหลดจากเน็ต
self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  const isHTML = event.request.mode === 'navigate' || event.request.headers.get('accept')?.includes('text/html');
  if (isHTML) {
    const url = new URL(event.request.url);
    const key = url.origin + url.pathname; // เก็บ/อ่านหน้าแอปด้วย URL ไม่มี ?query กันแคชซ้ำหลายชุด
    if (FAST_PAGES.test(url.pathname)) {
      // เปิดจากแคชทันที + โหลดเวอร์ชันล่าสุดเบื้องหลัง ถ้าเปลี่ยนจะบอกหน้าเว็บให้ขึ้นปุ่ม "โหลดเวอร์ชันใหม่"
      event.respondWith(caches.open(CACHE_NAME).then(async cache => {
        const cached = await cache.match(key);
        const net = fetch(event.request, {cache: 'no-cache'}).then(async res => {
          if (res && res.ok) {
            const tag = r => r && (r.headers.get('etag') || r.headers.get('last-modified') || '');
            const changed = cached && tag(cached) && tag(res) && tag(cached) !== tag(res);
            await cache.put(key, res.clone());
            if (changed) self.clients.matchAll({type: 'window'}).then(list => list.forEach(c => c.postMessage({bsUpdated: true})));
          }
          return res;
        });
        if (cached) { event.waitUntil(net.catch(() => {})); return cached; }
        return net.catch(() => caches.match('./index.html'));
      }));
      return;
    }
    event.respondWith(
      fetch(event.request)
        .then(res => { caches.open(CACHE_NAME).then(c => c.put(event.request, res.clone())); return res; })
        .catch(() => caches.match(event.request).then(r => r || caches.match('./index.html')))
    );
  } else {
    if (event.request.cache === 'reload' || event.request.cache === 'no-cache' || event.request.cache === 'no-store') return; // ขอของใหม่จากเซิร์ฟเวอร์ตรงๆ
    event.respondWith(
      caches.match(event.request).then(cached => cached || fetch(event.request))
    );
  }
});

// แจ้งเตือนเด้งบนมือถือ (Web Push จาก worker line-oa): ข้อความลูกค้าใหม่ / เงินเข้า
self.addEventListener('push', event => {
  let d = {};
  try { d = event.data ? event.data.json() : {}; } catch (e) { d = {body: event.data ? event.data.text() : ''}; }
  const title = d.title || 'Ball Sticker';
  event.waitUntil(self.registration.showNotification(title, {
    body: d.body || '', tag: d.tag || undefined, renotify: !!d.tag, icon: 'icon-192.png', badge: 'icon-192.png',
    data: {url: d.url || './'}
  }));
});
self.addEventListener('notificationclick', event => {
  event.notification.close();
  const url = new URL((event.notification.data && event.notification.data.url) || './', self.registration.scope).href;
  event.waitUntil(self.clients.matchAll({type: 'window', includeUncontrolled: true}).then(list => {
    const c = list.find(w => w.url.indexOf(self.registration.scope) === 0);
    if (c) { c.postMessage({open: url}); return c.focus(); }
    return self.clients.openWindow(url);
  }));
});
