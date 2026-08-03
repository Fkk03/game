// audio.js — RTS audio, all WebAudio-synthesized (no samples). OWNED BY:
// audio agent.
// ---------------------------------------------------------------------------
// PUBLIC API: G.audio.cue(name, opts) — fire-and-forget sound cues.
//   opts: { x, z }  world position → distance attenuation from the camera
//          target (G.camRig.tx/tz); omit for full-volume UI sounds.
//         { r }     explosion radius → boom size.
// CUE LIST (unknown names no-op safely):
//   ui_click     small interface tick             ui_deny   "can't do that" buzz
//   sel          selection blip                   ack_move  order acknowledged
//   ack_attack   attack order acknowledged
//   fire_bullet  rifle/MG rattle                  fire_shell  tank cannon thump
//   fire_rocket  rocket whoosh                    fire_flak   quad/AA pom
//   fire_beam    energy weapon                    fire_flame  flame gout
//   explosion    boom, scaled by opts.r
//   build_place  building placement thunk         build_done  construction chime
//   unit_ready   unit produced blip
//   promotion    general's promotion fanfare      power_ready power off cooldown
//   power_cast   power activation whoosh
//   sw_klaxon    superweapon armed klaxon         sw_launch   superweapon launch
//   sw_beam      particle beam hum                rocket      scud/artillery launch
//   plane        aircraft flyby                   paradrop    chute flutter
//   a10_gun      avenger cannon brrrt             repair      wrench clatter
//   ambush       sand-burst whoosh                toxin       toxin bubble
//   bounty       coin chime
//   lowpower     low power warning                underattack base attack alarm
//   victory      win stinger                      defeat      loss stinger
// Per-cue rate limits stop machine-gun spam from stacking; positional cues
// fade with distance from the camera. A soft desert-wind ambience runs
// underneath.
// EVENT HOOKS (wired in init): 'entity:died' → explosion + under-attack
// alarm for human losses, 'rank:up' → promotion fanfare, 'game:over' →
// victory/defeat stingers, 'entity:built' → placement thunk.
// LEGACY SHIMS: enemyShot(dist), rocketLaunch(), explosion(size) — FPS-era
// method names combat.js calls; they route into the same cue kit.
// LIFECYCLE: main.js calls G.audio.init() at game start (a user gesture).
// The AudioContext is created only there; if the context is unavailable or
// suspended everything degrades to silent no-ops — the game never crashes
// without audio. SHOT_MODE forces fully-silent mode (no context at all).
// ---------------------------------------------------------------------------
import { G, on, clamp, SHOT_MODE } from './core.js';

// per-cue minimum interval (seconds)
const LIMITS = {
  ui_click: 0.03, ui_deny: 0.15, sel: 0.08, ack_move: 0.15, ack_attack: 0.15,
  fire_bullet: 0.055, fire_shell: 0.09, fire_rocket: 0.1, fire_flak: 0.05,
  fire_beam: 0.2, fire_flame: 0.18, explosion: 0.07,
  build_place: 0.25, build_done: 0.4, unit_ready: 0.35,
  promotion: 1.5, power_ready: 0.6, power_cast: 0.35,
  sw_klaxon: 2.5, sw_launch: 1, sw_beam: 0.45, rocket: 0.12,
  plane: 0.9, paradrop: 0.3, a10_gun: 0.5, repair: 0.5, ambush: 0.5,
  toxin: 0.5, bounty: 0.28, lowpower: 6, underattack: 15,
  victory: 10, defeat: 10,
};

