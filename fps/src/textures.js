// textures.js — all procedural canvas textures (nothing loaded from disk)
// Art target: C&C Generals Zero Hour — warm saturated desert palette, painterly
// hand-crafted texture-sheet look with baked highlights/shadows.
import * as THREE from 'three';
import { makeRng } from './core.js';

const cache = {};

function canvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return [c, c.getContext('2d')];
}

function toTex(c, { repeat = 1, srgb = true, aniso = 8 } = {}) {
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeat, repeat);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = aniso;
  t.needsUpdate = true;
  return t;
}

// ------------------------------------------------------------ color helpers
function hexRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function css(r, g, b, a = 1) {
  return `rgba(${Math.min(255, Math.max(0, r)) | 0},${Math.min(255, Math.max(0, g)) | 0},${Math.min(255, Math.max(0, b)) | 0},${a})`;
}
// value-scale a hex tint; warm > 0 pushes golden, warm < 0 pushes cool/shadow
function tone(hex, f, warm = 0, a = 1) {
  const [r, g, b] = hexRgb(hex);
  return css(r * f + warm * 26, g * f + warm * 10, b * f - warm * 20, a);
}

// value-noise painter used by most generators (kept for grain / legacy callers)
function noisePatch(ctx, w, h, rng, { base, blotches = 900, dark = 0.12, light = 0.10, rMin = 1, rMax = 6 }) {
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, w, h);
  for (let i = 0; i < blotches; i++) {
    const x = rng() * w, y = rng() * h, r = rMin + rng() * (rMax - rMin);
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    const d = rng() < 0.5;
    const a = (d ? dark : light) * (0.3 + rng() * 0.7);
    g.addColorStop(0, d ? `rgba(0,0,0,${a})` : `rgba(255,255,255,${a})`);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(x, y, r, 0, 7); ctx.fill();
  }
}

// painterly hue-jittered blotches (keeps saturation instead of greying out)
function paintBlotches(ctx, w, h, rng, hex, n, { rMin = 4, rMax = 30, fLo = 0.82, fHi = 1.16, warmJit = 0.5, alpha = 0.3 } = {}) {
  for (let i = 0; i < n; i++) {
    const x = rng() * w, y = rng() * h, r = rMin + rng() * (rMax - rMin);
    const f = fLo + rng() * (fHi - fLo);
    const warm = (rng() - 0.5) * 2 * warmJit;
    const a = alpha * (0.4 + rng() * 0.6);
    const g = ctx.createRadialGradient(x, y, r * 0.1, x, y, r);
    g.addColorStop(0, tone(hex, f, warm, a));
    g.addColorStop(1, tone(hex, f, warm, 0));
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(x, y, r, 0, 7); ctx.fill();
  }
}

function grain(ctx, w, h, rng, n = 9000, alpha = 0.05) {
  for (let i = 0; i < n; i++) {
    const v = rng() < 0.5;
    ctx.fillStyle = v ? `rgba(255,255,255,${alpha * rng()})` : `rgba(0,0,0,${alpha * rng()})`;
    ctx.fillRect(rng() * w, rng() * h, 1 + rng() * 1.5, 1 + rng() * 1.5);
  }
}

// stucco bump illusion: shadow blob down-right, highlight blob up-left
function stucco(ctx, w, h, rng, n) {
  for (let i = 0; i < n; i++) {
    const x = rng() * w, y = rng() * h, r = 1 + rng() * 3.4;
    const a = 0.08 + rng() * 0.14;
    ctx.fillStyle = `rgba(58,38,18,${a})`;
    ctx.beginPath(); ctx.arc(x + r * 0.7, y + r * 0.9, r, 0, 7); ctx.fill();
    ctx.fillStyle = `rgba(255,238,200,${a * 0.95})`;
    ctx.beginPath(); ctx.arc(x - r * 0.5, y - r * 0.7, r * 0.85, 0, 7); ctx.fill();
  }
}

// layered rust streak running down from (x0,y0)
function rustStreak(ctx, x0, y0, len, wdt, rng) {
  let g = ctx.createLinearGradient(0, y0, 0, y0 + len);
  g.addColorStop(0, 'rgba(118,62,26,0.40)');
  g.addColorStop(0.6, 'rgba(100,50,22,0.18)');
  g.addColorStop(1, 'rgba(88,44,20,0)');
  ctx.fillStyle = g;
  ctx.fillRect(x0 - wdt, y0, wdt * 2, len);
  g = ctx.createLinearGradient(0, y0, 0, y0 + len * 0.75);
  g.addColorStop(0, 'rgba(156,82,30,0.55)');
  g.addColorStop(1, 'rgba(140,72,28,0)');
  ctx.fillStyle = g;
  ctx.fillRect(x0 - wdt * 0.35, y0, wdt * 0.75, len * 0.75);
  ctx.fillStyle = 'rgba(92,48,20,0.7)';
  ctx.beginPath(); ctx.arc(x0, y0 + 1, wdt * 0.7 + rng() * 1.5, 0, 7); ctx.fill();
}

// rivet with baked lighting
function rivet(ctx, cx, cy, r, tint) {
  ctx.fillStyle = 'rgba(10,8,5,0.5)';
  ctx.beginPath(); ctx.arc(cx + r * 0.45, cy + r * 0.6, r * 1.05, 0, 7); ctx.fill();
  ctx.fillStyle = tone(tint, 1.22, 0.2);
  ctx.beginPath(); ctx.arc(cx, cy, r, 0, 7); ctx.fill();
  ctx.fillStyle = 'rgba(255,250,235,0.75)';
  ctx.beginPath(); ctx.arc(cx - r * 0.35, cy - r * 0.4, r * 0.38, 0, 7); ctx.fill();
}

