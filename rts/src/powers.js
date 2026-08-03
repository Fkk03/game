// powers.js — generals XP/ranks, power purchase + activation, superweapons.
// OWNED BY: powers agent.
// API (contract):
//   tickPowers(dt) — rank-ups from p.xp (RANKS thresholds → p.rank,
//     p.ptsAvail++, emit 'rank:up'), cooldown ticking, superweapon charge
//     (building with def.superweapon alive+powered charges its POWERS entry),
//     stepping of live power effects (planes, chutes, beams, scuds, toxin),
//     AI auto-buy/auto-cast every few seconds.
//   buyPower(pid, powerId) — spend p.ptsAvail if rank met. Returns bool.
//   usePower(pid, powerId, x, z) — validate cooldown/charge then execute.
//   getSwTimers() -> [{pid, name, remaining, ready, powerId}] for the HUD.
//   areaDamage(x, z, r, dmg, type, attackerPid) — radial damage with falloff;
//     kills credit xp/kills to the caster player (via a unit-shaped proxy).
//   aiUsePower(pid) — one AI cast attempt (also driven internally).
// All fx calls are defensive (G.fx may be mid-implementation by the sim
// agent); plane/parachute/beam/scud/toxin visuals are built inline here.
// ---------------------------------------------------------------------------
// TEST SCAFFOLDING (SHOT_MODE only): url param &powertest=a10 (comma list ok,
// e.g. powertest=fab,paradrop) grants player 0 max xp + the listed powers
// 3 sim-seconds in, then casts each at the enemy base. Inert outside ?shot=.
// ---------------------------------------------------------------------------
import * as THREE from 'three';
import { G, on, emit, clamp, dist2d, HALF, SHOT_MODE, makeRng, V3 } from './core.js';
import { POWERS, RANKS } from './data.js';
import { spawnUnit, spawnBuilding, applyDamage, healEntity } from './entities.js';
import { addMoney } from './economy.js';

const rng = makeRng(90210);
const gY = (x, z) => (G.groundHeight ? G.groundHeight(x, z) : 0);
const cue = (name, opts) => G.audio?.cue?.(name, opts);

// ---------------------------------------------------------------- effects core
// Live effects: array of tick(dt) closures; return false to finish.
const effects = [];
function addEffect(tick) { effects.push(tick); }
function after(delay, fn) {
  let t = 0;
  addEffect((dt) => { t += dt; if (t >= delay) { fn(); return false; } return true; });
}
function disposeGroup(g) {
  if (!g) return;
  G.scene?.remove(g);
  g.traverse?.((o) => { o.geometry?.dispose?.(); o.material?.dispose?.(); });
}

// fx.explosion is (pos,r) today but the sim contract mentions (x,y,z,r); the
// heuristic on fn.length keeps us working across either signature.
function fxExplosion(x, y, z, r) {
  const fx = G.fx;
  if (!fx?.explosion) return;
  try {
    if (fx.explosion.length >= 3) fx.explosion(x, y, z, r);
    else fx.explosion(new THREE.Vector3(x, y, z), r);
  } catch { /* fx mid-refactor — never crash the sim */ }
}
function fxScorch(x, z, size) {
  try { G.fx?.scorch?.(new THREE.Vector3(x, gY(x, z), z), size); } catch {}
}
function fxSmoke(pos, opts) { try { G.fx?.smoke?.spawn?.(pos, opts); } catch {} }
function fxFire(pos, opts) { try { G.fx?.fire?.spawn?.(pos, opts); } catch {} }
function fxFlash(pos, opts) { try { G.fx?.flash?.spawn?.(pos, opts); } catch {} }
function fxTracer(from, to, speed) { try { G.fx?.tracer?.(from, to, speed); } catch {} }
function fxLight(pos, color, intensity, life, dist) { try { G.fx?.light?.(pos, color, intensity, life, dist); } catch {} }

function sandBurst(x, z, r = 3) {
  const y = gY(x, z);
  for (let i = 0; i < 8; i++) {
    fxSmoke(V3(x + (rng() - 0.5) * r, y + 0.4, z + (rng() - 0.5) * r), {
      vel: V3((rng() - 0.5) * 3, 2.5 + rng() * 3.5, (rng() - 0.5) * 3),
      size: 1.2 + rng() * r * 0.5, grow: r * 0.9, life: 0.7 + rng() * 0.6,
      opacity: 0.6, tint: 0xc9ab74, gravity: -3, fade: 1.2,
    });
  }
  fxLight(V3(x, y + 2, z), 0xd8b070, 8, 0.2, 20);
  try { G.fx?.spawnDebris?.(V3(x, y + 0.5, z), 5, 2.5); } catch {}
}

// ---------------------------------------------------------------- area damage
const proxies = new Map();   // pid -> unit-shaped attacker proxy for xp credit
function proxyFor(pid) {
  if (pid === undefined || pid === null || pid < 0) return null;
  if (!proxies.has(pid)) {
    proxies.set(pid, { alive: true, kind: 'unit', owner: pid, kills: 0, vet: 3 });
  }
  return proxies.get(pid);
}

export function areaDamage(x, z, r, dmg, type = 'shell', attackerPid = -1) {
  if (!(r > 0) || !(dmg > 0)) return;
  const list = G.entities.slice();
  for (const e of list) {
    if (!e.alive || !e.pos) continue;
    const d = Math.max(0, dist2d(x, z, e.pos.x, e.pos.z) - (e.radius || 0) * 0.5);
    if (d > r) continue;
    const fall = 1 - 0.65 * clamp(d / r, 0, 1);
    // no xp for hitting your own stuff, but friendly fire still hurts
    const atk = e.owner !== attackerPid ? proxyFor(attackerPid) : null;
    applyDamage(e, dmg * fall, type, atk);
  }
}