// cue implementations — (a: AudioSys, v: 0..1 distance volume, o: opts)
const CUES = {
  ui_click: (a) => a.tone({ dur: 0.035, from: 1900, to: 1300, type: 'square', gain: 0.06 }),
  ui_deny: (a) => {
    a.tone({ dur: 0.09, from: 240, to: 185, type: 'square', gain: 0.11 });
    a.tone({ dur: 0.13, from: 210, to: 140, type: 'square', gain: 0.11, at: 0.11 });
  },
  sel: (a) => a.tone({ dur: 0.045, from: 880, to: 1240, type: 'sine', gain: 0.09 }),
  ack_move: (a) => {
    a.burst({ dur: 0.05, freq: 2300, type: 'bandpass', q: 6, gain: 0.05 });
    a.tone({ dur: 0.06, from: 660, to: 860, type: 'sine', gain: 0.1 });
    a.tone({ dur: 0.05, from: 990, to: 990, type: 'sine', gain: 0.08, at: 0.07 });
  },
  ack_attack: (a) => {
    a.burst({ dur: 0.05, freq: 2300, type: 'bandpass', q: 6, gain: 0.06 });
    a.tone({ dur: 0.07, from: 520, to: 390, type: 'square', gain: 0.09 });
    a.tone({ dur: 0.06, from: 640, to: 470, type: 'square', gain: 0.08, at: 0.08 });
  },
  fire_bullet: (a, v) => {
    a.burst({ dur: 0.06, freq: 2400, gain: 0.26 * v, sweep: 0.15 });
    a.burst({ dur: 0.09, freq: 440, gain: 0.2 * v, sweep: 0.5 });
  },
  fire_shell: (a, v) => {
    a.tone({ dur: 0.22, from: 150, to: 40, type: 'sine', gain: 0.5 * v });
    a.burst({ dur: 0.18, freq: 620, gain: 0.38 * v, sweep: 0.18 });
  },
  fire_rocket: (a, v) => {
    a.burst({ dur: 0.42, freq: 480, type: 'bandpass', q: 1.3, gain: 0.32 * v, sweep: 2.8 });
    a.tone({ dur: 0.3, from: 230, to: 90, type: 'sawtooth', gain: 0.1 * v });
  },
  fire_flak: (a, v) => {
    a.tone({ dur: 0.07, from: 340, to: 130, type: 'square', gain: 0.18 * v });
    a.burst({ dur: 0.08, freq: 1600, gain: 0.18 * v, sweep: 0.3 });
  },
  fire_beam: (a, v) => {
    a.tone({ dur: 0.28, from: 320, to: 1500, type: 'sawtooth', gain: 0.12 * v });
    a.tone({ dur: 0.22, from: 1900, to: 2500, type: 'sine', gain: 0.08 * v });
  },
  fire_flame: (a, v) => a.burst({ dur: 0.4, freq: 720, gain: 0.24 * v, sweep: 0.4 }),
  explosion: (a, v, o) => {
    const s = clamp((o.r ?? 4) / 8, 0.45, 2.6);
    a.tone({ dur: 0.45 + 0.28 * s, from: 115, to: 26, type: 'sine', gain: Math.min(0.9, 0.5 * s + 0.25) * v });
    a.burst({ dur: 0.55 + 0.3 * s, freq: 640, gain: 0.5 * v, sweep: 0.08 });
    a.burst({ dur: 0.2, freq: 2900, gain: 0.2 * v, sweep: 0.12 });
    if (s > 1.4) a.tone({ dur: 1.5, from: 58, to: 22, type: 'triangle', gain: 0.42 * v, at: 0.08 });
  },
  build_place: (a, v) => {
    a.tone({ dur: 0.16, from: 95, to: 44, type: 'sine', gain: 0.5 * v });
    a.burst({ dur: 0.12, freq: 300, gain: 0.28 * v, sweep: 0.4 });
  },
  build_done: (a) => {
    a.tone({ dur: 0.1, from: 784, to: 784, type: 'triangle', gain: 0.16 });
    a.tone({ dur: 0.22, from: 1046, to: 1046, type: 'triangle', gain: 0.16, at: 0.11 });
  },
  unit_ready: (a) => {
    a.tone({ dur: 0.05, from: 620, to: 620, type: 'square', gain: 0.06 });
    a.tone({ dur: 0.12, from: 930, to: 930, type: 'sine', gain: 0.13, at: 0.05 });
  },
  promotion: (a) => {
    const notes = [392, 523, 659, 784];
    notes.forEach((f, i) => {
      a.tone({ dur: 0.14, from: f, to: f, type: 'sawtooth', gain: 0.1, at: i * 0.13 });
      a.tone({ dur: 0.14, from: f * 2, to: f * 2, type: 'sine', gain: 0.07, at: i * 0.13 });
    });
    a.tone({ dur: 0.55, from: 1046, to: 1046, type: 'sawtooth', gain: 0.12, at: 0.52 });
    a.tone({ dur: 0.55, from: 523, to: 523, type: 'triangle', gain: 0.12, at: 0.52 });
    a.burst({ dur: 0.3, freq: 5200, type: 'highpass', gain: 0.05, sweep: 0.6, at: 0.52 });
  },
  power_ready: (a) => {
    a.tone({ dur: 0.09, from: 660, to: 660, type: 'sine', gain: 0.14 });
    a.tone({ dur: 0.18, from: 990, to: 990, type: 'sine', gain: 0.14, at: 0.1 });
  },
  power_cast: (a) => {
    a.burst({ dur: 0.3, freq: 500, type: 'bandpass', q: 1.5, gain: 0.16, sweep: 3.2 });
    a.tone({ dur: 0.12, from: 720, to: 1080, type: 'sine', gain: 0.1 });
  },
  sw_klaxon: (a) => {
    for (let i = 0; i < 3; i++) {
      a.tone({ dur: 0.19, from: 622, to: 622, type: 'sawtooth', gain: 0.16, at: i * 0.45 });
      a.tone({ dur: 0.19, from: 466, to: 466, type: 'sawtooth', gain: 0.16, at: i * 0.45 + 0.22 });
    }
  },
  sw_launch: (a, v) => {
    a.tone({ dur: 1.3, from: 55, to: 240, type: 'sawtooth', gain: 0.3 * Math.max(v, 0.5) });
    a.burst({ dur: 1.5, freq: 220, gain: 0.35 * Math.max(v, 0.5), sweep: 3.5 });
    a.tone({ dur: 1.8, from: 40, to: 28, type: 'sine', gain: 0.3 });
  },
  sw_beam: (a, v) => {
    a.tone({ dur: 0.5, from: 84, to: 92, type: 'sawtooth', gain: 0.22 * Math.max(v, 0.35) });
    a.tone({ dur: 0.5, from: 1980, to: 2120, type: 'sine', gain: 0.06 * Math.max(v, 0.35) });
    a.burst({ dur: 0.45, freq: 3800, type: 'highpass', gain: 0.05 * Math.max(v, 0.35), sweep: 0.9 });
  },
  rocket: (a, v) => {
    a.burst({ dur: 0.6, freq: 420, type: 'bandpass', q: 1.2, gain: 0.3 * v, sweep: 3 });
    a.tone({ dur: 0.45, from: 130, to: 60, type: 'sawtooth', gain: 0.14 * v });
  },
  plane: (a, v) => {
    const g = Math.max(v, 0.3);
    a.burst({ dur: 0.9, freq: 240, type: 'bandpass', q: 0.8, gain: 0.22 * g, sweep: 3.4 });
    a.burst({ dur: 1.1, freq: 820, type: 'bandpass', q: 0.8, gain: 0.16 * g, sweep: 0.3, at: 0.8 });
    a.tone({ dur: 1.6, from: 68, to: 46, type: 'sawtooth', gain: 0.1 * g });
  },
  paradrop: (a, v) => {
    a.burst({ dur: 0.14, freq: 520, type: 'bandpass', q: 2, gain: 0.1 * v });
    a.burst({ dur: 0.14, freq: 460, type: 'bandpass', q: 2, gain: 0.08 * v, at: 0.18 });
  },
  a10_gun: (a, v) => {
    // avenger cannon: dense pulse train reads as a brrrt
    for (let i = 0; i < 12; i++) {
      a.burst({ dur: 0.03, freq: 900 + (i % 3) * 220, gain: 0.16 * v, sweep: 0.3, at: i * 0.033 });
    }
    a.tone({ dur: 0.42, from: 90, to: 62, type: 'sawtooth', gain: 0.2 * v });
  },
  repair: (a, v) => {
    [1480, 1720, 1260].forEach((f, i) =>
      a.tone({ dur: 0.05, from: f, to: f * 0.92, type: 'sine', gain: 0.12 * v, at: i * 0.09 }));
    a.burst({ dur: 0.2, freq: 2600, type: 'highpass', gain: 0.05 * v, sweep: 0.7, at: 0.28 });
  },
  ambush: (a, v) => {
    a.burst({ dur: 0.5, freq: 850, gain: 0.28 * v, sweep: 0.18 });
    a.tone({ dur: 0.25, from: 120, to: 48, type: 'sine', gain: 0.3 * v });
  },
  toxin: (a, v) => {
    [430, 300, 205].forEach((f, i) =>
      a.tone({ dur: 0.1, from: f, to: f * 0.8, type: 'sine', gain: 0.1 * v, at: i * 0.12 }));
    a.burst({ dur: 0.5, freq: 380, gain: 0.1 * v, sweep: 0.5 });
  },
  bounty: (a) => {
    a.tone({ dur: 0.07, from: 1319, to: 1319, type: 'sine', gain: 0.1 });
    a.tone({ dur: 0.14, from: 1760, to: 1760, type: 'sine', gain: 0.1, at: 0.07 });
  },
  lowpower: (a) => {
    a.tone({ dur: 0.5, from: 270, to: 140, type: 'sawtooth', gain: 0.15 });
    a.tone({ dur: 0.5, from: 272, to: 141, type: 'sawtooth', gain: 0.15, at: 0.55 });
  },
  underattack: (a) => {
    for (let i = 0; i < 3; i++) {
      a.tone({ dur: 0.16, from: 880, to: 880, type: 'square', gain: 0.14, at: i * 0.42 });
      a.tone({ dur: 0.16, from: 660, to: 660, type: 'square', gain: 0.14, at: i * 0.42 + 0.2 });
    }
  },
  victory: (a) => {
    [523, 659, 784, 1046].forEach((f, i) => {
      a.tone({ dur: 0.17, from: f, to: f, type: 'triangle', gain: 0.16, at: i * 0.17 });
      a.tone({ dur: 0.17, from: f / 2, to: f / 2, type: 'sawtooth', gain: 0.08, at: i * 0.17 });
    });
    a.tone({ dur: 0.9, from: 1318, to: 1318, type: 'triangle', gain: 0.18, at: 0.68 });
    a.tone({ dur: 0.9, from: 659, to: 659, type: 'sawtooth', gain: 0.1, at: 0.68 });
  },
  defeat: (a) => {
    a.tone({ dur: 1.5, from: 300, to: 62, type: 'sawtooth', gain: 0.22 });
    [494, 466, 440].forEach((f, i) =>
      a.tone({ dur: 0.4, from: f, to: f * 0.985, type: 'sine', gain: 0.12, at: 0.2 + i * 0.42 }));
    a.tone({ dur: 1.6, from: 45, to: 30, type: 'sine', gain: 0.25, at: 0.6 });
  },
};

