// Backend для match-3: раздаёт фронтенд + API серверной энергии.
const express = require('express');
const path = require('path');
const C = require('./config');
const tg = require('./telegram');
const Energy = require('./energy');
const Daily = require('./daily');
const Ach = require('./achievements');
const Quests = require('./quests');
const Events = require('./events');
const Chest = require('./chest');
const Tournament = require('./tournament');
const Levels = require('./levels');
const RateLimit = require('./rate-limit');
const Audit = require('./audit');
const Alerts = require('./alerts');
const Ton = require('./ton');
const Replay = require('./replay');
const Behavior = require('./behavior');
const db = require('./db');
const crypto = require('crypto');
const fs = require('fs');
const pathMod = require('path');

const app = express();
app.set('trust proxy', 1);  // за Nginx/Cloudflare — реальный IP в req.ip
app.use(express.json());

// Helmet — стандартные заголовки безопасности (HSTS, XSS, frameguard и т.д.)
try {
  const helmet = require('helmet');
  app.use(helmet({
    contentSecurityPolicy: false, // Mini App вставляет CSP через TG, свою CSP не ставим
    crossOriginEmbedderPolicy: false, // иначе Telegram WebApp iframe не откроется
  }));
} catch (_) { console.warn('[server] helmet не установлен: npm install'); }

