// combat.js — target acquisition, weapons fire, projectiles, splash.
// OWNED BY: sim agent.
// API (called from main loop / other systems):
//   tickCombat(dt)  — auto-acquire for idle/attackmove units + defense
//     buildings; step projectiles; apply damage via entities.applyDamage.
//   orderAttack(units, target) — explicit attack order.
//   Projectile visuals/explosions delegate to G.fx (fx.js API: tracer(from,to),
//     shellArc(from,to,cb), rocketTrail(from,to,cb), explosion(x,y,z,r),
//     muzzleFlash(pos,dir)).
//   Weapon rules: def.weapon fields (range, reload, damage, type, splash,
//     burst, antiAir, groundOnly, minRange) + ARMOR table via applyDamage.
//   Turrets: e.mesh.userData.turret rotates toward target before firing.
// Behaviour notes (GZH feel):
//   - bullet: hitscan + tracer + muzzle flash;  shell: arcing projectile with
//     travel time + ground splash;  rocket: homing-ish projectile w/ trail
//     (groundOnly rockets = artillery lobbed at the ground);  cannon: rapid
//     flak (air-burst puffs vs aircraft);  burst: N quick shots per trigger.
//   - Veterancy: +10% damage per chevron. Upgrades via production.dmgMult.
//   - Vehicles with def.crush flatten enemy infantry they drive over.
import * as THREE from 'three';
import { G, emit, makeRng, dist2d, angleTo, turnToward } from './core.js';
import { applyDamage, kill } from './entities.js';
import { unitsNear } from './move.js';
import { dmgMult } from './production.js';
import { buildMesh } from './meshes.js';

const rng = makeRng(1717);
const V = (x, y, z) => new THREE.Vector3(x, y, z);

function angDiff(a, b) {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
}

const isAir = (e) => !!e.def.air;

// can this weapon legally engage that target?
function canHit(w, t) {
  if (isAir(t)) return !!w.antiAir && !w.groundOnly;
  return true;
}

function validTarget(e, t) {
  if (!t || !t.alive || t === e) return false;
  if (t.owner === e.owner) return false;
  return canHit(e.def.weapon, t);
}

// range measured to the edge of big footprints, GZH-style
function effDist(e, t) {
  const d = dist2d(e.pos.x, e.pos.z, t.pos.x, t.pos.z);
  return Math.max(0, d - (t.kind === 'building' ? t.radius * 0.7 : 0));
}

// pick the best target: closest, with a bias toward armed threats and
// whoever is currently shooting at us. Neutrals are never auto-acquired.
function acquire(e) {
  const w = e.def.weapon;
  const roaming = e.kind === 'unit' && e.order?.type === 'attackmove';
  const R = e.kind === 'building' ? w.range
    : roaming ? Math.max(w.range + 8, Math.min(e.sight, w.range + 18))
      : w.range + 2;
  let best = null, bs = Infinity;
  for (const t of G.entities) {
    if (!t.alive || t.owner === e.owner || t.owner === -1) continue;
    if (!canHit(w, t)) continue;
    const d = effDist(e, t);
    if (d > R) continue;
    if (w.minRange && d < w.minRange && !roaming) continue;
    let score = d;
    if (t.def.weapon) score -= 8;
    if (t.target === e) score -= 6;
    if (t.kind === 'building' && !t.def.weapon) score += 12;
    if (score < bs) { bs = score; best = t; }
  }
  return best;
}

function pathTo(e, x, z) {
  if (e.def.air) return [{ x, z }];
  return G.nav.findPath(e.pos.x, e.pos.z, x, z) || [{ x, z }];
}

function slewRate(e) {
  if (e.kind === 'building') return 2.6;
  if (e.def.air) return 6;
  return e.def.role === 'infantry' ? 7 : 3.0;
}

// world-space muzzle: turret muzzle if the mesh has one, else centre mass
function muzzleWorld(e) {
  const ud = e.mesh?.userData;
  if (ud?.turret && ud.muzzle) {
    e.mesh.updateMatrixWorld(true);
    return ud.turret.localToWorld(ud.muzzle.clone());
  }
  const p = e.pos.clone();
  if (e.kind === 'building') p.y += Math.max(3, Math.min(e.def.size?.[0] ?? 8, e.def.size?.[1] ?? 8) * 0.4);
  else if (!e.def.air) p.y += e.def.role === 'infantry' ? 1.4 : 2.1;
  return p;
}

function aimPoint(t) {
  const p = t.pos.clone();
  if (t.kind === 'building') p.y += Math.max(2, Math.min(6, t.radius * 0.5));
  else if (!t.def.air) p.y += t.def.role === 'infantry' ? 1.1 : 1.4;
  return p;
}

