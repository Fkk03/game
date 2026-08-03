// soldiers.js — enemy infantry: procedural articulated model + combat AI
import * as THREE from 'three';
import { G, makeRng, clamp, damp } from './core.js';
import { fabric } from './textures.js';

const rng = makeRng(7777);

// bandolier strap: leather with brass cartridge rows (tiny local canvas)
let BANDO = null;
function bandolierTex() {
  if (BANDO) return BANDO;
  const c = document.createElement('canvas');
  c.width = 16; c.height = 64;
  const x = c.getContext('2d');
  x.fillStyle = '#453320'; x.fillRect(0, 0, 16, 64);
  x.fillStyle = 'rgba(0,0,0,0.35)'; x.fillRect(0, 0, 2, 64); x.fillRect(14, 0, 2, 64);
  for (let i = 0; i < 8; i++) {
    x.fillStyle = '#b28f43'; x.fillRect(3, i * 8 + 2, 10, 4);   // brass rounds
    x.fillStyle = 'rgba(255,255,255,0.35)'; x.fillRect(3, i * 8 + 2, 10, 1);
  }
  BANDO = new THREE.CanvasTexture(c);
  BANDO.colorSpace = THREE.SRGBColorSpace;
  return BANDO;
}

// shared materials (cartel fighter: headwrap, tunic, chest rig, baggy pants)
let SM = null;
function smats() {
  if (SM) return SM;
  SM = {
    skin: new THREE.MeshStandardMaterial({ color: 0x9a7350, roughness: 0.9 }),
    tunic: new THREE.MeshStandardMaterial({ map: fabric('#7a6f52', 771), roughness: 1 }),
    tunic2: new THREE.MeshStandardMaterial({ map: fabric('#6b5f45', 772), roughness: 1 }),
    wrapR: new THREE.MeshStandardMaterial({ map: fabric('#8a2f24', 773), roughness: 1 }),
    wrapW: new THREE.MeshStandardMaterial({ map: fabric('#cfc5ae', 774), roughness: 1 }),
    wrapK: new THREE.MeshStandardMaterial({ map: fabric('#3a3a34', 775), roughness: 1 }),
    vest: new THREE.MeshStandardMaterial({ color: 0x46422f, roughness: 1 }),
    pants: new THREE.MeshStandardMaterial({ map: fabric('#5c5645', 776), roughness: 1 }),
    boots: new THREE.MeshStandardMaterial({ color: 0x2e2820, roughness: 0.9 }),
    belt: new THREE.MeshStandardMaterial({ color: 0x39301f, roughness: 0.95 }),
    bando: new THREE.MeshStandardMaterial({ map: bandolierTex(), roughness: 0.85 }),
    gun: new THREE.MeshStandardMaterial({ color: 0x232325, roughness: 0.55, metalness: 0.55 }),
    gunWood: new THREE.MeshStandardMaterial({ color: 0x7a4c2a, roughness: 0.75 }),
  };
  return SM;
}

function part(geo, mat, x, y, z, group) {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  m.castShadow = true;
  (group || null)?.add(m);
  return m;
}

