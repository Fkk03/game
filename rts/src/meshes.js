// meshes.js — visual builders for every unit/building def. OWNED BY: meshes
// agent, whose mission is GZH-quality models built from fps-style primitives
// (see ../fps/src/buildings.js, vehicles.js, soldiers.js for the art kit).
// CONTRACT (do not change signatures):
//   buildMesh(def, owner) -> THREE.Group   — model faces -Z, origin at ground.
//     Must set castShadow/receiveShadow on solid parts. Player color accents
//     read from G.players[owner]?.color (fallback grey for neutral).
//     Turreted units: group.userData.turret (Group) and .muzzle (Vector3,
//     local to turret) if present are used by combat.js for aiming/tracers.
//     Harvesters: userData.cargo (Object3D) toggled visible when carrying.
//     Buildings under construction are scaled by entities.js.
//   buildRubble(def) -> THREE.Group|null    — destroyed-building rubble.
//   buildScaffold(def) -> THREE.Group|null  — optional construction scaffold.
// This placeholder implementation renders readable blockouts so the sim is
// playable before the art pass replaces it.
import * as THREE from 'three';
import { G } from './core.js';

const dim = (c, f) => new THREE.Color(c).multiplyScalar(f);

export function playerColor(owner) {
  return G.players[owner]?.color ?? 0x8a8578;
}

export function buildMesh(def, owner) {
  const g = new THREE.Group();
  const accent = new THREE.MeshStandardMaterial({ color: playerColor(owner), roughness: 0.7 });
  const body = new THREE.MeshStandardMaterial({
    color: def.kind === 'building' ? 0x9a8a68 : 0x7d7a66, roughness: 0.85,
  });
  if (def.kind === 'building') {
    const [w, d] = def.size;
    const h = Math.max(4, Math.min(w, d) * 0.55);
    const m = new THREE.Mesh(new THREE.BoxGeometry(w * 0.82, h, d * 0.82), body);
    m.position.y = h / 2;
    m.castShadow = m.receiveShadow = true;
    g.add(m);
    const band = new THREE.Mesh(new THREE.BoxGeometry(w * 0.84, h * 0.18, d * 0.84), accent);
    band.position.y = h * 0.82;
    g.add(band);
  } else {
    const s = def.role === 'infantry' ? 1 : 2.6;
    const m = new THREE.Mesh(new THREE.BoxGeometry(s, s * (def.role === 'infantry' ? 1.8 : 0.8), s * 1.5), body);
    m.position.y = def.air ? 0 : s * 0.6;
    m.castShadow = true;
    g.add(m);
    const cap = new THREE.Mesh(new THREE.BoxGeometry(s * 0.6, s * 0.4, s * 0.6), accent);
    cap.position.y = (def.air ? 0 : s * 0.6) + s * 0.55;
    g.add(cap);
    if (def.weapon) {
      const turret = new THREE.Group();
      turret.position.y = cap.position.y;
      const barrel = new THREE.Mesh(new THREE.BoxGeometry(0.25, 0.25, s * 1.6),
        new THREE.MeshStandardMaterial({ color: 0x3a3a35 }));
      barrel.position.z = -s * 0.8;
      turret.add(barrel);
      g.add(turret);
      g.userData.turret = turret;
      g.userData.muzzle = new THREE.Vector3(0, 0, -s * 1.6);
    }
  }
  return g;
}

export function buildRubble(def) {
  if (def.kind !== 'building') return null;
  const g = new THREE.Group();
  const [w, d] = def.size;
  const mat = new THREE.MeshStandardMaterial({ color: 0x4a4238, roughness: 1 });
  for (let i = 0; i < 5; i++) {
    const bw = w * (0.2 + Math.random() * 0.25);
    const m = new THREE.Mesh(new THREE.BoxGeometry(bw, bw * 0.5, bw), mat);
    m.position.set((Math.random() - 0.5) * w * 0.6, bw * 0.2, (Math.random() - 0.5) * d * 0.6);
    m.rotation.y = Math.random() * 3;
    m.castShadow = m.receiveShadow = true;
    g.add(m);
  }
  return g;
}

export function buildScaffold() { return null; }
