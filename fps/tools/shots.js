#!/usr/bin/env node
// shots.js — headless screenshot harness for visual review.
// Usage: node fps/tools/shots.js [outDir] [view1,view2,...]
// Serves the fps/ folder, loads each ?shot=<view>, waits for readiness, saves PNGs.
const http = require('http');
const fs = require('fs');
const path = require('path');

const FPS_DIR = path.resolve(__dirname, '..');
const OUT = process.argv[2] || path.join(__dirname, 'out');
const VIEWS = (process.argv[3] || 'vista,road,base,gate,village,oasis,oilfield,overview,combat,gun')
  .split(',').filter(Boolean);

const MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
  '.png': 'image/png', '.json': 'application/json',
};

function serve() {
  return new Promise((resolve) => {
    const srv = http.createServer((req, res) => {
      const url = new URL(req.url, 'http://x');
      let file = path.join(FPS_DIR, decodeURIComponent(url.pathname));
      if (url.pathname === '/') file = path.join(FPS_DIR, 'index.html');
      fs.readFile(file, (err, data) => {
        if (err) { res.writeHead(404); res.end('nf'); return; }
        res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
        res.end(data);
      });
    });
    srv.listen(0, '127.0.0.1', () => resolve(srv));
  });
}

(async () => {
  let chromium;
  try {
    ({ chromium } = require('playwright-core'));
  } catch {
    ({ chromium } = require('/tmp/claude-0/-home-user-game/2e96b893-b1c9-552f-b956-3270c8afbfc9/scratchpad/node_modules/playwright-core'));
  }
  fs.mkdirSync(OUT, { recursive: true });
  const srv = await serve();
  const port = srv.address().port;
  const browser = await chromium.launch({
    executablePath: '/opt/pw-browsers/chromium',
    args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
  });
  const errors = [];
  let failed = false;
  for (const view of VIEWS) {
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
    page.on('console', m => { if (m.type() === 'error') errors.push(`[${view}] ${m.text()}`); });
    page.on('pageerror', e => errors.push(`[${view}] PAGEERROR: ${e.message}`));
    try {
      await page.goto(`http://127.0.0.1:${port}/?shot=${view}&seed=1337`, { waitUntil: 'load', timeout: 30000 });
      await page.waitForFunction('window.__shotReady === true', null, { timeout: 60000 });
      await page.screenshot({ path: path.join(OUT, `${view}.png`) });
      console.log(`ok ${view}`);
    } catch (e) {
      console.error(`FAIL ${view}: ${e.message.split('\n')[0]}`);
      failed = true;
      try { await page.screenshot({ path: path.join(OUT, `${view}-FAILED.png`) }); } catch {}
    }
    await page.close();
  }
  await browser.close();
  srv.close();
  if (errors.length) {
    console.error('--- console errors ---');
    for (const e of [...new Set(errors)].slice(0, 20)) console.error(e);
    failed = true;
  }
  process.exit(failed ? 1 : 0);
})();
