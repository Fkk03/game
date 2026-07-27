/* ============ ai.js — skirmish AI (one instance per AI player) ============ */
'use strict';
const AI = (() => {
  let ais = [];

  const COMPS = {
    coalition: { ranger: 3, rocketeer: 2, bulwark: 5, viper: 2, thunder: 2, falcon: 2 },
    dynasty:   { rifleman: 5, rpg: 3, warlord: 3, flak: 2, salamander: 2, vulture: 2 },
    cartel:    { raider: 5, rocketraider: 3, jackal: 5, guntruck: 2, barrage: 2, demorig: 2 },
  };

  /* ---------------- one AI player brain ---------------- */
  function makeAI(pi, diffKey) {
    const diff = DIFFICULTY[diffKey];
    const S = {
      tickT: 0,
      waveT: diff.firstAttack + U.rand(-20, 40),
      attackState: 'idle',      // idle | gathering | attacking
      gatherT: 0,
      attackTargetId: 0,
      harassT: diff.harass ? 170 + U.rand(0, 60) : Infinity,
      defendT: 0,
      powerUseT: 20 + U.rand(0, 10),
      waveSize: 6,
      armyValueStart: 0,
    };

    const p = () => game.players[pi];
    const myTeam = () => p().team;

    function myEnts() { return game.ents.filter(e => !e.dead && e.owner === pi); }
    function myBuildings(key) {
      return game.ents.filter(e => !e.dead && e.owner === pi && e.kind === 'building' && (!key || e.key === key));
    }
    function myUnits(key) {
      return game.ents.filter(e => !e.dead && e.owner === pi && e.kind === 'unit' && (!key || e.key === key));
    }
    function combatUnits() {
      return myUnits().filter(u => u.def.weapon || u.def.suicide);
    }
    function isEnemyEnt(e) {
      if (e.owner < 0) return false;
      const pe = game.players[e.owner];
      return pe && pe.team !== myTeam();
    }
    function baseAnchor() {
      const cc = myBuildings('cc')[0];
      if (cc) return cc;
      const any = myBuildings()[0];
      if (any) return any;
      return myUnits('dozer')[0] || null;
    }

    /* densest cluster of enemy army (for strikes) */
    function enemyCluster() {
      let best = null, bestVal = 0;
      const cell = 220, m = new Map();
      for (const e of game.ents) {
        if (e.dead || e.kind !== 'unit' || !e.def.weapon || !isEnemyEnt(e)) continue;
        const k = Math.floor(e.x / cell) + ',' + Math.floor(e.y / cell);
        const b = m.get(k) || { x: 0, y: 0, n: 0, val: 0 };
        b.x += e.x; b.y += e.y; b.n++; b.val += e.def.cost;
        m.set(k, b);
      }
      for (const [, b] of m) {
        if (b.val > bestVal) { bestVal = b.val; best = { x: b.x / b.n, y: b.y / b.n, val: b.val }; }
      }
      return best;
    }

    function enemyKeyBuilding() {
      const anchor = baseAnchor();
      const ax = anchor ? anchor.x : world.pw / 2, ay = anchor ? anchor.y : world.ph / 2;
      const order = ['superweapon', 'factory', 'airfield', 'barracks', 'cc', 'supply', 'power', 'market', 'repairbay', 'turret'];
      for (const key of order) {
        let best = null, bd = Infinity;
        for (const e of game.ents) {
          if (e.dead || e.kind !== 'building' || e.key !== key || !e.constructed || !isEnemyEnt(e)) continue;
          const d = U.dist2(ax, ay, e.x, e.y);
          if (d < bd) { bd = d; best = e; }
        }
        if (best) return best;
      }
      return game.ents.find(e => !e.dead && e.kind === 'building' && isEnemyEnt(e)) || null;
    }

    function nearestEnemyEntTo(x, y) {
      let best = null, bd = Infinity;
      for (const e of game.ents) {
        if (e.dead || !isEnemyEnt(e)) continue;
        if (e.kind === 'unit' && e.def.air) continue;   // most weapons can't reach air
        const d = U.dist2(x, y, e.x, e.y);
        if (d < bd) { bd = d; best = e; }
      }
      return best;
    }

    /* attackmove toward a target; direct attack when auto-acquire can't see it
       (unconstructed sites) or the target is a lone unit like a dozer */
    function orderAssault(u, target) {
      if ((target.kind === 'building' && !target.constructed) || target.kind === 'unit') {
        if (u.def.suicide || (u.def.weapon && weaponCanHit(u.def.weapon, target))) {
          u.giveOrder({ type: 'attack', targetId: target.id });
          return;
        }
      }
      u.giveOrder({ type: 'attackmove', x: target.x + U.rand(-60, 60), y: target.y + U.rand(-60, 60) });
    }

    /* ------------- construction ------------- */
    function wantedStructure() {
      const fac = p().faction, F = FACTIONS[fac];
      const has = k => myBuildings(k).length;
      const money = p().money;

      if (F.usesPower && p().powerUse + 4 > p().powerCap && money >= BUILDINGS.power.cost) return 'power';
      if (!has('supply') && money >= BUILDINGS.supply.cost) return 'supply';
      if (!has('barracks') && money >= BUILDINGS.barracks.cost) return 'barracks';
      if (!has('factory') && money >= BUILDINGS.factory.cost + 300) return 'factory';
      if (has('turret') < 2 && money >= BUILDINGS.turret.cost + 600 && game.t > 150) return 'turret';
      if (has('market') < BUILDINGS.market.limit && money >= BUILDINGS.market.cost + 800) return 'market';
      if (F.buildings.includes('airfield') && !has('airfield') && money >= BUILDINGS.airfield.cost + 800 && game.t > 240) return 'airfield';
      if (!has('repairbay') && money >= BUILDINGS.repairbay.cost + 1200 && game.t > 330) return 'repairbay';
      if (has('supply') < 2 && game.t > 330 && money >= BUILDINGS.supply.cost + 500) return 'supply';
      if (diff.superweapon && !has('superweapon') && game.t > 480 && money >= BUILDINGS.superweapon.cost + 1000) return 'superweapon';
      if (diffKey === 'hard' && has('factory') < 2 && game.t > 420 && money >= BUILDINGS.factory.cost + 1500) return 'factory';
      if (has('turret') < 4 && money >= BUILDINGS.turret.cost + 2500 && game.t > 400) return 'turret';
      if (!has('cc') && money >= BUILDINGS.cc.cost) return 'cc';
      return null;
    }

    function findPlacement(key) {
      const anchor = baseAnchor();
      if (!anchor) return null;
      const def = BUILDINGS[key];
      const ax = Math.floor(anchor.x / TILE), ay = Math.floor(anchor.y / TILE);
      let bx = ax, by = ay;
      if (key === 'turret') {
        const t = enemyKeyBuilding();
        const dir = t ? Math.atan2(t.y - anchor.y, t.x - anchor.x) : Math.atan2(world.ph / 2 - anchor.y, world.pw / 2 - anchor.x);
        bx = ax + Math.round(Math.cos(dir) * 8); by = ay + Math.round(Math.sin(dir) * 8);
      } else if (key === 'supply') {
        const dock = nearestDockWithSupplies(anchor.x, anchor.y);
        if (dock) { bx = Math.floor(dock.x / TILE) - 4; by = Math.floor(dock.y / TILE) - 4; }
      }
      for (let r = 1; r <= 16; r++) {
        for (let attempt = 0; attempt < 14; attempt++) {
          const a = U.rand(0, Math.PI * 2);
          const tx = Math.round(bx + Math.cos(a) * r) - Math.floor(def.size / 2);
          const ty = Math.round(by + Math.sin(a) * r) - Math.floor(def.size / 2);
          if (world.canPlace(tx, ty, def.size, pi)) return { tx, ty };
        }
      }
      return null;
    }

    function manageDozers() {
      const dozers = myUnits('dozer');
      const cc = myBuildings('cc')[0];
      if (dozers.length < 2 && cc && cc.constructed && p().money > UNITS.dozer.cost + 400) {
        const queued = cc.queue.filter(q => q.key === 'dozer').length;
        if (dozers.length + queued < 2) cc.enqueue('dozer');
      }
      const sites = myBuildings().filter(b => !b.constructed);
      const busy = new Set();
      for (const d of dozers) {
        if (d.order.type === 'build') busy.add(d.order.targetId);
      }
      for (const site of sites) {
        if (busy.has(site.id)) continue;
        const idle = dozers.find(d => d.order.type !== 'build' && d.order.type !== 'repair');
        if (idle) { idle.giveOrder({ type: 'build', targetId: site.id }); busy.add(site.id); }
      }
      const hurt = myBuildings().find(b => b.constructed && b.hp < b.maxHp * 0.65);
      if (hurt) {
        const idle = dozers.find(d => d.order.type === 'idle' || d.order.type === 'guard');
        if (idle) idle.giveOrder({ type: 'repair', targetId: hurt.id });
      }
      const want = wantedStructure();
      if (want && sites.length < 2 && dozers.length) {
        const spot = findPlacement(want);
        if (spot && p().money >= BUILDINGS[want].cost) {
          p().money -= BUILDINGS[want].cost;
          const b = new Building(pi, want, spot.tx, spot.ty, false);
          game.addEnt(b);
        }
      }
    }

    /* ------------- economy ------------- */
    function manageEconomy() {
      for (const sc of myBuildings('supply')) {
        if (!sc.constructed) continue;
        const trucks = myUnits('truck');
        const queued = sc.queue.filter(q => q.key === 'truck').length;
        const wanted = Math.min(4, 2 * myBuildings('supply').filter(b => b.constructed).length);
        if (trucks.length + queued < wanted && p().money > UNITS.truck.cost + 300) {
          sc.enqueue('truck');
        }
      }
    }

    /* ------------- army production ------------- */
    function manageArmy() {
      const fac = p().faction;
      const comp = COMPS[fac];
      const army = combatUnits();
      if (army.length >= diff.armyCap) return;
      const counts = {};
      for (const u of army) counts[u.key] = (counts[u.key] || 0) + 1;
      for (const b of myBuildings()) {
        if (!b.constructed || b.queue.length >= 2) continue;
        const trainable = bTrains(b.key, fac).filter(k => comp[k]);
        if (!trainable.length) continue;
        let pick = null, worst = 1e9;
        for (const k of trainable) {
          if (b.key === 'airfield') {
            const jets = myUnits(k).length + b.queue.filter(q => q.key === k).length;
            if (jets >= (b.def.pads || 2)) continue;
          }
          const ratio = (counts[k] || 0) / comp[k];
          if (ratio < worst) { worst = ratio; pick = k; }
        }
        if (pick && p().money > UNITS[pick].cost + (game.t < 300 ? 600 : 250)) {
          b.enqueue(pick);
        }
      }
    }

    /* ------------- attacks ------------- */
    function gatherPoint() {
      const anchor = baseAnchor();
      if (!anchor) return { x: world.pw / 2, y: world.ph / 2 };
      const t = enemyKeyBuilding();
      const dir = t ? Math.atan2(t.y - anchor.y, t.x - anchor.x) : 0;
      return { x: anchor.x + Math.cos(dir) * 260, y: anchor.y + Math.sin(dir) * 260 };
    }

    function manageAttack(dt2) {
      const army = combatUnits().filter(u => !u.def.air);
      const jets = combatUnits().filter(u => u.def.air);

      switch (S.attackState) {
        case 'idle': {
          S.waveT -= dt2;
          if (S.waveT <= 0 && army.length >= Math.min(S.waveSize, diff.armyCap * 0.5)) {
            S.attackState = 'gathering';
            S.gatherT = 22;
            const g = gatherPoint();
            for (const u of army) u.giveOrder({ type: 'attackmove', x: g.x + U.rand(-70, 70), y: g.y + U.rand(-70, 70) });
          }
          break;
        }
        case 'gathering': {
          S.gatherT -= dt2;
          if (S.gatherT <= 0) {
            const anchor = baseAnchor();
            const target = enemyKeyBuilding() ||
              (anchor ? nearestEnemyEntTo(anchor.x, anchor.y) : null);
            if (!target) { S.attackState = 'idle'; S.waveT = diff.waveEvery; break; }
            S.attackState = 'attacking';
            S.attackTargetId = target.id;
            S.armyValueStart = army.reduce((s, u) => s + u.def.cost, 0);
            for (const u of army) orderAssault(u, target);
            const cl = enemyCluster();
            for (const j of jets) {
              const jt = cl ? nearestEnemyEntTo(cl.x, cl.y) : target;
              if (jt) j.giveOrder({ type: 'attack', targetId: jt.id });
            }
          }
          break;
        }
        case 'attacking': {
          const target = game.byId.get(S.attackTargetId);
          const val = army.reduce((s, u) => s + u.def.cost, 0);
          for (const j of jets) {
            if (j.jetState === 'idle' && j.ammo > 0) {
              const jt = target && !target.dead ? target : enemyKeyBuilding();
              if (jt) j.giveOrder({ type: 'attack', targetId: jt.id });
            }
          }
          if (!target || target.dead) {
            const anchor = baseAnchor();
            const next = enemyKeyBuilding() ||
              (anchor ? nearestEnemyEntTo(anchor.x, anchor.y) : null);
            if (next) {
              S.attackTargetId = next.id;
              for (const u of army) {
                if (u.order.type === 'idle' || u.order.type === 'guard') orderAssault(u, next);
              }
            } else { S.attackState = 'idle'; S.waveT = diff.waveEvery; }
          } else if (target.kind === 'building' && !target.constructed) {
            for (const u of army) {
              if (u.order.type === 'idle' || u.order.type === 'guard')
                u.giveOrder({ type: 'attack', targetId: target.id });
            }
          } else if (S.armyValueStart && val < S.armyValueStart * 0.25) {
            const anchor = baseAnchor();
            if (anchor) for (const u of army) u.giveOrder({ type: 'move', x: anchor.x + U.rand(-90, 90), y: anchor.y + U.rand(-90, 90) });
            S.attackState = 'idle';
            S.waveT = diff.waveEvery;
            S.waveSize = Math.min(diff.armyCap, S.waveSize + 3);
          }
          break;
        }
      }

      // early harass: fast units hit the enemy economy
      S.harassT -= dt2;
      if (S.harassT <= 0) {
        S.harassT = 240;
        const fastKeys = { coalition: 'viper', dynasty: 'flak', cartel: 'guntruck' };
        const raiders = myUnits(fastKeys[p().faction]).slice(0, 2);
        const truck = game.ents.find(e => !e.dead && e.kind === 'unit' && e.def.harvester && isEnemyEnt(e));
        if (raiders.length && truck) {
          for (const r of raiders) r.giveOrder({ type: 'attack', targetId: truck.id });
        }
      }
    }

    /* ------------- powers & superweapon ------------- */
    function spend() {
      const me = p();
      const keys = FACTIONS[me.faction].powers;
      const maxTier = diff.powers;
      for (const k of keys) {
        if (POWERS[k].tier <= maxTier && POWERS_SYS.canUnlock(me, k)) {
          POWERS_SYS.unlock(pi, k);
          return;
        }
      }
    }

    function usePowers() {
      const me = p();
      for (const k of FACTIONS[me.faction].powers) {
        if (!POWERS_SYS.isReady(me, k)) continue;
        let x = null, y = null;
        const anchor = baseAnchor();
        if (k === 'recon') continue;                     // AI has map knowledge
        if (k === 'supplydrop') {
          if (anchor) { x = anchor.x; y = anchor.y; }
        } else if (k === 'frenzy') {
          if (S.attackState !== 'attacking' || !anchor) continue;
          x = anchor.x; y = anchor.y;
        } else if (k === 'reinforce' || k === 'paradrop') {
          const g = gatherPoint(); x = g.x; y = g.y;
        } else if (k === 'ambush') {
          const t = game.ents.find(e => !e.dead && e.kind === 'unit' && e.def.harvester && isEnemyEnt(e)) || enemyKeyBuilding();
          if (t) { x = t.x; y = t.y; }
        } else if (k === 'sabotage') {
          const t = enemyKeyBuilding();
          if (t) { x = t.x; y = t.y; }
        } else {
          const cl = enemyCluster();
          if (cl && cl.val > 1500) { x = cl.x; y = cl.y; }
          else {
            const t = enemyKeyBuilding();
            if (t) { x = t.x; y = t.y; }
          }
        }
        if (x !== null) { POWERS_SYS.activate(pi, k, x, y); return; }
      }
    }

    function useSuperweapon() {
      const silo = myBuildings('superweapon').find(b => b.constructed && b.swReady);
      if (!silo) return;
      const t = enemyKeyBuilding();
      if (t) POWERS_SYS.fireSuperweapon(pi, silo, t.x, t.y);
    }

    /* ------------- defense reaction ------------- */
    function notifyAttack(victim, attacker) {
      if (S.defendT > 0 || !attacker || !isEnemyEnt(attacker)) return;
      if (victim.kind !== 'building') return;
      S.defendT = 18;
      const defenders = combatUnits().filter(u => !u.def.air &&
        (u.order.type === 'idle' || u.order.type === 'guard') &&
        U.dist(u.x, u.y, victim.x, victim.y) < 900);
      for (const d of defenders) d.giveOrder({ type: 'attackmove', x: attacker.x, y: attacker.y });
    }

    function tick(dt2) {
      if (game.over || p().defeated) return;
      if (S.defendT > 0) S.defendT -= dt2;
      if (!myEnts().length) return;
      manageDozers();
      manageEconomy();
      manageArmy();
      manageAttack(dt2);
      S.powerUseT -= dt2;
      if (S.powerUseT <= 0) { S.powerUseT = 12; usePowers(); useSuperweapon(); }
    }

    function onUnitDone(u) {
      if (u.def.weapon && !u.def.air && S.attackState === 'attacking') {
        const target = game.byId.get(S.attackTargetId);
        if (target && !target.dead) u.giveOrder({ type: 'attackmove', x: target.x, y: target.y });
      }
    }

    return { pi, tick, notifyAttack, spend, onUnitDone };
  }

  /* ---------------- module API (routes to instances) ---------------- */
  function initGame(diffKey) {
    ais = [];
    for (const p of game.players) {
      if (p.isAI) ais.push(makeAI(p.idx, diffKey));
    }
  }
  function tick(dt2) { for (const a of ais) a.tick(dt2); }
  function notifyAttack(victim, attacker) {
    const a = ais.find(x => x.pi === victim.owner);
    if (a) a.notifyAttack(victim, attacker);
  }
  function spendPowerPoints(pi) {
    const a = ais.find(x => x.pi === pi);
    if (a) a.spend();
  }
  function onUnitDone(u) {
    const a = ais.find(x => x.pi === u.owner);
    if (a) a.onUnitDone(u);
  }
  function onBuildingDone(b) { /* hook for future logic */ }

  return { initGame, tick, notifyAttack, spendPowerPoints, onUnitDone, onBuildingDone };
})();
