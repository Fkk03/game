// ai.js — the enemy commander. OWNED BY: ai agent.
// API: initAI(pid, difficulty) -> stores G.ai; tickAI(dt).
// Design contract:
//   The AI plays by the same rules: it uses production.startProduction /
//   beginPlacement/updatePlacement/confirmPlacement, pays with economy money,
//   obeys prereqs. DIFFICULTY knobs from data.DIFFICULTY (incomeMult applied
//   as a periodic subsidy on hard+, buildDelay scales decision cadence,
//   attackWave = seconds between attacks, aggression scales wave size).
//   State machine: opening build order (power→barracks→supply→factory),
//   then loop: maintain harvesters, expand army, build defenses at base
//   perimeter facing the player, tech to superweapon on hard+, attack waves
//   gather at rally then attack-move the player base; retreat badly losing
//   waves; use powers when available; rebuild destroyed economy.
//   Defensive coding: production/powers/combat may still be stubs while other
//   agents land — probe canBuild for {reason:'stub'}, warn once and idle.
import { G, on, makeRng, dist2d, clamp, HALF } from './core.js';
import { DEFS, POWERS, DIFFICULTY, FACTIONS } from './data.js';
import { LAYOUT } from './layout.js';
import * as production from './production.js';
import * as economy from './economy.js';
import * as powers from './powers.js';
import * as move from './move.js';
import * as combat from './combat.js';

// ---------------------------------------------------------------- plans
const PLANS = {
  coalition: {
    power: 'reactor', barracks: 'barracks_c', supply: 'supply_c',
    factory: 'factory_c', airfield: 'airfield', market: null,
    defenses: ['patriot'], sw: 'particle', truck: 'truck_c', builderDef: 'dozer',
    infantry: [['ranger', 0.55], ['missiledef', 0.45]],
    vehicles: [['crusader', 0.5], ['humvee', 0.22], ['tomahawk', 0.28]],
    airUnits: [['comanche', 1]],
    powerPriority: ['paradrop', 'repair', 'a10', 'fab'],
    upgrades: ['upg_ap', 'upg_armor'],
  },
  cartel: {
    power: null, barracks: 'barracks_g', supply: 'supply_g',
    factory: 'armsdealer', airfield: null, market: 'blackmarket',
    defenses: ['stinger', 'tunnel'], sw: 'scudstorm', truck: 'truck_g', builderDef: 'worker',
    infantry: [['rebel', 0.5], ['rpg', 0.5]],
    vehicles: [['scorpion', 0.45], ['quad', 0.2], ['technical', 0.15], ['buggy', 0.2]],
    airUnits: [],
    powerPriority: ['bounty', 'ambush', 'sneak', 'anthrax'],
    upgrades: ['upg_toxin', 'upg_junk'],
  },
};

let ai = null;
const warned = new Set();
function warnOnce(msg) { if (!warned.has(msg)) { warned.add(msg); console.warn(msg); } }
const isIdle = (u) => !u.order || u.order.type === 'idle';

// ---------------------------------------------------------------- init
export function initAI(pid = 1, diffKey = 'normal') {
  const p = G.players[pid];
  if (!p) { warnOnce('[ai] initAI: no player ' + pid); return; }
  // dev/test knob: ?aidiff=hard overrides the difficulty (shot harness has
  // no menu, so this is the only way to exercise hard/brutal in headless runs)
  try {
    const qd = typeof location !== 'undefined' &&
      new URLSearchParams(location.search).get('aidiff');
    if (qd && DIFFICULTY[qd]) diffKey = qd;
  } catch { /* non-browser */ }
  const knobs = DIFFICULTY[diffKey] || DIFFICULTY.normal;
  const enemyPid = pid === 0 ? 1 : 0;
  const ep = G.players[enemyPid];
  const ex = ep ? ep.baseX : -p.baseX, ez = ep ? ep.baseZ : -p.baseZ;
  const dx = ex - p.baseX, dz = ez - p.baseZ;
  const dl = Math.hypot(dx, dz) || 1;
  const approach = { x: dx / dl, z: dz / dl };
  ai = G.ai = {
    pid, enemyPid, knobs, diffKey, faction: p.faction, plan: PLANS[p.faction],
    rng: makeRng(9137 + pid),
    approach,
    home: { x: p.baseX + approach.x * 30, z: p.baseZ + approach.z * 30 },
    gather: { x: p.baseX + approach.x * 48, z: p.baseZ + approach.z * 48 },
    waypoints: buildWaypoints(p.baseX, p.baseZ, ex, ez),
    thinkT: 1.5, waveT: knobs.attackWave * 0.9, harassT: 50, subsidyT: 12,
    squads: [], captures: [], nextSquadId: 1, wavesLaunched: 0,
    jobIdx: 0, want: null, threat: null, threatUntil: 0, threatActive: false,
    lastDefendOrderT: -99, lastSwT: 0, waveOverdue: false, roster: null,
  };
  on('entity:died', (e, attacker) => {
    if (!ai || e.owner !== ai.pid || !attacker || attacker.owner === ai.pid) return;
    const me = G.players[ai.pid];
    if (me && dist2d(e.pos.x, e.pos.z, me.baseX, me.baseZ) < 130) {
      ai.threat = { x: e.pos.x, z: e.pos.z };
      ai.threatUntil = G.gameTime + 12;
    }
  });
}

