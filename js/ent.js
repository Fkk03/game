/* ============ ent.js — entities: units, buildings, projectiles, combat ============ */
'use strict';

let ENT_ID = 1;

/* ---------------- helpers ---------------- */
function entsInRadius(x, y, r, filter) {
  const out = [], r2 = r * r;
  for (const e of game.ents) {
    if (e.dead) continue;
    if (filter && !filter(e)) continue;
    const rr = r + (e.kind === 'building' ? e.size * TILE * 0.45 : e.def.radius || 0);
    if (U.dist2(x, y, e.x, e.y) <= rr * rr) out.push(e);
  }
  return out;
}

function isEnemy(a, b) {
  if (a.owner === -1 || b.owner === -1 || a.owner === b.owner) return false;
  const pa = game.players[a.owner], pb = game.players[b.owner];
  return !pa || !pb || pa.team !== pb.team;      // allies (same team) are not enemies
}

/* is this aircraft's cloak active right now? Firing a weapon drops it briefly */
function isStealthed(e) {
  return !!(e.def && e.def.stealthAir) && !(e.decloakUntil > game.t);
}

/* stealth aircraft are only visible/targetable to a team with a detector in range */
function isDetectedBy(e, team) {
  if (!e.def || !e.def.stealthAir) return true;
  const p = game.players[e.owner];
  if (p && p.team === team) return true;
  for (const d of game.ents) {
    if (d.dead || d.kind !== 'unit' || !d.def.detect) continue;
    const dp = game.players[d.owner];
    if (!dp || dp.team !== team) continue;
    if (U.dist2(d.x, d.y, e.x, e.y) <= d.def.detect * d.def.detect) return true;
  }
  return false;
}

function weaponCanHit(w, target) {
  if (target.kind === 'unit' && target.def.air) return !!w.aa;
  return w.ga !== false;
}

function effDamage(w, attacker) {
  let d = w.dmg;
  if (attacker && attacker.kind === 'unit') {
    d *= VET_DMG[attacker.vetRank];
    if (attacker.def.horde && attacker.hordeOn) d *= 1.25;
  }
  if (attacker) {
    const p = game.players[attacker.owner];
    if (p && p.frenzyUntil > game.t) d *= 1.3;   // War Frenzy power
  }
  return d;
}

/* central damage entry point. fromAir: delivered by an aircraft —
   air power hits units at 70% and structures at only 30% */
function applyDamage(target, rawDmg, dtype, attacker, fromAir) {
  if (!target || target.dead) return;
  const mod = (DMG_MOD[dtype] && DMG_MOD[dtype][target.armor] !== undefined) ? DMG_MOD[dtype][target.armor] : 1;
  let dmg = rawDmg * mod;
  if (fromAir) dmg *= target.kind === 'building' ? 0.3 : 0.7;
  if (dmg <= 0) return;
  target.hp -= dmg;

  // retaliation & alerts — only against genuine enemies (friendly splash must not flip units)
  if (attacker && attacker.owner !== target.owner) {
    if (target.kind === 'unit' && !target.def.noAutoAttack && target.def.weapon &&
        (!target.order || target.order.type === 'idle' || target.order.type === 'guard') &&
        weaponCanHit(target.def.weapon, attacker) && !target.def.air) {
      target.order = { type: 'attack', targetId: attacker.id, fromGuard: true };
    }
    if (target.owner === 0) UI.underAttack(target);
    else if (game.players[target.owner] && game.players[target.owner].isAI) AI.notifyAttack(target, attacker);
  }

  if (target.hp <= 0) killEnt(target, attacker);
}

function killEnt(e, attacker) {
  if (e.dead) return;
  e.dead = true;
  const p = game.players[e.owner];

  if (e.kind === 'building') {
    world.blockRect(e.tx, e.ty, e.size, false);
    FX.explosion(e.x, e.y, 1.3 + e.size * 0.35);
    FX.stagedCollapse(e.x, e.y, e.size);
    SFX.explo(e.x, e.y, 1.6);
    RENDER.addRubble(e.x, e.y, e.size);
    RENDER.cleanGhost(e.id);
    if (p) { p.stats.buildingsLost++; recomputePower(e.owner); }
    if (e.owner === 0) { UI.feed(bName(e.key, p.faction) + ' destroyed', 'bad'); SFX.say('Structure lost'); }
    // reactor meltdown — full damage to everyone, friend and foe alike
    if (e.def.meltdown) {
      FX.nukeExplosion(e.x, e.y);
      FX.flash('160,255,120', 0.5, 0.8);
      SFX.explo(e.x, e.y, 2.4);
      RENDER.addDecal(e.x, e.y, 150);
      UI.feed('☢ NUCLEAR MELTDOWN', 'bad');
      UI.ping(e.x, e.y, '#8aff5a');
      UI.announce('☢ MELTDOWN ☢');
      dealSplash(e.x, e.y, e.def.meltdown.dmg, 'explosive', e.def.meltdown.splash, -1, null, true);
    }
  } else {
    if (e.def.chassis === 'inf') { FX.blood(e.x, e.y); }
    else {
      FX.explosion(e.x, e.y, e.def.air ? 1.1 : 0.9);
      SFX.explo(e.x, e.y, 0.9);
      if (!e.def.air) RENDER.addWreck(e.x, e.y, e.angle || 0, e.def.radius || 14);
      // cartel salvage: vehicles leave scrap if a cartel player is involved
      const cartelInvolved = (p && p.faction === 'cartel') ||
        (attacker && game.players[attacker.owner] && game.players[attacker.owner].faction === 'cartel');
      if (cartelInvolved && !e.def.air && !e.def.builder && Math.random() < 0.4) {
        world.dropCrate(e.x + U.rand(-10, 10), e.y + U.rand(-10, 10), 'salvage', 150);
      }
    }
    if (e.def.suicide && !e.detonated) { e.detonated = true;
      dealSplash(e.x, e.y, e.def.suicide.dmg, 'explosive', e.def.suicide.splash, e.owner, null); }
    if (p) p.stats.unitsLost++;
  }

  // XP awards
  if (attacker && !attacker.dead && attacker.owner !== e.owner) {
    const val = e.def.cost || 500;
    if (attacker.kind === 'unit' && attacker.def.weapon) {
      attacker.vetXp += val / 8;
      while (attacker.vetRank < 5 && attacker.vetXp >= VET_XP[attacker.vetRank + 1]) {
        attacker.vetRank++;
        attacker.maxHp = Math.round(attacker.def.hp * VET_HP[attacker.vetRank]);
        attacker.hp = Math.min(attacker.maxHp, attacker.hp + attacker.def.hp * 0.3);
        if (attacker.owner === 0) { FX.text(attacker.x, attacker.y - 20, '★ PROMOTED'); SFX.promote(); }
      }
    }
    const ap = game.players[attacker.owner];
    if (ap) { ap.stats.kills++; addPlayerXp(attacker.owner, val / 10); }
  }
}

