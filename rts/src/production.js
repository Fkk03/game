// production.js — build queues, unit spawning, building placement, dozer
// construction, rally points, upgrades, sell. OWNED BY: economy agent.
// STATUS: IMPLEMENTED.
// ============================================================================
// API (stable — ui/ai agents call these; ai may call the placement trio
// synchronously and headlessly — no pointer events required):
//   canBuild(pid, defId) -> {ok, reason} — cost / prereq checks with
//     human-readable reason ('Requires War Factory', 'Need $900', ...).
//     Accepts unit, building AND upgrade ids (UPGRADES table).
//     ok:true may still carry a non-blocking reason ('Low power — ...').
//   startProduction(building, defId) -> bool — enqueue unit/upgrade on
//     building.queue [{defId, t, total, cost, upgrade}]. Money is deducted
//     up-front via addMoney. building.queueT = head progress 0..1 (HUD).
//   cancelProduction(building, index=0) -> bool — refund + dequeue.
//   tickProduction(dt) — advances queue heads (HALF speed while the owning
//     coalition player is p.lowPower). Finished units spawn at the building
//     edge facing the rally point and are sent to building.rally if set.
//     Finished upgrades land in p.upgrades (Set).
//   setRally(building, x, z) — sets building.rally.
//   beginPlacement(pid, defId, builder?) -> placement — placement state
//     {pid, defId, def, builder, x, z, valid, reason, ghost}. For the human
//     player it is stored in G.placement with a green/red-tinted ghost mesh
//     (meshes.buildMesh clone); for AI players no ghost is created and
//     G.placement is untouched, so AI placement never disturbs the human's.
//   updatePlacement(x, z) — move active placement, recompute validity:
//     footprint cells passable via G.nav, ground tilt < SLOPE_MAX (0.28 —
//     measured base-plateau tilt is 0.20-0.27, see note at SLOPE_MAX; the
//     0.15 of the original spec rejects ~92% of the designated base areas),
//     within 80m of an own building (base cohesion) EXCEPT command centers.
//   confirmPlacement() -> site|null — deducts cost, spawns the construction
//     site (10% hp, buildProgress 0, mesh scale 0.15) and orders the builder
//     (order {type:'build', target:site}).
//   cancelPlacement() — drop active placement + ghost.
//   placementValid(pid, def, x, z, opts?) -> {ok, reason} — pure validity
//     check (opts.ignoreCohesion for test scaffolding).
//   orderBuild(units, site) — send builder units to construct/resume a site.
//   tickConstruction(dt) — builder adjacent to its site raises buildProgress
//     at 1/buildTime, mesh scale 0.15→1, hp grows toward max; builder returns
//     to idle when the site completes or dies.
//   sellBuilding(b) -> bool — 50% refund (+ full refund of queued items),
//     building removed without rubble, feed message.
//   Upgrade effect helpers (sim agent multiplies through these — the ONLY
//   coordination point for upgrade effects):
//     dmgMult(p, def)   -> 1 | 1.25   (upg_ap / upg_toxin, all weapons)
//     hpMult(p, def)    -> 1 | 1.25   (upg_armor, coalition vehicles)
//     selfRepair(p, def)-> 0 | 4      (upg_junk, cartel vehicles, hp/s)
// ============================================================================
import { G, emit, dist2d, angleTo, HALF } from './core.js';
import { DEFS, UPGRADES, FACTIONS } from './data.js';
import { buildMesh } from './meshes.js';
import { spawnUnit, spawnBuilding } from './entities.js';
import { addMoney } from './economy.js';
import { orderMove } from './move.js';

const QUEUE_MAX = 9;

// ---------------------------------------------------------------- canBuild
function hasBuilt(pid, defId) {
  return G.buildings.some(b => b.alive && b.owner === pid &&
    b.def.id === defId && b.buildProgress >= 1);
}
function upgradeQueued(pid, upgId) {
  return G.buildings.some(b => b.alive && b.owner === pid &&
    b.queue.some(q => q.defId === upgId));
}

