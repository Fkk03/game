/* ============ data.js — all static game definitions (original content) ============ */
'use strict';

const TILE = 40;               // world pixels per tile
const DT = 1 / 30;             // fixed simulation step

/* damage multiplier: DMG_MOD[damageType][armorClass] */
const DMG_MOD = {
  bullet:  { inf: 1.00, light: 0.45, heavy: 0.18, building: 0.15, air: 0.55 },
  gatling: { inf: 1.25, light: 0.60, heavy: 0.22, building: 0.20, air: 1.00 },
  cannon:  { inf: 0.45, light: 1.00, heavy: 1.00, building: 0.80, air: 0.00 },
  rocket:  { inf: 0.55, light: 1.00, heavy: 0.90, building: 0.85, air: 1.15 },
  flame:   { inf: 1.60, light: 0.65, heavy: 0.35, building: 1.10, air: 0.00 },
  explosive:{inf: 1.10, light: 1.00, heavy: 0.80, building: 1.20, air: 0.00 },
  flak:    { inf: 0.80, light: 0.45, heavy: 0.18, building: 0.15, air: 1.35 },
  beam:    { inf: 1.20, light: 1.10, heavy: 1.00, building: 1.00, air: 1.00 },
};

/* veterancy: xp thresholds per rank (5 stars max), bonuses applied in ent.js */
const VET_XP = [0, 200, 500, 1100, 2000, 3400];
const VET_DMG = [1, 1.1, 1.2, 1.35, 1.55, 1.8];
const VET_HP  = [1, 1.1, 1.2, 1.35, 1.55, 1.8];
const VET_REGEN = [0, 0, 1, 2, 3.5, 6];   // hp/s self-repair, from 2 stars up

/* player promotion ranks (general's XP) → each rank grants 1 power point */
const RANK_XP = [0, 400, 1000, 2000, 3400, 5200];

const DIFFICULTY = {
  easy:   { label: 'Easy',    income: 0.75, startBonus: 0,    firstAttack: 360, waveEvery: 130, harass: false, superweapon: false, powers: 1, armyCap: 30 },
  normal: { label: 'Normal',  income: 1.0,  startBonus: 0,    firstAttack: 240, waveEvery: 95, harass: true,  superweapon: true,  powers: 2, armyCap: 55 },
  hard:   { label: 'Hard',    income: 1.35, startBonus: 5000, firstAttack: 170, waveEvery: 70,  harass: true,  superweapon: true,  powers: 3, armyCap: 80 },
};

const MAPSIZES = {
  small:  { label: 'Small',  w: 72,  h: 72 },
  medium: { label: 'Medium', w: 96,  h: 96 },
  large:  { label: 'Large',  w: 120, h: 120 },
  huge:   { label: 'Huge',   w: 150, h: 150 },
  colossal: { label: 'Colossal', w: 190, h: 190 },
};

/* domination mode */
const DOM_WIN = 1000;          // team score to win
const DOM_RATE = 0.5;          // points per second while holding the point uncontested
const DOM_CAPTURE_TIME = 8;    // seconds standing alone in the zone to flip it
const DOM_ZONE_R = 120;        // world px
const ECON_ZONE_R = 110;
const ECON_BONUS = 2.0;        // +100% income (double) for the team holding the trade point

/* per-player-slot colors (faction identity comes from units, color from slot) — 14 slots */
const PLAYER_COLORS = ['#3d7edb', '#d43a2f', '#e8c33c', '#3fae5a', '#8e5bd6', '#e07b2f', '#38b8b8',
  '#c95b74', '#e2e2da', '#e87bb8', '#9a6b3c', '#8fd435', '#7a8fa8', '#553191'];