// gentle friendly-fire splash, full damage to enemies; ground bursts can't
// reach aircraft altitude. ARMOR multipliers applied inside applyDamage.
function splashDamage(at, r, dmg, type, attacker, exclude = null) {
  for (const t of G.entities) {
    if (!t.alive || t === exclude || t === attacker) continue;
    if (isAir(t) && Math.abs(t.pos.y - at.y) > 8) continue;
    const shrink = t.kind === 'building' ? t.radius * 0.5 : t.radius * 0.3;
    const d = Math.max(0, dist2d(t.pos.x, t.pos.z, at.x, at.z) - shrink);
    if (d > r) continue;
    let f = 1 - 0.65 * d / r;
    if (attacker && t.owner === attacker.owner) f *= 0.35;
    applyDamage(t, dmg * f, type, attacker);
  }
}

// throttled, camera-attenuated combat audio (no-op when audio disabled)
let sndBudget = 0;
function maybeSound(e, kind) {
  const au = G.audio;
  if (!au?.ctx || sndBudget < 1 || !G.camera) return;
  const d = G.camera.position.distanceTo(e.pos);
  if (d > 170) return;
  sndBudget -= 1;
  if (kind === 'bullet' || kind === 'cannon') au.enemyShot?.(d * 0.45);
  else if (kind === 'rocket') au.rocketLaunch?.();
  else if (kind === 'shell') au.explosion?.(0.4);
}

function fireShot(e, t) {
  const w = e.def.weapon;
  const dmg = w.damage * (1 + 0.1 * (e.vet || 0)) * (dmgMult(G.players[e.owner], e.def) || 1);
  const fx = G.fx;
  const mp = muzzleWorld(e);
  const tp = aimPoint(t);
  const dir = tp.clone().sub(mp).normalize();
  maybeSound(e, w.type);

  if (w.type === 'bullet') {
    fx?.muzzleFlash(mp, dir);
    fx?.tracer(mp, tp);
    fx?.impact(tp, dir.clone().negate(), t.def.armor === 'infantry' ? 'flesh' : 'metal');
    applyDamage(t, dmg, 'bullet', e);

  } else if (w.type === 'shell') {
    const ip = V(t.pos.x + (rng() - 0.5) * 2.6, 0, t.pos.z + (rng() - 0.5) * 2.6);
    ip.y = G.groundHeight(ip.x, ip.z) + 0.3;
    const r = Math.max(w.splash || 0, 1.8);
    if (fx) fx.shellArc(mp, ip, (hit) => {
      fx.explosion(hit, Math.max(w.splash || 0, 1.6));
      splashDamage(hit, r, dmg, 'shell', e);
    });
    else splashDamage(ip, r, dmg, 'shell', e);

  } else if (w.type === 'rocket') {
    fx?.muzzleFlash(mp, dir);
    if (w.groundOnly) {                       // artillery rockets → lobbed at ground
      const ip = V(t.pos.x + (rng() - 0.5) * 3.5, 0, t.pos.z + (rng() - 0.5) * 3.5);
      ip.y = G.groundHeight(ip.x, ip.z) + 0.3;
      const r = Math.max(w.splash || 0, 2.2);
      if (fx) fx.rocketTrail(mp, ip, (hit) => {
        fx.explosion(hit, Math.max(w.splash || 0, 2));
        splashDamage(hit, r, dmg, 'rocket', e);
      });
      else splashDamage(ip, r, dmg, 'rocket', e);
    } else {                                  // homing rocket → chases the entity
      if (fx) fx.rocketTrail(mp, t, (hit) => {
        fx.explosion(hit, 1.4);
        if (t.alive && hit.distanceTo(aimPoint(t)) < 5) applyDamage(t, dmg, 'rocket', e);
        if (w.splash) splashDamage(hit, w.splash, dmg * 0.6, 'rocket', e, t);
      });
      else applyDamage(t, dmg, 'rocket', e);
    }

  } else if (w.type === 'cannon') {           // flak
    fx?.muzzleFlash(mp, dir);
    if (isAir(t)) {
      const puff = tp.clone().add(V((rng() - 0.5) * 3, (rng() - 0.5) * 2, (rng() - 0.5) * 3));
      fx?.tracer(mp, puff);
      fx?.flakPuff(puff);
    } else {
      fx?.tracer(mp, tp);
      fx?.impact(tp, dir.clone().negate(), 'metal');
    }
    applyDamage(t, dmg, 'cannon', e);

  } else if (w.type === 'flame') {
    fx?.muzzleFlash(mp, dir);
    fx?.explosion(tp, 1.2);
    applyDamage(t, dmg, 'flame', e);

  } else {
    applyDamage(t, dmg, w.type, e);
  }
}

