// terrain.js — heightfield desert, composite painted ground, scatter (rocks/shrubs)
import * as THREE from 'three';
import { ImprovedNoise } from 'three/addons/math/ImprovedNoise.js';
import { G, WORLD_SIZE, HALF, makeRng, clamp } from './core.js';
import { sandDetail } from './textures.js';
import { LAYOUT, roadCurve } from './layout.js';

const GRID = 256;                      // height samples per side
let heights = null;                    // Float32Array (GRID+1)^2

const noise = new ImprovedNoise();

function fbm(x, z) {
  let a = 0, amp = 1, f = 1;
  for (let o = 0; o < 4; o++) {
    a += noise.noise(x * f, z * f, 7.7) * amp;
    amp *= 0.5; f *= 2.1;
  }
  return a;
}

// raw sculpted height before flattening
function rawHeight(x, z) {
  const nx = x / WORLD_SIZE, nz = z / WORLD_SIZE;
  let h = fbm(nx * 3.0 + 10, nz * 3.0 + 10) * 5.5;        // rolling dunes
  h += fbm(nx * 9 + 40, nz * 9 + 40) * 1.1;               // small bumps
  // border mountains: rise sharply near the map edge to wall the world in
  const ex = Math.max(Math.abs(x), Math.abs(z)) / HALF;   // 0 centre → 1 edge
  const wall = Math.pow(clamp((ex - 0.82) / 0.18, 0, 1), 2.2);
  let mh = wall * (30 + fbm(nx * 6, nz * 6) * 14);
  if (mh > 4) {
    // terrace the wall into stepped benches so the border reads as rocky mesas
    const step = 8, k = mh / step, fk = Math.floor(k), fr = k - fk;
    const s = clamp((fr - 0.5) * 2.4 + 0.5, 0, 1);
    mh = mh * 0.4 + (fk + s * s * (3 - 2 * s)) * step * 0.6;
  }
  h += mh;
  // a long ridge across the middle-east for drama
  const rd = Math.abs((x - z * 0.35) - 260) / 90;
  h += Math.max(0, 1 - rd) * 9 * (0.6 + fbm(nx * 5 + 3, nz * 5 + 3) * 0.4);
  return h;
}

function applyFlats(x, z, h) {
  for (const f of LAYOUT.flats) {
    const d = Math.hypot(x - f.x, z - f.z);
    if (d < f.r) {
      const t = smooth(1 - d / f.r);
      h = h * (1 - t) + f.h * t;
    }
  }
  return h;
}
const smooth = (t) => t * t * (3 - 2 * t);

// flatten a corridor along road curves
let roadSamples = [];
function collectRoadSamples() {
  roadSamples = [];
  for (const path of [LAYOUT.road, LAYOUT.road2]) {
    const c = roadCurve(path);
    const n = Math.ceil(c.getLength() / 4);
    for (let i = 0; i <= n; i++) roadSamples.push(c.getPoint(i / n));
  }
}
function applyRoad(x, z, h) {
  let best = 1e9, bh = 0;
  for (const p of roadSamples) {
    const d = Math.hypot(x - p.x, z - p.z);
    if (d < best) { best = d; bh = p.y; }
  }
  const R = 14;
  if (best < R) {
    const t = smooth(1 - best / R);
    // pull toward the local average height of the road (sampled at build time)
    h = h * (1 - t * 0.85) + roadHeightAt(x, z) * (t * 0.85);
  }
  return h;
}
// road elevation = raw height smoothed heavily (so the road rolls gently)
function roadHeightAt(x, z) {
  let s = 0;
  const R = 26;
  s += rawHeightFlat(x + R, z) + rawHeightFlat(x - R, z) + rawHeightFlat(x, z + R) + rawHeightFlat(x, z - R);
  return s / 4;
}
function rawHeightFlat(x, z) { return applyFlats(x, z, rawHeight(x, z)); }

export function buildTerrain() {
  collectRoadSamples();
  const N = GRID + 1;
  heights = new Float32Array(N * N);
  for (let iz = 0; iz < N; iz++) {
    for (let ix = 0; ix < N; ix++) {
      const x = (ix / GRID - 0.5) * WORLD_SIZE;
      const z = (iz / GRID - 0.5) * WORLD_SIZE;
      let h = rawHeight(x, z);
      h = applyFlats(x, z, h);
      h = applyRoad(x, z, h);
      heights[iz * N + ix] = h;
    }
  }

  // ---- geometry ----
  const geo = new THREE.PlaneGeometry(WORLD_SIZE, WORLD_SIZE, GRID, GRID);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = pos.getZ(i);
    pos.setY(i, sampleHeight(x, z));
  }
  geo.computeVertexNormals();

  // ---- composite painted ground texture ----
  const { tex, bump } = paintGround();
  const mat = new THREE.MeshStandardMaterial({
    map: tex, bumpMap: bump, bumpScale: 1.8,   // RTS top-down needs stronger relief than FPS grazing angles
    roughness: 0.96, metalness: 0.0,
  });
  injectDetail(mat);
  const mesh = new THREE.Mesh(geo, mat);
  mesh.receiveShadow = true;
  mesh.name = 'terrain';
  G.scene.add(mesh);
  G.shootables.push(mesh);

  G.groundHeight = sampleHeight;
  scatter();
  return mesh;
}

