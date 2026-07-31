/* ============ render.js — canvas renderer: terrain, sprites, fog, minimap ============ */
'use strict';
const RENDER = (() => {
  let cv, ctx, W = 0, H = 0;
  let terrainCv = null, terrainCtx = null;    // cached terrain (half resolution)
  let fogCv = null, fogCtx = null;            // composited fog (3px per tile)
  let exploredCv = null, exploredCtx = null;  // persistent explored mask
  let visibleCv = null, visibleCtx = null;    // per-refresh visible mask
  let mmBase = null;                          // minimap terrain cache
  const TS = 0.5;                             // terrain cache scale
  let ghosts = new Map();                     // last-seen enemy buildings

  let gradeCv = null;
  function init(canvas) {
    cv = canvas; ctx = cv.getContext('2d');
    resize();
    window.addEventListener('resize', resize);
  }
  function resize() {
    W = cv.width = window.innerWidth;
    H = cv.height = window.innerHeight;
    // pre-render the color grade: corner vignette + warm sunlight from the top
    gradeCv = document.createElement('canvas');
    gradeCv.width = W; gradeCv.height = H;
    const g = gradeCv.getContext('2d');
    const vg = g.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.42, W / 2, H / 2, Math.max(W, H) * 0.75);
    vg.addColorStop(0, 'rgba(0,0,0,0)');
    vg.addColorStop(1, 'rgba(10,6,2,0.34)');
    g.fillStyle = vg; g.fillRect(0, 0, W, H);
    const warm = g.createLinearGradient(0, 0, 0, H);
    warm.addColorStop(0, 'rgba(255,196,110,0.10)');
    warm.addColorStop(0.5, 'rgba(255,180,90,0.02)');
    warm.addColorStop(1, 'rgba(40,30,60,0.08)');
    g.fillStyle = warm; g.fillRect(0, 0, W, H);
  }

  const toScreenX = wx => (wx - game.cam.x) * game.cam.zoom;
  const toScreenY = wy => (wy - game.cam.y) * game.cam.zoom;
  const toWorldX = sx => sx / game.cam.zoom + game.cam.x;
  const toWorldY = sy => sy / game.cam.zoom + game.cam.y;

  /* ================= terrain cache ================= */
  function buildTerrain() {
    ghosts = new Map();
    terrainCv = document.createElement('canvas');
    terrainCv.width = Math.ceil(world.pw * TS);
    terrainCv.height = Math.ceil(world.ph * TS);
    terrainCtx = terrainCv.getContext('2d');
    const c = terrainCtx;
    const rng = U.seededRng(world.seed + 7);
    const noise = U.makeNoise(rng, 64);

    // base sand
    c.fillStyle = '#c2a26a';
    c.fillRect(0, 0, terrainCv.width, terrainCv.height);

    // organic shading sampled at half-tile resolution (not grid-aligned)
    const t = TILE * TS;
    const sub = 2, st = t / sub;
    for (let y = 0; y < world.h * sub; y++) {
      for (let x = 0; x < world.w * sub; x++) {
        const tx = (x / sub) | 0, ty = (y / sub) | 0;
        const ter = world.terrain[world.idx(tx, ty)];
        const n = U.fractal(noise, x * 0.13 + 5, y * 0.13 + 9, 4, 2.1, 0.55);
        if (ter === 2) {
          const v = 0.5 + n * 0.42;
          c.fillStyle = `rgb(${Math.round(126 * v)},${Math.round(112 * v)},${Math.round(90 * v)})`;
          c.fillRect(x * st, y * st, st + 0.5, st + 0.5);
        } else if (ter === 1) {
          c.fillStyle = `rgba(134,108,66,${0.16 + n * 0.30})`;
          c.fillRect(x * st, y * st, st + 0.5, st + 0.5);
        } else {
          // smooth light/dark sand variation
          const l = U.clamp((n - 0.5) * 1.6, -0.45, 0.5);
          c.fillStyle = l > 0 ? `rgba(236,214,158,${l * 0.55})` : `rgba(122,96,58,${-l * 0.45})`;
          c.fillRect(x * st, y * st, st + 0.5, st + 0.5);
        }
      }
    }
    // large-scale color blotches — breaks up uniformity like a painted map
    for (let i = 0; i < world.w * world.h / 420; i++) {
      const bx = rng() * terrainCv.width, by = rng() * terrainCv.height;
      const br = (8 + rng() * 18) * TILE * TS;
      const g2 = c.createRadialGradient(bx, by, br * 0.2, bx, by, br);
      const warm = rng() < 0.5;
      g2.addColorStop(0, warm ? 'rgba(214,158,92,0.16)' : 'rgba(126,98,64,0.15)');
      g2.addColorStop(1, 'rgba(0,0,0,0)');
      c.fillStyle = g2;
      c.beginPath(); c.arc(bx, by, br, 0, 7); c.fill();
    }
    // wind-blown dune streaks
    c.lineWidth = 1.4;
    for (let i = 0; i < world.w * world.h / 34; i++) {
      const x = rng() * terrainCv.width, y = rng() * terrainCv.height;
      const len = 20 + rng() * 60, a = -0.5 + rng() * 0.3;
      c.strokeStyle = rng() < 0.5 ? 'rgba(240,220,170,0.13)' : 'rgba(100,78,46,0.11)';
      c.beginPath();
      c.moveTo(x, y);
      c.quadraticCurveTo(x + Math.cos(a) * len * 0.5, y + Math.sin(a) * len * 0.5 - 4 - rng() * 6,
        x + Math.cos(a) * len, y + Math.sin(a) * len);
      c.stroke();
    }
    // sand grain speckle
    for (let i = 0; i < world.w * world.h * 2.2; i++) {
      const x = rng() * terrainCv.width, y = rng() * terrainCv.height;
      c.fillStyle = rng() < 0.5 ? 'rgba(255,240,200,0.10)' : 'rgba(90,70,40,0.10)';
      c.fillRect(x, y, 1.5, 1.5);
    }
    // cliff edge highlight/shadow for depth
    for (let y = 0; y < world.h; y++) {
      for (let x = 0; x < world.w; x++) {
        if (world.terrain[world.idx(x, y)] !== 2) continue;
        const below = world.inb(x, y + 1) && world.terrain[world.idx(x, y + 1)] !== 2;
        const above = world.inb(x, y - 1) && world.terrain[world.idx(x, y - 1)] !== 2;
        if (below) { c.fillStyle = 'rgba(30,22,12,0.55)'; c.fillRect(x * t, (y + 1) * t - 3, t, 4); }
        if (above) { c.fillStyle = 'rgba(255,235,190,0.30)'; c.fillRect(x * t, y * t, t, 2.5); }
      }
    }

    // fog canvases — 3 px per tile, soft radial vision circles
    const fs = 3;
    fogCv = document.createElement('canvas');
    fogCv.width = world.w * fs; fogCv.height = world.h * fs;
    fogCtx = fogCv.getContext('2d');
    exploredCv = document.createElement('canvas');
    exploredCv.width = fogCv.width; exploredCv.height = fogCv.height;
    exploredCtx = exploredCv.getContext('2d');
    exploredCtx.fillStyle = '#000';
    exploredCtx.fillRect(0, 0, exploredCv.width, exploredCv.height);
    visibleCv = document.createElement('canvas');
    visibleCv.width = fogCv.width; visibleCv.height = fogCv.height;
    visibleCtx = visibleCv.getContext('2d');

    buildMinimapBase();
  }

  function addDecal(x, y, r) {
    if (!terrainCtx) return;
    const c = terrainCtx;
    c.save();
    c.globalAlpha = 0.55;
    const g = c.createRadialGradient(x * TS, y * TS, 1, x * TS, y * TS, r * TS);
    g.addColorStop(0, 'rgba(20,16,10,0.9)');
    g.addColorStop(0.7, 'rgba(35,28,16,0.45)');
    g.addColorStop(1, 'rgba(35,28,16,0)');
    c.fillStyle = g;
    c.beginPath(); c.arc(x * TS, y * TS, r * TS, 0, 7); c.fill();
    c.restore();
  }

  function addTrack(x, y, ang, width) {
    if (!terrainCtx) return;
    const c = terrainCtx;
    c.save();
    c.translate(x * TS, y * TS);
    c.rotate(ang);
    c.fillStyle = 'rgba(52,38,22,0.12)';
    const L = 10 * TS, o = width * TS * 0.55;
    c.fillRect(-L / 2, -o - 1.6 * TS, L, 1.6 * TS);
    c.fillRect(-L / 2, o, L, 1.6 * TS);
    c.restore();
  }

  function addWreck(x, y, ang, radius, air) {
    if (!terrainCtx) return;
    const c = terrainCtx;
    addDecal(x, y, radius * 2.2);
    c.save();
    c.translate(x * TS, y * TS);
    c.rotate(ang);
    if (air) {
      // burned airframe: charred dart + snapped wing spars
      const L = radius * 2.1 * TS;
      c.fillStyle = '#241f18';
      c.beginPath();
      c.moveTo(L * 0.6, 0); c.lineTo(-L * 0.45, -L * 0.16); c.lineTo(-L * 0.45, L * 0.16);
      c.closePath(); c.fill();
      c.strokeStyle = '#1a1610'; c.lineWidth = 2 * TS;
      c.beginPath(); c.moveTo(-L * 0.05, -L * 0.42); c.lineTo(L * 0.1, L * 0.38); c.stroke();
      c.fillStyle = '#3c362a';
      for (let i = 0; i < 5; i++) c.fillRect(U.rand(-L * 0.5, L * 0.5), U.rand(-L * 0.4, L * 0.4), U.rand(2, 4), U.rand(1.5, 3));
      c.restore();
      return;
    }
    const w = radius * 1.7 * TS, h = radius * 1.15 * TS;
    c.fillStyle = '#2e2a22';
    c.fillRect(-w / 2, -h / 2, w, h);
    c.fillStyle = '#443e32';
    c.fillRect(-w / 2 + 1.5, -h / 2 + 1.5, w - 3, h * 0.4);
    c.fillStyle = '#1c1913';
    c.beginPath(); c.arc(w * 0.1, 0, h * 0.28, 0, 7); c.fill();
    for (let i = 0; i < 4; i++) {
      c.fillStyle = i % 2 ? '#3c362a' : '#241f18';
      c.fillRect(U.rand(-w, w * 0.8), U.rand(-h, h * 0.8), U.rand(2, 5), U.rand(1.5, 3.5));
    }
    c.restore();
  }

  function addRubble(x, y, size) {
    if (!terrainCtx) return;
    const c = terrainCtx, s = size * TILE * TS * 0.5;
    addDecal(x, y, size * TILE * 0.6);
    c.save();
    c.translate(x * TS, y * TS);
    for (let i = 0; i < size * 7; i++) {
      c.fillStyle = i % 2 ? '#4a443a' : '#5c554a';
      c.save();
      c.rotate(U.rand(0, Math.PI));
      c.fillRect(U.rand(-s, s), U.rand(-s, s), U.rand(3, 9), U.rand(2, 5));
      c.restore();
    }
    c.restore();
  }

  /* ================= fog ================= */
  function refreshFogCanvas() {
    const fs = 3;
    const sources = world.visionSources || [];
    // accumulate persistent explored mask (soft white circles, never cleared)
    // and this-frame visible mask
    visibleCtx.clearRect(0, 0, visibleCv.width, visibleCv.height);
    for (const s of sources) {
      const cx = s.x / TILE * fs, cy = s.y / TILE * fs, r = Math.max(2, s.r / TILE * fs);
      const g = visibleCtx.createRadialGradient(cx, cy, r * 0.62, cx, cy, r);
      g.addColorStop(0, 'rgba(255,255,255,1)');
      g.addColorStop(1, 'rgba(255,255,255,0)');
      visibleCtx.fillStyle = g;
      visibleCtx.beginPath(); visibleCtx.arc(cx, cy, r, 0, 7); visibleCtx.fill();
      exploredCtx.fillStyle = g;
      exploredCtx.beginPath(); exploredCtx.arc(cx, cy, r, 0, 7); exploredCtx.fill();
    }
    // compose: opaque black − explored*0.62 − visible
    const c = fogCtx;
    c.globalCompositeOperation = 'source-over';
    c.fillStyle = 'rgb(6,6,5)';
    c.fillRect(0, 0, fogCv.width, fogCv.height);
    c.globalCompositeOperation = 'destination-out';
    c.globalAlpha = 0.62;
    c.drawImage(exploredCv, 0, 0);
    c.globalAlpha = 1;
    c.drawImage(visibleCv, 0, 0);
    c.globalCompositeOperation = 'source-over';
  }

  /* ================= main frame ================= */
  function frame() {
    if (!game || !game.started) return;
    const cam = game.cam, z = cam.z = cam.zoom;

    ctx.fillStyle = '#0a0a08';
    ctx.fillRect(0, 0, W, H);

    ctx.save();
    ctx.scale(z, z);
    ctx.translate(-cam.x, -cam.y);

    // terrain
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(terrainCv, 0, 0, terrainCv.width, terrainCv.height, 0, 0, world.pw, world.ph);

    // props
    for (const pr of world.props) {
      if (!onScreen(pr.x, pr.y, 40)) continue;
      drawProp(pr);
    }

    // supply docks
    for (const d of world.docks) {
      if (d.amount <= 0 || !onScreen(d.x, d.y, 90)) continue;
      drawDock(d);
    }

    // salvage crates
    for (const cr of world.crates) {
      if (!onScreen(cr.x, cr.y, 20)) continue;
      ctx.save(); ctx.translate(cr.x, cr.y);
      ctx.fillStyle = 'rgba(0,0,0,0.25)'; ctx.beginPath(); ctx.ellipse(0, 4, 10, 4, 0, 0, 7); ctx.fill();
      ctx.fillStyle = '#b08c30'; ctx.fillRect(-7, -6, 14, 11);
      ctx.strokeStyle = '#6e5710'; ctx.strokeRect(-7, -6, 14, 11);
      ctx.fillStyle = '#ffe9a0'; ctx.font = 'bold 9px sans-serif'; ctx.textAlign = 'center';
      ctx.fillText('⚙', 0, 3); ctx.textAlign = 'left';
      ctx.restore();
    }

    // collect + sort ground entities by y
    const ground = [], air = [];
    for (const e of game.ents) {
      if (e.dead) continue;
      if (e.kind === 'unit' && e.def.air) { air.push(e); continue; }
      ground.push(e);
    }
    ground.sort((a, b) => (a.y + (a.kind === 'building' ? a.size * TILE * 0.5 : 0)) -
                          (b.y + (b.kind === 'building' ? b.size * TILE * 0.5 : 0)));

    // ghost buildings (seen before, now hidden)
    for (const [, g] of ghosts) {
      if (world.visible[world.idx(g.tx0, g.ty0)]) continue;
      ctx.save(); ctx.globalAlpha = 0.55;
      drawBuildingSprite(g.ent, true);
      ctx.restore();
    }

    for (const e of ground) {
      if (!entVisibleToPlayer(e)) continue;
      if (!onScreen(e.x, e.y, 130)) continue;
      if (e.kind === 'building') drawBuilding(e);
      else drawUnit(e);
    }

    // projectiles
    drawProjectiles();

    // particles & beams
    FX.draw(ctx);

    // air units + shadows
    for (const e of air) {
      if (!entVisibleToPlayer(e)) continue;
      if (!onScreen(e.x, e.y, 100)) continue;
      if (e.def.heli) drawHeli(e); else drawJet(e);
    }

    // nuke incoming reticles
    for (const n of game.nukes) {
      if (!world.isExplored(n.x, n.y)) continue;
      const k = n.t / n.fly;
      ctx.strokeStyle = `rgba(255,60,30,${0.4 + 0.5 * Math.sin(game.t * 10)})`;
      ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(n.x, n.y, 230 * (1 - k * 0.6), 0, 7); ctx.stroke();
      ctx.beginPath(); ctx.arc(n.x, n.y, 20, 0, 7); ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(n.x - 40, n.y); ctx.lineTo(n.x + 40, n.y);
      ctx.moveTo(n.x, n.y - 40); ctx.lineTo(n.x, n.y + 40);
      ctx.stroke();
    }
    // solaris sweeps
    for (const b of game.beamStrikes) {
      ctx.globalAlpha = 0.5 + 0.3 * Math.sin(game.t * 22);
      ctx.strokeStyle = '#bfe8ff'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(b.x, b.y, 240, 0, 7); ctx.stroke();
      ctx.globalAlpha = 1;
    }

    // selection + orders UI (world space)
    drawSelectionOverlays();

    // floating texts
    FX.drawTexts(ctx);

    // fog of war
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(fogCv, 0, 0, fogCv.width, fogCv.height, 0, 0, world.pw, world.ph);

    // control points render above fog — objectives are always visible
    for (const z of game.zones) drawZone(z);

    ctx.restore();

    // cinematic color grade (screen space)
    if (gradeCv) ctx.drawImage(gradeCv, 0, 0);

    // building placement ghost (screen-space redraw in world coords)
    if (INPUT.placing) drawPlacement();

    // drag select box
    if (INPUT.dragBox) {
      const b = INPUT.dragBox;
      ctx.strokeStyle = '#9fdc7c'; ctx.lineWidth = 1.5;
      ctx.strokeRect(b.x0, b.y0, b.x1 - b.x0, b.y1 - b.y0);
      ctx.fillStyle = 'rgba(159,220,124,0.08)';
      ctx.fillRect(b.x0, b.y0, b.x1 - b.x0, b.y1 - b.y0);
    }

    // power targeting reticle
    if (INPUT.targeting) {
      const m = INPUT.mouse;
      ctx.strokeStyle = 'rgba(255,90,60,0.9)'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(m.x, m.y, 26, 0, 7); ctx.stroke();
      ctx.beginPath(); ctx.arc(m.x, m.y, 4, 0, 7); ctx.stroke();
      ctx.font = '12px sans-serif'; ctx.fillStyle = '#ffd0c0';
      const label = INPUT.targeting.label || '';
      ctx.fillText(label, m.x + 32, m.y + 4);
    }

    FX.drawFlashes(ctx, W, H);
    drawCursor();
  }

  function onScreen(x, y, pad) {
    const z = game.cam.zoom;
    const sx = (x - game.cam.x) * z, sy = (y - game.cam.y) * z;
    return sx > -pad * z && sy > -pad * z && sx < W + pad * z && sy < H + pad * z;
  }

  function entVisibleToPlayer(e) {
    if (e.embarked) return false;
    if (e.owner === -1) return true;
    const p = game.players[e.owner];
    if (p && p.team === game.players[0].team) return true;   // own + allied always visible
    if (isStealthed(e) && !isDetectedBy(e, game.players[0].team)) return false;
    if (game.revealAll) return true;
    if (e.kind === 'building') {
      // buildings render if currently visible; ghosts handle the rest
      // (killEnt calls RENDER.cleanGhost to drop destroyed buildings from the map)
      const vis = world.isVisible(e.x, e.y);
      if (vis) ghosts.set(e.id, { ent: e, tx0: U.clamp(e.tx, 0, world.w - 1), ty0: U.clamp(e.ty, 0, world.h - 1) });
      return vis;
    }
    return world.isVisible(e.x, e.y);
  }

  function cleanGhost(id) { ghosts.delete(id); }

  /* ================= props & docks ================= */
  function drawProp(pr) {
    ctx.save();
    ctx.translate(pr.x, pr.y);
    if (pr.type === 'rock') {
      ctx.rotate(pr.rot);
      ctx.fillStyle = 'rgba(0,0,0,0.2)';
      ctx.beginPath(); ctx.ellipse(2, 3, 11 * pr.s, 6 * pr.s, 0, 0, 7); ctx.fill();
      ctx.fillStyle = '#8d8271';
      ctx.beginPath();
      ctx.moveTo(-10 * pr.s, 4 * pr.s); ctx.lineTo(-4 * pr.s, -7 * pr.s);
      ctx.lineTo(5 * pr.s, -5 * pr.s); ctx.lineTo(10 * pr.s, 3 * pr.s);
      ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#a99d89';
      ctx.beginPath();
      ctx.moveTo(-4 * pr.s, -7 * pr.s); ctx.lineTo(5 * pr.s, -5 * pr.s); ctx.lineTo(1 * pr.s, 0);
      ctx.closePath(); ctx.fill();
    } else {
      ctx.fillStyle = 'rgba(0,0,0,0.15)';
      ctx.beginPath(); ctx.ellipse(1, 2, 8 * pr.s, 4 * pr.s, 0, 0, 7); ctx.fill();
      ctx.strokeStyle = '#6d7a3f'; ctx.lineWidth = 1.6;
      for (let i = 0; i < 5; i++) {
        const a = pr.rot + i * 1.25;
        ctx.beginPath(); ctx.moveTo(0, 0);
        ctx.quadraticCurveTo(Math.cos(a) * 5 * pr.s, Math.sin(a) * 5 * pr.s - 4, Math.cos(a) * 8 * pr.s, Math.sin(a) * 6 * pr.s - 7 * pr.s);
        ctx.stroke();
      }
    }
    ctx.restore();
  }

  function drawDock(d) {
    const f = d.amount / d.max;
    const rng = U.seededRng(d.seed);
    if (f <= 0) {
      // exhausted: leftover pallet marks + regeneration countdown
      ctx.save();
      ctx.translate(d.x, d.y);
      ctx.fillStyle = 'rgba(40,32,20,0.35)';
      ctx.beginPath(); ctx.ellipse(0, 4, 40, 19, 0, 0, 7); ctx.fill();
      if (d.regenAt > game.t) {
        const left = Math.max(0, d.regenAt - game.t);
        ctx.font = 'bold 13px system-ui';
        ctx.textAlign = 'center';
        ctx.fillStyle = 'rgba(255,225,150,0.85)';
        ctx.fillText('⏳ ' + U.fmtTime(left), 0, -6);
        ctx.font = '10px system-ui';
        ctx.fillStyle = 'rgba(220,205,160,0.7)';
        const nextFrac = [1, 0.75, 0.5, 0.25][Math.min(d.stage + 1, 3)];
        ctx.fillText('resupply ' + Math.round(nextFrac * 100) + '%', 0, 8);
      }
      ctx.restore();
      return;
    }
    ctx.save();
    ctx.translate(d.x, d.y);
    ctx.fillStyle = 'rgba(0,0,0,0.18)';
    ctx.beginPath(); ctx.ellipse(3, 6, 46, 22, 0, 0, 7); ctx.fill();
    const piles = Math.max(1, Math.ceil(f * 5));
    for (let i = 0; i < piles; i++) {
      const px = (rng() - 0.5) * 62, py = (rng() - 0.5) * 40;
      const s = 0.7 + rng() * 0.6;
      // crate stack
      ctx.save(); ctx.translate(px, py);
      ctx.fillStyle = '#2c5a8a'; ctx.fillRect(-12 * s, -8 * s, 24 * s, 15 * s);
      ctx.fillStyle = '#3d7edb'; ctx.fillRect(-12 * s, -12 * s, 24 * s, 6 * s);
      ctx.strokeStyle = '#1c3a5a'; ctx.lineWidth = 1;
      ctx.strokeRect(-12 * s, -12 * s, 24 * s, 19 * s);
      ctx.beginPath(); ctx.moveTo(0, -12 * s); ctx.lineTo(0, 7 * s); ctx.stroke();
      ctx.restore();
    }
    ctx.restore();
  }

  /* ================= units ================= */
  function teamColors(e) {
    const p = game.players[e.owner];
    return p ? [p.color, p.colorDark] : ['#999', '#555'];
  }

  function drawUnit(u) {
    const [c1, c2] = teamColors(u);
    ctx.save();
    ctx.translate(u.x, u.y);

    // shadow (sun to the north-west)
    ctx.fillStyle = 'rgba(24,18,10,0.32)';
    ctx.beginPath(); ctx.ellipse(3.5, 4.5, u.radius * 1.1, u.radius * 0.62, 0, 0, 7); ctx.fill();

    // ground cloak readout (commandos, retrofits): dim while stealthed, bright when exposed
    if (!u.def.air && hasCloak(u)) {
      if (isStealthed(u)) ctx.globalAlpha = 0.42 + 0.09 * Math.sin(game.renderT * 5 + u.id);
      else ctx.globalAlpha = 1;
    }
    const ch = u.def.chassis;
    if (ch === 'inf' || ch === 'rocketinf') drawInfantry(u, c1, c2);
    else if (ch === 'commando') drawCommando(u, c1, c2);
    else {
      ctx.rotate(u.angle);
      // every vehicle model gets its own silhouette; chassis is only the fallback
      switch (u.key) {
        case 'bulwark': drawBulwark(u, c1, c2); break;
        case 'jackal': drawJackal(u, c1, c2); break;
        case 'warlord': drawWarlord(u, c1, c2); break;
        case 'goliath': drawGoliath(u, c1, c2); break;
        case 'viper': drawViper(u, c1, c2); break;
        case 'aegis': drawAegis(u, c1, c2); break;
        case 'flak': drawFlakTruck(u, c1, c2); break;
        case 'guntruck': drawGunTruck(u, c1, c2); break;
        case 'barrage': drawBarrageBuggy(u, c1, c2); break;
        case 'siege': drawSiegeGun(u, c1, c2); break;
        default: switch (ch) {
          case 'tank': drawTank(u, c1, c2, false); break;
          case 'heavytank': drawTank(u, c1, c2, true); break;
          case 'buggy': drawBuggy(u, c1, c2); break;
          case 'mlrs': drawMLRS(u, c1, c2); break;
          case 'flametank': drawFlameTank(u, c1, c2); break;
          case 'dozer': drawDozer(u, c1, c2); break;
          case 'truck': drawTruck(u, c1, c2); break;
          case 'demorig': drawDemoRig(u, c1, c2); break;
          case 'radar': drawRadarTruck(u, c1, c2); break;
          default: ctx.fillStyle = c1; ctx.fillRect(-10, -8, 20, 16);
        }
      }
    }
    ctx.restore();

    // damage smoke
    if (u.hp < u.maxHp * 0.5 && Math.random() < 0.1) FX.smokePuff(u.x, u.y - 6, 1, u.hp < u.maxHp * 0.25);
    drawHpBar(u);
  }

  function drawInfantry(u, c1, c2) {
    const t = game.renderT * 8;
    const bob = u.moving ? Math.sin(t + u.id) * 1.5 : 0;
    ctx.save();
    ctx.translate(0, bob * 0.4);
    // legs
    if (u.moving) {
      ctx.strokeStyle = '#2e2a20'; ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(-2, 2); ctx.lineTo(-2 + Math.sin(t + u.id) * 3, 7);
      ctx.moveTo(2, 2); ctx.lineTo(2 - Math.sin(t + u.id) * 3, 7);
      ctx.stroke();
    }
    // arms swing opposite the legs
    if (u.moving) {
      ctx.strokeStyle = '#3a352a'; ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.moveTo(-3, -1); ctx.lineTo(-4 - Math.sin(t + u.id) * 2.4, 3);
      ctx.moveTo(3, -1); ctx.lineTo(4 + Math.sin(t + u.id) * 2.4, 3);
      ctx.stroke();
    }
    // body
    ctx.fillStyle = c2;
    ctx.beginPath(); ctx.arc(0, 0, 4.6, 0, 7); ctx.fill();
    ctx.fillStyle = c1;
    ctx.beginPath(); ctx.arc(0, -1.5, 3.1, 0, 7); ctx.fill();
    // helmet
    ctx.fillStyle = '#d8cfa8';
    ctx.beginPath(); ctx.arc(0, -2.5, 2.1, 0, 7); ctx.fill();
    // weapon
    ctx.save();
    ctx.rotate(u.tAngle);
    ctx.strokeStyle = '#1c1a14'; ctx.lineWidth = u.def.chassis === 'rocketinf' ? 3 : 1.8;
    ctx.beginPath(); ctx.moveTo(2, 0); ctx.lineTo(u.def.chassis === 'rocketinf' ? 10 : 8, 0); ctx.stroke();
    ctx.restore();
    ctx.restore();
  }

  function drawCommando(u, c1, c2) {
    const t = game.renderT * 8;
    const bob = u.moving ? Math.sin(t + u.id) * 1.5 : 0;
    ctx.save();
    ctx.translate(0, bob * 0.4);
    if (u.moving) {
      ctx.strokeStyle = '#20242c'; ctx.lineWidth = 2.4;
      ctx.beginPath();
      ctx.moveTo(-2.4, 2); ctx.lineTo(-2.4 + Math.sin(t + u.id) * 3.4, 8);
      ctx.moveTo(2.4, 2); ctx.lineTo(2.4 - Math.sin(t + u.id) * 3.4, 8);
      ctx.stroke();
    }
    // armored bulk
    ctx.fillStyle = U.shade(c2, 0.8);
    ctx.beginPath(); ctx.arc(0, 0, 5.6, 0, 7); ctx.fill();
    ctx.fillStyle = U.shade(c1, 0.9);
    ctx.beginPath(); ctx.arc(0, -1.6, 3.8, 0, 7); ctx.fill();
    // shoulder plates
    ctx.fillStyle = '#2c3038';
    ctx.beginPath(); ctx.ellipse(-3.4, 0.5, 1.8, 2.4, 0, 0, 7); ctx.fill();
    ctx.beginPath(); ctx.ellipse(3.4, 0.5, 1.8, 2.4, 0, 0, 7); ctx.fill();
    // black ops helmet with glowing visor slit
    ctx.fillStyle = '#1c2026';
    ctx.beginPath(); ctx.arc(0, -2.8, 2.7, 0, 7); ctx.fill();
    ctx.fillStyle = isStealthed(u) ? '#6fe0c8' : '#ff9c50';
    ctx.fillRect(-1.8, -3.4, 3.6, 1.1);
    // long marksman rifle
    ctx.save();
    ctx.rotate(u.tAngle);
    ctx.strokeStyle = '#10141a'; ctx.lineWidth = 2.2;
    ctx.beginPath(); ctx.moveTo(2, 0); ctx.lineTo(13, 0); ctx.stroke();
    ctx.strokeStyle = '#3c424e'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(6, -1.6); ctx.lineTo(9, -1.6); ctx.stroke();
    ctx.restore();
    ctx.restore();
  }

  function drawTank(u, c1, c2, heavy) {
    const w = heavy ? 30 : 24, h = heavy ? 22 : 17;
    // treads
    ctx.fillStyle = '#26231c';
    ctx.fillRect(-w / 2, -h / 2, w, 5);
    ctx.fillRect(-w / 2, h / 2 - 5, w, 5);
    // rolling tread links
    ctx.fillStyle = '#3c382c';
    const off = (u.treadOff = ((u.treadOff || 0) + (u.moving ? 1 : 0))) % 6;
    for (let x = -w / 2 + off % 6; x < w / 2; x += 6) {
      ctx.fillRect(x, -h / 2, 2, 5); ctx.fillRect(x, h / 2 - 5, 2, 5);
    }
    // road wheels
    ctx.fillStyle = '#171510';
    for (let i = 0; i < (heavy ? 4 : 3); i++) {
      const wx = -w / 2 + 5 + i * (w - 10) / (heavy ? 3 : 2);
      ctx.beginPath(); ctx.arc(wx, -h / 2 + 2.5, 1.7, 0, 7); ctx.fill();
      ctx.beginPath(); ctx.arc(wx, h / 2 - 2.5, 1.7, 0, 7); ctx.fill();
    }
    // hull
    const g = ctx.createLinearGradient(0, -h / 2, 0, h / 2);
    g.addColorStop(0, U.shade(c1, 1.15)); g.addColorStop(0.5, c1); g.addColorStop(1, c2);
    ctx.fillStyle = g;
    roundRect(-w / 2 + 2, -h / 2 + 3, w - 4, h - 6, 3); ctx.fill();
    ctx.strokeStyle = c2; ctx.lineWidth = 1; roundRect(-w / 2 + 2, -h / 2 + 3, w - 4, h - 6, 3); ctx.stroke();
    // hull panel line + engine deck
    ctx.strokeStyle = 'rgba(0,0,0,0.25)'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(-w * 0.32, -h / 2 + 4); ctx.lineTo(-w * 0.32, h / 2 - 4); ctx.stroke();
    ctx.fillStyle = 'rgba(0,0,0,0.14)';
    ctx.fillRect(-w / 2 + 3, -h / 2 + 4.5, w * 0.16, h - 9);
    // turret
    ctx.save();
    ctx.rotate(U.angDiff(u.angle, u.tAngle));
    const rec = (u.recoil = Math.max(0, (u.recoil || 0) - 0.08));
    ctx.fillStyle = U.shade(c1, 1.25);
    ctx.beginPath(); ctx.arc(0, 0, heavy ? 9 : 7, 0, 7); ctx.fill();
    ctx.strokeStyle = c2; ctx.stroke();
    // turret highlight + antenna
    ctx.fillStyle = 'rgba(255,246,220,0.25)';
    ctx.beginPath(); ctx.arc(-2, -2, heavy ? 4 : 3, 0, 7); ctx.fill();
    ctx.strokeStyle = '#1c1a14'; ctx.lineWidth = 0.8;
    ctx.beginPath(); ctx.moveTo(-4, 3); ctx.lineTo(-10, 8); ctx.stroke();
    ctx.fillStyle = '#22201a';
    if (heavy) {
      ctx.fillRect(2 - rec * 4, -3.4, 20, 2.6);
      ctx.fillRect(2 - rec * 4, 0.8, 20, 2.6);
    } else {
      ctx.fillRect(2 - rec * 4, -1.4, 19, 2.8);
    }
    ctx.restore();
  }

  function drawBuggy(u, c1, c2) {
    // wheels
    ctx.fillStyle = '#1c1a14';
    for (const wx of [-8, 6]) for (const wy of [-8, 8]) {
      ctx.beginPath(); ctx.ellipse(wx, wy, 4, 2.6, 0, 0, 7); ctx.fill();
    }
    const g = ctx.createLinearGradient(0, -8, 0, 8);
    g.addColorStop(0, U.shade(c1, 1.2)); g.addColorStop(1, c2);
    ctx.fillStyle = g;
    roundRect(-11, -7, 22, 14, 4); ctx.fill();
    ctx.strokeStyle = c2; roundRect(-11, -7, 22, 14, 4); ctx.stroke();
    // windshield
    ctx.fillStyle = '#a8c8d8';
    ctx.fillRect(3, -4, 4, 8);
    // gun mount
    ctx.save();
    ctx.rotate(U.angDiff(u.angle, u.tAngle));
    ctx.fillStyle = '#2c2a22';
    ctx.beginPath(); ctx.arc(-2, 0, 4, 0, 7); ctx.fill();
    ctx.fillRect(0, -2.2, 13, 1.6);
    ctx.fillRect(0, 0.6, 13, 1.6);
    ctx.restore();
  }

  function drawMLRS(u, c1, c2) {
    ctx.fillStyle = '#1c1a14';
    for (const wx of [-10, 0, 9]) for (const wy of [-8, 8]) {
      ctx.beginPath(); ctx.ellipse(wx, wy, 3.6, 2.4, 0, 0, 7); ctx.fill();
    }
    const g = ctx.createLinearGradient(0, -8, 0, 8);
    g.addColorStop(0, U.shade(c1, 1.15)); g.addColorStop(1, c2);
    ctx.fillStyle = g;
    roundRect(-14, -7, 28, 14, 3); ctx.fill();
    // launcher box (tilted look via offset)
    ctx.save();
    ctx.rotate(U.angDiff(u.angle, u.tAngle));
    ctx.fillStyle = U.shade(c2, 1.3);
    roundRect(-6, -6, 18, 12, 2); ctx.fill();
    ctx.fillStyle = '#14120e';
    for (let ry = -4; ry <= 3; ry += 3.4)
      for (let rx = 0; rx <= 8; rx += 4.2)
        ctx.fillRect(rx + 1, ry, 2.6, 2.2);
    ctx.restore();
  }

  function drawFlameTank(u, c1, c2) {
    drawTank(u, c1, c2, false);
    // fuel tanks
    ctx.fillStyle = '#8a4a1c';
    ctx.beginPath(); ctx.ellipse(-8, -6, 4, 2.6, 0, 0, 7); ctx.fill();
    ctx.beginPath(); ctx.ellipse(-8, 6, 4, 2.6, 0, 0, 7); ctx.fill();
  }

  /* shared tracked-vehicle base: treads, rolling links, road wheels */
  function tankTreads(u, w, h, wheels, tw = 5) {
    ctx.fillStyle = '#26231c';
    ctx.fillRect(-w / 2, -h / 2, w, tw);
    ctx.fillRect(-w / 2, h / 2 - tw, w, tw);
    ctx.fillStyle = '#3c382c';
    const off = (u.treadOff = ((u.treadOff || 0) + (u.moving ? 1 : 0))) % 6;
    for (let x = -w / 2 + off % 6; x < w / 2; x += 6) {
      ctx.fillRect(x, -h / 2, 2, tw); ctx.fillRect(x, h / 2 - tw, 2, tw);
    }
    ctx.fillStyle = '#171510';
    for (let i = 0; i < wheels; i++) {
      const wx = -w / 2 + 5 + i * (w - 10) / (wheels - 1);
      ctx.beginPath(); ctx.arc(wx, -h / 2 + tw / 2, 1.7, 0, 7); ctx.fill();
      ctx.beginPath(); ctx.arc(wx, h / 2 - tw / 2, 1.7, 0, 7); ctx.fill();
    }
  }
  function hullPlate(w, h, c1, c2, r = 3) {
    const g = ctx.createLinearGradient(0, -h / 2, 0, h / 2);
    g.addColorStop(0, U.shade(c1, 1.15)); g.addColorStop(0.5, c1); g.addColorStop(1, c2);
    ctx.fillStyle = g;
    roundRect(-w / 2 + 2, -h / 2 + 3, w - 4, h - 6, r); ctx.fill();
    ctx.strokeStyle = c2; ctx.lineWidth = 1;
    roundRect(-w / 2 + 2, -h / 2 + 3, w - 4, h - 6, r); ctx.stroke();
  }

  /* Bulwark — modern MBT: angular wedge hull, hexagonal turret, one long gun w/ muzzle brake */
  function drawBulwark(u, c1, c2) {
    tankTreads(u, 25, 18, 3);
    hullPlate(25, 18, c1, c2, 2);
    // wedge glacis
    ctx.fillStyle = 'rgba(255,246,220,0.20)';
    ctx.beginPath(); ctx.moveTo(6, -5.5); ctx.lineTo(11.5, -2); ctx.lineTo(11.5, 2); ctx.lineTo(6, 5.5); ctx.closePath(); ctx.fill();
    ctx.fillStyle = 'rgba(0,0,0,0.16)'; ctx.fillRect(-10.5, -5.5, 4, 11);   // engine deck
    ctx.save();
    ctx.rotate(U.angDiff(u.angle, u.tAngle));
    const rec = (u.recoil = Math.max(0, (u.recoil || 0) - 0.08));
    // hexagonal low-profile turret
    ctx.fillStyle = U.shade(c1, 1.25); ctx.strokeStyle = c2; ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(6.5, 0); ctx.lineTo(3, -5.5); ctx.lineTo(-4.5, -5.5); ctx.lineTo(-7, 0);
    ctx.lineTo(-4.5, 5.5); ctx.lineTo(3, 5.5); ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.fillStyle = 'rgba(255,246,220,0.25)';
    ctx.beginPath(); ctx.moveTo(3.5, -1.8); ctx.lineTo(1, -4); ctx.lineTo(-3.5, -4); ctx.lineTo(-3.5, -1.8); ctx.closePath(); ctx.fill();
    // long gun + muzzle brake
    ctx.fillStyle = '#22201a';
    ctx.fillRect(4 - rec * 4, -1.3, 18, 2.6);
    ctx.fillRect(20 - rec * 4, -2, 3.2, 4);
    // commander hatch + antenna
    ctx.fillStyle = U.shade(c1, 0.8);
    ctx.beginPath(); ctx.arc(-2.5, 2.5, 1.8, 0, 7); ctx.fill();
    ctx.strokeStyle = '#1c1a14'; ctx.lineWidth = 0.8;
    ctx.beginPath(); ctx.moveTo(-4, -3); ctx.lineTo(-10, -8); ctx.stroke();
    ctx.restore();
  }

  /* Jackal — scrappy light tank: rounded welded turret set back, stubby gun, stowage */
  function drawJackal(u, c1, c2) {
    tankTreads(u, 22, 15, 3, 4);
    hullPlate(22, 15, c1, c2, 4);
    // welded patch + spare wheel on the front hull
    ctx.fillStyle = 'rgba(0,0,0,0.2)'; ctx.fillRect(5, -4, 5, 3.4);
    ctx.strokeStyle = 'rgba(60,50,30,0.8)'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.arc(8, 3, 2.6, 0, 7); ctx.stroke();
    // strapped crates hanging off the back
    ctx.fillStyle = '#7a6a44'; ctx.fillRect(-12.5, -3, 3.4, 6);
    ctx.strokeStyle = '#3a3222'; ctx.strokeRect(-12.5, -3, 3.4, 6);
    ctx.save();
    ctx.rotate(U.angDiff(u.angle, u.tAngle));
    const rec = (u.recoil = Math.max(0, (u.recoil || 0) - 0.08));
    // small round turret sits aft
    ctx.fillStyle = U.shade(c1, 1.22);
    ctx.beginPath(); ctx.arc(-2, 0, 5.2, 0, 7); ctx.fill();
    ctx.strokeStyle = c2; ctx.stroke();
    // weld-bead ring + bolts
    ctx.fillStyle = '#1c1a14';
    for (let i = 0; i < 5; i++) {
      const a = i * Math.PI * 2 / 5 + 0.5;
      ctx.beginPath(); ctx.arc(-2 + Math.cos(a) * 3.6, Math.sin(a) * 3.6, 0.7, 0, 7); ctx.fill();
    }
    // stubby gun
    ctx.fillStyle = '#22201a';
    ctx.fillRect(2 - rec * 3, -1.5, 12, 3);
    ctx.restore();
  }

  /* Warlord — brutal twin-cannon heavy: wide hull, dozer plow, exhaust stacks */
  function drawWarlord(u, c1, c2) {
    tankTreads(u, 30, 23, 4);
    hullPlate(30, 23, c1, c2, 3);
    // front dozer plow
    ctx.fillStyle = '#5c564a';
    ctx.beginPath(); ctx.moveTo(14, -10); ctx.lineTo(18, -7); ctx.lineTo(18, 7); ctx.lineTo(14, 10); ctx.closePath(); ctx.fill();
    ctx.fillStyle = 'rgba(0,0,0,0.3)'; ctx.fillRect(16.5, -7, 1.5, 14);
    // twin exhaust stacks puffing when moving
    ctx.fillStyle = '#2c2a22';
    ctx.fillRect(-13, -8, 2.6, 4); ctx.fillRect(-13, 4, 2.6, 4);
    if (u.moving && Math.random() < 0.12) FX.smokePuff(u.x - Math.cos(u.angle) * 14, u.y - Math.sin(u.angle) * 14, 0.8, true);
    ctx.save();
    ctx.rotate(U.angDiff(u.angle, u.tAngle));
    const rec = (u.recoil = Math.max(0, (u.recoil || 0) - 0.08));
    // broad octagonal turret
    ctx.fillStyle = U.shade(c1, 1.25); ctx.strokeStyle = c2; ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(8, -3.6); ctx.lineTo(4, -8); ctx.lineTo(-5, -8); ctx.lineTo(-9, -3.6);
    ctx.lineTo(-9, 3.6); ctx.lineTo(-5, 8); ctx.lineTo(4, 8); ctx.lineTo(8, 3.6); ctx.closePath();
    ctx.fill(); ctx.stroke();
    ctx.fillStyle = 'rgba(255,246,220,0.22)';
    ctx.beginPath(); ctx.arc(-2, -2.5, 3.2, 0, 7); ctx.fill();
    // twin cannons
    ctx.fillStyle = '#22201a';
    ctx.fillRect(6 - rec * 4, -4.2, 21, 2.8);
    ctx.fillRect(6 - rec * 4, 1.4, 21, 2.8);
    ctx.fillRect(24 - rec * 4, -4.6, 2.6, 3.4); ctx.fillRect(24 - rec * 4, 1.2, 2.6, 3.4);
    ctx.restore();
  }

  /* Goliath — end-game superheavy: quad treads, huge turret, monster gun, rear vents */
  function drawGoliath(u, c1, c2) {
    // outer + inner tread pairs
    tankTreads(u, 38, 30, 5, 6);
    ctx.fillStyle = '#2e2b22';
    ctx.fillRect(-19, -9, 38, 4.4); ctx.fillRect(-19, 4.6, 38, 4.4);
    hullPlate(38, 26, c1, c2, 3);
    // glowing engine vents at the rear
    const vg = 0.5 + 0.4 * Math.sin(game.renderT * 6 + u.id);
    ctx.fillStyle = `rgba(255,150,60,${vg})`;
    ctx.fillRect(-17.5, -6, 2.2, 3.4); ctx.fillRect(-17.5, 2.6, 2.2, 3.4);
    // armored skirt line
    ctx.strokeStyle = 'rgba(0,0,0,0.3)'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(-14, -9.5); ctx.lineTo(14, -9.5); ctx.moveTo(-14, 9.5); ctx.lineTo(14, 9.5); ctx.stroke();
    ctx.save();
    ctx.rotate(U.angDiff(u.angle, u.tAngle));
    const rec = (u.recoil = Math.max(0, (u.recoil || 0) - 0.08));
    // massive angular turret
    ctx.fillStyle = U.shade(c1, 1.28); ctx.strokeStyle = c2; ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(10, -4.5); ctx.lineTo(5, -9.5); ctx.lineTo(-7, -9.5); ctx.lineTo(-11, -4.5);
    ctx.lineTo(-11, 4.5); ctx.lineTo(-7, 9.5); ctx.lineTo(5, 9.5); ctx.lineTo(10, 4.5); ctx.closePath();
    ctx.fill(); ctx.stroke();
    ctx.fillStyle = 'rgba(255,246,220,0.22)';
    ctx.beginPath(); ctx.moveTo(4, -3); ctx.lineTo(1, -6.5); ctx.lineTo(-5, -6.5); ctx.lineTo(-5, -3); ctx.closePath(); ctx.fill();
    // monster cannon with double baffle
    ctx.fillStyle = '#1e1c16';
    ctx.fillRect(8 - rec * 5, -2, 26, 4);
    ctx.fillRect(26 - rec * 5, -2.8, 3, 5.6);
    ctx.fillRect(31 - rec * 5, -2.8, 3, 5.6);
    // secondary mini-turret
    ctx.fillStyle = U.shade(c1, 0.9);
    ctx.beginPath(); ctx.arc(-6.5, 5, 2.6, 0, 7); ctx.fill();
    ctx.fillStyle = '#22201a'; ctx.fillRect(-6.5, 4.2, 7, 1.6);
    // twin antennas
    ctx.strokeStyle = '#1c1a14'; ctx.lineWidth = 0.9;
    ctx.beginPath(); ctx.moveTo(-8, -6); ctx.lineTo(-15, -12); ctx.moveTo(-9, -4); ctx.lineTo(-17, -7); ctx.stroke();
    ctx.restore();
  }

  /* Aegis — elite AA tank: wide tracked hull, quad autocannon turret, tracking dish */
  function drawAegis(u, c1, c2) {
    tankTreads(u, 28, 21, 4);
    hullPlate(28, 21, c1, c2, 3);
    // hull intake grills
    ctx.fillStyle = 'rgba(0,0,0,0.18)';
    ctx.fillRect(8, -6, 4, 4.4); ctx.fillRect(8, 1.6, 4, 4.4);
    ctx.save();
    ctx.rotate(U.angDiff(u.angle, u.tAngle));
    // wide flat turret
    ctx.fillStyle = U.shade(c1, 1.25); ctx.strokeStyle = c2; ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(7, -4); ctx.lineTo(3, -7.5); ctx.lineTo(-7, -7.5); ctx.lineTo(-10, -4);
    ctx.lineTo(-10, 4); ctx.lineTo(-7, 7.5); ctx.lineTo(3, 7.5); ctx.lineTo(7, 4); ctx.closePath();
    ctx.fill(); ctx.stroke();
    ctx.fillStyle = 'rgba(255,246,220,0.22)';
    ctx.beginPath(); ctx.arc(-2, -3, 2.8, 0, 7); ctx.fill();
    // quad AA autocannons — two pairs, slightly splayed skyward
    ctx.fillStyle = '#1e1c16';
    for (const by of [-5.4, -2.6, 2.6, 5.4]) ctx.fillRect(4, by - 0.9, 16, 1.8);
    ctx.fillStyle = '#3a362c';
    for (const by of [-5.4, -2.6, 2.6, 5.4]) ctx.fillRect(18, by - 1.2, 2.4, 2.4);   // muzzle brakes
    // spinning tracking dish on the turret rear
    ctx.save();
    ctx.translate(-6.5, 0);
    ctx.rotate(-(U.angDiff(u.angle, u.tAngle)) - u.angle + game.renderT * 3.4);
    ctx.fillStyle = '#c8d0d8';
    ctx.beginPath(); ctx.ellipse(0, 0, 4.4, 2.6, 0, 0, 7); ctx.fill();
    ctx.strokeStyle = '#788088'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(4.6, 0); ctx.stroke();
    ctx.restore();
    // blinking track light
    if (Math.floor(game.renderT * 4) % 2) {
      ctx.fillStyle = '#7fd4ff';
      ctx.beginPath(); ctx.arc(-6.5, 0, 1.3, 0, 7); ctx.fill();
    }
    ctx.restore();
  }

  /* Viper — coalition AA: buggy with twin gatling pods + small spinning sensor */
  function drawViper(u, c1, c2) {
    drawBuggy(u, c1, c2);
    ctx.save();
    ctx.rotate(-u.angle + game.renderT * 2.4);
    ctx.fillStyle = '#c8d0d8';
    ctx.beginPath(); ctx.ellipse(-7, -5, 3, 1.6, 0, 0, 7); ctx.fill();
    ctx.restore();
  }

  /* Quad Flak — dynasty AA: boxy halftrack, 2×2 short flak barrels on a rotating mount */
  function drawFlakTruck(u, c1, c2) {
    ctx.fillStyle = '#1c1a14';
    for (const wx of [8]) for (const wy of [-8, 8]) {
      ctx.beginPath(); ctx.ellipse(wx, wy, 3.6, 2.6, 0, 0, 7); ctx.fill();
    }
    // rear half-tracks
    ctx.fillStyle = '#26231c';
    ctx.fillRect(-12, -9.5, 14, 4); ctx.fillRect(-12, 5.5, 14, 4);
    const g = ctx.createLinearGradient(0, -8, 0, 8);
    g.addColorStop(0, U.shade(c1, 1.18)); g.addColorStop(1, c2);
    ctx.fillStyle = g;
    roundRect(-12, -7, 24, 14, 3); ctx.fill();
    ctx.strokeStyle = c2; roundRect(-12, -7, 24, 14, 3); ctx.stroke();
    ctx.fillStyle = '#a8c8d8'; ctx.fillRect(7, -4, 3.4, 8);   // cab glass
    ctx.save();
    ctx.rotate(U.angDiff(u.angle, u.tAngle));
    // quad mount: 2×2 short fat barrels
    ctx.fillStyle = U.shade(c1, 1.3);
    ctx.beginPath(); ctx.arc(-2, 0, 4.6, 0, 7); ctx.fill();
    ctx.strokeStyle = c2; ctx.stroke();
    ctx.fillStyle = '#22201a';
    for (const by of [-3.4, -1.1, 1.1, 3.4]) ctx.fillRect(1, by - 0.8, 9, 1.6);
    // gunner seat
    ctx.fillStyle = '#2c2a22'; ctx.fillRect(-7, -2, 3, 4);
    ctx.restore();
  }

  /* Gun Truck — cartel pickup: cab forward, open bed, roll-bar MG */
  function drawGunTruck(u, c1, c2) {
    ctx.fillStyle = '#1c1a14';
    for (const wx of [-8, 7]) for (const wy of [-7.5, 7.5]) {
      ctx.beginPath(); ctx.ellipse(wx, wy, 3.6, 2.5, 0, 0, 7); ctx.fill();
    }
    // open cargo bed (dark) with side rails
    ctx.fillStyle = '#4a4438';
    roundRect(-13, -6.5, 13, 13, 2); ctx.fill();
    ctx.strokeStyle = '#2c2a22'; ctx.lineWidth = 1.4;
    roundRect(-13, -6.5, 13, 13, 2); ctx.stroke();
    // cab + hood up front, battered paint
    const g = ctx.createLinearGradient(0, -7, 0, 7);
    g.addColorStop(0, U.shade(c1, 1.25)); g.addColorStop(1, c2);
    ctx.fillStyle = g;
    roundRect(0, -7, 14, 14, 3); ctx.fill();
    ctx.strokeStyle = c2; roundRect(0, -7, 14, 14, 3); ctx.stroke();
    ctx.fillStyle = '#a8c8d8'; ctx.fillRect(2.5, -5, 3.4, 10);
    ctx.fillStyle = 'rgba(0,0,0,0.18)'; ctx.fillRect(9, -5, 4, 10); // hood vents
    // roll bar
    ctx.strokeStyle = '#2c2a22'; ctx.lineWidth = 1.6;
    ctx.beginPath(); ctx.moveTo(-1, -6.5); ctx.lineTo(-1, 6.5); ctx.stroke();
    ctx.save();
    ctx.rotate(U.angDiff(u.angle, u.tAngle));
    // pintle MG with ammo box
    ctx.fillStyle = '#2c2a22';
    ctx.beginPath(); ctx.arc(-5, 0, 3, 0, 7); ctx.fill();
    ctx.fillRect(-4, -1.1, 13, 2.2);
    ctx.fillStyle = '#6e5710'; ctx.fillRect(-8, -3.4, 3, 3);
    ctx.restore();
  }

  /* Barrage Buggy — light frame, three angled rocket rails */
  function drawBarrageBuggy(u, c1, c2) {
    ctx.fillStyle = '#1c1a14';
    for (const wx of [-9, 8]) for (const wy of [-7.5, 7.5]) {
      ctx.beginPath(); ctx.ellipse(wx, wy, 3.8, 2.6, 0, 0, 7); ctx.fill();
    }
    const g = ctx.createLinearGradient(0, -7, 0, 7);
    g.addColorStop(0, U.shade(c1, 1.15)); g.addColorStop(1, c2);
    ctx.fillStyle = g;
    roundRect(-12, -6.5, 24, 13, 3); ctx.fill();
    ctx.strokeStyle = c2; roundRect(-12, -6.5, 24, 13, 3); ctx.stroke();
    ctx.fillStyle = '#a8c8d8'; ctx.fillRect(7, -3.5, 3.4, 7);
    ctx.save();
    ctx.rotate(U.angDiff(u.angle, u.tAngle));
    // three exposed rocket rails angled upward (drawn as splayed tubes)
    for (const [ry, rl] of [[-4.4, 12], [0, 14], [4.4, 12]]) {
      ctx.fillStyle = '#3c382c'; ctx.fillRect(-8, ry - 1.4, rl, 2.8);
      ctx.fillStyle = '#c94b2f';                        // rocket tips
      ctx.beginPath(); ctx.moveTo(-8 + rl, ry - 1.4); ctx.lineTo(-8 + rl + 3, ry); ctx.lineTo(-8 + rl, ry + 1.4); ctx.closePath(); ctx.fill();
    }
    ctx.restore();
  }

  /* Siege platform — huge tracked gun: wide chassis, enormous barrel, rear recoil spades */
  function drawSiegeGun(u, c1, c2) {
    tankTreads(u, 32, 24, 4, 6);
    hullPlate(32, 22, c1, c2, 2);
    // rear stabilizer spades
    ctx.fillStyle = '#5c564a';
    ctx.beginPath(); ctx.moveTo(-16, -8); ctx.lineTo(-21, -10); ctx.lineTo(-21, -5); ctx.closePath(); ctx.fill();
    ctx.beginPath(); ctx.moveTo(-16, 8); ctx.lineTo(-21, 10); ctx.lineTo(-21, 5); ctx.closePath(); ctx.fill();
    ctx.save();
    ctx.rotate(U.angDiff(u.angle, u.tAngle));
    const rec = (u.recoil = Math.max(0, (u.recoil || 0) - 0.05));
    // gun cradle
    ctx.fillStyle = U.shade(c1, 1.2); ctx.strokeStyle = c2; ctx.lineWidth = 1;
    roundRect(-9, -5.5, 15, 11, 2); ctx.fill();
    roundRect(-9, -5.5, 15, 11, 2); ctx.stroke();
    // colossal barrel — longest gun in the game
    ctx.fillStyle = '#1e1c16';
    ctx.fillRect(4 - rec * 7, -2.2, 30, 4.4);
    ctx.fillStyle = '#3a362c';
    ctx.fillRect(4 - rec * 7, -2.2, 6, 4.4);            // reinforced breech collar
    ctx.fillRect(30 - rec * 7, -3.2, 4.5, 6.4);         // huge muzzle brake
    // elevation pistons
    ctx.strokeStyle = '#2c2a22'; ctx.lineWidth = 1.6;
    ctx.beginPath(); ctx.moveTo(-4, -4.5); ctx.lineTo(6, -2.6); ctx.moveTo(-4, 4.5); ctx.lineTo(6, 2.6); ctx.stroke();
    ctx.restore();
  }

  function drawDozer(u, c1, c2) {
    ctx.fillStyle = '#26231c';
    ctx.fillRect(-11, -9, 22, 5); ctx.fillRect(-11, 4, 22, 5);
    const g = ctx.createLinearGradient(0, -8, 0, 8);
    g.addColorStop(0, '#e8c33c'); g.addColorStop(1, '#a8862a');
    ctx.fillStyle = g;
    roundRect(-9, -6, 18, 12, 2); ctx.fill();
    ctx.fillStyle = c1; ctx.fillRect(-8, -5, 5, 10); // faction stripe
    // cab
    ctx.fillStyle = '#3c382c'; ctx.fillRect(-4, -4, 7, 8);
    ctx.fillStyle = '#a8c8d8'; ctx.fillRect(-3, -3, 5, 6);
    // blade
    ctx.fillStyle = '#8a8578';
    ctx.fillRect(9, -9, 3, 18);
    ctx.fillStyle = '#6a6558';
    ctx.fillRect(11, -9, 1.6, 18);
  }

  function drawTruck(u, c1, c2) {
    ctx.fillStyle = '#1c1a14';
    for (const wx of [-11, -3, 8]) for (const wy of [-8, 8]) {
      ctx.beginPath(); ctx.ellipse(wx, wy, 3.6, 2.4, 0, 0, 7); ctx.fill();
    }
    // bed
    ctx.fillStyle = '#5c564a';
    roundRect(-15, -7, 20, 14, 2); ctx.fill();
    if (u.carrying > 0) {
      ctx.fillStyle = '#3d7edb'; ctx.fillRect(-13, -5, 7, 10);
      ctx.fillStyle = '#2c5a8a'; ctx.fillRect(-5, -5, 7, 10);
    }
    // cab
    const g = ctx.createLinearGradient(0, -7, 0, 7);
    g.addColorStop(0, U.shade(c1, 1.2)); g.addColorStop(1, c2);
    ctx.fillStyle = g;
    roundRect(5, -7, 10, 14, 3); ctx.fill();
    ctx.fillStyle = '#a8c8d8'; ctx.fillRect(11, -5, 3, 10);
  }

  function drawRadarTruck(u, c1, c2) {
    // buggy body with a spinning satellite dish
    ctx.fillStyle = '#1c1a14';
    for (const wx of [-8, 6]) for (const wy of [-8, 8]) {
      ctx.beginPath(); ctx.ellipse(wx, wy, 4, 2.6, 0, 0, 7); ctx.fill();
    }
    const g = ctx.createLinearGradient(0, -8, 0, 8);
    g.addColorStop(0, U.shade(c1, 1.2)); g.addColorStop(1, c2);
    ctx.fillStyle = g;
    roundRect(-11, -7, 22, 14, 4); ctx.fill();
    ctx.strokeStyle = c2; roundRect(-11, -7, 22, 14, 4); ctx.stroke();
    ctx.fillStyle = '#a8c8d8'; ctx.fillRect(5, -4, 4, 8);
    // rotating dish
    ctx.save();
    ctx.rotate(-u.angle + game.renderT * 1.6);
    ctx.fillStyle = '#c8d0d8';
    ctx.beginPath(); ctx.ellipse(0, 0, 7.5, 4.5, 0, 0, 7); ctx.fill();
    ctx.strokeStyle = '#788088'; ctx.lineWidth = 1.2;
    ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(8, 0); ctx.stroke();
    ctx.fillStyle = Math.floor(game.renderT * 3) % 2 ? '#7fd4ff' : '#4a90d8';
    ctx.beginPath(); ctx.arc(8, 0, 1.8, 0, 7); ctx.fill();
    ctx.restore();
  }

  function drawDemoRig(u, c1, c2) {
    ctx.fillStyle = '#1c1a14';
    for (const wx of [-6, 6]) for (const wy of [-7, 7]) {
      ctx.beginPath(); ctx.ellipse(wx, wy, 3.4, 2.4, 0, 0, 7); ctx.fill();
    }
    const g = ctx.createLinearGradient(0, -6, 0, 6);
    g.addColorStop(0, U.shade(c1, 1.15)); g.addColorStop(1, c2);
    ctx.fillStyle = g;
    roundRect(-10, -6, 20, 12, 3); ctx.fill();
    // explosives
    ctx.fillStyle = '#8a2a1c';
    ctx.fillRect(-7, -4, 5, 8); ctx.fillRect(-1, -4, 5, 8);
    // blinking light
    if (Math.floor(game.renderT * 6) % 2) {
      ctx.fillStyle = '#ff3020';
      ctx.beginPath(); ctx.arc(6, 0, 2.4, 0, 7); ctx.fill();
    }
  }

  function drawHeli(u) {
    const [c1, c2] = teamColors(u);
    // shadow far below
    ctx.fillStyle = 'rgba(0,0,0,0.22)';
    ctx.beginPath(); ctx.ellipse(u.x + 22, u.y + 30, 15, 6, u.angle, 0, 7); ctx.fill();
    ctx.save();
    ctx.translate(u.x, u.y);
    ctx.rotate(u.angle);
    const g = ctx.createLinearGradient(0, -10, 0, 10);
    g.addColorStop(0, U.shade(c1, 1.25)); g.addColorStop(1, c2);
    // fat fuselage with tail boom
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(14, 0);
    ctx.quadraticCurveTo(14, -8, 4, -8); ctx.lineTo(-6, -6.5);
    ctx.lineTo(-19, -2.4); ctx.lineTo(-19, 2.4); ctx.lineTo(-6, 6.5);
    ctx.lineTo(4, 8); ctx.quadraticCurveTo(14, 8, 14, 0);
    ctx.closePath(); ctx.fill();
    ctx.strokeStyle = c2; ctx.lineWidth = 1; ctx.stroke();
    // tail fin + tail rotor
    ctx.fillStyle = U.shade(c1, 0.9);
    ctx.beginPath(); ctx.moveTo(-16, -1.6); ctx.lineTo(-21, -6); ctx.lineTo(-19, 0); ctx.closePath(); ctx.fill();
    ctx.save();
    ctx.translate(-20, -3);
    ctx.rotate(game.renderT * 24);
    ctx.strokeStyle = 'rgba(30,28,22,0.8)'; ctx.lineWidth = 1.2;
    ctx.beginPath(); ctx.moveTo(-3.5, 0); ctx.lineTo(3.5, 0); ctx.stroke();
    ctx.restore();
    // side doors
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    ctx.fillRect(-2, -7.5, 7, 2); ctx.fillRect(-2, 5.5, 7, 2);
    // cockpit glass
    ctx.fillStyle = '#b8d8e8';
    ctx.beginPath(); ctx.ellipse(9, 0, 4.2, 3.4, 0, 0, 7); ctx.fill();
    // main rotor: spinning blades + translucent disc
    ctx.fillStyle = 'rgba(120,120,120,0.13)';
    ctx.beginPath(); ctx.arc(0, 0, 24, 0, 7); ctx.fill();
    ctx.save();
    ctx.rotate(game.renderT * 17);
    ctx.strokeStyle = 'rgba(30,28,22,0.75)'; ctx.lineWidth = 1.8;
    ctx.beginPath();
    ctx.moveTo(-23, 0); ctx.lineTo(23, 0);
    ctx.moveTo(0, -23); ctx.lineTo(0, 23);
    ctx.stroke();
    ctx.restore();
    ctx.restore();
    // cargo readout
    if (u.cargo && u.cargo.length && u.owner === 0) {
      ctx.font = 'bold 10px system-ui';
      ctx.textAlign = 'center';
      ctx.fillStyle = '#c9e8a0';
      ctx.fillText(u.cargo.length + '/' + u.def.capacity, u.x, u.y - 26);
    }
    drawHpBar(u);
  }

  function drawJet(u) {
    const [c1, c2] = teamColors(u);
    // shadow far below
    ctx.fillStyle = 'rgba(0,0,0,0.22)';
    ctx.beginPath(); ctx.ellipse(u.x + 26, u.y + 34, 13, 5, u.angle, 0, 7); ctx.fill();

    ctx.save();
    ctx.translate(u.x, u.y);
    ctx.rotate(u.angle);
    if (hasCloak(u)) {
      // cloak state readout: dim while stealthed, fully bright while decloaked
      if (isStealthed(u)) ctx.globalAlpha = 0.38 + 0.09 * Math.sin(game.renderT * 5 + u.id);
      else {
        ctx.globalAlpha = 1;
        // hot decloak ring so the state flip is unmistakable
        ctx.strokeStyle = `rgba(255,200,90,${0.5 + 0.3 * Math.sin(game.renderT * 10)})`;
        ctx.lineWidth = 1.6;
        ctx.beginPath(); ctx.arc(0, 0, 22, 0, 7); ctx.stroke();
      }
    }
    // bank into turns
    const turn = U.angDiff(u._prevA === undefined ? u.angle : u._prevA, u.angle);
    u._prevA = u.angle;
    u._bank = U.lerp(u._bank || 0, U.clamp(turn * 22, -0.5, 0.5), 0.15);
    ctx.scale(1, 1 - Math.abs(u._bank));
    const burning = u.jetState === 'attack' || u.jetState === 'moveto' || u.jetState === 'return';
    const g = ctx.createLinearGradient(0, -10, 0, 10);
    g.addColorStop(0, U.shade(c1, 1.3)); g.addColorStop(1, c2);
    ctx.fillStyle = g;
    ctx.strokeStyle = c2; ctx.lineWidth = 1;
    const flame = a => `rgba(255,180,80,${a * (0.5 + 0.4 * Math.sin(game.renderT * 40))})`;

    switch (u.key) {
      case 'vulture': {   // heavy attack plane: straight wide wings, blunt nose, engine pods, belly bomb
        if (burning) {
          ctx.fillStyle = flame(0.9);
          ctx.beginPath(); ctx.moveTo(-6, -9); ctx.lineTo(-13, -7.6); ctx.lineTo(-13, -10.4); ctx.closePath(); ctx.fill();
          ctx.beginPath(); ctx.moveTo(-6, 9); ctx.lineTo(-13, 7.6); ctx.lineTo(-13, 10.4); ctx.closePath(); ctx.fill();
          ctx.fillStyle = g;
        }
        // straight wings
        ctx.beginPath();
        ctx.moveTo(6, -2.6); ctx.lineTo(2, -16); ctx.lineTo(-4, -16); ctx.lineTo(-4, -2.6);
        ctx.lineTo(-4, 2.6); ctx.lineTo(-4, 16); ctx.lineTo(2, 16); ctx.lineTo(6, 2.6);
        ctx.closePath(); ctx.fill(); ctx.stroke();
        // wing engine pods
        ctx.fillStyle = U.shade(c2, 1.15);
        roundRect(-6, -10.6, 9, 3.6, 1.6); ctx.fill();
        roundRect(-6, 7, 9, 3.6, 1.6); ctx.fill();
        // fat fuselage, blunt rounded nose, single tall tail
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.moveTo(13, -3); ctx.quadraticCurveTo(17, 0, 13, 3);
        ctx.lineTo(-12, 2.6); ctx.lineTo(-16, 5.5); ctx.lineTo(-17.5, 5.5); ctx.lineTo(-15, 0);
        ctx.lineTo(-17.5, -5.5); ctx.lineTo(-16, -5.5); ctx.lineTo(-12, -2.6);
        ctx.closePath(); ctx.fill(); ctx.stroke();
        // slung bomb
        if (u.ammo > 0) { ctx.fillStyle = '#4a2a1a'; ctx.beginPath(); ctx.ellipse(0, 0, 5, 2.2, 0, 0, 7); ctx.fill(); }
        ctx.fillStyle = '#b8d8e8';
        ctx.beginPath(); ctx.ellipse(10, 0, 3.4, 2, 0, 0, 7); ctx.fill();
        break;
      }
      case 'seraph': {    // end-game gunship: forward-swept wings, canards, twin glowing engines
        if (burning) {
          ctx.fillStyle = `rgba(140,220,255,${0.55 + 0.4 * Math.sin(game.renderT * 40)})`;
          ctx.beginPath(); ctx.moveTo(-13, -4); ctx.lineTo(-22, -2.6); ctx.lineTo(-22, -5.4); ctx.closePath(); ctx.fill();
          ctx.beginPath(); ctx.moveTo(-13, 4); ctx.lineTo(-22, 2.6); ctx.lineTo(-22, 5.4); ctx.closePath(); ctx.fill();
          ctx.fillStyle = g;
        }
        // forward-swept wings (tips ahead of the root)
        ctx.beginPath();
        ctx.moveTo(2, -3); ctx.lineTo(4, -14); ctx.lineTo(-2, -15); ctx.lineTo(-8, -3.4);
        ctx.lineTo(-8, 3.4); ctx.lineTo(-2, 15); ctx.lineTo(4, 14); ctx.lineTo(2, 3);
        ctx.closePath(); ctx.fill(); ctx.stroke();
        // canards
        ctx.beginPath();
        ctx.moveTo(11, -2); ctx.lineTo(13, -7); ctx.lineTo(9.5, -7); ctx.lineTo(7.5, -2);
        ctx.lineTo(7.5, 2); ctx.lineTo(9.5, 7); ctx.lineTo(13, 7); ctx.lineTo(11, 2);
        ctx.closePath(); ctx.fill();
        // sleek fuselage + twin canted tails
        ctx.beginPath();
        ctx.moveTo(19, 0); ctx.lineTo(9, -2.8); ctx.lineTo(-10, -3.2);
        ctx.lineTo(-15, -8); ctx.lineTo(-17.5, -8); ctx.lineTo(-14, -1.5);
        ctx.lineTo(-14, 1.5); ctx.lineTo(-17.5, 8); ctx.lineTo(-15, 8); ctx.lineTo(-10, 3.2);
        ctx.lineTo(9, 2.8);
        ctx.closePath(); ctx.fill(); ctx.stroke();
        // twin engine glow
        const eg = 0.5 + 0.4 * Math.sin(game.renderT * 9 + u.id);
        ctx.fillStyle = `rgba(120,220,255,${eg})`;
        ctx.beginPath(); ctx.arc(-12.5, -2.2, 1.6, 0, 7); ctx.fill();
        ctx.beginPath(); ctx.arc(-12.5, 2.2, 1.6, 0, 7); ctx.fill();
        ctx.fillStyle = '#c8ecff';
        ctx.beginPath(); ctx.ellipse(11, 0, 4.2, 1.8, 0, 0, 7); ctx.fill();
        break;
      }
      case 'behemoth': {  // end-game heavy bomber: giant flying wing, four engines
        if (burning) {
          ctx.fillStyle = flame(0.8);
          for (const ey of [-11, -5, 5, 11]) {
            ctx.beginPath(); ctx.moveTo(-8, ey); ctx.lineTo(-15, ey - 1.3); ctx.lineTo(-15, ey + 1.3); ctx.closePath(); ctx.fill();
          }
          ctx.fillStyle = g;
        }
        // one huge swept wing spanning the whole craft
        ctx.beginPath();
        ctx.moveTo(12, 0); ctx.lineTo(2, -6); ctx.lineTo(-6, -20); ctx.lineTo(-12, -20);
        ctx.lineTo(-9, -5); ctx.lineTo(-11, 0); ctx.lineTo(-9, 5);
        ctx.lineTo(-12, 20); ctx.lineTo(-6, 20); ctx.lineTo(2, 6);
        ctx.closePath(); ctx.fill(); ctx.stroke();
        // four embedded engine nacelles
        ctx.fillStyle = U.shade(c2, 1.2);
        for (const ey of [-11, -5, 5, 11]) roundRect(-8.5, ey - 1.7, 8, 3.4, 1.4), ctx.fill();
        // center pod cockpit
        ctx.fillStyle = g;
        ctx.beginPath(); ctx.ellipse(4, 0, 8, 3.4, 0, 0, 7); ctx.fill(); ctx.stroke();
        ctx.fillStyle = '#b8d8e8';
        ctx.beginPath(); ctx.ellipse(8, 0, 2.8, 1.7, 0, 0, 7); ctx.fill();
        break;
      }
      case 'kestrel': {   // multirole: swing-wings mid-sweep, chin intake, visible missile racks
        if (burning) {
          ctx.fillStyle = flame(0.95);
          ctx.beginPath(); ctx.moveTo(-13, 0); ctx.lineTo(-20, -2.2); ctx.lineTo(-20, 2.2); ctx.closePath(); ctx.fill();
          ctx.fillStyle = g;
        }
        // swing wings, half-swept trapezoids
        ctx.beginPath();
        ctx.moveTo(6, -2.4); ctx.lineTo(-1, -12.5); ctx.lineTo(-7, -11.5); ctx.lineTo(-6, -2.6);
        ctx.lineTo(-6, 2.6); ctx.lineTo(-7, 11.5); ctx.lineTo(-1, 12.5); ctx.lineTo(6, 2.4);
        ctx.closePath(); ctx.fill(); ctx.stroke();
        // under-wing missile racks — pips drain as ammo is spent
        ctx.fillStyle = '#d8d4c8';
        const pips = Math.min(4, Math.ceil((u.ammo || 0) / 2));
        for (let i = 0; i < pips; i++) {
          const px = 1 - i * 3;
          ctx.fillRect(px, -11.5 + i * 1.4, 4, 1.3);
          ctx.fillRect(px, 10.2 - i * 1.4, 4, 1.3);
        }
        // slab fuselage with chin intake + single tall tail
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.moveTo(16, 0); ctx.lineTo(10, -2.6); ctx.lineTo(-8, -2.8);
        ctx.lineTo(-12, -8.5); ctx.lineTo(-14.5, -8.5); ctx.lineTo(-12.5, -1.4);
        ctx.lineTo(-12.5, 1.4); ctx.lineTo(-14.5, 8.5); ctx.lineTo(-12, 8.5); ctx.lineTo(-8, 2.8);
        ctx.lineTo(10, 2.6);
        ctx.closePath(); ctx.fill(); ctx.stroke();
        ctx.fillStyle = 'rgba(0,0,0,0.28)';
        ctx.fillRect(8, -1.6, 4, 3.2);        // chin intake
        ctx.fillStyle = '#b8d8e8';
        ctx.beginPath(); ctx.ellipse(9, 0, 3.6, 1.8, 0, 0, 7); ctx.fill();
        break;
      }
      case 'obsidian': {  // strategic bomber: broad black flying wing, deep W trailing edge
        if (burning) {
          ctx.fillStyle = `rgba(255,150,90,${0.4 + 0.3 * Math.sin(game.renderT * 40)})`;
          for (const wy of [-7, 7]) {
            ctx.beginPath(); ctx.moveTo(-13, wy); ctx.lineTo(-24, wy - 1.8); ctx.lineTo(-24, wy + 1.8);
            ctx.closePath(); ctx.fill();
          }
          ctx.fillStyle = g;
        }
        // one continuous wing: sharp nose, long swept leading edges, notched tail
        ctx.fillStyle = U.shade(c2, 0.62);
        ctx.beginPath();
        ctx.moveTo(22, 0);
        ctx.lineTo(-6, -24); ctx.lineTo(-14, -24);
        ctx.lineTo(-10, -12); ctx.lineTo(-16, -6); ctx.lineTo(-11, 0);   // W notch
        ctx.lineTo(-16, 6); ctx.lineTo(-10, 12);
        ctx.lineTo(-14, 24); ctx.lineTo(-6, 24);
        ctx.closePath(); ctx.fill();
        ctx.strokeStyle = 'rgba(0,0,0,0.45)'; ctx.lineWidth = 1; ctx.stroke();
        // faceted spine catching light
        ctx.fillStyle = U.shade(c1, 0.95);
        ctx.beginPath();
        ctx.moveTo(20, 0); ctx.lineTo(-4, -7); ctx.lineTo(-9, 0); ctx.lineTo(-4, 7);
        ctx.closePath(); ctx.fill();
        // cockpit blister + buried intakes
        ctx.fillStyle = 'rgba(20,24,30,0.85)';
        ctx.beginPath(); ctx.ellipse(11, 0, 4, 2.6, 0, 0, 7); ctx.fill();
        ctx.fillStyle = 'rgba(0,0,0,0.3)';
        for (const wy of [-6, 6]) ctx.fillRect(-4, wy - 1.6, 6, 3.2);
        // payload bay glows while it still has the bomb
        if (u.ammo > 0) {
          ctx.fillStyle = 'rgba(255,207,90,0.5)';
          ctx.fillRect(-2, -2.4, 5, 4.8);
        }
        break;
      }
      case 'umbra': {     // stealth strike: faceted arrowhead flying-wing, sawtooth trailing edge
        if (burning) {
          ctx.fillStyle = `rgba(150,120,255,${0.4 + 0.3 * Math.sin(game.renderT * 40)})`;
          ctx.beginPath(); ctx.moveTo(-10, -3.5); ctx.lineTo(-17, -2.2); ctx.lineTo(-17, -4.8); ctx.closePath(); ctx.fill();
          ctx.beginPath(); ctx.moveTo(-10, 3.5); ctx.lineTo(-17, 2.2); ctx.lineTo(-17, 4.8); ctx.closePath(); ctx.fill();
          ctx.fillStyle = g;
        }
        // single faceted arrowhead — no separate fuselage, all wing
        ctx.fillStyle = U.shade(c2, 0.85);
        ctx.beginPath();
        ctx.moveTo(17, 0);
        ctx.lineTo(-4, -15); ctx.lineTo(-11, -15); ctx.lineTo(-8, -8);
        ctx.lineTo(-12, -4); ctx.lineTo(-9, 0);                        // sawtooth
        ctx.lineTo(-12, 4); ctx.lineTo(-8, 8);
        ctx.lineTo(-11, 15); ctx.lineTo(-4, 15);
        ctx.closePath(); ctx.fill();
        ctx.strokeStyle = U.shade(c1, 1.1); ctx.lineWidth = 1; ctx.stroke();
        // facet ridge lines
        ctx.strokeStyle = 'rgba(255,255,255,0.16)'; ctx.lineWidth = 0.8;
        ctx.beginPath();
        ctx.moveTo(17, 0); ctx.lineTo(-9, 0);
        ctx.moveTo(11, -2.4); ctx.lineTo(-6, -11);
        ctx.moveTo(11, 2.4); ctx.lineTo(-6, 11);
        ctx.stroke();
        // slit cockpit glow
        ctx.fillStyle = 'rgba(140,220,255,0.8)';
        ctx.fillRect(6, -1.1, 6, 2.2);
        break;
      }
      case 'spyplane': {  // stealth recon: long slender body, extreme-span thin straight wings
        // glider wings — very wide, very thin
        ctx.fillStyle = U.shade(c1, 0.75);
        ctx.beginPath();
        ctx.moveTo(3, -1.6); ctx.lineTo(-1, -22); ctx.lineTo(-4, -22) ; ctx.lineTo(-4, -1.6);
        ctx.lineTo(-4, 1.6); ctx.lineTo(-4, 22); ctx.lineTo(-1, 22); ctx.lineTo(3, 1.6);
        ctx.closePath(); ctx.fill(); ctx.stroke();
        // needle fuselage
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.moveTo(17, 0); ctx.lineTo(12, -1.8); ctx.lineTo(-13, -1.8);
        ctx.lineTo(-16, -5); ctx.lineTo(-17.5, -5); ctx.lineTo(-16.5, 0);
        ctx.lineTo(-17.5, 5); ctx.lineTo(-16, 5); ctx.lineTo(-13, 1.8);
        ctx.lineTo(12, 1.8);
        ctx.closePath(); ctx.fill(); ctx.stroke();
        // sensor blister glow
        const sg = 0.4 + 0.4 * Math.sin(game.renderT * 4 + u.id);
        ctx.fillStyle = `rgba(140,255,190,${sg})`;
        ctx.beginPath(); ctx.ellipse(2, 0, 3, 1.6, 0, 0, 7); ctx.fill();
        ctx.fillStyle = '#b8d8e8';
        ctx.beginPath(); ctx.ellipse(10, 0, 2.6, 1.4, 0, 0, 7); ctx.fill();
        break;
      }
      default: {          // falcon — sleek delta-wing strike fighter, twin canted tails
        if (burning) {
          ctx.fillStyle = flame(1);
          ctx.beginPath(); ctx.moveTo(-14, 0); ctx.lineTo(-22, -2.5); ctx.lineTo(-22, 2.5); ctx.closePath(); ctx.fill();
          ctx.fillStyle = g;
        }
        // cropped delta wings set far back
        ctx.beginPath();
        ctx.moveTo(8, -2.4); ctx.lineTo(-5, -13.5); ctx.lineTo(-11, -13.5); ctx.lineTo(-8, -2.6);
        ctx.lineTo(-8, 2.6); ctx.lineTo(-11, 13.5); ctx.lineTo(-5, 13.5); ctx.lineTo(8, 2.4);
        ctx.closePath(); ctx.fill(); ctx.stroke();
        // dart fuselage
        ctx.beginPath();
        ctx.moveTo(18, 0); ctx.lineTo(9, -2.6); ctx.lineTo(-9, -3);
        ctx.lineTo(-12, -7.5); ctx.lineTo(-14.5, -7.5); ctx.lineTo(-13, -1.4);
        ctx.lineTo(-13, 1.4); ctx.lineTo(-14.5, 7.5); ctx.lineTo(-12, 7.5); ctx.lineTo(-9, 3);
        ctx.lineTo(9, 2.6);
        ctx.closePath(); ctx.fill(); ctx.stroke();
        // wingtip missiles while armed
        if (u.ammo > 0) {
          ctx.fillStyle = '#d8d4c8';
          ctx.fillRect(-9, -13, 6, 1.6); ctx.fillRect(-9, 11.4, 6, 1.6);
        }
        ctx.fillStyle = '#b8d8e8';
        ctx.beginPath(); ctx.ellipse(9, 0, 4, 1.9, 0, 0, 7); ctx.fill();
      }
    }
    ctx.restore();
    drawHpBar(u);
  }

  /* ================= buildings ================= */
  function drawBuilding(b) {
    if (!b.constructed) { drawConstructionSite(b); return; }
    drawBuildingSprite(b, false);
    // anchored fires: a wounded structure visibly burns
    if (b.hp < b.maxHp * 0.55) {
      const s2 = b.size * TILE;
      const nFires = b.hp < b.maxHp * 0.25 ? 3 : b.hp < b.maxHp * 0.4 ? 2 : 1;
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      for (let i = 0; i < nFires; i++) {
        const seed = (b.id * 37 + i * 53) % 97;
        const fx2 = b.tx * TILE + s2 * (0.2 + (seed % 7) / 10);
        const fy2 = b.ty * TILE + s2 * (0.2 + ((seed / 7) % 6) / 10);
        const flick = 0.8 + 0.35 * Math.sin(game.renderT * 13 + i * 2.4 + b.id);
        const fr = s2 * 0.09 * flick;
        const fg = ctx.createRadialGradient(fx2, fy2, fr * 0.1, fx2, fy2, fr * 2.2);
        fg.addColorStop(0, 'rgba(255,240,180,0.9)');
        fg.addColorStop(0.4, 'rgba(255,150,50,0.55)');
        fg.addColorStop(1, 'rgba(200,60,20,0)');
        ctx.fillStyle = fg;
        ctx.beginPath(); ctx.arc(fx2, fy2, fr * 2.2, 0, 7); ctx.fill();
        // flame tongue
        ctx.fillStyle = `rgba(255,190,70,${0.75 * flick})`;
        ctx.beginPath();
        ctx.moveTo(fx2 - fr * 0.6, fy2);
        ctx.quadraticCurveTo(fx2 - fr * 0.3, fy2 - fr * (1.4 + 0.6 * Math.sin(game.renderT * 17 + i)), fx2, fy2 - fr * 2);
        ctx.quadraticCurveTo(fx2 + fr * 0.4, fy2 - fr * 1.1, fx2 + fr * 0.6, fy2);
        ctx.closePath(); ctx.fill();
        if (Math.random() < 0.06) FX.smokePuff(fx2, fy2 - 8, 1, true);
      }
      ctx.restore();
    }
    // sabotaged indicator
    if (b.disabledUntil && game.t < b.disabledUntil) {
      ctx.globalAlpha = 0.6 + 0.4 * Math.sin(game.renderT * 8);
      ctx.fillStyle = '#ffcc33'; ctx.font = 'bold 22px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('⚡', b.x, b.y - b.size * TILE * 0.15);
      ctx.textAlign = 'left';
      ctx.globalAlpha = 1;
    }
    // damage fx
    if (b.hp < b.maxHp * 0.5 && Math.random() < 0.12) FX.smokePuff(b.x + U.rand(-b.size * 12, b.size * 12), b.y + U.rand(-b.size * 12, b.size * 12), 1, true);
    if (b.hp < b.maxHp * 0.25 && Math.random() < 0.08) FX.flame(b.x + U.rand(-b.size * 10, b.size * 10), b.y + U.rand(-b.size * 10, b.size * 10), -Math.PI / 2);
    drawHpBar(b);
    // production progress ring
    if (b.queue && b.queue.length && b.owner === 0) {
      ctx.strokeStyle = 'rgba(127,212,255,0.85)'; ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(b.x, b.y, b.size * TILE * 0.42, -Math.PI / 2, -Math.PI / 2 + b.queue[0].prog * Math.PI * 2);
      ctx.stroke();
    }
  }

  function drawConstructionSite(b) {
    const s = b.size * TILE;
    const x0 = b.tx * TILE, y0 = b.ty * TILE;
    ctx.fillStyle = 'rgba(60,50,30,0.4)';
    ctx.fillRect(x0 + 2, y0 + 2, s - 4, s - 4);
    ctx.strokeStyle = '#8a8060'; ctx.lineWidth = 2;
    ctx.setLineDash([8, 6]);
    ctx.strokeRect(x0 + 3, y0 + 3, s - 6, s - 6);
    ctx.setLineDash([]);
    // rising building silhouette
    const k = b.buildProgress;
    if (k > 0.05) {
      ctx.save();
      ctx.beginPath();
      ctx.rect(x0 - 24, y0 - 26 + (s + 26) * (1 - k), s + 48, (s + 26) * k + 2);
      ctx.clip();
      ctx.globalAlpha = 0.5 + k * 0.5;
      drawBuildingSprite(b, false);
      ctx.restore();
    }
    // scaffold corners
    ctx.strokeStyle = '#b0a068'; ctx.lineWidth = 2;
    for (const [cx, cy] of [[x0 + 6, y0 + 6], [x0 + s - 6, y0 + 6], [x0 + 6, y0 + s - 6], [x0 + s - 6, y0 + s - 6]]) {
      ctx.beginPath(); ctx.moveTo(cx - 5, cy); ctx.lineTo(cx + 5, cy);
      ctx.moveTo(cx, cy - 5); ctx.lineTo(cx, cy + 5); ctx.stroke();
    }
    // progress bar
    ctx.fillStyle = '#111'; ctx.fillRect(x0 + 4, y0 - 8, s - 8, 5);
    ctx.fillStyle = '#e8c33c'; ctx.fillRect(x0 + 4, y0 - 8, (s - 8) * k, 5);
    drawHpBar(b);
  }

  function drawBuildingSprite(b, ghost) {
    const p = game.players[b.owner];
    const fac = p ? p.faction : 'coalition';
    const [c1r, c2r] = teamColors(b);
    const c1 = ghost ? '#777777' : c1r, c2 = ghost ? '#444444' : c2r;
    const s = b.size * TILE;
    const x0 = b.tx * TILE, y0 = b.ty * TILE;
    ctx.save();
    ctx.translate(x0, y0);

    if (!ghost) {
      // sun-cast shadow to the south-east (skewed footprint)
      ctx.fillStyle = 'rgba(24,18,10,0.28)';
      ctx.beginPath();
      ctx.moveTo(3, 4); ctx.lineTo(s - 1, 4);
      ctx.lineTo(s + s * 0.16, s + s * 0.2);
      ctx.lineTo(3 + s * 0.16, s + s * 0.2);
      ctx.closePath(); ctx.fill();
      // soft ambient occlusion hugging the base
      const ao = ctx.createRadialGradient(s / 2, s * 0.55, s * 0.2, s / 2, s * 0.55, s * 0.8);
      ao.addColorStop(0, 'rgba(20,15,8,0.30)');
      ao.addColorStop(1, 'rgba(20,15,8,0)');
      ctx.fillStyle = ao;
      ctx.beginPath(); ctx.ellipse(s / 2, s * 0.55, s * 0.8, s * 0.62, 0, 0, 7); ctx.fill();
    }
    // foundation pad with worn concrete edges
    ctx.fillStyle = ghost ? '#3a3a34' : '#7d7660';
    ctx.fillRect(0, 0, s - 2, s - 2);
    if (!ghost) {
      ctx.fillStyle = 'rgba(255,245,220,0.14)';
      ctx.fillRect(0, 0, s - 2, 2.5);
      ctx.fillRect(0, 0, 2.5, s - 2);
      ctx.fillStyle = 'rgba(0,0,0,0.22)';
      ctx.fillRect(0, s - 4.5, s - 2, 2.5);
      ctx.fillRect(s - 4.5, 0, 2.5, s - 2);
    }
    ctx.strokeStyle = 'rgba(0,0,0,0.35)'; ctx.lineWidth = 1.5;
    ctx.strokeRect(0.5, 0.5, s - 3, s - 3);

    switch (b.key) {
      case 'cc': drawCC(b, s, c1, c2, fac); break;
      case 'power': drawPower(b, s, c1, c2, fac); break;
      case 'nuclear': drawNuclear(b, s, c1, c2); break;
      case 'supply': drawSupply(b, s, c1, c2); break;
      case 'barracks': drawBarracks(b, s, c1, c2); break;
      case 'factory': drawFactory(b, s, c1, c2); break;
      case 'airfield': drawAirfield(b, s, c1, c2); break;
      case 'gatdef': drawGatDef(b, s, c1, c2, fac); break;
      case 'artdef': drawArtDef(b, s, c1, c2, fac); break;
      case 'repairbay': drawRepairBay(b, s, c1, c2); break;
      case 'market': drawMarket(b, s, c1, c2); break;
      case 'superweapon': drawSuper(b, s, c1, c2, fac); break;
    }
    if (!ghost) {
      // north-west light sheen unifies every structure under one sun
      const sheen = ctx.createLinearGradient(0, 0, s * 0.9, s * 0.9);
      sheen.addColorStop(0, 'rgba(255,246,220,0.13)');
      sheen.addColorStop(0.5, 'rgba(255,246,220,0)');
      sheen.addColorStop(1, 'rgba(30,20,10,0.10)');
      ctx.fillStyle = sheen;
      ctx.fillRect(0, 0, s - 2, s - 2);
    }
    ctx.restore();
  }

  /* extruded volume: roof lifted `ht` px, visible south wall + skewed east face.
     This is what makes structures read as 3D instead of painted-on. */
  function prism(x, y, w, h, ht, topCol, wallCol) {
    wallCol = wallCol || U.shade(topCol, 0.55);
    const skx = ht * 0.32;
    // east face (parallelogram catching side light)
    ctx.fillStyle = U.shade(topCol, 0.72);
    ctx.beginPath();
    ctx.moveTo(x + w, y - ht);
    ctx.lineTo(x + w + skx, y - ht + skx * 0.55);
    ctx.lineTo(x + w + skx, y + h - ht + skx * 0.55);
    ctx.lineTo(x + w, y + h - ht);
    ctx.closePath(); ctx.fill();
    // south wall with vertical falloff
    const wg = ctx.createLinearGradient(0, y + h - ht, 0, y + h);
    wg.addColorStop(0, wallCol);
    wg.addColorStop(1, U.shade(wallCol, 0.72));
    ctx.fillStyle = wg;
    ctx.fillRect(x, y + h - ht, w, ht);
    // roof lit from the north-west
    const rg = ctx.createLinearGradient(x, y - ht, x + w * 0.8, y + h - ht);
    rg.addColorStop(0, U.shade(topCol, 1.18));
    rg.addColorStop(1, U.shade(topCol, 0.94));
    ctx.fillStyle = rg;
    ctx.fillRect(x, y - ht, w, h);
    ctx.strokeStyle = 'rgba(0,0,0,0.4)'; ctx.lineWidth = 1;
    ctx.strokeRect(x + 0.5, y - ht + 0.5, w - 1, h - 1);
    // roof lip highlight
    ctx.fillStyle = 'rgba(255,246,220,0.20)';
    ctx.fillRect(x, y - ht, w, 1.6);
  }

  /* vertical cylinder (stacks, silos, tanks) */
  function cyl(cx, cy, r, ht, col) {
    const bg = ctx.createLinearGradient(cx - r, 0, cx + r, 0);
    bg.addColorStop(0, U.shade(col, 1.2));
    bg.addColorStop(0.45, col);
    bg.addColorStop(1, U.shade(col, 0.6));
    ctx.fillStyle = bg;
    ctx.fillRect(cx - r, cy - ht, r * 2, ht);
    ctx.fillStyle = U.shade(col, 1.24);
    ctx.beginPath(); ctx.ellipse(cx, cy - ht, r, r * 0.45, 0, 0, 7); ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.35)'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.ellipse(cx, cy - ht, r, r * 0.45, 0, 0, 7); ctx.stroke();
  }

  /* legacy signature — now draws a real prism so every structure gains depth */
  function box3d(x, y, w, h, c1, c2, top) {
    const ht = U.clamp(Math.min(w, h) * 0.42, 7, 20);
    prism(x, y, w, h, ht, top || U.shade(c1, 1.05), c2);
  }

  function drawCC(b, s, c1, c2, fac) {
    // main hall
    box3d(s * 0.1, s * 0.3, s * 0.8, s * 0.56, '#9a927c', '#6e6852');
    // command block with faction-color roof band + window row
    box3d(s * 0.16, s * 0.08, s * 0.68, s * 0.3, '#8a8270', '#5e5846');
    ctx.fillStyle = U.shade(c1, 0.95);
    ctx.fillRect(s * 0.16, s * 0.08, s * 0.68, s * 0.09);
    ctx.fillStyle = '#b8d0dc';
    for (let i = 0; i < 5; i++) ctx.fillRect(s * 0.21 + i * s * 0.12, s * 0.22, s * 0.07, s * 0.07);
    // helipad circle
    ctx.fillStyle = '#57503f';
    ctx.beginPath(); ctx.arc(s * 0.34, s * 0.64, s * 0.15, 0, 7); ctx.fill();
    ctx.strokeStyle = '#d8cfa8'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(s * 0.34, s * 0.64, s * 0.11, 0, 7); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(s * 0.29, s * 0.64); ctx.lineTo(s * 0.39, s * 0.64); ctx.stroke();
    // radar dish that slowly spins
    ctx.save();
    ctx.translate(s * 0.72, s * 0.62);
    ctx.rotate(game.renderT * 0.8);
    ctx.fillStyle = '#a8b0b8';
    ctx.beginPath(); ctx.ellipse(0, 0, s * 0.11, s * 0.05, 0, 0, 7); ctx.fill();
    ctx.fillStyle = '#788088';
    ctx.fillRect(-s * 0.01, -s * 0.01, s * 0.12, s * 0.02);
    ctx.restore();
    // antenna + blinking light
    ctx.strokeStyle = '#2c2a22'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(s * 0.86, s * 0.3); ctx.lineTo(s * 0.93, s * 0.06); ctx.stroke();
    if (Math.floor(game.renderT * 2) % 2) {
      ctx.fillStyle = '#ff5040';
      ctx.beginPath(); ctx.arc(s * 0.93, s * 0.06, 2.5, 0, 7); ctx.fill();
    }
    // faction stripe
    ctx.fillStyle = c1; ctx.fillRect(s * 0.1, s * 0.34, s * 0.05, s * 0.5);
  }

  function drawPower(b, s, c1, c2, fac) {
    if (fac === 'coalition') {
      box3d(s * 0.1, s * 0.3, s * 0.8, s * 0.55, '#8a92a0', '#5a626e');
      // reactor ring glow
      const gl = 0.55 + 0.35 * Math.sin(game.renderT * 3);
      ctx.strokeStyle = `rgba(120,220,255,${gl})`; ctx.lineWidth = 4;
      ctx.beginPath(); ctx.arc(s * 0.5, s * 0.5, s * 0.2, 0, 7); ctx.stroke();
      ctx.fillStyle = `rgba(160,240,255,${gl * 0.5})`;
      ctx.beginPath(); ctx.arc(s * 0.5, s * 0.5, s * 0.13, 0, 7); ctx.fill();
      // crackling arc
      if (Math.sin(game.renderT * 9 + b.id) > 0.82) {
        const a0 = game.renderT * 11 + b.id;
        ctx.strokeStyle = 'rgba(200,245,255,0.9)'; ctx.lineWidth = 1.4;
        ctx.beginPath();
        let ax = s * 0.5 + Math.cos(a0) * s * 0.2, ay = s * 0.5 + Math.sin(a0) * s * 0.2;
        ctx.moveTo(ax, ay);
        for (let i = 0; i < 4; i++) {
          ax += U.rand(-s * 0.07, s * 0.07); ay += U.rand(-s * 0.07, s * 0.07);
          ctx.lineTo(ax, ay);
        }
        ctx.stroke();
      }
    } else {
      box3d(s * 0.08, s * 0.35, s * 0.84, s * 0.5, '#8a8272', '#5c5648');
      // twin smokestack cylinders
      for (const sx of [s * 0.3, s * 0.66]) {
        cyl(sx, s * 0.46, s * 0.1, s * 0.34, '#5c564a');
        ctx.fillStyle = '#241f18';
        ctx.beginPath(); ctx.ellipse(sx, s * 0.12, s * 0.06, s * 0.028, 0, 0, 7); ctx.fill();
        if (Math.random() < 0.06) FX.smokePuff(b.tx * TILE + sx, b.ty * TILE + s * 0.1, 1);
      }
    }
    ctx.fillStyle = c1; ctx.fillRect(s * 0.1, s * 0.78, s * 0.8, s * 0.07);
  }

  function drawNuclear(b, s, c1, c2) {
    // containment hall
    box3d(s * 0.06, s * 0.42, s * 0.5, s * 0.44, '#8e94a2', '#5c626e');
    // hazard chevrons on the hall roof
    ctx.fillStyle = '#d8c33c';
    for (let i = 0; i < 3; i++) ctx.fillRect(s * 0.1 + i * s * 0.15, s * 0.35, s * 0.08, s * 0.05);
    // big cooling tower (hyperboloid suggested by stacked cylinders)
    cyl(s * 0.68, s * 0.62, s * 0.21, s * 0.42, '#9aa0aa');
    cyl(s * 0.68, s * 0.28, s * 0.155, s * 0.1, '#aab0ba');
    ctx.fillStyle = '#2c3038';
    ctx.beginPath(); ctx.ellipse(s * 0.68, s * 0.18, s * 0.115, s * 0.05, 0, 0, 7); ctx.fill();
    // rising steam column
    if (Math.random() < 0.14) FX.smokePuff(b.tx * TILE + s * 0.68, b.ty * TILE + s * 0.16, 1.6);
    // reactor core dome with pulsing radioactive glow
    const gl = 0.5 + 0.4 * Math.sin(game.renderT * 2.6 + b.id);
    ctx.fillStyle = '#6e747e';
    ctx.beginPath(); ctx.arc(s * 0.3, s * 0.6, s * 0.13, 0, 7); ctx.fill();
    ctx.fillStyle = `rgba(130,255,90,${gl})`;
    ctx.beginPath(); ctx.arc(s * 0.3, s * 0.6, s * 0.085, 0, 7); ctx.fill();
    ctx.strokeStyle = `rgba(180,255,140,${gl * 0.8})`; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(s * 0.3, s * 0.6, s * 0.13, 0, 7); ctx.stroke();
    // trefoil-style warning marks (three dots around the core)
    ctx.fillStyle = '#1c1e14';
    for (let i = 0; i < 3; i++) {
      const a = i * Math.PI * 2 / 3 - Math.PI / 2;
      ctx.beginPath(); ctx.arc(s * 0.3 + Math.cos(a) * s * 0.055, s * 0.6 + Math.sin(a) * s * 0.055, s * 0.02, 0, 7); ctx.fill();
    }
    ctx.fillStyle = c1; ctx.fillRect(s * 0.06, s * 0.9, s * 0.5, s * 0.05);
  }

  function drawSupply(b, s, c1, c2) {
    box3d(s * 0.08, s * 0.2, s * 0.6, s * 0.62, '#9a8f6c', '#6e6448');
    // roof stripes
    ctx.fillStyle = U.shade(c1, 1.1);
    for (let i = 0; i < 4; i++) ctx.fillRect(s * 0.1, s * 0.24 + i * s * 0.12, s * 0.56, s * 0.04);
    // crates outside
    ctx.fillStyle = '#3d7edb'; ctx.fillRect(s * 0.74, s * 0.3, s * 0.16, s * 0.14);
    ctx.fillStyle = '#2c5a8a'; ctx.fillRect(s * 0.74, s * 0.48, s * 0.16, s * 0.14);
    ctx.fillStyle = '#b08c30'; ctx.fillRect(s * 0.74, s * 0.66, s * 0.16, s * 0.14);
    // ramp
    ctx.fillStyle = '#57503c';
    ctx.fillRect(s * 0.14, s * 0.82, s * 0.48, s * 0.12);
  }

  function drawBarracks(b, s, c1, c2) {
    box3d(s * 0.08, s * 0.15, s * 0.84, s * 0.68, '#8f8668', c2);
    ctx.fillStyle = U.shade(c1, 0.85);
    ctx.fillRect(s * 0.08, s * 0.15, s * 0.84, s * 0.16);
    // door
    ctx.fillStyle = '#2c2a22';
    ctx.fillRect(s * 0.38, s * 0.62, s * 0.24, s * 0.21);
    // flag pole + rippling flag
    ctx.strokeStyle = '#3c382c'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(s * 0.14, s * 0.15); ctx.lineTo(s * 0.14, s * -0.1); ctx.stroke();
    const wv = game.renderT * 7;
    ctx.fillStyle = c1;
    ctx.beginPath();
    ctx.moveTo(s * 0.14, s * -0.1);
    for (let i = 0; i <= 6; i++) {
      const fx2 = s * 0.14 + (i / 6) * s * 0.2;
      ctx.lineTo(fx2, s * -0.1 + Math.sin(wv + i * 0.9) * s * 0.012 * i);
    }
    for (let i = 6; i >= 0; i--) {
      const fx2 = s * 0.14 + (i / 6) * s * 0.2;
      ctx.lineTo(fx2, s * -0.015 + Math.sin(wv + i * 0.9) * s * 0.012 * i);
    }
    ctx.closePath(); ctx.fill();
    ctx.fillStyle = 'rgba(0,0,0,0.18)';
    ctx.fillRect(s * 0.14, s * -0.1, s * 0.03, s * 0.085);
  }

  function drawFactory(b, s, c1, c2) {
    box3d(s * 0.05, s * 0.12, s * 0.9, s * 0.72, '#867e6a', '#57503e');
    // bay opening (animated door when producing)
    const open = b.queue && b.queue.length ? (0.5 + 0.5 * Math.sin(game.renderT * 2)) : 0;
    ctx.fillStyle = '#211f18';
    ctx.fillRect(s * 0.3, s * 0.5, s * 0.4, s * 0.34);
    ctx.fillStyle = '#4c463a';
    ctx.fillRect(s * 0.3, s * 0.5, s * 0.4, s * 0.34 * (1 - open) * 0.5);
    // crane
    ctx.strokeStyle = '#b08c30'; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(s * 0.12, s * 0.12); ctx.lineTo(s * 0.12, s * -0.08);
    ctx.lineTo(s * 0.5, s * -0.08); ctx.stroke();
    ctx.strokeStyle = '#2c2a22'; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(s * 0.42, s * -0.08); ctx.lineTo(s * 0.42, s * 0.05); ctx.stroke();
    // roof vents
    ctx.fillStyle = U.shade(c1, 0.8);
    for (let i = 0; i < 2; i++) ctx.fillRect(s * 0.16 + i * s * 0.24, s * 0.18, s * 0.12, s * 0.1);
    // spinning ventilation fan
    ctx.save();
    ctx.translate(s * 0.78, s * 0.2);
    ctx.fillStyle = '#3c382c';
    ctx.beginPath(); ctx.arc(0, 0, s * 0.075, 0, 7); ctx.fill();
    ctx.rotate(game.renderT * 5);
    ctx.strokeStyle = '#8a8578'; ctx.lineWidth = 2.4;
    for (let i = 0; i < 3; i++) {
      ctx.rotate(Math.PI * 2 / 3);
      ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(s * 0.06, 0); ctx.stroke();
    }
    ctx.restore();
  }

  function drawAirfield(b, s, c1, c2) {
    // runway
    ctx.fillStyle = '#4e4a3e';
    ctx.fillRect(s * 0.05, s * 0.12, s * 0.9, s * 0.76);
    ctx.strokeStyle = '#d8cfa8'; ctx.lineWidth = 2; ctx.setLineDash([8, 8]);
    ctx.beginPath(); ctx.moveTo(s * 0.1, s * 0.5); ctx.lineTo(s * 0.9, s * 0.5); ctx.stroke();
    ctx.setLineDash([]);
    // pads
    for (const py of [s * 0.28, s * 0.72]) {
      ctx.fillStyle = '#57503c';
      ctx.beginPath(); ctx.arc(s * 0.72, py, s * 0.12, 0, 7); ctx.fill();
      ctx.strokeStyle = c1; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(s * 0.72, py, s * 0.09, 0, 7); ctx.stroke();
    }
    // chasing runway lights
    const lit = Math.floor(game.renderT * 7) % 6;
    for (let i = 0; i < 6; i++) {
      ctx.fillStyle = i === lit ? '#ffe9a0' : 'rgba(255,233,160,0.22)';
      ctx.beginPath(); ctx.arc(s * 0.12 + i * s * 0.15, s * 0.56, 1.8, 0, 7); ctx.fill();
      ctx.beginPath(); ctx.arc(s * 0.12 + i * s * 0.15, s * 0.44, 1.8, 0, 7); ctx.fill();
    }
    // tower
    box3d(s * 0.06, s * 0.06, s * 0.2, s * 0.3, '#8a92a0', '#5a626e');
    ctx.fillStyle = '#b8d8e8'; ctx.fillRect(s * 0.09, s * 0.09, s * 0.14, s * 0.1);
    if (Math.floor(game.renderT * 3) % 2) {
      ctx.fillStyle = '#40ff60';
      ctx.beginPath(); ctx.arc(s * 0.16, s * 0.04, 2.4, 0, 7); ctx.fill();
    }
  }

  function defenseOffline(b) {
    const p = game.players[b.owner];
    return p && FACTIONS[p.faction].usesPower && p.lowPower &&
      BUILDINGS[b.key].weaponByFaction[p.faction].needsPower;
  }

  function drawOfflineBolt(s) {
    ctx.fillStyle = '#ff5040'; ctx.font = `bold ${Math.round(s * 0.3)}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.fillText('⚡', s * 0.5, s * 0.3);
    ctx.textAlign = 'left';
  }

  /* Gatling Defense — squat armored tower, spinning multi-barrel head */
  function drawGatDef(b, s, c1, c2, fac) {
    // round emplacement base + sandbag ring
    ctx.fillStyle = '#6e6852';
    ctx.beginPath(); ctx.arc(s * 0.5, s * 0.5, s * 0.36, 0, 7); ctx.fill();
    ctx.strokeStyle = '#4c4738'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(s * 0.5, s * 0.5, s * 0.36, 0, 7); ctx.stroke();
    ctx.strokeStyle = 'rgba(0,0,0,0.25)'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.arc(s * 0.5, s * 0.5, s * 0.27, 0, 7); ctx.stroke();
    ctx.save();
    ctx.translate(s * 0.5, s * 0.5);
    ctx.rotate(b.tAngle || 0);
    // armored head
    ctx.fillStyle = U.shade(c1, 1.12);
    ctx.beginPath(); ctx.arc(0, 0, s * 0.17, 0, 7); ctx.fill();
    ctx.strokeStyle = U.shade(c2, 0.8); ctx.lineWidth = 1; ctx.stroke();
    // rotary barrel cluster — spins while firing
    const spin = (b.cool !== undefined && b.targetId) ? game.t * 22 : 0;
    ctx.save();
    ctx.rotate(0);
    ctx.fillStyle = '#22201a';
    for (let i = 0; i < 3; i++) {
      const off = Math.sin(spin + i * 2.09) * 2.6;
      ctx.fillRect(3, -3.9 + i * 3.1 + off * 0.2, s * 0.33, 2.1);
    }
    ctx.restore();
    // muzzle shroud
    ctx.fillStyle = U.shade(c1, 0.8);
    ctx.fillRect(s * 0.3, -2.6, 3.4, 5.2);
    // small radar vane
    ctx.strokeStyle = '#1c1a14'; ctx.lineWidth = 0.9;
    ctx.beginPath(); ctx.moveTo(-4, -3); ctx.lineTo(-10, -9); ctx.stroke();
    ctx.restore();
    if (defenseOffline(b)) drawOfflineBolt(s);
  }

  /* Artillery Defense — heavy square rampart, long single cannon with recoil sled */
  function drawArtDef(b, s, c1, c2, fac) {
    // square hardened rampart
    ctx.fillStyle = '#6a644e';
    roundRect(s * 0.1, s * 0.1, s * 0.8, s * 0.8, 4); ctx.fill();
    ctx.strokeStyle = '#48432f'; ctx.lineWidth = 2;
    roundRect(s * 0.1, s * 0.1, s * 0.8, s * 0.8, 4); ctx.stroke();
    // corner bolts
    ctx.fillStyle = '#3c3828';
    for (const cx of [s * 0.18, s * 0.82]) for (const cy of [s * 0.18, s * 0.82]) {
      ctx.beginPath(); ctx.arc(cx, cy, 1.8, 0, 7); ctx.fill();
    }
    ctx.save();
    ctx.translate(s * 0.5, s * 0.5);
    ctx.rotate(b.tAngle || 0);
    // recoil sled + mount
    ctx.fillStyle = U.shade(c2, 0.9);
    roundRect(-s * 0.2, -s * 0.13, s * 0.34, s * 0.26, 2); ctx.fill();
    ctx.fillStyle = U.shade(c1, 1.15);
    ctx.beginPath(); ctx.arc(0, 0, s * 0.14, 0, 7); ctx.fill();
    ctx.strokeStyle = U.shade(c2, 0.7); ctx.lineWidth = 1; ctx.stroke();
    // long barrel: recoils right after firing (cool near max)
    const w = BUILDINGS.artdef.weaponByFaction[game.players[b.owner] ? game.players[b.owner].faction : 'coalition'];
    const rec = b.cool > 0 ? Math.max(0, (b.cool / w.cd) - 0.7) * 12 : 0;
    ctx.fillStyle = '#22201a';
    ctx.fillRect(2 - rec, -2.2, s * 0.5, 4.4);
    // muzzle brake
    ctx.fillStyle = '#14120e';
    ctx.fillRect(2 - rec + s * 0.5 - 3, -3.2, 4, 6.4);
    ctx.restore();
    if (defenseOffline(b)) drawOfflineBolt(s);
  }

  function drawRepairBay(b, s, c1, c2) {
    // open service bay with a vehicle lift
    box3d(s * 0.06, s * 0.1, s * 0.5, s * 0.76, '#867e6a', '#57503e');
    ctx.fillStyle = '#2c2a22';
    ctx.fillRect(s * 0.1, s * 0.3, s * 0.42, s * 0.5);
    // lift platform + stripes
    ctx.fillStyle = '#57503c';
    ctx.fillRect(s * 0.6, s * 0.2, s * 0.32, s * 0.62);
    for (let i = 0; i < 4; i++) {
      ctx.fillStyle = i % 2 ? '#e8c33c' : '#2c2a22';
      ctx.fillRect(s * 0.6, s * 0.2 + i * s * 0.155, s * 0.04, s * 0.155);
    }
    // animated crane arm
    ctx.save();
    ctx.translate(s * 0.76, s * 0.5);
    ctx.rotate(Math.sin(game.renderT * 1.4) * 0.5);
    ctx.strokeStyle = '#b08c30'; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(s * 0.22, 0); ctx.stroke();
    ctx.fillStyle = '#8a8578';
    ctx.beginPath(); ctx.arc(0, 0, s * 0.05, 0, 7); ctx.fill();
    ctx.restore();
    // wrench emblem
    ctx.fillStyle = '#ffe9a0'; ctx.font = `bold ${Math.round(s * 0.2)}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.fillText('🔧', s * 0.3, s * 0.24);
    ctx.textAlign = 'left';
    ctx.fillStyle = c1; ctx.fillRect(s * 0.06, s * 0.86, s * 0.86, s * 0.06);
  }

  function drawMarket(b, s, c1, c2) {
    box3d(s * 0.1, s * 0.25, s * 0.8, s * 0.6, '#9a8f6c', '#6e6448');
    // awning stripes
    for (let i = 0; i < 5; i++) {
      ctx.fillStyle = i % 2 ? '#c9a227' : U.shade(c1, 1.0);
      ctx.fillRect(s * 0.1 + i * s * 0.16, s * 0.2, s * 0.16, s * 0.12);
    }
    const pulse = 0.75 + 0.25 * Math.sin(game.renderT * 4 + b.id);
    ctx.fillStyle = `rgba(255,233,160,${pulse})`; ctx.font = `bold ${Math.round(s * 0.25)}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.fillText('$', s * 0.5, s * 0.55);
    ctx.textAlign = 'left';
  }

  function drawSuper(b, s, c1, c2, fac) {
    if (fac === 'coalition') {
      box3d(s * 0.1, s * 0.55, s * 0.8, s * 0.32, '#8a92a0', '#5a626e');
      // dish
      ctx.fillStyle = '#b8c4d0';
      ctx.beginPath(); ctx.ellipse(s * 0.5, s * 0.38, s * 0.28, s * 0.2, 0, 0, 7); ctx.fill();
      ctx.fillStyle = '#7f9db8';
      ctx.beginPath(); ctx.ellipse(s * 0.5, s * 0.38, s * 0.18, s * 0.12, 0, 0, 7); ctx.fill();
      if (b.swReady) {
        const gl = 0.5 + 0.5 * Math.sin(game.renderT * 6);
        ctx.fillStyle = `rgba(140,230,255,${gl})`;
        ctx.beginPath(); ctx.arc(s * 0.5, s * 0.38, s * 0.07, 0, 7); ctx.fill();
      }
    } else if (fac === 'dynasty') {
      box3d(s * 0.08, s * 0.1, s * 0.84, s * 0.76, '#867e6a', '#57503e');
      // silo doors
      ctx.fillStyle = '#4c463a';
      ctx.beginPath(); ctx.arc(s * 0.5, s * 0.48, s * 0.28, 0, 7); ctx.fill();
      ctx.strokeStyle = '#2c2a22'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(s * 0.22, s * 0.48); ctx.lineTo(s * 0.78, s * 0.48); ctx.stroke();
      if (b.swReady) {
        // doors open, missile visible
        ctx.fillStyle = '#1c1a14';
        ctx.beginPath(); ctx.arc(s * 0.5, s * 0.48, s * 0.22, 0, 7); ctx.fill();
        ctx.fillStyle = '#d0d0c8';
        ctx.beginPath(); ctx.arc(s * 0.5, s * 0.48, s * 0.09, 0, 7); ctx.fill();
        ctx.fillStyle = '#a02818';
        ctx.beginPath(); ctx.arc(s * 0.5, s * 0.48, s * 0.04, 0, 7); ctx.fill();
      }
      ctx.fillStyle = '#e8c33c';
      for (let i = 0; i < 8; i++) {
        const a = i * Math.PI / 4;
        ctx.save(); ctx.translate(s * 0.5, s * 0.48); ctx.rotate(a);
        ctx.fillRect(s * 0.3, -2, s * 0.05, 4); ctx.restore();
      }
    } else {
      // cartel rocket rack
      box3d(s * 0.08, s * 0.6, s * 0.84, s * 0.28, '#9a8f6c', '#6e6448');
      ctx.fillStyle = '#57503c';
      roundRect(s * 0.15, s * 0.15, s * 0.7, s * 0.45, 4); ctx.fill();
      for (let ry = 0; ry < 3; ry++) for (let rx = 0; rx < 4; rx++) {
        ctx.fillStyle = b.swReady ? '#c03a20' : '#14120e';
        ctx.beginPath();
        ctx.arc(s * 0.24 + rx * s * 0.17, s * 0.24 + ry * s * 0.14, s * 0.045, 0, 7);
        ctx.fill();
      }
    }
    // countdown text
    if (!b.swReady && b.constructed) {
      ctx.fillStyle = '#ffe9a0'; ctx.font = `bold 12px monospace`;
      ctx.textAlign = 'center';
      ctx.fillText(U.fmtTime(b.swTimer), s * 0.5, s + 12);
      ctx.textAlign = 'left';
    }
  }

  /* ================= projectiles ================= */
  function drawProjectiles() {
    for (const p of game.projs) {
      switch (p.kind) {
        case 'shell':
          ctx.fillStyle = '#3a362c';
          ctx.beginPath(); ctx.arc(p.x, p.y, 2.6, 0, 7); ctx.fill();
          break;
        case 'missile': {
          ctx.save();
          ctx.translate(p.x, p.y); ctx.rotate(p.ang);
          ctx.fillStyle = '#d8d4c8'; ctx.fillRect(-5, -1.6, 10, 3.2);
          ctx.fillStyle = '#ffab40'; ctx.fillRect(-8, -1.2, 3, 2.4);
          ctx.restore();
          break;
        }
        case 'flak':
          ctx.fillStyle = '#e8c33c';
          ctx.beginPath(); ctx.arc(p.x, p.y, 2, 0, 7); ctx.fill();
          break;
        case 'arty': {
          ctx.fillStyle = 'rgba(0,0,0,0.2)';
          ctx.beginPath(); ctx.arc(p.x, p.y, 2.4, 0, 7); ctx.fill();  // ground shadow
          ctx.fillStyle = '#2e2b22';
          ctx.beginPath(); ctx.arc(p.x, p.y - p.z, 3.2, 0, 7); ctx.fill();
          break;
        }
        case 'nukebomb': {
          // heavy finned device with a growing ground shadow as it falls
          const kk = U.clamp(p.t / p.fly, 0, 1);
          ctx.fillStyle = 'rgba(0,0,0,0.3)';
          ctx.beginPath(); ctx.ellipse(p.tx, p.ty, 5 + 7 * kk, 3 + 4 * kk, 0, 0, 7); ctx.fill();
          const by = p.y - p.z;
          ctx.fillStyle = '#3a3630';
          ctx.beginPath(); ctx.ellipse(p.x, by, 4.5, 7, 0, 0, 7); ctx.fill();
          ctx.fillStyle = '#201d18';
          ctx.beginPath();
          ctx.moveTo(p.x - 4, by + 5); ctx.lineTo(p.x, by + 10); ctx.lineTo(p.x + 4, by + 5);
          ctx.closePath(); ctx.fill();
          ctx.fillStyle = '#c9a227';
          ctx.fillRect(p.x - 4.5, by - 1.5, 9, 2);
          break;
        }
        case 'napalm': {
          ctx.fillStyle = 'rgba(0,0,0,0.2)';
          ctx.beginPath(); ctx.ellipse(p.x, p.y, 5, 3, 0, 0, 7); ctx.fill();
          ctx.fillStyle = '#8a4a1c';
          ctx.beginPath(); ctx.ellipse(p.x, p.y - p.z, 6, 4, 0, 0, 7); ctx.fill();
          break;
        }
        case 'bomb': {
          // falling from the sky onto tx,ty
          const k = U.clamp(p.t / p.fly, 0, 1);
          if (k > 0.55) {
            const h = (1 - (k - 0.55) / 0.45) * 320;
            ctx.fillStyle = 'rgba(0,0,0,0.25)';
            ctx.beginPath(); ctx.arc(p.tx, p.ty, 6 * (1 - h / 340), 0, 7); ctx.fill();
            ctx.fillStyle = p.beam ? '#bfe8ff' : '#2e2b22';
            ctx.beginPath(); ctx.arc(p.tx, p.ty - h, p.beam ? 3 : 4, 0, 7); ctx.fill();
          }
          break;
        }
      }
    }
  }

  /* ================= selection / overlays ================= */
  function drawSelectionOverlays() {
    for (const e of INPUT.selection) {
      if (e.dead) continue;
      const r = e.kind === 'building' ? e.size * TILE * 0.55 : e.radius + 7;
      const ep = game.players[e.owner];
      const bracketCol = e.owner === 0 ? '#9fdc7c' :
        (ep && ep.team === game.players[0].team ? '#8fd4e8' : '#dc7c7c');
      drawBrackets(e.x, e.y, r, bracketCol);
      // detector scan ring
      if (e.kind === 'unit' && e.def.detect) {
        ctx.strokeStyle = 'rgba(127,212,255,0.4)'; ctx.lineWidth = 1.5;
        ctx.setLineDash([5, 7]);
        ctx.beginPath(); ctx.arc(e.x, e.y, e.def.detect, 0, 7); ctx.stroke();
        ctx.setLineDash([]);
      }
      // repair bay range ring
      if (e.kind === 'building' && e.key === 'repairbay' && e.constructed) {
        ctx.strokeStyle = 'rgba(127,212,255,0.35)'; ctx.lineWidth = 1.5;
        ctx.setLineDash([8, 8]);
        ctx.beginPath(); ctx.arc(e.x, e.y, e.def.healRadius, 0, 7); ctx.stroke();
        ctx.setLineDash([]);
      }
      // defensive emplacement: firing envelope, plus a lock line to a hand-picked target
      if (e.kind === 'building' && e.def.weaponByFaction && e.constructed) {
        const w = buildingWeapon(e);
        if (w) {
          ctx.strokeStyle = 'rgba(232,195,60,0.30)'; ctx.lineWidth = 1.5;
          ctx.setLineDash([9, 9]);
          ctx.beginPath(); ctx.arc(e.x, e.y, w.range, 0, 7); ctx.stroke();
          if (w.minRange) {
            ctx.strokeStyle = 'rgba(224,85,64,0.35)';
            ctx.beginPath(); ctx.arc(e.x, e.y, w.minRange, 0, 7); ctx.stroke();
          }
          ctx.setLineDash([]);
          const ft = e.forcedTargetId ? game.byId.get(e.forcedTargetId) : null;
          if (ft && !ft.dead) {
            ctx.strokeStyle = 'rgba(255,90,70,0.75)'; ctx.lineWidth = 1.5;
            ctx.setLineDash([5, 5]);
            ctx.beginPath(); ctx.moveTo(e.x, e.y); ctx.lineTo(ft.x, ft.y); ctx.stroke();
            ctx.setLineDash([]);
            ctx.strokeStyle = '#ff5a46';
            ctx.beginPath(); ctx.arc(ft.x, ft.y, 13, 0, 7); ctx.stroke();
            ctx.beginPath();
            ctx.moveTo(ft.x - 18, ft.y); ctx.lineTo(ft.x - 8, ft.y);
            ctx.moveTo(ft.x + 8, ft.y); ctx.lineTo(ft.x + 18, ft.y);
            ctx.moveTo(ft.x, ft.y - 18); ctx.lineTo(ft.x, ft.y - 8);
            ctx.moveTo(ft.x, ft.y + 8); ctx.lineTo(ft.x, ft.y + 18);
            ctx.stroke();
          }
        }
      }
      // rally point for production buildings
      if (e.kind === 'building' && e.owner === 0 && (bTrains(e.key, game.players[0].faction).length || e.def.trains)) {
        ctx.strokeStyle = 'rgba(159,220,124,0.5)'; ctx.lineWidth = 1.5;
        ctx.setLineDash([6, 6]);
        ctx.beginPath(); ctx.moveTo(e.x, e.y); ctx.lineTo(e.rallyX, e.rallyY); ctx.stroke();
        ctx.setLineDash([]);
        ctx.strokeStyle = '#9fdc7c';
        ctx.beginPath(); ctx.arc(e.rallyX, e.rallyY, 7, 0, 7); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(e.rallyX, e.rallyY - 11); ctx.lineTo(e.rallyX, e.rallyY + 11);
        ctx.moveTo(e.rallyX - 11, e.rallyY); ctx.lineTo(e.rallyX + 11, e.rallyY); ctx.stroke();
      }
      // air patrol post marker
      if (e.kind === 'unit' && e.owner === 0 && e.def.air && e.guardPost) {
        ctx.strokeStyle = 'rgba(143,212,232,0.55)'; ctx.lineWidth = 1.5;
        ctx.setLineDash([7, 7]);
        ctx.beginPath(); ctx.arc(e.guardPost.x, e.guardPost.y, 110, 0, 7); ctx.stroke();
        ctx.setLineDash([]);
        ctx.font = '13px sans-serif'; ctx.textAlign = 'center';
        ctx.fillStyle = 'rgba(143,212,232,0.8)';
        ctx.fillText('🛡', e.guardPost.x, e.guardPost.y + 4);
        ctx.textAlign = 'left';
      }
      // move order line
      if (e.kind === 'unit' && e.owner === 0 && e.path && e.pathI < e.path.length) {
        const last = e.path[e.path.length - 1];
        ctx.strokeStyle = 'rgba(159,220,124,0.25)'; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(e.x, e.y); ctx.lineTo(last.x, last.y); ctx.stroke();
      }
    }
  }

  function drawZone(z) {
    const humanTeam = game.players[0].team;
    const col = z.owner < 0 ? '#c8c2ac' : (z.owner === humanTeam ? '#6ee06e' : '#ff6a50');
    const pulse = z.contested ? 0.5 + 0.4 * Math.sin(game.renderT * 8) : 0.75;

    // zone ring
    ctx.save();
    ctx.globalAlpha = pulse;
    ctx.strokeStyle = col; ctx.lineWidth = 2.5;
    ctx.setLineDash([12, 9]);
    ctx.lineDashOffset = -game.renderT * 18;
    ctx.beginPath(); ctx.arc(z.x, z.y, z.r, 0, 7); ctx.stroke();
    ctx.setLineDash([]);
    ctx.globalAlpha = 0.10 * (z.contested ? 2 : 1);
    ctx.fillStyle = col;
    ctx.beginPath(); ctx.arc(z.x, z.y, z.r, 0, 7); ctx.fill();
    ctx.globalAlpha = 1;

    // banner pole with waving team flag
    ctx.strokeStyle = '#3a352a'; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(z.x, z.y + 12); ctx.lineTo(z.x, z.y - 34); ctx.stroke();
    const wv = game.renderT * 6;
    ctx.fillStyle = col;
    ctx.beginPath();
    ctx.moveTo(z.x, z.y - 34);
    for (let i = 0; i <= 5; i++) ctx.lineTo(z.x + i * 5, z.y - 34 + Math.sin(wv + i) * 1.8);
    for (let i = 5; i >= 0; i--) ctx.lineTo(z.x + i * 5, z.y - 20 + Math.sin(wv + i) * 1.8);
    ctx.closePath(); ctx.fill();

    // label + capture progress
    ctx.font = 'bold 12px sans-serif'; ctx.textAlign = 'center';
    ctx.fillStyle = '#000000aa';
    ctx.fillText(z.kind === 'dom' ? '⚑ DOMINATION' : '💰 TRADE +30%', z.x + 1, z.y + z.r + 17);
    ctx.fillStyle = col;
    ctx.fillText(z.kind === 'dom' ? '⚑ DOMINATION' : '💰 TRADE +30%', z.x, z.y + z.r + 16);
    if (z.capT > 0 && z.capTeam >= 0) {
      const capCol = z.capTeam === humanTeam ? '#6ee06e' : '#ff6a50';
      ctx.strokeStyle = capCol; ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.arc(z.x, z.y, 24, -Math.PI / 2, -Math.PI / 2 + (z.capT / DOM_CAPTURE_TIME) * Math.PI * 2);
      ctx.stroke();
    }
    if (z.contested) {
      ctx.fillStyle = '#ffd76a';
      ctx.fillText('CONTESTED', z.x, z.y + z.r + 32);
    }
    ctx.textAlign = 'left';
    ctx.restore();
  }

  function drawBrackets(x, y, r, color) {
    ctx.strokeStyle = color; ctx.lineWidth = 2;
    const l = Math.max(5, r * 0.4);
    for (const [dx, dy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
      ctx.beginPath();
      ctx.moveTo(x + dx * r, y + dy * r - dy * l);
      ctx.lineTo(x + dx * r, y + dy * r);
      ctx.lineTo(x + dx * r - dx * l, y + dy * r);
      ctx.stroke();
    }
  }

  function drawHpBar(e) {
    const sel = INPUT.selection.includes(e);
    if (!sel && e.hp >= e.maxHp) return;
    const w = e.kind === 'building' ? e.size * TILE * 0.8 : Math.max(20, e.radius * 2.4);
    const x = e.x - w / 2;
    const y = e.kind === 'building' ? e.ty * TILE - 14 : e.y - (e.def.air ? 26 : e.radius + 14);
    const f = U.clamp(e.hp / e.maxHp, 0, 1);
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    ctx.fillRect(x - 1, y - 1, w + 2, 5);
    ctx.fillStyle = f > 0.6 ? '#54c454' : f > 0.3 ? '#e8c33c' : '#e05540';
    ctx.fillRect(x, y, w * f, 3);
    // veterancy chevrons
    if (e.kind === 'unit' && e.vetRank > 0) {
      ctx.fillStyle = '#ffd76a'; ctx.font = 'bold 9px sans-serif';
      ctx.fillText('★'.repeat(e.vetRank), x + w + 3, y + 4);
    }
  }

  /* ================= placement ghost ================= */
  function drawPlacement() {
    const pl = INPUT.placing;
    const def = BUILDINGS[pl.key];
    const m = INPUT.mouse;
    const wx = toWorldX(m.x), wy = toWorldY(m.y);
    const tx = Math.floor(wx / TILE) - Math.floor(def.size / 2);
    const ty = Math.floor(wy / TILE) - Math.floor(def.size / 2);
    pl.tx = tx; pl.ty = ty;
    const ok = world.canPlace(tx, ty, def.size, 0);
    pl.ok = ok;
    ctx.save();
    ctx.scale(game.cam.zoom, game.cam.zoom);
    ctx.translate(-game.cam.x, -game.cam.y);
    for (let y = 0; y < def.size; y++) for (let x = 0; x < def.size; x++) {
      const free = world.passable(tx + x, ty + y) && (world.explored[world.idx(tx + x, ty + y)] || 0);
      ctx.fillStyle = ok ? 'rgba(120,220,120,0.35)' : (free ? 'rgba(220,200,120,0.3)' : 'rgba(220,80,60,0.4)');
      ctx.fillRect((tx + x) * TILE + 1, (ty + y) * TILE + 1, TILE - 2, TILE - 2);
    }
    ctx.globalAlpha = 0.55;
    const fake = { key: pl.key, def, tx, ty, size: def.size, owner: 0, constructed: true,
      buildProgress: 1, swReady: false, swTimer: def.swTimer || 0, queue: [], tAngle: 0 };
    drawBuildingSprite(fake, !ok);
    ctx.restore();
  }

  /* ================= cursor ================= */
  function drawCursor() {
    const m = INPUT.mouse;
    if (m.x < 0) return;
    const mode = INPUT.cursorMode;
    ctx.save();
    ctx.translate(m.x, m.y);
    ctx.lineWidth = 2;
    if (mode === 'attack') {
      ctx.strokeStyle = '#ff5540';
      ctx.beginPath(); ctx.arc(0, 0, 11, 0, 7); ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(-15, 0); ctx.lineTo(-6, 0); ctx.moveTo(6, 0); ctx.lineTo(15, 0);
      ctx.moveTo(0, -15); ctx.lineTo(0, -6); ctx.moveTo(0, 6); ctx.lineTo(0, 15);
      ctx.stroke();
    } else if (mode === 'repair') {
      ctx.strokeStyle = '#7fd4ff';
      ctx.font = 'bold 16px sans-serif'; ctx.fillStyle = '#7fd4ff';
      ctx.fillText('🔧', -8, 6);
    } else if (mode === 'harvest') {
      ctx.strokeStyle = '#ffd76a';
      ctx.beginPath(); ctx.arc(0, 0, 10, 0, 7); ctx.stroke();
      ctx.fillStyle = '#ffd76a'; ctx.font = 'bold 11px sans-serif';
      ctx.fillText('$', -3, 4);
    } else if (mode === 'target') {
      ctx.strokeStyle = '#ff9540';
      ctx.beginPath(); ctx.arc(0, 0, 12, 0, 7); ctx.stroke();
      ctx.beginPath(); ctx.arc(0, 0, 3, 0, 7); ctx.stroke();
    } else {
      // default arrow
      ctx.fillStyle = '#f0ead0';
      ctx.strokeStyle = '#1c1a14';
      ctx.beginPath();
      ctx.moveTo(0, 0); ctx.lineTo(0, 17); ctx.lineTo(4.4, 13); ctx.lineTo(7.5, 19.5);
      ctx.lineTo(10.5, 18); ctx.lineTo(7.4, 11.7); ctx.lineTo(12.6, 11.2);
      ctx.closePath(); ctx.fill(); ctx.stroke();
    }
    ctx.restore();
  }

  /* ================= minimap ================= */
  function buildMinimapBase() {
    mmBase = document.createElement('canvas');
    mmBase.width = world.w; mmBase.height = world.h;
    const c = mmBase.getContext('2d');
    for (let y = 0; y < world.h; y++) for (let x = 0; x < world.w; x++) {
      const t = world.terrain[world.idx(x, y)];
      c.fillStyle = t === 2 ? '#57503f' : t === 1 ? '#a8895a' : '#c2a26a';
      c.fillRect(x, y, 1, 1);
    }
  }

  function drawMinimap(mmCanvas) {
    const c = mmCanvas.getContext('2d');
    const w = mmCanvas.width, h = mmCanvas.height;
    c.imageSmoothingEnabled = false;
    c.drawImage(mmBase, 0, 0, world.w, world.h, 0, 0, w, h);
    const sx = w / world.w, sy = h / world.h;

    // docks
    for (const d of world.docks) {
      if (d.amount <= 0) continue;
      c.fillStyle = '#4a90d8';
      c.fillRect(d.x / TILE * sx - 2, d.y / TILE * sy - 2, 4, 4);
    }
    // entities (enemies only when visible or remembered as ghosts)
    const humanTeam = game.players[0].team;
    for (const e of game.ents) {
      if (e.dead || e.embarked) continue;
      const p = game.players[e.owner];
      const hostile = e.owner !== -1 && p && p.team !== humanTeam;
      if (hostile && !world.isVisible(e.x, e.y) &&
          !(e.kind === 'building' && ghosts.has(e.id))) continue;
      if (hostile && isStealthed(e) && !isDetectedBy(e, humanTeam)) continue;
      c.fillStyle = e.owner === -1 ? '#999' : p.color;
      const s = e.kind === 'building' ? Math.max(3, e.size * sx) : 2;
      c.fillRect(e.x / TILE * sx - s / 2, e.y / TILE * sy - s / 2, s, s);
    }
    // superweapon sites & silos: public knowledge — blinking warning through the fog
    for (const e of game.ents) {
      if (e.dead || e.kind !== 'building' || e.key !== 'superweapon') continue;
      const px = e.x / TILE * sx, py = e.y / TILE * sy;
      const friendly = game.players[e.owner] && game.players[e.owner].team === humanTeam;
      const blink = Math.floor(game.renderT * 3) % 2 === 0;
      if (blink || friendly) {
        c.fillStyle = friendly ? '#ffd76a' : '#ff4030';
        c.beginPath();
        c.moveTo(px, py - 5); c.lineTo(px + 4.5, py + 3); c.lineTo(px - 4.5, py + 3);
        c.closePath(); c.fill();
        c.fillStyle = '#000';
        c.fillRect(px - 0.7, py - 2.5, 1.4, 3);
        c.fillRect(px - 0.7, py + 1.2, 1.4, 1.2);
      }
    }
    // fog overlay
    c.globalAlpha = 1;
    c.drawImage(fogCv, 0, 0, fogCv.width, fogCv.height, 0, 0, w, h);

    // control point markers
    const humanTeam2 = game.players[0].team;
    for (const z of game.zones) {
      const col = z.owner < 0 ? '#ddd' : (z.owner === humanTeam2 ? '#6ee06e' : '#ff6a50');
      c.fillStyle = col;
      c.strokeStyle = '#000';
      c.lineWidth = 1;
      const mx = z.x / TILE * sx, my = z.y / TILE * sy;
      c.beginPath(); c.arc(mx, my, 4.5, 0, 7); c.fill(); c.stroke();
      c.fillStyle = '#000';
      c.font = 'bold 7px sans-serif'; c.textAlign = 'center';
      c.fillText(z.kind === 'dom' ? '⚑' : '$', mx, my + 2.6);
      c.textAlign = 'left';
    }

    // pings
    for (const ping of UI.pings) {
      const k = (game.t - ping.t0) % 1;
      c.strokeStyle = ping.color; c.lineWidth = 2;
      c.globalAlpha = 1 - k;
      c.beginPath();
      c.arc(ping.x / TILE * sx, ping.y / TILE * sy, 3 + k * 9, 0, 7);
      c.stroke();
      c.globalAlpha = 1;
    }
    // camera rect
    c.strokeStyle = '#f0ead0'; c.lineWidth = 1;
    c.strokeRect(game.cam.x / TILE * sx, game.cam.y / TILE * sy,
      (W / game.cam.zoom) / TILE * sx, (H / game.cam.zoom) / TILE * sy);
  }

  return {
    init, buildTerrain, frame, refreshFogCanvas, addDecal, addRubble, addWreck, addTrack, drawMinimap, cleanGhost,
    toScreenX, toScreenY, toWorldX, toWorldY,
    get W() { return W; }, get H() { return H; },
  };

  function roundRect(x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }
})();
