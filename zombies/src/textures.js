// Procedural texture factory. Everything is generated on canvas — no external assets.
// Each maker returns { map, bumpMap, roughnessMap } (CanvasTextures, repeat-wrapped).
import * as THREE from 'three';
import { makeRng } from './rng.js';

function cv(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return [c, c.getContext('2d')];
}

function tex(canvas, { srgb = true, repeat = [1, 1] } = {}) {
  const t = new THREE.CanvasTexture(canvas);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeat[0], repeat[1]);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

// Value noise painted as translucent speckle layers.
function grime(ctx, w, h, rng, { passes = 3, dark = 0.14, light = 0.06, scale = 3 } = {}) {
  for (let p = 0; p < passes; p++) {
    const n = Math.floor((w * h) / (42 * scale));
    for (let i = 0; i < n; i++) {
      const x = rng() * w, y = rng() * h, r = rng.range(1, 3.4 * scale);
      const d = rng() < 0.62;
      ctx.fillStyle = d ? `rgba(0,0,0,${(rng() * dark).toFixed(3)})` : `rgba(255,255,250,${(rng() * light).toFixed(3)})`;
      ctx.beginPath(); ctx.arc(x, y, r, 0, 7); ctx.fill();
    }
  }
}

// Draw a radial blob wrapped at tile edges (9 positions) so textures stay seamless.
function blob9(ctx, w, h, x, y, r, paint) {
  for (const ox of [-w, 0, w]) for (const oy of [-h, 0, h]) {
    if (x + ox + r < 0 || x + ox - r > w || y + oy + r < 0 || y + oy - r > h) continue;
    paint(x + ox, y + oy);
  }
}

function stains(ctx, w, h, rng, count = 5, color = '20,14,8', maxA = 0.22) {
  for (let i = 0; i < count; i++) {
    const x = rng() * w, y = rng() * h, r = rng.range(w * 0.06, w * 0.24);
    const a = (rng() * maxA).toFixed(3);
    blob9(ctx, w, h, x, y, r, (px, py) => {
      const g = ctx.createRadialGradient(px, py, r * 0.45, px, py, r);
      g.addColorStop(0, `rgba(${color},${a})`);
      g.addColorStop(1, `rgba(${color},0)`);
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(px, py, r, 0, 7); ctx.fill();
    });
  }
}

// Streaks running down from the top area — weathering / water damage.
function dripStreaks(ctx, w, h, rng, count = 8) {
  for (let i = 0; i < count; i++) {
    const x = rng() * w, len = rng.range(h * 0.2, h * 0.85), y0 = rng() * h * 0.3;
    const g = ctx.createLinearGradient(0, y0, 0, y0 + len);
    g.addColorStop(0, `rgba(10,8,6,${rng.range(0.06, 0.2).toFixed(3)})`);
    g.addColorStop(1, 'rgba(10,8,6,0)');
    ctx.fillStyle = g;
    ctx.fillRect(x, y0, rng.range(1.5, 5), len);
  }
}

function cracks(ctx, w, h, rng, count = 4) {
  ctx.strokeStyle = 'rgba(8,6,5,0.55)';
  for (let i = 0; i < count; i++) {
    let x = rng() * w, y = rng() * h * 0.4;
    ctx.lineWidth = rng.range(0.6, 1.6);
    ctx.beginPath(); ctx.moveTo(x, y);
    const segs = rng.int(5, 11);
    for (let s = 0; s < segs; s++) {
      x += rng.range(-14, 14); y += rng.range(6, 26);
      ctx.lineTo(x, y);
      if (rng() < 0.3) { // branch
        ctx.moveTo(x, y);
        ctx.lineTo(x + rng.range(-20, 20), y + rng.range(4, 18));
        ctx.moveTo(x, y);
      }
    }
    ctx.stroke();
  }
}

// Grayscale height companion painted alongside color; also used for roughness.
function makeHeightRough(w, h, paint) {
  const [hc, hx] = cv(w, h);
  const [rc, rx] = cv(w, h);
  paint(hx, rx);
  return { bumpMap: tex(hc, { srgb: false }), roughnessMap: tex(rc, { srgb: false }) };
}