// road waypoints from own base toward the enemy base (watchable marches)
function buildWaypoints(bx, bz, ex, ez) {
  let pts = (LAYOUT.road || []).map(v => ({ x: v.x, z: v.z }));
  if (pts.length >= 2 &&
      dist2d(pts[0].x, pts[0].z, bx, bz) > dist2d(pts[pts.length - 1].x, pts[pts.length - 1].z, bx, bz)) {
    pts.reverse();
  }
  pts = pts.filter(w => dist2d(w.x, w.z, bx, bz) > 80 && dist2d(w.x, w.z, ex, ez) > 25);
  pts.push({ x: ex, z: ez });
  return pts;
}

// ---------------------------------------------------------------- tick
export function tickAI(dt) {
  if (!ai || G.state === 'over') return;
  const p = G.players[ai.pid];
  if (!p || !p.alive) return;
  try {
    ai.waveT -= dt; ai.harassT -= dt; ai.subsidyT -= dt; ai.thinkT -= dt;
    // the one sanctioned cheat: periodic cash subsidy on hard+ (incomeMult>1)
    if (ai.knobs.incomeMult > 1 && ai.subsidyT <= 0) {
      ai.subsidyT = 8;
      if (typeof economy.addMoney === 'function') {
        economy.addMoney(ai.pid, Math.round(320 * (ai.knobs.incomeMult - 1)), true);
      }
    }
    if (ai.thinkT > 0) return;
    ai.thinkT = 1.2 * (ai.knobs.buildDelay || 1);
    think(p);
  } catch (err) {
    warnOnce('[ai] suppressed error: ' + (err && err.stack || err));
  }
}

const SLOW_JOBS = [powersJob, captureJob, upgradesJob];

function think(p) {
  // graceful stub-wait: come alive automatically once the economy agent lands
  const probe = typeof production.canBuild === 'function'
    ? production.canBuild(ai.pid, ai.plan.barracks) : null;
  if (!probe || probe.reason === 'stub') {
    warnOnce('[ai] waiting for production impl');
    snapshot(p, true);
    return;
  }
  refreshRoster(p);
  ensureRallies();
  runSquads(p);
  structureJob(p);
  unitsJob(p);
  SLOW_JOBS[ai.jobIdx++ % SLOW_JOBS.length](p);
  snapshot(p, false);
}

// ---------------------------------------------------------------- roster
function refreshRoster(p) {
  const R = ai.roster = {
    units: [], buildings: [], byDef: {}, harvesters: [], builders: [],
    combat: [], fast: [], prod: [],
  };
  for (const e of G.entities) {
    if (!e.alive || e.owner !== ai.pid) continue;
    (R.byDef[e.def.id] ||= []).push(e);
    if (e.kind === 'building') {
      R.buildings.push(e);
      if (e.def.builds && (e.buildProgress ?? 1) >= 1) R.prod.push(e);
    } else {
      R.units.push(e);
      const role = e.def.role;
      if (role === 'harvester') R.harvesters.push(e);
      else if (role === 'builder') R.builders.push(e);
      else if (e.def.weapon) {
        R.combat.push(e);
        if (e.def.speed >= 13) R.fast.push(e);
      }
    }
  }
  return R;
}

const countOf = (id) => (ai.roster.byDef[id] || []).length;

function powerBalance() {
  if (!FACTIONS[ai.faction].usesPower) return 99;
  let bal = 0;
  for (const b of ai.roster.buildings) bal += b.def.power || 0;
  return bal;
}

function ensureRallies() {
  for (const b of ai.roster.prod) {
    if (b.aiRallySet) continue;
    const builds = b.def.builds || [];
    if (builds.some(id => DEFS[id] && DEFS[id].weapon)) {
      b.rally = { x: ai.gather.x + (ai.rng() - 0.5) * 20, z: ai.gather.z + (ai.rng() - 0.5) * 20 };
    }
    b.aiRallySet = true;
  }
}