function buildSoldierMesh() {
  const m = smats();
  const root = new THREE.Group();

  const hips = new THREE.Group();
  hips.position.y = 0.94;
  root.add(hips);

  // legs (pivot at hip) — baggy trousers tucked into boots
  const legL = new THREE.Group(), legR = new THREE.Group();
  legL.position.set(-0.12, 0, 0); legR.position.set(0.12, 0, 0);
  for (const [leg, side] of [[legL, -1], [legR, 1]]) {
    part(new THREE.BoxGeometry(0.18, 0.5, 0.21), m.pants, 0, -0.25, 0, leg);      // baggy thigh
    part(new THREE.BoxGeometry(0.15, 0.4, 0.17), m.pants, 0, -0.66, 0.01, leg);   // shin
    part(new THREE.BoxGeometry(0.155, 0.09, 0.18), m.boots, 0, -0.845, 0.015, leg); // ankle wrap
    part(new THREE.BoxGeometry(0.15, 0.11, 0.26), m.boots, 0, -0.90, 0.045, leg);  // boot
    hips.add(leg);
  }

  // torso (pivot at waist) — narrower tunic, chest rig, bandolier, belt
  const torso = new THREE.Group();
  torso.position.y = 0.06;
  hips.add(torso);
  const tun = rng() < 0.5 ? m.tunic : m.tunic2;
  const tun2 = tun === m.tunic ? m.tunic2 : m.tunic;
  part(new THREE.BoxGeometry(0.38, 0.56, 0.23), tun, 0, 0.32, 0, torso);
  part(new THREE.BoxGeometry(0.41, 0.30, 0.29), m.vest, 0, 0.40, 0, torso);       // chest rig
  part(new THREE.BoxGeometry(0.42, 0.07, 0.26), m.belt, 0, 0.06, 0, torso);       // waist belt
  part(new THREE.BoxGeometry(0.10, 0.13, 0.06), tun2, -0.13, 0.06, -0.115, torso); // canteen on belt
  // ammo pouches on the rig front
  part(new THREE.BoxGeometry(0.09, 0.13, 0.05), m.belt, -0.12, 0.36, 0.16, torso);
  part(new THREE.BoxGeometry(0.09, 0.13, 0.05), m.belt, 0.01, 0.36, 0.16, torso);
  part(new THREE.BoxGeometry(0.09, 0.13, 0.05), m.belt, 0.14, 0.36, 0.16, torso);
  // bandolier: shoulder-R to hip-L across the chest
  const bando = part(new THREE.BoxGeometry(0.11, 0.62, 0.035), m.bando, -0.015, 0.32, 0.155, torso);
  bando.rotation.z = 0.62;
  const bandoBack = part(new THREE.BoxGeometry(0.11, 0.58, 0.03), m.belt, -0.015, 0.32, -0.135, torso);
  bandoBack.rotation.z = -0.62;

  // head + oversized headwrap with face cloth (only an eye strip of skin shows)
  const head = new THREE.Group();
  head.position.y = 0.68;
  torso.add(head);
  part(new THREE.BoxGeometry(0.2, 0.24, 0.21), m.skin, 0, 0.1, 0.01, head);
  const wrapMat = [m.wrapR, m.wrapW, m.wrapK][Math.floor(rng() * 3)];
  part(new THREE.BoxGeometry(0.21, 0.1, 0.225), wrapMat, 0, 0.045, 0.02, head);   // face cloth over mouth
  part(new THREE.BoxGeometry(0.28, 0.17, 0.29), wrapMat, 0, 0.245, 0, head);      // wrap dome
  part(new THREE.BoxGeometry(0.29, 0.075, 0.30), wrapMat, 0, 0.155, 0, head);     // wrap brim
  part(new THREE.BoxGeometry(0.05, 0.05, 0.05), wrapMat, 0.12, 0.19, 0.13, head); // knot
  // scarf tails draping down the back
  const tail1 = part(new THREE.BoxGeometry(0.10, 0.30, 0.035), wrapMat, 0.05, -0.02, -0.145, head);
  tail1.rotation.x = 0.12;
  const tail2 = part(new THREE.BoxGeometry(0.08, 0.22, 0.03), wrapMat, -0.045, 0.0, -0.15, head);
  tail2.rotation.x = 0.2;

  // arms (pivot at shoulder) — posed holding a rifle
  const armL = new THREE.Group(), armR = new THREE.Group();
  armL.position.set(-0.245, 0.54, 0); armR.position.set(0.245, 0.54, 0);
  torso.add(armL, armR);
  for (const arm of [armL, armR]) {
    part(new THREE.BoxGeometry(0.135, 0.14, 0.15), tun, 0, -0.03, 0, arm);        // shoulder
    part(new THREE.BoxGeometry(0.12, 0.30, 0.135), tun, 0, -0.16, 0, arm);        // upper arm
    part(new THREE.BoxGeometry(0.10, 0.28, 0.11), tun2, 0, -0.40, 0.02, arm);     // forearm (rolled sleeve)
    part(new THREE.BoxGeometry(0.085, 0.10, 0.095), m.skin, 0, -0.555, 0.04, arm); // hand
  }

  // rifle — AK silhouette: wood stock/handguard, curved mag, long barrel + front sight
  // (child of the right arm; rotation.x is counter-set every frame so it stays level)
  const gun = new THREE.Group();
  gun.position.set(-0.04, -0.56, 0.10);
  gun.rotation.y = -0.42;
  gun.rotation.x = 0.55 - 0.25;
  armR.add(gun);
  part(new THREE.BoxGeometry(0.06, 0.095, 0.46), m.gun, 0, 0, -0.02, gun);          // receiver
  const stock = part(new THREE.BoxGeometry(0.05, 0.11, 0.26), m.gunWood, 0, -0.015, 0.32, gun);
  stock.rotation.x = -0.12;
  part(new THREE.BoxGeometry(0.058, 0.08, 0.2), m.gunWood, 0, 0.005, -0.3, gun);    // handguard
  part(new THREE.BoxGeometry(0.045, 0.10, 0.055), m.gunWood, 0, -0.09, 0.1, gun);   // pistol grip
  const mag = part(new THREE.BoxGeometry(0.05, 0.17, 0.08), m.gun, 0, -0.11, -0.06, gun); // curved mag
  mag.rotation.x = 0.45;
  const barrel = part(new THREE.CylinderGeometry(0.018, 0.018, 0.34, 6), m.gun, 0, 0.01, -0.5, gun);
  barrel.rotation.x = Math.PI / 2;
  part(new THREE.BoxGeometry(0.02, 0.06, 0.03), m.gun, 0, 0.04, -0.62, gun);        // front sight post
  gun.userData.muzzleLocal = new THREE.Vector3(0, 0.01, -0.69);

  return { root, hips, torso, head, legL, legR, armL, armR, gun };
}