export function brickTexture({ w = 512, h = 512, seed = 11, base = [96, 62, 50], repeat = [1, 1] } = {}) {
  const rng = makeRng(seed);
  const [c, x] = cv(w, h);
  const bw = 59, bh = 27, mortar = 5; // cell sizes divide 512 -> seamless tiling
  x.fillStyle = '#3c3733'; x.fillRect(0, 0, w, h); // mortar
  const rows = Math.ceil(h / (bh + mortar));
  const heights = [];
  for (let r = 0; r < rows; r++) {
    const off = (r % 2) * (bw / 2);
    for (let i = -1; i < Math.ceil(w / (bw + mortar)) + 1; i++) {
      const bx = i * (bw + mortar) + off, by = r * (bh + mortar);
      const tint = rng.range(0.86, 1.1);
      const rr = Math.floor(base[0] * tint + rng.range(-7, 7));
      const gg = Math.floor(base[1] * tint + rng.range(-5, 5));
      const bb = Math.floor(base[2] * tint + rng.range(-5, 5));
      x.fillStyle = `rgb(${rr},${gg},${bb})`;
      x.fillRect(bx, by, bw, bh);
      // per-brick shading: darker bottom edge, lighter top
      x.fillStyle = 'rgba(0,0,0,0.22)'; x.fillRect(bx, by + bh - 3, bw, 3);
      x.fillStyle = 'rgba(255,255,240,0.07)'; x.fillRect(bx, by, bw, 2);
      if (rng() < 0.07) { x.fillStyle = 'rgba(20,16,12,0.28)'; x.fillRect(bx, by, bw, bh); } // burnt brick
      heights.push([bx, by]);
    }
  }
  grime(x, w, h, rng, { passes: 3 });
  dripStreaks(x, w, h, rng, 10);
  stains(x, w, h, rng, 4);
  const { bumpMap, roughnessMap } = makeHeightRough(w, h, (hx, rx) => {
    hx.fillStyle = '#2a2a2a'; hx.fillRect(0, 0, w, h);
    rx.fillStyle = '#c8c8c8'; rx.fillRect(0, 0, w, h);
    const r2 = makeRng(seed + 1);
    for (let r = 0; r < rows; r++) {
      const off = (r % 2) * (bw / 2);
      for (let i = -1; i < Math.ceil(w / (bw + mortar)) + 1; i++) {
        const bx = i * (bw + mortar) + off, by = r * (bh + mortar);
        const v = Math.floor(r2.range(150, 210));
        hx.fillStyle = `rgb(${v},${v},${v})`; hx.fillRect(bx, by, bw, bh);
        const rv = Math.floor(r2.range(185, 215));
        rx.fillStyle = `rgb(${rv},${rv},${rv})`; rx.fillRect(bx, by, bw, bh);
      }
    }
  });
  return { map: tex(c, { repeat }), bumpMap, roughnessMap };
}

export function concreteTexture({ w = 512, h = 512, seed = 21, base = 118, tint = [1, 1, 0.97], repeat = [1, 1] } = {}) {
  const rng = makeRng(seed);
  const [c, x] = cv(w, h);
  x.fillStyle = `rgb(${Math.floor(base * tint[0])},${Math.floor(base * tint[1])},${Math.floor(base * tint[2])})`;
  x.fillRect(0, 0, w, h);
  grime(x, w, h, rng, { passes: 4, dark: 0.16, light: 0.05 });
  // aggregate speckle
  for (let i = 0; i < 900; i++) {
    const v = rng() < 0.5 ? 'rgba(0,0,0,0.18)' : 'rgba(255,255,255,0.10)';
    x.fillStyle = v;
    x.fillRect(rng() * w, rng() * h, rng.range(1, 2.4), rng.range(1, 2.4));
  }
  cracks(x, w, h, rng, 5);
  dripStreaks(x, w, h, rng, 12);
  stains(x, w, h, rng, 6);
  const { bumpMap, roughnessMap } = makeHeightRough(w, h, (hx, rx) => {
    hx.fillStyle = '#8a8a8a'; hx.fillRect(0, 0, w, h);
    const r2 = makeRng(seed + 3);
    for (let i = 0; i < 1400; i++) {
      const v = Math.floor(r2.range(110, 170));
      hx.fillStyle = `rgb(${v},${v},${v})`;
      hx.fillRect(r2() * w, r2() * h, r2.range(1, 4), r2.range(1, 4));
    }
    rx.fillStyle = '#b8b8b8'; rx.fillRect(0, 0, w, h);
  });
  return { map: tex(c, { repeat }), bumpMap, roughnessMap };
}