// CORS: строго — origin должен совпасть с CORS_ORIGIN. Если ENV не задан —
// same-origin (не шлём заголовок вовсе, браузер сам разрешит только own-origin).
// В dev-режиме (NODE_ENV != production и devMode) разрешаем origin запроса —
// иначе локальная разработка с двумя портами (Python http.server + Node) сломается.
app.use('/api', (req, res, next) => {
  const allowed = C.corsOrigin || '';
  const origin = req.headers.origin || '';
  const isDev = C.devMode && process.env.NODE_ENV !== 'production';
  if (allowed && origin === allowed) {
    res.header('Access-Control-Allow-Origin', allowed);
  } else if (isDev && origin) {
    res.header('Access-Control-Allow-Origin', origin);   // только dev
  }
  // Если ни то, ни другое — заголовок не ставим → CORS-запрос падает у браузера.
  res.header('Vary', 'Origin');
  res.header('Access-Control-Allow-Headers', 'Content-Type, X-Client-Version');
  res.header('Access-Control-Allow-Methods', 'POST, OPTIONS');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

// Version check — если клиент старой версии, шлём 426 (Upgrade Required)
app.use('/api', (req, res, next) => {
  const v = parseInt(req.headers['x-client-version'] || '0', 10);
  if (v && v < C.clientMinVersion) {
    return res.status(426).json({ error: 'upgrade_required', minVersion: C.clientMinVersion });
  }
  next();
});

// Health-check для Docker/systemd/uptime-мониторинга (без auth)
app.get('/health', (req, res) => {
  res.json({
    ok: true,
    driver: db._driver || 'unknown',
    uptime: Math.round(process.uptime()),
    ts: Date.now(),
  });
});

// Раздаём статику фронтенда
app.use(express.static(path.join(__dirname, '..', 'webapp')));

// --- Аутентификация по Telegram initData ---
function authUser(req, res) {
  const body = req.body || {};
  if (C.devMode && body.devUserId) {
    return { id: 'dev:' + String(body.devUserId) };
  }
  const user = tg.validate(body.initData, C.botToken, C.initDataMaxAgeSec);
  if (!user) {
    res.status(401).json({ error: 'unauthorized' });
    return null;
  }
  return user;
}

// --- Rate-limit мидлварь: 60 req/min на юзера, 200/min на IP ---
function rateLimit(req, res, next) {
  const body = req.body || {};
  const user = C.devMode && body.devUserId
    ? { id: 'dev:' + String(body.devUserId) }
    : tg.validate(body.initData, C.botToken, C.initDataMaxAgeSec);
  const key = user ? 'u:' + user.id : 'ip:' + req.ip;
  const ipKey = 'ip:' + req.ip;
  if (!RateLimit.check(key, 60, 60000) || !RateLimit.check(ipKey, 200, 60000)) {
    Alerts.report('too_many_requests', { key, ipKey });
    return res.status(429).json({ error: 'too_many_requests' });
  }
  next();
}
app.use('/api', rateLimit);

// --- Работа с пользователем ---
function loadUser(id) {
  id = String(id);
  let u = db.getUser(id);
  if (!u) {
    u = {
      id,
      max: C.energy.max,
      energy: C.energy.startFull ? C.energy.max : 0,
      energy_ts: Date.now(),
      coins: 0,
      best: 0,
      created: Date.now(),
    };
    db.saveUser(u);
    Audit.log('user_created', { userId: id });
  } else if (u.max == null) {
    u.max = C.energy.max;                               // миграция старых записей
  }
  return u;
}

/** Собрать fingerprint из request + initData. Сохраняется один раз. */
function captureFingerprint(u, req) {
  if (u.fp) return;   // уже собран
  const body = req.body || {};
  let tgUser = null;
  try {
    const params = new URLSearchParams(body.initData || '');
    tgUser = JSON.parse(params.get('user') || 'null');
  } catch (_) {}
  u.fp = {
    ua: (req.headers['user-agent'] || '').slice(0, 200),
    lang: (req.headers['accept-language'] || '').slice(0, 60),
    ip: req.ip,
    tg_lang: tgUser && tgUser.language_code || null,
    tg_premium: !!(tgUser && tgUser.is_premium),
    tg_name: tgUser && tgUser.first_name || null,
    capturedAt: Date.now(),
  };
  Audit.log('fingerprint', { userId: u.id, fp: u.fp });
}

function nextMaxUpgradeCost(u) {
  const s = C.shop.maxUpgrade;
  const n = u.max - C.energy.max;
  return Math.round(s.coinsBase * Math.pow(s.mult || 1, n));
}

// Текущая цена для refillOne/refillFull с учётом числа уже сделанных покупок
function refillPrice(u, key) {
  if (!u.shopCounts) u.shopCounts = {};
  const s = C.shop[key];
  const count = u.shopCounts[key] || 0;
  return Math.round(s.coins * Math.pow(s.mult || 1, count));
}
function bumpShopCount(u, key) {
  if (!u.shopCounts) u.shopCounts = {};
  u.shopCounts[key] = (u.shopCounts[key] || 0) + 1;
}

function stateOf(u) {
  Energy.sync(u);
  return {
    energy: u.energy,
    max: u.max,
    regenMs: C.energy.regenMs,
    msToNext: Energy.msToNext(u),
    coins: u.coins,
    best: u.best,
    prices: {
      refillOne:  refillPrice(u, 'refillOne'),
      refillFull: refillPrice(u, 'refillFull'),
      maxUpgrade: nextMaxUpgradeCost(u),
      maxUpgradeAvailable: u.max < C.shop.maxUpgrade.maxCap,
    },
    daily: Daily.status(u),
    quests: Quests.ensure(u),
    events: Events.active(),
    weekly: Events.weeklyStatus(u),
    chest: Chest.status(u),
    tournament: { myWeekBest: u.weekBest || 0, week: Tournament.weekIndex() },
    levels: Levels.progress(u),
    achievements: u.achievements || [],
    ownedSkins: u.ownedSkins || ['classic'],
    stats: u.stats || {},
    boosterPrices: {
      moves5: C.boosters.moves5.coins,
      shuffle: C.boosters.shuffle.coins,
      bomb: C.boosters.bomb.coins,
    },
    name: u.tg_name || u.id,
  };
}

// --- API ---

// Текущее состояние (с учётом регена)
app.post('/api/state', (req, res) => {
  const user = authUser(req, res); if (!user) return;
  Tournament.settle(db);          // если началась новая неделя — выдать призы прошлой
  const u = loadUser(user.id);
  captureFingerprint(u, req);
  const s = stateOf(u);
  // pendingTournament — одноразовое уведомление о призе с прошлой недели
  const pending = u.pendingTournament || null;
  if (pending) { delete u.pendingTournament; }
  db.saveUser(u);
  res.json({ ...s, pendingTournament: pending });
});

// Секретный ключ для HMAC-подписи game_id. Берётся из ENV или генерируется
// один раз при старте (перезапуск инвалидирует все активные gameId).
const GAME_SECRET = process.env.GAME_SECRET || crypto.randomBytes(32).toString('hex');
function signGame(id, uid, started) {
  return crypto.createHmac('sha256', GAME_SECRET)
    .update(id + '|' + uid + '|' + started).digest('hex').slice(0, 32);
}

// Начать игру — списать попытку, выдать подписанный gameId для /api/end
app.post('/api/play', (req, res) => {
  const user = authUser(req, res); if (!user) return;
  const u = loadUser(user.id);
  if (!Energy.spend(u, C.energy.costPerGame)) {
    db.saveUser(u);
    return res.status(409).json({ error: 'no_energy', ...stateOf(u) });
  }
  const id = crypto.randomBytes(12).toString('hex');
  const started = Date.now();
  // Seed для детерминированной генерации фишек на клиенте. Сервер знает
  // seed → в перспективе может воспроизвести партию и валидировать счёт.
  const seed = crypto.randomBytes(4).readUInt32BE(0);
  u.currentGame = { id, started, seed, sig: signGame(id, u.id, started) };
  db.saveUser(u);
  res.json({ ...stateOf(u), gameId: id, gameSig: u.currentGame.sig, seed });
});

// Завершить игру — записать результат и награды (с лимитами).
// Дополнительно копим статистику и сверяем достижения.
app.post('/api/end', (req, res) => {
  const user = authUser(req, res); if (!user) return;
  const u = loadUser(user.id);
  const b = req.body || {};

  // 1. Валидация игровой сессии: id + HMAC-подпись должны совпадать
  if (!u.currentGame || u.currentGame.id !== b.gameId ||
      u.currentGame.sig !== b.gameSig ||
      u.currentGame.sig !== signGame(b.gameId, u.id, u.currentGame.started)) {
    Audit.log('invalid_game_id', { userId: u.id, sent: { id: b.gameId, sig: b.gameSig } });
    Alerts.report('invalid_game_id', { userId: u.id });
    return res.status(403).json({ error: 'invalid_game_id' });
  }
  const duration = Date.now() - u.currentGame.started;
  if (duration < C.caps.minGameDurationMs) {
    return res.status(429).json({ error: 'too_fast' });
  }

  // Валидация журнала ходов (server-side replay MVP): каждый ход = {r1,c1,r2,c2,t}.
  // Полный реплей движка пока не переносим; проверяем формальные инварианты,
  // без которых любой авто-бот заметен: количество ходов, min-интервал между
  // ходами, суммарная длительность, соседство свапа.
  const moveLog = Array.isArray(b.moveLog) ? b.moveLog : [];
  const maxMoves = C.game && C.game.movesPerGame ? C.game.movesPerGame : 25;
  if (moveLog.length > maxMoves + 5) {
    Audit.log('replay_too_many_moves', { userId: u.id, moves: moveLog.length });
    Alerts.report('replay_bad', { userId: u.id, kind: 'too_many_moves' });
    return res.status(403).json({ error: 'replay_invalid' });
  }
  let prevT = 0;
  for (const m of moveLog) {
    if (!m || typeof m.r1 !== 'number') { moveLog.badShape = true; break; }
    // Свап только соседних клеток
    const dr = Math.abs(m.r1 - m.r2), dc = Math.abs(m.c1 - m.c2);
    if (dr + dc !== 1) { moveLog.badShape = true; break; }
    // Минимум 80мс между ходами (человек не тапает быстрее 12/сек)
    if (m.t - prevT < 80) { moveLog.tooFast = true; }
    prevT = m.t;
  }
  if (moveLog.badShape) {
    Audit.log('replay_bad_shape', { userId: u.id });
    Alerts.report('replay_bad', { userId: u.id, kind: 'shape' });
    return res.status(403).json({ error: 'replay_invalid' });
  }
  if (moveLog.tooFast) {
    Audit.log('replay_too_fast', { userId: u.id, moves: moveLog.length });
    // Не блокируем, но помечаем — накопится threshold → Alerts.report
  }
  // Поведенческий анализ (AI-бот детектор): смотрим ритм ходов
  let botFactor = 1.0;   // множитель наград: 0.5 если подозреваем бота
  if (moveLog.length >= 8) {   // <8 ходов = слишком мало данных, пропускаем
    const bh = Behavior.analyzeMoveLog(moveLog);
    const susp = Behavior.updateSuspicion(u, bh.humanLikeness);
    const night = Behavior.updateCircadian(u);
    if (bh.flags.length) {
      Audit.log('behavior_flags', { userId: u.id, flags: bh.flags, susp: +susp.toFixed(2),
                                     stats: bh.stats, night });
    }
    // Shadow-cap: если подозрение выше 4 из 10 — режем награды пополам
    // (не блокируем, чтобы не раскрыть логику детектора)
    if (susp >= 4) {
      botFactor = 0.5;
      Alerts.report('bot_suspect', { userId: u.id, susp: +susp.toFixed(2), flags: bh.flags });
    }
    // Полный бан по очкам: susp >= 7 → 0 наград, но игру засчитываем
    if (susp >= 7) botFactor = 0;
    // Циркадный флаг — только уведомление
    if (night >= 10) {
      Audit.log('circadian_night', { userId: u.id, streak: night });
      Alerts.report('bot_suspect', { userId: u.id, kind: 'circadian', streak: night });
    }
  }

  // Полный реплей движка на сервере (server/replay.js) — источник правды.
  // Если клиент прислал moveLog и seed известен — считаем каноничные метрики
  // и сравниваем: если клиент превысил канон на >20% → используем канон и
  // логируем инцидент.
  let canon = null;
  if (moveLog.length && u.currentGame.seed != null) {
    try {
      canon = Replay.replay(u.currentGame.seed, moveLog);
      if (canon.invalidMoves > 0) {
        Audit.log('replay_invalid_moves', { userId: u.id, count: canon.invalidMoves, total: moveLog.length });
        Alerts.report('replay_bad', { userId: u.id, kind: 'invalid_moves', n: canon.invalidMoves });
        // > трети ходов недействительны → блокируем
        if (canon.invalidMoves > moveLog.length / 3) {
          return res.status(403).json({ error: 'replay_invalid' });
        }
      }
    } catch (e) {
      console.error('[replay] failed:', e.message);
      Audit.log('replay_error', { userId: u.id, err: e.message });
    }
  }

  // Сохраняем компактный лог для разбора жалоб/аналитики
  if (moveLog.length) {
    Audit.log('game_replay', {
      userId: u.id, seed: u.currentGame.seed, moves: moveLog.length,
      duration, canon: canon ? { score: canon.score, matches: canon.matches } : null,
    });
  }

  u.currentGame = null;

  // 2. Sanity-check счёта:
  //   - canon даёт нижнюю оценку (server-side replay может расходиться из-за
  //     reshuffle-ов, мистери-рандома, спец-фишек — оценка приближённая);
  //   - жёсткий cap применяем только если клиент СИЛЬНО завышает (>3× canon)
  //   - как fallback работают старые caps из config.
  const realisticMax = C.caps.maxScorePerMove * C.energy.max * 3;
  const rawScore = clampInt(b.score, 0, C.caps.maxScore);
  let scoreCap = realisticMax;
  if (canon) {
    const canonHardCap = Math.round(canon.score * 3) + 5000;
    scoreCap = Math.min(scoreCap, canonHardCap);
  }
  const score = Math.min(rawScore, scoreCap);
  if (rawScore > scoreCap) {
    Audit.log('score_capped', { userId: u.id, raw: rawScore, capped: score, canon: canon && canon.score });
    Alerts.report('score_capped', { userId: u.id, raw: rawScore });
  }
  const coinsBase = clampInt(b.coins, 0, C.caps.coinsPerGame);
  const coinsGained = Math.round(coinsBase * Events.coinMultiplier() * botFactor);
  const energyGained = Math.round(clampInt(b.energy, 0, C.caps.energyPerGame) * botFactor);
  const matches = clampInt(b.matches, 0, 10000);
  const maxCombo = clampInt(b.maxCombo, 0, 50);

  // 3. Anti-spec-farming: подозрительно если пришло много монет за мало матчей
  // (обычно спец-фишки дают 1 монету за штуку, 3 в ряд = 3+ монет).
  // Если coins >>> matches*3 — что-то не так.
  if (coinsBase > matches * 5 + 30) {
    Audit.log('spec_farm_suspect', { userId: u.id, coins: coinsBase, matches, duration });
    Alerts.report('spec_farm_suspect', { userId: u.id, coins: coinsBase });
  }

  u.coins += coinsGained;
  if (energyGained > 0) Energy.add(u, energyGained);
  if (score > u.best) u.best = score;
  Tournament.recordScore(u, score);
  // XP: score/10 + 5 за участие
  const xpGained = Math.round(score / 10) + 5;
  const levelUps = Levels.addXp(u, xpGained);
  for (const up of levelUps) {
    if (up.reward.coins)  u.coins += up.reward.coins;
    if (up.reward.energy) Energy.add(u, up.reward.energy);
  }
  u.last_play = Date.now();
  Chest.bumpPlayed(u);

  // статистика для достижений
  if (!u.stats) u.stats = {};
  u.stats.gamesPlayed = (u.stats.gamesPlayed || 0) + 1;
  u.stats.matches = (u.stats.matches || 0) + matches;
  u.stats.totalCoins = (u.stats.totalCoins || 0) + coinsGained;
  if (maxCombo > (u.stats.maxCombo || 0)) u.stats.maxCombo = maxCombo;
  if ((u.daily && u.daily.streak) > (u.stats.maxStreak || 0)) u.stats.maxStreak = u.daily.streak;

  // награды за разблокированные ачивки
  const unlocked = Ach.check(u);
  for (const a of unlocked) {
    if (a.reward.coins)  u.coins += a.reward.coins;
    if (a.reward.energy) Energy.add(u, a.reward.energy);
  }

  // дневные цели: обновляем прогресс и выдаём награды за выполненные
  const questsDone = Quests.progress(u, { score, matches, maxCombo, coinsGained });
  for (const q of questsDone) {
    if (q.reward.coins)  u.coins += q.reward.coins;
    if (q.reward.energy) Energy.add(u, q.reward.energy);
  }

  // отложенная реферальная награда
  checkReferralUnlock(u);

  // недельный квест: копим сумму очков, выдаём приз при достижении цели
  const weeklyReward = Events.progressWeekly(u, score);
  if (weeklyReward) {
    if (weeklyReward.reward.coins)  u.coins += weeklyReward.reward.coins;
    if (weeklyReward.reward.energy) Energy.add(u, weeklyReward.reward.energy);
  }

  db.saveUser(u);
  res.json({ ...stateOf(u), unlocked, questsDone, weeklyReward, levelUps, xpGained });
});

// Топ игроков НЕДЕЛИ + позиция текущего. Сначала settle прошлой недели.
app.post('/api/leaderboard', (req, res) => {
  const user = authUser(req, res); if (!user) return;
  Tournament.settle(db);
  const limit = Math.min(parseInt((req.body && req.body.limit), 10) || C.leaderboardTop, 200);
  const all = db.allUsers();
  const top = Tournament.topThisWeek(all, limit).map((row) => ({
    ...row, isMe: row.userId === user.id,
  }));
  const me = loadUser(user.id);
  const rank = Tournament.myRank(all, me.id);
  res.json({
    top,
    me: { rank, best: me.weekBest || 0, name: me.tg_name || 'игрок', lifetime: me.best || 0 },
    week: Tournament.weekIndex(),
    prizes: Tournament.PRIZES,
  });
});

// Открыть сундук (даётся каждые N партий бесплатно)
app.post('/api/chest/open', (req, res) => {
  const user = authUser(req, res); if (!user) return;
  const u = loadUser(user.id);
  const r = Chest.open(u);
  if (!r.ok) return res.status(409).json({ error: r.reason, ...stateOf(u) });
  if (r.reward.coins)  u.coins += r.reward.coins;
  if (r.reward.energy) Energy.add(u, r.reward.energy);
  Audit.log('chest_open', { userId: u.id, reward: r.reward });
  db.saveUser(u);
  res.json({ reward: r.reward, ...stateOf(u) });
});

// Купить бустер для текущей игры. Цена — в монетах ИЛИ в энергии.
app.post('/api/buy-booster', (req, res) => {
  const user = authUser(req, res); if (!user) return;
  const u = loadUser(user.id);
  Energy.sync(u);
  const item = (req.body && req.body.item) || '';
  const b = C.boosters[item];
  if (!b) return res.status(400).json({ error: 'bad_item' });
  if (b.energy) {
    if (u.energy < b.energy) return res.status(402).json({ error: 'no_energy', ...stateOf(u) });
    Energy.spend(u, b.energy);
  } else {
    if (u.coins < b.coins) return res.status(402).json({ error: 'no_coins', ...stateOf(u) });
    u.coins -= b.coins;
  }
  Audit.log('booster_buy', { userId: u.id, item, coinsLeft: u.coins, energyLeft: u.energy });
  db.saveUser(u);
  res.json({ ...stateOf(u), effect: b.effect });
});

// Купить косметический скин за монеты (сервер-authority)
app.post('/api/buy-skin', (req, res) => {
  const user = authUser(req, res); if (!user) return;
  const u = loadUser(user.id);
  const skinId = (req.body && req.body.skinId) || '';
  const skin = C.skins && C.skins[skinId];
  if (!skin) return res.status(400).json({ error: 'bad_skin' });
  if (!u.ownedSkins) u.ownedSkins = ['classic'];
  if (u.ownedSkins.includes(skinId)) {
    return res.status(409).json({ error: 'already_owned', ...stateOf(u) });
  }
  if (u.coins < skin.price) {
    return res.status(402).json({ error: 'no_coins', ...stateOf(u) });
  }
  u.coins -= skin.price;
  u.ownedSkins.push(skinId);
  Audit.log('skin_buy', { userId: u.id, skinId, price: skin.price, coinsLeft: u.coins });
  db.saveUser(u);
  res.json({ ok: true, ...stateOf(u) });
});

// TON-оплата: конфиг пакетов + генерация комментария для перевода
app.post('/api/ton/packages', (req, res) => {
  const user = authUser(req, res); if (!user) return;
  const u = loadUser(user.id);
  const packages = (C.ton.packages || []).map((p) => ({
    id: p.id, priceTon: p.priceTon, energy: p.energy || 0,
    coins: p.coins || 0, bonus: p.bonus || '',
  }));
  res.json({ packages, receiver: C.ton.receiver, comment: 'u' + u.id.replace(/[^0-9a-zA-Z]/g,'') });
});

// TON-оплата: верификация транзакции и начисление награды
// Мьютекс на юзера: между findPayment (async) и записью в processedTonTx
// не должно проходить второго запроса с той же tx.
const _tonInflight = new Set();
app.post('/api/ton/verify', async (req, res) => {
  const user = authUser(req, res); if (!user) return;
  if (_tonInflight.has(user.id)) {
    return res.status(429).json({ error: 'verify_inflight' });
  }
  _tonInflight.add(user.id);
  try {
  const u = loadUser(user.id);
  const packageId = (req.body && req.body.packageId) || '';
  const pkg = (C.ton.packages || []).find((p) => p.id === packageId);
  if (!pkg) return res.status(400).json({ error: 'bad_package' });
  if (!C.ton.receiver) return res.status(500).json({ error: 'receiver_not_configured' });

  // Комментарий, который игрок должен указать при переводе: u<userId>:<pkg>
  const cleanUid = u.id.replace(/[^0-9a-zA-Z]/g, '');
  const comment = 'u' + cleanUid + ':' + pkg.id;

  try {
    const tx = await Ton.findPayment(comment, pkg.priceTon, C.ton.maxAgeSec);
    if (!tx) return res.status(202).json({ error: 'not_found_yet', comment, retry: true });

    // Идемпотентность: одна транзакция начисляется один раз
    if (!u.tonProcessed) u.tonProcessed = {};
    if (u.tonProcessed[tx.hash]) {
      return res.status(200).json({ error: 'already_processed', ...stateOf(u) });
    }
    u.tonProcessed[tx.hash] = { pkg: pkg.id, at: Date.now(), amount: tx.amountTon };

    // Начисляем награду
    if (pkg.energy) Energy.add(u, pkg.energy);
    if (pkg.coins)  u.coins += pkg.coins;

    Audit.log('ton_credit', { userId: u.id, pkg: pkg.id, hash: tx.hash, ton: tx.amountTon });
    db.saveUser(u);
    res.json({ ok: true, reward: { energy: pkg.energy || 0, coins: pkg.coins || 0 }, ...stateOf(u) });
  } catch (e) {
    console.error('[ton/verify]', e.message);
    Alerts.report('ton_verify_error', { userId: u.id, err: e.message });
    res.status(502).json({ error: 'verify_failed' });
  }
  } finally {
    _tonInflight.delete(user.id);
  }
});

// Забрать ежедневную награду
app.post('/api/daily/claim', (req, res) => {
  const user = authUser(req, res); if (!user) return;
  const u = loadUser(user.id);
  const r = Daily.claim(u);
  if (!r.ok) return res.status(409).json({ error: r.reason, ...stateOf(u) });
  u.coins += r.reward.coins || 0;
  if (r.reward.energy) Energy.add(u, r.reward.energy);
  Audit.log('daily_claim', { userId: u.id, streak: u.daily && u.daily.streak, reward: r.reward });
  db.saveUser(u);
  res.json({ reward: r.reward, ...stateOf(u) });
});

// Покупка за монеты: refillOne | refillFull | maxUpgrade
app.post('/api/buy', (req, res) => {
  const user = authUser(req, res); if (!user) return;
  const u = loadUser(user.id);
  Energy.sync(u);

  const item = (req.body && req.body.item) || '';
  if (item === 'refillOne') {
    if (u.energy >= u.max) return res.status(409).json({ error: 'already_full', ...stateOf(u) });
    const price = refillPrice(u, 'refillOne');
    if (u.coins < price) return res.status(402).json({ error: 'no_coins', ...stateOf(u) });
    u.coins -= price; Energy.add(u, 1); bumpShopCount(u, 'refillOne');
  } else if (item === 'refillFull') {
    if (u.energy >= u.max) return res.status(409).json({ error: 'already_full', ...stateOf(u) });
    const price = refillPrice(u, 'refillFull');
    if (u.coins < price) return res.status(402).json({ error: 'no_coins', ...stateOf(u) });
    u.coins -= price; u.energy = u.max; u.energy_ts = Date.now(); bumpShopCount(u, 'refillFull');
  } else if (item === 'maxUpgrade') {
    if (u.max >= C.shop.maxUpgrade.maxCap) return res.status(409).json({ error: 'max_cap', ...stateOf(u) });
    const price = nextMaxUpgradeCost(u);
    if (u.coins < price) return res.status(402).json({ error: 'no_coins', ...stateOf(u) });
    u.coins -= price; u.max += 1; Energy.add(u, 1);   // апгрейд + 1 свободная попытка
  } else {
    return res.status(400).json({ error: 'bad_item' });
  }

  Audit.log('shop_buy', { userId: u.id, item, coinsLeft: u.coins, energy: u.energy, max: u.max });
  db.saveUser(u);
  res.json(stateOf(u));
});

/**
 * Проверить и выдать отложенную реферальную награду. Условия:
 *  1) У игрока есть referrer (пришёл по ссылке)
 *  2) Ещё не обработан (referrer_processed=false)
 *  3) Сыграл >= referral.minGamesToUnlock партий
 *  4) С момента referrer_since прошло не больше referral.maxDaysToUnlock дней
 * После разблокировки — начисляет монеты обоим и помечает processed.
 */
function checkReferralUnlock(u) {
  if (!u.referrer || u.referrer_processed) return;
  const games = (u.stats && u.stats.gamesPlayed) || 0;
  if (games < C.referral.minGamesToUnlock) return;
  const days = (Date.now() - (u.referrer_since || 0)) / 86400000;
  if (days > C.referral.maxDaysToUnlock) {
    // Дедлайн истёк — блокируем навсегда, чтобы не пытался ещё
    u.referrer_processed = true; return;
  }
  const ref = db.getUser(u.referrer);
  if (!ref) { u.referrer_processed = true; return; }
  u.coins += C.referral.coinsReferee;
  ref.coins += C.referral.coinsReferrer;
  u.referrer_processed = true;
  u.pendingReferralNotice = { coins: C.referral.coinsReferee };
  ref.pendingReferralNotice = { coins: C.referral.coinsReferrer, fromReferee: true };
  Audit.log('referral_unlocked', { referee: u.id, referrer: ref.id, gamesPlayed: (u.stats||{}).gamesPlayed });
  db.saveUser(ref);
}

function clampInt(v, min, max) {
  v = parseInt(v, 10);
  if (Number.isNaN(v)) return min;
  return Math.max(min, Math.min(max, v));
}

// SPA-фолбэк на index.html для прочих GET
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'webapp', 'index.html'));
});