export function canBuild(pid, defId) {
  const p = G.players[pid];
  if (!p) return { ok: false, reason: 'No player' };
  const upg = UPGRADES[defId];
  if (upg) {
    if (p.upgrades.has(defId)) return { ok: false, reason: 'Already researched' };
    if (upgradeQueued(pid, defId)) return { ok: false, reason: 'Research in progress' };
    if (p.money < upg.cost) return { ok: false, reason: `Need $${upg.cost}` };
    return { ok: true, reason: '' };
  }
  const def = DEFS[defId];
  if (!def) return { ok: false, reason: 'Unknown item' };
  for (const r of def.requires || []) {
    if (!hasBuilt(pid, r)) return { ok: false, reason: `Requires ${DEFS[r]?.name || r}` };
  }
  if (p.money < def.cost) return { ok: false, reason: `Need $${def.cost}` };
  if (p.lowPower && FACTIONS[p.faction].usesPower) {
    return { ok: true, reason: 'Low power — production slowed' };
  }
  return { ok: true, reason: '' };
}

// ---------------------------------------------------------------- queues
export function startProduction(building, defId) {
  if (!building?.alive || building.kind !== 'building') return false;
  if (building.buildProgress < 1) return false;
  if (building.queue.length >= QUEUE_MAX) {
    if (building.owner === G.humanId) emit('feed', 'Production queue full', 'bad');
    return false;
  }
  const chk = canBuild(building.owner, defId);
  if (!chk.ok) {
    if (building.owner === G.humanId) emit('feed', chk.reason, 'bad');
    return false;
  }
  const upg = UPGRADES[defId];
  const cost = upg ? upg.cost : DEFS[defId].cost;
  building.queue.push({
    defId, t: 0,
    total: Math.max(0.1, upg ? upg.time : DEFS[defId].buildTime),
    cost, upgrade: !!upg,
  });
  addMoney(building.owner, -cost);
  return true;
}

export function cancelProduction(building, index = 0) {
  const q = building?.queue?.[index];
  if (!q) return false;
  building.queue.splice(index, 1);
  if (index === 0) building.queueT = 0;
  addMoney(building.owner, q.cost, false);
  return true;
}

// spawn a produced unit at the building edge facing the rally point
function spawnFromBuilding(b, defId) {
  let dx = Math.sin(b.yaw), dz = Math.cos(b.yaw);
  if (b.rally) {
    const d = dist2d(b.rally.x, b.rally.z, b.pos.x, b.pos.z);
    if (d > 1) { dx = (b.rally.x - b.pos.x) / d; dz = (b.rally.z - b.pos.z) / d; }
  }
  const a0 = Math.atan2(dx, dz);
  const udef = DEFS[defId];
  const ur = udef.role === 'infantry' ? 0.9 : 2.2;
  for (const r of [b.radius + ur + 1.5, b.radius + ur + 4.5, b.radius + ur + 8]) {
    for (const off of [0, 0.35, -0.35, 0.8, -0.8, 1.3, -1.3, 1.9, -1.9, 2.6, -2.6, Math.PI]) {
      const a = a0 + off;
      const x = b.pos.x + Math.sin(a) * r, z = b.pos.z + Math.cos(a) * r;
      if (Math.abs(x) > HALF - 10 || Math.abs(z) > HALF - 10) continue;
      if (!udef.air && !G.nav.passable(x, z)) continue;
      return spawnUnit(defId, b.owner, x, z, a);
    }
  }
  const r = b.radius + ur + 1.5;
  return spawnUnit(defId, b.owner, b.pos.x + dx * r, b.pos.z + dz * r, a0);
}

export function tickProduction(dt) {
  for (const b of G.buildings) {
    if (!b.alive || b.buildProgress < 1 || !b.queue.length) continue;
    const p = G.players[b.owner];
    if (!p) continue;
    const speed = (p.lowPower && FACTIONS[p.faction].usesPower) ? 0.5 : 1;
    const head = b.queue[0];
    head.t += dt * speed;
    b.queueT = Math.min(1, head.t / head.total);
    if (head.t < head.total) continue;
    b.queue.shift();
    b.queueT = 0;
    if (head.upgrade) {
      p.upgrades.add(head.defId);
      if (b.owner === G.humanId) {
        emit('feed', `${UPGRADES[head.defId].name} research complete`, 'gold');
      }
    } else {
      const u = spawnFromBuilding(b, head.defId);
      p.stats.built++;
      if (u && b.rally) orderMove([u], b.rally.x, b.rally.z);
    }
  }
}

export function setRally(building, x, z) {
  if (building?.kind === 'building') building.rally = { x, z };
}

// ---------------------------------------------------------------- placement
const SLOPE_MAX = 0.28;   // max overall tilt across footprint (see note below)
const CLIFF_MAX = 0.5;    // max height step between adjacent 3m samples

let cur = null;   // active placement; for the human player it === G.placement

