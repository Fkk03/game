// Live-gameplay smoke test: boots the real game (no photo mode), starts via the
// test API, lets rounds run, fires at zombies, and reports a JSON verdict.
import { chromium } from 'playwright-core';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };
const server = createServer(async (req, res) => {
  try {
    let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (p === '/') p = '/index.html';
    const file = normalize(join(root, p));
    const data = await readFile(file);
    res.writeHead(200, { 'content-type': MIME[extname(file)] || 'application/octet-stream' });
    res.end(data);
  } catch { res.writeHead(404); res.end(); }
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const port = server.address().port;

const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium',
  args: ['--no-sandbox', '--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--in-process-gpu', '--autoplay-policy=no-user-gesture-required'],
});
const page = await browser.newPage({ viewport: { width: 800, height: 450 } });
const errors = [];
page.on('pageerror', e => errors.push(e.message));
page.on('console', m => {
  if (m.type() === 'error' && !m.text().includes('404')) errors.push('console: ' + m.text());
});

await page.goto(`http://127.0.0.1:${port}/index.html`, { waitUntil: 'load' });
await page.waitForTimeout(2500); // module init
await page.evaluate('window.__testAPI.start()');
// drive the sim deterministically (headless rAF only ticks on frame requests,
// so we step manually — real browsers run the rAF loop normally)
await page.evaluate('window.__testAPI.step(1500)'); // ~25s: zombies breach and chase
const mid = await page.evaluate('window.__testAPI.state()');
// fire the magazine, re-aiming at the nearest chasing zombie's chest each shot
for (let i = 0; i < 8; i++) {
  await page.evaluate(`(() => {
    const G = window.__G, P = G.player;
    const zs = G.zombies.list.filter(z => !z.gone && ['chasing','attacking','tearing'].includes(z.state));
    if (zs.length) {
      let best = zs[0], bd = 1e9;
      for (const z of zs) { const dx = z.group.position.x - P.pos.x, dz = z.group.position.z - P.pos.z, d = Math.hypot(dx, dz); if (d < bd) { bd = d; best = z; } }
      const dx = best.group.position.x - P.pos.x, dz = best.group.position.z - P.pos.z;
      P.yaw = Math.atan2(-dx, -dz);
      P.pitch = Math.atan2(1.1 - 1.62, Math.hypot(dx, dz));
    }
    window.__testAPI.shoot();
    window.__testAPI.step(20);
  })()`);
  await page.waitForTimeout(70);
}
await page.evaluate('window.__testAPI.step(240)');
const end = await page.evaluate('window.__testAPI.state()');
// buy the rifle wall-buy? just report state.
const result = {
  ok: errors.length === 0 && end.round >= 1 && (mid.zombies > 0 || end.zombies > 0),
  errors: errors.slice(0, 6),
  midGame: mid,
  endGame: end,
  killsGained: end.kills - 0,
  pointsNow: end.points,
};
console.log(JSON.stringify(result, null, 2));
await browser.close();
server.close();
process.exit(result.ok ? 0 : 1);
