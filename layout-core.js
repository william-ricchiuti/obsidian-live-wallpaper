// Layout code shared by worker.js (live simulation) and index.html (synchronous
// settling for oneshot/synthetic captures, so screenshots show a real layout).
// Loaded with importScripts() in the worker and a plain <script> in the page;
// attaches `LayoutCore` to the global. Node can require it for tests.
(function (root) {
  'use strict';

  const MASSIVE_NODE_THRESHOLD = 3000;
  const LARGE_NODE_THRESHOLD = 600;
  const MEDIUM_NODE_THRESHOLD = 200;
  const SMALL_NODE_THRESHOLD = 50;
  const LAYOUTS = ['force', 'rings', 'timeline', 'galaxy'];

  function hash01(s) {
    let h = 2166136261;
    for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
    return ((h >>> 0) % 100000) / 100000;
  }

  function degrees(nodes, links) {
    const index = new Map();
    for (let i = 0; i < nodes.length; i++) index.set(nodes[i].id, i);
    const deg = new Int32Array(nodes.length);
    for (const l of links) {
      const s = index.get(typeof l.source === 'object' ? l.source.id : l.source);
      const t = index.get(typeof l.target === 'object' ? l.target.id : l.target);
      if (s !== undefined) deg[s]++;
      if (t !== undefined) deg[t]++;
    }
    return deg;
  }

  // Tags ranked by note count, most common first. Notes without a tag share
  // the "" bucket, ranked last.
  function tagRanks(nodes) {
    const counts = new Map();
    for (const n of nodes) {
      if (n.ghost) continue;
      const t = n.tag || '';
      counts.set(t, (counts.get(t) || 0) + 1);
    }
    const ordered = Array.from(counts.entries())
      .sort((a, b) => (a[0] === '' ? 1 : b[0] === '' ? -1 : b[1] - a[1] || (a[0] < b[0] ? -1 : 1)));
    const rank = new Map();
    ordered.forEach(([t], i) => rank.set(t, i));
    return { rank, ordered };
  }

  // Target positions for the non-force layouts, in pixels around (cx, cy).
  // Returns null for 'force'.
  function computeTargets(layout, nodes, links, opts) {
    if (!layout || layout === 'force') return null;
    const cx = opts.centerX || 0;
    const cy = opts.centerY || 0;
    const R = Math.max(80, Math.min(opts.width || 1200, opts.height || 800) * 0.42);
    const deg = degrees(nodes, links);
    const { rank, ordered } = tagRanks(nodes);
    const out = new Float32Array(nodes.length * 2);
    const set = (i, x, y) => { out[i * 2] = x; out[i * 2 + 1] = y; };

    if (layout === 'timeline') {
      const now = opts.now || Date.now();
      const lanes = Math.max(1, Math.min(ordered.length, 12));
      const W = R * 2.4;
      const maxDays = 3 * 365;
      for (let i = 0; i < nodes.length; i++) {
        const n = nodes[i];
        const h = hash01(n.id);
        if (n.ghost) { set(i, cx + (h * 2 - 1) * W * 0.5, cy + R * 0.98); continue; }
        const days = n.mtime ? Math.max(0, (now - n.mtime) / 86400000) : maxDays;
        const u = 1 - Math.min(1, Math.log1p(days) / Math.log1p(maxDays)); // 1 = today (right)
        const lane = Math.min(lanes - 1, rank.get(n.tag || '') || 0);
        const ly = lanes === 1 ? 0 : (lane / (lanes - 1)) * 2 - 1;
        set(i, cx - W * 0.5 + u * W, cy + ly * R * 0.82 + (h - 0.5) * R * 0.1);
      }
      return out;
    }

    // Group nodes per tag, highest degree first.
    const groups = new Map();
    for (let i = 0; i < nodes.length; i++) {
      if (nodes[i].ghost) continue;
      const t = nodes[i].tag || '';
      if (!groups.has(t)) groups.set(t, []);
      groups.get(t).push(i);
    }
    for (const list of groups.values()) list.sort((a, b) => deg[b] - deg[a]);
    const total = Array.from(groups.values()).reduce((a, l) => a + l.length, 0) || 1;

    if (layout === 'rings') {
      let acc = -Math.PI / 2;
      for (const [t] of ordered) {
        const list = groups.get(t);
        if (!list) continue;
        const span = (list.length / total) * Math.PI * 2;
        const pad = span * 0.06;
        list.forEach((idx, r) => {
          const h = hash01(nodes[idx].id);
          const u = r / list.length;
          const rad = r === 0 ? 0.2 : 0.32 + 0.68 * Math.sqrt(u) + (hash01(nodes[idx].id + '#') - 0.5) * 0.05;
          const a = r === 0 ? acc + span / 2 : acc + pad + (span - 2 * pad) * h;
          set(idx, cx + Math.cos(a) * rad * R, cy + Math.sin(a) * rad * R);
        });
        acc += span;
      }
    } else if (layout === 'galaxy') {
      const arms = Math.max(2, Math.min(8, ordered.length));
      for (const [t] of ordered) {
        const list = groups.get(t);
        if (!list) continue;
        const arm = (rank.get(t) || 0) % arms;
        list.forEach((idx, r) => {
          const u = (r + 1) / (list.length + 1);
          const rad = r === 0 ? 0.07 : 0.12 + 0.9 * Math.pow(u, 0.75);
          const th = (arm / arms) * Math.PI * 2 + rad * 2.7 + (hash01(nodes[idx].id) - 0.5) * 0.42 * (1.1 - rad);
          set(idx, cx + Math.cos(th) * rad * R, cy + Math.sin(th) * rad * R * 0.78);
        });
      }
    }
    for (let i = 0; i < nodes.length; i++) {
      if (!nodes[i].ghost) continue;
      const a = hash01(nodes[i].id) * Math.PI * 2;
      const rr = 1.02 + hash01(nodes[i].id + '~') * 0.12;
      set(i, cx + Math.cos(a) * rr * R, cy + Math.sin(a) * rr * R * (layout === 'galaxy' ? 0.78 : 1));
    }
    return out;
  }

  // Pulls same-tag nodes toward their tag centroid. Runs as a d3 force so it
  // acts inside the same tick as the other forces. Accumulators are reused
  // across ticks instead of allocating two dictionaries per tick.
  function forceCluster(strengthBase) {
    let nodes = [];
    let keys = null;
    let sx = null, sy = null, cnt = null;
    function force(alpha) {
      if (!keys) return;
      sx.fill(0); sy.fill(0); cnt.fill(0);
      for (let i = 0; i < nodes.length; i++) {
        const k = keys[i];
        if (k < 0) continue;
        const n = nodes[i];
        sx[k] += n.x; sy[k] += n.y; cnt[k]++;
      }
      const s = strengthBase * alpha;
      for (let i = 0; i < nodes.length; i++) {
        const k = keys[i];
        if (k < 0 || cnt[k] < 2) continue;
        const n = nodes[i];
        n.vx += (sx[k] / cnt[k] - n.x) * s;
        n.vy += (sy[k] / cnt[k] - n.y) * s;
      }
    }
    force.initialize = function (ns) {
      nodes = ns;
      const ids = new Map();
      keys = new Int32Array(ns.length);
      for (let i = 0; i < ns.length; i++) {
        const t = ns[i].tag;
        if (!t) { keys[i] = -1; continue; }
        if (!ids.has(t)) ids.set(t, ids.size);
        keys[i] = ids.get(t);
      }
      sx = new Float64Array(ids.size); sy = new Float64Array(ids.size); cnt = new Int32Array(ids.size);
    };
    return force;
  }

  // Builds (but does not start) the simulation. The caller drives ticks.
  function createSimulation(d3, nodes, links, opts) {
    const count = nodes.length;
    const isMassive = count > MASSIVE_NODE_THRESHOLD;
    const layout = LAYOUTS.includes(opts.layout) ? opts.layout : 'force';
    const targets = computeTargets(layout, nodes, links, opts);
    const sim = d3.forceSimulation(nodes).stop();
    if (targets) {
      // Target layouts: strong pull to the computed slot plus collision so dots
      // don't stack. Links keep a little influence so neighbours stay near.
      for (let i = 0; i < count; i++) { nodes[i].__tx = targets[i * 2]; nodes[i].__ty = targets[i * 2 + 1]; }
      sim
        .force('x', d3.forceX(n => n.__tx).strength(layout === 'timeline' ? 0.55 : 0.35))
        .force('y', d3.forceY(n => n.__ty).strength(0.35))
        .force('link', d3.forceLink(links).id(n => n.id).distance(30).strength(0.02))
        .force('collide', isMassive ? null : d3.forceCollide().radius(n => (n.r || 4) + 1.2))
        .alphaDecay(isMassive ? 0.05 : 0.035)
        .velocityDecay(0.55);
    } else {
      const charge = isMassive ? -4
        : count > LARGE_NODE_THRESHOLD ? -10
        : count > MEDIUM_NODE_THRESHOLD ? -15
        : count > SMALL_NODE_THRESHOLD ? -25
        : -30;
      const distance = isMassive ? 16
        : count > LARGE_NODE_THRESHOLD ? 24
        : count > MEDIUM_NODE_THRESHOLD ? 30
        : 40;
      sim
        .force('link', d3.forceLink(links).id(n => n.id).distance(distance).strength(isMassive ? 0.15 : 0.3))
        .force('charge', d3.forceManyBody().strength(charge).theta(isMassive ? 1.2 : 0.9))
        .force('center', d3.forceCenter(opts.centerX || 0, opts.centerY || 0))
        .force('collide', isMassive ? null : d3.forceCollide().radius(n => (n.r || 4) + 2))
        .force('cluster', opts.clusterByTag ? forceCluster(0.03) : null)
        .alphaDecay(isMassive ? 0.05 : count > LARGE_NODE_THRESHOLD ? 0.03 : 0.02)
        .velocityDecay(isMassive ? 0.75 : count > LARGE_NODE_THRESHOLD ? 0.68 : 0.6);
    }
    sim.alpha(typeof opts.alpha === 'number' ? opts.alpha : 1);
    return sim;
  }

  // Runs the simulation to rest synchronously. Used for captures, where the
  // worker's timers don't honour Chrome's virtual time budget.
  function settle(sim, maxTicks) {
    const limit = maxTicks || 300;
    for (let i = 0; i < limit && sim.alpha() > 0.02; i++) sim.tick();
    return sim;
  }

  const api = { createSimulation, computeTargets, settle, tagRanks, degrees, hash01, LAYOUTS, MASSIVE_NODE_THRESHOLD };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.LayoutCore = api;
})(typeof self !== 'undefined' ? self : this);
