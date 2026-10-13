// Force-simulation worker. Owns the d3 simulation so layout never stalls the
// main thread. The simulation is driven manually (sim.stop() + sim.tick()) on a
// fixed ~16ms step instead of d3-timer, which in a worker falls back to
// setTimeout(17) and gives no control over the work per message.
//
// Positions reach the main thread one of two ways:
//   - SharedArrayBuffer (when the page is cross-origin isolated): written in
//     place, and a small 'tick' message only carries alpha.
//   - Otherwise a fresh Float32Array per snapshot, *transferred* (zero-copy)
//     rather than structured-cloned.
importScripts('/vendor/d3.min.js', '/layout-core.js');

let sim = null;
let nodes = [];
let generation = 0;
let sharedPositions = null;
let running = false;
let stepTimer = null;
let lastPostAt = 0;
let idleTicks = 0;

const STEP_MS = 16;
const SNAPSHOT_INTERVAL_MS = 33;
// The simulation counts as settled once alpha stays below this for
// IDLE_TICKS_TO_STOP consecutive ticks.
const IDLE_ALPHA_THRESHOLD = 0.02;
const IDLE_TICKS_TO_STOP = 30;
// Upper bound on ticks per step for small graphs, so a warm start finishes
// quickly without one step blocking for long on big ones.
const STEP_BUDGET_MS = 10;

function writePositions(target) {
  for (let i = 0; i < nodes.length; i++) {
    const n = nodes[i];
    target[i * 2] = Number.isFinite(n.x) ? n.x : 0;
    target[i * 2 + 1] = Number.isFinite(n.y) ? n.y : 0;
  }
}

function post(type, force) {
  const now = performance.now();
  if (!force && now - lastPostAt < SNAPSHOT_INTERVAL_MS) return;
  lastPostAt = now;
  const alpha = sim ? sim.alpha() : 0;
  if (sharedPositions) {
    writePositions(sharedPositions);
    postMessage({ type, alpha, generation, count: nodes.length });
    return;
  }
  const buf = new Float32Array(nodes.length * 2);
  writePositions(buf);
  postMessage({ type, buffer: buf.buffer, alpha, generation, count: nodes.length }, [buf.buffer]);
}

function stop(type) {
  running = false;
  if (stepTimer) { clearTimeout(stepTimer); stepTimer = null; }
  post(type || 'stopped', true);
}

function step() {
  stepTimer = null;
  if (!running || !sim) return;
  const t0 = performance.now();
  // Small graphs: 1 tick per step keeps the settle animation smooth.
  // Large graphs: one tick may already exceed the budget, which is fine.
  const maxTicks = nodes.length < 400 ? 1 : 2;
  let ticks = 0;
  do {
    sim.tick();
    ticks++;
    if (sim.alpha() < IDLE_ALPHA_THRESHOLD) idleTicks++;
    else idleTicks = 0;
  } while (ticks < maxTicks && performance.now() - t0 < STEP_BUDGET_MS && idleTicks < IDLE_TICKS_TO_STOP);
  if (idleTicks >= IDLE_TICKS_TO_STOP) { stop('stopped'); return; }
  post('tick', false);
  stepTimer = setTimeout(step, Math.max(0, STEP_MS - (performance.now() - t0)));
}

self.onmessage = (e) => {
  const msg = e.data;
  if (!msg) return;

  if (msg.type === 'start') {
    if (stepTimer) { clearTimeout(stepTimer); stepTimer = null; }
    generation = msg.generation || (generation + 1);
    nodes = msg.nodes || [];
    sharedPositions = msg.sharedBuffer ? new Float32Array(msg.sharedBuffer) : null;
    idleTicks = 0;
    lastPostAt = 0;
    if (nodes.length === 0) { sim = null; stop('stopped'); return; }
    sim = LayoutCore.createSimulation(d3, nodes, msg.links || [], {
      layout: msg.layout,
      width: msg.width,
      height: msg.height,
      centerX: msg.centerX,
      centerY: msg.centerY,
      clusterByTag: !!msg.clusterByTag,
      alpha: typeof msg.alpha === 'number' ? msg.alpha : 1,
      now: msg.now
    });
    running = true;
    post('tick', true);
    stepTimer = setTimeout(step, 0);
  } else if (msg.type === 'stop') {
    stop('stopped');
  }
};
