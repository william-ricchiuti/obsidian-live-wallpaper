// @name Risograph
// @description A riso print: each tag gets a real riso ink on its own slightly misregistered plate, hubs are halftone-screened.
// @light
(function () {
  'use strict';
  const K = SceneKit;
  // Plate misregistration per ink, in px at 1280 wide.
  const OFF = [[0, 0], [1.6, -1.1], [-1.3, 1.4], [0.9, 1.7], [-1.7, -0.8], [1.2, 0.6], [-0.6, -1.5], [1.9, 1]];
  THEMES.riso = {
    kind: 'scene', name: 'Risograph', dark: false, fg: '#0078bf', ghost: '#b9b2a6', motion: 0.5,
    background: '#f3efe7', labelFont: K.MONO, labelSize: 10.5, labelWeight: 600,
    // Fluorescent Pink, Blue, Yellow, Green, Orange, Purple, Bright Red, Teal
    pal: ['#ff48b0', '#0078bf', '#ffe800', '#00a95c', '#ff6c2f', '#765ba7', '#ff665e', '#00838a'],
    drawLabel(ctx, S, n, txt, x, y) {
      ctx.globalCompositeOperation = 'multiply';
      ctx.fillStyle = '#0078bf';
      ctx.fillText(txt.toUpperCase(), x + 1.2 * S.k, y - 0.8 * S.k);
      ctx.globalCompositeOperation = 'source-over';
    },
    draw(ctx, S) {
      const { W, H, k } = S;
      const off = ci => ci < 0 ? [0, 0] : OFF[ci % 8].map(v => v * k * 1.4);
      ctx.fillStyle = this.background;
      ctx.fillRect(0, 0, W, H);
      ctx.globalCompositeOperation = 'multiply';
      ctx.save();
      const [bx, by] = off(1);
      ctx.translate(bx, by);
      K.edgesBatched(ctx, S, () => '#0078bf', 0.42, 0.75 * k, false);
      ctx.restore();
      for (const n of S.nodes) {
        const c = K.col(this, S, n);
        const [ox, oy] = off(n.ci);
        const x = n.x + ox, y = n.y + oy;
        ctx.fillStyle = c;
        ctx.globalAlpha = n.dim ? 0.3 : 0.92;
        if (n.imp > 0.18 && !n.ghost) {
          const R = n.r * 1.9, sp = Math.max(1.5, 3.2 * k);
          ctx.beginPath();
          for (let gy = -R; gy <= R; gy += sp) {
            for (let gx = -R; gx <= R; gx += sp) {
              const d = Math.hypot(gx, gy);
              if (d > R) continue;
              const rr = sp * 0.5 * (1 - d / R * 0.6);
              ctx.moveTo(x + gx + rr, y + gy);
              ctx.arc(x + gx, y + gy, rr, 0, K.TAU);
            }
          }
          ctx.fill();
          ctx.strokeStyle = c;
          ctx.lineWidth = 1.1 * k;
          ctx.beginPath();
          ctx.arc(x, y, R + 1.5 * k, 0, K.TAU);
          ctx.stroke();
        } else {
          ctx.beginPath();
          ctx.arc(x, y, Math.max(1.1 * k, n.r * 0.75), 0, K.TAU);
          ctx.fill();
        }
      }
      ctx.globalAlpha = 0.16;
      ctx.fillStyle = K.pattern(ctx, 'noise', K.noise);
      ctx.fillRect(0, 0, W, H);
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
    }
  };
})();
