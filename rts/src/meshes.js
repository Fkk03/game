// meshes.js — visual builders for every unit/building def. OWNED BY: meshes
// agent — GZH-quality models built from fps-style primitives (adapted from
// ../fps/src/buildings.js, vehicles.js, soldiers.js art kit).
// CONTRACT (do not change signatures):
//   buildMesh(def, owner) -> THREE.Group   — model faces -Z, origin at ground.
//     Must set castShadow/receiveShadow on solid parts. Player color accents
//     read from G.players[owner]?.color (fallback grey for neutral).
//     Turreted units: group.userData.turret (Group) and .muzzle (Vector3,
//     local to turret) if present are used by combat.js for aiming/tracers.
//     Harvesters: userData.cargo (Object3D) toggled visible when carrying.
//     Buildings under construction are scaled by entities.js.
//     Extra anim hooks (sim-side optional): userData.rotor / .tailRotor
//     (helicopter blades — spin rotation.y), userData.spin (radar dishes,
//     derrick flywheel, particle iris — spin rotation.y slowly).
//   buildRubble(def) -> THREE.Group|null    — destroyed-building rubble.
//   buildScaffold(def) -> THREE.Group|null  — optional construction scaffold.
import * as THREE from 'three';
import { G, makeRng } from './core.js';
import { metalPanels, adobe, corrugated, camoCanvas, concrete, fabric, awning } from './textures.js';

export function playerColor(owner) {
  return G.players[owner]?.color ?? 0x8a8578;
}

const rng = makeRng(60301);

// ---------------------------------------------------------------- local canvas textures
const LT = {};
function toneC(hex, f, warm = 0, a = 1) {
  const n = parseInt(hex.slice(1), 16);
  const cl = (v) => Math.max(0, Math.min(255, v)) | 0;
  return `rgba(${cl(((n >> 16) & 255) * f + warm * 24)},${cl(((n >> 8) & 255) * f + warm * 10)},${cl((n & 255) * f - warm * 18)},${a})`;
}
function ctex(c, repeat = 1) {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeat, repeat);
  t.anisotropy = 4;
  return t;
}

// tank track links: horizontal cleat stripes
function trackTex() {
  if (LT.track) return LT.track;
  const c = document.createElement('canvas');
  c.width = 64; c.height = 32;
  const x = c.getContext('2d');
  x.fillStyle = '#191813'; x.fillRect(0, 0, 64, 32);
  for (let i = 0; i < 8; i++) {
    x.fillStyle = '#2e2b23'; x.fillRect(i * 8, 1, 5, 30);
    x.fillStyle = 'rgba(255,255,255,0.10)'; x.fillRect(i * 8, 1, 5, 3);
    x.fillStyle = '#0c0b09'; x.fillRect(i * 8 + 5, 0, 3, 32);
  }
  LT.track = ctex(c, 1);
  LT.track.repeat.set(5, 1);
  return LT.track;
}

// painted scorpion-claw emblem (transparent decal)
function clawTex() {
  if (LT.claw) return LT.claw;
  const c = document.createElement('canvas');
  c.width = 128; c.height = 64;
  const x = c.getContext('2d');
  x.clearRect(0, 0, 128, 64);
  x.strokeStyle = '#96261a';
  x.lineWidth = 14; x.lineCap = 'round';
  x.beginPath(); x.arc(56, 32, 22, Math.PI * 0.7, Math.PI * 2.1); x.stroke();
  x.lineWidth = 11;
  x.beginPath(); x.moveTo(74, 16); x.lineTo(96, 8); x.stroke();
  x.beginPath(); x.moveTo(76, 46); x.lineTo(100, 54); x.stroke();
  x.lineWidth = 9;
  x.beginPath(); x.moveTo(36, 48); x.lineTo(18, 56); x.lineTo(8, 40); x.stroke();
  x.globalCompositeOperation = 'destination-out';
  const r = makeRng(4242);
  for (let i = 0; i < 26; i++) x.fillRect(r() * 128, r() * 64, 1 + r() * 3, 1 + r() * 2);
  x.globalCompositeOperation = 'source-over';
  LT.claw = new THREE.CanvasTexture(c);
  LT.claw.colorSpace = THREE.SRGBColorSpace;
  return LT.claw;
}

// clean coalition plating: crisp panel grid, no rust — hi-tech sand-tan
function cleanPanels(tint = '#b1a17b', seed = 61) {
  const key = 'cp' + tint + seed;
  if (LT[key]) return LT[key];
  const r = makeRng(seed);
  const S = 256, P = 64;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const x = c.getContext('2d');
  for (let py = 0; py < 4; py++) for (let px = 0; px < 4; px++) {
    const f = 0.94 + r() * 0.12, warm = (r() - 0.35) * 0.5;
    const g = x.createLinearGradient(0, py * P, 0, py * P + P);
    g.addColorStop(0, toneC(tint, f * 1.06, warm + 0.2));
    g.addColorStop(0.6, toneC(tint, f, warm));
    g.addColorStop(1, toneC(tint, f * 0.9, warm - 0.15));
    x.fillStyle = g;
    x.fillRect(px * P, py * P, P, P);
  }
  // soft mottling
  for (let i = 0; i < 120; i++) {
    const cx = r() * S, cy = r() * S, rr = 4 + r() * 18;
    const g = x.createRadialGradient(cx, cy, 0, cx, cy, rr);
    const f = 0.92 + r() * 0.16;
    g.addColorStop(0, toneC(tint, f, (r() - 0.5) * 0.4, 0.16));
    g.addColorStop(1, toneC(tint, f, 0, 0));
    x.fillStyle = g;
    x.beginPath(); x.arc(cx, cy, rr, 0, 7); x.fill();
  }
  // crisp seams: dark line + light bevel below/right
  for (let i = 0; i < 4; i++) {
    const p = i * P;
    x.fillStyle = 'rgba(24,20,12,0.5)'; x.fillRect(0, p, S, 2);
    x.fillStyle = 'rgba(255,244,214,0.22)'; x.fillRect(0, p + 2, S, 1.5);
    x.fillStyle = 'rgba(24,20,12,0.45)'; x.fillRect(p, 0, 2, S);
    x.fillStyle = 'rgba(255,244,214,0.16)'; x.fillRect(p + 2, 0, 1.5, S);
  }
  // hex bolts at seam crossings
  for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) {
    const bx = j * P + 8, by = i * P + 8;
    x.fillStyle = 'rgba(20,16,10,0.5)';
    x.beginPath(); x.arc(bx + 1, by + 1.4, 3, 0, 7); x.fill();
    x.fillStyle = toneC(tint, 1.18, 0.2);
    x.beginPath(); x.arc(bx, by, 2.6, 0, 7); x.fill();
    x.fillStyle = 'rgba(255,250,235,0.6)';
    x.beginPath(); x.arc(bx - 0.8, by - 0.9, 1, 0, 7); x.fill();
  }
  // the odd small vent / access hatch
  for (let i = 0; i < 3; i++) {
    const vx = 20 + r() * 200, vy = 20 + r() * 200;
    x.fillStyle = 'rgba(26,24,18,0.55)'; x.fillRect(vx, vy, 22, 12);
    x.fillStyle = toneC(tint, 0.8, -0.1, 0.9);
    for (let k = 0; k < 4; k++) x.fillRect(vx + 2, vy + 2 + k * 2.6, 18, 1.4);
  }
  // faint dust streaks + sun bleach
  for (let i = 0; i < 14; i++) {
    const sx = r() * S, len = 20 + r() * 60;
    const g = x.createLinearGradient(0, 0, 0, len);
    g.addColorStop(0, 'rgba(96,80,50,0.12)');
    g.addColorStop(1, 'rgba(96,80,50,0)');
    x.fillStyle = g; x.fillRect(sx, 0, 3 + r() * 5, len);
  }
  const bg = x.createLinearGradient(0, 0, 0, 70);
  bg.addColorStop(0, 'rgba(255,246,214,0.14)');
  bg.addColorStop(1, 'rgba(255,246,214,0)');
  x.fillStyle = bg; x.fillRect(0, 0, S, 70);
  LT[key] = ctex(c);
  return LT[key];
}

// worn yellow/black hazard chevrons
function hazardTex() {
  if (LT.haz) return LT.haz;
  const r = makeRng(4004);
  const c = document.createElement('canvas');
  c.width = 128; c.height = 32;
  const x = c.getContext('2d');
  x.fillStyle = '#b8922e'; x.fillRect(0, 0, 128, 32);
  x.fillStyle = '#221f1a';
  for (let i = -1; i < 8; i++) {
    x.beginPath();
    x.moveTo(i * 20, 32); x.lineTo(i * 20 + 12, 32);
    x.lineTo(i * 20 + 24, 0); x.lineTo(i * 20 + 12, 0);
    x.closePath(); x.fill();
  }
  for (let i = 0; i < 60; i++) { // chipped wear
    x.fillStyle = r() < 0.5 ? 'rgba(120,96,50,0.5)' : 'rgba(30,26,18,0.4)';
    x.fillRect(r() * 128, r() * 32, 1 + r() * 3, 1 + r() * 2);
  }
  const g = x.createLinearGradient(0, 0, 0, 32);
  g.addColorStop(0, 'rgba(255,240,200,0.18)');
  g.addColorStop(1, 'rgba(40,30,14,0.22)');
  x.fillStyle = g; x.fillRect(0, 0, 128, 32);
  LT.haz = ctex(c, 1);
  LT.haz.repeat.set(3, 1);
  return LT.haz;
}

// helipad: dark tarmac disc with white ring + H
function helipadTex() {
  if (LT.pad) return LT.pad;
  const r = makeRng(5005);
  const S = 256;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const x = c.getContext('2d');
  x.fillStyle = '#55524a'; x.fillRect(0, 0, S, S);
  for (let i = 0; i < 500; i++) {
    x.fillStyle = r() < 0.5 ? 'rgba(0,0,0,0.12)' : 'rgba(255,255,240,0.06)';
    x.beginPath(); x.arc(r() * S, r() * S, 1 + r() * 5, 0, 7); x.fill();
  }
  x.strokeStyle = 'rgba(226,222,206,0.85)';
  x.lineWidth = 9;
  x.beginPath(); x.arc(S / 2, S / 2, 96, 0, 7); x.stroke();
  x.lineWidth = 14; x.lineCap = 'butt';
  x.beginPath();
  x.moveTo(S / 2 - 26, S / 2 - 38); x.lineTo(S / 2 - 26, S / 2 + 38);
  x.moveTo(S / 2 + 26, S / 2 - 38); x.lineTo(S / 2 + 26, S / 2 + 38);
  x.moveTo(S / 2 - 26, S / 2); x.lineTo(S / 2 + 26, S / 2);
  x.stroke();
  // scuffs over the paint
  for (let i = 0; i < 90; i++) {
    x.fillStyle = 'rgba(60,56,48,0.35)';
    x.fillRect(r() * S, r() * S, 2 + r() * 8, 1 + r() * 2);
  }
  LT.pad = ctex(c);
  LT.pad.wrapS = LT.pad.wrapT = THREE.ClampToEdgeWrapping;
  return LT.pad;
}

// ---------------------------------------------------------------- shared materials
let M = null;
function mats() {
  if (M) return M;
  const std = (o) => new THREE.MeshStandardMaterial(o);
  M = {
    // cartel / neutral organic kit
    adobe: std({ map: adobe('#c2a678', 21), roughness: 0.95 }),
    adobeDark: std({ map: adobe('#a98f60', 22), roughness: 0.95 }),
    adobePale: std({ map: adobe('#d3bd92', 23), roughness: 0.95 }),
    metal: std({ map: metalPanels('#7a7f6e', 7), roughness: 0.7, metalness: 0.35 }),
    metalDark: std({ map: metalPanels('#565a4e', 8), roughness: 0.72, metalness: 0.4 }),
    metalRust: std({ map: metalPanels('#7d6a52', 9), roughness: 0.85, metalness: 0.2 }),
    corr: std({ map: corrugated('#8d8d82', 33), roughness: 0.8, metalness: 0.3 }),
    corrRust: std({ map: corrugated('#96805e', 34), roughness: 0.9, metalness: 0.15 }),
    camo: std({ map: camoCanvas(44), roughness: 1, side: THREE.DoubleSide }),
    conc: std({ map: concrete('#9a958a', 55), roughness: 0.9 }),
    wood: std({ color: 0x6e5638, roughness: 1 }),
    woodDark: std({ color: 0x4e3c26, roughness: 1 }),
    gold: std({ color: 0xc8a028, roughness: 0.35, metalness: 0.8 }),
    green: std({ color: 0x3d4a30, roughness: 0.9 }),
    dark: std({ color: 0x222420, roughness: 0.9 }),
    tire: std({ color: 0x1c1c1c, roughness: 1 }),
    sandbag: std({ map: adobe('#8a7a56', 25), roughness: 1 }),
    sandbag2: std({ map: adobe('#8a7a56', 25), color: 0xb9a98a, roughness: 1 }),
    tarp: std({ color: 0x5c6248, roughness: 1, side: THREE.DoubleSide }),
    awning: std({ map: awning(), roughness: 1, side: THREE.DoubleSide }),
    missile: std({ color: 0x8a8f7a, roughness: 0.5, metalness: 0.3 }),
    redTip: std({ color: 0x9c2c1c, roughness: 0.55 }),
    window: std({ color: 0x1a2028, roughness: 0.2, metalness: 0.6 }),
    banner: std({ color: 0x3d4a30, roughness: 0.9, side: THREE.DoubleSide }),
    // coalition clean kit
    cPanel: std({ map: cleanPanels('#b1a17b', 61), roughness: 0.62, metalness: 0.22 }),
    cPanelLight: std({ map: cleanPanels('#c8b98f', 62), roughness: 0.6, metalness: 0.18 }),
    cPanelDark: std({ map: cleanPanels('#837a62', 63), roughness: 0.66, metalness: 0.3 }),
    cWhite: std({ color: 0xd6d0ba, roughness: 0.5, metalness: 0.12 }),
    cSteel: std({ color: 0x4c5258, roughness: 0.45, metalness: 0.6 }),
    cGlass: std({ color: 0x1c3852, emissive: 0x11304c, emissiveIntensity: 0.75, roughness: 0.18, metalness: 0.5 }),
    cGlow: std({ color: 0x9fd8ff, emissive: 0x3f9fe8, emissiveIntensity: 1.4, roughness: 0.4 }),
    reactorGlow: std({ color: 0xaef0ff, emissive: 0x2fb4e8, emissiveIntensity: 2.1 }),
    hazard: std({ map: hazardTex(), roughness: 0.75 }),
    pad: std({ map: helipadTex(), roughness: 0.92 }),
    // vehicle kit
    track: std({ map: trackTex(), roughness: 1 }),
    gun: std({ color: 0x2c2c2e, roughness: 0.5, metalness: 0.55 }),
    hullTan: std({ map: metalPanels('#8a7a52', 12), roughness: 0.75, metalness: 0.25 }),
    hullGreen: std({ map: metalPanels('#5f6448', 13), roughness: 0.75, metalness: 0.25 }),
    turretPaint: std({ map: metalPanels('#55492c', 15), roughness: 0.8, metalness: 0.2 }),
    truckPaint: std({ map: metalPanels('#9a8a6a', 14), roughness: 0.6, metalness: 0.3 }),
    doorPaint: std({ map: metalPanels('#6e6448', 16), roughness: 0.7, metalness: 0.25 }),
    glass: std({ color: 0x20262c, roughness: 0.15, metalness: 0.7 }),
    canvasBed: std({ map: fabric('#6b6448', 991), roughness: 1 }),
    jerry: std({ map: metalPanels('#4c5238', 17), roughness: 0.8, metalness: 0.2 }),
    lightLens: std({ color: 0xe8e0b0, emissive: 0xa89448, emissiveIntensity: 0.9, roughness: 0.35 }),
    redLens: std({ color: 0xd85040, emissive: 0xb02818, emissiveIntensity: 1.1, roughness: 0.35 }),
    claw: std({ map: clawTex(), transparent: true, roughness: 0.9, side: THREE.DoubleSide }),
    usaTan: std({ map: cleanPanels('#9c8d64', 64), roughness: 0.6, metalness: 0.3 }),
    usaTanDark: std({ map: cleanPanels('#7e7250', 65), roughness: 0.65, metalness: 0.3 }),
    // soldier kit
    skin: std({ color: 0x9a7350, roughness: 0.9 }),
    tunic: std({ map: fabric('#7a6f52', 771), roughness: 1 }),
    tunic2: std({ map: fabric('#6b5f45', 772), roughness: 1 }),
    pants: std({ map: fabric('#5c5645', 776), roughness: 1 }),
    vest: std({ color: 0x46422f, roughness: 1 }),
    boots: std({ color: 0x2e2820, roughness: 0.9 }),
    belt: std({ color: 0x39301f, roughness: 0.95 }),
    wrapK: std({ map: fabric('#3a3a34', 775), roughness: 1 }),
    gunWood: std({ color: 0x7a4c2a, roughness: 0.75 }),
    cTunic: std({ map: fabric('#94875f', 781), roughness: 1 }),
    cPants: std({ map: fabric('#7d7355', 782), roughness: 1 }),
    cVest: std({ color: 0x3a4232, roughness: 1 }),
    helmet: std({ map: fabric('#6a7050', 783), roughness: 0.9 }),
    hardhat: std({ color: 0xc8a63c, roughness: 0.5 }),
    // decals
    scorch: new THREE.MeshBasicMaterial({ color: 0x14100c, transparent: true, opacity: 0.7, depthWrite: false }),
    stainMat: new THREE.MeshBasicMaterial({ color: 0x17130d, transparent: true, opacity: 0.45, depthWrite: false }),
  };
  return M;
}

// per-player accent materials (panels / flags / rags)
const ACC = new Map();
function accents(owner) {
  const col = playerColor(owner);
  let a = ACC.get(col);
  if (a) return a;
  const css = '#' + col.toString(16).padStart(6, '0');
  a = {
    paint: new THREE.MeshStandardMaterial({ color: col, roughness: 0.55, metalness: 0.3 }),
    cloth: new THREE.MeshStandardMaterial({ map: fabric(css, 903), roughness: 1, side: THREE.DoubleSide }),
    glow: new THREE.MeshStandardMaterial({ color: col, emissive: col, emissiveIntensity: 0.5, roughness: 0.5 }),
  };
  ACC.set(col, a);
  return a;
}

// ---------------------------------------------------------------- geometry cache + primitives
const GEO = new Map();
function geo(key, make) {
  let g = GEO.get(key);
  if (!g) { g = make(); GEO.set(key, g); }
  return g;
}
const boxGeo = (w, h, d) => geo(`b${w},${h},${d}`, () => new THREE.BoxGeometry(w, h, d));
const cylGeo = (rt, rb, h, seg = 12, open = false, t0 = 0, tl = Math.PI * 2) =>
  geo(`c${rt},${rb},${h},${seg},${open ? 1 : 0},${t0.toFixed(2)},${tl.toFixed(2)}`,
    () => new THREE.CylinderGeometry(rt, rb, h, seg, 1, open, t0, tl));
const coneGeo = (r, h, seg = 8) => geo(`n${r},${h},${seg}`, () => new THREE.ConeGeometry(r, h, seg));
const sphGeo = (r, ws = 14, hs = 10, pl = Math.PI) =>
  geo(`s${r},${ws},${hs},${pl.toFixed(2)}`, () => new THREE.SphereGeometry(r, ws, hs, 0, Math.PI * 2, 0, pl));
const torGeo = (r, t, rs = 8, ts = 14) => geo(`t${r},${t},${rs},${ts}`, () => new THREE.TorusGeometry(r, t, rs, ts));
const cirGeo = (r, seg = 20) => geo(`o${r},${seg}`, () => new THREE.CircleGeometry(r, seg));

