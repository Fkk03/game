// world.js — level assembly: stronghold, village, oasis, oilfield + mission logic
import * as THREE from 'three';
import { G, makeRng, SHOT_MODE } from './core.js';
import { LAYOUT, roadCurve } from './layout.js';
import {
  commandCenter, barracks, armsDealer, palace, stingerSite, tunnelNetwork,
  watchtower, hut, mosque, oilDerrick, supplyStash, wallSegment, gateArch,
  palmTree, barrel, wreckTank, powerPole, finalize, Destructible,
} from './buildings.js';
import { Soldier } from './soldiers.js';
import { Vehicle } from './vehicles.js';

const rng = makeRng(5150);

export class World {
  constructor() {
    this.derricks = [];
    this.objectives = [
      { id: 'stingers', text: 'Destroy the three Stinger AA sites (0/3)', done: false, count: 0, need: 3 },
      { id: 'command', text: 'Destroy the Cartel command center', done: false, hidden: true },
      { id: 'extract', text: 'Reach the extraction LZ', done: false, hidden: true },
    ];
    this.stingers = [];
    this.commandTarget = null;
    this.phase = 0;
    this.reinforced = false;
    G.world = this;
    G.barrels = [];
  }

  place(group, x, z, yaw = 0, opts) {
    group.position.set(x, G.groundHeight(x, z), z);
    group.rotation.y = yaw;
    return finalize(group, opts);
  }

  build() {
    this.buildBase();
    this.buildVillage();
    this.buildOasis();
    this.buildOilfield();
    this.buildRoadside();
    this.buildLZ();
  }

  // ------------------------------------------------ Cartel stronghold
  buildBase() {
    const B = LAYOUT.base;
    const at = (dx, dz) => [B.x + dx, B.z + dz];

    // command center — the big objective at the heart
    const cc = this.place(commandCenter(), ...at(0, -35), Math.PI);
    this.commandTarget = new Destructible(cc, {
      hp: 1500, name: 'Command Center', objective: true, radius: 12,
    });

    this.place(palace(), ...at(-45, -15), Math.PI / 3);
    new Destructible(this.place(barracks(), ...at(30, -5), -Math.PI / 2), { hp: 500, name: 'Barracks', radius: 7 });
    new Destructible(this.place(barracks(), ...at(38, 25), -Math.PI / 2 + 0.4), { hp: 500, name: 'Barracks', radius: 7 });
    new Destructible(this.place(armsDealer(), ...at(-30, 25), Math.PI / 5), { hp: 700, name: 'Arms Dealer', radius: 8 });
    this.place(tunnelNetwork(), ...at(15, 40), 0.5);
    this.place(supplyStash(), ...at(-5, 20), 0.3, { collide: false });

    // the three Stinger sites — mission objectives
    const sPos = [at(-38, 42), at(48, -32), at(-18, -55)];
    for (let i = 0; i < 3; i++) {
      const s = this.place(stingerSite(), sPos[i][0], sPos[i][1], rng() * 6, { pad: -2.5 });
      const d = new Destructible(s, {
        hp: 340, name: `Stinger Site ${'ABC'[i]}`, objective: true, radius: 6,
      });
      d.isStinger = true;
      this.stingers.push(d);
    }

    // perimeter: wall stretches flanking a gate facing the road (SW approach)
    const gx = B.x - 42, gz = B.z + 42;
    this.place(gateArch(), gx, gz, -Math.PI / 4);
    for (const [wx, wz, wy] of [
      [gx + 18, gz + 6, -Math.PI / 4 + 0.35], [gx + 32, gz + 16, -Math.PI / 4 + 0.8],
      [gx - 8, gz - 16, -Math.PI / 4 - 0.3], [gx - 16, gz - 30, -Math.PI / 4 - 0.7],
    ]) {
      this.place(wallSegment(14), wx, wz, wy);
    }

    // watchtowers with snipers
    for (const [tx, tz] of [at(-55, 30), at(55, 8), at(20, -60)]) {
      const t = this.place(watchtower(), tx, tz, rng() * 6, { pad: -0.5 });
      const s = new Soldier(tx, tz, { tower: t });
      s.group.position.y += t.userData.platformY;
      s.baseTowerY = t.userData.platformY;
    }

    // garrison
    const posts = [at(-15, 5), at(12, 12), at(-28, -30), at(25, -25), at(5, -12),
      at(-40, 12), at(40, -12), at(-8, 35), at(30, 32), at(-25, 45)];
    for (const [sx, sz] of posts) {
      new Soldier(sx, sz, { anchor: new THREE.Vector3(sx, 0, sz), patrolRadius: 10 });
    }

    // armour
    new Vehicle('tank', ...at(8, -28), { guard: true, yaw: Math.PI / 4 });
    const ring = [];
    for (let i = 0; i < 8; i++) {
      const a = i / 8 * Math.PI * 2;
      ring.push(new THREE.Vector3(B.x + Math.cos(a) * 55, 0, B.z + Math.sin(a) * 55));
    }
    new Vehicle('technical', ...at(55, 0), { path: ring });

    // explosive barrels near structures (tactical opportunities)
    for (const [bx, bz, red] of [
      [sPos[0][0] + 4, sPos[0][1] + 3, true], [sPos[1][0] - 4, sPos[1][1] + 4, true],
      [sPos[2][0] + 5, sPos[2][1] - 3, true],
      [B.x + 20, B.z + 8, true], [B.x - 12, B.z + 30, false], [B.x + 42, B.z + 20, false],
    ]) {
      const b = barrel(red ? 'red' : 'rust');
      this.place(b, bx, bz, rng() * 6, { collide: false });
      G.barrels.push(b);
    }

    // palms scattered inside base
    for (let i = 0; i < 6; i++) {
      const a = rng() * Math.PI * 2, d = 20 + rng() * 55;
      this.place(palmTree(0.9 + rng() * 0.4), B.x + Math.cos(a) * d, B.z + Math.sin(a) * d,
        0, { collide: false });
    }
  }

