/*
 * Поведенческий анализатор — детектит скриптованные партии и AI-ботов.
 *
 * Идея: настоящий игрок имеет неровный ритм (задумывается, ошибается,
 * бустится), а бот либо слишком регулярен (setInterval), либо слишком
 * шумен (uniform random). Мы считаем несколько дешёвых метрик и получаем
 * `humanLikeness` в [0..1]. Дальше сервер:
 *   - копит `u.suspicion` (экспоненциально затухает)
 *   - при подозрительности выше threshold → shadow-cap (не блок, чтобы не
 *     раскрывать логику детектора), с логом и алертом
 *
 * Метрики:
 *   - CV (coeff. of variation) интервалов между ходами. Люди: 0.3–1.2.
 *     Слишком ровный (< 0.15) или слишком шумный (> 2.0) — подозрительно.
 *   - Доля «мгновенных» ходов (< 300 мс) — у людей ≤ 15%, у ботов часто > 40%.
 *   - Uniformity последнего десятка мс интервала (chi²) — скриптовые
 *     таймеры выдают узкую полосу; у людей — размазано.
 *   - Циркадный флаг: если у юзера >5 партий подряд в одни и те же ночные
 *     часы (00:00–06:00 по TG часовому поясу) — флаг.
 */
'use strict';

function mean(arr) { return arr.reduce((a, b) => a + b, 0) / arr.length; }
function stddev(arr, m) {
  const mm = m == null ? mean(arr) : m;
  return Math.sqrt(arr.reduce((a, b) => a + (b - mm) * (b - mm), 0) / arr.length);
}

/**
 * @param moveLog массив {t: ms относительное} длины ≥ 3
 * @returns { humanLikeness, flags, stats }
 */
function analyzeMoveLog(moveLog) {
  if (!Array.isArray(moveLog) || moveLog.length < 3) {
    return { humanLikeness: 0.7, flags: ['insufficient_data'], stats: {} };
  }
  // Интервалы между ходами
  const dt = [];
  for (let i = 1; i < moveLog.length; i++) dt.push(moveLog[i].t - moveLog[i - 1].t);
  const mu = mean(dt);
  const sd = stddev(dt, mu);
  const cv = mu > 0 ? sd / mu : 0;
  const fastCount = dt.filter((x) => x < 300).length;
  const fastRatio = fastCount / dt.length;

  // Chi² на последнюю цифру интервала — детектор фиксированного таймера
  const buckets = new Array(10).fill(0);
  for (const x of dt) buckets[Math.abs(x) % 10]++;
  const exp = dt.length / 10;
  const chi = buckets.reduce((a, b) => a + (b - exp) * (b - exp) / exp, 0);
  // Порог для df=9, p=0.05 ≈ 16.9; > 25 очень подозрительно
  const chiFlag = chi > 25;

  const flags = [];
  let human = 1.0;
  if (cv < 0.15) { flags.push('too_regular'); human -= 0.5; }
  else if (cv > 2.0) { flags.push('too_random'); human -= 0.3; }
  if (fastRatio > 0.4) { flags.push('too_many_fast_moves'); human -= 0.35; }
  if (chiFlag) { flags.push('nonuniform_timer'); human -= 0.25; }
  // Все интервалы одинаковые с точностью до 20мс → скриптовый таймер
  const uniqRounded = new Set(dt.map((x) => Math.round(x / 20))).size;
  if (uniqRounded <= 3 && dt.length >= 5) { flags.push('few_unique_intervals'); human -= 0.4; }

  human = Math.max(0, Math.min(1, human));
  return {
    humanLikeness: human,
    flags,
    stats: { n: dt.length, mean: Math.round(mu), sd: Math.round(sd), cv: +cv.toFixed(2),
             fastRatio: +fastRatio.toFixed(2), chi: +chi.toFixed(1), uniqBuckets: uniqRounded },
  };
}

/**
 * Обновляет u.suspicion экспоненциальной моделью (медленно затухает,
 * быстро растёт от плохих партий). Возвращает новое значение [0..10].
 *
 * @param u user object
 * @param humanLikeness 0..1 из analyzeMoveLog
 */
function updateSuspicion(u, humanLikeness) {
  // Половина за 7 дней
  const halfLife = 7 * 24 * 60 * 60 * 1000;
  const now = Date.now();
  const prev = u.suspicion || 0;
  const prevAt = u.suspicion_at || now;
  const decay = Math.pow(0.5, (now - prevAt) / halfLife);
  const decayed = prev * decay;
  // 1.0 humanLikeness → нулевой прирост; 0.0 → +2.0
  const delta = (1 - humanLikeness) * 2;
  const next = Math.min(10, decayed + delta);
  u.suspicion = next;
  u.suspicion_at = now;
  return next;
}

/**
 * Циркадный флаг: если у юзера последние N подряд игры в ночные часы,
 * инкрементим `u.nightRuns`. Не блокирует ничего, только флаг для алертов.
 */
function updateCircadian(u) {
  const h = new Date().getUTCHours();
  const night = h >= 0 && h < 6; // UTC ночь — грубая эвристика
  if (night) u.nightRuns = (u.nightRuns || 0) + 1;
  else u.nightRuns = 0;
  return u.nightRuns;
}

module.exports = { analyzeMoveLog, updateSuspicion, updateCircadian };
