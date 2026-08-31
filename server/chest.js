// Сундук удержания: после каждой N-й партии игрок получает право
// открыть сундук с случайной наградой.
//
// Состояние в u.chest = { played: int, claimed: int }
//   played  — общее число сыгранных партий (растёт на /api/end).
//   claimed — сколько сундуков уже открыто.
// Сундук доступен, когда (played - claimed * STEP) >= STEP.

const STEP = 5;

// Награды и веса. Сумма весов: 100.
const REWARDS = [
  { weight: 35, coins: 50  },
  { weight: 25, coins: 100 },
  { weight: 15, coins: 200 },
  { weight: 10, coins: 500 },
  { weight: 8,  energy: 1 },
  { weight: 5,  coins: 1000 },
  { weight: 2,  energy: 3 },
];

function ensure(u) {
  if (!u.chest) u.chest = { played: 0, claimed: 0 };
  return u.chest;
}

function bumpPlayed(u) {
  ensure(u);
  u.chest.played += 1;
}

function status(u) {
  ensure(u);
  const earned = Math.floor(u.chest.played / STEP);
  return {
    available: earned > u.chest.claimed,
    gamesToNext: STEP - (u.chest.played % STEP || STEP),
    played: u.chest.played,
    step: STEP,
  };
}

/** Открыть сундук. Возвращает { ok, reward } или { ok:false }. */
function open(u) {
  ensure(u);
  const s = status(u);
  if (!s.available) return { ok: false, reason: 'not_ready' };

  // взвешенный выбор награды
  const total = REWARDS.reduce((a, r) => a + r.weight, 0);
  let roll = Math.random() * total;
  let picked = REWARDS[REWARDS.length - 1];
  for (const r of REWARDS) {
    if (roll < r.weight) { picked = r; break; }
    roll -= r.weight;
  }
  u.chest.claimed += 1;
  return { ok: true, reward: { coins: picked.coins || 0, energy: picked.energy || 0 } };
}

module.exports = { bumpPlayed, status, open, STEP, REWARDS };
