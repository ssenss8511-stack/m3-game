// Еженедельный турнир. Каждый понедельник UTC лидерборд обнуляется,
// прошлые ТОП-3 получают призы:
//   1 место — 1000 монет
//   2 место — 500 монет
//   3 место — 250 монет
//
// Запись недельного рекорда: u.weekBest, u.weekBestWeek.
// Уведомление о призе: u.pendingTournament (одноразово, выдаётся через
// stateOf и сразу удаляется после прочтения клиентом).
//
// Сеттлмент (выдача призов) триггерится при любом обращении к API
// после смены недели. Защита от двойного начисления — db.meta.settledWeek.

let Audit;
try { Audit = require('./audit'); } catch (_) { Audit = { log: () => {} }; }

const DAY = 86400000, WEEK = 7 * DAY;
function weekIndex() { return Math.floor((Date.now() - 4 * DAY) / WEEK); }
function weekEndsAt() { return (weekIndex() + 1) * WEEK + 4 * DAY; }

const PRIZES = [
  { rank: 1, coins: 1000 },
  { rank: 2, coins: 500 },
  { rank: 3, coins: 250 },
];

function ensure(u) {
  const w = weekIndex();
  if (u.weekBestWeek !== w) {
    u.weekBest = 0;
    u.weekBestWeek = w;
  }
}

/** Записать счёт партии в недельный рекорд. */
function recordScore(u, score) {
  ensure(u);
  if (score > (u.weekBest || 0)) u.weekBest = score;
}

/** Список ТОП-N за ТЕКУЩУЮ неделю. */
function topThisWeek(allUsers, limit) {
  const w = weekIndex();
  const elig = allUsers
    .filter((u) => u.weekBestWeek === w && (u.weekBest || 0) > 0)
    .sort((a, b) => (b.weekBest || 0) - (a.weekBest || 0));
  return elig.slice(0, limit).map((u, i) => ({
    rank: i + 1,
    name: u.tg_name || ('игрок ' + String(u.id).slice(-4)),
    best: u.weekBest || 0,
    userId: u.id,
  }));
}

/** Найти ранг текущего игрока за эту неделю (1, 2, ...) или null. */
function myRank(allUsers, userId) {
  const w = weekIndex();
  const elig = allUsers
    .filter((u) => u.weekBestWeek === w && (u.weekBest || 0) > 0)
    .sort((a, b) => (b.weekBest || 0) - (a.weekBest || 0));
  const idx = elig.findIndex((u) => u.id === userId);
  return idx >= 0 ? idx + 1 : null;
}

/**
 * Выдать призы за прошлую неделю, если ещё не выданы.
 * Идемпотентно: повторный вызов в той же неделе ничего не делает.
 */
function settle(db) {
  const cur = weekIndex();
  const meta = db.getMeta();
  const lastSettled = meta.settledWeek || 0;
  if (lastSettled >= cur - 1) return;             // уже выдано
  if (cur === 0) { meta.settledWeek = -1; db.setMeta(meta); return; }

  const prev = cur - 1;
  const players = db.allUsers()
    .filter((u) => u.weekBestWeek === prev && (u.weekBest || 0) > 0)
    .sort((a, b) => (b.weekBest || 0) - (a.weekBest || 0));

  for (let i = 0; i < Math.min(PRIZES.length, players.length); i++) {
    const u = players[i];
    const p = PRIZES[i];
    u.coins = (u.coins || 0) + p.coins;
    u.pendingTournament = { rank: p.rank, coins: p.coins, score: u.weekBest, week: prev };
    Audit.log('tournament_prize', { userId: u.id, rank: p.rank, coins: p.coins, week: prev, score: u.weekBest });
    db.saveUser(u);
  }
  meta.settledWeek = prev;
  db.setMeta(meta);
}

module.exports = { weekIndex, weekEndsAt, recordScore, topThisWeek, myRank, settle, PRIZES, ensure };
