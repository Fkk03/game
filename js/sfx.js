/* ============ sfx.js — all sound synthesized with WebAudio, no samples ============ */
'use strict';
const SFX = (() => {
  let ctx = null, master = null, muted = false;
  let lastPlay = {};            // throttle per-sound
  let voiceQueue = [], speaking = false, voiceOn = true;

  function ensure() {
    if (!ctx) {
      try {
        ctx = new (window.AudioContext || window.webkitAudioContext)();
        master = ctx.createGain();
        master.gain.value = 0.5;
        master.connect(ctx.destination);
      } catch (e) { /* audio unavailable */ }
    }
    if (ctx && ctx.state === 'suspended') ctx.resume();
    return !!ctx;
  }

  function noiseBuffer(dur) {
    const n = Math.floor(ctx.sampleRate * dur);
    const buf = ctx.createBuffer(1, n, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
    return buf;
  }

  // gain scaled by distance from camera center (worldX/Y optional)
  function spatialGain(base, wx, wy) {
    if (wx === undefined || typeof game === 'undefined' || !game || !game.cam) return base;
    const cx = game.cam.x + (window.innerWidth / 2) / game.cam.zoom;
    const cy = game.cam.y + (window.innerHeight / 2) / game.cam.zoom;
    const d = U.dist(wx, wy, cx, cy);
    const f = U.clamp(1 - d / 1400, 0.05, 1);
    return base * f * f;
  }

  function throttled(key, minGap) {
    const t = ctx.currentTime;
    if (lastPlay[key] && t - lastPlay[key] < minGap) return true;
    lastPlay[key] = t;
    return false;
  }

  function env(g, t0, peak, a, d, sustainLevel = 0.0001) {
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.linearRampToValueAtTime(peak, t0 + a);
    g.gain.exponentialRampToValueAtTime(Math.max(sustainLevel, 0.0001), t0 + a + d);
  }

  function osc(type, f0, f1, dur, peak, t0) {
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type; o.frequency.setValueAtTime(f0, t0);
    if (f1 !== null) o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t0 + dur);
    env(g, t0, peak, 0.005, dur);
    o.connect(g); g.connect(master);
    o.start(t0); o.stop(t0 + dur + 0.05);
  }

  function noise(dur, peak, t0, filterType, f0, f1, q) {
    const src = ctx.createBufferSource();
    src.buffer = noiseBuffer(dur);
    const flt = ctx.createBiquadFilter();
    flt.type = filterType || 'lowpass';
    flt.frequency.setValueAtTime(f0 || 1000, t0);
    if (f1) flt.frequency.exponentialRampToValueAtTime(f1, t0 + dur);
    flt.Q.value = q || 0.8;
    const g = ctx.createGain();
    env(g, t0, peak, 0.004, dur);
    src.connect(flt); flt.connect(g); g.connect(master);
    src.start(t0); src.stop(t0 + dur + 0.05);
  }

  const api = {
    init() { ensure(); },
    toggleMute() {
      muted = !muted;
      if (master) master.gain.value = muted ? 0 : 0.5;
      if (muted && window.speechSynthesis) speechSynthesis.cancel();
      return muted;
    },
    isMuted() { return muted; },

    /* ------- effects (all take optional world coords for distance falloff) ------- */
    shot(wx, wy) {
      if (!ensure() || muted || throttled('shot', 0.03)) return;
      const t = ctx.currentTime, v = spatialGain(0.16, wx, wy);
      if (v < 0.01) return;
      noise(0.07, v, t, 'bandpass', 1800, 500, 1.2);
    },
    /* a strike flight running in overhead */
    jetpass(wx, wy) {
      if (!ensure() || muted || throttled('jetpass', 0.25)) return;
      const t = ctx.currentTime, v = spatialGain(0.34, wx, wy);
      if (v < 0.01) return;
      noise(1.1, v, t, 'bandpass', 620, 220, 0.8);
      osc('sawtooth', 190, 95, 1.1, v * 0.3, t);
    },
    gatling(wx, wy) {
      if (!ensure() || muted || throttled('gat', 0.05)) return;
      const t = ctx.currentTime, v = spatialGain(0.11, wx, wy);
      if (v < 0.01) return;
      noise(0.05, v, t, 'bandpass', 2400, 900, 1.5);
    },
    cannon(wx, wy) {
      if (!ensure() || muted || throttled('cannon', 0.08)) return;
      const t = ctx.currentTime, v = spatialGain(0.32, wx, wy);
      if (v < 0.01) return;
      noise(0.22, v, t, 'lowpass', 900, 120);
      osc('sine', 110, 38, 0.25, v * 0.9, t);
    },
    rocket(wx, wy) {
      if (!ensure() || muted || throttled('rocket', 0.06)) return;
      const t = ctx.currentTime, v = spatialGain(0.16, wx, wy);
      if (v < 0.01) return;
      noise(0.45, v, t, 'bandpass', 600, 2600, 2);
    },
    flame(wx, wy) {
      if (!ensure() || muted || throttled('flame', 0.15)) return;
      const t = ctx.currentTime, v = spatialGain(0.10, wx, wy);
      if (v < 0.01) return;
      noise(0.4, v, t, 'lowpass', 1400, 700);
    },
    explo(wx, wy, size = 1) {
      if (!ensure() || muted || throttled('explo', 0.05)) return;
      const t = ctx.currentTime, v = spatialGain(0.30 * Math.min(size, 2.2), wx, wy);
      if (v < 0.01) return;
      noise(0.5 * size, v, t, 'lowpass', 1600, 90);
      osc('sine', 90, 26, 0.45 * size, v, t);
    },
    bigExplo(wx, wy) {
      if (!ensure() || muted) return;
      const t = ctx.currentTime, v = spatialGain(0.55, wx, wy);
      noise(1.6, v, t, 'lowpass', 1200, 45);
      osc('sine', 70, 18, 1.4, v, t);
      osc('sine', 45, 14, 1.8, v * 0.7, t + 0.1);
    },
    beam(wx, wy) {
      if (!ensure() || muted) return;
      const t = ctx.currentTime, v = spatialGain(0.4, wx, wy);
      osc('sawtooth', 1400, 300, 1.6, v * 0.4, t);
      noise(1.6, v * 0.6, t, 'highpass', 900, 2500, 2);
    },
    click() { if (!ensure() || muted) return; const t = ctx.currentTime; osc('square', 900, 700, 0.035, 0.07, t); },
    error() { if (!ensure() || muted) return; const t = ctx.currentTime; osc('square', 240, 160, 0.14, 0.10, t); },
    cash()  { if (!ensure() || muted || throttled('cash', 0.4)) return; const t = ctx.currentTime;
      osc('sine', 1150, 1150, 0.05, 0.08, t); osc('sine', 1500, 1500, 0.06, 0.08, t + 0.06); },
    build() { if (!ensure() || muted) return; const t = ctx.currentTime;
      osc('sine', 500, 500, 0.08, 0.12, t); osc('sine', 760, 760, 0.10, 0.12, t + 0.09); },
    ready() { if (!ensure() || muted) return; const t = ctx.currentTime;
      osc('sine', 620, 620, 0.07, 0.13, t); osc('sine', 830, 830, 0.07, 0.13, t + 0.08);
      osc('sine', 1080, 1080, 0.11, 0.13, t + 0.16); },
    promote() { if (!ensure() || muted) return; const t = ctx.currentTime;
      [520, 660, 780, 1040].forEach((f, i) => osc('sine', f, f, 0.1, 0.12, t + i * 0.07)); },
    alarm() { if (!ensure() || muted || throttled('alarm', 3)) return; const t = ctx.currentTime;
      for (let i = 0; i < 3; i++) osc('square', 700, 480, 0.16, 0.10, t + i * 0.2); },
    klaxon() { if (!ensure() || muted || throttled('klaxon', 4)) return; const t = ctx.currentTime;
      for (let i = 0; i < 4; i++) { osc('sawtooth', 400, 700, 0.3, 0.09, t + i * 0.35); } },
    select() { if (!ensure() || muted || throttled('sel', 0.08)) return; const t = ctx.currentTime;
      osc('square', 1300, 1500, 0.03, 0.045, t); },
    ack() { if (!ensure() || muted || throttled('ack', 0.15)) return; const t = ctx.currentTime;
      osc('square', 850, 1150, 0.04, 0.05, t); osc('square', 1150, 900, 0.04, 0.05, t + 0.05); },

    /* ------- EVA-style voice via speechSynthesis (optional, graceful fallback) ------- */
    say(text, priority) {
      if (muted || !voiceOn || !window.speechSynthesis) return;
      if (speaking && !priority) { if (voiceQueue.length < 2) voiceQueue.push(text); return; }
      try {
        const u = new SpeechSynthesisUtterance(text);
        u.rate = 1.05; u.pitch = 0.6; u.volume = 0.85;
        u.onend = () => { speaking = false;
          const nxt = voiceQueue.shift();
          if (nxt) api.say(nxt); };
        u.onerror = () => { speaking = false; };
        speaking = true;
        speechSynthesis.speak(u);
      } catch (e) { speaking = false; }
    },
  };
  return api;
})();
