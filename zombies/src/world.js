// World builder: map geometry, materials, lighting, colliders, nav grid, and
// gameplay furniture (windows/barricades, doors, wall-buys, perks, mystery box).
//
// Layout (top view, -z = north; player starts in courtyard facing house):
//   Zone A: Courtyard x[-14,14] z[-2,20]  +  House Room1 x[2,14] z[-18,-2]
//   Zone B: House Room2 x[-14,2] z[-18,-2]        (door B, 750, in dividing wall)
//   Zone C: Alley x[14,26] z[-18,20]              (door C, 1000, courtyard east gate)
//   Zone D: Graveyard x[-26,-14] z[-18,20]        (door D, 1250, west gate; D2, 1250, from Room2)
import * as THREE from 'three';
import { makeRng } from './rng.js';
import { NavGrid } from './pathfind.js';
import {
  brickTexture, concreteTexture, woodTexture, metalTexture, groundTexture,
  plasterTexture, chalkWeaponTexture, graffitiTexture,
} from './textures.js';

const V3 = (x, y, z) => new THREE.Vector3(x, y, z);

export function initWorld(G) {
  const scene = G.scene;
  const rng = makeRng(G.seed + 100);
  const W = G.world = {
    colliders: [],        // { min:V3, max:V3, id?, door? }
    windows: [],          // { id, pos, dir, inside, outside, planks[], zone, group }
    doors: {},            // id -> { cost, meshes[], colliders[], zone, label, open }
    interactables: [],    // { id, pos, radius, getLabel(G)->string|null, use(G) }
    graves: [],           // spawn positions (zone D)
    zones: { A: true, B: false, C: false, D: false },
    wallBuys: [], fires: [], lamps: [], powerLights: [],
    powerOn: false,
    bounds: { minX: -38, minZ: -28, maxX: 38, maxZ: 30 },
    eePads: {},           // easter-egg attachment points, filled below
  };

  // ---------- materials ----------
  const brick = brickTexture({ seed: 11 });
  const brickDark = brickTexture({ seed: 12, base: [72, 56, 48] });
  const conc = concreteTexture({ seed: 21 });
  const concFloor = concreteTexture({ seed: 22, base: 68, tint: [1, 0.98, 0.94] });
  const wood = woodTexture({ seed: 31 });
  const woodOld = woodTexture({ seed: 32, base: [70, 52, 36] });
  const metal = metalTexture({ seed: 41 });
  const metalRust = metalTexture({ seed: 42, rust: 0.8, base: [80, 72, 64] });
  const ground = groundTexture({ seed: 51 });
  const plaster = plasterTexture({ seed: 61 });
  // plaster reads at 4m per repeat (larger, calmer features on big walls)
  for (const t of [plaster.map, plaster.bumpMap, plaster.roughnessMap]) t.repeat.set(0.5, 0.5);

  const std = (t, extra = {}) => new THREE.MeshStandardMaterial({
    map: t.map, bumpMap: t.bumpMap, bumpScale: extra.bumpScale ?? 1.2,
    roughnessMap: t.roughnessMap, roughness: 1, metalness: extra.metalness ?? 0, ...extra,
  });
  const M = G.mats = {
    brick: std(brick, { bumpScale: 0.65 }), brickDark: std(brickDark, { bumpScale: 0.65 }),
    conc: std(conc), concFloor: std(concFloor),
    wood: std(wood), woodOld: std(woodOld),
    metal: std(metal, { metalness: 0.55, bumpScale: 0.6 }),
    metalRust: std(metalRust, { metalness: 0.3, bumpScale: 0.8 }),
    ground: std(ground, { bumpScale: 1.6 }),
    plaster: std(plaster),
    dark: new THREE.MeshStandardMaterial({ color: 0x14120f, roughness: 0.95 }),
    // distant ruins: dark but light-responsive so moon + fog model them instead
    // of reading as holes in the sky
    silhouette: new THREE.MeshStandardMaterial({
      map: brickDark.map, bumpMap: brickDark.bumpMap, bumpScale: 0.5,
      color: 0x4a4e58, roughness: 0.96,
    }),
  };

  // ---------- helpers ----------
  const boxGeo = new THREE.BoxGeometry(1, 1, 1);
  // Box with world-space UVs (~1 texture repeat per 2m) so textures never stretch
  // across long walls. Face order in BoxGeometry: +x,-x,+y,-y,+z,-z.
  function uvBox(sx, sy, sz, s = 0.5) {
    const g = new THREE.BoxGeometry(sx, sy, sz);
    const uv = g.attributes.uv;
    const scales = [
      [sz * s, sy * s], [sz * s, sy * s],
      [sx * s, sz * s], [sx * s, sz * s],
      [sx * s, sy * s], [sx * s, sy * s],
    ];
    for (let f = 0; f < 6; f++)
      for (let v = 0; v < 4; v++) {
        const i = f * 4 + v;
        uv.setXY(i, uv.getX(i) * scales[f][0], uv.getY(i) * scales[f][1]);
      }
    return g;
  }
  function addCollider(cx, cz, sx, sy, sz, opts = {}) {
    const c = {
      min: V3(cx - sx / 2, opts.y0 ?? 0, cz - sz / 2),
      max: V3(cx + sx / 2, (opts.y0 ?? 0) + sy, cz + sz / 2),
      ...opts.tag,
    };
    W.colliders.push(c);
    return c;
  }
  function addBox(cx, cz, sx, sy, sz, mat, opts = {}) {
    const m = new THREE.Mesh(uvBox(sx, sy, sz), mat);
    m.position.set(cx, (opts.y0 ?? 0) + sy / 2, cz);
    if (opts.rotY) m.rotation.y = opts.rotY;
    m.castShadow = opts.shadow !== false;
    m.receiveShadow = true;
    (opts.parent ?? scene).add(m);
    if (opts.collide !== false) addCollider(cx, cz, sx + (opts.pad ?? 0), sy, sz + (opts.pad ?? 0), opts);
    return m;
  }

  // ---------- battle-damage dressing (broken wall tops, rubble) ----------
  // Own rng stream so the main layout stream stays byte-identical.
  const trng = makeRng(G.seed + 4041);
  const dressParts = new Map(); // material -> [{sx,sy,sz,x,y,z,ry}]
  const partsFor = (mat) => {
    let a = dressParts.get(mat);
    if (!a) dressParts.set(mat, a = []);
    return a;
  };
  // Merge many small boxes into one mesh per material (single draw call).
  // Each part keeps true uvBox texel density; ry = yaw, used for rubble.
  function mergedBoxMesh(parts, mat) {
    const pos = [], nor = [], uvA = [], idx = [];
    for (const p of parts) {
      const g = uvBox(p.sx, p.sy, p.sz);
      const P = g.attributes.position, N = g.attributes.normal, U = g.attributes.uv;
      const base = pos.length / 3;
      const cc = Math.cos(p.ry ?? 0), ss = Math.sin(p.ry ?? 0);
      for (let i = 0; i < P.count; i++) {
        const x = P.getX(i), z = P.getZ(i), nx = N.getX(i), nz = N.getZ(i);
        pos.push(p.x + x * cc + z * ss, p.y + P.getY(i), p.z - x * ss + z * cc);
        nor.push(nx * cc + nz * ss, N.getY(i), -nx * ss + nz * cc);
        uvA.push(U.getX(i), U.getY(i));
      }
      for (let i = 0; i < g.index.count; i++) idx.push(g.index.getX(i) + base);
      g.dispose();
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uvA, 2));
    g.setIndex(idx);
    const m = new THREE.Mesh(g, mat);
    m.castShadow = m.receiveShadow = true;
    m.userData.noBlock = true; // dressing: full-height wall colliders still gate everything
    scene.add(m);
    return m;
  }
  // Ragged top band for a wall segment: stepped chunk columns quantized to
  // brick courses (0.125m) so mortar lines stay continuous with the wall
  // below; level-3 columns rebuild the original top line, level 0 is a bite
  // clean through the band. Jambs / corners stay intact so apertures read
  // built, not crumbled.
  function raggedTop(fixed, a, b, horizontal, h, B, th, mat) {
    const q = (v) => Math.round(v / 0.125) * 0.125;
    const lvlH = [0, q(B * 0.4), q(B * 0.7), B];
    const y0 = h - B;
    let s = a, level = 3;
    while (b - s > 0.05) {
      let cw = Math.min(trng.range(0.45, 0.95), b - s);
      if (b - s - cw < 0.3) cw = b - s; // no sliver columns at segment ends
      let nl;
      if (s - a < 0.55 || b - (s + cw) < 0.55) nl = 3;
      else if (trng() < 0.2) nl = trng.int(0, 3); // sudden deep bite / stub
      else nl = Math.min(3, Math.max(0, level + trng.int(-1, 1)));
      if (nl === 0 && level === 0) nl = 1; // cap the width of full gaps
      level = nl;
      const hh = lvlH[level];
      if (hh > 0.01) {
        const proud = level === 3 ? 0 : trng.range(-0.025, 0.025);
        const dep = level === 3 ? th : th + 0.05;
        partsFor(mat).push(horizontal
          ? { sx: cw, sy: hh, sz: dep, x: s + cw / 2, y: y0 + hh / 2, z: fixed + proud }
          : { sx: dep, sy: hh, sz: cw, x: fixed + proud, y: y0 + hh / 2, z: s + cw / 2 });
      }
      s += cw;
    }
  }
  // Low spill of broken masonry hugging a wall base (visual only, under knee height).
  function rubblePile(cx, cz, mat, n = 6, spread = 0.5) {
    for (let i = 0; i < n; i++) {
      const s = trng.range(0.14, 0.34);
      partsFor(mat).push({
        sx: s * trng.range(1.0, 1.9), sy: s * trng.range(0.5, 0.85), sz: s,
        x: cx + trng.range(-spread, spread),
        y: 0.02 + s * trng.range(0.2, 0.4),
        z: cz + trng.range(-spread, spread),
        ry: trng.range(0, Math.PI),
      });
    }
  }

  // Axis-aligned wall run with optional apertures (windows / door gaps).
  // horizontal=true: run along x at z; else along z at x.
  // ragged > 0 draws full-height segments with a shell-bitten top band of that
  // depth; colliders stay identical to the intact wall (gameplay untouched).
  function wallRun(fixed, from, to, horizontal, h, th, mat, gaps = [], ragged = 0) {
    const segs = [];
    let cur = from;
    const sorted = [...gaps].sort((a, b) => a.at - b.at);
    for (const gset of sorted) {
      const g0 = gset.at - gset.width / 2, g1 = gset.at + gset.width / 2;
      if (g0 > cur) segs.push([cur, g0, null]);
      segs.push([g0, g1, gset]);
      cur = g1;
    }
    if (cur < to) segs.push([cur, to, null]);
    const put = (a, b, y0, sy, collide = true) => {
      const len = b - a, mid = (a + b) / 2;
      if (len <= 0.01 || sy <= 0.01) return null;
      if (ragged > 0 && collide && y0 === 0 && sy === h && len > 2) {
        const cx = horizontal ? mid : fixed, cz = horizontal ? fixed : mid;
        const sx = horizontal ? len : th, sz = horizontal ? th : len;
        addCollider(cx, cz, sx, sy, sz, { y0: 0 }); // same AABB an intact wall gets
        raggedTop(fixed, a, b, horizontal, h, ragged, th, mat);
        return addBox(cx, cz, sx, sy - ragged, sz, mat, { y0: 0, collide: false });
      }
      return horizontal
        ? addBox(mid, fixed, len, sy, th, mat, { y0, collide })
        : addBox(fixed, mid, th, sy, len, mat, { y0, collide });
    };
    for (const [a, b, gap] of segs) {
      if (!gap) { put(a, b, 0, h); continue; }
      if (gap.type === 'door') {
        // lintel above the passage
        put(a, b, 2.3, h - 2.3, false);
        const mid = (a + b) / 2;
        registerDoorGap(gap.door, horizontal ? [mid, fixed] : [fixed, mid], horizontal, gap.width, th);
      } else if (gap.type === 'window') {
        put(a, b, 0, 0.9);              // sill
        put(a, b, 2.2, h - 2.2);        // lintel
        const mid = (a + b) / 2;
        makeWindow(gap.id, horizontal ? [mid, fixed] : [fixed, mid], horizontal, gap, th);
      } else { // plain opening
        put(a, b, 2.3, h - 2.3, false);
      }
    }
  }

  // ---------- windows / barricades ----------
  const plankGeo = new THREE.BoxGeometry(1.9, 0.24, 0.055);
  function makeWindow(id, [x, z], horizontal, gap, th) {
    const dir = V3(0, 0, 0);
    if (horizontal) dir.z = gap.out; else dir.x = gap.out; // outward normal
    const group = new THREE.Group();
    group.position.set(x, 0, z);
    group.rotation.y = horizontal ? (gap.out > 0 ? Math.PI : 0) : (gap.out > 0 ? -Math.PI / 2 : Math.PI / 2);
    scene.add(group);
    // frame
    const frameMat = G.mats.woodOld;
    for (const [fx, fy, fw, fh] of [[-0.85, 1.55, 0.12, 1.4], [0.85, 1.55, 0.12, 1.4], [0, 0.86, 1.85, 0.1], [0, 2.24, 1.85, 0.1]]) {
      const f = new THREE.Mesh(boxGeo, frameMat);
      f.scale.set(fw, fh, th + 0.06);
      f.position.set(fx, fy, 0);
      f.castShadow = f.receiveShadow = true;
      group.add(f);
    }
    // dim warm lamp above each barricade (interior side) — lights incoming zombies
    const wl = new THREE.PointLight(0xff9a45, 5, 6.5, 2);
    wl.position.set(0.72, 2.14, 0.55);
    group.add(wl);
    const wlb = new THREE.Mesh(new THREE.SphereGeometry(0.042, 6, 5), new THREE.MeshBasicMaterial({ color: 0xffc890 }));
    wlb.position.copy(wl.position);
    group.add(wlb);
    W.lamps.push({ light: wl, mesh: wlb, base: 5, flicker: true });

    const win = {
      id, pos: V3(x, 0, z), dir,
      inside: V3(x - dir.x * 1.6, 0, z - dir.z * 1.6),
      outside: V3(x + dir.x * 2.6, 0, z + dir.z * 2.6),
      spawn: V3(x + dir.x * 9, 0, z + dir.z * 9),
      planks: [], zone: gap.zone, group, tearCd: 0,
    };
    for (let i = 0; i < 5; i++) addPlank(win, i);
    // collider spanning the aperture keeps everyone from walking through the wall;
    // zombies vault via scripted motion, players never pass.
    addCollider(x, z, horizontal ? 1.9 : th, 2.4, horizontal ? th : 1.9, { y0: 0 });
    W.windows.push(win);

    // rebuild interactable
    W.interactables.push({
      id: 'win_' + id, pos: win.inside.clone().setY(1.2), radius: 2.2,
      getLabel: (G) => {
        if (!W.zones[win.zone]) return null;
        if (win.planks.every(p => p.alive)) return null;
        return 'Hold <b>F</b> to rebuild barricade <b>[+10]</b>';
      },
      hold: 0.5,
      use: (G) => {
        const dead = win.planks.find(p => !p.alive);
        if (!dead) return;
        dead.alive = true; dead.hp = 1;
        dead.mesh.visible = true;
        dead.mesh.position.copy(dead.home.position);
        dead.mesh.rotation.copy(dead.home.rotation);
        G.events.emit('plankRebuilt', win);
        G.addPoints?.(10, 'board');
      },
    });
  }
  function addPlank(win, i) {
    const m = new THREE.Mesh(plankGeo, G.mats.wood);
    m.userData.noBlock = true; // bullets pass through barricades (COD rule)
    m.position.set(rng.range(-0.1, 0.1), 1.05 + i * 0.26, 0.18);
    m.rotation.z = rng.range(-0.16, 0.16);
    m.rotation.y = rng.range(-0.05, 0.05);
    m.castShadow = m.receiveShadow = true;
    win.group.add(m);
    win.planks.push({ mesh: m, alive: true, hp: 1, home: { position: m.position.clone(), rotation: m.rotation.clone() } });
  }

  // ---------- doors (purchasable debris) ----------
  const doorDefs = {
    B: { cost: 750, zone: 'B', label: 'Clear Debris' },
    C: { cost: 1000, zone: 'C', label: 'Open Gate' },
    D: { cost: 1250, zone: 'D', label: 'Open Gate' },
    D2: { cost: 1250, zone: 'D', label: 'Clear Debris' },
  };
  function registerDoorGap(id, [x, z], horizontal, width, th) {
    const def = doorDefs[id];
    const meshes = [];
    const cols = [];
    // pile of planks + rubble blocking the gap
    const n = 7;
    for (let i = 0; i < n; i++) {
      const p = new THREE.Mesh(plankGeo, i % 3 === 0 ? G.mats.woodOld : G.mats.wood);
      const along = rng.range(-width / 4, width / 4);
      p.position.set(x + (horizontal ? along : rng.range(-0.1, 0.1)), 0.3 + i * 0.3, z + (horizontal ? rng.range(-0.1, 0.1) : along));
      p.rotation.set(rng.range(-0.2, 0.2), horizontal ? rng.range(-0.3, 0.3) : Math.PI / 2 + rng.range(-0.3, 0.3), rng.range(-0.25, 0.25));
      p.scale.setScalar(rng.range(0.85, 1.15));
      p.castShadow = p.receiveShadow = true;
      scene.add(p); meshes.push(p);
    }
    const rub = new THREE.Mesh(boxGeo, G.mats.dark);
    rub.scale.set(horizontal ? width : 0.8, 0.5, horizontal ? 0.8 : width);
    rub.position.set(x, 0.25, z);
    rub.castShadow = rub.receiveShadow = true;
    scene.add(rub); meshes.push(rub);
    cols.push(addCollider(x, z, horizontal ? width : th + 0.2, 2.4, horizontal ? th + 0.2 : width, { tag: { door: id } }));
    W.doors[id] = { ...def, id, meshes, colliders: cols, open: false, pos: V3(x, 1.1, z) };
    W.interactables.push({
      id: 'door_' + id, pos: V3(x, 1.1, z), radius: 2.4,
      getLabel: (G) => W.doors[id].open ? null : `<b>F</b> ${def.label} <b>[${def.cost}]</b>`,
      use: (G) => {
        const d = W.doors[id];
        if (d.open || !G.spendPoints?.(def.cost)) return;
        d.open = true;
        W.zones[def.zone] = true;
        for (const c of d.colliders) W.colliders.splice(W.colliders.indexOf(c), 1);
        for (const m of d.meshes) m.userData.doorFall = { t: 0 };
        bakeNav();
        G.events.emit('doorOpened', d);
      },
    });
  }

  // ---------- ground & sky ----------
  const groundMesh = new THREE.Mesh(new THREE.PlaneGeometry(160, 160, 1, 1), M.ground);
  groundMesh.rotation.x = -Math.PI / 2;
  groundMesh.receiveShadow = true;
  scene.add(groundMesh);

  // Outer terrain: at overview distances the mud map's big stains + puddle
  // spec smear into giant blobs. Cover everything outside the walls with a
  // calmer copy — the same image flattened toward its own average tone (so
  // the tone matches at the seam, which hides under the wall lines).
  {
    const src = ground.map.image;
    const av = document.createElement('canvas');
    av.width = av.height = 16;
    const avx = av.getContext('2d');
    avx.drawImage(src, 0, 0, 16, 16);
    const d = avx.getImageData(0, 0, 16, 16).data;
    let ar = 0, ag = 0, ab = 0;
    for (let i = 0; i < d.length; i += 4) { ar += d[i]; ag += d[i + 1]; ab += d[i + 2]; }
    const np = d.length / 4;
    const calm = document.createElement('canvas');
    calm.width = calm.height = 512; // half-res copy also mips softer
    const cx2 = calm.getContext('2d');
    cx2.drawImage(src, 0, 0, 512, 512);
    cx2.fillStyle = `rgba(${Math.round(ar / np)},${Math.round(ag / np)},${Math.round(ab / np)},0.62)`;
    cx2.fillRect(0, 0, 512, 512);
    const calmMap = new THREE.CanvasTexture(calm);
    calmMap.wrapS = calmMap.wrapT = THREE.RepeatWrapping;
    calmMap.colorSpace = THREE.SRGBColorSpace;
    calmMap.anisotropy = 2; // low aniso = soft at grazing angles, not streaky
    const calmBump = ground.bumpMap.clone();
    calmBump.repeat.set(1, 1);
    calmBump.needsUpdate = true;
    const shp = new THREE.Shape().moveTo(-80, -80).lineTo(80, -80).lineTo(80, 80).lineTo(-80, 80);
    const holePath = new THREE.Path().moveTo(-26, -20).lineTo(26, -20).lineTo(26, 18).lineTo(-26, 18);
    shp.holes.push(holePath); // hole edges sit exactly on the wall centerlines
    const ringGeo = new THREE.ShapeGeometry(shp);
    const ruv = ringGeo.attributes.uv, rk = 26 / 160; // match inner tiling scale+phase
    for (let i = 0; i < ruv.count; i++) ruv.setXY(i, (ruv.getX(i) + 80) * rk, (ruv.getY(i) + 80) * rk);
    const ring = new THREE.Mesh(ringGeo, new THREE.MeshStandardMaterial({
      map: calmMap, bumpMap: calmBump, bumpScale: 1.1, roughness: 1, // no puddle spec out here
      polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1,
    }));
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.04;
    ring.receiveShadow = true;
    scene.add(ring);
  }

  // house floor slab
  const slab = new THREE.Mesh(uvBox(28.4, 0.12, 16.4), M.concFloor);
  slab.position.set(0, 0.055, -10);
  slab.receiveShadow = true;
  scene.add(slab);

  buildSky(G);

  // ---------- perimeter ----------
  const TH = 0.6, PH = 3.4;
  wallRun(-18, -26, 26, true, PH, TH, M.brick, [
    { at: 8, width: 1.9, type: 'window', id: 'N1', out: -1, zone: 'A' },
    { at: -6, width: 1.9, type: 'window', id: 'N2', out: -1, zone: 'B' },
    { at: 20, width: 1.9, type: 'window', id: 'N3', out: -1, zone: 'C' },
  ], 0.65);
  wallRun(20, -26, 26, true, PH, TH, M.brickDark, [
    { at: -7, width: 1.9, type: 'window', id: 'S1', out: 1, zone: 'A' },
    { at: 7, width: 1.9, type: 'window', id: 'S2', out: 1, zone: 'A' },
  ], 0.65);
  wallRun(26, -18, 20, false, PH, TH, M.brick, [
    { at: 0, width: 1.9, type: 'window', id: 'E1', out: 1, zone: 'C' },
  ], 0.65);
  wallRun(-26, -18, 20, false, PH, TH, M.brickDark, [
    { at: 0, width: 1.9, type: 'window', id: 'W1', out: -1, zone: 'D' },
  ], 0.65);
  // ruined parapet chunks, half-sunk into the ragged band so they read as
  // still-attached stubs above the broken line (never floaters over a bite)
  for (let i = 0; i < 34; i++) {
    const side = rng.int(0, 3);
    const t = rng.range(-24, 24);
    const [px, pz] = side === 0 ? [t, -18] : side === 1 ? [t, 20] : side === 2 ? [26, t * 0.7] : [-26, t * 0.7];
    addBox(px, pz, rng.range(0.5, 1.6), rng.range(0.2, 0.75), TH + 0.05, M.brickDark, { y0: PH - 0.55, collide: false });
  }

  // ---------- house ----------
  const HH = 3.0;
  wallRun(-2, -14, 14, true, HH, 0.4, M.plaster, [                       // south face
    { at: 8, width: 2.2, type: 'gap' },  // open doorway
  ], 0.625);
  wallRun(2, -18, -2, false, HH, 0.4, M.plaster, [                       // dividing wall
    { at: -10, width: 2.2, type: 'door', door: 'B' },
  ]);
  wallRun(14, -18, -2, false, HH, 0.4, M.brick, [], 0.5);                // east face
  wallRun(-14, -18, -2, false, HH, 0.4, M.brick, [                       // west face
    { at: -10, width: 2.2, type: 'door', door: 'D2' },
  ], 0.5);
  // roof: two slabs with a collapse hole over room1
  const roof1 = new THREE.Mesh(new THREE.BoxGeometry(11, 0.25, 16.6), M.woodOld);
  roof1.position.set(-8.4, HH + 0.13, -10); roof1.castShadow = roof1.receiveShadow = true;
  scene.add(roof1);
  const roof2 = new THREE.Mesh(new THREE.BoxGeometry(7, 0.25, 16.6), M.woodOld);
  roof2.position.set(10.4, HH + 0.13, -10); roof2.castShadow = roof2.receiveShadow = true;
  scene.add(roof2);
  // exposed beams across the hole
  for (let i = 0; i < 4; i++) {
    const b = new THREE.Mesh(boxGeo, M.woodOld);
    b.scale.set(0.18, 0.22, 16.4);
    b.position.set(-2.6 + i * 2.4, HH + 0.1, -10);
    b.rotation.z = rng.range(-0.04, 0.04);
    b.castShadow = true;
    scene.add(b);
  }
  // pitched gable panels + ridge caps over the flat slabs so the roofline reads
  // as houses (not boxes) from the courtyard and the high overview. Dressing
  // only: sits above the slabs, nothing collides, interiors unchanged.
  // weathered slate — pale enough that moonlit slopes read from the overview
  const slateMat = new THREE.MeshStandardMaterial({
    map: M.conc.map, bumpMap: M.conc.bumpMap, bumpScale: 0.7,
    roughnessMap: M.conc.roughnessMap, roughness: 0.9, color: 0x99a0a9,
  });
  function gable(cx, halfW, rise, zLen) {
    const ang = Math.atan2(rise, halfW), slope = Math.hypot(halfW, rise);
    for (const s of [-1, 1]) {
      const p = new THREE.Mesh(uvBox(slope, 0.14, zLen), slateMat);
      p.position.set(cx + s * halfW / 2, HH + 0.26 + rise / 2, -10);
      p.rotation.z = -s * ang;
      p.castShadow = p.receiveShadow = true;
      p.userData.noBlock = true;
      scene.add(p);
    }
    const cap = new THREE.Mesh(uvBox(0.32, 0.12, zLen), M.dark);
    cap.position.set(cx, HH + 0.28 + rise, -10);
    cap.castShadow = cap.receiveShadow = true;
    cap.userData.noBlock = true;
    scene.add(cap);
  }
  gable(-8.4, 5.5, 1.2, 16.6);   // room2 roof
  gable(10.4, 3.5, 0.8, 16.6);   // room1 roof
  // brick chimneys — silhouette landmarks on the roofline
  for (const [cx, cz, h] of [[-12.7, -15.4, 2.6], [13.0, -4.3, 2.4]]) {
    addBox(cx, cz, 1.0, h, 1.0, M.brickDark, { y0: 2.85, collide: false });
    addBox(cx, cz, 1.24, 0.14, 1.24, M.dark, { y0: 2.85 + h, collide: false, shadow: false });
  }
  // collapsed rafters fallen across the roof hole
  for (const [rx, rz, len, ry, rt] of [[2.0, -12.4, 4.6, 0.38, 0.16], [1.4, -6.2, 4.2, -0.45, -0.12]]) {
    const raf = new THREE.Mesh(uvBox(len, 0.16, 0.2), M.woodOld);
    raf.position.set(rx, HH + 0.4, rz);
    raf.rotation.set(0, ry, rt);
    raf.castShadow = raf.receiveShadow = true;
    raf.userData.noBlock = true;
    scene.add(raf);
  }

  // courtyard flank walls (house to south wall)
  wallRun(14, -2, 6, false, 2.6, TH, M.brick, [], 0.475);
  wallRun(14, 10, 20, false, 2.6, TH, M.brick, [], 0.475);
  wallRun(-14, -2, 6, false, 2.6, TH, M.brickDark, [], 0.475);
  wallRun(-14, 10, 20, false, 2.6, TH, M.brickDark, [], 0.475);
  // gates in the flanks
  registerDoorGap('C', [14, 8], false, 4, TH);
  registerDoorGap('D', [-14, 8], false, 4, TH);
  // gate posts
  addBox(14, 5.8, 0.8, 3, 0.8, M.conc); addBox(14, 10.2, 0.8, 3, 0.8, M.conc);
  addBox(-14, 5.8, 0.8, 3, 0.8, M.conc); addBox(-14, 10.2, 0.8, 3, 0.8, M.conc);

  // spill rubble where the walls are bitten worst (visual only, hugs bases)
  rubblePile(-8.6, -1.32, M.brickDark, 7, 0.6);   // under the big shell bite
  rubblePile(12.9, 3.9, M.brick, 6, 0.5);         // east flank base
  rubblePile(-13.35, 17.6, M.brickDark, 6, 0.5);  // west flank base
  rubblePile(25.25, -2.2, M.brick, 6, 0.5);       // alley, east perimeter base
  rubblePile(-9.2, 19.25, M.brickDark, 5, 0.45);  // south wall base
  rubblePile(5.5, -18.85, M.brick, 7, 0.6);       // outside north wall
  rubblePile(-17.5, -18.95, M.brick, 6, 0.55);    // outside north wall, west
  rubblePile(26.85, 13.5, M.brick, 6, 0.55);      // outside east wall
  // build the merged damage batches (one mesh per material)
  for (const [dMat, dPrts] of dressParts) mergedBoxMesh(dPrts, dMat);

  // shell-hole bites in the plaster south face: a stepped cluster of dark
  // recess slabs (broken outline, no neat rectangle) with moonlit brick
  // sitting flush inside — spaced off the tiled peel pattern's rhythm
  function shellBite(x, y, w, h) {
    const slabs = [ // [dx, dy, sw, sh, dz] — offsets break the silhouette
      [0, 0, w, h, -1.816],
      [-w * 0.34, h * 0.2, w * 0.52, h * 0.55, -1.818],
      [w * 0.31, -h * 0.24, w * 0.58, h * 0.5, -1.814],
    ];
    const parts = [];
    for (const [dx, dy, sw, sh, dz] of slabs) {
      const m = new THREE.Mesh(uvBox(sw, sh, 0.05), M.dark);
      m.position.set(x + dx, y + dy, dz);
      parts.push(m);
    }
    const br = new THREE.Mesh(uvBox(w * 0.55, h * 0.52, 0.08), M.brick);
    br.position.set(x + w * 0.04, y - h * 0.05, -1.827);
    parts.push(br);
    for (const m of parts) {
      m.castShadow = false; m.receiveShadow = true; m.userData.noBlock = true;
      scene.add(m);
    }
  }
  shellBite(-8.8, 1.75, 1.35, 0.95);
  shellBite(3.3, 1.3, 0.95, 0.7);
  shellBite(12.1, 2.2, 0.7, 0.55);

  // ---------- props ----------
  // sandbags (courtyard defensive ring)
  const bagGeo = new THREE.SphereGeometry(0.5, 8, 6);
  const bagMat = new THREE.MeshStandardMaterial({ color: 0x5a5240, roughness: 1 });
  function sandbagWall(cx, cz, len, rotY) {
    const gg = new THREE.Group();
    gg.position.set(cx, 0, cz); gg.rotation.y = rotY;
    for (let r = 0; r < 2; r++) for (let i = 0; i < len; i++) {
      const b = new THREE.Mesh(bagGeo, bagMat);
      b.scale.set(1, 0.42, 0.62);
      b.position.set((i - len / 2 + 0.5 + (r % 2) * 0.3) * 0.85, 0.2 + r * 0.36, 0);
      b.rotation.y = rng.range(-0.2, 0.2);
      b.castShadow = b.receiveShadow = true;
      gg.add(b);
    }
    scene.add(gg);
    const ca = Math.abs(Math.cos(rotY)), sa = Math.abs(Math.sin(rotY));
    addCollider(cx, cz, len * 0.85 * ca + 0.9 * sa, 0.85, len * 0.85 * sa + 0.9 * ca);
  }
  sandbagWall(-5, 8, 5, 0.15);
  sandbagWall(6, 14, 4, -1.3);

  // crates & barrels
  function crate(cx, cz, s = 1, rotY = 0) { return addBox(cx, cz, 1.1 * s, 1.1 * s, 1.1 * s, M.wood, { rotY }); }
  crate(-11, 2, 1, 0.4); crate(-11.5, 3.3, 0.8, 0.9); crate(-11, 2, 0.7, 0.2).position.y = 1.45;
  crate(11, -16, 1, 0.2); crate(18, -12, 1, 0.5); crate(19.2, -12.4, 0.85, 1.1);
  crate(-17, -6, 1, 0.3);
  const barrelGeo = new THREE.CylinderGeometry(0.42, 0.42, 1.1, 14);
  function barrel(cx, cz, mat = M.metalRust, y0 = 0, tip = false) {
    const b = new THREE.Mesh(barrelGeo, mat);
    b.position.set(cx, y0 + (tip ? 0.42 : 0.55), cz);
    if (tip) b.rotation.z = Math.PI / 2;
    b.castShadow = b.receiveShadow = true;
    scene.add(b);
    addCollider(cx, cz, 0.9, 1.1, 0.9);
    return b;
  }
  barrel(12.5, 17); barrel(11.6, 17.4); barrel(24, 10, M.metal); barrel(-24, -10, M.metalRust, 0, true);

  // fire barrels (fx.js attaches flames + light at W.fires)
  function fireBarrel(cx, cz) {
    const b = barrel(cx, cz, M.metalRust);
    b.material = M.metalRust;
    W.fires.push({ pos: V3(cx, 1.15, cz), r: 0.34 });
  }
  fireBarrel(-10, 15.5);
  fireBarrel(22, -14.5);

  // truck wreck (alley)
  (function truck() {
    const t = new THREE.Group();
    t.position.set(20, 0, 5); t.rotation.y = 0.12;
    const body = new THREE.Mesh(boxGeo, M.metalRust); body.scale.set(2.4, 1.5, 6.4); body.position.y = 1.15; t.add(body);
    const cab = new THREE.Mesh(boxGeo, M.metalRust); cab.scale.set(2.4, 1.25, 1.8); cab.position.set(0, 2.3, -2.0); t.add(cab);
    const bed = new THREE.Mesh(boxGeo, M.dark); bed.scale.set(2.2, 0.8, 3.6); bed.position.set(0, 1.9, 1.3); t.add(bed);
    const wheelGeo = new THREE.CylinderGeometry(0.55, 0.55, 0.4, 12);
    for (const [wx, wz] of [[-1.25, -2.2], [1.25, -2.2], [-1.25, 1.8], [1.25, 1.8]]) {
      const w = new THREE.Mesh(wheelGeo, M.dark);
      w.rotation.z = Math.PI / 2; w.position.set(wx, 0.5, wz); t.add(w);
    }
    t.traverse(o => { o.castShadow = o.receiveShadow = true; });
    scene.add(t);
    addCollider(20, 5, 3.2, 3, 7);
    W.eePads.truck = V3(20, 0.28, 8.6);
  })();

  // anti-tank hedgehog
  (function hedgehog(cx, cz) {
    const g = new THREE.Group(); g.position.set(cx, 0, cz);
    for (let i = 0; i < 3; i++) {
      const beam = new THREE.Mesh(boxGeo, M.metalRust);
      beam.scale.set(0.22, 2.4, 0.22);
      beam.rotation.set(rng.range(0.6, 1) * (i === 0 ? 1 : -0.7), i * 2.1, 0.5);
      beam.position.y = 0.6; beam.castShadow = true;
      g.add(beam);
    }
    scene.add(g);
    addCollider(cx, cz, 1.6, 1.4, 1.6);
  })(4, 16);

  // graveyard: headstones + mounds (zombie spawns)
  // weathered dark stone (conc map tinted down — bright speckle reads wrong at night)
  const graveMat = new THREE.MeshStandardMaterial({
    map: M.conc.map, bumpMap: M.conc.bumpMap, bumpScale: 1.3, roughness: 0.95, color: 0x75766a,
  });
  const moundMat = new THREE.MeshStandardMaterial({ color: 0x3a2b1a, roughness: 1 });
  const moundGeo = new THREE.SphereGeometry(0.9, 10, 6);
  for (let gx = 0; gx < 3; gx++) for (let gz = 0; gz < 3; gz++) {
    const cx = -23.5 + gx * 3.4, cz = -4 + gz * 5.4;
    if (gx === 0 && gz === 2) continue; // leave room near jugg
    const hs = addBox(cx, cz - 0.8, 0.9, rng.range(0.9, 1.3), 0.18, graveMat, { rotY: rng.range(-0.12, 0.12) });
    hs.position.y -= rng.range(0, 0.15); // sunken, crooked
    const mound = new THREE.Mesh(moundGeo, moundMat);
    mound.scale.set(1, 0.26, 1.5);
    mound.position.set(cx, 0.03, cz + 0.4);
    mound.receiveShadow = true;
    scene.add(mound);
    W.graves.push(V3(cx, 0, cz + 0.4));
  }
  // dead tree
  (function tree(cx, cz) {
    const g = new THREE.Group(); g.position.set(cx, 0, cz);
    const trunkMat = new THREE.MeshStandardMaterial({ color: 0x241c14, roughness: 1 });
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.4, 4.4, 8), trunkMat);
    trunk.position.y = 2.2; trunk.castShadow = true; g.add(trunk);
    let a = 0.4;
    for (let i = 0; i < 5; i++) {
      const br = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.13, rng.range(1.6, 2.8), 6), trunkMat);
      br.position.y = rng.range(2.4, 4.2);
      br.rotation.set(rng.range(-0.9, 0.9), a, rng.range(0.5, 1.2));
      a += 2.4;
      br.castShadow = true; g.add(br);
    }
    scene.add(g);
    addCollider(cx, cz, 0.8, 4, 0.8);
    W.eePads.tree = V3(cx, 3.4, cz);
  })(-18, 12);

  // power shed (graveyard)
  addBox(-22, -15.2, 4.2, 2.7, 0.25, M.woodOld);                  // back wall (north)
  addBox(-24.05, -13.4, 0.25, 2.7, 3.8, M.woodOld);               // west wall
  addBox(-19.95, -14.2, 0.25, 2.7, 2.2, M.woodOld);               // east wall partial (entry gap south)
  const shedRoof = new THREE.Mesh(new THREE.BoxGeometry(4.8, 0.2, 4.4), M.woodOld);
  shedRoof.position.set(-22, 2.75, -13.3); shedRoof.rotation.z = 0.08;
  shedRoof.castShadow = shedRoof.receiveShadow = true; scene.add(shedRoof);
  W.eePads.shed = V3(-22.6, 1.5, -14.6);

  // power switch (inside shed)
  const switchPanel = addBox(-22, -14.9, 1.0, 1.6, 0.2, M.metal, { y0: 0.6, collide: false });
  const lever = new THREE.Mesh(boxGeo, new THREE.MeshStandardMaterial({ color: 0xaa2222, roughness: 0.5, metalness: 0.4 }));
  lever.scale.set(0.09, 0.5, 0.09);
  lever.position.set(-22, 1.35, -14.72);
  lever.rotation.x = 0.8;
  scene.add(lever);
  W.interactables.push({
    id: 'power', pos: V3(-22, 1.3, -14.6), radius: 2.0,
    getLabel: () => W.powerOn ? null : '<b>F</b> Restore Power',
    use: (G) => { if (!W.powerOn) setPower(G, true); lever.rotation.x = -0.8; },
  });

  // ---------- static dressing (graveyard + alley street) ----------
  // Own rng stream: existing layout stays byte-identical, everything below is
  // non-gameplay set dressing (no spawn pads, windows, machines or doors move).
  const drng = makeRng(G.seed + 777);

  // ground patches — zone value separation that reads from the high overview:
  // dark dug-earth burial plot in the graveyard, pale paved lane down the alley.
  function groundPatch(cx, cz, sx, sz, tset, tint, opts = {}) {
    const g = new THREE.PlaneGeometry(sx, sz);
    const uv = g.attributes.uv;
    const us = opts.uvScale ?? 0.5; // repeats/metre; ground tex bakes its own repeat -> pass 1/160
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * sx * us, uv.getY(i) * sz * us);
    const p = new THREE.Mesh(g, new THREE.MeshStandardMaterial({
      map: tset.map, bumpMap: tset.bumpMap, bumpScale: opts.bump ?? 1.2,
      roughnessMap: tset.roughnessMap, roughness: 1, color: tint,
      polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1,
    }));
    p.rotation.x = -Math.PI / 2;
    if (opts.rotZ) p.rotation.z = opts.rotZ;
    p.position.set(cx, opts.y ?? 0.012, cz);
    p.receiveShadow = true;
    p.userData.noBlock = true;
    scene.add(p);
    return p;
  }
  groundPatch(-20.3, 1.2, 10.2, 15.6, ground, 0x695a48, { uvScale: 1 / 160, bump: 1.6, rotZ: 0.02 });
  groundPatch(20, 0.8, 5.4, 36.6, concFloor, 0xd2d2ca, { uvScale: 0.5, bump: 0.8 });

  // broken wrought-iron cemetery fence: leaning pickets (one InstancedMesh) with
  // top rails; the gaps are aimed so sightlines and grave paths stay clear.
  const picketGeo = new THREE.BoxGeometry(0.05, 1, 0.05);
  picketGeo.translate(0, 0.5, 0); // pivot at the ground
  const fenceRuns = [
    { x0: -17.1, z0: 5.2, x1: -17.1, z1: -2.6, gap: [0.06, 0.27] },  // east edge of the plot
    { x0: -25.0, z0: -6.7, x1: -17.5, z1: -6.7, gap: [0.45, 0.64] }, // north edge, collapsed middle
  ];
  const dummy = new THREE.Object3D();
  const picketMats = [];
  for (const run of fenceRuns) {
    const len = Math.hypot(run.x1 - run.x0, run.z1 - run.z0);
    const n = Math.round(len / 0.42);
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      if (t > run.gap[0] && t < run.gap[1]) continue; // broken stretch
      const edge = Math.min(Math.abs(t - run.gap[0]), Math.abs(t - run.gap[1]));
      const wob = edge < 0.08 ? 0.22 : 0.08; // pickets lean harder near the break
      dummy.position.set(
        run.x0 + (run.x1 - run.x0) * t + drng.range(-0.03, 0.03), 0,
        run.z0 + (run.z1 - run.z0) * t + drng.range(-0.03, 0.03));
      dummy.rotation.set(drng.range(-wob, wob), drng.range(-0.2, 0.2), drng.range(-wob, wob));
      dummy.scale.set(1, drng.range(0.74, 0.98), 1);
      dummy.updateMatrix();
      picketMats.push(dummy.matrix.clone());
    }
  }
  const pickets = new THREE.InstancedMesh(picketGeo, M.metalRust, picketMats.length);
  picketMats.forEach((m, i) => pickets.setMatrixAt(i, m));
  pickets.castShadow = pickets.receiveShadow = true;
  pickets.frustumCulled = false; // instance bounds spread wider than the base geo
  scene.add(pickets);
  // rails (skip the broken stretch; one snapped piece dips to the ground)
  function rail(cx, cz, len, horizontal, y, sag = 0) {
    const r = new THREE.Mesh(uvBox(horizontal ? len : 0.05, 0.06, horizontal ? 0.05 : len), M.metalRust);
    r.position.set(cx, y, cz);
    r.rotation.z = horizontal ? sag : 0;
    r.rotation.x = horizontal ? 0 : sag;
    r.castShadow = r.receiveShadow = true;
    scene.add(r);
    return r;
  }
  rail(-17.1, 5.0, 0.5, false, 0.72, 0.05);                // run1 stub before the gap
  rail(-17.1, 0.25, 5.7, false, 0.7, -0.02);               // run1 long stretch
  rail(-17.14, 3.6, 1.3, false, 0.42, 0.55);               // snapped piece dipping into the gap
  rail(-23.3, -6.7, 3.4, true, 0.7, 0.03);                 // run2 west stretch
  rail(-18.85, -6.7, 2.7, true, 0.68, -0.04);              // run2 east stretch
  const fallenRail = rail(-20.9, -6.25, 1.6, true, 0.05, 0.02);
  fallenRail.rotation.y = 0.5;                             // torn-out section on the ground

  // leaning dead tree over the north fence — silhouettes above the west wall
  (function leaningTree(cx, cz) {
    const g = new THREE.Group();
    g.position.set(cx, 0, cz);
    g.rotation.set(-0.06, 0.9, -0.34); // heavy lean east, over the graves
    const tm = new THREE.MeshStandardMaterial({ color: 0x221a12, roughness: 1 });
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.38, 4.8, 7), tm);
    trunk.position.y = 2.4; trunk.castShadow = true; g.add(trunk);
    for (let i = 0; i < 5; i++) {
      const br = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.1, drng.range(1.5, 2.5), 5), tm);
      br.position.y = drng.range(2.7, 4.4);
      br.rotation.set(drng.range(-0.8, 0.8), i * 1.7, drng.range(0.5, 1.1));
      br.castShadow = true; g.add(br);
    }
    scene.add(g);
    addCollider(cx, cz, 0.7, 3, 0.7);
  })(-24.5, -9.6);

  // crypt: raised stone tomb against the west wall, lid shoved askew
  (function crypt(cx, cz) {
    addBox(cx, cz, 1.15, 0.6, 2.3, graveMat);
    const lid = new THREE.Mesh(uvBox(1.3, 0.14, 2.45), graveMat);
    lid.position.set(cx + 0.09, 0.71, cz - 0.06);
    lid.rotation.set(0.03, 0.05, 0.06);
    lid.castShadow = lid.receiveShadow = true; scene.add(lid);
    const chunk = new THREE.Mesh(uvBox(0.5, 0.13, 0.6), graveMat);
    chunk.position.set(cx + 0.78, 0.06, cz + 1.28);
    chunk.rotation.set(0.06, 0.5, 0.12);
    chunk.castShadow = chunk.receiveShadow = true; scene.add(chunk);
    // memorial candle on the lid — small warm accent for the empty left frame
    const cl = new THREE.PointLight(0xff9448, 2.6, 5.5, 2);
    cl.position.set(cx + 0.1, 1.0, cz - 0.75);
    scene.add(cl);
    const cm = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.045, 0.12, 6),
      new THREE.MeshBasicMaterial({ color: 0xffc890 }));
    cm.position.set(cx + 0.1, 0.84, cz - 0.75);
    scene.add(cm);
    W.lamps.push({ light: cl, mesh: cm, base: 2.6, flicker: true });
  })(-24.45, 4.4);

  // toppled headstone + wrought-iron cross markers between the rows
  const fallenStone = new THREE.Mesh(uvBox(0.85, 1.1, 0.16), graveMat);
  fallenStone.position.set(-18.7, 0.14, -0.7);
  fallenStone.rotation.set(-Math.PI / 2 + 0.09, 0.35, 0);
  fallenStone.castShadow = fallenStone.receiveShadow = true;
  scene.add(fallenStone);
  function ironCross(cx, cz, lean, ry) {
    const g = new THREE.Group();
    g.position.set(cx, 0, cz);
    g.rotation.set(0.05, ry, lean);
    const v = new THREE.Mesh(uvBox(0.08, 1.05, 0.08), M.metalRust); v.position.y = 0.52; g.add(v);
    const h = new THREE.Mesh(uvBox(0.52, 0.08, 0.08), M.metalRust); h.position.y = 0.74; g.add(h);
    g.traverse(o => { o.castShadow = o.receiveShadow = true; });
    scene.add(g);
  }
  ironCross(-22.4, -1.3, 0.12, 0.5);
  ironCross(-18.3, -4.9, -0.18, -0.3);

  // ---------- lighting ----------
  const moon = new THREE.DirectionalLight(0x9fb4d8, 3.4);
  moon.position.set(-30, 42, 30);
  G.moonBase = 3.4;
  moon.castShadow = true;
  moon.shadow.mapSize.set(2048, 2048);
  moon.shadow.camera.left = -42; moon.shadow.camera.right = 42;
  moon.shadow.camera.top = 42; moon.shadow.camera.bottom = -42;
  moon.shadow.camera.far = 130;
  moon.shadow.bias = -0.0007;
  moon.shadow.normalBias = 0.5;
  scene.add(moon);
  G.moon = moon;
  scene.add(new THREE.HemisphereLight(0x33445e, 0x1c150e, 1.05));
  const amb = new THREE.AmbientLight(0x252a38, 0.55);
  scene.add(amb);
  // faint sky-bounce fill from the opposite side (fake GI so moon-backfaced
  // surfaces don't crush to black)
  const fill = new THREE.DirectionalLight(0x2a3850, 0.8);
  fill.position.set(28, 30, 30);
  scene.add(fill);
  // main.js seeds FogExp2 at 0.026 — that density buries the far half of the map
  // from any raised angle (overview/title). Thin it: night murk stays, forms read.
  if (scene.fog) scene.fog.density = 0.016;

  // interior hanging bulbs (always on, flickery warm)
  function bulb(cx, cy, cz, color = 0xffb46a, intensity = 26) {
    const l = new THREE.PointLight(color, intensity, 18, 2);
    l.position.set(cx, cy, cz);
    scene.add(l);
    const cord = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, 3 - cy + 0.1, 4), M.dark);
    cord.position.set(cx, (3 + cy) / 2, cz); scene.add(cord);
    const bm = new THREE.Mesh(new THREE.SphereGeometry(0.07, 8, 6), new THREE.MeshBasicMaterial({ color: 0xffd9a0 }));
    bm.position.set(cx, cy, cz); scene.add(bm);
    W.lamps.push({ light: l, mesh: bm, base: intensity, flicker: true });
    return l;
  }
  bulb(8, 2.55, -10);
  bulb(-6, 2.55, -10);

  // exterior lamp posts (off until power)
  function lampPost(cx, cz) {
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.12, 4.4, 8), M.metal);
    pole.position.set(cx, 2.2, cz); pole.castShadow = true; scene.add(pole);
    const arm = new THREE.Mesh(boxGeo, M.metal); arm.scale.set(1.1, 0.08, 0.08);
    arm.position.set(cx + 0.5, 4.35, cz); scene.add(arm);
    // dim gas glow pre-power so lamps never read as dead props; power brightens them
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.12, 8, 6), new THREE.MeshBasicMaterial({ color: 0x8a6a34 }));
    head.position.set(cx + 1, 4.28, cz); scene.add(head);
    const l = new THREE.PointLight(0xffc878, 2.2, 15, 2);
    l.position.set(cx + 1, 4.1, cz);
    scene.add(l);
    addCollider(cx, cz, 0.35, 4.4, 0.35);
    W.powerLights.push({ light: l, mesh: head, on: 9, off: 2.2, headLit: 0xffd890, headDim: 0x8a6a34 });
  }
  lampPost(-2, 7);
  lampPost(-20, 2);
  lampPost(21, 12);

  // ---------- distant environment (outside walls, in fog) ----------
  for (let i = 0; i < 14; i++) {
    // draw every random first so the stream stays fixed, then place (or skip)
    const a = (i / 14) * Math.PI * 2 + rng.range(-0.2, 0.2);
    const d = rng.range(48, 70);
    const bw = rng.range(6, 14), bh = rng.range(7, 18);
    const bd = rng.range(6, 12), sink = rng.range(0, 2), ry = rng() * 3;
    // keep the SE sector empty — blocks there loomed under the overview camera
    if (a > 0.42 && a < 1.58) continue;
    const bx = Math.cos(a) * d, bz = Math.sin(a) * d;
    const b = new THREE.Mesh(boxGeo, M.silhouette);
    b.scale.set(bw, bh, bd);
    b.position.set(bx, bh / 2 - sink, bz);
    b.rotation.y = ry;
    scene.add(b);
  }
  // distant fire glow on horizon (bloom catches it)
  const glow = new THREE.Mesh(
    new THREE.PlaneGeometry(30, 8),
    new THREE.MeshBasicMaterial({ color: 0xff5a18, transparent: true, opacity: 0.16, blending: THREE.AdditiveBlending, depthWrite: false })
  );
  glow.position.set(55, 4, -40); glow.lookAt(0, 2, 0);
  scene.add(glow);

  // ---------- wall buys / machines ----------
  function wallBuy(weaponId, name, cost, x, z, rotY, kind) {
    const t = chalkWeaponTexture(kind);
    const p = new THREE.Mesh(new THREE.PlaneGeometry(1.9, 0.95), new THREE.MeshBasicMaterial({ map: t, transparent: true, opacity: 0.92 }));
    p.position.set(x, 1.55, z); p.rotation.y = rotY;
    scene.add(p);
    W.wallBuys.push({ weaponId, cost, pos: V3(x, 1.55, z) });
    W.interactables.push({
      id: 'buy_' + weaponId, pos: V3(x, 1.4, z), radius: 2.2,
      getLabel: (G) => G.weapons?.buyLabel(weaponId, cost) ?? null,
      use: (G) => G.weapons?.buyWall(weaponId, cost),
    });
  }
  wallBuy('longarm', 'LONGARM', 500, 13.7, 14, -Math.PI / 2, 'rifle');
  wallBuy('vulture', 'VULTURE', 1000, -13.7, -10, Math.PI / 2, 'smg');
  wallBuy('mauler', 'MAULER', 1250, 25.65, -6, -Math.PI / 2, 'shotgun');
  wallBuy('frag', 'FRAGS', 250, 2.35, -6, Math.PI / 2, 'grenade');

  // perk machines (need power)
  const perkDefs = [
    { id: 'jugg', name: 'JUGGERNOG', color: 0xcc2222, cost: 2500, x: -16.5, z: 16, rotY: Math.PI },
    { id: 'speed', name: 'SPEED COLA', color: 0x22cc44, cost: 3000, x: -10, z: -17.4, rotY: 0 },
    { id: 'stamin', name: 'STAMIN-UP', color: 0xcccc22, cost: 2000, x: 25.3, z: 14, rotY: -Math.PI / 2 },
    { id: 'tap', name: 'DOUBLE TAP', color: 0xcc7722, cost: 2000, x: 10, z: 19.4, rotY: Math.PI },
  ];
  for (const p of perkDefs) {
    const g = new THREE.Group();
    g.position.set(p.x, 0, p.z); g.rotation.y = p.rotY;
    const body = new THREE.Mesh(boxGeo, new THREE.MeshStandardMaterial({ color: 0x1c2126, roughness: 0.5, metalness: 0.4 }));
    body.scale.set(1.0, 1.9, 0.7); body.position.y = 0.95; g.add(body);
    const front = new THREE.Mesh(new THREE.PlaneGeometry(0.8, 1.5),
      new THREE.MeshStandardMaterial({ color: p.color, emissive: p.color, emissiveIntensity: 0.05, roughness: 0.4 }));
    front.position.set(0, 1.05, 0.36); g.add(front);
    g.traverse(o => { o.castShadow = o.receiveShadow = true; });
    scene.add(g);
    addCollider(p.x, p.z, 1.1, 1.9, 0.8);
    W.powerLights.push({ mat: front.material, emissive: 1.4 });
    W.interactables.push({
      id: 'perk_' + p.id, pos: V3(p.x, 1.2, p.z), radius: 2.0,
      getLabel: (G) => {
        if (!W.powerOn) return '<i>No power…</i>';
        if (G.player.perks.has(p.id)) return null;
        return `<b>F</b> Buy ${p.name} <b>[${p.cost}]</b>`;
      },
      use: (G) => {
        if (!W.powerOn || G.player.perks.has(p.id) || !G.spendPoints(p.cost)) return;
        G.player.perks.add(p.id);
        G.events.emit('perkBought', p);
      },
    });
  }

  // mystery box (alley) + pack-a-punch (graveyard) — logic lives in weapons.js
  W.mysteryBox = { pos: V3(19, 0, -8), rotY: 0.2 };
  W.paP = { pos: V3(-19, 0, -16.6), rotY: 0 };

  // ---------- fake contact-shadow AO strips along wall bases ----------
  const aoCanvas = document.createElement('canvas');
  aoCanvas.width = 64; aoCanvas.height = 8;
  {
    const ax = aoCanvas.getContext('2d');
    const g = ax.createLinearGradient(0, 0, 0, 8);
    g.addColorStop(0, 'rgba(0,0,0,0.62)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ax.fillStyle = g; ax.fillRect(0, 0, 64, 8);
  }
  const aoTex = new THREE.CanvasTexture(aoCanvas);
  const aoMat = new THREE.MeshBasicMaterial({ map: aoTex, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1 });
  // strip lying on the ground: runs from (x0,z0) to (x1,z1) along a wall face,
  // fading outward on the side given by (nx,nz).
  function aoStrip(x0, z0, x1, z1, nx, nz, wdt = 0.75) {
    const len = Math.hypot(x1 - x0, z1 - z0);
    const p = new THREE.Mesh(new THREE.PlaneGeometry(len, wdt), aoMat);
    p.rotation.x = -Math.PI / 2;
    p.rotation.z = -Math.atan2(z1 - z0, x1 - x0);
    p.position.set((x0 + x1) / 2 + nx * wdt / 2, 0.02, (z0 + z1) / 2 + nz * wdt / 2);
    p.userData.noBlock = true;
    p.renderOrder = 1;
    scene.add(p);
  }
  aoStrip(-26, -17.7, 26, -17.7, 0, 1);       // north wall inner
  aoStrip(-26, 19.7, 26, 19.7, 0, -1);        // south wall inner
  aoStrip(25.7, -18, 25.7, 20, -1, 0);        // east inner
  aoStrip(-25.7, -18, -25.7, 20, 1, 0);       // west inner
  aoStrip(-14, -1.75, 14, -1.75, 0, 1);       // house south face (courtyard side)
  aoStrip(-14, -2.25, 14, -2.25, 0, -1);      // house south face (interior side)
  aoStrip(2.25, -18, 2.25, -2, 1, 0);         // dividing wall (room1 side)
  aoStrip(1.75, -18, 1.75, -2, -1, 0);        // dividing wall (room2 side)
  aoStrip(13.75, -18, 13.75, -2, -1, 0);      // house east face inner
  aoStrip(14.25, -18, 14.25, -2, 1, 0);       // house east face (alley side)
  aoStrip(-13.75, -18, -13.75, -2, 1, 0);     // house west face inner
  aoStrip(-14.25, -18, -14.25, -2, -1, 0);    // house west face (graveyard side)
  aoStrip(13.75, -2, 13.75, 20, -1, 0);       // east flank (courtyard side)
  aoStrip(-13.75, -2, -13.75, 20, 1, 0);      // west flank (courtyard side)

  // graffiti decals
  function deca(txt, x, y, z, rotY, opts = {}) {
    const p = new THREE.Mesh(new THREE.PlaneGeometry(opts.wpx ?? 3, (opts.wpx ?? 3) / 2),
      new THREE.MeshBasicMaterial({ map: graffitiTexture(txt, opts), transparent: true, opacity: opts.opacity ?? 0.85 }));
    p.position.set(x, y, z); p.rotation.y = rotY;
    scene.add(p);
    return p;
  }
  deca('115', -13.6, 1.8, 2, Math.PI / 2, { color: 'rgba(160,26,22,0.9)' });
  deca('KEIN AUSGANG', 6, 2.1, 19.65, Math.PI, { color: 'rgba(200,200,190,0.5)', font: 'bold 52px Georgia' });
  deca('SIE KOMMEN', 25.65, 1.9, 6, -Math.PI / 2, { color: 'rgba(150,30,26,0.75)' });
  const lg = deca('HE IS WATCHING', 2.2, 1.9, -13, -Math.PI / 2, { color: 'rgba(140,220,150,0.9)' });
  lg.material.opacity = 0; // only revealed by lightning (easter.js)
  W.eePads.lightningGraffiti = lg;

  // ---------- nav grid ----------
  const nav = W.nav = new NavGrid(W.bounds.minX, W.bounds.minZ, W.bounds.maxX, W.bounds.maxZ, 0.5);
  function bakeNav() {
    nav.clear();
    for (const c of W.colliders) {
      if (c.max.y - c.min.y < 0.5 || c.min.y > 0.8) continue; // low debris / high lintels don't block
      nav.blockAABB(c.min.x, c.min.z, c.max.x, c.max.z);
    }
  }
  W.bakeNav = bakeNav;
  bakeNav();

  // ---------- power ----------
  function setPower(G, on) {
    W.powerOn = on;
    for (const pl of W.powerLights) {
      if (pl.light) pl.light.intensity = on ? pl.on : (pl.off ?? 0);
      if (pl.mesh) pl.mesh.material.color.setHex(on ? (pl.headLit ?? 0xffd9a0) : (pl.headDim ?? 0x1a1a18));
      if (pl.mat) pl.mat.emissiveIntensity = on ? pl.emissive : 0.05;
    }
    G.events.emit('power', on);
  }
  W.setPower = (on) => setPower(G, on);

  // door debris fall animation + lamp flicker
  G.events.on('update', ({ dt, t }) => {
    for (const id in W.doors) {
      for (const m of W.doors[id].meshes) {
        const f = m.userData.doorFall;
        if (!f) continue;
        f.t += dt;
        m.position.y -= dt * (1 + f.t * 3);
        m.rotation.x += dt * 1.4; m.rotation.z += dt * 0.8;
        if (f.t > 1.2) { m.removeFromParent(); delete m.userData.doorFall; }
      }
    }
    for (const lp of W.lamps) {
      if (!lp.flicker) continue;
      const n = Math.sin(t * 31) * Math.sin(t * 17.7 + 2) * Math.sin(t * 7.3);
      lp.light.intensity = lp.base * (0.82 + 0.28 * Math.abs(n)) * (Math.sin(t * 57) > -0.96 ? 1 : 0.25);
    }
  });

  return W;
}

