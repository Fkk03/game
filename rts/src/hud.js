// hud.js — all DOM UI: topbar (money/power/xp/powers/sw timers/clock),
// selection panel, command grid, tooltips, feed, announce, scoreboard,
// idle-worker button, production tabs. OWNED BY: ui agent.
// Command grid: selected building w/ builds → production buttons (click
// queues via production.startProduction, right-click cancels one w/ refund);
// builder → def.builds building buttons (production.beginPlacement);
// building upgrades → purple .upg buttons; armed units → attack-move/stop/
// guard. Powers row calls powers.buyPower/usePower; targeted powers arm
// G.pendingPower consumed by input.js. Superweapon timers from
// powers.getSwTimers().
import { G, on, emit } from './core.js';
import { FACTIONS, POWERS, UPGRADES, DEFS, RANKS } from './data.js';
import * as production from './production.js';
import * as powers from './powers.js';
import * as economy from './economy.js';

const $ = (id) => document.getElementById(id);
const fmt = (n) => '$' + Math.round(n).toLocaleString('en-US');

export class HUD {
  init() {
    this.money = $('money'); this.clock = $('clock');
    this.powerfill = $('powerfill'); this.powertext = $('powertext');
    this.selinfo = $('selinfo'); this.selgrid = $('selgrid');
    this.cmdtitle = $('cmdtitle'); this.cmdgrid = $('cmdgrid');
    this.tooltip = $('tooltip');
    this.moneyShown = G.players[G.humanId]?.money ?? 0;
    this.cmdRefs = []; this.cardRefs = [];
    this.slowAcc = 0; this.wasLow = false;
    this.lastBldWarn = -99; this.lastUnitWarn = -99;
    this.lastLossFeed = -99; this.lastKillFeed = -99;
    this.idleIdx = 0;
    this._tabSig = ''; this._swSig = '';

    on('feed', (t, cls) => this.feed(t, cls));
    on('announce', (t) => this.announce(t));
    on('sel:changed', () => { this.rebuildSelection(); this.rebuildCmd(); });
    on('rank:up', (pid) => {
      if (pid !== G.humanId) return;
      const p = G.players[pid];
      this.announce(`PROMOTION — RANK ${p.rank}`);
      this.feed('General promotion earned — new powers available', 'gold');
      this.rebuildPowers();
    });
    on('entity:died', (ent, attacker) => this.onDied(ent, attacker));

    ['topbar', 'bottombar', 'idleworker'].forEach(id => $(id).classList.remove('hidden'));
    $('idleworker').addEventListener('click', () => this.cycleIdle());
    this.bindTip($('idleworker'), () =>
      `<h4>Idle Workers</h4><div class="tt-desc">Click (or press <b>.</b>) to cycle idle construction units.</div>`);

    $('prodtabs').addEventListener('click', (e) => {
      const tab = e.target.closest('.prodtab');
      if (!tab) return;
      const b = G.byId.get(+tab.dataset.id);
      if (!b || !b.alive) return;
      if (G.sel[0] === b) G.camRig.panTo(b.pos.x, b.pos.z);
      for (const s of G.sel) s.sel = false;
      G.sel = [b]; b.sel = true;
      emit('sel:changed');
    });
    $('swtimers').addEventListener('click', (e) => {
      const el = e.target.closest('.sw-timer');
      if (!el || !el.dataset.pw) return;
      if (el.classList.contains('mine') && el.classList.contains('ready')) {
        G.pendingPower = { id: el.dataset.pw };
        this.feed('Select target for ' + (POWERS[el.dataset.pw]?.name || 'superweapon'), 'gold');
      }
    });

    addEventListener('keydown', (e) => {
      if (e.code === 'Tab' && G.state === 'playing') this.updateScoreboard(true);
    });

    this.rebuildPowers();
    this.rebuildSelection();
    this.rebuildCmd();
  }
  show() {}

