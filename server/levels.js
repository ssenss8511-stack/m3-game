// Система уровней. XP за партию = score / 10.
// Пороги растут линейно: чтобы перейти на уровень N, нужно
//   base + step * (N-1) очков сверх предыдущего уровня.
// Награда за ап: coins = 30 + 15 * level. Каждый 5-й уровень + 1 ⚡.

const BASE = 100;
const STEP = 50;

/** Сколько суммарно XP нужно для перехода НА уровень L (с 1). */
function totalXpFor(level) {
  // сумма deltas от 1 до level-1
  // delta(k) = BASE + STEP*(k-1)
  // сумма k=1..N = N*BASE + STEP*N*(N-1)/2
  const N = level - 1;
  return N * BASE + STEP * N * (N - 1) / 2;
}

/** Уровень по общему XP. */
function levelFromXp(xp) {
  // Решаем неравенство totalXpFor(L) <= xp < totalXpFor(L+1)
  let L = 1;
  while (totalXpFor(L + 1) <= xp) L++;
  return L;
}

/** Прогресс внутри текущего уровня. */
function progress(u) {
  const xp = u.xp || 0;
  const L = levelFromXp(xp);
  const cur = totalXpFor(L);
  const nxt = totalXpFor(L + 1);
  return { level: L, xp, currentLevelXp: xp - cur, levelSpan: nxt - cur };
}

/** Награда за ап на новый уровень. */
function rewardFor(level) {
  return {
    coins: 30 + 15 * level,
    energy: level % 5 === 0 ? 1 : 0,
  };
}

/**
 * Прибавить XP, вернуть список новых уровней (если ап).
 * Игрок может пройти сразу несколько уровней за одну партию.
 */
function addXp(u, amount) {
  if (!amount || amount <= 0) return [];
  const before = levelFromXp(u.xp || 0);
  u.xp = (u.xp || 0) + amount;
  const after = levelFromXp(u.xp);
  const ups = [];
  for (let L = before + 1; L <= after; L++) ups.push({ level: L, reward: rewardFor(L) });
  return ups;
}

module.exports = { totalXpFor, levelFromXp, progress, rewardFor, addXp };