function boom(x, z, rVis, rDmg, dmg, type, pid) {
  const y = gY(x, z);
  fxExplosion(x, y + 0.5, z, rVis);
  areaDamage(x, z, rDmg, dmg, type, pid);
  cue('explosion', { r: rVis, x, z });
}

// ---------------------------------------------------------------- aircraft
function mat(color, rough = 0.7) { return new THREE.MeshStandardMaterial({ color, roughness: rough }); }
function box(w, h, d, m, x = 0, y = 0, z = 0, ry = 0) {
  const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
  b.position.set(x, y, z); b.rotation.y = ry; b.castShadow = true;
  return b;
}
function tube(r, len, m, x = 0, y = 0, z = 0) {
  const g = new THREE.CylinderGeometry(r, r, len, 8);
  g.rotateX(Math.PI / 2);                 // axis along Z
  const c = new THREE.Mesh(g, m);
  c.position.set(x, y, z); c.castShadow = true;
  return c;
}
// planes are built nose toward +Z; yaw = atan2(dir.x, dir.z) faces them along dir
function makePlane(kind) {
  const g = new THREE.Group();
  if (kind === 'transport') {
    const m = mat(0x6b755c), md = mat(0x49523f);
    g.add(tube(1.6, 13, m, 0, 0, 0));
    const nose = new THREE.Mesh(new THREE.ConeGeometry(1.6, 3.2, 8), m);
    nose.rotation.x = Math.PI / 2; nose.position.z = 8; nose.castShadow = true; g.add(nose);
    g.add(box(20, 0.45, 3.4, m, 0, 1.2, 1));                    // high wing
    g.add(box(7.5, 0.35, 2.2, md, 0, 2.6, -6));                 // tailplane
    g.add(box(0.35, 3.4, 3, md, 0, 2.4, -6));                   // fin
    for (const sx of [-3.4, 3.4, -6.8, 6.8]) g.add(tube(0.55, 2.6, md, sx, 0.5, 1.6));
  } else if (kind === 'a10') {
    const m = mat(0x8b939c), md = mat(0x5b6167);
    g.add(tube(1.05, 10, m, 0, 0, 0));
    const nose = new THREE.Mesh(new THREE.ConeGeometry(1.05, 2, 8), md);
    nose.rotation.x = Math.PI / 2; nose.position.z = 6; nose.castShadow = true; g.add(nose);
    g.add(tube(0.28, 1.6, mat(0x2c2c2c), 0, -0.4, 6.4));        // gatling
    g.add(box(14, 0.35, 2.8, m, 0, 0.1, 0.6));                  // straight wings
    g.add(box(6, 0.3, 1.8, m, 0, 1, -4.6));                     // tailplane
    for (const sx of [-2.6, 2.6]) g.add(box(0.28, 2, 1.8, md, sx, 1.8, -4.6));  // twin fins
    for (const sx of [-1.5, 1.5]) g.add(tube(0.75, 3, md, sx, 1.3, -2.4));      // engine pods
  } else { // bomber
    const m = mat(0x4c5148), md = mat(0x33362f);
    g.add(tube(1.9, 20, m, 0, 0, 0));
    const nose = new THREE.Mesh(new THREE.ConeGeometry(1.9, 4, 8), m);
    nose.rotation.x = Math.PI / 2; nose.position.z = 12; nose.castShadow = true; g.add(nose);
    g.add(box(13, 0.5, 4.5, m, -7.5, 0.4, -2, 0.55));           // swept wings
    g.add(box(13, 0.5, 4.5, m, 7.5, 0.4, -2, -0.55));
    g.add(box(0.4, 4.2, 3.6, md, 0, 2.6, -9));                  // fin
    g.add(box(8, 0.35, 2.4, md, 0, 1, -9));
    for (const sx of [-4.5, 4.5]) g.add(tube(0.85, 3.4, md, sx, -0.6, 0));
  }
  return g;
}

// Straight-line flyover: spawns the plane R1 metres short of (tx,tz) along
// dir, flies R1+R2 total, firing distance triggers along the way.
function flyover({ kind, tx, tz, dirX, dirZ, alt = 60, speed = 80, r1 = 220, r2 = 200, triggers = [] }) {
  if (!G.scene) return;
  const l = Math.hypot(dirX, dirZ) || 1;
  const ux = dirX / l, uz = dirZ / l;
  const sx = tx - ux * r1, sz = tz - uz * r1;
  const total = r1 + r2;
  const yBase = gY(tx, tz) + alt;
  const plane = makePlane(kind);
  plane.position.set(sx, yBase, sz);
  plane.rotation.y = Math.atan2(ux, uz);
  G.scene.add(plane);
  const trig = triggers.map((t) => ({ ...t, done: false }));
  let d = 0, smokeT = 0;
  addEffect((dt) => {
    d += speed * dt;
    const x = sx + ux * d, z = sz + uz * d;
    plane.position.set(x, Math.max(gY(x, z) + 18, yBase), z);
    plane.rotation.z = Math.sin(d * 0.012) * 0.06;
    smokeT += dt;
    if (smokeT > 0.09) {          // faint engine haze
      smokeT = 0;
      fxSmoke(plane.position.clone().add(V3(-ux * 6, -0.6, -uz * 6)), {
        vel: V3(0, 0.3, 0), size: 0.9, grow: 1.6, life: 0.8, opacity: 0.14, tint: 0xbfc4c9,
      });
    }
    for (const t of trig) if (!t.done && d >= t.d) { t.done = true; t.fn(x, plane.position.y, z); }
    if (d >= total) { disposeGroup(plane); return false; }
    return true;
  });
}

