// Список достижений и логика проверки.
// Поле u.stats обновляется на /api/end; здесь определяем, какие достижения
// игрок «открыл» по текущим статам. Источник правды — сервер.

const LIST = [
  { id: 'play_3',      title: 'Первые шаги',     desc: 'Сыграй 3 партии',          stat: 'gamesPlayed', need: 3,    reward: { coins: 30 } },
  { id: 'play_25',     title: 'Постоянный игрок', desc: 'Сыграй 25 партий',         stat: 'gamesPlayed', need: 25,   reward: { coins: 150 } },
  { id: 'matches_100', title: 'Сборщик',         desc: 'Собери 100 матчей',        stat: 'matches',     need: 100,  reward: { coins: 50 } },
  { id: 'matches_500', title: 'Виртуоз',         desc: 'Собери 500 матчей',        stat: 'matches',     need: 500,  reward: { coins: 200 } },
  { id: 'combo_3',     title: 'Цепочка',         desc: 'Сделай каскад x3',         stat: 'maxCombo',    need: 3,    reward: { coins: 40 } },
  { id: 'combo_5',     title: 'Молниеносный',    desc: 'Сделай каскад x5',         stat: 'maxCombo',    need: 5,    reward: { coins: 120, energy: 1 } },
  { id: 'score_5k',    title: 'Пятитысячник',    desc: 'Рекорд 5 000 очков',       stat: 'best',        need: 5000, reward: { coins: 80 } },
  { id: 'score_15k',   title: 'Чемпион',         desc: 'Рекорд 15 000 очков',      stat: 'best',        need: 15000, reward: { coins: 250, energy: 2 } },
  { id: 'coins_500',   title: 'Кошелёк',         desc: 'Заработай 500 монет',      stat: 'totalCoins',  need: 500,  reward: { coins: 50 } },
  { id: 'coins_5000',  title: 'Толстосум',       desc: 'Заработай 5 000 монет',    stat: 'totalCoins',  need: 5000, reward: { coins: 300 } },
  { id: 'streak_7',    title: 'Семидневный',     desc: 'Серия ежедневок 7 дней',   stat: 'maxStreak',   need: 7,    reward: { coins: 200, energy: 1 } },
];

/** Проверить ачивки. Возвращает массив новых разблокированных. */
function check(u) {
  if (!u.achievements) u.achievements = [];
  if (!u.stats) u.stats = {};
  const unlocked = [];
  for (const a of LIST) {
    if (u.achievements.includes(a.id)) continue;
    const val = a.stat === 'best' ? u.best : (u.stats[a.stat] || 0);
    if (val >= a.need) {
      u.achievements.push(a.id);
      unlocked.push(a);
    }
  }
  return unlocked;
}

module.exports = { LIST, check };
