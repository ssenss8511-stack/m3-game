// Проверка подлинности данных Telegram Mini App (initData).
// По спецификации: https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app
const crypto = require('crypto');

/**
 * Проверяет подпись initData и возвращает объект user ({id, ...}) или null.
 * @param {string} initData  сырая строка window.Telegram.WebApp.initData
 * @param {string} botToken  токен бота
 * @param {number} maxAgeSec максимально допустимый возраст auth_date
 */
function validate(initData, botToken, maxAgeSec) {
  if (!initData || !botToken) return null;

  const params = new URLSearchParams(initData);
  const hash = params.get('hash');
  if (!hash) return null;
  params.delete('hash');

  // data_check_string: "key=value" по всем полям, отсортированы, через \n
  const dataCheckString = [...params.entries()]
    .map(([k, v]) => `${k}=${v}`)
    .sort()
    .join('\n');

  // secret_key = HMAC_SHA256(key="WebAppData", data=botToken)
  const secretKey = crypto.createHmac('sha256', 'WebAppData').update(botToken).digest();
  const computed = crypto.createHmac('sha256', secretKey).update(dataCheckString).digest('hex');

  // Сравнение в постоянном времени
  const a = Buffer.from(computed, 'hex');
  const b = Buffer.from(hash, 'hex');
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;

  // Свежесть
  if (maxAgeSec) {
    const authDate = parseInt(params.get('auth_date') || '0', 10);
    if (!authDate || Date.now() / 1000 - authDate > maxAgeSec) return null;
  }

  try {
    const user = JSON.parse(params.get('user') || 'null');
    return user && user.id != null ? user : null;
  } catch (_) {
    return null;
  }
}

module.exports = { validate };
