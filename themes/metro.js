// @name Metro
// @description A transit diagram: positions snap to a grid, links route at 45° and 90°, each tag's link tree becomes a coloured line.
// @light
(function () {
  'use strict';
  const K = SceneKit;

  // Snapped stations and routed lines depend only on the layout: built once
  // per layout as Path2Ds.
  function build(st, S, gs) {
    const sx = new Float64Array(S.nodes.length), sy = new Float64Array(S.nodes.length);
    for (const n of S.nodes) { sx[n.i] = Math.round(n.x / gs) * gs; sy[n.i] = Math.round(n.y / gs) * gs; }
    // Octilinear routing: straight run first, then a 45° diagonal.
    const route = (p, a, b) => {
      const x1 = sx[a.i], y1 = sy[a.i], x2 = sx[b.i], y2 = sy[b.i];
      const dx = x2 - x1, dy = y2 - y1;
      p.moveTo(x1, y1);
      if (Math.abs(dx) > Math.abs(dy)) p.lineTo(x1 + Math.sign(dx) * (Math.abs(dx) - Math.abs(dy)), y1);
      else p.lineTo(x1, y1 + Math.sign(dy) * (Math.abs(dy) - Math.abs(dx)));
      p.lineTo(x2, y2);
    };
    const plain = new Path2D();
    const byColor = new Map();
    for (const l of K.links(S)) {
      if (!l.tree && !l.intra) { route(plain, l.a, l.b); continue; }
      const c = K.col(st, S, l.a);
      let g = byColor.get(c);
      if (!g) { g = { thin: new Path2D(), tree: new Path2D() }; byColor.set(c, g); }
      route(l.tree ? g.tree : g.thin, l.a, l.b);
    }
    // Legend swatch colour per tag: a user tag colour wins, as on the map.
    const tagColor = new Map();
    for (const n of S.nodes) if (n.ti >= 0 && !tagColor.has(n.ti) && !n.ghost) tagColor.set(n.ti, K.col(st, S, n));
    return { sx, sy, plain, byColor, tagColor };
  }

  THEMES.metro = {
    kind: 'scene', name: 'Metro', dark: false, fg: '#1d2125', ghost: '#b9bec6', motion: 0,
    background: '#f4f5f2', labelFont: K.SANS, labelSize: 11.5, labelWeight: 600,
    pal: ['#e3242b', '#0072ce', '#00a651', '#f6a800', '#f68b1f', '#8e3fbf', '#00b3c8', '#a05a2c'],
    draw(ctx, S) {
      const { W, H, k } = S;
      const gs = Math.max(6, 20 * k);
      const c = K.memo('metro', S, gs, () => build(this, S, gs));
      ctx.fillStyle = this.background;
      ctx.fillRect(0, 0, W, H);
      ctx.strokeStyle = '#cfe3ee';
      ctx.lineWidth = 30 * k;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(-40, H * 0.78);
      ctx.bezierCurveTo(W * 0.3, H * 0.62, W * 0.55, H * 0.98, W + 40, H * 0.7);
      ctx.stroke();
      ctx.lineJoin = 'round';
      ctx.strokeStyle = '#d4d8dd';
      ctx.lineWidth = 1 * k;
      ctx.stroke(c.plain);
      for (const [colr, g] of c.byColor) {
        ctx.strokeStyle = colr;
        ctx.lineWidth = 1.4 * k;
        ctx.globalAlpha = 0.3;
        ctx.stroke(g.thin);
        ctx.globalAlpha = 1;
        ctx.lineWidth = 4.4 * k;
        ctx.stroke(g.tree);
      }
      ctx.lineCap = 'butt';
      for (const n of S.nodes) {
        if (n.ghost) continue;
        const x = c.sx[n.i], y = c.sy[n.i];
        n.x = x; n.y = y; // labels follow the snapped station
        ctx.globalAlpha = n.dim ? 0.35 : 1;
        if (n.deg >= 9) {
          ctx.fillStyle = '#fff'; ctx.strokeStyle = '#1d2125'; ctx.lineWidth = 2.4 * k;
          ctx.beginPath(); ctx.arc(x, y, 6 * k, 0, K.TAU); ctx.fill(); ctx.stroke();
        } else if (n.deg >= 3) {
          ctx.fillStyle = '#fff'; ctx.strokeStyle = '#1d2125'; ctx.lineWidth = 1.3 * k;
          ctx.beginPath(); ctx.arc(x, y, 2.8 * k, 0, K.TAU); ctx.fill(); ctx.stroke();
        } else {
          ctx.fillStyle = K.col(this, S, n);
          ctx.beginPath(); ctx.arc(x, y, 1.7 * k, 0, K.TAU); ctx.fill();
        }
      }
      ctx.globalAlpha = 1;
      if ((S.o.colorBy === 'tag' || S.o.colorBy === 'recency') && S.clusters.length) {
        const x0 = S.ins.l + 30 * k, y0 = S.ins.t + 30 * k;
        const fs = Math.max(9, 11 * k);
        // Row pitch never smaller than the text, or rows overlap on small screens.
        const pitch = Math.max(17 * k, fs * 1.45);
        ctx.font = `600 ${Math.max(8, 10 * k)}px ${K.MONO}`;
        ctx.fillStyle = '#1d2125';
        ctx.textBaseline = 'middle';
        ctx.textAlign = 'left';
        ctx.fillText('LINES', x0, y0);
        ctx.font = `500 ${fs}px ${K.SANS}`;
        const pal = K.pal(this, S);
        const sw = Math.max(14, 22 * k), sh = Math.max(3, 4.4 * k);
        S.clusters.forEach((cl, i) => {
          const y = y0 + (i + 1) * pitch;
          ctx.fillStyle = c.tagColor.get(cl.ti) || pal[cl.ti % pal.length];
          ctx.fillRect(x0, y - sh / 2, sw, sh);
          ctx.fillStyle = '#1d2125';
          ctx.fillText(K.truncLabel(cl.name), x0 + sw + 8 * Math.max(1, k), y);
        });
      }
    }
  };
})();
