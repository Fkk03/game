// main.js — boot, render loop, postprocessing, menus, screenshot harness
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { VignetteShader } from 'three/addons/shaders/VignetteShader.js';
import { G, SHOT_MODE, SHOT_VIEW, clamp } from './core.js';
import { buildSky, updateSky } from './sky.js';
import { buildTerrain } from './terrain.js';
import { World } from './world.js';
import { Player } from './player.js';
import { Weapons, explodeAt } from './weapons.js';
import { FX } from './fx.js';
import { HUD } from './hud.js';
import { AudioSys } from './audio.js';
import { LAYOUT } from './layout.js';

const $ = (id) => document.getElementById(id);

// ---------------------------------------------------------------- boot
async function boot() {
  const canvas = $('game');
  const renderer = new THREE.WebGLRenderer({
    canvas, antialias: true, powerPreference: 'high-performance',
  });
  renderer.setSize(innerWidth, innerHeight);
  renderer.setPixelRatio(Math.min(devicePixelRatio, 1.75));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.08;
  G.renderer = renderer;

  G.scene = new THREE.Scene();
  G.camera = new THREE.PerspectiveCamera(75, innerWidth / innerHeight, 0.05, 1400);
  G.scene.add(G.camera);

  const steps = [
    ['Igniting the sun…', () => buildSky()],
    ['Sculpting the desert…', () => buildTerrain()],
    ['Raising the stronghold…', () => { new World().build(); }],
    ['Priming pyrotechnics…', () => { G.fx = new FX(); }],
    ['Issuing sidearms…', () => {
      G.player = new Player();
      G.weapons = new Weapons();
      G.audio = new AudioSys();
      G.hud = new HUD();
    }],
    ['Compositing optics…', () => setupComposer()],
  ];
  for (let i = 0; i < steps.length; i++) {
    $('load-text').textContent = steps[i][0];
    $('load-fill').style.width = ((i + 1) / steps.length * 100) + '%';
    await new Promise(r => setTimeout(r, 16));
    steps[i][1]();
  }
  $('loading').classList.add('hidden');

  window.addEventListener('resize', onResize);
  wireMenus();

  if (SHOT_MODE) {
    startShotMode();
  } else {
    $('menu').classList.remove('hidden');
    G.state = 'menu';
  }

  requestAnimationFrame(tick);
}

function setupComposer() {
  const composer = new EffectComposer(G.renderer);
  composer.addPass(new RenderPass(G.scene, G.camera));
  const bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.32, 0.6, 0.86);
  composer.addPass(bloom);
  const vign = new ShaderPass(VignetteShader);
  vign.uniforms.offset.value = 0.92;
  vign.uniforms.darkness.value = 1.12;
  composer.addPass(vign);
  composer.addPass(new OutputPass());
  G.composer = composer;
}

function onResize() {
  G.camera.aspect = innerWidth / innerHeight;
  G.camera.updateProjectionMatrix();
  G.renderer.setSize(innerWidth, innerHeight);
  G.composer?.setSize(innerWidth, innerHeight);
}

// ---------------------------------------------------------------- menus
function wireMenus() {
  $('btn-play').addEventListener('click', startGame);
  $('btn-resume').addEventListener('click', resumeGame);
  $('btn-restart').addEventListener('click', () => location.reload());
  $('btn-again').addEventListener('click', () => location.reload());

  document.addEventListener('pointerlockchange', () => {
    if (!document.pointerLockElement && G.state === 'playing' && !SHOT_MODE) {
      pauseGame();
    }
  });
  document.addEventListener('keydown', (e) => {
    if (e.code === 'Escape' && G.state === 'playing') pauseGame();
  });
}

function startGame() {
  $('menu').classList.add('hidden');
  G.audio.init();
  spawnPlayer();
  G.state = 'playing';
  G.stats.startTime = performance.now();
  G.hud.show();
  G.hud.setObjectives(G.world.visibleObjectives());
  G.hud.refreshWeapon();
  G.hud.announce('OPERATION FIRST STRIKE', 'Follow the road — take out the Stinger AA sites', 4.5);
  document.body.requestPointerLock?.call($('game')) ?? $('game').requestPointerLock();
}

function spawnPlayer() {
  const s = LAYOUT.spawn;
  // face down the road (toward first road point heading north-east)
  G.player.spawnAt(s.x, s.z, Math.PI * 1.28);
}

function pauseGame() {
  if (G.state !== 'playing') return;
  G.state = 'paused';
  document.exitPointerLock?.();
  $('pause').classList.remove('hidden');
}
function resumeGame() {
  $('pause').classList.add('hidden');
  G.state = 'playing';
  $('game').requestPointerLock();
}

