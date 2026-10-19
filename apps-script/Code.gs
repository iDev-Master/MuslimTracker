/**
 * myTracker — Молитвы · Коран · Финансы · Дашборды
 * Бэкенд на Google Apps Script для фронтенда на GitHub Pages.
 *
 * В этом файле НЕТ паролей. Пароль задаётся в «Настройки проекта → Свойства скрипта»:
 *   APP_PASSWORD — пароль для входа во фронтенд (обязательно).
 *   TG_TOKEN     — токен Telegram-бота для напоминаний (необязательно).
 * TOKEN_SECRET и SPREADSHEET_ID создаёт функция setup() автоматически.
 *
 * С версии 4 приложение загружает все данные одним запросом и считает дашборды на телефоне.
 * Сервер отвечает «без изменений», если в таблице ничего не менялось.
 */

// ───────────────────────────── Настройки ─────────────────────────────
var SERVER_BUILD = 12;         // растёт с каждым исправлением сервера; приложение проверяет его
var APP_VERSION = 6;            // должна совпадать с APP_VERSION в app.js

var CFG = {
  NIGHTLY_HOUR: 1,             // ночное обслуживание таблицы (час, по часовому поясу скрипта)
  TOKEN_TTL_DAYS: 30,          // сколько дней действует вход
  MAX_LOGIN_FAILS: 5,          // неудачных попыток до блокировки
  LOCK_MINUTES: 15,            // блокировка после неудачных попыток
  QURAN_PAGES: 604,            // страниц в мусхафе (Мадинский)
  MAX_BATCH: 100               // максимум записей в одной пачке
};

var SH = {
  PRAYERS: 'Молитвы',
  READING: 'Чтение',
  FINANCE: 'Финансы',
  DASH: 'Дашборды',
  TIMES: 'Времена молитв',
  REF: 'Справочник',
  ACCOUNTS: 'Счета',
  RECUR: 'Регулярные',
  CONFIG: 'Настройки'
};

var HEAD = {
  PRAYERS: ['Дата', 'Фаджр', 'Духа', 'Зухр', 'Аср', 'Магриб', 'Иша', 'Витр', 'Комментарий', 'Обновлено'],
  READING: ['ID', 'Дата', 'Вид', 'Тип', 'С стр.', 'По стр.', 'Страниц', 'Повторов', 'Итого стр.',
            '№ суры', 'Сура', 'Аятов', 'Итого аятов', 'Комментарий', 'Создано'],
  FINANCE: ['ID', 'Дата', 'Сумма', 'Действие', 'Категория', 'Комментарий', 'Создано', 'Поток ±', 'Счёт', 'На счёт', 'Человек'],
  RECUR: ['ID', 'Название', 'Сумма', 'Действие', 'Категория', 'Счёт', 'Повтор', 'Каждые', 'Следующая дата',
          'Авто', 'Напомнить за (дн.)', 'Активен', 'Комментарий', 'День'],
  CONFIG: ['Ключ', 'Значение (JSON)', 'Описание'],
  ACCOUNTS: ['Счёт / карта', 'Иконка', 'Начальный остаток', 'По умолчанию', 'Архив', '', 'Действие', 'Счёт по умолчанию'],
  TIMES: ['Ҳафта', 'Сана мелодӣ', 'Сана ҳиҷрӣ', 'Бомдод', 'Пешин', 'Аср', 'Вақти макрӯҳ', 'Шом', 'Хуфтан'],
  REF: ['Действие', 'Категория', 'Иконка', 'Поток', 'Статусы намаза', 'Вид чтения', '', '№ суры', 'Сура', 'Аятов']
};
// колонки листа «Справочник»
var REFC = { ACTION: 1, CATEGORY: 2, ICON: 3, FLOW: 4, STATUS: 5, KIND: 6, SURA_N: 8 };

var PRAYER_KEYS = ['fajr', 'duha', 'zuhr', 'asr', 'maghrib', 'isha', 'witr'];

// Поток денег: «Приход» увеличивает остаток, «Расход» уменьшает, «Нет» — не влияет.
var FLOW = { IN: 'Приход', OUT: 'Расход', NONE: 'Нет' };

var FIN = {
  EXPENSE: 'Расход', INCOME: 'Доход', DEBT: 'Долг', SAVING: 'Накопление', CHARITY: 'Хайр',
  BORROWED: 'Взял в долг', REPAID: 'Погасил свой долг', LENT: 'Дал в долг', RETURNED: 'Вернули мой долг',
  SAVED: 'Отложил', WITHDRAWN: 'Снял', TRANSFER: 'Перевод', BETWEEN: 'Между счетами'
};
var DEFAULT_FINANCE = [
  [FIN.EXPENSE, ['Еда', 'Транспорт', 'Семья / дом', FIN.CHARITY, 'Лечение / Лекарства', 'Себе (одежда, приятности и тд)',
                 'Моби', 'Спорт', 'Travel', 'Инвестирование', 'Не нужные расходы', 'Другое']],
  [FIN.INCOME, ['Зарплата', 'Доп. заработок', 'Хизматрасони', 'Подарок', 'Другое']],
  [FIN.DEBT, [FIN.BORROWED, FIN.REPAID, FIN.LENT, FIN.RETURNED]],
  [FIN.SAVING, [FIN.SAVED, FIN.WITHDRAWN]],
  [FIN.TRANSFER, [FIN.BETWEEN]]
];
var DEFAULT_ICONS = {
  'Еда': '🍽️', 'Транспорт': '🚕', 'Семья / дом': '🏠', 'Хайр': '🤲', 'Лечение / Лекарства': '💊',
  'Себе (одежда, приятности и тд)': '👕', 'Моби': '📱', 'Спорт': '⚽', 'Travel': '✈️', 'Инвестирование': '📈',
  'Не нужные расходы': '🗑️', 'Другое': '📦', 'Зарплата': '💼', 'Доп. заработок': '💡', 'Хизматрасони': '🛠️',
  'Подарок': '🎁', 'Взял в долг': '📥', 'Погасил свой долг': '✅', 'Дал в долг': '📤', 'Вернули мой долг': '↩️',
  'Отложил': '🐷', 'Снял': '💸', 'Между счетами': '🔁', 'Садака': '🤲', 'Закят': '🤲', 'Помощь родным': '🤝', 'Ойлик': '💼'
};
/** Поток по умолчанию: долги и накопления — по категории, остальное — по действию. */
function flowDefault_(action, category) {
  var byCat = {};
  byCat[FIN.BORROWED] = FLOW.IN; byCat[FIN.RETURNED] = FLOW.IN; byCat[FIN.WITHDRAWN] = FLOW.IN;
  byCat[FIN.REPAID] = FLOW.OUT; byCat[FIN.LENT] = FLOW.OUT; byCat[FIN.SAVED] = FLOW.OUT;
  if (byCat[category]) return byCat[category];
  if (action === FIN.INCOME) return FLOW.IN;
  if (action === FIN.EXPENSE) return FLOW.OUT;
  return FLOW.NONE;
}

var DEFAULTS = {
  statuses: ['Jamaah', 'Best time', 'Late', 'Qadho', 'Kafaraha', 'No data'],
  kinds: ['Чтение', 'Заучивание', 'Повторение']
};
// v1 → v2: старые «действия» превращаются в пару действие/категория
var LEGACY_ACTIONS = {
  'расход': [FIN.EXPENSE, null], 'доход': [FIN.INCOME, null], 'хайр': [FIN.EXPENSE, FIN.CHARITY],
  'карз додам': [FIN.DEBT, FIN.LENT], 'карза баргардонид': [FIN.DEBT, FIN.RETURNED],
  'ман карз гирифтам': [FIN.DEBT, FIN.BORROWED], 'ман карзама соф кардам': [FIN.DEBT, FIN.REPAID],
  'накопление+': [FIN.SAVING, FIN.SAVED], 'накопление-': [FIN.SAVING, FIN.WITHDRAWN],
  'накопление': [FIN.SAVING, FIN.SAVED]
};


var SURAS = [
  ['Al-Fatiha',7],['Al-Baqara',286],['Al Imran',200],['An-Nisa',176],['Al-Maida',120],['Al-Anam',165],
  ['Al-Araf',206],['Al-Anfal',75],['At-Tawba',129],['Yunus',109],['Hud',123],['Yusuf',111],['Ar-Rad',43],
  ['Ibrahim',52],['Al-Hijr',99],['An-Nahl',128],['Al-Isra',111],['Al-Kahf',110],['Maryam',98],['Ta-Ha',135],
  ['Al-Anbiya',112],['Al-Hajj',78],['Al-Muminun',118],['An-Nur',64],['Al-Furqan',77],['Ash-Shuara',227],
  ['An-Naml',93],['Al-Qasas',88],['Al-Ankabut',69],['Ar-Rum',60],['Luqman',34],['As-Sajda',30],
  ['Al-Ahzab',73],['Saba',54],['Fatir',45],['Ya-Sin',83],['As-Saffat',182],['Sad',88],['Az-Zumar',75],
  ['Ghafir',85],['Fussilat',54],['Ash-Shura',53],['Az-Zukhruf',89],['Ad-Dukhan',59],['Al-Jathiya',37],
  ['Al-Ahqaf',35],['Muhammad',38],['Al-Fath',29],['Al-Hujurat',18],['Qaf',45],['Adh-Dhariyat',60],
  ['At-Tur',49],['An-Najm',62],['Al-Qamar',55],['Ar-Rahman',78],['Al-Waqia',96],['Al-Hadid',29],
  ['Al-Mujadila',22],['Al-Hashr',24],['Al-Mumtahana',13],['As-Saff',14],['Al-Jumua',11],['Al-Munafiqun',11],
  ['At-Taghabun',18],['At-Talaq',12],['At-Tahrim',12],['Al-Mulk',30],['Al-Qalam',52],['Al-Haqqa',52],
  ['Al-Maarij',44],['Nuh',28],['Al-Jinn',28],['Al-Muzzammil',20],['Al-Muddaththir',56],['Al-Qiyama',40],
  ['Al-Insan',31],['Al-Mursalat',50],['An-Naba',40],['An-Naziat',46],['Abasa',42],['At-Takwir',29],
  ['Al-Infitar',19],['Al-Mutaffifin',36],['Al-Inshiqaq',25],['Al-Buruj',22],['At-Tariq',17],['Al-Ala',19],
  ['Al-Ghashiya',26],['Al-Fajr',30],['Al-Balad',20],['Ash-Shams',15],['Al-Layl',21],['Ad-Duha',11],
  ['Ash-Sharh',8],['At-Tin',8],['Al-Alaq',19],['Al-Qadr',5],['Al-Bayyina',8],['Az-Zalzala',8],
  ['Al-Adiyat',11],['Al-Qaria',11],['At-Takathur',8],['Al-Asr',3],['Al-Humaza',9],['Al-Fil',5],
  ['Quraysh',4],['Al-Maun',7],['Al-Kawthar',3],['Al-Kafirun',6],['An-Nasr',3],['Al-Masad',5],
  ['Al-Ikhlas',4],['Al-Falaq',5],['An-Nas',6]
];

// ───────────────────────────── Меню ─────────────────────────────
function onOpen() {
  SpreadsheetApp.getUi().createMenu('Трекер')
    .addItem('Настройка / обновление (setup)', 'setup')
    .addItem('Пересобрать дашборды', 'rebuildDashboard')
    .addItem('Выйти на всех устройствах', 'resetSessions')
    .addItem('Разрешить Telegram (authorize)', 'authorize')
    .addItem('Проверить напоминания', 'checkReminders')
    .addToUi();
}

// ───────────────────────────── Настройка и обновление ─────────────────────────────
/**
 * Запустите из редактора (▶ setup). Безопасно запускать повторно:
 * данные не удаляются, старая структура таблицы обновляется до новой.
 */
function setup() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var props = PropertiesService.getScriptProperties();
  props.setProperty('SPREADSHEET_ID', ss.getId());
  if (!props.getProperty('TOKEN_SECRET')) props.setProperty('TOKEN_SECRET', Utilities.getUuid() + Utilities.getUuid());
  ss.setSpreadsheetTimeZone(Session.getScriptTimeZone());

  // миграции — до записи новых заголовков
  var notes = migrateV1_(ss).concat(migrateV3_(ss), migrateV4_(ss), migrateV5_(ss));

  var pr = ensureSheet_(ss, SH.PRAYERS, HEAD.PRAYERS);
  var rd = ensureSheet_(ss, SH.READING, HEAD.READING);
  var fi = ensureSheet_(ss, SH.FINANCE, HEAD.FINANCE);
  var dash = ss.getSheetByName(SH.DASH) || ss.insertSheet(SH.DASH);
  var tm = ensureSheet_(ss, SH.TIMES, HEAD.TIMES, true);
  var ref = ensureSheet_(ss, SH.REF, HEAD.REF);
  fillReference_(ref);
  var acc = ensureSheet_(ss, SH.ACCOUNTS, HEAD.ACCOUNTS);
  if (acc.getLastRow() < 2) acc.getRange(2, 1, 1, 5).setValues([['Наличные', '💵', 0, 'да', '']]);
  if (!ss.getSheetByName(SH.RECUR)) notes.push('Добавлены листы «Регулярные» (платежи) и «Настройки». Их удобнее менять в приложении.');
  var rc = ensureSheet_(ss, SH.RECUR, HEAD.RECUR);
  var cf = ensureSheet_(ss, SH.CONFIG, HEAD.CONFIG);

  [SH.PRAYERS, SH.READING, SH.FINANCE, SH.DASH, SH.TIMES, SH.REF, SH.ACCOUNTS, SH.RECUR, SH.CONFIG].forEach(function (n, i) {
    ss.setActiveSheet(ss.getSheetByName(n)); ss.moveActiveSheet(i + 1);
  });
  ss.getSheets().forEach(function (s) {
    if (['Sheet1', 'Лист1', 'Лист 1'].indexOf(s.getName()) >= 0 && s.getLastRow() === 0) ss.deleteSheet(s);
  });

  formatPrayers_(pr);
  formatReading_(rd);
  formatFinance_(fi);
  formatTimes_(tm);
  formatReference_(ref);
  formatAccounts_(acc);
  formatRecurring_(rc);
  cf.setColumnWidth(1, 110); cf.setColumnWidth(2, 520); cf.setColumnWidth(3, 260);
  recomputeFlow_();
  buildDashboard_(dash);
  try { installNightly_(); } catch (e) { notes.push('Ночное обслуживание не включено: ' + e.message); }
  try { installNotifyTriggers_(); } catch (e) { notes.push('Напоминания не включены: ' + e.message); }
  bumpVersion_();

  var msg = 'Готово. Листы и дашборды настроены.' + (notes.length ? '\n\n' + notes.join('\n') : '') +
    (props.getProperty('APP_PASSWORD') ? '' : '\n\n⚠ Добавьте свойство APP_PASSWORD в «Настройки проекта → Свойства скрипта».');
  try { SpreadsheetApp.getUi().alert(msg); } catch (e) { Logger.log(msg); }
}

