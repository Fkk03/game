/* ============ input.js — mouse, keyboard, camera, selection, orders ============ */
'use strict';
const INPUT = (() => {
  const mouse = { x: -1, y: -1, wx: 0, wy: 0, down: false, downX: 0, downY: 0, mmb: false };
  let selection = [];
  let dragBox = null;
  let placing = null;            // {key, tx, ty, ok}
  let targeting = null;          // {kind:'power'|'sw', key, siloId, label}
  let awaitAttackMove = false;
  let awaitGuard = false;

  function isEnemyOfHuman(e) {
    if (!e || e.owner < 0) return false;
    const p = game.players[e.owner];
    return p && p.team !== game.players[0].team;
  }
  const groups = {};             // ctrl groups 1..9
  let lastClickT = 0, lastClickId = 0;
  let lastGroupKey = '', lastGroupT = 0;
  const keys = {};

  const GRID_KEYS = ['q', 'w', 'e', 'r', 'a', 's', 'd', 'f', 'z', 'x', 'c', 'v'];

  function init(canvas) {
    canvas.addEventListener('mousemove', e => {
      mouse.x = e.clientX; mouse.y = e.clientY;
      if (mouse.mmb) {
        game.cam.x -= e.movementX / game.cam.zoom;
        game.cam.y -= e.movementY / game.cam.zoom;
        clampCam();
      }
      if (mouse.down && !dragBox &&
          U.dist(mouse.x, mouse.y, mouse.downX, mouse.downY) > 6) {
        dragBox = { x0: mouse.downX, y0: mouse.downY, x1: mouse.x, y1: mouse.y };
      }
      if (dragBox) { dragBox.x1 = mouse.x; dragBox.y1 = mouse.y; }
    });
    canvas.addEventListener('mouseleave', () => { mouse.x = -1; mouse.y = -1; });

    canvas.addEventListener('mousedown', e => {
      SFX.init();
      if (!game.started || game.over) return;
      if (e.button === 0) {
        mouse.down = true; mouse.downX = e.clientX; mouse.downY = e.clientY;
      } else if (e.button === 1) {
        mouse.mmb = true; e.preventDefault();
      }
    });

    window.addEventListener('mouseup', e => {
      if (e.button === 1) { mouse.mmb = false; return; }
      if (e.button !== 0) return;
      const wasDown = mouse.down;
      const wasDrag = !!dragBox;
      const box = dragBox;
      mouse.down = false; dragBox = null;
      // only handle releases of presses that began on the game canvas —
      // otherwise HUD button clicks would fire world-click logic too
      if (!wasDown) return;
      if (!game.started || game.over || game.paused) return;

      if (placing) { tryPlace(e.shiftKey); return; }
      if (targeting) { fireTargeted(); return; }
      if (awaitAttackMove) {
        issueAttackMove(RENDER.toWorldX(mouse.x), RENDER.toWorldY(mouse.y), e.shiftKey);
        awaitAttackMove = false;
        return;
      }
      if (awaitGuard) {
        issueGuard(RENDER.toWorldX(mouse.x), RENDER.toWorldY(mouse.y), e.shiftKey);
        awaitGuard = false;
        return;
      }
      if (wasDrag) boxSelect(box, e.shiftKey);
      else clickSelect(e.shiftKey);
    });

    canvas.addEventListener('contextmenu', e => {
      e.preventDefault();
      if (!game.started || game.over) return;
      if (placing) { placing = null; UI.refreshCmd(); return; }
      if (targeting) { targeting = null; UI.refreshPowers(); return; }
      if (awaitAttackMove) { awaitAttackMove = false; return; }
      if (awaitGuard) { awaitGuard = false; return; }
      issueSmartOrder(RENDER.toWorldX(e.clientX), RENDER.toWorldY(e.clientY), e.shiftKey);
    });

    canvas.addEventListener('wheel', e => {
      e.preventDefault();
      if (!game.started) return;
      const oldZ = game.cam.zoom;
      const nz = U.clamp(oldZ * (e.deltaY < 0 ? 1.13 : 0.885), 0.45, 1.9);
      // zoom about cursor
      const wx = RENDER.toWorldX(e.clientX), wy = RENDER.toWorldY(e.clientY);
      game.cam.zoom = nz;
      game.cam.x = wx - e.clientX / nz;
      game.cam.y = wy - e.clientY / nz;
      clampCam();
    }, { passive: false });

    window.addEventListener('keydown', e => {
      keys[e.key.toLowerCase()] = true;
      if (!game.started) return;
      const k = e.key.toLowerCase();

      if (k === 'escape') {
        if (placing) { placing = null; UI.refreshCmd(); }
        else if (targeting) { targeting = null; UI.refreshPowers(); }
        else if (awaitAttackMove) awaitAttackMove = false;
        else if (awaitGuard) awaitGuard = false;
        else if (UI.globalProd) UI.setGlobalProd(null);
        else UI.togglePause();
        e.preventDefault(); return;
      }
      if (game.over) return;
      if (k === 'p') { UI.togglePause(); return; }
      if (k === 'm') { UI.toggleSound(); return; }
      if (game.paused) return;   // no orders / spending while paused
      if (k === ' ') { e.preventDefault(); UI.jumpToLastEvent(); return; }
      if (k === 'backspace') { e.preventDefault(); centerOnBase(); return; }
      if (k === 'f1') { e.preventDefault(); UI.showHelp(); return; }
      if (k === 'tab') { e.preventDefault(); UI.toggleScoreboard(); return; }
      if (k === 'i') { e.preventDefault(); cycleIdleWorker(); return; }
      if (k === 'b') { e.preventDefault(); UI.setGlobalProd('barracks', true); return; }
      if (k === 't') { e.preventDefault(); UI.setGlobalProd('factory', true); return; }
      if (k === 'j') { e.preventDefault(); UI.setGlobalProd('airfield', true); return; }

      // control groups
      if (/^[1-9]$/.test(k)) {
        if (e.ctrlKey || e.metaKey) {
          groups[k] = selection.filter(s => s.owner === 0);
          UI.feed('Group ' + k + ' assigned (' + groups[k].length + ')');
          e.preventDefault();
        } else {
          const g = (groups[k] || []).filter(s => !s.dead);
          groups[k] = g;
          if (g.length) {
            selection = [...g];
            UI.refreshSel(); UI.refreshCmd();
            const now = performance.now();
            if (lastGroupKey === k && now - lastGroupT < 400) centerOn(avgPos(g));
            lastGroupKey = k; lastGroupT = now;
          }
        }
        return;
      }

      // command grid hotkeys
      if (!e.ctrlKey && !e.metaKey && GRID_KEYS.includes(k)) {
        if (UI.triggerHotkey(GRID_KEYS.indexOf(k))) { e.preventDefault(); return; }
      }
    });
    window.addEventListener('keyup', e => { keys[e.key.toLowerCase()] = false; });
  }

  /* ---------------- camera ---------------- */
  function clampCam() {
    const vw = RENDER.W / game.cam.zoom, vh = RENDER.H / game.cam.zoom;
    game.cam.x = U.clamp(game.cam.x, -80, Math.max(-80, world.pw - vw + 80));
    game.cam.y = U.clamp(game.cam.y, -60, Math.max(-60, world.ph - vh + 60));
  }

  function updateCamera(dt) {
    if (!game.started || game.paused) return;
    const sp = 640 / game.cam.zoom * dt;
    const edge = 14;
    let dx = 0, dy = 0;
    if (keys['arrowleft']) dx -= 1;
    if (keys['arrowright']) dx += 1;
    if (keys['arrowup']) dy -= 1;
    if (keys['arrowdown']) dy += 1;
    if (document.hasFocus() && mouse.x >= 0) {
      if (mouse.x < edge) dx -= 1;
      if (mouse.x > RENDER.W - edge) dx += 1;
      if (mouse.y < edge) dy -= 1;
      if (mouse.y > RENDER.H - edge && mouse.y < RENDER.H - 2) dy += 1;
    }
    if (dx || dy) { game.cam.x += dx * sp; game.cam.y += dy * sp; clampCam(); }
    mouse.wx = RENDER.toWorldX(mouse.x); mouse.wy = RENDER.toWorldY(mouse.y);
  }

  function centerOn(pos) {
    game.cam.x = pos.x - RENDER.W / 2 / game.cam.zoom;
    game.cam.y = pos.y - RENDER.H / 2 / game.cam.zoom;
    clampCam();
  }
  function centerOnBase() {
    const cc = game.ents.find(e => !e.dead && e.owner === 0 && e.kind === 'building' && e.key === 'cc');
    const b = cc || game.ents.find(e => !e.dead && e.owner === 0 && e.kind === 'building');
    if (b) centerOn(b);
  }
  function avgPos(list) {
    let x = 0, y = 0;
    for (const e of list) { x += e.x; y += e.y; }
    return { x: x / list.length, y: y / list.length };
  }

  /* ---------------- selection ---------------- */
  function entAt(wx, wy) {
    let best = null, bestScore = -1;
    for (const e of game.ents) {
      if (e.dead || e.embarked) continue;
      if (isEnemyOfHuman(e) && !world.isVisible(e.x, e.y)) continue;
      if (isEnemyOfHuman(e) && isStealthed(e) && !isDetectedBy(e, game.players[0].team)) continue;
      let hit = false;
      if (e.kind === 'unit') hit = U.dist(wx, wy, e.x, e.y) < e.radius + 7;
      else hit = wx >= e.tx * TILE && wx <= (e.tx + e.size) * TILE && wy >= e.ty * TILE && wy <= (e.ty + e.size) * TILE;
      if (!hit) continue;
      let score = e.kind === 'unit' ? 3 : 1;
      if (e.owner === 0) score += 1;
      if (score > bestScore) { bestScore = score; best = e; }
    }
    return best;
  }

  function clickSelect(shift) {
    const wx = RENDER.toWorldX(mouse.x), wy = RENDER.toWorldY(mouse.y);
    const e = entAt(wx, wy);
    const now = performance.now();

    // double-click: select all of same type on screen
    if (e && e.owner === 0 && e.id === lastClickId && now - lastClickT < 380) {
      selection = game.ents.filter(o => !o.dead && o.owner === 0 && o.key === e.key &&
        RENDER.toScreenX(o.x) >= 0 && RENDER.toScreenX(o.x) <= RENDER.W &&
        RENDER.toScreenY(o.y) >= 0 && RENDER.toScreenY(o.y) <= RENDER.H);
      UI.refreshSel(); UI.refreshCmd(); SFX.select();
      lastClickId = 0;
      return;
    }
    lastClickT = now; lastClickId = e ? e.id : 0;

    if (!e) { if (!shift) { selection = []; UI.refreshSel(); UI.refreshCmd(); } return; }
    if (shift) {
      const i = selection.indexOf(e);
      if (i >= 0) selection.splice(i, 1);
      else if (e.owner === 0) selection.push(e);
    } else {
      selection = [e];
    }
    SFX.select();
    UI.refreshSel(); UI.refreshCmd();
  }

  function boxSelect(box, shift) {
    const x0 = Math.min(box.x0, box.x1), x1 = Math.max(box.x0, box.x1);
    const y0 = Math.min(box.y0, box.y1), y1 = Math.max(box.y0, box.y1);
    const units = [], buildings = [];
    for (const e of game.ents) {
      if (e.dead || e.owner !== 0) continue;
      const sx = RENDER.toScreenX(e.x), sy = RENDER.toScreenY(e.y);
      if (sx < x0 || sx > x1 || sy < y0 || sy > y1) continue;
      if (e.kind === 'unit') units.push(e); else buildings.push(e);
    }
    let picked = units.length ? units : buildings.slice(0, 1);
    if (shift) {
      for (const u of picked) if (!selection.includes(u)) selection.push(u);
    } else selection = picked;
    if (picked.length) SFX.select();
    UI.refreshSel(); UI.refreshCmd();
  }

  function prune() {
    const before = selection.length;
    selection = selection.filter(e => !e.dead && !e.embarked);
    if (selection.length !== before) { UI.refreshSel(); UI.refreshCmd(); }
  }

  /* ---------------- orders ---------------- */
  function myUnitsSelected() { return selection.filter(e => e.kind === 'unit' && e.owner === 0); }

  function issueSmartOrder(wx, wy, shift) {
    const units = myUnitsSelected();
    const target = entAt(wx, wy);
    const dock = world.dockAt(wx, wy);

    // production building rally point
    if (!units.length) {
      const b = selection.find(e => e.kind === 'building' && e.owner === 0);
      if (b && (bTrains(b.key, game.players[0].faction).length)) {
        b.rallyX = wx; b.rallyY = wy;
        SFX.click();
      }
      return;
    }

    let acted = false;
    if (target && isEnemyOfHuman(target)) {
      for (const u of units) {
        if (u.def.suicide || (u.def.weapon && weaponCanHit(u.def.weapon, target))) {
          u.giveOrder({ type: 'attack', targetId: target.id }, shift);
          acted = true;
        } else {
          u.giveOrder({ type: 'move', x: wx, y: wy }, shift);
        }
      }
      if (acted) SFX.ack();
      UI.flashOrder(wx, wy, 'attack');
      return;
    }

    if (dock) {
      let anyTruck = false;
      for (const u of units) {
        if (u.def.harvester) { u.giveOrder({ type: 'harvest', dock }, shift); anyTruck = true; }
        else u.giveOrder({ type: 'move', x: wx, y: wy }, shift);
      }
      if (anyTruck) { SFX.ack(); UI.flashOrder(wx, wy, 'move'); return; }
    }

    // transports: troops right-click a friendly transport to board it;
    // a selected transport right-clicks a soldier to winch them up
    if (target && target.owner === 0 && target.kind === 'unit') {
      const INF = ['inf', 'rocketinf', 'commando'];
      if (target.cargo && target.def.capacity) {
        let boarded = 0;
        for (const u of units) {
          if (INF.includes(u.def.chassis)) { u.giveOrder({ type: 'board', targetId: target.id }, shift); boarded++; }
        }
        if (boarded) { SFX.ack(); UI.flashOrder(wx, wy, 'move'); return; }
      }
      if (INF.includes(target.def.chassis)) {
        let sent = 0;
        for (const u of units) {
          if (u.cargo && u.def.capacity) { u.giveOrder({ type: 'load', targetId: target.id }, shift); sent++; }
        }
        if (sent) { SFX.ack(); return; }
      }
    }

    if (target && target.owner === 0 && target.kind === 'building') {
      let anyDozer = false;
      for (const u of units) {
        if (u.def.builder) {
          if (!target.constructed) { u.giveOrder({ type: 'build', targetId: target.id }, shift); anyDozer = true; }
          else if (target.hp < target.maxHp) { u.giveOrder({ type: 'repair', targetId: target.id }, shift); anyDozer = true; }
        }
      }
      if (anyDozer) { SFX.ack(); return; }
    }

    // plain move with loose formation spread
    const n = units.length;
    const cols = Math.ceil(Math.sqrt(n));
    let i = 0;
    for (const u of units) {
      const cx = (i % cols) - (cols - 1) / 2;
      const cy = Math.floor(i / cols) - (Math.ceil(n / cols) - 1) / 2;
      const spread = Math.max(30, u.radius * 2.6);
      u.giveOrder({ type: 'move', x: wx + cx * spread, y: wy + cy * spread }, shift);
      i++;
    }
    if (n) { SFX.ack(); UI.flashOrder(wx, wy, 'move'); }
  }

  function issueAttackMove(wx, wy, shift) {
    const units = myUnitsSelected();
    for (const u of units) {
      if (u.def.weapon || u.def.suicide) u.giveOrder({ type: 'attackmove', x: wx, y: wy }, shift);
      else u.giveOrder({ type: 'move', x: wx, y: wy }, shift);
    }
    if (units.length) { SFX.ack(); UI.flashOrder(wx, wy, 'attack'); }
  }

  function issueGuard(wx, wy, shift) {
    const units = myUnitsSelected();
    for (const u of units) {
      // every aircraft can hold a post — unarmed recon planes hover and watch
      if (u.def.air || (u.def.weapon && !u.def.noAutoAttack)) u.giveOrder({ type: 'guardarea', x: wx, y: wy }, shift);
      else u.giveOrder({ type: 'move', x: wx, y: wy }, shift);
    }
    if (units.length) { SFX.ack(); UI.flashOrder(wx, wy, 'move'); }
  }

  function stopSelected() {
    for (const u of myUnitsSelected()) {
      u.giveOrder({ type: 'stop' });
      u.order = { type: 'guard' };
      u.guardX = u.x; u.guardY = u.y;
      u.path = null;
      if (u.def.air) { u.jetState = u.padId ? 'return' : 'idle'; u.persistTargetId = 0; u.guardPost = null; }
    }
    SFX.click();
  }

  /* ---------------- placement & targeting ---------------- */
  function beginPlace(key) {
    placing = { key, tx: 0, ty: 0, ok: false };
    targeting = null;
  }

  function tryPlace(shift) {
    const pl = placing;
    if (!pl || !pl.ok) { SFX.error(); return; }
    const def = BUILDINGS[pl.key];
    const p = game.players[0];
    if (p.money < def.cost) { UI.feed('Insufficient funds', 'bad'); SFX.error(); SFX.say('Insufficient funds'); return; }
    // limit check
    if (def.limit) {
      const n = game.ents.filter(e => !e.dead && e.owner === 0 && e.kind === 'building' && e.key === pl.key).length;
      if (n >= def.limit) { UI.feed('Limit reached', 'bad'); SFX.error(); placing = null; return; }
    }
    p.spend(def.cost);
    const b = new Building(0, pl.key, pl.tx, pl.ty, false);
    game.addEnt(b);
    // send a builder: prefer a selected dozer, else the nearest idle one you own
    let dozers = myUnitsSelected().filter(u => u.def.builder);
    if (!dozers.length) {
      dozers = game.ents.filter(e => !e.dead && e.owner === 0 && e.kind === 'unit' && e.def.builder);
    }
    if (dozers.length) {
      let best = null, bd = Infinity;
      for (const d of dozers) {
        // prefer dozers that aren't already building (they finish their queue first otherwise)
        const busyPenalty = (d.order.type === 'build' || d.orderQueue.length) ? 1e9 : 0;
        const dd = U.dist2(d.x, d.y, b.x, b.y) + busyPenalty;
        if (dd < bd) { bd = dd; best = d; }
      }
      best.giveOrder({ type: 'build', targetId: b.id }, shift || best.order.type === 'build');
    }
    SFX.build();
    if (!shift) { placing = null; UI.refreshCmd(); }
  }

  function beginTargeting(t) { targeting = t; placing = null; }

  function fireTargeted() {
    const wx = RENDER.toWorldX(mouse.x), wy = RENDER.toWorldY(mouse.y);
    const t = targeting;
    targeting = null;
    if (!t) return;
    if (t.kind === 'power') {
      POWERS_SYS.activate(0, t.key, wx, wy);
    } else if (t.kind === 'sw') {
      const silo = game.byId.get(t.siloId);
      if (silo && !silo.dead && silo.swReady) POWERS_SYS.fireSuperweapon(0, silo, wx, wy);
    }
    UI.refreshPowers();
  }

  /* cursor mode for renderer */
  /* ---------------- idle workers ---------------- */
  function idleWorkers() {
    return game.ents.filter(e => !e.dead && e.kind === 'unit' && e.owner === 0 && e.def.builder &&
      (e.order.type === 'idle' || e.order.type === 'guard') && !e.orderQueue.length);
  }
  let idleCursor = 0;
  function cycleIdleWorker() {
    const list = idleWorkers();
    if (!list.length) { UI.feed('No idle workers'); return; }
    idleCursor = (idleCursor + 1) % list.length;
    const w = list[idleCursor];
    selection = [w];
    UI.refreshSel(); UI.refreshCmd();
    centerOn(w);
    SFX.click();
  }

  function cursorMode() {
    if (targeting || awaitAttackMove || awaitGuard) return 'target';
    if (placing) return 'default';
    if (!game.started || mouse.x < 0) return 'default';
    const wx = mouse.wx, wy = mouse.wy;
    const hover = entAt(wx, wy);
    const units = myUnitsSelected();
    if (hover && isEnemyOfHuman(hover) && units.some(u => u.def.weapon || u.def.suicide)) return 'attack';
    if (hover && hover.owner === 0 && hover.kind === 'building' && hover.hp < hover.maxHp &&
        units.some(u => u.def.builder)) return 'repair';
    if (world.dockAt(wx, wy) && units.some(u => u.def.harvester)) return 'harvest';
    return 'default';
  }

  function resetMatch() {
    selection = [];
    dragBox = null; placing = null; targeting = null; awaitAttackMove = false; awaitGuard = false;
    for (const k in groups) delete groups[k];   // groups hold refs to the previous game's entities
    lastClickT = 0; lastClickId = 0;
    mouse.down = false; mouse.mmb = false;
  }

  return {
    init, updateCamera, prune, centerOn, centerOnBase, resetMatch,
    beginPlace, beginTargeting, stopSelected, issueAttackMove,
    idleWorkers, cycleIdleWorker,
    get keys() { return keys; },
    get mouse() { return mouse; },
    get selection() { return selection; },
    set selection(s) { selection = s; },
    get dragBox() { return dragBox; },
    get placing() { return placing; },
    set placing(v) { placing = v; },
    get targeting() { return targeting; },
    set targeting(v) { targeting = v; },
    get cursorMode() { return cursorMode(); },
    set awaitAttackMove(v) { awaitAttackMove = v; },
    get awaitAttackMove() { return awaitAttackMove; },
    set awaitGuard(v) { awaitGuard = v; },
    get awaitGuard() { return awaitGuard; },
    isEnemyOfHuman,
  };
})();
