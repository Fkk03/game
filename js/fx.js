/* ============ fx.js — particles, decals, floating text, screen shake ============ */
'use strict';
const FX = (() => {
  let parts = [];        // particles
  let texts = [];        // floating text
  let rings = [];        // shockwave rings
  let flashes = [];      // screen flash {color, a}
  let beams = [];        // lingering beams {x0,y0,x1,y1,w,color,life,t}
  let pendingBooms = []; // delayed secondary explosions {x,y,t,size}

  function spawn(p) {
    // draw code emits ambient smoke every frame; while paused nothing expires, so don't spawn
    if (typeof game !== 'undefined' && game.paused) return;
    if (parts.length > 1400) parts.splice(0, 200);
    parts.push(p);
  }

  const api = {
    parts, // exposed for render

    clear() { parts.length = 0; texts.length = 0; rings.length = 0; flashes.length = 0; beams.length = 0; pendingBooms.length = 0; },

    update(dt) {
      for (let i = pendingBooms.length - 1; i >= 0; i--) {
        const b = pendingBooms[i];
        b.t -= dt;
        if (b.t <= 0) {
          pendingBooms.splice(i, 1);
          api.explosion(b.x, b.y, b.size);
          SFX.explo(b.x, b.y, b.size);
        }
      }
      for (let i = parts.length - 1; i >= 0; i--) {
        const p = parts[i];
        p.t += dt;
        if (p.t >= p.life) { parts.splice(i, 1); continue; }
        p.x += p.vx * dt; p.y += p.vy * dt;
        if (p.g) p.vy += p.g * dt;
        if (p.drag) { p.vx *= (1 - p.drag * dt); p.vy *= (1 - p.drag * dt); }
        if (p.z !== undefined) { p.z += p.vz * dt; if (p.z < 0) { p.z = 0; p.vz = 0; } }
      }
      for (let i = texts.length - 1; i >= 0; i--) {
        const t = texts[i]; t.t += dt; t.y -= 22 * dt;
        if (t.t > t.life) texts.splice(i, 1);
      }
      for (let i = rings.length - 1; i >= 0; i--) {
        const r = rings[i]; r.t += dt;
        if (r.t > r.life) rings.splice(i, 1);
      }
      for (let i = flashes.length - 1; i >= 0; i--) {
        flashes[i].a -= dt * flashes[i].fade;
        if (flashes[i].a <= 0) flashes.splice(i, 1);
      }
      for (let i = beams.length - 1; i >= 0; i--) {
        beams[i].t += dt;
        if (beams[i].t > beams[i].life) beams.splice(i, 1);
      }
    },

    /* ---------- emitters ---------- */
    muzzle(x, y, ang, big) {
      const n = big ? 7 : 3;
      for (let i = 0; i < n; i++) {
        const a = ang + U.rand(-0.25, 0.25);
        const sp = U.rand(60, big ? 260 : 150);
        spawn({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, t: 0, life: U.rand(0.05, big ? 0.22 : 0.12),
          r: U.rand(2, big ? 6 : 3.5), kind: 'fire', drag: 4 });
      }
      if (big) spawn({ x, y, vx: 0, vy: 0, t: 0, life: 0.09, r: 15, kind: 'flash' });
    },

    smokePuff(x, y, n = 4, dark = false) {
      for (let i = 0; i < n; i++) {
        spawn({ x: x + U.rand(-4, 4), y: y + U.rand(-4, 4),
          vx: U.rand(-14, 14), vy: U.rand(-30, -8), t: 0, life: U.rand(0.7, 1.6),
          r: U.rand(4, 9), kind: dark ? 'darksmoke' : 'smoke', drag: 1.2 });
      }
    },

    explosion(x, y, size = 1) {
      spawn({ x, y, vx: 0, vy: 0, t: 0, life: 0.38 + size * 0.12, r: 16 * size, kind: 'fireball' });
      const n = Math.round(14 * size);
      for (let i = 0; i < n; i++) {
        const a = U.rand(0, Math.PI * 2), sp = U.rand(30, 190 * size);
        spawn({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, t: 0, life: U.rand(0.2, 0.55 * size),
          r: U.rand(3, 8 * size), kind: 'fire', drag: 3.2 });
      }
      for (let i = 0; i < Math.round(9 * size); i++) {
        const a = U.rand(0, Math.PI * 2), sp = U.rand(10, 70 * size);
        spawn({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 30, t: 0, life: U.rand(0.8, 2.2),
          r: U.rand(5, 12 * size), kind: 'darksmoke', drag: 1.4 });
      }
      // debris
      for (let i = 0; i < Math.round(6 * size); i++) {
        const a = U.rand(0, Math.PI * 2), sp = U.rand(80, 240 * size);
        spawn({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, t: 0, life: U.rand(0.3, 0.8),
          r: U.rand(1, 2.5), kind: 'debris', g: 260, drag: 1 });
      }
      rings.push({ x, y, t: 0, life: 0.35, maxR: 45 * size });
      spawn({ x, y, vx: 0, vy: 0, t: 0, life: 0.1, r: 22 * size, kind: 'flash' });
      RENDER.addDecal(x, y, 14 * size);
    },

    /* building death: a chain of secondary blasts + rising dust column */
    stagedCollapse(x, y, size) {
      for (let i = 0; i < 2 + Math.round(size); i++) {
        pendingBooms.push({
          x: x + U.rand(-size * 16, size * 16),
          y: y + U.rand(-size * 16, size * 16),
          t: 0.12 + i * U.rand(0.14, 0.3),
          size: U.rand(0.5, 0.9),
        });
      }
      for (let i = 0; i < 14; i++) {
        spawn({ x: x + U.rand(-size * 18, size * 18), y: y + U.rand(-size * 18, size * 18),
          vx: U.rand(-12, 12), vy: -U.rand(20, 70), t: 0, life: U.rand(1.8, 3.6),
          r: U.rand(8, 18), kind: 'dust', drag: 0.6 });
      }
    },

    contrail(x, y) {
      spawn({ x, y, vx: U.rand(-3, 3), vy: U.rand(-3, 3), t: 0, life: 1.1,
        r: U.rand(1.6, 2.6), kind: 'contrail' });
    },

    nukeExplosion(x, y) {
      api.explosion(x, y, 3.4);
      for (let i = 0; i < 40; i++) {
        const a = U.rand(0, Math.PI * 2), sp = U.rand(20, 120);
        spawn({ x, y, vx: Math.cos(a) * sp * 0.4, vy: -U.rand(40, 130), t: 0, life: U.rand(1.8, 3.8),
          r: U.rand(10, 26), kind: 'fire', drag: 0.7 });
      }
      for (let i = 0; i < 46; i++) {
        spawn({ x: x + U.rand(-30, 30), y: y + U.rand(-30, 30), vx: U.rand(-20, 20), vy: -U.rand(30, 90),
          t: 0, life: U.rand(2.5, 5), r: U.rand(14, 30), kind: 'darksmoke', drag: 0.5 });
      }
      rings.push({ x, y, t: 0, life: 0.9, maxR: 320 });
      flashes.push({ color: '255,240,200', a: 0.85, fade: 0.9 });
      RENDER.addDecal(x, y, 110);
    },

    flame(x, y, ang) {
      for (let i = 0; i < 3; i++) {
        const a = ang + U.rand(-0.18, 0.18);
        const sp = U.rand(120, 230);
        spawn({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, t: 0, life: U.rand(0.25, 0.55),
          r: U.rand(4, 9), kind: 'fire', drag: 2.4 });
      }
    },

    sparks(x, y, n = 5) {
      for (let i = 0; i < n; i++) {
        const a = U.rand(0, Math.PI * 2), sp = U.rand(40, 170);
        spawn({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, t: 0, life: U.rand(0.1, 0.3),
          r: U.rand(1, 2), kind: 'spark', g: 300 });
      }
    },

    blood(x, y) {
      for (let i = 0; i < 6; i++) {
        const a = U.rand(0, Math.PI * 2), sp = U.rand(20, 90);
        spawn({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, t: 0, life: U.rand(0.15, 0.4),
          r: U.rand(1, 2.4), kind: 'blood', drag: 3 });
      }
    },

    dust(x, y) {
      spawn({ x: x + U.rand(-6, 6), y: y + U.rand(-6, 6), vx: U.rand(-8, 8), vy: U.rand(-14, -4),
        t: 0, life: U.rand(0.4, 0.9), r: U.rand(3, 6), kind: 'dust', drag: 1.5 });
    },

    chute(x, y) { // parachute drop marker
      spawn({ x, y, vx: 0, vy: 0, t: 0, life: 1.4, r: 12, kind: 'chute' });
    },

    addBeam(x0, y0, x1, y1, w, color, life = 0.25) {
      beams.push({ x0, y0, x1, y1, w, color, life, t: 0 });
    },

    text(x, y, str, color = '#ffd76a') {
      texts.push({ x, y, str, color, t: 0, life: 1.4 });
    },

    flash(color, a = 0.4, fade = 1.6) { flashes.push({ color, a, fade }); },

    /* ---------- render (called from render.js in world space) ---------- */
    draw(ctx) {
      // pass 1: opaque/smoky particles
      for (const p of parts) {
        const k = p.t / p.life;
        ctx.globalAlpha = 1 - k;
        switch (p.kind) {
          case 'smoke':
            ctx.globalAlpha = (1 - k) * 0.35;
            ctx.fillStyle = '#cfc8b8';
            ctx.beginPath(); ctx.arc(p.x, p.y, p.r * (1 + k * 1.6), 0, 7); ctx.fill();
            break;
          case 'darksmoke':
            ctx.globalAlpha = (1 - k) * 0.5;
            ctx.fillStyle = '#3a352d';
            ctx.beginPath(); ctx.arc(p.x, p.y, p.r * (1 + k * 1.8), 0, 7); ctx.fill();
            break;
          case 'dust':
            ctx.globalAlpha = (1 - k) * 0.25;
            ctx.fillStyle = '#cdb98a';
            ctx.beginPath(); ctx.arc(p.x, p.y, p.r * (1 + k), 0, 7); ctx.fill();
            break;
          case 'contrail':
            ctx.globalAlpha = (1 - k) * 0.3;
            ctx.fillStyle = '#eef2f4';
            ctx.beginPath(); ctx.arc(p.x, p.y, p.r * (1 + k * 2.2), 0, 7); ctx.fill();
            break;
          case 'debris':
            ctx.fillStyle = '#55503f';
            ctx.fillRect(p.x - p.r, p.y - p.r, p.r * 2, p.r * 2);
            break;
          case 'blood':
            ctx.fillStyle = '#8a1e12';
            ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, 7); ctx.fill();
            break;
          case 'chute': {
            ctx.globalAlpha = 1 - k * k;
            ctx.fillStyle = '#ddd6c2';
            ctx.beginPath(); ctx.arc(p.x, p.y - 14 + k * 10, p.r * (1 - k * 0.4), Math.PI, 0); ctx.fill();
            ctx.strokeStyle = '#998'; ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(p.x - p.r * 0.8, p.y - 14 + k * 10); ctx.lineTo(p.x, p.y + k * 10);
            ctx.moveTo(p.x + p.r * 0.8, p.y - 14 + k * 10); ctx.lineTo(p.x, p.y + k * 10);
            ctx.stroke();
            break;
          }
        }
      }
      ctx.globalAlpha = 1;

      // pass 2: hot particles with additive blending — fire reads as light, not paint
      ctx.globalCompositeOperation = 'lighter';
      for (const p of parts) {
        const k = p.t / p.life;
        switch (p.kind) {
          case 'fire': {
            const r = p.r * (1 + k * 0.8);
            ctx.globalAlpha = (1 - k) * 0.45;
            ctx.fillStyle = '#ff7b20';
            ctx.beginPath(); ctx.arc(p.x, p.y, r * 1.9, 0, 7); ctx.fill();
            ctx.globalAlpha = 1 - k;
            ctx.fillStyle = k < 0.3 ? '#fff3b0' : (k < 0.6 ? '#ffab40' : '#c9502a');
            ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, 7); ctx.fill();
            break;
          }
          case 'fireball': {
            const r = p.r * (0.6 + k * 2.4);
            const g = ctx.createRadialGradient(p.x, p.y, r * 0.1, p.x, p.y, r);
            g.addColorStop(0, `rgba(255,250,225,${0.95 * (1 - k)})`);
            g.addColorStop(0.35, `rgba(255,190,80,${0.8 * (1 - k)})`);
            g.addColorStop(0.7, `rgba(230,90,30,${0.5 * (1 - k)})`);
            g.addColorStop(1, 'rgba(120,40,15,0)');
            ctx.globalAlpha = 1;
            ctx.fillStyle = g;
            ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, 7); ctx.fill();
            break;
          }
          case 'flash':
            ctx.globalAlpha = (1 - k) * 0.9;
            ctx.fillStyle = '#fff7d8';
            ctx.beginPath(); ctx.arc(p.x, p.y, p.r * (1 + k), 0, 7); ctx.fill();
            break;
          case 'spark':
            ctx.globalAlpha = 1 - k;
            ctx.strokeStyle = '#ffe9a0'; ctx.lineWidth = 1.4;
            ctx.beginPath(); ctx.moveTo(p.x, p.y);
            ctx.lineTo(p.x - p.vx * 0.02, p.y - p.vy * 0.02); ctx.stroke();
            break;
        }
      }
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = 1;

      for (const b of beams) {
        const k = 1 - b.t / b.life;
        ctx.globalAlpha = k;
        ctx.strokeStyle = b.color; ctx.lineWidth = b.w * k + 1;
        ctx.beginPath(); ctx.moveTo(b.x0, b.y0); ctx.lineTo(b.x1, b.y1); ctx.stroke();
        ctx.globalAlpha = k * 0.5;
        ctx.lineWidth = (b.w * k + 1) * 2.6; ctx.stroke();
      }
      ctx.globalAlpha = 1;

      for (const r of rings) {
        const k = r.t / r.life;
        ctx.globalAlpha = (1 - k) * 0.6;
        ctx.strokeStyle = '#fff0c8'; ctx.lineWidth = 3 * (1 - k) + 1;
        ctx.beginPath(); ctx.arc(r.x, r.y, r.maxR * Math.sqrt(k), 0, 7); ctx.stroke();
      }
      ctx.globalAlpha = 1;
    },

    drawTexts(ctx) { // world space
      ctx.font = 'bold 13px sans-serif';
      ctx.textAlign = 'center';
      for (const t of texts) {
        ctx.globalAlpha = 1 - (t.t / t.life) ** 2;
        ctx.fillStyle = '#000'; ctx.fillText(t.str, t.x + 1, t.y + 1);
        ctx.fillStyle = t.color; ctx.fillText(t.str, t.x, t.y);
      }
      ctx.globalAlpha = 1;
      ctx.textAlign = 'left';
    },

    drawFlashes(ctx, w, h) { // screen space
      for (const f of flashes) {
        ctx.fillStyle = `rgba(${f.color},${Math.min(1, f.a)})`;
        ctx.fillRect(0, 0, w, h);
      }
    },
  };
  return api;
})();
