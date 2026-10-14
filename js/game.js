/* ============================================================
   ИГРА — кроссворд, набор слова по буквам, монеты, сохранение
   ============================================================ */

const SAVE_KEY = 'soberi_slovo_save_v3';

const CFG = {
  dailyReward: 60,
  startCoins: 200,
  levelBonus: (n) => 40 + n * 5,
  wordReward: (len) => len * 6,
  extraReward: 15,    // бонусное слово (не задание)
  comboBonus: (combo) => Math.max(0, (combo - 1) * 5),
  // Подсказки стоят монеты
  hintCost: 50,       // подсказка-буква: добавляет нужную букву в набор
  solveCost: 150,     // подсказка-слово: показывает слово целиком
};

const DEFAULT_SAVE = {
  coins: CFG.startCoins,
  level: 1,
  difficulty: 'normal',
  usedWords: [],
  lastDaily: '',
  sound: true,
  solvedLevels: 0,
  current: null,
};

/* ---------------- Утилиты ---------------- */

const $ = (sel) => document.querySelector(sel);
const todayStr = () => new Date().toISOString().slice(0, 10);

function vibrate(ms) {
  if (navigator.vibrate) { try { navigator.vibrate(ms); } catch (e) {} }
}

let toastTimer = null;
function toast(text, ms = 1500) {
  const el = $('#toast');
  el.textContent = text;
  el.classList.add('is-shown');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('is-shown'), ms);
}

let audioCtx = null;
function beep(freq = 520, dur = 0.07, type = 'sine') {
  if (!save.sound) return;
  try {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === 'suspended') audioCtx.resume();
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0.0001, audioCtx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.14, audioCtx.currentTime + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + dur);
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    osc.start();
    osc.stop(audioCtx.currentTime + dur + 0.02);
  } catch (e) {}
}

/** Согласование: 1 буква, 2 буквы, 5 букв. */
function plural(n, forms) {
  const n10 = n % 10, n100 = n % 100;
  if (n10 === 1 && n100 !== 11) return forms[0];
  if (n10 >= 2 && n10 <= 4 && (n100 < 12 || n100 > 14)) return forms[1];
  return forms[2];
}

/* ---------------- Сохранение ---------------- */

let save = loadSave();

function loadSave() {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return { ...DEFAULT_SAVE };
    return { ...DEFAULT_SAVE, ...JSON.parse(raw) };
  } catch (e) {
    return { ...DEFAULT_SAVE };
  }
}

function persist() {
  try { localStorage.setItem(SAVE_KEY, JSON.stringify(save)); } catch (e) {}
}

/* ---------------- Состояние ---------------- */

const state = {
  words: [],        // все слова уровня
  grid: [],         // сетка кроссворда: буква или null
  owners: [],       // какие слова проходят через клетку
  rows: 0,
  cols: 0,
  found: new Set(), // найденные задания
  extras: [],       // бонусные слова из тех же букв
  letters: [],      // все буквы уровня
  input: '',        // набираемое слово
  combo: 0,
  hintsUsed: 0,
  sideOpen: true,   // показывать ли список слов сбоку
  won: false,       // уровень собран целиком
  hintBusy: false,  // подсказка-буква ещё «дописывается»
  solveBusy: false, // слово ещё вписывается
  justFound: null,  // слово, только что открытое (для анимации)
  lastHints: 0,  // сколько букв открылось в других словах
};

/* ---------------- Экраны ---------------- */

function showScreen(id) {
  document.querySelectorAll('.screen').forEach((s) => s.classList.remove('is-active'));
  $(id).classList.add('is-active');
}
const openModal = (sel) => { $(sel).hidden = false; };
const closeModal = (sel) => { $(sel).hidden = true; };

/* ---------------- Рендер кроссворда ---------------- */

/**
 * Собираем сетку заново.
 *
 * Буква в клетке появляется, если клетку пересекает уже найденное
 * слово — даже если само это слово ещё не найдено. Вот и подсказка:
 * отгадал одно слово, в другом открылась буква.
 */
