// vehicles.js — cartel armour: Scorpion-style tank & armed technical, with combat AI
import * as THREE from 'three';
import { G, makeRng, clamp } from './core.js';
import { metalPanels, fabric } from './textures.js';
import { explodeAt } from './weapons.js';

const rng = makeRng(9911);

let VM = null;
function vmats() {
  if (VM) return VM;
  VM = {
    hullTan: new THREE.MeshStandardMaterial({ map: metalPanels('#8a7a52', 12), roughness: 0.75, metalness: 0.25 }),
    hullGreen: new THREE.MeshStandardMaterial({ map: metalPanels('#5f6448', 13), roughness: 0.75, metalness: 0.25 }),
    dark: new THREE.MeshStandardMaterial({ color: 0x24241f, roughness: 0.9 }),
    track: new THREE.MeshStandardMaterial({ color: 0x1e1d1a, roughness: 1 }),
    tire: new THREE.MeshStandardMaterial({ color: 0x181818, roughness: 1 }),
    truckPaint: new THREE.MeshStandardMaterial({ map: metalPanels('#9a8a6a', 14), roughness: 0.6, metalness: 0.3 }),
    glass: new THREE.MeshStandardMaterial({ color: 0x20262c, roughness: 0.15, metalness: 0.7 }),
    gun: new THREE.MeshStandardMaterial({ color: 0x2c2c2e, roughness: 0.5, metalness: 0.55 }),
    canvasBed: new THREE.MeshStandardMaterial({ map: fabric('#6b6448', 991), roughness: 1 }),
  };
  return VM;
}

function box(w, h, d, mat, x = 0, y = 0, z = 0, g = null) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, y, z);
  m.castShadow = m.receiveShadow = true;
  g?.add(m);
  return m;
}
function cyl(r1, r2, h, mat, x, y, z, g, seg = 12) {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(r1, r2, h, seg), mat);
  m.position.set(x, y, z);
  m.castShadow = true;
  g?.add(m);
  return m;
}

function buildTank() {
  const m = vmats();
  const g = new THREE.Group();
  // hull with angled glacis
  const hull = box(2.6, 0.75, 4.6, m.hullTan, 0, 1.0, 0, g);
  const glacis = box(2.5, 0.7, 1.3, m.hullTan, 0, 1.12, -2.35, g);
  glacis.rotation.x = -0.5;
  const rear = box(2.4, 0.6, 0.8, m.hullTan, 0, 1.05, 2.5, g);
  rear.rotation.x = 0.4;
  // side skirts + tracks
  for (const s of [-1, 1]) {
    box(0.55, 0.72, 4.9, m.track, s * 1.45, 0.62, 0, g);
    box(0.6, 0.2, 4.9, m.hullTan, s * 1.45, 1.1, 0, g);
    for (let i = 0; i < 5; i++) {
      const w = cyl(0.34, 0.34, 0.2, m.dark, s * 1.48, 0.36, -1.7 + i * 0.85, g, 10);
      w.rotation.z = Math.PI / 2;
    }
  }
  // turret — low rounded scorpion style
  const turret = new THREE.Group();
  turret.position.set(0, 1.6, -0.2);
  g.add(turret);
  const tur = box(1.7, 0.55, 2.1, m.hullTan, 0, 0.2, 0, turret);
  const mantlet = box(0.7, 0.45, 0.5, m.dark, 0, 0.18, -1.15, turret);
  const gunPivot = new THREE.Group();
  gunPivot.position.set(0, 0.2, -1.2);
  turret.add(gunPivot);
  const barrel = cyl(0.09, 0.11, 3.4, m.gun, 0, 0, -1.7, gunPivot, 10);
  barrel.rotation.x = Math.PI / 2;
  cyl(0.13, 0.13, 0.5, m.gun, 0, 0, -3.1, gunPivot, 10).rotation.x = Math.PI / 2;
  // hatch, stowage, antenna
  cyl(0.3, 0.32, 0.12, m.hullGreen, -0.4, 0.52, 0.4, turret, 10);
  box(0.8, 0.25, 0.5, m.canvasBed, 0.5, 0.42, 0.7, turret);
  const ant = cyl(0.015, 0.015, 1.8, m.dark, 0.7, 1.3, 0.8, turret, 5);
  ant.rotation.z = 0.12;
  // spikes on front (scorpion vibe)
  for (const sx of [-0.9, -0.3, 0.3, 0.9]) {
    const spike = new THREE.Mesh(new THREE.ConeGeometry(0.07, 0.4, 6), m.dark);
    spike.position.set(sx, 1.32, -2.95);
    spike.rotation.x = -Math.PI / 2 + 0.35;
    spike.castShadow = true;
    g.add(spike);
  }
  return { group: g, turret, gunPivot, muzzle: new THREE.Vector3(0, 0, -3.4) };
}