function stepFighter(e, dt) {
  const w = e.def.weapon;
  e.cd = Math.max(0, (e.cd || 0) - dt);

  // burst continuation (N quick follow-up shots after the trigger pull)
  if (e.burstN > 0) {
    e.burstT -= dt;
    if (e.burstT <= 0) {
      if (validTarget(e, e.target) && effDist(e, e.target) <= w.range * 1.15) {
        fireShot(e, e.target);
      }
      e.burstN--;
      e.burstT = 0.09;
    }
  }

  // validate / drop target (reacquire happens on the next scan)
  if (e.target && !validTarget(e, e.target)) {
    e.target = null;
    if (e.kind === 'unit' && e.order?.type === 'attack') e.order = { type: 'idle' };
  }
  const ord = e.kind === 'unit' ? e.order?.type : null;
  const chaser = ord === 'attack' || ord === 'attackmove';

  // idle units / defense buildings hold position — shed runaway targets
  if (e.target && !chaser) {
    if (effDist(e, e.target) > w.range * (e.kind === 'building' ? 1.05 : 1.3)) e.target = null;
  }

  // auto-acquire (staggered scans)
  if (!e.target && (e.kind === 'building' || !ord || ord === 'idle' || ord === 'attackmove')) {
    e.scanT = (e.scanT ?? rng() * 0.3) - dt;
    if (e.scanT <= 0) {
      e.scanT = 0.28 + rng() * 0.22;
      e.target = acquire(e);
    }
  }

  // attackmove: resume the march once nothing is left to shoot
  if (ord === 'attackmove' && !e.target && !e.path && e.order.x !== undefined &&
      dist2d(e.pos.x, e.pos.z, e.order.x, e.order.z) > 5) {
    e.repathT = (e.repathT ?? 0) - dt;
    if (e.repathT <= 0) {
      e.repathT = 0.8 + rng() * 0.4;
      e.path = pathTo(e, e.order.x, e.order.z);
      e.pathI = 0;
    }
  }

  const t = e.target;
  const tur = e.mesh?.userData?.turret;
  if (!t) {
    if (tur) {                                 // turret returns to rest
      e.turretYaw = turnToward(e.turretYaw || 0, 0, slewRate(e) * 0.5 * dt);
      tur.rotation.y = e.turretYaw;
    }
    return;
  }

  const d = effDist(e, t);

  // movement control (units only): approach to range / back off inside minRange
  if (e.kind === 'unit') {
    if (w.minRange && d < w.minRange - 1) {
      e.repathT = (e.repathT ?? 0) - dt;
      if (e.repathT <= 0) {
        e.repathT = 0.7;
        const away = Math.atan2(e.pos.x - t.pos.x, e.pos.z - t.pos.z);
        const back = w.minRange + 6 - d;
        e.path = pathTo(e, e.pos.x + Math.sin(away) * back, e.pos.z + Math.cos(away) * back);
        e.pathI = 0;
      }
    } else if (d > w.range * 0.96 && chaser) {
      e.repathT = (e.repathT ?? 0) - dt;
      const moved = !e.chaseGoal || dist2d(e.chaseGoal.x, e.chaseGoal.z, t.pos.x, t.pos.z) > 6;
      if (e.repathT <= 0 && (moved || !e.path)) {
        e.repathT = 0.55 + rng() * 0.3;
        let gx = t.pos.x, gz = t.pos.z;
        if (e.def.air) {                       // gunships hold a standoff hover
          const a = Math.atan2(e.pos.x - t.pos.x, e.pos.z - t.pos.z);
          gx += Math.sin(a) * w.range * 0.6;
          gz += Math.cos(a) * w.range * 0.6;
        }
        e.chaseGoal = { x: t.pos.x, z: t.pos.z };
        e.path = pathTo(e, gx, gz);
        e.pathI = 0;
      }
    } else if (d <= w.range * 0.9 && e.path && chaser) {
      e.path = null;                           // in range: halt and fight
    }
  }

  // aiming: slew turret (tanks fire only when the turret is aligned);
  // turretless units square their hull to the target while standing
  const ty = angleTo(e.pos.x, e.pos.z, t.pos.x, t.pos.z);
  let aimed = true;
  if (tur) {
    let want = angDiff(0, ty - e.yaw);
    e.turretYaw = turnToward(e.turretYaw || 0, want, slewRate(e) * dt);
    tur.rotation.y = e.turretYaw;
    aimed = Math.abs(angDiff(e.turretYaw, want)) < 0.12;
  } else if (e.kind === 'unit') {
    if (!e.path) e.yaw = turnToward(e.yaw, ty, e.def.turnRate * 1.5 * dt);
    aimed = Math.abs(angDiff(e.yaw, ty)) < 0.2;
  }

  // trigger
  if (aimed && e.cd <= 0 && d <= w.range * 1.02 && !(w.minRange && d < w.minRange)) {
    e.cd = w.reload * (0.92 + rng() * 0.16);
    fireShot(e, t);
    if (w.burst > 1) { e.burstN = w.burst - 1; e.burstT = 0.09; }
  }
}