/* =====================================================================
   FACTIONS — three original armies:
   ─ Meridian Coalition  : expensive high-tech, air power, precision
   ─ Crimson Dynasty     : cheap masses, heavy armor, firepower
   ─ Scorpion Cartel     : scrappy guerrillas, fast & cheap, no power needed
===================================================================== */
const FACTIONS = {
  coalition: {
    name: 'Meridian Coalition', flag: '🦅', color: '#3d7edb', colorDark: '#1f4a8a',
    desc: 'High-tech expeditionary force. Expensive but elite units, strike jets and precision firepower.',
    usesPower: true,
    dozerName: 'Combat Dozer', dozerIcon: '🚜',
    buildings: ['cc', 'power', 'nuclear', 'supply', 'barracks', 'factory', 'repairbay', 'airfield', 'turret', 'market', 'superweapon'],
    powers: ['recon', 'supplydrop', 'airstrike', 'paradrop', 'thermobomb'],
    eva: 'Command',
  },
  dynasty: {
    name: 'Crimson Dynasty', flag: '🐲', color: '#d43a2f', colorDark: '#7a1f18',
    desc: 'Industrial war machine. Cheap infantry hordes, heavy tanks, flame weapons and raw firepower.',
    usesPower: true,
    dozerName: 'Worker Dozer', dozerIcon: '🚜',
    buildings: ['cc', 'power', 'nuclear', 'supply', 'barracks', 'factory', 'repairbay', 'airfield', 'turret', 'market', 'superweapon'],
    powers: ['recon', 'barrage', 'reinforce', 'frenzy', 'carpet'],
    eva: 'Command',
  },
  cartel: {
    name: 'Scorpion Cartel', flag: '🦂', color: '#c9a227', colorDark: '#6e5710',
    desc: 'Desert guerrillas. Dirt-cheap fast units, no power grid needed, salvage wrecks to upgrade vehicles.',
    usesPower: false,
    dozerName: 'Worker', dozerIcon: '👷',
    buildings: ['cc', 'supply', 'barracks', 'factory', 'repairbay', 'turret', 'market', 'superweapon'],
    powers: ['recon', 'ambush', 'demo', 'sabotage', 'vengeance'],
    eva: 'Boss',
  },
};

