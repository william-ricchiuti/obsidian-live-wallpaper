// @name Mycelium
// @description Links grow as wandering hyphae and notes as spore clusters; amber pulses travel out from notes you just edited.
(function () {
  'use strict';
  const K = SceneKit;
  THEMES.mycelium = {
    kind: 'scene', name: 'Mycelium', dark: true, fg: '#efe4c8', ghost: '#5b5345', motion: 0.8,
    background: '#0d0b09', alwaysAnimate: true,
    pal: ['#e9dcc0', '#c9d79a', '#a7c4a0', '#e0a982', '#b7a7d6', '#e7c97a', '#9fc0c9', '#d9b3b0'],
    draw(ctx, S, t) {
      const { W, H, k } = S;
      const g = ctx.createRadialGradient(W / 2, H * 0.55, 0, W / 2, H / 2, Math.hypot(W, H) / 2);
      g.addColorStop(0, '#17130e');
      g.addColorStop(1, '#080706');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, W, H);
      const groups = new Map();
      for (const l of S.links) {
        const c = l.a.ci < 0 && !l.a.uc ? this.ghost : K.mix(K.col(this, S, l.a), '#e9dcc0', 0.5);
        let a = groups.get(c);
        if (!a) { a = []; groups.set(c, a); }
        a.push(l);
      }
      const path = l => {
        const a = l.a, b = l.b, dx = b.x - a.x, dy = b.y - a.y, len = Math.hypot(dx, dy) || 1;
        const nx = -dy / len, ny = dx / len, amp = Math.min(16 * k, len * 0.22);
        const s1 = (l.i * 0.618) % 1;
        ctx.moveTo(a.x, a.y);
        for (let j = 1; j <= 7; j++) {
          const u = j / 7;
          const off = Math.sin(u * Math.PI) * amp * (Math.sin(u * 6.5 + s1 * 20 + t * 0.05) * 0.7 + (s1 - 0.5));
          ctx.lineTo(a.x + dx * u + nx * off, a.y + dy * u + ny * off);
        }
      };
      for (const [c, list] of groups) {
        ctx.strokeStyle = c;
        ctx.globalAlpha = 0.12; ctx.lineWidth = 1.8 * k;
        ctx.beginPath(); list.forEach(path); ctx.stroke();
        ctx.globalAlpha = 0.38; ctx.lineWidth = 0.5 * k;
        ctx.beginPath(); list.forEach(path); ctx.stroke();
      }
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'lighter';
      for (const n of S.hubs) {
        const s = n.r * 9;
        ctx.globalAlpha = 0.28;
        ctx.drawImage(K.glow('#f1b45a'), n.x - s / 2, n.y - s / 2, s, s);
      }
      if (S.recents.length) {
        const recent = new Set(S.recents);
        for (const l of S.links) {
          const r = recent.has(l.a) ? l.a : recent.has(l.b) ? l.b : null;
          if (!r) continue;
          const o = r === l.a ? l.b : l.a;
          const p = (t * 0.25 + l.i * 0.37) % 1;
          ctx.globalAlpha = 0.9 * (1 - p);
          const s = 10 * k;
          ctx.drawImage(K.glow('#ffb347'), K.lerp(r.x, o.x, p) - s / 2, K.lerp(r.y, o.y, p) - s / 2, s, s);
        }
      }
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
      K.dots(ctx, S.nodes, n => K.col(this, S, n), n => Math.max(0.8 * k, n.r * 0.42), n => n.dim ? 0.25 : 0.95);
      ctx.beginPath();
      for (const n of S.nodes) {
        if (n.ghost || n.r < 2.5 * k) continue;
        for (let j = 0; j < 4; j++) {
          const a = n.ph + j * 1.7 + t * 0.04, d = n.r * (1.2 + ((j * 0.37 + n.h1) % 1) * 0.7);
          const x = n.x + Math.cos(a) * d, y = n.y + Math.sin(a) * d;
          ctx.moveTo(x + 0.9 * k, y);
          ctx.arc(x, y, 0.9 * k, 0, K.TAU);
        }
      }
      ctx.fillStyle = '#efe4c8';
      ctx.globalAlpha = 0.5;
      ctx.fill();
      ctx.globalAlpha = 1;
    }
  };
})();
