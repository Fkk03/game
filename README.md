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
  first team to 1,000 wins (annihilation also wins). A second 💰 Trade Point gives the
  controlling team +30% income. Classic annihilation-only mode still selectable.
- **Live battle stats** — Tab toggles a scoreboard with kills and army value for every
  general (allies and enemies); the top bar shows your income and spending per minute
- **Up to 14 players** — choose 0–5 allied AI generals and 1–8 enemies; the map auto-scales
  (up to the Colossal size), allies share your radar and fight beside you
- **Rubber-band AI** — every AI constantly compares its total strength (army + base + cash)
  with the leading general; falling behind makes it build harder, expand faster and attack
  more often. Full armies never sit at home, mined-out AIs immediately expand to fresh
  supplies, and stuck construction is recycled instead of freezing the base
- **3 asymmetric factions**
  - 🦅 **Meridian Coalition** — expensive high-tech elite units, strike jets, precision firepower
  - 🐲 **Crimson Dynasty** — cheap infantry hordes (Horde bonus!), heavy Warlord tanks, flame weapons, nukes
  - 🦂 **Scorpion Cartel** — dirt-cheap fast guerrillas, **needs no power grid**, salvages wrecks to upgrade vehicles
- **Dozer-based construction** — select your Dozer/Worker, pick a structure, place it anywhere you've scouted
- **Supply economy** — rich supply piles scattered all across the map; Supply Trucks haul them
  to your Supply Center, Markets pay a fat $32/s trickle
- **Repair Center** — automatically fixes your tanks and aircraft in a radius around it
- **Nuclear Reactor** — 5× the power of a standard plant… but if it's destroyed, the
  meltdown devastates everything nearby, yours and theirs alike. High risk, high reward.
- **Global production (B / T / J)** — order units without clicking each building: the
  panel commands ALL your barracks / war factories / airfields at once and auto-splits
  orders across the least-busy queues (airfield pad limits respected). Shift-click = ×5.
- **Idle-worker button (I)** — one click (bottom-left 🚜) cycles through every idle
  dozer/worker so nobody stands around doing nothing
- **End-game arsenal** — superheavy tanks (3× cost, 4× power), elite strike aircraft,
  extreme-range siege artillery (range 1,350 — bring spotters), compact hardened turrets
- **Balanced air power** — aircraft deal 70% damage to units and only 30% to structures;
  jets are for battlefield strikes, not free base-deletion
- **Kestrel/Hornet Multirole** — dogfighter + ground-attack in one airframe: 8 light
  missiles fired in controlled 2-missile bursts, automatically switching targets instead
  of wasting the rack on something already doomed
- **Spy war** — unarmed stealth spy planes with enormous sight, invisible to the enemy
  unless a satellite-detection radar truck is in scan range
- **Power grid** — run out of power and production crawls while defenses go offline
- **General's promotions** — combat XP earns ranks; spend points on 5 powers per faction:
  recon sweeps, airstrikes, artillery barrages, paradrops, emergency supply drops, war frenzy,
  sabotage, ambushes, carpet bombing, thermobaric bombs…
- **Superweapons** — Solaris Beam / Nuclear Missile / Rocket Storm, on a 5-minute countdown
  that both players can see
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
