// Zombies: procedural bodies with per-zombie variation, smart AI (A* pathfinding,
// encirclement slots, sprint lead-prediction, window tear/vault, gunshot hearing),
// the rounds director, gore, and power-up drops.
import * as THREE from 'three';
import { makeRng } from './rng.js';
import { zombieSkinTexture, clothTexture } from './textures.js';

const V3 = (x, y, z) => new THREE.Vector3(x, y, z);
const zombies = [];
const powerups = [];

export function initZombies(G) {
  const rng = makeRng(G.seed + 500);
  // shared materials (variation pool)
  // corpse skin tones: pale olive, ashen tan, green rot, bruised gray-purple
  const TONES = [[112, 118, 92], [122, 110, 90], [100, 110, 96], [112, 102, 106]];
  const skins = [0, 1, 2, 3].map(i => {
    const t = zombieSkinTexture({ seed: 71 + i * 7, tone: TONES[i] });
    return new THREE.MeshStandardMaterial({ map: t.map, bumpMap: t.bumpMap, bumpScale: 0.8, roughness: 0.92 });
  });
  // hands/claws: same skin maps tinted with dried-blood grime
  const handMats = skins.map(s => new THREE.MeshStandardMaterial({
    map: s.map, bumpMap: s.bumpMap, bumpScale: 0.8, roughness: 0.9, color: 0xb08a78,
  }));
  // WW2 villager cloth: muted, varied hues (no more uniform blue-gray), then
  // grunged with fold shading, mud and old blood on a local canvas pass.
  const CLOTH_BASES = [
    [86, 84, 58],   // olive drab
    [84, 88, 84],   // field gray
    [96, 74, 52],   // worn brown
    [73, 70, 66],   // charcoal
    [92, 58, 50],   // faded burgundy
    [112, 100, 76], // dusty tan
    [62, 68, 86],   // worker navy (minority)
    [70, 80, 58],   // loden green
  ];
  function grungyClothMat(i) {
    const seed = 81 + i * 11;
    const src = clothTexture({ seed, base: CLOTH_BASES[i] }).map.image;
    const S = 256;
    const c = document.createElement('canvas'); c.width = c.height = S;
    const x = c.getContext('2d');
    x.drawImage(src, 0, 0);
    const r = makeRng(seed + 3000);
    // soft vertical fold shading so flat boxes read as hanging cloth
    for (let f = 0; f < 6; f++) {
      const fx = r() * S, wdt = r.range(12, 30);
      const g = x.createLinearGradient(fx, 0, fx + wdt, 0);
      g.addColorStop(0, 'rgba(0,0,0,0)');
      g.addColorStop(0.5, `rgba(8,7,6,${r.range(0.12, 0.26).toFixed(2)})`);
      g.addColorStop(1, 'rgba(0,0,0,0)');
      x.fillStyle = g; x.fillRect(fx, 0, wdt, S);
      x.fillStyle = `rgba(255,250,235,${r.range(0.02, 0.05).toFixed(2)})`;
      x.fillRect(Math.min(S - 2, fx + wdt), 0, 2, S);
    }
    // mud and grave dirt: soft smears (hard dots read as camo speckle at range)
    for (let m = 0; m < 12; m++) {
      const mx = r() * S, my = S * (0.3 + r() * 0.7), mr = r.range(7, 22);
      const g = x.createRadialGradient(mx, my, 1, mx, my, mr);
      g.addColorStop(0, `rgba(38,31,21,${r.range(0.16, 0.34).toFixed(2)})`);
      g.addColorStop(1, 'rgba(38,31,21,0)');
      x.fillStyle = g;
      x.beginPath(); x.ellipse(mx, my, mr * 1.4, mr, r() * 3, 0, 7); x.fill();
    }
    const hem = x.createLinearGradient(0, S * 0.7, 0, S);
    hem.addColorStop(0, 'rgba(16,13,9,0)'); hem.addColorStop(1, 'rgba(16,13,9,0.42)');
    x.fillStyle = hem; x.fillRect(0, S * 0.7, S, S * 0.3);
    // old blood: soaked blotches with drips + spatter (amount varies per variant)
    const gore = r() < 0.5 ? r.int(1, 2) : r.int(3, 5);
    for (let b = 0; b < gore; b++) {
      const bx = r() * S, by = r() * S * 0.8, br = r.range(9, 30);
      const g = x.createRadialGradient(bx, by, 1, bx, by, br);
      g.addColorStop(0, `rgba(48,9,7,${r.range(0.5, 0.8).toFixed(2)})`);
      g.addColorStop(0.7, `rgba(38,8,6,${r.range(0.25, 0.45).toFixed(2)})`);
      g.addColorStop(1, 'rgba(38,8,6,0)');
      x.fillStyle = g; x.beginPath(); x.arc(bx, by, br, 0, 7); x.fill();
      x.fillStyle = `rgba(40,8,6,${r.range(0.3, 0.55).toFixed(2)})`;
      x.fillRect(bx - 1.5, by, 3, br * r.range(1.2, 2.4));
    }
    for (let d = 0; d < 9; d++) { // sparse spatter flicks
      const dx = r() * S, dy = r() * S, da = r() * 3;
      x.fillStyle = `rgba(52,10,8,${r.range(0.3, 0.6).toFixed(2)})`;
      x.beginPath(); x.ellipse(dx, dy, r.range(1.5, 4.5), r.range(1, 2.2), da, 0, 7); x.fill();
    }
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 8;
    return new THREE.MeshStandardMaterial({ map: t, roughness: 0.97 });
  }
  const cloths = CLOTH_BASES.map((_, i) => grungyClothMat(i));
  const PANTS = [1, 2, 3, 5, 6, 7];   // muted trouser subset of the cloth pool
  const JACKETS = [0, 1, 2, 3, 4, 5, 7]; // navy stays pants-only (too dark up top)
  const eyeMat = new THREE.MeshStandardMaterial({ color: 0xffa524, emissive: 0xff8a10, emissiveIntensity: 2.3 });
  const stumpMat = new THREE.MeshStandardMaterial({ color: 0x3a0f0b, roughness: 0.6 });
  const bootMat = new THREE.MeshStandardMaterial({ color: 0x2a221a, roughness: 0.9 });
  const hairMats = [0x151009, 0x211910, 0x2b2318, 0x4a4238].map(cN =>
    new THREE.MeshStandardMaterial({ color: cN, roughness: 1 }));

  // zombie face texture: mottled rot, asymmetric sunken sockets, skull nose,
  // ragged mouth, blood — applied to the front (+z) face of the head box via a
  // material array. Also reused as a bump map so the cavities catch light.
  function faceTexture(tone, seed) {
    const r = makeRng(seed);
    const S = 256;
    const c = document.createElement('canvas'); c.width = c.height = S;
    const x = c.getContext('2d');
    x.fillStyle = `rgb(${tone[0]},${tone[1]},${tone[2]})`; x.fillRect(0, 0, S, S);
    const shade = (px, py, rad, col, a) => {
      const g = x.createRadialGradient(px, py, rad * 0.15, px, py, rad);
      g.addColorStop(0, `rgba(${col},${a})`); g.addColorStop(1, `rgba(${col},0)`);
      x.fillStyle = g; x.beginPath(); x.arc(px, py, rad, 0, 7); x.fill();
    };
    // mottled decay: large soft blotches in sick hues, a few pale necrotic patches
    const rots = ['52,58,40', '66,52,42', '52,42,56', '38,44,36', '84,88,66'];
    for (let i = 0; i < 11; i++)
      shade(r() * S, r() * S, r.range(18, 52), rots[r.int(0, rots.length - 1)], r.range(0.08, 0.2));
    for (let i = 0; i < 4; i++)
      shade(r() * S, r() * S, r.range(12, 30), '148,146,124', r.range(0.08, 0.16));
    // bone-catchlight planes: cheekbones, brow tops, nose bridge (value contrast
    // against the hollows so the face reads as a skull, not a flat card)
    shade(70, 132, 22, '208,206,178', 0.16); shade(186, 132, 22, '208,206,178', 0.16);
    shade(70, 66, 26, '200,198,172', 0.12); shade(186, 66, 26, '200,198,172', 0.12);
    shade(128, 76, 18, '198,196,170', 0.1);
    // gaunt structure: temple/cheek hollows, dark jaw, brow-ridge shadow band
    shade(58, 152, 54, '24,20,24', 0.7); shade(198, 152, 54, '24,20,24', 0.7);
    shade(128, 34, 76, '30,27,28', 0.45);
    const jawG = x.createLinearGradient(0, S * 0.72, 0, S);
    jawG.addColorStop(0, 'rgba(18,14,12,0)'); jawG.addColorStop(1, 'rgba(18,14,12,0.5)');
    x.fillStyle = jawG; x.fillRect(0, S * 0.72, S, S * 0.28);
    const browG = x.createLinearGradient(0, 58, 0, 96);
    browG.addColorStop(0, 'rgba(20,15,13,0)'); browG.addColorStop(0.55, 'rgba(20,15,13,0.42)'); browG.addColorStop(1, 'rgba(20,15,13,0)');
    x.fillStyle = browG; x.fillRect(8, 58, S - 16, 38);
    // deep asymmetric sockets with bruised rims (eyes sit at ~(±60, 100) here)
    const sockets = [[68 + r.range(-4, 4), 100 + r.range(-3, 3), r.range(26, 33)],
      [188 + r.range(-4, 4), 100 + r.range(-3, 3), r.range(24, 33)]];
    for (const [sx, sy, sr] of sockets) {
      shade(sx, sy + 6, sr * 1.5, '46,32,44', 0.4);
      shade(sx, sy, sr, '20,12,10', 0.95);
      shade(sx, sy, sr * 0.55, '4,3,3', 1);
    }
    // weeping socket: dark tear-tracks down one cheek
    if (r() < 0.6) {
      const s = sockets[r() < 0.5 ? 0 : 1];
      x.fillStyle = 'rgba(38,10,8,0.6)';
      x.fillRect(s[0] - 2 + r.range(-4, 4), s[1] + 12, 3.5, r.range(28, 60));
      x.fillStyle = 'rgba(30,8,6,0.4)';
      x.fillRect(s[0] + 6, s[1] + 10, 2.5, r.range(16, 40));
    }
    // skull nose cavity + bone bridge glint
    shade(128, 134, 15, '12,7,7', 0.95);
    shade(122, 142, 7, '8,5,5', 1); shade(134, 142, 7, '8,5,5', 1);
    x.fillStyle = 'rgba(160,158,136,0.14)'; x.fillRect(125, 102, 5, 26);
    // torn cheek revealing side teeth (some variants)
    if (r() < 0.45) {
      const sd = r() < 0.5 ? -1 : 1;
      const tcx = 128 + sd * 52, tcy = 176;
      x.fillStyle = 'rgba(16,7,6,0.9)';
      x.beginPath();
      x.moveTo(tcx - 20 * sd, tcy - 14);
      x.lineTo(tcx + 14 * sd, tcy - 22 + r() * 8);
      x.lineTo(tcx + 22 * sd, tcy + 6);
      x.lineTo(tcx - 2 * sd, tcy + 18);
      x.lineTo(tcx - 24 * sd, tcy + 6);
      x.closePath(); x.fill();
      x.fillStyle = 'rgba(150,140,112,0.8)';
      for (let i = 0; i < 3; i++) x.fillRect(tcx - 12 * sd + i * 8 * sd, tcy - 6, 5, 9);
    }
    // ragged mouth gape (off-center, torn wider at the corners)
    const mx0 = 128 + r.range(-8, 8), my0 = 196 + r.range(-4, 4);
    const mw = r.range(46, 58), mh = r.range(18, 26);
    x.fillStyle = 'rgba(6,3,3,0.98)';
    x.beginPath(); x.ellipse(mx0, my0, mw, mh, r.range(-0.08, 0.08), 0, 7); x.fill();
    x.beginPath(); x.ellipse(mx0 - mw * 0.55, my0 + 2, mw * 0.4, mh * 0.6, 0.5, 0, 7); x.fill();
    x.beginPath(); x.ellipse(mx0 + mw * 0.55, my0, mw * 0.35, mh * 0.55, -0.4, 0, 7); x.fill();
    // sparse rotten teeth hanging into the gape — dim and gapped so it never
    // reads as a grin
    for (let i = 0; i < 6; i++) {
      if (r() < 0.38) continue; // knocked out
      const tw = r.range(4, 5.5), th = r.range(6.5, 11);
      const tx = mx0 - mw * 0.5 + i * mw * 0.2 + r.range(-1.5, 1.5);
      x.save(); x.translate(tx, my0 - mh * 0.5); x.rotate(r.range(-0.2, 0.2));
      x.fillStyle = `rgba(${r.int(128, 152)},${r.int(118, 140)},${r.int(92, 112)},0.8)`;
      x.fillRect(-tw / 2, 0, tw, th);
      x.restore();
    }
    // gum shadow sinks the teeth roots back into the skull
    x.fillStyle = 'rgba(28,10,9,0.8)';
    x.fillRect(mx0 - mw * 0.62, my0 - mh * 0.58, mw * 1.24, 4.5);
    for (let i = 0; i < 2; i++) { // lower snag teeth
      if (r() < 0.45) continue;
      x.fillStyle = 'rgba(112,102,80,0.7)';
      x.fillRect(mx0 - mw * 0.25 + i * mw * 0.42, my0 + mh * 0.32, 4, -r.range(5, 9));
    }
    // gore running from the mouth + chin smear
    for (let i = 0, ns = r.int(1, 2); i < ns; i++) {
      const gx = mx0 + r.range(-mw * 0.6, mw * 0.6);
      const gl = r.range(22, 50);
      const gg = x.createLinearGradient(0, my0, 0, my0 + gl + 14);
      gg.addColorStop(0, 'rgba(64,10,8,0.85)'); gg.addColorStop(1, 'rgba(64,10,8,0)');
      x.fillStyle = gg; x.fillRect(gx, my0 + 4, r.range(3.5, 7), gl + 14);
    }
    shade(mx0, my0 + mh + 8, 20, '52,10,8', 0.5);
    // blood spatter flecks, biased to one side
    const spSide = r() < 0.5;
    for (let i = 0; i < 15; i++) {
      const px = spSide ? r.range(120, 250) : r.range(6, 136);
      x.fillStyle = `rgba(${r.int(64, 96)},11,9,${r.range(0.3, 0.7).toFixed(2)})`;
      x.beginPath(); x.arc(px, r() * S, r.range(1, 3.4), 0, 7); x.fill();
    }
    // scratches
    x.lineWidth = 2;
    for (let i = 0; i < 4; i++) {
      x.strokeStyle = `rgba(70,22,16,${r.range(0.35, 0.6).toFixed(2)})`;
      const sx = r() * S, sy = r() * S * 0.5;
      x.beginPath(); x.moveTo(sx, sy);
      x.lineTo(sx + r.range(-24, 24), sy + r.range(30, 64)); x.stroke();
    }
    // forehead gash (some variants): wide bruise stroke under a dark cut
    if (r() < 0.4) {
      const gy = r.range(22, 52), gx1 = r.range(50, 104);
      const gx2 = gx1 + r.range(58, 86), gyb = gy + r.range(-8, 10);
      x.strokeStyle = 'rgba(96,26,20,0.45)'; x.lineWidth = 8;
      x.beginPath(); x.moveTo(gx1, gy); x.quadraticCurveTo((gx1 + gx2) / 2, gyb, gx2, gy + r.range(-4, 12)); x.stroke();
      x.strokeStyle = 'rgba(26,8,7,0.9)'; x.lineWidth = 3.5;
      x.stroke();
    }
    // edge vignette so the face doesn't read as a flat pasted billboard
    // (kept light so it doesn't crush the socket/mouth contrast)
    const vg = x.createRadialGradient(128, 118, 96, 128, 128, 182);
    vg.addColorStop(0, 'rgba(14,11,12,0)'); vg.addColorStop(1, 'rgba(14,11,12,0.34)');
    x.fillStyle = vg; x.fillRect(0, 0, S, S);
    const map = new THREE.CanvasTexture(c);
    map.colorSpace = THREE.SRGBColorSpace;
    map.anisotropy = 8;
    const bump = new THREE.CanvasTexture(c); // luminance doubles as height
    return { map, bump };
  }
  const faceMats = [0, 1, 2, 3, 4, 5, 6, 7].map(i => {
    const t = faceTexture(TONES[i >> 1], 900 + (i >> 1) * 31 + (i & 1) * 211);
    return new THREE.MeshStandardMaterial({ map: t.map, bumpMap: t.bump, bumpScale: 1.4, roughness: 0.88 });
  });
  // tattered shirt-hem alpha texture (vertical rag strips)
  const tatterTex = (() => {
    const c = document.createElement('canvas'); c.width = 128; c.height = 32;
    const x = c.getContext('2d');
    x.clearRect(0, 0, 128, 32);
    const r = makeRng(777);
    x.fillStyle = '#fff';
    for (let i = 0; i < 16; i++) {
      const w0 = 4 + r() * 6, x0 = i * 8;
      x.fillRect(x0, 0, w0, 12 + r() * 20);
    }
    const t = new THREE.CanvasTexture(c);
    return t;
  })();
  const tatterMats = cloths.map(cm => new THREE.MeshStandardMaterial({
    map: cm.map, alphaMap: tatterTex, transparent: true, alphaTest: 0.5,
    side: THREE.DoubleSide, roughness: 1,
  }));

  // torn-open wound decal: ragged blood-soaked rim, dark cavity, exposed ribs.
  // Rendered as a plane floating just proud of the torso (alpha-tested, no sorting).
  function woundTexture(seed) {
    const r = makeRng(seed);
    const S = 128;
    const c = document.createElement('canvas'); c.width = c.height = S;
    const x = c.getContext('2d');
    x.clearRect(0, 0, S, S);
    const cx = S / 2, cy = S / 2;
    const pts = [];
    const n = 12;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      const rad = S * r.range(0.19, 0.42);
      pts.push([cx + Math.cos(a) * rad, cy + Math.sin(a) * rad * 1.2]);
    }
    const poly = (k) => {
      x.beginPath();
      x.moveTo(cx + (pts[0][0] - cx) * k, cy + (pts[0][1] - cy) * k);
      for (const p of pts) x.lineTo(cx + (p[0] - cx) * k, cy + (p[1] - cy) * k);
      x.closePath();
    };
    // irregular soak splotches bleeding into the cloth (a concentric ring
    // reads as a printed badge — avoid that)
    for (let i = 0; i < 10; i++) {
      const a = r() * 7, d = S * r.range(0.16, 0.33);
      const bx = cx + Math.cos(a) * d, by = cy + Math.sin(a) * d * 1.2;
      const br = S * r.range(0.09, 0.19);
      const g = x.createRadialGradient(bx, by, 1, bx, by, br);
      g.addColorStop(0, 'rgba(60,11,8,0.85)');
      g.addColorStop(1, 'rgba(60,11,8,0)');
      x.fillStyle = g; x.beginPath(); x.arc(bx, by, br, 0, 7); x.fill();
    }
    x.fillStyle = 'rgba(30,8,6,0.95)'; poly(1); x.fill();     // torn flesh rim
    x.fillStyle = 'rgba(8,4,4,0.98)'; poly(0.8); x.fill();    // deep cavity
    x.save(); poly(0.84); x.clip();
    const broken = r.int(0, 3);
    for (let i = 0, nr = r.int(3, 4); i < nr; i++) { // exposed ribs, one snapped
      const ry = cy - S * 0.2 + i * S * 0.13;
      x.strokeStyle = `rgba(${r.int(160, 186)},${r.int(146, 170)},${r.int(116, 138)},0.95)`;
      x.lineWidth = r.range(5, 7);
      const y0 = ry + r.range(-5, 5), y1 = ry + r.range(-5, 5);
      if (i === broken) {
        const gap = r.range(-S * 0.08, S * 0.08);
        x.beginPath();
        x.moveTo(cx - S * 0.32, y0);
        x.quadraticCurveTo(cx - S * 0.12, ry + S * 0.05, cx + gap - S * 0.04, ry + r.range(0, 8));
        x.stroke();
        x.beginPath();
        x.moveTo(cx + gap + S * 0.05, ry + r.range(-6, 4));
        x.quadraticCurveTo(cx + S * 0.2, ry + S * 0.05, cx + S * 0.32, y1);
        x.stroke();
      } else {
        x.beginPath();
        x.moveTo(cx - S * 0.32, y0);
        x.quadraticCurveTo(cx, ry + S * 0.07, cx + S * 0.32, y1);
        x.stroke();
      }
    }
    for (let i = 0; i < 8; i++) { // dark meat + glisten between ribs
      x.fillStyle = `rgba(${r.int(60, 90)},${r.int(12, 20)},${r.int(10, 16)},0.8)`;
      x.beginPath();
      x.ellipse(cx + r.range(-S * 0.22, S * 0.22), cy + r.range(-S * 0.08, S * 0.28),
        r.range(3, 9), r.range(2, 6), r() * 3, 0, 7);
      x.fill();
    }
    x.restore();
    for (let i = 0; i < 16; i++) { // spatter around the wound
      const a = r() * 7, d = S * r.range(0.32, 0.48);
      x.fillStyle = `rgba(58,10,8,${r.range(0.5, 0.9).toFixed(2)})`;
      x.beginPath(); x.arc(cx + Math.cos(a) * d, cy + Math.sin(a) * d, r.range(1.2, 3.2), 0, 7); x.fill();
    }
    for (let i = 0; i < 4; i++) { // long drips running down the cloth
      const dw = r.range(2, 4.5), dl = r.range(12, 38);
      const dx = cx + r.range(-S * 0.22, S * 0.22);
      const dg = x.createLinearGradient(0, cy + S * 0.12, 0, cy + S * 0.12 + dl);
      dg.addColorStop(0, 'rgba(50,9,7,0.85)'); dg.addColorStop(1, 'rgba(50,9,7,0.3)');
      x.fillStyle = dg;
      x.fillRect(dx, cy + S * 0.12, dw, dl);
    }
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  }
  const woundMats = [905, 906, 907].map(s => new THREE.MeshStandardMaterial({
    map: woundTexture(s), alphaTest: 0.4, roughness: 0.55,
  }));

  const geo = {
    torso: new THREE.BoxGeometry(0.38, 0.52, 0.22),
    pelvis: new THREE.BoxGeometry(0.33, 0.2, 0.2),
    head: new THREE.BoxGeometry(0.2, 0.24, 0.22),
    jaw: new THREE.BoxGeometry(0.15, 0.07, 0.13),
    uarm: new THREE.BoxGeometry(0.095, 0.32, 0.095),
    farm: new THREE.BoxGeometry(0.08, 0.3, 0.08),
    hand: new THREE.BoxGeometry(0.095, 0.15, 0.05),
    thigh: new THREE.BoxGeometry(0.14, 0.38, 0.14),
    shin: new THREE.BoxGeometry(0.11, 0.36, 0.11),
    foot: new THREE.BoxGeometry(0.11, 0.08, 0.22),
    eye: new THREE.SphereGeometry(0.019, 6, 5),
    tatter: new THREE.CylinderGeometry(0.2, 0.24, 0.2, 8, 1, true),
    brow: new THREE.BoxGeometry(0.19, 0.03, 0.04),
    finger: new THREE.BoxGeometry(0.034, 0.155, 0.026).translate(0, -0.0775, 0),
    wound: new THREE.PlaneGeometry(0.3, 0.34),
    hbHead: new THREE.BoxGeometry(0.3, 0.34, 0.32),
    hbTorso: new THREE.BoxGeometry(0.48, 0.78, 0.32),
    hbLegs: new THREE.BoxGeometry(0.42, 0.85, 0.32),
  };

  const Z = G.zombies = {
    list: zombies,
    round: 0, toSpawn: 0, aliveCap: 8, spawnT: 0, betweenT: 3, roundActive: false,
    totalKills: 0, dropsThisRound: 0,
    raycastShot, splashDamage, meleeDamage, spawnPosed,
    startRound, spawnOne,
  };
  G.buffs = { insta: 0, points2x: 0 };

  function startRound(n) {
    Z.round = n;
    Z.toSpawn = Math.min(70, Math.round(5 + (n - 1) * 3.4 + Math.max(0, n - 8) * 2));
    Z.aliveCap = Math.min(24, 7 + n);
    Z.roundActive = true;
    Z.spawnT = 1.5;
    Z.dropsThisRound = 0;
    G.events.emit('roundStart', n);
  }

  function zombieHealth(n) {
    if (n <= 9) return 150 + (n - 1) * 100;
    let h = 950;
    for (let i = 10; i <= n; i++) h *= 1.1;
    return Math.round(h);
  }

  function speedClass(n, r) {
    // walkers early; sprinters take over at high rounds
    const sprintP = Math.min(0.85, Math.max(0, (n - 3) * 0.09));
    const jogP = Math.min(0.7, 0.18 + n * 0.06);
    const x = r();
    if (x < sprintP) return 'sprint';
    if (x < sprintP + jogP) return 'jog';
    return 'walk';
  }

  function buildBody() {
    const g = new THREE.Group();
    const skinI = Math.floor(rng() * skins.length);
    const skin = skins[skinI];
    const handMat = handMats[skinI];
    const face = faceMats[skinI * 2 + (rng() < 0.5 ? 0 : 1)];
    const clothI = JACKETS[Math.floor(rng() * JACKETS.length)];
    const cloth = cloths[clothI];
    const cloth2 = cloths[PANTS[Math.floor(rng() * PANTS.length)]];
    const mk = (geoName, mat, x, y, z) => {
      const m = new THREE.Mesh(geo[geoName], mat);
      m.position.set(x, y, z);
      m.castShadow = true; m.receiveShadow = true;
      return m;
    };
    const parts = {};
    parts.pelvis = mk('pelvis', cloth2, 0, 0.92, 0); g.add(parts.pelvis);
    parts.torso = mk('torso', cloth, 0, 0.38, 0); parts.pelvis.add(parts.torso);
    // frame variance: no two ribcages the same (children inherit the squash)
    parts.torso.scale.set(rng.range(0.92, 1.1), rng.range(0.97, 1.05), rng.range(0.94, 1.06));
    // tattered shirt hem hanging off the torso bottom
    const tat = new THREE.Mesh(geo.tatter, tatterMats[clothI]);
    tat.position.y = -0.32; parts.torso.add(tat);
    // torn-open wound: chest or gut, on a good chunk of the horde
    if (rng() < 0.55) {
      const wnd = new THREE.Mesh(geo.wound, woundMats[Math.floor(rng() * woundMats.length)]);
      const gut = rng() < 0.35;
      wnd.position.set(rng.range(-0.07, 0.07), gut ? -0.17 : rng.range(-0.02, 0.09), 0.115);
      wnd.rotation.z = rng.range(-0.5, 0.5);
      wnd.scale.setScalar(gut ? rng.range(0.62, 0.78) : rng.range(0.82, 1.0));
      wnd.receiveShadow = true;
      parts.torso.add(wnd);
    }
    parts.neck = new THREE.Group(); parts.neck.position.set(0, 0.3, 0.02); parts.torso.add(parts.neck);
    // head: face texture on +z, skin elsewhere (BoxGeometry group order: ±x,±y,+z,-z)
    parts.head = new THREE.Mesh(geo.head, [skin, skin, skin, skin, face, skin]);
    parts.head.position.set(0, 0.13, 0.03);
    parts.head.scale.setScalar(rng.range(0.95, 1.06));
    parts.head.castShadow = parts.head.receiveShadow = true;
    parts.neck.add(parts.head);
    parts.jaw = mk('jaw', skin, 0, -0.12, 0.04); parts.head.add(parts.jaw);
    // neck stub + brow ledge (real shadow over the eye sockets)
    const nk = mk('jaw', skin, 0, -0.14, -0.02); nk.scale.set(0.6, 1.6, 0.7); parts.head.add(nk);
    const brow = mk('brow', skin, 0, 0.066, 0.093); brow.rotation.x = 0.18; parts.head.add(brow);
    // matted hair cap (most, not all)
    if (rng() < 0.82) {
      const hair = new THREE.Mesh(geo.jaw,
        hairMats[rng() < 0.07 ? 3 : Math.floor(rng() * 3)]);
      hair.scale.set(1.42, 0.95, 1.75); hair.position.set(0, 0.14, -0.015);
      hair.rotation.z = rng.range(-0.08, 0.08);
      hair.castShadow = true; parts.head.add(hair);
    }
    const eL = new THREE.Mesh(geo.eye, eyeMat); eL.position.set(-0.047, 0.026, 0.1); parts.head.add(eL);
    const eR = new THREE.Mesh(geo.eye, eyeMat); eR.position.set(0.047, 0.026, 0.1); parts.head.add(eR);
    let cuffDone = false; // at most one rolled-sleeve cuff per zombie (mesh budget)
    for (const side of ['L', 'R']) {
      const sx = side === 'L' ? -1 : 1;
      const sh = new THREE.Group();
      sh.position.set(sx * 0.245, 0.2 + rng.range(-0.025, 0.012), 0);
      sh.scale.setScalar(rng.range(0.93, 1.06)); // uneven arm lengths
      parts.torso.add(sh);
      parts['arm' + side] = sh;
      // sleeves: mostly clothed, some bare (torn off / rolled to the shoulder)
      const bare = rng() < 0.3;
      const ua = mk('uarm', bare ? skin : cloth, 0, -0.15, 0); sh.add(ua);
      if (bare && rng() < 0.6 && !cuffDone) { // rolled-sleeve cuff bunched at the shoulder
        cuffDone = true;
        const cuff = mk('uarm', cloth, 0, -0.06, 0);
        cuff.scale.set(1.26, 0.36, 1.26); sh.add(cuff);
      }
      const el = new THREE.Group(); el.position.set(0, -0.31, 0); sh.add(el);
      parts['fore' + side] = el;
      const fa = mk('farm', !bare && rng() < 0.3 ? cloth : skin, 0, -0.14, 0); el.add(fa);
      // clawed hand: narrow palm + two crooked fingers hooked forward
      const hd = mk('hand', handMat, 0, -0.3, 0.015);
      hd.rotation.x = 0.35 + rng.range(-0.1, 0.15);
      hd.scale.set(0.72, 0.75, 0.9);
      el.add(hd);
      for (let fi = 0; fi < 2; fi++) {
        const f = new THREE.Mesh(geo.finger, handMat);
        f.position.set(sx * (fi === 0 ? 0.032 : -0.024), -0.06, 0.008);
        f.rotation.set(0.42 + rng() * 0.6, 0, sx * (fi === 0 ? 0.28 : -0.17));
        f.castShadow = true;
        hd.add(f);
      }
      const hip = new THREE.Group(); hip.position.set(sx * 0.1, -0.09, 0); parts.pelvis.add(hip);
      parts['leg' + side] = hip;
      const th = mk('thigh', cloth2, 0, -0.19, 0); hip.add(th);
      th.scale.set(rng.range(0.92, 1.08), 1, rng.range(0.92, 1.08)); // limb girth jitter
      const kn = new THREE.Group(); kn.position.set(0, -0.39, 0); hip.add(kn);
      parts['knee' + side] = kn;
      // bare shins are mud-caked (grime tint), never bright skin; most wear
      // scuffed dark boots — bright bare feet read as toy socks
      const sn = mk('shin', rng() < 0.4 ? handMat : cloth2, 0, -0.17, 0); kn.add(sn);
      parts['shinMesh' + side] = sn;
      const ft = mk('foot', rng() < 0.85 ? bootMat : handMat, 0, -0.36, 0.05); kn.add(ft);
      parts['footMesh' + side] = ft;
    }
    return { g, parts };
  }

  function spawnOne(entry) {
    const { g, parts } = buildBody();
    const z = {
      group: g, parts,
      hp: zombieHealth(Z.round), maxHp: zombieHealth(Z.round),
      speedClass: speedClass(Z.round, rng),
      state: 'toWindow', phase: rng() * 6.28, yaw: 0,
      window: null, path: null, pathI: 0, repathT: 0,
      attackCd: 0, tearT: 0, vaultT: 0, dieT: 0, riseT: 0, sinkT: 0,
      crawler: false, legHits: 0, slot: rng() * Math.PI * 2,
      scale: rng.range(0.92, 1.1), hunch: rng.range(0.15, 0.42),
      headless: false, partyHat: rng() < 0.012,
      armMissing: rng() < 0.08 ? (rng() < 0.5 ? 'L' : 'R') : null,
      ...poseVariance(rng),
    };
    z.speed = { walk: rng.range(0.85, 1.15), jog: rng.range(2.0, 2.5), sprint: rng.range(3.6, 4.3) }[z.speedClass];
    g.scale.setScalar(z.scale);
    if (z.armMissing) {
      parts['arm' + z.armMissing].visible = false;
      const st = new THREE.Mesh(geo.jaw, stumpMat); // ragged gore stump at the shoulder
      st.scale.set(0.8, 0.9, 0.8);
      st.position.set((z.armMissing === 'L' ? -1 : 1) * 0.245, 0.2, 0);
      st.castShadow = true;
      parts.torso.add(st);
    }
    if (z.partyHat) {
      const hat = new THREE.Mesh(new THREE.ConeGeometry(0.09, 0.22, 8),
        new THREE.MeshStandardMaterial({ color: 0xff40a0, roughness: 0.6, emissive: 0x801048, emissiveIntensity: 0.4 }));
      hat.position.set(0, 0.31, 0); hat.rotation.z = 0.15;
      parts.head.add(hat);
    }
    // hitboxes (invisible)
    const hbMat = new THREE.MeshBasicMaterial({ visible: false });
    const hbs = [];
    const hb = (geoName, part, parent, y) => {
      const m = new THREE.Mesh(geo[geoName], hbMat);
      m.position.y = y; m.userData.zombie = z; m.userData.part = part; m.userData.noBlock = true;
      parent.add(m); hbs.push(m);
    };
    hb('hbHead', 'head', parts.head, 0);
    hb('hbTorso', 'body', parts.torso, 0);
    hb('hbLegs', 'legs', parts.pelvis, -0.55);
    z.hitboxes = hbs;

    if (entry.grave) {
      z.state = 'rising';
      z.riseT = 0;
      g.position.set(entry.grave.x, -1.55, entry.grave.z);
      z.yaw = rng() * 6.28;
      G.events.emit('graveRise', entry.grave);
    } else {
      const w = entry.window;
      z.window = w;
      g.position.copy(w.spawn);
      g.position.x += rng.range(-2, 2); g.position.z += rng.range(-2, 2);
      z.yaw = Math.atan2(-w.dir.x, -w.dir.z);
    }
    g.rotation.y = z.yaw;
    G.scene.add(g);
    zombies.push(z);
    G.events.emit('zombieSpawned', z);
    return z;
  }

  // deterministic posed spawn for photo mode
  function spawnPosed(x, zpos, yaw, pose = 'walk', phase = 0, opts = {}) {
    const { g, parts } = buildBody();
    const z = {
      group: g, parts, hp: 1e9, maxHp: 1e9, speedClass: opts.speedClass ?? 'jog',
      state: 'posed', pose, phase, yaw, speed: 0,
      attackCd: 0, crawler: !!opts.crawler, headless: false, slot: 0,
      scale: opts.scale ?? 1, hunch: opts.hunch ?? 0.3, hitboxes: [],
      window: null, path: null,
      ...poseVariance(rng),
    };
    g.scale.setScalar(z.scale);
    g.position.set(x, opts.y ?? 0, zpos);
    g.rotation.y = yaw;
    G.scene.add(g);
    zombies.push(z);
    return z;
  }

  // per-zombie pose asymmetry so no two shamble alike
  function poseVariance(r) {
    return {
      // wider spread: some reach high, some drag an arm low at their side
      armBaseL: -(0.6 + r() * 0.95), armBaseR: -(0.85 + r() * 0.85),
      splayL: 0.05 + r() * 0.2, splayR: 0.04 + r() * 0.18,
      foreBaseL: -(0.3 + r() * 0.5), foreBaseR: -(0.25 + r() * 0.5),
      headTilt: (r() - 0.5) * 0.55, neckBase: -(0.05 + r() * 0.24),
      leanZ: (r() - 0.5) * 0.11,
      deathSplay: { lx: -0.2 - r() * 0.6, rx: -0.1 - r() * 0.7, lz: 0.4 + r() * 0.7, rz: -(0.4 + r() * 0.7) },
    };
  }

  // ---------- combat ----------
  const _p = new THREE.Vector3();
  function raycastShot(rc, st, G) {
    // matrices are normally fresh from rendering; force-update so hit detection
    // also works headless / same-tick as movement
    G.scene.updateMatrixWorld();
    // static geometry stop distance
    const statics = rc.intersectObjects(G.staticRay, false).filter(h => !h.object.userData.noBlock);
    const staticD = statics.length ? statics[0].distance : Infinity;
    // zombie hitboxes
    const hbs = [];
    for (const z of zombies) if (z.state !== 'dead' && z.state !== 'dying' && !z.gone) hbs.push(...z.hitboxes);
    const zh = rc.intersectObjects(hbs, false);
    let out = { hit: false, kill: false, point: null };
    if (zh.length && zh[0].distance < staticD) {
      const h = zh[0];
      const z = h.object.userData.zombie;
      const part = h.object.userData.part;
      const mul = part === 'head' ? st.headMul : part === 'legs' ? 0.8 : 1;
      const dmg = G.buffs.insta > 0 ? 1e9 : st.dmg * mul;
      out = { hit: true, kill: false, point: h.point };
      damageZombie(z, dmg, part, h.point, G);
      out.kill = z.hp <= 0;
      G.addPoints(10 * (G.buffs.points2x > 0 ? 2 : 1), 'hit');
      G.events.emit('bloodHit', { pos: h.point, dir: rc.ray.direction, part });
    } else if (statics.length) {
      out.point = statics[0].point;
      G.events.emit('wallHit', { pos: statics[0].point, normal: statics[0].face?.normal ?? V3(0, 1, 0), object: statics[0].object });
    } else {
      out.point = rc.ray.origin.clone().addScaledVector(rc.ray.direction, 60);
    }
    return out;
  }

  function splashDamage(point, radius, dmg, G, isExplosion = false) {
    let kills = 0;
    for (const z of zombies) {
      if (z.state === 'dead' || z.state === 'dying' || z.state === 'posed') continue;
      _p.copy(z.group.position); _p.y += 1;
      const d = _p.distanceTo(point);
      if (d > radius) continue;
      const fall = 1 - (d / radius) * 0.7;
      damageZombie(z, (G.buffs.insta > 0 ? 1e9 : dmg * fall), 'body', _p.clone(), G, isExplosion);
      if (z.hp <= 0) kills++;
    }
    return kills;
  }

  function meleeDamage(pos, dir, range, dmg, G) {
    let best = null, bestD = 1e9;
    for (const z of zombies) {
      if (z.state === 'dead' || z.state === 'dying' || z.state === 'posed') continue;
      _p.copy(z.group.position).sub(pos); _p.y = 0;
      const d = _p.length();
      if (d > range) continue;
      if (_p.normalize().dot(dir) < 0.45) continue;
      if (d < bestD) { bestD = d; best = z; }
    }
    if (!best) return null;
    damageZombie(best, G.buffs.insta > 0 ? 1e9 : dmg, 'body', best.group.position.clone().setY(1.2), G);
    G.events.emit('bloodHit', { pos: best.group.position.clone().setY(1.2), dir, part: 'body' });
    return best.hp <= 0 ? 'kill' : 'hit';
  }

  function damageZombie(z, dmg, part, point, G, isExplosion = false) {
    if (z.hp <= 0) return;
    z.hp -= dmg;
    z.staggerT = part === 'head' ? 0.28 : 0.16;
    if (part === 'legs' && z.hp > 0) {
      z.legHits += dmg;
      if (z.legHits > 110 && !z.crawler) makeCrawler(z);
    }
    if (z.hp <= 0) {
      const mul = G.buffs.points2x > 0 ? 2 : 1;
      const headshot = part === 'head';
      const pts = isExplosion ? 50 : headshot ? 100 : 60;
      G.addPoints(pts * mul, headshot ? 'headshot' : 'kill');
      G.player.kills++;
      if (headshot) { G.player.headshots++; z.headless = true; z.parts.head.visible = false; G.events.emit('headshot', { pos: point }); }
      if (isExplosion) G.events.emit('gib', { pos: z.group.position.clone().setY(1) });
      z.state = 'dying';
      z.dieT = 0;
      z.fallDir = Math.random() < 0.65 ? 1 : -1;
      Z.totalKills++;
      G.events.emit('zombieKilled', { z, headshot, pos: z.group.position.clone() });
      maybeDrop(z.group.position.clone(), G);
      if (z.partyHat) dropPowerup('maxammo', z.group.position.clone(), G, true);
    }
  }

  function makeCrawler(z) {
    z.crawler = true;
    z.speed = Math.min(z.speed, 0.8);
    z.parts.shinMeshL.visible = false; z.parts.shinMeshR.visible = false;
    z.parts.footMeshL.visible = false; z.parts.footMeshR.visible = false;
    G.events.emit('bloodHit', { pos: z.group.position.clone().setY(0.4), dir: V3(0, -1, 0), part: 'legs' });
    G.events.emit('crawler', z);
  }

  // ---------- power-ups ----------
  const PU = {
    insta: { color: 0xffe040, label: 'INSTA-KILL' },
    points2x: { color: 0xff8020, label: 'DOUBLE POINTS' },
    maxammo: { color: 0x40c0ff, label: 'MAX AMMO' },
    nuke: { color: 0x70ff50, label: 'NUKE' },
    carpenter: { color: 0xc0a060, label: 'CARPENTER' },
  };
  function maybeDrop(pos, G) {
    if (Z.dropsThisRound >= 4 || Math.random() > 0.035) return;
    Z.dropsThisRound++;
    const kinds = Object.keys(PU);
    dropPowerup(kinds[Math.floor(Math.random() * kinds.length)], pos, G);
  }
  function dropPowerup(kind, pos, G, forced = false) {
    const def = PU[kind];
    const g = new THREE.Group();
    const core = new THREE.Mesh(new THREE.OctahedronGeometry(0.22),
      new THREE.MeshStandardMaterial({ color: def.color, emissive: def.color, emissiveIntensity: 1.8, roughness: 0.3 }));
    const l = new THREE.PointLight(def.color, 4, 6, 2);
    g.add(core, l);
    g.position.set(pos.x, 0.8, pos.z);
    G.scene.add(g);
    powerups.push({ kind, group: g, t: 0, life: 28 });
  }

  // ---------- events ----------
  G.events.on('shotFired', ({ pos, loud }) => {
    if (!loud) return;
    for (const z of zombies) {
      if (z.state === 'chasing') z.repathT = Math.min(z.repathT, 0.1);
    }
  });

  return Z;
}

