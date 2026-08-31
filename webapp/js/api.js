/*
 * Клиент серверного API. Каждый запрос несёт Telegram initData —
 * сервер по нему проверяет подпись и узнаёт игрока. Если игра открыта
 * не в Telegram (обычный браузер/превью), передаём devUserId — сервер
 * примет его только в DEV-режиме.
 */
window.API = (() => {
  const tg = window.Telegram && window.Telegram.WebApp;
  const initData = (tg && tg.initData) || '';
  // стабильный dev-идентификатор для отладки вне Telegram
  let devUserId = '';
  if (!initData) {
    devUserId = localStorage.getItem('m3_dev_uid') || ('u' + Math.random().toString(36).slice(2, 10));
    localStorage.setItem('m3_dev_uid', devUserId);
  }

  const CLIENT_VERSION = (window.CONFIG && window.CONFIG.clientVersion) || 80;

  async function post(path, body) {
    const res = await fetch(path, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Client-Version': String(CLIENT_VERSION),
      },
      body: JSON.stringify({ initData, devUserId, ...(body || {}) }),
    });
    const data = await res.json().catch(() => ({}));
    if (res.status === 426) {
      // Клиент устарел — заставим обновиться
      if (!window.__upgradeShown) {
        window.__upgradeShown = true;
        alert('Вышла новая версия игры. Обнови страницу (Ctrl+F5).');
        setTimeout(() => location.reload(true), 500);
      }
      throw Object.assign(new Error('upgrade_required'), { status: 426, data });
    }
    if (!res.ok) {
      throw Object.assign(new Error(data.error || 'request_failed'), { status: res.status, data });
    }
    return data;
  }

  return {
    state: () => post('/api/state'),
    play: () => post('/api/play'),
    end: (result) => post('/api/end', result),
    buy: (item) => post('/api/buy', { item }),
    buyBooster: (item) => post('/api/buy-booster', { item }),
    leaderboard: (limit) => post('/api/leaderboard', { limit }),
    dailyClaim: () => post('/api/daily/claim'),
    chestOpen: () => post('/api/chest/open'),
    tonPackages: () => post('/api/ton/packages'),
    tonVerify: (packageId) => post('/api/ton/verify', { packageId }),
    buySkin: (skinId) => post('/api/buy-skin', { skinId }),
  };
})();
