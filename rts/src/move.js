// move.js — nav grid, A* pathfinding, unit locomotion + separation.
// OWNED BY: sim agent (may be rewritten wholesale; keep the public API).
// API: initNav(); G.nav.{passable(x,z), blockFootprint(e), unblockFootprint(e),
//   findPath(sx,sz,tx,tz)->[{x,z}]|null}; orderMove(units,x,z,opts);
//   orderStop(units); stepUnits(dt) called from main loop.
import { G, WORLD_SIZE, HALF, clamp, turnToward, angleTo } from './core.js';

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
  const n = units.length;
  const spread = Math.max(2, Math.sqrt(n) * 2.4);
  units.forEach((u, i) => {
    if (u.kind !== 'unit') return;
    const ox = n > 1 ? (i % Math.ceil(Math.sqrt(n)) - Math.sqrt(n) / 2 + 0.5) * spread : 0;
    const oz = n > 1 ? (Math.floor(i / Math.ceil(Math.sqrt(n))) - Math.sqrt(n) / 2 + 0.5) * spread : 0;
    const tx = clamp(x + ox, -HALF + 8, HALF - 8), tz = clamp(z + oz, -HALF + 8, HALF - 8);
    u.order = { type: opts.attackMove ? 'attackmove' : 'move', x: tx, z: tz };
    u.target = null;
    u.path = u.def.air ? [{ x: tx, z: tz }] : G.nav.findPath(u.pos.x, u.pos.z, tx, tz);
    u.pathI = 0;
  });
}
export function orderStop(units) {
  for (const u of units) { if (u.kind !== 'unit') continue; u.order = { type: 'idle' }; u.path = null; u.target = null; }
}

// per-frame locomotion: follow path + neighbor separation + face travel dir
export function stepUnits(dt) {
  for (const u of G.units) {
    if (!u.alive) continue;
    let mvx = 0, mvz = 0, moving = false;
    if (u.path && u.pathI < u.path.length) {
      const wp = u.path[u.pathI];
      const dx = wp.x - u.pos.x, dz = wp.z - u.pos.z;
      const d = Math.hypot(dx, dz);
      const arrive = u.pathI === u.path.length - 1 ? 1.2 : 2.2;
      if (d < arrive) { u.pathI++; if (u.pathI >= u.path.length) { u.path = null; if (u.order.type === 'move') u.order = { type: 'idle' }; } }
      else { mvx = dx / d; mvz = dz / d; moving = true; }
    }
    // separation from nearby units (cheap n² within same-ish tick budget; sim agent may grid it)
    let sx = 0, sz = 0;
    for (const o of G.units) {
      if (o === u || !o.alive || o.def.air !== u.def.air) continue;
      const dx = u.pos.x - o.pos.x, dz = u.pos.z - o.pos.z;
      const d = Math.hypot(dx, dz), min = u.radius + o.radius + 0.4;
      if (d < min && d > 0.001) { const f = (min - d) / min; sx += dx / d * f; sz += dz / d * f; }
    }
    mvx += sx * (moving ? 0.7 : 0.25); mvz += sz * (moving ? 0.7 : 0.25);
    const l = Math.hypot(mvx, mvz);
    if (l > 0.01) {
      const sp = u.def.speed * (moving ? 1 : 0.4);
      const stepX = mvx / l * sp * dt, stepZ = mvz / l * sp * dt;
      const nx = u.pos.x + stepX, nz = u.pos.z + stepZ;
      if (u.def.air || G.nav.passable(nx, nz)) { u.pos.x = nx; u.pos.z = nz; }
      else if (G.nav.passable(nx, u.pos.z)) u.pos.x = nx;
      else if (G.nav.passable(u.pos.x, nz)) u.pos.z = nz;
      if (moving) u.yaw = turnToward(u.yaw, angleTo(0, 0, mvx, mvz), u.def.turnRate * dt);
    }
    // ground clamp / hover
    const gy = G.groundHeight(u.pos.x, u.pos.z);
    u.pos.y = u.def.air ? gy + u.flyH : gy;
    u.mesh.position.copy(u.pos);
    u.mesh.rotation.y = u.yaw;
  }
}