// direction of attack: from the caster's base through the target
function strikeDir(pid, x, z) {
  const p = G.players[pid];
  let dx = x - (p?.baseX ?? 0), dz = z - (p?.baseZ ?? 0);
  if (Math.hypot(dx, dz) < 1) { const a = rng() * Math.PI * 2; dx = Math.sin(a); dz = Math.cos(a); }
  const l = Math.hypot(dx, dz);
  return { x: dx / l, z: dz / l };
}

// ---------------------------------------------------------------- toxin field
function toxinField(pid, x, z, r, dur, dps) {
  if (!G.scene) return;
  const disc = new THREE.Mesh(
    new THREE.CircleGeometry(r, 26),
    new THREE.MeshBasicMaterial({
      color: 0x55c23a, transparent: true, opacity: 0.32, depthWrite: false,
      polygonOffset: true, polygonOffsetFactor: -4,
    }));
  disc.rotation.x = -Math.PI / 2;
  disc.rotation.z = rng() * 6;
  disc.position.set(x, gY(x, z) + 0.07 + rng() * 0.04, z);
  G.scene.add(disc);
  cue('toxin', { x, z });
  let t = 0, acc = 0, bub = 0;
  addEffect((dt) => {
    t += dt; acc += dt; bub += dt;
    if (acc >= 0.5) { acc -= 0.5; areaDamage(x, z, r, dps * 0.5, 'flame', pid); }
    if (bub >= 0.16) {
      bub = 0;
      const a = rng() * Math.PI * 2, rr = rng() * r * 0.85;
      const p = V3(x + Math.sin(a) * rr, gY(x, z) + 0.4, z + Math.cos(a) * rr);
      fxSmoke(p, { vel: V3(0, 1.1 + rng(), 0), size: 0.9, grow: 1.8, life: 1.1, opacity: 0.4, tint: 0x62c33e, fade: 1.3 });
      if (rng() < 0.35) fxFire(p, { vel: V3(0, 1.6, 0), size: 0.5, grow: 0.4, life: 0.4, opacity: 0.8, tint: 0x8dff52 });
    }
    if (t > dur - 2) disc.material.opacity = 0.32 * Math.max(0, (dur - t) / 2);
    if (t >= dur) { disposeGroup(disc); return false; }
    return true;
  });
}

// ---------------------------------------------------------------- power effects
function fxRepair(pid, x, z, r) {
  cue('repair', { x, z });
  let healed = 0;
  for (const e of G.entities) {
    if (!e.alive || e.owner !== pid) continue;
    if (!(e.kind === 'building' || e.def?.armor === 'vehicle')) continue;
    if (dist2d(x, z, e.pos.x, e.pos.z) > r) continue;
    healEntity(e, e.maxHp * 0.6);
    healed++;
    wrenchOver(e);
  }
  const y = gY(x, z);
  fxLight(V3(x, y + 4, z), 0x59ff8e, 20, 0.5, r * 2.2);
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2;
    fxFire(V3(x + Math.sin(a) * r * 0.8, y + 0.6, z + Math.cos(a) * r * 0.8), {
      vel: V3(0, 3.5, 0), size: 1.1, grow: 0.8, life: 0.8, opacity: 0.9, tint: 0x59ff8e,
    });
  }
  if (pid === G.humanId) emit('feed', healed ? `Field engineers repaired ${healed} asset${healed > 1 ? 's' : ''}` : 'Emergency repair — no damaged armour in the area');
}

let wrenchTex = null;
function wrenchOver(e) {
  if (typeof document === 'undefined') return;
  if (!wrenchTex) {
    const c = document.createElement('canvas'); c.width = c.height = 64;
    const g2 = c.getContext('2d');
    g2.font = '52px sans-serif'; g2.textAlign = 'center'; g2.textBaseline = 'middle';
    g2.fillText('🔧', 32, 36);
    wrenchTex = new THREE.CanvasTexture(c);
  }
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: wrenchTex, transparent: true, depthWrite: false }));
  const h = e.kind === 'building' ? Math.max(6, e.radius) : 4;
  s.position.set(e.pos.x, e.pos.y + h, e.pos.z);
  s.scale.set(3, 3, 1);
  G.scene?.add(s);
  let t = 0;
  addEffect((dt) => {
    t += dt;
    s.position.y += dt * 2.2;
    s.material.opacity = Math.max(0, 1 - t / 1.3);
    s.material.rotation = Math.sin(t * 6) * 0.5;
    if (t >= 1.3) { G.scene?.remove(s); s.material.dispose(); return false; }
    return true;
  });
}

function makeChute() {
  const g = new THREE.Group();
  const canopy = new THREE.Mesh(
    new THREE.SphereGeometry(2.3, 10, 5, 0, Math.PI * 2, 0, Math.PI / 2),
    new THREE.MeshStandardMaterial({ color: 0xded5bc, roughness: 0.9, side: THREE.DoubleSide }));
  canopy.position.y = 3.6; canopy.castShadow = true;
  g.add(canopy);
  const lineMat = new THREE.MeshBasicMaterial({ color: 0x494439 });
  for (const [lx, lz] of [[-1.4, 0], [1.4, 0], [0, -1.4], [0, 1.4]]) {
    const ln = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 2.6, 3), lineMat);
    ln.position.set(lx * 0.5, 2.3, lz * 0.5);
    ln.rotation.z = -lx * 0.28; ln.rotation.x = lz * 0.28;
    g.add(ln);
  }
  const man = box(0.6, 1.4, 0.5, mat(0x54604a), 0, 0.7, 0);
  g.add(man);
  return g;
}

function fxParadrop(pid, x, z) {
  const dir = strikeDir(pid, x, z);
  cue('plane', { x, z });
  const drops = [];
  for (let i = 0; i < 6; i++) drops.push({ d: 170 - 26 + i * 10, fn: (px, py, pz) => dropChute(pid, px, py, pz) });
  flyover({ kind: 'transport', tx: x, tz: z, dirX: dir.x, dirZ: dir.z, alt: 45, speed: 88, r1: 170, r2: 210, triggers: drops });
  if (pid === G.humanId) emit('feed', 'Ranger paradrop inbound');
}

