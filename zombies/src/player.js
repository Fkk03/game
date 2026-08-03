// First-person player: pointer-lock look, WASD + sprint + jump, capsule-vs-AABB
// collision, health/regen, interaction (buy/use), and camera feel (bob, land dip, shake).
import * as THREE from 'three';

export function initPlayer(G) {
  const P = G.player = {
    pos: new THREE.Vector3(0, 0, 12),
    vel: new THREE.Vector3(),
    yaw: 0,                  // face north (-z) toward the house
    pitch: 0,
    onGround: true,
    radius: 0.35, eye: 1.62,
    health: 100, maxHealth: 100,
    regenDelay: 0, dead: false,
    sprinting: false, sprintTime: 0,
    moveInput: new THREE.Vector2(),
    bobPhase: 0, bobAmp: 0,
    landDip: 0, shake: 0, shakeT: 0,
    points: 500, totalPoints: 500, kills: 0, headshots: 0,
    perks: new Set(),
    interactTarget: null, holdT: 0,
    speedMul: 1,
    lastDamageDir: null,
  };

  const keys = G.keys = {};
  addEventListener('keydown', (e) => {
    if (e.repeat) return;
    keys[e.code] = true;
    G.events.emit('keydown', e.code);
  });
  addEventListener('keyup', (e) => { keys[e.code] = false; });
  addEventListener('mousemove', (e) => {
    // fallback look mode for embeds that deny pointer lock (G.dragLook set by main)
    if (!G.locked && !(G.dragLook && G.state === 'PLAYING')) return;
    const s = 0.0021;
    P.yaw -= e.movementX * s;
    P.pitch = Math.max(-1.45, Math.min(1.45, P.pitch - e.movementY * s));
    G.lastMouseX = (G.lastMouseX ?? 0) + e.movementX;
    G.lastMouseY = (G.lastMouseY ?? 0) + e.movementY;
  });

  G.addPoints = (n, why) => {
    P.points += n; P.totalPoints += n;
    G.events.emit('points', { n, why });
  };
  G.spendPoints = (n) => {
    if (P.points < n) { G.events.emit('noFunds', n); return false; }
    P.points -= n;
    G.events.emit('points', { n: -n, why: 'spend' });
    return true;
  };

  G.damagePlayer = (dmg, fromPos) => {
    if (P.dead || G.state !== 'PLAYING') return;
    const maxH = P.perks.has('jugg') ? 200 : 100;
    P.health -= dmg;
    P.regenDelay = 3.2;
    P.shake = Math.min(1, P.shake + 0.5);
    if (fromPos) P.lastDamageDir = fromPos.clone().sub(P.pos).setY(0).normalize();
    G.events.emit('playerHurt', { dmg, health: P.health, maxH });
    if (P.health <= 0) {
      P.dead = true;
      G.events.emit('playerDied');
    }
  };

  return P;
}

const tmpF = new THREE.Vector3(), tmpR = new THREE.Vector3(), tmpM = new THREE.Vector3();

export function updatePlayer(G, dt, t) {
  const P = G.player, keys = G.keys;
  if (P.dead) { applyCamera(G, t, dt); return; }

  // ---- movement input ----
  const f = (keys.KeyW ? 1 : 0) - (keys.KeyS ? 1 : 0);
  const r = (keys.KeyD ? 1 : 0) - (keys.KeyA ? 1 : 0);
  P.moveInput.set(r, f);
  const wantSprint = keys.ShiftLeft && f > 0 && !G.weapons?.isADS();
  P.sprinting = wantSprint && (P.perks.has('stamin') || P.sprintTime < 4.2);
  P.sprintTime = wantSprint ? P.sprintTime + dt : Math.max(0, P.sprintTime - dt * 1.6);

  const baseSpeed = 4.3;
  let speed = baseSpeed * (P.sprinting ? 1.55 : 1) * P.speedMul;
  if (G.weapons?.isADS()) speed *= 0.55;

  tmpF.set(-Math.sin(P.yaw), 0, -Math.cos(P.yaw));
  tmpR.set(-tmpF.z, 0, tmpF.x);
  tmpM.set(0, 0, 0).addScaledVector(tmpF, f).addScaledVector(tmpR, r);
  if (tmpM.lengthSq() > 1) tmpM.normalize();
  tmpM.multiplyScalar(speed);

  // accelerate toward wish velocity (ground friction feel)
  const accel = P.onGround ? 14 : 3.5;
  P.vel.x += (tmpM.x - P.vel.x) * Math.min(1, accel * dt);
  P.vel.z += (tmpM.z - P.vel.z) * Math.min(1, accel * dt);

  // gravity & jump
  P.vel.y -= 22 * dt;
  if (keys.Space && P.onGround) {
    P.vel.y = 6.8;
    P.onGround = false;
    G.events.emit('jump');
  }

  // integrate + collide
  const wasAir = !P.onGround;
  const oldY = P.vel.y;
  P.pos.x += P.vel.x * dt;
  collideXZ(G, P);
  P.pos.z += P.vel.z * dt;
  collideXZ(G, P);
  P.pos.y += P.vel.y * dt;
  P.onGround = false;
  if (P.pos.y <= 0) {
    P.pos.y = 0; P.vel.y = 0; P.onGround = true;
    if (wasAir && oldY < -6) { P.landDip = Math.min(0.5, -oldY * 0.035); G.events.emit('land'); }
  }
  // clamp to world bounds (outside strip is for zombies only)
  P.pos.x = Math.max(-25.5, Math.min(25.5, P.pos.x));
  P.pos.z = Math.max(-17.5, Math.min(19.5, P.pos.z));

  // ---- health regen ----
  P.regenDelay -= dt;
  const maxH = P.perks.has('jugg') ? 200 : 100;
  P.maxHealth = maxH;
  if (P.regenDelay <= 0 && P.health < maxH) {
    P.health = Math.min(maxH, P.health + dt * 46);
  }

  // ---- interaction ----
  updateInteract(G, dt);

  // ---- camera feel ----
  const planar = Math.hypot(P.vel.x, P.vel.z);
  P.bobAmp += ((P.onGround && planar > 0.5 ? Math.min(1, planar / 6) : 0) - P.bobAmp) * Math.min(1, 8 * dt);
  P.bobPhase += dt * (P.sprinting ? 11.5 : 8.2) * (planar > 0.4 ? 1 : 0);
  P.landDip = Math.max(0, P.landDip - dt * 1.8);
  P.shake = Math.max(0, P.shake - dt * 2.2);
  applyCamera(G, t, dt);

  G.events.emit('playerMoved', P);
}

