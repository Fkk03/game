// Zombies: procedural bodies with per-zombie variation, smart AI (A* pathfinding,
// encirclement slots, sprint lead-prediction, window tear/vault, gunshot hearing),
// the rounds director, gore, and power-up drops.
import * as THREE from 'three';
import { makeRng } from './rng.js';
import { zombieSkinTexture, clothTexture } from './textures.js';

const V3 = (x, y, z) => new THREE.Vector3(x, y, z);
const zombies = [];
const powerups = [];

export function initZombies(G) {
  const rng = makeRng(G.seed + 500);
  // shared materials (variation pool)
  const TONES = [[100, 112, 86], [114, 105, 90], [90, 104, 95], [108, 100, 76]];
  const skins = [0, 1, 2, 3].map(i => {
    const t = zombieSkinTexture({ seed: 71 + i * 7, tone: TONES[i] });
    return new THREE.MeshStandardMaterial({ map: t.map, bumpMap: t.bumpMap, bumpScale: 0.8, roughness: 0.92 });
  });
  const cloths = [0, 1, 2, 3, 4, 5].map(i => {
    const t = clothTexture({ seed: 81 + i * 11, base: [[60, 62, 58], [72, 58, 44], [48, 54, 68], [70, 44, 40], [56, 66, 52], [64, 60, 70]][i] });
    return new THREE.MeshStandardMaterial({ map: t.map, roughness: 0.98 });
  });
  const eyeMat = new THREE.MeshStandardMaterial({ color: 0xffa524, emissive: 0xff8a10, emissiveIntensity: 2.6 });

  // zombie face texture: sunken sockets, gaunt cheeks, torn mouth — applied to the
  // front (+z) face of the head box via a material array.
  function faceTexture(tone, seed) {
    const r = makeRng(seed);
    const c = document.createElement('canvas'); c.width = c.height = 128;
    const x = c.getContext('2d');
    x.fillStyle = `rgb(${tone[0]},${tone[1]},${tone[2]})`; x.fillRect(0, 0, 128, 128);
    const shade = (px, py, rad, col, a) => {
      const g = x.createRadialGradient(px, py, rad * 0.2, px, py, rad);
      g.addColorStop(0, `rgba(${col},${a})`); g.addColorStop(1, `rgba(${col},0)`);
      x.fillStyle = g; x.beginPath(); x.arc(px, py, rad, 0, 7); x.fill();
    };
    // gaunt cheek hollows + temple shading
    shade(34, 74, 26, '30,26,30', 0.55); shade(94, 74, 26, '30,26,30', 0.55);
    shade(64, 20, 40, '36,32,34', 0.4);
    // deep eye sockets (eyes sit at ~(±30, 46) in this 128px face space)
    shade(34, 46, 17, '10,8,10', 0.95); shade(94, 46, 17, '10,8,10', 0.95);
    shade(34, 46, 9, '0,0,0', 1); shade(94, 46, 9, '0,0,0', 1);
    // nose cavity
    shade(64, 66, 8, '20,12,12', 0.8);
    // torn mouth: dark gape + teeth
    x.fillStyle = 'rgba(12,6,6,0.95)';
    x.beginPath(); x.ellipse(64, 98, 24, 12 + r() * 6, 0, 0, 7); x.fill();
    x.fillStyle = 'rgba(190,180,150,0.85)';
    for (let i = 0; i < 7; i++) x.fillRect(46 + i * 5.4, 90, 3, 5 + r() * 3);
    // blood from mouth corner
    x.fillStyle = 'rgba(80,10,8,0.7)';
    x.fillRect(46 + r() * 30, 104, 3 + r() * 3, 14 + r() * 10);
    // scratches
    x.strokeStyle = 'rgba(90,20,16,0.5)'; x.lineWidth = 1.5;
    for (let i = 0; i < 3; i++) {
      const sx = r() * 128, sy = r() * 60;
      x.beginPath(); x.moveTo(sx, sy); x.lineTo(sx + r() * 20 - 10, sy + 20 + r() * 20); x.stroke();
    }
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  }
  const faceMats = [0, 1, 2, 3].map(i =>
    new THREE.MeshStandardMaterial({ map: faceTexture(TONES[i], 900 + i * 31), roughness: 0.9 }));
  // tattered shirt-hem alpha texture (vertical rag strips)
  const tatterTex = (() => {
    const c = document.createElement('canvas'); c.width = 128; c.height = 32;
    const x = c.getContext('2d');
    x.clearRect(0, 0, 128, 32);
    const r = makeRng(777);
    x.fillStyle = '#fff';
    for (let i = 0; i < 16; i++) {
      const w0 = 4 + r() * 6, x0 = i * 8;
      x.fillRect(x0, 0, w0, 12 + r() * 20);
    }
    const t = new THREE.CanvasTexture(c);
    return t;
  })();

  const geo = {
    torso: new THREE.BoxGeometry(0.38, 0.52, 0.22),
    pelvis: new THREE.BoxGeometry(0.33, 0.2, 0.2),
    head: new THREE.BoxGeometry(0.2, 0.24, 0.22),
    jaw: new THREE.BoxGeometry(0.15, 0.07, 0.13),
    uarm: new THREE.BoxGeometry(0.095, 0.32, 0.095),
    farm: new THREE.BoxGeometry(0.08, 0.3, 0.08),
    hand: new THREE.BoxGeometry(0.095, 0.15, 0.05),
    thigh: new THREE.BoxGeometry(0.14, 0.38, 0.14),
    shin: new THREE.BoxGeometry(0.11, 0.36, 0.11),
    foot: new THREE.BoxGeometry(0.11, 0.08, 0.22),
    eye: new THREE.SphereGeometry(0.022, 6, 5),
    tatter: new THREE.CylinderGeometry(0.2, 0.24, 0.2, 8, 1, true),
    hbHead: new THREE.BoxGeometry(0.3, 0.34, 0.32),
    hbTorso: new THREE.BoxGeometry(0.48, 0.78, 0.32),
    hbLegs: new THREE.BoxGeometry(0.42, 0.85, 0.32),
  };

  const Z = G.zombies = {
    list: zombies,
    round: 0, toSpawn: 0, aliveCap: 8, spawnT: 0, betweenT: 3, roundActive: false,
    totalKills: 0, dropsThisRound: 0,
    raycastShot, splashDamage, meleeDamage, spawnPosed,
    startRound, spawnOne,
  };
  G.buffs = { insta: 0, points2x: 0 };

  function startRound(n) {
    Z.round = n;
    Z.toSpawn = Math.min(70, Math.round(5 + (n - 1) * 3.4 + Math.max(0, n - 8) * 2));
    Z.aliveCap = Math.min(24, 7 + n);
    Z.roundActive = true;
    Z.spawnT = 1.5;
    Z.dropsThisRound = 0;
    G.events.emit('roundStart', n);
  }

  function zombieHealth(n) {
    if (n <= 9) return 150 + (n - 1) * 100;
    let h = 950;
    for (let i = 10; i <= n; i++) h *= 1.1;
    return Math.round(h);
  }

  function speedClass(n, r) {
    // walkers early; sprinters take over at high rounds
    const sprintP = Math.min(0.85, Math.max(0, (n - 3) * 0.09));
    const jogP = Math.min(0.7, 0.18 + n * 0.06);
    const x = r();
    if (x < sprintP) return 'sprint';
    if (x < sprintP + jogP) return 'jog';
    return 'walk';
  }

  function buildBody() {
    const g = new THREE.Group();
    const skinI = Math.floor(rng() * skins.length);
    const skin = skins[skinI];
    const face = faceMats[skinI];
    const cloth = cloths[Math.floor(rng() * cloths.length)];
    const cloth2 = cloths[Math.floor(rng() * cloths.length)];
    const mk = (geoName, mat, x, y, z) => {
      const m = new THREE.Mesh(geo[geoName], mat);
      m.position.set(x, y, z);
      m.castShadow = true; m.receiveShadow = true;
      return m;
    };
    const parts = {};
    parts.pelvis = mk('pelvis', cloth2, 0, 0.92, 0); g.add(parts.pelvis);
    parts.torso = mk('torso', cloth, 0, 0.38, 0); parts.pelvis.add(parts.torso);
    // tattered shirt hem hanging off the torso bottom
    const tat = new THREE.Mesh(geo.tatter, new THREE.MeshStandardMaterial({
      map: cloth.map, alphaMap: tatterTex, transparent: true, alphaTest: 0.5,
      side: THREE.DoubleSide, roughness: 1,
    }));
    tat.position.y = -0.32; parts.torso.add(tat);
    parts.neck = new THREE.Group(); parts.neck.position.set(0, 0.3, 0.02); parts.torso.add(parts.neck);
    // head: face texture on +z, skin elsewhere (BoxGeometry group order: ±x,±y,+z,-z)
    parts.head = new THREE.Mesh(geo.head, [skin, skin, skin, skin, face, skin]);
    parts.head.position.set(0, 0.13, 0.03);
    parts.head.castShadow = parts.head.receiveShadow = true;
    parts.neck.add(parts.head);
    parts.jaw = mk('jaw', skin, 0, -0.12, 0.04); parts.head.add(parts.jaw);
    const eL = new THREE.Mesh(geo.eye, eyeMat); eL.position.set(-0.047, 0.026, 0.1); parts.head.add(eL);
    const eR = new THREE.Mesh(geo.eye, eyeMat); eR.position.set(0.047, 0.026, 0.1); parts.head.add(eR);
    for (const side of ['L', 'R']) {
      const sx = side === 'L' ? -1 : 1;
      const sh = new THREE.Group(); sh.position.set(sx * 0.245, 0.2, 0); parts.torso.add(sh);
      parts['arm' + side] = sh;
      const ua = mk('uarm', side === 'L' ? cloth : skin, 0, -0.15, 0); sh.add(ua);
      const el = new THREE.Group(); el.position.set(0, -0.31, 0); sh.add(el);
      parts['fore' + side] = el;
      const fa = mk('farm', skin, 0, -0.14, 0); el.add(fa);
      const hd = mk('hand', skin, 0, -0.31, 0.015); hd.rotation.x = 0.35; el.add(hd);
      const hip = new THREE.Group(); hip.position.set(sx * 0.1, -0.09, 0); parts.pelvis.add(hip);
      parts['leg' + side] = hip;
      const th = mk('thigh', cloth2, 0, -0.19, 0); hip.add(th);
      const kn = new THREE.Group(); kn.position.set(0, -0.39, 0); hip.add(kn);
      parts['knee' + side] = kn;
      const sn = mk('shin', rng() < 0.4 ? skin : cloth2, 0, -0.17, 0); kn.add(sn);
      parts['shinMesh' + side] = sn;
      const ft = mk('foot', skin, 0, -0.36, 0.05); kn.add(ft);
      parts['footMesh' + side] = ft;
    }
    return { g, parts };
  }

  function spawnOne(entry) {
    const { g, parts } = buildBody();
    const z = {
      group: g, parts,
      hp: zombieHealth(Z.round), maxHp: zombieHealth(Z.round),
      speedClass: speedClass(Z.round, rng),
      state: 'toWindow', phase: rng() * 6.28, yaw: 0,
      window: null, path: null, pathI: 0, repathT: 0,
      attackCd: 0, tearT: 0, vaultT: 0, dieT: 0, riseT: 0, sinkT: 0,
      crawler: false, legHits: 0, slot: rng() * Math.PI * 2,
      scale: rng.range(0.92, 1.1), hunch: rng.range(0.15, 0.42),
      headless: false, partyHat: rng() < 0.012,
      armMissing: rng() < 0.08 ? (rng() < 0.5 ? 'L' : 'R') : null,
      ...poseVariance(rng),
    };
    z.speed = { walk: rng.range(0.85, 1.15), jog: rng.range(2.0, 2.5), sprint: rng.range(3.6, 4.3) }[z.speedClass];
    g.scale.setScalar(z.scale);
    if (z.armMissing) {
      parts['arm' + z.armMissing].visible = false;
    }
    if (z.partyHat) {
      const hat = new THREE.Mesh(new THREE.ConeGeometry(0.09, 0.22, 8),
        new THREE.MeshStandardMaterial({ color: 0xff40a0, roughness: 0.6, emissive: 0x801048, emissiveIntensity: 0.4 }));
      hat.position.set(0, 0.31, 0); hat.rotation.z = 0.15;
      parts.head.add(hat);
    }
    // hitboxes (invisible)
    const hbMat = new THREE.MeshBasicMaterial({ visible: false });
    const hbs = [];
    const hb = (geoName, part, parent, y) => {
      const m = new THREE.Mesh(geo[geoName], hbMat);
      m.position.y = y; m.userData.zombie = z; m.userData.part = part; m.userData.noBlock = true;
      parent.add(m); hbs.push(m);
    };
    hb('hbHead', 'head', parts.head, 0);
    hb('hbTorso', 'body', parts.torso, 0);
    hb('hbLegs', 'legs', parts.pelvis, -0.55);
    z.hitboxes = hbs;

    if (entry.grave) {
      z.state = 'rising';
      z.riseT = 0;
      g.position.set(entry.grave.x, -1.55, entry.grave.z);
      z.yaw = rng() * 6.28;
      G.events.emit('graveRise', entry.grave);
    } else {
      const w = entry.window;
      z.window = w;
      g.position.copy(w.spawn);
      g.position.x += rng.range(-2, 2); g.position.z += rng.range(-2, 2);
      z.yaw = Math.atan2(-w.dir.x, -w.dir.z);
    }
    g.rotation.y = z.yaw;
    G.scene.add(g);
    zombies.push(z);
    G.events.emit('zombieSpawned', z);
    return z;
  }

  // deterministic posed spawn for photo mode
  function spawnPosed(x, zpos, yaw, pose = 'walk', phase = 0, opts = {}) {
    const { g, parts } = buildBody();
    const z = {
      group: g, parts, hp: 1e9, maxHp: 1e9, speedClass: opts.speedClass ?? 'jog',
      state: 'posed', pose, phase, yaw, speed: 0,
      attackCd: 0, crawler: !!opts.crawler, headless: false, slot: 0,
      scale: opts.scale ?? 1, hunch: opts.hunch ?? 0.3, hitboxes: [],
      window: null, path: null,
      ...poseVariance(rng),
    };
    g.scale.setScalar(z.scale);
    g.position.set(x, opts.y ?? 0, zpos);
    g.rotation.y = yaw;
    G.scene.add(g);
    zombies.push(z);
    return z;
  }

  // per-zombie pose asymmetry so no two shamble alike
  function poseVariance(r) {
    return {
      armBaseL: -(1.05 + r() * 0.5), armBaseR: -(1.25 + r() * 0.45),
      splayL: 0.05 + r() * 0.14, splayR: 0.04 + r() * 0.12,
      foreBaseL: -(0.35 + r() * 0.4), foreBaseR: -(0.3 + r() * 0.4),
      headTilt: (r() - 0.5) * 0.5, neckBase: -(0.05 + r() * 0.22),
      deathSplay: { lx: -0.2 - r() * 0.6, rx: -0.1 - r() * 0.7, lz: 0.4 + r() * 0.7, rz: -(0.4 + r() * 0.7) },
    };
  }

  // ---------- combat ----------
  const _p = new THREE.Vector3();
  function raycastShot(rc, st, G) {
    // static geometry stop distance
    const statics = rc.intersectObjects(G.staticRay, false).filter(h => !h.object.userData.noBlock);
    const staticD = statics.length ? statics[0].distance : Infinity;
    // zombie hitboxes
    const hbs = [];
    for (const z of zombies) if (z.state !== 'dead' && z.state !== 'dying' && !z.gone) hbs.push(...z.hitboxes);
    const zh = rc.intersectObjects(hbs, false);
    let out = { hit: false, kill: false, point: null };
    if (zh.length && zh[0].distance < staticD) {
      const h = zh[0];
      const z = h.object.userData.zombie;
      const part = h.object.userData.part;
      const mul = part === 'head' ? st.headMul : part === 'legs' ? 0.8 : 1;
      const dmg = G.buffs.insta > 0 ? 1e9 : st.dmg * mul;
      out = { hit: true, kill: false, point: h.point };
      damageZombie(z, dmg, part, h.point, G);
      out.kill = z.hp <= 0;
      G.addPoints(10 * (G.buffs.points2x > 0 ? 2 : 1), 'hit');
      G.events.emit('bloodHit', { pos: h.point, dir: rc.ray.direction, part });
    } else if (statics.length) {
      out.point = statics[0].point;
      G.events.emit('wallHit', { pos: statics[0].point, normal: statics[0].face?.normal ?? V3(0, 1, 0), object: statics[0].object });
    } else {
      out.point = rc.ray.origin.clone().addScaledVector(rc.ray.direction, 60);
    }
    return out;
  }

  function splashDamage(point, radius, dmg, G, isExplosion = false) {
    let kills = 0;
    for (const z of zombies) {
      if (z.state === 'dead' || z.state === 'dying' || z.state === 'posed') continue;
      _p.copy(z.group.position); _p.y += 1;
      const d = _p.distanceTo(point);
      if (d > radius) continue;
      const fall = 1 - (d / radius) * 0.7;
      damageZombie(z, (G.buffs.insta > 0 ? 1e9 : dmg * fall), 'body', _p.clone(), G, isExplosion);
      if (z.hp <= 0) kills++;
    }
    return kills;
  }

  function meleeDamage(pos, dir, range, dmg, G) {
    let best = null, bestD = 1e9;
    for (const z of zombies) {
      if (z.state === 'dead' || z.state === 'dying' || z.state === 'posed') continue;
      _p.copy(z.group.position).sub(pos); _p.y = 0;
      const d = _p.length();
      if (d > range) continue;
      if (_p.normalize().dot(dir) < 0.45) continue;
      if (d < bestD) { bestD = d; best = z; }
    }
    if (!best) return null;
    damageZombie(best, G.buffs.insta > 0 ? 1e9 : dmg, 'body', best.group.position.clone().setY(1.2), G);
    G.events.emit('bloodHit', { pos: best.group.position.clone().setY(1.2), dir, part: 'body' });
    return best.hp <= 0 ? 'kill' : 'hit';
  }

  function damageZombie(z, dmg, part, point, G, isExplosion = false) {
    if (z.hp <= 0) return;
    z.hp -= dmg;
    z.staggerT = part === 'head' ? 0.28 : 0.16;
    if (part === 'legs' && z.hp > 0) {
      z.legHits += dmg;
      if (z.legHits > 110 && !z.crawler) makeCrawler(z);
    }
    if (z.hp <= 0) {
      const mul = G.buffs.points2x > 0 ? 2 : 1;
      const headshot = part === 'head';
      const pts = isExplosion ? 50 : headshot ? 100 : 60;
      G.addPoints(pts * mul, headshot ? 'headshot' : 'kill');
      G.player.kills++;
      if (headshot) { G.player.headshots++; z.headless = true; z.parts.head.visible = false; G.events.emit('headshot', { pos: point }); }
      if (isExplosion) G.events.emit('gib', { pos: z.group.position.clone().setY(1) });
      z.state = 'dying';
      z.dieT = 0;
      z.fallDir = Math.random() < 0.65 ? 1 : -1;
      Z.totalKills++;
      G.events.emit('zombieKilled', { z, headshot, pos: z.group.position.clone() });
      maybeDrop(z.group.position.clone(), G);
      if (z.partyHat) dropPowerup('maxammo', z.group.position.clone(), G, true);
    }
  }

  function makeCrawler(z) {
    z.crawler = true;
    z.speed = Math.min(z.speed, 0.8);
    z.parts.shinMeshL.visible = false; z.parts.shinMeshR.visible = false;
    z.parts.footMeshL.visible = false; z.parts.footMeshR.visible = false;
    G.events.emit('bloodHit', { pos: z.group.position.clone().setY(0.4), dir: V3(0, -1, 0), part: 'legs' });
    G.events.emit('crawler', z);
  }

  // ---------- power-ups ----------
  const PU = {
    insta: { color: 0xffe040, label: 'INSTA-KILL' },
    points2x: { color: 0xff8020, label: 'DOUBLE POINTS' },
    maxammo: { color: 0x40c0ff, label: 'MAX AMMO' },
    nuke: { color: 0x70ff50, label: 'NUKE' },
    carpenter: { color: 0xc0a060, label: 'CARPENTER' },
  };
  function maybeDrop(pos, G) {
    if (Z.dropsThisRound >= 4 || Math.random() > 0.035) return;
    Z.dropsThisRound++;
    const kinds = Object.keys(PU);
    dropPowerup(kinds[Math.floor(Math.random() * kinds.length)], pos, G);
  }
  function dropPowerup(kind, pos, G, forced = false) {
    const def = PU[kind];
    const g = new THREE.Group();
    const core = new THREE.Mesh(new THREE.OctahedronGeometry(0.22),
      new THREE.MeshStandardMaterial({ color: def.color, emissive: def.color, emissiveIntensity: 1.8, roughness: 0.3 }));
    const l = new THREE.PointLight(def.color, 4, 6, 2);
    g.add(core, l);
    g.position.set(pos.x, 0.8, pos.z);
    G.scene.add(g);
    powerups.push({ kind, group: g, t: 0, life: 28 });
  }

  // ---------- events ----------
  G.events.on('shotFired', ({ pos, loud }) => {
    if (!loud) return;
    for (const z of zombies) {
      if (z.state === 'chasing') z.repathT = Math.min(z.repathT, 0.1);
    }
  });

  return Z;
}

