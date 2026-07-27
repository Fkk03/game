/* ============ world.js — map generation, terrain, fog of war, supplies ============ */
'use strict';

class World {
  constructor(wTiles, hTiles, seed) {
    this.w = wTiles; this.h = hTiles;
    this.pw = wTiles * TILE; this.ph = hTiles * TILE;   // pixel size
    this.seed = seed;
    this.terrain = new Uint8Array(wTiles * hTiles);     // 0 sand, 1 rough, 2 cliff (impassable)
    this.blocked = new Uint8Array(wTiles * hTiles);     // 0 free, 1 building, 2 supply pile
    this.explored = new Uint8Array(wTiles * hTiles);    // player fog
    this.visible = new Uint8Array(wTiles * hTiles);
    this.props = [];        // decorative rocks / scrub {x,y,type,s,rot}
    this.docks = [];        // supply piles {x,y,amount,max,tiles:[{tx,ty}]}
    this.crates = [];       // salvage {x,y,kind,val,t}
    this.reveals = [];      // temp vision {x,y,r,until}
    this.starts = [];       // [{x,y}] world coords, index = player id
    this.generate();
  }

  idx(tx, ty) { return ty * this.w + tx; }
  inb(tx, ty) { return tx >= 0 && ty >= 0 && tx < this.w && ty < this.h; }
  passable(tx, ty) {
    return this.inb(tx, ty) && this.terrain[this.idx(tx, ty)] < 2 && this.blocked[this.idx(tx, ty)] === 0;
  }
  passableWorld(x, y) { return this.passable(Math.floor(x / TILE), Math.floor(y / TILE)); }

