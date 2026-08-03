// input.js — mouse/keyboard orders: click & drag-select, context right-click
// (move/attack/harvest/capture/repair), control groups, attack-move,
// placement mode, idle-worker cycling, custom cursor. OWNED BY: ui agent.
// STATUS: MINIMAL working slice (select + move + attack) — extend per
// contract in module header of hud.js and production.js.
import * as THREE from 'three';
import { G, emit } from './core.js';
import { orderMove, orderStop } from './move.js';
import { orderAttack } from './combat.js';
import { entityAt } from './entities.js';

const $ = (id) => document.getElementById(id);

export class Input {
  init() {
    const canvas = $('game');
    this.selbox = $('selbox');
    this.down = null;
    canvas.classList.add('show-cursor');
    canvas.addEventListener('pointerdown', (e) => this.onDown(e));
    addEventListener('pointermove', (e) => this.onMove(e));
    addEventListener('pointerup', (e) => this.onUp(e));
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    addEventListener('keydown', (e) => this.onKey(e));
    this.groups = {};
  }
  onDown(e) {
    if (G.state !== 'playing') return;
    if (e.button === 0) this.down = { x: e.clientX, y: e.clientY, drag: false };
  }
  onMove(e) {
    if (!this.down) return;
    const dx = Math.abs(e.clientX - this.down.x), dy = Math.abs(e.clientY - this.down.y);
    if (dx > 5 || dy > 5) this.down.drag = true;
    if (this.down.drag) {
      const b = this.selbox;
      b.style.display = 'block';
      b.style.left = Math.min(e.clientX, this.down.x) + 'px';
      b.style.top = Math.min(e.clientY, this.down.y) + 'px';
      b.style.width = dx + 'px';
      b.style.height = dy + 'px';
    }
  }
  onUp(e) {
    if (G.state !== 'playing') { this.down = null; return; }
    if (e.button === 0 && this.down) {
      if (this.down.drag) this.dragSelect(this.down, e);
      else this.clickSelect(e);
      this.selbox.style.display = 'none';
      this.down = null;
    } else if (e.button === 2) {
      this.contextOrder(e);
    }
  }
  clickSelect(e) {
    const p = G.camRig.raycastGround(e.clientX, e.clientY);
    const ent = entityAt(p.x, p.z, 5);
    for (const s of G.sel) s.sel = false;
    G.sel = ent && ent.owner === G.humanId ? [ent] : [];
    if (G.sel[0]) G.sel[0].sel = true;
    emit('sel:changed');
  }
  dragSelect(a, e) {
    const x0 = Math.min(a.x, e.clientX), x1 = Math.max(a.x, e.clientX);
    const y0 = Math.min(a.y, e.clientY), y1 = Math.max(a.y, e.clientY);
    const v = new THREE.Vector3();
    for (const s of G.sel) s.sel = false;
    G.sel = G.units.filter(u => {
      if (u.owner !== G.humanId || !u.alive) return false;
      v.copy(u.pos).project(G.camera);
      const sx = (v.x + 1) / 2 * innerWidth, sy = (-v.y + 1) / 2 * innerHeight;
      return sx >= x0 && sx <= x1 && sy >= y0 && sy <= y1;
    });
    for (const s of G.sel) s.sel = true;
    emit('sel:changed');
  }
  contextOrder(e) {
    if (!G.sel.length) return;
    const p = G.camRig.raycastGround(e.clientX, e.clientY);
    const ent = entityAt(p.x, p.z, 4);
    const mine = G.sel.filter(s => s.owner === G.humanId && s.kind === 'unit');
    if (!mine.length) return;
    if (ent && ent.owner !== G.humanId && ent.owner !== -1) orderAttack(mine, ent);
    else orderMove(mine, p.x, p.z);
  }
  onKey(e) {
    if (G.state !== 'playing') return;
    if (e.code === 'KeyS' && !e.ctrlKey) orderStop(G.sel);
    if (e.code === 'KeyH') {
      const p = G.players[G.humanId];
      G.camRig.panTo(p.baseX, p.baseZ);
    }
    if (/^Digit[1-9]$/.test(e.code)) {
      const n = e.code[5];
      if (e.ctrlKey) { this.groups[n] = [...G.sel]; e.preventDefault(); }
      else if (this.groups[n]?.length) {
        for (const s of G.sel) s.sel = false;
        G.sel = this.groups[n].filter(u => u.alive);
        for (const s of G.sel) s.sel = true;
        emit('sel:changed');
      }
    }
  }
}
