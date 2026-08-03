// Weapons: procedural viewmodels, hitscan firing, recoil/sway/ADS/reload feel,
// wall buys, mystery box, Pack-a-Punch, frag grenades, knife.
import * as THREE from 'three';
import { makeRng } from './rng.js';

const DEFS = {
  kestrel: {
    name: 'KESTREL .45', type: 'pistol', auto: false, dmg: 30, headMul: 2.6, rpm: 420,
    mag: 8, reserve: 96, reload: 1.5, spread: 0.011, kick: 0.022, adsFov: 58,
    papName: 'WIDOWMAKER-1911', tracer: 0xffc078,
  },
  longarm: {
    name: 'LONGARM', type: 'rifle', auto: false, dmg: 70, headMul: 3.0, rpm: 320,
    mag: 8, reserve: 104, reload: 2.0, spread: 0.006, kick: 0.03, adsFov: 50,
    papName: 'EXECUTIONER-14', tracer: 0xffd890,
  },
  vulture: {
    name: 'VULTURE', type: 'smg', auto: true, dmg: 30, headMul: 2.2, rpm: 780,
    mag: 32, reserve: 224, reload: 2.2, spread: 0.016, kick: 0.014, adsFov: 56,
    papName: 'CARRION STORM', tracer: 0xffb060,
  },
  mauler: {
    name: 'MAULER', type: 'shotgun', auto: false, dmg: 22, pellets: 8, headMul: 1.6, rpm: 82,
    mag: 6, reserve: 60, reload: 2.6, spread: 0.052, kick: 0.062, adsFov: 62,
    papName: 'BONE SAW', tracer: 0xffa050,
  },
  raygun: {
    name: 'RAY GUN', type: 'ray', auto: true, dmg: 140, headMul: 1.5, rpm: 200,
    mag: 20, reserve: 160, reload: 2.4, spread: 0.008, kick: 0.03, adsFov: 60,
    splash: 2.6, papName: 'PORTER\'S X2', tracer: 0x50ff70,
  },
};

export function initWeapons(G) {
  const S = G.weapons = {
    slots: [makeState('kestrel')], cur: 0,
    adsT: 0, fireCd: 0, reloading: 0, swapT: 0,
    swayX: 0, swayY: 0, kickPos: 0, kickRot: 0,
    grenades: 2, maxGrenades: 4, knifeCd: 0, knifeT: 0,
    boxBusy: false, papBusy: false,
    isADS: () => S.adsT > 0.5,
    buyLabel, buyWall, give, current: () => S.slots[S.cur],
  };

  const vm = S.vm = new THREE.Group();
  G.camera.add(vm);
  S.models = {};
  for (const id in DEFS) {
    S.models[id] = buildViewmodel(id, G);
    S.models[id].visible = false;
    vm.add(S.models[id]);
  }
  S.knifeModel = buildKnife(G);
  S.knifeModel.visible = false;
  vm.add(S.knifeModel);

  // muzzle flash light (shared). Position is re-glued to the muzzle every
  // frame while the flash lives, so light + star sprite read as one event.
  S.flashLight = new THREE.PointLight(0xffb050, 0, 8, 2);
  G.scene.add(S.flashLight);
  S.flashT = 0;

  // subtle warm fill parented to the camera so the viewmodel always reads.
  // decay 1 (not 2): tames the inverse-square blowup at viewmodel range so
  // parkerized steel stays steel instead of overexposed beige
  const vmFill = new THREE.PointLight(0xffdcae, 1.45, 2.2, 1);
  vmFill.position.set(0.3, 0.12, -0.06);
  G.camera.add(vmFill);
  // cool moon fill from upper-left: blue-grey sheen on slide/receiver tops
  const vmCool = new THREE.PointLight(0xa9bfe8, 0.9, 2.6, 1);
  vmCool.position.set(-0.35, 0.36, -0.1);
  G.camera.add(vmCool);

  buildMysteryBox(G, S);
  buildPaP(G, S);

  addEventListener('mousedown', (e) => {
    if (!G.locked || G.state !== 'PLAYING') return;
    if (e.button === 0) S.triggerHeld = true, S.triggerEdge = true;
    if (e.button === 2) S.adsHeld = true;
  });
  addEventListener('mouseup', (e) => {
    if (e.button === 0) S.triggerHeld = false;
    if (e.button === 2) S.adsHeld = false;
  });
  addEventListener('contextmenu', (e) => e.preventDefault());
  G.events.on('keydown', (code) => {
    if (G.state !== 'PLAYING') return;
    if (code === 'KeyR') startReload(G, S);
    if (code === 'Digit1' && S.slots.length > 0) switchTo(G, S, 0);
    if (code === 'Digit2' && S.slots.length > 1) switchTo(G, S, 1);
    if (code === 'KeyQ') switchTo(G, S, (S.cur + 1) % S.slots.length);
    if (code === 'KeyG') throwGrenade(G, S);
    if (code === 'KeyV') knife(G, S);
  });

  function makeState(id) {
    const d = DEFS[id];
    return { id, def: d, ammo: d.mag, reserve: d.reserve, pap: false };
  }
  function statsOf(w) {
    const d = w.def;
    const papMul = w.pap ? 2.4 : 1;
    return {
      ...d,
      dmg: d.dmg * papMul,
      mag: Math.round(d.mag * (w.pap ? 1.5 : 1)),
      name: w.pap ? d.papName : d.name,
      rpm: d.rpm * (G.player.perks.has('tap') ? 1.33 : 1),
      reload: d.reload * (G.player.perks.has('speed') ? 0.55 : 1),
      tracer: w.pap ? 0xb060ff : d.tracer,
    };
  }
  S.statsOf = statsOf;

  function buyLabel(id, cost) {
    const owned = S.slots.find(w => w.id === id);
    if (owned) return `<b>F</b> Buy Ammo <b>[${Math.floor(cost / 2)}]</b>`;
    if (id === 'frag') return S.grenades >= S.maxGrenades ? null : `<b>F</b> Buy Frag x2 <b>[${cost}]</b>`;
    return `<b>F</b> Buy ${DEFS[id].name} <b>[${cost}]</b>`;
  }
  function buyWall(id, cost) {
    if (id === 'frag') {
      if (S.grenades >= S.maxGrenades || !G.spendPoints(cost)) return;
      S.grenades = Math.min(S.maxGrenades, S.grenades + 2);
      G.events.emit('ammoChanged'); G.events.emit('purchase');
      return;
    }
    const owned = S.slots.find(w => w.id === id);
    if (owned) {
      if (!G.spendPoints(Math.floor(cost / 2))) return;
      owned.reserve = statsOf(owned).reserve ?? owned.def.reserve;
      owned.reserve = owned.def.reserve * (owned.pap ? 1.5 : 1);
      G.events.emit('ammoChanged'); G.events.emit('purchase');
      return;
    }
    if (!G.spendPoints(cost)) return;
    give(id);
    G.events.emit('purchase');
  }
  function give(id) {
    const w = makeState(id);
    if (S.slots.length < 2) { S.slots.push(w); switchTo(G, S, S.slots.length - 1); }
    else { S.slots[S.cur] = w; switchTo(G, S, S.cur, true); }
    G.events.emit('ammoChanged');
  }
  function switchTo(G, S, i, force) {
    if (i === S.cur && !force && S.slots[i] === S.current()) { S.cur = i; return; }
    S.cur = i;
    S.swapT = 0.28;
    S.reloading = 0;
    G.events.emit('ammoChanged');
    G.events.emit('weaponSwap');
  }
  S.switchTo = (i) => switchTo(G, S, i);
}