export function woodTexture({ w = 512, h = 512, seed = 31, base = [92, 66, 42], planks = 6, vertical = false, repeat = [1, 1] } = {}) {
  const rng = makeRng(seed);
  const [c, x] = cv(w, h);
  const pw = (vertical ? w : h) / planks;
  for (let p = 0; p < planks; p++) {
    const tint = rng.range(0.68, 1.12);
    const col = `rgb(${Math.floor(base[0] * tint)},${Math.floor(base[1] * tint)},${Math.floor(base[2] * tint)})`;
    x.fillStyle = col;
    if (vertical) x.fillRect(p * pw, 0, pw, h); else x.fillRect(0, p * pw, w, pw);
    // grain streaks
    for (let g = 0; g < 26; g++) {
      const a = rng.range(0.05, 0.22);
      x.strokeStyle = rng() < 0.72 ? `rgba(30,20,10,${a})` : `rgba(200,170,120,${a * 0.7})`;
      x.lineWidth = rng.range(0.5, 1.8);
      x.beginPath();
      if (vertical) {
        let gx = p * pw + rng() * pw; x.moveTo(gx, 0);
        for (let s = 0; s < 6; s++) x.lineTo(gx + rng.range(-3, 3), (s + 1) * (h / 6));
      } else {
        let gy = p * pw + rng() * pw; x.moveTo(0, gy);
        for (let s = 0; s < 6; s++) x.lineTo((s + 1) * (w / 6), gy + rng.range(-3, 3));
      }
      x.stroke();
    }
    // knots
    if (rng() < 0.6) {
      const kx = vertical ? p * pw + pw / 2 : rng() * w;
      const ky = vertical ? rng() * h : p * pw + pw / 2;
      const kr = rng.range(3, 8);
      const g = x.createRadialGradient(kx, ky, 1, kx, ky, kr);
      g.addColorStop(0, 'rgba(25,15,8,0.85)'); g.addColorStop(1, 'rgba(25,15,8,0)');
      x.fillStyle = g; x.beginPath(); x.arc(kx, ky, kr, 0, 7); x.fill();
    }
    // plank gap
    x.fillStyle = 'rgba(0,0,0,0.55)';
    if (vertical) x.fillRect(p * pw - 1, 0, 2, h); else x.fillRect(0, p * pw - 1, w, 2);
  }
  grime(x, w, h, rng, { passes: 2 });
  const { bumpMap, roughnessMap } = makeHeightRough(w, h, (hx, rx) => {
    hx.fillStyle = '#909090'; hx.fillRect(0, 0, w, h);
    hx.fillStyle = '#404040';
    for (let p = 0; p < planks; p++) {
      if (vertical) hx.fillRect(p * pw - 1, 0, 2, h); else hx.fillRect(0, p * pw - 1, w, 2);
    }
    rx.fillStyle = '#a8a8a8'; rx.fillRect(0, 0, w, h);
  });
  return { map: tex(c, { repeat }), bumpMap, roughnessMap };
}

