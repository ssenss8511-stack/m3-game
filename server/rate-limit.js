// Простой in-memory rate-limiter — окно + счётчик на ключ (обычно userId).
// Хватает для одиночного сервера. При масштабировании — заменить на Redis.

const buckets = new Map();  // key → [timestamps]

/** @returns {true} если можно, {false} если превышен лимит. */
function check(key, limit, windowMs) {
  const now = Date.now();
  const arr = (buckets.get(key) || []).filter((t) => now - t < windowMs);
  if (arr.length >= limit) { buckets.set(key, arr); return false; }
  arr.push(now);
  buckets.set(key, arr);
  return true;
}

// Периодическая чистка пустых ключей раз в 5 мин
setInterval(() => {
  const now = Date.now();
  for (const [k, arr] of buckets) {
    const alive = arr.filter((t) => now - t < 3600000);
    if (alive.length === 0) buckets.delete(k);
    else buckets.set(k, alive);
  }
}, 5 * 60 * 1000).unref();

/** Express-мидлварь: 60 req/min на пользователя (по auth). */
function middleware(limit = 60, windowMs = 60000) {
  return (req, res, next) => {
    const uid = req.userId || req.ip;
    if (!check(uid, limit, windowMs)) {
      return res.status(429).json({ error: 'too_many_requests' });
    }
    next();
  };
}

module.exports = { check, middleware };
