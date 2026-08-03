#!/usr/bin/env node
// shots.js — headless screenshot harness for visual review (RTS).
// Usage: node rts/tools/shots.js [outDir] [view1,view2,...]
// A view may carry extra URL params after a colon, e.g. "base:t=90&fac=cartel"
// (saved as base_t=90&fac=cartel.png → sanitized to base_t90.png).
// Available views (see main.js startShotMode): overview, base, baseclose,
// enemybase, village, oilfield, valley, dock, army, ui.
// Extra params: t=NN fast-forward sim seconds, fac=cartel, ui=1 (HUD on),
// live (sim keeps running).
const http = require('http');
const fs = require('fs');
const path = require('path');

const FPS_DIR = path.resolve(__dirname, '..');
const OUT = process.argv[2] || path.join(__dirname, 'out');
const VIEWS = (process.argv[3] || 'overview,base,baseclose,enemybase,village,oilfield,valley,dock,army,ui')
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
    const [vname, extra] = view.split(':');
    const fname = (vname + (extra ? '_' + extra.replace(/[^a-z0-9]+/gi, '') : ''));
    try {
      await page.goto(`http://127.0.0.1:${port}/?shot=${vname}&seed=1337${extra ? '&' + extra : ''}`,
        { waitUntil: 'load', timeout: 30000 });
      await page.waitForFunction('window.__shotReady === true', null, { timeout: 120000 });
      await page.screenshot({ path: path.join(OUT, `${fname}.png`) });
      console.log(`ok ${view}`);
    } catch (e) {
      console.error(`FAIL ${view}: ${e.message.split('\n')[0]}`);
      failed = true;
      try { await page.screenshot({ path: path.join(OUT, `${fname}-FAILED.png`) }); } catch {}
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