export function metalTexture({ w = 256, h = 256, seed = 41, base = [88, 90, 94], rust = 0.35, repeat = [1, 1] } = {}) {
  const rng = makeRng(seed);
  const [c, x] = cv(w, h);
  x.fillStyle = `rgb(${base[0]},${base[1]},${base[2]})`; x.fillRect(0, 0, w, h);
  // brushed lines
  for (let i = 0; i < 160; i++) {
    x.strokeStyle = rng() < 0.5 ? `rgba(255,255,255,${rng() * 0.06})` : `rgba(0,0,0,${rng() * 0.1})`;
    x.lineWidth = 1;
    const y = rng() * h;
    x.beginPath(); x.moveTo(0, y); x.lineTo(w, y + rng.range(-2, 2)); x.stroke();
  }
  // rust patches
  const patches = Math.floor(rust * 14);
  for (let i = 0; i < patches; i++) {
    const px = rng() * w, py = rng() * h, pr = rng.range(8, 34);
    const g = x.createRadialGradient(px, py, 1, px, py, pr);
    g.addColorStop(0, `rgba(122,58,26,${rng.range(0.35, 0.7)})`);
    g.addColorStop(0.7, `rgba(96,44,20,${rng.range(0.15, 0.4)})`);
    g.addColorStop(1, 'rgba(96,44,20,0)');
    x.fillStyle = g; x.beginPath(); x.arc(px, py, pr, 0, 7); x.fill();
    for (let s = 0; s < 20; s++) {
      x.fillStyle = `rgba(140,70,30,${rng() * 0.5})`;
      const a = rng() * 7, d = rng() * pr;
      x.fillRect(px + Math.cos(a) * d, py + Math.sin(a) * d, 1.6, 1.6);
    }
  }
  // scratches
  for (let i = 0; i < 22; i++) {
    x.strokeStyle = `rgba(210,215,220,${rng.range(0.1, 0.4)})`;
    x.lineWidth = 0.8;
    const sx = rng() * w, sy = rng() * h;
    x.beginPath(); x.moveTo(sx, sy);
    x.lineTo(sx + rng.range(-26, 26), sy + rng.range(-26, 26)); x.stroke();
  }
  grime(x, w, h, rng, { passes: 2, dark: 0.12 });
  const { bumpMap, roughnessMap } = makeHeightRough(w, h, (hx, rx) => {
    hx.fillStyle = '#808080'; hx.fillRect(0, 0, w, h);
    rx.fillStyle = '#787878'; rx.fillRect(0, 0, w, h);
    const r2 = makeRng(seed + 5);
    for (let i = 0; i < patches * 3; i++) {
      rx.fillStyle = '#d8d8d8';
      rx.beginPath(); rx.arc(r2() * w, r2() * h, r2.range(6, 22), 0, 7); rx.fill();
    }
  });
  return { map: tex(c, { repeat }), bumpMap, roughnessMap };
}

export function groundTexture({ w = 1024, h = 1024, seed = 51, repeat = [26, 26] } = {}) {
  const rng = makeRng(seed);
  const [c, x] = cv(w, h);
  // mud base with large soft tonal variation first (reads at distance)
  x.fillStyle = '#41372a'; x.fillRect(0, 0, w, h);
  for (let i = 0; i < 40; i++) {
    const px = rng() * w, py = rng() * h, pr = rng.range(90, 260);
    const dark = rng() < 0.55;
    const col = dark ? `rgba(20,16,10,${rng.range(0.08, 0.2)})` : `rgba(110,94,66,${rng.range(0.05, 0.14)})`;
    blob9(x, w, h, px, py, pr, (qx, qy) => {
      const g = x.createRadialGradient(qx, qy, pr * 0.25, qx, qy, pr);
      g.addColorStop(0, col);
      g.addColorStop(1, 'rgba(0,0,0,0)');
      x.fillStyle = g; x.beginPath(); x.arc(qx, qy, pr, 0, 7); x.fill();
    });
  }
  grime(x, w, h, rng, { passes: 2, dark: 0.1, light: 0.04, scale: 5 });
  // dirt clumps / small stones (soft, no outlines)
  for (let i = 0; i < 160; i++) {
    const px = rng() * w, py = rng() * h, pr = rng.range(3, 14);
    const g = x.createRadialGradient(px, py, 1, px, py, pr);
    const dark = rng() < 0.6;
    g.addColorStop(0, dark ? `rgba(22,17,11,${rng.range(0.15, 0.4)})` : `rgba(104,90,64,${rng.range(0.1, 0.24)})`);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    x.fillStyle = g; x.beginPath(); x.arc(px, py, pr, 0, 7); x.fill();
  }
  // wheel ruts: two long soft dark tracks with highlights between
  for (let r = 0; r < 2; r++) {
    const y0 = h * (0.3 + r * 0.34);
    x.strokeStyle = 'rgba(16,12,8,0.28)';
    x.lineWidth = 26;
    x.beginPath();
    x.moveTo(0, y0);
    for (let sx0 = 0; sx0 <= w; sx0 += w / 6) x.lineTo(sx0, y0 + Math.sin(sx0 * 0.01 + r) * 22);
    x.stroke();
    x.strokeStyle = 'rgba(120,104,74,0.12)';
    x.lineWidth = 10;
    x.stroke();
  }
  // sparse dead grass tufts (clustered, not uniform)
  for (let cl = 0; cl < 40; cl++) {
    const cx0 = rng() * w, cy0 = rng() * h;
    const n = rng.int(4, 14);
    for (let i = 0; i < n; i++) {
      x.strokeStyle = `rgba(${Math.floor(rng.range(86, 118))},${Math.floor(rng.range(74, 96))},44,${rng.range(0.25, 0.5)})`;
      x.lineWidth = 1;
      const gx = cx0 + rng.range(-14, 14), gy = cy0 + rng.range(-10, 10);
      x.beginPath(); x.moveTo(gx, gy); x.lineTo(gx + rng.range(-4, 4), gy - rng.range(4, 11)); x.stroke();
    }
  }
  stains(x, w, h, rng, 6, '14,11,7', 0.28);
  const { bumpMap, roughnessMap } = makeHeightRough(w, h, (hx, rx) => {
    hx.fillStyle = '#7a7a7a'; hx.fillRect(0, 0, w, h);
    const r2 = makeRng(seed + 7);
    for (let i = 0; i < 2000; i++) {
      const v = Math.floor(r2.range(90, 170));
      hx.fillStyle = `rgb(${v},${v},${v})`;
      hx.beginPath(); hx.arc(r2() * w, r2() * h, r2.range(2, 9), 0, 7); hx.fill();
    }
    rx.fillStyle = '#cccccc'; rx.fillRect(0, 0, w, h);
    // darker roughness = shinier -> puddles
    for (let i = 0; i < 9; i++) {
      rx.fillStyle = '#303030';
      rx.beginPath(); rx.ellipse(r2() * w, r2() * h, r2.range(24, 70), r2.range(16, 44), r2() * 3, 0, 7); rx.fill();
    }
  });
  return { map: tex(c, { repeat }), bumpMap, roughnessMap };
}