export function placementValid(pid, def, x, z, opts = {}) {
  const [w, d] = def.size;
  const hw = w / 2, hd = d / 2;
  if (Math.abs(x) + hw > HALF - 16 || Math.abs(z) + hd > HALF - 16) {
    return { ok: false, reason: 'Out of bounds' };
  }
  // sample footprint on a ~3m grid: every cell nav-passable, overall tilt
  // across the footprint < SLOPE_MAX, and no sharp cliff between samples.
  // NOTE: the contract said 0.15, but layout flats only pin height at their
  // centre (smoothstep blend) — measured footprint tilts across the designated
  // base plateaus are 0.20-0.27, so 0.15 rejects ~92% of the base area and
  // strands the AI. 0.28 keeps plateaus/valley buildable while rejecting
  // valley walls, the ridge and mesa risers (nav itself blocks at 0.62).
  const nx = Math.max(2, Math.round(w / 3)), nz = Math.max(2, Math.round(d / 3));
  const hg = [];
  let minH = Infinity, maxH = -Infinity;
  for (let iz = 0; iz <= nz; iz++) {
    for (let ix = 0; ix <= nx; ix++) {
      const px = x - hw + (w * ix) / nx, pz = z - hd + (d * iz) / nz;
      if (!G.nav.passable(px, pz)) return { ok: false, reason: 'Blocked terrain' };
      const h = G.groundHeight(px, pz);
      hg.push(h);
      if (h < minH) minH = h;
      if (h > maxH) maxH = h;
    }
  }
  if ((maxH - minH) / Math.max(w, d) >= SLOPE_MAX) {
    return { ok: false, reason: 'Ground too steep' };
  }
  const sx = w / nx, sz = d / nz;
  for (let iz = 0; iz <= nz; iz++) {
    for (let ix = 0; ix <= nx; ix++) {
      const h = hg[iz * (nx + 1) + ix];
      if (ix < nx && Math.abs(hg[iz * (nx + 1) + ix + 1] - h) / sx >= CLIFF_MAX) {
        return { ok: false, reason: 'Ground too steep' };
      }
      if (iz < nz && Math.abs(hg[(iz + 1) * (nx + 1) + ix] - h) / sz >= CLIFF_MAX) {
        return { ok: false, reason: 'Ground too steep' };
      }
    }
  }
  const isCC = def.id === 'cc_c' || def.id === 'cc_g';
  if (!isCC && !opts.ignoreCohesion) {
    const near = G.buildings.some(b => b.alive && b.owner === pid &&
      dist2d(b.pos.x, b.pos.z, x, z) <= 80);
    if (!near) return { ok: false, reason: 'Too far from base' };
  }
  return { ok: true, reason: '' };
}

function makeGhost(def, pid) {
  const g = buildMesh(def, pid);
  g.traverse(o => {
    if (o.isMesh) {
      o.castShadow = o.receiveShadow = false;
      o.material = o.material.clone();
      o.material.transparent = true;
      o.material.opacity = 0.55;
      o.material.depthWrite = false;
    }
  });
  G.scene.add(g);
  return g;
}
function tintGhost(ghost, ok) {
  const c = ok ? 0x46d06a : 0xd8402c;
  ghost.traverse(o => {
    if (o.isMesh) {
      o.material.color.setHex(c);
      o.material.emissive?.setHex(c);
      o.material.emissiveIntensity = 0.35;
    }
  });
}

export function beginPlacement(pid, defId, builder = null) {
  const def = DEFS[defId];
  if (!def || def.kind !== 'building') return null;
  const pl = {
    pid, defId, def, builder,
    x: builder ? builder.pos.x : 0, z: builder ? builder.pos.z : 0,
    valid: false, reason: '', ghost: null,
  };
  if (pid === G.humanId) {
    if (G.placement) dropPlacement(G.placement);
    pl.ghost = makeGhost(def, pid);
    G.placement = pl;
  }
  cur = pl;
  updatePlacement(pl.x, pl.z);
  return pl;
}

export function updatePlacement(x, z) {
  const pl = cur || G.placement;
  if (!pl) return;
  pl.x = x; pl.z = z;
  const v = placementValid(pl.pid, pl.def, x, z);
  pl.valid = v.ok; pl.reason = v.reason;
  if (pl.ghost) {
    pl.ghost.position.set(x, G.groundHeight(x, z), z);
    tintGhost(pl.ghost, v.ok);
  }
}

