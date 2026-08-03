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
  M.sandbag = new THREE.MeshStandardMaterial({ map: adobe('#b0a070', 25), roughness: 1 });
  M.tarp = new THREE.MeshStandardMaterial({ color: 0x5c6248, roughness: 1, side: THREE.DoubleSide });
  M.awning = new THREE.MeshStandardMaterial({ map: awning(), roughness: 1, side: THREE.DoubleSide });
  M.missile = new THREE.MeshStandardMaterial({ color: 0x8a8f7a, roughness: 0.5, metalness: 0.3 });
  M.window = new THREE.MeshStandardMaterial({ color: 0x1a2028, roughness: 0.2, metalness: 0.6 });
  M.frond = new THREE.MeshStandardMaterial({ color: 0x4a6b2a, roughness: 1, side: THREE.DoubleSide });
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
  // main hall
  g.add(box(16, 7, 12, m.adobe, 0, 3.5, 0));
  // sloped parapet
  g.add(box(17, 1, 13, m.adobeDark, 0, 7.3, 0));
  // side wings
  g.add(box(6, 5, 8, m.adobeDark, -10.5, 2.5, 1));
  g.add(box(6, 5, 8, m.adobeDark, 10.5, 2.5, 1));
  // entry arch
  g.add(box(6, 4.5, 1.4, m.adobePale, 0, 2.25, 6.4));
  const arch = new THREE.Mesh(new THREE.CylinderGeometry(1.8, 1.8, 1.5, 16, 1, false, 0, Math.PI), m.adobeDark);
  arch.rotation.z = Math.PI / 2; arch.rotation.y = Math.PI / 2;
  arch.position.set(0, 3.4, 6.4); arch.castShadow = true;
  g.add(arch);
  // dome
  const dome = new THREE.Mesh(new THREE.SphereGeometry(4.2, 20, 12, 0, Math.PI * 2, 0, Math.PI / 2), m.adobePale);
  dome.position.set(0, 7.6, -1); dome.castShadow = true;
  g.add(dome);
  g.add(cyl(0.5, 0.5, 2.4, m.gold, 0, 12.4, -1, 8));
  // radio mast
  const mast = cyl(0.12, 0.2, 12, m.metalDark, 6.5, 13, -4, 6);
  g.add(mast);
  g.add(box(0.1, 0.1, 3, m.metalDark, 6.5, 17, -4));
  g.add(box(3, 0.1, 0.1, m.metalDark, 6.5, 15.5, -4));
  // satellite dish
  const dish = new THREE.Mesh(new THREE.SphereGeometry(2.2, 16, 8, 0, Math.PI * 2, 0, Math.PI / 3), m.metal);
  dish.rotation.x = Math.PI * 0.82; dish.rotation.z = 0.5;
  dish.position.set(-6.5, 9.2, -3);
  dish.castShadow = true;
  g.add(dish);
  // windows
  for (const wx of [-5, 0, 5]) g.add(box(2.2, 1.4, 0.15, m.window, wx, 4.6, 6.06));
  // banners
  const banner = box(2.4, 3.4, 0.08, m.green, -7.9, 4.4, 6.1);
  g.add(banner);
  return g;
}

export function barracks() {
  const m = mats();
  const g = new THREE.Group();
  g.add(box(12, 4, 7, m.adobeDark, 0, 2, 0));
  // corrugated lean-to roof
  const roof = box(13, 0.25, 8.4, m.corrRust, 0, 4.4, 0);
  roof.rotation.x = 0.1;
  g.add(roof);
  g.add(box(3, 3, 0.3, m.woodDark, -2.5, 1.5, 3.6));   // door
  for (const wx of [2, 4.6]) g.add(box(1.6, 1.1, 0.15, m.window, wx, 2.4, 3.55));
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
  // big garage
  g.add(box(14, 6, 11, m.metalRust, 0, 3, 0));
  const roof = new THREE.Mesh(new THREE.CylinderGeometry(5.6, 5.6, 14.2, 12, 1, false, Math.PI, Math.PI), m.corr);
  roof.rotation.z = Math.PI / 2;
  roof.position.set(0, 6, 0);
  roof.castShadow = true;
  g.add(roof);
  // open door (dark interior)
  g.add(box(7, 4.6, 0.3, m.dark, 0, 2.3, 5.6));
  g.add(box(1.2, 5.2, 0.5, m.metalDark, -4.1, 2.6, 5.6));
  g.add(box(1.2, 5.2, 0.5, m.metalDark, 4.1, 2.6, 5.6));
  // chimney + crane arm
  g.add(cyl(0.4, 0.5, 4, m.metalDark, -5, 8.5, -3, 8));
  g.add(box(7, 0.4, 0.4, m.metalDark, 3, 7.6, -4));
  g.add(box(0.3, 2, 0.3, m.metalDark, 6.2, 6.6, -4));
  // spare wheels & barrels around
  for (let i = 0; i < 4; i++) {
    const t = new THREE.Mesh(new THREE.TorusGeometry(0.55, 0.24, 8, 14), m.tire);
    t.rotation.x = Math.PI / 2;
    t.position.set(-6.4 - i * 0.12, 0.25 + i * 0.45, 4.5);
    t.castShadow = true;
    g.add(t);
  }
  return g;
}