  // ------------------------------------------------ village
  buildVillage() {
    const V = LAYOUT.village;
    const spots = [
      [-18, -12, 0.3], [12, -18, -0.5], [22, 8, 2.6], [-25, 14, 1.2],
      [3, 22, 3.4], [-8, -30, 0.1], [30, -8, -1.9], [-30, -8, 1.6],
    ];
    spots.forEach(([dx, dz, yaw], i) => {
      new Destructible(this.place(hut(i), V.x + dx, V.z + dz, yaw), { hp: 260, name: 'Hut', radius: 4 });
    });
    this.place(mosque(), V.x + 8, V.z + 0, -0.4);
    // well
    const well = new THREE.Group();
    const wm = new THREE.Mesh(new THREE.CylinderGeometry(1.2, 1.3, 1, 12),
      new THREE.MeshStandardMaterial({ color: 0x9a8c74, roughness: 1 }));
    wm.position.y = 0.5; wm.castShadow = true;
    well.add(wm);
    this.place(well, V.x - 6, V.z + 6, 0);
    // village outpost: a few fighters
    for (const [sx, sz] of [[V.x - 12, V.z - 5], [V.x + 15, V.z + 12], [V.x + 2, V.z - 22]]) {
      new Soldier(sx, sz, { anchor: new THREE.Vector3(sx, 0, sz), patrolRadius: 14 });
    }
    // palms
    for (let i = 0; i < 8; i++) {
      const a = rng() * Math.PI * 2, d = 15 + rng() * 35;
      this.place(palmTree(0.8 + rng() * 0.5), V.x + Math.cos(a) * d, V.z + Math.sin(a) * d,
        0, { collide: false });
    }
  }

