#!/usr/bin/env node
// Renderer smoke test. Boots the real server against a throwaway vault, then
// loads index.html in headless Chrome with a synthetic graph for a handful of
// representative presets and asserts that:
//   1. no uncaught JS error / exception is logged, and
//   2. nodes actually painted (read from the page <title> the renderer sets in
//      oneshot mode — catches the "silently blank frame" class of regression).
//
// Chrome is located cross-platform (see find-chrome.js). If no Chrome is found
// the test SKIPS with exit 0, so `npm test` stays green on machines without a
// browser; CI runners (which have Chrome) exercise it for real.

const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');
const { findChrome } = require('./find-chrome.js');
const { startApp } = require('../parser.js');

const PRESETS_TO_CHECK = ['Ambient', 'Mist', 'Confetti', 'Constellation']; // gradient, light/flat, curve/showcase, no-edges
// Option combinations on the default theme that exercise the newer code paths.
const OPTION_CASES = [
  ['layout rings', { layout: 'rings' }],
  ['layout timeline + framing fill', { layout: 'timeline', framing: 'fill' }],
  ['layout galaxy + framing left', { layout: 'galaxy', framing: 'right', zoom: 1.3 }],
  ['recency + tag shapes + palette', { nodeColorMode: 'recency', tagShapes: true, palette: 'neon' }],
  ['labels recent + glow sprites', { hubLabels: true, labelSource: 'recent', labelStyle: { mode: 'glow' } }],
  ['ambient + parallax + breathing', { ambientParticles: true, depthParallax: true, glowBreathing: true }],
  ['focus note', { focusNote: 'Project MOC', focusHops: 2 }],
  ['safe area + overlay + tint', { safeArea: { top: 30, right: 130, bottom: 90, left: 0 }, overlay: 'clock', timeOfDay: 'tint' }],
  ['webgl renderer', { renderer: 'webgl' }],
  ['framing none (legacy)', { framing: 'none' }]
];
const PORT = 3997;

function log(msg) { process.stdout.write(msg + '\n'); }

function waitForServer(port, ms = 8000) {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const ping = () => {
      const req = http.request({ host: '127.0.0.1', port, path: '/', method: 'HEAD', timeout: 800 }, res => { res.resume(); resolve(); });
      req.on('error', () => { Date.now() - started > ms ? reject(new Error('server never came up')) : setTimeout(ping, 200); });
      req.end();
    };
    ping();
  });
}

function renderTitle(chrome, url, timeoutMs = 30000, extraArgs = []) {
  // --dump-dom prints the serialized DOM (including <title>) to stdout once the
  // virtual-time budget elapses. We parse the title and scan stderr for errors.
  return new Promise((resolve, reject) => {
    const args = [
      '--headless=new', '--no-sandbox', '--disable-gpu', '--hide-scrollbars',
      '--no-first-run', '--no-default-browser-check', '--force-device-scale-factor=1',
      ...extraArgs,
      '--window-size=960,540', '--virtual-time-budget=6000', '--dump-dom', url
    ];
    const proc = spawn(chrome, args);
    let out = '', err = '';
    proc.stdout.on('data', d => { out += d; });
    proc.stderr.on('data', d => { err += d; });
    const timer = setTimeout(() => { proc.kill('SIGKILL'); reject(new Error('chrome timeout')); }, timeoutMs);
    proc.on('error', e => { clearTimeout(timer); reject(e); });
    proc.on('exit', () => {
      clearTimeout(timer);
      const m = out.match(/<title>([^<]*)<\/title>/);
      resolve({ title: m ? m[1] : '', stderr: err });
    });
  });
}

function cfgUrl(config, size = 1500) {
  const qs = new URLSearchParams();
  qs.set('synthetic', String(size));
  qs.set('cfgjson', encodeURIComponent(JSON.stringify(config)));
  qs.set('oneshot', '1');
  return `http://127.0.0.1:${PORT}/?${qs.toString()}`;
}

function buildUrl(presets, name) {
  const p = presets.find(x => x.name === name);
  if (!p) throw new Error(`preset not found: ${name}`);
  return cfgUrl(p.config);
}

