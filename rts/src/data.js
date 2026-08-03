// data.js — THE DESIGN CONTRACT: factions, unit/building stats, tech tree,
// generals powers, upgrades, armor table. All systems read from here; no
// module hardcodes stats. Numbers tuned to a GZH-like pace at $10k start.
// ============================================================================
// Def shape (registry DEFS):
//   common: { id, faction:'coalition'|'cartel'|'neutral', kind:'unit'|'building',
//     name, icon, cost, buildTime(s), hp, armor:'infantry'|'vehicle'|'building'|'aircraft',
//     sight(m), desc, hk (hotkey char) }
//   building: { size:[w,d] (m footprint), power (+gen/-drain, coalition only),
//     builds:[defIds], requires:[defIds], weapon?, superweapon?:powerId,
//     income?($/s trickle), capturable?:bool, rubbleScale? }
//   unit: { speed(m/s), turnRate(rad/s), weapon?, role:'builder'|'harvester'|
//     'infantry'|'vehicle'|'artillery'|'air', builds? (builder), capacity?
//     (harvester $ per trip), canCapture?, air?:bool, crush?:bool }
//   weapon: { damage, type:'bullet'|'shell'|'rocket'|'flame'|'beam'|'cannon',
//     range(m), reload(s), splash?(m), projectile?:'shell'|'rocket'|'tracer',
//     antiAir?:bool, groundOnly?:bool, burst?(shots) }
// ============================================================================

// damage-type → armor-class multiplier (GZH-style rock/paper/scissors)
export const ARMOR = {
  bullet:  { infantry: 1.25, vehicle: 0.35, building: 0.25, aircraft: 0.6 },
  shell:   { infantry: 0.5,  vehicle: 1.2,  building: 0.8,  aircraft: 0.0 },
  cannon:  { infantry: 1.0,  vehicle: 0.9,  building: 0.5,  aircraft: 1.4 },
  rocket:  { infantry: 0.6,  vehicle: 1.15, building: 1.15, aircraft: 1.1 },
  flame:   { infantry: 1.6,  vehicle: 0.6,  building: 1.0,  aircraft: 0.0 },
  beam:    { infantry: 2.0,  vehicle: 2.0,  building: 2.0,  aircraft: 2.0 },
};

export const RANKS = [0, 300, 800, 1600, 3000];   // xp thresholds → rank 1..5
export const VET_KILLS = [0, 3, 8, 16];           // unit veterancy chevrons

export const FACTIONS = {
  coalition: {
    name: 'COALITION', flag: '🦅', color: 0x3f7fe0, colorCss: '#5b9bff',
    usesPower: true, cc: 'cc_c', builder: 'dozer', dock: 'supply_c',
    music: 'coalition',
    desc: 'High-tech armour, air power, the Particle Cannon.',
  },
  cartel: {
    name: 'SCORPION CARTEL', flag: '🦂', color: 0xd8b23a, colorCss: '#e8c85a',
    usesPower: false, cc: 'cc_g', builder: 'worker', dock: 'supply_g',
    music: 'cartel',
    desc: 'Cheap swarms, tunnels, salvage, the Scud Storm.',
  },
};

const D = {};
const def = (o) => { D[o.id] = o; return o; };

// ============================ COALITION ============================
def({ id: 'cc_c', faction: 'coalition', kind: 'building', name: 'Command Center',
  icon: '🏛️', cost: 2000, buildTime: 30, hp: 4000, armor: 'building', sight: 60,
  size: [22, 22], power: 0, builds: ['dozer'],
  desc: 'Heart of the base. Produces dozers and unlocks General\'s powers.', hk: 'C' });
def({ id: 'reactor', faction: 'coalition', kind: 'building', name: 'Fusion Reactor',
  icon: '⚡', cost: 600, buildTime: 10, hp: 1000, armor: 'building', sight: 30,
  size: [12, 12], power: 8,
  desc: 'Generates 8 power. Low power cripples production and defenses.', hk: 'R' });
def({ id: 'barracks_c', faction: 'coalition', kind: 'building', name: 'Barracks',
  icon: '🎖️', cost: 500, buildTime: 12, hp: 1500, armor: 'building', sight: 30,
  size: [14, 12], power: -1, builds: ['ranger', 'missiledef'],
  desc: 'Trains Coalition infantry.', hk: 'B' });
def({ id: 'supply_c', faction: 'coalition', kind: 'building', name: 'Supply Center',
  icon: '📦', cost: 1500, buildTime: 15, hp: 2000, armor: 'building', sight: 40,
  size: [18, 16], power: -1, builds: ['truck_c'],
  desc: 'Supply trucks deliver crates here. Build near a supply dock.', hk: 'S' });