// ---------------------------------------------------------------- structures
function structureJob(p) {
  builderWatchdog();
  if (resumeOrphanSites()) return;
  const need = ai.want = nextStructure(p);
  if (!need) return;
  const cb = production.canBuild ? production.canBuild(ai.pid, need.id) : null;
  if (!cb || !cb.ok) return;                       // saving up / prereq pending
  const builder = ai.roster.builders.find(isIdle);
  if (!builder) return;
  tryPlace(need.id, builder, need.centers, need.maxR || 56);
}

// a construction site whose builder died/wandered gets a fresh idle builder
function resumeOrphanSites() {
  for (const site of ai.roster.buildings) {
    if (site.buildProgress >= 1) continue;
    const assigned = ai.roster.builders.some(u =>
      u.order && u.order.type === 'build' && u.order.target === site);
    if (assigned) continue;
    const idle = ai.roster.builders.find(isIdle);
    if (!idle) return false;
    if (typeof production.orderBuild === 'function') production.orderBuild([idle], site);
    else {
      move.orderMove([idle], site.pos.x, site.pos.z);
      idle.order = { type: 'build', target: site };
    }
    return true;
  }
  return false;
}

// builders that stop moving far from their site get re-pathed, then wiggled
function builderWatchdog() {
  for (const u of ai.roster.builders) {
    const o = u.order;
    if (!o || o.type !== 'build' || !o.target || !o.target.alive) { u._aiStuck = null; continue; }
    const site = o.target;
    if (dist2d(u.pos.x, u.pos.z, site.pos.x, site.pos.z) < site.radius + u.radius + 6) {
      u._aiStuck = null;                            // on site, working
      continue;
    }
    const s = u._aiStuck;
    if (!s || dist2d(u.pos.x, u.pos.z, s.x, s.z) > 2) {
      u._aiStuck = { x: u.pos.x, z: u.pos.z, t: G.gameTime, kicked: false };
      continue;
    }
    const stuckFor = G.gameTime - s.t;
    if (stuckFor > 10 && !s.kicked) {
      s.kicked = true;
      if (typeof production.orderBuild === 'function') production.orderBuild([u], site);
    } else if (stuckFor > 24) {
      // hard stuck: wander off; resumeOrphanSites re-assigns the site later
      move.orderMove([u], u.pos.x + (ai.rng() - 0.5) * 36, u.pos.z + (ai.rng() - 0.5) * 36);
      u._aiStuck = null;
    }
  }
}

function nextStructure(p) {
  const plan = ai.plan, t = G.gameTime, money = p.money;
  const base = { x: p.baseX, z: p.baseZ };
  const mk = (id, centers, maxR) => ({ id, centers, cost: DEFS[id].cost, maxR });
  const ccId = FACTIONS[ai.faction].cc;
  if (!countOf(ccId)) return mk(ccId, [base]);
  if (plan.power && powerBalance() < 3) return mk(plan.power, [base]);
  if (!countOf(plan.barracks)) return mk(plan.barracks, [base]);
  if (!countOf(plan.supply)) return mk(plan.supply, supplyCenters(base));
  if (!countOf(plan.factory)) return mk(plan.factory, [base]);
  // base defenses along the approach vector toward the enemy, scaling over time
  const defTarget = Math.min(5, 1 + Math.floor(t / 140) + (ai.knobs.aggression >= 1.5 ? 1 : 0));
  const defCount = plan.defenses.reduce((s, d) => s + countOf(d), 0);
  if (defCount < defTarget) {
    const id = plan.defenses[defCount % plan.defenses.length];
    return mk(id, defenseCenters(base, defCount), 30);
  }
  if (plan.market && !countOf(plan.market)) return mk(plan.market, [base]);
  if (plan.airfield && !countOf(plan.airfield) && money > 2600) return mk(plan.airfield, [base]);
  if (plan.sw && ai.knobs.aggression >= 1.5 && !countOf(plan.sw) && t > 200 &&
      money > DEFS[plan.sw].cost + 800) return mk(plan.sw, [base]);
  if (countOf(plan.factory) < 2 && t > 260 && money > 4200) return mk(plan.factory, [base]);
  return null;
}

function supplyCenters(base) {
  let best = null, bd = Infinity;
  for (const d of (G.docks || [])) {
    if ((d.left ?? d.amount ?? 1) <= 0) continue;
    const dd = dist2d(d.x, d.z, base.x, base.z);
    if (dd < bd) { bd = dd; best = d; }
  }
  if (!best) return [base];
  const dx = best.x - base.x, dz = best.z - base.z, l = Math.hypot(dx, dz) || 1;
  // as close to the dock as base cohesion (80m) allows, then fallbacks
  const towards = Math.min(70, Math.max(20, l - 24));
  return [
    { x: base.x + dx / l * towards, z: base.z + dz / l * towards },
    { x: (best.x + base.x) / 2, z: (best.z + base.z) / 2 },
    base,
  ];
}

