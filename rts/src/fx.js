// fx.js — particle pools: explosions, smoke, muzzle flash, tracers, debris, decals, shake
// OWNED BY: sim agent. Ported from the FPS round; RTS combat additions below.
// API relied on by combat.js / powers.js / entities.js:
//   muzzleFlash(pos, dir)                 tracer(from, to)
//   shellArc(from, to, onImpact)          rocketTrail(from, targetEntOrPos, onImpact)
//   explosion(x,y,z,r) OR explosion(posV3, r)   bigExplosion(pos, r)
//   beam(x, z, duration) -> handle{setPos(x,z)}   flakPuff(pos)
//   vetFlash(ent)   unitDeath(e)   buildingDeath(e)
//   unitDeath/buildingDeath TAKE OWNERSHIP of e.mesh (animate corpse, then
//   remove from scene) — entities.kill() delegates mesh removal to them.
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
    this.fire = new SpritePool(sc, spriteFireball(), 120, THREE.AdditiveBlending);
    this.smoke = new SpritePool(sc, spriteSmoke(), 220);
    this.flash = new SpritePool(sc, spriteFlash(), 40, THREE.AdditiveBlending);

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
    const tg = new THREE.CylinderGeometry(0.045, 0.045, 1, 5, 1, true);
    tg.rotateX(Math.PI / 2); // align along Z
    const tm = new THREE.MeshBasicMaterial({
      color: 0xffd9a0, transparent: true, opacity: 0.95,
      blending: THREE.AdditiveBlending, depthWrite: false,
    });
    for (let i = 0; i < 64; i++) {
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

    // ---- RTS additions: projectiles, beams, corpses ----
    this.projGeo = {
      shell: new THREE.SphereGeometry(0.26, 6, 5),
      rocket: (() => { const g = new THREE.CylinderGeometry(0.1, 0.15, 1.15, 6); g.rotateX(Math.PI / 2); return g; })(),
    };
    this.projMat = {
      shell: new THREE.MeshBasicMaterial({ color: 0x35312a }),
      rocket: new THREE.MeshBasicMaterial({ color: 0xd9d3c4 }),
    };
    this.projFree = { shell: [], rocket: [] };
    this.projectiles = [];
    this.beams = [];
    this.corpses = [];
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
    this.flash.spawn(pos, { size: 0.8 + rng() * 0.4, life: 0.06, opacity: 0.95, rot: rng() * 7 });
    this.light(pos, 0xffc866, 12, 0.06, 14);
    // smoke wisp
    const d = dir ? dir.clone() : new THREE.Vector3(0, 1, 0);
    this.smoke.spawn(pos, {
      vel: d.multiplyScalar(1.2).add(new THREE.Vector3(0, 0.7, 0)),
      size: 0.34, grow: 0.9, life: 0.7, opacity: 0.28, tint: 0xd8d0c0,
    });
  }

  tracer(from, to, speed = 260) {
    const it = this.tracers[this.tcur];
    this.tcur = (this.tcur + 1) % this.tracers.length;
    const dir = to.clone().sub(from);
    const dist = dir.length();
    if (dist < 0.01) return;
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

  // accepts explosion(posV3, r) or explosion(x, y, z, r)
  explosion(a, b, c, d) {
    const pos = (a && a.isVector3) ? a : new THREE.Vector3(a, b, c);
    const radius = ((a && a.isVector3) ? b : d) ?? 3;
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
    const dc = G.camera ? G.camera.position.distanceTo(pos) : 999;
    this.shake(Math.max(0, 1 - dc / 70) * Math.min(1.2, R * 0.25));
  }

  bigExplosion(a, b, c, d) {
    const pos = (a && a.isVector3) ? a : new THREE.Vector3(a, b, c);
    const radius = (((a && a.isVector3) ? b : d) ?? 8);
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
      old.geometry.dispose();
      G.scene.remove(old);
    }
  }

  attachSmoke(obj, size = 2) {
    this.emitters.push({ obj, size, t: 0 });
  }

  // ---------------- RTS combat effects ----------------
  _takeProj(kind) {
    let m = this.projFree[kind].pop();
    if (!m) {
      m = new THREE.Mesh(this.projGeo[kind], this.projMat[kind]);
      G.scene.add(m);
    }
    m.visible = true;
    return m;
  }
  _finishProj(p, at) {
    p.done = true;
    p.m.visible = false;
    this.projFree[p.kind].push(p.m);
    p.onImpact?.(at);
  }

  // arcing tank/artillery shell; onImpact(posV3) fires when it lands
  shellArc(from, to, onImpact) {
    const dist = from.distanceTo(to);
    const p = {
      kind: 'shell', m: this._takeProj('shell'),
      from: from.clone(), to: to.clone(),
      t: 0, dur: Math.max(0.35, dist / 58), h: Math.min(20, 2.5 + dist * 0.28),
      trailT: 0, onImpact, done: false,
    };
    p.m.position.copy(from);
    this.projectiles.push(p);
    this.muzzleFlash(from, to.clone().sub(from).normalize());
  }

  // homing-ish rocket with smoke trail; target = entity (tracked) or Vector3.
  // onImpact(posV3) fires on arrival.
  rocketTrail(from, target, onImpact) {
    const isEnt = !!(target && target.pos && target.def);
    const tp = isEnt ? target.pos.clone() : target.clone();
    const dir = tp.clone().sub(from);
    if (dir.lengthSq() < 0.01) dir.set(0, 1, 0); else dir.normalize();
    const p = {
      kind: 'rocket', m: this._takeProj('rocket'),
      pos: from.clone(),
      vel: dir.add(new THREE.Vector3((rng() - 0.5) * 0.8, 0.5 + rng() * 0.4, (rng() - 0.5) * 0.8))
        .normalize().multiplyScalar(26),
      ent: isEnt ? target : null, to: isEnt ? null : tp,
      t: 0, dur: Math.max(0.9, from.distanceTo(tp) / 42) + 1.8,
      trailT: 0, onImpact, done: false,
    };
    p.m.position.copy(from);
    this.projectiles.push(p);
  }

  // vertical energy beam (particle cannon). Returns handle with setPos(x,z)
  // so callers can sweep it across the ground while it burns.
  beam(x, z, duration = 1.6) {
    const grp = new THREE.Group();
    const core = new THREE.Mesh(
      new THREE.CylinderGeometry(0.65, 1.0, 400, 10, 1, true),
      new THREE.MeshBasicMaterial({
        color: 0xeaf7ff, transparent: true, opacity: 0.9,
        blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
      }));
    const glow = new THREE.Mesh(
      new THREE.CylinderGeometry(2.0, 2.9, 400, 10, 1, true),
      new THREE.MeshBasicMaterial({
        color: 0x5fb8ff, transparent: true, opacity: 0.24,
        blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
      }));
    grp.add(core, glow);
    grp.position.set(x, G.groundHeight(x, z) + 200, z);
    G.scene.add(grp);
    const b = { grp, core, glow, t: 0, dur: duration, x, z };
    b.setPos = (nx, nz) => { b.x = nx; b.z = nz; };
    this.beams.push(b);
    return b;
  }

  // dark AA flak burst at an air target
  flakPuff(pos) {
    this.flash.spawn(pos, { size: 1.1, life: 0.06, opacity: 0.9 });
    this.smoke.spawn(pos.clone().add(randVec(0.4)), {
      vel: randVec(0.6), size: 0.8, grow: 2.4, life: 0.9 + rng() * 0.5,
      opacity: 0.8, tint: 0x2f2b26, fade: 1.1, rot: rng() * 7, rotSpeed: (rng() - 0.5),
    });
    for (let i = 0; i < 2; i++) {
      this.fire.spawn(pos.clone().add(randVec(0.5)), {
        vel: randVec(3.5), size: 0.15, grow: -0.06, life: 0.18, opacity: 1, gravity: -6,
      });
    }
  }

  // golden chevron flash when a unit ranks up
  vetFlash(ent) {
    const p = ent.pos.clone();
    p.y += ent.kind === 'building' ? 6 : 3.2;
    this.flash.spawn(p, { size: 2.6, life: 0.28, opacity: 0.95, tint: 0xffd870 });
    for (let i = 0; i < 6; i++) {
      this.fire.spawn(p.clone().add(randVec(0.8)), {
        vel: new THREE.Vector3((rng() - 0.5) * 2, 2.5 + rng() * 2.5, (rng() - 0.5) * 2),
        size: 0.3, grow: 0.25, life: 0.5 + rng() * 0.2, opacity: 0.9, tint: 0xffe090,
      });
    }
    this.light(p, 0xffcc55, 8, 0.3, 16);
  }

  // ---------------- corpses (mesh ownership passes to FX) ----------------
  _cloneMats(mesh) {
    mesh.traverse((o) => {
      if (o.isMesh && o.material) { o.material = o.material.clone(); o.material.transparent = true; }
    });
  }
  _setOpacity(mesh, op) {
    mesh.traverse((o) => { if (o.isMesh && o.material) o.material.opacity = op; });
  }
  _charMats(mesh) {
    mesh.traverse((o) => { if (o.isMesh && o.material?.color) o.material.color.multiplyScalar(0.22); });
  }

  unitDeath(e) {
    const mesh = e.mesh;
    if (!mesh) return;
    this._cloneMats(mesh);
    if (e.def.air) {
      // aircraft: burst, then tumble out of the sky trailing smoke
      this.explosion(e.pos.clone().add(new THREE.Vector3(0, 1, 0)), 1.7);
      this.corpses.push({
        kind: 'air', mesh, t: 0, dur: 6,
        vel: new THREE.Vector3((rng() - 0.5) * 8, -1.5, (rng() - 0.5) * 8),
        spin: (rng() - 0.5) * 6, trailT: 0,
      });
    } else if (e.def.role === 'infantry') {
      // infantry: crumple, sink, fade
      this.impact(e.pos.clone().add(new THREE.Vector3(0, 0.9, 0)), null, 'flesh');
      this.smoke.spawn(e.pos.clone().add(new THREE.Vector3(0, 0.3, 0)), {
        vel: new THREE.Vector3(0, 0.8, 0), size: 0.6, grow: 1.2, life: 0.6,
        opacity: 0.4, tint: 0xc0a880,
      });
      this.corpses.push({ kind: 'inf', mesh, t: 0, dur: 2.6, dir: rng() < 0.5 ? 1 : -1 });
    } else {
      // vehicle: fireball, charred hull lingers and smolders, then sinks away
      this.explosion(e.pos.clone().add(new THREE.Vector3(0, 1.2, 0)), 2.0 + e.radius * 0.25);
      this._charMats(mesh);
      this.scorch(e.pos, 2.6);
      this.corpses.push({
        kind: 'veh', mesh, t: 0, dur: 9, tip: (rng() - 0.5) * 0.4,
        smokeT: 0, baseY: mesh.position.y,
      });
    }
  }

  buildingDeath(e) {
    const [w, d] = e.def.size || [10, 10];
    const mesh = e.mesh;
    const c = e.pos.clone();
    c.y += Math.max(3, Math.min(w, d) * 0.28);
    this.bigExplosion(c, Math.max(w, d) * 0.35 + 2);
    this.shake(0.7);
    if (!mesh) return;
    this._cloneMats(mesh);
    this.corpses.push({ kind: 'bld', mesh, t: 0, dur: 1.1, w, d, puffT: 0, baseY: mesh.position.y });
  }

  // ---------------- update ----------------
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

    this._updateProjectiles(dt);
    this._updateBeams(dt);
    this._updateCorpses(dt);

    this.shakeAmt = Math.max(0, this.shakeAmt - dt * 3.2);
  }

  _updateProjectiles(dt) {
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const p = this.projectiles[i];
      p.t += dt;
      if (p.kind === 'shell') {
        const s = Math.min(1, p.t / p.dur);
        const pos = p.from.clone().lerp(p.to, s);
        pos.y += p.h * 4 * s * (1 - s);
        p.m.position.copy(pos);
        p.trailT -= dt;
        if (p.trailT <= 0) {
          p.trailT = 0.045;
          this.smoke.spawn(pos, {
            size: 0.3, grow: 0.6, life: 0.45, opacity: 0.35, tint: 0xcfc6b2, fade: 1.2,
          });
          this.fire.spawn(pos, { size: 0.22, grow: -0.1, life: 0.06, opacity: 0.8 });
        }
        if (s >= 1) this._finishProj(p, p.to.clone());
      } else { // rocket
        const aim = p.ent ? p.ent.pos.clone() : p.to.clone();
        if (p.ent && !p.ent.def.air) aim.y += 1.2;
        const desired = aim.clone().sub(p.pos);
        const dr = desired.length();
        if (dr > 0.01) desired.multiplyScalar(1 / dr);
        const sp = Math.min(82, 26 + 140 * p.t);
        const dir = p.vel.clone().normalize().lerp(desired, Math.min(1, 3.4 * dt)).normalize();
        p.vel.copy(dir).multiplyScalar(sp);
        p.pos.addScaledVector(p.vel, dt);
        p.m.position.copy(p.pos);
        p.m.lookAt(p.pos.clone().add(p.vel));
        p.trailT -= dt;
        if (p.trailT <= 0) {
          p.trailT = 0.022;
          this.smoke.spawn(p.pos, {
            vel: new THREE.Vector3((rng() - 0.5) * 0.6, 0.5, (rng() - 0.5) * 0.6),
            size: 0.55, grow: 1.5, life: 1.1 + rng() * 0.6, opacity: 0.55,
            tint: 0xded7c8, fade: 1.3,
          });
          this.fire.spawn(p.pos, { size: 0.42, grow: -0.2, life: 0.07, opacity: 0.95 });
        }
        const gy = G.groundHeight(p.pos.x, p.pos.z);
        if (dr < 2.4 || p.t > p.dur || p.pos.y < gy - 0.2) {
          if (p.pos.y < gy) p.pos.y = gy + 0.2;
          this._finishProj(p, p.pos.clone());
        }
      }
      if (p.done) this.projectiles.splice(i, 1);
    }
  }

  _updateBeams(dt) {
    for (let i = this.beams.length - 1; i >= 0; i--) {
      const b = this.beams[i];
      b.t += dt;
      const gy = G.groundHeight(b.x, b.z);
      b.grp.position.set(b.x, gy + 200, b.z);
      let amp = 1 + Math.sin(b.t * 47) * 0.12 + (rng() - 0.5) * 0.1;
      const rem = b.dur - b.t;
      if (b.t < 0.12) amp *= b.t / 0.12;
      if (rem < 0.35) amp *= Math.max(0, rem / 0.35);
      b.grp.scale.set(amp, 1, amp);
      // boiling ground contact
      if (rem > 0) {
        const base = new THREE.Vector3(b.x + (rng() - 0.5) * 2.4, gy + 0.4 + rng() * 2, b.z + (rng() - 0.5) * 2.4);
        this.fire.spawn(base, {
          vel: new THREE.Vector3((rng() - 0.5) * 4, 5 + rng() * 7, (rng() - 0.5) * 4),
          size: 1.1, grow: 1.8, life: 0.3, opacity: 0.9, tint: 0xbfe6ff,
        });
        if (rng() < 0.5) this.smoke.spawn(base, {
          vel: new THREE.Vector3((rng() - 0.5) * 3, 5 + rng() * 4, (rng() - 0.5) * 3),
          size: 1.4, grow: 3.2, life: 1.6 + rng(), opacity: 0.5, tint: 0x2c2823, fade: 1.3,
        });
        this.light(new THREE.Vector3(b.x, gy + 2, b.z), 0x88ccff, 50, 0.12, 60);
        this.shake(0.05);
      }
      if (b.t >= b.dur) {
        G.scene.remove(b.grp);
        b.core.geometry.dispose(); b.glow.geometry.dispose();
        b.core.material.dispose(); b.glow.material.dispose();
        this.scorch(new THREE.Vector3(b.x, 0, b.z), 5);
        this.beams.splice(i, 1);
      }
    }
  }

  _updateCorpses(dt) {
    for (let i = this.corpses.length - 1; i >= 0; i--) {
      const cp = this.corpses[i];
      cp.t += dt;
      const m = cp.mesh;
      const s = cp.t / cp.dur;
      if (cp.kind === 'inf') {
        const fall = Math.min(1, cp.t / 0.38);
        m.rotation.x = cp.dir * fall * (Math.PI / 2) * 0.94;
        if (s > 0.5) this._setOpacity(m, Math.max(0, 1 - (s - 0.5) / 0.5));
      } else if (cp.kind === 'veh') {
        m.rotation.z = cp.tip * Math.min(1, cp.t / 0.5);
        cp.smokeT -= dt;
        if (cp.smokeT <= 0 && s < 0.75) {
          cp.smokeT = 0.16 + rng() * 0.14;
          const p = m.position.clone();
          p.y += 1.6;
          this.smoke.spawn(p, {
            vel: new THREE.Vector3((rng() - 0.5), 1.8 + rng() * 1.4, (rng() - 0.5)),
            size: 0.8, grow: 1.7, life: 1.6 + rng(), opacity: 0.42, tint: 0x211e19, fade: 1.3,
          });
          if (rng() < 0.4) this.fire.spawn(p, {
            vel: new THREE.Vector3(0, 1 + rng(), 0), size: 0.5, grow: 0.3, life: 0.3, opacity: 0.8,
          });
        }
        if (s > 0.82) {
          const k = (s - 0.82) / 0.18;
          m.position.y = cp.baseY - k * 2.4;
          this._setOpacity(m, 1 - k);
        }
      } else if (cp.kind === 'air') {
        cp.vel.y -= 16 * dt;
        m.position.addScaledVector(cp.vel, dt);
        m.rotation.y += cp.spin * dt;
        m.rotation.z += cp.spin * 0.5 * dt;
        cp.trailT -= dt;
        if (cp.trailT <= 0) {
          cp.trailT = 0.05;
          this.smoke.spawn(m.position, {
            size: 0.9, grow: 1.6, life: 1.2, opacity: 0.5, tint: 0x211e19, fade: 1.2,
          });
          this.fire.spawn(m.position, { size: 0.6, grow: 0.2, life: 0.15, opacity: 0.9 });
        }
        const gy = G.groundHeight(m.position.x, m.position.z);
        if (m.position.y <= gy + 0.3) {
          this.explosion(new THREE.Vector3(m.position.x, gy + 0.6, m.position.z), 3);
          cp.t = cp.dur;
        }
      } else if (cp.kind === 'bld') {
        const k = Math.min(1, s);
        m.scale.y = Math.max(0.06, (1 - k) * (m.scale.x || 1));
        m.position.y = cp.baseY - k * 1.6;
        cp.puffT -= dt;
        if (cp.puffT <= 0) {
          cp.puffT = 0.055;
          const a = rng() * Math.PI * 2;
          const px = m.position.x + Math.cos(a) * cp.w * 0.45;
          const pz = m.position.z + Math.sin(a) * cp.d * 0.45;
          this.smoke.spawn(new THREE.Vector3(px, G.groundHeight(px, pz) + 0.8, pz), {
            vel: new THREE.Vector3(Math.cos(a) * 4, 1.6 + rng() * 2, Math.sin(a) * 4),
            size: 2, grow: 4.5, life: 1.5 + rng(), opacity: 0.55, tint: 0x5a4f40, fade: 1.2,
          });
        }
      }
      if (cp.t >= cp.dur) {
        G.scene.remove(m);
        this.corpses.splice(i, 1);
      }
    }
  }
}

function randVec(s) {
  return new THREE.Vector3((rng() - 0.5) * 2 * s, (rng() - 0.5) * 2 * s, (rng() - 0.5) * 2 * s);
}
