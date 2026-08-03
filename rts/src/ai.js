// ai.js — the enemy commander. OWNED BY: ai agent. STATUS: STUB.
// API: initAI(pid, difficulty) -> stores G.ai; tickAI(dt).
// Design contract:
//   The AI plays by the same rules: it uses production.startProduction /
//   beginPlacement-equivalents (may place directly via confirmPlacement
//   helpers), pays with economy money, obeys prereqs. DIFFICULTY knobs from
//   data.DIFFICULTY (incomeMult applied as a periodic subsidy, buildDelay
//   scales decision cadence, attackWave = seconds between attacks,
//   aggression scales wave size).
//   State machine: opening build order (power→barracks→supply→factory),
//   then loop: maintain harvesters, expand army, build defenses at base
//   perimeter facing the player, tech to superweapon on hard+, attack waves
//   gather at rally then attack-move the player base; retreat badly losing
//   waves; use powers when available; rebuild destroyed economy.
import { G } from './core.js';

export function initAI() {}
export function tickAI(dt) { /* stub */ }
