/* ============ main.js — game state, main loop, victory ============ */
'use strict';

let game = {
  started: false, paused: false, over: false,
  t: 0, renderT: 0, frame: 0,
  ents: [], byId: new Map(),
  projs: [], nukes: [], beamStrikes: [],
  players: [],
  cam: { x: 0, y: 0, zoom: 1 },
  shake: 0,
  revealAll: false,
};
let world = null;

function makePlayer(idx, faction, isAI) {
  return {
    idx, faction, isAI,
    color: FACTIONS[faction].color,
    colorDark: FACTIONS[faction].colorDark,
    money: 0,
    powerCap: 0, powerUse: 0, lowPower: false,
    xp: 0, rank: 0, powerPoints: 0,
    unlocked: {}, cooldowns: {},
    incomeMult: 1,
    stats: { unitsBuilt: 0, unitsLost: 0, kills: 0, buildingsLost: 0, moneyEarned: 0 },
    addMoney(amt, isIncome) {
      this.money += amt * (isIncome ? this.incomeMult : 1);
    },
  };
}

game.addEnt = function (e) {
  game.ents.push(e);
  game.byId.set(e.id, e);
};

function startGame(cfg) {
  // reset state
  game.started = true; game.paused = false; game.over = false;
  game.t = 0; game.renderT = 0; game.frame = 0;
  game.ents = []; game.byId = new Map();
  game.projs = []; game.nukes = []; game.beamStrikes = [];
  game.shake = 0;
  game.revealAll = false;
  FX.clear();
  INPUT.resetMatch();
  UI.resetMatch();

  const ms = MAPSIZES[cfg.map];
  world = new World(ms.w, ms.h, (Math.random() * 1e9) | 0);

  const enemyFaction = cfg.enemy === 'random' ? U.pick(Object.keys(FACTIONS)) : cfg.enemy;
  const diff = DIFFICULTY[cfg.diff];
  game.players = [
    makePlayer(0, cfg.faction, false),
    makePlayer(1, enemyFaction, true),
  ];
  game.players[0].money = cfg.money;
  game.players[1].money = cfg.money + diff.startBonus;
  game.players[1].incomeMult = diff.income;

  // starting base: CC + dozer for each side
  for (let pi = 0; pi < 2; pi++) {
    const s = world.starts[pi];
    const tx = Math.floor(s.x / TILE) - 2, ty = Math.floor(s.y / TILE) - 2;
    const cc = new Building(pi, 'cc', tx, ty, true);
    game.addEnt(cc);
    const spot = findSpawnSpot(cc);
    const dozer = new Unit(pi, 'dozer', spot.x, spot.y);
    game.addEnt(dozer);
    recomputePower(pi);
  }

  AI.initGame(cfg.diff);
  RENDER.buildTerrain();
  world.recomputeFog();
  RENDER.refreshFogCanvas();

  // camera on own base
  game.cam.zoom = 1;
  INPUT.centerOnBase();

  UI.showGameHud();
  UI.feed('Welcome, General. Build your base — your Dozer awaits orders.');
  UI.announce(FACTIONS[cfg.faction].name.toUpperCase());
  SFX.say('Battle control online');
}

/* ---------------- victory check ---------------- */
function checkVictory() {
  if (game.over) return;
  for (let pi = 0; pi < 2; pi++) {
    const hasBuilding = game.ents.some(e => !e.dead && e.owner === pi && e.kind === 'building');
    const p = game.players[pi];
    // grace only if a builder survives AND the money can actually restart an economy
    const cheapestRestart = Math.min(BUILDINGS.market.cost, BUILDINGS.supply.cost + UNITS.truck.cost);
    const hasDozerMoney = p.money >= cheapestRestart &&
      game.ents.some(e => !e.dead && e.owner === pi && e.kind === 'unit' && e.def.builder);
    if (!hasBuilding && !hasDozerMoney) {
      game.over = true;
      const win = pi === 1;
      game.revealAll = true;
      setTimeout(() => {
        UI.showEnd(win);
        if (win) { SFX.promote(); SFX.say('Victory. The battlefield is yours, General', true); }
        else { SFX.error(); SFX.say('Mission failed', true); }
      }, 1400);
      return;
    }
  }
}

/* ---------------- fixed-step simulation ---------------- */
function simStep(dt) {
  game.t += dt;
  game.frame++;

  for (const e of game.ents) {
    if (!e.dead) e.update(dt);
  }
  updateProjectiles(dt);
  separateUnits();
  POWERS_SYS.updateNukes(dt);
  POWERS_SYS.updateCooldowns(dt);

  // AI tick at 2 Hz
  if (game.frame % 15 === 0) AI.tick(0.5);

  // fog recompute at ~5 Hz
  if (game.frame % 6 === 0) {
    world.recomputeFog();
    RENDER.refreshFogCanvas();
  }

  // prune dead entities
  if (game.frame % 30 === 0) {
    for (let i = game.ents.length - 1; i >= 0; i--) {
      const e = game.ents[i];
      if (e.dead) {
        game.byId.delete(e.id);
        game.ents.splice(i, 1);
      }
    }
    checkVictory();
  }

  if (game.shake > 0) game.shake = Math.max(0, game.shake - dt * 22);
}

/* ---------------- main loop ---------------- */
let lastTime = 0, acc = 0, rafFrame = 0;
function loop(ts) {
  requestAnimationFrame(loop);
  const rdt = Math.min(0.1, (ts - lastTime) / 1000 || 0.016);
  lastTime = ts;
  rafFrame++;

  if (!game.started) return;

  game.renderT += rdt;
  INPUT.updateCamera(rdt);

  if (game.paused && game.shake > 0) game.shake = Math.max(0, game.shake - rdt * 22);

  if (!game.paused) {
    acc += rdt;
    let steps = 0;
    while (acc >= DT && steps < 4) {
      simStep(DT);
      acc -= DT; steps++;
    }
    if (steps === 4) acc = 0;   // avoid spiral of death
    FX.update(rdt);
    UI.update(rdt);
    INPUT.prune();
  }

  RENDER.frame();

  // HUD refresh at ~5 Hz (rAF-based while paused, since sim frames freeze)
  if ((!game.paused && game.frame % 6 === 0) || (game.paused && rafFrame % 30 === 0)) {
    UI.refreshTop();
    UI.drawMinimap();
    UI.refreshCmdProgress();
  }
  // selection panel refresh at 2 Hz (hp bars change)
  if (game.frame % 15 === 3 && !game.paused) UI.refreshSel();
  // powers row cooldown refresh at 1 Hz
  if (game.frame % 30 === 7 && !game.paused) UI.refreshPowers();
}

/* ---------------- boot ---------------- */
window.addEventListener('DOMContentLoaded', () => {
  RENDER.init(document.getElementById('game'));
  INPUT.init(document.getElementById('game'));
  UI.init();
  document.getElementById('loading').classList.add('hidden');
  requestAnimationFrame(loop);
});
