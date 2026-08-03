// economy.js — money, power, supply harvesting, derrick capture, black market
// income, sell/repair support. OWNED BY: economy agent. STATUS: IMPLEMENTED.
// ============================================================================
// API (stable — other agents call these):
//   initEconomy() — per-player rate tracking reset. Called before buildWorld().
//   initDocks(list) — G.docks = [{x, z, amount, left, mesh, ...}] with stacked
//     GZH-style supply-crate visuals (canvas textures). Pile shrinks in 3
//     stages as it depletes and vanishes (nav unblocked) when empty. The dock
//     centre blocks a 9x9m nav footprint while crates remain.
//   tickEconomy(dt) —
//     * harvester state machine: idle harvesters auto-seek the nearest
//       non-empty dock; drive to dock → load 3s → drive to nearest own
//       completed supply_c/supply_g → unload (addMoney def.capacity) → repeat.
//       Cargo visual: mesh.userData.cargo toggled visible when carrying.
//     * derrick income ($20/s to owner once captured) + black market trickle —
//       any building def.income pays $income once per second.
//     * power recompute: p.powerMade/powerUsed from alive COMPLETED buildings;
//       b.powered=false on power-draining buildings while low power;
//       p.lowPower flag (production.js halves speed on it); on transition the
//       human gets emit('announce','LOW POWER') + a feed message, once.
//     * rolling p.rateIn / p.rateOut in $/min over a 24s window (HUD).
//   addMoney(pid, amt, isIncome = amt > 0) — ALL money changes route here.
//     Emits 'money:changed'. Pass isIncome=false on refunds so they do not
//     count toward stats.earned / rateIn.
//   orderHarvest(units, dock) — input agent right-click on a dock: puts
//     harvesters in order {type:'harvest', dock}; tickEconomy drives it.
//   dockAt(x, z, maxR = 14) -> dock|null — hit-test helper for input agent.
// Harvester unit fields used here: u.carrying ($ aboard), u.harv (internal
//   state machine scratch — do not touch), u.order {type:'harvest', dock}.
// TEST SCAFFOLDING (SHOT_MODE only, ?econtest=1): first tickEconomy spawns a
//   supply center near dock 0 for player 0 and queues two trucks through
//   production.js, and exposes window.__econ for headless verification.
// ============================================================================
import * as THREE from 'three';
import { G, emit, SHOT_MODE, dist2d, makeRng, angleTo } from './core.js';
import { DEFS, FACTIONS } from './data.js';
import { metalPanels, fabric } from './textures.js';
import { orderMove } from './move.js';
import { spawnBuilding } from './entities.js';
import {
  placementValid, startProduction, cancelProduction, canBuild,
  beginPlacement, updatePlacement, confirmPlacement, cancelPlacement,
  sellBuilding, setRally, orderBuild, dmgMult, hpMult, selfRepair,
} from './production.js';

const LOAD_T = 3;              // seconds loading crates at the dock
const UNLOAD_T = 1.2;          // seconds unloading at the supply center
const DOCK_ARRIVE = 12;        // arrival radius around dock centre (m)
const RATE_WIN = 24;           // rolling window (s) for rateIn/rateOut

let _rateSec = -1;
let _testDone = false;

// ---------------------------------------------------------------- lifecycle
export function initEconomy() {
  for (const p of G.players) {
    p.rateIn = 0; p.rateOut = 0;
    p._rin = new Float64Array(RATE_WIN);
    p._rout = new Float64Array(RATE_WIN);
    p.lowPower = false;
  }
  _rateSec = -1;
  _testDone = false;
}

// ---------------------------------------------------------------- money
export function addMoney(pid, amt, isIncome = amt > 0) {
  const p = G.players[pid];
  if (!p || !amt) return;
  p.money += amt;
  if (amt > 0 && isIncome) p.stats.earned += amt;
  if (p._rin) {
    const s = Math.floor(Math.max(0, G.gameTime)) % RATE_WIN;
    if (amt > 0 && isIncome) p._rin[s] += amt;
    else if (amt < 0) p._rout[s] -= amt;
  }
  emit('money:changed', pid);
}

