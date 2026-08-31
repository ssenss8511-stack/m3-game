// Append-only JSONL лог важных событий: покупки, апы уровня, награды,
// подозрительные результаты. Помогает разбирать инциденты и восстанавливать
// пользователей после ошибок.
// Файл: server/audit.jsonl (одна строка = одно событие).
const fs = require('fs');
const path = require('path');

const FILE = process.env.AUDIT_PATH || path.join(__dirname, 'audit.jsonl');
let buffer = [];
let scheduled = false;

function flush() {
  if (buffer.length === 0) return;
  const lines = buffer.map((e) => JSON.stringify(e)).join('\n') + '\n';
  buffer = [];
  try { fs.appendFileSync(FILE, lines); }
  catch (e) { console.error('[audit] write failed:', e.message); }
}

// Батчинг записи — раз в секунду
setInterval(flush, 1000).unref();
for (const sig of ['SIGINT', 'SIGTERM', 'exit']) {
  process.on(sig, () => { flush(); if (sig !== 'exit') process.exit(0); });
}

/** Записать событие. type — короткая метка. Остальные поля произвольны. */
function log(type, data) {
  buffer.push({ ts: new Date().toISOString(), type, ...data });
  if (!scheduled) { scheduled = true; setImmediate(() => { scheduled = false; flush(); }); }
}

module.exports = { log };
