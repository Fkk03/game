# BLACKSITE 115 — architecture & contributor spec

COD-Zombies-style FPS in Three.js (r185, vendored in `lib/`, no build step).
Open `index.html` via any static server. **All assets are procedural** — textures
are canvas-generated (`src/textures.js`), audio is synthesized (`src/audio.js`).
No external fetches allowed (game must run offline).

## Module map & ownership

| File | Owns |
|---|---|
| `src/main.js` | boot, state machine (MENU/PLAYING/DEAD/PHOTO), loop, `G` object, test API |
| `src/world.js` | map geometry+materials, lighting, sky shader, colliders, nav bake, windows/doors/interactables/perks/wall-buys |
| `src/textures.js` | procedural texture makers (used by world + weapons) |
| `src/player.js` | movement, capsule collision, health, camera feel, interaction polling |
| `src/weapons.js` | weapon defs/viewmodels/firing/reload/ADS, mystery box, Pack-a-Punch, grenades, knife |
| `src/zombies.js` | zombie bodies+animation, AI states, rounds director, damage/gore, power-ups |
| `src/fx.js` | particle pools, decals, tracers, casings, gibs, barrel flames, explosions, lightning |
| `src/post.js` | EffectComposer: RenderPass → UnrealBloom → grade shader (ACES, vignette, grain, CA, sRGB) |
| `src/audio.js` | all sound (procedural WebAudio) + event wiring |
| `src/hud.js` | DOM HUD updates; `index.html` holds HUD markup/CSS |
| `src/easter.js` | easter eggs (teddies/song, meteors→Ray Gun, konami, radios, terminal, plush, lightning graffiti) |
| `src/photomode.js` | deterministic staged scenes for screenshots (`?photo=1..6`) |
| `src/pathfind.js` | grid A* (`NavGrid`) |
| `src/rng.js` | seeded RNG |

## The `G` object (created in main.js)

`G.scene/camera/renderer/composer`, `G.events` (on/emit bus), `G.player`,
`G.world` (colliders/windows/doors/interactables/nav/zones/fires/eePads…),
`G.weapons`, `G.zombies`, `G.fx`, `G.mats` (shared materials), `G.buffs`,
`G.addPoints(n,why)`, `G.spendPoints(n)`, `G.damagePlayer(dmg,fromPos)`,
`G.staticRay` (bullet-blocking meshes snapshot), `G.tickSim(dt)`, `G.renderFrame()`,
`G.moonBase`, `G.skyUniforms` (uTime/uLightning).

Key events: `update{dt,t}`, `shotFired`, `muzzle`, `tracer`, `wallHit`, `bloodHit`,
`hitmarker`, `zombieKilled`, `roundStart/End`, `doorOpened`, `plankTorn/Rebuilt`,
`explosion`, `powerup`, `perkBought`, `papStart/Done`, `boxRoll/Done/Take`,
`playerHurt/Died`, `power`, `lightning`, `subtitle`, `playSong`, `graveRise`.

## Conventions & gotchas

- Units: meters, y-up. Player eye 1.62. Map interior ≈ x[-26,26], z[-18,20].
- Zombie/body forward is **local +z**; `rotation.y = atan2(dx, dz)` faces (dx,dz).
- Camera yaw=0 looks toward **-z**; look dir = `(-sin yaw, ·, -cos yaw)`.
- Meshes that must NOT block bullets/raycasts: set `mesh.userData.noBlock = true`
  (decals, planks, viewmodels, transparent props). `G.staticRay` is snapshotted
  at init — new solid meshes added later won't block bullets.
- Color textures: `colorSpace = SRGBColorSpace`. Data maps (bump/rough): linear.
- Post pipeline outputs sRGB itself (`renderer.toneMapping = NoToneMapping`,
  grade shader does ACES + gamma). HDR bloom threshold 0.82 — emissives need
  `emissiveIntensity > 1` to bloom (e.g. zombie eyes 2.6).
- `Math.random` is fine in gameplay, but **photo mode must stay deterministic
  enough**: presets seed `G.seed = 1000+N` and pose zombies explicitly.
- Nav grid rebakes on door purchase (`G.world.bakeNav()`); colliders lower than
  0.5m or starting above y=0.8 don't block nav.
- Do not rename exported functions or change module boundaries.

## Screenshot / iteration workflow (the important part)

```
cd /home/user/game/zombies
node tools/shot.mjs 1 2 3 4 5 6     # or a subset; writes shots/photoN.png
```
Runs headless Chromium (SwiftShader). **Any `[pageerror]` line printed = the
game is broken — fix before anything else.** View results by Reading the PNG
files. ~15s per preset.

Presets: 1 courtyard horde vista · 2 window barricade interior · 3 viewmodel
hero shot (SMG mid-fire) · 4 graveyard risers + lightning + PaP · 5 mystery box
open (Ray Gun) · 6 high overview. Cameras live in `src/photomode.js`.

Headless smoke test of live gameplay: `window.__testAPI` in main.js
(`start()`, `state()`, `step(n)`, `shoot()`).
