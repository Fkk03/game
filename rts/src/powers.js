// powers.js — generals XP/ranks, power purchase + activation, superweapons.
// OWNED BY: powers agent. STATUS: STUB — implement per this contract.
// API:
//   tickPowers(dt) — rank-ups from p.xp (RANKS thresholds → p.rank,
//     p.ptsAvail++, emit 'rank:up'), cooldown ticking, superweapon charge
//     (building with def.superweapon alive+powered charges its POWERS entry;
//     expose timers via getSwTimers() -> [{pid, name, remaining, ready}] for
//     the HUD), AI use via aiUsePower().
//   buyPower(pid, powerId) — spend p.ptsAvail if rank met.
//   usePower(pid, powerId, x, z) — execute: paradrop spawns rangers via
//     entities.spawnUnit around (x,z); a10 = 3 strafing runs (fx.tracer +
//     areaDamage); fab/anthrax = big fx.explosion + areaDamage; ambush
//     spawns rebels; sneak spawns tunnel building; repair heals vehicles;
//     sw_particle = sweeping beam (fx.beam) 8s damage tick; sw_scud = 9
//     shellArc scuds over 6s. areaDamage helper lives here:
//     areaDamage(x,z,r,dmg,type,attackerPid).
//   Superweapon HUD hotkey: when ready, click topbar timer or press Space →
//     input.js enters target mode calling usePower.
import { G } from './core.js';

export function tickPowers(dt) { /* stub */ }
export function buyPower() {}
export function usePower() {}
export function getSwTimers() { return []; }
export function areaDamage() {}