function dropChute(pid, x, y, z) {
  if (!G.scene) return;
  cue('paradrop', { x, z });
  const chute = makeChute();
  const lx = x + (rng() - 0.5) * 9, lz = z + (rng() - 0.5) * 9;
  chute.position.set(x, y - 3, z);
  G.scene.add(chute);
  let t = 0;
  addEffect((dt) => {
    t += dt;
    chute.position.y -= 9 * dt;
    chute.position.x += (lx - chute.position.x) * dt * 0.9 + Math.sin(t * 2.2) * dt * 1.4;
    chute.position.z += (lz - chute.position.z) * dt * 0.9 + Math.cos(t * 1.9) * dt * 1.4;
    chute.rotation.y += dt * 0.5;
    chute.rotation.z = Math.sin(t * 2.2) * 0.12;
    const g = gY(chute.position.x, chute.position.z);
    if (chute.position.y <= g) {
      const px = chute.position.x, pz = chute.position.z;
      disposeGroup(chute);
      try { spawnUnit('ranger', pid, px, pz, rng() * Math.PI * 2); } catch {}
      sandBurst(px, pz, 2);
      return false;
    }
    return true;
  });
}

function fxA10(pid, x, z) {
  const dir = strikeDir(pid, x, z);
  const perp = { x: -dir.z, z: dir.x };
  if (pid !== G.humanId) emit('announce', 'WARNING — AIRSTRIKE INBOUND');
  else emit('feed', 'A-10 strike inbound — three passes');
  for (let run = 0; run < 3; run++) {
    after(run * 1.2, () => {
      const off = (run - 1) * 7;
      const tx = x + perp.x * off, tz = z + perp.z * off;
      cue('plane', { x: tx, z: tz });
      flyover({
        kind: 'a10', tx, tz, dirX: dir.x, dirZ: dir.z, alt: 32, speed: 95, r1: 240, r2: 220,
        triggers: [{ d: 240 - 70, fn: () => cue('a10_gun', { x: tx, z: tz }) }],
      });
      // cannon hose + walking impacts along the strafe line, driven separately
      let t = 0, hoseT = 0, burstT = 0, dist = 0;
      addEffect((dt) => {
        t += dt;
        if (t < (240 - 70) / 95) return true;          // wait for gun-on
        if (t > (240 + 30) / 95) return false;         // pass complete
        dist = (t * 95) - 240;                          // impact point rel target
        const ix = tx + dir.x * (dist + 34), iz = tz + dir.z * (dist + 34);
        const iy = gY(ix, iz);
        const px = tx + dir.x * dist, pz = tz + dir.z * dist;
        const py = gY(tx, tz) + 32;
        hoseT += dt;
        while (hoseT > 0.02) {
          hoseT -= 0.02;
          const jx = ix + (rng() - 0.5) * 5, jz = iz + (rng() - 0.5) * 5;
          fxTracer(V3(px + (rng() - 0.5) * 1.5, py - 1, pz + (rng() - 0.5) * 1.5),
            V3(jx, gY(jx, jz), jz), 300);
        }
        burstT += dt;
        if (burstT > 0.09) {
          burstT = 0;
          const bx = ix + (rng() - 0.5) * 3, bz = iz + (rng() - 0.5) * 3;
          fxExplosion(bx, gY(bx, bz) + 0.3, bz, 1.9 + rng() * 0.9);
          areaDamage(bx, bz, 6.5, 70, 'cannon', pid);
          cue('a10_gun', { x: bx, z: bz });
        }
        fxLight(V3(px, py - 2, pz), 0xffd080, 26, 0.05, 30);
        fxLight(V3(ix, iy + 2, iz), 0xffb060, 14, 0.08, 24);
        return true;
      });
    });
  }
}

function bombRun(pid, x, z, kind, onBoom) {
  const dir = strikeDir(pid, x, z);
  cue('plane', { x, z });
  flyover({
    kind: 'bomber', tx: x, tz: z, dirX: dir.x, dirZ: dir.z, alt: 55, speed: 72, r1: 220, r2: 240,
    triggers: [{
      d: 220 - 42, fn: (px, py, pz) => {
        // free-falling bomb
        const bomb = new THREE.Group();
        bomb.add(tube(0.7, 3.6, mat(kind === 'anthrax' ? 0x4a6b3a : 0x3c3f45), 0, 0, 0));
        const cone = new THREE.Mesh(new THREE.ConeGeometry(0.7, 1.4, 8), mat(kind === 'anthrax' ? 0x69a04a : 0x23252a));
        cone.rotation.x = Math.PI / 2; cone.position.z = 2.4; bomb.add(cone);
        bomb.position.set(px, py - 2, pz);
        bomb.rotation.y = Math.atan2(dir.x, dir.z);
        G.scene?.add(bomb);
        let vy = -8;
        const vx = dir.x * 34, vz = dir.z * 34;
        addEffect((dt) => {
          vy -= 55 * dt;
          bomb.position.x += vx * dt; bomb.position.z += vz * dt; bomb.position.y += vy * dt;
          bomb.rotation.x = Math.min(1.3, bomb.rotation.x + dt * 0.9);
          const g = gY(bomb.position.x, bomb.position.z);
          if (bomb.position.y <= g + 1) {
            const bx = bomb.position.x, bz = bomb.position.z;
            disposeGroup(bomb);
            onBoom(bx, bz);
            return false;
          }
          return true;
        });
      },
    }],
  });
}

