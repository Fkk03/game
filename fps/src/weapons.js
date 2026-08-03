// weapons.js — viewmodel weapons: carbine (hitscan), RPG (projectile), frag grenades
import * as THREE from 'three';
import { G, clamp, damp, SHOT_MODE } from './core.js';
import { gunMetal } from './textures.js';

const BASE_FOV = 75, ADS_FOV = 52;

// ---------------------------------------------------------------- viewmodel materials
// Explicit light two-tone gunmetal + polymer. Scene has no env map, so metalness must
// stay low-ish and base colors mid-toned or the viewmodel renders as a black silhouette.
const gm = () => new THREE.MeshStandardMaterial({ map: gunMetal(), roughness: 0.55, metalness: 0.6 });
const blk = () => new THREE.MeshStandardMaterial({ color: 0x1f2022, roughness: 0.7, metalness: 0.3 });
const wood = () => new THREE.MeshStandardMaterial({ color: 0x6b4a2a, roughness: 0.85 });
const olive = () => new THREE.MeshStandardMaterial({ color: 0x4a4f3a, roughness: 0.8, metalness: 0.2 });

const vmSteel = () => new THREE.MeshStandardMaterial({
  // gunMetal() texture is near-black (#2e2f30); a >1 color multiplier lifts it to a
  // readable mid gunmetal while keeping the machining detail.
  map: gunMetal(), color: new THREE.Color(1.85, 1.9, 2.05),
  roughness: 0.62, metalness: 0.3,
});
const vmSteelDk = () => new THREE.MeshStandardMaterial({ color: 0x5a616c, roughness: 0.55, metalness: 0.4 });
const vmPoly = () => new THREE.MeshStandardMaterial({ color: 0x686a56, roughness: 0.85, metalness: 0.04 });
const vmPolyDk = () => new THREE.MeshStandardMaterial({ color: 0x4d5044, roughness: 0.9, metalness: 0.04 });
const vmWood = () => new THREE.MeshStandardMaterial({ color: 0x7d5027, roughness: 0.8 });
const vmGlove = () => new THREE.MeshStandardMaterial({ color: 0x60513a, roughness: 0.95 });
const vmGloveDk = () => new THREE.MeshStandardMaterial({ color: 0x40352a, roughness: 0.95 });
const vmSleeve = () => new THREE.MeshStandardMaterial({ color: 0x827748, roughness: 1.0 });
const vmSkin = () => new THREE.MeshStandardMaterial({ color: 0x9a7048, roughness: 0.9 });

let _magTex = null;
function magTex() {
  if (_magTex) return _magTex;
  const c = document.createElement('canvas');
  c.width = 64; c.height = 64;
  const x = c.getContext('2d');
  x.fillStyle = '#8b9083';
  x.fillRect(0, 0, 64, 64);
  for (let y = 0; y < 64; y += 9) {          // stamped press ribs
    x.fillStyle = 'rgba(255,255,255,0.3)'; x.fillRect(0, y, 64, 2);
    x.fillStyle = 'rgba(0,0,0,0.35)'; x.fillRect(0, y + 2, 64, 3);
  }
  x.globalAlpha = 0.25;                       // wear scratches
  x.strokeStyle = '#2f322c';
  for (let i = 0; i < 10; i++) {
    const sx = (i * 23) % 64, sy = (i * 41) % 64;
    x.beginPath(); x.moveTo(sx, sy); x.lineTo(sx + 18, sy + ((i % 3) - 1) * 9); x.stroke();
  }
  x.globalAlpha = 1;
  _magTex = new THREE.CanvasTexture(c);
  _magTex.colorSpace = THREE.SRGBColorSpace;
  return _magTex;
}
const vmMag = () => new THREE.MeshStandardMaterial({ map: magTex(), roughness: 0.55, metalness: 0.3 });

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
// cylinder between two local-space points (forearms, thumb, etc.)
function vtube(ax, ay, az, bx, by, bz, ra, rb, mat, seg = 10) {
  const a = new THREE.Vector3(ax, ay, az), b = new THREE.Vector3(bx, by, bz);
  const d = b.clone().sub(a), len = d.length();
  const m = new THREE.Mesh(new THREE.CylinderGeometry(rb, ra, len, seg), mat);
  m.position.copy(a).addScaledVector(d, 0.5);
  m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize());
  return m;
}

