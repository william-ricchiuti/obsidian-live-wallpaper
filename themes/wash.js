// @name Ink Wash
// @description Watercolour on paper: pigment bleeds around each note and links are soft brush strokes.
// @light
// themes/wash.js — Ink Wash / Watercolor theme.
// Loaded as plain <script> after registry.js; THEMES is a global.
// Uses globals: cfg, nodes, links, ctx, canvas, sceneTuning, tick, innerWidth, innerHeight,
//   simAlpha, nodeColor(), edgeColor(), hexToRGB(), rgba(), finiteNumber(), hashStr(),
//   labelCandidates, ambientPool (if ambient particles are on).

(function () {
  'use strict';

  const PAPER = '#f0efe8';
  const BLEED = 0.6; // pigment bleed radius multiplier
  // Pigment bleed: 4 overlapping offset circles [dx, dy, alpha multiplier].
  const OFFSETS = [[0, 0, 1], [1.2, -0.7, 0.5], [-1.0, 0.8, 0.35], [0.4, 1.0, 0.2]];
  const IMP_LEVELS = 8; // link importance buckets (width/alpha) for batching

  // A small tiled grain instead of a full-screen random bitmap per resize.
  let paperTile = null;
  function paperTexture() {
    if (paperTile) return paperTile;
    const tex = document.createElement('canvas');
    tex.width = tex.height = 128;
    const g = tex.getContext('2d');
    const img = g.createImageData(128, 128);
    let seed = 7;
    for (let i = 0; i < img.data.length; i += 4) {
      seed = (seed * 16807) % 2147483647;
      const v = 242 + Math.floor((seed / 2147483647) * 12);
      img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
      img.data[i + 3] = 255;
    }
    g.putImageData(img, 0, 0);
    paperTile = tex;
    return tex;
  }
  let paperPattern = null, patternCtx = null;

  // The theme is dark ink on light paper: a dark configured background would
  // make it dark-on-dark, so only a light one replaces the paper colour.
  function paperColor() {
    const bg = cfg.background;
    if (typeof bg !== 'string' || !/^#[0-9a-f]{6}$/i.test(bg)) return PAPER;
    const [r, g, b] = hexToRGB(bg);
    return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255 > 0.72 ? bg : PAPER;
  }

  // Layout fingerprint over node positions (themes run with no drift).
  function fingerprint() {
    const n = nodes.length;
    const step = Math.max(1, (n / 61) | 0);
    let h = 0;
    for (let i = 0; i < n; i += step) {
      const p = nodes[i];
      if (finiteNumber(p.__fx) && finiteNumber(p.__fy)) h += (p.__fx * 1.618 + p.__fy * 2.718) * (1 + (i % 7));
    }
    return `${n}|${links.length}|${innerWidth}x${innerHeight}|${sceneTuning.linkStep || 1}|${Math.round(h * 4)}|${Math.floor(Date.now() / 60000)}`;
  }

  // Edges batched by (colour, importance bucket): one stroke per group,
  // rebuilt only when the layout, config or graph changes.
  let edgeCache = null;
  function buildEdges(key) {
    const groups = new Map();
    const step = Math.max(1, sceneTuning.linkStep | 0);
    const opacity = cfg.linkOpacity * sceneTuning.linkOpacityScale;
    for (let i = 0; i < links.length; i += step) {
      const link = links[i];
      const src = link.source, tgt = link.target;
      if (!finiteNumber(src.__fx) || !finiteNumber(src.__fy)) continue;
      if (!finiteNumber(tgt.__fx) || !finiteNumber(tgt.__fy)) continue;

      const x1 = src.__fx, y1 = src.__fy;
      const x2 = tgt.__fx, y2 = tgt.__fy;
      const color = edgeColor(link);
      const importance = Math.max(src.importance || 0, tgt.importance || 0);
      const lvl = Math.min(IMP_LEVELS - 1, Math.round(importance * (IMP_LEVELS - 1)));
      const gk = color + '|' + lvl;
      let g = groups.get(gk);
      if (!g) {
        const imp = lvl / (IMP_LEVELS - 1);
        const [r, gg, b] = hexToRGB(color);
        g = { style: rgba(r, gg, b, opacity * (0.4 + imp * 0.6) * 0.4), width: 1.8 + imp * 1.2, path: new Path2D() };
        groups.set(gk, g);
      }
      // Organic curved stroke
      const h = hashStr(src.id + '|' + tgt.id);
      const mx = (x1 + x2) * 0.5 + ((h % 200) / 200 - 0.5) * 8;
      const my = (y1 + y2) * 0.5 + (((h * 7) % 200) / 200 - 0.5) * 8;
      g.path.moveTo(x1, y1);
      g.path.quadraticCurveTo(mx, my, x2, y2);
    }
    return { key, cfg, nodes, links, groups: Array.from(groups.values()) };
  }

  // Fill styles per node colour: the 4 bleed layers and the darker core.
  const nodeStyles = new Map();
  function stylesFor(color) {
    let s = nodeStyles.get(color);
    if (s) return s;
    const [r, g, b] = hexToRGB(color);
    s = OFFSETS.map(o => rgba(r, g, b, 0.45 * o[2]));
    s.push(rgba(Math.max(0, r - 30), Math.max(0, g - 30), Math.max(0, b - 30), 0.7));
    if (nodeStyles.size > 512) nodeStyles.clear();
    nodeStyles.set(color, s);
    return s;
  }

  THEMES.wash = {
    kind: 'hooks', name: 'Ink Wash', dark: false, background: PAPER,
    drawBackground: function () {
      ctx.fillStyle = paperColor();
      ctx.fillRect(0, 0, innerWidth, innerHeight);

      // Paper texture overlay
      if (!paperPattern || patternCtx !== ctx) { paperPattern = ctx.createPattern(paperTexture(), 'repeat'); patternCtx = ctx; }
      ctx.save();
      ctx.globalAlpha = 0.06;
      ctx.globalCompositeOperation = 'multiply';
      ctx.fillStyle = paperPattern;
      ctx.fillRect(0, 0, innerWidth, innerHeight);
      ctx.restore();
    },

    drawEdges: function () {
      const style = sceneTuning.edgeStyle || cfg.edgeStyle || 'line';
      if (style === 'none') return;

      const key = fingerprint();
      const c = edgeCache;
      if (!c || c.key !== key || c.cfg !== cfg || c.nodes !== nodes || c.links !== links) edgeCache = buildEdges(key);
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      for (const g of edgeCache.groups) {
        ctx.strokeStyle = g.style;
        ctx.lineWidth = g.width;
        ctx.stroke(g.path);
      }
    },

    drawParticles: function () {
      if (!cfg.ambientParticles || typeof ambientPool === 'undefined' || !ambientPool.length) return;
      const [r, g, b] = hexToRGB(cfg.accent);
      for (let i = 0; i < ambientPool.length; i++) {
        const p = ambientPool[i];
        ctx.fillStyle = rgba(r, g, b, p.alpha * 0.4);
        ctx.beginPath();
        ctx.arc(p.x, p.y, (p.size || 1) * 1.2, 0, Math.PI * 2);
        ctx.fill();
      }
    },

    drawNodes: function () {
      const cap = sceneTuning.maxRenderedNodes || 0;
      const cullActive = __cullFrame === tick;

      // Each node keeps its own fills so overlapping pigment still pools.
      for (let i = 0; i < nodes.length; i++) {
        const node = nodes[i];
        if (cap && node.__renderable === false) continue;
        if (cullActive && node.__vFrame !== tick) continue;
        if (!finiteNumber(node.__fx) || !finiteNumber(node.__fy)) continue;

        const x = node.__fx, y = node.__fy;
        const radius = node.r || 3;
        const st = stylesFor(nodeColor(node));

        for (let j = 0; j < OFFSETS.length; j++) {
          const o = OFFSETS[j];
          const br = radius * (1.2 + (1 - o[2]) * 1.5) * BLEED;
          ctx.fillStyle = st[j];
          ctx.beginPath();
          ctx.arc(x + o[0], y + o[1], br, 0, Math.PI * 2);
          ctx.fill();
        }

        // Darker core
        ctx.fillStyle = st[4];
        ctx.beginPath();
        ctx.arc(x, y, radius * 0.55, 0, Math.PI * 2);
        ctx.fill();
      }
      if (typeof __drawnNodes !== 'undefined') __drawnNodes = nodes.length;
    },

    drawLabels: function () {
      if (!cfg.hubLabels || sceneTuning.labelCount <= 0) return;

      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.font = 'italic 11px Georgia, "Times New Roman", serif';
      ctx.fillStyle = 'rgba(30,30,30,0.75)';

      let drawn = 0;
      for (let i = 0; i < labelCandidates.length && drawn < sceneTuning.labelCount; i++) {
        const node = labelCandidates[i];
        if ((node.importance || 0) < sceneTuning.labelMinImportance) continue;
        if (!finiteNumber(node.__fx) || !finiteNumber(node.__fy)) continue;
        if (node.__renderable === false) continue;
        ctx.fillText(node.__labelText, node.__fx, node.__fy + (node.r || 3) + 14);
        drawn++;
      }
    },

    drawFadeOverlay: null,
    drawStaticLayer: null,
  };
})();