// =========================================================================
const _v = new THREE.Vector3(), _w = new THREE.Vector3(), _sep = new THREE.Vector3();

export function updateZombies(G, dt, t) {
  const Z = G.zombies, P = G.player;
  // buffs
  for (const k in G.buffs) G.buffs[k] = Math.max(0, G.buffs[k] - dt);

  // ---------- rounds director ----------
  if (G.state === 'PLAYING') {
    const alive = zombies.filter(z => z.state !== 'dead' && z.state !== 'posed' && !z.gone).length;
    if (!Z.roundActive) {
      Z.betweenT -= dt;
      if (Z.betweenT <= 0) Z.startRound(Z.round + 1);
    } else {
      if (Z.toSpawn > 0) {
        Z.spawnT -= dt;
        if (Z.spawnT <= 0 && alive < Z.aliveCap) {
          Z.spawnT = Math.max(0.35, 1.4 - Z.round * 0.06);
          const entry = pickSpawn(G);
          if (entry) { Z.spawnOne(entry); Z.toSpawn--; }
        }
      } else if (alive === 0) {
        Z.roundActive = false;
        Z.betweenT = 8;
        G.events.emit('roundEnd', Z.round);
      }
    }
  }

  // ---------- per-zombie ----------
  for (let i = zombies.length - 1; i >= 0; i--) {
    const z = zombies[i];
    if (z.gone) { zombies.splice(i, 1); continue; }
    if (z.state === 'posed') { animate(z, dt, t, G); continue; }
    z.attackCd -= dt;
    z.staggerT = Math.max(0, (z.staggerT ?? 0) - dt);

    switch (z.state) {
      case 'rising': {
        z.riseT += dt;
        const p = Math.min(1, z.riseT / 1.7);
        z.group.position.y = -1.55 + p * 1.55 * (p < 0.85 ? p / 0.85 : 1);
        z.group.position.y = -1.55 * (1 - easeOut(p));
        if (p >= 1) { z.group.position.y = 0; z.state = 'chasing'; }
        break;
      }
      case 'toWindow': {
        const w = z.window;
        if (!w) { z.state = 'chasing'; break; }
        moveAlong(G, z, w.outside, dt, 0.5);
        if (dist2D(z.group.position, w.outside) < 0.6) {
          z.state = w.planks.some(p => p.alive) ? 'tearing' : 'vaulting';
          z.vaultT = 0;
          z.yaw = Math.atan2(-w.dir.x, -w.dir.z);
        }
        break;
      }
      case 'tearing': {
        const w = z.window;
        z.yaw = Math.atan2(-w.dir.x, -w.dir.z);
        z.tearT += dt;
        if (z.tearT > 1.35) {
          z.tearT = 0;
          const plank = w.planks.filter(p => p.alive).sort((a, b) => b.mesh.position.y - a.mesh.position.y)[0];
          if (plank) {
            plank.alive = false;
            G.events.emit('plankTorn', { win: w, plank });
          }
          if (!w.planks.some(p => p.alive)) { z.state = 'vaulting'; z.vaultT = 0; }
        }
        break;
      }
      case 'vaulting': {
        const w = z.window;
        z.vaultT += dt;
        const p = Math.min(1, z.vaultT / 1.0);
        _v.lerpVectors(w.outside, w.inside, easeInOut(p));
        z.group.position.set(_v.x, Math.sin(p * Math.PI) * 0.95, _v.z);
        z.yaw = Math.atan2(-w.dir.x, -w.dir.z);
        if (p >= 1) { z.group.position.y = 0; z.state = 'chasing'; }
        break;
      }
      case 'chasing': {
        if (P.dead) break;
        // encirclement: aim at a slot around the player, not the player point
        const surroundR = 1.1;
        let tx = P.pos.x + Math.cos(z.slot) * surroundR * (dist2D(z.group.position, P.pos) < 4 ? 1 : 0);
        let tz = P.pos.z + Math.sin(z.slot) * surroundR * (dist2D(z.group.position, P.pos) < 4 ? 1 : 0);
        // sprinters lead the target
        if (z.speedClass === 'sprint') { tx += P.vel.x * 0.35; tz += P.vel.z * 0.35; }
        moveAlong(G, z, _w.set(tx, 0, tz), dt, 1.0);
        const d = dist2D(z.group.position, P.pos);
        if (d < 1.5 && z.attackCd <= 0) {
          z.state = 'attacking'; z.atkT = 0; z.didHit = false;
        }
        break;
      }
      case 'attacking': {
        z.atkT += dt;
        z.yaw = Math.atan2(P.pos.x - z.group.position.x, P.pos.z - z.group.position.z);
        if (z.atkT > 0.32 && !z.didHit) {
          z.didHit = true;
          if (dist2D(z.group.position, P.pos) < 2.0 && !P.dead) {
            G.damagePlayer(26, z.group.position);
            G.events.emit('zombieHitPlayer', z);
          }
        }
        if (z.atkT > 0.75) {
          z.attackCd = 0.55;
          z.state = 'chasing';
        }
        break;
      }
      case 'dying': {
        z.dieT += dt;
        const p = Math.min(1, z.dieT / 0.55);
        z.group.rotation.x = z.fallDir * easeOut(p) * Math.PI / 2 * 0.94;
        z.group.position.y = -easeOut(p) * 0.15;
        if (z.dieT > 0.55 && !z.pooled) {
          z.pooled = true;
          G.events.emit('bloodPool', { pos: z.group.position.clone().setY(0.02) });
        }
        if (z.dieT > 2.6) { z.state = 'dead'; z.sinkT = 0; }
        break;
      }
      case 'dead': {
        z.sinkT += dt;
        z.group.position.y -= dt * 0.35;
        if (z.sinkT > 2.2) {
          z.group.removeFromParent();
          z.gone = true;
        }
        break;
      }
    }

    // keep zombies out of the player capsule
    if (z.state === 'chasing' || z.state === 'attacking') {
      const d = dist2D(z.group.position, P.pos);
      if (d < 0.72 && d > 1e-4) {
        const push = (0.72 - d);
        z.group.position.x += (z.group.position.x - P.pos.x) / d * push;
        z.group.position.z += (z.group.position.z - P.pos.z) / d * push;
      }
    }

    z.group.rotation.y = z.yaw;
    animate(z, dt, t, G);
  }

  // ---------- power-ups ----------
  for (let i = powerups.length - 1; i >= 0; i--) {
    const pu = powerups[i];
    pu.t += dt; pu.life -= dt;
    pu.group.rotation.y = pu.t * 2.2;
    pu.group.position.y = 0.8 + Math.sin(pu.t * 2.4) * 0.12;
    pu.group.children[1].intensity = pu.life < 6 ? (Math.sin(pu.t * 12) > 0 ? 4 : 0.5) : 4;
    const d = dist2D(pu.group.position, P.pos);
    if (d < 1.1 && !P.dead) {
      applyPowerup(pu.kind, G);
      pu.group.removeFromParent();
      powerups.splice(i, 1);
      continue;
    }
    if (pu.life <= 0) { pu.group.removeFromParent(); powerups.splice(i, 1); }
  }
}