  // ------------------------------------------------------------ tooltip
  bindTip(el, fn) {
    el.addEventListener('mouseenter', (e) => this.showTip(fn, e));
    el.addEventListener('mousemove', (e) => this.showTip(fn, e));
    el.addEventListener('mouseleave', () => this.tooltip.classList.add('hidden'));
  }
  showTip(fn, e) {
    const html = fn();
    if (!html) { this.tooltip.classList.add('hidden'); return; }
    const tt = this.tooltip;
    tt.innerHTML = html;
    tt.classList.remove('hidden');
    const r = tt.getBoundingClientRect();
    let x = e.clientX + 14, y = e.clientY - r.height - 10;
    if (x + r.width > innerWidth - 6) x = e.clientX - r.width - 10;
    if (y < 50) y = e.clientY + 18;
    tt.style.left = x + 'px'; tt.style.top = y + 'px';
  }
  defTip(def, extra = '') {
    let h = `<h4>${def.icon} ${def.name}</h4>`;
    if (def.cost) h += `<div class="tt-cost">${fmt(def.cost)} · ${def.buildTime}s${def.hk ? ` · <span class="tt-hk">${def.hk}</span>` : ''}</div>`;
    if (def.desc) h += `<div class="tt-desc">${def.desc}</div>`;
    if (def.power) h += `<div class="tt-desc">Power ${def.power > 0 ? '+' + def.power : def.power}</div>`;
    return h + extra;
  }

  // ------------------------------------------------------------ feed
  feed(text, cls = '') {
    const d = document.createElement('div');
    d.className = 'feed-msg ' + cls;
    d.textContent = text;
    $('feed').prepend(d);
    while ($('feed').children.length > 7) $('feed').lastChild.remove();
    setTimeout(() => d.remove(), 9000);
  }
  announce(text) {
    const a = $('announce');
    a.textContent = text;
    a.style.opacity = 1;
    clearTimeout(this._at);
    this._at = setTimeout(() => a.style.opacity = 0, 3500);
  }
  onDied(ent, attacker) {
    const me = G.humanId;
    if (ent.owner === me) {
      if (ent.kind === 'building') {
        this.feed(`${ent.def.name} destroyed!`, 'bad');
        this.announce('STRUCTURE LOST');
        emit('minimap:ping', ent.pos.x, ent.pos.z, '#ff5040');
      } else if (G.gameTime - this.lastLossFeed > 3) {
        this.lastLossFeed = G.gameTime;
        this.feed(`${ent.def.name} lost`, 'bad');
      }
    } else if (attacker && attacker.owner === me && ent.owner !== -1) {
      if (ent.kind === 'building') this.feed(`Enemy ${ent.def.name} destroyed`, 'gold');
      else if (G.gameTime - this.lastKillFeed > 4) {
        this.lastKillFeed = G.gameTime;
        this.feed(`Enemy ${ent.def.name} destroyed`);
      }
    }
  }