def({ id: 'factory_c', faction: 'coalition', kind: 'building', name: 'War Factory',
  icon: '🏭', cost: 2000, buildTime: 20, hp: 2500, armor: 'building', sight: 40,
  size: [20, 18], power: -2, requires: ['supply_c'],
  builds: ['crusader', 'humvee', 'tomahawk'],
  upgrades: ['upg_armor', 'upg_ap'],
  desc: 'Builds Coalition armour and artillery.', hk: 'F' });
def({ id: 'airfield', faction: 'coalition', kind: 'building', name: 'Airfield',
  icon: '🛩️', cost: 1000, buildTime: 18, hp: 2000, armor: 'building', sight: 40,
  size: [22, 16], power: -2, requires: ['factory_c'], builds: ['comanche'],
  desc: 'Fields Comanche gunships.', hk: 'A' });
def({ id: 'patriot', faction: 'coalition', kind: 'building', name: 'Patriot Battery',
  icon: '🎯', cost: 1000, buildTime: 12, hp: 1200, armor: 'building', sight: 65,
  size: [10, 10], power: -3, requires: ['barracks_c'],
  weapon: { damage: 60, type: 'rocket', range: 62, reload: 1.8, projectile: 'rocket', antiAir: true },
  desc: 'Missile defense turret. Engages ground and air. Needs power.', hk: 'P' });
def({ id: 'particle', faction: 'coalition', kind: 'building', name: 'Particle Cannon',
  icon: '💠', cost: 4000, buildTime: 45, hp: 2500, armor: 'building', sight: 40,
  size: [16, 16], power: -6, requires: ['cc_c', 'factory_c'], superweapon: 'sw_particle',
  desc: 'Orbital-relay beam weapon. 4-minute charge. Needs power.', hk: 'X' });

def({ id: 'dozer', faction: 'coalition', kind: 'unit', name: 'Construction Dozer',
  icon: '🚜', cost: 1000, buildTime: 8, hp: 350, armor: 'vehicle', sight: 26,
  speed: 9, turnRate: 2.6, role: 'builder',
  builds: ['reactor', 'barracks_c', 'supply_c', 'factory_c', 'airfield', 'patriot', 'particle', 'cc_c'],
  desc: 'Constructs and repairs Coalition structures.', hk: 'D' });
def({ id: 'truck_c', faction: 'coalition', kind: 'unit', name: 'Supply Truck',
  icon: '🚚', cost: 700, buildTime: 7, hp: 480, armor: 'vehicle', sight: 26,
  speed: 12.5, turnRate: 2.8, role: 'harvester', capacity: 450,
  desc: 'Hauls supply crates from docks to your Supply Center.', hk: 'T' });
def({ id: 'ranger', faction: 'coalition', kind: 'unit', name: 'Ranger',
  icon: '🪖', cost: 225, buildTime: 5, hp: 180, armor: 'infantry', sight: 32,
  speed: 6.5, turnRate: 6, role: 'infantry', canCapture: true,
  weapon: { damage: 14, type: 'bullet', range: 30, reload: 0.7, burst: 3 },
  desc: 'Versatile assault infantry. Captures derricks and neutral tech.', hk: 'E' });
def({ id: 'missiledef', faction: 'coalition', kind: 'unit', name: 'Missile Defender',
  icon: '🚀', cost: 300, buildTime: 6, hp: 160, armor: 'infantry', sight: 36,
  speed: 6, turnRate: 6, role: 'infantry',
  weapon: { damage: 48, type: 'rocket', range: 44, reload: 2.4, projectile: 'rocket', antiAir: true },
  desc: 'Laser-guided missiles. Shreds vehicles and aircraft.', hk: 'M' });
def({ id: 'crusader', faction: 'coalition', kind: 'unit', name: 'Crusader Tank',
  icon: '🛡️', cost: 900, buildTime: 10, hp: 940, armor: 'vehicle', sight: 36,
  speed: 10, turnRate: 2.4, role: 'vehicle', crush: true,
  weapon: { damage: 95, type: 'shell', range: 42, reload: 2.6, splash: 3, projectile: 'shell' },
  desc: 'Main battle tank of the Coalition.', hk: 'C' });
def({ id: 'humvee', faction: 'coalition', kind: 'unit', name: 'Humvee',
  icon: '🚙', cost: 700, buildTime: 8, hp: 520, armor: 'vehicle', sight: 42,
  speed: 16, turnRate: 3.4, role: 'vehicle',
  weapon: { damage: 16, type: 'bullet', range: 34, reload: 0.5, antiAir: true },
  desc: 'Fast scout with a .50 cal. Good vs infantry.', hk: 'H' });