function fxFab(pid, x, z) {
  if (pid !== G.humanId) emit('announce', 'WARNING — FUEL AIR BOMB INBOUND');
  else emit('feed', 'Fuel Air Bomb away', 'good');
  bombRun(pid, x, z, 'fab', (bx, bz) => {
    const y = gY(bx, bz);
    fxExplosion(bx, y + 1, bz, 13);
    try { G.fx?.bigExplosion?.(V3(bx, y + 1, bz), 20); } catch {}
    fxFlash(V3(bx, y + 6, bz), { size: 60, life: 0.14, opacity: 1 });
    fxLight(V3(bx, y + 10, bz), 0xffd9a0, 400, 0.6, 160);
    fxScorch(bx, bz, 22);
    try { G.fx?.shake?.(1.6); } catch {}
    areaDamage(bx, bz, 26, 400, 'shell', pid);
    cue('explosion', { r: 26, x: bx, z: bz });
    // expanding ring of secondaries
    let rt = 0, ring = 0;
    addEffect((dt) => {
      rt += dt;
      const want = Math.floor(rt / 0.07);
      while (ring < Math.min(10, want)) {
        ring++;
        const a = rng() * Math.PI * 2, rr = 6 + ring * 1.7;
        fxExplosion(bx + Math.sin(a) * rr, gY(bx + Math.sin(a) * rr, bz + Math.cos(a) * rr) + 0.5, bz + Math.cos(a) * rr, 3.5);
      }
      return ring < 10;
    });
  });
}

function fxAnthrax(pid, x, z) {
  if (pid !== G.humanId) emit('announce', 'WARNING — TOXIN BOMBER INBOUND');
  else emit('feed', 'Anthrax bomber on approach', 'good');
  bombRun(pid, x, z, 'anthrax', (bx, bz) => {
    const y = gY(bx, bz);
    fxExplosion(bx, y + 1, bz, 9);
    fxLight(V3(bx, y + 8, bz), 0x86ff4a, 220, 0.6, 110);
    for (let i = 0; i < 14; i++) {
      const a = rng() * Math.PI * 2, rr = rng() * 14;
      fxFire(V3(bx + Math.sin(a) * rr, y + 1 + rng() * 3, bz + Math.cos(a) * rr), {
        vel: V3((rng() - 0.5) * 4, 3 + rng() * 5, (rng() - 0.5) * 4),
        size: 2.5 + rng() * 2.5, grow: 5, life: 0.5 + rng() * 0.4, opacity: 0.95, tint: 0x7dff4a,
      });
      fxSmoke(V3(bx + Math.sin(a) * rr, y + 2, bz + Math.cos(a) * rr), {
        vel: V3((rng() - 0.5) * 2, 2.5 + rng() * 3, (rng() - 0.5) * 2),
        size: 3, grow: 6, life: 1.6 + rng(), opacity: 0.55, tint: 0x3f6b2c, fade: 1.3,
      });
    }
    fxScorch(bx, bz, 16);
    try { G.fx?.shake?.(0.9); } catch {}
    areaDamage(bx, bz, 24, 300, 'flame', pid);
    cue('explosion', { r: 18, x: bx, z: bz });
    toxinField(pid, bx, bz, 16, 10, 24);
  });
}

function fxAmbush(pid, x, z) {
  cue('ambush', { x, z });
  if (pid === G.humanId) emit('feed', 'Rebel ambush sprung', 'good');
  for (let i = 0; i < 8; i++) {
    after(i * 0.12, () => {
      const a = (i / 8) * Math.PI * 2 + rng() * 0.5;
      const rr = 7 + rng() * 6;      // wide ring so buildings don't swallow them
      const px = clamp(x + Math.sin(a) * rr, -HALF + 4, HALF - 4);
      const pz = clamp(z + Math.cos(a) * rr, -HALF + 4, HALF - 4);
      sandBurst(px, pz, 2.5);
      try { spawnUnit('rebel', pid, px, pz, rng() * Math.PI * 2); } catch {}
    });
  }
}

function fxSneak(pid, x, z) {
  sandBurst(x, z, 6);
  after(0.25, () => {
    try {
      spawnBuilding('tunnel', pid, x, z, rng() * Math.PI * 2, { instant: true });
      sandBurst(x, z, 5);
    } catch {}
  });
  if (pid === G.humanId) emit('feed', 'Tunnel network surfacing at target', 'good');
  cue('ambush', { x, z });
}

// ---------------------------------------------------------------- superweapons
function makeBeamGroup() {
  const g = new THREE.Group();
  const H = 170;
  const mk = (r, color, opacity) => {
    const c = new THREE.Mesh(
      new THREE.CylinderGeometry(r, r * 1.25, H, 12, 1, true),
      new THREE.MeshBasicMaterial({
        color, transparent: true, opacity, blending: THREE.AdditiveBlending,
        depthWrite: false, side: THREE.DoubleSide,
      }));
    c.position.y = H / 2;
    return c;
  };
  g.add(mk(0.8, 0xf2ffff, 0.95));
  g.add(mk(2.6, 0x7fd4ff, 0.3));
  const glow = new THREE.Mesh(
    new THREE.CircleGeometry(8, 26),
    new THREE.MeshBasicMaterial({
      color: 0x9fdcff, transparent: true, opacity: 0.55,
      blending: THREE.AdditiveBlending, depthWrite: false,
    }));
  glow.rotation.x = -Math.PI / 2;
  glow.position.y = 0.15;
  g.add(glow);
  return g;
}