// ---------------------------------------------------------------- first-person arms
// Rolled-sleeve forearm: bare skin at the wrist, fat rolled cuff, khaki sleeve running
// off the bottom of the screen. wrist→elbow given in weapon-local space.
function addForearm(g, wx, wy, wz, ex, ey, ez) {
  const skin = vmSkin(), sleeve = vmSleeve();
  const lerp = (t) => [wx + (ex - wx) * t, wy + (ey - wy) * t, wz + (ez - wz) * t];
  const [ax, ay, az] = lerp(0.14), [bx, by, bz] = lerp(0.27), [cx, cy, cz] = lerp(0.22);
  g.add(vtube(wx, wy, wz, ax, ay, az, 0.024, 0.027, skin));         // bare wrist peek
  g.add(vtube(ax, ay, az, bx, by, bz, 0.038, 0.04, sleeve));        // rolled cuff
  g.add(vtube(cx, cy, cz, ex, ey, ez, 0.037, 0.034, sleeve));       // sleeve to elbow
}

// Right hand wrapped around a pistol grip at (px,py,pz), grip raked back by `rake`.
function addGripHand(g, px, py, pz, rake) {
  const glove = vmGlove(), dk = vmGloveDk();
  const wrap = new THREE.Group();
  wrap.position.set(px, py, pz);
  wrap.rotation.x = rake;
  wrap.add(vbox(0.03, 0.075, 0.052, glove, 0.03, -0.005, 0.005));   // palm, right side
  wrap.add(vbox(0.055, 0.068, 0.028, glove, 0.004, -0.012, -0.038)); // fingers, front
  for (let i = 0; i < 3; i++) {                                     // finger seams
    wrap.add(vbox(0.056, 0.004, 0.03, dk, 0.004, 0.008 - i * 0.02, -0.039));
  }
  wrap.add(vbox(0.03, 0.022, 0.05, dk, 0.026, 0.038, 0.0));         // knuckle pad
  g.add(wrap);
  // thumb wrapping over the left
  g.add(vtube(px - 0.024, py + 0.045, pz + 0.01, px - 0.01, py + 0.01, pz - 0.03,
    0.011, 0.009, vmGlove()));
}

