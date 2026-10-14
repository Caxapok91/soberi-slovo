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

/**
 * Сложности. Длины ограничены тем, что реально есть в словаре
 * (3–6 букв), — иначе игра обещает слова, которых не бывает.
 * Число слов и диапазон длин показываются в интерфейсе отсюда,
 * поэтому правки вносятся только в этом месте.
 */
const DIFFICULTY = {
  easy:   { count: 4, min: 3, max: 4, label: 'Легко',   stars: 1 },
  normal: { count: 5, min: 4, max: 6, label: 'Средняя', stars: 2 },
  hard:   { count: 5, min: 5, max: 6, label: 'Сложно',  stars: 3 },
};

/** «4 слова по 3–4 буквы» — подпись для окна выбора сложности. */
function difficultyHint(key) {
  const d = DIFFICULTY[key];
  const word = plural(d.count, ['слово', 'слова', 'слов']);
  const letters = plural(d.max, ['буква', 'буквы', 'букв']);
  return d.count + ' ' + word + ' по ' + d.min + '–' + d.max + ' ' + letters;
}

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

/**
 * Слова по убыванию числа общих букв с остальными.
 * Кладём вперёд те, за что есть зацепиться.
 */
function byConnectivity(words) {
  const deg = new Map();
  for (const w of words) {
    let n = 0;
    for (const o of words) if (o !== w && sharesLetter(w, o)) n++;
    deg.set(w, n);
  }
  return words.slice().sort((a, b) => deg.get(b) - deg.get(a));
}

/** Есть ли общая буква у двух слов — из неё получится пересечение. */
function sharesLetter(a, b) {
  const set = new Set(a);
  for (const ch of b) if (set.has(ch)) return true;
  return false;
}

/**
 * Набор целевых слов без повторов (в т.ч. с прошлых уровней).
 *
 * Стараемся брать слова, имеющие общую букву с уже выбранными: иначе
 * в кроссворде не будет ни одного пересечения и подсказки работать
 * не станет. Пересечения — основа игры, поэтому допускаем «не связанное»
 * слово только пока их ещё мало.
 */
function chooseWords(diffKey, rng, usedWords) {
  const cfg = DIFFICULTY[diffKey];

  let picked = pickForLevel(diffKey, rng, usedWords);

  // Слова кончились — начинаем круг заново, иначе уровень получится
  // из двух слов вместо пяти. Старый список забываем.
  if (picked.length < cfg.count) {
    usedWords.clear();
    picked = pickForLevel(diffKey, rng, usedWords);
  }

  // Слова разной длины: иначе ряд выглядит ровным и играть скучно.
  picked.sort((a, b) => a.length - b.length);
  return picked;
}

/** Набирает слова уровня, не повторяя уже использованные. */
function pickForLevel(diffKey, rng, usedWords) {
  const cfg = DIFFICULTY[diffKey];
  const pool = poolForLength(cfg.min, cfg.max);
  if (!pool.length) return [];

  const totalW = pool.reduce((s, it) => s + it.w, 0);
  const picked = [];
  const usedHere = new Set();

  const draw = () => {
    let x = rng() * totalW;
    for (const item of pool) {
      x -= item.w;
      if (x <= 0) return item.word;
    }
    return pool[pool.length - 1].word;
  };
  const take = (w) => {
    if (usedHere.has(w) || usedWords.has(w)) return false;
    usedHere.add(w);
    picked.push(w);
    return true;
  };

  let guard = 0;
  while (picked.length < cfg.count && guard++ < cfg.count * 400) {
    const w = draw();
    if (usedHere.has(w) || usedWords.has(w)) continue;
    if (picked.length && picked.length >= cfg.count - 2) {
      // последние слова обязаны смыкаться с уже подобранными
      if (!picked.some((p) => sharesLetter(p, w))) continue;
    }
    take(w);
  }

  // Связных слов не нашлось — добираем любые
  guard = 0;
  while (picked.length < cfg.count && guard++ < cfg.count * 400) {
    take(draw());
  }

  for (const w of picked) usedWords.add(w);
  return picked;
}

