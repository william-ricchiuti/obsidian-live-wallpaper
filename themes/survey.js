// @name Survey
// @description A topographic survey sheet: link density becomes contour lines, hubs are summits, the link tree becomes footpaths.
// @light
(function () {
  'use strict';
  const K = SceneKit;
  THEMES.survey = {
    kind: 'scene', name: 'Survey', dark: false, fg: '#2c2620', ghost: '#3f7fc0', motion: 0,
    background: '#f2f1ea', labelFont: K.SANS, labelSize: 11, labelWeight: 500, agoSep: '  ',
    pal: ['#2c2620'],
    labelText: (n, _S, label) => label + '  ' + (n.deg * 37).toLocaleString(),
    draw(ctx, S) {
      const { W, H, k } = S;
      // Contours are tessellated into Path2Ds once per layout (d3.geoPath used
      // to re-walk every ring each frame).
      const c = K.memo('survey', S, undefined, () => {
        const pts = S.nodes.filter(n => !n.ghost && Number.isFinite(n.bx) && Number.isFinite(n.by));
        const cs = pts.length < 3 ? [] : d3.contourDensity()
          .x(n => n.bx).y(n => n.by)
          .weight(n => 1 + n.deg * 0.6)
          .size([Math.max(1, Math.round(W)), Math.max(1, Math.round(H))])
          .cellSize(4)
          .bandwidth(Math.max(6, 17 * k))
          .thresholds(26)(pts);
        const fills = [], minor = new Path2D(), index = new Path2D();
        cs.forEach((cn, i) => {
          if (i < 3) { const p = new Path2D(); d3.geoPath(null, p)(cn); fills.push(p); }
          d3.geoPath(null, i % 5 === 4 ? index : minor)(cn);
        });
        const hubs = new Set(S.hubs);
        return {
          fills, minor, index,
          ghosts: S.nodes.filter(n => n.ghost),
          plain: S.nodes.filter(n => !n.ghost && !hubs.has(n))
        };
      });
      ctx.fillStyle = this.background;
      ctx.fillRect(0, 0, W, H);
      ctx.strokeStyle = 'rgba(120,160,200,0.35)';
      ctx.lineWidth = 0.6 * k;
      ctx.beginPath();
      const gs = 110 * k;
      for (let x = gs / 2; x < W; x += gs) { ctx.moveTo(x, 0); ctx.lineTo(x, H); }
      for (let y = gs / 2; y < H; y += gs) { ctx.moveTo(0, y); ctx.lineTo(W, y); }
      ctx.stroke();
      ctx.fillStyle = '#dfe8cc';
      ctx.globalAlpha = 0.75;
      for (const p of c.fills) ctx.fill(p);
      ctx.globalAlpha = 1;
      ctx.strokeStyle = '#b98552';
      ctx.lineWidth = 0.6 * k;
      ctx.stroke(c.minor);
      ctx.strokeStyle = '#8a5326';
      ctx.lineWidth = 1.3 * k;
      ctx.stroke(c.index);
      ctx.setLineDash([3 * k, 2.4 * k]);
      K.edgesBatched(ctx, S, () => '#2c2620', 0.42, 0.7 * k, false, l => l.tree, 'survey');
      ctx.setLineDash([]);
      K.dots(ctx, c.ghosts, () => '#3f7fc0', () => 2 * k, () => 0.85);
      K.dots(ctx, c.plain, () => '#2c2620', () => 0.9 * k, n => n.dim ? 0.25 : 0.7);
      ctx.fillStyle = '#2c2620';
      for (const n of S.hubs) {
        const s = 4.5 * k;
        ctx.beginPath();
        ctx.moveTo(n.x, n.y - s);
        ctx.lineTo(n.x + s, n.y + s * 0.8);
        ctx.lineTo(n.x - s, n.y + s * 0.8);
        ctx.closePath();
        ctx.fill();
      }
      if (!S.o.overlay || S.o.overlay === 'none') {
        ctx.font = `500 ${Math.max(8, 9.5 * k)}px ${K.MONO}`;
        ctx.textAlign = 'right';
        ctx.textBaseline = 'alphabetic';
        ctx.fillStyle = 'rgba(44,38,32,0.65)';
        ctx.fillText('VAULT QUADRANGLE · 7.5-MINUTE SERIES · CONTOUR INTERVAL 40 LINKS', W - S.ins.r - 24 * k, H - S.ins.b - 18 * k);
      }
    }
  };
})();