function addPlayerXp(pi, amt) {
  const p = game.players[pi];
  p.xp += amt;
  while (p.rank < 5 && p.xp >= RANK_XP[p.rank + 1]) {
    p.rank++;
    p.powerPoints++;
    if (pi === 0) {
      UI.feed('Promotion! General rank ' + p.rank + ' — power point earned', 'gold');
      UI.announce('★ RANK ' + p.rank + ' ★');
      SFX.promote(); SFX.say('Promotion earned');
    } else {
      AI.spendPowerPoints(pi);
    }
  }
}

function dealSplash(x, y, dmg, dtype, radius, ownerIdx, srcEnt, hitAir, fromAir) {
  const victims = entsInRadius(x, y, radius, e => !e.dead && (hitAir || !(e.kind === 'unit' && e.def.air)));
  for (const v of victims) {
    if (v.owner === -1) continue;
    const d = U.dist(x, y, v.x, v.y);
    let fall = U.clamp(1 - (d / (radius + 18)) * 0.75, 0.3, 1);
    let amount = dmg * fall;
    if (v.owner === ownerIdx) amount *= 0.25;      // reduced friendly fire
    applyDamage(v, amount, dtype, srcEnt && !srcEnt.dead ? srcEnt : null, fromAir);
  }
}

function recomputePower(pi) {
  const p = game.players[pi];
  if (!p) return;
  let give = 0, use = 0;
  for (const e of game.ents) {
    if (e.dead || e.kind !== 'building' || e.owner !== pi || !e.constructed) continue;
    give += e.def.powerGive || 0;
    use += e.def.power || 0;
  }
  const wasLow = p.lowPower;
  p.powerCap = give; p.powerUse = use;
  p.lowPower = FACTIONS[p.faction].usesPower && use > give;
  if (pi === 0 && p.lowPower && !wasLow && game.t > 5) {
    UI.feed('LOW POWER — production slowed, defenses offline', 'bad');
    SFX.alarm(); SFX.say('Low power');
  }
}

/* =====================================================================
   UNIT
===================================================================== */
class Unit {
  constructor(owner, key, x, y) {
    this.id = ENT_ID++;
    this.kind = 'unit';
    this.owner = owner;
    this.key = key;
    this.def = UNITS[key];
    this.x = x; this.y = y;
    this.hp = this.def.hp; this.maxHp = this.def.hp;
    this.armor = this.def.armor;
    this.dead = false;
    this.angle = U.rand(0, Math.PI * 2);
    this.tAngle = this.angle;
    this.order = { type: 'idle' };
    this.orderQueue = [];
    this.path = null; this.pathI = 0;
    this.cool = 0;
    this.vetXp = 0; this.vetRank = 0;
    this.guardX = x; this.guardY = y;
    this.stuckT = 0; this.lastX = x; this.lastY = y;
    this.scanT = Math.random() * 0.5;
    this.hordeT = 0; this.hordeOn = false;
    this.moving = false;
    // harvester
    this.carrying = 0; this.loadT = 0;
    // jet
    if (this.def.air) {
      this.ammo = this.def.ammo; this.padId = null; this.jetState = 'idle';
      this.rearmT = 0; this.persistTargetId = 0; this.circleA = U.rand(0, 6);
      this.vx = 0; this.vy = 0;
      this.guardPost = null;      // air patrol anchor {x,y}
    }
    this.buildT = 0;
    this.repairT = 0;
  }

  get radius() { return this.def.radius; }

  applyOrder(o) {
    this.order = o;
    this.path = null;
    if (o.type === 'move' || o.type === 'attackmove' || o.type === 'guardarea') { this.guardX = o.x; this.guardY = o.y; }
    if (this.def.air) {
      if (o.type === 'attack') { this.jetState = 'attack'; this.persistTargetId = o.targetId; this.guardPost = null; }
      else if (o.type === 'guardarea') { this.jetState = 'guardmove'; this.persistTargetId = 0; this.guardPost = { x: o.x, y: o.y }; }
      else if (o.type === 'move' || o.type === 'attackmove') { this.jetState = 'moveto'; this.persistTargetId = 0; this.guardPost = null; }
    }
  }

  giveOrder(o, queue) {
    if (this.dead) return;
    if (queue && this.order.type !== 'idle' && this.order.type !== 'guard') {
      this.orderQueue.push(o);
      return;
    }
    this.orderQueue.length = 0;
    this.applyOrder(o);
  }

  nextOrder() {
    if (this.orderQueue.length) { this.applyOrder(this.orderQueue.shift()); return; }
    this.order = { type: 'guard' };
    this.guardX = this.x; this.guardY = this.y;
    this.path = null;
  }

  /* --------- pathing --------- */
  setPathTo(x, y) {
    this.path = PATH.find(world, this.x, this.y, x, y);
    this.pathI = 0;
    if (!this.path) { this.path = [{ x, y }]; }
  }

  moveAlongPath(dt, speedMul = 1) {
    this.moving = false;
    if (!this.path || this.pathI >= this.path.length) return true;
    const wp = this.path[this.pathI];
    const d = U.dist(this.x, this.y, wp.x, wp.y);
    const arrive = this.pathI === this.path.length - 1 ? 8 : 14;
    if (d < arrive) {
      this.pathI++;
      return this.pathI >= this.path.length;
    }
    const sp = this.def.speed * speedMul;
    const desired = U.angTo(this.x, this.y, wp.x, wp.y);
    const turnRate = this.def.chassis === 'inf' || this.def.chassis === 'rocketinf' ? 9 :
      (this.def.chassis === 'heavytank' ? 2.4 : 4.2);
    this.angle = U.turnToward(this.angle, desired, turnRate * dt);
    const slow = Math.abs(U.angDiff(this.angle, desired)) > 0.9 ? 0.35 : 1;
    const nx = this.x + Math.cos(this.angle) * sp * slow * dt;
    const ny = this.y + Math.sin(this.angle) * sp * slow * dt;
    if (world.passableWorld(nx, ny)) { this.x = nx; this.y = ny; }
    else {
      // slide along axis
      if (world.passableWorld(nx, this.y)) this.x = nx;
      else if (world.passableWorld(this.x, ny)) this.y = ny;
      else this.stuckT += dt * 2;
    }
    this.moving = true;
    const ch = this.def.chassis;
    if (ch !== 'inf' && ch !== 'rocketinf') {
      this.trackAcc = (this.trackAcc || 0) + sp * slow * dt;
      if (this.trackAcc > 15) {
        this.trackAcc = 0;
        RENDER.addTrack(this.x, this.y, this.angle, this.radius);
      }
      if (Math.random() < dt * 6) FX.dust(this.x - Math.cos(this.angle) * 12, this.y - Math.sin(this.angle) * 12);
    }

    // stuck detection → repath
    this.stuckT += dt;
    if (this.stuckT > 0.8) {
      if (U.dist(this.x, this.y, this.lastX, this.lastY) < 3) {
        const last = this.path[this.path.length - 1];
        this.setPathTo(last.x + U.rand(-25, 25), last.y + U.rand(-25, 25));
      }
      this.lastX = this.x; this.lastY = this.y; this.stuckT = 0;
    }
    return false;
  }

