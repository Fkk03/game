/* ============ ui.js — HUD, menus, command grid, minimap, tooltips ============ */
'use strict';
const UI = (() => {
  const $ = id => document.getElementById(id);
  let mmCanvas, cmdButtons = [], curCmds = [];
  let globalProd = null;         // 'barracks' | 'factory' | 'airfield' — auto-distributed production panel
  const pings = [];
  let lastEvent = null;          // {x,y} for Space key
  let lastAttackFeedT = -99;
  let orderFlashes = [];         // brief world markers on orders
  let announceT = 0;

  /* menu config state */
  const cfg = { faction: 'coalition', enemy: 'random', diff: 'normal', map: 'medium', money: 50000,
    allies: 0, enemies: 1, mode: 'domination', superweapons: 'on', startPos: 'auto' };

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
    buildPills('mode-pick', [['domination', '⚑ Domination (first team to 1,000 pts)'], ['annihilation', '💀 Annihilation only']],
      v => cfg.mode = v, 'domination');
    buildPills('sw-pick', [['on', 'Allowed'], ['off', 'Disabled']], v => cfg.superweapons = v, 'on');
    buildPills('pos-pick', [['auto', 'Auto'], ['nw', '↖ NW'], ['n', '↑ N'], ['ne', '↗ NE'],
      ['w', '← W'], ['e', '→ E'], ['sw', '↙ SW'], ['s', '↓ S'], ['se', '↘ SE']],
      v => cfg.startPos = v, 'auto');
    buildPills('allies-pick', [[0, 'None'], [1, '1'], [2, '2'], [3, '3'], [4, '4'], [5, '5']], v => cfg.allies = +v, 0);
    buildPills('enemies-pick', [[1, '1'], [2, '2'], [3, '3'], [4, '4'], [5, '5'], [6, '6'], [7, '7'], [8, '8']],
      v => cfg.enemies = +v, 1);
    buildPills('diff-pick', Object.keys(DIFFICULTY).map(k => [k, DIFFICULTY[k].label]), v => cfg.diff = v, 'normal');
    buildPills('map-pick', Object.keys(MAPSIZES).map(k => [k, MAPSIZES[k].label]), v => cfg.map = v, 'medium');
    buildPills('money-pick', [[10000, '$10,000'], [20000, '$20,000'], [50000, '$50,000'], [100000, '$100,000']],
      v => cfg.money = +v, 50000);

    $('idleworker').onclick = () => { SFX.init(); INPUT.cycleIdleWorker(); };
    for (const el of document.querySelectorAll('.prodtab')) {
      el.onclick = () => { SFX.init(); SFX.click(); setGlobalProd(el.dataset.kind, true); };
    }
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

    /* command grid buttons (20) */
    const grid = $('cmdgrid');
    const KEY_LABELS = ['Q', 'W', 'E', 'R', 'A', 'S', 'D', 'F', 'Z', 'X', 'C', 'V',
      'G', 'H', 'K', 'L', 'Y', 'U', 'N', 'O'];
    for (let i = 0; i < 20; i++) {
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
    globalProd = null;
    $('menu').classList.add('hidden');
    $('topbar').classList.remove('hidden');
    $('bottombar').classList.remove('hidden');
    $('idleworker').classList.remove('hidden');
    $('prodtabs').classList.remove('hidden');
    $('scoreboard').classList.toggle('hidden', !sbVisible);
    $('feed').classList.remove('hidden');
    $('endscreen').classList.add('hidden');
    $('pausemenu').classList.add('hidden');
    $('feed').innerHTML = '';
    refreshPowers(); refreshSel(); refreshCmd();
  }

  function quitToMenu() {
    game.started = false; game.paused = false;
    globalProd = null;
    $('idleworker').classList.add('hidden');
    $('prodtabs').classList.add('hidden');
    $('scoreboard').classList.add('hidden');
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
  function moneyRates(p) {
    // income over the last ~60 s, spending over the last ~150 s
    const h = p.statHist;
    if (!h || h.length < 2) return { inc: 0, out: 0 };
    const now = game.t;
    const at = age => {
      let best = h[0];
      for (const s of h) if (now - s.t >= age) best = s; else break;
      return best;
    };
    const si = at(60), so = at(150);
    const inc = (now - si.t) > 10 ? (p.stats.moneyEarned - si.earned) / (now - si.t) * 60 : 0;
    const out = (now - so.t) > 10 ? (p.stats.moneySpent - so.spent) / (now - so.t) * 60 : 0;
    return { inc: Math.max(0, Math.round(inc)), out: Math.max(0, Math.round(out)) };
  }

  function updateProdTabs() {
    const p = game.players[0];
    if (!p) return;
    for (const el of document.querySelectorAll('.prodtab')) {
      const kind = el.dataset.kind;
      if (!FACTIONS[p.faction].buildings.includes(kind)) { el.style.display = 'none'; continue; }
      el.style.display = '';
      const n = prodBuildings(kind).length;
      el.querySelector('.pt-count').textContent = n;
      el.classList.toggle('dim', n === 0);
      el.classList.toggle('sel', globalProd === kind);
    }
  }

  function refreshTop() {
    const p = game.players[0];
    const rates = moneyRates(p);

    // idle workers + production tab counts
    const iw = INPUT.idleWorkers().length;
    const iwEl = $('idleworker');
    $('iw-count').textContent = iw;
    iwEl.classList.toggle('dim', iw === 0);
    updateProdTabs();
    $('money').innerHTML = `${U.fmtMoney(p.money)} <span id="moneyrates"><span id="rate-in">▲ $${rates.inc.toLocaleString('en-US')}/min</span><span id="rate-out">▼ $${rates.out.toLocaleString('en-US')}/min</span></span>`;
    $('clock').textContent = U.fmtTime(game.t);

    // domination score
    const ds = $('domscore');
    if (game.mode === 'domination' && game.zones.length) {
      const ht = game.players[0].team, et = ht === 0 ? 1 : 0;
      const my = Math.floor(game.domScore[ht] || 0), foe = Math.floor(game.domScore[et] || 0);
      const z = game.zones[0];
      const holder = z.owner < 0 ? '' : (z.owner === ht ? ' ▶' : ' ◀');
      ds.innerHTML = `<span title="Your team's domination points">⚑</span>
        <span class="dom-chip mine">${my}</span>
        <div class="dom-bar"><div class="dom-fill" style="width:${Math.min(100, my / DOM_WIN * 100)}%;background:#6ee06e"></div></div>
        <div class="dom-bar"><div class="dom-fill" style="width:${Math.min(100, foe / DOM_WIN * 100)}%;background:#ff6a50"></div></div>
        <span class="dom-chip foe">${foe}</span><span style="color:#8f8a70;font-size:11px">/${DOM_WIN}${holder}</span>`;
    } else ds.innerHTML = '';

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

    // superweapon timers (friendly = green, hostile = red)
    const sw = $('swtimers');
    let html = '';
    const humanTeam = game.players[0].team;
    for (const e of game.ents) {
      if (e.dead || e.kind !== 'building' || e.key !== 'superweapon' || !e.constructed) continue;
      const friendly = game.players[e.owner].team === humanTeam;
      const kind = BUILDINGS.superweapon.swByFaction[game.players[e.owner].faction];
      const nm = SUPERWEAPONS[kind].name;
      html += `<span class="sw-timer ${friendly ? 'mine' : ''} ${e.swReady ? 'ready' : ''}">${friendly ? '' : '☠ '}${nm}: ${e.swReady ? 'READY' : U.fmtTime(e.swTimer)}</span>`;
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
      if (e.gunLvl) extra += ` &nbsp;<span style="color:#ffb070">⚔+${e.gunLvl * 25}%</span>`;
      if (e.armorLvl) extra += ` &nbsp;<span style="color:#8fc7ff">🛡+${e.armorLvl * 25}%</span>`;
      if (e.kind === 'unit' && e.def.harvester) extra += ` &nbsp;· carrying $${e.carrying || 0}`;
      if (e.kind === 'unit' && e.def.air && e.def.ammo !== undefined) extra += ` &nbsp;· ammo ${e.ammo}/${e.def.ammo}`;
      if (e.kind === 'unit' && e.cargo && e.def.capacity) extra += ` &nbsp;· 🪖 ${e.cargo.length}/${e.def.capacity} aboard`;
      if (e.kind === 'building' && e.key === 'superweapon' && e.constructed)
        extra += e.swReady ? ' &nbsp;· <b style="color:#8f8">READY</b>' : ` &nbsp;· launch in ${U.fmtTime(e.swTimer)}`;
      info.innerHTML = `<b>${nm}</b> &nbsp;${Math.ceil(e.hp)}/${e.maxHp} HP${extra}
        <span class="statline">${entStats(e)}</span>`;
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

  /* full combat readout for the selection panel */
  function entStats(e) {
    const bits = [];
    const d = e.def;
    if (e.kind === 'unit') {
      const w = d.weapon;
      if (w) {
        const dmg = Math.round(w.dmg * VET_DMG[e.vetRank] * (1 + 0.25 * (e.gunLvl || 0)));
        const per = w.projectile === 'nukebomb' ? ' per bomb' :
          w.projectile === 'napalm' ? ' per payload' : ' per missile';
        bits.push(`⚔ ${dmg} ${w.dtype}${d.air ? per : ''}`);
        bits.push(`range ${w.range}`);
        if (w.splash) bits.push(`blast ${w.splash}`);
      }
      if (d.gunWeapon) bits.push(`🔫 ${d.gunWeapon.dmg} ${d.gunWeapon.dtype} vs infantry`);
      if (d.suicide) bits.push(`💣 ${d.suicide.dmg} · blast ${d.suicide.splash}`);
      bits.push(`speed ${d.speed}`);
      bits.push(`armor ${d.armor}`);
      bits.push(`sight ${d.sight}`);
      if (d.detect) bits.push(`detects stealth ${d.detect}`);
      if (hasCloak(e)) bits.push(isStealthed(e) ? '🌑 cloaked' : '⚠ visible');
      bits.push(`<b>kills ${e.kills || 0}</b>`);
    } else {
      const w = d.weaponByFaction ? buildingWeapon(e) : null;
      if (w) {
        bits.push(`⚔ ${w.dmg} ${w.dtype}`);
        bits.push(`range ${w.range}${w.minRange ? ' (min ' + w.minRange + ')' : ''}`);
        if (w.splash) bits.push(`blast ${w.splash}`);
        // manual fire orders: right-click an enemy to assign, right-click ground to release
        if (e.forcedTargetId) {
          const ft = game.byId.get(e.forcedTargetId);
          bits.push(ft && !ft.dead ? '🎯 <b>manual target</b>' : '🎯 target lost');
        } else bits.push('auto-firing');
        bits.push(`<b>kills ${e.kills || 0}</b>`);
      }
      if (d.income) bits.push(`income $${d.income}/s`);
      if (d.powerGive) bits.push(`power +${d.powerGive}`);
      if (d.power) bits.push(`power −${d.power}`);
      if (d.healRate) bits.push(`repairs ${d.healRate} hp/s nearby`);
      if (d.meltdown) bits.push(`☢ meltdown ${d.meltdown.dmg}`);
      if (e.queue && e.queue.length) bits.push(`producing (${e.queue.length} queued)`);
      const ups = Object.keys(e.upgrades || {}).filter(k => e.upgrades[k]);
      if (ups.length) bits.push('⬆ ' + ups.join(', '));
    }
    return bits.join(' &nbsp;· '); 
  }

  /* =================== command grid =================== */
  /* ---- global production: order without selecting a building, auto-split across all of them ---- */
  function prodBuildings(kind) {
    return game.ents.filter(e => !e.dead && e.owner === 0 && e.kind === 'building' &&
      e.key === kind && e.constructed);
  }
  function airfieldLoad(af) {
    // jets parked/assigned to this airfield plus queued aircraft — capped by pads (helis exempt)
    let n = af.queue.filter(q => UNITS[q.key].air && !UNITS[q.key].heli).length;
    for (const e of game.ents) {
      if (!e.dead && e.kind === 'unit' && e.def.air && e.owner === af.owner && e.padId === af.id) n++;
    }
    return n;
  }
  function setGlobalProd(kind, toggle) {
    const p = game.players[0];
    if (!game.started || game.over) return;
    if (kind && !FACTIONS[p.faction].buildings.includes(kind)) return;
    globalProd = (toggle && globalProd === kind) ? null : kind;
    if (globalProd) { INPUT.selection = []; refreshSel(); }
    refreshCmd();
  }
  function globalEnqueue(kind, key) {
    const p = game.players[0];
    const list = prodBuildings(kind);
    if (!list.length) { feed('No ' + bName(kind, p.faction) + ' built yet', 'bad'); SFX.error(); return false; }
    // pick the least-loaded building (for airfields, respect the pad limit)
    let best = null, bestScore = Infinity;
    for (const b of list) {
      if (b.queue.length >= 7) continue;
      let score = b.queue.length;
      if (UNITS[key].air) {
        const load = airfieldLoad(b);
        if (load >= (b.def.pads || 4)) continue;
        score += load * 0.1;
      }
      if (score < bestScore) { bestScore = score; best = b; }
    }
    if (!best) {
      feed(UNITS[key].air ? 'All airfield pads are full — build more airfields' : 'All production queues are full', 'bad');
      SFX.error(); return false;
    }
    if (!best.enqueue(key)) { feed('Insufficient funds', 'bad'); SFX.error(); SFX.say('Insufficient funds'); return false; }
    return true;
  }

  function refreshCmd() {
    const sel = INPUT.selection.filter(e => e.owner === 0 && !e.dead);
    curCmds = new Array(20).fill(null);
    const title = $('cmdtitle');
    const p = game.players[0];

    for (const b of cmdButtons) { b.className = 'cmd-btn disabled';
      b.innerHTML = `<span class="hk">${['Q','W','E','R','A','S','D','F','Z','X','C','V','G','H','K','L','Y','U','N','O'][b.dataset.idx]}</span>`; }

    if (sel.length && globalProd) globalProd = null;   // picking something closes the global panel
    updateProdTabs();

    if (globalProd) {
      const kind = globalProd;
      const list = prodBuildings(kind);
      title.textContent = `ALL ${bName(kind, p.faction)}s (${list.length}) — orders auto-split · Shift-click ×5`;
      bTrains(kind, p.faction).forEach((uk, i) => { if (i < 20) curCmds[i] = { type: 'gtrain', key: uk, bkind: kind }; });
      paintCmds(p);
      return;
    }

    if (!sel.length) { title.textContent = ''; return; }

    const units = sel.filter(e => e.kind === 'unit');
    // construction menu ONLY when every selected unit is a builder —
    // a dozer inside an army selection must not hijack the A/S/D commands
    const dozer = units.length && units.every(u => u.def.builder) ? units[0] : null;
    const building = sel.length === 1 && sel[0].kind === 'building' ? sel[0] : null;

    if (dozer) {
      title.textContent = FACTIONS[p.faction].dozerName + ' — construction';
      const keys = FACTIONS[p.faction].buildings.filter(k => k !== 'superweapon' || game.swAllowed !== false);
      keys.forEach((bk, i) => {
        if (i >= 20) return;
        curCmds[i] = { type: 'place', key: bk };
      });
    } else if (units.length) {
      title.textContent = units.length === 1 ? uName(units[0].key, p.faction) : units.length + ' units';
      curCmds[4] = { type: 'attackmove' };   // A
      curCmds[5] = { type: 'stop' };         // S
      curCmds[6] = { type: 'guardbtn' };     // D
      // veteran tanks buy field upgrades: guns (R) and armor plating (F), one level per star (max 3)
      const upTanks = kind => units.filter(u => TANK_CHASSIS.includes(u.def.chassis) &&
        u.vetRank >= 1 && ((kind === 'gun' ? u.gunLvl : u.armorLvl) || 0) < Math.min(3, u.vetRank));
      const gunEligible = upTanks('gun'), armorEligible = upTanks('armor');
      if (gunEligible.length) curCmds[3] = { type: 'tankup', kind: 'gun', units: gunEligible };
      if (armorEligible.length && !curCmds[7]) curCmds[7] = { type: 'tankup', kind: 'armor', units: armorEligible };
      // transports with troops aboard get an Unload command (F)
      const transports = units.filter(u => u.cargo && u.def.capacity);
      if (transports.length) curCmds[7] = { type: 'unloadbtn', transports };
      // coalition veteran aircraft can be retrofitted with a cloak
      if (p.faction === 'coalition') {
        const eligible = units.filter(u => u.def.air && u.vetRank >= 1 && !u.def.stealthAir && !u.stealthUpgrade);
        if (eligible.length) curCmds[3] = { type: 'stealthup', units: eligible };   // R
      }
    } else if (building) {
      title.textContent = bName(building.key, p.faction);
      if (!building.constructed) {
        curCmds[7] = { type: 'cancelsite' }; // F
      } else {
        const trains = bTrains(building.key, p.faction);
        trains.forEach((uk, i) => { if (i < 16) curCmds[i] = { type: 'train', key: uk, building }; });
        // purchasable upgrades fill the free slots after the unit list
        let slot = Math.min(trains.length, 16);
        for (const up of (UPGRADES[building.key] || [])) {
          if (building.upgrades[up.key]) continue;
          while (slot < 19 && curCmds[slot]) slot++;
          if (slot >= 19) break;
          curCmds[slot] = { type: 'upgrade', up, building };
          slot++;
        }
        curCmds[19] = { type: 'sell' };      // O
      }
    }

    paintCmds(p);
  }

  function paintCmds(p) {
    curCmds.forEach((c, i) => {
      if (!c) return;
      const b = cmdButtons[i];
      b.classList.remove('disabled');
      const hk = b.querySelector('.hk')?.outerHTML || '';
      if (c.type === 'gtrain') {
        const def = UNITS[c.key];
        const cost = uCost(c.key, p.faction);
        const list = prodBuildings(c.bkind);
        const cnt = list.reduce((n, bl) => n + bl.queue.filter(q => q.key === c.key).length, 0);
        let prog = 0;
        for (const bl of list) if (bl.queue[0] && bl.queue[0].key === c.key) prog = Math.max(prog, bl.queue[0].prog);
        b.innerHTML = `${hk}<span class="icon">${def.icon}</span><span>${uName(c.key, p.faction).split(' ')[0]}</span><span class="cost">$${cost}</span>
          ${cnt ? `<span class="count">${cnt}</span>` : ''}
          <div class="prog" style="width:${Math.round(prog * 100)}%"></div>`;
        if (p.money < cost) b.classList.add('disabled');
      } else if (c.type === 'place') {
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
        const cost = uCost(c.key, p.faction);
        const cnt = c.building.queue.filter(q => q.key === c.key).length;
        let atLimit = false;
        if (def.limitPer) {
          let n = 0;
          for (const e of game.ents) {
            if (e.dead || e.owner !== 0) continue;
            if (e.kind === 'unit' && e.key === c.key) n++;
            if (e.kind === 'building') n += (e.queue || []).filter(q => q.key === c.key).length;
          }
          atLimit = n >= def.limitPer;
        }
        b.innerHTML = `${hk}<span class="icon">${def.icon}</span><span>${uName(c.key, p.faction).split(' ')[0]}</span><span class="cost">${atLimit ? 'MAX' : '$' + cost}</span>
          ${cnt ? `<span class="count">${cnt}</span>` : ''}
          <div class="prog" style="width:${c.building.queue[0] && c.building.queue[0].key === c.key ? Math.round(c.building.queue[0].prog * 100) : 0}%"></div>`;
        if (p.money < cost || atLimit) b.classList.add('disabled');
      } else if (c.type === 'upgrade') {
        const cost = Math.round(BUILDINGS[c.building.key].cost * c.up.costMul);
        b.innerHTML = `${hk}<span class="icon">${c.up.icon}</span><span>${c.up.name}</span><span class="cost">$${cost}</span>`;
        b.classList.add('upg');
        if (p.money < cost) b.classList.add('disabled');
      } else if (c.type === 'tankup') {
        const n = c.units.length;
        const cost = Math.round(uCost(c.units[0].key, p.faction) * 0.3);
        b.innerHTML = `${hk}<span class="icon">${c.kind === 'gun' ? '⚔️' : '🛡️'}</span><span>${c.kind === 'gun' ? 'Gun +25%' : 'Armor +25%'}</span><span class="cost">~$${cost}${n > 1 ? '×' + n : ''}</span>`;
        b.classList.add('upg');
        if (p.money < cost) b.classList.add('disabled');
      } else if (c.type === 'unloadbtn') {
        const n = c.transports.reduce((a, t) => a + t.cargo.length, 0);
        b.innerHTML = `${hk}<span class="icon">🪂</span><span>Unload</span><span class="cost">${n} aboard</span>`;
        if (!n) b.classList.add('disabled');
      } else if (c.type === 'stealthup') {
        const n = c.units.length;
        b.innerHTML = `${hk}<span class="icon">🌑</span><span>Stealth</span><span class="cost">$2,000${n > 1 ? '×' + n : ''}</span>`;
        if (p.money < 2000) b.classList.add('disabled');
      } else if (c.type === 'attackmove') {
        b.innerHTML = `${hk}<span class="icon">⚔️</span><span>Attack-Move</span>`;
      } else if (c.type === 'stop') {
        b.innerHTML = `${hk}<span class="icon">✋</span><span>Stop</span>`;
      } else if (c.type === 'tankup') {
        const n = c.units.length;
        const cost = Math.round(uCost(c.units[0].key, p.faction) * 0.3);
        b.innerHTML = `${hk}<span class="icon">${c.kind === 'gun' ? '⚔️' : '🛡️'}</span><span>${c.kind === 'gun' ? 'Gun +25%' : 'Armor +25%'}</span><span class="cost">~$${cost}${n > 1 ? '×' + n : ''}</span>`;
        b.classList.add('upg');
        if (p.money < cost) b.classList.add('disabled');
      } else if (c.type === 'tankup') {
      tooltipHtml(el, `<h4>${c.kind === 'gun' ? '⚔️ Gun Upgrade' : '🛡️ Armor Plating'}</h4>
        <div class="tt-cost">30% of the tank's cost per level · one level per veterancy star (max 3)</div>
        <div class="tt-desc">${c.kind === 'gun' ? '+25% weapon damage per level, stacking with veterancy.' : '+25% maximum health per level, stacking with veterancy; the crew patches in the new plating immediately.'}</div>`);
    } else if (c.type === 'unloadbtn') {
      tooltipHtml(el, `<h4>🪂 Unload</h4><div class="tt-desc">Deploy every soldier aboard onto open ground below the transport. Hotkey F.</div>`);
    } else if (c.type === 'guardbtn') {
        b.innerHTML = `${hk}<span class="icon">🛡️</span><span>Guard Area</span>`;
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
        const reps = INPUT.keys['shift'] ? 5 : 1;
        let ok = false;
        for (let n = 0; n < reps; n++) {
          if (!c.building.enqueue(c.key)) {
            if (!ok) { feed('Insufficient funds', 'bad'); SFX.error(); SFX.say('Insufficient funds'); }
            break;
          }
          ok = true;
        }
        if (ok) SFX.click();
        refreshCmd();
        break;
      }
      case 'gtrain': {
        const reps = INPUT.keys['shift'] ? 5 : 1;
        let ok = false;
        for (let n = 0; n < reps; n++) {
          if (!globalEnqueue(c.bkind, c.key)) break;
          ok = true;
        }
        if (ok) SFX.click();
        refreshCmd();
        break;
      }
      case 'upgrade': {
        const bld = c.building, up = c.up;
        const cost = Math.round(BUILDINGS[bld.key].cost * up.costMul);
        if (bld.dead || bld.upgrades[up.key]) { refreshCmd(); break; }
        if (p.money < cost) { feed('Insufficient funds', 'bad'); SFX.error(); SFX.say('Insufficient funds'); break; }
        p.spend(cost);
        bld.upgrades[up.key] = true;
        if (up.hpMul) {
          const add = Math.round(bld.def.hp * (up.hpMul - 1));
          bld.maxHp += add; bld.hp += add;
        }
        FX.text(bld.x, bld.y - bld.size * 14, up.icon + ' ' + up.name.toUpperCase(), '#9fdc7c');
        feed(up.name + ' installed on ' + bName(bld.key, p.faction), 'gold');
        SFX.cash();
        refreshCmd();
        break;
      }
      case 'tankup': {
        let done = 0;
        for (const u of c.units) {
          if (u.dead) continue;
          const lvl = (c.kind === 'gun' ? u.gunLvl : u.armorLvl) || 0;
          if (lvl >= Math.min(3, u.vetRank)) continue;
          const cost = Math.round(uCost(u.key, p.faction) * 0.3);
          if (p.money < cost) break;
          p.spend(cost);
          if (c.kind === 'gun') u.gunLvl = lvl + 1;
          else {
            u.armorLvl = lvl + 1;
            const nm = Math.round(u.def.hp * VET_HP[u.vetRank] * (1 + 0.25 * u.armorLvl));
            u.hp += nm - u.maxHp;
            u.maxHp = nm;
          }
          FX.text(u.x, u.y - 22, c.kind === 'gun' ? '⚔ GUN UPGRADED' : '🛡 ARMOR PLATED', '#ffd76a');
          done++;
        }
        if (done) { SFX.cash(); feed(`${c.kind === 'gun' ? 'Gun' : 'Armor'} upgrade fitted on ${done} tank${done > 1 ? 's' : ''}`, 'gold'); }
        else { feed('Insufficient funds', 'bad'); SFX.error(); }
        refreshSel(); refreshCmd();
        break;
      }
      case 'unloadbtn': {
        let any = 0;
        for (const t of c.transports) { if (t.cargo.length) { t.giveOrder({ type: 'unload' }); any++; } }
        if (any) SFX.click();
        break;
      }
      case 'stealthup': {
        let fitted = 0;
        for (const u of c.units) {
          if (u.dead || p.money < 2000) break;
          p.spend(2000);
          u.stealthUpgrade = true;
          u.decloakUntil = 0;
          FX.text(u.x, u.y - 24, '🌑 CLOAK FITTED', '#b9a5ff');
          fitted++;
        }
        if (fitted) { SFX.cash(); feed(`Stealth retrofit fitted on ${fitted} aircraft`, 'gold'); }
        else { feed('Insufficient funds', 'bad'); SFX.error(); }
        refreshSel(); refreshCmd();
        break;
      }
      case 'attackmove': INPUT.awaitAttackMove = true; feed('Attack-move — click the target area'); SFX.click(); break;
      case 'guardbtn': INPUT.awaitGuard = true; SFX.click(); break;
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
      if (!c) return;
      if (c.type === 'train') {
        const prog = cmdButtons[i].querySelector('.prog');
        if (prog) prog.style.width = (c.building.queue[0] && c.building.queue[0].key === c.key ?
          Math.round(c.building.queue[0].prog * 100) : 0) + '%';
        const cnt = cmdButtons[i].querySelector('.count');
        const n = c.building.queue.filter(q => q.key === c.key).length;
        if (cnt) cnt.textContent = n || '';
        else if (n) refreshCmd();
      } else if (c.type === 'gtrain') {
        const list = prodBuildings(c.bkind);
        let pv = 0, n = 0;
        for (const bl of list) {
          n += bl.queue.filter(q => q.key === c.key).length;
          if (bl.queue[0] && bl.queue[0].key === c.key) pv = Math.max(pv, bl.queue[0].prog);
        }
        const prog = cmdButtons[i].querySelector('.prog');
        if (prog) prog.style.width = Math.round(pv * 100) + '%';
        const cnt = cmdButtons[i].querySelector('.count');
        if (cnt) cnt.textContent = n || '';
        else if (n) refreshCmd();
      }
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
        <div class="tt-cost">$${uCost(c.key, p.faction)} · ${def.buildTime}s${def.limitPer ? ' · max ' + def.limitPer : ''}</div>
        <div class="tt-desc">${def.desc}</div>`);
    } else if (c.type === 'upgrade') {
      tooltipHtml(el, `<h4>${c.up.icon} ${c.up.name}</h4>
        <div class="tt-cost">$${Math.round(BUILDINGS[c.building.key].cost * c.up.costMul)} · one-time building upgrade</div>
        <div class="tt-desc">${c.up.desc}</div>`);
    } else if (c.type === 'stealthup') {
      tooltipHtml(el, `<h4>🌑 Stealth Retrofit</h4>
        <div class="tt-cost">$2,000 per aircraft · requires ★ veterancy · Coalition only</div>
        <div class="tt-desc">Fit a cloak to this veteran aircraft. It stays invisible in flight (only satellite-detection units can see it), decloaks for ~1 s when it fires, then fades back out. While cloaked it takes 75% less damage. Colors dim while cloaked, brighten while visible.</div>`);
    } else if (c.type === 'attackmove') {
      tooltipHtml(el, `<h4>⚔️ Attack-Move</h4><div class="tt-desc">Move while engaging every enemy on the way. Hotkey A, then click the map.</div>`);
    } else if (c.type === 'stop') {
      tooltipHtml(el, `<h4>✋ Stop</h4><div class="tt-desc">Halt and hold position.</div>`);
    } else if (c.type === 'tankup') {
      tooltipHtml(el, `<h4>${c.kind === 'gun' ? '⚔️ Gun Upgrade' : '🛡️ Armor Plating'}</h4>
        <div class="tt-cost">30% of the tank's cost per level · one level per veterancy star (max 3)</div>
        <div class="tt-desc">${c.kind === 'gun' ? '+25% weapon damage per level, stacking with veterancy.' : '+25% maximum health per level, stacking with veterancy; the crew patches in the new plating immediately.'}</div>`);
    } else if (c.type === 'unloadbtn') {
      tooltipHtml(el, `<h4>🪂 Unload</h4><div class="tt-desc">Deploy every soldier aboard onto open ground below the transport. Hotkey F.</div>`);
    } else if (c.type === 'guardbtn') {
      tooltipHtml(el, `<h4>🛡️ Guard Area</h4><div class="tt-desc">Move to a point and hold it — engages enemies that come near, then returns to the post. Hotkey D, then click the map.</div>`);
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

  /* ---------------- live battle scoreboard ---------------- */
  let sbVisible = true;
  function toggleScoreboard() {
    sbVisible = !sbVisible;
    $('scoreboard').classList.toggle('hidden', !sbVisible || !game.started);
  }

  function refreshScoreboard() {
    if (!sbVisible || !game.started) return;
    const rows = $('sb-rows');
    // army value per player (combat units only)
    const armies = game.players.map(() => 0);
    for (const e of game.ents) {
      if (e.dead || e.kind !== 'unit' || e.owner < 0) continue;
      if (!e.def.weapon && !e.def.suicide) continue;
      armies[e.owner] += e.def.cost;
    }
    const humanTeam = game.players[0].team;
    const sorted = [...game.players].sort((a, b) =>
      (a.team === humanTeam ? 0 : 1) - (b.team === humanTeam ? 0 : 1) || a.idx - b.idx);
    let html = `<div class="sb-cols"><span>GENERAL</span><span>KILLS</span><span>ARMY $</span><span>CASH</span></div>`;
    for (const p of sorted) {
      const tag = p.idx === 0 ? 'You' : (p.team === humanTeam ? 'Ally' : 'Enemy');
      html += `<div class="sb-row${p.idx === 0 ? ' me' : ''}${p.defeated ? ' sb-dead' : ''}">
        <span class="sb-chip" style="background:${p.color}"></span>
        <span class="sb-name">${FACTIONS[p.faction].flag} ${FACTIONS[p.faction].name.split(' ')[1] || FACTIONS[p.faction].name} <span class="sb-tag">· ${tag}</span></span>
        <span class="sb-kills">${p.stats.kills}</span>
        <span class="sb-army">$${armies[p.idx].toLocaleString('en-US')}</span>
        <span class="sb-cash">$${Math.round(p.money).toLocaleString('en-US')}</span>
      </div>`;
    }
    rows.innerHTML = html;
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
    toggleScoreboard, refreshScoreboard,
    refreshTop, refreshPowers, refreshSel, refreshCmd, refreshCmdProgress, triggerHotkey,
    feed, announce, ping, underAttack, jumpToLastEvent, flashOrder, update, drawMinimap,
    hideTooltip, setGlobalProd,
    get globalProd() { return globalProd; },
    get pings() { return pings; },
    get cfg() { return cfg; },
    get orderFlashes() { return orderFlashes; },
  };
})();
