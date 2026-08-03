// Audio: 100% procedural WebAudio. Gunshots, zombie vocals, UI/purchase sounds,
// round stings, ambience (wind/drone), thunder, heartbeat, and a sequenced
// synthwave track for the musical easter egg.
export function initAudio(G) {
  const A = G.audio = { ready: false };

  A.boot = () => {
    if (A.ready) return;
    const ctx = A.ctx = new (window.AudioContext || window.webkitAudioContext)();
    A.master = ctx.createGain(); A.master.gain.value = 0.85;
    A.comp = ctx.createDynamicsCompressor();
    A.comp.threshold.value = -18; A.comp.ratio.value = 6;
    A.master.connect(A.comp).connect(ctx.destination);

    // reverb send
    A.verb = ctx.createConvolver();
    A.verb.buffer = impulse(ctx, 1.8, 2.4);
    A.verbGain = ctx.createGain(); A.verbGain.gain.value = 0.32;
    A.verb.connect(A.verbGain).connect(A.master);

    A.sfx = ctx.createGain(); A.sfx.gain.value = 1;
    A.sfx.connect(A.master); A.sfx.connect(A.verb);
    A.music = ctx.createGain(); A.music.gain.value = 0.5;
    A.music.connect(A.master);
    A.amb = ctx.createGain(); A.amb.gain.value = 0.5;
    A.amb.connect(A.master);

    A.noise = noiseBuffer(ctx);
    A.ready = true;
    startAmbience(A);
    wire(G, A);
  };

  A.growlT = 1.5;
  A.heartT = 0;
  A.musicSeq = null;
  return A;
}

function impulse(ctx, dur, decay) {
  const rate = ctx.sampleRate, len = rate * dur;
  const buf = ctx.createBuffer(2, len, rate);
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
  }
  return buf;
}
function noiseBuffer(ctx) {
  const buf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  return buf;
}

// ---------- primitive voices ----------
function env(ctx, node, t0, a, peak, d, out) {
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.linearRampToValueAtTime(peak, t0 + a);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + a + d);
  node.connect(g).connect(out);
  return g;
}
function burst(A, { dur = 0.2, filter = 'lowpass', f0 = 3000, f1 = 400, q = 0.8, peak = 0.5, when = 0, out = null, pan = 0 } = {}) {
  const ctx = A.ctx, t0 = ctx.currentTime + when;
  const src = ctx.createBufferSource(); src.buffer = A.noise;
  const fl = ctx.createBiquadFilter(); fl.type = filter; fl.Q.value = q;
  fl.frequency.setValueAtTime(f0, t0);
  fl.frequency.exponentialRampToValueAtTime(Math.max(40, f1), t0 + dur);
  src.connect(fl);
  const p = ctx.createStereoPanner(); p.pan.value = pan;
  fl.connect(p);
  env(ctx, p, t0, 0.004, peak, dur, out ?? A.sfx);
  // route through the same chain: env connected p->g->out. p already connected; fix below.
  src.start(t0); src.stop(t0 + dur + 0.05);
}
function tone(A, { type = 'sine', freq = 440, f1 = null, dur = 0.3, peak = 0.3, a = 0.005, when = 0, out = null, pan = 0 } = {}) {
  const ctx = A.ctx, t0 = ctx.currentTime + when;
  const o = ctx.createOscillator(); o.type = type;
  o.frequency.setValueAtTime(freq, t0);
  if (f1) o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t0 + dur);
  const p = ctx.createStereoPanner(); p.pan.value = pan;
  o.connect(p);
  env(ctx, p, t0, a, peak, dur, out ?? A.sfx);
  o.start(t0); o.stop(t0 + dur + a + 0.05);
}

// ---------- composite sounds ----------
function gunshot(A, kind) {
  if (!A.ready) return;
  const v = (Math.random() - 0.5) * 0.15 + 1;
  if (kind === 'ray') {
    tone(A, { type: 'sawtooth', freq: 1500 * v, f1: 220, dur: 0.22, peak: 0.4 });
    tone(A, { type: 'sine', freq: 2400 * v, f1: 500, dur: 0.14, peak: 0.24 });
    return;
  }
  const p = {
    pistol: { f0: 4200, f1: 500, dur: 0.13, boom: 150, boomDur: 0.1, peak: 0.6 },
    rifle: { f0: 3600, f1: 300, dur: 0.2, boom: 110, boomDur: 0.17, peak: 0.78 },
    smg: { f0: 4800, f1: 700, dur: 0.09, boom: 170, boomDur: 0.07, peak: 0.5 },
    shotgun: { f0: 2800, f1: 180, dur: 0.32, boom: 80, boomDur: 0.26, peak: 0.95 },
  }[kind] ?? { f0: 4000, f1: 400, dur: 0.15, boom: 130, boomDur: 0.12, peak: 0.6 };
  burst(A, { f0: p.f0 * v, f1: p.f1, dur: p.dur, peak: p.peak });
  tone(A, { type: 'sine', freq: p.boom * v, f1: p.boom * 0.4, dur: p.boomDur, peak: p.peak * 0.8 });
  tone(A, { type: 'square', freq: 2600, dur: 0.012, peak: 0.22 }); // mechanical click
}

