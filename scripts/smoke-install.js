// Smoke test for `olw install` / `olw uninstall` (lib/autostart.js).
//
// Runs every platform's flow against a fake home dir in os.tmpdir() and a
// recording fake runner. It never calls the real launchctl / systemctl /
// schtasks and never touches the real home directory.
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const autostart = require('../lib/autostart.js');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'olw-install-'));
let passed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log(`ok   ${name}`); }
  catch (e) { console.error(`FAIL ${name}\n${e.stack}`); process.exitCode = 1; }
}

function recorder(failing = () => false) {
  const calls = [];
  const run = (cmd, args) => {
    calls.push([cmd, ...args]);
    return failing(cmd, args) ? { code: 1, stdout: '', stderr: 'fake failure' } : { code: 0, stdout: '', stderr: '' };
  };
  return { run, calls };
}
const quiet = { log: () => {}, warn: () => {} };

function fixture(platform) {
  const base = path.join(root, platform);
  const home = path.join(base, 'home');
  fs.mkdirSync(home, { recursive: true });
  if (platform === 'win32') {
    return {
      platform, home: 'C:\\Users\\Test User',
      execPath: 'C:\\Program Files\\nodejs\\node.exe',
      scriptPath: 'C:\\Users\\Test User\\AppData\\Roaming\\npm\\node_modules\\obsidian-live-wallpaper\\bin\\cli.js',
      configPath: 'C:\\Users\\Test User\\My Vault Config\\olw.config.json',
      port: 3123
    };
  }
  return {
    platform, home, uid: 501,
    execPath: '/opt/node dir/bin/node',
    scriptPath: '/usr/local/lib/node_modules/obsidian-live-wallpaper/bin/cli.js',
    configPath: path.join(base, 'my vault cfg', 'olw.config.json'),
    port: 3123
  };
}

// ---------- macOS ----------
test('darwin: install writes a launchd plist and bootstraps it', () => {
  const f = fixture('darwin');
  const rec = recorder();
  const r = autostart.install({ ...f, run: rec.run, ...quiet });
  assert.ok(r.ok);
  const d = r.desc;
  assert.match(d.label, /^com\.obsidian-live-wallpaper\.[0-9a-f]{8}$/);
  assert.strictEqual(d.file, path.join(f.home, 'Library', 'LaunchAgents', `${d.label}.plist`));
  const xml = fs.readFileSync(d.file, 'utf8');
  assert.match(xml, /<key>KeepAlive<\/key>\s*<dict>\s*<key>SuccessfulExit<\/key><false\/>\s*<\/dict>/);
  assert.match(xml, /<key>RunAtLoad<\/key><true\/>/);
  assert.ok(xml.includes(`<string>${f.execPath}</string>`));
  assert.ok(xml.includes(`<string>${f.scriptPath}</string>`));
  assert.ok(xml.includes('<string>--config</string>'));
  assert.ok(xml.includes(`<string>${f.configPath}</string>`));
  assert.ok(xml.includes(`<key>WorkingDirectory</key><string>${path.dirname(f.configPath)}</string>`));
  assert.ok(xml.includes(path.join(f.home, 'Library', 'Logs', `obsidian-live-wallpaper-${d.hash}.log`)));
  assert.match(xml, /<key>PATH<\/key><string>\/opt\/node dir\/bin:/);
  assert.ok(!/<!--(?:(?!-->)[\s\S])*--(?!>)/.test(xml), 'XML comments must not contain "--"');
  assert.ok(fs.existsSync(path.join(f.home, 'Library', 'Logs')), 'log dir created');
  assert.deepStrictEqual(rec.calls, [
    ['launchctl', 'bootout', `gui/501/${d.label}`],
    ['launchctl', 'bootstrap', 'gui/501', d.file]
  ]);
  if (process.platform === 'darwin' && fs.existsSync('/usr/bin/plutil')) {
    const lint = spawnSync('/usr/bin/plutil', ['-lint', d.file], { encoding: 'utf8' });
    assert.strictEqual(lint.status, 0, `plutil -lint: ${lint.stdout}${lint.stderr}`);
  }
});