function defenseCenters(base, i) {
  const d = ai.approach, px = -d.z, pz = d.x;   // perpendicular
  const lat = ((i % 2) ? -1 : 1) * (10 + 8 * Math.floor(i / 2));
  const r = 44 + 5 * Math.floor(i / 2);
  return [
    { x: base.x + d.x * r + px * lat, z: base.z + d.z * r + pz * lat },
    { x: base.x + d.x * 34, z: base.z + d.z * 34 },
  ];
}

// ring-search placement via the production placement API (it validates).
// For AI players beginPlacement returns the placement state directly and
// never touches G.placement (the human's ghost), so we drive `pl` and use
// confirmPlacement()'s returned site as the success signal — all in one tick.
function tryPlace(defId, builder, centers, maxR) {
  if (typeof production.beginPlacement !== 'function') return false;
  const pl = production.beginPlacement(ai.pid, defId, builder);
  if (!pl || typeof pl !== 'object') return false;   // stub / refused
  const size = DEFS[defId].size || [10, 10];
  const r0 = Math.max(size[0], size[1]) * 0.5 + 2;
  for (const c of centers) {
    for (let r = 0; r <= maxR; r += 8) {
      const rr = r === 0 ? 0 : r + r0;
      const steps = r === 0 ? 1 : clamp(Math.round(rr * 0.55), 6, 26);
      const a0 = ai.rng() * Math.PI * 2;
      for (let s = 0; s < steps; s++) {
        const a = a0 + (s / steps) * Math.PI * 2;
        const x = clamp(c.x + Math.cos(a) * rr, -HALF + 24, HALF - 24);
        const z = clamp(c.z + Math.sin(a) * rr, -HALF + 24, HALF - 24);
        if (typeof production.updatePlacement === 'function') production.updatePlacement(x, z);
        if (pl.valid) {
          if (!footprintClear(DEFS[defId], x, z)) continue;  // never entomb units
          const site = typeof production.confirmPlacement === 'function'
            ? production.confirmPlacement() : null;
          if (site) return true;                     // placement consumed
          if (typeof production.cancelPlacement === 'function') production.cancelPlacement();
          return false;                              // confirm refused — bail
        }
      }
    }
  }
  if (typeof production.cancelPlacement === 'function') production.cancelPlacement();
  return false;
}

// no ground unit may stand inside a prospective footprint (they'd be walled in)
function footprintClear(def, x, z) {
  const hw = (def.size ? def.size[0] : 10) / 2 + 1.6;
  const hd = (def.size ? def.size[1] : 10) / 2 + 1.6;
  for (const u of G.units) {
    if (!u.alive || u.def.air) continue;
    if (Math.abs(u.pos.x - x) < hw + u.radius && Math.abs(u.pos.z - z) < hd + u.radius) return false;
  }
  return true;
}

// ---------------------------------------------------------------- units
function produceFrom(buildings, defId, maxQueue) {
  if (!buildings || typeof production.startProduction !== 'function') return false;
  for (const b of buildings) {
    if (!b.alive || (b.buildProgress ?? 1) < 1) continue;
    if ((b.queue ? b.queue.length : 0) >= maxQueue) continue;
    const cb = production.canBuild ? production.canBuild(ai.pid, defId) : null;
    if (!cb || !cb.ok) return false;
    production.startProduction(b, defId);
    ai._produced = ai._produced || {};
    ai._produced[defId] = (ai._produced[defId] || 0) + 1;
    return true;
  }
  return false;
}

function queuedOf(buildings, defId) {
  let n = 0;
  for (const b of buildings || []) for (const q of b.queue || []) if (q.defId === defId) n++;
  return n;
}

function weightedPick(list) {
  let tot = 0;
  for (const it of list) tot += it[1];
  let r = ai.rng() * tot;
  for (const it of list) { r -= it[1]; if (r <= 0) return it[0]; }
  return list[0][0];
}

