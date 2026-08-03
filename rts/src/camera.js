// camera.js — RTS camera rig: ground-target pan (WASD/edge/MMB-drag), wheel
// zoom, Q/E rotate. OWNED BY: core scaffold (input.js may call public api).
import * as THREE from 'three';
import { G, HALF, clamp, damp, SHOT_MODE } from './core.js';

const PITCH = 0.94;         // rad below horizontal at max zoom (GZH ~52°)
const PITCH_NEAR = 0.72;    // shallower when zoomed close
const ZOOM_MIN = 34, ZOOM_MAX = 170, ZOOM_START = 120;

export class CameraRig {
  constructor() {
    this.tx = 0; this.tz = 0;            // look-at target (smoothed toward gx/gz)
    this.gx = 0; this.gz = 0;            // goal target
    this.yaw = Math.PI * 0.25;           // rad; 0 = looking north(-z)... aesthetic start
    this.gyaw = this.yaw;
    this.zoom = ZOOM_START; this.gzoom = ZOOM_START;
    this.keys = new Set();
    this.edgeEnabled = !SHOT_MODE;
    this.mmb = false;
    this._lastMx = 0; this._lastMy = 0;
    G.camRig = this;
  }

  jumpTo(x, z, yaw = null) {
    this.gx = this.tx = clamp(x, -HALF + 10, HALF - 10);
    this.gz = this.tz = clamp(z, -HALF + 10, HALF - 10);
    if (yaw !== null) this.gyaw = this.yaw = yaw;
    this.apply();
  }
  panTo(x, z) { this.gx = clamp(x, -HALF + 10, HALF - 10); this.gz = clamp(z, -HALF + 10, HALF - 10); }

  attach(dom) {
    addEventListener('keydown', (e) => {
      if (G.state !== 'playing') return;
      this.keys.add(e.code);
      if (e.code === 'KeyQ') this.gyaw += Math.PI / 4;
      if (e.code === 'KeyE') this.gyaw -= Math.PI / 4;
    });
    addEventListener('keyup', (e) => this.keys.delete(e.code));
    addEventListener('blur', () => this.keys.clear());
    dom.addEventListener('wheel', (e) => {
      if (G.state !== 'playing') return;
      this.gzoom = clamp(this.gzoom * (e.deltaY > 0 ? 1.13 : 0.885), ZOOM_MIN, ZOOM_MAX);
      e.preventDefault();
    }, { passive: false });
    dom.addEventListener('pointerdown', (e) => {
      if (e.button === 1) { this.mmb = true; this._lastMx = e.clientX; this._lastMy = e.clientY; e.preventDefault(); }
    });
    addEventListener('pointerup', (e) => { if (e.button === 1) this.mmb = false; });
    addEventListener('pointermove', (e) => {
      this._mx = e.clientX; this._my = e.clientY;
      if (this.mmb && G.state === 'playing') {
        const k = this.zoom / innerHeight * 1.6;
        this.panBy((this._lastMx - e.clientX) * k, (this._lastMy - e.clientY) * k);
        this._lastMx = e.clientX; this._lastMy = e.clientY;
      }
    });
  }

  panBy(rightAmt, fwdAmt) {
    const s = Math.sin(this.yaw), c = Math.cos(this.yaw);
    this.gx = clamp(this.gx + rightAmt * c - fwdAmt * s, -HALF + 10, HALF - 10);
    this.gz = clamp(this.gz - rightAmt * s - fwdAmt * c, -HALF + 10, HALF - 10);
  }

  update(dt) {
    if (G.state === 'playing') {
      const spd = this.zoom * 1.5 * dt;
      let rx = 0, fz = 0;
      if (this.keys.has('KeyW') || this.keys.has('ArrowUp')) fz += 1;
      if (this.keys.has('KeyS') && !this.keys.has('ShiftLeft')) fz -= 1;   // S also = stop; input.js filters
      if (this.keys.has('ArrowDown')) fz -= 1;
      if (this.keys.has('KeyA') || this.keys.has('ArrowLeft')) rx -= 1;
      if (this.keys.has('KeyD') || this.keys.has('ArrowRight')) rx += 1;
      // edge scroll
      if (this.edgeEnabled && this._mx !== undefined && !document.querySelector('.overlay:not(.hidden)')) {
        const M = 14;
        if (this._mx < M) rx -= 1; else if (this._mx > innerWidth - M) rx += 1;
        if (this._my < M) fz += 1; else if (this._my > innerHeight - M) fz -= 1;
      }
      if (rx || fz) { const l = Math.hypot(rx, fz); this.panBy(rx / l * spd, fz / l * spd); }
    }
    this.tx = damp(this.tx, this.gx, 8, dt);
    this.tz = damp(this.tz, this.gz, 8, dt);
    this.yaw = damp(this.yaw, this.gyaw, 7, dt);
    this.zoom = damp(this.zoom, this.gzoom, 7, dt);
    this.apply();
  }

  apply() {
    const groundY = G.groundHeight ? G.groundHeight(this.tx, this.tz) : 0;
    const t = (this.zoom - ZOOM_MIN) / (ZOOM_MAX - ZOOM_MIN);
    const pitch = PITCH_NEAR + (PITCH - PITCH_NEAR) * t;
    const horiz = Math.cos(pitch) * this.zoom;
    const cam = G.camera;
    cam.position.set(
      this.tx - Math.sin(this.yaw) * horiz,
      groundY + Math.sin(pitch) * this.zoom,
      this.tz - Math.cos(this.yaw) * horiz);
    cam.lookAt(this.tx, groundY + 2, this.tz);
  }

  // ground point under a screen position (for input + minimap)
  raycastGround(clientX, clientY, out = new THREE.Vector3()) {
    const ndc = new THREE.Vector2((clientX / innerWidth) * 2 - 1, -(clientY / innerHeight) * 2 + 1);
    const ray = new THREE.Raycaster();
    ray.setFromCamera(ndc, G.camera);
    // iterative heightfield march (terrain isn't a plane)
    const o = ray.ray.origin, d = ray.ray.direction;
    let t = 0;
    for (let i = 0; i < 160; i++) {
      const px = o.x + d.x * t, py = o.y + d.y * t, pz = o.z + d.z * t;
      const h = G.groundHeight ? G.groundHeight(px, pz) : 0;
      if (py <= h + 0.05) { out.set(px, h, pz); return out; }
      t += Math.max(0.5, (py - h) * 0.5);
      if (t > 1200) break;
    }
    out.set(o.x + d.x * 300, 0, o.z + d.z * 300);
    return out;
  }
}