// ---------------------------------------------------------------- sand detail
export function sandDetail() {
  if (cache.sand) return cache.sand;
  const rng = makeRng(101);
  const [c, x] = canvas(512, 512);
  noisePatch(x, 512, 512, rng, { base: '#c9b184', blotches: 1400, dark: 0.07, light: 0.06, rMax: 9 });
  paintBlotches(x, 512, 512, rng, '#c9b184', 260, { rMin: 10, rMax: 42, fLo: 0.92, fHi: 1.08, warmJit: 0.8, alpha: 0.16 });
  // wind ripples: shadowed crest + lit face pairs
  for (let i = 0; i < 80; i++) {
    const y0 = rng() * 512;
    x.lineWidth = 1 + rng() * 2;
    for (let pass = 0; pass < 2; pass++) {
      x.globalAlpha = pass ? 0.11 : 0.13;
      x.strokeStyle = pass ? '#ecdcb2' : '#8a744f';
      x.beginPath();
      for (let px = 0; px <= 512; px += 16) {
        const py = y0 + Math.sin(px * 0.02 + i) * 7 + (pass ? 2 : 0);
        px === 0 ? x.moveTo(px, py) : x.lineTo(px, py);
      }
      x.stroke();
    }
  }
  x.globalAlpha = 1;
  grain(x, 512, 512, rng, 14000, 0.06);
  cache.sand = toTex(c, { repeat: 90 });
  return cache.sand;
}

// ---------------------------------------------------------------- metal / hull
export function metalPanels(tint = '#7a7f6e', seed = 7) {
  const key = 'metal' + tint + seed;
  if (cache[key]) return cache[key];
  const rng = makeRng(seed);
  const S = 512, P = 128; // 4x4 painted plates
  const [c, x] = canvas(S, S);
  // each plate its own hand-mixed tone (classic RTS panel variation)
  for (let py = 0; py < 4; py++) for (let px = 0; px < 4; px++) {
    const f = 0.88 + rng() * 0.24;
    const warm = (rng() - 0.32) * 0.9; // biased warm — cool drift reads off-palette
    const g = x.createLinearGradient(0, py * P, 0, py * P + P);
    g.addColorStop(0, tone(tint, f * 1.1, warm + 0.25));
    g.addColorStop(0.55, tone(tint, f, warm));
    g.addColorStop(1, tone(tint, f * 0.84, warm - 0.2));
    x.fillStyle = g;
    x.fillRect(px * P, py * P, P, P);
  }
  paintBlotches(x, S, S, rng, tint, 300, { rMin: 8, rMax: 44, fLo: 0.8, fHi: 1.16, warmJit: 0.5, alpha: 0.2 });
  // faint brushed streaks
  x.globalAlpha = 0.05;
  for (let i = 0; i < 60; i++) {
    x.fillStyle = rng() < 0.5 ? '#000' : '#fff';
    x.fillRect(0, rng() * S, S, 1 + rng() * 2);
  }
  x.globalAlpha = 1;
  // seams with bevel lighting (light catches below horizontal seam, right of vertical)
  for (let i = 0; i < 4; i++) {
    const p = i * P;
    x.fillStyle = 'rgba(18,14,8,0.55)'; x.fillRect(0, p - 1, S, 3);
    x.fillStyle = 'rgba(255,238,200,0.20)'; x.fillRect(0, p + 2, S, 2);
    x.fillStyle = 'rgba(0,0,0,0.22)'; x.fillRect(0, p + P - 4, S, 3);
    x.fillStyle = 'rgba(18,14,8,0.5)'; x.fillRect(p - 1, 0, 3, S);
    x.fillStyle = 'rgba(255,238,200,0.14)'; x.fillRect(p + 2, 0, 2, S);
    x.fillStyle = 'rgba(0,0,0,0.18)'; x.fillRect(p + P - 4, 0, 3, S);
  }
  // rivet rows along seams
  const rivets = [];
  for (let i = 0; i < 4; i++) for (let j = 0; j < 16; j++) {
    rivet(x, j * 32 + 16, i * P + 9, 3.2, tint);
    rivets.push([j * 32 + 16, i * P + 9]);
    rivet(x, i * P + 9, j * 32 + 16 + 8, 3.2, tint);
  }
  // chipped paint: dull bare-metal nicks with dark rim
  for (let i = 0; i < 18; i++) {
    const cx = rng() * S, cy = rng() * S, r = 1.5 + rng() * 4.5;
    x.fillStyle = 'rgba(30,24,16,0.5)';
    x.beginPath();
    for (let k = 0; k <= 7; k++) {
      const th = k / 7 * Math.PI * 2, rr = r * (0.6 + rng() * 0.7);
      k === 0 ? x.moveTo(cx + 1 + Math.cos(th) * rr, cy + 1.5 + Math.sin(th) * rr)
              : x.lineTo(cx + 1 + Math.cos(th) * rr, cy + 1.5 + Math.sin(th) * rr);
    }
    x.closePath(); x.fill();
    x.fillStyle = 'rgba(168,172,164,0.6)';
    x.beginPath();
    for (let k = 0; k <= 7; k++) {
      const th = k / 7 * Math.PI * 2, rr = r * (0.55 + rng() * 0.6);
      k === 0 ? x.moveTo(cx + Math.cos(th) * rr, cy + Math.sin(th) * rr)
              : x.lineTo(cx + Math.cos(th) * rr, cy + Math.sin(th) * rr);
    }
    x.closePath(); x.fill();
  }
  // scratches
  x.lineWidth = 1;
  for (let i = 0; i < 18; i++) {
    const sx = rng() * S, sy = rng() * S, a = rng() * Math.PI, l = 8 + rng() * 36;
    x.strokeStyle = `rgba(210,212,200,${0.1 + rng() * 0.15})`;
    x.beginPath(); x.moveTo(sx, sy); x.lineTo(sx + Math.cos(a) * l, sy + Math.sin(a) * l); x.stroke();
  }
  // rust: streaks bleeding from rivets and seam joints
  for (let i = 0; i < 20; i++) {
    const [rx, ry] = rivets[(rng() * rivets.length) | 0];
    rustStreak(x, rx + (rng() - 0.5) * 4, ry + 2, 18 + rng() * 80, 2.5 + rng() * 3, rng);
  }
  for (let i = 0; i < 10; i++) {
    rustStreak(x, rng() * S, rng() * S, 14 + rng() * 50, 2 + rng() * 3, rng);
  }
  // rust blooms with eaten-dark centers
  for (let i = 0; i < 12; i++) {
    const cx = rng() * S, cy = rng() * S, r = 4 + rng() * 14;
    const g = x.createRadialGradient(cx, cy, 0, cx, cy, r);
    g.addColorStop(0, 'rgba(70,36,16,0.6)');
    g.addColorStop(0.5, 'rgba(130,66,26,0.42)');
    g.addColorStop(1, 'rgba(140,74,30,0)');
    x.fillStyle = g;
    x.beginPath(); x.arc(cx, cy, r, 0, 7); x.fill();
  }
  // grime settling at bottom of sheet
  const gg = x.createLinearGradient(0, S - 90, 0, S);
  gg.addColorStop(0, 'rgba(40,30,16,0)');
  gg.addColorStop(1, 'rgba(40,30,16,0.35)');
  x.fillStyle = gg; x.fillRect(0, S - 90, S, 90);
  grain(x, S, S, rng, 9000, 0.05);
  cache[key] = toTex(c, { repeat: 1 });
  return cache[key];
}

