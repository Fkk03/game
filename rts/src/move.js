// move.js — nav grid, A* pathfinding, unit locomotion + separation.
// OWNED BY: sim agent (may be rewritten wholesale; keep the public API).
// API: initNav(); G.nav.{passable(x,z), blockFootprint(e), unblockFootprint(e),
//   findPath(sx,sz,tx,tz)->[{x,z}]|null}; orderMove(units,x,z,opts);
//   orderStop(units); stepUnits(dt) called from main loop.
// Extra (additive) export: unitsNear(x,z,r) — spatial-hash query over alive
//   units, rebuilt each stepUnits tick (combat.js uses it for crush checks).
import { G, WORLD_SIZE, HALF, clamp, turnToward, angleTo, makeRng } from './core.js';

const mrng = makeRng(9091);

const CELLS = 150;                       // 4m cells over 600m
const CS = WORLD_SIZE / CELLS;

class NavGrid {
  constructor() {
    this.terr = new Uint8Array(CELLS * CELLS);   // 1 = blocked by terrain
    this.bld = new Uint8Array(CELLS * CELLS);    // count of building blockers
    for (let iz = 0; iz < CELLS; iz++) {
      for (let ix = 0; ix < CELLS; ix++) {
        const x = (ix + 0.5) * CS - HALF, z = (iz + 0.5) * CS - HALF;
        const h = G.groundHeight(x, z);
        const s1 = Math.abs(G.groundHeight(x + CS, z) - h);
        const s2 = Math.abs(G.groundHeight(x, z + CS) - h);
        const slope = Math.max(s1, s2) / CS;
        const border = Math.max(Math.abs(x), Math.abs(z)) > HALF - 14;
        this.terr[iz * CELLS + ix] = (slope > 0.62 || border) ? 1 : 0;
      }
    }
  }
  idx(x, z) {
    const ix = clamp(Math.floor((x + HALF) / CS), 0, CELLS - 1);
    const iz = clamp(Math.floor((z + HALF) / CS), 0, CELLS - 1);
    return iz * CELLS + ix;
  }
  passable(x, z) { const i = this.idx(x, z); return !this.terr[i] && !this.bld[i]; }
  cellsOf(e) {
    const [w, d] = e.def.size ?? [4, 4];
    const out = [];
    const r = Math.ceil(Math.max(w, d) * 0.5 / CS);
    const cx = Math.floor((e.pos.x + HALF) / CS), cz = Math.floor((e.pos.z + HALF) / CS);
    for (let iz = cz - r; iz <= cz + r; iz++) {
      for (let ix = cx - r; ix <= cx + r; ix++) {
        if (ix < 0 || iz < 0 || ix >= CELLS || iz >= CELLS) continue;
        const x = (ix + 0.5) * CS - HALF, z = (iz + 0.5) * CS - HALF;
        if (Math.abs(x - e.pos.x) < w * 0.5 + CS * 0.4 && Math.abs(z - e.pos.z) < d * 0.5 + CS * 0.4) {
          out.push(iz * CELLS + ix);
        }
      }
    }
    return out;
  }
  blockFootprint(e) { if (e.kind === 'building') for (const i of this.cellsOf(e)) this.bld[i]++; }
  unblockFootprint(e) { if (e.kind === 'building') for (const i of this.cellsOf(e)) this.bld[i] = Math.max(0, this.bld[i] - 1); }