// ---------- viewmodel construction ----------
// Inline procedural detail textures (canvas, module-cached, seeded rng — no
// edits to textures.js). BoxGeometry maps the whole canvas onto every face,
// so wear painted along the canvas border reads as worn edges on every part.
const _vmTexCache = new Map();
function vmTex(key, w, h, draw) {
  let t = _vmTexCache.get(key);
  if (t) return t;
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 4;
  _vmTexCache.set(key, t);
  return t;
}
function speckle(x, w, h, rng, base, n, spread) {
  for (let i = 0; i < n; i++) {
    const v = Math.round(rng.range(-spread, spread));
    x.fillStyle = `rgba(${base[0] + v},${base[1] + v},${base[2] + v},${rng.range(0.22, 0.6).toFixed(2)})`;
    x.fillRect(rng() * w, rng() * h, 1 + rng() * 1.7, 1 + rng() * 1.7);
  }
}
function edgeWear(x, w, h, rng, strength) {
  // continuous faint rub line at the very edge…
  x.strokeStyle = `rgba(158,163,167,${0.34 * strength})`;
  x.lineWidth = 2.4;
  x.strokeRect(1.2, 1.2, w - 2.4, h - 2.4);
  x.strokeStyle = `rgba(120,125,130,${0.16 * strength})`;
  x.lineWidth = 5;
  x.strokeRect(3, 3, w - 6, h - 6);
  // …broken by brighter dashes where the finish has rubbed to bare steel
  for (let i = 0; i < 70 * strength; i++) {
    const side = rng.int(0, 3), along = rng() * w;
    const px = side < 2 ? along : side === 2 ? rng.range(0, 4.5) : w - rng.range(0, 4.5) - 5;
    const py = side === 0 ? rng.range(0, 4.5) : side === 1 ? h - rng.range(0, 4.5) - 3 : along;
    x.fillStyle = `rgba(184,188,191,${rng.range(0.22, 0.7).toFixed(2)})`;
    x.fillRect(px, py, side < 2 ? rng.range(2.5, 8) : rng.range(1.5, 3), side < 2 ? rng.range(1.5, 3) : rng.range(2.5, 8));
  }
}
// parkerized (phosphate) steel: matte grey-green, speckled, worn edges
function parkerizedTex(tone) {
  return vmTex('park' + tone, 256, 256, (x, w, h) => {
    const rng = makeRng(4100 + tone);
    const base = tone ? [64, 68, 71] : [47, 51, 54];
    x.fillStyle = `rgb(${base[0]},${base[1]},${base[2]})`;
    x.fillRect(0, 0, w, h);
    speckle(x, w, h, rng, [base[0] + 5, base[1] + 6, base[2] + 4], 2600, 15);
    // faint machining brush
    for (let i = 0; i < 44; i++) {
      x.strokeStyle = `rgba(${base[0] + 24},${base[1] + 26},${base[2] + 28},${rng.range(0.04, 0.1).toFixed(2)})`;
      x.lineWidth = 1;
      const px = rng() * w;
      x.beginPath(); x.moveTo(px, 0); x.lineTo(px + rng.range(-7, 7), h); x.stroke();
    }
    // a few scratches through the finish
    for (let i = 0; i < 11; i++) {
      x.strokeStyle = `rgba(146,150,154,${rng.range(0.1, 0.28).toFixed(2)})`;
      x.lineWidth = 1;
      const sx = rng() * w, sy = rng() * h;
      x.beginPath(); x.moveTo(sx, sy); x.lineTo(sx + rng.range(-34, 34), sy + rng.range(-11, 11)); x.stroke();
    }
    edgeWear(x, w, h, rng, tone ? 0.8 : 1.15);
  });
}
// diamond-checkered grip panel (dark walnut/bakelite)
function checkerTex() {
  return vmTex('checker', 128, 128, (x, w, h) => {
    const rng = makeRng(4200);
    x.fillStyle = '#271d13';
    x.fillRect(0, 0, w, h);
    speckle(x, w, h, rng, [58, 42, 26], 320, 12);
    x.lineWidth = 2;
    for (let d = -h; d < w + h; d += 9) {
      x.strokeStyle = 'rgba(9,6,3,0.85)';
      x.beginPath(); x.moveTo(d, 0); x.lineTo(d + h, h); x.stroke();
      x.beginPath(); x.moveTo(d, h); x.lineTo(d + h, 0); x.stroke();
      x.strokeStyle = 'rgba(128,98,60,0.28)';
      x.beginPath(); x.moveTo(d + 2, 0); x.lineTo(d + h + 2, h); x.stroke();
      x.beginPath(); x.moveTo(d + 2, h); x.lineTo(d + h + 2, 0); x.stroke();
    }
    // raised border frame
    x.strokeStyle = 'rgba(16,11,6,0.9)'; x.lineWidth = 7; x.strokeRect(3, 3, w - 6, h - 6);
    x.strokeStyle = 'rgba(124,96,60,0.4)'; x.lineWidth = 1.5; x.strokeRect(7, 7, w - 14, h - 14);
  });
}
// worn dark leather glove: mottle, crease lines, stitch rows
function gloveTex() {
  return vmTex('glove', 128, 128, (x, w, h) => {
    const rng = makeRng(4300);
    x.fillStyle = '#241b12';
    x.fillRect(0, 0, w, h);
    for (let i = 0; i < 430; i++) {
      const v = rng.range(-8, 14);
      x.fillStyle = `rgba(${42 + v},${32 + v * 0.8},${21 + v * 0.6},0.35)`;
      x.fillRect(rng() * w, rng() * h, 2 + rng() * 3.5, 1 + rng() * 2.5);
    }
    for (let i = 0; i < 13; i++) {
      x.strokeStyle = `rgba(12,8,5,${rng.range(0.28, 0.5).toFixed(2)})`;
      x.lineWidth = 1 + rng();
      const sy = rng() * h;
      x.beginPath(); x.moveTo(0, sy);
      x.quadraticCurveTo(w / 2, sy + rng.range(-15, 15), w, sy + rng.range(-9, 9));
      x.stroke();
    }
    // worn-shiny knuckle highlights
    for (let i = 0; i < 5; i++) {
      const g = x.createRadialGradient(16 + i * 24, 36, 1, 16 + i * 24, 36, 11);
      g.addColorStop(0, 'rgba(116,94,64,0.32)'); g.addColorStop(1, 'rgba(0,0,0,0)');
      x.fillStyle = g; x.fillRect(0, 0, w, h);
    }
    x.strokeStyle = 'rgba(98,80,52,0.55)'; x.lineWidth = 1; x.setLineDash([3, 3]);
    x.strokeRect(4, 4, w - 8, h - 8);
    x.setLineDash([]);
  });
}
// stamped magazine body: parkerized + horizontal witness ribs
function magTex() {
  return vmTex('mag', 128, 128, (x, w, h) => {
    const rng = makeRng(4400);
    x.fillStyle = 'rgb(56,59,62)';
    x.fillRect(0, 0, w, h);
    speckle(x, w, h, rng, [60, 63, 66], 850, 13);
    for (let ry = 16; ry < h - 8; ry += 24) {
      x.fillStyle = 'rgba(19,21,23,0.85)'; x.fillRect(0, ry, w, 3.5);
      x.fillStyle = 'rgba(150,154,158,0.4)'; x.fillRect(0, ry + 3.5, w, 2);
    }
    edgeWear(x, w, h, rng, 0.8);
  });
}
// perforated cooling shroud (wraps a cylinder: rings of vent slots)
function shroudTex() {
  return vmTex('shroud', 128, 64, (x, w, h) => {
    const rng = makeRng(4500);
    x.fillStyle = 'rgb(45,48,51)';
    x.fillRect(0, 0, w, h);
    speckle(x, w, h, rng, [48, 51, 54], 460, 12);
    for (let row = 0; row < 2; row++) {
      const cy = h * (row === 0 ? 0.28 : 0.72);
      for (let i = 0; i < 5; i++) {
        const cx = (i + 0.5) * (w / 5);
        x.fillStyle = 'rgba(158,162,166,0.6)';
        x.beginPath(); x.ellipse(cx, cy + 2, 10.5, 5.2, 0, 0, 7); x.fill();
        x.fillStyle = 'rgb(6,7,8)';
        x.beginPath(); x.ellipse(cx, cy, 10.5, 4.9, 0, 0, 7); x.fill();
      }
    }
  });
}
// muzzle brake / suppressor can: machined rings
function brakeTex() {
  return vmTex('brake', 64, 64, (x, w, h) => {
    const rng = makeRng(4600);
    x.fillStyle = 'rgb(31,32,34)';
    x.fillRect(0, 0, w, h);
    speckle(x, w, h, rng, [34, 35, 37], 260, 10);
    for (let ry = 5; ry < h - 3; ry += 9) {
      x.fillStyle = 'rgba(9,9,10,0.85)'; x.fillRect(0, ry, w, 2.5);
      x.fillStyle = 'rgba(118,122,126,0.28)'; x.fillRect(0, ry + 2.5, w, 1.2);
    }
  });
}
// hot-gas glow strip for the barrel-glow planes (hot at u=1, fades back)
function glowStripTex() {
  return vmTex('glowstrip', 64, 32, (x, w, h) => {
    const g = x.createLinearGradient(0, 0, w, 0);
    g.addColorStop(0, 'rgba(255,120,30,0)');
    g.addColorStop(0.55, 'rgba(255,160,60,0.38)');
    g.addColorStop(1, 'rgba(255,222,150,0.95)');
    x.fillStyle = g; x.fillRect(0, 0, w, h);
    const g2 = x.createLinearGradient(0, 0, 0, h);
    g2.addColorStop(0, 'rgba(0,0,0,1)'); g2.addColorStop(0.4, 'rgba(0,0,0,0)');
    g2.addColorStop(0.6, 'rgba(0,0,0,0)'); g2.addColorStop(1, 'rgba(0,0,0,1)');
    x.globalCompositeOperation = 'destination-out';
    x.fillStyle = g2; x.fillRect(0, 0, w, h);
  });
}

