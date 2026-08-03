// core.js — shared game context, RNG, math helpers, event bus
import * as THREE from 'three';

export const WORLD_SIZE = 600;           // metres, square
export const HALF = WORLD_SIZE / 2;

// --- seeded RNG (mulberry32) --------------------------------------------
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

// --- global context ------------------------------------------------------
export const G = {
  scene: null, camera: null, renderer: null, composer: null,
  time: 0, dt: 0,
  state: 'loading',            // loading | menu | playing | paused | over
  rng: makeRng(SEED),
  // world queries (filled by terrain.js / world.js)
  groundHeight: (x, z) => 0,
  colliders: [],               // { box: THREE.Box3, mesh } — static obstacles
  shootables: [],              // meshes bullets can hit (buildings, props)
  enemies: [],                 // soldier AI instances
  vehicles: [],
  targets: [],                 // objective targets
  player: null,
  fx: null, audio: null, hud: null, weapons: null, world: null,
  stats: { kills: 0, shotsFired: 0, shotsHit: 0, damageTaken: 0, startTime: 0 },
  quality: params.get('q') || 'high',
};

// --- tiny event bus ------------------------------------------------------
const listeners = {};
export function on(ev, fn) { (listeners[ev] ||= []).push(fn); }
export function emit(ev, ...args) { (listeners[ev] || []).forEach(fn => fn(...args)); }

// --- helpers -------------------------------------------------------------
export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export const lerp = (a, b, t) => a + (b - a) * t;
export const damp = (a, b, l, dt) => lerp(a, b, 1 - Math.exp(-l * dt));
export function randRange(rng, a, b) { return a + rng() * (b - a); }
export function pick(rng, arr) { return arr[Math.floor(rng() * arr.length)]; }

export const V3 = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);

// register a static box collider from a mesh's world AABB (with optional padding)
export function addBoxCollider(mesh, pad = 0) {
  mesh.updateWorldMatrix(true, true);
  const box = new THREE.Box3().setFromObject(mesh);
  if (pad) { box.min.x -= pad; box.min.z -= pad; box.max.x += pad; box.max.z += pad; }
  G.colliders.push({ box, mesh });
  return box;
}
export function addManualCollider(cx, cz, hx, hz, y0, y1) {
  const box = new THREE.Box3(new THREE.Vector3(cx - hx, y0, cz - hz), new THREE.Vector3(cx + hx, y1, cz + hz));
  G.colliders.push({ box, mesh: null });
  return box;
}
