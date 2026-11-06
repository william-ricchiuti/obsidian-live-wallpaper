// @name Risograph
// @description A riso print: each tag gets a real riso ink on its own slightly misregistered plate, hubs are halftone-screened.
// @light
(function () {
  'use strict';
  const K = SceneKit;
  // Plate misregistration per ink, in px at 1280 wide.
  const OFF = [[0, 0], [1.6, -1.1], [-1.3, 1.4], [0.9, 1.7], [-1.7, -0.8], [1.2, 0.6], [-0.6, -1.5], [1.9, 1]];

  // Halftone screens as sprites per (ink, radius bucket, spacing, device
  // scale): a hub used to cost O((2R/sp)²) arcs every frame.
  const SPRITE_MAX = 320;
  const sprites = new Map();
  function halftone(c, R, sp, scale) {
    const key = c + '|' + R + '|' + sp + '|' + scale;
    let s = sprites.get(key);
    if (s) return s;
    if (sprites.size >= SPRITE_MAX) sprites.delete(sprites.keys().next().value);
    const half = R + 1;
    const cv = document.createElement('canvas');
    cv.width = cv.height = Math.max(1, Math.ceil(half * 2 * scale));
    const g = cv.getContext('2d');
    g.setTransform(scale, 0, 0, scale, 0, 0);
    g.fillStyle = c;
    g.beginPath();
    for (let gy = -R; gy <= R; gy += sp) {
      for (let gx = -R; gx <= R; gx += sp) {
        const d = Math.hypot(gx, gy);
        if (d > R) continue;
        const rr = sp * 0.5 * (1 - d / R * 0.6);
        g.moveTo(half + gx + rr, half + gy);
        g.arc(half + gx, half + gy, rr, 0, K.TAU);
      }
    }
    g.fill();
    s = { cv, half, size: cv.width / scale };
    sprites.set(key, s);
    return s;
  }

  THEMES.riso = {
    kind: 'scene', name: 'Risograph', dark: false, fg: '#0078bf', ghost: '#b9b2a6', motion: 0.5,
    background: '#f3efe7', labelFont: K.MONO, labelSize: 10.5, labelWeight: 600,
    // Labels are printed in capitals; uppercasing happens before measuring.
    labelUpper: true,
    // Fluorescent Pink, Blue, Yellow, Green, Orange, Purple, Bright Red, Teal
    pal: ['#ff48b0', '#0078bf', '#ffe800', '#00a95c', '#ff6c2f', '#765ba7', '#ff665e', '#00838a'],
    drawLabel(ctx, S, n, txt, x, y) {
      ctx.globalCompositeOperation = 'multiply';
      ctx.fillStyle = '#0078bf';
      ctx.fillText(txt, x + 1.2 * S.k, y - 0.8 * S.k);
      ctx.globalCompositeOperation = 'source-over';
    },
    draw(ctx, S) {
      const { W, H, k } = S;
      const ox = OFF.map(v => v[0] * k * 1.4), oy = OFF.map(v => v[1] * k * 1.4);
      const scale = K.dpr(ctx);
      ctx.fillStyle = this.background;
      ctx.fillRect(0, 0, W, H);
      ctx.globalCompositeOperation = 'multiply';
      ctx.save();
      ctx.translate(ox[1], oy[1]);
      K.edgesBatched(ctx, S, () => '#0078bf', 0.42, 0.75 * k, false, null, 'riso');
      ctx.restore();
      const sp = Math.max(1.5, 3.2 * k);
      for (const n of S.nodes) {
        const c = K.col(this, S, n);
        const p = n.ci < 0 ? 0 : n.ci % 8;
        const x = n.x + ox[p], y = n.y + oy[p];
        ctx.fillStyle = c;
        ctx.globalAlpha = n.dim ? 0.3 : 0.92;
        if (n.imp > 0.18 && !n.ghost) {
          const R = Math.max(0.5, Math.round(n.r * 1.9 * 2) / 2);
          const s = halftone(c, R, sp, scale);
          ctx.drawImage(s.cv, x - s.half, y - s.half, s.size, s.size);
          ctx.strokeStyle = c;
          ctx.lineWidth = 1.1 * k;
          ctx.beginPath();
          ctx.arc(x, y, n.r * 1.9 + 1.5 * k, 0, K.TAU);
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
