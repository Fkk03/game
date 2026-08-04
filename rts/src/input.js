// input.js — mouse/keyboard orders: click & drag-select, context right-click
// (move/attack/harvest/capture/repair), control groups, attack-move,
// placement mode, power targeting, waypoint queues, idle-worker key, custom
// cursor, selection rings + hp pips. OWNED BY: ui agent.
// Order types set here (sim/economy execute them): 'move','attackmove',
// 'attack','harvest' (order.dock),'capture' (order.target),'repair'
// (order.target). Targeted generals powers: hud sets G.pendingPower={id};
// we consume the next ground click → powers.usePower(pid,id,x,z).
import * as THREE from 'three';
import { G, emit } from './core.js';
import { orderMove, orderStop } from './move.js';
import { orderAttack } from './combat.js';
import { entityAt } from './entities.js';
import * as production from './production.js';
import * as powers from './powers.js';
import * as economy from './economy.js';
import { POWERS } from './data.js';

const $ = (id) => document.getElementById(id);

export class Input {
  init() {
    const canvas = this.canvas = $('game');
    this.selbox = $('selbox');
    this.cursor = $('cursor');
    this.down = null;
    this.armedAttack = false;      // attack-move armed (A key or hud button)
    this.hoverEmoji = '⊹';
    this._hoverT = 0;
    this._lastGroupKey = null; this._lastGroupT = 0;
    this._mx = innerWidth / 2; this._my = innerHeight / 2;
    this.groups = {};
    G.inputSys = this;

    canvas.classList.remove('show-cursor');
    this.cursor.classList.remove('hidden');
    this.cursor.style.display = 'none';    // until first pointermove

    canvas.addEventListener('pointerdown', (e) => this.onDown(e));
    addEventListener('pointermove', (e) => this.onMove(e));
    addEventListener('pointerup', (e) => this.onUp(e));
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    addEventListener('keydown', (e) => this.onKey(e), { capture: true });

    // selection ring + hp pip pools (three.js visuals owned by ui agent)
    this.ringGeo = new THREE.RingGeometry(0.82, 1, 28);
    this.ringGeo.rotateX(-Math.PI / 2);
    this.rings = [];
    this.pips = [];
  }

  // ---------------------------------------------------------- pools
  getRing(i) {
    while (this.rings.length <= i) {
      const m = new THREE.Mesh(this.ringGeo, new THREE.MeshBasicMaterial({
        color: 0x7fe27a, transparent: true, opacity: 0.85, depthWrite: false,
      }));
      m.visible = false; m.renderOrder = 3;
      G.scene.add(m);
      this.rings.push(m);
    }
    return this.rings[i];
  }
  getPip(i) {
    while (this.pips.length <= i) {
      const cv = document.createElement('canvas');
      cv.width = 40; cv.height = 6;
      const tex = new THREE.CanvasTexture(cv);
      tex.minFilter = THREE.LinearFilter;
      const s = new THREE.Sprite(new THREE.SpriteMaterial({
        map: tex, transparent: true, depthTest: false,
      }));
      s.scale.set(4.2, 0.63, 1);
      s.visible = false; s.renderOrder = 20;
      G.scene.add(s);
      this.pips.push({ s, cv, cx: cv.getContext('2d'), tex });
    }
    return this.pips[i];
  }