function unitsJob(p) {
  const R = ai.roster, plan = ai.plan;
  // builder maintenance (cartel keeps a spare worker for parallel builds)
  const ccList = R.byDef[FACTIONS[ai.faction].cc];
  const builderTarget = ai.faction === 'cartel' ? 2 : 1;
  if (R.builders.length + queuedOf(ccList, plan.builderDef) < builderTarget &&
      produceFrom(ccList, plan.builderDef, 1)) return;
  // harvester line
  const supplies = R.byDef[plan.supply];
  const harvTarget = ai.knobs.aggression >= 2 ? 4 : 3;
  if (R.harvesters.length + queuedOf(supplies, plan.truck) < harvTarget &&
      produceFrom(supplies, plan.truck, 2)) return;
  // army from whichever production buildings exist
  const armyCap = Math.round(6 + 6 * ai.knobs.aggression + Math.min(16, G.gameTime / 60));
  const queuedArmy = R.prod.reduce((a, b) => a + (b.queue ? b.queue.length : 0), 0);
  ai._dbgCap = [R.combat.length, queuedArmy, armyCap];
  if (R.combat.length + queuedArmy >= armyCap) return;
  const want = ai.want;
  const budgetOK = (cost) => p.money >= cost && (!want || cost <= 320 || p.money > want.cost + cost);
  const done = (arr) => (arr || []).filter(b => (b.buildProgress ?? 1) >= 1);
  const tries = [];
  const fac = done(R.byDef[plan.factory]);
  const bar = done(R.byDef[plan.barracks]);
  const air = plan.airfield ? done(R.byDef[plan.airfield]) : [];
  if (fac.length) tries.push([fac, plan.vehicles]);
  if (bar.length) tries.push([bar, plan.infantry]);
  if (air.length && plan.airUnits.length) tries.push([air, plan.airUnits]);
  if (tries.length > 1 && ai.rng() < 0.45) tries.push(tries.shift());
  for (const [blds, comp] of tries) {
    const defId = weightedPick(comp);
    if (!budgetOK(DEFS[defId].cost)) continue;
    if (produceFrom(blds, defId, 2)) return;
  }
}

// ---------------------------------------------------------------- squads
function makeSquad(units, opts) {
  const s = {
    id: ai.nextSquadId++, units: units.slice(), state: opts.state || 'gather',
    waypoints: opts.waypoints || ai.waypoints, wp: 0,
    retreatFrac: opts.retreatFrac ?? 0.3, harass: !!opts.harass,
    lastOrderT: G.gameTime, gatherT: 0, rally: ai.gather,
    startHp: units.reduce((a, u) => a + u.maxHp, 0),
    retreatOrdered: false, retreatT: 0, dead: false,
  };
  for (const u of units) u.aiSquad = s.id;
  ai.squads.push(s);
  if (s.state === 'attack' && s.waypoints.length) {
    move.orderMove(s.units, s.waypoints[0].x, s.waypoints[0].z, { attackMove: true });
  }
  return s;
}

function disband(s) {
  for (const u of s.units) if (u && u.alive && u.aiSquad === s.id) u.aiSquad = null;
  s.dead = true;
}

function centroid(s) {
  if (!s.units.length) return null;
  let x = 0, z = 0;
  for (const u of s.units) { x += u.pos.x; z += u.pos.z; }
  return { x: x / s.units.length, z: z / s.units.length };
}

function runSquads(p) {
  const now = G.gameTime;
  detectThreat(p, now);
  // attack waves
  if (ai.waveT <= 0) {
    const free = ai.roster.combat.filter(u => !u.aiSquad);
    const waveSize = Math.min(20, Math.round(4 + 3 * ai.knobs.aggression + now / 90));
    const minSize = (ai.waveOverdue && now > 90) ? 3
      : Math.min(waveSize, 4 + Math.round(2 * ai.knobs.aggression));
    if (free.length >= minSize && !ai.threatActive) {
      launchWave(free, waveSize);
      ai.waveT = ai.knobs.attackWave;
      ai.waveOverdue = false;
    } else {
      ai.waveT = 12;                     // not ready — retry soon
      ai.waveOverdue = true;
    }
  }
  // harassment with fast units between waves
  if (ai.harassT <= 0) {
    ai.harassT = Math.max(30, 55 / (ai.knobs.aggression || 1));
    const fast = ai.roster.fast.filter(u => !u.aiSquad).slice(0, 3);
    if (fast.length >= 2 && !ai.threatActive && G.gameTime > 100) {
      const tgt = harassTarget();
      makeSquad(fast, { harass: true, state: 'attack', waypoints: [tgt], retreatFrac: 0.45 });
    }
  }
  for (const s of ai.squads) stepSquad(s, now);
  ai.squads = ai.squads.filter(s => !s.dead);
  // sweep strays (ambush/paradrop spawns, wave leftovers) into pressure:
  // unassigned idle combat units far from home attack the nearest enemy thing
  if (now - (ai.strayT || 0) > 25) {
    ai.strayT = now;
    for (const u of ai.roster.combat) {
      if (u.aiSquad || !isIdle(u)) continue;
      if (dist2d(u.pos.x, u.pos.z, p.baseX, p.baseZ) < 140) continue;
      const tgt = nearestEnemy(u, 160);
      if (tgt && typeof combat.orderAttack === 'function') combat.orderAttack([u], tgt);
      else {
        const ep = G.players[ai.enemyPid];
        move.orderMove([u], ep.baseX, ep.baseZ, { attackMove: true });
      }
    }
  }
  // defend the base: pull free army onto the threat, recall nearby squads
  if (ai.threatActive && ai.threat && now - ai.lastDefendOrderT > 4) {
    ai.lastDefendOrderT = now;
    const defenders = ai.roster.combat.filter(u => !u.aiSquad);
    if (defenders.length) move.orderMove(defenders, ai.threat.x, ai.threat.z, { attackMove: true });
    for (const s of ai.squads) {
      if (s.harass || s.state === 'retreat' || s.state === 'defend') continue;
      const c = centroid(s);
      if (c && dist2d(c.x, c.z, p.baseX, p.baseZ) < 150) {
        s.state = 'defend';
        move.orderMove(s.units, ai.threat.x, ai.threat.z, { attackMove: true });
      }
    }
  }
}

