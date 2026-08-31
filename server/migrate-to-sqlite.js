#!/usr/bin/env node
// Однократная миграция data.json → data.sqlite.
// Использование:  node migrate-to-sqlite.js  [путь-к-json]  [путь-к-sqlite]
//
// После миграции:
//   1) Останови процесс
//   2) Выстави USE_SQLITE=1 в env
//   3) npm start
//   4) Проверь: /api/state работает, лидерборд отдаёт данные
//   5) Сохрани data.json как бэкап и удали

const fs = require('fs');
const path = require('path');

const JSON_PATH   = process.argv[2] || path.join(__dirname, 'data.json');
const SQLITE_PATH = process.argv[3] || path.join(__dirname, 'data.sqlite');

if (!fs.existsSync(JSON_PATH)) {
  console.error('Source not found:', JSON_PATH);
  process.exit(1);
}
if (fs.existsSync(SQLITE_PATH)) {
  console.error('Target exists (переименуй или удали):', SQLITE_PATH);
  process.exit(1);
}

process.env.SQLITE_PATH = SQLITE_PATH;
const sqlite = require('./db-sqlite');

const data = JSON.parse(fs.readFileSync(JSON_PATH, 'utf8'));
const users = data.users || {};
const meta  = data.meta  || {};

let n = 0;
for (const u of Object.values(users)) {
  sqlite.saveUser(u);
  n++;
}
sqlite.setMeta(meta);

console.log(`Migrated: users=${n}, meta keys=${Object.keys(meta).length}`);
console.log(`SQLite: ${SQLITE_PATH}`);
console.log('Теперь: USE_SQLITE=1 npm start');
