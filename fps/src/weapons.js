// weapons.js — viewmodel weapons: carbine (hitscan), RPG (projectile), frag grenades
import * as THREE from 'three';
import { G, clamp, damp, SHOT_MODE } from './core.js';
import { gunMetal } from './textures.js';

const BASE_FOV = 75, ADS_FOV = 52;

const gm = () => new THREE.MeshStandardMaterial({ map: gunMetal(), roughness: 0.55, metalness: 0.6 });
const blk = () => new THREE.MeshStandardMaterial({ color: 0x1f2022, roughness: 0.7, metalness: 0.3 });
const wood = () => new THREE.MeshStandardMaterial({ color: 0x6b4a2a, roughness: 0.85 });
const olive = () => new THREE.MeshStandardMaterial({ color: 0x4a4f3a, roughness: 0.8, metalness: 0.2 });

function vbox(w, h, d, mat, x = 0, y = 0, z = 0) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, y, z);
  return m;
}
function vcyl(r1, r2, h, mat, x = 0, y = 0, z = 0, seg = 12) {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(r1, r2, h, seg), mat);
  m.position.set(x, y, z);
  return m;
}

function buildCarbine() {
  const g = new THREE.Group();
  const metal = gm(), black = blk();
  g.add(vbox(0.055, 0.075, 0.34, metal, 0, 0, 0));                 // receiver
  const barrel = vcyl(0.014, 0.014, 0.34, black, 0, 0.012, -0.42, 10);
  barrel.rotation.x = Math.PI / 2;
  g.add(barrel);
  g.add(vbox(0.05, 0.055, 0.26, black, 0, 0.005, -0.30));          // handguard
  // rail + front sight
  g.add(vbox(0.018, 0.02, 0.30, black, 0, 0.052, -0.18));
  g.add(vbox(0.012, 0.05, 0.012, black, 0, 0.07, -0.40));
  // rear sight / carry
  g.add(vbox(0.03, 0.035, 0.05, black, 0, 0.062, 0.06));
  // stock
  g.add(vbox(0.045, 0.065, 0.22, black, 0, -0.005, 0.26));
  g.add(vbox(0.05, 0.09, 0.05, black, 0, -0.01, 0.36));
  // grip
  const grip = vbox(0.04, 0.11, 0.05, black, 0, -0.085, 0.08);
  grip.rotation.x = 0.35;
  g.add(grip);
  // magazine (curved: two segments)
  const m1 = vbox(0.042, 0.11, 0.07, metal, 0, -0.09, -0.05);
  m1.rotation.x = 0.12;
  g.add(m1);
  const m2 = vbox(0.042, 0.09, 0.065, metal, 0, -0.175, -0.07);
  m2.rotation.x = 0.42;
  g.add(m2);
  // muzzle device
  const mz = vcyl(0.018, 0.018, 0.06, black, 0, 0.012, -0.61, 8);
  mz.rotation.x = Math.PI / 2;
  g.add(mz);
  g.userData.muzzle = new THREE.Vector3(0, 0.012, -0.64);
  return g;
}

function buildRPG() {
  const g = new THREE.Group();
  const tube = vcyl(0.045, 0.045, 0.85, olive(), 0, 0, -0.1, 12);
  tube.rotation.x = Math.PI / 2;
  g.add(tube);
  const flare = vcyl(0.075, 0.045, 0.14, olive(), 0, 0, 0.38, 12);
  flare.rotation.x = Math.PI / 2;
  g.add(flare);
  // warhead
  const wh = vcyl(0.052, 0.09, 0.16, olive(), 0, 0, -0.60, 10);
  wh.rotation.x = Math.PI / 2;
  g.add(wh);
  const tip = new THREE.Mesh(new THREE.ConeGeometry(0.052, 0.22, 10), gm());
  tip.rotation.x = -Math.PI / 2;
  tip.position.set(0, 0, -0.79);
  g.add(tip);
  g.add(vbox(0.035, 0.1, 0.05, wood(), 0, -0.11, 0.05));
  g.add(vbox(0.035, 0.09, 0.045, wood(), 0, -0.10, 0.22));
  g.add(vbox(0.02, 0.05, 0.09, gm(), 0, 0.07, 0.05)); // sight
  g.userData.muzzle = new THREE.Vector3(0, 0, -0.9);
  return g;
}

