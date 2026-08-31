// Лимитированные события.
//
//  • Weekend double — в субботу/воскресенье (UTC) собранные за партию
//    монеты удваиваются (через coinMultiplier).
//  • Weekly mega-quest — за неделю (Пн-Вс) набери 10 000 очков → большой
//    приз. Считаем сумму очков всех партий за неделю.
//
// Источник правды — сервер. Клиент только показывает.

const DAY = 86400000;
const WEEK = 7 * DAY;
// «Понедельниковый» индекс недели: 1 Jan 1970 был четверг (4). Сдвигаем,
// чтобы границы недель совпадали с UTC-понедельниками.
function weekIndex() { return Math.floor((Date.now() - 4 * DAY) / WEEK); }
function dayOfWeek() { return new Date().getUTCDay(); } // 0=Вс, 6=Сб

/** Список активных СЕЙЧАС событий. */
function active() {
  const list = [];
  const dow = dayOfWeek();
  if (dow === 0 || dow === 6) {
    list.push({
      id: 'weekend_double',
      title: 'Выходные ×2 монет',
      icon: '🪙×2',
      desc: 'Все собранные в партиях монеты удваиваются.',
      mult: { coins: 2 },
    });
  }
  // здесь же легко добавить «двойные очки», «бесплатный бустер» и т.д.
  return list;
}

/** Множитель для монет, агрегированный по всем активным событиям. */
function coinMultiplier() {
  return active().reduce((m, e) => m * ((e.mult && e.mult.coins) || 1), 1);
}

const WEEKLY = {
  id: 'weekly_score_10k',
  title: 'Недельный вызов',
  desc: 'Набери 10 000 очков за неделю',
  target: 10000,
  reward: { coins: 500, energy: 2 },
};

function ensureWeekly(u) {
  const w = weekIndex();
  if (!u.weekly || u.weekly.week !== w) {
    u.weekly = { week: w, sum: 0, claimed: false };
  }
  return u.weekly;
}

/** Засчитать очки в недельный квест. Возвращает награду, если выполнили. */
function progressWeekly(u, score) {
  ensureWeekly(u);
  if (u.weekly.claimed) return null;
  u.weekly.sum += score;
  if (u.weekly.sum >= WEEKLY.target) {
    u.weekly.claimed = true;
    return WEEKLY;
  }
  return null;
}

function weeklyStatus(u) {
  ensureWeekly(u);
  return {
    id: WEEKLY.id, title: WEEKLY.title, desc: WEEKLY.desc,
    target: WEEKLY.target, progress: Math.min(u.weekly.sum, WEEKLY.target),
    claimed: u.weekly.claimed, reward: WEEKLY.reward,
    msToEnd: (weekIndex() + 1) * WEEK + 4 * DAY - Date.now(),
  };
}

module.exports = { active, coinMultiplier, progressWeekly, weeklyStatus };