  // ------------------------------------------------------------ powers row
  rebuildPowers() {
    const wrap = $('powers');
    wrap.innerHTML = '';
    this.pwRefs = [];
    const p = G.players[G.humanId];
    if (!p) return;
    const list = Object.values(POWERS).filter(pw => pw.faction === p.faction && !pw.superweapon);
    for (const pw of list) {
      const b = document.createElement('button');
      b.className = 'pw-btn';
      b.innerHTML = `<span>${pw.icon}</span><span class="cd hidden"></span>`;
      const cdEl = b.querySelector('.cd');
      b.addEventListener('click', () => {
        const st = this.powerState(pw);
        if (st === 'buyable') {
          powers.buyPower?.(G.humanId, pw.id);   // powers.js emits its own feed
          this.rebuildPowers();
        } else if (st === 'ready' && pw.targeted) {
          G.pendingPower = G.pendingPower?.id === pw.id ? null : { id: pw.id };
          if (G.pendingPower) this.feed(`Select target for ${pw.name}`);
        }
      });
      this.bindTip(b, () => {
        const st = this.powerState(pw);
        let s = `<h4>${pw.icon} ${pw.name}</h4><div class="tt-cost">Rank ${pw.rank}${pw.cooldown ? ` · ${pw.cooldown}s cooldown` : ''}</div><div class="tt-desc">${pw.desc}</div>`;
        if (st === 'locked') s += `<div class="tt-req">Requires rank ${pw.rank}</div>`;
        else if (st === 'buyable') s += `<div class="tt-state">Click to unlock (${p.ptsAvail} pt available)</div>`;
        else if (st === 'cooldown') s += `<div class="tt-req">Recharging…</div>`;
        else if (st === 'ready' && pw.targeted) s += `<div class="tt-state">Ready — click, then pick a target</div>`;
        else if (pw.passive) s += `<div class="tt-state">Passive — always on</div>`;
        return s;
      });
      wrap.appendChild(b);
      this.pwRefs.push({ pw, el: b, cdEl });
    }
  }
  powerState(pw) {
    const p = G.players[G.humanId];
    if (!p) return 'locked';
    if (!p.powersOwned.has(pw.id)) {
      return (p.rank >= pw.rank && p.ptsAvail > 0) ? 'buyable' : 'locked';
    }
    const cd = p.powerCooldowns[pw.id] || 0;
    return cd > 0.05 ? 'cooldown' : 'ready';
  }
  updatePowers() {
    const p = G.players[G.humanId];
    if (!p || !this.pwRefs) return;
    for (const r of this.pwRefs) {
      const st = this.powerState(r.pw);
      r.el.classList.toggle('locked', st === 'locked');
      r.el.classList.toggle('buyable', st === 'buyable');
      r.el.classList.toggle('ready', st === 'ready' && !r.pw.passive);
      r.el.classList.toggle('active', G.pendingPower?.id === r.pw.id);
      if (st === 'cooldown') {
        const cd = p.powerCooldowns[r.pw.id] || 0;
        const frac = r.pw.cooldown ? cd / r.pw.cooldown : 0;
        r.cdEl.classList.remove('hidden');
        r.cdEl.textContent = Math.ceil(cd);
        r.cdEl.style.background = `conic-gradient(#000d ${frac * 360}deg, #0003 0deg)`;
      } else r.cdEl.classList.add('hidden');
    }
  }

  // ------------------------------------------------------------ selection
  rebuildSelection() {
    const sel = G.sel.filter(s => s.alive);
    this.tooltip.classList.add('hidden');
    this.selgrid.innerHTML = '';
    this.cardRefs = [];
    if (!sel.length) { this.selinfo.innerHTML = ''; return; }
    const MAX = 24;
    for (const ent of sel.slice(0, MAX)) {
      const c = document.createElement('div');
      c.className = 'sel-card';
      c.innerHTML = `<span class="icon">${ent.def.icon}</span>
        <span class="vet"></span>
        <div class="hpbar"><div class="hpfill"></div></div>`;
      const hpEl = c.querySelector('.hpfill'), vetEl = c.querySelector('.vet');
      c.addEventListener('click', () => {
        for (const s of G.sel) s.sel = false;
        G.sel = ent.alive ? [ent] : [];
        if (ent.alive) ent.sel = true;
        emit('sel:changed');
      });
      c.addEventListener('dblclick', () => {
        if (ent.kind === 'unit') G.inputSys?.selectAllOfType(ent.def.id);
      });
      this.bindTip(c, () => this.defTip(ent.def,
        `<div class="tt-state">HP ${Math.ceil(ent.hp)}/${ent.maxHp}${ent.vet ? ` · Veterancy ${'✜'.repeat(ent.vet)}` : ''}</div>`));
      this.selgrid.appendChild(c);
      this.cardRefs.push({ ent, hpEl, vetEl });
    }
    if (sel.length > MAX) {
      const m = document.createElement('div');
      m.className = 'sel-card more';
      m.textContent = `+${sel.length - MAX}`;
      this.selgrid.appendChild(m);
    }
    this.updateSelInfo();
    this.updateCards();
  }
  updateCards() {
    for (const r of this.cardRefs) {
      if (!r.ent.alive) continue;
      const f = Math.max(0, r.ent.hp / r.ent.maxHp);
      r.hpEl.style.width = (f * 100) + '%';
      r.hpEl.style.background = f > 0.55 ? '#4c4' : f > 0.28 ? '#dcb63e' : '#d84c30';
      r.vetEl.textContent = '✜'.repeat(r.ent.vet || 0);
    }
  }
  updateSelInfo() {
    const sel = G.sel.filter(s => s.alive);
    if (!sel.length) { this.selinfo.innerHTML = ''; return; }
    if (sel.length === 1) {
      const e = sel[0];
      let extra = `HP ${Math.ceil(e.hp)}/${e.maxHp}`;
      if (e.def.weapon) extra += ` · DMG ${e.def.weapon.damage} · RNG ${e.def.weapon.range}`;
      if (e.kind === 'building' && e.buildProgress < 1) extra += ` · ${Math.round(e.buildProgress * 100)}% built`;
      this.selinfo.innerHTML = `<b>${e.def.icon} ${e.def.name}</b><span class="statline">${extra}</span>`;
    } else {
      const byType = {};
      for (const e of sel) byType[e.def.id] = (byType[e.def.id] || 0) + 1;
      const parts = Object.entries(byType).map(([id, n]) => `${DEFS[id].icon}×${n}`).join(' ');
      this.selinfo.innerHTML = `<b>${sel.length} selected</b> — ${parts}`;
    }
  }

