// myTracker: офлайн-запуск. Сначала сеть (чтобы всегда была свежая версия), без сети — копия с телефона.
const CACHE = 'mytracker-v6';
const SHELL = ['./', 'index.html', 'i18n.js?v=6', 'app.js?v=6', 'styles.css?v=6', 'config.js?v=6', 'manifest.json', 'icons/icon-192.png',
  'fonts/amiri-400.woff2', 'fonts/amiri-700.woff2'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => Promise.all(SHELL.map((u) => c.add(u).catch(() => {})))).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return; // запросы к Apps Script не трогаем
  e.respondWith(
    fetch(req).then((res) => {
      if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); }
      return res;
    }).catch(() => caches.match(req).then((r) => r || (req.mode === 'navigate' ? caches.match('index.html') : undefined)))
  );
});

// нажатие на уведомление открывает приложение
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
    const w = list.find((c) => 'focus' in c);
    return w ? w.focus() : self.clients.openWindow('./');
  }));
});