function box(g, mat, w, h, d, x = 0, y = 0, z = 0) {
  const m = new THREE.Mesh(boxGeo(w, h, d), mat);
  m.position.set(x, y, z);
  m.castShadow = m.receiveShadow = true;
  g && g.add(m);
  return m;
}
function cyl(g, mat, rt, rb, h, x = 0, y = 0, z = 0, seg = 12) {
  const m = new THREE.Mesh(cylGeo(rt, rb, h, seg), mat);
  m.position.set(x, y, z);
  m.castShadow = m.receiveShadow = true;
  g && g.add(m);
  return m;
}
function cone(g, mat, r, h, x = 0, y = 0, z = 0, seg = 8) {
  const m = new THREE.Mesh(coneGeo(r, h, seg), mat);
  m.position.set(x, y, z);
  m.castShadow = true;
  g && g.add(m);
  return m;
}
function dome(g, mat, r, x = 0, y = 0, z = 0, ws = 16, hs = 10) {
  const m = new THREE.Mesh(sphGeo(r, ws, hs, Math.PI / 2), mat);
  m.position.set(x, y, z);
  m.castShadow = true;
  g && g.add(m);
  return m;
}
const _UP = new THREE.Vector3(0, 1, 0);
const _V1 = new THREE.Vector3(), _V2 = new THREE.Vector3();
function strut(g, mat, x1, y1, z1, x2, y2, z2, r, seg = 6) {
  _V1.set(x1, y1, z1); _V2.set(x2, y2, z2).sub(_V1);
  const len = _V2.length();
  const m = new THREE.Mesh(cylGeo(r, r, 1, seg), mat);
  m.scale.set(1, len, 1);
  m.position.copy(_V1).addScaledVector(_V2, 0.5);
  m.quaternion.setFromUnitVectors(_UP, _V2.normalize());
  m.castShadow = true;
  g && g.add(m);
  return m;
}
// ground decal circle
function decal(g, mat, r, x, z, y = 0.05) {
  const m = new THREE.Mesh(cirGeo(r, 18), mat);
  m.rotation.x = -Math.PI / 2;
  m.position.set(x, y, z);
  g.add(m);
  return m;
}

// minimal geometry merger (positions/normals/uvs, indexed)
function mergeGeos(geos) {
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

// ---------------------------------------------------------------- shared props
// merged staggered sandbags (two earth tones)
function sandbags(g, placements) {
  const m = mats();
  const geosA = [], geosB = [];
  let i = 0;
  for (const p of placements) {
    const ge = new THREE.BoxGeometry(0.74 + rng() * 0.16, 0.28 + rng() * 0.06, 0.46 + rng() * 0.1);
    ge.rotateZ((rng() - 0.5) * 0.07);
    ge.rotateY(p.ry + (rng() - 0.5) * 0.2);
    ge.translate(p.x, p.y, p.z);
    (i++ % 2 ? geosA : geosB).push(ge);
  }
  for (const [geos, mat] of [[geosA, m.sandbag], [geosB, m.sandbag2]]) {
    if (!geos.length) continue;
    const mesh = new THREE.Mesh(mergeGeos(geos), mat);
    mesh.castShadow = mesh.receiveShadow = true;
    g.add(mesh);
  }
}
function sandbagRing(g, r, courses = 3, gap0 = 5.0, gap1 = 5.9) {
  const placements = [];
  const n = Math.round((Math.PI * 2 * r) / 0.8);
  for (let h = 0; h < courses; h++) {
    const off = (h % 2) * 0.5;
    for (let i = 0; i < n; i++) {
      const a = ((i + off) / n) * Math.PI * 2;
      if (a > gap0 && a < gap1) continue;
      if (h === courses - 1 && rng() < 0.18) continue;
      placements.push({ x: Math.cos(a) * r, y: 0.16 + h * 0.29, z: Math.sin(a) * r, ry: -a + Math.PI / 2 });
    }
  }
  sandbags(g, placements);
}
function sandbagRow(g, cx, y0, cz, angle, count, courses = 2) {
  const placements = [];
  const dx = Math.cos(angle), dz = Math.sin(angle);
  for (let h = 0; h < courses; h++) {
    const n = count - (h % 2 ? 1 : 0);
    for (let i = 0; i < n; i++) {
      const t = (i - (n - 1) / 2) * 0.84;
      placements.push({ x: cx + dx * t, y: y0 + 0.16 + h * 0.29, z: cz + dz * t, ry: -angle });
    }
  }
  sandbags(g, placements);
}

// waving cloth plane (flags / banners / nets) — fresh displaced geometry
function clothPlane(mat, w, h, segX = 5, segY = 3, amp = 0.1, phase = 0) {
  const ge = new THREE.PlaneGeometry(w, h, segX, segY);
  const p = ge.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const t = (p.getX(i) / w + 0.5);
    p.setZ(i, Math.sin(t * 5 + phase) * amp * t);
  }
  ge.computeVertexNormals();
  const m = new THREE.Mesh(ge, mat);
  m.castShadow = true;
  return m;
}
// pole + player flag flying to +X of pole
function flagPole(g, owner, x, z, h = 8, fw = 2.6, fh = 1.5) {
  const m = mats(), A = accents(owner);
  cyl(g, m.cSteel, 0.07, 0.1, h, x, h / 2, z, 7);
  cyl(g, m.gold, 0.13, 0.13, 0.16, x, h + 0.06, z, 7);
  const flag = clothPlane(A.cloth, fw, fh, 5, 2, 0.16, rng() * 3);
  flag.position.set(x + fw / 2 + 0.05, h - fh / 2 - 0.12, z);
  g.add(flag);
  return flag;
}
function crate(g, mat, s, x, y, z, ry = 0) {
  const c = box(g, mat, s, s * 0.72, s * 0.9, x, y, z);
  c.rotation.y = ry;
  return c;
}
function drum(g, mat, x, z, r = 0.42, h = 1.1) {
  const m = mats();
  cyl(g, mat, r, r, h, x, h / 2, z, 10);
  cyl(g, m.metalDark, r + 0.015, r + 0.015, 0.05, x, h * 0.24, z, 10);
  cyl(g, m.metalDark, r + 0.015, r + 0.015, 0.05, x, h * 0.78, z, 10);
}
function tireTorus(g, x, y, z, flat = true, r = 0.55, t = 0.24) {
  const m = new THREE.Mesh(torGeo(r, t, 8, 14), mats().tire);
  if (flat) m.rotation.x = Math.PI / 2;
  m.position.set(x, y, z);
  m.castShadow = true;
  g.add(m);
  return m;
}
// camo net stretched over poles
function camoNet(g, w, d, x, y, z, tilt = 0.15) {
  const m = mats();
  const net = new THREE.Mesh(new THREE.PlaneGeometry(w, d, 4, 4), m.camo);
  const np = net.geometry.attributes.position;
  for (let i = 0; i < np.count; i++) np.setZ(i, Math.sin(i * 1.7) * 0.35);
  net.geometry.computeVertexNormals();
  net.rotation.x = -Math.PI / 2 + tilt;
  net.position.set(x, y, z);
  net.castShadow = true;
  g.add(net);
  return net;
}
// roof AC unit
function acUnit(g, x, y, z, s = 1) {
  const m = mats();
  box(g, m.cSteel, 1.4 * s, 0.9 * s, 1.1 * s, x, y + 0.45 * s, z);
  box(g, m.dark, 1.1 * s, 0.6 * s, 0.06, x, y + 0.48 * s, z + 0.56 * s);
}

// ================================================================= INFANTRY
// Shared humanoid, GZH chunky proportions. The whole figure lives inside the
// aim group (userData.turret) so combat can swivel the soldier to face targets.
const INF_SCALE = 1.14;

function figureBase(fig, o) {
  const m = mats();
  // legs — slight stride
  for (const [sx, rot] of [[-0.12, 0.16], [0.12, -0.13]]) {
    const leg = new THREE.Group();
    leg.position.set(sx, 0.94, 0);
    leg.rotation.x = rot * (o.stride ?? 1);
    box(leg, o.pants, 0.18, 0.5, 0.21, 0, -0.25, 0);
    box(leg, o.pants, 0.15, 0.4, 0.17, 0, -0.66, -0.01);
    box(leg, m.boots, 0.155, 0.09, 0.18, 0, -0.845, -0.015);
    box(leg, m.boots, 0.15, 0.11, 0.26, 0, -0.9, -0.045);
    fig.add(leg);
  }
  // torso
  box(fig, o.tunic, 0.38, 0.56, 0.23, 0, 1.32, 0);
  box(fig, o.vest, 0.41, 0.3, 0.29, 0, 1.4, 0);
  box(fig, m.belt, 0.42, 0.07, 0.26, 0, 1.06, 0);
  // ammo pouches (chest = -Z, the facing/fire direction)
  box(fig, m.belt, 0.09, 0.13, 0.05, -0.12, 1.36, -0.16);
  box(fig, m.belt, 0.09, 0.13, 0.05, 0.01, 1.36, -0.16);
  box(fig, m.belt, 0.09, 0.13, 0.05, 0.14, 1.36, -0.16);
  // head
  box(fig, m.skin, 0.2, 0.24, 0.21, 0, 1.78, -0.01);
  // shoulders
  box(fig, o.tunic, 0.135, 0.14, 0.15, -0.245, 1.51, 0);
  box(fig, o.tunic, 0.135, 0.14, 0.15, 0.245, 1.51, 0);
}
// arm as a bent pair of segments from shoulder to a grip point
function arm(fig, mat, sx, gx, gy, gz) {
  const m = mats();
  const ex = (sx + gx) / 2 + Math.sign(sx) * 0.06;   // elbow bows outward
  const ey = (1.5 + gy) / 2 - 0.05, ez = (0 + gz) / 2 + 0.04;
  strut(fig, mat, sx, 1.5, 0, ex, ey, ez, 0.062, 6);
  strut(fig, mat, ex, ey, ez, gx, gy, gz, 0.054, 6);
  box(fig, m.skin, 0.085, 0.09, 0.095, gx, gy, gz);
}
function helmetUS(fig, owner) {
  const m = mats(), A = accents(owner);
  const h = new THREE.Mesh(sphGeo(0.165, 12, 7, Math.PI * 0.58), m.helmet);
  h.scale.set(1, 0.82, 1.12);
  h.position.set(0, 1.87, -0.01);
  h.castShadow = true;
  fig.add(h);
  box(fig, m.dark, 0.24, 0.05, 0.06, 0, 1.86, -0.13);          // goggles on brim
  box(fig, A.paint, 0.05, 0.05, 0.02, 0.11, 1.84, -0.12);      // team patch
}
function headWrap(fig, wrapMat) {
  box(fig, wrapMat, 0.21, 0.1, 0.225, 0, 1.72, -0.02);         // face cloth
  box(fig, wrapMat, 0.28, 0.17, 0.29, 0, 1.92, 0);             // dome
  box(fig, wrapMat, 0.29, 0.075, 0.3, 0, 1.83, 0);             // brim
  const t1 = box(fig, wrapMat, 0.1, 0.3, 0.035, 0.05, 1.64, 0.14);  // tail hangs down the back (+Z)
  t1.rotation.x = -0.14;
}
function rifleAK(fig) {
  const m = mats();
  const gun = new THREE.Group();
  gun.position.set(0.05, 1.34, -0.32);
  gun.rotation.x = -0.06;
  fig.add(gun);
  box(gun, m.gun, 0.06, 0.095, 0.46, 0, 0, 0);                 // receiver
  const stock = box(gun, m.gunWood, 0.05, 0.11, 0.26, 0, -0.015, 0.34);
  stock.rotation.x = -0.12;
  box(gun, m.gunWood, 0.058, 0.08, 0.2, 0, 0.005, -0.28);      // handguard
  box(gun, m.gunWood, 0.045, 0.1, 0.055, 0, -0.09, 0.12);      // grip
  const mag = box(gun, m.gun, 0.05, 0.17, 0.08, 0, -0.11, -0.04);
  mag.rotation.x = 0.45;
  const b = cyl(gun, m.gun, 0.018, 0.018, 0.34, 0, 0.01, -0.5, 6);
  b.rotation.x = Math.PI / 2;
  box(gun, m.gun, 0.02, 0.06, 0.03, 0, 0.04, -0.62);
  return gun;
}
function rifleCarbine(fig) {
  const m = mats();
  const gun = new THREE.Group();
  gun.position.set(0.05, 1.34, -0.32);
  gun.rotation.x = -0.05;
  fig.add(gun);
  box(gun, m.gun, 0.06, 0.1, 0.5, 0, 0, 0);
  box(gun, m.gun, 0.055, 0.09, 0.2, 0, -0.01, 0.34);           // collapsible stock
  box(gun, m.gun, 0.05, 0.05, 0.3, 0, 0.075, -0.05);           // carry handle/optic
  box(gun, m.gun, 0.045, 0.1, 0.05, 0, -0.09, 0.1);
  box(gun, m.gun, 0.045, 0.14, 0.06, 0, -0.1, -0.05);          // straight mag
  const b = cyl(gun, m.gun, 0.016, 0.016, 0.3, 0, 0.01, -0.46, 6);
  b.rotation.x = Math.PI / 2;
  box(gun, m.gun, 0.02, 0.05, 0.03, 0, 0.035, -0.58);
  return gun;
}
function poseRifle(fig, tunic) {
  arm(fig, tunic, 0.27, 0.1, 1.26, -0.14);   // right hand at grip
  arm(fig, tunic, -0.27, 0.04, 1.32, -0.5);  // left hand at handguard
}
function soldier(g, owner, kind) {
  const m = mats(), A = accents(owner);
  const aim = new THREE.Group();
  g.add(aim);
  const fig = new THREE.Group();
  fig.scale.setScalar(INF_SCALE);
  aim.add(fig);
  const S = INF_SCALE;
  let muzzle = null;
  if (kind === 'ranger') {
    figureBase(fig, { tunic: m.cTunic, pants: m.cPants, vest: m.cVest });
    box(fig, A.paint, 0.1, 0.1, 0.05, 0, 1.47, -0.17);          // chest team plate
    helmetUS(fig, owner);
    rifleCarbine(fig);
    poseRifle(fig, m.cTunic);
    box(fig, m.cVest, 0.3, 0.34, 0.14, 0, 1.38, 0.2);           // ruck on the back
    muzzle = new THREE.Vector3(0.05 * S, 1.35 * S, -0.95 * S);
  } else if (kind === 'missiledef') {
    figureBase(fig, { tunic: m.cTunic, pants: m.cPants, vest: m.cVest });
    helmetUS(fig, owner);
    box(fig, m.glass, 0.19, 0.07, 0.04, 0, 1.8, -0.12);         // targeting visor
    // shoulder launch tube
    const tube = new THREE.Group();
    tube.position.set(0.23, 1.6, 0.05);
    tube.rotation.x = -0.12;
    fig.add(tube);
    const t = cyl(tube, m.hullGreen, 0.085, 0.085, 1.15, 0, 0, 0, 10);
    t.rotation.x = Math.PI / 2;
    const rim = cyl(tube, m.dark, 0.1, 0.1, 0.09, 0, 0, -0.6, 10);
    rim.rotation.x = Math.PI / 2;
    const rim2 = cyl(tube, m.dark, 0.11, 0.11, 0.12, 0, 0, 0.56, 10);
    rim2.rotation.x = Math.PI / 2;
    box(tube, A.paint, 0.05, 0.03, 0.3, 0, 0.1, 0.1);           // sight rail accent
    box(tube, m.gun, 0.08, 0.12, 0.16, -0.08, -0.1, -0.1);      // grip block
    arm(fig, m.cTunic, 0.27, 0.16, 1.5, -0.12);
    arm(fig, m.cTunic, -0.27, 0.02, 1.44, -0.22);
    box(fig, m.cSteel, 0.3, 0.36, 0.16, 0, 1.36, 0.21);         // electronics pack on the back
    cyl(fig, m.dark, 0.012, 0.012, 0.5, -0.12, 1.75, 0.24, 5);
    muzzle = new THREE.Vector3(0.23 * S, 1.68 * S, -0.75 * S);
  } else if (kind === 'rebel') {
    figureBase(fig, { tunic: m.tunic, pants: m.pants, vest: m.vest });
    headWrap(fig, A.cloth);                                     // player-colour wrap
    const bando = box(fig, m.belt, 0.11, 0.6, 0.04, -0.015, 1.32, -0.16);
    bando.rotation.z = 0.62;
    rifleAK(fig);
    poseRifle(fig, m.tunic);
    muzzle = new THREE.Vector3(0.05 * S, 1.35 * S, -0.95 * S);
  } else if (kind === 'rpg') {
    figureBase(fig, { tunic: m.tunic2, pants: m.pants, vest: m.vest });
    headWrap(fig, m.wrapK);
    box(fig, A.paint, 0.13, 0.06, 0.02, 0, 1.45, -0.16);        // chest rag stripe
    // RPG on shoulder
    const tube = new THREE.Group();
    tube.position.set(0.22, 1.62, 0.1);
    tube.rotation.x = -0.16;
    fig.add(tube);
    const t = cyl(tube, m.metalRust, 0.05, 0.05, 0.95, 0, 0, 0.05, 8);
    t.rotation.x = Math.PI / 2;
    const flare = cyl(tube, m.dark, 0.09, 0.05, 0.22, 0, 0, 0.55, 8);
    flare.rotation.x = Math.PI / 2;
    const warhead = cone(tube, m.hullGreen, 0.085, 0.34, 0, 0, -0.55, 8);
    warhead.rotation.x = -Math.PI / 2;
    cyl(tube, m.redTip, 0.03, 0.03, 0.08, 0, 0, -0.74, 6).rotation.x = Math.PI / 2;
    box(tube, m.gunWood, 0.045, 0.1, 0.06, 0, -0.1, 0.12);
    arm(fig, m.tunic2, 0.27, 0.17, 1.52, -0.05);
    arm(fig, m.tunic2, -0.27, 0.06, 1.46, -0.16);
    // spare rocket satchel on the back
    const spare = cone(fig, m.hullGreen, 0.07, 0.3, -0.16, 1.42, 0.24, 7);
    spare.rotation.x = Math.PI / 2 - 0.3;
    box(fig, m.canvasBed, 0.28, 0.3, 0.14, 0, 1.3, 0.2);
    muzzle = new THREE.Vector3(0.22 * S, 1.72 * S, -0.85 * S);
  } else if (kind === 'worker') {
    figureBase(fig, { tunic: m.tunic, pants: m.pants, vest: m.tunic2 });
    const hat = new THREE.Mesh(sphGeo(0.16, 10, 6, Math.PI * 0.52), m.hardhat);
    hat.scale.set(1, 0.75, 1.05);
    hat.position.set(0, 1.88, -0.01);
    hat.castShadow = true;
    fig.add(hat);
    box(fig, m.hardhat, 0.26, 0.028, 0.3, 0, 1.845, -0.02);     // brim
    box(fig, A.paint, 0.16, 0.1, 0.03, 0, 1.42, -0.15);         // team bib
    // shovel over the shoulder
    const sh = new THREE.Group();
    sh.position.set(-0.24, 1.6, 0.05);
    sh.rotation.x = -0.5; sh.rotation.z = 0.15;
    fig.add(sh);
    cyl(sh, m.wood, 0.025, 0.025, 1.1, 0, 0, 0, 6);
    const blade = box(sh, m.metalDark, 0.16, 0.26, 0.03, 0, -0.66, 0);
    blade.rotation.x = 0.1;
    arm(fig, m.tunic, -0.27, -0.22, 1.32, 0.12);
    arm(fig, m.tunic, 0.27, 0.3, 1.0, 0.06);
    // tool bag
    box(fig, m.canvasBed, 0.16, 0.18, 0.1, 0.2, 1.02, -0.12);
  }
  if (muzzle) {
    g.userData.turret = aim;
    g.userData.muzzle = muzzle;
  }
  return aim;
}
// small crew figure for vehicle pintle guns (fps technical style)
function crewGunner(parent, owner, wrapAccent = true) {
  const m = mats(), A = accents(owner);
  const crew = new THREE.Group();
  parent.add(crew);
  box(crew, m.tunic, 0.15, 0.34, 0.18, -0.1, 0.14, 0);
  box(crew, m.tunic, 0.15, 0.34, 0.18, 0.1, 0.14, 0);
  box(crew, m.tunic, 0.36, 0.5, 0.22, 0, 0.55, 0);
  box(crew, m.dark, 0.38, 0.26, 0.26, 0, 0.62, 0);
  box(crew, m.skin, 0.18, 0.2, 0.19, 0, 0.93, 0.01);
  const wrapMat = wrapAccent ? A.cloth : m.wrapK;
  box(crew, wrapMat, 0.24, 0.13, 0.24, 0, 1.05, 0);
  box(crew, wrapMat, 0.245, 0.06, 0.25, 0, 0.985, 0);
  for (const s of [-1, 1]) {
    const armb = box(crew, m.tunic, 0.11, 0.4, 0.12, s * 0.2, 0.68, -0.16);
    armb.rotation.x = -1.15;
    armb.rotation.z = s * -0.18;
    box(crew, m.skin, 0.07, 0.08, 0.08, s * 0.13, 0.75, -0.38);
  }
  return crew;
}

