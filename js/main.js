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

function makePlayer(idx, faction, isAI, team) {
  return {
    idx, faction, isAI, team,
    color: PLAYER_COLORS[idx % PLAYER_COLORS.length],
    colorDark: U.shade(PLAYER_COLORS[idx % PLAYER_COLORS.length], 0.5),
    money: 0,
    powerCap: 0, powerUse: 0, lowPower: false,
    xp: 0, rank: 0, powerPoints: 0,
    unlocked: {}, cooldowns: {},
    incomeMult: 1,
    frenzyUntil: 0,
    defeated: false,
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

  // roster: you + allies (team 0) vs enemies (team 1), max 8 players
  const diff = DIFFICULTY[cfg.diff];
  const nAllies = U.clamp(cfg.allies || 0, 0, 3);
  const nEnemies = U.clamp(Math.min(cfg.enemies || 1, 7 - nAllies), 1, 7);
  const facs = Object.keys(FACTIONS);
  game.players = [makePlayer(0, cfg.faction, false, 0)];
  for (let i = 0; i < nAllies; i++) game.players.push(makePlayer(game.players.length, U.pick(facs), true, 0));
  for (let i = 0; i < nEnemies; i++) {
    const f = cfg.enemy === 'random' ? U.pick(facs) : cfg.enemy;
    game.players.push(makePlayer(game.players.length, f, true, 1));
  }
  for (const p of game.players) {
    p.money = cfg.money + (p.isAI ? diff.startBonus : 0);
    if (p.isAI) p.incomeMult = diff.income;
  }

  // map auto-grows with player count so everyone fits
  const total = game.players.length;
  const sizeOrder = ['small', 'medium', 'large', 'huge'];
  let mapKey = cfg.map;
  const minIdx = total >= 7 ? 3 : total >= 5 ? 2 : total >= 4 ? 1 : 0;
  if (sizeOrder.indexOf(mapKey) < minIdx) mapKey = sizeOrder[minIdx];
  const ms = MAPSIZES[mapKey];
  world = new World(ms.w, ms.h, (Math.random() * 1e9) | 0, game.players.map(p => p.team));

  // starting base: CC + dozer for every player
  for (let pi = 0; pi < total; pi++) {
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

/* ---------------- victory check (team-based) ---------------- */
function checkVictory() {
  if (game.over) return;
  const cheapestRestart = Math.min(BUILDINGS.market.cost, BUILDINGS.supply.cost + UNITS.truck.cost);

  for (const p of game.players) {
    if (p.defeated) continue;
    const pi = p.idx;
    const hasBuilding = game.ents.some(e => !e.dead && e.owner === pi && e.kind === 'building');
    // grace only if a builder survives AND the money can actually restart an economy
    const hasDozerMoney = p.money >= cheapestRestart &&
      game.ents.some(e => !e.dead && e.owner === pi && e.kind === 'unit' && e.def.builder);
    if (!hasBuilding && !hasDozerMoney) {
      p.defeated = true;
      if (pi !== 0) {
        const hostile = p.team !== game.players[0].team;
        UI.feed((hostile ? '💀 Enemy' : '🏳 Allied') + ' general (' + FACTIONS[p.faction].name + ') eliminated!',
          hostile ? 'gold' : 'bad');
        if (hostile) SFX.say('Enemy general eliminated');
      }
    }
  }

  const humanTeam = game.players[0].team;
  const lost = game.players[0].defeated;
  const won = !lost && game.players.every(p => p.team === humanTeam || p.defeated);
  if (lost || won) {
    game.over = true;
    game.revealAll = true;
    setTimeout(() => {
      UI.showEnd(won);
      if (won) { SFX.promote(); SFX.say('Victory. The battlefield is yours, General', true); }
      else { SFX.error(); SFX.say('Mission failed', true); }
    }, 1400);
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