function tickRates() {
  const sec = Math.floor(Math.max(0, G.gameTime)) % RATE_WIN;
  if (sec === _rateSec) return;
  _rateSec = sec;
  for (const p of G.players) {
    if (!p._rin) continue;
    p._rin[sec] = 0; p._rout[sec] = 0;
    let ri = 0, ro = 0;
    for (let i = 0; i < RATE_WIN; i++) { ri += p._rin[i]; ro += p._rout[i]; }
    p.rateIn = Math.round((ri / RATE_WIN) * 60);
    p.rateOut = Math.round((ro / RATE_WIN) * 60);
  }
}

// ---------------------------------------------------------------- docks
let _crateMat = null, _tarpMat = null;
function crateMats() {
  if (_crateMat) return;
  _crateMat = new THREE.MeshStandardMaterial({ map: metalPanels('#4d7796', 31), roughness: 0.82 });
  _tarpMat = new THREE.MeshStandardMaterial({ map: fabric('#8a6a3f', 12), roughness: 0.95 });
}

function buildCrateStack(rng, hMax) {
  const grp = new THREE.Group();
  const sz = 2.3 + rng() * 0.7;
  const n = 1 + Math.floor(rng() * hMax);
  let y = 0;
  for (let i = 0; i < n; i++) {
    const s = sz * (1 - i * 0.12);
    const tarp = rng() < 0.22;
    const m = new THREE.Mesh(new THREE.BoxGeometry(s, s * 0.82, s), tarp ? _tarpMat : _crateMat);
    m.position.set((rng() - 0.5) * 0.4, y + s * 0.41, (rng() - 0.5) * 0.4);
    m.rotation.y = (rng() - 0.5) * 0.5;
    m.castShadow = m.receiveShadow = true;
    grp.add(m);
    y += s * 0.82;
  }
  return grp;
}

// Three concentric rings of crate stacks; outer rings hide as the dock drains.
function buildDockMesh(dock, seed) {
  crateMats();
  const rng = makeRng(9001 + seed * 131);
  const g = new THREE.Group();
  g.position.set(dock.x, 0, dock.z);
  dock._rings = [];
  const rings = [
    { n: 3, r0: 0.0, r1: 3.2, h: 3 },   // survives to stage 1
    { n: 4, r0: 4.2, r1: 6.4, h: 2 },   // stage >= 2
    { n: 5, r0: 6.8, r1: 9.6, h: 2 },   // stage 3 (full)
  ];
  for (let ri = 0; ri < rings.length; ri++) {
    const rc = rings[ri];
    const ring = new THREE.Group();
    for (let s = 0; s < rc.n; s++) {
      const a = (s / rc.n) * Math.PI * 2 + rng() * 1.2;
      const r = rc.r0 + rng() * (rc.r1 - rc.r0);
      const wx = dock.x + Math.sin(a) * r, wz = dock.z + Math.cos(a) * r;
      const stack = buildCrateStack(rng, rc.h);
      stack.position.set(Math.sin(a) * r, G.groundHeight(wx, wz) - 0.06, Math.cos(a) * r);
      stack.rotation.y = rng() * Math.PI;
      ring.add(stack);
    }
    g.add(ring);
    dock._rings.push(ring);
  }
  return g;
}

export function initDocks(list) {
  G.docks = list.map((d, i) => {
    const dock = { ...d, left: d.amount, mesh: null, _stage: 3 };
    dock._blk = { kind: 'building', def: { size: [9, 9] }, pos: { x: d.x, z: d.z } };
    G.nav?.blockFootprint(dock._blk);
    dock.mesh = buildDockMesh(dock, i);
    G.scene?.add(dock.mesh);
    return dock;
  });
}

function updateDockVisual(dock) {
  const stage = dock.left <= 0 ? 0 : Math.max(1, Math.ceil((dock.left / dock.amount) * 3));
  if (stage === dock._stage) return;
  dock._stage = stage;
  if (stage === 0) {
    if (dock.mesh) { G.scene?.remove(dock.mesh); dock.mesh = null; }
    if (dock._blk) { G.nav?.unblockFootprint(dock._blk); dock._blk = null; }
    emit('feed', 'A supply dock has been exhausted', 'bad');
    return;
  }
  dock._rings?.forEach((ring, i) => { ring.visible = i < stage; });
}

export function dockAt(x, z, maxR = 14) {
  let best = null, bd = maxR;
  for (const d of G.docks) {
    if (d.left <= 0) continue;
    const dd = dist2d(x, z, d.x, d.z);
    if (dd < bd) { bd = dd; best = d; }
  }
  return best;
}

