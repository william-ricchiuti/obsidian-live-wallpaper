// Pure, dependency-free helpers shared by the renderer (index.html) and Node
// tests. In the browser this file is loaded as a plain <script> and attaches the
// functions as globals; in Node it is required as a CommonJS module. Keeping
// these here lets scripts/smoke.js unit-test them without a browser.
(function (root) {
  'use strict';

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function truncateLabel(text, maxLength) {
    return text.length > maxLength ? text.slice(0, maxLength - 1) + '…' : text;
  }

  function mixChannel(a, b, amount) {
    return Math.round(a * (1 - amount) + b * amount);
  }

  function hashStr(s) {
    let h = 0;
    if (!s) return 0;
    for (let i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0;
    return h;
  }

  function hslToHex(h, s, l) {
    s /= 100; l /= 100;
    const k = n => (n + h / 30) % 12;
    const a = s * Math.min(l, 1 - l);
    const f = n => {
      const c = l - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1));
      return Math.round(255 * c).toString(16).padStart(2, '0');
    };
    return `#${f(0)}${f(8)}${f(4)}`;
  }

  function graphHashFast(graph) {
    const ns = graph.nodes;
    const ls = graph.links;
    const nLen = ns.length;
    const lLen = ls.length;
    let h = (nLen ^ (lLen * 2654435761)) | 0;
    // Fold every node (not just a first/last-16 sample) so a change anywhere in
    // a large graph — e.g. renaming a link-less node in the middle — actually
    // changes the hash. Still O(n) with cheap per-node work, unlike
    // graphHashSlow's sort+join. Tag is folded in too since it affects
    // coloring/clustering and graphHashSlow already treats it as significant.
    for (let i = 0; i < nLen; i++) {
      const node = ns[i];
      h = (h + Math.imul(hashStr(node.id) ^ (i + 1), 2246822519)) | 0;
      if (node.tag) h ^= hashStr(node.tag);
    }
    let linkSum = 0;
    for (let i = 0; i < lLen; i++) {
      const link = ls[i];
      const s = typeof link.source === 'string' ? link.source : (link.source && link.source.id) || '';
      const t = typeof link.target === 'string' ? link.target : (link.target && link.target.id) || '';
      linkSum = (linkSum + hashStr(s) + Math.imul(hashStr(t), 31)) | 0;
    }
    return nLen + ':' + lLen + ':' + ((h ^ linkSum) >>> 0);
  }

  function graphHashSlow(graph) {
    const nodePart = graph.nodes
      .map(node => `${node.id}|${node.tag || ''}`)
      .sort()
      .join('\n');
    const linkPart = graph.links
      .map(link => {
        const source = typeof link.source === 'string' ? link.source : link.source && link.source.id;
        const target = typeof link.target === 'string' ? link.target : link.target && link.target.id;
        return `${source || ''}->${target || ''}`;
      })
      .sort()
      .join('\n');
    return `${nodePart}\n---\n${linkPart}`;
  }

  // Named palettes for `palette`. 'auto' means "the theme's own colours"
  // (or tagColors + accent for the default theme) and has no entry here.
  const PALETTES = {
    aurora: ['#5ef2c8', '#7aa8ff', '#c77dff', '#ff7ab6', '#ffd479', '#6ee7ff', '#a3ff8f', '#ff9f6e'],
    riso: ['#ff48b0', '#0078bf', '#ffe800', '#00a95c', '#ff6c2f', '#765ba7', '#ff665e', '#00838a'],
    metro: ['#e3242b', '#0072ce', '#00a651', '#f6a800', '#f68b1f', '#8e3fbf', '#00b3c8', '#a05a2c'],
    pastel: ['#f2c6a0', '#cfe0b0', '#b9d3ea', '#ebc3d9', '#f3e3a4', '#cdc1e8', '#a9ddd6', '#e8bcae'],
    earth: ['#c8a165', '#8a9a5b', '#b5651d', '#6b8e8e', '#a0522d', '#d2b48c', '#556b2f', '#9c6644'],
    neon: ['#7df9ff', '#ff5ce1', '#b18cff', '#ffd36b', '#6bffb5', '#ff8a6b', '#6bb5ff', '#ff6b9d'],
    viridis: ['#440154', '#46327e', '#365c8d', '#277f8e', '#1fa187', '#4ac16d', '#a0da39', '#fde725'],
    mono: ['#f2f2f2', '#d0d0d0', '#b0b0b0', '#909090', '#e4e4e4', '#c0c0c0', '#a0a0a0', '#808080']
  };

  function hexToRgb(hex) {
    const n = parseInt(String(hex).slice(1), 16);
    return [n >> 16 & 255, n >> 8 & 255, n & 255];
  }

  function rgbToHex(r, g, b) {
    const h = v => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0');
    return '#' + h(r) + h(g) + h(b);
  }

  function mixHex(a, b, t) {
    const x = hexToRgb(a), y = hexToRgb(b);
    return rgbToHex(x[0] + (y[0] - x[0]) * t, x[1] + (y[1] - x[1]) * t, x[2] + (y[2] - x[2]) * t);
  }

  // WCAG relative luminance and contrast ratio.
  function luminance(hex) {
    const c = hexToRgb(hex).map(v => {
      const s = v / 255;
      return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  }

  function contrastRatio(a, b) {
    const la = luminance(a), lb = luminance(b);
    return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
  }

  // Contrast floor: if `fg` is too close to `bg`, push it toward white (dark
  // backgrounds) or black (light ones) until the ratio reaches `min`. Keeps
  // presets like a near-black accent on a near-black background visible.
  function ensureContrast(fg, bg, min) {
    if (contrastRatio(fg, bg) >= min) return fg;
    const target = luminance(bg) < 0.4 ? '#ffffff' : '#000000';
    for (let t = 0.05; t <= 1.0001; t += 0.05) {
      const c = mixHex(fg, target, t);
      if (contrastRatio(c, bg) >= min) return c;
    }
    return target;
  }

  // Colour wash for timeOfDay 'tint', by local hour (0-24). null = no tint.
  function timeOfDayTint(hour) {
    if (hour < 5 || hour >= 21) return { color: '#0a1240', alpha: 0.42, op: 'multiply', phase: 'night' };
    if (hour < 7.5) return { color: '#ff8a5c', alpha: 0.28, op: 'soft-light', phase: 'dawn' };
    if (hour < 16.5) return null;
    if (hour < 18.5) return { color: '#ffb347', alpha: 0.26, op: 'soft-light', phase: 'golden' };
    return { color: '#7a3fa0', alpha: 0.32, op: 'soft-light', phase: 'dusk' };
  }

  function isDaytime(hour) { return hour >= 7 && hour < 19; }

  // Shared slow flow field: neighbouring points get similar offsets, so the
  // graph sways together like wind instead of shimmering per node.
  // t is in seconds. Returns offsets in [-1.6, 1.6] (multiply by amplitude).
  function flowOffset(x, y, t, out) {
    const fx = Math.sin(y * 0.004 + t * 0.23) + Math.sin(x * 0.003 - t * 0.17) * 0.6;
    const fy = Math.cos(x * 0.004 + t * 0.19) + Math.cos(y * 0.0035 + t * 0.13) * 0.6;
    if (out) { out[0] = fx; out[1] = fy; return out; }
    return [fx, fy];
  }

  function dayKey(date) {
    const d = date || new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }

  // Structural equality for config values (objects, arrays, numbers within eps).
  function configValueEqual(a, b) {
    if (typeof a === 'number' && typeof b === 'number') return Math.abs(a - b) < 0.001;
    if (Array.isArray(a) || Array.isArray(b)) {
      return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((v, i) => configValueEqual(v, b[i]));
    }
    if (a && b && typeof a === 'object' && typeof b === 'object') {
      const ka = Object.keys(a), kb = Object.keys(b);
      return ka.length === kb.length && ka.every(k => configValueEqual(a[k], b[k]));
    }
    return a === b;
  }

  const api = {
    clamp, truncateLabel, mixChannel, hashStr, hslToHex, graphHashFast, graphHashSlow,
    PALETTES, hexToRgb, rgbToHex, mixHex, luminance, contrastRatio, ensureContrast,
    timeOfDayTint, isDaytime, flowOffset, dayKey, configValueEqual
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else Object.assign(root, api);
})(typeof self !== 'undefined' ? self : this);