const STATE = { PATROL: 0, COMBAT: 1, DEAD: 2 };

export class Soldier {
  constructor(x, z, { anchor = null, patrolRadius = 12, tower = null } = {}) {
    const parts = buildSoldierMesh();
    this.parts = parts;
    this.group = parts.root;
    this.group.position.set(x, G.groundHeight(x, z), z);
    this.group.userData.soldier = this;
    this.group.traverse(o => { o.userData.soldier = this; });
    G.scene.add(this.group);
    this.hitMesh = this.group;

    this.hp = 100;
    this.dead = false;
    this.state = STATE.PATROL;
    this.anchor = anchor || new THREE.Vector3(x, 0, z);
    this.patrolRadius = patrolRadius;
    this.tower = tower;              // static guard on a tower platform
    this.wp = null;
    this.speed = 3.1 + rng() * 0.8;
    this.yaw = rng() * Math.PI * 2;
    this.fireT = 1 + rng() * 2;
    this.burst = 0;
    this.losT = 0; this.hasLOS = false;
    this.aware = false;
    this.walkT = rng() * 9;
    this.deathT = 0;
    this.strafeDir = rng() < 0.5 ? 1 : -1;
    this.strafeT = 0;
    this.ray = new THREE.Raycaster();
    G.enemies.push(this);
  }

  damage(amount, fromPos) {
    if (this.dead) return;
    this.hp -= amount;
    this.alert();
    if (this.hp <= 0) this.die();
  }

  alert() {
    if (this.dead) return;
    this.aware = true;
    this.state = STATE.COMBAT;
    // alert nearby friends
    for (const e of G.enemies) {
      if (!e.dead && !e.aware && e.group.position.distanceTo(this.group.position) < 30) {
        e.aware = true; e.state = STATE.COMBAT;
      }
    }
  }

  die() {
    this.dead = true;
    this.state = STATE.DEAD;
    this.deathT = 0;
    this.deathDir = rng() < 0.5 ? 1 : -1;
    G.stats.kills++;
    import('./hud.js').then(h => h.onKill(this));
  }

  eyePos() {
    return this.group.position.clone().add(new THREE.Vector3(0, 1.55, 0));
  }

  checkLOS() {
    const from = this.eyePos();
    const to = G.camera.getWorldPosition(new THREE.Vector3());
    const dir = to.clone().sub(from);
    const dist = dir.length();
    if (dist > 90) return false;
    dir.normalize();
    this.ray.set(from, dir);
    this.ray.far = dist - 0.5;
    const hits = this.ray.intersectObjects(G.shootables, true);
    for (const h of hits) {
      if (h.object.name === 'terrain' || h.object.visible) return false;
    }
    return true;
  }