test('darwin: reinstall is idempotent (bootout already-loaded failure ignored)', () => {
  const f = fixture('darwin');
  const first = autostart.install({ ...f, run: recorder().run, ...quiet });
  const before = fs.readFileSync(first.desc.file, 'utf8');
  const rec = recorder((cmd, args) => args[0] === 'bootout'); // "not loaded" -> nonzero
  const r = autostart.install({ ...f, run: rec.run, ...quiet });
  assert.ok(r.ok);
  assert.strictEqual(fs.readFileSync(r.desc.file, 'utf8'), before);
  assert.strictEqual(fs.readdirSync(path.dirname(r.desc.file)).length, 1, 'one plist, no leftovers');
  assert.deepStrictEqual(rec.calls.map(c => c[1]), ['bootout', 'bootstrap']);
});

test('darwin: falls back to launchctl load -w when bootstrap fails', () => {
  const f = fixture('darwin');
  const rec = recorder((cmd, args) => args[0] === 'bootstrap');
  const r = autostart.install({ ...f, run: rec.run, ...quiet });
  assert.deepStrictEqual(rec.calls.slice(1), [
    ['launchctl', 'bootstrap', 'gui/501', r.desc.file],
    ['launchctl', 'unload', r.desc.file],
    ['launchctl', 'load', '-w', r.desc.file]
  ]);
});

test('darwin: install throws when bootstrap and load -w both fail', () => {
  const f = fixture('darwin');
  const rec = recorder((cmd, args) => args[0] === 'bootstrap' || args[0] === 'load');
  assert.throws(() => autostart.install({ ...f, run: rec.run, ...quiet }), /launchctl load -w .* failed/);
});

test('darwin: uninstall boots out and deletes the plist; idempotent', () => {
  const f = fixture('darwin');
  const { desc } = autostart.install({ ...f, run: recorder().run, ...quiet });
  const rec = recorder();
  autostart.uninstall({ ...f, run: rec.run, ...quiet });
  assert.ok(!fs.existsSync(desc.file));
  assert.deepStrictEqual(rec.calls, [['launchctl', 'bootout', `gui/501/${desc.label}`]]);
  const rec2 = recorder(() => true); // nothing loaded any more
  autostart.uninstall({ ...f, run: rec2.run, ...quiet });
  assert.deepStrictEqual(rec2.calls, [['launchctl', 'bootout', `gui/501/${desc.label}`]]);
});

test('darwin: different configs get different labels', () => {
  const f = fixture('darwin');
  const a = autostart.describe(f);
  const b = autostart.describe({ ...f, configPath: f.configPath + '.other.json' });
  assert.notStrictEqual(a.label, b.label);
  assert.notStrictEqual(a.logPath, b.logPath);
});

// ---------- Linux ----------
test('linux: install writes a systemd user unit and enables it', () => {
  const f = fixture('linux');
  const rec = recorder();
  const r = autostart.install({ ...f, run: rec.run, ...quiet });
  const d = r.desc;
  assert.match(d.unit, /^obsidian-live-wallpaper-[0-9a-f]{8}\.service$/);
  assert.strictEqual(d.file, path.join(f.home, '.config', 'systemd', 'user', d.unit));
  const unit = fs.readFileSync(d.file, 'utf8');
  assert.match(unit, /^Restart=on-failure$/m);
  assert.match(unit, /^RestartSec=5$/m);
  assert.match(unit, /^WantedBy=default\.target$/m);
  assert.ok(unit.includes(`ExecStart="${f.execPath}" "${f.scriptPath}" "--config" "${f.configPath}"`));
  assert.ok(unit.includes(`WorkingDirectory=${path.dirname(f.configPath)}`));
  assert.ok(unit.includes('Environment="PATH=/opt/node dir/bin:'));
  assert.deepStrictEqual(rec.calls, [
    ['systemctl', '--user', 'daemon-reload'],
    ['systemctl', '--user', 'enable', '--now', d.unit]
  ]);
});

