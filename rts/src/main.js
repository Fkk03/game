// main.js — boot, menus, render/sim loop, postprocessing, screenshot harness.
// OWNED BY: core scaffold. Lighting agent may tune setupComposer()/renderer
// settings ONLY. The shot-mode section is load-bearing for all agents.
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { VignetteShader } from 'three/addons/shaders/VignetteShader.js';
import { G, SHOT_MODE, SHOT_VIEW, emit } from './core.js';
import { FACTIONS } from './data.js';
import { buildSky, updateSky } from './sky.js';
import { buildTerrain } from './terrain.js';
import { LAYOUT } from './layout.js';
import { initNav, stepUnits } from './move.js';
import { buildWorld } from './world.js';
import { initEconomy, tickEconomy } from './economy.js';
import { tickProduction, tickConstruction } from './production.js';
import { tickCombat } from './combat.js';
import { tickPowers } from './powers.js';
import { initAI, tickAI } from './ai.js';
import { initFow, tickFow } from './fow.js';
import { sweepDead } from './entities.js';
import { CameraRig } from './camera.js';
import { Input } from './input.js';
import { HUD } from './hud.js';
import { Minimap } from './minimap.js';
import { FX } from './fx.js';
import { AudioSys } from './audio.js';

const $ = (id) => document.getElementById(id);

// ---------------------------------------------------------------- boot
async function boot() {
  const canvas = $('game');
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  renderer.setSize(innerWidth, innerHeight);
  renderer.setPixelRatio(Math.min(devicePixelRatio, 1.75));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.02;
  G.renderer = renderer;

  G.scene = new THREE.Scene();
  G.camera = new THREE.PerspectiveCamera(46, innerWidth / innerHeight, 0.5, 2000);
  G.scene.add(G.camera);

  const steps = [
    ['Igniting the sun…', () => buildSky()],
    ['Sculpting the desert…', () => buildTerrain()],
    ['Surveying routes…', () => initNav()],
    ['Compositing optics…', () => setupComposer()],
  ];
  for (let i = 0; i < steps.length; i++) {
    $('load-text').textContent = steps[i][0];
    $('load-fill').style.width = ((i + 1) / steps.length * 100) + '%';
    await new Promise(r => setTimeout(r, 16));
    steps[i][1]();
  }
  $('loading').classList.add('hidden');

  new CameraRig().attach(canvas);
  G.camRig.jumpTo(LAYOUT.spawn.x + 30, LAYOUT.spawn.z - 30);

  addEventListener('resize', onResize);
  wireMenus();

  if (SHOT_MODE) startShotMode();
  else G.state = 'menu';

  requestAnimationFrame(tick);
}

function makePlayer(id, name, human, faction, color, colorCss, money) {
  return {
    id, name, human, faction, color, colorCss, money,
    powerUsed: 0, powerMade: 0,
    xp: 0, rank: 1, ptsAvail: 1,
    powersOwned: new Set(), powerCooldowns: {},
    upgrades: new Set(),
    stats: { kills: 0, losses: 0, built: 0, earned: 0 },
    alive: true, baseX: 0, baseZ: 0, cc: null,
    rateIn: 0, rateOut: 0,
  };
}

function startGame() {
  const cfg = G.cfg;
  const pf = cfg.faction;
  const ef = pf === 'coalition' ? 'cartel' : 'coalition';
  G.players = [
    makePlayer(0, 'Commander', true, pf, FACTIONS[pf].color, FACTIONS[pf].colorCss, cfg.cash),
    makePlayer(1, 'Scorpion AI', false, ef, ef === 'cartel' ? 0xd04a30 : 0xc23a2a, '#ff7a5a', cfg.cash),
  ];
  G.humanId = 0;
  initEconomy();
  buildWorld();
  G.fx = new FX();
  G.audio = new AudioSys();
  if (!SHOT_MODE) G.audio.init?.();
  G.hud = new HUD(); G.hud.init();
  G.minimap = new Minimap(); G.minimap.init();
  initFow();
  new Input().init();
  initAI(1, cfg.diff);
  const b = LAYOUT.bases[0];
  G.camRig.jumpTo(b.x + 20, b.z - 20, b.facing + Math.PI);
  G.state = 'playing';
  G.gameTime = 0;
  emit('announce', 'BATTLE CONTROL ONLINE');
  emit('feed', `Destroy every enemy structure. Good hunting, Commander.`);
}