function rebuildCrossword() {
  const box = $('#crossword');
  box.innerHTML = '';

  const fresh = new Set();          // буквы, открывшиеся только что

  for (let r = 0; r < state.rows; r++) {
    const rowEl = document.createElement('div');
    rowEl.className = 'cw-row';

    for (let c = 0; c < state.cols; c++) {
      const ch = state.grid[r][c];
      const cell = document.createElement('div');

      if (!ch) {
        cell.className = 'cw-cell cw-cell--void';
        rowEl.appendChild(cell);
        continue;
      }

      cell.className = 'cw-cell';
      cell.dataset.r = r;
      cell.dataset.c = c;

      const owners = state.owners[r][c] || [];
      const openHere = owners.filter((w) => state.found.has(w));

      if (openHere.length) {
        cell.textContent = ch;
        // Если через клетку идёт ещё не найденное слово — это подсказка
        const hinted = openHere.length < owners.length;
        cell.classList.add(hinted ? 'is-hint' : 'is-open');
        if (hinted) fresh.add(r + ':' + c);
        if (state.justFound && owners.indexOf(state.justFound) !== -1) {
          cell.classList.add('is-fresh');
        }
      }

      rowEl.appendChild(cell);
    }

    box.appendChild(rowEl);
  }

  if (fresh.size) state.lastHints = fresh.size;
}

/** Подгоняем размер клеток под экран. */
function fitCrossword() {
  const area = $('.crossword-area');
  const box = $('#crossword');
  if (!box.children.length) return;

  const availW = area.clientWidth - 24;
  const availH = area.clientHeight - 30;
  if (availW < 40 || availH < 40) { requestAnimationFrame(fitCrossword); return; }

  const rows = state.rows || box.children.length;
  const cols = state.cols;
  const GAP = 3, ROWGAP = 3, PAD = 6;

  // Клетка не должна быть меньше читаемой: если не влезает — область
  // прокручивается (см. .crossword-area).
  const MIN_CELL = 20;
  const fits = Math.min(
    (availW - PAD * 2 - GAP * (cols - 1)) / cols,
    (availH - PAD * 2 - ROWGAP * (rows - 1)) / rows
  );
  const cell = Math.max(MIN_CELL, Math.floor(Math.min(fits, 44)));

  document.documentElement.style.setProperty('--cw-cell', cell + 'px');
}

/**
 * Подсветить в сетке слова, которые начинаются с того, что набирается.
 * Игрок видит, в какие ряды (и столбцы) стоит вписывать буквы.
 */
function markInputInGrid() {
  document.querySelectorAll('#crossword .cw-cell.is-active').forEach((c) =>
    c.classList.remove('is-active'));

  const word = state.input;
  if (!word) return;

  const cells = document.querySelectorAll('#crossword .cw-cell[data-r]');
  cells.forEach((cell) => {
    const r = +cell.dataset.r, c = +cell.dataset.c;
    const owners = (state.owners[r] || [])[c] || [];
    const fits = owners.some((w) => w.length > word.length && w.startsWith(word));
    cell.classList.toggle('is-active', fits && !cell.classList.contains('is-open'));
  });
}

/* ---------------- Боковой список слов ---------------- */

/**
 * Боковой список — только бонусные слова. Слова-задания прячем:
 * иначе игрок читает их вместо того, чтобы искать самому.
 * Бонусы нужны как память: что уже пробовал, чтобы не повторять.
 */