// ---------------------------------------------------------------- sandbags
// (reached through adobe() so buildings.js keeps its call signature)
function sandbagCanvas(rng) {
  const S = 512;
  const [c, x] = canvas(S, S);
  x.fillStyle = '#4f4128'; x.fillRect(0, 0, S, S); // deep crevice base
  const rows = 4, bh = S / rows, bw = S / 3;
  const base = '#8f7c54'; // earthy khaki, darker than old pale tint
  for (let r = 0; r < rows; r++) {
    const off = (r % 2) * (bw / 2);
    for (let i = -1; i <= 3; i++) {
      const bx = i * bw + off + 2, by = r * bh + 2, w = bw - 5, h = bh - 7;
      const f = 0.8 + rng() * 0.34, warm = (rng() - 0.5) * 0.9;
      // bag body — plump vertical shading
      const g = x.createLinearGradient(0, by, 0, by + h);
      g.addColorStop(0, tone(base, f * 1.2, warm + 0.3));
      g.addColorStop(0.42, tone(base, f, warm));
      g.addColorStop(1, tone(base, f * 0.55, warm - 0.3));
      x.fillStyle = g;
      const rr = h * 0.42;
      x.beginPath();
      x.moveTo(bx + rr, by);
      x.lineTo(bx + w - rr, by); x.quadraticCurveTo(bx + w, by, bx + w, by + rr);
      x.lineTo(bx + w, by + h - rr); x.quadraticCurveTo(bx + w, by + h, bx + w - rr, by + h);
      x.lineTo(bx + rr, by + h); x.quadraticCurveTo(bx, by + h, bx, by + h - rr);
      x.lineTo(bx, by + rr); x.quadraticCurveTo(bx, by, bx + rr, by);
      x.closePath(); x.fill();
      // pinched ends
      for (const ex of [bx, bx + w]) {
        const eg = x.createLinearGradient(ex - 14, 0, ex + 14, 0);
        eg.addColorStop(0, 'rgba(45,34,18,0)');
        eg.addColorStop(0.5, 'rgba(45,34,18,0.4)');
        eg.addColorStop(1, 'rgba(45,34,18,0)');
        x.fillStyle = eg;
        x.fillRect(ex - 14, by, 28, h);
      }
      // top sheen where sun hits the bulge
      const hg = x.createRadialGradient(bx + w * 0.45, by + h * 0.3, 2, bx + w * 0.45, by + h * 0.3, w * 0.4);
      hg.addColorStop(0, 'rgba(255,236,190,0.30)');
      hg.addColorStop(1, 'rgba(255,236,190,0)');
      x.fillStyle = hg;
      x.beginPath(); x.arc(bx + w * 0.45, by + h * 0.32, w * 0.4, 0, 7); x.fill();
      // cloth wrinkles sagging with the fill
      for (let k = 0; k < 5; k++) {
        const wy = by + h * (0.3 + k * 0.14);
        x.strokeStyle = `rgba(50,38,20,${0.14 + rng() * 0.14})`;
        x.lineWidth = 1 + rng();
        x.beginPath();
        x.moveTo(bx + 8, wy);
        x.quadraticCurveTo(bx + w / 2, wy + 7 + rng() * 6, bx + w - 8, wy);
        x.stroke();
        x.strokeStyle = 'rgba(240,222,176,0.14)';
        x.lineWidth = 1;
        x.beginPath();
        x.moveTo(bx + 10, wy - 1.5);
        x.quadraticCurveTo(bx + w / 2, wy + 5, bx + w - 10, wy - 1.5);
        x.stroke();
      }
      // stitched seam near top
      x.fillStyle = 'rgba(60,46,26,0.6)';
      for (let sx2 = bx + 10; sx2 < bx + w - 8; sx2 += 7) x.fillRect(sx2, by + 6, 3, 1.6);
      // burlap weave hint
      x.globalAlpha = 0.07;
      x.strokeStyle = '#2e2413'; x.lineWidth = 1;
      for (let vx = bx + 4; vx < bx + w; vx += 4) {
        x.beginPath(); x.moveTo(vx, by + 2); x.lineTo(vx, by + h - 2); x.stroke();
      }
      x.globalAlpha = 1;
    }
  }
  // settled dust film knocks the saturation back and ties bags to the desert
  x.fillStyle = 'rgba(146,128,94,0.14)';
  x.fillRect(0, 0, S, S);
  for (let i = 0; i < 60; i++) {
    const cx = rng() * S, cy = rng() * S, r = 10 + rng() * 34;
    const g = x.createRadialGradient(cx, cy, 0, cx, cy, r);
    g.addColorStop(0, `rgba(150,130,92,${0.06 + rng() * 0.1})`);
    g.addColorStop(1, 'rgba(150,130,92,0)');
    x.fillStyle = g;
    x.beginPath(); x.arc(cx, cy, r, 0, 7); x.fill();
  }
  grain(x, S, S, rng, 9000, 0.06);
  return c;
}