// bilinear height lookup
export function sampleHeight(x, z) {
  const N = GRID + 1;
  const fx = clamp((x / WORLD_SIZE + 0.5) * GRID, 0, GRID - 0.001);
  const fz = clamp((z / WORLD_SIZE + 0.5) * GRID, 0, GRID - 0.001);
  const ix = Math.floor(fx), iz = Math.floor(fz);
  const tx = fx - ix, tz = fz - iz;
  const h00 = heights[iz * N + ix], h10 = heights[iz * N + ix + 1];
  const h01 = heights[(iz + 1) * N + ix], h11 = heights[(iz + 1) * N + ix + 1];
  return (h00 * (1 - tx) + h10 * tx) * (1 - tz) + (h01 * (1 - tx) + h11 * tx) * tz;
}

// ------------------------------------------------------------------ painting
const TEX = 2048;
const w2t = (x) => (x / WORLD_SIZE + 0.5) * TEX;

function paintGround() {
  const rng = makeRng(2024);
  const c = document.createElement('canvas');
  c.width = c.height = TEX;
  const x = c.getContext('2d');

  // base sand with broad warm variation
  x.fillStyle = '#c7ad7c';
  x.fillRect(0, 0, TEX, TEX);
  for (let i = 0; i < 900; i++) {
    const px = rng() * TEX, py = rng() * TEX, r = 20 + rng() * 120;
    const g = x.createRadialGradient(px, py, 0, px, py, r);
    const warm = rng() < 0.5;
    const a = 0.05 + rng() * 0.09;
    g.addColorStop(0, warm ? `rgba(226,196,140,${a})` : `rgba(150,120,80,${a})`);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    x.fillStyle = g;
    x.beginPath(); x.arc(px, py, r, 0, 7); x.fill();
  }

  // large-scale warm/cool colour drift + slope/altitude rock underpaint.
  // Computed at 1024² (the old 256² upscale read as blurry mush at RTS zoom)
  // so mesa strata and cliff shading stay crisp; the low-frequency noise
  // terms are cached on coarse grids and bilinear-sampled.
  const N = GRID + 1;
  {
    const S = 1024;
    const DG = 160;
    const DW = DG + 1;
    const drift = new Float32Array(DW * DW);
    const drift2 = new Float32Array(DW * DW);
    const bandN = new Float32Array(DW * DW);
    for (let j = 0; j <= DG; j++) for (let i = 0; i <= DG; i++) {
      const nx = i / DG - 0.5, nz = j / DG - 0.5;
      drift[j * DW + i] = fbm(nx * 2.3 + 17, nz * 2.3 + 17);
      drift2[j * DW + i] = fbm(nx * 1.1 + 31, nz * 1.1 + 31);
      bandN[j * DW + i] = fbm(nx * 7 + 3, nz * 7 + 3);
    }
    const lerpG = (grid, u, v) => {
      const fx = u * DG, fz = v * DG;
      const ix = Math.min(fx | 0, DG - 1), iz = Math.min(fz | 0, DG - 1);
      const tx = fx - ix, tz = fz - iz;
      return (grid[iz * DW + ix] * (1 - tx) + grid[iz * DW + ix + 1] * tx) * (1 - tz)
           + (grid[(iz + 1) * DW + ix] * (1 - tx) + grid[(iz + 1) * DW + ix + 1] * tx) * tz;
    };
    const sstep = (a, b, v) => { const t = clamp((v - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
    const hash2 = (ix, iz) => {
      let n = ix * 374761393 + iz * 668265263;
      n = (n ^ (n >>> 13)) * 1274126177;
      return ((n ^ (n >>> 16)) >>> 0) / 4294967295;
    };
    const cell = WORLD_SIZE / S;
    const tc = document.createElement('canvas');
    tc.width = tc.height = S;
    const tcx = tc.getContext('2d');
    const img = tcx.createImageData(S, S);
    const d = img.data;
    // horizontal component of the sun (sky.js SUN_DIR) for baked aspect tint
    const sunX = -0.62, sunZ = -0.38;
    for (let iz = 0; iz < S; iz++) {
      for (let ix = 0; ix < S; ix++) {
        const u = ix / S, v = iz / S;
        const wx = (u - 0.5) * WORLD_SIZE, wz = (v - 0.5) * WORLD_SIZE;
        const h = sampleHeight(wx, wz);
        const sx = (sampleHeight(wx + cell * 2, wz) - sampleHeight(wx - cell * 2, wz)) / (cell * 4);
        const sz = (sampleHeight(wx, wz + cell * 2) - sampleHeight(wx, wz - cell * 2)) / (cell * 4);
        const slope = Math.hypot(sx, sz);
        // two-octave warm gold ↔ cool taupe drift so the overview isn't monotone
        const t = lerpG(drift, u, v) * 0.75 + lerpG(drift2, u, v) * 0.6;
        const warm = clamp(0.5 + t * 0.5, 0, 1);
        // baked aspect: sun-facing dune slopes glow warm, lee slopes cool off
        const lit = clamp((-sx * sunX - sz * sunZ) * 2.2, -1, 1);
        let r = 150 + warm * 74 + lit * 15;
        let g = 141 + warm * 42 + lit * 7;
        let b = 132 - warm * 22 - lit * 9;
        let a = 0.34;
        // rock exposure: slope-driven (mesa risers) with a milder altitude term,
        // so terrace benches keep a drape of sand between rocky steps
        let rock = clamp((slope - 0.36) / 0.4, 0, 1);
        rock = rock * rock * (3 - 2 * rock);
        rock = Math.max(rock, clamp((h - 17) / 14, 0, 1) * 0.6);
        if (rock > 0.01) {
          // crisp strata banding keyed to altitude → distinct mesa layers with
          // a dark parting seam at each layer base
          const s0 = Math.sin(h * 1.25 + lerpG(bandN, u, v) * 1.9);
          const band = sstep(-0.35, 0.45, s0);
          const seam = sstep(0.72, 0.98, -s0);
          const spec = (hash2(ix, iz) - 0.5) * 30 * rock;  // rough per-pixel speckle
          let rr = 74 + band * 98 - seam * 34 + lit * 12;
          let rg = 62 + band * 78 - seam * 27 + lit * 6;
          let rb = 52 + band * 52 - seam * 19 - lit * 4;
          const cliffAO = clamp((slope - 1.1) * 0.45, 0, 0.3);  // deep faces darken
          rr *= 1 - cliffAO; rg *= 1 - cliffAO; rb *= 1 - cliffAO;
          r = r * (1 - rock) + (rr + spec) * rock;
          g = g * (1 - rock) + (rg + spec * 0.85) * rock;
          b = b * (1 - rock) + (rb + spec * 0.7) * rock;
          a = a * (1 - rock) + Math.min(0.95, 0.82 + seam * 0.13) * rock;
        }
        const k4 = (iz * S + ix) * 4;
        d[k4] = r; d[k4 + 1] = g; d[k4 + 2] = b; d[k4 + 3] = a * 255;
      }
    }
    tcx.putImageData(img, 0, 0);
    x.imageSmoothingEnabled = true;
    x.drawImage(tc, 0, 0, TEX, TEX);
  }

  // crisp crag speckle on the steepest ground, over the soft underpaint
  for (let iz = 1; iz < GRID; iz++) {
    for (let ix = 1; ix < GRID; ix++) {
      const h = heights[iz * N + ix];
      const dx = heights[iz * N + ix + 1] - heights[iz * N + ix - 1];
      const dz = heights[(iz + 1) * N + ix] - heights[(iz - 1) * N + ix];
      const slope = Math.hypot(dx, dz) / (2 * WORLD_SIZE / GRID);
      if (slope > 0.55 || h > 20) {
        const px = ix / GRID * TEX + rng() * 6 - 3, py = iz / GRID * TEX + rng() * 6 - 3;
        const a = clamp((slope - 0.5) * 0.55 + (h > 20 ? 0.18 : 0), 0, 0.5);
        x.fillStyle = rng() < 0.3 ? `rgba(138,104,74,${a})` : `rgba(88,74,58,${a})`;
        x.beginPath(); x.arc(px, py, 2 + slope * 4 + rng() * 2, 0, 7); x.fill();
      }
    }
  }

  // hard-packed dirt around POIs
  for (const f of [LAYOUT.base, LAYOUT.village, LAYOUT.oilfield, LAYOUT.lz]) {
    const px = w2t(f.x), py = w2t(f.z), pr = f.r / WORLD_SIZE * TEX;
    const g = x.createRadialGradient(px, py, pr * 0.2, px, py, pr);
    g.addColorStop(0, 'rgba(186,156,112,0.45)');
    g.addColorStop(1, 'rgba(186,156,112,0)');
    x.fillStyle = g;
    x.beginPath(); x.arc(px, py, pr, 0, 7); x.fill();
  }
  // oasis: darker fertile ring
  {
    const o = LAYOUT.oasis;
    const px = w2t(o.x), py = w2t(o.z), pr = o.r / WORLD_SIZE * TEX;
    const g = x.createRadialGradient(px, py, 0, px, py, pr);
    g.addColorStop(0, 'rgba(110,110,60,0.6)');
    g.addColorStop(0.6, 'rgba(130,118,70,0.35)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    x.fillStyle = g;
    x.beginPath(); x.arc(px, py, pr, 0, 7); x.fill();
  }

  // roads — dirt track with edge darkening and wheel ruts
  for (const path of [LAYOUT.road, LAYOUT.road2]) {
    const curve = roadCurve(path);
    const n = Math.ceil(curve.getLength() / 2);
    const pts = [];
    for (let i = 0; i <= n; i++) {
      const p = curve.getPoint(i / n);
      pts.push([w2t(p.x), w2t(p.z)]);
    }
    const stroke = (width, style) => {
      x.strokeStyle = style; x.lineWidth = width;
      x.lineJoin = x.lineCap = 'round';
      x.beginPath();
      pts.forEach(([px, py], i) => i === 0 ? x.moveTo(px, py) : x.lineTo(px, py));
      x.stroke();
    };
    const W = 8 / WORLD_SIZE * TEX;
    stroke(W * 1.8, 'rgba(158,128,88,0.28)');   // wide dusty verge
    stroke(W * 1.12, 'rgba(122,97,64,0.5)');    // crisp darker edge line
    stroke(W, 'rgba(205,178,136,0.95)');        // packed dirt, lighter than sand
    stroke(W * 0.6, 'rgba(220,197,155,0.85)');  // sun-bleached crown
    // crisp tire ruts
    for (const off of [-W * 0.27, W * 0.27]) {
      x.strokeStyle = 'rgba(126,100,66,0.8)'; x.lineWidth = W * 0.10;
      x.beginPath();
      for (let i = 0; i < pts.length; i++) {
        const [px, py] = pts[i];
        const [nx, ny] = pts[Math.min(i + 1, pts.length - 1)];
        const dx = ny - py, dy = -(nx - px);
        const l = Math.hypot(dx, dy) || 1;
        const ox = dx / l * off, oy = dy / l * off;
        i === 0 ? x.moveTo(px + ox, py + oy) : x.lineTo(px + ox, py + oy);
      }
      x.stroke();
    }
  }

  // base plateaus: packed-dirt fill, tire-wear arcs, oil stains, scorch —
  // the crisp grid scoring is added per-pixel in injectDetail()
  for (const b of [LAYOUT.base, LAYOUT.lz]) {
    const bx = w2t(b.x), by = w2t(b.z), br = b.r / WORLD_SIZE * TEX;
    // hard-packed apron disc, slightly lighter + greyer than open sand
    const g0 = x.createRadialGradient(bx, by, 0, bx, by, br);
    g0.addColorStop(0, 'rgba(178,155,120,0.55)');
    g0.addColorStop(0.72, 'rgba(172,148,113,0.42)');
    g0.addColorStop(1, 'rgba(172,148,113,0)');
    x.fillStyle = g0;
    x.beginPath(); x.arc(bx, by, br, 0, 7); x.fill();
    // tire-wear ring arcs (vehicles circling the yard)
    for (let i = 0; i < 22; i++) {
      const rr = br * (0.15 + rng() * 0.72);
      const a0 = rng() * Math.PI * 2, span = 0.5 + rng() * 2.4;
      x.strokeStyle = `rgba(104,84,56,${0.12 + rng() * 0.16})`;
      x.lineWidth = (0.35 + rng() * 0.8) / WORLD_SIZE * TEX;
      x.beginPath(); x.arc(bx, by, rr, a0, a0 + span); x.stroke();
    }
    // straight wear lanes crossing the yard
    for (let i = 0; i < 8; i++) {
      const a0 = rng() * Math.PI * 2, a1 = a0 + Math.PI * (0.6 + rng() * 0.8);
      const r0 = br * (0.3 + rng() * 0.6), r1 = br * (0.3 + rng() * 0.6);
      x.strokeStyle = `rgba(190,168,132,${0.14 + rng() * 0.16})`;
      x.lineWidth = (1.2 + rng() * 1.6) / WORLD_SIZE * TEX;
      x.beginPath();
      x.moveTo(bx + Math.cos(a0) * r0, by + Math.sin(a0) * r0);
      x.lineTo(bx + Math.cos(a1) * r1, by + Math.sin(a1) * r1);
      x.stroke();
    }
    // oil stains + scorch
    for (let i = 0; i < 16; i++) {
      const a = rng() * Math.PI * 2, dd = rng() * b.r * 0.8;
      const px = w2t(b.x + Math.cos(a) * dd), py = w2t(b.z + Math.sin(a) * dd);
      const r = (1.2 + rng() * 5.5) / WORLD_SIZE * TEX;
      const g = x.createRadialGradient(px, py, 0, px, py, r);
      const oil = rng() < 0.4;
      g.addColorStop(0, oil ? `rgba(28,24,20,${0.3 + rng() * 0.3})`
                            : `rgba(46,36,26,${0.22 + rng() * 0.28})`);
      g.addColorStop(1, 'rgba(0,0,0,0)');
      x.fillStyle = g;
      x.beginPath(); x.arc(px, py, r, 0, 7); x.fill();
    }
  }

  // fine grain
  for (let i = 0; i < 26000; i++) {
    const v = rng() < 0.5;
    x.fillStyle = v ? `rgba(255,244,220,${0.04 * rng()})` : `rgba(60,48,30,${0.05 * rng()})`;
    x.fillRect(rng() * TEX, rng() * TEX, 1.5, 1.5);
  }

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 16;   // ~50° camera pitch: high aniso keeps midground sharp
  tex.needsUpdate = true;

  // bump: grayscale copy + world-scale dune ripples + noise. 2048 so the
  // painted mesa strata contribute relief at RTS zoom.
  const BS = 2048;
  const bc = document.createElement('canvas');
  bc.width = bc.height = BS;
  const bx = bc.getContext('2d');
  bx.drawImage(c, 0, 0, BS, BS);
  bx.globalCompositeOperation = 'saturation';
  bx.fillStyle = '#888'; bx.fillRect(0, 0, BS, BS);
  bx.globalCompositeOperation = 'source-over';
  // wind ripples baked at world scale (~3.5m wavelength, one wind direction),
  // drawn in a rotated frame so crests run diagonal to the grid
  bx.save();
  bx.translate(BS / 2, BS / 2);
  bx.rotate(-0.42);
  const RR = BS * 0.75;
  for (let i = 0; i < 260; i++) {
    const y0 = (rng() * 2 - 1) * RR;
    const amp = 4 + rng() * 9, ph = rng() * 9, wl = 0.010 + rng() * 0.012;
    for (let pass = 0; pass < 2; pass++) {
      bx.globalAlpha = pass ? 0.075 : 0.09;
      bx.strokeStyle = pass ? '#c9c9c9' : '#4c4c4c';
      bx.lineWidth = 2.2 + rng() * 2.4;
      bx.beginPath();
      for (let px = -RR; px <= RR; px += 24) {
        const py = y0 + Math.sin(px * wl + ph) * amp + (pass ? 2.4 : 0);
        px === -RR ? bx.moveTo(px, py) : bx.lineTo(px, py);
      }
      bx.stroke();
    }
  }
  bx.restore();
  bx.globalAlpha = 1;
  for (let i = 0; i < 30000; i++) {
    const v = rng() < 0.5;
    bx.fillStyle = v ? `rgba(255,255,255,${0.10 * rng()})` : `rgba(0,0,0,${0.12 * rng()})`;
    bx.fillRect(rng() * BS, rng() * BS, 2, 2);
  }
  const bump = new THREE.CanvasTexture(bc);
  bump.anisotropy = 8;

  return { tex, bump };
}

// multiply tiled sand detail into the albedo. Three octaves cover the RTS
// zoom band (camera 34-170m off the ground at ~50° pitch): a close grain for
// max zoom-in, a mid dune-grain octave that carries the default zoom, and a
// broad mottle octave so the far overview never flattens to felt. The base
// discs additionally get a procedural packed-concrete apron — per-slab tone,
// grid scoring, tire-wear mottle — which stays crisp at any zoom, unlike the
// 2048 painted map (~3.4px/m).
function injectDetail(mat) {
  const det = sandDetail();
  // measure the detail map's mean linear luminance so the octave modulation
  // is centred (no net brighten/darken of the painted ground)
  let dMean = 0.62;
  {
    const dImg = det.image;
    const dcx = dImg.getContext('2d');
    const dd = dcx.getImageData(0, 0, dImg.width, dImg.height).data;
    let s = 0;
    for (let i = 0; i < dd.length; i += 16) {   // every 4th pixel is plenty
      const l = (dd[i] * 0.2126 + dd[i + 1] * 0.7152 + dd[i + 2] * 0.0722) / 255;
      s += Math.pow(l, 2.2);                    // canvas is sRGB; shader samples linear
    }
    dMean = s / (dd.length / 16);
  }
  const b0 = LAYOUT.base, b1 = LAYOUT.lz;
  const f1 = (v) => v.toFixed(1), f4 = (v) => v.toFixed(4);
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.detailMap = { value: det };
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <map_pars_fragment>',
        `#include <map_pars_fragment>
         uniform sampler2D detailMap;
         float slabHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }`)
      .replace('#include <map_fragment>',
        `#include <map_fragment>
         {
           mat2 dRot = mat2(0.7986, -0.6018, 0.6018, 0.7986);
           float dDist = length(vViewPosition);
           // plane UVs map linearly onto the world: u = x/W+0.5, v = 0.5-z/W
           vec2 wxz = vec2((vMapUv.x - 0.5) * ${f1(WORLD_SIZE)},
                           (0.5 - vMapUv.y) * ${f1(WORLD_SIZE)});
           // low-frequency region mask so octave tiling never lines up
           float dMask = texture2D(detailMap, dRot * vMapUv * 4.7 + vec2(0.13, 0.57)).g;

           // ---- worn concrete/packed-dirt aprons on the base plateaus ----
           float apron = max(
             1.0 - smoothstep(${f1(b0.r * 0.60)}, ${f1(b0.r * 0.95)},
                              distance(wxz, vec2(${f1(b0.x)}, ${f1(b0.z)}))),
             1.0 - smoothstep(${f1(b1.r * 0.60)}, ${f1(b1.r * 0.95)},
                              distance(wxz, vec2(${f1(b1.x)}, ${f1(b1.z)}))));
           if (apron > 0.004) {
             vec2 gp = wxz / 7.5;                     // 7.5m slab grid
             vec2 gf = abs(fract(gp) - 0.5);
             float joint = smoothstep(0.415, 0.475, max(gf.x, gf.y));
             float panel = slabHash(floor(gp));
             float wear  = texture2D(detailMap, dRot * vMapUv * 23.0 + vec2(0.41, 0.87)).g;
             float wear2 = texture2D(detailMap, vMapUv * 57.0 + vec2(0.77, 0.31)).g;
             vec3 ap = mix(diffuseColor.rgb, vec3(dot(diffuseColor.rgb, vec3(0.3333))), 0.30);
             ap *= 1.05;                              // sun-bleached concrete lift
             ap *= 0.94 + panel * 0.12;               // per-slab tone variation
             ap *= 0.90 + wear * 0.22;                // broad tire-wear mottle
             ap *= 0.95 + wear2 * 0.10;               // fine chip noise
             float gridFade = 1.0 - smoothstep(170.0, 330.0, dDist);
             ap *= 1.0 - joint * 0.22 * gridFade;     // scored expansion joints
             diffuseColor.rgb = mix(diffuseColor.rgb, ap, apron * 0.8);
           }

           // ---- distance-banded detail octaves ----
           vec3 c1 = texture2D(detailMap, vMapUv * 95.0).rgb;
           vec3 c2 = texture2D(detailMap, dRot * vMapUv * 61.0 + vec2(0.37, 0.71)).rgb;
           float lC = dot(mix(c1, c2, clamp((dMask - 0.62) * 8.0 + 0.5, 0.0, 1.0)), vec3(0.3333));
           float m1 = dot(texture2D(detailMap, dRot * vMapUv * 33.0 + vec2(0.19, 0.43)).rgb, vec3(0.3333));
           float m2 = dot(texture2D(detailMap, vMapUv * 20.7 + vec2(0.53, 0.11)).rgb, vec3(0.3333));
           float lM = mix(m1, m2, clamp((dMask - 0.5) * 6.0 + 0.5, 0.0, 1.0));
           float lF = dot(texture2D(detailMap, dRot * vMapUv * 10.3 + vec2(0.71, 0.29)).rgb, vec3(0.3333));
           float fC = 1.0 - smoothstep(45.0, 130.0, dDist);   // close grain
           float fM = 1.0 - smoothstep(40.0, 260.0, dDist);   // main RTS band
           float fF = 1.0 - smoothstep(90.0, 520.0, dDist);   // overview mottle
           float lum = 1.0;
           lum *= 1.0 + (lC - ${f4(dMean)}) * 1.05 * fC;
           lum *= 1.0 + (lM - ${f4(dMean)}) * 1.45 * max(fM, 0.12);
           lum *= 1.0 + (lF - ${f4(dMean)}) * 0.90 * fF;
           // gentler grain on the aprons — packed concrete, not loose dunes
           diffuseColor.rgb *= mix(lum, 1.0 + (lum - 1.0) * 0.55, apron);
         }`);
  };
}

// ------------------------------------------------------------------ scatter
function scatter() {
  const rng = makeRng(31415);
  scatterRocks(rng);
  scatterShrubs(rng);
  scatterStones(rng);
  scatterLandmarks(makeRng(9273));
}

// lowest ground within radius r of (x,z) — settle scatter so nothing floats
// on the downhill side at the RTS pitch
function groundMin(x, z, r) {
  let m = sampleHeight(x, z);
  m = Math.min(m, sampleHeight(x + r, z), sampleHeight(x - r, z),
                  sampleHeight(x, z + r), sampleHeight(x, z - r));
  return m;
}

function nearRoad(x, z, limit = 9) {
  for (const p of roadSamples) if (Math.hypot(x - p.x, z - p.z) < limit) return true;
  return false;
}
function nearPOI(x, z, extra = 0) {
  for (const f of [LAYOUT.base, LAYOUT.village, LAYOUT.oasis, LAYOUT.oilfield, LAYOUT.lz]) {
    if (Math.hypot(x - f.x, z - f.z) < f.r + extra) return true;
  }
  return false;
}

function scatterRocks(rng) {
  const rockMat = new THREE.MeshStandardMaterial({
    color: 0x8d7f6a, roughness: 0.95, flatShading: true,
  });
  const geos = [];
  for (let v = 0; v < 3; v++) {
    const g = new THREE.DodecahedronGeometry(1, 1);
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const s = 1 + (rng() - 0.5) * 0.55;
      p.setXYZ(i, p.getX(i) * s, p.getY(i) * s * 0.62, p.getZ(i) * s);
    }
    g.computeVertexNormals();
    geos.push(g);
  }
  const count = 130;
  const meshes = geos.map(g => {
    const m = new THREE.InstancedMesh(g, rockMat, count);
    m.castShadow = m.receiveShadow = true;
    m.count = 0;
    G.scene.add(m);
    G.shootables.push(m);
    return m;
  });
  const M = new THREE.Matrix4(), Q = new THREE.Quaternion(), S = new THREE.Vector3();
  for (let i = 0; i < count * 3; i++) {
    const x = (rng() - 0.5) * WORLD_SIZE * 0.94;
    const z = (rng() - 0.5) * WORLD_SIZE * 0.94;
    if (nearRoad(x, z) || nearPOI(x, z, -6)) continue;
    const m = meshes[Math.floor(rng() * meshes.length)];
    if (m.count >= count) continue;
    const s = 0.5 + rng() * rng() * 3.4;
    const y = groundMin(x, z, s * 0.6) + s * 0.06;
    Q.setFromEuler(new THREE.Euler(0, rng() * 7, (rng() - 0.5) * 0.2));
    S.set(s * (0.8 + rng() * 0.5), s, s * (0.8 + rng() * 0.5));
    M.compose(new THREE.Vector3(x, y, z), Q, S);
    m.setMatrixAt(m.count++, M);
  }
  meshes.forEach(m => m.instanceMatrix.needsUpdate = true);
}

function makeShrubTexture(dry) {
  const c = document.createElement('canvas');
  c.width = 128; c.height = 128;
  const x = c.getContext('2d');
  const rng = makeRng(dry ? 611 : 612);
  const cols = dry ? ['#9a8a52', '#8a7a45', '#ab9b62'] : ['#5f6b38', '#6d7a42', '#4d582c'];
  for (let i = 0; i < 60; i++) {
    x.strokeStyle = cols[i % 3];
    x.lineWidth = 1.5 + rng();
    x.beginPath();
    const bx = 64 + (rng() - 0.5) * 26;
    x.moveTo(bx, 128);
    const mx = bx + (rng() - 0.5) * 60, my = 70 - rng() * 25;
    const ex = bx + (rng() - 0.5) * 110, ey = 118 - rng() * 100;
    x.quadraticCurveTo(mx, my, ex, ey);
    x.stroke();
    if (rng() < 0.5) {
      x.fillStyle = cols[(i + 1) % 3];
      x.beginPath(); x.arc(ex, ey, 2.5 + rng() * 3, 0, 7); x.fill();
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function scatterShrubs(rng) {
  for (const dry of [true, false]) {
    const tex = makeShrubTexture(dry);
    const mat = new THREE.MeshStandardMaterial({
      map: tex, alphaTest: 0.35, side: THREE.DoubleSide,
      roughness: 1, color: 0xffffff,
    });
    const g1 = new THREE.PlaneGeometry(1, 1);
    const g2 = g1.clone().rotateY(Math.PI / 2);
    const merged = mergeGeos([g1, g2]);
    merged.translate(0, 0.5, 0);
    const count = dry ? 420 : 160;
    const mesh = new THREE.InstancedMesh(merged, mat, count);
    mesh.castShadow = true;
    mesh.count = 0;
    G.scene.add(mesh);
    const M = new THREE.Matrix4(), Q = new THREE.Quaternion(), S = new THREE.Vector3();
    for (let i = 0; i < count * 3 && mesh.count < count; i++) {
      let x, z;
      if (!dry) { // green shrubs cluster at the oasis
        const a = rng() * Math.PI * 2, d = rng() * LAYOUT.oasis.r * 1.4;
        x = LAYOUT.oasis.x + Math.cos(a) * d;
        z = LAYOUT.oasis.z + Math.sin(a) * d;
      } else {
        x = (rng() - 0.5) * WORLD_SIZE * 0.92;
        z = (rng() - 0.5) * WORLD_SIZE * 0.92;
        if (nearRoad(x, z, 6) || nearPOI(x, z, -10)) continue;
      }
      const s = 0.7 + rng() * 1.6;
      Q.setFromEuler(new THREE.Euler(0, rng() * 7, 0));
      S.set(s * 1.3, s, s * 1.3);
      M.compose(new THREE.Vector3(x, groundMin(x, z, s * 0.55) - s * 0.04, z), Q, S);
      mesh.setMatrixAt(mesh.count++, M);
    }
    mesh.instanceMatrix.needsUpdate = true;
  }
}

function scatterStones(rng) {
  const g = new THREE.IcosahedronGeometry(0.16, 0);
  const mat = new THREE.MeshStandardMaterial({ color: 0x9a8c74, roughness: 1 });
  const count = 500;
  const mesh = new THREE.InstancedMesh(g, mat, count);
  mesh.count = 0;
  mesh.receiveShadow = true;
  G.scene.add(mesh);
  const M = new THREE.Matrix4(), Q = new THREE.Quaternion(), S = new THREE.Vector3();
  for (let i = 0; i < count * 2 && mesh.count < count; i++) {
    const x = (rng() - 0.5) * WORLD_SIZE * 0.9;
    const z = (rng() - 0.5) * WORLD_SIZE * 0.9;
    if (nearPOI(x, z, -20)) continue;
    const s = 0.5 + rng() * 2;
    Q.setFromEuler(new THREE.Euler(rng() * 7, rng() * 7, 0));
    S.set(s, s * 0.7, s);
    M.compose(new THREE.Vector3(x, groundMin(x, z, s * 0.16) + 0.01, z), Q, S);
    mesh.setMatrixAt(mesh.count++, M);
  }
  mesh.instanceMatrix.needsUpdate = true;
}

// ------------------------------------------------------- landmark formations
// A few large terraced buttes along the valley so the RTS overview has
// composition anchors (GZH maps always frame lanes with big rock features).
function makeStrataTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const x = c.getContext('2d');
  const rng = makeRng(777);
  const bands = 9, bh = 128 / bands;
  for (let i = 0; i < bands; i++) {
    // palette matches the mesa underpaint strata
    const t = 0.5 + 0.5 * Math.sin(i * 2.1 + 0.8);
    const r = 96 + t * 76 + (rng() - 0.5) * 18;
    const g = 80 + t * 58 + (rng() - 0.5) * 14;
    const b = 66 + t * 38 + (rng() - 0.5) * 10;
    const y0 = i * bh;
    x.fillStyle = `rgb(${r | 0},${g | 0},${b | 0})`;
    x.fillRect(0, y0, 128, bh + 1);
    x.fillStyle = 'rgba(38,28,18,0.55)';           // parting seam
    x.fillRect(0, y0, 128, 2);
    x.fillStyle = 'rgba(255,236,200,0.20)';        // lit lip below the seam
    x.fillRect(0, y0 + 2, 128, 1.5);
  }
  for (let i = 0; i < 300; i++) {                  // vertical weather streaks
    x.fillStyle = rng() < 0.5 ? `rgba(50,38,24,${0.05 + rng() * 0.10})`
                              : `rgba(232,206,160,${0.04 + rng() * 0.08})`;
    x.fillRect(rng() * 128, rng() * 128, 1 + rng() * 2.5, 2 + rng() * 9);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

// terraced butte: cylinder with per-ring scale + angular jitter, flat top
function butteGeo(rng, rad, h) {
  const seg = 10, rings = 5;
  const g = new THREE.CylinderGeometry(rad * (0.52 + rng() * 0.2), rad, h, seg, rings);
  const sideCount = (seg + 1) * (rings + 1);
  const rs = [];
  for (let i = 0; i <= rings; i++) rs.push(0.88 + rng() * 0.2);
  const p1 = 0.6 + rng() * 5, p2 = rng() * 6;
  const pos = g.attributes.position, uv = g.attributes.uv;
  for (let i = 0; i < pos.count; i++) {
    const px = pos.getX(i), py = pos.getY(i), pz = pos.getZ(i);
    const yr = clamp((py + h / 2) / h, 0, 1);
    const a = Math.atan2(pz, px);
    // angular lobes + per-ring randomness → craggy silhouette, still stacked
    const j = (1 + 0.14 * Math.sin(a * 3 + p1) + 0.09 * Math.sin(a * 7 + p2))
            * rs[Math.round(yr * rings)];
    pos.setXYZ(i, px * j, py, pz * j);
    // strata bands ~1 per metre of height
    if (i < sideCount) uv.setY(i, yr * h / 8);
    else uv.setXY(i, 0.5, 0.38);   // caps sample a light band interior (flat top)
  }
  g.computeVertexNormals();
  return g;
}

function scatterLandmarks(rng) {
  const strata = makeStrataTexture();
  const mat = new THREE.MeshStandardMaterial({
    map: strata, roughness: 0.97, metalness: 0, flatShading: true,
  });
  // hand-placed along the valley + open quadrants; away from roads/POIs/docks
  const spots = [
    { x: -18, z: 68, s: 1.15 },    // mid-valley south of the main road
    { x: 62, z: 112, s: 0.95 },    // between oasis and oil field
    { x: -108, z: -92, s: 1.35 },  // NW quadrant
    { x: 150, z: 8, s: 1.05 },     // east of the oil field
    { x: -30, z: -152, s: 0.95 },  // north, flanking the contested dock
    { x: 105, z: 158, s: 1.25 },   // SE open sand
    { x: -158, z: -38, s: 0.9 },   // west approach
  ];
  const geos = [];
  const tmpM = new THREE.Matrix4(), tmpE = new THREE.Euler();
  for (const sp of spots) {
    if (nearRoad(sp.x, sp.z, 20) || nearPOI(sp.x, sp.z, 10)) continue;
    let bad = false;
    for (const dk of LAYOUT.docks) {
      if (Math.hypot(sp.x - dk.x, sp.z - dk.z) < 26) bad = true;
    }
    if (bad) continue;
    const n = 1 + ((rng() * 2.3) | 0);   // 1 main butte + 0-2 companions
    for (let k = 0; k < n; k++) {
      const main = k === 0;
      const rad = (main ? 5.5 + rng() * 2.5 : 2.5 + rng() * 2) * sp.s;
      const h = (main ? 9 + rng() * 5 : 4 + rng() * 3.5) * sp.s;
      const a = rng() * Math.PI * 2, d = main ? 0 : rad + 4 + rng() * 5;
      const bx = sp.x + Math.cos(a) * d, bz = sp.z + Math.sin(a) * d;
      const g = butteGeo(rng, rad, h);
      tmpE.set((rng() - 0.5) * 0.06, rng() * 7, (rng() - 0.5) * 0.06);
      tmpM.makeRotationFromEuler(tmpE);
      tmpM.setPosition(bx, groundMin(bx, bz, rad * 0.7) + h / 2 - h * 0.08, bz);
      g.applyMatrix4(tmpM);
      geos.push(g);
      // talus boulders around the foot
      const nt = 2 + ((rng() * 3) | 0);
      for (let t = 0; t < nt; t++) {
        const ta = rng() * Math.PI * 2, td = rad * (1.1 + rng() * 0.7);
        const tx = bx + Math.cos(ta) * td, tz = bz + Math.sin(ta) * td;
        if (nearRoad(tx, tz, 12)) continue;
        const ts = (0.8 + rng() * 1.4) * sp.s;
        const tg = new THREE.DodecahedronGeometry(ts, 0);
        // polyhedra are non-indexed; mergeGeos only carries indexed triangles
        tg.setIndex([...Array(tg.attributes.position.count).keys()]);
        const tuv = tg.attributes.uv;
        for (let i = 0; i < tuv.count; i++) {
          tuv.setXY(i, tuv.getX(i) * 0.5, 0.33 + tuv.getY(i) * 0.06);  // one band
        }
        tmpE.set(rng() * 7, rng() * 7, 0);
        tmpM.makeRotationFromEuler(tmpE);
        tmpM.setPosition(tx, groundMin(tx, tz, ts * 0.5) + ts * 0.25, tz);
        tg.applyMatrix4(tmpM);
        geos.push(tg);
      }
    }
  }
  if (!geos.length) return;
  const mesh = new THREE.Mesh(mergeGeos(geos), mat);
  mesh.castShadow = mesh.receiveShadow = true;
  mesh.name = 'landmarks';
  G.scene.add(mesh);
  G.shootables.push(mesh);
}

// minimal geometry merger (positions/normals/uvs)
export function mergeGeos(geos) {
  let vc = 0, ic = 0;
  for (const g of geos) { vc += g.attributes.position.count; ic += g.index ? g.index.count : 0; }
  const pos = new Float32Array(vc * 3), nor = new Float32Array(vc * 3), uv = new Float32Array(vc * 2);
  const idx = new Uint32Array(ic);
  let vo = 0, io = 0;
  for (const g of geos) {
    pos.set(g.attributes.position.array, vo * 3);
    nor.set(g.attributes.normal.array, vo * 3);
    if (g.attributes.uv) uv.set(g.attributes.uv.array, vo * 2);
    if (g.index) for (let i = 0; i < g.index.count; i++) idx[io++] = g.index.array[i] + vo;
    vo += g.attributes.position.count;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  out.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  out.setIndex(new THREE.BufferAttribute(idx, 1));
  return out;
}