  // ------------------------------------------------ oasis
  buildOasis() {
    const O = LAYOUT.oasis;
    // pond
    const water = new THREE.Mesh(
      new THREE.CircleGeometry(11, 26),
      new THREE.MeshStandardMaterial({
        color: 0x3f6f68, roughness: 0.12, metalness: 0.6,
        transparent: true, opacity: 0.92,
      }));
    water.rotation.x = -Math.PI / 2;
    water.position.set(O.x, G.groundHeight(O.x, O.z) + 0.15, O.z);
    G.scene.add(water);
    this.water = water;
    for (let i = 0; i < 13; i++) {
      const a = rng() * Math.PI * 2, d = 9 + rng() * 18;
      this.place(palmTree(0.9 + rng() * 0.6), O.x + Math.cos(a) * d, O.z + Math.sin(a) * d,
        0, { collide: false });
    }
  }

  // ------------------------------------------------ oil field
  buildOilfield() {
    const F = LAYOUT.oilfield;
    for (const [dx, dz] of [[-12, -8], [8, 4], [-2, 18], [18, -14]]) {
      const d = this.place(oilDerrick(), F.x + dx, F.z + dz, rng() * 6);
      this.derricks.push(d);
    }
    for (const [bx, bz] of [[F.x + 2, F.z - 4], [F.x + 3.5, F.z - 3], [F.x - 8, F.z + 8]]) {
      const b = barrel(rng() < 0.5 ? 'red' : 'rust');
      this.place(b, bx, bz, rng() * 6, { collide: false });
      G.barrels.push(b);
    }
    for (const [sx, sz] of [[F.x - 6, F.z + 2], [F.x + 12, F.z - 6]]) {
      new Soldier(sx, sz, { anchor: new THREE.Vector3(sx, 0, sz), patrolRadius: 16 });
    }
    // road patrol technical between village and oilfield
    const patrol = [];
    const c = roadCurve(LAYOUT.road);
    for (const t of [0.42, 0.5, 0.58, 0.66, 0.58, 0.5]) {
      patrol.push(c.getPoint(t));
    }
    new Vehicle('technical', patrol[0].x, patrol[0].z, { path: patrol });
  }

  // ------------------------------------------------ roadside props
  buildRoadside() {
    const c = roadCurve(LAYOUT.road);
    // power poles along the road
    for (let t = 0.06; t < 0.95; t += 0.07) {
      const p = c.getPoint(t);
      const tangent = c.getTangent(t);
      const side = new THREE.Vector3(-tangent.z, 0, tangent.x);
      const pos = p.clone().addScaledVector(side, 7);
      this.place(powerPole(), pos.x, pos.z, Math.atan2(tangent.x, tangent.z), { collide: false });
    }
    // wrecks
    const w1 = c.getPoint(0.3);
    this.place(wreckTank(), w1.x + 3, w1.z, 2.2);
    const w2 = c.getPoint(0.75);
    this.place(wreckTank(), w2.x - 4, w2.z + 2, -0.8);
    // scattered barrels/crates near spawn
    const s = LAYOUT.spawn;
    for (const [bx, bz] of [[s.x + 4, s.z - 6], [s.x - 5, s.z - 3]]) {
      const b = barrel('green');
      this.place(b, bx, bz, rng() * 6, { collide: false });
    }
  }

  // ------------------------------------------------ extraction LZ
  buildLZ() {
    const L = LAYOUT.lz;
    const y = G.groundHeight(L.x, L.z);
    // painted H circle
    const ring = new THREE.Mesh(new THREE.RingGeometry(6, 7, 32),
      new THREE.MeshBasicMaterial({ color: 0xd8c66a, transparent: true, opacity: 0.85, side: THREE.DoubleSide }));
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(L.x, y + 0.08, L.z);
    G.scene.add(ring);
    const hbar = new THREE.Mesh(new THREE.PlaneGeometry(5, 1),
      new THREE.MeshBasicMaterial({ color: 0xd8c66a, transparent: true, opacity: 0.85 }));
    hbar.rotation.x = -Math.PI / 2;
    hbar.position.set(L.x, y + 0.08, L.z);
    G.scene.add(hbar);
    this.lzSmokeT = 0;
  }

