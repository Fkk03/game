// textures.js — all procedural canvas textures (nothing loaded from disk)
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

// value-noise painter used by most generators
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

function grain(ctx, w, h, rng, n = 9000, alpha = 0.05) {
  for (let i = 0; i < n; i++) {
    const v = rng() < 0.5;
    ctx.fillStyle = v ? `rgba(255,255,255,${alpha * rng()})` : `rgba(0,0,0,${alpha * rng()})`;
    ctx.fillRect(rng() * w, rng() * h, 1 + rng() * 1.5, 1 + rng() * 1.5);
  }
}

// ---------------------------------------------------------------- sand detail
export function sandDetail() {
  if (cache.sand) return cache.sand;
  const rng = makeRng(101);
  const [c, x] = canvas(512, 512);
  noisePatch(x, 512, 512, rng, { base: '#c9b184', blotches: 1400, dark: 0.10, light: 0.09, rMax: 9 });
  // wind ripples
  x.globalAlpha = 0.10;
  for (let i = 0; i < 90; i++) {
    const y0 = rng() * 512;
    x.strokeStyle = rng() < 0.5 ? '#8a744f' : '#e8d6ae';
    x.lineWidth = 1 + rng() * 2;
    x.beginPath();
    for (let px = 0; px <= 512; px += 16) {
      const py = y0 + Math.sin(px * 0.02 + i) * 7 + rng() * 3;
      px === 0 ? x.moveTo(px, py) : x.lineTo(px, py);
    }
    x.stroke();
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
  const [c, x] = canvas(256, 256);
  noisePatch(x, 256, 256, rng, { base: tint, blotches: 350, dark: 0.14, light: 0.08 });
  // panel seams
  x.strokeStyle = 'rgba(0,0,0,0.35)'; x.lineWidth = 2;
  for (let i = 0; i <= 4; i++) {
    x.beginPath(); x.moveTo(0, i * 64); x.lineTo(256, i * 64); x.stroke();
    x.beginPath(); x.moveTo(i * 64, 0); x.lineTo(i * 64, 256); x.stroke();
  }
  x.strokeStyle = 'rgba(255,255,255,0.10)'; x.lineWidth = 1;
  for (let i = 0; i <= 4; i++) {
    x.beginPath(); x.moveTo(0, i * 64 + 2); x.lineTo(256, i * 64 + 2); x.stroke();
  }
  // rivets
  x.fillStyle = 'rgba(0,0,0,0.4)';
  for (let i = 0; i <= 4; i++) for (let j = 0; j < 10; j++) {
    x.beginPath(); x.arc(j * 26 + 12, i * 64 + 6, 1.6, 0, 7); x.fill();
  }
  // rust streaks
  for (let i = 0; i < 26; i++) {
    const sx = rng() * 256, sy = rng() * 256, len = 8 + rng() * 36;
    const gr = x.createLinearGradient(sx, sy, sx, sy + len);
    gr.addColorStop(0, 'rgba(120,70,30,0.30)');
    gr.addColorStop(1, 'rgba(120,70,30,0)');
    x.fillStyle = gr;
    x.fillRect(sx, sy, 2 + rng() * 3, len);
  }
  grain(x, 256, 256, rng, 4000, 0.05);
  cache[key] = toTex(c, { repeat: 1 });
  return cache[key];
}

// ---------------------------------------------------------------- adobe / plaster
export function adobe(tint = '#c2a678', seed = 21) {
  const key = 'adobe' + tint + seed;
  if (cache[key]) return cache[key];
  const rng = makeRng(seed);
  const [c, x] = canvas(256, 256);
  noisePatch(x, 256, 256, rng, { base: tint, blotches: 700, dark: 0.12, light: 0.10, rMax: 10 });
  // cracks
  x.strokeStyle = 'rgba(60,40,20,0.35)'; x.lineWidth = 1;
  for (let i = 0; i < 12; i++) {
    let px = rng() * 256, py = rng() * 256;
    x.beginPath(); x.moveTo(px, py);
    for (let s = 0; s < 6; s++) {
      px += (rng() - 0.5) * 30; py += rng() * 22;
      x.lineTo(px, py);
    }
    x.stroke();
  }
  // base dirt band
  const gr = x.createLinearGradient(0, 180, 0, 256);
  gr.addColorStop(0, 'rgba(90,64,36,0)');
  gr.addColorStop(1, 'rgba(90,64,36,0.45)');
  x.fillStyle = gr; x.fillRect(0, 180, 256, 76);
  grain(x, 256, 256, rng, 5000, 0.06);
  cache[key] = toTex(c, { repeat: 1 });
  return cache[key];
}

// ---------------------------------------------------------------- corrugated roof
export function corrugated(tint = '#8d8d82', seed = 33) {
  const key = 'corr' + tint + seed;
  if (cache[key]) return cache[key];
  const rng = makeRng(seed);
  const [c, x] = canvas(256, 256);
  x.fillStyle = tint; x.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 32; i++) {
    const px = i * 8;
    const g = x.createLinearGradient(px, 0, px + 8, 0);
    g.addColorStop(0, 'rgba(0,0,0,0.35)');
    g.addColorStop(0.5, 'rgba(255,255,255,0.15)');
    g.addColorStop(1, 'rgba(0,0,0,0.35)');
    x.fillStyle = g; x.fillRect(px, 0, 8, 256);
  }
  for (let i = 0; i < 30; i++) { // rust
    const sx = rng() * 256, sy = rng() * 256;
    x.fillStyle = `rgba(${110 + rng() * 40 | 0},${60 + rng() * 20 | 0},25,${0.2 + rng() * 0.25})`;
    x.beginPath(); x.arc(sx, sy, 3 + rng() * 12, 0, 7); x.fill();
  }
  grain(x, 256, 256, rng, 3000, 0.05);
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
  for (let i = 0; i < 60; i++) {
    x.fillStyle = cols[i % cols.length];
    x.beginPath();
    const cx = rng() * 256, cy = rng() * 256;
    x.moveTo(cx, cy);
    for (let s = 0; s < 7; s++) {
      x.lineTo(cx + (rng() - 0.5) * 70, cy + (rng() - 0.5) * 70);
    }
    x.closePath(); x.fill();
  }
  grain(x, 256, 256, rng, 6000, 0.07);
  cache[key] = toTex(c);
  return cache[key];
}