/**
 * Раскладка кроссворда, где слова пересекаются друг с другом.
 *
 * Каждое слово кладётся в сетку по горизонтали или по вертикали и
 * цепляется за уже положенное слово общей буквой. Поэтому, когда игрок
 * отгадывает одно слово, в соседних открывается буква — и это настоящая
 * подсказка для следующего, а не отдельная кнопка.
 *
 * Правила раскладки — как в обычном кроссворде:
 *  · буквы на пересечении обязаны совпадать;
 *  · рядом с буквой не может стоять буква чужого слова (только в точке
 *    пересечения — там слова принадлежат одному и тому же ряду);
 *  · перед началом и после конца слова должна быть пустая клетка.
 *
 * Возвращает обрезанную по содержимому сетку:
 *   grid[r][c]  — буква или null (пусто)
 *   entries     — слова с их клетками и направлением
 *   owners[r][c]— какие слова проходят через клетку
 */
function buildCrossword(words) {
  if (!words || !words.length) {
    return { grid: [[null]], rows: 1, cols: 1, entries: [], owners: [[]] };
  }

  // Одна попытка может разойтись: слова без общих букв вынуждены
  // вставать отдельно и растягивают сетку. Перебираем несколько
  // порядков и направлений первого слова и берём лучший результат —
  // детерминированно, от набора слов.
  const base = byConnectivity(words);
  const variants = [];

  // порядок: по связности и с перестановкой хвоста
  variants.push({ order: base, first: 'h' });
  variants.push({ order: base, first: 'v' });
  for (let k = 1; k <= 3; k++) {
    const alt = base.slice();
    for (let i = alt.length - 1; i > 0; i--) {
      const j = (i + k * 3) % (i + 1);
      const t = alt[i]; alt[i] = alt[j]; alt[j] = t;
    }
    variants.push({ order: alt, first: 'h' });
    variants.push({ order: alt, first: 'v' });
  }

  let best = null;
  for (const v of variants) {
    const lay = layoutAttempt(words, v.order, v.first);
    if (!best || layoutScore(lay) > layoutScore(best)) best = lay;
  }
  return best;
}

/** Оценка раскладки: больше пересечений и плотнее — лучше. */
function layoutScore(lay) {
  let cross = 0, filled = 0;
  for (let r = 0; r < lay.rows; r++) {
    for (let c = 0; c < lay.cols; c++) {
      if (!lay.grid[r][c]) continue;
      filled++;
      if (lay.owners[r][c].length > 1) cross++;
    }
  }
  const area = lay.rows * lay.cols;
  return cross * 1000 + (area ? filled / area : 0) * 100 - area;
}

/**
 * Одна попытка раскладки: кладём слова по порядку `order`,
 * первое — в направлении `firstDir`.
 */
