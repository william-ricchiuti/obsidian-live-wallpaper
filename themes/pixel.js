// @name Pocket Pixel
// @description Drawn at quarter resolution, quantised to a 4-shade handheld palette with ordered Bayer dithering, scaled up with hard pixels.
(function () {
  'use strict';
  const K = SceneKit;
  const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
  const SHADES = [[15, 56, 15], [48, 98, 48], [139, 172, 15], [155, 188, 15]];
  THEMES.pixel = {
    kind: 'scene', name: 'Pocket Pixel', dark: true, fg: '#9bbc0f', ghost: '#306230', motion: 0.8,
    background: '#0f380f', labelsBuiltIn: true, pal: ['#9bbc0f'],
    draw(ctx, S, t) {
      const { W, H, k } = S;
      const px = Math.max(2, Math.round(3.2 * k));
      const lw = Math.ceil(W / px), lh = Math.ceil(H / px);
      let st = this._p;
      if (!st || st.lw !== lw || st.lh !== lh) {
        const c = document.createElement('canvas');
        c.width = lw; c.height = lh;
        st = this._p = { lw, lh, c, g: c.getContext('2d', { willReadFrequently: true }) };
      }
      const f = st.g;
      f.setTransform(1, 0, 0, 1, 0, 0);
      const bg = f.createRadialGradient(lw / 2, lh / 2, 0, lw / 2, lh / 2, Math.hypot(lw, lh) / 2);
      bg.addColorStop(0, '#3a3a3a');
      bg.addColorStop(1, '#000');
      f.fillStyle = bg;
      f.fillRect(0, 0, lw, lh);
      f.setTransform(1 / px, 0, 0, 1 / px, 0, 0);
      K.edgesBatched(f, S, () => '#4a4a4a', 0.55, px * 0.8, false);
      const blink = Math.floor(t * 3) % 2;
      for (const n of S.nodes) {
        const lum = n.ghost ? 95 : n.dim ? 120 : 150 + n.imp * 105;
        f.fillStyle = `rgb(${lum},${lum},${lum})`;
        const r = Math.max(px * 0.6, n.r * (0.35 + n.imp * 0.5));
        f.fillRect(Math.round(n.x - r), Math.round(n.y - r), r * 2, r * 2);
        if (n.imp > 0.5 && blink) {
          f.fillStyle = '#fff';
          f.fillRect(n.x - r * 2.4, n.y - px * 0.5, r * 4.8, px);
          f.fillRect(n.x - px * 0.5, n.y - r * 2.4, px, r * 4.8);
        }
      }
      if (S.o.labels !== 'off' && k > 0.45) {
        const list = S.o.labels === 'recent' ? S.recents : S.hubs;
        f.font = `600 ${8 * px}px ${K.MONO}`;
        f.fillStyle = '#fff';
        f.textBaseline = 'middle';
        for (const n of list.slice(0, 5)) f.fillText(n.label.toUpperCase(), n.x + n.r + 6 * px, n.y);
      }
      f.setTransform(1, 0, 0, 1, 0, 0);
      const img = f.getImageData(0, 0, lw, lh), d = img.data;
      for (let y = 0; y < lh; y++) {
        for (let x = 0; x < lw; x++) {
          const i = (y * lw + x) * 4;
          const v = d[i] / 255 * 3;
          let lv = Math.floor(v);
          if (v - lv > (BAYER[(y & 3) * 4 + (x & 3)] + 0.5) / 16) lv++;
          const c = SHADES[Math.min(3, lv)];
          d[i] = c[0]; d[i + 1] = c[1]; d[i + 2] = c[2]; d[i + 3] = 255;
        }
      }
      f.putImageData(img, 0, 0);
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(st.c, 0, 0, lw * px, lh * px);
      ctx.imageSmoothingEnabled = true;
    }
  };
})();