export const CUE_NAMES = Object.keys(CUES);

export class AudioSys {
  constructor() {
    this.ctx = null;
    this.enabled = !SHOT_MODE && typeof window !== 'undefined';
    this.last = {};       // cue name -> last play time (ctx seconds)
    this._hooked = false;
  }

  // Called by main.js at game start (a user gesture) — the AudioContext is
  // only ever created here. Safe to call repeatedly / headless.
  init() {
    if (!this.enabled || this.ctx) return;
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) { this.enabled = false; return; }
      this.ctx = new AC();
      this.comp = this.ctx.createDynamicsCompressor();
      this.comp.threshold.value = -16;
      this.comp.ratio.value = 6;
      this.comp.connect(this.ctx.destination);
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.5;
      this.master.connect(this.comp);
      this.startAmbience();
      this.hookEvents();
      if (this.ctx.state === 'suspended') {
        const resume = () => {
          this.ctx?.resume?.();
          removeEventListener('pointerdown', resume);
          removeEventListener('keydown', resume);
        };
        addEventListener('pointerdown', resume);
        addEventListener('keydown', resume);
      }
    } catch {
      this.ctx = null;
      this.enabled = false;
    }
  }

  hookEvents() {
    if (this._hooked) return;
    this._hooked = true;
    on('entity:died', (e, attacker) => {
      if (!e?.pos) return;
      const r = e.kind === 'building' ? Math.max(6, e.radius || 6) : 2.6;
      this.cue('explosion', { r, x: e.pos.x, z: e.pos.z });
      if (e.owner === G.humanId && attacker && e.owner !== attacker.owner) {
        this.cue('underattack');
      }
    });
    on('rank:up', (pid) => { if (pid === G.humanId) this.cue('promotion'); });
    on('game:over', (w) => this.cue(w === G.humanId ? 'victory' : 'defeat'));
    on('entity:built', (e) => {
      if (e?.owner === G.humanId && e.pos) this.cue('build_place', { x: e.pos.x, z: e.pos.z });
    });
  }

  // ---------------- cue dispatch ----------------
  cue(name, opts = {}) {
    this._play(name, this.att(opts), opts);
  }

  _play(name, vol, opts) {
    if (!this.enabled || !this.ctx) return;
    const fn = CUES[name];
    if (!fn) return;
    const now = this.ctx.currentTime;
    if (now - (this.last[name] ?? -99) < (LIMITS[name] ?? 0.05)) return;
    this.last[name] = now;
    try { fn(this, vol, opts); } catch { /* audio must never crash the game */ }
  }

  // legacy shims — combat.js still calls the FPS-era method names; route them
  // into the cue kit (all optional-chained on the caller side).
  enemyShot(dist = 0) { this._play('fire_bullet', clamp(1 - dist / 150, 0.08, 1), {}); }
  rocketLaunch() { this._play('fire_rocket', 0.8, {}); }
  explosion(size = 1) { this._play('explosion', 0.9, { r: size * 8 }); }

  // distance attenuation from the camera's ground target
  att(o) {
    if (o?.x === undefined || o?.z === undefined) return 1;
    const cx = G.camRig?.tx ?? 0, cz = G.camRig?.tz ?? 0;
    const d = Math.hypot(o.x - cx, o.z - cz);
    const v = clamp(1.18 - d / 240, 0.07, 1);
    return v * v;
  }

  now() { return this.ctx.currentTime; }

  // ---------------- synth primitives ----------------
  noiseBuffer(len = 1) {
    const buf = this.ctx.createBuffer(1, this.ctx.sampleRate * len, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    return buf;
  }

  burst({ dur = 0.2, freq = 800, type = 'lowpass', gain = 0.5, sweep = 0.3, q = 1, at = 0 }) {
    if (!this.ctx || gain <= 0.001) return;
    const t = this.now() + at;
    const src = this.ctx.createBufferSource();
    src.buffer = this._nb ||= this.noiseBuffer(2);
    src.loop = true;
    const f = this.ctx.createBiquadFilter();
    f.type = type; f.frequency.value = freq; f.Q.value = q;
    f.frequency.exponentialRampToValueAtTime(Math.max(50, freq * sweep), t + dur);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(f).connect(g).connect(this.master);
    src.start(t);
    src.stop(t + dur + 0.05);
  }

  tone({ dur = 0.2, from = 400, to = 100, type = 'sine', gain = 0.4, at = 0 }) {
    if (!this.ctx || gain <= 0.001) return;
    const t = this.now() + at;
    const o = this.ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(Math.max(20, from), t);
    o.frequency.exponentialRampToValueAtTime(Math.max(20, to), t + dur);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g).connect(this.master);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  // ---------------- ambience ----------------
  startAmbience() {
    if (!this.ctx) return;
    // desert wind: looped filtered noise with a slow LFO on the cutoff
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuffer(4);
    src.loop = true;
    const f = this.ctx.createBiquadFilter();
    f.type = 'lowpass'; f.frequency.value = 300; f.Q.value = 0.4;
    const g = this.ctx.createGain();
    g.gain.value = 0.04;
    const lfo = this.ctx.createOscillator();
    lfo.frequency.value = 0.08;
    const lg = this.ctx.createGain();
    lg.gain.value = 95;
    lfo.connect(lg).connect(f.frequency);
    src.connect(f).connect(g).connect(this.master);
    src.start(); lfo.start();
    // high sand-hiss whisper
    const hs = this.ctx.createBufferSource();
    hs.buffer = src.buffer;
    hs.loop = true;
    const hf = this.ctx.createBiquadFilter();
    hf.type = 'bandpass'; hf.frequency.value = 1500; hf.Q.value = 0.5;
    const hg = this.ctx.createGain();
    hg.gain.value = 0.012;
    hs.connect(hf).connect(hg).connect(this.master);
    hs.start();
    // distant war rumbles now and then
    const rumble = () => {
      if (!this.ctx) return;
      this.tone({ dur: 1.5, from: 66, to: 30, type: 'sine', gain: 0.09 });
      this._rt = setTimeout(rumble, 11000 + Math.random() * 18000);
    };
    this._rt = setTimeout(rumble, 6000);
  }
}
