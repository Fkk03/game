# ⭐ IRON DAWN — a modern-warfare RTS in your browser

An original, fan-made homage to the golden age of desert-war real-time strategy games
(think early-2000s "build a base, command a general, fire the superweapon" gameplay).
**Zero installs, zero dependencies, zero build step** — pure HTML5 Canvas + JavaScript.

> This is an original game: all names, graphics (procedurally drawn), sounds
> (synthesized in-browser with WebAudio) and code were created from scratch.
> No assets or code from any commercial game are used. Not for sale.

## ▶ How to play it

**Option 0 (easiest — one file):** download **`IronDawn.html`** (the whole game bundled
into a single file) and double-click it. Nothing else needed.

**Option 1:** download/clone the repo, keep the folder together, double-click `index.html` —
it runs straight off the disk in any modern browser (Chrome / Edge / Firefox).

**Option 2 (recommended):**

```bash
cd game
python3 -m http.server 8080
# then open http://localhost:8080
```

## 🎮 The game

- **Domination mode** — hold the central ⚑ control point uncontested to earn ~30 pts/min;
  first team to 1,000 wins (annihilation also wins). A second 💰 Trade Point DOUBLES the
  controlling team's income. Classic annihilation-only mode still selectable.
- **Live battle stats** — Tab toggles a scoreboard with kills, army value and **current
  cash** for every general, allies and enemies alike, so you can see exactly how rich the
  AI is before its next wave; the top bar shows your income and spending per minute
- **Up to 14 players** — choose 0–5 allied AI generals and 1–8 enemies; the map auto-scales
  (up to the Colossal size), allies share your radar and fight beside you
- **Rubber-band AI** — every AI constantly compares its total strength (army + base + cash)
  with the leading general; falling behind makes it build harder, expand faster and attack
  more often. Full armies never sit at home, mined-out AIs immediately expand to fresh
  supplies, and stuck construction is recycled instead of freezing the base. AI bases
  keep walkable lanes between structures, and their defenses spread out across the
  threat-facing arc instead of clumping on one spot
- **Generals who think before they charge** — each AI keeps a live threat map of your
  defenses (every emplacement and dug-in squad, its reach and its rate of fire) and uses
  it to pick a fight it can win:
  - **Finds the weak point** — structures are ranked by worth against the fire covering
    them, so an undefended factory outranks a fortified one and half-built sites get
    rushed
  - **Picks the soft flank** — it rings the objective with candidate staging points and
    scores each approach corridor by the guns it crosses, then attacks from the quiet side
  - **Won't feed the grinder** — a wave only commits if it can actually break what's
    waiting; otherwise it peels the outer emplacements first. Reinforcements muster and
    move up as a group instead of trickling in one at a time, wounded units peel off to
    the repair bay, and artillery shells the line from outside its reach instead of
    driving into it
  - **Knows when to quit** — an assault that can't dent its objective breaks contact,
    regroups, and comes back heavier; the target and the doctrine that failed both go to
    the back of the queue
  - **Switches doctrine** — massed push, artillery siege, air strike or economy raid,
    chosen from what it has and what you've fortified. Dense anti-air makes it buy
    artillery instead of jets; an AA-blind gun line makes it press the air advantage
- **AI war chest** — every AI general is resupplied with **$100,000 every 10 minutes**,
  and their units cost half price and roll off the line in half the time, so the
  pressure never lets up in a long game
- **Generals who expand** — an AI never sits on its starting plot. It founds forward
  towns on fresh supply fields, grows each one its own war factories, airfields and
  barracks instead of stacking everything in the capital, and runs a construction
  corps of up to ten dozers so a full treasury becomes buildings instead of savings.
  Every wealth tier raises what it thinks it should own, so a rich general keeps
  building — after twenty minutes expect a dozen factories, a string of airfields
  and **turret belts fifty-plus emplacements deep** strung across its territory,
  covering every town, outpost and control point it holds. Getting a bomber or a
  tank column to their capital means fighting through all of it
- **3 asymmetric factions**
  - 🦅 **Meridian Coalition** — expensive high-tech elite units, strike jets, precision firepower
  - 🐲 **Crimson Dynasty** — cheap infantry hordes (Horde bonus!), heavy Warlord tanks, flame weapons, nukes
  - 🦂 **Scorpion Cartel** — dirt-cheap fast guerrillas, **needs no power grid**, salvages wrecks to upgrade vehicles
- **Dozer-based construction** — select your Dozer/Worker, pick a structure, place it anywhere you've scouted
- **Supply economy** — rich supply piles scattered all across the map; Supply Trucks haul them
  to your Supply Center, Markets pay a fat $32/s trickle
- **Repair Center** — automatically fixes your tanks and aircraft in a radius around it
  (now a compact 2-tile pad)
- **Building upgrades** — select a Barracks, War Factory or Airfield and buy one-time
  upgrades: Rapid Assembly (−30% production time), Auto-Repair (3%/3 s after 10 s of
  peace), Reinforced Structure (+50–100% health); Airfields add Fast Rearm (−30%
  turnaround) and Full Restoration (landing aircraft repaired to ≥50%); War Factories
  add Field Service (repairs nearby vehicles 14 hp/s) and Armor Plating (−25% damage taken)
