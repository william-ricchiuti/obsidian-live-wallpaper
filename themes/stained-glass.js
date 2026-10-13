// @name Stained Glass
// @description Every note is a pane of coloured glass (a Voronoi cell) set in dark lead, lit from behind.
(function () {
  'use strict';
  const K = SceneKit;
  THEMES['stained-glass'] = {
    kind: 'scene', name: 'Stained Glass', dark: true, fg: '#f4ead2', ghost: '#3a3550', motion: 0,
    background: '#0b0a10', labelFont: "Georgia, 'Iowan Old Style', serif", labelSize: 12, labelWeight: 600,
    pal: ['#c0392b', '#2471a3', '#d4ac0d', '#1e8449', '#a04000', '#7d3c98', '#148f77', '#b03a75'],
    draw(ctx, S, t) {
      const { W, H, k } = S;
      let c = this._c;
      if (!c || c.key !== S.key) {
        // Unlinked notes would become lone round panes; they become rivets instead.
        const panes = S.nodes.filter(n => !n.ghost && n.deg > 0);
        if (panes.length < 3) { ctx.fillStyle = this.background; ctx.fillRect(0, 0, W, H); return; }
        const del = d3.Delaunay.from(panes, n => n.bx, n => n.by);
        c = this._c = { key: S.key, panes, vor: del.voronoi([0, 0, W, H]) };
      }
      ctx.fillStyle = this.background;
      ctx.fillRect(0, 0, W, H);
      // Window outline: panes only exist near notes, so the rest is wall.
      const R = 46 * k;
      ctx.save();
      ctx.beginPath();
      for (const n of c.panes) { ctx.moveTo(n.bx + R, n.by); ctx.arc(n.bx, n.by, R, 0, K.TAU); }
      ctx.clip();
      // Light from behind: a slow warm source drifting across the window.
      const lx = W * (0.35 + 0.3 * Math.sin(t * 0.02)), ly = H * 0.25;
      c.panes.forEach((n, i) => {
        const base = K.col(this, S, n);
        const d = Math.hypot(n.bx - lx, n.by - ly) / Math.hypot(W, H);
        const lit = K.mix(base, '#fff6dc', Math.max(0, 0.35 - d * 0.5));
        ctx.fillStyle = n.dim ? K.mix(lit, '#000000', 0.6) : lit;
        ctx.globalAlpha = 0.9;
        ctx.beginPath();
        c.vor.renderCell(i, ctx);
        ctx.fill();
      });
      ctx.globalAlpha = 1;
      // Lead came between panes.
      ctx.strokeStyle = '#141218';
      ctx.lineWidth = 2.6 * k;
      ctx.lineJoin = 'round';
      ctx.beginPath();
      c.panes.forEach((n, i) => c.vor.renderCell(i, ctx));
      ctx.stroke();
      // Glass texture.
      ctx.globalCompositeOperation = 'overlay';
      ctx.globalAlpha = 0.18;
      ctx.fillStyle = K.pattern(ctx, 'noise', K.noise);
      ctx.fillRect(0, 0, W, H);
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = 1;
      ctx.restore();
      // Rivets at hubs.
      K.dots(ctx, S.hubs, () => '#e9dcc0', () => 2.4 * k, () => 0.8);
      K.dots(ctx, S.nodes.filter(n => !n.ghost && n.deg === 0), () => '#8a8070', () => 1.8 * k, () => 0.7);
    }
  };
})();
