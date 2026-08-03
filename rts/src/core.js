// core.js — shared game context, RNG, math helpers, event bus
// ============================================================================
// MODULE CONTRACT (read this before editing any file):
//   G is the single shared context. Systems attach themselves at boot
//   (G.hud = new HUD() etc.) and read each other ONLY through G and the
//   event bus. File ownership is strict — see the header of each module.
// Player objects (G.players[i]):
//   { id, name, human, faction ('coalition'|'cartel'), color (hex int),
//     colorCss, money, powerUsed, powerMade, xp, rank, ptsAvail,
//     powersOwned:Set, powerCooldowns:{id:sec}, stats:{kills,losses,built,
//     earned}, alive, baseX, baseZ }
// Entities live in G.entities (all), each { id, def, owner, kind:'unit'|
//   'building', pos:Vector3, yaw, hp, alive, mesh:Group, radius, ... } —
//   full shape defined in entities.js. Neutral owner = -1.
// Events (on/emit): 'entity:died' (ent, attacker), 'entity:built' (ent),
//   'sel:changed' (), 'money:changed' (playerId), 'power:changed' (pid),
//   'rank:up' (pid), 'feed' (text, cls), 'announce' (text),
//   'game:over' (winnerPid)
// ============================================================================
import * as THREE from 'three';

export const WORLD_SIZE = 600;           // metres, square
export const HALF = WORLD_SIZE / 2;

// deterministic rng (mulberry32)
export function makeRng(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const params = new URLSearchParams(location.search);
export const SHOT_MODE = params.has('shot');
export const SHOT_VIEW = params.get('shot') || '';
export const SEED = parseInt(params.get('seed') || '1337', 10);

export const G = {
  renderer: null, scene: null, camera: null, composer: null,
  camRig: null,          // camera.js CameraRig
  dt: 0, time: 0, gameTime: 0,
  state: 'loading',      // loading | menu | playing | paused | over
  speed: 1,
  // world
  groundHeight: null,    // fn(x,z)->y  (terrain.js)
  nav: null,             // move.js NavGrid
  fow: null,             // fow.js FogOfWar
  // entities
  entities: [], units: [], buildings: [],
  shootables: [],        // terrain + rocks (legacy field the ported terrain fills)
  docks: [],             // economy.js supply docks
  nextId: 1,
  byId: new Map(),
  // players
  players: [],
  humanId: 0,
  // selection (input.js owns writes; others read)
  sel: [],               // selected entities (player-owned)
  // systems
  hud: null, minimap: null, fx: null, audio: null, ai: null,
  // settings chosen in menu
  cfg: { faction: 'coalition', diff: 'normal', cash: 10000 },
  // freeze flag for screenshot determinism
  freezeSim: false,
  stats: { startTime: 0 },
};

const listeners = {};
export function on(ev, fn) { (listeners[ev] ||= []).push(fn); }
export function emit(ev, ...args) { (listeners[ev] || []).forEach(fn => fn(...args)); }

export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export const lerp = (a, b, t) => a + (b - a) * t;
export const damp = (a, b, l, dt) => lerp(a, b, 1 - Math.exp(-l * dt));
export function randRange(rng, a, b) { return a + rng() * (b - a); }
export function pick(rng, arr) { return arr[Math.floor(rng() * arr.length)]; }
export const V3 = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
export const dist2d = (ax, az, bx, bz) => Math.hypot(ax - bx, az - bz);

// angle helpers (yaw around +Y; 0 faces -Z like three.js lookAt convention)
export function angleTo(ax, az, bx, bz) { return Math.atan2(bx - ax, bz - az); }
export function turnToward(cur, target, maxStep) {
  let d = target - cur;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return Math.abs(d) <= maxStep ? target : cur + Math.sign(d) * maxStep;
}