/* =====================================================================
   BUILDINGS — generic keys, per-faction names/skins.
   size in tiles. buildTime seconds (at full power).
===================================================================== */
const BUILDINGS = {
  cc: {
    name: { coalition: 'Command Center', dynasty: 'War Council', cartel: 'Palace' },
    icon: '🏛️', cost: 2000, hp: 4000, size: 4, buildTime: 40, power: 0, armor: 'building',
    sight: 13, desc: 'Heart of your base. Trains dozers, unlocks General\'s Powers. Provides a little power.',
    powerGive: 6, trains: ['dozer'], radar: true,
  },
  power: {
    name: { coalition: 'Fusion Reactor', dynasty: 'Coal Plant', cartel: null },
    icon: '⚡', cost: 600, hp: 900, size: 2, buildTime: 12, power: 0, powerGive: 10,
    armor: 'building', sight: 6, desc: 'Generates power for your structures.',
  },
  nuclear: {
    name: { coalition: 'Nuclear Reactor', dynasty: 'Atomic Furnace', cartel: null },
    icon: '⚛️', cost: 2200, hp: 1800, size: 2, buildTime: 24, power: 0, powerGive: 50,
    armor: 'building', sight: 6,
    desc: 'Advanced reactor — 5× the output of a standard plant. WARNING: destroyed reactors suffer a catastrophic meltdown, devastating everything nearby.',
    meltdown: { dmg: 1500, splash: 300 },
  },
  supply: {
    name: { coalition: 'Supply Center', dynasty: 'Supply Depot', cartel: 'Supply Stash' },
    icon: '📦', cost: 1200, hp: 1600, size: 3, buildTime: 18, power: 2, armor: 'building',
    sight: 7, desc: 'Drop-off point for supplies. Builds Supply Trucks.',
    trains: ['truck'],
  },
  barracks: {
    name: { coalition: 'Barracks', dynasty: 'Troop Hall', cartel: 'Hideout' },
    icon: '🎖️', cost: 500, hp: 1200, size: 2, buildTime: 12, power: 1, armor: 'building',
    sight: 7, desc: 'Trains infantry.',
    trainsByFaction: {
      coalition: ['ranger', 'rocketeer', 'commando'],
      dynasty: ['rifleman', 'rpg'],
      cartel: ['raider', 'rocketraider'],
    },
  },
  factory: {
    name: { coalition: 'War Factory', dynasty: 'Tank Works', cartel: 'Chop Shop' },
    icon: '🏭', cost: 2000, hp: 2200, size: 3, buildTime: 25, power: 3, armor: 'building',
    sight: 7, desc: 'Builds vehicles.',
    trainsByFaction: {
      coalition: ['bulwark', 'viper', 'aegis', 'thunder', 'goliath', 'siege', 'detector'],
      dynasty: ['warlord', 'flak', 'aegis', 'salamander', 'goliath', 'siege', 'detector'],
      cartel: ['jackal', 'guntruck', 'aegis', 'barrage', 'demorig', 'goliath', 'siege', 'detector'],
    },
  },
  airfield: {
    name: { coalition: 'Airfield', dynasty: 'Airstrip', cartel: null },
    icon: '🛩️', cost: 1500, hp: 1800, size: 3, buildTime: 20, power: 3, armor: 'building',
    sight: 8, desc: 'Builds and rearms strike jets (one jet per pad, 4 pads).',
    trainsByFaction: { coalition: ['falcon', 'kestrel', 'seraph', 'umbra', 'albatross', 'spyplane'], dynasty: ['vulture', 'kestrel', 'behemoth', 'spyplane'] },
    pads: 4,
  },
  turret: {
    name: { coalition: 'Sentinel Battery', dynasty: 'Gatling Tower', cartel: 'Missile Nest' },
    icon: '🗼', cost: 1350, hp: 8800, size: 1, buildTime: 16, power: 3, armor: 'building',
    sight: 10, desc: 'Hardened fortress turret. Engages ground and air targets. Offline without power.',
    weaponByFaction: {
      coalition: { dmg: 720, dtype: 'rocket', range: 290, cd: 1.5, projectile: 'missile', aa: true, needsPower: true },
      dynasty:   { dmg: 168, dtype: 'gatling', range: 250, cd: 0.09, projectile: 'bullet', aa: true, needsPower: true },
      cartel:    { dmg: 624, dtype: 'rocket', range: 270, cd: 1.6, projectile: 'missile', aa: true, needsPower: false },
    },
  },
  repairbay: {
    name: { coalition: 'Service Depot', dynasty: 'Repair Yard', cartel: 'Scrap Garage' },
    icon: '🔧', cost: 1200, hp: 1500, size: 2, buildTime: 16, power: 2, armor: 'building',
    sight: 6, desc: 'Automatically repairs nearby friendly vehicles and aircraft (16 hp/s).',
    healRadius: 200, healRate: 16,
  },
  market: {
    name: { coalition: 'Trade Uplink', dynasty: 'Trade Port', cartel: 'Black Market' },
    icon: '💰', cost: 1500, hp: 1000, size: 2, buildTime: 18, power: 1, armor: 'building',
    sight: 5, desc: 'Generates a steady stream of cash ($32/s). No build limit.', income: 32,
  },
  superweapon: {
    name: { coalition: 'Solaris Array', dynasty: 'Nuclear Silo', cartel: 'Rocket Storm Pit' },
    icon: '☢️', cost: 4000, hp: 2500, size: 3, buildTime: 60, power: 6, armor: 'building',
    sight: 6, desc: 'Superweapon. 5-minute countdown, then unleash devastation anywhere on the map.',
    swTimer: 300, limit: 4,
    swByFaction: { coalition: 'solaris', dynasty: 'nuke', cartel: 'rocketstorm' },
  },
};