function applyPowerup(kind, G) {
  const labels = { insta: 'INSTA-KILL', points2x: 'DOUBLE POINTS', maxammo: 'MAX AMMO', nuke: 'NUKE', carpenter: 'CARPENTER' };
  if (kind === 'insta') G.buffs.insta = 30;
  if (kind === 'points2x') G.buffs.points2x = 30;
  if (kind === 'maxammo') {
    for (const w of G.weapons.slots) { w.reserve = Math.round(w.def.reserve * (w.pap ? 1.5 : 1)); w.ammo = G.weapons.statsOf(w).mag; }
    G.weapons.grenades = Math.min(G.weapons.maxGrenades, G.weapons.grenades + 2);
    G.events.emit('ammoChanged');
  }
  if (kind === 'nuke') {
    let n = 0;
    for (const z of zombies) {
      if (z.state === 'dead' || z.state === 'dying' || z.state === 'posed' || z.gone) continue;
      z.hp = 0; z.state = 'dying'; z.dieT = 0; z.fallDir = Math.random() < 0.5 ? 1 : -1;
      G.zombies.totalKills++; G.player.kills++; n++;
      G.events.emit('gib', { pos: z.group.position.clone().setY(1) });
    }
    G.addPoints(400, 'nuke');
    G.events.emit('nuke', n);
  }
  if (kind === 'carpenter') {
    for (const w of G.world.windows) {
      for (const p of w.planks) {
        if (!p.alive) {
          p.alive = true;
          p.mesh.visible = true;
          p.mesh.position.copy(p.home.position);
          p.mesh.rotation.copy(p.home.rotation);
        }
      }
    }
    G.addPoints(200, 'carpenter');
  }
  G.events.emit('powerup', { kind, label: labels[kind] });
}