// ---------------------------------------------------------------- composer
function setupComposer() {
  const composer = new EffectComposer(G.renderer);
  composer.addPass(new RenderPass(G.scene, G.camera));
  const bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.28, 0.6, 0.88);
  composer.addPass(bloom);
  const GradeShader = {
    uniforms: { tDiffuse: { value: null } },
    vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: `
      uniform sampler2D tDiffuse; varying vec2 vUv;
      void main(){
        vec4 c = texture2D(tDiffuse, vUv);
        vec3 col = max(c.rgb, 0.0);
        col = pow(col, vec3(1.045));
        col *= vec3(1.035, 1.0, 0.945);
        float l = dot(col, vec3(0.2126, 0.7152, 0.0722));
        col = mix(vec3(l), col, 1.08);
        gl_FragColor = vec4(col, c.a);
      }`,
  };
  composer.addPass(new ShaderPass(GradeShader));
  const vign = new ShaderPass(VignetteShader);
  vign.uniforms.offset.value = 0.98;
  vign.uniforms.darkness.value = 1.0;
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
  document.querySelectorAll('#faction-cards .f-card').forEach(c => {
    c.addEventListener('click', () => {
      document.querySelectorAll('#faction-cards .f-card').forEach(o => o.classList.remove('sel'));
      c.classList.add('sel');
      G.cfg.faction = c.dataset.faction;
    });
  });
  const pills = (wrapId, key, cast) => {
    document.querySelectorAll(`#${wrapId} .pill`).forEach(p => {
      p.addEventListener('click', () => {
        document.querySelectorAll(`#${wrapId} .pill`).forEach(o => o.classList.remove('sel'));
        p.classList.add('sel');
        G.cfg[key] = cast ? cast(p.dataset[key]) : p.dataset[key];
      });
    });
  };
  pills('diff-pills', 'diff');
  pills('cash-pills', 'cash', Number);
  $('btn-play').addEventListener('click', () => { $('menu').classList.add('hidden'); startGame(); });
  $('btn-howto').addEventListener('click', () => $('help').classList.remove('hidden'));
  $('btn-help-close').addEventListener('click', () => $('help').classList.add('hidden'));
  $('btn-help').addEventListener('click', () => $('help').classList.toggle('hidden'));
  $('btn-menu').addEventListener('click', () => pauseGame());
  $('btn-resume').addEventListener('click', () => { $('pause').classList.add('hidden'); G.state = 'playing'; });
  $('btn-restart').addEventListener('click', () => location.reload());
  $('btn-again').addEventListener('click', () => location.reload());
  addEventListener('keydown', (e) => {
    if (e.code === 'Escape' && G.state === 'playing') pauseGame();
    else if (e.code === 'Escape' && G.state === 'paused') { $('pause').classList.add('hidden'); G.state = 'playing'; }
    if (e.code === 'F1') { e.preventDefault(); $('help').classList.toggle('hidden'); }
    if (e.code === 'Tab' && G.state === 'playing') { e.preventDefault(); $('scoreboard').classList.remove('hidden'); }
  });
  addEventListener('keyup', (e) => {
    if (e.code === 'Tab') $('scoreboard').classList.add('hidden');
  });
  $('btn-score').addEventListener('click', () => $('scoreboard').classList.toggle('hidden'));
}

function pauseGame() {
  if (G.state !== 'playing') return;
  G.state = 'paused';
  $('pause').classList.remove('hidden');
}

export function gameOver(winnerPid) {
  if (G.state === 'over') return;
  G.state = 'over';
  const won = winnerPid === G.humanId;
  const p = G.players[G.humanId];
  $('endtitle').textContent = won ? 'VICTORY' : 'DEFEAT';
  $('endtitle').className = 'title ' + (won ? 'win' : 'lose');
  const t = Math.floor(G.gameTime);
  $('endstats').innerHTML = `<table>
    <tr><td>Battle time</td><td>${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}</td></tr>
    <tr><td>Units destroyed</td><td>${p.stats.kills}</td></tr>
    <tr><td>Units lost</td><td>${p.stats.losses}</td></tr>
    <tr><td>Credits earned</td><td>$${p.stats.earned}</td></tr>
    <tr><td>Final rank</td><td>${'★'.repeat(p.rank)}</td></tr>
  </table>`;
  setTimeout(() => $('end').classList.remove('hidden'), won ? 900 : 1500);
}

// victory check: all buildings of a side destroyed (neutrals excluded)
let victoryT = 0;
function checkVictory(dt) {
  victoryT += dt;
  if (victoryT < 1) return;
  victoryT = 0;
  for (const p of G.players) {
    if (!p.alive) continue;
    const any = G.buildings.some(b => b.alive && b.owner === p.id);
    if (!any && G.gameTime > 5) {
      p.alive = false;
      gameOver(p.id === 0 ? 1 : 0);
    }
  }
}