function layoutAttempt(words, order, firstDir) {
  const N = 15;
  const MID = Math.floor(N / 2);
  const grid = Array.from({ length: N }, () => new Array(N).fill(null));
  const entries = [];

  const inb = (r, c) => r >= 0 && c >= 0 && r < N && c < N;
  const get = (r, c) => (inb(r, c) ? grid[r][c] : undefined);

  const cellsOf = (word, r0, c0, dr, dc) =>
    word.split('').map((ch, k) => ({ r: r0 + dr * k, c: c0 + dc * k, ch }));

  /** Сколько клеток нового слова лягут поверх уже занятых. */
  function crossings(cells) {
    let n = 0;
    for (const k of cells) if (get(k.r, k.c) !== null && get(k.r, k.c) !== undefined) n++;
    return n;
  }

  /** Можно ли положить слово на эти клетки. */
  function canPlace(cells, dir, cross) {
    for (const k of cells) {
      const cur = get(k.r, k.c);
      if (cur !== undefined && cur !== null && cur !== k.ch) return false;
    }

    // Боковые соседи. В точке пересечения разрешаем клетки того слова,
    // с которым пересекаемся, — иначе слова слиплись бы в одно.
    const side = dir === 'h' ? [[-1, 0], [1, 0]] : [[0, -1], [0, 1]];
    for (const k of cells) {
      const atCross = cross && cross.cells.some(p => p.r === k.r && p.c === k.c);
      for (const [dr, dc] of side) {
        const nr = k.r + dr, nc = k.c + dc;
        const v = get(nr, nc);
        if (v === undefined || v === null) continue;
        if (atCross && cross.cells.some(p => p.r === nr && p.c === nc)) continue;
        return false;
      }
    }

    // До начала и после конца — пустота, иначе слова сольются в ряд.
    const [dr, dc] = dir === 'h' ? [0, 1] : [1, 0];
    const a = cells[0], z = cells[cells.length - 1];
    const before = get(a.r - dr, a.c - dc);
    const after = get(z.r + dr, z.c + dc);
    if (before !== undefined && before !== null) return false;
    if (after !== undefined && after !== null) return false;
    return true;
  }

  function place(cells, word, dir) {
    for (const k of cells) grid[k.r][k.c] = k.ch;
    entries.push({ word, dir, cells });
  }

  // Первое слово — в середине полотна, а не у края: тогда остальным
  // есть место и вверх, и вниз, и пересечения не отбрасываются
  // из-за границы.
  const w0 = order[0];
  const [fdr, fdc] = firstDir === 'v' ? [1, 0] : [0, 1];
  const fr = firstDir === 'v' ? MID - Math.floor(w0.length / 2) : MID;
  const fc = firstDir === 'v' ? Math.floor((N - w0.length) / 2)
                              : Math.floor((N - w0.length) / 2);
  place(cellsOf(w0, fr, fc, fdr, fdc), w0, firstDir);

  // Границы уже занятого — по ним считаем, насколько Candidate раздует сетку
  const box = () => {
    let r0 = N, r1 = -1, c0 = N, c1 = -1;
    for (let r = 0; r < N; r++) {
      for (let c = 0; c < N; c++) {
        if (grid[r][c] === null) continue;
        if (r < r0) r0 = r; if (r > r1) r1 = r;
        if (c < c0) c0 = c; if (c > c1) c1 = c;
      }
    }
    return r1 < 0 ? null : { r0, r1, c0, c1 };
  };

  /** Насколько кандидат расширит занятую область. Меньше — лучше. */
  const spread = (cells, b) => {
    let r0 = b.r0, r1 = b.r1, c0 = b.c0, c1 = b.c1;
    for (const k of cells) {
      if (k.r < r0) r0 = k.r; if (k.r > r1) r1 = k.r;
      if (k.c < c0) c0 = k.c; if (k.c > c1) c1 = k.c;
    }
    return (r1 - r0 + 1) * (c1 - c0 + 1);
  };

  /** Сумма расстояний кандидата до центра занятой области. */
  const distance = (cells, b) => {
    const mr = (b.r0 + b.r1) / 2, mc = (b.c0 + b.c1) / 2;
    let d = 0;
    for (const k of cells) d += Math.abs(k.r - mr) + Math.abs(k.c - mc);
    return d;
  };

  // Пересечения важнее всего, дальше — компактность и близость
  // к уже занятым клеткам: разреженная сетка плохо читается.
  const rank = (cells, b) =>
    crossings(cells) * 10000 - spread(cells, b) * 12 - distance(cells, b);

  for (let i = 1; i < order.length; i++) {
    const word = order[i];
    const lastDir = entries[entries.length - 1].dir;
    const b = box();
    let best = null;

    const consider = (cells, dir, cross) => {
      const s = rank(cells, b);
      if (!best || s > best.s ||
          (s === best.s && dir !== lastDir)) {
        best = { cells, dir, s };
      }
    };

    // Пересечение с уже положенными словами
    for (const e of entries) {
      for (const p of e.cells) {
        const at = word.indexOf(p.ch);
        if (at < 0) continue;
        const dir = e.dir === 'h' ? 'v' : 'h';
        const [dr, dc] = dir === 'h' ? [0, 1] : [1, 0];
        const cells = cellsOf(word, p.r - dr * at, p.c - dc * at, dr, dc);
        if (cells.some(k => !inb(k.r, k.c))) continue;
        if (!canPlace(cells, dir, e)) continue;
        consider(cells, dir, e);
      }
    }

    if (best) { place(best.cells, word, best.dir); continue; }

    // Пересечения нет — ставим рядом с уже занятым, а не в дальний угол.
    // Пробуем оба направления: вертикальное слово занимает
    // меньше ширины и не растягивает сетку вширь.
    let fallback = null;
    for (const dir of ['h', 'v']) {
      const [dr, dc] = dir === 'h' ? [0, 1] : [1, 0];
      for (let r = 0; r < N; r++) {
        for (let c = 0; c < N; c++) {
          const cells = cellsOf(word, r, c, dr, dc);
          if (cells.some((k) => !inb(k.r, k.c))) continue;
          if (!canPlace(cells, dir, null)) continue;
          const s = rank(cells, b);
          if (!fallback || s > fallback.s) fallback = { cells, dir, s };
        }
      }
    }

    if (fallback) { place(fallback.cells, word, fallback.dir); continue; }
    place(cellsOf(word, 2 + i, 2, 0, 1), word, 'h');   // аварийно
  }

  // Обрезаем пустые поля вокруг
  let r0 = N, r1 = -1, c0 = N, c1 = -1;
  for (let r = 0; r < N; r++) {
    for (let c = 0; c < N; c++) {
      if (grid[r][c] === null) continue;
      if (r < r0) r0 = r; if (r > r1) r1 = r;
      if (c < c0) c0 = c; if (c > c1) c1 = c;
    }
  }
  if (r1 < 0) { r0 = r1 = 0; c0 = c1 = 0; }

  const rows = r1 - r0 + 1;
  const cols = c1 - c0 + 1;
  const cut = grid.slice(r0, r1 + 1).map(row => row.slice(c0, c1 + 1));

  // Кому принадлежит клетка — нужно, чтобы открывать буквы при находке
  const owners = Array.from({ length: rows }, () => Array.from({ length: cols }, () => []));
  entries.forEach((e, idx) => {
    e.cells = e.cells.map(k => ({ r: k.r - r0, c: k.c - c0, ch: k.ch }));
    for (const k of e.cells) owners[k.r][k.c].push(e.word);
  });

  return compactGrid({ grid: cut, rows, cols, entries, owners });
}