export function palace() {
  const m = mats();
  const g = new THREE.Group();
  g.add(box(14, 8, 12, m.adobePale, 0, 4, 0));
  g.add(box(15, 1.2, 13, m.adobe, 0, 8.6, 0));
  // corner towers with gold domes
  for (const [tx, tz] of [[-7, -6], [7, -6], [-7, 6], [7, 6]]) {
    g.add(cyl(1.6, 1.9, 10.5, m.adobe, tx, 5.25, tz, 10));
    const d = new THREE.Mesh(new THREE.SphereGeometry(1.7, 14, 10, 0, Math.PI * 2, 0, Math.PI / 2), m.gold);
    d.position.set(tx, 10.5, tz); d.castShadow = true;
    g.add(d);
    g.add(cyl(0.1, 0.1, 1.6, m.gold, tx, 12.4, tz, 6));
  }
  // central grand dome
  const dome = new THREE.Mesh(new THREE.SphereGeometry(4.6, 22, 14, 0, Math.PI * 2, 0, Math.PI / 2), m.gold);
  dome.position.set(0, 8.8, 0); dome.castShadow = true;
  g.add(dome);
  // arched windows
  for (const wx of [-4.5, -1.5, 1.5, 4.5]) {
    g.add(box(1.5, 2.6, 0.15, m.window, wx, 4.6, 6.06));
    g.add(box(1.9, 0.5, 0.2, m.adobeDark, wx, 6.2, 6.1));
  }
  // grand steps
  g.add(box(8, 0.5, 2.5, m.conc, 0, 0.25, 7));
  g.add(box(6.5, 0.5, 1.6, m.conc, 0, 0.75, 6.6));
  return g;
}

export function stingerSite() {
  const m = mats();
  const g = new THREE.Group();
  // sandbag ring
  const ring = new THREE.Group();
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2;
    if (a > 5.0 && a < 5.9) continue; // entrance gap
    for (let h = 0; h < 2; h++) {
      const b = box(1.5, 0.55, 0.75, m.sandbag, Math.cos(a) * 4.6, 0.32 + h * 0.5, Math.sin(a) * 4.6);
      b.rotation.y = -a + (h ? 0.11 : 0);
      ring.add(b);
    }
  }
  g.add(ring);
  // tripod launcher rack with 3 missiles
  const rack = new THREE.Group();
  for (const [lx, lz] of [[-0.8, 0], [0.8, 0], [0, -0.9]]) {
    const leg = cyl(0.08, 0.08, 2.2, m.metalDark, lx, 1.1, lz, 6);
    leg.rotation.x = lx === 0 ? -0.3 : 0;
    leg.rotation.z = lx * 0.35;
    rack.add(leg);
  }
  const pod = box(1.6, 1.1, 2.6, m.green, 0, 2.3, 0);
  pod.rotation.x = -0.5;
  rack.add(pod);
  for (const [mx, my] of [[-0.45, 2.15], [0.45, 2.15], [0, 2.75]]) {
    const missile = cyl(0.16, 0.16, 3, m.missile, mx, my, 0, 8);
    missile.rotation.x = Math.PI / 2 - 0.5;
    rack.add(missile);
    const tip = new THREE.Mesh(new THREE.ConeGeometry(0.16, 0.5, 8), m.dark);
    tip.rotation.x = Math.PI / 2 - 0.5;
    tip.position.set(mx, my + 1.55 * Math.cos(0.5) * 0.62, -1.35 * 0.98);
    rack.add(tip);
  }
  g.add(rack);
  g.userData.rack = rack;
  // ammo crates
  g.add(box(1.4, 0.8, 0.9, m.wood, 2.4, 0.4, 2.2));
  g.add(box(1.4, 0.8, 0.9, m.wood, 2.5, 1.2, 2.1));
  return g;
}