  // ------------------------------------------------- per-frame (via hud)
  update(dt) {
    // waypoint queues: re-issue next waypoint when a unit goes idle
    for (const u of G.units) {
      if (u.owner !== G.humanId || !u.alive || !u._wq?.length) continue;
      if (u.order.type === 'idle') {
        const wp = u._wq.shift();
        orderMove([u], wp.x, wp.z, { attackMove: wp.am });
      }
    }
    // selection rings
    let ri = 0;
    for (const s of G.sel) {
      if (!s.alive || ri >= 80) continue;
      const m = this.getRing(ri++);
      m.visible = true;
      const r = s.kind === 'building' ? s.radius * 1.45 : s.radius * 1.75 + 0.4;
      m.scale.set(r, 1, r);
      m.position.set(s.pos.x, (G.groundHeight ? G.groundHeight(s.pos.x, s.pos.z) : s.pos.y) + 0.25, s.pos.z);
    }
    for (let i = ri; i < this.rings.length; i++) this.rings[i].visible = false;
    // hp pips over damaged selected entities
    let pi = 0;
    for (const s of G.sel) {
      if (!s.alive || s.hp >= s.maxHp - 0.5 || pi >= 24) continue;
      const p = this.getPip(pi++);
      const frac = Math.max(0, s.hp / s.maxHp);
      const cx = p.cx;
      cx.clearRect(0, 0, 40, 6);
      cx.fillStyle = '#200a06'; cx.fillRect(0, 0, 40, 6);
      cx.fillStyle = frac > 0.55 ? '#52d152' : frac > 0.28 ? '#e0c040' : '#e05038';
      cx.fillRect(1, 1, 38 * frac, 4);
      p.tex.needsUpdate = true;
      p.s.visible = true;
      const h = s.kind === 'building' ? Math.max(8, s.radius * 1.1) : (s.def.air ? 4 : 3.6);
      p.s.position.set(s.pos.x, s.pos.y + h, s.pos.z);
      if (s.kind === 'building') p.s.scale.set(7, 1, 1); else p.s.scale.set(4.2, 0.63, 1);
    }
    for (let i = pi; i < this.pips.length; i++) this.pips[i].s.visible = false;
  }

