// minimap.js — tactical map: terrain underlay, fog shading (from G.fow's
// canvas), entity blips (buildings bigger; flash white when recently hit),
// camera frustum quad, radar pings, left click/drag = pan camera,
// right-click = move order for current selection. OWNED BY: ui agent.
import { G, WORLD_SIZE, HALF, on } from './core.js';
import { orderMove } from './move.js';

export class Minimap {
  init() {
    this.cv = document.getElementById('minimap');
    this.cx = this.cv.getContext('2d');
    this.under = null;
    this.pings = [];              // {x,z,t0,color}
    this.dragging = false;

    this.cv.addEventListener('contextmenu', (e) => e.preventDefault());
    this.cv.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      const w = this.toWorld(e);
      if (e.button === 2) {
        const mine = G.sel.filter(s => s.owner === G.humanId && s.kind === 'unit' && s.alive);
        if (mine.length) {
          orderMove(mine, w.x, w.z);
          this.ping(w.x, w.z, '#9fe08a');
        }
      } else if (e.button === 0) {
        this.dragging = true;
        this.cv.setPointerCapture?.(e.pointerId);
        G.camRig.panTo(w.x, w.z);
      }
    });
    this.cv.addEventListener('pointermove', (e) => {
      if (this.dragging) {
        const w = this.toWorld(e);
        G.camRig.panTo(w.x, w.z);
      }
    });
    addEventListener('pointerup', () => { this.dragging = false; });

    on('minimap:ping', (x, z, color) => this.ping(x, z, color));
    this.renderUnderlay();
  }

  toWorld(e) {
    const r = this.cv.getBoundingClientRect();
    return {
      x: (e.clientX - r.left) / r.width * WORLD_SIZE - HALF,
      z: (e.clientY - r.top) / r.height * WORLD_SIZE - HALF,
    };
  }

  ping(x, z, color = '#ff5040') {
    this.pings.push({ x, z, t0: G.time, color });
    if (this.pings.length > 8) this.pings.shift();
  }

  renderUnderlay() {
    // coarse heightmap shading
    const W = this.cv.width, H = this.cv.height;
    const img = this.cx.createImageData(W, H);
    for (let py = 0; py < H; py++) {
      for (let px = 0; px < W; px++) {
        const x = px / W * WORLD_SIZE - HALF, z = py / H * WORLD_SIZE - HALF;
        const h = G.groundHeight(x, z);
        const hx = G.groundHeight(x + 4, z) - h;
        const shade = Math.max(0, Math.min(1, 0.55 - hx * 0.06));
        const t = Math.max(0, Math.min(1, h / 34));
        const r = 150 + t * 60, g = 128 + t * 40, b = 92 + t * 30;
        const i = (py * W + px) * 4;
        img.data[i] = r * (0.5 + shade * 0.8);
        img.data[i + 1] = g * (0.5 + shade * 0.8);
        img.data[i + 2] = b * (0.5 + shade * 0.8);
        img.data[i + 3] = 255;
      }
    }
    this.under = img;
  }

  update() {
    const cx = this.cx, W = this.cv.width, H = this.cv.height;
    cx.putImageData(this.under, 0, 0);
    const sx = W / WORLD_SIZE, sy = H / WORLD_SIZE;
    const fow = G.fow, me = G.humanId;

    // entity blips (fog-filtered)
    for (const e of G.entities) {
      if (!e.alive) continue;
      let show = true;
      if (fow?.enabled && e.owner !== me) {
        const v = fow.visibleAt(e.pos.x, e.pos.z);
        if (e.owner === -1) show = v >= 1;
        else if (e.kind === 'building') show = !!e.seenByHuman;
        else show = e.def.air ? v >= 1 : v === 2;
      }
      if (!show) continue;
      const hitFlash = e.lastHitT !== undefined && G.gameTime - e.lastHitT < 0.5;
      cx.fillStyle = hitFlash ? '#ffffff'
        : e.owner === -1 ? (e.def.capturable ? '#e8e0b0' : '#8a8474')
        : (G.players[e.owner]?.colorCss ?? '#fff');
      const px = (e.pos.x + HALF) * sx, py = (e.pos.z + HALF) * sy;
      const r = e.kind === 'building' ? (hitFlash ? 4 : 3) : 1.6;
      cx.fillRect(px - r, py - r, r * 2, r * 2);
    }

    // fog shading on top of blips' terrain (blips in fog already filtered)
    if (fow?.enabled && fow.canvas) {
      cx.drawImage(fow.canvas, 0, 0, W, H);
    }

    // radar pings
    for (let i = this.pings.length - 1; i >= 0; i--) {
      const p = this.pings[i];
      const age = G.time - p.t0;
      if (age > 2) { this.pings.splice(i, 1); continue; }
      const k = (age % 0.8) / 0.8;
      cx.strokeStyle = p.color;
      cx.globalAlpha = (1 - k) * (1 - age / 2.4);
      cx.lineWidth = 1.5;
      cx.beginPath();
      cx.arc((p.x + HALF) * sx, (p.z + HALF) * sy, 2 + k * 12, 0, Math.PI * 2);
      cx.stroke();
      cx.globalAlpha = 1;
    }

    // camera frustum quad — project the 4 screen corners to the ground
    if (G.camRig) {
      const w = innerWidth, h = innerHeight;
      const corners = [[0, 0], [w, 0], [w, h], [0, h]];
      cx.strokeStyle = '#ffffffcc';
      cx.lineWidth = 1;
      cx.beginPath();
      for (let i = 0; i < 4; i++) {
        const g = G.camRig.raycastGround(corners[i][0], corners[i][1]);
        const px = Math.max(0, Math.min(W, (g.x + HALF) * sx));
        const py = Math.max(0, Math.min(H, (g.z + HALF) * sy));
        if (i === 0) cx.moveTo(px, py); else cx.lineTo(px, py);
      }
      cx.closePath();
      cx.stroke();
    }
  }
}
