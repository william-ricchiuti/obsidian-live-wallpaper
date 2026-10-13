// @name Cross-stitch
// @description Embroidered on Aida cloth: notes become blocks of X stitches, links are backstitched in dark thread.
// @light
(function () {
  'use strict';
  const K = SceneKit;
  THEMES.stitch = {
    kind: 'scene', name: 'Cross-stitch', dark: false, fg: '#3e352d', ghost: '#a99f90', motion: 0,
    background: '#eee8db', labelFont: K.MONO, labelSize: 10, labelWeight: 600,
    pal: ['#c8414b', '#3d6fa6', '#e3a832', '#4f8f5a', '#d9773a', '#7a5a9e', '#3ea3a3', '#a0553a'],
    draw(ctx, S) {
      const { W, H, k } = S;
      const c = Math.max(4, Math.round(7 * k));
      ctx.fillStyle = this.background;
      ctx.fillRect(0, 0, W, H);
      ctx.fillStyle = K.pattern(ctx, 'aida' + c, () => {
        const p = document.createElement('canvas');
        p.width = p.height = c;
        const g = p.getContext('2d');
        g.fillStyle = 'rgba(120,100,70,0.07)';
        g.fillRect(0, 0, c, 1);
        g.fillRect(0, 0, 1, c);
        g.fillStyle = 'rgba(110,90,60,0.28)';
        g.fillRect(0, 0, 1.2, 1.2);
        return p;
      });
      ctx.fillRect(0, 0, W, H);
      // Backstitch: short segments with gaps along each link.
      ctx.strokeStyle = '#4b4038';
      ctx.lineWidth = Math.max(0.8, 0.9 * k);
      ctx.globalAlpha = 0.35;
      ctx.lineCap = 'round';
      ctx.beginPath();
      for (const l of S.links) {
        const ax = Math.round(l.a.x / c) * c, ay = Math.round(l.a.y / c) * c;
        const bx = Math.round(l.b.x / c) * c, by = Math.round(l.b.y / c) * c;
        const n = Math.max(1, Math.round(Math.hypot(bx - ax, by - ay) / (c * 1.4)));
        for (let i = 0; i < n; i++) {
          const u0 = i / n + 0.08 / n, u1 = (i + 1) / n - 0.08 / n;
          ctx.moveTo(K.lerp(ax, bx, u0), K.lerp(ay, by, u0));
          ctx.lineTo(K.lerp(ax, bx, u1), K.lerp(ay, by, u1));
        }
      }
      ctx.stroke();
      ctx.globalAlpha = 1;
      const groups = new Map();
      for (const n of S.nodes) {
        const colr = n.ghost ? this.ghost : K.col(this, S, n);
        const key = colr + (n.dim ? '|d' : '');
        let g = groups.get(key);
        if (!g) { g = { colr, dim: n.dim, cells: [] }; groups.set(key, g); }
        const gx = Math.round(n.x / c), gy = Math.round(n.y / c);
        const rc = n.ghost ? 0 : Math.max(0, Math.round(n.r / c * 0.5 * (0.4 + n.imp)));
        for (let dy = -rc; dy <= rc; dy++) {
          for (let dx = -rc; dx <= rc; dx++) {
            if (dx * dx + dy * dy > rc * rc + 0.6) continue;
            g.cells.push((gx + dx) * c, (gy + dy) * c);
          }
        }
      }
      ctx.lineWidth = c * 0.3;
      ctx.lineCap = 'round';
      const e = c * 0.36;
      for (const g of groups.values()) {
        ctx.globalAlpha = g.dim ? 0.3 : 1;
        for (const pass of [0, 1]) {
          // Under-stitch slightly darker so the top stitch reads as thread.
          ctx.strokeStyle = pass ? g.colr : K.mix(g.colr, '#000000', 0.25);
          ctx.beginPath();
          for (let i = 0; i < g.cells.length; i += 2) {
            const x = g.cells[i] - c / 2, y = g.cells[i + 1] - c / 2;
            if (pass) { ctx.moveTo(x - e, y - e); ctx.lineTo(x + e, y + e); }
            else { ctx.moveTo(x + e, y - e); ctx.lineTo(x - e, y + e); }
          }
          ctx.stroke();
        }
      }
      ctx.globalAlpha = 1;
      ctx.lineCap = 'butt';
    }
  };
})();