export function plasterTexture({ w = 512, h = 512, seed = 61, base = [97, 89, 77], repeat = [1, 1] } = {}) {
  const rng = makeRng(seed);
  const [c, x] = cv(w, h);
  x.fillStyle = `rgb(${base[0]},${base[1]},${base[2]})`; x.fillRect(0, 0, w, h);
  // large soft tonal mottling (aged plaster), then only fine low-contrast grime
  for (let i = 0; i < 26; i++) {
    const px = rng() * w, py = rng() * h, pr = rng.range(60, 180);
    const dark = rng() < 0.6;
    const col = dark ? `rgba(40,34,26,${rng.range(0.04, 0.12)})` : `rgba(255,250,235,${rng.range(0.03, 0.08)})`;
    blob9(x, w, h, px, py, pr, (qx, qy) => {
      const g = x.createRadialGradient(qx, qy, pr * 0.2, qx, qy, pr);
      g.addColorStop(0, col);
      g.addColorStop(1, 'rgba(0,0,0,0)');
      x.fillStyle = g; x.beginPath(); x.arc(qx, qy, pr, 0, 7); x.fill();
    });
  }
  grime(x, w, h, rng, { passes: 2, dark: 0.07, light: 0.03 });
  // one believable peeled patch revealing brick, kept away from tile edges
  for (let i = 0; i < 1; i++) {
    const px = rng.range(w * 0.25, w * 0.75), py = rng.range(h * 0.55, h * 0.8);
    x.save();
    x.beginPath();
    let a0 = rng() * 7;
    const rs = [];
    for (let s = 0; s <= 10; s++) rs.push(rng.range(24, 46));
    x.moveTo(px + Math.cos(a0) * rs[0], py + Math.sin(a0) * rs[0]);
    for (let s = 1; s <= 10; s++) {
      const a = a0 + (s / 10) * Math.PI * 2;
      x.lineTo(px + Math.cos(a) * rs[s], py + Math.sin(a) * rs[s]);
    }
    x.closePath(); x.clip();
    x.fillStyle = '#54402f'; x.fillRect(px - 60, py - 60, 120, 120);
    x.fillStyle = 'rgba(40,34,28,0.8)';
    for (let b = 0; b < 5; b++) x.fillRect(px - 60, py - 58 + b * 24, 120, 3);
    for (let b = 0; b < 8; b++) { // brick joints
      x.fillRect(px - 60 + ((b % 2) * 20) + Math.floor(b / 2) * 38, py - 58 + (b % 4) * 24, 3, 22);
    }
    x.restore();
  }
  cracks(x, w, h, rng, 4);
  dripStreaks(x, w, h, rng, 7);
  stains(x, w, h, rng, 3, '30,24,16', 0.07);
  const { bumpMap, roughnessMap } = makeHeightRough(w, h, (hx, rx) => {
    hx.fillStyle = '#9a9a9a'; hx.fillRect(0, 0, w, h);
    rx.fillStyle = '#c0c0c0'; rx.fillRect(0, 0, w, h);
  });
  return { map: tex(c, { repeat }), bumpMap, roughnessMap };
}