function renderSideList() {
  const box = $('#side-words');
  if (!box) return;

  let html = '';

  html += '<div class="side__group"><div class="side__title">' +
          'Бонусы <span class="side__count" id="side-extra-count">' +
          state.extras.length + '</span></div>';
  if (!state.extras.length) {
    html += '<div class="side__empty">Ищи слова из тех же букв</div>';
  } else {
    for (const w of state.extras) {
      html += '<div class="side__word side__word--extra">' + w + '</div>';
    }
  }
  html += '</div>';

  box.innerHTML = html;

  // Пока бонусов нет, столбик зря отнимает место у кроссворда —
  // прячем его. Кнопка-стрелка остаётся, список можно открыть.
  if (!state.extras.length) state.sideOpen = false;
  box.classList.toggle('is-collapsed', !state.sideOpen);
  $('#btn-side').classList.toggle('is-open', state.sideOpen);
  updateSideCounter();
}

/** Счётчик бонусов в шапке. */
function updateSideCounter() {
  const el = $('#side-extra-total');
  if (el) el.textContent = state.extras.length;
}

/* ---------------- Круг с буквами ---------------- */

/**
 * Буквы на круге — только те, что нужны для ещё ненайденных слов.
 * По мере прохождения букв становится меньше, круг упрощается.
 */
function wheelLetters() {
  const set = new Set();
  state.words.forEach((w) => {
    if (state.found.has(w)) return;
    w.split('').forEach((ch) => set.add(ch));
  });
  if (set.size) return Array.from(set).sort();
  return state.letters.slice();      // уровень собран — оставляем прежний вид
}

/** Сколько букв было на круге в прошлый раз — чтобы заметить упрощение. */
let lastWheelCount = 0;

function renderWheel() {
  const wheel = $('#wheel');
  wheel.querySelectorAll('.wheel__letter').forEach((el) => el.remove());

  const letters = wheelLetters();
  const n = Math.max(1, letters.length);

  // Круг упростился — коротко мигаем, чтобы связь «нашёл слово →
  // букв стало меньше» была видна.
  if (lastWheelCount && n < lastWheelCount) {
    wheel.classList.remove('is-shrunk');
    void wheel.offsetWidth;                 // перезапуск анимации
    wheel.classList.add('is-shrunk');
    setTimeout(() => wheel.classList.remove('is-shrunk'), 700);
  }
  lastWheelCount = n;

  // Размер колеса задаёт CSS (.wheel-area ограничивает по высоте).
  // Держимся этих границ, иначе круг наезжает на поле ввода.
  const box = $('.wheel-area');
  const maxByHeight = Math.max(96, box ? box.clientHeight - 6 : 0);
  const room = Math.floor(Math.min(window.innerWidth * 0.76, maxByHeight || 1e9));
  wheel.style.width = Math.round(room) + 'px';
  wheel.style.height = Math.round(room) + 'px';

  // Подбираем размер кнопки и колеса так, чтобы соседние буквы
  // гарантированно не налезали друг на друга:
  // расстояние между центрами = 2*R*sin(PI/n), должно быть >= размер кнопки.
  const GAP = 2, PAD = 4;
  const sinA = Math.sin(Math.PI / n);
  // максимальная кнопка при колесе радиуса R: (2R - btn) * sin(PI/n) >= btn + GAP
  const btnMax = Math.floor(((room - PAD * 2) * sinA - GAP) / (1 + sinA));
  const btn = Math.max(14, Math.min(46, btnMax));

  const R = room / 2 - btn / 2 - PAD;

  letters.forEach((ch, i) => {
    const ang = (-90 + (360 / n) * i) * Math.PI / 180;
    const b = document.createElement('button');
    b.className = 'wheel__letter';
    b.dataset.ch = ch;
    b.textContent = ch;
    b.style.width = btn + 'px';
    b.style.height = btn + 'px';
    b.style.margin = (-btn / 2) + 'px 0 0 ' + (-btn / 2) + 'px';
    b.style.fontSize = Math.max(12, Math.round(btn * 0.52)) + 'px';
    b.style.left = (room / 2 + Math.cos(ang) * R) + 'px';
    b.style.top = (room / 2 + Math.sin(ang) * R) + 'px';
    b.addEventListener('click', () => addLetter(ch));
    wheel.appendChild(b);
  });
}

