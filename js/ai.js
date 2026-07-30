/* ============ ai.js — skirmish AI (one instance per AI player) ============ */
'use strict';
const AI = (() => {
  let ais = [];

  /* ---- standings: total value per player (army + structures + cash), one ent pass, cached ---- */
  let standT = -99, standCache = null;
  function standings() {
    if (standCache && game.t - standT < 15) return standCache;
    standT = game.t;
    const v = game.players.map(pl => pl.defeated ? 0 : pl.money * 0.25);
    for (const e of game.ents) {
      if (e.dead || e.owner < 0 || !game.players[e.owner]) continue;
      v[e.owner] += e.kind === 'unit' ? e.def.cost : e.def.cost * 0.6;
    }
    standCache = v;
    return v;
  }

  const COMPS = {
    coalition: { ranger: 3, rocketeer: 2, commando: 1, bulwark: 5, viper: 2, aegis: 1, thunder: 2, falcon: 2, kestrel: 2, goliath: 2, siege: 1, seraph: 1, umbra: 1, spyplane: 1 },
    dynasty:   { rifleman: 5, rpg: 3, warlord: 3, flak: 2, aegis: 1, salamander: 2, vulture: 2, kestrel: 2, goliath: 2, siege: 1, behemoth: 1, spyplane: 1 },
    cartel:    { raider: 5, rocketraider: 3, jackal: 5, guntruck: 2, aegis: 1, barrage: 2, demorig: 2, goliath: 2, siege: 1 },
  };
  /* units that counter each enemy composition trend, per faction */
  const COUNTERS = {
    air:   { coalition: ['viper', 'rocketeer', 'kestrel', 'aegis'], dynasty: ['flak', 'rpg', 'kestrel', 'aegis'], cartel: ['guntruck', 'rocketraider', 'aegis'] },
    armor: { coalition: ['rocketeer', 'thunder', 'bulwark'], dynasty: ['rpg', 'warlord'], cartel: ['rocketraider', 'barrage', 'demorig'] },
    inf:   { coalition: ['viper', 'ranger'], dynasty: ['salamander', 'flak'], cartel: ['guntruck', 'raider'] },
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
      strategy: 'push',        // push | siege | air | raid
      stratFail: {},           // doctrine → recent failures, steers the next choice
      plan: null,              // {strategy, target, threat, approach}
      failedTargets: {},       // targetId → time a wave broke against it
      regroupUntil: 0,         // no fresh assault before this — rebuild first
      withdrawT: 0,
      reinforceReady: false,
      targetHpStart: 1,
      cashT: 600,              // war-chest drop every 10 minutes
    };

    const p = () => game.players[pi];
    const myTeam = () => p().team;

    /* posture: how do I stack up against the strongest general on the map?
       Falling behind → build harder, expand faster, attack more often. */
    function posture() {
      const v = standings();
      const mine = v[pi];
      let lead = 0;
      for (let i = 0; i < v.length; i++) if (i !== pi && v[i] > lead) lead = v[i];
      if (lead <= 0) return 'steady';
      const r = mine / lead;
      if (r < 0.5) return 'desperate';
      if (r < 0.8) return 'pushing';
      if (r > 1.25) return 'leading';
      return 'steady';
    }
    /* money buffers shrink as the AI falls behind — a trailing general spends everything */
    function buf(m) {
      const po = posture();
      return po === 'desperate' ? 0 : po === 'pushing' ? Math.round(m * 0.4) : m;
    }
    function waveEvery() {
      const po = posture();
      return diff.waveEvery * (po === 'desperate' ? 0.5 : po === 'pushing' ? 0.7 : po === 'leading' ? 0.85 : 1);
    }

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
      const order = ['superweapon', 'factory', 'airfield', 'barracks', 'cc', 'supply', 'power', 'market', 'repairbay', 'artdef', 'gatdef'];
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

    /* =================================================================
       THREAT MODEL — the AI reads the enemy's defenses before committing.
       Every defensive emplacement and every unit sitting on guard is
       catalogued with its reach and sustained damage, so the brain can ask
       "how much fire covers this spot?" instead of walking in blind.
       Rebuilt every 7 s and shared by every query in between.
    ================================================================= */
    const MOBILE_DEF_CAP = 40;
    let defT = -99, defCache = [];
    function enemyDefenses() {
      if (game.t - defT < 7) return defCache;
      defT = game.t;
      const hard = [], soft = [];
      for (const e of game.ents) {
        if (e.dead || !isEnemyEnt(e)) continue;
        let w = null, weight = 1;
        if (e.kind === 'building') {
          if (!e.constructed) continue;
          const pe = game.players[e.owner];
          w = e.def.weaponByFaction && pe ? e.def.weaponByFaction[pe.faction] : null;
        } else if (e.kind === 'unit' && e.def.weapon && !e.def.air) {
          const ot = e.order.type;
          // only troops actually holding ground count as fixed defense
          if (ot !== 'guard' && ot !== 'idle' && ot !== 'guardarea') continue;
          w = e.def.weapon;
          weight = 0.6;                       // mobile: may not be here when we arrive
        }
        if (!w) continue;
        const rec = { id: e.id, x: e.x, y: e.y, r: w.range, minR: w.minRange || 0,
          dps: w.dmg / Math.max(0.15, w.cd) * weight,
          aa: !!w.aa, ga: w.ga !== false, hard: e.kind === 'building' };
        (rec.hard ? hard : soft).push(rec);
      }
      // emplacements always count; mobile defenders are capped to the heaviest few so
      // the threat lookups stay cheap in a fourteen-army game
      if (soft.length > MOBILE_DEF_CAP) {
        soft.sort((a, b) => b.dps - a.dps);
        soft.length = MOBILE_DEF_CAP;
      }
      defCache = hard.concat(soft);
      return defCache;
    }

    /* how much enemy fire covers this spot? mode: 'ground' | 'air' */
    function threatAt(x, y, mode) {
      let t = 0;
      for (const d of enemyDefenses()) {
        if (mode === 'air' ? !d.aa : !d.ga) continue;
        const dist = U.dist(x, y, d.x, d.y);
        if (dist <= d.r && dist >= d.minR) t += d.dps;
      }
      return t;
    }

    /* the enemy's fortification mix: how much of their static firepower shoots up,
       how much shoots along the ground, and how many emplacements there are */
    function enemyDefenseMix() {
      let aa = 0, ga = 0, n = 0;
      for (const d of enemyDefenses()) {
        if (!d.hard) continue;
        n++;
        if (d.aa) aa += d.dps;
        if (d.ga) ga += d.dps;
      }
      return { aa, ga, n };
    }

    /* what KIND of defense guards this spot — picks the right counter-units */
    function defenseProfileAt(x, y) {
      let aa = 0, ground = 0, hard = 0;
      for (const d of enemyDefenses()) {
        if (U.dist(x, y, d.x, d.y) > d.r * 1.15) continue;
        if (d.aa) aa += d.dps;
        if (d.ga) ground += d.dps;
        if (d.hard) hard += d.dps;
      }
      return { aa, ground, hard };
    }

    /* every enemy structure scored: worth a lot, guarded lightly, close by = go there.
       This is the "find the weak point" pass. */
    const TARGET_VALUE = { superweapon: 3.2, cc: 2.4, factory: 2.0, nuclear: 1.9, airfield: 1.8,
      supply: 1.7, power: 1.5, barracks: 1.3, market: 1.0, repairbay: 0.9, artdef: 0.6, gatdef: 0.5 };
    let rankT = { ground: -99, air: -99 }, rankCache = { ground: [], air: [] };
    function rankedTargets(mode) {
      mode = mode || 'ground';
      if (game.t - rankT[mode] < 5) return rankCache[mode];
      rankT[mode] = game.t;
      const anchor = baseAnchor();
      const out = [];
      for (const e of game.ents) {
        if (e.dead || e.kind !== 'building' || !isEnemyEnt(e)) continue;
        const th = threatAt(e.x, e.y, mode);
        const dist = anchor ? U.dist(anchor.x, anchor.y, e.x, e.y) : 0;
        let val = TARGET_VALUE[e.key] || 1;
        if (!e.constructed) val *= 1.7;                 // a half-built site is a free kill
        // a target that already broke one of our waves goes to the back of the queue
        if (S.failedTargets[e.id] && game.t - S.failedTargets[e.id] < 150) val *= 0.25;
        const score = val * 1000 / ((1 + th / 55) * (1 + dist / 2400));
        out.push({ ent: e, score, threat: th, dist });
      }
      out.sort((a, b) => b.score - a.score);
      rankCache[mode] = out;
      return out;
    }

    /* the softest way in: ring the target with candidate staging points and
       score the final approach corridor by the fire it has to cross */
    function pickApproach(target, mode) {
      const anchor = baseAnchor();
      if (!anchor || !target) return null;
      const R = 560;
      let best = null, bestCost = Infinity;
      for (let i = 0; i < 12; i++) {
        const a = (i / 12) * Math.PI * 2 + 0.13;
        const sx = target.x + Math.cos(a) * R, sy = target.y + Math.sin(a) * R;
        if (!world.inb(Math.floor(sx / TILE), Math.floor(sy / TILE))) continue;
        if (!world.passableWorld(sx, sy)) continue;
        let cost = 0;
        for (let k = 1; k <= 6; k++) {
          const t = k / 6;
          cost += threatAt(U.lerp(sx, target.x, t), U.lerp(sy, target.y, t), mode || 'ground');
        }
        cost += U.dist(anchor.x, anchor.y, sx, sy) / 10;   // mild preference for shorter marches
        if (cost < bestCost) { bestCost = cost; best = { x: sx, y: sy, cost: bestCost }; }
      }
      return best;
    }

    /* rough combat power of a unit list — used to decide whether a wave can
       actually break what is waiting for it */
    function forcePower(units) {
      let pw = 0;
      for (const u of units) {
        const w = u.def.weapon;
        if (!w && !u.def.suicide) continue;
        const dps = w ? w.dmg / Math.max(0.2, w.cd) : u.def.cost / 12;
        pw += dps * (u.hp / Math.max(1, u.maxHp)) * (1 + u.vetRank * 0.15);
      }
      return pw;
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

    /* does any of my supply centers still have a live dock nearby? */
    function supplyHasWork() {
      const R = 15 * TILE;
      for (const sc of myBuildings('supply')) {
        if (!sc.constructed) continue;
        for (const d of world.docks) {
          if (d.amount > 0 && U.dist(sc.x, sc.y, d.x, d.y) < R) return true;
        }
      }
      return false;
    }

    /* ------------- construction ------------- */
    function wantedStructure() {
      const fac = p().faction, F = FACTIONS[fac];
      const has = k => myBuildings(k).length;
      const money = p().money;

      // income is the lifeblood — a mined-out or supply-less AI expands before anything else
      if (!has('supply') && money >= BUILDINGS.supply.cost) return 'supply';
      if (has('supply') && !supplyHasWork() && money >= BUILDINGS.supply.cost &&
          nearestDockWithSupplies(world.pw / 2, world.ph / 2)) return 'supply';
      if (F.usesPower && p().powerUse + 4 > p().powerCap) {
        // rich late-game AIs build one big nuclear reactor instead of stacking fusion plants
        if (F.buildings.includes('nuclear') && has('power') >= 2 && !has('nuclear') &&
            money >= BUILDINGS.nuclear.cost + 1500 && game.t > 420) return 'nuclear';
        if (money >= BUILDINGS.power.cost) return 'power';
      }
      if (!has('barracks') && money >= BUILDINGS.barracks.cost) return 'barracks';
      if (!has('factory') && money >= BUILDINGS.factory.cost + buf(300)) return 'factory';
      if (has('gatdef') < 1 && money >= BUILDINGS.gatdef.cost + buf(500) && game.t > 140) return 'gatdef';
      if (has('artdef') < 1 && money >= BUILDINGS.artdef.cost + buf(700) && game.t > 200) return 'artdef';
      if (has('market') < 2 && money >= BUILDINGS.market.cost + buf(300)) return 'market';
      if (F.buildings.includes('airfield') && !has('airfield') && money >= BUILDINGS.airfield.cost + buf(800) && game.t > 240) return 'airfield';
      if (!has('repairbay') && money >= BUILDINGS.repairbay.cost + buf(1200) && game.t > 330) return 'repairbay';
      if (has('supply') < 2 && game.t > 150 && money >= BUILDINGS.supply.cost + buf(500)) return 'supply';
      if (has('supply') < 3 && game.t > 340 && money >= BUILDINGS.supply.cost + buf(1500)) return 'supply';
      if (has('factory') < 2 && game.t > 300 && money >= BUILDINGS.factory.cost + buf(3000)) return 'factory';
      if (game.swAllowed !== false && diff.superweapon && !has('superweapon') && game.t > 420 && money >= BUILDINGS.superweapon.cost + buf(1000)) return 'superweapon';
      if (game.swAllowed !== false && diffKey === 'hard' && has('superweapon') < 2 && game.t > 780 && money >= BUILDINGS.superweapon.cost + 6000) return 'superweapon';
      if (diffKey === 'hard' && has('factory') < 2 && game.t > 420 && money >= BUILDINGS.factory.cost + 1500) return 'factory';
      if (has('factory') < 3 && game.t > 600 && money >= BUILDINGS.factory.cost + buf(6000)) return 'factory';
      if (has('gatdef') < 3 && money >= BUILDINGS.gatdef.cost + buf(2000) && game.t > 380) return 'gatdef';
      if (has('artdef') < 3 && money >= BUILDINGS.artdef.cost + buf(2500) && game.t > 430) return 'artdef';
      if (has('market') < 12 && money >= BUILDINGS.market.cost + buf(2500) && game.t > 240) return 'market';
      if (!has('cc') && money >= BUILDINGS.cc.cost) return 'cc';
      return null;
    }

    /* one free walkable tile all around the footprint, so units never get
       wedged between structures and the base keeps clear lanes */
    function marginClear(tx, ty, size) {
      for (let y = ty - 1; y <= ty + size; y++) for (let x = tx - 1; x <= tx + size; x++) {
        if (y >= ty && y < ty + size && x >= tx && x < tx + size) continue;
        if (!world.inb(x, y)) return false;
        const i = world.idx(x, y);
        if (world.terrain[i] === 2 || world.blocked[i] !== 0) return false;
      }
      return true;
    }

    /* defenses fan out across the threat-facing arc instead of piling on one spot;
       spacing keeps each battery covering fresh ground */
    function defenseSpot(key, def, anchor) {
      const t = enemyKeyBuilding();
      const dir = t ? Math.atan2(t.y - anchor.y, t.x - anchor.x) : Math.atan2(world.ph / 2 - anchor.y, world.pw / 2 - anchor.x);
      const baseR = key === 'gatdef' ? 9 : 6;        // gatlings out on the rim, artillery further back
      const minSpace = key === 'gatdef' ? 5.5 : 7;   // tiles between same-type batteries
      const mine = game.ents.filter(e => !e.dead && e.kind === 'building' && e.owner === pi &&
        (e.key === 'gatdef' || e.key === 'artdef'));
      for (let ring = 0; ring < 3; ring++) {
        for (let k = 0; k < 9; k++) {
          const sgn = k % 2 ? 1 : -1;
          const a = dir + Math.ceil(k / 2) * 0.55 * sgn;
          const r = baseR + ring * 3;
          const tx = Math.floor(anchor.x / TILE + Math.cos(a) * r) - Math.floor(def.size / 2);
          const ty = Math.floor(anchor.y / TILE + Math.sin(a) * r) - Math.floor(def.size / 2);
          if (!world.canPlace(tx, ty, def.size, pi) || !marginClear(tx, ty, def.size)) continue;
          const wx = (tx + def.size / 2) * TILE, wy = (ty + def.size / 2) * TILE;
          let ok = true;
          for (const m of mine) {
            const need = (m.key === key ? minSpace : 4) * TILE;
            if (U.dist(m.x, m.y, wx, wy) < need) { ok = false; break; }
          }
          if (ok) return { tx, ty };
        }
      }
      return null;
    }

    function findPlacement(key) {
      const anchor = baseAnchor();
      if (!anchor) return null;
      const def = BUILDINGS[key];
      const ax = Math.floor(anchor.x / TILE), ay = Math.floor(anchor.y / TILE);
      let bx = ax, by = ay;
      if (key === 'gatdef' || key === 'artdef') {
        const spot = defenseSpot(key, def, anchor);
        if (spot) return spot;
        // arc is full — fall through to the generic search rather than build nothing
      } else if (key === 'supply') {
        const dock = nearestDockWithSupplies(anchor.x, anchor.y);
        if (dock) { bx = Math.floor(dock.x / TILE) - 4; by = Math.floor(dock.y / TILE) - 4; }
      }
      // pass 0 demands a free lane around the building; pass 1 relaxes if the base is cramped
      for (let pass = 0; pass < 2; pass++) {
        for (let r = 1; r <= 16; r++) {
          for (let attempt = 0; attempt < 14; attempt++) {
            const a = U.rand(0, Math.PI * 2);
            const tx = Math.round(bx + Math.cos(a) * r) - Math.floor(def.size / 2);
            const ty = Math.round(by + Math.sin(a) * r) - Math.floor(def.size / 2);
            if (!world.canPlace(tx, ty, def.size, pi)) continue;
            if (pass === 0 && !marginClear(tx, ty, def.size)) continue;
            return { tx, ty };
          }
        }
      }
      return null;
    }

    function manageDozers() {
      const dozers = myUnits('dozer');
      const cc = myBuildings('cc')[0];
      // a builder-less AI is a dead AI: rebuild dozers with zero hesitation
      const wantDozers = p().money > 5000 ? 3 : 2;
      if (dozers.length < wantDozers && cc && cc.constructed &&
          p().money > UNITS.dozer.cost + (dozers.length ? 400 : 0)) {
        const queued = cc.queue.filter(q => q.key === 'dozer').length;
        if (dozers.length + queued < wantDozers) cc.enqueue('dozer');
      }
      let sites = myBuildings().filter(b => !b.constructed);
      // a site nobody can reach would freeze construction forever — refund and clear it
      for (const site of sites) {
        if (site._aiProg !== site.buildProgress) { site._aiProg = site.buildProgress; site._aiProgT = game.t; }
        else if (game.t - (site._aiProgT ?? game.t) > 75) {
          p().addMoney(Math.floor(site.def.cost * 0.75));
          site.dead = true;
          world.blockRect(site.tx, site.ty, site.size, false);
        }
      }
      sites = sites.filter(s => !s.dead);
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
      const maxSites = dozers.length >= 3 ? 3 : 2;   // extra dozers = parallel construction
      if (want && sites.length < maxSites && dozers.length) {
        const spot = findPlacement(want);
        if (spot && p().money >= BUILDINGS[want].cost) {
          p().spend(BUILDINGS[want].cost);
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
        const nSup = myBuildings('supply').filter(b => b.constructed).length;
        const wanted = Math.min(9, 3 * nSup + (posture() === 'steady' || posture() === 'leading' ? 0 : 1));
        if (trucks.length + queued < wanted && p().money > uCost('truck', p().faction) + 300) {
          sc.enqueue('truck');
        }
      }
    }

    /* a rich AI raises its own army cap — money must become pressure, not savings */
    function armyCapEff() {
      const lobbyScale = game.players.length > 8 ? 0.42 : game.players.length > 4 ? 0.55 : 1;
      const po = posture();
      const postureCap = po === 'desperate' ? 1.5 : po === 'pushing' ? 1.25 : po === 'leading' ? 1.05 : 1;
      return Math.min(diff.armyCap * 2,
        diff.armyCap + Math.floor(Math.max(0, p().money - 4000) / 2500)) * lobbyScale * postureCap;
    }

    /* ------------- army production ------------- */
    let profT = 0, prof = null;
    function enemyProfile() {
      // sample what the enemy team fields and remember it for 25 s
      if (game.t - profT < 25) return prof;
      profT = game.t;
      let air = 0, armor = 0, inf = 0, total = 0;
      for (const e of game.ents) {
        if (e.dead || e.kind !== 'unit' || !e.def.weapon || !isEnemyEnt(e)) continue;
        const v = e.def.cost;
        total += v;
        if (e.def.air) air += v;
        else if (e.armor === 'heavy') armor += v;
        else if (e.armor === 'inf') inf += v;
      }
      prof = total > 800 ? { air: air / total, armor: armor / total, inf: inf / total } : null;
      return prof;
    }

    function manageArmy() {
      const fac = p().faction;
      const baseComp = COMPS[fac];
      // adapt: boost counter units against what the enemy actually fields
      const ep = enemyProfile();
      const comp = { ...baseComp };
      // counter-intel: enemy spy planes in the air -> field detectors
      // detectors only matter against ARMED cloaked aircraft — pure recon planes are undetectable
      const enemySpies = game.ents.some(e => !e.dead && e.kind === 'unit' && hasCloak(e) && e.def.weapon && isEnemyEnt(e));
      const myDetectors = myUnits('detector').length;
      if (enemySpies && myDetectors < 2) comp.detector = 2;
      if (ep) {
        for (const [trend, frac] of [['air', ep.air], ['armor', ep.armor], ['inf', ep.inf]]) {
          if (frac < 0.18) continue;
          for (const k of (COUNTERS[trend][fac] || [])) {
            if (comp[k]) comp[k] = comp[k] * (1 + frac * 2.2);
          }
        }
      }
      // read the enemy's FORTIFICATIONS too and build what actually gets through them
      const mix = enemyDefenseMix();
      const AIR_KEYS = ['falcon', 'seraph', 'vulture', 'behemoth', 'kestrel', 'umbra'];
      if (mix.n >= 2) {
        // Artillery outranges every emplacement, so some of the budget shifts to guns
        // that never enter their envelope — but only some: siege pieces are fragile
        // and an army that is mostly artillery cannot actually take ground.
        comp.siege = (comp.siege || 1) * (1 + Math.min(2.5, mix.n * 0.5));
        if (mix.aa < mix.ga * 0.35) {
          for (const k of AIR_KEYS) if (comp[k]) comp[k] *= 1.8;   // their line can't shoot up
        } else {
          for (const k of AIR_KEYS) if (comp[k]) comp[k] *= 0.45;  // dense AA: keep jets home
          for (const k of ['bulwark', 'warlord', 'goliath', 'jackal']) if (comp[k]) comp[k] *= 1.4;
        }
      }
      S.lastComp = comp;                        // exposed for diagnostics/tests
      const army = combatUnits();
      if (army.length >= armyCapEff()) return;
      const counts = {};
      for (const u of army) counts[u.key] = (counts[u.key] || 0) + 1;
      const po = posture();
      const qDepth = po === 'desperate' || po === 'pushing' ? 5 : 4;
      for (const b of myBuildings()) {
        if (!b.constructed || b.queue.length >= qDepth) continue;
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
        if (pick && p().money > uCost(pick, fac) + buf(game.t < 300 ? 500 : 120)) {
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

    /* Force needed to crack a position. The coefficient is deliberately steep:
       crossing open ground under massed emplacements costs a unit a second, so a
       wave that merely "outnumbers" a fortified line still dissolves in it. When
       nothing valuable is affordable the AI falls through to the outer defenses
       and peels the line apart instead of charging the middle. */
    function reqFor(threat) { return 110 + threat * 1.6; }

    /* pick this wave's doctrine. Strategies that just failed get shelved for a
       while, so a blocked AI tries something else instead of repeating itself. */
    function chooseStrategy(ground, jets) {
      const arty = ground.filter(u => u.def.weapon && u.def.weapon.range >= 380);
      const fast = ground.filter(u => u.def.speed >= 95);
      const tg = rankedTargets('ground')[0];
      const ta = jets.length ? rankedTargets('air')[0] : null;   // only rank for air if we fly
      const sc = {};
      sc.push  = ground.length * 12 / (1 + (tg ? tg.threat : 0) / 260);
      sc.siege = arty.length * 55 * (1 + (tg ? Math.min(2, tg.threat / 180) : 0));
      sc.air   = jets.length * 34 / (1 + (ta ? threatAt(ta.ent.x, ta.ent.y, 'air') : 0) / 60);
      const trucks = game.ents.some(e => !e.dead && e.kind === 'unit' && e.def.harvester && isEnemyEnt(e));
      sc.raid  = fast.length * 14 + (trucks ? 70 : 0);
      const po = posture();
      if (po === 'desperate') { sc.raid *= 1.6; sc.push *= 0.8; }
      if (po === 'leading') sc.push *= 1.3;
      for (const k in sc) sc[k] /= 1 + (S.stratFail[k] || 0) * 0.7;
      let best = 'push', bv = -1;
      for (const k in sc) if (sc[k] > bv) { bv = sc[k]; best = k; }
      return best;
    }

    /* build a full assault plan: doctrine, the weak point worth hitting that we
       can actually break, and the least-defended corridor to reach it */
    function planAssault(ground, jets, forceCommit) {
      const strategy = chooseStrategy(ground, jets);
      const mode = strategy === 'air' ? 'air' : 'ground';
      let list = rankedTargets(mode);
      if (!list.length) return null;
      if (strategy === 'raid') {
        // economy first: supply lines and expansions, not the fortified core
        const eco = list.filter(c => (c.ent.key === 'supply' || c.ent.key === 'market' ||
          c.ent.key === 'power') && c.threat < 200);
        if (eco.length) list = eco.concat(list);
      }
      const force = forcePower(strategy === 'air' ? jets : ground);
      let pick = list.find(c => force >= reqFor(c.threat));
      if (!pick) {
        if (!forceCommit) return null;              // can't break anything yet — keep massing
        pick = list.reduce((a, b) => (a.threat <= b.threat ? a : b));
      }
      return { strategy, target: pick.ent, threat: pick.threat,
        approach: pickApproach(pick.ent, mode) };
    }

    /* send a unit in along the planned corridor instead of straight across the guns */
    function routeTo(u, plan) {
      const t = plan.target;
      const ap = plan.approach;
      if (ap && U.dist(u.x, u.y, ap.x, ap.y) > 300 && U.dist(u.x, u.y, t.x, t.y) > 700) {
        u.giveOrder({ type: 'attackmove', x: ap.x + U.rand(-70, 70), y: ap.y + U.rand(-70, 70) });
        u.giveOrder({ type: 'attackmove', x: t.x + U.rand(-60, 60), y: t.y + U.rand(-60, 60) }, true);
      } else {
        orderAssault(u, t);
      }
    }

    /* per-unit assault behaviour: artillery shells from stand-off range, wounded
       units peel out to heal instead of dying, everyone else presses the plan */
    function assaultMicro(ground, plan) {
      const repair = myBuildings('repairbay').find(b => b.constructed) || baseAnchor();
      for (const u of ground) {
        if (u._staging) continue;               // mustering for the next batch
        // already pulled out and still healing? leave it alone
        if (u._healT && game.t < u._healT) {
          if (u.hp >= u.maxHp * 0.85) u._healT = 0;
          continue;
        }
        if (u.hp < u.maxHp * 0.32 && repair) {
          u._healT = game.t + 30;
          u.giveOrder({ type: 'move', x: repair.x + U.rand(-70, 70), y: repair.y + U.rand(-70, 70) });
          continue;
        }
        const w = u.def.weapon;
        if (w && w.range >= 380) {
          // siege piece: hit defenses from outside their reach, never drive into them
          let best = null, bd = Infinity;
          for (const d of enemyDefenses()) {
            if (!d.hard) continue;
            const dist = U.dist(u.x, u.y, d.x, d.y);
            if (dist < bd) { bd = dist; best = d; }
          }
          if (best && bd <= w.range * 0.95) {
            const victim = game.byId.get(best.id);
            if (victim && !victim.dead) {
              if (u.order.type !== 'attack') u.giveOrder({ type: 'attack', targetId: victim.id });
              continue;
            }
          }
          if (best && bd > w.range * 0.95 && (u.order.type === 'idle' || u.order.type === 'guard')) {
            const a = U.angTo(best.x, best.y, u.x, u.y);
            u.giveOrder({ type: 'attackmove', x: best.x + Math.cos(a) * w.range * 0.85,
              y: best.y + Math.sin(a) * w.range * 0.85 });
            continue;
          }
        }
        if (u.order.type === 'idle' || u.order.type === 'guard') {
          // near the front → rejoin now; still at home → wait for a proper batch
          if (U.dist(u.x, u.y, plan.target.x, plan.target.y) < 850 || S.reinforceReady) routeTo(u, plan);
        }
      }
    }

    function manageAttack(dt2) {
      const army = combatUnits().filter(u => !u.def.air && !u.def.builder);
      const jets = combatUnits().filter(u => u.def.air);

      switch (S.attackState) {
        case 'idle': {
          S.waveT -= dt2;
          // stage idle units at the forward rally so the army looks and acts alive
          S.stageT = (S.stageT || 0) - dt2;
          if (S.stageT <= 0) {
            S.stageT = 8;
            const g = gatherPoint();
            for (const u of army) {
              if ((u.order.type === 'idle' || u.order.type === 'guard') &&
                  U.dist(u.x, u.y, g.x, g.y) > 260 && !nearZone(u)) {
                u.giveOrder({ type: 'guardarea', x: g.x + U.rand(-90, 90), y: g.y + U.rand(-90, 90) });
              }
            }
          }
          // A full army never sits at home — but straight after a wave has broken,
          // honour the regroup window instead of shovelling the rebuilt army back
          // into the same guns twelve seconds later.
          const regrouping = game.t < S.regroupUntil;
          const capped = army.length >= armyCapEff() * 0.88;
          if (capped && !regrouping) S.waveT = Math.min(S.waveT, 12);
          const needed = Math.min(S.waveSize, diff.armyCap * (posture() === 'desperate' ? 0.28 : 0.4));
          if (S.waveT <= 0 && army.length >= needed) {
            // commit only against something this force can actually break; if the
            // whole map is too hard right now, wait unless we're capped out or losing
            const forceCommit = (capped && !regrouping) || posture() === 'desperate' || S.waveT < -70;
            const plan = planAssault(army, jets, forceCommit);
            if (!plan) break;
            S.plan = plan;
            S.strategy = plan.strategy;
            S.attackState = 'gathering';
            S.gatherT = 22;
            const g = plan.approach || gatherPoint();
            // everybody who was mustering joins this wave
            for (const u of army) {
              u._staging = false;
              u.giveOrder({ type: 'attackmove', x: g.x + U.rand(-90, 90), y: g.y + U.rand(-90, 90) });
            }
          }
          break;
        }
        case 'gathering': {
          S.gatherT -= dt2;
          // move out once the force is actually assembled, not just when the clock runs out
          const ap = S.plan && S.plan.approach;
          const massed = ap ? army.filter(u => U.dist(u.x, u.y, ap.x, ap.y) < 380).length : 0;
          if (S.gatherT <= 0 || (massed >= Math.max(3, army.length * 0.6) && S.gatherT < 14)) {
            const plan = S.plan;
            const target = plan && !plan.target.dead ? plan.target :
              (baseAnchor() ? nearestEnemyEntTo(baseAnchor().x, baseAnchor().y) : null);
            if (!target) { S.attackState = 'idle'; S.waveT = waveEvery(); break; }
            if (plan) plan.target = target;
            S.attackState = 'attacking';
            S.attackTargetId = target.id;
            S.attackT = 0;
            S.reinforceReady = true;
            S.armyValueStart = army.reduce((s, u) => s + u.def.cost, 0);
            S.targetHpStart = target.hp || 1;
            for (const u of army) routeTo(u, plan || { target, approach: null });
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
          S.attackT = (S.attackT || 0) + dt2;

          // reinforcements travel in batches — a steady trickle just feeds the grinder
          const waiting = army.filter(u => u._staging);
          S.reinforceReady = waiting.length >= 3;
          if (S.reinforceReady && target && !target.dead) {
            const plan = S.plan || { target, approach: null };
            for (const u of waiting) { u._staging = false; routeTo(u, plan); }
          }

          if (target && !target.dead) assaultMicro(army, S.plan || { target, approach: null });
          for (const j of jets) {
            if (j.jetState === 'idle' && j.ammo > 0) {
              const jt = target && !target.dead ? target : enemyKeyBuilding();
              if (jt) j.giveOrder({ type: 'attack', targetId: jt.id });
            }
          }

          const losses = S.armyValueStart ? 1 - val / S.armyValueStart : 0;
          const progress = target && !target.dead && S.targetHpStart ?
            1 - target.hp / S.targetHpStart : 1;

          if (!target || target.dead) {
            // objective down: re-plan against the next weak point rather than
            // wandering into whatever happens to be nearest
            S.stratFail[S.strategy] = Math.max(0, (S.stratFail[S.strategy] || 0) - 1);
            const next = planAssault(army, jets, true);
            if (next) {
              S.plan = next; S.strategy = next.strategy;
              S.attackTargetId = next.target.id;
              S.targetHpStart = next.target.hp || 1;
              S.armyValueStart = val;
              for (const u of army) if (u.order.type === 'idle' || u.order.type === 'guard') routeTo(u, next);
            } else { S.attackState = 'idle'; S.waveT = waveEvery(); }
          } else if (S.attackT > 75 && progress < 0.15) {
            // a minute in and the objective is barely scratched: this force simply
            // cannot hurt what it is standing in front of. Leave before it dissolves.
            withdraw(army, 'stalled');
          } else if (losses > 0.6 && progress < 0.35) {
            withdraw(army, 'losses');
          } else if (S.attackT > 420) {
            S.attackState = 'idle';
            S.waveT = 25;
          }
          break;
        }
        case 'withdraw': {
          S.withdrawT -= dt2;
          if (S.withdrawT <= 0) { S.attackState = 'idle'; S.waveT = waveEvery(); }
          break;
        }
      }

      // early harass: fast units hit the enemy economy (trailing AIs raid more often)
      S.harassT -= dt2;
      if (S.harassT <= 0) {
        S.harassT = posture() === 'desperate' ? 130 : posture() === 'pushing' ? 180 : 240;
        const fastKeys = { coalition: 'viper', dynasty: 'flak', cartel: 'guntruck' };
        const raiders = myUnits(fastKeys[p().faction]).slice(0, 2);
        const truck = game.ents.find(e => !e.dead && e.kind === 'unit' && e.def.harvester && isEnemyEnt(e));
        if (raiders.length && truck) {
          for (const r of raiders) r.giveOrder({ type: 'attack', targetId: truck.id });
        }
      }
    }

    /* break contact and regroup — the wave lives to fight another day */
    function withdraw(army, why) {
      const rally = gatherPoint();
      for (const u of army) {
        u._healT = 0;
        u.giveOrder({ type: 'move', x: rally.x + U.rand(-110, 110), y: rally.y + U.rand(-110, 110) });
      }
      S.stratFail[S.strategy] = (S.stratFail[S.strategy] || 0) + 1;
      if (S.attackTargetId) S.failedTargets[S.attackTargetId] = game.t;
      S.regroupUntil = game.t + 60;      // rebuild before trying again
      S.attackState = 'withdraw';
      S.withdrawT = 20;
      S.waveSize = Math.min(diff.armyCap, S.waveSize + 4);   // next time, come heavier
      S.lastFail = why;
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
      // strike the densest enemy army if it is worth it, otherwise their key structure
      const cl = enemyCluster();
      const t = enemyKeyBuilding();
      if (cl && cl.val > 4000) POWERS_SYS.fireSuperweapon(pi, silo, cl.x, cl.y);
      else if (t) POWERS_SYS.fireSuperweapon(pi, silo, t.x, t.y);
      else if (cl) POWERS_SYS.fireSuperweapon(pi, silo, cl.x, cl.y);
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

    /* fight for the control points */
    function zoneDuty() {
      if (!game.zones.length) return;
      for (const z of game.zones) {
        const enemyThere = z.present.some(t => t !== myTeam());
        const needHold = z.owner !== myTeam() || enemyThere || z.contested;
        const want = z.kind === 'dom' ? (needHold ? 6 : 3) : (needHold ? 3 : 2);
        const near = combatUnits().filter(u => !u.def.air && U.dist(u.x, u.y, z.x, z.y) < z.r + 160);
        if (near.length >= want) continue;
        const takers = combatUnits()
          .filter(u => !u.def.air && (u.order.type === 'idle' || u.order.type === 'guard') &&
            U.dist(u.x, u.y, z.x, z.y) >= z.r + 160)
          .sort((a, b) => U.dist2(a.x, a.y, z.x, z.y) - U.dist2(b.x, b.y, z.x, z.y))
          .slice(0, want - near.length);
        for (const u of takers) {
          u.giveOrder({ type: 'guardarea', x: z.x + U.rand(-z.r * 0.5, z.r * 0.5), y: z.y + U.rand(-z.r * 0.5, z.r * 0.5) });
        }
      }
    }

    function nearZone(u) {
      return game.zones.some(z => U.dist(u.x, u.y, z.x, z.y) < z.r + 160);
    }

    function tick(dt2) {
      if (game.over || p().defeated) return;
      if (S.defendT > 0) S.defendT -= dt2;
      // war chest: every AI general is resupplied with $100,000 every 10 minutes
      S.cashT -= dt2;
      if (S.cashT <= 0) { S.cashT = 600; p().addMoney(AI_CASH_DROP); }
      if (!myEnts().length) return;
      zoneDuty();
      manageDozers();
      manageEconomy();
      manageArmy();
      manageAttack(dt2);
      S.powerUseT -= dt2;
      if (S.powerUseT <= 0) { S.powerUseT = 12; usePowers(); useSuperweapon(); }
    }

    function onUnitDone(u) {
      if (u.def.stealthAir && !u.def.weapon) {
        // spy plane: park over the enemy's key building for standing recon
        const t = enemyKeyBuilding();
        if (t) u.giveOrder({ type: 'guardarea', x: t.x + U.rand(-80, 80), y: t.y + U.rand(-80, 80) });
        return;
      }
      if (u.def.detect) {
        // detector: escort the base's forward rally
        const g = gatherPoint();
        u.giveOrder({ type: 'guardarea', x: g.x + U.rand(-60, 60), y: g.y + U.rand(-60, 60) });
        return;
      }
      // fresh troops muster at the staging point and wait to be released as a
      // group — feeding them in one at a time is exactly the meat grinder.
      if (u.def.weapon && !u.def.air) {
        const g = S.attackState === 'idle' ? gatherPoint() : ((S.plan && S.plan.approach) || gatherPoint());
        u._staging = true;
        u.giveOrder({ type: 'guardarea', x: g.x + U.rand(-80, 80), y: g.y + U.rand(-80, 80) });
      }
    }

    return { pi, tick, notifyAttack, spend, onUnitDone, S, posture,
      // exposed for diagnostics and tests
      enemyDefenses, threatAt, rankedTargets, pickApproach, planAssault, forcePower,
      enemyDefenseMix, reqFor };
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

  return { initGame, tick, notifyAttack, spendPowerPoints, onUnitDone, onBuildingDone,
    _brain: pi => ais.find(a => a.pi === pi),
    _debug: () => ais.map(a => ({ pi: a.pi, state: a.S.attackState, waveT: Math.round(a.S.waveT),
      attackT: Math.round(a.S.attackT || 0), waveSize: a.S.waveSize, targetId: a.S.attackTargetId,
      strategy: a.S.strategy, stratFail: { ...a.S.stratFail }, lastFail: a.S.lastFail,
      planThreat: a.S.plan ? Math.round(a.S.plan.threat) : null,
      posture: a.posture(), standing: Math.round(standings()[a.pi]) })) };
})();
