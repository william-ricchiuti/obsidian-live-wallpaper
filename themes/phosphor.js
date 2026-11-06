// @name Phosphor
// @description A green phosphor terminal: tags become glyphs, links are dotted, with scanlines, a slow roll bar and a live watch line.
(function () {
  'use strict';
  const K = SceneKit;
  const GLYPHS = ['@', '#', '%', '&', '*', '+', '=', '$'];
  const AGE_GLYPHS = ['@', 'O', 'o', '·', '.'];
  THEMES.phosphor = {
    kind: 'scene', name: 'Phosphor', dark: true, fg: '#5dff8f', ghost: '#1f6a3a', motion: 0.4,
    background: '#020b05', alwaysAnimate: true,
    pal: ['#5dff8f'], labelFont: K.MONO, labelSize: 11,
    labelText: (_n, _S, label) => '[[' + label + ']]',
    draw(ctx, S, t) {
      const { W, H, k } = S;
      const G = this.fg;
      ctx.fillStyle = this.background;
      ctx.fillRect(0, 0, W, H);
      ctx.setLineDash([1.4 * k, 3.6 * k]);
      K.edgesBatched(ctx, S, () => G, 0.2, 0.8 * k, false, null, 'phosphor');
      ctx.setLineDash([]);
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = G;
      // Glyphs bucketed by font (weight, integer size) and glow once per
      // layout, so ctx.font is parsed once per bucket instead of per node.
      const buckets = K.memo('phosphor', S, k, () => {
        const m = new Map();
        for (const n of S.nodes) {
          const sz = Math.max(7, Math.round((8 + n.imp * 20) * k));
          const bold = n.imp > 0.4, glow = n.imp > 0.45;
          const key = sz * 4 + (bold ? 2 : 0) + (glow ? 1 : 0);
          let b = m.get(key);
          if (!b) { b = { font: `${bold ? 600 : 400} ${sz}px ${K.MONO}`, glow, list: [] }; m.set(key, b); }
          const glyph = n.ghost ? '·' : S.o.colorBy === 'age' ? AGE_GLYPHS[Math.max(0, n.ci) % 5] : GLYPHS[((n.ci % 8) + 8) % 8];
          b.list.push(n, glyph, (n.ghost ? 0.3 : 0.45 + 0.55 * n.imp) * (n.dim ? 0.3 : 1));
        }
        return Array.from(m.values());
      });
      for (const b of buckets) {
        ctx.font = b.font;
        if (b.glow) { ctx.shadowColor = G; ctx.shadowBlur = 10 * k; }
        const l = b.list;
        for (let i = 0; i < l.length; i += 3) {
          ctx.globalAlpha = l[i + 2];
          ctx.fillText(l[i + 1], l[i].x, l[i].y);
        }
        ctx.shadowBlur = 0;
      }
      ctx.globalAlpha = 1;
      if (!S.o.overlay || S.o.overlay === 'none') {
        const y = H - S.ins.b - 30 * k;
        ctx.font = `${Math.max(10, 13 * k)}px ${K.MONO}`;
        ctx.textAlign = 'left';
        ctx.fillStyle = G;
        ctx.globalAlpha = 0.85;
        const txt = `vault-watch> ${S.stats.notes} notes · ${S.stats.links.toLocaleString()} links · ${S.stats.recent} edited today `;
        const x = S.ins.l + 36 * k;
        ctx.fillText(txt, x, y);
        if ((t % 1.1) < 0.6) ctx.fillRect(x + ctx.measureText(txt).width, y - 7 * k, 8 * k, 14 * k);
        ctx.globalAlpha = 1;
      }
      ctx.fillStyle = K.pattern(ctx, 'scan', () => {
        const c = document.createElement('canvas');
        c.width = 2; c.height = 3;
        const g = c.getContext('2d');
        g.fillStyle = 'rgba(0,0,0,0.38)';
        g.fillRect(0, 0, 2, 1);
        return c;
      });
      ctx.fillRect(0, 0, W, H);
      const ry = ((t * 38 * k) % (H + 200 * k)) - 100 * k;
      const rb = ctx.createLinearGradient(0, ry - 60 * k, 0, ry + 60 * k);
      rb.addColorStop(0, 'rgba(93,255,143,0)');
      rb.addColorStop(0.5, 'rgba(93,255,143,0.035)');
      rb.addColorStop(1, 'rgba(93,255,143,0)');
      ctx.fillStyle = rb;
      ctx.fillRect(0, ry - 60 * k, W, 120 * k);
    }
  };
})();