function growl(A, dist, pan, kind = 'idle') {
  if (!A.ready) return;
  const ctx = A.ctx, t0 = ctx.currentTime;
  const vol = Math.max(0.03, Math.min(0.5, 8 / (dist + 4))) * (kind === 'attack' ? 1.6 : 1);
  const dur = kind === 'attack' ? 0.5 : 0.5 + Math.random() * 0.9;
  const base = (kind === 'attack' ? 120 : 75) + Math.random() * 55;
  const o = ctx.createOscillator(); o.type = 'sawtooth';
  o.frequency.setValueAtTime(base, t0);
  o.frequency.linearRampToValueAtTime(base * (kind === 'death' ? 0.5 : 0.8 + Math.random() * 0.5), t0 + dur);
  const lfo = ctx.createOscillator(); lfo.frequency.value = 9 + Math.random() * 8;
  const lfoG = ctx.createGain(); lfoG.gain.value = base * 0.25;
  lfo.connect(lfoG).connect(o.frequency);
  const fl = ctx.createBiquadFilter(); fl.type = 'bandpass';
  fl.frequency.setValueAtTime(300 + Math.random() * 300, t0);
  fl.frequency.linearRampToValueAtTime(200 + Math.random() * 200, t0 + dur);
  fl.Q.value = 1.6;
  const p = ctx.createStereoPanner(); p.pan.value = pan;
  o.connect(fl).connect(p);
  env(ctx, p, t0, 0.06, vol, dur, A.sfx);
  // breath noise layer
  const src = ctx.createBufferSource(); src.buffer = A.noise;
  const nf = ctx.createBiquadFilter(); nf.type = 'bandpass'; nf.frequency.value = 900; nf.Q.value = 0.6;
  const np = ctx.createStereoPanner(); np.pan.value = pan;
  src.connect(nf).connect(np);
  env(ctx, np, t0, 0.05, vol * 0.4, dur, A.sfx);
  o.start(t0); o.stop(t0 + dur + 0.1);
  lfo.start(t0); lfo.stop(t0 + dur + 0.1);
  src.start(t0); src.stop(t0 + dur + 0.1);
}

function roundSting(A, kind) {
  if (!A.ready) return;
  const notes = kind === 'start' ? [98, 92.5, 98, 110] : [196, 185, 165];
  notes.forEach((f, i) => {
    tone(A, { type: 'sawtooth', freq: f, dur: 1.4, peak: 0.16, a: 0.3, when: i * 0.4, out: A.music });
    tone(A, { type: 'sawtooth', freq: f * 1.007, dur: 1.4, peak: 0.12, a: 0.3, when: i * 0.4, out: A.music });
  });
  if (kind === 'start') tone(A, { type: 'sine', freq: 49, dur: 2.2, peak: 0.5, a: 0.02, out: A.music });
}

function startAmbience(A) {
  const ctx = A.ctx;
  // wind: looping filtered noise with slow LFO on filter + gain
  const src = ctx.createBufferSource(); src.buffer = A.noise; src.loop = true;
  const fl = ctx.createBiquadFilter(); fl.type = 'bandpass'; fl.frequency.value = 300; fl.Q.value = 0.4;
  const g = ctx.createGain(); g.gain.value = 0.055;
  const lfo = ctx.createOscillator(); lfo.frequency.value = 0.07;
  const lfoG = ctx.createGain(); lfoG.gain.value = 160;
  lfo.connect(lfoG).connect(fl.frequency);
  const lfo2 = ctx.createOscillator(); lfo2.frequency.value = 0.11;
  const lfo2G = ctx.createGain(); lfo2G.gain.value = 0.03;
  lfo2.connect(lfo2G).connect(g.gain);
  src.connect(fl).connect(g).connect(A.amb);
  src.start(); lfo.start(); lfo2.start();
  // low dread drone
  const d1 = ctx.createOscillator(); d1.type = 'sine'; d1.frequency.value = 41;
  const d2 = ctx.createOscillator(); d2.type = 'sine'; d2.frequency.value = 41.7;
  const dg = ctx.createGain(); dg.gain.value = 0.045;
  d1.connect(dg); d2.connect(dg); dg.connect(A.amb);
  d1.start(); d2.start();
}

