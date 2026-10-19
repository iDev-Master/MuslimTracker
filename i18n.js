/*
 * myTracker — язык интерфейса (русский / English).
 * Тексты пишутся в коде по-русски. Если выбран английский, всё, что появляется на экране,
 * переводится по словарю ниже: точные фразы, шаблоны с числами и части строк через « · ».
 * Названия, которые ввёл сам пользователь (свои категории, комментарии), не меняются.
 */
(function () {
  'use strict';
  let lang = 'ru';
  try {
    const s = JSON.parse(localStorage.getItem('lt_settings') || '{}');
    lang = s.lang || (/^en/i.test(navigator.language || '') ? 'en' : 'ru');
  } catch (e) {}
  document.documentElement.lang = lang;

  const DICT = {};      // точные фразы: 'Русский' → 'English'
  const PATTERNS = [];  // [RegExp, замена]
  let sorted = false;
  const add = (obj) => Object.assign(DICT, obj);
  const pat = (re, to) => PATTERNS.push([re, to]);

  function tr1(s) {
    if (Object.prototype.hasOwnProperty.call(DICT, s)) return DICT[s];
    if (!sorted) { PATTERNS.sort((a, b) => b[0].source.length - a[0].source.length); sorted = true; } // сначала самые точные шаблоны
    for (const [re, to] of PATTERNS) { if (re.test(s)) return s.replace(re, to); }
    // значок или знак в начале: «💵 Наличные», «· Авто»
    const m = /^([^A-Za-zА-Яа-яЁё0-9«]+)(.+)$/.exec(s);
    if (m) { const x = tr1(m[2]); if (x != null) return m[1] + x; }
    return null;
  }
  /** Перевод строки: целиком, по шаблону или по частям через « · », «: », « — ». */
  function tr(text) {
    if (lang !== 'en' || text == null) return text;
    const str = String(text);
    if (!/[А-Яа-яЁё]/.test(str)) return str;
    const m = /^(\s*)([\s\S]*?)(\s*)$/.exec(str), core = m[2];
    let out = Object.prototype.hasOwnProperty.call(DICT, core) ? DICT[core] : null;
    if (out == null && core.indexOf(' · ') > 0) { // части через « · » переводим по отдельности
      const parts = core.split(' · '), done = parts.map((p) => { const x = tr1(p.trim()); return x == null ? p : p.replace(p.trim(), x); });
      if (done.some((x, i) => x !== parts[i])) out = done.join(' · ');
    }
    if (out == null) out = tr1(core);
    if (out == null) {
      for (const sep of [' — ', ': ', ' / ']) {
        if (core.indexOf(sep) > 0) {
          const parts = core.split(sep), done = parts.map((p) => { const x = tr1(p.trim()); return x == null ? p : p.replace(p.trim(), x); });
          if (done.some((x, i) => x !== parts[i])) { out = done.join(sep); break; }
        }
      }
    }
    return out == null ? str : m[1] + out + m[3];
  }

  const ATTRS = ['placeholder', 'title', 'aria-label'];
  const SKIP = { SCRIPT: 1, STYLE: 1, TEXTAREA: 1 };
  function node(n) {
    if (n.nodeType === 3) {
      const p = n.parentNode;
      if (!p || SKIP[p.nodeName] || (p.closest && p.closest('[data-noi18n]'))) return;
      const v = n.nodeValue, t = tr(v);
      if (t !== v) n.nodeValue = t;
    } else if (n.nodeType === 1) {
      if (n.nodeName === 'SCRIPT' || n.nodeName === 'STYLE' || n.hasAttribute('data-noi18n')) return;
      ATTRS.forEach((a) => { const v = n.getAttribute(a); if (v) { const t = tr(v); if (t !== v) n.setAttribute(a, t); } });
      if (n.nodeName === 'INPUT' && (n.type === 'button' || n.type === 'submit') && n.value) n.value = tr(n.value);
      if (n.nodeName === 'OPTION') { const t = tr(n.textContent); if (t !== n.textContent) n.textContent = t; return; }
      if (n.nodeName === 'TEXTAREA') return;
      for (let c = n.firstChild; c; c = c.nextSibling) node(c);
    }
  }
  function start() {
    if (lang !== 'en') return;
    node(document.body);
    document.title = tr(document.title);
    new MutationObserver((list) => {
      list.forEach((m) => {
        if (m.type === 'characterData') node(m.target);
        else if (m.type === 'attributes') { if (ATTRS.indexOf(m.attributeName) >= 0) node(m.target.nodeType === 1 ? m.target : m.target.parentNode); }
        else m.addedNodes.forEach(node);
      });
    }).observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ATTRS });
  }


  // ───────────────────────────── English ─────────────────────────────
  add({
    // общее
    'Молитвы': 'Prayers', 'Коран': 'Quran', 'Финансы': 'Finance', 'Дашборды': 'Dashboards', 'Дашборд': 'Dashboard',
    'Настройки': 'Settings', 'Выйти': 'Log out', 'Войти': 'Log in', 'Пароль': 'Password', 'Закрыть': 'Close',
    'Сохранить': 'Save', 'Отмена': 'Cancel', 'Отменить': 'Cancel', 'Удалить': 'Delete', 'Шрифты © Комплекс короля Фахда (KFGQPC), через QUL / Tarteel. Разметка строк — QUL; текст «Усмани» — quran-text (quran.ws), CC BY 4.0.': 'Fonts © King Fahd Complex (KFGQPC), via QUL / Tarteel. Line layout — QUL; «Uthmani» text — quran-text (quran.ws), CC BY 4.0.', 'Изменить': 'Edit', 'Проверить': 'Test',
    'Подключить': 'Connect', 'Переподключить': 'Reconnect', 'Скрыть': 'Hide', 'Убрать': 'Remove', 'Выше': 'Up', 'Ниже': 'Down',
    'Молитвы · Коран · Финансы': 'Prayers · Quran · Finance', 'Язык / Language': 'Language',
    'Дата': 'Date', 'Комментарий': 'Comment', 'Необязательно': 'Optional', 'Сумма': 'Amount', 'Действие': 'Action', 'Категория': 'Category',
    'Иконка': 'Icon', 'Название': 'Name', 'Вид': 'Kind', 'Тип': 'Type', 'Всего': 'Total', 'Сегодня': 'Today', 'Завтра': 'Tomorrow',
    'Неделя': 'Week', 'Месяц': 'Month', 'Год': 'Year', 'Всё': 'All', 'Прошлый': 'Last month', '10 дней': '10 days', '7 дней': '7 days',
    'Всё время': 'All time', 'За всё время': 'All time', 'Эта неделя': 'This week', 'Этот месяц': 'This month', 'Прошлый месяц': 'Last month', 'Этот год': 'This year',
    'Сейчас': 'Now', 'Скоро': 'Soon', 'Нет': 'None', 'Ошибка': 'Error', 'Сохранено ✓': 'Saved ✓', 'Изменения отменены': 'Changes discarded',
    'Скрыто из списка': 'Hidden from the list', 'Убрано из списка': 'Removed from the list', 'Отправлено ✓': 'Sent ✓',
    'Предыдущий день': 'Previous day', 'Следующий день': 'Next day', 'Ещё не отправлено': 'Not sent yet', 'Стр.': 'P.',
    'Выйти?': 'Log out?', 'Нажмите, чтобы обновить': 'Tap to update', 'Нажмите, чтобы перезагрузить': 'Tap to reload',
    'Вышла новая версия приложения.': 'A new version of the app is available.', 'Что-то пошло не так.': 'Something went wrong.',
    'Сервер ещё на старой версии: в Apps Script откройте': 'The server is still on the old version: in Apps Script open',
    'Развертывания → Управление → ✏ → Новая версия': 'Deploy → Manage deployments → ✏ → New version',
    'Нет связи с сервером': 'No connection to the server', 'Сервер не ответил': 'The server did not respond', 'Нужно войти': 'Please log in',
    'Укажите API_URL в config.js': 'Set API_URL in config.js', 'Загрузите данные, чтобы редактировать.': 'Load the data to edit.',
    'Войдите снова — неотправленные записи сохранены на телефоне.': 'Log in again — unsent records are kept on this phone.',
    'Неверный пароль': 'Wrong password', 'Нужно войти заново': 'Please log in again', 'Неизвестное действие': 'Unknown action',
    'На сервере не задан APP_PASSWORD': 'APP_PASSWORD is not set on the server', 'Неверная дата': 'Invalid date', 'Неверный запрос': 'Invalid request',
    'Запустите setup() в редакторе Apps Script': 'Run setup() in the Apps Script editor',
    'Запись не найдена (возможно, удалена в таблице)': 'Record not found (it may have been deleted in the sheet)',
    'Сумма должна быть больше 0': 'Amount must be greater than 0', 'Для долга выберите категорию': 'Choose a category for the debt',
    'Название статуса не может быть пустым': 'Status name cannot be empty', 'Названия статусов не должны повторяться': 'Status names must be unique',
    'Количество статусов менять нельзя': 'The number of statuses cannot be changed', 'Укажите название платежа': 'Enter the payment name',
    'Напишите боту /start в Telegram и нажмите ещё раз': 'Send /start to your bot in Telegram and tap again',
    'Telegram не принял токен бота': 'Telegram rejected the bot token', 'Добавьте свойство TG_TOKEN в Apps Script (см. README)': 'Add the TG_TOKEN property in Apps Script (see README)',
    'Не удалось отправить. Подключите Telegram заново': 'Could not send. Reconnect Telegram',
    'Не больше 3000 строк за раз': 'No more than 3000 rows at a time', 'Неизвестный тип импорта': 'Unknown import type',

    // нижнее меню и верх
    'Сохранить день': 'Save the day', 'Добавить запись': 'Add record', 'Сохранить изменения': 'Save changes',
    'и отправить всё неотправленное': 'and send everything unsent',
    '⏳ Сохранено на телефоне, отправляется…': '⏳ Saved on the phone, sending…', '✓ День в таблице': '✓ Day is in the sheet',
    'Новый день — отметьте молитвы': 'New day — mark your prayers',
    '📴 Сохранено на телефоне — отправится, когда появится интернет': '📴 Saved on the phone — will be sent when online',
    '📴 Нет интернета': '📴 Offline', 'Данные сохраняются на телефоне': 'Data is saved on the phone',
    'Нет интернета — отправится автоматически, когда появится связь': 'Offline — will be sent automatically when online',
    'Нет интернета — сохранено на телефоне, отправится автоматически': 'Offline — saved on the phone, will be sent automatically',
    'Данные обновлены ✓': 'Data updated ✓', 'Автоотправка включена': 'Auto-send is on', 'Автоотправка выключена': 'Auto-send is off',

    // молитвы
    'Отметки сохраняются на телефоне сразу. Кнопка ✓ вверху отправляет всё неотправленное — со всех вкладок': 'Marks are saved on the phone right away. The ✓ button at the top sends everything unsent from all tabs',
    'Нажмите на день, чтобы открыть': 'Tap a day to open it', 'Свайп влево — скрыть': 'Swipe left to hide', 'Свайп влево — убрать': 'Swipe left to remove',
    'Нажмите на запись, чтобы изменить': 'Tap a record to edit it', 'Статус для:': 'Status for:', 'Далее:': 'Next:',
    'После восхода': 'After sunrise', 'Время заката': 'Sunset', 'Сегодняшний день месяца': 'today',
    'Заполните лист «Времена молитв» в таблице — здесь появится текущая молитва и её время.': 'Fill in the «Времена молитв» (prayer times) sheet — the current prayer and its time will appear here.',
    'На сегодня нет времени молитв — добавьте строку в лист «Времена молитв».': 'No prayer times for today — add a row to the «Времена молитв» sheet.',
    'Фаджр': 'Fajr', 'Духа': 'Duha', 'Зухр': 'Dhuhr', 'Аср': 'Asr', 'Магриб': 'Maghrib', 'Иша': 'Isha', 'Витр': 'Witr',

    // Коран
    'Что читал': 'What you read', 'Страницы': 'Pages', 'Суры': 'Surahs', 'Сура': 'Surah', 'С стр.': 'From page', 'По стр.': 'To page',
    'Повторов': 'Repetitions', 'Поиск: номер или название': 'Search: number or name', 'Не найдено': 'Not found',
    '✓ вверху — сохранить запись и отправить всё неотправленное': '✓ at the top saves the record and sends everything unsent',
    'Чтение': 'Reading', 'Заучивание': 'Memorization', 'Повторение': 'Revision', 'Укажите дату': 'Enter the date',
    'Выберите хотя бы одну суру': 'Choose at least one surah', 'При редактировании выберите одну суру': 'Choose one surah when editing',
    'Страницы: от 1 до 604, «с» ≤ «по»': 'Pages: 1 to 604, «from» ≤ «to»', 'Нечего отправлять: заполните запись': 'Nothing to send: fill in the record',
    'Запись добавлена ✓': 'Record added ✓', 'Запись обновлена ✓': 'Record updated ✓', 'Изменение неотправленной записи': 'Editing an unsent record',
    'Неотправленная запись удалена': 'Unsent record deleted', 'Запись синхронизируется — попробуйте через несколько секунд': 'The record is syncing — try again in a few seconds',

    // финансы
    'Добавить в список': 'Add to list', 'Сохранить в списке': 'Save in list', 'Новые записи': 'New records', 'Оплатить': 'Pay', 'Пропустить': 'Skip',
    'Хранятся на телефоне до отправки кнопкой ➤ вверху или автоматически': 'Kept on the phone until sent with ➤ at the top or automatically',
    '150 или 27+110': '150 or 27+110', 'На что / кому': 'What for / to whom', 'Счёт / карта': 'Account / card', 'Откуда': 'From', 'Куда': 'To',
    'Расход': 'Expense', 'Доход': 'Income', 'Долг': 'Debt', 'Накопление': 'Savings', 'Перевод': 'Transfer', 'Приход': 'Income', 'Расходы': 'Expenses',
    'Хайр': 'Charity', '🤲 Хайр': '🤲 Charity', 'Остаток': 'Balance', 'Между счетами': 'Between accounts', 'Наличные': 'Cash',
    'Еда': 'Food', 'Транспорт': 'Transport', 'Семья / дом': 'Family / home', 'Лечение / Лекарства': 'Health / medicine',
    'Себе (одежда, приятности и тд)': 'Myself (clothes, treats, etc.)', 'Моби': 'Mobile', 'Спорт': 'Sport', 'Инвестирование': 'Investing',
    'Не нужные расходы': 'Unnecessary spending', 'Другое': 'Other', 'Зарплата': 'Salary', 'Доп. заработок': 'Side income', 'Хизматрасони': 'Services',
    'Подарок': 'Gift', 'Взял в долг': 'Borrowed', 'Погасил свой долг': 'Repaid my debt', 'Дал в долг': 'Lent', 'Вернули мой долг': 'Debt returned to me',
    'Отложил': 'Saved', 'Снял': 'Withdrew', 'Без категории': 'No category', 'Без действия': 'No action', 'Введите сумму': 'Enter the amount',
    'Выберите действие': 'Choose an action', 'Выберите, какой это долг': 'Choose the type of debt', 'Для перевода выберите оба счёта': 'Choose both accounts for the transfer',
    'Счета перевода должны различаться': 'Transfer accounts must be different', 'Изменение записи из списка': 'Editing a record from the list', 'Изменено в списке': 'Changed in the list',
    'Нет новых записей: заполните форму и нажмите «Добавить в список»': 'No new records: fill in the form and tap «Add to list»',
    'Нет категорий — добавьте их в ⚙ настройках': 'No categories — add them in ⚙ settings', 'Платежи': 'Payments', 'Платёж добавлен ✓': 'Payment added ✓',
    'Платёж пропущен': 'Payment skipped', 'Платёж сохранён ✓': 'Payment saved ✓', 'Платёж удалён': 'Payment deleted', 'Добавится автоматически': 'Will be added automatically',
    'Авто': 'Auto', 'Выключен': 'Off',

    // дашборд
    'Финансы: приход, остаток, расходы, хайр': 'Finance: income, balance, expenses, charity', 'Входит в расходы': 'Included in expenses',
    'Долги и накопления': 'Debts and savings', 'Я должен': 'I owe', 'Мне должны': 'Owed to me', 'Накоплено': 'Saved',
    'Средний расход в день и крупная трата': 'Average daily spending and largest expense', 'В среднем в день': 'Average per day', 'Самая крупная трата': 'Largest expense',
    'Расходы по категориям': 'Expenses by category', 'Приход по категориям': 'Income by category', 'Нет расходов за период': 'No expenses in this period', 'Нет прихода за период': 'No income in this period',
    'Молитвы: статусы': 'Prayers: statuses', 'Вовремя · 5 фарз': 'On time · 5 fard', 'Молитвы по дням': 'Prayers by day', 'Молитвы по дням (сетка)': 'Prayers by day (grid)',
    'Последние 31 день': 'Last 31 days', 'Серия: все фарзы вовремя': 'Streak: all fard on time', '🔥 Серия сейчас': '🔥 Current streak', 'Лучшая серия': 'Best streak',
    'Коран: чтение, заучивание, повторение': 'Quran: reading, memorization, revision', 'Записей': 'Entries', 'Страниц': 'Pages', 'Аятов': 'Ayahs',
    'Страниц по дням (с повторами)': 'Pages per day (with repetitions)', 'Последние 31 день периода': 'Last 31 days of the period',
    'Хифз: прогресс и карта 604 страниц': 'Hifz: progress and map of 604 pages', 'Хифз': 'Hifz', 'Повторено ≤ 7 дн.': 'Revised ≤ 7 days', '≤ 30 дн.': '≤ 30 days', 'Давно': 'Long ago', 'Не заучено': 'Not memorized',
    'Счета и карты': 'Accounts and cards', 'Счета и карты: остатки': 'Accounts and cards: balances', 'Карты: плитки (баланс, приход и расход)': 'Cards: tiles (balance, income and expenses)',
    'На начало': 'At start', 'Нач. остаток': 'Opening', 'Все счета': 'All accounts', 'Бюджеты: лимиты месяца': 'Budgets: monthly limits', 'Бюджеты на месяц': 'Monthly budgets',
    'Ближайшие платежи (30 дней)': 'Upcoming payments (30 days)', 'Ближайшие платежи': 'Upcoming payments', 'Всего за 30 дней': 'Total for 30 days', 'Цели': 'Goals',
    '＋ Добавить цель': '＋ Add goal', '⚙ Настроить блоки': '⚙ Customize blocks', 'Все блоки выключены — включите их в ⚙ настройках.': 'All blocks are off — turn them on in ⚙ settings.',
    'Поставьте цель: страниц Корана в день, хифз за месяц, сумма накоплений, молитвы вовремя.': 'Set a goal: Quran pages per day, hifz per month, savings amount, prayers on time.',
    'С учётом неотправленных': 'Including unsent', '✓ Выполнено': '✓ Done', 'Черта на полосе — сегодняшний день месяца': 'The mark on the bar is today’s day of the month',

    // цели
    'Чтение Корана': 'Quran reading', 'Заучивание (хифз)': 'Memorization (hifz)', 'Коран: все страницы': 'Quran: all pages', 'Хифз: всего выучено': 'Hifz: total memorized',
    'Накопления': 'Savings', 'Фарз вовремя': 'Fard on time', 'В день': 'Per day', 'В неделю': 'Per week', 'В месяц': 'Per month', 'В год': 'Per year',
    'Тип цели': 'Goal type', 'Цель': 'Target', 'Срок (необязательно)': 'Deadline (optional)', 'Целей пока нет.': 'No goals yet.', 'Цели сохранены ✓': 'Goals saved ✓',
    'Укажите значение для каждой цели': 'Enter a value for every goal', 'всего': 'total',

    // настройки: общие
    'Общие': 'General', 'Автоотправка': 'Auto-send', 'Сразу при сохранении, раз в минуту и при сворачивании. Без интернета данные ждут на телефоне.': 'Right after saving, every minute and when the app is minimized. Without internet, data waits on the phone.',
    'Тема': 'Theme', 'Как в телефоне': 'As on the phone', 'Светлая': 'Light', 'Тёмная': 'Dark', 'Вкладка при запуске': 'Start tab', 'Последняя открытая': 'Last opened',
    'Данные': 'Data', 'Загрузить всё заново с сервера': 'Reload everything from the server', 'Скрытые записи': 'Hidden records', 'Показать скрытые снова': 'Show hidden records again',
    'Скрытых записей нет.': 'No hidden records.', 'Скрытые записи снова видны': 'Hidden records are visible again',
    'Экспорт и импорт CSV': 'CSV export and import', '⬇ Финансы': '⬇ Finance', '⬇ Молитвы': '⬇ Prayers', '⬇ Коран': '⬇ Quran', '⬆ Импорт из CSV': '⬆ Import from CSV',
    'Экспорт — файл для Excel или Google Таблиц. Импорт принимает файлы в том же формате: повторы по номеру записи пропускаются, у молитв заполняются только пустые отметки.': 'Export creates a file for Excel or Google Sheets. Import accepts files in the same format: duplicates by record number are skipped, and for prayers only empty marks are filled.',
    'Импорт завершён ✓': 'Import complete ✓', 'В файле нет строк': 'The file has no rows', 'Не удалось понять, что в файле. Нужны заголовки как при экспорте': 'Could not recognize the file. It needs the same headers as an export',

    // настройки: молитвы
    'Названия молитв': 'Prayer names', 'Набор названий': 'Name set', 'Русские: Фаджр, Зухр…': 'Russian: Фаджр, Зухр…', 'Свои названия': 'Custom names',
    'العربية · арабские': 'العربية · Arabic', 'Тоҷикӣ: Бомдод, Пешин…': 'Tajik: Бомдод, Пешин…', 'Показывать Духа': 'Show Duha', 'Показывать Витр': 'Show Witr',
    'Скрытая молитва пропадает из отметок, списков и дашбордов. Записи в таблице остаются.': 'A hidden prayer disappears from marks, lists and dashboards. Records in the sheet stay.',
    'Сохранить названия': 'Save names', 'Названия сохранены ✓': 'Names saved ✓', 'Чтобы задать свои названия, выберите «Свои названия».': 'To set your own names, choose «Custom names».',
    'Статусы': 'Statuses', 'Можно переименовать и скрыть. Цвет и смысл статуса зависят от его места в списке: первые два считаются «вовремя». При переименовании старые записи тоже переименуются.': 'You can rename and hide them. A status’s color and meaning depend on its position: the first two count as «on time». Renaming also renames old records.',
    'Сохранить статусы': 'Save statuses', 'Статусы сохранены ✓': 'Statuses saved ✓', 'Скрыт': 'Hidden', 'Виден': 'Visible', 'Название статуса': 'Status name',
    'Оставьте видимыми хотя бы два статуса': 'Keep at least two statuses visible', 'Отметки': 'Marks', 'Кнопка «Отметить остальные»': '«Mark the rest» button',
    'После отметки — к следующей молитве': 'After marking, go to the next prayer', 'Плитка «Сейчас» с временем молитвы': '«Now» tile with prayer time', 'Дней в списке': 'Days in the list',
    // настройки: Коран
    'Вид по умолчанию': 'Default kind', 'Что читал по умолчанию': 'Default type', 'Следующая запись — со следующей страницы': 'Next record starts from the next page',
    // настройки: финансы
    'Иконка, название, начальный остаток. ● — счёт по умолчанию. 📦 — убрать в архив (старые записи останутся). При переименовании записи в таблице тоже переименуются.': 'Icon, name, opening balance. ● — default account. 📦 — archive (old records stay). Renaming also renames records in the sheet.',
    '＋ Добавить счёт или карту': '＋ Add account or card', 'Счёт по умолчанию для действий': 'Default account per action', 'Сохранить счета': 'Save accounts', 'Счета сохранены ✓': 'Accounts saved ✓',
    '— общий —': '— default —', 'Название, напр. Visa ••1234': 'Name, e.g. Visa ••1234', 'Счёт по умолчанию': 'Default account', 'По умолчанию': 'Default',
    'В архив': 'Archive', 'Вернуть из архива': 'Restore from archive', 'Начальный остаток': 'Opening balance', '(архив)': '(archived)',
    'Пока нет счетов — добавьте карту или «Наличные».': 'No accounts yet — add a card or «Cash».', 'Названия счетов не должны повторяться': 'Account names must be unique',
    'Регулярные платежи': 'Recurring payments', '＋ Добавить платёж': '＋ Add payment', 'Регулярных платежей пока нет.': 'No recurring payments yet.',
    'Аренда, связь, кредит… Платёж появится вверху вкладки «Финансы» в день оплаты (и заранее, если задать напоминание). С «Авто» запись добавится сама ночью в день платежа.': 'Rent, phone, loan… The payment appears at the top of the Finance tab on its due date (and earlier if you set a reminder). With «Auto» the record is added by itself on the night of the due date.',
    'Например, Аренда': 'For example, Rent', 'Следующая дата': 'Next date', 'Повтор': 'Repeat', 'Интервал': 'Interval', 'Напомнить за (дней)': 'Remind (days before)',
    'Добавлять автоматически': 'Add automatically', 'Запись появится сама в день платежа': 'The record appears by itself on the due date', 'Активен': 'Active',
    'Каждый день': 'Every day', 'Каждую неделю': 'Every week', 'Каждый месяц': 'Every month', 'Каждый год': 'Every year', 'Укажите сумму': 'Enter the amount',
    'Бюджеты на месяц ': 'Monthly budgets', 'Лимит расходов по категории на календарный месяц. При 80% и при превышении приложение предупредит. Пустое поле — без лимита.': 'Spending limit per category for a calendar month. The app warns at 80% and when the limit is exceeded. Empty field — no limit.',
    'Сохранить лимиты': 'Save limits', 'Лимиты сохранены ✓': 'Limits saved ✓', 'Нет категорий расходов.': 'No expense categories.',
    'Действия и категории': 'Actions and categories', '«Поток»:': '«Flow»:', 'увеличивает остаток,': 'increases the balance,', 'уменьшает,': 'decreases it,',
    'не влияет (например, «Перевод» между своими счетами).': 'has no effect (e.g. a «Transfer» between your own accounts).',
    '＋ Добавить действие': '＋ Add action', '＋ Категория': '＋ Category', 'Название действия': 'Action name', 'Удалить действие': 'Delete action', 'Удалить категорию': 'Delete category',
    '＋ Приход': '＋ Income', '− Расход': '− Expense', '0 Нет': '0 None', 'Заполните название действия': 'Enter the action name', 'Справочник сохранён ✓': 'Reference saved ✓',
    'Валюта': 'Currency', 'Нужен интернет, чтобы сохранить справочник': 'You need internet to save the reference',
    // настройки: напоминания
    'Напоминания': 'Reminders', 'На этом телефоне': 'On this phone', 'Уведомления о молитвах': 'Prayer notifications',
    'Когда приложение открыто или свёрнуто недавно. Телефон может не показать их, если приложение давно закрыто — для надёжности подключите Telegram.': 'While the app is open or recently minimized. The phone may not show them if the app has been closed for a while — connect Telegram for reliability.',
    'Напоминания в Telegram': 'Telegram reminders', 'Приходят, даже когда приложение закрыто': 'Arrive even when the app is closed', 'О чём напоминать': 'What to remind about',
    'Когда': 'When', 'В начале времени': 'At the start time', 'За 5 минут': '5 minutes before', 'За 10 минут': '10 minutes before', 'За 15 минут': '15 minutes before', 'За 30 минут': '30 minutes before',
    'Платежи (в Telegram)': 'Payments (Telegram)', 'Время напоминания о платежах': 'Payment reminder time', 'Превышение лимита (в Telegram)': 'Budget exceeded (Telegram)',
    'Сохранить напоминания': 'Save reminders', 'Напоминания сохранены ✓': 'Reminders saved ✓', '✅ Telegram подключён': '✅ Telegram connected',
    '⚠ Бот не настроен: добавьте свойство': '⚠ The bot is not set up: add the property', 'в Apps Script (инструкция в README).': 'in Apps Script (see README).',
    'Напишите своему боту': 'Send', 'в Telegram и нажмите «Подключить».': 'to your bot in Telegram and tap «Connect».',
    'Telegram подключён ✓ — проверьте сообщение от бота': 'Telegram connected ✓ — check the message from the bot', 'Отправлено — проверьте Telegram': 'Sent — check Telegram',
    'Сохранено. Подключите Telegram, чтобы получать напоминания': 'Saved. Connect Telegram to receive reminders', 'Уведомления включены': 'Notifications are on',
    'Началось время молитвы': 'Prayer time has started', 'Этот браузер не поддерживает уведомления': 'This browser does not support notifications',
    'Этот браузер не поддерживает уведомления. На iPhone добавьте приложение на главный экран (iOS 16.4 и новее).': 'This browser does not support notifications. On iPhone, add the app to the Home Screen (iOS 16.4 or later).',
    'Уведомления запрещены в настройках телефона для этого сайта.': 'Notifications are blocked for this site in the phone settings.',
    'Разрешите уведомления для этого сайта в настройках телефона': 'Allow notifications for this site in the phone settings',
    // настройки: дашборд
    'Период при открытии': 'Period on open', 'Последний выбранный': 'Last selected', 'Блоки': 'Blocks', 'Включайте нужные и меняйте порядок стрелками.': 'Turn on the ones you need and reorder them with the arrows.',
    'Вернуть как было': 'Reset', 'Блоки дашборда сброшены': 'Dashboard blocks reset', 'Плитки карт': 'Card tiles', 'Что показывать': 'What to show',
    'Какие счета показывать плитками и что на них: приход и расход за период или только баланс. Нажатие на плитку на дашборде показывает все блоки только по этой карте.': 'Which accounts to show as tiles and what is on them: income and expenses for the period or the balance only. Tapping a tile on the dashboard shows all blocks for that card only.',
    'Приход и расход': 'Income and expenses', 'Только баланс': 'Balance only', 'Счетов пока нет — добавьте их в разделе «Финансы».': 'No accounts yet — add them in the Finance section.',
    'Период блока': 'Block period', 'Период: как на дашборде': 'Period: as on the dashboard',
    'Цели показываются на дашборде в блоке «Цели»: прогресс за день, неделю, месяц или год и сколько осталось.': 'Goals appear on the dashboard in the «Goals» block: progress for the day, week, month or year and how much is left.',
    'Сохранить цели': 'Save goals',
    'Калькулятор': 'Calculator', 'Плюс': 'Plus', 'Минус': 'Minus', 'Умножить': 'Multiply', 'Разделить': 'Divide', 'Стереть': 'Delete', 'Посчитать': 'Calculate', 'Не получается посчитать — проверьте выражение': 'Cannot calculate — check the expression', '150 или 27+110': '150 or 27+110',
    'Человек': 'Person', 'Какой долг гасите': 'Which debt are you repaying', 'Кто вернул': 'Who returned', 'Кому дали': 'Lent to', 'У кого взяли': 'Borrowed from',
    'Открытых долгов нет': 'No open debts', 'Открытых долгов нет.': 'No open debts.', 'Вам никто не должен': 'Nobody owes you', '＋ Новый человек': '＋ New person', 'Имя человека': 'Person name',
    'Выбрать': 'Select', 'Выберите человека': 'Choose a person', 'Долги': 'Debts', 'Все люди': 'All people', 'Все записи долгов': 'All debt records', 'Записей долгов нет': 'No debt records',
    'из комментария': 'from comment', 'Имя взято из комментария': 'Name taken from the comment', 'Переплата': 'Overpaid', 'Долги по людям': 'Debts by person',
    'Люди (для долгов)': 'People (for debts)', '＋ Добавить человека': '＋ Add person', 'Сохранить людей': 'Save people', 'Люди сохранены ✓': 'People saved ✓', 'Имя': 'Name',
    'Заметка: телефон, кто это': 'Note: phone, who it is', 'Старые долги без имени': 'Old debts without a name', 'людей': 'people',
    'С кем у вас долги. Человека можно добавить и прямо в форме долга. При переименовании старые записи тоже переименуются. 📦 — убрать из выбора, долги останутся.': 'People you have debts with. You can also add a person right in the debt form. Renaming also renames old records. 📦 — remove from the choice; debts stay.',
    'Сейчас имя берётся из комментария. Нажмите, чтобы закрепить его за человеком в таблице.': 'For now the name is taken from the comment. Tap to save it as the person in the sheet.',
    'Людей пока нет. Их можно добавить здесь или прямо в форме долга.': 'No people yet. Add them here or right in the debt form.', 'Без имени': 'No name',
    'Формат даты': 'Date format', 'Сегодня': 'Today', 'Вчера': 'Yesterday', 'Имена не должны повторяться': 'Names must be unique', 'Укажите человека': 'Choose a person',
    'Отменить': 'Undo', 'Нечего отменять': 'Nothing to undo', 'Отмена действий ↶': 'Undo ↶', 'Что можно отменять': 'What can be undone',
    'Кнопка ↶ вверху отменяет последнее действие. После добавления, изменения или скрытия записи внизу на 5 секунд появляется «Отменить».': 'The ↶ button at the top undoes the last action. After adding, editing or hiding a record, «Undo» appears at the bottom for 5 seconds.',
    'Отметки молитв': 'Prayer marks', 'Записи Корана': 'Quran records', 'Записи финансов и платежи': 'Finance records and payments', 'Скрытие из списка (свайп)': 'Hiding from the list (swipe)',
    'Сколько хранить историю': 'Keep history for', '10 минут': '10 minutes', '1 час': '1 hour', 'До конца дня': 'Until end of day', '24 часа': '24 hours',
    'Только на текущей вкладке': 'Current tab only', 'На «Молитвах» ↶ не отменит запись «Корана» и наоборот': 'On «Prayers» ↶ will not undo a «Quran» record and vice versa',
    'Очистить историю отмены': 'Clear undo history', 'История отмены очищена': 'Undo history cleared', 'Отмечено ✓': 'Marked ✓',
    'Не удалось отменить: запись уже обработана. Измените её вручную': 'Could not undo: the record was already processed. Change it manually',
    'Изменение записи Корана': 'Quran record edit', 'Удаление неотправленной записи': 'Deleting an unsent record', 'Скрытие записи из списка': 'Hiding a record',
    'Удаление записи из списка': 'Removing a record from the list', 'Изменение записи в списке': 'Editing a record in the list',
    'Apps Script устарел: замените Code.gs и сделайте новое развертывание (Развертывания → Управление → ✏ → Новая версия).': 'Apps Script is outdated: replace Code.gs and create a new deployment (Deploy → Manage deployments → ✏ → New version).',
    'Apps Script устарел: замените': 'Apps Script is outdated: replace', 'и сделайте': 'and do',
    'По страницам': 'By page', 'По сурам': 'By surah', 'Частично': 'Partly', 'Заучена': 'Memorized', 'Не заучена': 'Not memorized',
    'Нажмите на клетку — появятся сура, страницы и когда вы её читали и повторяли.': 'Tap a cell to see the surah, pages and when you read and revised it.',
    'Повторений пока не было': 'No revisions yet', 'Отмечено как заученное ранее': 'Marked as memorized earlier', 'Последний раз': 'Last time',
    'Последний раз:': 'Last time:', 'Записей': 'Entries', 'сегодня': 'today', 'вчера': 'yesterday',
    'Хифз: заучено ранее': 'Hifz: memorized earlier', 'Джуз 30 (78–114)': 'Juz 30 (78–114)', 'Джуз 29 (67–77)': 'Juz 29 (67–77)', 'Очистить': 'Clear',
    'Отметьте суры или страницы, которые вы уже знаете. На карте хифза они станут зелёными и будут бледнеть, если их долго не повторять. Записи «Повторение» снова делают их зелёными.': 'Mark the surahs or pages you already know. They turn green on the hifz map and fade if not revised for a long time. «Revision» records make them green again.',
    'Поиск суры: номер или название': 'Search surah: number or name', 'Страницы (необязательно)': 'Pages (optional)', 'Например: 1-21, 582-604': 'E.g. 1-21, 582-604',
    'Когда последний раз повторяли': 'Last revised on', 'Сохранить заученное': 'Save memorized', 'Заученное сохранено ✓': 'Memorized saved ✓',
    'Страницы: например 1-21, 582-604': 'Pages: e.g. 1-21, 582-604', 'Зелёный — повторено за (дней)': 'Green — revised within (days)', 'Бледнеет после (дней)': 'Fades after (days)',
    'Вернуть стандартные цвета': 'Restore default colors', 'Цвет статуса': 'Status color', 'Стандартные цвета — нажмите «Сохранить статусы»': 'Default colors — tap «Save statuses»',
    'На сегодня': 'Today', 'заученное': 'memorized',
    'Отправить тест': 'Send test', '🧪 Тест автонапоминания через 2 минуты': '🧪 Automatic reminder test in 2 minutes', '🧪 Тест уведомления на телефоне': '🧪 Test notification on this phone',
    '«Отправить тест» — сообщение сразу. «Тест автонапоминания» срабатывает так же, как напоминание о молитве: сам, через 2 минуты, даже если закрыть приложение.': '«Send test» sends a message right away. «Automatic reminder test» works exactly like a prayer reminder: by itself, in 2 minutes, even if you close the app.',
    'Тест: уведомления на этом телефоне работают': 'Test: notifications on this phone work', 'Тест через минуту: уведомление пришло, пока приложение было в фоне': 'One-minute test: the notification arrived while the app was in the background',
    'Второе уведомление придёт через 1 минуту — сверните приложение, чтобы проверить работу в фоне': 'A second notification will arrive in 1 minute — minimize the app to test the background',
    'Сначала добавьте myTracker на главный экран — подробности выше': 'First add myTracker to the Home Screen — details above', 'Сначала подключите Telegram': 'Connect Telegram first',
    'Сегодня в Telegram:': 'Today in Telegram:', 'Отправлено': 'Sent', 'Ожидает': 'Pending',
    'Напоминания в Telegram выключены — включите переключатель ниже и сохраните.': 'Telegram reminders are off — turn on the switch below and save.',
    'На сегодня нет строки в листе «Времена молитв» — напоминания о молитвах не придут.': 'There is no row for today in the «Времена молитв» sheet — prayer reminders will not arrive.',
    'На сегодня не выбрано ни одной молитвы.': 'No prayers selected for today.',
    'На iPhone уведомления работают только у приложения с главного экрана: откройте сайт в Safari → «Поделиться» → «На экран «Домой»», запустите myTracker с иконки и включите здесь. Нужна iOS 16.4 или новее.': 'On iPhone, notifications only work for the Home Screen app: open the site in Safari → «Share» → «Add to Home Screen», launch myTracker from the icon and turn this on here. iOS 16.4 or later is required.',
    'Этот браузер не поддерживает уведомления. Откройте сайт в Chrome (Android) или с главного экрана (iPhone).': 'This browser does not support notifications. Open the site in Chrome (Android) or from the Home Screen (iPhone).',
    'Сначала добавьте myTracker на главный экран — подробности под переключателем': 'First add myTracker to the Home Screen — details below the switch',
    'Google ещё не разрешил скрипту обращаться к Telegram. Откройте Apps Script, выберите функцию authorize и нажмите ▶ Выполнить → «Проверить разрешения» → «Разрешить». Потом нажмите «Подключить» ещё раз.': 'Google has not yet allowed the script to reach Telegram. Open Apps Script, choose the authorize function and press ▶ Run → «Review permissions» → «Allow». Then tap «Connect» again.', 'Импорт': 'Import', 'за период': 'in period', 'дн.': 'd.', 'стр.': 'p.', 'Финансах': 'Finance'
  });
  const RU_MON = '';
  // шаблоны с числами и именами
  pat(/^Последние (\d+) дней$/, 'Last $1 days');
  pat(/^Я должен (.+)$/, 'I owe $1');
  pat(/^Мне должны (.+)$/, 'Owed to me $1');
  pat(/^Долги: (.+)$/, 'Debts: $1');
  pat(/^Закрыто долгов: (\d+)$/, 'Closed debts: $1');
  pat(/^И ещё: (\d+)$/, 'And $1 more');
  pat(/^Человек «(.+)» выбран — сохранится вместе с записью$/, 'Person «$1» selected — saved with the record');
  pat(/^Отменено: (.+)$/, (m, x) => 'Undone: ' + tr(x));
  pat(/^Отменить: (.+)$/, (m, x) => 'Undo: ' + tr(x));
  pat(/^Изменение записи №(\d+)$/, 'Edit of record #$1');
  pat(/^Скрытие дня (.+)$/, 'Hiding day $1');
  pat(/^Оплата «(.+)»$/, 'Payment «$1»');
  pat(/^Пропуск «(.+)»$/, 'Skip «$1»');
  pat(/^Отмечены остальные · (.+)$/, 'Rest marked · $1');
  pat(/^Страница (\d+)$/, 'Page $1');
  pat(/^Стр\. (\d+) · (\d+) аятов$/, 'Page $1 · $2 ayahs');
  pat(/^Сура: (.+)$/, 'Surah: $1');
  pat(/^Стр\. (\d+)–(\d+) · (\d+) аятов$/, 'Pages $1–$2 · $3 ayahs');
  pat(/^Заучено (\d+) из (\d+) стр\.$/, 'Memorized $1 of $2 pages');
  pat(/^Отмечено как заученное ранее · (.+)$/, 'Marked as memorized earlier · $1');
  pat(/^\((\d+) дн\. назад\)$/, '($1 days ago)');
  pat(/^\((сегодня|вчера)\)$/, (m, x) => (x === 'сегодня' ? '(today)' : '(yesterday)'));
  pat(/^(\d+) раз(\(а\))?$/, (m, n) => n + (n === '1' ? ' time' : ' times'));
  pat(/^(\d+) раз(\(а\))? · ×(\d+)$/, (m, n, x, r) => n + (n === '1' ? ' time' : ' times') + ' · ×' + r);
  pat(/^Выбрано сур: (\d+)$/, 'Surahs selected: $1');
  pat(/^Страниц: (\d+) из 604$/, 'Pages: $1 of 604');
  pat(/^Повторено ≤ (\d+) дн\.$/, 'Revised ≤ $1 days');
  pat(/^≤ (\d+) дн\.$/, '≤ $1 days');
  pat(/^За период$/, 'In period');
  pat(/^Тест придёт около (\d\d:\d\d)\. Можно закрыть приложение$/, 'The test will arrive around $1. You can close the app');
  pat(/^Напоминания не поставлены: (.+)$/, (m, x) => 'Reminders were not scheduled: ' + tr(x));
  pat(/^(.+) и отправить всё неотправленное$/, (m, x) => tr(x) + ' and send everything unsent');
  pat(/^Далее: (.+) в (\d\d:\d\d)$/, (m, x, t) => 'Next: ' + tr(x) + ' at ' + t);
  pat(/^(\d+) записей без счёта \($/, '$1 records without an account (');
  pat(/^\) не входят в остатки\.$/, ') are not included in balances.');
  pat(/^За (\d+) дней записей нет$/, 'No records in $1 days');
  pat(/^Отметить остальные «(.+)»$/, 'Mark the rest «$1»');
  pat(/^Сумма \((.+)\)$/, 'Amount ($1)');
  pat(/^В списке: (\d+)$/, 'In the list: $1');
  pat(/^(\d+) шт\.$/, '$1 pcs');
  pat(/^Уйдут в течение минуты$/, 'Will be sent within a minute');
  pat(/^Уйдут, когда появится интернет$/, 'Will be sent when online');
  pat(/^⏳ Не отправлено: (\d+) — нажмите, чтобы отправить сейчас$/, '⏳ Not sent: $1 — tap to send now');
  pat(/^⏳ Отправка… \((\d+)\)$/, '⏳ Sending… ($1)');
  pat(/^Ждут отправки: (\d+) — уйдут, когда появится связь$/, 'Waiting: $1 — will be sent when online');
  pat(/^⚠ С ошибкой: (\d+)$/, '⚠ With errors: $1');
  pat(/^Не отправлено: (\d+) — нажмите, чтобы повторить$/, 'Not sent: $1 — tap to retry');
  pat(/^Обновлено: (.+)$/, 'Updated: $1');
  pat(/^В очереди: (\d+)$/, 'In queue: $1');
  pat(/^Не удалось сохранить: (.+)$/, (m, x) => 'Could not save: ' + tr(x));
  pat(/^Отправлено ✓ (.+)$/, (m, x) => 'Sent ✓ ' + x.replace('молитвы', 'prayers').replace('Коран', 'Quran').replace('финансы', 'finance'));
  pat(/^Осталось (\d+) ч (\d+) мин$/, '$1 h $2 min left');
  pat(/^Осталось (\d+) мин$/, '$1 min left');
  pat(/^в (\d\d:\d\d)$/, 'at $1');
  pat(/^Редактирование записи №(\d+)$/, 'Editing record #$1');
  pat(/^Запись №(\d+) изменена ✓$/, 'Record #$1 changed ✓');
  pat(/^№(\d+)$/, '#$1');
  pat(/^Добавлено сур: (\d+) ✓$/, 'Surahs added: $1 ✓');
  pat(/^(\d+) стр\. × (\d+) = (\d+) стр\.$/, '$1 p. × $2 = $3 p.');
  pat(/^(\d+) сур\(ы\), (\d+) аятов × (\d+) = (\d+) аятов$/, '$1 surah(s), $2 ayahs × $3 = $4 ayahs');
  pat(/^([\d\s,.]+) стр\.$/, '$1 p.');
  pat(/^([\d\s,.]+) аят\.$/, '$1 ay.');
  pat(/^Стр\. (\d+)–(\d+)$/, 'P. $1–$2');
  pat(/^Стр\. (\d+)$/, 'Page $1');
  pat(/^Сура (\d+)\. (.+)$/, 'Surah $1. $2');
  pat(/^Заучена, последний раз (.+)$/, 'Memorized, last revised $1');
  pat(/^Заучена$/, 'Memorized');
  pat(/^Коран · (\d+) стр\. за период$/, 'Quran · $1 p. in period');
  pat(/^(\d+) из (\d+) страниц \(([\d.]+)%\)$/, '$1 of $2 pages ($3%)');
  pat(/^(\d+) из 114 сур$/, '$1 of 114 surahs');
  pat(/^За (\d+) дн\.$/, 'Over $1 days');
  pat(/^(\d+) дн\.$/, '$1 d.');
  pat(/^Все 5 фарз — (.+) или (.+)$/, 'All 5 fard — $1 or $2');
  pat(/^(.+) — нафиль, в процент «вовремя» не входят\.$/, (m, x) => x.replace(' и ', ' and ') + ' are nafl and not counted in «on time».');
  pat(/^Сейчас$/, 'Now');
  pat(/^На (\d\d\.\d\d\.\d{4})$/, 'On $1');
  pat(/^Баланс сейчас$/, 'Balance now');
  pat(/^Баланс на (.+)$/, 'Balance on $1');
  pat(/^Сейчас · (.+) за период$/, 'Now · $1 in period');
  pat(/^За период$/, 'In period');
  pat(/^(.+) за период$/, '$1 in period');
  pat(/^Счёт: (.+)$/, 'Account: $1');
  pat(/^Дашборд по счёту «(.+)»$/, 'Dashboard for «$1»');
  pat(/^Нажмите ещё раз, чтобы показать все$/, 'Tap again to show all');
  pat(/^(\d+) записей без счёта \((.+)\) не входят в остатки\.$/, '$1 records without an account ($2) are not included in balances.');
  pat(/^Привязать к «(.+)»$/, 'Assign to «$1»');
  pat(/^Привязать все записи без счёта к «(.+)»\?$/, 'Assign all records without an account to «$1»?');
  pat(/^Привязано записей: (\d+) ✓$/, 'Records assigned: $1 ✓');
  pat(/^Показывать (.+)$/, (m, x) => 'Show ' + (tr(x) || x));
  pat(/^Лимит (.+)$/, (m, x) => 'Limit ' + (tr(x) || x));
  pat(/^Лимит на месяц: (.+) из (.+)$/, 'Monthly limit: $1 of $2');
  pat(/^Осталось (.+)$/, (m, x) => (/дн\.$/.test(x) ? x.replace(' дн.', '') + ' days left' : tr(x) + ' left'));
  pat(/^Превышен на (.+)$/, 'Over by $1');
  pat(/^⚠ Лимит «(.+)» превышен: (.+) из (.+)$/, '⚠ Limit «$1» exceeded: $2 of $3');
  pat(/^Лимит «(.+)»: потрачено (\d+)% \((.+) из (.+)\)$/, 'Limit «$1»: $2% spent ($3 of $4)');
  pat(/^Всего (.+) из (.+)$/, 'Total $1 of $2');
  pat(/^Просрочено на (\d+) дн\.$/, 'Overdue by $1 d.');
  pat(/^Через (\d+) дн\.$/, 'In $1 days');
  pat(/^Через (\d+) мин — время молитвы$/, 'Prayer time in $1 min');
  pat(/^Следующий (.+)$/, 'Next $1');
  pat(/^Каждые (\d+) дн\.$/, 'Every $1 days'); pat(/^Каждые (\d+) нед\.$/, 'Every $1 weeks');
  pat(/^Каждые (\d+) мес\.$/, 'Every $1 months'); pat(/^Каждые (\d+) г\.$/, 'Every $1 years');
  pat(/^«(.+)» оплачено ✓$/, '«$1» paid ✓');
  pat(/^Оплата: (.+) за (.+)$/, 'Payment: $1 for $2');
  pat(/^Пропустить платёж «(.+)» за (.+)\? Следующий — (.+)\.$/, 'Skip payment «$1» for $2? The next one is $3.');
  pat(/^Удалить платёж «(.+)»\? Записи в «Финансах» останутся\.$/, 'Delete payment «$1»? Records in Finance stay.');
  pat(/^Нужно (.+) в день$/, (m, x) => 'Need ' + tr(x) + ' per day');
  pat(/^К (.+): нужно (.+) в день$/, (m, d, x) => 'By ' + d + ': need ' + tr(x) + ' per day');
  pat(/^Срок (.+) прошёл$/, 'Deadline $1 has passed');
  pat(/^из (.+)$/, (m, x) => 'of ' + tr(x));
  pat(/^Нужен интернет, чтобы сохранить (.+)$/, (m, x) => 'You need internet to save the ' + ({ 'названия': 'names', 'статусы': 'statuses', 'лимиты': 'limits', 'платежи': 'payments', 'цели': 'goals', 'напоминания': 'reminders', 'импорт': 'import' }[x] || x));
  pat(/^Сохранено ✓ · Переименовано записей: (\d+)$/, 'Saved ✓ · Records renamed: $1');
  pat(/^Переименовано записей: (\d+)$/, 'Records renamed: $1');
  pat(/^Переименовано отметок: (\d+)$/, 'Marks renamed: $1');
  pat(/^Скрыто из списков: (\d+)\. Из таблицы они не удалены\.$/, 'Hidden from lists: $1. They are not deleted from the sheet.');
  pat(/^Выйти\? (\d+) записей ещё не отправлено — они останутся на телефоне\.$/, 'Log out? $1 records are not sent yet — they will stay on this phone.');
  pat(/^Удалить действие «(.+)» и все его категории\? Старые записи в таблице останутся\.$/, 'Delete action «$1» and all its categories? Old records in the sheet stay.');
  pat(/^У счёта «(.+)» (\d+) записей\. Удалить его из списка\? Записи останутся в таблице\. Лучше убрать в архив 📦\.$/, 'Account «$1» has $2 records. Remove it from the list? Records stay in the sheet. Archiving 📦 is better.');
  pat(/^Импортировать (\d+) строк в «(.+)»\?$/, (m, n, k) => `Import ${n} rows into «${tr(k)}»?`);
  pat(/^Импорт… (\d+) из (\d+)$/, 'Importing… $1 of $2');
  pat(/^Готово: добавлено (\d+), обновлено (\d+), пропущено (\d+)$/, 'Done: added $1, updated $2, skipped $3');
  pat(/^Экспортировано строк: (\d+)$/, 'Rows exported: $1');
  pat(/^Версия сайта (.+)$/, 'Site version $1');
  pat(/^Данные от (.+)$/, 'Data from $1');
  pat(/^Период: (.+)$/, (m, x) => 'Period: ' + tr(x[0].toUpperCase() + x.slice(1)).toLowerCase());
  pat(/^Средний расход$/, 'Average spending');
  pat(/^Перевод с (.+)$/, 'Transfer from $1');
  pat(/^Перевод на (.+)$/, 'Transfer to $1');
  pat(/^Изменения: (.+)$/, 'Changes: $1');
  pat(/^(.+): (\d+) стр\.$/, '$1: $2 p.');

  // ── План Корана
  add({
    'План на сегодня': 'Plan for today', 'Настроить': 'Set up', '🔁 Повторение': '🔁 Revision', '📗 Заучивание': '📗 Memorization',
    'Пока нечего повторять: отметьте заученное в ⚙ → Коран или добавьте запись «Заучивание».': 'Nothing to revise yet: mark what you know in ⚙ → Quran or add a «Memorization» entry.',
    '🔁 Повторить сегодня': '🔁 Revise today', '📗 Выучить сегодня': '📗 Memorize today', 'Сабки:': 'Sabqi:', 'Манзил:': 'Manzil:', 'Сабки': 'Sabqi', 'Манзил': 'Manzil',
    '✓ На сегодня всё повторено': '✓ All revised for today', '✓ Повторил': '✓ Revised', '✓ Повторил всё': '✓ Revised all', '✓ Выучил': '✓ Memorized', 'Ещё не выучил': 'Not yet',
    'Весь Коран по плану выучен. Машаллах!': 'The whole plan is memorized. MashaAllah!', 'Завтра — следующая часть.': 'Tomorrow — the next part.',
    'Хорошо — завтра будет то же самое задание. Повторяйте, пока не выучите': 'OK — tomorrow you get the same task. Keep repeating until you know it',
    'Выучено ✓ Завтра — дальше': 'Memorized ✓ Tomorrow — next part', 'Повторение отмечено ✓': 'Revision marked ✓', 'План сохранён ✓': 'Plan saved ✓', 'Позиция сброшена': 'Position reset',
    'Отправлено в Telegram ✓': 'Sent to Telegram ✓', 'Нужен интернет': 'Internet connection needed',
    'Повторение на сегодня': 'Revision today', 'Выучить сегодня': 'Memorize today',
    'Цвета карты хифза': 'Hifz map colours', 'Ярко-зелёный, если повторено не позже (дней)': 'Bright green if revised within (days)', 'Жёлтый «давно» — после (дней, не больше 60)': 'Yellow «long ago» after (days, max 60)',
    'План повторения (мураджаа)': 'Revision plan (muraja‘a)',
    'Приложение само скажет, что повторить сегодня: берутся заученные страницы, которые дольше всех не повторялись. Прочитали заранее — завтрашнее задание сдвинется само.': 'The app tells you what to revise today: the memorized pages that have gone longest without revision. Read ahead — tomorrow’s task shifts by itself.',
    'Методика': 'Method', 'Всё заученное за N дней': 'Everything memorized in N days', 'Фиксированный объём в день': 'Fixed amount per day', 'По объёму заучивания (1 строка → 1 стр.)': 'By memorization volume (1 line → 1 page)',
    'Сабак · Сабки · Манзил': 'Sabaq · Sabqi · Manzil', 'Без плана': 'No plan', 'За сколько дней круг': 'Days per full cycle', 'Сколько в день': 'Per day', 'джуз': 'juz',
    'Сабки: последние выученные (стр., каждый день)': 'Sabqi: latest memorized (pages, every day)', 'Манзил: остальное за (дней)': 'Manzil: the rest within (days)',
    'Напоминание о повторении': 'Revision reminder', 'Напоминание о заучивании': 'Memorization reminder', 'Время': 'Time',
    'План заучивания (сабак)': 'Memorization plan (sabaq)', 'Задание на заучивание каждый день': 'Daily memorization task',
    '«✓ Выучил» — завтра дальше; «Ещё не выучил» — то же задание, пока не выучите': '«✓ Memorized» — move on tomorrow; «Not yet» — same task until you know it',
    'строк': 'lines', 'страниц': 'pages', 'Порядок': 'Order', 'С начала мусхафа': 'From the start', 'С 30-го джуза назад': 'Juz 30 backwards',
    'Начать со страницы': 'Start from page', 'Начать заново с этой страницы': 'Restart from this page', 'Начнём с начала выбранного порядка': 'We start from the beginning of the chosen order',
    'Напоминания приходят в Telegram (если подключён) и на телефон, пока приложение открыто. В 15 строках — одна страница мусхафа.': 'Reminders come via Telegram (if connected) and to the phone while the app is open. 15 lines = one mushaf page.',
    'Сохранить план': 'Save plan', 'Отправить план в Telegram (тест)': 'Send plan to Telegram (test)', 'План заучивания': 'Memorization plan', 'План повторения': 'Revision plan',
    'Сабак — новое, Сабки — недавно выученное (каждый день), Манзил — всё остальное по кругу.': 'Sabaq — new, Sabqi — recently memorized (every day), Manzil — everything else in rotation.',
    'Начать заучивание заново с выбранной страницы? Уже выученное не пропадёт.': 'Restart memorization from the chosen page? What you already know is kept.',
    'План Корана': 'Quran plan', 'План на день': 'Daily plan'
  });
  // перечни страниц и джузов: «стр. 3–5, Джуз 30 (стр. 582–604)», «стр. 12, строки 1–5 · стр. 13»
  const qPages = (x) => x.replace(/Джузы (\d+)–(\d+)/g, 'Juz $1–$2').replace(/Джуз (\d+)/g, 'Juz $1').replace(/стр\. (\d+)/g, 'p. $1').replace(/строки (\d+)–(\d+)/g, 'lines $1–$2');
  pat(/^(?:(?:стр\. \d+(?:–\d+)?(?:, строки \d+–\d+)?|Джузы? \d+(?:–\d+)? \(стр\. \d+(?:–\d+)?\))(?:, | · )?)+$/, (m) => qPages(m));
  pat(/^Сабки: (\d+) последних стр\. каждый день$/, 'Sabqi: last $1 p. every day');
  pat(/^Манзил: остальное за (\d+) дн\.$/, 'Manzil: the rest in $1 days');
  pat(/^(Сабки|Манзил): ((?:стр|Джуз).+)$/, (m, a, b) => (a === 'Сабки' ? 'Sabqi: ' : 'Manzil: ') + qPages(b));
  pat(/^Заучивание: (.+)$/, (m, a) => 'Memorization: ' + qPages(a));
  pat(/^Повторение: (.+)$/, (m, a) => 'Revision: ' + qPages(a));
  pat(/^✓ Сегодня выучено: (.+)$/, (m, a) => '✓ Memorized today: ' + qPages(a));
  pat(/^(\d+) из (\d+) стр\.$/, '$1 of $2 p.');
  pat(/^Весь заученный объём \((\d+) стр\.\) за (\d+) дн\.$/, 'All memorized ($1 p.) in $2 days');
  pat(/^([\d.]+) джуз в день$/, '$1 juz per day');
  pat(/^([\d.]+) стр\. в день$/, '$1 p. per day');
  pat(/^(\d+) (стр\.|строк) заучивания → (\d+) стр\. повторения$/, (m, a, u, b) => `${a} ${u === 'строк' ? 'lines' : 'p.'} memorized → ${b} p. revised`);
  pat(/^Сабки: (\d+) последних стр\. каждый день · Манзил: остальное за (\d+) дн\.$/, 'Sabqi: last $1 p. every day · Manzil: the rest in $2 days');
  pat(/^Сверх плана сегодня: (\d+) стр\.$/, 'Extra today: $1 p.');
  pat(/^Заучено (\d+) стр\. → по (\d+) стр\. \(≈ ([\d.]+) джуза\) в день$/, 'Memorized $1 p. → $2 p. (≈ $3 juz) per day');
  pat(/^Сейчас: (\d+) (стр\.|строк) заучивания → (\d+) стр\. повторения в день$/, (m, a, u, b) => `Now: ${a} ${u === 'строк' ? 'lines' : 'p.'} memorized → ${b} p. revised per day`);
  pat(/^Следующее: стр\. (\d+), строка (\d+)$/, 'Next: p. $1, line $2');

  // ── Мусхаф
  add({
    'Мусхаф': 'Mushaf', 'открыть': 'open', 'продолжить со стр.': 'continue from p.', 'Джуз': 'Juz', 'Сура…': 'Sura…', 'Джуз…': 'Juz…', 'Перейти': 'Go',
    'Не удалось загрузить разметку мусхафа. Нужен интернет при первом открытии.': 'Could not load the mushaf layout. The first opening needs internet.',
    'Не удалось загрузить текст. Нужен интернет при первом открытии.': 'Could not load the text. The first opening needs internet.',
    'Загрузка страницы…': 'Loading page…',
    'Страница ещё не скачана. Подключитесь к интернету или скачайте весь Коран заранее: ⚙ → Коран → Мусхаф.': 'This page is not downloaded yet. Connect to the internet or download the whole Quran in advance: ⚙ → Quran → Mushaf.',
    'Повторение': 'Revision', 'эта страница': 'this page', 'из': 'of', 'К стр.': 'To p.', 'Выучить': 'Memorize', '✓ Сегодня выучено': '✓ Memorized today',
    'Записать': 'Record', 'как': 'as', 'Сохранить': 'Save', 'Отмена': 'Cancel', 'Отметить прочитанное': 'Mark as read', 'Прочитал': 'I read', 'Страница засчитана': 'Page counted', 'Засчитается через': 'Counts in', 'сек.': 's', 'Засчитано сегодня': 'Counted today',
    'Эти страницы уже засчитаны сегодня ✓': 'These pages are already counted today ✓', 'Засчитывать страницы сами': 'Count pages automatically',
    'Страница, открытая дольше заданного времени, записывается как прочитанная. На странице задания на повторение — как «Повторение»; при заучивании не засчитывается': 'A page kept open longer than the set time is recorded as read. On a revision-task page — as «Revision»; not counted while memorizing',
    'Через сколько секунд (не меньше 45)': 'After how many seconds (at least 45)', 'Записывать как': 'Record as', 'Записано': 'Saved',
    'Таджвид': 'Tajweed', 'Другие оттенки': 'Other shades', 'Без таджвида': 'No tajweed', 'Свои цвета': 'Own colours', 'Точные страницы': 'Exact pages', 'Шрифт «Усмани»': '«Uthmani» font',
    'Мадд лязим — 6 харакатов': 'Madd lazim — 6 counts', 'Мадд муттасыль / мунфасыль — 4–5': 'Madd muttasil / munfasil — 4–5', 'Мадд при остановке — 2, 4 или 6': 'Madd at a stop — 2, 4 or 6',
    'Естественный мадд — 2': 'Natural madd — 2', 'Гунна': 'Ghunnah', 'Тафхим — твёрдые буквы': 'Tafkhim — heavy letters', 'Калькаля': 'Qalqalah', 'Непроизносимые буквы': 'Silent letters',
    'В этом виде таджвида нет: обычный шрифт, зато его можно увеличить (⚙ → Коран → Мусхаф).': 'This view has no tajweed: a regular font, but it can be enlarged (⚙ → Quran → Mushaf).',
    'Вернуть стандартные цвета': 'Restore standard colours', 'Весь Коран скачан — читается без интернета ✓': 'The whole Quran is downloaded — reads offline ✓', 'Скачано страниц': 'Pages downloaded',
    'Страницы скачиваются, когда вы их открываете. Можно скачать всё сразу (≈ 51 МБ).': 'Pages are downloaded when you open them. You can download everything at once (≈ 51 MB).',
    'Остановить': 'Stop', 'Скачать весь Коран': 'Download the whole Quran', 'Скачивание': 'Downloading', 'Не скачалось страниц': 'Pages not downloaded', 'Нажмите ещё раз, когда будет интернет': 'Tap again when you are online',
    'Весь Коран скачан ✓': 'The whole Quran is downloaded ✓', 'Этот браузер не умеет хранить файлы для офлайна': 'This browser cannot store files for offline use',
    'Удалить скачанные страницы мусхафа с телефона? Их можно будет скачать снова.': 'Delete the downloaded mushaf pages from this phone? You can download them again.', 'Скачанные страницы удалены': 'Downloaded pages deleted',
    'Мадинский 1441 (точный)': 'Madani 1441 (exact)', 'Цветной': 'Coloured', 'Цветной — другие оттенки': 'Coloured — other shades',
    'Страницы и строки — как в печатном мусхафе Комплекса короля Фахда (15 строк), шрифты KFGQPC.': 'Pages and lines as in the printed King Fahd Complex mushaf (15 lines), KFGQPC fonts.',
    'Размер шрифта': 'Font size', 'Сохранять строки мусхафа': 'Keep mushaf lines', 'Выключите, чтобы крупный текст переносился по ширине экрана': 'Turn off to let large text wrap to the screen width',
    'Удалить': 'Delete', 'Шрифты © Комплекс короля Фахда (KFGQPC), через QUL / Tarteel. Разметка строк — QUL; текст «Усмани» — quran-text (quran.ws), CC BY 4.0.': 'Fonts © King Fahd Complex (KFGQPC), via QUL / Tarteel. Line layout — QUL; «Uthmani» text — quran-text (quran.ws), CC BY 4.0.', 'Открыть мусхаф': 'Open mushaf', 'Открыть': 'Open', 'Читать суру': 'Read sura', 'Читать': 'Read', 'Вид и таджвид': 'View and tajweed',
    'Следующая страница': 'Next page', 'Предыдущая страница': 'Previous page', 'Перейти к странице': 'Go to page', 'Закрыть': 'Close'
  });
  pat(/^✓ Прочитал: (.+)$/, (m, a) => '✓ I read: ' + a.replace(/стр\. /g, 'p. '));
  pat(/^Записано ✓ (.+)$/, 'Saved ✓ $1');

  // ── 6.7: подробности финансов, столбцы, периоды, уведомления на телефон, проверка напоминаний
  add({
    'Приход и расход': 'Income and expenses', 'Оба': 'Both', 'По дням': 'By day', 'По неделям': 'By week', 'По месяцам': 'By month', 'Дни': 'Days', 'Недели': 'Weeks', 'Месяцы': 'Months',
    'Нет записей': 'No entries', 'Откуда': 'Where from', 'По категориям': 'By category', 'Расходы по категориям': 'Expenses by category', 'Приход по категориям': 'Income by category',
    'По счетам': 'By account', 'Записи': 'Entries', 'Начальный остаток': 'Starting balance', 'На начало периода': 'At period start', '＋ Приход': '＋ Income', '− Расход': '− Expenses', 'Сейчас': 'Now',
    'Показать весь дашборд только по этой карте': 'Show the whole dashboard for this card only', 'Показать дашборд по всем счетам': 'Show the dashboard for all accounts',
    'записей без счёта не входят в остатки по счетам': 'entries without an account are not in account balances', 'Нет записей за период': 'No entries in this period',
    'Финансы: столбцы по дням, неделям, месяцам': 'Finance: bars by day, week, month', 'Периоды вверху дашборда': 'Periods at the top of the dashboard',
    'Оставьте только нужные — лишние скроются (хотя бы один остаётся).': 'Keep only the ones you need — the rest are hidden (at least one stays).', 'Хотя бы один период должен остаться': 'At least one period must stay',
    'Прошлый месяц': 'Last month', 'Показать все': 'Show all',
    'Уведомления на этом телефоне': 'Notifications on this phone',
    'Молитвы, платежи, план Корана — приходят с сервера, даже когда приложение закрыто. Android — Chrome; iPhone — приложение с главного экрана (iOS 16.4+).': 'Prayers, payments, Quran plan — sent by the server, even when the app is closed. Android — Chrome; iPhone — the app from the Home Screen (iOS 16.4+).',
    '🧪 Тест сейчас': '🧪 Test now', '🧪 Через 2 минуты': '🧪 In 2 minutes', '«Через 2 минуты» — закройте приложение полностью: уведомление должно прийти само.': '«In 2 minutes» — close the app completely: the notification should arrive by itself.',
    'Не приходят напоминания?': 'Reminders not arriving?', '🔍 Проверить': '🔍 Check', '🛠 Починить': '🛠 Repair',
    '✅ Уведомления приходят с сервера — даже когда приложение закрыто.': '✅ Notifications come from the server — even when the app is closed.',
    'Сейчас — только пока приложение открыто. Выключите и включите снова, чтобы уведомления приходили и при закрытом приложении.': 'Right now only while the app is open. Turn it off and on again to get notifications when the app is closed too.',
    'Этот браузер умеет показывать уведомления только пока приложение открыто — для фона подключите Telegram.': 'This browser can show notifications only while the app is open — connect Telegram for background reminders.',
    'Уведомления включены ✓ Они будут приходить, даже когда приложение закрыто': 'Notifications on ✓ They will arrive even when the app is closed',
    'Отправлено с сервера — уведомление должно появиться через несколько секунд': 'Sent from the server — the notification should appear in a few seconds',
    'Пока уведомления работают только при открытом приложении. Включите переключатель заново, чтобы они приходили и в фоне': 'For now notifications only work while the app is open. Turn the switch on again to get them in the background',
    'Токен бота (TG_TOKEN) добавлен': 'Bot token (TG_TOKEN) added', 'Telegram подключён': 'Telegram connected', 'Напоминания в Telegram включены': 'Telegram reminders on',
    'Время молитв на сегодня есть': 'Prayer times for today found', 'Проверка раз в 10 минут установлена': 'Check every 10 minutes installed', 'Ночное обновление установлено': 'Nightly update installed',
    'Apps Script → Настройки проекта → Свойства скрипта → TG_TOKEN.': 'Apps Script → Project settings → Script properties → TG_TOKEN.', 'Напишите боту /start и нажмите «Подключить».': 'Send /start to your bot and tap «Connect».',
    'Включите переключатель «Напоминания в Telegram» и нажмите «Сохранить напоминания».': 'Turn on «Telegram reminders» and tap «Save reminders».', 'Включите «Уведомления на этом телефоне» выше.': 'Turn on «Notifications on this phone» above.',
    'Пояса не совпадают — напоминания приходили бы не в то время. Нажмите «Починить».': 'Time zones differ — reminders would come at the wrong time. Tap «Repair».',
    'В листе «Времена молитв» нет строки на сегодня — добавьте времена на этот месяц.': 'The «Prayer times» sheet has no row for today — add this month’s times.',
    'Нажмите «Починить».': 'Tap «Repair».', 'Сначала подключите Telegram или уведомления на телефоне.': 'First connect Telegram or phone notifications.',
    'Google давно не запускал проверку. Нажмите «Починить»; если не поможет — в Apps Script запустите authorize и разрешите доступ.': 'Google has not run the check for a while. Tap «Repair»; if that does not help, run authorize in Apps Script and allow access.',
    'Время на сервере': 'Server time', 'Последняя проверка': 'Last check', 'Последнее напоминание о молитве': 'Last prayer reminder', 'телефона': 'phone', 'Телефон': 'Phone', 'код': 'code',
    'ни разу': 'never', 'только что': 'just now', 'мин назад': 'min ago', 'ч назад': 'h ago', 'Сегодня': 'Today', 'Создать': 'Create', '🔄 Проверить обновление': '🔄 Check for update', 'Доступно обновление — нажмите, чтобы обновить': 'Update available — tap to update',
    'Нет связи — проверить обновление не получилось': 'No connection — could not check for updates', 'Сумма': 'Amount', 'Своя клавиатура для суммы': 'Built-in keypad for amounts', 'Цифры и + − × ÷ ( ) на одной клавиатуре — вместо клавиатуры телефона': 'Digits and + − × ÷ ( ) on one keypad — instead of the phone keyboard',
    '🧪 Через 2 мин': '🧪 In 2 min', 'Напоминания приходят в Telegram (если подключён) и на телефон (⚙ → Напоминания). В 15 строках — одна страница мусхафа.': 'Reminders come via Telegram (if connected) and to the phone (⚙ → Reminders). 15 lines = one mushaf page.', 'Имя или новый человек': 'Name or a new person', 'Выберите из списка': 'Choose from the list',
    'Введите имя, чтобы добавить человека': 'Type a name to add a person', 'Новый человек — сохранится вместе с записью': 'New person — saved together with the entry', 'Очистить': 'Clear'
  });
  pat(/^Человек «(.+)» добавлен — сохранится вместе с записью$/, 'Person «$1» added — saved together with the entry');
  pat(/^Расход ([\d\s ,.]+)$/, 'Expenses $1');
  pat(/^Приход ([\d\s ,.]+)$/, 'Income $1');
  pat(/^в среднем ([\d\s ,.]+) в день$/, 'avg $1 per day');
  pat(/^в среднем ([\d\s ,.]+) в неделю$/, 'avg $1 per week');
  pat(/^в среднем ([\d\s ,.]+) в месяц$/, 'avg $1 per month');
  pat(/^(\d+) записей$/, '$1 entries');
  pat(/^Показать все \((\d+)\)$/, 'Show all ($1)');
  pat(/^Показаны последние (\d+)$/, 'Showing the last $1');
  pat(/^Телефоны с уведомлениями: (\d+)$/, 'Phones with notifications: $1');
  pat(/^Часовой пояс сервера: (.+)$/, (m, a) => 'Server time zone: ' + a.replace('телефона', 'phone'));
  pat(/^Тест придёт около (.+)\. Закройте приложение полностью и подождите$/, 'The test will arrive around $1. Close the app completely and wait');
  pat(/^Расписание поставлено заново ✓ Напоминаний на сегодня: (\d+)$/, 'Schedule re-created ✓ Reminders today: $1');

  pat(/^Установлена последняя версия (.+) ✓$/, 'You have the latest version $1 ✓');
  pat(/^Приложение обновлено до версии (.+) ✓$/, 'App updated to version $1 ✓');
  window.I18N = { lang, tr, add, pat, start };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})();
