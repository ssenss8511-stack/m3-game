/*
 * Движок match-3.
 * Каждая фишка — объект { id, type, row, col, el }. Сетка grid[row][col]
 * хранит ссылку на фишку (или null). Позиция элемента задаётся transform'ом,
 * поэтому свапы, падение и каскады анимируются CSS-переходами.
 */
const Game = (() => {
  const C = window.CONFIG;
  const COLS = C.board.cols;
  const ROWS = C.board.rows;
  const BASE_TYPES = C.board.types;               // обычные фигуры (0..BASE-1)
  const SPECIALS = (C.specials && C.specials.items) || []; // спец-типы (BASE..)
  // Веса выпадения: обычные фигуры + спец-иконки.
  const WEIGHTS = (() => {
    const w = [];
    for (let i = 0; i < BASE_TYPES; i++) w.push((C.specials && C.specials.weightBase) || 1);
    SPECIALS.forEach((s) => w.push(s.weight));
    return w;
  })();
  const TOTAL_WEIGHT = WEIGHTS.reduce((a, b) => a + b, 0);
  const specialOf = (type) => (type >= BASE_TYPES ? SPECIALS[type - BASE_TYPES] : null);

  let boardEl, grid, gems, cell, gid;
  let score, moves, busy, selected;
  let onUpdate, onEnd, onCollect, onShuffle, onMatch;
  let hintTimer = null, hintGems = null;
  let matchesCount = 0, bestCombo = 0;       // статистика игры (для ачивок)
  let bombMode = false;

  const delay = (ms) => new Promise((r) => setTimeout(r, ms));

  // Детерминированный PRNG (Mulberry32) — seed от сервера. Позволяет серверу
  // при желании воспроизвести партию и проверить счёт.
  let _rngState = 0;
  function seedRng(seed) { _rngState = (seed >>> 0) || 1; }
  function rand01() {
    _rngState = (_rngState + 0x6D2B79F5) >>> 0;
    let t = _rngState;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  // Инициализируем случайно на случай, если start() не успел выдать seed
  seedRng(Math.floor(Math.random() * 0xffffffff));

  function rndType() {
    let r = rand01() * TOTAL_WEIGHT;
    for (let i = 0; i < WEIGHTS.length; i++) { r -= WEIGHTS[i]; if (r < 0) return i; }
    return WEIGHTS.length - 1;
  }

  // Журнал ходов для отправки на сервер (server-side replay)
  let moveLog = [];
  let gameStartTs = 0;
  function logMove(r1, c1, r2, c2) {
    moveLog.push({ r1, c1, r2, c2, t: Date.now() - gameStartTs });
  }
  function getMoveLog() { return moveLog; }

  // Ретригер CSS-анимации: снять класс, форсировать reflow, поставить обратно.
  // Убираем класс через ms — так же на случай интеррапта анимации.
  function triggerAnim(el, cls, ms) {
    if (!el) return;
    el.classList.remove(cls);
    void el.offsetWidth; // force reflow
    el.classList.add(cls);
    setTimeout(() => { if (el) el.classList.remove(cls); }, ms || 300);
  }

  function init(boardElement, callbacks) {
    boardEl = boardElement;
    onUpdate = callbacks.onUpdate || (() => {});
    onEnd = callbacks.onEnd || (() => {});
    onCollect = callbacks.onCollect || (() => {});
    onShuffle = callbacks.onShuffle || (() => {});
    onMatch = callbacks.onMatch || (() => {});
    bindInput();
    // Поле само переразложится, когда получит/изменит размер (старт до
    // готовности разметки, разворот экрана, расширение Telegram-вьюпорта).
    if (window.ResizeObserver) new ResizeObserver(() => resize()).observe(boardEl);
  }

  function computeCell() {
    // Размер ячейки = ширина поля / число колонок.
    // Если разметка ещё не готова (ширина 0), берём прежнее значение или
    // запасное — чтобы поле не схлопнулось. Реальный размер подхватит
    // ResizeObserver, как только поле получит ширину.
    const w = boardEl.clientWidth;
    cell = w ? Math.floor(w / COLS) : (cell || 40);
    boardEl.style.height = cell * ROWS + 'px';
    boardEl.style.setProperty('--cell', cell + 'px');
  }

  /** Запуск новой игры (энергия уже списана снаружи). */
  function start(opts) {
    boardEl.innerHTML = '';
    grid = Array.from({ length: ROWS }, () => Array(COLS).fill(null));
    gems = [];
    gid = 0;
    score = 0;
    moves = C.game.movesPerGame;
    busy = false;
    selected = null;
    matchesCount = 0;
    bestCombo = 0;
    bombMode = false;
    boardEl.classList.remove('bomb-mode');
    // Seed от сервера → детерминированное поле для будущего реплея
    if (opts && typeof opts.seed === 'number') seedRng(opts.seed);
    moveLog = [];
    gameStartTs = Date.now();
    computeCell();
    fillNoMatches();
    emit();
    scheduleHint();
  }

  function emit() { onUpdate({ score, moves }); }

  // ---- Создание / позиционирование фишек ----
  function makeGem(type, row, col) {
    const el = document.createElement('div');
    el.className = 'gem t' + type;
    el.dataset.id = ++gid;
    const sp = specialOf(type);
    if (sp) {                       // спец-тип: своя иконка вместо фигуры
      el.classList.add('special', sp.id);
      const ic = document.createElement('span');
      ic.className = 'icon';
      ic.innerHTML = iconSvg(sp.id);
      el.appendChild(ic);
    }
    const gem = { id: gid, type, row, col, el };
    el.addEventListener('pointerdown', (e) => onPointerDown(e, gem));
    boardEl.appendChild(el);
    grid[row][col] = gem;
    gems.push(gem);
    place(gem);
    return gem;
  }

  /** SVG-иконки спец-фишек (рисуются одинаково на всех устройствах). */
  function iconSvg(id) {
    if (id === 'coin')
      return '<svg viewBox="0 0 40 40">'
        + '<circle cx="20" cy="20" r="16.5" fill="#ffcf4d" stroke="#d98300" stroke-width="2.5"/>'
        + '<circle cx="20" cy="20" r="11.5" fill="none" stroke="#ffe79a" stroke-width="1.6"/>'
        + '<text x="20" y="26.5" text-anchor="middle" font-family="Arial,Helvetica,sans-serif" font-size="18" font-weight="800" fill="#b86b00">$</text>'
        + '</svg>';
    if (id === 'energy')
      return '<svg viewBox="0 0 40 40">'
        + '<path d="M23 3 L9 22 H17 L14 37 L31 17 H22 L26 3 Z" fill="#ffd633" stroke="#e08a00" stroke-width="2.2" stroke-linejoin="round"/>'
        + '</svg>';
    if (id === 'gift')
      return '<svg viewBox="0 0 40 40">'
        + '<rect x="7" y="16" width="26" height="19" rx="2.5" fill="#ff6fb5" stroke="#d6336c" stroke-width="1.5"/>'
        + '<rect x="5" y="11" width="30" height="7.5" rx="2" fill="#ff8ec8" stroke="#d6336c" stroke-width="1.5"/>'
        + '<rect x="17" y="11" width="6" height="24" fill="#ffd0e8"/>'
        + '<circle cx="14.5" cy="9" r="4.2" fill="#ff8ec8" stroke="#d6336c" stroke-width="1.5"/>'
        + '<circle cx="25.5" cy="9" r="4.2" fill="#ff8ec8" stroke="#d6336c" stroke-width="1.5"/>'
        + '</svg>';
    return '';
  }

  function place(gem, fromRow) {
    const r = fromRow == null ? gem.row : fromRow;
    gem.el.style.transform = `translate(${gem.col * cell}px, ${r * cell}px)`;
  }

  // Цвета для частиц (соответствуют ярким градиентам в CSS)
  const PARTICLE_COLOR = ['#ff3b3b','#2b8bff','#2fd45e','#ffc61a','#c54dff','#ffc94d','#ff6fb5','#4dabf7'];

  /** Маленький взрыв искр в центре фишки. */
  function spawnParticles(gem) {
    const color = PARTICLE_COLOR[gem.type] || '#fff';
    const cx = gem.col * cell + cell / 2 - 3.5;
    const cy = gem.row * cell + cell / 2 - 3.5;
    const N = 6;
    for (let i = 0; i < N; i++) {
      const p = document.createElement('div');
      p.className = 'particle';
      p.style.color = color;          // для box-shadow currentColor
      p.style.background = color;
      const angle = (Math.PI * 2 * i) / N + Math.random() * 0.6;
      const dist = 22 + Math.random() * 18;
      p.style.setProperty('--x0', cx + 'px');
      p.style.setProperty('--y0', cy + 'px');
      p.style.setProperty('--dx', Math.cos(angle) * dist + 'px');
      p.style.setProperty('--dy', Math.sin(angle) * dist + 'px');
      boardEl.appendChild(p);
      setTimeout(() => p.remove(), 600);
    }
  }

  function removeGem(gem) {
    const i = gems.indexOf(gem);
    if (i >= 0) gems.splice(i, 1);
    spawnParticles(gem);
    gem.el.classList.add('clear');
    const el = gem.el;
    setTimeout(() => el.remove(), 220);
  }

  /** Заполнить поле так, чтобы не было готовых совпадений. */
  function fillNoMatches() {
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        let type;
        do { type = rndType(); }
        while (
          (c >= 2 && grid[r][c - 1].type === type && grid[r][c - 2].type === type) ||
          (r >= 2 && grid[r - 1][c].type === type && grid[r - 2][c].type === type)
        );
        makeGem(type, r, c);
      }
    }
  }

  // ---- Ввод ----
  function bindInput() {
    boardEl.addEventListener('pointerup', () => { dragFrom = null; });
    boardEl.addEventListener('pointerleave', () => { dragFrom = null; });
  }

  let dragFrom = null;
  function onPointerDown(e, gem) {
    if (busy || moves <= 0) return;
    if (bombMode) { detonateBomb(gem); return; }
    clearHint();                 // игрок активен — снимаем подсказку
    dragFrom = { gem, x: e.clientX, y: e.clientY };
    // Поддержка двух способов: тап-тап и свайп.
    selectTile(gem);
    boardEl.onpointermove = onPointerMove;
    scheduleHint();              // перезапускаем отсчёт бездействия
  }

  async function detonateBomb(centerGem) {
    if (busy) return;
    busy = true;
    bombMode = false;
    boardEl.classList.remove('bomb-mode');
    const blast = new Set();
    for (let dr = -1; dr <= 1; dr++)
      for (let dc = -1; dc <= 1; dc++) {
        const r = centerGem.row + dr, c = centerGem.col + dc;
        const g = grid[r] && grid[r][c];
        if (g) blast.add(g);
      }
    await resolve(blast);          // используем общий пайплайн (награды, гравитация, каскады)
    busy = false;
    scheduleHint();
  }

  function onPointerMove(e) {
    if (!dragFrom) return;
    const dx = e.clientX - dragFrom.x;
    const dy = e.clientY - dragFrom.y;
    if (Math.hypot(dx, dy) < cell * 0.4) return; // порог свайпа
    let tr = dragFrom.gem.row, tc = dragFrom.gem.col;
    if (Math.abs(dx) > Math.abs(dy)) tc += dx > 0 ? 1 : -1;
    else tr += dy > 0 ? 1 : -1;
    const target = grid[tr] && grid[tr][tc];
    boardEl.onpointermove = null;
    const from = dragFrom.gem;
    dragFrom = null;
    if (target) trySwap(from, target);
  }

  function selectTile(gem) {
    if (selected && selected !== gem && areAdjacent(selected, gem)) {
      const a = selected;
      clearSelection();
      trySwap(a, gem);
      return;
    }
    clearSelection();
    selected = gem;
    gem.el.classList.add('selected');
  }

  function clearSelection() {
    if (selected) selected.el.classList.remove('selected');
    selected = null;
  }

  function areAdjacent(a, b) {
    return Math.abs(a.row - b.row) + Math.abs(a.col - b.col) === 1;
  }

  // ---- Свап и разрешение поля ----
  function swapData(a, b) {
    grid[a.row][a.col] = b;
    grid[b.row][b.col] = a;
    const ar = a.row, ac = a.col;
    a.row = b.row; a.col = b.col;
    b.row = ar; b.col = ac;
    place(a); place(b);
  }

  async function trySwap(a, b) {
    if (busy || moves <= 0 || !areAdjacent(a, b)) return;
    busy = true;
    clearSelection();
    clearHint();

    // Power-up (стрелка/бомба) свапаются как обычные фишки:
    // без мгновенной активации. Срабатывают только если оказались
    // в матче по цвету — как обычная фишка + бонусный взрыв.
    swapData(a, b);
    await delay(180);

    const matches = findMatches();
    if (matches.size === 0) {
      // Неудачный ход — возвращаем обратно.
      swapData(a, b);
      await delay(180);
      busy = false;
      scheduleHint();
      return;
    }

    moves--;
    logMove(a.row, a.col, b.row, b.col);
    triggerAnim(a.el, 'swap-success', 320);
    triggerAnim(b.el, 'swap-success', 320);
    emit();
    await resolve(matches);
    busy = false;

    if (moves <= 0) {
      clearHint();
      await delay(300);
      onEnd({ score, matches: matchesCount, maxCombo: bestCombo });
    } else {
      scheduleHint();
    }
  }

  /**
   * Найти все фишки, входящие в совпадения 3+.
   * Возвращает { matched: Set<gem>, list: Array<{dir,len,cells}> } —
   * для применения «суперэффектов» при 4 и 5+ в ряд.
   */
  function findMatches() {
    const matched = new Set();
    const list = [];
    // Горизонтали
    for (let r = 0; r < ROWS; r++) {
      let run = 1;
      for (let c = 1; c <= COLS; c++) {
        const same = c < COLS && grid[r][c] && grid[r][c - 1] &&
                     grid[r][c].type === grid[r][c - 1].type;
        if (same) { run++; }
        else {
          if (run >= C.game.minMatch) {
            const cells = [];
            for (let k = c - run; k < c; k++) { cells.push(grid[r][k]); matched.add(grid[r][k]); }
            list.push({ dir: 'h', len: run, cells, row: r });
          }
          run = 1;
        }
      }
    }
    // Вертикали
    for (let c = 0; c < COLS; c++) {
      let run = 1;
      for (let r = 1; r <= ROWS; r++) {
        const same = r < ROWS && grid[r][c] && grid[r - 1][c] &&
                     grid[r][c].type === grid[r - 1][c].type;
        if (same) { run++; }
        else {
          if (run >= C.game.minMatch) {
            const cells = [];
            for (let k = r - run; k < r; k++) { cells.push(grid[k][c]); matched.add(grid[k][c]); }
            list.push({ dir: 'v', len: run, cells, col: c });
          }
          run = 1;
        }
      }
    }
    // .size — для обратной совместимости (hasMoveAt и т.п.)
    matched.list = list;
    return matched;
  }

  /**
   * Из длинных матчей создаём «прокачанные» фишки и помечаем их как keepers
   * (не удаляются при текущем матче, остаются на поле):
   *   4 в ряд      → полосатая фишка (по направлению матча)
   *   5+ в ряд     → радужная фишка (без цвета, по свапу убирает всё одного цвета)
   * Возвращает Set фишек-keepers.
   */
  function createPowerUps(list) {
    const keepers = new Set();
    const handled = new Set(); // матчи, обработанные пересечением

    // 1) Пересечения T/L/крест: клетка в обоих матчах (h и v) → бомба
    const dirs = new Map(); // gem → { h: match, v: match }
    for (const m of list) {
      for (const c of m.cells) {
        let d = dirs.get(c);
        if (!d) { d = {}; dirs.set(c, d); }
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
          bombCell.justCreated = true;  // не срабатывать в этом же каскаде
          bombCell.el.classList.add('power-bomb');
          keepers.add(bombCell);
        }
        handled.add(d.h);
        handled.add(d.v);
      }
    }

    // 2) Обычные прямые матчи: 4 → стрелка, 5+ → бомба
    for (const m of list) {
      if (handled.has(m)) continue; // уже покрыто пересечением
      let target = m.cells[Math.floor(m.cells.length / 2)];
      if (specialOf(target.type)) {
        const regular = m.cells.find((g) => !specialOf(g.type));
        if (!regular) continue;
        target = regular;
      }
      if (keepers.has(target)) continue; // не перезаписываем существующий power-up
      if (m.len === 4) {
        target.power = m.dir === 'h' ? 'arrowH' : 'arrowV';
        target.justCreated = true;
        target.el.classList.add(target.power === 'arrowH' ? 'power-arrowH' : 'power-arrowV');
        keepers.add(target);
      } else if (m.len >= 5) {
        target.power = 'bomb';
        target.justCreated = true;
        target.el.classList.add('power-bomb');
        keepers.add(target);
      }
    }
    return keepers;
  }

  /**
   * Активировать только те power-up фишки, что находятся В СОСЕДНЕЙ клетке
   * с любой фишкой матча. Дальние на поле не срабатывают — иначе один матч
   * активирует всё сразу.
   */
  function attachAdjacentPowerUps(matched) {
    const initial = Array.from(matched);
    for (const g of initial) {
      for (const [dr, dc] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
        const nr = g.row + dr, nc = g.col + dc;
        const n = grid[nr] && grid[nr][nc];
        // Только что созданные (в этом же каскаде) не подхватываем —
        // иначе стрелка исчезнет через 0.5 с после появления.
        if (n && n.power && !n.justCreated && !matched.has(n)) matched.add(n);
      }
    }
  }

  /**
   * Триггер power-up фишек в наборе на удаление: расширяет matched
   * соответствующим взрывом (ряд / колонка / весь цвет).
   * Цепочки: prepower-up в зоне другого power-up тоже срабатывает.
   */
  function triggerPowerUps(matched) {
    let changed = true;
    while (changed) {
      changed = false;
      Array.from(matched).forEach((g) => {
        if (!g.power || g._fired) return;
        if (g.justCreated) return;   // только что созданные не срабатывают в этом же каскаде
        g._fired = true;
        if (g.power === 'arrowH') {
          for (let c = 0; c < COLS; c++) { const n = grid[g.row][c]; if (n && !matched.has(n)) { matched.add(n); changed = true; } }
        } else if (g.power === 'arrowV') {
          for (let r = 0; r < ROWS; r++) { const n = grid[r][g.col]; if (n && !matched.has(n)) { matched.add(n); changed = true; } }
        } else if (g.power === 'bomb') {
          // 3×3 взрыв вокруг бомбы (включая саму бомбу и соседние 8 клеток)
          for (let dr = -1; dr <= 1; dr++)
            for (let dc = -1; dc <= 1; dc++) {
              const nr = g.row + dr, nc = g.col + dc;
              const n = grid[nr] && grid[nr][nc];
              if (n && !matched.has(n)) { matched.add(n); changed = true; }
            }
        }
      });
    }
    matched.forEach((g) => delete g._fired);
  }

  /** Цикл: убрать совпадения -> гравитация -> добор -> каскад. */
  async function resolve(firstMatches) {
    let matches = firstMatches;
    let combo = 0;
    while (matches.size > 0) {
      combo++;
      const mult = 1 + (combo - 1) * C.game.comboStep;
      // Активировать power-up фишки СОСЕДНИЕ с матчем (от любой фигуры)
      // или попавшие в матч по цвету. Далеко на поле не срабатывают.
      attachAdjacentPowerUps(matches);
      triggerPowerUps(matches);
      // Только теперь — создать НОВЫЕ power-up из длинных матчей (не удаляются).
      const keepers = (matches.list && matches.list.length) ? createPowerUps(matches.list) : new Set();
      collectSpecials(matches);  // награды + взрыв бомб
      // keepers могли попасть в triggerPowerUps от соседней фишки — но мы
      // всё равно сохраняем их (они стали мощнее, не дадим разрушить).
      matches.forEach((g) => { if (keepers.has(g)) return; grid[g.row][g.col] = null; removeGem(g); });

      score += Math.round((matches.size - keepers.size) * C.game.basePointsPerGem * mult);
      matchesCount += matches.size - keepers.size;
      if (combo > bestCombo) bestCombo = combo;
      onMatch(combo, matches);
      emit();
      if (combo > 1) showCombo(combo);

      await delay(200);
      applyGravity();
      await delay(260);

      matches = findMatches();
    }
    // Каскад закончился — power-up, созданные в этом ходе, теперь готовы
    // срабатывать со следующего хода игрока.
    gems.forEach((g) => { if (g.justCreated) g.justCreated = false; });
  }

  /** Посчитать спец-иконки в совпадении и выдать награды (за 3+ в ряд). */
  function collectSpecials(matches) {
    const counts = {};
    matches.forEach((g) => {
      const sp = specialOf(g.type);
      if (sp) counts[sp.id] = (counts[sp.id] || 0) + 1;
    });
    SPECIALS.forEach((sp) => {
      if (counts[sp.id]) onCollect(sp, counts[sp.id]);
    });
  }

  /** Сдвинуть фишки вниз и добрать новые сверху. */
  function applyGravity() {
    for (let c = 0; c < COLS; c++) {
      let write = ROWS - 1;
      for (let r = ROWS - 1; r >= 0; r--) {
        const g = grid[r][c];
        if (g) {
          if (write !== r) {
            grid[write][c] = g;
            grid[r][c] = null;
            g.row = write;
            place(g);
            // squash-приземление после падения
            triggerAnim(g.el, 'landed', 240);
          }
          write--;
        }
      }
      // Добор новых фишек над полем (падают сверху).
      for (let r = write; r >= 0; r--) {
        const g = makeGem(rndType(), r, c);
        place(g, r - (write + 1)); // стартуют выше поля
        // запуск анимации падения в свою строку
        requestAnimationFrame(() => {
          place(g);
          triggerAnim(g.el, 'spawn', 320);
        });
      }
    }
  }

  function showCombo(combo) {
    const tag = document.createElement('div');
    tag.className = 'combo-pop';
    tag.textContent = 'x' + (1 + (combo - 1) * C.game.comboStep).toFixed(1).replace('.0', '');
    boardEl.appendChild(tag);
    setTimeout(() => tag.remove(), 700);
  }

  // ---- Подсказки и перемешивание ----

  /** Есть ли совпадение, если поменять местами (r,c) и (r2,c2). Без анимации. */
  function hasMoveAt(r, c, r2, c2) {
    const a = grid[r][c], b = grid[r2][c2];
    grid[r][c] = b; grid[r2][c2] = a;     // временно меняем только ссылки
    const ok = findMatches().size > 0;
    grid[r][c] = a; grid[r2][c2] = b;     // возвращаем
    return ok;
  }

  /** Найти любой возможный ход. Возвращает [gemA, gemB] или null. */
  function findHint() {
    for (let r = 0; r < ROWS; r++)
      for (let c = 0; c < COLS; c++) {
        if (c < COLS - 1 && hasMoveAt(r, c, r, c + 1)) return [grid[r][c], grid[r][c + 1]];
        if (r < ROWS - 1 && hasMoveAt(r, c, r + 1, c)) return [grid[r][c], grid[r + 1][c]];
      }
    return null;
  }

  function scheduleHint() {
    clearTimeout(hintTimer);
    if (moves <= 0) return;
    hintTimer = setTimeout(showHint, C.game.hintDelayMs || 5000);
  }

  function clearHint() {
    clearTimeout(hintTimer);
    if (hintGems) {
      hintGems.forEach((g) => g.el.classList.remove('hinted'));
      hintGems = null;
    }
  }

  function showHint() {
    if (busy || moves <= 0) return;
    const h = findHint();
    if (!h) { reshuffle(); return; }   // ходов нет — перемешиваем поле
    hintGems = h;
    h.forEach((g) => g.el.classList.add('hinted'));
  }

  /** Сменить тип существующей фишки (для перемешивания), сохранив элемент. */
  function retype(gem, type) {
    gem.type = type;
    gem.el.className = 'gem t' + type;
    const old = gem.el.querySelector('.icon');
    if (old) old.remove();
    const sp = specialOf(type);
    if (sp) {
      gem.el.classList.add('special', sp.id);
      const ic = document.createElement('span');
      ic.className = 'icon';
      ic.innerHTML = iconSvg(sp.id);
      gem.el.appendChild(ic);
    }
  }

  /** Перетасовать поле, пока не появится ход и не будет готовых совпадений. */
  function reshuffle() {
    let attempt = 0;
    do {
      for (let r = 0; r < ROWS; r++)
        for (let c = 0; c < COLS; c++) retype(grid[r][c], rndType());
      attempt++;
    } while ((findMatches().size > 0 || !findHint()) && attempt < 60);
    onShuffle();
    scheduleHint();
  }

  function resize() { if (gems) { computeCell(); gems.forEach((g) => place(g)); } }

  // Бустеры — публичные методы для main.js
  function addMoves(n) { moves += n; emit(); }
  function shuffleBoard() { reshuffle(); }
  function armBomb() { bombMode = true; boardEl.classList.add('bomb-mode'); }

  return {
    init, start, resize, getScore: () => score,
    addMoves, shuffleBoard, armBomb,
    showHint,
    getMoveLog,
    isActive: () => !!gems && moves > 0,
  };
})();

window.Game = Game;
