// @name LED Board
// @description The graph resampled onto a grid of physical LEDs, unlit diodes faintly visible, with a ticker of vault stats.
(function () {
  'use strict';
  const K = SceneKit;
  const TICKER_ROWS = 9;      // bottom grid rows re-sampled every frame for the ticker
  const TWINKLE_NODES = 1500; // most important notes that twinkle
  const UNLIT = '#22170e';

  // Buckets lit grid cells by quantised colour (as the board always did) and
  // fills each bucket's diodes in one path. Cells are [x, y] grid coords.
  const q = v => Math.min(5, Math.round(Math.min(255, v * 1.15) / 51));
  const BUCKET_STYLE = [];
  for (let key = 0; key < 216; key++) BUCKET_STYLE.push(`rgb(${Math.floor(key / 36) * 51},${Math.floor(key / 6) % 6 * 51},${key % 6 * 51})`);
  function classify(d, gw, rows, y0, unlit, buckets) {
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < gw; x++) {
        const i = (y * gw + x) * 4;
        const r = d[i], g = d[i + 1], b = d[i + 2];
        if (Math.max(r, g, b) < 14) { unlit.push(x, y + y0); continue; }
        const key = q(r) * 36 + q(g) * 6 + q(b);
        let a = buckets.get(key);
        if (!a) { a = []; buckets.set(key, a); }
        a.push(x, y + y0);
      }
    }
  }
  function diodes(g, arr, cell, rad) {
    g.beginPath();
    for (let i = 0; i < arr.length; i += 2) {
      const cx = arr[i] * cell + cell / 2, cy = arr[i + 1] * cell + cell / 2;
      g.moveTo(cx + rad, cy);
      g.arc(cx, cy, rad, 0, K.TAU);
    }
    g.fill();
  }

  // Renders the graph once per layout into the low-res grid, reads it back
  // once, and bakes the lit/unlit diodes into a full-resolution layer.
  // Per frame only the ticker strip is re-sampled and the twinkle is a cheap
  // darkening of the brightest notes' own diodes.
  function build(st, S, cell, gw, gh, scale) {
    const { W, H } = S;
    const rows = Math.min(gh, TICKER_ROWS);
    const f = document.createElement('canvas');
    f.width = gw; f.height = gh;
    const g = f.getContext('2d', { willReadFrequently: true });
    g.fillStyle = '#000';
    g.fillRect(0, 0, gw, gh);
    g.globalCompositeOperation = 'lighter';
    g.setTransform(1 / cell, 0, 0, 1 / cell, 0, 0);
    K.edgesBatched(g, S, l => K.col(st, S, l.a), 0.12, cell * 0.5, false);
    for (const n of S.nodes) {
      g.fillStyle = K.col(st, S, n);
      g.globalAlpha = n.ghost ? 0.15 : (0.3 + n.imp * 0.6) * (n.dim ? 0.3 : 1);
      g.beginPath();
      g.arc(n.x, n.y, Math.max(cell * 0.45, n.r * 0.9), 0, K.TAU);
      g.fill();
    }
    g.globalAlpha = 1;
    g.setTransform(1, 0, 0, 1, 0, 0);
    const d = g.getImageData(0, 0, gw, gh).data;
    const stripBase = g.getImageData(0, gh - rows, gw, rows);

    const layer = document.createElement('canvas');
    layer.width = Math.max(1, Math.round(W * scale));
    layer.height = Math.max(1, Math.round(H * scale));
    const lg = layer.getContext('2d');
    lg.setTransform(scale, 0, 0, scale, 0, 0);
    lg.fillStyle = st.background;
    lg.fillRect(0, 0, W, H);
    const unlit = [], buckets = new Map();
    classify(d, gw, gh - rows, 0, unlit, buckets);
    const rad = cell * 0.36;
    lg.fillStyle = UNLIT;
    diodes(lg, unlit, cell, rad);
    for (const [key, arr] of buckets) { lg.fillStyle = BUCKET_STYLE[key]; diodes(lg, arr, cell, rad); }

    // Twinkle: each lit diode belongs to at most one note (the most
    // important one covering it).
    const owner = new Uint8Array(gw * gh);
    const tw = S.nodes.filter(n => !n.ghost && Number.isFinite(n.x) && Number.isFinite(n.y))
      .sort((a, b) => b.imp - a.imp).slice(0, TWINKLE_NODES);
    const twNodes = [], twStart = [], twCells = [];
    for (const n of tw) {
      const rr = Math.max(cell * 0.45, n.r * 0.9) + cell * 0.3;
      const x0 = Math.max(0, Math.floor((n.x - rr) / cell)), x1 = Math.min(gw - 1, Math.floor((n.x + rr) / cell));
      const y0 = Math.max(0, Math.floor((n.y - rr) / cell)), y1 = Math.min(gh - rows - 1, Math.floor((n.y + rr) / cell));
      const start = twCells.length;
      for (let y = y0; y <= y1; y++) {
        for (let x = x0; x <= x1; x++) {
          const o = y * gw + x;
          if (owner[o]) continue;
          const i = o * 4;
          if (Math.max(d[i], d[i + 1], d[i + 2]) < 14) continue;
          if (Math.hypot(x * cell + cell / 2 - n.x, y * cell + cell / 2 - n.y) > rr) continue;
          owner[o] = 1;
          twCells.push(x, y);
        }
      }
      if (twCells.length > start) { twNodes.push(n); twStart.push(start, twCells.length); }
    }

    const strip = document.createElement('canvas');
    strip.width = gw; strip.height = rows;
    return {
      layer, rows, rad, stripBase, twNodes, twStart, twCells,
      strip, sg: strip.getContext('2d', { willReadFrequently: true }),
      lvl: [[], [], [], []], unlit: [], buckets: new Map()
    };
  }

  THEMES.led = {
    kind: 'scene', name: 'LED Board', dark: true, fg: '#ffb347', ghost: '#5a3a1a', motion: 1,
    background: '#0c0805', alwaysAnimate: true, labelFont: K.MONO, labelSize: 11, labelWeight: 600,
    pal: ['#ff4d2e', '#ffb02e', '#ffe14d', '#3dff7a', '#2ee6ff', '#4d7cff', '#c94dff', '#ff4dc4'],
    draw(ctx, S, t) {
      const { W, H, k } = S;
      const cell = Math.max(4, Math.round(8.5 * k));
      const gw = Math.ceil(W / cell), gh = Math.ceil(H / cell);
      // The baked board is one full-screen bitmap. At device resolution that is
      // ~33 MB at 1080p@2x and ~59 MB at 1440p@2x, so on high-DPI screens
      // cap it near 4 Mpx (~16 MB) and let it upscale a little, which the
      // quantised diode look hides. Never below CSS resolution.
      const LAYER_MAX_PIXELS = 4e6;
      const scale = Math.min(K.dpr(ctx), Math.max(1, Math.sqrt(LAYER_MAX_PIXELS / Math.max(1, W * H))));
      const b = K.memo('led', S, `${cell}|${gw}x${gh}|${scale}`, () => build(this, S, cell, gw, gh, scale));
      ctx.drawImage(b.layer, 0, 0, W, H);

      // Twinkle: notes dim by up to 30% on their own phase, in 0.1 steps
      // (the board's brightness is quantised anyway).
      const lvl = b.lvl;
      for (let j = 1; j < 4; j++) lvl[j].length = 0;
      for (let j = 0; j < b.twNodes.length; j++) {
        const n = b.twNodes[j];
        const L = Math.round(1.5 * (1 - Math.sin(t * 2 + n.ph)));
        if (L > 0) lvl[L].push(j);
      }
      ctx.fillStyle = '#000';
      for (let L = 1; L < 4; L++) {
        if (!lvl[L].length) continue;
        ctx.globalAlpha = L * 0.1;
        ctx.beginPath();
        for (const j of lvl[L]) {
          for (let i = b.twStart[j * 2]; i < b.twStart[j * 2 + 1]; i += 2) {
            const cx = b.twCells[i] * cell + cell / 2, cy = b.twCells[i + 1] * cell + cell / 2;
            ctx.moveTo(cx + b.rad, cy);
            ctx.arc(cx, cy, b.rad, 0, K.TAU);
          }
        }
        ctx.fill();
      }
      ctx.globalAlpha = 1;

      // Ticker: re-sample only the bottom strip of the board.
      const sg = b.sg, rows = b.rows;
      sg.globalCompositeOperation = 'source-over';
      sg.putImageData(b.stripBase, 0, 0);
      sg.globalCompositeOperation = 'lighter';
      const ticker = `  ${S.stats.notes} NOTES  ·  ${S.stats.links} LINKS  ·  ${S.stats.recent} EDITED TODAY  ·  `;
      sg.font = `600 7px ${K.MONO}`;
      sg.fillStyle = '#ffb02e';
      sg.textBaseline = 'bottom';
      const tw = sg.measureText(ticker).width || 1;
      const off = (t * 10) % tw;
      for (let x = -off; x < gw; x += tw) sg.fillText(ticker, x, rows - 1);
      const d = sg.getImageData(0, 0, gw, rows).data;
      const unlit = b.unlit, buckets = b.buckets;
      unlit.length = 0;
      for (const a of buckets.values()) a.length = 0;
      classify(d, gw, rows, gh - rows, unlit, buckets);
      ctx.fillStyle = UNLIT;
      diodes(ctx, unlit, cell, b.rad);
      for (const [key, arr] of buckets) {
        if (!arr.length) continue;
        ctx.fillStyle = BUCKET_STYLE[key];
        diodes(ctx, arr, cell, b.rad);
      }
    }
  };
})();
