// Серверная логика энергии. Работает над объектом пользователя
// { id, energy, energy_ts, coins, best }. Источник правды — сервер,
// клиент эти значения только отображает.
const C = require('./config');

const now = () => Date.now();
const maxOf = (u) => u.max || C.energy.max;

/** Начислить накопленную по времени энергию (реген +1 за интервал). */
function sync(u) {
  const M = maxOf(u);
  if (u.energy >= M) {
    u.energy_ts = now(); // запас полон — таймер регена стоит
    return u;
  }
  const gained = Math.floor((now() - u.energy_ts) / C.energy.regenMs);
  if (gained > 0) {
    u.energy = Math.min(M, u.energy + gained);
    u.energy_ts = u.energy >= M ? now() : u.energy_ts + gained * C.energy.regenMs;
  }
  return u;
}

/** Миллисекунды до следующей попытки (0 — если запас полон). */
function msToNext(u) {
  if (u.energy >= maxOf(u)) return 0;
  return Math.max(0, C.energy.regenMs - (now() - u.energy_ts));
}

/** Списать стоимость игры. true — если хватило. */
function spend(u, amount) {
  sync(u);
  if (u.energy < amount) return false;
  const wasFull = u.energy >= maxOf(u);
  u.energy -= amount;
  if (wasFull) u.energy_ts = now(); // начинаем отсчёт регена
  return true;
}

/** Добавить попытки (награда/покупка), допускаем overflow выше max. */
function add(u, amount) {
  sync(u);
  u.energy += amount;
}

module.exports = { sync, msToNext, spend, add };