export function tunnelNetwork() {
  const m = mats();
  const g = new THREE.Group();
  const mound = new THREE.Mesh(new THREE.SphereGeometry(4.5, 16, 10, 0, Math.PI * 2, 0, Math.PI / 2), m.adobeDark);
  mound.scale.y = 0.55;
  mound.castShadow = mound.receiveShadow = true;
  g.add(mound);
  // entrance
  g.add(box(3, 2.6, 1, m.woodDark, 0, 1.1, 4));
  const hole = new THREE.Mesh(new THREE.CircleGeometry(1.1, 12), m.dark);
  hole.position.set(0, 1.1, 4.52);
  g.add(hole);
  // flag pole
  g.add(cyl(0.06, 0.06, 4.5, m.wood, 2.5, 3.4, 1, 6));
  const flag = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 1), m.green);
  flag.position.set(3.3, 5.1, 1);
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
  g.add(box(w, 3.2, d, wall, 0, 1.6, 0));
  if (variant % 2 === 0) {
    const roof = box(w + 1, 0.22, d + 1.2, m.corrRust, 0, 3.5, 0);
    roof.rotation.x = 0.08;
    g.add(roof);
    // roof weights (tires/blocks)
    const t = new THREE.Mesh(new THREE.TorusGeometry(0.4, 0.16, 6, 10), m.tire);
    t.rotation.x = Math.PI / 2; t.position.set(w * 0.25, 3.75, d * 0.2);
    g.add(t);
  } else {
    g.add(box(w + 0.6, 0.7, d + 0.6, m.adobeDark, 0, 3.4, 0));
  }
  g.add(box(1.3, 2.3, 0.25, m.woodDark, w * 0.2, 1.15, d / 2 + 0.05));
  g.add(box(1.1, 0.95, 0.14, m.dark, -w * 0.25, 2, d / 2 + 0.03));
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
  const dome = new THREE.Mesh(new THREE.SphereGeometry(3.2, 18, 12, 0, Math.PI * 2, 0, Math.PI / 2), m.adobe);
  dome.position.set(0, 5.5, 0); dome.castShadow = true;
  g.add(dome);
  // minaret
  g.add(cyl(0.9, 1.1, 11, m.adobePale, 6.4, 5.5, -2.5, 10));
  g.add(cyl(1.25, 1.25, 0.8, m.adobe, 6.4, 11.2, -2.5, 10));
  const cap = new THREE.Mesh(new THREE.ConeGeometry(1.1, 1.8, 10), m.green);
  cap.position.set(6.4, 12.5, -2.5); cap.castShadow = true;
  g.add(cap);
  for (const wx of [-2.8, 0, 2.8]) {
    g.add(box(1.3, 2.4, 0.15, m.window, wx, 2.6, 4.05));
  }
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
  // motor + tank
  g.add(box(1.4, 1, 1, m.metalDark, -1.8, 0.9, 0));
  const tank = cyl(1.5, 1.5, 3.2, m.metalRust, 3.8, 1.6, -2.6, 14);
  g.add(tank);
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
  g.add(box(len, 2.8, 0.9, m.adobeDark, 0, 1.4, 0));
  g.add(box(len, 0.5, 1.15, m.adobe, 0, 2.9, 0));
  // crenellation
  for (let i = 0; i < len / 2; i++) {
    g.add(box(0.9, 0.5, 1, m.adobeDark, -len / 2 + 1 + i * 2, 3.4, 0));
  }
  return g;
}

export function gateArch() {
  const m = mats();
  const g = new THREE.Group();
  g.add(box(2.2, 6.5, 2.2, m.adobe, -4.6, 3.25, 0));
  g.add(box(2.2, 6.5, 2.2, m.adobe, 4.6, 3.25, 0));
  g.add(box(11.5, 1.6, 2.4, m.adobeDark, 0, 7, 0));
  g.add(box(1, 0.8, 1, m.gold, 0, 8.2, 0));
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
  for (let i = 0; i < 9; i++) {
    const a = (i / 9) * Math.PI * 2;
    const frond = new THREE.Mesh(new THREE.PlaneGeometry(0.55 * scale, 3.2 * scale, 1, 4), m.frond);
    const fp = frond.geometry.attributes.position;
    for (let v = 0; v < fp.count; v++) {
      const y = fp.getY(v);
      fp.setX(v, fp.getX(v) * (1 - Math.abs(y) / (1.8 * scale)));
      fp.setZ(v, -Math.pow(y + 1.6 * scale, 2) * 0.09);
    }
    frond.geometry.computeVertexNormals();
    frond.position.set(topX, topY, 0);
    frond.rotation.y = a;
    frond.rotation.x = -0.7;
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