// ================================================================= CARTEL VEHICLES
function vScorpion(g, owner) {
  const m = mats(), A = accents(owner);
  const s = 1.1;
  const h = new THREE.Group();
  h.scale.setScalar(s);
  g.add(h);
  // hull with angled glacis
  box(h, m.hullTan, 2.6, 0.75, 4.6, 0, 1.0, 0);
  const glacis = box(h, m.hullTan, 2.5, 0.7, 1.3, 0, 1.12, -2.35);
  glacis.rotation.x = -0.5;
  const rear = box(h, m.hullTan, 2.4, 0.6, 0.8, 0, 1.05, 2.5);
  rear.rotation.x = 0.4;
  for (const sd of [-1, 1]) {
    const stack = cyl(h, m.dark, 0.075, 0.095, 0.42, sd * 1.05, 1.5, 2.15, 8);
    stack.rotation.x = 0.4;
  }
  // tracks + accent skirt band + wheels
  for (const sd of [-1, 1]) {
    box(h, m.track, 0.55, 0.72, 4.9, sd * 1.45, 0.62, 0);
    box(h, A.paint, 0.6, 0.15, 4.3, sd * 1.45, 1.08, 0);
    for (let i = 0; i < 5; i++) {
      const w = cyl(h, m.dark, 0.34, 0.34, 0.2, sd * 1.48, 0.36, -1.7 + i * 0.85, 10);
      w.rotation.z = Math.PI / 2;
    }
    for (const sz of [-2.35, 2.35]) {
      const w = cyl(h, m.dark, 0.28, 0.28, 0.24, sd * 1.45, 0.46, sz, 10);
      w.rotation.z = Math.PI / 2;
      cyl(h, m.gun, 0.1, 0.1, 0.26, sd * 1.45, 0.46, sz, 8).rotation.z = Math.PI / 2;
    }
  }
  // low rounded turret, two-tone
  const turret = new THREE.Group();
  turret.position.set(0, 1.6 * s, -0.2 * s);
  g.add(turret);
  const ts = new THREE.Group();
  ts.scale.setScalar(s);
  turret.add(ts);
  box(ts, m.turretPaint, 1.7, 0.55, 2.1, 0, 0.2, 0);
  box(ts, m.turretPaint, 1.3, 0.18, 1.6, 0, 0.55, 0.1);
  box(ts, m.dark, 0.7, 0.45, 0.5, 0, 0.18, -1.15);
  for (const sd of [-1, 1]) {
    const em = new THREE.Mesh(new THREE.PlaneGeometry(1.35, 0.55), m.claw);
    em.position.set(sd * 0.865, 0.2, 0.15);
    em.rotation.y = sd * Math.PI / 2;
    ts.add(em);
  }
  const barrel = cyl(ts, m.gun, 0.09, 0.11, 3.4, 0, 0.2, -2.9, 10);
  barrel.rotation.x = Math.PI / 2;
  cyl(ts, m.gun, 0.13, 0.13, 0.5, 0, 0.2, -4.3, 10).rotation.x = Math.PI / 2;
  cyl(ts, m.hullGreen, 0.3, 0.32, 0.12, -0.4, 0.68, 0.4, 10);
  box(ts, m.canvasBed, 0.8, 0.25, 0.5, 0.5, 0.5, 0.7);
  box(ts, m.jerry, 0.5, 0.2, 0.3, -0.45, 0.48, 0.85);
  const ant = cyl(ts, m.dark, 0.015, 0.015, 1.8, 0.7, 1.4, 0.8, 5);
  ant.rotation.z = 0.12;
  box(ts, A.cloth, 0.22, 0.16, 0.02, 0.62, 2.05, 0.82);        // rag on the antenna
  // claw prongs on the glacis
  for (const sx of [-0.95, -0.35, 0.35, 0.95]) {
    const spike = cone(h, m.dark, 0.09, 0.55, sx, 1.36, -3.0, 6);
    spike.rotation.x = -Math.PI / 2 + 0.35;
  }
  g.userData.turret = turret;
  g.userData.muzzle = new THREE.Vector3(0, 0.2 * s, -4.65 * s);
}

// shared pickup body used by technical + quad base (technical scale)
function pickupBody(h, m, A, paint, doorMat) {
  box(h, paint, 1.8, 0.55, 4.2, 0, 0.85, 0);
  box(h, paint, 1.75, 0.7, 1.5, 0, 1.45, -0.9);
  box(h, paint, 1.7, 0.45, 1.1, 0, 1.05, -2.0);
  box(h, doorMat, 1.8, 0.08, 1.55, 0, 1.83, -0.9);
  const shield = box(h, m.glass, 1.44, 0.5, 0.09, 0, 1.52, -1.63);
  shield.rotation.x = 0.18;
  for (const s of [-1, 1]) {
    const pil = box(h, paint, 0.14, 0.56, 0.1, s * 0.79, 1.52, -1.63);
    pil.rotation.x = 0.18;
    box(h, m.glass, 0.06, 0.34, 1.05, s * 0.88, 1.56, -0.9);
    box(h, doorMat, 0.045, 0.42, 1.35, s * 0.9, 1.12, -0.9);
    box(h, m.dark, 0.03, 0.14, 0.09, s * 1.0, 1.62, -1.56);
  }
  box(h, m.glass, 1.2, 0.32, 0.08, 0, 1.54, -0.14);
  box(h, m.dark, 0.8, 0.22, 0.05, 0, 1.0, -2.57);
  for (const s of [-1, 1]) box(h, m.lightLens, 0.18, 0.13, 0.04, s * 0.58, 1.03, -2.57);
  // bed
  box(h, m.dark, 1.7, 0.45, 1.9, 0, 0.95, 1.1);
  for (const s of [-1, 1]) box(h, paint, 0.08, 0.1, 1.95, s * 0.82, 1.22, 1.1);
  box(h, paint, 1.7, 0.26, 0.07, 0, 1.28, 2.07);
  // bull bar
  for (const s of [-1, 1]) cyl(h, m.dark, 0.035, 0.035, 0.5, s * 0.55, 1.02, -2.68, 8);
  for (const by of [0.92, 1.2]) cyl(h, m.dark, 0.035, 0.035, 1.5, 0, by, -2.68, 8).rotation.z = Math.PI / 2;
  // wheels
  for (const [wx, wz] of [[-0.95, -1.6], [0.95, -1.6], [-0.95, 1.4], [0.95, 1.4]]) {
    const w = cyl(h, m.tire, 0.42, 0.42, 0.3, wx, 0.42, wz, 12);
    w.rotation.z = Math.PI / 2;
    cyl(h, m.dark, 0.18, 0.18, 0.32, wx, 0.42, wz, 8).rotation.z = Math.PI / 2;
  }
}
function vTechnical(g, owner) {
  const m = mats(), A = accents(owner);
  const s = 1.12;
  const h = new THREE.Group();
  h.scale.setScalar(s);
  g.add(h);
  pickupBody(h, m, A, m.truckPaint, m.doorPaint);
  box(h, A.cloth, 1.0, 0.05, 0.85, 0.2, 1.88, -1.0);           // player rag lashed on the roof
  // roll bar
  for (const sd of [-1, 1]) {
    cyl(h, m.dark, 0.045, 0.045, 0.82, sd * 0.7, 1.56, 0.32, 8);
    const brace = cyl(h, m.dark, 0.035, 0.035, 0.62, sd * 0.7, 1.72, 0.62, 8);
    brace.rotation.x = 1.0;
  }
  cyl(h, m.dark, 0.045, 0.045, 1.46, 0, 1.95, 0.32, 8).rotation.z = Math.PI / 2;
  // stowage
  box(h, m.jerry, 0.17, 0.34, 0.26, -0.6, 1.35, 1.75);
  box(h, m.jerry, 0.17, 0.34, 0.26, -0.6, 1.35, 1.44);
  const roll = cyl(h, m.canvasBed, 0.14, 0.14, 1.1, 0.15, 1.28, 2.0, 8);
  roll.rotation.z = Math.PI / 2;
  const spare = cyl(h, m.tire, 0.34, 0.34, 0.2, 0.99, 1.05, 0.55, 12);
  spare.rotation.z = Math.PI / 2;
  const ant = cyl(h, m.dark, 0.012, 0.012, 1.5, -0.78, 2.55, -0.35, 5);
  ant.rotation.z = 0.1;
  // pintle gun turret + gunner
  const turret = new THREE.Group();
  turret.position.set(0, 1.5 * s, 1.1 * s);
  g.add(turret);
  const ts = new THREE.Group();
  ts.scale.setScalar(s);
  turret.add(ts);
  cyl(ts, m.gun, 0.06, 0.08, 0.7, 0, 0, 0, 8);
  box(ts, m.gun, 0.16, 0.2, 1.1, 0, 0.42, -0.3);
  box(ts, m.dark, 0.16, 0.13, 0.2, 0.17, 0.42, -0.25);
  cyl(ts, m.gun, 0.035, 0.035, 1.0, 0, 0.44, -1.3, 8).rotation.x = Math.PI / 2;
  cyl(ts, m.gun, 0.055, 0.055, 0.14, 0, 0.44, -1.75, 8).rotation.x = Math.PI / 2;
  box(ts, m.dark, 0.3, 0.35, 0.04, 0, 0.47, 0.35);
  const crew = crewGunner(ts, owner);
  crew.position.set(0, -0.33, 0.62);
  g.userData.turret = turret;
  g.userData.muzzle = new THREE.Vector3(0, 0.44 * s, -1.85 * s);
}

function vQuad(g, owner) {
  const m = mats(), A = accents(owner);
  const s = 1.16;
  const h = new THREE.Group();
  h.scale.setScalar(s);
  g.add(h);
  pickupBody(h, m, A, m.hullGreen, m.doorPaint);
  // armour plates bolted over the cab + bed sides
  box(h, m.metalDark, 1.84, 0.4, 1.4, 0, 1.28, -0.9);
  box(h, m.metalDark, 0.06, 0.34, 2.0, -0.86, 1.4, 1.05);
  box(h, m.metalDark, 0.06, 0.34, 2.0, 0.86, 1.4, 1.05);
  box(h, A.paint, 1.7, 0.1, 0.08, 0, 1.62, 2.06);              // accent tail band
  const em = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 0.45), m.claw);
  em.position.set(0, 1.42, -2.56);
  h.add(em);
  // quad AA mount
  const turret = new THREE.Group();
  turret.position.set(0, 1.55 * s, 0.95 * s);
  g.add(turret);
  const ts = new THREE.Group();
  ts.scale.setScalar(s);
  turret.add(ts);
  cyl(ts, m.metalDark, 0.5, 0.6, 0.3, 0, 0.05, 0, 12);         // ring base
  box(ts, m.hullGreen, 0.7, 0.5, 0.9, 0, 0.45, 0.1);           // receiver body
  box(ts, m.dark, 0.9, 0.55, 0.06, 0, 0.5, -0.4);              // gun shield
  for (const [bx, by] of [[-0.3, 0.34], [0.3, 0.34], [-0.3, 0.62], [0.3, 0.62]]) {
    const b = cyl(ts, m.gun, 0.05, 0.055, 1.9, bx, by, -1.3, 8);
    b.rotation.x = Math.PI / 2;
    cyl(ts, m.gun, 0.075, 0.075, 0.18, bx, by, -2.2, 8).rotation.x = Math.PI / 2;
    cyl(ts, m.dark, 0.09, 0.09, 0.34, bx, by, -0.42, 8).rotation.x = Math.PI / 2;
  }
  cyl(ts, m.metalRust, 0.22, 0.22, 0.4, -0.55, 0.45, 0.25, 10).rotation.z = Math.PI / 2; // ammo drum
  cyl(ts, m.metalRust, 0.22, 0.22, 0.4, 0.55, 0.45, 0.25, 10).rotation.z = Math.PI / 2;
  box(ts, m.dark, 0.28, 0.26, 0.3, 0, 0.32, 0.68);             // gunner seat
  g.userData.turret = turret;
  g.userData.muzzle = new THREE.Vector3(0, 0.48 * s, -2.3 * s);
}

function vBuggy(g, owner) {
  const m = mats(), A = accents(owner);
  const h = new THREE.Group();
  g.add(h);
  // low hull + nose
  box(h, m.truckPaint, 1.5, 0.42, 2.6, 0, 0.62, -0.2);
  const nose = box(h, m.truckPaint, 1.3, 0.36, 1.0, 0, 0.62, -1.8);
  nose.rotation.x = -0.22;
  box(h, m.dark, 1.2, 0.3, 1.2, 0, 0.55, 0.9);                 // engine block rear
  cyl(h, m.gun, 0.05, 0.05, 0.5, 0.35, 0.95, 1.3, 6).rotation.x = 0.6; // exhausts
  cyl(h, m.gun, 0.05, 0.05, 0.5, -0.35, 0.95, 1.3, 6).rotation.x = 0.6;
  // roll cage
  for (const sd of [-1, 1]) {
    strut(h, m.metalDark, sd * 0.6, 0.8, -1.0, sd * 0.6, 1.65, -0.3, 0.045, 6);
    strut(h, m.metalDark, sd * 0.6, 1.65, -0.3, sd * 0.6, 0.85, 0.7, 0.045, 6);
  }
  strut(h, m.metalDark, -0.6, 1.65, -0.3, 0.6, 1.65, -0.3, 0.04, 6);
  // windshield frame + driver
  const shield = box(h, m.glass, 1.0, 0.34, 0.06, 0, 1.15, -1.15);
  shield.rotation.x = 0.3;
  const drv = crewGunner(h, owner, true);
  drv.scale.setScalar(0.85);
  drv.position.set(-0.25, 0.55, -0.4);
  // wheels: big rear, small front
  for (const sd of [-1, 1]) {
    const wr = cyl(h, m.tire, 0.55, 0.55, 0.42, sd * 0.95, 0.55, 0.9, 12);
    wr.rotation.z = Math.PI / 2;
    cyl(h, m.dark, 0.22, 0.22, 0.44, sd * 0.95, 0.55, 0.9, 8).rotation.z = Math.PI / 2;
    const wf = cyl(h, m.tire, 0.38, 0.38, 0.26, sd * 0.8, 0.38, -1.55, 12);
    wf.rotation.z = Math.PI / 2;
  }
  // rocket rack turret on the rear deck
  const turret = new THREE.Group();
  turret.position.set(0.25, 1.35, 0.55);
  g.add(turret);
  cyl(turret, m.metalDark, 0.12, 0.16, 0.5, 0, -0.25, 0, 8);
  const rack = new THREE.Group();
  rack.rotation.x = -0.42;
  turret.add(rack);
  box(rack, m.metalDark, 0.85, 0.6, 1.5, 0, 0, 0);
  for (const bx of [-0.26, 0, 0.26]) for (const by of [-0.16, 0.16]) {
    const t = cyl(rack, m.hullGreen, 0.09, 0.09, 1.6, bx, by, 0, 8);
    t.rotation.x = Math.PI / 2;
    cyl(rack, m.dark, 0.1, 0.1, 0.06, bx, by, -0.8, 8).rotation.x = Math.PI / 2;
    const tip = cone(rack, m.missile, 0.06, 0.18, bx, by, -0.86, 6);
    tip.rotation.x = -Math.PI / 2;
  }
  box(rack, A.paint, 0.87, 0.62, 0.1, 0, 0, 0.72);             // accent rear plate
  g.userData.turret = turret;
  g.userData.muzzle = new THREE.Vector3(0, 0.45, -1.0);
  // whip antenna + rag
  const ant = cyl(h, m.dark, 0.012, 0.012, 1.3, -0.55, 1.9, 0.6, 5);
  ant.rotation.z = 0.14;
  box(h, A.cloth, 0.2, 0.14, 0.02, -0.72, 2.4, 0.6);
}

function vTruckG(g, owner) {
  const m = mats(), A = accents(owner);
  const h = new THREE.Group();
  g.add(h);
  // battered bonneted hauler
  box(h, m.metalRust, 2.2, 0.5, 5.2, 0, 0.85, 0.2);            // chassis
  box(h, m.truckPaint, 1.9, 0.8, 1.5, 0, 1.5, -1.85);          // hood
  box(h, m.dark, 1.0, 0.4, 0.08, 0, 1.35, -2.62);              // grille
  box(h, m.lightLens, 0.2, 0.16, 0.05, -0.65, 1.4, -2.62);     // one headlight...
  box(h, m.dark, 0.2, 0.16, 0.05, 0.65, 1.4, -2.62);           // ...one busted
  box(h, m.doorPaint, 2.0, 1.1, 1.3, 0, 1.75, -0.65);          // cab
  box(h, m.corrRust, 2.05, 0.1, 1.35, 0, 2.35, -0.65);         // patched roof
  const shield = box(h, m.glass, 1.6, 0.55, 0.08, 0, 1.95, -1.32);
  shield.rotation.x = 0.12;
  box(h, A.cloth, 0.24, 0.2, 0.03, 1.05, 1.85, -0.85);         // door rag
  // flat bed with wooden stakes
  box(h, m.woodDark, 2.3, 0.16, 3.0, 0, 1.2, 1.4);
  for (const sd of [-1, 1]) {
    box(h, m.wood, 0.08, 0.5, 3.0, sd * 1.12, 1.5, 1.4);
    for (let i = 0; i < 3; i++) box(h, m.woodDark, 0.1, 0.62, 0.1, sd * 1.12, 1.55, 0.25 + i * 1.1);
  }
  // cargo (visible when hauling)
  const cargo = new THREE.Group();
  cargo.position.set(0, 1.3, 1.4);
  h.add(cargo);
  crate(cargo, m.wood, 1.0, -0.5, 0.45, -0.6, 0.15);
  crate(cargo, m.wood, 0.95, 0.55, 0.42, -0.5, -0.1);
  crate(cargo, m.woodDark, 0.9, 0, 0.4, 0.55, 0.35);
  crate(cargo, m.wood, 0.85, -0.45, 1.05, -0.4, 0.5);
  const sack = box(cargo, m.sandbag, 0.8, 0.4, 0.6, 0.55, 0.9, 0.5);
  sack.rotation.y = 0.4;
  cargo.visible = false;
  g.userData.cargo = cargo;
  // wheels (6)
  for (const [wx, wz] of [[-1.05, -1.75], [1.05, -1.75], [-1.05, 0.7], [1.05, 0.7], [-1.05, 1.9], [1.05, 1.9]]) {
    const w = cyl(h, m.tire, 0.5, 0.5, 0.34, wx, 0.5, wz, 12);
    w.rotation.z = Math.PI / 2;
    cyl(h, m.dark, 0.2, 0.2, 0.36, wx, 0.5, wz, 8).rotation.z = Math.PI / 2;
  }
  cyl(h, m.metalRust, 0.3, 0.3, 0.8, -0.72, 1.7, 2.5, 10);     // fuel drum on the bed
  const spare = cyl(h, m.tire, 0.4, 0.4, 0.22, 0.4, 1.62, 3.0, 12);
  spare.rotation.x = Math.PI / 2;
}

// ================================================================= COALITION VEHICLES
function vDozer(g, owner) {
  const m = mats(), A = accents(owner);
  const h = new THREE.Group();
  g.add(h);
  // tracks
  for (const sd of [-1, 1]) {
    box(h, m.track, 0.6, 0.75, 3.9, sd * 1.18, 0.55, 0.15);
    box(h, m.usaTanDark, 0.66, 0.16, 4.0, sd * 1.18, 1.0, 0.15);
    for (const sz of [-1.6, 1.9]) {
      const w = cyl(h, m.dark, 0.3, 0.3, 0.26, sd * 1.18, 0.42, sz + 0.15, 10);
      w.rotation.z = Math.PI / 2;
    }
  }
  // body + engine hood
  box(h, m.usaTan, 1.9, 0.85, 3.2, 0, 1.35, 0.2);
  const hood = box(h, m.usaTan, 1.6, 0.7, 1.4, 0, 1.45, -1.0);
  hood.rotation.x = -0.08;
  box(h, m.dark, 1.2, 0.35, 0.08, 0, 1.35, -1.72);             // radiator grille
  cyl(h, m.gun, 0.09, 0.11, 0.9, 0.55, 2.2, -0.7, 8);          // exhaust stack
  cyl(h, m.dark, 0.13, 0.13, 0.12, 0.55, 2.68, -0.7, 8);
  // cab
  box(h, m.usaTanDark, 1.5, 0.3, 1.4, 0, 1.95, 0.9);
  for (const [cx, cz] of [[-0.65, 0.3], [0.65, 0.3], [-0.65, 1.5], [0.65, 1.5]])
    box(h, m.cSteel, 0.12, 1.0, 0.12, cx, 2.55, cz);
  box(h, m.glass, 1.3, 0.75, 1.1, 0, 2.55, 0.9);               // glass cabin
  box(h, m.usaTan, 1.55, 0.14, 1.5, 0, 3.12, 0.9);             // roof
  box(h, m.redLens, 0.14, 0.14, 0.14, 0, 3.26, 0.9);           // beacon
  // blade + hydraulic arms
  const blade = new THREE.Group();
  blade.position.set(0, 0.9, -2.45);
  h.add(blade);
  const plate = box(blade, m.usaTanDark, 3.1, 1.05, 0.22, 0, 0.1, 0);
  plate.rotation.x = 0.16;
  const lip = box(blade, m.cSteel, 3.1, 0.3, 0.2, 0, -0.4, -0.12);
  lip.rotation.x = -0.28;
  box(blade, m.hazard, 3.12, 0.28, 0.06, 0, 0.52, 0.05);       // hazard top strip
  for (const sd of [-1, 1]) {
    strut(h, m.cSteel, sd * 0.95, 1.1, -1.4, sd * 1.25, 1.15, -2.35, 0.09, 6);
    strut(h, m.cSteel, sd * 0.6, 1.7, -1.2, sd * 0.8, 1.35, -2.3, 0.06, 6);
  }
  box(h, A.paint, 0.5, 0.24, 0.05, 0, 1.5, 1.66);              // team panel on the rear
  box(h, m.jerry, 0.4, 0.3, 0.2, -0.6, 1.85, 1.55);
}