test('linux: reinstall rewrites the unit and restarts it', () => {
  const f = fixture('linux');
  const rec = recorder();
  const r = autostart.install({ ...f, run: rec.run, ...quiet });
  assert.deepStrictEqual(rec.calls, [
    ['systemctl', '--user', 'daemon-reload'],
    ['systemctl', '--user', 'enable', '--now', r.desc.unit],
    ['systemctl', '--user', 'restart', r.desc.unit]
  ]);
  assert.strictEqual(fs.readdirSync(path.dirname(r.desc.file)).length, 1);
});

test('linux: systemd quoting escapes %, " and \\', () => {
  const f = fixture('linux');
  const d = autostart.describe({ ...f, configPath: '/home/u/100% "odd"\\cfg.json' });
  assert.ok(d.content.includes('"/home/u/100%% \\"odd\\"\\\\cfg.json"'));
});

test('linux: uninstall disables, deletes and reloads; idempotent', () => {
  const f = fixture('linux');
  const d = autostart.describe(f);
  const rec = recorder();
  autostart.uninstall({ ...f, run: rec.run, ...quiet });
  assert.ok(!fs.existsSync(d.file));
  assert.deepStrictEqual(rec.calls, [
    ['systemctl', '--user', 'disable', '--now', d.unit],
    ['systemctl', '--user', 'daemon-reload']
  ]);
  const rec2 = recorder(() => true);
  autostart.uninstall({ ...f, run: rec2.run, ...quiet }); // must not throw
  assert.strictEqual(rec2.calls.length, 2);
});

// ---------- Windows ----------
test('win32: install creates an ONLOGON task with quoted paths and runs it', () => {
  const f = fixture('win32');
  const rec = recorder();
  const logs = [];
  const r = autostart.install({ ...f, run: rec.run, log: m => logs.push(m), warn: () => {} });
  const d = r.desc;
  assert.match(d.taskName, /^ObsidianLiveWallpaper-[0-9a-f]{8}$/);
  const tr = '"C:\\Program Files\\nodejs\\node.exe" ' +
    '"C:\\Users\\Test User\\AppData\\Roaming\\npm\\node_modules\\obsidian-live-wallpaper\\bin\\cli.js" ' +
    '--config "C:\\Users\\Test User\\My Vault Config\\olw.config.json"';
  assert.deepStrictEqual(rec.calls, [
    ['schtasks', '/Create', '/SC', 'ONLOGON', '/TN', d.taskName, '/TR', tr, '/RL', 'LIMITED', '/F'],
    ['schtasks', '/Run', '/TN', d.taskName]
  ]);
  assert.ok(logs.some(l => /does not restart/.test(l)), 'mentions no crash restart');
  assert.ok(logs.some(l => l.includes('http://127.0.0.1:3123')), 'prints wallpaper URL');
  assert.strictEqual(d.file, null);
});

test('win32: reinstall uses /F (same commands again)', () => {
  const f = fixture('win32');
  const a = recorder(); const b = recorder();
  autostart.install({ ...f, run: a.run, ...quiet });
  autostart.install({ ...f, run: b.run, ...quiet });
  assert.deepStrictEqual(a.calls, b.calls);
});

test('win32: uninstall ends and deletes the task; idempotent', () => {
  const f = fixture('win32');
  const d = autostart.describe(f);
  const rec = recorder();
  autostart.uninstall({ ...f, run: rec.run, ...quiet });
  assert.deepStrictEqual(rec.calls, [
    ['schtasks', '/End', '/TN', d.taskName],
    ['schtasks', '/Delete', '/TN', d.taskName, '/F']
  ]);
  autostart.uninstall({ ...f, run: recorder(() => true).run, ...quiet }); // task gone: no throw
});

