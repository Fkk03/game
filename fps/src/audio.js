// audio.js — all sound synthesized with WebAudio; no samples
import { SHOT_MODE } from './core.js';

export class AudioSys {
  constructor() {
    this.ctx = null;
    this.enabled = !SHOT_MODE;
  }
  init() {
    if (!this.enabled || this.ctx) return;
    try {
      this.ctx = new (window.AudioContext || window.webkitAudioContext)();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.5;
      this.master.connect(this.ctx.destination);
      this.startAmbience();
    } catch (e) { this.enabled = false; }
  }
  now() { return this.ctx.currentTime; }

  noiseBuffer(len = 1) {
    const buf = this.ctx.createBuffer(1, this.ctx.sampleRate * len, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    return buf;
  }

  burst({ dur = 0.2, freq = 800, type = 'lowpass', gain = 0.5, sweep = 0.3, q = 1 }) {
    if (!this.ctx) return;
    const t = this.now();
    const src = this.ctx.createBufferSource();
    src.buffer = this._nb ||= this.noiseBuffer(2);
    src.loop = true;
    const f = this.ctx.createBiquadFilter();
    f.type = type; f.frequency.value = freq; f.Q.value = q;
    f.frequency.exponentialRampToValueAtTime(Math.max(60, freq * sweep), t + dur);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(f).connect(g).connect(this.master);
    src.start(t); src.stop(t + dur + 0.05);
  }

  tone({ dur = 0.2, from = 400, to = 100, type = 'sine', gain = 0.4 }) {
    if (!this.ctx) return;
    const t = this.now();
    const o = this.ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(from, t);
    o.frequency.exponentialRampToValueAtTime(Math.max(30, to), t + dur);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g).connect(this.master);
    o.start(t); o.stop(t + dur + 0.05);
  }

  // ---------------- game sounds ----------------
  rifleShot() {
    this.burst({ dur: 0.09, freq: 2600, gain: 0.55, sweep: 0.12 });
    this.burst({ dur: 0.16, freq: 500, gain: 0.4, sweep: 0.4 });
    this.tone({ dur: 0.05, from: 180, to: 60, type: 'square', gain: 0.12 });
  }
  enemyShot(dist) {
    const g = Math.max(0.04, 0.4 - dist * 0.004);
    this.burst({ dur: 0.12, freq: 1400, gain: g, sweep: 0.2 });
  }
  rocketLaunch() {
    this.burst({ dur: 0.5, freq: 900, gain: 0.5, sweep: 0.25 });
    this.tone({ dur: 0.4, from: 300, to: 90, type: 'sawtooth', gain: 0.2 });
  }
  explosion(size = 1) {
    this.tone({ dur: 0.7 * size, from: 120, to: 28, type: 'sine', gain: 0.8 });
    this.burst({ dur: 0.9 * size, freq: 700, gain: 0.6, sweep: 0.08 });
    this.burst({ dur: 0.25, freq: 3000, gain: 0.3, sweep: 0.1 });
  }
  reload1() { this.burst({ dur: 0.05, freq: 1800, gain: 0.25, sweep: 0.6, type: 'bandpass', q: 4 }); }
  reload2() { this.tone({ dur: 0.07, from: 900, to: 500, type: 'square', gain: 0.12 }); }
  dryFire() { this.tone({ dur: 0.05, from: 1200, to: 900, type: 'square', gain: 0.1 }); }
  hitmarker() { this.tone({ dur: 0.05, from: 2200, to: 1800, type: 'sine', gain: 0.15 }); }
  killConfirm() { this.tone({ dur: 0.11, from: 1400, to: 2100, type: 'sine', gain: 0.2 }); }
  playerHurt() { this.tone({ dur: 0.18, from: 300, to: 120, type: 'sawtooth', gain: 0.3 }); }
  footstep() { this.burst({ dur: 0.07, freq: 300, gain: 0.10, sweep: 0.5 }); }
  jump() { this.burst({ dur: 0.1, freq: 500, gain: 0.12, sweep: 0.4 }); }
  objective() {
    this.tone({ dur: 0.12, from: 880, to: 880, gain: 0.22 });
    setTimeout(() => this.tone({ dur: 0.2, from: 1320, to: 1320, gain: 0.22 }), 130);
  }
  announceLose() { this.tone({ dur: 0.8, from: 300, to: 80, type: 'sawtooth', gain: 0.3 }); }
  ricochet() { this.tone({ dur: 0.15, from: 2600 + Math.random() * 1500, to: 500, type: 'sine', gain: 0.08 }); }

  startAmbience() {
    // desert wind: looped filtered noise with slow LFO
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuffer(4);
    src.loop = true;
    const f = this.ctx.createBiquadFilter();
    f.type = 'lowpass'; f.frequency.value = 320; f.Q.value = 0.4;
    const g = this.ctx.createGain();
    g.gain.value = 0.05;
    const lfo = this.ctx.createOscillator();
    lfo.frequency.value = 0.09;
    const lg = this.ctx.createGain();
    lg.gain.value = 90;
    lfo.connect(lg).connect(f.frequency);
    src.connect(f).connect(g).connect(this.master);
    src.start(); lfo.start();
    // distant rumbles now and then
    const rumble = () => {
      if (!this.ctx) return;
      this.tone({ dur: 1.4, from: 70, to: 30, type: 'sine', gain: 0.10 });
      setTimeout(rumble, 9000 + Math.random() * 16000);
    };
    setTimeout(rumble, 5000);
  }
}