function buildGrenadeMesh() {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.SphereGeometry(0.075, 10, 8), olive());
  body.scale.y = 1.25;
  g.add(body);
  g.add(vcyl(0.03, 0.03, 0.05, gm(), 0, 0.11, 0, 8));
  return g;
}

const WEAPONS = {
  carbine: {
    name: 'M8 CARBINE', mag: 30, reserve: 180, dmg: 26, rpm: 720,
    spread: 0.011, adsSpread: 0.0032, auto: true, tracerEvery: 1,
  },
  rpg: {
    name: 'RPG-9', mag: 1, reserve: 6, dmg: 260, rpm: 40,
    spread: 0.004, adsSpread: 0.002, auto: false, projectile: true,
  },
};

export class Weapons {
  constructor() {
    this.rig = new THREE.Group();          // attached to camera
    G.camera.add(this.rig);
    // dedicated fill so the viewmodel never goes silhouette-black
    const fill = new THREE.PointLight(0xfff2dd, 8, 4, 1.2);
    fill.position.set(0.3, 0.4, 0.3);
    G.camera.add(fill);
    this.models = { carbine: buildCarbine(), rpg: buildRPG() };
    for (const k in this.models) {
      this.models[k].visible = false;
      this.models[k].traverse(o => { o.frustumCulled = false; if (o.isMesh) o.castShadow = false; });
      this.rig.add(this.models[k]);
    }
    this.current = 'carbine';
    this.models.carbine.visible = true;
    this.ammo = {
      carbine: { mag: 30, reserve: 180 },
      rpg: { mag: 1, reserve: 6 },
    };
    this.grenades = 4;
    this.cooldown = 0;
    this.reloading = 0;
    this.ads = false;
    this.raise = 1;                        // 0 lowered → 1 raised
    this.swayX = 0; this.swayY = 0;
    this.kick = 0;
    this.triggerHeld = false;
    this.grenadesInFlight = [];
    this.rockets = [];
    this.ray = new THREE.Raycaster();
    this.ray.far = 500;

    const basePos = new THREE.Vector3(0.22, -0.21, -0.45);
    this.basePos = basePos;
    this.adsPos = new THREE.Vector3(0, -0.115, -0.32);
    this.rig.position.copy(basePos);

    if (!SHOT_MODE) {
      document.addEventListener('mousedown', e => {
        if (G.state !== 'playing') return;
        if (e.button === 0) this.triggerHeld = true;
        if (e.button === 2) this.ads = true;
      });
      document.addEventListener('mouseup', e => {
        if (e.button === 0) this.triggerHeld = false;
        if (e.button === 2) this.ads = false;
      });
      document.addEventListener('contextmenu', e => e.preventDefault());
      document.addEventListener('keydown', e => {
        if (G.state !== 'playing') return;
        if (e.code === 'KeyR') this.startReload();
        if (e.code === 'Digit1') this.switchTo('carbine');
        if (e.code === 'Digit2') this.switchTo('rpg');
        if (e.code === 'KeyG') this.throwGrenade();
      });
    }
  }

  get def() { return WEAPONS[this.current]; }
  get slot() { return this.ammo[this.current]; }

  switchTo(name) {
    if (name === this.current || this.switching) return;
    this.switching = name;
    this.reloading = 0;
  }

  startReload() {
    const a = this.slot;
    if (this.reloading || a.mag >= this.def.mag || a.reserve <= 0) return;
    this.reloading = this.current === 'rpg' ? 2.4 : 1.9;
    G.audio?.reload1();
    setTimeout(() => G.audio?.reload2(), 600);
  }

  muzzleWorld() {
    const model = this.models[this.current];
    return model.localToWorld(model.userData.muzzle.clone());
  }

