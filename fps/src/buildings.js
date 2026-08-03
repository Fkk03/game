// buildings.js — Cartel structures, village huts, props; destructible objective targets
import * as THREE from 'three';
import { G, addBoxCollider, makeRng } from './core.js';
import { metalPanels, adobe, corrugated, camoCanvas, concrete, awning } from './textures.js';
import { mergeGeos } from './terrain.js';

const rng = makeRng(8642);

// shared materials
const M = {};
function mats() {
  if (M.ready) return M;
  M.adobe = new THREE.MeshStandardMaterial({ map: adobe('#c2a678', 21), roughness: 0.95 });
  M.adobeDark = new THREE.MeshStandardMaterial({ map: adobe('#a98f60', 22), roughness: 0.95 });
  M.adobePale = new THREE.MeshStandardMaterial({ map: adobe('#d3bd92', 23), roughness: 0.95 });
  M.metal = new THREE.MeshStandardMaterial({ map: metalPanels('#7a7f6e', 7), roughness: 0.7, metalness: 0.35 });
  M.metalDark = new THREE.MeshStandardMaterial({ map: metalPanels('#565a4e', 8), roughness: 0.72, metalness: 0.4 });
  M.metalRust = new THREE.MeshStandardMaterial({ map: metalPanels('#7d6a52', 9), roughness: 0.85, metalness: 0.2 });
  M.corr = new THREE.MeshStandardMaterial({ map: corrugated('#8d8d82', 33), roughness: 0.8, metalness: 0.3 });
  M.corrRust = new THREE.MeshStandardMaterial({ map: corrugated('#96805e', 34), roughness: 0.9, metalness: 0.15 });
  M.camo = new THREE.MeshStandardMaterial({ map: camoCanvas(44), roughness: 1, side: THREE.DoubleSide });
  M.conc = new THREE.MeshStandardMaterial({ map: concrete('#9a958a', 55), roughness: 0.9 });
  M.wood = new THREE.MeshStandardMaterial({ color: 0x6e5638, roughness: 1 });
  M.woodDark = new THREE.MeshStandardMaterial({ color: 0x4e3c26, roughness: 1 });
  M.gold = new THREE.MeshStandardMaterial({ color: 0xc8a028, roughness: 0.35, metalness: 0.8 });
  M.green = new THREE.MeshStandardMaterial({ color: 0x3d4a30, roughness: 0.9 });
  M.dark = new THREE.MeshStandardMaterial({ color: 0x222420, roughness: 0.9 });
  M.tire = new THREE.MeshStandardMaterial({ color: 0x1c1c1c, roughness: 1 });
  M.sandbag = new THREE.MeshStandardMaterial({ map: adobe('#8a7a56', 25), roughness: 1 });
  M.sandbag2 = new THREE.MeshStandardMaterial({ map: adobe('#77694a', 26), roughness: 1 });
  M.tarp = new THREE.MeshStandardMaterial({ color: 0x5c6248, roughness: 1, side: THREE.DoubleSide });
  M.awning = new THREE.MeshStandardMaterial({ map: awning(), roughness: 1, side: THREE.DoubleSide });
  M.missile = new THREE.MeshStandardMaterial({ color: 0x8a8f7a, roughness: 0.5, metalness: 0.3 });
  M.window = new THREE.MeshStandardMaterial({ color: 0x1a2028, roughness: 0.2, metalness: 0.6 });
  M.frond = new THREE.MeshStandardMaterial({ color: 0x4a6b2a, roughness: 1, side: THREE.DoubleSide });
  M.frondDead = new THREE.MeshStandardMaterial({ color: 0x9c8850, roughness: 1, side: THREE.DoubleSide });
  M.banner = new THREE.MeshStandardMaterial({ color: 0x3d4a30, roughness: 0.9, side: THREE.DoubleSide });
  M.trunk = new THREE.MeshStandardMaterial({ color: 0x7a6248, roughness: 1 });
  M.ready = true;
  return M;
}

function box(w, h, d, mat, x = 0, y = 0, z = 0) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, y, z);
  m.castShadow = m.receiveShadow = true;
  return m;
}
function cyl(rt, rb, h, mat, x = 0, y = 0, z = 0, seg = 12) {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, seg), mat);
  m.position.set(x, y, z);
  m.castShadow = m.receiveShadow = true;
  return m;
}
// cylinder stretched between two points — struts, guy wires, cables, chains
const _UP = new THREE.Vector3(0, 1, 0);
function strut(p1, p2, r, mat, seg = 6) {
  const v = new THREE.Vector3().subVectors(p2, p1);
  const len = v.length();
  const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, len, seg), mat);
  m.position.copy(p1).addScaledVector(v, 0.5);
  m.quaternion.setFromUnitVectors(_UP, v.normalize());
  m.castShadow = true;
  return m;
}
// dark oil/soot stain decal on the ground
function stain(g, r, x, z, opacity = 0.5) {
  const s = new THREE.Mesh(
    new THREE.CircleGeometry(r, 14),
    new THREE.MeshBasicMaterial({ color: 0x17130d, transparent: true, opacity, depthWrite: false }));
  s.rotation.x = -Math.PI / 2;
  s.position.set(x, 0.05, z);
  g.add(s);
}

// ------------------------------------------------------------------- sandbags
// merged staggered-bag meshes (two earth tones) — cheap on draw calls
function sandbags(g, placements) {
  const m = mats();
  const geosA = [], geosB = [];
  let i = 0;
  for (const p of placements) {
    const geo = new THREE.BoxGeometry(
      0.74 + rng() * 0.16, 0.28 + rng() * 0.06, 0.46 + rng() * 0.1);
    geo.rotateZ((rng() - 0.5) * 0.07);
    geo.rotateY(p.ry + (rng() - 0.5) * 0.2);
    geo.translate(p.x, p.y, p.z);
    (i++ % 2 ? geosA : geosB).push(geo);
  }
  for (const [geos, mat] of [[geosA, m.sandbag], [geosB, m.sandbag2]]) {
    if (!geos.length) continue;
    const mesh = new THREE.Mesh(mergeGeos(geos), mat);
    mesh.castShadow = mesh.receiveShadow = true;
    g.add(mesh);
  }
}
function sandbagRing(g, r, courses = 3, gap0 = 5.0, gap1 = 5.9) {
  const placements = [];
  const n = Math.round((Math.PI * 2 * r) / 0.8);
  for (let h = 0; h < courses; h++) {
    const off = (h % 2) * 0.5;
    for (let i = 0; i < n; i++) {
      const a = ((i + off) / n) * Math.PI * 2;
      if (a > gap0 && a < gap1) continue;
      if (h === courses - 1 && rng() < 0.18) continue; // ragged top course
      placements.push({ x: Math.cos(a) * r, y: 0.16 + h * 0.29, z: Math.sin(a) * r, ry: -a + Math.PI / 2 });
    }
  }
  sandbags(g, placements);
}
function sandbagRow(g, cx, y0, cz, angle, count, courses = 2) {
  const placements = [];
  const dx = Math.cos(angle), dz = Math.sin(angle);
  for (let h = 0; h < courses; h++) {
    const n = count - (h % 2 ? 1 : 0);
    for (let i = 0; i < n; i++) {
      const t = (i - (n - 1) / 2) * 0.84;
      placements.push({ x: cx + dx * t, y: y0 + 0.16 + h * 0.29, z: cz + dz * t, ry: -angle });
    }
  }
  sandbags(g, placements);
}