function rebuildDashboard() {
  buildDashboard_(SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SH.DASH));
}

/** Сменили пароль? Запустите — все старые входы станут недействительны. */
function resetSessions() {
  PropertiesService.getScriptProperties().setProperty('TOKEN_SECRET', Utilities.getUuid() + Utilities.getUuid());
  try { SpreadsheetApp.getUi().alert('Все устройства разлогинены.'); } catch (e) {}
}

/** v1 → v2: «Расходы» → «Финансы», новый «Справочник». */
function migrateV1_(ss) {
  var notes = [];
  var old = ss.getSheetByName('Расходы');
  if (old && !ss.getSheetByName(SH.FINANCE)) {
    old.setName(SH.FINANCE);
    var last = old.getLastRow(), changed = 0;
    if (last > 1) {
      var rng = old.getRange(2, 4, last - 1, 2), vals = rng.getValues();
      vals.forEach(function (r) {
        var m = LEGACY_ACTIONS[String(r[0]).trim().toLowerCase()];
        if (m) { r[0] = m[0]; if (m[1]) r[1] = m[1]; changed++; }
      });
      rng.setValues(vals);
    }
    notes.push('Лист «Расходы» переименован в «Финансы», обновлено записей: ' + changed + '.');
  }
  var ref = ss.getSheetByName(SH.REF);
  if (ref && String(ref.getRange(1, 1).getValue()) === 'Действия') {
    var oldName = 'Справочник (v1)';
    if (ss.getSheetByName(oldName)) ss.deleteSheet(ss.getSheetByName(oldName));
    ref.setName(oldName);
    notes.push('Старый справочник сохранён как «' + oldName + '» — его можно удалить.');
  }
  return notes;
}

/** v2 → v3: действие «Хайр» становится категорией «Хайр» у действия «Расход». */
function migrateV3_(ss) {
  var notes = [], fi = ss.getSheetByName(SH.FINANCE);
  if (fi && fi.getLastRow() > 1) {
    var rng = fi.getRange(2, 4, fi.getLastRow() - 1, 3), vals = rng.getValues(), n = 0;
    vals.forEach(function (r) {
      if (String(r[0]).trim().toLowerCase() !== FIN.CHARITY.toLowerCase()) return;
      var oldCat = String(r[1] || '').trim(), com = String(r[2] || '').trim();
      if (oldCat && oldCat !== FIN.CHARITY) r[2] = oldCat + (com ? ': ' + com : '');
      r[0] = FIN.EXPENSE; r[1] = FIN.CHARITY; n++;
    });
    if (n) { rng.setValues(vals); notes.push('Хайр: ' + n + ' записей переведено в «Расход → Хайр».'); }
  }
  var ref = ss.getSheetByName(SH.REF);
  if (ref && ref.getLastRow() > 1 && String(ref.getRange(1, 1).getValue()) === 'Действие') {
    var last = ref.getLastRow(), pr = ref.getRange(2, 1, last - 1, 3), pv = pr.getValues();
    var pairs = pv.filter(function (r) { return r[0] !== '' && String(r[0]).trim().toLowerCase() !== FIN.CHARITY.toLowerCase(); });
    var removed = pv.filter(function (r) { return r[0] !== ''; }).length - pairs.length;
    var hasCharity = pairs.some(function (r) { return r[0] === FIN.EXPENSE && r[1] === FIN.CHARITY; });
    if (!hasCharity && pairs.length) {
      var at = 0;
      pairs.forEach(function (r, i) { if (r[0] === FIN.EXPENSE) at = i + 1; });
      pairs.splice(at, 0, [FIN.EXPENSE, FIN.CHARITY, DEFAULT_ICONS[FIN.CHARITY]]);
    }
    pairs.forEach(function (r) { if (!r[2] && DEFAULT_ICONS[r[1]]) r[2] = DEFAULT_ICONS[r[1]]; });
    if (removed || !hasCharity || pv.some(function (r) { return r[0] !== '' && !r[2] && DEFAULT_ICONS[r[1]]; })) {
      var out = pairs.slice();
      while (out.length < pv.length) out.push(['', '', '']);
      pr.setValues(out.slice(0, pv.length).map(function (r) { return [r[0], r[1], r[2] || '']; }));
      if (pairs.length > pv.length) ref.getRange(2 + pv.length, 1, pairs.length - pv.length, 3).setValues(pairs.slice(pv.length));
      if (removed) notes.push('Справочник: действие «Хайр» убрано, «Хайр» теперь категория расхода.');
    }
  }
  return notes;
}

/** v3 → v4: колонка «Духа» в «Молитвах», колонка «Поток» в «Справочнике». */
function migrateV4_(ss) {
  var notes = [];
  var pr = ss.getSheetByName(SH.PRAYERS);
  if (pr && String(pr.getRange(1, 2).getValue()) === 'Фаджр' && String(pr.getRange(1, 3).getValue()) !== 'Духа') {
    pr.insertColumnAfter(2);
    pr.getRange(1, 3).setValue('Духа');
    notes.push('Молитвы: добавлена колонка «Духа».');
  }
  var ref = ss.getSheetByName(SH.REF);
  if (ref && String(ref.getRange(1, 4).getValue()) === 'Статусы намаза') {
    ref.insertColumnBefore(4);
    ref.getRange(1, 4).setValue('Поток');
    var last = ref.getLastRow();
    if (last > 1) {
      var v = ref.getRange(2, 1, last - 1, 4).getValues();
      ref.getRange(2, 4, last - 1, 1).setValues(v.map(function (r) {
        return [r[0] !== '' ? flowDefault_(String(r[0]).trim(), String(r[1]).trim()) : ''];
      }));
    }
    notes.push('Справочник: добавлена колонка «Поток» (Приход / Расход / Нет). Её можно менять в настройках приложения.');
  }
  var cache = ss.getSheetByName('_Кэш');
  if (cache) ss.deleteSheet(cache);
  return notes;
}

/** v4 → v5: действие «Перевод» (между своими счетами). Лист «Счета» создаёт setup(). */
function migrateV5_(ss) {
  var notes = [], ref = ss.getSheetByName(SH.REF);
  if (ref && ref.getLastRow() > 1 && String(ref.getRange(1, 1).getValue()) === 'Действие') {
    var a = ref.getRange(2, 1, ref.getLastRow() - 1, 1).getValues();
    var has = a.some(function (r) { return String(r[0]).trim() === FIN.TRANSFER; });
    var lastPair = 1; a.forEach(function (r, i) { if (r[0] !== '') lastPair = i + 2; });
    if (!has) {
      ref.getRange(lastPair + 1, 1, 1, 4).setValues([[FIN.TRANSFER, FIN.BETWEEN, '🔁', FLOW.NONE]]);
      notes.push('Финансы: добавлено действие «Перевод» — для переводов между своими счетами и картами.');
    }
  }
  if (!ss.getSheetByName(SH.ACCOUNTS)) notes.push('Добавлен лист «Счета». Счета и карты настраиваются в приложении: ⚙ → Финансы.');
  return notes;
}

function formatAccounts_(sh) {
  sh.getRange(2, 3, sh.getMaxRows() - 1, 1).setNumberFormat('#,##0.##');
  sh.getRange(1, 6).setValue('').setBackground(null);
  sh.setColumnWidth(1, 180); sh.setColumnWidth(2, 60); sh.setColumnWidth(3, 130); sh.setColumnWidth(4, 110);
  sh.setColumnWidth(5, 70); sh.setColumnWidth(6, 30); sh.setColumnWidth(7, 140); sh.setColumnWidth(8, 160);
  sh.getRange(1, 10).setValue('Удобнее редактировать в приложении: ⚙ → Финансы → Счета и карты.').setFontColor('#78909c').setFontStyle('italic');
}

function formatRecurring_(sh) {
  var rows = sh.getMaxRows() - 1;
  sh.getRange(2, 3, rows, 1).setNumberFormat('#,##0.##');
  sh.getRange(2, 9, rows, 1).setNumberFormat('dd.mm.yyyy');
  sh.getRange(2, 4, rows, 1).setDataValidation(listRule_(REFC.ACTION));
  sh.getRange(2, 5, rows, 1).setDataValidation(listRule_(REFC.CATEGORY));
  sh.getRange(2, 7, rows, 1).setDataValidation(SpreadsheetApp.newDataValidation()
    .requireValueInList([REPEAT.day, REPEAT.week, REPEAT.month, REPEAT.year], true).setAllowInvalid(false).build());
  [10, 12].forEach(function (c) { sh.getRange(2, c, rows, 1).setDataValidation(SpreadsheetApp.newDataValidation()
    .requireValueInList(['да', 'нет'], true).setAllowInvalid(true).build()); });
  sh.setColumnWidth(1, 40); sh.setColumnWidth(2, 180); sh.setColumnWidth(5, 160); sh.setColumnWidth(13, 220);
  sh.getRange(1, 16).setValue('Удобнее редактировать в приложении: ⚙ → Финансы → Регулярные платежи.').setFontColor('#78909c').setFontStyle('italic');
}

function ensureSheet_(ss, name, header, keepHeader) {
  var sh = ss.getSheetByName(name) || ss.insertSheet(name);
  var hr = sh.getRange(1, 1, 1, header.length);
  if (!keepHeader || sh.getRange(1, 1).getValue() === '') hr.setValues([header]);
  hr.setFontWeight('bold').setBackground('#263238').setFontColor('#ffffff').setWrap(true);
  sh.setFrozenRows(1);
  return sh;
}

function fillReference_(ref) {
  var empty = function (col) { return ref.getRange(2, col).getValue() === ''; };
  if (empty(REFC.ACTION)) {
    var pairs = [];
    DEFAULT_FINANCE.forEach(function (a) {
      a[1].forEach(function (c) { pairs.push([a[0], c, DEFAULT_ICONS[c] || '', flowDefault_(a[0], c)]); });
    });
    ref.getRange(2, REFC.ACTION, pairs.length, 4).setValues(pairs);
  }
  var col = function (c, values) {
    if (empty(c)) ref.getRange(2, c, values.length, 1).setValues(values.map(function (v) { return [v]; }));
  };
  col(REFC.STATUS, DEFAULTS.statuses);
  col(REFC.KIND, DEFAULTS.kinds);
  if (empty(REFC.SURA_N)) {
    ref.getRange(2, REFC.SURA_N, SURAS.length, 3).setValues(SURAS.map(function (s, i) { return [i + 1, s[0], s[1]]; }));
  }
}

function formatReference_(ref) {
  ref.getRange(1, 7).setValue('').setBackground(null);
  ref.getRange(2, REFC.FLOW, 300, 1).setDataValidation(SpreadsheetApp.newDataValidation()
    .requireValueInList([FLOW.IN, FLOW.OUT, FLOW.NONE], true).setAllowInvalid(false).build());
  ref.setColumnWidth(1, 120); ref.setColumnWidth(2, 220); ref.setColumnWidth(3, 60); ref.setColumnWidth(4, 80);
  ref.setColumnWidth(5, 120); ref.setColumnWidth(6, 110); ref.setColumnWidth(7, 30);
}

function listRule_(col) {
  var ref = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SH.REF);
  return SpreadsheetApp.newDataValidation()
    .requireValueInRange(ref.getRange(2, col, 300, 1), true).setAllowInvalid(true).build();
}

function formatPrayers_(sh) {
  var rows = sh.getMaxRows() - 1, n = PRAYER_KEYS.length;
  sh.getRange(2, 1, rows, 1).setNumberFormat('dd.mm.yyyy');
  sh.getRange(2, 2, rows, n).setDataValidation(listRule_(REFC.STATUS)).setHorizontalAlignment('center');
  sh.getRange(2, n + 3, rows, 1).setNumberFormat('dd.mm.yyyy hh:mm');
  var rng = sh.getRange(2, 2, rows, n), rules = [], ref = sh.getParent().getSheetByName(SH.REF);
  var names = ref && ref.getLastRow() > 1 ? ref.getRange(2, REFC.STATUS, 6, 1).getValues().map(function (r) { return String(r[0]).trim(); }) : DEFAULTS.statuses;
  names.forEach(function (s, i) {
    if (!s) return;
    rules.push(SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo(s)
      .setBackground(statusSheetColor_(i)).setRanges([rng]).build());
  });
  sh.setConditionalFormatRules(rules);
  sh.setColumnWidth(1, 95); sh.setColumnWidths(2, n, 90); sh.setColumnWidth(n + 2, 260);
}

function formatReading_(sh) {
  var rows = sh.getMaxRows() - 1;
  sh.getRange(2, 2, rows, 1).setNumberFormat('dd.mm.yyyy');
  sh.getRange(2, 3, rows, 1).setDataValidation(listRule_(REFC.KIND));
  sh.getRange(2, 15, rows, 1).setNumberFormat('dd.mm.yyyy hh:mm');
  sh.setColumnWidth(1, 50); sh.setColumnWidth(11, 120); sh.setColumnWidth(14, 240);
}

function formatFinance_(sh) {
  var rows = sh.getMaxRows() - 1;
  sh.getRange(2, 2, rows, 1).setNumberFormat('dd.mm.yyyy');
  sh.getRange(2, 3, rows, 1).setNumberFormat('#,##0.##');
  sh.getRange(2, 4, rows, 1).setDataValidation(listRule_(REFC.ACTION));
  sh.getRange(2, 5, rows, 1).setDataValidation(listRule_(REFC.CATEGORY));
  sh.getRange(2, 6, rows, 1).setWrap(true);
  sh.getRange(2, 7, rows, 1).setNumberFormat('dd.mm.yyyy hh:mm');
  sh.getRange(2, 8, rows, 1).setNumberFormat('+#,##0.##;-#,##0.##;0').setFontColor('#78909c');
  sh.setColumnWidth(1, 50); sh.setColumnWidth(4, 120); sh.setColumnWidth(5, 210); sh.setColumnWidth(6, 380);
  sh.getRange(1, 8).setNote('Заполняется автоматически: + приход, − расход (по колонке «Поток» в «Справочнике»).');
  var acc = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SH.ACCOUNTS);
  if (acc) sh.getRange(2, 9, rows, 2).setDataValidation(SpreadsheetApp.newDataValidation()
    .requireValueInRange(acc.getRange(2, 1, 100, 1), true).setAllowInvalid(true).build());
  sh.setColumnWidth(9, 130); sh.setColumnWidth(10, 130);
}