  // ------------------------------------------------------------ command grid
  cmdBtn({ icon, cost, lbl, hk, cls = '', tip, onClick, onRight }) {
    const b = document.createElement('div');
    b.className = 'cmd-btn ' + cls;
    b.innerHTML = `${hk ? `<span class="hk">${hk}</span>` : ''}
      <span class="icon">${icon}</span>
      ${cost != null ? `<span class="cost">$${cost}</span>` : ''}
      ${lbl ? `<span class="lbl">${lbl}</span>` : ''}
      <span class="count hidden"></span><div class="prog"></div>`;
    if (onClick) b.addEventListener('click', () => { if (!b.classList.contains('disabled')) onClick(); });
    if (onRight) b.addEventListener('contextmenu', (e) => { e.preventDefault(); onRight(); });
    if (tip) this.bindTip(b, tip);
    this.cmdgrid.appendChild(b);
    return {
      el: b,
      countEl: b.querySelector('.count'),
      progEl: b.querySelector('.prog'),
    };
  }

  rebuildCmd() {
    this.tooltip.classList.add('hidden');
    this.cmdgrid.innerHTML = '';
    this.cmdRefs = [];
    this.cmdCtx = null;
    const sel = G.sel.filter(s => s.alive && s.owner === G.humanId);
    const pid = G.humanId;
    if (!sel.length) { this.cmdtitle.textContent = ''; return; }

    const bSel = sel.length === 1 && sel[0].kind === 'building' ? sel[0] : null;
    const builders = sel.filter(s => s.kind === 'unit' && s.def.role === 'builder');
    const units = sel.filter(s => s.kind === 'unit');

    if (bSel) {
      this.cmdCtx = { building: bSel };
      this.cmdtitle.textContent = bSel.def.name;
      if (bSel.buildProgress < 1) { this.cmdtitle.textContent += ' — UNDER CONSTRUCTION'; return; }
      for (const id of (bSel.def.builds || [])) {
        const def = DEFS[id];
        const ref = this.cmdBtn({
          icon: def.icon, cost: def.cost, hk: def.hk,
          tip: () => {
            const cb = production.canBuild?.(pid, id) || { ok: true };
            return this.defTip(def, (!cb.ok && cb.reason && cb.reason !== 'stub')
              ? `<div class="tt-req">${cb.reason}</div>`
              : `<div class="tt-state">Click to build · right-click queue to cancel</div>`);
          },
          onClick: () => production.startProduction?.(bSel, id),
          onRight: () => this.cancelOne(bSel, id),
        });
        this.cmdRefs.push({ type: 'prod', defId: id, ...ref });
      }
      for (const uid of (bSel.def.upgrades || [])) {
        const upg = UPGRADES[uid];
        if (!upg) continue;
        const ref = this.cmdBtn({
          icon: upg.icon, cost: upg.cost, cls: 'upg',
          tip: () => {
            const p = G.players[pid];
            let ex = `<div class="tt-desc">${upg.desc}</div>`;
            if (p.upgrades.has(uid)) ex += `<div class="tt-state">Research complete</div>`;
            return `<h4>${upg.icon} ${upg.name}</h4><div class="tt-cost">$${upg.cost} · ${upg.time}s</div>` + ex;
          },
          onClick: () => production.startProduction?.(bSel, uid),
          onRight: () => this.cancelOne(bSel, uid),
        });
        this.cmdRefs.push({ type: 'upg', defId: uid, ...ref });
      }
      if (bSel.def.cost > 0) {
        const ref = this.cmdBtn({
          icon: '💥', lbl: 'SELL', cls: 'sell',
          tip: () => `<h4>Sell Structure</h4><div class="tt-desc">Demolish for a ${fmt(bSel.def.cost * 0.5)} refund.</div>`,
          onClick: () => production.sellBuilding?.(bSel),
        });
        this.cmdRefs.push({ type: 'sell', ...ref });
      }
    } else if (builders.length && builders.length === units.length) {
      const bd = builders[0];
      this.cmdCtx = { builder: bd };
      this.cmdtitle.textContent = 'CONSTRUCTION OPTIONS';
      for (const id of (bd.def.builds || [])) {
        const def = DEFS[id];
        const ref = this.cmdBtn({
          icon: def.icon, cost: def.cost, hk: def.hk,
          tip: () => {
            const cb = production.canBuild?.(pid, id) || { ok: true };
            return this.defTip(def, (!cb.ok && cb.reason && cb.reason !== 'stub')
              ? `<div class="tt-req">${cb.reason}</div>` : '');
          },
          onClick: () => production.beginPlacement?.(pid, id, bd),
        });
        this.cmdRefs.push({ type: 'place', defId: id, ...ref });
      }
    } else if (units.length) {
      this.cmdCtx = { units: true };
      this.cmdtitle.textContent = units.length === 1 ? units[0].def.name : `${units.length} UNITS`;
      const armed = units.some(u => u.def.weapon);
      if (armed) {
        const ref = this.cmdBtn({
          icon: '⚔️', lbl: 'ATTACK', hk: 'A',
          tip: () => `<h4>⚔️ Attack-Move</h4><div class="tt-desc">Advance to a point, engaging every enemy on the way.</div>`,
          onClick: () => { if (G.inputSys) G.inputSys.armedAttack = !G.inputSys.armedAttack; },
        });
        this.cmdRefs.push({ type: 'atkmove', ...ref });
      }
      const stopRef = this.cmdBtn({
        icon: '🛑', lbl: 'STOP', hk: 'S',
        tip: () => `<h4>🛑 Stop</h4><div class="tt-desc">Halt and hold position.</div>`,
        onClick: () => { orderStopLocal(units); },
      });
      this.cmdRefs.push({ type: 'stop', ...stopRef });
      if (armed) {
        const ref = this.cmdBtn({
          icon: '🛡️', lbl: 'GUARD', hk: 'G',
          tip: () => `<h4>🛡️ Guard</h4><div class="tt-desc">Hold here and engage anything that comes close.</div>`,
          onClick: () => {
            for (const u of units) if (u.def.weapon) { u.order = { type: 'attackmove', x: u.pos.x, z: u.pos.z }; u.path = null; }
          },
        });
        this.cmdRefs.push({ type: 'guard', ...ref });
      }
    }
  }
  cancelOne(b, defId) {
    if (!b.queue?.length) return;
    for (let i = b.queue.length - 1; i >= 0; i--) {
      if (b.queue[i].defId === defId) {
        if (production.cancelProduction) production.cancelProduction(b, i);
        else {
          b.queue.splice(i, 1);
          economy.addMoney?.(G.humanId, DEFS[defId]?.cost ?? UPGRADES[defId]?.cost ?? 0);
        }
        this.feed(`${(DEFS[defId] || UPGRADES[defId])?.name} cancelled — refunded`);
        return;
      }
    }
  }
  updateCmd() {
    if (!this.cmdRefs?.length) return;
    const pid = G.humanId;
    const b = this.cmdCtx?.building;
    for (const r of this.cmdRefs) {
      if (r.type === 'prod' || r.type === 'upg') {
        if (!b || !b.alive) continue;
        const q = b.queue || [];
        const n = q.filter(it => it.defId === r.defId).length;
        r.countEl.classList.toggle('hidden', n === 0);
        if (n) r.countEl.textContent = n;
        const head = q[0];
        r.progEl.style.width = head && head.defId === r.defId && head.total
          ? Math.min(100, head.t / head.total * 100) + '%' : '0%';
        const done = r.type === 'upg' && G.players[pid].upgrades.has(r.defId);
        const cb = production.canBuild?.(pid, r.defId) || { ok: true };
        r.el.classList.toggle('disabled', done || (!cb.ok && cb.reason !== 'stub'));
      } else if (r.type === 'place') {
        const cb = production.canBuild?.(pid, r.defId) || { ok: true };
        r.el.classList.toggle('disabled', !cb.ok && cb.reason !== 'stub');
        r.el.classList.toggle('armed', G.placement?.defId === r.defId);
      } else if (r.type === 'atkmove') {
        r.el.classList.toggle('armed', !!G.inputSys?.armedAttack);
      }
    }
  }