function buildTechnical() {
  const m = vmats();
  const g = new THREE.Group();
  // pickup body
  box(1.8, 0.55, 4.2, m.truckPaint, 0, 0.85, 0, g);                    // chassis/bed sides
  const cab = box(1.75, 0.7, 1.5, m.truckPaint, 0, 1.45, -0.9, g);
  const hood = box(1.7, 0.45, 1.1, m.truckPaint, 0, 1.05, -2.0, g);
  box(1.6, 0.5, 0.1, m.glass, 0, 1.5, -1.68, g);                       // windshield
  box(1.55, 0.42, 0.08, m.glass, 0, 1.45, -0.14, g);                   // rear glass
  // bed
  box(1.7, 0.45, 1.9, m.dark, 0, 0.95, 1.1, g);
  // wheels
  for (const [wx, wz] of [[-0.95, -1.6], [0.95, -1.6], [-0.95, 1.4], [0.95, 1.4]]) {
    const w = cyl(0.42, 0.42, 0.3, m.tire, wx, 0.42, wz, g, 12);
    w.rotation.z = Math.PI / 2;
    cyl(0.18, 0.18, 0.32, m.dark, wx, 0.42, wz, g, 8).rotation.z = Math.PI / 2;
  }
  // bull bar + roll cage on bed
  box(1.6, 0.5, 0.08, m.dark, 0, 0.85, -2.6, g);
  // mounted heavy gun on pintle
  const turret = new THREE.Group();
  turret.position.set(0, 1.5, 1.1);
  g.add(turret);
  cyl(0.06, 0.08, 0.7, m.gun, 0, 0, 0, turret, 8);
  const gunPivot = new THREE.Group();
  gunPivot.position.set(0, 0.42, 0);
  turret.add(gunPivot);
  const gunBody = box(0.16, 0.2, 1.1, m.gun, 0, 0, -0.3, gunPivot);
  const gunBarrel = cyl(0.035, 0.035, 1.0, m.gun, 0, 0.02, -1.3, gunPivot, 8);
  gunBarrel.rotation.x = Math.PI / 2;
  box(0.3, 0.35, 0.04, m.dark, 0, 0.05, 0.35, gunPivot);               // shield-ish plate
  return { group: g, turret, gunPivot, muzzle: new THREE.Vector3(0, 0.02, -1.85) };
}

export class Vehicle {
  constructor(type, x, z, { path = null, guard = false, yaw = 0 } = {}) {
    const built = type === 'tank' ? buildTank() : buildTechnical();
    this.type = type;
    this.group = built.group;
    this.turret = built.turret;
    this.gunPivot = built.gunPivot;
    this.muzzleLocal = built.muzzle;
    this.group.position.set(x, G.groundHeight(x, z), z);
    this.group.rotation.y = yaw;
    this.group.userData.vehicle = this;
    this.group.traverse(o => { o.userData.vehicle = this; });
    G.scene.add(this.group);

    this.hp = type === 'tank' ? 320 : 140;
    this.maxHp = this.hp;
    this.dead = false;
    this.path = path;               // array of Vector3 to loop
    this.pathIdx = 0;
    this.guard = guard;
    this.speed = type === 'tank' ? 3.2 : 5.5;
    this.aware = false;
    this.fireT = 2 + rng() * 2;
    this.burst = 0;
    this.losT = 0; this.hasLOS = false;
    this.smoking = false;
    this.dustT = 0;
    this.ray = new THREE.Raycaster();
    G.vehicles.push(this);
  }