// shared viewmodel materials (built once; box-roll rebuilds reuse them)
let _vmMats = null;
function vmMats(G) {
  if (_vmMats) return _vmMats;
  const M = _vmMats = {};
  M.parkDark = new THREE.MeshStandardMaterial({ map: parkerizedTex(0), roughness: 0.52, metalness: 0.72 });
  M.parkMid = new THREE.MeshStandardMaterial({ map: parkerizedTex(1), roughness: 0.56, metalness: 0.64 });
  M.steel = new THREE.MeshStandardMaterial({ color: 0x878e95, roughness: 0.3, metalness: 0.95 });
  M.black = new THREE.MeshStandardMaterial({ color: 0x0d0e10, roughness: 0.88, metalness: 0.25 });
  M.grip = new THREE.MeshStandardMaterial({ map: checkerTex(), roughness: 0.82, metalness: 0.05 });
  M.mag = new THREE.MeshStandardMaterial({ map: magTex(), roughness: 0.5, metalness: 0.7 });
  M.shroud = new THREE.MeshStandardMaterial({ map: shroudTex(), roughness: 0.55, metalness: 0.7 });
  M.brake = new THREE.MeshStandardMaterial({ map: brakeTex(), roughness: 0.58, metalness: 0.62 });
  M.glove = new THREE.MeshStandardMaterial({ map: gloveTex(), roughness: 0.92, metalness: 0 });
  M.cuff = new THREE.MeshStandardMaterial({ color: 0x30342a, roughness: 1 });
  M.wood = new THREE.MeshStandardMaterial({ color: 0x5f4429, roughness: 0.62, map: G.mats?.wood?.map });
  // pale iron-sight dot: faint emissive so the post/notch read at hip at night
  M.sightDot = new THREE.MeshStandardMaterial({ color: 0xe6dec6, roughness: 0.5, emissive: 0x57513c, emissiveIntensity: 0.55 });
  M.red = new THREE.MeshStandardMaterial({ color: 0x7e1d13, roughness: 0.38, metalness: 0.75 });
  M.glow = new THREE.MeshStandardMaterial({ color: 0x30ff60, emissive: 0x22cc44, emissiveIntensity: 2.2 });
  return M;
}

// 4-point star flash texture (shared)
let _starTex = null;
function starTexture() {
  if (_starTex) return _starTex;
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const x = c.getContext('2d');
  const g = x.createRadialGradient(64, 64, 2, 64, 64, 24);
  g.addColorStop(0, 'rgba(255,255,230,1)');
  g.addColorStop(0.4, 'rgba(255,190,90,0.8)');
  g.addColorStop(1, 'rgba(255,140,40,0)');
  x.fillStyle = g; x.beginPath(); x.arc(64, 64, 24, 0, 7); x.fill();
  x.translate(64, 64);
  for (let i = 0; i < 4; i++) {
    const lg = x.createLinearGradient(0, 0, 62, 0);
    lg.addColorStop(0, 'rgba(255,230,170,0.95)');
    lg.addColorStop(1, 'rgba(255,150,50,0)');
    x.fillStyle = lg;
    x.beginPath(); x.moveTo(0, -3.8); x.lineTo(62, 0); x.lineTo(0, 3.8); x.closePath(); x.fill();
    x.rotate(Math.PI / 2);
  }
  _starTex = new THREE.CanvasTexture(c);
  _starTex.colorSpace = THREE.SRGBColorSpace;
  return _starTex;
}

// mesh helpers targeting an arbitrary group
function _mkBox(target, mat, sx, sy, sz, x, y, z, rx = 0, ry = 0, rz = 0) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), mat);
  m.position.set(x, y, z); m.rotation.set(rx, ry, rz);
  target.add(m); return m;
}
function _mkCyl(target, mat, r0, r1, len, x, y, z, rx = Math.PI / 2, seg = 14) {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(r0, r1, len, seg), mat);
  m.position.set(x, y, z); m.rotation.x = rx;
  target.add(m); return m;
}
// trigger-guard loop: partial torus standing in the YZ plane
function _mkGuard(target, mat, r, x, y, z, spin = 2.4) {
  const m = new THREE.Mesh(new THREE.TorusGeometry(r, 0.0042, 6, 14, Math.PI * 1.6), mat);
  m.position.set(x, y, z);
  m.rotation.set(spin, Math.PI / 2, 0);
  target.add(m); return m;
}
// 4-6 thin raised serration ridges (shared geometry per call)
function _mkSerrations(target, mat, n, sx, sy, z0, dz, y) {
  const geo = new THREE.BoxGeometry(sx, sy, 0.0042);
  for (let i = 0; i < n; i++) {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(0, y, z0 + i * dz);
    target.add(m);
  }
}

// Firing hand wrapped around a pistol grip. Origin sits at the grip's center;
// rake should match the grip's rotation.x. ~7 boxes: palm, 4 finger ridges,
// thumb, jacket cuff.
function addGripHand(g, M, x, y, z, rake = 0, s = 1) {
  const hand = new THREE.Group();
  hand.position.set(x, y, z);
  hand.rotation.x = rake;
  hand.scale.setScalar(s);
  // palm hugging the right side of the grip
  _mkBox(hand, M.glove, 0.027, 0.082, 0.06, 0.029, -0.01, 0.008, 0, 0, -0.08);
  // four fingers wrapping the front strap — the ridged silhouette
  for (let i = 0; i < 4; i++) {
    const t = i / 3;
    _mkBox(hand, M.glove, 0.057 - t * 0.007, 0.0165, 0.031,
      0.002 - t * 0.004, 0.027 - i * 0.0205, -0.032, 0, -0.09 - t * 0.12, 0.05);
  }
  // thumb locked high over the left panel
  _mkBox(hand, M.glove, 0.017, 0.05, 0.021, -0.023, 0.02, 0.008, 0.3, 0, 0.42);
  // hint of jacket cuff at the wrist, trailing down-right off frame
  _mkBox(hand, M.cuff, 0.064, 0.064, 0.054, 0.05, -0.098, 0.068, 0.28, 0, -0.2);
  g.add(hand);
  return hand;
}
// Support hand cupped under a forend: palm below, finger ridges curling up
// the far side, thumb on the near side, cuff behind.
function addSupportHand(g, M, x, y, z, s = 1) {
  const hand = new THREE.Group();
  hand.position.set(x, y, z);
  hand.scale.setScalar(s);
  _mkBox(hand, M.glove, 0.05, 0.025, 0.064, 0.005, -0.016, 0, 0, 0, 0.09);
  for (let i = 0; i < 4; i++) {
    _mkBox(hand, M.glove, 0.0155, 0.048, 0.0185,
      -0.0245, 0.008, -0.026 + i * 0.019, (i - 1.5) * 0.05, 0, 0.3);
  }
  _mkBox(hand, M.glove, 0.0145, 0.042, 0.02, 0.029, 0.002, 0.012, 0, 0, -0.26);
  _mkBox(hand, M.cuff, 0.062, 0.068, 0.054, 0.012, -0.08, 0.046, 0.5, 0, -0.15);
  g.add(hand);
  return hand;
}

