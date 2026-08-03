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
  h += wall * (30 + fbm(nx * 6, nz * 6) * 14);
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
    map: tex, bumpMap: bump, bumpScale: 0.9,
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

  // slope-derived rock shading
  const N = GRID + 1;
  for (let iz = 1; iz < GRID; iz++) {
    for (let ix = 1; ix < GRID; ix++) {
      const h = heights[iz * N + ix];
      const dx = heights[iz * N + ix + 1] - heights[iz * N + ix - 1];
      const dz = heights[(iz + 1) * N + ix] - heights[(iz - 1) * N + ix];
      const slope = Math.hypot(dx, dz) / (2 * WORLD_SIZE / GRID);
      if (slope > 0.35 || h > 18) {
        const px = ix / GRID * TEX, py = iz / GRID * TEX;
        const a = clamp((slope - 0.3) * 0.9 + (h > 18 ? 0.35 : 0), 0, 0.75);
        x.fillStyle = `rgba(112,96,76,${a})`;
        x.beginPath(); x.arc(px, py, 5 + slope * 6, 0, 7); x.fill();
        if (slope > 0.7) {
          x.fillStyle = `rgba(84,72,58,${a * 0.8})`;
          x.beginPath(); x.arc(px + rng() * 4 - 2, py + rng() * 4 - 2, 3, 0, 7); x.fill();
        }
      }
    }
  }

  // hard-packed dirt around POIs
  for (const f of [LAYOUT.base, LAYOUT.village, LAYOUT.oilfield, LAYOUT.lz]) {
    const px = w2t(f.x), py = w2t(f.z), pr = f.r / WORLD_SIZE * TEX;
    const g = x.createRadialGradient(px, py, pr * 0.2, px, py, pr);
    g.addColorStop(0, 'rgba(168,138,96,0.55)');
    g.addColorStop(1, 'rgba(168,138,96,0)');
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
    stroke(W * 1.5, 'rgba(150,122,84,0.5)');   // soft shoulder
    stroke(W, 'rgba(172,144,102,0.95)');        // packed track
    stroke(W * 0.8, 'rgba(186,158,116,0.9)');
    // ruts
    for (const off of [-W * 0.24, W * 0.24]) {
      x.strokeStyle = 'rgba(120,96,64,0.55)'; x.lineWidth = W * 0.12;
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

  // scorch + tire marks inside the base
  const b = LAYOUT.base;
  for (let i = 0; i < 14; i++) {
    const a = rng() * Math.PI * 2, d = rng() * b.r * 0.8;
    const px = w2t(b.x + Math.cos(a) * d), py = w2t(b.z + Math.sin(a) * d);
    const r = (2 + rng() * 6) / WORLD_SIZE * TEX;
    const g = x.createRadialGradient(px, py, 0, px, py, r);
    g.addColorStop(0, `rgba(40,32,24,${0.25 + rng() * 0.3})`);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    x.fillStyle = g;
    x.beginPath(); x.arc(px, py, r, 0, 7); x.fill();
  }

  // fine grain
  for (let i = 0; i < 26000; i++) {
    const v = rng() < 0.5;
    x.fillStyle = v ? `rgba(255,244,220,${0.04 * rng()})` : `rgba(60,48,30,${0.05 * rng()})`;
    x.fillRect(rng() * TEX, rng() * TEX, 1.5, 1.5);
  }

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  tex.needsUpdate = true;

  // bump: grayscale copy + noise
  const bc = document.createElement('canvas');
  bc.width = bc.height = 1024;
  const bx = bc.getContext('2d');
  bx.drawImage(c, 0, 0, 1024, 1024);
  bx.globalCompositeOperation = 'saturation';
  bx.fillStyle = '#888'; bx.fillRect(0, 0, 1024, 1024);
  bx.globalCompositeOperation = 'source-over';
  for (let i = 0; i < 16000; i++) {
    const v = rng() < 0.5;
    bx.fillStyle = v ? `rgba(255,255,255,${0.10 * rng()})` : `rgba(0,0,0,${0.12 * rng()})`;
    bx.fillRect(rng() * 1024, rng() * 1024, 2, 2);
  }
  const bump = new THREE.CanvasTexture(bc);
  bump.anisotropy = 4;

  return { tex, bump };
}

// multiply tiled sand detail into the albedo so close-up ground isn't blurry
function injectDetail(mat) {
  const det = sandDetail();
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.detailMap = { value: det };
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <map_pars_fragment>',
        '#include <map_pars_fragment>\nuniform sampler2D detailMap;')
      .replace('#include <map_fragment>',
        `#include <map_fragment>
         vec3 det = texture2D(detailMap, vMapUv * 90.0).rgb;
         float dl = dot(det, vec3(0.333));
         diffuseColor.rgb *= mix(vec3(1.0), det / max(dl, 0.001) * (0.55 + dl * 0.65), 0.55);`);
  };
}

// ------------------------------------------------------------------ scatter
function scatter() {
  const rng = makeRng(31415);
  scatterRocks(rng);
  scatterShrubs(rng);
  scatterStones(rng);
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
    const y = sampleHeight(x, z) + s * 0.15;
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
      M.compose(new THREE.Vector3(x, sampleHeight(x, z), z), Q, S);
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
    M.compose(new THREE.Vector3(x, sampleHeight(x, z) + 0.03, z), Q, S);
    mesh.setMatrixAt(mesh.count++, M);
  }
  mesh.instanceMatrix.needsUpdate = true;
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
