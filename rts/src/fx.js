// fx.js — particle pools: explosions, smoke, muzzle flash, tracers, debris, decals, shake
// OWNED BY: fx agent. Ported from the FPS round; RTS combat additions below.
// API relied on by combat.js / powers.js / entities.js:
//   muzzleFlash(pos, dir)                 tracer(from, to)
//   shellArc(from, to, onImpact)          rocketTrail(from, targetEntOrPos, onImpact)
//   explosion(x,y,z,r) OR explosion(posV3, r)   bigExplosion(pos, r)
//   beam(x, z, duration) -> handle{setPos(x,z)}   flakPuff(pos)
//   vetFlash(ent)   unitDeath(e)   buildingDeath(e)
//   unitDeath/buildingDeath TAKE OWNERSHIP of e.mesh (animate corpse, then
//   remove from scene) — entities.kill() delegates mesh removal to them.
// New (additive, optional for callers): dustTrail(ent) — FX also self-drives
// it for moving ground vehicles; schedule(delay, fn) — sim-time delayed FX.
import * as THREE from 'three';
import { G, makeRng } from './core.js';
import { spriteFireball, spriteSmoke, spriteFlash, spriteScorch } from './textures.js';

const rng = makeRng(4242);

// ------------------------------------------------------------------ local
// fx-owned canvas sprites (textures.js belongs to another concern; these are
// private to fx and cached once).
const fxTex = {};
function fxCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return [c, c.getContext('2d')];
}
function fxToTex(c) {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  return t;
}

// billowy irregular dust puff (white; tinted per-spawn)
function texDust() {
  if (fxTex.dust) return fxTex.dust;
  const r2 = makeRng(717);
  const [c, x] = fxCanvas(128, 128);
  for (let i = 0; i < 30; i++) {
    const a = r2() * Math.PI * 2, rr = r2() * 34;
    const px = 64 + Math.cos(a) * rr, py = 64 + Math.sin(a) * rr * 0.85;
    const rad = 12 + r2() * 24;
    const g = x.createRadialGradient(px, py, 0, px, py, rad);
    g.addColorStop(0, `rgba(255,255,255,${0.13 + r2() * 0.1})`);
    g.addColorStop(1, 'rgba(255,255,255,0)');
    x.fillStyle = g;
    x.beginPath(); x.arc(px, py, rad, 0, 7); x.fill();
  }
  fxTex.dust = fxToTex(c);
  return fxTex.dust;
}

// soft annulus for expanding ground shockwave / dust rings
function texRing() {
  if (fxTex.ring) return fxTex.ring;
  const [c, x] = fxCanvas(128, 128);
  const g = x.createRadialGradient(64, 64, 26, 64, 64, 62);
  g.addColorStop(0.0, 'rgba(255,255,255,0)');
  g.addColorStop(0.55, 'rgba(255,255,255,0.05)');
  g.addColorStop(0.78, 'rgba(255,255,255,0.85)');
  g.addColorStop(0.9, 'rgba(255,255,255,0.35)');
  g.addColorStop(1.0, 'rgba(255,255,255,0)');
  x.fillStyle = g; x.fillRect(0, 0, 128, 128);
  fxTex.ring = fxToTex(c);
  return fxTex.ring;
}