function buildViewmodel(id, G, { hands = true } = {}) {
  const g = new THREE.Group();
  const M = vmMats(G);
  const box = (mat, sx, sy, sz, x, y, z, rx = 0, ry = 0, rz = 0) => _mkBox(g, mat, sx, sy, sz, x, y, z, rx, ry, rz);
  const cyl = (mat, r0, r1, len, x, y, z, rx = Math.PI / 2) => _mkCyl(g, mat, r0, r1, len, x, y, z, rx);
  const parts = g.userData;

  if (id === 'kestrel') {
    // ---- .45 service pistol: parkerized slide over a worn frame ----
    parts.slide = box(M.parkDark, 0.046, 0.048, 0.235, 0, 0.048, -0.028);
    _mkSerrations(g, M.black, 5, 0.05, 0.038, 0.052, 0.0095, 0.048);   // rear cocking serrations
    box(M.black, 0.0025, 0.024, 0.052, 0.0235, 0.056, -0.055);         // ejection port recess (right)
    box(M.steel, 0.016, 0.006, 0.03, -0.0235, 0.032, -0.012);          // slide stop lever (left)
    box(M.parkMid, 0.042, 0.04, 0.17, 0, 0.012, -0.005);               // frame
    box(M.parkDark, 0.024, 0.014, 0.024, 0, 0.026, 0.085, 0.5);        // beavertail wedge
    cyl(M.steel, 0.011, 0.011, 0.014, 0, 0.048, -0.152);               // barrel bushing
    cyl(M.steel, 0.008, 0.008, 0.032, 0, 0.048, -0.169);               // barrel, proud of the slide
    _mkGuard(g, M.parkMid, 0.02, 0, -0.006, -0.032, 2.5);              // trigger guard loop
    box(M.steel, 0.006, 0.016, 0.005, 0, -0.004, -0.028);              // trigger
    box(M.parkDark, 0.034, 0.105, 0.05, 0, -0.055, 0.062, -0.18);      // grip frame
    box(M.grip, 0.005, 0.082, 0.04, 0.0195, -0.057, 0.06, -0.18);      // checkered panel R
    box(M.grip, 0.005, 0.082, 0.04, -0.0195, -0.057, 0.06, -0.18);     // checkered panel L
    box(M.steel, 0.012, 0.022, 0.006, 0, 0.054, 0.097, 0.55);          // hammer, cocked
    box(M.parkDark, 0.0065, 0.015, 0.007, 0, 0.0785, -0.132);          // front sight post
    box(M.sightDot, 0.0068, 0.006, 0.002, 0, 0.081, -0.1285);          // pale front dot
    box(M.parkDark, 0.024, 0.007, 0.012, 0, 0.0755, 0.082);            // rear sight base
    box(M.parkDark, 0.007, 0.011, 0.012, 0.0085, 0.081, 0.082);        // rear notch ear R
    box(M.parkDark, 0.007, 0.011, 0.012, -0.0085, 0.081, 0.082);       // rear notch ear L
    const mag = new THREE.Group();                                     // magazine w/ base plate
    _mkBox(mag, M.mag, 0.028, 0.1, 0.04, 0, -0.012, 0.002);
    _mkBox(mag, M.parkDark, 0.038, 0.011, 0.056, 0, -0.063, 0);
    mag.position.set(0, -0.055, 0.062); mag.rotation.x = -0.18;
    g.add(mag); parts.mag = mag;
    parts.muzzle = new THREE.Vector3(0, 0.048, -0.19);
    if (hands) addGripHand(g, M, 0, -0.052, 0.064, -0.18);
  } else if (id === 'longarm') {
    // ---- bolt rifle: walnut furniture, parkerized action ----
    box(M.wood, 0.048, 0.06, 0.44, 0, -0.008, 0.09);                   // stock + forend
    box(M.wood, 0.048, 0.085, 0.15, 0, -0.035, 0.335, 0.12);           // buttstock
    parts.slide = box(M.parkDark, 0.046, 0.05, 0.2, 0, 0.043, 0);      // receiver
    box(M.black, 0.002, 0.02, 0.05, 0.0235, 0.05, 0);                  // ejection port recess
    _mkCyl(g, M.steel, 0.0045, 0.0045, 0.032, 0.036, 0.048, 0.042, 0, 10).rotation.z = Math.PI / 2; // bolt handle
    const knob = new THREE.Mesh(new THREE.SphereGeometry(0.0095, 8, 8), M.steel);
    knob.position.set(0.054, 0.042, 0.042); g.add(knob);               // bolt knob
    cyl(M.parkDark, 0.0105, 0.0125, 0.34, 0, 0.052, -0.3);             // barrel
    box(M.parkMid, 0.052, 0.075, 0.012, 0, 0.01, -0.115);              // barrel band
    box(M.parkDark, 0.006, 0.018, 0.007, 0, 0.086, -0.44);             // front sight post
    box(M.sightDot, 0.0063, 0.006, 0.002, 0, 0.09, -0.4365);           // pale front dot
    box(M.parkDark, 0.026, 0.006, 0.014, 0, 0.072, 0.088);             // rear sight base
    box(M.parkDark, 0.0075, 0.012, 0.014, 0.009, 0.078, 0.088);        // rear notch ears
    box(M.parkDark, 0.0075, 0.012, 0.014, -0.009, 0.078, 0.088);
    _mkGuard(g, M.parkMid, 0.019, 0, -0.042, 0.1, 2.6);                // trigger guard
    box(M.steel, 0.005, 0.014, 0.005, 0, -0.04, 0.096);                // trigger
    const mag = new THREE.Group();                                     // box magazine
    _mkBox(mag, M.mag, 0.036, 0.05, 0.08, 0, 0, 0);
    _mkBox(mag, M.parkDark, 0.04, 0.01, 0.086, 0, -0.028, 0);
    mag.position.set(0, -0.052, 0.028);
    g.add(mag); parts.mag = mag;
    parts.muzzle = new THREE.Vector3(0, 0.052, -0.48);
    if (hands) {
      addGripHand(g, M, 0, -0.05, 0.17, -0.38, 0.98);
      addSupportHand(g, M, 0, -0.028, -0.1);
    }
  } else if (id === 'vulture') {
    // ---- tube-receiver SMG: stamped lower, perforated shroud, slotted brake ----
    box(M.parkMid, 0.044, 0.048, 0.3, 0, 0.008, -0.02);                // stamped lower receiver
    const tube = cyl(M.parkDark, 0.026, 0.026, 0.3, 0, 0.048, -0.045); // upper receiver tube
    parts.slide = tube;
    _mkCyl(g, M.steel, 0.0045, 0.0045, 0.026, 0.036, 0.052, 0.02, 0, 8).rotation.z = Math.PI / 2; // charging handle
    box(M.black, 0.002, 0.018, 0.05, 0.026, 0.052, -0.09);             // ejection port recess
    _mkSerrations(g, M.black, 4, 0.048, 0.028, 0.072, 0.011, 0.008);   // grasping ridges, rear lower
    cyl(M.shroud, 0.0165, 0.0165, 0.15, 0, 0.048, -0.26);              // perforated cooling shroud
    cyl(M.steel, 0.0075, 0.0075, 0.05, 0, 0.048, -0.35);               // barrel
    cyl(M.brake, 0.014, 0.014, 0.055, 0, 0.048, -0.375);               // slotted muzzle brake
    box(M.parkDark, 0.006, 0.02, 0.007, 0, 0.075, -0.21);              // front sight post
    box(M.sightDot, 0.0063, 0.006, 0.002, 0, 0.0805, -0.2065);         // pale front dot
    box(M.parkDark, 0.0045, 0.024, 0.009, 0.0105, 0.074, -0.21, 0, 0, -0.16); // sight ear R
    box(M.parkDark, 0.0045, 0.024, 0.009, -0.0105, 0.074, -0.21, 0, 0, 0.16); // sight ear L
    box(M.parkDark, 0.024, 0.007, 0.013, 0, 0.0735, 0.075);            // rear sight base on tube
    box(M.parkDark, 0.0065, 0.013, 0.01, 0.008, 0.08, 0.075);          // rear notch ears
    box(M.parkDark, 0.0065, 0.013, 0.01, -0.008, 0.08, 0.075);
    box(M.parkMid, 0.048, 0.034, 0.075, 0, -0.036, 0.02, -0.3);        // flared mag well
    const mag = new THREE.Group();                                     // long stick mag + plate
    _mkBox(mag, M.mag, 0.03, 0.15, 0.056, 0, -0.085, 0);
    _mkBox(mag, M.parkDark, 0.036, 0.012, 0.064, 0, -0.164, 0);
    mag.position.set(0, -0.04, 0.02); mag.rotation.x = -0.3;
    g.add(mag); parts.mag = mag;
    // period SMG hold: support hand grips the magazine (rides the mag group,
    // so it pulls the mag out and seats it again during reloads)
    if (hands) addGripHand(mag, M, 0.002, -0.075, 0.004, 0, 0.92);
    box(M.parkMid, 0.032, 0.095, 0.048, 0, -0.052, 0.102, -0.14);      // grip frame
    box(M.grip, 0.005, 0.075, 0.038, 0.0185, -0.05, 0.1, -0.14);       // checkered panel R
    box(M.grip, 0.005, 0.075, 0.038, -0.0185, -0.05, 0.1, -0.14);      // checkered panel L
    _mkGuard(g, M.parkMid, 0.019, 0, -0.008, 0.055, 2.5);              // trigger guard
    box(M.parkMid, 0.01, 0.014, 0.13, 0, 0.0, 0.195, 0.08);            // folding stock strut
    parts.muzzle = new THREE.Vector3(0, 0.048, -0.408);
    if (hands) addGripHand(g, M, 0, -0.05, 0.104, -0.14);
  } else if (id === 'mauler') {
    // ---- pump shotgun: twin tubes, ribbed slide, walnut stock ----
    box(M.wood, 0.045, 0.06, 0.24, 0, -0.012, 0.18);                   // stock wrist
    box(M.wood, 0.05, 0.082, 0.13, 0, -0.038, 0.305, 0.14);            // butt
    parts.slide = box(M.parkDark, 0.05, 0.062, 0.22, 0, 0.03, -0.02);  // receiver
    box(M.black, 0.002, 0.022, 0.06, 0.0255, 0.035, -0.02);            // ejection port recess
    cyl(M.parkDark, 0.0135, 0.0135, 0.4, 0, 0.052, -0.3);              // barrel
    cyl(M.parkMid, 0.012, 0.012, 0.34, 0, 0.018, -0.28);               // under-barrel tube mag
    box(M.parkMid, 0.032, 0.052, 0.013, 0, 0.036, -0.442);             // barrel clamp
    _mkCyl(g, M.sightDot, 0.0032, 0.0032, 0.008, 0, 0.069, -0.49, 0, 8); // brass bead sight
    _mkGuard(g, M.parkMid, 0.02, 0, -0.014, 0.032, 2.5);               // trigger guard
    box(M.steel, 0.006, 0.015, 0.005, 0, -0.01, 0.026);                // trigger
    const pump = new THREE.Group();                                    // ribbed pump handle
    _mkBox(pump, M.mag, 0.042, 0.042, 0.13, 0, 0, 0);
    _mkBox(pump, M.parkDark, 0.046, 0.046, 0.014, 0, 0, -0.062);
    pump.position.set(0, 0.018, -0.2);
    g.add(pump); parts.mag = pump;
    parts.muzzle = new THREE.Vector3(0, 0.052, -0.52);
    if (hands) {
      addGripHand(g, M, 0, -0.045, 0.155, -0.45, 0.98);
      addSupportHand(g, M, 0, -0.012, -0.19);
    }
  } else if (id === 'raygun') {
    // ---- ray gun: keep the pulp look, ground it with real furniture ----
    parts.slide = box(M.red, 0.06, 0.075, 0.26, 0, 0.02, -0.04);       // body
    cyl(M.red, 0.035, 0.05, 0.12, 0, 0.02, -0.2);                      // bulb front
    cyl(M.brake, 0.014, 0.02, 0.1, 0, 0.02, -0.28);                    // emitter throat
    const coil = new THREE.Mesh(new THREE.TorusGeometry(0.045, 0.008, 8, 16), M.glow);
    coil.position.set(0, 0.02, -0.13); g.add(coil);
    const coil2 = coil.clone(); coil2.position.z = -0.17; coil2.scale.setScalar(0.85); g.add(coil2);
    box(M.parkDark, 0.02, 0.05, 0.09, 0, 0.065, 0.03);                 // top fin
    const dial = new THREE.Mesh(new THREE.SphereGeometry(0.02, 8, 8), M.glow);
    dial.position.set(0, 0.098, 0.03); g.add(dial);
    box(M.parkMid, 0.034, 0.095, 0.05, 0, -0.062, 0.075, -0.2);        // grip frame
    box(M.grip, 0.005, 0.075, 0.04, 0.0185, -0.06, 0.073, -0.2);       // checkered panels
    box(M.grip, 0.005, 0.075, 0.04, -0.0185, -0.06, 0.073, -0.2);
    _mkGuard(g, M.red, 0.02, 0, -0.02, 0.022, 2.5);                    // trigger guard
    const mag = new THREE.Group();                                     // cell pack
    _mkBox(mag, M.mag, 0.03, 0.06, 0.045, 0, -0.01, 0);
    _mkBox(mag, M.parkDark, 0.036, 0.01, 0.05, 0, -0.042, 0);
    mag.position.set(0, -0.11, 0.075); mag.rotation.x = -0.2;
    g.add(mag); parts.mag = mag;
    parts.muzzle = new THREE.Vector3(0, 0.02, -0.34);
    if (hands) {
      addGripHand(g, M, 0, -0.058, 0.077, -0.2);
      addSupportHand(g, M, 0, -0.045, -0.12);
    }
  }

  // star muzzle flash + barrel-glow blades, all one group at the exact muzzle
  if (parts.muzzle) {
    const fg = new THREE.Group();
    fg.position.copy(parts.muzzle);
    const ray = id === 'raygun';
    const fmat = new THREE.MeshBasicMaterial({
      map: starTexture(), transparent: true, blending: THREE.AdditiveBlending,
      depthWrite: false, color: ray ? 0x60ff90 : 0xffffff,
    });
    const f1 = new THREE.Mesh(new THREE.PlaneGeometry(0.3, 0.3), fmat);
    const f2 = new THREE.Mesh(new THREE.PlaneGeometry(0.24, 0.24), fmat);
    f2.rotation.z = 0.7; f2.position.z = -0.02;
    const f3 = new THREE.Mesh(new THREE.PlaneGeometry(0.27, 0.27), fmat);
    f3.rotation.y = Math.PI / 2; // side-visible blade
    fg.add(f1, f2, f3);
    // brief hot-gas glow hugging the last stretch of barrel (crossed blades;
    // texture is hot at the muzzle end and fades toward the receiver)
    const gmat = new THREE.MeshBasicMaterial({
      map: glowStripTex(), transparent: true, blending: THREE.AdditiveBlending,
      depthWrite: false, color: ray ? 0x50e080 : 0xffb868, side: THREE.DoubleSide,
    });
    const gGeo = new THREE.PlaneGeometry(0.2, 0.05);
    gGeo.rotateY(Math.PI / 2); // length along z, hot end (u=1) toward -z
    const b1 = new THREE.Mesh(gGeo, gmat);
    b1.position.z = 0.085;
    const b2 = new THREE.Mesh(gGeo, gmat);
    b2.position.z = 0.085; b2.rotation.z = Math.PI / 2;
    fg.add(b1, b2);
    fg.visible = false;
    g.add(fg);
    parts.flash = fg;
  }
  g.scale.setScalar(0.82);
  g.traverse(o => { o.frustumCulled = false; o.castShadow = false; o.receiveShadow = false; o.userData.noBlock = true; });
  return g;
}