// ---------------------------------------------------------------- adobe / plaster
export function adobe(tint = '#c2a678', seed = 21) {
  const key = 'adobe' + tint + seed;
  if (cache[key]) return cache[key];
  const rng = makeRng(seed);
  if (seed === 25) { // buildings.js sandbag material routes through here
    cache[key] = toTex(sandbagCanvas(rng), { repeat: 1 });
    return cache[key];
  }
  const S = 512;
  const [c, x] = canvas(S, S);
  // sun-baked base: warm bright top settling to dustier foot
  const g0 = x.createLinearGradient(0, 0, 0, S);
  g0.addColorStop(0, tone(tint, 1.07, 0.35));
  g0.addColorStop(0.6, tone(tint, 1.0, 0.1));
  g0.addColorStop(1, tone(tint, 0.9, -0.1));
  x.fillStyle = g0; x.fillRect(0, 0, S, S);
  // broad ochre washes + tighter mottling
  paintBlotches(x, S, S, rng, tint, 70, { rMin: 45, rMax: 140, fLo: 0.9, fHi: 1.1, warmJit: 1.0, alpha: 0.22 });
  paintBlotches(x, S, S, rng, tint, 520, { rMin: 6, rMax: 26, fLo: 0.82, fHi: 1.16, warmJit: 0.6, alpha: 0.18 });
  // stucco relief
  stucco(x, S, S, rng, 850);
  // worn plaster patches revealing mud-brick coursework
  for (let p = 0; p < 3; p++) {
    const cx = rng() * S, cy = S * 0.18 + rng() * S * 0.68, r = 28 + rng() * 44;
    const pts = [];
    for (let a2 = 0; a2 < 12; a2++) {
      const th = a2 / 12 * Math.PI * 2, rr = r * (0.65 + rng() * 0.55);
      pts.push([cx + Math.cos(th) * rr, cy + Math.sin(th) * rr * 0.8]);
    }
    const tracePatch = () => {
      x.beginPath();
      pts.forEach(([px2, py2], i2) => i2 === 0 ? x.moveTo(px2, py2) : x.lineTo(px2, py2));
      x.closePath();
    };
    x.save();
    tracePatch(); x.clip();
    x.fillStyle = tone(tint, 0.66, 0.7); // sun-dried mud brick: warm earthen brown
    x.fillRect(cx - r * 1.4, cy - r * 1.4, r * 2.8, r * 2.8);
    // brick courses
    const bh = 14, bwv = 30;
    for (let row = 0; row < (r * 2.8 / bh) + 1; row++) {
      const by = cy - r * 1.4 + row * bh;
      x.strokeStyle = 'rgba(74,48,24,0.55)'; x.lineWidth = 2;
      x.beginPath(); x.moveTo(cx - r * 1.4, by); x.lineTo(cx + r * 1.4, by); x.stroke();
      x.strokeStyle = 'rgba(255,238,200,0.16)'; x.lineWidth = 1;
      x.beginPath(); x.moveTo(cx - r * 1.4, by + 2); x.lineTo(cx + r * 1.4, by + 2); x.stroke();
      x.strokeStyle = 'rgba(74,48,24,0.42)'; x.lineWidth = 1.5;
      for (let bx2 = cx - r * 1.4 + (row % 2) * bwv * 0.5; bx2 < cx + r * 1.4; bx2 += bwv) {
        x.beginPath(); x.moveTo(bx2, by); x.lineTo(bx2 + (rng() - 0.5) * 3, by + bh); x.stroke();
      }
    }
    x.restore();
    // plaster lip: shadow inside top of hole, light rim on lower edge
    x.strokeStyle = 'rgba(45,30,14,0.5)'; x.lineWidth = 3;
    tracePatch(); x.stroke();
    x.strokeStyle = 'rgba(255,240,205,0.30)'; x.lineWidth = 1.5;
    x.save(); x.translate(1.5, 2); tracePatch(); x.stroke(); x.restore();
  }
  // cracks with lit lower lip
  for (let i = 0; i < 7; i++) {
    let px = rng() * S, py = rng() * S * 0.55;
    const seg = [[px, py]];
    for (let s = 0; s < 5; s++) {
      px += (rng() - 0.5) * 32; py += rng() * 28;
      seg.push([px, py]);
    }
    x.strokeStyle = 'rgba(52,34,16,0.45)'; x.lineWidth = 1.4;
    x.beginPath(); seg.forEach(([a2, b2], i2) => i2 === 0 ? x.moveTo(a2, b2) : x.lineTo(a2, b2)); x.stroke();
    x.strokeStyle = 'rgba(255,240,205,0.22)'; x.lineWidth = 1;
    x.beginPath(); seg.forEach(([a2, b2], i2) => i2 === 0 ? x.moveTo(a2 + 1.2, b2 + 1.4) : x.lineTo(a2 + 1.2, b2 + 1.4)); x.stroke();
  }
  // rain-dust streaks under the roofline
  for (let i = 0; i < 26; i++) {
    const sx = rng() * S, len = 36 + rng() * 130, w2 = 3 + rng() * 8;
    const g2 = x.createLinearGradient(0, 0, 0, len);
    g2.addColorStop(0, `rgba(74,54,30,${0.14 + rng() * 0.12})`);
    g2.addColorStop(1, 'rgba(74,54,30,0)');
    x.fillStyle = g2;
    x.fillRect(sx, 0, w2, len);
  }
  // occlusion shadow tucked under the top edge
  const tg = x.createLinearGradient(0, 0, 0, 26);
  tg.addColorStop(0, 'rgba(40,26,12,0.4)');
  tg.addColorStop(1, 'rgba(40,26,12,0)');
  x.fillStyle = tg; x.fillRect(0, 0, S, 26);
  // heavy dirt splash rising from the ground
  const gr = x.createLinearGradient(0, S * 0.62, 0, S);
  gr.addColorStop(0, 'rgba(88,62,34,0)');
  gr.addColorStop(0.7, 'rgba(88,62,34,0.3)');
  gr.addColorStop(1, 'rgba(74,52,28,0.55)');
  x.fillStyle = gr; x.fillRect(0, S * 0.62, S, S * 0.38);
  for (let i = 0; i < 90; i++) { // splatter blobs
    const sy = S - rng() * rng() * 150;
    x.fillStyle = `rgba(80,56,30,${0.1 + rng() * 0.22})`;
    x.beginPath(); x.arc(rng() * S, sy, 2 + rng() * 7, 0, 7); x.fill();
  }
  grain(x, S, S, rng, 9000, 0.06);
  cache[key] = toTex(c, { repeat: 1 });
  return cache[key];
}

