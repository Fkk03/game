// Screenshot harness: boots a static server, loads the game in headless Chromium,
// waits for window.__photoReady, and captures PNGs for the visual-critic pipeline.
// Usage: node tools/shot.mjs [photoPreset ...]   (default: all presets 1..6)
import { chromium } from 'playwright-core';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json' };

const server = createServer(async (req, res) => {
  try {
    let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (p === '/') p = '/index.html';
    const file = normalize(join(root, p));
    if (!file.startsWith(root)) { res.writeHead(403); res.end(); return; }
    const data = await readFile(file);
    res.writeHead(200, { 'content-type': MIME[extname(file)] || 'application/octet-stream' });
    res.end(data);
  } catch { res.writeHead(404); res.end('nf'); }
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const port = server.address().port;

const presets = process.argv.slice(2).length ? process.argv.slice(2) : ['1', '2', '3', '4', '5', '6'];
const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium',
  args: ['--no-sandbox', '--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--disable-gpu-sandbox', '--in-process-gpu'],
});
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
page.on('console', m => { if (m.type() === 'error') console.error('[console.error]', m.text()); });
page.on('pageerror', e => console.error('[pageerror]', e.message));

for (const n of presets) {
  const t0 = Date.now();
  await page.goto(`http://127.0.0.1:${port}/index.html?photo=${n}`, { waitUntil: 'load' });
  try {
    await page.waitForFunction('window.__photoReady === true', null, { timeout: 90000 });
  } catch {
    console.error(`preset ${n}: __photoReady timeout`);
  }
  await page.screenshot({ path: join(root, 'shots', `photo${n}.png`) });
  console.log(`shots/photo${n}.png  (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
}
await browser.close();
server.close();