// ---------------------------------------------------------------------------
// capture orders: order={type:'capture', target} (issued by input.js / ai.js).
// canCapture infantry walk to the capturable building, channel ~10s within
// ~6m (progress on target.captureProgress, holder in target.capturer; resets
// if the capturer dies/leaves), then the building flips to their owner and
// the mesh is rebuilt so the accent re-tints. Economy pays def.income by
// owner, so income follows automatically.
const CAPTURE_TIME = 10;
const CAPTURE_RANGE = 6;

function completeCapture(u, t) {
  t.capturer = null;
  t.captureProgress = 0;
  t.owner = u.owner;
  const old = t.mesh;
  const fresh = buildMesh(t.def, t.owner);
  fresh.position.copy(t.pos);
  fresh.rotation.y = t.yaw;
  fresh.scale.copy(old.scale);
  G.scene.remove(old);
  G.scene.add(fresh);
  t.mesh = fresh;
  G.fx?.vetFlash?.(t);
  emit('feed', `${t.def.name} captured`, 'gold');
  u.order = { type: 'idle' };
}

function stepCapture(u, dt) {
  const t = u.order.target;
  // invalid order → drop it (and free the channel if we held it)
  if (!t || !t.alive || !t.def.capturable || t.owner === u.owner || !u.def.canCapture) {
    if (t && t.capturer === u) { t.capturer = null; t.captureProgress = 0; }
    u.order = { type: 'idle' };
    u.path = null;
    return;
  }
  // stale holder (died, wandered off, changed orders) → reset the channel
  if (t.capturer && (!t.capturer.alive || t.capturer.order?.type !== 'capture' ||
      t.capturer.order.target !== t)) {
    t.capturer = null;
    t.captureProgress = 0;
  }
  const d = dist2d(u.pos.x, u.pos.z, t.pos.x, t.pos.z) - t.radius;
  if (d > CAPTURE_RANGE) {
    if (t.capturer === u) { t.capturer = null; t.captureProgress = 0; }
    u.repathT = (u.repathT ?? 0) - dt;
    if (!u.path && u.repathT <= 0) {
      u.repathT = 0.8;
      u.path = pathTo(u, t.pos.x, t.pos.z);
      u.pathI = 0;
    }
    return;
  }
  // in range: channel (one capturer at a time; extras stand guard)
  u.path = null;
  u.yaw = turnToward(u.yaw, angleTo(u.pos.x, u.pos.z, t.pos.x, t.pos.z), u.def.turnRate * dt);
  if (t.capturer && t.capturer !== u) return;
  if (t.capturer !== u) { t.capturer = u; t.captureProgress = 0; }
  t.captureProgress = Math.min(1, (t.captureProgress || 0) + dt / CAPTURE_TIME);
  if (t.captureProgress >= 1) completeCapture(u, t);
}

// enemy infantry under a moving crush-capable vehicle die instantly
const _crushNear = [];
function crushInfantry() {
  for (const u of G.units) {
    if (!u.alive || !u.def.crush || u.def.air) continue;
    const sp = Math.hypot(u.vel?.x || 0, u.vel?.z || 0);
    if (sp < u.def.speed * 0.3) continue;
    unitsNear(u.pos.x, u.pos.z, u.radius + 1.2, _crushNear);
    for (const o of _crushNear) {
      if (!o.alive || o.def.role !== 'infantry') continue;
      if (o.owner === u.owner || o.owner === -1 || u.owner === -1) continue;
      if (dist2d(u.pos.x, u.pos.z, o.pos.x, o.pos.z) < u.radius + 0.5) {
        G.fx?.impact?.(o.pos.clone().setY(o.pos.y + 0.6), null, 'flesh');
        G.fx?.impact?.(o.pos.clone().setY(o.pos.y + 0.2), null, 'sand');
        kill(o, u);
      }
    }
  }
}

export function tickCombat(dt) {
  sndBudget = Math.min(3, sndBudget + dt * 9);
  for (const e of G.entities) {
    if (!e.alive || !e.def.weapon) continue;
    if (e.kind === 'building' && ((e.buildProgress ?? 1) < 1 || e.powered === false)) continue;
    stepFighter(e, dt);
  }
  for (const u of G.units) {
    if (u.alive && u.order?.type === 'capture') stepCapture(u, dt);
  }
  crushInfantry();
}

export function orderAttack(units, target) {
  for (const u of units) {
    if (u.kind !== 'unit' || !u.def.weapon || !target || target === u) continue;
    if (!canHit(u.def.weapon, target)) continue;
    u.order = { type: 'attack', target };
    u.target = target;
    u.path = null;
    u.repathT = 0;
    u.chaseGoal = null;
  }
}