/* =====================================================================
   UNITS
   speed: world px/s · sight in tiles · radius: collision px
   weapons: { dmg, dtype, range, cd, projectile, splash, aa (can hit air), ga (can hit ground) }
===================================================================== */
const UNITS = {
  /* ---- shared ---- */
  dozer: {
    name: { coalition: 'Combat Dozer', dynasty: 'Worker Dozer', cartel: 'Worker' },
    icon: '🚜', cost: 800, hp: 320, speed: 68, sight: 5, radius: 15, armor: 'light',
    buildTime: 8, chassis: 'dozer', desc: 'Constructs and repairs structures.',
    builder: true, noAutoAttack: true,
  },
  truck: {
    name: { coalition: 'Supply Truck', dynasty: 'Supply Truck', cartel: 'Scrap Hauler' },
    icon: '🚚', cost: 600, hp: 380, speed: 92, sight: 5, radius: 15, armor: 'light',
    buildTime: 7, chassis: 'truck', desc: 'Hauls supplies from piles to your Supply Center. $300 per load.',
    harvester: true, capacity: 300, noAutoAttack: true,
  },

  /* ---- end-game & specialist units (all factions) ---- */
  goliath: {
    name: { coalition: 'Paragon Superheavy', dynasty: 'Emperor Tank', cartel: 'Basilisk' },
    icon: '👑', cost: 2800, hp: 2600, speed: 52, sight: 7, radius: 23,
    armor: 'heavy', buildTime: 22, chassis: 'heavytank',
    desc: 'End-game superheavy tank. Triple the cost, quadruple the punch.',
    weapon: { dmg: 300, dtype: 'cannon', range: 245, cd: 2.4, projectile: 'shell', splash: 50, aa: false, ga: true },
  },
  siege: {
    name: { coalition: 'Longbow Siege Platform', dynasty: 'Great Wall Gun', cartel: 'Doomsday Cannon' },
    icon: '☄️', cost: 2800, hp: 420, speed: 45, sight: 7, radius: 19,
    armor: 'light', buildTime: 24, chassis: 'mlrs',
    desc: 'Extreme-range siege artillery (range 1350 — far beyond its own sight; use spotters). Slow and fragile.',
    weapon: { dmg: 340, dtype: 'explosive', range: 1350, minRange: 260, cd: 8, projectile: 'arty', splash: 75, aa: false, ga: true },
  },
  aegis: {
    name: { coalition: 'Aegis Storm Tank', dynasty: 'Dragonhail Tank', cartel: 'Sky Reaper' },
    icon: '🌪️', cost: 2100, hp: 1150, speed: 80, sight: 8, radius: 18,
    armor: 'heavy', buildTime: 16, chassis: 'aatank',
    desc: 'Elite anti-aircraft tank: quad autocannons with tracking radar. 3× the cost of a standard AA vehicle, ~4× the punch — far more damage, range and armor.',
    weapon: { dmg: 52, dtype: 'flak', range: 340, cd: 0.28, projectile: 'flakburst', splash: 30, aa: true, ga: true },
  },
  detector: {
    name: { coalition: 'Watchman Radar', dynasty: 'Overseer Radar', cartel: 'Listening Truck' },
    icon: '📡', cost: 900, hp: 380, speed: 85, sight: 10, radius: 15,
    armor: 'light', buildTime: 9, chassis: 'radar', noAutoAttack: true,
    desc: 'Satellite-detection vehicle — reveals enemy spy planes within its scan radius.',
    detect: 380,
  },
  albatross: {
    name: 'Albatross Transport', icon: '🚁', cost: 1400, hp: 950, speed: 175, sight: 8, radius: 19,
    armor: 'air', buildTime: 14, chassis: 'heli', air: true, heli: true, noAutoAttack: true,
    capacity: 20,
    desc: 'Coalition troop transport helicopter. Carries up to 20 soldiers (infantry only). Right-click it with troops selected to board; use Unload to deploy.',
  },
  spyplane: {
    name: { coalition: 'Specter Spy Plane', dynasty: 'Shadow Spy Plane' },
    icon: '🛰️', cost: 1600, hp: 300, speed: 265, sight: 18, radius: 13,
    armor: 'air', buildTime: 14, chassis: 'jet', air: true, ammo: 0, noAutoAttack: true,
    stealthAir: true,
    desc: 'Unarmed stealth recon aircraft with enormous sight. Completely undetectable and untouchable — no weapon in the game can target or harm it.',
  },
  umbra: {
    name: 'Umbra Ghost Strike', icon: '🌑', cost: 11700, hp: 2400, speed: 290, sight: 13, radius: 16,
    armor: 'air', buildTime: 34, chassis: 'jet', air: true, ammo: 6,
    stealthAir: true, decloakOnFire: 1,
    desc: 'Coalition-exclusive stealth strike jet, 3–4× a Seraph in every way: six 2,250-dmg missiles, faster, far tougher. Cloaked in flight (colors dim); firing exposes it for ~1 s (colors brighten), then it fades back out.',
    weapon: { dmg: 2250, dtype: 'rocket', range: 185, cd: 0.45, projectile: 'missile', splash: 110, aa: false, ga: true },
  },
  seraph: {
    name: 'Seraph Gunship', icon: '🌩️', cost: 3900, hp: 950, speed: 245, sight: 9, radius: 16,
    armor: 'air', buildTime: 26, chassis: 'jet', air: true, ammo: 3,
    desc: 'End-game strike aircraft: three annihilating missiles and heavy armor.',
    weapon: { dmg: 1500, dtype: 'rocket', range: 175, cd: 0.5, projectile: 'missile', splash: 91, aa: false, ga: true },
  },
  behemoth: {
    name: 'Behemoth Bomber', icon: '🐉', cost: 3600, hp: 1100, speed: 215, sight: 9, radius: 18,
    armor: 'air', buildTime: 26, chassis: 'jet', air: true, ammo: 1,
    desc: 'End-game heavy bomber: one cataclysmic napalm payload, heavily armored.',
    weapon: { dmg: 6000, dtype: 'flame', range: 130, cd: 0.5, projectile: 'napalm', splash: 165, aa: false, ga: true },
  },

  /* ---- Meridian Coalition ---- */
  ranger: {
    name: 'Ranger', icon: '🪖', cost: 240, hp: 140, speed: 62, sight: 6, radius: 7,
    armor: 'inf', buildTime: 5, chassis: 'inf', desc: 'Elite rifle infantry.',
    weapon: { dmg: 11, dtype: 'bullet', range: 175, cd: 0.5, projectile: 'tracer', aa: false, ga: true },
  },
  rocketeer: {
    name: 'Javelin Trooper', icon: '🚀', cost: 320, hp: 120, speed: 56, sight: 7, radius: 7,
    armor: 'inf', buildTime: 6, chassis: 'rocketinf', desc: 'Anti-tank / anti-air missile infantry.',
    weapon: { dmg: 42, dtype: 'rocket', range: 210, cd: 1.9, projectile: 'missile', aa: true, ga: true },
  },
  commando: {
    name: 'Praetorian Commando', icon: '🎖️', cost: 1200, hp: 700, speed: 78, sight: 9, radius: 8,
    armor: 'inf', buildTime: 15, chassis: 'commando', limitPer: 12,
    stealthAir: true, decloakOnFire: 2, detect: 200, fieldRegen: 5,
    resist: { explosive: 0.5, flame: 0.5 },
    desc: 'Elite special forces (max 12). Cloaked while not firing (+50% damage striking from stealth), reveals nearby stealth, shrugs off blasts and flame, self-heals out of combat. 5× the soldier for 5× the price.',
    weapon: { dmg: 60, dtype: 'bullet', range: 260, cd: 0.5, projectile: 'tracer', aa: false, ga: true },
  },
  bulwark: {
    name: 'Bulwark Tank', icon: '🛡️', cost: 900, hp: 620, speed: 74, sight: 6, radius: 17,
    armor: 'heavy', buildTime: 10, chassis: 'tank', desc: 'Reliable main battle tank.',
    weapon: { dmg: 78, dtype: 'cannon', range: 215, cd: 2.1, projectile: 'shell', splash: 28, aa: false, ga: true },
  },
  viper: {
    name: 'Viper AA', icon: '🐍', cost: 650, hp: 330, speed: 105, sight: 7, radius: 14,
    armor: 'light', buildTime: 8, chassis: 'buggy', desc: 'Fast gatling vehicle. Shreds infantry and aircraft.',
    weapon: { dmg: 9, dtype: 'gatling', range: 210, cd: 0.09, projectile: 'bullet', aa: true, ga: true },
  },
  thunder: {
    name: 'Thunder MLRS', icon: '🌩️', cost: 1200, hp: 300, speed: 62, sight: 6, radius: 16,
    armor: 'light', buildTime: 13, chassis: 'mlrs', desc: 'Long-range rocket artillery. Fragile — keep it protected.',
    weapon: { dmg: 95, dtype: 'explosive', range: 380, minRange: 90, cd: 4.2, projectile: 'arty', splash: 46, aa: false, ga: true },
  },
  falcon: {
    name: 'Falcon Strike Jet', icon: '✈️', cost: 1300, hp: 260, speed: 235, sight: 8, radius: 14,
    armor: 'air', buildTime: 14, chassis: 'jet', air: true, ammo: 2,
    desc: 'Strike fighter. Two annihilating missiles, then returns to the Airfield to rearm.',
    weapon: { dmg: 720, dtype: 'rocket', range: 165, cd: 0.5, projectile: 'missile', splash: 77, aa: false, ga: true },
  },
  kestrel: {
    name: { coalition: 'Kestrel Multirole', dynasty: 'Hornet Multirole' },
    icon: '🐦', cost: 1500, hp: 320, speed: 245, sight: 9, radius: 14,
    armor: 'air', buildTime: 15, chassis: 'jet', air: true, ammo: 8, burst: 2,
    desc: 'Multirole fighter — engages aircraft AND ground targets. Eight light missiles fired in two-missile bursts; switches targets instead of wasting ammo on a doomed one.',
    weapon: { dmg: 360, dtype: 'rocket', range: 185, cd: 0.45, projectile: 'missile', splash: 21, aa: true, ga: true },
  },

  /* ---- Crimson Dynasty ---- */
  rifleman: {
    name: 'Rifleman', icon: '🪖', cost: 140, hp: 110, speed: 58, sight: 5, radius: 7,
    armor: 'inf', buildTime: 3.5, chassis: 'inf', desc: 'Cheap conscript infantry. Strength in numbers (Horde bonus).',
    weapon: { dmg: 9, dtype: 'bullet', range: 165, cd: 0.55, projectile: 'tracer', aa: false, ga: true }, horde: true,
  },
  rpg: {
    name: 'RPG Squad', icon: '🚀', cost: 280, hp: 120, speed: 54, sight: 6, radius: 7,
    armor: 'inf', buildTime: 5.5, chassis: 'rocketinf', desc: 'Anti-tank / anti-air rockets. Horde bonus.',
    weapon: { dmg: 40, dtype: 'rocket', range: 200, cd: 2.0, projectile: 'missile', aa: true, ga: true }, horde: true,
  },
  warlord: {
    name: 'Warlord Tank', icon: '💪', cost: 1400, hp: 1150, speed: 52, sight: 6, radius: 21,
    armor: 'heavy', buildTime: 16, chassis: 'heavytank', desc: 'Massive twin-cannon assault tank. Slow but devastating. Horde bonus.',
    weapon: { dmg: 65, dtype: 'cannon', range: 220, cd: 1.3, projectile: 'shell', splash: 30, aa: false, ga: true }, horde: true,
  },
  flak: {
    name: 'Quad Flak', icon: '💥', cost: 700, hp: 380, speed: 85, sight: 7, radius: 15,
    armor: 'light', buildTime: 8, chassis: 'buggy', desc: 'Flak cannons. Excellent anti-air, good vs infantry.',
    weapon: { dmg: 26, dtype: 'flak', range: 240, cd: 0.55, projectile: 'flakburst', splash: 22, aa: true, ga: true },
  },
  salamander: {
    name: 'Salamander', icon: '🔥', cost: 850, hp: 480, speed: 78, sight: 5, radius: 16,
    armor: 'light', buildTime: 10, chassis: 'flametank', desc: 'Flame tank. Melts infantry and buildings.',
    weapon: { dmg: 26, dtype: 'flame', range: 130, cd: 0.22, projectile: 'flame', splash: 20, aa: false, ga: true },
  },
  vulture: {
    name: 'Vulture Bomber', icon: '🦅', cost: 1200, hp: 300, speed: 205, sight: 8, radius: 15,
    armor: 'air', buildTime: 14, chassis: 'jet', air: true, ammo: 1,
    desc: 'Drops one apocalyptic napalm bomb, then rearms at the Airstrip.',
    weapon: { dmg: 2880, dtype: 'flame', range: 120, cd: 0.5, projectile: 'napalm', splash: 147, aa: false, ga: true },
  },

  /* ---- Scorpion Cartel ---- */
  raider: {
    name: 'Raider', icon: '🔫', cost: 130, hp: 100, speed: 72, sight: 6, radius: 7,
    armor: 'inf', buildTime: 3, chassis: 'inf', desc: 'Fast, cheap SMG fighter.',
    weapon: { dmg: 8, dtype: 'bullet', range: 150, cd: 0.35, projectile: 'tracer', aa: false, ga: true },
  },
  rocketraider: {
    name: 'Rocket Raider', icon: '🚀', cost: 260, hp: 110, speed: 62, sight: 6, radius: 7,
    armor: 'inf', buildTime: 5, chassis: 'rocketinf', desc: 'Anti-tank / anti-air rockets.',
    weapon: { dmg: 38, dtype: 'rocket', range: 200, cd: 2.0, projectile: 'missile', aa: true, ga: true },
  },
  jackal: {
    name: 'Jackal Tank', icon: '🐺', cost: 620, hp: 430, speed: 92, sight: 6, radius: 16,
    armor: 'heavy', buildTime: 8, chassis: 'tank', desc: 'Light, fast, cheap tank. Salvages wrecks to upgrade.',
    weapon: { dmg: 55, dtype: 'cannon', range: 200, cd: 1.9, projectile: 'shell', splash: 22, aa: false, ga: true }, salvager: true,
  },
  guntruck: {
    name: 'Gun Truck', icon: '🛻', cost: 500, hp: 300, speed: 118, sight: 7, radius: 14,
    armor: 'light', buildTime: 6, chassis: 'buggy', desc: 'Very fast machine-gun truck. Hits air. Salvages wrecks.',
    weapon: { dmg: 8, dtype: 'gatling', range: 195, cd: 0.1, projectile: 'bullet', aa: true, ga: true }, salvager: true,
  },
  barrage: {
    name: 'Barrage Buggy', icon: '🎆', cost: 950, hp: 240, speed: 100, sight: 6, radius: 14,
    armor: 'light', buildTime: 11, chassis: 'mlrs', desc: 'Fast rocket artillery. Shoot and scoot.',
    weapon: { dmg: 70, dtype: 'explosive', range: 340, minRange: 80, cd: 3.4, projectile: 'arty', splash: 40, aa: false, ga: true },
  },
  demorig: {
    name: 'Demo Rig', icon: '💣', cost: 500, hp: 240, speed: 125, sight: 5, radius: 13,
    armor: 'light', buildTime: 6, chassis: 'demorig', desc: 'Remote-controlled car bomb. Rams the target and detonates (800 dmg).',
    suicide: { dmg: 800, splash: 90 }, noAutoAttack: true,
  },
};

