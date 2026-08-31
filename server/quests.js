// Дневные цели. У игрока 3 квеста на сутки (UTC). Прогресс копится
// при каждом завершении партии (/api/end), награда выдаётся автоматически
// при достижении цели.
//
// Типы целей:
//   play_games   — сыграть N партий
//   score_in_game — набрать X очков за одну партию
//   coins_in_game — собрать N монет за одну партию
//   max_combo    — каскад длиной X в одной партии
//   matches_in_game — собрать N матчей за одну партию

const DAY_MS = 24 * 60 * 60 * 1000;
const dayIndex = () => Math.floor(Date.now() / DAY_MS);

const POOL = [
  { tid: 'play_3',    type: 'play_games',     target: 3,  reward: { coins: 30 },              title: 'Сыграй 3 партии' },
  { tid: 'play_5',    type: 'play_games',     target: 5,  reward: { coins: 60 },              title: 'Сыграй 5 партий' },
  { tid: 'play_10',   type: 'play_games',     target: 10, reward: { coins: 120, energy: 1 }, title: 'Сыграй 10 партий' },
  { tid: 'score_1k',  type: 'score_in_game',  target: 1000, reward: { coins: 40 },            title: 'Набери 1000 очков за партию' },
  { tid: 'score_3k',  type: 'score_in_game',  target: 3000, reward: { coins: 120 },           title: 'Набери 3000 очков за партию' },
  { tid: 'score_8k',  type: 'score_in_game',  target: 8000, reward: { coins: 300, energy: 1 },title: 'Набери 8000 очков за партию' },
  { tid: 'coins_30',  type: 'coins_in_game',  target: 30, reward: { coins: 50 },              title: 'Собери 30 монет за партию' },
  { tid: 'coins_60',  type: 'coins_in_game',  target: 60, reward: { coins: 120, energy: 1 }, title: 'Собери 60 монет за партию' },
  { tid: 'combo_3',   type: 'max_combo',      target: 3,  reward: { coins: 50 },              title: 'Сделай каскад x3' },
  { tid: 'combo_5',   type: 'max_combo',      target: 5,  reward: { coins: 150, energy: 1 }, title: 'Сделай каскад x5' },
  { tid: 'match_80',  type: 'matches_in_game', target: 80,  reward: { coins: 60 },            title: 'Собери 80 матчей за партию' },
  { tid: 'match_150', type: 'matches_in_game', target: 150, reward: { coins: 150 },           title: 'Собери 150 матчей за партию' },
];

// Детерминированный псевдо-рандом (LCG) — выбирает 3 цели по сегодняшнему
// дню + id игрока, чтобы у каждого свой набор, но стабильный за день.
function hash(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) h = ((h ^ s.charCodeAt(i)) * 16777619) >>> 0; return h; }
function pickThree(seed) {
  let rnd = hash(seed) || 1;
  const next = () => (rnd = (rnd * 1664525 + 1013904223) >>> 0);
  const pool = POOL.slice();
  const out = [];
  while (out.length < 3 && pool.length) {
    const idx = next() % pool.length;
    out.push(pool.splice(idx, 1)[0]);
  }
  return out;
}

function ensure(u) {
  const t = dayIndex();
  if (!u.quests || u.quests.day !== t) {
    const picks = pickThree(t + ':' + u.id);
    u.quests = {
      day: t,
      list: picks.map((p) => ({
        tid: p.tid, type: p.type, title: p.title, target: p.target,
        reward: p.reward, progress: 0, claimed: false,
      })),
    };
  }
  return u.quests;
}

/**
 * Обновить прогресс по итогу одной партии и выдать награды за выполненные.
 * `gameStats` = { score, matches, maxCombo, coinsGained }.
 * Возвращает список целей, ставших claimed за этот вызов.
 */
function progress(u, gameStats) {
  ensure(u);
  const claimed = [];
  for (const q of u.quests.list) {
    if (q.claimed) continue;
    let val = 0;
    if (q.type === 'play_games')      val = (q.progress || 0) + 1;
    else if (q.type === 'score_in_game')  val = Math.max(q.progress || 0, gameStats.score || 0);
    else if (q.type === 'coins_in_game')  val = Math.max(q.progress || 0, gameStats.coinsGained || 0);
    else if (q.type === 'max_combo')      val = Math.max(q.progress || 0, gameStats.maxCombo || 0);
    else if (q.type === 'matches_in_game') val = Math.max(q.progress || 0, gameStats.matches || 0);
    q.progress = val;
    if (val >= q.target) { q.claimed = true; claimed.push(q); }
  }
  return claimed;
}

module.exports = { ensure, progress, dayIndex, POOL };
