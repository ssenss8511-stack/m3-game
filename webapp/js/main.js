/*
 * Связующий слой: Telegram WebApp, экраны, HUD, магазин (заглушка).
 *
 * Энергия / монеты / рекорд теперь СЕРВЕРНЫЕ — клиент только отображает
 * состояние из Store (api.js → /api/*). Награды за спец-фишки клиент
 * копит за игру и отправляет на сервер в конце (/api/end), где они
 * обрезаются лимитами. Накрутить попытки через localStorage больше нельзя.
 */
(() => {
  const C = window.CONFIG;
  const tg = window.Telegram && window.Telegram.WebApp;

  if (tg) {
    tg.ready();
    tg.expand();
    document.documentElement.classList.add('in-telegram');
  }

  const $ = (id) => document.getElementById(id);
  const els = {
    energyValue: $('energyValue'), energyMax: $('energyMax'), energyTimer: $('energyTimer'),
    scoreValue: $('scoreValue'), movesValue: $('movesValue'), coinsValue: $('coinsValue'),
    startOverlay: $('startOverlay'), startHint: $('startHint'), playBtn: $('playBtn'),
    noEnergyOverlay: $('noEnergyOverlay'), bigTimer: $('bigTimer'),
    buyBtn: $('buyBtn'), closeNoEnergy: $('closeNoEnergy'),
    endOverlay: $('endOverlay'), endScore: $('endScore'), endBest: $('endBest'),
    againBtn: $('againBtn'), endMenuBtn: $('endMenuBtn'), shareScoreBtn: $('shareScoreBtn'),
    shopOverlay: $('shopOverlay'), shopList: $('shopList'), closeShop: $('closeShop'),
    coinShopOverlay: $('coinShopOverlay'), coinShopList: $('coinShopList'),
    coinShopBalance: $('coinShopBalance'),
    coinShopBtn: $('coinShopBtn'), coinShopBtn2: $('coinShopBtn2'), closeCoinShop: $('closeCoinShop'),
    boosterBar: $('boosterBar'),
    boosterMoves: $('boosterMoves'), boosterMovesEnergy: $('boosterMovesEnergy'),
    boosterShuffle: $('boosterShuffle'), boosterBomb: $('boosterBomb'),
    bMoves5Price: $('bMoves5Price'), bShufflePrice: $('bShufflePrice'), bBombPrice: $('bBombPrice'),
    questsBtn: $('questsBtn'), questsOverlay: $('questsOverlay'),
    questList: $('questList'), closeQuests: $('closeQuests'),
    skinsBtn: $('skinsBtn'), skinsOverlay: $('skinsOverlay'),
    skinsList: $('skinsList'), closeSkins: $('closeSkins'),
    leaderboardBtn: $('leaderboardBtn'), leaderboardOverlay: $('leaderboardOverlay'),
    lbList: $('lbList'), lbMe: $('lbMe'), closeLeaderboard: $('closeLeaderboard'),
    achBtn: $('achBtn'), achOverlay: $('achOverlay'), achList: $('achList'), closeAch: $('closeAch'),
    inviteBtn: $('inviteBtn'),
    soundToggle: $('soundToggle'), soundIcon: $('soundIcon'),
    themeToggle: $('themeToggle'), themeIcon: $('themeIcon'),
    exitGameBtn: $('exitGameBtn'),
    helpBtn: $('helpBtn'),
    profileBtn: $('profileBtn'), profileOverlay: $('profileOverlay'),
    profileName: $('profileName'), profileLevel: $('profileLevel'),
    profileXpFill: $('profileXpFill'), profileXpText: $('profileXpText'),
    profileStats: $('profileStats'), closeProfile: $('closeProfile'),
    tutorialOverlay: $('tutorialOverlay'), tutTitle: $('tutTitle'), tutText: $('tutText'),
    tutArt: $('tutArt'), tutDots: $('tutDots'),
    tutNextBtn: $('tutNextBtn'), tutSkipBtn: $('tutSkipBtn'),
    eventBanner: $('eventBanner'), weeklyQuestBox: $('weeklyQuestBox'),
    xpLevel: $('xpLevel'), xpText: $('xpText'), xpBarFill: $('xpBarFill'),
    dailyBtn: $('dailyBtn'), dailyBtnSub: $('dailyBtnSub'),
    chestBtn: $('chestBtn'), chestBtnSub: $('chestBtnSub'),
    chestOverlay: $('chestOverlay'), chestArt: $('chestArt'),
    chestReward: $('chestReward'), chestSub: $('chestSub'),
    openChestBtn: $('openChestBtn'), closeChest: $('closeChest'),
    dailyOverlay: $('dailyOverlay'), dailyGrid: $('dailyGrid'),
    dailyStreak: $('dailyStreak'), dailyClaimBtn: $('dailyClaimBtn'),
    dailyHint: $('dailyHint'), dailyCloseBtn: $('dailyCloseBtn'),
    board: $('board'),
  };

  const show = (el) => el.classList.remove('hidden');
  const hide = (el) => el.classList.add('hidden');
  function fmt(ms) {
    const s = Math.ceil(ms / 1000);
    const m = Math.floor(s / 60), ss = s % 60;
    return `${m}:${String(ss).padStart(2, '0')}`;
  }

  let sessionGain = { coins: 0, energy: 0 }; // награды за текущую игру (до отправки)
  let starting = false;

  // --- Всплывающие награды ---
  let toastWrap;
  function toast(text) {
    if (!toastWrap) {
      toastWrap = document.createElement('div');
      toastWrap.id = 'toastWrap';
      els.board.parentElement.appendChild(toastWrap);
    }
    const t = document.createElement('div');
    t.className = 'toast';
    t.textContent = text;
    toastWrap.appendChild(t);
    setTimeout(() => t.remove(), 1900);
  }

  // --- HUD ---
  function refreshEnergy() {
    els.energyMax.textContent = Store.max;
    els.energyValue.textContent = Store.energy;
    const ms = Store.msToNext();
    els.energyTimer.textContent = (Store.energy < Store.max && ms > 0) ? '⏳ ' + fmt(ms) : '';
    els.startHint.textContent = Store.energy > 0
      ? ''
      : 'Попытки закончились — подожди или пополни в магазине.';
    if (!els.noEnergyOverlay.classList.contains('hidden')) els.bigTimer.textContent = fmt(Store.msToNext());
  }
  function refreshCoins() {
    // во время игры показываем оптимистично: серверные + собранные
    els.coinsValue.textContent = Store.coins + sessionGain.coins;
    if (els.boosterBar && !els.boosterBar.classList.contains('hidden')) updateBoosterUI();
  }

  // --- Награда за спец-фишку (копим, отправим на сервер в конце игры) ---
  function applyReward(special, count) {
    const r = special.reward;
    let text = '';
    if (r.coinsPerGem) {
      const amt = r.coinsPerGem * count;
      sessionGain.coins += amt; text = '+' + amt + ' монет';
    } else if (r.energyPer3) {
      const amt = r.energyPer3 * Math.floor(count / 3);
      if (amt > 0) { sessionGain.energy += amt; text = '⚡ +' + amt + ' попытка'; }
    } else if (r.mystery) {
      const times = Math.max(1, Math.floor(count / 3));
      for (let i = 0; i < times; i++) {
        const opts = [{ coins: 10 }, { coins: 20 }, { energy: 1 }];
        const p = opts[Math.floor(Math.random() * opts.length)];
        if (p.coins) { sessionGain.coins += p.coins; text = '🎁 +' + p.coins + ' монет'; }
        if (p.energy) { sessionGain.energy += p.energy; text = '🎁 +' + p.energy + ' попытка'; }
      }
    }
    if (text) toast(text);
    refreshCoins();
    // звук — всегда; для энергии звук «достижения», для денег «награда»
    if (r.energyPer3) Snd.achievement(); else Snd.reward();
    // монетки летят в HUD от первой найденной gem-фишки этого спецтипа
    if (r.coinsPerGem || r.mystery) {
      const src = els.board.querySelector('.gem.' + special.id) || els.board.querySelector('.gem');
      flyCoins(src, Math.min(8, Math.max(3, count)));
    }
    haptic('light');
  }

  // --- Игра ---
  Game.init(els.board, {
    onUpdate: ({ score, moves }) => {
      els.scoreValue.textContent = score;
      els.movesValue.textContent = moves;
    },
    onCollect: (special, count) => applyReward(special, count),
    onMatch: (combo) => {
      if (combo === 1) Snd.match(); else Snd.combo(combo);
    },
    onShuffle: () => { toast('Ходов нет — поле перемешано'); Snd.click(); },
    onEnd: (result) => endGame(result),
  });

  async function endGame(result) {
    const score = result && typeof result === 'object' ? result.score : result;
    const matches = (result && result.matches) || 0;
    const maxCombo = (result && result.maxCombo) || 0;
    const gained = sessionGain;
    sessionGain = { coins: 0, energy: 0 };
    els.endScore.textContent = score;
    els.endBest.textContent = 'Рекорд: …';
    show(els.endOverlay);
    haptic('success');
    Snd.end();
    hide(els.boosterBar);
    hide(els.exitGameBtn);

    const moveLog = (Game.getMoveLog && Game.getMoveLog()) || [];
    const r = await Store.end({ score, coins: gained.coins, energy: gained.energy, matches, maxCombo, moveLog });

    const parts = [];
    if (gained.coins) parts.push(gained.coins + ' монет');
    if (gained.energy) parts.push('⚡ ' + gained.energy);
    els.endBest.textContent = 'Рекорд: ' + Store.best + (parts.length ? '  ·  собрано ' + parts.join(', ') : '');
    refreshEnergy();
    refreshCoins();
    refreshChestBtn();
    refreshXp();
    if (r && r.levelUps && r.levelUps.length) {
      r.levelUps.forEach((up, i) => {
        const rwd = [];
        if (up.reward.coins)  rwd.push('+' + up.reward.coins + ' монет');
        if (up.reward.energy) rwd.push('⚡ +' + up.reward.energy);
        setTimeout(() => { toast(`⬆ Уровень ${up.level}! ` + rwd.join(', ')); Snd.achievement(); bumpXp(); },
          1800 + i * 800);
      });
    }

    // Показать тосты о новых ачивках
    if (r && r.unlocked && r.unlocked.length) {
      r.unlocked.forEach((a, i) => {
        setTimeout(() => { toast('🏆 ' + a.title); Snd.achievement(); }, 600 + i * 800);
      });
    }
    // Тост по выполненному недельному квесту
    if (r && r.weeklyReward) {
      const parts = [];
      if (r.weeklyReward.reward.coins)  parts.push('+' + r.weeklyReward.reward.coins + ' монет');
      if (r.weeklyReward.reward.energy) parts.push('⚡ +' + r.weeklyReward.reward.energy);
      setTimeout(() => { toast('⭐ Недельный вызов: ' + parts.join(', ')); Snd.achievement(); }, 1000);
    }
    // Тосты по выполненным дневным целям
    if (r && r.questsDone && r.questsDone.length) {
      r.questsDone.forEach((q, i) => {
        const parts = [];
        if (q.reward.coins) parts.push('+' + q.reward.coins + ' монет');
        if (q.reward.energy) parts.push('⚡ +' + q.reward.energy);
        setTimeout(() => { toast('🎯 ' + q.title + ': ' + parts.join(', ')); Snd.reward(); },
          1400 + i * 800);
      });
    }
  }

  async function tryStart() {
    if (starting) return;
    starting = true;
    let r;
    try { r = await Store.play(); }
    catch (e) { starting = false; toast('Сеть недоступна, попробуй ещё раз'); return; }
    starting = false;

    refreshEnergy();
    refreshCoins();
    if (!r.ok) {
      Snd.fail();
      hide(els.startOverlay); hide(els.endOverlay);
      show(els.noEnergyOverlay);
      return;
    }
    // Защитная очистка: закрываем ВСЕ оверлеи, чтобы поле точно было
    // видно и Game.start не запустился под перекрытием. Это спасает от
    // ситуаций «купил энергию в магазине → нажал играть → пусто».
    document.querySelectorAll('.overlay').forEach((el) => el.classList.add('hidden'));
    els.scoreValue.textContent = '0';
    sessionGain = { coins: 0, energy: 0 };
    Game.start({ seed: r.seed });
    show(els.boosterBar);
    show(els.exitGameBtn);
    updateBoosterUI();
    Snd.click();
    haptic('light');
  }

  // --- Бустеры в игре ---
  function updateBoosterUI() {
    const p = Store.boosterPrices || {};
    els.bMoves5Price.textContent = p.moves5 || 80;
    els.bShufflePrice.textContent = p.shuffle || 50;
    els.bBombPrice.textContent = p.bomb || 120;
    const setCoin = (btn, price) => {
      btn.classList.toggle('locked', Store.coins < price);
      btn.disabled = false;
    };
    setCoin(els.boosterMoves, p.moves5 || 80);
    setCoin(els.boosterShuffle, p.shuffle || 50);
    setCoin(els.boosterBomb, p.bomb || 120);
    // +3 ходов стоит 1 энергию — блокируем, если её нет
    els.boosterMovesEnergy.classList.toggle('locked', Store.energy < 1);
    els.boosterMovesEnergy.disabled = false;
  }

  async function useBooster(item) {
    if (!Game.isActive()) return;
    const r = await Store.buyBooster(item);
    if (!r.ok) {
      const msg = r.reason === 'no_coins' ? 'Не хватает монет'
                : r.reason === 'no_energy' ? 'Не хватает энергии'
                : 'Покупка не прошла';
      toast(msg);
      Snd.fail();
      return;
    }
    Snd.click(); haptic('light');
    refreshCoins(); refreshEnergy();
    if (r.effect.moves)   { Game.addMoves(r.effect.moves); toast('+' + r.effect.moves + ' ходов'); }
    if (r.effect.shuffle) { Game.shuffleBoard();           toast('Поле перемешано'); }
    if (r.effect.bomb)    { Game.armBomb();                toast('Выбери, что взорвать'); }
    updateBoosterUI();
  }

  // --- Ежедневные награды ---
  function refreshDailyBtn() {
    const d = Store.daily;
    if (!d) return;
    if (d.canClaim) {
      els.dailyBtn.classList.remove('hidden');
      els.dailyBtn.classList.add('has-claim');         // включаем красную точку
      els.dailyBtnSub.textContent = 'День ' + d.nextDay + ' • забрать';
    } else {
      // уже забрал сегодня — прячем кнопку и снимаем индикатор
      els.dailyBtn.classList.add('hidden');
      els.dailyBtn.classList.remove('has-claim');
    }
  }
  function renderDaily() {
    const d = Store.daily; if (!d) return;
    els.dailyStreak.textContent = d.streak;
    els.dailyGrid.innerHTML = '';
    (d.rewards || []).forEach((r, idx) => {
      const dayNum = idx + 1;
      const isCurrent = d.canClaim && d.nextDay === dayNum;
      const isClaimed = !isCurrent && (dayNum <= d.streak);
      const cell = document.createElement('div');
      cell.className = 'daily-cell day' + dayNum + (isCurrent ? ' current' : '') + (isClaimed ? ' claimed' : '');
      const reward = r.coins
        ? `<span class="coin-dot"></span>${r.coins}`
        : `⚡ ${r.energy}`;
      cell.innerHTML = `<div class="d-label">День ${dayNum}</div><div class="d-reward">${reward}</div>`;
      els.dailyGrid.appendChild(cell);
    });
    els.dailyClaimBtn.disabled = !d.canClaim;
    els.dailyClaimBtn.textContent = d.canClaim ? 'Забрать' : 'Возвращайся завтра';
    els.dailyHint.textContent = '';
  }
  async function claimDaily() {
    const r = await Store.dailyClaim();
    if (r.ok && r.reward) {
      const txt = [];
      if (r.reward.coins) txt.push('+' + r.reward.coins + ' монет');
      if (r.reward.energy) txt.push('⚡ +' + r.reward.energy);
      toast('Награда: ' + txt.join(', '));
      Snd.achievement();
      haptic('success');
    } else {
      toast('Уже забрано сегодня');
      Snd.fail();
    }
    refreshEnergy(); refreshCoins(); refreshDailyBtn(); renderDaily();
  }

  // --- Магазин за монеты (внутренняя валюта) ---
  function renderCoinShop() {
    els.coinShopBalance.textContent = Store.coins;
    const p = Store.prices;
    const items = [
      { id: 'refillOne',  title: '+1 попытка',         desc: 'Прибавит одну попытку к запасу.',                price: p.refillOne,  disabled: Store.energy >= Store.max },
      { id: 'refillFull', title: 'Заполнить запас',    desc: 'Восполняет до максимума (' + Store.max + ').',   price: p.refillFull, disabled: Store.energy >= Store.max },
      { id: 'maxUpgrade', title: '+1 к максимуму',     desc: 'Поднимает потолок попыток навсегда.',            price: p.maxUpgrade, disabled: p.maxUpgradeAvailable === false },
    ];
    els.coinShopList.innerHTML = '';
    items.forEach((it) => {
      const tooExpensive = Store.coins < it.price;
      const item = document.createElement('button');
      // locked — тусклый вид (нельзя купить); сам клик не блокируем — даём
      // тост «не хватает монет», чтобы было понятно, в чём дело.
      item.className = 'shop-item' + ((it.disabled || tooExpensive) ? ' locked' : '');
      item.disabled = it.disabled;
      item.innerHTML = `
        <div class="shop-info">
          <div class="shop-title">${it.title}</div>
          <div class="shop-bonus" style="color:var(--muted)">${it.desc}</div>
        </div>
        <div class="shop-price coins"><span class="coin-dot"></span>${it.price}</div>`;
      item.addEventListener('click', () => {
        if (it.disabled) return;
        if (tooExpensive) { toast('Не хватает монет'); return; }
        buyForCoins(it.id);
      });
      els.coinShopList.appendChild(item);
    });
  }

  async function buyForCoins(item) {
    // запомним, шёл ли игрок из «попытки кончились» — после успешной
    // покупки энергии вернём его прямо в меню, чтобы можно было играть.
    const cameFromNoEnergy = !els.noEnergyOverlay.classList.contains('hidden');
    const r = await Store.buy(item);
    if (r.ok) {
      toast(item === 'maxUpgrade' ? 'Максимум +1!' : 'Куплено');
      Snd.reward();
      haptic('success');
      refreshEnergy(); refreshCoins(); renderCoinShop();
      // Если покупка вернула энергию — закрываем магазин и «нет энергии».
      if ((item === 'refillOne' || item === 'refillFull' || item === 'maxUpgrade')
          && Store.energy > 0 && cameFromNoEnergy) {
        hide(els.coinShopOverlay);
        hide(els.noEnergyOverlay);
        show(els.startOverlay);
      }
    } else if (r.reason === 'no_coins') { toast('Не хватает монет'); Snd.fail(); }
    else if (r.reason === 'already_full') { toast('Запас уже полон'); Snd.fail(); }
    else { toast('Покупка не прошла'); Snd.fail(); }
  }

  // --- Магазин TON: список пакетов из сервера + оплата через TON Connect ---
  let _tonState = { receiver: '', comment: '', packages: [] };

  async function renderShop() {
    els.shopList.innerHTML = '<div class="hint">Загрузка…</div>';
    try {
      const r = await API.tonPackages();
      _tonState = r;
      els.shopList.innerHTML = '';
      if (!r.receiver) {
        els.shopList.innerHTML = '<div class="hint">TON-оплата не настроена. Задайте TON_RECEIVER на сервере.</div>';
        return;
      }
      r.packages.forEach((p) => {
        const item = document.createElement('button');
        item.className = 'shop-item';
        const bonus = [];
        if (p.energy) bonus.push('⚡ +' + p.energy);
        if (p.coins) bonus.push('монет +' + p.coins);
        if (p.bonus) bonus.push(p.bonus);
        item.innerHTML = `
          <div class="shop-info">
            <div class="shop-title">Пакет ${p.id.toUpperCase()}</div>
            <div class="shop-bonus">${bonus.join(' · ')}</div>
          </div>
          <div class="shop-price">${p.priceTon} TON</div>`;
        item.addEventListener('click', () => buyPackage(p));
        els.shopList.appendChild(item);
      });
    } catch (e) {
      els.shopList.innerHTML = '<div class="hint">Ошибка загрузки пакетов: ' + (e.message || e) + '</div>';
    }
  }

  async function buyPackage(p) {
    if (!window.Ton || !window.TON_CONNECT_UI) { toast('TON Connect не загружен'); return; }
    try {
      toast('Открываю кошелёк…');
      await Ton.buy(p, _tonState.receiver, _tonState.comment + ':' + p.id);
      toast('Транзакция отправлена. Проверяю…');
      // Поллинг верификации — TON нужно ~30-60 сек на попадание в блок
      let credited = null;
      for (let i = 0; i < 20 && !credited; i++) {
        await new Promise((r) => setTimeout(r, 3000));
        try {
          const v = await Ton.verify(p.id);
          if (v && v.ok) { credited = v; break; }
        } catch (_) { /* пропускаем 202 not_found_yet */ }
      }
      if (credited) {
        toast(`Начислено: ⚡+${credited.reward.energy || 0} 🪙+${credited.reward.coins || 0}`);
        Snd.reward();
        await Store.resync();
        refreshEnergy(); refreshCoins();
        hide(els.shopOverlay);
      } else {
        toast('Транзакция не найдена. Попробуй позже — сервер докрутит.');
      }
    } catch (e) {
      console.error('[buyPackage]', e);
      toast('Не удалось: ' + (e.message || e));
    }
  }

  function haptic(kind) {
    if (tg && tg.HapticFeedback) {
      if (kind === 'success') tg.HapticFeedback.notificationOccurred('success');
      else tg.HapticFeedback.impactOccurred('light');
    }
  }

  // --- События UI ---
  els.playBtn.addEventListener('click', tryStart);
  els.againBtn.addEventListener('click', tryStart);
  els.endMenuBtn.addEventListener('click', () => { hide(els.endOverlay); show(els.startOverlay); refreshEnergy(); });
  els.shareScoreBtn.addEventListener('click', shareScore);
  els.closeNoEnergy.addEventListener('click', () => { hide(els.noEnergyOverlay); show(els.startOverlay); });
  els.buyBtn.addEventListener('click', () => { renderShop(); show(els.shopOverlay); });
  els.closeShop.addEventListener('click', () => hide(els.shopOverlay));
  const openCoinShop = () => { renderCoinShop(); show(els.coinShopOverlay); };
  els.coinShopBtn.addEventListener('click', openCoinShop);
  els.dailyBtn.addEventListener('click', () => { renderDaily(); show(els.dailyOverlay); });
  els.dailyClaimBtn.addEventListener('click', claimDaily);
  els.dailyCloseBtn.addEventListener('click', () => hide(els.dailyOverlay));
  els.chestBtn.addEventListener('click', openChestUI);
  els.openChestBtn.addEventListener('click', pullChest);
  els.closeChest.addEventListener('click', () => hide(els.chestOverlay));
  // НЕ скрываем noEnergyOverlay — пусть шоп ляжет поверх. Тогда «Закрыть»
  // вернёт назад к предыдущему экрану, а не к пустому полю.
  els.coinShopBtn2.addEventListener('click', () => openCoinShop());
  els.closeCoinShop.addEventListener('click', () => {
    hide(els.coinShopOverlay);
    // Если игрок докупил энергию, пока был в магазине — больше не нужно
    // показывать «нет энергии», возвращаем сразу в меню.
    if (Store.energy > 0 && !els.noEnergyOverlay.classList.contains('hidden')) {
      hide(els.noEnergyOverlay);
      show(els.startOverlay);
    }
  });

  els.boosterMoves.addEventListener('click', () => useBooster('moves5'));
  els.boosterMovesEnergy.addEventListener('click', () => useBooster('movesEnergy'));
  els.boosterShuffle.addEventListener('click', () => useBooster('shuffle'));
  els.boosterBomb.addEventListener('click', () => useBooster('bomb'));

  els.questsBtn.addEventListener('click', () => { renderQuests(); show(els.questsOverlay); });
  els.closeQuests.addEventListener('click', () => hide(els.questsOverlay));
  els.skinsBtn.addEventListener('click', () => { renderSkins(); show(els.skinsOverlay); });
  els.closeSkins.addEventListener('click', () => hide(els.skinsOverlay));
  els.skinsList.addEventListener('click', handleSkinAction);
  els.leaderboardBtn.addEventListener('click', openLeaderboard);
  els.closeLeaderboard.addEventListener('click', () => hide(els.leaderboardOverlay));
  els.achBtn.addEventListener('click', () => { renderAchievements(); show(els.achOverlay); });
  els.profileBtn.addEventListener('click', () => { renderProfile(); show(els.profileOverlay); });
  els.closeProfile.addEventListener('click', () => hide(els.profileOverlay));
  els.closeAch.addEventListener('click', () => hide(els.achOverlay));
  els.inviteBtn.addEventListener('click', invite);

  // Глобальный click-звук для всех кнопок (.btn, .booster, .shop-item).
  // Заодно «будит» AudioContext в браузерах, требующих user gesture.
  // Не дублирует более громкие звуки — те играются явно в обработчиках.
  // Глобальный click-звук с защитой от двойного срабатывания.
  // Слушаем оба события (pointerdown + click) на случай если что-то одно
  // не доходит — но не играем чаще раза в 80 мс.
  let __lastClickAt = 0;
  function maybeClick(e) {
    const t = e.target;
    if (!(t instanceof Element)) return;
    if (!t.closest('.btn, .booster, .shop-item, .sound-toggle, .daily-cell')) return;
    const now = performance.now();
    if (now - __lastClickAt < 80) return;
    __lastClickAt = now;
    Snd.click();
  }
  document.addEventListener('pointerdown', maybeClick, { capture: true });
  document.addEventListener('click', maybeClick, { capture: true });

  // --- Выход в меню во время игры ---
  function doExitGame() {
    hide(els.boosterBar);
    hide(els.exitGameBtn);
    sessionGain = { coins: 0, energy: 0 };
    show(els.startOverlay);
    refreshEnergy(); refreshCoins();
    Snd.click();
  }
  els.exitGameBtn.addEventListener('click', () => {
    if (!Game.isActive()) return;
    const msg = 'Выйти в меню? Партия будет потеряна, энергия не возвращается.';
    // Telegram-диалог только если реально в TG (по признаку initData).
    if (tg && tg.initData && tg.showConfirm) {
      tg.showConfirm(msg, (ok) => { if (ok) doExitGame(); });
    } else if (window.confirm(msg)) {
      doExitGame();
    }
  });

  // --- Кнопка вкл/выкл звука ---
  function refreshSoundIcon() {
    const m = Snd.muted();
    els.soundIcon.textContent = m ? '🔇' : '🔊';
    els.soundToggle.classList.toggle('muted', m);
  }
  els.soundToggle.addEventListener('click', () => {
    Snd.setMuted(!Snd.muted());
    refreshSoundIcon();
    if (!Snd.muted()) Snd.click();   // короткий звук-подтверждение
  });
  refreshSoundIcon();

  // --- Туториал ---
  // Каждый шаг — { title, text, art }. art — SVG-картинка как пример.
  const TUT_STEPS = [
    {
      title: 'Цель игры',
      text: 'Собирай 3 или больше одинаковых фигур в ряд. Меняй местами две соседние фишки — тапом по одной, потом по другой, или свайпом.',
      art: () => '<svg viewBox="0 0 120 60"><g>'
        + '<rect x="6"  y="14" width="32" height="32" rx="7" fill="url(#g1)"/>'
        + '<rect x="44" y="14" width="32" height="32" rx="7" fill="url(#g1)"/>'
        + '<rect x="82" y="14" width="32" height="32" rx="7" fill="url(#g1)"/>'
        + '<defs><linearGradient id="g1" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stop-color="#ff9a9a"/><stop offset="100%" stop-color="#c00f2d"/></linearGradient></defs>'
        + '</g></svg>',
    },
    {
      title: 'Каскады и очки',
      text: 'Чем длиннее цепочка и чем больше падающих каскадов — тем больше очков.',
      art: () => '<svg viewBox="0 0 120 60">'
        + '<text x="60" y="38" text-anchor="middle" font-size="24" font-weight="800" fill="#fff">x2 → x3</text>'
        + '<text x="60" y="55" text-anchor="middle" font-size="9" fill="#8a8db0">множитель каскада</text>'
        + '</svg>',
    },
    {
      title: 'Спец-фишки',
      text: 'Среди обычных фишек встречаются монеты, энергия и подарки. Собери 3 таких в ряд — получишь награду автоматически.',
      art: () => '<svg viewBox="0 0 120 60">'
        + '<circle cx="20" cy="30" r="16" fill="#ffcf4d" stroke="#d98300" stroke-width="2"/><text x="20" y="36" text-anchor="middle" font-size="16" font-weight="800" fill="#b86b00">$</text>'
        + '<path d="M63 8 L52 32 H59 L56 52 L70 28 H63 L66 8 Z" fill="#ffd633" stroke="#e08a00" stroke-width="2"/>'
        + '<rect x="86" y="22" width="22" height="18" rx="2" fill="#ff6fb5" stroke="#d6336c" stroke-width="1.5"/>'
        + '<rect x="83" y="17" width="28" height="7" rx="2" fill="#ff8ec8" stroke="#d6336c" stroke-width="1.5"/>'
        + '</svg>',
    },
    {
      title: 'Попытки и магазин',
      text: 'Каждая игра тратит 1 ⚡ попытку. Они восстанавливаются по одной в час. За монеты можно докупить попытки или прокачать максимум. Удачи!',
      art: () => '<svg viewBox="0 0 120 60">'
        + '<text x="32" y="40" text-anchor="middle" font-size="32">⚡</text>'
        + '<text x="60" y="38" text-anchor="middle" font-size="14" fill="#8a8db0">→</text>'
        + '<circle cx="92" cy="30" r="15" fill="url(#cg)" stroke="#d98300" stroke-width="2"/>'
        + '<text x="92" y="35" text-anchor="middle" font-size="14" font-weight="800" fill="#b86b00">$</text>'
        + '<defs><radialGradient id="cg"><stop offset="0%" stop-color="#ffe9a8"/><stop offset="100%" stop-color="#f08c00"/></radialGradient></defs>'
        + '</svg>',
    },
  ];
  let tutStep = 0;
  function renderTutorial() {
    const s = TUT_STEPS[tutStep];
    els.tutArt.innerHTML = s.art();
    els.tutTitle.textContent = s.title;
    els.tutText.textContent = s.text;
    // точки прогресса
    els.tutDots.innerHTML = '';
    for (let i = 0; i < TUT_STEPS.length; i++) {
      const d = document.createElement('span');
      if (i < tutStep) d.className = 'done';
      else if (i === tutStep) d.className = 'active';
      els.tutDots.appendChild(d);
    }
    els.tutNextBtn.textContent = tutStep === TUT_STEPS.length - 1 ? 'Начать!' : 'Дальше';
  }
  function openTutorial() {
    tutStep = 0;
    renderTutorial();
    show(els.tutorialOverlay);
  }
  function closeTutorial() {
    hide(els.tutorialOverlay);
    localStorage.setItem('m3_tutorial_seen', '1');
  }
  els.tutNextBtn.addEventListener('click', () => {
    if (tutStep < TUT_STEPS.length - 1) { tutStep++; renderTutorial(); }
    else closeTutorial();
  });
  els.tutSkipBtn.addEventListener('click', closeTutorial);
  els.helpBtn.addEventListener('click', openTutorial);

  // --- Полоска опыта ---
  function refreshXp() {
    const lv = Store.levels || { level: 1, currentLevelXp: 0, levelSpan: 100 };
    els.xpLevel.textContent = lv.level;
    els.xpText.textContent = `${lv.currentLevelXp} / ${lv.levelSpan} XP`;
    const pct = Math.max(0, Math.min(100, (lv.currentLevelXp * 100) / Math.max(1, lv.levelSpan)));
    els.xpBarFill.style.width = pct + '%';
  }
  function bumpXp() {
    els.xpBarFill.classList.add('bumping');
    setTimeout(() => els.xpBarFill.classList.remove('bumping'), 500);
  }

  // --- Сундук (каждые N партий) ---
  function refreshChestBtn() {
    const c = Store.chest;
    if (!c) { els.chestBtn.classList.add('hidden'); return; }
    els.chestBtn.classList.remove('hidden');
    const total = c.step || 5;
    if (c.available) {
      els.chestBtn.classList.add('ready');
      els.chestBtn.style.setProperty('--progress', '100%');
      els.chestBtnSub.textContent = 'Готов! Открой';
    } else {
      els.chestBtn.classList.remove('ready');
      const left = c.gamesToNext || total;
      const done = total - left;
      els.chestBtn.style.setProperty('--progress', (done * 100 / total) + '%');
      els.chestBtnSub.textContent = `${done} / ${total} партий`;
    }
  }
  function openChestUI() {
    if (!Store.chest) return;
    if (!Store.chest.available) {
      toast(`Сыграй ещё ${Store.chest.gamesToNext} партий`);
      Snd.fail();
      return;
    }
    els.chestArt.className = 'chest-art';
    els.chestArt.textContent = '📦';
    els.chestReward.textContent = '';
    els.chestSub.textContent = 'Открой и получи случайную награду!';
    els.openChestBtn.disabled = false;
    els.openChestBtn.textContent = 'Открыть';
    show(els.chestOverlay);
  }
  async function pullChest() {
    els.openChestBtn.disabled = true;
    els.chestArt.classList.add('shake');
    Snd.click();
    await new Promise(r => setTimeout(r, 700));
    const r = await Store.openChest();
    if (!r.ok) { toast('Сундук пока недоступен'); Snd.fail(); return; }
    els.chestArt.classList.remove('shake');
    els.chestArt.classList.add('opened');
    els.chestArt.textContent = '🎉';
    const parts = [];
    if (r.reward.coins)  parts.push(r.reward.coins + ' монет');
    if (r.reward.energy) parts.push('⚡ +' + r.reward.energy);
    els.chestReward.textContent = '+ ' + parts.join('   ');
    els.chestSub.textContent = 'Получено!';
    els.openChestBtn.textContent = 'Забрать';
    els.openChestBtn.disabled = false;
    els.openChestBtn.onclick = () => { hide(els.chestOverlay); refreshChestBtn(); refreshEnergy(); refreshCoins(); els.openChestBtn.onclick = null; };
    Snd.achievement();
    haptic('success');
    refreshEnergy(); refreshCoins();
  }

  // --- Баннер активных событий ---
  function refreshEventBanner() {
    const ev = (Store.events || [])[0];
    if (!ev) { els.eventBanner.classList.add('hidden'); return; }
    els.eventBanner.classList.remove('hidden');
    els.eventBanner.innerHTML = `
      <div class="ev-icon">${ev.icon || '🎉'}</div>
      <div><div class="ev-title">${ev.title}</div><div class="ev-desc">${ev.desc}</div></div>`;
  }

  function fmtRemain(ms) {
    if (ms <= 0) return '0ч';
    const h = Math.floor(ms / 3600000);
    if (h >= 24) return Math.floor(h / 24) + 'д ' + (h % 24) + 'ч';
    return h + 'ч';
  }

  // --- Дневные цели ---
  function renderWeeklyQuest() {
    const w = Store.weekly;
    if (!w || !w.target) { els.weeklyQuestBox.innerHTML = ''; return; }
    const pct = Math.min(100, Math.round((w.progress / w.target) * 100));
    const reward = [];
    if (w.reward.coins)  reward.push(`<span class="coin-dot"></span>${w.reward.coins}`);
    if (w.reward.energy) reward.push(`⚡${w.reward.energy}`);
    els.weeklyQuestBox.innerHTML = `
      <div class="weekly-quest ${w.claimed ? 'done' : ''}">
        <div class="wq-top">
          <span>${w.title}${w.claimed ? ' ✓' : ''}</span>
          <span class="wq-reward">${reward.join(' ')}</span>
        </div>
        <div class="wq-desc">${w.desc} · осталось ${fmtRemain(w.msToEnd)}</div>
        <div class="wq-bar"><div class="wq-bar-fill" style="width:${pct}%"></div></div>
        <div class="wq-progress"><span>${w.progress.toLocaleString('ru-RU')} / ${w.target.toLocaleString('ru-RU')}</span><span>${pct}%</span></div>
      </div>`;
  }

  function renderQuests() {
    renderWeeklyQuest();
    const q = (Store.quests && Store.quests.list) || [];
    els.questList.innerHTML = '';
    if (!q.length) { els.questList.textContent = 'Сегодня цели появятся после первой партии.'; return; }
    q.forEach((it) => {
      const pct = Math.min(100, Math.round((it.progress / it.target) * 100));
      const reward = [];
      if (it.reward.coins)  reward.push(`<span class="coin-dot"></span>${it.reward.coins}`);
      if (it.reward.energy) reward.push(`⚡${it.reward.energy}`);
      const row = document.createElement('div');
      row.className = 'quest-item' + (it.claimed ? ' done' : '');
      row.innerHTML = `
        <div class="quest-top">
          <div class="quest-title">${it.title}</div>
          <div class="quest-reward">${reward.join(' ')}</div>
        </div>
        <div class="quest-bar"><div class="quest-bar-fill" style="width:${pct}%"></div></div>
        <div class="quest-progress">${it.progress} / ${it.target}</div>`;
      els.questList.appendChild(row);
    });
  }

  // --- Скины (косметика) ---
  function renderSkins() {
    const all = Skins.list();
    const activeId = Skins.active();
    els.skinsList.innerHTML = '';
    all.forEach((s) => {
      const owned = Skins.isOwned(s.id);
      const isActive = activeId === s.id;
      const item = document.createElement('div');
      item.className = 'skin-item' + (isActive ? ' active' : '');
      // превью: 5 миниатюр фигур (квадрат, круг, треугольник, звезда, ромб)
      // Чтобы превью отрисовалось в скине, временно ставим data-skin
      // на сам элемент превью? Проще — превью использует общие .gem.t*
      // правила через div с CSS-переменными.
      const preview = `<div class="skin-preview" data-skin-preview="${s.id}">
        <div class="p p0 gem t0"></div>
        <div class="p p1 gem t1"></div>
        <div class="p p2 gem t2"></div>
        <div class="p p3 gem t3"></div>
        <div class="p p4 gem t4"></div>
      </div>`;
      let action;
      if (isActive)      action = `<button class="skin-action active" disabled>✓ Активен</button>`;
      else if (owned)    action = `<button class="skin-action equip" data-id="${s.id}" data-act="equip">Включить</button>`;
      else {
        const canBuy = Store.coins >= s.price;
        action = `<button class="skin-action buy ${canBuy ? '' : 'locked'}" data-id="${s.id}" data-act="buy"><span class="coin-dot"></span> ${s.price}</button>`;
      }
      item.innerHTML = `<div class="skin-info">
          <div class="skin-title">${s.title}</div>
          <div class="skin-desc">${s.desc}</div>
          ${preview}
        </div>${action}`;
      els.skinsList.appendChild(item);
    });
    // подменим превью data-skin на корневом элементе виртуально
    // (быстрое решение — у каждой коробки превью отдельно невозможно
    // без переписи CSS; пока показываем превью в стиле Classic).
  }

  async function handleSkinAction(e) {
    const btn = e.target.closest('[data-act]'); if (!btn) return;
    const id = btn.getAttribute('data-id');
    const act = btn.getAttribute('data-act');
    if (act === 'equip') {
      Skins.apply(id);
      toast('Скин включён');
      Snd.click();
      renderSkins();
      return;
    }
    if (act === 'buy') {
      const s = Skins.get(id); if (!s) return;
      if (Store.coins < s.price) { toast('Не хватает монет'); Snd.fail(); return; }
      const r = await Store.buySkin(id);
      if (!r.ok) {
        if (r.reason === 'no_coins')       toast('Не хватает монет');
        else if (r.reason === 'already_owned') toast('Скин уже куплен');
        else                                toast('Покупка не прошла');
        Snd.fail();
        renderSkins();
        return;
      }
      Skins.apply(id);
      refreshCoins();
      toast(`«${s.title}» куплен и включён`);
      Snd.reward();
      renderSkins();
    }
  }

  // --- Лидерборд (еженедельный турнир) ---
  async function openLeaderboard() {
    show(els.leaderboardOverlay);
    els.lbList.textContent = 'Загрузка…';
    els.lbMe.textContent = '';
    const data = await Store.fetchLeaderboard(50);
    if (!data.top.length) {
      els.lbList.innerHTML = '<div style="padding:20px;color:var(--muted);text-align:center">Эта неделя ещё свободна — сыграй и встань на первое место!</div>';
    } else {
      els.lbList.innerHTML = '';
      data.top.forEach((row) => {
        const el = document.createElement('div');
        el.className = 'lb-row' + (row.isMe ? ' me' : '');
        // призовые места: 1, 2, 3
        let prize = '';
        if (data.prizes && row.rank <= data.prizes.length) {
          const p = data.prizes[row.rank - 1];
          prize = `<span class="lb-prize">+${p.coins}🪙</span>`;
        }
        el.innerHTML = `<div class="lb-rank">${row.rank}</div><div class="lb-name">${escapeHtml(row.name)}</div><div class="lb-score">${row.best}${prize}</div>`;
        els.lbList.appendChild(el);
      });
    }
    if (data.me) {
      els.lbMe.textContent = data.me.rank
        ? `Твоя позиция: #${data.me.rank} • рекорд недели ${data.me.best}`
        : 'Сыграй партию, чтобы попасть в топ недели.';
    }
  }

  // --- Достижения ---
  function renderProfile() {
    const st = Store.stats || {};
    const lv = Store.levels || { level: 1, currentLevelXp: 0, levelSpan: 100 };
    const unlockedCount = (Store.achievements || []).length;
    const totalAch = (C.achievements || []).length;
    els.profileName.textContent = Store.name || 'Игрок';
    els.profileLevel.textContent = lv.level;
    const pct = Math.max(0, Math.min(100, (lv.currentLevelXp / lv.levelSpan) * 100));
    els.profileXpFill.style.width = pct + '%';
    els.profileXpText.textContent = `${lv.currentLevelXp} / ${lv.levelSpan} XP`;
    const rows = [
      ['Рекорд',       (Store.best || 0).toLocaleString('ru')],
      ['Монет всего',  (st.totalCoins || 0).toLocaleString('ru')],
      ['Партий',       (st.gamesPlayed || 0).toLocaleString('ru')],
      ['Матчей',       (st.matches || 0).toLocaleString('ru')],
      ['Лучший каскад', 'x' + (st.maxCombo || 1)],
      ['Серия дней',   (st.maxStreak || 0)],
      ['Достижения',   `${unlockedCount} / ${totalAch}`],
      ['Баланс',       (Store.coins || 0).toLocaleString('ru')],
    ];
    els.profileStats.innerHTML = rows.map(([label, val]) =>
      `<div class="profile-stat"><b>${val}</b><span>${label}</span></div>`
    ).join('');
  }

  function renderAchievements() {
    const all = C.achievements;
    const unlockedIds = new Set(Store.achievements || []);
    els.achList.innerHTML = '';
    all.forEach((a) => {
      const got = unlockedIds.has(a.id);
      const row = document.createElement('div');
      row.className = 'ach-item' + (got ? ' unlocked' : '');
      row.innerHTML = `<div class="ach-icon">${got ? '🏆' : '🔒'}</div>
                       <div><div class="ach-title">${a.title}</div><div class="ach-desc">${a.desc}</div></div>`;
      els.achList.appendChild(row);
    });
  }

  // --- Приглашение друга ---
  function getInviteLink() {
    // Берём username бота из window.CONFIG если задан, иначе пытаемся угадать
    const bot = (window.CONFIG.botUsername || '').replace(/^@/, '');
    const uid = tg && tg.initDataUnsafe && tg.initDataUnsafe.user && tg.initDataUnsafe.user.id;
    if (bot && uid) return `https://t.me/${bot}?start=ref_${uid}`;
    return null;
  }
  function invite() {
    const link = getInviteLink();
    if (!link) { toast('Поделиться можно из Telegram-бота'); return; }
    const text = 'Играй со мной в M3 и получи 100 монет старта! ' + link;
    if (tg && tg.openTelegramLink) tg.openTelegramLink('https://t.me/share/url?url=' + encodeURIComponent(link) + '&text=' + encodeURIComponent('Играй со мной в M3!'));
    else if (navigator.share) navigator.share({ text }).catch(()=>{});
    else { navigator.clipboard && navigator.clipboard.writeText(text); toast('Ссылка скопирована'); }
  }

  // Поделиться рекордом — открывает Telegram share с текстом и реф-ссылкой
  function shareScore() {
    const score = parseInt(els.endScore.textContent, 10) || 0;
    const best  = Store.best || 0;
    const link  = getInviteLink();
    const tagline = best > 0 && score === best
      ? `🏆 Новый рекорд: ${score} очков в M3!`
      : `Я набрал ${score} очков в M3 (рекорд ${best})!`;
    const text = link
      ? `${tagline}\nПопробуй побить — старт в подарок: ${link}`
      : `${tagline} Попробуй сам!`;

    if (link && tg && tg.openTelegramLink) {
      // Нативный Telegram share dialog — выбор чата, картинка-превью бота
      tg.openTelegramLink('https://t.me/share/url?url=' + encodeURIComponent(link) + '&text=' + encodeURIComponent(tagline));
    } else if (navigator.share) {
      navigator.share({ text }).catch(() => {});
    } else {
      if (navigator.clipboard) navigator.clipboard.writeText(text);
      toast('Текст скопирован');
    }
    Snd.click();
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
  }

  // --- Анимация: летящие монетки ---
  function flyCoins(fromEl, count) {
    if (!fromEl) return;
    const target = $('coinsBox');
    const start = fromEl.getBoundingClientRect();
    const end = target.getBoundingClientRect();
    const n = Math.min(8, Math.max(1, count));
    for (let i = 0; i < n; i++) {
      const c = document.createElement('div');
      c.className = 'flying-coin';
      c.style.left = (start.left + start.width / 2 - 8) + 'px';
      c.style.top  = (start.top + start.height / 2 - 8) + 'px';
      c.style.opacity = '1';
      document.body.appendChild(c);
      const dx = (end.left + end.width / 2) - (start.left + start.width / 2);
      const dy = (end.top + end.height / 2) - (start.top + start.height / 2);
      const jitterX = (Math.random() - 0.5) * 40;
      const jitterY = (Math.random() - 0.5) * 40 - 20;
      requestAnimationFrame(() => {
        c.style.transform = `translate(${jitterX}px, ${jitterY}px)`;
        setTimeout(() => {
          c.style.transform = `translate(${dx}px, ${dy}px)`;
          c.style.opacity = '0.85';
        }, 70 + i * 40);
        setTimeout(() => c.remove(), 700 + i * 40);
      });
    }
  }

  window.addEventListener('resize', () => Game.resize());

  // --- Запуск: подтянуть состояние с сервера ---
  hide(els.boosterBar);

  // --- Переключатель темы (светлая/тёмная) ---
  function applyTheme(t) {
    document.documentElement.classList.toggle('theme-light', t === 'light');
    els.themeIcon.textContent = t === 'light' ? '☀️' : '🌙';
  }
  applyTheme(localStorage.getItem('m3_theme') || 'dark');
  els.themeToggle.addEventListener('click', () => {
    const next = localStorage.getItem('m3_theme') === 'light' ? 'dark' : 'light';
    localStorage.setItem('m3_theme', next);
    applyTheme(next);
  });
  (async () => {
    await Store.bootstrap();
    refreshEnergy();
    refreshCoins();
    refreshDailyBtn();
    refreshChestBtn();
    refreshEventBanner();
    refreshXp();
    // Приз за прошлую неделю — выдаётся сервером один раз
    const pt = Store.consumePendingTournament && Store.consumePendingTournament();
    if (pt) {
      const rankEmoji = pt.rank === 1 ? '🥇' : pt.rank === 2 ? '🥈' : '🥉';
      setTimeout(() => {
        toast(`${rankEmoji} ${pt.rank} место недели! +${pt.coins} монет`);
        Snd.achievement();
        refreshCoins();
      }, 800);
    }
    // Туториал — при самом первом запуске (приоритет над daily-оверлеем).
    if (!localStorage.getItem('m3_tutorial_seen')) {
      openTutorial();
    } else if (Store.daily && Store.daily.canClaim) {
      // мягкий хук удержания — открыть награды, если есть
      renderDaily(); show(els.dailyOverlay);
    }
  })();
  setInterval(refreshEnergy, 1000);                       // живой таймер регена
  setInterval(() => Store.resync().then(() => {
    refreshEnergy(); refreshCoins(); refreshEventBanner();
  }), 60000); // сверка с сервером
})();