- **Praetorian Commando** (Coalition, no build limit) — cloaked special forces: +50% damage
  striking from stealth, reveals nearby stealth units, resists blasts and flame,
  self-heals out of combat. 5× the soldier for 5× the price — field a whole legion
  if your wallet can take it
- **Cartel war economy** — Scorpion Cartel infantry costs 40% less and ground combat
  vehicles 30% less, everywhere prices appear
- **Cheap steel** — tanks cost 50% less for every faction EXCEPT the Meridian Coalition
- **Albatross Gunship** (Coalition) — a heavy combat transport helicopter (3× health and
  damage): carries 20 soldiers, guns down infantry with its chin turret and fires rockets
  at armor — hits like a heavy tank, but lumbers across the map at gunship pace.
  Select troops → right-click to board; Unload (F) deploys. Shot down = everyone dies
- **Twin base defenses** — every faction fields two: the rapid-fire **Gatling Defense**
  ($800, ~700 range — shreds infantry, light vehicles and aircraft, barely dents heavy
  armor) and the long-range **Artillery Defense** ($1,600, ~1,200 range — leads its
  shots to crack moving tanks open, but can't touch aircraft and has a close-in dead
  zone). Both go dark without grid power (the grid-less Cartel runs them off generators)
- **Point your guns** — emplacements fire on their own by default, but select one (or a
  whole line of them) and **right-click an enemy to assign that target by hand** —
  including enemy *structures*, which automatic fire never picks. Right-click open
  ground to release them back to automatic. An assigned target that dies clears the
  order; one that's out of reach is remembered while the gun still defends itself, and
  it opens up the moment the target closes. Selected emplacements show their firing
  envelope, their dead zone, and a lock line to whatever you've told them to kill
- **Artillery upgrades** — select an Artillery Defense to buy **Heavy Shells**
  (+50% damage, +20% blast, $1,200), **Extended Barrel** (+30% range, $1,440) and
  **Hardened Casemate** (+60% health and −25% damage taken, $1,600). A fully upgraded
  battery outranges everything that can shoot back at it
- **Queued construction** — hold Shift while placing buildings to chain up build sites;
  your dozer works through the whole list on its own
- **Hardened bases** — every structure has 3× health; razing a base is a siege, not a drive-by
- **Regenerating supplies** — exhausted supply piles refill after 20 minutes to
  75%, then 50%, then 25% (repeating at 25%); an on-map ⏳ timer shows the countdown
- **Public superweapons** — the moment ANY general breaks ground on a superweapon,
  every player gets a warning and a blinking marker on the minimap until it dies
- **Persistent battlefield** — wrecked tanks, burned-out airframes, craters, rubble and
  scorch marks are baked into the terrain and never fade
- **Nuclear Reactor** — 5× the power of a standard plant… but if it's destroyed, the
  meltdown devastates everything nearby, yours and theirs alike. High risk, high reward.
- **Global production (B / T / J)** — order units without clicking each building: the
  panel commands ALL your barracks / war factories / airfields at once and auto-splits
  orders across the least-busy queues (airfield pad limits respected). Shift-click = ×5.
- **Idle-worker button (I)** — one click (bottom-left 🚜) cycles through every idle
  dozer/worker so nobody stands around doing nothing
- **End-game arsenal** — superheavy tanks (3× cost, 4× power), elite strike aircraft,
  compact hardened turrets
- **Armoured warfare** — every tank has **3× health**: Bulwark 1,860, Warlord 3,450,
  Aegis 3,450, Paragon 7,800. Armour columns now trade blows for a long time instead
  of melting, and veterancy plus 🛡 Armor upgrades stack on top of the new baseline
- **Siege artillery, range 4,050** — the Longbow / Great Wall Gun / Doomsday Cannon
  outranges every emplacement in the game more than threefold and shells bases from
  well outside their reply. It stays slow and fragile, and it is **blind on its own**:
  past its own sight it only auto-fires at targets your team can actually see, so bring
  spotters — or right-click a target yourself and it will shell it at full reach
- **Balanced air power** — aircraft deal 70% damage to units and only 30% to structures;
  jets are for battlefield strikes, not free base-deletion
- **Kestrel/Hornet Multirole** — dogfighter + ground-attack in one airframe: 8 light
  missiles fired in controlled 2-missile bursts, automatically switching targets instead
  of wasting the rack on something already doomed
- **Aegis Storm / Dragonhail / Sky Reaper** — elite quad-autocannon AA tank (all factions):
  3× the cost of standard AA, ~4× the punch — 340 range, heavy armor, shreds strike jets
  before they can line up a second pass
- **Spy war** — unarmed stealth spy planes with enormous sight, completely undetectable
  and untouchable: no weapon in the game can target or harm a pure recon plane
