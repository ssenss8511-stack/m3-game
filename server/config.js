// Конфигурация сервера. Значения энергии ДОЛЖНЫ совпадать со смыслом
// клиента (webapp/js/config.js), но именно сервер — источник правды.
try { require('dotenv').config(); } catch (_) { /* dotenv не обязателен */ }

const BOT_TOKEN = process.env.BOT_TOKEN || '';

module.exports = {
  port: parseInt(process.env.PORT, 10) || 3000,
  botToken: BOT_TOKEN,
  webAppUrl: process.env.WEBAPP_URL || '',
  // Нет токена → DEV-режим: подпись не проверяется, пускаем по devUserId.
  // В продакшне ОБЯЗАТЕЛЬНО задать BOT_TOKEN.
  devMode: !BOT_TOKEN,

  energy: {
    max: 5,
    regenMs: 60 * 60 * 1000, // +1 попытка в час
    costPerGame: 1,
    startFull: true,
  },

  // Антифрод-лимиты на то, что клиент может «принести» за одну игру.
  // Клиент считает награды сам, поэтому сервер обрезает их до разумного.
  caps: {
    coinsPerGame: 300,
    energyPerGame: 4,
    maxScore: 10000000,
    // Реалистичный потолок за партию: базовые очки × ходы × щедрый множитель.
    // Используется для «санити-чек» на сервере — фильтр от читеров.
    maxScorePerMove: 800,
    minGameDurationMs: 3000, // партия должна длиться минимум 3 секунды
  },

  // Отложенная награда за реферала: не выдавать пока приглашённый
  // не сыграл N партий за первые M дней (защита от фейк-аккаунтов).
  referral: {
    minGamesToUnlock: 5,
    maxDaysToUnlock: 3,
    coinsReferrer: 100,
    coinsReferee: 100,
  },

  // Сколько секунд считать initData свежим (защита от переигровки).
  initDataMaxAgeSec: 24 * 60 * 60,

  // CORS: разрешённые origin для API. Пусто = запрет всех кроме same-origin.
  // На проде укажи https://твой.домен (или через ENV CORS_ORIGIN).
  corsOrigin: process.env.CORS_ORIGIN || '',

  // Минимальная версия клиента, которую сервер принимает. Клиент шлёт свой
  // v=NN в заголовке; если меньше — /api/state возвращает 426 и клиент
  // показывает «обнови страницу».
  clientMinVersion: 87,

  // ID админа в Telegram — куда бот шлёт alert-ы о подозрительной активности.
  // Смотри свой id через @userinfobot. Пусто = алерты выключены.
  adminChatId: process.env.ADMIN_CHAT_ID || '',

  // TON-оплата: адрес-приёмник и пакеты. Сервер сверяет входящие
  // транзакции через toncenter.com (см. server/ton.js).
  ton: {
    receiver: process.env.TON_RECEIVER || '',   // адрес твоего TON-кошелька
    packages: [
      { id: 'p1', priceTon: 0.5, energy: 5,   bonus: '' },
      { id: 'p2', priceTon: 1.2, energy: 15,  bonus: 'x2 очки на 1 игру' },
      { id: 'p3', priceTon: 3.0, energy: 50,  bonus: 'бустер «бомба»', coins: 500 },
    ],
    // Не старше N сек — свежесть транзакции для верификации
    maxAgeSec: 3600,
  },

  // Покупки за монеты. ДУБЛИРУЮТ webapp/js/config.js → shop;
  // сервер — источник правды по ценам.
  // Цены покупок за монеты растут ГЕОМЕТРИЧЕСКИ:
  // price = base * mult^purchaseCount.
  // Множитель 1.5 даёт: 50 → 75 → 113 → 169 → 253 → 380 → 570...
  // 1.7 для апгрейда максимума: 300 → 510 → 867 → 1474 → 2506...
  shop: {
    refillOne:   { coins: 50,  mult: 1.5 },
    refillFull:  { coins: 200, mult: 1.5 },
    maxUpgrade:  { coinsBase: 300, mult: 1.7, maxCap: 30 },
  },

  // Бустеры, которые тратятся ВО ВРЕМЯ партии.
  // Цена — либо в монетах (`coins`), либо в энергии (`energy`).
  boosters: {
    moves5:      { coins: 80,    effect: { moves: 5 } },
    movesEnergy: { energy: 1,    effect: { moves: 3 } }, // обмен ⚡ → ходы
    shuffle:     { coins: 50,    effect: { shuffle: true } },
    bomb:        { coins: 120,   effect: { bomb: true } },
  },

  // Скины (сервер — источник правды по ценам). Продублировано с
  // webapp/js/config.js → skins. Все ключи должны совпадать.
  skins: {
    classic:   { price: 0 },
    pastel:    { price: 500 },
    fruits:    { price: 1000 },
    neon:      { price: 1200 },
    space:     { price: 1800 },
    candy:     { price: 2000 },
    animals:   { price: 2500 },
    gems:      { price: 3000 },
    halloween: { price: 3500 },
  },

  // Сколько игроков в топе
  leaderboardTop: 50,
};