export function gameOver(won) {
  if (G.state === 'over') return;
  G.state = 'over';
  document.exitPointerLock?.();
  const t = (performance.now() - G.stats.startTime) / 1000;
  const acc = G.stats.shotsFired ? Math.round(G.stats.shotsHit / G.stats.shotsFired * 100) : 0;
  $('end-title').textContent = won ? 'MISSION ACCOMPLISHED' : 'K.I.A.';
  $('end-title').classList.toggle('lose', !won);
  $('end-stats').innerHTML = `<table>
    <tr><td>Time</td><td>${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}</td></tr>
    <tr><td>Kills</td><td>${G.stats.kills}</td></tr>
    <tr><td>Accuracy</td><td>${acc}%</td></tr>
    <tr><td>Damage taken</td><td>${Math.round(G.stats.damageTaken)}</td></tr>
  </table>`;
  if (!won) G.audio?.announceLose();
  setTimeout(() => $('end').classList.remove('hidden'), won ? 800 : 1400);
}

// ---------------------------------------------------------------- loop
let last = 0;
function tick(now) {
  requestAnimationFrame(tick);
  const dt = Math.min(0.05, (now - last) / 1000 || 0.016);
  last = now;
  G.dt = dt;
  G.time += dt;

  if (G.state === 'playing' || G.state === 'over' || SHOT_MODE) {
    if (!SHOT_MODE || shotCfg.live) {
      G.player.update(dt);
      G.weapons.update(dt);
    }
    if (!G.freezeAI) {
      for (const e of G.enemies) e.update(dt);
      for (const v of G.vehicles) v.update(dt);
    }
    G.world.update(dt);
    G.fx.update(dt);
    updateSky(dt);
    if (G.state === 'playing') G.hud.update(dt);
  }

  G.composer ? G.composer.render() : G.renderer.render(G.scene, G.camera);
  frameCount++;
  if (SHOT_MODE && frameCount === shotCfg.readyFrame) {
    window.__shotReady = true;
    document.title = 'SHOT_READY';
  }
}
let frameCount = 0;

// ---------------------------------------------------------------- screenshot harness
const shotCfg = { live: false, readyFrame: 24 };

function startShotMode() {
  $('menu').classList.add('hidden');
  G.state = 'playing';
  spawnPlayer();
  G.hud.show();
  G.hud.setObjectives(G.world.visibleObjectives());
  G.hud.refreshWeapon();
  G.freezeAI = true;

  const cam = G.camera;
  const p = G.player;
  const place = (x, z, yaw, pitch = 0) => {
    p.pos.set(x, G.groundHeight(x, z), z);
    p.yaw = yaw; p.pitch = pitch;
    shotCfg.live = true;   // run player update so camera/viewmodel settle
  };
  const flycam = (x, y, z, lx, ly, lz) => {
    shotCfg.live = false;
    G.weapons.rig.visible = false;
    cam.position.set(x, y, z);
    cam.lookAt(lx, ly, lz);
    G.hud.hide();
  };

  const B = LAYOUT.base, V = LAYOUT.village, O = LAYOUT.oasis, F = LAYOUT.oilfield;
  switch (SHOT_VIEW) {
    case 'vista':     // player POV at spawn looking down the road
      place(LAYOUT.spawn.x, LAYOUT.spawn.z, Math.PI * 1.28, -0.03);
      break;
    case 'road':      // mid-road toward oil field
      place(20, 0, Math.PI * 1.3, 0);
      break;
    case 'base':      // inside the stronghold, looking at command center
      place(B.x - 20, B.z + 30, Math.PI * 1.2, 0.02);
      break;
    case 'gate':      // approaching the gate
      place(B.x - 60, B.z + 55, Math.PI * 1.25, 0);
      break;
    case 'village':
      place(V.x + 25, V.z + 20, Math.PI * 1.32, 0);
      break;
    case 'oasis':
      place(O.x + 24, O.z + 12, Math.PI * 1.45, -0.02);
      break;
    case 'oilfield':
      place(F.x + 22, F.z + 16, Math.PI * 1.3, 0);
      break;
    case 'overview':  // high RTS-style vantage over the base
      flycam(B.x - 90, 65, B.z + 110, B.x, 5, B.z);
      break;
    case 'combat': {  // staged firefight for FX evaluation
      place(B.x - 12, B.z + 32, Math.PI * 1.1, 0);
      shotCfg.readyFrame = 40;
      setTimeout(() => {
        const t = new THREE.Vector3(B.x - 18, G.groundHeight(B.x - 18, B.z + 12) + 1, B.z + 12);
        explodeAt(t, 6, 0, true);
        for (const e of G.enemies.slice(0, 4)) {
          if (e.group.position.distanceTo(p.pos) < 80) e.fireAtPlayer(30);
        }
        G.weapons.triggerHeld = true;
        setTimeout(() => { G.weapons.triggerHeld = false; }, 300);
      }, 350);
      break;
    }
    case 'gun':       // viewmodel closeup
      place(LAYOUT.spawn.x, LAYOUT.spawn.z, Math.PI * 1.28, 0.12);
      break;
    default:
      place(LAYOUT.spawn.x, LAYOUT.spawn.z, Math.PI * 1.28, 0);
  }
}

boot();
