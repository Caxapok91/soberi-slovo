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
  rows: [],         // раскладка кроссворда
  cols: 0,
  found: new Set(), // найденные задания
  extras: [],       // бонусные слова из тех же букв
  letters: [],      // все буквы уровня
  input: '',        // набираемое слово
  combo: 0,
  hintsUsed: 0,
  sideOpen: true,   // показывать ли список слов сбоку
};

/* ---------------- Экраны ---------------- */

function showScreen(id) {
  document.querySelectorAll('.screen').forEach((s) => s.classList.remove('is-active'));
  $(id).classList.add('is-active');
}
const openModal = (sel) => { $(sel).hidden = false; };
const closeModal = (sel) => { $(sel).hidden = true; };

/* ---------------- Рендер кроссворда ---------------- */

/** Собираем кроссворд заново: пустые клетки + найденные слова. */
function rebuildCrossword() {
  const box = $('#crossword');
  box.innerHTML = '';

  for (const row of state.rows) {
    const el = document.createElement('div');
    el.className = 'cw-row' + (state.found.has(row.word) ? ' is-done' : '');
    el.dataset.word = row.word;

    const lead = row.cells.filter((c) => c === null).length;
    for (let k = 0; k < lead; k++) {
      const b = document.createElement('div');
      b.className = 'cw-cell cw-cell--block';
      el.appendChild(b);
    }

    const isDone = state.found.has(row.word);
    for (let k = 0; k < row.word.length; k++) {
      const c = document.createElement('div');
      c.className = 'cw-cell';
      if (isDone) c.textContent = row.word[k];
      el.appendChild(c);
    }

    const used = lead + row.word.length;
    for (let k = used; k < state.cols; k++) {
      const b = document.createElement('div');
      b.className = 'cw-cell cw-cell--block';
      el.appendChild(b);
    }

    box.appendChild(el);
  }
}

