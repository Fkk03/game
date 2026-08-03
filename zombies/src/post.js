// Post-processing: HDR render -> UnrealBloom -> final grade pass
// (ACES tonemap, teal/orange grade, vignette, film grain, chromatic aberration, sRGB out).
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';

const GradeShader = {
  uniforms: {
    tDiffuse: { value: null },
    uTime: { value: 0 },
    uVignette: { value: 0.3 },
    uGrain: { value: 0.017 },
    uCA: { value: 0.00035 },
    uHurt: { value: 0 },
    uExposure: { value: 2.1 },
  },
  vertexShader: /* glsl */`
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */`
    uniform sampler2D tDiffuse;
    uniform float uTime, uVignette, uGrain, uCA, uHurt, uExposure;
    varying vec2 vUv;
    vec3 aces(vec3 x) {
      const float a = 2.51, b = 0.03, c = 2.43, d = 0.59, e = 0.14;
      return clamp((x * (a * x + b)) / (x * (c * x + d) + e), 0.0, 1.0);
    }
    float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
    void main() {
      vec2 uv = vUv;
      vec2 off = (uv - 0.5);
      float r2 = dot(off, off);
      // chromatic aberration grows toward edges
      vec2 ca = off * r2 * uCA * 60.0;
      vec3 col;
      col.r = texture2D(tDiffuse, uv + ca).r;
      col.g = texture2D(tDiffuse, uv).g;
      col.b = texture2D(tDiffuse, uv - ca).b;
      // tonemap (input is linear HDR)
      col = aces(col * uExposure);
      // grade: cool shadows, warm-ish highlights, slight desaturation of mids
      float lum = dot(col, vec3(0.299, 0.587, 0.114));
      col = mix(col, vec3(lum), 0.12);
      col += (1.0 - lum) * vec3(-0.012, 0.004, 0.03) * 1.4;   // teal shadows
      col += lum * vec3(0.03, 0.012, -0.015);                 // warm highlights
      // filmic toe: rolls the deepest values down to true black while leaving
      // mids nearly untouched (f(0)=0, f(1)=1, quadratic near 0)
      col = max(col, vec3(0.0));
      const float TOE = 0.045;
      col = col * col * (1.0 + TOE) / (col + TOE);
      // gentle S-curve for midtone contrast; endpoints fixed so highlights
      // shoulder off softly instead of clipping
      col = mix(col, col * col * (3.0 - 2.0 * col), 0.30);
      // hurt tint
      col = mix(col, vec3(col.r * 1.1, col.g * 0.25, col.b * 0.22), uHurt * 0.55);
      // vignette
      float v = 1.0 - r2 * uVignette * 2.6 * (1.0 + uHurt);
      col *= clamp(v, 0.0, 1.0);
      // grain, shaped by final luminance: fades out in the deepest shadows
      // (where it reads as noise and lifts blacks) and eases off in highlights
      float glum = dot(col, vec3(0.299, 0.587, 0.114));
      float g = (hash(uv * vec2(1621.3, 913.7) + fract(uTime) * 61.7) - 0.5) * uGrain;
      col += g * smoothstep(0.006, 0.15, glum) * (1.0 - glum * 0.55);
      // linear -> sRGB
      col = pow(max(col, 0.0), vec3(1.0 / 2.2));
      gl_FragColor = vec4(col, 1.0);
    }`,
};

export function initPost(G) {
  const size = new THREE.Vector2();
  G.renderer.getSize(size);
  const rt = new THREE.WebGLRenderTarget(size.x, size.y, {
    type: THREE.HalfFloatType,
    samples: 4,
  });
  const composer = G.composer = new EffectComposer(G.renderer, rt);
  composer.addPass(new RenderPass(G.scene, G.camera));
  const bloom = G.bloomPass = new UnrealBloomPass(size.clone(), 0.42, 0.55, 0.82);
  composer.addPass(bloom);
  const grade = G.gradePass = new ShaderPass(GradeShader);
  composer.addPass(grade);
  G.renderer.toneMapping = THREE.NoToneMapping;
  G.renderer.outputColorSpace = THREE.LinearSRGBColorSpace; // grade pass does the sRGB encode

  addEventListener('resize', () => {
    const w = innerWidth, h = innerHeight;
    composer.setSize(w, h);
  });
}

export function updatePost(G, dt, t) {
  G.gradePass.uniforms.uTime.value = t;
  const P = G.player;
  const hurtTarget = P.dead ? 0.65 : Math.max(0, 1 - P.health / P.maxHealth) * 0.5;
  const u = G.gradePass.uniforms.uHurt;
  u.value += (hurtTarget - u.value) * Math.min(1, 5 * dt);
}