  damage(amount, hitPos) {
    if (this.dead) return;
    this.hp -= amount;
    this.aware = true;
    if (this.hp < this.maxHp * 0.45 && !this.smoking) {
      this.smoking = true;
      G.fx?.attachSmoke(this.group, 1.2);
    }
    if (this.hp <= 0) this.die();
  }

  die() {
    this.dead = true;
    const p = this.group.position.clone();
    p.y += 1.2;
    explodeAt(p, 8, 120, true);
    G.stats.kills++;
    // blacken and pop the turret
    this.group.traverse(o => {
      if (o.isMesh) {
        o.material = o.material.clone();
        o.material.color = new THREE.Color(0x1c1a16);
        if (o.material.map) o.material.map = null;
      }
    });
    if (this.turret) {
      this.turret.rotation.z = 0.5;
      this.turret.position.y += 0.35;
      this.turret.rotation.y += 0.8;
    }
    G.fx?.attachSmoke(this.group, 1.6);
    import('./hud.js').then(h => h.onKill(this, true));
  }

  muzzleWorld() {
    return this.gunPivot.localToWorld(this.muzzleLocal.clone());
  }

  checkLOS() {
    const from = this.group.position.clone().add(new THREE.Vector3(0, 2.2, 0));
    const to = G.camera.getWorldPosition(new THREE.Vector3());
    const d = from.distanceTo(to);
    if (d > 130) return false;
    const dir = to.sub(from).normalize();
    this.ray.set(from, dir);
    this.ray.far = d - 1;
    const hits = this.ray.intersectObjects(G.shootables, true);
    for (const h of hits) if (h.object.visible) return false;
    return true;
  }

  update(dt) {
    if (this.dead) return;
    const playerPos = G.player.pos;
    const dist = this.group.position.distanceTo(playerPos);

    this.losT -= dt;
    if (this.losT <= 0) {
      this.losT = 0.35;
      this.hasLOS = dist < 130 ? this.checkLOS() : false;
      if (this.hasLOS && dist < 80) this.aware = true;
    }

    // drive along patrol path when not engaged
    let moving = false;
    if (this.path && (!this.aware || dist > 60)) {
      const wp = this.path[this.pathIdx];
      const to = wp.clone().setY(0).sub(new THREE.Vector3(this.group.position.x, 0, this.group.position.z));
      if (to.length() < 4) {
        this.pathIdx = (this.pathIdx + 1) % this.path.length;
      } else {
        to.normalize();
        const targetYaw = Math.atan2(-to.x, -to.z) + Math.PI;
        this.group.rotation.y = angleDamp(this.group.rotation.y, targetYaw, 2.2, dt);
        const fwd = new THREE.Vector3(-Math.sin(this.group.rotation.y), 0, -Math.cos(this.group.rotation.y));
        this.group.position.addScaledVector(fwd, this.speed * dt);
        this.group.position.y = G.groundHeight(this.group.position.x, this.group.position.z);
        moving = true;
      }
    }

    // dust from wheels while moving
    if (moving) {
      this.dustT -= dt;
      if (this.dustT <= 0) {
        this.dustT = 0.1;
        const back = new THREE.Vector3(Math.sin(this.group.rotation.y), 0, Math.cos(this.group.rotation.y));
        const p = this.group.position.clone().addScaledVector(back, 2).add(new THREE.Vector3(0, 0.3, 0));
        G.fx.smoke.spawn(p, {
          vel: new THREE.Vector3((rng() - 0.5), 0.6, (rng() - 0.5)),
          size: 1.0, grow: 2.2, life: 1.2, opacity: 0.28, tint: 0xc0aa84,
        });
      }
    }

    // turret tracking
    if (this.aware && this.turret) {
      const local = this.group.worldToLocal(playerPos.clone().add(new THREE.Vector3(0, 1, 0)));
      local.sub(this.turret.position);
      const yaw = Math.atan2(-local.x, -local.z);
      this.turret.rotation.y = angleDamp(this.turret.rotation.y, yaw, 3, dt);
      const horiz = Math.hypot(local.x, local.z);
      const pitch = clamp(Math.atan2(local.y, horiz), -0.12, 0.5);
      this.gunPivot.rotation.x = angleDamp(this.gunPivot.rotation.x, pitch, 3, dt);
    } else if (this.turret) {
      this.turret.rotation.y = angleDamp(this.turret.rotation.y, 0, 1, dt);
    }

    // firing
    if (this.aware && this.hasLOS) {
      this.fireT -= dt;
      if (this.fireT <= 0) {
        if (this.type === 'tank') {
          this.fireT = 3.6 + rng() * 1.4;
          this.fireCannon();
        } else {
          if (this.burst > 0) {
            this.burst--;
            this.fireT = 0.11;
            this.fireMG(dist);
          } else {
            this.burst = 5 + Math.floor(rng() * 5);
            this.fireT = 1.1 + rng() * 1.2;
          }
        }
      }
    }
  }