// ---------------------------------------------------------------- concrete
export function concrete(tint = '#9a958a', seed = 55) {
  const key = 'conc' + tint + seed;
  if (cache[key]) return cache[key];
  const rng = makeRng(seed);
  const [c, x] = canvas(256, 256);
  noisePatch(x, 256, 256, rng, { base: tint, blotches: 500, dark: 0.10, light: 0.07, rMax: 14 });
  x.strokeStyle = 'rgba(0,0,0,0.25)'; x.lineWidth = 2;
  x.strokeRect(2, 2, 252, 252);
  grain(x, 256, 256, rng, 8000, 0.06);
  cache[key] = toTex(c);
  return cache[key];
}

// ---------------------------------------------------------------- gun metal
export function gunMetal(seed = 66) {
  if (cache.gun) return cache.gun;
  const rng = makeRng(seed);
  const [c, x] = canvas(128, 128);
  noisePatch(x, 128, 128, rng, { base: '#2e2f30', blotches: 250, dark: 0.2, light: 0.12, rMax: 5 });
  x.globalAlpha = 0.15;
  for (let i = 0; i < 26; i++) { // machining lines
    x.strokeStyle = i % 2 ? '#000' : '#889';
    x.beginPath(); x.moveTo(0, i * 5); x.lineTo(128, i * 5); x.stroke();
  }
  x.globalAlpha = 1;
  cache.gun = toTex(c);
  return cache.gun;
}

// ---------------------------------------------------------------- fabric (uniforms)
export function fabric(tint, seed = 77) {
  const key = 'fab' + tint + seed;
  if (cache[key]) return cache[key];
  const rng = makeRng(seed);
  const [c, x] = canvas(128, 128);
  noisePatch(x, 128, 128, rng, { base: tint, blotches: 400, dark: 0.14, light: 0.09, rMax: 4 });
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
    x.fillStyle = i % 2 ? c1 : c2;
    x.fillRect(i * 32, 0, 32, 256);
  }
  grain(x, 256, 256, rng, 6000, 0.10);
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