function vTruckC(g, owner) {
  const m = mats(), A = accents(owner);
  const h = new THREE.Group();
  g.add(h);
  box(h, m.usaTanDark, 2.2, 0.4, 5.6, 0, 0.8, 0.1);            // chassis
  // cab-over
  box(h, m.usaTan, 2.15, 1.25, 1.7, 0, 1.75, -1.95);
  const shield = box(h, m.glass, 1.9, 0.6, 0.09, 0, 2.0, -2.78);
  shield.rotation.x = 0.1;
  box(h, m.dark, 1.7, 0.3, 0.06, 0, 1.25, -2.8);               // bumper grille
  for (const sd of [-1, 1]) {
    box(h, m.lightLens, 0.2, 0.14, 0.05, sd * 0.75, 1.3, -2.8);
    box(h, A.paint, 0.05, 0.5, 1.0, sd * 1.08, 1.6, -1.95);    // accent door panels
    box(h, m.dark, 0.04, 0.16, 0.1, sd * 1.12, 2.2, -2.6);     // mirrors
  }
  box(h, m.usaTan, 2.16, 0.12, 1.75, 0, 2.42, -1.95);          // cab roof
  cyl(h, m.gun, 0.07, 0.08, 1.0, -0.95, 2.6, -1.2, 8);         // exhaust stack
  // cargo bed + rails
  box(h, m.usaTanDark, 2.2, 0.28, 3.5, 0, 1.05, 1.15);
  for (const sd of [-1, 1]) box(h, m.usaTan, 0.09, 0.34, 3.5, sd * 1.06, 1.35, 1.15);
  box(h, m.usaTan, 2.12, 0.3, 0.09, 0, 1.35, 2.86);
  // supply crate stack (harvest cargo)
  const cargo = new THREE.Group();
  cargo.position.set(0, 1.2, 1.15);
  h.add(cargo);
  for (const [cx, cy, cz, ry] of [[-0.5, 0.45, -0.9, 0.1], [0.5, 0.45, -0.9, -0.15],
    [-0.5, 0.45, 0.15, 0.05], [0.5, 0.45, 0.2, 0.3], [0, 0.45, 1.1, 0.1], [0, 1.25, -0.4, 0.2]]) {
    const c = crate(cargo, m.cPanelLight, 1.0, cx, cy, cz, ry);
    box(cargo, m.cSteel, 1.04, 0.08, 0.2, cx, cy, cz).rotation.y = ry; // strap band
  }
  cargo.visible = false;
  g.userData.cargo = cargo;
  // wheels (6)
  for (const [wx, wz] of [[-1.0, -1.95], [1.0, -1.95], [-1.0, 0.6], [1.0, 0.6], [-1.0, 1.8], [1.0, 1.8]]) {
    const w = cyl(h, m.tire, 0.52, 0.52, 0.36, wx, 0.52, wz, 12);
    w.rotation.z = Math.PI / 2;
    cyl(h, m.cSteel, 0.2, 0.2, 0.38, wx, 0.52, wz, 8).rotation.z = Math.PI / 2;
  }
  box(h, m.usaTan, 2.2, 0.35, 0.3, 0, 0.65, -2.85);            // front bumper
}

function vCrusader(g, owner) {
  const m = mats(), A = accents(owner);
  const h = new THREE.Group();
  g.add(h);
  // hull
  box(h, m.usaTan, 2.9, 0.85, 5.3, 0, 1.1, 0.1);
  const glacis = box(h, m.usaTan, 2.8, 0.75, 1.5, 0, 1.25, -2.6);
  glacis.rotation.x = -0.55;
  const rear = box(h, m.usaTanDark, 2.7, 0.6, 0.9, 0, 1.1, 2.75);
  rear.rotation.x = 0.35;
  box(h, m.dark, 2.0, 0.25, 0.35, 0, 1.0, 3.05);               // exhaust louvres
  // tracks + skirts
  for (const sd of [-1, 1]) {
    box(h, m.track, 0.62, 0.8, 5.6, sd * 1.6, 0.62, 0.1);
    box(h, m.usaTanDark, 0.68, 0.35, 5.3, sd * 1.6, 1.15, 0.1);
    box(h, A.paint, 0.7, 0.14, 1.2, sd * 1.6, 1.36, -1.9);     // accent skirt tip
    for (const sz of [-2.6, 2.8]) {
      const w = cyl(h, m.dark, 0.32, 0.32, 0.26, sd * 1.6, 0.5, sz, 10);
      w.rotation.z = Math.PI / 2;
    }
    for (let i = 0; i < 5; i++) {
      const w = cyl(h, m.dark, 0.3, 0.3, 0.2, sd * 1.63, 0.4, -1.7 + i * 0.9, 10);
      w.rotation.z = Math.PI / 2;
    }
  }
  // angular NATO turret
  const turret = new THREE.Group();
  turret.position.set(0, 1.95, -0.25);
  g.add(turret);
  box(turret, m.usaTan, 2.15, 0.62, 2.8, 0, 0.31, 0.1);
  const cheekL = box(turret, m.usaTanDark, 0.85, 0.6, 1.1, -0.85, 0.32, -1.0);
  cheekL.rotation.y = 0.45;
  const cheekR = box(turret, m.usaTanDark, 0.85, 0.6, 1.1, 0.85, 0.32, -1.0);
  cheekR.rotation.y = -0.45;
  box(turret, m.usaTanDark, 1.5, 0.24, 1.7, 0, 0.72, 0.3);     // roof step
  cyl(turret, m.usaTanDark, 0.34, 0.38, 0.22, -0.5, 0.9, 0.2, 10); // cupola
  cyl(turret, m.gun, 0.025, 0.025, 0.7, -0.5, 1.0, -0.15, 6).rotation.x = Math.PI / 2 - 0.3; // M2
  box(turret, m.gun, 0.1, 0.12, 0.3, -0.5, 0.96, 0.05);
  // bustle rack with stowage
  box(turret, m.cSteel, 1.9, 0.1, 0.1, 0, 0.55, 1.6);
  box(turret, m.canvasBed, 1.5, 0.35, 0.5, 0, 0.42, 1.45);
  box(turret, m.jerry, 0.4, 0.28, 0.24, 0.75, 0.42, 1.35);
  box(turret, A.paint, 0.6, 0.3, 0.06, 0, 0.35, 1.72);         // accent ID panel
  // smoke launchers
  for (const sd of [-1, 1]) for (let i = 0; i < 3; i++) {
    const sm = cyl(turret, m.usaTanDark, 0.05, 0.05, 0.24, sd * (0.75 + i * 0.14), 0.45, -1.35 - i * 0.06, 6);
    sm.rotation.x = -1.1;
  }
  // main gun: mantlet, thermal sleeve, bore evacuator
  box(turret, m.dark, 0.75, 0.5, 0.5, 0, 0.25, -1.5);
  cyl(turret, m.gun, 0.1, 0.12, 3.6, 0, 0.28, -3.3, 10).rotation.x = Math.PI / 2;
  cyl(turret, m.usaTanDark, 0.15, 0.15, 1.1, 0, 0.28, -2.4, 10).rotation.x = Math.PI / 2;
  cyl(turret, m.gun, 0.17, 0.17, 0.5, 0, 0.28, -4.0, 10).rotation.x = Math.PI / 2;
  const ant = cyl(turret, m.dark, 0.014, 0.014, 1.6, 0.85, 1.4, 1.1, 5);
  ant.rotation.z = 0.1;
  g.userData.turret = turret;
  g.userData.muzzle = new THREE.Vector3(0, 0.28, -5.15);
}

function vHumvee(g, owner) {
  const m = mats(), A = accents(owner);
  const h = new THREE.Group();
  g.add(h);
  // wide flat body
  box(h, m.usaTan, 2.3, 0.62, 4.5, 0, 1.0, 0);
  const hood = box(h, m.usaTan, 2.2, 0.35, 1.35, 0, 1.32, -1.6);
  hood.rotation.x = -0.06;
  box(h, m.dark, 1.7, 0.35, 0.07, 0, 1.05, -2.28);             // grille
  for (const sd of [-1, 1]) box(h, m.lightLens, 0.2, 0.16, 0.05, sd * 0.8, 1.1, -2.28);
  box(h, A.paint, 1.0, 0.05, 0.7, 0, 1.52, -1.6);              // accent hood chevron
  // cabin — slanted windshield, thick pillars
  box(h, m.usaTan, 2.25, 0.72, 2.5, 0, 1.66, 0.35);
  const shield = box(h, m.glass, 1.8, 0.5, 0.08, 0, 1.85, -0.82);
  shield.rotation.x = 0.28;
  for (const sd of [-1, 1]) {
    box(h, m.glass, 0.05, 0.34, 0.85, sd * 1.14, 1.85, -0.1);  // side windows
    box(h, m.glass, 0.05, 0.34, 0.85, sd * 1.14, 1.85, 0.95);
    box(h, m.usaTanDark, 0.06, 0.6, 0.1, sd * 1.15, 1.66, 0.42); // door split
    box(h, m.dark, 0.04, 0.14, 0.1, sd * 1.2, 1.95, -0.75);    // mirrors
  }
  box(h, m.usaTan, 2.3, 0.14, 2.6, 0, 2.08, 0.35);             // roof
  box(h, m.usaTanDark, 2.2, 0.45, 0.8, 0, 1.35, 2.05);         // rear deck
  const spare = cyl(h, m.tire, 0.42, 0.42, 0.24, 0, 1.35, 2.5, 12);
  spare.rotation.x = Math.PI / 2;
  // bull bar + winch
  for (const by of [0.85, 1.15]) cyl(h, m.dark, 0.04, 0.04, 1.9, 0, by, -2.4, 8).rotation.z = Math.PI / 2;
  box(h, m.gun, 0.5, 0.2, 0.2, 0, 0.75, -2.32);
  // wheels
  for (const [wx, wz] of [[-1.05, -1.5], [1.05, -1.5], [-1.05, 1.5], [1.05, 1.5]]) {
    const w = cyl(h, m.tire, 0.5, 0.5, 0.36, wx, 0.5, wz, 12);
    w.rotation.z = Math.PI / 2;
    cyl(h, m.cSteel, 0.2, 0.2, 0.38, wx, 0.5, wz, 8).rotation.z = Math.PI / 2;
  }
  const ant = cyl(h, m.dark, 0.012, 0.012, 1.4, 1.0, 2.7, 1.9, 5);
  ant.rotation.z = -0.1;
  // roof gun ring + M2 turret
  const turret = new THREE.Group();
  turret.position.set(0, 2.16, 0.25);
  g.add(turret);
  cyl(turret, m.usaTanDark, 0.5, 0.55, 0.16, 0, 0, 0, 12);
  box(turret, m.usaTanDark, 0.8, 0.4, 0.06, 0, 0.35, -0.35);   // gun shield
  cyl(turret, m.gun, 0.05, 0.06, 0.45, 0, 0.2, 0, 8);
  box(turret, m.gun, 0.14, 0.16, 0.8, 0, 0.42, -0.25);
  cyl(turret, m.gun, 0.03, 0.03, 0.9, 0, 0.44, -1.05, 8).rotation.x = Math.PI / 2;
  cyl(turret, m.gun, 0.05, 0.05, 0.14, 0, 0.44, -1.48, 8).rotation.x = Math.PI / 2;
  box(turret, m.dark, 0.14, 0.12, 0.18, 0.15, 0.4, -0.15);     // ammo box
  g.userData.turret = turret;
  g.userData.muzzle = new THREE.Vector3(0, 0.44, -1.55);
}

function vTomahawk(g, owner) {
  const m = mats(), A = accents(owner);
  const h = new THREE.Group();
  g.add(h);
  // tracked chassis
  for (const sd of [-1, 1]) {
    box(h, m.track, 0.58, 0.68, 4.9, sd * 1.25, 0.5, 0);
    box(h, m.usaTanDark, 0.64, 0.18, 5.0, sd * 1.25, 0.92, 0);
    for (const sz of [-2.1, 2.1]) {
      const w = cyl(h, m.dark, 0.28, 0.28, 0.24, sd * 1.25, 0.4, sz, 10);
      w.rotation.z = Math.PI / 2;
    }
  }
  box(h, m.usaTan, 2.4, 0.7, 4.9, 0, 1.25, 0);                 // hull
  // crew cab up front
  box(h, m.usaTan, 2.3, 0.75, 1.5, 0, 1.95, -1.55);
  const shield = box(h, m.glass, 1.9, 0.42, 0.08, 0, 2.1, -2.28);
  shield.rotation.x = 0.2;
  box(h, m.glass, 0.06, 0.3, 0.9, -1.16, 2.05, -1.5);
  box(h, m.glass, 0.06, 0.3, 0.9, 1.16, 2.05, -1.5);
  box(h, A.paint, 2.32, 0.14, 0.5, 0, 2.38, -1.2);             // accent cab stripe
  // launcher turret: raised tube on a hinged cradle
  const turret = new THREE.Group();
  turret.position.set(0, 1.7, 0.9);
  g.add(turret);
  box(turret, m.usaTanDark, 1.9, 0.35, 2.2, 0, 0.05, 0);       // ring platform
  const cradle = new THREE.Group();
  cradle.position.set(0, 0.25, 0.85);
  cradle.rotation.x = -0.9;                                    // elevation ~52°
  turret.add(cradle);
  box(cradle, m.cPanelLight, 1.25, 1.1, 3.3, 0, 0, -0.9);      // launch box
  box(cradle, m.usaTanDark, 1.3, 1.15, 0.5, 0, 0, 0.5);        // hinge block
  cyl(cradle, m.cWhite, 0.42, 0.42, 0.12, 0, 0, -2.58, 14).rotation.x = Math.PI / 2; // tube cap
  cyl(cradle, m.dark, 0.34, 0.34, 0.1, 0, 0, -2.62, 14).rotation.x = Math.PI / 2;
  box(cradle, m.hazard, 1.27, 0.2, 0.35, 0, -0.48, -2.4);      // hazard lip
  box(cradle, A.paint, 1.27, 0.2, 1.2, 0, 0.5, -1.4);          // accent spine
  // hydraulic rams
  for (const sd of [-1, 1])
    strut(turret, m.cSteel, sd * 0.8, 0.1, -0.7, sd * 0.55, 1.15, 0.15, 0.07, 6);
  g.userData.turret = turret;
  // muzzle at raised tube mouth: cradle pivot (0,0.25,0.85), elev -0.9
  g.userData.muzzle = new THREE.Vector3(0, 0.25 + Math.sin(0.9) * 2.6, 0.85 - Math.cos(0.9) * 2.6);
  box(h, m.jerry, 0.5, 0.3, 0.3, -0.85, 1.72, 2.15);
  const ant = cyl(h, m.dark, 0.014, 0.014, 1.5, 1.0, 2.4, 2.2, 5);
  ant.rotation.z = 0.12;
}

function vComanche(g, owner) {
  const m = mats(), A = accents(owner);
  const tilt = new THREE.Group();
  tilt.rotation.x = -0.06;                                     // slight nose-down attitude
  g.add(tilt);
  // fuselage — faceted stealth look
  box(tilt, m.usaTan, 1.05, 1.0, 2.6, 0, 0.1, -0.3);
  const noseTop = box(tilt, m.usaTan, 0.9, 0.7, 1.4, 0, 0.05, -1.9);
  noseTop.rotation.x = 0.12;
  const noseTip = box(tilt, m.usaTanDark, 0.6, 0.45, 0.8, 0, -0.08, -2.6);
  noseTip.rotation.x = 0.2;
  const canopy = box(tilt, m.glass, 0.72, 0.5, 1.5, 0, 0.55, -1.35);
  canopy.rotation.x = 0.22;
  for (const sd of [-1, 1]) {                                  // hull cheeks
    const cheek = box(tilt, m.usaTanDark, 0.4, 0.8, 2.2, sd * 0.6, 0.05, -0.3);
    cheek.rotation.z = sd * 0.35;
  }
  // stub wings + rocket pods
  box(tilt, m.usaTan, 3.5, 0.14, 0.85, 0, 0.25, 0.15);
  for (const sd of [-1, 1]) {
    const pod = cyl(tilt, m.usaTanDark, 0.27, 0.27, 1.25, sd * 1.55, 0.0, 0.15, 10);
    pod.rotation.x = Math.PI / 2;
    cyl(tilt, m.dark, 0.22, 0.22, 0.08, sd * 1.55, 0.0, -0.5, 10).rotation.x = Math.PI / 2;
    box(tilt, A.paint, 0.3, 0.06, 0.85, sd * 1.62, 0.34, 0.15); // accent wingtip
  }
  // tail boom + fenestron
  const boom = box(tilt, m.usaTan, 0.5, 0.5, 2.3, 0, 0.25, 2.2);
  boom.rotation.x = -0.04;
  const fin = box(tilt, m.usaTanDark, 0.12, 1.15, 0.75, 0, 0.75, 3.3);
  fin.rotation.x = 0.15;
  box(tilt, A.paint, 0.14, 0.4, 0.5, 0, 0.9, 3.32);            // accent tail band
  const tailRotorMount = new THREE.Group();
  tailRotorMount.position.set(0.1, 0.5, 3.25);
  tailRotorMount.rotation.z = Math.PI / 2;                     // disc stands vertical
  tilt.add(tailRotorMount);
  const tailRotor = new THREE.Group();
  tailRotorMount.add(tailRotor);
  cyl(tailRotor, m.dark, 0.09, 0.09, 0.12, 0, 0, 0, 8);
  for (let i = 0; i < 4; i++) {
    const bl = box(tailRotor, m.gun, 0.09, 0.02, 0.62, 0, 0, 0);
    bl.rotation.y = (i / 4) * Math.PI * 2;
    bl.translateZ(-0.31);
  }
  g.userData.tailRotor = tailRotor;
  // horizontal stabilizer
  box(tilt, m.usaTanDark, 1.15, 0.08, 0.4, 0, 0.42, 3.0);
  // engine humps + exhaust
  box(tilt, m.usaTanDark, 0.9, 0.35, 1.3, 0, 0.72, 0.35);
  cyl(tilt, m.dark, 0.12, 0.14, 0.4, 0.42, 0.72, 1.05, 8).rotation.x = Math.PI / 2 - 0.4;
  cyl(tilt, m.dark, 0.12, 0.14, 0.4, -0.42, 0.72, 1.05, 8).rotation.x = Math.PI / 2 - 0.4;
  // main rotor — sim spins userData.rotor
  const rotor = new THREE.Group();
  rotor.position.set(0, 1.05, -0.1);
  tilt.add(rotor);
  cyl(rotor, m.gun, 0.16, 0.2, 0.3, 0, 0, 0, 8);
  for (let i = 0; i < 5; i++) {
    const bl = box(rotor, m.gun, 0.22, 0.035, 2.7, 0, 0.06, 0);
    bl.rotation.y = (i / 5) * Math.PI * 2;
    bl.translateZ(-1.35);
    bl.rotation.x += 0.02;
  }
  g.userData.rotor = rotor;
  // chin gun turret
  const turret = new THREE.Group();
  turret.position.set(0, -0.5, -2.0);
  tilt.add(turret);
  cyl(turret, m.gun, 0.14, 0.16, 0.25, 0, 0.05, 0, 8);
  box(turret, m.gun, 0.16, 0.16, 0.5, 0, -0.08, -0.15);
  cyl(turret, m.gun, 0.035, 0.035, 0.55, 0, -0.08, -0.6, 8).rotation.x = Math.PI / 2;
  g.userData.turret = turret;
  g.userData.muzzle = new THREE.Vector3(0, -0.08, -0.9);
  // skids
  for (const sd of [-1, 1]) {
    strut(tilt, m.gun, sd * 0.45, -0.5, -1.2, sd * 0.55, -0.85, -1.1, 0.04, 6);
    strut(tilt, m.gun, sd * 0.45, -0.5, 0.6, sd * 0.55, -0.85, 0.5, 0.04, 6);
    box(tilt, m.gun, 0.07, 0.07, 2.4, sd * 0.55, -0.88, -0.3);
  }
}