/* ---------------- Набор слова ---------------- */

/** Ненайденные слова уровня. */
function restWords() {
  return state.words.filter((w) => !state.found.has(w));
}

/** Длина самого длинного ненайденного слова — предел ввода. */
function maxWordLen() {
  const rest = restWords();
  const list = rest.length ? rest : state.words;
  return list.reduce((m, w) => Math.max(m, w.length), 0) || 8;
}

function addLetter(ch) {
  // Пока подсказка дописывается или слово вписывается — не мешаем
  if (state.hintBusy || state.solveBusy) return;

  const maxLen = maxWordLen();
  if (state.input.length >= maxLen) {
    shakeWordbar();
    beep(180, 0.1, 'square');
    return;
  }

  state.input += ch;
  renderInput();
  markUsedLetters();
  markInputInGrid();
  beep(480 + state.input.length * 24, 0.03);
  autoSubmit();
}

/** Подсветить на круге буквы, уже набранные в слове. */
function markUsedLetters() {
  document.querySelectorAll('.wheel__letter').forEach((b) => {
    b.classList.toggle('is-used', state.input.includes(b.dataset.ch));
  });
}

function eraseLetter() {
  if (!state.input.length) return;
  if (state.hintBusy || state.solveBusy) return;
  state.input = state.input.slice(0, -1);
  renderInput();
  markUsedLetters();
  markInputInGrid();
  beep(320, 0.05);
}

function clearInput() {
  state.input = '';
  renderInput();
  markUsedLetters();
  markInputInGrid();
}

/**
 * Поле ввода: слотов столько, сколько букв в самом длинном слове
 * всего уровня. Считаем по всем словам, а не по оставшимся, —
 * иначе при каждой находке число слотов менялось бы на ходу
 * и буквы «прыгали» под пальцем.
 */
function renderInput() {
  const box = $('#wordbar');
  const levelLen = state.words.reduce((m, w) => Math.max(m, w.length), 0);
  const show = Math.max(levelLen || maxWordLen(), 1);

  let html = '';
  for (let i = 0; i < show; i++) {
    const ch = state.input[i] || '';
    html += '<div class="slot' + (ch ? ' has-letter' : '') + '">' + ch + '</div>';
  }
  box.innerHTML = html;
}

function shakeWordbar() {
  const bar = $('.wordbar');
  bar.classList.remove('is-wrong');
  void bar.offsetWidth;
  bar.classList.add('is-wrong');
  setTimeout(() => bar.classList.remove('is-wrong'), 400);
}

/**
 * Проверка набранного слова — вызывается автоматически после каждой буквы.
 *
 * Порядок:
 *  1. слово уже вводили (задание или бонус) — предупреждаем;
 *  2. совпало с заданием — ставим в кроссворд;
 *  3. есть в словаре — идёт в бонусные;
 *  4. набрано максимум букв, но такого слова нет — ругаемся.
 *
 * Если набранное слово может быть началом более длинного задания
 * («стол» / «столб»), ждём совсем немного — вдруг игрок продолжит.
 */
let submitTimer = null;

