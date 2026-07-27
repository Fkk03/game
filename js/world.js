/* ============ world.js — map generation, terrain, fog of war, supplies ============ */
'use strict';

class World {
  constructor(wTiles, hTiles, seed, playerTeams) {
    this.w = wTiles; this.h = hTiles;
    this.pw = wTiles * TILE; this.ph = hTiles * TILE;   // pixel size
    this.seed = seed;
    this.playerTeams = playerTeams || [0, 1];   // team id per player slot
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

    // start positions: team 0 on the SW arc, team 1 on the NE arc of a ring
    const teams = this.playerTeams;
    const cx = w / 2, cy = h / 2, R = Math.min(w, h) * 0.36;
    const byTeam = {};
    teams.forEach((t, pi) => { (byTeam[t] = byTeam[t] || []).push(pi); });
    const baseAng = { 0: Math.PI * 0.75, 1: -Math.PI * 0.25 };   // SW / NE
    this.starts = new Array(teams.length);
    for (const t in byTeam) {
      const members = byTeam[t];
      const k = members.length;
      const spacing = k > 1 ? Math.min(0.55, 1.7 / (k - 1)) : 0;
      members.forEach((pi, i) => {
        const a = (baseAng[t] !== undefined ? baseAng[t] : U.rand(0, 6.28)) + (i - (k - 1) / 2) * spacing;
        const tx = U.clamp(Math.round(cx + Math.cos(a) * R), 8, w - 9);
        const ty = U.clamp(Math.round(cy + Math.sin(a) * R), 8, h - 9);
        this.starts[pi] = { x: (tx + 0.5) * TILE, y: (ty + 0.5) * TILE, tx, ty };
        this.clearArea(tx, ty, 12);
      });
    }

    // supply docks: one rich dock near each base + many scattered across the map
    for (const st of this.starts) {
      const dir = Math.atan2(cy - st.ty, cx - st.tx);
      const dx = U.clamp(st.tx + Math.round(Math.cos(dir) * 9), 6, w - 8);
      const dy = U.clamp(st.ty + Math.round(Math.sin(dir) * 9), 6, h - 8);
      this.makeDock(dx, dy, 30000, rng);
    }
    const nScatter = teams.length * 2 + 4;
    for (let i = 0; i < nScatter; i++) {
      let placed = false;
      for (let att = 0; att < 200 && !placed; att++) {
        const tx = U.randInt(Math.round(w * 0.08), Math.round(w * 0.88));
        const ty = U.randInt(Math.round(h * 0.08), Math.round(h * 0.88));
        let ok = true;
        for (const st of this.starts) if (U.dist(tx, ty, st.tx, st.ty) < 13) { ok = false; break; }
        if (ok) for (const d of this.docks) if (U.dist(tx, ty, d.x / TILE, d.y / TILE) < 9) { ok = false; break; }
        if (!ok) continue;
        this.makeDock(tx, ty, 24000, rng);
        placed = true;
      }
    }

    // guarantee connectivity: start 0 must reach every other start and every dock
    const p0 = { tx: this.starts[0].tx, ty: this.starts[0].ty };
    for (let i = 1; i < this.starts.length; i++) {
      this.ensureReachable(p0, { tx: this.starts[i].tx, ty: this.starts[i].ty });
    }
    for (const d of this.docks) {
      this.ensureReachable(p0, { tx: Math.floor(d.x / TILE), ty: Math.floor(d.y / TILE) - 3 });
    }

    // decorative props on passable ground
    const nProps = Math.floor(w * h / 90);
    for (let i = 0; i < nProps; i++) {
      const tx = U.randInt(2, w - 3), ty = U.randInt(2, h - 3);
      if (this.terrain[this.idx(tx, ty)] === 2 || this.blocked[this.idx(tx, ty)]) continue;
      let nearStart = false;
      for (const st of this.starts) {
        if (U.dist((tx + .5) * TILE, (ty + .5) * TILE, st.x, st.y) < 9 * TILE) { nearStart = true; break; }
      }
      if (nearStart) continue;
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
    // units standing in the footprint don't block placement — they get nudged out
    return true;
  }

  /* ---------------- fog of war (human player only) ---------------- */
  recomputeFog() {
    this.visible.fill(0);
    this.visionSources = [];
    const humanTeam = game.players[0].team;
    for (const e of game.ents) {
      if (e.dead || e.owner < 0) continue;
      const p = game.players[e.owner];
      if (!p || p.team !== humanTeam) continue;          // allies share vision
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
