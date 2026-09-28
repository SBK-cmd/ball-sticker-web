// Service Worker สำหรับ Ball Sticker — ทำให้ "เพิ่มลงหน้าจอโฮม" แล้วเปิดได้เหมือนแอป
// และเปิดได้แม้เน็ตหลุดชั่วคราว (ใช้เวอร์ชันที่เคยโหลดไว้ค้างไว้ในเครื่อง)
const CACHE_NAME = 'ball-sticker-v1';
const APP_SHELL = ['./', './index.html', './manifest.json', './icon-192.png', './icon-512.png'];

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
    event.respondWith(
      fetch(event.request)
        .then(res => { caches.open(CACHE_NAME).then(c => c.put(event.request, res.clone())); return res; })
        .catch(() => caches.match(event.request).then(r => r || caches.match('./index.html')))
    );
  } else {
    event.respondWith(
      caches.match(event.request).then(cached => cached || fetch(event.request))
    );
  }
});
