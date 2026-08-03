// layout.js — canonical world layout shared by terrain painting and world population
import * as THREE from 'three';

export const LAYOUT = {
  spawn: { x: -240, z: 235 },
  base: { x: 190, z: -170, r: 95 },        // Scorpion Cartel stronghold (NE)
  village: { x: -60, z: 80, r: 48 },        // neutral village mid-map
  oasis: { x: -170, z: -60, r: 32 },        // palms + pond
  oilfield: { x: 60, z: -40, r: 40 },       // derricks
  lz: { x: -228, z: -188, r: 18 },          // extraction point (NW)
  // main dirt road: spawn → village → oil field → base gate → base heart
  road: [
    { x: -240, z: 245 }, { x: -215, z: 200 }, { x: -170, z: 160 },
    { x: -120, z: 125 }, { x: -75, z: 95 }, { x: -48, z: 62 },
    { x: -20, z: 30 }, { x: 20, z: 0 }, { x: 55, z: -30 },
    { x: 95, z: -70 }, { x: 130, z: -110 }, { x: 160, z: -140 },
    { x: 190, z: -170 },
  ],
  // spur road to the oasis
  road2: [
    { x: -75, z: 95 }, { x: -110, z: 55 }, { x: -140, z: 10 }, { x: -165, z: -40 },
  ],
  // flatten discs {x, z, r, h, s(harpness)}
  flats: [
    { x: 190, z: -170, r: 110, h: 2.0 },
    { x: -60, z: 80, r: 55, h: 1.0 },
    { x: -170, z: -60, r: 38, h: -0.6 },
    { x: 60, z: -40, r: 45, h: 1.2 },
    { x: -228, z: -188, r: 26, h: 1.5 },
    { x: -240, z: 235, r: 30, h: 1.6 },
  ],
};

export function roadCurve(pts) {
  return new THREE.CatmullRomCurve3(pts.map(p => new THREE.Vector3(p.x, 0, p.z)));
}