// ---------- sky ----------
function buildSky(G) {
  const uniforms = {
    uTime: { value: 0 },
    uLightning: { value: 0 },
  };
  G.skyUniforms = uniforms;
  const mat = new THREE.ShaderMaterial({
    uniforms,
    side: THREE.BackSide,
    depthWrite: false,
    vertexShader: /* glsl */`
      varying vec3 vDir;
      void main() {
        vDir = normalize(position);
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_Position = (projectionMatrix * mv).xyww;
      }`,
    fragmentShader: /* glsl */`
      varying vec3 vDir;
      uniform float uTime;
      uniform float uLightning;
      float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float noise(vec2 p) {
        vec2 i = floor(p), f = fract(p);
        f = f * f * (3.0 - 2.0 * f);
        return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y);
      }
      float fbm(vec2 p) {
        float v = 0.0, a = 0.5;
        for (int i = 0; i < 4; i++) { v += a * noise(p); p *= 2.03; a *= 0.55; }
        return v;
      }
      void main() {
        vec3 d = normalize(vDir);
        float h = max(d.y, 0.0);
        // night gradient: cold blue horizon -> deep blue-black zenith
        vec3 col = mix(vec3(0.036, 0.046, 0.06), vec3(0.008, 0.012, 0.028), pow(h, 0.55));
        col += vec3(0.045, 0.03, 0.014) * pow(max(1.0 - h, 0.0), 7.0); // faint warm haze
        // stars
        vec2 sp = d.xz / (d.y + 0.35);
        float star = step(0.9975, hash(floor(sp * 220.0)));
        float tw = 0.6 + 0.4 * sin(uTime * 3.0 + hash(floor(sp * 220.0) + 7.0) * 40.0);
        col += star * tw * h * vec3(0.8, 0.85, 1.0) * 0.65;
        // moon
        vec3 moonDir = normalize(vec3(-0.5, 0.62, 0.5));
        float md = dot(d, moonDir);
        float disc = smoothstep(0.9993, 0.9997, md);
        float glow = pow(max(md, 0.0), 200.0) * 0.5 + pow(max(md, 0.0), 40.0) * 0.12;
        col += disc * vec3(0.9, 0.95, 1.0) + glow * vec3(0.5, 0.6, 0.8);
        // slow clouds, lit faintly from below
        float cl = fbm(d.xz / (d.y + 0.28) * 1.6 + vec2(uTime * 0.008, uTime * 0.003));
        float cmask = smoothstep(0.52, 0.78, cl) * smoothstep(0.02, 0.2, h);
        col = mix(col, vec3(0.05, 0.06, 0.08), cmask * 0.85);
        col += cmask * vec3(0.06, 0.03, 0.015) * pow(max(1.0 - h, 0.0), 3.0);
        // lightning wash
        col += uLightning * vec3(0.55, 0.6, 0.75) * (0.35 + cmask);
        gl_FragColor = vec4(col, 1.0);
      }`,
  });
  const sky = new THREE.Mesh(new THREE.SphereGeometry(240, 32, 16), mat);
  sky.frustumCulled = false;
  sky.userData.noBlock = true;
  G.scene.add(sky);
}
