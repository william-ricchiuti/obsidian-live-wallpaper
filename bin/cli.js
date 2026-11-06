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
const os = require('os');
const path = require('path');
const autostart = require('../lib/autostart.js');
const { startApp, sanitizePersistedConfig, writeConfigFile } = require('../parser.js');

const rawArgs = process.argv.slice(2);
// `olw install` / `olw uninstall` register / remove a per-user login item
// (launchd agent, systemd user unit, or scheduled task). See lib/autostart.js.
const SUBCOMMANDS = new Set(['install', 'uninstall']);
const subcommand = SUBCOMMANDS.has(rawArgs[0]) ? rawArgs[0] : null;
const args = subcommand ? rawArgs.slice(1) : rawArgs;

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
  olw install   [--vault <path>] [--port <n>] [--config <file>] [--dry-run] [--force]
  olw uninstall [--config <file>] [--dry-run]

Options:
  -v, --vault <path>    Absolute path to your Obsidian vault (required first run)
  -p, --port <n>        HTTP port for the wallpaper server (default 3000)
  -c, --config <file>   Config file to read/write (default ./obsidian-live-wallpaper.config.json;
                        OLW_CONFIG works too). \`npm start -- --config <file>\` reads the same file.
  -h, --help            Show this help

Autostart:
  install               Write the config, then start the server at every login for this user
                        (macOS launchd agent, Linux systemd user unit, Windows scheduled task).
                        It restarts only after a crash. One entry per config file, so several
                        vaults can each have their own.
  uninstall             Stop and remove the entry \`install\` created for that config file.
  --dry-run             Print the file and commands without writing or running anything.
  --force               Install even when running from a temporary npx cache (not recommended:
                        run \`npm i -g obsidian-live-wallpaper\` and then \`olw install\`).

After it starts, point your wallpaper host (Plash / Lively / etc.) at the
printed http://127.0.0.1:<port> URL, and open /settings.html to customize.
`);
  process.exit(0);
}

const dryRun = has('--dry-run');
const vault = flag('-v', '--vault');
const port = flag('-p', '--port');
const configArg = flag('-c', '--config');
const configPath = path.resolve(process.cwd(), configArg || process.env.OLW_CONFIG || 'obsidian-live-wallpaper.config.json');

function autostartOpts(extra) {
  return {
    platform: process.platform,
    home: os.homedir(),
    execPath: process.execPath,
    scriptPath: path.resolve(__filename),
    configPath,
    dryRun,
    force: has('--force'),
    ...extra
  };
}

if (subcommand === 'uninstall') {
  try {
    autostart.uninstall(autostartOpts());
    process.exit(0);
  } catch (e) {
    console.error(`uninstall failed: ${e.message}`);
    process.exit(1);
  }
}

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

// Atomic (tmp file + rename), like the server's own config writes, so a crash
// or a concurrent reader never sees a half-written file. A dry-run install
// validates the config but writes nothing.
if (!(subcommand === 'install' && dryRun)) {
  try {
    writeConfigFile(cfg, configPath);
  } catch (e) {
    console.error(`Could not write config to ${configPath}: ${e.message}`);
    process.exit(1);
  }
}

if (subcommand === 'install') {
  console.log(`config:     ${configPath}${dryRun ? ' (dry run: not written)' : ''}`);
  try {
    const r = autostart.install(autostartOpts({ port: cfg.port }));
    process.exit(r.ok ? 0 : 1);
  } catch (e) {
    console.error(`install failed: ${e.message}`);
    process.exit(1);
  }
}

console.log(`config:     ${configPath}`);
startApp({ configPath, outPath: path.join(path.dirname(configPath), 'graph.json'), portFlag: '--port' })
  .catch(e => {
    console.error(`startup failed: ${e.message}`);
    process.exit(1);
  });