function buildKnife(G) {
  const g = new THREE.Group();
  const M = vmMats(G);
  const steelMat = new THREE.MeshStandardMaterial({ color: 0xb0b5bb, roughness: 0.28, metalness: 0.9 });
  const edgeMat = new THREE.MeshStandardMaterial({ color: 0xd8dce0, roughness: 0.16, metalness: 0.95 });
  _mkBox(g, steelMat, 0.011, 0.04, 0.21, 0, 0.004, -0.15);   // blade flat
  _mkBox(g, edgeMat, 0.0045, 0.012, 0.19, 0, -0.018, -0.145); // ground edge catches light
  _mkBox(g, M.black, 0.0118, 0.007, 0.14, 0, 0.012, -0.12);  // fuller
  _mkBox(g, steelMat, 0.05, 0.011, 0.013, 0, -0.002, -0.042); // crossguard
  _mkBox(g, M.glove, 0.024, 0.036, 0.1, 0, -0.006, 0.012);   // leather-wrapped handle
  _mkBox(g, steelMat, 0.027, 0.03, 0.015, 0, -0.008, 0.068); // pommel
  addGripHand(g, vmMats(G), 0, -0.02, 0.012, 0.08, 0.8);
  g.traverse(o => { o.frustumCulled = false; o.userData.noBlock = true; });
  return g;
}

