/*
 * Кэш состояния игрока на клиенте. Источник правды — сервер (api.js);
 * здесь мы храним последний ответ и локально «тикаем» таймер регена
 * между запросами, чтобы UI был живым без постоянного дёрганья сервера.
 *
 * Если сервер недоступен (например, статичное превью без backend) —
 * включается офлайн-режим Mock на localStorage, чтобы игру можно было
 * посмотреть. В продакшне с сервером Mock не используется.
 */
window.Store = (() => {
  const EC = window.CONFIG.energy;
  const DEF = { max: EC.max, regenMs: EC.regenMs };

  const SHOP = window.CONFIG.shop;
  let s = { energy: 0, max: DEF.max, regenMs: DEF.regenMs, coins: 0, best: 0,
            prices: { refillOne: SHOP.refillOne.coins, refillFull: SHOP.refillFull.coins,
                      maxUpgrade: SHOP.maxUpgrade.coinsBase, maxUpgradeAvailable: true },
            daily: { canClaim: false, streak: 0, nextDay: 1, rewards: [], msToNext: 0 },
            quests: { day: 0, list: [] },
            events: [], weekly: { progress: 0, target: 10000, claimed: false, reward: { coins: 500, energy: 2 }, title: 'Недельный вызов', desc: 'Набери 10 000 очков за неделю', msToEnd: 0 },
            chest: { available: false, gamesToNext: 5, played: 0, step: 5 },
            tournament: { myWeekBest: 0, week: 0 }, pendingTournament: null,
            levels: { level: 1, xp: 0, currentLevelXp: 0, levelSpan: 100 },
            achievements: [], stats: {},
            boosterPrices: { moves5: 80, shuffle: 50, bomb: 120 } };
  let nextAt = 0;        // момент времени, когда добавится +1 энергии
  let online = false;

  function applyServer(d) {
    if ('max' in d) s.max = d.max;
    if ('regenMs' in d) s.regenMs = d.regenMs;
    if ('energy' in d) s.energy = d.energy;
    if ('coins' in d) s.coins = d.coins;
    if ('best' in d) s.best = d.best;
    if (d.prices) s.prices = d.prices;
    if (d.daily) s.daily = d.daily;
    if (d.quests) s.quests = d.quests;
    if (d.events) s.events = d.events;
    if (d.weekly) s.weekly = d.weekly;
    if (d.chest) s.chest = d.chest;
    if (d.tournament) s.tournament = d.tournament;
    if (d.pendingTournament) s.pendingTournament = d.pendingTournament;
    if (d.levels) s.levels = d.levels;
    if (d.achievements) s.achievements = d.achievements;
    if (d.ownedSkins) s.ownedSkins = d.ownedSkins;
    if (d.stats) s.stats = d.stats;
    if (d.name) s.name = d.name;
    if (d.boosterPrices) s.boosterPrices = d.boosterPrices;
    nextAt = (s.energy < s.max && d.msToNext > 0) ? Date.now() + d.msToNext : 0;
  }

  // локальный реген между запросами к серверу
  function regenLocal() {
    if (s.energy >= s.max) { nextAt = 0; return; }
    while (nextAt && Date.now() >= nextAt && s.energy < s.max) {
      s.energy++;
      nextAt = s.energy >= s.max ? 0 : nextAt + s.regenMs;
    }
  }

  // ---- Офлайн-«сервер» на localStorage (только для превью без backend) ----
  const Mock = (() => {
    const K = { e: 'm3_energy', t: 'm3_energy_ts', c: 'm3_coins', b: 'm3_best', m: 'm3_max',
                dStreak: 'm3_d_streak', dLast: 'm3_d_last',
                cR1: 'm3_buy_refillOne', cRF: 'm3_buy_refillFull' };
    const MULTS = window.CONFIG.shopMults || { refillOne: 1.5, refillFull: 1.5, maxUpgrade: 1.7 };
    const priceRefillOne  = () => Math.round(SHOP.refillOne.coins  * Math.pow(MULTS.refillOne,  num(localStorage.getItem(K.cR1), 0)));
    const priceRefillFull = () => Math.round(SHOP.refillFull.coins * Math.pow(MULTS.refillFull, num(localStorage.getItem(K.cRF), 0)));
    const DAY_MS = 24 * 60 * 60 * 1000;
    const REWARDS = [
      { day: 1, coins: 50,  energy: 0 },
      { day: 2, coins: 75,  energy: 0 },
      { day: 3, coins: 0,   energy: 1 },
      { day: 4, coins: 100, energy: 0 },
      { day: 5, coins: 0,   energy: 2 },
      { day: 6, coins: 150, energy: 0 },
      { day: 7, coins: 300, energy: 1 },
    ];
    const today = () => Math.floor(Date.now() / DAY_MS);
    function dailyStatus() {
      let streak = num(localStorage.getItem(K.dStreak), 0);
      const lastDay = num(localStorage.getItem(K.dLast), 0);
      const t = today();
      if (lastDay !== 0 && t !== lastDay && t !== lastDay + 1) {
        streak = 0; localStorage.setItem(K.dStreak, 0);
      }
      const canClaim = lastDay !== t;
      const nextStreak = canClaim ? (streak % REWARDS.length) + 1 : streak;
      return {
        canClaim, streak, nextDay: nextStreak,
        nextReward: REWARDS[(nextStreak - 1 + REWARDS.length) % REWARDS.length],
        rewards: REWARDS,
        msToNext: canClaim ? 0 : Math.max(0, (lastDay + 1) * DAY_MS - Date.now()),
      };
    }
    // --- Дневные цели (офлайн) ---
    const QUEST_POOL = [
      { tid:'play_3', type:'play_games', target:3, reward:{coins:30}, title:'Сыграй 3 партии' },
      { tid:'play_5', type:'play_games', target:5, reward:{coins:60}, title:'Сыграй 5 партий' },
      { tid:'score_1k', type:'score_in_game', target:1000, reward:{coins:40}, title:'Набери 1000 очков за партию' },
      { tid:'score_3k', type:'score_in_game', target:3000, reward:{coins:120}, title:'Набери 3000 очков за партию' },
      { tid:'coins_30', type:'coins_in_game', target:30, reward:{coins:50}, title:'Собери 30 монет за партию' },
      { tid:'coins_60', type:'coins_in_game', target:60, reward:{coins:120,energy:1}, title:'Собери 60 монет за партию' },
      { tid:'combo_3', type:'max_combo', target:3, reward:{coins:50}, title:'Сделай каскад x3' },
      { tid:'combo_5', type:'max_combo', target:5, reward:{coins:150,energy:1}, title:'Сделай каскад x5' },
      { tid:'match_80', type:'matches_in_game', target:80, reward:{coins:60}, title:'Собери 80 матчей за партию' },
    ];
    function questDay() { return Math.floor(Date.now() / 86400000); }
    function questHash(s){ let h=2166136261; for(let i=0;i<s.length;i++) h=((h^s.charCodeAt(i))*16777619)>>>0; return h; }
    function questsEnsure() {
      const t = questDay();
      let cur = null; try { cur = JSON.parse(localStorage.getItem('m3_quests') || 'null'); } catch(e){}
      if (!cur || cur.day !== t) {
        let rnd = questHash(String(t) + ':local') || 1;
        const pool = QUEST_POOL.slice();
        const out = [];
        while (out.length < 3 && pool.length) {
          rnd = (rnd * 1664525 + 1013904223) >>> 0;
          const idx = rnd % pool.length;
          const p = pool.splice(idx, 1)[0];
          out.push({ ...p, progress: 0, claimed: false });
        }
        cur = { day: t, list: out };
        localStorage.setItem('m3_quests', JSON.stringify(cur));
      }
      return cur;
    }
    // --- События и недельный квест (офлайн) ---
    const DAY = 86400000, WEEK = 7 * DAY;
    const weekIdx = () => Math.floor((Date.now() - 4 * DAY) / WEEK);
    function eventsActive() {
      const dow = new Date().getUTCDay();
      const list = [];
      if (dow === 0 || dow === 6) {
        list.push({ id:'weekend_double', title:'Выходные ×2 монет', icon:'🪙×2',
                    desc:'Все собранные в партиях монеты удваиваются.', mult:{coins:2} });
      }
      return list;
    }
    const coinMult = () => eventsActive().reduce((m,e)=>m*((e.mult&&e.mult.coins)||1),1);
    function weeklyEnsure() {
      const w = weekIdx();
      let cur=null; try{cur=JSON.parse(localStorage.getItem('m3_weekly')||'null');}catch(e){}
      if (!cur || cur.week !== w) {
        cur = { week:w, sum:0, claimed:false };
        localStorage.setItem('m3_weekly', JSON.stringify(cur));
      }
      return cur;
    }
    function weeklyStatusMock() {
      const w = weeklyEnsure();
      return { id:'weekly_score_10k', title:'Недельный вызов',
               desc:'Набери 10 000 очков за неделю',
               target:10000, progress:Math.min(w.sum,10000), claimed:w.claimed,
               reward:{coins:500,energy:2},
               msToEnd:(weekIdx()+1)*WEEK + 4*DAY - Date.now() };
    }
    function weeklyProgress(score) {
      const w = weeklyEnsure();
      if (w.claimed) return null;
      w.sum += score;
      localStorage.setItem('m3_weekly', JSON.stringify(w));
      if (w.sum >= 10000) {
        w.claimed = true;
        localStorage.setItem('m3_weekly', JSON.stringify(w));
        return { reward:{coins:500,energy:2}, title:'Недельный вызов' };
      }
      return null;
    }

    // --- Уровни (офлайн) ---
    const LV_BASE = 100, LV_STEP = 50;
    function lvTotalXpFor(L){ const N=L-1; return N*LV_BASE + LV_STEP*N*(N-1)/2; }
    function lvFromXp(xp){ let L=1; while(lvTotalXpFor(L+1) <= xp) L++; return L; }
    function lvReward(L){ return { coins: 30 + 15*L, energy: L%5===0 ? 1 : 0 }; }
    function lvState() {
      const xp = parseInt(localStorage.getItem('m3_xp') || '0', 10) || 0;
      const L = lvFromXp(xp);
      const cur = lvTotalXpFor(L);
      const nxt = lvTotalXpFor(L+1);
      return { level: L, xp, currentLevelXp: xp - cur, levelSpan: nxt - cur };
    }
    function lvAdd(amount) {
      const xpBefore = parseInt(localStorage.getItem('m3_xp') || '0', 10) || 0;
      const before = lvFromXp(xpBefore);
      const xpAfter = xpBefore + amount;
      localStorage.setItem('m3_xp', String(xpAfter));
      const after = lvFromXp(xpAfter);
      const ups = [];
      for (let L = before + 1; L <= after; L++) ups.push({ level: L, reward: lvReward(L) });
      return ups;
    }

    // --- Турнир (офлайн) ---
    function tWeekIndex() { return Math.floor((Date.now() - 4 * 86400000) / (7 * 86400000)); }
    function tReadBest() {
      let o = null; try { o = JSON.parse(localStorage.getItem('m3_week_best') || 'null'); } catch(e){}
      const w = tWeekIndex();
      if (!o || o.week !== w) o = { week: w, best: 0 };
      return o;
    }
    function tWriteBest(o) { localStorage.setItem('m3_week_best', JSON.stringify(o)); }
    function tournamentState() {
      const o = tReadBest();
      return { myWeekBest: o.best, week: o.week };
    }
    function tRecord(score) {
      const o = tReadBest();
      if (score > o.best) { o.best = score; tWriteBest(o); }
    }

    // --- Сундук (офлайн) ---
    const CHEST_STEP = 5;
    const CHEST_REWARDS = [
      { weight:35, coins:50 }, { weight:25, coins:100 }, { weight:15, coins:200 },
      { weight:10, coins:500 }, { weight:8, energy:1 }, { weight:5, coins:1000 }, { weight:2, energy:3 },
    ];
    function chestRead() {
      let c = null; try { c = JSON.parse(localStorage.getItem('m3_chest') || 'null'); } catch(e){}
      if (!c) c = { played: 0, claimed: 0 };
      return c;
    }
    function chestWrite(c) { localStorage.setItem('m3_chest', JSON.stringify(c)); }
    function chestStatus() {
      const c = chestRead();
      const earned = Math.floor(c.played / CHEST_STEP);
      return {
        available: earned > c.claimed,
        gamesToNext: CHEST_STEP - (c.played % CHEST_STEP || CHEST_STEP),
        played: c.played, step: CHEST_STEP,
      };
    }
    function chestBump() { const c = chestRead(); c.played++; chestWrite(c); }
    function chestOpen() {
      const c = chestRead();
      const st = chestStatus();
      if (!st.available) return { ok:false };
      const total = CHEST_REWARDS.reduce((a,r)=>a+r.weight,0);
      let roll = Math.random()*total;
      let picked = CHEST_REWARDS[CHEST_REWARDS.length-1];
      for (const r of CHEST_REWARDS) { if (roll < r.weight) { picked = r; break; } roll -= r.weight; }
      c.claimed++; chestWrite(c);
      // зачисляем награду в кошелёк/энергию
      const cur = parseInt(localStorage.getItem(K.c),10) || 0;
      if (picked.coins) localStorage.setItem(K.c, cur + picked.coins);
      if (picked.energy) { const {e,t} = sync(); write(e + picked.energy, t); }
      return { ok:true, reward:{ coins:picked.coins||0, energy:picked.energy||0 } };
    }

    function questsProgress(gs) {
      const q = questsEnsure();
      const done = [];
      for (const it of q.list) {
        if (it.claimed) continue;
        let val = it.progress || 0;
        if (it.type === 'play_games')       val = val + 1;
        else if (it.type === 'score_in_game')  val = Math.max(val, gs.score || 0);
        else if (it.type === 'coins_in_game')  val = Math.max(val, gs.coinsGained || 0);
        else if (it.type === 'max_combo')      val = Math.max(val, gs.maxCombo || 0);
        else if (it.type === 'matches_in_game') val = Math.max(val, gs.matches || 0);
        it.progress = val;
        if (val >= it.target) { it.claimed = true; done.push(it); }
      }
      localStorage.setItem('m3_quests', JSON.stringify(q));
      return done;
    }

    function dailyClaim() {
      const st = dailyStatus();
      if (!st.canClaim) return { ok: false, reason: 'already_claimed' };
      const streak = ((num(localStorage.getItem(K.dStreak), 0)) % REWARDS.length) + 1;
      const reward = REWARDS[streak - 1];
      localStorage.setItem(K.dStreak, streak);
      localStorage.setItem(K.dLast, today());
      const stx = state();
      localStorage.setItem(K.c, stx.coins + (reward.coins || 0));
      if (reward.energy) { const { e, t } = sync(); write(e + reward.energy, t); }
      return { ok: true, reward, ...state() };
    }
    const num = (v, def) => { const n = parseInt(v, 10); return Number.isNaN(n) ? def : n; };
    function read() {
      let e = num(localStorage.getItem(K.e), NaN), t = num(localStorage.getItem(K.t), NaN);
      if (Number.isNaN(e) || Number.isNaN(t)) { e = DEF.max; t = Date.now(); write(e, t); }
      return { e, t };
    }
    function write(e, t) { localStorage.setItem(K.e, e); localStorage.setItem(K.t, t); }
    function sync() {
      let { e, t } = read();
      if (e < DEF.max) {
        const g = Math.floor((Date.now() - t) / DEF.regenMs);
        if (g > 0) { e = Math.min(DEF.max, e + g); t = e >= DEF.max ? Date.now() : t + g * DEF.regenMs; write(e, t); }
      } else { write(e, Date.now()); }
      return read();
    }
    const curMax = () => num(localStorage.getItem(K.m), DEF.max);
    function state() {
      const M = curMax();
      const { e, t } = sync();
      const max = M;
      return {
        energy: e, max, regenMs: DEF.regenMs,
        msToNext: e >= max ? 0 : Math.max(0, DEF.regenMs - (Date.now() - t)),
        coins: num(localStorage.getItem(K.c), 0), best: num(localStorage.getItem(K.b), 0),
        prices: {
          refillOne: priceRefillOne(),
          refillFull: priceRefillFull(),
          maxUpgrade: Math.round(SHOP.maxUpgrade.coinsBase * Math.pow(MULTS.maxUpgrade, M - DEF.max)),
          maxUpgradeAvailable: true,
        },
        daily: dailyStatus(),
        quests: questsEnsure(),
        events: eventsActive(),
        weekly: weeklyStatusMock(),
        chest: chestStatus(),
        tournament: tournamentState(),
        levels: lvState(),
      };
    }
    function play() {
      const { e, t } = sync();
      if (e < EC.costPerGame) return { ok: false, ...state() };
      const wasFull = e >= curMax();
      write(e - EC.costPerGame, wasFull ? Date.now() : t);
      // seed для детерминированного поля даже в офлайне
      return { ok: true, seed: (Math.random() * 0xffffffff) >>> 0, ...state() };
    }
    function end(r) {
      const st = state();
      const coinsBase = Math.max(0, parseInt(r.coins, 10) || 0);
      const coinsGained = Math.round(coinsBase * coinMult());  // х2 в выходные
      localStorage.setItem(K.c, st.coins + coinsGained);
      chestBump();
      const eg = Math.max(0, parseInt(r.energy, 10) || 0);
      if (eg > 0) { const { e, t } = sync(); write(e + eg, t); }
      const newScore = parseInt(r.score, 10) || 0;
      localStorage.setItem(K.b, Math.max(st.best, newScore));
      tRecord(newScore);
      // XP и ап уровня (офлайн)
      const xpGained = Math.round(newScore / 10) + 5;
      const levelUps = lvAdd(xpGained);
      for (const up of levelUps) {
        const cur = parseInt(localStorage.getItem(K.c), 10) || 0;
        if (up.reward.coins)  localStorage.setItem(K.c, cur + up.reward.coins);
        if (up.reward.energy) { const { e, t } = sync(); write(e + up.reward.energy, t); }
      }
      // дневные цели
      const questsDone = questsProgress({
        score: parseInt(r.score, 10) || 0,
        matches: parseInt(r.matches, 10) || 0,
        maxCombo: parseInt(r.maxCombo, 10) || 0,
        coinsGained,
      });
      // награды за выполненные цели
      for (const q of questsDone) {
        const cur = parseInt(localStorage.getItem(K.c), 10) || 0;
        if (q.reward.coins) localStorage.setItem(K.c, cur + q.reward.coins);
        if (q.reward.energy) { const { e, t } = sync(); write(e + q.reward.energy, t); }
      }
      // недельный квест: копим очки
      const score = parseInt(r.score,10) || 0;
      const weeklyReward = weeklyProgress(score);
      if (weeklyReward) {
        const cur = parseInt(localStorage.getItem(K.c),10) || 0;
        localStorage.setItem(K.c, cur + weeklyReward.reward.coins);
        if (weeklyReward.reward.energy) { const { e, t } = sync(); write(e + weeklyReward.reward.energy, t); }
      }
      return { ...state(), questsDone, weeklyReward, levelUps, xpGained };
    }
    function buy(item) {
      const st = state();
      const M = curMax();
      if (item === 'refillOne') {
        if (st.energy >= M) return { ok: false, reason: 'already_full', ...state() };
        if (st.coins < st.prices.refillOne) return { ok: false, reason: 'no_coins', ...state() };
        localStorage.setItem(K.c, st.coins - st.prices.refillOne);
        const { e, t } = sync(); write(Math.min(M, e + 1), t);
        localStorage.setItem(K.cR1, num(localStorage.getItem(K.cR1), 0) + 1);
      } else if (item === 'refillFull') {
        if (st.energy >= M) return { ok: false, reason: 'already_full', ...state() };
        if (st.coins < st.prices.refillFull) return { ok: false, reason: 'no_coins', ...state() };
        localStorage.setItem(K.c, st.coins - st.prices.refillFull);
        write(M, Date.now());
        localStorage.setItem(K.cRF, num(localStorage.getItem(K.cRF), 0) + 1);
      } else if (item === 'maxUpgrade') {
        if (st.coins < st.prices.maxUpgrade) return { ok: false, reason: 'no_coins', ...state() };
        localStorage.setItem(K.c, st.coins - st.prices.maxUpgrade);
        localStorage.setItem(K.m, M + 1);
        const { e, t } = sync(); write(e + 1, t);
      } else return { ok: false, reason: 'bad_item', ...state() };
      return { ok: true, ...state() };
    }
    return { state, play, end, buy, dailyClaim, chestOpen };
  })();

  async function bootstrap() {
    try { applyServer(await API.state()); online = true; }
    catch (e) { online = false; applyServer(Mock.state()); console.warn('[Store] офлайн-режим (нет backend):', e.message); }
  }

  let currentGameId = null, currentGameSig = null;

  async function play() {
    if (online) {
      try {
        const d = await API.play();
        applyServer(d);
        currentGameId = d.gameId || null;
        currentGameSig = d.gameSig || null;
        return { ok: true, seed: d.seed };
      }
      catch (e) { if (e.status === 409) { applyServer(e.data); return { ok: false }; } throw e; }
    }
    const r = Mock.play(); applyServer(r); return { ok: r.ok, seed: r.seed };
  }

  async function end(result) {
    if (online) {
      try {
        const d = await API.end({ ...result, gameId: currentGameId, gameSig: currentGameSig });
        currentGameId = null; currentGameSig = null;
        applyServer(d);
        return { unlocked: d.unlocked || [], questsDone: d.questsDone || [], weeklyReward: d.weeklyReward || null, levelUps: d.levelUps || [], xpGained: d.xpGained || 0 };
      } catch (e) { console.warn('[Store] end failed:', e.message); return { unlocked: [], questsDone: [], weeklyReward: null, levelUps: [], xpGained: 0 }; }
    }
    const r = Mock.end(result);
    applyServer(r);
    return { unlocked: [], questsDone: r.questsDone || [], weeklyReward: r.weeklyReward || null, levelUps: r.levelUps || [], xpGained: r.xpGained || 0 };
  }

  async function buy(item) {
    if (online) {
      try { applyServer(await API.buy(item)); return { ok: true }; }
      catch (e) {
        if (e.status === 402 || e.status === 409) { if (e.data) applyServer(e.data); return { ok: false, reason: e.data && e.data.error }; }
        return { ok: false, reason: 'network' };
      }
    }
    const r = Mock.buy(item); applyServer(r); return { ok: r.ok, reason: r.reason };
  }

  async function buyBooster(item) {
    if (online) {
      try {
        const d = await API.buyBooster(item);
        applyServer(d);
        return { ok: true, effect: d.effect };
      } catch (e) {
        if (e.data) applyServer(e.data);
        return { ok: false, reason: e.data && e.data.error };
      }
    }
    // офлайн: списываем либо монеты, либо энергию
    const cfg = window.CONFIG.boosters[item];
    if (!cfg) return { ok: false, reason: 'bad_item' };
    const st = Mock.state();
    if (cfg.energy) {
      if (st.energy < cfg.energy) { applyServer(st); return { ok: false, reason: 'no_energy' }; }
      // списать энергию — используем тот же ключ, что Mock читает
      const wasFull = st.energy >= st.max;
      localStorage.setItem('m3_energy', st.energy - cfg.energy);
      if (wasFull) localStorage.setItem('m3_energy_ts', String(Date.now()));
    } else {
      if (st.coins < cfg.coins) { applyServer(st); return { ok: false, reason: 'no_coins' }; }
      localStorage.setItem('m3_coins', st.coins - cfg.coins);
    }
    applyServer(Mock.state());
    const effect = {};
    if (item === 'moves5') effect.moves = 5;
    if (item === 'movesEnergy') effect.moves = 3;
    if (item === 'shuffle') effect.shuffle = true;
    if (item === 'bomb') effect.bomb = true;
    return { ok: true, effect };
  }

  async function fetchLeaderboard(limit) {
    if (online) {
      try { return await API.leaderboard(limit || 50); }
      catch (e) { return { top: [], me: { rank: null, best: 0 } }; }
    }
    // офлайн: показываем только себя, как «топ недели = твой счёт»
    const my = s.tournament.myWeekBest || 0;
    return {
      top: my > 0 ? [{ rank: 1, name: 'Ты', best: my, isMe: true }] : [],
      me: { rank: my > 0 ? 1 : null, best: my, name: 'Ты' },
      prizes: [{rank:1,coins:1000},{rank:2,coins:500},{rank:3,coins:250}],
    };
  }

  async function dailyClaim() {
    if (online) {
      try { const d = await API.dailyClaim(); applyServer(d); return { ok: true, reward: d.reward }; }
      catch (e) { if (e.data) applyServer(e.data); return { ok: false, reason: e.data && e.data.error }; }
    }
    const r = Mock.dailyClaim();
    if (r.ok) applyServer(r);
    return { ok: r.ok, reward: r.reward, reason: r.reason };
  }

  async function openChest() {
    if (online) {
      try { const d = await API.chestOpen(); applyServer(d); return { ok: true, reward: d.reward }; }
      catch (e) { if (e.data) applyServer(e.data); return { ok: false, reason: e.data && e.data.error }; }
    }
    const r = Mock.chestOpen();
    if (r.ok) applyServer(Mock.state());
    return r;
  }

  async function resync() {
    if (online) { try { applyServer(await API.state()); } catch (_) {} }
    else applyServer(Mock.state());
  }

  return {
    bootstrap, play, end, buy, buyBooster, fetchLeaderboard, dailyClaim, openChest, resync,
    isOnline: () => online,
    get energy() { regenLocal(); return s.energy; },
    get max() { return s.max; },
    get coins() { return s.coins; },
    get best() { return s.best; },
    get prices() { return s.prices; },
    get daily() { return s.daily; },
    get quests() { return s.quests || { list: [] }; },
    get events() { return s.events || []; },
    get weekly() { return s.weekly || { progress: 0, target: 10000 }; },
    get chest() { return s.chest || { available: false, gamesToNext: 5 }; },
    get tournament() { return s.tournament || { myWeekBest: 0 }; },
    get pendingTournament() { return s.pendingTournament || null; },
    get levels() { return s.levels || { level: 1, xp: 0, currentLevelXp: 0, levelSpan: 100 }; },
    consumePendingTournament() { const p = s.pendingTournament; s.pendingTournament = null; return p; },
    get achievements() { return s.achievements || []; },
    get ownedSkins() { return s.ownedSkins || ['classic']; },
    async buySkin(skinId) {
      if (online) {
        try {
          const d = await API.buySkin(skinId);
          applyServer(d);
          return { ok: true };
        } catch (e) {
          if (e.data) applyServer(e.data);
          return { ok: false, reason: e.data && e.data.error };
        }
      }
      // Офлайн-фолбэк: локально списываем и добавляем в owned
      const priceMap = (window.CONFIG.skins || []).reduce((a, x) => (a[x.id] = x.price, a), {});
      const price = priceMap[skinId];
      if (price == null) return { ok: false, reason: 'bad_skin' };
      if (s.coins < price) return { ok: false, reason: 'no_coins' };
      const owned = new Set(s.ownedSkins || ['classic']);
      if (owned.has(skinId)) return { ok: false, reason: 'already_owned' };
      const curCoins = parseInt(localStorage.getItem('m3_coins') || String(s.coins), 10);
      localStorage.setItem('m3_coins', String(curCoins - price));
      s.coins = curCoins - price;
      owned.add(skinId);
      s.ownedSkins = Array.from(owned);
      localStorage.setItem('m3_skins_owned', JSON.stringify(s.ownedSkins));
      return { ok: true };
    },
    get stats() { return s.stats || {}; },
    get name() { return s.name || 'Игрок'; },
    get boosterPrices() { return s.boosterPrices || {}; },
    msToNext() { regenLocal(); return (s.energy >= s.max || !nextAt) ? 0 : Math.max(0, nextAt - Date.now()); },
  };
})();