// ---------------------------------------------------------------- destructibles
export class Destructible {
  constructor(group, { hp = 400, name = 'Structure', objective = false, radius = 8 } = {}) {
    this.group = group;
    this.hp = hp; this.maxHp = hp;
    this.name = name;
    this.objective = objective;
    this.radius = radius;
    this.dead = false;
    group.traverse(o => { o.userData.destructible = this; });
    G.targets.push(this);
  }
  damage(amount, hitPos) {
    if (this.dead) return;
    this.hp -= amount;
    if (this.hp <= 0) this.destroy(hitPos);
    else if (this.hp < this.maxHp * 0.5 && !this.smoking) {
      this.smoking = true;
      G.fx?.attachSmoke(this.group, this.radius * 0.4);
    }
  }
  destroy() {
    if (this.dead) return;
    this.dead = true;
    const p = new THREE.Vector3();
    this.group.getWorldPosition(p);
    p.y += 2;
    G.fx?.bigExplosion(p, this.radius);
    G.audio?.explosion(1.2);
    // swap to rubble
    const rubble = makeRubble(this.radius);
    rubble.position.copy(this.group.position);
    rubble.rotation.y = this.group.rotation.y;
    G.scene.add(rubble);
    this.group.visible = false;
    // remove colliders belonging to this group
    G.colliders = G.colliders.filter(c => {
      let m = c.mesh;
      while (m) { if (m === this.group) return false; m = m.parent; }
      return true;
    });
    import('./hud.js').then(h => h.onTargetDestroyed(this));
  }
}

function makeRubble(radius) {
  const m = mats();
  const g = new THREE.Group();
  const n = Math.floor(6 + radius * 1.5);
  for (let i = 0; i < n; i++) {
    const s = 0.5 + rng() * radius * 0.35;
    const b = box(s, s * (0.4 + rng() * 0.5), s, rng() < 0.6 ? m.adobeDark : m.dark,
      (rng() - 0.5) * radius, s * 0.2, (rng() - 0.5) * radius);
    b.rotation.set(rng() * 0.6, rng() * 7, rng() * 0.6);
    g.add(b);
  }
  const scorch = new THREE.Mesh(
    new THREE.CircleGeometry(radius * 1.2, 20),
    new THREE.MeshBasicMaterial({ color: 0x14100c, transparent: true, opacity: 0.75, depthWrite: false }));
  scorch.rotation.x = -Math.PI / 2;
  scorch.position.y = 0.06;
  g.add(scorch);
  return g;
}

// ---------------------------------------------------------------- structures
export function commandCenter() {
  const m = mats();
  const g = new THREE.Group();
  // main hall with battered corner piers
  g.add(box(16, 7, 12, m.adobe, 0, 3.5, 0));
  for (const [px, pz] of [[-7.6, -5.6], [7.6, -5.6], [-7.6, 5.6], [7.6, 5.6]])
    g.add(box(1.6, 7.4, 1.6, m.adobeDark, px, 3.7, pz));
  // sloped parapet + merlons front and back
  g.add(box(17, 1, 13, m.adobeDark, 0, 7.3, 0));
  for (let i = 0; i < 7; i++) {
    const x = -7.2 + i * 2.4;
    g.add(box(1.0, 0.55, 0.6, m.adobe, x, 8.05, 6.3));
    g.add(box(1.0, 0.55, 0.6, m.adobe, x, 8.05, -6.3));
  }
  // side wings with corrugated lean-to roofs
  g.add(box(6, 5, 8, m.adobeDark, -10.5, 2.5, 1));
  g.add(box(6, 5, 8, m.adobeDark, 10.5, 2.5, 1));
  const lean1 = box(6.8, 0.18, 8.8, m.corrRust, -10.8, 5.35, 1);
  lean1.rotation.z = 0.09; g.add(lean1);
  const lean2 = box(6.8, 0.18, 8.8, m.corr, 10.8, 5.35, 1);
  lean2.rotation.z = -0.09; g.add(lean2);
  // entry arch + framed wooden double door
  g.add(box(6, 4.5, 1.4, m.adobePale, 0, 2.25, 6.4));
  const arch = new THREE.Mesh(new THREE.CylinderGeometry(1.8, 1.8, 1.5, 16, 1, false, 0, Math.PI), m.adobeDark);
  arch.rotation.z = Math.PI / 2; arch.rotation.y = Math.PI / 2;
  arch.position.set(0, 3.4, 6.4); arch.castShadow = true;
  g.add(arch);
  g.add(box(3.0, 3.3, 0.18, m.woodDark, 0, 1.65, 7.02));
  g.add(box(0.08, 3.1, 0.26, m.dark, 0, 1.6, 7.05));            // door seam
  g.add(box(0.32, 3.5, 0.4, m.adobeDark, -1.62, 1.75, 6.95));    // jambs
  g.add(box(0.32, 3.5, 0.4, m.adobeDark, 1.62, 1.75, 6.95));
  g.add(box(1.6, 0.7, 0.12, m.dark, 0, 3.85, 7.12));             // vent grille over door
  // dome + gold finial
  const dome = new THREE.Mesh(new THREE.SphereGeometry(4.2, 20, 12, 0, Math.PI * 2, 0, Math.PI / 2), m.adobePale);
  dome.position.set(0, 7.6, -1); dome.castShadow = true;
  g.add(dome);
  g.add(cyl(0.5, 0.5, 2.4, m.gold, 0, 12.4, -1, 8));
  // radio mast, gusset braces, crossarms
  const mast = cyl(0.12, 0.2, 12, m.metalDark, 6.5, 13, -4, 6);
  g.add(mast);
  g.add(box(0.1, 0.1, 3, m.metalDark, 6.5, 17, -4));
  g.add(box(3, 0.1, 0.1, m.metalDark, 6.5, 15.5, -4));
  g.add(strut(new THREE.Vector3(6.5, 10.5, -4), new THREE.Vector3(5.2, 7.8, -3.0), 0.035, m.metalDark, 5));
  g.add(strut(new THREE.Vector3(6.5, 10.5, -4), new THREE.Vector3(7.8, 7.8, -3.0), 0.035, m.metalDark, 5));
  g.add(strut(new THREE.Vector3(6.5, 10.5, -4), new THREE.Vector3(6.5, 7.8, -5.4), 0.035, m.metalDark, 5));
  // antenna wires: mast -> dome finial, mast -> dish mount
  g.add(strut(new THREE.Vector3(6.5, 16.9, -4), new THREE.Vector3(0.2, 13.1, -1.2), 0.024, m.dark, 5));
  g.add(strut(new THREE.Vector3(6.5, 15.4, -4), new THREE.Vector3(-6.2, 9.4, -3.1), 0.024, m.dark, 5));
  // satellite dish on an A-frame mount (was floating)
  const dish = new THREE.Mesh(new THREE.SphereGeometry(2.2, 16, 8, 0, Math.PI * 2, 0, Math.PI / 3), m.metal);
  dish.rotation.x = Math.PI * 0.82; dish.rotation.z = 0.5;
  dish.position.set(-6.5, 9.2, -3);
  dish.castShadow = true;
  g.add(dish);
  g.add(strut(new THREE.Vector3(-6.5, 9.1, -3), new THREE.Vector3(-7.3, 7.7, -3.9), 0.06, m.metalDark, 5));
  g.add(strut(new THREE.Vector3(-6.5, 9.1, -3), new THREE.Vector3(-5.7, 7.7, -3.9), 0.06, m.metalDark, 5));
  g.add(strut(new THREE.Vector3(-6.5, 9.1, -3), new THREE.Vector3(-6.5, 7.7, -1.9), 0.06, m.metalDark, 5));
  // framed windows
  for (const wx of [-5, 5]) {
    g.add(box(2.2, 1.4, 0.15, m.window, wx, 4.6, 6.06));
    g.add(box(2.7, 0.2, 0.4, m.adobePale, wx, 3.82, 6.12));                  // sill
    g.add(box(2.6, 0.26, 0.3, m.adobeDark, wx, 5.4, 6.1));                   // lintel
    g.add(box(0.24, 1.7, 0.24, m.adobeDark, wx - 1.24, 4.6, 6.08));          // jambs
    g.add(box(0.24, 1.7, 0.24, m.adobeDark, wx + 1.24, 4.6, 6.08));
  }
  // roof clutter: crates, tarped stack, AC unit, sandbag nest
  g.add(box(1.3, 1.0, 1.3, m.wood, 4.6, 8.3, 4.2));
  const rc = box(1.05, 0.9, 1.05, m.wood, 5.7, 8.25, 3.3);
  rc.rotation.y = 0.5; g.add(rc);
  const tarp = box(2.6, 1.2, 2.1, m.tarp, -3.8, 8.4, 3.8);
  tarp.rotation.y = 0.3; tarp.rotation.z = 0.04; g.add(tarp);
  g.add(box(1.5, 1.0, 1.2, m.metal, -4.6, 8.3, -4.4));                       // AC box
  g.add(box(1.2, 0.7, 0.08, m.dark, -4.6, 8.3, -3.78));                      // AC grille
  sandbagRow(g, -6.6, 7.8, 4.6, 0.2, 4, 2);                                  // parapet nest
  // banners flanking the entrance, gold band + hanging rod
  for (const s of [-1, 1]) {
    g.add(box(2.4, 3.4, 0.08, m.green, s * 7.9, 4.4, 6.1));
    g.add(box(2.5, 0.45, 0.1, m.gold, s * 7.9, 5.9, 6.11));
    const rod = cyl(0.05, 0.05, 2.9, m.woodDark, s * 7.9, 6.2, 6.12, 6);
    rod.rotation.z = Math.PI / 2;
    g.add(rod);
  }
  return g;
}

