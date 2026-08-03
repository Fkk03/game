// fx.js — particle pools: explosions, smoke, muzzle flash, tracers, debris, decals, shake
import * as THREE from 'three';
import { G, makeRng } from './core.js';
import { spriteFireball, spriteSmoke, spriteFlash, spriteScorch } from './textures.js';

const rng = makeRng(4242);

class SpritePool {
  constructor(scene, tex, count, blending) {
    this.items = [];
    for (let i = 0; i < count; i++) {
      const mat = new THREE.SpriteMaterial({
        map: tex, transparent: true, depthWrite: false,
        blending: blending || THREE.NormalBlending,
      });
      const s = new THREE.Sprite(mat);
      s.visible = false;
      scene.add(s);
      this.items.push({ s, life: 0 });
    }
    this.cursor = 0;
  }
  spawn(pos, { vel = null, size = 1, grow = 0, life = 1, fade = 1, tint = 0xffffff,
    opacity = 1, gravity = 0, rot = 0, rotSpeed = 0 }) {
    const it = this.items[this.cursor];
    this.cursor = (this.cursor + 1) % this.items.length;
    it.s.visible = true;
    it.s.position.copy(pos);
    it.vel = vel ? vel.clone() : new THREE.Vector3();
    it.life = life; it.maxLife = life;
    it.size = size; it.grow = grow; it.fade = fade;
    it.gravity = gravity;
    it.s.material.color.set(tint);
    it.s.material.opacity = opacity;
    it.baseOpacity = opacity;
    it.s.material.rotation = rot;
    it.rotSpeed = rotSpeed;
    it.s.scale.set(size, size, 1);
    return it;
  }
  update(dt) {
    for (const it of this.items) {
      if (it.life <= 0) continue;
      it.life -= dt;
      if (it.life <= 0) { it.s.visible = false; continue; }
      const t = 1 - it.life / it.maxLife;
      it.vel.y += it.gravity * dt;
      it.s.position.addScaledVector(it.vel, dt);
      const sz = it.size + it.grow * t;
      it.s.scale.set(sz, sz, 1);
      it.s.material.opacity = it.baseOpacity * Math.pow(1 - t, it.fade);
      it.s.material.rotation += it.rotSpeed * dt;
    }
  }
}

export class FX {
  constructor() {
    const sc = G.scene;
    this.fire = new SpritePool(sc, spriteFireball(), 90, THREE.AdditiveBlending);
    this.smoke = new SpritePool(sc, spriteSmoke(), 160);
    this.flash = new SpritePool(sc, spriteFlash(), 30, THREE.AdditiveBlending);

    // debris
    this.debris = [];
    const dg = new THREE.BoxGeometry(0.22, 0.22, 0.22);
    const dm = new THREE.MeshStandardMaterial({ color: 0x3a3630, roughness: 1 });
    for (let i = 0; i < 60; i++) {
      const m = new THREE.Mesh(dg, dm);
      m.visible = false; m.castShadow = true;
      sc.add(m);
      this.debris.push({ m, life: 0, vel: new THREE.Vector3(), spin: new THREE.Vector3() });
    }
    this.dcur = 0;

    // tracers
    this.tracers = [];
    const tg = new THREE.CylinderGeometry(0.025, 0.025, 1, 5, 1, true);
    tg.rotateX(Math.PI / 2); // align along Z
    const tm = new THREE.MeshBasicMaterial({
      color: 0xffd9a0, transparent: true, opacity: 0.95,
      blending: THREE.AdditiveBlending, depthWrite: false,
    });
    for (let i = 0; i < 40; i++) {
      const m = new THREE.Mesh(tg, tm.clone());
      m.visible = false;
      sc.add(m);
      this.tracers.push({ m, life: 0, vel: new THREE.Vector3(), end: 0 });
    }
    this.tcur = 0;

    // reusable point lights
    this.lights = [];
    for (let i = 0; i < 5; i++) {
      const l = new THREE.PointLight(0xffaa44, 0, 40, 2);
      sc.add(l);
      this.lights.push({ l, life: 0, maxLife: 1, intensity: 0 });
    }
    this.lcur = 0;

    // scorch decals
    this.decals = [];
    this.decalMat = new THREE.MeshBasicMaterial({
      map: spriteScorch(), transparent: true, depthWrite: false,
      polygonOffset: true, polygonOffsetFactor: -4,
    });

    // persistent smoke emitters (damaged buildings)
    this.emitters = [];

    // camera shake
    this.shakeAmt = 0;

    // shell casings
    this.casings = [];
    const cg = new THREE.CylinderGeometry(0.012, 0.012, 0.05, 5);
    const cm = new THREE.MeshStandardMaterial({ color: 0xc8a028, roughness: 0.4, metalness: 0.8 });
    for (let i = 0; i < 30; i++) {
      const m = new THREE.Mesh(cg, cm);
      m.visible = false;
      sc.add(m);
      this.casings.push({ m, life: 0, vel: new THREE.Vector3(), spin: new THREE.Vector3() });
    }
    this.ccur = 0;
  }