def({ id: 'tomahawk', faction: 'coalition', kind: 'unit', name: 'Tomahawk Launcher',
  icon: '🎇', cost: 1200, buildTime: 14, hp: 420, armor: 'vehicle', sight: 34,
  speed: 8, turnRate: 2.0, role: 'artillery',
  weapon: { damage: 220, type: 'rocket', range: 90, reload: 8, splash: 9, projectile: 'rocket', groundOnly: true, minRange: 20 },
  desc: 'Long-range cruise missile artillery. Fragile — escort it.', hk: 'K' });
def({ id: 'comanche', faction: 'coalition', kind: 'unit', name: 'Comanche',
  icon: '🚁', cost: 1500, buildTime: 16, hp: 620, armor: 'aircraft', sight: 46,
  speed: 22, turnRate: 2.8, role: 'air', air: true,
  weapon: { damage: 30, type: 'rocket', range: 46, reload: 1.1, projectile: 'rocket' },
  desc: 'Stealth gunship. Rockets and a chin gun.', hk: 'O' });

// ============================ CARTEL ============================
def({ id: 'cc_g', faction: 'cartel', kind: 'building', name: 'Command Post',
  icon: '🕌', cost: 1800, buildTime: 28, hp: 3600, armor: 'building', sight: 60,
  size: [20, 20], builds: ['worker'],
  desc: 'Cartel headquarters. Produces workers. Needs no power — nothing does.', hk: 'C' });
def({ id: 'barracks_g', faction: 'cartel', kind: 'building', name: 'Rebel Barracks',
  icon: '⛺', cost: 400, buildTime: 10, hp: 1300, armor: 'building', sight: 30,
  size: [13, 11], builds: ['rebel', 'rpg'],
  desc: 'Trains the faithful of the Scorpion Cartel.', hk: 'B' });
def({ id: 'supply_g', faction: 'cartel', kind: 'building', name: 'Supply Stash',
  icon: '🏚️', cost: 1200, buildTime: 12, hp: 1800, armor: 'building', sight: 40,
  size: [16, 14], builds: ['truck_g'],
  desc: 'Trucks unload crates here. Cheaper than Coalition logistics.', hk: 'S' });
def({ id: 'armsdealer', faction: 'cartel', kind: 'building', name: 'Arms Dealer',
  icon: '🔧', cost: 1500, buildTime: 18, hp: 2200, armor: 'building', sight: 40,
  size: [18, 16], requires: ['supply_g'],
  builds: ['scorpion', 'technical', 'quad', 'buggy'],
  desc: 'Builds Cartel vehicles from scrap and spite.', hk: 'F' });
def({ id: 'blackmarket', faction: 'cartel', kind: 'building', name: 'Black Market',
  icon: '💰', cost: 1200, buildTime: 15, hp: 1400, armor: 'building', sight: 30,
  size: [12, 12], requires: ['barracks_g'], income: 8,
  upgrades: ['upg_toxin', 'upg_junk'],
  desc: 'Generates a steady cash trickle and researches upgrades.', hk: 'M' });
def({ id: 'stinger', faction: 'cartel', kind: 'building', name: 'Stinger Site',
  icon: '🌵', cost: 800, buildTime: 10, hp: 1100, armor: 'building', sight: 60,
  size: [11, 11], requires: ['barracks_g'],
  weapon: { damage: 45, type: 'rocket', range: 58, reload: 1.6, projectile: 'rocket', antiAir: true },
  desc: 'Sandbagged missile nest. No power required.', hk: 'P' });
def({ id: 'tunnel', faction: 'cartel', kind: 'building', name: 'Tunnel Network',
  icon: '🕳️', cost: 800, buildTime: 10, hp: 1300, armor: 'building', sight: 50,
  size: [10, 10], requires: ['barracks_g'],
  weapon: { damage: 16, type: 'bullet', range: 40, reload: 0.6, antiAir: true },
  desc: 'Fortified gun nest. Slowly heals nearby Cartel vehicles.', hk: 'U' });
def({ id: 'scudstorm', faction: 'cartel', kind: 'building', name: 'Scud Storm',
  icon: '☄️', cost: 3600, buildTime: 45, hp: 2400, armor: 'building', sight: 40,
  size: [18, 18], requires: ['cc_g', 'armsdealer'], superweapon: 'sw_scud',
  desc: 'Nine anthrax-tipped scuds. 4-minute fuelling.', hk: 'X' });

