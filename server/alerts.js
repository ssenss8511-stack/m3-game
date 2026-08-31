// Автоалёрты админу в Telegram при подозрительной активности.
// Считаем события по типу за последние N минут; если превышает порог —
// шлём одно сообщение админу (с cooldown, чтобы не спамить).
const C = require('./config');

const counters = new Map(); // key = type → массив timestamps
const lastSent = new Map(); // key = type → timestamp последнего alert

const THRESHOLDS = {
  spec_farm_suspect: { count: 5, windowMs: 60 * 60000 },     // 5 за час
  score_capped:      { count: 10, windowMs: 24 * 60 * 60000 }, // 10 за день
  invalid_game_id:   { count: 3, windowMs: 10 * 60000 },     // 3 за 10 мин
  too_many_requests: { count: 20, windowMs: 5 * 60000 },     // 20 rate-limit за 5 мин
  replay_bad:        { count: 3,  windowMs: 60 * 60000 },    // 3 битых журнала за час
  ton_verify_error:  { count: 5,  windowMs: 60 * 60000 },    // проблемы с toncenter
  bot_suspect:       { count: 3,  windowMs: 12 * 60 * 60000 }, // 3 подозрения / 12ч
};
const COOLDOWN_MS = 60 * 60000; // не чаще раза в час на тип

let bot = null;
function setBot(b) { bot = b; }

/** Регистрирует событие. Если порог превышен и cooldown прошёл — шлёт админу. */
function report(type, meta) {
  const t = THRESHOLDS[type];
  if (!t) return;
  const now = Date.now();
  const arr = (counters.get(type) || []).filter((ts) => now - ts < t.windowMs);
  arr.push(now);
  counters.set(type, arr);
  if (arr.length < t.count) return;
  const last = lastSent.get(type) || 0;
  if (now - last < COOLDOWN_MS) return;
  lastSent.set(type, now);
  if (!bot || !C.adminChatId) return;
  const msg = `⚠️ Alert: ${type}\nСобытий: ${arr.length} за последние ${Math.round(t.windowMs / 60000)} мин\nПоследнее: ${JSON.stringify(meta || {}).slice(0, 300)}`;
  bot.sendMessage(C.adminChatId, msg).catch(() => {});
}

module.exports = { setBot, report };
