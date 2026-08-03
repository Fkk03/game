// fow.js — fog of war: unexplored black, explored dim, visible clear.
// OWNED BY: ui agent. STATUS: STUB — implement per this contract.
// Design: 128×128 vis grid over the world. Each own/allied entity reveals
// sight radius each tick (cheap: update 1/8 of entities per frame).
// States per cell: 0 unexplored, 1 explored, 2 visible (decays to 1).
// Render: one big ground-hugging plane with an alpha CanvasTexture updated
// at ~8Hz (blur the canvas for soft edges); minimap multiplies the same
// canvas. Enemy entities: mesh.visible = cell visible (or air over
// explored). API: initFow(); tickFow(dt); G.fow.visibleAt(x,z)->0|1|2;
// SHOT_MODE disables fog entirely (reveal all) for screenshots.
import { G, SHOT_MODE } from './core.js';

export function initFow() {
  G.fow = { visibleAt: () => 2, enabled: !SHOT_MODE };
}
export function tickFow(dt) { /* stub */ }
