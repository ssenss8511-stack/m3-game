/*
 * Управление скинами. Источник правды по владению — сервер (Store.ownedSkins).
 * localStorage используется как кэш активного скина (косметика) и как
 * фолбэк-owned для офлайн-превью.
 *
 * Классик всегда доступен.
 */
window.Skins = (() => {
  const LIST = window.CONFIG.skins || [];
  const KEY_OWNED  = 'm3_skins_owned';   // офлайн-кэш
  const KEY_ACTIVE = 'm3_skin';

  function owned() {
    // 1. Сервер (Store) — приоритет
    if (window.Store && window.Store.ownedSkins) {
      const arr = window.Store.ownedSkins.slice();
      if (!arr.includes('classic')) arr.push('classic');
      // Отзеркалим в localStorage, чтобы офлайн UI знал
      try { localStorage.setItem(KEY_OWNED, JSON.stringify(arr)); } catch (_) {}
      return arr;
    }
    // 2. Фолбэк — локальный кэш
    let arr = [];
    try { arr = JSON.parse(localStorage.getItem(KEY_OWNED) || '[]'); } catch (_) {}
    if (!arr.includes('classic')) arr.push('classic');
    return arr;
  }
  function active() { return localStorage.getItem(KEY_ACTIVE) || 'classic'; }
  function apply(id) {
    document.documentElement.setAttribute('data-skin', id);
    localStorage.setItem(KEY_ACTIVE, id);
  }
  function isOwned(id) { return owned().includes(id); }
  function list() { return LIST; }
  function get(id) { return LIST.find((s) => s.id === id); }

  // Применить активный скин сразу при загрузке скрипта
  apply(active());

  return { list, get, owned, active, apply, isOwned };
})();
