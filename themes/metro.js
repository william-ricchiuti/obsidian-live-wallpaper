// @name Metro
// @description A transit diagram: positions snap to a grid, links route at 45° and 90°, each tag's link tree becomes a coloured line.
// @light
(function () {
  'use strict';
  const K = SceneKit;
  THEMES.metro = {
    kind: 'scene', name: 'Metro', dark: false, fg: '#1d2125', ghost: '#b9bec6', motion: 0,
    background: '#f4f5f2', labelFont: K.SANS, labelSize: 11.5, labelWeight: 600,
    pal: ['#e3242b', '#0072ce', '#00a651', '#f6a800', '#f68b1f', '#8e3fbf', '#00b3c8', '#a05a2c'],
    draw(ctx, S) {
      const { W, H, k } = S;
      const gs = Math.max(6, 20 * k);
      const snap = n => [Math.round(n.x / gs) * gs, Math.round(n.y / gs) * gs];
      ctx.fillStyle = this.background;
      ctx.fillRect(0, 0, W, H);
      ctx.strokeStyle = '#cfe3ee';
      ctx.lineWidth = 30 * k;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(-40, H * 0.78);
      ctx.bezierCurveTo(W * 0.3, H * 0.62, W * 0.55, H * 0.98, W + 40, H * 0.7);
      ctx.stroke();
      // Octilinear routing: straight run first, then a 45° diagonal.
      const route = (a, b) => {
        const [x1, y1] = snap(a), [x2, y2] = snap(b);
        const dx = x2 - x1, dy = y2 - y1;
        ctx.moveTo(x1, y1);
        if (Math.abs(dx) > Math.abs(dy)) ctx.lineTo(x1 + Math.sign(dx) * (Math.abs(dx) - Math.abs(dy)), y1);
        else ctx.lineTo(x1, y1 + Math.sign(dy) * (Math.abs(dy) - Math.abs(dx)));
        ctx.lineTo(x2, y2);
      };
      ctx.lineJoin = 'round';
      ctx.strokeStyle = '#d4d8dd';
      ctx.lineWidth = 1 * k;
      ctx.beginPath();
      for (const l of S.links) if (!l.tree && !l.intra) route(l.a, l.b);
      ctx.stroke();
      const byColor = new Map();
      for (const l of S.links) {
        if (!l.intra && !l.tree) continue;
        const c = K.col(this, S, l.a);
        let a = byColor.get(c);
        if (!a) { a = []; byColor.set(c, a); }
        a.push(l);
      }
      for (const [c, list] of byColor) {
        ctx.strokeStyle = c;
        ctx.lineWidth = 1.4 * k;
        ctx.globalAlpha = 0.3;
        ctx.beginPath();
        list.filter(l => !l.tree).forEach(l => route(l.a, l.b));
        ctx.stroke();
        ctx.globalAlpha = 1;
        ctx.lineWidth = 4.4 * k;
        ctx.beginPath();
        list.filter(l => l.tree).forEach(l => route(l.a, l.b));
        ctx.stroke();
      }
      ctx.lineCap = 'butt';
      for (const n of S.nodes) {
        if (n.ghost) continue;
        const [x, y] = snap(n);
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
        ctx.font = `600 ${Math.max(8, 10 * k)}px ${K.MONO}`;
        ctx.fillStyle = '#1d2125';
        ctx.textBaseline = 'middle';
        ctx.textAlign = 'left';
        ctx.fillText('LINES', x0, y0);
        ctx.font = `500 ${Math.max(9, 11 * k)}px ${K.SANS}`;
        S.clusters.forEach((cl, i) => {
          const y = y0 + (i + 1) * 17 * k;
          const pal = S.pal || this.pal;
          ctx.fillStyle = pal[cl.ti % pal.length];
          ctx.fillRect(x0, y - 2.2 * k, 22 * k, 4.4 * k);
          ctx.fillStyle = '#1d2125';
          ctx.fillText(cl.name, x0 + 30 * k, y);
        });
      }
    }
  };
})();