// Safety-gate: если запущено под NODE_ENV=production, не даём стартовать
// с опасной конфигурацией (dev-режим без BOT_TOKEN или без CORS_ORIGIN).
if (process.env.NODE_ENV === 'production') {
  const errs = [];
  if (C.devMode)     errs.push('BOT_TOKEN не задан → каждый может представиться любым devUserId');
  if (!C.corsOrigin) errs.push('CORS_ORIGIN не задан → API открыт для любого origin');
  if (C.ton && !C.ton.receiver) console.warn('[server] TON_RECEIVER не задан — TON-оплата отключена');
  if (errs.length) {
    console.error('[FATAL] прод-конфигурация небезопасна:\n  - ' + errs.join('\n  - '));
    process.exit(2);
  }
}

app.listen(C.port, () => {
  console.log(`Match-3 server on :${C.port}` + (C.devMode
    ? '  [DEV MODE — initData НЕ проверяется, задай BOT_TOKEN для продакшна]'
    : ''));
});

// Запуск Telegram-бота (если заданы BOT_TOKEN и WEBAPP_URL)
require('./bot').start();

// Автобэкап data.json / data.sqlite раз в сутки. Хранит 30 копий.
const BACKUP_DIR = process.env.BACKUP_DIR || pathMod.join(__dirname, 'backups');
try { fs.mkdirSync(BACKUP_DIR, { recursive: true }); } catch (_) {}
function runBackup() {
  try {
    const useSqlite = db._driver === 'sqlite';
    const date = new Date().toISOString().slice(0, 10);
    const dst = pathMod.join(BACKUP_DIR, `data-${date}.${useSqlite ? 'sqlite' : 'json'}`);
    if (useSqlite && db.backup) {
      // Онлайн-бэкап через SQLite backup API (учитывает WAL)
      db.backup(dst).catch((e) => console.error('[backup] sqlite failed:', e.message));
    } else {
      const src = process.env.DB_PATH || pathMod.join(__dirname, 'data.json');
      if (!fs.existsSync(src)) return;
      fs.copyFileSync(src, dst);
    }
    // ротация: старше 30 дней удаляем
    const cutoff = Date.now() - 30 * 86400000;
    fs.readdirSync(BACKUP_DIR).forEach((f) => {
      const full = pathMod.join(BACKUP_DIR, f);
      try { if (fs.statSync(full).mtimeMs < cutoff) fs.unlinkSync(full); } catch (_) {}
    });
  } catch (e) { console.error('[backup] failed:', e.message); }
}
setInterval(runBackup, 24 * 60 * 60 * 1000).unref();
runBackup(); // разовый прогон на старте