// ---------------------------------------------------------------- corrugated roof
export function corrugated(tint = '#8d8d82', seed = 33) {
  const key = 'corr' + tint + seed;
  if (cache[key]) return cache[key];
  const rng = makeRng(seed);
  const S = 256;
  const [c, x] = canvas(S, S);
  // per-sheet tone strips (each sheet 64 wide)
  for (let s = 0; s < 4; s++) {
    const f = 0.88 + rng() * 0.24, warm = (rng() - 0.5) * 0.8;
    const g = x.createLinearGradient(0, 0, 0, S);
    g.addColorStop(0, tone(tint, f * 1.06, warm + 0.2));
    g.addColorStop(1, tone(tint, f * 0.86, warm - 0.2));
    x.fillStyle = g;
    x.fillRect(s * 64, 0, 64, S);
  }
  // corrugation ridges — asymmetric (sun from the left)
  for (let i = 0; i < 32; i++) {
    const px = i * 8;
    const g = x.createLinearGradient(px, 0, px + 8, 0);
    g.addColorStop(0, 'rgba(0,0,0,0.38)');
    g.addColorStop(0.3, 'rgba(255,250,225,0.28)');
    g.addColorStop(0.55, 'rgba(255,250,225,0.08)');
    g.addColorStop(1, 'rgba(0,0,0,0.4)');
    x.fillStyle = g; x.fillRect(px, 0, 8, S);
  }
  // horizontal overlap seam mid-sheet
  x.fillStyle = 'rgba(15,12,8,0.45)'; x.fillRect(0, 126, S, 3);
  x.fillStyle = 'rgba(255,245,215,0.2)'; x.fillRect(0, 129, S, 2);
  // screws along seams
  for (let i = 0; i < 16; i++) {
    rivet(x, i * 16 + 8, 122, 2, tint);
    rivet(x, i * 16 + 8, 6, 2, tint);
  }
  // rust running down the valleys
  for (let i = 0; i < 26; i++) {
    const vx = ((rng() * 32) | 0) * 8 + (rng() < 0.5 ? 0.5 : 7.5);
    rustStreak(x, vx, rng() * S * 0.7, 20 + rng() * 90, 1.6 + rng() * 2, rng);
  }
  // rust blooms, darker eaten centers
  for (let i = 0; i < 18; i++) {
    const sx = rng() * S, sy = rng() * S, r = 3 + rng() * 11;
    const g = x.createRadialGradient(sx, sy, 0, sx, sy, r);
    g.addColorStop(0, `rgba(72,38,16,${0.4 + rng() * 0.3})`);
    g.addColorStop(0.55, `rgba(${118 + rng() * 40 | 0},${58 + rng() * 20 | 0},24,0.4)`);
    g.addColorStop(1, 'rgba(120,60,24,0)');
    x.fillStyle = g;
    x.beginPath(); x.arc(sx, sy, r, 0, 7); x.fill();
  }
  // dust film collecting toward the eave
  const dg = x.createLinearGradient(0, S - 60, 0, S);
  dg.addColorStop(0, 'rgba(140,110,64,0)');
  dg.addColorStop(1, 'rgba(140,110,64,0.28)');
  x.fillStyle = dg; x.fillRect(0, S - 60, S, 60);
  grain(x, S, S, rng, 3500, 0.05);
  cache[key] = toTex(c);
  return cache[key];
}

