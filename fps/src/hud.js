// hud.js — HUD DOM updates: vitals, ammo, compass, objectives, radar, feed
import * as THREE from 'three';
import { G, clamp } from './core.js';

const $ = (id) => document.getElementById(id);

export class HUD {
  constructor() {
    this.el = {
      hud: $('hud'), hp: $('hp-fill'), hpNum: $('hp-num'), ap: $('ap-fill'), apNum: $('ap-num'),
      ammoMag: $('ammo-mag'), ammoRes: $('ammo-res'), wpnName: $('wpn-name'),
      wpnAmmo: $('wpn-ammo'), wpnSlots: $('wpn-slots'),
      objList: $('obj-list'), compass: $('compass-strip'), crosshair: $('crosshair'),
      hitmark: $('hitmarker'), vign: $('dmg-vignette'), killfeed: $('killfeed'),
      announce: $('announce'), sub: $('subannounce'), radar: $('radar'),
      prompt: $('prompt'),
    };
    this.radarCtx = this.el.radar.getContext('2d');
    this.buildCompass();
    this.objectives = [];
    this.radarT = 0;
    this.vignette = 0;
  }

  buildCompass() {
    const dirs = [['N', 0], ['NE', 45], ['E', 90], ['SE', 135], ['S', 180], ['SW', 225], ['W', 270], ['NW', 315]];
    let html = '';
    // three copies for wraparound
    for (let c = -1; c <= 1; c++) {
      for (const [label, deg] of dirs) {
        const card = label.length === 1;
        html += `<span class="cdir ${card ? 'card' : ''}" data-deg="${deg + c * 360}">${label}</span>`;
      }
      for (let d = 0; d < 360; d += 15) {
        html += `<span class="ctick" data-deg="${d + c * 360}"></span>`;
      }
    }
    html += `<span class="cobj" id="cobj">◆</span>`;
    this.el.compass.innerHTML = html;
    this.compassEls = [...this.el.compass.querySelectorAll('[data-deg]')];
    this.cobj = $('cobj');
  }

  show() { this.el.hud.classList.remove('hidden'); }
  hide() { this.el.hud.classList.add('hidden'); }

  setObjectives(list) {
    this.objectives = list;
    this.renderObjectives();
  }
  renderObjectives() {
    this.el.objList.innerHTML = this.objectives.map(o =>
      `<div class="obj-item ${o.done ? 'done' : ''}">` +
      `<span class="${o.done ? 'obj-chk' : 'obj-box'}">${o.done ? '✔' : '▸'}</span>${o.text}</div>`
    ).join('');
  }

  refreshWeapon() {
    const w = G.weapons;
    const a = w.slot;
    this.el.wpnName.textContent = w.def.name;
    this.el.ammoMag.textContent = a.mag;
    this.el.ammoRes.textContent = a.reserve;
    this.el.wpnAmmo.classList.toggle('low', a.mag <= 5);
    this.el.wpnSlots.innerHTML =
      `<span class="wpn-slot ${w.current === 'carbine' ? 'sel' : ''}">1 CARBINE</span>` +
      `<span class="wpn-slot ${w.current === 'rpg' ? 'sel' : ''}">2 RPG</span>` +
      `<span class="wpn-slot">G ×${w.grenades}</span>`;
  }

  setSpread(px) {
    this.el.crosshair.style.setProperty('--sprd', px + 'px');
    this.el.crosshair.classList.toggle('ads', G.weapons?.ads);
  }

  hitmarker(kill) {
    const h = this.el.hitmark;
    h.classList.remove('show', 'kill');
    void h.offsetWidth;
    h.classList.add('show');
    if (kill) h.classList.add('kill');
  }

  onPlayerHurt() {
    this.vignette = 1;
  }

  feed(text) {
    const div = document.createElement('div');
    div.className = 'kf';
    div.innerHTML = text;
    this.el.killfeed.prepend(div);
    while (this.el.killfeed.children.length > 5) this.el.killfeed.lastChild.remove();
    setTimeout(() => div.remove(), 6000);
  }

  announce(main, sub = '', dur = 3.4) {
    this.el.announce.textContent = main;
    this.el.sub.textContent = sub;
    this.el.announce.style.opacity = 1;
    this.el.sub.style.opacity = 1;
    clearTimeout(this._at);
    this._at = setTimeout(() => {
      this.el.announce.style.opacity = 0;
      this.el.sub.style.opacity = 0;
    }, dur * 1000);
  }

  prompt(text) {
    this.el.prompt.textContent = text || '';
    this.el.prompt.style.opacity = text ? 1 : 0;
  }