  // ------------------------------------------------ mission logic
  currentObjectivePos() {
    if (this.phase === 0) {
      let best = null, bd = 1e9;
      for (const s of this.stingers) {
        if (s.dead) continue;
        const p = new THREE.Vector3();
        s.group.getWorldPosition(p);
        const d = p.distanceTo(G.player.pos);
        if (d < bd) { bd = d; best = p; }
      }
      return best;
    }
    if (this.phase === 1) {
      const p = new THREE.Vector3();
      this.commandTarget.group.getWorldPosition(p);
      return p;
    }
    if (this.phase === 2) return new THREE.Vector3(LAYOUT.lz.x, 0, LAYOUT.lz.z);
    return null;
  }

  onTargetDestroyed(t) {
    if (t.isStinger) {
      const o = this.objectives[0];
      o.count++;
      o.text = `Destroy the three Stinger AA sites (${o.count}/3)`;
      if (o.count >= o.need) {
        o.done = true;
        this.phase = 1;
        this.objectives[1].hidden = false;
        G.hud.announce('AA SITES NEUTRALIZED', 'Now destroy the Cartel command center');
        this.spawnReinforcements(6);
      }
      G.hud.setObjectives(this.visibleObjectives());
    }
    if (t === this.commandTarget) {
      this.objectives[1].done = true;
      this.phase = 2;
      this.objectives[2].hidden = false;
      G.hud.announce('COMMAND CENTER DESTROYED', 'Get to the extraction LZ — north-west corner');
      G.hud.setObjectives(this.visibleObjectives());
      this.spawnReinforcements(8);
    }
  }

  visibleObjectives() {
    return this.objectives.filter(o => !o.hidden);
  }

  onKill() {}

  spawnReinforcements(n) {
    if (SHOT_MODE) return;
    this.reinforced = true;
    const B = LAYOUT.base;
    for (let i = 0; i < n; i++) {
      const a = rng() * Math.PI * 2;
      const x = B.x + Math.cos(a) * (30 + rng() * 40);
      const z = B.z + Math.sin(a) * (30 + rng() * 40);
      const s = new Soldier(x, z, { anchor: new THREE.Vector3(x, 0, z), patrolRadius: 20 });
      s.alert();
    }
    G.hud.feed('<b>WARNING</b> — Cartel reinforcements inbound!');
  }

  update(dt) {
    // animate pump jacks
    for (const d of this.derricks) {
      if (d.userData.beam) d.userData.beam.rotation.z = Math.sin(G.time * 1.1 + d.position.x) * 0.22;
    }
    // water shimmer
    if (this.water) {
      this.water.material.roughness = 0.1 + Math.sin(G.time * 1.7) * 0.05;
    }
    // LZ smoke marker (phase 2)
    if (this.phase === 2) {
      this.lzSmokeT -= dt;
      if (this.lzSmokeT <= 0) {
        this.lzSmokeT = 0.15;
        const L = LAYOUT.lz;
        G.fx.smoke.spawn(new THREE.Vector3(L.x + 5, G.groundHeight(L.x + 5, L.z) + 0.5, L.z), {
          vel: new THREE.Vector3(0.6 + rng() * 0.5, 1.5 + rng(), 0.3),
          size: 0.8, grow: 2.2, life: 2.6, opacity: 0.5, tint: 0x48a848,
        });
      }
      if (G.player.pos.distanceTo(new THREE.Vector3(LAYOUT.lz.x, G.player.pos.y, LAYOUT.lz.z)) < 8) {
        this.objectives[2].done = true;
        import('./main.js').then(m => m.gameOver(true));
      }
    }
  }
}
