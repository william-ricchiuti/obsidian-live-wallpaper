'use strict';

// Per-user autostart for `olw install` / `olw uninstall`.
//
// Every side effect goes through injectable pieces so the smoke test can run
// the whole flow against a fake home dir and a recording runner:
//   - platform / home / uid / execPath / scriptPath  (where and what to register)
//   - run(cmd, args) -> { code, stdout, stderr }      (launchctl / systemctl / schtasks)
// Commands are always run with execFile-style argument arrays, never a shell.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');

const DEFAULT_PORT = 3000;

function defaultRun(cmd, args) {
  const r = spawnSync(cmd, args, { encoding: 'utf8', shell: false, windowsHide: true });
  if (r.error) return { code: -1, stdout: '', stderr: r.error.message, error: r.error };
  return { code: r.status == null ? -1 : r.status, stdout: r.stdout || '', stderr: r.stderr || '' };
}

// Short, stable id per config file so several vaults can each have their own entry.
function serviceHash(configPath) {
  return crypto.createHash('sha1').update(path.resolve(configPath)).digest('hex').slice(0, 8);
}

// node or the CLI script living in an npx / pnpm dlx cache disappears when the
// cache is cleaned, and the login item would then fail silently.
function transientReason(execPath, scriptPath) {
  const re = /[\\/]_npx[\\/]|[\\/]pnpm[\\/]dlx|[\\/]\.pnpm-store[\\/].*dlx/i;
  if (re.test(execPath)) return `node (${execPath}) is inside an npx cache`;
  if (re.test(scriptPath)) return `the CLI (${scriptPath}) is inside an npx cache`;
  return null;
}

function xmlEscape(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

// systemd unit-file quoting: double-quote each word, escape \ and ", and
// double % (systemd specifier prefix).
function systemdQuote(s) {
  return '"' + String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/%/g, '%%') + '"';
}
function systemdPath(s) { return String(s).replace(/%/g, '%%'); }

// Windows: the /TR value is itself a command line, so each path is wrapped in
// double quotes. Paths cannot contain " on Windows, so no inner escaping.
function winQuote(s) { return `"${s}"`; }

function pathEnv(platform, execPath) {
  const pathMod = platform === 'win32' ? path.win32 : path.posix;
  const sep = platform === 'win32' ? ';' : ':';
  const base = platform === 'darwin'
    ? ['/opt/homebrew/bin', '/usr/local/bin', '/usr/bin', '/bin', '/usr/sbin', '/sbin']
    : ['/usr/local/bin', '/usr/bin', '/bin'];
  const parts = [pathMod.dirname(execPath), ...base];
  return [...new Set(parts)].join(sep);
}