  // A* with octile heuristic; returns world waypoints (smoothed)
  findPath(sx, sz, tx, tz) {
    const start = this.idx(sx, sz), goal = this.idx(tx, tz);
    if (start === goal) return [{ x: tx, z: tz }];
    const blocked = (i) => this.terr[i] || this.bld[i];
    // if goal blocked, spiral to nearest open cell
    let g2 = goal;
    if (blocked(g2)) {
      const gx = goal % CELLS, gz = Math.floor(goal / CELLS);
      outer: for (let r = 1; r < 20; r++) {
        for (let dz = -r; dz <= r; dz++) for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
          const nx = gx + dx, nz = gz + dz;
          if (nx < 0 || nz < 0 || nx >= CELLS || nz >= CELLS) continue;
          if (!blocked(nz * CELLS + nx)) { g2 = nz * CELLS + nx; break outer; }
        }
      }
    }
    const open = new MinHeap();
    const came = new Map(), gs = new Map();
    gs.set(start, 0);
    open.push(start, 0);
    const h = (i) => {
      const dx = Math.abs((i % CELLS) - (g2 % CELLS)), dz = Math.abs(Math.floor(i / CELLS) - Math.floor(g2 / CELLS));
      return Math.max(dx, dz) + 0.41 * Math.min(dx, dz);
    };
    let found = false, iter = 0;
    while (open.size && iter++ < 12000) {
      const cur = open.pop();
      if (cur === g2) { found = true; break; }
      const cx = cur % CELLS, cz = Math.floor(cur / CELLS);
      for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dz) continue;
        const nx = cx + dx, nz = cz + dz;
        if (nx < 0 || nz < 0 || nx >= CELLS || nz >= CELLS) continue;
        const ni = nz * CELLS + nx;
        if (blocked(ni)) continue;
        if (dx && dz && (blocked(cz * CELLS + nx) || blocked(nz * CELLS + cx))) continue; // no corner cutting
        const ng = gs.get(cur) + (dx && dz ? 1.41 : 1);
        if (ng < (gs.get(ni) ?? Infinity)) {
          gs.set(ni, ng); came.set(ni, cur);
          open.push(ni, ng + h(ni));
        }
      }
    }
    if (!found) return null;
    // reconstruct + string-pull smooth
    let path = [g2];
    let c = g2;
    while (c !== start) { c = came.get(c); path.push(c); }
    path.reverse();
    const pts = path.map(i => ({ x: (i % CELLS + 0.5) * CS - HALF, z: (Math.floor(i / CELLS) + 0.5) * CS - HALF }));
    const clear = (a, b) => {
      const steps = Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / (CS * 0.5));
      for (let i = 1; i < steps; i++) {
        const t = i / steps;
        if (!this.passable(a.x + (b.x - a.x) * t, a.z + (b.z - a.z) * t)) return false;
      }
      return true;
    };
    const out = [];
    let anchor = { x: sx, z: sz }, k = 0;
    while (k < pts.length) {
      let far = k;
      for (let j = pts.length - 1; j > k; j--) if (clear(anchor, pts[j])) { far = j; break; }
      out.push(pts[far]);
      anchor = pts[far];
      k = far + 1;
    }
    out[out.length - 1] = { x: tx, z: tz };
    return out;
  }
}

class MinHeap {
  constructor() { this.a = []; }
  get size() { return this.a.length; }
  push(v, p) {
    const a = this.a; a.push([p, v]);
    let i = a.length - 1;
    while (i) { const par = (i - 1) >> 1; if (a[par][0] <= a[i][0]) break; [a[par], a[i]] = [a[i], a[par]]; i = par; }
  }
  pop() {
    const a = this.a, top = a[0][1], last = a.pop();
    if (a.length) {
      a[0] = last;
      let i = 0;
      for (;;) {
        const l = i * 2 + 1, r = l + 1;
        let m = i;
        if (l < a.length && a[l][0] < a[m][0]) m = l;
        if (r < a.length && a[r][0] < a[m][0]) m = r;
        if (m === i) break;
        [a[m], a[i]] = [a[i], a[m]]; i = m;
      }
    }
    return top;
  }
}

export function initNav() { G.nav = new NavGrid(); }