// ---------- movement ----------
function pickSpawn(G) {
  const W = G.world, P = G.player;
  const options = [];
  for (const w of W.windows) {
    if (!W.zones[w.zone]) continue;
    const d = dist2D(w.pos, P.pos);
    options.push({ window: w, weight: 1 / (6 + d) });
  }
  if (W.zones.D) {
    for (const gpos of W.graves) {
      // avoid rising into the player's face
      if (dist2D(gpos, P.pos) < 4) continue;
      options.push({ grave: gpos, weight: 0.5 / (8 + dist2D(gpos, P.pos)) });
    }
  }
  if (!options.length) return null;
  let sum = 0; for (const o of options) sum += o.weight;
  let r = Math.random() * sum;
  for (const o of options) { r -= o.weight; if (r <= 0) return o; }
  return options[0];
}

function moveAlong(G, z, target, dt, repathBase) {
  z.repathT -= dt;
  const zp = z.group.position;
  if (z.repathT <= 0 || !z.path) {
    z.repathT = repathBase + Math.random() * 0.4;
    const path = G.world.nav.findPath(zp.x, zp.z, target.x, target.z);
    if (path && path.length) { z.path = path; z.pathI = 0; }
    else z.path = null;
  }
  let dirX, dirZ;
  if (z.path) {
    let wp = z.path[z.pathI];
    while (wp && Math.hypot(wp[0] - zp.x, wp[1] - zp.z) < 0.45 && z.pathI < z.path.length - 1) {
      z.pathI++; wp = z.path[z.pathI];
    }
    if (!wp) { dirX = target.x - zp.x; dirZ = target.z - zp.z; }
    else { dirX = wp[0] - zp.x; dirZ = wp[1] - zp.z; }
  } else {
    dirX = target.x - zp.x; dirZ = target.z - zp.z;
  }
  const dl = Math.hypot(dirX, dirZ);
  if (dl > 1e-4) { dirX /= dl; dirZ /= dl; }

  // separation from other zombies
  _sep.set(0, 0, 0);
  for (const o of zombies) {
    if (o === z || o.state === 'dead' || o.state === 'dying' || o.gone || o.state === 'posed') continue;
    const dx = zp.x - o.group.position.x, dz = zp.z - o.group.position.z;
    const d2 = dx * dx + dz * dz;
    if (d2 < 0.55 && d2 > 1e-5) {
      const d = Math.sqrt(d2);
      _sep.x += dx / d * (0.74 - d);
      _sep.z += dz / d * (0.74 - d);
    }
  }
  dirX += _sep.x * 1.6; dirZ += _sep.z * 1.6;
  const dn = Math.hypot(dirX, dirZ);
  if (dn > 1e-4) { dirX /= dn; dirZ /= dn; }

  const stagger = z.staggerT > 0 ? 0.25 : 1;
  const sp = z.speed * stagger;
  zp.x += dirX * sp * dt;
  zp.z += dirZ * sp * dt;
  // face travel direction (smoothed)
  const targetYaw = Math.atan2(dirX, dirZ);
  let dy = targetYaw - z.yaw;
  while (dy > Math.PI) dy -= Math.PI * 2;
  while (dy < -Math.PI) dy += Math.PI * 2;
  z.yaw += dy * Math.min(1, 8 * dt);
  z.phase += dt * sp * (z.crawler ? 2.4 : 1.55);
}

