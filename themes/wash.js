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

  let paperTexture = null;
  const BLEED = 0.6; // pigment bleed radius multiplier

  // Rebuilt when the window size changes (it used to stay at the first size).
  function ensurePaperTexture() {
    const w = Math.max(1, innerWidth | 0), h = Math.max(1, innerHeight | 0);
    if (paperTexture && paperTexture.width === w && paperTexture.height === h) return;
    const tex = document.createElement('canvas');
    tex.width = w; tex.height = h;
    const g = tex.getContext('2d');
    const img = g.createImageData(w, h);
    for (let i = 0; i < img.data.length; i += 4) {
      const v = 242 + Math.floor(Math.random() * 12);
      img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
      img.data[i + 3] = 255;
    }
    g.putImageData(img, 0, 0);
    paperTexture = tex;
  }

  THEMES.wash = {
    kind: 'hooks', name: 'Ink Wash', dark: false, background: '#f0efe8',
    drawBackground: function () {
      ctx.fillStyle = cfg.background || '#f0efe8';
      ctx.fillRect(0, 0, innerWidth, innerHeight);

      // Paper texture overlay
      ensurePaperTexture();
      ctx.save();
      ctx.globalAlpha = 0.06;
      ctx.globalCompositeOperation = 'multiply';
      ctx.drawImage(paperTexture, 0, 0);
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = 1;
      ctx.restore();
    },

    drawEdges: function () {
      const style = sceneTuning.edgeStyle || cfg.edgeStyle || 'line';
      if (style === 'none') return;

      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';

      for (let i = 0; i < links.length; i++) {
        const link = links[i];
        const src = link.source, tgt = link.target;
        if (!finiteNumber(src.__fx) || !finiteNumber(src.__fy)) continue;
        if (!finiteNumber(tgt.__fx) || !finiteNumber(tgt.__fy)) continue;

        const x1 = src.__fx, y1 = src.__fy;
        const x2 = tgt.__fx, y2 = tgt.__fy;
        const color = edgeColor(link);
        const [r, g, b] = hexToRGB(color);
        const importance = Math.max(src.importance || 0, tgt.importance || 0);
        const alpha = cfg.linkOpacity * sceneTuning.linkOpacityScale * (0.4 + importance * 0.6);

        // Organic curved stroke
        const h = hashStr(src.id + '|' + tgt.id);
        const mx = (x1 + x2) * 0.5 + ((h % 200) / 200 - 0.5) * 8;
        const my = (y1 + y2) * 0.5 + (((h * 7) % 200) / 200 - 0.5) * 8;

        ctx.strokeStyle = rgba(r, g, b, alpha * 0.4);
        ctx.lineWidth = 1.8 + importance * 1.2;
        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.quadraticCurveTo(mx, my, x2, y2);
        ctx.stroke();
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

      for (let i = 0; i < nodes.length; i++) {
        const node = nodes[i];
        if (cap && node.__renderable === false) continue;
        if (cullActive && node.__vFrame !== tick) continue;
        if (!finiteNumber(node.__fx) || !finiteNumber(node.__fy)) continue;

        const x = node.__fx, y = node.__fy;
        const radius = node.r || 3;
        const color = nodeColor(node);
        const [r, g, b] = hexToRGB(color);

        // Pigment bleed: 4 overlapping offset circles
        const bleedIntensity = BLEED;
        const offsets = [[0, 0, 1], [1.2, -0.7, 0.5], [-1.0, 0.8, 0.35], [0.4, 1.0, 0.2]];
        for (let j = 0; j < offsets.length; j++) {
          const [ox, oy, am] = offsets[j];
          const br = radius * (1.2 + (1 - am) * 1.5) * bleedIntensity;
          ctx.fillStyle = rgba(r, g, b, 0.45 * am);
          ctx.beginPath();
          ctx.arc(x + ox, y + oy, br, 0, Math.PI * 2);
          ctx.fill();
        }

        // Darker core
        ctx.fillStyle = rgba(Math.max(0, r - 30), Math.max(0, g - 30), Math.max(0, b - 30), 0.7);
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
