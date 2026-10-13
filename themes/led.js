// @name LED Board
// @description The graph resampled onto a grid of physical LEDs, unlit diodes faintly visible, with a ticker of vault stats.
(function () {
  'use strict';
  const K = SceneKit;
  THEMES.led = {
    kind: 'scene', name: 'LED Board', dark: true, fg: '#ffb347', ghost: '#5a3a1a', motion: 1,
    background: '#0c0805', alwaysAnimate: true, labelsBuiltIn: true,
    pal: ['#ff4d2e', '#ffb02e', '#ffe14d', '#3dff7a', '#2ee6ff', '#4d7cff', '#c94dff', '#ff4dc4'],
    draw(ctx, S, t) {
      const { W, H, k } = S;
      const cell = Math.max(4, Math.round(8.5 * k));
      const gw = Math.ceil(W / cell), gh = Math.ceil(H / cell);
      let st = this._f;
      if (!st || st.gw !== gw || st.gh !== gh) {
        const c = document.createElement('canvas');
        c.width = gw; c.height = gh;
        st = this._f = { gw, gh, c, g: c.getContext('2d', { willReadFrequently: true }) };
      }
      const f = st.g;
      f.setTransform(1, 0, 0, 1, 0, 0);
      f.globalCompositeOperation = 'source-over';
      f.fillStyle = '#000';
      f.fillRect(0, 0, gw, gh);
      f.globalCompositeOperation = 'lighter';
      f.setTransform(1 / cell, 0, 0, 1 / cell, 0, 0);
      K.edgesBatched(f, S, l => K.col(this, S, l.a), 0.12, cell * 0.5, false);
      for (const n of S.nodes) {
        f.fillStyle = K.col(this, S, n);
        f.globalAlpha = n.ghost ? 0.15 : (0.3 + n.imp * 0.6) * (n.dim ? 0.3 : 1) * (0.85 + 0.15 * Math.sin(t * 2 + n.ph));
        f.beginPath();
        f.arc(n.x, n.y, Math.max(cell * 0.45, n.r * 0.9), 0, K.TAU);
        f.fill();
      }
      f.globalAlpha = 1;
      f.setTransform(1, 0, 0, 1, 0, 0);
      const ticker = `  ${S.stats.notes} NOTES  ·  ${S.stats.links} LINKS  ·  ${S.stats.recent} EDITED TODAY  ·  `;
      f.font = `600 7px ${K.MONO}`;
      f.fillStyle = '#ffb02e';
      f.textBaseline = 'bottom';
      const tw = f.measureText(ticker).width || 1;
      const off = (t * 10) % tw;
      for (let x = -off; x < gw; x += tw) f.fillText(ticker, x, gh - 1);
      const d = f.getImageData(0, 0, gw, gh).data;
      ctx.fillStyle = this.background;
      ctx.fillRect(0, 0, W, H);
      const buckets = new Map();
      const unlit = [];
      const q = v => Math.min(5, Math.round(Math.min(255, v * 1.15) / 51));
      for (let y = 0; y < gh; y++) {
        for (let x = 0; x < gw; x++) {
          const i = (y * gw + x) * 4;
          const r = d[i], g = d[i + 1], b = d[i + 2];
          if (Math.max(r, g, b) < 14) { unlit.push(x, y); continue; }
          const key = q(r) * 36 + q(g) * 6 + q(b);
          let a = buckets.get(key);
          if (!a) { a = []; buckets.set(key, a); }
          a.push(x, y);
        }
      }
      const rad = cell * 0.36;
      const fill = arr => {
        ctx.beginPath();
        for (let i = 0; i < arr.length; i += 2) {
          const cx = arr[i] * cell + cell / 2, cy = arr[i + 1] * cell + cell / 2;
          ctx.moveTo(cx + rad, cy);
          ctx.arc(cx, cy, rad, 0, K.TAU);
        }
        ctx.fill();
      };
      ctx.fillStyle = '#22170e';
      fill(unlit);
      for (const [key, arr] of buckets) {
        ctx.fillStyle = `rgb(${Math.floor(key / 36) * 51},${Math.floor(key / 6) % 6 * 51},${key % 6 * 51})`;
        fill(arr);
      }
    }
  };
})();
