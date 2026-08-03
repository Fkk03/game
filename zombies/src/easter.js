// Easter eggs: musical teddies, meteor rocks -> guaranteed Ray Gun, Konami code,
// radios (morse "115"), lightning graffiti, the shed terminal, a plush in the shed.
// (Also on the map but wired elsewhere: party-hat zombie -> Max Ammo drop,
//  mystery-box weighted rolls, "HE IS WATCHING" reveal.)
import * as THREE from 'three';

export function initEaster(G) {
  const E = G.events, W = G.world, scene = G.scene;
  const EE = G.easter = { teddies: 0, meteors: 0, forceRayGun: false, radioOn: false, konamiI: 0 };

  // ---------- musical teddies ----------
  const teddyMat = new THREE.MeshStandardMaterial({ color: 0x8a6844, roughness: 0.95 });
  const teddyDark = new THREE.MeshStandardMaterial({ color: 0x5c422a, roughness: 0.95 });
  function teddy(x, y, z, rotY) {
    const g = new THREE.Group();
    const body = new THREE.Mesh(new THREE.SphereGeometry(0.13, 10, 8), teddyMat); body.scale.y = 1.2;
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.09, 10, 8), teddyMat); head.position.y = 0.2;
    const earL = new THREE.Mesh(new THREE.SphereGeometry(0.035, 6, 5), teddyDark); earL.position.set(-0.06, 0.28, 0);
    const earR = earL.clone(); earR.position.x = 0.06;
    const armL = new THREE.Mesh(new THREE.SphereGeometry(0.04, 6, 5), teddyMat); armL.position.set(-0.13, 0.05, 0); armL.scale.set(1, 1.8, 1);
    const armR = armL.clone(); armR.position.x = 0.13;
    g.add(body, head, earL, earR, armL, armR);
    g.position.set(x, y, z); g.rotation.y = rotY; g.rotation.x = -0.15;
    g.traverse(o => { o.castShadow = true; o.userData.noBlock = true; });
    scene.add(g);
    return g;
  }
  const teddySpots = [
    { pos: W.eePads.truck, rotY: 2.2 },                      // under the truck bed
    { pos: new THREE.Vector3(-20.1, 1.15, -3.9), rotY: 0.6 }, // atop a gravestone
    { pos: new THREE.Vector3(12.4, 1.28, 17.2), rotY: -2.4 }, // on courtyard barrels
  ];
  teddySpots.forEach((s, i) => {
    const m = teddy(s.pos.x, s.pos.y, s.pos.z, s.rotY);
    W.interactables.push({
      id: 'teddy' + i, pos: s.pos.clone(), radius: 1.8, done: false,
      getLabel() { return this.done ? null : '<b>F</b> …a teddy bear?'; },
      use() {
        if (this.done) return;
        this.done = true;
        m.rotation.x = -0.6;
        EE.teddies++;
        E.emit('subtitle', EE.teddies < 3 ? `<i>The bear hums faintly… (${EE.teddies}/3)</i>` : '<i>Samantha thanks you.</i>');
        if (EE.teddies === 3) { E.emit('playSong'); E.emit('eeBanner', 'MUSIC'); }
      },
    });
  });

  // ---------- meteor rocks (shoot all 3 -> next box is a Ray Gun) ----------
  const meteorMat = new THREE.MeshStandardMaterial({
    color: 0x2a3450, emissive: 0x3060ff, emissiveIntensity: 1.4, roughness: 0.6,
  });
  const meteorSpots = [
    new THREE.Vector3(-13.4, 2.6, 18.2),   // courtyard west wall, up high
    new THREE.Vector3(25.4, 2.8, 2.4),     // alley east wall
    new THREE.Vector3(-18, 3.6, 11.6),     // in the dead tree
  ];
  const meteors = meteorSpots.map(p => {
    const m = new THREE.Mesh(new THREE.IcosahedronGeometry(0.16, 0), meteorMat.clone());
    m.position.copy(p);
    m.rotation.set(Math.random() * 3, Math.random() * 3, 0);
    m.userData.meteor = true;
    scene.add(m);
    return m;
  });
  E.on('wallHit', ({ object }) => {
    if (!object?.userData?.meteor || object.userData.dead) return;
    object.userData.dead = true;
    object.material.emissiveIntensity = 0.1;
    object.material.color.setHex(0x181c26);
    EE.meteors++;
    E.emit('subtitle', EE.meteors < 3 ? `<i>The rock cracks… something hums. (${EE.meteors}/3)</i>` : '<i>The hum crescendos. The box is calling.</i>');
    if (EE.meteors === 3) EE.forceRayGun = true;
  });

  // ---------- konami code ----------
  const KONAMI = ['ArrowUp', 'ArrowUp', 'ArrowDown', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'ArrowLeft', 'ArrowRight', 'KeyB', 'KeyA'];
  E.on('keydown', (code) => {
    EE.konamiI = code === KONAMI[EE.konamiI] ? EE.konamiI + 1 : (code === KONAMI[0] ? 1 : 0);
    if (EE.konamiI === KONAMI.length) {
      EE.konamiI = 0;
      E.emit('subtitle', '<i>The old gods look kindly on cheaters.</i>');
      G.addPoints(1000, 'konami');
      let n = 0;
      for (const z of G.zombies.list) {
        if (z.gone || z.state === 'dead' || z.state === 'dying' || z.state === 'posed') continue;
        z.hp = 0; z.state = 'dying'; z.dieT = 0; z.fallDir = 1;
        E.emit('gib', { pos: z.group.position.clone().setY(1) });
        n++;
      }
      E.emit('nuke', n);
    }
  });

  // ---------- radios (morse: 115) ----------
  const radios = [
    new THREE.Vector3(3.2, 1.15, -16.9),   // room1 shelf area
    new THREE.Vector3(23.4, 1.3, -14.2),   // alley crates
    new THREE.Vector3(-22.9, 1.35, -14.9), // shed shelf
  ].map((p, i) => {
    const g = new THREE.Group();
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.2, 0.12), new THREE.MeshStandardMaterial({ color: 0x33291c, roughness: 0.8 }));
    const grille = new THREE.Mesh(new THREE.PlaneGeometry(0.16, 0.12), new THREE.MeshStandardMaterial({ color: 0x110e0a, roughness: 1 }));
    grille.position.set(-0.05, 0, 0.062);
    const dialLight = new THREE.Mesh(new THREE.PlaneGeometry(0.07, 0.05), new THREE.MeshBasicMaterial({ color: 0x3a2a12 }));
    dialLight.position.set(0.09, 0.02, 0.062);
    const ant = new THREE.Mesh(new THREE.CylinderGeometry(0.005, 0.005, 0.3, 4), new THREE.MeshStandardMaterial({ color: 0x777777, metalness: 0.8, roughness: 0.4 }));
    ant.position.set(0.12, 0.22, 0); ant.rotation.z = -0.3;
    g.add(body, grille, dialLight, ant);
    g.position.copy(p);
    g.rotation.y = [0.5, -1.2, 0.9][i];
    g.traverse(o => { o.userData.noBlock = true; });
    scene.add(g);
    W.interactables.push({
      id: 'radio' + i, pos: p.clone(), radius: 1.8,
      getLabel: () => '<b>F</b> Radio',
      use: () => {
        dialLight.material.color.setHex(0xffa030);
        E.emit('radioMorse');
        E.emit('subtitle', '<i>…static… “—site one one five, containment breached, do not—” …static…</i>');
      },
    });
    return g;
  });
  // morse beeps for "115": .---- .---- .....
  E.on('radioMorse', () => {
    if (!G.audio?.ready) return;
    const seq = [1, 3, 3, 3, 3, 0, 1, 3, 3, 3, 3, 0, 1, 1, 1, 1, 1]; // dit/dah lengths
    let t = 0;
    for (const s of seq) {
      if (s === 0) { t += 0.35; continue; }
      const dur = s === 1 ? 0.08 : 0.22;
      G.audioTone?.(880, dur, 0.08, t);
      t += dur + 0.12;
    }
  });

  // ---------- lightning reveals graffiti ----------
  E.on('lightning', () => {
    const lg = W.eePads.lightningGraffiti;
    if (!lg) return;
    lg.material.opacity = 0.9;
    const fade = setInterval(() => {
      lg.material.opacity = Math.max(0, lg.material.opacity - 0.08);
      if (lg.material.opacity <= 0) clearInterval(fade);
    }, 90);
  });

  // ---------- claude plush + terminal (shed) ----------
  (function plush() {
    const g = new THREE.Group();
    const body = new THREE.Mesh(new THREE.SphereGeometry(0.1, 10, 8),
      new THREE.MeshStandardMaterial({ color: 0xd97a45, roughness: 0.9 }));
    body.scale.set(1, 1.15, 0.9);
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.07, 10, 8),
      new THREE.MeshStandardMaterial({ color: 0xe8935e, roughness: 0.9 }));
    head.position.y = 0.15;
    g.add(body, head);
    g.position.set(-21.4, 1.03, -14.8);
    g.traverse(o => o.userData.noBlock = true);
    scene.add(g);
    W.interactables.push({
      id: 'plush', pos: g.position.clone(), radius: 1.6,
      getLabel: () => '<b>F</b> A small orange plush',
      use: () => E.emit('subtitle', '<i>A tag on it reads: “I was made to be helpful, honest, and harmless. Two out of three survived the outbreak.”</i>'),
    });
  })();

  (function terminal() {
    const g = new THREE.Group();
    const screenMat = new THREE.MeshBasicMaterial({ color: 0x1a3a1c });
    const shell = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.4, 0.35), new THREE.MeshStandardMaterial({ color: 0x2c2e30, roughness: 0.6, metalness: 0.3 }));
    const screen = new THREE.Mesh(new THREE.PlaneGeometry(0.36, 0.26), screenMat);
    screen.position.set(0, 0.02, 0.18);
    g.add(shell, screen);
    g.position.set(-22.8, 1.05, -13.2);
    g.rotation.y = 1.1;
    g.traverse(o => o.userData.noBlock = true);
    scene.add(g);
    const LORE = [
      '<i>LOG 03: The element doesn\'t decay. It remembers.</i>',
      '<i>LOG 07: Subjects respond to sound. Do NOT ring the bell.</i>',
      '<i>LOG 11: If you find the bears, wind them. She likes the music.</i>',
      '<i>LOG 12: [REDACTED] reached the graveyard. Cut the power to slow them. We did the opposite.</i>',
    ];
    let li = 0;
    W.interactables.push({
      id: 'terminal', pos: g.position.clone(), radius: 1.7,
      getLabel: () => '<b>F</b> Terminal',
      use: () => {
        screenMat.color.setHex(0x2a6a2c);
        E.emit('subtitle', LORE[li++ % LORE.length]);
      },
    });
  })();

  // meteors pulse gently
  E.on('update', ({ t }) => {
    for (const m of meteors) {
      if (m.userData.dead) continue;
      m.material.emissiveIntensity = 1.1 + Math.sin(t * 2.4 + m.position.x) * 0.5;
    }
  });

  return EE;
}