export function zombieSkinTexture({ seed = 71, tone = [126, 138, 108] } = {}) {
  const rng = makeRng(seed);
  const w = 256, h = 256;
  const [c, x] = cv(w, h);
  x.fillStyle = `rgb(${tone[0]},${tone[1]},${tone[2]})`; x.fillRect(0, 0, w, h);
  grime(x, w, h, rng, { passes: 3, dark: 0.18, light: 0.08 });
  // veins
  for (let i = 0; i < 14; i++) {
    x.strokeStyle = `rgba(60,40,70,${rng.range(0.15, 0.4)})`;
    x.lineWidth = rng.range(0.6, 1.4);
    let vx = rng() * w, vy = rng() * h;
    x.beginPath(); x.moveTo(vx, vy);
    for (let s = 0; s < 5; s++) { vx += rng.range(-16, 16); vy += rng.range(-16, 16); x.lineTo(vx, vy); }
    x.stroke();
  }
  // wounds / rot patches
  for (let i = 0; i < 9; i++) {
    const px = rng() * w, py = rng() * h, pr = rng.range(5, 18);
    const g = x.createRadialGradient(px, py, 1, px, py, pr);
    g.addColorStop(0, `rgba(88,26,20,${rng.range(0.5, 0.9)})`);
    g.addColorStop(0.6, `rgba(60,30,26,${rng.range(0.3, 0.5)})`);
    g.addColorStop(1, 'rgba(60,30,26,0)');
    x.fillStyle = g; x.beginPath(); x.arc(px, py, pr, 0, 7); x.fill();
  }
  const { bumpMap, roughnessMap } = makeHeightRough(w, h, (hx, rx) => {
    hx.fillStyle = '#909090'; hx.fillRect(0, 0, w, h);
    rx.fillStyle = '#b0b0b0'; rx.fillRect(0, 0, w, h);
  });
  return { map: tex(c), bumpMap, roughnessMap };
}

export function clothTexture({ seed = 81, base = [60, 62, 58] } = {}) {
  const rng = makeRng(seed);
  const w = 256, h = 256;
  const [c, x] = cv(w, h);
  x.fillStyle = `rgb(${base[0]},${base[1]},${base[2]})`; x.fillRect(0, 0, w, h);
  // weave
  for (let y = 0; y < h; y += 3) {
    x.fillStyle = `rgba(0,0,0,${0.06 + 0.05 * (y % 6 === 0)})`;
    x.fillRect(0, y, w, 1);
  }
  for (let xx = 0; xx < w; xx += 3) {
    x.fillStyle = 'rgba(255,255,255,0.03)';
    x.fillRect(xx, 0, 1, h);
  }
  grime(x, w, h, rng, { passes: 3, dark: 0.22, light: 0.03 });
  // tears
  for (let i = 0; i < 7; i++) {
    x.fillStyle = `rgba(12,10,8,${rng.range(0.5, 0.9)})`;
    const tx = rng() * w, ty = rng() * h;
    x.beginPath();
    x.ellipse(tx, ty, rng.range(2, 9), rng.range(6, 20), rng() * 3, 0, 7);
    x.fill();
  }
  stains(x, w, h, rng, 5, '40,8,6', 0.5); // blood stains
  return { map: tex(c) };
}