/* =====================================================================
   GENERAL'S POWERS — tier gates: t1 rank1+, t2 rank3+, t3 rank5
===================================================================== */
const POWERS = {
  recon:      { name: 'Recon Sweep', icon: '🛰️', tier: 1, cd: 75,
    desc: 'Reveal a large area of the battlefield for 25 seconds.' },
  airstrike:  { name: 'Precision Airstrike', icon: '🎯', tier: 2, cd: 180,
    desc: 'Two Falcon jets pound the target area with missiles.' },
  thermobomb: { name: 'Thermobaric Bomb', icon: '☄️', tier: 3, cd: 300,
    desc: 'A massive fuel-air bomb levels everything in a huge radius.' },

  supplydrop: { name: 'Emergency Supplies', icon: '📦', tier: 1, cd: 150,
    desc: 'Airdrop supply crates worth $1,200 anywhere on the map.' },
  paradrop:   { name: 'Airborne Assault', icon: '🪂', tier: 2, cd: 200,
    desc: 'Paradrop 6 riflemen and 2 rocket troopers anywhere on the map.' },
  frenzy:     { name: 'War Frenzy', icon: '🔥', tier: 2, cd: 210,
    desc: 'All your forces deal +30% damage for 30 seconds.' },
  sabotage:   { name: 'Sabotage', icon: '🔌', tier: 2, cd: 160,
    desc: 'Saboteurs disable enemy structures near the target for 25 seconds.' },

  barrage:    { name: 'Artillery Barrage', icon: '💥', tier: 1, cd: 120,
    desc: 'Off-map artillery saturates the target area with 10 shells.' },
  reinforce:  { name: 'Armor Reserves', icon: '🪂', tier: 2, cd: 210,
    desc: 'Airdrop 2 tanks and 4 riflemen anywhere on the map.' },
  carpet:     { name: 'Carpet Bombing', icon: '🛩️', tier: 3, cd: 300,
    desc: 'A heavy bomber lays a long line of high-explosive bombs.' },

  ambush:     { name: 'Ambush', icon: '🎭', tier: 1, cd: 110,
    desc: '6 Raiders spring from hiding at the target point.' },
  demo:       { name: 'Demolition Barrage', icon: '🧨', tier: 2, cd: 180,
    desc: '10 improvised rockets rain down from off-map.' },
  vengeance:  { name: 'Vengeance Strike', icon: '⚰️', tier: 3, cd: 300,
    desc: 'Three brutal waves of rockets pound the target area.' },
};