function formatTimes_(sh) {
  sh.setColumnWidths(1, 9, 110);
  var start = Math.max(2, sh.getLastRow() + 1);
  if (start <= sh.getMaxRows()) sh.getRange(start, 2, sh.getMaxRows() - start + 1, 8).setNumberFormat('@');
  sh.getRange(2, 2, sh.getMaxRows() - 1, 8).setHorizontalAlignment('center');
  sh.getRange(1, 11).setValue('Формат: дата 09.10.2026, время «04:59 - 06:25». Названия колонок можно менять — важен порядок.')
    .setFontColor('#78909c').setFontStyle('italic');
}

// ───────────────────────────── Поток денег (колонка H «Финансов») ─────────────────────────────
function flowMap_() {
  var map = {};
  refValues_(REFC.ACTION, 4).forEach(function (r) {
    var f = String(r[3]).trim();
    if (f) map[String(r[0]).trim() + '|' + String(r[1]).trim()] = f;
  });
  return map;
}
function flowOf_(map, action, category) {
  return map[action + '|' + category] || map[action + '|'] || flowDefault_(action, category);
}
function signed_(map, action, category, amount) {
  var f = flowOf_(map, action, category), a = Number(amount) || 0;
  return f === FLOW.IN ? a : f === FLOW.OUT ? -a : 0;
}
/** Пересчитывает «Поток ±» для всех строк (или для части). */
function recomputeFlow_(fromRow, count) {
  var sh = sheet_(SH.FINANCE), last = sh.getLastRow();
  if (last < 2) return;
  var start = Math.max(2, fromRow || 2), n = count ? Math.min(count, last - start + 1) : last - start + 1;
  if (n < 1) return;
  var map = flowMap_();
  var vals = sh.getRange(start, 1, n, 5).getValues();
  sh.getRange(start, 8, n, 1).setValues(vals.map(function (r) {
    return [r[0] === '' && r[2] === '' ? '' : signed_(map, String(r[3]).trim(), String(r[4]).trim(), r[2])];
  }));
}

// ───────────────────────────── Дашборды в таблице ─────────────────────────────
function buildDashboard_(d) {
  d.getCharts().forEach(function (c) { d.removeChart(c); });
  d.clear(); d.clearConditionalFormatRules();
  d.setHiddenGridlines(true);

  var F = "'" + SH.FINANCE + "'!", P = "'" + SH.PRAYERS + "'!", R = "'" + SH.READING + "'!";
  var period = function (dateCol) { return ',' + dateCol + ',">="&$B$3,' + dateCol + ',"<="&$B$4'; };
  var title = function (a1, text) { d.getRange(a1).setValue(text).setFontSize(13).setFontWeight('bold').setFontColor('#263238'); };
  var head = function (rng) { d.getRange(rng).setFontWeight('bold').setBackground('#eceff1'); };
  var sumCat = function (cat) { return 'SUMIF(' + F + 'E:E,"' + cat + '",' + F + 'C:C)'; };

  d.getRange('A1').setValue('Дашборды').setFontSize(18).setFontWeight('bold');
  d.getRange('A3:A4').setValues([['Период с'], ['по']]).setFontWeight('bold');
  d.getRange('B3').setFormula('=DATE(YEAR(TODAY()),MONTH(TODAY()),1)');
  d.getRange('B4').setFormula('=TODAY()');
  d.getRange('B3:B4').setNumberFormat('dd.mm.yyyy').setBackground('#fff8e1')
    .setDataValidation(SpreadsheetApp.newDataValidation().requireDate().build());
  d.getRange('C3').setValue('← впишите даты (по умолчанию — текущий месяц)').setFontColor('#78909c');

  title('A6', '💰 Финансы');
  var f = [
    ['Приход (период)', '=SUMIFS(' + F + 'H:H,' + F + 'H:H,">0"' + period(F + 'B:B') + ')'],
    ['Расходы (период)', '=-SUMIFS(' + F + 'H:H,' + F + 'H:H,"<0"' + period(F + 'B:B') + ')'],
    ['Остаток (период)', '=B7-B8'],
    ['Хайр (период, входит в расходы)', '=SUMIFS(' + F + 'C:C,' + F + 'D:D,"' + FIN.EXPENSE + '",' + F + 'E:E,"' + FIN.CHARITY + '"' + period(F + 'B:B') + ')'],
    ['Накопления (всё время)', '=' + sumCat(FIN.SAVED) + '-' + sumCat(FIN.WITHDRAWN)],
    ['Я должен (всё время)', '=' + sumCat(FIN.BORROWED) + '-' + sumCat(FIN.REPAID)],
    ['Мне должны (всё время)', '=' + sumCat(FIN.LENT) + '-' + sumCat(FIN.RETURNED)],
    ['Записей без действия', '=COUNTIFS(' + F + 'A2:A,"<>",' + F + 'D2:D,"")']
  ];
  d.getRange(7, 1, f.length, 1).setValues(f.map(function (r) { return [r[0]]; }));
  d.getRange(7, 2, f.length, 1).setFormulas(f.map(function (r) { return [r[1]]; }));
  d.getRange('B7:B13').setNumberFormat('#,##0.## "с"');
  d.getRange('A9:B9').setFontWeight('bold');
  var rest = d.getRange('B9');
  d.setConditionalFormatRules([
    SpreadsheetApp.newConditionalFormatRule().whenNumberLessThan(0).setFontColor('#c62828').setRanges([rest]).build(),
    SpreadsheetApp.newConditionalFormatRule().whenNumberGreaterThan(0).setFontColor('#2e7d32').setRanges([rest]).build()
  ]);

  title('D6', 'Расходы по категориям (период)');
  d.getRange('D7').setFormula(
    '=IFERROR(QUERY(' + F + 'A2:H,"select E, sum(C) where H < 0 and B >= date \'"&TEXT($B$3,"yyyy-mm-dd")&"\' and B <= date \'"&TEXT($B$4,"yyyy-mm-dd")&"\' group by E order by sum(C) desc label E \'Категория\', sum(C) \'Сумма\'",0),"Нет расходов за период")');
  head('D7:E7');
  d.getRange('E8:E30').setNumberFormat('#,##0.##');

  title('G6', 'По месяцам (12 мес.)');
  d.getRange('G7:J7').setValues([['Месяц', 'Приход', 'Расходы', 'из них ' + FIN.CHARITY]]); head('G7:J7');
  var m = [];
  for (var i = 0; i < 12; i++) {
    var r = 8 + i, rng = ',' + F + 'B:B,">="&$G' + r + ',' + F + 'B:B,"<"&EDATE($G' + r + ',1)';
    m.push(['=EDATE(DATE(YEAR(TODAY()),MONTH(TODAY()),1),' + (i - 11) + ')',
      '=SUMIFS(' + F + 'H:H,' + F + 'H:H,">0"' + rng + ')',
      '=-SUMIFS(' + F + 'H:H,' + F + 'H:H,"<0"' + rng + ')',
      '=SUMIFS(' + F + 'C:C,' + F + 'D:D,"' + FIN.EXPENSE + '",' + F + 'E:E,"' + FIN.CHARITY + '"' + rng + ')']);
  }
  d.getRange(8, 7, 12, 4).setFormulas(m);
  d.getRange('G8:G19').setNumberFormat('mmm yyyy');
  d.getRange('H8:J19').setNumberFormat('#,##0');

  // Молитвы: B..H = Фаджр, Духа, Зухр, Аср, Магриб, Иша, Витр; фарз = B, D, E, F, G
  var p0 = 32;
  title('A' + p0, '🕌 Молитвы (период)');
  var ph = ['Статус', 'Фаджр', 'Духа', 'Зухр', 'Аср', 'Магриб', 'Иша', 'Витр', 'Всего (5 фарз)'];
  d.getRange(p0 + 1, 1, 1, ph.length).setValues([ph]); head('A' + (p0 + 1) + ':I' + (p0 + 1));
  var cols = ['B', 'C', 'D', 'E', 'F', 'G', 'H'];
  var STS = statuses_();
  var prow = STS.map(function (s, k) {
    var r = p0 + 2 + k, row = [s];
    cols.forEach(function (c) { row.push('=COUNTIFS(' + P + c + ':' + c + ',$A' + r + period(P + 'A:A') + ')'); });
    row.push('=B' + r + '+D' + r + '+E' + r + '+F' + r + '+G' + r);
    return row;
  });
  d.getRange(p0 + 2, 1, prow.length, 1).setValues(prow.map(function (r) { return [r[0]]; }));
  d.getRange(p0 + 2, 2, prow.length, 8).setFormulas(prow.map(function (r) { return r.slice(1); }));
  STS.forEach(function (s, k) { d.getRange(p0 + 2 + k, 1).setBackground(statusSheetColor_(k)); });
  var first = p0 + 2, last = p0 + 1 + STS.length, okRow = last + 1;
  d.getRange(okRow, 1).setValue('% вовремя (' + STS[0] + ' + ' + STS[1] + ')').setFontWeight('bold');
  d.getRange(okRow, 2, 1, 8).setFormulas([['B', 'C', 'D', 'E', 'F', 'G', 'H', 'I'].map(function (c) {
    return '=IFERROR((' + c + first + '+' + c + (first + 1) + ')/(SUM(' + c + first + ':' + c + last + ')-' + c + last + '),"—")';
  })]).setNumberFormat('0%').setFontWeight('bold');
  d.getRange(okRow + 1, 1, 2, 1).setValues([[STS[3] + ' всего (всё время)'], ['Дней заполнено (период)']]);
  d.getRange(okRow + 1, 2).setFormula('=COUNTIF(' + P + 'B2:H,"' + STS[3] + '")');
  d.getRange(okRow + 2, 2).setFormula('=COUNTIFS(' + P + 'A2:A,">="&$B$3,' + P + 'A2:A,"<="&$B$4)');

  var r0 = 48;
  title('A' + r0, '📖 Коран (период)');
  d.getRange(r0 + 1, 1, 1, 4).setValues([['Вид', 'Записей', 'Страниц (с повторами)', 'Аятов (с повторами)']]);
  head('A' + (r0 + 1) + ':D' + (r0 + 1));
  var rrows = DEFAULTS.kinds.map(function (k, i) {
    var r = r0 + 2 + i;
    return [k, '=COUNTIFS(' + R + 'C:C,$A' + r + period(R + 'B:B') + ')',
      '=SUMIFS(' + R + 'I:I,' + R + 'C:C,$A' + r + period(R + 'B:B') + ')',
      '=SUMIFS(' + R + 'M:M,' + R + 'C:C,$A' + r + period(R + 'B:B') + ')'];
  });
  d.getRange(r0 + 2, 1, 3, 1).setValues(rrows.map(function (r) { return [r[0]]; }));
  d.getRange(r0 + 2, 2, 3, 3).setFormulas(rrows.map(function (r) { return r.slice(1); }));
  var s0 = r0 + 6;
  d.getRange(s0, 1, 4, 1).setValues([['Заучено уникальных страниц'], ['Прогресс хифза (из 604)'],
    ['Заучено уникальных сур (из 114)'], ['Дней с чтением (период)']]).setFontWeight('bold');
  d.getRange(s0, 2).setFormula('=ARRAYFORMULA(SUMPRODUCT(--(COUNTIFS(' + R + 'C2:C,"Заучивание",' + R + 'E2:E,"<="&SEQUENCE(' +
    CFG.QURAN_PAGES + '),' + R + 'F2:F,">="&SEQUENCE(' + CFG.QURAN_PAGES + '))>0)))');
  d.getRange(s0 + 1, 2).setFormula('=B' + s0 + '/' + CFG.QURAN_PAGES).setNumberFormat('0.0%');
  d.getRange(s0 + 1, 3).setFormula('=SPARKLINE(B' + (s0 + 1) + ',{"charttype","bar";"max",1;"color1","#43a047"})');
  d.getRange(s0 + 2, 2).setFormula('=IFERROR(COUNTUNIQUE(FILTER(' + R + 'J2:J,' + R + 'C2:C="Заучивание",' + R + 'J2:J<>"")),0)');
  d.getRange(s0 + 3, 2).setFormula('=IFERROR(COUNTUNIQUE(FILTER(' + R + 'B2:B,' + R + 'B2:B>=$B$3,' + R + 'B2:B<=$B$4)),0)');

  title('F' + r0, 'Страниц по дням (30 дней)');
  d.getRange(r0 + 1, 6, 1, 4).setValues([['Дата'].concat(DEFAULTS.kinds)]); head('F' + (r0 + 1) + ':I' + (r0 + 1));
  var days = [];
  for (var j = 0; j < 30; j++) {
    var rr = r0 + 2 + j, row = ['=TODAY()-' + (29 - j)];
    ['G', 'H', 'I'].forEach(function (c) {
      row.push('=SUMIFS(' + R + '$I:$I,' + R + '$B:$B,$F' + rr + ',' + R + '$C:$C,' + c + '$' + (r0 + 1) + ')');
    });
    days.push(row);
  }
  d.getRange(r0 + 2, 6, 30, 4).setFormulas(days);
  d.getRange(r0 + 2, 6, 30, 1).setNumberFormat('dd.mm');

  d.setColumnWidth(1, 230); d.setColumnWidth(2, 110); d.setColumnWidth(3, 90);
  d.setColumnWidth(4, 210); d.setColumnWidth(5, 100); d.setColumnWidth(6, 90);
  SpreadsheetApp.flush();

  addChart_(d, Charts.ChartType.PIE, d.getRange('D7:E25'), 6, 'Расходы по категориям', { pieHole: 0.45, legend: { position: 'right' } }, false);
  addChart_(d, Charts.ChartType.COLUMN, d.getRange('G7:J19'), 21, 'Приход / расходы по месяцам',
    { colors: ['#43a047', '#e53935', '#fb8c00'], legend: { position: 'top' } }, false);
  addChart_(d, Charts.ChartType.COLUMN, d.getRange('A' + (p0 + 1) + ':H' + last), 36, 'Молитвы по статусам',
    { isStacked: true, legend: { position: 'right' }, colors: ['#2e7d32', '#7cb342', '#f9a825', '#e53935', '#7e57c2', '#bdbdbd'] }, true);
  addChart_(d, Charts.ChartType.COLUMN, d.getRange('F' + (r0 + 1) + ':I' + (r0 + 31)), 51, 'Страниц в день',
    { isStacked: true, colors: ['#1e88e5', '#43a047', '#8e24aa'], legend: { position: 'top' } }, false);
}

function addChart_(sheet, type, range, row, title, opts, transpose) {
  var b = sheet.newChart().setChartType(type).setPosition(row, 12, 0, 0).addRange(range)
    .setOption('title', title).setOption('width', 520).setOption('height', 300).setNumHeaders(1);
  if (transpose) b.setTransposeRowsAndColumns(true);
  Object.keys(opts).forEach(function (k) { b.setOption(k, opts[k]); });
  sheet.insertChart(b.build());
}

// ───────────────────────────── Web API ─────────────────────────────
function doGet() { return json_({ ok: true, app: 'myTracker', v: APP_VERSION }); }