// =========================================================================
const _v = new THREE.Vector3(), _w = new THREE.Vector3(), _sep = new THREE.Vector3();

export function updateZombies(G, dt, t) {
  const Z = G.zombies, P = G.player;
  // buffs
  for (const k in G.buffs) G.buffs[k] = Math.max(0, G.buffs[k] - dt);

  // ---------- rounds director ----------
  if (G.state === 'PLAYING') {
    const alive = zombies.filter(z => z.state !== 'dead' && z.state !== 'posed' && !z.gone).length;
    if (!Z.roundActive) {
      Z.betweenT -= dt;
      if (Z.betweenT <= 0) Z.startRound(Z.round + 1);
    } else {
      if (Z.toSpawn > 0) {
        Z.spawnT -= dt;
        if (Z.spawnT <= 0 && alive < Z.aliveCap) {
          Z.spawnT = Math.max(0.35, 1.4 - Z.round * 0.06);
          const entry = pickSpawn(G);
          if (entry) { Z.spawnOne(entry); Z.toSpawn--; }
        }
      } else if (alive === 0) {
        Z.roundActive = false;
        Z.betweenT = 8;
        G.events.emit('roundEnd', Z.round);
      }
    }
  }

  // ---------- per-zombie ----------
  for (let i = zombies.length - 1; i >= 0; i--) {
    const z = zombies[i];
    if (z.gone) { zombies.splice(i, 1); continue; }
    if (z.state === 'posed') { animate(z, dt, t, G); continue; }
    z.attackCd -= dt;
    z.staggerT = Math.max(0, (z.staggerT ?? 0) - dt);

    switch (z.state) {
      case 'rising': {
        z.riseT += dt;
        const p = Math.min(1, z.riseT / 1.7);
        z.group.position.y = -1.55 + p * 1.55 * (p < 0.85 ? p / 0.85 : 1);
        z.group.position.y = -1.55 * (1 - easeOut(p));
        if (p >= 1) { z.group.position.y = 0; z.state = 'chasing'; }
        break;
      }
      case 'toWindow': {
        const w = z.window;
        if (!w) { z.state = 'chasing'; break; }
        moveAlong(G, z, w.outside, dt, 0.5);
        if (dist2D(z.group.position, w.outside) < 0.6) {
          z.state = w.planks.some(p => p.alive) ? 'tearing' : 'vaulting';
          z.vaultT = 0;
          z.yaw = Math.atan2(-w.dir.x, -w.dir.z);
        }
        break;
      }
      case 'tearing': {
        const w = z.window;
        z.yaw = Math.atan2(-w.dir.x, -w.dir.z);
        z.tearT += dt;
        if (z.tearT > 1.35) {
          z.tearT = 0;
          const plank = w.planks.filter(p => p.alive).sort((a, b) => b.mesh.position.y - a.mesh.position.y)[0];
          if (plank) {
            plank.alive = false;
            G.events.emit('plankTorn', { win: w, plank });
          }
          if (!w.planks.some(p => p.alive)) { z.state = 'vaulting'; z.vaultT = 0; }
        }
        break;
      }
      case 'vaulting': {
        const w = z.window;
        z.vaultT += dt;
        const p = Math.min(1, z.vaultT / 1.0);
        _v.lerpVectors(w.outside, w.inside, easeInOut(p));
        z.group.position.set(_v.x, Math.sin(p * Math.PI) * 0.95, _v.z);
        z.yaw = Math.atan2(-w.dir.x, -w.dir.z);
        if (p >= 1) { z.group.position.y = 0; z.state = 'chasing'; }
        break;
      }
      case 'chasing': {
        if (P.dead) break;
        // encirclement: aim at a slot around the player, not the player point
        const surroundR = 1.1;
        let tx = P.pos.x + Math.cos(z.slot) * surroundR * (dist2D(z.group.position, P.pos) < 4 ? 1 : 0);
        let tz = P.pos.z + Math.sin(z.slot) * surroundR * (dist2D(z.group.position, P.pos) < 4 ? 1 : 0);
        // sprinters lead the target
        if (z.speedClass === 'sprint') { tx += P.vel.x * 0.35; tz += P.vel.z * 0.35; }
        moveAlong(G, z, _w.set(tx, 0, tz), dt, 1.0);
        const d = dist2D(z.group.position, P.pos);
        if (d < 1.5 && z.attackCd <= 0) {
          z.state = 'attacking'; z.atkT = 0; z.didHit = false;
        }
        break;
      }
      case 'attacking': {
        z.atkT += dt;
        z.yaw = Math.atan2(P.pos.x - z.group.position.x, P.pos.z - z.group.position.z);
        if (z.atkT > 0.32 && !z.didHit) {
          z.didHit = true;
          if (dist2D(z.group.position, P.pos) < 2.0 && !P.dead) {
            G.damagePlayer(26, z.group.position);
            G.events.emit('zombieHitPlayer', z);
          }
        }
        if (z.atkT > 0.75) {
          z.attackCd = 0.55;
          z.state = 'chasing';
        }
        break;
      }
      case 'dying': {
        z.dieT += dt;
        const p = Math.min(1, z.dieT / 0.55);
        z.group.rotation.x = z.fallDir * easeOut(p) * Math.PI / 2 * 0.94;
        z.group.position.y = -easeOut(p) * 0.15;
        if (z.dieT > 0.55 && !z.pooled) {
          z.pooled = true;
          G.events.emit('bloodPool', { pos: z.group.position.clone().setY(0.02) });
        }
        if (z.dieT > 2.6) { z.state = 'dead'; z.sinkT = 0; }
        break;
      }
      case 'dead': {
        z.sinkT += dt;
        z.group.position.y -= dt * 0.35;
        if (z.sinkT > 2.2) {
          z.group.removeFromParent();
          z.gone = true;
        }
        break;
      }
    }

    // keep zombies out of the player capsule
    if (z.state === 'chasing' || z.state === 'attacking') {
      const d = dist2D(z.group.position, P.pos);
      if (d < 0.72 && d > 1e-4) {
        const push = (0.72 - d);
        z.group.position.x += (z.group.position.x - P.pos.x) / d * push;
        z.group.position.z += (z.group.position.z - P.pos.z) / d * push;
      }
    }

    z.group.rotation.y = z.yaw;
    animate(z, dt, t, G);
  }

  // ---------- power-ups ----------
  for (let i = powerups.length - 1; i >= 0; i--) {
    const pu = powerups[i];
    pu.t += dt; pu.life -= dt;
    pu.group.rotation.y = pu.t * 2.2;
    pu.group.position.y = 0.8 + Math.sin(pu.t * 2.4) * 0.12;
    pu.group.children[1].intensity = pu.life < 6 ? (Math.sin(pu.t * 12) > 0 ? 4 : 0.5) : 4;
    const d = dist2D(pu.group.position, P.pos);
    if (d < 1.1 && !P.dead) {
      applyPowerup(pu.kind, G);
      pu.group.removeFromParent();
      powerups.splice(i, 1);
      continue;
    }
    if (pu.life <= 0) { pu.group.removeFromParent(); powerups.splice(i, 1); }
  }
}

