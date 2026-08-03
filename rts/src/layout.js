// layout.js — skirmish map "Scorpion Valley": two base plateaus, central
// valley road, neutral village + oasis + oil field. Field names (flats, road,
// road2, base, village, oasis, oilfield, lz) are shared with terrain.js.
import * as THREE from 'three';

export const LAYOUT = {
  // flattened discs: {x, z, r, h}
  flats: [
    { x: -195, z: 195, r: 95, h: 14 },     // player base plateau (SW)
    { x: 195, z: -195, r: 95, h: 14 },     // enemy base plateau (NE)
    { x: -60, z: -15, r: 46, h: 2.5 },     // village flat (center-west)
    { x: 105, z: 60, r: 40, h: 1.5 },      // oil field flat (center-east)
    { x: 40, z: -130, r: 34, h: 3 },       // north supply dock flat
    { x: -130, z: 60, r: 30, h: 6 },       // west approach shelf
    { x: 130, z: -60, r: 30, h: 6 },       // east approach shelf
  ],
  // main road: player base → valley → enemy base
  road: [
    new THREE.Vector3(-195, 0, 195), new THREE.Vector3(-140, 0, 120),
    new THREE.Vector3(-90, 0, 55), new THREE.Vector3(-30, 0, 15),
    new THREE.Vector3(40, 0, -25), new THREE.Vector3(110, 0, -90),
    new THREE.Vector3(160, 0, -150), new THREE.Vector3(195, 0, -195),
  ],
  // spur: village → oil field → north dock
  road2: [
    new THREE.Vector3(-60, 0, -15), new THREE.Vector3(0, 0, 10),
    new THREE.Vector3(60, 0, 40), new THREE.Vector3(105, 0, 60),
    new THREE.Vector3(90, 0, -20), new THREE.Vector3(40, 0, -130),
  ],
  // POI discs terrain paints hard-packed dirt around
  base: { x: -195, z: 195, r: 90 },        // player base
  lz: { x: 195, z: -195, r: 90 },          // enemy base
  village: { x: -60, z: -15, r: 42 },
  oasis: { x: -20, z: 120, r: 30 },
  oilfield: { x: 105, z: 60, r: 38 },

  // ---- RTS-specific ----
  bases: [
    { x: -195, z: 195, facing: Math.PI * 0.25 },   // player, faces NE
    { x: 195, z: -195, facing: Math.PI * 1.25 },   // enemy, faces SW
  ],
  // supply docks: crate fields workers harvest. {x,z,amount}
  docks: [
    { x: -150, z: 108, amount: 30000 },    // player-side dock
    { x: 150, z: -108, amount: 30000 },    // enemy-side dock
    { x: 40, z: -130, amount: 42000 },     // contested north dock
    { x: -20, z: 120, amount: 24000 },     // oasis dock (south)
  ],
  // capturable oil derricks {x,z}
  derricks: [
    { x: 98, z: 52 }, { x: 116, z: 68 }, { x: 104, z: 78 },
    { x: -76, z: -28 },                    // one at the village
  ],
  spawn: { x: -195, z: 195 },
};

export function roadCurve(pts) {
  return new THREE.CatmullRomCurve3(pts, false, 'catmullrom', 0.35);
}