function doPost(e) {
  var req;
  try { req = JSON.parse(e.postData.contents); } catch (err) { return json_({ ok: false, error: 'Неверный запрос' }); }
  try {
    if (req.action === 'login') { var lr = login_(req.password); lr.v = APP_VERSION; return json_(lr); }
    if (!verifyToken_(req.token)) return json_({ ok: false, error: 'AUTH', message: 'Нужно войти заново', v: APP_VERSION });
    var routes = {
      bootstrap: bootstrap_, meta: meta_,
      savePrayer: savePrayer_, addReading: addReading_, updateReading: updateReading_,
      addFinance: addFinance_, updateFinance: updateFinance_, saveFinanceRef: saveFinanceRef_,
      saveAccounts: saveAccounts_, updateBlankAccounts: updateBlankAccounts_,
      saveConfig: saveConfig_, saveStatuses: saveStatuses_, saveRecurring: saveRecurring_, skipRecurring: skipRecurring_,
      deleteReading: deleteReading_, deleteFinance: deleteFinance_, revertRecurring: revertRecurring_,
      savePeople: savePeople_, assignPerson: assignPerson_,
      importCsv: importCsv_, tgState: tgStatus_, tgTestLater: tgTestLater_, tgQuranTest: tgQuranTest_, tgLink: tgLink_, tgTest: tgTest_, tgUnlink: tgUnlink_
    };
    var fn = routes[req.action];
    if (!fn) return json_({ ok: false, error: 'OLD_SERVER', message: 'Apps Script устарел: замените Code.gs и сделайте новое развертывание (Развертывания → Управление → ✏ → Новая версия).', v: APP_VERSION, b: SERVER_BUILD });
    var isWrite = /^(add|update|save|skip|import|delete|revert|assign)/.test(req.action);
    // повтор той же операции из офлайн-очереди (ответ потерялся в сети) не создаёт дубликат
    var cache = CacheService.getScriptCache(), opKey = req.opId ? 'op|' + req.opId : null;
    if (isWrite && opKey) { var done = cache.get(opKey); if (done) return json_({ ok: true, data: JSON.parse(done), v: APP_VERSION, repeated: true }); }
    var data = fn(req);
    if (isWrite) {
      bumpVersion_();
      if (opKey) try { cache.put(opKey, JSON.stringify(data || {}), 21600); } catch (e2) {}
    }
    return json_({ ok: true, data: data, v: APP_VERSION, b: SERVER_BUILD });
  } catch (err) {
    return json_({ ok: false, error: String(err && err.message || err), v: APP_VERSION });
  }
}

function json_(obj) {
  if (obj && obj.v) obj.b = SERVER_BUILD;
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

// ── Авторизация
function login_(password) {
  var real = PropertiesService.getScriptProperties().getProperty('APP_PASSWORD');
  if (!real) return { ok: false, error: 'На сервере не задан APP_PASSWORD' };
  var cache = CacheService.getScriptCache();
  var fails = Number(cache.get('login_fails') || 0);
  if (fails >= CFG.MAX_LOGIN_FAILS) return { ok: false, error: 'Слишком много попыток. Подождите ' + CFG.LOCK_MINUTES + ' мин.' };
  if (!password || sha_(String(password)) !== sha_(real)) {
    cache.put('login_fails', String(fails + 1), CFG.LOCK_MINUTES * 60);
    Utilities.sleep(800);
    return { ok: false, error: 'Неверный пароль' };
  }
  cache.remove('login_fails');
  var exp = String(Date.now() + CFG.TOKEN_TTL_DAYS * 864e5);
  return { ok: true, token: exp + '.' + sign_(exp) };
}

function verifyToken_(token) {
  if (!token || typeof token !== 'string') return false;
  var parts = token.split('.');
  if (parts.length !== 2 || Number(parts[0]) < Date.now()) return false;
  return sign_(parts[0]) === parts[1];
}

function sign_(payload) {
  var secret = PropertiesService.getScriptProperties().getProperty('TOKEN_SECRET');
  if (!secret) throw new Error('Запустите setup() в редакторе Apps Script');
  return Utilities.base64EncodeWebSafe(Utilities.computeHmacSha256Signature(payload, secret)).replace(/=+$/, '');
}

function sha_(s) {
  return Utilities.base64Encode(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, s, Utilities.Charset.UTF_8));
}

// ── Хелперы
var SS_ = null; // одна таблица на весь запрос
function ss_() {
  if (SS_) return SS_;
  var id = PropertiesService.getScriptProperties().getProperty('SPREADSHEET_ID');
  SS_ = id ? SpreadsheetApp.openById(id) : SpreadsheetApp.getActiveSpreadsheet();
  return SS_;
}
function sheet_(name) {
  var sh = ss_().getSheetByName(name);
  // листы, добавленные в новых версиях, создаём сами, если setup() ещё не запускали
  if (!sh && (name === SH.CONFIG || name === SH.RECUR || name === SH.ACCOUNTS)) {
    sh = ss_().insertSheet(name);
    var head = name === SH.CONFIG ? HEAD.CONFIG : name === SH.RECUR ? HEAD.RECUR : HEAD.ACCOUNTS;
    sh.getRange(1, 1, 1, head.length).setValues([head]).setFontWeight('bold').setBackground('#263238').setFontColor('#ffffff');
    sh.setFrozenRows(1);
  }
  if (!sh) throw new Error('Нет листа «' + name + '». Запустите setup() в редакторе Apps Script');
  return sh;
}
function tz_() { return Session.getScriptTimeZone(); }

function parseDate_(s) {
  var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s || ''));
  if (!m) throw new Error('Неверная дата');
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}
function fmtDate_(d) {
  if (d instanceof Date) return Utilities.formatDate(d, tz_(), 'yyyy-MM-dd');
  var m = /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/.exec(String(d || '').trim());
  if (m) return m[3] + '-' + ('0' + m[2]).slice(-2) + '-' + ('0' + m[1]).slice(-2);
  return String(d || '');
}
function clean_(s, max) { return String(s == null ? '' : s).trim().slice(0, max || 1000); }
function daysAgo_(n) { var d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - n); return d; }

function refValues_(col, width) {
  var ref = sheet_(SH.REF), n = Math.max(ref.getLastRow() - 1, 1);
  return ref.getRange(2, col, n, width || 1).getValues().filter(function (r) { return r[0] !== ''; });
}

function nextId_(sh) {
  var last = sh.getLastRow();
  if (last < 2) return 1;
  var max = 0;
  sh.getRange(2, 1, last - 1, 1).getValues().forEach(function (r) { var v = Number(r[0]); if (v > max) max = v; });
  return max + 1;
}

function findRowById_(sh, id) {
  var last = sh.getLastRow();
  if (last < 2) return -1;
  var col = sh.getRange(2, 1, last - 1, 1).getValues();
  for (var i = col.length - 1; i >= 0; i--) if (String(col[i][0]) === String(id)) return i + 2;
  return -1;
}

function withLock_(fn) {
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try { return fn(); } finally { lock.releaseLock(); }
}

// ── Справочники
function meta_() {
  var pairs = refValues_(REFC.ACTION, 4).map(function (r) {
    var a = String(r[0]).trim(), c = String(r[1]).trim();
    return [a, c, String(r[2] || '').trim(), String(r[3] || '').trim() || flowDefault_(a, c)];
  });
  return {
    pairs: pairs,
    statuses: statuses_(),
    kinds: refValues_(REFC.KIND).map(function (r) { return String(r[0]); }),
    suras: refValues_(REFC.SURA_N, 3).map(function (r) { return { n: Number(r[0]), name: String(r[1]), ayahs: Number(r[2]) }; }),
    pages: CFG.QURAN_PAGES, today: fmtDate_(new Date()), fin: FIN, flow: FLOW,
    accounts: accounts_(), actionDefaults: actionDefaults_(),
    config: config_(), recurring: recurring_(), tg: tgStatus_()
  };
}

// ── Счета и карты (лист «Счета»)
function accounts_() {
  var sh = ss_().getSheetByName(SH.ACCOUNTS);
  if (!sh || sh.getLastRow() < 2) return [];
  return sh.getRange(2, 1, sh.getLastRow() - 1, 5).getValues().filter(function (r) { return String(r[0]).trim(); })
    .map(function (r) {
      return { name: String(r[0]).trim(), icon: String(r[1] || '').trim(), start: Number(r[2]) || 0,
               isDefault: /^(да|yes|1|true)$/i.test(String(r[3]).trim()), archived: /^(да|yes|1|true)$/i.test(String(r[4]).trim()) };
    });
}
function actionDefaults_() {
  var sh = ss_().getSheetByName(SH.ACCOUNTS), out = {};
  if (!sh || sh.getLastRow() < 2) return out;
  sh.getRange(2, 7, sh.getLastRow() - 1, 2).getValues().forEach(function (r) {
    if (String(r[0]).trim() && String(r[1]).trim()) out[String(r[0]).trim()] = String(r[1]).trim();
  });
  return out;
}

/**
 * Сохранение счетов из приложения.
 * req.accounts = [{name, icon, start, isDefault, archived, orig}], req.actionDefaults = {действие: счёт}
 * Переименованный счёт переименовывается и в старых записях «Финансов».
 */
function saveAccounts_(req) {
  var list = (req.accounts || []).map(function (a) {
    var name = clean_(a.name, 60);
    if (!name) throw new Error('У счёта должно быть название');
    return { name: name, icon: clean_(a.icon, 8), start: Number(a.start) || 0, isDefault: !!a.isDefault, archived: !!a.archived, orig: clean_(a.orig, 60) };
  });
  var seen = {};
  list.forEach(function (a) { if (seen[a.name]) throw new Error('Повтор счёта: «' + a.name + '»'); seen[a.name] = 1; });
  if (list.length && !list.some(function (a) { return a.isDefault && !a.archived; })) {
    var firstActive = list.filter(function (a) { return !a.archived; })[0]; if (firstActive) firstActive.isDefault = true;
  }
  var defs = req.actionDefaults || {};
  return withLock_(function () {
    var ss = ss_(), sh = ss.getSheetByName(SH.ACCOUNTS) || ensureSheet_(ss, SH.ACCOUNTS, HEAD.ACCOUNTS);
    // переименования в «Финансах»
    var renamed = 0, fi = sheet_(SH.FINANCE), last = fi.getLastRow();
    var renames = list.filter(function (a) { return a.orig && a.orig !== a.name; });
    if (renames.length && last > 1) {
      var rng = fi.getRange(2, 9, last - 1, 2), vals = rng.getValues();
      vals.forEach(function (r) { renames.forEach(function (a) {
        if (String(r[0]).trim() === a.orig) { r[0] = a.name; renamed++; }
        if (String(r[1]).trim() === a.orig) { r[1] = a.name; renamed++; }
      }); });
      if (renamed) rng.setValues(vals);
    }
    var oldN = Math.max(sh.getLastRow() - 1, 0);
    var rows = list.map(function (a) { return [a.name, a.icon, a.start, a.isDefault ? 'да' : '', a.archived ? 'да' : '']; });
    var defRows = Object.keys(defs).filter(function (k) { return defs[k]; }).map(function (k) { return [k, clean_(defs[k], 60)]; });
    var n = Math.max(rows.length, defRows.length, oldN);
    var out = [];
    for (var i = 0; i < n; i++) {
      var r = rows[i] || ['', '', '', '', ''], d = defRows[i] || ['', ''];
      out.push(r.concat([''], d));
    }
    if (n) sh.getRange(2, 1, n, 8).setValues(out);
    return { accounts: accounts_(), actionDefaults: actionDefaults_(), renamed: renamed };
  });
}

/** Записи «Финансов» без счёта привязать к выбранному счёту (кроме переводов). */
function updateBlankAccounts_(req) {
  var acc = clean_(req.account, 60);
  if (!acc) throw new Error('Выберите счёт');
  return withLock_(function () {
    var fi = sheet_(SH.FINANCE), last = fi.getLastRow(), n = 0;
    if (last < 2) return { updated: 0 };
    var rng = fi.getRange(2, 1, last - 1, 10), vals = rng.getValues();
    var col = vals.map(function (r) {
      if (r[0] !== '' && !String(r[8]).trim() && String(r[3]).trim() !== FIN.TRANSFER) { n++; return [acc]; }
      return [r[8]];
    });
    if (n) fi.getRange(2, 9, last - 1, 1).setValues(col);
    return { updated: n };
  });
}

/**
 * Редактирование действий и категорий из приложения.
 * req.pairs = [[действие, категория, иконка, поток], ...]
 * req.renames = [{ type: 'action', from, to } | { type: 'category', action, from, to }] — переименовывает и старые записи.
 */
function saveFinanceRef_(req) {
  var pairs = (req.pairs || []).map(function (p) {
    var a = clean_(p[0], 60), c = clean_(p[1], 80), ic = clean_(p[2], 8), f = clean_(p[3], 10);
    if (!a) throw new Error('У действия должно быть название');
    if ([FLOW.IN, FLOW.OUT, FLOW.NONE].indexOf(f) < 0) f = flowDefault_(a, c);
    return [a, c, ic, f];
  });
  if (!pairs.length) throw new Error('Нужно хотя бы одно действие');
  var seen = {};
  pairs.forEach(function (p) {
    var k = p[0] + '|' + p[1];
    if (seen[k]) throw new Error('Повтор: «' + p[0] + (p[1] ? ' → ' + p[1] : '') + '»');
    seen[k] = 1;
  });
  return withLock_(function () {
    var fi = sheet_(SH.FINANCE), last = fi.getLastRow(), renamed = 0;
    var renames = req.renames || [];
    if (renames.length && last > 1) {
      var rng = fi.getRange(2, 4, last - 1, 2), vals = rng.getValues();
      vals.forEach(function (r) {
        renames.forEach(function (rn) {
          var from = clean_(rn.from, 80), to = clean_(rn.to, 80);
          if (!from || !to || from === to) return;
          if (rn.type === 'action' && String(r[0]).trim() === from) { r[0] = to; renamed++; }
          if (rn.type === 'category' && String(r[0]).trim() === clean_(rn.action, 60) && String(r[1]).trim() === from) { r[1] = to; renamed++; }
        });
      });
      if (renamed) rng.setValues(vals);
    }
    var ref = sheet_(SH.REF), old = refValues_(REFC.ACTION, 1).length;
    var out = pairs.slice();
    while (out.length < old) out.push(['', '', '', '']);
    ref.getRange(2, 1, out.length, 4).setValues(out);
    recomputeFlow_();
    var m = meta_(); m.renamed = renamed;
    return m;
  });
}

