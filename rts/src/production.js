// production.js — build queues, unit spawning, building placement, dozer
// construction, rally points, upgrades, sell. OWNED BY: economy agent.
// STATUS: STUB — implement per this contract.
// API:
//   startProduction(building, defId) — enqueue unit/upgrade if affordable
//     (deduct via economy.addMoney(pid,-cost)); building.queue = [{defId,
//     t, total}]; tickProduction(dt) advances head (half speed if low power),
//     spawns at building edge, sends to building.rally.
//   canBuild(pid, defId) -> {ok, reason} — cost/prereq/power checks (reason
//     string for tooltip: 'Requires War Factory' etc.)
//   beginPlacement(pid, defId, builder) — G.placement = {defId, builder,
//     valid} ghost mesh follows cursor (input.js feeds coords via
//     updatePlacement(x,z)); confirmPlacement() spawns the building site,
//     orders builder to construct (order.type 'build'); cancelPlacement().
//   tickConstruction(dt) — builder at site raises buildProgress; mesh scale
//     lerps 0.15→1; hp scales with progress; scaffold visual via meshes.
//   sellBuilding(b) — 50% refund, removes building.
//   applyUpgrade effects: upg_armor (+25% maxHp vehicles), upg_ap/upg_toxin
//     (+25% weapon damage), upg_junk (self-repair 4hp/s) — store on player
//     p.upgrades Set; combat/entities read multipliers via helpers here:
//     dmgMult(p, def), hpMult(p, def), selfRepair(p, def).
import { G } from './core.js';

export function canBuild() { return { ok: false, reason: 'stub' }; }
export function startProduction() {}
export function tickProduction(dt) {}
export function tickConstruction(dt) {}
export function beginPlacement() {}
export function updatePlacement() {}
export function confirmPlacement() {}
export function cancelPlacement() {}
export function sellBuilding() {}
export function dmgMult() { return 1; }
export function hpMult() { return 1; }