function fxParticleBeam(pid, x, z, src) {
  const sx = src?.pos?.x ?? G.players[pid]?.baseX ?? 0;
  const sz = src?.pos?.z ?? G.players[pid]?.baseZ ?? 0;
  let dx = x - sx, dz = z - sz;
  const dl = Math.hypot(dx, dz) || 1;
  dx /= dl; dz /= dl;
  const ax = x - dx * 14, az = z - dz * 14;    // sweep start → 30m path
  const bx = x + dx * 16, bz = z + dz * 16;
  const DUR = 6;
  emit('announce', pid === G.humanId ? 'PARTICLE CANNON FIRING' : 'WARNING — PARTICLE CANNON FIRING');
  emit('feed', pid === G.humanId ? 'Particle beam on target' : 'Enemy particle beam detected', pid === G.humanId ? 'good' : 'bad');
  cue('sw_launch', { x, z });
  cue('sw_beam', { x, z });
  // fx.beam(x, z, dur) -> handle{setPos(x,z)} per the sim contract; fall back
  // to an inline glow column if it's absent or shaped differently.
  let handle = null;
  try {
    handle = typeof G.fx?.beam === 'function' ? G.fx.beam(ax, az, DUR) : null;
    if (typeof handle?.setPos !== 'function') handle = null;
  } catch { handle = null; }
  const beam = handle ? null : makeBeamGroup();
  if (beam) { beam.position.set(ax, gY(ax, az), az); G.scene?.add(beam); }
  let t = 0, dmgT = 0, scorchT = 0;
  addEffect((dt) => {
    t += dt;
    const k = Math.min(1, t / DUR);
    const px = ax + (bx - ax) * k, pz = az + (bz - az) * k;
    const py = gY(px, pz);
    if (handle) {
      try { handle.setPos(px, pz); } catch {}
    } else if (beam) {
      beam.position.set(px, py, pz);
      const pulse = 1 + Math.sin(t * 42) * 0.16;
      beam.children[0].scale.set(pulse, 1, pulse);
      beam.children[1].scale.set(2 - pulse * 0.6, 1, 2 - pulse * 0.6);
      beam.rotation.y += dt * 3;
      fxLight(V3(px, py + 8, pz), 0x9fdcff, 90, 0.2, 70);
      try { G.fx?.shake?.(0.12); } catch {}
    }
    dmgT += dt;
    while (dmgT >= 0.15) {
      dmgT -= 0.15;
      areaDamage(px, pz, 7, 34, 'beam', pid);
      fxFire(V3(px + (rng() - 0.5) * 4, py + 0.6, pz + (rng() - 0.5) * 4), {
        vel: V3((rng() - 0.5) * 5, 5 + rng() * 6, (rng() - 0.5) * 5),
        size: 1.6, grow: 2.4, life: 0.4, opacity: 1, tint: 0xbfe8ff,
      });
      fxSmoke(V3(px, py + 1.2, pz), {
        vel: V3((rng() - 0.5) * 2, 3.5 + rng() * 2, (rng() - 0.5) * 2),
        size: 2, grow: 4, life: 1.5, opacity: 0.5, tint: 0x39322a, fade: 1.3,
      });
    }
    scorchT += dt;
    if (scorchT > 0.5) { scorchT = 0; fxScorch(px, pz, 3.5 + rng() * 1.5); cue('sw_beam', { x: px, z: pz }); }
    if (t >= DUR) {
      fxExplosion(px, py + 1, pz, 6);
      areaDamage(px, pz, 10, 120, 'beam', pid);
      if (beam) disposeGroup(beam);
      return false;
    }
    return true;
  });
}

function makeScudMesh() {
  const g = new THREE.Group();
  g.add(tube(0.55, 5, mat(0x8f8878), 0, 0, 0));
  const nose = new THREE.Mesh(new THREE.ConeGeometry(0.55, 1.6, 8), mat(0x5c7a44));
  nose.rotation.x = Math.PI / 2; nose.position.z = 3.2; g.add(nose);
  for (let i = 0; i < 3; i++) {
    const f = box(0.1, 1, 1.1, mat(0x4c483e), 0, 0, -2.2);
    f.rotation.z = (i / 3) * Math.PI * 2;
    f.position.x = Math.sin((i / 3) * Math.PI * 2) * 0.5;
    f.position.y = Math.cos((i / 3) * Math.PI * 2) * 0.5;
    g.add(f);
  }
  return g;
}

function fxScudStorm(pid, x, z, src) {
  const lx = src?.pos?.x ?? G.players[pid]?.baseX ?? 0;
  const lz = src?.pos?.z ?? G.players[pid]?.baseZ ?? 0;
  emit('announce', pid === G.humanId ? 'SCUD STORM LAUNCHED' : 'WARNING — SCUD STORM LAUNCH DETECTED');
  emit('feed', pid === G.humanId ? 'Nine birds in the air' : 'Enemy scud launch detected', pid === G.humanId ? 'good' : 'bad');
  cue('sw_launch', { x: lx, z: lz });
  const R = POWERS.sw_scud.radius || 30;
  for (let i = 0; i < 9; i++) {
    after(i * 0.62, () => {
      const a = rng() * Math.PI * 2, rr = rng() * R * 0.8;
      const tx = clamp(x + Math.sin(a) * rr, -HALF + 6, HALF - 6);
      const tz = clamp(z + Math.cos(a) * rr, -HALF + 6, HALF - 6);
      launchScud(pid, lx + (rng() - 0.5) * 8, lz + (rng() - 0.5) * 8, tx, tz);
    });
  }
}