function autoSubmit() {
  clearTimeout(submitTimer);
  submitTimer = null;

  const word = state.input;
  if (!word) return;
  const rest = restWords();
  if (!rest.length) return;

  // уже вводили — не засчитываем дважды
  if (state.found.has(word) || state.extras.includes(word)) {
    submitTimer = setTimeout(() => {
      if (state.input !== word) return;
      shakeWordbar();
      beep(260, 0.1, 'square');
      toast('«' + word + '» — уже введено');
    }, 600);
    return;
  }

  const isTask = rest.includes(word);
  const isPrefix = rest.some((w) => w.length > word.length && w.startsWith(word));

  if (isTask && !isPrefix) { acceptWord(word); return; }

  if (isTask || isPrefix) {
    // Вдруг игрок допечатает продолжение. Молча ждём: в сетке
    // подсвечены ряды, куда вписывать, — подсказка «Допиши слово»
    // поверх кроссворда только мешала.
    submitTimer = setTimeout(() => {
      if (state.input !== word) return;
      if (restWords().includes(word)) acceptWord(word);
    }, 650);
    return;
  }

  // Не задание. Слово засчитывается как бонус, только если это
  // самостоятельное слово — падежные формы («сел», «столы») не считаем.
  if (LEMMA_SET.has(word)) {
    // но если это начало более длинного слова, подождём: вдруг допечатает
    const longer = LEX_BY_LEN[word.length + 1] &&
                   LEX_BY_LEN[word.length + 1].some((w) => w.startsWith(word));
    if (!longer) { acceptExtra(word); return; }

    submitTimer = setTimeout(() => {
      if (state.input === word) acceptExtra(word);
    }, 650);
    return;
  }

  // набрано максимум букв и такого слова нет
  if (word.length >= maxWordLen()) {
    submitTimer = setTimeout(() => {
      if (state.input !== word) return;
      state.combo = 0;
      $('#hud-combo').textContent = '0';
      shakeWordbar();
      beep(190, 0.14, 'sawtooth');
      vibrate(10);
      toast('Такого слова нет');
    }, 700);
  }
}

/* ---------------- Находка ---------------- */

/** Задание из кроссворда: ставится в сетку, двигает прогресс. */
function acceptWord(word) {
  state.found.add(word);
  state.justFound = word;
  state.combo += 1;
  $('#hud-combo').textContent = state.combo;

  const reward = CFG.wordReward(word.length) + CFG.comboBonus(state.combo);
  save.coins += reward;

  clearInput();
  state.lastHints = 0;
  rebuildCrossword();
  setTimeout(() => { state.justFound = null; }, 900);
  renderSideList();         // список сбоку
  renderWheel();            // буквы найденного слова убираются с круга
  updateProgress();
  updateHud();
  persist();

  // В одном баннере: само слово и сколько букв открылось в других.
  showBanner(state.lastHints
    ? word + ' · +' + state.lastHints + ' ' +
      plural(state.lastHints, ['подсказка', 'подсказки', 'подсказок'])
    : word);
  vibrate(16);
  beep(660, 0.08);
  setTimeout(() => beep(920, 0.1), 90);

  if (state.found.size >= state.words.length) setTimeout(checkWin, 420);
}

/**
 * Бонусное слово: не задание, но собрано из тех же букв.
 * Сохраняем, чтобы не вводить повторно, и платим небольшой бонус.
 */
function acceptExtra(word) {
  const wasEmpty = state.extras.length === 0;
  state.extras.push(word);
  save.coins += CFG.extraReward;

  // Первый бонус сам открывает список — дальше он уже не пустой
  if (wasEmpty) state.sideOpen = true;

  clearInput();
  renderSideList();
  updateSideCounter();
  updateHud();
  persist();

  showBanner(word + ' +' + CFG.extraReward);
  toast('Бонусное слово: ' + word);
  vibrate(12);
  beep(600, 0.07, 'triangle');
  setTimeout(() => beep(820, 0.09), 80);
}

let bannerTimer = null;
function showBanner(text) {
  const el = $('#ribbon');
  $('#ribbon-text').textContent = text;
  el.classList.add('is-shown');
  clearTimeout(bannerTimer);
  bannerTimer = setTimeout(() => el.classList.remove('is-shown'), 1300);
}

function updateProgress() {
  const total = state.words.length || 1;
  $('#progress-bar').style.width = (state.found.size / total * 100) + '%';
}

function updateHud() {
  $('#hud-coins').textContent = save.coins;
  $('#menu-coins').textContent = save.coins;
}

/* ---------------- Победа ---------------- */