// ---------- mystery box & PaP props ----------
function buildMysteryBox(G, S) {
  const { pos, rotY } = G.world.mysteryBox;
  const g = new THREE.Group();
  g.position.copy(pos); g.rotation.y = rotY;
  const body = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.75, 0.8), G.mats.woodOld);
  body.position.y = 0.42;
  const lid = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.16, 0.8), G.mats.wood);
  lid.position.set(0, 0.86, 0);
  const lidPivot = new THREE.Group(); lidPivot.position.set(0, 0.78, -0.4);
  lid.position.set(0, 0.08, 0.4); lidPivot.add(lid);
  const rim = new THREE.Mesh(new THREE.BoxGeometry(1.74, 0.05, 0.84),
    new THREE.MeshStandardMaterial({ color: 0x66aaff, emissive: 0x3366ff, emissiveIntensity: 1.6 }));
  rim.position.y = 0.8;
  const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.2, 7, 10, 1, true),
    new THREE.MeshBasicMaterial({ color: 0x4477ee, transparent: true, opacity: 0.04, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
  beam.position.y = 3.8;
  const qm = new THREE.PointLight(0x4477ff, 3, 7, 2); qm.position.y = 1.4;
  g.add(body, lidPivot, rim, beam, qm);
  body.castShadow = body.receiveShadow = true;
  G.scene.add(g);
  G.world.colliders.push({ min: new THREE.Vector3(pos.x - 0.9, 0, pos.z - 0.5), max: new THREE.Vector3(pos.x + 0.9, 0.9, pos.z + 0.5) });
  S.box = { group: g, lidPivot, beam, displayed: null, state: 'idle', t: 0, resultId: null };

  G.world.interactables.push({
    id: 'mysterybox', pos: pos.clone().setY(1), radius: 2.2,
    getLabel: (G) => {
      if (S.box.state === 'idle') return '<b>F</b> Mystery Box <b>[950]</b>';
      if (S.box.state === 'done') return `<b>F</b> Take ${DEFS[S.box.resultId].name}`;
      return null;
    },
    use: (G) => {
      if (S.box.state === 'idle') {
        if (!G.spendPoints(950)) return;
        S.box.state = 'rolling'; S.box.t = 0;
        G.events.emit('boxRoll');
      } else if (S.box.state === 'done') {
        G.weapons.give(S.box.resultId);
        S.box.state = 'closing'; S.box.t = 0;
        G.events.emit('boxTake');
      }
    },
  });
}

function buildPaP(G, S) {
  const { pos, rotY } = G.world.paP;
  const g = new THREE.Group();
  g.position.copy(pos); g.rotation.y = rotY;
  const body = new THREE.Mesh(new THREE.BoxGeometry(2.0, 1.1, 0.9),
    new THREE.MeshStandardMaterial({ color: 0x22262c, roughness: 0.4, metalness: 0.6 }));
  body.position.y = 0.65;
  const roll1 = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 1.7, 10),
    new THREE.MeshStandardMaterial({ color: 0x3a4048, metalness: 0.8, roughness: 0.3 }));
  roll1.rotation.z = Math.PI / 2; roll1.position.set(0, 1.28, 0);
  const runes = new THREE.Mesh(new THREE.PlaneGeometry(1.9, 0.5),
    new THREE.MeshStandardMaterial({ color: 0x8040ff, emissive: 0x6a30e0, emissiveIntensity: 0.06, transparent: true, opacity: 0.9 }));
  runes.position.set(0, 0.75, 0.46);
  const pl = new THREE.PointLight(0x8040ff, 0, 8, 2); pl.position.y = 1.6;
  g.add(body, roll1, runes, pl);
  body.castShadow = body.receiveShadow = true;
  G.scene.add(g);
  G.world.colliders.push({ min: new THREE.Vector3(pos.x - 1.1, 0, pos.z - 0.55), max: new THREE.Vector3(pos.x + 1.1, 1.3, pos.z + 0.55) });
  G.world.powerLights.push({ mat: runes.material, emissive: 1.8 }, { light: pl, on: 4 });
  S.pap = { group: g, t: 0, holds: null };

  G.world.interactables.push({
    id: 'pap', pos: pos.clone().setY(1), radius: 2.4,
    getLabel: (G) => {
      if (!G.world.powerOn) return '<i>No power…</i>';
      if (S.pap.holds) return null;
      const w = S.current();
      if (w.pap) return null;
      return `<b>F</b> Pack-a-Punch <b>[5000]</b>`;
    },
    use: (G) => {
      if (!G.world.powerOn || S.pap.holds) return;
      const w = S.current();
      if (w.pap || !G.spendPoints(5000)) return;
      S.pap.holds = { w, t: 0 };
      S.slots.splice(S.slots.indexOf(w), 1);
      if (S.cur >= S.slots.length) S.cur = 0;
      if (S.slots.length === 0) S.slots.push({ id: 'kestrel', def: DEFS.kestrel, ammo: 0, reserve: 0, pap: false, temp: true });
      G.events.emit('papStart');
      G.events.emit('ammoChanged');
    },
  });
}

// ---------- per-frame update ----------
const _rc = new THREE.Raycaster();
const _dir = new THREE.Vector3();
// flash lifetime: > 3 sim ticks so photo stills (captured ~0.05s after the
// staged shot) still catch it near full brightness
const FLASH_TIME = 0.075;