def({ id: 'worker', faction: 'cartel', kind: 'unit', name: 'Worker',
  icon: '👷', cost: 300, buildTime: 5, hp: 140, armor: 'infantry', sight: 24,
  speed: 5.5, turnRate: 6, role: 'builder',
  builds: ['barracks_g', 'supply_g', 'armsdealer', 'blackmarket', 'stinger', 'tunnel', 'scudstorm', 'cc_g'],
  desc: 'Builds and repairs Cartel structures. Cheap and plentiful.', hk: 'D' });
def({ id: 'truck_g', faction: 'cartel', kind: 'unit', name: 'Supply Truck',
  icon: '🛻', cost: 500, buildTime: 6, hp: 420, armor: 'vehicle', sight: 26,
  speed: 12, turnRate: 2.8, role: 'harvester', capacity: 380,
  desc: 'Battered hauler. Crates in, cash out.', hk: 'T' });
def({ id: 'rebel', faction: 'cartel', kind: 'unit', name: 'Rebel',
  icon: '🥷', cost: 150, buildTime: 4, hp: 150, armor: 'infantry', sight: 30,
  speed: 6.8, turnRate: 6, role: 'infantry', canCapture: true,
  weapon: { damage: 12, type: 'bullet', range: 28, reload: 0.65, burst: 3 },
  desc: 'Cheap AK-toting militia. Captures derricks and tech.', hk: 'E' });
def({ id: 'rpg', faction: 'cartel', kind: 'unit', name: 'RPG Trooper',
  icon: '🧨', cost: 280, buildTime: 5, hp: 140, armor: 'infantry', sight: 34,
  speed: 6, turnRate: 6, role: 'infantry',
  weapon: { damage: 42, type: 'rocket', range: 40, reload: 2.2, projectile: 'rocket', antiAir: true },
  desc: 'Tank-hunter. Fires on aircraft too.', hk: 'M' });
def({ id: 'scorpion', faction: 'cartel', kind: 'unit', name: 'Scorpion Tank',
  icon: '🦂', cost: 600, buildTime: 8, hp: 640, armor: 'vehicle', sight: 34,
  speed: 10.5, turnRate: 2.6, role: 'vehicle', crush: true,
  weapon: { damage: 70, type: 'shell', range: 38, reload: 2.4, splash: 2.5, projectile: 'shell' },
  desc: 'Cheap desert tank. Alone it dies; in packs it devours.', hk: 'C' });
def({ id: 'technical', faction: 'cartel', kind: 'unit', name: 'Technical',
  icon: '🛻', cost: 500, buildTime: 6, hp: 380, armor: 'vehicle', sight: 40,
  speed: 17, turnRate: 3.6, role: 'vehicle',
  weapon: { damage: 15, type: 'bullet', range: 32, reload: 0.5, antiAir: true },
  desc: 'Pickup with a pintle gun. Fast, fragile, furious.', hk: 'H' });
def({ id: 'quad', faction: 'cartel', kind: 'unit', name: 'Quad Cannon',
  icon: '💥', cost: 700, buildTime: 9, hp: 460, armor: 'vehicle', sight: 42,
  speed: 12, turnRate: 3.0, role: 'vehicle',
  weapon: { damage: 22, type: 'cannon', range: 40, reload: 0.4, antiAir: true },
  desc: 'Four-barrel flak truck. Deletes aircraft and infantry.', hk: 'Q' });
def({ id: 'buggy', faction: 'cartel', kind: 'unit', name: 'Rocket Buggy',
  icon: '🎆', cost: 900, buildTime: 11, hp: 320, armor: 'vehicle', sight: 36,
  speed: 15, turnRate: 3.2, role: 'artillery',
  weapon: { damage: 26, type: 'rocket', range: 75, reload: 5.5, splash: 4, burst: 6, projectile: 'rocket', groundOnly: true, minRange: 14 },
  desc: 'Salvo artillery on a dune buggy. Hit and run.', hk: 'K' });

// ============================ NEUTRAL ============================
def({ id: 'derrick', faction: 'neutral', kind: 'building', name: 'Oil Derrick',
  icon: '🛢️', cost: 0, buildTime: 0, hp: 1000, armor: 'building', sight: 20,
  size: [8, 8], capturable: true, income: 20,
  desc: 'Capture with infantry for $20/s.' });
def({ id: 'hut', faction: 'neutral', kind: 'building', name: 'Village House',
  icon: '🏠', cost: 0, buildTime: 0, hp: 600, armor: 'building', sight: 0,
  size: [8, 8], desc: 'A quiet home in a loud war.' });