export function barracks() {
  const m = mats();
  const g = new THREE.Group();
  g.add(box(12, 4, 7, m.adobeDark, 0, 2, 0));
  // corrugated lean-to roof + weights
  const roof = box(13, 0.25, 8.4, m.corrRust, 0, 4.4, 0);
  roof.rotation.x = 0.1;
  g.add(roof);
  g.add(box(0.5, 0.3, 0.5, m.conc, -3, 4.45, 2.2));
  g.add(box(0.5, 0.3, 0.5, m.conc, 1, 4.85, -2.5));
  g.add(box(0.5, 0.3, 0.5, m.conc, 5, 4.6, 1));
  const rt = new THREE.Mesh(new THREE.TorusGeometry(0.42, 0.16, 6, 10), m.tire);
  rt.rotation.x = Math.PI / 2;
  rt.position.set(-2, 4.9, -1.8);
  rt.castShadow = true;
  g.add(rt);
  // stovepipe through the roof
  g.add(cyl(0.12, 0.12, 2.4, m.metalDark, 4.8, 5.1, -1.6, 6));
  const pcap = new THREE.Mesh(new THREE.ConeGeometry(0.28, 0.3, 6), m.metalDark);
  pcap.position.set(4.8, 6.4, -1.6); pcap.castShadow = true;
  g.add(pcap);
  // framed door + framed windows
  g.add(box(3, 3, 0.3, m.woodDark, -2.5, 1.5, 3.6));
  g.add(box(0.28, 3.3, 0.36, m.wood, -4.0, 1.65, 3.62));
  g.add(box(0.28, 3.3, 0.36, m.wood, -1.0, 1.65, 3.62));
  g.add(box(3.5, 0.28, 0.4, m.wood, -2.5, 3.25, 3.62));
  for (const wx of [2, 4.6]) {
    g.add(box(1.6, 1.1, 0.15, m.window, wx, 2.4, 3.55));
    g.add(box(2.0, 0.18, 0.34, m.adobePale, wx, 1.78, 3.6));
    g.add(box(1.95, 0.2, 0.28, m.adobePale, wx, 3.03, 3.58));
    g.add(box(0.18, 1.4, 0.22, m.adobePale, wx - 0.95, 2.4, 3.57));
    g.add(box(0.18, 1.4, 0.22, m.adobePale, wx + 0.95, 2.4, 3.57));
  }
  // sandbags flanking the door
  sandbagRow(g, 0.6, 0, 4.5, 0.15, 3, 2);
  // camo net on poles
  const net = new THREE.Mesh(new THREE.PlaneGeometry(9, 7, 4, 4), m.camo);
  net.rotation.x = -Math.PI / 2 + 0.12;
  const np = net.geometry.attributes.position;
  for (let i = 0; i < np.count; i++) np.setZ(i, Math.sin(i * 1.7) * 0.4);
  net.geometry.computeVertexNormals();
  net.position.set(-1, 4.9, -6.5);
  net.castShadow = true;
  g.add(net);
  for (const [px, pz] of [[-5, -3.5], [3, -3.5], [-5, -9.5], [3, -9.5]]) {
    g.add(cyl(0.09, 0.09, 4.8, m.wood, px, 2.4, pz, 6));
  }
  return g;
}

