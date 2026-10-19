// myTracker: офлайн-запуск. Сначала сеть (чтобы всегда была свежая версия), без сети — копия с телефона.
const CACHE = 'mytracker-v7';
// мусхаф: шрифты страниц и разметка хранятся отдельно и не удаляются при обновлении сайта
const MCACHE = 'mytracker-mushaf';
const PCACHE = 'mytracker-push'; // адрес сервера и ключ подписки для уведомлений
const SHELL = ['./', 'index.html', 'i18n.js?v=7', 'app.js?v=7', 'styles.css?v=7', 'config.js?v=7', 'manifest.json', 'version.json', 'icons/icon-192.png',
  'fonts/amiri-400.woff2', 'fonts/amiri-700.woff2'];
const MUSHAF_HOSTS = ['cdn.jsdelivr.net', 'static-cdn.tarteel.ai'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => Promise.all(SHELL.map((u) => c.add(u).catch(() => {})))).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE && k !== MCACHE && k !== PCACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
/** Сначала с телефона, иначе из сети (и сохранить). Для файлов мусхафа, которые не меняются. */
function cacheFirst(req) {
  return caches.open(MCACHE).then((c) => c.match(req.url).then((hit) => hit || fetch(req).then((res) => {
    if (res.ok) c.put(req.url, res.clone());
    return res;
  })));
}
self.addEventListener('fetch', (e) => {
  const req = e.request; if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (MUSHAF_HOSTS.indexOf(url.hostname) >= 0) { e.respondWith(cacheFirst(req)); return; }
  if (url.origin !== location.origin) return; // запросы к Apps Script не трогаем
  if (/\/quran\/[a-z0-9]+\.json$/.test(url.pathname)) { e.respondWith(cacheFirst(req)); return; }
  // файлы сайта — всегда свежие с сервера (проверка по ETag, без долгого кэша браузера); без сети — копия с телефона
  if (/\/version\.json$/.test(url.pathname)) { e.respondWith(fetch(req)); return; }
  e.respondWith(
    fetch(new Request(req.url, { cache: 'no-cache', credentials: 'same-origin' })).then((res) => {
      if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); }
      return res;
    }).catch(() => caches.match(req).then((r) => r || (req.mode === 'navigate' ? caches.match('index.html') : undefined)))
  );
});

// уведомление с сервера (Web Push): «толчок» без текста — текст забираем у своего Apps Script по ключу подписки
self.addEventListener('push', (e) => {
  e.waitUntil((async () => {
    let items = [];
    try {
      const r = await (await caches.open(PCACHE)).match('push-cfg'), cfg = r && (await r.json());
      if (cfg && cfg.api && cfg.pk) {
        const res = await fetch(cfg.api, { method: 'POST', body: JSON.stringify({ action: 'pushMsg', pk: cfg.pk }) });
        const j = await res.json(); items = (j && j.data && j.data.items) || [];
      }
    } catch (x) {}
    if (!items.length) items = [{ t: 'myTracker', b: 'Напоминание — откройте приложение', tag: 'mt' }];
    await Promise.all(items.map((it) => self.registration.showNotification(it.t, { body: it.b, tag: it.tag || 'mt', icon: 'icons/icon-192.png', badge: 'icons/icon-192.png', renotify: true })));
  })());
});

// нажатие на уведомление открывает приложение
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
    const w = list.find((c) => 'focus' in c);
    return w ? w.focus() : self.clients.openWindow('./');
  }));
});
