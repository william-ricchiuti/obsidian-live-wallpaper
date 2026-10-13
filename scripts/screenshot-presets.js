#!/usr/bin/env node
// Screenshot each preset at a set of synthetic vault sizes using headless Chrome.
//
// Usage:
//   node scripts/screenshot-presets.js new        # presets.json at thumbnail size
//   node scripts/screenshot-presets.js new-large  # presets.json at 200/2000/10000 for record
//
// Starts its own throwaway server (the renderer only needs the static files;
// the graph is synthetic), so it never touches the user's config. Presets are
// injected via ?synthetic=N&cfgjson=... . Synthetic graphs up to 3000 notes are
// settled with the real layout code, so thumbnails look like a real vault.

const fs = require('fs');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');
const { findChrome } = require('./find-chrome.js');

const ROOT = path.resolve(__dirname, '..');
const CHROME = findChrome();
if (!CHROME) {
  console.error('No Chrome/Chromium found. Set CHROME=/path/to/chrome and retry.');
  process.exit(1);
}
const HOST = '127.0.0.1';
const PORT = parseInt(process.env.SCREENSHOT_PORT || '3996', 10);

async function startThrowawayServer() {
  const os = require('os');
  const { startApp } = require('../parser.js');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'olw-shots-'));
  const vault = path.join(dir, 'vault');
  fs.mkdirSync(vault, { recursive: true });
  fs.writeFileSync(path.join(vault, 'A.md'), '[[B]]\n');
  const configPath = path.join(dir, 'config.json');
  fs.writeFileSync(configPath, JSON.stringify({ vaultPath: vault, port: PORT }));
  return startApp({ configPath, outPath: path.join(dir, 'graph.json') });
}

function waitForServer(ms = 20000) {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const ping = () => {
      const req = http.request({ host: HOST, port: PORT, path: '/', method: 'HEAD', timeout: 1000 }, res => {
        res.resume(); resolve();
      });
      req.on('error', () => {
        if (Date.now() - started > ms) reject(new Error('server never came up'));
        else setTimeout(ping, 300);
      });
      req.end();
    };
    ping();
  });
}

function screenshot(url, outPath, { width = 1280, height = 720, delayMs = 3500 } = {}) {
  return new Promise((resolve, reject) => {
    const args = [
      '--headless=new',
      '--disable-gpu',
      '--hide-scrollbars',
      '--no-first-run',
      '--no-default-browser-check',
      '--force-device-scale-factor=1',
      `--window-size=${width},${height}`,
      `--virtual-time-budget=${delayMs}`,
      `--screenshot=${outPath}`,
      url
    ];
    const proc = spawn(CHROME, args, { stdio: 'ignore' });
    const timer = setTimeout(() => { proc.kill('SIGKILL'); reject(new Error('chrome timeout')); }, delayMs + 90000);
    proc.on('exit', code => {
      clearTimeout(timer);
      if (fs.existsSync(outPath)) resolve();
      else reject(new Error(`chrome exit ${code}, no file`));
    });
  });
}

function readNewPresets() {
  return JSON.parse(fs.readFileSync(path.join(ROOT, 'presets.json'), 'utf8'));
}

function buildUrl(size, cfg, { perf = false, oneshot = true } = {}) {
  const qs = new URLSearchParams();
  qs.set('synthetic', String(size));
  qs.set('cfgjson', encodeURIComponent(JSON.stringify(cfg)));
  if (oneshot) qs.set('oneshot', '1');
  if (perf) qs.set('perf', '1');
  return `http://${HOST}:${PORT}/?${qs.toString()}`;
}

function delayForSize(size) {
  // oneshot mode captures after the first few draws finish, so a modest
  // budget is enough even for 35k. The outer chrome timeout is the real cap.
  if (size <= 2000) return 1200;
  if (size <= 10000) return 2500;
  return 4000;
}

async function main() {
  const mode = process.argv[2] || 'new';
  await startThrowawayServer();
  await waitForServer();

  if (mode === 'new') {
    const presets = readNewPresets();
    const outDir = path.join(ROOT, 'docs/presets');
    fs.mkdirSync(outDir, { recursive: true });
    for (const preset of presets) {
      const file = preset.thumbnail ? path.basename(preset.thumbnail) : `${preset.name.toLowerCase().replace(/\s+/g, '-')}.png`;
      const out = path.join(outDir, file);
      const url = buildUrl(700, preset.config);
      process.stdout.write(`thumb ${preset.name} → `);
      try { await screenshot(url, out, { width: 960, height: 540, delayMs: 6000 }); console.log('ok'); }
      catch (e) { console.log('FAIL', e.message); }
    }
    process.exit(0);
  } else if (mode === 'new-large') {
    const presets = readNewPresets();
    const sizes = [200, 2000, 10000];
    const outDir = path.join(ROOT, 'docs/new-presets');
    fs.mkdirSync(outDir, { recursive: true });
    for (const preset of presets) {
      for (const size of sizes) {
        const out = path.join(outDir, `${preset.name.toLowerCase()}-${size}.png`);
        const url = buildUrl(size, preset.config);
        process.stdout.write(`new ${preset.name} ${size} → `);
        try { await screenshot(url, out, { delayMs: delayForSize(size) }); console.log('ok'); }
        catch (e) { console.log('FAIL', e.message); }
      }
    }
  } else {
    console.error('unknown mode', mode);
    process.exit(1);
  }
}

main().catch(e => { console.error(e); process.exit(1); });
