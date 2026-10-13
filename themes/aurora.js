// @name Aurora
// @description Each tag cluster casts a slow curtain of coloured light; additive blending makes hubs glow brighter, not muddier.
(function () {
  'use strict';
  const K = SceneKit;
  THEMES.aurora = {
    kind: 'scene', name: 'Aurora', dark: true, fg: '#e3ebff', ghost: '#4a5578', motion: 1.4,
    background: '#03050b',
    pal: ['#5ef2c8', '#7aa8ff', '#c77dff', '#ff7ab6', '#ffd479', '#6ee7ff', '#a3ff8f', '#ff9f6e'],
    draw(ctx, S, t) {
      const { W, H, k } = S;
      const g = ctx.createLinearGradient(0, 0, 0, H);
      g.addColorStop(0, '#071022');
      g.addColorStop(1, '#020309');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, W, H);
      ctx.globalCompositeOperation = 'lighter';
      for (const c of S.clusters) {
        const pal = S.pal || this.pal;
        const color = pal[c.ti % pal.length];
        const rad = Math.max(90 * k, c.rad * 1.5);
        for (let j = 0; j < 3; j++) {
          ctx.save();
          ctx.translate(c.x + Math.sin(t * 0.07 + c.ti * 1.7 + j * 2.1) * rad * 0.35, c.y - rad * 0.35 + Math.cos(t * 0.05 + c.ti + j) * rad * 0.15);
          ctx.rotate(Math.sin(t * 0.03 + c.ti + j) * 0.35);
          ctx.scale(0.5, 1.7);
          const gr = ctx.createRadialGradient(0, 0, 0, 0, 0, rad);
          gr.addColorStop(0, K.rgbaHex(color, 0.085));
          gr.addColorStop(1, K.rgbaHex(color, 0));
          ctx.fillStyle = gr;
          ctx.beginPath();
          ctx.arc(0, 0, rad, 0, K.TAU);
          ctx.fill();
          ctx.restore();
        }
      }
      K.edgesBatched(ctx, S, l => K.col(this, S, l.a), 0.13, 0.8 * k, true);
      for (const n of S.nodes) {
        const c = K.col(this, S, n);
        const s = (n.r * 5 + 6 * k) * (1 + 0.12 * Math.sin(t * 0.5 + n.ph));
        ctx.globalAlpha = (n.ghost ? 0.12 : 0.25 + n.imp * 0.55) * (n.dim ? 0.2 : 1);
        ctx.drawImage(K.glow(c), n.x - s / 2, n.y - s / 2, s, s);
      }
      ctx.globalAlpha = 1;
      K.dots(ctx, S.nodes, n => n.ghost ? this.ghost : K.mix(K.col(this, S, n), '#ffffff', 0.55), n => Math.max(0.8 * k, n.r * 0.45), n => n.dim ? 0.25 : 0.9);
      ctx.globalCompositeOperation = 'source-over';
    }
  };
})();
