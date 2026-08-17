/* ============ powers.js — General's Powers & superweapon strikes ============ */
'use strict';
const POWERS_SYS = (() => {

  function canUnlock(p, key) {
    const def = POWERS[key];
    const rankNeed = def.tier === 1 ? 1 : def.tier === 2 ? 3 : 5;
    return p.rank >= rankNeed && p.powerPoints >= 1 && !p.unlocked[key];
  }

  function unlock(pi, key) {
    const p = game.players[pi];
    if (!canUnlock(p, key)) return false;
    p.powerPoints--;
    p.unlocked[key] = true;
    p.cooldowns[key] = 0;
    if (pi === 0) { UI.feed(POWERS[key].name + ' unlocked', 'gold'); SFX.ready(); UI.refreshPowers(); }
    return true;
  }

  function isReady(p, key) {
    return p.unlocked[key] && (p.cooldowns[key] || 0) <= 0;
  }

  function activate(pi, key, x, y) {
    const p = game.players[pi];
    if (!isReady(p, key)) return false;
    p.cooldowns[key] = POWERS[key].cd;
    execute(pi, key, x, y);
    if (isEnemyOfHumanPlayer(pi) && world.isExplored(x, y)) UI.feed('⚠ Enemy ' + POWERS[key].name + ' inbound!', 'bad');
    return true;
  }

  function isEnemyOfHumanPlayer(pi) {
    const p = game.players[pi];
    return p && p.team !== game.players[0].team;
  }

  function execute(pi, key, x, y) {
    switch (key) {
      case 'recon':
        world.addReveal(x, y, 330, 25);
        FX.text(x, y, '◈ RECON SWEEP ◈', '#7fd4ff');
        if (pi === 0) SFX.ready();
        break;

      case 'airstrike': {
        // two jets run in line abreast, three bombs each along the attack heading
        const S = POWER_STRIKES.airstrike;
        launchSortie(pi, x, y, 2, 70, (ang, i) => {
          const out = [];
          for (let b = 0; b < 3; b++) {
            const off = (b - 1) * 55;
            out.push({ x: x + Math.cos(ang) * off + U.rand(-18, 18),
              y: y + Math.sin(ang) * off + (i - 0.5) * 60 + U.rand(-18, 18),
              fly: 0.5 + b * 0.22, dmg: S.dmg, splash: S.splash, fxSize: S.fxSize });
          }
          return out;
        });
        strikeWarning(pi, x, y, 90);
        break;
      }

      case 'thermobomb': {
        const S = POWER_STRIKES.thermobomb;
        launchSortie(pi, x, y, 1, 0, () =>
          [{ x, y, fly: 1.6, dmg: S.dmg, splash: S.splash, fxSize: S.fxSize }]);
        strikeWarning(pi, x, y, 190);
        if (world.isVisible(x, y)) SFX.klaxon();
        break;
      }

      case 'supplydrop': {
        const p = game.players[pi];
        for (let i = 0; i < 4; i++) FX.chute(x + U.rand(-45, 45), y + U.rand(-45, 45));
        p.addMoney(1200);
        if (pi === 0) { FX.text(x, y, '📦 +$1,200', '#ffd76a'); SFX.cash(); }
        break;
      }

      case 'paradrop': {
        const p = game.players[pi];
        const infKey = p.faction === 'dynasty' ? 'rifleman' : p.faction === 'coalition' ? 'ranger' : 'raider';
        const rktKey = p.faction === 'dynasty' ? 'rpg' : p.faction === 'coalition' ? 'rocketeer' : 'rocketraider';
        const drops = [infKey, infKey, infKey, infKey, infKey, infKey, rktKey, rktKey];
        for (const k of drops) {
          const sp = PATH.nearestOpen(world, Math.floor((x + U.rand(-70, 70)) / TILE), Math.floor((y + U.rand(-70, 70)) / TILE), 8);
          if (!sp) continue;
          const u = new Unit(pi, k, (sp.tx + 0.5) * TILE, (sp.ty + 0.5) * TILE);
          game.addEnt(u);
          game.players[pi].stats.unitsBuilt++;
          FX.chute((sp.tx + 0.5) * TILE, (sp.ty + 0.5) * TILE);
        }
        FX.text(x, y, '🪂 AIRBORNE ASSAULT', '#c9e8a0');
        break;
      }

      case 'frenzy': {
        game.players[pi].frenzyUntil = game.t + 30;
        if (pi === 0) { UI.announce('🔥 WAR FRENZY 🔥'); SFX.promote(); }
        else if (isEnemyOfHumanPlayer(pi)) UI.feed('⚠ Enemy forces are frenzied (+30% damage)!', 'bad');
        break;
      }

      case 'sabotage': {
        let n = 0;
        for (const e of game.ents) {
          if (e.dead || e.kind !== 'building' || !e.constructed) continue;
          const pe = game.players[e.owner];
          if (!pe || pe.team === game.players[pi].team) continue;
          if (U.dist(x, y, e.x, e.y) < 175) {
            e.disabledUntil = game.t + 25;
            applyDamage(e, 150, 'explosive', null);
            FX.smokePuff(e.x, e.y, 10, true);
            n++;
          }
        }
        if (pi === 0) FX.text(x, y, n ? '🔌 ' + n + ' STRUCTURES SABOTAGED' : 'No targets in range', '#e8c96a');
        if (n && isEnemyOfHumanPlayer(pi)) UI.feed('⚠ Our structures have been sabotaged!', 'bad');
        break;
      }

      case 'barrage': {
        for (let i = 0; i < 10; i++) {
          const px = x + U.rand(-95, 95), py = y + U.rand(-95, 95);
          game.projs.push({ kind: 'bomb', tx: px, ty: py, t: 0, fly: 0.8 + i * 0.28,
            dmg: POWER_STRIKES.barrage.dmg, dtype: 'explosive', splash: POWER_STRIKES.barrage.splash,
            owner: pi, dead: false, x: px, y: py, fxSize: POWER_STRIKES.barrage.fxSize });
        }
        strikeWarning(pi, x, y, 100);
        break;
      }

      case 'reinforce': {
        const p = game.players[pi];
        const tankKey = p.faction === 'dynasty' ? 'warlord' : p.faction === 'coalition' ? 'bulwark' : 'jackal';
        const infKey = p.faction === 'dynasty' ? 'rifleman' : p.faction === 'coalition' ? 'ranger' : 'raider';
        const drops = [[0, 0, tankKey], [50, 30, tankKey], [-45, 25, infKey], [35, -40, infKey], [-30, -35, infKey], [60, -10, infKey]];
        for (const [dx, dy, k] of drops) {
          const sp = PATH.nearestOpen(world, Math.floor((x + dx) / TILE), Math.floor((y + dy) / TILE), 8);
          if (!sp) continue;
          const u = new Unit(pi, k, (sp.tx + 0.5) * TILE, (sp.ty + 0.5) * TILE);
          game.addEnt(u);
          game.players[pi].stats.unitsBuilt++;
          FX.chute((sp.tx + 0.5) * TILE, (sp.ty + 0.5) * TILE);
        }
        FX.text(x, y, '🪂 REINFORCEMENTS', '#c9e8a0');
        break;
      }

      case 'carpet': {
        // the stick falls along the bomber's own heading, so the line follows the plane
        const S = POWER_STRIKES.carpet;
        launchSortie(pi, x, y, 1, 0, ang => {
          const out = [];
          for (let i = 0; i < 12; i++) {
            const off = (i - 5.5) * 45;
            out.push({ x: x + Math.cos(ang) * off + U.rand(-12, 12),
              y: y + Math.sin(ang) * off + U.rand(-12, 12),
              fly: 0.6 + i * 0.16, dmg: S.dmg, splash: S.splash, fxSize: S.fxSize });
          }
          return out;
        });
        strikeWarning(pi, x, y, 260);
        break;
      }

      case 'ambush': {
        for (let i = 0; i < 6; i++) {
          const sp = PATH.nearestOpen(world, Math.floor((x + U.rand(-60, 60)) / TILE), Math.floor((y + U.rand(-60, 60)) / TILE), 8);
          if (!sp) continue;
          const u = new Unit(pi, 'raider', (sp.tx + 0.5) * TILE, (sp.ty + 0.5) * TILE);
          u.vetRank = 1; u.maxHp = Math.round(u.def.hp * VET_HP[1]); u.hp = u.maxHp;
          game.addEnt(u);
          game.players[pi].stats.unitsBuilt++;
          FX.smokePuff((sp.tx + 0.5) * TILE, (sp.ty + 0.5) * TILE, 5);
        }
        FX.text(x, y, '🎭 AMBUSH!', '#e8c96a');
        break;
      }

      case 'demo': {
        for (let i = 0; i < 10; i++) {
          const px = x + U.rand(-90, 90), py = y + U.rand(-90, 90);
          game.projs.push({ kind: 'bomb', tx: px, ty: py, t: 0, fly: 0.7 + i * 0.3,
            dmg: POWER_STRIKES.demo.dmg, dtype: 'explosive', splash: POWER_STRIKES.demo.splash,
            owner: pi, dead: false, x: px, y: py, fxSize: POWER_STRIKES.demo.fxSize });
        }
        strikeWarning(pi, x, y, 100);
        break;
      }

      case 'vengeance': {
        for (let wave = 0; wave < 3; wave++) {
          for (let i = 0; i < 7; i++) {
            const px = x + U.rand(-110, 110), py = y + U.rand(-110, 110);
            game.projs.push({ kind: 'bomb', tx: px, ty: py, t: 0, fly: 0.9 + wave * 2.0 + i * 0.22,
              dmg: POWER_STRIKES.vengeance.dmg, dtype: 'explosive', splash: POWER_STRIKES.vengeance.splash,
              owner: pi, dead: false, x: px, y: py, fxSize: POWER_STRIKES.vengeance.fxSize });
          }
        }
        strikeWarning(pi, x, y, 130);
        break;
      }
    }
  }

  /* Fly a strike in from off-map. The aircraft are ordinary damageable units on a
     scripted one-way run, so anti-air gets a chance at them and a flight destroyed
     short of its release point drops nothing. `makePayload(ang, i)` is handed the
     attack heading so a bomb line can follow the aircraft that lays it. */
  function launchSortie(pi, x, y, count, abreast, makePayload) {
    const ang = U.rand(0, Math.PI * 2);
    const IN = 1100;                      // stand-off start, a few seconds of run-in
    const nx = Math.cos(ang + Math.PI / 2), ny = Math.sin(ang + Math.PI / 2);
    for (let i = 0; i < count; i++) {
      const off = (i - (count - 1) / 2) * abreast;
      const aimX = x + nx * off, aimY = y + ny * off;
      const u = new Unit(pi, 'sortie', aimX - Math.cos(ang) * IN, aimY - Math.sin(ang) * IN);
      u.angle = ang;
      u.sortieRun = {
        tx: aimX, ty: aimY,
        ex: aimX + Math.cos(ang) * IN, ey: aimY + Math.sin(ang) * IN,
        phase: 'in', releaseAt: 60, payload: makePayload(ang, i),
      };
      u.ammo = u.sortieRun.payload.length;   // drawn as a slung bomb until released
      game.addEnt(u);
    }
    if (world.isVisible(x, y)) SFX.jetpass(x, y);
  }

  function strikeWarning(pi, x, y, r) {
    if (isEnemyOfHumanPlayer(pi) && world.isExplored(x, y)) {
      UI.ping(x, y, '#ff5540');
      SFX.alarm();
    }
  }

  /* ---------------- superweapons ---------------- */
  function fireSuperweapon(pi, silo, x, y) {
    if (!silo.swReady) return false;
    silo.swReady = false;
    silo.swTimer = silo.def.swTimer;
    const p = game.players[pi];
    const kind = BUILDINGS.superweapon.swByFaction[p.faction];
    const hostile = isEnemyOfHumanPlayer(pi);
    UI.feed(pi === 0 ? SUPERWEAPONS[kind].name + ' launched!' :
      hostile ? '⚠⚠ ENEMY SUPERWEAPON LAUNCHED ⚠⚠' : 'Allied ' + SUPERWEAPONS[kind].name + ' launched',
      hostile ? 'bad' : 'gold');
    if (hostile) { SFX.klaxon(); SFX.say('Warning. Incoming superweapon', true); UI.ping(x, y, '#ff2200'); }

    switch (kind) {
      case 'nuke':
        game.nukes.push({ x, y, t: 0, fly: 6, owner: pi });
        break;
      case 'solaris': {
        // sweeping beam: sequence of beam strikes marching across the area
        const sw = SUPERWEAPONS.solaris;
        const ang = U.rand(0, Math.PI * 2);
        for (let i = 0; i < sw.shots; i++) {
          const off = (i - (sw.shots - 1) / 2) * sw.spread;
          const px = x + Math.cos(ang) * off, py = y + Math.sin(ang) * off;
          game.projs.push({ kind: 'bomb', tx: px, ty: py, t: 0, fly: 2.5 + i * 0.32,
            dmg: sw.dmg, dtype: 'beam', splash: sw.splash, owner: pi, dead: false, x: px, y: py, fxSize: 1.35, beam: true });
        }
        game.beamStrikes.push({ x, y, ang, t: 0, dur: sw.shots * 0.32 + 2.5, spread: sw.spread });
        SFX.beam(x, y);
        break;
      }
      case 'rocketstorm': {
        const sw = SUPERWEAPONS.rocketstorm;
        for (let i = 0; i < sw.shots; i++) {
          const px = x + U.rand(-sw.spread, sw.spread), py = y + U.rand(-sw.spread, sw.spread);
          game.projs.push({ kind: 'bomb', tx: px, ty: py, t: 0, fly: 1.5 + i * 0.33,
            dmg: sw.dmg, dtype: 'explosive', splash: sw.splash, owner: pi, dead: false, x: px, y: py, fxSize: 1.2 });
        }
        break;
      }
    }
    return true;
  }

  function updateNukes(dt) {
    for (let i = game.nukes.length - 1; i >= 0; i--) {
      const n = game.nukes[i];
      n.t += dt;
      if (n.t >= n.fly) {
        FX.nukeExplosion(n.x, n.y);
        SFX.bigExplo(n.x, n.y);
        dealSplash(n.x, n.y, SUPERWEAPONS.nuke.dmg, 'explosive', SUPERWEAPONS.nuke.splash, n.owner, null);
        game.nukes.splice(i, 1);
      }
    }
    for (let i = game.beamStrikes.length - 1; i >= 0; i--) {
      const b = game.beamStrikes[i];
      b.t += dt;
      if (b.t > b.dur) game.beamStrikes.splice(i, 1);
    }
  }

  function updateCooldowns(dt) {
    for (const p of game.players) {
      for (const k in p.cooldowns) {
        if (p.cooldowns[k] > 0) p.cooldowns[k] -= dt;
      }
    }
  }

  return { canUnlock, unlock, isReady, activate, fireSuperweapon, updateNukes, updateCooldowns };
})();
