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

- **Up to 8 players** — choose 0–3 allied AI generals and 1–7 enemies; the map auto-scales
  (up to the new Huge size), allies share your radar and fight beside you
- **3 asymmetric factions**
  - 🦅 **Meridian Coalition** — expensive high-tech elite units, strike jets, precision firepower
  - 🐲 **Crimson Dynasty** — cheap infantry hordes (Horde bonus!), heavy Warlord tanks, flame weapons, nukes
  - 🦂 **Scorpion Cartel** — dirt-cheap fast guerrillas, **needs no power grid**, salvages wrecks to upgrade vehicles
- **Dozer-based construction** — select your Dozer/Worker, pick a structure, place it anywhere you've scouted
- **Supply economy** — rich supply piles scattered all across the map; Supply Trucks haul them
  to your Supply Center, Markets pay a fat $32/s trickle
- **Repair Center** — automatically fixes your tanks and aircraft in a radius around it
- **Power grid** — run out of power and production crawls while defenses go offline
- **General's promotions** — combat XP earns ranks; spend points on 5 powers per faction:
  recon sweeps, airstrikes, artillery barrages, paradrops, emergency supply drops, war frenzy,
  sabotage, ambushes, carpet bombing, thermobaric bombs…
- **Superweapons** — Solaris Beam / Nuclear Missile / Rocket Storm, on a 5-minute countdown
  that both players can see
- **Unit veterancy** (★★★), **fog of war**, **minimap**, control groups, attack-move,
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
  and gets an income multiplier on Hard

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