  // ------------------------------------------------------------ idle workers
  idleBuilders() {
    return G.units.filter(u => u.alive && u.owner === G.humanId
      && u.def.role === 'builder' && u.order.type === 'idle');
  }
  cycleIdle() {
    const idle = this.idleBuilders();
    if (!idle.length) return;
    this.idleIdx = (this.idleIdx + 1) % idle.length;
    const u = idle[this.idleIdx];
    for (const s of G.sel) s.sel = false;
    G.sel = [u]; u.sel = true;
    emit('sel:changed');
    G.camRig.panTo(u.pos.x, u.pos.z);
  }

  // ------------------------------------------------------------ prod tabs
  updateProdTabs() {
    const list = G.buildings.filter(b => b.alive && b.owner === G.humanId && b.queue?.length);
    const sig = list.map(b => `${b.id}:${b.queue.length}:${G.sel[0] === b}`).join('|');
    if (sig === this._tabSig) return;
    this._tabSig = sig;
    const wrap = $('prodtabs');
    if (!list.length) { wrap.classList.add('hidden'); wrap.innerHTML = ''; return; }
    wrap.classList.remove('hidden');
    wrap.innerHTML = list.map(b =>
      `<div class="prodtab ${G.sel[0] === b ? 'sel' : ''}" data-id="${b.id}">
        ${b.def.icon}<span class="pt-count">${b.queue.length}</span></div>`).join('');
  }

