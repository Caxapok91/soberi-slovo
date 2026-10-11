/* ============================================================
   УРОВНИ — подбор слов и сложности
   ============================================================ */

/** Детерминированный ГПСЧ (mulberry32). */
function makeRng(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pick(arr, rng) {
  return arr[Math.floor(rng() * arr.length)];
}

function hash(str) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

const DIFFICULTY = {
  easy:   { count: 5, min: 3, max: 5, label: 'Легко' },
  normal: { count: 5, min: 4, max: 6, label: 'Средняя' },
  hard:   { count: 5, min: 5, max: 9, label: 'Сложно' },
};

function poolForLength(min, max) {
  const pool = [];
  for (let len = min; len <= max; len++) {
    const list = WORDS[len];
    if (!list) continue;
    for (let i = 0; i < list.length; i++) {
      // слегка понижаем шанс самых частых слов — уровни не будут однообразными
      pool.push({ word: list[i], w: Math.exp(-i / 700) + 0.06 });
    }
  }
  return pool;
}

/** Набор целевых слов без повторов (в т.ч. с прошлых уровней). */
function chooseWords(diffKey, rng, usedWords) {
  const cfg = DIFFICULTY[diffKey];
  const pool = poolForLength(cfg.min, cfg.max);
  if (!pool.length) return [];

  const totalW = pool.reduce((s, it) => s + it.w, 0);
  const picked = [];
  const usedHere = new Set();
  let guard = 0;

  while (picked.length < cfg.count && guard++ < cfg.count * 300) {
    let x = rng() * totalW;
    let chosen = pool[pool.length - 1];
    for (const item of pool) {
      x -= item.w;
      if (x <= 0) { chosen = item; break; }
    }
    const w = chosen.word;
    if (usedHere.has(w) || usedWords.has(w)) continue;
    usedHere.add(w);
    usedWords.add(w);
    picked.push(w);
  }

  // Слова разной длины: иначе ряд выглядит ровным и играть скучно.
  picked.sort((a, b) => a.length - b.length);
  return picked;
}

/**
 * Раскладка пустого кроссворда: под каждое слово — ряд пустых клеток,
 * остальное закрыто «заглушками», чтобы выглядело как кроссворд.
 */
function buildCrossword(words) {
  const maxLen = words.reduce((m, w) => Math.max(m, w.length), 0);
  const rows = [];
  words.forEach((word, i) => {
    const lead = i % 2 === 0 ? 1 : 2;          // ряды вразнобой, как в кроссворде
    const cells = [];
    for (let k = 0; k < lead; k++) cells.push(null);
    for (let k = 0; k < word.length; k++) cells.push('');
    const tail = maxLen + 2 - lead - word.length;
    for (let k = 0; k < tail; k++) cells.push(null);
    rows.push({ word, cells });
  });
  return { rows, cols: maxLen + 2 };
}

/** Разные буквы уровня — их и показываем на круге. */
function lettersOf(words) {
  const set = new Set();
  words.forEach((w) => w.split('').forEach((ch) => set.add(ch)));
  return Array.from(set).sort();
}