// TON-оплата: проверка входящих транзакций через toncenter.com.
//
// Как работает:
//  1. Игрок в UI жмёт «Купить пакет за TON» → выбирается пакет
//  2. TON Connect открывает кошелёк, игрок подписывает перевод N TON
//     на C.ton.receiver с ТЕКСТОМ комментария = user.id + пакет
//  3. Клиент шлёт POST /api/ton/verify с { boc, packageId }
//  4. Сервер вытаскивает txHash, ждёт индексацию, ищет транзакцию
//     на приёмнике с этим комментарием и суммой
//  5. Если валидна и ещё не обработана — начисляем игроку награду
//
// ВАЖНО: сервер — источник правды. НЕ верим клиенту про сумму / статус.

const https = require('https');
const C = require('./config');

const TONCENTER_BASE = process.env.TONCENTER_URL || 'https://toncenter.com/api/v2';
const API_KEY = process.env.TONCENTER_API_KEY || '';

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    const opts = API_KEY ? { headers: { 'X-API-Key': API_KEY } } : {};
    https.get(url, opts, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
        catch (e) { reject(e); }
      });
    }).on('error', reject);
  });
}

/**
 * Получить последние N транзакций на адрес-приёмник.
 * Возвращает массив нормализованных транзакций.
 */
async function getIncoming(address, limit = 50) {
  const url = `${TONCENTER_BASE}/getTransactions?address=${encodeURIComponent(address)}&limit=${limit}&archival=true`;
  const { body } = await fetchJson(url);
  if (!body || !body.ok || !Array.isArray(body.result)) return [];
  return body.result
    .filter((t) => t.in_msg && t.in_msg.value && parseInt(t.in_msg.value, 10) > 0)
    .map((t) => ({
      hash: t.transaction_id && t.transaction_id.hash,
      lt: t.transaction_id && t.transaction_id.lt,
      from: t.in_msg.source,
      amountNano: parseInt(t.in_msg.value, 10),
      amountTon: parseInt(t.in_msg.value, 10) / 1e9,
      comment: (t.in_msg.message || '').trim(),
      utime: t.utime,
    }));
}

/**
 * Проверить платёж по комментарию. Возвращает найденную tx или null.
 * @param comment ожидаемый текст комментария (напр. "u123:p1")
 * @param minTon минимальная сумма в TON (учитываем ±0.01 на комиссии)
 * @param maxAgeSec транзакция должна быть не старше N секунд
 */
async function findPayment(comment, minTon, maxAgeSec = 3600) {
  if (!C.ton || !C.ton.receiver) return null;
  const now = Math.floor(Date.now() / 1000);
  const txs = await getIncoming(C.ton.receiver, 50);
  for (const t of txs) {
    if (now - t.utime > maxAgeSec) continue;
    if (t.comment !== comment) continue;
    if (t.amountTon + 0.001 < minTon) continue; // допускаем небольшой недобор из-за комиссии
    return t;
  }
  return null;
}

module.exports = { findPayment, getIncoming };