/**
 * Убирает совсем пустые строки и столбцы внутри сетки.
 *
 * При укладке слова уходят в дальние углы, и между ними остаются
 * широкие пустые полосы — кроссворд выглядит разорванным. Пустая
 * строка или столбец по определению не участвует ни в одном
 * пересечении, поэтому её можно вырезать без последствий: просто
 * сдвигаем координаты всех, кто стоит ниже или правее.
 */
function compactGrid(lay) {
  const { grid, rows, cols, entries } = lay;

  const dropCol = (c) => {
    for (const row of grid) row.splice(c, 1);
  };
  const dropRow = (r) => grid.splice(r, 1);
  const w = () => grid[0] ? grid[0].length : 0;

  /**
   * Порядок важен: сначала стягиваем ряды, потом столбцы, и повторяем,
   * пока не станет стабильно. Иначе можно вырезать разделительный
   * столбец, пока слова ещё стоят в разных рядах, а потом стянуть
   * ряды — и слова окажутся в ряд без промежутка.
   */
  for (let guard = 0; guard < 40; guard++) {
    let changed = false;

    for (let r = grid.length - 1; r >= 0; r--) {
      if (grid.length <= 1) break;
      const isEmpty = grid[r].every((x) => x === null);
      if (!isEmpty) continue;
      const edge = r === 0 || r === grid.length - 1;
      let ok = edge;
      if (!ok) {
        for (let c = 0; c < w(); c++) {
          if (grid[r - 1][c] !== null && grid[r + 1][c] !== null) { ok = false; break; }
        }
      }
      if (!ok) continue;
      dropRow(r); changed = true;
    }

    for (let c = w() - 1; c >= 0; c--) {
      if (w() <= 1) break;
      let empty = true;
      for (let r = 0; r < grid.length; r++) if (grid[r][c] !== null) { empty = false; break; }
      if (!empty) continue;
      const edge = c === 0 || c === w() - 1;
      let ok = edge;
      if (!ok) {
        for (let r = 0; r < grid.length; r++) {
          if (grid[r][c - 1] !== null && grid[r][c + 1] !== null) { ok = false; break; }
        }
      }
      if (!ok) continue;
      dropCol(c); changed = true;
    }

    if (!changed) break;
  }

  lay.rows = grid.length;
  lay.cols = w();

  // Пересобираем координаты слов и владельцев клеток под новую сетку
  const owners = Array.from({ length: lay.rows }, () => Array.from({ length: lay.cols }, () => []));
  entries.forEach((e) => {
    for (const k of e.cells) {
      if (grid[k.r] && grid[k.r][k.c] !== null) owners[k.r][k.c].push(e.word);
    }
  });

  return { grid, rows: lay.rows, cols: lay.cols, entries, owners };
}

/** Разные буквы уровня — их и показываем на круге. */
function lettersOf(words) {
  const set = new Set();
  words.forEach((w) => w.split('').forEach((ch) => set.add(ch)));
  return Array.from(set).sort();
}