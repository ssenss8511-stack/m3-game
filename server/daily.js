// Логика ежедневных наград. Источник правды — сервер.
// "День" = UTC-сутки. На каждой позиции серии — своя награда.
// Серия растёт при заходе подряд, сбрасывается, если пропустил день.
const C = require('./config');

const DAY_MS = 24 * 60 * 60 * 1000;
const dayIndex = (ts) => Math.floor(ts / DAY_MS); // UTC-день как номер
const today = () => dayIndex(Date.now());

// 7 наград по дням серии (повторяется циклом, если игрок ходит дольше)
const REWARDS = [
  { day: 1, coins: 50,  energy: 0 },
  { day: 2, coins: 75,  energy: 0 },
  { day: 3, coins: 0,   energy: 1 },
  { day: 4, coins: 100, energy: 0 },
  { day: 5, coins: 0,   energy: 2 },
  { day: 6, coins: 150, energy: 0 },
  { day: 7, coins: 300, energy: 1 }, // финал недели — крупный бонус
];

/** Обновить серию по правилу UTC-суток. Возвращает u (mutate). */
function refresh(u) {
  if (!u.daily) u.daily = { streak: 0, lastDay: 0 };
  const t = today();
  if (u.daily.lastDay === 0) {
    // никогда не забирал — серия 0, готов взять день 1
    u.daily.streak = 0;
  } else if (t === u.daily.lastDay) {
    // уже забрал сегодня — ничего не меняем
  } else if (t === u.daily.lastDay + 1) {
    // вчера забрал — серия живёт, готов взять следующий
  } else {
    // пропустил хотя бы день — серия сбрасывается
    u.daily.streak = 0;
  }
  return u;
}

function status(u) {
  refresh(u);
  const t = today();
  const canClaim = u.daily.lastDay !== t;
  const nextStreak = canClaim ? (u.daily.streak % REWARDS.length) + 1 : u.daily.streak;
  const reward = REWARDS[(nextStreak - 1 + REWARDS.length) % REWARDS.length];
  return {
    canClaim,
    streak: u.daily.streak,
    nextDay: nextStreak,
    nextReward: reward,
    rewards: REWARDS,
    msToNext: canClaim ? 0 : ((u.daily.lastDay + 1) * DAY_MS - Date.now()),
  };
}

/** Применить награду дня. Возвращает {ok, reward} либо {ok:false}. */
function claim(u) {
  refresh(u);
  const t = today();
  if (u.daily.lastDay === t) return { ok: false, reason: 'already_claimed' };
  u.daily.streak = (u.daily.streak % REWARDS.length) + 1;
  u.daily.lastDay = t;
  const reward = REWARDS[u.daily.streak - 1];
  return { ok: true, reward };
}

module.exports = { status, claim, refresh, REWARDS };