// big 6-spike star flash for muzzles / explosion cores
function texStar() {
  if (fxTex.star) return fxTex.star;
  const [c, x] = fxCanvas(128, 128);
  const g = x.createRadialGradient(64, 64, 2, 64, 64, 40);
  g.addColorStop(0, 'rgba(255,255,244,1)');
  g.addColorStop(0.3, 'rgba(255,224,140,0.9)');
  g.addColorStop(0.7, 'rgba(255,150,40,0.25)');
  g.addColorStop(1, 'rgba(255,120,20,0)');
  x.fillStyle = g; x.fillRect(0, 0, 128, 128);
  for (let i = 0; i < 6; i++) {
    const a = i * Math.PI / 3 + 0.35;
    const len = i % 2 ? 40 : 60;
    const lg = x.createLinearGradient(64, 64, 64 + Math.cos(a) * len, 64 + Math.sin(a) * len);
    lg.addColorStop(0, 'rgba(255,244,200,0.95)');
    lg.addColorStop(1, 'rgba(255,170,60,0)');
    x.strokeStyle = lg;
    x.lineWidth = i % 2 ? 3.5 : 5.5;
    x.lineCap = 'round';
    x.beginPath(); x.moveTo(64, 64);
    x.lineTo(64 + Math.cos(a) * len, 64 + Math.sin(a) * len); x.stroke();
  }
  fxTex.star = fxToTex(c);
  return fxTex.star;
}

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
    opacity = 1, gravity = 0, rot = 0, rotSpeed = 0, drag = 0 }) {
    const it = this.items[this.cursor];
    this.cursor = (this.cursor + 1) % this.items.length;
    it.s.visible = true;
    it.s.position.copy(pos);
    it.vel = vel ? vel.clone() : new THREE.Vector3();
    it.life = life; it.maxLife = life;
    it.size = size; it.grow = grow; it.fade = fade;
    it.gravity = gravity; it.drag = drag;
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
      if (it.drag) it.vel.multiplyScalar(Math.max(0, 1 - it.drag * dt));
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
    this.fire = new SpritePool(sc, spriteFireball(), 190, THREE.AdditiveBlending);
    this.smoke = new SpritePool(sc, spriteSmoke(), 280);
    this.flash = new SpritePool(sc, spriteFlash(), 48, THREE.AdditiveBlending);
    this.star = new SpritePool(sc, texStar(), 40, THREE.AdditiveBlending);
    this.dust = new SpritePool(sc, texDust(), 160);

    // debris
    this.debris = [];
    const dg = new THREE.BoxGeometry(0.22, 0.22, 0.22);
    const dm = new THREE.MeshStandardMaterial({ color: 0x3a3630, roughness: 1 });
    for (let i = 0; i < 80; i++) {
      const m = new THREE.Mesh(dg, dm);
      m.visible = false; m.castShadow = true;
      sc.add(m);
      this.debris.push({ m, life: 0, vel: new THREE.Vector3(), spin: new THREE.Vector3(), hot: false, trailT: 0 });
    }
    this.dcur = 0;

    // tracers — thicker, warmer, additive
    this.tracers = [];
    const tg = new THREE.CylinderGeometry(0.09, 0.09, 1, 5, 1, true);
    tg.rotateX(Math.PI / 2); // align along Z
    const tm = new THREE.MeshBasicMaterial({
      color: 0xffbe6e, transparent: true, opacity: 1,
      blending: THREE.AdditiveBlending, depthWrite: false,
    });
    for (let i = 0; i < 80; i++) {
      const m = new THREE.Mesh(tg, tm.clone());
      m.visible = false;
      sc.add(m);
      this.tracers.push({ m, life: 0, vel: new THREE.Vector3(), end: 0 });
    }
    this.tcur = 0;

    // reusable point lights (explosions/beam) + ONE dedicated muzzle light
    this.lights = [];
    for (let i = 0; i < 4; i++) {
      const l = new THREE.PointLight(0xffaa44, 0, 40, 2);
      sc.add(l);
      this.lights.push({ l, life: 0, maxLife: 1, intensity: 0 });
    }
    this.lcur = 0;
    this.muzz = new THREE.PointLight(0xffc86a, 0, 13, 2);
    sc.add(this.muzz);
    this.muzzLife = 0;

    // scorch decals — pooled, persistent until slot reused
    this.decalMat = new THREE.MeshBasicMaterial({
      map: spriteScorch(), transparent: true, depthWrite: false,
      polygonOffset: true, polygonOffsetFactor: -4,
    });
    this.decals = [];
    const decalGeo = new THREE.CircleGeometry(1, 14);
    for (let i = 0; i < 28; i++) {
      const m = new THREE.Mesh(decalGeo, this.decalMat.clone());
      m.rotation.x = -Math.PI / 2;
      m.visible = false;
      sc.add(m);
      this.decals.push(m);
    }
    this.decalCur = 0;

    // expanding ground rings (dust shockwaves)
    this.rings = [];
    const ringGeo = new THREE.PlaneGeometry(2, 2);
    ringGeo.rotateX(-Math.PI / 2);
    for (let i = 0; i < 14; i++) {
      const m = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({
        map: texRing(), transparent: true, depthWrite: false, opacity: 0,
      }));
      m.visible = false;
      sc.add(m);
      this.rings.push({ m, life: 0, maxLife: 1, r0: 1, r1: 8, op: 0.5 });
    }
    this.rcur = 0;

    // persistent smoke emitters: {obj,size,t} (legacy) or {pos,size,ttl,t,burn}
    this.emitters = [];

    // camera shake — applied by FX (camera rig repositions itself each frame,
    // so our offset is tracked and removed before re-adding)
    this.shakeAmt = 0;
    this._shakeOff = new THREE.Vector3();

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

    // flying mesh chunks (popped turrets etc.) — capped
    this.chunks = [];

    // sim-time delayed FX (secondary pops) — survives shot-mode fast-forward,
    // unlike setTimeout which runs on wall-clock
    this.delayed = [];

    // ambience: vehicle dust trails (self-driven) + wind-blown sand wisps
    this.dustScanT = 0;
    this.wisps = [];
    const wtex = texDust();
    for (let i = 0; i < 10; i++) {
      const mat = new THREE.SpriteMaterial({
        map: wtex, transparent: true, depthWrite: false, opacity: 0,
        color: 0xdcc89e,
      });
      const s = new THREE.Sprite(mat);
      s.visible = false;
      sc.add(s);
      this.wisps.push({ s, t: rng() * 6, dur: 6 + rng() * 5, vel: new THREE.Vector3(), peak: 0.05 });
    }
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

  shake(amt) { this.shakeAmt = Math.min(2.2, this.shakeAmt + amt); }

  // run fn after `delay` sim-seconds (bounded queue)
  schedule(delay, fn) {
    if (this.delayed.length > 80) return;
    this.delayed.push({ t: delay, fn });
  }

  // expanding ground-hugging ring (dust shockwave). All pooled.
  ring(pos, { r0 = 1, r1 = 8, life = 0.5, opacity = 0.5, tint = 0xd6bd8f, additive = false } = {}) {
    const it = this.rings[this.rcur];
    this.rcur = (this.rcur + 1) % this.rings.length;
    it.m.visible = true;
    it.m.position.set(pos.x, G.groundHeight(pos.x, pos.z) + 0.18, pos.z);
    it.m.rotation.y = rng() * 7;
    it.m.material.color.set(tint);
    it.m.material.blending = additive ? THREE.AdditiveBlending : THREE.NormalBlending;
    it.r0 = r0; it.r1 = r1; it.op = opacity;
    it.life = it.maxLife = life;
    it.m.scale.set(r0, 1, r0);
    it.m.material.opacity = opacity;
  }

  // long-lived rising smoke column at a fixed spot (rubble, burning wreck)
  smokeColumn(pos, size, ttl, burn = true) {
    // cap positional emitters so mass destruction doesn't accumulate forever
    let n = 0;
    for (const em of this.emitters) if (em.pos) n++;
    if (n >= 10) {
      const i = this.emitters.findIndex(em => em.pos);
      if (i >= 0) this.emitters.splice(i, 1);
    }
    this.emitters.push({ pos: pos.clone(), size, ttl, ttl0: ttl, t: 0, burn });
  }

  // ---------------- effects ----------------
  muzzleFlash(pos, dir) {
    const d = dir ? dir.clone().normalize() : new THREE.Vector3(0, 1, 0);
    const sz = 1.5 + rng() * 0.8;
    this.star.spawn(pos, { size: sz, life: 0.07, opacity: 1, rot: rng() * 7 });
    // secondary bloom pushed out along the barrel for elongation
    this.flash.spawn(pos.clone().addScaledVector(d, sz * 0.42), {
      size: sz * 0.55, life: 0.06, opacity: 0.85,
    });
    // single pooled flash light (emissive sprites carry most of the look)
    this.muzz.position.copy(pos);
    this.muzz.intensity = 9;
    this.muzzLife = 0.05;
    // smoke wisp
    this.smoke.spawn(pos.clone().addScaledVector(d, 0.5), {
      vel: d.multiplyScalar(2.6).add(new THREE.Vector3(0, 0.9, 0)),
      size: 0.4, grow: 1.1, life: 0.65, opacity: 0.3, tint: 0xd8d0c0, drag: 1.5,
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
    const len = Math.min(6.5, dist);
    it.m.scale.set(1, 1, len);
    it.vel.copy(dir).multiplyScalar(speed);
    it.life = dist / speed;
    it.m.material.opacity = 1;
  }

  impact(pos, normal, type = 'sand') {
    const n = normal || new THREE.Vector3(0, 1, 0);
    if (type === 'sand') {
      for (let i = 0; i < 3; i++) {
        this.dust.spawn(pos, {
          vel: n.clone().multiplyScalar(1.6 + rng() * 2).add(randVec(1)),
          size: 0.45, grow: 1.1, life: 0.5 + rng() * 0.3, opacity: 0.5,
          tint: 0xc8b088, gravity: -2, drag: 1.4, rot: rng() * 7,
        });
      }
    } else if (type === 'metal') {
      this.flash.spawn(pos, { size: 0.42, life: 0.05, opacity: 0.95 });
      for (let i = 0; i < 4; i++) {
        this.fire.spawn(pos, {
          vel: n.clone().multiplyScalar(2 + rng() * 3).add(randVec(2.4)),
          size: 0.11, grow: -0.04, life: 0.25 + rng() * 0.2, opacity: 1, gravity: -9,
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
    const R = radius * 1.1 + 0.4;   // visual scale-up so small bursts still read at RTS zoom
    // immediate dark backdrop puff — additive fire needs contrast over bright sand
    this.smoke.spawn(pos.clone().add(new THREE.Vector3(0, R * 0.3, 0)), {
      vel: new THREE.Vector3((rng() - 0.5), R * 0.6, (rng() - 0.5)),
      size: R * 1.5, grow: R * 1.3, life: 0.85 + rng() * 0.3,
      opacity: 0.75, tint: 0x1c1916, fade: 1.1, rot: rng() * 7, rotSpeed: (rng() - 0.5) * 1.5,
    });
    // white-hot core + star burst
    this.flash.spawn(pos, { size: R * 2.7, life: 0.1, opacity: 1 });
    this.star.spawn(pos, { size: R * 3.6, life: 0.13, opacity: 0.95, rot: rng() * 7 });
    // tight bright core fireball
    this.fire.spawn(pos, {
      size: R * 1.2, grow: R * 1.9, life: 0.42 + rng() * 0.12, opacity: 1,
      tint: 0xfff0c0, rot: rng() * 7, rotSpeed: (rng() - 0.5) * 3,
    });
    // rolling fireballs
    for (let i = 0; i < 6; i++) {
      this.fire.spawn(pos.clone().add(randVec(R * 0.3)), {
        vel: randVec(R * 0.6).add(new THREE.Vector3(0, R * 1.1, 0)),
        size: R * (0.75 + rng() * 0.6), grow: R * 2.0, life: 0.5 + rng() * 0.3,
        opacity: 1, rot: rng() * 7, rotSpeed: (rng() - 0.5) * 3, drag: 1.3,
      });
    }
    // lingering flame tongues licking upward
    for (let i = 0; i < 3; i++) {
      this.fire.spawn(pos.clone().add(randVec(R * 0.3)), {
        vel: new THREE.Vector3((rng() - 0.5) * R, R * (1.4 + rng()), (rng() - 0.5) * R),
        size: R * 0.55, grow: R * 0.5, life: 0.7 + rng() * 0.4,
        opacity: 0.9, tint: 0xff9a30, rotSpeed: (rng() - 0.5) * 2,
      });
    }
    // residual ground fire burning at the impact point
    for (let i = 0; i < 2; i++) {
      this.fire.spawn(pos.clone().add(new THREE.Vector3((rng() - 0.5) * R * 0.8, 0.2, (rng() - 0.5) * R * 0.8)), {
        vel: new THREE.Vector3(0, 0.9 + rng() * 0.8, 0),
        size: R * 0.42, grow: R * 0.2, life: 1.0 + rng() * 0.6,
        opacity: 0.85, tint: 0xff8828, fade: 1.6, rotSpeed: (rng() - 0.5) * 1.5,
      });
    }
    // hot sparks arcing out
    for (let i = 0; i < 5; i++) {
      this.fire.spawn(pos, {
        vel: randVec(R * 3).add(new THREE.Vector3(0, R * 2.2, 0)),
        size: 0.16 + rng() * 0.14, grow: -0.05, life: 0.35 + rng() * 0.3,
        opacity: 1, gravity: -22,
      });
    }
    // black smoke
    for (let i = 0; i < 7; i++) {
      this.smoke.spawn(pos.clone().add(randVec(R * 0.3)), {
        vel: randVec(R * 0.4).add(new THREE.Vector3(0, R * (0.6 + rng() * 0.8), 0)),
        size: R * 0.55, grow: R * 1.8, life: 1.6 + rng() * 1.4, opacity: 0.65,
        tint: 0x2c2823, fade: 1.4, rot: rng() * 7, rotSpeed: (rng() - 0.5), drag: 0.7,
      });
    }
    // ground dust splash: low, radial, sand-colored
    const gy = G.groundHeight(pos.x, pos.z);
    for (let i = 0; i < 7; i++) {
      const ang = rng() * Math.PI * 2;
      const ca = Math.cos(ang), sa = Math.sin(ang);
      this.dust.spawn(new THREE.Vector3(pos.x + ca * R * 0.5, gy + 0.4, pos.z + sa * R * 0.5), {
        vel: new THREE.Vector3(ca * R * (2.6 + rng() * 2), 0.8 + rng(), sa * R * (2.6 + rng() * 2)),
        size: R * 0.6, grow: R * 1.3, life: 0.7 + rng() * 0.5, opacity: 0.5,
        tint: 0xc9ae80, fade: 1.2, drag: 2.4, rot: rng() * 7, rotSpeed: (rng() - 0.5),
      });
    }
    // fast expanding dust ring on the ground
    this.ring(pos, { r0: R * 0.6, r1: R * 4.4, life: 0.5, opacity: 0.5, tint: 0xd6bd8f });
    if (R >= 2.2) {
      this.ring(pos, { r0: R * 0.4, r1: R * 5.4, life: 0.32, opacity: 0.4, tint: 0xffd9a0, additive: true });
    }
    this.light(pos, 0xff9944, R * 20, 0.32, R * 15);
    this.spawnDebris(pos, Math.min(14, 4 + Math.round(R * 2.5)), R);
    this.scorch(pos, R * 1.15);
    const dc = G.camera ? G.camera.position.distanceTo(pos) : 999;
    this.shake(Math.max(0, 1 - dc / 190) * Math.min(1.5, R * 0.28));
  }

  bigExplosion(a, b, c, d) {
    const pos = (a && a.isVector3) ? a : new THREE.Vector3(a, b, c);
    const radius = (((a && a.isVector3) ? b : d) ?? 8);
    this.explosion(pos, radius * 0.75);
    this.ring(pos, { r0: radius * 0.5, r1: radius * 3.4, life: 0.85, opacity: 0.6, tint: 0xd8bf92 });
    // secondary pops staged over the next second (sim-time, ff-safe)
    for (let i = 0; i < 4; i++) {
      const at = pos.clone().add(randVec(radius * 0.5));
      at.y = pos.y + rng() * radius * 0.25;
      this.schedule(0.12 + i * 0.17 + rng() * 0.1, () => this.explosion(at, radius * (0.3 + rng() * 0.15)));
    }
    // tall smoke column
    for (let i = 0; i < 12; i++) {
      this.smoke.spawn(pos.clone().add(randVec(radius * 0.3)), {
        vel: new THREE.Vector3((rng() - 0.5) * 2, 4 + rng() * 6, (rng() - 0.5) * 2),
        size: radius * 0.55, grow: radius * 1.5, life: 3 + rng() * 3,
        opacity: 0.55, tint: 0x1e1b17, fade: 1.5, rotSpeed: (rng() - 0.5) * 0.6,
      });
    }
    this.light(pos, 0xffa040, radius * 24, 0.45, radius * 18);
    const dc = G.camera ? G.camera.position.distanceTo(pos) : 999;
    this.shake(Math.max(0.15, 1 - dc / 260) * Math.min(2, radius * 0.18 + 0.5));
  }

  spawnDebris(pos, count, force) {
    for (let i = 0; i < count; i++) {
      const it = this.debris[this.dcur];
      this.dcur = (this.dcur + 1) % this.debris.length;
      it.m.visible = true;
      it.m.position.copy(pos);
      it.vel.set((rng() - 0.5) * force * 3.4, force * (1.8 + rng() * 3), (rng() - 0.5) * force * 3.4);
      it.spin.set(rng() * 9, rng() * 9, rng() * 9);
      it.life = 1.6 + rng();
      it.hot = rng() < 0.45;   // hot chunks trail fire/smoke while airborne
      it.trailT = 0;
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
    const m = this.decals[this.decalCur];
    this.decalCur = (this.decalCur + 1) % this.decals.length;
    m.visible = true;
    m.scale.set(size, size, 1);
    m.rotation.z = rng() * 7;
    // stagger heights slightly so overlapping decals don't z-fight
    m.position.set(pos.x, G.groundHeight(pos.x, pos.z) + 0.04 + (this.decalCur % 8) * 0.004, pos.z);
    m.material.opacity = 0.8 + rng() * 0.2;
  }

  attachSmoke(obj, size = 2) {
    this.emitters.push({ obj, size, t: 0 });
  }

  // vehicle kicks up a dust puff behind it (also self-driven from update())
  dustTrail(e) {
    if (!e || !e.vel) return;
    const sp = Math.hypot(e.vel.x, e.vel.z);
    if (sp < 0.4) return;
    const bx = -e.vel.x / sp, bz = -e.vel.z / sp;
    const px = e.pos.x + bx * (e.radius * 0.9) + (rng() - 0.5) * 1.4;
    const pz = e.pos.z + bz * (e.radius * 0.9) + (rng() - 0.5) * 1.4;
    this.dust.spawn(new THREE.Vector3(px, G.groundHeight(px, pz) + 0.35, pz), {
      vel: new THREE.Vector3(bx * 1.6 + (rng() - 0.5), 0.8 + rng() * 0.7, bz * 1.6 + (rng() - 0.5)),
      size: 0.9 + rng() * 0.9, grow: 2.2 + rng() * 1.3, life: 0.9 + rng() * 0.6,
      opacity: 0.24, tint: 0xc9ae82, fade: 1.2, drag: 1.7,
      rot: rng() * 7, rotSpeed: (rng() - 0.5) * 0.8,
    });
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
      new THREE.CylinderGeometry(0.75, 1.1, 400, 10, 1, true),
      new THREE.MeshBasicMaterial({
        color: 0xeaf7ff, transparent: true, opacity: 0.95,
        blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
      }));
    const glow = new THREE.Mesh(
      new THREE.CylinderGeometry(2.2, 3.2, 400, 10, 1, true),
      new THREE.MeshBasicMaterial({
        color: 0x5fb8ff, transparent: true, opacity: 0.26,
        blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
      }));
    grp.add(core, glow);
    grp.position.set(x, G.groundHeight(x, z) + 200, z);
    G.scene.add(grp);
    const b = { grp, core, glow, t: 0, dur: duration, x, z, lightT: 0, pulseT: 0 };
    b.setPos = (nx, nz) => { b.x = nx; b.z = nz; };
    this.beams.push(b);
    return b;
  }

  // dark AA flak burst at an air target
  flakPuff(pos) {
    this.star.spawn(pos, { size: 1.5, life: 0.07, opacity: 0.95, rot: rng() * 7 });
    this.smoke.spawn(pos.clone().add(randVec(0.4)), {
      vel: randVec(0.6), size: 1.0, grow: 3.0, life: 1.0 + rng() * 0.5,
      opacity: 0.85, tint: 0x2f2b26, fade: 1.1, rot: rng() * 7, rotSpeed: (rng() - 0.5),
    });
    for (let i = 0; i < 3; i++) {
      this.fire.spawn(pos.clone().add(randVec(0.5)), {
        vel: randVec(4), size: 0.16, grow: -0.06, life: 0.2, opacity: 1, gravity: -6,
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

  // detach a mesh piece (e.g. turret) and send it flying with a smoke trail
  _popChunk(obj, from, force) {
    if (this.chunks.length >= 10) {
      const old = this.chunks.shift();
      G.scene.remove(old.obj);
    }
    const wp = new THREE.Vector3(); obj.getWorldPosition(wp);
    const wq = new THREE.Quaternion(); obj.getWorldQuaternion(wq);
    obj.parent?.remove(obj);
    obj.position.copy(wp);
    obj.quaternion.copy(wq);
    G.scene.add(obj);
    this.chunks.push({
      obj, t: 0, dur: 6.5, landed: false, trailT: 0,
      vel: new THREE.Vector3((rng() - 0.5) * force * 2.4, force * (2.6 + rng() * 1.4), (rng() - 0.5) * force * 2.4),
      avel: new THREE.Vector3((rng() - 0.5) * 9, (rng() - 0.5) * 6, (rng() - 0.5) * 9),
    });
  }

  unitDeath(e) {
    const mesh = e.mesh;
    if (!mesh) return;
    this._cloneMats(mesh);
    if (e.def.air) {
      // aircraft: burst, then tumble out of the sky trailing smoke
      this.explosion(e.pos.clone().add(new THREE.Vector3(0, 1, 0)), 1.9);
      this.corpses.push({
        kind: 'air', mesh, t: 0, dur: 6,
        vel: new THREE.Vector3((rng() - 0.5) * 8, -1.5, (rng() - 0.5) * 8),
        spin: (rng() - 0.5) * 6, trailT: 0,
      });
    } else if (e.def.role === 'infantry') {
      // infantry: crumple, sink, fade
      this.impact(e.pos.clone().add(new THREE.Vector3(0, 0.9, 0)), null, 'flesh');
      this.dust.spawn(e.pos.clone().add(new THREE.Vector3(0, 0.3, 0)), {
        vel: new THREE.Vector3(0, 0.8, 0), size: 0.6, grow: 1.2, life: 0.6,
        opacity: 0.35, tint: 0xc0a880,
      });
      this.corpses.push({ kind: 'inf', mesh, t: 0, dur: 2.6, dir: rng() < 0.5 ? 1 : -1 });
    } else {
      // vehicle: tank-death is an EVENT — big layered blast, turret pop,
      // delayed cook-off, charred hull smolders, then sinks away
      const R = 2.4 + e.radius * 0.35;
      const at = e.pos.clone().add(new THREE.Vector3(0, 1.3, 0));
      this.explosion(at, R);
      const tur = mesh.userData?.turret;
      if (tur && rng() < 0.85) this._popChunk(tur, at, R);
      const cook = e.pos.clone().add(new THREE.Vector3((rng() - 0.5) * 2, 1 + rng(), (rng() - 0.5) * 2));
      this.schedule(0.3 + rng() * 0.25, () => this.explosion(cook, R * 0.55));
      this._charMats(mesh);
      this.scorch(e.pos, 3.1);
      this.corpses.push({
        kind: 'veh', mesh, t: 0, dur: 11, tip: (rng() - 0.5) * 0.4,
        smokeT: 0, baseY: mesh.position.y,
      });
    }
  }

  buildingDeath(e) {
    const [w, d] = e.def.size || [10, 10];
    const mesh = e.mesh;
    const c = e.pos.clone();
    c.y += Math.max(3, Math.min(w, d) * 0.28);
    this.bigExplosion(c, Math.max(w, d) * 0.4 + 2.5);
    // dust curtain blowing out from the footprint
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * Math.PI * 2 + rng() * 0.4;
      const ca = Math.cos(a), sa = Math.sin(a);
      const px = e.pos.x + ca * w * 0.5, pz = e.pos.z + sa * d * 0.5;
      this.dust.spawn(new THREE.Vector3(px, G.groundHeight(px, pz) + 1 + rng() * 2, pz), {
        vel: new THREE.Vector3(ca * (5 + rng() * 4), 1.2 + rng() * 2, sa * (5 + rng() * 4)),
        size: 2 + rng() * 1.8, grow: 4.5 + rng() * 2, life: 1.4 + rng() * 0.9,
        opacity: 0.55, tint: 0xc7ab7c, fade: 1.2, drag: 1.8,
        rot: rng() * 7, rotSpeed: (rng() - 0.5) * 0.7,
      });
    }
    this.ring(e.pos, { r0: Math.min(w, d) * 0.4, r1: Math.max(w, d) * 1.7, life: 0.9, opacity: 0.6, tint: 0xd2b586 });
    // staged interior cook-offs while it collapses
    for (let i = 0; i < 3; i++) {
      const at = e.pos.clone().add(new THREE.Vector3((rng() - 0.5) * w * 0.6, 1.5 + rng() * 2.5, (rng() - 0.5) * d * 0.6));
      this.schedule(0.5 + i * 0.4 + rng() * 0.2, () => this.explosion(at, 1.8 + rng() * 1.2));
    }
    // GZH-style: rubble smokes for ~30s
    this.smokeColumn(e.pos, Math.min(w, d) * 0.3 + 1, 30);
    this.scorch(e.pos, Math.max(w, d) * 0.8);
    this.shake(0.9);
    if (!mesh) return;
    this._cloneMats(mesh);
    this.corpses.push({ kind: 'bld', mesh, t: 0, dur: 1.35, w, d, puffT: 0, baseY: mesh.position.y });
  }

  // ---------------- update ----------------
  update(dt) {
    this.fire.update(dt);
    this.smoke.update(dt);
    this.flash.update(dt);
    this.star.update(dt);
    this.dust.update(dt);

    // delayed sim-time FX
    for (let i = this.delayed.length - 1; i >= 0; i--) {
      const q = this.delayed[i];
      q.t -= dt;
      if (q.t <= 0) { this.delayed.splice(i, 1); q.fn(); }
    }

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
        it.hot = false;
      } else if (it.hot) {
        it.trailT -= dt;
        if (it.trailT <= 0) {
          it.trailT = 0.055;
          this.smoke.spawn(it.m.position, {
            size: 0.3, grow: 0.55, life: 0.5, opacity: 0.4, tint: 0x4a4038, fade: 1.2,
          });
          if (rng() < 0.6) this.fire.spawn(it.m.position, {
            size: 0.22, grow: -0.08, life: 0.12, opacity: 0.9,
          });
        }
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
    if (this.muzzLife > 0) {
      this.muzzLife -= dt;
      if (this.muzzLife <= 0) this.muzz.intensity = 0;
    }

    // expanding ground rings
    for (const it of this.rings) {
      if (it.life <= 0) continue;
      it.life -= dt;
      if (it.life <= 0) { it.m.visible = false; it.m.material.opacity = 0; continue; }
      const t = 1 - it.life / it.maxLife;
      const ease = 1 - (1 - t) * (1 - t);        // fast start, decelerating
      const r = it.r0 + (it.r1 - it.r0) * ease;
      it.m.scale.set(r, 1, r);
      it.m.material.opacity = it.op * Math.pow(1 - t, 1.4);
    }

    // smoke emitters: legacy object-attached + positional (rubble columns)
    for (let i = this.emitters.length - 1; i >= 0; i--) {
      const em = this.emitters[i];
      if (em.obj) {
        if (!em.obj.visible) continue;
      } else {
        em.ttl -= dt;
        if (em.ttl <= 0) { this.emitters.splice(i, 1); continue; }
      }
      em.t -= dt;
      if (em.t > 0) continue;
      em.t = 0.13 + rng() * 0.11;
      const p = em.pos ? em.pos.clone() : new THREE.Vector3();
      if (em.obj) em.obj.getWorldPosition(p);
      p.x += (rng() - 0.5) * em.size * 1.6;
      p.z += (rng() - 0.5) * em.size * 1.6;
      p.y += em.size * 0.6 + rng() * em.size;
      // column thins out as it burns down
      const k = em.ttl0 ? Math.min(1, em.ttl / (em.ttl0 * 0.35)) : 1;
      this.smoke.spawn(p, {
        vel: new THREE.Vector3((rng() - 0.5) + 0.4, 2.2 + rng() * 2, (rng() - 0.5)),
        size: em.size * 0.6, grow: em.size * (1.2 + rng() * 0.6), life: 2.5 + rng() * 1.8,
        opacity: 0.42 * k, tint: 0x201d18, fade: 1.4, rotSpeed: (rng() - 0.5) * 0.5,
      });
      // flames at the base while the fire is young
      if (em.burn && em.ttl0 && em.ttl > em.ttl0 * 0.6 && rng() < 0.55) {
        const f = em.pos.clone();
        f.x += (rng() - 0.5) * em.size * 1.4;
        f.z += (rng() - 0.5) * em.size * 1.4;
        f.y += 0.5 + rng() * 1.2;
        this.fire.spawn(f, {
          vel: new THREE.Vector3(0, 1.4 + rng() * 1.6, 0),
          size: em.size * 0.4, grow: em.size * 0.3, life: 0.4 + rng() * 0.25,
          opacity: 0.9, tint: 0xffa040,
        });
      }
    }

    this._updateProjectiles(dt);
    this._updateBeams(dt);
    this._updateCorpses(dt);
    this._updateChunks(dt);
    this._updateAmbience(dt);

    // camera punch: rig repositions the camera every frame before fx runs, so
    // remove last frame's offset (no-op then) and add this frame's.
    if (G.camera) {
      G.camera.position.sub(this._shakeOff);
      this._shakeOff.set(0, 0, 0);
      if (this.shakeAmt > 0.002) {
        const a = this.shakeAmt * 0.42;
        this._shakeOff.set((rng() - 0.5) * a, (rng() - 0.5) * a * 0.6, (rng() - 0.5) * a);
        G.camera.position.add(this._shakeOff);
      }
    }
    this.shakeAmt = Math.max(0, this.shakeAmt - dt * 2.8);
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
          p.trailT = 0.035;
          this.smoke.spawn(pos, {
            size: 0.32, grow: 0.75, life: 0.6, opacity: 0.36, tint: 0xcfc6b2, fade: 1.2,
          });
          // glowing tip — refreshed faster than it fades, so it reads solid
          this.fire.spawn(pos, { size: 0.68, grow: -0.25, life: 0.1, opacity: 1, tint: 0xffb050 });
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
          p.trailT = 0.015;
          this.smoke.spawn(p.pos, {
            vel: new THREE.Vector3((rng() - 0.5) * 0.6, 0.5, (rng() - 0.5) * 0.6),
            size: 0.55, grow: 1.7, life: 1.2 + rng() * 0.7, opacity: 0.6,
            tint: 0xe4ddcf, fade: 1.3,
          });
          this.fire.spawn(p.pos, { size: 0.55, grow: -0.25, life: 0.08, opacity: 1, tint: 0xffc880 });
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
          size: 1.3, grow: 2.0, life: 0.3, opacity: 0.95, tint: 0xbfe6ff,
        });
        if (rng() < 0.5) this.smoke.spawn(base, {
          vel: new THREE.Vector3((rng() - 0.5) * 3, 5 + rng() * 4, (rng() - 0.5) * 3),
          size: 1.4, grow: 3.4, life: 1.6 + rng(), opacity: 0.5, tint: 0x2c2823, fade: 1.3,
        });
        b.pulseT -= dt;
        if (b.pulseT <= 0) {
          b.pulseT = 0.45;
          this.ring(new THREE.Vector3(b.x, 0, b.z), {
            r0: 1.2, r1: 8, life: 0.45, opacity: 0.5, tint: 0x9fd4ff, additive: true,
          });
        }
        b.lightT -= dt;
        if (b.lightT <= 0) {
          b.lightT = 0.09;
          this.light(new THREE.Vector3(b.x, gy + 2, b.z), 0x88ccff, 50, 0.12, 60);
        }
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
        if (cp.smokeT <= 0 && s < 0.8) {
          cp.smokeT = 0.13 + rng() * 0.12;
          const p = m.position.clone();
          p.x += (rng() - 0.5) * 1.4; p.z += (rng() - 0.5) * 1.4;
          p.y += 1.6;
          this.smoke.spawn(p, {
            vel: new THREE.Vector3((rng() - 0.5) + 0.3, 2 + rng() * 1.6, (rng() - 0.5)),
            size: 0.9, grow: 2.0, life: 1.8 + rng() * 1.2, opacity: 0.45, tint: 0x211e19, fade: 1.3,
          });
          if (rng() < 0.5) this.fire.spawn(p, {
            vel: new THREE.Vector3(0, 1.2 + rng(), 0), size: 0.6, grow: 0.35,
            life: 0.35, opacity: 0.9, tint: 0xff9838,
          });
        }
        if (s > 0.85) {
          const k = (s - 0.85) / 0.15;
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
          cp.trailT = 0.035;
          this.smoke.spawn(m.position, {
            size: 1.0, grow: 1.8, life: 1.4, opacity: 0.55, tint: 0x211e19, fade: 1.2,
          });
          this.fire.spawn(m.position, { size: 0.7, grow: 0.2, life: 0.16, opacity: 1 });
        }
        const gy = G.groundHeight(m.position.x, m.position.z);
        if (m.position.y <= gy + 0.3) {
          this.explosion(new THREE.Vector3(m.position.x, gy + 0.8, m.position.z), 3);
          this.smokeColumn(new THREE.Vector3(m.position.x, gy, m.position.z), 1.2, 14);
          cp.t = cp.dur;
        }
      } else if (cp.kind === 'bld') {
        const k = Math.min(1, s);
        m.scale.y = Math.max(0.06, (1 - k) * (m.scale.x || 1));
        m.position.y = cp.baseY - k * 1.6;
        cp.puffT -= dt;
        if (cp.puffT <= 0) {
          cp.puffT = 0.05;
          const a = rng() * Math.PI * 2;
          const px = m.position.x + Math.cos(a) * cp.w * 0.45;
          const pz = m.position.z + Math.sin(a) * cp.d * 0.45;
          this.dust.spawn(new THREE.Vector3(px, G.groundHeight(px, pz) + 0.8, pz), {
            vel: new THREE.Vector3(Math.cos(a) * 4.5, 1.6 + rng() * 2, Math.sin(a) * 4.5),
            size: 2.2, grow: 4.8, life: 1.5 + rng(), opacity: 0.55,
            tint: 0xb59c72, fade: 1.2, drag: 1.4, rot: rng() * 7,
          });
        }
      }
      if (cp.t >= cp.dur) {
        G.scene.remove(m);
        this.corpses.splice(i, 1);
      }
    }
  }

  _updateChunks(dt) {
    for (let i = this.chunks.length - 1; i >= 0; i--) {
      const ch = this.chunks[i];
      ch.t += dt;
      const o = ch.obj;
      if (!ch.landed) {
        ch.vel.y -= 22 * dt;
        o.position.addScaledVector(ch.vel, dt);
        o.rotation.x += ch.avel.x * dt;
        o.rotation.y += ch.avel.y * dt;
        o.rotation.z += ch.avel.z * dt;
        ch.trailT -= dt;
        if (ch.trailT <= 0) {
          ch.trailT = 0.05;
          this.smoke.spawn(o.position, {
            size: 0.5, grow: 0.9, life: 0.7, opacity: 0.5, tint: 0x35302a, fade: 1.2,
          });
          if (rng() < 0.7) this.fire.spawn(o.position, {
            size: 0.4, grow: -0.1, life: 0.12, opacity: 0.95,
          });
        }
        const gy = G.groundHeight(o.position.x, o.position.z);
        if (o.position.y <= gy + 0.3) {
          o.position.y = gy + 0.3;
          ch.landed = true;
          this.impact(o.position, null, 'sand');
          this.dust.spawn(o.position, {
            vel: new THREE.Vector3(0, 1, 0), size: 1.2, grow: 2.2, life: 0.7,
            opacity: 0.4, tint: 0xc9ae82,
          });
        }
      }
      // fade out over the last 0.8s past dur, then remove
      if (ch.t >= ch.dur) {
        const k = (ch.t - ch.dur) / 0.8;
        if (k >= 1) {
          G.scene.remove(o);
          this.chunks.splice(i, 1);
        } else {
          this._setOpacity(o, 1 - k);
        }
      }
    }
  }

  _updateAmbience(dt) {
    // vehicle dust trails: throttled scan of moving ground vehicles
    this.dustScanT -= dt;
    if (this.dustScanT <= 0) {
      this.dustScanT = 0.11;
      let budget = 8;
      for (const u of G.units) {
        if (budget <= 0) break;
        if (!u.alive || !u.vel || u.def.air || u.def.role === 'infantry') continue;
        if (Math.hypot(u.vel.x, u.vel.z) < 2) continue;
        if (rng() < 0.65) { this.dustTrail(u); budget--; }
      }
    }
    // wind-blown sand wisps drifting across open ground near the camera
    const tx = G.camRig ? G.camRig.tx : 0, tz = G.camRig ? G.camRig.tz : 0;
    for (const w of this.wisps) {
      w.t += dt;
      if (w.t >= w.dur) {
        w.t = 0;
        w.dur = 6 + rng() * 5;
        w.peak = 0.035 + rng() * 0.035;
        const px = tx + (rng() - 0.5) * 150, pz = tz + (rng() - 0.5) * 150;
        w.s.position.set(px, G.groundHeight(px, pz) + 0.8 + rng() * 1.6, pz);
        w.s.scale.set(15 + rng() * 14, 2.5 + rng() * 2, 1);
        w.vel.set(2.2 + rng() * 1.4, 0, 0.9 + rng() * 0.7);
        w.s.material.rotation = (rng() - 0.5) * 0.3;
        w.s.visible = true;
      }
      w.s.position.addScaledVector(w.vel, dt);
      w.s.material.opacity = w.peak * Math.sin(Math.PI * (w.t / w.dur));
    }
  }
}

function randVec(s) {
  return new THREE.Vector3((rng() - 0.5) * 2 * s, (rng() - 0.5) * 2 * s, (rng() - 0.5) * 2 * s);
}