// ================================================================= COALITION BUILDINGS
function bCcC(g, owner) {
  const m = mats(), A = accents(owner);
  box(g, m.conc, 21, 0.5, 21, 0, 0.25, 0).receiveShadow = true;
  box(g, m.hazard, 5.5, 0.2, 0.4, 0, 0.52, -9.2);              // apron entry strip
  // main armored block with sloped sides
  box(g, m.cPanel, 15, 4.6, 12.5, 0, 2.75, 0.8);
  for (const sd of [-1, 1]) {
    const slope = box(g, m.cPanelDark, 2.4, 4.8, 12.5, sd * 8.0, 2.4, 0.8);
    slope.rotation.z = sd * 0.32;
  }
  // second tier + blue glass command strip
  box(g, m.cPanelLight, 10.5, 3.2, 8.5, 0, 6.9, 1.6);
  box(g, m.cGlass, 9.0, 1.0, 0.2, 0, 7.3, -2.72);
  box(g, m.cGlass, 0.2, 1.0, 6.0, -5.32, 7.3, 1.6);
  box(g, m.cGlass, 0.2, 1.0, 6.0, 5.32, 7.3, 1.6);
  box(g, m.cPanelDark, 10.9, 0.4, 8.9, 0, 8.65, 1.6);          // roof cap
  box(g, A.paint, 10.9, 0.35, 0.3, 0, 5.4, -4.0);              // accent band over tier 1 front
  // radome on the right roof
  cyl(g, m.cSteel, 2.0, 2.3, 0.9, 4.6, 9.3, 3.2, 14);
  dome(g, m.cWhite, 2.4, 4.6, 9.7, 3.2, 18, 12);
  // rotating radar array on a lattice mast (sim spins userData.spin)
  const mastX = -3.6, mastZ = 3.4;
  cyl(g, m.cSteel, 0.14, 0.22, 3.4, mastX, 10.5, mastZ, 8);
  strut(g, m.cSteel, mastX, 10.6, mastZ, mastX - 1.2, 8.85, mastZ - 1.0, 0.05, 5);
  strut(g, m.cSteel, mastX, 10.6, mastZ, mastX + 1.2, 8.85, mastZ - 1.0, 0.05, 5);
  strut(g, m.cSteel, mastX, 10.6, mastZ, mastX, 8.85, mastZ + 1.4, 0.05, 5);
  const radar = new THREE.Group();
  radar.position.set(mastX, 12.4, mastZ);
  g.add(radar);
  cyl(radar, m.cSteel, 0.2, 0.24, 0.5, 0, -0.2, 0, 8);
  const panel = box(radar, m.cWhite, 3.4, 1.0, 0.14, 0, 0.3, 0);
  panel.rotation.x = -0.14;
  box(radar, m.cSteel, 3.4, 0.14, 0.3, 0, -0.22, 0);
  g.userData.spin = radar;
  // antenna farm + small dish
  for (const [ax, az, ah] of [[2.2, 5.2, 2.6], [3.3, 5.0, 1.8], [-1.2, 5.4, 2.2]])
    cyl(g, m.dark, 0.02, 0.035, ah, ax, 8.85 + ah / 2, az, 5);
  const dish = new THREE.Mesh(sphGeo(1.1, 14, 8, Math.PI / 3), m.cWhite);
  dish.rotation.x = Math.PI * 0.78; dish.rotation.z = 0.4;
  dish.position.set(-6.3, 5.9, 4.6);
  dish.castShadow = true;
  g.add(dish);
  // entrance: blast door + hazard jambs + ramp
  box(g, m.cSteel, 4.2, 3.2, 0.4, 0, 1.85, -5.6);
  box(g, m.dark, 0.14, 2.9, 0.5, 0, 1.8, -5.66);
  box(g, m.hazard, 0.5, 3.6, 0.5, -2.5, 2.05, -5.66);
  box(g, m.hazard, 0.5, 3.6, 0.5, 2.5, 2.05, -5.66);
  box(g, m.cPanelDark, 6.2, 0.9, 0.6, 0, 4.15, -5.7);          // door lintel
  const ramp = box(g, m.conc, 6.0, 0.4, 3.4, 0, 0.45, -7.4);
  ramp.rotation.x = 0.1;
  // accent wing banners flanking the entrance
  for (const sd of [-1, 1]) {
    box(g, A.paint, 2.2, 2.8, 0.16, sd * 4.6, 3.0, -5.55);
    box(g, m.cWhite, 2.3, 0.35, 0.18, sd * 4.6, 4.55, -5.56);
  }
  // corner pylons with warning lights
  for (const [px, pz] of [[-9.4, -9.4], [9.4, -9.4], [-9.4, 9.4], [9.4, 9.4]]) {
    box(g, m.cPanelDark, 1.6, 3.6, 1.6, px, 1.8, pz);
    box(g, m.cSteel, 1.8, 0.3, 1.8, px, 3.7, pz);
    box(g, m.redLens, 0.22, 0.22, 0.22, px, 4.0, pz);
  }
  // roof clutter + flag
  acUnit(g, 3.2, 5.05, 4.9, 1.2);
  acUnit(g, -5.4, 5.05, -1.8, 1);
  cyl(g, m.cSteel, 0.3, 0.34, 1.4, 6.1, 5.75, -2.2, 10);       // roof vent
  box(g, m.cPanelDark, 2.6, 0.5, 1.4, -3.5, 5.3, -3.4);        // duct run
  flagPole(g, owner, 8.9, -8.0, 10, 3.2, 1.9);
  sandbagRow(g, -7.6, 0.5, -7.6, 0.5, 4, 2);
}

function bReactor(g, owner) {
  const m = mats(), A = accents(owner);
  box(g, m.conc, 11.5, 0.5, 11.5, 0, 0.25, 0).receiveShadow = true;
  box(g, m.hazard, 11.5, 0.22, 0.4, 0, 0.55, -5.6);
  // containment drum + cap
  cyl(g, m.cPanel, 3.1, 3.3, 3.4, 0, 2.2, -1.4, 18);
  const cap = new THREE.Mesh(sphGeo(3.1, 18, 10, Math.PI / 2), m.cWhite);
  cap.scale.y = 0.55;
  cap.position.set(0, 3.9, -1.4);
  cap.castShadow = true;
  g.add(cap);
  cyl(g, m.cSteel, 0.5, 0.6, 1.1, 0, 5.2, -1.4, 10);
  box(g, m.redLens, 0.16, 0.16, 0.16, 0, 5.85, -1.4);
  // glowing core vents around the drum
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2 + 0.26;
    const v = box(g, m.reactorGlow, 0.5, 1.7, 0.18, Math.cos(a) * 3.24, 2.1, -1.4 + Math.sin(a) * 3.24);
    v.rotation.y = -a + Math.PI / 2;
  }
  const ring = new THREE.Mesh(torGeo(2.4, 0.1, 8, 24), m.reactorGlow);
  ring.rotation.x = Math.PI / 2;
  ring.position.set(0, 4.35, -1.4);
  g.add(ring);
  box(g, A.paint, 1.4, 0.7, 0.2, 0, 1.4, -4.65);               // accent placard on drum front
  // twin cooling stacks at the rear
  for (const sd of [-1, 1]) {
    cyl(g, m.cWhite, 1.15, 1.6, 5.4, sd * 3.1, 2.7, 3.3, 16);
    cyl(g, m.cSteel, 1.2, 1.1, 0.5, sd * 3.1, 5.6, 3.3, 16);
    cyl(g, m.dark, 1.0, 1.0, 0.1, sd * 3.1, 5.7, 3.3, 16);
    // feed pipe drum→stack
    const p = cyl(g, m.cSteel, 0.28, 0.28, 3.2, sd * 1.7, 1.5, 1.2, 8);
    p.rotation.x = Math.PI / 2 - 0.35;
    p.rotation.z = sd * 0.5;
  }
  // transformer + insulators + cabling
  box(g, m.cSteel, 2.2, 1.5, 1.3, 3.6, 1.15, -3.4);
  for (let i = 0; i < 3; i++) {
    cyl(g, m.cWhite, 0.09, 0.12, 0.7, 2.9 + i * 0.7, 2.35, -3.4, 6);
    strut(g, m.dark, 2.9 + i * 0.7, 2.7, -3.4, 1.6 + i * 0.5, 2.6, -2.5, 0.024, 5);
  }
  drum(g, m.cSteel, -3.9, -3.9, 0.4, 1.0);
  box(g, m.cPanelDark, 1.8, 1.2, 1.4, -3.7, 1.0, -2.4);        // control shed
  box(g, m.cGlass, 0.9, 0.4, 0.08, -3.7, 1.3, -3.14);
}

function bBarracksC(g, owner) {
  const m = mats(), A = accents(owner);
  box(g, m.conc, 13.5, 0.4, 11.5, 0, 0.2, 0).receiveShadow = true;
  // main prefab hall
  box(g, m.cPanel, 9.6, 3.2, 6.8, -1.2, 2.0, 0.6);
  const roofL = box(g, m.cPanelDark, 5.2, 0.2, 7.6, -3.55, 3.9, 0.6);
  roofL.rotation.z = 0.18;
  const roofR = box(g, m.cPanelDark, 5.2, 0.2, 7.6, 1.15, 3.9, 0.6);
  roofR.rotation.z = -0.18;
  box(g, m.cSteel, 0.3, 0.3, 7.7, -1.2, 4.36, 0.6);            // ridge cap
  // door + accent canopy + windows
  box(g, m.cSteel, 1.6, 2.4, 0.2, -1.2, 1.6, -2.85);
  box(g, m.dark, 0.08, 2.1, 0.24, -1.2, 1.55, -2.9);
  const canopy = box(g, A.paint, 2.6, 0.12, 1.2, -1.2, 2.95, -3.4);
  canopy.rotation.x = 0.14;
  cyl(g, m.cSteel, 0.05, 0.05, 1.1, -2.35, 2.35, -3.9, 6);
  cyl(g, m.cSteel, 0.05, 0.05, 1.1, -0.05, 2.35, -3.9, 6);
  for (const wx of [-4.4, 1.6]) {
    box(g, m.cGlass, 1.5, 0.85, 0.15, wx, 2.3, -2.85);
    box(g, m.cWhite, 1.8, 0.14, 0.26, wx, 1.78, -2.86);
  }
  box(g, m.cGlass, 0.15, 0.85, 3.6, -6.08, 2.3, 0.6);          // side glazing
  // bunk annex
  box(g, m.cPanelLight, 3.6, 2.5, 4.6, 4.6, 1.55, 1.8);
  const aroof = box(g, m.cPanelDark, 4.2, 0.16, 5.2, 4.75, 2.95, 1.8);
  aroof.rotation.z = -0.1;
  box(g, m.dark, 1.1, 1.6, 0.14, 4.6, 1.1, -0.55);
  // flag + sandbags + PT gear
  flagPole(g, owner, 5.6, -4.2, 9, 3.0, 1.8);
  sandbagRow(g, -5.2, 0.4, -4.2, 0.2, 4, 2);
  crate(g, m.cPanelLight, 1.1, 3.4, 0.9, -3.4, 0.3);
  crate(g, m.wood, 0.95, 4.5, 0.85, -2.6, 0.8);
  // water tank on a frame
  cyl(g, m.cWhite, 0.8, 0.8, 1.6, -5.2, 2.6, 4.2, 12);
  for (const [lx, lz] of [[-5.8, 3.7], [-4.6, 3.7], [-5.8, 4.7], [-4.6, 4.7]])
    cyl(g, m.cSteel, 0.06, 0.06, 1.8, lx, 0.9, lz, 6);
  acUnit(g, 1.6, 4.1, 2.4, 0.8);
}

function bSupplyC(g, owner) {
  const m = mats(), A = accents(owner);
  box(g, m.conc, 17.5, 0.4, 15.5, 0, 0.2, 0).receiveShadow = true;
  // warehouse
  box(g, m.cPanel, 10.5, 4.8, 9.0, -3.0, 2.6, 1.8);
  const roof = box(g, m.cPanelDark, 11.3, 0.22, 9.8, -3.0, 5.15, 1.8);
  roof.rotation.x = 0.06;
  box(g, A.paint, 10.7, 0.5, 0.2, -3.0, 4.45, -2.72);          // accent eave band
  // open receiving bay
  box(g, m.dark, 5.4, 3.4, 0.3, -3.4, 1.9, -2.78);
  box(g, m.hazard, 0.45, 3.8, 0.4, -6.3, 2.1, -2.8);
  box(g, m.hazard, 0.45, 3.8, 0.4, -0.5, 2.1, -2.8);
  box(g, m.cSteel, 6.4, 0.6, 0.4, -3.4, 4.0, -2.8);
  // side roller door
  box(g, m.corr, 0.2, 2.8, 4.0, 2.32, 1.7, 2.2);
  // crane gantry over the crate yard
  const gz = 0.2;
  for (const sd of [-1, 1]) {
    strut(g, m.cSteel, 4.2, 0, sd * 4.4 + gz, 5.4, 5.2, sd * 1.6 + gz, 0.14, 8);
    strut(g, m.cSteel, 7.6, 0, sd * 4.4 + gz, 6.4, 5.2, sd * 1.6 + gz, 0.14, 8);
  }
  box(g, m.cSteel, 0.5, 0.5, 7.4, 5.9, 5.4, gz);               // gantry beam
  box(g, m.hazard, 0.52, 0.24, 7.4, 5.9, 5.06, gz);
  const trolley = box(g, m.cSteel, 0.7, 0.4, 0.8, 5.9, 5.1, -1.4);
  strut(g, m.dark, 5.9, 4.9, -1.4, 5.9, 3.3, -1.4, 0.03, 5);
  const hook = box(g, m.gold, 0.16, 0.3, 0.1, 5.9, 3.15, -1.4);
  // supply crates under the crane (GZH gold crates)
  for (const [cx, cy, cz, ry] of [[5.2, 0.75, 0.6, 0.2], [6.6, 0.75, 0.9, -0.1], [5.9, 0.75, 2.2, 0.4],
    [5.9, 1.85, 1.2, 0.15], [4.9, 0.7, 3.4, 0.7], [7.0, 0.7, 2.9, 0.1]]) {
    crate(g, m.cPanelLight, 1.5, cx, cy, cz, ry);
    box(g, m.gold, 1.54, 0.1, 0.3, cx, cy, cz).rotation.y = ry;
  }
  // marked truck apron in front of the bay
  box(g, m.hazard, 0.45, 0.14, 6.5, -6.6, 0.44, 4.2);
  box(g, m.hazard, 0.45, 0.14, 6.5, -0.2, 0.44, 4.2);
  decal(g, m.stainMat, 1.4, -3.4, 4.6, 0.47);
  decal(g, m.stainMat, 0.9, -4.6, 6.0, 0.47);
  crate(g, m.cPanelLight, 1.4, 1.6, 0.9, 5.9, 0.4);
  crate(g, m.wood, 1.1, 2.9, 0.8, 6.3, 0.9);
  // dock clutter
  tireTorus(g, 7.9, 0.25, -1.8);
  drum(g, m.green, 8.0, -3.2);
  crate(g, m.wood, 1.1, 1.4, 0.85, -5.4, 0.5);
  acUnit(g, -6.6, 5.35, 4.0, 1);
  flagPole(g, owner, -8.2, -6.6, 8, 2.6, 1.5);
}

function bFactoryC(g, owner) {
  const m = mats(), A = accents(owner);
  box(g, m.conc, 19.5, 0.5, 17.5, 0, 0.25, 0).receiveShadow = true;
  // assembly hall
  box(g, m.cPanel, 15.5, 6.4, 12.5, 0, 3.6, 1.6);
  box(g, m.cPanelDark, 16.1, 0.5, 13.1, 0, 7.05, 1.6);
  // raised spine + glowing skylight strip
  box(g, m.cPanelLight, 15.7, 1.3, 4.6, 0, 7.85, 1.6);
  box(g, m.cGlass, 15.2, 0.6, 0.18, 0, 7.9, -0.72);
  box(g, m.cPanelDark, 16.0, 0.3, 4.9, 0, 8.6, 1.6);
  // open vehicle bay
  box(g, m.dark, 7.4, 4.9, 0.4, -1.4, 2.8, -4.68);
  box(g, m.hazard, 8.4, 0.55, 0.5, -1.4, 5.5, -4.7);
  box(g, m.hazard, 0.55, 5.2, 0.5, -5.4, 2.85, -4.7);
  box(g, m.hazard, 0.55, 5.2, 0.5, 2.6, 2.85, -4.7);
  box(g, A.paint, 8.5, 0.7, 0.3, -1.4, 6.3, -4.62);            // accent fascia
  // gantry crane rails running out over the apron
  for (const sd of [-4.6, 1.8]) {
    box(g, m.cSteel, 0.35, 0.45, 6.0, sd, 5.9, -6.4);
    strut(g, m.cSteel, sd, 0, -8.9, sd, 5.75, -8.9, 0.13, 8);
  }
  box(g, m.cSteel, 6.9, 0.45, 0.5, -1.4, 6.05, -7.6);
  const chain = strut(g, m.dark, -2.4, 5.85, -7.6, -2.4, 3.9, -7.6, 0.03, 5);
  box(g, m.gold, 0.18, 0.34, 0.1, -2.4, 3.7, -7.6);
  // engine on a pallet under the hook
  box(g, m.cSteel, 1.3, 0.9, 1.0, -2.4, 0.95, -7.6);
  box(g, m.wood, 1.7, 0.2, 1.4, -2.4, 0.4, -7.6);
  // side office with glass
  box(g, m.cPanelLight, 3.6, 3.1, 5.4, 9.4, 1.85, -1.0);
  box(g, m.cGlass, 0.16, 0.8, 4.2, 11.25, 2.4, -1.0);
  box(g, m.cGlass, 2.6, 0.8, 0.16, 9.4, 2.4, -3.75);
  box(g, m.cPanelDark, 4.0, 0.2, 5.8, 9.4, 3.5, -1.0);
  // stacks + vents
  cyl(g, m.cSteel, 0.5, 0.62, 3.4, 5.6, 8.9, 4.6, 10);
  cyl(g, m.dark, 0.56, 0.56, 0.2, 5.6, 10.6, 4.6, 10);
  cyl(g, m.cSteel, 0.32, 0.4, 2.2, 4.2, 8.3, 5.4, 8);
  for (let i = 0; i < 3; i++) cyl(g, m.cSteel, 0.4, 0.44, 0.7, -4.5 + i * 2.4, 7.6, 4.6, 8);
  // apron dressing
  decal(g, m.stainMat, 1.6, -1.2, -7.2, 0.53);
  tireTorus(g, -7.9, 0.25, -6.4);
  drum(g, m.metalDark, 8.4, -6.6);
  drum(g, m.green, 7.6, -7.3);
  crate(g, m.cPanelLight, 1.3, 8.6, 0.9, 3.9, 0.3);
  flagPole(g, owner, -9.0, 7.6, 9, 2.8, 1.6);
}

