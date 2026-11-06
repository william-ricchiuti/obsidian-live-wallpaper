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
  // Rotation pivot and radii: the graph's own (undrifted) bounds. Rotating in
  // coordinates normalised to those bounds keeps a wide graph inside its frame
  // instead of swinging its ends off the top and bottom of the screen.
  let pivot = { cx: 0, cy: 0, hw: 1, hh: 1, key: '' };
  const NEBULA_MAX = 8;
  let nebula = null; // { key, canvas }
  const ringStyle = new Map();

  function fingerprint() {
    const n = nodes.length;
    const step = Math.max(1, (n / 61) | 0);
    let h = 0;
    for (let i = 0; i < n; i += step) {
      const p = nodes[i];
      if (finiteNumber(p.__bx) && finiteNumber(p.__by)) h += (p.__bx * 1.618 + p.__by * 2.718) * (1 + (i % 7));
    }
    return `${n}|${innerWidth}x${innerHeight}|${Math.round(h * 4)}`;
  }

  function updatePivot(key) {
    if (pivot.key === key) return;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (let i = 0; i < nodes.length; i++) {
      const p = nodes[i];
      if (p.__renderable === false || !finiteNumber(p.__bx) || !finiteNumber(p.__by)) continue;
      if (p.__bx < x0) x0 = p.__bx;
      if (p.__bx > x1) x1 = p.__bx;
      if (p.__by < y0) y0 = p.__by;
      if (p.__by > y1) y1 = p.__by;
    }
    if (!(x1 > x0)) { x0 = 0; x1 = innerWidth; }
    if (!(y1 > y0)) { y0 = 0; y1 = innerHeight; }
    pivot = { cx: (x0 + x1) / 2, cy: (y0 + y1) / 2, hw: Math.max(1, (x1 - x0) / 2), hh: Math.max(1, (y1 - y0) / 2), key };
  }

  // Rotates (x, y) about the pivot in bounds-normalised space; writes out[0..1].
  function rotate(x, y, cosA, sinA, out) {
    const ux = (x - pivot.cx) / pivot.hw, uy = (y - pivot.cy) / pivot.hh;
    out[0] = pivot.cx + (ux * cosA - uy * sinA) * pivot.hw;
    out[1] = pivot.cy + (ux * sinA + uy * cosA) * pivot.hh;
  }
  const P = [0, 0];

  function buildNebula(key) {
    // Top tags by note count, each washed at its centroid.
    const acc = new Map();
    for (let i = 0; i < nodes.length; i++) {
      const node = nodes[i];
      if (node.__renderable === false || !node.tag) continue;
      if (!finiteNumber(node.__bx) || !finiteNumber(node.__by)) continue;
      let a = acc.get(node.tag);
      if (!a) { a = { n: 0, x: 0, y: 0, color: nodeColor(node) }; acc.set(node.tag, a); }
      a.n++; a.x += node.__bx; a.y += node.__by;
    }
    const top = Array.from(acc.values()).sort((a, b) => b.n - a.n).slice(0, NEBULA_MAX);
    // The washes are extremely soft, so a half-resolution bitmap scaled up
    // looks the same as full-screen gradients and costs one blit per frame.
    const S = 2;
    const w = Math.max(1, Math.ceil(innerWidth / S)), h = Math.max(1, Math.ceil(innerHeight / S));
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const g = c.getContext('2d');
    g.scale(1 / S, 1 / S);
    const k = Math.max(0.5, innerWidth / 1280);
    for (const a of top) {
      const [r, gg, b] = hexToRGB(a.color);
      const nx = a.x / a.n, ny = a.y / a.n;
      const grad = g.createRadialGradient(nx, ny, 20 * k, nx, ny, 600 * k);
      grad.addColorStop(0, rgba(r, gg, b, 0.015));
      grad.addColorStop(1, rgba(0, 0, 0, 0));
      g.fillStyle = grad;
      g.fillRect(0, 0, innerWidth, innerHeight);
    }
    nebula = { key, canvas: c };
  }

  THEMES.celestial = {
    kind: 'hooks', name: 'Celestial', dark: true, background: '#020408',
    drawBackground: function () {
      ctx.fillStyle = '#020408';
      ctx.fillRect(0, 0, innerWidth, innerHeight);

      // Nebula washes: large soft radial gradients at the top tag clusters.
      if (!sceneTuning.backgroundGradientEnabled) return;
      // Colours live on the nodes and change with config or graph reloads (new
      // cfg / array objects); the minute bucket picks up anything else.
      const key = fingerprint() + '|' + Math.floor(Date.now() / 60000);
      if (!nebula || nebula.key !== key || nebula.cfg !== cfg || nebula.nodes !== nodes) {
        buildNebula(key);
        nebula.cfg = cfg; nebula.nodes = nodes;
      }
      ctx.drawImage(nebula.canvas, 0, 0, innerWidth, innerHeight);
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
      updatePivot(fingerprint());
      const cap = sceneTuning.maxRenderedNodes || 0;
      const cosA = Math.cos(rotationAngle), sinA = Math.sin(rotationAngle);
      const W = innerWidth, H = innerHeight, M = 60;
      const ringT = motionTime() * 0.02;

      for (let i = 0; i < nodes.length; i++) {
        const node = nodes[i];
        if (cap && node.__renderable === false) continue;
        if (!finiteNumber(node.__fx) || !finiteNumber(node.__fy)) continue;

        // Cull on the rotated position: the renderer's viewport culling
        // (__vFrame) is computed before rotation and would hide stars that
        // rotate into view and keep ones that rotate out.
        rotate(node.__fx, node.__fy, cosA, sinA, P);
        const rx = P[0], ry = P[1];
        if (rx < -M || ry < -M || rx > W + M || ry > H + M) continue;

        const importance = node.importance || 0;
        const radius = node.r || 3;

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
          const color = nodeColor(node);
          let style = ringStyle.get(color);
          if (!style) {
            const [cr, cg, cb] = hexToRGB(color);
            style = rgba(cr, cg, cb, 0.12);
            if (ringStyle.size > 256) ringStyle.clear();
            ringStyle.set(color, style);
          }
          const ringCount = importance > 0.8 ? 3 : importance > 0.6 ? 2 : 1;
          ctx.strokeStyle = style;
          ctx.lineWidth = 0.5;
          for (let j = 0; j < ringCount; j++) {
            const rr = 10 + j * 7 + Math.sin(ringT + rx * 0.01) * 2;
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
      const cosA = Math.cos(rotationAngle), sinA = Math.sin(rotationAngle);

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

        rotate(node.__fx, node.__fy, cosA, sinA, P);
        const label = node.__labelText;
        ctx.fillText(label, P[0], P[1] + (node.r || 3) + 14);
        drawn++;
      }
    },

    drawFadeOverlay: null,
    drawStaticLayer: null,
  };
})();