// ── Финансы
function financeRow_(it) {
  var amount = Number(it.amount);
  if (!isFinite(amount) || amount <= 0) throw new Error('Сумма должна быть больше 0');
  var action = clean_(it.actionType, 60);
  if (!action) throw new Error('Выберите действие');
  var category = clean_(it.category, 80);
  if (action === FIN.DEBT && !category) throw new Error('Для долга выберите категорию');
  var account = clean_(it.account, 60), to = clean_(it.toAccount, 60);
  if (action === FIN.TRANSFER) {
    if (!account || !to) throw new Error('Для перевода выберите оба счёта');
    if (account === to) throw new Error('Счета перевода должны различаться');
    if (!category) category = FIN.BETWEEN;
  } else to = '';
  var person = action === FIN.DEBT ? clean_(it.person, 60) : '';
  return [parseDate_(it.date), Math.round(amount * 100) / 100, action, category, clean_(it.comment), account, to, person];
}

/** Пачка записей: { items: [{opId, date, amount, actionType, category, comment}, ...] } */
function addFinance_(req) {
  var cache = CacheService.getScriptCache();
  if ((req.items || []).length > CFG.MAX_BATCH) throw new Error('Не больше ' + CFG.MAX_BATCH + ' записей за раз');
  var items = (req.items || []).filter(function (it) { return !(it.opId && cache.get('op|' + it.opId)); });
  if (!items.length) return { ids: [], skipped: (req.items || []).length };
  var rows = items.map(financeRow_); // проверяем все до записи
  return withLock_(function () {
    var sh = sheet_(SH.FINANCE), id = nextId_(sh), now = new Date(), ids = [], map = flowMap_();
    var byOp = {};
    var data = rows.map(function (r, i) { ids.push(id); if (items[i].opId) byOp[items[i].opId] = id; return [id++].concat(r.slice(0, 5), [now, signed_(map, r[2], r[3], r[1]), r[5], r[6], r[7]]); });
    sh.getRange(sh.getLastRow() + 1, 1, data.length, data[0].length).setValues(data);
    items.forEach(function (it) {
      if (it.opId) try { cache.put('op|' + it.opId, '1', 21600); } catch (e) {}
      if (it.recurId && it.recurDue) try { advanceRecurring_(it.recurId, String(it.recurDue)); } catch (e) {}
    });
    budgetAlerts_(rows);
    return { ids: ids, byOp: byOp };
  });
}

function updateFinance_(req) {
  var row = financeRow_(req);
  return withLock_(function () {
    var sh = sheet_(SH.FINANCE), r = findRowById_(sh, req.id);
    if (r < 0) throw new Error('Запись не найдена (возможно, удалена в таблице)');
    sh.getRange(r, 2, 1, 5).setValues([row.slice(0, 5)]);
    sh.getRange(r, 8, 1, 4).setValues([[signed_(flowMap_(), row[2], row[3], row[1]), row[5], row[6], row[7]]]);
    return { id: Number(req.id) };
  });
}

// ── Люди (долги): список в «Настройках», имя — в колонке «Человек» листа «Финансы»
/** { items: [{name, orig, note, archived}] } — сохранить список; переименованные — переименовать и в записях. */
function savePeople_(req) {
  var items = (req.items || []).map(function (x) { return { name: clean_(x.name, 60), orig: clean_(x.orig, 60), note: clean_(x.note, 200), archived: !!x.archived }; })
    .filter(function (x) { return x.name; });
  var names = items.map(function (x) { return x.name.toLowerCase(); });
  if (names.filter(function (n, i) { return names.indexOf(n) !== i; }).length) throw new Error('Имена не должны повторяться');
  var ren = {};
  items.forEach(function (x) { if (x.orig && x.orig !== x.name) ren[x.orig] = x.name; });
  var renamed = 0;
  withLock_(function () {
    setConfig_('people', { items: items.map(function (x) { return { name: x.name, note: x.note, archived: x.archived }; }) });
    if (Object.keys(ren).length) {
      var sh = sheet_(SH.FINANCE), last = sh.getLastRow();
      if (last > 1) {
        var rng = sh.getRange(2, 11, last - 1, 1), v = rng.getValues();
        v.forEach(function (r) { var n = String(r[0]).trim(); if (ren[n]) { r[0] = ren[n]; renamed++; } });
        if (renamed) rng.setValues(v);
      }
    }
  });
  return { config: config_(), renamed: renamed };
}
/** Привязать к человеку старые долги без имени: { person, comment } — по точному комментарию, или { person, ids: [..] }. */
function assignPerson_(req) {
  var person = clean_(req.person, 60); if (!person) throw new Error('Укажите человека');
  var key = String(req.comment || '').trim().toLowerCase(), ids = (req.ids || []).map(String);
  return withLock_(function () {
    var sh = sheet_(SH.FINANCE), last = sh.getLastRow(), n = 0;
    if (last < 2) return { updated: 0 };
    var v = sh.getRange(2, 1, last - 1, 11).getValues(), col = v.map(function (r) { return [r[10]]; });
    v.forEach(function (r, i) {
      if (String(r[3]).trim() !== FIN.DEBT || String(r[10]).trim()) return;
      var hit = ids.length ? ids.indexOf(String(r[0])) >= 0 : key && String(r[5]).trim().toLowerCase() === key;
      if (hit) { col[i][0] = person; n++; }
    });
    if (n) sh.getRange(2, 11, col.length, 1).setValues(col);
    return { updated: n };
  });
}

// ── Отмена (undo): удаление только что добавленной записи
function deleteRow_(name, id) {
  return withLock_(function () {
    var sh = sheet_(name), r = findRowById_(sh, id);
    if (r < 0) return { deleted: false };
    sh.deleteRow(r);
    return { deleted: true, id: Number(id) };
  });
}
function deleteReading_(req) { return deleteRow_(SH.READING, req.id); }
function deleteFinance_(req) { return deleteRow_(SH.FINANCE, req.id); }
/** Отмена оплаты или пропуска регулярного платежа: вернуть «Следующую дату» на due. */
function revertRecurring_(req) {
  return withLock_(function () {
    var sh = sheet_(SH.RECUR), r = findRowById_(sh, req.id), due = String(req.due || '');
    if (r < 0 || !/^\d{4}-\d{2}-\d{2}$/.test(due)) return { reverted: false };
    var rec = recurring_().filter(function (x) { return x.id === Number(req.id); })[0];
    if (!rec || rec.next !== advance_(due, rec.repeat, rec.every, rec.day)) return { reverted: false };
    sh.getRange(r, 9).setValue(parseDate_(due));
    return { reverted: true };
  });
}

// ── Коран
function readingRows_(req) {
  var date = parseDate_(req.date);
  var kind = clean_(req.kind, 40);
  if (!kind) throw new Error('Выберите вид (чтение / заучивание / повторение)');
  var reps = Math.max(1, Math.floor(Number(req.repeats) || 1));
  var comment = clean_(req.comment);
  if (req.type === 'pages') {
    var a = Math.floor(Number(req.from)), b = Math.floor(Number(req.to));
    if (!(a >= 1 && b >= a && b <= CFG.QURAN_PAGES)) throw new Error('Страницы: от 1 до ' + CFG.QURAN_PAGES + ', «с» ≤ «по»');
    var pages = b - a + 1;
    return [[null, date, kind, 'Страницы', a, b, pages, reps, pages * reps, '', '', '', '', comment, new Date()]];
  }
  if (req.type === 'suras') {
    var list = (req.suras || []).map(Number).filter(function (n) { return n >= 1 && n <= 114; });
    if (!list.length) throw new Error('Выберите хотя бы одну суру');
    var byN = {};
    refValues_(REFC.SURA_N, 3).forEach(function (r) { byN[Number(r[0])] = { name: String(r[1]), ayahs: Number(r[2]) }; });
    return list.map(function (n) {
      var s = byN[n] || { name: '', ayahs: 0 };
      return [null, date, kind, 'Сура', '', '', '', reps, '', n, s.name, s.ayahs, s.ayahs * reps, comment, new Date()];
    });
  }
  throw new Error('Тип: страницы или суры');
}

function addReading_(req) {
  var rows = readingRows_(req);
  return withLock_(function () {
    var sh = sheet_(SH.READING), id = nextId_(sh);
    var ids = [];
    rows.forEach(function (r) { ids.push(id); r[0] = id++; });
    sh.getRange(sh.getLastRow() + 1, 1, rows.length, rows[0].length).setValues(rows);
    return { added: rows.length, ids: ids };
  });
}

/** Редактирование одной строки. Для сур — ровно одна сура. */
function updateReading_(req) {
  if (req.type === 'suras' && (req.suras || []).length !== 1) throw new Error('При редактировании выберите одну суру');
  var row = readingRows_(req)[0];
  return withLock_(function () {
    var sh = sheet_(SH.READING), r = findRowById_(sh, req.id);
    if (r < 0) throw new Error('Запись не найдена (возможно, удалена в таблице)');
    row[0] = Number(req.id);
    row[14] = sh.getRange(r, 15).getValue() || new Date(); // «Создано» не меняем
    sh.getRange(r, 1, 1, row.length).setValues([row]);
    return { id: row[0] };
  });
}

// ── Молитвы (одна строка на день, сохранение обновляет строку)
function findPrayerRow_(sh, dateStr) {
  var last = sh.getLastRow();
  if (last < 2) return -1;
  var dates = sh.getRange(2, 1, last - 1, 1).getValues();
  for (var i = dates.length - 1; i >= 0; i--) if (fmtDate_(dates[i][0]) === dateStr) return i + 2;
  return -1;
}

function savePrayer_(req) {
  var date = parseDate_(req.date);
  var allowed = statuses_();
  var vals = PRAYER_KEYS.map(function (k) {
    var s = clean_(req[k], 30);
    if (s && allowed.indexOf(s) < 0) throw new Error('Неизвестный статус: ' + s);
    return s;
  });
  return withLock_(function () {
    var sh = sheet_(SH.PRAYERS), row = findPrayerRow_(sh, req.date);
    var data = [date].concat(vals, [clean_(req.comment), new Date()]);
    if (row < 0) { sh.appendRow(data); return { created: true }; }
    sh.getRange(row, 1, 1, data.length).setValues([data]);
    return { updated: true };
  });
}

/** Времена молитв: строки от вчера до +40 дней. Время — строка «04:59 - 06:25». */
function prayerTimes_() {
  var sh = ss_().getSheetByName(SH.TIMES);
  if (!sh || sh.getLastRow() < 2) return [];
  var from = fmtDate_(daysAgo_(1)), to = fmtDate_(daysAgo_(-40));
  var cell = function (v) { return v instanceof Date ? Utilities.formatDate(v, tz_(), 'HH:mm') : String(v || '').trim(); };
  return sh.getRange(2, 1, sh.getLastRow() - 1, 9).getValues()
    .map(function (r) {
      var hijri = r[2] instanceof Date ? Utilities.formatDate(r[2], tz_(), 'dd.MM.yyyy') : String(r[2] || '');
      return { date: fmtDate_(r[1]), weekday: String(r[0] || ''), hijri: hijri,
               fajr: cell(r[3]), zuhr: cell(r[4]), asr: cell(r[5]), makruh: cell(r[6]), maghrib: cell(r[7]), isha: cell(r[8]) };
    })
    .filter(function (x) { return x.date >= from && x.date <= to; });
}

// ───────────────────────────── v6: настройки, статусы, регулярные платежи, Telegram, импорт ─────────────────────────────
/** Лист «Настройки»: ключ → JSON. Общие для всех устройств (молитвы, статусы, бюджеты, цели, уведомления). */
var CONFIG_KEYS = {
  prayers: 'Названия молитв, показ Духа и Витр',
  statuses: 'Скрытые статусы намаза',
  budgets: 'Месячные лимиты по категориям',
  goals: 'Цели',
  notify: 'Напоминания (Telegram)',
  hifz: 'Хифз: заучено ранее (суры, страницы, дата)',
  people: 'Люди (для долгов)',
  plan: 'План Корана: повторение и заучивание'
};
function config_() {
  var sh = ss_().getSheetByName(SH.CONFIG), out = {};
  if (!sh || sh.getLastRow() < 2) return out;
  sh.getRange(2, 1, sh.getLastRow() - 1, 2).getValues().forEach(function (r) {
    var k = String(r[0]).trim(); if (!CONFIG_KEYS[k]) return;
    try { out[k] = JSON.parse(String(r[1] || 'null')); } catch (e) {}
  });
  return out;
}
function setConfig_(key, value) {
  var sh = sheet_(SH.CONFIG), last = sh.getLastRow(), row = -1;
  if (last >= 2) sh.getRange(2, 1, last - 1, 1).getValues().forEach(function (r, i) { if (String(r[0]).trim() === key) row = i + 2; });
  if (row < 0) row = Math.max(last, 1) + 1;
  sh.getRange(row, 1, 1, 3).setValues([[key, JSON.stringify(value), CONFIG_KEYS[key]]]);
}
/** { key, value } — сохранить один раздел настроек. */
function saveConfig_(req) {
  var key = String(req.key || '');
  if (!CONFIG_KEYS[key]) throw new Error('Неизвестная настройка');
  var v = req.value;
  if (JSON.stringify(v).length > 40000) throw new Error('Слишком большие настройки');
  withLock_(function () { setConfig_(key, v); });
  if (key === 'notify') {
    var err = '';
    try { installNotifyTriggers_(); } catch (e) { err = String(e && e.message || e); }
    return { config: config_(), tg: tgStatus_(), notifyError: err };
  }
  return { config: config_() };
}