  /* ---------------- generation ---------------- */
  generate() {
    const { w, h } = this;
    const rng = U.seededRng(this.seed);
    const noise = U.makeNoise(rng, 64);

    // base terrain from fractal noise — mirrored across the diagonal for fairness
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        // mirror: sample using canonical coords so (x,y) and (w-1-x → mirrored) match
        const mx = Math.min(x, w - 1 - y), my = Math.min(y, h - 1 - x);
        const n = U.fractal(noise, mx * 0.09, my * 0.09, 4, 2.1, 0.5);
        const r = U.fractal(noise, mx * 0.23 + 31, my * 0.23 + 17, 3, 2.0, 0.5);
        let t = 0;
        if (n > 0.66) t = 2;            // cliffs / rock outcrops
        else if (r > 0.60) t = 1;       // rough ground (visual only)
        this.terrain[this.idx(x, y)] = t;
      }
    }
    // map border cliffs
    for (let i = 0; i < w; i++) {
      for (let b = 0; b < 2; b++) {
        this.terrain[this.idx(i, b)] = 2; this.terrain[this.idx(i, h - 1 - b)] = 2;
        this.terrain[this.idx(b, i)] = 2; this.terrain[this.idx(w - 1 - b, i)] = 2;
      }
    }

    // start positions: SW for player, NE for enemy
    const m = Math.round(w * 0.16);
    const p0 = { tx: m, ty: h - 1 - m }, p1 = { tx: w - 1 - m, ty: m };
    this.starts = [
      { x: (p0.tx + 0.5) * TILE, y: (p0.ty + 0.5) * TILE },
      { x: (p1.tx + 0.5) * TILE, y: (p1.ty + 0.5) * TILE },
    ];
    this.clearArea(p0.tx, p0.ty, 13);
    this.clearArea(p1.tx, p1.ty, 13);

    // supply docks: one near each base + two mirrored mid-map
    const dockDefs = [
      { tx: p0.tx + 9, ty: p0.ty - 9, amt: 18000 },
      { tx: p1.tx - 9, ty: p1.ty + 9, amt: 18000 },
      { tx: Math.round(w * 0.30), ty: Math.round(h * 0.30), amt: 24000 },
      { tx: Math.round(w * 0.70), ty: Math.round(h * 0.70), amt: 24000 },
    ];
    for (const d of dockDefs) this.makeDock(d.tx, d.ty, d.amt, rng);

    // guarantee connectivity between starts and every dock
    this.ensureReachable(p0, p1);
    for (const d of this.docks) {
      this.ensureReachable(p0, { tx: Math.floor(d.x / TILE), ty: Math.floor(d.y / TILE) - 3 });
    }

    // decorative props on passable ground
    const nProps = Math.floor(w * h / 90);
    for (let i = 0; i < nProps; i++) {
      const tx = U.randInt(2, w - 3), ty = U.randInt(2, h - 3);
      if (this.terrain[this.idx(tx, ty)] === 2 || this.blocked[this.idx(tx, ty)]) continue;
      if (U.dist((tx + .5) * TILE, (ty + .5) * TILE, this.starts[0].x, this.starts[0].y) < 9 * TILE) continue;
      if (U.dist((tx + .5) * TILE, (ty + .5) * TILE, this.starts[1].x, this.starts[1].y) < 9 * TILE) continue;
      this.props.push({
        x: (tx + 0.5) * TILE + U.rand(-12, 12), y: (ty + 0.5) * TILE + U.rand(-12, 12),
        type: rng() < 0.55 ? 'scrub' : 'rock', s: U.rand(0.6, 1.5), rot: U.rand(0, Math.PI * 2),
      });
    }
  }

  clearArea(cx, cy, r) {
    for (let y = cy - r; y <= cy + r; y++)
      for (let x = cx - r; x <= cx + r; x++)
        if (this.inb(x, y) && x > 1 && y > 1 && x < this.w - 2 && y < this.h - 2)
          if (U.dist(x, y, cx, cy) <= r) this.terrain[this.idx(x, y)] = this.terrain[this.idx(x, y)] === 1 ? 1 : 0;
  }

  makeDock(cx, cy, amount, rng) {
    const tiles = [];
    // 2x2 pile footprint blocks; visual piles around center
    for (let y = cy; y < cy + 2; y++) for (let x = cx; x < cx + 2; x++) {
      if (!this.inb(x, y)) continue;
      this.terrain[this.idx(x, y)] = 0;
      this.blocked[this.idx(x, y)] = 2;
      tiles.push({ tx: x, ty: y });
    }
    // clear ring around so trucks can path in
    for (let y = cy - 2; y < cy + 4; y++) for (let x = cx - 2; x < cx + 4; x++) {
      if (this.inb(x, y) && this.blocked[this.idx(x, y)] === 0) this.terrain[this.idx(x, y)] = Math.min(this.terrain[this.idx(x, y)], 1);
    }
    this.docks.push({
      x: (cx + 1) * TILE, y: (cy + 1) * TILE,
      amount, max: amount, tiles,
      seed: Math.floor(rng() * 1e9),
    });
  }

  dockAt(x, y) {
    for (const d of this.docks) {
      if (d.amount > 0 && U.dist(x, y, d.x, d.y) < TILE * 2.2) return d;
    }
    return null;
  }

  depleteDock(d, amt) {
    d.amount -= amt;
    if (d.amount <= 0) {
      d.amount = 0;
      for (const t of d.tiles) this.blocked[this.idx(t.tx, t.ty)] = 0;
    }
  }

  /* carve a walkable line between two tile points if not connected */
  ensureReachable(a, b) {
    if (this.floodConnected(a, b)) return;
    let x = a.tx, y = a.ty;
    while (x !== b.tx || y !== b.ty) {
      if (x !== b.tx && (y === b.ty || Math.random() < 0.5)) x += Math.sign(b.tx - x);
      else y += Math.sign(b.ty - y);
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        if (this.inb(x + dx, y + dy) && x + dx > 1 && y + dy > 1 && x + dx < this.w - 2 && y + dy < this.h - 2) {
          const i = this.idx(x + dx, y + dy);
          if (this.terrain[i] === 2) this.terrain[i] = 1;
        }
      }
    }
  }

  floodConnected(a, b) {
    const { w, h } = this;
    const seen = new Uint8Array(w * h);
    const q = [a.ty * w + a.tx];
    seen[q[0]] = 1;
    const target = b.ty * w + b.tx;
    while (q.length) {
      const c = q.pop();
      if (c === target) return true;
      const cx = c % w, cy = (c / w) | 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const nx = cx + dx, ny = cy + dy;
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const ni = ny * w + nx;
        if (!seen[ni] && this.terrain[ni] < 2) { seen[ni] = 1; q.push(ni); }
      }
    }
    return false;
  }

  /* ---------------- building footprint block / unblock ---------------- */
  blockRect(tx, ty, size, on) {
    for (let y = ty; y < ty + size; y++) for (let x = tx; x < tx + size; x++)
      if (this.inb(x, y)) this.blocked[this.idx(x, y)] = on ? 1 : 0;
  }

  canPlace(tx, ty, size, playerIdx) {
    for (let y = ty; y < ty + size; y++) for (let x = tx; x < tx + size; x++) {
      if (!this.inb(x, y)) return false;
      const i = this.idx(x, y);
      if (this.terrain[i] === 2 || this.blocked[i] !== 0) return false;
      if (playerIdx === 0 && !this.explored[i]) return false;
    }
    // no units standing in the footprint (except the builder itself is fine — it stands adjacent)
    const x0 = tx * TILE, y0 = ty * TILE, x1 = (tx + size) * TILE, y1 = (ty + size) * TILE;
    for (const e of game.ents) {
      if (e.kind !== 'unit' || e.dead || e.def.air) continue;
      if (e.x > x0 - 8 && e.x < x1 + 8 && e.y > y0 - 8 && e.y < y1 + 8) return false;
    }
    return true;
  }

  /* ---------------- fog of war (human player only) ---------------- */
  recomputeFog() {
    this.visible.fill(0);
    this.visionSources = [];
    for (const e of game.ents) {
      if (e.dead || e.owner !== 0) continue;
      if (e.kind === 'building' && !e.constructed && e.buildProgress < 0.05) continue;
      this.stampVision(e.x, e.y, e.def.sight);
      this.visionSources.push({ x: e.x, y: e.y, r: e.def.sight * TILE });
    }
    const now = game.t;
    this.reveals = this.reveals.filter(r => r.until > now);
    for (const r of this.reveals) {
      this.stampVision(r.x, r.y, r.r / TILE);
      this.visionSources.push({ x: r.x, y: r.y, r: r.r });
    }
  }

  stampVision(wx, wy, sightTiles) {
    const cx = Math.floor(wx / TILE), cy = Math.floor(wy / TILE);
    const r = Math.ceil(sightTiles), r2 = sightTiles * sightTiles;
    for (let y = cy - r; y <= cy + r; y++) {
      if (y < 0 || y >= this.h) continue;
      for (let x = cx - r; x <= cx + r; x++) {
        if (x < 0 || x >= this.w) continue;
        const dx = x - cx, dy = y - cy;
        if (dx * dx + dy * dy <= r2) {
          const i = this.idx(x, y);
          this.visible[i] = 1; this.explored[i] = 1;
        }
      }
    }
  }

  isVisible(x, y) { const tx = Math.floor(x / TILE), ty = Math.floor(y / TILE);
    return this.inb(tx, ty) && this.visible[this.idx(tx, ty)] === 1; }
  isExplored(x, y) { const tx = Math.floor(x / TILE), ty = Math.floor(y / TILE);
    return this.inb(tx, ty) && this.explored[this.idx(tx, ty)] === 1; }

  addReveal(x, y, r, dur) { this.reveals.push({ x, y, r, until: game.t + dur }); }

  /* ---------------- salvage crates ---------------- */
  dropCrate(x, y, kind, val) {
    if (!this.passableWorld(x, y)) return;
    this.crates.push({ x, y, kind, val, t: game.t });
  }
}
