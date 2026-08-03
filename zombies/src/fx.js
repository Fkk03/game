// VFX: shader-driven particle pools (blood, sparks, embers, dust, dirt), decals
// (bullet holes, blood splats), tracers, shell casings, gibs, barrel flames,
// explosions, and the lightning director.
import * as THREE from 'three';
import { bloodSplatTexture, bulletHoleTexture } from './textures.js';

// ---------- generic particle pool (Points + per-particle life/size/alpha) ----------
class Pool {
  constructor(scene, max, { color = 0xffffff, size = 0.08, additive = false, gravity = -9, drag = 0.98, soft = true } = {}) {
    this.max = max; this.gravity = gravity; this.drag = drag;
    this.pos = new Float32Array(max * 3);
    this.vel = new Float32Array(max * 3);
    this.life = new Float32Array(max);       // remaining
    this.life0 = new Float32Array(max);      // initial
    this.sizes = new Float32Array(max);
    this.alive = 0; this.head = 0;
    const geo = this.geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    this.aLife = new Float32Array(max);
    geo.setAttribute('aLife', new THREE.BufferAttribute(this.aLife, 1));
    geo.setAttribute('aSize', new THREE.BufferAttribute(this.sizes, 1));
    const mat = new THREE.ShaderMaterial({
      uniforms: { uColor: { value: new THREE.Color(color) } },
      transparent: true,
      depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
      vertexShader: /* glsl */`
        attribute float aLife; attribute float aSize;
        varying float vLife;
        void main() {
          vLife = aLife;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = aSize * (240.0 / -mv.z);
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */`
        uniform vec3 uColor; varying float vLife;
        void main() {
          vec2 c = gl_PointCoord - 0.5;
          float d = length(c);
          if (d > 0.5) discard;
          float a = smoothstep(0.5, ${soft ? '0.05' : '0.42'}, d) * clamp(vLife, 0.0, 1.0);
          gl_FragColor = vec4(uColor, a);
        }`,
    });
    this.points = new THREE.Points(geo, mat);
    this.points.frustumCulled = false;
    scene.add(this.points);
    this.life.fill(0);
    geo.setDrawRange(0, max);
  }
  spawn(x, y, z, vx, vy, vz, life, size) {
    const i = this.head;
    this.head = (this.head + 1) % this.max;
    this.pos[i * 3] = x; this.pos[i * 3 + 1] = y; this.pos[i * 3 + 2] = z;
    this.vel[i * 3] = vx; this.vel[i * 3 + 1] = vy; this.vel[i * 3 + 2] = vz;
    this.life[i] = life; this.life0[i] = life; this.sizes[i] = size;
  }
  update(dt) {
    const drag = Math.pow(this.drag, dt * 60);
    for (let i = 0; i < this.max; i++) {
      if (this.life[i] <= 0) { this.aLife[i] = 0; continue; }
      this.life[i] -= dt;
      this.vel[i * 3 + 1] += this.gravity * dt;
      this.vel[i * 3] *= drag; this.vel[i * 3 + 1] *= drag; this.vel[i * 3 + 2] *= drag;
      this.pos[i * 3] += this.vel[i * 3] * dt;
      this.pos[i * 3 + 1] += this.vel[i * 3 + 1] * dt;
      this.pos[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
      if (this.pos[i * 3 + 1] < 0.01 && this.gravity < 0) { this.pos[i * 3 + 1] = 0.01; this.vel[i * 3 + 1] *= -0.3; }
      this.aLife[i] = this.life[i] / this.life0[i];
    }
    this.geo.attributes.position.needsUpdate = true;
    this.geo.attributes.aLife.needsUpdate = true;
    this.geo.attributes.aSize.needsUpdate = true;
  }
}

// ---------- decal pool (planes cycled) ----------
class DecalPool {
  constructor(scene, max, texture, baseSize) {
    this.meshes = [];
    this.head = 0; this.baseSize = baseSize;
    const geo = new THREE.PlaneGeometry(1, 1);
    for (let i = 0; i < max; i++) {
      const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({
        map: texture, transparent: true, depthWrite: false, opacity: 0,
        polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
      }));
      m.visible = false; m.userData.noBlock = true;
      scene.add(m);
      this.meshes.push(m);
    }
  }
  place(pos, normal, size, opacity = 1, randRot = true) {
    const m = this.meshes[this.head];
    this.head = (this.head + 1) % this.meshes.length;
    m.visible = true;
    m.material.opacity = opacity;
    m.position.copy(pos).addScaledVector(normal, 0.015 + Math.random() * 0.01);
    m.scale.setScalar(size);
    m.lookAt(pos.clone().add(normal));
    if (randRot) m.rotateZ(Math.random() * Math.PI * 2);
    m.userData.fade = 40;
    return m;
  }
  update(dt) {
    for (const m of this.meshes) {
      if (!m.visible) continue;
      m.userData.fade -= dt;
      if (m.userData.fade < 6) m.material.opacity = Math.max(0, m.userData.fade / 6);
      if (m.userData.fade <= 0) m.visible = false;
    }
  }
}

const UP = new THREE.Vector3(0, 1, 0);

export function initFx(G) {
  const scene = G.scene;
  const F = G.fx = {};

  F.blood = new Pool(scene, 700, { color: 0x6a0d08, size: 0.09, gravity: -11, drag: 0.96 });
  F.bloodMist = new Pool(scene, 300, { color: 0x4a0a06, size: 0.3, gravity: -0.6, drag: 0.9 });
  F.spark = new Pool(scene, 300, { color: 0xffc060, size: 0.05, additive: true, gravity: -7, drag: 0.94 });
  F.ember = new Pool(scene, 260, { color: 0xff7a20, size: 0.05, additive: true, gravity: 0.9, drag: 0.985 });
  F.dust = new Pool(scene, 260, { color: 0x8a7a60, size: 0.5, gravity: -0.4, drag: 0.92 });
  F.dirt = new Pool(scene, 300, { color: 0x35291a, size: 0.12, gravity: -10, drag: 0.95 });
  F.smoke = new Pool(scene, 200, { color: 0x2c2a28, size: 1.1, gravity: 0.65, drag: 0.94 });
  F.flash = new Pool(scene, 60, { color: 0xffd090, size: 0.9, additive: true, gravity: 0, drag: 0.8 });

  F.holes = new DecalPool(scene, 90, bulletHoleTexture(), 0.1);
  F.splats = new DecalPool(scene, 64, bloodSplatTexture({ seed: 91 }), 1);

  // ---------- tracers ----------
  const tracerGeo = new THREE.CylinderGeometry(0.008, 0.008, 1, 5, 1, true);
  tracerGeo.rotateX(Math.PI / 2); // align along z
  F.tracers = [];
  for (let i = 0; i < 40; i++) {
    const m = new THREE.Mesh(tracerGeo, new THREE.MeshBasicMaterial({
      color: 0xffc078, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false,
    }));
    m.visible = false; m.userData.noBlock = true;
    scene.add(m);
    F.tracers.push({ mesh: m, t: 0 });
  }
  let tracerHead = 0;

  // ---------- casings ----------
  const caseGeo = new THREE.CylinderGeometry(0.008, 0.008, 0.03, 6);
  const caseMat = new THREE.MeshStandardMaterial({ color: 0xc8a24a, roughness: 0.3, metalness: 0.9 });
  F.casings = new THREE.InstancedMesh(caseGeo, caseMat, 120);
  F.casings.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  F.casings.frustumCulled = false;
  scene.add(F.casings);
  const caseData = [];
  for (let i = 0; i < 120; i++) caseData.push({ p: new THREE.Vector3(0, -5, 0), v: new THREE.Vector3(), r: new THREE.Euler(), rv: new THREE.Vector3(), life: 0 });
  let caseHead = 0;

  // ---------- gibs ----------
  const gibGeo = new THREE.BoxGeometry(0.09, 0.07, 0.08);
  const gibMat = new THREE.MeshStandardMaterial({ color: 0x581410, roughness: 0.7 });
  F.gibs = new THREE.InstancedMesh(gibGeo, gibMat, 90);
  F.gibs.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  F.gibs.frustumCulled = false;
  scene.add(F.gibs);
  const gibData = [];
  for (let i = 0; i < 90; i++) gibData.push({ p: new THREE.Vector3(0, -5, 0), v: new THREE.Vector3(), life: 0, s: 1 });
  let gibHead = 0;

  // ---------- barrel flames (shader) ----------
  const flameMat = new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 } },
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    vertexShader: /* glsl */`
      varying vec2 vUv;
      void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: /* glsl */`
      uniform float uTime; varying vec2 vUv;
      float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7))) * 43758.5453); }
      float noise(vec2 p){ vec2 i=floor(p),f=fract(p); f=f*f*(3.-2.*f);
        return mix(mix(hash(i),hash(i+vec2(1,0)),f.x),mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),f.x),f.y); }
      void main() {
        vec2 uv = vUv;
        float n = noise(vec2(uv.x*5.0, uv.y*4.0 - uTime*3.2)) * 0.6
                + noise(vec2(uv.x*11.0, uv.y*9.0 - uTime*5.0)) * 0.4;
        float body = (1.0 - uv.y) * (1.0 - abs(uv.x - 0.5) * 2.6);
        float f = clamp(body * 1.6 - n * (0.35 + uv.y), 0.0, 1.0);
        vec3 col = mix(vec3(1.0, 0.25, 0.02), vec3(1.0, 0.85, 0.3), f);
        gl_FragColor = vec4(col * f * 1.8, f);
      }`,
  });
  F.flameMat = flameMat;
  F.fireLights = [];
  for (const fire of G.world.fires) {
    const g = new THREE.Group();
    g.position.copy(fire.pos);
    for (let i = 0; i < 3; i++) {
      const pl = new THREE.Mesh(new THREE.PlaneGeometry(0.7, 0.95), flameMat);
      pl.rotation.y = (i / 3) * Math.PI;
      pl.position.y = 0.32;
      g.add(pl);
    }
    scene.add(g);
    const l = new THREE.PointLight(0xff7a26, 15, 15, 2);
    l.position.copy(fire.pos).add(new THREE.Vector3(0, 0.5, 0));
    scene.add(l);
    F.fireLights.push({ light: l, base: 9, seed: Math.random() * 10, pos: fire.pos });
  }

  // ---------- explosion light ----------
  F.boomLight = new THREE.PointLight(0xffa040, 0, 18, 2);
  scene.add(F.boomLight);
  F.boomT = 0;

  // ---------- lightning ----------
  F.lightning = { t: 8 + Math.random() * 14, flash: 0, seq: null };

  // ================= event wiring =================
  const E = G.events;
  E.on('muzzle', ({ pos, type }) => {
    for (let i = 0; i < 4; i++)
      F.flash.spawn(pos.x, pos.y, pos.z, rnd(1.4), rnd(1.4), rnd(1.4), 0.05, 0.5 + Math.random() * 0.5);
    if (Math.random() < 0.4)
      F.smoke.spawn(pos.x, pos.y + 0.03, pos.z, rnd(0.2), 0.4, rnd(0.2), 1.1, 0.35);
    if (type !== 'ray') {
      // eject casing
      const c = caseData[caseHead]; caseHead = (caseHead + 1) % caseData.length;
      c.p.copy(pos);
      const P = G.player;
      c.v.set(-Math.cos(P.yaw) * 1.6 + rnd(0.6), 2.2 + Math.random(), Math.sin(P.yaw) * 1.6 + rnd(0.6));
      c.rv.set(rnd(12), rnd(12), rnd(12));
      c.life = 2.5;
    }
  });
  E.on('tracer', ({ from, to, color }) => {
    if (!to) return;
    const tr = F.tracers[tracerHead]; tracerHead = (tracerHead + 1) % F.tracers.length;
    const m = tr.mesh;
    m.visible = true;
    m.material.color.setHex(color ?? 0xffc078);
    const d = from.distanceTo(to);
    m.position.copy(from).lerp(to, 0.5);
    m.scale.set(1, 1, d);
    m.lookAt(to);
    m.material.opacity = 0.55;
    tr.t = 0.06;
  });
  E.on('wallHit', ({ pos, normal, object }) => {
    const n = normal.clone();
    if (object?.matrixWorld) n.transformDirection(object.matrixWorld);
    F.holes.place(pos, n, 0.09 + Math.random() * 0.05, 0.95);
    for (let i = 0; i < 5; i++)
      F.spark.spawn(pos.x, pos.y, pos.z, n.x * 2 + rnd(1.6), n.y * 2 + Math.random() * 2, n.z * 2 + rnd(1.6), 0.3 + Math.random() * 0.2, 0.045);
    for (let i = 0; i < 3; i++)
      F.dust.spawn(pos.x, pos.y, pos.z, n.x + rnd(0.5), 0.4, n.z + rnd(0.5), 0.7, 0.3);
  });
  E.on('bloodHit', ({ pos, dir, part }) => {
    const n = part === 'head' ? 16 : 10;
    for (let i = 0; i < n; i++)
      F.blood.spawn(pos.x, pos.y, pos.z,
        dir.x * 2.4 + rnd(2.2), 1.2 + Math.random() * 2.2, dir.z * 2.4 + rnd(2.2),
        0.5 + Math.random() * 0.4, 0.06 + Math.random() * 0.07);
    for (let i = 0; i < 3; i++)
      F.bloodMist.spawn(pos.x, pos.y, pos.z, dir.x + rnd(0.8), 0.3, dir.z + rnd(0.8), 0.5, 0.25 + Math.random() * 0.25);
    // occasional splat behind on the ground
    if (Math.random() < 0.4)
      F.splats.place(new THREE.Vector3(pos.x + dir.x + rnd(0.6), 0.02, pos.z + dir.z + rnd(0.6)), UP, 0.5 + Math.random() * 0.5, 0.85);
  });
  E.on('headshot', ({ pos }) => {
    for (let i = 0; i < 6; i++) spawnGib(pos, 2.4);
    for (let i = 0; i < 14; i++)
      F.blood.spawn(pos.x, pos.y, pos.z, rnd(3), 1 + Math.random() * 3.4, rnd(3), 0.6, 0.08);
  });
  E.on('gib', ({ pos }) => {
    for (let i = 0; i < 10; i++) spawnGib(pos, 4);
    for (let i = 0; i < 12; i++)
      F.blood.spawn(pos.x, pos.y, pos.z, rnd(4), 1 + Math.random() * 4, rnd(4), 0.7, 0.09);
  });
  E.on('bloodPool', ({ pos }) => {
    F.splats.place(pos.clone().setY(0.02), UP, 1.3 + Math.random() * 0.7, 0.95);
  });
  E.on('explosion', ({ pos, radius }) => {
    F.boomLight.position.copy(pos).add(new THREE.Vector3(0, 0.6, 0));
    F.boomT = 0.28;
    for (let i = 0; i < 26; i++)
      F.spark.spawn(pos.x, pos.y + 0.2, pos.z, rnd(9), Math.random() * 8, rnd(9), 0.35 + Math.random() * 0.3, 0.06);
    for (let i = 0; i < 14; i++)
      F.smoke.spawn(pos.x + rnd(0.8), pos.y + 0.2 + Math.random() * 0.6, pos.z + rnd(0.8), rnd(1.2), 1.4 + Math.random() * 1.6, rnd(1.2), 1.6 + Math.random(), 0.9 + Math.random() * 0.9);
    for (let i = 0; i < 8; i++)
      F.flash.spawn(pos.x, pos.y + 0.4, pos.z, rnd(3), Math.random() * 3, rnd(3), 0.09, 1.4);
    for (let i = 0; i < 16; i++)
      F.dirt.spawn(pos.x, pos.y + 0.1, pos.z, rnd(6), 2 + Math.random() * 5, rnd(6), 0.8, 0.12);
    F.splats.place(pos.clone().setY(0.02), UP, radius * 0.5, 0.6);
  });
  E.on('plankTorn', ({ win, plank }) => {
    // plank flies off outward and drops
    plank.mesh.userData.fly = {
      t: 0,
      v: new THREE.Vector3(win.dir.x * (2.5 + Math.random() * 2), 2 + Math.random() * 1.5, win.dir.z * (2.5 + Math.random() * 2)),
      rv: new THREE.Vector3(rnd(6), rnd(6), rnd(6)),
    };
    F.flying.push(plank);
    for (let i = 0; i < 4; i++)
      F.dust.spawn(win.pos.x, 1.4, win.pos.z, win.dir.x + rnd(0.6), 0.5, win.dir.z + rnd(0.6), 0.7, 0.3);
  });
  E.on('graveRise', (pos) => {
    for (let i = 0; i < 22; i++)
      F.dirt.spawn(pos.x + rnd(0.5), 0.1, pos.z + rnd(0.5), rnd(1.6), 1.5 + Math.random() * 2.4, rnd(1.6), 0.9, 0.11);
    for (let i = 0; i < 6; i++)
      F.dust.spawn(pos.x, 0.2, pos.z, rnd(0.8), 0.7, rnd(0.8), 1.2, 0.5);
  });
  E.on('doorOpened', (d) => {
    for (let i = 0; i < 14; i++)
      F.dust.spawn(d.pos.x + rnd(0.8), 0.4 + Math.random(), d.pos.z + rnd(0.8), rnd(1), 0.6, rnd(1), 1.3, 0.55);
  });
  F.flying = [];

  function spawnGib(pos, power) {
    const g = gibData[gibHead]; gibHead = (gibHead + 1) % gibData.length;
    g.p.set(pos.x, pos.y, pos.z);
    g.v.set(rnd(power), Math.random() * power, rnd(power));
    g.life = 1.6 + Math.random();
    g.s = 0.7 + Math.random() * 0.8;
  }
  F.spawnGibs = (pos, n, power) => { for (let i = 0; i < n; i++) spawnGib(pos, power); };

  const rnd = (s) => (Math.random() - 0.5) * 2 * s;
  F._caseData = caseData; F._gibData = gibData;
  F._m4 = new THREE.Matrix4(); F._q = new THREE.Quaternion(); F._e = new THREE.Euler(); F._s = new THREE.Vector3();
}

export function updateFx(G, dt, t) {
  const F = G.fx;
  F.blood.update(dt); F.bloodMist.update(dt); F.spark.update(dt); F.ember.update(dt);
  F.dust.update(dt); F.dirt.update(dt); F.smoke.update(dt); F.flash.update(dt);
  F.holes.update(dt); F.splats.update(dt);
  F.flameMat.uniforms.uTime.value = t;

  // tracers
  for (const tr of F.tracers) {
    if (!tr.mesh.visible) continue;
    tr.t -= dt;
    tr.mesh.material.opacity = Math.max(0, tr.t / 0.06) * 0.55;
    if (tr.t <= 0) tr.mesh.visible = false;
  }

  // casings
  for (let i = 0; i < F._caseData.length; i++) {
    const c = F._caseData[i];
    if (c.life > 0) {
      c.life -= dt;
      c.v.y -= 12 * dt;
      c.p.addScaledVector(c.v, dt);
      if (c.p.y < 0.015) { c.p.y = 0.015; c.v.y *= -0.35; c.v.x *= 0.6; c.v.z *= 0.6; c.rv.multiplyScalar(0.5); }
      c.r.x += c.rv.x * dt; c.r.y += c.rv.y * dt; c.r.z += c.rv.z * dt;
    }
    F._q.setFromEuler(F._e.set(c.r.x, c.r.y, c.r.z));
    F._s.setScalar(c.life > 0 ? 1 : 0);
    F._m4.compose(c.p, F._q, F._s);
    F.casings.setMatrixAt(i, F._m4);
  }
  F.casings.instanceMatrix.needsUpdate = true;

  // gibs
  for (let i = 0; i < F._gibData.length; i++) {
    const g = F._gibData[i];
    if (g.life > 0) {
      g.life -= dt;
      g.v.y -= 13 * dt;
      g.p.addScaledVector(g.v, dt);
      if (g.p.y < 0.04) { g.p.y = 0.04; g.v.y *= -0.3; g.v.x *= 0.6; g.v.z *= 0.6; }
    }
    F._q.setFromEuler(F._e.set(g.p.x * 3, g.p.y * 5, g.p.z * 3));
    F._s.setScalar(g.life > 0 ? g.s * Math.min(1, g.life) : 0);
    F._m4.compose(g.p, F._q, F._s);
    F.gibs.setMatrixAt(i, F._m4);
  }
  F.gibs.instanceMatrix.needsUpdate = true;

  // flying planks
  for (let i = F.flying.length - 1; i >= 0; i--) {
    const plank = F.flying[i];
    const f = plank.mesh.userData.fly;
    if (!f) { F.flying.splice(i, 1); continue; }
    f.t += dt;
    f.v.y -= 10 * dt;
    plank.mesh.position.addScaledVector(f.v, dt);
    plank.mesh.rotation.x += f.rv.x * dt; plank.mesh.rotation.y += f.rv.y * dt; plank.mesh.rotation.z += f.rv.z * dt;
    if (f.t > 1.6) {
      plank.mesh.visible = false;
      delete plank.mesh.userData.fly;
      F.flying.splice(i, 1);
    }
  }

  // fires: flicker + embers
  for (const f of F.fireLights) {
    const n = Math.sin(t * 11 + f.seed) * Math.sin(t * 23.7 + f.seed * 2) * Math.sin(t * 5.1);
    f.light.intensity = 15 * (0.75 + 0.4 * Math.abs(n));
    if (Math.random() < dt * 14)
      F.ember.spawn(f.pos.x + rnd2(0.16), f.pos.y + 0.2, f.pos.z + rnd2(0.16), rnd2(0.3), 1 + Math.random() * 1.2, rnd2(0.3), 1.2 + Math.random(), 0.05);
    if (Math.random() < dt * 2)
      F.smoke.spawn(f.pos.x, f.pos.y + 0.5, f.pos.z, rnd2(0.2), 0.8, rnd2(0.2), 2.4, 0.6);
  }

  // explosion light decay
  if (F.boomT > 0) {
    F.boomT -= dt;
    F.boomLight.intensity = Math.max(0, F.boomT / 0.28) * 60;
  }

  // lightning director
  const L = F.lightning;
  if (L.seq) {
    L.seq.t += dt;
    const phase = L.seq.t;
    let v = 0;
    if (phase < 0.08) v = phase / 0.08;
    else if (phase < 0.14) v = 1 - (phase - 0.08) / 0.06;
    else if (phase < 0.2) v = 0.2;
    else if (phase < 0.26) v = 0.9 - (phase - 0.2) * 4;
    else v = Math.max(0, 0.66 - phase);
    L.flash = Math.max(0, v);
    if (phase > 0.7) { L.seq = null; L.flash = 0; }
  } else {
    L.t -= dt;
    if (L.t <= 0) {
      L.t = 16 + Math.random() * 26;
      L.seq = { t: 0 };
      G.events.emit('lightning');
    }
  }
  G.skyUniforms.uLightning.value = L.flash * 0.9;
  G.moon.intensity = (G.moonBase ?? 2.4) + L.flash * 5.5;

  function rnd2(s) { return (Math.random() - 0.5) * 2 * s; }
}