  fire() {
    const a = this.slot;
    if (a.mag <= 0) {
      G.audio?.dryFire();
      this.startReload();
      this.triggerHeld = this.def.auto ? this.triggerHeld : false;
      return;
    }
    a.mag--;
    this.cooldown = 60 / this.def.rpm;
    G.stats.shotsFired++;
    this.kick = Math.min(1, this.kick + 0.55);
    G.player.recoilPitch += this.current === 'rpg' ? 0.05 : 0.012 + Math.random() * 0.006;
    G.player.recoilYaw += (Math.random() - 0.5) * 0.008;

    const muzzle = this.muzzleWorld();
    const dir = new THREE.Vector3();
    G.camera.getWorldDirection(dir);
    const spread = (this.ads ? this.def.adsSpread : this.def.spread) *
      (1 + (G.player.sprinting ? 3 : 0) + G.player.bobAmt * 0.7);
    dir.x += (Math.random() - 0.5) * 2 * spread;
    dir.y += (Math.random() - 0.5) * 2 * spread;
    dir.z += (Math.random() - 0.5) * 2 * spread;
    dir.normalize();

    G.fx.muzzleFlash(muzzle, dir);

    if (this.def.projectile) {
      G.audio?.rocketLaunch();
      this.spawnRocket(muzzle, dir);
      this.startReload();
      return;
    }

    G.audio?.rifleShot();
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(G.camera.quaternion);
    G.fx.ejectCasing(muzzle.clone().addScaledVector(right, -0.05), right);

    // hitscan
    this.ray.set(G.camera.getWorldPosition(new THREE.Vector3()), dir);
    const hit = this.raycastWorld();
    const end = hit ? hit.point : muzzle.clone().addScaledVector(dir, 300);
    G.fx.tracer(muzzle, end);
    if (hit) this.applyHit(hit, this.def.dmg, dir);
  }

  raycastWorld() {
    const pools = [];
    for (const e of G.enemies) if (!e.dead) pools.push(e.hitMesh);
    for (const v of G.vehicles) if (!v.dead) pools.push(v.group);
    pools.push(...G.shootables);
    const hits = this.ray.intersectObjects(pools, true);
    for (const h of hits) {
      if (!h.object.visible) continue;
      return h;
    }
    return null;
  }

  applyHit(hit, dmg, dir) {
    const o = hit.object;
    // soldier?
    let p = o;
    while (p) {
      if (p.userData.soldier) {
        const s = p.userData.soldier;
        const headshot = hit.point.y > s.group.position.y + 1.45;
        s.damage(headshot ? dmg * 2.4 : dmg, G.player.pos);
        G.stats.shotsHit++;
        G.fx.impact(hit.point, hit.face?.normal, 'flesh');
        G.hud.hitmarker(s.dead);
        if (s.dead) G.audio?.killConfirm(); else G.audio?.hitmarker();
        return;
      }
      if (p.userData.vehicle) {
        p.userData.vehicle.damage(dmg * 0.25, hit.point);
        G.stats.shotsHit++;
        G.fx.impact(hit.point, hit.face?.normal, 'metal');
        G.hud.hitmarker(false);
        G.audio?.ricochet();
        return;
      }
      if (p.userData.destructible) {
        p.userData.destructible.damage(dmg * 0.2, hit.point);
        G.fx.impact(hit.point, hit.face?.normal, 'metal');
        return;
      }
      if (p.userData.explosive) {
        explodeBarrel(p);
        return;
      }
      p = p.parent;
    }
    // terrain / generic
    const type = o.name === 'terrain' ? 'sand' : 'metal';
    G.fx.impact(hit.point, hit.face?.normal, type);
    if (type === 'metal' && Math.random() < 0.3) G.audio?.ricochet();
  }