  fireAtPlayer(dist) {
    const gun = this.parts.gun;
    const muzzle = gun.localToWorld(gun.userData.muzzleLocal.clone());
    const target = G.camera.getWorldPosition(new THREE.Vector3());
    // accuracy falls with range and player speed
    const playerSpeed = Math.hypot(G.player.vel.x, G.player.vel.z);
    const hitChance = clamp(0.34 - dist * 0.0028 - playerSpeed * 0.024
      - (G.player.crouch ? 0.06 : 0), 0.04, 0.4);
    const hit = rng() < hitChance;
    if (!hit) {
      target.x += (rng() - 0.5) * 3.2;
      target.y += (rng() - 0.5) * 2.2;
      target.z += (rng() - 0.5) * 3.2;
    }
    G.fx.muzzleFlash(muzzle, target.clone().sub(muzzle).normalize());
    G.fx.tracer(muzzle, target, 220);
    G.audio?.enemyShot(dist);
    if (hit) G.player.takeDamage(5 + rng() * 5, this.group.position);
  }

  update(dt) {
    const P = this.parts;
    if (this.dead) {
      // death fall: complete collapse, limbs splay, body settles into the sand
      this.deathT += dt;
      const t = Math.min(1, this.deathT * 2.1);
      const e = 1 - Math.pow(1 - t, 3);
      const dir = this.deathDir > 0 ? 1 : -0.94;
      this.group.rotation.x = -e * (Math.PI / 2) * dir;
      this.group.rotation.z = e * 0.12 * this.deathDir;
      this.group.position.y = G.groundHeight(this.group.position.x, this.group.position.z)
        - e * 0.04;
      P.hips.position.y = damp(P.hips.position.y, 0.94, 6, dt);
      P.legL.rotation.x = damp(P.legL.rotation.x, 0.22, 5, dt);
      P.legR.rotation.x = damp(P.legR.rotation.x, -0.12, 5, dt);
      P.armR.rotation.x = damp(P.armR.rotation.x, -0.3, 5, dt);
      P.armL.rotation.x = damp(P.armL.rotation.x, -0.15, 5, dt);
      P.armL.rotation.z = damp(P.armL.rotation.z, 0.85, 5, dt);
      P.armR.rotation.z = damp(P.armR.rotation.z, -0.45, 5, dt);
      // body pitches ~90°, so tip the rifle up along the torso axis → it lies flat on the ground
      P.gun.rotation.x = damp(P.gun.rotation.x, -P.armR.rotation.x + 1.25, 5, dt);
      P.head.rotation.z = damp(P.head.rotation.z, 0.35 * this.deathDir, 5, dt);
      P.torso.rotation.x = damp(P.torso.rotation.x, 0, 5, dt);
      return;
    }

    const playerPos = G.player.pos;
    const dist = this.group.position.distanceTo(playerPos);

    // periodic LOS + detection
    this.losT -= dt;
    if (this.losT <= 0) {
      this.losT = 0.25 + rng() * 0.15;
      this.hasLOS = dist < 90 ? this.checkLOS() : false;
      if (!this.aware && this.hasLOS && dist < (G.player.crouch ? 34 : 55)) this.alert();
    }

    if (this.state === STATE.PATROL) {
      if (!this.tower) {
        if (!this.wp || this.group.position.distanceTo(this.wp) < 1.2) {
          const a = rng() * Math.PI * 2;
          this.wp = new THREE.Vector3(
            this.anchor.x + Math.cos(a) * rng() * this.patrolRadius, 0,
            this.anchor.z + Math.sin(a) * rng() * this.patrolRadius);
        }
        this.moveToward(this.wp, this.speed * 0.45, dt);
        this.animWalk(dt, 0.5);
      } else {
        this.animIdle(dt);
      }
      // relaxed pose: rifle held low across the chest, muzzle tipped down
      P.armR.rotation.x = damp(P.armR.rotation.x, -0.55, 6, dt);
      P.armL.rotation.x = damp(P.armL.rotation.x, -0.58, 6, dt);
      P.armL.rotation.z = damp(P.armL.rotation.z, 0.38, 6, dt);
      P.gun.rotation.y = damp(P.gun.rotation.y, -0.42, 6, dt);
      P.gun.rotation.x = damp(P.gun.rotation.x, -P.armR.rotation.x - 0.28, 6, dt);
      P.torso.rotation.x = damp(P.torso.rotation.x, 0, 6, dt);
      return;
    }

    // ---- COMBAT ----
    // face player
    const toP = playerPos.clone().sub(this.group.position);
    const targetYaw = Math.atan2(-toP.x, -toP.z) + Math.PI;
    this.yaw = angleDamp(this.yaw, targetYaw, 10, dt);
    this.group.rotation.y = this.yaw;

    // aim pose: both arms up, rifle levelled at the player, torso pitch toward player
    P.armR.rotation.x = damp(P.armR.rotation.x, -1.45, 8, dt);
    P.armL.rotation.x = damp(P.armL.rotation.x, -1.3, 8, dt);
    P.armL.rotation.z = damp(P.armL.rotation.z, 0.5, 8, dt);
    P.gun.rotation.y = damp(P.gun.rotation.y, -0.08, 8, dt);
    P.gun.rotation.x = damp(P.gun.rotation.x, -P.armR.rotation.x - 0.05, 8, dt);
    const pitch = Math.atan2(1.5 - toP.length() * 0.01, dist) * 0.3;
    P.torso.rotation.x = damp(P.torso.rotation.x, -pitch, 6, dt);

    // movement: keep 12-35m, strafe
    if (!this.tower) {
      this.strafeT -= dt;
      if (this.strafeT <= 0) {
        this.strafeT = 1.2 + rng() * 1.8;
        this.strafeDir *= rng() < 0.7 ? -1 : 1;
      }
      const fwd = toP.clone().setY(0).normalize();
      const side = new THREE.Vector3(-fwd.z, 0, fwd.x).multiplyScalar(this.strafeDir);
      let move = new THREE.Vector3();
      if (dist > 32) move.add(fwd);
      else if (dist < 13) move.sub(fwd);
      move.addScaledVector(side, 0.7);
      if (move.lengthSq() > 0) {
        move.normalize();
        const next = this.group.position.clone().addScaledVector(move, this.speed * dt);
        if (!this.blocked(next)) {
          this.group.position.copy(next);
          this.group.position.y = G.groundHeight(next.x, next.z);
        } else {
          this.strafeDir *= -1;
        }
        this.animWalk(dt, 1);
      } else {
        this.animIdle(dt);
      }
    }

    // firing: bursts when LOS
    this.fireT -= dt;
    if (this.hasLOS && this.fireT <= 0) {
      if (this.burst > 0) {
        this.burst--;
        this.fireT = 0.09 + rng() * 0.05;
        this.fireAtPlayer(dist);
      } else {
        this.burst = 2 + Math.floor(rng() * 4);
        this.fireT = 0.7 + rng() * 1.3;
      }
    }
  }