function detectThreat(p, now) {
  ai.threatActive = false;
  for (const b of ai.roster.buildings) {
    if (b.lastHitT && now - b.lastHitT < 5 &&
        dist2d(b.pos.x, b.pos.z, p.baseX, p.baseZ) < 130) {
      ai.threat = { x: b.pos.x, z: b.pos.z };
      ai.threatUntil = now + 12;
      break;
    }
  }
  if (ai.threat && ai.threatUntil > now) ai.threatActive = true;
}

function launchWave(free, waveSize) {
  const g = ai.gather;
  free.sort((a, b) => dist2d(a.pos.x, a.pos.z, g.x, g.z) - dist2d(b.pos.x, b.pos.z, g.x, g.z));
  const members = free.slice(0, waveSize);
  const s = makeSquad(members, { state: 'gather', waypoints: ai.waypoints, retreatFrac: 0.3 });
  s.gatherT = G.gameTime + 20;
  move.orderMove(members, g.x, g.z);
  ai.wavesLaunched++;
}

function stepSquad(s, now) {
  s.units = s.units.filter(u => u.alive);
  if (!s.units.length || (s.units.length < 2 && !s.harass)) { disband(s); return; }
  const hp = s.units.reduce((a, u) => a + u.hp, 0);
  if (s.state !== 'retreat' && hp < s.startHp * s.retreatFrac) {
    s.state = 'retreat';
    s.retreatOrdered = false;
  }
  if (s.state === 'gather') {
    const near = s.units.filter(u => dist2d(u.pos.x, u.pos.z, s.rally.x, s.rally.z) < 26).length;
    if (near >= s.units.length * 0.7 || now > s.gatherT) {
      s.state = 'attack'; s.wp = 0; s.lastOrderT = now;
      const w = s.waypoints[0];
      move.orderMove(s.units, w.x, w.z, { attackMove: true });
    }
  } else if (s.state === 'attack') {
    const wi = Math.min(s.wp, s.waypoints.length - 1);
    const w = s.waypoints[wi];
    const c = centroid(s);
    if (c && dist2d(c.x, c.z, w.x, w.z) < 34 && s.wp < s.waypoints.length - 1) {
      s.wp++; s.lastOrderT = now;
      const n = s.waypoints[s.wp];
      move.orderMove(s.units, n.x, n.z, { attackMove: true });
    } else if (now - s.lastOrderT > 7) {
      s.lastOrderT = now;
      const idle = s.units.filter(isIdle);
      if (!idle.length) return;
      if (s.wp >= s.waypoints.length - 1) {
        // arrived at the target: mop up whatever the enemy has left here
        for (const u of idle) {
          const tgt = nearestEnemy(u, 90);
          if (tgt && typeof combat.orderAttack === 'function') combat.orderAttack([u], tgt);
          else move.orderMove([u], w.x + (ai.rng() - 0.5) * 24, w.z + (ai.rng() - 0.5) * 24, { attackMove: true });
        }
      } else {
        move.orderMove(idle, w.x, w.z, { attackMove: true });
      }
    }
  } else if (s.state === 'retreat') {
    if (!s.retreatOrdered) {
      s.retreatOrdered = true;
      s.retreatT = now + 25;
      move.orderMove(s.units, ai.home.x, ai.home.z);
    }
    const c = centroid(s);
    if ((c && dist2d(c.x, c.z, ai.home.x, ai.home.z) < 45) || now > s.retreatT) disband(s);
  } else if (s.state === 'defend') {
    if (!ai.threatActive) disband(s);
  }
}

