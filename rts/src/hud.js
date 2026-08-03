// hud.js — all DOM UI: topbar (money/power/xp/powers/sw timers/clock),
// selection panel, command grid, tooltips, feed, announce, scoreboard,
// idle-worker button, production tabs. OWNED BY: ui agent. STATUS: MINIMAL.
// Contract highlights:
//   init() wires everything; update(dt) refreshes cheap things every frame,
//   expensive rebuilds only on events ('sel:changed','money:changed',...).
//   Command grid contents come from selection: building w/ def.builds →
//   production buttons (cost, hotkey, queue count, progress bar on head);
//   builder unit → def.builds building buttons entering placement mode;
//   units → move/stop/attack-move buttons; building w/ upgrades → upg
//   buttons. Tooltips from def.desc + canBuild().reason. Feed via
//   on('feed'), announce via on('announce'). Superweapon timers from
//   powers.getSwTimers(). Idle worker button cycles idle builders. Prod
//   tabs list buildings with active queues. Scoreboard on hold-TAB.
import { G, on, emit } from './core.js';
import { FACTIONS } from './data.js';

const $ = (id) => document.getElementById(id);

export class HUD {
  init() {
    this.money = $('money'); this.clock = $('clock');
    this.powerfill = $('powerfill'); this.powertext = $('powertext');
    this.selinfo = $('selinfo'); this.selgrid = $('selgrid');
    this.cmdtitle = $('cmdtitle'); this.cmdgrid = $('cmdgrid');
    on('feed', (t, cls) => this.feed(t, cls));
    on('announce', (t) => this.announce(t));
    on('sel:changed', () => this.refreshSelection());
    ['topbar', 'bottombar'].forEach(id => $(id).classList.remove('hidden'));
  }
  show() {}
  feed(text, cls = '') {
    const d = document.createElement('div');
    d.className = 'feed-msg ' + cls;
    d.textContent = text;
    $('feed').prepend(d);
    setTimeout(() => d.remove(), 9000);
  }
  announce(text) {
    const a = $('announce');
    a.textContent = text;
    a.style.opacity = 1;
    clearTimeout(this._at);
    this._at = setTimeout(() => a.style.opacity = 0, 3500);
  }
  refreshSelection() {
    const sel = G.sel;
    this.selinfo.innerHTML = sel.length
      ? `<b>${sel.length === 1 ? sel[0].def.name : sel.length + ' units'}</b>`
      : '';
    this.selgrid.innerHTML = '';
    this.cmdgrid.innerHTML = '';
    this.cmdtitle.textContent = sel.length === 1 ? sel[0].def.name : '';
  }
  update(dt) {
    const p = G.players[G.humanId];
    if (!p) return;
    this.money.textContent = Math.floor(p.money);
    const t = Math.floor(G.gameTime);
    this.clock.textContent = `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`;
    if (FACTIONS[p.faction].usesPower) {
      const frac = p.powerMade ? Math.min(1, p.powerMade ? (p.powerMade - p.powerUsed) / p.powerMade + 0.0001 : 0) : 0;
      this.powerfill.style.width = `${Math.max(4, frac * 100)}%`;
      this.powerfill.style.background = p.powerUsed > p.powerMade ? '#d84c30' : '#48c94e';
      this.powertext.textContent = `${p.powerUsed}/${p.powerMade}`;
    } else {
      $('powergroup').style.display = 'none';
    }
  }
}