function launchScud(pid, sx, sz, tx, tz) {
  if (!G.scene) return;
  const scud = makeScudMesh();
  const sy = gY(sx, sz) + 2, ty = gY(tx, tz);
  scud.position.set(sx, sy, sz);
  G.scene.add(scud);
  const dist = dist2d(sx, sz, tx, tz);
  const dur = 1.5 + dist / 220;
  const apex = 60 + dist * 0.22;
  cue('rocket', { x: sx, z: sz });
  fxLight(V3(sx, sy + 3, sz), 0xffc070, 40, 0.4, 40);
  sandBurst(sx, sz, 3);
  let t = 0, trailT = 0;
  const posAt = (k) => V3(
    sx + (tx - sx) * k,
    sy + (ty - sy) * k + apex * 4 * k * (1 - k),
    sz + (tz - sz) * k);
  addEffect((dt) => {
    t += dt;
    const k = Math.min(1, t / dur);
    const p = posAt(k);
    const ahead = posAt(Math.min(1, k + 0.02));
    scud.position.copy(p);
    const dir = ahead.sub(p);
    if (dir.lengthSq() > 1e-6) {
      scud.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), dir.normalize());
    }
    trailT += dt;
    while (trailT > 0.035) {
      trailT -= 0.035;
      fxSmoke(p.clone(), { vel: V3(0, 0.4, 0), size: 1.5, grow: 2.4, life: 2, opacity: 0.5, tint: 0xd9d4c8, fade: 1.2 });
      fxFire(p.clone(), { vel: V3(0, 0, 0), size: 1, grow: -0.5, life: 0.14, opacity: 1, tint: 0xffc36a });
    }
    if (k >= 1) {
      disposeGroup(scud);
      boom(tx, tz, 6, 12, 150, 'rocket', pid);
      fxScorch(tx, tz, 7);
      try { G.fx?.shake?.(0.5); } catch {}
      toxinField(pid, tx, tz, 8, 8, 16);
      return false;
    }
    return true;
  });
}

// ---------------------------------------------------------------- casting
const CASTS = {
  repair: (pid, x, z) => fxRepair(pid, x, z, POWERS.repair.radius),
  paradrop: fxParadrop,
  a10: fxA10,
  fab: fxFab,
  ambush: fxAmbush,
  sneak: fxSneak,
  anthrax: fxAnthrax,
  sw_particle: fxParticleBeam,
  sw_scud: fxScudStorm,
};

function castPower(pid, powerId, x, z, src = null) {
  const fn = CASTS[powerId];
  if (!fn) return false;
  x = clamp(x, -HALF + 6, HALF - 6);
  z = clamp(z, -HALF + 6, HALF - 6);
  cue('power_cast', { x, z });
  fn(pid, x, z, src);
  return true;
}

export function buyPower(pid, powerId) {
  const p = G.players[pid], pow = POWERS[powerId];
  if (!p || !pow || pow.superweapon) return false;
  if (pow.faction && pow.faction !== p.faction) return false;
  if (p.powersOwned.has(powerId)) return false;
  if (p.ptsAvail <= 0 || p.rank < pow.rank) return false;
  p.ptsAvail--;
  p.powersOwned.add(powerId);
  emit('power:changed', pid);
  if (pid === G.humanId) {
    emit('feed', `${pow.name} acquired`, 'good');
    cue('power_ready');
  }
  return true;
}

export function usePower(pid, powerId, x, z) {
  const p = G.players[pid], pow = POWERS[powerId];
  if (!p || !pow || pow.passive || !pow.targeted) return false;
  let src = null;
  if (pow.superweapon) {
    src = G.buildings.find((b) =>
      b.alive && b.owner === pid && b.def.superweapon === powerId &&
      b.buildProgress >= 1 && (swState.get(b.id)?.charge ?? 0) >= pow.cooldown);
    if (!src) return false;
    swState.get(src.id).charge = 0;
  } else {
    if (!p.powersOwned.has(powerId)) return false;
    if ((p.powerCooldowns[powerId] || 0) > 0) return false;
    p.powerCooldowns[powerId] = pow.cooldown;
  }
  castPower(pid, powerId, x, z, src);
  emit('power:changed', pid);
  return true;
}

// ---------------------------------------------------------------- passives
// War Bounty: killer's owner earns 10% of the victim's cost.
on('entity:died', (e, attacker) => {
  if (!e?.def?.cost || !attacker || attacker.owner === undefined) return;
  if (attacker.owner === e.owner || attacker.owner < 0) return;
  const p = G.players[attacker.owner];
  if (!p?.powersOwned?.has('bounty')) return;
  const cut = Math.round(e.def.cost * 0.1);
  if (cut <= 0) return;
  try { addMoney(attacker.owner, cut); } catch { p.money += cut; }
  if (attacker.owner === G.humanId) cue('bounty', { x: e.pos?.x, z: e.pos?.z });
});

// ---------------------------------------------------------------- superweapon charge
const swState = new Map();    // building id -> { charge }

function tickSw(dt) {
  for (const [id, st] of swState) {
    const b = G.byId.get(id);
    if (!b || !b.alive) swState.delete(id);
  }
  for (const b of G.buildings) {
    if (!b.alive || !b.def.superweapon || b.buildProgress < 1) continue;
    let st = swState.get(b.id);
    if (!st) { st = { charge: 0 }; swState.set(b.id, st); }
    if (b.powered === false) continue;       // low power pauses the countdown
    const pow = POWERS[b.def.superweapon];
    if (!pow || st.charge >= pow.cooldown) continue;
    st.charge += dt;
    if (st.charge >= pow.cooldown) {
      st.charge = pow.cooldown;
      emit('power:changed', b.owner);
      const nm = pow.name.toUpperCase();
      if (b.owner === G.humanId) {
        emit('announce', `${nm} READY`);
        emit('feed', `${pow.name} ready — select target`, 'good');
      } else {
        emit('feed', `WARNING: enemy ${pow.name} armed`, 'bad');
      }
      cue('sw_klaxon');
    }
  }
}

export function getSwTimers() {
  const best = new Map();     // pid|powerId -> entry
  for (const b of G.buildings) {
    if (!b.alive || !b.def.superweapon || b.buildProgress < 1) continue;
    const pow = POWERS[b.def.superweapon];
    if (!pow) continue;
    const charge = swState.get(b.id)?.charge ?? 0;
    const entry = {
      pid: b.owner, powerId: pow.id, name: pow.name,
      remaining: Math.max(0, pow.cooldown - charge),
      ready: charge >= pow.cooldown,
    };
    const key = b.owner + '|' + pow.id;
    const cur = best.get(key);
    if (!cur || entry.remaining < cur.remaining) best.set(key, entry);
  }
  return [...best.values()];
}

