/* ============ ui.js — HUD, menus, command grid, minimap, tooltips ============ */
'use strict';
const UI = (() => {
  const $ = id => document.getElementById(id);
  let mmCanvas, cmdButtons = [], curCmds = [];
  const pings = [];
  let lastEvent = null;          // {x,y} for Space key
  let lastAttackFeedT = -99;
  let orderFlashes = [];         // brief world markers on orders
  let announceT = 0;

  /* menu config state */
  const cfg = { faction: 'coalition', enemy: 'random', diff: 'normal', map: 'medium', money: 10000 };

  function init() {
    mmCanvas = $('minimap');

    /* ------ main menu construction ------ */
    const fp = $('faction-pick');
    for (const key of Object.keys(FACTIONS)) {
      const f = FACTIONS[key];
      const el = document.createElement('div');
      el.className = 'f-card' + (key === cfg.faction ? ' sel' : '');
      el.innerHTML = `<div class="f-flag">${f.flag}</div><div class="f-name" style="color:${f.color}">${f.name}</div>
        <div class="f-desc">${f.desc}</div>`;
      el.onclick = () => { cfg.faction = key;
        fp.querySelectorAll('.f-card').forEach(c => c.classList.remove('sel'));
        el.classList.add('sel'); SFX.init(); SFX.click(); };
      fp.appendChild(el);
    }
    buildPills('enemy-pick', [['random', 'Random'], ...Object.keys(FACTIONS).map(k => [k, FACTIONS[k].name])],
      v => cfg.enemy = v, 'random');
    buildPills('diff-pick', Object.keys(DIFFICULTY).map(k => [k, DIFFICULTY[k].label]), v => cfg.diff = v, 'normal');
    buildPills('map-pick', Object.keys(MAPSIZES).map(k => [k, MAPSIZES[k].label]), v => cfg.map = v, 'medium');
    buildPills('money-pick', [[5000, '$5,000'], [10000, '$10,000'], [20000, '$20,000']],
      v => cfg.money = +v, 10000);

    $('btn-start').onclick = () => { SFX.init(); SFX.click(); startGame(cfg); };
    $('btn-help').onclick = () => { SFX.click(); showHelp(); };
    $('btn-help2').onclick = () => { SFX.click(); showHelp(); };
    $('btn-closehelp').onclick = () => { SFX.click(); $('helpoverlay').classList.add('hidden'); };
    $('btn-resume').onclick = () => togglePause();
    $('btn-restart').onclick = () => { $('pausemenu').classList.add('hidden'); startGame(cfg); };
    $('btn-quit').onclick = () => quitToMenu();
    $('btn-quit2').onclick = () => quitToMenu();
    $('btn-again').onclick = () => { $('endscreen').classList.add('hidden'); startGame(cfg); };
    $('btn-menu').onclick = () => togglePause();
    $('btn-sound').onclick = () => toggleSound();

    /* command grid buttons (12) */
    const grid = $('cmdgrid');
    const KEY_LABELS = ['Q', 'W', 'E', 'R', 'A', 'S', 'D', 'F', 'Z', 'X', 'C', 'V'];
    for (let i = 0; i < 12; i++) {
      const b = document.createElement('button');
      b.className = 'cmd-btn disabled';
      b.dataset.idx = i;
      b.innerHTML = `<span class="hk">${KEY_LABELS[i]}</span>`;
      b.onclick = () => triggerHotkey(i);
      b.onmouseenter = () => showCmdTooltip(i, b);
      b.onmouseleave = hideTooltip;
      grid.appendChild(b);
      cmdButtons.push(b);
    }

    /* minimap */
    const mmClick = e => {
      const r = mmCanvas.getBoundingClientRect();
      const fx = (e.clientX - r.left) / r.width, fy = (e.clientY - r.top) / r.height;
      INPUT.centerOn({ x: fx * world.pw, y: fy * world.ph });
    };
    mmCanvas.addEventListener('mousedown', e => { if (e.button === 0) { mmClick(e); mmCanvas._drag = true; } });
    window.addEventListener('mousemove', e => { if (mmCanvas._drag) mmClick(e); });
    window.addEventListener('mouseup', () => mmCanvas._drag = false);
    mmCanvas.addEventListener('contextmenu', e => {
      e.preventDefault();
      const r = mmCanvas.getBoundingClientRect();
      const wx = (e.clientX - r.left) / r.width * world.pw;
      const wy = (e.clientY - r.top) / r.height * world.ph;
      // right-click on minimap: smart order at that spot
      const sel = INPUT.selection.filter(s => s.kind === 'unit' && s.owner === 0);
      for (const u of sel) u.giveOrder({ type: 'attackmove', x: wx + U.rand(-40, 40), y: wy + U.rand(-40, 40) }, e.shiftKey);
      if (sel.length) SFX.ack();
    });
  }

  function buildPills(id, options, cb, defVal) {
    const el = $(id);
    for (const [val, label] of options) {
      const b = document.createElement('div');
      b.className = 'pill' + (String(val) === String(defVal) ? ' sel' : '');
      b.textContent = label;
      b.onclick = () => {
        el.querySelectorAll('.pill').forEach(x => x.classList.remove('sel'));
        b.classList.add('sel'); cb(val); SFX.init(); SFX.click();
      };
      el.appendChild(b);
    }
  }

  /* =================== game lifecycle UI =================== */
  function showGameHud() {
    $('menu').classList.add('hidden');
    $('topbar').classList.remove('hidden');
    $('bottombar').classList.remove('hidden');
    $('feed').classList.remove('hidden');
    $('endscreen').classList.add('hidden');
    $('pausemenu').classList.add('hidden');
    $('feed').innerHTML = '';
    refreshPowers(); refreshSel(); refreshCmd();
  }

  function quitToMenu() {
    game.started = false; game.paused = false;
    $('pausemenu').classList.add('hidden');
    $('endscreen').classList.add('hidden');
    $('topbar').classList.add('hidden');
    $('bottombar').classList.add('hidden');
    $('feed').classList.add('hidden');
    $('menu').classList.remove('hidden');
  }

  function togglePause() {
    if (!game.started || game.over) return;
    game.paused = !game.paused;
    $('pausemenu').classList.toggle('hidden', !game.paused);
  }

  function toggleSound() {
    const m = SFX.toggleMute();
    $('btn-sound').textContent = m ? '🔇' : '🔊';
  }

  function showHelp() { $('helpoverlay').classList.remove('hidden'); }

  function showEnd(win, stats) {
    const t = $('endtitle');
    t.textContent = win ? 'VICTORY' : 'DEFEAT';
    t.className = win ? 'win' : 'lose';
    const s = game.players[0].stats;
    $('endstats').innerHTML = `<table>
      <tr><td>Time</td><td>${U.fmtTime(game.t)}</td></tr>
      <tr><td>Units built</td><td>${s.unitsBuilt}</td></tr>
      <tr><td>Units lost</td><td>${s.unitsLost}</td></tr>
      <tr><td>Enemies destroyed</td><td>${s.kills}</td></tr>
      <tr><td>Buildings lost</td><td>${s.buildingsLost}</td></tr>
      <tr><td>Supplies earned</td><td>${U.fmtMoney(s.moneyEarned)}</td></tr>
      <tr><td>General rank</td><td>${'★'.repeat(game.players[0].rank) || '—'}</td></tr>
    </table>`;
    $('endscreen').classList.remove('hidden');
  }

  /* =================== top bar =================== */
  function refreshTop() {
    const p = game.players[0];
    $('money').textContent = U.fmtMoney(p.money);
    $('clock').textContent = U.fmtTime(game.t);

    const F = FACTIONS[p.faction];
    if (F.usesPower) {
      $('powergroup').style.display = '';
      const frac = p.powerCap > 0 ? U.clamp(p.powerUse / p.powerCap, 0, 1) : 1;
      const fill = $('powerfill');
      fill.style.width = Math.round(frac * 100) + '%';
      fill.style.background = p.lowPower ? '#e05540' : frac > 0.8 ? '#e8c33c' : '#48c94e';
      $('powertext').textContent = p.powerUse + '/' + p.powerCap;
    } else {
      $('powergroup').style.display = 'none';
    }

    $('rankstars').textContent = p.rank > 0 ? '★'.repeat(p.rank) : '☆';
    const nxt = p.rank < 5 ? RANK_XP[p.rank + 1] : RANK_XP[5];
    const base = RANK_XP[p.rank];
    $('xpfill').style.width = p.rank >= 5 ? '100%' :
      Math.round(U.clamp((p.xp - base) / (nxt - base), 0, 1) * 100) + '%';
    $('ptsleft').textContent = p.powerPoints > 0 ? `+${p.powerPoints} pts` : '';

    // superweapon timers
    const sw = $('swtimers');
    let html = '';
    for (const e of game.ents) {
      if (e.dead || e.kind !== 'building' || e.key !== 'superweapon' || !e.constructed) continue;
      const mine = e.owner === 0;
      const kind = BUILDINGS.superweapon.swByFaction[game.players[e.owner].faction];
      const nm = SUPERWEAPONS[kind].name;
      html += `<span class="sw-timer ${mine ? 'mine' : ''} ${e.swReady ? 'ready' : ''}">${mine ? '' : '☠ '}${nm}: ${e.swReady ? 'READY' : U.fmtTime(e.swTimer)}</span>`;
    }
    sw.innerHTML = html;
  }

  /* =================== powers row =================== */
  function refreshPowers() {
    const p = game.players[0];
    const row = $('powersrow');
    row.innerHTML = '';
    for (const key of FACTIONS[p.faction].powers) {
      const def = POWERS[key];
      const el = document.createElement('button');
      el.className = 'pw-btn';
      el.textContent = def.icon;
      const unlocked = p.unlocked[key];
      const canBuy = POWERS_SYS.canUnlock(p, key);
      const cd = p.cooldowns[key] || 0;
      if (!unlocked) el.classList.add(canBuy ? 'buyable' : 'locked');
      else if (cd <= 0) el.classList.add('ready');
      if (unlocked && cd > 0) {
        const cdEl = document.createElement('div');
        cdEl.className = 'cd';
        cdEl.textContent = Math.ceil(cd);
        el.appendChild(cdEl);
      }
      el.onmouseenter = () => showPowerTooltip(key, el, unlocked, canBuy);
      el.onmouseleave = hideTooltip;
      el.onclick = () => {
        SFX.click();
        if (!unlocked) {
          if (canBuy) { POWERS_SYS.unlock(0, key); refreshPowers(); }
          else SFX.error();
        } else if (cd <= 0) {
          INPUT.beginTargeting({ kind: 'power', key, label: def.name });
        } else SFX.error();
      };
      row.appendChild(el);
    }
    // superweapon fire button
    for (const e of game.ents) {
      if (e.dead || e.owner !== 0 || e.kind !== 'building' || e.key !== 'superweapon' || !e.swReady) continue;
      const el = document.createElement('button');
      el.className = 'pw-btn ready active';
      el.textContent = '☢️';
      el.title = 'FIRE SUPERWEAPON';
      el.onclick = () => {
        SFX.click();
        INPUT.beginTargeting({ kind: 'sw', siloId: e.id, label: 'FIRE!' });
      };
      row.appendChild(el);
    }
  }

  function showPowerTooltip(key, el, unlocked, canBuy) {
    const def = POWERS[key];
    const rankNeed = def.tier === 1 ? 1 : def.tier === 2 ? 3 : 5;
    let req = '';
    if (!unlocked) {
      req = canBuy ? 'Click to unlock (1 point)' : `Requires rank ${rankNeed}${game.players[0].powerPoints < 1 ? ' + 1 promotion point' : ''}`;
    }
    tooltipHtml(el, `<h4>${def.icon} ${def.name}</h4>
      <div class="tt-desc">${def.desc}</div>
      <div class="tt-cost">Cooldown ${def.cd}s</div>
      ${req ? `<div class="tt-req">${req}</div>` : ''}`);
  }

  /* =================== selection panel =================== */
  function refreshSel() {
    const sel = INPUT.selection;
    const info = $('selinfo'), grid = $('selgrid');
    grid.innerHTML = '';
    if (!sel.length) { info.innerHTML = '<span style="color:#6d6a58">Nothing selected — left-drag to select units, or click a building.</span>'; return; }
    const p0 = game.players[0];
    if (sel.length === 1) {
      const e = sel[0];
      const nm = e.kind === 'unit' ? uName(e.key, game.players[e.owner]?.faction) : bName(e.key, game.players[e.owner]?.faction);
      let extra = '';
      if (e.kind === 'unit' && e.vetRank) extra += ` &nbsp;<span style="color:#ffd76a">${'★'.repeat(e.vetRank)}</span>`;
      if (e.kind === 'unit' && e.def.harvester) extra += ` &nbsp;· carrying $${e.carrying || 0}`;
      if (e.kind === 'unit' && e.def.air) extra += ` &nbsp;· ammo ${e.ammo}/${e.def.ammo}`;
      if (e.kind === 'building' && e.key === 'superweapon' && e.constructed)
        extra += e.swReady ? ' &nbsp;· <b style="color:#8f8">READY</b>' : ` &nbsp;· launch in ${U.fmtTime(e.swTimer)}`;
      info.innerHTML = `<b>${nm}</b> &nbsp;${Math.ceil(e.hp)}/${e.maxHp} HP${extra}`;
    } else {
      info.innerHTML = `<b>${sel.length} selected</b>`;
    }
    for (const e of sel.slice(0, 24)) {
      const card = document.createElement('div');
      card.className = 'sel-card';
      const icon = e.kind === 'unit' ? e.def.icon : e.def.icon;
      card.innerHTML = `<span class="icon">${icon}</span>
        ${e.vetRank ? `<span class="vet">${'★'.repeat(e.vetRank)}</span>` : ''}
        <div class="hpbar"><div class="hpfill" style="width:${Math.round(e.hp / e.maxHp * 100)}%;
          background:${e.hp / e.maxHp > 0.6 ? '#4c4' : e.hp / e.maxHp > 0.3 ? '#e8c33c' : '#e05540'}"></div></div>`;
      card.onclick = () => { INPUT.selection = [e]; refreshSel(); refreshCmd(); };
      grid.appendChild(card);
    }
    if (sel.length > 24) {
      const more = document.createElement('div');
      more.className = 'sel-card';
      more.textContent = '+' + (sel.length - 24);
      grid.appendChild(more);
    }
  }

  /* =================== command grid =================== */
  function refreshCmd() {
    const sel = INPUT.selection.filter(e => e.owner === 0 && !e.dead);
    curCmds = new Array(12).fill(null);
    const title = $('cmdtitle');
    const p = game.players[0];

    for (const b of cmdButtons) { b.className = 'cmd-btn disabled';
      b.innerHTML = `<span class="hk">${['Q','W','E','R','A','S','D','F','Z','X','C','V'][b.dataset.idx]}</span>`; }

    if (!sel.length) { title.textContent = ''; return; }

    const units = sel.filter(e => e.kind === 'unit');
    const dozer = units.find(u => u.def.builder);
    const building = sel.length === 1 && sel[0].kind === 'building' ? sel[0] : null;

    if (dozer) {
      title.textContent = FACTIONS[p.faction].dozerName + ' — construction';
      const keys = FACTIONS[p.faction].buildings.filter(k => k !== 'cc' || true);
      keys.forEach((bk, i) => {
        if (i >= 12) return;
        curCmds[i] = { type: 'place', key: bk };
      });
    } else if (units.length) {
      title.textContent = units.length === 1 ? uName(units[0].key, p.faction) : units.length + ' units';
      curCmds[4] = { type: 'attackmove' };   // A
      curCmds[5] = { type: 'stop' };         // S
    } else if (building) {
      title.textContent = bName(building.key, p.faction);
      if (!building.constructed) {
        curCmds[7] = { type: 'cancelsite' }; // F
      } else {
        const trains = bTrains(building.key, p.faction);
        trains.forEach((uk, i) => { if (i < 8) curCmds[i] = { type: 'train', key: uk, building }; });
        curCmds[11] = { type: 'sell' };      // V
      }
    }

    // paint
    curCmds.forEach((c, i) => {
      if (!c) return;
      const b = cmdButtons[i];
      b.classList.remove('disabled');
      const hk = b.querySelector('.hk')?.outerHTML || '';
      if (c.type === 'place') {
        const def = BUILDINGS[c.key];
        const afford = p.money >= def.cost;
        b.innerHTML = `${hk}<span class="icon">${def.icon}</span><span>${bName(c.key, p.faction).split(' ')[0]}</span><span class="cost">$${def.cost}</span>`;
        if (!afford) b.classList.add('disabled');
        if (def.limit) {
          const n = game.ents.filter(e => !e.dead && e.owner === 0 && e.kind === 'building' && e.key === c.key).length;
          if (n >= def.limit) b.classList.add('disabled');
        }
      } else if (c.type === 'train') {
        const def = UNITS[c.key];
        const cnt = c.building.queue.filter(q => q.key === c.key).length;
        b.innerHTML = `${hk}<span class="icon">${def.icon}</span><span>${uName(c.key, p.faction).split(' ')[0]}</span><span class="cost">$${def.cost}</span>
          ${cnt ? `<span class="count">${cnt}</span>` : ''}
          <div class="prog" style="width:${c.building.queue[0] && c.building.queue[0].key === c.key ? Math.round(c.building.queue[0].prog * 100) : 0}%"></div>`;
        if (p.money < def.cost) b.classList.add('disabled');
      } else if (c.type === 'attackmove') {
        b.innerHTML = `${hk}<span class="icon">⚔️</span><span>Attack-Move</span>`;
      } else if (c.type === 'stop') {
        b.innerHTML = `${hk}<span class="icon">✋</span><span>Stop</span>`;
      } else if (c.type === 'sell') {
        b.innerHTML = `${hk}<span class="icon">💵</span><span>Sell 50%</span>`;
      } else if (c.type === 'cancelsite') {
        b.innerHTML = `${hk}<span class="icon">✖</span><span>Cancel (75%)</span>`;
      }
    });
  }

  function triggerHotkey(i) {
    const c = curCmds[i];
    if (!c) return false;
    const p = game.players[0];
    switch (c.type) {
      case 'place': {
        const def = BUILDINGS[c.key];
        if (p.money < def.cost) { feed('Insufficient funds', 'bad'); SFX.error(); SFX.say('Insufficient funds'); return true; }
        INPUT.beginPlace(c.key); SFX.click();
        break;
      }
      case 'train': {
        if (!c.building.enqueue(c.key)) { feed('Insufficient funds', 'bad'); SFX.error(); SFX.say('Insufficient funds'); }
        else SFX.click();
        refreshCmd();
        break;
      }
      case 'attackmove': INPUT.awaitAttackMove = true; SFX.click(); break;
      case 'stop': INPUT.stopSelected(); break;
      case 'sell': {
        const b = INPUT.selection[0];
        if (b && b.kind === 'building') { b.sell(); INPUT.selection = []; refreshSel(); refreshCmd(); SFX.cash(); }
        break;
      }
      case 'cancelsite': {
        const b = INPUT.selection[0];
        if (b && b.kind === 'building' && !b.constructed) {
          game.players[0].addMoney(Math.floor(b.def.cost * 0.75));
          b.dead = true;
          world.blockRect(b.tx, b.ty, b.size, false);
          INPUT.selection = []; refreshSel(); refreshCmd();
        }
        break;
      }
    }
    return true;
  }

  /* production progress repaint (cheap, every 0.25 s) */
  function refreshCmdProgress() {
    curCmds.forEach((c, i) => {
      if (!c || c.type !== 'train') return;
      const prog = cmdButtons[i].querySelector('.prog');
      if (prog) prog.style.width = (c.building.queue[0] && c.building.queue[0].key === c.key ?
        Math.round(c.building.queue[0].prog * 100) : 0) + '%';
      const cnt = cmdButtons[i].querySelector('.count');
      const n = c.building.queue.filter(q => q.key === c.key).length;
      if (cnt) cnt.textContent = n || '';
      else if (n) refreshCmd();
    });
  }

  /* =================== tooltips =================== */
  function showCmdTooltip(i, el) {
    const c = curCmds[i];
    if (!c) return;
    const p = game.players[0];
    if (c.type === 'place') {
      const def = BUILDINGS[c.key];
      let extra = '';
      if (def.power) extra += `Power −${def.power} · `;
      if (def.powerGive) extra += `Power +${def.powerGive} · `;
      tooltipHtml(el, `<h4>${def.icon} ${bName(c.key, p.faction)}</h4>
        <div class="tt-cost">$${def.cost} · ${extra}${def.buildTime}s</div>
        <div class="tt-desc">${def.desc}</div>`);
    } else if (c.type === 'train') {
      const def = UNITS[c.key];
      tooltipHtml(el, `<h4>${def.icon} ${uName(c.key, p.faction)}</h4>
        <div class="tt-cost">$${def.cost} · ${def.buildTime}s</div>
        <div class="tt-desc">${def.desc}</div>`);
    } else if (c.type === 'attackmove') {
      tooltipHtml(el, `<h4>⚔️ Attack-Move</h4><div class="tt-desc">Move while engaging every enemy on the way. Hotkey A, then click the map.</div>`);
    } else if (c.type === 'stop') {
      tooltipHtml(el, `<h4>✋ Stop</h4><div class="tt-desc">Halt and hold position.</div>`);
    } else if (c.type === 'sell') {
      tooltipHtml(el, `<h4>💵 Sell</h4><div class="tt-desc">Demolish this structure for a 50% refund.</div>`);
    }
  }

  function tooltipHtml(anchor, html) {
    const tt = $('tooltip');
    tt.innerHTML = html;
    tt.classList.remove('hidden');
    const r = anchor.getBoundingClientRect();
    tt.style.left = Math.min(window.innerWidth - 260, r.left) + 'px';
    tt.style.top = '';
    tt.style.bottom = (window.innerHeight - r.top + 8) + 'px';
  }
  function hideTooltip() { $('tooltip').classList.add('hidden'); }

  /* =================== feed / announce / pings =================== */
  function feed(msg, cls) {
    const el = document.createElement('div');
    el.className = 'feed-msg' + (cls ? ' ' + cls : '');
    el.textContent = msg;
    const f = $('feed');
    f.prepend(el);
    while (f.children.length > 6) f.lastChild.remove();
    setTimeout(() => { el.style.transition = 'opacity 1s'; el.style.opacity = '0'; }, 6500);
    setTimeout(() => el.remove(), 7600);
  }

  function announce(msg) {
    const a = $('announce');
    a.textContent = msg;
    a.classList.remove('hidden');
    announceT = 3.5;
  }

  function ping(x, y, color) {
    pings.push({ x, y, color: color || '#ffd76a', t0: game.t });
    if (pings.length > 6) pings.shift();
    lastEvent = { x, y };
  }

  function underAttack(ent) {
    if (game.t - lastAttackFeedT < 12) { lastEvent = { x: ent.x, y: ent.y }; return; }
    lastAttackFeedT = game.t;
    feed(ent.kind === 'building' ? '⚠ Base under attack!' : '⚠ Units under attack!', 'bad');
    SFX.alarm();
    SFX.say(ent.kind === 'building' ? 'Base under attack' : 'Units under attack');
    ping(ent.x, ent.y, '#ff5540');
  }

  function jumpToLastEvent() { if (lastEvent) INPUT.centerOn(lastEvent); }

  function flashOrder(x, y, kind) {
    orderFlashes.push({ x, y, kind, t: 0 });
  }

  /* reset per-match state so alarms/pings from the previous game don't leak in */
  function resetMatch() {
    pings.length = 0;
    orderFlashes.length = 0;
    lastEvent = null;
    lastAttackFeedT = -99;
    announceT = 0;
    $('announce').classList.add('hidden');
    hideTooltip();
  }

  /* per-frame housekeeping */
  function update(dt) {
    if (announceT > 0) { announceT -= dt; if (announceT <= 0) $('announce').classList.add('hidden'); }
    for (let i = pings.length - 1; i >= 0; i--) if (game.t - pings[i].t0 > 4) pings.splice(i, 1);
    for (let i = orderFlashes.length - 1; i >= 0; i--) {
      orderFlashes[i].t += dt;
      if (orderFlashes[i].t > 0.6) orderFlashes.splice(i, 1);
    }
  }

  function drawMinimap() { RENDER.drawMinimap(mmCanvas); }

  return {
    init, showGameHud, quitToMenu, togglePause, toggleSound, showHelp, showEnd, resetMatch,
    refreshTop, refreshPowers, refreshSel, refreshCmd, refreshCmdProgress, triggerHotkey,
    feed, announce, ping, underAttack, jumpToLastEvent, flashOrder, update, drawMinimap,
    hideTooltip,
    get pings() { return pings; },
    get cfg() { return cfg; },
    get orderFlashes() { return orderFlashes; },
  };
})();