// ---------- musical easter egg (sequenced synthwave) ----------
function startSong(A, G) {
  if (!A.ready || A.musicSeq) return;
  const bpm = 122, spb = 60 / bpm, bar = spb * 4;
  const seq = A.musicSeq = { step: 0, next: A.ctx.currentTime + 0.1, end: A.ctx.currentTime + 96, spb };
  const minor = [0, 2, 3, 5, 7, 8, 10];
  const root = 110; // A minor
  const nf = (deg, oct = 0) => root * Math.pow(2, (minor[((deg % 7) + 7) % 7] + Math.floor(deg / 7) * 12) / 12 + oct);
  seq.tick = () => {
    const ctx = A.ctx;
    while (seq.next < ctx.currentTime + 0.25) {
      const s = seq.step % 16, b = Math.floor(seq.step / 16) % 8;
      const t0 = seq.next - ctx.currentTime;
      // kick on quarters
      if (s % 4 === 0) tone(A, { type: 'sine', freq: 130, f1: 42, dur: 0.16, peak: 0.7, when: t0, out: A.music });
      // snare on 4 & 12
      if (s === 4 || s === 12) burst(A, { f0: 3000, f1: 900, dur: 0.14, peak: 0.35, filter: 'highpass', when: t0, out: A.music });
      // hats on 8ths
      if (s % 2 === 0) burst(A, { f0: 9000, f1: 7000, dur: 0.03, peak: 0.1, filter: 'highpass', when: t0, out: A.music });
      // bass line
      const bassPat = [0, 0, 5, 3];
      tone(A, { type: 'sawtooth', freq: nf(bassPat[b % 4], -1), dur: 0.2, peak: 0.3, when: t0, out: A.music });
      // arp lead every other 16th
      if (s % 2 === 1 && b >= 2) {
        const arp = [0, 2, 4, 7][Math.floor(s / 4)];
        tone(A, { type: 'square', freq: nf(arp + bassPat[b % 4], 1), dur: 0.12, peak: 0.09, when: t0, out: A.music });
      }
      // pad at bar starts
      if (s === 0) {
        [0, 2, 4].forEach(d => tone(A, { type: 'sawtooth', freq: nf(d + bassPat[b % 4]), dur: bar, peak: 0.05, a: 0.4, when: t0, out: A.music }));
      }
      seq.step++;
      seq.next += spb / 4;
    }
    if (ctx.currentTime > seq.end) A.musicSeq = null;
  };
}

