// BLACKSITE 115 — main entry: renderer, game state machine, module wiring, loop.
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { initPlayer, updatePlayer } from './player.js';
import { initWorld } from './world.js';
import { initWeapons, updateWeapons } from './weapons.js';
import { initZombies, updateZombies } from './zombies.js';
import { initFx, updateFx } from './fx.js';
import { initAudio, updateAudio } from './audio.js';
import { initHud, updateHud } from './hud.js';
import { initEaster } from './easter.js';
import { initPost, updatePost } from './post.js';
import { initPhotoMode } from './photomode.js';

const params = new URLSearchParams(location.search);
const photoPreset = parseInt(params.get('photo') ?? '0', 10) || 0;

// ---------- game object ----------
const G = window.__G = {
  state: 'MENU',
  locked: false,
  seed: photoPreset ? 1000 + photoPreset : 1337,
  time: 0,
  deathT: 0,
  events: (() => {
    const m = new Map();
    return {
      on: (k, f) => { (m.get(k) ?? m.set(k, []).get(k)).push(f); },
      emit: (k, d) => { const l = m.get(k); if (l) for (const f of l) f(d); },
    };
  })(),
};

// ---------- renderer / scene / camera ----------
const renderer = G.renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' });
renderer.setSize(innerWidth, innerHeight);
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.6));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.getElementById('app').appendChild(renderer.domElement);

const scene = G.scene = new THREE.Scene();
scene.fog = new THREE.FogExp2(0x0a0e12, 0.026);

// low-intensity IBL so metals (guns, casings, machines) have something to
// reflect — without this, high-metalness surfaces render black
{
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environmentIntensity = 0.055;
  pmrem.dispose();
}

const camera = G.camera = new THREE.PerspectiveCamera(70, innerWidth / innerHeight, 0.05, 400);
camera.rotation.order = 'YXZ';
scene.add(camera);

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

// ---------- module init ----------
initPlayer(G);
initWorld(G);
initWeapons(G);
initZombies(G);
initFx(G);
initAudio(G);
initHud(G);
initEaster(G);
initPost(G);

// static raycast targets (walls, props, meteors…) — everything solid & opaque
G.staticRay = [];
scene.traverse((o) => {
  if (!o.isMesh || o.userData.noBlock) return;
  if (o.material?.transparent) return;
  if (o.isInstancedMesh) return;
  for (let p = o.parent; p; p = p.parent) if (p === camera) return; // never viewmodel parts
  G.staticRay.push(o);
});

// ---------- state transitions ----------
const menuEl = document.getElementById('menu');
const pausedEl = document.getElementById('paused');
const hudEl = document.getElementById('hud');

function startGame({ pointer = true } = {}) {
  menuEl.classList.add('hidden');
  pausedEl.classList.add('hidden');
  hudEl.classList.add('on');
  G.audio.boot?.();
  G.state = 'PLAYING';
  if (pointer) renderer.domElement.requestPointerLock?.();
  G.events.emit('gameStart');
}
document.getElementById('btn-deploy').addEventListener('click', () => startGame());
document.getElementById('btn-restart').addEventListener('click', () => location.reload());
pausedEl.addEventListener('click', () => {
  pausedEl.classList.add('hidden');
  renderer.domElement.requestPointerLock?.();
});
document.addEventListener('pointerlockchange', () => {
  G.locked = document.pointerLockElement === renderer.domElement;
  if (!G.locked && G.state === 'PLAYING' && !G.player.dead && !G.dragLook) {
    pausedEl.classList.remove('hidden');
  }
});
// embeds (e.g. sandboxed iframes) may deny pointer lock — fall back to raw
// mousemove look so the game stays playable
document.addEventListener('pointerlockerror', () => {
  G.dragLook = true;
  G.locked = false;
});
G.events.on('playerDied', () => { G.state = 'DEAD'; });

// ---------- simulation step (shared by live loop & photo priming) ----------
G.tickSim = (dt) => {
  G.time += dt;
  const t = G.time;
  G.events.emit('update', { dt, t });
  updateWeapons(G, dt, t);
  updateZombies(G, dt, t);
  updateFx(G, dt, t);
  updateHud(G, dt, t);
  updatePost(G, dt, t);
};
G.renderFrame = () => { G.composer.render(); };

// ---------- test API (headless smoke tests) ----------
window.__testAPI = {
  G,
  start: () => { startGame({ pointer: false }); G.locked = true; },
  state: () => ({
    state: G.state, round: G.zombies.round, points: G.player.points,
    health: G.player.health, kills: G.player.kills,
    zombies: G.zombies.list.filter(z => !z.gone && z.state !== 'dead').length,
    chasing: G.zombies.list.filter(z => !z.gone && (z.state === 'chasing' || z.state === 'attacking')).length,
    weapon: G.weapons.current().id, ammo: G.weapons.current().ammo, reserve: G.weapons.current().reserve,
  }),
  step: (n = 1, dt = 1 / 60) => { for (let i = 0; i < n; i++) { stepOnce(dt); } },
  shoot: () => { G.weapons.triggerEdge = true; G.weapons.triggerHeld = true; setTimeout(() => G.weapons.triggerHeld = false, 50); },
};

// ---------- main loop ----------
let last = performance.now();
let menuAngle = 0.6;

function stepOnce(dt) {
  const t = G.time;
  if (G.state === 'PLAYING' || G.state === 'DEAD') {
    if (G.state === 'DEAD') G.deathT += dt;
    updatePlayer(G, dt, t);
  }
  G.tickSim(dt);
}

function loop(now) {
  requestAnimationFrame(loop);
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;

  if (G.state === 'PHOTO') return; // photomode drives its own stepping, then holds the frame

  if (G.state === 'MENU') {
    // slow cinematic orbit of the map
    menuAngle += dt * 0.03;
    camera.position.set(Math.cos(menuAngle) * 26, 9 + Math.sin(menuAngle * 0.7) * 2, Math.sin(menuAngle) * 26);
    camera.lookAt(0, 1.5, -4);
    G.time += dt;
    G.events.emit('update', { dt, t: G.time });
    updateFx(G, dt, G.time);
    updatePost(G, dt, G.time);
  } else {
    stepOnce(dt);
  }
  G.renderFrame();
}

if (photoPreset) {
  initPhotoMode(G, photoPreset);
  requestAnimationFrame(loop);
} else {
  requestAnimationFrame(loop);
}
