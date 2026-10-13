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
    autoSend: true, theme: 'auto', startTab: 'last',
    prayer: { fill: 1, autoNext: true, showTile: true, days: 7 },
    quran: { kind: '', type: 'pages', continuePages: true, days: 10, fresh: 7, stale: 30 },
    finance: { currency: 'с', days: 10 },
    dash: { period: 'last', account: '', cards: {} }, wv: 0,
    widgets: []
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
  const ru = (s) => { if (!s) return ''; const [y, m, d] = String(s).split('-'); return d ? `${d}.${m}.${y}` : s; };
  const money = (n) => (Number(n) || 0).toLocaleString(LOC, { maximumFractionDigits: 2 });
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const isTmp = (id) => String(id).indexOf('tmp:') === 0;
  // новые сверху: по дате, затем неотправленные, затем по номеру
  const byNewest = (di) => (a, b) => (a[di] !== b[di] ? (a[di] < b[di] ? 1 : -1)
    : isTmp(a[0]) !== isTmp(b[0]) ? (isTmp(a[0]) ? -1 : 1) : (Number(b[0]) || 0) - (Number(a[0]) || 0));

  let toastTimer;
  function toast(msg, isErr) {
    const t = $('#toast');
    t.textContent = msg; t.className = 'toast show' + (isErr ? ' err' : '');
    clearTimeout(toastTimer); toastTimer = setTimeout(() => (t.className = 'toast'), 2600);
  }

  // ── сеть
  async function api(action, payload = {}) {
    if (!API || API.indexOf('PASTE_') === 0) throw new Error('Укажите API_URL в config.js');
    let res;
    try { res = await fetch(API, { method: 'POST', body: JSON.stringify(Object.assign({ action, token }, payload)) }); }
    catch (e) { const err = new Error('Нет связи с сервером'); err.offline = true; throw err; }
    let j;
    try { j = await res.json(); } catch (e) { const err = new Error('Сервер не ответил'); err.offline = true; throw err; }
    checkVersion(j.v);
    if (!j.ok) {
      if (j.error === 'AUTH') { logout(true); const err = new Error(j.message || 'Нужно войти'); err.auth = true; throw err; }
      throw new Error(j.error || 'Ошибка');
    }
    return j.data !== undefined ? j.data : j;
  }

  // ── версии сайта и сервера должны совпадать
  function banner(html, onClick) { const b = $('#banner'); b.innerHTML = html; b.classList.remove('hidden'); b.onclick = onClick || null; }
  function checkVersion(v) {
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
      <table class="mini hz-hist"><tr><th>Вид</th><th>Записей</th><th>Последний раз</th></tr>${rows}</table>`;
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
  const financeRow = (id, p) => [id, p.date, Number(p.amount), p.actionType, p.category || '', p.comment || '', '', '', p.account || '', p.toAccount || ''];
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
    };
    sent.forEach((o) => apply(o, false));
    outbox.forEach((o) => apply(o, true));
    viewCache = { prayers: pr, reading: rd, finance: fi, pending };
    return viewCache;
  }

  // ── очередь изменений
  function enqueue(op, p, key) {
    const ex = key && outbox.find((o) => o.key === key && !o.sending);
    if (ex) { ex.p = p; delete ex.err; } else outbox.push({ id: uid(), op, p, key });
    persist(); changed(); renderAll();
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
          if (head.op === 'addFinance') await api('addFinance', { items: batch.map((o) => Object.assign({ opId: o.id }, o.p)) });
          else await api(head.op, Object.assign({ opId: head.id }, head.p));
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
    updateTopSave();
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
  $('#openSettings').addEventListener('click', () => { updateHiddenInfo(); fillSettings(); pnStartEdit(); stStartEdit(); accStartEdit(); refStartEdit(); openSettingsHooks.forEach((f) => f()); renderWidgetSettings(); renderPending(); $('#settings').classList.remove('hidden'); });
  const openSettingsHooks = [];
  $('#closeSettings').addEventListener('click', () => $('#settings').classList.add('hidden'));
  $('#settings').addEventListener('click', (e) => { if (e.target.id === 'settings') $('#settings').classList.add('hidden'); });
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
      const k = activePrayer, wasEmpty = !pState[k];
      pState[k] = pState[k] === b.dataset.s ? '' : b.dataset.s;
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
  $$('.date-nav [data-shift]').forEach((b) => b.addEventListener('click', () => showPrayerDay(addDays(pDate, Number(b.dataset.shift)))));
  $('#pDate').addEventListener('change', () => { if ($('#pDate').value) showPrayerDay($('#pDate').value); });
  const fillStatus = () => meta.statuses[settings.prayer.fill] || meta.statuses[1];
  $('#pAllBest').addEventListener('click', () => { const st = fillStatus(); VK().forEach((k) => { if (!pState[k]) pState[k] = st; }); commitPrayer(); paintPrayers(); });
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
    onSwipe: (id) => { hide('prayers', id); renderPrayerRecent(); toast('Скрыто из списка'); }
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
      if (isTmp(rEditId)) { const o = opById(rEditId); if (o) { o.p = p; persist(); changed(); } }
      else enqueue('updateReading', Object.assign({ id: rEditId }, p), 'r|' + rEditId);
      toast('Запись обновлена ✓'); resetReadingForm(false);
    } else {
      if (p.type === 'suras') p.suras.forEach((n) => enqueue('addReading', Object.assign({}, p, { suras: [n] })));
      else enqueue('addReading', p);
      toast(p.type === 'suras' ? `Добавлено сур: ${p.suras.length} ✓` : 'Запись добавлена ✓'); resetReadingForm(true);
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
      if (o) { outbox = outbox.filter((x) => x !== o); persist(); changed(); toast('Неотправленная запись удалена'); }
      else { hide('reading', id); toast('Скрыто из списка'); }
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
    updateBudgetHint();
  }
  function setAction(a) {
    fAction = a; $$('#fAction button').forEach((x) => x.classList.toggle('on', x.dataset.v === a));
    if (!fAccTouched) fAccount = defaultAccount(a);
    renderCategories(); renderAccounts();
  }
  $('#fAction').addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) setAction(b.dataset.v); });
  $('#fCategory').addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return;
    fCategory = fCategory === b.dataset.v ? '' : b.dataset.v;
    $$('#fCategory button').forEach((x) => x.classList.toggle('on', x.dataset.v === fCategory));
    updateBudgetHint();
  });
  // Безопасный калькулятор: цифры и + - * / ( )
  function calc(expr) {
    const s = String(expr).replace(/,/g, '.').replace(/\s+/g, '');
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
    $('#fCalc').textContent = /[+\-*/]/.test(raw.replace(/^-/, '')) && !isNaN(v) ? `= ${money(v)} ${settings.finance.currency || 'с'}` : '';
  });
  function readFinanceForm() {
    const amount = calc($('#fAmount').value);
    if (!(amount > 0)) throw new Error('Введите сумму');
    if (!fAction) throw new Error('Выберите действие');
    if (fAction === meta.fin.DEBT && !fCategory) throw new Error('Выберите, какой это долг');
    if (!$('#fDate').value) throw new Error('Укажите дату');
    const tr = isTransfer(fAction);
    if (tr && (!fAccount || !fTo)) throw new Error('Для перевода выберите оба счёта');
    if (tr && fAccount === fTo) throw new Error('Счета перевода должны различаться');
    return { amount, actionType: fAction, category: tr ? meta.fin.BETWEEN : fCategory, date: $('#fDate').value, comment: $('#fComment').value.trim(),
      account: fAccount || '', toAccount: tr ? fTo : '' };
  }
  function resetFinanceForm() {
    fEdit = null; fRecur = null; $('#fEdit').classList.add('hidden'); $('#fSave').textContent = 'Добавить в список';
    $('#fAmount').value = ''; $('#fCalc').textContent = ''; setText($('#fComment'), '');
    fAccTouched = false; fAccount = defaultAccount(fAction); fTo = ''; renderAccounts();
  }
  function fillFinanceForm(it, label) {
    $('#fAmount').value = it.amount; $('#fCalc').textContent = '';
    fAccTouched = true; fAccount = it.account || ''; fTo = it.toAccount || '';
    setAction(it.actionType); fCategory = it.category || ''; renderCategories(); renderAccounts();
    $('#fDate').value = it.date; setText($('#fComment'), it.comment);
    $('#fEdit span').textContent = label; $('#fEdit').classList.remove('hidden');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
  $('#fEdit .link').addEventListener('click', () => { resetFinanceForm(); renderAll(); });
  $('#fSave').addEventListener('click', () => {
    let it;
    try { it = readFinanceForm(); } catch (e) { toast(e.message, true); return; }
    if (fEdit && fEdit.mode === 'saved') {
      enqueue('updateFinance', Object.assign({ id: fEdit.id }, it), 'f|' + fEdit.id);
      toast(`Запись №${fEdit.id} изменена ✓`); offlineNote(); if (settings.autoSend) flush();
    } else if (fEdit && fEdit.mode === 'queue') {
      const o = outbox.find((x) => x.id === fEdit.opId);
      if (o) { o.p = it; delete o.err; persist(); changed(); }
      toast('Изменено в списке');
    } else {
      if (fRecur) { it.recurId = fRecur.id; it.recurDue = fRecur.due; }
      enqueue('addFinance', it); toast(fRecur ? 'Платёж добавлен ✓' : `В списке: ${outbox.filter((o) => o.op === 'addFinance').length}`); budgetWarn(it);
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
    return `<div class="main"><div class="t">${esc(it.comment || (tr ? 'Перевод' : it.category) || it.actionType)} ${pend || ''}</div><div class="s">${sub}${acc ? ' · ' + acc : ''}</div></div>
      <div class="amt ${sign > 0 ? 'in' : ''}">${tr ? '⇄ ' : sign > 0 ? '+' : sign < 0 ? '−' : ''}${money(it.amount)}</div>`;
  }
  function renderQueue() {
    const q = outbox.filter((o) => o.op === 'addFinance');
    $('#queueBox').classList.toggle('hidden', !q.length);
    $('#fQueue').innerHTML = q.map((o) => swipeWrap(o.id, financeItemHtml(o.p,
      `${o.err ? '<b class="err-text">⚠ ' + esc(o.err) + '</b> · ' : ''}${ru(o.p.date)} · ${esc(o.p.actionType)}${o.p.category ? ' · ' + esc(o.p.category) : ''}`), 'Убрать',
      fEdit && fEdit.mode === 'queue' && fEdit.opId === o.id ? 'editing' : '')).join('');
    $('#queueTotal').textContent = q.length ? `${q.length} шт.` + (settings.autoSend ? (online ? ' · Уйдут в течение минуты' : ' · Уйдут, когда появится интернет') : '') : '';
  }
  swipeList($('#fQueue'), {
    onTap: (opId) => {
      const o = outbox.find((x) => x.id === opId); if (!o) return;
      fEdit = { mode: 'queue', opId }; fillFinanceForm(o.p, 'Изменение записи из списка'); $('#fSave').textContent = 'Сохранить в списке'; renderQueue();
    },
    onSwipe: (opId) => { outbox = outbox.filter((x) => x.id !== opId); persist(); changed(); if (fEdit && fEdit.mode === 'queue') resetFinanceForm(); renderAll(); toast('Убрано из списка'); }
  });
  function renderFinanceRecent() {
    if (!srv && !outbox.length) { $('#fRecent').innerHTML = skeletonList(3); return; }
    const from = addDays(today(), -(DAYS.finance - 1));
    const queued = new Set(outbox.filter((o) => o.op === 'addFinance').map((o) => 'tmp:' + o.id));
    const rows = view().finance.filter((r) => r[1] >= from && !queued.has(String(r[0])) && !isHidden('finance', r[0])).sort(byNewest(1));
    $('#fRecent').innerHTML = rows.length ? rows.map((r) => {
      const it = { amount: r[2], actionType: r[3], category: r[4], comment: r[5], account: r[8], toAccount: r[9] };
      return swipeWrap(r[0], financeItemHtml(it, `${isTmp(r[0]) ? '' : '№' + r[0] + ' · '}${ru(r[1])} · ${esc(r[3] || 'Без действия')}${r[4] ? ' · ' + esc(r[4]) : ''}`, pendMark('f:' + r[0])),
        null, fEdit && fEdit.mode === 'saved' && String(fEdit.id) === String(r[0]) ? 'editing' : '');
    }).join('') : `<p class="empty">За ${DAYS.finance} дней записей нет</p>`;
  }
  swipeList($('#fRecent'), {
    onTap: (id) => {
      if (isTmp(id)) { toast('Запись синхронизируется — попробуйте через несколько секунд'); return; }
      const r = view().finance.find((x) => String(x[0]) === String(id)); if (!r) return;
      fEdit = { mode: 'saved', id: r[0] };
      fillFinanceForm({ amount: r[2], actionType: r[3], category: r[4], date: r[1], comment: r[5], account: r[8], toAccount: r[9] }, `Редактирование записи №${r[0]}`);
      $('#fSave').textContent = 'Сохранить изменения'; renderFinanceRecent();
    },
    onSwipe: (id) => { hide('finance', id); if (fEdit && String(fEdit.id) === String(id)) resetFinanceForm(); renderFinanceRecent(); toast('Скрыто из списка'); }
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
  $$('#sPeriod button').forEach((x) => x.classList.toggle('on', x.dataset.p === period));
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
      if (c === fin.BORROWED) f.iOwe += amt; if (c === fin.REPAID) f.iOwe -= amt;
      if (c === fin.LENT) f.owedToMe += amt; if (c === fin.RETURNED) f.owedToMe -= amt;
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
  function catBars(obj, emptyText) {
    const cats = Object.entries(obj).sort((a, b) => b[1] - a[1]), maxCat = cats.length ? cats[0][1] : 1;
    return cats.length ? cats.map(([k, v]) => { const [c, a] = k.split('\u0000');
      return `<div class="bar-row"><span class="cat"><span class="ic">${icon(a, c)}</span>${esc(c)}</span><b>${money(v)}</b><div class="bar"><i style="width:${(v / maxCat * 100).toFixed(1)}%"></i></div></div>`; }).join('')
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
        return `<button type="button" class="kpi acc-tile ${accF === n ? 'on' : ''}" data-acctile="${esc(n)}" aria-pressed="${accF === n}">
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
        <div class="kpi"><div class="k">Приход</div><div class="v" style="color:var(--plus)">${money(f.income)}</div></div>
        <div class="kpi"><div class="k">Остаток</div><div class="v rest ${cls}">${bal < 0 ? '−' : ''}${money(Math.abs(bal))}</div><div class="note">${to >= today() ? 'На сегодня' : 'На ' + ru(to)} · За период ${signed(net)}</div></div>
        <div class="kpi"><div class="k">Расходы</div><div class="v">${money(f.expense)}</div></div>
        <div class="kpi"><div class="k">🤲 Хайр</div><div class="v" style="color:var(--gold)">${money(f.charity)}</div><div class="note">Входит в расходы</div></div>
      </div>`; } },
    'debts': { title: 'Долги и накопления', on: true, render: (s) => { const f = s.finance;
      return `<div class="kpis three">
        <div class="kpi"><div class="k">Я должен</div><div class="v">${money(f.iOwe)}</div></div>
        <div class="kpi"><div class="k">Мне должны</div><div class="v">${money(f.owedToMe)}</div></div>
        <div class="kpi"><div class="k">Накоплено</div><div class="v">${money(f.savings)}</div></div>
      </div>`; } },
    'fin-avg': { periodic: true, title: 'Средний расход в день и крупная трата', on: false, render: (s, from, to) => {
      const f = s.finance, start = from === ALL_FROM ? (f.firstDate || to) : from, end = to > today() ? today() : to;
      const days = Math.max(1, Math.round((new Date(end + 'T12:00') - new Date(start + 'T12:00')) / 864e5) + 1);
      return `<div class="kpis">
        <div class="kpi"><div class="k">В среднем в день</div><div class="v">${money(f.expense / days)}</div><div class="note">За ${days} дн.</div></div>
        <div class="kpi"><div class="k">Самая крупная трата</div><div class="v">${f.maxExp ? money(f.maxExp.amt) : '—'}</div><div class="note">${f.maxExp ? esc(f.maxExp.label) + ' · ' + ru(f.maxExp.date) : ''}</div></div>
      </div>`; } },
    'exp-cats': { periodic: true, title: 'Расходы по категориям', on: true, render: (s) => card('Расходы по категориям', catBars(s.finance.byCategory, 'Нет расходов за период')) },
    'inc-cats': { periodic: true, title: 'Приход по категориям', on: true, render: (s) => card('Приход по категориям', catBars(s.finance.inByCategory, 'Нет прихода за период')) },
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
  const DEFAULT_ORDER = ['goals', 'fin-kpi', 'acc-tiles', 'accounts', 'recurring', 'budgets', 'debts', 'fin-avg', 'exp-cats', 'inc-cats', 'prayer-matrix', 'prayer-streak', 'prayer-days', 'quran', 'hifz'];
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
        if (!own) return W.render(s, from, to);
        const [f2, t2] = periodRange(w.period), out = W.render(computeStats(f2, t2), f2, t2);
        return out ? `<div class="w-own"><div class="w-per">📅 ${PERIOD_TXT[w.period]}</div>${out}</div>` : '';
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
    $$('#statsBody [data-acctile]').forEach((b) => { b.onclick = () => { const n = b.dataset.acctile; settings.dash.account = settings.dash.account === n ? '' : n; saveSettings(); renderStats();
      if (settings.dash.account) toast(`Дашборд по счёту «${n}» · Нажмите ещё раз, чтобы показать все`); }; });
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
    $('#appVersion').textContent = `myTracker · Версия сайта ${APP_VERSION}` + (srv && srv.ver ? ` · Данные от ${new Date(Number(srv.ver) || 0).toLocaleString(LOC, { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}` : '');
  }
  $('#settings').addEventListener('change', (e) => {
    const el = e.target, path = el.dataset && el.dataset.set; if (!path) return;
    let v = el.type === 'checkbox' ? el.checked : el.value;
    if (el.hasAttribute('data-num')) v = Number(v);
    if (path === 'finance.currency') v = String(v).trim() || 'с';
    setPath(path, v); saveSettings();
    if (path === 'theme') applyTheme();
    if (path === 'quran.type' && !rEditId) setType(v);
    if (path === 'quran.kind' && meta && meta.kinds.indexOf(v) >= 0 && !rEditId) setKind(v);
    if (path === 'dash.period' && v !== 'last') { period = v; $$('#sPeriod button').forEach((x) => x.classList.toggle('on', x.dataset.p === period)); }
    applyPrayerSettings(); renderFinance(); changed(); renderAll();
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
    meta.config = r.config; if (r.tg) meta.tg = r.tg; store.set('lt_meta', meta);
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
      enqueue('addFinance', it); budgetWarn(it); toast(`«${r.name}» оплачено ✓`); offlineNote(); if (settings.autoSend) flush({ all: true });
    } else if (b.dataset.rcskip) {
      if (!confirmT(`Пропустить платёж «${r.name}» за ${ru(r.next)}? Следующий — ${ru(advanceDate(r.next, r.repeat, r.every, r.day))}.`)) return;
      enqueue('skipRecurring', { id: r.id, due: r.next }); toast('Платёж пропущен'); if (settings.autoSend) flush({ all: true });
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
    $('#rcForm').innerHTML = rcFormHtml(rcForm); $('#rcForm').classList.remove('hidden'); $('#rcAdd').classList.add('hidden');
    $('#rcForm').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }
  $('#rcList').addEventListener('click', (e) => { const b = e.target.closest('[data-rci]'); if (b) openRcForm(Number(b.dataset.rci)); });
  $('#rcAdd').addEventListener('click', () => { if (meta) openRcForm(-1); });
  $('#rcForm').addEventListener('change', (e) => {
    const f = e.target.dataset.rc; if (!f) return;
    rcForm[f] = e.target.type === 'checkbox' ? e.target.checked : e.target.value;
    if (f === 'action') { rcForm.category = ''; $('#rcForm').innerHTML = rcFormHtml(rcForm); }
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
      : Notification.permission === 'denied' ? 'Уведомления запрещены в настройках телефона для этого сайта.' : '';
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
  $('#ntLocal').addEventListener('change', async (e) => {
    if (!e.target.checked) { settings.notifyLocal = false; saveSettings(); return; }
    if (!canNotify() || (isIos() && !isStandalone())) { e.target.checked = false; ntStartEdit(); toast(isIos() ? 'Сначала добавьте myTracker на главный экран — подробности под переключателем' : 'Этот браузер не поддерживает уведомления', true); return; }
    const p = await Notification.requestPermission();
    settings.notifyLocal = p === 'granted'; saveSettings(); e.target.checked = settings.notifyLocal;
    if (p !== 'granted') toast('Разрешите уведомления для этого сайта в настройках телефона', true);
    else notifyNow('🔔 myTracker', T('Уведомления включены'));
    ntStartEdit();
  });
  $('#ntSave').addEventListener('click', (e) => withBusy(e.currentTarget, async () => {
    needOnline('напоминания');
    await saveConfig('notify', Object.assign({}, ntDraft, { lang: LANG }));
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
    notifyNow('🧪 myTracker', T('Тест: уведомления на этом телефоне работают'), 'test1');
    toast('Второе уведомление придёт через 1 минуту — сверните приложение, чтобы проверить работу в фоне');
    setTimeout(() => notifyNow('🧪 myTracker', T('Тест через минуту: уведомление пришло, пока приложение было в фоне'), 'test2'), 60000);
  });
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

  // ── отрисовка всего (без запросов)
  function renderAll() {
    renderPending();
    if (!meta) return;
    if (pDate) { const keep = activePrayer; showPrayerDayState(); activePrayer = keep; paintPrayers(); }
    renderPrayerRecent(); renderReadingRecent(); renderFinanceRecent(); renderQueue(); renderRecurBox(); updateBudgetHint();
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
    window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
  }

  if (token) boot(); else showLogin();
})();