  update(dt) {
    const p = G.player;
    // vitals
    this.el.hp.style.width = (p.hp / p.maxHp * 100) + '%';
    this.el.hp.classList.toggle('low', p.hp < 35);
    this.el.hpNum.textContent = Math.ceil(p.hp);
    this.el.ap.style.width = (p.armor / p.maxArmor * 100) + '%';
    this.el.apNum.textContent = Math.ceil(p.armor);

    // damage vignette decay
    this.vignette = Math.max(0, this.vignette - dt * 1.4);
    const lowHp = p.hp < 35 ? (0.5 + Math.sin(G.time * 5) * 0.15) * (1 - p.hp / 35) : 0;
    this.el.vign.style.opacity = clamp(this.vignette + lowHp, 0, 1);

    // compass: heading in degrees
    const heading = ((-p.yaw * 180 / Math.PI) % 360 + 360) % 360;
    const pxPerDeg = 340 / 120;   // 120° visible
    for (const el of this.compassEls) {
      let d = parseFloat(el.dataset.deg) - heading;
      while (d > 180) d -= 360;
      while (d < -180) d += 360;
      const x = 170 + d * pxPerDeg;
      if (x < -30 || x > 370) { el.style.display = 'none'; continue; }
      el.style.display = '';
      el.style.left = x + 'px';
    }
    // objective diamond on compass
    const obj = G.world?.currentObjectivePos?.();
    if (obj) {
      const dx = obj.x - p.pos.x, dz = obj.z - p.pos.z;
      let bearing = Math.atan2(dx, -dz) * 180 / Math.PI;
      let d = bearing - heading;
      while (d > 180) d -= 360;
      while (d < -180) d += 360;
      const x = 170 + clamp(d, -58, 58) * pxPerDeg;
      this.cobj.style.left = x + 'px';
      this.cobj.style.color = Math.abs(d) < 6 ? '#ffe9a0' : '#d0a850';
    } else {
      this.cobj.style.display = 'none';
    }

    // radar (10 fps)
    this.radarT -= dt;
    if (this.radarT <= 0) {
      this.radarT = 0.1;
      this.drawRadar();
    }
  }

  drawRadar() {
    const ctx = this.radarCtx;
    const S = 176, C = S / 2, RANGE = 90;
    const p = G.player;
    ctx.clearRect(0, 0, S, S);
    // rings
    ctx.strokeStyle = '#2c3a26';
    ctx.lineWidth = 1;
    for (const r of [C * 0.33, C * 0.66, C - 3]) {
      ctx.beginPath(); ctx.arc(C, C, r, 0, 7); ctx.stroke();
    }
    ctx.strokeStyle = '#22301d';
    ctx.beginPath(); ctx.moveTo(C, 4); ctx.lineTo(C, S - 4); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(4, C); ctx.lineTo(S - 4, C); ctx.stroke();
    // sweep
    const sweep = (G.time * 1.4) % (Math.PI * 2);
    const grad = ctx.createConicGradient ? null : null;
    ctx.fillStyle = 'rgba(90,160,60,0.10)';
    ctx.beginPath();
    ctx.moveTo(C, C);
    ctx.arc(C, C, C - 3, sweep - 0.9, sweep);
    ctx.closePath(); ctx.fill();

    // rotate world so screen-up = player forward
    const fwdX = -Math.sin(p.yaw), fwdZ = -Math.cos(p.yaw);
    const rightX = -fwdZ, rightZ = fwdX;
    const toScreen = (wx, wz) => {
      const dx = wx - p.pos.x, dz = wz - p.pos.z;
      const rx = dx * rightX + dz * rightZ;
      const ry = dx * fwdX + dz * fwdZ;
      const d = Math.hypot(rx, ry);
      if (d > RANGE) return null;
      return [C + rx / RANGE * (C - 8), C - ry / RANGE * (C - 8)];
    };
    // enemies
    for (const e of G.enemies) {
      if (e.dead) continue;
      const s = toScreen(e.group.position.x, e.group.position.z);
      if (!s) continue;
      ctx.fillStyle = e.aware ? '#ff5238' : '#c88a30';
      ctx.beginPath(); ctx.arc(s[0], s[1], 2.4, 0, 7); ctx.fill();
    }
    for (const v of G.vehicles) {
      if (v.dead) continue;
      const s = toScreen(v.group.position.x, v.group.position.z);
      if (!s) continue;
      ctx.fillStyle = '#ff7a38';
      ctx.fillRect(s[0] - 3, s[1] - 3, 6, 6);
    }
    // objective targets
    for (const t of G.targets) {
      if (t.dead || !t.objective) continue;
      const pos = new THREE.Vector3();
      t.group.getWorldPosition(pos);
      const s = toScreen(pos.x, pos.z);
      if (!s) {
        continue;
      }
      ctx.fillStyle = '#ffd76a';
      ctx.save();
      ctx.translate(s[0], s[1]);
      ctx.rotate(Math.PI / 4);
      ctx.fillRect(-3, -3, 6, 6);
      ctx.restore();
    }
    // player wedge
    ctx.fillStyle = '#b0ffb0';
    ctx.beginPath();
    ctx.moveTo(C, C - 6);
    ctx.lineTo(C - 4, C + 4);
    ctx.lineTo(C + 4, C + 4);
    ctx.closePath(); ctx.fill();
  }
}

// callbacks from other modules
export function onKill(entity, isVehicle = false) {
  const names = isVehicle
    ? (entity.type === 'tank' ? ['Scorpion tank'] : ['armed technical'])
    : ['Cartel rebel', 'Cartel gunman', 'Cartel fighter', 'Cartel militiaman'];
  const n = names[Math.floor(Math.random() * names.length)];
  G.hud?.feed(`<b>You</b> eliminated ${n}`);
  G.world?.onKill?.(entity);
}

export function onTargetDestroyed(t) {
  if (t.objective) {
    G.hud?.feed(`<b>OBJECTIVE</b> — ${t.name} destroyed!`);
    G.audio?.objective();
  } else {
    G.hud?.feed(`${t.name} destroyed`);
  }
  G.world?.onTargetDestroyed?.(t);
}
