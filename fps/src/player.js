// player.js — first-person controller: pointer lock, movement, collision, camera feel
import * as THREE from 'three';
import { G, clamp, damp, SHOT_MODE } from './core.js';

const EYE = 1.68, CROUCH_EYE = 1.05;
const RADIUS = 0.45;

export class Player {
  constructor() {
    this.pos = new THREE.Vector3(0, 0, 0);
    this.vel = new THREE.Vector3();
    this.yaw = 0; this.pitch = 0;
    this.onGround = true;
    this.crouch = false;
    this.sprinting = false;
    this.hp = 100; this.maxHp = 100;
    this.armor = 50; this.maxArmor = 50;
    this.dead = false;
    this.bobT = 0; this.bobAmt = 0;
    this.eye = EYE;
    this.landKick = 0;
    this.stepT = 0;
    this.keys = {};
    this.recoilPitch = 0; this.recoilYaw = 0;
    this.hurtDir = 0;

    document.addEventListener('keydown', e => {
      this.keys[e.code] = true;
      if (e.code === 'KeyC') this.crouch = !this.crouch;
    });
    document.addEventListener('keyup', e => { this.keys[e.code] = false; });
    document.addEventListener('mousemove', e => {
      if (G.state !== 'playing' || (!SHOT_MODE && document.pointerLockElement === null)) return;
      const sens = 0.0021;
      this.yaw -= e.movementX * sens;
      this.pitch -= e.movementY * sens;
      this.pitch = clamp(this.pitch, -1.45, 1.45);
    });
  }

  spawnAt(x, z, yaw = 0) {
    this.pos.set(x, G.groundHeight(x, z), z);
    this.yaw = yaw;
    this.pitch = 0;
    this.vel.set(0, 0, 0);
    this.hp = this.maxHp; this.armor = 50;
    this.dead = false;
  }

  forwardDir() {
    return new THREE.Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
  }

  update(dt) {
    if (this.dead) return;
    const k = this.keys;
    let mx = 0, mz = 0;
    if (k['KeyW'] || k['ArrowUp']) mz += 1;
    if (k['KeyS'] || k['ArrowDown']) mz -= 1;
    if (k['KeyA'] || k['ArrowLeft']) mx -= 1;
    if (k['KeyD'] || k['ArrowRight']) mx += 1;
    const moving = mx !== 0 || mz !== 0;
    this.sprinting = !!k['ShiftLeft'] && mz > 0 && !this.crouch && !G.weapons?.ads;

    const speed = this.crouch ? 2.6 : (this.sprinting ? 8.2 : 5.2);
    const f = this.forwardDir();
    const r = new THREE.Vector3(-f.z, 0, f.x);
    const wish = new THREE.Vector3()
      .addScaledVector(f, mz).addScaledVector(r, mx);
    if (wish.lengthSq() > 0) wish.normalize().multiplyScalar(speed);

    // horizontal accel
    const accel = this.onGround ? 14 : 3;
    this.vel.x = damp(this.vel.x, wish.x, accel, dt);
    this.vel.z = damp(this.vel.z, wish.z, accel, dt);

    // gravity & jump
    this.vel.y -= 24 * dt;
    if ((k['Space']) && this.onGround) {
      this.vel.y = 8.2;
      this.onGround = false;
      G.audio?.jump();
    }

    // integrate + collide
    const next = this.pos.clone().addScaledVector(this.vel, dt);
    this.collide(next);
    this.pos.copy(next);

    // ground
    const gy = G.groundHeight(this.pos.x, this.pos.z);
    if (this.pos.y <= gy) {
      if (!this.onGround && this.vel.y < -8) {
        this.landKick = Math.min(0.25, -this.vel.y * 0.014);
        G.audio?.footstep();
      }
      this.pos.y = gy;
      this.vel.y = 0;
      this.onGround = true;
    } else if (this.pos.y > gy + 0.05) {
      this.onGround = false;
    }

    // head bob + footsteps
    const hs = Math.hypot(this.vel.x, this.vel.z);
    if (this.onGround && hs > 0.5) {
      this.bobT += dt * (4 + hs * 1.15);
      this.bobAmt = damp(this.bobAmt, Math.min(1, hs / 5.5), 8, dt);
      this.stepT -= dt * hs;
      if (this.stepT <= 0) {
        this.stepT = 2.1;
        G.audio?.footstep();
      }
    } else {
      this.bobAmt = damp(this.bobAmt, 0, 8, dt);
    }
    this.landKick = damp(this.landKick, 0, 10, dt);

    // recoil recovery
    this.recoilPitch = damp(this.recoilPitch, 0, 9, dt);
    this.recoilYaw = damp(this.recoilYaw, 0, 9, dt);

    // eye height
    const targetEye = this.crouch ? CROUCH_EYE : EYE;
    this.eye = damp(this.eye, targetEye, 12, dt);

    // camera
    const cam = G.camera;
    const bobY = Math.abs(Math.sin(this.bobT)) * 0.055 * this.bobAmt;
    const bobX = Math.sin(this.bobT * 0.5) * 0.035 * this.bobAmt;
    cam.position.set(
      this.pos.x + bobX * Math.cos(this.yaw),
      this.pos.y + this.eye + bobY - this.landKick,
      this.pos.z + bobX * -Math.sin(this.yaw));
    cam.rotation.order = 'YXZ';
    cam.rotation.y = this.yaw + this.recoilYaw;
    cam.rotation.x = this.pitch + this.recoilPitch;
    cam.rotation.z = Math.sin(this.bobT * 0.5) * 0.004 * this.bobAmt;

    // shake
    if (G.fx && G.fx.shakeAmt > 0.001) {
      const s = G.fx.shakeAmt * 0.05;
      cam.rotation.x += (Math.random() - 0.5) * s;
      cam.rotation.y += (Math.random() - 0.5) * s;
      cam.rotation.z += (Math.random() - 0.5) * s * 0.6;
    }

    // armor regen (slow, delayed by damage via hurtT)
    this.hurtT = Math.max(0, (this.hurtT || 0) - dt);
  }

