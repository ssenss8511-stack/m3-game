// Роутер БД: SQLite (продакшн) или JSON-файл (dev/фолбэк).
// Активация SQLite: USE_SQLITE=1 (и `npm install better-sqlite3`).
//
// Интерфейс: getUser(id), saveUser(u), allUsers(), markDirty(),
//            getMeta(), setMeta(m). SQLite ещё умеет topN(n).

if (process.env.USE_SQLITE === '1' || process.env.USE_SQLITE === 'true') {
  try {
    module.exports = require('./db-sqlite');
    console.log('[db] driver: sqlite');
    return;
  } catch (e) {
    console.warn('[db] SQLite requested but failed to load:', e.message);
    console.warn('[db] Falling back to JSON file storage');
  }
}

// --- JSON-file реализация (по-умолчанию) ---
const fs = require('fs');
const path = require('path');

const FILE = process.env.DB_PATH || path.join(__dirname, 'data.json');

let data = { users: {} };
try {
  data = JSON.parse(fs.readFileSync(FILE, 'utf8'));
  if (!data.users) data.users = {};
} catch (_) { /* файла ещё нет — начнём с пустого */ }

let dirty = false;
function flush() {
  if (!dirty) return;
  dirty = false;
  try { fs.writeFileSync(FILE, JSON.stringify(data)); }
  catch (e) { console.error('DB write failed:', e.message); }
}
setInterval(flush, 1000).unref();
for (const sig of ['SIGINT', 'SIGTERM', 'exit']) {
  process.on(sig, () => { flush(); if (sig !== 'exit') process.exit(0); });
}

module.exports = {
  getUser:   (id) => data.users[id] || null,
  saveUser:  (u)  => { data.users[u.id] = u; dirty = true; },
  allUsers:  ()   => Object.values(data.users),
  markDirty: ()   => { dirty = true; },
  getMeta:   ()   => { if (!data.meta) data.meta = {}; return data.meta; },
  setMeta:   (m)  => { data.meta = m; dirty = true; },
  _driver:   'json',
};
console.log('[db] driver: json');