function buildCarbine() {
  const g = new THREE.Group();
  const steel = vmSteel(), steelDk = vmSteelDk(), poly = vmPoly(), polyDk = vmPolyDk();

  // receiver: light gunmetal upper, darker lower
  g.add(vbox(0.058, 0.052, 0.30, steel, 0, 0.022, 0.02));
  g.add(vbox(0.054, 0.048, 0.24, steelDk, 0, -0.02, 0.05));
  // left-flank detail (the side the player sees): bolt catch, selector, pins
  g.add(vbox(0.005, 0.02, 0.05, polyDk, -0.03, 0.014, 0.0));
  g.add(vbox(0.006, 0.012, 0.032, steel, -0.03, -0.008, 0.1));
  g.add(vbox(0.005, 0.024, 0.016, steelDk, -0.03, -0.01, -0.02));
  // top rail with picatinny notches
  g.add(vbox(0.022, 0.012, 0.36, steelDk, 0, 0.054, -0.04));
  for (let i = 0; i < 8; i++) {
    g.add(vbox(0.026, 0.006, 0.016, steel, 0, 0.059, -0.19 + i * 0.044));
  }
  // handguard: olive polymer with dark rib rings + vent slots
  g.add(vbox(0.056, 0.062, 0.24, poly, 0, 0.0, -0.30));
  for (let i = 0; i < 4; i++) {
    g.add(vbox(0.06, 0.066, 0.011, polyDk, 0, 0.0, -0.205 - i * 0.058));
  }
  g.add(vbox(0.004, 0.012, 0.15, polyDk, -0.029, 0.016, -0.30));
  // barrel + gas block + A2 front sight
  const barrel = vcyl(0.013, 0.013, 0.2, steelDk, 0, 0.012, -0.52, 10);
  barrel.rotation.x = Math.PI / 2;
  g.add(barrel);
  g.add(vbox(0.026, 0.032, 0.028, steelDk, 0, 0.042, -0.55));
  g.add(vbox(0.007, 0.04, 0.007, steel, 0, 0.07, -0.55));           // front post
  const wL = vbox(0.006, 0.042, 0.02, steelDk, -0.014, 0.062, -0.55);
  wL.rotation.z = 0.14; g.add(wL);
  const wR = vbox(0.006, 0.042, 0.02, steelDk, 0.014, 0.062, -0.55);
  wR.rotation.z = -0.14; g.add(wR);
  // birdcage flash hider
  const mz = vcyl(0.016, 0.014, 0.09, steelDk, 0, 0.012, -0.665, 10);
  mz.rotation.x = Math.PI / 2;
  g.add(mz);
  for (const zz of [-0.628, -0.702]) {
    const ring = vcyl(0.018, 0.018, 0.012, steel, 0, 0.012, zz, 10);
    ring.rotation.x = Math.PI / 2;
    g.add(ring);
  }
  // rear sight: block, ears, aperture ring
  g.add(vbox(0.032, 0.014, 0.036, steelDk, 0, 0.062, 0.135));
  g.add(vbox(0.007, 0.026, 0.032, steelDk, -0.014, 0.078, 0.135));
  g.add(vbox(0.007, 0.026, 0.032, steelDk, 0.014, 0.078, 0.135));
  const ap = new THREE.Mesh(new THREE.TorusGeometry(0.011, 0.0035, 8, 14), vmSteel());
  ap.position.set(0, 0.083, 0.135);
  g.add(ap);
  // buffer tube + adjustable stock
  const bt = vcyl(0.019, 0.019, 0.14, polyDk, 0, 0.014, 0.22, 10);
  bt.rotation.x = Math.PI / 2;
  g.add(bt);
  g.add(vbox(0.046, 0.07, 0.13, poly, 0, -0.002, 0.315));
  g.add(vbox(0.05, 0.084, 0.02, polyDk, 0, -0.004, 0.39));
  // grip + trigger guard + trigger
  const grip = vbox(0.036, 0.1, 0.048, poly, 0, -0.082, 0.115);
  grip.rotation.x = 0.35;
  g.add(grip);
  g.add(vbox(0.007, 0.006, 0.06, steelDk, 0, -0.068, 0.055));
  g.add(vbox(0.006, 0.024, 0.007, steel, 0, -0.052, 0.06));
  // curved magazine, ribbed texture, polymer base plate
  const m1 = vbox(0.04, 0.1, 0.062, vmMag(), 0, -0.08, -0.03);
  m1.rotation.x = 0.14;
  g.add(m1);
  const m2 = vbox(0.04, 0.088, 0.058, vmMag(), 0, -0.16, -0.055);
  m2.rotation.x = 0.45;
  g.add(m2);
  const bp = vbox(0.044, 0.016, 0.064, polyDk, 0, -0.2, -0.075);
  bp.rotation.x = 0.45;
  g.add(bp);

  // ---- hands: right on the grip, left cradling the handguard
  addGripHand(g, 0, -0.082, 0.115, 0.35);
  addForearm(g, 0.035, -0.13, 0.16, 0.3, -0.48, 0.55);
  const glove = vmGlove(), gDk = vmGloveDk();
  g.add(vbox(0.05, 0.03, 0.08, glove, -0.008, -0.052, -0.30));      // left palm under
  const lf = vbox(0.022, 0.058, 0.068, glove, -0.036, -0.014, -0.30);
  lf.rotation.z = 0.12;
  g.add(lf);
  g.add(vbox(0.02, 0.016, 0.064, glove, -0.029, 0.022, -0.30));     // fingertips on top edge
  for (const zz of [-0.321, -0.30, -0.279]) {                        // finger seams (proud, so they read)
    const seam = vbox(0.028, 0.062, 0.005, gDk, -0.037, -0.014, zz);
    seam.rotation.z = 0.12;
    g.add(seam);
  }
  g.add(vbox(0.024, 0.024, 0.03, gDk, -0.04, -0.018, -0.345));      // knuckle pad
  g.add(vtube(0.026, -0.04, -0.26, 0.028, 0.005, -0.315, 0.011, 0.009, vmGlove())); // thumb
  addForearm(g, -0.004, -0.08, -0.27, 0.12, -0.44, 0.1);

  g.userData.muzzle = new THREE.Vector3(0, 0.012, -0.72);
  g.userData.baseRot = new THREE.Euler(0.045, -0.075, 0.04);
  g.rotation.copy(g.userData.baseRot);
  return g;
}

