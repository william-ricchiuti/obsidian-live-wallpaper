// @name Territories
// @description An atlas page: each note claims a Voronoi cell, tags become countries with dashed borders, hubs become capitals.
// @light
(function () {
  'use strict';
  const K = SceneKit;

  const vkey = p => Math.round(p[0] * 100) + ',' + Math.round(p[1] * 100);

  // Everything but the label text depends only on the layout: the coast and
  // land clip circles, the cells grouped by colour, cell edges, and borders,
  // each built once as a Path2D.
  function build(st, S) {
    const { W, H, k } = S;
    const land = S.nodes.filter(n => !n.ghost && Number.isFinite(n.bx) && Number.isFinite(n.by));
    if (land.length < 3) return null;
    const del = d3.Delaunay.from(land, n => n.bx, n => n.by);
    const vor = del.voronoi([0, 0, W, H]);
    const colour = land.map(n => K.col(st, S, n));
    // Vertex sets per cell (hashed, so finding a shared edge is linear).
    const keys = land.map((_, i) => {
      const poly = vor.cellPolygon(i);
      return poly ? poly.map(vkey) : null;
    });
    const polys = land.map((_, i) => vor.cellPolygon(i));
    // Borders between differently coloured neighbours (colour, not ci, so
    // user tag colours count): the shared Voronoi edge.
    const borders = new Path2D();
    for (let i = 0; i < land.length; i++) {
      if (!keys[i]) continue;
      let set = null;
      for (const j of del.neighbors(i)) {
        if (j <= i || colour[i] === colour[j] || !keys[j]) continue;
        if (!set) set = new Map(keys[i].map((kk, m) => [kk, m]));
        const shared = [];
        for (const kk of keys[j]) {
          const m = set.get(kk);
          if (m !== undefined && !shared.includes(m)) shared.push(m);
          if (shared.length >= 2) break;
        }
        if (shared.length >= 2) {
          const a = polys[i][shared[0]], b = polys[i][shared[1]];
          borders.moveTo(a[0], a[1]);
          borders.lineTo(b[0], b[1]);
        }
      }
    }
    const R = 36 * k;
    const coast = new Path2D(), clip = new Path2D();
    for (const n of land) {
      coast.moveTo(n.bx + R + 7 * k, n.by); coast.arc(n.bx, n.by, R + 7 * k, 0, K.TAU);
      clip.moveTo(n.bx + R, n.by); clip.arc(n.bx, n.by, R, 0, K.TAU);
    }
    const groups = new Map(), edges = new Path2D();
    land.forEach((n, i) => {
      let p = groups.get(colour[i]);
      if (!p) { p = new Path2D(); groups.set(colour[i], p); }
      vor.renderCell(i, p);
      vor.renderCell(i, edges);
    });
    return { land, coast, clip, groups, edges, borders, ghosts: S.nodes.filter(n => n.ghost) };
  }

  THEMES.territories = {
    kind: 'scene', name: 'Territories', dark: false, fg: '#3a342e', ghost: '#8aa0b0', motion: 0,
    background: '#d3e2ea', labelFont: K.SANS, labelSize: 11, labelWeight: 500,
    pal: ['#f2c6a0', '#cfe0b0', '#b9d3ea', '#ebc3d9', '#f3e3a4', '#cdc1e8', '#a9ddd6', '#e8bcae'],
    draw(ctx, S) {
      const { W, H, k } = S;
      const c = K.memo('territories', S, undefined, () => build(this, S));
      ctx.fillStyle = this.background;
      ctx.fillRect(0, 0, W, H);
      if (!c) return;
      // Sea hatching.
      ctx.strokeStyle = '#a9c0cf';
      ctx.lineWidth = 0.8 * k;
      ctx.globalAlpha = 0.6;
      ctx.beginPath();
      const sp = 13 * k;
      for (let y = sp / 2; y < H; y += sp) {
        const off = ((y / sp) % 2) * sp * 1.5;
        for (let x = -sp * 3 + off; x < W; x += sp * 6) { ctx.moveTo(x, y); ctx.lineTo(x + sp * 1.6, y); }
      }
      ctx.stroke();
      ctx.globalAlpha = 1;
      ctx.fillStyle = '#c2d6e2';
      ctx.fill(c.coast);
      ctx.save();
      ctx.clip(c.clip);
      for (const [colr, p] of c.groups) {
        ctx.fillStyle = colr;
        ctx.strokeStyle = colr;
        ctx.lineWidth = 1;
        ctx.fill(p);
        ctx.stroke(p);
      }
      ctx.strokeStyle = 'rgba(255,255,255,0.5)';
      ctx.lineWidth = 0.6 * k;
      ctx.stroke(c.edges);
      ctx.strokeStyle = '#6b5a4c';
      ctx.lineWidth = 1.3 * k;
      ctx.setLineDash([5 * k, 3 * k]);
      ctx.stroke(c.borders);
      ctx.setLineDash([]);
      ctx.restore();
      K.dots(ctx, c.ghosts, () => '#7f97a8', () => 1.6 * k, () => 0.9);
      K.dots(ctx, c.land, () => '#3a342e', n => (0.9 + n.imp * 2.2) * k, n => n.dim ? 0.3 : 0.85);
      for (const n of S.hubs.slice(0, 4)) {
        ctx.strokeStyle = '#3a342e';
        ctx.lineWidth = 1.4 * k;
        ctx.beginPath();
        ctx.arc(n.x, n.y, 5 * k, 0, K.TAU);
        ctx.stroke();
      }
      if (S.o.colorBy === 'tag' || S.o.colorBy === 'recency') {
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.font = `600 ${Math.max(9, 12.5 * k)}px ${K.DISP}`;
        ctx.fillStyle = 'rgba(58,52,46,0.62)';
        for (const cl of S.clusters) ctx.fillText(cl.name.toUpperCase().split('').join('  '), cl.x, cl.y - cl.rad * 0.15);
      }
    }
  };
})();