  /* --------- combat --------- */
  findTarget(range) {
    const w = this.def.weapon;
    if (!w && !this.def.suicide) return null;
    let best = null, bestScore = Infinity;
    for (const e of game.ents) {
      if (e.dead || !isEnemy(this, e)) continue;
      if (w ? !weaponCanHit(w, e) : (e.kind === 'unit' && e.def.air)) continue;
      if (isStealthed(e) && !isDetectedBy(e, game.players[this.owner].team)) continue;
      if (e.kind === 'building' && !e.constructed && e.buildProgress < 0.03) continue;
      const d = U.dist(this.x, this.y, e.x, e.y);
      if (d > range) continue;
      let score = d;
      if (e.kind === 'building') score += 220;                    // prefer units
      if (e.kind === 'unit' && !e.def.weapon) score += 90;        // prefer shooters
      if (score < bestScore) { bestScore = score; best = e; }
    }
    return best;
  }

  tryFire(target, dt) {
    const w = this.def.weapon;
    const d = U.dist(this.x, this.y, target.x, target.y);
    const range = w.range + (target.kind === 'building' ? target.size * TILE * 0.4 : 0);
    if (w.minRange && d < w.minRange) return 'tooclose';
    if (d > range) return 'far';
    // face target with turret
    const want = U.angTo(this.x, this.y, target.x, target.y);
    this.tAngle = U.turnToward(this.tAngle, want, 6.5 * dt);
    const needBody = this.def.chassis === 'inf' || this.def.chassis === 'rocketinf';
    if (needBody) this.angle = U.turnToward(this.angle, want, 9 * dt);
    if (Math.abs(U.angDiff(this.tAngle, want)) > 0.25) return 'turning';
    if (this.cool > 0) return 'cooling';
    this.cool = w.cd;
    fireWeapon(this, w, target);
    return 'fired';
  }

  /* --------- per-frame update --------- */
  update(dt) {
    if (this.cool > 0) this.cool -= dt;

    // veterans patch themselves up in the field — faster with every star.
    // Runs BEFORE the aircraft branch so veteran pilots heal too.
    const regen = VET_REGEN[this.vetRank];
    if (regen && this.hp < this.maxHp) this.hp = Math.min(this.maxHp, this.hp + regen * dt);

    if (this.def.air) { this.updateJet(dt); return; }

    // horde bonus cache (1 Hz)
    if (this.def.horde) {
      this.hordeT -= dt;
      if (this.hordeT <= 0) {
        this.hordeT = 1;
        let n = 0;
        for (const e of game.ents) {
          if (e.dead || e.kind !== 'unit' || e.owner !== this.owner || !e.def.horde || e === this) continue;
          if (U.dist2(this.x, this.y, e.x, e.y) < 140 * 140) { n++; if (n >= 4) break; }
        }
        this.hordeOn = n >= 4;
      }
    }

    // nudge out of tiles that became blocked (building placed on top of us)
    this.unstickT = (this.unstickT || 0) - dt;
    if (this.unstickT <= 0) {
      this.unstickT = 0.6;
      if (!world.passableWorld(this.x, this.y)) {
        // can't walk out of a blocked footprint (every step is blocked) — shove out directly
        const open = PATH.nearestOpen(world, Math.floor(this.x / TILE), Math.floor(this.y / TILE), 8);
        if (open) {
          this.x = (open.tx + 0.5) * TILE + U.rand(-6, 6);
          this.y = (open.ty + 0.5) * TILE + U.rand(-6, 6);
          this.path = null;
        }
      }
    }

    const o = this.order;
    switch (o.type) {
      case 'idle': case 'guard': this.doGuard(dt); break;
      case 'move':
        if (!this.path) this.setPathTo(o.x, o.y);
        if (this.moveAlongPath(dt)) this.nextOrder();
        break;
      case 'attackmove': this.doAttackMove(dt, o); break;
      case 'guardarea': this.doGuardMove(dt, o); break;
      case 'attack': this.doAttack(dt, o); break;
      case 'harvest': this.doHarvest(dt, o); break;
      case 'build': this.doBuild(dt, o); break;
      case 'repair': this.doRepair(dt, o); break;
    }

    // cartel salvage pickup
    if (this.def.salvager) {
      for (let i = world.crates.length - 1; i >= 0; i--) {
        const c = world.crates[i];
        if (U.dist2(this.x, this.y, c.x, c.y) < 26 * 26) {
          world.crates.splice(i, 1);
          if (this.vetRank < 5) {
            this.vetRank++;
            this.maxHp = Math.round(this.def.hp * VET_HP[this.vetRank]);
            this.hp = Math.min(this.maxHp, this.hp + this.def.hp * 0.35);
            if (this.owner === 0) { FX.text(this.x, this.y - 20, '★ SALVAGE UPGRADE'); SFX.promote(); }
          } else {
            game.players[this.owner].addMoney(c.val);
            if (this.owner === 0) FX.text(this.x, this.y - 20, '+$' + c.val);
          }
        }
      }
    }
  }

  doGuard(dt) {
    if (this.def.noAutoAttack || !this.def.weapon) {
      // idle harvester: automatically resume harvesting if it has capacity
      if (this.def.harvester && this.idleResumeT === undefined) this.idleResumeT = 1;
      if (this.def.harvester) {
        this.idleResumeT -= dt;
        if (this.idleResumeT <= 0) {
          this.idleResumeT = 2;
          const dock = nearestDockWithSupplies(this.x, this.y);
          if ((dock || this.carrying > 0) && nearestOwnBuilding(this.owner, 'supply', this.x, this.y))
            this.giveOrder({ type: 'harvest' });
        }
      }
      return;
    }
    this.scanT -= dt;
    if (this.scanT <= 0) {
      this.scanT = 0.4;
      const t = this.findTarget(this.def.weapon.range + 60);
      if (t) { this.order = { type: 'attack', targetId: t.id, fromGuard: true }; return; }
      // drift back to guard anchor
      if (U.dist(this.x, this.y, this.guardX, this.guardY) > 60 && !this.path) {
        this.setPathTo(this.guardX, this.guardY);
      }
    }
    if (this.path) this.moveAlongPath(dt);
  }

  doAttackMove(dt, o) {
    this.scanT -= dt;
    if (this.scanT <= 0 && ((this.def.weapon && !this.def.noAutoAttack) || this.def.suicide)) {
      this.scanT = 0.35;
      const t = this.findTarget(this.def.weapon ?
        Math.max(this.def.weapon.range + 80, this.def.sight * TILE) : this.def.sight * TILE);
      if (t) {
        this.orderQueue.unshift({ type: 'attackmove', x: o.x, y: o.y });
        this.order = { type: 'attack', targetId: t.id, resume: true };
        this.path = null;
        return;
      }
    }
    if (!this.path) this.setPathTo(o.x, o.y);
    if (this.moveAlongPath(dt)) this.nextOrder();
  }

  /* move to a point engaging on the way, then hold that ground (guard anchor there) */
  doGuardMove(dt, o) {
    this.scanT -= dt;
    if (this.scanT <= 0 && this.def.weapon && !this.def.noAutoAttack) {
      this.scanT = 0.35;
      const t = this.findTarget(Math.max(this.def.weapon.range + 80, this.def.sight * TILE));
      if (t) {
        this.orderQueue.unshift({ type: 'guardarea', x: o.x, y: o.y });
        this.order = { type: 'attack', targetId: t.id, fromGuard: true };
        this.path = null;
        return;
      }
    }
    if (!this.path) this.setPathTo(o.x, o.y);
    if (this.moveAlongPath(dt)) {
      this.order = { type: 'guard' };
      this.guardX = o.x; this.guardY = o.y;
      this.path = null;
    }
  }