  light(pos, color, intensity, life, dist = 40) {
    const it = this.lights[this.lcur];
    this.lcur = (this.lcur + 1) % this.lights.length;
    it.l.position.copy(pos);
    it.l.color.set(color);
    it.l.distance = dist;
    it.intensity = intensity;
    it.life = it.maxLife = life;
    return it;
  }

  shake(amt) { this.shakeAmt = Math.min(1.6, this.shakeAmt + amt); }

  // ---------------- effects ----------------
  muzzleFlash(pos, dir) {
    this.flash.spawn(pos, { size: 0.55 + rng() * 0.3, life: 0.05, opacity: 0.95, rot: rng() * 7 });
    this.light(pos, 0xffc866, 12, 0.06, 14);
    // smoke wisp
    this.smoke.spawn(pos, {
      vel: dir.clone().multiplyScalar(1.2).add(new THREE.Vector3(0, 0.7, 0)),
      size: 0.28, grow: 0.7, life: 0.7, opacity: 0.25, tint: 0xd8d0c0,
    });
  }

  tracer(from, to, speed = 260) {
    const it = this.tracers[this.tcur];
    this.tcur = (this.tcur + 1) % this.tracers.length;
    const dir = to.clone().sub(from);
    const dist = dir.length();
    dir.normalize();
    it.m.visible = true;
    it.m.position.copy(from);
    it.m.lookAt(to);
    const len = Math.min(4.5, dist);
    it.m.scale.set(1, 1, len);
    it.vel.copy(dir).multiplyScalar(speed);
    it.life = dist / speed;
    it.m.material.opacity = 0.9;
  }

  impact(pos, normal, type = 'sand') {
    const n = normal || new THREE.Vector3(0, 1, 0);
    if (type === 'sand') {
      for (let i = 0; i < 3; i++) {
        this.smoke.spawn(pos, {
          vel: n.clone().multiplyScalar(1.4 + rng() * 2).add(randVec(0.9)),
          size: 0.32, grow: 0.8, life: 0.5 + rng() * 0.3, opacity: 0.5, tint: 0xc8b088, gravity: -2,
        });
      }
    } else if (type === 'metal') {
      this.flash.spawn(pos, { size: 0.3, life: 0.05, opacity: 0.9 });
      for (let i = 0; i < 4; i++) {
        this.fire.spawn(pos, {
          vel: n.clone().multiplyScalar(2 + rng() * 3).add(randVec(2.4)),
          size: 0.09, grow: -0.04, life: 0.25 + rng() * 0.2, opacity: 1, gravity: -9,
        });
      }
    } else if (type === 'flesh') {
      this.smoke.spawn(pos, {
        vel: randVec(0.8), size: 0.3, grow: 0.4, life: 0.4, opacity: 0.6, tint: 0x7a2818,
      });
    }
  }

  explosion(pos, radius = 3) {
    const R = radius;
    for (let i = 0; i < 6; i++) {
      this.fire.spawn(pos.clone().add(randVec(R * 0.25)), {
        vel: randVec(R * 0.5).add(new THREE.Vector3(0, R * 0.8, 0)),
        size: R * (0.5 + rng() * 0.5), grow: R * 1.5, life: 0.35 + rng() * 0.2,
        opacity: 1, rot: rng() * 7, rotSpeed: (rng() - 0.5) * 3,
      });
    }
    for (let i = 0; i < 8; i++) {
      this.smoke.spawn(pos.clone().add(randVec(R * 0.3)), {
        vel: randVec(R * 0.4).add(new THREE.Vector3(0, R * (0.5 + rng() * 0.7), 0)),
        size: R * 0.5, grow: R * 1.6, life: 1.4 + rng() * 1.2, opacity: 0.65,
        tint: 0x2c2823, fade: 1.4, rot: rng() * 7, rotSpeed: (rng() - 0.5),
      });
    }
    this.flash.spawn(pos, { size: R * 2.2, life: 0.09, opacity: 1 });
    this.light(pos, 0xff9944, R * 18, 0.35, R * 14);
    this.spawnDebris(pos, Math.min(12, 4 + R * 2), R);
    this.scorch(pos, R * 1.1);
    const d = G.camera ? G.camera.position.distanceTo(pos) : 999;
    this.shake(Math.max(0, 1 - d / 70) * Math.min(1.2, R * 0.25));
  }

