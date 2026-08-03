// Grid-based A* pathfinding with string-pulling smoothing.
// The nav grid is baked from world colliders; doors rebake on purchase.
export class NavGrid {
  constructor(minX, minZ, maxX, maxZ, cell = 0.5) {
    this.minX = minX; this.minZ = minZ; this.cell = cell;
    this.w = Math.ceil((maxX - minX) / cell);
    this.h = Math.ceil((maxZ - minZ) / cell);
    this.blocked = new Uint8Array(this.w * this.h);
    // scratch buffers for A*
    this._g = new Float32Array(this.w * this.h);
    this._came = new Int32Array(this.w * this.h);
    this._state = new Uint8Array(this.w * this.h);
  }

  toCell(x, z) {
    return [
      Math.max(0, Math.min(this.w - 1, Math.floor((x - this.minX) / this.cell))),
      Math.max(0, Math.min(this.h - 1, Math.floor((z - this.minZ) / this.cell))),
    ];
  }
  toWorld(cx, cz) {
    return [this.minX + (cx + 0.5) * this.cell, this.minZ + (cz + 0.5) * this.cell];
  }
  idx(cx, cz) { return cz * this.w + cx; }
  isBlocked(cx, cz) {
    if (cx < 0 || cz < 0 || cx >= this.w || cz >= this.h) return true;
    return this.blocked[cz * this.w + cx] === 1;
  }
  isBlockedWorld(x, z) { const [cx, cz] = this.toCell(x, z); return this.isBlocked(cx, cz); }

  clear() { this.blocked.fill(0); }

  // Block cells overlapped by an AABB (x/z extents), inflated by pad.
  blockAABB(minX, minZ, maxX, maxZ, pad = 0.28) {
    const [c0x, c0z] = this.toCell(minX - pad, minZ - pad);
    const [c1x, c1z] = this.toCell(maxX + pad, maxZ + pad);
    for (let cz = c0z; cz <= c1z; cz++)
      for (let cx = c0x; cx <= c1x; cx++)
        this.blocked[cz * this.w + cx] = 1;
  }

  // Find nearest unblocked cell to a world point (spiral search).
  nearestOpen(x, z, maxR = 12) {
    let [cx, cz] = this.toCell(x, z);
    if (!this.isBlocked(cx, cz)) return [cx, cz];
    for (let r = 1; r <= maxR; r++) {
      for (let dz = -r; dz <= r; dz++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
          if (!this.isBlocked(cx + dx, cz + dz)) return [cx + dx, cz + dz];
        }
      }
    }
    return null;
  }

  // Grid line-of-walkability between two world points (for path smoothing).
  lineOpen(x0, z0, x1, z1) {
    const dist = Math.hypot(x1 - x0, z1 - z0);
    const steps = Math.max(2, Math.ceil(dist / (this.cell * 0.5)));
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      if (this.isBlockedWorld(x0 + (x1 - x0) * t, z0 + (z1 - z0) * t)) return false;
    }
    return true;
  }

  // A* from world (sx,sz) to (tx,tz). Returns array of [x,z] waypoints (world), or null.
  findPath(sx, sz, tx, tz, maxExpand = 6000) {
    const s = this.nearestOpen(sx, sz, 8);
    const t = this.nearestOpen(tx, tz, 8);
    if (!s || !t) return null;
    const { w } = this;
    const g = this._g, came = this._came, state = this._state;
    state.fill(0);
    const si = this.idx(s[0], s[1]), ti = this.idx(t[0], t[1]);
    if (si === ti) { const [wx, wz] = this.toWorld(t[0], t[1]); return [[wx, wz]]; }
    // binary heap of [f, idx]
    const heap = [];
    const push = (f, i) => {
      heap.push([f, i]);
      let c = heap.length - 1;
      while (c > 0) { const p = (c - 1) >> 1; if (heap[p][0] <= heap[c][0]) break; [heap[p], heap[c]] = [heap[c], heap[p]]; c = p; }
    };
    const pop = () => {
      const top = heap[0], last = heap.pop();
      if (heap.length) {
        heap[0] = last;
        let c = 0;
        for (;;) {
          let m = c; const l = 2 * c + 1, r = l + 1;
          if (l < heap.length && heap[l][0] < heap[m][0]) m = l;
          if (r < heap.length && heap[r][0] < heap[m][0]) m = r;
          if (m === c) break; [heap[m], heap[c]] = [heap[c], heap[m]]; c = m;
        }
      }
      return top;
    };
    const hx = t[0], hz = t[1];
    const heur = (cx, cz) => {
      const dx = Math.abs(cx - hx), dz = Math.abs(cz - hz);
      return (dx + dz) + (1.41421 - 2) * Math.min(dx, dz);
    };
    g[si] = 0; came[si] = -1; state[si] = 1;
    push(heur(s[0], s[1]), si);
    const DIRS = [[1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1], [1, 1, 1.41421], [1, -1, 1.41421], [-1, 1, 1.41421], [-1, -1, 1.41421]];
    let expanded = 0;
    while (heap.length && expanded < maxExpand) {
      const [, ci] = pop();
      if (state[ci] === 2) continue;
      state[ci] = 2; expanded++;
      if (ci === ti) break;
      const cx = ci % w, cz = (ci / w) | 0;
      for (const [dx, dz, cost] of DIRS) {
        const nx = cx + dx, nz = cz + dz;
        if (this.isBlocked(nx, nz)) continue;
        // no corner cutting on diagonals
        if (dx !== 0 && dz !== 0 && (this.isBlocked(cx + dx, cz) || this.isBlocked(cx, cz + dz))) continue;
        const ni = nz * w + nx;
        if (state[ni] === 2) continue;
        const ng = g[ci] + cost;
        if (state[ni] === 0 || ng < g[ni]) {
          g[ni] = ng; came[ni] = ci; state[ni] = 1;
          push(ng + heur(nx, nz), ni);
        }
      }
    }
    if (state[ti] !== 2) return null;
    // reconstruct
    const cells = [];
    for (let i = ti; i !== -1; i = came[i]) cells.push(i);
    cells.reverse();
    // string-pull smoothing
    const pts = cells.map(i => this.toWorld(i % w, (i / w) | 0));
    const out = [pts[0]];
    let anchor = 0;
    for (let i = 2; i < pts.length; i++) {
      if (!this.lineOpen(pts[anchor][0], pts[anchor][1], pts[i][0], pts[i][1])) {
        out.push(pts[i - 1]);
        anchor = i - 1;
      }
    }
    out.push(pts[pts.length - 1]);
    return out;
  }
}
