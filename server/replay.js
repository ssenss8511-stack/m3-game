/*
 * Server-side match-3 replay.
 * Порт движка `webapp/js/game.js` без DOM: восстанавливает партию из
 * (seed, moveLog) и вычисляет каноничные метрики (score / matches /
 * cascade). Используется в /api/end, чтобы сравнить с тем, что прислал
 * клиент, и обрезать читерский счёт.
 *
 * ВАЖНО: PRNG (Mulberry32), веса выпадения и правила матчей ДОЛЖНЫ быть
 * идентичны клиенту. При изменении game.js — синхронизируй и здесь.
 */
const C = require('./config');

// --- Константы: должны совпадать с webapp/js/config.js ---
const COLS = 9, ROWS = 9;
const BASE_TYPES = 5;                     // обычные фигуры (0..4)
const SPECIALS = [                        // спец-фишки (5..7); id важен для наград
  { id: 'coin',   weight: 0.8,  reward: { coinsPerGem: 1 } },
  { id: 'gift',   weight: 0.4,  reward: { mystery: true } },
  { id: 'energy', weight: 0.15, reward: { energyPer3: 1 } },
];
const WEIGHTS = [];
for (let i = 0; i < BASE_TYPES; i++) WEIGHTS.push(1);
SPECIALS.forEach((s) => WEIGHTS.push(s.weight));
const TOTAL_WEIGHT = WEIGHTS.reduce((a, b) => a + b, 0);
const specialOf = (type) => (type >= BASE_TYPES ? SPECIALS[type - BASE_TYPES] : null);

const MIN_MATCH  = 3;
const BASE_POINTS = 10;
const COMBO_STEP = 0.5;