  bigExplosion(pos, radius = 8) {
    this.explosion(pos, radius * 0.7);
    // secondary poofs
    for (let i = 0; i < 4; i++) {
      setTimeout(() => {
        if (!G.scene) return;
        this.explosion(pos.clone().add(randVec(radius * 0.5)), radius * 0.3);
      }, 90 + i * 140);
    }
    // tall smoke column
    for (let i = 0; i < 10; i++) {
      this.smoke.spawn(pos.clone().add(randVec(radius * 0.3)), {
        vel: new THREE.Vector3((rng() - 0.5) * 2, 4 + rng() * 5, (rng() - 0.5) * 2),
        size: radius * 0.5, grow: radius * 1.4, life: 3 + rng() * 2.5,
        opacity: 0.55, tint: 0x1e1b17, fade: 1.5, rotSpeed: (rng() - 0.5) * 0.6,
      });
    }
  }

  spawnDebris(pos, count, force) {
    for (let i = 0; i < count; i++) {
      const it = this.debris[this.dcur];
      this.dcur = (this.dcur + 1) % this.debris.length;
      it.m.visible = true;
      it.m.position.copy(pos);
      it.vel.set((rng() - 0.5) * force * 3, force * (1.5 + rng() * 2.5), (rng() - 0.5) * force * 3);
      it.spin.set(rng() * 9, rng() * 9, rng() * 9);
      it.life = 1.6 + rng();
      const s = 0.5 + rng() * 1.6;
      it.m.scale.set(s, s, s);
    }
  }

  ejectCasing(pos, right) {
    const it = this.casings[this.ccur];
    this.ccur = (this.ccur + 1) % this.casings.length;
    it.m.visible = true;
    it.m.position.copy(pos);
    it.vel.copy(right).multiplyScalar(1.4 + rng()).add(new THREE.Vector3(0, 1.6 + rng(), 0));
    it.spin.set(rng() * 20, rng() * 20, rng() * 20);
    it.life = 0.8;
  }

  scorch(pos, size) {
    const m = new THREE.Mesh(new THREE.CircleGeometry(size, 16), this.decalMat);
    m.rotation.x = -Math.PI / 2;
    m.rotation.z = rng() * 7;
    m.position.set(pos.x, G.groundHeight(pos.x, pos.z) + 0.05, pos.z);
    G.scene.add(m);
    this.decals.push(m);
    if (this.decals.length > 24) {
      const old = this.decals.shift();
      G.scene.remove(old);
    }
  }

  attachSmoke(obj, size = 2) {
    this.emitters.push({ obj, size, t: 0 });
  }

  update(dt) {
    this.fire.update(dt);
    this.smoke.update(dt);
    this.flash.update(dt);

    for (const it of this.tracers) {
      if (it.life <= 0) continue;
      it.life -= dt;
      if (it.life <= 0) { it.m.visible = false; continue; }
      it.m.position.addScaledVector(it.vel, dt);
    }

    for (const it of this.debris) {
      if (it.life <= 0) continue;
      it.life -= dt;
      if (it.life <= 0) { it.m.visible = false; continue; }
      it.vel.y -= 22 * dt;
      it.m.position.addScaledVector(it.vel, dt);
      it.m.rotation.x += it.spin.x * dt;
      it.m.rotation.y += it.spin.y * dt;
      const gy = G.groundHeight(it.m.position.x, it.m.position.z);
      if (it.m.position.y < gy + 0.1) {
        it.m.position.y = gy + 0.1;
        it.vel.multiplyScalar(0.4);
        it.vel.y = Math.abs(it.vel.y) * 0.35;
        it.spin.multiplyScalar(0.5);
      }
    }

    for (const it of this.casings) {
      if (it.life <= 0) continue;
      it.life -= dt;
      if (it.life <= 0) { it.m.visible = false; continue; }
      it.vel.y -= 14 * dt;
      it.m.position.addScaledVector(it.vel, dt);
      it.m.rotation.x += it.spin.x * dt;
      it.m.rotation.z += it.spin.z * dt;
    }

    for (const it of this.lights) {
      if (it.life <= 0) { it.l.intensity = 0; continue; }
      it.life -= dt;
      it.l.intensity = Math.max(0, it.intensity * (it.life / it.maxLife));
    }

    for (const em of this.emitters) {
      if (!em.obj.visible) continue;
      em.t -= dt;
      if (em.t <= 0) {
        em.t = 0.12 + rng() * 0.1;
        const p = new THREE.Vector3();
        em.obj.getWorldPosition(p);
        p.x += (rng() - 0.5) * em.size * 2;
        p.z += (rng() - 0.5) * em.size * 2;
        p.y += em.size + rng() * em.size;
        this.smoke.spawn(p, {
          vel: new THREE.Vector3((rng() - 0.5), 1.6 + rng() * 1.6, (rng() - 0.5)),
          size: em.size * 0.5, grow: em.size * 1.1, life: 2 + rng() * 1.6,
          opacity: 0.4, tint: 0x201d18, fade: 1.4,
        });
      }
    }

    this.shakeAmt = Math.max(0, this.shakeAmt - dt * 3.2);
  }
}

function randVec(s) {
  return new THREE.Vector3((rng() - 0.5) * 2 * s, (rng() - 0.5) * 2 * s, (rng() - 0.5) * 2 * s);
}
