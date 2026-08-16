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
const VET_REGEN = [0, 0, 7.5, 15, 26.25, 125];   // hp/s self-repair, from 2 stars up
/* the factory's Field Service upgrade — a smaller Service Depot bolted to the plant */
const FIELD_SERVICE_RATE = 14;              // hp/s to nearby vehicles and aircraft
const FIELD_SERVICE_RADIUS = 200;

/* player promotion ranks (general's XP) → each rank grants 1 power point */
const RANK_XP = [0, 400, 1000, 2000, 3400, 5200];

const DIFFICULTY = {
  easy:   { label: 'Easy',    income: 0.75, startBonus: 0,    firstAttack: 360, waveEvery: 130, harass: false, superweapon: false, powers: 1, armyCap: 30 },
  normal: { label: 'Normal',  income: 1.0,  startBonus: 0,    firstAttack: 240, waveEvery: 95, harass: true,  superweapon: true,  powers: 2, armyCap: 55 },
  hard:   { label: 'Hard',    income: 1.35, startBonus: 5000, firstAttack: 170, waveEvery: 70,  harass: true,  superweapon: true,  powers: 3, armyCap: 80 },
};

/* AI war chest: every AI general is resupplied this much every 10 minutes */
const AI_CASH_DROP = 100000;
/* AI production handicap: units cost and take half as long to build */
const AI_UNIT_COST_MUL = 0.5;
const AI_BUILDTIME_MUL = 0.5;

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
    buildings: ['cc', 'power', 'nuclear', 'supply', 'barracks', 'factory', 'repairbay', 'airfield', 'gatdef', 'artdef', 'artfort', 'market', 'superweapon'],
    powers: ['recon', 'supplydrop', 'airstrike', 'paradrop', 'thermobomb'],
    eva: 'Command',
  },
  dynasty: {
    name: 'Crimson Dynasty', flag: '🐲', color: '#d43a2f', colorDark: '#7a1f18',
    desc: 'Industrial war machine. Cheap infantry hordes, heavy tanks, flame weapons and raw firepower.',
    usesPower: true,
    dozerName: 'Worker Dozer', dozerIcon: '🚜',
    buildings: ['cc', 'power', 'nuclear', 'supply', 'barracks', 'factory', 'repairbay', 'airfield', 'gatdef', 'artdef', 'artfort', 'market', 'superweapon'],
    powers: ['recon', 'barrage', 'reinforce', 'frenzy', 'carpet'],
    eva: 'Command',
  },
  cartel: {
    name: 'Scorpion Cartel', flag: '🦂', color: '#c9a227', colorDark: '#6e5710',
    desc: 'Desert guerrillas. Dirt-cheap fast units, no power grid needed, salvage wrecks to upgrade vehicles.',
    usesPower: false,
    dozerName: 'Worker', dozerIcon: '👷',
    buildings: ['cc', 'supply', 'barracks', 'factory', 'repairbay', 'gatdef', 'artdef', 'artfort', 'market', 'superweapon'],
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
    icon: '🏛️', cost: 2000, hp: 12000, size: 4, buildTime: 40, power: 0, armor: 'building',
    sight: 13, desc: 'Heart of your base. Trains dozers, unlocks General\'s Powers. Provides a little power.',
    powerGive: 6, trains: ['dozer'], radar: true,
  },
  power: {
    name: { coalition: 'Fusion Reactor', dynasty: 'Coal Plant', cartel: null },
    icon: '⚡', cost: 600, hp: 2700, size: 2, buildTime: 12, power: 0, powerGive: 10,
    armor: 'building', sight: 6, desc: 'Generates power for your structures.',
  },
  nuclear: {
    name: { coalition: 'Nuclear Reactor', dynasty: 'Atomic Furnace', cartel: null },
    icon: '⚛️', cost: 2200, hp: 5400, size: 2, buildTime: 24, power: 0, powerGive: 50,
    armor: 'building', sight: 6,
    desc: 'Advanced reactor — 5× the output of a standard plant. WARNING: destroyed reactors suffer a catastrophic meltdown, devastating everything nearby.',
    meltdown: { dmg: 1500, splash: 300 },
  },
  supply: {
    name: { coalition: 'Supply Center', dynasty: 'Supply Depot', cartel: 'Supply Stash' },
    icon: '📦', cost: 1200, hp: 4800, size: 3, buildTime: 18, power: 2, armor: 'building',
    sight: 7, desc: 'Drop-off point for supplies. Builds Supply Trucks.',
    trains: ['truck'],
  },
  barracks: {
    name: { coalition: 'Barracks', dynasty: 'Troop Hall', cartel: 'Hideout' },
    icon: '🎖️', cost: 500, hp: 3600, size: 2, buildTime: 12, power: 1, armor: 'building',
    sight: 7, desc: 'Trains infantry.',
    trainsByFaction: {
      coalition: ['ranger', 'rocketeer', 'commando'],
      dynasty: ['rifleman', 'rpg'],
      cartel: ['raider', 'rocketraider'],
    },
  },
  factory: {
    name: { coalition: 'War Factory', dynasty: 'Tank Works', cartel: 'Chop Shop' },
    icon: '🏭', cost: 2000, hp: 6600, size: 3, buildTime: 25, power: 3, armor: 'building',
    sight: 7, desc: 'Builds vehicles.',
    trainsByFaction: {
      coalition: ['bulwark', 'viper', 'aegis', 'thunder', 'goliath', 'citadel', 'leviathan', 'annihilator', 'siege', 'detector'],
      dynasty: ['warlord', 'flak', 'aegis', 'salamander', 'goliath', 'citadel', 'leviathan', 'annihilator', 'siege', 'detector'],
      cartel: ['jackal', 'guntruck', 'aegis', 'barrage', 'demorig', 'goliath', 'citadel', 'leviathan', 'annihilator', 'siege', 'detector'],
    },
  },
  airfield: {
    name: { coalition: 'Airfield', dynasty: 'Airstrip', cartel: null },
    icon: '🛩️', cost: 1500, hp: 5400, size: 3, buildTime: 20, power: 3, armor: 'building',
    sight: 8, desc: 'Builds and rearms strike jets (one jet per pad, 4 pads).',
    trainsByFaction: { coalition: ['falcon', 'kestrel', 'seraph', 'umbra', 'obsidian', 'albatross', 'spyplane'], dynasty: ['vulture', 'kestrel', 'behemoth', 'spyplane'] },
    pads: 4,
  },
  gatdef: {
    name: { coalition: 'Vulcan Sentry', dynasty: 'Gatling Tower', cartel: 'Shredder Nest' },
    icon: '🗼', cost: 800, hp: 9000, size: 1, buildTime: 12, power: 2, armor: 'building',
    sight: 9, desc: 'Rapid-fire point defense. Shreds infantry, light vehicles and aircraft; barely dents heavy armor. Offline without power.',
    weaponByFaction: {
      coalition: { dmg: 55, dtype: 'gatling', range: 700, cd: 0.15, projectile: 'bullet', splash: 18, aa: true, ga: true, needsPower: true },
      dynasty:   { dmg: 60, dtype: 'gatling', range: 680, cd: 0.15, projectile: 'bullet', splash: 18, aa: true, ga: true, needsPower: true },
      cartel:    { dmg: 50, dtype: 'gatling', range: 660, cd: 0.14, projectile: 'bullet', splash: 18, aa: true, ga: true, needsPower: true },
    },
  },
  artdef: {
    name: { coalition: 'Longstrike Battery', dynasty: 'Dragonmaw Cannon', cartel: 'Scorpion Gun' },
    icon: '🎯', cost: 1600, hp: 12000, size: 1, buildTime: 18, power: 3, armor: 'building',
    sight: 10, desc: 'Long-range artillery emplacement. Devastates tanks and armor at extreme range; cannot hit aircraft and has a dead zone up close. Offline without power.',
    weaponByFaction: {
      coalition: { dmg: 1400, dtype: 'cannon', range: 1250, minRange: 180, cd: 4.0, projectile: 'arty', splash: 70, aa: false, ga: true, needsPower: true },
      dynasty:   { dmg: 1550, dtype: 'cannon', range: 1200, minRange: 180, cd: 4.2, projectile: 'arty', splash: 80, aa: false, ga: true, needsPower: true },
      cartel:    { dmg: 1300, dtype: 'cannon', range: 1180, minRange: 180, cd: 3.8, projectile: 'arty', splash: 70, aa: false, ga: true, needsPower: true },
    },
  },
  artfort: {
    name: { coalition: 'Bastion Gun', dynasty: 'Colossus Cannon', cartel: 'Titan Gun' },
    icon: '🌋', cost: 160000, hp: 60000, size: 2, buildTime: 60, power: 12, armor: 'building',
    sight: 12, desc: 'Fortress artillery. A siege gun on a hardened emplacement — 2,600 range that outreaches every mobile gun but the Annihilator, a 9,000-damage shell and a 220 blast. Cannot engage aircraft and is blind inside 400. Devours power.',
    weaponByFaction: {
      coalition: { dmg: 9000, dtype: 'cannon', range: 2600, minRange: 400, cd: 5.0, projectile: 'arty', splash: 220, aa: false, ga: true, needsPower: true },
      dynasty:   { dmg: 9600, dtype: 'cannon', range: 2500, minRange: 400, cd: 5.2, projectile: 'arty', splash: 240, aa: false, ga: true, needsPower: true },
      cartel:    { dmg: 8400, dtype: 'cannon', range: 2450, minRange: 400, cd: 4.8, projectile: 'arty', splash: 220, aa: false, ga: true, needsPower: true },
    },
  },
  repairbay: {
    name: { coalition: 'Service Depot', dynasty: 'Repair Yard', cartel: 'Scrap Garage' },
    icon: '🔧', cost: 1200, hp: 4500, size: 2, buildTime: 16, power: 2, armor: 'building',
    sight: 6, desc: 'Automatically repairs nearby friendly vehicles and aircraft (16 hp/s).',
    healRadius: 200, healRate: 16,
  },
  market: {
    name: { coalition: 'Trade Uplink', dynasty: 'Trade Port', cartel: 'Black Market' },
    icon: '💰', cost: 1500, hp: 3000, size: 2, buildTime: 18, power: 1, armor: 'building',
    sight: 5, desc: 'Generates a steady stream of cash ($32/s). No build limit.', income: 32,
  },
  superweapon: {
    name: { coalition: 'Solaris Array', dynasty: 'Nuclear Silo', cartel: 'Rocket Storm Pit' },
    icon: '☢️', cost: 4000, hp: 7500, size: 3, buildTime: 60, power: 6, armor: 'building',
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
    icon: '👑', cost: 2800, hp: 7800, speed: 52, sight: 7, radius: 23,
    armor: 'heavy', buildTime: 22, chassis: 'heavytank',
    desc: 'End-game superheavy tank. Triple the cost, quadruple the punch.',
    weapon: { dmg: 300, dtype: 'cannon', range: 245, cd: 2.4, projectile: 'shell', splash: 50, aa: false, ga: true },
  },
  citadel: {
    name: { coalition: 'Citadel Landship', dynasty: 'Iron Sovereign', cartel: 'Warlord Rig' },
    icon: '🏰', cost: 25000, hp: 24000, speed: 44, sight: 8, radius: 28,
    armor: 'heavy', buildTime: 45, chassis: 'heavytank',
    desc: 'End-game landship. Three times a superheavy in armour and firepower, with a sponson gun for infantry that stray too close. Ponderously slow.',
    weapon: { dmg: 900, dtype: 'cannon', range: 300, cd: 2.6, projectile: 'shell', splash: 90, aa: false, ga: true },
    gunWeapon: { dmg: 26, dtype: 'gatling', range: 230, cd: 0.12, projectile: 'bullet', aa: false, ga: true },
  },
  leviathan: {
    name: { coalition: 'Leviathan Fortress', dynasty: 'Thunder Throne', cartel: 'Doomcrawler' },
    icon: '🐘', cost: 100000, hp: 75000, speed: 34, sight: 9, radius: 34,
    armor: 'heavy', buildTime: 120, chassis: 'heavytank',
    desc: 'A mobile fortress and the heaviest machine ever fielded. Siege-grade main gun, quad sponson mounts, and armour that shrugs off a whole defensive line. Crawls — escort it.',
    resist: { bullet: 0.4, gatling: 0.4 },
    weapon: { dmg: 2600, dtype: 'cannon', range: 380, cd: 3.0, projectile: 'shell', splash: 150, aa: false, ga: true },
    gunWeapon: { dmg: 40, dtype: 'gatling', range: 260, cd: 0.08, projectile: 'bullet', aa: true, ga: true },
  },
  annihilator: {
    name: { coalition: 'Longbow Annihilator', dynasty: 'Great Wall Sovereign', cartel: 'Doomsday Colossus' },
    icon: '🌠', cost: 140000, hp: 9000, speed: 30, sight: 8, radius: 30,
    armor: 'heavy', buildTime: 100, chassis: 'mlrs',
    desc: 'End-game siege artillery. Outranges every gun in the game at 3,200 — including fortress emplacements — and drops a 6,000-damage shell with a 260 blast. Blind past its own sight, helpless inside 500, and it crawls: escort it and spot for it.',
    weapon: { dmg: 6000, dtype: 'explosive', range: 3200, minRange: 500, cd: 9, projectile: 'arty', splash: 260, aa: false, ga: true },
  },
  siege: {
    name: { coalition: 'Longbow Siege Platform', dynasty: 'Great Wall Gun', cartel: 'Doomsday Cannon' },
    icon: '☄️', cost: 2800, hp: 420, speed: 45, sight: 7, radius: 19,
    armor: 'light', buildTime: 24, chassis: 'mlrs',
    desc: 'Extreme-range siege artillery (range 2025 — far beyond its own sight; it is blind without spotters). Slow and fragile.',
    weapon: { dmg: 340, dtype: 'explosive', range: 2025, minRange: 260, cd: 8, projectile: 'arty', splash: 75, aa: false, ga: true },
  },
  aegis: {
    name: { coalition: 'Aegis Storm Tank', dynasty: 'Dragonhail Tank', cartel: 'Sky Reaper' },
    icon: '🌪️', cost: 2100, hp: 3450, speed: 80, sight: 8, radius: 18,
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
    name: 'Albatross Gunship', icon: '🚁', cost: 1400, hp: 2850, speed: 262, sight: 8, radius: 19,
    armor: 'air', buildTime: 14, chassis: 'heli', air: true, heli: true,
    capacity: 20, gunPorts: 20, tankSlots: 1,
    resist: { bullet: 0.5, gatling: 0.5 },
    desc: 'Coalition gunship-transport. Carries up to 20 soldiers plus one slung tank on its belly cradle, guns down infantry with its chin turret and fires rockets at armor. Every soldier aboard fires from the gun ports; the slung tank rides silent. An active protection system deflects half of all incoming gunfire. Unload (F) sets everything down.',
    weapon: { dmg: 330, dtype: 'rocket', range: 240, cd: 2.0, projectile: 'missile', splash: 26, aa: false, ga: true },
    gunWeapon: { dmg: 33, dtype: 'gatling', range: 220, cd: 0.1, projectile: 'bullet', aa: false, ga: true },
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
  obsidian: {
    name: 'Obsidian Strategic Bomber', icon: '🦇', cost: 100000, hp: 4800, speed: 180, sight: 12, radius: 22,
    armor: 'air', buildTime: 90, chassis: 'jet', air: true, ammo: 1, limitPer: 10,
    stealthAir: true, decloakOnFire: 2,
    desc: 'Coalition strategic bomber (max 10). Cloaked flying wing carrying ONE nuclear payload — a 22,500-damage detonation with a 400 blast, the largest in the arsenal, and it strikes structures at full force rather than the reduced damage other aircraft deal. Flies home to rearm after every drop.',
    weapon: { dmg: 22500, dtype: 'explosive', range: 120, cd: 1.0, projectile: 'nukebomb', splash: 400, aa: false, ga: true },
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
    name: 'Ranger', icon: '🪖', cost: 240, hp: 280, speed: 62, sight: 6, radius: 7,
    armor: 'inf', buildTime: 5, chassis: 'inf', desc: 'Elite rifle infantry.',
    weapon: { dmg: 22, dtype: 'bullet', range: 175, cd: 0.5, projectile: 'tracer', aa: false, ga: true },
  },
  rocketeer: {
    name: 'Javelin Trooper', icon: '🚀', cost: 320, hp: 240, speed: 56, sight: 7, radius: 7,
    armor: 'inf', buildTime: 6, chassis: 'rocketinf', desc: 'Anti-tank / anti-air missile infantry.',
    weapon: { dmg: 84, dtype: 'rocket', range: 210, cd: 1.9, projectile: 'missile', aa: true, ga: true },
  },
  commando: {
    name: 'Praetorian Commando', icon: '🎖️', cost: 1200, hp: 1400, speed: 78, sight: 9, radius: 8,
    armor: 'inf', buildTime: 15, chassis: 'commando',
    stealthAir: true, decloakOnFire: 2, detect: 200, fieldRegen: 5,
    resist: { explosive: 0.5, flame: 0.5 },
    desc: 'Elite special forces — build as many as you can afford. Cloaked while not firing (+50% damage striking from stealth), reveals nearby stealth, shrugs off blasts and flame, self-heals out of combat. 5× the soldier for 5× the price.',
    weapon: { dmg: 120, dtype: 'bullet', range: 260, cd: 0.5, projectile: 'tracer', aa: false, ga: true },
  },
  bulwark: {
    name: 'Bulwark Tank', icon: '🛡️', cost: 900, hp: 1860, speed: 74, sight: 6, radius: 17,
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
    name: 'Rifleman', icon: '🪖', cost: 140, hp: 220, speed: 58, sight: 5, radius: 7,
    armor: 'inf', buildTime: 3.5, chassis: 'inf', desc: 'Cheap conscript infantry. Strength in numbers (Horde bonus).',
    weapon: { dmg: 18, dtype: 'bullet', range: 165, cd: 0.55, projectile: 'tracer', aa: false, ga: true }, horde: true,
  },
  rpg: {
    name: 'RPG Squad', icon: '🚀', cost: 280, hp: 240, speed: 54, sight: 6, radius: 7,
    armor: 'inf', buildTime: 5.5, chassis: 'rocketinf', desc: 'Anti-tank / anti-air rockets. Horde bonus.',
    weapon: { dmg: 80, dtype: 'rocket', range: 200, cd: 2.0, projectile: 'missile', aa: true, ga: true }, horde: true,
  },
  warlord: {
    name: 'Warlord Tank', icon: '💪', cost: 1400, hp: 3450, speed: 52, sight: 6, radius: 21,
    armor: 'heavy', buildTime: 16, chassis: 'heavytank', desc: 'Massive twin-cannon assault tank. Slow but devastating. Horde bonus.',
    weapon: { dmg: 65, dtype: 'cannon', range: 220, cd: 1.3, projectile: 'shell', splash: 30, aa: false, ga: true }, horde: true,
  },
  flak: {
    name: 'Quad Flak', icon: '💥', cost: 700, hp: 380, speed: 85, sight: 7, radius: 15,
    armor: 'light', buildTime: 8, chassis: 'buggy', desc: 'Flak cannons. Excellent anti-air, good vs infantry.',
    weapon: { dmg: 26, dtype: 'flak', range: 240, cd: 0.55, projectile: 'flakburst', splash: 22, aa: true, ga: true },
  },
  salamander: {
    name: 'Salamander', icon: '🔥', cost: 850, hp: 1440, speed: 78, sight: 5, radius: 16,
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
    name: 'Raider', icon: '🔫', cost: 130, hp: 200, speed: 72, sight: 6, radius: 7,
    armor: 'inf', buildTime: 3, chassis: 'inf', desc: 'Fast, cheap SMG fighter.',
    weapon: { dmg: 16, dtype: 'bullet', range: 150, cd: 0.35, projectile: 'tracer', aa: false, ga: true },
  },
  rocketraider: {
    name: 'Rocket Raider', icon: '🚀', cost: 260, hp: 220, speed: 62, sight: 6, radius: 7,
    armor: 'inf', buildTime: 5, chassis: 'rocketinf', desc: 'Anti-tank / anti-air rockets.',
    weapon: { dmg: 76, dtype: 'rocket', range: 200, cd: 2.0, projectile: 'missile', aa: true, ga: true },
  },
  jackal: {
    name: 'Jackal Tank', icon: '🐺', cost: 620, hp: 1290, speed: 92, sight: 6, radius: 16,
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
/* Superweapon payloads. Each blast is ten times the radius and three times the
   damage of the original design, and the multi-shot strikes spread their
   impacts ten times as wide so the footprint really is ten times across rather
   than one enormous crater with the whole salvo stacked inside it. */
const SUPERWEAPONS = {
  solaris: {
    name: 'Solaris Beam', desc: 'Orbital energy beam sweeps a vast corridor across the map.',
    shots: 14, dmg: 5670, splash: 650, spread: 340,
  },
  nuke: {
    name: 'Nuclear Missile', desc: 'District-erasing nuclear strike.',
    dmg: 43200, splash: 2300,
  },
  rocketstorm: {
    name: 'Rocket Storm', desc: '24 heavy rockets saturate an enormous area.',
    shots: 24, dmg: 4050, splash: 700, spread: 1600,
  },
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
    { key: 'vehiclerepair', name: 'Field Service', icon: '🔧', costMul: 0.75,
      desc: 'Factory mechanics repair nearby friendly vehicles and aircraft (14 hp/s, like a small Repair Center).' },
    { key: 'plating', name: 'Armor Plating', icon: '🛡️', costMul: 1.0,
      desc: 'Hardened walls — all damage taken by this factory is reduced by 25%.' },
  ],
  artfort: [
    { key: 'firepower', name: 'Siege Charges', icon: '⚔️', costMul: 0.15,
      desc: 'Shells hit 50% harder with a 20% wider blast.' },
    { key: 'longrange', name: 'Extended Barrel', icon: '🎯', costMul: 0.2,
      desc: 'Firing range +30% — nothing on the ground can answer it.' },
    { key: 'plating', name: 'Bastion Armour', icon: '🛡️', costMul: 0.25, hpMul: 1.6,
      desc: 'Maximum health +60% and all incoming damage reduced by 25%.' },
  ],
  artdef: [
    { key: 'firepower', name: 'Heavy Shells', icon: '⚔️', costMul: 0.75,
      desc: 'Shells hit 50% harder with a 20% wider blast.' },
    { key: 'longrange', name: 'Extended Barrel', icon: '🎯', costMul: 0.9,
      desc: 'Firing range +30% — outranges anything that can shoot back.' },
    { key: 'plating', name: 'Hardened Casemate', icon: '🛡️', costMul: 1.0, hpMul: 1.6,
      desc: 'Maximum health +60% and all incoming damage reduced by 25%.' },
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
const TROOP_CHASSIS = ['inf', 'rocketinf', 'commando'];

/* ---- field upgrades ----
   Every unit in the army can be refitted, without limit. Tanks, artillery
   carriages, gunships, strike jets and infantry squads all buy ⚔ Gun and
   🛡 Armor levels for a flat 30% of their own price, and they never run out:
   there is no veterancy gate and no level cap, so a hull you keep alive can be
   improved for as long as you are willing to pay for it.

   The economics hold that open: each level costs 0.30x the unit's price and
   returns 0.25x its base damage or health, so buying twenty levels costs six
   times the unit and yields five times its output — always a slightly worse
   deal than simply building more, which keeps the wallet the real limit. */
const VEHICLE_CHASSIS = ['tank', 'heavytank', 'flametank', 'aatank', 'mlrs', 'buggy', 'demorig'];
const FIELD_UP_COST_MUL = 0.3;          // Special levels, as a share of the unit's price
const FIELD_UP_PREMIUM = 1.2;           // Gun/Armor cost this much over the going rate for the stat

/* ---- what a Gun or Armor level costs ----
   A level adds a fixed fraction of the unit's BASE stat, so billing it as a fraction
   of the unit's PRICE let stat-efficient hulls buy absolute power far more cheaply
   than expensive ones: twenty levels put a Goliath at $0.42 per point of health while
   a Leviathan paid $1.56 and an Annihilator $18.15 for the same relative gain. Mass
   won outright, and no amount of levels closed the gap because the multiplier simply
   preserved whatever efficiency the hull started with.

   Levels are priced off the stat they actually add instead, at the game-wide going
   rate for health and for damage. A point of armour costs the same whoever bolts it
   on, and a point of damage likewise, so upgrading is proportional by construction.
   The rate is the roster median rather than the mean so one outlier hull cannot drag
   the whole economy, and the 1.2 premium keeps upgrading a slightly worse deal than
   simply building more — the property that lets the levels stay uncapped. */
let _upRate = null;
function upgradeRates() {
  if (_upRate) return _upRate;
  const hp = [], dmg = [];
  for (const k in UNITS) {
    const u = UNITS[k];
    if (u.builder || u.harvester || !u.cost) continue;
    hp.push(u.hp / u.cost);
    const a = unitAlpha(u);
    if (a > 0) dmg.push(a / u.cost);
  }
  const median = a => { a.sort((x, y) => x - y); return a[Math.floor(a.length / 2)]; };
  _upRate = { hpPer$: median(hp), dmgPer$: median(dmg) };
  return _upRate;
}
/* What a gun level actually buys: damage per shot. That is the exact parallel of the
   health an armour level buys, and it sidesteps the pathologies of pricing on DPS —
   which flatters a rapid-fire jet that only carries two missiles and undervalues a
   siege gun whose worth is in the shell, not the cadence. Rate of fire is what the
   Special sells, and it is priced separately. */
function unitAlpha(def) {
  if (def.weapon) return def.weapon.dmg;
  if (def.suicide) return def.suicide.dmg;
  return 0;
}

function isGroundVehicle(u) {
  const d = (u && u.def) || u;
  return !!d && !d.air && VEHICLE_CHASSIS.includes(d.chassis);
}
/* Armor plating goes on anything with a hull; a gun upgrade needs a gun to bore
   out, so the unarmed support units (dozer, supply truck, radar van, recon plane)
   get plating only. */
function isFieldUpgradable(u, kind) {
  const d = (u && u.def) || u;
  if (!d || !d.chassis) return false;
  if (kind === 'gun') return !!(d.weapon || d.suicide);
  if (kind === 'special') {
    const s = SPECIALS[d.chassis];
    // a faster reload or a longer reach means nothing without a weapon to fit it to
    return !!s && (s.effect === 'speed' || !!d.weapon);
  }
  return true;
}

/* Field self-repair. A tank crew carries spare track, plating and a welding kit
   and patches its own hull between engagements far faster than a rifleman can
   patch himself, so armour runs on its own curve. */
const VEHICLE_REGEN = [0, 0, 11.25, 22.5, 39.375, 468.75];   // hp/s by veterancy rank
function vetRegenRate(u) {
  return (isGroundVehicle(u) ? VEHICLE_REGEN : VET_REGEN)[u.vetRank] || 0;
}
/* ---- the ⚙ Special ----
   Alongside its gun and its plating every unit carries one signature system it
   can keep improving on exactly the same terms: unlimited levels, +25% each,
   30% of the unit's price. What that system IS depends on the hull, so a tank's
   third upgrade is not a jet's. Three mechanisms cover the roster — rate of
   fire, weapon range and top speed. */
const SPECIALS = {
  tank:      { name: 'Autoloader',        short: 'Loader',  icon: '🔁', effect: 'rof' },
  heavytank: { name: 'Autoloader',        short: 'Loader',  icon: '🔁', effect: 'rof' },
  flametank: { name: 'Pressure Feed',     short: 'Feed',    icon: '🔥', effect: 'rof' },
  aatank:    { name: 'Tracking Radar',    short: 'Radar',   icon: '📡', effect: 'range' },
  mlrs:      { name: 'Extended Barrel',   short: 'Barrel',  icon: '🎯', effect: 'range' },
  buggy:     { name: 'Tuned Suspension',  short: 'Susp',    icon: '🏁', effect: 'speed' },
  demorig:   { name: 'Nitro Injection',   short: 'Nitro',   icon: '🏁', effect: 'speed' },
  inf:       { name: 'Combat Drills',     short: 'Drills',  icon: '🎖️', effect: 'rof' },
  rocketinf: { name: 'Combat Drills',     short: 'Drills',  icon: '🎖️', effect: 'rof' },
  commando:  { name: 'Combat Drills',     short: 'Drills',  icon: '🎖️', effect: 'rof' },
  heli:      { name: 'Rotor Tuning',      short: 'Rotors',  icon: '🚁', effect: 'speed' },
  jet:       { name: 'Afterburners',      short: 'Burners', icon: '💨', effect: 'speed' },
  dozer:     { name: 'Overhauled Engine', short: 'Engine',  icon: '🔧', effect: 'speed' },
  truck:     { name: 'Overhauled Engine', short: 'Engine',  icon: '🔧', effect: 'speed' },
  radar:     { name: 'Overhauled Engine', short: 'Engine',  icon: '🔧', effect: 'speed' },
};
const FIELD_UP_STEP = 0.25;             // what one level of any field upgrade is worth
/* Gun and Armor stack without limit; a Special tops out at exactly double. Doubling a
   reload, a reach or a top speed is the whole point of the system — past that it stops
   being a refit and starts rewriting what the hull is. */
const SPECIAL_MAX_MUL = 2;
const SPECIAL_MAX_LEVEL = Math.round((SPECIAL_MAX_MUL - 1) / FIELD_UP_STEP);

function specialOf(u) { return SPECIALS[chassisOf(u)] || null; }
function specialMul(u, effect) {
  const s = specialOf(u);
  if (!s || s.effect !== effect) return 1;
  return 1 + FIELD_UP_STEP * Math.min(SPECIAL_MAX_LEVEL, u.specialLvl || 0);
}
/* the unit's effective numbers once its ⚙ system is counted */
function effCd(w, u) { return w.cd / specialMul(u, 'rof'); }
function effRange(w, u) { return w.range * specialMul(u, 'range'); }
function effSpeed(u) { return u.def.speed * specialMul(u, 'speed'); }

function fieldUpLevel(u, kind) {
  return (kind === 'gun' ? u.gunLvl : kind === 'armor' ? u.armorLvl : u.specialLvl) || 0;
}
function canFieldUpgrade(u, kind) {
  if (!u || u.dead || u.kind !== 'unit' || !isFieldUpgradable(u, kind)) return false;
  return kind !== 'special' || fieldUpLevel(u, 'special') < SPECIAL_MAX_LEVEL;
}
function fieldUpCost(u, faction, kind) {
  const d = u.def || u;
  const r = upgradeRates();
  if (kind === 'gun') return Math.max(10, Math.round(FIELD_UP_STEP * unitAlpha(d) / r.dmgPer$ * FIELD_UP_PREMIUM));
  if (kind === 'armor') return Math.max(10, Math.round(FIELD_UP_STEP * d.hp / r.hpPer$ * FIELD_UP_PREMIUM));
  // the Special is capped at 2x, so it cannot run away and stays priced off the hull
  return Math.max(10, Math.round(uCost(u.key, faction) * FIELD_UP_COST_MUL));
}

/* ---- transport loading rules ----
   A transport has two independent holds: a troop bay sized by `capacity` and,
   on aircraft fitted with a belly cradle, `tankSlots` slots for armour. They
   never compete for the same space, so twenty riflemen and a tank fit at once. */
function chassisOf(u) { return u && (u.def ? u.def.chassis : u.chassis); }
function isTroopUnit(u) { return TROOP_CHASSIS.includes(chassisOf(u)); }
function isTankUnit(u) { return TANK_CHASSIS.includes(chassisOf(u)); }

/* live occupancy of a transport, split by hold */
function cargoLoad(tr) {
  let troops = 0, tanks = 0;
  if (tr && tr.cargo) for (const id of tr.cargo) {
    const p = game.byId.get(id);
    if (!p || p.dead) continue;
    if (isTankUnit(p)) tanks++; else troops++;
  }
  return { troops, tanks };
}

function isTransport(tr) { return !!(tr && tr.cargo && (tr.def.capacity || tr.def.tankSlots)); }

/* can `u` climb into `tr` right now? */
function canBoard(u, tr) {
  if (!u || u.dead || u.embarked || !isTransport(tr) || tr.dead || u === tr) return false;
  const load = cargoLoad(tr);
  if (isTankUnit(u)) return load.tanks < (tr.def.tankSlots || 0);
  if (isTroopUnit(u)) return load.troops < (tr.def.capacity || 0);
  return false;
}

/* compact "3/20 · 1/1" readout for the canvas and HUD */
function cargoLabel(tr) {
  const load = cargoLoad(tr);
  let s = '';
  if (tr.def.capacity) s += '🪖' + load.troops + '/' + tr.def.capacity;
  if (tr.def.tankSlots) s += (s ? ' ' : '') + '🛡' + load.tanks + '/' + tr.def.tankSlots;
  return s;
}

function uCost(key, faction, owner) {
  const u = UNITS[key];
  let c = u.cost;
  const isTank = TANK_CHASSIS.includes(u.chassis);
  if (faction !== 'coalition' && isTank) c = Math.round(c * 0.5);
  else if (faction === 'cartel') {
    if (u.chassis === 'inf' || u.chassis === 'rocketinf' || u.chassis === 'commando') c = Math.round(c * 0.6);
    else if (!u.air && !u.builder && !u.harvester) c = Math.round(c * 0.7);
  }
  if (isAIPlayer(owner)) c = Math.round(c * AI_UNIT_COST_MUL);
  return c;
}

/* AI handicap: their factories are cheaper and faster than yours */
function isAIPlayer(owner) {
  if (owner === undefined || owner === null) return false;
  if (typeof game === 'undefined' || !game.players) return false;
  const p = game.players[owner];
  return !!(p && p.isAI);
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
function defenseWeapon(key, faction) { return BUILDINGS[key].weaponByFaction[faction]; }
