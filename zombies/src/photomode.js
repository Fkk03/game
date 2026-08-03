// Photo mode: deterministic staged scenes for the screenshot/critic pipeline.
// Activated with ?photo=N. Seeds the RNG, poses zombies, primes fx, then sets
// window.__photoReady once the frame is stable.
import * as THREE from 'three';

export function initPhotoMode(G, preset) {
  G.state = 'PHOTO';
  document.getElementById('menu').classList.add('hidden');
  const P = G.player;
  const Z = G.zombies;
  const hudOn = () => document.getElementById('hud').classList.add('on');

  const setCam = (x, y, z, yaw, pitch) => {
    P.pos.set(x, 0, z);
    P.yaw = yaw; P.pitch = pitch;
    G.camera.position.set(x, y, z);
    G.camera.rotation.order = 'YXZ';
    G.camera.rotation.set(pitch, yaw, 0);
  };
  const stageHud = (round, pts) => {
    hudOn();
    document.getElementById('round').textContent = round;
    document.getElementById('points').textContent = pts.toLocaleString();
  };

  let primeFrames = 95;
  let onPrime = null; // (frameIndex) -> void

  switch (preset) {
    case 1: { // courtyard vista: horde shambling at the player, house + fires behind
      setCam(0, 1.62, 13.5, 0, 0.02);
      const spots = [
        [-4.5, 5.5, 0.3, 'walk', 0.8], [-1.8, 4, 0.1, 'walk', 2.9], [1.2, 6, -0.2, 'walk', 4.4],
        [3.8, 3.2, -0.3, 'walk', 1.7], [-6.5, 8, 0.45, 'walk', 3.6], [6, 7.5, -0.5, 'walk', 5.2],
        [0.2, 1.8, 0, 'attack', 0], [-2.8, 9.5, 0.2, 'walk', 0.4],
      ];
      for (const [x, z, dy, pose, ph] of spots) {
        Z.spawnPosed(x, z, Math.atan2(0 - x, 13.5 - z), pose, ph, { hunch: 0.25 + (ph % 1) * 0.2 });
      }
      stageHud(8, 4230);
      break;
    }
    case 2: { // window barricade: zombies tearing through planks, interior light
      setCam(8, 1.62, -12.2, 0, 0.06);
      const win = G.world.windows.find(w => w.id === 'N1');
      if (win) {
        win.planks[1].alive = false; win.planks[1].mesh.visible = false;
        win.planks[3].alive = false; win.planks[3].mesh.visible = false;
        Z.spawnPosed(win.outside.x - 0.3, win.outside.z + 0.3, Math.atan2(-win.dir.x, -win.dir.z), 'reach', 0.4);
        Z.spawnPosed(win.outside.x + 0.75, win.outside.z - 0.6, Math.atan2(-win.dir.x, -win.dir.z), 'reach', 2.2);
        Z.spawnPosed(win.spawn.x - 2, win.spawn.z + 3.2, Math.atan2(-win.dir.x, -win.dir.z), 'walk', 1.2);
      }
      stageHud(11, 8120);
      break;
    }
    case 3: { // viewmodel hero shot: SMG mid-fire, sprinter lunging
      setCam(2, 1.62, 5, 0.12, 0.01);
      G.weapons.give('vulture');
      Z.spawnPosed(1.2, 0.4, Math.atan2(2 - 1.2, 5 - 0.4), 'attack', 0, { speedClass: 'sprint' });
      Z.spawnPosed(-1.4, -2.5, Math.atan2(2 + 1.4, 5 + 2.5), 'walk', 2.2, { speedClass: 'sprint' });
      Z.spawnPosed(4.6, -1.8, Math.atan2(2 - 4.6, 5 + 1.8), 'walk', 3.8);
      onPrime = (i) => {
        if (i === 88) {
          // simulate a shot for muzzle flash + tracer
          G.weapons.triggerEdge = true;
          G.weapons.triggerHeld = true;
        }
        if (i === 90) G.weapons.triggerHeld = false;
      };
      primeFrames = 91;
      stageHud(14, 12760);
      break;
    }
    case 4: { // graveyard: risers + lightning + PaP glow
      G.world.doors.D && (G.world.zones.D = true);
      G.world.setPower(true);
      setCam(-15.2, 1.7, 6.5, 0.72, 0.03);
      const graves = G.world.graves;
      for (let i = 0; i < Math.min(3, graves.length); i++) {
        const gp = graves[i * 2] ?? graves[i];
        Z.spawnPosed(gp.x, gp.z, Math.random() * 3, 'rise', 0, { y: -0.55 - i * 0.2 });
      }
      Z.spawnPosed(-19, 2, Math.atan2(-15.2 + 19, 6.5 - 2), 'walk', 1.1);
      onPrime = (i) => {
        if (i > 40) {
          G.skyUniforms.uLightning.value = 0.4;
          G.moon.intensity = 4.4;
        }
        if (i === 50) {
          for (let k = 0; k < 2; k++) G.events.emit('graveRise', graves[k * 2] ?? graves[k]);
        }
      };
      stageHud(18, 21050);
      break;
    }
    case 5: { // mystery box open with Ray Gun
      setCam(17.3, 1.58, -5.6, Math.PI + 2.55, 0.12);
      G.world.zones.C = true;
      const S = G.weapons;
      S.box.state = 'rolling';
      S.box.t = 3.19; // one tick from settling
      G.easter.forceRayGun = true;
      onPrime = (i) => { if (i === 20) { S.box.t = 3.19; } };
      stageHud(6, 950);
      break;
    }
    case 6: { // high overview of the whole map
      G.camera.position.set(30, 27, 32);
      G.camera.lookAt(0, 0, -2);
      P.pos.set(30, 25.4, 32);
      for (const [x, z] of [[0, 8], [-3, 4], [3, 2], [18, 0], [-19, 3], [8, -8], [-6, -10]])
        Z.spawnPosed(x, z, Math.random() * 6, 'walk', (x + z) % 6);
      break;
    }
  }

  // prime: run fixed updates so fires/particles/anims settle, then flag ready
  let i = 0;
  const dt = 1 / 60;
  function prime() {
    i++;
    onPrime?.(i);
    G.tickSim(dt);
    if (i < primeFrames) requestAnimationFrame(prime);
    else {
      G.renderFrame(dt);
      requestAnimationFrame(() => {
        G.renderFrame(dt);
        window.__photoReady = true;
      });
    }
  }
  requestAnimationFrame(prime);
}
