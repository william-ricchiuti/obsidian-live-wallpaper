// @name Territories
// @description An atlas page: each note claims a Voronoi cell, tags become countries with dashed borders, hubs become capitals.
// @light
(function () {
  'use strict';
  const K = SceneKit;
  THEMES.territories = {
    kind: 'scene', name: 'Territories', dark: false, fg: '#3a342e', ghost: '#8aa0b0', motion: 0,
    background: '#d3e2ea', labelFont: K.SANS, labelSize: 11, labelWeight: 500,
    pal: ['#f2c6a0', '#cfe0b0', '#b9d3ea', '#ebc3d9', '#f3e3a4', '#cdc1e8', '#a9ddd6', '#e8bcae'],
    draw(ctx, S) {
      const { W, H, k } = S;
      let c = this._c;
      if (!c || c.key !== S.key) {
        const land = S.nodes.filter(n => !n.ghost);
        if (land.length < 3) { ctx.fillStyle = this.background; ctx.fillRect(0, 0, W, H); return; }
        const del = d3.Delaunay.from(land, n => n.bx, n => n.by);
        const vor = del.voronoi([0, 0, W, H]);
        // Borders between differently coloured neighbours: the shared Voronoi edge.
        const borders = [];
        for (let i = 0; i < land.length; i++) {
          const pi = vor.cellPolygon(i);
          if (!pi) continue;
          for (const j of del.neighbors(i)) {
            if (j <= i || land[i].ci === land[j].ci) continue;
            const pj = vor.cellPolygon(j);
            if (!pj) continue;
            const shared = [];
            for (const a of pi) {
              for (const b of pj) {
                if (Math.abs(a[0] - b[0]) < 0.01 && Math.abs(a[1] - b[1]) < 0.01 && !shared.some(s => s[0] === a[0] && s[1] === a[1])) shared.push(a);
              }
            }
            if (shared.length >= 2) borders.push(shared[0], shared[1]);
          }
        }
        c = this._c = { key: S.key, land, vor, borders };
      }
      ctx.fillStyle = this.background;
      ctx.fillRect(0, 0, W, H);
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
      const R = 36 * k;
      ctx.fillStyle = '#c2d6e2';
      ctx.beginPath();
      for (const n of c.land) { ctx.moveTo(n.bx + R + 7 * k, n.by); ctx.arc(n.bx, n.by, R + 7 * k, 0, K.TAU); }
      ctx.fill();
      ctx.save();
      ctx.beginPath();
      for (const n of c.land) { ctx.moveTo(n.bx + R, n.by); ctx.arc(n.bx, n.by, R, 0, K.TAU); }
      ctx.clip();
      const groups = new Map();
      c.land.forEach((n, i) => {
        const colr = K.col(this, S, n);
        let a = groups.get(colr);
        if (!a) { a = []; groups.set(colr, a); }
        a.push(i);
      });
      for (const [colr, ids] of groups) {
        ctx.fillStyle = colr;
        ctx.strokeStyle = colr;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ids.forEach(i => c.vor.renderCell(i, ctx));
        ctx.fill();
        ctx.stroke();
      }
      ctx.strokeStyle = 'rgba(255,255,255,0.5)';
      ctx.lineWidth = 0.6 * k;
      ctx.beginPath();
      c.land.forEach((n, i) => c.vor.renderCell(i, ctx));
      ctx.stroke();
      ctx.strokeStyle = '#6b5a4c';
      ctx.lineWidth = 1.3 * k;
      ctx.setLineDash([5 * k, 3 * k]);
      ctx.beginPath();
      for (let i = 0; i < c.borders.length; i += 2) {
        ctx.moveTo(c.borders[i][0], c.borders[i][1]);
        ctx.lineTo(c.borders[i + 1][0], c.borders[i + 1][1]);
      }
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.restore();
      K.dots(ctx, S.nodes.filter(n => n.ghost), () => '#7f97a8', () => 1.6 * k, () => 0.9);
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
        for (const cl of S.clusters) ctx.fillText(cl.name.toUpperCase().split('').join('  '), cl.x, cl.y - cl.rad * 0.15);
      }
    }
  };
})();
