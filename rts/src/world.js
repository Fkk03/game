// world.js — populates the map: starting bases, neutral village/derricks/docks,
// oasis palms, oil field dressing. OWNED BY: core scaffold (meshes agent adds
// prop visuals via meshes.js; economy agent owns dock logic).
import * as THREE from 'three';
import { G, makeRng } from './core.js';
import { LAYOUT } from './layout.js';
import { FACTIONS } from './data.js';
import { spawnUnit, spawnBuilding } from './entities.js';
import { initDocks } from './economy.js';

export function buildWorld() {
  // neutral derricks (capturable)
  for (const d of LAYOUT.derricks) spawnBuilding('derrick', -1, d.x, d.z, 0, { instant: true });
  // village
  const rng = makeRng(777);
  const v = LAYOUT.village;
  spawnBuilding('mosque', -1, v.x, v.z - 10, 0.3, { instant: true });
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * Math.PI * 2 + rng() * 0.5;
    const r = 16 + rng() * 18;
    spawnBuilding('hut', -1, v.x + Math.cos(a) * r, v.z + Math.sin(a) * r, rng() * Math.PI, { instant: true });
  }
  // supply docks (economy agent renders crates + handles harvest)
  initDocks(LAYOUT.docks);

  // starting bases
  for (const p of G.players) {
    const b = LAYOUT.bases[p.id];
    const f = FACTIONS[p.faction];
    const cc = spawnBuilding(f.cc, p.id, b.x, b.z, b.facing, { instant: true });
    p.baseX = b.x; p.baseZ = b.z; p.cc = cc;
    const fw = { x: Math.sin(b.facing), z: Math.cos(b.facing) };
    spawnUnit(f.builder, p.id, b.x + fw.x * 18, b.z + fw.z * 18, b.facing);
    spawnUnit(f.builder === 'dozer' ? 'ranger' : 'rebel', p.id, b.x + fw.x * 14 + 8, b.z + fw.z * 14, b.facing);
    spawnUnit(f.builder === 'dozer' ? 'ranger' : 'rebel', p.id, b.x + fw.x * 14 - 8, b.z + fw.z * 14, b.facing);
  }
}
