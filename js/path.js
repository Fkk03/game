/* ============ path.js — A* pathfinding with LoS smoothing ============ */
'use strict';
const PATH = (() => {
  // binary min-heap keyed by f-score
  class Heap {
    constructor() { this.a = []; }
    push(n) {
      const a = this.a; a.push(n);
      let i = a.length - 1;
      while (i > 0) {
        const p = (i - 1) >> 1;
        if (a[p].f <= a[i].f) break;
        [a[p], a[i]] = [a[i], a[p]]; i = p;
      }
    }
    pop() {
      const a = this.a, top = a[0], last = a.pop();
      if (a.length) {
        a[0] = last;
        let i = 0;
        for (;;) {
          const l = i * 2 + 1, r = l + 1;
          let s = i;
          if (l < a.length && a[l].f < a[s].f) s = l;
          if (r < a.length && a[r].f < a[s].f) s = r;
          if (s === i) break;
          [a[s], a[i]] = [a[i], a[s]]; i = s;
        }
      }
      return top;
    }
    get size() { return this.a.length; }
  }

  const SQRT2 = Math.SQRT2;

  /* nearest passable tile to (tx,ty), spiral search */
  function nearestOpen(w, tx, ty, maxR = 12) {
    if (w.passable(tx, ty)) return { tx, ty };
    for (let r = 1; r <= maxR; r++) {
      for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        if (w.passable(tx + dx, ty + dy)) return { tx: tx + dx, ty: ty + dy };
      }
    }
    return null;
  }

  /* straight-line passability between two tiles (for path smoothing) */
  function losTiles(w, x0, y0, x1, y1) {
    let dx = Math.abs(x1 - x0), dy = Math.abs(y1 - y0);
    let sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
    let err = dx - dy, x = x0, y = y0;
    for (;;) {
      if (!w.passable(x, y)) return false;
      if (x === x1 && y === y1) return true;
      const e2 = 2 * err;
      if (e2 > -dy) { err -= dy; x += sx; if (!w.passable(x, y - 0) ) return false; }
      if (e2 < dx) { err += dx; y += sy; }
      if (Math.abs(x - x0) > 300) return false; // safety
    }
  }

  /**
   * find(world, startX, startY, endX, endY) — world-pixel coords.
   * Returns array of waypoints [{x,y}, ...] (world coords, excludes start), or null.
   */
  function find(w, sx, sy, ex, ey, maxIter = 6000) {
    let st = nearestOpen(w, Math.floor(sx / TILE), Math.floor(sy / TILE));
    let en = nearestOpen(w, Math.floor(ex / TILE), Math.floor(ey / TILE));
    if (!st || !en) return null;
    if (st.tx === en.tx && st.ty === en.ty) return [{ x: ex, y: ey }];

    const W = w.w, H = w.h;
    const gScore = new Float32Array(W * H).fill(Infinity);
    const came = new Int32Array(W * H).fill(-1);
    const closed = new Uint8Array(W * H);
    const heap = new Heap();
    const si = st.ty * W + st.tx, ei = en.ty * W + en.tx;
    gScore[si] = 0;
    heap.push({ i: si, f: 0 });

    let found = false, iter = 0;
    let bestI = si, bestH = Infinity;

    while (heap.size && iter++ < maxIter) {
      const cur = heap.pop();
      const ci = cur.i;
      if (closed[ci]) continue;
      closed[ci] = 1;
      if (ci === ei) { found = true; break; }
      const cx = ci % W, cy = (ci / W) | 0;

      const hCur = Math.max(Math.abs(cx - en.tx), Math.abs(cy - en.ty));
      if (hCur < bestH) { bestH = hCur; bestI = ci; }

      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dy === 0) continue;
        const nx = cx + dx, ny = cy + dy;
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
        if (!w.passable(nx, ny)) continue;
        // no diagonal corner cutting
        if (dx !== 0 && dy !== 0 && (!w.passable(cx + dx, cy) || !w.passable(cx, cy + dy))) continue;
        const ni = ny * W + nx;
        if (closed[ni]) continue;
        const step = (dx !== 0 && dy !== 0) ? SQRT2 : 1;
        // slight penalty for rough terrain keeps roads-ish paths natural
        const cost = gScore[ci] + step * (w.terrain[ni] === 1 ? 1.15 : 1);
        if (cost < gScore[ni]) {
          gScore[ni] = cost;
          came[ni] = ci;
          const ddx = Math.abs(nx - en.tx), ddy = Math.abs(ny - en.ty);
          const hh = Math.max(ddx, ddy) + 0.41 * Math.min(ddx, ddy);
          heap.push({ i: ni, f: cost + hh });
        }
      }
    }

    const endNode = found ? ei : bestI;      // fall back to closest-reached tile
    if (!found && bestH > 60) return null;
    // reconstruct
    let tiles = [];
    let c = endNode;
    while (c !== -1 && c !== si) { tiles.push(c); c = came[c]; }
    tiles.reverse();
    if (!tiles.length) return null;

    // smooth: greedily skip waypoints with line of sight
    const pts = tiles.map(i => ({ tx: i % W, ty: (i / W) | 0 }));
    const out = [];
    let a = { tx: st.tx, ty: st.ty };
    let k = 0;
    while (k < pts.length) {
      let far = k;
      for (let j = pts.length - 1; j > k; j--) {
        if (j - k > 40) continue;
        if (losTiles(w, a.tx, a.ty, pts[j].tx, pts[j].ty)) { far = j; break; }
      }
      a = pts[far];
      out.push({ x: (a.tx + 0.5) * TILE, y: (a.ty + 0.5) * TILE });
      k = far + 1;
    }
    // land exactly on requested point if its tile is the final tile
    if (found) {
      const last = out[out.length - 1];
      if (Math.floor(ex / TILE) === en.tx && Math.floor(ey / TILE) === en.ty) { last.x = ex; last.y = ey; }
    }
    return out;
  }

  return { find, nearestOpen };
})();