// ---------------------------------------------------------------- camo canvas
export function camoCanvas(seed = 44) {
  const key = 'camo' + seed;
  if (cache[key]) return cache[key];
  const rng = makeRng(seed);
  const [c, x] = canvas(256, 256);
  x.fillStyle = '#8b8558'; x.fillRect(0, 0, 256, 256);
  const cols = ['#6d6a42', '#a39a68', '#59532f', '#7d7549'];
  for (let i = 0; i < 56; i++) {
    x.fillStyle = cols[i % cols.length];
    const cx = rng() * 256, cy = rng() * 256, n = 6;
    const pts = [];
    for (let s = 0; s < n; s++) {
      const th = s / n * Math.PI * 2;
      const rr = 18 + rng() * 26;
      pts.push([cx + Math.cos(th) * rr, cy + Math.sin(th) * rr * (0.6 + rng() * 0.6)]);
    }
    x.beginPath();
    x.moveTo(pts[0][0], pts[0][1]);
    for (let s = 1; s <= n; s++) {
      const [ax, ay] = pts[s % n], [bx2, by2] = pts[(s + 1) % n];
      x.quadraticCurveTo(ax, ay, (ax + bx2) / 2, (ay + by2) / 2);
    }
    x.closePath(); x.fill();
  }
  // canvas weave
  x.globalAlpha = 0.06;
  x.strokeStyle = '#2f2b18'; x.lineWidth = 1;
  for (let i = 0; i < 256; i += 4) {
    x.beginPath(); x.moveTo(i, 0); x.lineTo(i, 256); x.stroke();
    x.beginPath(); x.moveTo(0, i); x.lineTo(256, i); x.stroke();
  }
  x.globalAlpha = 1;
  // sun bleach across the top
  const bg = x.createLinearGradient(0, 0, 0, 110);
  bg.addColorStop(0, 'rgba(255,244,205,0.16)');
  bg.addColorStop(1, 'rgba(255,244,205,0)');
  x.fillStyle = bg; x.fillRect(0, 0, 256, 110);
  grain(x, 256, 256, rng, 6000, 0.07);
  cache[key] = toTex(c);
  return cache[key];
}

// ---------------------------------------------------------------- concrete
export function concrete(tint = '#9a958a', seed = 55) {
  const key = 'conc' + tint + seed;
  if (cache[key]) return cache[key];
  const rng = makeRng(seed);
  const S = 512;
  const [c, x] = canvas(S, S);
  noisePatch(x, S, S, rng, { base: tint, blotches: 700, dark: 0.09, light: 0.07, rMax: 26 });
  paintBlotches(x, S, S, rng, tint, 160, { rMin: 20, rMax: 80, fLo: 0.9, fHi: 1.1, warmJit: 0.7, alpha: 0.18 });
  // formwork lines
  for (let i = 1; i < 4; i++) {
    x.fillStyle = 'rgba(30,26,20,0.25)'; x.fillRect(0, i * 128, S, 2);
    x.fillStyle = 'rgba(255,248,225,0.12)'; x.fillRect(0, i * 128 + 2, S, 1.5);
  }
  // form-tie holes with rust weep
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) {
    const tx = 90 + j * 160 + rng() * 20, ty = 70 + i * 160 + rng() * 20;
    x.fillStyle = 'rgba(28,24,18,0.65)';
    x.beginPath(); x.arc(tx, ty, 4.5, 0, 7); x.fill();
    x.fillStyle = 'rgba(255,248,225,0.2)';
    x.beginPath(); x.arc(tx - 1.5, ty - 1.5, 1.6, 0, 7); x.fill();
    if (rng() < 0.6) rustStreak(x, tx, ty + 3, 20 + rng() * 60, 2.5, rng);
  }
  // water stains bleeding from the top
  for (let i = 0; i < 12; i++) {
    const sx = rng() * S, len = 50 + rng() * 170, w2 = 6 + rng() * 20;
    const g2 = x.createLinearGradient(0, 0, 0, len);
    g2.addColorStop(0, `rgba(52,48,40,${0.16 + rng() * 0.12})`);
    g2.addColorStop(1, 'rgba(52,48,40,0)');
    x.fillStyle = g2;
    x.fillRect(sx, 0, w2, len);
  }
  // spalled chips
  for (let i = 0; i < 14; i++) {
    const cx = rng() * S, cy = rng() * S, r = 2.5 + rng() * 6;
    x.fillStyle = 'rgba(30,26,20,0.4)';
    x.beginPath(); x.arc(cx + 1, cy + 1.4, r, 0, 7); x.fill();
    x.fillStyle = tone(tint, 1.14, 0.2, 0.8);
    x.beginPath(); x.arc(cx, cy, r * 0.85, 0, 7); x.fill();
  }
  // desert dust film — keeps concrete from reading cold
  x.fillStyle = 'rgba(172,142,96,0.16)';
  x.fillRect(0, 0, S, S);
  paintBlotches(x, S, S, rng, '#a8977c', 60, { rMin: 20, rMax: 70, fLo: 0.9, fHi: 1.08, warmJit: 0.9, alpha: 0.14 });
  // grime foot
  const gg = x.createLinearGradient(0, S - 110, 0, S);
  gg.addColorStop(0, 'rgba(58,48,34,0)');
  gg.addColorStop(1, 'rgba(58,48,34,0.4)');
  x.fillStyle = gg; x.fillRect(0, S - 110, S, 110);
  x.strokeStyle = 'rgba(0,0,0,0.2)'; x.lineWidth = 3;
  x.strokeRect(1.5, 1.5, S - 3, S - 3);
  grain(x, S, S, rng, 12000, 0.06);
  cache[key] = toTex(c);
  return cache[key];
}

