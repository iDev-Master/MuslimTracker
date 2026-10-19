/*
 * myTracker v4 — фронтенд.
 * Работает «сначала на телефоне»:
 *  • все данные загружаются одним запросом и хранятся на телефоне (srv);
 *  • любое сохранение сразу попадает в очередь (outbox) и сразу видно в списках и дашбордах;
 *  • очередь отправляется, когда есть интернет (сразу, раз в минуту, при сворачивании, при появлении сети);
 *  • дашборды за любой период считаются на телефоне — без запросов.
 */
(function () {
  'use strict';

  const APP_VERSION = 6; // должна совпадать с APP_VERSION в Code.gs
  const SITE_VER = '7'; // версия сайта: совпадает с version.json — по ней телефон сам узнаёт об обновлении
  const API = (window.APP_CONFIG || {}).API_URL;
  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));
  // язык интерфейса: русский в коде, английский — словарём i18n.js (тексты в DOM переводятся сами)
  const I18N = window.I18N || { lang: 'ru', tr: (x) => x };
  const LANG = I18N.lang, T = (x) => I18N.tr(x), LOC = LANG === 'en' ? 'en-US' : 'ru-RU';
  const confirmT = (m) => window.confirm(T(m));

  // ключ, арабское название, русское (для подсказок)
  const PRAYERS = [
    ['fajr', 'الفجر', 'Фаджр'], ['duha', 'الضحى', 'Духа'], ['zuhr', 'الظهر', 'Зухр'], ['asr', 'العصر', 'Аср'],
    ['maghrib', 'المغرب', 'Магриб'], ['isha', 'العشاء', 'Иша'], ['witr', 'الوتر', 'Витр']
  ];
  const PKEYS = PRAYERS.map((p) => p[0]);
  const P_AR = Object.fromEntries(PRAYERS.map((p) => [p[0], p[1]]));
  const FARD = ['fajr', 'zuhr', 'asr', 'maghrib', 'isha'];
  // статусы намаза: цвет и смысл задаются позицией в справочнике (имя можно переименовать)
  // 0–1 — вовремя, 2 — поздно, 3 — када, 4 — кафара, 5 — нет данных
  const ST_CLS = ['st-jamaah', 'st-best', 'st-late', 'st-qadho', 'st-kaf', 'st-none'];
  const stIdx = (s) => (meta && s ? meta.statuses.indexOf(s) : -1);
  // стандартные цвета статусов (светлая тема); свои цвета — в Настройки → Молитвы → Статусы
  const ST_DEFAULT = ['#1e7a34', '#4d7c0f', '#a15c00', '#1f1f1f', '#6a3fb5', '#6f6f6f'];
  const ST_VAR = ['--st-jamaah', '--st-best', '--st-late', '--st-qadho', '--st-kaf', '--st-none'];
  /** Свои цвета статусов. В тёмной теме слишком тёмный цвет осветляется, чтобы его было видно. */
  function applyStatusColors(list) {
    const cols = list || ((meta && meta.config && meta.config.statuses) || {}).colors || [];
    const lum = (hex) => { const n = parseInt(hex.slice(1), 16), c = [n >> 16, (n >> 8) & 255, n & 255].map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.04045) / 1.055, 2.4); }); return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; };
    let light = '', dark = '';
    cols.forEach((c, i) => {
      if (!/^#[0-9a-f]{6}$/i.test(c || '') || !ST_VAR[i]) return;
      light += `${ST_VAR[i]}:${c};`;
      dark += `${ST_VAR[i]}:${lum(c) < 0.12 ? `color-mix(in srgb, ${c} 25%, #ffffff)` : c};`;
    });
    let el = document.getElementById('stColors');
    if (!el) { el = document.createElement('style'); el.id = 'stColors'; document.head.appendChild(el); }
    el.textContent = light ? `:root{${light}} @media (prefers-color-scheme: dark){:root:not([data-theme="light"]){${dark}}} :root[data-theme="dark"]{${dark}}` : '';
  }
  const stc = (s) => 'st ' + (ST_CLS[stIdx(s)] || 'st-none');
  const isOnTime = (s) => { const i = stIdx(s); return i === 0 || i === 1; };
  const noData = () => (meta && meta.statuses[5]) || 'No data';
  const SHORT = { 'Best time': 'Best', 'Kafaraha': 'Kaf.', 'No data': '—' };
  const stShort = (s) => (stIdx(s) === 5 ? '—' : SHORT[s] || s);
  const cfg = () => (meta && meta.config) || {};
  // названия молитв: наборы и свои названия (Настройки → Молитвы)
  const P_PRESETS = {
    ar: { fajr: 'الفجر', duha: 'الضحى', zuhr: 'الظهر', asr: 'العصر', maghrib: 'المغرب', isha: 'العشاء', witr: 'الوتر', makruh: 'وقت الكراهة' },
    ru: { fajr: 'Фаджр', duha: 'Духа', zuhr: 'Зухр', asr: 'Аср', maghrib: 'Магриб', isha: 'Иша', witr: 'Витр', makruh: 'Время заката' },
    en: { fajr: 'Fajr', duha: 'Duha', zuhr: 'Dhuhr', asr: 'Asr', maghrib: 'Maghrib', isha: 'Isha', witr: 'Witr', makruh: 'Sunset' },
    tj: { fajr: 'Бомдод', duha: 'Чошт', zuhr: 'Пешин', asr: 'Аср', maghrib: 'Шом', isha: 'Хуфтан', witr: 'Витр', makruh: 'Вақти макрӯҳ' }
  };
  const isAr = (s) => /[\u0600-\u06FF]/.test(s || '');
  const pcfg = () => Object.assign({ preset: 'ar', names: {}, show: { duha: true, witr: true } }, cfg().prayers || {});
  /** Название молитвы для плиток (как выбрано в настройках). */
  const pName = (k) => { const c = pcfg(); return (c.preset === 'custom' && c.names && c.names[k]) || (P_PRESETS[c.preset] || P_PRESETS.ar)[k] || P_PRESETS.en[k]; };
  /** Для компактных таблиц дашборда арабское письмо заменяем латиницей. */
  const pNameDash = (k) => (isAr(pName(k)) ? P_PRESETS.en[k] : pName(k));
  const pSpan = (k, cls) => { const n = pName(k); return isAr(n) ? `<span class="${cls || ''}" lang="ar" dir="rtl">${n}</span>` : `<span class="${cls || ''} plain" data-noi18n>${esc(n)}</span>`; };
  const showP = (k) => (k !== 'duha' && k !== 'witr') || (pcfg().show || {})[k] !== false;
  const VK = () => PKEYS.filter(showP);
  // сколько дней показывать в списках — из настроек модулей
  const DAYS = { get prayers() { return settings.prayer.days; }, get reading() { return settings.quran.days; }, get finance() { return settings.finance.days; } };

  // ── хранилище (безопасно: приватный режим и т.п.)
  const store = {
    get(k, def) { try { const v = localStorage.getItem(k); return v == null ? def : JSON.parse(v); } catch (e) { return def; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} },
    del(k) { try { localStorage.removeItem(k); } catch (e) {} }
  };

  let token = store.get('lt_token', null);
  let meta = store.get('lt_meta', null);
  if (meta && !meta.pairs) meta = null;                     // кэш старой версии
  let srv = store.get('lt_srv', null);                      // данные с сервера: {ver, prayers, reading, finance}
  if (srv && srv.prayers && srv.prayers[0] && srv.prayers[0].length < 9) srv = null; // до появления «Духа»
  let outbox = store.get('lt_outbox', []);                  // ещё не отправленные изменения
  let sent = store.get('lt_sent', []);                      // отправленные, но ещё не подтянутые с сервера
  let times = store.get('lt_times', []);
  let hidden = store.get('lt_hidden', { prayers: [], reading: [], finance: [] });
  // настройки хранятся на этом телефоне; у каждого модуля своя секция
  const DEFAULT_SETTINGS = {
    autoSend: true, theme: 'auto', startTab: 'last', dateFmt: 'dmy',
    prayer: { fill: 1, autoNext: true, showTile: true, days: 7 },
    quran: { kind: '', type: 'pages', continuePages: true, days: 10, fresh: 7, stale: 30 },
    finance: { currency: 'с', days: 10, numpad: true },
    dash: { period: 'last', account: '', cards: {} }, wv: 0,
    undo: { prayers: true, quran: true, finance: true, hide: true, keep: 60, tabOnly: true },
    widgets: [],
    mushaf: { kind: 'v4', tj: 'std', colors: {}, size: 100, keepLines: true, auto: true, secs: 50, autoKind: 0 }
  };
  const deepMerge = (d, v) => { const o = Array.isArray(d) ? (Array.isArray(v) ? v : d) : Object.assign({}, d);
    if (!Array.isArray(d) && v && typeof v === 'object') Object.keys(v).forEach((k) => { o[k] = d[k] && typeof d[k] === 'object' && !Array.isArray(d[k]) ? deepMerge(d[k], v[k]) : v[k]; });
    return o; };
  let settings = deepMerge(DEFAULT_SETTINGS, store.get('lt_settings', {}));
  const saveSettings = () => store.set('lt_settings', settings);
  function applyTheme() { if (settings.theme === 'auto') delete document.documentElement.dataset.theme; else document.documentElement.dataset.theme = settings.theme; }
  applyTheme();
  let lastSync = store.get('lt_lastSync', 0);

  // перенос неотправленного списка финансов из версии 3
  (function migrateLocal() {
    const q = store.get('lt_queue', null);
    if (Array.isArray(q) && q.length) q.forEach((it) => outbox.push({ id: uid(), op: 'addFinance', p: it }));
    ['lt_queue', 'lt_data', 'lt_stats_10d', 'lt_stats_month', 'lt_stats_prev', 'lt_stats_year', 'lt_stats_all'].forEach(store.del);
    store.set('lt_outbox', outbox);
  })();

  // ── мелкие помощники
  function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 8); }
  const pad = (n) => String(n).padStart(2, '0');
  const iso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const today = () => iso(new Date());
  const addDays = (s, n) => { const d = new Date(s + 'T12:00:00'); d.setDate(d.getDate() + n); return iso(d); };
  // формат даты — в Настройки → Общие (одинаковый во всём приложении, в том числе в полях даты)
  const MON = { ru: ['янв.', 'февр.', 'мар.', 'апр.', 'мая', 'июн.', 'июл.', 'авг.', 'сент.', 'окт.', 'нояб.', 'дек.'], en: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] };
  const WD = { ru: ['Вс', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'], en: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] };
  function ru(s) {
    if (!s) return '';
    const [y, m, d] = String(s).slice(0, 10).split('-'); if (!d) return s;
    const f = (typeof settings !== 'undefined' && settings.dateFmt) || 'dmy', L = (window.I18N && window.I18N.lang) === 'en' ? 'en' : 'ru';
    if (f === 'mdy') return `${m}/${d}/${y}`;
    if (f === 'ymd') return `${y}-${m}-${d}`;
    if (f === 'dmy-') return `${d}-${m}-${y}`;
    if (f === 'long') return L === 'en' ? `${MON.en[m - 1]} ${Number(d)}, ${y}` : `${Number(d)} ${MON.ru[m - 1]} ${y}`;
    return `${d}.${m}.${y}`;
  }
  /** Текст в поле даты: «Сб, 17.10.2026», для сегодняшнего дня — «Сегодня, …». */
  function dateLabel(v) {
    if (!v) return '—';
    const L = (window.I18N && window.I18N.lang) === 'en' ? 'en' : 'ru', wd = WD[L][new Date(v + 'T12:00').getDay()];
    const t = iso(new Date());
    return (v === t ? (L === 'en' ? 'Today' : 'Сегодня') : v === addDays(t, -1) ? (L === 'en' ? 'Yesterday' : 'Вчера') : wd) + ', ' + ru(v);
  }
  /** Поле даты показывает дату в выбранном формате; само системное поле прозрачное поверх — открывает календарь телефона. */
  const VALUE = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
  function enhanceDate(input) {
    if (input.dataset.enh) return; input.dataset.enh = '1';
    let wrap = input.closest('.date-field');
    if (!wrap) { wrap = document.createElement('label'); wrap.className = 'date-field'; input.parentNode.insertBefore(wrap, input); const sp = document.createElement('span'); sp.className = 'date-text'; wrap.appendChild(sp); wrap.appendChild(input); }
    const text = wrap.querySelector('.date-text'), paint = () => { text.textContent = dateLabel(VALUE.get.call(input)); };
    Object.defineProperty(input, 'value', { configurable: true, get() { return VALUE.get.call(this); }, set(v) { VALUE.set.call(this, v); paint(); } });
    input.addEventListener('input', paint); input.addEventListener('change', paint);
    input.addEventListener('click', () => { try { input.showPicker && input.showPicker(); } catch (e) {} });
    paint();
  }
  const enhanceDates = (root) => $$('input[type=date]', root || document).forEach(enhanceDate);
  enhanceDates();
  const repaintDates = () => $$('input[type=date]').forEach((i) => { const t = i.closest('.date-field'); if (t) t.querySelector('.date-text').textContent = dateLabel(VALUE.get.call(i)); });
  const money = (n) => (Number(n) || 0).toLocaleString(LOC, { maximumFractionDigits: 2 });
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const isTmp = (id) => String(id).indexOf('tmp:') === 0;
  // новые сверху: по дате, затем неотправленные, затем по номеру
  const byNewest = (di) => (a, b) => (a[di] !== b[di] ? (a[di] < b[di] ? 1 : -1)
    : isTmp(a[0]) !== isTmp(b[0]) ? (isTmp(a[0]) ? -1 : 1) : (Number(b[0]) || 0) - (Number(a[0]) || 0));

  let toastTimer;
  /** Короткое сообщение внизу. undoEntry — показать кнопку «Отменить». */
  function toast(msg, isErr, undoEntry) {
    const t = $('#toast');
    t.textContent = msg; t.className = 'toast show' + (isErr ? ' err' : '') + (undoEntry ? ' has-act' : '');
    if (undoEntry) {
      const b = document.createElement('button'); b.type = 'button'; b.className = 'toast-act'; b.textContent = 'Отменить';
      b.onclick = () => { t.className = 'toast'; doUndo(undoEntry.id); };
      t.appendChild(b);
    }
    clearTimeout(toastTimer); toastTimer = setTimeout(() => (t.className = 'toast'), undoEntry ? 5000 : 2600);
  }

  // ── сеть
  async function api(action, payload = {}) {
    if (!API || API.indexOf('PASTE_') === 0) throw new Error('Укажите API_URL в config.js');
    let res;
    try { res = await fetch(API, { method: 'POST', body: JSON.stringify(Object.assign({ action, token }, payload)) }); }
    catch (e) { const err = new Error('Нет связи с сервером'); err.offline = true; throw err; }
    let j;
    try { j = await res.json(); } catch (e) { const err = new Error('Сервер не ответил'); err.offline = true; throw err; }
    checkVersion(j.v, j.b);
    if (!j.ok) {
      if (j.error === 'OLD_SERVER' || j.error === 'Неизвестное действие') { oldServer(); throw new Error(j.message || 'Apps Script устарел: замените Code.gs и сделайте новое развертывание'); }
      if (j.error === 'AUTH') { logout(true); const err = new Error(j.message || 'Нужно войти'); err.auth = true; throw err; }
      throw new Error(j.error || 'Ошибка');
    }
    return j.data !== undefined ? j.data : j;
  }

  // ── версии сайта и сервера должны совпадать
  function banner(html, onClick) { const b = $('#banner'); b.innerHTML = html; b.classList.remove('hidden'); b.onclick = onClick || null; }
  const NEED_BUILD = 13; // какая сборка Code.gs нужна этому сайту
  function oldServer() { banner('Apps Script устарел: замените <b>Code.gs</b> и сделайте <b>Развертывания → Управление → ✏ → Новая версия</b>.'); }
  function checkVersion(v, b) {
    if (v === APP_VERSION && (b || 0) < NEED_BUILD) { oldServer(); return; }
    if (!v || v === APP_VERSION) return;
    if (v > APP_VERSION) {
      let tried = false; try { tried = sessionStorage.getItem('lt_reload') === String(v); sessionStorage.setItem('lt_reload', String(v)); } catch (e) {}
      if (!tried) { location.reload(); return; }
      banner('Вышла новая версия приложения. <b>Нажмите, чтобы обновить</b>', () => location.reload());
    } else {
      banner('Сервер ещё на старой версии: в Apps Script откройте <b>Развертывания → Управление → ✏ → Новая версия</b>.');
    }
  }
  function reportError(msg) { console.error(msg); banner('Что-то пошло не так. <b>Нажмите, чтобы перезагрузить</b>', () => location.reload()); }
  window.addEventListener('error', (e) => reportError(e.message));
  window.addEventListener('unhandledrejection', (e) => { if (!(e.reason && (e.reason.offline || e.reason.auth))) reportError(e.reason && e.reason.message); });

  async function withBusy(btn, fn) {
    btn.disabled = true; btn.classList.add('busy');
    try { await fn(); } catch (e) { if (!e.auth) toast(e.message, true); } finally { btn.disabled = false; btn.classList.remove('busy'); }
  }

  function autoGrow(el) { el.style.height = 'auto'; el.style.height = Math.min(el.scrollHeight + 2, 320) + 'px'; }
  $$('textarea').forEach((t) => t.addEventListener('input', () => autoGrow(t)));
  function setText(el, v) { el.value = v || ''; autoGrow(el); }

  // ═════════════ Данные: сервер + очередь = то, что видно ═════════════
  let viewCache = null;
  function changed() { viewCache = null; statsMemo = {}; }
  function persist() { store.set('lt_outbox', outbox); store.set('lt_sent', sent); }

  const suraBy = (n) => (meta && meta.suras.find((s) => s.n === Number(n))) || { name: '', ayahs: 0 };
  // первая страница каждой суры в мусхафе на 604 страницы (Мадинский)
  const SURA_PAGE = [1, 2, 50, 77, 106, 128, 151, 177, 187, 208, 221, 235, 249, 255, 262, 267, 282, 293, 305, 312, 322, 332, 342, 350, 359, 367, 377, 385, 396, 404,
    411, 415, 418, 428, 434, 440, 446, 453, 458, 467, 477, 483, 489, 496, 499, 502, 507, 511, 515, 518, 520, 523, 526, 528, 531, 534, 537, 542, 545, 549,
    551, 553, 554, 556, 558, 560, 562, 564, 566, 568, 570, 572, 574, 575, 577, 578, 580, 582, 583, 585, 586, 587, 587, 589, 590, 591, 591, 592, 593, 594,
    595, 595, 596, 596, 597, 597, 598, 598, 599, 599, 600, 600, 601, 601, 601, 602, 602, 602, 603, 603, 603, 604, 604, 604];
  const suraPages = (n) => { const a = SURA_PAGE[n - 1], nx = n < 114 ? SURA_PAGE[n] : 605; return [a, Math.max(a, nx - 1)]; };
  /** «1-20, 582-604» → номера страниц. */
  function parsePages(str) {
    const out = new Set();
    String(str || '').split(/[,;\s]+/).forEach((part) => {
      const m = /^(\d{1,3})(?:[-–](\d{1,3}))?$/.exec(part.trim()); if (!m) return;
      const a = Math.max(1, Number(m[1])), b = Math.min(604, Number(m[2] || m[1]));
      for (let p = a; p <= b; p++) out.add(p);
    });
    return out;
  }
  /** Суры на странице. */
  const surasOnPage = (p) => { const out = []; for (let n = 1; n <= 114; n++) { const [a, b] = suraPages(n); if (p >= a && p <= b) out.push(n); else if (a > p) break; } return out.length ? out : [1]; };
  /** Состояние суры на карте хифза: сколько её страниц заучено и когда их повторяли. */
  function suraHifz(st, n) {
    const [a, b] = suraPages(n); let m = 0, oldest = null, newest = null;
    for (let p = a; p <= b; p++) if (st.memPages.has(p)) { m++; const t = st.touch[p] || ''; if (oldest === null || t < oldest) oldest = t; if (!newest || t > newest) newest = t; }
    const full = st.memSuras.has(n) || m === b - a + 1;
    // дата — по записям именно этой суры (страница может быть общей с соседней сурой)
    const h = readingHistory(a, b, n), pre = hifzPre();
    let last = [h[1] && h[1].last, h[2] && h[2].last].filter(Boolean).sort().pop() || '';
    if (pre.date && (pre.suras.indexOf(n) >= 0 || pre.pages.has(a)) && pre.date > last) last = pre.date;
    return { a, b, m, total: b - a + 1, full, part: m > 0 || full, last: last || (full ? oldest || newest : newest) };
  }
  /** Записи Корана, касающиеся страниц a..b или суры n: сколько раз и когда. */
  function readingHistory(a, b, n) {
    const K = meta.kinds, out = K.map(() => ({ count: 0, reps: 0, last: '' }));
    view().reading.forEach((r) => {
      let hit = n && Number(r[9]) === n;
      if (!hit && r[4] !== '' && r[5] !== '') hit = Number(r[4]) <= b && Number(r[5]) >= a;
      if (!hit && !n && r[9] !== '') { const [x, y] = suraPages(Number(r[9])); hit = x <= b && y >= a; }
      if (!hit) return;
      const i = K.indexOf(r[2]); if (i < 0) return;
      const o = out[i]; o.count++; o.reps += Number(r[7]) || 1; if (r[1] > o.last) o.last = r[1];
    });
    return out;
  }
  const ago = (d) => { if (!d) return ''; const n = daysBetween(d, today()); return n <= 0 ? 'сегодня' : n === 1 ? 'вчера' : `${n} дн. назад`; };
  function hifzDetailHtml(st, opt) {
    const pre = hifzPre();
    let n, a, b, title;
    if (opt.sura) { n = opt.sura; [a, b] = suraPages(n); }
    else { a = b = opt.page; n = null; }
    const suras = n ? [n] : surasOnPage(a);
    title = n ? `Сура ${n}. ${esc(suraBy(n).name)}` : `Страница ${a}`;
    const sub = n ? `${a === b ? 'Стр. ' + a : `Стр. ${a}–${b}`} · ${suraBy(n).ayahs} аятов` : 'Сура: ' + suras.map((x) => `${x}. ${esc(suraBy(x).name)}`).join(', ');
    let status;
    if (n) { const h = suraHifz(st, n); status = h.full ? 'Заучена' : h.part ? `Заучено ${h.m} из ${h.total} стр.` : 'Не заучена'; }
    else status = st.memPages.has(a) ? 'Заучена' : 'Не заучена';
    const last = n ? suraHifz(st, n).last : st.touch[a];
    const hist = readingHistory(a, b, n), K = meta.kinds;
    const fromPre = n ? pre.suras.indexOf(n) >= 0 : pre.pages.has(a);
    const rows = K.map((k, i) => `<tr><td>${esc(k)}</td><td>${hist[i].count ? `${hist[i].count} ${hist[i].count === 1 ? 'раз' : 'раз(а)'}${hist[i].reps > hist[i].count ? ` · ×${hist[i].reps}` : ''}` : '—'}</td><td>${hist[i].last ? `${ru(hist[i].last)} <span class="muted">(${ago(hist[i].last)})</span>` : ''}</td></tr>`).join('');
    return `<div class="hz-d-head"><b>${title}</b><span class="hz-badge ${status === 'Заучена' ? 'ok' : status === 'Не заучена' ? '' : 'part'}">${status}</span></div>
      <div class="muted">${sub}</div>
      ${last ? `<div>Последний раз: <b>${ru(last)}</b> <span class="muted">(${ago(last)})</span></div>` : st.memPages.has(a) || (n && suraHifz(st, n).part) ? '<div class="muted">Повторений пока не было</div>' : ''}
      ${fromPre ? `<div class="muted">Отмечено как заученное ранее${pre.date ? ' · ' + ru(pre.date) : ''}</div>` : ''}
      <table class="mini hz-hist"><tr><th>Вид</th><th>Записей</th><th>Последний раз</th></tr>${rows}</table>
      <button type="button" class="btn small-btn ghost" data-mopen="${a}">📖 Читать${n ? ' суру' : ''} · стр. ${a}</button>`;
  }
  /** Заучено ранее: страницы (из сур и диапазонов), суры и дата. */
  function hifzPre() {
    const h = (meta && meta.config && meta.config.hifz) || {}, pages = parsePages(h.pages);
    (h.suras || []).forEach((n) => { const [a, b] = suraPages(n); for (let p = a; p <= b; p++) pages.add(p); });
    return { pages, suras: h.suras || [], date: h.date || '' };
  }
  function readingRow(id, p) {
    const reps = Math.max(1, Math.floor(Number(p.repeats) || 1));
    if (p.type === 'pages') {
      const a = Number(p.from), b = Number(p.to), pages = b - a + 1;
      return [id, p.date, p.kind, 'Страницы', a, b, pages, reps, pages * reps, '', '', '', '', p.comment || ''];
    }
    const n = Number((p.suras || [])[0]), s = suraBy(n);
    return [id, p.date, p.kind, 'Сура', '', '', '', reps, '', n, s.name, s.ayahs, s.ayahs * reps, p.comment || ''];
  }
  // как в таблице: 0 ID, 1 дата, 2 сумма, 3 действие, 4 категория, 5 комментарий, 6 создано, 7 поток ±, 8 счёт, 9 на счёт
  const financeRow = (id, p) => [id, p.date, Number(p.amount), p.actionType, p.category || '', p.comment || '', '', '', p.account || '', p.toAccount || '', p.person || ''];
  const prayerRow = (p) => [p.date].concat(PKEYS.map((k) => p[k] || ''), [p.comment || '']);

  function view() {
    if (viewCache) return viewCache;
    const base = srv || { prayers: [], reading: [], finance: [] };
    const pr = new Map(base.prayers.map((r) => [r[0], r.slice()]));
    const rd = base.reading.map((r) => r.slice());
    const fi = base.finance.map((r) => r.slice());
    const pending = new Set();
    const apply = (o, isPending) => {
      if (o.op === 'savePrayer') { pr.set(o.p.date, prayerRow(o.p)); if (isPending) pending.add('p:' + o.p.date); }
      if (o.op === 'addReading') { rd.push(readingRow('tmp:' + o.id, o.p)); if (isPending) pending.add('r:tmp:' + o.id); }
      if (o.op === 'updateReading') { const i = rd.findIndex((r) => String(r[0]) === String(o.p.id)); if (i >= 0) rd[i] = readingRow(rd[i][0], o.p); if (isPending) pending.add('r:' + o.p.id); }
      if (o.op === 'addFinance') { fi.push(financeRow('tmp:' + o.id, o.p)); if (isPending) pending.add('f:tmp:' + o.id); }
      if (o.op === 'updateFinance') { const i = fi.findIndex((r) => String(r[0]) === String(o.p.id)); if (i >= 0) fi[i] = financeRow(fi[i][0], o.p); if (isPending) pending.add('f:' + o.p.id); }
      if (o.op === 'deleteFinance') { const i = fi.findIndex((r) => String(r[0]) === String(o.p.id)); if (i >= 0) fi.splice(i, 1); }
      if (o.op === 'deleteReading') { const i = rd.findIndex((r) => String(r[0]) === String(o.p.id)); if (i >= 0) rd.splice(i, 1); }
    };
    sent.forEach((o) => apply(o, false));
    outbox.forEach((o) => apply(o, true));
    viewCache = { prayers: pr, reading: rd, finance: fi, pending };
    return viewCache;
  }

  // ── очередь изменений
  function enqueue(op, p, key) {
    const ex = key && outbox.find((o) => o.key === key && !o.sending);
    let o = ex;
    if (ex) { ex.p = p; delete ex.err; } else { o = { id: uid(), op, p, key }; outbox.push(o); }
    persist(); changed(); renderAll();
    return o;
  }
  const opById = (tmpId) => outbox.find((o) => 'tmp:' + o.id === String(tmpId));

  let flushing = false, flushTimer = null, online = navigator.onLine !== false;
  function scheduleFlush(ms) { clearTimeout(flushTimer); flushTimer = setTimeout(() => flush(), ms == null ? 400 : ms); }

  /** Отправляет очередь. Новые записи финансов уходят одной пачкой. */
  async function flush(opts = {}) {
    if (!token || flushing) return;
    const ready = outbox.filter((o) => !o.err && (opts.all || o.op !== 'addFinance' || settings.autoSend || opts.finance));
    if (!ready.length) { renderPending(); return; }
    flushing = true; renderPending();
    let sentAny = false; const sentKinds = {};
    try {
      for (;;) {
        const queue = outbox.filter((o) => !o.err && (opts.all || o.op !== 'addFinance' || settings.autoSend || opts.finance));
        if (!queue.length) break;
        const head = queue[0];
        const batch = head.op === 'addFinance' ? queue.filter((o) => o.op === 'addFinance') : [head];
        batch.forEach((o) => { o.sending = true; });
        try {
          let res;
          if (head.op === 'addFinance') res = await api('addFinance', { items: batch.map((o) => Object.assign({ opId: o.id }, o.p)) });
          else res = await api(head.op, Object.assign({ opId: head.id }, head.p));
          // номера новых записей нужны, чтобы отменить их позже
          if (res && res.byOp) Object.keys(res.byOp).forEach((k) => { opIds[k] = { ids: [res.byOp[k]], at: Date.now() }; });
          else if (res && res.ids && head.op === 'addReading') opIds[head.id] = { ids: res.ids, at: Date.now() };
          store.set('lt_opids', opIds);
        } catch (e) {
          batch.forEach((o) => { delete o.sending; });
          if (e.offline || e.auth) throw e;
          batch.forEach((o) => { o.err = e.message; }); // ошибка в данных — не блокируем остальную очередь
          persist(); toast('Не удалось сохранить: ' + e.message, true);
          continue;
        }
        const ids = new Set(batch.map((o) => o.id));
        outbox = outbox.filter((o) => !ids.has(o.id));
        batch.forEach((o) => { delete o.sending; sent.push(o); sentKinds[o.op] = (sentKinds[o.op] || 0) + 1; });
        persist(); sentAny = true; setOnline(true);
      }
    } catch (e) {
      if (e.offline) setOnline(false);
    } finally {
      flushing = false; changed(); renderAll();
    }
    if (sentAny) {
      if (opts.notify) {
        const parts = [], k = sentKinds;
        if (k.savePrayer) parts.push('молитвы: ' + k.savePrayer);
        if (k.addReading || k.updateReading) parts.push('Коран: ' + ((k.addReading || 0) + (k.updateReading || 0)));
        if (k.addFinance || k.updateFinance) parts.push('финансы: ' + ((k.addFinance || 0) + (k.updateFinance || 0)));
        toast('Отправлено ✓ ' + parts.join(', '));
      }
      scheduleSync(opts.notify ? 300 : 2500);
    }
  }
  let syncTimer = null;
  function scheduleSync(ms) { clearTimeout(syncTimer); syncTimer = setTimeout(() => sync(), ms); }

  /** Подтянуть данные с сервера. Если ничего не менялось — сервер отвечает коротко. */
  let syncing = false;
  async function sync(force) {
    if (!token || syncing) return;
    syncing = true; renderPending();
    try {
      const b = await api('bootstrap', { ver: force || !srv || !meta ? null : srv.ver });
      setOnline(true);
      lastSync = Date.now(); store.set('lt_lastSync', lastSync);
      if (!b.unchanged) {
        srv = { ver: b.ver, prayers: b.data.prayers, reading: b.data.reading, finance: b.data.finance };
        sent = []; meta = b.meta; times = b.times || [];
        // настройки, которые ещё ждут отправки, не должны пропасть после загрузки с сервера
        outbox.filter((o) => o.op === 'saveConfig').forEach((o) => { meta.config = Object.assign({}, meta.config, { [o.p.key]: o.p.value }); });
        store.set('lt_srv', srv); store.set('lt_meta', meta); store.set('lt_times', times); persist();
        changed(); initUi();
      }
      renderAll();
    } catch (e) { if (e.offline) setOnline(false); else if (!e.auth) toast(e.message, true); }
    finally { syncing = false; renderPending(); }
  }

  function setOnline(v) { if (online !== v) { online = v; renderPending(); } }
  window.addEventListener('online', () => { setOnline(true); flush({ all: settings.autoSend }); });
  window.addEventListener('offline', () => setOnline(false));
  setInterval(() => { if (settings.autoSend) flush(); }, 60 * 1000);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') { if (settings.autoSend) flush(); }
    else if (Date.now() - lastSync > 2 * 60 * 1000) { flush(); sync(); }
  });

  function renderPending() {
    const n = outbox.length, errs = outbox.filter((o) => o.err).length;
    const bar = $('#pendingBar');
    if (!n && online) { bar.classList.add('hidden'); }
    else {
      bar.classList.remove('hidden');
      bar.className = 'pending' + (!online ? ' off' : '') + (errs ? ' err' : '');
      bar.textContent = !online
        ? (n ? `📴 Нет интернета · Ждут отправки: ${n} — уйдут, когда появится связь` : '📴 Нет интернета · Данные сохраняются на телефоне')
        : flushing ? `⏳ Отправка… (${n})`
        : errs ? `⚠ С ошибкой: ${errs} · Не отправлено: ${n} — нажмите, чтобы повторить`
        : `⏳ Не отправлено: ${n} — нажмите, чтобы отправить сейчас`;
    }
    $('#saveBadge').textContent = n; $('#saveBadge').classList.toggle('hidden', !n || currentTab === 'dash');
    $('#syncInfo') && ($('#syncInfo').textContent = `Обновлено: ${lastSync ? new Date(lastSync).toLocaleString(LOC, { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—'} · В очереди: ${n}`);
  }
  $('#pendingBar').addEventListener('click', () => {
    outbox.forEach((o) => { delete o.err; }); persist();
    if (!online && navigator.onLine === false) { toast('Нет интернета — отправится автоматически, когда появится связь'); return; }
    flush({ all: true, notify: true });
  });

  // ── вход / выход
  function showLogin() { $('#login').classList.remove('hidden'); $('#app').classList.add('hidden'); $('#password').focus(); }
  function showApp() { $('#login').classList.add('hidden'); $('#app').classList.remove('hidden'); }
  function logout(silent) { token = null; store.del('lt_token'); showLogin(); if (silent) $('#loginError').textContent = 'Войдите снова — неотправленные записи сохранены на телефоне.'; }
  $('#loginForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = $('#loginForm button');
    $('#loginError').textContent = ''; btn.disabled = true;
    try {
      const r = await api('login', { password: $('#password').value });
      token = r.token; store.set('lt_token', token); $('#password').value = '';
      await boot();
    } catch (err) { $('#loginError').textContent = err.message; } finally { btn.disabled = false; }
  });
  $('#logout').addEventListener('click', () => {
    const n = outbox.length;
    if (confirmT(n ? `Выйти? ${n} записей ещё не отправлено — они останутся на телефоне.` : 'Выйти?')) logout();
  });

  // ── вкладки и верхняя кнопка ✓ / ➤
  const TITLES = { dash: 'Дашборды', prayers: 'Молитвы', quran: 'Коран', finance: 'Финансы' };
  let currentTab = 'prayers';
  function openTab(name) {
    if (!TITLES[name]) name = 'prayers';
    currentTab = name;
    $$('.tabs button').forEach((b) => b.classList.toggle('on', b.dataset.tab === name));
    $$('.tab').forEach((s) => s.classList.toggle('hidden', s.id !== 'tab-' + name));
    $('#screenTitle').textContent = TITLES[name];
    store.set('lt_tab', name);
    updateTopSave(); renderUndoBtn();
    if (name === 'dash') renderStats();
    if (name === 'prayers') { renderNowTile(); scrollActiveTile(); }
    $$('.tab:not(.hidden) textarea').forEach(autoGrow);
    window.scrollTo(0, 0);
  }
  $$('.tabs button').forEach((b) => b.addEventListener('click', () => openTab(b.dataset.tab)));
  function updateTopSave() {
    const b = $('#topSave'), fin = currentTab === 'finance';
    b.classList.toggle('hidden', currentTab === 'dash');
    b.classList.toggle('send', fin);
    b.title = ({ prayers: 'Сохранить день', quran: rEditId ? 'Сохранить изменения' : 'Добавить запись', finance: 'Добавить запись' }[currentTab] || '') + ' и отправить всё неотправленное';
    b.setAttribute('aria-label', b.title);
    renderPending();
  }
  $('#topSave').addEventListener('click', (e) => {
    const fn = { prayers: savePrayerNow, quran: saveReading, finance: sendFinance }[currentTab];
    if (fn) withBusy(e.currentTarget, fn);
  });
  const offlineNote = () => { if (!online) toast('Нет интернета — сохранено на телефоне, отправится автоматически'); };

  // ── настройки: общие
  // ── переключатели (.seg): отметить, если не помещаются (затухание у края), и показать выбранный вариант
  function segFit(root) {
    $$('.seg', root || document).forEach((g) => {
      if (!g.clientWidth) return;
      // сначала пробуем чуть мельче шрифт, и только если всё равно не помещается — листание вбок
      g.classList.remove('tight');
      if (g.scrollWidth > g.clientWidth + 1) g.classList.add('tight');
      const over = g.scrollWidth > g.clientWidth + 1;
      g.classList.toggle('ovf', over); g.classList.toggle('end', over && g.scrollLeft + g.clientWidth >= g.scrollWidth - 4);
      if (over && !g.dataset.segInit) {
        g.dataset.segInit = 1;
        g.addEventListener('scroll', () => g.classList.toggle('end', g.scrollLeft + g.clientWidth >= g.scrollWidth - 4), { passive: true });
      }
      const on = over && g.querySelector('button.on');
      if (on && (on.offsetLeft < g.scrollLeft || on.offsetLeft + on.offsetWidth > g.scrollLeft + g.clientWidth)) g.scrollLeft = on.offsetLeft - 12;
    });
  }
  new MutationObserver((recs) => { if (recs.every((r) => r.type === 'attributes' && r.target.classList && r.target.classList.contains('seg'))) return; clearTimeout(segFit.t); segFit.t = setTimeout(() => segFit(), 60); }).observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] });
  window.addEventListener('resize', () => segFit());
  // ── окна поверх страницы: фон не прокручивается (в том числе на iPhone, где overflow: hidden не помогает)
  const scrollLocks = new Set(); let lockY = 0;
  function lockScroll(id) {
    if (!scrollLocks.size) {
      lockY = window.scrollY || 0; const b = document.body.style;
      b.position = 'fixed'; b.top = -lockY + 'px'; b.left = '0'; b.right = '0'; b.width = '100%';
      document.documentElement.classList.add('modal-open');
    }
    scrollLocks.add(id);
  }
  function unlockScroll(id) {
    if (!scrollLocks.delete(id) || scrollLocks.size) return;
    const b = document.body.style; b.position = b.top = b.left = b.right = b.width = '';
    document.documentElement.classList.remove('modal-open'); window.scrollTo(0, lockY);
  }
  /** Прокручиваемая панель: на краях не отдаёт прокрутку фону (iOS «пружина»). */
  function containScroll(panel) {
    panel.addEventListener('touchstart', () => {
      const max = panel.scrollHeight - panel.clientHeight;
      if (max <= 0) return;
      if (panel.scrollTop <= 0) panel.scrollTop = 1; else if (panel.scrollTop >= max) panel.scrollTop = max - 1;
    }, { passive: true });
  }
  $('#openSettings').addEventListener('click', () => { updateHiddenInfo(); fillSettings(); pnStartEdit(); stStartEdit(); accStartEdit(); refStartEdit(); openSettingsHooks.forEach((f) => f()); renderWidgetSettings(); applyPeriods(); renderPending(); $('#settings').classList.remove('hidden'); lockScroll('settings'); });
  const openSettingsHooks = [];
  const closeSettings = () => { $('#settings').classList.add('hidden'); unlockScroll('settings'); };
  $('#closeSettings').addEventListener('click', closeSettings);
  $('#settings').addEventListener('click', (e) => { if (e.target.id === 'settings') closeSettings(); });
  // прокрутка внутри настроек не должна прокручивать страницу под ними
  $('#settings').addEventListener('touchmove', (e) => { if (!e.target.closest('.sheet-panel')) e.preventDefault(); }, { passive: false });
  containScroll($('#settings .sheet-panel'));
  const autoBox = $('#autoSend');
  autoBox.checked = settings.autoSend;
  autoBox.addEventListener('change', () => {
    settings.autoSend = autoBox.checked; saveSettings(); renderQueue();
    toast(settings.autoSend ? 'Автоотправка включена' : 'Автоотправка выключена');
    if (settings.autoSend) flush();
  });
  $('#forceSync').addEventListener('click', (e) => withBusy(e.currentTarget, async () => { await flush({ all: true }); await sync(true); toast('Данные обновлены ✓'); }));
  function updateHiddenInfo() {
    const n = hidden.prayers.length + hidden.reading.length + hidden.finance.length;
    $('#hiddenInfo').textContent = n ? `Скрыто из списков: ${n}. Из таблицы они не удалены.` : 'Скрытых записей нет.';
    $('#unhideAll').disabled = !n;
  }
  $('#unhideAll').addEventListener('click', () => {
    hidden = { prayers: [], reading: [], finance: [] }; store.set('lt_hidden', hidden);
    updateHiddenInfo(); renderAll(); toast('Скрытые записи снова видны');
  });
  const isHidden = (kind, id) => hidden[kind].indexOf(String(id)) >= 0;
  function hide(kind, id) { hidden[kind].push(String(id)); store.set('lt_hidden', hidden); }

  // ── свайп влево: скрыть (из таблицы не удаляется), тап — открыть
  function swipeList(container, { onTap, onSwipe }) {
    container.addEventListener('pointerdown', (e) => {
      const item = e.target.closest('.item'); if (!item || !container.contains(item) || item.classList.contains('sk-item')) return;
      const wrap = item.parentElement;
      const x0 = e.clientX, y0 = e.clientY;
      let dx = 0, mode = null;
      const move = (ev) => {
        const mx = ev.clientX - x0, my = ev.clientY - y0;
        if (!mode) {
          if (Math.abs(mx) > 8 && Math.abs(mx) > Math.abs(my)) { mode = 'swipe'; item.classList.add('dragging'); wrap.classList.add('active'); }
          else if (Math.abs(my) > 8) mode = 'scroll';
        }
        if (mode === 'swipe') { dx = Math.min(0, mx); item.style.transform = `translateX(${dx}px)`; }
      };
      const up = () => {
        window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); window.removeEventListener('pointercancel', up);
        item.classList.remove('dragging');
        if (mode === 'swipe') {
          if (dx < -Math.min(110, item.offsetWidth * 0.3)) {
            item.style.transform = 'translateX(-110%)';
            setTimeout(() => {
              wrap.style.transition = 'height .2s, opacity .2s'; wrap.style.height = wrap.offsetHeight + 'px';
              requestAnimationFrame(() => { wrap.style.height = '0px'; wrap.style.opacity = '0'; });
              setTimeout(() => onSwipe(wrap.dataset.id), 220);
            }, 180);
          } else { item.style.transform = ''; setTimeout(() => wrap.classList.remove('active'), 200); }
        } else if (!mode) onTap(wrap.dataset.id);
      };
      window.addEventListener('pointermove', move, { passive: true }); // не мешаем прокрутке браузера
      window.addEventListener('pointerup', up); window.addEventListener('pointercancel', up);
    });
  }
  const swipeWrap = (id, inner, label, extra) => `<div class="swipe" data-id="${esc(id)}"><div class="swipe-bg">${label || 'Скрыть'}</div><div class="item ${extra || ''}">${inner}</div></div>`;
  const skeletonList = (n) => Array.from({ length: n }, () => '<div class="item sk-item"><div class="main"><i class="sk w60"></i><i class="sk w40"></i></div><i class="sk w15"></i></div>').join('');
  const pendMark = (key) => (view().pending.has(key) ? '<span class="pend" title="Ещё не отправлено">⏳</span>' : '');

  // ═════════════ Молитвы ═════════════
  const pState = {};
  let activePrayer = 'fajr', pDate = null;

  function renderPrayerRows() {
    $('#prayerRows').innerHTML = `
      <div class="prayer-tabs" role="tablist">
        ${VK().map((k) => `<button type="button" role="tab" data-k="${k}" title="${esc(P_PRESETS.ru[k])}">${pSpan(k, 'pt-name')}<span class="pt-status">—</span></button>`).join('')}
      </div>
      <div class="pt-hint muted small" id="ptHint"></div>
      <div class="status-row">${visibleStatuses().map((s) => `<button type="button" class="${stc(s)}" data-s="${esc(s)}">${esc(s)}</button>`).join('')}</div>`;
    $('#prayerRows .prayer-tabs').addEventListener('click', (e) => {
      const b = e.target.closest('button'); if (!b) return;
      activePrayer = b.dataset.k; paintPrayers(); scrollActiveTile();
    });
    $('#prayerRows .status-row').addEventListener('click', (e) => {
      const b = e.target.closest('button'); if (!b) return;
      const k = activePrayer, wasEmpty = !pState[k], prev = { st: Object.assign({}, pState), comment: $('#pComment').value };
      pState[k] = pState[k] === b.dataset.s ? '' : b.dataset.s;
      pushUndo({ tab: 'prayers', type: 'prayer', date: pDate, prev, label: `${pNameDash(k)}: ${pState[k] || '—'} · ${ru(pDate)}` });
      if (pState[k] && wasEmpty && settings.prayer.autoNext) { // к следующей неотмеченной
        const vk = VK(), i = vk.indexOf(k);
        const next = vk.slice(i + 1).concat(vk.slice(0, i)).find((x) => !pState[x]);
        if (next) activePrayer = next;
      }
      commitPrayer(); paintPrayers(); scrollActiveTile();
    });
  }
  const hiddenSt = () => ((cfg().statuses || {}).hidden || []).map((i) => meta.statuses[i]);
  const visibleStatuses = () => meta.statuses.filter((s) => hiddenSt().indexOf(s) < 0 || Object.values(pState).indexOf(s) >= 0);
  function scrollActiveTile() {
    const wrap = $('#prayerRows .prayer-tabs'), b = wrap && $(`button[data-k="${activePrayer}"]`, wrap);
    if (!b) return;
    const left = b.offsetLeft - (wrap.clientWidth - b.offsetWidth) / 2;
    wrap.scrollTo({ left: Math.max(0, left), behavior: 'smooth' });
  }
  function paintPrayers() {
    if (!$('#prayerRows .prayer-tabs')) return;
    $$('#prayerRows .prayer-tabs button').forEach((b) => {
      const k = b.dataset.k, s = pState[k];
      b.className = s ? stc(s) + ' set' : '';
      b.classList.toggle('active', k === activePrayer);
      b.setAttribute('aria-selected', k === activePrayer);
      $('.pt-status', b).textContent = s ? stShort(s) : '—';
    });
    const cur = pState[activePrayer];
    $$('#prayerRows .status-row button').forEach((b) => b.classList.toggle('on', b.dataset.s === cur));
    $('#ptHint').innerHTML = `Статус для: ${pSpan(activePrayer, isAr(pName(activePrayer)) ? 'ar' : '')}`;
    const pend = view().pending.has('p:' + pDate), exists = view().prayers.has(pDate);
    $('#pState').textContent = pend ? (online ? '⏳ Сохранено на телефоне, отправляется…' : '📴 Сохранено на телефоне — отправится, когда появится интернет')
      : exists ? '✓ День в таблице' : 'Новый день — отметьте молитвы';
  }
  const firstEmpty = () => VK().find((k) => !pState[k]) || 'fajr';
  /** Показать день из данных на телефоне — без запросов. */
  function showPrayerDay(date) {
    pDate = date; $('#pDate').value = date;
    const r = view().prayers.get(date);
    PKEYS.forEach((k, i) => { pState[k] = r ? r[i + 1] || '' : ''; });
    const ck = currentPrayerKey();
    activePrayer = date === today() && ck && showP(ck) && !pState[ck] ? ck : firstEmpty();
    setText($('#pComment'), r ? r[8] : '');
    paintPrayers(); scrollActiveTile(); renderNowTile();
  }
  /** Каждое изменение сразу сохраняется на телефоне и ставится в очередь. */
  function commitPrayer() {
    const p = Object.assign({ date: pDate, comment: $('#pComment').value }, pState);
    enqueue('savePrayer', p, 'prayer|' + pDate);
    if (settings.autoSend) scheduleFlush(2500);
  }
  let commentTimer;
  $('#pComment').addEventListener('input', () => { clearTimeout(commentTimer); commentTimer = setTimeout(commitPrayer, 700); });
  // ‹ › рядом с датой — одинаково на всех вкладках
  $$('.date-nav [data-dshift]').forEach((b) => b.addEventListener('click', () => {
    const i = $('#' + b.dataset.for); i.value = addDays(i.value || today(), Number(b.dataset.dshift));
    i.dispatchEvent(new Event('change', { bubbles: true }));
  }));
  $('#pDate').addEventListener('change', () => { if ($('#pDate').value) showPrayerDay($('#pDate').value); });
  const fillStatus = () => meta.statuses[settings.prayer.fill] || meta.statuses[1];
  $('#pAllBest').addEventListener('click', () => {
    const st = fillStatus(), prev = { st: Object.assign({}, pState), comment: $('#pComment').value };
    VK().forEach((k) => { if (!pState[k]) pState[k] = st; }); commitPrayer(); paintPrayers();
    const u = pushUndo({ tab: 'prayers', type: 'prayer', date: pDate, prev, label: `Отмечены остальные · ${ru(pDate)}` });
    if (u) toast('Отмечено ✓', false, u);
  });
  function applyPrayerSettings() {
    if (!meta) return;
    if (settings.prayer.fillStatus) { const i = meta.statuses.indexOf(settings.prayer.fillStatus); settings.prayer.fill = i >= 0 ? i : 1; delete settings.prayer.fillStatus; saveSettings(); }
    $('#pAllBest').textContent = `Отметить остальные «${fillStatus()}»`;
    $('#nowTile').classList.toggle('hidden', !settings.prayer.showTile);
    $('#pRecentTitle') && ($('#pRecentTitle').textContent = `Последние ${settings.prayer.days} дней`);
  }
  async function savePrayerNow() {
    clearTimeout(commentTimer);
    const hasMarks = PKEYS.some((k) => pState[k]) || $('#pComment').value.trim();
    if (hasMarks && !view().pending.has('p:' + pDate)) commitPrayer();
    offlineNote(); await flush({ all: true, notify: true });
  }

  function renderPrayerRecent() {
    if (!srv && !outbox.length) { $('#pRecent').innerHTML = skeletonList(3); return; }
    const from = addDays(today(), -(DAYS.prayers - 1));
    const rows = [...view().prayers.values()].filter((r) => r[0] >= from && !isHidden('prayers', r[0])).sort((a, b) => (a[0] < b[0] ? 1 : -1));
    $('#pRecent').innerHTML = rows.length ? rows.map((r) => swipeWrap(r[0], `
      <div class="main"><div class="t">${ru(r[0])} ${pendMark('p:' + r[0])}</div>${r[8] ? `<div class="s">${esc(r[8])}</div>` : ''}</div>
      <div class="marks">${PKEYS.map((k, i) => (showP(k) ? `<i class="${stc(r[i + 1])}${k === 'duha' || k === 'witr' ? ' nafl' : ''}" title="${esc(pNameDash(k))}: ${esc(r[i + 1] || '—')}"></i>` : '')).join('')}</div>`, null, r[0] === pDate ? 'editing' : '')).join('')
      : `<p class="empty">За ${DAYS.prayers} дней записей нет</p>`;
  }
  swipeList($('#pRecent'), {
    onTap: (id) => { showPrayerDay(id); window.scrollTo({ top: 0, behavior: 'smooth' }); renderPrayerRecent(); },
    onSwipe: (id) => { hide('prayers', id); renderPrayerRecent(); toast('Скрыто из списка', false, pushUndo({ tab: 'prayers', type: 'hide', list: 'prayers', recId: id, label: `Скрытие дня ${ru(id)}` })); }
  });

  // ── Времена молитв и плитка «Сейчас» (время берётся из часов телефона)
  const toMin = (s) => { const m = /(\d{1,2})[:.](\d{2})/.exec(s || ''); return m ? Number(m[1]) * 60 + Number(m[2]) : null; };
  function range(s) {
    const parts = String(s || '').split(/\s*[-–—]\s*/);
    const a = toMin(parts[0]), b = toMin(parts[1]);
    return a == null ? null : { s: a, e: b == null ? a : b };
  }
  const hhmm = (m) => { const x = ((m % 1440) + 1440) % 1440; return `${pad(Math.floor(x / 60))}:${pad(x % 60)}`; };
  const NOW_SUB = { duha: 'После восхода', makruh: 'Время заката' };
  const nowName = (k) => { const c = pcfg(); return k === 'makruh' ? (P_PRESETS[c.preset] || P_PRESETS.ar).makruh || P_PRESETS.ar.makruh : pName(k); };
  const nowSpan = (k) => { const n = nowName(k); return isAr(n) ? `<span lang="ar" dir="rtl">${n}</span>` : `<span data-noi18n>${esc(n)}</span>`; };

  function segmentsFor(row) {
    if (!row) return [];
    const f = range(row.fajr), z = range(row.zuhr), a = range(row.asr), mk = range(row.makruh), m = range(row.maghrib), i = range(row.isha);
    const seg = [];
    if (f) seg.push({ k: 'fajr', s: f.s, e: f.e });
    if (f && z) seg.push({ k: 'duha', s: f.e, e: z.s });
    if (z) seg.push({ k: 'zuhr', s: z.s, e: z.e });
    if (a) seg.push({ k: 'asr', s: a.s, e: a.e });
    if (mk) seg.push({ k: 'makruh', s: mk.s, e: mk.e });
    if (m) seg.push({ k: 'maghrib', s: m.s, e: m.e });
    if (i) seg.push({ k: 'isha', s: i.s, e: i.e <= i.s ? i.e + 1440 : i.e });
    return seg;
  }
  function nowInfo(date) {
    const t = iso(date), row = times.find((x) => x.date === t);
    if (!row) return null;
    const now = date.getHours() * 60 + date.getMinutes();
    const seg = segmentsFor(row);
    const yIsha = segmentsFor(times.find((x) => x.date === addDays(t, -1))).find((x) => x.k === 'isha');
    let cur = null, next = null;
    if (seg.length && now < seg[0].s) { // после полуночи — ещё Иша прошлого дня
      cur = yIsha ? { k: 'isha', s: yIsha.s - 1440, e: yIsha.e - 1440 } : { k: 'isha', s: null, e: seg[0].s };
      next = seg[0];
    } else {
      cur = seg.find((x) => now >= x.s && now < x.e) || null;
      next = seg.find((x) => x.s > now && (!cur || x.k !== cur.k)) || null;
    }
    if (!next) {
      const tseg = segmentsFor(times.find((x) => x.date === addDays(t, 1)));
      if (tseg[0]) next = { k: tseg[0].k, s: tseg[0].s + 1440, e: tseg[0].e + 1440 };
    }
    return { row, now, cur, next };
  }
  function currentPrayerKey() {
    const info = nowInfo(new Date());
    if (!info || !info.cur) return null;
    const k = { fajr: 'fajr', duha: 'duha', zuhr: 'zuhr', asr: 'asr', makruh: 'asr', maghrib: 'maghrib', isha: 'isha' }[info.cur.k] || null;
    return k && showP(k) ? k : null;
  }
  const leftText = (mins) => { const h = Math.floor(mins / 60), m = mins % 60; return h ? `${h} ч ${m} мин` : `${m} мин`; };
  const STARS = Array.from({ length: 14 }, (_, i) => `<i class="star" style="left:${(i * 37 + 11) % 96}%;top:${(i * 53 + 7) % 70}%;animation-delay:-${((i * 0.7) % 3).toFixed(1)}s"></i>`).join('');

  function renderNowTile() {
    const tile = $('#nowTile');
    const info = nowInfo(new Date());
    if (!info) {
      tile.className = 'now-tile empty';
      tile.innerHTML = times.length ? 'На сегодня нет времени молитв — добавьте строку в лист «Времена молитв».'
        : 'Заполните лист «Времена молитв» в таблице — здесь появится текущая молитва и её время.';
      return;
    }
    const { cur, next, now, row } = info;
    const k = cur ? cur.k : 'duha';
    tile.className = 'now-tile';
    const rangeTxt = cur && cur.s != null ? `${hhmm(cur.s)} – ${hhmm(cur.e)}` : '';
    const left = cur ? cur.e - now : null;
    const nk = cur ? cur.k : (next ? next.k : 'isha');
    tile.innerHTML = `
      <div class="sky sky-${k}"><i class="rays"></i><i class="sun"></i><i class="moon"></i><i class="cloud c1"></i><i class="cloud c2"></i>${STARS}</div>
      <div class="nt-range">${rangeTxt}</div>
      <div class="nt-label">${cur ? 'Сейчас' : 'Скоро'}${NOW_SUB[nk] ? ' · ' + NOW_SUB[nk] : ''}</div>
      <div class="nt-name ${isAr(nowName(nk)) ? '' : 'plain'}" ${isAr(nowName(nk)) ? 'lang="ar" dir="rtl"' : 'data-noi18n'}>${isAr(nowName(nk)) ? nowName(nk) : esc(nowName(nk))}</div>
      ${left != null && left > 0 ? `<div class="nt-left">Осталось ${leftText(left)}</div>` : ''}
      ${next ? `<div class="nt-next">Далее: ${nowSpan(next.k)} в ${hhmm(next.s)}</div>` : ''}
      ${row.hijri ? `<div class="nt-hijri">${esc(row.hijri)}</div>` : ''}`;
  }
  $('#nowTile').addEventListener('click', () => {
    const k = currentPrayerKey(); if (!k) return;
    if (pDate !== today()) showPrayerDay(today());
    activePrayer = k; paintPrayers(); scrollActiveTile();
  });
  setInterval(() => { if (currentTab === 'prayers') renderNowTile(); }, 30000);

  // ═════════════ Коран ═════════════
  let rType = 'pages', rKind = '', rEditId = null;
  const chosenSuras = new Set();
  function renderReading() {
    rKind = meta.kinds.indexOf(rKind) >= 0 ? rKind : (meta.kinds.indexOf(settings.quran.kind) >= 0 ? settings.quran.kind : meta.kinds[0]);
    $('#rKind').innerHTML = meta.kinds.map((k) => `<button type="button" data-v="${esc(k)}" class="${k === rKind ? 'on' : ''}">${esc(k)}</button>`).join('');
    renderSuraList(); updateReadingSummary();
  }
  function setKind(k) { rKind = k; $$('#rKind button').forEach((x) => x.classList.toggle('on', x.dataset.v === k)); }
  function setType(t) {
    rType = t; $$('#rType button').forEach((x) => x.classList.toggle('on', x.dataset.v === t));
    $('#rPages').classList.toggle('hidden', t !== 'pages'); $('#rSuras').classList.toggle('hidden', t !== 'suras');
    updateReadingSummary();
  }
  $('#rKind').addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) setKind(b.dataset.v); });
  $('#rType').addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) setType(b.dataset.v); });
  function renderSuraList() {
    const q = $('#suraSearch').value.trim().toLowerCase().replace(/[-'\s]/g, '');
    const list = meta.suras.filter((s) => !q || String(s.n) === q || s.name.toLowerCase().replace(/[-'\s]/g, '').includes(q));
    $('#suraList').innerHTML = list.map((s) => `<button type="button" data-n="${s.n}" class="${chosenSuras.has(s.n) ? 'on' : ''}"><span class="num">${s.n}</span><span>${esc(s.name)}</span><span class="ay">${s.ayahs} аят.</span></button>`).join('') || '<p class="muted center">Не найдено</p>';
    $('#suraChosen').innerHTML = [...chosenSuras].sort((a, b) => a - b).map((n) => `<button type="button" class="chip x" data-n="${n}">${n}. ${esc(suraBy(n).name)}</button>`).join('');
  }
  $('#suraSearch').addEventListener('input', renderSuraList);
  function toggleSura(e) {
    const b = e.target.closest('button[data-n]'); if (!b) return;
    const n = Number(b.dataset.n);
    if (chosenSuras.has(n)) chosenSuras.delete(n);
    else { if (rEditId) chosenSuras.clear(); chosenSuras.add(n); } // при редактировании — одна сура
    renderSuraList(); updateReadingSummary();
  }
  $('#suraList').addEventListener('click', toggleSura);
  $('#suraChosen').addEventListener('click', toggleSura);
  $$('[data-rep]').forEach((b) => b.addEventListener('click', () => {
    const i = $('#rRepeats'); i.value = Math.max(1, (Number(i.value) || 1) + Number(b.dataset.rep)); updateReadingSummary();
  }));
  ['#rFrom', '#rTo', '#rRepeats'].forEach((s) => $(s).addEventListener('input', updateReadingSummary));
  function updateReadingSummary() {
    const reps = Math.max(1, Number($('#rRepeats').value) || 1);
    let txt = '';
    if (rType === 'pages') {
      const a = Number($('#rFrom').value), b = Number($('#rTo').value);
      if (a && b && b >= a) { const p = b - a + 1; txt = `${p} стр. × ${reps} = ${p * reps} стр.`; }
    } else if (chosenSuras.size && meta) {
      const ay = [...chosenSuras].reduce((t, n) => t + suraBy(n).ayahs, 0);
      txt = `${chosenSuras.size} сур(ы), ${ay} аятов × ${reps} = ${ay * reps} аятов`;
    }
    $('#rSummary').textContent = txt;
  }
  function readReadingForm() {
    const p = { date: $('#rDate').value, kind: rKind, type: rType, repeats: Math.max(1, Number($('#rRepeats').value) || 1), comment: $('#rComment').value.trim() };
    if (!p.date) throw new Error('Укажите дату');
    if (rType === 'pages') {
      p.from = Math.floor(Number($('#rFrom').value)); p.to = Math.floor(Number($('#rTo').value));
      if (!(p.from >= 1 && p.to >= p.from && p.to <= (meta.pages || 604))) throw new Error('Страницы: от 1 до 604, «с» ≤ «по»');
    } else {
      p.suras = [...chosenSuras].sort((a, b) => a - b);
      if (!p.suras.length) throw new Error('Выберите хотя бы одну суру');
    }
    return p;
  }
  function resetReadingForm(keepNextPage) {
    const to = Number($('#rTo').value);
    rEditId = null; $('#rEdit').classList.add('hidden'); updateTopSave();
    $('#rFrom').value = keepNextPage && settings.quran.continuePages && rType === 'pages' && to && to < 604 ? to + 1 : '';
    $('#rTo').value = ''; chosenSuras.clear(); $('#suraSearch').value = ''; renderSuraList();
    $('#rRepeats').value = 1; setText($('#rComment'), ''); $('#rDate').value = today(); updateReadingSummary();
  }
  function editReading(id) {
    const r = view().reading.find((x) => String(x[0]) === String(id)); if (!r) return;
    if (isTmp(id) && !opById(id)) { toast('Запись синхронизируется — попробуйте через несколько секунд'); return; }
    rEditId = r[0];
    $('#rDate').value = r[1]; setKind(r[2]);
    chosenSuras.clear();
    if (r[3] === 'Сура') { setType('suras'); chosenSuras.add(Number(r[9])); $('#rFrom').value = ''; $('#rTo').value = ''; }
    else { setType('pages'); $('#rFrom').value = r[4]; $('#rTo').value = r[5]; }
    $('#suraSearch').value = ''; renderSuraList();
    $('#rRepeats').value = r[7] || 1; setText($('#rComment'), r[13]); updateReadingSummary();
    $('#rEdit span').textContent = isTmp(id) ? 'Изменение неотправленной записи' : `Редактирование записи №${r[0]}`;
    $('#rEdit').classList.remove('hidden'); updateTopSave(); renderReadingRecent();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
  $('#rEdit .link').addEventListener('click', () => { resetReadingForm(false); renderReadingRecent(); });
  async function saveReading() {
    const empty = !rEditId && !$('#rFrom').value && !$('#rTo').value && !chosenSuras.size;
    if (empty) { if (!outbox.length) throw new Error('Нечего отправлять: заполните запись'); offlineNote(); await flush({ all: true, notify: true }); return; }
    const p = readReadingForm();
    if (rEditId) {
      if (p.type === 'suras' && p.suras.length !== 1) throw new Error('При редактировании выберите одну суру');
      let u = null;
      if (isTmp(rEditId)) { const o = opById(rEditId); if (o) { u = pushUndo({ tab: 'quran', type: 'opedit', op: o.id, prev: o.p, label: 'Изменение записи Корана' }); o.p = p; persist(); changed(); } }
      else {
        const old = view().reading.find((r) => String(r[0]) === String(rEditId));
        if (old) u = pushUndo({ tab: 'quran', type: 'update', op: 'updateReading', key: 'r|' + rEditId, recId: rEditId, prev: rowToReading(old), label: `Изменение записи №${rEditId}` });
        enqueue('updateReading', Object.assign({ id: rEditId }, p), 'r|' + rEditId);
      }
      toast('Запись обновлена ✓', false, u); resetReadingForm(false);
    } else {
      const ops = [];
      if (p.type === 'suras') p.suras.forEach((n) => ops.push(enqueue('addReading', Object.assign({}, p, { suras: [n] })).id));
      else ops.push(enqueue('addReading', p).id);
      const what = p.type === 'suras' ? p.suras.map((n) => suraBy(n).name).join(', ') : `стр. ${p.from}–${p.to}`;
      const u = pushUndo({ tab: 'quran', type: 'add', ops, del: 'deleteReading', label: `${p.kind}: ${what}` });
      toast(p.type === 'suras' ? `Добавлено сур: ${p.suras.length} ✓` : 'Запись добавлена ✓', false, u); resetReadingForm(true);
    }
    renderAll(); offlineNote(); flush({ all: true, notify: true });
  }
  function renderReadingRecent() {
    if (!srv && !outbox.length) { $('#rRecent').innerHTML = skeletonList(3); return; }
    const from = addDays(today(), -(DAYS.reading - 1));
    const rows = view().reading.filter((r) => r[1] >= from && !isHidden('reading', r[0])).sort(byNewest(1));
    $('#rRecent').innerHTML = rows.length ? rows.map((r) => {
      const what = r[3] === 'Сура' ? `Сура ${r[9]}. ${esc(r[10])}` : `Стр. ${r[4]}–${r[5]}`;
      const qty = r[3] === 'Сура' ? `${r[12]} аят.` : `${r[8]} стр.`;
      return swipeWrap(r[0], `<div class="main"><div class="t">${what} ${pendMark('r:' + r[0])}</div><div class="s">${ru(r[1])} · ${esc(r[2])} · ×${r[7]}${r[13] ? ' · ' + esc(r[13]) : ''}</div></div><div class="amt">${qty}</div>`,
        null, String(r[0]) === String(rEditId) ? 'editing' : '');
    }).join('') : `<p class="empty">За ${DAYS.reading} дней записей нет</p>`;
  }
  swipeList($('#rRecent'), {
    onTap: editReading,
    onSwipe: (id) => {
      const o = isTmp(id) && opById(id);
      if (o) { outbox = outbox.filter((x) => x !== o); persist(); changed(); toast('Неотправленная запись удалена', false, pushUndo({ tab: 'quran', type: 'oprestore', opObj: o, label: 'Удаление неотправленной записи' })); }
      else { hide('reading', id); toast('Скрыто из списка', false, pushUndo({ tab: 'quran', type: 'hide', list: 'reading', recId: id, label: 'Скрытие записи из списка' })); }
      if (String(id) === String(rEditId)) resetReadingForm(false);
      renderAll();
    }
  });

  // ═════════════ Финансы ═════════════
  let fAction = '', fCategory = '', fEdit = null; // fEdit: {mode:'saved', id} | {mode:'queue', opId}
  let fAccount = '', fTo = '', fAccTouched = false;
  // ── счета и карты
  const ACCS = () => ((meta && meta.accounts) || []).filter((a) => !a.archived);
  const accIcon = (name) => { const a = ((meta && meta.accounts) || []).find((x) => x.name === name); return a && a.icon ? a.icon : '💳'; };
  const isTransfer = (a) => meta && a === meta.fin.TRANSFER;
  function defaultAccount(action) {
    const act = ACCS(), byAction = (meta.actionDefaults || {})[action];
    if (byAction && act.some((a) => a.name === byAction)) return byAction;
    const d = act.find((a) => a.isDefault) || act[0];
    return d ? d.name : '';
  }
  const accText = (acc, to) => acc ? (to ? `${accIcon(acc)} ${esc(acc)} → ${accIcon(to)} ${esc(to)}` : `${accIcon(acc)} ${esc(acc)}`) : '';
  function renderAccounts() {
    const act = ((meta && meta.accounts) || []).filter((a) => !a.archived || a.name === fAccount || a.name === fTo), tr = isTransfer(fAction);
    $('#fAccWrap').classList.toggle('hidden', !act.length);
    $('#fAccLbl').textContent = tr ? 'Откуда' : 'Счёт / карта';
    $('#fToWrap').classList.toggle('hidden', !tr || !act.length);
    $('#fCatWrap').classList.toggle('hidden', tr);
    const chips = (cur, skip) => act.filter((a) => a.name !== skip).map((a) => `<button type="button" data-v="${esc(a.name)}" class="${a.name === cur ? 'on' : ''}"><span class="ic">${a.icon || '💳'}</span>${esc(a.name)}</button>`).join('');
    $('#fAccount').innerHTML = chips(fAccount);
    if (tr && (!fTo || fTo === fAccount)) fTo = (act.find((a) => a.name !== fAccount) || {}).name || '';
    $('#fTo').innerHTML = chips(fTo, fAccount);
  }
  $('#fAccount').addEventListener('click', (e) => { const b = e.target.closest('button'); if (!b) return; fAccount = b.dataset.v; fAccTouched = true; renderAccounts(); });
  $('#fTo').addEventListener('click', (e) => { const b = e.target.closest('button'); if (!b) return; fTo = b.dataset.v; renderAccounts(); });
  // справочник из meta.pairs: [действие, категория, иконка, поток]
  let FINREF = { actions: [], cats: {}, icon: {}, flow: {} };
  function buildFinRef() {
    const r = { actions: [], cats: {}, icon: {}, flow: {} };
    (meta.pairs || []).forEach(([a, c, ic, f]) => {
      if (!r.cats[a]) { r.cats[a] = []; r.actions.push(a); }
      if (c) { r.cats[a].push(c); if (ic) r.icon[a + '|' + c] = ic; }
      r.flow[a + '|' + c] = f;
    });
    FINREF = r;
  }
  const icon = (a, c) => FINREF.icon[a + '|' + c] || Object.entries(FINREF.icon).find(([k]) => k.endsWith('|' + c))?.[1] || (c ? '📦' : '❔');
  /** Поток записи: +1 приход, −1 расход, 0 — не влияет. */
  function flowSign(a, c) {
    const F = meta.flow || { IN: 'Приход', OUT: 'Расход' };
    const f = FINREF.flow[a + '|' + c] || FINREF.flow[a + '|'] || defaultFlow(a, c);
    return f === F.IN ? 1 : f === F.OUT ? -1 : 0;
  }
  function defaultFlow(a, c) {
    const fin = meta.fin, F = meta.flow;
    if ([fin.BORROWED, fin.RETURNED, fin.WITHDRAWN].indexOf(c) >= 0) return F.IN;
    if ([fin.REPAID, fin.LENT, fin.SAVED].indexOf(c) >= 0) return F.OUT;
    return a === fin.INCOME ? F.IN : a === fin.EXPENSE ? F.OUT : F.NONE;
  }
  function renderFinance() {
    buildFinRef();
    if (FINREF.actions.indexOf(fAction) < 0) fAction = FINREF.actions[0] || '';
    $('#fAction').innerHTML = FINREF.actions.map((a) => `<button type="button" data-v="${esc(a)}" class="${a === fAction ? 'on' : ''}">${esc(a)}</button>`).join('');
    if (!fAccTouched || ACCS().every((a) => a.name !== fAccount)) fAccount = defaultAccount(fAction);
    renderCategories(); renderAccounts();
    $('#fAmountLbl').textContent = `Сумма (${settings.finance.currency || 'с'})`;
  }
  function renderCategories() {
    const cats = FINREF.cats[fAction] || [];
    if (cats.indexOf(fCategory) < 0) fCategory = '';
    $('#fCategory').innerHTML = cats.map((c) => `<button type="button" data-v="${esc(c)}" class="${c === fCategory ? 'on' : ''}"><span class="ic">${icon(fAction, c)}</span>${esc(c)}${budgetFor(fAction, c) ? `<i class="bdot ${budgetLevel(monthSpent(fAction, c), budgetFor(fAction, c).limit)}"></i>` : ''}</button>`).join('') || '<span class="muted small">Нет категорий — добавьте их в ⚙ настройках</span>';
    updateBudgetHint(); renderPerson();
  }
  function setAction(a) {
    fAction = a; $$('#fAction button').forEach((x) => x.classList.toggle('on', x.dataset.v === a));
    if (!fAccTouched) fAccount = defaultAccount(a);
    renderCategories(); renderAccounts(); renderDebtBox(); renderFinanceRecent();
  }
  $('#fAction').addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) setAction(b.dataset.v); });
  $('#fCategory').addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return;
    fCategory = fCategory === b.dataset.v ? '' : b.dataset.v;
    $$('#fCategory button').forEach((x) => x.classList.toggle('on', x.dataset.v === fCategory));
    updateBudgetHint(); renderPerson();
  });
  // Безопасный калькулятор: цифры и + - * / ( )
  function calc(expr) {
    const s = String(expr).replace(/,/g, '.').replace(/\s+/g, '').replace(/[×xX]/g, '*').replace(/[÷:]/g, '/').replace(/[−–]/g, '-');
    if (!s || !/^[0-9+\-*/().]+$/.test(s)) return NaN;
    let i = 0;
    const num = () => { const m = /^\d+(\.\d+)?|^\.\d+/.exec(s.slice(i)); if (!m) throw 0; i += m[0].length; return parseFloat(m[0]); };
    const factor = () => { if (s[i] === '-') { i++; return -factor(); } if (s[i] === '(') { i++; const v = sum(); if (s[i] !== ')') throw 0; i++; return v; } return num(); };
    const term = () => { let v = factor(); while (s[i] === '*' || s[i] === '/') { const op = s[i++]; const r = factor(); v = op === '*' ? v * r : v / r; } return v; };
    const sum = () => { let v = term(); while (s[i] === '+' || s[i] === '-') { const op = s[i++]; const r = term(); v = op === '+' ? v + r : v - r; } return v; };
    try { const v = sum(); return i === s.length && isFinite(v) ? Math.round(v * 100) / 100 : NaN; } catch (e) { return NaN; }
  }
  $('#fAmount').addEventListener('input', () => {
    const raw = $('#fAmount').value, v = calc(raw);
    $('#fCalc').textContent = /[+\-*/×÷−()]/.test(raw.replace(/^-/, '')) && !isNaN(v) ? `= ${money(v)} ${settings.finance.currency || 'с'}` : '';
  });
  // кнопки калькулятора: на цифровой клавиатуре телефона нет + − × ÷ ( )
  $('#fKeys').addEventListener('pointerdown', (e) => { if (e.target.closest('button')) e.preventDefault(); }); // клавиатура не закрывается
  $('#fKeys').addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) calcKey(b.dataset.k); });
  function calcKey(k) {
    const el = $('#fAmount'), v = el.value;
    let a = el.selectionStart == null ? v.length : el.selectionStart, z = el.selectionEnd == null ? v.length : el.selectionEnd;
    if (document.activeElement !== el) { a = z = v.length; }
    if (k === '=') { const r = calc(v); if (isNaN(r)) { toast('Не получается посчитать — проверьте выражение', true); return; } el.value = String(r); a = z = el.value.length; }
    else if (k === 'back') { if (a === z && a > 0) a--; el.value = v.slice(0, a) + v.slice(z); z = a; }
    else { el.value = v.slice(0, a) + k + v.slice(z); a = z = a + k.length; }
    el.focus({ preventScroll: true }); try { el.setSelectionRange(a, z); } catch (x) {}
    el.dispatchEvent(new Event('input'));
  }
  // ── своя клавиатура: на телефоне вместо системной — цифры и действия калькулятора вместе
  const touchDevice = () => matchMedia('(pointer: coarse)').matches;
  const npOn = () => settings.finance.numpad !== false && touchDevice();
  function npApply() {
    const on = npOn(), el = $('#fAmount');
    el.setAttribute('inputmode', on ? 'none' : 'decimal');
    $('#fKeys').classList.toggle('hidden', on);
    if (!on) npHide();
  }
  function npShow() {
    if (!npOn()) return;
    $('#numpad').classList.remove('hidden'); document.documentElement.classList.add('np-open'); npTop();
    setTimeout(() => { const r = $('#fAmount').getBoundingClientRect(), padTop = window.innerHeight - $('#numpad').offsetHeight;
      if (r.bottom > padTop - 12 || r.top < 70) window.scrollBy({ top: r.top - Math.max(80, padTop - 200), behavior: 'smooth' }); }, 30);
  }
  function npHide() { $('#numpad').classList.add('hidden'); document.documentElement.classList.remove('np-open'); }
  function npTop() { const v = $('#fAmount').value, r = calc(v); $('#npExpr').textContent = v || T('Сумма'); $('#npRes').textContent = /[+\-*/×÷−()]/.test(v.replace(/^-/, '')) && !isNaN(r) ? '= ' + money(r) : ''; }
  $('#fAmount').addEventListener('focus', npShow);
  $('#fAmount').addEventListener('click', npShow);
  $('#fAmount').addEventListener('blur', () => setTimeout(() => { if (document.activeElement !== $('#fAmount')) npHide(); }, 120));
  $('#fAmount').addEventListener('input', npTop);
  $('#numpad').addEventListener('pointerdown', (e) => { e.preventDefault(); }); // поле не теряет фокус
  let npHold = null;
  $('#numpad').addEventListener('pointerdown', (e) => {
    const b = e.target.closest('button'); if (!b) return;
    b.classList.add('press'); try { navigator.vibrate && navigator.vibrate(5); } catch (x) {}
    const k = b.dataset.k;
    if (k === 'back') { clearTimeout(npHold); npHold = setTimeout(() => { $('#fAmount').value = ''; $('#fAmount').dispatchEvent(new Event('input')); npHold = 'done'; }, 550); } // долгое нажатие — стереть всё
  });
  ['pointerup', 'pointercancel', 'pointerleave'].forEach((ev) => $('#numpad').addEventListener(ev, (e) => { $$('#numpad .press').forEach((x) => x.classList.remove('press')); if (ev !== 'pointerup') { if (npHold !== 'done') clearTimeout(npHold); } }));
  $('#numpad').addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return;
    const k = b.dataset.k;
    if (k === 'done') { const v = $('#fAmount').value; if (/[+\-*/×÷−()]/.test(v.replace(/^-/, ''))) calcKey('='); $('#fAmount').blur(); npHide(); return; }
    if (k === 'back') { const held = npHold === 'done'; clearTimeout(npHold); npHold = null; if (held) return; }
    calcKey(k);
  });
  npApply();
  function readFinanceForm() {
    const amount = calc($('#fAmount').value);
    if (!(amount > 0)) throw new Error('Введите сумму');
    if (!fAction) throw new Error('Выберите действие');
    if (fAction === meta.fin.DEBT && !fCategory) throw new Error('Выберите, какой это долг');
    if (fAction === meta.fin.DEBT && !fPerson) throw new Error('Выберите человека');
    if (!$('#fDate').value) throw new Error('Укажите дату');
    const tr = isTransfer(fAction);
    if (tr && (!fAccount || !fTo)) throw new Error('Для перевода выберите оба счёта');
    if (tr && fAccount === fTo) throw new Error('Счета перевода должны различаться');
    return { amount, actionType: fAction, category: tr ? meta.fin.BETWEEN : fCategory, date: $('#fDate').value, comment: $('#fComment').value.trim(),
      account: fAccount || '', toAccount: tr ? fTo : '', person: isDebt(fAction) ? fPerson : '' };
  }
  function resetFinanceForm() {
    fEdit = null; fRecur = null; $('#fEdit').classList.add('hidden'); $('#fSave').textContent = 'Добавить в список';
    $('#fAmount').value = ''; $('#fCalc').textContent = ''; setText($('#fComment'), '');
    fAccTouched = false; fAccount = defaultAccount(fAction); fTo = ''; fPerson = ''; renderAccounts(); renderPerson();
  }
  function fillFinanceForm(it, label) {
    $('#fAmount').value = it.amount; $('#fCalc').textContent = '';
    fAccTouched = true; fAccount = it.account || ''; fTo = it.toAccount || '';
    setAction(it.actionType); fCategory = it.category || ''; fPerson = it.person || ''; renderCategories(); renderAccounts();
    $('#fDate').value = it.date; setText($('#fComment'), it.comment);
    $('#fEdit span').textContent = label; $('#fEdit').classList.remove('hidden');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
  $('#fEdit .link').addEventListener('click', () => { resetFinanceForm(); renderAll(); });
  $('#fSave').addEventListener('click', () => {
    let it;
    try { it = readFinanceForm(); } catch (e) { toast(e.message, true); return; }
    const fLabel = (x) => `${x.actionType} ${money(x.amount)}${x.category ? ' · ' + x.category : ''}`;
    if (fEdit && fEdit.mode === 'saved') {
      const old = view().finance.find((r) => String(r[0]) === String(fEdit.id));
      const u = old && pushUndo({ tab: 'finance', type: 'update', op: 'updateFinance', key: 'f|' + fEdit.id, recId: fEdit.id, prev: rowToFinance(old), label: `Изменение записи №${fEdit.id}` });
      enqueue('updateFinance', Object.assign({ id: fEdit.id }, it), 'f|' + fEdit.id);
      toast(`Запись №${fEdit.id} изменена ✓`, false, u); offlineNote(); if (settings.autoSend) flush();
    } else if (fEdit && fEdit.mode === 'queue') {
      const o = outbox.find((x) => x.id === fEdit.opId);
      let u = null;
      if (o) { u = pushUndo({ tab: 'finance', type: 'opedit', op: o.id, prev: o.p, label: 'Изменение записи в списке' }); o.p = it; delete o.err; persist(); changed(); }
      toast('Изменено в списке', false, u);
    } else {
      if (fRecur) { it.recurId = fRecur.id; it.recurDue = fRecur.due; }
      const op = enqueue('addFinance', it);
      const u = pushUndo({ tab: 'finance', type: 'add', ops: [op.id], del: 'deleteFinance', label: fLabel(it) });
      toast(fRecur ? 'Платёж добавлен ✓' : `В списке: ${outbox.filter((o) => o.op === 'addFinance').length}`, false, u); budgetWarn(it);
      if (fRecur && settings.autoSend) flush({ all: true });
    }
    resetFinanceForm(); renderAll();
  });
  async function sendFinance() {
    if (!fEdit && $('#fAmount').value.trim()) { const it = readFinanceForm(); if (fRecur) { it.recurId = fRecur.id; it.recurDue = fRecur.due; } enqueue('addFinance', it); budgetWarn(it); resetFinanceForm(); }
    if (!outbox.length) throw new Error('Нет новых записей: заполните форму и нажмите «Добавить в список»');
    outbox.forEach((o) => { delete o.err; }); persist();
    offlineNote(); await flush({ all: true, finance: true, notify: true });
  }
  function financeItemHtml(it, sub, pend) {
    const tr = isTransfer(it.actionType), sign = tr ? 0 : flowSign(it.actionType, it.category);
    const acc = accText(it.account, tr ? it.toAccount : '');
    return `<div class="main"><div class="t">${esc(it.comment || (isDebt(it.actionType) && it.person ? it.person : '') || (tr ? 'Перевод' : it.category) || it.actionType)} ${pend || ''}</div><div class="s">${sub}${acc ? ' · ' + acc : ''}</div></div>
      <div class="amt ${sign > 0 ? 'in' : ''}">${tr ? '⇄ ' : sign > 0 ? '+' : sign < 0 ? '−' : ''}${money(it.amount)}</div>`;
  }
  function renderQueue() {
    const q = outbox.filter((o) => o.op === 'addFinance');
    $('#queueBox').classList.toggle('hidden', !q.length);
    $('#fQueue').innerHTML = q.map((o) => swipeWrap(o.id, financeItemHtml(o.p,
      `${o.err ? '<b class="err-text">⚠ ' + esc(o.err) + '</b> · ' : ''}${ru(o.p.date)} · ${esc(o.p.actionType)}${o.p.category ? ' · ' + esc(o.p.category) : ''}${o.p.person ? ' · 👤 ' + esc(o.p.person) : ''}`), 'Убрать',
      fEdit && fEdit.mode === 'queue' && fEdit.opId === o.id ? 'editing' : '')).join('');
    $('#queueTotal').textContent = q.length ? `${q.length} шт.` + (settings.autoSend ? (online ? ' · Уйдут в течение минуты' : ' · Уйдут, когда появится интернет') : '') : '';
  }
  swipeList($('#fQueue'), {
    onTap: (opId) => {
      const o = outbox.find((x) => x.id === opId); if (!o) return;
      fEdit = { mode: 'queue', opId }; fillFinanceForm(o.p, 'Изменение записи из списка'); $('#fSave').textContent = 'Сохранить в списке'; renderQueue();
    },
    onSwipe: (opId) => {
      const o = outbox.find((x) => x.id === opId);
      outbox = outbox.filter((x) => x.id !== opId); persist(); changed(); if (fEdit && fEdit.mode === 'queue') resetFinanceForm(); renderAll();
      toast('Убрано из списка', false, o && pushUndo({ tab: 'finance', type: 'oprestore', opObj: o, label: 'Удаление записи из списка' }));
    }
  });
  function renderFinanceRecent() {
    if (!srv && !outbox.length) { $('#fRecent').innerHTML = skeletonList(3); return; }
    const from = addDays(today(), -(DAYS.finance - 1));
    const queued = new Set(outbox.filter((o) => o.op === 'addFinance').map((o) => 'tmp:' + o.id));
    const debtMode = isDebt(fAction);
    // при действии «Долг» внизу — только записи долгов (за всё время, по выбранному человеку)
    const rows = view().finance.filter((r) => (debtMode ? r[3] === meta.fin.DEBT && (!debtFilter || debtPerson(r).toLowerCase() === debtFilter.toLowerCase()) : r[1] >= from)
      && !queued.has(String(r[0])) && !isHidden('finance', r[0])).sort(byNewest(1)).slice(0, debtMode ? 60 : 1e9);
    $('#fRecentTitle').textContent = debtMode ? (debtFilter ? `Долги: ${debtFilter}` : 'Все записи долгов') : `Последние ${DAYS.finance} дней`;
    $('#fRecent').innerHTML = rows.length ? rows.map((r) => {
      const it = { amount: r[2], actionType: r[3], category: r[4], comment: r[5], account: r[8], toAccount: r[9], person: r[10] };
      const who = r[3] === meta.fin.DEBT ? ' · 👤 ' + esc(debtPerson(r)) : '';
      return swipeWrap(r[0], financeItemHtml(it, `${isTmp(r[0]) ? '' : '№' + r[0] + ' · '}${ru(r[1])} · ${esc(r[3] || 'Без действия')}${r[4] ? ' · ' + esc(r[4]) : ''}${who}`, pendMark('f:' + r[0])),
        null, fEdit && fEdit.mode === 'saved' && String(fEdit.id) === String(r[0]) ? 'editing' : '');
    }).join('') : `<p class="empty">${debtMode ? 'Записей долгов нет' : `За ${DAYS.finance} дней записей нет`}</p>`;
  }
  swipeList($('#fRecent'), {
    onTap: (id) => {
      if (isTmp(id)) { toast('Запись синхронизируется — попробуйте через несколько секунд'); return; }
      const r = view().finance.find((x) => String(x[0]) === String(id)); if (!r) return;
      fEdit = { mode: 'saved', id: r[0] };
      fillFinanceForm(rowToFinance(r), `Редактирование записи №${r[0]}`);
      $('#fSave').textContent = 'Сохранить изменения'; renderFinanceRecent();
    },
    onSwipe: (id) => { hide('finance', id); if (fEdit && String(fEdit.id) === String(id)) resetFinanceForm(); renderFinanceRecent(); toast('Скрыто из списка', false, pushUndo({ tab: 'finance', type: 'hide', list: 'finance', recId: id, label: 'Скрытие записи из списка' })); }
  });

  // ═════════════ Настройки: действия и категории (CRUD) ═════════════
  let refDraft = null;
  function refStartEdit() {
    if (!meta) { $('#refEditor').innerHTML = '<p class="muted small">Загрузите данные, чтобы редактировать.</p>'; return; }
    buildFinRef();
    refDraft = FINREF.actions.map((a) => ({
      name: a, orig: a,
      cats: FINREF.cats[a].map((c) => ({ name: c, orig: c, icon: FINREF.icon[a + '|' + c] || '', flow: FINREF.flow[a + '|' + c] || defaultFlow(a, c) }))
    }));
    renderRefEditor();
  }
  function renderRefEditor() {
    const F = meta.flow;
    const flowSel = (v, ai, ci) => `<select data-ai="${ai}" data-ci="${ci}" data-f="flow" class="flow-sel f-${v === F.IN ? 'in' : v === F.OUT ? 'out' : 'none'}">
      ${[F.IN, F.OUT, F.NONE].map((x) => `<option value="${x}" ${x === v ? 'selected' : ''}>${x === F.IN ? '＋ Приход' : x === F.OUT ? '− Расход' : '0 Нет'}</option>`).join('')}</select>`;
    $('#refEditor').innerHTML = refDraft.map((a, ai) => `
      <div class="ref-action">
        <div class="ref-head">
          <input type="text" value="${esc(a.name)}" data-ai="${ai}" data-f="action" placeholder="Название действия" aria-label="Действие">
          <button type="button" class="icon-btn sm" data-del-action="${ai}" title="Удалить действие">🗑</button>
        </div>
        ${a.cats.map((c, ci) => `
          <div class="ref-cat">
            <input type="text" class="ic-in" value="${esc(c.icon)}" data-ai="${ai}" data-ci="${ci}" data-f="icon" maxlength="4" aria-label="Иконка">
            <input type="text" value="${esc(c.name)}" data-ai="${ai}" data-ci="${ci}" data-f="name" placeholder="Категория" aria-label="Категория">
            ${flowSel(c.flow, ai, ci)}
            <button type="button" class="icon-btn sm" data-del-cat="${ai}:${ci}" title="Удалить категорию">✕</button>
          </div>`).join('')}
        <button type="button" class="link" data-add-cat="${ai}">＋ Категория</button>
      </div>`).join('');
  }
  $('#refEditor').addEventListener('input', (e) => {
    const t = e.target, ai = Number(t.dataset.ai), ci = Number(t.dataset.ci), f = t.dataset.f;
    if (!f || !refDraft[ai]) return;
    if (f === 'action') refDraft[ai].name = t.value;
    else refDraft[ai].cats[ci][f] = t.value;
    if (f === 'flow') t.className = 'flow-sel f-' + (t.value === meta.flow.IN ? 'in' : t.value === meta.flow.OUT ? 'out' : 'none');
  });
  $('#refEditor').addEventListener('click', (e) => {
    const t = e.target.closest('button'); if (!t) return;
    if (t.dataset.addCat != null) { const a = refDraft[Number(t.dataset.addCat)]; a.cats.push({ name: '', orig: null, icon: '', flow: a.cats[0] ? a.cats[0].flow : meta.flow.OUT }); renderRefEditor(); $$(`#refEditor input[data-ai="${t.dataset.addCat}"][data-f="name"]`).pop().focus(); }
    if (t.dataset.delCat != null) { const [ai, ci] = t.dataset.delCat.split(':').map(Number); refDraft[ai].cats.splice(ci, 1); renderRefEditor(); }
    if (t.dataset.delAction != null) {
      const a = refDraft[Number(t.dataset.delAction)];
      if (confirmT(`Удалить действие «${a.name}» и все его категории? Старые записи в таблице останутся.`)) { refDraft.splice(Number(t.dataset.delAction), 1); renderRefEditor(); }
    }
  });
  $('#refAddAction').addEventListener('click', () => {
    if (!refDraft) return;
    refDraft.push({ name: '', orig: null, cats: [{ name: '', orig: null, icon: '', flow: meta.flow.OUT }] });
    renderRefEditor(); $$('#refEditor input[data-f="action"]').pop().focus();
  });
  $('#refReset').addEventListener('click', () => { refStartEdit(); toast('Изменения отменены'); });
  $('#refSave').addEventListener('click', (e) => withBusy(e.currentTarget, async () => {
    const pairs = [], renames = [], catRenames = [];
    refDraft.forEach((a) => {
      const name = a.name.trim(); if (!name) throw new Error('Заполните название действия');
      if (a.orig && a.orig !== name) renames.push({ type: 'action', from: a.orig, to: name });
      const cats = a.cats.filter((c) => c.name.trim());
      if (!cats.length) pairs.push([name, '', '', defaultFlow(name, '')]);
      cats.forEach((c) => {
        pairs.push([name, c.name.trim(), c.icon.trim(), c.flow]);
        if (c.orig && c.orig !== c.name.trim()) catRenames.push({ type: 'category', action: name, from: c.orig, to: c.name.trim() });
      });
    });
    if (!online && navigator.onLine === false) throw new Error('Нужен интернет, чтобы сохранить справочник');
    const m = await api('saveFinanceRef', { pairs, renames: renames.concat(catRenames) });
    meta = Object.assign(meta, { pairs: m.pairs }); store.set('lt_meta', meta);
    buildFinRef(); renderFinance(); refStartEdit(); changed(); renderAll();
    toast(m.renamed ? `Сохранено ✓ · Переименовано записей: ${m.renamed}` : 'Справочник сохранён ✓');
    sync(true);
  }));

  // ═════════════ Дашборды: всё считается на телефоне ═════════════
  let period = settings.dash.period && settings.dash.period !== 'last' ? settings.dash.period : store.get('lt_period', 'month');
  // какие периоды показывать вверху дашборда (⚙ → Дашборд)
  const P_LABEL = { today: 'Сегодня', week: 'Неделя', '10d': '10 дней', month: 'Месяц', prev: 'Прошлый месяц', year: 'Год', all: 'Всё' };
  const hiddenPeriods = () => (settings.dash.hidePeriods || []).filter((p) => P_LABEL[p]);
  function applyPeriods() {
    const hid = hiddenPeriods();
    $$('#sPeriod button').forEach((x) => x.classList.toggle('hidden', hid.indexOf(x.dataset.p) >= 0));
    if (hid.indexOf(period) >= 0) { const first = Object.keys(P_LABEL).find((p) => hid.indexOf(p) < 0); if (first) { period = first; store.set('lt_period', period); } }
    $$('#sPeriod button').forEach((x) => x.classList.toggle('on', x.dataset.p === period));
    const pc = $('#periodChips');
    if (pc) pc.innerHTML = Object.keys(P_LABEL).map((p) => `<button type="button" data-pchip="${p}" class="${hid.indexOf(p) < 0 ? 'on' : ''}">${hid.indexOf(p) < 0 ? '✓ ' : ''}${P_LABEL[p]}</button>`).join('');
  }
  $('#periodChips').addEventListener('click', (e) => {
    const b = e.target.closest('[data-pchip]'); if (!b) return;
    const hid = hiddenPeriods(), p = b.dataset.pchip, i = hid.indexOf(p);
    if (i >= 0) hid.splice(i, 1); else { if (Object.keys(P_LABEL).length - hid.length <= 1) { toast('Хотя бы один период должен остаться'); return; } hid.push(p); }
    settings.dash.hidePeriods = hid; saveSettings(); applyPeriods(); renderStats();
  });
  applyPeriods();
  $('#sPeriod').addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return;
    period = b.dataset.p; store.set('lt_period', period);
    $$('#sPeriod button').forEach((x) => x.classList.toggle('on', x === b)); renderStats();
  });
  const ALL_FROM = '2000-01-01';
  const PERIOD_TXT = { today: 'Сегодня', week: 'Эта неделя', '10d': '10 дней', month: 'Этот месяц', prev: 'Прошлый месяц', year: 'Этот год', all: 'Всё время' };
  function periodRange(p) {
    const n = new Date(), t = today();
    if (p === 'today') return [t, t];
    if (p === 'week') return [addDays(t, -((n.getDay() + 6) % 7)), t]; // с понедельника
    if (p === '10d') return [addDays(t, -9), t];
    if (p === 'month') return [iso(new Date(n.getFullYear(), n.getMonth(), 1)), t];
    if (p === 'prev') return [iso(new Date(n.getFullYear(), n.getMonth() - 1, 1)), iso(new Date(n.getFullYear(), n.getMonth(), 0))];
    if (p === 'year') return [iso(new Date(n.getFullYear(), 0, 1)), t];
    return [ALL_FROM, t];
  }
  let statsMemo = {};

  function computeStats(from, to) {
    const accF = settings.dash.account || '';
    const key = from + '|' + to + '|' + accF;
    if (statsMemo[key]) return statsMemo[key];
    const v = view(), fin = meta.fin;
    const f = { income: 0, expense: 0, charity: 0, byCategory: {}, inByCategory: {}, iOwe: 0, owedToMe: 0, savings: 0, maxExp: null, firstDate: null };
    // реальный остаток на конец периода: начальные остатки счетов + все записи до конца периода
    f.balance = ((meta.accounts || []).filter((x) => !accF || x.name === accF)).reduce((t, x) => t + (Number(x.start) || 0), 0);
    v.finance.forEach((r) => {
      const amt = Number(r[2]) || 0, a = String(r[3] || ''), c = String(r[4] || '');
      const tr = a === fin.TRANSFER;
      if (accF && r[8] !== accF && !(tr && r[9] === accF)) return; // фильтр по счёту
      if (r[1] <= to) f.balance += tr ? (accF ? (r[9] === accF ? amt : -amt) : 0) : flowSign(a, c) * amt;
      if (tr) { // перевод между своими счетами: в общем итоге не влияет, по одному счёту — приход или расход
        if (!accF || r[1] < from || r[1] > to) return;
        if (r[9] === accF) { f.income += amt; const k = 'Перевод с ' + r[8] + '\u0000' + a; f.inByCategory[k] = (f.inByCategory[k] || 0) + amt; }
        else { f.expense += amt; const k = 'Перевод на ' + r[9] + '\u0000' + a; f.byCategory[k] = (f.byCategory[k] || 0) + amt; }
        return;
      }
      if (c === fin.SAVED) f.savings += amt; if (c === fin.WITHDRAWN) f.savings -= amt;
      if (r[1] < from || r[1] > to) return;
      if (!f.firstDate || r[1] < f.firstDate) f.firstDate = r[1];
      const sign = flowSign(a, c), k = (c || a || 'Без категории') + '\u0000' + a;
      if (sign > 0) { f.income += amt; f.inByCategory[k] = (f.inByCategory[k] || 0) + amt; }
      if (sign < 0) {
        f.expense += amt; f.byCategory[k] = (f.byCategory[k] || 0) + amt;
        if (a === fin.EXPENSE && (!f.maxExp || amt > f.maxExp.amt)) f.maxExp = { amt, label: r[5] || c || a, date: r[1] };
      }
      if (a === fin.EXPENSE && c === fin.CHARITY) f.charity += amt;
    });
    const prayers = {}; PKEYS.forEach((k) => { prayers[k] = {}; });
    v.prayers.forEach((r) => {
      if (r[0] < from || r[0] > to) return;
      PKEYS.forEach((k, i) => { const s = r[i + 1] || noData(); prayers[k][s] = (prayers[k][s] || 0) + 1; });
    });
    // серия: подряд идущие дни, когда все 5 фарз — Jamaah или Best time (по всем данным)
    const good = (r) => r && FARD.every((k) => isOnTime(r[PKEYS.indexOf(k) + 1]));
    let streak = 0, d = today();
    if (!good(v.prayers.get(d))) d = addDays(d, -1); // сегодняшний день ещё может быть не закрыт
    while (good(v.prayers.get(d))) { streak++; d = addDays(d, -1); }
    let best = 0, run = 0, prev = null;
    [...v.prayers.keys()].sort().forEach((dt) => {
      if (good(v.prayers.get(dt))) { run = prev && addDays(prev, 1) === dt ? run + 1 : 1; prev = dt; best = Math.max(best, run); }
      else { run = 0; prev = null; }
    });
    const reading = {}, byDay = {}, memPages = new Set(), memSuras = new Set(), touch = {};
    const KM = meta.kinds[1] || 'Заучивание', KR = meta.kinds[2] || 'Повторение';
    const markTouch = (p, d) => { if (!touch[p] || touch[p] < d) touch[p] = d; };
    // заучено ранее (Настройки → Коран): считается повторённым на указанную дату
    const pre = hifzPre();
    pre.pages.forEach((p) => { memPages.add(p); if (pre.date) markTouch(p, pre.date); });
    pre.suras.forEach((n) => memSuras.add(n));
    v.reading.forEach((r) => {
      const k = r[2];
      if (k === KM || k === KR) {
        let a = r[4] !== '' ? Number(r[4]) : null, b = r[5] !== '' ? Number(r[5]) : null;
        if (a == null && r[9] !== '') [a, b] = suraPages(Number(r[9])); // сура → её страницы
        if (a != null && b != null) for (let p = a; p <= b; p++) { if (k === KM) memPages.add(p); markTouch(p, r[1]); }
        if (k === KM && r[9] !== '') memSuras.add(Number(r[9]));
      }
      if (r[1] < from || r[1] > to) return;
      const o = reading[k] || (reading[k] = { entries: 0, pages: 0, ayahs: 0 });
      o.entries++; o.pages += Number(r[8]) || 0; o.ayahs += Number(r[12]) || 0;
      const dd = byDay[r[1]] || (byDay[r[1]] = { pages: 0 }); dd.pages += Number(r[8]) || 0;
    });
    const DL = debtLedger(); f.iOwe = DL.iOwe; f.owedToMe = DL.owed; f.debtList = DL.list; // долги — по людям, без фильтра по счёту
    return (statsMemo[key] = { finance: f, prayers, streak, bestStreak: best, reading, readingByDay: byDay,
      hifzPages: memPages.size, hifzSuras: memSuras.size, memPages, memSuras, touch });
  }

  // ── мелкие части виджетов
  const lastDays = (from, to, max) => {
    const end = to > today() ? today() : to, out = [];
    for (let d = end; d >= from && out.length < max; d = addDays(d, -1)) out.unshift(d);
    return out;
  };
  function dayBars(byDay, from, to) {
    const days = lastDays(from, to, 31);
    const max = Math.max(1, ...days.map((d) => (byDay[d] || {}).pages || 0));
    const showLabel = (i) => days.length <= 12 || i % 5 === 0 || i === days.length - 1;
    return `<div class="daybars">${days.map((d, i) => { const v = (byDay[d] || {}).pages || 0;
      return `<div title="${ru(d)}: ${v} стр."><b class="${v ? '' : 'zero'}" style="height:${(v / max * 100).toFixed(0)}%"></b><span>${showLabel(i) ? Number(d.slice(8)) : ''}</span></div>`; }).join('')}</div>
      <p class="muted small" style="margin:0">Страниц по дням (с повторами)${days.length === 31 ? ' · Последние 31 день периода' : ''}</p>`;
  }
  function catBars(obj, emptyText, sign) {
    const cats = Object.entries(obj).sort((a, b) => b[1] - a[1]), maxCat = cats.length ? cats[0][1] : 1, tot = cats.reduce((t, x) => t + x[1], 0);
    return cats.length ? cats.map(([k, v]) => { const [c, a] = k.split('\u0000');
      return `<button type="button" class="bar-row fd-row" data-fd="cat" data-cat="${esc(c)}" data-sign="${sign || 0}"><span class="cat"><span class="ic">${icon(a, c)}</span>${esc(c)}</span><b>${money(v)} <span class="muted small">${tot ? Math.round(v / tot * 100) : 0}%</span></b><div class="bar"><i style="width:${(v / maxCat * 100).toFixed(1)}%"></i></div></button>`; }).join('')
      : `<p class="empty">${emptyText}</p>`;
  }
  const card = (title, body, right) => `<div class="card w-card"><div class="w-head"><div class="lbl">${title}</div>${right || ''}</div>${body}</div>`;

  // ── виджеты дашборда (порядок и видимость — в ⚙ настройках)
  /** Остатки по счетам: начальный остаток + приход − расход ± переводы (за всё время). */
  function accountBalances(from, to) {
    const fin = meta.fin, all = (meta.accounts || []), bal = {}, per = {}, open = {}, close = {}, pin = {}, pout = {};
    const init = (n, st) => { bal[n] = st; open[n] = st; close[n] = st; per[n] = 0; pin[n] = 0; pout[n] = 0; };
    all.forEach((a) => init(a.name, Number(a.start) || 0));
    let blank = 0, blankSum = 0;
    const add = (name, v, d) => {
      if (!(name in bal)) init(name, 0);
      bal[name] += v;
      if (d < from) open[name] += v;
      if (d <= to) close[name] += v;
      if (d >= from && d <= to) { per[name] += v; if (v > 0) pin[name] += v; else pout[name] -= v; }
    };
    view().finance.forEach((r) => {
      const amt = Number(r[2]) || 0, a = r[3];
      if (a === fin.TRANSFER) { if (r[8]) add(r[8], -amt, r[1]); if (r[9]) add(r[9], amt, r[1]); return; }
      const sign = flowSign(a, r[4]); if (!sign) return;
      if (r[8]) add(r[8], sign * amt, r[1]); else { blank++; blankSum += sign * amt; }
    });
    return { bal, per, open, close, pin, pout, blank, blankSum };
  }
  const signed = (v) => `<span class="${v > 0 ? 'pos' : v < 0 ? 'neg' : ''}">${v < 0 ? '−' : v > 0 ? '+' : ''}${money(Math.abs(v))}</span>`;
  const WIDGETS = {
    'budgets': { title: 'Бюджеты: лимиты месяца', on: true, render: () => {
      const list = budgets(); if (!list.length) return '';
      const m = thisMonth(), dim = new Date(Number(m.slice(0, 4)), Number(m.slice(5, 7)), 0).getDate(), dayN = Number(today().slice(8));
      const rows = list.map((b) => { const a = b.action || meta.fin.EXPENSE, sp = monthSpent(a, b.category); return { a, c: b.category, sp, lim: b.limit, pct: sp / b.limit }; })
        .sort((x, y) => y.pct - x.pct);
      const tot = rows.reduce((t, r) => t + r.sp, 0), totL = rows.reduce((t, r) => t + r.lim, 0);
      return card('Бюджеты на месяц', rows.map((r) => `<div class="bar-row bud ${budgetLevel(r.sp, r.lim)}"><span class="cat"><span class="ic">${icon(r.a, r.c)}</span>${esc(r.c)}</span>
          <b>${money(r.sp)} <span class="muted small">/ ${money(r.lim)}</span></b><div class="bar"><i style="width:${Math.min(100, r.pct * 100).toFixed(1)}%"></i><u style="left:${(dayN / dim * 100).toFixed(1)}%"></u></div>
          ${r.sp > r.lim ? `<span class="small neg">Превышен на ${money(r.sp - r.lim)}</span>` : `<span class="small muted">Осталось ${money(r.lim - r.sp)}</span>`}</div>`).join('')
        + `<p class="muted small" style="margin:6px 0 0">Всего ${money(tot)} из ${money(totL)} · Черта на полосе — сегодняшний день месяца</p>`,
        `<span class="muted small">${m.slice(5, 7)}.${m.slice(0, 4)}</span>`);
    } },
    'recurring': { title: 'Ближайшие платежи (30 дней)', on: true, render: () => {
      const t = today(), end = addDays(t, 30), items = [];
      recurList().filter((r) => r.active && r.next).forEach((r) => {
        let d = r.next, g = 0;
        while (d <= end && g++ < 40) { items.push({ r, d }); d = advanceDate(d, r.repeat, r.every, r.day); }
      });
      if (!items.length) return '';
      items.sort((a, b) => (a.d < b.d ? -1 : 1));
      const sum = items.reduce((s, x) => s + x.r.amount, 0);
      return card('Ближайшие платежи', items.slice(0, 12).map(({ r, d }) => { const n = daysBetween(t, d);
        return `<div class="acc-row rc-row ${n < 0 ? 'over' : ''}"><span class="ic">${rIcon(r)}</span><span class="acc-name">${esc(r.name)}${r.auto ? ' <span class="muted small">· Авто</span>' : ''}</span>
          <span class="acc-per muted small">${dueText(n)}</span><b class="acc-bal">${money(r.amount)}</b></div>`; }).join('')
        + `<div class="acc-row acc-total"><span class="ic">Σ</span><span class="acc-name">Всего за 30 дней</span><span></span><b class="acc-bal">${money(sum)}</b></div>`);
    } },
    'quran-plan': { title: 'Коран: план на сегодня', on: true, render: () => { const h = planHtml(true); return h ? card('Коран: план на сегодня', h) : ''; } },
    'goals': { title: 'Цели', on: true, render: () => {
      const gs = goals();
      if (!gs.length) return card('Цели', '<p class="muted small" style="margin:0 0 8px">Поставьте цель: страниц Корана в день, хифз за месяц, сумма накоплений, молитвы вовремя.</p><button type="button" class="btn ghost block" data-open-goals>＋ Добавить цель</button>');
      return card('Цели', gs.map(goalHtml).join(''), '<button type="button" class="link small" data-open-goals>Изменить</button>');
    } },

    'acc-tiles': { periodic: true, title: 'Карты: плитки (баланс, приход и расход)', on: true, render: (s, from, to) => {
      const accs = meta.accounts || []; if (!accs.length) return '';
      const b = accountBalances(from, to), cfg = settings.dash.cards || {}, accF = settings.dash.account || '';
      const shown = accs.filter((a) => (cfg[a.name] || {}).on !== false && (!a.archived || Math.abs(b.bal[a.name] || 0) > 0.004));
      if (!shown.length) return '';
      const now = to >= today(), at = now ? 'сейчас' : 'на ' + ru(to);
      const amt = (v) => `${v < 0 ? '−' : ''}${money(Math.abs(v))}`;
      return `<div class="acc-tiles">${shown.map((a) => {
        const n = a.name, mode = (cfg[n] || {}).mode || 'flow', cl = b.close[n] || 0;
        const body = mode === 'balance'
          ? `<div class="note">${at[0].toUpperCase() + at.slice(1)}${b.per[n] ? ' · ' + signed(b.per[n]) + ' за период' : ''}</div>`
          : `<div class="at-flow"><span>Приход</span><b class="pos">+${money(b.pin[n] || 0)}</b><span>Расход</span><b>−${money(b.pout[n] || 0)}</b><span>${from === ALL_FROM ? 'Нач. остаток' : 'На начало'}</span><b>${amt(b.open[n] || 0)}</b></div><div class="note">Баланс ${at}</div>`;
        return `<button type="button" class="kpi acc-tile ${accF === n ? 'on' : ''}" data-fd="account" data-tacc="${esc(n)}">
          <div class="k"><span class="ic">${a.icon || '💳'}</span>${esc(n)}</div><div class="v ${cl < 0 ? 'neg' : ''}">${amt(cl)}</div>${body}</button>`;
      }).join('')}</div>`;
    } },
    'accounts': { periodic: true, title: 'Счета и карты: остатки', on: true, render: (s, from, to) => {
      const accs = (meta.accounts || []); if (!accs.length) return '';
      const b = accountBalances(from, to), names = Object.keys(b.bal).filter((n) => { const a = accs.find((x) => x.name === n); return !(a && a.archived) || Math.abs(b.bal[n]) > 0.004; });
      const total = names.reduce((t, n) => t + b.bal[n], 0);
      const def = (accs.find((a) => a.isDefault && !a.archived) || accs[0] || {}).name;
      return card('Счета и карты', names.map((n) => `<div class="acc-row"><span class="ic">${accIcon(n)}</span><span class="acc-name">${esc(n)}</span>
          <span class="acc-per muted small">${b.per[n] ? 'За период ' + signed(b.per[n]) : ''}</span><b class="acc-bal ${b.bal[n] < 0 ? 'neg' : ''}">${b.bal[n] < 0 ? '−' : ''}${money(Math.abs(b.bal[n]))}</b></div>`).join('')
        + `<div class="acc-row acc-total"><span class="ic">Σ</span><span class="acc-name">Всего</span><span></span><b class="acc-bal ${total < 0 ? 'neg' : ''}">${total < 0 ? '−' : ''}${money(Math.abs(total))}</b></div>`
        + (b.blank ? `<p class="small muted acc-blank">${b.blank} записей без счёта (${signed(b.blankSum)}) не входят в остатки. <button type="button" class="link" data-assign="${esc(def || '')}">Привязать к «${esc(def || '')}»</button></p>` : ''),
        '<span class="muted small">Всё время</span>');
    } },

    'fin-kpi': { periodic: true, title: 'Финансы: приход, остаток, расходы, хайр', on: true, render: (s, from, to) => {
      const f = s.finance, net = f.income - f.expense, bal = Math.round(f.balance * 100) / 100, cls = bal > 0 ? 'pos' : bal < 0 ? 'neg' : 'zero';
      return `<div class="kpis">
        <button type="button" class="kpi kpi-btn" data-fd="income"><div class="k">Приход</div><div class="v" style="color:var(--plus)">${money(f.income)}</div></button>
        <button type="button" class="kpi kpi-btn" data-fd="balance"><div class="k">Остаток</div><div class="v rest ${cls}">${bal < 0 ? '−' : ''}${money(Math.abs(bal))}</div><div class="note">${to >= today() ? 'На сегодня' : 'На ' + ru(to)} · За период ${signed(net)}</div></button>
        <button type="button" class="kpi kpi-btn" data-fd="expense"><div class="k">Расходы</div><div class="v">${money(f.expense)}</div></button>
        <button type="button" class="kpi kpi-btn" data-fd="charity"><div class="k">🤲 Хайр</div><div class="v" style="color:var(--gold)">${money(f.charity)}</div><div class="note">Входит в расходы</div></button>
      </div>`; } },
    'fin-bars': { periodic: true, title: 'Финансы: столбцы по дням, неделям, месяцам', on: true, render: (s, from, to) => {
      const W = settings.dash.fb || {}, g = W.g || 'day', m = W.m || 'exp';
      const items = finItems(from, to, settings.dash.account || ''); if (!items.length) return '';
      const seg = (attr, cur, opts) => `<div class="seg fb-g">${opts.map(([v, t]) => `<button type="button" ${attr}="${v}" class="${cur === v ? 'on' : ''}">${t}</button>`).join('')}</div>`;
      return card(m === 'exp' ? 'Расходы' : m === 'inc' ? 'Приход' : 'Приход и расход', seg('data-fbm', m, [['exp', 'Расходы'], ['both', 'Оба'], ['inc', 'Приход']])
        + `<div data-fbg="${g}">${finBarsHtml(items, from, to, g, m, 'w')}</div>` + seg('data-fbgs', g, [['day', 'По дням'], ['week', 'По неделям'], ['month', 'По месяцам']]));
    } },
    'debts': { title: 'Долги и накопления', on: true, render: (s) => { const f = s.finance;
      const open = (f.debtList || []).filter((o) => o.iOwe > 0.004 || o.owed > 0.004).sort((a, b) => (b.iOwe + b.owed) - (a.iOwe + a.owed));
      return `<button type="button" class="kpis three kpi-link" data-open-debts>
        <div class="kpi"><div class="k">Я должен</div><div class="v">${money(f.iOwe)}</div></div>
        <div class="kpi"><div class="k">Мне должны</div><div class="v">${money(f.owedToMe)}</div></div>
        <div class="kpi"><div class="k">Накоплено</div><div class="v">${money(f.savings)}</div></div>
      </button>${open.length ? card('Долги по людям', open.slice(0, 8).map((o) => `<button type="button" class="debt-row" data-open-debts="${esc(o.name)}"><span class="debt-name">${esc(o.name)}</span>${o.iOwe > 0.004 ? `<span class="debt-amt neg">Я должен ${money(o.iOwe)}</span>` : ''}${o.owed > 0.004 ? `<span class="debt-amt pos">Мне должны ${money(o.owed)}</span>` : ''}</button>`).join('')
        + (open.length > 8 ? `<p class="muted small" style="margin:6px 0 0">И ещё: ${open.length - 8}</p>` : '')) : ''}`; } },
    'fin-avg': { periodic: true, title: 'Средний расход в день и крупная трата', on: false, render: (s, from, to) => {
      const f = s.finance, start = from === ALL_FROM ? (f.firstDate || to) : from, end = to > today() ? today() : to;
      const days = Math.max(1, Math.round((new Date(end + 'T12:00') - new Date(start + 'T12:00')) / 864e5) + 1);
      return `<div class="kpis">
        <div class="kpi"><div class="k">В среднем в день</div><div class="v">${money(f.expense / days)}</div><div class="note">За ${days} дн.</div></div>
        <div class="kpi"><div class="k">Самая крупная трата</div><div class="v">${f.maxExp ? money(f.maxExp.amt) : '—'}</div><div class="note">${f.maxExp ? esc(f.maxExp.label) + ' · ' + ru(f.maxExp.date) : ''}</div></div>
      </div>`; } },
    'exp-cats': { periodic: true, title: 'Расходы по категориям', on: true, render: (s) => card('Расходы по категориям', catBars(s.finance.byCategory, 'Нет расходов за период', -1)) },
    'inc-cats': { periodic: true, title: 'Приход по категориям', on: true, render: (s) => card('Приход по категориям', catBars(s.finance.inByCategory, 'Нет прихода за период', 1)) },
    'prayer-matrix': { periodic: true, title: 'Молитвы: статусы', on: true, render: (s) => {
      let onTime = 0, total = 0;
      FARD.forEach((k) => { const p = s.prayers[k] || {}; meta.statuses.slice(0, 2).forEach((st) => { onTime += p[st] || 0; });
        total += Object.entries(p).filter(([st]) => st !== noData()).reduce((t, [, v]) => t + v, 0); });
      const pct = total ? Math.round(onTime / total * 100) : 0;
      const sts = meta.statuses.filter((st) => hiddenSt().indexOf(st) < 0 || VK().some((k) => (s.prayers[k] || {})[st]));
      const rows = VK().map((k) => {
        const p = s.prayers[k] || {}, nafl = FARD.indexOf(k) < 0;
        return `<tr class="${nafl ? 'nafl' : ''}"><th>${esc(pNameDash(k))}</th>${sts.map((st) => {
          const n = p[st] || 0;
          return `<td>${n ? `<span class="pm-cell ${stc(st)}" title="${esc(st)}: ${n}">${n}</span>` : '<span class="pm-zero">·</span>'}</td>`;
        }).join('')}</tr>`;
      }).join('');
      return card('Молитвы', `
        <table class="pm"><thead><tr><th></th>${sts.map((st) => `<th><span class="${stc(st)} pm-h">${esc(stShort(st))}</span></th>`).join('')}</tr></thead>
        <tbody>${rows}</tbody></table>
        ${VK().some((k) => FARD.indexOf(k) < 0) ? `<p class="muted small" style="margin:8px 0 0">${VK().filter((k) => FARD.indexOf(k) < 0).map(pNameDash).map(esc).join(' и ')} — нафиль, в процент «вовремя» не входят.</p>` : ''}`,
        `<div class="pm-pct"><b>${pct}%</b><span>Вовремя · 5 фарз</span></div>`);
    } },
    'prayer-days': { periodic: true, title: 'Молитвы по дням (сетка)', on: true, render: (s, from, to) => {
      const days = lastDays(from, to, 31), v = view();
      if (!days.length) return '';
      const grid = PKEYS.map((k, i) => !showP(k) ? '' : `<div class="pd-row"><span class="pd-name">${esc(pNameDash(k))}</span><div class="pd-cells" style="grid-template-columns:repeat(${days.length},1fr)">${days.map((d) => {
        const r = v.prayers.get(d), st = r ? r[i + 1] : '';
        return `<i class="${st ? stc(st) + ' on' : ''}" title="${ru(d)} · ${esc(pNameDash(k))}: ${esc(st || '—')}"></i>`; }).join('')}</div></div>`).join('');
      const labels = `<div class="pd-row pd-labels"><span class="pd-name"></span><div class="pd-cells" style="grid-template-columns:repeat(${days.length},1fr)">${days.map((d, i) => `<span>${days.length <= 10 || i % 5 === 0 || i === days.length - 1 ? Number(d.slice(8)) : ''}</span>`).join('')}</div></div>`;
      return card('Молитвы по дням', grid + labels + `<div class="legend">${meta.statuses.filter((x) => x !== noData() && hiddenSt().indexOf(x) < 0).map((st) => `<span class="lg ${stc(st)}"><i></i>${esc(st)}</span>`).join('')}</div>`,
        days.length === 31 ? '<span class="muted small">Последние 31 день</span>' : '');
    } },
    'prayer-streak': { title: 'Серия: все фарзы вовремя', on: true, render: (s) => `<div class="kpis">
        <div class="kpi"><div class="k">🔥 Серия сейчас</div><div class="v">${s.streak} <small>дн.</small></div><div class="note">Все 5 фарз — ${esc(meta.statuses[0])} или ${esc(meta.statuses[1])}</div></div>
        <div class="kpi"><div class="k">Лучшая серия</div><div class="v">${s.bestStreak} <small>дн.</small></div><div class="note">За всё время</div></div>
      </div>` },
    'quran': { periodic: true, title: 'Коран: чтение, заучивание, повторение', on: true, render: (s, from, to) => {
      const tot = Object.values(s.reading).reduce((t, o) => t + o.pages, 0);
      return card(`Коран · ${tot} стр. за период`, `<table class="mini"><tr><th>Вид</th><th>Записей</th><th>Страниц</th><th>Аятов</th></tr>
        ${meta.kinds.map((k) => { const o = s.reading[k] || { entries: 0, pages: 0, ayahs: 0 }; return `<tr><td>${esc(k)}</td><td>${o.entries}</td><td>${o.pages}</td><td>${o.ayahs}</td></tr>`; }).join('')}
        </table>${dayBars(s.readingByDay, from, to)}`); } },
    'hifz': { title: 'Хифз: прогресс и карта 604 страниц', on: true, render: (s) => {
      const pct = (s.hifzPages / meta.pages * 100).toFixed(1), view = settings.dash.hifzView === 'suras' ? 'suras' : 'pages';
      const cls = (last, m) => { if (!m) return ''; const age = last ? (new Date(today()) - new Date(last)) / 864e5 : 1e9; return age <= settings.quran.fresh ? 'h-fresh' : age <= settings.quran.stale ? 'h-ok' : 'h-old'; };
      let grid;
      if (view === 'suras') {
        grid = `<div class="hifz-suras">${meta.suras.map((x) => { const st = suraHifz(s, x.n);
          return `<button type="button" data-hs="${x.n}" class="${cls(st.last, st.full)} ${st.part && !st.full ? 'h-part' : ''}" aria-label="${x.n}. ${esc(x.name)}">${x.n}</button>`; }).join('')}</div>`;
      } else {
        const cells = [];
        for (let p = 1; p <= meta.pages; p++) cells.push(`<i data-hp="${p}" class="${cls(s.touch[p], s.memPages.has(p))}"></i>`);
        grid = `<div class="hifz-map">${cells.join('')}</div>`;
      }
      return card('Хифз', `<div class="progress"><i style="width:${pct}%"></i></div>
        <p class="small" style="margin:0 0 10px">${s.hifzPages} из ${meta.pages} страниц (${pct}%) · ${s.hifzSuras} из 114 сур</p>
        <div class="seg hz-view"><button type="button" data-hzv="pages" class="${view === 'pages' ? 'on' : ''}">По страницам</button><button type="button" data-hzv="suras" class="${view === 'suras' ? 'on' : ''}">По сурам</button></div>
        ${grid}
        <div class="legend"><span class="lg h-fresh"><i></i>Повторено ≤ ${settings.quran.fresh} дн.</span><span class="lg h-ok"><i></i>≤ ${settings.quran.stale} дн.</span><span class="lg h-old"><i></i>Давно</span>${view === 'suras' ? '<span class="lg h-part"><i></i>Частично</span>' : ''}<span class="lg"><i></i>Не заучено</span></div>
        <div id="hzDetail" class="hz-detail muted small">Нажмите на клетку — появятся сура, страницы и когда вы её читали и повторяли.</div>`,
        '<span class="muted small">Всё время</span>');
    } }
  };
  const DEFAULT_ORDER = ['quran-plan', 'goals', 'fin-kpi', 'fin-bars', 'acc-tiles', 'accounts', 'recurring', 'budgets', 'debts', 'fin-avg', 'exp-cats', 'inc-cats', 'prayer-matrix', 'prayer-streak', 'prayer-days', 'quran', 'hifz'];
  if ((settings.wv || 0) < 5 && settings.widgets && settings.widgets.length) { // v5: включить «Приход по категориям», плитки карт после финансов
    const l = settings.widgets.filter((w) => w.id !== 'acc-tiles');
    l.forEach((w) => { if (w.id === 'inc-cats') w.on = true; });
    const i = l.findIndex((w) => w.id === 'fin-kpi'); l.splice(i < 0 ? 0 : i + 1, 0, { id: 'acc-tiles', on: true });
    const e = l.findIndex((w) => w.id === 'exp-cats'), n = l.findIndex((w) => w.id === 'inc-cats');
    if (e >= 0 && n >= 0 && n !== e + 1) { const [x] = l.splice(n, 1); l.splice(l.findIndex((w) => w.id === 'exp-cats') + 1, 0, x); }
    settings.widgets = l;
  }
  if ((settings.wv || 0) < 6 && settings.widgets && settings.widgets.length) { // v6: цели сверху, платежи и бюджеты после счетов
    const l = settings.widgets.filter((w) => ['goals', 'recurring', 'budgets'].indexOf(w.id) < 0);
    l.unshift({ id: 'goals', on: true });
    let at = l.findIndex((w) => w.id === 'accounts'); if (at < 0) at = l.findIndex((w) => w.id === 'acc-tiles');
    l.splice(at < 0 ? 1 : at + 1, 0, { id: 'recurring', on: true }, { id: 'budgets', on: true });
    settings.widgets = l;
  }
  if ((settings.wv || 0) < 6) { settings.wv = 6; saveSettings(); }
  if ((settings.wv || 0) < 7 && settings.widgets && settings.widgets.length) { settings.widgets = [{ id: 'quran-plan', on: true }].concat(settings.widgets.filter((w) => w.id !== 'quran-plan')); }
  if ((settings.wv || 0) < 7) { settings.wv = 7; saveSettings(); }
  if ((settings.wv || 0) < 8 && settings.widgets && settings.widgets.length && !settings.widgets.some((w) => w.id === 'fin-bars')) { // v8: столбцы после «Финансы»
    const i = settings.widgets.findIndex((w) => w.id === 'fin-kpi'); settings.widgets.splice(i < 0 ? 0 : i + 1, 0, { id: 'fin-bars', on: true });
  }
  if ((settings.wv || 0) < 8) { settings.wv = 8; saveSettings(); }
  function widgetList() {
    const saved = (settings.widgets || []).filter((w) => WIDGETS[w.id]);
    const ids = saved.map((w) => w.id);
    DEFAULT_ORDER.forEach((id) => { if (ids.indexOf(id) < 0) saved.push({ id, on: WIDGETS[id].on }); }); // новые виджеты
    return saved;
  }
  function saveWidgets(list) { settings.widgets = list; saveSettings(); }

  const skeletonStats = () => `<div class="kpis">${'<div class="kpi"><i class="sk w40"></i><i class="sk w60 big"></i></div>'.repeat(4)}</div>
    ${'<div class="card"><i class="sk w40"></i><i class="sk w100"></i><i class="sk w80"></i></div>'.repeat(3)}`;
  function renderStats() {
    const body = $('#statsBody');
    if (!meta || (!srv && !outbox.length)) { body.innerHTML = skeletonStats(); return; }
    const [from, to] = periodRange(period), s = computeStats(from, to);
    const html = widgetList().filter((w) => w.on).map((w) => {
      try {
        const W = WIDGETS[w.id], own = W.periodic && w.period && w.period !== period;
        if (!own) { const o = W.render(s, from, to); return o ? `<div class="w-box" data-from="${from}" data-to="${to}">${o}</div>` : ''; }
        const [f2, t2] = periodRange(w.period), out = W.render(computeStats(f2, t2), f2, t2);
        return out ? `<div class="w-own" data-from="${f2}" data-to="${t2}"><div class="w-per">📅 ${PERIOD_TXT[w.period]}</div>${out}</div>` : '';
      } catch (e) { console.error(w.id, e); return ''; }
    }).join('');
    const accs = ACCS(); if (settings.dash.account && !((meta && meta.accounts) || []).some((a) => a.name === settings.dash.account)) settings.dash.account = '';
    const accF = settings.dash.account || '';
    const accChips = accs.length > 1 ? `<div class="chips select acc-filter">${[['', 'Все счета', '∑']].concat(accs.map((a) => [a.name, a.name, a.icon || '💳'])).map(([v, t, ic]) =>
      `<button type="button" data-acc="${esc(v)}" class="${v === accF ? 'on' : ''}"><span class="ic">${ic}</span>${esc(t)}</button>`).join('')}</div>` : '';
    body.innerHTML = `<p class="muted small">${period === 'all' ? 'Всё время' : from === to ? ru(from) : ru(from) + ' — ' + ru(to)}${accF ? ' · Счёт: ' + esc(accF) : ''}${outbox.length ? ' · С учётом неотправленных' : ''}</p>`
      + accChips
      + (html || '<p class="empty">Все блоки выключены — включите их в ⚙ настройках.</p>')
      + '<button type="button" class="link w-edit" id="editWidgets">⚙ Настроить блоки</button>';
    $$('#statsBody [data-acc]').forEach((b) => { b.onclick = () => { settings.dash.account = b.dataset.acc; saveSettings(); renderStats(); }; });
    $$('#statsBody [data-fbm],#statsBody [data-fbgs]').forEach((b) => { b.onclick = () => { const W = settings.dash.fb || (settings.dash.fb = {}); if (b.dataset.fbm) W.m = b.dataset.fbm; else W.g = b.dataset.fbgs; saveSettings(); renderStats(); }; });
    $$('#statsBody [data-assign]').forEach((b) => { b.onclick = () => withBusy(b, async () => {
      if (!confirmT(`Привязать все записи без счёта к «${b.dataset.assign}»?`)) return;
      const r = await api('updateBlankAccounts', { account: b.dataset.assign }); toast(`Привязано записей: ${r.updated} ✓`); await sync(true);
    }); });
    const hz = $('#statsBody .hifz-map, #statsBody .hifz-suras');
    if (hz) hz.onclick = (e) => {
      const c = e.target.closest('[data-hp],[data-hs]'); if (!c) return;
      $$('.sel', hz).forEach((x) => x.classList.remove('sel')); c.classList.add('sel');
      const st = computeStats(ALL_FROM, today());
      $('#hzDetail').classList.remove('muted');
      $('#hzDetail').innerHTML = hifzDetailHtml(st, c.dataset.hs ? { sura: Number(c.dataset.hs) } : { page: Number(c.dataset.hp) });
    };
    $$('#statsBody [data-hzv]').forEach((b) => { b.onclick = () => { settings.dash.hifzView = b.dataset.hzv; saveSettings(); renderStats(); }; });
    $$('#statsBody [data-open-debts]').forEach((b) => { b.onclick = () => { openTab('finance'); setAction(meta.fin.DEBT); debtFilter = b.dataset.openDebts || ''; renderDebtBox(); renderFinanceRecent(); }; });
    $$('#statsBody [data-open-goals]').forEach((b) => { b.onclick = () => { $('#openSettings').click(); $('#goalsCard').open = true; setTimeout(() => $('#goalsCard').scrollIntoView({ behavior: 'smooth' }), 50); }; });
    $('#editWidgets').onclick = () => { $('#openSettings').click(); $('#widgetsCard').open = true; setTimeout(() => $('#widgetsCard').scrollIntoView({ behavior: 'smooth' }), 50); };
  }

  // ── настройки: блоки дашборда
  function renderWidgetSettings() {
    const list = widgetList();
    $('#widgetList').innerHTML = list.map((w, i) => `
      <div class="w-row">
        <input type="checkbox" class="switch sm" data-wi="${i}" ${w.on ? 'checked' : ''} aria-label="${esc(WIDGETS[w.id].title)}">
        <span class="w-title">${esc(WIDGETS[w.id].title)}${WIDGETS[w.id].periodic ? `<select data-wp="${i}" class="w-psel" aria-label="Период блока"><option value="">Период: как на дашборде</option>${Object.keys(PERIOD_TXT).map((p) => `<option value="${p}" ${w.period === p ? 'selected' : ''}>Период: ${PERIOD_TXT[p].toLowerCase()}</option>`).join('')}</select>` : ''}</span>
        <button type="button" class="icon-btn sm" data-up="${i}" ${i === 0 ? 'disabled' : ''} aria-label="Выше">↑</button>
        <button type="button" class="icon-btn sm" data-down="${i}" ${i === list.length - 1 ? 'disabled' : ''} aria-label="Ниже">↓</button>
      </div>`).join('');
    const accs = (meta && meta.accounts) || [], cfg = settings.dash.cards || {};
    $('#cardTiles').innerHTML = accs.length ? accs.map((a) => { const c = cfg[a.name] || {};
      return `<div class="w-row ct-row">
        <input type="checkbox" class="switch sm" data-ct="${esc(a.name)}" ${c.on !== false ? 'checked' : ''} aria-label="Показывать ${esc(a.name)}">
        <span class="w-title"><span class="ic">${a.icon || '💳'}</span>${esc(a.name)}${a.archived ? ' <span class="muted small">(архив)</span>' : ''}</span>
        <select data-ctm="${esc(a.name)}" aria-label="Что показывать"><option value="flow" ${c.mode !== 'balance' ? 'selected' : ''}>Приход и расход</option><option value="balance" ${c.mode === 'balance' ? 'selected' : ''}>Только баланс</option></select>
      </div>`; }).join('') : '<p class="muted small">Счетов пока нет — добавьте их в разделе «Финансы».</p>';
  }
  $('#cardTiles').addEventListener('change', (e) => {
    const t = e.target, n = t.dataset.ct != null ? t.dataset.ct : t.dataset.ctm; if (n == null) return;
    const cards = settings.dash.cards || (settings.dash.cards = {}), c = cards[n] || (cards[n] = {});
    if (t.dataset.ct != null) c.on = t.checked; else c.mode = t.value;
    saveSettings(); renderStats();
  });
  $('#widgetList').addEventListener('change', (e) => {
    const i = e.target.dataset.wi, wp = e.target.dataset.wp;
    if (wp != null) { const list = widgetList(); list[Number(wp)].period = e.target.value; saveWidgets(list); renderStats(); return; }
    if (i == null) return;
    const list = widgetList(); list[Number(i)].on = e.target.checked; saveWidgets(list); renderStats();
  });
  $('#widgetList').addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return;
    const list = widgetList(), i = Number(b.dataset.up != null ? b.dataset.up : b.dataset.down), j = b.dataset.up != null ? i - 1 : i + 1;
    if (j < 0 || j >= list.length) return;
    [list[i], list[j]] = [list[j], list[i]]; saveWidgets(list); renderWidgetSettings(); renderStats();
  });
  $('#widgetsReset').addEventListener('click', () => { saveWidgets([]); renderWidgetSettings(); renderStats(); toast('Блоки дашборда сброшены'); });

  // ═════════════ Настройки: простые параметры модулей ═════════════
  const getPath = (path) => path.split('.').reduce((o, k) => (o ? o[k] : undefined), settings);
  function setPath(path, v) { const ks = path.split('.'), last = ks.pop(); ks.reduce((o, k) => o[k], settings)[last] = v; }
  function fillSettings() {
    $$('#settings [data-options]').forEach((sel) => {
      const list = meta ? meta[sel.dataset.options] || [] : [];
      sel.innerHTML = list.map((x, i) => `<option value="${sel.hasAttribute('data-idx') ? i : esc(x)}">${esc(x)}</option>`).join('');
    });
    $$('#settings [data-set]').forEach((el) => {
      const v = getPath(el.dataset.set);
      if (el.type === 'checkbox') el.checked = !!v; else el.value = v == null ? '' : String(v);
    });
    $('#appVersion').textContent = `myTracker · Версия сайта ${SITE_VER}` + (srv && srv.ver ? ` · Данные от ${new Date(Number(srv.ver) || 0).toLocaleString(LOC, { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}` : '');
  }
  $('#settings').addEventListener('change', (e) => {
    const el = e.target, path = el.dataset && el.dataset.set; if (!path) return;
    let v = el.type === 'checkbox' ? el.checked : el.value;
    if (el.hasAttribute('data-num')) v = Number(v);
    if (path === 'finance.currency') v = String(v).trim() || 'с';
    if (path === 'quran.fresh' || path === 'quran.stale') {
      v = Math.min(60, Math.max(1, Math.round(v) || (path === 'quran.fresh' ? 7 : 30))); el.value = v;
      if (path === 'quran.fresh' && v >= settings.quran.stale) { settings.quran.stale = Math.min(60, v + 1); $('[data-set="quran.stale"]').value = settings.quran.stale; }
      if (path === 'quran.stale' && v <= settings.quran.fresh) { settings.quran.fresh = Math.max(1, v - 1); $('[data-set="quran.fresh"]').value = settings.quran.fresh; }
    }
    if (path === 'finance.numpad') setTimeout(npApply, 0);
    if (path === 'mushaf.secs') { v = Math.min(900, Math.max(45, Math.round(v) || 50)); el.value = v; }
    if (path === 'mushaf.autoKind') v = Number(v) || 0;
    setPath(path, v); saveSettings();
    if (path.indexOf('mushaf.') === 0 && typeof mTick === 'function') mTick(true);
    if (path === 'theme') applyTheme();
    if (path === 'dateFmt') { repaintDates(); renderStats(); }
    if (path === 'quran.type' && !rEditId) setType(v);
    if (path === 'quran.kind' && meta && meta.kinds.indexOf(v) >= 0 && !rEditId) setKind(v);
    if (path === 'dash.period' && v !== 'last') { period = v; $$('#sPeriod button').forEach((x) => x.classList.toggle('on', x.dataset.p === period)); }
    applyPrayerSettings(); renderFinance(); changed(); renderAll(); renderUndoBtn();
    $('#rRecentTitle').textContent = `Последние ${DAYS.reading} дней`; $('#fRecentTitle').textContent = `Последние ${DAYS.finance} дней`;
    toast('Сохранено ✓');
  });

  // ═════════════ Настройки: счета и карты (CRUD) ═════════════
  let accDraft = null, accDefDraft = {};
  function accStartEdit() {
    if (!meta) { $('#accEditor').innerHTML = '<p class="muted small">Загрузите данные, чтобы редактировать.</p>'; return; }
    accDraft = (meta.accounts || []).map((a) => Object.assign({ orig: a.name }, a));
    accDefDraft = Object.assign({}, meta.actionDefaults || {});
    renderAccEditor();
  }
  function renderAccEditor() {
    $('#accEditor').innerHTML = accDraft.map((a, i) => `
      <div class="acc-edit ${a.archived ? 'archived' : ''}">
        <button type="button" class="acc-def ${a.isDefault ? 'on' : ''}" data-def="${i}" title="Счёт по умолчанию" aria-label="По умолчанию">●</button>
        <input type="text" class="ic-in" value="${esc(a.icon)}" data-ai="${i}" data-f="icon" maxlength="4" aria-label="Иконка" placeholder="💳">
        <input type="text" value="${esc(a.name)}" data-ai="${i}" data-f="name" placeholder="Название, напр. Visa ••1234" aria-label="Название">
        <input type="text" inputmode="decimal" class="start-in" value="${a.start || ''}" data-ai="${i}" data-f="start" placeholder="Нач. остаток" aria-label="Начальный остаток">
        <button type="button" class="icon-btn sm" data-arch="${i}" title="${a.archived ? 'Вернуть из архива' : 'В архив'}">${a.archived ? '↩' : '📦'}</button>
        <button type="button" class="icon-btn sm" data-del="${i}" title="Удалить">✕</button>
      </div>`).join('') || '<p class="muted small">Пока нет счетов — добавьте карту или «Наличные».</p>';
    accDraft.forEach((a) => { const n = a.name.trim(); if (a._prev && a._prev !== n) Object.keys(accDefDraft).forEach((k) => { if (accDefDraft[k] === a._prev) accDefDraft[k] = n; }); a._prev = n; });
    const names = accDraft.filter((a) => !a.archived && a.name.trim()).map((a) => a.name.trim());
    buildFinRef();
    $('#accDefaults').innerHTML = FINREF.actions.map((act) => `<div class="set-row"><span>${esc(act)}</span>
      <select data-actdef="${esc(act)}"><option value="">— общий —</option>${names.map((n) => `<option ${accDefDraft[act] === n ? 'selected' : ''}>${esc(n)}</option>`).join('')}</select></div>`).join('');
  }
  $('#accEditor').addEventListener('input', (e) => {
    const t = e.target, i = Number(t.dataset.ai), f = t.dataset.f; if (!f || !accDraft[i]) return;
    accDraft[i][f] = f === 'start' ? t.value.replace(',', '.') : t.value;
    if (f === 'name') { clearTimeout(accEditor._t); accEditor._t = setTimeout(renderAccDefaultsOnly, 400); }
  });
  const accEditor = $('#accEditor');
  function renderAccDefaultsOnly() { const keep = document.activeElement; const sel = keep && keep.selectionStart; renderAccEditor(); if (keep && keep.dataset.ai != null) { const el = $(`#accEditor input[data-ai="${keep.dataset.ai}"][data-f="${keep.dataset.f}"]`); if (el) { el.focus(); try { el.setSelectionRange(sel, sel); } catch (e) {} } } }
  $('#accEditor').addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.dataset.def != null) { accDraft.forEach((a, i) => { a.isDefault = i === Number(b.dataset.def); }); accDraft[Number(b.dataset.def)].archived = false; }
    if (b.dataset.arch != null) { const a = accDraft[Number(b.dataset.arch)]; a.archived = !a.archived; if (a.archived) a.isDefault = false; }
    if (b.dataset.del != null) {
      const a = accDraft[Number(b.dataset.del)], used = view().finance.filter((r) => r[8] === a.orig || r[9] === a.orig).length;
      if (used && !confirmT(`У счёта «${a.name}» ${used} записей. Удалить его из списка? Записи останутся в таблице. Лучше убрать в архив 📦.`)) return;
      accDraft.splice(Number(b.dataset.del), 1);
    }
    renderAccEditor();
  });
  $('#accDefaults').addEventListener('change', (e) => { const s = e.target.dataset.actdef; if (s != null) accDefDraft[s] = e.target.value; });
  $('#accAdd').addEventListener('click', () => {
    if (!accDraft) return;
    accDraft.push({ name: '', icon: '💳', start: 0, isDefault: !accDraft.some((a) => a.isDefault && !a.archived), archived: false, orig: null });
    renderAccEditor(); $$('#accEditor input[data-f="name"]').pop().focus();
  });
  $('#accReset').addEventListener('click', () => { accStartEdit(); toast('Изменения отменены'); });
  $('#accSave').addEventListener('click', (e) => withBusy(e.currentTarget, async () => {
    const list = accDraft.filter((a) => a.name.trim()).map((a) => ({ name: a.name.trim(), icon: a.icon.trim(), start: Number(String(a.start).replace(',', '.')) || 0, isDefault: !!a.isDefault, archived: !!a.archived, orig: a.orig }));
    const names = list.map((a) => a.name);
    if (new Set(names).size !== names.length) throw new Error('Названия счетов не должны повторяться');
    const ren = {}; list.forEach((a) => { if (a.orig && a.orig !== a.name) ren[a.orig] = a.name; });
    const defs = {}; Object.keys(accDefDraft).forEach((k) => { const v = ren[accDefDraft[k]] || accDefDraft[k]; if (v && names.indexOf(v) >= 0) defs[k] = v; });
    const r = await api('saveAccounts', { accounts: list, actionDefaults: defs });
    meta.accounts = r.accounts; meta.actionDefaults = r.actionDefaults; store.set('lt_meta', meta);
    const cards = settings.dash.cards || {}; Object.keys(ren).forEach((o) => { if (cards[o]) { cards[ren[o]] = cards[o]; delete cards[o]; } });
    Object.keys(cards).forEach((k) => { if (!r.accounts.some((a) => a.name === k)) delete cards[k]; }); saveSettings();
    const fa = settings.dash.account; if (fa) { settings.dash.account = ren[fa] || fa; if (!r.accounts.some((a) => a.name === settings.dash.account)) settings.dash.account = ''; saveSettings(); }
    accStartEdit(); fAccTouched = false; renderFinance(); changed(); renderAll(); renderWidgetSettings();
    toast(r.renamed ? `Счета сохранены ✓ · Переименовано записей: ${r.renamed}` : 'Счета сохранены ✓');
    if (r.renamed) sync(true);
  }));

  // ═════════════ Настройки: названия молитв и статусы (общие для всех устройств) ═════════════
  const needOnline = (what) => { if (!online && navigator.onLine === false) throw new Error(`Нужен интернет, чтобы сохранить ${what}`); };
  async function saveConfig(key, value) {
    const r = await api('saveConfig', { key, value });
    meta.config = r.config; if (r.tg) meta.tg = r.tg;
    // настройки, которые ещё ждут отправки (например, план), не должны откатываться
    outbox.filter((o) => o.op === 'saveConfig').forEach((o) => { meta.config = Object.assign({}, meta.config, { [o.p.key]: o.p.value }); });
    store.set('lt_meta', meta);
    if (r.notifyError) toast('Напоминания не поставлены: ' + r.notifyError, true);
    return r;
  }
  let pnDraft = null;
  function pnStartEdit() {
    if (!meta) return;
    const c = pcfg();
    pnDraft = { preset: c.preset || 'ar', names: Object.assign({}, c.names || {}), show: Object.assign({ duha: true, witr: true }, c.show || {}) };
    $('#pnPreset').value = pnDraft.preset; $('#pnDuha').checked = pnDraft.show.duha !== false; $('#pnWitr').checked = pnDraft.show.witr !== false;
    renderPnNames();
  }
  function renderPnNames() {
    const base = P_PRESETS[pnDraft.preset] || P_PRESETS.ar;
    $('#pnNames').innerHTML = PKEYS.map((k) => {
      const v = pnDraft.preset === 'custom' ? (pnDraft.names[k] || P_PRESETS.ru[k]) : base[k];
      return `<label class="pn-row"><span class="muted small">${esc(P_PRESETS.ru[k])}</span><input type="text" data-pn="${k}" value="${esc(v)}" maxlength="24" ${isAr(v) ? 'dir="rtl" lang="ar"' : ''} ${pnDraft.preset === 'custom' ? '' : 'readonly'}></label>`;
    }).join('') + (pnDraft.preset === 'custom' ? '' : '<p class="muted small" style="grid-column:1/-1;margin:0">Чтобы задать свои названия, выберите «Свои названия».</p>');
  }
  $('#pnPreset').addEventListener('change', (e) => {
    const prev = P_PRESETS[pnDraft.preset];
    if (e.target.value === 'custom' && prev && !Object.keys(pnDraft.names).length) PKEYS.forEach((k) => { pnDraft.names[k] = isAr(prev[k]) ? P_PRESETS.ru[k] : prev[k]; });
    pnDraft.preset = e.target.value; renderPnNames();
  });
  $('#pnNames').addEventListener('input', (e) => { const k = e.target.dataset.pn; if (k) pnDraft.names[k] = e.target.value; });
  $('#pnDuha').addEventListener('change', (e) => { pnDraft.show.duha = e.target.checked; });
  $('#pnWitr').addEventListener('change', (e) => { pnDraft.show.witr = e.target.checked; });
  $('#pnSave').addEventListener('click', (e) => withBusy(e.currentTarget, async () => {
    needOnline('названия');
    const names = {}; if (pnDraft.preset === 'custom') PKEYS.forEach((k) => { const v = (pnDraft.names[k] || '').trim(); if (v) names[k] = v; });
    await saveConfig('prayers', { preset: pnDraft.preset, names, show: pnDraft.show });
    changed(); renderPrayerRows(); if (!showP(activePrayer)) activePrayer = firstEmpty(); paintPrayers(); renderAll(); renderNowTile();
    toast('Названия сохранены ✓');
  }));

  let stDraft = null;
  function stStartEdit() {
    if (!meta) return;
    const hid = (cfg().statuses || {}).hidden || [];
    const cols = (cfg().statuses || {}).colors || [];
    stDraft = meta.statuses.map((name, i) => ({ name, orig: name, hidden: hid.indexOf(i) >= 0, color: cols[i] || '' }));
    renderStEditor();
  }
  function renderStEditor() {
    $('#stEditor').innerHTML = stDraft.map((s, i) => `<div class="st-edit">
        <input type="color" class="st-color" data-stc="${i}" value="${s.color || ST_DEFAULT[i] || '#6f6f6f'}" aria-label="Цвет статуса">
        <input type="text" value="${esc(s.name)}" data-st="${i}" maxlength="30" aria-label="Название статуса">
        <label class="switch-row st-show"><span class="muted small">${s.hidden ? 'Скрыт' : 'Виден'}</span><input type="checkbox" class="switch sm" data-sth="${i}" ${s.hidden ? '' : 'checked'}></label>
      </div>`).join('');
  }
  $('#stEditor').addEventListener('input', (e) => { const i = e.target.dataset.st; if (i != null) stDraft[Number(i)].name = e.target.value; });
  $('#stEditor').addEventListener('change', (e) => { const i = e.target.dataset.sth; if (i != null) { stDraft[Number(i)].hidden = !e.target.checked; renderStEditor(); } });
  $('#stEditor').addEventListener('input', (e) => { const i = e.target.dataset.stc; if (i != null) { stDraft[Number(i)].color = e.target.value; applyStatusColors(stDraft.map((x) => x.color)); } });
  $('#stColorsReset').addEventListener('click', () => { stDraft.forEach((x) => { x.color = ''; }); renderStEditor(); applyStatusColors([]); toast('Стандартные цвета — нажмите «Сохранить статусы»'); });
  $('#stSave').addEventListener('click', (e) => withBusy(e.currentTarget, async () => {
    needOnline('статусы');
    const names = stDraft.map((s) => s.name.trim());
    if (names.some((n) => !n)) throw new Error('Название статуса не может быть пустым');
    if (new Set(names).size !== names.length) throw new Error('Названия статусов не должны повторяться');
    const hidden = stDraft.map((s, i) => (s.hidden ? i : -1)).filter((i) => i >= 0);
    if (hidden.length >= names.length - 1) throw new Error('Оставьте видимыми хотя бы два статуса');
    const colors = stDraft.map((s) => (/^#[0-9a-f]{6}$/i.test(s.color) && s.color.toLowerCase() !== ST_DEFAULT[stDraft.indexOf(s)] ? s.color : ''));
    const r = await api('saveStatuses', { statuses: stDraft.map((s, i) => ({ name: names[i], orig: s.orig })), hidden, colors });
    const ren = {}; meta.statuses.forEach((o, i) => { if (o !== r.statuses[i]) ren[o] = r.statuses[i]; });
    meta.statuses = r.statuses; meta.config = r.config; store.set('lt_meta', meta);
    // неотправленные отметки тоже переименовываем
    outbox.concat(sent).forEach((o) => { if (o.op === 'savePrayer') PKEYS.forEach((k) => { if (ren[o.p[k]]) o.p[k] = ren[o.p[k]]; }); });
    persist(); changed(); applyStatusColors(); stStartEdit(); fillSettings(); renderPrayerRows(); showPrayerDayState(); paintPrayers(); applyPrayerSettings(); renderAll();
    toast(r.renamed ? `Статусы сохранены ✓ · Переименовано отметок: ${r.renamed}` : 'Статусы сохранены ✓');
    if (r.renamed) sync(true);
  }));

  // ═════════════ Бюджеты: месячные лимиты по категориям ═════════════
  const budgets = () => ((cfg().budgets || {}).items || []).filter((b) => b.limit > 0);
  const budgetFor = (a, c) => budgets().find((b) => (b.action || meta.fin.EXPENSE) === a && b.category === c);
  const thisMonth = () => today().slice(0, 7);
  function monthSpent(a, c, month) {
    const m = month || thisMonth();
    return view().finance.reduce((t, r) => (r[3] === a && r[4] === c && String(r[1]).slice(0, 7) === m ? t + (Number(r[2]) || 0) : t), 0);
  }
  const budgetLevel = (spent, limit) => (spent > limit ? 'over' : spent >= limit * 0.8 ? 'warn' : 'ok');
  function updateBudgetHint() {
    const el = $('#fBudget'), b = meta && fCategory && budgetFor(fAction, fCategory);
    if (!b) { el.classList.add('hidden'); return; }
    const spent = monthSpent(fAction, fCategory), left = b.limit - spent, lvl = budgetLevel(spent, b.limit);
    el.className = 'budget-hint ' + lvl;
    el.innerHTML = `<div class="bh-bar"><i style="width:${Math.min(100, spent / b.limit * 100).toFixed(1)}%"></i></div>
      <span>Лимит на месяц: ${money(spent)} из ${money(b.limit)} · ${left >= 0 ? 'Осталось ' + money(left) : '<b>Превышен на ' + money(-left) + '</b>'}</span>`;
  }
  /** Предупреждение после новой записи: перешли 80% или 100% лимита. */
  function budgetWarn(it) {
    const b = budgetFor(it.actionType, it.category); if (!b || String(it.date).slice(0, 7) !== thisMonth()) return;
    const after = monthSpent(it.actionType, it.category), before = after - Number(it.amount);
    if (after > b.limit && before <= b.limit) toast(`⚠ Лимит «${it.category}» превышен: ${money(after)} из ${money(b.limit)}`, true);
    else if (after >= b.limit * 0.8 && before < b.limit * 0.8) toast(`Лимит «${it.category}»: потрачено ${Math.round(after / b.limit * 100)}% (${money(after)} из ${money(b.limit)})`);
  }
  let bgDraft = {};
  function bgStartEdit() {
    if (!meta) return;
    buildFinRef(); bgDraft = {};
    budgets().forEach((b) => { bgDraft[(b.action || meta.fin.EXPENSE) + '|' + b.category] = b.limit; });
    const groups = FINREF.actions.map((a) => [a, FINREF.cats[a].filter((c) => flowSign(a, c) < 0)]).filter(([, cs]) => cs.length);
    $('#bgEditor').innerHTML = groups.map(([a, cs]) => `<div class="bg-group"><div class="muted small bg-act">${esc(a)}</div>${cs.map((c) => `
      <label class="bg-row"><span class="ic">${icon(a, c)}</span><span class="bg-cat">${esc(c)}</span>
        <input type="text" inputmode="decimal" class="short-in" data-bg="${esc(a + '|' + c)}" value="${bgDraft[a + '|' + c] || ''}" placeholder="—" aria-label="Лимит ${esc(c)}"></label>`).join('')}</div>`).join('')
      || '<p class="muted small">Нет категорий расходов.</p>';
  }
  $('#bgEditor').addEventListener('input', (e) => { const k = e.target.dataset.bg; if (k != null) bgDraft[k] = e.target.value; });
  $('#bgReset').addEventListener('click', () => { bgStartEdit(); toast('Изменения отменены'); });
  $('#bgSave').addEventListener('click', (e) => withBusy(e.currentTarget, async () => {
    needOnline('лимиты');
    const items = Object.keys(bgDraft).map((k) => { const [action, category] = k.split('|'); return { action, category, limit: calc(bgDraft[k]) }; })
      .filter((b) => b.limit > 0);
    await saveConfig('budgets', { items });
    bgStartEdit(); updateBudgetHint(); changed(); renderAll(); toast('Лимиты сохранены ✓');
  }));
  openSettingsHooks.push(bgStartEdit);

  // ═════════════ Регулярные платежи ═════════════
  const rIcon = (r) => (r.category ? icon(r.action, r.category) : '🗓');
  const REPEAT_TXT = { day: ['Каждый день', 'дн.'], week: ['Каждую неделю', 'нед.'], month: ['Каждый месяц', 'мес.'], year: ['Каждый год', 'г.'] };
  const repeatText = (r) => (r.every > 1 ? `Каждые ${r.every} ${REPEAT_TXT[r.repeat][1]}` : REPEAT_TXT[r.repeat || 'month'][0]);
  function advanceDate(d, repeat, every, day) {
    const [y, m, dd] = d.split('-').map(Number); every = Math.max(1, every || 1);
    if (repeat === 'day') return addDays(d, every);
    if (repeat === 'week') return addDays(d, 7 * every);
    const mm = m - 1 + (repeat === 'year' ? 12 * every : every), ny = y + Math.floor(mm / 12), nm = ((mm % 12) + 12) % 12;
    return iso(new Date(ny, nm, Math.min(day || dd, new Date(ny, nm + 1, 0).getDate())));
  }
  const daysBetween = (a, b) => Math.round((new Date(b + 'T12:00') - new Date(a + 'T12:00')) / 864e5);
  /** Регулярные платежи с учётом оплат и пропусков, которые ещё не дошли до таблицы. */
  function recurList() {
    const ops = sent.concat(outbox);
    return ((meta && meta.recurring) || []).map((r) => {
      let next = r.next, guard = 0, moved = true;
      while (moved && next && guard++ < 50) {
        moved = ops.some((o) => (o.op === 'addFinance' && Number(o.p.recurId) === r.id && o.p.recurDue === next) || (o.op === 'skipRecurring' && Number(o.p.id) === r.id && o.p.due === next));
        if (moved) next = advanceDate(next, r.repeat, r.every, r.day);
      }
      return Object.assign({}, r, { next });
    });
  }
  function dueList() {
    const t = today();
    return recurList().filter((r) => r.active && r.next).map((r) => Object.assign(r, { d: daysBetween(t, r.next) }))
      .filter((r) => r.d <= Math.max(r.remind, 0) || r.d < 0).sort((a, b) => a.d - b.d);
  }
  const dueText = (d) => (d < 0 ? `Просрочено на ${-d} дн.` : d === 0 ? 'Сегодня' : d === 1 ? 'Завтра' : `Через ${d} дн.`);
  function renderRecurBox() {
    const box = $('#recurBox'); if (!meta) return;
    const list = dueList();
    box.classList.toggle('hidden', !list.length);
    $$('.tabs [data-tab="finance"]').forEach((b) => b.classList.toggle('dot', list.some((r) => r.d <= 0 && !(r.auto && r.d === 0))));
    if (!list.length) { box.innerHTML = ''; return; }
    box.innerHTML = `<div class="w-head"><div class="lbl">Платежи</div><span class="muted small">${list.length}</span></div>` + list.map((r) => {
      const auto = r.auto && r.d >= 0;
      return `<div class="rc-due ${r.d < 0 ? 'over' : r.d === 0 ? 'today' : ''}">
        <button type="button" class="rc-main" data-rcfill="${r.id}"><span class="ic">${rIcon(r)}</span>
          <span class="rc-txt"><b>${esc(r.name)}</b><span class="muted small">${dueText(r.d)} · ${ru(r.next)}${auto ? ' · Добавится автоматически' : ''}</span></span>
          <b class="rc-amt">${money(r.amount)}</b></button>
        ${auto ? '' : `<div class="rc-act"><button type="button" class="btn small-btn primary" data-rcpay="${r.id}">Оплатить</button><button type="button" class="btn small-btn ghost" data-rcskip="${r.id}">Пропустить</button></div>`}
      </div>`;
    }).join('');
  }
  let fRecur = null; // оплата регулярного платежа через форму (можно поправить сумму)
  $('#recurBox').addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return;
    const id = Number(b.dataset.rcpay || b.dataset.rcskip || b.dataset.rcfill), r = recurList().find((x) => x.id === id); if (!r) return;
    if (b.dataset.rcpay) {
      const it = { amount: r.amount, actionType: r.action, category: r.category || (isTransfer(r.action) ? meta.fin.BETWEEN : ''), date: today(), comment: r.name + (r.comment ? ': ' + r.comment : ''),
        account: r.account || defaultAccount(r.action), toAccount: '', recurId: r.id, recurDue: r.next };
      const op = enqueue('addFinance', it); budgetWarn(it);
      toast(`«${r.name}» оплачено ✓`, false, pushUndo({ tab: 'finance', type: 'add', ops: [op.id], del: 'deleteFinance', label: `Оплата «${r.name}»` })); offlineNote(); if (settings.autoSend) flush({ all: true });
    } else if (b.dataset.rcskip) {
      if (!confirmT(`Пропустить платёж «${r.name}» за ${ru(r.next)}? Следующий — ${ru(advanceDate(r.next, r.repeat, r.every, r.day))}.`)) return;
      const op = enqueue('skipRecurring', { id: r.id, due: r.next });
      toast('Платёж пропущен', false, pushUndo({ tab: 'finance', type: 'skip', op: op.id, recur: { id: r.id, due: r.next }, label: `Пропуск «${r.name}»` })); if (settings.autoSend) flush({ all: true });
    } else {
      fEdit = null; fRecur = { id: r.id, due: r.next };
      fillFinanceForm({ amount: r.amount, actionType: r.action, category: r.category, date: today(), comment: r.name + (r.comment ? ': ' + r.comment : ''), account: r.account || defaultAccount(r.action), toAccount: '' }, `Оплата: ${r.name} за ${ru(r.next)}`);
      $('#fSave').textContent = 'Оплатить';
    }
    renderAll();
  });

  // ── редактор регулярных платежей (Настройки → Финансы)
  let rcDraft = null, rcEditing = null;
  function rcStartEdit() { if (!meta) return; rcDraft = recurList().map((r) => Object.assign({}, r)); rcEditing = null; renderRcList(); $('#rcForm').classList.add('hidden'); $('#rcAdd').classList.remove('hidden'); }
  function renderRcList() {
    $('#rcList').innerHTML = rcDraft.length ? rcDraft.map((r, i) => `<button type="button" class="rc-item ${r.active ? '' : 'off'}" data-rci="${i}">
        <span class="ic">${rIcon(r)}</span><span class="rc-txt"><b>${esc(r.name)}</b><span class="muted small">${repeatText(r)} · Следующий ${ru(r.next)}${r.auto ? ' · Авто' : ''}${r.active ? '' : ' · Выключен'}</span></span><b>${money(r.amount)}</b></button>`).join('')
      : '<p class="muted small">Регулярных платежей пока нет.</p>';
  }
  function rcFormHtml(r) {
    buildFinRef();
    const opt = (list, v) => list.map((x) => `<option value="${esc(x)}" ${x === v ? 'selected' : ''}>${esc(x)}</option>`).join('');
    const accs = ACCS().map((a) => a.name);
    return `<label class="lbl">Название</label><input type="text" data-rc="name" value="${esc(r.name)}" placeholder="Например, Аренда" maxlength="80">
      <div class="row gap"><div class="grow"><label class="lbl">Сумма</label><input type="text" inputmode="decimal" data-rc="amount" value="${r.amount || ''}" placeholder="0"></div>
        <div class="grow"><label class="lbl">Следующая дата</label><input type="date" data-rc="next" value="${esc(r.next || today())}"></div></div>
      <div class="row gap"><div class="grow"><label class="lbl">Действие</label><select data-rc="action">${opt(FINREF.actions.filter((a) => !isTransfer(a)), r.action)}</select></div>
        <div class="grow"><label class="lbl">Категория</label><select data-rc="category"><option value="">—</option>${opt(FINREF.cats[r.action] || [], r.category)}</select></div></div>
      ${accs.length ? `<label class="lbl">Счёт / карта</label><select data-rc="account"><option value="">По умолчанию</option>${opt(accs, r.account)}</select>` : ''}
      <div class="row gap"><div class="grow"><label class="lbl">Повтор</label><select data-rc="repeat">${['day', 'week', 'month', 'year'].map((k) => `<option value="${k}" ${k === r.repeat ? 'selected' : ''}>${REPEAT_TXT[k][0]}</option>`).join('')}</select></div>
        <div class="grow"><label class="lbl">Интервал</label><input type="number" inputmode="numeric" min="1" max="99" data-rc="every" value="${r.every || 1}"></div></div>
      <div class="row gap"><div class="grow"><label class="lbl">Напомнить за (дней)</label><input type="number" inputmode="numeric" min="0" max="60" data-rc="remind" value="${r.remind == null ? 1 : r.remind}"></div><div class="grow"></div></div>
      <label class="switch-row"><span><b>Добавлять автоматически</b><br><span class="muted small">Запись появится сама в день платежа</span></span><input type="checkbox" class="switch sm" data-rc="auto" ${r.auto ? 'checked' : ''}></label>
      <label class="switch-row"><span>Активен</span><input type="checkbox" class="switch sm" data-rc="active" ${r.active !== false ? 'checked' : ''}></label>
      <label class="lbl">Комментарий</label><input type="text" data-rc="comment" value="${esc(r.comment || '')}" placeholder="Необязательно" maxlength="300">
      <div class="row gap" style="margin-top:12px">
        ${rcEditing >= 0 && rcDraft[rcEditing] ? '<button type="button" class="btn ghost" data-rcdel>Удалить</button>' : ''}
        <button type="button" class="btn ghost grow" data-rccancel>Отмена</button>
        <button type="button" class="btn primary grow" data-rcsave>Сохранить</button></div>`;
  }
  let rcForm = null;
  function openRcForm(i) {
    rcEditing = i;
    rcForm = Object.assign({ name: '', amount: '', action: meta.fin.EXPENSE, category: '', account: '', repeat: 'month', every: 1, next: today(), auto: false, remind: 1, active: true, comment: '' }, i >= 0 ? rcDraft[i] : {});
    $('#rcForm').innerHTML = rcFormHtml(rcForm); enhanceDates($('#rcForm')); $('#rcForm').classList.remove('hidden'); $('#rcAdd').classList.add('hidden');
    $('#rcForm').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }
  $('#rcList').addEventListener('click', (e) => { const b = e.target.closest('[data-rci]'); if (b) openRcForm(Number(b.dataset.rci)); });
  $('#rcAdd').addEventListener('click', () => { if (meta) openRcForm(-1); });
  $('#rcForm').addEventListener('change', (e) => {
    const f = e.target.dataset.rc; if (!f) return;
    rcForm[f] = e.target.type === 'checkbox' ? e.target.checked : e.target.value;
    if (f === 'action') { rcForm.category = ''; $('#rcForm').innerHTML = rcFormHtml(rcForm); enhanceDates($('#rcForm')); }
  });
  $('#rcForm').addEventListener('input', (e) => { const f = e.target.dataset.rc; if (f && e.target.type !== 'checkbox') rcForm[f] = e.target.value; });
  async function rcPersist(list, msg) {
    needOnline('платежи');
    const r = await api('saveRecurring', { items: list.map((x) => ({ id: x.id, name: x.name, amount: x.amount, action: x.action, category: x.category, account: x.account,
      repeat: x.repeat, every: x.every, next: x.next, auto: x.auto, remind: x.remind, active: x.active, comment: x.comment, day: x.day })) });
    meta.recurring = r.recurring; store.set('lt_meta', meta);
    // оплаты/пропуски, уже учтённые сервером, больше не сдвигают дату на телефоне
    sent = sent.filter((o) => !(o.op === 'skipRecurring')); persist();
    rcStartEdit(); changed(); renderAll(); toast(msg);
  }
  $('#rcForm').addEventListener('click', (e) => withBusy(e.target.closest('button') || e.currentTarget, async () => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.dataset.rccancel != null) { rcStartEdit(); return; }
    if (b.dataset.rcdel != null) {
      if (!confirmT(`Удалить платёж «${rcDraft[rcEditing].name}»? Записи в «Финансах» останутся.`)) return;
      const list = rcDraft.filter((_, i) => i !== rcEditing); await rcPersist(list, 'Платёж удалён'); return;
    }
    if (b.dataset.rcsave == null) return;
    const it = Object.assign({}, rcForm, { name: String(rcForm.name).trim(), amount: calc(rcForm.amount), every: Math.max(1, Number(rcForm.every) || 1), remind: Math.max(0, Number(rcForm.remind) || 0) });
    if (!it.name) throw new Error('Укажите название платежа');
    if (!(it.amount > 0)) throw new Error('Укажите сумму');
    if (!it.next) throw new Error('Укажите дату');
    const prev = rcEditing >= 0 ? rcDraft[rcEditing] : null;
    it.day = prev && prev.next === it.next ? prev.day : Number(it.next.slice(8));
    const list = rcDraft.slice(); if (rcEditing >= 0) list[rcEditing] = it; else list.push(it);
    await rcPersist(list, 'Платёж сохранён ✓');
  }));
  openSettingsHooks.push(rcStartEdit);

  // ═════════════ Цели ═════════════
  const GOAL_TYPES = {
    read: { t: 'Чтение Корана', unit: 'стр.', kind: 0 },
    memorize: { t: 'Заучивание (хифз)', unit: 'стр.', kind: 1 },
    repeat: { t: 'Повторение', unit: 'стр.', kind: 2 },
    quran: { t: 'Коран: все страницы', unit: 'стр.' },
    hifz: { t: 'Хифз: всего выучено', unit: 'стр.', totalOnly: true },
    savings: { t: 'Накопления', unit: 'money' },
    prayers: { t: 'Фарз вовремя', unit: '%' }
  };
  const GOAL_PERIODS = { day: 'В день', week: 'В неделю', month: 'В месяц', year: 'В год', total: 'Всего' };
  const goals = () => (cfg().goals || {}).items || [];
  function goalRange(p) {
    const t = today(), n = new Date();
    if (p === 'day') return [t, t];
    if (p === 'week') return periodRange('week');
    if (p === 'month') return periodRange('month');
    if (p === 'year') return periodRange('year');
    return [ALL_FROM, t];
  }
  function goalValue(g, from, to) {
    const T = GOAL_TYPES[g.type] || {};
    if (g.type === 'hifz') return computeStats(ALL_FROM, today()).hifzPages;
    if (g.type === 'savings') {
      const fin = meta.fin; let v = 0;
      view().finance.forEach((r) => { if (r[1] < from || r[1] > to) return; if (r[4] === fin.SAVED) v += Number(r[2]) || 0; if (r[4] === fin.WITHDRAWN) v -= Number(r[2]) || 0; });
      return v;
    }
    if (g.type === 'prayers') {
      let ok = 0, all = 0;
      view().prayers.forEach((r) => { if (r[0] < from || r[0] > to) return; FARD.forEach((k) => { const s = r[PKEYS.indexOf(k) + 1]; if (s && s !== noData()) { all++; if (isOnTime(s)) ok++; } }); });
      return all ? Math.round(ok / all * 100) : 0;
    }
    const kind = T.kind != null ? meta.kinds[T.kind] : null;
    return view().reading.reduce((t, r) => (r[1] >= from && r[1] <= to && (!kind || r[2] === kind)
      ? t + (Number(g.type === 'memorize' ? r[6] : r[8]) || 0) : t), 0);
  }
  const goalFmt = (g, v) => { const u = (GOAL_TYPES[g.type] || {}).unit; return u === 'money' ? money(v) : u === '%' ? Math.round(v) + '%' : `${money(v)} ${u}`; };
  function goalHtml(g) {
    const T = GOAL_TYPES[g.type]; if (!T) return '';
    const per = T.totalOnly ? 'total' : g.period || 'day', [from, to] = goalRange(per), v = goalValue(g, from, to), tgt = Number(g.target) || 1;
    const pct = Math.max(0, Math.min(1, v / tgt)), done = v >= tgt;
    let extra = '';
    if (per === 'day') {
      const days = Array.from({ length: 7 }, (_, i) => addDays(today(), i - 6));
      extra = `<div class="g-days">${days.map((d) => { const dv = goalValue(g, d, d); return `<i class="${dv >= tgt ? 'ok' : dv > 0 ? 'part' : ''}" title="${ru(d)}: ${goalFmt(g, dv)}"></i>`; }).join('')}<span class="muted small">7 дней</span></div>`;
    } else if (!done && per !== 'total' && g.type !== 'prayers') {
      const left = Math.max(1, daysBetween(today(), to === today() ? goalRange(per)[1] : to) + 1), endP = per === 'week' ? addDays(goalRange('week')[0], 6) : per === 'month' ? iso(new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0)) : iso(new Date(new Date().getFullYear(), 11, 31));
      const daysLeft = Math.max(1, daysBetween(today(), endP) + 1);
      extra = `<span class="muted small">Нужно ${goalFmt(g, Math.ceil((tgt - v) / daysLeft * 10) / 10)} в день · Осталось ${daysLeft} дн.</span>`;
    } else if (!done && per === 'total' && g.by) {
      const daysLeft = daysBetween(today(), g.by);
      extra = `<span class="muted small">${daysLeft > 0 ? `К ${ru(g.by)}: нужно ${goalFmt(g, Math.ceil((tgt - v) / daysLeft * 10) / 10)} в день` : `Срок ${ru(g.by)} прошёл`}</span>`;
    }
    return `<div class="goal ${done ? 'done' : ''}"><div class="g-head"><span>${esc(g.title || T.t)}</span><span class="muted small">${GOAL_PERIODS[per]}</span></div>
      <div class="g-val"><b>${goalFmt(g, v)}</b><span class="muted"> из ${goalFmt(g, tgt)}</span>${done ? ' <span class="g-ok">✓ Выполнено</span>' : ''}</div>
      <div class="progress"><i style="width:${(pct * 100).toFixed(1)}%"></i></div>${extra}</div>`;
  }
  let glDraft = [];
  function glStartEdit() { glDraft = goals().map((g) => Object.assign({}, g)); renderGlEditor(); }
  function renderGlEditor() {
    $('#glEditor').innerHTML = glDraft.length ? glDraft.map((g, i) => { const T = GOAL_TYPES[g.type] || {};
      return `<div class="gl-row">
        <select data-gl="type" data-i="${i}" aria-label="Тип цели">${Object.keys(GOAL_TYPES).map((k) => `<option value="${k}" ${k === g.type ? 'selected' : ''}>${GOAL_TYPES[k].t}</option>`).join('')}</select>
        <div class="gl-line">
          <input type="text" inputmode="decimal" data-gl="target" data-i="${i}" value="${g.target || ''}" placeholder="${T.unit === '%' ? '90' : T.unit === 'money' ? 'Сумма' : 'Страниц'}" class="short-in" aria-label="Цель">
          <span class="muted small">${T.unit === 'money' ? esc(settings.finance.currency) : T.unit}</span>
          ${T.totalOnly ? '<span class="muted small grow">всего</span>' : `<select data-gl="period" data-i="${i}" class="grow">${Object.keys(GOAL_PERIODS).filter((p) => g.type !== 'prayers' || p !== 'total').map((p) => `<option value="${p}" ${p === (g.period || 'day') ? 'selected' : ''}>${GOAL_PERIODS[p]}</option>`).join('')}</select>`}
          <button type="button" class="icon-btn sm" data-gldel="${i}" aria-label="Удалить">✕</button>
        </div>
        ${(T.totalOnly || g.period === 'total') ? `<label class="gl-by"><span class="muted small">Срок (необязательно)</span><input type="date" data-gl="by" data-i="${i}" value="${esc(g.by || '')}"></label>` : ''}
      </div>`; }).join('') : '<p class="muted small">Целей пока нет.</p>';
    enhanceDates($('#glEditor'));
  }
  $('#glEditor').addEventListener('change', (e) => {
    const f = e.target.dataset.gl, i = Number(e.target.dataset.i); if (!f || !glDraft[i]) return;
    glDraft[i][f] = e.target.value;
    if (f === 'type') { if (GOAL_TYPES[e.target.value].totalOnly) glDraft[i].period = 'total'; else if (glDraft[i].period === 'total' && e.target.value === 'prayers') glDraft[i].period = 'month'; }
    if (f === 'type' || f === 'period') renderGlEditor();
  });
  $('#glEditor').addEventListener('input', (e) => { const f = e.target.dataset.gl, i = Number(e.target.dataset.i); if (f === 'target' && glDraft[i]) glDraft[i].target = e.target.value; });
  $('#glEditor').addEventListener('click', (e) => { const b = e.target.closest('[data-gldel]'); if (b) { glDraft.splice(Number(b.dataset.gldel), 1); renderGlEditor(); } });
  $('#glAdd').addEventListener('click', () => { glDraft.push({ id: uid(), type: 'read', target: '', period: 'day' }); renderGlEditor(); $$('#glEditor [data-gl="target"]').pop().focus(); });
  $('#glSave').addEventListener('click', (e) => withBusy(e.currentTarget, async () => {
    needOnline('цели');
    const items = glDraft.map((g) => ({ id: g.id || uid(), type: g.type, target: calc(g.target), period: GOAL_TYPES[g.type].totalOnly ? 'total' : g.period || 'day', by: g.by || '' }));
    if (items.some((g) => !(g.target > 0))) throw new Error('Укажите значение для каждой цели');
    await saveConfig('goals', { items }); glStartEdit(); renderStats(); toast('Цели сохранены ✓');
  }));
  openSettingsHooks.push(glStartEdit);

  // ═════════════ Напоминания ═════════════
  const ntCfg = () => Object.assign({ tg: false, prayers: { fajr: true, zuhr: true, asr: true, maghrib: true, isha: true }, before: 0, payments: true, hour: 8, budgets: true }, cfg().notify || {});
  let ntDraft = null;
  const canNotify = () => 'Notification' in window;
  const isIos = () => /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const isStandalone = () => navigator.standalone === true || (window.matchMedia && matchMedia('(display-mode: standalone)').matches);
  const IOS_HINT = 'На iPhone уведомления работают только у приложения с главного экрана: откройте сайт в Safari → «Поделиться» → «На экран «Домой»», запустите myTracker с иконки и включите здесь. Нужна iOS 16.4 или новее.';
  function ntStartEdit() {
    if (!meta) return;
    ntDraft = JSON.parse(JSON.stringify(ntCfg()));
    $('#ntLocal').checked = !!settings.notifyLocal && canNotify() && Notification.permission === 'granted';
    $('#ntLocalInfo').textContent = isIos() && !isStandalone() ? IOS_HINT : !canNotify() ? 'Этот браузер не поддерживает уведомления. Откройте сайт в Chrome (Android) или с главного экрана (iPhone).'
      : Notification.permission === 'denied' ? 'Уведомления запрещены в настройках телефона для этого сайта.'
      : settings.notifyLocal && !pushOn() ? (pushSupported() ? 'Сейчас — только пока приложение открыто. Выключите и включите снова, чтобы уведомления приходили и при закрытом приложении.' : 'Этот браузер умеет показывать уведомления только пока приложение открыто — для фона подключите Telegram.')
      : settings.notifyLocal ? '✅ Уведомления приходят с сервера — даже когда приложение закрыто.' : '';
    $('#ntPhoneLater').disabled = !pushOn();
    $('#ntTg').checked = !!ntDraft.tg;
    $('#ntBefore').value = String(ntDraft.before || 0);
    $('#ntPay').checked = ntDraft.payments !== false; $('#ntBudget').checked = ntDraft.budgets !== false;
    $('#ntHour').innerHTML = Array.from({ length: 24 }, (_, h) => `<option value="${h}" ${h === Number(ntDraft.hour) ? 'selected' : ''}>${pad(h)}:00</option>`).join('');
    renderNtPrayers(); renderTgInfo();
    if ((meta.tg || {}).linked && online) api('tgState').then((st) => { meta.tg = st; store.set('lt_meta', meta); renderTgInfo(); }).catch(() => {});
  }
  function renderNtPrayers() {
    $('#ntPrayers').innerHTML = PKEYS.filter((k) => k !== 'witr' && showP(k)).map((k) => `<button type="button" data-ntp="${k}" class="${ntDraft.prayers[k] ? 'on' : ''}">${pSpan(k)}</button>`).join('');
  }
  /** Расписание на сегодня от сервера: что и когда придёт в Telegram. */
  function tgPlanHtml(st) {
    if (st.on === false) return '<br><span class="muted small">Напоминания в Telegram выключены — включите переключатель ниже и сохраните.</span>';
    if (st.hasTimes === false) return '<br><span class="neg small">На сегодня нет строки в листе «Времена молитв» — напоминания о молитвах не придут.</span>';
    if (!st.today) return '';
    if (!st.today.length) return '<br><span class="muted small">На сегодня не выбрано ни одной молитвы.</span>';
    return `<br><span class="muted small">Сегодня в Telegram:</span><span class="tg-plan">${st.today.map((a) => `<span class="${a.sent ? 'sent' : ''}" title="${a.sent ? 'Отправлено' : 'Ожидает'}">${a.sent ? '✓ ' : ''}${pSpan(a.k)} ${esc(a.at)}</span>`).join('')}</span>`;
  }
  function renderTgInfo() {
    const st = meta.tg || {};
    $('#tgInfo').innerHTML = !st.hasToken ? '⚠ Бот не настроен: добавьте свойство <b>TG_TOKEN</b> в Apps Script (инструкция в README).'
      : !st.linked ? 'Напишите своему боту <b>/start</b> в Telegram и нажмите «Подключить».'
      : '✅ Telegram подключён' + tgPlanHtml(st);
    $('#tgLink').textContent = st.linked ? 'Переподключить' : 'Подключить';
    $('#tgLink').disabled = !st.hasToken; $('#tgTest').disabled = !st.linked; $('#tgTestLater').disabled = !st.linked;
  }
  $('#ntPrayers').addEventListener('click', (e) => { const b = e.target.closest('[data-ntp]'); if (!b) return; ntDraft.prayers[b.dataset.ntp] = !ntDraft.prayers[b.dataset.ntp]; renderNtPrayers(); });
  $('#ntTg').addEventListener('change', (e) => { ntDraft.tg = e.target.checked; });
  $('#ntBefore').addEventListener('change', (e) => { ntDraft.before = Number(e.target.value); });
  $('#ntHour').addEventListener('change', (e) => { ntDraft.hour = Number(e.target.value); });
  $('#ntPay').addEventListener('change', (e) => { ntDraft.payments = e.target.checked; });
  $('#ntBudget').addEventListener('change', (e) => { ntDraft.budgets = e.target.checked; });
  $('#ntLocal').addEventListener('change', (e) => withBusy(e.target, async () => {
    if (!e.target.checked) { settings.notifyLocal = false; saveSettings(); try { await pushDisable(); } catch (x) {} ntStartEdit(); return; }
    if (!canNotify() || (isIos() && !isStandalone())) { e.target.checked = false; ntStartEdit(); toast(isIos() ? 'Сначала добавьте myTracker на главный экран — подробности под переключателем' : 'Этот браузер не поддерживает уведомления', true); return; }
    const p = await Notification.requestPermission();
    settings.notifyLocal = p === 'granted'; saveSettings(); e.target.checked = settings.notifyLocal;
    if (p !== 'granted') { toast('Разрешите уведомления для этого сайта в настройках телефона', true); ntStartEdit(); return; }
    if (pushSupported()) {
      try { await pushEnable(); toast('Уведомления включены ✓ Они будут приходить, даже когда приложение закрыто'); }
      catch (x) { toast(x.message, true); notifyNow('🔔 myTracker', T('Уведомления включены')); }
    } else notifyNow('🔔 myTracker', T('Уведомления включены'));
    ntStartEdit();
  }));
  $('#ntSave').addEventListener('click', (e) => withBusy(e.currentTarget, async () => {
    needOnline('напоминания');
    await saveConfig('notify', Object.assign({}, ntDraft, { lang: LANG, tz: userTz(), push: pushOn() || ntDraft.push !== false }));
    ntStartEdit(); toast(ntDraft.tg && !(meta.tg || {}).linked ? 'Сохранено. Подключите Telegram, чтобы получать напоминания' : 'Напоминания сохранены ✓');
  }));
  $('#tgLink').addEventListener('click', (e) => withBusy(e.currentTarget, async () => {
    meta.tg = await api('tgLink'); store.set('lt_meta', meta); renderTgInfo();
    if (!ntDraft.tg) { ntDraft.tg = true; $('#ntTg').checked = true; await saveConfig('notify', Object.assign({}, ntDraft, { lang: LANG })); }
    toast('Telegram подключён ✓ — проверьте сообщение от бота');
  }));
  $('#tgTest').addEventListener('click', (e) => withBusy(e.currentTarget, async () => { await api('tgTest'); toast('Отправлено — проверьте Telegram'); }));
  $('#tgTestLater').addEventListener('click', (e) => withBusy(e.currentTarget, async () => {
    const r = await api('tgTestLater', { minutes: 2 });
    toast(`Тест придёт около ${r.at}. Можно закрыть приложение`);
  }));
  // тест уведомления на телефоне: сразу и ещё раз через минуту (сверните приложение, чтобы проверить фон)
  $('#ntLocalTest').addEventListener('click', async () => {
    if (!canNotify() || (isIos() && !isStandalone())) { toast(isIos() ? 'Сначала добавьте myTracker на главный экран — подробности выше' : 'Этот браузер не поддерживает уведомления', true); return; }
    if (Notification.permission !== 'granted' && (await Notification.requestPermission()) !== 'granted') { toast('Разрешите уведомления для этого сайта в настройках телефона', true); return; }
    if (pushOn()) {
      try { await api('pushTest'); toast('Отправлено с сервера — уведомление должно появиться через несколько секунд'); }
      catch (x) { toast(x.message, true); }
      return;
    }
    notifyNow('🧪 myTracker', T('Тест: уведомления на этом телефоне работают'), 'test1');
    toast('Пока уведомления работают только при открытом приложении. Включите переключатель заново, чтобы они приходили и в фоне');
  });
  $('#ntPhoneLater').addEventListener('click', (e) => withBusy(e.currentTarget, async () => {
    const r = await api('tgTestLater', { minutes: 2 });
    toast(`Тест придёт около ${r.at}. Закройте приложение полностью и подождите`);
  }));

  // ── уведомления с сервера (Web Push): работают и при закрытом приложении
  const pushSupported = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window && location.protocol === 'https:';
  const pushOn = () => !!(settings.push && settings.push.pk);
  const b64uBytes = (s) => { const b = atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4)); return Uint8Array.from(b, (c) => c.charCodeAt(0)); };
  const userTz = () => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || ''; } catch (e) { return ''; } };
  async function savePushCfg(pk) { try { await (await caches.open('mytracker-push')).put('push-cfg', new Response(JSON.stringify({ api: API, pk }))); } catch (e) {} }
  async function pushEnable() {
    const reg = (await navigator.serviceWorker.getRegistration()) || (await navigator.serviceWorker.register('sw.js'));
    await navigator.serviceWorker.ready;
    const { pub } = await api('pushKey'), key = b64uBytes(pub);
    let sub = await reg.pushManager.getSubscription();
    if (sub) { const old = sub.options && sub.options.applicationServerKey ? new Uint8Array(sub.options.applicationServerKey) : null;
      if (!old || old.length !== key.length || old.some((v, i) => v !== key[i])) { await sub.unsubscribe(); sub = null; } }
    if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
    const r = await api('pushSub', { sub: sub.toJSON(), origin: location.origin, ua: navigator.userAgent.slice(0, 120), old: settings.push && settings.push.ep });
    settings.push = { pk: r.pk, ep: sub.endpoint }; saveSettings(); await savePushCfg(r.pk);
    // часовой пояс и включение канала — в общих настройках напоминаний
    const n = Object.assign({}, ntCfg(), { push: true, tz: userTz(), lang: LANG }); await saveConfig('notify', n);
  }
  async function pushDisable() {
    const P = settings.push; settings.push = null; saveSettings();
    try { const reg = await navigator.serviceWorker.getRegistration(), sub = reg && (await reg.pushManager.getSubscription()); if (sub) await sub.unsubscribe(); } catch (e) {}
    if (P) await api('pushUnsub', { pk: P.pk, endpoint: P.ep });
  }
  // при каждом запуске: ключ подписки доступен service worker'у, подписка не потерялась
  (async () => { if (pushOn()) { await savePushCfg(settings.push.pk);
    try { const reg = await navigator.serviceWorker.getRegistration(), sub = reg && (await reg.pushManager.getSubscription());
      if (reg && !sub && online && Notification.permission === 'granted') await pushEnable(); } catch (e) {} } })();

  // ── проверка: почему не приходят напоминания
  const agoMin = (ms) => { if (!ms) return T('ни разу'); const m = Math.round((Date.now() - ms) / 60000); return m < 1 ? T('только что') : m < 60 ? `${m} ${T('мин назад')}` : `${Math.round(m / 60)} ${T('ч назад')}`; };
  function diagHtml(d) {
    const ok = (b, t, hint) => `<li class="${b ? 'ok' : 'bad'}">${b ? '✅' : '⚠️'} ${t}${!b && hint ? `<br><span class="muted small">${hint}</span>` : ''}</li>`;
    const tzPhone = userTz(), tzOk = !tzPhone || d.tz === tzPhone;
    const anyCh = (d.linked && d.tgOn) || d.push > 0;
    return `<ul class="diag">
      ${ok(d.hasToken, 'Токен бота (TG_TOKEN) добавлен', 'Apps Script → Настройки проекта → Свойства скрипта → TG_TOKEN.')}
      ${ok(d.linked, 'Telegram подключён', 'Напишите боту /start и нажмите «Подключить».')}
      ${ok(d.tgOn, 'Напоминания в Telegram включены', 'Включите переключатель «Напоминания в Telegram» и нажмите «Сохранить напоминания».')}
      ${ok(d.push > 0, `Телефоны с уведомлениями: ${d.push}`, 'Включите «Уведомления на этом телефоне» выше.')}
      ${ok(tzOk, `Часовой пояс сервера: ${esc(d.tz)}${tzPhone ? ` · ${T('телефона')}: ${esc(tzPhone)}` : ''}`, 'Пояса не совпадают — напоминания приходили бы не в то время. Нажмите «Починить».')}
      <li>🕒 ${T('Время на сервере')}: <b>${esc(d.now)}</b></li>
      ${ok(d.hasTimes, 'Время молитв на сегодня есть', 'В листе «Времена молитв» нет строки на сегодня — добавьте времена на этот месяц.')}
      ${d.today && d.today.length ? `<li>📋 ${T('Сегодня')}: ${d.today.map((a) => `${a.sent ? '✓ ' : ''}${esc(pNameDash(a.k))} ${esc(a.at)}`).join(' · ')}</li>` : ''}
      ${ok(d.sweep, 'Проверка раз в 10 минут установлена', anyCh ? 'Нажмите «Починить».' : 'Сначала подключите Telegram или уведомления на телефоне.')}
      ${d.sweep ? ok(d.lastSweep && Date.now() - d.lastSweep < 25 * 60000, `${T('Последняя проверка')}: ${agoMin(d.lastSweep)}`, 'Google давно не запускал проверку. Нажмите «Починить»; если не поможет — в Apps Script запустите authorize и разрешите доступ.') : ''}
      ${ok(d.nightly, 'Ночное обновление установлено', 'Нажмите «Починить».')}
      ${d.lastSent ? `<li>📨 ${T('Последнее напоминание о молитве')}: ${agoMin(d.lastSent)}</li>` : ''}
      ${d.err ? `<li class="bad">⚠️ ${esc(d.err.m)} <span class="muted small">(${agoMin(d.err.at)})</span></li>` : ''}
      ${d.pushErr && (!d.pushLast || d.pushErr.at > d.pushLast) ? `<li class="bad">⚠️ ${T('Телефон')}: ${T('код')} ${esc(d.pushErr.code)} ${esc(d.pushErr.text || '')}</li>` : ''}
    </ul>`;
  }
  $('#ntDiag').addEventListener('click', (e) => withBusy(e.currentTarget, async () => { $('#ntDiagOut').innerHTML = diagHtml(await api('notifyDiag')); }));
  $('#ntRepair').addEventListener('click', (e) => withBusy(e.currentTarget, async () => {
    const tz = userTz(); if (tz && (ntCfg().tz || '') !== tz) await saveConfig('notify', Object.assign({}, ntCfg(), { tz, lang: LANG }));
    const d = await api('notifyRepair'); $('#ntDiagOut').innerHTML = diagHtml(d);
    toast(`Расписание поставлено заново ✓ Напоминаний на сегодня: ${d.installed || 0}`);
  }));
  openSettingsHooks.push(ntStartEdit);

  /** Показ уведомления. Android и iPhone требуют показывать его через service worker. */
  async function notifyNow(title, body, tag) {
    const opts = { body, tag: tag || 'mt', icon: 'icons/icon-192.png', badge: 'icons/icon-192.png' };
    try {
      const reg = navigator.serviceWorker && (await navigator.serviceWorker.getRegistration());
      if (reg) { await reg.showNotification(title, opts); return; }
    } catch (e) {}
    try { new Notification(title, opts); } catch (e) {}
  }
  /** Проверка раз в 20 секунд: началось ли время молитвы, есть ли платежи на сегодня. */
  function notifyTick() {
    if (!meta || !settings.notifyLocal || !canNotify() || Notification.permission !== 'granted') return;
    if (pushOn()) return; // уведомления присылает сервер — не дублируем
    const now = new Date(), t = iso(now), mins = now.getHours() * 60 + now.getMinutes(), c = ntCfg();
    const done = store.get('lt_notified', {}), mark = (k) => { done[k] = 1; Object.keys(done).forEach((x) => { if (x.slice(0, 10) < addDays(t, -2)) delete done[x]; }); store.set('lt_notified', done); };
    const row = times.find((x) => x.date === t);
    segmentsFor(row).forEach((sg) => {
      let k = sg.k, at = sg.s; if (k === 'makruh') return;
      if (k === 'duha') at += 20;
      if (!c.prayers[k] || !showP(k)) return;
      at -= Number(c.before) || 0;
      const key = t + '|' + k;
      if (mins >= at && mins < at + 15 && !done[key]) {
        mark(key);
        notifyNow(`🕌 ${isAr(pName(k)) ? pNameDash(k) : pName(k)} · ${hhmm(sg.s)}`, T(c.before ? `Через ${c.before} мин — время молитвы` : 'Началось время молитвы'), 'prayer-' + k);
      }
    });
    if (now.getHours() >= Number(c.hour || 8) && !done[t + '|pay']) {
      const due = dueList().filter((r) => r.d <= 0 && !(r.auto && r.d === 0));
      mark(t + '|pay');
      if (due.length) notifyNow('💳 ' + T('Платежи'), due.map((r) => `${r.name} — ${money(r.amount)} (${T(dueText(r.d))})`).join('\n'), 'pay');
    }
    // план Корана: в выбранное время — что повторить и что выучить сегодня
    const nc = cfg().notify || {}, atMin = (q) => { const m = /^(\d{1,2}):(\d{2})$/.exec((q && q.time) || ''); return m ? Number(m[1]) * 60 + Number(m[2]) : -1; };
    if (nc.qrev && nc.qrev.on && mins >= atMin(nc.qrev) && atMin(nc.qrev) >= 0 && !done[t + '|qrev']) {
      mark(t + '|qrev');
      const R = revisionToday();
      if (R && !R.empty && R.done < R.total) notifyNow('🔁 ' + T('Повторение на сегодня'), revPlainText(R), 'qrev');
    }
    if (nc.qmemo && nc.qmemo.on && mins >= atMin(nc.qmemo) && atMin(nc.qmemo) >= 0 && !done[t + '|qmemo']) {
      mark(t + '|qmemo');
      const M = memoToday();
      if (M && !M.done && !M.finished && M.text) notifyNow('📗 ' + T('Выучить сегодня'), T(M.text), 'qmemo');
    }
  }
  setInterval(notifyTick, 20000);

  // ═════════════ Экспорт и импорт CSV ═════════════
  const CSV_HEAD = {
    finance: ['ID', 'Дата', 'Сумма', 'Действие', 'Категория', 'Комментарий', 'Создано', 'Поток ±', 'Счёт', 'На счёт'],
    prayers: ['Дата', 'Фаджр', 'Духа', 'Зухр', 'Аср', 'Магриб', 'Иша', 'Витр', 'Комментарий'],
    reading: ['ID', 'Дата', 'Вид', 'Тип', 'С стр.', 'По стр.', 'Страниц', 'Повторов', 'Итого стр.', '№ суры', 'Сура', 'Аятов', 'Итого аятов', 'Комментарий']
  };
  const CSV_NAME = { finance: 'Финансы', prayers: 'Молитвы', reading: 'Коран' };
  const csvCell = (v) => { const s = v == null ? '' : String(v); return /[";\n\r,]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
  function exportCsv(kind) {
    const v = view();
    let rows = kind === 'prayers' ? [...v.prayers.values()].sort((a, b) => (a[0] < b[0] ? -1 : 1)) : (kind === 'finance' ? v.finance : v.reading).slice().sort((a, b) => (a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0));
    rows = rows.map((r) => r.slice(0, CSV_HEAD[kind].length).map((c, i) => (i === 0 && isTmp(c) ? '' : c)));
    const text = '﻿' + [CSV_HEAD[kind]].concat(rows).map((r) => r.map(csvCell).join(';')).join('\r\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' }));
    a.download = `myTracker-${kind}-${today()}.csv`;
    document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
    toast(`Экспортировано строк: ${rows.length}`);
  }
  $$('[data-csv]').forEach((b) => b.addEventListener('click', () => { if (!meta) return; exportCsv(b.dataset.csv); }));
  function parseCsv(text) {
    text = text.replace(/^﻿/, '');
    const first = text.split(/\r?\n/)[0] || '', cnt = (ch) => first.split(ch).length;
    const d = [';', ',', '\t'].sort((a, b) => cnt(b) - cnt(a))[0];
    const rows = []; let row = [], cell = '', q = false;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (q) { if (ch === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += ch; continue; }
      if (ch === '"') q = true;
      else if (ch === d) { row.push(cell); cell = ''; }
      else if (ch === '\n' || ch === '\r') { if (ch === '\r' && text[i + 1] === '\n') i++; row.push(cell); rows.push(row); row = []; cell = ''; }
      else cell += ch;
    }
    if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
    return rows.filter((r) => r.some((c) => String(c).trim() !== ''));
  }
  function csvKind(head) {
    const h = head.map((x) => String(x).trim().toLowerCase());
    if (h.indexOf('сумма') >= 0 || h.indexOf('amount') >= 0) return 'finance';
    if (h.indexOf('фаджр') >= 0 || h.indexOf('fajr') >= 0) return 'prayers';
    if ((h.indexOf('вид') >= 0 && h.indexOf('тип') >= 0) || h.indexOf('kind') >= 0) return 'reading';
    return null;
  }
  $('#csvFile').addEventListener('change', async (e) => {
    const f = e.target.files[0]; e.target.value = ''; if (!f) return;
    const info = $('#csvInfo');
    try {
      needOnline('импорт');
      const rows = parseCsv(await f.text());
      const kind = rows.length && csvKind(rows[0]);
      if (!kind) throw new Error('Не удалось понять, что в файле. Нужны заголовки как при экспорте');
      const data = rows.slice(1);
      if (!data.length) throw new Error('В файле нет строк');
      if (!confirmT(`Импортировать ${data.length} строк в «${CSV_NAME[kind]}»?`)) return;
      let added = 0, updated = 0, skipped = 0;
      for (let i = 0; i < data.length; i += 500) {
        info.textContent = T(`Импорт… ${Math.min(i + 500, data.length)} из ${data.length}`);
        const r = await api('importCsv', { kind, rows: data.slice(i, i + 500) });
        added += r.added; updated += r.updated; skipped += r.skipped;
      }
      info.textContent = T(`Готово: добавлено ${added}, обновлено ${updated}, пропущено ${skipped}`);
      toast('Импорт завершён ✓'); sync(true);
    } catch (err) { info.textContent = ''; toast(err.message, true); }
  });

  // ═════════════ Язык ═════════════
  $$('.lang-switch [data-lang]').forEach((b) => {
    b.classList.toggle('on', b.dataset.lang === LANG);
    b.addEventListener('click', () => {
      if (b.dataset.lang === LANG) return;
      settings.lang = b.dataset.lang; saveSettings();
      if (meta && meta.config && meta.config.notify && online) api('saveConfig', { key: 'notify', value: Object.assign({}, meta.config.notify, { lang: settings.lang }) }).catch(() => {});
      location.reload();
    });
  });


  // ═════════════ Настройки: хифз — заучено ранее ═════════════
  let hzDraft = null;
  function hzStartEdit() {
    if (!meta) return;
    const h = (meta.config && meta.config.hifz) || {};
    hzDraft = { suras: new Set(h.suras || []), pages: h.pages || '', date: h.date || today() };
    $('#hzPages').value = hzDraft.pages; $('#hzDate').value = hzDraft.date; $('#hzSearch').value = '';
    renderHz();
  }
  function renderHz() {
    const q = $('#hzSearch').value.trim().toLowerCase().replace(/[-'\s]/g, '');
    $('#hzSuras').innerHTML = meta.suras.filter((x) => !q || String(x.n) === q || x.name.toLowerCase().replace(/[-'\s]/g, '').includes(q))
      .map((x) => `<button type="button" data-hz="${x.n}" class="${hzDraft.suras.has(x.n) ? 'on' : ''}" title="${esc(x.name)}"><b>${x.n}</b>${esc(x.name)}</button>`).join('');
    const pages = new Set(parsePages(hzDraft.pages)); hzDraft.suras.forEach((n) => { const [a, b] = suraPages(n); for (let p = a; p <= b; p++) pages.add(p); });
    $('#hzInfo').textContent = `Выбрано сур: ${hzDraft.suras.size} · Страниц: ${pages.size} из 604`;
  }
  $('#hzSearch').addEventListener('input', renderHz);
  $('#hzSuras').addEventListener('click', (e) => { const b = e.target.closest('[data-hz]'); if (!b) return; const n = Number(b.dataset.hz); hzDraft.suras.has(n) ? hzDraft.suras.delete(n) : hzDraft.suras.add(n); renderHz(); });
  $$('[data-hzq]').forEach((b) => b.addEventListener('click', () => {
    if (!hzDraft) return;
    const q = b.dataset.hzq;
    if (q === 'clear') { hzDraft.suras.clear(); hzDraft.pages = ''; $('#hzPages').value = ''; }
    else { const [a, z] = q === '30' ? [78, 114] : [67, 77]; const all = Array.from({ length: z - a + 1 }, (_, i) => a + i).every((n) => hzDraft.suras.has(n));
      for (let n = a; n <= z; n++) all ? hzDraft.suras.delete(n) : hzDraft.suras.add(n); }
    renderHz();
  }));
  $('#hzPages').addEventListener('input', (e) => { hzDraft.pages = e.target.value; renderHz(); });
  $('#hzDate').addEventListener('change', (e) => { hzDraft.date = e.target.value; });
  $('#hzSave').addEventListener('click', (e) => withBusy(e.currentTarget, async () => {
    needOnline('заученное');
    if (hzDraft.pages.trim() && !parsePages(hzDraft.pages).size) throw new Error('Страницы: например 1-21, 582-604');
    await saveConfig('hifz', { suras: [...hzDraft.suras].sort((a, b) => a - b), pages: hzDraft.pages.trim(), date: hzDraft.date || today() });
    changed(); renderAll(); toast('Заученное сохранено ✓');
  }));
  openSettingsHooks.push(hzStartEdit);

  // ═════════════ Отмена действий (↶) ═════════════
  // История хранится на этом телефоне. Каждая запись знает, на какой вкладке сделано действие и как его откатить.
  let undos = store.get('lt_undo', []);
  let opIds = store.get('lt_opids', {}); // id операции из очереди → номера записей в таблице (после отправки)
  const UNDO_KIND = { prayers: 'prayers', quran: 'quran', finance: 'finance' };
  const saveUndo = () => { store.set('lt_undo', undos); };
  function undoCutoff() {
    const k = Number(settings.undo.keep);
    if (k > 0) return Date.now() - k * 60000;
    const d = new Date(); d.setHours(0, 0, 0, 0); return d.getTime(); // «до конца дня»
  }
  function undoAllowed(e) { return settings.undo[e.type === 'hide' ? 'hide' : UNDO_KIND[e.tab]] !== false; }
  function pruneUndo() {
    const c = undoCutoff(), before = undos.length;
    undos = undos.filter((e) => e.at >= c).slice(-60);
    Object.keys(opIds).forEach((k) => { if (opIds[k].at < Date.now() - 8 * 864e5) delete opIds[k]; });
    if (undos.length !== before) saveUndo();
  }
  function availableUndos() {
    pruneUndo();
    return undos.filter((e) => undoAllowed(e) && (!settings.undo.tabOnly || e.tab === currentTab));
  }
  /** Запомнить действие. Возвращает запись истории (для кнопки «Отменить» в уведомлении). */
  function pushUndo(e) {
    const entry = Object.assign({ id: uid(), at: Date.now(), tab: currentTab }, e);
    if (!undoAllowed(entry)) return null;
    undos.push(entry); pruneUndo(); saveUndo(); renderUndoBtn();
    return entry;
  }
  function renderUndoBtn() {
    const b = $('#topUndo'); if (!b) return;
    const list = availableUndos(), last = list[list.length - 1];
    b.classList.toggle('hidden', !last);
    b.title = last ? T('Отменить: ') + T(last.label) : '';
    b.setAttribute('aria-label', b.title || T('Отменить'));
  }
  const rowToReading = (r) => ({ date: r[1], kind: r[2], type: r[3] === 'Сура' ? 'suras' : 'pages', from: r[4], to: r[5], suras: r[9] !== '' ? [Number(r[9])] : [], repeats: r[7] || 1, comment: r[13] || '' });
  const rowToFinance = (r) => ({ amount: Number(r[2]), actionType: r[3], category: r[4] || '', date: r[1], comment: r[5] || '', account: r[8] || '', toAccount: r[9] || '', person: r[10] || '' });
  /** Откатить добавленную операцию: если ещё в очереди — убрать, если уже в таблице — удалить запись. */
  function revertAdded(opId, delOp) {
    const o = outbox.find((x) => x.id === opId && !x.sending);
    if (o) { outbox = outbox.filter((x) => x !== o); return true; }
    const ids = (opIds[opId] || {}).ids || [], s = sent.find((x) => x.id === opId);
    if (!ids.length) return false;
    if (s) sent = sent.filter((x) => x !== s);
    ids.forEach((id) => enqueue(delOp, { id }));
    if (s && s.p && s.p.recurId) enqueue('revertRecurring', { id: s.p.recurId, due: s.p.recurDue });
    return true;
  }
  function doUndo(entryId) {
    const list = availableUndos(), e = entryId ? undos.find((x) => x.id === entryId) : list[list.length - 1];
    if (!e) { toast('Нечего отменять'); return; }
    let ok = true;
    if (e.type === 'prayer') {
      enqueue('savePrayer', Object.assign({ date: e.date, comment: e.prev.comment }, e.prev.st), 'prayer|' + e.date);
      if (pDate === e.date) { Object.assign(pState, e.prev.st); setText($('#pComment'), e.prev.comment); paintPrayers(); }
    } else if (e.type === 'add') {
      ok = e.ops.map((id) => revertAdded(id, e.del)).every(Boolean);
      if (e.recur) { const o = outbox.find((x) => x.op === 'skipRecurring' && x.p.id === e.recur.id && x.p.due === e.recur.due); if (o) outbox = outbox.filter((x) => x !== o); }
    } else if (e.type === 'skip') {
      const o = outbox.find((x) => x.id === e.op && !x.sending);
      if (o) outbox = outbox.filter((x) => x !== o); else enqueue('revertRecurring', { id: e.recur.id, due: e.recur.due });
    } else if (e.type === 'update') {
      enqueue(e.op, Object.assign({ id: e.recId }, e.prev), e.key);
    } else if (e.type === 'opedit') {
      const o = outbox.find((x) => x.id === e.op);
      if (o) { o.p = e.prev; delete o.err; } else ok = false;
    } else if (e.type === 'oprestore') {
      outbox.push(e.opObj);
    } else if (e.type === 'plan') {
      (e.ops || []).forEach((id) => revertAdded(id, 'deleteReading'));
      const P = planCfg(); P.memo = e.prevMemo; savePlan(P);
    } else if (e.type === 'hide') {
      hidden[e.list] = hidden[e.list].filter((x) => x !== String(e.recId)); store.set('lt_hidden', hidden);
    }
    undos = undos.filter((x) => x !== e); saveUndo();
    persist(); changed(); renderAll(); renderUndoBtn();
    if (!ok) { toast('Не удалось отменить: запись уже обработана. Измените её вручную', true); return; }
    toast('Отменено: ' + T(e.label));
    if (settings.autoSend) scheduleFlush(1500);
  }
  $('#topUndo').addEventListener('click', () => doUndo());
  $('#undoClear').addEventListener('click', () => { undos = []; saveUndo(); renderUndoBtn(); toast('История отмены очищена'); });
  setInterval(renderUndoBtn, 60000);

  // ═════════════ Долги по людям ═════════════
  // Имя человека хранится в колонке «Человек». У старых записей без имени берём комментарий — вы писали туда имя.
  const peopleCfg = () => ((cfg().people || {}).items || []);
  const debtPerson = (r) => String(r[10] || '').trim() || String(r[5] || '').trim() || 'Без имени';
  /** Остатки по каждому человеку: я должен / мне должны, по всем записям (без фильтра по счёту). */
  function debtLedger() {
    const fin = meta.fin, L = {};
    view().finance.forEach((r) => {
      if (r[3] !== fin.DEBT) return;
      const c = r[4], amt = Number(r[2]) || 0, name = debtPerson(r), key = name.toLowerCase();
      const o = L[key] || (L[key] = { name, iOwe: 0, owed: 0, last: '', count: 0, legacy: false });
      if (c === fin.BORROWED) o.iOwe += amt; else if (c === fin.REPAID) o.iOwe -= amt;
      else if (c === fin.LENT) o.owed += amt; else if (c === fin.RETURNED) o.owed -= amt;
      o.count++; if (r[1] > o.last) o.last = r[1];
      if (!String(r[10] || '').trim()) o.legacy = true;
    });
    const list = Object.values(L).map((o) => Object.assign(o, { iOwe: Math.round(o.iOwe * 100) / 100, owed: Math.round(o.owed * 100) / 100 }));
    return { list, iOwe: list.reduce((t, o) => t + Math.max(0, o.iOwe), 0), owed: list.reduce((t, o) => t + Math.max(0, o.owed), 0) };
  }
  /** Все имена: из списка «Люди» и из записей. */
  function allPeople() {
    const seen = {}, out = [];
    peopleCfg().filter((p) => !p.archived).forEach((p) => { if (!seen[p.name.toLowerCase()]) { seen[p.name.toLowerCase()] = 1; out.push(p.name); } });
    view().finance.forEach((r) => { const n = String(r[10] || '').trim(); if (n && !seen[n.toLowerCase()] && !peopleCfg().some((p) => p.archived && p.name === n)) { seen[n.toLowerCase()] = 1; out.push(n); } });
    return out;
  }
  let fPerson = '', debtFilter = '';
  const isDebt = (a) => meta && a === meta.fin.DEBT;
  /** Выбор человека: выпадающий список с поиском; «＋ Создать» — прямо там же.
   *  При погашении в списке только те, с кем есть открытый долг, и сумма долга. */
  let pcOpen = false, pcIdx = -1;
  const pcRepay = () => fCategory === meta.fin.REPAID || fCategory === meta.fin.RETURNED;
  function pcItems(q) {
    const fin = meta.fin, L = debtLedger().list, byName = {}; L.forEach((o) => { byName[o.name.toLowerCase()] = o; });
    q = String(q || '').trim().toLowerCase();
    let items;
    if (pcRepay()) {
      const side = fCategory === fin.REPAID ? 'iOwe' : 'owed';
      items = L.filter((o) => o[side] > 0.004).sort((a, b) => b[side] - a[side]).map((o) => ({ name: o.name, amt: o[side], side }));
    } else {
      // сначала те, с кем есть открытый долг, затем остальные по алфавиту
      const names = allPeople(); L.forEach((o) => { if (names.every((x) => x.toLowerCase() !== o.name.toLowerCase())) names.push(o.name); });
      items = names.map((n) => { const o = byName[n.toLowerCase()] || {}; return { name: n, iOwe: o.iOwe || 0, owed: o.owed || 0 }; })
        .sort((a, b) => ((b.iOwe + b.owed > 0.004) - (a.iOwe + a.owed > 0.004)) || a.name.localeCompare(b.name, LOC));
    }
    if (q) items = items.filter((x) => x.name.toLowerCase().indexOf(q) >= 0).sort((a, b) => (b.name.toLowerCase().indexOf(q) === 0) - (a.name.toLowerCase().indexOf(q) === 0));
    return items.slice(0, 60);
  }
  function pcRender() {
    const box = $('#fPersonList'), q = $('#fPersonIn').value.trim(), items = pcItems(pcOpen && q !== fPerson ? q : '');
    const exact = items.some((x) => x.name.toLowerCase() === q.toLowerCase());
    let h = items.map((x, i) => `<button type="button" role="option" data-pv="${esc(x.name)}" ${x.amt ? `data-amt="${x.amt}"` : ''} class="${x.name === fPerson ? 'on' : ''} ${i === pcIdx ? 'hi' : ''}">
        <span class="pc-name">${esc(x.name)}</span>${x.amt ? `<b>${money(x.amt)}</b>` : x.iOwe > 0.004 ? `<span class="pc-d neg">${T('Я должен')} ${money(x.iOwe)}</span>` : x.owed > 0.004 ? `<span class="pc-d pos">${T('Мне должны')} ${money(x.owed)}</span>` : ''}</button>`).join('');
    if (!pcRepay() && q && !exact) h += `<button type="button" data-pnew="${esc(q)}" class="pc-new ${pcIdx === items.length ? 'hi' : ''}">＋ ${T('Создать')} «${esc(q)}»</button>`;
    if (!h) h = `<div class="pc-empty muted small">${pcRepay() ? (fCategory === meta.fin.REPAID ? T('Открытых долгов нет') : T('Вам никто не должен')) : T('Введите имя, чтобы добавить человека')}</div>`;
    box.innerHTML = h;
    box.classList.toggle('hidden', !pcOpen); $('#fPersonIn').setAttribute('aria-expanded', pcOpen);
  }
  function pcPick(name, amt) {
    fPerson = name || ''; pcOpen = false; pcIdx = -1;
    $('#fPersonIn').value = fPerson;
    if (fPerson && amt && !$('#fAmount').value.trim()) $('#fAmount').value = amt; // погашение: подставить сумму долга
    renderPerson();
  }
  function renderPerson() {
    const wrap = $('#fPersonWrap'); if (!wrap) return;
    const on = isDebt(fAction); wrap.classList.toggle('hidden', !on); if (!on) { pcOpen = false; return; }
    const fin = meta.fin;
    $('#fPersonLbl').textContent = fCategory === fin.REPAID ? 'Какой долг гасите' : fCategory === fin.RETURNED ? 'Кто вернул' : fCategory === fin.LENT ? 'Кому дали' : fCategory === fin.BORROWED ? 'У кого взяли' : 'Человек';
    const inp = $('#fPersonIn');
    if (document.activeElement !== inp) inp.value = fPerson;
    inp.placeholder = T(pcRepay() ? 'Выберите из списка' : 'Имя или новый человек');
    $('#fPersonClr').classList.toggle('hidden', !inp.value);
    // подсказка под полем: сколько сейчас с этим человеком
    const o = fPerson && debtLedger().list.find((x) => x.name.toLowerCase() === fPerson.toLowerCase());
    const hint = $('#fPersonHint'), isNew = fPerson && allPeople().every((n) => n.toLowerCase() !== fPerson.toLowerCase());
    hint.innerHTML = isNew ? `${T('Новый человек — сохранится вместе с записью')}` : o && (o.iOwe > 0.004 || o.owed > 0.004) ? [o.iOwe > 0.004 ? `${T('Я должен')}: <b>${money(o.iOwe)}</b>` : '', o.owed > 0.004 ? `${T('Мне должны')}: <b>${money(o.owed)}</b>` : ''].filter(Boolean).join(' · ') : '';
    hint.classList.toggle('hidden', !hint.innerHTML);
    pcRender();
  }
  (function () {
    const inp = $('#fPersonIn'), list = $('#fPersonList');
    const open = () => { if (!pcOpen) { pcOpen = true; pcIdx = -1; pcRender(); setTimeout(() => list.scrollIntoView({ block: 'nearest', behavior: 'smooth' }), 50); } };
    inp.addEventListener('focus', () => { inp.select(); open(); });
    inp.addEventListener('click', open);
    $('#fPersonBox .pc-arrow').addEventListener('click', () => { if (pcOpen) { pcOpen = false; pcRender(); } else inp.focus(); });
    inp.addEventListener('input', () => { pcOpen = true; pcIdx = -1; $('#fPersonClr').classList.toggle('hidden', !inp.value); pcRender(); });
    inp.addEventListener('keydown', (e) => {
      const opts = [...list.querySelectorAll('button')];
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); if (!pcOpen) open(); pcIdx = Math.max(0, Math.min(opts.length - 1, pcIdx + (e.key === 'ArrowDown' ? 1 : -1))); pcRender(); }
      else if (e.key === 'Enter') { e.preventDefault(); const b = opts[pcIdx >= 0 ? pcIdx : 0]; if (b) b.click(); else inp.blur(); }
      else if (e.key === 'Escape') { pcOpen = false; inp.value = fPerson; pcRender(); inp.blur(); }
    });
    // нажатие по пункту: pointerdown, чтобы не потерять фокус раньше времени
    list.addEventListener('pointerdown', (e) => { if (e.target.closest('button')) e.preventDefault(); });
    list.addEventListener('click', (e) => {
      const b = e.target.closest('button'); if (!b) return;
      if (b.dataset.pnew != null) { pcPick(b.dataset.pnew.trim()); toast(`Человек «${b.dataset.pnew.trim()}» добавлен — сохранится вместе с записью`); }
      else pcPick(b.dataset.pv, b.dataset.amt);
      inp.blur();
    });
    inp.addEventListener('blur', () => setTimeout(() => {
      if (document.activeElement === inp) return;
      const v = inp.value.trim();
      if (v !== fPerson) {
        // напечатали имя и ушли из поля: существующее — выбираем, новое — создаём (кроме погашения)
        const hit = pcItems('').find((x) => x.name.toLowerCase() === v.toLowerCase());
        if (hit) pcPick(hit.name, hit.amt); else if (!v) pcPick(''); else if (!pcRepay()) pcPick(v); else inp.value = fPerson;
      }
      pcOpen = false; pcRender();
    }, 150));
    $('#fPersonClr').addEventListener('click', () => { pcPick(''); inp.focus(); });
    document.addEventListener('pointerdown', (e) => { if (pcOpen && !e.target.closest('#fPersonBox')) { pcOpen = false; pcRender(); } });
  })();

  /** Блок «Долги» на вкладке «Финансы» (когда выбрано действие «Долг»). */
  function renderDebtBox() {
    const box = $('#debtBox'); if (!box || !meta) return;
    const on = isDebt(fAction); box.classList.toggle('hidden', !on); if (!on) { debtFilter = ''; return; }
    const D = debtLedger(), open = D.list.filter((o) => Math.abs(o.iOwe) > 0.004 || Math.abs(o.owed) > 0.004).sort((a, b) => (b.iOwe + b.owed) - (a.iOwe + a.owed));
    const closed = D.list.length - open.length;
    box.innerHTML = `<div class="w-head"><div class="lbl">Долги</div>${debtFilter ? '<button type="button" class="link small" data-dall>Все люди</button>' : ''}</div>
      <div class="kpis"><div class="kpi"><div class="k">Я должен</div><div class="v neg-ink">${money(D.iOwe)}</div></div><div class="kpi"><div class="k">Мне должны</div><div class="v">${money(D.owed)}</div></div></div>
      ${open.map((o) => `<button type="button" class="debt-row ${debtFilter === o.name ? 'on' : ''}" data-dp="${esc(o.name)}">
        <span class="debt-name">${esc(o.name)}${o.legacy ? ' <span class="muted small" title="Имя взято из комментария">·&nbsp;из комментария</span>' : ''}</span>
        ${o.iOwe > 0.004 ? `<span class="debt-amt neg">Я должен ${money(o.iOwe)}</span>` : ''}${o.owed > 0.004 ? `<span class="debt-amt pos">Мне должны ${money(o.owed)}</span>` : ''}
        ${o.iOwe < -0.004 || o.owed < -0.004 ? '<span class="debt-amt muted small">Переплата</span>' : ''}
      </button>`).join('') || '<p class="muted small" style="margin:0">Открытых долгов нет.</p>'}
      ${closed ? `<p class="muted small" style="margin:6px 0 0">Закрыто долгов: ${closed}</p>` : ''}`;
  }
  $('#debtBox').addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.dataset.dall != null) debtFilter = '';
    else if (b.dataset.dp != null) debtFilter = debtFilter === b.dataset.dp ? '' : b.dataset.dp;
    renderDebtBox(); renderFinanceRecent();
  });

  // ── Настройки → Финансы → Люди
  let plDraft = [];
  function plStartEdit() {
    if (!meta) return;
    plDraft = peopleCfg().map((p) => Object.assign({ orig: p.name }, p));
    // люди из записей, которых ещё нет в списке
    allPeople().forEach((n) => { if (!plDraft.some((p) => p.name === n)) plDraft.push({ name: n, orig: n, note: '', archived: false }); });
    renderPlEditor();
  }
  function renderPlEditor() {
    const L = debtLedger().list;
    $('#plEditor').innerHTML = plDraft.map((p, i) => { const o = L.find((x) => x.name.toLowerCase() === (p.orig || p.name).toLowerCase());
      return `<div class="pl-row ${p.archived ? 'archived' : ''}">
        <input type="text" data-pl="${i}" data-f="name" value="${esc(p.name)}" placeholder="Имя" aria-label="Имя">
        <input type="text" data-pl="${i}" data-f="note" value="${esc(p.note || '')}" placeholder="Заметка: телефон, кто это" aria-label="Заметка">
        <span class="pl-bal small">${o && o.iOwe > 0.004 ? `<span class="neg">−${money(o.iOwe)}</span>` : ''}${o && o.owed > 0.004 ? ` <span class="pos">+${money(o.owed)}</span>` : ''}</span>
        <button type="button" class="icon-btn sm" data-plarch="${i}" title="${p.archived ? 'Вернуть из архива' : 'В архив'}">${p.archived ? '↩' : '📦'}</button>
      </div>`; }).join('') || '<p class="muted small">Людей пока нет. Их можно добавить здесь или прямо в форме долга.</p>';
    // старые долги без имени: группы по комментарию
    const groups = {};
    view().finance.forEach((r) => { if (r[3] === meta.fin.DEBT && !String(r[10] || '').trim()) { const k = String(r[5] || '').trim(); if (k) groups[k] = (groups[k] || 0) + 1; } });
    const keys = Object.keys(groups);
    $('#plLegacy').innerHTML = keys.length ? `<div class="lbl" style="margin:0">Старые долги без имени</div>
      <p class="muted small">Сейчас имя берётся из комментария. Нажмите, чтобы закрепить его за человеком в таблице.</p>
      <div class="chips">${keys.map((k) => `<button type="button" class="chip" data-plassign="${esc(k)}">${esc(k)} · ${groups[k]}</button>`).join('')}</div>` : '';
  }
  $('#plEditor').addEventListener('input', (e) => { const i = e.target.dataset.pl, f = e.target.dataset.f; if (i != null && plDraft[i]) plDraft[i][f] = e.target.value; });
  $('#plEditor').addEventListener('click', (e) => { const b = e.target.closest('[data-plarch]'); if (!b) return; const p = plDraft[Number(b.dataset.plarch)]; p.archived = !p.archived; renderPlEditor(); });
  $('#plAdd').addEventListener('click', () => { plDraft.push({ name: '', orig: '', note: '', archived: false }); renderPlEditor(); $$('#plEditor [data-f="name"]').pop().focus(); });
  $('#plSave').addEventListener('click', (e) => withBusy(e.currentTarget, async () => {
    needOnline('людей');
    const items = plDraft.filter((p) => p.name.trim()).map((p) => ({ name: p.name.trim(), orig: p.orig || '', note: (p.note || '').trim(), archived: !!p.archived }));
    const r = await api('savePeople', { items });
    meta.config = r.config; store.set('lt_meta', meta);
    plStartEdit(); changed(); renderAll();
    toast(r.renamed ? `Сохранено ✓ · Переименовано записей: ${r.renamed}` : 'Люди сохранены ✓');
    if (r.renamed) sync(true);
  }));
  $('#plLegacy').addEventListener('click', (e) => withBusy(e.target.closest('button') || e.currentTarget, async () => {
    const b = e.target.closest('[data-plassign]'); if (!b) return;
    needOnline('людей');
    const r = await api('assignPerson', { person: b.dataset.plassign, comment: b.dataset.plassign });
    toast(`Привязано записей: ${r.updated} ✓`); await sync(true); plStartEdit();
  }));
  openSettingsHooks.push(plStartEdit);

  // ═════════════ План Корана: повторение и заучивание ═════════════
  // Мусхаф 604 страницы, 15 строк на странице. Джузы — по Мадинскому мусхафу.
  const LINES = 15;
  const JUZ_START = [1, 22, 42, 62, 82, 102, 121, 142, 162, 182, 201, 222, 242, 262, 282, 302, 322, 342, 362, 382, 402, 422, 442, 462, 482, 502, 522, 542, 562, 582];
  const juzOf = (p) => { let j = 1; JUZ_START.forEach((s, i) => { if (p >= s) j = i + 1; }); return j; };
  const juzPages = (j) => [JUZ_START[j - 1], j < 30 ? JUZ_START[j] - 1 : 604];
  const PLAN_DEFAULT = {
    rev: { method: 'cycle', days: 10, amount: 1, unit: 'juz', recent: 20, oldDays: 7 },
    memo: { on: false, amount: 5, unit: 'lines', order: 'forward', start: 1, pos: null, lastDone: '', lastTask: '' }
  };
  const planCfg = () => { const c = cfg().plan || {}; return { rev: Object.assign({}, PLAN_DEFAULT.rev, c.rev || {}), memo: Object.assign({}, PLAN_DEFAULT.memo, c.memo || {}) }; };
  /** Диапазоны страниц: [3,4,5,9] → «стр. 3–5, 9», целые джузы подписываются. */
  function pageRanges(list) {
    const s = [...new Set(list)].sort((a, b) => a - b), out = [];
    s.forEach((p) => { const r = out[out.length - 1]; if (r && p === r[1] + 1) r[1] = p; else out.push([p, p]); });
    return out;
  }
  function rangeText(r) {
    const [a, b] = r, ja = juzOf(a), jb = juzOf(b), full = juzPages(ja)[0] === a && juzPages(jb)[1] === b;
    const pages = a === b ? `стр. ${a}` : `стр. ${a}–${b}`;
    return full ? `${ja === jb ? `Джуз ${ja}` : `Джузы ${ja}–${jb}`} (${pages})` : pages;
  }
  /** Даты повторения по страницам: последняя до сегодняшнего дня и что повторено сегодня. */
  function pageDates() {
    const t = today(), KM = meta.kinds[1], KR = meta.kinds[2], prev = {}, todayRev = new Set(), memDate = {}, pre = hifzPre();
    pre.pages.forEach((p) => { if (pre.date) prev[p] = pre.date; });
    view().reading.forEach((r) => {
      if (r[2] !== KM && r[2] !== KR) return;
      let a = r[4] !== '' ? Number(r[4]) : null, b = r[5] !== '' ? Number(r[5]) : null;
      if (a == null && r[9] !== '') [a, b] = suraPages(Number(r[9]));
      if (a == null) return;
      for (let p = a; p <= b; p++) {
        if (r[2] === KM && (!memDate[p] || r[1] > memDate[p])) memDate[p] = r[1];
        if (r[1] < t) { if (!prev[p] || r[1] > prev[p]) prev[p] = r[1]; }
        else if (r[1] === t && r[2] === KR) todayRev.add(p);
      }
    });
    return { prev, todayRev, memDate };
  }
  /** Задание на повторение на сегодня. Берём заученные страницы, которые дольше всех не повторяли (при равенстве — по порядку мусхафа).
   *  Прочитанное заранее уже «свежее» и само уходит из следующих дней. */
  function revisionToday() {
    const P = planCfg().rev; if (P.method === 'off' || !meta) return null;
    const st = computeStats(ALL_FROM, today()), D = pageDates(), t = today();
    // выученное сегодня впервые — это не повторение
    const mem = [...st.memPages].filter((p) => !(D.memDate[p] === t && !D.prev[p])).sort((a, b) => a - b);
    if (!mem.length) return { empty: true };
    const oldest = (list, k) => list.slice().sort((a, b) => ((D.prev[a] || '') < (D.prev[b] || '') ? -1 : (D.prev[a] || '') > (D.prev[b] || '') ? 1 : a - b)).slice(0, Math.max(0, k));
    const memo = planCfg().memo;
    let portion = [], recent = [], k = 0, note = '';
    if (P.method === 'cycle') { k = Math.ceil(mem.length / Math.max(1, P.days)); note = `Весь заученный объём (${mem.length} стр.) за ${P.days} дн.`; }
    else if (P.method === 'fixed') { k = P.unit === 'juz' ? Math.round(P.amount * 20) : Math.round(P.amount); note = `${P.amount} ${P.unit === 'juz' ? 'джуз' : 'стр.'} в день`; }
    else if (P.method === 'ratio') { k = memo.unit === 'pages' ? memo.amount * LINES : memo.amount; note = `${memo.amount} ${memo.unit === 'pages' ? 'стр.' : 'строк'} заучивания → ${k} стр. повторения`; }
    if (P.method === 'sabqi') {
      // сабки: последние выученные страницы — каждый день; манзил: остальное по кругу за N дней
      recent = mem.slice().sort((a, b) => ((D.memDate[b] || '') > (D.memDate[a] || '') ? 1 : (D.memDate[b] || '') < (D.memDate[a] || '') ? -1 : b - a)).slice(0, Math.max(0, P.recent));
      const rest = mem.filter((p) => recent.indexOf(p) < 0);
      portion = oldest(rest, Math.ceil(rest.length / Math.max(1, P.oldDays)));
      note = `Сабки: ${recent.length} последних стр. каждый день · Манзил: остальное за ${P.oldDays} дн.`;
    } else portion = oldest(mem, Math.min(k, mem.length));
    const all = recent.concat(portion), done = all.filter((p) => D.todayRev.has(p));
    return { recent: pageRanges(recent), portion: pageRanges(portion), total: all.length, done: done.length, note, extra: [...D.todayRev].filter((p) => all.indexOf(p) < 0).length, pages: all };
  }
  // ── заучивание: позиция {p, l} — следующая строка, которую нужно выучить
  function memoOrder(order) {
    if (order === 'juz-back') { const out = []; for (let j = 30; j >= 1; j--) { const [a, b] = juzPages(j); for (let p = a; p <= b; p++) out.push(p); } return out; }
    return Array.from({ length: 604 }, (_, i) => i + 1);
  }
  function memoPos(M, mem) {
    const seq = memoOrder(M.order);
    let pos = M.pos && M.pos.p ? Object.assign({}, M.pos) : { p: Number(M.start) || seq[0], l: 1 };
    // пропускаем уже заученные страницы, если начинаем новую страницу
    let i = seq.indexOf(pos.p), guard = 0;
    while (pos.l === 1 && mem.has(pos.p) && guard++ < 604) { i++; if (i >= seq.length) return null; pos = { p: seq[i], l: 1 }; }
    return pos;
  }
  /** Задание на заучивание: с позиции — amount строк или страниц. */
  function memoToday() {
    const M = planCfg().memo; if (!M.on || !meta) return null;
    const st = computeStats(ALL_FROM, today()), seq = memoOrder(M.order), t = today();
    if (M.lastDone === t) return { done: true, text: M.lastTask };
    const pos = memoPos(M, st.memPages); if (!pos) return { finished: true };
    const parts = []; let left = M.unit === 'pages' ? M.amount * LINES : M.amount, p = pos.p, l = pos.l, i = seq.indexOf(p), guard = 0;
    const full = []; // страницы, которые будут выучены полностью
    while (left > 0 && guard++ < 700) {
      const take = Math.min(left, LINES - l + 1);
      parts.push({ p, a: l, b: l + take - 1 });
      if (l + take - 1 === LINES) full.push(p);
      left -= take; l += take;
      if (l > LINES) { i++; if (i >= seq.length) { p = null; break; } p = seq[i]; l = 1; while (st.memPages.has(p) && i < seq.length - 1) { i++; p = seq[i]; } }
    }
    const text = parts.map((x) => (x.a === 1 && x.b === LINES ? `стр. ${x.p}` : `стр. ${x.p}, строки ${x.a}–${x.b}`)).join(' · ');
    return { parts, full, next: p ? { p, l } : null, text, sura: surasOnPage(pos.p).filter((n) => suraBy(n).name).map((n) => `${n}. ${suraBy(n).name}`).join(', ') };
  }
  function revPlainText(R) {
    const parts = [];
    if (R.recent.length) parts.push(T('Сабки') + ': ' + R.recent.map((r) => T(rangeText(r))).join(', '));
    if (R.portion.length) parts.push((R.recent.length ? T('Манзил') + ': ' : '') + R.portion.map((r) => T(rangeText(r))).join(', '));
    return parts.join('\n');
  }
  /** Сохранить план (локально сразу, на сервер — через очередь, работает и без интернета). */
  function savePlan(plan) {
    meta.config = Object.assign({}, meta.config, { plan }); store.set('lt_meta', meta);
    enqueue('saveConfig', { key: 'plan', value: plan }, 'cfg|plan');
    if (settings.autoSend) scheduleFlush(800);
  }
  function memoDone() {
    const task = memoToday(); if (!task || !task.parts) return;
    const P = planCfg(), KM = meta.kinds[1];
    // в «Чтение» пишем только полностью выученные страницы — так карта хифза остаётся точной
    const ops = pageRanges(task.full).map(([a, b]) => enqueue('addReading', { date: today(), kind: KM, type: 'pages', from: a, to: b, repeats: 1, comment: 'План заучивания' }).id);
    const prevMemo = Object.assign({}, P.memo);
    P.memo.pos = task.next; P.memo.lastDone = today(); P.memo.lastTask = task.text;
    savePlan({ rev: P.rev, memo: P.memo });
    const u = pushUndo({ tab: 'quran', type: 'plan', prevMemo, ops, label: 'Заучивание: ' + task.text });
    toast('Выучено ✓ Завтра — дальше', false, u); renderAll();
  }
  function revDone(ranges) {
    const KR = meta.kinds[2], ops = [];
    ranges.forEach(([a, b]) => ops.push(enqueue('addReading', { date: today(), kind: KR, type: 'pages', from: a, to: b, repeats: 1, comment: 'План повторения' }).id));
    const u = pushUndo({ tab: 'quran', type: 'add', ops, del: 'deleteReading', label: 'Повторение: ' + ranges.map(rangeText).join(', ') });
    toast('Повторение отмечено ✓', false, u); renderAll(); if (settings.autoSend) scheduleFlush(1500);
  }
  function planHtml(compact) {
    if (!meta) return '';
    const R = revisionToday(), M = memoToday();
    if (!R && !M) return '';
    let h = '';
    if (R) {
      if (R.empty) h += `<div class="plan-part"><div class="plan-h">🔁 Повторение</div><p class="muted small">Пока нечего повторять: отметьте заученное в ⚙ → Коран или добавьте запись «Заучивание».</p></div>`;
      else {
        const TR = pageDates().todayRev, rem = R.recent.concat(R.portion).filter(([a, b]) => { for (let p = a; p <= b; p++) if (!TR.has(p)) return true; return false; });
        h += `<div class="plan-part"><div class="plan-h">🔁 Повторить сегодня <span class="plan-count ${R.done >= R.total ? 'ok' : ''}">${R.done} из ${R.total} стр.</span></div>
          ${R.recent.length ? `<div class="plan-line"><span class="muted small">Сабки:</span> ${R.recent.map(rangeText).join(', ')}</div>` : ''}
          ${R.portion.length ? `<div class="plan-line">${R.recent.length ? '<span class="muted small">Манзил:</span> ' : ''}<b>${R.portion.map(rangeText).join(', ')}</b></div>` : ''}
          ${compact ? '' : `<p class="muted small">${esc(R.note)}${R.extra ? ` · Сверх плана сегодня: ${R.extra} стр.` : ''}</p>`}
          <div class="row gap plan-btns">${R.done >= R.total ? '<div class="plan-ok">✓ На сегодня всё повторено</div>' : `<button type="button" class="btn small-btn primary grow" data-plan-rev>✓ Повторил${rem.length > 1 ? ' всё' : ''}</button>`}<button type="button" class="btn small-btn ghost" data-mopen="rev">📖 Открыть</button></div></div>`;
      }
    }
    if (M) {
      if (M.finished) h += `<div class="plan-part"><div class="plan-h">📗 Заучивание</div><div class="plan-ok">Весь Коран по плану выучен. Машаллах!</div></div>`;
      else if (M.done) h += `<div class="plan-part"><div class="plan-h">📗 Заучивание</div><div class="plan-ok">✓ Сегодня выучено: ${esc(M.text)}</div><p class="muted small">Завтра — следующая часть.</p></div>`;
      else h += `<div class="plan-part"><div class="plan-h">📗 Выучить сегодня</div><div class="plan-line"><b>${esc(M.text)}</b></div><div class="muted small">${esc(M.sura)}</div>
          <div class="row gap plan-btns"><button type="button" class="btn small-btn primary grow" data-plan-memo>✓ Выучил</button><button type="button" class="btn small-btn ghost grow" data-plan-later>Ещё не выучил</button><button type="button" class="btn small-btn ghost" data-mopen="memo">📖 Открыть</button></div></div>`;
    }
    return h;
  }
  function renderPlanBox() {
    const box = $('#planBox'); if (!box) return;
    const h = planHtml(false); box.classList.toggle('hidden', !h); box.innerHTML = h ? `<div class="w-head"><div class="lbl">План на сегодня</div><button type="button" class="link small" data-plan-settings>Настроить</button></div>${h}` : '';
  }
  document.addEventListener('click', (e) => {
    const b = e.target.closest('[data-plan-rev],[data-plan-memo],[data-plan-later],[data-plan-settings]'); if (!b) return;
    if (b.dataset.planRev != null) { const R = revisionToday(), D = pageDates(); revDone(pageRanges(R.pages.filter((p) => !D.todayRev.has(p)))); }
    else if (b.dataset.planMemo != null) memoDone();
    else if (b.dataset.planLater != null) toast('Хорошо — завтра будет то же самое задание. Повторяйте, пока не выучите');
    else { $('#openSettings').click(); const sec = $$('.set-sec').find((s) => s.querySelector('#plSaveQ')); if (sec) { sec.open = true; setTimeout(() => $('#planSettings').scrollIntoView({ behavior: 'smooth' }), 50); } }
  });

  $('#plTestQ').addEventListener('click', (e) => withBusy(e.currentTarget, async () => {
    if (!online && navigator.onLine === false) throw new Error('Нужен интернет');
    await api('tgQuranTest', {}); toast('Отправлено в Telegram ✓');
  }));
  // ── Настройки → Коран → План
  let pqDraft = null;
  function pqStartEdit() {
    if (!meta) return;
    pqDraft = JSON.parse(JSON.stringify(planCfg()));
    const R = pqDraft.rev, M = pqDraft.memo, n = cfg().notify || {};
    $('#pqMethod').value = R.method; $('#pqDays').value = R.days; $('#pqAmount').value = R.amount; $('#pqUnit').value = R.unit;
    $('#pqRecent').value = R.recent; $('#pqOldDays').value = R.oldDays;
    $('#pmOn').checked = !!M.on; $('#pmAmount').value = M.amount; $('#pmUnit').value = M.unit; $('#pmOrder').value = M.order; $('#pmStart').value = M.start || '';
    $('#pqRemOn').checked = !!(n.qrev && n.qrev.on); $('#pqRemTime').value = (n.qrev && n.qrev.time) || '06:00';
    $('#pmRemOn').checked = !!(n.qmemo && n.qmemo.on); $('#pmRemTime').value = (n.qmemo && n.qmemo.time) || '05:30';
    pqRender();
  }
  function pqRender() {
    const m = $('#pqMethod').value;
    $$('[data-pq]').forEach((el) => el.classList.toggle('hidden', el.dataset.pq.split(' ').indexOf(m) < 0));
    const st = meta ? computeStats(ALL_FROM, today()) : null, M = planCfg().memo;
    const memN = st ? st.memPages.size : 0;
    let info = '';
    if (m === 'cycle') { const d = Math.max(1, Number($('#pqDays').value) || 10); info = `Заучено ${memN} стр. → по ${Math.ceil(memN / d)} стр. (≈ ${(memN / d / 20).toFixed(1)} джуза) в день`; }
    if (m === 'ratio') { const a = Number($('#pmAmount').value) || M.amount, u = $('#pmUnit').value; info = `Сейчас: ${a} ${u === 'pages' ? 'стр.' : 'строк'} заучивания → ${u === 'pages' ? a * LINES : a} стр. повторения в день`; }
    if (m === 'sabqi') info = 'Сабак — новое, Сабки — недавно выученное (каждый день), Манзил — всё остальное по кругу.';
    $('#pqInfo').textContent = info;
    const pos = M.pos && M.pos.p ? `Следующее: стр. ${M.pos.p}, строка ${M.pos.l}` : 'Начнём с начала выбранного порядка';
    $('#pmPos').textContent = pos;
  }
  ['#pqMethod', '#pqDays', '#pmAmount', '#pmUnit'].forEach((s) => $(s).addEventListener('input', pqRender));
  $('#pmReset').addEventListener('click', () => { if (!confirmT('Начать заучивание заново с выбранной страницы? Уже выученное не пропадёт.')) return; const P = planCfg(); P.memo.pos = null; P.memo.lastDone = ''; savePlan(P); pqRender(); renderAll(); toast('Позиция сброшена'); });
  $('#plSaveQ').addEventListener('click', (e) => withBusy(e.currentTarget, async () => {
    const num = (s, a, b, d) => Math.min(b, Math.max(a, Number($(s).value) || d));
    const P = planCfg();
    const rev = { method: $('#pqMethod').value, days: num('#pqDays', 1, 60, 10), amount: Math.max(0.25, Number(String($('#pqAmount').value).replace(',', '.')) || 1), unit: $('#pqUnit').value,
      recent: num('#pqRecent', 1, 100, 20), oldDays: num('#pqOldDays', 1, 60, 7) };
    const startChanged = Number($('#pmStart').value || 0) !== Number(P.memo.start || 0) || $('#pmOrder').value !== P.memo.order;
    const memo = Object.assign({}, P.memo, { on: $('#pmOn').checked, amount: num('#pmAmount', 1, $('#pmUnit').value === 'pages' ? 20 : 300, 5), unit: $('#pmUnit').value, order: $('#pmOrder').value,
      start: Number($('#pmStart').value) || ($('#pmOrder').value === 'juz-back' ? 582 : 1) });
    if (startChanged) memo.pos = null;
    savePlan({ rev, memo });
    // напоминания о повторении и заучивании — в общих настройках напоминаний (их отправляет Telegram)
    const n = Object.assign({}, cfg().notify || {}, { qrev: { on: $('#pqRemOn').checked, time: $('#pqRemTime').value || '06:00' }, qmemo: { on: $('#pmRemOn').checked, time: $('#pmRemTime').value || '05:30' }, lang: LANG });
    if (online) { try { await saveConfig('notify', n); } catch (x) { toast(x.message, true); } }
    else { meta.config.notify = n; enqueue('saveConfig', { key: 'notify', value: n }, 'cfg|notify'); }
    pqStartEdit(); renderAll(); toast('План сохранён ✓');
  }));
  openSettingsHooks.push(pqStartEdit);

  // ═════════════ Финансы: подробности по нажатию и столбчатые графики ═════════════
  /** Записи периода со знаком (+ приход, − расход). Для одного счёта переводы — тоже приход/расход. */
  function finItems(from, to, acc) {
    const fin = meta.fin, out = [];
    view().finance.forEach((r) => {
      if (r[1] < from || r[1] > to) return;
      const amt = Number(r[2]) || 0, a = String(r[3] || ''), c = String(r[4] || '');
      if (a === fin.TRANSFER) {
        if (!acc) return;
        if (r[9] === acc) out.push({ id: r[0], d: r[1], s: amt, a, c: 'Перевод с ' + r[8], cm: r[5], acc: r[9], tr: 1 });
        else if (r[8] === acc) out.push({ id: r[0], d: r[1], s: -amt, a, c: 'Перевод на ' + r[9], cm: r[5], acc: r[8], tr: 1 });
        return;
      }
      if (acc && r[8] !== acc) return;
      const sg = flowSign(a, c); if (!sg) return;
      out.push({ id: r[0], d: r[1], s: sg * amt, a, c: c || a || 'Без категории', cm: r[5], acc: r[8], person: r[10] });
    });
    return out.sort((x, y) => (x.d < y.d ? 1 : x.d > y.d ? -1 : 0));
  }
  /** Корзины для графика: по дням, неделям (с понедельника) или месяцам. */
  function finBuckets(from, to, g) {
    const t = today(), end = to > t ? t : to;
    let start = from;
    if (from === ALL_FROM) { const f = view().finance.reduce((m, r) => (!m || r[1] < m ? r[1] : m), ''); start = f || end; }
    const keyOf = (d) => g === 'month' ? d.slice(0, 7) : g === 'week' ? addDays(d, -((new Date(d + 'T12:00').getDay() + 6) % 7)) : d;
    const keys = []; let d = start, guard = 0;
    while (d <= end && guard++ < 4000) { const k = keyOf(d); if (keys[keys.length - 1] !== k) keys.push(k); d = addDays(d, 1); }
    const lim = g === 'day' ? 31 : g === 'week' ? 26 : 24;
    return { keys: keys.slice(-lim), keyOf, cut: keys.length > lim };
  }
  const bucketLabel = (k, g) => g === 'month' ? (LANG === 'en' ? ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] : ['янв', 'фев', 'мар', 'апр', 'май', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'])[Number(k.slice(5, 7)) - 1]
    : String(Number(k.slice(8, 10)));
  const bucketTitle = (k, g) => g === 'month' ? `${k.slice(5, 7)}.${k.slice(0, 4)}` : g === 'week' ? `${ru(k)} — ${ru(addDays(k, 6))}` : ru(k);
  /** Вертикальные столбцы: расходы, приход или оба рядом. */
  function finBarsHtml(items, from, to, g, mode, uid0) {
    const B = finBuckets(from, to, g), inc = {}, exp = {};
    items.forEach((x) => { const k = B.keyOf(x.d); if (x.s > 0) inc[k] = (inc[k] || 0) + x.s; else exp[k] = (exp[k] || 0) - x.s; });
    const showI = mode !== 'exp', showE = mode !== 'inc';
    const max = Math.max(1, ...B.keys.map((k) => Math.max(showI ? inc[k] || 0 : 0, showE ? exp[k] || 0 : 0)));
    const lab = (i) => B.keys.length <= 12 || i % Math.ceil(B.keys.length / 8) === 0 || i === B.keys.length - 1;
    const tI = B.keys.reduce((t, k) => t + (inc[k] || 0), 0), tE = B.keys.reduce((t, k) => t + (exp[k] || 0), 0);
    const cols = B.keys.map((k, i) => `<button type="button" class="fb-col" data-fb="${uid0}" data-k="${k}" data-i="${inc[k] || 0}" data-e="${exp[k] || 0}" aria-label="${esc(bucketTitle(k, g))}">
      <span class="fb-bars">${showI ? `<i class="fb-in" style="height:${((inc[k] || 0) / max * 100).toFixed(1)}%"></i>` : ''}${showE ? `<i class="fb-ex" style="height:${((exp[k] || 0) / max * 100).toFixed(1)}%"></i>` : ''}</span>
      <span class="fb-l">${lab(i) ? bucketLabel(k, g) : ''}</span></button>`).join('');
    const avgN = Math.max(1, B.keys.length), per = g === 'day' ? 'в день' : g === 'week' ? 'в неделю' : 'в месяц';
    return `<div class="fb-chart" style="--n:${B.keys.length}">${cols}</div>
      <div class="fb-info" id="fbInfo${uid0}">${showE ? `<span><i class="fb-dot ex"></i>Расход ${money(tE)} · ${T('в среднем')} ${money(tE / avgN)} ${T(per)}</span>` : ''}${showI ? `<span><i class="fb-dot in"></i>Приход ${money(tI)}</span>` : ''}</div>
      ${B.cut ? `<p class="muted small" style="margin:4px 0 0">${T('Показаны последние')} ${B.keys.length}</p>` : ''}`;
  }
  document.addEventListener('click', (e) => {
    const c = e.target.closest('.fb-col'); if (!c) return;
    const box = document.getElementById('fbInfo' + c.dataset.fb); if (!box) return;
    c.parentNode.querySelectorAll('.fb-col.sel').forEach((x) => x.classList.remove('sel')); c.classList.add('sel');
    const W = (settings.dash.fb || {}), g = c.closest('[data-fbg]') ? c.closest('[data-fbg]').dataset.fbg : (W.g || 'day');
    const i = Number(c.dataset.i), x = Number(c.dataset.e);
    box.innerHTML = `<b>${esc(bucketTitle(c.dataset.k, g))}</b>${x ? `<span><i class="fb-dot ex"></i>Расход ${money(x)}</span>` : ''}${i ? `<span><i class="fb-dot in"></i>Приход ${money(i)}</span>` : ''}${!i && !x ? `<span class="muted">${T('Нет записей')}</span>` : ''}`;
  });

  // ── окно подробностей
  let fdState = null;
  function openFinDetail(st) {
    fdState = Object.assign({ all: false }, st);
    renderFinDetail();
    $('#finSheet').classList.remove('hidden'); lockScroll('fin'); $('#finSheet .sheet-panel').scrollTop = 0;
  }
  function closeFinDetail() { $('#finSheet').classList.add('hidden'); unlockScroll('fin'); }
  $('#fsClose').addEventListener('click', closeFinDetail);
  $('#finSheet').addEventListener('click', (e) => { if (e.target.id === 'finSheet') closeFinDetail(); });
  $('#finSheet').addEventListener('touchmove', (e) => { if (!e.target.closest('.sheet-panel')) e.preventDefault(); }, { passive: false });
  containScroll($('#finSheet .sheet-panel'));
  function groupBars(map, total, cls) {
    const rows = Object.entries(map).sort((a, b) => b[1].v - a[1].v), max = rows.length ? rows[0][1].v : 1;
    return rows.map(([k, o]) => `<button type="button" class="bar-row fd-row" data-fdcat="${esc(k)}"><span class="cat"><span class="ic">${o.ic}</span>${esc(k)}</span>
      <b>${money(o.v)} <span class="muted small">${total ? Math.round(o.v / total * 100) : 0}%</span></b><div class="bar ${cls || ''}"><i style="width:${(o.v / max * 100).toFixed(1)}%"></i></div></button>`).join('');
  }
  function renderFinDetail() {
    const S = fdState, fin = meta.fin, acc = S.acc != null ? S.acc : (settings.dash.account || '');
    const all = finItems(S.from, S.to, acc);
    let items = all, title = '', sign = 0;
    if (S.type === 'income') { items = all.filter((x) => x.s > 0); title = 'Приход'; sign = 1; }
    else if (S.type === 'expense') { items = all.filter((x) => x.s < 0); title = 'Расходы'; sign = -1; }
    else if (S.type === 'charity') { items = all.filter((x) => x.s < 0 && x.a === fin.EXPENSE && x.c === fin.CHARITY); title = '🤲 Хайр'; sign = -1; }
    else if (S.type === 'cat') { items = all.filter((x) => x.c === S.cat && (S.sign ? Math.sign(x.s) === S.sign : true)); title = S.cat; sign = S.sign || 0; }
    else if (S.type === 'balance') title = 'Остаток';
    else if (S.type === 'account') title = (accIcon(S.acc) + ' ' + S.acc);
    const per = S.from === ALL_FROM ? 'Всё время' : S.from === S.to ? ru(S.from) : ru(S.from) + ' — ' + ru(S.to);
    $('#fsTitle').textContent = T(title);
    const tIn = all.filter((x) => x.s > 0).reduce((t, x) => t + x.s, 0), tOut = -all.filter((x) => x.s < 0).reduce((t, x) => t + x.s, 0);
    let h = `<p class="muted small" style="margin:0 0 10px">${per}${acc && S.type !== 'account' ? ' · Счёт: ' + esc(acc) : ''}</p>`;
    if (S.type === 'balance' || S.type === 'account') {
      const b = accountBalances(S.from, S.to), names = S.type === 'account' ? [S.acc] : Object.keys(b.bal).filter((n) => !acc || n === acc);
      const open = names.reduce((t, n) => t + (b.open[n] || 0), 0), close = names.reduce((t, n) => t + (b.close[n] || 0), 0);
      const sg = (v) => `${v < 0 ? '−' : ''}${money(Math.abs(v))}`;
      h += `<div class="fd-sum">
        <div><span>${S.from === ALL_FROM ? 'Начальный остаток' : 'На начало периода'}</span><b>${sg(open)}</b></div>
        <button type="button" data-fdtype="income"><span>＋ Приход</span><b class="pos">${money(tIn)}</b></button>
        <button type="button" data-fdtype="expense"><span>− Расход</span><b>${money(tOut)}</b></button>
        <div class="fd-total"><span>${S.to >= today() ? 'Сейчас' : 'На ' + ru(S.to)}</span><b class="${close < 0 ? 'neg' : ''}">${sg(close)}</b></div></div>`;
      if (S.type === 'balance' && names.length > 1) {
        h += `<div class="lbl">По счетам</div>` + names.map((n) => `<button type="button" class="acc-row fd-acc" data-fdacc="${esc(n)}"><span class="ic">${accIcon(n)}</span><span class="acc-name">${esc(n)}</span><span class="acc-per muted small">${b.per[n] ? signed(b.per[n]) : ''}</span><b class="acc-bal ${(b.close[n] || 0) < 0 ? 'neg' : ''}">${sg(b.close[n] || 0)}</b></button>`).join('');
      }
      if (b.blank && S.type === 'balance') h += `<p class="muted small">${b.blank} ${T('записей без счёта не входят в остатки по счетам')}</p>`;
      if (S.type === 'account') h += `<button type="button" class="btn ghost block" data-fdfilter="${esc(S.acc)}" style="margin:8px 0">${settings.dash.account === S.acc ? 'Показать дашборд по всем счетам' : 'Показать весь дашборд только по этой карте'}</button>`;
    } else {
      const tot = items.reduce((t, x) => t + Math.abs(x.s), 0);
      h += `<div class="fd-big ${sign > 0 ? 'pos' : ''}">${money(tot)}</div><p class="muted small" style="margin:0 0 10px">${items.length} ${T('записей')}</p>`;
    }
    // по категориям
    const list = S.type === 'balance' || S.type === 'account' ? all : items;
    if (S.type !== 'cat') {
      const byIn = {}, byOut = {};
      list.forEach((x) => { const m = x.s > 0 ? byIn : byOut, k = x.c; (m[k] = m[k] || { v: 0, ic: x.tr ? '⇄' : icon(x.a, x.c) }).v += Math.abs(x.s); });
      const sIn = Object.values(byIn).reduce((t, o) => t + o.v, 0), sOut = Object.values(byOut).reduce((t, o) => t + o.v, 0);
      if (Object.keys(byOut).length && S.type !== 'income') h += `<div class="lbl">${S.type === 'expense' || S.type === 'charity' ? 'По категориям' : 'Расходы по категориям'}</div>` + groupBars(byOut, sOut);
      if (Object.keys(byIn).length && S.type !== 'expense' && S.type !== 'charity') h += `<div class="lbl">${S.type === 'income' ? 'Откуда' : 'Приход по категориям'}</div>` + groupBars(byIn, sIn, 'in');
      // по счетам
      if (!acc && S.type !== 'balance') {
        const byAcc = {}; list.forEach((x) => { const k = x.acc || 'Без счёта'; (byAcc[k] = byAcc[k] || { v: 0, ic: x.acc ? accIcon(x.acc) : '❔' }).v += Math.abs(x.s); });
        if (Object.keys(byAcc).length > 1) h += `<div class="lbl">По счетам</div>` + groupBars(byAcc, sIn + sOut).replace(/data-fdcat=/g, 'data-fdacc=');
      }
    }
    // по дням / неделям / месяцам
    const days = S.from === ALL_FROM ? 999 : daysBetween(S.from, S.to > today() ? today() : S.to) + 1;
    const g = S.g || (days > 120 ? 'month' : days > 40 ? 'week' : 'day');
    if (list.length && days > 1) {
      const mode = S.type === 'income' ? 'inc' : sign < 0 ? 'exp' : S.type === 'cat' ? (sign > 0 ? 'inc' : 'exp') : 'both';
      h += `<div class="w-head" style="margin-top:12px"><div class="lbl">${g === 'day' ? 'По дням' : g === 'week' ? 'По неделям' : 'По месяцам'}</div>
        <div class="seg fb-g"><button type="button" data-fdg="day" class="${g === 'day' ? 'on' : ''}">Дни</button><button type="button" data-fdg="week" class="${g === 'week' ? 'on' : ''}">Недели</button><button type="button" data-fdg="month" class="${g === 'month' ? 'on' : ''}">Месяцы</button></div></div>
        <div data-fbg="${g}">${finBarsHtml(list, S.from, S.to, g, mode, 'fd')}</div>`;
    }
    // записи
    const rows = (S.all ? list : list.slice(0, 30)).map((x) => `<div class="fd-item"><span class="ic">${x.tr ? '⇄' : icon(x.a, x.c)}</span>
      <span class="fd-main"><span>${esc(x.c)}${x.person ? ' · ' + esc(x.person) : ''}</span><span class="muted small">${ru(x.d)}${x.acc && !acc ? ' · ' + esc(x.acc) : ''}${x.cm ? ' · ' + esc(x.cm) : ''}</span></span>
      <b class="${x.s > 0 ? 'pos' : ''}">${x.s > 0 ? '+' : '−'}${money(Math.abs(x.s))}</b></div>`).join('');
    h += `<div class="lbl" style="margin-top:12px">Записи</div>${rows || '<p class="empty">Нет записей за период</p>'}`;
    if (!S.all && list.length > 30) h += `<button type="button" class="btn ghost block" data-fdall>${T('Показать все')} (${list.length})</button>`;
    $('#fsBody').innerHTML = h;
  }
  $('#fsBody').addEventListener('click', (e) => {
    const t = e.target.closest('button'); if (!t || !fdState) return;
    if (t.dataset.fdall != null) { fdState.all = true; renderFinDetail(); }
    else if (t.dataset.fdg) { fdState.g = t.dataset.fdg; renderFinDetail(); }
    else if (t.dataset.fdtype) openFinDetail(Object.assign({}, fdState, { type: t.dataset.fdtype, all: false }));
    else if (t.dataset.fdcat != null && fdState.type !== 'cat') openFinDetail(Object.assign({}, fdState, { type: 'cat', cat: t.dataset.fdcat, sign: fdState.type === 'income' ? 1 : fdState.type === 'expense' || fdState.type === 'charity' ? -1 : 0, all: false }));
    else if (t.dataset.fdacc != null && t.dataset.fdacc !== 'Без счёта') openFinDetail({ type: 'account', acc: t.dataset.fdacc, from: fdState.from, to: fdState.to });
    else if (t.dataset.fdfilter != null) { const n = t.dataset.fdfilter; settings.dash.account = settings.dash.account === n ? '' : n; saveSettings(); closeFinDetail(); renderStats(); }
  });
  // нажатия на дашборде: плитки «Приход», «Расходы», «Остаток», «Хайр», карты, категории
  $('#statsBody').addEventListener('click', (e) => {
    const k = e.target.closest('[data-fd]'); if (!k) return;
    const w = k.closest('[data-from]'), from = w ? w.dataset.from : periodRange(period)[0], to = w ? w.dataset.to : periodRange(period)[1];
    const st = { type: k.dataset.fd, from, to };
    if (k.dataset.fd === 'account') { st.acc = k.dataset.tacc; }
    if (k.dataset.fd === 'cat') { st.cat = k.dataset.cat; st.sign = Number(k.dataset.sign) || 0; }
    openFinDetail(st);
  });

  // ═════════════ Мусхаф: чтение Корана в приложении ═════════════
  // Точные страницы Мадинского мусхафа 1441 (KFGQPC V4): один шрифт на страницу, каждое слово — готовый глиф,
  // разметка строк — открытые данные QUL. Шрифт страницы скачивается один раз и дальше берётся с телефона.
  const MUSHAF_DATA_V = 1;
  const MFONT_PKG = 'https://cdn.jsdelivr.net/npm/@tlawat/mushaf-fonts-qpc-v4-tajweed@1.20260912.0/fonts/p';
  const MFONT_QUL = 'https://static-cdn.tarteel.ai/qul/fonts/quran_fonts/v4-tajweed/woff2/p';
  // стр. 328 QUL публикует только в формате woff
  const mFontUrls = (n) => n === 328 ? [MFONT_PKG + '328.woff', MFONT_QUL.replace('/woff2/', '/woff/') + '328.woff'] : [MFONT_PKG + n + '.woff2', MFONT_QUL + n + '.woff2'];
  const MTEXT_FONT = ['https://cdn.jsdelivr.net/npm/@quran.ws/text@0.1.0/data/UthmanicHafs-v-3.0.ttf'];
  const MCACHE = 'mytracker-mushaf';
  // цвета правил таджвида (палитра шрифта №0) и их названия
  const TJ_RULES = [
    { e: 3, c: '#b50000', t: 'Мадд лязим — 6 харакатов' },
    { e: 9, c: '#f40000', t: 'Мадд муттасыль / мунфасыль — 4–5' },
    { e: 4, c: '#ff7b00', t: 'Мадд при остановке — 2, 4 или 6' },
    { e: 5, c: '#ce9e00', t: 'Естественный мадд — 2' },
    { e: 6, c: '#09b000', t: 'Гунна' },
    { e: 7, c: '#3f48e6', t: 'Тафхим — твёрдые буквы' },
    { e: 8, c: '#2fadff', t: 'Калькаля' },
    { e: 'silent', c: '#a5a5a5', t: 'Непроизносимые буквы' }
  ];
  const MSET_DEFAULT = { kind: 'v4', tj: 'std', colors: {}, size: 100, keepLines: true, auto: true, secs: 50, autoKind: 0 };
  const MIN_SECS = 45;
  const mset = () => Object.assign({}, MSET_DEFAULT, settings.mushaf || {});
  const arDigits = (n) => String(n).replace(/\d/g, (d) => '٠١٢٣٤٥٦٧٨٩'[d]);
  let mData = { v4: null, text: null }, mLoading = {};
  async function mushafData(kind) {
    if (mData[kind]) return mData[kind];
    if (!mLoading[kind]) mLoading[kind] = fetch(`quran/${kind}.json?v=${MUSHAF_DATA_V}`).then((r) => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
      .then((d) => (mData[kind] = d)).catch((e) => { delete mLoading[kind]; throw e; });
    return mLoading[kind];
  }
  // ── шрифты страниц
  const mFonts = {}, mLoaded = new Set();
  function loadPageFont(n) {
    if (mFonts[n]) return mFonts[n];
    const ff = new FontFace('qv4p' + n, mFontUrls(n).map((u) => `url("${u}") format("${/\.woff2$/.test(u) ? 'woff2' : 'woff'}")`).join(', '), { display: 'block' });
    mFonts[n] = ff.load().then((f) => { document.fonts.add(f); mLoaded.add(n); mPalettes(); return f; }).catch((e) => { delete mFonts[n]; throw e; });
    return mFonts[n];
  }
  let mTextFont = null;
  function loadTextFont() {
    if (!mTextFont) {
      const ff = new FontFace('UthmanicHafs', MTEXT_FONT.map((u) => `url("${u}") format("truetype")`).join(', '), { display: 'swap' });
      mTextFont = ff.load().then((f) => { document.fonts.add(f); return f; }).catch((e) => { mTextFont = null; throw e; });
    }
    return mTextFont;
  }
  const isDark = () => { const t = document.documentElement.dataset.theme; return t ? t === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches; };
  /** Палитра таджвида: правило @font-palette-values для каждого загруженного шрифта страницы. */
  function paletteBody() {
    const S = mset(), dark = isDark(), ink = dark ? '#ececec' : '#1b1b1b', ov = ['14 transparent'];
    let base = dark ? 1 : 0;
    if (S.tj === 'alt') base = dark ? 1 : 2;
    if (S.tj === 'off') { base = dark ? 4 : 3; [0, 1, 2, 15, 3, 4, 5, 6, 7, 8, 9].forEach((e) => ov.push(`${e} ${ink}`)); }
    if (S.tj === 'custom') {
      TJ_RULES.forEach((r) => { const c = S.colors[r.e]; if (c) (r.e === 'silent' ? [1, 2, 15] : [r.e]).forEach((e) => ov.push(`${e} ${c}`)); });
    }
    return `base-palette: ${base}; override-colors: ${ov.join(', ')};`;
  }
  function mPalettes() {
    let el = $('#mPal'); if (!el) { el = document.createElement('style'); el.id = 'mPal'; document.head.appendChild(el); }
    const body = paletteBody();
    el.textContent = [...mLoaded].map((n) => `@font-palette-values --qp${n} { font-family: qv4p${n}; ${body} }`).join('\n');
  }
  // ── состояние читалки
  const MST = store.get('lt_mushaf', { page: 1 });
  let mPage = 1, mTask = null, mSeen = null, mOpen = false, mMarkKind = null;
  const saveMst = () => store.set('lt_mushaf', MST);
  function pageInfo(n) {
    const d = mData.v4; if (!d) return { suras: [], juz: juzOf(n) };
    const suras = surasOnPage(n);
    return { suras, juz: juzOf(n), names: suras.map((s) => d.names[s - 1]) };
  }
  /** Открыть мусхаф. task: {type:'rev', pages:[…]} | {type:'memo', parts:[{p,a,b}]} */
  async function openMushaf(opt) {
    opt = opt || {};
    mTask = opt.task || null;
    mPage = Math.min(604, Math.max(1, Number(opt.page) || MST.page || 1));
    mSeen = { a: mPage, b: mPage }; mMarkKind = null; mSec = 0; mRun = null;
    $('#mushaf').classList.remove('hidden'); lockScroll('mushaf'); mOpen = true;
    try { if (!history.state || !history.state.mushaf) history.pushState({ mushaf: 1 }, ''); } catch (e) {}
    $('#mGo').classList.add('hidden'); $('#mLegend').classList.add('hidden');
    await mRender();
  }
  function closeMushaf(fromHistory) {
    if (!mOpen) return;
    mOpen = false; $('#mushaf').classList.add('hidden');
    unlockScroll('mushaf');
    if (!fromHistory) { try { if (history.state && history.state.mushaf) history.back(); } catch (e) {} }
    mRun = null; renderMushafBar();
    if (settings.autoSend) scheduleFlush(1500);
  }
  window.addEventListener('popstate', () => { if (mOpen) closeMushaf(true); });
  function mGoPage(n) {
    n = Math.min(604, Math.max(1, n)); if (n === mPage) return;
    mPage = n; mSeen.a = Math.min(mSeen.a, n); mSeen.b = Math.max(mSeen.b, n);
    mSec = 0; mRender();
  }
  // ── автоучёт: страница, открытая дольше N секунд (не меньше 45), засчитывается сама
  let mSec = 0, mRun = null;
  const mAutoState = () => { let a = store.get('lt_mauto', null); if (!a || a.date !== today()) a = { date: today(), done: {} }; return a; };
  const mDone = (kind) => new Set((mAutoState().done[kind]) || []);
  function mAddDone(kind, pages) { const a = mAutoState(); const s = new Set(a.done[kind] || []); pages.forEach((p) => s.add(p)); a.done[kind] = [...s]; store.set('lt_mauto', a); }
  /** Какой вид записи даёт страница: страница задания на повторение — «Повторение», иначе — вид из настроек. */
  function mAutoKind(n) {
    if (!meta) return null;
    if (mTask && mTask.type === 'memo') return null; // во время заучивания страницы сами не засчитываются
    if (mTask && mTask.type === 'rev' && mTask.pages.indexOf(n) >= 0) return meta.kinds[2] || meta.kinds[0];
    return meta.kinds[Number(mset().autoKind) || 0] || meta.kinds[0];
  }
  function mCount(n) {
    const kind = mAutoKind(n); if (!kind || mDone(kind).has(n)) return;
    mAddDone(kind, [n]);
    // соседние страницы подряд — одна запись: пока она не отправлена, расширяем её
    const live = mRun && outbox.find((o) => o.key === mRun.key && !o.sending);
    if (live && mRun.kind === kind && mRun.date === today() && (n === mRun.b + 1 || n === mRun.a - 1)) { mRun.a = Math.min(mRun.a, n); mRun.b = Math.max(mRun.b, n); }
    else mRun = { key: 'mauto|' + uid(), kind, date: today(), a: n, b: n };
    enqueue('addReading', { date: today(), kind, type: 'pages', from: mRun.a, to: mRun.b, repeats: 1, comment: 'Мусхаф · авто' }, mRun.key);
    renderMTask(); mTick(true);
  }
  function mTick(paintOnly) {
    const btn = $('#mPgBtn'); if (!btn) return;
    const S = mset(), secs = Math.max(MIN_SECS, Number(S.secs) || 50), kind = mAutoKind(mPage);
    const on = S.auto && kind && mOpen, done = on && mDone(kind).has(mPage);
    if (!paintOnly && on && !done && document.visibilityState === 'visible' && !$('#mPage').classList.contains('wait') && $('#mPage .m-lines')) {
      mSec++; if (mSec >= secs) { mCount(mPage); return; }
    }
    btn.classList.toggle('done', !!done);
    btn.style.setProperty('--prog', on ? (done ? 100 : Math.min(100, mSec / secs * 100)) + '%' : '0%');
    btn.title = on ? (done ? T('Страница засчитана') : `${T('Засчитается через')} ${Math.max(0, secs - mSec)} ${T('сек.')}`) : '';
  }
  setInterval(() => { if (mOpen) mTick(); }, 1000);
  /** Размер шрифта: страница целиком помещается по ширине и, по возможности, по высоте. */
  function mFit() {
    const wrap = $('#mPageWrap'), W = Math.min(wrap.clientWidth - 16, 620), H = wrap.clientHeight - 16;
    let fs = W / 17.6;
    if (H > 200) fs = Math.min(fs, H / (15 * 1.92 + 0.9));
    return Math.max(10, fs);
  }
  async function mRender() {
    const S = mset(), n = mPage, box = $('#mPage');
    MST.page = n; saveMst();
    $('#mPgNum').textContent = n;
    $('#mNext').disabled = n >= 604; $('#mPrev').disabled = n <= 1;
    renderMTask();
    let d;
    try { d = await mushafData('v4'); } catch (e) { box.innerHTML = `<p class="m-msg">${T('Не удалось загрузить разметку мусхафа. Нужен интернет при первом открытии.')}</p>`; return; }
    const info = pageInfo(n);
    $('#mSura').textContent = info.suras.map((s) => `${s}. ${suraBy(s).name || d.names[s - 1]}`).join(' · ');
    $('#mInfo').textContent = `${T('Джуз')} ${info.juz} · ${T('стр.')} ${n}`;
    const hl = mHighlight(n);
    box.dataset.p = n; box.className = 'm-page ' + (S.kind === 'text' ? 'text' : 'v4');
    if (S.kind === 'text') return mRenderText(n, hl);
    const fs = mFit(); box.style.fontSize = fs + 'px';
    const page = d.pages[n - 1];
    const html = page.map((ln, i) => {
      const cls = hl.lines.has(i + 1) ? ' hl' : '';
      if (ln[0] === 0) return `<div class="m-head${cls}"><span class="ar">سُورَةُ ${esc(d.names[ln[1] - 1])}</span></div>`;
      if (ln[0] === 1) return `<div class="m-basm${cls}"><span class="ar">بِسۡمِ ٱللَّهِ ٱلرَّحۡمَٰنِ ٱلرَّحِيمِ</span></div>`;
      const g = ln[2], r = ln[3]; let k = 0, out = '';
      for (let j = 0; j < r.length; j += 3) { out += `<span data-a="${r[j]}:${r[j + 1]}">${g.slice(k, k + r[j + 2])}</span>`; k += r[j + 2]; }
      return `<div class="m-line${ln[1] ? ' c' : ''}${cls}" data-l="${i + 1}">${out}</div>`;
    }).join('');
    const ready = mLoaded.has(n);
    box.innerHTML = `<div class="m-lines${n <= 2 ? ' short' : ''}" style="font-family:qv4p${n};font-palette:--qp${n}">${html}</div>` + (ready ? '' : `<div class="m-loading">${T('Загрузка страницы…')}</div>`);
    box.classList.toggle('wait', !ready);
    if (!ready) {
      try { await loadPageFont(n); }
      catch (e) { if (mPage === n) box.innerHTML = `<p class="m-msg">${T('Страница ещё не скачана. Подключитесь к интернету или скачайте весь Коран заранее: ⚙ → Коран → Мусхаф.')}</p>`; return; }
      if (mPage !== n) return;
      box.classList.remove('wait'); const l = box.querySelector('.m-loading'); if (l) l.remove();
    }
    // соседние страницы — заранее, чтобы листалось без задержки
    [n + 1, n - 1, n + 2].forEach((p) => { if (p >= 1 && p <= 604) loadPageFont(p).catch(() => {}); });
  }
  async function mRenderText(n, hl) {
    const S = mset(), box = $('#mPage');
    let t; try { t = await mushafData('text'); } catch (e) { box.innerHTML = `<p class="m-msg">${T('Не удалось загрузить текст. Нужен интернет при первом открытии.')}</p>`; return; }
    if (mPage !== n) return;
    const d = mData.v4, page = t.pages[n - 1];
    const html = page.map((ln, i) => {
      const cls = hl.lines.has(i + 1) ? ' hl' : '';
      if (ln[0] === 0) return `<div class="m-head${cls}"><span class="ar">سُورَةُ ${esc(d.names[ln[1] - 1])}</span></div>`;
      if (ln[0] === 1) return `<div class="m-basm${cls}">بِسۡمِ ٱللَّهِ ٱلرَّحۡمَٰنِ ٱلرَّحِيمِ</div>`;
      const s = ln[2]; let out = '';
      for (let j = 0; j < s.length; j += 4) out += `<span data-a="${s[j]}:${s[j + 1]}">${esc(s[j + 2])}${s[j + 3] ? ` <span class="m-an">${arDigits(s[j + 1])}</span>` : ''}</span> `;
      return `<div class="m-line${ln[1] ? ' c' : ''}${cls}" data-l="${i + 1}">${out.trim()}</div>`;
    }).join('');
    box.classList.toggle('wrap', !S.keepLines);
    box.innerHTML = `<div class="m-lines${n <= 2 ? ' short' : ''}">${html}</div>`;
    loadTextFont().then(() => { if (mPage === n) mFitText(); }).catch(() => mFitText());
    mFitText();
  }
  /** Текстовый мусхаф: строки мусхафа сохраняются — шрифт подбирается под самую длинную строку; иначе текст переносится. */
  function mFitText() {
    const S = mset(), box = $('#mPage'), lines = box.querySelector('.m-lines'); if (!lines) return;
    const W = Math.min($('#mPageWrap').clientWidth - 16, 680), base = W / 17.4 * 1.15;
    if (!S.keepLines) { box.style.fontSize = (base * S.size / 100) + 'px'; return; }
    box.style.fontSize = '20px';
    let max = 0; lines.querySelectorAll('.m-line').forEach((l) => { l.style.width = 'max-content'; max = Math.max(max, l.scrollWidth); l.style.width = ''; });
    const fit = max ? 20 * W / (max + 22) : base; // + поля страницы (≈ 1 em)
    box.style.fontSize = Math.max(10, Math.min(fit, base * 1.6)) + 'px';
  }
  /** Что подсветить на странице: строки задания на заучивание. */
  function mHighlight(n) {
    const lines = new Set();
    if (mTask && mTask.type === 'memo') {
      // строки считаются как в плане заучивания: 15 строк на странице, по порядку сверху
      mTask.parts.filter((x) => x.p === n).forEach((x) => { for (let l = x.a; l <= x.b; l++) lines.add(l); });
    }
    return { lines };
  }
  function renderMTask() {
    const el = $('#mTask'), act = $('#mAct');
    if (mTask && mTask.type === 'rev') {
      const R = revisionToday(), D = pageDates();
      const left = R && R.pages ? R.pages.filter((p) => !D.todayRev.has(p)) : [];
      const i = mTask.pages.indexOf(mPage);
      el.innerHTML = `<b>🔁 ${T('Повторение')}:</b> ${mTask.pages.length ? pageRanges(mTask.pages).map((r) => T(rangeText(r))).join(', ') : ''}${i >= 0 ? ` · <span class="muted">${T('эта страница')} ${i + 1} ${T('из')} ${mTask.pages.length}</span>` : ''}`;
      el.classList.remove('hidden');
      const nextP = mTask.pages.find((p) => p > mPage);
      act.innerHTML = (left.length ? `<button type="button" class="btn primary grow" data-m="revdone">${T('✓ Повторил всё')}</button>` : `<div class="plan-ok">${T('✓ На сегодня всё повторено')}</div>`) +
        (nextP && nextP !== mPage + 1 ? `<button type="button" class="btn ghost" data-m="go" data-p="${nextP}">${T('К стр.')} ${nextP}</button>` : '');
      return;
    }
    if (mTask && mTask.type === 'memo') {
      const M = memoToday();
      el.innerHTML = `<b>📗 ${T('Выучить')}:</b> ${esc(T(mTask.text || ''))}`; el.classList.remove('hidden');
      act.innerHTML = M && !M.done && !M.finished ? `<button type="button" class="btn primary grow" data-m="memodone">${T('✓ Выучил')}</button><button type="button" class="btn ghost grow" data-m="later">${T('Ещё не выучил')}</button>` : `<div class="plan-ok">${T('✓ Сегодня выучено')}</div>`;
      return;
    }
    el.classList.add('hidden');
    const range = mSeen ? (mSeen.a === mSeen.b ? `${T('стр.')} ${mSeen.a}` : `${T('стр.')} ${mSeen.a}–${mSeen.b}`) : '';
    if (mMarkKind != null) {
      const K = meta ? meta.kinds : [];
      act.innerHTML = `<div class="m-mark"><div class="small">${T('Записать')} <b>${range}</b> ${T('как')}:</div><div class="chips select">${K.map((k, i) => `<button type="button" class="chip${i === mMarkKind ? ' on' : ''}" data-m="kind" data-k="${i}">${esc(k)}</button>`).join('')}</div>
        <div class="row gap"><button type="button" class="btn primary grow" data-m="save">${T('Сохранить')}</button><button type="button" class="btn ghost" data-m="cancel">${T('Отмена')}</button></div></div>`;
    } else {
      const k = mAutoKind(mPage), n = k ? mDone(k).size : 0;
      act.innerHTML = `<button type="button" class="btn ghost grow" data-m="mark">✓ ${T('Прочитал')}: ${range}</button>` +
        (mset().auto && n ? `<div class="m-auto muted small">${T('Засчитано сегодня')}: ${n} ${T('стр.')} (${esc(k)})</div>` : '');
    }
  }
  $('#mAct').addEventListener('click', (e) => {
    const b = e.target.closest('[data-m]'); if (!b) return;
    const m = b.dataset.m;
    if (m === 'revdone') { const R = revisionToday(), D = pageDates(); revDone(pageRanges(R.pages.filter((p) => !D.todayRev.has(p)))); renderMTask(); }
    else if (m === 'memodone') { memoDone(); renderMTask(); }
    else if (m === 'later') toast('Хорошо — завтра будет то же самое задание. Повторяйте, пока не выучите');
    else if (m === 'go') mGoPage(Number(b.dataset.p));
    else if (m === 'mark') { mMarkKind = Math.max(0, meta ? meta.kinds.indexOf(settings.quran.kind || meta.kinds[0]) : 0); renderMTask(); }
    else if (m === 'kind') { mMarkKind = Number(b.dataset.k); renderMTask(); }
    else if (m === 'cancel') { mMarkKind = null; renderMTask(); }
    else if (m === 'save') {
      const kind = meta.kinds[mMarkKind] || meta.kinds[0], already = mDone(kind), pages = [];
      for (let q = mSeen.a; q <= mSeen.b; q++) if (!already.has(q)) pages.push(q);
      if (!pages.length) { toast('Эти страницы уже засчитаны сегодня ✓'); mMarkKind = null; renderMTask(); return; }
      const rs = pageRanges(pages), ops = rs.map(([a, b]) => enqueue('addReading', { date: today(), kind, type: 'pages', from: a, to: b, repeats: 1, comment: 'Мусхаф' }).id);
      mAddDone(kind, pages); mTick(true);
      const txt = rs.map(([a, b]) => (a === b ? a : a + '–' + b)).join(', ');
      const u = pushUndo({ tab: 'quran', type: 'add', ops, del: 'deleteReading', label: `${kind}: ${T('стр.')} ${txt}` });
      toast(`${T('Записано')} ✓ ${kind}: ${txt}`, false, u);
      mMarkKind = null; mSeen = { a: mPage, b: mPage }; renderAll(); renderMTask();
      if (settings.autoSend) scheduleFlush(1500);
    }
  });
  // ── листание: как в бумажном мусхафе, следующая страница — слева
  $('#mNext').addEventListener('click', () => mGoPage(mPage + 1));
  $('#mPrev').addEventListener('click', () => mGoPage(mPage - 1));
  $('#mClose').addEventListener('click', () => closeMushaf());
  (function () {
    let x0 = null, y0 = 0, t0 = 0;
    const w = $('#mPageWrap');
    w.addEventListener('touchstart', (e) => { if (e.touches.length !== 1) { x0 = null; return; } x0 = e.touches[0].clientX; y0 = e.touches[0].clientY; t0 = Date.now(); }, { passive: true });
    w.addEventListener('touchend', (e) => {
      if (x0 == null) return; const t = e.changedTouches[0], dx = t.clientX - x0, dy = t.clientY - y0; x0 = null;
      if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.5 && Date.now() - t0 < 800) mGoPage(mPage + (dx > 0 ? 1 : -1));
    }, { passive: true });
  })();
  document.addEventListener('keydown', (e) => {
    if (!mOpen || /INPUT|SELECT|TEXTAREA/.test((e.target.tagName || ''))) return;
    if (e.key === 'ArrowLeft') mGoPage(mPage + 1); else if (e.key === 'ArrowRight') mGoPage(mPage - 1); else if (e.key === 'Escape') closeMushaf();
  });
  window.addEventListener('resize', () => { if (mOpen) mRender(); });
  // ── переход: страница, сура, джуз
  $('#mPgBtn').addEventListener('click', () => {
    const g = $('#mGo'); g.classList.toggle('hidden'); $('#mLegend').classList.add('hidden');
    if (!g.classList.contains('hidden')) {
      $('#mGoPage').value = mPage;
      if (!$('#mGoSura').options.length) {
        $('#mGoSura').innerHTML = `<option value="">${T('Сура…')}</option>` + Array.from({ length: 114 }, (_, i) => `<option value="${i + 1}">${i + 1}. ${esc(suraBy(i + 1).name || (mData.v4 ? mData.v4.names[i] : ''))}</option>`).join('');
        $('#mGoJuz').innerHTML = `<option value="">${T('Джуз…')}</option>` + JUZ_START.map((p, i) => `<option value="${p}">${T('Джуз')} ${i + 1}</option>`).join('');
      }
    }
  });
  $('#mGoBtn').addEventListener('click', () => { const v = Number($('#mGoPage').value); if (v) { $('#mGo').classList.add('hidden'); mSeen = { a: v, b: v }; mGoPage(v); } });
  $('#mGoSura').addEventListener('change', (e) => { const n = Number(e.target.value); if (n) { const p = suraPages(n)[0]; $('#mGo').classList.add('hidden'); mSeen = { a: p, b: p }; mGoPage(p); e.target.value = ''; } });
  $('#mGoJuz').addEventListener('change', (e) => { const p = Number(e.target.value); if (p) { $('#mGo').classList.add('hidden'); mSeen = { a: p, b: p }; mGoPage(p); e.target.value = ''; } });
  // ── быстрый выбор таджвида прямо в читалке
  function legendHtml() {
    const S = mset();
    const modes = [['std', 'Таджвид'], ['alt', 'Другие оттенки'], ['off', 'Без таджвида'], ['custom', 'Свои цвета']];
    const kinds = [['v4', 'Точные страницы'], ['text', 'Шрифт «Усмани»']];
    return `<div class="chips select">${kinds.map(([v, t]) => `<button type="button" class="chip${S.kind === v ? ' on' : ''}" data-mk="${v}">${T(t)}</button>`).join('')}</div>
      ${S.kind === 'v4' ? `<div class="chips select">${modes.map(([v, t]) => `<button type="button" class="chip${S.tj === v ? ' on' : ''}" data-mt="${v}">${T(t)}</button>`).join('')}</div>
      ${S.tj !== 'off' ? `<div class="tj-legend">${TJ_RULES.map((r) => `<span><i style="background:${(S.tj === 'custom' && S.colors[r.e]) || r.c}"></i>${T(r.t)}</span>`).join('')}</div>` : ''}` : `<p class="muted small">${T('В этом виде таджвида нет: обычный шрифт, зато его можно увеличить (⚙ → Коран → Мусхаф).')}</p>`}`;
  }
  $('#mTj').addEventListener('click', () => { const l = $('#mLegend'); l.innerHTML = legendHtml(); l.classList.toggle('hidden'); $('#mGo').classList.add('hidden'); });
  $('#mLegend').addEventListener('click', (e) => {
    const k = e.target.closest('[data-mk]'), t = e.target.closest('[data-mt]'); if (!k && !t) return;
    settings.mushaf = Object.assign(mset(), k ? { kind: k.dataset.mk } : { tj: t.dataset.mt }); saveSettings();
    mPalettes(); $('#mLegend').innerHTML = legendHtml(); mRender(); fillMushafSettings();
  });
  // тема поменялась — палитра тоже (тёмная тема: светлые буквы)
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', mPalettes);
  // ── вход: кнопка на вкладке «Коран», «План на сегодня», карта хифза
  function renderMushafBar() {
    const b = $('#mOpenBtn'); if (!b) return;
    b.innerHTML = `📖 ${T('Мусхаф')} <span class="muted small">· ${MST.page > 1 ? `${T('продолжить со стр.')} ${MST.page}` : T('открыть')}</span>`;
  }
  $('#mOpenBtn').addEventListener('click', () => openMushaf({ page: MST.page }));
  document.addEventListener('click', (e) => {
    const b = e.target.closest('[data-mopen]'); if (!b) return;
    const k = b.dataset.mopen;
    if (k === 'rev') { const R = revisionToday(), D = pageDates(); const left = R.pages.filter((p) => !D.todayRev.has(p)).sort((a, b) => a - b); const pages = R.pages.slice().sort((a, b) => a - b); openMushaf({ page: left[0] || pages[0], task: { type: 'rev', pages } }); }
    else if (k === 'memo') { const M = memoToday(); if (M && M.parts) openMushaf({ page: M.parts[0].p, task: { type: 'memo', parts: M.parts, text: M.text } }); }
    else openMushaf({ page: Number(k) });
  });
  // ── настройки: вид мусхафа, таджвид, свои цвета, скачивание для офлайна
  function fillMushafSettings() {
    const S = mset();
    if (!$('#msKind')) return;
    $('#msKind').value = S.kind; $('#msTj').value = S.tj; $('#msSize').value = S.size; $('#msKeep').checked = !!S.keepLines;
    $('#msSizeV').textContent = S.size + '%';
    $$('[data-ms]').forEach((el) => el.classList.toggle('hidden', el.dataset.ms.split(' ').indexOf(S.kind + (S.kind === 'v4' ? '-' + S.tj : '')) < 0 && el.dataset.ms.split(' ').indexOf(S.kind) < 0));
    $('#msColors').innerHTML = TJ_RULES.map((r) => `<label class="tj-color"><input type="color" data-tjc="${r.e}" value="${S.colors[r.e] || r.c}"><span>${T(r.t)}</span></label>`).join('') +
      `<button type="button" class="btn ghost block" id="msColorsReset">${T('Вернуть стандартные цвета')}</button>`;
    mDlInfo();
  }
  function msSave(patch) { settings.mushaf = Object.assign(mset(), patch); saveSettings(); mPalettes(); fillMushafSettings(); if (mOpen) mRender(); }
  $('#msKind').addEventListener('change', (e) => msSave({ kind: e.target.value }));
  $('#msTj').addEventListener('change', (e) => msSave({ tj: e.target.value }));
  $('#msSize').addEventListener('input', (e) => { $('#msSizeV').textContent = e.target.value + '%'; });
  $('#msSize').addEventListener('change', (e) => msSave({ size: Number(e.target.value) || 100 }));
  $('#msKeep').addEventListener('change', (e) => msSave({ keepLines: e.target.checked }));
  $('#msColors').addEventListener('input', (e) => { const k = e.target.dataset.tjc; if (!k) return; const c = Object.assign({}, mset().colors, { [k]: e.target.value }); settings.mushaf = Object.assign(mset(), { colors: c }); saveSettings(); mPalettes(); });
  $('#msColors').addEventListener('click', (e) => { if (e.target.id === 'msColorsReset') msSave({ colors: {} }); });
  $('#msOpen').addEventListener('click', () => { closeSettings(); openMushaf({ page: MST.page }); });
  // ── скачать весь Коран: 604 шрифта страниц (≈ 51 МБ), один раз
  async function mCachedPages() {
    if (!('caches' in window)) return new Set();
    try { const keys = await (await caches.open(MCACHE)).keys(), s = new Set(); keys.forEach((r) => { const m = /\/p(\d+)\.woff2?$/.exec(r.url); if (m) s.add(Number(m[1])); }); return s; } catch (e) { return new Set(); }
  }
  let mDl = null;
  async function mDlInfo() {
    const el = $('#msDlInfo'); if (!el) return;
    if (mDl) return;
    const s = await mCachedPages();
    el.textContent = s.size >= 604 ? T('Весь Коран скачан — читается без интернета ✓') : s.size ? `${T('Скачано страниц')}: ${s.size} ${T('из')} 604` : T('Страницы скачиваются, когда вы их открываете. Можно скачать всё сразу (≈ 51 МБ).');
    $('#msDl').classList.toggle('hidden', s.size >= 604); $('#msDel').classList.toggle('hidden', !s.size);
  }
  $('#msDl').addEventListener('click', async () => {
    if (mDl) { mDl.stop = true; return; }
    if (!('caches' in window)) { toast('Этот браузер не умеет хранить файлы для офлайна', true); return; }
    try { if (navigator.storage && navigator.storage.persist) navigator.storage.persist(); } catch (e) {}
    mDl = { stop: false }; $('#msDl').textContent = T('Остановить');
    const cache = await caches.open(MCACHE), have = await mCachedPages(), todo = [];
    for (let p = 1; p <= 604; p++) if (!have.has(p)) todo.push(p);
    let done = have.size, fail = 0;
    const one = async (p) => {
      for (const u of mFontUrls(p)) {
        try { const r = await fetch(u, { mode: 'cors' }); if (r.ok) { await cache.put(u, r); return; } } catch (e) {}
      }
      fail++;
    };
    const workers = Array.from({ length: 6 }, async () => { while (todo.length && !mDl.stop) { await one(todo.shift()); done++; $('#msDlInfo').textContent = `${T('Скачивание')}: ${done} ${T('из')} 604…`; } });
    await Promise.all(workers);
    const stopped = mDl.stop; mDl = null; $('#msDl').textContent = T('Скачать весь Коран');
    try { await mushafData('v4'); if (mset().kind === 'text') { await mushafData('text'); await loadTextFont(); } } catch (e) {}
    await mDlInfo();
    if (fail) toast(`${T('Не скачалось страниц')}: ${fail}. ${T('Нажмите ещё раз, когда будет интернет')}`, true);
    else if (!stopped) toast('Весь Коран скачан ✓');
  });
  $('#msDel').addEventListener('click', async () => {
    if (!confirmT('Удалить скачанные страницы мусхафа с телефона? Их можно будет скачать снова.')) return;
    try { await caches.delete(MCACHE); } catch (e) {}
    toast('Скачанные страницы удалены'); mDlInfo();
  });
  openSettingsHooks.push(fillMushafSettings);
  renderMushafBar();
  mPalettes();

  // ── отрисовка всего (без запросов)
  function renderAll() {
    renderPending();
    if (!meta) return;
    if (pDate) { const keep = activePrayer; showPrayerDayState(); activePrayer = keep; paintPrayers(); }
    renderPrayerRecent(); renderReadingRecent(); renderFinanceRecent(); renderQueue(); renderRecurBox(); updateBudgetHint(); renderDebtBox(); renderPerson(); renderPlanBox();
    if (currentTab === 'dash') renderStats();
  }
  /** Подтянуть состояние дня из данных, не сбрасывая выбранную молитву (после синхронизации). */
  function showPrayerDayState() {
    const r = view().prayers.get(pDate);
    PKEYS.forEach((k, i) => { pState[k] = r ? r[i + 1] || '' : ''; });
    if (document.activeElement !== $('#pComment')) setText($('#pComment'), r ? r[8] : '');
  }

  // ── запуск
  let uiReady = false;
  function initUi() {
    if (!meta) return;
    applyStatusColors(); renderPrayerRows(); renderReading(); renderFinance(); applyPrayerSettings();
    $('#rRecentTitle').textContent = `Последние ${DAYS.reading} дней`; $('#fRecentTitle').textContent = `Последние ${DAYS.finance} дней`;
    if (!uiReady) { uiReady = true; setType(settings.quran.type === 'suras' ? 'suras' : 'pages'); showPrayerDay(pDate || today()); } else paintPrayers();
    renderNowTile();
  }
  function renderSkeleton() {
    $('#prayerRows').innerHTML = '<div class="prayer-tabs">' + '<i class="sk sk-tab"></i>'.repeat(7) + '</div><div class="status-row" style="margin-top:12px">' + '<i class="sk sk-btn"></i>'.repeat(6) + '</div>';
    $('#fAction').innerHTML = '<i class="sk w100 sk-btn"></i>'; $('#rKind').innerHTML = '<i class="sk w100 sk-btn"></i>';
    ['#pRecent', '#rRecent', '#fRecent'].forEach((s) => { $(s).innerHTML = skeletonList(3); });
    $('#statsBody').innerHTML = skeletonStats();
  }
  async function boot() {
    showApp();
    const t = today();
    ['#rDate', '#fDate'].forEach((s) => { if (!$(s).value) $(s).value = t; });
    if (meta && srv) { initUi(); renderAll(); } else renderSkeleton();
    openTab(settings.startTab && settings.startTab !== 'last' ? settings.startTab : store.get('lt_tab', 'prayers'));
    await sync();                // если на сервере ничего не менялось — короткий ответ
    if (!uiReady) initUi();
    flush({ all: settings.autoSend });
  }

  // офлайн-запуск: сайт открывается без интернета
  if ('serviceWorker' in navigator && location.protocol === 'https:') {
    window.addEventListener('load', () => navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' }).then((r) => { try { r.update(); } catch (e) {} }).catch(() => {}));
    // новая версия service worker'а взяла управление — перезагрузить страницу один раз
    let swReloaded = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => { if (swReloaded || !hadController) return; swReloaded = true; safeReload(); });
  }
  var hadController = !!(navigator.serviceWorker && navigator.serviceWorker.controller);
  // ── автообновление: при открытии и при возврате в приложение проверяем version.json
  function safeReload() {
    // не перезагружать, пока человек печатает; записи из очереди хранятся на телефоне и не пропадут
    const a = document.activeElement;
    if (a && /INPUT|TEXTAREA|SELECT/.test(a.tagName) && a.value) { updPending = true; showUpdBanner(); return; }
    // защита от зацикливания: если после перезагрузки версия всё ещё старая (кэш GitHub), не перезагружаем снова минуту-другую
    try { const t = Number(sessionStorage.getItem('lt_upd_try') || 0); if (Date.now() - t < 120000) { showUpdBanner(); return; } sessionStorage.setItem('lt_upd_try', String(Date.now())); sessionStorage.setItem('lt_updated', SITE_VER); } catch (e) {}
    location.reload();
  }
  let updPending = false, updChecking = false, lastUpdCheck = 0;
  function showUpdBanner() {
    let b = $('#updBanner');
    if (!b) { b = document.createElement('button'); b.id = 'updBanner'; b.type = 'button'; b.className = 'upd-banner'; b.onclick = () => { try { sessionStorage.setItem('lt_updated', '1'); } catch (e) {} location.reload(); }; document.body.appendChild(b); }
    b.textContent = T('Доступно обновление — нажмите, чтобы обновить');
  }
  async function checkUpdate(manual) {
    if (updChecking || (!manual && Date.now() - lastUpdCheck < 15000)) return;
    updChecking = true; lastUpdCheck = Date.now();
    try {
      const r = await fetch('version.json?t=' + Date.now(), { cache: 'no-store' });
      if (r.ok) {
        const v = String((await r.json()).v || '');
        if (v && v !== SITE_VER) {
          try { const reg = navigator.serviceWorker && (await navigator.serviceWorker.getRegistration()); if (reg) await reg.update(); } catch (e) {}
          // свежие файлы — мимо кэша, затем перезагрузка
          try { const ks = await caches.keys(); await Promise.all(ks.filter((k) => /^mytracker-v/.test(k)).map((k) => caches.delete(k))); } catch (e) {}
          safeReload(); return 'new';
        }
        if (manual) toast(`Установлена последняя версия ${SITE_VER} ✓`);
        return 'same';
      }
    } catch (e) { if (manual) toast('Нет связи — проверить обновление не получилось', true); }
    finally { updChecking = false; }
  }
  window.addEventListener('load', () => setTimeout(() => checkUpdate(), 1500));
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') checkUpdate(); });
  window.addEventListener('online', () => checkUpdate());
  setInterval(() => { if (document.visibilityState === 'visible') checkUpdate(); }, 30 * 60000);
  $('#checkUpd').addEventListener('click', (e) => withBusy(e.currentTarget, async () => { try { sessionStorage.removeItem('lt_upd_try'); } catch (x) {} await checkUpdate(true); }));
  try { const u = sessionStorage.getItem('lt_updated'); if (u) { sessionStorage.removeItem('lt_updated'); setTimeout(() => toast(`Приложение обновлено до версии ${SITE_VER} ✓`), 800); } } catch (e) {}

  if (token) boot(); else showLogin();
})();
