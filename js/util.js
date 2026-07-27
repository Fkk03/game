/* ============ util.js — math helpers, RNG, misc ============ */
'use strict';
const U = {
  clamp(v, a, b) { return v < a ? a : (v > b ? b : v); },
  lerp(a, b, t) { return a + (b - a) * t; },
  dist(ax, ay, bx, by) { const dx = bx - ax, dy = by - ay; return Math.sqrt(dx * dx + dy * dy); },
  dist2(ax, ay, bx, by) { const dx = bx - ax, dy = by - ay; return dx * dx + dy * dy; },
  angTo(ax, ay, bx, by) { return Math.atan2(by - ay, bx - ax); },
  // shortest-arc rotate `a` toward `b` by at most `step`
  turnToward(a, b, step) {
    let d = b - a;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    if (Math.abs(d) <= step) return b;
    return a + Math.sign(d) * step;
  },
  angDiff(a, b) {
    let d = b - a;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    return d;
  },
  rand(a, b) { return a + Math.random() * (b - a); },
  randInt(a, b) { return Math.floor(a + Math.random() * (b - a + 1)); },
  pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; },
  fmtTime(s) {
    s = Math.max(0, Math.floor(s));
    return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
  },
  fmtMoney(n) { return '$' + Math.floor(n).toLocaleString('en-US'); },

  // seeded RNG (mulberry32) for reproducible map generation
  seededRng(seed) {
    let s = seed >>> 0;
    return function () {
      s |= 0; s = s + 0x6D2B79F5 | 0;
      let t = Math.imul(s ^ s >>> 15, 1 | s);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  },

  // simple value-noise built on a seeded rng
  makeNoise(rng, size) {
    const g = new Float32Array(size * size);
    for (let i = 0; i < g.length; i++) g[i] = rng();
    return function (x, y) {
      x = ((x % size) + size) % size; y = ((y % size) + size) % size;
      const x0 = Math.floor(x), y0 = Math.floor(y);
      const x1 = (x0 + 1) % size, y1 = (y0 + 1) % size;
      const fx = x - x0, fy = y - y0;
      const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
      const a = g[y0 * size + x0], b = g[y0 * size + x1];
      const c = g[y1 * size + x0], d = g[y1 * size + x1];
      return U.lerp(U.lerp(a, b, sx), U.lerp(c, d, sx), sy);
    };
  },

  fractal(noise, x, y, oct, lac, gain) {
    let amp = 1, freq = 1, sum = 0, norm = 0;
    for (let i = 0; i < oct; i++) {
      sum += noise(x * freq, y * freq) * amp;
      norm += amp; amp *= gain; freq *= lac;
    }
    return sum / norm;
  },

  shade(hex, f) { // hex '#rrggbb', f<1 darker, f>1 lighter
    const n = parseInt(hex.slice(1), 16);
    let r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
    r = U.clamp(Math.round(r * f), 0, 255);
    g = U.clamp(Math.round(g * f), 0, 255);
    b = U.clamp(Math.round(b * f), 0, 255);
    return '#' + ((r << 16) | (g << 8) | b).toString(16).padStart(6, '0');
  },

  esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
};