  doAttack(dt, o) {
    const target = game.byId.get(o.targetId);
    if (!target || target.dead) { this.nextOrder(); return; }
    if (this.def.suicide) { this.doSuicide(dt, target); return; }
    if (!this.def.weapon || !weaponCanHit(this.def.weapon, target)) { this.nextOrder(); return; }

    const res = this.tryFire(target, dt);
    if (res === 'far') {
      // leash for guard-retaliation
      if (o.fromGuard && U.dist(this.x, this.y, this.guardX, this.guardY) > 340) { this.nextOrder(); return; }
      if (!this.path || this.repathT === undefined || (this.repathT -= dt) <= 0) {
        this.repathT = 0.7;
        this.setPathTo(target.x, target.y);
      }
      this.moveAlongPath(dt);
    } else if (res === 'tooclose') {
      if (!this.path || this.pathI >= this.path.length) {
        const a = U.angTo(target.x, target.y, this.x, this.y);
        this.setPathTo(this.x + Math.cos(a) * 90, this.y + Math.sin(a) * 90);
      }
      this.moveAlongPath(dt);
    } else {
      this.path = null;
    }
  }

  doSuicide(dt, target) {
    if (target.kind === 'unit' && target.def.air) { this.nextOrder(); return; }
    const d = U.dist(this.x, this.y, target.x, target.y);
    const hitR = this.radius + (target.kind === 'building' ? target.size * TILE * 0.5 : target.def.radius) + 8;
    if (d < hitR) {
      this.detonated = true;
      dealSplash(this.x, this.y, this.def.suicide.dmg, 'explosive', this.def.suicide.splash, this.owner, this);
      FX.explosion(this.x, this.y, 1.6);
      SFX.explo(this.x, this.y, 1.5);
      this.hp = 0; this.dead = true;
      game.players[this.owner].stats.unitsLost++;
      return;
    }
    if (!this.path || (this.repathT === undefined || (this.repathT -= dt) <= 0)) {
      this.repathT = 0.5;
      this.setPathTo(target.x, target.y);
    }
    this.moveAlongPath(dt, 1.0);
  }

  doHarvest(dt, o) {
    const p = game.players[this.owner];
    // full (or forced partial delivery) → deliver
    if (this.carrying >= this.def.capacity || (o.forceDeliver && this.carrying > 0)) {
      const dep = nearestOwnBuilding(this.owner, 'supply', this.x, this.y);
      if (!dep) { this.order = { type: 'guard' }; return; }
      const d = U.dist(this.x, this.y, dep.x, dep.y);
      if (d < dep.size * TILE * 0.62 + 26) {
        p.addMoney(this.carrying, true);
        if (this.owner === 0) { FX.text(this.x, this.y - 18, '+$' + this.carrying, '#ffd76a'); SFX.cash(); }
        this.carrying = 0;
        o.forceDeliver = false;
        this.path = null;
      } else {
        if (!this.path) this.setPathTo(dep.x, dep.y + dep.size * TILE * 0.35);
        this.moveAlongPath(dt);
      }
      return;
    }
    // find dock
    let dock = o.dock && o.dock.amount > 0 ? o.dock : null;
    if (!dock) dock = nearestDockWithSupplies(this.x, this.y);
    if (!dock) {
      if (this.carrying > 0) { o.forceDeliver = true; return; } // deliver the real partial load
      this.order = { type: 'guard' }; return;
    }
    o.dock = dock;
    const d = U.dist(this.x, this.y, dock.x, dock.y);
    if (d < TILE * 2.1) {
      // load up
      this.loadT += dt;
      this.path = null;
      if (this.loadT > 2.6) {
        this.loadT = 0;
        const take = Math.min(this.def.capacity - this.carrying, dock.amount);
        world.depleteDock(dock, take);
        this.carrying += take;
        if (dock.amount <= 0 && this.owner === 0) UI.feed('Supply pile exhausted', 'bad');
      }
    } else {
      if (!this.path) this.setPathTo(dock.x + U.rand(-20, 20), dock.y + U.rand(-20, 20));
      this.moveAlongPath(dt);
    }
  }

  doBuild(dt, o) {
    const site = game.byId.get(o.targetId);
    if (!site || site.dead || site.constructed) { this.nextOrder(); return; }
    const d = U.dist(this.x, this.y, site.x, site.y);
    const need = site.size * TILE * 0.5 + this.radius + 22;
    if (d > need) {
      if (!this.path) this.setPathTo(site.x, site.y);
      this.moveAlongPath(dt);
      return;
    }
    this.path = null;
    this.angle = U.turnToward(this.angle, U.angTo(this.x, this.y, site.x, site.y), 5 * dt);
    site.buildProgress += dt / site.def.buildTime;
    site.hp = Math.min(site.maxHp, site.hp + (site.maxHp * 0.9) * dt / site.def.buildTime);
    if (Math.random() < dt * 8) FX.sparks(site.x + U.rand(-site.size * 14, site.size * 14), site.y + U.rand(-site.size * 14, site.size * 14), 3);
    if (site.buildProgress >= 1) {
      site.finishConstruction();
      this.nextOrder();
    }
  }

  doRepair(dt, o) {
    const b = game.byId.get(o.targetId);
    if (!b || b.dead || b.hp >= b.maxHp) { this.nextOrder(); return; }
    const d = U.dist(this.x, this.y, b.x, b.y);
    const need = b.size * TILE * 0.5 + this.radius + 22;
    if (d > need) {
      if (!this.path) this.setPathTo(b.x, b.y);
      this.moveAlongPath(dt);
      return;
    }
    this.path = null;
    const p = game.players[this.owner];
    const rate = 55;
    if (p.money >= rate * dt * 0.2) {
      p.spend(rate * dt * 0.2);
      b.hp = Math.min(b.maxHp, b.hp + rate * dt);
      if (Math.random() < dt * 6) FX.sparks(b.x + U.rand(-b.size * 12, b.size * 12), b.y + U.rand(-b.size * 12, b.size * 12), 2);
    }
  }