export function armsDealer() {
  const m = mats();
  const g = new THREE.Group();
  // big garage with barrel-vault roof
  g.add(box(14, 6, 11, m.metalRust, 0, 3, 0));
  const roof = new THREE.Mesh(new THREE.CylinderGeometry(5.6, 5.6, 14.2, 12, 1, false, Math.PI, Math.PI), m.corr);
  roof.rotation.z = Math.PI / 2;
  roof.position.set(0, 6, 0);
  roof.castShadow = true;
  g.add(roof);
  // vault clutter: exhaust stack + roof hatch
  g.add(cyl(0.22, 0.28, 2.6, m.metalDark, -3.2, 12.1, 0, 8));
  const scap = new THREE.Mesh(new THREE.ConeGeometry(0.5, 0.45, 8), m.metalDark);
  scap.position.set(-3.2, 13.6, 0); scap.castShadow = true;
  g.add(scap);
  g.add(box(1.7, 0.35, 1.3, m.metalDark, 2.6, 11.6, 0.2));
  // open door (dark interior), posts, lintel, hanging sign
  g.add(box(7, 4.6, 0.3, m.dark, 0, 2.3, 5.6));
  g.add(box(1.2, 5.2, 0.5, m.metalDark, -4.1, 2.6, 5.6));
  g.add(box(1.2, 5.2, 0.5, m.metalDark, 4.1, 2.6, 5.6));
  g.add(box(9.4, 0.8, 0.55, m.metalDark, 0, 5.55, 5.6));
  const sign = box(3.4, 1.0, 0.16, m.corrRust, 0.2, 6.7, 5.62);
  sign.rotation.z = -0.06; g.add(sign);
  g.add(strut(new THREE.Vector3(-1.3, 7.15, 5.55), new THREE.Vector3(-1.3, 7.85, 5.2), 0.03, m.dark, 5));
  g.add(strut(new THREE.Vector3(1.7, 7.15, 5.55), new THREE.Vector3(1.7, 7.85, 5.2), 0.03, m.dark, 5));
  // framed side windows (+x face)
  for (const wz of [-2.6, 2.2]) {
    g.add(box(0.15, 1.1, 1.5, m.window, 7.02, 3.7, wz));
    g.add(box(0.24, 0.18, 1.9, m.metalDark, 7.03, 4.4, wz));
    g.add(box(0.24, 0.18, 1.9, m.metalDark, 7.03, 3.0, wz));
    g.add(box(0.24, 1.3, 0.2, m.metalDark, 7.03, 3.7, wz - 0.85));
    g.add(box(0.24, 1.3, 0.2, m.metalDark, 7.03, 3.7, wz + 0.85));
  }
  // external furnace flue on the -x wall (old one was buried in the vault)
  g.add(cyl(0.32, 0.4, 8.4, m.metalDark, -7.35, 4.2, -3, 8));
  const flueElbow = cyl(0.3, 0.3, 0.7, m.metalDark, -7.1, 1.9, -3, 8);
  flueElbow.rotation.z = Math.PI / 2;
  g.add(flueElbow);
  // jib crane by the door with chain hoist + engine block
  g.add(cyl(0.2, 0.26, 7.2, m.metalDark, 8.5, 3.6, 2.4, 8));
  g.add(box(0.35, 0.35, 4.6, m.metalDark, 8.5, 7.1, 4.5));
  g.add(strut(new THREE.Vector3(8.5, 5.4, 2.5), new THREE.Vector3(8.5, 6.9, 5.6), 0.06, m.metalDark, 5));
  g.add(strut(new THREE.Vector3(8.5, 6.9, 6.4), new THREE.Vector3(8.5, 2.6, 6.4), 0.035, m.dark, 5));
  const eng = box(1.0, 0.8, 0.75, m.metalDark, 8.5, 2.1, 6.4);
  eng.rotation.y = 0.4; g.add(eng);
  // workbench + engine under a camo canopy on the left front
  g.add(box(2.8, 0.95, 1.1, m.wood, -5.4, 0.48, 4.4));
  const wbe = box(0.8, 0.6, 0.6, m.metalDark, -5.2, 1.25, 4.4);
  wbe.rotation.y = 0.7; g.add(wbe);
  const canopy = new THREE.Mesh(new THREE.PlaneGeometry(5.5, 3.6, 3, 3), m.camo);
  const cp = canopy.geometry.attributes.position;
  for (let i = 0; i < cp.count; i++) cp.setZ(i, Math.sin(i * 2.3) * 0.3);
  canopy.geometry.computeVertexNormals();
  canopy.rotation.x = -Math.PI / 2 + 0.4;
  canopy.position.set(-4.6, 4.2, 4.7);
  canopy.castShadow = true;
  g.add(canopy);
  g.add(cyl(0.07, 0.07, 3.6, m.wood, -6.9, 1.8, 6.2, 6));
  g.add(cyl(0.07, 0.07, 3.6, m.wood, -2.3, 1.8, 6.2, 6));
  // gas bottles + oil stains
  g.add(cyl(0.26, 0.26, 1.5, m.green, 6.4, 0.75, 5.9, 10));
  const gb = cyl(0.26, 0.26, 1.5, m.metalRust, 6.95, 0.72, 5.55, 10);
  gb.rotation.z = 0.22; g.add(gb);
  stain(g, 1.5, 0.8, 7.0);
  stain(g, 0.9, -4.8, 6.2, 0.35);
  // spare wheels & barrels around
  for (let i = 0; i < 4; i++) {
    const t = new THREE.Mesh(new THREE.TorusGeometry(0.55, 0.24, 8, 14), m.tire);
    t.rotation.x = Math.PI / 2;
    t.position.set(-6.4 - i * 0.12, 0.25 + i * 0.45, 4.5);
    t.castShadow = true;
    g.add(t);
  }
  const lt = new THREE.Mesh(new THREE.TorusGeometry(0.55, 0.24, 8, 14), m.tire);
  lt.rotation.x = Math.PI / 2 - 0.9; lt.rotation.z = 0.4;
  lt.position.set(-7.5, 0.5, 2.6);
  lt.castShadow = true;
  g.add(lt);
  return g;
}

export function palace() {
  const m = mats();
  const g = new THREE.Group();
  // main mass + base skirt + string course + parapet
  g.add(box(14, 8, 12, m.adobePale, 0, 4, 0));
  g.add(box(14.6, 0.8, 12.6, m.adobe, 0, 0.4, 0));
  g.add(box(14.3, 0.35, 12.3, m.adobe, 0, 6.7, 0));
  g.add(box(15, 1.2, 13, m.adobe, 0, 8.6, 0));
  // parapet merlons all round
  for (let i = 0; i < 7; i++) {
    const x = -6.3 + i * 2.1;
    g.add(box(0.9, 0.5, 0.55, m.adobePale, x, 9.45, 6.2));
    g.add(box(0.9, 0.5, 0.55, m.adobePale, x, 9.45, -6.2));
  }
  for (let i = 0; i < 5; i++) {
    const z = -5.2 + i * 2.6;
    g.add(box(0.55, 0.5, 0.9, m.adobePale, 7.2, 9.45, z));
    g.add(box(0.55, 0.5, 0.9, m.adobePale, -7.2, 9.45, z));
  }
  // corner towers: band, slit windows, gold domes
  for (const [tx, tz] of [[-7, -6], [7, -6], [-7, 6], [7, 6]]) {
    g.add(cyl(1.6, 1.9, 10.5, m.adobe, tx, 5.25, tz, 10));
    g.add(cyl(1.72, 1.72, 0.55, m.adobeDark, tx, 9.9, tz, 10));
    g.add(box(0.14, 1.0, 0.42, m.window, tx + Math.sign(tx) * 1.68, 6.5, tz));
    const d = new THREE.Mesh(new THREE.SphereGeometry(1.7, 14, 10, 0, Math.PI * 2, 0, Math.PI / 2), m.gold);
    d.position.set(tx, 10.5, tz); d.castShadow = true;
    g.add(d);
    g.add(cyl(0.1, 0.1, 1.6, m.gold, tx, 12.4, tz, 6));
  }
  // central grand dome on a drum with gold trim ring + finial
  g.add(cyl(4.75, 4.9, 1.4, m.adobePale, 0, 9.0, 0, 20));
  g.add(cyl(4.68, 4.68, 0.28, m.gold, 0, 9.62, 0, 20));
  const dome = new THREE.Mesh(new THREE.SphereGeometry(4.6, 22, 14, 0, Math.PI * 2, 0, Math.PI / 2), m.gold);
  dome.position.set(0, 9.6, 0); dome.castShadow = true;
  g.add(dome);
  const fin = new THREE.Mesh(new THREE.SphereGeometry(0.32, 10, 8), m.gold);
  fin.position.set(0, 14.3, 0); fin.castShadow = true;
  g.add(fin);
  g.add(cyl(0.07, 0.07, 1.5, m.gold, 0, 14.9, 0, 6));
  // arched windows with full frames (clear of the entrance portal)
  for (const wx of [-3.4, 3.4]) {
    g.add(box(1.5, 2.6, 0.15, m.window, wx, 4.6, 6.06));
    g.add(box(1.95, 0.28, 0.42, m.adobe, wx, 3.2, 6.14));                 // sill
    g.add(box(0.22, 2.9, 0.26, m.adobe, wx - 0.86, 4.65, 6.1));           // jambs
    g.add(box(0.22, 2.9, 0.26, m.adobe, wx + 0.86, 4.65, 6.1));
    const wa = new THREE.Mesh(new THREE.CylinderGeometry(0.86, 0.86, 0.24, 12, 1, false, 0, Math.PI), m.adobe);
    wa.rotation.z = Math.PI / 2; wa.rotation.y = Math.PI / 2;
    wa.position.set(wx, 6.1, 6.1); wa.castShadow = true;
    g.add(wa);
  }
  // grand entrance: portal, arch, doors, columns, banners
  g.add(box(4.4, 5.4, 1.0, m.adobe, 0, 2.7, 6.3));
  const pa = new THREE.Mesh(new THREE.CylinderGeometry(1.55, 1.55, 1.1, 16, 1, false, 0, Math.PI), m.adobePale);
  pa.rotation.z = Math.PI / 2; pa.rotation.y = Math.PI / 2;
  pa.position.set(0, 4.3, 6.3); pa.castShadow = true;
  g.add(pa);
  g.add(box(2.8, 3.6, 0.16, m.woodDark, 0, 1.8, 6.84));
  g.add(box(0.08, 3.4, 0.24, m.dark, 0, 1.75, 6.87));
  for (const s of [-1, 1]) {
    g.add(cyl(0.28, 0.32, 4.7, m.adobePale, s * 2.6, 2.35, 7.0, 10));
    g.add(cyl(0.42, 0.36, 0.35, m.gold, s * 2.6, 4.85, 7.0, 10));
    g.add(box(1.5, 3.1, 0.08, m.green, s * 5.6, 4.6, 6.12));
    g.add(box(1.6, 0.4, 0.1, m.gold, s * 5.6, 6.0, 6.13));
  }
  // rooftop: access hut, crates, tarped stack
  g.add(box(2.2, 1.8, 2.0, m.adobeDark, -4.6, 10.1, -3.4));
  g.add(box(0.9, 1.3, 0.1, m.dark, -4.6, 9.9, -2.36));
  g.add(box(1.2, 0.95, 1.2, m.wood, 4.8, 9.7, 3.6));
  const ptarp = box(1.9, 1.0, 1.5, m.tarp, 5.0, 9.7, -3.4);
  ptarp.rotation.y = 0.4; g.add(ptarp);
  // grand steps
  g.add(box(8, 0.5, 2.5, m.conc, 0, 0.25, 7));
  g.add(box(6.5, 0.5, 1.6, m.conc, 0, 0.75, 6.6));
  return g;
}