function nearestDock(x, z) {
  let best = null, bd = Infinity;
  for (const d of G.docks) {
    if (d.left <= 0) continue;
    const dd = dist2d(x, z, d.x, d.z);
    if (dd < bd) { bd = dd; best = d; }
  }
  return best;
}

function nearestDepot(u) {
  let best = null, bd = Infinity;
  for (const b of G.buildings) {
    if (!b.alive || b.owner !== u.owner || b.buildProgress < 1) continue;
    if (b.def.id !== 'supply_c' && b.def.id !== 'supply_g') continue;
    const dd = dist2d(u.pos.x, u.pos.z, b.pos.x, b.pos.z);
    if (dd < bd) { bd = dd; best = b; }
  }
  return best;
}

// ---------------------------------------------------------------- harvesters
export function orderHarvest(units, dock) {
  for (const u of units) {
    if (u.kind !== 'unit' || u.def.role !== 'harvester' || !u.alive) continue;
    u.order = { type: 'harvest', dock: dock || null };
    u.harv = null;
    u.path = null;
    u.target = null;
  }
}

function setCargo(u, vis) {
  const c = u.mesh?.userData?.cargo;
  if (c) c.visible = vis;
}

// Re-path helper that survives orderMove() overwriting u.order.
function ensureMove(u, h, x, z) {
  const changed = h.mx !== x || h.mz !== z;
  if (u.path && !changed) return;
  if (!changed && h.cool > 0) return;
  h.cool = 0.8; h.mx = x; h.mz = z;
  const dock = h.dock;
  orderMove([u], x, z);
  u.order = { type: 'harvest', dock, _h: true };
}

function stepHarvester(u, dt) {
  const h = u.harv;
  h.cool = Math.max(0, h.cool - dt);
  switch (h.state) {
    case 'toDock': {
      if (!h.dock || h.dock.left <= 0) {
        h.dock = nearestDock(u.pos.x, u.pos.z);
        if (!h.dock) {
          if (u.carrying > 0) { h.state = 'toDepot'; break; }
          u.order = { type: 'idle' }; u.harv = null;
          return;
        }
      }
      if (dist2d(u.pos.x, u.pos.z, h.dock.x, h.dock.z) < DOCK_ARRIVE + u.radius) {
        u.path = null;
        h.state = 'loading'; h.timer = LOAD_T;
      } else ensureMove(u, h, h.dock.x, h.dock.z);
      break;
    }
    case 'loading': {
      if (!h.dock || h.dock.left <= 0) { h.state = 'toDock'; h.dock = null; break; }
      h.timer -= dt;
      if (h.timer <= 0) {
        const amt = Math.min(u.def.capacity || 0, h.dock.left);
        h.dock.left -= amt;
        updateDockVisual(h.dock);
        u.carrying = amt;
        setCargo(u, amt > 0);
        h.state = 'toDepot';
      }
      break;
    }
    case 'toDepot': {
      const depot = nearestDepot(u);
      if (!depot) break;   // wait for a supply center to exist/complete
      if (dist2d(u.pos.x, u.pos.z, depot.pos.x, depot.pos.z) < depot.radius + u.radius + 3.5) {
        u.path = null;
        h.state = 'unloading'; h.timer = UNLOAD_T;
      } else ensureMove(u, h, depot.pos.x, depot.pos.z);
      break;
    }
    case 'unloading': {
      h.timer -= dt;
      if (h.timer <= 0) {
        if (u.carrying > 0) addMoney(u.owner, u.carrying, true);
        u.carrying = 0;
        setCargo(u, false);
        if (!h.dock || h.dock.left <= 0) h.dock = nearestDock(u.pos.x, u.pos.z);
        h.state = 'toDock';
      }
      break;
    }
  }
}

function tickHarvesters(dt) {
  for (const u of G.units) {
    if (!u.alive || u.def.role !== 'harvester') continue;
    if (u.order.type === 'idle') {
      const dock = nearestDock(u.pos.x, u.pos.z);
      if (dock || u.carrying > 0) u.order = { type: 'harvest', dock };
    }
    if (u.order.type !== 'harvest') { if (u.harv) u.harv = null; continue; }
    if (!u.order._h) {           // fresh harvest order (input/auto) — (re)init
      u.order._h = true;
      const dock = (u.order.dock && u.order.dock.left > 0)
        ? u.order.dock : nearestDock(u.pos.x, u.pos.z);
      u.harv = {
        state: u.carrying > 0 ? 'toDepot' : 'toDock',
        dock, timer: 0, cool: 0, mx: null, mz: null,
      };
      setCargo(u, u.carrying > 0);
    }
    stepHarvester(u, dt);
  }
}