export function bloodSplatTexture({ seed = 91, size = 256 } = {}) {
  const rng = makeRng(seed);
  const [c, x] = cv(size, size);
  const cx0 = size / 2, cy0 = size / 2;
  const g = x.createRadialGradient(cx0, cy0, 2, cx0, cy0, size * 0.32);
  g.addColorStop(0, 'rgba(96,8,6,0.95)');
  g.addColorStop(0.75, 'rgba(70,6,5,0.7)');
  g.addColorStop(1, 'rgba(70,6,5,0)');
  x.fillStyle = g; x.beginPath(); x.arc(cx0, cy0, size * 0.32, 0, 7); x.fill();
  for (let i = 0; i < 46; i++) { // spatter droplets
    const a = rng() * 7, d = rng.range(size * 0.14, size * 0.47);
    const px = cx0 + Math.cos(a) * d, py = cy0 + Math.sin(a) * d;
    x.fillStyle = `rgba(${rng.int(70, 110)},7,6,${rng.range(0.5, 0.95)})`;
    x.beginPath();
    x.ellipse(px, py, rng.range(1.5, 7), rng.range(1.5, 5), a, 0, 7);
    x.fill();
  }
  const t = tex(c); t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  return t;
}

export function bulletHoleTexture({ size = 64 } = {}) {
  const [c, x] = cv(size, size);
  const m = size / 2;
  let g = x.createRadialGradient(m, m, 1, m, m, m * 0.9);
  g.addColorStop(0, 'rgba(8,7,6,0.95)');
  g.addColorStop(0.32, 'rgba(20,17,14,0.8)');
  g.addColorStop(0.6, 'rgba(30,26,22,0.35)');
  g.addColorStop(1, 'rgba(30,26,22,0)');
  x.fillStyle = g; x.fillRect(0, 0, size, size);
  const t = tex(c); t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  return t;
}

// Wall-buy chalk outline of a weapon (drawn as line art).
export function chalkWeaponTexture(kind, { size = 256 } = {}) {
  const [c, x] = cv(size, 128);
  x.strokeStyle = 'rgba(235,235,225,0.92)';
  x.lineWidth = 3;
  x.lineJoin = x.lineCap = 'round';
  x.setLineDash([7, 4]);
  x.beginPath();
  if (kind === 'rifle') {
    x.moveTo(16, 74); x.lineTo(60, 60); x.lineTo(196, 56); x.lineTo(238, 58); x.lineTo(238, 64); x.lineTo(196, 68);
    x.lineTo(120, 70); x.lineTo(110, 92); x.lineTo(96, 92); x.lineTo(100, 70); x.lineTo(60, 74); x.lineTo(30, 92); x.lineTo(16, 88); x.closePath();
  } else if (kind === 'smg') {
    x.moveTo(40, 56); x.lineTo(190, 52); x.lineTo(214, 58); x.lineTo(214, 66); x.lineTo(150, 70);
    x.lineTo(146, 96); x.lineTo(132, 96); x.lineTo(134, 70); x.lineTo(96, 70); x.lineTo(88, 88); x.lineTo(74, 86); x.lineTo(80, 68); x.lineTo(40, 64); x.closePath();
    x.moveTo(150, 70); x.lineTo(158, 100); x.lineTo(170, 100); // mag
  } else if (kind === 'shotgun') {
    x.moveTo(20, 70); x.lineTo(70, 58); x.lineTo(230, 54); x.lineTo(236, 62); x.lineTo(150, 68); x.lineTo(120, 76); x.lineTo(96, 76); x.lineTo(60, 76); x.lineTo(34, 92); x.lineTo(20, 86); x.closePath();
  } else { // grenade
    x.arc(128, 70, 26, 0, 7); x.moveTo(120, 44); x.lineTo(118, 32); x.lineTo(142, 30); x.lineTo(142, 40);
  }
  x.stroke();
  const t = tex(c); t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  return t;
}

// Graffiti / signage decal text.
export function graffitiTexture(text, { size = 512, color = 'rgba(180,30,26,0.85)', font = 'bold 64px Georgia' } = {}) {
  const [c, x] = cv(size, size / 2);
  x.font = font;
  x.textAlign = 'center'; x.textBaseline = 'middle';
  x.fillStyle = color;
  x.save();
  x.translate(size / 2, size / 4);
  x.rotate(-0.03);
  x.fillText(text, 0, 0);
  // drips under letters
  x.restore();
  const t = tex(c); t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  return t;
}