export function stingerSite() {
  const m = mats();
  const g = new THREE.Group();
  // packed-earth pad
  const pad = cyl(5.3, 5.6, 0.22, m.adobeDark, 0, 0.06, 0, 22);
  pad.receiveShadow = true;
  g.add(pad);
  // staggered sandbag ring with an entrance gap
  sandbagRing(g, 4.5, 3, 5.0, 5.9);
  // launcher: tripod + pivot + quad-tube missile pod, one aligned assembly
  const rack = new THREE.Group();
  const hub = new THREE.Vector3(0, 1.15, 0);
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2 + 0.6;
    const foot = new THREE.Vector3(Math.cos(a) * 1.2, 0.08, Math.sin(a) * 1.2);
    rack.add(strut(hub.clone(), foot.clone(), 0.07, m.metalDark, 6));
    rack.add(box(0.36, 0.12, 0.36, m.metalDark, foot.x, 0.08, foot.z));
  }
  rack.add(cyl(0.18, 0.22, 0.55, m.metalDark, 0, 1.32, 0, 8));      // pivot column
  const pod = new THREE.Group();
  pod.position.set(0, 1.62, 0);
  pod.rotation.order = 'YXZ';                                       // slew, then elevate
  pod.rotation.y = 0.85;                                            // slew
  pod.rotation.x = -0.55;                                           // elevation
  pod.add(box(1.1, 0.16, 1.9, m.metalDark, 0, -0.45, -0.15));       // cradle
  pod.add(box(0.16, 0.34, 0.16, m.metalDark, 0, -0.3, -0.8));       // rear mount
  for (const [tx, ty] of [[-0.27, -0.27], [0.27, -0.27], [-0.27, 0.27], [0.27, 0.27]]) {
    const tube = cyl(0.19, 0.19, 2.7, m.green, 0, 0, 0, 10);
    tube.rotation.x = Math.PI / 2;
    tube.position.set(tx, ty, 0.1);
    pod.add(tube);
    const rim = cyl(0.225, 0.225, 0.1, m.dark, 0, 0, 0, 10);
    rim.rotation.x = Math.PI / 2;
    rim.position.set(tx, ty, 1.44);
    pod.add(rim);
    const tip = new THREE.Mesh(new THREE.ConeGeometry(0.13, 0.42, 8), m.missile);
    tip.rotation.x = Math.PI / 2;
    tip.position.set(tx, ty, 1.66);
    tip.castShadow = true;
    pod.add(tip);
  }
  pod.add(box(1.04, 1.04, 0.14, m.metalRust, 0, 0, -0.72));         // strap bands
  pod.add(box(1.04, 1.04, 0.14, m.metalRust, 0, 0, 0.82));
  pod.add(box(0.42, 0.34, 0.6, m.metalRust, -0.75, -0.1, -0.5));    // sight/control box
  rack.add(pod);
  // gunner stool
  rack.add(cyl(0.06, 0.06, 0.7, m.metalDark, -1.0, 0.35, 0.4, 6));
  rack.add(cyl(0.24, 0.24, 0.06, m.metalRust, -1.0, 0.73, 0.4, 8));
  g.add(rack);
  g.userData.rack = rack;
  // ammo crates + power cable from the pod
  g.add(box(1.4, 0.8, 0.9, m.wood, 2.5, 0.4, 1.9));
  const c2 = box(1.35, 0.75, 0.85, m.wood, 2.7, 1.15, 2.2);
  c2.rotation.y = 0.16; g.add(c2);
  g.add(strut(new THREE.Vector3(0.35, 1.15, -0.3), new THREE.Vector3(2.3, 0.85, 1.6), 0.026, m.dark, 5));
  // spare launch tube on chocks
  g.add(box(0.32, 0.24, 0.5, m.woodDark, -2.7, 0.12, 2.0));
  g.add(box(0.32, 0.24, 0.5, m.woodDark, -1.3, 0.12, 2.6));
  g.add(strut(new THREE.Vector3(-3.1, 0.36, 1.85), new THREE.Vector3(-0.9, 0.36, 2.75), 0.17, m.green, 8));
  // fuel drum
  g.add(cyl(0.42, 0.42, 1.1, m.metalRust, -2.6, 0.55, -2.4, 10));
  return g;
}

