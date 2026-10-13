// @name Bauhaus
// @description A poster in primaries: tags become shapes as well as colours, and the biggest hubs anchor large compositional forms.
// @light
(function () {
  'use strict';
  const K = SceneKit;
  THEMES.bauhaus = {
    kind: 'scene', name: 'Bauhaus', dark: false, fg: '#151515', ghost: '#151515', motion: 0.4,
    background: '#ece8df', labelFont: K.DISP, labelSize: 12, labelWeight: 700,
    labelText: n => n.label.toUpperCase(),
    pal: ['#d4372c', '#1f4e9c', '#f2b705', '#151515', '#2f8f5b', '#e36f2c', '#7a4a9e', '#6b6b6b'],
    draw(ctx, S, t) {
      const { W, H, k } = S;
      ctx.fillStyle = this.background;
      ctx.fillRect(0, 0, W, H);
      const m = Math.min(W, H);
      const [h0, h1, h2] = S.hubs;
      if (h0) { ctx.fillStyle = '#f2b705'; ctx.beginPath(); ctx.arc(h0.bx, h0.by, m * 0.2, 0, K.TAU); ctx.fill(); }
      if (h1) {
        ctx.save(); ctx.translate(h1.bx, h1.by); ctx.rotate(0.21);
        ctx.fillStyle = '#1f4e9c'; ctx.globalAlpha = 0.9;
        ctx.fillRect(-m * 0.07, -m * 0.07, m * 0.14, m * 0.14);
        ctx.restore();
      }
      if (h2) {
        ctx.save(); ctx.translate(h2.bx, h2.by);
        ctx.fillStyle = '#d4372c'; ctx.globalAlpha = 0.88;
        ctx.beginPath(); ctx.arc(0, 0, m * 0.1, Math.PI, K.TAU); ctx.fill();
        ctx.restore();
      }
      ctx.globalAlpha = 1;
      if (h0) { ctx.fillStyle = '#151515'; ctx.fillRect(S.rect.x, Math.min(H - 10, h0.by + m * 0.23), S.rect.w * 0.42, 3 * k); }
      K.edgesBatched(ctx, S, () => '#151515', 0.5, 0.7 * k, false);
      K.edgesBatched(ctx, S, () => '#151515', 0.9, 2.6 * k, false, l => l.a.deg >= 12 && l.b.deg >= 12);
      ctx.globalCompositeOperation = 'multiply';
      for (const n of S.nodes) {
        const s = Math.max(1.6 * k, n.r * 1.35);
        ctx.globalAlpha = n.dim ? 0.25 : 1;
        if (n.ghost) {
          ctx.strokeStyle = '#151515'; ctx.lineWidth = 0.8 * k;
          ctx.beginPath(); ctx.arc(n.x, n.y, 1.8 * k, 0, K.TAU); ctx.stroke();
          continue;
        }
        ctx.fillStyle = K.col(this, S, n);
        const shape = ((n.ci % 4) + 4) % 4;
        ctx.beginPath();
        if (shape === 0) ctx.arc(n.x, n.y, s, 0, K.TAU);
        else if (shape === 1) {
          ctx.save(); ctx.translate(n.x, n.y); ctx.rotate(n.ph + t * 0.04);
          ctx.rect(-s * 0.88, -s * 0.88, s * 1.76, s * 1.76);
          ctx.restore();
        } else if (shape === 2) {
          ctx.moveTo(n.x, n.y - s * 1.15); ctx.lineTo(n.x + s, n.y + s * 0.7); ctx.lineTo(n.x - s, n.y + s * 0.7); ctx.closePath();
        } else {
          ctx.arc(n.x, n.y, s, n.ph, n.ph + Math.PI); ctx.closePath();
        }
        ctx.fill();
      }
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
    }
  };
})();