  /* --------- jets --------- */
  updateJet(dt) {
    const def = this.def;
    // find home pad if lost
    if (!this.padId || !game.byId.get(this.padId) || game.byId.get(this.padId).dead) {
      this.padId = null;
      const af = nearestOwnBuilding(this.owner, 'airfield', this.x, this.y);
      if (af) this.padId = af.id;
    }
    const pad = this.padId ? game.byId.get(this.padId) : null;

    const flyToward = (tx, ty, sp) => {
      const want = U.angTo(this.x, this.y, tx, ty);
      this.angle = U.turnToward(this.angle, want, 2.6 * dt);
      this.x += Math.cos(this.angle) * sp * dt;
      this.y += Math.sin(this.angle) * sp * dt;
      this.x = U.clamp(this.x, 20, world.pw - 20);
      this.y = U.clamp(this.y, 20, world.ph - 20);
      if (sp > def.speed * 0.7 && Math.random() < dt * 22) {
        const wa = this.angle + Math.PI / 2;
        FX.contrail(this.x + Math.cos(wa) * 11 - Math.cos(this.angle) * 10,
                    this.y + Math.sin(wa) * 11 - Math.sin(this.angle) * 10);
        FX.contrail(this.x - Math.cos(wa) * 11 - Math.cos(this.angle) * 10,
                    this.y - Math.sin(wa) * 11 - Math.sin(this.angle) * 10);
      }
      return U.dist(this.x, this.y, tx, ty);
    };

    switch (this.jetState) {
      case 'idle': {
        const cx = pad ? pad.x : this.guardX, cy = pad ? pad.y : this.guardY;
        this.circleA += dt * 0.9;
        flyToward(cx + Math.cos(this.circleA) * 95, cy + Math.sin(this.circleA) * 95, def.speed * 0.55);
        // auto re-engage persist target
        if (this.persistTargetId) {
          const t = game.byId.get(this.persistTargetId);
          if (t && !t.dead && this.ammo > 0) this.jetState = 'attack';
          else this.persistTargetId = 0;
        }
        break;
      }
      case 'moveto': {
        const o = this.order;
        if (flyToward(o.x, o.y, def.speed) < 40) { this.jetState = 'idle'; this.guardX = this.x; this.guardY = this.y; this.order = { type: 'guard' }; }
        break;
      }
      case 'guardmove': {
        if (!this.guardPost) { this.jetState = 'idle'; break; }
        if (flyToward(this.guardPost.x, this.guardPost.y, def.speed) < 70) this.jetState = 'guardair';
        break;
      }
      case 'guardair': {
        const gp = this.guardPost;
        if (!gp) { this.jetState = 'idle'; break; }
        this.circleA += dt * 1.1;
        flyToward(gp.x + Math.cos(this.circleA) * 110, gp.y + Math.sin(this.circleA) * 110, def.speed * 0.6);
        if (!def.weapon) break;                       // unarmed recon: just orbit and watch
        if (this.ammo <= 0) { this.jetState = 'return'; break; }
        this.scanT -= dt;
        if (this.scanT <= 0) {
          this.scanT = 0.5;
          let best = null, bd = Infinity;
          const R = 460;
          for (const e of game.ents) {
            if (e.dead || !isEnemy(this, e)) continue;
            if (e.kind === 'building' && !e.constructed) continue;
            if (!weaponCanHit(def.weapon, e)) continue;
            if (isStealthed(e) && !isDetectedBy(e, game.players[this.owner].team)) continue;
            const d = U.dist2(gp.x, gp.y, e.x, e.y);
            if (d > R * R) continue;
            const score = d + (e.kind === 'building' ? 1e6 : 0);   // intruding units first
            if (score < bd) { bd = score; best = e; }
          }
          if (best) {
            this.order = { type: 'attack', targetId: best.id };
            this.jetState = 'attack';
            this.persistTargetId = best.id;
          }
        }
        break;
      }
      /* eslint-disable-next-line no-fallthrough */
      case 'attack': {
        const w = def.weapon;
        let t = game.byId.get(this.order.targetId || this.persistTargetId);

        /* burst-fire jets (multirole): pick another target near the strike area.
           Anchored on the current target's position, NOT the jet — a fast mover
           overshoots hundreds of px between shots and would lose the fight zone. */
        const reacquire = exclude => {
          const ax = t ? t.x : this.x, ay = t ? t.y : this.y;
          let best = null, bd = Infinity;
          const myTeam = game.players[this.owner].team;
          for (const e of game.ents) {
            if (e.dead || !isEnemy(this, e) || (exclude && e.id === exclude)) continue;
            if (e.kind === 'building' && !e.constructed) continue;
            if (e.kind === 'unit' && isStealthed(e) && !isDetectedBy(e, myTeam)) continue;
            if (!weaponCanHit(w, e)) continue;
            const dd = U.dist2(ax, ay, e.x, e.y);
            if (dd < 520 * 520 && dd < bd) { bd = dd; best = e; }
          }
          return best;
        };
        /* is this target already dead-in-the-air from missiles we launched at it?
           Per-target ledger; goes stale (and resets) 6 s after the last shot. */
        const doomed = tt => {
          const fresh = this._shots && game.t - (this._shotsT || 0) <= 6;
          const n = fresh ? (this._shots[tt.id] || 0) : 0;
          if (!n) return false;
          const mod = (DMG_MOD[w.dtype] && DMG_MOD[w.dtype][tt.armor]) ?? 1;
          const perShot = effDamage(w, this) * mod * (tt.kind === 'building' ? 0.3 : 0.7);
          return n * perShot >= tt.hp;
        };

        if (def.burst && t && !t.dead && doomed(t)) {
          const nt = reacquire(t.id);
          if (nt) {
            this.order = { type: 'attack', targetId: nt.id };
            this.persistTargetId = nt.id;
            t = nt;
          } else {
            // nothing else worth a missile — bank the rest of the ammo
            this.persistTargetId = 0;
            this.jetState = this.guardPost ? 'guardmove' : (pad ? 'return' : 'idle');
            break;
          }
        }

        if (!w || !t || t.dead || !weaponCanHit(w, t)) {
          // a multirole with ammo keeps hunting nearby targets before heading home
          const nt = def.burst && this.ammo > 0 ? reacquire(0) : null;
          if (nt) {
            this.order = { type: 'attack', targetId: nt.id };
            this.persistTargetId = nt.id;
            break;
          }
          this.persistTargetId = 0;
          this.jetState = pad ? 'return' : (this.guardPost ? 'guardmove' : 'idle');
          break;
        }
        if (this.ammo <= 0) { this.jetState = 'return'; break; }
        const d = flyToward(t.x, t.y, def.speed);
        if (d < w.range && this.cool <= 0) {
          this.cool = w.cd;
          fireWeapon(this, w, t);
          this.ammo--;
          if (def.decloakOnFire) this.decloakUntil = game.t + def.decloakOnFire;
          if (!this._shots || game.t - (this._shotsT || 0) > 6) this._shots = {};
          this._shots[t.id] = (this._shots[t.id] || 0) + 1;
          this._shotsT = game.t;
          // end of a controlled burst: re-evaluate targets instead of dumping the rack
          if (def.burst && this._shots[t.id] % def.burst === 0) {
            this.cool = Math.max(this.cool, w.cd * 2.2);
            const nt = reacquire(doomed(t) ? t.id : 0);
            if (nt && nt.id !== t.id && (doomed(t) || U.dist2(this.x, this.y, nt.x, nt.y) < U.dist2(this.x, this.y, t.x, t.y))) {
              this.order = { type: 'attack', targetId: nt.id };
              this.persistTargetId = nt.id;
            }
          }
          if (this.ammo <= 0) this.jetState = 'return';
        }
        break;
      }
      case 'return': {
        if (!pad) { this.jetState = this.guardPost && this.ammo > 0 ? 'guardmove' : 'idle'; break; }
        const d = flyToward(pad.x, pad.y, def.speed);
        if (d < 40) { this.jetState = 'rearm'; this.rearmT = 0; }
        break;
      }
      case 'rearm': {
        if (!pad) { this.jetState = this.guardPost ? 'guardmove' : 'idle'; break; }
        this.x = U.lerp(this.x, pad.x, dt * 4); this.y = U.lerp(this.y, pad.y, dt * 4);
        this.rearmT += dt;
        if (this.rearmT > 4) {
          this.ammo = def.ammo;
          if (this.persistTargetId && game.byId.get(this.persistTargetId) && !game.byId.get(this.persistTargetId).dead) {
            this.jetState = 'attack'; this.order = { type: 'attack', targetId: this.persistTargetId };
          } else if (this.guardPost) {
            this.jetState = 'guardmove'; this.persistTargetId = 0;   // rearmed — back to the patrol post
          } else { this.jetState = 'idle'; this.persistTargetId = 0; }
        }
        break;
      }
    }
  }
}