export function tunnelNetwork() {
  const m = mats();
  const g = new THREE.Group();
  // lumpy excavated-earth mound
  const geo = new THREE.SphereGeometry(5.0, 20, 12, 0, Math.PI * 2, 0, Math.PI / 2);
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    const n = 1 + Math.sin(x * 1.9 + z * 1.3) * 0.05 + Math.cos(x * 0.8 - z * 2.2) * 0.06;
    pos.setXYZ(i, x * n, y * n * 0.72, z * n);
  }
  geo.computeVertexNormals();
  const mound = new THREE.Mesh(geo, m.adobeDark);
  mound.position.z = -0.8;
  mound.castShadow = mound.receiveShadow = true;
  g.add(mound);
  // timber-framed entrance portal with dark maw
  g.add(box(3.4, 2.9, 2.4, m.adobe, 0, 1.3, 3.4));
  g.add(box(0.3, 2.6, 0.35, m.woodDark, -1.15, 1.3, 4.65));
  g.add(box(0.3, 2.6, 0.35, m.woodDark, 1.15, 1.3, 4.65));
  g.add(box(3.0, 0.35, 0.45, m.woodDark, 0, 2.72, 4.65));
  g.add(box(2.0, 2.2, 0.35, m.dark, 0, 1.05, 4.52));
  // corrugated awning over the mouth
  const awn = box(3.6, 0.14, 1.6, m.corrRust, 0, 3.12, 4.9);
  awn.rotation.x = 0.24;
  g.add(awn);
  // sandbag wings flanking the entrance + bags across the portal roof
  sandbagRow(g, -2.9, 0, 4.4, -0.5, 4, 2);
  sandbagRow(g, 2.9, 0, 4.4, 0.5, 4, 2);
  sandbagRow(g, 0, 2.75, 4.1, 0, 3, 1);
  // camo net staked over the crown
  const net = new THREE.Mesh(new THREE.PlaneGeometry(7, 5.4, 4, 4), m.camo);
  const np = net.geometry.attributes.position;
  for (let i = 0; i < np.count; i++) np.setZ(i, Math.sin(i * 2.1) * 0.35);
  net.geometry.computeVertexNormals();
  net.rotation.x = -Math.PI / 2 + 0.22;
  net.position.set(0.4, 3.65, -2.0);
  net.castShadow = true;
  g.add(net);
  for (const [px, pz] of [[-3.0, -4.6], [3.2, -4.4]]) g.add(cyl(0.08, 0.08, 3.1, m.wood, px, 1.55, pz, 6));
  // periscope stovepipe with elbow
  g.add(cyl(0.1, 0.1, 1.6, m.metalDark, -1.8, 3.4, -1.6, 6));
  const elbow = cyl(0.09, 0.09, 0.5, m.metalDark, -1.62, 4.15, -1.6, 6);
  elbow.rotation.z = Math.PI / 2;
  g.add(elbow);
  // crate + drum by the mouth
  const cr = box(1.2, 0.9, 0.9, m.wood, 3.4, 0.45, 2.2);
  cr.rotation.y = 0.3; g.add(cr);
  g.add(cyl(0.42, 0.42, 1.1, m.metalRust, 4.3, 0.55, 1.0, 10));
  // flag on the crown
  g.add(cyl(0.06, 0.06, 4.2, m.wood, 2.1, 4.4, -1.4, 6));
  const flag = new THREE.Mesh(new THREE.PlaneGeometry(1.7, 1.05), m.banner);
  flag.position.set(2.98, 6.0, -1.4);
  flag.castShadow = true;
  g.add(flag);
  return g;
}

export function watchtower() {
  const m = mats();
  const g = new THREE.Group();
  for (const [px, pz] of [[-1.4, -1.4], [1.4, -1.4], [-1.4, 1.4], [1.4, 1.4]]) {
    const leg = cyl(0.12, 0.16, 8, m.wood, px * 0.8, 4, pz * 0.8, 6);
    leg.position.x = px * 0.75; leg.position.z = pz * 0.75;
    leg.rotation.z = -px * 0.06; leg.rotation.x = pz * 0.06;
    g.add(leg);
  }
  // cross braces
  for (let i = 0; i < 3; i++) {
    const b1 = box(2.8, 0.12, 0.12, m.woodDark, 0, 1.6 + i * 2.2, 1.15 - i * 0.1);
    b1.rotation.z = 0.5;
    g.add(b1);
    const b2 = b1.clone(); b2.rotation.z = -0.5; b2.position.z = -1.15 + i * 0.1;
    g.add(b2);
  }
  // platform + parapet + roof
  g.add(box(3.6, 0.3, 3.6, m.woodDark, 0, 8.1, 0));
  for (const s of [[0, 1.65], [0, -1.65], [1.65, 0], [-1.65, 0]]) {
    const wall = box(s[0] === 0 ? 3.6 : 0.25, 1, s[1] === 0 ? 3.6 : 0.25, m.wood, s[0], 8.8, s[1]);
    g.add(wall);
  }
  const roof = new THREE.Mesh(new THREE.ConeGeometry(3, 1.6, 4), m.corrRust);
  roof.rotation.y = Math.PI / 4;
  roof.position.y = 11;
  roof.castShadow = true;
  g.add(roof);
  for (const [px, pz] of [[-1.5, -1.5], [1.5, -1.5], [-1.5, 1.5], [1.5, 1.5]]) {
    g.add(cyl(0.07, 0.07, 2.2, m.wood, px, 9.2, pz, 5));
  }
  g.userData.platformY = 8.3;
  return g;
}

export function hut(variant = 0) {
  const m = mats();
  const g = new THREE.Group();
  const w = 5 + (variant % 3), d = 4.5 + ((variant * 7) % 3);
  const wall = [m.adobe, m.adobeDark, m.adobePale][variant % 3];
  const trim = variant % 3 === 2 ? m.adobeDark : m.adobePale;
  g.add(box(w, 3.2, d, wall, 0, 1.6, 0));
  if (variant % 2 === 0) {
    const roof = box(w + 1, 0.22, d + 1.2, m.corrRust, 0, 3.5, 0);
    roof.rotation.x = 0.08;
    g.add(roof);
    // roof weights (tires/blocks)
    const t = new THREE.Mesh(new THREE.TorusGeometry(0.4, 0.16, 6, 10), m.tire);
    t.rotation.x = Math.PI / 2; t.position.set(w * 0.25, 3.75, d * 0.2);
    g.add(t);
    g.add(box(0.45, 0.28, 0.45, m.conc, -w * 0.3, 3.78, -d * 0.2));
    g.add(box(0.45, 0.28, 0.45, m.conc, w * 0.32, 3.68, -d * 0.32));
  } else {
    g.add(box(w + 0.6, 0.7, d + 0.6, m.adobeDark, 0, 3.4, 0));
    // corner piers
    for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]])
      g.add(box(0.5, 3.6, 0.5, trim, sx * w / 2, 1.8, sz * d / 2));
  }
  // framed door + framed window
  g.add(box(1.3, 2.3, 0.25, m.woodDark, w * 0.2, 1.15, d / 2 + 0.05));
  g.add(box(1.7, 0.24, 0.36, m.wood, w * 0.2, 2.4, d / 2 + 0.1));
  g.add(box(1.1, 0.95, 0.14, m.dark, -w * 0.25, 2, d / 2 + 0.03));
  g.add(box(1.4, 0.16, 0.3, trim, -w * 0.25, 1.42, d / 2 + 0.08));
  g.add(box(1.4, 0.18, 0.26, trim, -w * 0.25, 2.58, d / 2 + 0.06));
  if (variant % 3 === 1) { // market awning
    const a = new THREE.Mesh(new THREE.PlaneGeometry(3, 2.2), m.awning);
    a.rotation.x = -Math.PI / 2 + 0.35;
    a.position.set(-w * 0.1, 2.6, d / 2 + 1.2);
    a.castShadow = true;
    g.add(a);
    g.add(cyl(0.06, 0.06, 2.4, m.wood, -w * 0.1 - 1.4, 1.2, d / 2 + 2.1, 5));
    g.add(cyl(0.06, 0.06, 2.4, m.wood, -w * 0.1 + 1.4, 1.2, d / 2 + 2.1, 5));
    g.add(box(2.4, 0.8, 1, m.wood, -w * 0.1, 0.4, d / 2 + 1.4));
  }
  return g;
}