export function orderMove(units, x, z, opts = {}) {
  const movers = units.filter(u => u.kind === 'unit');
  const n = movers.length;
  if (!n) return;
  // formation slots: grid centered on target, greedily matched to units by
  // proximity so groups don't cross paths on arrival
  const cols = Math.ceil(Math.sqrt(n));
  const rows = Math.ceil(n / cols);
  const spread = Math.max(3.2, Math.sqrt(n) * 2.6);
  const slots = [];
  for (let i = 0; i < n; i++) {
    const ox = (i % cols - (cols - 1) / 2) * spread;
    const oz = (Math.floor(i / cols) - (rows - 1) / 2) * spread;
    slots.push({
      x: clamp(x + ox, -HALF + 8, HALF - 8),
      z: clamp(z + oz, -HALF + 8, HALF - 8),
      used: false,
    });
  }
  for (const u of movers) {
    let best = null, bd = Infinity;
    for (const s of slots) {
      if (s.used) continue;
      const d = (s.x - u.pos.x) ** 2 + (s.z - u.pos.z) ** 2;
      if (d < bd) { bd = d; best = s; }
    }
    best.used = true;
    u.order = { type: opts.attackMove ? 'attackmove' : 'move', x: best.x, z: best.z };
    u.target = null;
    u.path = u.def.air ? [{ x: best.x, z: best.z }]
      : (G.nav.findPath(u.pos.x, u.pos.z, best.x, best.z) || [{ x: best.x, z: best.z }]);
    u.pathI = 0;
    u.stuckT = 0;
  }
}
export function orderStop(units) {
  for (const u of units) { if (u.kind !== 'unit') continue; u.order = { type: 'idle' }; u.path = null; u.target = null; }
}

// ---------------- spatial hash (rebuilt every stepUnits tick) ----------------
const HCELL = 8;
const hash = new Map();
const hkey = (ix, iz) => ((ix + 512) << 11) | (iz + 512);

function rebuildHash() {
  hash.clear();
  for (const u of G.units) {
    if (!u.alive) continue;
    const k = hkey(Math.floor(u.pos.x / HCELL), Math.floor(u.pos.z / HCELL));
    let arr = hash.get(k);
    if (!arr) { arr = []; hash.set(k, arr); }
    arr.push(u);
  }
}

// alive units within r of (x,z) — valid after the most recent stepUnits tick
export function unitsNear(x, z, r, out = []) {
  out.length = 0;
  const x0 = Math.floor((x - r) / HCELL), x1 = Math.floor((x + r) / HCELL);
  const z0 = Math.floor((z - r) / HCELL), z1 = Math.floor((z + r) / HCELL);
  const r2 = r * r;
  for (let iz = z0; iz <= z1; iz++) {
    for (let ix = x0; ix <= x1; ix++) {
      const arr = hash.get(hkey(ix, iz));
      if (!arr) continue;
      for (const u of arr) {
        const dx = u.pos.x - x, dz = u.pos.z - z;
        if (dx * dx + dz * dz <= r2) out.push(u);
      }
    }
  }
  return out;
}

const _near = [];

// has this unit effectively arrived? (a settled squadmate already sits between
// it and the goal → stop instead of orbiting / shoving the stack)
function crowdedStop(u, wp, d) {
  if (d > 8) return false;
  unitsNear(u.pos.x, u.pos.z, u.radius + 3.2, _near);
  for (const o of _near) {
    if (o === u || !!o.def.air !== !!u.def.air || o.owner !== u.owner) continue;
    if (o.path) continue;                       // still moving itself
    const gx = o.order?.x, gz = o.order?.z;
    const sameArea = gx === undefined ||
      (Math.hypot(gx - wp.x, gz - wp.z) < 12);
    if (!sameArea) continue;
    const dd = Math.hypot(o.pos.x - u.pos.x, o.pos.z - u.pos.z);
    if (dd < u.radius + o.radius + 1.1) {
      // is it roughly toward the goal?
      const tw = Math.hypot(wp.x - u.pos.x, wp.z - u.pos.z);
      const to = Math.hypot(wp.x - o.pos.x, wp.z - o.pos.z);
      if (to < tw + 0.5) return true;
    }
  }
  return false;
}

