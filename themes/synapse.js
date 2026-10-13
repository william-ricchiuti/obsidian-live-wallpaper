// @name Synapse
// @description Shows activity: recently edited notes fire every few seconds and the pulse travels outward hop by hop through your links.
(function () {
  'use strict';
  const K = SceneKit;
  const PER = 2.4;  // seconds between firings
  const HOP = 0.42; // seconds per hop
  THEMES.synapse = {
    kind: 'scene', name: 'Synapse', dark: true, fg: '#e9e4ff', ghost: '#3b3560', motion: 0.6,
    background: '#05040b', alwaysAnimate: true,
    pal: ['#7df9ff', '#ff5ce1', '#b18cff', '#ffd36b', '#6bffb5', '#ff8a6b', '#6bb5ff', '#ff6b9d'],
    draw(ctx, S, t) {
      const { W, H, k } = S;
      ctx.fillStyle = this.background;
      ctx.fillRect(0, 0, W, H);
      ctx.globalCompositeOperation = 'lighter';
      K.edgesBatched(ctx, S, () => '#40387a', 0.45, 0.6 * k, false);
      K.dots(ctx, S.nodes, n => K.col(this, S, n), n => Math.max(0.9 * k, n.r * 0.55), n => n.ghost ? 0.18 : n.dim ? 0.14 : 0.42);
      const src = S.recents.length ? S.recents : S.hubs;
      if (!src.length) { ctx.globalCompositeOperation = 'source-over'; return; }
      const cur = Math.floor(t / PER);
      for (let w = cur - 3; w <= cur; w++) {
        if (w < 0) continue;
        const s = src[((w % src.length) + src.length) % src.length];
        const age = t - w * PER;
        const dist = S.bfs(s.i);
        const life = Math.max(0, 1 - age / (PER * 2.2));
        if (life <= 0) continue;
        ctx.lineWidth = 1.4 * k;
        for (const l of S.links) {
          const da = dist[l.a.i], db = dist[l.b.i];
          if (da < 0 || db < 0 || Math.abs(da - db) !== 1) continue;
          const from = da < db ? l.a : l.b, to = da < db ? l.b : l.a;
          const hop = Math.min(da, db);
          if (hop > 4) continue;
          const p = (age - hop * HOP) / HOP;
          if (p <= 0 || p >= 1.6) continue;
          const fade = (1 - hop / 5) * life;
          const head = Math.min(1, p), tail = Math.max(0, p - 0.45);
          ctx.strokeStyle = K.rgbaHex(K.col(this, S, from.ci < 0 ? to : from), 0.9 * fade);
          ctx.beginPath();
          ctx.moveTo(K.lerp(from.x, to.x, tail), K.lerp(from.y, to.y, tail));
          ctx.lineTo(K.lerp(from.x, to.x, head), K.lerp(from.y, to.y, head));
          ctx.stroke();
        }
        for (const n of S.nodes) {
          const d = dist[n.i];
          if (d < 0 || d > 5) continue;
          const a = age - d * HOP;
          if (a < 0 || a > 1.2) continue;
          const f = (1 - a / 1.2) * (1 - d / 6) * life;
          const sz = (n.r * 7 + 10 * k) * (d === 0 ? 1.6 : 1);
          ctx.globalAlpha = f;
          ctx.drawImage(K.glow(K.col(this, S, n.ci < 0 ? s : n)), n.x - sz / 2, n.y - sz / 2, sz, sz);
        }
        ctx.globalAlpha = 1;
      }
      ctx.globalCompositeOperation = 'source-over';
    }
  };
})();