// ── Статусы намаза: роль задаётся позицией (1–2 «вовремя», последний — «нет данных»), имя можно менять
var STATUS_COLOR_LIST = ['#b7e1cd', '#d9ead3', '#fce8b2', '#bdbdbd', '#d9d2e9', '#eeeeee'];
/** Цвет фона статуса в таблице: свой цвет из настроек (осветлённый) или стандартный. */
function statusSheetColor_(i) {
  var c = '';
  try { c = (((config_().statuses || {}).colors) || [])[i] || ''; } catch (e) {}
  if (!/^#[0-9a-f]{6}$/i.test(c)) return STATUS_COLOR_LIST[i] || '#eeeeee';
  var n = parseInt(c.slice(1), 16), mix = function (v) { return Math.round(v + (255 - v) * 0.6); };
  var r = mix(n >> 16), g = mix((n >> 8) & 255), b = mix(n & 255);
  return '#' + [r, g, b].map(function (v) { return ('0' + v.toString(16)).slice(-2); }).join('');
}
function statuses_() {
  var list = refValues_(REFC.STATUS).map(function (r) { return String(r[0]).trim(); });
  return list.length ? list : DEFAULTS.statuses.slice();
}
/** { statuses: [{name, orig}], hidden: [индексы] } — переименование со старыми записями. */
function saveStatuses_(req) {
  var items = req.statuses || [], cur = statuses_();
  if (items.length !== cur.length) throw new Error('Количество статусов менять нельзя');
  var names = items.map(function (s) { return clean_(s.name, 30); });
  names.forEach(function (n) { if (!n) throw new Error('Название статуса не может быть пустым'); });
  if (names.filter(function (n, i) { return names.indexOf(n) !== i; }).length) throw new Error('Названия статусов не должны повторяться');
  var map = {}, renamed = 0;
  cur.forEach(function (old, i) { if (old !== names[i]) map[old] = names[i]; });
  withLock_(function () {
    var ref = sheet_(SH.REF);
    ref.getRange(2, REFC.STATUS, names.length, 1).setValues(names.map(function (n) { return [n]; }));
    if (Object.keys(map).length) {
      var pr = sheet_(SH.PRAYERS), last = pr.getLastRow();
      if (last > 1) {
        var rng = pr.getRange(2, 2, last - 1, PRAYER_KEYS.length), v = rng.getValues();
        v.forEach(function (r) { r.forEach(function (c, j) { if (map[c] !== undefined) { r[j] = map[c]; renamed++; } }); });
        if (renamed) rng.setValues(v);
      }
      try { buildDashboard_(sheet_(SH.DASH)); } catch (e) {}
    }
    var hidden = (req.hidden || []).map(Number).filter(function (i) { return i >= 0 && i < names.length; });
    var colors = (req.colors || []).slice(0, names.length).map(function (c) { return /^#[0-9a-f]{6}$/i.test(String(c || '')) ? String(c) : ''; });
    setConfig_('statuses', { hidden: hidden, colors: colors });
    try { formatPrayers_(sheet_(SH.PRAYERS)); } catch (e) {}
  });
  return { statuses: names, config: config_(), renamed: renamed };
}

// ── Регулярные платежи (лист «Регулярные»)
var REPEAT = { day: 'Ежедневно', week: 'Еженедельно', month: 'Ежемесячно', year: 'Ежегодно' };
var REPEAT_BACK = { 'ежедневно': 'day', 'еженедельно': 'week', 'ежемесячно': 'month', 'ежегодно': 'year',
                    'day': 'day', 'week': 'week', 'month': 'month', 'year': 'year' };
var yes_ = function (v) { return /^(да|yes|1|true|✓)$/i.test(String(v).trim()); };
function recurring_() {
  var sh = ss_().getSheetByName(SH.RECUR);
  if (!sh || sh.getLastRow() < 2) return [];
  return sh.getRange(2, 1, sh.getLastRow() - 1, HEAD.RECUR.length).getValues()
    .filter(function (r) { return String(r[1]).trim() && r[0] !== ''; })
    .map(function (r) {
      var next = fmtDate_(r[8]);
      return { id: Number(r[0]), name: String(r[1]).trim(), amount: Number(r[2]) || 0, action: String(r[3]).trim(),
               category: String(r[4]).trim(), account: String(r[5]).trim(),
               repeat: REPEAT_BACK[String(r[6]).trim().toLowerCase()] || 'month', every: Math.max(1, Number(r[7]) || 1),
               next: next, auto: yes_(r[9]), remind: Math.max(0, Number(r[10]) || 0), active: r[11] === '' ? true : yes_(r[11]),
               comment: String(r[12] || ''), day: Number(r[13]) || Number(next.slice(8)) || 1 };
    });
}
function dim_(y, m) { return new Date(y, m + 1, 0).getDate(); }
/** Следующая дата по правилу повтора. dateStr — 'yyyy-mm-dd'. */
function advance_(dateStr, repeat, every, day) {
  var p = dateStr.split('-').map(Number), d = new Date(p[0], p[1] - 1, p[2]);
  every = Math.max(1, every || 1);
  if (repeat === 'day') d.setDate(d.getDate() + every);
  else if (repeat === 'week') d.setDate(d.getDate() + 7 * every);
  else {
    var y = d.getFullYear(), m = d.getMonth() + (repeat === 'year' ? 12 * every : every);
    y += Math.floor(m / 12); m = ((m % 12) + 12) % 12;
    d = new Date(y, m, Math.min(day || p[2], dim_(y, m)));
  }
  return fmtDate_(d);
}
function recurRow_(it, id) {
  var name = clean_(it.name, 80); if (!name) throw new Error('Укажите название платежа');
  var amount = Math.round(Number(it.amount) * 100) / 100;
  if (!(amount > 0)) throw new Error('Сумма платежа «' + name + '» должна быть больше 0');
  var next = parseDate_(it.next);
  var day = Math.min(31, Math.max(1, Number(it.day) || next.getDate()));
  return [id, name, amount, clean_(it.action, 60) || FIN.EXPENSE, clean_(it.category, 80), clean_(it.account, 60),
          REPEAT[it.repeat] || REPEAT.month, Math.max(1, Math.floor(Number(it.every) || 1)), next,
          it.auto ? 'да' : 'нет', Math.max(0, Math.floor(Number(it.remind) || 0)), it.active === false ? 'нет' : 'да', clean_(it.comment, 300), day];
}
/** Полная замена списка: { items: [...] }. */
function saveRecurring_(req) {
  var items = req.items || [];
  if (items.length > 200) throw new Error('Слишком много платежей');
  return withLock_(function () {
    var sh = sheet_(SH.RECUR), max = 0;
    recurring_().forEach(function (r) { if (r.id > max) max = r.id; });
    var rows = items.map(function (it) { return recurRow_(it, Number(it.id) > 0 ? Number(it.id) : ++max); });
    var last = sh.getLastRow();
    if (last > 1) sh.getRange(2, 1, last - 1, HEAD.RECUR.length).clearContent();
    if (rows.length) sh.getRange(2, 1, rows.length, HEAD.RECUR.length).setValues(rows);
    return { recurring: recurring_() };
  });
}
/** Сдвинуть «Следующую дату», если она ещё равна due (повтор запроса ничего не испортит). */
function advanceRecurring_(id, due) {
  var sh = sheet_(SH.RECUR), r = findRowById_(sh, id);
  if (r < 0) return false;
  var row = sh.getRange(r, 1, 1, HEAD.RECUR.length).getValues()[0];
  if (fmtDate_(row[8]) !== due) return false;
  var rec = recurring_().filter(function (x) { return x.id === Number(id); })[0];
  sh.getRange(r, 9).setValue(parseDate_(advance_(due, rec.repeat, rec.every, rec.day)));
  return true;
}
/** Пропустить платёж: { id, due }. */
function skipRecurring_(req) {
  return withLock_(function () { return { advanced: advanceRecurring_(req.id, String(req.due)) }; });
}
/** Ночью: автодобавление платежей, у которых подошёл срок. */
function processRecurring_() {
  var t = fmtDate_(new Date()), list = recurring_().filter(function (r) { return r.active && r.auto && r.next && r.next <= t; });
  if (!list.length) return 0;
  return withLock_(function () {
    var sh = sheet_(SH.FINANCE), id = nextId_(sh), now = new Date(), map = flowMap_(), rows = [], rs = sheet_(SH.RECUR);
    list.forEach(function (rec) {
      var due = rec.next, guard = 0;
      while (due <= t && guard++ < 60) {
        var tr = rec.action === FIN.TRANSFER;
        rows.push([id++, parseDate_(due), rec.amount, rec.action, rec.category || (tr ? FIN.BETWEEN : ''),
                   '↻ ' + rec.name + (rec.comment ? ': ' + rec.comment : ''), now, signed_(map, rec.action, rec.category, rec.amount), rec.account, '', '']);
        due = advance_(due, rec.repeat, rec.every, rec.day);
      }
      var r = findRowById_(rs, rec.id); if (r > 0) rs.getRange(r, 9).setValue(parseDate_(due));
    });
    if (rows.length) sh.getRange(sh.getLastRow() + 1, 1, rows.length, rows[0].length).setValues(rows);
    bumpVersion_();
    return rows.length;
  });
}

// ── Импорт CSV: { kind: 'finance'|'prayers'|'reading', rows: [[...как в листе...]] }
function importCsv_(req) {
  var kind = req.kind, rows = req.rows || [];
  if (rows.length > 3000) throw new Error('Не больше 3000 строк за раз');
  var toDate = function (v) {
    var s = fmtDate_(String(v || '').trim().replace(/^(\d{4}-\d{2}-\d{2}).*$/, '$1'));
    return /^\d{4}-\d{2}-\d{2}$/.test(s) ? parseDate_(s) : null;
  };
  var num = function (v) { var n = Number(String(v == null ? '' : v).replace(/\s/g, '').replace(',', '.')); return isFinite(n) ? n : 0; };
  return withLock_(function () {
    var added = 0, updated = 0, skipped = 0;
    if (kind === 'finance') {
      var sh = sheet_(SH.FINANCE), ids = {}, keys = {}, map = flowMap_(), id = nextId_(sh), out = [], now = new Date();
      var key = function (d, a, act, cat, com) { return fmtDate_(d) + '|' + Number(a) + '|' + act + '|' + cat + '|' + String(com || '').trim(); };
      if (sh.getLastRow() > 1) sh.getRange(2, 1, sh.getLastRow() - 1, 6).getValues().forEach(function (r) {
        ids[String(r[0])] = 1; if (r[1] instanceof Date) keys[key(r[1], r[2], r[3], r[4], r[5])] = 1; });
      rows.forEach(function (r) {
        var d = toDate(r[1]), amt = num(r[2]), act = clean_(r[3], 60), cat = clean_(r[4], 80), com = clean_(r[5]);
        if (!d || !(amt > 0) || !act) { skipped++; return; }
        if ((r[0] !== '' && ids[String(r[0])]) || keys[key(d, amt, act, cat, com)]) { skipped++; return; }
        keys[key(d, amt, act, cat, com)] = 1;
        out.push([id++, d, amt, act, cat, com, now, signed_(map, act, cat, amt), clean_(r[8], 60), act === FIN.TRANSFER ? clean_(r[9], 60) : '', act === FIN.DEBT ? clean_(r[10], 60) : '']);
      });
      if (out.length) sh.getRange(sh.getLastRow() + 1, 1, out.length, out[0].length).setValues(out);
      added = out.length;
    } else if (kind === 'prayers') {
      var ps = sheet_(SH.PRAYERS), allowed = statuses_(), byDate = {}, last = ps.getLastRow(), n = PRAYER_KEYS.length;
      var data = last > 1 ? ps.getRange(2, 1, last - 1, n + 3).getValues() : [];
      data.forEach(function (r, i) { if (r[0] instanceof Date) byDate[fmtDate_(r[0])] = i; });
      var fresh = [];
      rows.forEach(function (r) {
        var d = toDate(r[0]); if (!d) { skipped++; return; }
        var vals = PRAYER_KEYS.map(function (k, j) { var s = clean_(r[j + 1], 30); return allowed.indexOf(s) >= 0 ? s : ''; });
        var ds = fmtDate_(d), at = byDate[ds];
        if (at === undefined) { fresh.push([d].concat(vals, [clean_(r[n + 1]), new Date()])); byDate[ds] = -1; added++; return; }
        if (at < 0) { skipped++; return; }
        var row = data[at], ch = false;
        vals.forEach(function (v, j) { if (v && !row[j + 1]) { row[j + 1] = v; ch = true; } });
        if (!row[n + 1] && clean_(r[n + 1])) { row[n + 1] = clean_(r[n + 1]); ch = true; }
        if (ch) { updated++; row[n + 2] = new Date(); } else skipped++;
      });
      if (updated) ps.getRange(2, 1, data.length, n + 3).setValues(data);
      if (fresh.length) ps.getRange(ps.getLastRow() + 1, 1, fresh.length, n + 3).setValues(fresh);
    } else if (kind === 'reading') {
      var rs = sheet_(SH.READING), rid = {}, nid = nextId_(rs), outR = [];
      if (rs.getLastRow() > 1) rs.getRange(2, 1, rs.getLastRow() - 1, 1).getValues().forEach(function (r) { rid[String(r[0])] = 1; });
      rows.forEach(function (r) {
        var d = toDate(r[1]); if (!d || !clean_(r[2])) { skipped++; return; }
        if (r[0] !== '' && rid[String(r[0])]) { skipped++; return; }
        var row = [nid++, d].concat(r.slice(2, 14).map(function (c) { return c == null ? '' : c; }));
        while (row.length < 14) row.push('');
        row.push(new Date()); outR.push(row.slice(0, 15));
      });
      if (outR.length) rs.getRange(rs.getLastRow() + 1, 1, outR.length, 15).setValues(outR);
      added = outR.length;
    } else throw new Error('Неизвестный тип импорта');
    if (kind === 'finance' && added) recomputeFlow_();
    return { added: added, updated: updated, skipped: skipped };
  });
}

// ── Telegram: токен бота хранится в свойствах скрипта (TG_TOKEN), не в коде и не на телефоне
var PRAYER_NAMES_ = {
  ru: { fajr: 'Фаджр', duha: 'Духа', zuhr: 'Зухр', asr: 'Аср', maghrib: 'Магриб', isha: 'Иша', witr: 'Витр' },
  en: { fajr: 'Fajr', duha: 'Duha', zuhr: 'Dhuhr', asr: 'Asr', maghrib: 'Maghrib', isha: 'Isha', witr: 'Witr' },
  tj: { fajr: 'Бомдод', duha: 'Чошт', zuhr: 'Пешин', asr: 'Аср', maghrib: 'Шом', isha: 'Хуфтан', witr: 'Витр' }
};
var TG_TEXT_ = {
  ru: { start: 'Начало времени молитвы', soon: 'Через {m} мин — время молитвы', pay: 'Платежи', today: 'сегодня', overdue: 'просрочено',
        inDays: 'через {d} дн.', tomorrow: 'завтра', linked: '✅ myTracker подключён. Сюда будут приходить напоминания.', test: '🔔 Проверка: напоминания myTracker работают.',
        budget: 'Лимит превышен', of: 'из', auto: 'добавится автоматически' },
  en: { start: 'Prayer time has started', soon: 'Prayer time in {m} min', pay: 'Payments', today: 'today', overdue: 'overdue',
        inDays: 'in {d} days', tomorrow: 'tomorrow', linked: '✅ myTracker is connected. Reminders will arrive here.', test: '🔔 Test: myTracker reminders work.',
        budget: 'Budget exceeded', of: 'of', auto: 'will be added automatically' }
};
function notifyCfg_() {
  var n = config_().notify || {};
  return { tg: !!n.tg, lang: n.lang === 'en' ? 'en' : 'ru', prayers: n.prayers || { fajr: true, zuhr: true, asr: true, maghrib: true, isha: true },
           before: Math.max(0, Number(n.before) || 0), payments: n.payments !== false, hour: Math.min(23, Math.max(0, Number(n.hour == null ? 8 : n.hour))),
           budgets: n.budgets !== false, qrev: n.qrev || null, qmemo: n.qmemo || null };
}
/**
 * Запустите один раз из редактора (▶ authorize), чтобы Google спросил разрешение
 * «подключаться к внешним сервисам» — без него Telegram не работает.
 */
function authorize() {
  UrlFetchApp.fetch('https://api.telegram.org', { muteHttpExceptions: true });
  ScriptApp.getProjectTriggers();
  // без всплывающего окна: из редактора оно ждёт нажатия «ОК» во вкладке таблицы и выполнение «зависает»
  Logger.log('Готово: разрешения выданы. Теперь в приложении нажмите ⚙ → Напоминания → «Подключить».');
}
/** Понятное сообщение, если владелец ещё не разрешил внешние запросы. */
function fetch_(url, opts) {
  try { return UrlFetchApp.fetch(url, opts || {}); }
  catch (e) {
    if (/permission|разрешени|external_request/i.test(String(e && e.message))) {
      throw new Error('Google ещё не разрешил скрипту обращаться к Telegram. Откройте Apps Script, выберите функцию authorize и нажмите ▶ Выполнить → «Проверить разрешения» → «Разрешить». Потом нажмите «Подключить» ещё раз.');
    }
    throw e;
  }
}
function tgSend_(text) {
  var p = PropertiesService.getScriptProperties(), tok = p.getProperty('TG_TOKEN'), chat = p.getProperty('TG_CHAT');
  if (!tok || !chat) return false;
  var r = fetch_('https://api.telegram.org/bot' + tok + '/sendMessage', { method: 'post', muteHttpExceptions: true,
    contentType: 'application/json', payload: JSON.stringify({ chat_id: chat, text: text, parse_mode: 'HTML', disable_web_page_preview: true }) });
  return r.getResponseCode() === 200;
}
function tgState_() {
  var p = PropertiesService.getScriptProperties();
  return { hasToken: !!p.getProperty('TG_TOKEN'), linked: !!p.getProperty('TG_CHAT') };
}
/** Для приложения: состояние Telegram и расписание напоминаний на сегодня. */
function tgStatus_() {
  var st = tgState_(), cfg = notifyCfg_(), plan = alertPlan_(), sent = {};
  try { sent = JSON.parse(PropertiesService.getScriptProperties().getProperty('ALERTS_SENT') || '{}'); } catch (e) {}
  var keys = sent.date === plan.date ? sent.keys || [] : [];
  st.on = cfg.tg; st.hasTimes = plan.hasTimes; st.date = plan.date;
  st.today = plan.items.map(function (a) { return { k: a.k, time: hhmm_(a.start), at: hhmm_(a.start - cfg.before), sent: keys.indexOf(a.k) >= 0 }; });
  st.sweep = ScriptApp.getProjectTriggers().some(function (t) { return t.getHandlerFunction() === 'notifySweep'; });
  return st;
}
/** Привязка: пользователь пишет боту /start, затем нажимает «Подключить» в приложении. */
function tgLink_() {
  var p = PropertiesService.getScriptProperties(), tok = p.getProperty('TG_TOKEN');
  if (!tok) throw new Error('Добавьте свойство TG_TOKEN в Apps Script (см. README)');
  var r = fetch_('https://api.telegram.org/bot' + tok + '/getUpdates?limit=50', { muteHttpExceptions: true });
  if (r.getResponseCode() !== 200) throw new Error('Telegram не принял токен бота');
  var ups = (JSON.parse(r.getContentText()).result || []).filter(function (u) { return u.message && u.message.chat && u.message.chat.type === 'private'; });
  if (!ups.length) throw new Error('Напишите боту /start в Telegram и нажмите ещё раз');
  p.setProperty('TG_CHAT', String(ups[ups.length - 1].message.chat.id));
  tgSend_(TG_TEXT_[notifyCfg_().lang].linked);
  try { installNotifyTriggers_(); } catch (e) {}
  return tgStatus_();
}
function tgQuranTest_() {
  var en = notifyCfg_().lang === 'en', r = revisionText_(en), m = memoText_(en);
  if (!tgSend_('🧪 ' + (en ? 'Quran plan' : 'План Корана') + '\n\n🔁 ' + (r || (en ? 'No revision plan' : 'Плана повторения нет')) + '\n\n📗 ' + (m || (en ? 'No memorization task' : 'Задания на заучивание нет')))) throw new Error('Не удалось отправить. Подключите Telegram заново');
  return { ok: true };
}
function tgTest_() { if (!tgSend_(TG_TEXT_[notifyCfg_().lang].test)) throw new Error('Не удалось отправить. Подключите Telegram заново'); return tgStatus_(); }
function tgUnlink_() { PropertiesService.getScriptProperties().deleteProperty('TG_CHAT'); try { installNotifyTriggers_(); } catch (e) {} return tgStatus_(); }

/** Начала молитв на дату (минуты от полуночи) по листу «Времена молитв». Духа — через 20 минут после восхода. */
function prayerStarts_(dateStr) {
  var row = prayerTimes_().filter(function (x) { return x.date === dateStr; })[0];
  if (!row) return {};
  var st = function (s) { var m = /(\d{1,2})[:.](\d{2})/.exec(s || ''); return m ? Number(m[1]) * 60 + Number(m[2]) : null; };
  var end = function (s) { var parts = String(s || '').split(/\s*[-–—]\s*/); return st(parts[1]); };
  var out = { fajr: st(row.fajr), zuhr: st(row.zuhr), asr: st(row.asr), maghrib: st(row.maghrib), isha: st(row.isha) };
  var sunrise = end(row.fajr); if (sunrise != null) out.duha = sunrise + 20;
  return out;
}
/** Ставит на сегодня одноразовые триггеры на начало молитв и ежедневное напоминание о платежах. */
function installNotifyTriggers_() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    var h = t.getHandlerFunction();
    if (h === 'prayerAlert' || h === 'paymentReminder' || h === 'notifySweep' || h === 'quranRevReminder' || h === 'quranMemoReminder') ScriptApp.deleteTrigger(t);
  });
  var cfg = notifyCfg_(), st = tgState_(), props = PropertiesService.getScriptProperties();
  if (!st.linked) { props.deleteProperty('ALERTS'); return 0; }
  // напоминания о повторении и заучивании Корана в выбранное время (включаются отдельно, в ⚙ → Коран)
  [['qrev', 'quranRevReminder'], ['qmemo', 'quranMemoReminder']].forEach(function (x) {
    var q = cfg[x[0]]; if (!q || !q.on) return;
    var m = /^(\d{1,2}):(\d{2})$/.exec(q.time || ''), hh = m ? Number(m[1]) : 6, mm = m ? Number(m[2]) : 0;
    ScriptApp.newTrigger(x[1]).timeBased().atHour(hh).nearMinute(mm).everyDays(1).inTimezone(tz_()).create();
  });
  if (!cfg.tg) { props.deleteProperty('ALERTS'); return 0; }
  ScriptApp.newTrigger('paymentReminder').timeBased().atHour(cfg.hour).everyDays(1).inTimezone(tz_()).create();
  // подстраховка: раз в 10 минут проверяем, не пропущено ли напоминание (и ставим расписание, если ночью не поставилось)
  ScriptApp.newTrigger('notifySweep').timeBased().everyMinutes(10).create();
  var plan = alertPlan_(), now = Date.now();
  props.setProperty('ALERTS', JSON.stringify({ date: plan.date, items: plan.items }));
  plan.items.forEach(function (a) { if (a.at > now + 30000) ScriptApp.newTrigger('prayerAlert').timeBased().at(new Date(a.at)).create(); });
  return plan.items.length;
}
/** Расписание напоминаний на сегодня: [{k, start (мин), at (мс)}]. */
function alertPlan_() {
  var cfg = notifyCfg_(), now = new Date(), today = fmtDate_(now), base = new Date(now);
  base.setHours(0, 0, 0, 0);
  var starts = prayerStarts_(today), items = [];
  Object.keys(starts).forEach(function (k) {
    if (!cfg.prayers[k] || starts[k] == null) return;
    items.push({ k: k, start: starts[k], at: base.getTime() + (starts[k] - cfg.before) * 60000 });
  });
  items.sort(function (a, b) { return a.at - b.at; });
  return { date: today, items: items, hasTimes: Object.keys(starts).length > 0 };
}
function hhmm_(m) { m = ((m % 1440) + 1440) % 1440; return ('0' + Math.floor(m / 60)).slice(-2) + ':' + ('0' + (m % 60)).slice(-2); }
/** Отправить все напоминания, время которых наступило (не позже 25 минут назад) и которые ещё не отправлены. */
function sendDueAlerts_() {
  var cfg = notifyCfg_(); if (!cfg.tg || !tgState_().linked) return 0;
  var props = PropertiesService.getScriptProperties(), plan = alertPlan_(), now = Date.now();
  var sent = JSON.parse(props.getProperty('ALERTS_SENT') || '{}');
  if (sent.date !== plan.date) sent = { date: plan.date, keys: [] };
  var T = TG_TEXT_[cfg.lang], names = customPrayerNames_(cfg.lang), n = 0;
  plan.items.forEach(function (a) {
    if (a.at > now + 60000 || now - a.at > 25 * 60000 || sent.keys.indexOf(a.k) >= 0) return;
    var head = cfg.before ? T.soon.replace('{m}', cfg.before) : T.start;
    if (tgSend_('🕌 <b>' + names[a.k] + '</b> · ' + hhmm_(a.start) + '\n' + head)) { sent.keys.push(a.k); n++; }
  });
  props.setProperty('ALERTS_SENT', JSON.stringify(sent));
  return n;
}
/**
 * Тест автонапоминания: ставит такой же будильник Google, как для молитв, через N минут.
 * Если сообщение пришло само — значит, напоминания о молитвах тоже будут приходить.
 */