async function main() {
  const chrome = findChrome();
  if (!chrome) {
    log('smoke:render skipped — no Chrome/Chromium found (set CHROME=/path/to/chrome to enable)');
    return;
  }
  log(`smoke:render using ${chrome}`);

  // Throwaway vault + config so the real server starts without touching the
  // user's setup. Synthetic mode means the graph contents are irrelevant.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'olw-render-'));
  const vault = path.join(dir, 'vault');
  fs.mkdirSync(vault, { recursive: true });
  fs.writeFileSync(path.join(vault, 'A.md'), '#x\n[[B]]\n');
  fs.writeFileSync(path.join(vault, 'B.md'), 'b\n');
  const configPath = path.join(dir, 'config.json');
  fs.writeFileSync(configPath, JSON.stringify({ vaultPath: vault, port: PORT }));

  const app = await startApp({ configPath, outPath: path.join(dir, 'graph.json') });
  let failures = 0;
  try {
    await waitForServer(PORT);
    const presets = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'presets.json'), 'utf8'));
    const ERROR_RE = /(Uncaught|TypeError|ReferenceError|SyntaxError|is not a function|Cannot read prop)/;
    for (const name of PRESETS_TO_CHECK) {
      const { title, stderr } = await renderTitle(chrome, buildUrl(presets, name));
      const m = title.match(/drawn=(\d+)\s+nodes=(\d+)/);
      const drawn = m ? parseInt(m[1], 10) : -1;
      const errLine = (stderr.split('\n').find(l => ERROR_RE.test(l)) || '').trim();
      if (errLine) { log(`  ✗ ${name}: JS error → ${errLine.slice(0, 120)}`); failures++; continue; }
      if (drawn <= 0) { log(`  ✗ ${name}: no nodes drawn (title="${title}")`); failures++; continue; }
      log(`  ✓ ${name}: drew ${drawn} nodes`);
    }

    const check = async (label, url) => {
      const { title, stderr } = await renderTitle(chrome, url);
      const m = title.match(/drawn=(\d+)\s+nodes=(\d+)/);
      const drawn = m ? parseInt(m[1], 10) : -1;
      const errLine = (stderr.split('\n').find(l => ERROR_RE.test(l)) || '').trim();
      if (errLine) { log(`  ✗ ${label}: JS error → ${errLine.slice(0, 160)}`); failures++; return; }
      if (drawn <= 0) { log(`  ✗ ${label}: nothing drawn (title="${title}")`); failures++; return; }
      log(`  ✓ ${label}: drew ${drawn}`);
    };
    // Every theme the server knows about must load and draw.
    const themes = require('../parser.js').THEME_LIST.map(t => t.id).filter(id => id !== 'default');
    for (const id of themes) await check(`theme ${id}`, cfgUrl({ theme: id, hubLabels: true }, 600));
    for (const [label, config] of OPTION_CASES) await check(label, cfgUrl(config, 800));
    // A big synthetic graph takes the massive tier / spiral path.
    await check('massive tier (6000 nodes)', cfgUrl({}, 6000));

    // prefers-reduced-motion must disable motion without blanking the graph.
    const { title: rmTitle, stderr: rmErr } = await renderTitle(
      chrome, buildUrl(presets, 'Ambient'), 30000, ['--force-prefers-reduced-motion']);
    const rmDrawn = (rmTitle.match(/drawn=(\d+)/) || [])[1];
    if (ERROR_RE.test(rmErr)) { log('  ✗ reduced-motion: JS error'); failures++; }
    else if (!rmDrawn || parseInt(rmDrawn, 10) <= 0) { log(`  ✗ reduced-motion: no nodes drawn (title="${rmTitle}")`); failures++; }
    else log(`  ✓ reduced-motion: drew ${rmDrawn} nodes`);
  } finally {
    try { app.watcher.close(); } catch (_) {}
    try { app.configWatcher.close(); } catch (_) {}
    try { app.server.close(); } catch (_) {}
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) {}
  }

  if (failures > 0) { console.error(`smoke:render FAILED (${failures} preset(s))`); process.exit(1); }
  log('smoke:render ok');
  // startApp installs SIGINT/SIGTERM handlers and keeps the loop alive; exit explicitly.
  process.exit(0);
}

main().catch(e => { console.error('smoke:render error:', e.message); process.exit(1); });
