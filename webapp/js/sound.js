/*
 * Звуки игры — приглушённые, ненавязчивые.
 * Sine-волны в низком/среднем диапазоне + lowpass-фильтр обрезает
 * высокие частоты, чтобы звук был «тёплым», без звона.
 *
 * Состояние mute в localStorage: m3_mute = '1' / ''.
 */
window.Snd = (() => {
  let ctx = null, master = null, lp = null;
  function ensure() {
    if (ctx) return ctx;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = 0.28;            // общая громкость
    lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 1600;           // обрезка высоких → приглушённый тембр
    lp.Q.value = 0.4;
    master.connect(lp).connect(ctx.destination);
    return ctx;
  }
  const muted = () => localStorage.getItem('m3_mute') === '1';
  const setMuted = (v) => localStorage.setItem('m3_mute', v ? '1' : '');

  // Мягкая нота с плавным затуханием. Только sine — самый «бесшумный» тембр.
  function note(freq, when, dur = 0.12, peak = 0.18) {
    const c = ensure(); if (!c) return;
    const t0 = c.currentTime + when;
    const o = c.createOscillator();
    const g = c.createGain();
    o.type = 'sine';
    o.frequency.setValueAtTime(freq, t0);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(peak, t0 + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g).connect(master);
    o.start(t0);
    o.stop(t0 + dur + 0.02);
  }
  function play(seq) {
    if (muted()) return;
    const c = ensure(); if (!c) return;
    if (c.state === 'suspended') c.resume();
    for (const n of seq) note(n.f, n.t || 0, n.d || 0.12, n.v || 0.18);
  }

  return {
    // Мягкий «туп-пуп» — два близких тона, чтобы был заметнее одной ноты,
    // но всё равно глухой и короткий.
    match: () => play([
      { f: 380, t: 0,    d: 0.10, v: 0.22 },
      { f: 300, t: 0.04, d: 0.12, v: 0.18 },
    ]),
    // Каскад — мягкая лесенка из 2 нот, чуть выше с каждым уровнем
    combo: (n) => {
      const base = 240 + Math.min(n, 5) * 25;
      play([
        { f: base,       t: 0,    d: 0.10, v: 0.16 },
        { f: base * 1.2, t: 0.06, d: 0.12, v: 0.14 },
      ]);
    },
    // Награда — тёплая «капля»
    reward: () => play([
      { f: 330, t: 0,    d: 0.14, v: 0.18 },
      { f: 440, t: 0.05, d: 0.16, v: 0.16 },
    ]),
    // Конец игры — низкий протяжный гул
    end: () => play([
      { f: 196, t: 0,    d: 0.30, v: 0.18 },
      { f: 261, t: 0.18, d: 0.40, v: 0.16 },
    ]),
    // Клик — почти неслышный шорох
    click: () => play([{ f: 180, t: 0, d: 0.04, v: 0.10 }]),
    // Достижение — короткое мягкое «дзинь» из двух нот
    achievement: () => play([
      { f: 392, t: 0,    d: 0.16, v: 0.16 },
      { f: 523, t: 0.10, d: 0.22, v: 0.18 },
    ]),
    fail: () => play([{ f: 140, t: 0, d: 0.14, v: 0.14 }]),
    muted, setMuted,
  };
})();
