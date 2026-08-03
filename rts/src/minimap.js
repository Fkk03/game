// minimap.js — tactical map: terrain underlay, fog, entity blips, camera
// frustum, click-to-jump / right-click-order. OWNED BY: ui agent.
// STATUS: MINIMAL (terrain + blips + click-jump). Extend: fog shading from
// G.fow, frustum quad, ping animations on 'feed' attacks.
import { G, WORLD_SIZE, HALF } from './core.js';

export class Minimap {
  init() {
    this.cv = document.getElementById('minimap');
    this.cx = this.cv.getContext('2d');
    this.under = null;
    this.cv.addEventListener('pointerdown', (e) => {
      const r = this.cv.getBoundingClientRect();
      const x = (e.clientX - r.left) / r.width * WORLD_SIZE - HALF;
      const z = (e.clientY - r.top) / r.height * WORLD_SIZE - HALF;
      G.camRig.panTo(x, z);
    });
    this.renderUnderlay();
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
    const s = W / WORLD_SIZE;
    for (const e of G.entities) {
      if (!e.alive) continue;
      cx.fillStyle = e.owner === -1 ? '#c8c0a0'
        : (G.players[e.owner]?.colorCss ?? '#fff');
      const px = (e.pos.x + HALF) * s, py = (e.pos.z + HALF) * s;
      const r = e.kind === 'building' ? 3 : 1.6;
      cx.fillRect(px - r, py - r, r * 2, r * 2);
    }
    // camera target
    cx.strokeStyle = '#ffffffaa';
    const px = (G.camRig.tx + HALF) * s, py = (G.camRig.tz + HALF) * s;
    cx.strokeRect(px - 7, py - 5, 14, 10);
  }
}
