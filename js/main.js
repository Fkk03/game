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
  mode: 'domination',
  zones: [],              // control points {kind:'dom'|'econ', x, y, r, owner(team|-1), capT, capTeam, contested, present}
  domScore: { 0: 0, 1: 0 },
  econTeam: -1,
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
    stats: { unitsBuilt: 0, unitsLost: 0, kills: 0, buildingsLost: 0, moneyEarned: 0, moneySpent: 0 },
    statHist: [],          // {t, earned, spent} samples for rate displays
    addMoney(amt, isIncome) {
      let f = 1;
      if (isIncome) {
        f = this.incomeMult;
        if (game.econTeam === this.team) f *= ECON_BONUS;   // trade point held by my team
      }
      this.money += amt * f;
      if (isIncome) this.stats.moneyEarned += amt * f;
    },
    spend(amt) {
      this.money -= amt;
      this.stats.moneySpent += amt;
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
  game.mode = cfg.mode || 'domination';
  game.zones = [];
  game.domScore = { 0: 0, 1: 0 };
  game.econTeam = -1;
  FX.clear();
  INPUT.resetMatch();
  UI.resetMatch();

  // roster: you + up to 5 allies (team 0) vs up to 8 enemies (team 1) — 14 players max
  const diff = DIFFICULTY[cfg.diff];
  const nAllies = U.clamp(cfg.allies || 0, 0, 5);
  const nEnemies = U.clamp(cfg.enemies || 1, 1, 8);
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
  const sizeOrder = ['small', 'medium', 'large', 'huge', 'colossal'];
  let mapKey = cfg.map;
  const minIdx = total >= 10 ? 4 : total >= 7 ? 3 : total >= 5 ? 2 : total >= 4 ? 1 : 0;
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

  // control points (domination mode): dom at map center, trade point off-axis but fair
  if (game.mode === 'domination') {
    const zx = world.pw / 2, zy = world.ph / 2;
    const ex = world.pw * 0.32, ey = world.ph * 0.32;
    game.zones = [
      { kind: 'dom', x: zx, y: zy, r: DOM_ZONE_R, owner: -1, capT: 0, capTeam: -1, contested: false, present: [] },
      { kind: 'econ', x: ex, y: ey, r: ECON_ZONE_R, owner: -1, capT: 0, capTeam: -1, contested: false, present: [] },
    ];
    for (const z of game.zones) {
      world.clearArea(Math.floor(z.x / TILE), Math.floor(z.y / TILE), Math.ceil(z.r / TILE) + 2);
      world.ensureReachable(
        { tx: world.starts[0].tx, ty: world.starts[0].ty },
        { tx: Math.floor(z.x / TILE), ty: Math.floor(z.y / TILE) });
    }
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

/* ---------------- control point logic (1 Hz) ---------------- */
function updateZones() {
  for (const z of game.zones) {
    const present = new Set();
    for (const e of game.ents) {
      if (e.dead || e.kind !== 'unit' || e.owner < 0) continue;
      if (!e.def.weapon && !e.def.suicide) continue;    // only combat units hold ground
      if (e.def.air) continue;
      if (U.dist2(e.x, e.y, z.x, z.y) > z.r * z.r) continue;
      const p = game.players[e.owner];
      if (p && !p.defeated) present.add(p.team);
    }
    z.present = [...present];
    z.contested = present.size > 1;

    if (present.size === 1) {
      const t = z.present[0];
      if (z.owner === t) { z.capT = 0; z.capTeam = -1; }
      else {
        if (z.capTeam !== t) { z.capTeam = t; z.capT = 0; }
        z.capT += 1;
        if (z.capT >= DOM_CAPTURE_TIME) {
          z.owner = t; z.capT = 0; z.capTeam = -1;
          if (z.kind === 'econ') game.econTeam = t;
          const mine = t === game.players[0].team;
          const nm = z.kind === 'dom' ? 'Domination Point' : 'Trade Point';
          UI.feed(mine ? `⚑ Your team captured the ${nm}!` : `⚠ Enemy team captured the ${nm}!`, mine ? 'gold' : 'bad');
          UI.ping(z.x, z.y, mine ? '#9fdc7c' : '#ff5540');
          if (mine) { SFX.ready(); SFX.say(nm + ' captured'); }
          else { SFX.alarm(); SFX.say('We lost the ' + nm, true); }
        }
      }
    } else {
      z.capTeam = -1;
      z.capT = Math.max(0, z.capT - 1);
    }
  }
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
  let lost = game.players[0].defeated;
  let won = !lost && game.players.every(p => p.team === humanTeam || p.defeated);
  // domination victory
  if (game.mode === 'domination' && !lost && !won) {
    if ((game.domScore[humanTeam] || 0) >= DOM_WIN) won = true;
    else if ((game.domScore[humanTeam === 0 ? 1 : 0] || 0) >= DOM_WIN) lost = true;
  }
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

  // control points at 1 Hz
  if (game.frame % 30 === 15 && game.zones.length) updateZones();

  // domination scoring (per sim step so it's smooth)
  if (game.mode === 'domination' && !game.over) {
    const z = game.zones[0];
    if (z && z.owner >= 0 && !z.contested) {
      game.domScore[z.owner] = (game.domScore[z.owner] || 0) + DOM_RATE * dt;
      const sc = game.domScore[z.owner];
      const enemyOfHuman = z.owner !== game.players[0].team;
      for (const th of [500, 800, 950]) {
        if (sc >= th && (z.warned || 0) < th) {
          z.warned = th;
          UI.feed(enemyOfHuman ? `⚠ Enemy team at ${th} domination points!` : `Your team reached ${th} domination points`, enemyOfHuman ? 'bad' : 'gold');
          if (enemyOfHuman && th >= 800) { SFX.klaxon(); SFX.say('Warning. Enemy approaching domination victory', true); }
        }
      }
    }
  }

  // sample earn/spend history every 5 s for the rate displays
  if (game.frame % 150 === 0) {
    for (const p of game.players) {
      p.statHist.push({ t: game.t, earned: p.stats.moneyEarned, spent: p.stats.moneySpent });
      if (p.statHist.length > 60) p.statHist.shift();
    }
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
  // scoreboard refresh at 1 Hz
  if (game.frame % 30 === 12 && !game.paused) UI.refreshScoreboard();
}

/* ---------------- boot ---------------- */
window.addEventListener('DOMContentLoaded', () => {
  RENDER.init(document.getElementById('game'));
  INPUT.init(document.getElementById('game'));
  UI.init();
  document.getElementById('loading').classList.add('hidden');
  requestAnimationFrame(loop);
});