  fireCannon() {
    const muzzle = this.muzzleWorld();
    const target = G.camera.getWorldPosition(new THREE.Vector3());
    target.x += (rng() - 0.5) * 6;
    target.z += (rng() - 0.5) * 6;
    const dir = target.sub(muzzle).normalize();
    G.fx.muzzleFlash(muzzle, dir);
    G.fx.flash.spawn(muzzle, { size: 2.2, life: 0.08, opacity: 1 });
    G.fx.light(muzzle, 0xffbb66, 30, 0.12, 25);
    G.audio?.explosion(0.5);
    G.fx.shake(clamp(1 - muzzle.distanceTo(G.player.pos) / 90, 0, 0.5));
    // shell: fast projectile simulated instantly along a ray with slight travel
    const shell = { pos: muzzle.clone(), dir, speed: 90, life: 3 };
    (this.shells ||= []).push(shell);
    const step = () => {
      for (let i = 0; i < 3; i++) {
        shell.pos.addScaledVector(shell.dir, shell.speed * 0.016);
        G.fx.smoke.spawn(shell.pos, { size: 0.2, grow: 0.4, life: 0.4, opacity: 0.3, tint: 0xd8d0c0 });
        const gy = G.groundHeight(shell.pos.x, shell.pos.z);
        if (shell.pos.y <= gy || shell.pos.distanceTo(G.player.pos) < 1.4) {
          shell.pos.y = Math.max(shell.pos.y, gy + 0.2);
          explodeAt(shell.pos, 5.5, 70);
          return;
        }
        for (const c of G.colliders) {
          if (c.box.containsPoint(shell.pos)) {
            explodeAt(shell.pos, 5.5, 70);
            return;
          }
        }
      }
      shell.life -= 0.048;
      if (shell.life > 0) requestAnimationFrame(step);
    };
    step();
  }

  fireMG(dist) {
    const muzzle = this.muzzleWorld();
    const target = G.camera.getWorldPosition(new THREE.Vector3());
    const hitChance = clamp(0.3 - dist * 0.002, 0.05, 0.3);
    const hit = rng() < hitChance;
    if (!hit) {
      target.x += (rng() - 0.5) * 4;
      target.y += (rng() - 0.5) * 2.5;
      target.z += (rng() - 0.5) * 4;
    }
    G.fx.muzzleFlash(muzzle, target.clone().sub(muzzle).normalize());
    G.fx.tracer(muzzle, target, 260);
    G.audio?.enemyShot(dist);
    if (hit) G.player.takeDamage(7 + rng() * 5, this.group.position);
  }
}

function angleDamp(a, b, l, dt) {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return a + d * (1 - Math.exp(-l * dt));
}
