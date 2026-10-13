#!/usr/bin/env node
// CLI entry so the wallpaper can be launched without cloning:
//
//   npx obsidian-live-wallpaper --vault ~/Notes [--port 3000]
//
// It scaffolds (or updates) a small config file in the current directory and
// hands off to the same startApp() used by `npm start`. Static assets are still
// served from the installed package; only the config and graph.json are written
// to the working directory (so this works from a read-only npx cache).

const fs = require('fs');
const path = require('path');
const { startApp, sanitizePersistedConfig } = require('../parser.js');

const args = process.argv.slice(2);

function flag(...names) {
  for (const n of names) {
    const i = args.indexOf(n);
    // A following arg that itself looks like a flag (e.g. `--vault --port 3000`,
    // or `--vault` as the last arg) means no value was actually given — treat
    // it as missing rather than silently consuming the next flag as the value.
    if (i >= 0 && i + 1 < args.length && !args[i + 1].startsWith('-')) return args[i + 1];
  }
  return null;
}

function has(...names) { return names.some(n => args.includes(n)); }

if (has('-h', '--help')) {
  process.stdout.write(`obsidian-live-wallpaper — your Obsidian vault graph as a live desktop wallpaper

Usage:
  npx obsidian-live-wallpaper --vault <path> [--port <n>] [--config <file>]

Options:
  -v, --vault <path>    Absolute path to your Obsidian vault (required first run)
  -p, --port <n>        HTTP port for the wallpaper server (default 3000)
  -c, --config <file>   Config file to read/write (default ./obsidian-live-wallpaper.config.json;
                        OLW_CONFIG works too). \`npm start -- --config <file>\` reads the same file.
  -h, --help            Show this help

After it starts, point your wallpaper host (Plash / Lively / etc.) at the
printed http://127.0.0.1:<port> URL, and open /settings.html to customize.
`);
  process.exit(0);
}

const vault = flag('-v', '--vault');
const port = flag('-p', '--port');
const configArg = flag('-c', '--config');
const configPath = path.resolve(process.cwd(), configArg || process.env.OLW_CONFIG || 'obsidian-live-wallpaper.config.json');

let cfg = {};
if (fs.existsSync(configPath)) {
  try { cfg = JSON.parse(fs.readFileSync(configPath, 'utf8')); }
  catch (e) { console.error(`Could not parse ${configPath}: ${e.message}`); process.exit(1); }
}
if (vault) cfg.vaultPath = path.resolve(vault);
if (port) {
  const p = parseInt(port, 10);
  if (!Number.isInteger(p) || p < 1 || p > 65535) { console.error('--port must be an integer between 1 and 65535'); process.exit(1); }
  cfg.port = p;
}

if (!cfg.vaultPath) {
  console.error('Missing --vault <path to your Obsidian vault>.\nRun with --help for usage.');
  process.exit(1);
}
if (!fs.existsSync(cfg.vaultPath)) {
  console.error(`Vault path does not exist: ${cfg.vaultPath}`);
  process.exit(1);
}

// Validate before writing, so a bad value never gets persisted to disk.
try {
  sanitizePersistedConfig(cfg);
} catch (e) {
  console.error(`${configPath}: ${e.message}`);
  process.exit(1);
}

try {
  fs.writeFileSync(configPath, JSON.stringify(cfg, null, 2));
} catch (e) {
  console.error(`Could not write config to ${configPath}: ${e.message}`);
  process.exit(1);
}

console.log(`config:     ${configPath}`);
startApp({ configPath, outPath: path.join(path.dirname(configPath), 'graph.json') })
  .catch(e => {
    console.error(`startup failed: ${e.message}`);
    process.exit(1);
  });