function bAirfield(g, owner) {
  const m = mats(), A = accents(owner);
  box(g, m.conc, 21.5, 0.4, 15.5, 0, 0.2, 0).receiveShadow = true;
  // hangar with barrel roof (open to -Z)
  const hx = -5.6;
  box(g, m.cPanel, 8.6, 3.4, 9.6, hx, 1.7, 1.6);
  const vaultMount = new THREE.Group();
  vaultMount.position.set(hx, 3.4, 1.6);
  vaultMount.rotation.y = Math.PI / 2;              // vault axis along Z
  g.add(vaultMount);
  const vault = new THREE.Mesh(cylGeo(4.32, 4.32, 9.6, 14, false, 0, Math.PI), m.cPanelLight);
  vault.rotation.z = Math.PI / 2;                   // curve bulges up
  vault.castShadow = vault.receiveShadow = true;
  vaultMount.add(vault);
  box(g, m.dark, 7.0, 3.6, 0.3, hx, 1.85, -3.1);               // hangar maw
  box(g, m.hazard, 8.8, 0.5, 0.4, hx, 3.75, -3.2);
  box(g, A.paint, 8.8, 0.35, 0.35, hx, 4.15, -3.2);            // accent brow
  box(g, m.cSteel, 1.0, 4.0, 0.5, hx - 4.3, 2.0, -3.2);
  box(g, m.cSteel, 1.0, 4.0, 0.5, hx + 4.3, 2.0, -3.2);
  // helipad
  decal(g, m.pad, 4.4, 5.2, 0.6, 0.44);
  cyl(g, m.conc, 4.7, 4.9, 0.16, 5.2, 0.44, 0.6, 26);
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
    box(g, m.lightLens, 0.22, 0.18, 0.22, 5.2 + Math.cos(a) * 4.5, 0.62, 0.6 + Math.sin(a) * 4.5);
  }
  // control hut + rotating dish
  box(g, m.cPanelLight, 3.4, 2.8, 3.2, 8.6, 1.7, 5.6);
  box(g, m.cGlass, 2.6, 0.8, 0.16, 8.6, 2.4, 3.95);
  box(g, m.cPanelDark, 3.8, 0.2, 3.6, 8.6, 3.2, 5.6);
  const radar = new THREE.Group();
  radar.position.set(8.6, 3.9, 5.6);
  g.add(radar);
  cyl(radar, m.cSteel, 0.1, 0.14, 1.1, 0, -0.4, 0, 6);
  const rd = new THREE.Mesh(sphGeo(0.75, 12, 6, Math.PI / 3), m.cWhite);
  rd.rotation.x = Math.PI * 0.62;
  rd.position.y = 0.25;
  rd.castShadow = true;
  radar.add(rd);
  g.userData.spin = radar;
  // windsock
  cyl(g, m.cSteel, 0.05, 0.07, 4.2, -1.2, 2.1, 6.4, 6);
  const sock = new THREE.Mesh(cylGeo(0.3, 0.12, 1.6, 8, true), A.paint);
  sock.rotation.z = Math.PI / 2 - 0.18;
  sock.position.set(-2.1, 4.0, 6.4);
  sock.castShadow = true;
  g.add(sock);
  // landing light row + fuel point
  for (let i = 0; i < 5; i++) box(g, m.lightLens, 0.18, 0.14, 0.18, -8.4 + i * 4.0, 0.5, -7.0);
  drum(g, m.green, 9.4, -0.8);
  drum(g, m.metalRust, 9.9, -1.9);
  box(g, m.cSteel, 1.3, 0.7, 0.8, 9.3, 0.75, -3.4);            // pump cart
  strut(g, m.dark, 9.3, 0.9, -3.0, 7.4, 0.3, -1.6, 0.05, 5);   // hose
  crate(g, m.cPanelLight, 1.2, -9.6, 0.85, 5.9, 0.4);
  flagPole(g, owner, 10.2, 7.0, 8, 2.6, 1.5);
}

function bPatriot(g, owner) {
  const m = mats(), A = accents(owner);
  box(g, m.conc, 9.5, 0.5, 9.5, 0, 0.25, 0).receiveShadow = true;
  for (const [px, pz] of [[-4.3, -4.3], [4.3, -4.3], [-4.3, 4.3], [4.3, 4.3]])
    box(g, m.hazard, 0.9, 0.3, 0.9, px, 0.62, pz);
  // phased-array radar trailer at the rear
  const rad = new THREE.Group();
  rad.position.set(-2.6, 0, 2.9);
  rad.rotation.y = 0.35;
  g.add(rad);
  box(rad, m.cPanelLight, 2.6, 0.5, 1.9, 0, 1.0, 0);
  const face = box(rad, m.cWhite, 2.3, 2.5, 0.35, 0, 2.3, 0.35);
  face.rotation.x = 0.4;
  const grid = box(rad, m.cSteel, 1.8, 1.9, 0.06, 0, 2.35, 0.6);
  grid.rotation.x = 0.4;
  for (const [lx, lz] of [[-1.0, -0.7], [1.0, -0.7], [-1.0, 0.7], [1.0, 0.7]])
    cyl(rad, m.cSteel, 0.08, 0.1, 1.0, lx, 0.5, lz, 6);
  // launcher pedestal + turret
  cyl(g, m.cSteel, 1.0, 1.2, 1.1, 1.4, 0.85, -0.9, 14);
  const turret = new THREE.Group();
  turret.position.set(1.4, 1.5, -0.9);
  g.add(turret);
  box(turret, m.cPanelDark, 1.6, 0.5, 1.8, 0, 0.1, 0.1);
  const cluster = new THREE.Group();
  cluster.position.set(0, 0.5, 0.35);
  cluster.rotation.x = -0.62;                                  // elevation
  turret.add(cluster);
  for (const [tx, ty] of [[-0.52, -0.5], [0.52, -0.5], [-0.52, 0.5], [0.52, 0.5]]) {
    box(cluster, m.cWhite, 0.88, 0.88, 2.9, tx * 1.05, ty * 0.47, 0);
    box(cluster, m.dark, 0.72, 0.72, 0.1, tx * 1.05, ty * 0.47, -1.48);
    box(cluster, A.paint, 0.9, 0.12, 0.5, tx * 1.05, ty * 0.47 + 0.39, -1.0);
  }
  box(cluster, m.cSteel, 2.3, 1.15, 0.4, 0, 0, 1.6);           // rear blast doors
  strut(turret, m.cSteel, 0, 0.15, 0.9, 0, 0.9, 1.35, 0.07, 6); // elevation ram
  // muzzle: cluster pivot (0,0.5,0.35), elev -0.62, tube len ~1.6 fwd
  g.userData.turret = turret;
  g.userData.muzzle = new THREE.Vector3(0, 0.5 + Math.sin(0.62) * 1.6, 0.35 - Math.cos(0.62) * 1.6);
  // generator + cable + crew kit
  box(g, m.cSteel, 1.5, 0.9, 0.9, 3.5, 0.95, 2.9);
  strut(g, m.dark, 3.1, 0.7, 2.6, 1.6, 0.6, -0.2, 0.03, 5);
  strut(g, m.dark, -1.9, 1.2, 2.5, 1.0, 0.6, -0.5, 0.03, 5);
  crate(g, m.cPanelLight, 1.0, -3.3, 0.8, -2.9, 0.4);
  sandbagRow(g, 2.9, 0.5, -3.6, 0.1, 4, 2);
}

function bParticle(g, owner) {
  const m = mats(), A = accents(owner);
  box(g, m.conc, 15.5, 0.5, 15.5, 0, 0.25, 0).receiveShadow = true;
  // tiered bunker base
  box(g, m.cPanel, 12.5, 2.0, 12.5, 0, 1.25, 0);
  box(g, m.cPanelDark, 10.0, 1.2, 10.0, 0, 2.85, 0);
  box(g, m.hazard, 12.7, 0.3, 0.4, 0, 2.15, -6.28);
  // capacitor towers on the corners with glowing tips + conduits
  for (const [px, pz] of [[-5.3, -5.3], [5.3, -5.3], [-5.3, 5.3], [5.3, 5.3]]) {
    cyl(g, m.cSteel, 0.55, 0.7, 3.6, px, 3.8, pz, 10);
    cyl(g, m.cGlow, 0.42, 0.42, 0.5, px, 5.8, pz, 10);
    const orb = new THREE.Mesh(sphGeo(0.4, 10, 7), m.reactorGlow);
    orb.position.set(px, 6.3, pz);
    orb.castShadow = true;
    g.add(orb);
    strut(g, m.cGlow, px * 0.92, 3.0, pz * 0.92, px * 0.35, 3.6, pz * 0.35, 0.09, 6);
  }
  // iris dome (sim slowly spins userData.spin)
  const domeG = new THREE.Group();
  domeG.position.set(0, 3.4, 0);
  g.add(domeG);
  cyl(domeG, m.cSteel, 4.3, 4.5, 0.5, 0, 0.15, 0, 20);
  const shell = new THREE.Mesh(sphGeo(4.2, 22, 12, Math.PI * 0.42), m.cWhite);
  shell.position.y = 0.3;
  shell.castShadow = true;
  domeG.add(shell);
  // iris petals lying on the dome shell around the aperture
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    const rr = 1.75;                                 // radial dist of petal centre
    const sy = 0.3 + Math.sqrt(4.2 * 4.2 - rr * rr); // shell height there
    const petal = box(domeG, m.cSteel, 1.05, 0.12, 1.7, Math.cos(a) * rr, sy - 0.28, Math.sin(a) * rr);
    petal.rotation.order = 'YXZ';
    petal.rotation.y = -a + Math.PI / 2;
    petal.rotation.x = -0.46;                        // follow the shell slope
  }
  cyl(domeG, m.cGlow, 1.15, 1.15, 0.18, 0, 3.35, 0, 16);       // aperture glow ring
  cyl(domeG, m.dark, 0.95, 0.95, 0.2, 0, 3.4, 0, 16);          // aperture core
  const band = new THREE.Mesh(torGeo(4.22, 0.09, 8, 26), A.glow);
  band.rotation.x = Math.PI / 2;
  band.position.y = 1.1;
  domeG.add(band);
  g.userData.spin = domeG;
  // lens/relay tower
  const tx = 6.6, tz = 2.2;
  cyl(g, m.cSteel, 0.16, 0.26, 7.0, tx, 3.5, tz, 8);
  strut(g, m.cSteel, tx, 4.6, tz, tx - 1.1, 2.4, tz - 0.8, 0.05, 5);
  strut(g, m.cSteel, tx, 4.6, tz, tx - 1.1, 2.4, tz + 0.8, 0.05, 5);
  const mirror = box(g, m.cGlass, 1.5, 1.1, 0.14, tx, 7.3, tz);
  mirror.rotation.x = -0.6;
  box(g, m.cSteel, 1.7, 0.16, 0.3, tx, 6.75, tz);
  // support gear
  box(g, m.cPanelLight, 2.4, 1.4, 1.6, -6.4, 1.2, 1.4);        // capacitor shed
  box(g, m.cGlass, 1.6, 0.5, 0.1, -6.4, 1.4, 0.56);
  drum(g, m.cSteel, -6.9, 3.9, 0.4, 1.0);
  flagPole(g, owner, 7.2, -6.6, 8, 2.6, 1.5);
}

// ================================================================= CARTEL BUILDINGS
// (adapted from the FPS art kit; fps entrances faced +Z so ports live in a
//  180°-turned wrapper — turrets stay direct children of g for combat.)
function flipWrap(g, scale = 1) {
  const f = new THREE.Group();
  f.rotation.y = Math.PI;
  f.scale.setScalar(scale);
  g.add(f);
  return f;
}

function bCcG(g, owner) {
  const m = mats(), A = accents(owner);
  const f = flipWrap(g, 0.85);
  // main hall with battered corner piers
  box(f, m.adobe, 16, 7, 12, 0, 3.5, 0);
  for (const [px, pz] of [[-7.6, -5.6], [7.6, -5.6], [-7.6, 5.6], [7.6, 5.6]])
    box(f, m.adobeDark, 1.6, 7.4, 1.6, px, 3.7, pz);
  box(f, m.adobeDark, 17, 1, 13, 0, 7.3, 0);
  for (let i = 0; i < 7; i++) {
    const x = -7.2 + i * 2.4;
    box(f, m.adobe, 1.0, 0.55, 0.6, x, 8.05, 6.3);
    box(f, m.adobe, 1.0, 0.55, 0.6, x, 8.05, -6.3);
  }
  // side wings with corrugated lean-to roofs
  box(f, m.adobeDark, 5, 5, 7.5, -9.2, 2.5, 1);
  box(f, m.adobeDark, 5, 5, 7.5, 9.2, 2.5, 1);
  const lean1 = box(f, m.corrRust, 5.8, 0.18, 8.3, -9.5, 5.35, 1);
  lean1.rotation.z = 0.09;
  const lean2 = box(f, m.corr, 5.8, 0.18, 8.3, 9.5, 5.35, 1);
  lean2.rotation.z = -0.09;
  // entry arch + framed wooden double door
  box(f, m.adobePale, 6, 4.5, 1.4, 0, 2.25, 6.4);
  const arch = new THREE.Mesh(cylGeo(1.8, 1.8, 1.5, 16, false, 0, Math.PI), m.adobeDark);
  arch.rotation.z = Math.PI / 2; arch.rotation.y = Math.PI / 2;
  arch.position.set(0, 3.4, 6.4);
  arch.castShadow = true;
  f.add(arch);
  box(f, m.woodDark, 3.0, 3.3, 0.18, 0, 1.65, 7.02);
  box(f, m.dark, 0.08, 3.1, 0.26, 0, 1.6, 7.05);
  box(f, m.adobeDark, 0.32, 3.5, 0.4, -1.62, 1.75, 6.95);
  box(f, m.adobeDark, 0.32, 3.5, 0.4, 1.62, 1.75, 6.95);
  box(f, m.dark, 1.6, 0.7, 0.12, 0, 3.85, 7.12);
  // dome + gold finial
  const dm = dome(f, m.adobePale, 4.2, 0, 7.6, -1, 20, 12);
  cyl(f, m.gold, 0.5, 0.5, 2.4, 0, 12.4, -1, 8);
  // radio mast, braces, crossarms + player flag
  cyl(f, m.metalDark, 0.12, 0.2, 12, 6.5, 13, -4, 6);
  box(f, m.metalDark, 0.1, 0.1, 3, 6.5, 17, -4);
  box(f, m.metalDark, 3, 0.1, 0.1, 6.5, 15.5, -4);
  strut(f, m.metalDark, 6.5, 10.5, -4, 5.2, 7.8, -3.0, 0.035, 5);
  strut(f, m.metalDark, 6.5, 10.5, -4, 7.8, 7.8, -3.0, 0.035, 5);
  strut(f, m.metalDark, 6.5, 10.5, -4, 6.5, 7.8, -5.4, 0.035, 5);
  strut(f, m.dark, 6.5, 16.9, -4, 0.2, 13.1, -1.2, 0.024, 5);
  strut(f, m.dark, 6.5, 15.4, -4, -6.2, 9.4, -3.1, 0.024, 5);
  const flag = clothPlane(A.cloth, 2.8, 1.7, 5, 2, 0.18, 1.2);
  flag.position.set(8.0, 17.8, -4);
  f.add(flag);
  // satellite dish on an A-frame mount
  const dish = new THREE.Mesh(sphGeo(2.2, 16, 8, Math.PI / 3), m.metal);
  dish.rotation.x = Math.PI * 0.82; dish.rotation.z = 0.5;
  dish.position.set(-6.5, 9.2, -3);
  dish.castShadow = true;
  f.add(dish);
  strut(f, m.metalDark, -6.5, 9.1, -3, -7.3, 7.7, -3.9, 0.06, 5);
  strut(f, m.metalDark, -6.5, 9.1, -3, -5.7, 7.7, -3.9, 0.06, 5);
  strut(f, m.metalDark, -6.5, 9.1, -3, -6.5, 7.7, -1.9, 0.06, 5);
  // framed windows
  for (const wx of [-5, 5]) {
    box(f, m.window, 2.2, 1.4, 0.15, wx, 4.6, 6.06);
    box(f, m.adobePale, 2.7, 0.2, 0.4, wx, 3.82, 6.12);
    box(f, m.adobeDark, 2.6, 0.26, 0.3, wx, 5.4, 6.1);
    box(f, m.adobeDark, 0.24, 1.7, 0.24, wx - 1.24, 4.6, 6.08);
    box(f, m.adobeDark, 0.24, 1.7, 0.24, wx + 1.24, 4.6, 6.08);
  }
  // roof clutter
  box(f, m.wood, 1.3, 1.0, 1.3, 4.6, 8.3, 4.2);
  const rc = box(f, m.wood, 1.05, 0.9, 1.05, 5.7, 8.25, 3.3);
  rc.rotation.y = 0.5;
  const tarp = box(f, m.tarp, 2.6, 1.2, 2.1, -3.8, 8.4, 3.8);
  tarp.rotation.y = 0.3; tarp.rotation.z = 0.04;
  box(f, m.metal, 1.5, 1.0, 1.2, -4.6, 8.3, -4.4);
  box(f, m.dark, 1.2, 0.7, 0.08, -4.6, 8.3, -3.78);
  sandbagRow(f, -6.6, 7.8, 4.6, 0.2, 4, 2);
  // player-colour banners flanking the entrance
  for (const s of [-1, 1]) {
    box(f, A.cloth, 2.4, 3.4, 0.08, s * 7.9, 4.4, 6.1);
    box(f, m.gold, 2.5, 0.45, 0.1, s * 7.9, 5.9, 6.11);
  }
  const em = new THREE.Mesh(new THREE.PlaneGeometry(3.4, 1.5), m.claw);
  em.position.set(0, 5.6, 6.03);
  f.add(em);                                                   // claw over the gate
  sandbagRow(g, -3.6, 0, -8.2, -0.25, 5, 2);
  sandbagRow(g, 3.6, 0, -8.2, 0.25, 5, 2);
}

function bBarracksG(g, owner) {
  const m = mats(), A = accents(owner);
  const f = flipWrap(g);
  box(f, m.adobeDark, 11, 4, 6.5, -0.5, 2, -1.2);
  const roof = box(f, m.corrRust, 12, 0.25, 7.8, -0.5, 4.4, -1.2);
  roof.rotation.x = 0.1;
  box(f, m.conc, 0.5, 0.3, 0.5, -3.5, 4.45, 0.6);
  box(f, m.conc, 0.5, 0.3, 0.5, 0.5, 4.85, -3.0);
  tireTorus(f, -2.5, 4.8, -2.6);
  cyl(f, m.metalDark, 0.12, 0.12, 2.4, 4.0, 5.1, -2.6, 6);
  cone(f, m.metalDark, 0.28, 0.3, 4.0, 6.4, -2.6, 6);
  // framed door + windows
  box(f, m.woodDark, 3, 3, 0.3, -3.0, 1.5, 2.2);
  box(f, m.wood, 0.28, 3.3, 0.36, -4.5, 1.65, 2.22);
  box(f, m.wood, 0.28, 3.3, 0.36, -1.5, 1.65, 2.22);
  box(f, m.wood, 3.5, 0.28, 0.4, -3.0, 3.25, 2.22);
  for (const wx of [1.5, 4.1]) {
    box(f, m.window, 1.6, 1.1, 0.15, wx, 2.4, 2.15);
    box(f, m.adobePale, 2.0, 0.18, 0.34, wx, 1.78, 2.2);
    box(f, m.adobePale, 1.95, 0.2, 0.28, wx, 3.03, 2.18);
    box(f, m.adobePale, 0.18, 1.4, 0.22, wx - 0.95, 2.4, 2.17);
    box(f, m.adobePale, 0.18, 1.4, 0.22, wx + 0.95, 2.4, 2.17);
  }
  sandbagRow(f, 0.2, 0, 3.2, 0.15, 3, 2);
  // camo net training yard behind
  camoNet(f, 8, 5.5, -0.6, 4.7, -5.2, 0.12);
  for (const [px, pz] of [[-4.2, -3.2], [3, -3.2], [-4.2, -7.4], [3, -7.4]])
    cyl(f, m.wood, 0.09, 0.09, 4.7, px, 2.35, pz, 6);
  // squad tent + flag
  const tent = new THREE.Group();
  tent.position.set(4.6, 0, 3.4);
  tent.rotation.y = 0.4;
  f.add(tent);
  const tA = box(tent, m.camo, 3.0, 0.16, 3.4, -0.85, 1.05, 0);
  tA.rotation.z = 0.75;
  const tB = box(tent, m.camo, 3.0, 0.16, 3.4, 0.85, 1.05, 0);
  tB.rotation.z = -0.75;
  box(tent, m.dark, 0.9, 1.4, 0.1, 0, 0.7, -1.6);
  flagPole(g, owner, -5.6, -4.6, 7, 2.4, 1.4);
  crate(f, m.wood, 1.1, 5.4, 0.4, -1.4, 0.5);
  drum(f, m.metalRust, 5.9, -3.2);
}