// ---------------------------------------------------------------- gun metal
// CONTRACT with weapons.js vmSteel(): that material multiplies this map by ~1.5
// (color Color(1.45,1.5,1.62)) to lift the viewmodel. Sheet base sits at ~#4e535a
// so the lifted result is a readable mid worn gunmetal without clipping. If the
// viewmodel reads too dark/bright, tune the multiplier there, not this base.
export function gunMetal(seed = 66) {
  if (cache.gun) return cache.gun;
  const rng = makeRng(seed);
  const S = 256;
  const [c, x] = canvas(S, S);
  const g0 = x.createLinearGradient(0, 0, 0, S);
  g0.addColorStop(0, '#5b6067');
  g0.addColorStop(0.45, '#4e535a');
  g0.addColorStop(1, '#3f434a');
  x.fillStyle = g0; x.fillRect(0, 0, S, S);
  paintBlotches(x, S, S, rng, '#50555c', 240, { rMin: 6, rMax: 30, fLo: 0.82, fHi: 1.2, warmJit: 0.12, alpha: 0.22 });
  // brushed horizontal grain
  x.globalAlpha = 0.09;
  for (let i = 0; i < 110; i++) {
    x.fillStyle = rng() < 0.5 ? '#16191e' : '#7e848c';
    x.fillRect(0, rng() * S, S, 1);
  }
  x.globalAlpha = 1;
  // machining bands
  x.globalAlpha = 0.12;
  for (let i = 0; i < 26; i++) {
    x.strokeStyle = i % 2 ? '#20242a' : '#6d737c';
    x.lineWidth = 1;
    x.beginPath(); x.moveTo(0, i * 10 + 3); x.lineTo(S, i * 10 + 3); x.stroke();
  }
  x.globalAlpha = 1;
  // worn-brighter patches (holster/handling wear)
  for (let i = 0; i < 14; i++) {
    const cx = rng() * S, cy = rng() * S, r = 8 + rng() * 26;
    const g = x.createRadialGradient(cx, cy, 0, cx, cy, r);
    g.addColorStop(0, `rgba(142,149,157,${0.16 + rng() * 0.14})`);
    g.addColorStop(1, 'rgba(142,149,157,0)');
    x.fillStyle = g;
    x.beginPath(); x.arc(cx, cy, r, 0, 7); x.fill();
  }
  // edge-wear scratches: worn-steel nicks (kept sub-white so the multiplier doesn't clip)
  x.lineWidth = 1;
  for (let i = 0; i < 40; i++) {
    const sx = rng() * S, sy = rng() * S;
    const a = (rng() - 0.5) * 0.9; // mostly horizontal
    const l = 5 + rng() * 24;
    x.strokeStyle = `rgba(164,170,178,${0.2 + rng() * 0.25})`;
    x.beginPath(); x.moveTo(sx, sy); x.lineTo(sx + Math.cos(a) * l, sy + Math.sin(a) * l); x.stroke();
  }
  // oil-dark patches
  for (let i = 0; i < 10; i++) {
    const cx = rng() * S, cy = rng() * S, r = 10 + rng() * 24;
    const g = x.createRadialGradient(cx, cy, 0, cx, cy, r);
    g.addColorStop(0, `rgba(12,14,18,${0.22 + rng() * 0.14})`);
    g.addColorStop(1, 'rgba(12,14,18,0)');
    x.fillStyle = g;
    x.beginPath(); x.arc(cx, cy, r, 0, 7); x.fill();
  }
  // faint desert dust in crevices
  for (let i = 0; i < 8; i++) {
    const cx = rng() * S, cy = rng() * S, r = 6 + rng() * 14;
    const g = x.createRadialGradient(cx, cy, 0, cx, cy, r);
    g.addColorStop(0, 'rgba(96,82,54,0.14)');
    g.addColorStop(1, 'rgba(96,82,54,0)');
    x.fillStyle = g;
    x.beginPath(); x.arc(cx, cy, r, 0, 7); x.fill();
  }
  grain(x, S, S, rng, 6000, 0.05);
  cache.gun = toTex(c);
  return cache.gun;
}

// ---------------------------------------------------------------- fabric (uniforms)
export function fabric(tint, seed = 77) {
  const key = 'fab' + tint + seed;
  if (cache[key]) return cache[key];
  const rng = makeRng(seed);
  const [c, x] = canvas(128, 128);
  noisePatch(x, 128, 128, rng, { base: tint, blotches: 340, dark: 0.13, light: 0.08, rMax: 4 });
  paintBlotches(x, 128, 128, rng, tint, 90, { rMin: 8, rMax: 26, fLo: 0.86, fHi: 1.12, warmJit: 0.6, alpha: 0.24 });
  // woven texture
  x.globalAlpha = 0.07;
  x.strokeStyle = '#000'; x.lineWidth = 1;
  for (let i = 0; i < 128; i += 3) {
    x.beginPath(); x.moveTo(i, 0); x.lineTo(i, 128); x.stroke();
  }
  x.strokeStyle = '#fff';
  for (let i = 1; i < 128; i += 3) {
    x.beginPath(); x.moveTo(0, i); x.lineTo(128, i); x.stroke();
  }
  x.globalAlpha = 1;
  // sweat/dust shading
  for (let i = 0; i < 6; i++) {
    const cx = rng() * 128, cy = rng() * 128, r = 14 + rng() * 26;
    const g = x.createRadialGradient(cx, cy, 0, cx, cy, r);
    g.addColorStop(0, `rgba(40,32,18,${0.1 + rng() * 0.1})`);
    g.addColorStop(1, 'rgba(40,32,18,0)');
    x.fillStyle = g;
    x.beginPath(); x.arc(cx, cy, r, 0, 7); x.fill();
  }
  grain(x, 128, 128, rng, 5000, 0.08);
  cache[key] = toTex(c);
  return cache[key];
}