export function updateWeapons(G, dt, t) {
  const S = G.weapons, P = G.player;
  const w = S.current(), st = S.statsOf(w);

  // model visibility
  for (const id in S.models) S.models[id].visible = id === w.id && S.knifeT <= 0;
  S.knifeModel.visible = S.knifeT > 0;

  // ADS
  const wantAds = S.adsHeld && !P.sprinting && S.reloading <= 0 && G.state === 'PLAYING';
  S.adsT += ((wantAds ? 1 : 0) - S.adsT) * Math.min(1, 12 * dt);
  const targetFov = 70 - (70 - st.adsFov) * S.adsT;
  if (Math.abs(G.camera.fov - targetFov) > 0.01) { G.camera.fov = targetFov; G.camera.updateProjectionMatrix(); }

  // timers
  S.fireCd -= dt; S.knifeCd -= dt; S.swapT = Math.max(0, S.swapT - dt);
  S.flashT -= dt;
  S.kickPos *= Math.pow(0.001, dt); S.kickRot *= Math.pow(0.002, dt);

  // reload
  if (S.reloading > 0) {
    S.reloading -= dt;
    if (S.reloading <= 0) {
      const need = st.mag - w.ammo;
      const take = Math.min(need, w.reserve);
      w.ammo += take; w.reserve -= take;
      G.events.emit('ammoChanged');
    }
  }

  // knife swing
  if (S.knifeT > 0) {
    S.knifeT -= dt;
    if (S.knifeT <= 0) G.events.emit('ammoChanged');
  }

  // firing
  if ((G.state === 'PLAYING' || G.state === 'PHOTO') && S.reloading <= 0 && S.swapT <= 0 && S.knifeT <= 0 && !S.pap.holds) {
    const wantFire = st.auto ? S.triggerHeld : S.triggerEdge;
    if (wantFire && S.fireCd <= 0) {
      if (w.ammo > 0) fire(G, S, w, st, t);
      else if (S.triggerEdge) { G.events.emit('dryFire'); startReload(G, S); }
    }
  }
  S.triggerEdge = false;

  // auto reload on empty
  if (w.ammo === 0 && w.reserve > 0 && S.reloading <= 0 && S.fireCd <= 0.01 && !w.temp) startReload(G, S);

  updateViewmodel(G, S, w, st, dt, t);

  // muzzle flash: keep the point light glued to the star sprite every frame it
  // lives (hold bright, snap out late) so light + sprite read as one event
  if (S.flashT > 0 && S.flashModelId === w.id && S.knifeT <= 0) {
    const k = Math.min(1, (S.flashT / FLASH_TIME) * 2.5);
    S.flashLight.intensity = (S.flashBase ?? 9) * k;
    S.flashLight.position.copy(muzzleWorld(G, S, 0.14));
    const fl = S.models[w.id].userData.flash;
    if (fl) {
      fl.visible = true;
      fl.scale.setScalar((fl.userData.s ?? 1) * (0.82 + 0.3 * k));
    }
  } else {
    S.flashLight.intensity = 0;
    const fl = S.flashModelId && S.models[S.flashModelId]?.userData?.flash;
    if (fl && fl.visible && S.flashT <= 0) fl.visible = false;
    const cur = S.models[w.id]?.userData?.flash;
    if (cur && cur.visible && S.flashT <= 0) cur.visible = false;
  }

  updateBox(G, S, dt, t);
  updatePaPMachine(G, S, dt, t);
  updateGrenades(G, dt);
}

function fire(G, S, w, st, t) {
  const P = G.player;
  S.fireCd = 60 / st.rpm;
  w.ammo--;
  const pellets = st.pellets ?? 1;
  const spread = st.spread * (S.isADS() ? 0.35 : 1) * (P.sprinting ? 2 : 1);
  const rng = Math.random;
  let anyHit = false, anyKill = false;
  for (let i = 0; i < pellets; i++) {
    _dir.set(
      -Math.sin(P.yaw) * Math.cos(P.pitch) + (rng() - 0.5) * spread * 2,
      Math.sin(P.pitch) + (rng() - 0.5) * spread * 2,
      -Math.cos(P.yaw) * Math.cos(P.pitch) + (rng() - 0.5) * spread * 2
    ).normalize();
    _rc.set(G.camera.getWorldPosition(new THREE.Vector3()), _dir);
    _rc.far = 120;
    const res = G.zombies.raycastShot(_rc, st, G);
    anyHit = anyHit || res.hit; anyKill = anyKill || res.kill;
    G.events.emit('tracer', { from: muzzleWorld(G, S), to: res.point, color: st.tracer });
    if (st.splash && res.point) G.zombies.splashDamage(res.point, st.splash, st.dmg * 0.7, G);
  }
  if (anyHit) G.events.emit('hitmarker', { kill: anyKill });

  // recoil & flash
  S.kickPos = Math.min(0.09, S.kickPos + st.kick * 1.4);
  S.kickRot = Math.min(0.3, S.kickRot + st.kick * 2.6);
  P.pitch += st.kick * (0.5 + Math.random() * 0.4);
  P.yaw += st.kick * (Math.random() - 0.5) * 0.4;
  // flash: light rides the star sprite (a hair ahead of the muzzle so the
  // near-field falloff doesn't blow out the gun itself), re-glued per frame.
  S.flashLight.position.copy(muzzleWorld(G, S, 0.14));
  S.flashBase = st.type === 'ray' ? 7 : 9;
  S.flashLight.intensity = S.flashBase;
  S.flashLight.color.setHex(st.type === 'ray' ? 0x40ff70 : 0xffb050);
  S.flashT = FLASH_TIME;
  S.flashModelId = w.id;
  const fl = S.models[w.id]?.userData?.flash;
  if (fl) {
    fl.visible = true;
    fl.rotation.z = Math.random() * Math.PI;
    const sc = 0.85 + Math.random() * 0.5;
    fl.userData.s = st.type === 'shotgun' ? sc * 1.5 : sc;
    fl.scale.setScalar(fl.userData.s);
  }
  G.events.emit('muzzle', { pos: muzzleWorld(G, S), type: st.type });
  G.events.emit('shotFired', { pos: P.pos.clone(), weapon: w.id, loud: st.type !== 'ray' });
  G.events.emit('ammoChanged');
}

const _mw = new THREE.Vector3();
function muzzleWorld(G, S, ahead = 0) {
  const w = S.current();
  const model = S.models[w.id];
  const m = model.userData.muzzle;
  // matrices are stale during sim ticks (renders update them); force the
  // camera->vm->model chain so light/tracers/particles land ON the star sprite
  model.updateWorldMatrix(true, false);
  _mw.set(0, 0, -0.3 - ahead);
  if (m) _mw.set(m.x, m.y, m.z - ahead);
  return model.localToWorld(_mw);
}

function startReload(G, S) {
  const w = S.current(), st = S.statsOf(w);
  if (S.reloading > 0 || w.ammo >= st.mag || w.reserve <= 0 || w.temp) return;
  S.reloading = st.reload;
  S.reloadDur = st.reload;
  G.events.emit('reloadStart', st);
}

function knife(G, S) {
  if (S.knifeCd > 0 || S.reloading > 0) return;
  S.knifeCd = 0.85; S.knifeT = 0.34;
  const P = G.player;
  _dir.set(-Math.sin(P.yaw), 0, -Math.cos(P.yaw));
  const hit = G.zombies.meleeDamage(P.pos, _dir, 2.0, 150, G);
  if (hit) G.events.emit('hitmarker', { kill: hit === 'kill' });
  G.events.emit('knifeSwing');
}

// ---------- grenades ----------
const grenades = [];
function throwGrenade(G, S) {
  if (S.grenades <= 0 || S.reloading > 0) return;
  S.grenades--;
  const P = G.player;
  const dir = new THREE.Vector3(-Math.sin(P.yaw) * Math.cos(P.pitch), Math.sin(P.pitch) + 0.25, -Math.cos(P.yaw) * Math.cos(P.pitch)).normalize();
  const m = new THREE.Mesh(new THREE.SphereGeometry(0.07, 10, 8),
    new THREE.MeshStandardMaterial({ color: 0x2e3a28, roughness: 0.6, metalness: 0.4 }));
  m.castShadow = true;
  m.position.set(P.pos.x, P.pos.y + 1.5, P.pos.z).addScaledVector(dir, 0.4);
  G.scene.add(m);
  grenades.push({ mesh: m, vel: dir.multiplyScalar(13).add(new THREE.Vector3(P.vel.x * 0.5, 0, P.vel.z * 0.5)), fuse: 2.4 });
  G.events.emit('grenadeThrow');
  G.events.emit('ammoChanged');
}