/* =====================================================================
   BUILDING
===================================================================== */
class Building {
  constructor(owner, key, tx, ty, prebuilt) {
    this.id = ENT_ID++;
    this.kind = 'building';
    this.owner = owner;
    this.key = key;
    this.def = BUILDINGS[key];
    this.tx = tx; this.ty = ty;
    this.size = this.def.size;
    this.x = (tx + this.size / 2) * TILE;
    this.y = (ty + this.size / 2) * TILE;
    this.maxHp = this.def.hp;
    this.armor = 'building';
    this.dead = false;
    this.constructed = !!prebuilt;
    this.buildProgress = prebuilt ? 1 : 0;
    this.hp = prebuilt ? this.maxHp : this.maxHp * 0.1;
    this.queue = [];                       // production {key, prog}
    this.rallyX = this.x; this.rallyY = this.y + this.size * TILE * 0.7 + 20;
    this.cool = 0; this.tAngle = 0;
    this.scanT = Math.random() * 0.4;
    this.swTimer = this.def.swTimer || 0;
    this.swReady = false;
    this.incomeAcc = 0;
    world.blockRect(tx, ty, this.size, true);
    if (prebuilt) recomputePower(owner);
  }

  finishConstruction() {
    this.constructed = true;
    this.buildProgress = 1;
    this.hp = this.maxHp;
    recomputePower(this.owner);
    const p = game.players[this.owner];
    if (this.owner === 0) {
      UI.feed(bName(this.key, p.faction) + ' complete');
      SFX.build(); SFX.say('Construction complete');
      UI.refreshCmd();
    }
    if (this.key === 'superweapon') {
      const sameTeam = p.team === game.players[0].team;
      if (this.owner === 0) UI.feed('Superweapon construction complete', 'gold');
      else if (sameTeam) UI.feed('Allied superweapon online', 'gold');
      else {
        UI.feed('⚠ ENEMY SUPERWEAPON DETECTED', 'bad');
        SFX.klaxon(); SFX.say('Warning. Enemy superweapon detected', true);
      }
    }
    if (p.isAI) AI.onBuildingDone(this);
  }

  get powered() {
    const p = game.players[this.owner];
    return !FACTIONS[p.faction].usesPower || !p.lowPower;
  }

  update(dt) {
    if (!this.constructed) return;
    const p = game.players[this.owner];

    // sabotaged: everything offline until the timer runs out
    if (this.disabledUntil && game.t < this.disabledUntil) {
      if (Math.random() < dt * 3) FX.smokePuff(this.x + U.rand(-this.size * 10, this.size * 10), this.y, 1, true);
      return;
    }

    // repair bay: heal nearby friendly vehicles & aircraft
    if (this.key === 'repairbay') {
      const R = this.def.healRadius, rate = this.def.healRate * (this.powered ? 1 : 0.5);
      for (const e of game.ents) {
        if (e.dead || e.kind !== 'unit' || e.hp >= e.maxHp) continue;
        const ep = game.players[e.owner];
        if (!ep || ep.team !== p.team) continue;
        if (e.def.chassis === 'inf' || e.def.chassis === 'rocketinf') continue;
        if (U.dist2(this.x, this.y, e.x, e.y) > R * R) continue;
        // veteran crews work with the mechanics — repairs speed up per star
        e.hp = Math.min(e.maxHp, e.hp + rate * (1 + e.vetRank * 0.25) * dt);
        if (Math.random() < dt * 1.5) FX.sparks(e.x + U.rand(-9, 9), e.y + U.rand(-9, 9), 2);
      }
    }

    // production
    if (this.queue.length) {
      const it = this.queue[0];
      const udef = UNITS[it.key];
      const mul = this.powered ? 1 : 0.4;
      it.prog += dt / udef.buildTime * mul;
      if (it.prog >= 1) {
        this.queue.shift();
        const spot = findSpawnSpot(this);
        const u = new Unit(this.owner, it.key, spot.x, spot.y);
        game.addEnt(u);
        p.stats.unitsBuilt++;
        if (udef.air) { u.padId = this.id; u.jetState = 'idle'; }
        else if (udef.harvester) u.giveOrder({ type: 'harvest' });
        else u.giveOrder({ type: 'attackmove', x: this.rallyX, y: this.rallyY });
        if (this.owner === 0) { SFX.ready(); UI.refreshCmd(); }
        if (game.players[this.owner] && game.players[this.owner].isAI) AI.onUnitDone(u);
      }
    }

    // market income
    if (this.def.income) {
      this.incomeAcc += this.def.income * dt * (this.powered ? 1 : 0.5);
      if (this.incomeAcc >= 20) {
        p.addMoney(this.incomeAcc, true);
        if (this.owner === 0) FX.text(this.x, this.y - this.size * 14, '+$20', '#c9e8a0');
        this.incomeAcc = 0;
      }
    }

    // superweapon countdown
    if (this.key === 'superweapon' && !this.swReady) {
      if (this.powered) this.swTimer -= dt;
      if (this.swTimer <= 0) {
        this.swReady = true;
        if (this.owner === 0) { UI.feed('SUPERWEAPON READY — select it on the top bar', 'gold'); SFX.klaxon(); SFX.say('Superweapon ready', true); }
        else { UI.feed('⚠ ENEMY SUPERWEAPON READY', 'bad'); SFX.klaxon(); SFX.say('Warning. Enemy superweapon launch imminent', true); }
      }
    }

    // defensive turret
    const w = this.def.weaponByFaction ? this.def.weaponByFaction[p.faction] : null;
    if (w) {
      if (this.cool > 0) this.cool -= dt;
      if (w.needsPower && !this.powered) return;
      this.scanT -= dt;
      if (this.scanT <= 0 || this.targetId) {
        this.scanT = 0.4;
        let t = this.targetId ? game.byId.get(this.targetId) : null;
        if (!t || t.dead || U.dist(this.x, this.y, t.x, t.y) > w.range * 1.05 || !weaponCanHit(w, t)) {
          t = null; this.targetId = 0;
          let bd = Infinity;
          for (const e of game.ents) {
            if (e.dead || !isEnemy(this, e) || e.kind !== 'unit') continue;
            if (!weaponCanHit(w, e)) continue;
            if (isStealthed(e) && !isDetectedBy(e, game.players[this.owner].team)) continue;
            const d = U.dist(this.x, this.y, e.x, e.y);
            if (d < w.range && d < bd) { bd = d; t = e; }
          }
          if (t) this.targetId = t.id;
        }
        if (t) {
          const want = U.angTo(this.x, this.y, t.x, t.y);
          this.tAngle = U.turnToward(this.tAngle, want, 5 * dt * 8);
          if (this.cool <= 0 && Math.abs(U.angDiff(this.tAngle, want)) < 0.3) {
            this.cool = w.cd;
            fireWeapon(this, w, t);
          }
        }
      }
    }
  }