// ---------------------------------------------------------------- tarp / tent stripes
export function awning(c1 = '#a04b38', c2 = '#d8c9a4', seed = 88) {
  const key = 'awn' + c1 + c2;
  if (cache[key]) return cache[key];
  const rng = makeRng(seed);
  const [c, x] = canvas(256, 256);
  for (let i = 0; i < 8; i++) {
    const hex = i % 2 ? c1 : c2;
    const g = x.createLinearGradient(0, 0, 0, 256);
    g.addColorStop(0, tone(hex, 1.1, 0.3));
    g.addColorStop(1, tone(hex, 0.86, -0.1));
    x.fillStyle = g;
    x.fillRect(i * 32, 0, 32, 256);
    // stripe edge shadow
    x.fillStyle = 'rgba(40,20,10,0.16)';
    x.fillRect(i * 32, 0, 2, 256);
  }
  // cloth sag: soft vertical shade bands
  for (let i = 0; i < 5; i++) {
    const sx = 20 + i * 52 + rng() * 14;
    const g = x.createLinearGradient(sx - 16, 0, sx + 16, 0);
    g.addColorStop(0, 'rgba(50,28,14,0)');
    g.addColorStop(0.5, 'rgba(50,28,14,0.18)');
    g.addColorStop(1, 'rgba(50,28,14,0)');
    x.fillStyle = g;
    x.fillRect(sx - 16, 0, 32, 256);
  }
  // sun bleach at top, dirt at the free-hanging edge
  const bg = x.createLinearGradient(0, 0, 0, 90);
  bg.addColorStop(0, 'rgba(255,246,214,0.28)');
  bg.addColorStop(1, 'rgba(255,246,214,0)');
  x.fillStyle = bg; x.fillRect(0, 0, 256, 90);
  const dg = x.createLinearGradient(0, 226, 0, 256);
  dg.addColorStop(0, 'rgba(70,48,26,0)');
  dg.addColorStop(1, 'rgba(70,48,26,0.4)');
  x.fillStyle = dg; x.fillRect(0, 226, 256, 30);
  grain(x, 256, 256, rng, 6000, 0.1);
  cache[key] = toTex(c);
  return cache[key];
}

// ---------------------------------------------------------------- sprites for FX
export function spriteFireball() {
  if (cache.fire) return cache.fire;
  const [c, x] = canvas(128, 128);
  const g = x.createRadialGradient(64, 64, 4, 64, 64, 62);
  g.addColorStop(0, 'rgba(255,255,230,1)');
  g.addColorStop(0.25, 'rgba(255,210,90,0.95)');
  g.addColorStop(0.55, 'rgba(240,110,30,0.8)');
  g.addColorStop(0.8, 'rgba(120,40,10,0.35)');
  g.addColorStop(1, 'rgba(0,0,0,0)');
  x.fillStyle = g; x.fillRect(0, 0, 128, 128);
  cache.fire = toTex(c, { repeat: 1, srgb: true });
  cache.fire.wrapS = cache.fire.wrapT = THREE.ClampToEdgeWrapping;
  return cache.fire;
}

export function spriteSmoke() {
  if (cache.smoke) return cache.smoke;
  const rng = makeRng(99);
  const [c, x] = canvas(128, 128);
  for (let i = 0; i < 26; i++) {
    const px = 34 + rng() * 60, py = 34 + rng() * 60, r = 12 + rng() * 26;
    const g = x.createRadialGradient(px, py, 0, px, py, r);
    g.addColorStop(0, 'rgba(255,255,255,0.16)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    x.fillStyle = g;
    x.beginPath(); x.arc(px, py, r, 0, 7); x.fill();
  }
  cache.smoke = toTex(c);
  cache.smoke.wrapS = cache.smoke.wrapT = THREE.ClampToEdgeWrapping;
  return cache.smoke;
}

export function spriteFlash() {
  if (cache.flash) return cache.flash;
  const [c, x] = canvas(64, 64);
  const g = x.createRadialGradient(32, 32, 1, 32, 32, 30);
  g.addColorStop(0, 'rgba(255,255,240,1)');
  g.addColorStop(0.4, 'rgba(255,220,120,0.9)');
  g.addColorStop(1, 'rgba(255,150,30,0)');
  x.fillStyle = g; x.fillRect(0, 0, 64, 64);
  // star spikes
  x.strokeStyle = 'rgba(255,240,180,0.9)'; x.lineWidth = 3;
  for (let i = 0; i < 4; i++) {
    const a = i * Math.PI / 2 + 0.4;
    x.beginPath(); x.moveTo(32, 32);
    x.lineTo(32 + Math.cos(a) * 30, 32 + Math.sin(a) * 30); x.stroke();
  }
  cache.flash = toTex(c);
  cache.flash.wrapS = cache.flash.wrapT = THREE.ClampToEdgeWrapping;
  return cache.flash;
}

export function spriteScorch() {
  if (cache.scorch) return cache.scorch;
  const rng = makeRng(111);
  const [c, x] = canvas(128, 128);
  const g = x.createRadialGradient(64, 64, 6, 64, 64, 60);
  g.addColorStop(0, 'rgba(10,8,6,0.9)');
  g.addColorStop(0.6, 'rgba(20,14,10,0.55)');
  g.addColorStop(1, 'rgba(0,0,0,0)');
  x.fillStyle = g; x.fillRect(0, 0, 128, 128);
  for (let i = 0; i < 20; i++) { // ragged edge streaks
    const a = rng() * Math.PI * 2, len = 40 + rng() * 22;
    x.strokeStyle = `rgba(12,10,8,${0.3 + rng() * 0.3})`;
    x.lineWidth = 3 + rng() * 6;
    x.beginPath(); x.moveTo(64 + Math.cos(a) * 20, 64 + Math.sin(a) * 20);
    x.lineTo(64 + Math.cos(a) * len, 64 + Math.sin(a) * len); x.stroke();
  }
  cache.scorch = toTex(c);
  cache.scorch.wrapS = cache.scorch.wrapT = THREE.ClampToEdgeWrapping;
  return cache.scorch;
}