function updateGrenades(G, dt) {
  for (let i = grenades.length - 1; i >= 0; i--) {
    const g = grenades[i];
    g.fuse -= dt;
    g.vel.y -= 16 * dt;
    g.mesh.position.addScaledVector(g.vel, dt);
    g.mesh.rotation.x += dt * 8; g.mesh.rotation.z += dt * 5;
    if (g.mesh.position.y < 0.07) {
      g.mesh.position.y = 0.07;
      g.vel.y = Math.abs(g.vel.y) * 0.35;
      g.vel.x *= 0.7; g.vel.z *= 0.7;
      if (Math.abs(g.vel.y) < 0.8) g.vel.y = 0;
    }
    // wall bounce (cheap): reverse on collider contact
    for (const c of G.world.colliders) {
      const p = g.mesh.position;
      if (p.y > c.max.y || p.y < c.min.y) continue;
      if (p.x > c.min.x - 0.07 && p.x < c.max.x + 0.07 && p.z > c.min.z - 0.07 && p.z < c.max.z + 0.07) {
        const dx = Math.min(p.x - (c.min.x - 0.07), (c.max.x + 0.07) - p.x);
        const dz = Math.min(p.z - (c.min.z - 0.07), (c.max.z + 0.07) - p.z);
        if (dx < dz) { g.vel.x *= -0.5; p.x += (p.x < (c.min.x + c.max.x) / 2 ? -dx : dx); }
        else { g.vel.z *= -0.5; p.z += (p.z < (c.min.z + c.max.z) / 2 ? -dz : dz); }
        break;
      }
    }
    if (g.fuse <= 0) {
      const at = g.mesh.position.clone();
      g.mesh.removeFromParent();
      grenades.splice(i, 1);
      G.events.emit('explosion', { pos: at, radius: 4.6 });
      G.zombies.splashDamage(at, 4.6, 340, G, true);
      const P = G.player;
      const pd = at.distanceTo(new THREE.Vector3(P.pos.x, P.pos.y + 1, P.pos.z));
      if (pd < 4) G.damagePlayer(Math.max(10, 70 * (1 - pd / 4)), at);
    }
  }
}

// ---------- viewmodel animation ----------
const HIP = { pos: new THREE.Vector3(0.2, -0.17, -0.36), rot: new THREE.Euler(0, 0.02, 0) };
const ADS = { pos: new THREE.Vector3(0, -0.066, -0.26), rot: new THREE.Euler(0, 0, 0) };
const _vp = new THREE.Vector3(); const _tv = new THREE.Vector3();

function updateViewmodel(G, S, w, st, dt, t) {
  const P = G.player;
  const model = S.knifeT > 0 ? S.knifeModel : S.models[w.id];
  if (!model) return;
  const a = S.adsT;
  _vp.lerpVectors(HIP.pos, ADS.pos, a);

  // sway from recent mouse movement (springy lag)
  S.swayX += ((G.lastMouseX ?? 0) * -0.00004 - S.swayX) * Math.min(1, 10 * dt);
  S.swayY += ((G.lastMouseY ?? 0) * -0.00004 - S.swayY) * Math.min(1, 10 * dt);
  G.lastMouseX = (G.lastMouseX ?? 0) * Math.pow(0.0001, dt);
  G.lastMouseY = (G.lastMouseY ?? 0) * Math.pow(0.0001, dt);

  // bob
  const bobA = P.bobAmp * (1 - a * 0.8);
  const bx = Math.cos(P.bobPhase) * 0.008 * bobA;
  const by = Math.sin(P.bobPhase * 2) * 0.006 * bobA;

  // sprint pose
  const sprint = P.sprinting ? 1 : 0;
  S.sprintT = (S.sprintT ?? 0) + (sprint - (S.sprintT ?? 0)) * Math.min(1, 8 * dt);

  // swap raise
  const swap = S.swapT > 0 ? S.swapT / 0.28 : 0;

  // reload keyframes
  let rlY = 0, rlRotX = 0, magOff = 0;
  if (S.reloading > 0 && S.reloadDur) {
    const p = 1 - S.reloading / S.reloadDur;
    if (p < 0.25) { rlRotX = p / 0.25 * 0.5; magOff = (p / 0.25) * -0.14; }
    else if (p < 0.62) { rlRotX = 0.5; magOff = -0.14 + ((p - 0.25) / 0.37) * 0.14; }
    else { rlRotX = 0.5 * (1 - (p - 0.62) / 0.38); magOff = 0; }
  }
  const mag = model.userData.mag ?? (S.models[w.id]?.userData?.mag);
  if (mag && mag.userData.homeY === undefined) mag.userData.homeY = mag.position.y;
  if (mag) mag.position.y = mag.userData.homeY + magOff;

  // knife stab pose
  let knifeZ = 0;
  if (S.knifeT > 0) {
    const kp = 1 - S.knifeT / 0.34;
    knifeZ = kp < 0.4 ? -(kp / 0.4) * 0.22 : -(1 - (kp - 0.4) / 0.6) * 0.22;
  }

  model.position.set(
    _vp.x + bx + S.swayX * 6 + S.sprintT * -0.05,
    _vp.y + by + S.swayY * 6 - swap * 0.22 + rlY,
    _vp.z + S.kickPos + knifeZ
  );
  model.rotation.set(
    -S.kickRot * 0.6 + rlRotX + S.swayY * 3 + S.sprintT * 0.35 + swap * 0.5,
    THREE.MathUtils.lerp(HIP.rot.y, 0, a) + S.swayX * 4 + S.sprintT * 0.4,
    S.sprintT * 0.18 + S.swayX * 2
  );
}

// ---------- mystery box / pap animations ----------
const BOX_POOL = ['kestrel', 'longarm', 'vulture', 'mauler', 'raygun'];
function updateBox(G, S, dt, t) {
  const b = S.box;
  if (!b) return;
  b.beam.visible = b.state === 'idle' || b.state === 'rolling';
  if (b.state === 'rolling') {
    b.t += dt;
    b.lidPivot.rotation.x = Math.max(-1.6, b.lidPivot.rotation.x - dt * 5);
    if (!b.displayed) {
      b.displayed = new THREE.Group();
      b.group.add(b.displayed);
    }
    const idx = Math.floor(b.t * 6) % BOX_POOL.length;
    if (b.shownIdx !== idx && b.t < 3.0) {
      b.shownIdx = idx;
      b.displayed.clear();
      const gm = buildViewmodel(BOX_POOL[idx], G, { hands: false });
      gm.scale.setScalar(2.2);
      b.displayed.add(gm);
    }
    if (b.displayed) {
      b.displayed.position.set(0, 1.1 + Math.sin(t * 2) * 0.05, 0);
      b.displayed.rotation.y = t * 2.4;
    }
    if (b.t >= 3.2) {
      // weighted roll: ray gun rarer, easter egg can force it
      const roll = Math.random();
      b.resultId = G.easter?.forceRayGun ? 'raygun' : (roll < 0.1 ? 'raygun' : BOX_POOL[Math.floor(Math.random() * 4)]);
      if (G.easter) G.easter.forceRayGun = false;
      b.displayed.clear();
      const gm = buildViewmodel(b.resultId, G, { hands: false });
      gm.scale.setScalar(2.2);
      b.displayed.add(gm);
      b.state = 'done'; b.t = 0;
      G.events.emit('boxDone', b.resultId);
    }
  } else if (b.state === 'done') {
    b.t += dt;
    if (b.displayed) { b.displayed.position.y = 1.1 + Math.sin(t * 2) * 0.05; b.displayed.rotation.y += dt * 0.8; }
    if (b.t > 9) { b.state = 'closing'; b.t = 0; }
  } else if (b.state === 'closing') {
    b.t += dt;
    if (b.displayed) { b.displayed.clear(); }
    b.lidPivot.rotation.x = Math.min(0, b.lidPivot.rotation.x + dt * 4);
    if (b.t > 0.6) { b.state = 'idle'; b.t = 0; }
  }
}

function updatePaPMachine(G, S, dt, t) {
  const p = S.pap;
  if (!p?.holds) return;
  p.holds.t += dt;
  if (p.holds.t > 3.4) {
    const w = p.holds.w;
    w.pap = true;
    w.ammo = S.statsOf(w).mag;
    w.reserve = Math.round(w.def.reserve * 1.5);
    // remove temp placeholder if present
    const ti = S.slots.findIndex(s => s.temp);
    if (ti >= 0) S.slots.splice(ti, 1);
    S.slots.push(w);
    S.cur = S.slots.length - 1;
    S.swapT = 0.28;
    p.holds = null;
    G.events.emit('papDone', w);
    G.events.emit('ammoChanged');
  }
}

export { DEFS };
