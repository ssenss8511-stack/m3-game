// Фоновые уведомления через бота. Каждые N минут проверяем игроков и шлём
// пуши. На игрока — не больше одного уведомления в сутки по каждому типу.
//
// Типы:
//   1) energy_full   — попытки полны, был неактивен ≥ 3ч
//   2) daily_ready   — есть ежедневная награда
//   3) tournament_end — до конца недельного турнира ≤ 24ч и юзер в топ-20
//   4) reengagement  — не заходил ≥ 3 суток (шлём 1 раз в 7 дней)
//
// Троттлинг: 100 мс между sendMessage (10/сек) — под лимит TG (30/сек).
const C = require('./config');
const db = require('./db');
const Energy = require('./energy');
const Daily = require('./daily');
const Tournament = require('./tournament');

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const SCAN_EVERY_MS = 5 * 60 * 1000;
const ENERGY_NOTIFY_COOLDOWN = 18 * HOUR;
const ENERGY_IDLE_BEFORE_NOTIFY = 3 * HOUR;
const DAILY_NOTIFY_COOLDOWN = 20 * HOUR;
const TOURNAMENT_NOTIFY_COOLDOWN = 24 * HOUR;
const REENGAGE_INACTIVE_MS = 3 * DAY;
const REENGAGE_COOLDOWN = 7 * DAY;
const SEND_THROTTLE_MS = 100;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function start(bot) {
  if (!bot) return;

  const loop = async () => {
    const now = Date.now();
    const weekEndsAt = Tournament.weekEndsAt ? Tournament.weekEndsAt() : null;
    const tournamentEndSoon = weekEndsAt && (weekEndsAt - now) < 24 * HOUR;

    for (const u of db.allUsers()) {
      if (!u.chat_id) continue;
      try {
        Energy.sync(u);

        // 1) Энергия
        const lastPlay = u.last_play || u.created || 0;
        const idleFor = now - lastPlay;
        const lastE = u.notif_energy || 0;
        if (u.energy >= (u.max || C.energy.max) &&
            now - lastE > ENERGY_NOTIFY_COOLDOWN &&
            idleFor > ENERGY_IDLE_BEFORE_NOTIFY &&
            idleFor < REENGAGE_INACTIVE_MS) {  // если давно не заходил — шлём другое
          await bot.sendMessage(u.chat_id,
            `⚡ Попытки восстановились (${u.energy}/${u.max || C.energy.max}). Запусти игру и собери награды!`);
          u.notif_energy = now;
          db.markDirty();
          await sleep(SEND_THROTTLE_MS);
          continue;   // одна нотификация за проход
        }

        // 2) Ежедневка
        const lastD = u.notif_daily || 0;
        const daily = Daily.status(u);
        if (daily.canClaim && now - lastD > DAILY_NOTIFY_COOLDOWN) {
          await bot.sendMessage(u.chat_id,
            '🎁 Доступна ежедневная награда. Заходи и забирай — серия не должна прерываться!');
          u.notif_daily = now;
          db.markDirty();
          await sleep(SEND_THROTTLE_MS);
          continue;
        }

        // 3) Турнир заканчивается — шлём только тем, у кого есть шанс
        const lastT = u.notif_tournament || 0;
        if (tournamentEndSoon && (u.weekBest || 0) > 0 &&
            now - lastT > TOURNAMENT_NOTIFY_COOLDOWN) {
          const hours = Math.max(1, Math.round((weekEndsAt - now) / HOUR));
          await bot.sendMessage(u.chat_id,
            `🏆 Недельный турнир заканчивается через ${hours}ч. Твой лучший — ${u.weekBest}. Успей улучшить!`);
          u.notif_tournament = now;
          db.markDirty();
          await sleep(SEND_THROTTLE_MS);
          continue;
        }

        // 4) Реангейджмент
        const lastR = u.notif_reengage || 0;
        if (idleFor > REENGAGE_INACTIVE_MS && now - lastR > REENGAGE_COOLDOWN) {
          const days = Math.round(idleFor / DAY);
          await bot.sendMessage(u.chat_id,
            `🎮 Мы скучаем! Прошло ${days} дн. с последней партии — открой игру и забери накопленные попытки + бонус.`);
          u.notif_reengage = now;
          db.markDirty();
          await sleep(SEND_THROTTLE_MS);
        }
      } catch (e) {
        // 403 = пользователь заблокировал бота → больше не дёргаем
        if (e.response && e.response.statusCode === 403) {
          u.chat_id = null; db.markDirty();
        } else {
          console.warn('[notifier]', u.id, e.message);
        }
      }
    }
  };

  setInterval(loop, SCAN_EVERY_MS).unref();
  console.log('[notifier] активен — проверка каждые', SCAN_EVERY_MS / 60000, 'мин');
}

module.exports = { start };
