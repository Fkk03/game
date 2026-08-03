// combat.js — target acquisition, weapons fire, projectiles, splash.
// OWNED BY: sim agent. STATUS: STUB — implement per this contract.
// API (called from main loop / other systems):
//   tickCombat(dt)  — auto-acquire for idle/attackmove units + defense
//     buildings; step projectiles; apply damage via entities.applyDamage.
//   orderAttack(units, target) — explicit attack order.
//   Projectile visuals/explosions delegate to G.fx (fx.js API: tracer(from,to),
//     shellArc(from,to,cb), rocketTrail(from,to,cb), explosion(x,y,z,r),
//     muzzleFlash(pos,dir)).
//   Weapon rules: def.weapon fields (range, reload, damage, type, splash,
//     burst, antiAir, groundOnly, minRange) + ARMOR table via applyDamage.
//   Turrets: e.mesh.userData.turret rotates toward target before firing.
import { G } from './core.js';

export function tickCombat(dt) { /* stub */ }
export function orderAttack(units, target) {
  for (const u of units) if (u.kind === 'unit' && u.def.weapon) {
    u.order = { type: 'attack', target };
    u.target = target;
    u.path = null;
  }
}