function nearestEnemy(u, r) {
  let best = null, bd = r;
  for (const e of G.entities) {
    if (!e.alive || e.owner !== ai.enemyPid) continue;
    const d = dist2d(e.pos.x, e.pos.z, u.pos.x, u.pos.z);
    if (d < bd) { bd = d; best = e; }
  }
  return best;
}

function harassTarget() {
  const eh = G.units.filter(u => u.alive && u.owner === ai.enemyPid && u.def.role === 'harvester');
  if (eh.length) {
    let x = 0, z = 0;
    for (const u of eh) { x += u.pos.x; z += u.pos.z; }
    return { x: x / eh.length, z: z / eh.length };
  }
  const ep = G.players[ai.enemyPid];
  let best = null, bd = Infinity;
  for (const d of G.docks || []) {
    const dd = dist2d(d.x, d.z, ep.baseX, ep.baseZ);
    if (dd < bd) { bd = dd; best = d; }
  }
  return best ? { x: best.x, z: best.z } : { x: ep.baseX, z: ep.baseZ };
}

// ---------------------------------------------------------------- powers
function powersJob(p) {
  const plan = ai.plan;
  let guard = 4;
  while (p.ptsAvail > 0 && guard-- > 0) {
    const next = plan.powerPriority.find(id =>
      !p.powersOwned.has(id) && POWERS[id] && POWERS[id].rank <= p.rank);
    if (!next || typeof powers.buyPower !== 'function') break;
    powers.buyPower(ai.pid, next);
    if (!p.powersOwned.has(next)) break;         // stub / refused: stop looping
  }
  // cast at most one power per pass, at a worthwhile target
  if (typeof powers.usePower === 'function') {
    for (const id of plan.powerPriority) {
      const pow = POWERS[id];
      if (!pow || pow.passive || !pow.targeted || !p.powersOwned.has(id)) continue;
      if ((p.powerCooldowns[id] || 0) > 0) continue;
      const tgt = powerTarget(id, p);
      if (!tgt) continue;
      const res = powers.usePower(ai.pid, id, tgt.x, tgt.z);
      // stub returns undefined: fake the cooldown locally so we don't spam.
      // The real impl sets p.powerCooldowns itself on success.
      if (res === undefined && (p.powerCooldowns[id] || 0) <= 0) {
        p.powerCooldowns[id] = pow.cooldown || 60;
      }
      break;
    }
  }
  fireSuperweapon(p);
}

function powerTarget(id, p) {
  const enemy = ai.enemyPid;
  if (id === 'repair') {
    const dmg = ai.roster.units.filter(u =>
      (u.def.role === 'vehicle' || u.def.role === 'artillery') && u.hp < u.maxHp * 0.6);
    return densestCluster(dmg, 16, 2);
  }
  if (G.gameTime < 90) return null;              // don't burn drops on minute one
  if (id === 'paradrop' || id === 'ambush') {
    const eh = G.units.filter(u => u.alive && u.owner === enemy && u.def.role === 'harvester');
    return densestCluster(eh, 30, 1) || harassTarget();
  }
  if (id === 'a10') {
    const army = G.units.filter(u => u.alive && u.owner === enemy && u.def.weapon);
    return densestCluster(army, 16, 4);
  }
  if (id === 'fab' || id === 'anthrax') {
    const army = G.units.filter(u => u.alive && u.owner === enemy && u.def.weapon);
    return densestCluster(army, 22, 6) ||
      densestCluster(enemyBuildings(), 22, 3, b => b.def.cost);
  }
  if (id === 'sneak') {
    const ep = G.players[enemy];
    const dx = p.baseX - ep.baseX, dz = p.baseZ - ep.baseZ, l = Math.hypot(dx, dz) || 1;
    return { x: ep.baseX + dx / l * 60, z: ep.baseZ + dz / l * 60 };
  }
  return null;
}

function fireSuperweapon(p) {
  const now = G.gameTime;
  if (now - ai.lastSwT < 30) return;
  const swb = ai.roster.buildings.find(b => b.def.superweapon && (b.buildProgress ?? 1) >= 1);
  if (!swb || typeof powers.getSwTimers !== 'function') return;
  const timers = powers.getSwTimers() || [];
  const mine = timers.find(t => t.pid === ai.pid && t.ready);
  if (!mine) return;
  const tgt = densestCluster(enemyBuildings(), 26, 1, b => b.def.cost + 1);
  if (!tgt || typeof powers.usePower !== 'function') return;
  const res = powers.usePower(ai.pid, swb.def.superweapon, tgt.x, tgt.z);
  if (res !== false) ai.lastSwT = now;
}

function enemyBuildings() {
  return G.buildings.filter(b => b.alive && b.owner === ai.enemyPid);
}

