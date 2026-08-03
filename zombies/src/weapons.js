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

  // muzzle flash light (shared)
  S.flashLight = new THREE.PointLight(0xffb050, 0, 9, 2);
  G.scene.add(S.flashLight);
  S.flashT = 0;

  // subtle warm fill parented to the camera so the viewmodel always reads
  const vmFill = new THREE.PointLight(0xffe2b8, 3.4, 2.6, 2);
  vmFill.position.set(0.28, 0.14, -0.08);
  G.camera.add(vmFill);

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
function metalMat(G, color = 0x2b2d30, extra = {}) {
  return new THREE.MeshStandardMaterial({
    color, roughness: extra.roughness ?? 0.34, metalness: extra.metalness ?? 0.85,
    ...extra,
  });
}

// 4-point star flash texture (shared)
let _starTex = null;
function starTexture() {
  if (_starTex) return _starTex;
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const x = c.getContext('2d');
  const g = x.createRadialGradient(64, 64, 2, 64, 64, 30);
  g.addColorStop(0, 'rgba(255,255,230,1)');
  g.addColorStop(0.4, 'rgba(255,190,90,0.85)');
  g.addColorStop(1, 'rgba(255,140,40,0)');
  x.fillStyle = g; x.beginPath(); x.arc(64, 64, 30, 0, 7); x.fill();
  x.translate(64, 64);
  for (let i = 0; i < 4; i++) {
    const lg = x.createLinearGradient(0, 0, 62, 0);
    lg.addColorStop(0, 'rgba(255,230,170,0.95)');
    lg.addColorStop(1, 'rgba(255,150,50,0)');
    x.fillStyle = lg;
    x.beginPath(); x.moveTo(0, -4.5); x.lineTo(62, 0); x.lineTo(0, 4.5); x.closePath(); x.fill();
    x.rotate(Math.PI / 2);
  }
  _starTex = new THREE.CanvasTexture(c);
  _starTex.colorSpace = THREE.SRGBColorSpace;
  return _starTex;
}

