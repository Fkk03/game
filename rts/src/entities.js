// entities.js — entity model: spawn/damage/veterancy/death. OWNED BY: sim agent.
// Other systems interact via spawnUnit/spawnBuilding/applyDamage and entity
// fields documented here — do not reach into meshes directly.
// Entity shape:
//   { id, def, owner, kind, pos:Vector3, yaw, hp, maxHp, alive, sel,
//     mesh:Group, radius, sight,
//     -- units: vel, path:[{x,z}], pathI, goal:{x,z}|null, order:
//        {type:'idle'|'move'|'attackmove'|'attack'|'harvest'|'build'|'capture'|
//         'repair', target?, x?, z?}, weapon state (cd), kills, vet,
//        carrying ($ for harvesters), buildTarget,
//     -- buildings: buildProgress (0..1), powered, rally:{x,z}, queue:[],
//        queueT, captureProgress, capturer }
import * as THREE from 'three';
import { G, V3, emit, clamp } from './core.js';
import { DEFS, ARMOR, VET_KILLS } from './data.js';
import { buildMesh, buildRubble } from './meshes.js';

export function spawnUnit(defId, owner, x, z, yaw = 0) {
  const def = DEFS[defId];
  const e = {
    id: G.nextId++, def, owner, kind: 'unit',
    pos: V3(x, G.groundHeight(x, z), z), yaw, vel: V3(),
    hp: def.hp, maxHp: def.hp, alive: true, sel: false,
    radius: def.role === 'infantry' ? 0.9 : 2.2,
    sight: def.sight, cd: 0, kills: 0, vet: 0,
    path: null, pathI: 0, goal: null,
    order: { type: 'idle' }, carrying: 0, target: null,
    flyH: def.air ? 22 : 0,
  };
  e.mesh = buildMesh(def, owner);
  e.mesh.position.copy(e.pos);
  G.scene.add(e.mesh);
  G.entities.push(e); G.units.push(e); G.byId.set(e.id, e);
  return e;
}

export function spawnBuilding(defId, owner, x, z, yaw = 0, opts = {}) {
  const def = DEFS[defId];
  const e = {
    id: G.nextId++, def, owner, kind: 'building',
    pos: V3(x, G.groundHeight(x, z), z), yaw,
    hp: opts.instant ? def.hp : def.hp * 0.1, maxHp: def.hp,
    alive: true, sel: false,
    radius: Math.max(def.size[0], def.size[1]) * 0.5,
    sight: def.sight, cd: 0,
    buildProgress: opts.instant ? 1 : 0,
    powered: true, rally: null, queue: [], queueT: 0,
    captureProgress: 0, capturer: null, target: null,
  };
  e.mesh = buildMesh(def, owner);
  e.mesh.position.copy(e.pos);
  e.mesh.rotation.y = yaw;
  if (!opts.instant) e.mesh.scale.setScalar(0.15);
  G.scene.add(e.mesh);
  G.entities.push(e); G.buildings.push(e); G.byId.set(e.id, e);
  G.nav?.blockFootprint(e);
  emit('entity:built', e);
  return e;
}

// damage with armor table + veterancy credit; fx + economy react via events
export function applyDamage(target, amount, type, attacker = null) {
  if (!target.alive) return;
  const mult = (ARMOR[type] || {})[target.def.armor] ?? 1;
  let dmg = amount * mult;
  if (target.vet) dmg *= 1 - target.vet * 0.08;          // veterans take less
  target.hp -= dmg;
  target.lastHitT = G.gameTime;
  if (target.hp <= 0) kill(target, attacker);
}

export function kill(e, attacker = null) {
  if (!e.alive) return;
  e.alive = false;
  if (attacker && attacker.alive && attacker.kind === 'unit') {
    attacker.kills++;
    const p = G.players[attacker.owner];
    if (p) { p.xp += Math.round(e.def.cost * 0.2) || 5; p.stats.kills++; }
    if (attacker.vet < 3 && attacker.kills >= VET_KILLS[attacker.vet + 1]) {
      attacker.vet++;
      G.fx?.vetFlash?.(attacker);
    }
  }
  const p = G.players[e.owner];
  if (p) p.stats.losses++;
  emit('entity:died', e, attacker);
  // corpse / rubble handling
  if (e.kind === 'building') {
    G.nav?.unblockFootprint(e);
    G.fx?.buildingDeath?.(e);
    const rubble = buildRubble(e.def);
    if (rubble) {
      rubble.position.copy(e.pos);
      rubble.rotation.y = e.yaw;
      G.scene.add(rubble);
      setTimeout(() => G.scene.remove(rubble), 45000);
    }
  } else {
    G.fx?.unitDeath?.(e);
  }
  G.scene.remove(e.mesh);
  // deferred array cleanup happens in sweepDead()
}

export function sweepDead() {
  const rm = (arr) => {
    for (let i = arr.length - 1; i >= 0; i--) if (!arr[i].alive) arr.splice(i, 1);
  };
  rm(G.entities); rm(G.units); rm(G.buildings);
  let selDirty = false;
  for (let i = G.sel.length - 1; i >= 0; i--) {
    if (!G.sel[i].alive) { G.sel.splice(i, 1); selDirty = true; }
  }
  if (selDirty) emit('sel:changed');
}

// convenient queries
export function enemiesOf(pid) {
  return G.entities.filter(e => e.alive && e.owner !== pid && e.owner !== -1);
}
export function entityAt(x, z, maxR = 4) {
  let best = null, bd = maxR;
  for (const e of G.entities) {
    if (!e.alive) continue;
    const d = Math.hypot(e.pos.x - x, e.pos.z - z) - e.radius;
    if (d < bd) { bd = d; best = e; }
  }
  return best;
}
export function healEntity(e, amt) {
  if (!e.alive) return;
  e.hp = clamp(e.hp + amt, 0, e.maxHp);
}