export function confirmPlacement() {
  const pl = cur || G.placement;
  if (!pl) return null;
  updatePlacement(pl.x, pl.z);
  if (!pl.valid) {
    if (pl.pid === G.humanId) emit('feed', pl.reason || 'Cannot build there', 'bad');
    return null;
  }
  const chk = canBuild(pl.pid, pl.defId);
  if (!chk.ok) {
    if (pl.pid === G.humanId) emit('feed', chk.reason, 'bad');
    return null;
  }
  addMoney(pl.pid, -pl.def.cost);
  const p = G.players[pl.pid];
  const yaw = p ? angleTo(pl.x, pl.z, p.baseX, p.baseZ) : 0;
  const site = spawnBuilding(pl.defId, pl.pid, pl.x, pl.z, yaw);
  if (pl.builder?.alive) orderBuild([pl.builder], site);
  dropPlacement(pl);
  return site;
}

export function cancelPlacement() {
  const pl = cur || G.placement;
  if (pl) dropPlacement(pl);
}

function dropPlacement(pl) {
  if (pl.ghost) { G.scene.remove(pl.ghost); pl.ghost = null; }
  if (G.placement === pl) G.placement = null;
  if (cur === pl) cur = G.placement || null;
}

// ---------------------------------------------------------------- construction
export function orderBuild(units, site) {
  for (const u of units) {
    if (u.kind !== 'unit' || u.def.role !== 'builder' || !u.alive) continue;
    orderMove([u], site.pos.x, site.pos.z);
    u.order = { type: 'build', target: site };
  }
}

export function tickConstruction(dt) {
  for (const b of G.buildings) {
    if (!b.alive || b.buildProgress >= 1) continue;
    let working = false;
    for (const u of G.units) {
      if (!u.alive || u.order?.type !== 'build' || u.order.target !== b) continue;
      if (dist2d(u.pos.x, u.pos.z, b.pos.x, b.pos.z) < b.radius + u.radius + 4) {
        working = true;
        if (u.path) u.path = null;             // parked at the site
      } else if (!u.path && (u._rebuildT ?? 0) <= G.time) {
        u._rebuildT = G.time + 1;              // re-path at most 1/s
        orderMove([u], b.pos.x, b.pos.z);
        u.order = { type: 'build', target: b };
      }
    }
    if (!working) continue;
    const rate = dt / Math.max(1, b.def.buildTime);   // no multi-builder stacking
    b.buildProgress = Math.min(1, b.buildProgress + rate);
    b.hp = Math.min(b.maxHp, b.hp + rate * b.maxHp * 0.9);
    b.mesh.scale.setScalar(0.15 + 0.85 * b.buildProgress);
    if (b.buildProgress >= 1) {
      b.mesh.scale.setScalar(1);
      const p = G.players[b.owner];
      if (p) p.stats.built++;
      if (b.owner === G.humanId) emit('feed', `${b.def.name} construction complete`, 'gold');
    }
  }
  // release builders whose site completed or died
  for (const u of G.units) {
    if (u.order?.type !== 'build') continue;
    const t = u.order.target;
    if (!t || !t.alive || t.buildProgress >= 1) {
      u.order = { type: 'idle' };
      u.path = null;
    }
  }
}

// ---------------------------------------------------------------- sell
export function sellBuilding(b) {
  if (!b?.alive || b.kind !== 'building') return false;
  const p = G.players[b.owner];
  if (!p) return false;
  for (const q of b.queue) addMoney(b.owner, q.cost, false);   // refund queue
  b.queue.length = 0;
  const refund = Math.floor(b.def.cost * 0.5);
  addMoney(b.owner, refund, false);
  b.sold = true;
  b.alive = false;                 // sweepDead() prunes arrays + selection
  G.nav?.unblockFootprint(b);
  G.scene.remove(b.mesh);
  emit('entity:died', b, null);
  if (b.owner === G.humanId) emit('feed', `${b.def.name} sold — +$${refund}`, 'gold');
  return true;
}

// ---------------------------------------------------------------- upgrades
// sim agent multiplies through these three helpers — the only coupling point.
export function dmgMult(p, def) {
  if (!p) return 1;
  return (p.upgrades?.has('upg_ap') || p.upgrades?.has('upg_toxin')) ? 1.25 : 1;
}
export function hpMult(p, def) {
  if (!p || !def) return 1;
  return (p.upgrades?.has('upg_armor') && def.kind === 'unit' && def.armor === 'vehicle')
    ? 1.25 : 1;
}
export function selfRepair(p, def) {
  if (!p || !def) return 0;
  return (p.upgrades?.has('upg_junk') && def.kind === 'unit' && def.armor === 'vehicle')
    ? 4 : 0;
}