- **Obsidian Strategic Bomber** (Coalition only, **max 2**, $100,000) — a cloaked
  flying wing carrying **one** nuclear payload. The bomb does 22,500 damage in a
  400-radius blast — the largest detonation in the game, wider than a Nuclear
  Missile — and unlike every other aircraft it hits structures at *full* force
  rather than the usual 30%, so one drop levels a Command Center and everything
  parked around it. After releasing it flies home, rearms, and goes again.
  Twice an Umbra's health, but slow, and briefly visible after every release
- **Umbra Ghost Strike** (Coalition only) — a cloaked super-jet, 3–4× a Seraph:
  six 2,250-dmg missiles, faster, far tougher. Dimmed colors = cloaked (only
  detectors see it); firing exposes it for ~1 s (colors flare bright + decloak
  ring) before it fades back out
- **Stealth Retrofit** (Coalition only) — any aircraft with ★ veterancy can be
  fitted with a cloak for $2,000 (select the plane → 🌑 button / hotkey R). Same
  rules as the Umbra: invisible in flight, ~1 s visible after firing
- **Cloak armor** — while a stealth aircraft's cloak is active, every hit against
  it (flak, rockets, bullets, defenses) deals half damage — cloak buys you a
  scattered targeting lock, not invulnerability
- **Pick your corner** — a lobby option chooses your team's approximate start
  bearing (N/S/E/W and diagonals); enemies spawn on the opposite side
- **Superweapons toggle** — a lobby switch to allow or disable superweapons for the
  whole match (you and every AI)
- **Power grid** — run out of power and production crawls while defenses go offline
- **General's promotions** — combat XP earns ranks; spend points on 5 powers per faction:
  recon sweeps, airstrikes, artillery barrages, paradrops, emergency supply drops, war frenzy,
  sabotage, ambushes, carpet bombing, thermobaric bombs…
- **Superweapons** — Solaris Beam / Nuclear Missile / Rocket Storm, on a 5-minute countdown
  that both players can see
- **Full stats on click** — select any unit or building to see its complete combat
  card: damage per shot/missile, range, blast, speed, armor class, sight, ammo,
  personal kill count, cloak state, income/power for structures, and owned upgrades
- **Tank field upgrades** — tanks with ★ veterancy can buy ⚔ Gun (+25% damage) and
  🛡 Armor (+25% health) upgrades, one level per star up to 3, each costing 30% of
  the tank's price; bonuses stack with veterancy and survive promotions
- **Unit veterancy up to ★★★★★** — every star adds damage and max health (up to +80%);
  from 2 stars units self-repair in the field, faster with each rank, and the Repair
  Center services veteran crews +25% faster per star
- **Fog of war**, **minimap**, control groups, attack-move,
  waypoint queues, rally points, a skirmish AI with 3 difficulties, procedural desert maps
- **Win** by destroying every enemy structure

## ⌨ Controls

| Input | Action |
|---|---|
| Left click / drag | Select units |
| Double-click | Select all of that type on screen |
| Right click | Move / Attack / Harvest / Repair / Set rally |
| Shift + right click | Queue waypoints |
| Shift + click (while placing) | Queue multiple construction sites |
| Q W E R / A S D F / Z X C V | Command-grid hotkeys (shown on buttons) |
| A / S / D | Attack-move · Stop · Guard area (with units selected) |
| I | Cycle idle workers |
| B / T / J | Global production panel: all barracks / factories / airfields (Shift-click = ×5) |
| Ctrl + 1–9 → 1–9 | Control groups (tap twice to center) |
| Mouse wheel | Zoom · Middle-drag / arrows / screen edge — pan |
| Space | Jump to last event · Backspace — jump to base |
| P | Pause · M — mute · F1 — help · Esc — menu |

## 🛠 Tech notes

- Plain ES2020, no frameworks, no modules — works over `file://`
- Fixed-timestep simulation (30 Hz) with interpolation-free rendering at vsync
- A* pathfinding with line-of-sight smoothing + local separation steering
- Procedural terrain (seeded value-noise, mirrored for fairness) with guaranteed connectivity
- Fog of war on a tile grid, cached-canvas terrain, all sprites drawn with Canvas 2D paths
- All audio synthesized live (WebAudio); optional EVA-style voice via the browser's speech synthesis
- The skirmish AI plays by (almost) all the same rules — it sees the map (no fog for AI)
  and gets an income multiplier on Hard; it fights for the control points and adapts its
  army composition to counter what you field (AA vs air, anti-tank vs armor, flame vs infantry)

## 📁 Files

```
index.html      shell + menus + HUD DOM
style.css       UI styling
js/util.js      math, RNG, noise
js/data.js      all unit/building/faction/power definitions
js/sfx.js       WebAudio synthesized sound + voice
js/world.js     map generation, fog of war, supplies, salvage
js/path.js      A* pathfinding
js/fx.js        particles, decals, floating text
js/ent.js       units, buildings, projectiles, combat
js/powers.js    General's Powers + superweapons
js/render.js    all drawing: terrain, sprites, minimap, cursor
js/ai.js        skirmish AI
js/input.js     mouse/keyboard, selection, orders, camera
js/ui.js        HUD, menus, command grid, tooltips
js/main.js      game loop, victory conditions
```

Have fun, General. 🫡