def({ id: 'mosque', faction: 'neutral', kind: 'building', name: 'Old Mosque',
  icon: '🕌', cost: 0, buildTime: 0, hp: 1400, armor: 'building', sight: 0,
  size: [12, 12], desc: 'Its dome has watched a century of dawns.' });

export const DEFS = D;

// ============================ POWERS ============================
// { id, faction, name, icon, rank (min), cooldown(s), radius, desc,
//   targeted:bool (click a spot), auto? }  — logic in powers.js
export const POWERS = {
  repair: { id: 'repair', faction: 'coalition', name: 'Emergency Repair', icon: '🔩',
    rank: 1, cooldown: 120, radius: 24, targeted: true,
    desc: 'Field engineers instantly repair vehicles in the area.' },
  paradrop: { id: 'paradrop', faction: 'coalition', name: 'Ranger Paradrop', icon: '🪂',
    rank: 1, cooldown: 180, radius: 10, targeted: true,
    desc: 'Six Rangers drop anywhere on the battlefield.' },
  a10: { id: 'a10', faction: 'coalition', name: 'A-10 Strike', icon: '✈️',
    rank: 3, cooldown: 240, radius: 14, targeted: true,
    desc: 'A-10s strafe the target line with avenger cannons and missiles.' },
  fab: { id: 'fab', faction: 'coalition', name: 'Fuel Air Bomb', icon: '🔥',
    rank: 5, cooldown: 360, radius: 26, targeted: true,
    desc: 'A MOAB-class blast that erases the grid square.' },
  ambush: { id: 'ambush', faction: 'cartel', name: 'Rebel Ambush', icon: '🥷',
    rank: 1, cooldown: 150, radius: 10, targeted: true,
    desc: 'Eight rebels emerge from the sand anywhere on the map.' },
  bounty: { id: 'bounty', faction: 'cartel', name: 'War Bounty', icon: '💰',
    rank: 1, cooldown: 0, targeted: false, passive: true,
    desc: 'Earn 10% of the value of every unit you destroy.' },
  sneak: { id: 'sneak', faction: 'cartel', name: 'Sneak Attack', icon: '🕳️',
    rank: 3, cooldown: 300, radius: 8, targeted: true,
    desc: 'A tunnel entrance burrows up anywhere on the battlefield.' },
  anthrax: { id: 'anthrax', faction: 'cartel', name: 'Anthrax Bomb', icon: '☠️',
    rank: 5, cooldown: 360, radius: 24, targeted: true,
    desc: 'A toxin bomb that melts everything it touches.' },
  // superweapons (auto-charge once built; fired via topbar/hotkey when ready)
  sw_particle: { id: 'sw_particle', faction: 'coalition', name: 'Particle Cannon', icon: '💠',
    rank: 0, cooldown: 240, radius: 16, targeted: true, superweapon: true,
    desc: 'Steerable orbital beam. Carves through a base.' },
  sw_scud: { id: 'sw_scud', faction: 'cartel', name: 'Scud Storm', icon: '☄️',
    rank: 0, cooldown: 240, radius: 30, targeted: true, superweapon: true,
    desc: 'Nine scuds saturate the target area with high explosive and anthrax.' },
};

// ============================ UPGRADES ============================
export const UPGRADES = {
  upg_armor: { id: 'upg_armor', faction: 'coalition', name: 'Composite Armor', icon: '🛡️',
    cost: 1500, time: 30, desc: '+25% hit points for all Coalition vehicles.' },
  upg_ap: { id: 'upg_ap', faction: 'coalition', name: 'AP Rounds', icon: '🔻',
    cost: 1500, time: 30, desc: '+25% damage for all Coalition weapons.' },
  upg_toxin: { id: 'upg_toxin', faction: 'cartel', name: 'Toxin Ammo', icon: '☣️',
    cost: 1200, time: 25, desc: '+25% damage for all Cartel weapons.' },
  upg_junk: { id: 'upg_junk', faction: 'cartel', name: 'Junk Repair', icon: '🔧',
    cost: 1200, time: 25, desc: 'Cartel vehicles slowly self-repair.' },
};

// difficulty knobs (ai.js)
export const DIFFICULTY = {
  easy:   { incomeMult: 0.7, buildDelay: 1.8, attackWave: 150, aggression: 0.5 },
  normal: { incomeMult: 1.0, buildDelay: 1.0, attackWave: 110, aggression: 1.0 },
  hard:   { incomeMult: 1.25, buildDelay: 0.6, attackWave: 80, aggression: 1.5 },
  brutal: { incomeMult: 1.6, buildDelay: 0.35, attackWave: 60, aggression: 2.2 },
};