function checkWin() {
  if (state.found.size < state.words.length) return;
  if (state.won) return;              // победа засчитывается один раз

  state.won = true;
  const bonus = CFG.levelBonus(save.level);
  save.coins += bonus;
  save.level += 1;
  save.solvedLevels += 1;
  save.current = null;
  persist();
  updateHud();

  vibrate([20, 60, 20]);
  beep(720, 0.1);
  setTimeout(() => beep(900, 0.12), 100);
  setTimeout(() => beep(1250, 0.22), 220);

  setTimeout(showWin, 420);
}

function showWin() {
  const stars = state.hintsUsed === 0 ? 3 : (state.hintsUsed === 1 ? 2 : 1);
  $('#win-stars').textContent = '★'.repeat(stars) + '☆'.repeat(3 - stars);
  $('#win-level').textContent = save.level - 1;
  $('#win-coins').textContent = '+' + CFG.levelBonus(save.level - 1);
  $('#win-words').textContent = state.words.length;
  $('#win-extra').textContent = state.extras.length;
  showScreen('#screen-win');
}

/* ---------------- Уровни ---------------- */

function startLevel(fresh) {
  const seed = fresh
    ? hash(save.difficulty + ':' + save.level + ':' + Date.now())
    : hash(save.difficulty + ':' + save.level);

  const usedWords = new Set(save.usedWords);
  const words = chooseWords(save.difficulty, makeRng(seed), usedWords);
  save.usedWords = Array.from(usedWords).slice(-4000);

  const layout = buildCrossword(words);
  state.words = words;
  state.grid = layout.grid;
  state.owners = layout.owners;
  state.rows = layout.rows;
  state.cols = layout.cols;
  state.found = new Set();
  state.extras = [];
  state.letters = lettersOf(words);
  state.input = '';
  state.combo = 0;
  state.hintsUsed = 0;
  state.won = false;

  $('#hud-level').textContent = save.level;
  $('#hud-combo').textContent = '0';

  showScreen('#screen-game');
  rebuildCrossword();
  renderInput();
  renderSideList();
  renderWheel();
  fitCrossword();
  updateProgress();
  updateHud();
  persist();
}

function saveCurrent() {
  if (!state.words.length) return;
  // Собранный уровень не сохраняем: номер уже увеличен, и при
  // возврате «Играть» игрок получил бы полностью заполненное поле.
  if (state.won) { save.current = null; persist(); return; }
  save.current = {
    level: save.level,
    difficulty: save.difficulty,
    words: state.words,
    found: Array.from(state.found),
    extras: state.extras.slice(),
  };
  persist();
}

function resumeLevel() {
  const cur = save.current;
  const layout = buildCrossword(cur.words);
  state.words = cur.words;
  state.grid = layout.grid;
  state.owners = layout.owners;
  state.rows = layout.rows;
  state.cols = layout.cols;
  state.found = new Set(cur.found);
  state.extras = (cur.extras || []).slice();
  state.letters = lettersOf(cur.words);
  state.input = '';
  state.combo = 0;
  state.hintsUsed = 0;
  state.won = false;

  $('#hud-level').textContent = cur.level;
  $('#hud-combo').textContent = '0';

  showScreen('#screen-game');
  rebuildCrossword();
  renderInput();
  renderSideList();
  renderWheel();
  fitCrossword();
  updateProgress();
  updateHud();
}

/* ---------------- Подсказки (за монеты) ---------------- */

/**
 * Подсказка-буква: подсказывает букву настоящего слова уровня,
 * а не случайную. Берём то слово, которое продолжает текущий ввод,
 * иначе — самое частое из оставшихся (оно в начале списка).
 * Пишем букву на её место в слове, чтобы подсказка всегда
 * приближала к цели, а не ломала начатый ввод.
 */