// ---------- event wiring ----------
function wire(G, A) {
  const E = G.events;
  G.audioTone = (freq, dur, peak, when) => tone(A, { type: 'sine', freq, dur, peak, when });
  const kindOf = { kestrel: 'pistol', longarm: 'rifle', vulture: 'smg', mauler: 'shotgun', raygun: 'ray' };
  E.on('shotFired', ({ weapon }) => gunshot(A, kindOf[weapon] ?? 'pistol'));
  E.on('dryFire', () => tone(A, { type: 'square', freq: 1800, dur: 0.03, peak: 0.15 }));
  E.on('reloadStart', (st) => {
    burst(A, { f0: 2000, f1: 800, dur: 0.05, peak: 0.2 });
    burst(A, { f0: 1400, f1: 600, dur: 0.05, peak: 0.22, when: st.reload * 0.3 });
    burst(A, { f0: 2600, f1: 1000, dur: 0.06, peak: 0.28, when: st.reload * 0.75 });
  });
  E.on('knifeSwing', () => burst(A, { f0: 600, f1: 3000, dur: 0.12, peak: 0.2, filter: 'bandpass' }));
  E.on('grenadeThrow', () => burst(A, { f0: 400, f1: 1800, dur: 0.16, peak: 0.14, filter: 'bandpass' }));
  E.on('explosion', () => {
    burst(A, { f0: 900, f1: 60, dur: 0.9, peak: 1.1 });
    tone(A, { type: 'sine', freq: 55, f1: 28, dur: 0.8, peak: 0.9 });
  });
  E.on('hitmarker', () => tone(A, { type: 'square', freq: 2200, dur: 0.018, peak: 0.08 }));
  E.on('zombieHitPlayer', () => {
    burst(A, { f0: 500, f1: 150, dur: 0.2, peak: 0.5, filter: 'bandpass' });
    growl(A, 1, 0, 'attack');
  });
  E.on('playerHurt', () => tone(A, { type: 'sine', freq: 180, f1: 90, dur: 0.15, peak: 0.3 }));
  E.on('purchase', () => {
    burst(A, { f0: 1800, f1: 700, dur: 0.06, peak: 0.3 });
    tone(A, { type: 'sine', freq: 1320, dur: 0.3, peak: 0.14, when: 0.05 });
  });
  E.on('noFunds', () => tone(A, { type: 'square', freq: 140, dur: 0.18, peak: 0.2 }));
  E.on('doorOpened', () => burst(A, { f0: 800, f1: 100, dur: 0.5, peak: 0.6 }));
  E.on('plankTorn', () => burst(A, { f0: 1200, f1: 300, dur: 0.18, peak: 0.4 }));
  E.on('plankRebuilt', () => {
    burst(A, { f0: 2200, f1: 900, dur: 0.04, peak: 0.3 });
    burst(A, { f0: 2000, f1: 800, dur: 0.04, peak: 0.3, when: 0.12 });
  });
  E.on('roundStart', () => roundSting(A, 'start'));
  E.on('roundEnd', () => roundSting(A, 'end'));
  E.on('powerup', () => {
    [880, 1108, 1318, 1760].forEach((f, i) => tone(A, { type: 'square', freq: f, dur: 0.12, peak: 0.14, when: i * 0.08 }));
  });
  E.on('perkBought', () => {
    [523, 659, 783, 1046].forEach((f, i) => tone(A, { type: 'sine', freq: f, dur: 0.2, peak: 0.16, when: i * 0.12 }));
  });
  E.on('boxRoll', () => {
    for (let i = 0; i < 8; i++) tone(A, { type: 'sine', freq: 700 + i * 80, dur: 0.14, peak: 0.1, when: i * 0.38 });
  });
  E.on('boxDone', () => tone(A, { type: 'sine', freq: 1560, dur: 0.5, peak: 0.2 }));
  E.on('papStart', () => {
    for (let i = 0; i < 5; i++) burst(A, { f0: 1500, f1: 400, dur: 0.1, peak: 0.25, when: i * 0.5 });
    tone(A, { type: 'sawtooth', freq: 82, dur: 3.2, peak: 0.2, a: 0.3 });
  });
  E.on('papDone', () => [660, 880, 1320].forEach((f, i) => tone(A, { type: 'sine', freq: f, dur: 0.3, peak: 0.18, when: i * 0.14 })));
  E.on('lightning', () => {
    const delay = 0.7 + Math.random() * 1.6;
    burst(A, { f0: 300, f1: 40, dur: 2.6, peak: 0.5, when: delay });
    tone(A, { type: 'sine', freq: 48, f1: 25, dur: 2.2, peak: 0.35, when: delay + 0.1 });
  });
  E.on('jump', () => {});
  E.on('land', () => burst(A, { f0: 400, f1: 120, dur: 0.09, peak: 0.16 }));
  E.on('playSong', () => startSong(A, G));
  E.on('nuke', () => {
    tone(A, { type: 'sine', freq: 60, f1: 30, dur: 1.4, peak: 0.7 });
    burst(A, { f0: 2000, f1: 100, dur: 1.2, peak: 0.5 });
  });
  E.on('graveRise', () => burst(A, { f0: 500, f1: 90, dur: 0.6, peak: 0.3 }));
  E.on('weaponSwap', () => burst(A, { f0: 2400, f1: 1200, dur: 0.04, peak: 0.15 }));
}

// ---------- per-frame ----------
export function updateAudio(G, dt, t) {
  const A = G.audio;
  if (!A.ready) return;

  // zombie growl scheduler
  A.growlT -= dt;
  if (A.growlT <= 0) {
    A.growlT = 0.7 + Math.random() * 1.6;
    const P = G.player;
    const cands = G.zombies.list.filter(z => !z.gone && z.state !== 'dead' && z.state !== 'posed');
    if (cands.length) {
      const z = cands[Math.floor(Math.random() * cands.length)];
      const dx = z.group.position.x - P.pos.x, dz = z.group.position.z - P.pos.z;
      const dist = Math.hypot(dx, dz);
      if (dist < 30) {
        // pan by bearing relative to look direction
        const bearing = Math.atan2(dx, dz) - P.yaw;
        growl(A, dist, Math.max(-1, Math.min(1, -Math.sin(bearing))), z.state === 'attacking' ? 'attack' : 'idle');
      }
    }
  }

  // footsteps on bob peaks
  const P = G.player;
  const planar = Math.hypot(P.vel.x, P.vel.z);
  const stepPhase = Math.sin(P.bobPhase * 2);
  if (planar > 1 && P.onGround && stepPhase > 0.92 && !A._stepLatch) {
    A._stepLatch = true;
    burst(A, { f0: 300, f1: 90, dur: 0.07, peak: 0.07 + Math.min(0.06, planar * 0.012) });
  } else if (stepPhase < 0.5) A._stepLatch = false;

  // low-health heartbeat
  if (!P.dead && P.health < 40) {
    A.heartT -= dt;
    if (A.heartT <= 0) {
      A.heartT = 0.9;
      tone(A, { type: 'sine', freq: 55, dur: 0.1, peak: 0.5 });
      tone(A, { type: 'sine', freq: 50, dur: 0.09, peak: 0.35, when: 0.16 });
    }
  }

  // music sequencer
  if (A.musicSeq) A.musicSeq.tick();
}