  // ------------------------------------------------------------ sw timers
  updateSwTimers() {
    const timers = powers.getSwTimers?.() || [];
    const sig = timers.map(t => `${t.pid}:${t.powerId || t.name}:${Math.ceil(t.remaining)}:${t.ready}`).join('|');
    if (sig === this._swSig) return;
    this._swSig = sig;
    $('swtimers').innerHTML = timers.map(t => {
      const mine = t.pid === G.humanId;
      const id = t.powerId || t.id || Object.values(POWERS).find(p => p.name === t.name)?.id || '';
      const mm = Math.floor(Math.max(0, t.remaining) / 60);
      const ss = String(Math.floor(Math.max(0, t.remaining) % 60)).padStart(2, '0');
      return `<span class="sw-timer ${mine ? 'mine' : ''} ${t.ready ? 'ready' : ''}" data-pw="${id}">
        ${t.name}: ${t.ready ? 'READY' : mm + ':' + ss}</span>`;
    }).join('');
  }

  // ------------------------------------------------------------ scoreboard
  updateScoreboard(force = false) {
    const rows = $('sb-rows');
    if (!rows || (!force && $('scoreboard').classList.contains('hidden'))) return;
    rows.innerHTML = G.players.map(p => {
      const army = G.units.reduce((n, u) => n + (u.alive && u.owner === p.id ? 1 : 0), 0);
      return `<div class="sb-row ${p.id === G.humanId ? 'me' : ''} ${p.alive ? '' : 'sb-dead'}">
        <span class="sb-chip" style="background:${p.colorCss}"></span>
        <span class="sb-name">${p.name} <span class="sb-tag">${FACTIONS[p.faction].flag} rank ${p.rank}</span></span>
        <span class="sb-kills">${p.stats.kills}</span>
        <span class="sb-army">${army}</span>
        <span class="sb-cash">$${Math.floor(p.money)}</span></div>`;
    }).join('');
  }

