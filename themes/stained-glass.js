// @name Stained Glass
// @description Every note is a pane of coloured glass (a Voronoi cell) set in dark lead, lit from behind.
(function () {
  'use strict';
  const K = SceneKit;

  // Window geometry depends only on the layout: the outline clip, the panes
  // grouped by glass colour, and the lead came, each as one Path2D.
  function build(st, S) {
    const { W, H, k } = S;
    // Unlinked notes would become lone round panes; they become rivets instead.
    const panes = S.nodes.filter(n => !n.ghost && n.deg > 0 && Number.isFinite(n.bx) && Number.isFinite(n.by));
    if (panes.length < 3) return null;
    const vor = d3.Delaunay.from(panes, n => n.bx, n => n.by).voronoi([0, 0, W, H]);
    // Window outline: panes only exist near notes, so the rest is wall.
    const R = 46 * k;
    const clip = new Path2D();
    for (const n of panes) { clip.moveTo(n.bx + R, n.by); clip.arc(n.bx, n.by, R, 0, K.TAU); }
    const glass = new Map(), lead = new Path2D(), lit = new Path2D();
    panes.forEach((n, i) => {
      const base = K.col(st, S, n);
      const fill = n.dim ? K.mix(base, '#000000', 0.6) : base;
      let p = glass.get(fill);
      if (!p) { p = new Path2D(); glass.set(fill, p); }
      vor.renderCell(i, p);
      vor.renderCell(i, lead);
      if (!n.dim) vor.renderCell(i, lit);
    });
    const rivets = S.nodes.filter(n => !n.ghost && n.deg === 0);
    return { clip, glass, lead, lit, rivets };
  }

  THEMES['stained-glass'] = {
    kind: 'scene', name: 'Stained Glass', dark: true, fg: '#f4ead2', ghost: '#3a3550', motion: 0,
    background: '#0b0a10', labelFont: "Georgia, 'Iowan Old Style', serif", labelSize: 12, labelWeight: 600,
    pal: ['#c0392b', '#2471a3', '#d4ac0d', '#1e8449', '#a04000', '#7d3c98', '#148f77', '#b03a75'],
    draw(ctx, S, t) {
      const { W, H, k } = S;
      const c = K.memo('stained-glass', S, undefined, () => build(this, S));
      ctx.fillStyle = this.background;
      ctx.fillRect(0, 0, W, H);
      if (!c) return;
      ctx.save();
      ctx.clip(c.clip);
      ctx.globalAlpha = 0.9;
      for (const [fill, p] of c.glass) { ctx.fillStyle = fill; ctx.fill(p); }
      // Light from behind: a slow warm source drifting across the window. Each
      // pane used to be mixed toward #fff6dc by max(0, 0.35 - 0.5·d/diag); the
      // same falloff as one radial gradient over the undimmed panes.
      const lx = W * (0.35 + 0.3 * Math.sin(t * 0.02)), ly = H * 0.25;
      const diag = Math.hypot(W, H);
      const g = ctx.createRadialGradient(lx, ly, 0, lx, ly, diag * 0.7);
      g.addColorStop(0, 'rgba(255,246,220,0.35)');
      g.addColorStop(1, 'rgba(255,246,220,0)');
      ctx.fillStyle = g;
      ctx.fill(c.lit);
      ctx.globalAlpha = 1;
      // Lead came between panes.
      ctx.strokeStyle = '#141218';
      ctx.lineWidth = 2.6 * k;
      ctx.lineJoin = 'round';
      ctx.stroke(c.lead);
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
      K.dots(ctx, c.rivets, () => '#8a8070', () => 1.8 * k, () => 0.7);
    }
  };
})();
