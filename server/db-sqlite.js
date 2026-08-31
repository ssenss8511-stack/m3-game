// SQLite-адаптер за тем же интерфейсом, что и db.js.
// Активируется через USE_SQLITE=1 в env. Требует better-sqlite3
// (в optionalDependencies — если не собралось, оставайся на JSON).
//
// Плюсы vs JSON:
//   - атомарные записи, WAL-журнал, устойчивость к SIGKILL
//   - индексы (leaderboard делается быстрым SQL, не in-memory sort)
//   - concurrent-safe на уровне процесса
//
// Схема:
//   users  (id TEXT PRIMARY KEY, data TEXT)   -- data = JSON-блоб (как было в JSON-хранилище)
//   meta   (k TEXT PRIMARY KEY, v TEXT)
//   scores (user_id TEXT PRIMARY KEY, best INTEGER)  -- денормализация для быстрого top-N
//
// Ключевое: users.data — тот же формат объекта, что раньше. Модули
// сервера продолжают дёргать u.coins/u.energy/... без изменений.

const path = require('path');

let Database;
try { Database = require('better-sqlite3'); }
catch (e) {
  throw new Error('better-sqlite3 not installed. Run: npm install better-sqlite3 --save-optional');
}

const FILE = process.env.SQLITE_PATH || path.join(__dirname, 'data.sqlite');
const db = new Database(FILE);

// Настройки для устойчивости и скорости
db.pragma('journal_mode = WAL');
db.pragma('synchronous = NORMAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id   TEXT PRIMARY KEY,
    data TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS meta (
    k TEXT PRIMARY KEY,
    v TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS scores (
    user_id TEXT PRIMARY KEY,
    best    INTEGER NOT NULL DEFAULT 0
  );
  CREATE INDEX IF NOT EXISTS scores_best ON scores(best DESC);
`);

const stmt = {
  getUser:  db.prepare('SELECT data FROM users WHERE id = ?'),
  saveUser: db.prepare('INSERT INTO users (id, data) VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data'),
  allUsers: db.prepare('SELECT data FROM users'),
  getMeta:  db.prepare('SELECT v FROM meta WHERE k = ?'),
  allMeta:  db.prepare('SELECT k, v FROM meta'),
  setMeta:  db.prepare('INSERT INTO meta (k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v'),
  delMeta:  db.prepare('DELETE FROM meta WHERE k = ?'),
  updateScore: db.prepare('INSERT INTO scores (user_id, best) VALUES (?, ?) ON CONFLICT(user_id) DO UPDATE SET best = excluded.best WHERE excluded.best > scores.best'),
  topScores:  db.prepare('SELECT user_id, best FROM scores WHERE best > 0 ORDER BY best DESC LIMIT ?'),
};

function getUser(id) {
  const row = stmt.getUser.get(id);
  return row ? JSON.parse(row.data) : null;
}

function saveUser(u) {
  stmt.saveUser.run(u.id, JSON.stringify(u));
  if (typeof u.best === 'number') stmt.updateScore.run(u.id, u.best | 0);
}

function allUsers() {
  return stmt.allUsers.all().map((r) => JSON.parse(r.data));
}

function markDirty() { /* no-op: SQLite пишет сразу */ }

// meta хранится плоско — но существующий код ждёт объект. Кэшируем один
// раз и синхронизируем при setMeta для совместимости.
let metaCache = null;
function loadMeta() {
  if (metaCache) return metaCache;
  metaCache = {};
  for (const r of stmt.allMeta.all()) {
    try { metaCache[r.k] = JSON.parse(r.v); } catch (_) { metaCache[r.k] = r.v; }
  }
  return metaCache;
}
function getMeta() { return loadMeta(); }
function setMeta(m) {
  // Синхронизируем весь объект: удаляем то, чего больше нет, пишем всё остальное
  const cur = loadMeta();
  const txn = db.transaction(() => {
    for (const k of Object.keys(cur)) {
      if (!(k in m)) stmt.delMeta.run(k);
    }
    for (const [k, v] of Object.entries(m)) {
      stmt.setMeta.run(k, JSON.stringify(v));
    }
  });
  txn();
  metaCache = { ...m };
}

// Быстрый leaderboard (используется server.js вместо in-memory sort)
function topN(n) {
  return stmt.topScores.all(n | 0);
}

// Аккуратное закрытие
for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => { try { db.close(); } catch (_) {} process.exit(0); });
}

// Онлайн-бэкап через SQLite backup API (консистентный снимок с WAL).
async function backup(dst) { await db.backup(dst); }

module.exports = { getUser, saveUser, allUsers, markDirty, getMeta, setMeta, topN, backup, _driver: 'sqlite' };
