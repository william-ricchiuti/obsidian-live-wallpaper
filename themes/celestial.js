// @name Celestial
// @description A star chart: notes become stars with diffraction spikes and orbital rings, slowly rotating around the pole.
// themes/celestial.js — Star chart / celestial navigation theme.
// Loaded as plain <script> after registry.js; THEMES is a global.
// Uses globals: cfg, nodes, links, ctx, canvas, sceneTuning, tick, innerWidth, innerHeight,
//   simAlpha, __drawnNodes, nodeColor(), edgeColor(), hexToRGB(), rgba(), finiteNumber(),
//   labelCandidates, ambientPool (if ambient particles are on).

(function () {
  'use strict';

  let rotationAngle = 0;

  THEMES.celestial = {
    kind: 'hooks', name: 'Celestial', dark: true, background: '#020408',
    drawBackground: function () {
      ctx.fillStyle = '#020408';
      ctx.fillRect(0, 0, innerWidth, innerHeight);

      // Nebula washes: large soft radial gradients at tag cluster centers.
      // Use cluster centroids (approx by important nodes) for nebula placement.
      if (!sceneTuning.backgroundGradientEnabled) return;
      const drawn = {};
      for (let i = 0; i < nodes.length; i++) {
        const node = nodes[i];
        if (node.__renderable === false) continue;
        if (!node.tag || drawn[node.tag]) continue;
        drawn[node.tag] = true;
        const [r, g, b] = hexToRGB(nodeColor(node));
        const nx = finiteNumber(node.__fx) ? node.__fx : 0;
        const ny = finiteNumber(node.__fy) ? node.__fy : 0;
        const grad = ctx.createRadialGradient(nx, ny, 20, nx, ny, 600);
        grad.addColorStop(0, rgba(r, g, b, 0.015));
        grad.addColorStop(1, rgba(0, 0, 0, 0));
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, innerWidth, innerHeight);
      }
    },

    drawEdges: function () { /* No edges in celestial theme */ },

    drawParticles: function () {
      if (!cfg.ambientParticles || typeof ambientPool === 'undefined' || !ambientPool.length) return;
      for (let i = 0; i < ambientPool.length; i++) {
        const p = ambientPool[i];
        ctx.fillStyle = rgba(255, 255, 255, Math.min(1, p.alpha * 1.5));
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size * 0.6, 0, Math.PI * 2);
        ctx.fill();
      }
    },

    drawNodes: function () {
      rotationAngle = (motionTime() * 0.0001 * sceneTuning.motion.driftAmp) % (Math.PI * 2);
      const cx = innerWidth / 2, cy = innerHeight / 2;
      const cap = sceneTuning.maxRenderedNodes || 0;
      const cullActive = __cullFrame === tick;

      for (let i = 0; i < nodes.length; i++) {
        const node = nodes[i];
        if (cap && node.__renderable === false) continue;
        if (cullActive && node.__vFrame !== tick) continue;
        if (!finiteNumber(node.__fx) || !finiteNumber(node.__fy)) continue;

        const importance = node.importance || 0;
        const color = nodeColor(node);
        const radius = node.r || 3;

        // Rotate around center
        const dx = node.__fx - cx;
        const dy = node.__fy - cy;
        const cosA = Math.cos(rotationAngle), sinA = Math.sin(rotationAngle);
        const rx = cx + dx * cosA - dy * sinA;
        const ry = cy + dx * sinA + dy * cosA;

        // Core bright star
        ctx.fillStyle = '#ffffff';
        ctx.beginPath();
        ctx.arc(rx, ry, Math.max(0.8, radius * 0.35), 0, Math.PI * 2);
        ctx.fill();

        // Glow
        ctx.fillStyle = rgba(255, 255, 255, 0.25 + importance * 0.15);
        ctx.beginPath();
        ctx.arc(rx, ry, radius * 1.6, 0, Math.PI * 2);
        ctx.fill();

        // Diffraction spikes on important nodes
        if (importance > 0.5 && !node.ghost) {
          const spikeLen = radius * (6 + importance * 4);
          const alpha = (importance - 0.5) * 2 * 0.55;
          ctx.strokeStyle = rgba(255, 255, 255, alpha);
          ctx.lineWidth = 0.5;
          ctx.beginPath();
          ctx.moveTo(rx - spikeLen, ry); ctx.lineTo(rx + spikeLen, ry);
          ctx.moveTo(rx, ry - spikeLen); ctx.lineTo(rx, ry + spikeLen);
          const d = spikeLen * 0.55;
          ctx.moveTo(rx - d, ry - d); ctx.lineTo(rx + d, ry + d);
          ctx.moveTo(rx + d, ry - d); ctx.lineTo(rx - d, ry + d);
          ctx.stroke();
        }

        // Orbital rings
        if (importance > 0.4 && !node.ghost) {
          const [cr, cg, cb] = hexToRGB(color);
          const ringCount = importance > 0.8 ? 3 : importance > 0.6 ? 2 : 1;
          for (let j = 0; j < ringCount; j++) {
            const rr = 10 + j * 7 + Math.sin(motionTime() * 0.02 + rx * 0.01) * 2;
            ctx.strokeStyle = rgba(cr, cg, cb, 0.12);
            ctx.lineWidth = 0.5;
            ctx.beginPath();
            ctx.arc(rx, ry, rr, 0, Math.PI * 2);
            ctx.stroke();
          }
        }
      }
      if (typeof __drawnNodes !== 'undefined') __drawnNodes = nodes.length;
    },

    drawLabels: function () {
      if (!cfg.hubLabels || sceneTuning.labelCount <= 0) return;
      const cx = innerWidth / 2, cy = innerHeight / 2;

      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = 'rgba(255,255,255,0.65)';
      ctx.font = `italic ${Math.round(11)}px Georgia, "Times New Roman", serif`;

      let drawn = 0;
      for (let i = 0; i < labelCandidates.length && drawn < sceneTuning.labelCount; i++) {
        const node = labelCandidates[i];
        if ((node.importance || 0) < sceneTuning.labelMinImportance) continue;
        if (!finiteNumber(node.__fx) || !finiteNumber(node.__fy)) continue;
        if (node.__renderable === false) continue;

        const cosA = Math.cos(rotationAngle), sinA = Math.sin(rotationAngle);
        const dx = node.__fx - cx, dy = node.__fy - cy;
        const rx = cx + dx * cosA - dy * sinA;
        const ry = cy + dx * sinA + dy * cosA;

        const label = node.__labelText;
        ctx.fillText(label, rx, ry + (node.r || 3) + 14);
        drawn++;
      }
    },

    drawFadeOverlay: null,
    drawStaticLayer: null,
  };
})();