// ---------- cross-platform ----------
for (const platform of ['darwin', 'linux', 'win32']) {
  test(`${platform}: --dry-run writes nothing and runs nothing`, () => {
    const f = fixture(platform);
    const home = path.join(root, `dry-${platform}`);
    fs.mkdirSync(home, { recursive: true });
    const opts = platform === 'win32' ? f : { ...f, home };
    const run = () => { throw new Error('runner called during dry run'); };
    const logs = [];
    autostart.install({ ...opts, run, dryRun: true, log: m => logs.push(m), warn: () => {} });
    autostart.uninstall({ ...opts, run, dryRun: true, log: m => logs.push(m) });
    assert.deepStrictEqual(fs.readdirSync(home), [], 'fake home untouched');
    assert.ok(logs.join('\n').includes(platform === 'darwin' ? 'launchctl bootstrap'
      : platform === 'linux' ? 'systemctl --user enable --now' : 'schtasks /Create'));
  });

  test(`${platform}: npx-cache execPath warns and refuses without --force`, () => {
    const f = fixture(platform);
    const home = path.join(root, `npx-${platform}`);
    fs.mkdirSync(home, { recursive: true });
    const scriptPath = platform === 'win32'
      ? 'C:\\Users\\Test User\\AppData\\Local\\npm-cache\\_npx\\abc123\\node_modules\\obsidian-live-wallpaper\\bin\\cli.js'
      : path.join(home, '.npm', '_npx', 'abc123', 'node_modules', 'obsidian-live-wallpaper', 'bin', 'cli.js');
    const opts = { ...f, home: platform === 'win32' ? f.home : home, scriptPath };
    const warns = [];
    const rec = recorder();
    const r = autostart.install({ ...opts, run: rec.run, log: () => {}, warn: m => warns.push(m) });
    assert.strictEqual(r.ok, false);
    assert.ok(r.refused);
    assert.deepStrictEqual(rec.calls, []);
    assert.ok(warns.join('\n').includes('npm i -g obsidian-live-wallpaper'));
    assert.ok(warns.join('\n').includes('--force'));
    if (platform !== 'win32') assert.ok(!fs.existsSync(path.join(home, 'Library')) && !fs.existsSync(path.join(home, '.config')));

    const forced = recorder();
    const r2 = autostart.install({ ...opts, run: forced.run, force: true, ...quiet });
    assert.ok(r2.ok);
    assert.ok(forced.calls.length > 0);
  });
}

test('transientReason: node itself inside _npx is flagged; normal paths are not', () => {
  assert.ok(autostart.transientReason('/Users/a/.npm/_npx/x/node', '/usr/lib/cli.js'));
  assert.strictEqual(autostart.transientReason('/opt/homebrew/bin/node', '/opt/homebrew/lib/node_modules/obsidian-live-wallpaper/bin/cli.js'), null);
});

test('unsupported platform throws a clear error', () => {
  assert.throws(() => autostart.describe({ ...fixture('linux'), platform: 'aix' }), /not supported/);
});

// ---------- CLI wiring (dry run only: the real runner is never reached) ----------
test('cli: install --dry-run validates but writes no config; --help lists install', () => {
  const cli = path.join(__dirname, '..', 'bin', 'cli.js');
  const dir = path.join(root, 'cli');
  const vault = path.join(dir, 'a vault');
  fs.mkdirSync(vault, { recursive: true });
  const cfg = path.join(dir, 'olw.config.json');
  const r = spawnSync(process.execPath, [cli, 'install', '--dry-run', '--vault', vault, '--config', cfg, '--port', '3456'],
    { encoding: 'utf8', cwd: dir });
  assert.strictEqual(r.status, 0, r.stderr);
  assert.ok(r.stdout.includes('dry run'));
  assert.ok(r.stdout.includes('--config'));
  assert.ok(!fs.existsSync(cfg), 'config not written in dry run');

  const bad = spawnSync(process.execPath, [cli, 'install', '--dry-run', '--config', cfg], { encoding: 'utf8', cwd: dir });
  assert.strictEqual(bad.status, 1);
  assert.match(bad.stderr, /Missing --vault/);

  const help = spawnSync(process.execPath, [cli, '--help'], { encoding: 'utf8' });
  assert.match(help.stdout, /olw install/);
  assert.match(help.stdout, /olw uninstall/);
});

fs.rmSync(root, { recursive: true, force: true });
console.log(`\nsmoke-install: ${passed} passed${process.exitCode ? ', some FAILED' : ''}`);