// per-frame locomotion: path follow + hashed separation + smoothing + facing
export function stepUnits(dt) {
  rebuildHash();
  for (const u of G.units) {
    if (!u.alive) continue;
    let mvx = 0, mvz = 0, moving = false, speedScale = 1;
    if (u.path && u.pathI < u.path.length) {
      const wp = u.path[u.pathI];
      const dx = wp.x - u.pos.x, dz = wp.z - u.pos.z;
      const d = Math.hypot(dx, dz);
      const last = u.pathI === u.path.length - 1;
      let arrive = last ? (u.def.air ? 3.5 : 1.1) : 2.4;
      if (last && !u.def.air && crowdedStop(u, wp, d)) arrive = Math.max(arrive, d + 0.5);
      if (d < arrive) {
        u.pathI++;
        if (u.pathI >= u.path.length) {
          u.path = null;
          u.stuckT = 0;
          if (u.order?.type === 'move') u.order = { type: 'idle' };
        }
      } else {
        mvx = dx / d; mvz = dz / d; moving = true;
        if (last) speedScale = clamp(d / 5, 0.42, 1);   // decelerate into goal
      }
    }
    // separation from hashed neighbours
    let sx = 0, sz = 0;
    unitsNear(u.pos.x, u.pos.z, 6, _near);
    for (const o of _near) {
      if (o === u || !o.alive || !!o.def.air !== !!u.def.air) continue;
      // crushers roll straight over enemy infantry — no mutual shove
      const enemies = o.owner !== u.owner && o.owner !== -1 && u.owner !== -1;
      if (enemies && ((u.def.crush && o.def.role === 'infantry') ||
                      (o.def.crush && u.def.role === 'infantry'))) continue;
      const dx = u.pos.x - o.pos.x, dz = u.pos.z - o.pos.z;
      const d = Math.hypot(dx, dz), min = u.radius + o.radius + 0.5;
      if (d < min && d > 0.001) {
        let f = (min - d) / min;
        if (!moving && o.path) f *= 1.5;        // idlers yield to movers
        sx += dx / d * f; sz += dz / d * f;
      } else if (d <= 0.001) {
        const a = mrng() * Math.PI * 2;
        sx += Math.cos(a); sz += Math.sin(a);
      }
    }
    const sMag = Math.hypot(sx, sz);
    if (sMag > 1) { sx /= sMag; sz /= sMag; }
    const sw = moving ? 0.65 : 0.5;
    mvx += sx * sw; mvz += sz * sw;
    const l = Math.hypot(mvx, mvz);
    // desired velocity (deadzone kills idle micro-jitter)
    let dvx = 0, dvz = 0;
    if (l > (moving ? 0.01 : 0.12)) {
      const sp = u.def.speed * (moving ? speedScale : 0.45);
      dvx = mvx / l * sp; dvz = mvz / l * sp;
    }
    // smooth accel toward desired velocity
    const k = 1 - Math.exp(-9 * dt);
    u.vel.x += (dvx - u.vel.x) * k;
    u.vel.z += (dvz - u.vel.z) * k;
    const vMag = Math.hypot(u.vel.x, u.vel.z);
    if (vMag > 0.05) {
      const nx = u.pos.x + u.vel.x * dt, nz = u.pos.z + u.vel.z * dt;
      const px = u.pos.x, pz = u.pos.z;
      if (u.def.air || G.nav.passable(nx, nz)) { u.pos.x = nx; u.pos.z = nz; }
      else if (G.nav.passable(nx, u.pos.z)) { u.pos.x = nx; u.vel.z = 0; }
      else if (G.nav.passable(u.pos.x, nz)) { u.pos.z = nz; u.vel.x = 0; }
      else { u.vel.x = 0; u.vel.z = 0; }
      // face travel direction once actually moving
      if (vMag > u.def.speed * 0.18) {
        u.yaw = turnToward(u.yaw, angleTo(0, 0, u.vel.x, u.vel.z), u.def.turnRate * dt);
      }
      // stuck detection → repath to remaining goal
      if (moving && !u.def.air) {
        const stepped = Math.hypot(u.pos.x - px, u.pos.z - pz);
        if (stepped < u.def.speed * speedScale * dt * 0.2) {
          u.stuckT = (u.stuckT || 0) + dt;
          if (u.stuckT > 0.9 && u.path) {
            const goal = u.path[u.path.length - 1];
            u.path = G.nav.findPath(u.pos.x, u.pos.z, goal.x, goal.z) || [goal];
            u.pathI = 0;
            u.stuckT = 0;
          }
        } else u.stuckT = 0;
      }
    }
    // ground clamp / hover
    const gy = G.groundHeight(u.pos.x, u.pos.z);
    u.pos.y = u.def.air ? gy + u.flyH : gy;
    u.mesh.position.copy(u.pos);
    u.mesh.rotation.y = u.yaw;
  }
}