export function mosque() {
  const m = mats();
  const g = new THREE.Group();
  g.add(box(9, 5.5, 8, m.adobePale, 0, 2.75, 0));
  g.add(box(9.5, 0.6, 8.5, m.adobe, 0, 0.3, 0));
  const dome = new THREE.Mesh(new THREE.SphereGeometry(3.2, 18, 12, 0, Math.PI * 2, 0, Math.PI / 2), m.adobe);
  dome.position.set(0, 5.5, 0); dome.castShadow = true;
  g.add(dome);
  g.add(cyl(0.06, 0.06, 0.9, m.gold, 0, 9.0, 0, 6));
  const dfin = new THREE.Mesh(new THREE.SphereGeometry(0.14, 8, 6), m.gold);
  dfin.position.set(0, 9.5, 0); g.add(dfin);
  // minaret with gold tip
  g.add(cyl(0.9, 1.1, 11, m.adobePale, 6.4, 5.5, -2.5, 10));
  g.add(cyl(1.25, 1.25, 0.8, m.adobe, 6.4, 11.2, -2.5, 10));
  const cap = new THREE.Mesh(new THREE.ConeGeometry(1.1, 1.8, 10), m.green);
  cap.position.set(6.4, 12.5, -2.5); cap.castShadow = true;
  g.add(cap);
  g.add(cyl(0.05, 0.05, 0.7, m.gold, 6.4, 13.7, -2.5, 6));
  const mfin = new THREE.Mesh(new THREE.SphereGeometry(0.12, 8, 6), m.gold);
  mfin.position.set(6.4, 14.05, -2.5); g.add(mfin);
  // framed windows + arched entrance
  for (const wx of [-2.8, 2.8]) {
    g.add(box(1.3, 2.4, 0.15, m.window, wx, 2.6, 4.05));
    g.add(box(1.7, 0.18, 0.34, m.adobe, wx, 1.32, 4.12));
    g.add(box(0.2, 2.7, 0.24, m.adobe, wx - 0.83, 2.65, 4.08));
    g.add(box(0.2, 2.7, 0.24, m.adobe, wx + 0.83, 2.65, 4.08));
    g.add(box(1.7, 0.2, 0.28, m.adobe, wx, 4.0, 4.1));
  }
  g.add(box(1.6, 2.8, 0.2, m.woodDark, 0, 1.4, 4.08));
  g.add(box(0.24, 3.0, 0.3, m.adobe, -0.95, 1.5, 4.1));
  g.add(box(0.24, 3.0, 0.3, m.adobe, 0.95, 1.5, 4.1));
  const ma = new THREE.Mesh(new THREE.CylinderGeometry(0.95, 0.95, 0.28, 14, 1, false, 0, Math.PI), m.adobe);
  ma.rotation.z = Math.PI / 2; ma.rotation.y = Math.PI / 2;
  ma.position.set(0, 2.85, 4.08); ma.castShadow = true;
  g.add(ma);
  return g;
}

export function oilDerrick() {
  const m = mats();
  const g = new THREE.Group();
  // pump jack: base, post, walking beam, horse head, counterweight
  g.add(box(4.5, 0.5, 2, m.conc, 0, 0.25, 0));
  const post = new THREE.Group();
  post.add(box(0.25, 3.6, 0.25, m.metalRust, -0.6, 1.8, 0.5));
  post.add(box(0.25, 3.6, 0.25, m.metalRust, -0.6, 1.8, -0.5));
  post.add(box(0.25, 3.6, 0.25, m.metalRust, 0.2, 1.8, 0));
  g.add(post);
  const beam = new THREE.Group();
  beam.position.set(-0.4, 3.6, 0);
  beam.add(box(4.6, 0.35, 0.5, m.metalRust, 0, 0, 0));
  const head = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 0.9, 0.5, 12, 1, false, -Math.PI / 2, Math.PI), m.metalRust);
  head.rotation.x = Math.PI / 2;
  head.position.set(2.3, -0.1, 0);
  head.castShadow = true;
  beam.add(head);
  beam.add(box(1.2, 1.2, 0.6, m.metalDark, -2.2, -0.2, 0));
  g.add(beam);
  g.userData.beam = beam;
  // motor + tank + feed pipe + stains
  g.add(box(1.4, 1, 1, m.metalDark, -1.8, 0.9, 0));
  const tank = cyl(1.5, 1.5, 3.2, m.metalRust, 3.8, 1.6, -2.6, 14);
  g.add(tank);
  g.add(strut(new THREE.Vector3(3.4, 0.5, -2.2), new THREE.Vector3(1.3, 0.35, -0.2), 0.12, m.metalDark, 6));
  g.add(cyl(0.3, 0.06, 0.3, m.metalRust, 2.0, 0.6, -0.8, 8));
  stain(g, 1.3, 1.9, 0.6);
  stain(g, 1.0, 3.6, -0.9, 0.4);
  return g;
}

export function supplyStash() {
  const m = mats();
  const g = new THREE.Group();
  for (let i = 0; i < 7; i++) {
    const b = box(1.6, 1.1, 1.2, m.wood, (rng() - 0.5) * 4, 0.55 + (i > 4 ? 1.1 : 0), (rng() - 0.5) * 3);
    b.rotation.y = rng() * 0.6;
    g.add(b);
  }
  const net = new THREE.Mesh(new THREE.PlaneGeometry(6, 5, 3, 3), M.camo || mats().camo);
  net.rotation.x = -Math.PI / 2 + 0.1;
  net.position.y = 2.4;
  g.add(net);
  const drum1 = cyl(0.45, 0.45, 1.1, mats().green, 2.8, 0.55, 1.5, 10);
  const drum2 = cyl(0.45, 0.45, 1.1, mats().metalRust, 3.4, 0.55, 0.8, 10);
  g.add(drum1, drum2);
  return g;
}

export function wallSegment(len = 10) {
  const m = mats();
  const g = new THREE.Group();
  // battered skirt + wall + cap
  g.add(box(len, 0.9, 1.35, m.adobe, 0, 0.45, 0));
  g.add(box(len, 2.8, 0.9, m.adobeDark, 0, 1.4, 0));
  g.add(box(len, 0.5, 1.15, m.adobe, 0, 2.9, 0));
  // crenellation
  for (let i = 0; i < len / 2; i++) {
    g.add(box(0.9, 0.5, 1, m.adobeDark, -len / 2 + 1 + i * 2, 3.4, 0));
  }
  // chunky end posts with caps
  for (const s of [-1, 1]) {
    const x = s * len / 2;
    g.add(box(1.7, 4.4, 1.7, m.adobe, x, 2.2, 0));
    g.add(box(2.0, 0.4, 2.0, m.adobeDark, x, 4.6, 0));
    const cap = new THREE.Mesh(new THREE.ConeGeometry(1.25, 0.7, 4), m.adobePale);
    cap.rotation.y = Math.PI / 4;
    cap.position.set(x, 5.15, 0);
    cap.castShadow = true;
    g.add(cap);
  }
  return g;
}

