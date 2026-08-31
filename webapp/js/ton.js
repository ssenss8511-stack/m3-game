/*
 * Клиент TON-оплаты. Использует TON Connect UI SDK (внешний скрипт).
 * Флоу:
 *   1) getPackages() из сервера — список пакетов и адрес приёмника
 *   2) buy(packageId) — открывает кошелёк для подписи транзакции
 *   3) verify(packageId) — сервер проверяет транзакцию в TON и начисляет
 *
 * Требования: window.CONFIG.botUsername должен быть настоящим, а сервер
 * должен раздавать /tonconnect-manifest.json (см. webapp/tonconnect-manifest.json).
 */
window.Ton = (() => {
  let ui = null;

  function init() {
    if (ui || !window.TON_CONNECT_UI) return ui;
    try {
      const manifestUrl = location.origin + '/tonconnect-manifest.json';
      ui = new TON_CONNECT_UI.TonConnectUI({ manifestUrl });
    } catch (e) { console.warn('[ton] init failed:', e); }
    return ui;
  }

  async function getPackages() { return API.tonPackages(); }

  /**
   * Открыть кошелёк для оплаты пакета. Возвращает { boc } если подписано.
   * После этого нужно вызвать verify(pkgId).
   */
  async function buy(pkg, receiver, comment) {
    const u = init();
    if (!u) throw new Error('TON Connect not loaded');
    // Если кошелёк не подключён — предложить подключить
    if (!u.connected) await u.openModal();
    const tx = {
      validUntil: Math.floor(Date.now() / 1000) + 600,   // 10 мин на подпись
      messages: [{
        address: receiver,
        amount: String(Math.floor(pkg.priceTon * 1e9)),  // в наноТОН
        payload: await encodeComment(comment),
      }],
    };
    const result = await u.sendTransaction(tx);
    return result;   // { boc: '...' }
  }

  // Text-comment payload = BoC cell {uint32 op=0; string text}
  // Собирается через TonWeb, чтобы не изобретать сериализацию BoC.
  async function encodeComment(text) {
    if (!window.TonWeb) throw new Error('TonWeb SDK not loaded');
    const cell = new TonWeb.boc.Cell();
    cell.bits.writeUint(0, 32);
    cell.bits.writeString(text);
    const boc = await cell.toBoc(false);
    return TonWeb.utils.bytesToBase64(boc);
  }

  async function verify(packageId) {
    return API.tonVerify(packageId);
  }

  return { init, getPackages, buy, verify };
})();