function useHint() {
  if (!state.words.length) return;
  // Пока вписывается слово или дописывается предыдущая подсказка —
  // не вмешиваемся: набранное всё равно перезапишется.
  if (state.hintBusy || state.solveBusy) return;

  const rest = restWords();
  if (!rest.length) { toast('Все слова найдены'); return; }

  if (save.coins < CFG.hintCost) {
    toast('Недостаточно монет! Нужно ' + CFG.hintCost);
    beep(180, 0.15, 'square');
    vibrate(30);
    return;
  }

  // Слово-продолжение текущего ввода; иначе — самое частое оставшееся
  const candidates = rest.filter((w) => w.startsWith(state.input));
  const word = candidates.length ? candidates[0] : rest[0];

  // Позиция первой буквы, которой ещё нет во вводе
  let pos = -1;
  for (let i = 0; i < word.length; i++) {
    if (!state.input.includes(word[i])) { pos = i; break; }
  }

  if (pos < 0) {
    // Все буквы слова уже есть во вводе — подсказываем целиком
    toast('Слово: ' + word);
    beep(760, 0.09);
    return;
  }

  save.coins -= CFG.hintCost;
  state.hintsUsed += 1;
  state.hintBusy = true;

  // Ставим букву на её место: начатый ввод не портим
  state.input = word.slice(0, pos) + word[pos] + state.input.slice(pos);
  renderInput();
  markUsedLetters();

  updateHud();
  persist();

  toast('+Буква «' + word[pos].toUpperCase() + '» · ' + CFG.hintCost + ' ★');
  beep(760, 0.09);
  vibrate(10);

  // Слово могло собраться целиком — засчитываем, но не раньше,
  // чем игрок увидит букву, поэтому проверка отложена.
  setTimeout(() => {
    state.hintBusy = false;
    if (state.input && restWords().includes(state.input)) acceptWord(state.input);
  }, 700);
}

/** Показать слово целиком: вписываем в кроссворд. */
function useSolve() {
  if (!state.words.length) return;
  // Пока вписывается слово или дописывается подсказка-буква —
  // не начинаем вторую анимацию, она бы перемешала ввод.
  if (state.solveBusy || state.hintBusy) return;

  const rest = restWords();
  if (!rest.length) { toast('Все слова найдены'); return; }

  if (save.coins < CFG.solveCost) {
    toast('Недостаточно монет! Нужно ' + CFG.solveCost);
    beep(180, 0.15, 'square');
    vibrate(30);
    return;
  }

  save.coins -= CFG.solveCost;
  state.hintsUsed += 1;
  state.solveBusy = true;
  updateHud();
  persist();

  const word = pick(rest, Math.random);
  showBanner(word);
  beep(880, 0.1);

  // анимация: вписываем буквы по одной
  state.input = '';
  renderInput();
  let i = 0;
  const timer = setInterval(() => {
    state.input += word[i++];
    renderInput();
    if (i >= word.length) {
      clearInterval(timer);
      setTimeout(() => {
        state.solveBusy = false;
        acceptWord(word);
      }, 300);
    }
  }, 130);
}

function toggleSound() {
  save.sound = !save.sound;
  persist();
  if (save.sound) beep(700, 0.08);
}

/* ---------------- Ежедневный подарок ---------------- */

function checkDaily() {
  if (save.lastDaily === todayStr()) return;
  $('#daily-amount').textContent = CFG.dailyReward;
  openModal('#modal-daily');
}

$('#btn-daily-claim').addEventListener('click', () => {
  save.coins += CFG.dailyReward;
  save.lastDaily = todayStr();
  persist();
  closeModal('#modal-daily');
  updateHud();
  toast('+' + CFG.dailyReward + ' монет');
  beep(760, 0.1);
});

/* ---------------- Навигация ---------------- */

function goMenu() {
  saveCurrent();
  showScreen('#screen-menu');
  updateHud();
}

