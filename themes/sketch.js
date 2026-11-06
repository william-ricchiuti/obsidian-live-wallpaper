// @name Sketchbook
// @description Pencil on ruled paper: wobbly hand-drawn links and circled notes.
// @light
// themes/sketch.js — Hand-drawn sketchbook theme.
// Loaded as plain <script> after registry.js; THEMES is a global.
// Uses globals: cfg, nodes, links, ctx, canvas, sceneTuning, tick, innerWidth, innerHeight,
//   simAlpha, nodeColor(), edgeColor(), hexToRGB(), rgba(), finiteNumber(), hashStr(),
//   labelCandidates, ambientPool (if ambient particles are on).

(function () {
  'use strict';

  const JITTER = 2;        // pencil wobble, px
  const STROKE_COUNT = 4;  // pencil passes around each note
  const IMP_LEVELS = 8;    // link importance buckets (alpha) for batching

  // Seeded PRNG for deterministic per-node/per-link jitter
  function seededRandom(seed) {
    let s = (seed | 0);
    return function () {
      s = (s * 1664525 + 1013904223) | 0;
      return (s >>> 0) / 4294967296;
    };
  }

  // Layout fingerprint over the renderer's node positions (themes run with
  // no drift, so these only change when the layout or framing does).
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
  function fresh(c, key) {
    return c && c.key === key && c.cfg === cfg && c.nodes === nodes && c.links === links;
  }
  function stamp(v, key) { v.key = key; v.cfg = cfg; v.nodes = nodes; v.links = links; return v; }

  // Edges: one Path2D per (importance bucket, pencil pass). Passes of the
  // same link stay in separate strokes so they still darken where they cross.
  let edgeCache = null;
  function buildEdges(key) {
    const groups = [];
    const step = Math.max(1, sceneTuning.linkStep | 0);
    for (let i = 0; i < links.length; i += step) {
      const link = links[i];
      const src = link.source, tgt = link.target;
      if (!finiteNumber(src.__fx) || !finiteNumber(src.__fy)) continue;
      if (!finiteNumber(tgt.__fx) || !finiteNumber(tgt.__fy)) continue;

      const x1 = src.__fx, y1 = src.__fy;
      const x2 = tgt.__fx, y2 = tgt.__fy;
      const imp = Math.max(src.importance || 0, tgt.importance || 0);
      const lvl = Math.min(IMP_LEVELS - 1, Math.round(imp * (IMP_LEVELS - 1)));
      const strokes = imp > 0.5 ? 3 : 2;
      const rand = seededRandom(hashStr(src.id + '_' + tgt.id));
      const dx = x2 - x1, dy = y2 - y1;
      const len = Math.sqrt(dx * dx + dy * dy) || 1;
      const wobble = (imp > 0.3 ? 3 : 1.5) * JITTER;

      for (let s = 0; s < strokes; s++) {
        const mx = (x1 + x2) * 0.5 + (rand() - 0.5) * wobble;
        const my = (y1 + y2) * 0.5 + (rand() - 0.5) * wobble;
        // Endpoint overshoot
        const overshoot = 3 + rand() * 5;
        const gi = lvl * 3 + s;
        const p = groups[gi] || (groups[gi] = new Path2D());
        p.moveTo(x1 - (dx / len) * overshoot, y1 - (dy / len) * overshoot);
        p.quadraticCurveTo(mx, my, x2 + (dx / len) * overshoot, y2 + (dy / len) * overshoot);
      }
    }
    return stamp({ groups }, key);
  }

  // Nodes: pencil circles as one Path2D per colour; smudges per node (they
  // must keep accumulating where notes overlap).
  let nodeCache = null;
  function buildNodes(key, strokes) {
    const byColor = new Map();
    const smudges = [];
    const cap = sceneTuning.maxRenderedNodes || 0;
    for (let i = 0; i < nodes.length; i++) {
      const node = nodes[i];
      if (cap && node.__renderable === false) continue;
      if (!finiteNumber(node.__fx) || !finiteNumber(node.__fy)) continue;

      const x = node.__fx, y = node.__fy;
      const radius = node.r || 3;
      const importance = node.importance || 0;
      const color = nodeColor(node);
      // Line width varies with importance: bucket it into the group key.
      const wl = Math.round(importance * 8);
      const gk = color + '|' + wl;
      let g = byColor.get(gk);
      if (!g) {
        const [r, gg, b] = hexToRGB(color);
        g = { style: rgba(r, gg, b, 0.75), width: 0.6 + (wl / 8) * 0.45, paths: [] };
        byColor.set(gk, g);
      }
      const rand = seededRandom(hashStr(node.id));
      for (let s = 0; s < strokes; s++) {
        const sx = x + (rand() - 0.5) * JITTER;
        const sy = y + (rand() - 0.5) * JITTER;
        const sr = radius * (0.88 + rand() * 0.24);
        const sa = rand() * Math.PI * 2;
        const ea = sa + Math.PI * 2 * (0.8 + rand() * 0.2);
        // One path per pass, so a note's passes still darken where they cross.
        const p = g.paths[s] || (g.paths[s] = new Path2D());
        p.moveTo(sx + Math.cos(sa) * sr, sy + Math.sin(sa) * sr);
        p.arc(sx, sy, sr, sa, ea);
      }
      // Graphite smudge for important nodes
      if (importance > 0.3) smudges.push(x, y, radius * 2.5, rgba(35, 35, 38, Math.round(0.07 * importance * 1000) / 1000));
    }
    return stamp({ groups: Array.from(byColor.values()), smudges, strokes }, key);
  }

  THEMES.sketch = {
    kind: 'hooks', name: 'Sketchbook', dark: false, background: '#f5f0e8',
    drawBackground: function () {
      // Cream paper
      ctx.fillStyle = '#f5f0e8';
      ctx.fillRect(0, 0, innerWidth, innerHeight);

      // Ruled lines
      ctx.strokeStyle = 'rgba(180,175,165,0.28)';
      ctx.lineWidth = 0.5;
      ctx.beginPath();
      for (let y = 28; y < innerHeight; y += 28) {
        ctx.moveTo(0, y);
        ctx.lineTo(innerWidth, y);
      }
      ctx.stroke();

      // Red margin
      ctx.strokeStyle = 'rgba(195,115,115,0.14)';
      ctx.beginPath();
      ctx.moveTo(80, 0);
      ctx.lineTo(80, innerHeight);
      ctx.stroke();
    },

    drawEdges: function () {
      const style = sceneTuning.edgeStyle || cfg.edgeStyle || 'line';
      if (style === 'none') return;

      const key = fingerprint();
      if (!fresh(edgeCache, key)) edgeCache = buildEdges(key);
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.lineWidth = 0.35;
      const base = (cfg.linkOpacity || 0.18) * 0.45;
      for (let gi = 0; gi < edgeCache.groups.length; gi++) {
        const p = edgeCache.groups[gi];
        if (!p) continue;
        const imp = Math.floor(gi / 3) / (IMP_LEVELS - 1);
        ctx.strokeStyle = rgba(35, 35, 40, Math.round(base * (0.4 + imp * 0.6) * 1000) / 1000);
        ctx.stroke(p);
      }
    },

    drawParticles: function () {
      // Eraser crumbs
      if (!cfg.ambientParticles || typeof ambientPool === 'undefined' || !ambientPool.length) return;
      for (let i = 0; i < ambientPool.length; i++) {
        const p = ambientPool[i];
        ctx.fillStyle = rgba(240, 238, 233, p.alpha * 0.6);
        ctx.beginPath();
        ctx.arc(p.x, p.y, (p.size || 1) * 0.5, 0, Math.PI * 2);
        ctx.fill();
      }
    },

    drawNodes: function () {
      // Sim active? Use fewer strokes
      const strokes = simAlpha > 0.05 ? Math.max(1, Math.floor(STROKE_COUNT * 0.5)) : STROKE_COUNT;
      const key = fingerprint() + '|' + strokes;
      if (!fresh(nodeCache, key)) nodeCache = buildNodes(key, strokes);
      for (const g of nodeCache.groups) {
        ctx.strokeStyle = g.style;
        ctx.lineWidth = g.width;
        for (const p of g.paths) ctx.stroke(p);
      }
      const sm = nodeCache.smudges;
      for (let i = 0; i < sm.length; i += 4) {
        ctx.fillStyle = sm[i + 3];
        ctx.beginPath();
        ctx.arc(sm[i], sm[i + 1], sm[i + 2], 0, Math.PI * 2);
        ctx.fill();
      }
      if (typeof __drawnNodes !== 'undefined') __drawnNodes = nodes.length;
    },

    drawLabels: function () {
      if (!cfg.hubLabels || sceneTuning.labelCount <= 0) return;

      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = 'rgba(35,35,38,0.75)';
      ctx.font = 'italic 11px Georgia, "Times New Roman", serif';

      let drawn = 0;
      for (let i = 0; i < labelCandidates.length && drawn < sceneTuning.labelCount; i++) {
        const node = labelCandidates[i];
        if ((node.importance || 0) < sceneTuning.labelMinImportance) continue;
        if (!finiteNumber(node.__fx) || !finiteNumber(node.__fy)) continue;
        if (node.__renderable === false) continue;

        const rand = seededRandom(hashStr(node.id));
        const rotDeg = (rand() - 0.5) * 3; // -1.5° to +1.5°
        const lx = node.__fx;
        const ly = node.__fy + (node.r || 3) + 14;

        ctx.save();
        ctx.translate(lx, ly);
        ctx.rotate(rotDeg * Math.PI / 180);
        ctx.fillText(node.__labelText, 0, 0);
        ctx.restore();
        drawn++;
      }
    },

    drawFadeOverlay: null,
    drawStaticLayer: null,
  };
})();