  // ---------------------------------------------------------- pointer
  onDown(e) {
    if (G.state !== 'playing') return;
    if (e.button === 0) {
      if (G.placement) { production.confirmPlacement?.(); return; }
      if (G.pendingPower) { this.firePendingPower(e); return; }
      if (this.armedAttack) { this.doAttackMove(e); return; }
      this.down = { x: e.clientX, y: e.clientY, drag: false, shift: e.shiftKey };
    }
  }
  onMove(e) {
    this._mx = e.clientX; this._my = e.clientY;
    this.moveCursor(e);
    if (G.placement && G.state === 'playing') {
      const p = G.camRig.raycastGround(e.clientX, e.clientY);
      production.updatePlacement?.(p.x, p.z);
    }
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
    } else if (e.button === 2 && e.target === this.canvas) {
      if (G.placement) { production.cancelPlacement?.(); return; }
      if (G.pendingPower) { G.pendingPower = null; return; }
      if (this.armedAttack) { this.armedAttack = false; return; }
      this.contextOrder(e);
    }
  }

  // ---------------------------------------------------------- selection
  clickSelect(e) {
    const p = G.camRig.raycastGround(e.clientX, e.clientY);
    const ent = entityAt(p.x, p.z, 5);
    const additive = this.down?.shift;
    if (!additive) { for (const s of G.sel) s.sel = false; G.sel = []; }
    if (ent && ent.owner === G.humanId && ent.alive) {
      if (e.detail >= 2 && ent.kind === 'unit') {
        this.selectAllOfType(ent.def.id);
        return;
      }
      if (!G.sel.includes(ent)) G.sel.push(ent);
      ent.sel = true;
    }
    emit('sel:changed');
  }
  dragSelect(a, e) {
    const x0 = Math.min(a.x, e.clientX), x1 = Math.max(a.x, e.clientX);
    const y0 = Math.min(a.y, e.clientY), y1 = Math.max(a.y, e.clientY);
    const v = new THREE.Vector3();
    const prev = a.shift ? [...G.sel] : [];
    for (const s of G.sel) s.sel = false;
    const picked = G.units.filter(u => {
      if (u.owner !== G.humanId || !u.alive) return false;
      v.copy(u.pos).project(G.camera);
      const sx = (v.x + 1) / 2 * innerWidth, sy = (-v.y + 1) / 2 * innerHeight;
      return sx >= x0 && sx <= x1 && sy >= y0 && sy <= y1;
    });
    G.sel = [...new Set([...prev, ...picked])];
    for (const s of G.sel) s.sel = true;
    emit('sel:changed');
  }
  selectAllOfType(defId) {
    const v = new THREE.Vector3();
    for (const s of G.sel) s.sel = false;
    G.sel = G.units.filter(u => {
      if (u.owner !== G.humanId || !u.alive || u.def.id !== defId) return false;
      v.copy(u.pos).project(G.camera);
      return Math.abs(v.x) <= 1 && Math.abs(v.y) <= 1 && v.z < 1;
    });
    for (const s of G.sel) s.sel = true;
    emit('sel:changed');
  }

  // ---------------------------------------------------------- orders
  dockAt(x, z) {
    if (economy.dockAt) return economy.dockAt(x, z);
    for (const d of G.docks) {
      if (Math.hypot(d.x - x, d.z - z) < 13 && (d.left ?? d.amount) > 0) return d;
    }
    return null;
  }

  contextOrder(e) {
    if (!G.sel.length) return;
    const p = G.camRig.raycastGround(e.clientX, e.clientY);
    const ent = entityAt(p.x, p.z, 4);
    const mine = G.sel.filter(s => s.owner === G.humanId && s.kind === 'unit' && s.alive);
    if (!mine.length) return;
    const shift = e.shiftKey;

    // enemy → attack (armed units), others tag along
    if (ent && ent.alive && ent.owner !== G.humanId && ent.owner !== -1) {
      const armed = mine.filter(u => u.def.weapon);
      const rest = mine.filter(u => !u.def.weapon);
      if (armed.length) orderAttack(armed, ent);
      if (rest.length) orderMove(rest, p.x, p.z);
      emit('minimap:ping', p.x, p.z, '#ff5040');
      return;
    }
    // neutral/enemy capturable + capture-capable infantry → capture order
    if (ent && ent.alive && ent.def.capturable && ent.owner !== G.humanId) {
      const caps = mine.filter(u => u.def.canCapture);
      if (caps.length) {
        orderMove(caps, ent.pos.x, ent.pos.z);
        for (const u of caps) u.order = { type: 'capture', target: ent, x: ent.pos.x, z: ent.pos.z };
        const rest = mine.filter(u => !u.def.canCapture);
        if (rest.length) orderMove(rest, p.x, p.z);
        return;
      }
    }
    // own damaged building + builder → repair order
    if (ent && ent.alive && ent.owner === G.humanId && ent.kind === 'building' && ent.hp < ent.maxHp - 1) {
      const fixers = mine.filter(u => u.def.role === 'builder');
      if (fixers.length) {
        orderMove(fixers, ent.pos.x, ent.pos.z);
        for (const u of fixers) u.order = { type: 'repair', target: ent, x: ent.pos.x, z: ent.pos.z };
        return;
      }
    }
    // supply dock + harvesters → harvest
    const dock = this.dockAt(p.x, p.z);
    if (dock) {
      const trucks = mine.filter(u => u.def.role === 'harvester');
      if (trucks.length) {
        if (economy.orderHarvest) economy.orderHarvest(trucks, dock);
        else {
          orderMove(trucks, dock.x, dock.z);
          for (const u of trucks) u.order = { type: 'harvest', dock, x: dock.x, z: dock.z };
        }
        const rest = mine.filter(u => u.def.role !== 'harvester');
        if (rest.length) orderMove(rest, p.x, p.z);
        return;
      }
    }
    // plain ground: move (shift = queue waypoint)
    if (shift) {
      for (const u of mine) {
        u._wq ||= [];
        if (u.order.type === 'idle' && !u._wq.length) orderMove([u], p.x, p.z);
        else u._wq.push({ x: p.x, z: p.z, am: false });
      }
    } else {
      for (const u of mine) u._wq = [];
      orderMove(mine, p.x, p.z);
    }
  }

  doAttackMove(e) {
    this.armedAttack = false;
    const mine = G.sel.filter(s => s.owner === G.humanId && s.kind === 'unit' && s.alive);
    if (!mine.length) return;
    const p = G.camRig.raycastGround(e.clientX, e.clientY);
    const ent = entityAt(p.x, p.z, 4);
    if (ent && ent.alive && ent.owner !== G.humanId && ent.owner !== -1) {
      orderAttack(mine.filter(u => u.def.weapon), ent);
    } else {
      if (e.shiftKey) {
        for (const u of mine) { u._wq ||= []; u._wq.push({ x: p.x, z: p.z, am: true }); }
      } else {
        for (const u of mine) u._wq = [];
        orderMove(mine, p.x, p.z, { attackMove: true });
      }
    }
    emit('minimap:ping', p.x, p.z, '#ffb050');
  }

  firePendingPower(e) {
    const pend = G.pendingPower;
    G.pendingPower = null;
    if (!pend) return;
    const p = G.camRig.raycastGround(e.clientX, e.clientY);
    const ok = powers.usePower?.(G.humanId, pend.id, p.x, p.z);
    if (ok !== false) {
      const pw = POWERS[pend.id];
      if (pw) emit('feed', `${pw.name} inbound`, 'gold');
      emit('minimap:ping', p.x, p.z, '#ffd76a');
    }
  }

  // ---------------------------------------------------------- keyboard
  onKey(e) {
    if (G.state !== 'playing') return;
    // Esc cancels placement/power targeting before main.js pauses
    if (e.code === 'Escape') {
      if (G.placement || G.pendingPower || this.armedAttack) {
        production.cancelPlacement?.();
        G.pendingPower = null;
        this.armedAttack = false;
        e.stopPropagation();
        e.preventDefault();
      }
      return;
    }
    if (e.code === 'KeyS' && !e.ctrlKey) { orderStop(G.sel); for (const u of G.sel) u._wq = []; }
    if (e.code === 'KeyA' && !e.ctrlKey && !e.repeat) {
      if (G.sel.some(s => s.kind === 'unit' && s.def.weapon)) this.armedAttack = !this.armedAttack;
    }
    if (e.code === 'KeyG') {
      for (const u of G.sel) {
        if (u.kind === 'unit' && u.def.weapon) {
          u.order = { type: 'attackmove', x: u.pos.x, z: u.pos.z };
          u.path = null;
        }
      }
    }
    if (e.code === 'KeyH') {
      const p = G.players[G.humanId];
      G.camRig.panTo(p.baseX, p.baseZ);
    }
    if (e.code === 'Period') G.hud?.cycleIdle?.();
    if (/^Digit[1-9]$/.test(e.code)) {
      const n = e.code[5];
      if (e.ctrlKey) { this.groups[n] = [...G.sel]; e.preventDefault(); }
      else if (this.groups[n]?.length) {
        for (const s of G.sel) s.sel = false;
        G.sel = this.groups[n].filter(u => u.alive);
        for (const s of G.sel) s.sel = true;
        emit('sel:changed');
        // double-tap: center camera on the group
        const now = performance.now();
        if (this._lastGroupKey === n && now - this._lastGroupT < 450 && G.sel.length) {
          let cx = 0, cz = 0;
          for (const u of G.sel) { cx += u.pos.x; cz += u.pos.z; }
          G.camRig.panTo(cx / G.sel.length, cz / G.sel.length);
        }
        this._lastGroupKey = n; this._lastGroupT = now;
      }
    }
  }

  // ---------------------------------------------------------- cursor
  moveCursor(e) {
    // the NATIVE cursor does the pointing (zero latency); this div is only a
    // context badge offset beside it, hidden for the default context.
    const c = this.cursor;
    c.style.left = e.clientX + 'px';
    c.style.top = e.clientY + 'px';
    const overGame = e.target === this.canvas && G.state === 'playing';
    if (!overGame) { c.style.display = 'none'; return; }
    const now = performance.now();
    if (now - this._hoverT >= 45) {
      this._hoverT = now;
      this.hoverEmoji = this.computeCursor(e);
    }
    const special = this.hoverEmoji !== '⊹';
    c.style.display = special ? 'block' : 'none';
    if (special) c.textContent = this.hoverEmoji;
  }
  computeCursor(e) {
    if (G.placement) return '⌖';
    if (G.pendingPower) return '🎯';
    if (this.armedAttack) return '⚔️';
    const p = G.camRig.raycastGround(e.clientX, e.clientY);
    const ent = entityAt(p.x, p.z, 4);
    const sel = G.sel;
    if (ent && ent.alive) {
      if (ent.owner !== G.humanId && ent.owner !== -1 &&
          sel.some(s => s.kind === 'unit' && s.def.weapon)) return '⚔️';
      if (ent.def.capturable && ent.owner !== G.humanId &&
          sel.some(s => s.kind === 'unit' && s.def.canCapture)) return '🚩';
      if (ent.owner === G.humanId && ent.kind === 'building' && ent.hp < ent.maxHp - 1 &&
          sel.some(s => s.kind === 'unit' && s.def.role === 'builder')) return '🔧';
    }
    if (this.dockAt(p.x, p.z) && sel.some(s => s.kind === 'unit' && s.def.role === 'harvester')) return '📦';
    return '⊹';
  }
}