function tgTestLater_(req) {
  if (!tgState_().linked) throw new Error('Сначала подключите Telegram');
  var min = Math.min(30, Math.max(1, Number(req && req.minutes) || 2)), at = new Date(Date.now() + min * 60000);
  ScriptApp.getProjectTriggers().forEach(function (t) { if (t.getHandlerFunction() === 'testAlert') ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger('testAlert').timeBased().at(at).create();
  PropertiesService.getScriptProperties().setProperty('TEST_ALERT', JSON.stringify({ at: at.getTime(), made: Date.now() }));
  return { at: Utilities.formatDate(at, tz_(), 'HH:mm') };
}
function testAlert(e) {
  if (e && e.triggerUid) ScriptApp.getProjectTriggers().forEach(function (t) { if (t.getUniqueId() === e.triggerUid) ScriptApp.deleteTrigger(t); });
  var p = PropertiesService.getScriptProperties(), t = {};
  try { t = JSON.parse(p.getProperty('TEST_ALERT') || '{}'); } catch (x) {}
  p.deleteProperty('TEST_ALERT');
  var cfg = notifyCfg_(), en = cfg.lang === 'en', f = function (ms) { return Utilities.formatDate(new Date(ms), tz_(), 'HH:mm'); };
  var plan = alertPlan_(), now = Date.now(), names = customPrayerNames_(cfg.lang);
  var next = plan.items.filter(function (a) { return a.at > now; }).map(function (a) { return names[a.k] + ' ' + hhmm_(a.start - cfg.before); });
  tgSend_('🧪 <b>' + (en ? 'Automatic reminder test' : 'Тест автонапоминания') + '</b>\n' +
    (en ? 'Ordered at ' : 'Заказан в ') + (t.made ? f(t.made) : '—') + (en ? ', arrived at ' : ', пришёл в ') + f(now) + '.\n' +
    (!cfg.tg ? (en ? '⚠️ Telegram reminders are OFF in the app settings.' : '⚠️ Напоминания в Telegram выключены в настройках приложения.')
      : !plan.hasTimes ? (en ? '⚠️ No row for today in the prayer times sheet.' : '⚠️ На сегодня нет строки в листе «Времена молитв».')
      : next.length ? (en ? 'Next today: ' : 'Дальше сегодня: ') + next.join(', ') : (en ? 'No more prayer reminders today.' : 'На сегодня напоминаний о молитвах больше нет.')));
}
/** Срабатывает в начале молитвы (одноразовый триггер). */
function prayerAlert(e) {
  if (e && e.triggerUid) ScriptApp.getProjectTriggers().forEach(function (t) { if (t.getUniqueId() === e.triggerUid) ScriptApp.deleteTrigger(t); });
  withLock_(sendDueAlerts_);
}
/** Каждые 10 минут: досылает пропущенное и раз в сутки обновляет расписание. */
function notifySweep() {
  var props = PropertiesService.getScriptProperties(), al = {};
  try { al = JSON.parse(props.getProperty('ALERTS') || '{}'); } catch (e) {}
  if (al.date !== fmtDate_(new Date())) { installNotifyTriggers_(); }
  withLock_(sendDueAlerts_);
}
/**
 * Проверка напоминаний: запустите из редактора (▶ checkReminders) — в журнале будет видно,
 * подключён ли Telegram, найдено ли сегодняшнее время молитв и какие напоминания стоят.
 */
function checkReminders() {
  var st = tgState_(), cfg = notifyCfg_(), plan = alertPlan_();
  Logger.log('Telegram: токен ' + (st.hasToken ? 'есть' : 'НЕТ') + ', чат ' + (st.linked ? 'подключён' : 'НЕ подключён') + ', напоминания ' + (cfg.tg ? 'включены' : 'ВЫКЛЮЧЕНЫ'));
  Logger.log('Сегодня ' + plan.date + ': ' + (plan.hasTimes ? plan.items.map(function (a) { return a.k + ' ' + hhmm_(a.start); }).join(', ') : 'НЕТ строки на сегодня в листе «Времена молитв»'));
  Logger.log('Триггеры: ' + ScriptApp.getProjectTriggers().map(function (t) { return t.getHandlerFunction(); }).join(', '));
  Logger.log('Поставлено напоминаний на сегодня: ' + installNotifyTriggers_());
}

function customPrayerNames_(lang) {
  var pc = config_().prayers || {}, preset = pc.preset || 'ar', names = pc.names || {}, own = PRAYER_NAMES_[lang] || PRAYER_NAMES_.ru, out = {};
  var base = PRAYER_NAMES_[preset] || own, ar = /[\u0600-\u06FF]/;
  Object.keys(own).forEach(function (k) { out[k] = preset === 'custom' && names[k] && !ar.test(names[k]) ? names[k] : base[k]; });
  return out;
}
/** Ежедневно: платежи, у которых сегодня срок, просрочка или скоро напоминание. */
function paymentReminder() {
  var cfg = notifyCfg_(); if (!cfg.tg || !cfg.payments) return;
  var T = TG_TEXT_[cfg.lang], t = fmtDate_(new Date()), lines = [];
  var days = function (a, b) { return Math.round((parseDate_(b) - parseDate_(a)) / 864e5); };
  recurring_().filter(function (r) { return r.active && r.next; }).forEach(function (r) {
    var d = days(t, r.next);
    if (d > r.remind) return;
    if (r.auto && d >= 0) { if (d === 0) lines.push('↻ ' + r.name + ' — ' + r.amount + ' (' + T.auto + ')'); return; }
    lines.push((d < 0 ? '⚠️ ' : d === 0 ? '🔔 ' : '🗓 ') + '<b>' + r.name + '</b> — ' + r.amount + ' · ' + (d < 0 ? T.overdue : d === 0 ? T.today : d === 1 ? T.tomorrow : T.inDays.replace('{d}', d)));
  });
  if (lines.length) tgSend_('💳 <b>' + T.pay + '</b>\n' + lines.join('\n'));
}
/** После новых расходов: сообщить в Telegram о превышении месячного лимита. */
function budgetAlerts_(rows) {
  try {
    var cfg = notifyCfg_(); if (!cfg.tg || !cfg.budgets || !tgState_().linked) return;
    var budgets = (config_().budgets || {}).items || []; if (!budgets.length) return;
    var month = fmtDate_(new Date()).slice(0, 7), touched = {};
    rows.forEach(function (r) { if (fmtDate_(r[0]).slice(0, 7) === month) touched[r[2] + '|' + r[3]] = (touched[r[2] + '|' + r[3]] || 0) + r[1]; });
    var fi = sheet_(SH.FINANCE), spent = {};
    if (fi.getLastRow() > 1) fi.getRange(2, 2, fi.getLastRow() - 1, 4).getValues().forEach(function (r) {
      if (r[0] instanceof Date && fmtDate_(r[0]).slice(0, 7) === month) spent[r[2] + '|' + r[3]] = (spent[r[2] + '|' + r[3]] || 0) + Number(r[1]);
    });
    var T = TG_TEXT_[cfg.lang], msgs = [];
    budgets.forEach(function (b) {
      var k = (b.action || FIN.EXPENSE) + '|' + b.category, add = touched[k]; if (!add || !(b.limit > 0)) return;
      var now = spent[k] || 0; if (now > b.limit && now - add <= b.limit) msgs.push('⚠️ <b>' + b.category + '</b>: ' + now + ' ' + T.of + ' ' + b.limit);
    });
    if (msgs.length) tgSend_('💰 <b>' + T.budget + '</b>\n' + msgs.join('\n'));
  } catch (e) {}
}

// ───────────────────────────── План Корана (для напоминаний в Telegram) ─────────────────────────────
// Та же логика, что в приложении: повторяются страницы, которые дольше всех не повторяли.
var SURA_PAGE_ = [1, 2, 50, 77, 106, 128, 151, 177, 187, 208, 221, 235, 249, 255, 262, 267, 282, 293, 305, 312, 322, 332, 342, 350, 359, 367, 377, 385, 396, 404,
  411, 415, 418, 428, 434, 440, 446, 453, 458, 467, 477, 483, 489, 496, 499, 502, 507, 511, 515, 518, 520, 523, 526, 528, 531, 534, 537, 542, 545, 549,
  551, 553, 554, 556, 558, 560, 562, 564, 566, 568, 570, 572, 574, 575, 577, 578, 580, 582, 583, 585, 586, 587, 587, 589, 590, 591, 591, 592, 593, 594,
  595, 595, 596, 596, 597, 597, 598, 598, 599, 599, 600, 600, 601, 601, 601, 602, 602, 602, 603, 603, 603, 604, 604, 604];
var JUZ_START_ = [1, 22, 42, 62, 82, 102, 121, 142, 162, 182, 201, 222, 242, 262, 282, 302, 322, 342, 362, 382, 402, 422, 442, 462, 482, 502, 522, 542, 562, 582];
var LINES_ = 15;
function suraPages_(n) { var a = SURA_PAGE_[n - 1], nx = n < 114 ? SURA_PAGE_[n] : 605; return [a, Math.max(a, nx - 1)]; }
function juzOf_(p) { var j = 1; JUZ_START_.forEach(function (s, i) { if (p >= s) j = i + 1; }); return j; }
function juzPages_(j) { return [JUZ_START_[j - 1], j < 30 ? JUZ_START_[j] - 1 : 604]; }
function planCfg_() {
  var c = config_().plan || {};
  var rev = { method: 'cycle', days: 10, amount: 1, unit: 'juz', recent: 20, oldDays: 7 }, memo = { on: false, amount: 5, unit: 'lines', order: 'forward', start: 1, pos: null, lastDone: '', lastTask: '' };
  Object.keys(c.rev || {}).forEach(function (k) { rev[k] = c.rev[k]; });
  Object.keys(c.memo || {}).forEach(function (k) { memo[k] = c.memo[k]; });
  return { rev: rev, memo: memo };
}
/** Заученные страницы, дата последнего повторения (до сегодня) и дата заучивания. */
function quranState_() {
  var kinds = refValues_(REFC.KIND).map(function (r) { return String(r[0]); }), KM = kinds[1] || 'Заучивание', KR = kinds[2] || 'Повторение';
  var t = fmtDate_(new Date()), mem = {}, prev = {}, memDate = {}, todayRev = {}, h = config_().hifz || {};
  var addRange = function (a, b, fn) { for (var p = Math.max(1, a); p <= Math.min(604, b); p++) fn(p); };
  String(h.pages || '').split(/[,;\s]+/).forEach(function (part) {
    var m = /^(\d{1,3})(?:[-–](\d{1,3}))?$/.exec(part.trim()); if (!m) return;
    addRange(Number(m[1]), Number(m[2] || m[1]), function (p) { mem[p] = 1; if (h.date) prev[p] = h.date; });
  });
  (h.suras || []).forEach(function (n) { var r = suraPages_(n); addRange(r[0], r[1], function (p) { mem[p] = 1; if (h.date) prev[p] = h.date; }); });
  readAll_(SH.READING, 14, 1).forEach(function (r) {
    if (r[2] !== KM && r[2] !== KR) return;
    var a = r[4] !== '' ? Number(r[4]) : null, b = r[5] !== '' ? Number(r[5]) : null;
    if (a == null && r[9] !== '') { var sp = suraPages_(Number(r[9])); a = sp[0]; b = sp[1]; }
    if (a == null) return;
    addRange(a, b, function (p) {
      if (r[2] === KM) { mem[p] = 1; if (!memDate[p] || r[1] > memDate[p]) memDate[p] = r[1]; }
      if (r[1] < t && (!prev[p] || r[1] > prev[p])) prev[p] = r[1];
      if (r[1] === t && r[2] === KR) todayRev[p] = 1;
    });
  });
  return { mem: Object.keys(mem).map(Number).sort(function (x, y) { return x - y; }), prev: prev, memDate: memDate, todayRev: todayRev, today: t };
}
function pageRanges_(list) {
  var s = list.slice().sort(function (a, b) { return a - b; }), out = [];
  s.forEach(function (p) { var r = out[out.length - 1]; if (r && p === r[1] + 1) r[1] = p; else if (!r || p !== r[1]) out.push([p, p]); });
  return out;
}
function rangeText_(r, en) {
  var ja = juzOf_(r[0]), jb = juzOf_(r[1]), full = juzPages_(ja)[0] === r[0] && juzPages_(jb)[1] === r[1];
  var pages = (en ? 'p. ' : 'стр. ') + (r[0] === r[1] ? r[0] : r[0] + '–' + r[1]);
  return full ? (en ? 'Juz ' : 'Джуз ') + (ja === jb ? ja : ja + '–' + jb) + ' (' + pages + ')' : pages;
}
/** Текст задания на повторение на сегодня. */
function revisionText_(en) {
  var P = planCfg_().rev, memo = planCfg_().memo; if (P.method === 'off') return '';
  var S = quranState_(), mem = S.mem.filter(function (p) { return !(S.memDate[p] === S.today && !S.prev[p]); });
  if (!mem.length) return '';
  var oldest = function (list, k) {
    return list.slice().sort(function (a, b) { var x = S.prev[a] || '', y = S.prev[b] || ''; return x < y ? -1 : x > y ? 1 : a - b; }).slice(0, Math.max(0, k));
  };
  var k = 0, recent = [], portion = [];
  if (P.method === 'cycle') k = Math.ceil(mem.length / Math.max(1, P.days));
  else if (P.method === 'fixed') k = P.unit === 'juz' ? Math.round(P.amount * 20) : Math.round(P.amount);
  else if (P.method === 'ratio') k = memo.unit === 'pages' ? memo.amount * LINES_ : memo.amount;
  if (P.method === 'sabqi') {
    recent = mem.slice().sort(function (a, b) { var x = S.memDate[a] || '', y = S.memDate[b] || ''; return x > y ? -1 : x < y ? 1 : b - a; }).slice(0, P.recent);
    var rest = mem.filter(function (p) { return recent.indexOf(p) < 0; });
    portion = oldest(rest, Math.ceil(rest.length / Math.max(1, P.oldDays)));
  } else portion = oldest(mem, Math.min(k, mem.length));
  // уже повторённое сегодня (например, прочитали заранее) в напоминание не включаем
  recent = recent.filter(function (p) { return !S.todayRev[p]; }); portion = portion.filter(function (p) { return !S.todayRev[p]; });
  if (!recent.length && !portion.length) return '';
  var parts = [];
  if (recent.length) parts.push((en ? 'Sabqi: ' : 'Сабки: ') + pageRanges_(recent).map(function (r) { return rangeText_(r, en); }).join(', '));
  if (portion.length) parts.push((recent.length ? (en ? 'Manzil: ' : 'Манзил: ') : '') + pageRanges_(portion).map(function (r) { return rangeText_(r, en); }).join(', '));
  return parts.join('\n') + '\n' + (en ? 'Total: ' : 'Всего: ') + (recent.length + portion.length) + (en ? ' p.' : ' стр.');
}
/** Текст задания на заучивание на сегодня. */
function memoText_(en) {
  var M = planCfg_().memo; if (!M.on) return '';
  var S = quranState_(), t = S.today, memSet = {}; S.mem.forEach(function (p) { memSet[p] = 1; });
  if (M.lastDone === t) return '';
  var seq = [];
  if (M.order === 'juz-back') { for (var j = 30; j >= 1; j--) { var jp = juzPages_(j); for (var q = jp[0]; q <= jp[1]; q++) seq.push(q); } }
  else for (var q2 = 1; q2 <= 604; q2++) seq.push(q2);
  var pos = M.pos && M.pos.p ? { p: M.pos.p, l: M.pos.l } : { p: Number(M.start) || seq[0], l: 1 }, i = seq.indexOf(pos.p), guard = 0;
  while (pos.l === 1 && memSet[pos.p] && guard++ < 604) { i++; if (i >= seq.length) return ''; pos = { p: seq[i], l: 1 }; }
  var left = M.unit === 'pages' ? M.amount * LINES_ : M.amount, p = pos.p, l = pos.l, parts = [];
  guard = 0;
  while (left > 0 && p && guard++ < 700) {
    var take = Math.min(left, LINES_ - l + 1);
    parts.push(l === 1 && take === LINES_ ? (en ? 'p. ' : 'стр. ') + p : (en ? 'p. ' + p + ', lines ' : 'стр. ' + p + ', строки ') + l + '–' + (l + take - 1));
    left -= take; l += take;
    if (l > LINES_) { i++; p = i < seq.length ? seq[i] : null; l = 1; while (p && memSet[p] && i < seq.length - 1) { i++; p = seq[i]; } }
  }
  return parts.join(' · ');
}
function quranRevReminder() {
  var cfg = notifyCfg_(); if (!cfg.qrev || !cfg.qrev.on) return;
  var en = cfg.lang === 'en', txt = revisionText_(en);
  if (txt) tgSend_('🔁 <b>' + (en ? 'Revision today' : 'Повторение на сегодня') + '</b>\n' + txt);
}
function quranMemoReminder() {
  var cfg = notifyCfg_(); if (!cfg.qmemo || !cfg.qmemo.on) return;
  var en = cfg.lang === 'en', txt = memoText_(en);
  if (txt) tgSend_('📗 <b>' + (en ? 'Memorize today' : 'Выучить сегодня') + '</b>\n' + txt + '\n' + (en ? 'Open the app and tap «✓ Memorized» when done.' : 'Когда выучите — нажмите «✓ Выучил» в приложении.'));
}

// ───────────────────────────── Загрузка всех данных одним запросом ─────────────────────────────
// Версия данных меняется при каждой записи и при ручной правке таблицы.
function dataVersion_() { return PropertiesService.getScriptProperties().getProperty('DATA_VER') || '0'; }
function bumpVersion_() { PropertiesService.getScriptProperties().setProperty('DATA_VER', String(Date.now())); }

/** Читает лист целиком: даты → «yyyy-mm-dd», только строки с датой. */
function readAll_(name, width, dateCol) {
  var sh = sheet_(name), last = sh.getLastRow();
  if (last < 2) return [];
  return sh.getRange(2, 1, last - 1, width).getValues()
    .filter(function (r) { return r[dateCol] instanceof Date; })
    .map(function (r) { return r.map(function (c) { return c instanceof Date ? fmtDate_(c) : c; }); });
}

/**
 * Всё для приложения одним запросом. Если у телефона уже есть актуальная версия
 * (req.ver совпадает) — отвечаем коротко «без изменений», таблицу не читаем.
 */
function bootstrap_(req) {
  var ver = dataVersion_();
  if (req.ver && String(req.ver) === ver) return { unchanged: true, ver: ver };
  return {
    ver: ver,
    meta: meta_(),
    times: prayerTimes_(),
    data: {
      prayers: readAll_(SH.PRAYERS, 2 + PRAYER_KEYS.length, 0),   // дата, 7 статусов, комментарий
      reading: readAll_(SH.READING, 14, 1),
      finance: readAll_(SH.FINANCE, 11, 1)   // … 8 = счёт, 9 = на счёт, 10 = человек (для долгов)
    }
  };
}

/** Простой триггер: ручная правка таблицы сбрасывает версию, а в «Финансах» пересчитывает «Поток ±». */
function onEdit(e) {
  try {
    bumpVersion_();
    if (!e || !e.range) return;
    var sh = e.range.getSheet(), name = sh.getName();
    if (name === SH.FINANCE && e.range.getColumn() <= 5 && e.range.getLastRow() > 1) {
      SS_ = sh.getParent();
      recomputeFlow_(e.range.getRow(), e.range.getNumRows());
    }
    if (name === SH.REF && e.range.getColumn() <= REFC.FLOW) { SS_ = sh.getParent(); recomputeFlow_(); }
  } catch (err) {}
}

/** Ночное обслуживание: пересчёт «Поток ±» (на случай вставки строк вручную). */
function nightly() {
  recomputeFlow_();
  try { processRecurring_(); } catch (e) { Logger.log(e); }
  try { installNotifyTriggers_(); } catch (e) { Logger.log(e); }
}

function installNightly_() {
  ScriptApp.getProjectTriggers().forEach(function (t) { if (t.getHandlerFunction() === 'nightly') ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger('nightly').timeBased().atHour(CFG.NIGHTLY_HOUR).everyDays(1).inTimezone(Session.getScriptTimeZone()).create();
}