/* superweapon strikes */
const SUPERWEAPONS = {
  solaris:     { name: 'Solaris Beam', desc: 'Orbital energy beam sweeps across the target.' },
  nuke:        { name: 'Nuclear Missile', desc: 'City-block-erasing nuclear strike.' },
  rocketstorm: { name: 'Rocket Storm', desc: '24 heavy rockets saturate a wide area.' },
};

/* =====================================================================
   BUILDING UPGRADES — bought on a selected production building.
   cost = building base cost × costMul.
===================================================================== */
const UPGRADES = {
  airfield: [
    { key: 'fastrepair', name: 'Fast Rearm', icon: '⚡', costMul: 0.4,
      desc: 'Rearm crews work 30% faster — aircraft turn around sooner.' },
    { key: 'restore', name: 'Full Restoration', icon: '❤️', costMul: 1.5,
      desc: 'Aircraft landing to resupply are also repaired to at least 50% health.' },
    { key: 'fastprod', name: 'Rapid Assembly', icon: '⚙️', costMul: 1.5,
      desc: 'Aircraft production is 30% faster.' },
    { key: 'selfrepair', name: 'Auto-Repair', icon: '🛠️', costMul: 1.0,
      desc: 'The structure repairs itself (3% every 3 s) after 10 s without taking damage.' },
    { key: 'reinforce', name: 'Reinforced', icon: '🧱', costMul: 1.5, hpMul: 2,
      desc: 'Maximum health +100%.' },
  ],
  factory: [
    { key: 'fastprod', name: 'Rapid Assembly', icon: '⚙️', costMul: 0.6,
      desc: 'Vehicle production is 30% faster.' },
    { key: 'selfrepair', name: 'Auto-Repair', icon: '🛠️', costMul: 1.5,
      desc: 'The structure repairs itself (3% every 3 s) after 10 s without taking damage.' },
    { key: 'reinforce', name: 'Reinforced', icon: '🧱', costMul: 1.0, hpMul: 1.5,
      desc: 'Maximum health +50%.' },
  ],
  barracks: [
    { key: 'fastprod', name: 'Rapid Drills', icon: '⚙️', costMul: 0.6,
      desc: 'Infantry training is 30% faster.' },
    { key: 'selfrepair', name: 'Auto-Repair', icon: '🛠️', costMul: 1.5,
      desc: 'The structure repairs itself (3% every 3 s) after 10 s without taking damage.' },
    { key: 'reinforce', name: 'Reinforced', icon: '🧱', costMul: 1.0, hpMul: 1.5,
      desc: 'Maximum health +50%.' },
  ],
};