  enqueue(key) {
    const p = game.players[this.owner];
    const cost = UNITS[key].cost;
    if (p.money < cost) return false;
    if (this.queue.length >= 7) return false;
    p.spend(cost);
    this.queue.push({ key, prog: 0, cost });
    return true;
  }

  cancelQueued(i) {
    const it = this.queue[i];
    if (!it) return;
    game.players[this.owner].money += it.cost;
    this.queue.splice(i, 1);
  }

  sell() {
    const p = game.players[this.owner];
    p.addMoney(Math.floor(this.def.cost * (this.constructed ? 0.5 : 0.75)));
    for (const it of this.queue) p.money += it.cost;
    this.queue.length = 0;
    this.dead = true;
    world.blockRect(this.tx, this.ty, this.size, false);
    FX.smokePuff(this.x, this.y, 10);
    recomputePower(this.owner);
    if (this.owner === 0) UI.refreshCmd();
  }
}

/* find open spot next to a building for a fresh unit */
function findSpawnSpot(b) {
  const t0x = b.tx, t0y = b.ty, s = b.size;
  for (let ring = 0; ring < 5; ring++) {
    for (let i = -ring; i < s + ring; i++) {
      const cands = [
        { tx: t0x + i, ty: t0y + s + ring },     // below
        { tx: t0x + i, ty: t0y - 1 - ring },     // above
        { tx: t0x - 1 - ring, ty: t0y + i },     // left
        { tx: t0x + s + ring, ty: t0y + i },     // right
      ];
      for (const c of cands) {
        if (world.passable(c.tx, c.ty)) return { x: (c.tx + 0.5) * TILE, y: (c.ty + 0.5) * TILE };
      }
    }
  }
  return { x: b.x, y: b.y + s * TILE };
}

function nearestOwnBuilding(owner, key, x, y) {
  let best = null, bd = Infinity;
  for (const e of game.ents) {
    if (e.dead || e.kind !== 'building' || e.owner !== owner || !e.constructed) continue;
    if (key && e.key !== key) continue;
    const d = U.dist2(x, y, e.x, e.y);
    if (d < bd) { bd = d; best = e; }
  }
  return best;
}

function nearestDockWithSupplies(x, y) {
  let best = null, bd = Infinity;
  for (const d of world.docks) {
    if (d.amount <= 0) continue;
    const dd = U.dist2(x, y, d.x, d.y);
    if (dd < bd) { bd = dd; best = d; }
  }
  return best;
}

/* =====================================================================
   WEAPON FIRE + PROJECTILES
===================================================================== */
function fireWeapon(src, w, target) {
  const ang = U.angTo(src.x, src.y, target.x, target.y);
  const muzX = src.x + Math.cos(src.tAngle !== undefined ? src.tAngle : ang) * (src.kind === 'building' ? src.size * 12 : (src.def.radius + 6));
  const muzY = src.y + Math.sin(src.tAngle !== undefined ? src.tAngle : ang) * (src.kind === 'building' ? src.size * 12 : (src.def.radius + 6));
  const dmg = effDamage(w, src);
  const srcAir = src.kind === 'unit' && !!src.def.air;   // air-delivered: units 70%, buildings 30%

  switch (w.projectile) {
    case 'tracer':
    case 'bullet': {
      FX.muzzle(muzX, muzY, ang, false);
      FX.addBeam(muzX, muzY, target.x + U.rand(-4, 4), target.y + U.rand(-4, 4), 1.2, '#ffe9a0', 0.08);
      if (w.dtype === 'gatling') SFX.gatling(src.x, src.y); else SFX.shot(src.x, src.y);
      applyDamage(target, dmg, w.dtype, src, srcAir);
      if (target.kind === 'unit' && target.def.chassis === 'inf') {} else FX.sparks(target.x, target.y, 2);
      break;
    }
    case 'flame': {
      FX.flame(muzX, muzY, ang);
      SFX.flame(src.x, src.y);
      dealSplash(target.x, target.y, dmg, 'flame', w.splash || 18, src.owner, src, false, srcAir);
      break;
    }
    case 'shell': {
      FX.muzzle(muzX, muzY, ang, true);
      SFX.cannon(src.x, src.y);
      game.projs.push({ kind: 'shell', x: muzX, y: muzY, tx: target.x, ty: target.y,
        speed: 460, dmg, dtype: w.dtype, splash: w.splash || 24, owner: src.owner, srcId: src.id, srcAir, dead: false });
      if (src.kind === 'unit') src.recoil = 1;
      break;
    }
    case 'missile': {
      SFX.rocket(src.x, src.y);
      game.projs.push({ kind: 'missile', x: muzX, y: muzY, targetId: target.id, tx: target.x, ty: target.y,
        speed: 210, maxSpeed: 420, dmg, dtype: w.dtype, splash: w.splash || 20, owner: src.owner, srcId: src.id,
        srcAir, aaShot: srcAir && target.kind === 'unit' && !!target.def.air,
        ang: ang + U.rand(-0.6, 0.6), dead: false, t: 0 });
      break;
    }
    case 'arty': {
      FX.muzzle(muzX, muzY, ang, true);
      SFX.cannon(src.x, src.y);
      const dist = U.dist(src.x, src.y, target.x, target.y);
      const fly = U.clamp(dist / 260, 0.9, 2.2);
      const spread = 26;
      game.projs.push({ kind: 'arty', x: muzX, y: muzY, sx: muzX, sy: muzY,
        tx: target.x + U.rand(-spread, spread), ty: target.y + U.rand(-spread, spread),
        fly, t: 0, dmg, dtype: w.dtype, splash: w.splash || 40, owner: src.owner, srcId: src.id, srcAir, dead: false });
      break;
    }
    case 'flakburst': {
      FX.muzzle(muzX, muzY, ang, false);
      SFX.shot(src.x, src.y);
      game.projs.push({ kind: 'flak', x: muzX, y: muzY, targetId: target.id, tx: target.x, ty: target.y,
        speed: 520, dmg, dtype: w.dtype, splash: w.splash || 20, owner: src.owner, srcId: src.id, dead: false });
      break;
    }
    case 'napalm': {
      game.projs.push({ kind: 'napalm', x: src.x, y: src.y, tx: target.x, ty: target.y, z: 60, t: 0, fly: 0.7,
        sx: src.x, sy: src.y, dmg, dtype: 'flame', splash: w.splash || 60, owner: src.owner, srcId: src.id, srcAir, dead: false });
      SFX.rocket(src.x, src.y);
      break;
    }
  }
}