function applyPowerup(kind, G) {
  const labels = { insta: 'INSTA-KILL', points2x: 'DOUBLE POINTS', maxammo: 'MAX AMMO', nuke: 'NUKE', carpenter: 'CARPENTER' };
  if (kind === 'insta') G.buffs.insta = 30;
  if (kind === 'points2x') G.buffs.points2x = 30;
  if (kind === 'maxammo') {
    for (const w of G.weapons.slots) { w.reserve = Math.round(w.def.reserve * (w.pap ? 1.5 : 1)); w.ammo = G.weapons.statsOf(w).mag; }
    G.weapons.grenades = Math.min(G.weapons.maxGrenades, G.weapons.grenades + 2);
    G.events.emit('ammoChanged');
  }
  if (kind === 'nuke') {
    let n = 0;
    for (const z of zombies) {
      if (z.state === 'dead' || z.state === 'dying' || z.state === 'posed' || z.gone) continue;
      z.hp = 0; z.state = 'dying'; z.dieT = 0; z.fallDir = Math.random() < 0.5 ? 1 : -1;
      G.zombies.totalKills++; G.player.kills++; n++;
      G.events.emit('gib', { pos: z.group.position.clone().setY(1) });
    }
    G.addPoints(400, 'nuke');
    G.events.emit('nuke', n);
  }
  if (kind === 'carpenter') {
    for (const w of G.world.windows) {
      for (const p of w.planks) {
        if (!p.alive) {
          p.alive = true;
          p.mesh.visible = true;
          p.mesh.position.copy(p.home.position);
          p.mesh.rotation.copy(p.home.rotation);
        }
      }
    }
    G.addPoints(200, 'carpenter');
  }
  G.events.emit('powerup', { kind, label: labels[kind] });
}