function buildViewmodel(id, G) {
  const g = new THREE.Group();
  const dark = metalMat(G, 0x24272c, { roughness: 0.4 });
  const mid = metalMat(G, 0x363b42, { roughness: 0.46 });
  const wood = new THREE.MeshStandardMaterial({ color: 0x6a4c30, roughness: 0.6, map: G.mats?.wood?.map });
  const grip = new THREE.MeshStandardMaterial({ color: 0x27231e, roughness: 0.8 });
  const box = (mat, sx, sy, sz, x, y, z, rx = 0, ry = 0, rz = 0) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), mat);
    m.position.set(x, y, z); m.rotation.set(rx, ry, rz);
    g.add(m); return m;
  };
  const cyl = (mat, r0, r1, len, x, y, z, rx = Math.PI / 2) => {
    const m = new THREE.Mesh(new THREE.CylinderGeometry(r0, r1, len, 12), mat);
    m.position.set(x, y, z); m.rotation.x = rx;
    g.add(m); return m;
  };
  const parts = g.userData;
  if (id === 'kestrel') {
    parts.slide = box(dark, 0.045, 0.05, 0.24, 0, 0.045, -0.02);
    box(mid, 0.042, 0.045, 0.2, 0, 0.0, 0.0);                      // frame
    parts.mag = box(grip, 0.036, 0.11, 0.055, 0, -0.07, 0.065, -0.18); // grip/mag
    cyl(dark, 0.008, 0.008, 0.05, 0, 0.052, -0.155);               // barrel tip
    box(dark, 0.008, 0.014, 0.01, 0, 0.078, -0.13);                // front sight
    box(dark, 0.024, 0.012, 0.012, 0, 0.078, 0.09);                // rear sight
    parts.muzzle = new THREE.Vector3(0, 0.052, -0.19);
  } else if (id === 'longarm') {
    box(wood, 0.05, 0.07, 0.5, 0, -0.005, 0.12);                   // stock+forend
    box(wood, 0.05, 0.09, 0.14, 0, -0.03, 0.33, 0.12);             // buttstock
    parts.slide = box(dark, 0.044, 0.05, 0.34, 0, 0.045, -0.02);   // receiver
    cyl(dark, 0.011, 0.011, 0.3, 0, 0.05, -0.32);                  // barrel
    parts.mag = box(dark, 0.038, 0.09, 0.09, 0, -0.075, 0.02, -0.1);
    box(dark, 0.008, 0.02, 0.01, 0, 0.085, -0.44);                 // front sight
    box(dark, 0.03, 0.015, 0.015, 0, 0.082, 0.1);
    parts.muzzle = new THREE.Vector3(0, 0.05, -0.48);
  } else if (id === 'vulture') {
    parts.slide = box(dark, 0.05, 0.075, 0.34, 0, 0.02, -0.03);    // receiver
    cyl(dark, 0.013, 0.013, 0.16, 0, 0.03, -0.28);                 // barrel shroud
    cyl(mid, 0.017, 0.017, 0.1, 0, 0.03, -0.34);                   // suppressor
    parts.mag = box(mid, 0.034, 0.16, 0.06, 0, -0.11, 0.02, -0.3); // curved mag
    box(grip, 0.036, 0.09, 0.05, 0, -0.06, 0.11, -0.15);           // grip
    box(dark, 0.014, 0.02, 0.2, 0, -0.02, 0.24);                   // wire stock
    box(dark, 0.01, 0.02, 0.012, 0, 0.07, -0.2);                   // sights
    box(dark, 0.028, 0.018, 0.014, 0, 0.068, 0.08);
    parts.muzzle = new THREE.Vector3(0, 0.03, -0.4);
  } else if (id === 'mauler') {
    box(wood, 0.045, 0.06, 0.24, 0, -0.01, 0.18);                  // stock
    box(wood, 0.05, 0.08, 0.13, 0, -0.035, 0.3, 0.14);             // butt
    parts.slide = box(dark, 0.05, 0.06, 0.22, 0, 0.03, -0.02);     // receiver
    cyl(dark, 0.014, 0.014, 0.42, 0, 0.045, -0.3);                 // barrel
    cyl(dark, 0.014, 0.014, 0.42, 0, 0.017, -0.3);                 // under barrel (tube mag)
    parts.mag = box(wood, 0.04, 0.045, 0.14, 0, -0.015, -0.22);    // pump
    box(dark, 0.01, 0.016, 0.012, 0, 0.075, -0.48);
    parts.muzzle = new THREE.Vector3(0, 0.045, -0.52);
  } else if (id === 'raygun') {
    const red = metalMat(G, 0x8a1e14, { roughness: 0.35 });
    const glow = new THREE.MeshStandardMaterial({ color: 0x30ff60, emissive: 0x22cc44, emissiveIntensity: 2.2 });
    parts.slide = box(red, 0.06, 0.075, 0.26, 0, 0.02, -0.04);     // body
    cyl(red, 0.035, 0.05, 0.12, 0, 0.02, -0.2);                    // bulb front
    cyl(dark, 0.014, 0.02, 0.1, 0, 0.02, -0.28);
    const coil = new THREE.Mesh(new THREE.TorusGeometry(0.045, 0.008, 8, 16), glow);
    coil.position.set(0, 0.02, -0.13); g.add(coil);
    const coil2 = coil.clone(); coil2.position.z = -0.17; coil2.scale.setScalar(0.85); g.add(coil2);
    parts.mag = box(grip, 0.04, 0.1, 0.06, 0, -0.07, 0.08, -0.2);
    const dial = new THREE.Mesh(new THREE.SphereGeometry(0.02, 8, 8), glow);
    dial.position.set(0, 0.075, 0.02); g.add(dial);
    parts.muzzle = new THREE.Vector3(0, 0.02, -0.34);
  }
  // gloved hands (simple, low in frame)
  const glove = new THREE.MeshStandardMaterial({ color: 0x35302a, roughness: 0.85 });
  const h1 = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.05, 0.09), glove);
  h1.position.set(0.005, -0.075, 0.075); h1.rotation.z = 0.2; g.add(h1);
  if (id !== 'kestrel') {
    const h2 = h1.clone(); h2.position.set(-0.01, -0.045, -0.12); h2.rotation.set(0.2, 0.1, -0.15); g.add(h2);
  }
  // star muzzle flash (two crossed sprites at the muzzle, shown ~2 frames)
  if (parts.muzzle) {
    const fg = new THREE.Group();
    fg.position.copy(parts.muzzle);
    const fmat = new THREE.MeshBasicMaterial({
      map: starTexture(), transparent: true, blending: THREE.AdditiveBlending,
      depthWrite: false, color: id === 'raygun' ? 0x60ff90 : 0xffffff,
    });
    const f1 = new THREE.Mesh(new THREE.PlaneGeometry(0.34, 0.34), fmat);
    const f2 = new THREE.Mesh(new THREE.PlaneGeometry(0.26, 0.26), fmat);
    f2.rotation.z = 0.7; f2.position.z = -0.02;
    const f3 = new THREE.Mesh(new THREE.PlaneGeometry(0.3, 0.3), fmat);
    f3.rotation.y = Math.PI / 2; // side-visible blade
    fg.add(f1, f2, f3);
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
  const blade = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.045, 0.22),
    new THREE.MeshStandardMaterial({ color: 0xb8bcc2, roughness: 0.25, metalness: 0.9 }));
  blade.position.set(0, 0, -0.16);
  const handle = new THREE.Mesh(new THREE.BoxGeometry(0.026, 0.038, 0.11),
    new THREE.MeshStandardMaterial({ color: 0x241f18, roughness: 0.9 }));
  handle.position.set(0, -0.004, 0.005);
  g.add(blade, handle);
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
  if (S.flashT <= 0) {
    S.flashLight.intensity = 0;
    const fl = S.models[w.id]?.userData?.flash;
    if (fl) fl.visible = false;
  }
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
  S.flashLight.position.copy(muzzleWorld(G, S));
  S.flashLight.intensity = st.type === 'ray' ? 8 : 11;
  S.flashLight.color.setHex(st.type === 'ray' ? 0x40ff70 : 0xffb050);
  S.flashT = 0.055;
  const fl = S.models[w.id]?.userData?.flash;
  if (fl) {
    fl.visible = true;
    fl.rotation.z = Math.random() * Math.PI;
    const sc = 0.85 + Math.random() * 0.5;
    fl.scale.setScalar(st.type === 'shotgun' ? sc * 1.5 : sc);
  }
  G.events.emit('muzzle', { pos: muzzleWorld(G, S), type: st.type });
  G.events.emit('shotFired', { pos: P.pos.clone(), weapon: w.id, loud: st.type !== 'ray' });
  G.events.emit('ammoChanged');
}

function muzzleWorld(G, S) {
  const w = S.current();
  const model = S.models[w.id];
  const m = model.userData.muzzle ?? new THREE.Vector3(0, 0, -0.3);
  return model.localToWorld(m.clone());
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
      const gm = buildViewmodel(BOX_POOL[idx], G);
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
      const gm = buildViewmodel(b.resultId, G);
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