  collide(next) {
    // push out of static box colliders (2D, capsule radius)
    for (const c of G.colliders) {
      const b = c.box;
      if (next.y > b.max.y - 0.2 || next.y + 1.7 < b.min.y) continue;
      const cx = clamp(next.x, b.min.x, b.max.x);
      const cz = clamp(next.z, b.min.z, b.max.z);
      const dx = next.x - cx, dz = next.z - cz;
      const d2 = dx * dx + dz * dz;
      if (d2 < RADIUS * RADIUS) {
        if (d2 > 1e-9) {
          const d = Math.sqrt(d2);
          next.x = cx + dx / d * RADIUS;
          next.z = cz + dz / d * RADIUS;
        } else {
          // inside the box — push out along smallest axis
          const px = Math.min(next.x - b.min.x, b.max.x - next.x);
          const pz = Math.min(next.z - b.min.z, b.max.z - next.z);
          if (px < pz) next.x = (next.x - b.min.x < b.max.x - next.x) ? b.min.x - RADIUS : b.max.x + RADIUS;
          else next.z = (next.z - b.min.z < b.max.z - next.z) ? b.min.z - RADIUS : b.max.z + RADIUS;
        }
      }
    }
    // world bounds
    next.x = clamp(next.x, -290, 290);
    next.z = clamp(next.z, -290, 290);
  }

  takeDamage(amount, fromPos) {
    if (this.dead || G.state !== 'playing') return;
    let dmg = amount;
    if (this.armor > 0) {
      const ab = Math.min(this.armor, dmg * 0.6);
      this.armor -= ab;
      dmg -= ab;
    }
    this.hp -= dmg;
    this.hurtT = 3;
    G.stats.damageTaken += amount;
    G.audio?.playerHurt();
    G.hud?.onPlayerHurt();
    G.fx?.shake(0.25);
    if (this.hp <= 0) {
      this.hp = 0;
      this.dead = true;
      import('./main.js').then(m => m.gameOver(false));
    }
  }
}