// ---------- movement ----------
function pickSpawn(G) {
  const W = G.world, P = G.player;
  const options = [];
  for (const w of W.windows) {
    if (!W.zones[w.zone]) continue;
    const d = dist2D(w.pos, P.pos);
    options.push({ window: w, weight: 1 / (6 + d) });
  }
  if (W.zones.D) {
    for (const gpos of W.graves) {
      // avoid rising into the player's face
      if (dist2D(gpos, P.pos) < 4) continue;
      options.push({ grave: gpos, weight: 0.5 / (8 + dist2D(gpos, P.pos)) });
    }
  }
  if (!options.length) return null;
  let sum = 0; for (const o of options) sum += o.weight;
  let r = Math.random() * sum;
  for (const o of options) { r -= o.weight; if (r <= 0) return o; }
  return options[0];
}

function moveAlong(G, z, target, dt, repathBase) {
  z.repathT -= dt;
  const zp = z.group.position;
  if (z.repathT <= 0 || !z.path) {
    z.repathT = repathBase + Math.random() * 0.4;
    const path = G.world.nav.findPath(zp.x, zp.z, target.x, target.z);
    if (path && path.length) { z.path = path; z.pathI = 0; }
    else z.path = null;
  }
  let dirX, dirZ;
  if (z.path) {
    let wp = z.path[z.pathI];
    while (wp && Math.hypot(wp[0] - zp.x, wp[1] - zp.z) < 0.45 && z.pathI < z.path.length - 1) {
      z.pathI++; wp = z.path[z.pathI];
    }
    if (!wp) { dirX = target.x - zp.x; dirZ = target.z - zp.z; }
    else { dirX = wp[0] - zp.x; dirZ = wp[1] - zp.z; }
  } else {
    dirX = target.x - zp.x; dirZ = target.z - zp.z;
  }
  const dl = Math.hypot(dirX, dirZ);
  if (dl > 1e-4) { dirX /= dl; dirZ /= dl; }

  // separation from other zombies
  _sep.set(0, 0, 0);
  for (const o of zombies) {
    if (o === z || o.state === 'dead' || o.state === 'dying' || o.gone || o.state === 'posed') continue;
    const dx = zp.x - o.group.position.x, dz = zp.z - o.group.position.z;
    const d2 = dx * dx + dz * dz;
    if (d2 < 0.55 && d2 > 1e-5) {
      const d = Math.sqrt(d2);
      _sep.x += dx / d * (0.74 - d);
      _sep.z += dz / d * (0.74 - d);
    }
  }
  dirX += _sep.x * 1.6; dirZ += _sep.z * 1.6;
  const dn = Math.hypot(dirX, dirZ);
  if (dn > 1e-4) { dirX /= dn; dirZ /= dn; }

  const stagger = z.staggerT > 0 ? 0.25 : 1;
  const sp = z.speed * stagger;
  zp.x += dirX * sp * dt;
  zp.z += dirZ * sp * dt;
  // face travel direction (smoothed)
  const targetYaw = Math.atan2(dirX, dirZ);
  let dy = targetYaw - z.yaw;
  while (dy > Math.PI) dy -= Math.PI * 2;
  while (dy < -Math.PI) dy += Math.PI * 2;
  z.yaw += dy * Math.min(1, 8 * dt);
  z.phase += dt * sp * (z.crawler ? 2.4 : 1.55);
}

