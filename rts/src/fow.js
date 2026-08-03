// fow.js — fog of war: unexplored black, explored dim, visible clear.
// OWNED BY: ui agent.
// Design: 128×128 vis grid over the world. Own entities reveal sight radius.
// States per cell: 0 unexplored, 1 explored, 2 visible (decays to 1).
// Render: one ground-hugging plane with an alpha CanvasTexture updated at
// ~8Hz (canvas blurred for soft edges); minimap consumes the same canvas via
// G.fow.canvas. Enemy meshes culled by visibility (buildings stay as ghosts
// once seen — e.seenByHuman; air units show over explored).
// API: initFow(); tickFow(dt); G.fow.visibleAt(x,z)->0|1|2;
// SHOT_MODE disables fog entirely (reveal all) for screenshots.
import * as THREE from 'three';
import { G, WORLD_SIZE, HALF, SHOT_MODE, clamp } from './core.js';

const N = 128;
const CS = WORLD_SIZE / N;
const A_UNEXPLORED = 251;   // canvas alpha 0..255
const A_EXPLORED = 136;
const TICK = 1 / 8;

class FogOfWar {
  constructor() {
    this.enabled = !SHOT_MODE;
    this.explored = new Uint8Array(N * N);
    this.visStamp = new Uint32Array(N * N);
    this.stamp = 1;
    this.alpha = new Float32Array(N * N).fill(A_UNEXPLORED);
    // canvas consumed by both the 3D overlay texture and the minimap
    this.canvas = document.createElement('canvas');
    this.canvas.width = N; this.canvas.height = N;
    this.cx = this.canvas.getContext('2d');
    this.raw = document.createElement('canvas');
    this.raw.width = N; this.raw.height = N;
    this.rcx = this.raw.getContext('2d');
    this.img = this.rcx.createImageData(N, N);
    this.acc = TICK; // force immediate first update
    if (this.enabled) this.buildPlane();
  }

  buildPlane() {
    const geo = new THREE.PlaneGeometry(WORLD_SIZE, WORLD_SIZE, 96, 96);
    geo.rotateX(-Math.PI / 2);
    const pos = geo.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), z = pos.getZ(i);
      pos.setY(i, (G.groundHeight ? G.groundHeight(x, z) : 0) + 0.8);
    }
    this.tex = new THREE.CanvasTexture(this.canvas);
    this.tex.minFilter = THREE.LinearFilter;
    this.tex.magFilter = THREE.LinearFilter;
    const mat = new THREE.MeshBasicMaterial({
      map: this.tex, transparent: true, depthWrite: false,
    });
    this.plane = new THREE.Mesh(geo, mat);
    this.plane.frustumCulled = false;
    this.plane.renderOrder = 6;
    G.scene.add(this.plane);
  }

  idx(x, z) {
    const ix = clamp(Math.floor((x + HALF) / CS), 0, N - 1);
    const iz = clamp(Math.floor((z + HALF) / CS), 0, N - 1);
    return iz * N + ix;
  }

  visibleAt(x, z) {
    if (!this.enabled) return 2;
    const i = this.idx(x, z);
    if (this.visStamp[i] === this.stamp) return 2;
    return this.explored[i] ? 1 : 0;
  }

  revealCircle(x, z, r) {
    const cix = Math.floor((x + HALF) / CS), ciz = Math.floor((z + HALF) / CS);
    const cr = Math.ceil(r / CS);
    const r2 = cr * cr;
    for (let dz = -cr; dz <= cr; dz++) {
      const iz = ciz + dz;
      if (iz < 0 || iz >= N) continue;
      for (let dx = -cr; dx <= cr; dx++) {
        const ix = cix + dx;
        if (ix < 0 || ix >= N) continue;
        if (dx * dx + dz * dz > r2) continue;
        const i = iz * N + ix;
        this.visStamp[i] = this.stamp;
        this.explored[i] = 1;
      }
    }
  }

  tick(dt) {
    if (!this.enabled) return;
    this.acc += dt;
    if (this.acc < TICK) return;
    this.acc = 0;
    this.stamp++;
    const me = G.humanId;
    for (const e of G.entities) {
      if (!e.alive || e.owner !== me) continue;
      this.revealCircle(e.pos.x, e.pos.z, e.sight || e.def.sight || 20);
    }
    this.redraw();
    this.cull();
  }

  redraw() {
    const d = this.img.data, a = this.alpha;
    for (let i = 0; i < N * N; i++) {
      const target = this.visStamp[i] === this.stamp ? 0
        : this.explored[i] ? A_EXPLORED : A_UNEXPLORED;
      a[i] += (target - a[i]) * 0.5;
      const j = i * 4;
      d[j] = 2; d[j + 1] = 3; d[j + 2] = 5;
      d[j + 3] = a[i] < 2 ? 0 : a[i];
    }
    this.rcx.putImageData(this.img, 0, 0);
    const cx = this.cx;
    cx.clearRect(0, 0, N, N);
    cx.filter = 'blur(1.2px)';
    cx.drawImage(this.raw, 0, 0);
    cx.filter = 'none';
    if (this.tex) this.tex.needsUpdate = true;
  }

  cull() {
    const me = G.humanId;
    // supply-dock crate piles are dressing meshes, not entities
    for (const d of (G.docks || [])) {
      if (d.mesh) d.mesh.visible = this.visibleAt(d.x, d.z) >= 1;
    }
    for (const e of G.entities) {
      if (!e.alive || !e.mesh || e.owner === me) continue;
      const v = this.visibleAt(e.pos.x, e.pos.z);
      if (e.owner === -1) {                       // neutral: show once explored
        e.mesh.visible = v >= 1;
      } else if (e.kind === 'building') {         // enemy building: ghost once seen
        if (v === 2) e.seenByHuman = true;
        e.mesh.visible = !!e.seenByHuman;
      } else {                                    // enemy unit
        e.mesh.visible = e.def.air ? v >= 1 : v === 2;
      }
    }
  }
}

export function initFow() {
  G.fow = new FogOfWar();
}

export function tickFow(dt) {
  G.fow?.tick(dt);
}