function describe(opts) {
  const platform = opts.platform || process.platform;
  const home = opts.home;
  const hash = serviceHash(opts.configPath);
  const configPath = opts.configPath;
  const configDir = (platform === 'win32' ? path.win32 : path.posix).dirname(configPath);
  const execPath = opts.execPath;
  const scriptPath = opts.scriptPath;
  const port = opts.port || DEFAULT_PORT;
  const url = `http://127.0.0.1:${port}`;
  const base = { platform, hash, configPath, configDir, execPath, scriptPath, port, url };

  if (platform === 'darwin') {
    const label = `com.obsidian-live-wallpaper.${hash}`;
    const uid = opts.uid != null ? opts.uid : (process.getuid ? process.getuid() : 501);
    const file = path.posix.join(home, 'Library', 'LaunchAgents', `${label}.plist`);
    const logPath = path.posix.join(home, 'Library', 'Logs', `obsidian-live-wallpaper-${hash}.log`);
    const progArgs = [execPath, scriptPath, '--config', configPath]
      .map(a => `    <string>${xmlEscape(a)}</string>`).join('\n');
    const content = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<!-- Written by olw install; remove it with olw uninstall and the same config file.
     (XML comments may not contain a double hyphen, so no paths or flags here.) -->
<plist version="1.0">
<dict>
  <key>Label</key><string>${xmlEscape(label)}</string>
  <key>ProgramArguments</key>
  <array>
${progArgs}
  </array>
  <key>WorkingDirectory</key><string>${xmlEscape(configDir)}</string>
  <key>RunAtLoad</key><true/>
  <!-- Restart only after a crash; a clean exit ("already running") stays stopped. -->
  <key>KeepAlive</key>
  <dict>
    <key>SuccessfulExit</key><false/>
  </dict>
  <key>StandardOutPath</key><string>${xmlEscape(logPath)}</string>
  <key>StandardErrorPath</key><string>${xmlEscape(logPath)}</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key><string>${xmlEscape(pathEnv(platform, execPath))}</string>
  </dict>
</dict>
</plist>
`;
    const domain = `gui/${uid}`;
    return {
      ...base, label, uid, domain, file, logPath, content,
      status: [`launchctl print ${domain}/${label}`, `tail -f "${logPath}"`]
    };
  }

  if (platform === 'linux') {
    const unit = `obsidian-live-wallpaper-${hash}.service`;
    const file = path.posix.join(home, '.config', 'systemd', 'user', unit);
    const content = `# Written by \`olw install\`. Remove with \`olw uninstall --config ${configPath}\`.
[Unit]
Description=Obsidian Live Wallpaper (${configPath.replace(/%/g, '%%')})
After=graphical-session.target

[Service]
Type=simple
WorkingDirectory=${systemdPath(configDir)}
Environment=${systemdQuote('PATH=' + pathEnv(platform, execPath))}
ExecStart=${[execPath, scriptPath, '--config', configPath].map(systemdQuote).join(' ')}
Restart=on-failure
RestartSec=5

[Install]
WantedBy=default.target
`;
    return {
      ...base, unit, file, content,
      status: [`systemctl --user status ${unit}`, `journalctl --user -u ${unit} -f`]
    };
  }

  if (platform === 'win32') {
    const taskName = `ObsidianLiveWallpaper-${hash}`;
    const tr = `${winQuote(execPath)} ${winQuote(scriptPath)} --config ${winQuote(configPath)}`;
    return {
      ...base, taskName, tr, file: null, content: null,
      status: [`schtasks /Query /TN "${taskName}" /V /FO LIST`]
    };
  }

  throw new Error(`autostart is not supported on platform "${platform}" (supported: darwin, linux, win32)`);
}

function installCommands(d, reinstall) {
  if (d.platform === 'darwin') {
    return [
      // Already loaded (reinstall)? Unload first; failure just means "not loaded".
      { cmd: 'launchctl', args: ['bootout', `${d.domain}/${d.label}`], optional: true },
      { cmd: 'launchctl', args: ['bootstrap', d.domain, d.file],
        // Older launchctl without bootstrap: legacy load.
        fallback: [
          { cmd: 'launchctl', args: ['unload', d.file], optional: true },
          { cmd: 'launchctl', args: ['load', '-w', d.file] }
        ] }
    ];
  }
  if (d.platform === 'linux') {
    return [
      { cmd: 'systemctl', args: ['--user', 'daemon-reload'] },
      { cmd: 'systemctl', args: ['--user', 'enable', '--now', d.unit] },
      // Reinstall: enable --now leaves an already-running service on the old
      // unit, so restart it to pick up the rewritten one.
      ...(reinstall ? [{ cmd: 'systemctl', args: ['--user', 'restart', d.unit] }] : [])
    ];
  }
  return [
    { cmd: 'schtasks', args: ['/Create', '/SC', 'ONLOGON', '/TN', d.taskName, '/TR', d.tr, '/RL', 'LIMITED', '/F'] },
    { cmd: 'schtasks', args: ['/Run', '/TN', d.taskName], optional: true }
  ];
}

function uninstallCommands(d, fileExists) {
  if (d.platform === 'darwin') {
    return [
      { cmd: 'launchctl', args: ['bootout', `${d.domain}/${d.label}`], optional: true,
        fallback: fileExists ? [{ cmd: 'launchctl', args: ['unload', '-w', d.file], optional: true }] : null }
    ];
  }
  if (d.platform === 'linux') {
    return [
      { cmd: 'systemctl', args: ['--user', 'disable', '--now', d.unit], optional: true },
      { cmd: 'systemctl', args: ['--user', 'daemon-reload'], optional: true, afterRemove: true }
    ];
  }
  return [
    { cmd: 'schtasks', args: ['/End', '/TN', d.taskName], optional: true },
    { cmd: 'schtasks', args: ['/Delete', '/TN', d.taskName, '/F'], optional: true }
  ];
}

function fmtCmd(c) {
  return [c.cmd, ...c.args].map(a => (/[\s"]/.test(a) ? JSON.stringify(a) : a)).join(' ');
}

// Runs a command list. A failed non-optional command throws (after trying its
// fallback); a failed optional one is ignored.
function runAll(cmds, run, log) {
  for (const c of cmds) {
    const r = run(c.cmd, c.args);
    if (r.code === 0) continue;
    if (c.fallback) {
      log(`  (${fmtCmd(c)} failed${r.stderr ? ': ' + r.stderr.trim() : ''}; trying fallback)`);
      runAll(c.fallback.map(f => ({ ...f, optional: f.optional || c.optional })), run, log);
      continue;
    }
    if (c.optional) continue;
    const detail = (r.stderr || r.stdout || '').trim();
    throw new Error(`${fmtCmd(c)} failed (exit ${r.code})${detail ? ': ' + detail : ''}`);
  }
}

function install(opts) {
  const log = opts.log || console.log;
  const warn = opts.warn || console.error;
  const d = describe(opts);
  const cmds = installCommands(d, !!(d.file && fs.existsSync(d.file)));
  const transient = transientReason(d.execPath, d.scriptPath);
  if (transient) {
    warn(`warning: ${transient}. The autostart entry would break when that cache is cleared.`);
    warn('         Install globally first:  npm i -g obsidian-live-wallpaper  then run  olw install');
    if (!opts.force) {
      warn('         (or re-run with --force to register it anyway)');
      return { ok: false, refused: true, desc: d };
    }
  }

  if (opts.dryRun) {
    log('dry run: nothing will be written or run.\n');
    if (d.file) log(`would write ${d.file}:\n\n${d.content}`);
    log('would run:');
    for (const c of cmds) {
      log(`  ${fmtCmd(c)}${c.optional ? '   (ignored if it fails)' : ''}`);
      for (const f of c.fallback || []) log(`    fallback: ${fmtCmd(f)}`);
    }
    return { ok: true, dryRun: true, desc: d, commands: cmds };
  }

  const run = opts.run || defaultRun;
  if (d.file) {
    fs.mkdirSync(path.dirname(d.file), { recursive: true });
    if (d.platform === 'darwin') fs.mkdirSync(path.dirname(d.logPath), { recursive: true });
    const tmp = d.file + '.tmp';
    fs.writeFileSync(tmp, d.content);
    fs.renameSync(tmp, d.file);
    log(`wrote:      ${d.file}`);
  }
  runAll(cmds, run, log);

  if (d.platform === 'darwin') log(`registered: launchd agent ${d.label} (starts at login, restarts only after a crash)`);
  if (d.platform === 'linux') log(`registered: systemd user unit ${d.unit} (starts at login, Restart=on-failure)`);
  if (d.platform === 'win32') {
    log(`registered: scheduled task "${d.taskName}" (runs at logon)`);
    log('note:       Task Scheduler does not restart the server if it crashes; log out/in or run');
    log(`            schtasks /Run /TN "${d.taskName}" to start it again.`);
    if (d.tr.length > 261) warn(`warning: the task command is ${d.tr.length} characters; schtasks may reject /TR values over 261.`);
  }
  log(`status:     ${d.status.join('\n            ')}`);
  log(`wallpaper:  ${d.url}   (give this URL to Plash / Lively / your wallpaper host)`);
  log(`settings:   ${d.url}/settings.html`);
  log(`remove:     olw uninstall --config "${d.configPath}"`);
  return { ok: true, desc: d, commands: cmds };
}

function uninstall(opts) {
  const log = opts.log || console.log;
  const d = describe(opts);
  const exists = d.file ? fs.existsSync(d.file) : true;
  const cmds = uninstallCommands(d, exists);
  const before = cmds.filter(c => !c.afterRemove);
  const after = cmds.filter(c => c.afterRemove);

  if (opts.dryRun) {
    log('dry run: nothing will be removed or run.\n');
    log('would run:');
    for (const c of before) log(`  ${fmtCmd(c)}`);
    if (d.file) log(`would delete ${d.file}${exists ? '' : ' (not present)'}`);
    for (const c of after) log(`  ${fmtCmd(c)}`);
    return { ok: true, dryRun: true, desc: d, commands: cmds };
  }

  const run = opts.run || defaultRun;
  runAll(before, run, log);
  if (d.file) {
    fs.rmSync(d.file, { force: true });
    log(exists ? `removed:    ${d.file}` : `not found:  ${d.file} (nothing to remove)`);
  }
  runAll(after, run, log);
  const what = d.label || d.unit || `task "${d.taskName}"`;
  log(`unregistered autostart ${what} for ${d.configPath}`);
  return { ok: true, desc: d, commands: cmds };
}

module.exports = {
  install,
  uninstall,
  describe,
  serviceHash,
  transientReason,
  defaultRun,
  DEFAULT_PORT
};