function bSupplyG(g, owner) {
  const m = mats(), A = accents(owner);
  // shanty warehouse: corrugated shed, open front, crate yard
  box(g, m.metalRust, 10.5, 4.6, 8.5, -1.6, 2.3, 1.4);
  const roof = box(g, m.corrRust, 11.5, 0.2, 9.6, -1.6, 4.85, 1.4);
  roof.rotation.z = 0.06;
  box(g, m.corr, 0.25, 3.2, 8.6, 3.75, 1.6, 1.4);              // patch wall
  box(g, m.dark, 6.0, 3.4, 0.3, -2.0, 1.7, -2.75);             // open front maw
  box(g, m.wood, 0.6, 4.2, 0.5, -5.2, 2.1, -2.9);
  box(g, m.wood, 0.6, 4.2, 0.5, 1.2, 2.1, -2.9);
  box(g, m.corrRust, 7.4, 0.9, 0.4, -2.0, 4.15, -2.95);        // sagging fascia
  const sign = box(g, A.cloth, 2.6, 0.9, 0.1, -2.0, 3.2, -3.0);
  sign.rotation.z = -0.05;                                     // faction rag sign
  // crate yard + pallets
  crate(g, m.wood, 1.5, 5.4, 0.6, -1.6, 0.3);
  crate(g, m.wood, 1.4, 6.5, 0.55, 0.2, 0.7);
  crate(g, m.woodDark, 1.3, 5.8, 1.6, -0.9, 0.1);
  crate(g, m.wood, 1.2, 4.9, 0.5, 2.5, 0.5);
  box(g, m.wood, 2.4, 0.18, 1.8, 6.0, 0.1, 1.8);               // pallet
  const sacks = [];
  for (let i = 0; i < 5; i++)
    box(g, m.sandbag, 0.9, 0.4, 0.6, 5.6 + (i % 2) * 0.8, 0.4 + Math.floor(i / 2) * 0.36, 1.8 + (i % 3) * 0.2);
  camoNet(g, 5, 4.5, 6.0, 3.2, 1.6, 0.1);
  for (const [px, pz] of [[4.4, 0.2], [7.6, 0.2], [4.4, 3.2], [7.6, 3.2]])
    cyl(g, m.wood, 0.08, 0.08, 3.2, px, 1.6, pz, 6);
  drum(g, m.green, -6.4, -1.6);
  drum(g, m.metalRust, -7.0, -0.6);
  tireTorus(g, -6.6, 0.25, 3.4);
  tireTorus(g, -6.6, 0.72, 3.4);
  const lean = box(g, m.corr, 3.2, 0.16, 2.6, -6.2, 2.3, 4.6);
  lean.rotation.z = 0.18;                                      // lean-to shelter
  cyl(g, m.wood, 0.07, 0.07, 2.2, -7.6, 1.1, 3.5, 6);
  cyl(g, m.wood, 0.07, 0.07, 2.2, -7.6, 1.1, 5.6, 6);
  decal(g, m.stainMat, 1.2, 2.4, -4.4, 0.06);
}

function bArmsDealer(g, owner) {
  const m = mats(), A = accents(owner);
  const f = flipWrap(g);
  // big garage with barrel-vault roof
  box(f, m.metalRust, 14, 6, 11, 0, 3, 0);
  const roof = new THREE.Mesh(cylGeo(5.6, 5.6, 14.2, 12, false, 0, Math.PI), m.corr);
  roof.rotation.z = Math.PI / 2;
  roof.position.set(0, 6, 0);
  roof.castShadow = roof.receiveShadow = true;
  f.add(roof);
  cyl(f, m.metalDark, 0.22, 0.28, 2.6, -3.2, 12.1, 0, 8);
  cone(f, m.metalDark, 0.5, 0.45, -3.2, 13.6, 0, 8);
  box(f, m.metalDark, 1.7, 0.35, 1.3, 2.6, 11.6, 0.2);
  // open door (dark interior), posts, lintel, hanging sign
  box(f, m.dark, 7, 4.6, 0.3, 0, 2.3, 5.6);
  box(f, m.metalDark, 1.2, 5.2, 0.5, -4.1, 2.6, 5.6);
  box(f, m.metalDark, 1.2, 5.2, 0.5, 4.1, 2.6, 5.6);
  box(f, m.metalDark, 9.4, 0.8, 0.55, 0, 5.55, 5.6);
  const sign = box(f, m.corrRust, 3.4, 1.0, 0.16, 0.2, 6.7, 5.62);
  sign.rotation.z = -0.06;
  const em = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 1.1), m.claw);
  em.position.set(0.2, 6.72, 5.72);
  em.rotation.y = Math.PI;                                     // faces out after flip
  f.add(em);
  strut(f, m.dark, -1.3, 7.15, 5.55, -1.3, 7.85, 5.2, 0.03, 5);
  strut(f, m.dark, 1.7, 7.15, 5.55, 1.7, 7.85, 5.2, 0.03, 5);
  // framed side windows
  for (const wz of [-2.6, 2.2]) {
    box(f, m.window, 0.15, 1.1, 1.5, 7.02, 3.7, wz);
    box(f, m.metalDark, 0.24, 0.18, 1.9, 7.03, 4.4, wz);
    box(f, m.metalDark, 0.24, 0.18, 1.9, 7.03, 3.0, wz);
    box(f, m.metalDark, 0.24, 1.3, 0.2, 7.03, 3.7, wz - 0.85);
    box(f, m.metalDark, 0.24, 1.3, 0.2, 7.03, 3.7, wz + 0.85);
  }
  // external furnace flue
  cyl(f, m.metalDark, 0.32, 0.4, 8.4, -7.35, 4.2, -3, 8);
  const flueElbow = cyl(f, m.metalDark, 0.3, 0.3, 0.7, -7.1, 1.9, -3, 8);
  flueElbow.rotation.z = Math.PI / 2;
  // jib crane with chain hoist + engine block
  cyl(f, m.metalDark, 0.2, 0.26, 7.2, 8.5, 3.6, 2.4, 8);
  box(f, m.metalDark, 0.35, 0.35, 4.6, 8.5, 7.1, 4.5);
  strut(f, m.metalDark, 8.5, 5.4, 2.5, 8.5, 6.9, 5.6, 0.06, 5);
  strut(f, m.dark, 8.5, 6.9, 6.4, 8.5, 2.6, 6.4, 0.035, 5);
  const eng = box(f, m.metalDark, 1.0, 0.8, 0.75, 8.5, 2.1, 6.4);
  eng.rotation.y = 0.4;
  // workbench + canopy
  box(f, m.wood, 2.8, 0.95, 1.1, -5.4, 0.48, 4.4);
  const wbe = box(f, m.metalDark, 0.8, 0.6, 0.6, -5.2, 1.25, 4.4);
  wbe.rotation.y = 0.7;
  camoNet(f, 5.5, 3.6, -4.6, 4.2, 4.7, 0.4);
  cyl(f, m.wood, 0.07, 0.07, 3.6, -6.9, 1.8, 6.2, 6);
  cyl(f, m.wood, 0.07, 0.07, 3.6, -2.3, 1.8, 6.2, 6);
  // gas bottles + stains + spare wheels
  cyl(f, m.green, 0.26, 0.26, 1.5, 6.4, 0.75, 5.9, 10);
  const gb = cyl(f, m.metalRust, 0.26, 0.26, 1.5, 6.95, 0.72, 5.55, 10);
  gb.rotation.z = 0.22;
  decal(f, m.stainMat, 1.5, 0.8, 7.0, 0.05);
  decal(f, m.stainMat, 0.9, -4.8, 6.2, 0.05);
  for (let i = 0; i < 4; i++) tireTorus(f, -6.4 - i * 0.12, 0.25 + i * 0.45, 4.5);
  const lt = tireTorus(f, -7.5, 0.5, 2.6, true);
  lt.rotation.x = Math.PI / 2 - 0.9; lt.rotation.z = 0.4;
  box(f, A.cloth, 1.6, 1.0, 0.06, 7.06, 4.9, -0.2);            // player rag on the wall
}

function bBlackmarket(g, owner) {
  const m = mats(), A = accents(owner);
  // adobe trading house
  box(g, m.adobe, 7, 4.4, 5.5, -1.4, 2.2, 1.6);
  box(g, m.adobeDark, 7.6, 0.7, 6.1, -1.4, 4.6, 1.6);
  for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]])
    box(g, m.adobePale, 0.55, 4.9, 0.55, -1.4 + sx * 3.5, 2.45, 1.6 + sz * 2.75);
  box(g, m.woodDark, 1.4, 2.4, 0.2, -2.6, 1.2, -1.18);         // door
  box(g, m.window, 1.3, 0.9, 0.15, 0.2, 2.6, -1.15);
  // antenna mast + wire (smuggler comms)
  cyl(g, m.metalDark, 0.08, 0.12, 5.4, 0.8, 7.3, 3.4, 6);
  box(g, m.metalDark, 1.8, 0.08, 0.08, 0.8, 9.6, 3.4);
  strut(g, m.dark, 0.8, 9.4, 3.4, -3.6, 5.1, 1.2, 0.02, 5);
  // striped awning stalls out front
  for (const [ax, az, ry] of [[2.9, -1.9, 0], [-4.9, -0.4, Math.PI / 2]]) {
    const stall = new THREE.Group();
    stall.position.set(ax, 0, az);
    stall.rotation.y = ry;
    g.add(stall);
    const a = new THREE.Mesh(new THREE.PlaneGeometry(3.2, 2.4), m.awning);
    a.rotation.x = -Math.PI / 2 + 0.38;
    a.position.set(0, 2.5, -0.9);
    a.castShadow = true;
    stall.add(a);
    cyl(stall, m.wood, 0.06, 0.06, 2.3, -1.5, 1.15, -1.9, 5);
    cyl(stall, m.wood, 0.06, 0.06, 2.3, 1.5, 1.15, -1.9, 5);
    box(stall, m.wood, 2.8, 0.7, 1.2, 0, 0.35, -1.2);
    crate(stall, m.wood, 0.8, -0.7, 0.9, -1.2, 0.3);
    box(stall, m.sandbag, 0.7, 0.3, 0.5, 0.6, 0.85, -1.2);     // goods sacks
    box(stall, A.cloth, 0.9, 0.5, 0.06, 0, 1.6, -1.85);        // hanging rug
  }
  // the strongbox — gold-trimmed war chest under a lean-to
  const lean = box(g, m.corrRust, 3.0, 0.14, 2.4, 2.6, 2.5, 3.2);
  lean.rotation.z = -0.2;
  cyl(g, m.wood, 0.07, 0.07, 2.4, 4.0, 1.2, 2.2, 6);
  cyl(g, m.wood, 0.07, 0.07, 2.4, 4.0, 1.2, 4.2, 6);
  box(g, m.woodDark, 1.6, 1.0, 1.1, 2.8, 0.5, 3.3);
  box(g, m.gold, 1.66, 0.18, 1.16, 2.8, 0.72, 3.3);
  box(g, m.gold, 0.3, 0.4, 0.12, 2.8, 0.5, 2.72);              // hasp
  cone(g, m.gold, 0.5, 0.4, 3.6, 0.2, 4.1, 10);                // spilled coin pile
  cone(g, m.gold, 0.34, 0.28, 2.1, 0.14, 4.3, 8);
  // stacked contraband crates + scales
  crate(g, m.woodDark, 1.1, -4.6, 0.4, 3.6, 0.4);
  crate(g, m.wood, 1.0, -3.5, 0.38, 4.1, 0.1);
  crate(g, m.wood, 0.9, -4.2, 1.1, 3.8, 0.7);
  drum(g, m.green, -4.9, -2.2);
  sandbagRow(g, 0.4, 0, -3.9, 0.05, 4, 1);
  decal(g, m.stainMat, 0.8, 3.4, -2.6, 0.05);
}

function bStinger(g, owner) {
  const m = mats(), A = accents(owner);
  const pad = cyl(g, m.adobeDark, 4.9, 5.2, 0.22, 0, 0.06, 0, 22);
  pad.receiveShadow = true;
  sandbagRing(g, 4.3, 3, 4.35, 5.05);                          // entrance gap faces -Z
  // launcher: tripod + slewing quad-tube pod (userData.turret) — oversized
  // for RTS readability
  const SS = 1.5;
  const rack = new THREE.Group();
  rack.scale.setScalar(SS);
  g.add(rack);
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2 + 0.6;
    strut(rack, m.metalDark, 0, 1.15, 0, Math.cos(a) * 1.2, 0.08, Math.sin(a) * 1.2, 0.07, 6);
    box(rack, m.metalDark, 0.36, 0.12, 0.36, Math.cos(a) * 1.2, 0.08, Math.sin(a) * 1.2);
  }
  cyl(rack, m.metalDark, 0.18, 0.22, 0.55, 0, 1.32, 0, 8);
  const turret = new THREE.Group();
  turret.position.set(0, 1.62 * SS, 0);
  g.add(turret);
  const pod = new THREE.Group();
  pod.scale.setScalar(SS);
  pod.rotation.x = -0.5;                                       // fixed elevation
  turret.add(pod);
  box(pod, m.metalDark, 1.1, 0.16, 1.9, 0, -0.45, 0.15);
  box(pod, m.metalDark, 0.16, 0.34, 0.16, 0, -0.3, 0.8);
  for (const [tx, ty] of [[-0.27, -0.27], [0.27, -0.27], [-0.27, 0.27], [0.27, 0.27]]) {
    const tube = cyl(pod, m.green, 0.19, 0.19, 2.7, tx, ty, -0.1, 10);
    tube.rotation.x = Math.PI / 2;
    const rim = cyl(pod, m.dark, 0.225, 0.225, 0.1, tx, ty, -1.44, 10);
    rim.rotation.x = Math.PI / 2;
    const tip = cone(pod, m.missile, 0.13, 0.42, tx, ty, -1.66, 8);
    tip.rotation.x = -Math.PI / 2;
  }
  box(pod, m.metalRust, 1.04, 1.04, 0.14, 0, 0, 0.82);
  box(pod, m.metalRust, 1.04, 1.04, 0.14, 0, 0, -0.72);
  box(pod, m.metalRust, 0.42, 0.34, 0.6, -0.75, -0.1, 0.5);
  box(pod, A.paint, 1.06, 0.14, 0.3, 0, 0.56, -0.9);           // accent stripe on pod
  g.userData.turret = turret;
  g.userData.muzzle = new THREE.Vector3(0, Math.sin(0.5) * 2.7, -Math.cos(0.5) * 2.7);
  // gunner stool + crates + cable + spare tube + drum
  cyl(g, m.metalDark, 0.06, 0.06, 0.7, -1.0, 0.35, 0.4, 6);
  cyl(g, m.metalRust, 0.24, 0.24, 0.06, -1.0, 0.73, 0.4, 8);
  box(g, m.wood, 1.4, 0.8, 0.9, 2.5, 0.4, 1.9);
  const c2 = box(g, m.wood, 1.35, 0.75, 0.85, 2.7, 1.15, 2.2);
  c2.rotation.y = 0.16;
  strut(g, m.dark, 0.35, 1.15, 0.3, 2.3, 0.85, 1.6, 0.026, 5);
  box(g, m.woodDark, 0.32, 0.24, 0.5, -2.7, 0.12, 2.0);
  box(g, m.woodDark, 0.32, 0.24, 0.5, -1.3, 0.12, 2.6);
  strut(g, m.green, -3.1, 0.36, 1.85, -0.9, 0.36, 2.75, 0.17, 8);
  drum(g, m.metalRust, -2.6, -2.4);
  flagPole(g, owner, 3.6, -2.9, 5, 1.8, 1.1);
}

function bTunnel(g, owner) {
  const m = mats(), A = accents(owner);
  // lumpy excavated-earth mound
  const geoM = new THREE.SphereGeometry(5.0, 20, 12, 0, Math.PI * 2, 0, Math.PI / 2);
  const pos = geoM.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    const n = 1 + Math.sin(x * 1.9 + z * 1.3) * 0.05 + Math.cos(x * 0.8 - z * 2.2) * 0.06;
    pos.setXYZ(i, x * n, y * n * 0.72, z * n);
  }
  geoM.computeVertexNormals();
  const mound = new THREE.Mesh(geoM, m.adobeDark);
  mound.position.z = 0.8;
  mound.castShadow = mound.receiveShadow = true;
  g.add(mound);
  // timber-framed entrance portal facing -Z
  box(g, m.adobe, 3.4, 2.9, 2.4, 0, 1.3, -3.4);
  box(g, m.woodDark, 0.3, 2.6, 0.35, -1.15, 1.3, -4.65);
  box(g, m.woodDark, 0.3, 2.6, 0.35, 1.15, 1.3, -4.65);
  box(g, m.woodDark, 3.0, 0.35, 0.45, 0, 2.72, -4.65);
  box(g, m.dark, 2.0, 2.2, 0.35, 0, 1.05, -4.52);
  const awn = box(g, m.corrRust, 3.6, 0.14, 1.6, 0, 3.12, -4.9);
  awn.rotation.x = -0.24;
  sandbagRow(g, -2.9, 0, -4.4, 0.5, 4, 2);
  sandbagRow(g, 2.9, 0, -4.4, -0.5, 4, 2);
  sandbagRow(g, 0, 2.75, -4.1, 0, 3, 1);
  camoNet(g, 7, 5.4, 0.4, 3.65, 2.0, -0.22);
  for (const [px, pz] of [[-3.0, 4.6], [3.2, 4.4]]) cyl(g, m.wood, 0.08, 0.08, 3.1, px, 1.55, pz, 6);
  // periscope stovepipe
  cyl(g, m.metalDark, 0.1, 0.1, 1.6, -1.8, 3.4, 1.6, 6);
  const elbow = cyl(g, m.metalDark, 0.09, 0.09, 0.5, -1.62, 4.15, 1.6, 6);
  elbow.rotation.z = Math.PI / 2;
  // crate + drum by the mouth
  const cr = box(g, m.wood, 1.2, 0.9, 0.9, 3.4, 0.45, -2.2);
  cr.rotation.y = 0.3;
  drum(g, m.metalRust, 4.3, -1.0);
  // MG nest on the crown (userData.turret)
  const nestY = 3.35;
  sandbagRow(g, -0.9, nestY - 0.16, 0.6, 1.2, 3, 1);
  sandbagRow(g, 0.9, nestY - 0.16, 0.6, -1.2, 3, 1);
  const turret = new THREE.Group();
  turret.position.set(0, nestY + 0.35, 0.4);
  g.add(turret);
  cyl(turret, m.gun, 0.06, 0.08, 0.6, 0, 0, 0, 8);
  box(turret, m.gun, 0.16, 0.2, 1.0, 0, 0.36, -0.25);
  cyl(turret, m.gun, 0.035, 0.035, 0.9, 0, 0.38, -1.15, 8).rotation.x = Math.PI / 2;
  box(turret, m.dark, 0.14, 0.12, 0.18, 0.16, 0.34, -0.1);
  box(turret, m.metalDark, 0.55, 0.4, 0.05, 0, 0.4, -0.55);
  g.userData.turret = turret;
  g.userData.muzzle = new THREE.Vector3(0, 0.38, -1.65);
  // flag on the crown
  flagPole(g, owner, 2.1, 1.4, 6.2, 1.9, 1.15);
}

function bScudstorm(g, owner) {
  const m = mats(), A = accents(owner);
  box(g, m.conc, 13, 0.4, 13, 0, 0.2, 0.6).receiveShadow = true;
  // earthen revetment on three sides (open to -Z)
  for (const [bx, bz, bw, ry] of [[0, 8.0, 15.5, 0], [-8.0, 0.5, 14.5, Math.PI / 2], [8.0, 0.5, 14.5, Math.PI / 2]]) {
    const berm = new THREE.Group();
    berm.position.set(bx, 0, bz);
    berm.rotation.y = ry;
    g.add(berm);
    box(berm, m.adobeDark, bw, 1.9, 1.5, 0, 0.8, 0);
    const s1 = box(berm, m.adobeDark, bw, 2.2, 1.3, 0, 0.62, -1.05);
    s1.rotation.x = 0.62;
    const s2 = box(berm, m.adobeDark, bw, 2.2, 1.3, 0, 0.62, 1.05);
    s2.rotation.x = -0.62;
    sandbagRow(berm, 0, 1.68, 0, 0, Math.floor(bw / 0.9), 1);  // sandbag crown
  }
  for (const [cx, cz] of [[-7.4, -6.2], [7.4, -6.2]]) {        // corner bunkers
    box(g, m.conc, 2.2, 1.6, 2.2, cx, 0.8, cz);
    sandbagRow(g, cx, 1.5, cz, 0.3, 3, 1);
  }
  // 3×3 scud rack, tubes near-vertical with a menacing forward cant
  const rack = new THREE.Group();
  rack.position.set(0, 0.4, 1.2);
  rack.rotation.x = -0.16;
  g.add(rack);
  box(rack, m.metalDark, 5.6, 0.7, 5.6, 0, 0.35, 0);           // launch table
  box(rack, m.hazard, 5.7, 0.24, 0.5, 0, 0.75, -2.85);
  for (let ix = 0; ix < 3; ix++) for (let iz = 0; iz < 3; iz++) {
    const tx = (ix - 1) * 1.7, tz = (iz - 1) * 1.7;
    cyl(rack, iz === 1 ? m.metalDark : m.hullGreen, 0.52, 0.58, 6.4, tx, 3.6, tz, 12);
    cyl(rack, m.dark, 0.56, 0.56, 0.24, tx, 6.7, tz, 12);
    cyl(rack, m.missile, 0.34, 0.4, 0.9, tx, 7.15, tz, 10);    // missile shoulder
    cone(rack, m.missile, 0.34, 1.1, tx, 8.1, tz, 10);         // warhead
    cyl(rack, m.redTip, 0.35, 0.35, 0.18, tx, 7.6, tz, 10);    // anthrax band
  }
  // frame bracing between tubes
  for (const fy of [2.2, 5.2]) {
    box(rack, m.metalRust, 5.5, 0.18, 0.18, 0, fy, -1.7);
    box(rack, m.metalRust, 5.5, 0.18, 0.18, 0, fy, 1.7);
    box(rack, m.metalRust, 0.18, 0.18, 5.5, -1.7, fy, 0);
    box(rack, m.metalRust, 0.18, 0.18, 5.5, 1.7, fy, 0);
  }
  // service gantry + ladder
  box(g, m.metalDark, 0.9, 0.14, 2.8, 3.6, 4.6, 1.2);
  for (const lz of [-0.2, 2.6]) cyl(g, m.metalDark, 0.06, 0.06, 4.6, 3.95, 2.3, lz, 6);
  for (let i = 0; i < 6; i++) box(g, m.metalDark, 0.7, 0.06, 0.06, 3.95, 0.7 + i * 0.75, 2.6);
  // fuel bowser + hose + floodlight
  const tank = cyl(g, m.metalRust, 0.9, 0.9, 3.0, -5.4, 1.3, -3.4, 12);
  tank.rotation.z = Math.PI / 2;
  box(g, m.woodDark, 0.5, 0.5, 0.5, -6.6, 0.25, -3.4);
  box(g, m.woodDark, 0.5, 0.5, 0.5, -4.2, 0.25, -3.4);
  strut(g, m.dark, -4.0, 1.2, -3.2, -1.6, 0.7, 0.6, 0.05, 5);
  cyl(g, m.metalDark, 0.08, 0.12, 5.6, 6.8, 2.8, 3.6, 6);
  box(g, m.lightLens, 0.5, 0.3, 0.3, 6.8, 5.7, 3.3);
  // blast wall with claw + flag
  box(g, m.conc, 3.6, 2.2, 0.6, -5.2, 1.1, -6.0);
  const em = new THREE.Mesh(new THREE.PlaneGeometry(2.8, 1.2), m.claw);
  em.position.set(-5.2, 1.15, -6.32);
  g.add(em);
  flagPole(g, owner, 6.9, -6.3, 7, 2.4, 1.4);
  decal(g, m.scorch, 3.6, 0, 1.2, 0.45);
}

