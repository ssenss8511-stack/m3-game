/*
 * Telegram-бот. Делает три вещи:
 *   1) Открывает Mini App кнопкой web_app.
 *   2) Сохраняет chat_id игрока — нужен для пушей (notifier.js).
 *   3) Принимает реферальный код из `/start ref_XXXX` (или старт-параметра
 *      Mini App) и записывает реферера.
 */
const C = require('./config');
const db = require('./db');
const notifier = require('./notifier');
const alerts = require('./alerts');

function start() {
  if (!C.botToken) { console.log('[bot] BOT_TOKEN не задан — бот не запущен.'); return null; }
  if (!C.webAppUrl) { console.log('[bot] WEBAPP_URL не задан — бот не запущен.'); return null; }

  let TelegramBot;
  try { TelegramBot = require('node-telegram-bot-api'); }
  catch (_) { console.error('[bot] Запусти `npm install` — нет node-telegram-bot-api'); return null; }

  const bot = new TelegramBot(C.botToken, { polling: true });

  const playButton = {
    reply_markup: {
      inline_keyboard: [[{ text: '🎮 Играть в M3', web_app: { url: C.webAppUrl } }]],
    },
  };

  bot.onText(/^\/start(?:\s+(\S+))?/, (msg, m) => {
    const userId = 'tg:' + msg.from.id;
    let u = db.getUser(userId);
    if (!u) {
      u = { id: userId, created: Date.now(), max: C.energy.max,
            energy: C.energy.startFull ? C.energy.max : 0, energy_ts: Date.now(),
            coins: 0, best: 0, stats: {}, achievements: [] };
    }
    u.chat_id = msg.chat.id;
    u.tg_name = msg.from.first_name || '';

    // Реферал: /start ref_<refererTgId>. Награду откладываем до тех пор,
    // пока приглашённый не сыграет N партий за M дней (см. server/config.js).
    // Это защищает от фейк-аккаунтов, созданных ради фарма рефералов.
    const code = m && m[1];
    if (code && code.startsWith('ref_') && !u.referrer && !u.referrer_processed) {
      const referrerId = 'tg:' + code.slice(4);
      if (referrerId !== userId) {
        const ref = db.getUser(referrerId);
        if (ref) {
          u.referrer = referrerId;
          u.referrer_since = Date.now();  // отсчёт для дедлайна
          // НЕ начисляем coins сейчас; см. checkReferralUnlock в server.js
        }
      }
    }
    db.saveUser(u);

    bot.sendMessage(msg.chat.id,
      `Привет, ${u.tg_name || 'игрок'}! Это M3 — собирай 3 в ряд, копи монеты, прокачивай попытки.\n\nНажми кнопку, чтобы начать.`,
      playButton);
  });

  bot.onText(/^\/play|^\/game/, (msg) => bot.sendMessage(msg.chat.id, 'Поехали!', playButton));
  bot.onText(/^\/help/, (msg) => bot.sendMessage(msg.chat.id,
    'Команды:\n/start — открыть игру\n/play — открыть игру\n/help — эта подсказка'));

  bot.on('polling_error', (err) => console.error('[bot] polling_error:', err.code, err.message));

  notifier.start(bot);
  alerts.setBot(bot);
  console.log('[bot] Запущен. WebApp URL:', C.webAppUrl);
  return bot;
}

module.exports = { start };