function densestCluster(list, radius, minCount, weightFn) {
  let best = null, bestW = 0;
  for (const a of list) {
    let w = 0, n = 0, cx = 0, cz = 0;
    for (const b of list) {
      if (dist2d(a.pos.x, a.pos.z, b.pos.x, b.pos.z) <= radius) {
        w += weightFn ? weightFn(b) : 1;
        n++; cx += b.pos.x; cz += b.pos.z;
      }
    }
    if (n >= minCount && w > bestW) { bestW = w; best = { x: cx / n, z: cz / n, n, w }; }
  }
  return best;
}

// ---------------------------------------------------------------- capture
function captureJob(p) {
  // drop finished/dead assignments, freeing the infantry back to the pool
  ai.captures = ai.captures.filter(c => {
    const keep = c.u.alive && c.d.alive && c.d.owner === -1;
    if (!keep && c.u.alive) {
      c.u.aiSquad = null;
      if (c.u.order && c.u.order.type === 'capture') c.u.order = { type: 'idle' };
    }
    return keep;
  });
  const derricks = G.buildings.filter(b => b.alive && b.def.capturable && b.owner === -1);
  if (derricks.length) {
    derricks.sort((a, b) =>
      dist2d(a.pos.x, a.pos.z, p.baseX, p.baseZ) - dist2d(b.pos.x, b.pos.z, p.baseX, p.baseZ));
    // don't strip the whole early army for capture runs
    const maxCap = ai.roster.combat.length >= 6 ? 2 : 1;
    for (const d of derricks.slice(0, 2)) {
      if (ai.captures.length >= maxCap) break;
      if (ai.captures.some(c => c.d === d)) continue;
      const u = ai.roster.units.find(x => x.def.canCapture && !x.aiSquad);
      if (!u) break;
      u.aiSquad = 'capture';
      ai.captures.push({ u, d });
      move.orderMove([u], d.pos.x + 6, d.pos.z + 6);
    }
  }
  for (const c of ai.captures) {
    const dd = dist2d(c.u.pos.x, c.u.pos.z, c.d.pos.x, c.d.pos.z);
    if (dd < 14) {
      // same order shape input.js uses, so the capture executor (economy/sim
      // agent) drives our infantry the moment that feature lands
      if (!c.u.order || c.u.order.type !== 'capture') {
        c.u.order = { type: 'capture', target: c.d, x: c.d.pos.x, z: c.d.pos.z };
      }
    } else if (isIdle(c.u)) {
      move.orderMove([c.u], c.d.pos.x + 6, c.d.pos.z + 6);
    }
  }
}

// ---------------------------------------------------------------- upgrades
function upgradesJob(p) {
  if (p.money < 3200 || !p.upgrades) return;
  for (const upgId of ai.plan.upgrades) {
    if (p.upgrades.has(upgId)) continue;
    if (ai.roster.buildings.some(b => (b.queue || []).some(q => q.defId === upgId))) return;
    const host = ai.roster.buildings.find(b =>
      b.def.upgrades && b.def.upgrades.includes(upgId) &&
      (b.buildProgress ?? 1) >= 1 && (b.queue ? b.queue.length : 0) === 0);
    if (!host) return;
    const cb = production.canBuild ? production.canBuild(ai.pid, upgId) : null;
    if (!cb || !cb.ok) return;
    if (typeof production.startProduction === 'function') production.startProduction(host, upgId);
    return;
  }
}

// ---------------------------------------------------------------- debug
function snapshot(p, waiting) {
  if (typeof window === 'undefined') return;
  const structures = {};
  if (ai.roster) for (const id in ai.roster.byDef) structures[id] = ai.roster.byDef[id].length;
  window.__aiDebug = {
    t: Math.round(G.gameTime), waiting: !!waiting, money: Math.round(p.money),
    faction: ai.faction, structures,
    army: ai.roster ? ai.roster.combat.length : 0,
    harvesters: ai.roster ? ai.roster.harvesters.length : 0,
    builders: ai.roster ? ai.roster.builders.length : 0,
    squads: ai.squads.map(s => ({ state: s.state, n: s.units.length, wp: s.wp, harass: s.harass })),
    waves: ai.wavesLaunched, threat: ai.threatActive,
    captures: ai.captures.length, cap: ai._dbgCap, produced: ai._produced,
    incomplete: ai.roster ? ai.roster.buildings.filter(b => b.buildProgress < 1)
      .map(b => ({ id: b.def.id, p: +b.buildProgress.toFixed(2),
        x: Math.round(b.pos.x), z: Math.round(b.pos.z) })) : [],
    builderState: ai.roster ? ai.roster.builders.map(u => ({
      o: u.order && u.order.type, x: Math.round(u.pos.x), z: Math.round(u.pos.z),
      path: !!u.path })) : [],
  };
}