function buildRPG() {
  const g = new THREE.Group();
  const steel = vmSteel(), steelDk = vmSteelDk(), poly = vmPoly();
  const oliveLt = new THREE.MeshStandardMaterial({ color: 0x767a5e, roughness: 0.7, metalness: 0.1 });
  const oliveDk = new THREE.MeshStandardMaterial({ color: 0x59604a, roughness: 0.75 });
  // launch tube: light olive, wooden heat shield around the shoulder rest
  const tube = vcyl(0.045, 0.045, 0.85, oliveLt, 0, 0, -0.1, 14);
  tube.rotation.x = Math.PI / 2;
  g.add(tube);
  const shield = vcyl(0.055, 0.055, 0.2, vmWood(), 0, 0, 0.14, 14);
  shield.rotation.x = Math.PI / 2;
  g.add(shield);
  for (const zz of [0.05, 0.23]) {                                   // shield retaining rings
    const ring = vcyl(0.058, 0.058, 0.012, steelDk, 0, 0, zz, 14);
    ring.rotation.x = Math.PI / 2;
    g.add(ring);
  }
  const flare = vcyl(0.078, 0.048, 0.14, oliveLt, 0, 0, 0.38, 14);
  flare.rotation.x = Math.PI / 2;
  g.add(flare);
  const flareLip = vcyl(0.082, 0.082, 0.014, steelDk, 0, 0, 0.445, 14);
  flareLip.rotation.x = Math.PI / 2;
  g.add(flareLip);
  // warhead: fat dark-olive bulb so the RPG silhouette is unmistakable even when the
  // tube is foreshortened nearly axis-on (the usual hip-hold view)
  const wh = vcyl(0.06, 0.115, 0.17, oliveDk, 0, 0, -0.60, 12);
  wh.rotation.x = Math.PI / 2;
  g.add(wh);
  const band = vcyl(0.065, 0.065, 0.02, steel, 0, 0, -0.52, 12);
  band.rotation.x = Math.PI / 2;
  g.add(band);
  const tip = new THREE.Mesh(new THREE.ConeGeometry(0.1, 0.28, 12),
    new THREE.MeshStandardMaterial({ color: 0x59604a, roughness: 0.75 }));
  tip.rotation.x = -Math.PI / 2;
  tip.position.set(0, 0, -0.82);
  g.add(tip);
  const fuze = vcyl(0.014, 0.011, 0.035, steel, 0, 0, -0.945, 8);  // steel fuze cap
  fuze.rotation.x = Math.PI / 2;
  g.add(fuze);
  // grips: wooden front, polymer rear w/ trigger housing
  g.add(vbox(0.034, 0.1, 0.05, vmWood(), 0, -0.1, 0.03));
  const rg = vbox(0.034, 0.095, 0.046, poly, 0, -0.095, 0.21);
  rg.rotation.x = 0.25;
  g.add(rg);
  g.add(vbox(0.03, 0.045, 0.075, steelDk, 0, -0.062, 0.19));        // trigger housing
  g.add(vbox(0.006, 0.022, 0.007, steel, 0, -0.078, 0.16));         // trigger
  // iron sights: front flip post + rear leaf on the left flank, seated into the tube
  g.add(vbox(0.008, 0.06, 0.01, steelDk, -0.018, 0.062, -0.33));
  g.add(vbox(0.006, 0.014, 0.006, steel, -0.018, 0.098, -0.33));
  g.add(vbox(0.01, 0.09, 0.014, steelDk, -0.018, 0.055, 0.1));
  g.add(vbox(0.024, 0.016, 0.006, steel, -0.018, 0.106, 0.1));

  // hands: right on rear grip, left on front grip
  addGripHand(g, 0, -0.095, 0.21, 0.25);
  addForearm(g, 0.035, -0.145, 0.26, 0.3, -0.5, 0.6);
  addGripHand(g, 0, -0.1, 0.03, 0.08);
  addForearm(g, 0.02, -0.155, 0.07, 0.08, -0.55, 0.35);

  g.userData.muzzle = new THREE.Vector3(0, 0, -0.98);
  g.userData.baseRot = new THREE.Euler(0.06, -0.24, 0.03);
  g.rotation.copy(g.userData.baseRot);
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
    // (kept modest — with the lighter viewmodel materials, 8 blows the steel to white)
    const fill = new THREE.PointLight(0xfff2dd, 4.5, 4, 1.2);
    fill.position.set(0.3, 0.4, 0.3);
    G.camera.add(fill);
    this.models = { carbine: buildCarbine(), rpg: buildRPG() };
    for (const k in this.models) {
      this.models[k].visible = false;
      this.models[k].traverse(o => { o.frustumCulled = false; if (o.isMesh) o.castShadow = false; });
      this.rig.add(this.models[k]);
    }
    this.current = 'carbine';
    // screenshot-harness affordance: &vm=rpg shows the RPG viewmodel in shot mode
    if (SHOT_MODE && new URLSearchParams(location.search).get('vm') === 'rpg') this.current = 'rpg';
    this.models[this.current].visible = true;
    this.ammo = {
      carbine: { mag: 30, reserve: 180 },
      rpg: { mag: 1, reserve: 6 },
    };
    this.grenades = 4;
    this.cooldown = 0;
    this.reloading = 0;
    this.ads = false;
    this.adsBlend = 0;                     // 0 hip (baked cant) → 1 aimed (straight)
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
    this.adsPos = new THREE.Vector3(0, -0.083, -0.30);   // rear aperture on screen center
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

    // hip pose keeps a baked cant; ADS straightens the model so the irons line up
    this.adsBlend = damp(this.adsBlend, this.ads ? 1 : 0, 12, dt);
    const mdl = this.models[this.current];
    if (mdl.userData.baseRot) {
      const br = mdl.userData.baseRot, k = 1 - this.adsBlend;
      mdl.rotation.set(br.x * k, br.y * k, br.z * k);
    }

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