// ---------- procedural animation ----------
function animate(z, dt, t, G) {
  const p = z.parts, ph = z.phase;
  const stag = z.staggerT > 0 ? 1 : 0;
  if (z.state === 'dying' || z.state === 'dead') {
    // limbs splay loose as the body drops
    const ds = z.deathSplay ?? { lx: -0.4, rx: -0.3, lz: 0.7, rz: -0.7 };
    p.armL.rotation.x = lerpTo(p.armL.rotation.x, ds.lx, dt * 7);
    p.armR.rotation.x = lerpTo(p.armR.rotation.x, ds.rx, dt * 7);
    p.armL.rotation.z = lerpTo(p.armL.rotation.z, ds.lz, dt * 7);
    p.armR.rotation.z = lerpTo(p.armR.rotation.z, ds.rz, dt * 7);
    p.foreL.rotation.x = lerpTo(p.foreL.rotation.x, -0.15, dt * 7);
    p.foreR.rotation.x = lerpTo(p.foreR.rotation.x, -0.2, dt * 7);
    p.legL.rotation.x = lerpTo(p.legL.rotation.x, (z.deathSplay?.lz ?? 0.4) * 0.4, dt * 5);
    p.legR.rotation.x = lerpTo(p.legR.rotation.x, -(z.deathSplay?.rz ?? 0.4) * 0.3, dt * 5);
    p.neck.rotation.z = lerpTo(p.neck.rotation.z, (z.headTilt ?? 0.2) * 2, dt * 5);
    return;
  }
  const pose = z.state === 'posed' ? z.pose : null;

  if (z.crawler) {
    p.pelvis.position.y = 0.34;
    p.pelvis.rotation.x = -1.25;
    p.armL.rotation.x = -1.9 + Math.sin(ph) * 0.7;
    p.armR.rotation.x = -1.9 + Math.sin(ph + Math.PI) * 0.7;
    p.foreL.rotation.x = -0.5 + Math.max(0, Math.sin(ph)) * 0.5;
    p.foreR.rotation.x = -0.5 + Math.max(0, Math.sin(ph + Math.PI)) * 0.5;
    p.neck.rotation.x = 1.15;
    p.legL.rotation.x = 0.3; p.legR.rotation.x = 0.35;
    return;
  }

  if (z.state === 'rising' || pose === 'rise') {
    const pr = z.state === 'rising' ? Math.min(1, z.riseT / 1.7) : 0.55;
    p.pelvis.position.y = 0.92;
    p.armL.rotation.x = -2.6 + Math.sin(t * 7) * 0.3;
    p.armR.rotation.x = -2.6 + Math.sin(t * 7 + 2) * 0.3;
    p.foreL.rotation.x = -0.4; p.foreR.rotation.x = -0.5;
    p.torso.rotation.x = 0.35 * (1 - pr);
    p.neck.rotation.x = -0.4 * (1 - pr);
    return;
  }

  if (z.state === 'tearing' || pose === 'reach') {
    const rp = (z.tearT ?? (t % 1.35)) / 1.35;
    const grab = Math.sin(rp * Math.PI * 2 * 2);
    p.torso.rotation.x = 0.35;
    p.armL.rotation.x = -1.9 + grab * 0.45;
    p.armR.rotation.x = -1.9 - grab * 0.45;
    p.foreL.rotation.x = -0.35; p.foreR.rotation.x = -0.3;
    p.neck.rotation.x = -0.25;
    p.legL.rotation.x = 0.06; p.legR.rotation.x = -0.06;
    return;
  }

  if (z.state === 'attacking' || pose === 'attack') {
    // raise to shoulder height, then slash forward-down at the player
    const ap = z.state === 'attacking' ? Math.min(1, z.atkT / 0.75) : 0.4;
    const swing = ap < 0.42 ? (ap / 0.42) : (1 - (ap - 0.42) / 0.58); // 0->1->0
    p.torso.rotation.x = 0.32 + ap * 0.3;
    p.armL.rotation.x = -1.15 - swing * 0.55;
    p.armR.rotation.x = -1.25 - swing * 0.5;
    p.armL.rotation.z = -0.1 - (z.splayL ?? 0.12) * 0.8;
    p.armR.rotation.z = 0.08 + (z.splayR ?? 0.1) * 0.8;
    p.foreL.rotation.x = -0.55 + swing * 0.35;
    p.foreR.rotation.x = -0.5 + swing * 0.3;
    p.neck.rotation.x = -0.28;
    p.neck.rotation.z = (z.headTilt ?? 0) * 0.7;
    p.jaw.rotation.x = 0.5;
    return;
  }

  // ---- locomotion (walk / jog / sprint / vault) ----
  const sprint = z.speedClass === 'sprint' ? 1 : 0;
  const stride = 0.42 + sprint * 0.35;
  p.legL.rotation.x = Math.sin(ph) * stride;
  p.legR.rotation.x = Math.sin(ph + Math.PI) * stride;
  p.kneeL.rotation.x = Math.max(0, -Math.sin(ph)) * (0.7 + sprint * 0.4);
  p.kneeR.rotation.x = Math.max(0, -Math.sin(ph + Math.PI)) * (0.7 + sprint * 0.4);
  p.pelvis.position.y = 0.92 + Math.abs(Math.sin(ph)) * 0.045 * (1 + sprint);
  p.pelvis.rotation.z = (z.leanZ ?? 0) + Math.sin(ph) * 0.045;
  p.torso.rotation.x = z.hunch + sprint * 0.3 + stag * 0.25;
  p.torso.rotation.z = Math.sin(ph) * 0.06;
  p.torso.rotation.y = Math.sin(ph * 0.5 + z.slot) * 0.05;
  if (sprint) {
    p.armL.rotation.x = -0.6 + Math.sin(ph + Math.PI) * 0.9;
    p.armR.rotation.x = -0.6 + Math.sin(ph) * 0.9;
    p.armL.rotation.z = 0.12; p.armR.rotation.z = -0.12;
    p.foreL.rotation.x = -0.9; p.foreR.rotation.x = -0.9;
  } else {
    // classic shamble: asymmetric forward reach, elbows bent, arms splayed
    // outward so the silhouette reads even head-on
    p.armL.rotation.x = (z.armBaseL ?? -1.2) + Math.sin(ph * 0.9 + 1) * 0.13 + stag * 0.5;
    p.armR.rotation.x = (z.armBaseR ?? -1.45) + Math.sin(ph * 1.1) * 0.13 + stag * 0.5;
    p.armL.rotation.z = -(z.splayL ?? 0.12);
    p.armR.rotation.z = (z.splayR ?? 0.1);
    p.foreL.rotation.x = (z.foreBaseL ?? -0.45) + Math.sin(ph * 0.7) * 0.14;
    p.foreR.rotation.x = (z.foreBaseR ?? -0.35) + Math.cos(ph * 0.8) * 0.14;
  }
  p.neck.rotation.x = (z.neckBase ?? -0.15) + Math.sin(ph * 0.53 + z.slot) * 0.1 + stag * -0.4;
  p.neck.rotation.z = (z.headTilt ?? 0) + Math.sin(ph * 0.31 + z.slot * 2) * 0.1;
  p.neck.rotation.y = Math.sin(ph * 0.37 + z.slot * 2) * 0.22; // head wanders
  p.jaw.rotation.x = 0.18 + Math.max(0, Math.sin(t * 2.2 + z.slot * 3)) * 0.3;
}

const easeOut = (x) => 1 - Math.pow(1 - x, 3);
const easeInOut = (x) => x < 0.5 ? 2 * x * x : 1 - Math.pow(-2 * x + 2, 2) / 2;
const lerpTo = (a, b, k) => a + (b - a) * Math.min(1, k);
function dist2D(a, b) { const dx = a.x - b.x, dz = a.z - b.z; return Math.hypot(dx, dz); }