  spawnRocket(pos, dir) {
    const g = new THREE.Group();
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.5, 8), olive());
    body.rotation.x = Math.PI / 2;
    g.add(body);
    const tip = new THREE.Mesh(new THREE.ConeGeometry(0.07, 0.2, 8), gm());
    tip.rotation.x = -Math.PI / 2;
    tip.position.z = -0.35;
    g.add(tip);
    g.position.copy(pos);
    g.lookAt(pos.clone().add(dir));
    G.scene.add(g);
    this.rockets.push({ g, vel: dir.clone().multiplyScalar(55), life: 6, t: 0 });
  }

  throwGrenade() {
    if (this.grenades <= 0 || G.state !== 'playing') return;
    this.grenades--;
    G.hud?.refreshWeapon();
    const dir = new THREE.Vector3();
    G.camera.getWorldDirection(dir);
    const g = buildGrenadeMesh();
    g.position.copy(G.camera.getWorldPosition(new THREE.Vector3())).addScaledVector(dir, 0.5);
    G.scene.add(g);
    this.grenadesInFlight.push({
      g, vel: dir.multiplyScalar(16).add(new THREE.Vector3(0, 4.5, 0)), fuse: 2.2,
    });
  }

  update(dt) {
    const p = G.player;
    this.cooldown -= dt;

    // weapon switch animation
    if (this.switching) {
      this.raise -= dt * 6;
      if (this.raise <= 0) {
        this.models[this.current].visible = false;
        this.current = this.switching;
        this.switching = null;
        this.models[this.current].visible = true;
        G.hud?.refreshWeapon();
      }
    } else {
      this.raise = Math.min(1, this.raise + dt * 5);
    }

    // reload
    if (this.reloading > 0) {
      this.reloading -= dt;
      if (this.reloading <= 0) {
        const a = this.slot;
        const take = Math.min(this.def.mag - a.mag, a.reserve);
        a.mag += take; a.reserve -= take;
        G.hud?.refreshWeapon();
      }
    }

    // firing
    if (this.triggerHeld && this.cooldown <= 0 && this.reloading <= 0 && this.raise > 0.8
      && G.state === 'playing' && !p.dead) {
      this.fire();
      if (!this.def.auto) this.triggerHeld = false;
      G.hud?.refreshWeapon();
    }

    // FOV + rig position
    const cam = G.camera;
    const targetFov = this.ads ? ADS_FOV : (p.sprinting ? BASE_FOV + 6 : BASE_FOV);
    cam.fov = damp(cam.fov, targetFov, 10, dt);
    cam.updateProjectionMatrix();

    const tp = this.ads ? this.adsPos : this.basePos;
    this.rig.position.x = damp(this.rig.position.x, tp.x, 12, dt);
    this.rig.position.y = damp(this.rig.position.y, tp.y - (this.reloading > 0 ? 0.16 : 0)
      - (1 - this.raise) * 0.35, 12, dt);
    this.rig.position.z = damp(this.rig.position.z, tp.z, 12, dt);

    // sway from look + bob
    this.swayX = damp(this.swayX, clamp(-p.recoilYaw * 2, -0.03, 0.03), 8, dt);
    this.swayY = damp(this.swayY, clamp(p.recoilPitch * 1.5, -0.03, 0.03), 8, dt);
    const bob = Math.sin(p.bobT) * 0.008 * p.bobAmt * (this.ads ? 0.25 : 1);
    const bob2 = Math.abs(Math.cos(p.bobT)) * 0.007 * p.bobAmt * (this.ads ? 0.25 : 1);
    this.kick = damp(this.kick, 0, 11, dt);
    this.rig.position.x += this.swayX + bob;
    this.rig.position.y += this.swayY - bob2;
    this.rig.position.z += this.kick * 0.06;
    this.rig.rotation.x = this.kick * 0.06 + (this.reloading > 0 ? -0.5 : 0);
    this.rig.rotation.z = this.swayX * 2;

    // rockets
    for (let i = this.rockets.length - 1; i >= 0; i--) {
      const r = this.rockets[i];
      r.life -= dt; r.t += dt;
      r.vel.y -= 2.5 * dt;
      const prev = r.g.position.clone();
      r.g.position.addScaledVector(r.vel, dt);
      r.g.lookAt(r.g.position.clone().add(r.vel));
      // exhaust
      G.fx.smoke.spawn(prev, {
        vel: new THREE.Vector3(0, 0.5, 0), size: 0.3, grow: 0.8,
        life: 0.9, opacity: 0.45, tint: 0xbbb5a8,
      });
      G.fx.fire.spawn(prev, { size: 0.22, grow: -0.1, life: 0.12, opacity: 0.9 });
      // collision
      const gy = G.groundHeight(r.g.position.x, r.g.position.z);
      let boom = r.g.position.y <= gy;
      if (!boom) {
        for (const c of G.colliders) {
          if (c.box.containsPoint(r.g.position)) { boom = true; break; }
        }
      }
      if (!boom) {
        for (const e of G.enemies) {
          if (!e.dead && e.group.position.distanceTo(r.g.position) < 1.2) { boom = true; break; }
        }
        for (const v of G.vehicles) {
          if (!v.dead && v.group.position.distanceTo(r.g.position) < 3) { boom = true; break; }
        }
      }
      if (boom || r.life <= 0) {
        G.scene.remove(r.g);
        this.rockets.splice(i, 1);
        r.g.position.y = Math.max(r.g.position.y, gy + 0.3);
        explodeAt(r.g.position, 7, 240, true);
      }
    }

    // grenades
    for (let i = this.grenadesInFlight.length - 1; i >= 0; i--) {
      const n = this.grenadesInFlight[i];
      n.fuse -= dt;
      n.vel.y -= 20 * dt;
      n.g.position.addScaledVector(n.vel, dt);
      n.g.rotation.x += dt * 9;
      const gy = G.groundHeight(n.g.position.x, n.g.position.z) + 0.08;
      if (n.g.position.y < gy) {
        n.g.position.y = gy;
        n.vel.y = Math.abs(n.vel.y) * 0.35;
        n.vel.x *= 0.6; n.vel.z *= 0.6;
      }
      for (const c of G.colliders) {
        if (c.box.containsPoint(n.g.position)) {
          n.vel.x *= -0.4; n.vel.z *= -0.4;
          n.g.position.addScaledVector(n.vel, dt * 2);
          break;
        }
      }
      if (n.fuse <= 0) {
        G.scene.remove(n.g);
        this.grenadesInFlight.splice(i, 1);
        explodeAt(n.g.position, 6, 170, true);
      }
    }

    // crosshair spread feedback
    G.hud?.setSpread(this.ads ? 0 : 6 + p.bobAmt * 8 + this.kick * 14);
  }
}

