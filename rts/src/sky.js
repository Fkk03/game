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
      topColor: { value: new THREE.Color(0x3a6cb8) },
      midColor: { value: new THREE.Color(0x8fb2d8) },
      horizonColor: { value: new THREE.Color(0xf6c97e) },
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
        vec3 col = mix(horizonColor, midColor, smoothstep(0.0, 0.30, h));
        col = mix(col, topColor, smoothstep(0.20, 0.62, h));
        // sun disc + glare
        float d = dot(normalize(vDir), normalize(sunDir));
        col += sunColor * pow(max(d, 0.0), 550.0) * 3.0;   // disc
        col += sunColor * pow(max(d, 0.0), 16.0) * 0.32;   // halo
        col += sunColor * pow(max(d, 0.0), 3.0) * 0.12;    // broad warm haze
        // dusty gold glow hugging the horizon all around — the band the RTS
        // camera actually sees near map edges, so make it sing
        col += vec3(0.34, 0.215, 0.070) * pow(1.0 - h, 4.0);
        col += vec3(0.15, 0.085, 0.020) * pow(1.0 - h, 12.0);
        // below horizon: dusty ground haze
        col = mix(col, horizonColor * 0.92, smoothstep(0.0, -0.12, vDir.y));
        gl_FragColor = vec4(col, 1.0);
      }`,
  });
  const sky = new THREE.Mesh(skyGeo, skyMat);
  sky.frustumCulled = false;
  scene.add(sky);

  // ------- fog: thin warm golden haze — distance stays saturated, never grey -------
  scene.fog = new THREE.FogExp2(0xe3c088, 0.0013);

  // ------- lighting rig -------
  const sun = new THREE.DirectionalLight(0xffe3b3, 3.5);
  sun.position.copy(SUN_DIR).multiplyScalar(300);
  sun.castShadow = true;
  sun.shadow.mapSize.set(4096, 4096);
  sun.shadow.camera.near = 60;
  sun.shadow.camera.far = 620;
  const S = 210;   // refit every frame in updateSky() to the visible footprint
  sun.shadow.camera.left = -S; sun.shadow.camera.right = S;
  sun.shadow.camera.top = S; sun.shadow.camera.bottom = -S;
  sun.shadow.bias = -0.0003;
  sun.shadow.normalBias = 0.3;
  sun.shadow.camera.updateProjectionMatrix();
  scene.add(sun);
  scene.add(sun.target);
  G.sun = sun;

  // high warm bounce fill — GZH shadow sides read tan-brown, never black.
  // Sky half stays faintly blue for cool roof/shadow separation; ground half
  // is strong bounced-sand warmth that keeps unlit walls legible.
  const hemi = new THREE.HemisphereLight(0x9db9dd, 0xd9a76a, 1.05);
  scene.add(hemi);

  const amb = new THREE.AmbientLight(0xc7a887, 0.22);
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

// Refit the shadow ortho box every frame to the ground footprint the RTS
// camera can actually see (derived from zoom; pitch/FOV are effectively
// fixed), instead of one huge fixed box — this is what makes unit shadows
// crisp instead of soft blobs at gameplay zoom.
const _camPos = new THREE.Vector3();
export function updateSky(dt) {
  if (!G.camera || !G.sun) return;
  const sun = G.sun, rig = G.camRig;
  let cx, cz, S;
  if (rig) {
    // lateral half-width of the visible ground at this zoom (46° FOV, 16:9,
    // ~41-54° pitch) is ~1.05*zoom + margin; quantized so the projection
    // only refits on zoom steps, not every frame.
    S = Math.min(210, rig.zoom * 1.15 + 30);
    S = Math.ceil(S / 8) * 8;
    // the frustum reaches further beyond the look target than behind it
    const fwd = S * 0.25;
    cx = rig.tx + Math.sin(rig.yaw) * fwd;
    cz = rig.tz + Math.cos(rig.yaw) * fwd;
  } else {
    G.camera.getWorldPosition(_camPos);
    cx = _camPos.x; cz = _camPos.z; S = 210;
  }
  // snap the centre to the shadow-texel grid so edges don't crawl while panning
  const texel = (2 * S) / sun.shadow.mapSize.x;
  cx = Math.round(cx / texel) * texel;
  cz = Math.round(cz / texel) * texel;
  const sc = sun.shadow.camera;
  if (sc.right !== S) {
    sc.left = -S; sc.right = S; sc.top = S; sc.bottom = -S;
    sc.near = Math.max(40, 300 - S - 90);
    sc.far = 300 + S + 90;
    sc.updateProjectionMatrix();
  }
  sun.target.position.set(cx, 0, cz);
  sun.position.copy(SUN_DIR).multiplyScalar(300).add(sun.target.position);
}