// ---------- procedural animation ----------
function animate(z, dt, t, G) {
  const p = z.parts, ph = z.phase;
  const stag = z.staggerT > 0 ? 1 : 0;
  if (z.state === 'dying' || z.state === 'dead') {
    // limbs splay loose as the body drops
    const ds = z.deathSplay ?? { lx: -0.4, rx: -0.3, lz: 0.7, rz: -0.7 };
    p.armL.rotation.x = lerpTo(p.armL.rotation.x, ds.lx, dt * 7);
    p.armR.rotation.x = lerpTo(p.armR.rotation.x, ds.rx, dt * 7);
    p.armL.rotation.z = lerpTo(p.armL.rotation.z, ds.lz, dt * 7);
    p.armR.rotation.z = lerpTo(p.armR.rotation.z, ds.rz, dt * 7);
    p.foreL.rotation.x = lerpTo(p.foreL.rotation.x, -0.15, dt * 7);
    p.foreR.rotation.x = lerpTo(p.foreR.rotation.x, -0.2, dt * 7);
    p.legL.rotation.x = lerpTo(p.legL.rotation.x, (z.deathSplay?.lz ?? 0.4) * 0.4, dt * 5);
    p.legR.rotation.x = lerpTo(p.legR.rotation.x, -(z.deathSplay?.rz ?? 0.4) * 0.3, dt * 5);
    p.neck.rotation.z = lerpTo(p.neck.rotation.z, (z.headTilt ?? 0.2) * 2, dt * 5);
    return;
  }
  const pose = z.state === 'posed' ? z.pose : null;

  if (z.crawler) {
    p.pelvis.position.y = 0.34;
    p.pelvis.rotation.x = -1.25;
    p.armL.rotation.x = -1.9 + Math.sin(ph) * 0.7;
    p.armR.rotation.x = -1.9 + Math.sin(ph + Math.PI) * 0.7;
    p.foreL.rotation.x = -0.5 + Math.max(0, Math.sin(ph)) * 0.5;
    p.foreR.rotation.x = -0.5 + Math.max(0, Math.sin(ph + Math.PI)) * 0.5;
    p.neck.rotation.x = 1.15;
    p.legL.rotation.x = 0.3; p.legR.rotation.x = 0.35;
    return;
  }

  if (z.state === 'rising' || pose === 'rise') {
    const pr = z.state === 'rising' ? Math.min(1, z.riseT / 1.7) : 0.55;
    p.pelvis.position.y = 0.92;
    p.armL.rotation.x = -2.6 + Math.sin(t * 7) * 0.3;
    p.armR.rotation.x = -2.6 + Math.sin(t * 7 + 2) * 0.3;
    p.foreL.rotation.x = -0.4; p.foreR.rotation.x = -0.5;
    p.torso.rotation.x = 0.35 * (1 - pr);
    p.neck.rotation.x = -0.4 * (1 - pr);
    return;
  }

  if (z.state === 'tearing' || pose === 'reach') {
    const rp = (z.tearT ?? (t % 1.35)) / 1.35;
    const grab = Math.sin(rp * Math.PI * 2 * 2);
    p.torso.rotation.x = 0.35;
    p.armL.rotation.x = -1.9 + grab * 0.45;
    p.armR.rotation.x = -1.9 - grab * 0.45;
    p.foreL.rotation.x = -0.35; p.foreR.rotation.x = -0.3;
    p.neck.rotation.x = -0.25;
    p.legL.rotation.x = 0.06; p.legR.rotation.x = -0.06;
    return;
  }

  if (z.state === 'attacking' || pose === 'attack') {
    // raise to shoulder height, then slash forward-down at the player
    const ap = z.state === 'attacking' ? Math.min(1, z.atkT / 0.75) : 0.4;
    const swing = ap < 0.42 ? (ap / 0.42) : (1 - (ap - 0.42) / 0.58); // 0->1->0
    p.torso.rotation.x = 0.32 + ap * 0.3;
    p.armL.rotation.x = -1.15 - swing * 0.55;
    p.armR.rotation.x = -1.25 - swing * 0.5;
    p.armL.rotation.z = -0.18; p.armR.rotation.z = 0.16;
    p.foreL.rotation.x = -0.55 + swing * 0.35;
    p.foreR.rotation.x = -0.5 + swing * 0.3;
    p.neck.rotation.x = -0.28;
    p.jaw.rotation.x = 0.5;
    return;
  }

  // ---- locomotion (walk / jog / sprint / vault) ----
  const sprint = z.speedClass === 'sprint' ? 1 : 0;
  const stride = 0.42 + sprint * 0.35;
  p.legL.rotation.x = Math.sin(ph) * stride;
  p.legR.rotation.x = Math.sin(ph + Math.PI) * stride;
  p.kneeL.rotation.x = Math.max(0, -Math.sin(ph)) * (0.7 + sprint * 0.4);
  p.kneeR.rotation.x = Math.max(0, -Math.sin(ph + Math.PI)) * (0.7 + sprint * 0.4);
  p.pelvis.position.y = 0.92 + Math.abs(Math.sin(ph)) * 0.045 * (1 + sprint);
  p.pelvis.rotation.z = Math.sin(ph) * 0.045;
  p.torso.rotation.x = z.hunch + sprint * 0.3 + stag * 0.25;
  p.torso.rotation.z = Math.sin(ph) * 0.06;
  p.torso.rotation.y = Math.sin(ph * 0.5 + z.slot) * 0.05;
  if (sprint) {
    p.armL.rotation.x = -0.6 + Math.sin(ph + Math.PI) * 0.9;
    p.armR.rotation.x = -0.6 + Math.sin(ph) * 0.9;
    p.armL.rotation.z = 0.12; p.armR.rotation.z = -0.12;
    p.foreL.rotation.x = -0.9; p.foreR.rotation.x = -0.9;
  } else {
    // classic shamble: asymmetric forward reach, elbows bent, arms splayed
    // outward so the silhouette reads even head-on
    p.armL.rotation.x = (z.armBaseL ?? -1.2) + Math.sin(ph * 0.9 + 1) * 0.13 + stag * 0.5;
    p.armR.rotation.x = (z.armBaseR ?? -1.45) + Math.sin(ph * 1.1) * 0.13 + stag * 0.5;
    p.armL.rotation.z = -(z.splayL ?? 0.12);
    p.armR.rotation.z = (z.splayR ?? 0.1);
    p.foreL.rotation.x = (z.foreBaseL ?? -0.45) + Math.sin(ph * 0.7) * 0.14;
    p.foreR.rotation.x = (z.foreBaseR ?? -0.35) + Math.cos(ph * 0.8) * 0.14;
  }
  p.neck.rotation.x = (z.neckBase ?? -0.15) + Math.sin(ph * 0.53 + z.slot) * 0.1 + stag * -0.4;
  p.neck.rotation.z = (z.headTilt ?? 0) + Math.sin(ph * 0.31 + z.slot * 2) * 0.1;
  p.jaw.rotation.x = 0.18 + Math.max(0, Math.sin(t * 2.2 + z.slot * 3)) * 0.3;
}

const easeOut = (x) => 1 - Math.pow(1 - x, 3);
const easeInOut = (x) => x < 0.5 ? 2 * x * x : 1 - Math.pow(-2 * x + 2, 2) / 2;
const lerpTo = (a, b, k) => a + (b - a) * Math.min(1, k);
function dist2D(a, b) { const dx = a.x - b.x, dz = a.z - b.z; return Math.hypot(dx, dz); }