// ================================================================= NEUTRAL
function bDerrick(g) {
  const m = mats();
  // pump jack: base, post, walking beam, horse head, counterweight
  box(g, m.conc, 4.5, 0.5, 2, 0, 0.25, 0);
  box(g, m.metalRust, 0.25, 3.6, 0.25, -0.6, 1.8, 0.5);
  box(g, m.metalRust, 0.25, 3.6, 0.25, -0.6, 1.8, -0.5);
  box(g, m.metalRust, 0.25, 3.6, 0.25, 0.2, 1.8, 0);
  const beam = new THREE.Group();
  beam.position.set(-0.4, 3.6, 0);
  beam.rotation.z = 0.06;
  g.add(beam);
  box(beam, m.metalRust, 4.6, 0.35, 0.5, 0, 0, 0);
  const head = new THREE.Mesh(cylGeo(0.9, 0.9, 0.5, 12, false, -Math.PI / 2, Math.PI), m.metalRust);
  head.rotation.x = Math.PI / 2;
  head.position.set(2.3, -0.1, 0);
  head.castShadow = true;
  beam.add(head);
  box(beam, m.metalDark, 1.2, 1.2, 0.6, -2.2, -0.2, 0);
  g.userData.beam = beam;
  // crank flywheel — stood upright via a rotated mount so a plain
  // rotation.y spin on userData.spin turns the wheel
  const mount = new THREE.Group();
  mount.position.set(-1.8, 1.0, 0.75);
  mount.rotation.x = Math.PI / 2;
  g.add(mount);
  const wheel = new THREE.Group();
  mount.add(wheel);
  cyl(wheel, m.metalDark, 0.62, 0.62, 0.14, 0, 0, 0, 14);
  cyl(wheel, m.metalRust, 0.14, 0.14, 0.2, 0, 0, 0, 8);
  box(wheel, m.metalRust, 0.16, 0.06, 0.5, 0.28, 0.12, 0);     // crank pin arm
  g.userData.spin = wheel;
  strut(g, m.metalDark, -1.6, 0.9, 0.6, -2.5, 3.35, 0.1, 0.05, 5); // pitman arm
  // motor + tank + feed pipe + stains
  box(g, m.metalDark, 1.4, 1, 1, -1.8, 0.9, 0);
  cyl(g, m.metalRust, 1.5, 1.5, 3.2, 3.2, 1.6, -2.4, 14);
  strut(g, m.metalDark, 2.8, 0.5, -2.0, 1.3, 0.35, -0.2, 0.12, 6);
  cyl(g, m.metalRust, 0.3, 0.06, 0.3, 2.0, 0.6, -0.8, 8);
  // lattice derrick tower for the classic silhouette
  const tx = -2.6, tz = -2.2, th = 7.2;
  for (const [lx, lz] of [[-0.9, -0.9], [0.9, -0.9], [-0.9, 0.9], [0.9, 0.9]])
    strut(g, m.metalRust, tx + lx, 0, tz + lz, tx + lx * 0.28, th, tz + lz * 0.28, 0.07, 6);
  for (let i = 1; i < 4; i++) {
    const t = i / 4, s = 0.9 - t * 0.62, hy = t * th;
    box(g, m.metalRust, s * 2 + 0.1, 0.09, 0.09, tx, hy, tz - s);
    box(g, m.metalRust, s * 2 + 0.1, 0.09, 0.09, tx, hy, tz + s);
    box(g, m.metalRust, 0.09, 0.09, s * 2 + 0.1, tx - s, hy, tz);
    box(g, m.metalRust, 0.09, 0.09, s * 2 + 0.1, tx + s, hy, tz);
  }
  box(g, m.metalDark, 0.8, 0.5, 0.8, tx, th + 0.2, tz);
  box(g, m.lightLens, 0.16, 0.16, 0.16, tx, th + 0.55, tz);
  decal(g, m.stainMat, 1.3, 1.9, 0.6, 0.05);
  decal(g, m.stainMat, 1.0, 3.6, -0.9, 0.05);
}

let hutN = 0;
function bHut(g) {
  const m = mats();
  const variant = hutN++ % 3;
  const f = flipWrap(g);
  const w = 5 + (variant % 3), d = 4.5 + ((variant * 7) % 3);
  const wall = [m.adobe, m.adobeDark, m.adobePale][variant % 3];
  const trim = variant % 3 === 2 ? m.adobeDark : m.adobePale;
  box(f, wall, w, 3.2, d, 0, 1.6, 0);
  if (variant % 2 === 0) {
    const roof = box(f, m.corrRust, w + 1, 0.22, d + 1.2, 0, 3.5, 0);
    roof.rotation.x = 0.08;
    tireTorus(f, w * 0.25, 3.75, d * 0.2, true, 0.4, 0.16);
    box(f, m.conc, 0.45, 0.28, 0.45, -w * 0.3, 3.78, -d * 0.2);
    box(f, m.conc, 0.45, 0.28, 0.45, w * 0.32, 3.68, -d * 0.32);
  } else {
    box(f, m.adobeDark, w + 0.6, 0.7, d + 0.6, 0, 3.4, 0);
    for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]])
      box(f, trim, 0.5, 3.6, 0.5, sx * w / 2, 1.8, sz * d / 2);
  }
  box(f, m.woodDark, 1.3, 2.3, 0.25, w * 0.2, 1.15, d / 2 + 0.05);
  box(f, m.wood, 1.7, 0.24, 0.36, w * 0.2, 2.4, d / 2 + 0.1);
  box(f, m.dark, 1.1, 0.95, 0.14, -w * 0.25, 2, d / 2 + 0.03);
  box(f, trim, 1.4, 0.16, 0.3, -w * 0.25, 1.42, d / 2 + 0.08);
  box(f, trim, 1.4, 0.18, 0.26, -w * 0.25, 2.58, d / 2 + 0.06);
  if (variant % 3 === 1) {
    const a = new THREE.Mesh(new THREE.PlaneGeometry(3, 2.2), m.awning);
    a.rotation.x = -Math.PI / 2 + 0.35;
    a.position.set(-w * 0.1, 2.6, d / 2 + 1.2);
    a.castShadow = true;
    f.add(a);
    cyl(f, m.wood, 0.06, 0.06, 2.4, -w * 0.1 - 1.4, 1.2, d / 2 + 2.1, 5);
    cyl(f, m.wood, 0.06, 0.06, 2.4, -w * 0.1 + 1.4, 1.2, d / 2 + 2.1, 5);
    box(f, m.wood, 2.4, 0.8, 1, -w * 0.1, 0.4, d / 2 + 1.4);
  }
}

function bMosque(g) {
  const m = mats();
  const f = flipWrap(g, 1.05);
  box(f, m.adobePale, 9, 5.5, 8, 0, 2.75, 0);
  box(f, m.adobe, 9.5, 0.6, 8.5, 0, 0.3, 0);
  dome(f, m.adobe, 3.2, 0, 5.5, 0, 18, 12);
  cyl(f, m.gold, 0.06, 0.06, 0.9, 0, 9.0, 0, 6);
  const dfin = new THREE.Mesh(sphGeo(0.14, 8, 6), m.gold);
  dfin.position.set(0, 9.5, 0);
  f.add(dfin);
  cyl(f, m.adobePale, 0.9, 1.1, 11, 6.4, 5.5, -2.5, 10);
  cyl(f, m.adobe, 1.25, 1.25, 0.8, 6.4, 11.2, -2.5, 10);
  cone(f, m.green, 1.1, 1.8, 6.4, 12.5, -2.5, 10);
  cyl(f, m.gold, 0.05, 0.05, 0.7, 6.4, 13.7, -2.5, 6);
  const mfin = new THREE.Mesh(sphGeo(0.12, 8, 6), m.gold);
  mfin.position.set(6.4, 14.05, -2.5);
  f.add(mfin);
  for (const wx of [-2.8, 2.8]) {
    box(f, m.window, 1.3, 2.4, 0.15, wx, 2.6, 4.05);
    box(f, m.adobe, 1.7, 0.18, 0.34, wx, 1.32, 4.12);
    box(f, m.adobe, 0.2, 2.7, 0.24, wx - 0.83, 2.65, 4.08);
    box(f, m.adobe, 0.2, 2.7, 0.24, wx + 0.83, 2.65, 4.08);
    box(f, m.adobe, 1.7, 0.2, 0.28, wx, 4.0, 4.1);
  }
  box(f, m.woodDark, 1.6, 2.8, 0.2, 0, 1.4, 4.08);
  box(f, m.adobe, 0.24, 3.0, 0.3, -0.95, 1.5, 4.1);
  box(f, m.adobe, 0.24, 3.0, 0.3, 0.95, 1.5, 4.1);
  const ma = new THREE.Mesh(cylGeo(0.95, 0.95, 0.28, 14, false, 0, Math.PI), m.adobe);
  ma.rotation.z = Math.PI / 2; ma.rotation.y = Math.PI / 2;
  ma.position.set(0, 2.85, 4.08);
  ma.castShadow = true;
  f.add(ma);
}

// ================================================================= registry
const BUILDERS = {
  // coalition
  cc_c: bCcC, reactor: bReactor, barracks_c: bBarracksC, supply_c: bSupplyC,
  factory_c: bFactoryC, airfield: bAirfield, patriot: bPatriot, particle: bParticle,
  dozer: (g, o) => vDozer(g, o), truck_c: (g, o) => vTruckC(g, o),
  ranger: (g, o) => soldier(g, o, 'ranger'), missiledef: (g, o) => soldier(g, o, 'missiledef'),
  crusader: (g, o) => vCrusader(g, o), humvee: (g, o) => vHumvee(g, o),
  tomahawk: (g, o) => vTomahawk(g, o), comanche: (g, o) => vComanche(g, o),
  // cartel
  cc_g: bCcG, barracks_g: bBarracksG, supply_g: bSupplyG, armsdealer: bArmsDealer,
  blackmarket: bBlackmarket, stinger: bStinger, tunnel: bTunnel, scudstorm: bScudstorm,
  worker: (g, o) => soldier(g, o, 'worker'), truck_g: (g, o) => vTruckG(g, o),
  rebel: (g, o) => soldier(g, o, 'rebel'), rpg: (g, o) => soldier(g, o, 'rpg'),
  scorpion: (g, o) => vScorpion(g, o), technical: (g, o) => vTechnical(g, o),
  quad: (g, o) => vQuad(g, o), buggy: (g, o) => vBuggy(g, o),
  // neutral
  derrick: (g) => bDerrick(g), hut: (g) => bHut(g), mosque: (g) => bMosque(g),
};

function fallbackMesh(g, def, owner) {
  const m = mats(), A = accents(owner);
  if (def.kind === 'building') {
    const [w, d] = def.size;
    const h = Math.max(4, Math.min(w, d) * 0.55);
    box(g, m.adobe, w * 0.82, h, d * 0.82, 0, h / 2, 0);
    box(g, A.paint, w * 0.84, h * 0.18, d * 0.84, 0, h * 0.82, 0);
  } else {
    const s = def.role === 'infantry' ? 1 : 2.6;
    box(g, m.hullTan, s, s * (def.role === 'infantry' ? 1.8 : 0.8), s * 1.5, 0, def.air ? 0 : s * 0.6, 0);
    if (def.weapon) {
      const turret = new THREE.Group();
      turret.position.y = (def.air ? 0 : s * 0.6) + s * 0.55;
      box(turret, m.gun, 0.25, 0.25, s * 1.6, 0, 0, -s * 0.8);
      g.add(turret);
      g.userData.turret = turret;
      g.userData.muzzle = new THREE.Vector3(0, 0, -s * 1.6);
    }
  }
}

export function buildMesh(def, owner) {
  const g = new THREE.Group();
  const b = BUILDERS[def.id];
  if (b) b(g, owner, def); else fallbackMesh(g, def, owner);
  return g;
}

// ================================================================= rubble
let rubbleN = 0;
export function buildRubble(def) {
  if (def.kind !== 'building') return null;
  const m = mats();
  const g = new THREE.Group();
  const [w, d] = def.size;
  let hash = rubbleN++;
  for (let i = 0; i < def.id.length; i++) hash = (hash * 31 + def.id.charCodeAt(i)) >>> 0;
  const r = makeRng(hash || 1);
  const coalition = def.faction === 'coalition';
  const wallMat = coalition ? m.cPanelDark : m.adobeDark;
  const charMat = m.dark;
  decal(g, m.scorch, Math.max(w, d) * 0.62, 0, 0, 0.06);
  // cracked slab
  const slab = box(g, m.conc, w * 0.7, 0.5, d * 0.7, 0, 0.18, 0);
  slab.rotation.y = (r() - 0.5) * 0.1;
  slab.rotation.z = (r() - 0.5) * 0.04;
  // jagged corner wall stubs
  const corners = [[-1, -1], [1, -1], [-1, 1], [1, 1]].filter(() => r() < 0.7);
  for (const [sx, sz] of corners.slice(0, 3)) {
    const bh = 1.2 + r() * Math.min(3, w * 0.16);
    const st = new THREE.Group();
    st.position.set(sx * w * 0.32, 0, sz * d * 0.32);
    st.rotation.y = (r() - 0.5) * 0.3;
    g.add(st);
    box(st, wallMat, w * 0.22, bh, 0.6, 0, bh / 2, 0);
    box(st, wallMat, w * 0.1, bh * 0.55, 0.62, -w * 0.13, bh * 0.27 + bh * 0.5, 0.01);
    const lean = box(st, wallMat, 0.6, bh * 0.8, d * 0.14, w * 0.13, bh * 0.4, sz * -d * 0.09);
    lean.rotation.x = (r() - 0.5) * 0.2;
  }
  // charred beams leaning through the wreck
  for (let i = 0; i < 4; i++) {
    const bl = box(g, charMat, 0.22, 0.22, 2 + r() * Math.min(6, d * 0.5),
      (r() - 0.5) * w * 0.5, 0.7 + r() * 0.8, (r() - 0.5) * d * 0.5);
    bl.rotation.set((r() - 0.5) * 1.2, r() * 3.14, (r() - 0.5) * 0.5);
  }
  // debris heaps (merged)
  const geos = [], geos2 = [];
  const n = Math.min(16, 6 + Math.floor(w * d * 0.03));
  for (let i = 0; i < n; i++) {
    const s = 0.5 + r() * Math.min(2.2, w * 0.12);
    const ge = new THREE.BoxGeometry(s, s * (0.4 + r() * 0.5), s * (0.7 + r() * 0.6));
    ge.rotateY(r() * 3.14);
    ge.rotateX((r() - 0.5) * 0.5);
    ge.translate((r() - 0.5) * w * 0.62, s * 0.22, (r() - 0.5) * d * 0.62);
    (i % 2 ? geos : geos2).push(ge);
  }
  for (const [gg, mat] of [[geos, wallMat], [geos2, coalition ? m.cSteel : m.wood]]) {
    if (!gg.length) continue;
    const mesh = new THREE.Mesh(mergeGeos(gg), mat);
    mesh.castShadow = mesh.receiveShadow = true;
    g.add(mesh);
  }
  // twisted rebar + a scorched drum
  for (let i = 0; i < 3; i++) {
    const x0 = (r() - 0.5) * w * 0.5, z0 = (r() - 0.5) * d * 0.5;
    strut(g, charMat, x0, 0.1, z0, x0 + (r() - 0.5) * 1.6, 1.0 + r() * 0.8, z0 + (r() - 0.5) * 1.6, 0.035, 5);
  }
  const dr = cyl(g, charMat, 0.42, 0.42, 1.1, w * 0.3 * (r() - 0.5), 0.4, d * 0.36, 10);
  dr.rotation.z = Math.PI / 2 - 0.3;
  return g;
}

// ================================================================= scaffold
export function buildScaffold(def) {
  if (!def || def.kind !== 'building') return null;
  const m = mats();
  const g = new THREE.Group();
  const [w, d] = def.size;
  const hw = w * 0.5 + 0.4, hd = d * 0.5 + 0.4;
  const h = Math.max(3.2, Math.min(w, d) * 0.4);
  const poleMat = m.wood, plankMat = m.woodDark;
  const px = [-hw, 0, hw], pz = [-hd, 0, hd];
  for (const x of px) for (const z of pz) {
    if (x === 0 && z === 0) continue;
    cyl(g, poleMat, 0.07, 0.09, h, x, h / 2, z, 6);
  }
  // plank rings at two levels
  for (const lv of [h * 0.45, h * 0.92]) {
    box(g, plankMat, w + 0.9, 0.1, 0.5, 0, lv, -hd);
    box(g, plankMat, w + 0.9, 0.1, 0.5, 0, lv, hd);
    box(g, plankMat, 0.5, 0.1, d + 0.9, -hw, lv, 0);
    box(g, plankMat, 0.5, 0.1, d + 0.9, hw, lv, 0);
  }
  // corner diagonal braces
  strut(g, poleMat, -hw, 0.2, -hd, -hw + Math.min(3, w * 0.4), h * 0.9, -hd, 0.05, 5);
  strut(g, poleMat, hw, 0.2, hd, hw - Math.min(3, w * 0.4), h * 0.9, hd, 0.05, 5);
  strut(g, poleMat, hw, 0.2, -hd, hw, h * 0.9, -hd + Math.min(3, d * 0.4), 0.05, 5);
  // building-site dressing
  crate(g, m.wood, 1.2, -hw + 1.2, 0.45, hd - 1.0, 0.3);
  crate(g, m.wood, 1.0, -hw + 2.4, 0.4, hd - 1.4, 0.7);
  const tarp = box(g, m.tarp, 2.2, 0.8, 1.6, hw - 1.6, 0.4, -hd + 1.3);
  tarp.rotation.y = 0.4;
  const pallet = box(g, m.wood, 2.0, 0.16, 1.4, hw - 1.8, 0.1, hd - 1.2);
  box(g, def.faction === 'coalition' ? m.cPanelLight : m.adobe, 1.7, 0.7, 1.1, hw - 1.8, 0.55, hd - 1.2);
  if (Math.min(w, d) >= 14) { // big builds get a site crane pole
    cyl(g, m.metalDark, 0.12, 0.16, h + 3, -hw + 0.8, (h + 3) / 2, -hd + 0.8, 8);
    box(g, m.metalDark, 0.2, 0.2, 4.5, -hw + 0.8, h + 2.6, -hd + 2.6);
    strut(g, m.dark, -hw + 0.8, h + 2.5, -hd + 4.6, -hw + 0.8, h + 0.6, -hd + 4.6, 0.03, 5);
    box(g, m.gold, 0.16, 0.3, 0.1, -hw + 0.8, h + 0.4, -hd + 4.6);
  }
  return g;
}