function applyCamera(G, t, dt) {
  const P = G.player, cam = G.camera;
  P.shakeT += dt * 34;
  const bobY = Math.sin(P.bobPhase * 2) * 0.035 * P.bobAmp;
  const bobX = Math.cos(P.bobPhase) * 0.02 * P.bobAmp;
  const shX = P.shake * 0.03 * Math.sin(P.shakeT * 1.3);
  const shY = P.shake * 0.025 * Math.sin(P.shakeT * 1.7 + 2);
  cam.position.set(P.pos.x + bobX + shX, P.pos.y + P.eye + bobY - P.landDip + shY, P.pos.z);
  cam.rotation.order = 'YXZ';
  cam.rotation.set(P.pitch + shY * 0.6 + Math.sin(P.bobPhase) * 0.002 * P.bobAmp, P.yaw + shX * 0.5, P.shake * 0.01 * Math.sin(P.shakeT));
  if (P.dead) {
    // slump to the ground, tilt
    cam.position.y = Math.max(0.4, cam.position.y - (G.deathT ?? 0) * 1.1);
    cam.rotation.z = Math.min(0.5, (G.deathT ?? 0) * 0.6);
  }
}

// circle-vs-AABB pushout in XZ (called per axis for stable sliding)
function collideXZ(G, P) {
  const r = P.radius;
  for (const c of G.world.colliders) {
    if (P.pos.y > c.max.y - 0.05 || P.pos.y + 1.7 < c.min.y) continue;
    const nx = Math.max(c.min.x, Math.min(c.max.x, P.pos.x));
    const nz = Math.max(c.min.z, Math.min(c.max.z, P.pos.z));
    const dx = P.pos.x - nx, dz = P.pos.z - nz;
    const d2 = dx * dx + dz * dz;
    if (d2 >= r * r) continue;
    if (d2 < 1e-8) {
      // deep inside: push out along the smallest axis penetration
      const px = Math.min(P.pos.x - c.min.x + r, c.max.x - P.pos.x + r);
      const pz = Math.min(P.pos.z - c.min.z + r, c.max.z - P.pos.z + r);
      if (px < pz) P.pos.x += (P.pos.x - (c.min.x + c.max.x) / 2 > 0 ? px : -px);
      else P.pos.z += (P.pos.z - (c.min.z + c.max.z) / 2 > 0 ? pz : -pz);
      continue;
    }
    const d = Math.sqrt(d2);
    const push = (r - d) / d;
    P.pos.x += dx * push;
    P.pos.z += dz * push;
  }
}

function updateInteract(G, dt) {
  const P = G.player;
  let best = null, bestD = 1e9;
  const eye = new THREE.Vector3(P.pos.x, P.pos.y + P.eye, P.pos.z);
  const look = new THREE.Vector3(-Math.sin(P.yaw) * Math.cos(P.pitch), Math.sin(P.pitch), -Math.cos(P.yaw) * Math.cos(P.pitch));
  for (const it of G.world.interactables) {
    const label = it.getLabel(G);
    if (!label) continue;
    const d = it.pos.distanceTo(eye);
    if (d > it.radius) continue;
    const to = it.pos.clone().sub(eye).normalize();
    if (to.dot(look) < 0.25 && d > 1.0) continue;
    if (d < bestD) { bestD = d; best = { it, label }; }
  }
  P.interactTarget = best;
  if (best && G.keys.KeyF) {
    if (best.it.hold) {
      P.holdT += dt;
      if (P.holdT >= best.it.hold) { best.it.use(G); P.holdT = 0; }
    } else if (!P.usedThisPress) {
      best.it.use(G);
      P.usedThisPress = true;
    }
  } else {
    P.holdT = 0;
  }
  if (!G.keys.KeyF) P.usedThisPress = false;
}
