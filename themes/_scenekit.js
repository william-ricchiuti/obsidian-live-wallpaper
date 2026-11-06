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
//   S.linkStep      draw every linkStep-th link (large-vault budget; 1 = all)
//   S.activeIndex   index in S.nodes of the note open in Obsidian (bridge plugin), or -1
//   S.labelCount    max labels to draw; S.labelMinImportance  min n.imp for a label
//
// Anything derived only from the layout should be cached with K.memo (keyed on
// S.key plus a sample of positions); loops over links should go through
// K.links(S), which applies S.linkStep.
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

  // Two-level memo (colour → number → string) with a size cap, so per-frame
  // colour helpers don't build a new string on every call.
  function memo2(limit) {
    let top = new Map(), size = 0;
    return {
      get(a, b) { const m = top.get(a); return m === undefined ? undefined : m.get(b); },
      set(a, b, v) {
        if (++size > limit) { top = new Map(); size = 1; }
        let m = top.get(a);
        if (!m) { m = new Map(); top.set(a, m); }
        m.set(b, v);
      }
    };
  }
  const RGBA = memo2(8192);
  function rgbaHex(h, a) {
    let s = RGBA.get(h, a);
    if (s === undefined) {
      const c = hex(h);
      s = `rgba(${c[0]},${c[1]},${c[2]},${a})`;
      RGBA.set(h, a, s);
    }
    return s;
  }
  // mix(h1, h2, t): nested maps h1 → h2 → t, no key strings on the hot path.
  let MIX = new Map(), mixSize = 0;
  function mix(h1, h2, t) {
    let m1 = MIX.get(h1);
    let m2 = m1 === undefined ? undefined : m1.get(h2);
    let r = m2 === undefined ? undefined : m2.get(t);
    if (r !== undefined) return r;
    const a = hex(h1), b = hex(h2);
    const ch = i => Math.round(a[i] + (b[i] - a[i]) * t).toString(16).padStart(2, '0');
    r = '#' + ch(0) + ch(1) + ch(2);
    if (++mixSize > 8192) { MIX = new Map(); mixSize = 1; m1 = m2 = undefined; }
    if (!m1) { m1 = new Map(); MIX.set(h1, m1); }
    if (!m2) { m2 = new Map(); m1.set(h2, m2); }
    m2.set(t, r);
    return r;
  }
  const lerp = (a, b, t) => a + (b - a) * t;
  function ago(d) {
    if (d < 1 / 24) return 'just now';
    if (d < 1) return Math.round(d * 24) + 'h ago';
    return Math.round(d) + 'd ago';
  }

  // The user palette (S.pal) is chosen for dark backgrounds; light themes keep
  // their own inks so notes stay legible on paper. User tag colours still win.
  function pal(st, S) {
    return (st.dark !== false && S.pal && S.pal.length) ? S.pal : st.pal;
  }
  function col(st, S, n) {
    if (n.uc) return n.uc;
    if (n.ci < 0) return st.ghost;
    const p = pal(st, S);
    return p[n.ci % p.length];
  }

  // Glow sprites. The cap is far above any realistic colour count (palette +
  // ghost + user tag colours), and eviction is oldest-first, so a large
  // colour set no longer clears the cache and rebuilds sprites every frame.
  const glowCache = new Map();
  const GLOW_MAX = 256;
  function glow(color) {
    let c = glowCache.get(color);
    if (c) return c;
    if (glowCache.size >= GLOW_MAX) glowCache.delete(glowCache.keys().next().value);
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

  // Layout fingerprint: S.key plus a sample of current positions, so caches
  // also refresh while the layout is still settling between framing epochs.
  function layoutKey(S) {
    const ns = S.nodes, n = ns.length;
    const step = Math.max(1, (n / 61) | 0);
    let h = 0;
    for (let i = 0; i < n; i += step) {
      const p = ns[i];
      if (p.x === p.x && p.y === p.y) h += (p.x * 1.618 + p.y * 2.718) * (1 + (i % 7));
    }
    return S.key + '|' + n + '|' + S.links.length + '|' + (S.linkStep || 1) + '|' + Math.round(h * 4);
  }
  // Named cache for anything derived from the layout. `extra` extends the key
  // (sizes, device scale, time steps). A rebuilt scene (new node/link arrays,
  // which carry colours and dim state) also invalidates.
  const MEMO = new Map();
  function memo(name, S, extra, build) {
    const key = extra === undefined ? layoutKey(S) : layoutKey(S) + '|' + extra;
    let m = MEMO.get(name);
    if (!m || m.key !== key || m.nodes !== S.nodes || m.links !== S.links) {
      m = { key, nodes: S.nodes, links: S.links, v: build() };
      MEMO.set(name, m);
    }
    return m.v;
  }
  // The links to draw under the large-vault budget: every linkStep-th one.
  function linkList(S) {
    const step = S.linkStep || 1;
    if (step <= 1) return S.links;
    let c = linkList.c;
    if (!c || c.src !== S.links || c.step !== step) {
      const out = [];
      for (let i = 0; i < S.links.length; i += step) out.push(S.links[i]);
      c = linkList.c = { src: S.links, step, out };
    }
    return c.out;
  }
  // Device pixels per CSS pixel under the context's current transform.
  function dpr(ctx) {
    const m = ctx.getTransform ? ctx.getTransform() : null;
    return m ? Math.max(0.5, Math.hypot(m.a, m.b)) : 1;
  }

  // Strokes links grouped by colour: one path per colour. With an `id` (one
  // per call site) the grouped Path2Ds are cached per layout; colorFn and
  // filter must then depend only on the scene, not on time.
  function edgesBatched(ctx, S, colorFn, alpha, width, curve, filter, id) {
    const build = () => {
      const groups = new Map();
      for (const l of linkList(S)) {
        if (filter && !filter(l)) continue;
        const c = colorFn(l);
        let p = groups.get(c);
        if (!p) { p = new Path2D(); groups.set(c, p); }
        const a = l.a, b = l.b;
        p.moveTo(a.x, a.y);
        if (curve) {
          const dx = b.x - a.x, dy = b.y - a.y, len = Math.hypot(dx, dy) || 1;
          const bow = Math.min(40 * S.k, len * 0.2) * (l.i & 1 ? 1 : -1);
          p.quadraticCurveTo((a.x + b.x) / 2 - dy / len * bow, (a.y + b.y) / 2 + dx / len * bow, b.x, b.y);
        } else {
          p.lineTo(b.x, b.y);
        }
      }
      return groups;
    };
    const groups = id ? memo('edges:' + id, S, curve ? 1 : 0, build) : build();
    ctx.lineWidth = width;
    ctx.globalAlpha = alpha;
    for (const [c, p] of groups) {
      ctx.strokeStyle = c;
      ctx.stroke(p);
    }
    ctx.globalAlpha = 1;
  }

  // Fills circles grouped by colour and alpha quantised to eighths. Group
  // lists are pooled across calls: no per-node key strings or Map entries.
  const dotPool = new Map();
  function dots(ctx, list, colorFn, rFn, alphaFn) {
    if (dotPool.size > 512) dotPool.clear();
    for (const lv of dotPool.values()) for (let j = 1; j < 9; j++) lv[j].length = 0;
    for (const n of list) {
      let a = alphaFn ? Math.round(alphaFn(n) * 8) : 8;
      if (!(a > 0)) continue;
      if (a > 8) a = 8;
      const c = colorFn(n);
      let lv = dotPool.get(c);
      if (!lv) { lv = [null, [], [], [], [], [], [], [], []]; dotPool.set(c, lv); }
      lv[a].push(n);
    }
    for (const [c, lv] of dotPool) {
      for (let j = 1; j < 9; j++) {
        const l = lv[j];
        if (!l.length) continue;
        ctx.fillStyle = c;
        ctx.globalAlpha = j / 8;
        ctx.beginPath();
        for (const n of l) {
          const r = rFn(n);
          ctx.moveTo(n.x + r, n.y);
          ctx.arc(n.x, n.y, r, 0, TAU);
        }
        ctx.fill();
        l.length = 0;
      }
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

  const LABEL_MAX = 28;
  function truncLabel(s) {
    s = String(s == null ? '' : s);
    return s.length > LABEL_MAX ? s.slice(0, LABEL_MAX - 1).trimEnd() + '…' : s;
  }
  // Label candidates within the budget: at most S.labelCount, and (except in
  // 'recent' mode, as in the default pipeline) at least S.labelMinImportance.
  function labelList(S) {
    if (!S.o.labels || S.o.labels === 'off') return [];
    const recent = S.o.labels === 'recent';
    const src = (recent ? S.recents : S.hubs) || [];
    const max = Math.min(src.length, S.labelCount == null ? src.length : S.labelCount);
    const minImp = recent ? 0 : (S.labelMinImportance || 0);
    const out = [];
    for (const n of src) {
      if (out.length >= max) break;
      if ((n.imp || 0) < minImp) continue;
      out.push(n);
    }
    return out;
  }

  // Default label pass for scene themes. Styles customise it through
  // labelFont/labelSize/labelWeight/labelColor/labelUpper/labelText/drawLabel;
  // labelText(n, S, label) gets the label already truncated to 28 characters.
  function labelPass(ctx, S, st) {
    const list = labelList(S);
    if (!list.length) return;
    const fs = Math.max(9, (st.labelSize || 12) * Math.max(0.75, S.k));
    ctx.font = `${st.labelWeight || 500} ${fs}px ${st.labelFont || SANS}`;
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    const placed = [];
    const overlaps = box => placed.some(b => !(box[2] < b[0] || b[2] < box[0] || box[3] < b[1] || b[3] < box[1]));
    for (const n of list) {
      const base = truncLabel(n.label);
      let txt = st.labelText ? st.labelText(n, S, base) : base;
      if (S.o.labels === 'recent') txt += (st.agoSep || '  ·  ') + ago(n.days);
      if (st.labelUpper) txt = txt.toUpperCase();
      const w = ctx.measureText(txt).width;
      const gap = n.r + 7 * S.k, y = n.y;
      let x = n.x + gap;
      if (x + w + 4 > S.W - 8) x = n.x - gap - w; // flip left instead of dropping
      const box = [x - 4, y - fs, x + w + 4, y + fs];
      if (box[2] > S.W - 8 || box[0] < 4 || box[1] < 4 || box[3] > S.H - 4) continue;
      if (overlaps(box)) continue;
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

  window.SceneKit = {
    TAU, SANS, MONO, DISP, hex, rgbaHex, mix, lerp, ago, pal, col, glow,
    layoutKey, memo, links: linkList, dpr, edgesBatched, dots, pattern, noise,
    truncLabel, labelList, labelPass
  };
})();
