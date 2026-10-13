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

  // Seeded PRNG for deterministic per-node/per-link jitter
  function seededRandom(seed) {
    let s = (seed | 0);
    return function () {
      s = (s * 1664525 + 1013904223) | 0;
      return (s >>> 0) / 4294967296;
    };
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
      for (let y = 28; y < innerHeight; y += 28) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(innerWidth, y);
        ctx.stroke();
      }

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

      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      const jitter = (cfg.sketchJitter !== undefined ? cfg.sketchJitter : 2);

      for (let i = 0; i < links.length; i++) {
        const link = links[i];
        const src = link.source, tgt = link.target;
        if (!finiteNumber(src.__fx) || !finiteNumber(src.__fy)) continue;
        if (!finiteNumber(tgt.__fx) || !finiteNumber(tgt.__fy)) continue;

        const x1 = src.__fx, y1 = src.__fy;
        const x2 = tgt.__fx, y2 = tgt.__fy;
        const imp = Math.max(src.importance || 0, tgt.importance || 0);
        const alpha = (cfg.linkOpacity || 0.18) * (0.4 + imp * 0.6);

        const strokes = imp > 0.5 ? 3 : 2;
        ctx.strokeStyle = rgba(35, 35, 40, alpha * 0.45);
        ctx.lineWidth = 0.35;

        const rand = seededRandom(hashStr(src.id + '_' + tgt.id));

        for (let s = 0; s < strokes; s++) {
          const wobble = (imp > 0.3 ? 3 : 1.5) * jitter;
          const mx = (x1 + x2) * 0.5 + (rand() - 0.5) * wobble;
          const my = (y1 + y2) * 0.5 + (rand() - 0.5) * wobble;

          // Endpoint overshoot
          const dx = x2 - x1, dy = y2 - y1;
          const len = Math.sqrt(dx * dx + dy * dy) || 1;
          const overshoot = 3 + rand() * 5;
          const sx = x1 - (dx / len) * overshoot;
          const sy = y1 - (dy / len) * overshoot;
          const ex = x2 + (dx / len) * overshoot;
          const ey = y2 + (dy / len) * overshoot;

          ctx.beginPath();
          ctx.moveTo(sx, sy);
          ctx.quadraticCurveTo(mx, my, ex, ey);
          ctx.stroke();
        }
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
      const cap = sceneTuning.maxRenderedNodes || 0;
      const cullActive = __cullFrame === tick;
      const jitter = (cfg.sketchJitter !== undefined ? cfg.sketchJitter : 2);
      const strokeCount = (cfg.sketchStrokeCount !== undefined ? cfg.sketchStrokeCount : 4);

      for (let i = 0; i < nodes.length; i++) {
        const node = nodes[i];
        if (cap && node.__renderable === false) continue;
        if (cullActive && node.__vFrame !== tick) continue;
        if (!finiteNumber(node.__fx) || !finiteNumber(node.__fy)) continue;

        const x = node.__fx, y = node.__fy;
        const radius = node.r || 3;
        const color = nodeColor(node);
        const importance = node.importance || 0;
        const [r, g, b] = hexToRGB(color);
        const rand = seededRandom(hashStr(node.id));

        // Sim active? Use fewer strokes
        const strokes = simAlpha > 0.05 ? Math.max(1, Math.floor(strokeCount * 0.5)) : strokeCount;
        ctx.strokeStyle = rgba(r, g, b, 0.75);
        ctx.lineWidth = 0.6 + importance * 0.45;

        for (let s = 0; s < strokes; s++) {
          const sx = x + (rand() - 0.5) * jitter;
          const sy = y + (rand() - 0.5) * jitter;
          const sr = radius * (0.88 + rand() * 0.24);
          const sa = rand() * Math.PI * 2;
          const ea = sa + Math.PI * 2 * (0.8 + rand() * 0.2);

          ctx.beginPath();
          ctx.arc(sx, sy, sr, sa, ea);
          ctx.stroke();
        }

        // Graphite smudge for important nodes
        if (importance > 0.3) {
          ctx.fillStyle = rgba(35, 35, 38, 0.07 * importance);
          ctx.beginPath();
          ctx.arc(x, y, radius * 2.5, 0, Math.PI * 2);
          ctx.fill();
        }
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