export function gateArch() {
  const m = mats();
  const g = new THREE.Group();
  // heavy towers: battered base, shaft, cap band, merlons, gun slit
  for (const s of [-1, 1]) {
    const x = s * 4.9;
    g.add(box(3.2, 1.2, 3.2, m.adobeDark, x, 0.6, 0));
    g.add(box(2.6, 6.6, 2.6, m.adobe, x, 3.3, 0));
    g.add(box(3.0, 0.6, 3.0, m.adobeDark, x, 6.9, 0));
    for (const [mx, mz] of [[-1.05, -1.05], [1.05, -1.05], [-1.05, 1.05], [1.05, 1.05]])
      g.add(box(0.7, 0.55, 0.7, m.adobe, x + mx, 7.45, mz));
    g.add(box(0.4, 0.9, 0.14, m.window, x, 4.8, 1.34));
  }
  // deep lintel + cap + crenellation
  g.add(box(12.4, 1.8, 2.8, m.adobeDark, 0, 7.6, 0));
  g.add(box(12.8, 0.4, 3.0, m.adobe, 0, 8.6, 0));
  for (let i = 0; i < 7; i++) {
    const x = -5.7 + i * 1.9;
    if (Math.abs(x) < 1.7) continue; // dome sits here
    g.add(box(0.9, 0.55, 2.6, m.adobe, x, 9.08, 0));
  }
  // gold dome centerpiece on a drum + spike
  g.add(cyl(1.05, 1.2, 0.7, m.adobePale, 0, 9.15, 0, 10));
  const gd = new THREE.Mesh(new THREE.SphereGeometry(1.0, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), m.gold);
  gd.position.set(0, 9.5, 0); gd.castShadow = true;
  g.add(gd);
  g.add(cyl(0.06, 0.06, 1.1, m.gold, 0, 10.75, 0, 6));
  // hanging banner with gold band over the opening
  g.add(box(2.0, 2.2, 0.1, m.green, 0, 5.6, 0.9));
  g.add(box(2.2, 0.3, 0.12, m.gold, 0, 6.6, 0.9));
  // wooden gate doors swung open inward
  for (const s of [-1, 1]) {
    const door = box(0.18, 5.2, 3.0, m.woodDark, s * 2.82, 2.6, -1.58);
    door.rotation.y = s * 0.55;
    const plank1 = box(0.1, 0.45, 2.7, m.wood, s * 0.12, 1.1, 0);
    const plank2 = box(0.1, 0.45, 2.7, m.wood, s * 0.12, -1.1, 0);
    door.add(plank1, plank2);
    g.add(door);
  }
  return g;
}

export function palmTree(scale = 1) {
  const m = mats();
  const g = new THREE.Group();
  const lean = (rng() - 0.5) * 0.35;
  const h = (5 + rng() * 3) * scale;
  const seg = 5;
  for (let i = 0; i < seg; i++) {
    const t = cyl(0.16 * scale * (1 - i * 0.09), 0.2 * scale * (1 - i * 0.09), h / seg + 0.1, m.trunk,
      Math.sin(lean) * (i + 0.5) * (h / seg), (i + 0.5) * (h / seg), 0, 7);
    t.rotation.z = -lean;
    g.add(t);
  }
  const topX = Math.sin(lean) * h, topY = h;
  // live fronds with per-frond length + droop variation
  const nf = 8 + Math.floor(rng() * 3);
  for (let i = 0; i < nf; i++) {
    const a = (i / nf) * Math.PI * 2 + (rng() - 0.5) * 0.3;
    const L = (2.5 + rng() * 1.4) * scale;
    const frond = new THREE.Mesh(new THREE.PlaneGeometry(0.55 * scale, L, 1, 4), m.frond);
    const fp = frond.geometry.attributes.position;
    const k = (0.9 * scale) / (L * L);
    for (let v = 0; v < fp.count; v++) {
      const y = fp.getY(v);
      fp.setX(v, fp.getX(v) * (1 - Math.abs(y) / (0.57 * L)));
      fp.setZ(v, -Math.pow(y + L / 2, 2) * k);
    }
    frond.geometry.computeVertexNormals();
    frond.position.set(topX, topY, 0);
    frond.rotation.y = a;
    frond.rotation.x = -(0.45 + rng() * 0.65);
    frond.castShadow = true;
    g.add(frond);
  }
  // dead hanging fronds
  const nd = 1 + Math.floor(rng() * 2);
  for (let i = 0; i < nd; i++) {
    const a = rng() * Math.PI * 2;
    const L = (1.8 + rng() * 0.8) * scale;
    const frond = new THREE.Mesh(new THREE.PlaneGeometry(0.45 * scale, L, 1, 3), m.frondDead);
    const fp = frond.geometry.attributes.position;
    for (let v = 0; v < fp.count; v++) {
      const y = fp.getY(v);
      fp.setX(v, fp.getX(v) * (1 - Math.abs(y) / (0.6 * L)));
    }
    frond.geometry.computeVertexNormals();
    frond.position.set(topX, topY - 0.15 * scale, 0);
    frond.rotation.y = a;
    frond.rotation.x = -(1.45 + rng() * 0.45);
    frond.castShadow = true;
    g.add(frond);
  }
  // coconuts
  for (let i = 0; i < 3; i++) {
    const c = new THREE.Mesh(new THREE.SphereGeometry(0.14 * scale, 6, 5), m.woodDark);
    c.position.set(topX + (rng() - 0.5) * 0.5, topY - 0.25, (rng() - 0.5) * 0.5);
    g.add(c);
  }
  return g;
}

export function barrel(color) {
  const m = mats();
  const mat = color === 'red'
    ? new THREE.MeshStandardMaterial({ color: 0x8a2a1a, roughness: 0.6, metalness: 0.3 })
    : (color === 'green' ? m.green : m.metalRust);
  const g = new THREE.Group();
  const b = cyl(0.42, 0.42, 1.15, mat, 0, 0.58, 0, 12);
  g.add(b);
  g.add(cyl(0.44, 0.44, 0.06, m.metalDark, 0, 0.2, 0, 12));
  g.add(cyl(0.44, 0.44, 0.06, m.metalDark, 0, 0.95, 0, 12));
  g.userData.explosive = color === 'red';
  return g;
}

export function wreckTank() {
  const m = mats();
  const g = new THREE.Group();
  const hull = box(3.6, 1.1, 5.6, m.metalRust, 0, 0.8, 0);
  hull.rotation.z = 0.08;
  g.add(hull);
  const tur = box(2.2, 0.9, 2.6, m.metalRust, 0.3, 1.7, -0.4);
  tur.rotation.y = 0.7; tur.rotation.x = 0.12;
  g.add(tur);
  const gun = cyl(0.14, 0.17, 3.8, m.metalDark, 1.9, 1.8, 1.4, 8);
  gun.rotation.x = Math.PI / 2 - 0.15; gun.rotation.z = -0.7;
  g.add(gun);
  // blown track
  g.add(box(0.7, 0.5, 5.8, m.dark, -1.9, 0.35, 0.2));
  g.add(box(0.7, 0.3, 2.3, m.dark, 2.1, 0.2, 2.5));
  return g;
}

export function powerPole() {
  const m = mats();
  const g = new THREE.Group();
  g.add(cyl(0.12, 0.16, 7.5, m.wood, 0, 3.75, 0, 7));
  g.add(box(2.6, 0.14, 0.14, m.woodDark, 0, 6.9, 0));
  g.add(box(2.0, 0.12, 0.12, m.woodDark, 0, 6.2, 0));
  return g;
}

// register colliders + shootability for a placed structure
export function finalize(group, { collide = true, pad = 0.2, shootable = true } = {}) {
  G.scene.add(group);
  if (collide) addBoxCollider(group, pad);
  if (shootable) group.traverse(o => { if (o.isMesh) G.shootables.push(o); });
  return group;
}