/* faction-aware unit pricing.
   Cartel: infantry −40%, non-tank ground combat vehicles −30%.
   Everyone EXCEPT the Coalition: tanks −50%. */
const TANK_CHASSIS = ['tank', 'heavytank', 'flametank', 'aatank'];
function uCost(key, faction) {
  const u = UNITS[key];
  let c = u.cost;
  const isTank = TANK_CHASSIS.includes(u.chassis);
  if (faction !== 'coalition' && isTank) c = Math.round(c * 0.5);
  else if (faction === 'cartel') {
    if (u.chassis === 'inf' || u.chassis === 'rocketinf' || u.chassis === 'commando') c = Math.round(c * 0.6);
    else if (!u.air && !u.builder && !u.harvester) c = Math.round(c * 0.7);
  }
  return c;
}

/* helpers to resolve per-faction fields */
function bName(key, faction) {
  const b = BUILDINGS[key];
  return typeof b.name === 'object' ? (b.name[faction] || Object.values(b.name)[0]) : b.name;
}
function uName(key, faction) {
  const u = UNITS[key];
  return typeof u.name === 'object' ? (u.name[faction] || Object.values(u.name)[0]) : u.name;
}
function bTrains(key, faction) {
  const b = BUILDINGS[key];
  if (b.trainsByFaction) return b.trainsByFaction[faction] || [];
  return b.trains || [];
}
function turretWeapon(faction) { return BUILDINGS.turret.weaponByFaction[faction]; }
