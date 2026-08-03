// sky.js — sky dome, sun, clouds, fog, global lighting rig
import * as THREE from 'three';
import { G, WORLD_SIZE, makeRng } from './core.js';

export const SUN_DIR = new THREE.Vector3(-0.55, 0.62, -0.35).normalize();

export function buildSky() {
  const scene = G.scene;

  // ------- gradient sky dome (shader) -------
  const skyGeo = new THREE.SphereGeometry(WORLD_SIZE * 1.45, 32, 18);
  const skyMat = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: {
      topColor: { value: new THREE.Color(0x3f6fb4) },
      midColor: { value: new THREE.Color(0x9cb8d8) },
      horizonColor: { value: new THREE.Color(0xe8d9b0) },
      sunDir: { value: SUN_DIR.clone() },
      sunColor: { value: new THREE.Color(0xfff2cc) },
    },
    vertexShader: /* glsl */`
      varying vec3 vDir;
      void main(){
        vDir = normalize(position);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0);
      }`,
    fragmentShader: /* glsl */`
      varying vec3 vDir;
      uniform vec3 topColor, midColor, horizonColor, sunDir, sunColor;
      void main(){
        float h = clamp(vDir.y, 0.0, 1.0);
        vec3 col = mix(horizonColor, midColor, smoothstep(0.0, 0.18, h));
        col = mix(col, topColor, smoothstep(0.15, 0.65, h));
        // sun disc + glare
        float d = dot(normalize(vDir), normalize(sunDir));
        col += sunColor * pow(max(d, 0.0), 550.0) * 3.0;   // disc
        col += sunColor * pow(max(d, 0.0), 18.0) * 0.28;   // halo
        col += sunColor * pow(max(d, 0.0), 3.5) * 0.10;    // broad haze
        // below horizon: dusty ground haze
        col = mix(col, horizonColor * 0.92, smoothstep(0.0, -0.12, vDir.y));
        gl_FragColor = vec4(col, 1.0);
      }`,
  });
  const sky = new THREE.Mesh(skyGeo, skyMat);
  sky.frustumCulled = false;
  scene.add(sky);

  // ------- fog: warm dusty haze -------
  scene.fog = new THREE.FogExp2(0xd6c39a, 0.0028);

  // ------- lighting rig -------
  const sun = new THREE.DirectionalLight(0xfff0d0, 3.2);
  sun.position.copy(SUN_DIR).multiplyScalar(300);
  sun.castShadow = true;
  sun.shadow.mapSize.set(4096, 4096);
  sun.shadow.camera.near = 50;
  sun.shadow.camera.far = 700;
  const S = 190;
  sun.shadow.camera.left = -S; sun.shadow.camera.right = S;
  sun.shadow.camera.top = S; sun.shadow.camera.bottom = -S;
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.6;
  sun.shadow.camera.updateProjectionMatrix();
  scene.add(sun);
  scene.add(sun.target);
  G.sun = sun;

  const hemi = new THREE.HemisphereLight(0xbdd0e8, 0xb09468, 0.85);
  scene.add(hemi);

  const amb = new THREE.AmbientLight(0x887760, 0.35);
  scene.add(amb);

  // ------- billboard clouds -------
  const rng = makeRng(555);
  const cloudTex = makeCloudTexture();
  const cloudMat = new THREE.SpriteMaterial({
    map: cloudTex, transparent: true, opacity: 0.55,
    depthWrite: false, fog: false,
  });
  for (let i = 0; i < 14; i++) {
    const s = new THREE.Sprite(cloudMat.clone());
    const a = rng() * Math.PI * 2;
    const r = 260 + rng() * 380;
    s.position.set(Math.cos(a) * r, 120 + rng() * 110, Math.sin(a) * r);
    const w = 120 + rng() * 200;
    s.scale.set(w, w * (0.28 + rng() * 0.16), 1);
    s.material.opacity = 0.30 + rng() * 0.35;
    s.material.rotation = (rng() - 0.5) * 0.2;
    scene.add(s);
  }
}

function makeCloudTexture() {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 128;
  const x = c.getContext('2d');
  const rng = makeRng(777);
  for (let i = 0; i < 46; i++) {
    const px = 30 + rng() * 196, py = 40 + rng() * 56, r = 12 + rng() * 30;
    const g = x.createRadialGradient(px, py, 0, px, py, r);
    g.addColorStop(0, 'rgba(255,252,246,0.20)');
    g.addColorStop(0.7, 'rgba(250,244,234,0.10)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    x.fillStyle = g;
    x.beginPath(); x.arc(px, py, r, 0, 7); x.fill();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// keep the shadow camera centred on the active camera so shadows stay crisp
const _camPos = new THREE.Vector3();
export function updateSky(dt) {
  if (!G.camera || !G.sun) return;
  G.camera.getWorldPosition(_camPos);
  G.sun.target.position.set(_camPos.x, 0, _camPos.z);
  G.sun.position.copy(SUN_DIR).multiplyScalar(300).add(G.sun.target.position);
}
