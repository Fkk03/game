// HUD: DOM-driven (crisp text). Points, popups, ammo, round counter, hitmarkers,
// crosshair spread, damage vignette, banners, prompts, buff timers, game over.
export function initHud(G) {
  const $ = (id) => document.getElementById(id);
  const H = G.hud = {
    root: $('hud'), round: $('round'), points: $('points'), popups: $('popups'),
    wname: $('wname'), ammo: $('ammo'), grenades: $('grenades'),
    prompt: $('prompt'), banner: $('banner'), subtitle: $('subtitle'),
    vign: $('health-vignette'), cross: $('crosshair'), hit: $('hitmarker'),
    menu: $('menu'), gameover: $('gameover'), gostats: $('gostats'), paused: $('paused'),
  };
  const E = G.events;

  E.on('points', () => { H.points.textContent = G.player.points.toLocaleString(); });
  E.on('points', ({ n, why }) => {
    if (why === 'hit') return; // too spammy — kills/bonuses only
    const el = document.createElement('div');
    el.className = 'pop' + (n < 0 ? ' neg' : '');
    el.textContent = (n > 0 ? '+' : '') + n;
    el.style.left = `${Math.random() * 60}px`;
    H.popups.appendChild(el);
    setTimeout(() => el.remove(), 950);
  });

  E.on('ammoChanged', () => refreshAmmo(G, H));
  E.on('weaponSwap', () => refreshAmmo(G, H));
  E.on('roundStart', (n) => {
    H.round.textContent = n;
    banner(H, `ROUND ${n}`);
  });
  E.on('roundEnd', () => {
    H.round.classList.add('pulse');
    setTimeout(() => H.round.classList.remove('pulse'), 1200);
  });
  E.on('hitmarker', ({ kill }) => {
    H.hit.classList.remove('show', 'kill');
    void H.hit.offsetWidth; // restart animation
    H.hit.classList.add('show');
    if (kill) H.hit.classList.add('kill');
    clearTimeout(H._hmT);
    H._hmT = setTimeout(() => H.hit.classList.remove('show', 'kill'), 90);
  });
  E.on('powerup', ({ label }) => banner(H, label, true));
  E.on('perkBought', (p) => banner(H, p.name, true));
  E.on('papDone', (w) => banner(H, G.weapons.statsOf(w).name, true));
  E.on('power', () => banner(H, 'POWER RESTORED', true));
  E.on('playerDied', () => {
    setTimeout(() => {
      H.gostats.innerHTML =
        `You survived <b>${G.zombies.round}</b> round${G.zombies.round === 1 ? '' : 's'}<br>` +
        `Kills <b>${G.player.kills}</b> · Headshots <b>${G.player.headshots}</b> · Points earned <b>${G.player.totalPoints.toLocaleString()}</b>`;
      H.gameover.classList.remove('hidden');
      document.exitPointerLock?.();
    }, 1800);
  });
  E.on('subtitle', (txt) => {
    H.subtitle.innerHTML = txt;
    H.subtitle.classList.add('on');
    clearTimeout(H._subT);
    H._subT = setTimeout(() => H.subtitle.classList.remove('on'), 5200);
  });

  refreshAmmo(G, H);
  H.points.textContent = G.player.points.toLocaleString();
  return H;
}

function banner(H, txt, gold = false) {
  H.banner.textContent = txt;
  H.banner.classList.remove('show', 'gold');
  void H.banner.offsetWidth;
  if (gold) H.banner.classList.add('gold');
  H.banner.classList.add('show');
}

function refreshAmmo(G, H) {
  const S = G.weapons;
  if (!S) return;
  const w = S.current(), st = S.statsOf(w);
  H.wname.textContent = st.name;
  H.wname.classList.toggle('pap', !!w.pap);
  H.ammo.innerHTML = `${w.ammo} <span class="res">/ ${w.reserve}</span>`;
  H.ammo.classList.toggle('low', w.ammo <= Math.max(2, st.mag * 0.25) );
  H.grenades.textContent = '✸ ' + S.grenades;
}

export function updateHud(G, dt, t) {
  const H = G.hud, P = G.player;

  // health vignette + pulse when critical
  const frac = Math.max(0, 1 - P.health / P.maxHealth);
  const pulse = P.health < 35 ? 0.12 * (0.5 + 0.5 * Math.sin(t * 6)) : 0;
  H.vign.style.opacity = Math.min(1, frac * 1.15 + pulse).toFixed(2);

  // crosshair spread
  const S = G.weapons;
  if (S) {
    const planar = Math.hypot(P.vel.x, P.vel.z);
    const spread = 5 + planar * 1.4 + S.kickRot * 60 + (P.sprinting ? 6 : 0);
    H.cross.style.setProperty('--spread', `${spread.toFixed(1)}px`);
    H.cross.classList.toggle('ads', S.isADS());
  }

  // interact prompt
  const tgt = P.interactTarget;
  if (tgt) {
    H.prompt.innerHTML = tgt.label;
    H.prompt.classList.add('on');
  } else H.prompt.classList.remove('on');

  // buff indicator via round color
  if (G.buffs) {
    const insta = G.buffs.insta > 0, dbl = G.buffs.points2x > 0;
    H.round.style.color = insta ? '#ffe040' : '';
    H.points.style.color = dbl ? '#ffb020' : '';
  }
}
