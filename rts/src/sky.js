// sky.js — sky dome, sun, clouds, fog, global lighting rig
import * as THREE from 'three';
import { G, WORLD_SIZE, makeRng } from './core.js';

// Lower, warmer sun — late-afternoon desert light with long readable shadows
export const SUN_DIR = new THREE.Vector3(-0.62, 0.44, -0.38).normalize();

export function buildSky() {
  const scene = G.scene;

  // ------- gradient sky dome (shader) -------
  const skyGeo = new THREE.SphereGeometry(WORLD_SIZE * 1.45, 32, 18);
  const skyMat = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: {
      topColor: { value: new THREE.Color(0x2f63b4) },
      midColor: { value: new THREE.Color(0x84a8d2) },
      horizonColor: { value: new THREE.Color(0xeac585) },
      sunDir: { value: SUN_DIR.clone() },
      sunColor: { value: new THREE.Color(0xffdf9e) },
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
        vec3 col = mix(horizonColor, midColor, smoothstep(0.0, 0.22, h));
        col = mix(col, topColor, smoothstep(0.16, 0.60, h));
        // sun disc + glare
        float d = dot(normalize(vDir), normalize(sunDir));
        col += sunColor * pow(max(d, 0.0), 550.0) * 3.0;   // disc
        col += sunColor * pow(max(d, 0.0), 16.0) * 0.30;   // halo
        col += sunColor * pow(max(d, 0.0), 3.0) * 0.10;    // broad warm haze
        // dusty amber glow hugging the horizon all around
        col += vec3(0.22, 0.145, 0.045) * pow(1.0 - h, 6.5);
        // below horizon: dusty ground haze
        col = mix(col, horizonColor * 0.94, smoothstep(0.0, -0.12, vDir.y));
        gl_FragColor = vec4(col, 1.0);
      }`,
  });
  const sky = new THREE.Mesh(skyGeo, skyMat);
  sky.frustumCulled = false;
  scene.add(sky);

  // ------- fog: warm golden haze, thinner so distance glows instead of greying out -------
  scene.fog = new THREE.FogExp2(0xdcbe8e, 0.0022);

  // ------- lighting rig -------
  const sun = new THREE.DirectionalLight(0xffe2b0, 3.7);
  sun.position.copy(SUN_DIR).multiplyScalar(300);
  sun.castShadow = true;
  sun.shadow.mapSize.set(4096, 4096);
  sun.shadow.camera.near = 50;
  sun.shadow.camera.far = 700;
  const S = 210;
  sun.shadow.camera.left = -S; sun.shadow.camera.right = S;
  sun.shadow.camera.top = S; sun.shadow.camera.bottom = -S;
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.6;
  sun.shadow.camera.updateProjectionMatrix();
  scene.add(sun);
  scene.add(sun.target);
  G.sun = sun;

  // cooler, dimmer fill — shadow sides fall toward dusty blue instead of grey
  const hemi = new THREE.HemisphereLight(0x7fa3d6, 0xa07c4e, 0.62);
  scene.add(hemi);

  const amb = new THREE.AmbientLight(0x8a91a8, 0.16);
  scene.add(amb);

  // ------- billboard clouds -------
  const rng = makeRng(555);
  const cloudTex = makeCloudTexture();
  const cloudMat = new THREE.SpriteMaterial({
    map: cloudTex, transparent: true, opacity: 0.55,
    depthWrite: false, fog: false,
  });
  for (let i = 0; i < 9; i++) {
    const s = new THREE.Sprite(cloudMat.clone());
    const a = rng() * Math.PI * 2;
    const r = 280 + rng() * 360;
    s.position.set(Math.cos(a) * r, 95 + rng() * 105, Math.sin(a) * r);
    const w = 150 + rng() * 220;
    s.scale.set(w, w * (0.14 + rng() * 0.10), 1);
    s.material.opacity = 0.22 + rng() * 0.22;
    s.material.rotation = (rng() - 0.5) * 0.14;
    scene.add(s);
  }
}

function makeCloudTexture() {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 128;
  const x = c.getContext('2d');
  const rng = makeRng(777);
  // stretched horizontal wisps rather than puffy blobs
  for (let i = 0; i < 34; i++) {
    const px = 30 + rng() * 196, py = 44 + rng() * 44, r = 10 + rng() * 24;
    const sx = 2.2 + rng() * 1.8;                 // horizontal stretch
    x.save();
    x.translate(px, py); x.scale(sx, 0.55 + rng() * 0.25);
    const g = x.createRadialGradient(0, 0, 0, 0, 0, r);
    g.addColorStop(0, 'rgba(255,250,240,0.16)');
    g.addColorStop(0.6, 'rgba(250,242,228,0.08)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    x.fillStyle = g;
    x.beginPath(); x.arc(0, 0, r, 0, 7); x.fill();
    x.restore();
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
