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
    if (pi === 1 && world.isExplored(x, y)) UI.feed('⚠ Enemy ' + POWERS[key].name + ' inbound!', 'bad');
    return true;
  }

  function execute(pi, key, x, y) {
    switch (key) {
      case 'recon':
        world.addReveal(x, y, 330, 25);
        FX.text(x, y, '◈ RECON SWEEP ◈', '#7fd4ff');
        if (pi === 0) SFX.ready();
        break;

      case 'airstrike': {
        // two strafing runs of 3 bombs each along a line through the target
        const ang = U.rand(0, Math.PI * 2);
        for (let run = 0; run < 2; run++) {
          for (let b = 0; b < 3; b++) {
            const off = (b - 1) * 55;
            const px = x + Math.cos(ang) * off + U.rand(-18, 18);
            const py = y + Math.sin(ang) * off + (run - 0.5) * 60 + U.rand(-18, 18);
            game.projs.push({ kind: 'bomb', tx: px, ty: py, t: 0, fly: 1.2 + run * 0.7 + b * 0.22,
              dmg: 220, dtype: 'explosive', splash: 55, owner: pi, dead: false, x: px, y: py, fxSize: 1.1 });
          }
        }
        strikeWarning(pi, x, y, 90);
        break;
      }

      case 'thermobomb':
        game.projs.push({ kind: 'bomb', tx: x, ty: y, t: 0, fly: 3.0,
          dmg: 1600, dtype: 'explosive', splash: 190, owner: pi, dead: false, x, y, fxSize: 3 });
        strikeWarning(pi, x, y, 190);
        if (world.isVisible(x, y)) SFX.klaxon();
        break;

      case 'barrage': {
        for (let i = 0; i < 10; i++) {
          const px = x + U.rand(-95, 95), py = y + U.rand(-95, 95);
          game.projs.push({ kind: 'bomb', tx: px, ty: py, t: 0, fly: 0.8 + i * 0.28,
            dmg: 170, dtype: 'explosive', splash: 48, owner: pi, dead: false, x: px, y: py, fxSize: 0.9 });
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
        const ang = U.rand(0, Math.PI * 2);
        for (let i = 0; i < 12; i++) {
          const off = (i - 5.5) * 45;
          const px = x + Math.cos(ang) * off + U.rand(-12, 12);
          const py = y + Math.sin(ang) * off + U.rand(-12, 12);
          game.projs.push({ kind: 'bomb', tx: px, ty: py, t: 0, fly: 1.5 + i * 0.16,
            dmg: 260, dtype: 'explosive', splash: 60, owner: pi, dead: false, x: px, y: py, fxSize: 1.2 });
        }
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
            dmg: 180, dtype: 'explosive', splash: 52, owner: pi, dead: false, x: px, y: py, fxSize: 1.0 });
        }
        strikeWarning(pi, x, y, 100);
        break;
      }

      case 'vengeance': {
        for (let wave = 0; wave < 3; wave++) {
          for (let i = 0; i < 7; i++) {
            const px = x + U.rand(-110, 110), py = y + U.rand(-110, 110);
            game.projs.push({ kind: 'bomb', tx: px, ty: py, t: 0, fly: 0.9 + wave * 2.0 + i * 0.22,
              dmg: 200, dtype: 'explosive', splash: 55, owner: pi, dead: false, x: px, y: py, fxSize: 1.0 });
          }
        }
        strikeWarning(pi, x, y, 130);
        break;
      }
    }
  }

  function strikeWarning(pi, x, y, r) {
    if (pi === 1 && world.isExplored(x, y)) {
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
    UI.feed(pi === 0 ? SUPERWEAPONS[kind].name + ' launched!' : '⚠⚠ ENEMY SUPERWEAPON LAUNCHED ⚠⚠', pi === 0 ? 'gold' : 'bad');
    if (pi === 1) { SFX.klaxon(); SFX.say('Warning. Incoming superweapon', true); UI.ping(x, y, '#ff2200'); }

    switch (kind) {
      case 'nuke':
        game.nukes.push({ x, y, t: 0, fly: 6, owner: pi });
        break;
      case 'solaris': {
        // sweeping beam: sequence of beam strikes marching across the area
        const ang = U.rand(0, Math.PI * 2);
        for (let i = 0; i < 14; i++) {
          const off = (i - 6.5) * 34;
          const px = x + Math.cos(ang) * off, py = y + Math.sin(ang) * off;
          game.projs.push({ kind: 'bomb', tx: px, ty: py, t: 0, fly: 2.5 + i * 0.32,
            dmg: 420, dtype: 'beam', splash: 65, owner: pi, dead: false, x: px, y: py, fxSize: 1.35, beam: true });
        }
        game.beamStrikes.push({ x, y, ang, t: 0, dur: 14 * 0.32 + 2.5 });
        SFX.beam(x, y);
        break;
      }
      case 'rocketstorm': {
        for (let i = 0; i < 24; i++) {
          const px = x + U.rand(-160, 160), py = y + U.rand(-160, 160);
          game.projs.push({ kind: 'bomb', tx: px, ty: py, t: 0, fly: 1.5 + i * 0.33,
            dmg: 300, dtype: 'explosive', splash: 70, owner: pi, dead: false, x: px, y: py, fxSize: 1.2 });
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
        dealSplash(n.x, n.y, 3200, 'explosive', 230, n.owner, null);
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