// --- PRNG (Mulberry32) — идентичен webapp/js/game.js ---
function makeRng(seed) {
  let state = (seed >>> 0) || 1;
  return () => {
    state = (state + 0x6D2B79F5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function rndType(rand01) {
  let r = rand01() * TOTAL_WEIGHT;
  for (let i = 0; i < WEIGHTS.length; i++) { r -= WEIGHTS[i]; if (r < 0) return i; }
  return WEIGHTS.length - 1;
}

// --- Заполнение поля без стартовых матчей ---
function fillNoMatches(grid, rand01) {
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      let type; let tries = 0;
      do {
        type = rndType(rand01);
        tries++;
        if (tries > 20) break;
      } while (
        (c >= 2 && grid[r][c - 1] && grid[r][c - 1].type === type &&
                    grid[r][c - 2] && grid[r][c - 2].type === type) ||
        (r >= 2 && grid[r - 1][c] && grid[r - 1][c].type === type &&
                    grid[r - 2][c] && grid[r - 2][c].type === type)
      );
      grid[r][c] = { type, row: r, col: c, power: null };
    }
  }
}

// --- Матчи (h + v сериями) ---
function findMatches(grid) {
  const matched = new Set();
  const list = [];
  for (let r = 0; r < ROWS; r++) {
    let run = 1;
    for (let c = 1; c <= COLS; c++) {
      const same = c < COLS && grid[r][c] && grid[r][c - 1] &&
                   grid[r][c].type === grid[r][c - 1].type;
      if (same) run++;
      else {
        if (run >= MIN_MATCH) {
          const cells = [];
          for (let k = c - run; k < c; k++) { cells.push(grid[r][k]); matched.add(grid[r][k]); }
          list.push({ dir: 'h', len: run, cells, row: r });
        }
        run = 1;
      }
    }
  }
  for (let c = 0; c < COLS; c++) {
    let run = 1;
    for (let r = 1; r <= ROWS; r++) {
      const same = r < ROWS && grid[r][c] && grid[r - 1][c] &&
                   grid[r][c].type === grid[r - 1][c].type;
      if (same) run++;
      else {
        if (run >= MIN_MATCH) {
          const cells = [];
          for (let k = r - run; k < r; k++) { cells.push(grid[k][c]); matched.add(grid[k][c]); }
          list.push({ dir: 'v', len: run, cells, col: c });
        }
        run = 1;
      }
    }
  }
  matched.list = list;
  return matched;
}

// --- Power-ups: длинные и пересечения → keepers ---
function createPowerUps(list) {
  const keepers = new Set();
  const handled = new Set();
  const dirs = new Map();
  for (const m of list) {
    for (const cell of m.cells) {
      let d = dirs.get(cell);
      if (!d) { d = {}; dirs.set(cell, d); }
      d[m.dir] = m;
    }
  }
  for (const [cell, d] of dirs) {
    if (d.h && d.v) {
      let bombCell = specialOf(cell.type) ? null : cell;
      if (!bombCell) {
        const all = [...d.h.cells, ...d.v.cells];
        bombCell = all.find((g) => !specialOf(g.type));
      }
      if (bombCell && !keepers.has(bombCell)) {
        bombCell.power = 'bomb';
        bombCell.justCreated = true;
        keepers.add(bombCell);
      }
      handled.add(d.h); handled.add(d.v);
    }
  }
  for (const m of list) {
    if (handled.has(m)) continue;
    let target = m.cells[Math.floor(m.cells.length / 2)];
    if (specialOf(target.type)) {
      const reg = m.cells.find((g) => !specialOf(g.type));
      if (!reg) continue;
      target = reg;
    }
    if (keepers.has(target)) continue;
    if (m.len === 4) {
      target.power = m.dir === 'h' ? 'arrowH' : 'arrowV';
      target.justCreated = true;
      keepers.add(target);
    } else if (m.len >= 5) {
      target.power = 'bomb';
      target.justCreated = true;
      keepers.add(target);
    }
  }
  return keepers;
}

// Подцепить соседние power-ups к матчу
function attachAdjacentPowerUps(grid, matched) {
  const initial = Array.from(matched);
  for (const g of initial) {
    for (const [dr, dc] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
      const nr = g.row + dr, nc = g.col + dc;
      const n = grid[nr] && grid[nr][nc];
      if (n && n.power && !n.justCreated && !matched.has(n)) matched.add(n);
    }
  }
}

// Триггер power-ups: расширяет matched (row/col/3x3)
function triggerPowerUps(grid, matched) {
  let changed = true;
  while (changed) {
    changed = false;
    for (const g of Array.from(matched)) {
      if (!g.power || g._fired || g.justCreated) continue;
      g._fired = true;
      if (g.power === 'arrowH') {
        for (let c = 0; c < COLS; c++) {
          const n = grid[g.row][c];
          if (n && !matched.has(n)) { matched.add(n); changed = true; }
        }
      } else if (g.power === 'arrowV') {
        for (let r = 0; r < ROWS; r++) {
          const n = grid[r][g.col];
          if (n && !matched.has(n)) { matched.add(n); changed = true; }
        }
      } else if (g.power === 'bomb') {
        for (let dr = -1; dr <= 1; dr++)
          for (let dc = -1; dc <= 1; dc++) {
            const nr = g.row + dr, nc = g.col + dc;
            const n = grid[nr] && grid[nr][nc];
            if (n && !matched.has(n)) { matched.add(n); changed = true; }
          }
      }
    }
  }
  matched.forEach((g) => delete g._fired);
}

// Награды от спец-фишек в матче
function collectSpecials(matched, gain) {
  const counts = {};
  matched.forEach((g) => {
    const sp = specialOf(g.type);
    if (sp) counts[sp.id] = (counts[sp.id] || 0) + 1;
  });
  SPECIALS.forEach((sp) => {
    const n = counts[sp.id] || 0;
    if (!n) return;
    const r = sp.reward;
    if (r.coinsPerGem) gain.coins += r.coinsPerGem * n;
    else if (r.energyPer3) gain.energy += r.energyPer3 * Math.floor(n / 3);
    else if (r.mystery) {
      // Мистери: приблизим среднее — 10-20 монет / 1 энергия за срабатывание.
      // Клиент рандомит, поэтому серверу считаем разумную верхнюю границу.
      const times = Math.max(1, Math.floor(n / 3));
      gain.coins += 20 * times;   // upper-bound: если всегда падало +20
    }
  });
}

// Гравитация + добор
function applyGravity(grid, rand01) {
  for (let c = 0; c < COLS; c++) {
    let write = ROWS - 1;
    for (let r = ROWS - 1; r >= 0; r--) {
      const g = grid[r][c];
      if (g) {
        if (write !== r) {
          grid[write][c] = g;
          grid[r][c] = null;
          g.row = write;
        }
        write--;
      }
    }
    for (let r = write; r >= 0; r--) {
      grid[r][c] = { type: rndType(rand01), row: r, col: c, power: null };
    }
  }
}

// Каскад-разрешение матчей
function resolve(grid, firstMatches, gain) {
  let matches = firstMatches;
  let combo = 0;
  let maxCombo = 0;
  let matchesCount = 0;
  let score = 0;
  while (matches.size > 0) {
    combo++;
    if (combo > maxCombo) maxCombo = combo;
    const mult = 1 + (combo - 1) * COMBO_STEP;
    attachAdjacentPowerUps(grid, matches);
    triggerPowerUps(grid, matches);
    const keepers = (matches.list && matches.list.length) ? createPowerUps(matches.list) : new Set();
    collectSpecials(matches, gain);
    matches.forEach((g) => {
      if (keepers.has(g)) return;
      grid[g.row][g.col] = null;
    });
    const removed = matches.size - keepers.size;
    score += Math.round(removed * BASE_POINTS * mult);
    matchesCount += removed;
    applyGravity(grid, gain._rand);
    matches = findMatches(grid);
  }
  // Сброс justCreated
  for (let r = 0; r < ROWS; r++)
    for (let c = 0; c < COLS; c++)
      if (grid[r][c] && grid[r][c].justCreated) grid[r][c].justCreated = false;
  return { score, matchesCount, maxCombo };
}

// --- Основная точка входа: реплей всей партии ---
/**
 * @param seed     uint32 от /api/play
 * @param moveLog  [{r1,c1,r2,c2,t}, ...]
 * @returns { score, matches, coins, energy, maxCombo, invalidMoves }
 */
function replay(seed, moveLog) {
  const rand01 = makeRng(seed);
  const grid = Array.from({ length: ROWS }, () => Array(COLS).fill(null));
  fillNoMatches(grid, rand01);
  const gain = { coins: 0, energy: 0, _rand: rand01 };
  let totalScore = 0, totalMatches = 0, maxCombo = 0, invalid = 0;

  for (const m of moveLog) {
    // Свап должен быть соседним и в поле
    if (m.r1 < 0 || m.r1 >= ROWS || m.c1 < 0 || m.c1 >= COLS ||
        m.r2 < 0 || m.r2 >= ROWS || m.c2 < 0 || m.c2 >= COLS) { invalid++; continue; }
    const dr = Math.abs(m.r1 - m.r2), dc = Math.abs(m.c1 - m.c2);
    if (dr + dc !== 1) { invalid++; continue; }
    const a = grid[m.r1][m.c1], b = grid[m.r2][m.c2];
    if (!a || !b) { invalid++; continue; }
    // Свап
    grid[m.r1][m.c1] = b; grid[m.r2][m.c2] = a;
    a.row = m.r2; a.col = m.c2;
    b.row = m.r1; b.col = m.c1;
    const matches = findMatches(grid);
    if (matches.size === 0) {
      // Клиент откатывает такой ход — не должен быть в логе
      grid[m.r1][m.c1] = a; grid[m.r2][m.c2] = b;
      a.row = m.r1; a.col = m.c1;
      b.row = m.r2; b.col = m.c2;
      invalid++;
      continue;
    }
    const r = resolve(grid, matches, gain);
    totalScore += r.score;
    totalMatches += r.matchesCount;
    if (r.maxCombo > maxCombo) maxCombo = r.maxCombo;
  }

  return {
    score: totalScore,
    matches: totalMatches,
    coins: gain.coins,
    energy: gain.energy,
    maxCombo,
    invalidMoves: invalid,
  };
}

module.exports = { replay };
