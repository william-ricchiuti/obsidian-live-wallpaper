// Shared helpers for "scene" themes. A scene theme registers
//
//   THEMES[id] = { kind: 'scene', name, dark, fg, ghost, pal, motion, draw(ctx, S, t) }
//
// and draws a whole frame from the scene object S that index.html builds each
// frame (positions already framed to the screen, colour indices resolved):
//
//   S.W, S.H        canvas size in CSS pixels; S.k = W / 1280 (size scale)
//   S.nodes[]       { i, id, x, y, bx, by, r, ci, uc, dim, ghost, imp, hub, label,
//                     ph, h1, h2, days, deg, recent, ti, tag }
//                   x/y include drift; bx/by are the undrifted positions.
//                   ci = colour index (tag/folder rank or age bucket, -1 ghost);
//                   uc = user tag colour (wins over palettes) or null.
//   S.links[]       { a, b, tree, intra, i }  (a/b are scene nodes)
//   S.clusters[]    { ti, name, x, y, rad, n } for the top tags
//   S.hubs[], S.recents[]   label candidates
//   S.ins, S.rect   safe-area insets and the framed graph rectangle
//   S.key           changes when undrifted positions or framing change
//   S.o             { labels: 'off'|'hubs'|'recent', colorBy }
//   S.pal           palette override (array) or null
//   S.stats         { notes, links, recent, unresolved }
//   S.bfs(i)        cached hop distances (Int16Array, -1 unreachable) from node i
//
// Themes must not depend on renderer globals; everything they need is on S.
(function () {
  'use strict';
  const TAU = Math.PI * 2;
  const SANS = "-apple-system, BlinkMacSystemFont, 'Inter', 'Segoe UI', sans-serif";
  const MONO = "ui-monospace, SFMono-Regular, Menlo, 'Cascadia Code', monospace";
  const DISP = "'Avenir Next', Futura, 'Segoe UI', system-ui, sans-serif";

  const HEXC = new Map();
  function hex(h) {
    let c = HEXC.get(h);
    if (c) return c;
    const n = parseInt(h.slice(1), 16);
    c = [n >> 16 & 255, n >> 8 & 255, n & 255];
    HEXC.set(h, c);
    return c;
  }
  function rgbaHex(h, a) { const c = hex(h); return `rgba(${c[0]},${c[1]},${c[2]},${a})`; }
  function mix(h1, h2, t) {
    const a = hex(h1), b = hex(h2);
    const m = i => Math.round(a[i] + (b[i] - a[i]) * t).toString(16).padStart(2, '0');
    return '#' + m(0) + m(1) + m(2);
  }
  const lerp = (a, b, t) => a + (b - a) * t;
  function ago(d) {
    if (d < 1 / 24) return 'just now';
    if (d < 1) return Math.round(d * 24) + 'h ago';
    return Math.round(d) + 'd ago';
  }

  function col(st, S, n) {
    if (n.uc) return n.uc;
    if (n.ci < 0) return st.ghost;
    const pal = (S.pal && S.pal.length) ? S.pal : st.pal;
    return pal[n.ci % pal.length];
  }

  const glowCache = new Map();
  function glow(color) {
    let c = glowCache.get(color);
    if (c) return c;
    if (glowCache.size > 96) glowCache.clear();
    c = document.createElement('canvas');
    c.width = c.height = 64;
    const g = c.getContext('2d');
    const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    gr.addColorStop(0, rgbaHex(color, 1));
    gr.addColorStop(0.22, rgbaHex(color, 0.5));
    gr.addColorStop(0.55, rgbaHex(color, 0.12));
    gr.addColorStop(1, rgbaHex(color, 0));
    g.fillStyle = gr;
    g.fillRect(0, 0, 64, 64);
    glowCache.set(color, c);
    return c;
  }

  // Strokes links grouped by colour: one path per colour.
  function edgesBatched(ctx, S, colorFn, alpha, width, curve, filter) {
    const groups = new Map();
    for (const l of S.links) {
      if (filter && !filter(l)) continue;
      const c = colorFn(l);
      let g = groups.get(c);
      if (!g) { g = []; groups.set(c, g); }
      g.push(l);
    }
    ctx.lineWidth = width;
    ctx.globalAlpha = alpha;
    for (const [c, list] of groups) {
      ctx.strokeStyle = c;
      ctx.beginPath();
      for (const l of list) {
        const a = l.a, b = l.b;
        ctx.moveTo(a.x, a.y);
        if (curve) {
          const dx = b.x - a.x, dy = b.y - a.y, len = Math.hypot(dx, dy) || 1;
          const bow = Math.min(40 * S.k, len * 0.2) * (l.i & 1 ? 1 : -1);
          ctx.quadraticCurveTo((a.x + b.x) / 2 - dy / len * bow, (a.y + b.y) / 2 + dx / len * bow, b.x, b.y);
        } else {
          ctx.lineTo(b.x, b.y);
        }
      }
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  // Fills circles grouped by colour and quantised alpha.
  function dots(ctx, list, colorFn, rFn, alphaFn) {
    const groups = new Map();
    for (const n of list) {
      const c = colorFn(n);
      const a = alphaFn ? Math.round(alphaFn(n) * 8) / 8 : 1;
      const key = c + '|' + a;
      let g = groups.get(key);
      if (!g) { g = { c, a, l: [] }; groups.set(key, g); }
      g.l.push(n);
    }
    for (const g of groups.values()) {
      if (g.a <= 0) continue;
      ctx.fillStyle = g.c;
      ctx.globalAlpha = g.a;
      ctx.beginPath();
      for (const n of g.l) {
        const r = rFn(n);
        ctx.moveTo(n.x + r, n.y);
        ctx.arc(n.x, n.y, r, 0, TAU);
      }
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  const patCache = new WeakMap();
  function pattern(ctx, key, make) {
    let m = patCache.get(ctx);
    if (!m) { m = new Map(); patCache.set(ctx, m); }
    let p = m.get(key);
    if (!p) { p = ctx.createPattern(make(), 'repeat'); m.set(key, p); }
    return p;
  }

  let noiseCanvas = null;
  function noise() {
    if (noiseCanvas) return noiseCanvas;
    const c = document.createElement('canvas');
    c.width = c.height = 192;
    const g = c.getContext('2d');
    const d = g.createImageData(192, 192);
    let seed = 9;
    const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
    for (let i = 0; i < d.data.length; i += 4) {
      const v = rnd() * 255 | 0;
      d.data[i] = d.data[i + 1] = d.data[i + 2] = v;
      d.data[i + 3] = 255;
    }
    g.putImageData(d, 0, 0);
    noiseCanvas = c;
    return c;
  }

  // Default label pass for scene themes. Styles customise it through
  // labelFont/labelSize/labelWeight/labelColor/labelText/drawLabel.
  function labelPass(ctx, S, st) {
    if (!S.o.labels || S.o.labels === 'off') return;
    const list = S.o.labels === 'recent' ? S.recents : S.hubs;
    const fs = Math.max(9, (st.labelSize || 12) * Math.max(0.75, S.k));
    ctx.font = `${st.labelWeight || 500} ${fs}px ${st.labelFont || SANS}`;
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    const placed = [];
    for (const n of list) {
      let txt = st.labelText ? st.labelText(n, S) : n.label;
      if (S.o.labels === 'recent') txt += (st.agoSep || '  ·  ') + ago(n.days);
      const w = ctx.measureText(txt).width;
      const x = n.x + n.r + 7 * S.k, y = n.y;
      const box = [x - 4, y - fs, x + w + 4, y + fs];
      if (box[2] > S.W - 8 || box[0] < 4 || box[1] < 4 || box[3] > S.H - 4) continue;
      if (placed.some(b => !(box[2] < b[0] || b[2] < box[0] || box[3] < b[1] || b[3] < box[1]))) continue;
      placed.push(box);
      if (st.drawLabel) st.drawLabel(ctx, S, n, txt, x, y, w, fs);
      else {
        ctx.fillStyle = st.labelColor || st.fg;
        ctx.globalAlpha = 0.9;
        ctx.fillText(txt, x, y);
      }
      ctx.globalAlpha = 1;
    }
  }

  window.SceneKit = { TAU, SANS, MONO, DISP, hex, rgbaHex, mix, lerp, ago, col, glow, edgesBatched, dots, pattern, noise, labelPass };
})();