// area damage helper — hurts enemies, vehicles, destructibles, barrels, player
export function explodeAt(pos, radius, dmg, playerSafe = false) {
  G.fx.explosion(pos, radius * 0.55);
  G.audio?.explosion(radius / 7);
  for (const e of G.enemies) {
    if (e.dead) continue;
    const d = e.group.position.distanceTo(pos);
    if (d < radius) e.damage(dmg * (1 - d / radius), pos);
  }
  for (const v of G.vehicles) {
    if (v.dead) continue;
    const d = v.group.position.distanceTo(pos);
    if (d < radius + 2) v.damage(dmg * (1 - d / (radius + 2)), pos);
  }
  for (const t of G.targets) {
    if (t.dead) continue;
    const p = new THREE.Vector3();
    t.group.getWorldPosition(p);
    const d = p.distanceTo(pos);
    if (d < radius + t.radius) t.damage(dmg * clamp(1 - (d - t.radius) / radius, 0.15, 1), pos);
  }
  for (const b of G.barrels || []) {
    if (b.userData.boomed || !b.userData.explosive) continue;
    if (b.position.distanceTo(pos) < radius) {
      setTimeout(() => explodeBarrel(b), 80 + Math.random() * 160);
    }
  }
  const pd = G.player.pos.distanceTo(pos);
  if (pd < radius * (playerSafe ? 0.7 : 1)) {
    G.player.takeDamage(dmg * 0.4 * (1 - pd / radius), pos);
  }
}

export function explodeBarrel(node) {
  // find the barrel group root
  let b = node;
  while (b && !b.userData.explosive) b = b.parent;
  if (!b || b.userData.boomed) return;
  b.userData.boomed = true;
  b.visible = false;
  const p = new THREE.Vector3();
  b.getWorldPosition(p);
  p.y += 0.6;
  explodeAt(p, 6, 150);
}