$('#btn-play').addEventListener('click', () => {
  if (save.current && save.current.level === save.level) resumeLevel();
  else startLevel(false);
});
$('#btn-new').addEventListener('click', () => { save.current = null; startLevel(true); });
$('#btn-menu').addEventListener('click', goMenu);
$('#btn-rules').addEventListener('click', () => openModal('#modal-how'));
$('#btn-next').addEventListener('click', () => startLevel(false));
$('#btn-win-menu').addEventListener('click', goMenu);

$('#btn-hint').addEventListener('click', useHint);
$('#btn-solve').addEventListener('click', useSolve);
$('#btn-sound').addEventListener('click', toggleSound);

$('#btn-erase').addEventListener('click', eraseLetter);

// сворачивание бокового списка — когда мешает кроссворду
$('#btn-side').addEventListener('click', () => {
  state.sideOpen = !state.sideOpen;
  const side = $('#side-words');
  side.classList.toggle('is-collapsed', !state.sideOpen);
  $('#btn-side').classList.toggle('is-open', state.sideOpen);
  setTimeout(fitCrossword, 260);
});

// клавиатура — для отладки на компьютере
document.addEventListener('keydown', (e) => {
  if (!document.querySelector('#screen-game').classList.contains('is-active')) return;
  // Пока открыта модалка, буквы не набираем — иначе слово дописывается
  // под надписью «Как играть».
  if (document.querySelector('.modal:not([hidden])')) return;
  if (/^[а-яёА-ЯЁ]$/i.test(e.key)) { addLetter(e.key.toLowerCase()); e.preventDefault(); }
  else if (e.key === 'Backspace') { eraseLetter(); e.preventDefault(); }
});

$('#btn-difficulty').addEventListener('click', () => {
  // Подписи берём из DIFFICULTY, чтобы цифры не расходились с игрой
  document.querySelectorAll('[data-hint]').forEach((el) => {
    el.textContent = difficultyHint(el.dataset.hint);
  });
  document.querySelectorAll('.diff').forEach((b) =>
    b.classList.toggle('is-active', b.dataset.diff === save.difficulty));
  openModal('#modal-diff');
});
document.querySelectorAll('.diff').forEach((b) => {
  b.addEventListener('click', () => {
    save.difficulty = b.dataset.diff;
    save.current = null;
    $('#menu-diff').textContent = DIFFICULTY[b.dataset.diff].label;
    persist();
    closeModal('#modal-diff');
    toast('Сложность: ' + DIFFICULTY[b.dataset.diff].label);
  });
});
$('#btn-how').addEventListener('click', () => openModal('#modal-how'));

document.querySelectorAll('[data-close]').forEach((b) =>
  b.addEventListener('click', () => b.closest('.modal').hidden = true));
document.querySelectorAll('.modal').forEach((m) =>
  m.addEventListener('click', (e) => { if (e.target === m) m.hidden = true; }));

$('#btn-reset').addEventListener('click', () => {
  if (confirm('Сбросить весь прогресс?')) {
    save = { ...DEFAULT_SAVE };
    persist();
    updateHud();
    toast('Прогресс сброшен');
  }
});

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') saveCurrent();
});
window.addEventListener('pagehide', saveCurrent);

/* ---------------- Инициализация ---------------- */

function init() {
  $('#menu-diff').textContent = DIFFICULTY[save.difficulty].label;
  // Обновляем цены подсказок
  const hintCostEl = $('#hint-cost');
  const solveCostEl = $('#solve-cost');
  if (hintCostEl) hintCostEl.textContent = CFG.hintCost;
  if (solveCostEl) solveCostEl.textContent = CFG.solveCost;
  updateHud();
  showScreen('#screen-menu');
  checkDaily();

  let resizeTimer = null;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => { fitCrossword(); renderWheel(); }, 150);
  });

  console.log('Собери слово: в словаре', ALL_WORDS.length, 'слов');
}

init();

/* Service worker — офлайн. На localhost не регистрируем. */
if ('serviceWorker' in navigator && location.protocol.startsWith('http') &&
    !['localhost', '127.0.0.1', ''].includes(location.hostname)) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  });
}