/** Подгоняем размер клеток под экран. */
function fitCrossword() {
  const area = $('.crossword-area');
  const box = $('#crossword');
  if (!box.children.length) return;

  const availW = area.clientWidth - 24;
  const availH = area.clientHeight - 30;
  if (availW < 40 || availH < 40) { requestAnimationFrame(fitCrossword); return; }

  const rows = box.children.length;
  const cols = state.cols;
  const GAP = 3, ROWGAP = 6, PAD = 6;

  let cell = Math.min(
    (availW - PAD * 2 - GAP * (cols - 1)) / cols,
    (availH - PAD * 2 - ROWGAP * (rows - 1)) / rows
  );
  cell = Math.max(16, Math.floor(Math.min(cell, 46)));

  document.documentElement.style.setProperty('--cw-cell', cell + 'px');
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
  box.classList.toggle('is-collapsed', !state.sideOpen);
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

function renderWheel() {
  const wheel = $('#wheel');
  wheel.querySelectorAll('.wheel__letter').forEach((el) => el.remove());

  const letters = wheelLetters();
  const n = Math.max(1, letters.length);

  // Размер колеса задаёт CSS; кнопки считаем от него же.
  const room = Math.max(104, Math.min(window.innerWidth * 0.74, window.innerHeight * 0.34));
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

/** Длина самого короткого ненайденного слова — сколько слотов показывать. */
function minWordLen() {
  const rest = restWords();
  if (!rest.length) return 0;
  return rest.reduce((m, w) => Math.min(m, w.length), 99);
}

/** Длина самого длинного ненайденного слова — предел ввода. */
function maxWordLen() {
  const rest = restWords();
  const list = rest.length ? rest : state.words;
  return list.reduce((m, w) => Math.max(m, w.length), 0) || 8;
}

function addLetter(ch) {
  const maxLen = maxWordLen();
  if (state.input.length >= maxLen) {
    shakeWordbar();
    beep(180, 0.1, 'square');
    return;
  }

  state.input += ch;
  renderInput();
  markUsedLetters();
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
  state.input = state.input.slice(0, -1);
  renderInput();
  markUsedLetters();
  beep(320, 0.05);
}

function clearInput() {
  state.input = '';
  renderInput();
  markUsedLetters();
}

/**
 * Поле ввода: слотов столько, сколько букв в самом длинном слове уровня.
 * Количество не меняется — всегда одинаковый набор, пустые слоты видны,
 * поэтому сразу понятно, какие слова вообще можно ввести.
 */
function renderInput() {
  const box = $('#wordbar');
  const show = Math.max(maxWordLen(), 1);

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
    // вдруг игрок допечатает продолжение
    submitTimer = setTimeout(() => {
      if (state.input !== word) return;
      if (restWords().includes(word)) { acceptWord(word); return; }
      if (isPrefix) toast('Допиши слово');
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
  state.combo += 1;
  $('#hud-combo').textContent = state.combo;

  const reward = CFG.wordReward(word.length) + CFG.comboBonus(state.combo);
  save.coins += reward;

  clearInput();
  rebuildCrossword();
  renderSideList();         // список сбоку
  renderWheel();            // буквы найденного слова убираются с круга
  updateProgress();
  updateHud();
  persist();

  showBanner(word);
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
  state.extras.push(word);
  save.coins += CFG.extraReward;

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
  state.rows = layout.rows;
  state.cols = layout.cols;
  state.found = new Set();
  state.extras = [];
  state.letters = lettersOf(words);
  state.input = '';
  state.combo = 0;
  state.hintsUsed = 0;

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
  state.rows = layout.rows;
  state.cols = layout.cols;
  state.found = new Set(cur.found);
  state.extras = (cur.extras || []).slice();
  state.letters = lettersOf(cur.words);
  state.input = '';
  state.combo = 0;
  state.hintsUsed = 0;

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

/** Подсказка: добавляет правильную букву в набор. */
function useHint() {
  if (!state.words.length) return;
  const rest = state.words.filter((w) => !state.found.has(w));
  if (!rest.length) { toast('Все слова найдены'); return; }

  // Проверка монет
  if (save.coins < CFG.hintCost) {
    toast('Недостаточно монет! Нужно ' + CFG.hintCost);
    beep(180, 0.15, 'square');
    vibrate(30);
    return;
  }

  // Ищем слово, которое можно продолжить текущим вводом
  let candidates = rest.filter((w) => w.startsWith(state.input));
  let word;
  
  // Если ввод является началом слова — берем первое такое слово
  if (candidates.length > 0) {
    // Сортируем по частотности (самые первые в массиве — самые частые)
    word = candidates[0];
  } else {
    // Иначе берём случайное ненайденное слово
    word = pick(rest, Math.random);
  }

  // Находим первую букву этого слова, которой ещё нет в наборе
  let hintLetter = null;
  for (const ch of word) {
    if (!state.input.includes(ch)) {
      hintLetter = ch;
      break;
    }
  }

  if (!hintLetter) {
    // Все буквы слова уже в наборе — говорим слово
    toast('Слово: ' + word);
    beep(760, 0.09);
    return;
  }

  // Списываем монеты
  save.coins -= CFG.hintCost;
  state.hintsUsed += 1;

  // Добавляем букву в набор
  state.input += hintLetter;
  renderInput();
  markUsedLetters();

  updateHud();
  persist();

  // Показываем, из какого слова взята буква
  toast('+Буква «' + hintLetter.toUpperCase() + '» из слова «' + word + '» (' + CFG.hintCost + ' ★)');
  beep(760, 0.09);
  vibrate(10);

  // Автопроверка слова
  autoSubmit();
}

/** Показать слово целиком: вписываем в кроссворд. */
function useSolve() {
  if (!state.words.length) return;
  const rest = state.words.filter((w) => !state.found.has(w));
  if (!rest.length) { toast('Все слова найдены'); return; }

  // Проверка монет
  if (save.coins < CFG.solveCost) {
    toast('Недостаточно монет! Нужно ' + CFG.solveCost);
    beep(180, 0.15, 'square');
    vibrate(30);
    return;
  }

  save.coins -= CFG.solveCost;
  state.hintsUsed += 1;
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
      setTimeout(() => acceptWord(word), 300);
    }
  }, 130);

  updateHud();
  persist();
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
  if (/^[а-яёА-ЯЁ]$/i.test(e.key)) { addLetter(e.key.toLowerCase()); e.preventDefault(); }
  else if (e.key === 'Backspace') { eraseLetter(); e.preventDefault(); }
});

$('#btn-difficulty').addEventListener('click', () => {
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