// ---------------------------------------------------------------- income
function tickIncome(dt) {
  for (const b of G.buildings) {
    const inc = b.def.income;
    if (!inc || !b.alive || b.owner < 0 || b.buildProgress < 1) continue;
    b._incT = (b._incT || 0) + dt;
    while (b._incT >= 1) {
      b._incT -= 1;
      addMoney(b.owner, inc, true);
    }
  }
}

// ---------------------------------------------------------------- power
function tickPower() {
  for (const p of G.players) {
    if (!FACTIONS[p.faction]?.usesPower) {
      p.powerMade = 0; p.powerUsed = 0; p.lowPower = false;
      continue;
    }
    let made = 0, used = 0;
    for (const b of G.buildings) {
      if (!b.alive || b.owner !== p.id || b.buildProgress < 1) continue;
      const pw = b.def.power || 0;
      if (pw > 0) made += pw; else used -= pw;
    }
    if (made !== p.powerMade || used !== p.powerUsed) {
      p.powerMade = made; p.powerUsed = used;
      emit('power:changed', p.id);
    }
    const low = used > made;
    for (const b of G.buildings) {
      if (!b.alive || b.owner !== p.id) continue;
      b.powered = !(low && (b.def.power || 0) < 0);
    }
    if (low !== p.lowPower) {
      p.lowPower = low;
      if (p.id === G.humanId) {
        if (low) {
          emit('announce', 'LOW POWER');
          emit('feed', 'Low power — production slowed, defenses offline', 'bad');
        } else {
          emit('feed', 'Power restored', 'gold');
        }
      }
    }
  }
}

// ---------------------------------------------------------------- main tick
export function tickEconomy(dt) {
  econTestHook();
  tickRates();
  tickPower();
  tickIncome(dt);
  tickHarvesters(dt);
}

// ---------------------------------------------------------------- test hook
// TEST SCAFFOLDING ONLY — active in SHOT_MODE with ?econtest=1. Spawns a
// supply center near dock 0 for player 0 (world.js spawns no starting
// harvester) and queues two supply trucks through the real production path,
// then exposes window.__econ so the headless harness can poke the economy.
function econTestHook() {
  if (_testDone) return;
  _testDone = true;
  if (!SHOT_MODE) return;
  if (!new URLSearchParams(location.search).has('econtest')) return;
  const p = G.players[0], dock = G.docks[0];
  if (!p || !dock) return;
  const f = FACTIONS[p.faction];
  const scDef = DEFS[f.dock];
  // find flat passable ground near the dock (cohesion waived: test scaffolding)
  let spot = null;
  const aBase = Math.atan2(p.baseX - dock.x, p.baseZ - dock.z);
  outer:
  for (const r of [44, 50, 56, 62, 68]) {          // far enough that trucks visibly drive
    for (let i = 0; i < 16; i++) {
      const a = aBase + (i % 2 ? 1 : -1) * Math.ceil(i / 2) * (Math.PI / 8);
      const x = dock.x + Math.sin(a) * r, z = dock.z + Math.cos(a) * r;
      if (placementValid(0, scDef, x, z, { ignoreCohesion: true }).ok) { spot = { x, z }; break outer; }
    }
  }
  if (!spot) spot = { x: dock.x + 46, z: dock.z + 8 };
  const sc = spawnBuilding(f.dock, 0, spot.x, spot.z,
    angleTo(spot.x, spot.z, dock.x, dock.z), { instant: true });
  sc.rally = { x: (spot.x + dock.x) / 2, z: (spot.z + dock.z) / 2 };
  const truckId = sc.def.builds?.[0];
  startProduction(sc, truckId);
  startProduction(sc, truckId);
  window.__econ = {
    G, DEFS, addMoney, orderHarvest, dockAt,
    canBuild, startProduction, cancelProduction,
    beginPlacement, updatePlacement, confirmPlacement, cancelPlacement,
    sellBuilding, setRally, orderBuild, placementValid,
    dmgMult, hpMult, selfRepair,
    testSC: sc,
  };
}
