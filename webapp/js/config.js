/*
 * Конфигурация игры. Меняй значения здесь — всё остальное подстроится.
 * Это единственное место, где задаются баланс, энергия и пакеты TON.
 */
window.CONFIG = {
  // Версия клиента — сравнивается с server.js clientMinVersion.
  // Если server > client → 426 → пользователь получает alert «обнови».
  // Синхронизировать при выпуске новых версий.
  clientVersion: 87,

  // Username бота для реферальных ссылок (без @).
  botUsername: 'b3matchbot',

  // Игровое поле
  board: {
    cols: 9,
    rows: 9,
    types: 5,          // обычные фишки: квадрат, круг, треугольник, звезда, ромб
  },

  // Спец-фишки — это ОТДЕЛЬНЫЕ типы фишек со своими иконками. Их нужно
  // собрать 3+ в ряд, как обычные. За совпадение игрок получает награду.
  // weight — вес выпадения относительно обычной фигуры (weightBase).
  // Чем меньше weight, тем реже фишка и тем «жирнее» ощущается матч.
  specials: {
    weightBase: 1,            // вес обычной фигуры (квадрат/круг/…)
    items: [
      { id: 'coin',   label: 'Монеты',  weight: 0.8,  reward: { coinsPerGem: 1 } },
      { id: 'gift',   label: 'Бонус',   weight: 0.4,  reward: { mystery: true } },
      { id: 'energy', label: 'Попытка', weight: 0.15, reward: { energyPer3: 1 } },
    ],
  },

  // Геймплей
  game: {
    movesPerGame: 25,        // ходов на одну попытку
    basePointsPerGem: 10,    // очки за одну фишку
    comboStep: 0.5,          // прибавка к множителю за каждый каскад (1x, 1.5x, 2x, ...)
    minMatch: 3,             // минимальная длина совпадения
    hintDelayMs: 15000,      // пауза бездействия до показа подсказки
  },

  // Энергия / попытки. Регенерация: +1 за каждый интервал, до максимума.
  energy: {
    max: 5,                          // максимум попыток
    regenMs: 60 * 60 * 1000,         // 1 час на восстановление одной попытки
    costPerGame: 1,                  // сколько попыток тратит одна игра
    startFull: true,                 // у нового игрока полный запас
  },

  // Покупки за внутреннюю валюту (монеты — собираются в игре).
  // Цена «+1 к максимуму» растёт от текущего максимума: maxBase * (max-startMax+1).
  // Сервер — источник правды (см. server/config.js).
  shop: {
    refillOne:   { coins: 50,  label: '+1 попытка' },
    refillFull:  { coins: 200, label: 'Заполнить запас' },
    maxUpgrade:  { coinsBase: 300, step: 200, label: '+1 к максимуму' },
  },

  // Бустеры во время игры. Цена — в монетах; реальное списание делает
  // сервер (/api/buy-booster). В офлайн-режиме — то же из Mock'а.
  boosters: {
    moves5:      { coins: 80,  title: '+5 ходов',   icon: '➕5' },
    movesEnergy: { energy: 1,  title: '+3 за ⚡',   icon: '+3' },
    shuffle:     { coins: 50,  title: 'Перемешать', icon: '🔀' },
    bomb:        { coins: 120, title: 'Бомба',      icon: '💣' },
  },

  // Множители геометрического роста цен (для офлайн-режима — сервер
  // считает сам). Должны совпадать со значениями в server/config.js.
  shopMults: { refillOne: 1.5, refillFull: 1.5, maxUpgrade: 1.7 },

  // Скины фишек. Реализованы через CSS-темы (data-skin на <html>).
  skins: [
    { id: 'classic', title: 'Classic', desc: 'Стандартный набор фигур',     price: 0 },
    { id: 'pastel',  title: 'Pastel',  desc: 'Мягкие приглушённые цвета',   price: 500 },
    { id: 'fruits',  title: 'Fruits',  desc: 'Яблоко, банан, лайм, лимон, виноград', price: 1000 },
    { id: 'neon',    title: 'Neon',    desc: 'Светящиеся контуры в темноте',price: 1200 },
    { id: 'space',   title: 'Space',   desc: 'Солнце, Земля, Сатурн, звезда, Луна', price: 1800 },
    { id: 'candy',   title: 'Candy',   desc: 'Леденцы, мармелад и желе',    price: 2000 },
    { id: 'animals', title: 'Animals', desc: 'Лиса, панда, лягушка, кот, пчела', price: 2500 },
    { id: 'gems',    title: 'Gems',    desc: 'Рубин, сапфир, изумруд, топаз, аметист', price: 3000 },
    { id: 'halloween', title: 'Halloween', desc: 'Тыква, призрак, летучая мышь, конфета, череп', price: 3500 },
  ],

  // Достижения — клиент использует тот же список, чтобы отрисовать UI.
  achievements: [
    { id: 'play_3',      title: 'Первые шаги',     desc: 'Сыграй 3 партии' },
    { id: 'play_25',     title: 'Постоянный игрок', desc: '25 партий' },
    { id: 'matches_100', title: 'Сборщик',         desc: '100 матчей' },
    { id: 'matches_500', title: 'Виртуоз',         desc: '500 матчей' },
    { id: 'combo_3',     title: 'Цепочка',         desc: 'Каскад x3' },
    { id: 'combo_5',     title: 'Молниеносный',    desc: 'Каскад x5' },
    { id: 'score_5k',    title: 'Пятитысячник',    desc: 'Рекорд 5000' },
    { id: 'score_15k',   title: 'Чемпион',         desc: 'Рекорд 15000' },
    { id: 'coins_500',   title: 'Кошелёк',         desc: '500 монет всего' },
    { id: 'coins_5000',  title: 'Толстосум',       desc: '5000 монет всего' },
    { id: 'streak_7',    title: 'Семидневный',     desc: 'Серия 7 дней' },
  ],

  // TON-оплата (пока заглушка — подключим TON Connect позже).
  ton: {
    receiver: 'UQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA', // адрес-получатель (заменить)
    packages: [
      { id: 'p1', title: '+5 попыток',  energy: 5,  bonus: '',              priceTon: 0.5 },
      { id: 'p2', title: '+15 попыток', energy: 15, bonus: '+ x2 очки на 1 игру', priceTon: 1.2 },
      { id: 'p3', title: '+50 попыток', energy: 50, bonus: '+ бустер «бомба»',     priceTon: 3.0 },
    ],
  },

  // Ключи localStorage
  storage: {
    energy: 'm3_energy',
    energyTs: 'm3_energy_ts',
    best: 'm3_best',
    coins: 'm3_coins',
  },
};