// ---------------------------------------------------------------- loop
let last = 0, frameCount = 0;
const shotCfg = { readyFrame: 24, live: false };

function tick(now) {
  requestAnimationFrame(tick);
  const dt = Math.min(0.05, (now - last) / 1000 || 0.016);
  last = now;
  G.dt = dt;
  G.time += dt;

  G.camRig?.update(dt);

  if ((G.state === 'playing' || (SHOT_MODE && !G.freezeSim)) && G.players.length) {
    const sdt = dt * G.speed;
    G.gameTime += sdt;
    stepUnits(sdt);
    tickCombat(sdt);
    tickEconomy(sdt);
    tickProduction(sdt);
    tickConstruction(sdt);
    tickPowers(sdt);
    tickAI(sdt);
    tickFow(sdt);
    G.fx?.update(sdt);
    sweepDead();
    checkVictory(sdt);
    G.hud?.update(sdt);
    G.minimap?.update(sdt);
  }
  updateSky(dt);

  G.composer ? G.composer.render() : G.renderer.render(G.scene, G.camera);
  frameCount++;
  if (SHOT_MODE && frameCount === shotCfg.readyFrame) {
    window.__shotReady = true;
    document.title = 'SHOT_READY';
  }
}

// ---------------------------------------------------------------- shot mode
// Views place the RTS camera at canonical angles. ?shot=<view>&seed=N
// Extra params: &fac=cartel (play as cartel), &t=NN (fast-forward sim
// seconds before ready), &ui=1 (keep HUD visible in the shot).
function startShotMode() {
  G.cfg.faction = new URLSearchParams(location.search).get('fac') || 'coalition';
  $('menu').classList.add('hidden');
  startGame();
  const p = new URLSearchParams(location.search);
  if (!p.has('ui')) {
    ['topbar', 'bottombar', 'feed', 'idleworker', 'prodtabs'].forEach(id => $(id)?.classList.add('hidden'));
  }
  const ff = parseFloat(p.get('t') || '0');
  if (ff > 0) {
    const step = 1 / 30;
    for (let t = 0; t < ff; t += step) {
      G.gameTime += step;
      stepUnits(step); tickCombat(step); tickEconomy(step); tickProduction(step);
      tickConstruction(step); tickPowers(step); tickAI(step); tickFow(step);
      G.fx?.update(step); sweepDead();
    }
  }
  const b0 = LAYOUT.bases[0], b1 = LAYOUT.bases[1];
  const views = {
    overview: () => { G.camRig.zoom = G.camRig.gzoom = 170; G.camRig.jumpTo(0, 40, Math.PI * 0.25); },
    base: () => { G.camRig.zoom = G.camRig.gzoom = 95; G.camRig.jumpTo(b0.x + 14, b0.z - 14, b0.facing + Math.PI); },
    baseclose: () => { G.camRig.zoom = G.camRig.gzoom = 48; G.camRig.jumpTo(b0.x + 8, b0.z - 8, b0.facing + Math.PI * 0.85); },
    enemybase: () => { G.camRig.zoom = G.camRig.gzoom = 95; G.camRig.jumpTo(b1.x - 14, b1.z + 14, b1.facing + Math.PI); },
    village: () => { G.camRig.zoom = G.camRig.gzoom = 70; G.camRig.jumpTo(LAYOUT.village.x, LAYOUT.village.z, 0.6); },
    oilfield: () => { G.camRig.zoom = G.camRig.gzoom = 62; G.camRig.jumpTo(LAYOUT.oilfield.x, LAYOUT.oilfield.z, 2.4); },
    valley: () => { G.camRig.zoom = G.camRig.gzoom = 85; G.camRig.jumpTo(0, 0, Math.PI * 0.22); },
    dock: () => { G.camRig.zoom = G.camRig.gzoom = 55; G.camRig.jumpTo(LAYOUT.docks[0].x, LAYOUT.docks[0].z, 1.9); },
    army: () => { G.camRig.zoom = G.camRig.gzoom = 52; G.camRig.jumpTo(b0.x + 24, b0.z - 24, b0.facing + Math.PI); },
    ui: () => { // gameplay framing with HUD on
      ['topbar', 'bottombar'].forEach(id => $(id)?.classList.remove('hidden'));
      G.camRig.zoom = G.camRig.gzoom = 80;
      G.camRig.jumpTo(b0.x + 20, b0.z - 20, b0.facing + Math.PI);
    },
  };
  (views[SHOT_VIEW] || views.overview)();
  G.freezeSim = !p.has('live');
}

boot();
