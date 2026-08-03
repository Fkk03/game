// economy.js — money, power, supply harvesting, derrick capture, black market
// income, sell/repair. OWNED BY: economy agent. STATUS: PARTIAL STUB.
// API: initEconomy(); initDocks(list) — creates dock objects {x,z,amount,mesh}
//   in G.docks with crate-pile visuals that shrink as depleted;
//   tickEconomy(dt) — harvester truck AI cycle (drive to dock → load 3s →
//   drive to nearest own supply center → unload → repeat; order.type
//   'harvest' set by input right-click on dock or automatically after build),
//   derrick income for owner, black market trickle, power recompute:
//   p.powerMade/powerUsed from buildings (powered = buildProgress>=1 && not
//   sold); when usesPower && powerUsed>powerMade → production 50% speed,
//   defense turrets offline (building.powered=false).
//   addMoney(pid, amt, isIncome) — all money changes route here (emits
//   'money:changed'), tracks p.rateIn/rateOut rolling $/min for the HUD.
import { G, emit } from './core.js';

export function initEconomy() {
  for (const p of G.players) {
    p.rateIn = 0; p.rateOut = 0;
  }
}
export function initDocks(list) {
  G.docks = list.map(d => ({ ...d, left: d.amount, mesh: null }));
}
export function addMoney(pid, amt) {
  const p = G.players[pid];
  if (!p) return;
  p.money += amt;
  if (amt > 0) p.stats.earned += amt;
  emit('money:changed', pid);
}
export function tickEconomy(dt) { /* stub */ }