// ---------------------------------------------------------------- AI usage
function pickStrikeTarget(foePid) {
  const bs = G.buildings.filter((b) => b.alive && b.owner === foePid);
  if (bs.length) {
    // prefer expensive structures
    bs.sort((a, b) => (b.def.cost || 0) - (a.def.cost || 0));
    const b = bs[Math.floor(rng() * Math.min(3, bs.length))];
    return { x: b.pos.x, z: b.pos.z };
  }
  const us = G.units.filter((u) => u.alive && u.owner === foePid);
  if (us.length) { const u = us[Math.floor(rng() * us.length)]; return { x: u.pos.x, z: u.pos.z }; }
  return null;
}
function pickDamagedFriendly(pid) {
  const hurt = G.entities.filter((e) =>
    e.alive && e.owner === pid && e.hp < e.maxHp * 0.55 &&
    (e.kind === 'building' || e.def?.armor === 'vehicle'));
  if (hurt.length < 1) return null;
  const e = hurt[Math.floor(rng() * hurt.length)];
  return { x: e.pos.x, z: e.pos.z };
}
function pickFlankTarget(foePid) {
  const foe = G.players[foePid];
  if (!foe) return null;
  const a = rng() * Math.PI * 2;
  return {
    x: clamp(foe.baseX + Math.sin(a) * 45, -HALF + 10, HALF - 10),
    z: clamp(foe.baseZ + Math.cos(a) * 45, -HALF + 10, HALF - 10),
  };
}

export function aiUsePower(pid) {
  const p = G.players[pid];
  if (!p || !p.alive) return false;
  const foe = G.players.find((q) => q && q.id !== pid && q.alive);
  for (const t of getSwTimers()) {
    if (t.pid !== pid || !t.ready || !foe) continue;
    const tgt = pickStrikeTarget(foe.id);
    if (tgt && usePower(pid, t.powerId, tgt.x, tgt.z)) return true;
  }
  for (const id of p.powersOwned) {
    const pow = POWERS[id];
    if (!pow || pow.passive || !pow.targeted) continue;
    if ((p.powerCooldowns[id] || 0) > 0) continue;
    let tgt = null;
    if (id === 'repair') tgt = pickDamagedFriendly(pid);
    else if (id === 'sneak' || id === 'ambush' || id === 'paradrop') tgt = foe && pickFlankTarget(foe.id);
    else tgt = foe && pickStrikeTarget(foe.id);
    if (tgt && usePower(pid, id, tgt.x, tgt.z)) return true;
  }
  return false;
}

let aiT = 0;
function tickAiPowers(dt) {
  aiT += dt;
  if (aiT < 4) return;
  aiT = 0;
  for (const p of G.players) {
    if (!p || p.human || !p.alive) continue;
    if (p.ptsAvail > 0) {
      const opts = Object.values(POWERS)
        .filter((pw) => !pw.superweapon && pw.faction === p.faction &&
          p.rank >= pw.rank && !p.powersOwned.has(pw.id))
        .sort((a, b) => a.rank - b.rank);
      if (opts.length) buyPower(p.id, opts[0].id);
    }
    // grace period — no AI power strikes in the opening minute
    if (G.gameTime > 45) aiUsePower(p.id);
  }
}

// ---------------------------------------------------------------- shot-mode test hook
const TEST_POWERS = SHOT_MODE
  ? (new URLSearchParams(location.search).get('powertest') || '') : '';
let testFired = false;
function tickTestHook() {
  if (!TEST_POWERS || testFired || G.gameTime < 3 || !G.players.length) return;
  testFired = true;
  const p = G.players[0];
  p.xp = Math.max(p.xp, 5000);              // exercises the rank-up path too
  const foe = G.players[1];
  const bx = foe?.baseX ?? 0, bz = foe?.baseZ ?? 0;
  const dl = Math.hypot(bx, bz) || 1;       // toward map centre
  for (const raw of TEST_POWERS.split(',')) {
    const id = raw.trim();
    if (!POWERS[id]) continue;
    if (!POWERS[id].superweapon) p.powersOwned.add(id);
    // ground-spawn powers aim beside the base so the CC doesn't swallow them
    const off = (id === 'ambush' || id === 'sneak' || id === 'repair') ? 32 : 0;
    castPower(0, id, bx - (bx / dl) * off, bz - (bz / dl) * off, null);
  }
}

// ---------------------------------------------------------------- main tick
export function tickPowers(dt) {
  if (!G.players.length) return;
  tickTestHook();

  for (const p of G.players) {
    // rank progression
    while (p.rank < RANKS.length && p.xp >= RANKS[p.rank]) {
      p.rank++;
      p.ptsAvail++;
      emit('rank:up', p.id);
      emit('power:changed', p.id);
      if (p.id === G.humanId) {
        emit('feed', `Promoted to rank ${p.rank}`, 'good');
        emit('announce', "PROMOTION — choose a General's Power");
      }
    }
    // cooldowns
    for (const id of Object.keys(p.powerCooldowns)) {
      p.powerCooldowns[id] -= dt;
      if (p.powerCooldowns[id] <= 0) {
        delete p.powerCooldowns[id];
        emit('power:changed', p.id);
        if (p.id === G.humanId) {
          emit('feed', `${POWERS[id]?.name || id} ready`, 'good');
          cue('power_ready');
        }
      }
    }
  }

  tickSw(dt);
  tickAiPowers(dt);

  for (let i = effects.length - 1; i >= 0; i--) {
    let alive = true;
    try { alive = effects[i](dt) !== false; } catch { alive = false; }
    if (!alive) effects.splice(i, 1);
  }
}