function updateProjectiles(dt) {
  const projs = game.projs;
  for (let i = projs.length - 1; i >= 0; i--) {
    const p = projs[i];
    switch (p.kind) {
      case 'shell': {
        const d = U.dist(p.x, p.y, p.tx, p.ty);
        const step = p.speed * dt;
        if (d <= step) {
          dealSplash(p.tx, p.ty, p.dmg, p.dtype, p.splash, p.owner, game.byId.get(p.srcId), false, p.srcAir);
          FX.explosion(p.tx, p.ty, 0.55);
          SFX.explo(p.tx, p.ty, 0.5);
          p.dead = true;
        } else {
          const a = U.angTo(p.x, p.y, p.tx, p.ty);
          p.x += Math.cos(a) * step; p.y += Math.sin(a) * step;
        }
        break;
      }
      case 'missile': {
        p.t += dt;
        const t = p.targetId ? game.byId.get(p.targetId) : null;
        if (t && !t.dead) { p.tx = t.x; p.ty = t.y; }
        p.speed = Math.min(p.maxSpeed, p.speed + 500 * dt);
        const want = U.angTo(p.x, p.y, p.tx, p.ty);
        p.ang = U.turnToward(p.ang, want, 7 * dt);
        p.x += Math.cos(p.ang) * p.speed * dt;
        p.y += Math.sin(p.ang) * p.speed * dt;
        if (Math.random() < dt * 28) FX.smokePuff(p.x, p.y, 1);
        const d = U.dist(p.x, p.y, p.tx, p.ty);
        if (d < 14 || p.t > 4) {
          const src = game.byId.get(p.srcId);
          // big ground-strike blasts must not swat aircraft (jet wings would kill each other);
          // an air-to-air shot always damages its aircraft target directly
          if (t && !t.dead && d < 26 && (p.splash <= 24 || p.aaShot)) applyDamage(t, p.dmg, p.dtype, src, p.srcAir);
          else dealSplash(p.tx, p.ty, p.dmg, p.dtype, p.splash, p.owner, src, p.splash <= 24, p.srcAir);
          const fxs = Math.min(3, 0.5 + p.splash / 90);
          FX.explosion(p.x, p.y, fxs);
          SFX.explo(p.x, p.y, fxs);
          p.dead = true;
        }
        break;
      }
      case 'flak': {
        const t = p.targetId ? game.byId.get(p.targetId) : null;
        if (t && !t.dead) { p.tx = t.x; p.ty = t.y; }
        const d = U.dist(p.x, p.y, p.tx, p.ty);
        const step = p.speed * dt;
        if (d <= step + 6) {
          dealSplash(p.tx, p.ty, p.dmg, p.dtype, p.splash, p.owner, game.byId.get(p.srcId), true);
          FX.explosion(p.tx, p.ty, 0.35);
          p.dead = true;
        } else {
          const a = U.angTo(p.x, p.y, p.tx, p.ty);
          p.x += Math.cos(a) * step; p.y += Math.sin(a) * step;
        }
        break;
      }
      case 'arty': {
        p.t += dt;
        const k = Math.min(1, p.t / p.fly);
        p.x = U.lerp(p.sx, p.tx, k);
        p.y = U.lerp(p.sy, p.ty, k);
        p.z = Math.sin(k * Math.PI) * 90;
        if (Math.random() < dt * 20) FX.smokePuff(p.x, p.y - p.z, 1);
        if (k >= 1) {
          dealSplash(p.tx, p.ty, p.dmg, p.dtype, p.splash, p.owner, game.byId.get(p.srcId), false, p.srcAir);
          FX.explosion(p.tx, p.ty, 0.9);
          SFX.explo(p.tx, p.ty, 0.9);
          p.dead = true;
        }
        break;
      }
      case 'napalm': {
        p.t += dt;
        const k = Math.min(1, p.t / p.fly);
        p.x = U.lerp(p.sx, p.tx, k);
        p.y = U.lerp(p.sy, p.ty, k);
        p.z = 60 * (1 - k * k);
        if (k >= 1) {
          dealSplash(p.tx, p.ty, p.dmg, 'flame', p.splash, p.owner, game.byId.get(p.srcId), false, p.srcAir);
          const fxs = Math.min(3.5, 1 + p.splash / 80);
          FX.explosion(p.tx, p.ty, fxs);
          const nf = Math.min(30, Math.round(p.splash / 8));
          for (let f = 0; f < nf; f++) FX.flame(p.tx + U.rand(-p.splash * 0.8, p.splash * 0.8), p.ty + U.rand(-p.splash * 0.8, p.splash * 0.8), -Math.PI / 2);
          SFX.explo(p.tx, p.ty, Math.min(2, fxs));
          p.dead = true;
        }
        break;
      }
      case 'bomb': { // powers: falling bomb / beam strike at fixed point
        p.t += dt;
        if (p.t >= p.fly) {
          dealSplash(p.tx, p.ty, p.dmg, p.dtype, p.splash, p.owner, null, !!p.beam);
          FX.explosion(p.tx, p.ty, p.fxSize || 1.2);
          if (p.beam) FX.addBeam(p.tx, p.ty - 720, p.tx, p.ty, 11, '#bfe8ff', 0.5);
          SFX.explo(p.tx, p.ty, p.fxSize || 1.2);
          p.dead = true;
        }
        break;
      }
    }
    if (p.dead) projs.splice(i, 1);
  }
}

/* unit separation — keep ground units from stacking */
function separateUnits() {
  const units = [];
  for (const e of game.ents) if (e.kind === 'unit' && !e.dead && !e.def.air) units.push(e);
  // simple spatial buckets
  const cell = 48, buckets = new Map();
  for (const u of units) {
    const k = (Math.floor(u.x / cell)) + ',' + (Math.floor(u.y / cell));
    let b = buckets.get(k);
    if (!b) { b = []; buckets.set(k, b); }
    b.push(u);
  }
  for (const u of units) {
    const cx = Math.floor(u.x / cell), cy = Math.floor(u.y / cell);
    for (let by = cy - 1; by <= cy + 1; by++) for (let bx = cx - 1; bx <= cx + 1; bx++) {
      const b = buckets.get(bx + ',' + by);
      if (!b) continue;
      for (const v of b) {
        if (v === u || v.id <= u.id) continue;
        const minD = u.radius + v.radius;
        const dx = v.x - u.x, dy = v.y - u.y;
        const d2 = dx * dx + dy * dy;
        if (d2 < minD * minD && d2 > 0.01) {
          const d = Math.sqrt(d2), push = (minD - d) / 2;
          const nx = dx / d, ny = dy / d;
          // moving units push idle ones aside
          const uMove = u.moving ? 0.35 : 1, vMove = v.moving ? 0.35 : 1;
          const ux = u.x - nx * push * uMove, uy = u.y - ny * push * uMove;
          const vx2 = v.x + nx * push * vMove, vy2 = v.y + ny * push * vMove;
          if (world.passableWorld(ux, uy)) { u.x = ux; u.y = uy; }
          if (world.passableWorld(vx2, vy2)) { v.x = vx2; v.y = vy2; }
        }
      }
    }
  }
}