  // ------------------------------------------------------------ alerts
  scanAlerts() {
    const p = G.players[G.humanId];
    // low power
    if (FACTIONS[p.faction].usesPower) {
      const low = p.powerUsed > p.powerMade;
      if (low && !this.wasLow) {
        this.announce('LOW POWER');
        this.feed('Insufficient power — production slowed, defenses offline', 'bad');
      }
      this.wasLow = low;
    }
    // under attack
    for (const e of G.entities) {
      if (!e.alive || e.owner !== G.humanId || e.lastHitT === undefined) continue;
      if (G.gameTime - e.lastHitT > 1.0) continue;
      if (e.kind === 'building' && G.gameTime - this.lastBldWarn > 15) {
        this.lastBldWarn = G.gameTime;
        this.announce('BASE UNDER ATTACK');
        this.feed('Our base is under attack!', 'bad');
        emit('minimap:ping', e.pos.x, e.pos.z, '#ff5040');
      } else if (e.kind === 'unit' && G.gameTime - this.lastUnitWarn > 10) {
        this.lastUnitWarn = G.gameTime;
        this.feed('Forces under attack', 'bad');
        emit('minimap:ping', e.pos.x, e.pos.z, '#ff9040');
      }
    }
  }

  // ------------------------------------------------------------ update
  update(dt) {
    const p = G.players[G.humanId];
    if (!p) return;
    // animated money counter
    const diff = p.money - this.moneyShown;
    this.moneyShown = Math.abs(diff) < 1 ? p.money : this.moneyShown + diff * Math.min(1, dt * 8);
    this.money.textContent = Math.floor(this.moneyShown).toLocaleString('en-US');
    $('rate-in').textContent = `+${Math.round(p.rateIn || 0)}`;
    $('rate-out').textContent = `-${Math.round(p.rateOut || 0)}`;

    const t = Math.floor(G.gameTime);
    this.clock.textContent = `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`;

    if (FACTIONS[p.faction].usesPower) {
      $('powergroup').style.display = '';
      const frac = p.powerMade > 0
        ? Math.max(0, Math.min(1, (p.powerMade - p.powerUsed) / p.powerMade)) : 0;
      this.powerfill.style.width = `${Math.max(4, frac * 100)}%`;
      this.powerfill.style.background = p.powerUsed > p.powerMade ? '#d84c30'
        : p.powerUsed > p.powerMade * 0.8 ? '#dcb63e' : '#48c94e';
      this.powertext.textContent = `${p.powerUsed}/${p.powerMade}`;
    } else {
      $('powergroup').style.display = 'none';
    }

    // xp / rank
    const rk = Math.min(p.rank, RANKS.length);
    const lo = RANKS[rk - 1] ?? 0, hi = RANKS[rk] ?? RANKS[RANKS.length - 1];
    const frac = rk >= RANKS.length ? 1 : Math.min(1, (p.xp - lo) / Math.max(1, hi - lo));
    $('xpfill').style.width = (frac * 100) + '%';
    $('rankstars').textContent = '★'.repeat(p.rank) + '☆'.repeat(Math.max(0, 5 - p.rank));
    $('ptsleft').textContent = p.ptsAvail > 0 ? `+${p.ptsAvail}` : '';

    this.updatePowers();
    this.updateCmd();
    G.inputSys?.update(dt);

    // wall-clock throttle (dt is capped, headless frames can be slow)
    const now = performance.now();
    if (now - (this._lastSlow || 0) >= 250) {
      this._lastSlow = now;
      this.updateSwTimers();
      this.updateProdTabs();
      this.updateScoreboard();
      this.updateCards();
      this.updateSelInfo();
      this.scanAlerts();
      const idle = this.idleBuilders();
      $('iw-count').textContent = idle.length;
      $('idleworker').classList.toggle('dim', idle.length === 0);
    }
  }
}

// local stop helper (avoid importing move.js into hud just for one call)
function orderStopLocal(units) {
  for (const u of units) {
    if (u.kind !== 'unit') continue;
    u.order = { type: 'idle' }; u.path = null; u.target = null; u._wq = [];
  }
}