  blocked(next) {
    for (const c of G.colliders) {
      const b = c.box;
      if (next.x > b.min.x - 0.3 && next.x < b.max.x + 0.3 &&
        next.z > b.min.z - 0.3 && next.z < b.max.z + 0.3 &&
        b.max.y > this.group.position.y + 0.4) return true;
    }
    return false;
  }

  moveToward(wp, speed, dt) {
    const dir = wp.clone().sub(this.group.position).setY(0);
    if (dir.lengthSq() < 0.01) return;
    dir.normalize();
    const targetYaw = Math.atan2(-dir.x, -dir.z) + Math.PI;
    this.yaw = angleDamp(this.yaw, targetYaw, 6, dt);
    this.group.rotation.y = this.yaw;
    const next = this.group.position.clone().addScaledVector(dir, speed * dt);
    if (!this.blocked(next)) {
      this.group.position.copy(next);
      this.group.position.y = G.groundHeight(next.x, next.z);
    } else {
      this.wp = null;
    }
  }

  animWalk(dt, rate) {
    this.walkT += dt * 7 * rate;
    const s = Math.sin(this.walkT);
    this.parts.legL.rotation.x = s * 0.55;
    this.parts.legR.rotation.x = -s * 0.55;
    this.parts.hips.position.y = 0.94 + Math.abs(Math.cos(this.walkT)) * 0.04;
  }
  animIdle(dt) {
    this.parts.legL.rotation.x = damp(this.parts.legL.rotation.x, 0, 8, dt);
    this.parts.legR.rotation.x = damp(this.parts.legR.rotation.x, 0, 8, dt);
    this.parts.hips.position.y = 0.94 + Math.sin(this.walkT + G.time * 1.2) * 0.008;
  }
}

function angleDamp(a, b, l, dt) {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return a + d * (1 - Math.exp(-l * dt));
}
