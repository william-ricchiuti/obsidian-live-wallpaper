const fs = require('fs');
const http = require('http');
const net = require('net');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const { EventEmitter } = require('events');
const {
  buildGraph,
  createRequestHandler,
  sanitizePersistedConfig,
  sanitizeConfigPatch,
  applyFsEventToState,
  rebuildGraphState,
  materializeGraph,
  scanVaultEntries,
  extractTag,
  extractTags,
  extractWikilinks,
  noteExcerpt,
  isIgnoredPath,
  isTrustedHost,
  isJsonContentType,
  sanitizeCustomPresets,
  MAX_CUSTOM_PRESETS,
  startApp,
  DEFAULTS,
  THEME_LIST
} = require('../parser.js');
const core = require('../renderer-core.js');

// A port nobody else holds right now. Fixed ports let a second copy of the app
// (another checkout's test run, a running wallpaper) answer instead, and the
// server's "already running" path then exits 0: a silent false pass.
function freePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.unref();
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => { const { port } = srv.address(); srv.close(() => resolve(port)); });
  });
}

const layoutCore = require('../layout-core.js');

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function writeJson(filePath, value) {
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2));
}

function writeFile(filePath, content) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content);
}

function createMockRequest(method, url, body, headers = {}) {
  const req = new EventEmitter();
  req.method = method;
  req.url = url;
  req.headers = headers;
  // readBody() calls req.destroy() on the oversized-body (413) path; a real
  // http.IncomingMessage has this, the mock needs a stand-in too.
  req.destroy = () => {};
  process.nextTick(() => {
    if (body !== undefined) {
      req.emit('data', Buffer.from(body));
    }
    req.emit('end');
  });
  return req;
}

function createMockResponse() {
  // A real http.ServerResponse is a Writable stream (and thus an EventEmitter);
  // serveFile() uses stream.pipe(res), which needs dest.on(...) to exist and
  // dest.write() to signal "no backpressure" by returning true — otherwise
  // pipe() pauses the source waiting for a 'drain' this mock never emits.
  const res = new EventEmitter();
  return Object.assign(res, {
    statusCode: 200,
    headers: {},
    body: '',
    writableEnded: false,
    writeHead(statusCode, headers = {}) {
      this.statusCode = statusCode;
      this.headers = { ...this.headers, ...headers };
    },
    setHeader(name, value) {
      this.headers[name] = value;
    },
    write(chunk = '') {
      this.body += chunk;
      return true;
    },
    end(chunk = '') {
      this.body += chunk;
      this.writableEnded = true;
    },
    destroy() {
      this.writableEnded = true;
    }
  });
}

async function runHandler(handler, method, url, body, headers = {}) {
  const req = createMockRequest(method, url, body, headers);
  const res = createMockResponse();
  await handler(req, res);
  return res;
}

async function runHappyPath(tmpRoot) {
  const vaultDir = path.join(tmpRoot, 'happy-vault');
  const outFile = path.join(tmpRoot, 'happy-graph.json');

  writeFile(path.join(vaultDir, 'Alpha.md'), '# Alpha\n\n[[Beta]]\n#project\n');
  writeFile(path.join(vaultDir, 'Beta.md'), '# Beta\n\n[[Alpha]]\n');
  const config = sanitizePersistedConfig({
    vaultPath: vaultDir,
    port: 4310,
    accent: '#7c5cff',
    background: '#0a0a0f',
    refreshMs: 1000,
    linkOpacity: 0.18,
    nodeGlow: true,
    particles: true,
    particleSpeed: 1,
    particleDensity: 0.3,
    motionMode: 'balanced',
    clusterByTag: true,
    clusterHalos: true,
    backgroundGradient: true,
    hubLabels: false,
    hubLabelCount: 5,
    labelMinImportance: 0.22,
    edgeColoring: true,
    depthOfField: true,
    noteFlare: true,
    autoScaleLargeVaults: true,
    tagColors: {
      project: '#00ffd5'
    }
  });

  const initial = await buildGraph(vaultDir, outFile);
  assert(initial.nodes.length === 2, 'expected 2 nodes in initial graph');
  assert(initial.links.length === 2, 'expected 2 links in initial graph');
  assert(initial.discoveredTags.project === 1, 'expected discovered tag counts');
  const stored = JSON.parse(fs.readFileSync(outFile, 'utf8'));
  assert(stored.nodes.length === 2, 'expected graph.json to be written');

  const handler = createRequestHandler({
    cfg: config,
    configPath: path.join(tmpRoot, 'config.json'),
    outPath: outFile,
    discoveredTags: initial.discoveredTags
  });

  const configRes = await runHandler(handler, 'GET', '/api/config');
  const safeConfig = JSON.parse(configRes.body);
  assert(configRes.statusCode === 200, 'expected config route to return 200');
  assert(safeConfig.hubLabels === false, 'expected sanitized config response');
  assert(safeConfig.port === undefined, 'config response should not expose port');
  assert(safeConfig.vaultPath === undefined, 'config response should not expose vaultPath');

  const tagsRes = await runHandler(handler, 'GET', '/api/tags');
  const tags = JSON.parse(tagsRes.body);
  assert(tags.project === 1, 'expected tag route to return discovered tags');

  const faviconRes = await runHandler(handler, 'GET', '/favicon.ico');
  assert(faviconRes.statusCode === 204, 'expected favicon route to return 204');

  const patch = sanitizeConfigPatch({ hubLabels: true, hubLabelCount: 7 });
  assert(patch.hubLabels === true && patch.hubLabelCount === 7, 'expected config patch sanitization to work');

  writeFile(path.join(vaultDir, 'Gamma.md'), '# Gamma\n\n[[Alpha]]\n');
  const rebuilt = await buildGraph(vaultDir, outFile);
  assert(rebuilt.nodes.length === 3, 'expected rebuild to include new note');
}

async function runDuplicateBasenames(tmpRoot) {
  const vaultDir = path.join(tmpRoot, 'duplicate-vault');
  const outFile = path.join(tmpRoot, 'duplicate-graph.json');

  // Alpha is unique, Beta appears twice — root and nested/
  writeFile(path.join(vaultDir, 'Alpha.md'), '# Alpha\n\n[[Beta]]\n');
  writeFile(path.join(vaultDir, 'Beta.md'), '# Beta root\n\n[[Alpha]]\n');
  writeFile(path.join(vaultDir, 'nested', 'Beta.md'), '# Beta nested\n\n[[Alpha]]\n');

  const result = await buildGraph(vaultDir, outFile);

  // Should produce 3 nodes, not crash
  assert(result.nodes.length === 3, `expected 3 nodes, got ${result.nodes.length}`);

  // Alpha stays short since it's unique
  const ids = result.nodes.map(n => n.id).sort();
  assert(ids.includes('Alpha'), 'expected unique basename to keep short id');

  // Both Betas should have folder-prefixed IDs
  assert(ids.some(id => id === 'Beta' || id.endsWith('/Beta')) === false || ids.filter(id => id === 'Beta' || id.includes('Beta')).length === 2,
    'expected both Beta notes to appear as nodes');
  const betaIds = ids.filter(id => id.includes('Beta'));
  assert(betaIds.length === 2, `expected 2 Beta nodes, got ${betaIds.length}`);
  assert(betaIds.every(id => id.includes('/')), 'expected duplicate basenames to use folder/basename IDs');

  // [[Beta]] in Alpha.md should link to BOTH Betas
  const alphaLinks = result.links.filter(l => l.source === 'Alpha');
  assert(alphaLinks.length === 2, `expected Alpha to link to both Betas, got ${alphaLinks.length} links`);

  // Both Betas link back to Alpha
  const betaToAlpha = result.links.filter(l => l.target === 'Alpha' && l.source !== 'Alpha');
  assert(betaToAlpha.length === 2, `expected both Betas to link to Alpha, got ${betaToAlpha.length}`);

  // Duplicate nodes should have a label field with the short basename
  const betaNodes = result.nodes.filter(n => n.id.includes('Beta'));
  assert(betaNodes.every(n => n.label === 'Beta'), 'expected duplicate nodes to have label field');

  // Alpha should NOT have a label field (id is already the basename)
  const alphaNode = result.nodes.find(n => n.id === 'Alpha');
  assert(alphaNode.label === undefined, 'expected unique nodes to omit label field');

  // graph.json should be valid
  const stored = JSON.parse(fs.readFileSync(outFile, 'utf8'));
  assert(stored.nodes.length === 3, 'expected graph.json to contain all 3 nodes');
}

async function runGhostNodes(tmpRoot) {
  const vaultDir = path.join(tmpRoot, 'ghost-vault');
  const outFile = path.join(tmpRoot, 'ghost-graph.json');

  writeFile(path.join(vaultDir, 'Alpha.md'), '# Alpha\n\n[[Beta]]\n[[Nonexistent]]\n[[Also Missing]]\n');
  writeFile(path.join(vaultDir, 'Beta.md'), '# Beta\n\n[[Nonexistent]]\n');

  // With showUnresolvedLinks on
  const withGhosts = await buildGraph(vaultDir, outFile, { showUnresolvedLinks: true });
  assert(withGhosts.nodes.length === 4, `expected 4 nodes (2 real + 2 ghost), got ${withGhosts.nodes.length}`);
  const ghosts = withGhosts.nodes.filter(n => n.ghost);
  assert(ghosts.length === 2, `expected 2 ghost nodes, got ${ghosts.length}`);
  assert(ghosts.some(n => n.id === 'Nonexistent'), 'expected Nonexistent ghost node');
  assert(ghosts.some(n => n.id === 'Also Missing'), 'expected Also Missing ghost node');

  // Both Alpha and Beta link to Nonexistent
  const toNonexistent = withGhosts.links.filter(l => l.target === 'Nonexistent');
  assert(toNonexistent.length === 2, `expected 2 links to Nonexistent, got ${toNonexistent.length}`);

  // Only Alpha links to Also Missing
  const toAlsoMissing = withGhosts.links.filter(l => l.target === 'Also Missing');
  assert(toAlsoMissing.length === 1, `expected 1 link to Also Missing, got ${toAlsoMissing.length}`);

  // With showUnresolvedLinks off — no ghosts
  const withoutGhosts = await buildGraph(vaultDir, outFile, { showUnresolvedLinks: false });
  assert(withoutGhosts.nodes.length === 2, `expected 2 nodes without ghosts, got ${withoutGhosts.nodes.length}`);
  assert(withoutGhosts.nodes.every(n => !n.ghost), 'expected no ghost nodes when disabled');
  // Only Alpha->Beta link (Beta has no real targets)
  assert(withoutGhosts.links.length === 1, `expected 1 link without ghosts, got ${withoutGhosts.links.length}`);
}

async function runConfigPatch(tmpRoot) {
  const vaultDir = path.join(tmpRoot, 'config-patch-vault');
  const outFile = path.join(tmpRoot, 'config-patch-graph.json');
  const configPath = path.join(tmpRoot, 'config-patch-config.json');

  writeFile(path.join(vaultDir, 'Alpha.md'), '# Alpha\n\n[[Beta]]\n[[Ghost]]\n');
  writeFile(path.join(vaultDir, 'Beta.md'), '# Beta\n\n');

  const cfg = sanitizePersistedConfig({
    vaultPath: vaultDir,
    port: 4311,
    accent: '#7c5cff',
    background: '#0a0a0f',
    refreshMs: 1000,
    linkOpacity: 0.18,
    nodeGlow: true,
    particles: true,
    particleSpeed: 1,
    particleDensity: 0.3,
    motionMode: 'balanced',
    clusterByTag: true,
    clusterHalos: true,
    backgroundGradient: true,
    hubLabels: false,
    hubLabelCount: 5,
    labelMinImportance: 0.22,
    edgeColoring: true,
    depthOfField: true,
    noteFlare: true,
    autoScaleLargeVaults: true,
    showUnresolvedLinks: true
  });

  writeJson(configPath, cfg);

  const entries = await scanVaultEntries(vaultDir);
  const state = {
    cfg,
    configPath,
    outPath: outFile,
    entries,
    graphJson: '',
    graphVersion: 0,
    discoveredTags: {}
  };

  const handler = createRequestHandler(state);
  const postHeaders = { 'content-type': 'application/json', host: '127.0.0.1:3000' };

  // DNS-rebinding guard: an untrusted Host header must be rejected before
  // anything else is even considered, regardless of an otherwise-valid body.
  const untrustedHostRes = await runHandler(handler, 'POST', '/api/config',
    JSON.stringify({ hubLabels: true }), { 'content-type': 'application/json', host: 'evil.example.com' });
  assert(untrustedHostRes.statusCode === 403, `expected 403 for an untrusted Host header, got ${untrustedHostRes.statusCode}`);

  // Valid patch: hubLabels + hubLabelCount
  const validRes = await runHandler(handler, 'POST', '/api/config',
    JSON.stringify({ hubLabels: true, hubLabelCount: 9 }), postHeaders);
  assert(validRes.statusCode === 200, `expected 200 from valid config patch, got ${validRes.statusCode}`);
  const updatedConfig = JSON.parse(validRes.body);
  assert(updatedConfig.hubLabels === true, 'expected hubLabels to be true after patch');
  assert(updatedConfig.hubLabelCount === 9, 'expected hubLabelCount to be 9 after patch');

  // Invalid JSON body
  const badJsonRes = await runHandler(handler, 'POST', '/api/config', '{ bad json }', postHeaders);
  assert(badJsonRes.statusCode === 400, `expected 400 for invalid JSON, got ${badJsonRes.statusCode}`);

  // Unknown config key
  const unknownKeyRes = await runHandler(handler, 'POST', '/api/config',
    JSON.stringify({ vaultPath: '/evil' }), postHeaders);
  assert(unknownKeyRes.statusCode === 400, `expected 400 for unknown key, got ${unknownKeyRes.statusCode}`);
  const unknownKeyError = JSON.parse(unknownKeyRes.body);
  assert(
    unknownKeyError.error && unknownKeyError.error.includes('unknown config key'),
    `expected "unknown config key" error, got: ${unknownKeyError.error}`
  );

  // Wrong type
  const wrongTypeRes = await runHandler(handler, 'POST', '/api/config',
    JSON.stringify({ hubLabels: 'yes' }), postHeaders);
  assert(wrongTypeRes.statusCode === 400, `expected 400 for wrong type, got ${wrongTypeRes.statusCode}`);

  // Wrong Content-Type header
  const wrongCtRes = await runHandler(handler, 'POST', '/api/config',
    JSON.stringify({ hubLabels: true }), { 'content-type': 'text/plain', host: '127.0.0.1:3000' });
  assert(wrongCtRes.statusCode === 415, `expected 415 for wrong Content-Type, got ${wrongCtRes.statusCode}`);

  // Missing Content-Type header (no content-type key, but still a trusted host)
  const noCtRes = await runHandler(handler, 'POST', '/api/config',
    JSON.stringify({ hubLabels: true }), { host: '127.0.0.1:3000' });
  assert(noCtRes.statusCode === 415, `expected 415 for missing Content-Type, got ${noCtRes.statusCode}`);

  // GAP 4: showUnresolvedLinks toggle triggers full rebuild
  const versionBefore = state.graphVersion;
  const toggleRes = await runHandler(handler, 'POST', '/api/config',
    JSON.stringify({ showUnresolvedLinks: false }), postHeaders);
  assert(toggleRes.statusCode === 200,
    `expected 200 from showUnresolvedLinks toggle, got ${toggleRes.statusCode}`);
  assert(state.graphVersion > versionBefore,
    `expected graphVersion to increment after showUnresolvedLinks toggle (was ${versionBefore}, now ${state.graphVersion})`);
  const graphData = JSON.parse(state.graphJson);
  assert(
    !graphData.nodes.some(n => n.ghost),
    'expected no ghost nodes in graphJson after showUnresolvedLinks: false'
  );
}

async function runIncrementalWatcher(tmpRoot) {
  const vaultDir = path.join(tmpRoot, 'watcher-vault');

  // Step 1: set up initial vault (Alpha links to Beta)
  writeFile(path.join(vaultDir, 'Alpha.md'), '# Alpha\n\n[[Beta]]\n');
  writeFile(path.join(vaultDir, 'Beta.md'), '# Beta\n\n');

  // Step 2: scan and materialize initial state
  const entries = await scanVaultEntries(vaultDir);
  materializeGraph(entries, vaultDir, { showUnresolvedLinks: false });

  // Step 3: build minimal state object
  const state = {
    cfg: { vaultPath: vaultDir, showUnresolvedLinks: false },
    entries,
    graphJson: '',
    graphVersion: 0
  };

  // Step 4: write Gamma.md (links to Alpha)
  const gammaPath = path.join(vaultDir, 'Gamma.md');
  writeFile(gammaPath, '# Gamma\n\n[[Alpha]]\n');

  // Step 5: apply 'add' event
  const addedGamma = await applyFsEventToState(state, 'add', gammaPath);
  assert(addedGamma === true, `expected applyFsEventToState to return true for add, got ${addedGamma}`);

  // Step 6: rebuild — 3 nodes
  const result3 = await rebuildGraphState(state, { writeToDisk: false });
  assert(result3.nodes.length === 3, `expected 3 nodes after adding Gamma, got ${result3.nodes.length}`);

  // Step 7: delete Alpha.md from disk
  const alphaPath = path.join(vaultDir, 'Alpha.md');
  fs.unlinkSync(alphaPath);

  // Step 8: apply 'unlink' event
  const unlinkedAlpha = await applyFsEventToState(state, 'unlink', alphaPath);
  assert(unlinkedAlpha === true, `expected applyFsEventToState to return true for unlink, got ${unlinkedAlpha}`);

  // Step 9: rebuild — 2 nodes (Gamma + Beta)
  const result2 = await rebuildGraphState(state, { writeToDisk: false });
  assert(result2.nodes.length === 2, `expected 2 nodes after removing Alpha, got ${result2.nodes.length}`);

  // Step 10: unlinkDir — add a subdirectory note, confirm it appears, then remove the dir
  const subdirPath = path.join(vaultDir, 'subdir');
  const deltaPath = path.join(subdirPath, 'Delta.md');
  writeFile(deltaPath, '# Delta\n\n');

  const addedDelta = await applyFsEventToState(state, 'add', deltaPath);
  assert(addedDelta === true, `expected applyFsEventToState to return true for adding Delta, got ${addedDelta}`);

  const result3b = await rebuildGraphState(state, { writeToDisk: false });
  assert(result3b.nodes.length === 3, `expected 3 nodes after adding Delta, got ${result3b.nodes.length}`);

  fs.rmSync(subdirPath, { recursive: true });

  const removedDir = await applyFsEventToState(state, 'unlinkDir', subdirPath);
  assert(removedDir === true, `expected applyFsEventToState to return true for unlinkDir, got ${removedDir}`);
  assert(!state.entries.has(deltaPath), 'expected Delta to be removed from entries after unlinkDir');

  // Regression: a sibling directory that merely shares vaultDir's string prefix
  // (e.g. vaultDir "watcher-vault" vs "watcher-vault-sibling") must not be
  // treated as inside the vault by a naive startsWith(vaultPath) check.
  const siblingPath = path.join(vaultDir + '-sibling', 'Evil.md');
  const siblingResult = await applyFsEventToState(state, 'add', siblingPath);
  assert(siblingResult === false, 'expected sibling-directory path to be rejected as outside the vault');
}

async function runDocsRouteGuard() {
  const state = { cfg: { vaultPath: '/unused' } };
  const handler = createRequestHandler(state);

  // A real docs asset must be servable.
  const okRes = await runHandler(handler, 'GET', '/docs/perf-roadmap.md');
  assert(okRes.statusCode === 200, `expected 200 for a real docs asset, got ${okRes.statusCode}`);

  // Traversal attempts must not escape the docs directory and reach arbitrary
  // project files. (The WHATWG URL parser already collapses ".." segments in
  // req.url before the handler ever sees `url`, and the /docs/ handler's own
  // containment check backs that up — this asserts the endpoint as a whole
  // can't be used to read files outside docs/, regardless of which layer stops it.)
  const traversalRes = await runHandler(handler, 'GET', '/docs/../parser.js');
  assert(traversalRes.statusCode === 404, `expected 404 for a docs traversal attempt, got ${traversalRes.statusCode}`);

  const traversalRes2 = await runHandler(handler, 'GET', '/docs/../../etc/passwd');
  assert(traversalRes2.statusCode === 404, `expected 404 for a deep docs traversal attempt, got ${traversalRes2.statusCode}`);

  // A disallowed extension within docs/ must be rejected even if the path is otherwise valid.
  const disallowedExtRes = await runHandler(handler, 'GET', '/docs/perf-roadmap.js');
  assert(disallowedExtRes.statusCode === 404, `expected 404 for a disallowed docs extension, got ${disallowedExtRes.statusCode}`);

  // Nonexistent file within docs/ must 404, not throw.
  const missingRes = await runHandler(handler, 'GET', '/docs/does-not-exist.png');
  assert(missingRes.statusCode === 404, `expected 404 for a missing docs file, got ${missingRes.statusCode}`);
}

async function run413BodyTooLarge(tmpRoot) {
  const vaultDir = path.join(tmpRoot, 'body-limit-vault');
  writeFile(path.join(vaultDir, 'A.md'), '# A\n');
  const cfg = sanitizePersistedConfig({ vaultPath: vaultDir });
  const state = {
    cfg,
    configPath: path.join(tmpRoot, 'body-limit-config.json'),
    outPath: path.join(tmpRoot, 'body-limit-graph.json'),
    discoveredTags: {},
    graphJson: '',
    graphVersion: 0
  };
  const handler = createRequestHandler(state);

  const oversized = JSON.stringify({ note: 'x'.repeat(1_100_000) });
  const res = await runHandler(handler, 'POST', '/api/config', oversized, { 'content-type': 'application/json', host: '127.0.0.1:3000' });
  assert(res.statusCode === 413, `expected 413 for an oversized request body, got ${res.statusCode}`);
  const body = JSON.parse(res.body);
  assert(/too large/.test(body.error), `expected a "too large" error message, got: ${body.error}`);
}

function runPresetsValidateAgainstSchema() {
  // Regression: presets.json shipped two presets (Crystalline, Library) with
  // motionMode: "still", a value the server's sanitizeConfigPatch rejected
  // (MOTION_MODES didn't include it) even though it's exactly what the
  // settings page POSTs when a user picks a preset — so clicking either
  // preset threw a 400 and applied nothing. Validate every preset's config
  // against the same sanitizer used by the live server so a shipped preset
  // can never be broken like this again.
  const presets = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'presets.json'), 'utf8'));
  assert(presets.length > 0, 'expected presets.json to contain at least one preset');
  for (const preset of presets) {
    try {
      sanitizeConfigPatch(preset.config);
    } catch (e) {
      throw new Error(`preset "${preset.name}" has an invalid config: ${e.message}`, { cause: e });
    }
  }
}

function runConfigExampleValidatesAgainstSchema(tmpRoot) {
  // Regression: config.example.json is what every install guide tells users to
  // `cp` into config.json — it must actually validate against the real schema.
  const raw = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'config.example.json'), 'utf8'));
  raw.vaultPath = tmpRoot; // the example's placeholder path doesn't exist on this machine
  sanitizePersistedConfig(raw);
}

function runIgnorePathsUnit() {
  const vaultPath = '/vault';
  const patterns = ['.obsidian', 'templates'];
  assert(isIgnoredPath(path.join(vaultPath, '.obsidian', 'config'), vaultPath, patterns) === true,
    'expected a top-level ignored folder to be ignored');
  assert(isIgnoredPath(path.join(vaultPath, 'templates', 'Daily.md'), vaultPath, patterns) === true,
    'expected a nested file under an ignored folder to be ignored');
  assert(isIgnoredPath(path.join(vaultPath, 'notes', 'Alpha.md'), vaultPath, patterns) === false,
    'expected a normal note to not be ignored');
  assert(isIgnoredPath(path.join(vaultPath, 'sub', 'templates', 'x.md'), vaultPath, patterns) === true,
    'expected an ignored folder name to match at any depth');
}

async function runIgnorePathsIntegration(tmpRoot) {
  const vaultDir = path.join(tmpRoot, 'ignore-vault');
  writeFile(path.join(vaultDir, 'Alpha.md'), '# Alpha\n');
  writeFile(path.join(vaultDir, 'templates', 'Template.md'), '# Template\n');
  writeFile(path.join(vaultDir, '.obsidian', 'workspace.md'), '# not a real note, just proving the folder is skipped\n');

  const entries = await scanVaultEntries(vaultDir, ['templates', '.obsidian']);
  const basenames = Array.from(entries.values()).map(e => e.basename).sort();
  assert(basenames.length === 1 && basenames[0] === 'Alpha',
    `expected only Alpha to survive ignorePaths filtering, got [${basenames.join(', ')}]`);
}

// A vault that lives under a dot-folder (~/.vaults/x) must still live-update,
// while dot-folders *inside* the vault (.obsidian, .trash) stay ignored.
async function runLiveWatcherDotAncestor(tmpRoot) {
  const vaultDir = path.join(tmpRoot, '.hidden-parent', 'vault');
  writeFile(path.join(vaultDir, 'Alpha.md'), '# Alpha\n');
  fs.mkdirSync(path.join(vaultDir, '.obsidian'), { recursive: true });
  const configPath = path.join(tmpRoot, 'dotparent-config.json');
  writeJson(configPath, { vaultPath: vaultDir, port: await freePort() });
  const app = await startApp({ configPath, outPath: path.join(tmpRoot, 'dotparent-graph.json') });
  const waitForVersion = async (above, timeoutMs) => {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (app.state.graphVersion > above) return true;
      await new Promise(r => setTimeout(r, 100));
    }
    return false;
  };
  try {
    await new Promise((resolve, reject) => {
      app.watcher.once('ready', resolve);
      setTimeout(() => reject(new Error('watcher never became ready')), 5000);
    });
    await new Promise(r => setTimeout(r, 300));
    let before = app.state.graphVersion;
    writeFile(path.join(vaultDir, 'Beta.md'), '# Beta\n[[Alpha]]\n');
    assert(await waitForVersion(before, 4000), 'expected live updates for a vault under a dot-folder');
    before = app.state.graphVersion;
    writeFile(path.join(vaultDir, '.obsidian', 'Hidden.md'), '# Hidden\n');
    assert(!(await waitForVersion(before, 1200)), 'expected dot-folders inside the vault to stay ignored');

    // Two overlapping ignorePaths rescans run one after the other and leave
    // exactly one live watcher behind.
    await Promise.all([app.state.onIgnorePathsChanged(), app.state.onIgnorePathsChanged()]);
    await new Promise((resolve, reject) => {
      app.watcher.once('ready', resolve);
      setTimeout(() => reject(new Error('watcher never became ready after rescans')), 5000);
    });
    await new Promise(r => setTimeout(r, 300));
    before = app.state.graphVersion;
    writeFile(path.join(vaultDir, 'Gamma.md'), '# Gamma\n');
    assert(await waitForVersion(before, 4000), 'expected live updates to keep working after overlapping rescans');
  } finally {
    process.removeAllListeners('SIGINT');
    process.removeAllListeners('SIGTERM');
    await app.watcher.close();
    await app.configWatcher.close();
    await new Promise(r => app.server.close(r));
  }
}

// Exercises the real chokidar watcher (not just applyFsEventToState): with a
// non-empty ignorePaths, the ignore callback used to fire on the vault root
// itself and silently disable every live update. Also covers directories with
// a dot in the name, which the old extension regex kept chokidar from entering.
async function runLiveWatcherWithIgnorePaths(tmpRoot) {
  const vaultDir = path.join(tmpRoot, 'live-vault');
  writeFile(path.join(vaultDir, 'Alpha.md'), '# Alpha\n');
  writeFile(path.join(vaultDir, 'templates', 'Template.md'), '# Template\n');
  fs.mkdirSync(path.join(vaultDir, 'notes.v2'), { recursive: true });
  const configPath = path.join(tmpRoot, 'live-config.json');
  writeJson(configPath, { vaultPath: vaultDir, port: await freePort(), ignorePaths: ['templates', '.obsidian'] });

  const app = await startApp({ configPath, outPath: path.join(tmpRoot, 'live-graph.json') });
  const waitForVersion = async (above, timeoutMs) => {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (app.state.graphVersion > above) return true;
      await new Promise(r => setTimeout(r, 100));
    }
    return false;
  };
  try {
    await new Promise((resolve, reject) => {
      app.watcher.once('ready', resolve);
      setTimeout(() => reject(new Error('watcher never became ready')), 5000);
    });
    // macOS FSEvents can drop a file created in the first moments after
    // 'ready'; give the native watcher a beat so the test checks behaviour,
    // not that startup race.
    await new Promise(r => setTimeout(r, 300));

    let before = app.state.graphVersion;
    writeFile(path.join(vaultDir, 'Beta.md'), '# Beta\n[[Alpha]]\n');
    assert(await waitForVersion(before, 4000),
      'expected a new top-level note to bump graphVersion via the live watcher when ignorePaths is set');

    before = app.state.graphVersion;
    writeFile(path.join(vaultDir, 'notes.v2', 'Gamma.md'), '# Gamma\n');
    assert(await waitForVersion(before, 4000),
      'expected a note inside a dot-named directory (notes.v2) to be watched');

    before = app.state.graphVersion;
    writeFile(path.join(vaultDir, 'templates', 'Ignored.md'), '# Ignored\n');
    assert(!(await waitForVersion(before, 1200)),
      'expected a note under an ignorePaths folder to NOT bump graphVersion');
  } finally {
    process.removeAllListeners('SIGINT');
    process.removeAllListeners('SIGTERM');
    await app.watcher.close();
    await app.configWatcher.close();
    await new Promise(r => app.server.close(r));
  }
}

async function runSymlinkCycleGuard(tmpRoot) {
  const vaultDir = path.join(tmpRoot, 'symlink-vault');
  writeFile(path.join(vaultDir, 'Alpha.md'), '# Alpha\n');
  const loopDir = path.join(vaultDir, 'loop');
  fs.mkdirSync(loopDir, { recursive: true });
  // A symlink inside the vault that points back to an ancestor directory —
  // without cycle protection, the recursive walk would recurse forever.
  try {
    fs.symlinkSync(vaultDir, path.join(loopDir, 'back-to-root'), 'dir');
  } catch (e) {
    console.log(`note: skipping symlink-cycle test (symlinks unavailable: ${e.message})`);
    return;
  }

  const entries = await scanVaultEntries(vaultDir);
  assert(entries.size === 1, `expected the symlink cycle to be short-circuited with only Alpha found, got ${entries.size}`);
}

async function runEaddrinuse(tmpRoot) {
  const port = await new Promise((resolve, reject) => {
    const blocker = net.createServer();
    blocker.listen(0, '127.0.0.1', () => {
      const p = blocker.address().port;
      // Keep the port held for the duration of the child process attempt below.
      blocker.unref();
      resolve(p);
    });
    blocker.on('error', reject);
  });

  const vaultDir = path.join(tmpRoot, 'eaddrinuse-vault');
  writeFile(path.join(vaultDir, 'A.md'), '# A\n');
  const configPath = path.join(tmpRoot, 'eaddrinuse-config.json');
  writeJson(configPath, { vaultPath: vaultDir, port });

  // Run in a child process: startApp()'s EADDRINUSE handler calls
  // process.exit(1) directly, which would kill the test runner itself if
  // invoked in-process.
  const child = spawn(process.execPath, [
    '-e',
    "require(process.argv[1]).startApp({ configPath: process.argv[2] }).catch(() => {});",
    path.join(__dirname, '..', 'parser.js'),
    configPath
  ]);
  let stderr = '';
  child.stderr.on('data', chunk => { stderr += chunk; });
  const exitCode = await new Promise(resolve => child.on('exit', resolve));

  assert(exitCode === 1, `expected the child process to exit(1) on EADDRINUSE, got ${exitCode}`);
  assert(/already in use/.test(stderr), `expected an "already in use" message on stderr, got: ${stderr}`);
  // npm start doesn't parse --port, so the hint must not suggest it there.
  assert(!/--port/.test(stderr), `expected no --port hint outside the CLI, got: ${stderr}`);
}

// A second launch while our own server holds the port exits 0 with a note,
// instead of failing (launchd/Task Scheduler + a manual start is common).
async function runEaddrinuseOwnInstance(tmpRoot) {
  const fake = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ app: 'obsidian-live-wallpaper', graphVersion: 1, configVersion: 1 }));
  });
  const port = await new Promise(resolve => fake.listen(0, '127.0.0.1', () => resolve(fake.address().port)));
  try {
    const vaultDir = path.join(tmpRoot, 'eaddrinuse-own-vault');
    writeFile(path.join(vaultDir, 'A.md'), '# A\n');
    const configPath = path.join(tmpRoot, 'eaddrinuse-own-config.json');
    writeJson(configPath, { vaultPath: vaultDir, port });
    const child = spawn(process.execPath, [
      '-e',
      "require(process.argv[1]).startApp({ configPath: process.argv[2] }).catch(() => {});",
      path.join(__dirname, '..', 'parser.js'),
      configPath
    ]);
    let stdout = '';
    child.stdout.on('data', chunk => { stdout += chunk; });
    const exitCode = await new Promise(resolve => child.on('exit', resolve));
    assert(exitCode === 0, `expected exit(0) when our own instance holds the port, got ${exitCode}`);
    assert(/already running/.test(stdout), `expected an "already running" note, got: ${stdout}`);
  } finally {
    fake.close();
  }
}

function runRendererCore() {
  // Pure helpers shared with the renderer.
  assert(core.clamp(5, 0, 3) === 3 && core.clamp(-1, 0, 3) === 0 && core.clamp(2, 0, 3) === 2, 'clamp bounds');
  assert(core.truncateLabel('hello', 10) === 'hello', 'truncateLabel short unchanged');
  assert(core.truncateLabel('abcdefghij', 5) === 'abcd…', 'truncateLabel truncates with ellipsis');
  assert(core.mixChannel(0, 100, 0.5) === 50, 'mixChannel midpoint');
  assert(core.mixChannel(10, 20, 0) === 10 && core.mixChannel(10, 20, 1) === 20, 'mixChannel endpoints');
  assert(core.hashStr('') === 0, 'hashStr empty is 0');
  assert(core.hashStr('abc') === core.hashStr('abc'), 'hashStr deterministic');
  assert(core.hashStr('abc') !== core.hashStr('abd'), 'hashStr differs for different input');
  assert(/^#[0-9a-f]{6}$/.test(core.hslToHex(210, 60, 64)), 'hslToHex returns a 6-digit hex');
  assert(core.hslToHex(0, 0, 0) === '#000000' && core.hslToHex(0, 0, 100) === '#ffffff', 'hslToHex black/white');

  const g1 = { nodes: [{ id: 'a' }, { id: 'b' }], links: [{ source: 'a', target: 'b' }] };
  const g2 = { nodes: [{ id: 'a' }, { id: 'b' }], links: [{ source: 'a', target: 'b' }] };
  const g3 = { nodes: [{ id: 'a' }, { id: 'c' }], links: [{ source: 'a', target: 'c' }] };
  assert(core.graphHashFast(g1) === core.graphHashFast(g2), 'graphHashFast stable for identical graphs');
  assert(core.graphHashFast(g1) !== core.graphHashFast(g3), 'graphHashFast differs for different graphs');
  assert(core.graphHashSlow(g1) === core.graphHashSlow(g2), 'graphHashSlow stable for identical graphs');
  // Object-form links (source/target resolved to node refs) hash the same as string-form.
  const g1obj = { nodes: g1.nodes, links: [{ source: { id: 'a' }, target: { id: 'b' } }] };
  assert(core.graphHashFast(g1obj) === core.graphHashFast(g1), 'graphHashFast handles object link refs');

  // Regression: graphHashFast used to sample only the first/last 16 node ids,
  // so renaming a link-less node in the middle of a larger graph produced an
  // identical hash and the renderer never redrew. 40 nodes puts index 20
  // squarely outside that old sampling window on both ends.
  const bigNodesA = Array.from({ length: 40 }, (_, i) => ({ id: `n${i}` }));
  const bigNodesB = bigNodesA.map((n, i) => (i === 20 ? { id: 'renamed' } : n));
  const gBigA = { nodes: bigNodesA, links: [] };
  const gBigB = { nodes: bigNodesB, links: [] };
  assert(core.graphHashFast(gBigA) !== core.graphHashFast(gBigB),
    'graphHashFast must detect a rename of a middle node in a large graph');
}

function runConfigValidationThrows() {
  // sanitizePersistedConfig must throw (not process.exit) on invalid input, so that
  // live-reload callers (parser.js reloadConfigFromDisk) can catch and log-and-ignore a
  // bad hand-edit to config.json instead of crashing the running server. Regression
  // test for a bug where requireString called failConfig() -> process.exit() directly.
  let threw = false;
  try {
    sanitizePersistedConfig({ vaultPath: '' });
  } catch (e) {
    threw = true;
    assert(/vaultPath/.test(e.message), 'expected vaultPath validation error message');
  }
  assert(threw, 'expected sanitizePersistedConfig to throw on blank vaultPath, not exit');

  threw = false;
  try {
    sanitizePersistedConfig({});
  } catch (e) {
    threw = true;
  }
  assert(threw, 'expected sanitizePersistedConfig to throw when vaultPath is missing');

  threw = false;
  try {
    sanitizePersistedConfig('not an object');
  } catch (e) {
    threw = true;
  }
  assert(threw, 'expected sanitizePersistedConfig to throw on non-object root');
}

function runParserFuzz() {
  // extractTag: frontmatter flow, block, and inline forms; inline tags with slashes.
  assert(extractTag('---\ntags: [project, idea]\n---\nbody') === 'project', 'flow frontmatter tag');
  assert(extractTag('---\ntags:\n  - alpha\n  - beta\n---\n') === 'alpha', 'block frontmatter tag');
  assert(extractTag('no frontmatter but #inline here') === 'inline', 'inline tag');
  assert(extractTag('nested #area/sub tag') === 'area/sub', 'nested inline tag keeps slash');
  assert(extractTag('plain text, no tags at all') === null, 'no tag returns null');
  assert(extractTag('email like a#b should not count as tag mid-word') === null, 'no leading-space tag is ignored');

  // extractWikilinks: plain, aliased, heading, dedupe of forms, ignore empties.
  assert(JSON.stringify(extractWikilinks('see [[Note A]] and [[Note B]]')) === JSON.stringify(['Note A', 'Note B']), 'plain wikilinks');
  assert(extractWikilinks('[[Target|alias text]]')[0] === 'Target', 'aliased wikilink uses target');
  assert(extractWikilinks('[[Target#Heading]]')[0] === 'Target', 'heading wikilink uses target');
  assert(extractWikilinks('[[  ]] and [[ Real ]]').length === 1, 'empty wikilink ignored, whitespace trimmed');
  assert(extractWikilinks('no links here').length === 0, 'no wikilinks');
}


function runNewParserFeatures() {
  // All tags are kept, frontmatter first, then inline.
  assert(JSON.stringify(extractTags('---\ntags: [project, idea]\n---\nbody #extra')) === JSON.stringify(['project', 'idea', 'extra']), 'extractTags keeps every tag in order');
  assert(JSON.stringify(extractTags('---\ntags:\n  - a\n  - b\n---\n')) === JSON.stringify(['a', 'b']), 'extractTags block list');
  // Attachments and embeds of non-notes are not links; .md suffix is stripped.
  assert(extractWikilinks('![[photo.png]] [[scan.pdf]] ![[Other Note]] [[Note.md]]').join('|') === 'Other Note|Note',
    `expected attachments skipped and .md stripped, got ${extractWikilinks('![[photo.png]] [[scan.pdf]] ![[Other Note]] [[Note.md]]').join('|')}`);
  // Parity with Obsidian: nothing inside code counts.
  const code = 'real [[A]] #keep\n```\n[[InFence]] #nope\n```\n~~~js\n[[Tilde]]\n~~~\ninline `[[Inline]] #nope2` done\n';
  assert(extractWikilinks(code).join('|') === 'A', `code links ignored, got ${extractWikilinks(code).join('|')}`);
  assert(extractTags(code).join('|') === 'keep', `code tags ignored, got ${extractTags(code).join('|')}`);
  assert(extractWikilinks('```\n[[Unclosed]]\nstill code').length === 0, 'an unclosed fence runs to the end');
  // Markdown links to notes count; URLs, headings and attachments don't.
  const md = '[a](Note%20One.md) [b](<Folder/Two.md>) [c](../Three.md#Part "t") [d](https://x.com/y.md) [e](#local) ![f](pic.png) [g](Four)';
  assert(extractWikilinks(md).join('|') === 'Note One|Folder/Two|Three|Four', `markdown links, got ${extractWikilinks(md).join('|')}`);
  // Tags: any letter, digits allowed if not all digits, tag:/string forms.
  assert(extractTags('x #café #日本 #2024-review #2024 #y1984').join('|') === 'café|日本|2024-review|y1984',
    `unicode/digit tags, got ${extractTags('x #café #日本 #2024-review #2024 #y1984').join('|')}`);
  assert(extractTags('---\ntag: solo\n---\n').join('|') === 'solo', 'singular tag: key');
  assert(extractTags('---\ntags: a, b c\n---\n').join('|') === 'a|b|c', `string tags, got ${extractTags('---\ntags: a, b c\n---\n').join('|')}`);
  assert(extractTags('heading\n# Title\n').length === 0, 'a heading is not a tag');
  const ex = noteExcerpt('---\ntags: [x]\n---\n# Title\nSome **bold** text with [[Link|alias]] and [web](http://x).\n');
  assert(/Some bold text with alias and web/.test(ex), `noteExcerpt strips markdown, got: ${ex}`);
}

async function runLinkResolution(tmpRoot) {
  const vaultDir = path.join(tmpRoot, 'resolve-vault');
  writeFile(path.join(vaultDir, 'Alpha.md'), '---\ntags: [project, idea]\n---\n[[beta]] [[Sub/Gamma]] ![[pic.png]]\n');
  writeFile(path.join(vaultDir, 'Beta.md'), '#idea\n');
  writeFile(path.join(vaultDir, 'Sub', 'Gamma.md'), 'x\n');
  const entries = await scanVaultEntries(vaultDir);
  const g = materializeGraph(entries, vaultDir, { showUnresolvedLinks: true });
  const ghosts = g.nodes.filter(n => n.ghost).map(n => n.id);
  assert(ghosts.length === 0, `expected no false ghosts from case/path/embed links, got [${ghosts.join(', ')}]`);
  assert(g.links.length === 2, `expected 2 resolved links, got ${g.links.length}`);
  assert(g.discoveredTags.idea === 2 && g.discoveredTags.project === 1, `expected every tag counted, got ${JSON.stringify(g.discoveredTags)}`);
  const alpha = g.nodes.find(n => n.id === 'Alpha');
  assert(alpha.tag === 'project' && alpha.tags.length === 2, 'expected primary tag plus full tag list');

  // Tags are case-insensitive across the vault; the first spelling wins.
  const caseDir = path.join(tmpRoot, 'tagcase-vault');
  writeFile(path.join(caseDir, 'A.md'), '#Project\n');
  writeFile(path.join(caseDir, 'B.md'), '#project #PROJECT\n');
  const cg = materializeGraph(await scanVaultEntries(caseDir), caseDir, {});
  assert(JSON.stringify(cg.discoveredTags) === JSON.stringify({ Project: 2 }), `expected one merged tag, got ${JSON.stringify(cg.discoveredTags)}`);
}

function runIndexDefaultsMatchParser() {
  // index.html keeps a fallback DEFAULTS copy for synthetic/offline mode; it
  // must not drift from the canonical parser.js DEFAULTS.
  const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  const m = html.match(/const DEFAULTS = (\{[\s\S]*?\n\});/);
  assert(m, 'expected a DEFAULTS literal in index.html');
  const indexDefaults = new Function('return ' + m[1])();
  const { vaultPath, port, ...canonical } = DEFAULTS;
  const a = JSON.stringify(Object.keys(canonical).sort().map(k => [k, canonical[k]]));
  const b = JSON.stringify(Object.keys(indexDefaults).sort().map(k => [k, indexDefaults[k]]));
  assert(a === b, 'index.html DEFAULTS drifted from parser.js DEFAULTS');
}

function runThemesRegistry() {
  // Every discovered theme file must register itself under its file name, or
  // the validator would accept a theme the renderer can't draw.
  assert(THEME_LIST[0].id === 'default', 'default theme first');
  assert(THEME_LIST.length >= 17, `expected at least 17 themes, got ${THEME_LIST.length}`);
  for (const t of THEME_LIST.slice(1)) {
    const src = fs.readFileSync(path.join(__dirname, '..', 'themes', t.id + '.js'), 'utf8');
    const registers = src.includes(`THEMES['${t.id}']`) || (/^[a-z]+$/.test(t.id) && src.includes(`THEMES.${t.id} =`));
    assert(registers, `themes/${t.id}.js must register THEMES['${t.id}']`);
    assert(t.name && t.description, `themes/${t.id}.js needs @name and @description headers`);
  }
  // Every preset's theme must exist.
  const presets = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'presets.json'), 'utf8'));
  const ids = new Set(THEME_LIST.map(t => t.id));
  for (const p of presets) {
    assert(ids.has(p.config.theme || 'default'), `preset ${p.name} uses unknown theme ${p.config.theme}`);
    assert(!('tagColors' in p.config), `preset ${p.name} must not overwrite tagColors`);
  }
}

function runNewCoreHelpers() {
  assert(core.contrastRatio('#000000', '#ffffff') > 20, 'contrast black/white');
  const fixed = core.ensureContrast('#0a3d3d', '#020608', 1.8);
  assert(core.contrastRatio(fixed, '#020608') >= 1.8, 'ensureContrast raises a too-dark accent');
  assert(core.ensureContrast('#ffffff', '#000000', 1.8) === '#ffffff', 'ensureContrast leaves good contrast alone');
  assert(core.timeOfDayTint(23).phase === 'night' && core.timeOfDayTint(12) === null && core.timeOfDayTint(6).phase === 'dawn', 'timeOfDayTint phases');
  assert(core.configValueEqual({ a: 1, b: [1, 2] }, { b: [1, 2], a: 1.0004 }), 'configValueEqual structural with tolerance');
  assert(!core.configValueEqual({ a: 1 }, { a: 1, b: 2 }), 'configValueEqual key mismatch');
  assert(Object.values(core.PALETTES).every(p => p.length === 8), 'palettes have 8 colours');
  const [dx1] = core.flowOffset(100, 100, 5);
  const [dx2] = core.flowOffset(102, 101, 5);
  assert(Math.abs(dx1 - dx2) < 0.05, 'flowOffset is smooth: neighbours move together');
}

function runLayoutTargets() {
  const nodes = [];
  const links = [];
  for (let i = 0; i < 60; i++) nodes.push({ id: 'n' + i, tag: ['a', 'b', 'c'][i % 3], mtime: Date.now() - i * 86400000 });
  nodes.push({ id: 'ghost', ghost: true });
  for (let i = 1; i < 60; i++) links.push({ source: 'n' + i, target: 'n' + Math.floor(i / 2) });
  for (const layout of ['rings', 'timeline', 'galaxy']) {
    const t = layoutCore.computeTargets(layout, nodes, links, { width: 1200, height: 800, centerX: 600, centerY: 400 });
    assert(t && t.length === nodes.length * 2 && Array.from(t).every(Number.isFinite), `${layout} targets must be finite for every node`);
  }
  assert(layoutCore.computeTargets('force', nodes, links, {}) === null, 'force has no targets');
}

async function runNewRoutes(tmpRoot) {
  const vaultDir = path.join(tmpRoot, 'routes-vault');
  writeFile(path.join(vaultDir, 'Alpha.md'), '# Alpha\nThis is a longer body of text so the excerpt has something real in it. [[Beta]]\n');
  writeFile(path.join(vaultDir, 'Beta.md'), '# Beta\nAnother note with enough text to be chosen as note of the hour.\n');
  const configPath = path.join(tmpRoot, 'routes-config.json');
  writeJson(configPath, { vaultPath: vaultDir, port: 4321 });
  const state = {
    cfg: sanitizePersistedConfig({ vaultPath: vaultDir, port: 4321 }),
    configPath,
    outPath: path.join(tmpRoot, 'routes-graph.json'),
    entries: await scanVaultEntries(vaultDir)
  };
  await rebuildGraphState(state);
  const handler = createRequestHandler(state);
  const host = { host: '127.0.0.1:4321' };

  const themes = JSON.parse((await runHandler(handler, 'GET', '/api/themes')).body);
  assert(themes.some(t => t.id === 'aurora'), 'expected /api/themes to list discovered themes');

  const rebinding = await runHandler(handler, 'GET', '/api/note-of-hour?hour=123', undefined, { host: 'evil.example:4321' });
  assert(rebinding.statusCode === 403, 'note-of-hour must refuse untrusted Host headers (DNS rebinding)');
  // Reads that expose note names and tags get the same guard.
  for (const route of ['/graph.json', '/api/tags', '/api/config', '/events']) {
    const r = await runHandler(handler, 'GET', route, undefined, { host: 'evil.example:4321' });
    assert(r.statusCode === 403, `${route} must refuse untrusted Host headers, got ${r.statusCode}`);
  }
  const okHost = await runHandler(handler, 'GET', '/api/tags', undefined, { host: 'localhost:3000' });
  assert(okHost.statusCode === 200, `localhost Host must be accepted, got ${okHost.statusCode}`);
  const appState = JSON.parse((await runHandler(handler, "GET", "/api/state", undefined, host)).body);
  assert(appState.app === "obsidian-live-wallpaper", '/api/state must identify the app (used for own-instance detection)');
  const note = JSON.parse((await runHandler(handler, 'GET', '/api/note-of-hour?hour=123', undefined, host)).body);
  assert(note.title === 'Alpha' || note.title === 'Beta', `expected a note of the hour, got ${JSON.stringify(note)}`);
  assert(note.excerpt.length > 20 && !note.excerpt.includes('[['), 'expected a plain-text excerpt');

  const first = await runHandler(handler, 'GET', '/graph.json');
  const etag = first.headers && (first.headers.ETag || first.headers.etag);
  assert(etag, 'expected an ETag on /graph.json');
  const second = await runHandler(handler, 'GET', '/graph.json', undefined, { 'if-none-match': etag });
  assert(second.statusCode === 304, `expected 304 for an unchanged graph, got ${second.statusCode}`);

  const save = await runHandler(handler, 'POST', '/api/custom-presets', JSON.stringify({ name: 'Mine', config: { accent: '#112233', theme: 'metro' } }), { ...host, 'content-type': 'application/json' });
  assert(save.statusCode === 200, `expected custom preset save to succeed, got ${save.statusCode} ${save.body}`);
  const list = JSON.parse((await runHandler(handler, 'GET', '/api/custom-presets', undefined, host)).body);
  assert(list.length === 1 && list[0].config.theme === 'metro', 'expected the custom preset to persist');
  const bad = await runHandler(handler, 'POST', '/api/custom-presets', JSON.stringify({ name: 'Bad', config: { theme: 'nope' } }), { ...host, 'content-type': 'application/json' });
  assert(bad.statusCode === 400, 'expected an invalid custom preset to be rejected');
  const del = JSON.parse((await runHandler(handler, 'DELETE', '/api/custom-presets?name=Mine', undefined, host)).body);
  assert(del.length === 0, 'expected the custom preset to be deleted');

  // Layout cache: empty at first, round-trips, drops bad points, lands on disk.
  const jsonHost = { ...host, 'content-type': 'application/json' };
  const empty = JSON.parse((await runHandler(handler, 'GET', '/api/layout', undefined, host)).body);
  assert(!empty.positions, 'expected no saved layout yet');
  const savedLayout = await runHandler(handler, 'POST', '/api/layout',
    JSON.stringify({ layout: 'force', clusterByTag: true, width: 1280, height: 800, positions: { Alpha: [10.04, -5], Beta: [1, 2], Bad: ['x', 1], Inf: [1e9, 0] } }), jsonHost);
  assert(savedLayout.statusCode === 200 && JSON.parse(savedLayout.body).count === 2, `expected 2 valid positions saved, got ${savedLayout.body}`);
  const got = JSON.parse((await runHandler(handler, 'GET', '/api/layout', undefined, host)).body);
  assert(got.layout === 'force' && got.positions.Alpha[0] === 10 && !got.positions.Bad && !got.positions.Inf, `layout round-trip, got ${JSON.stringify(got)}`);
  const badLayout = await runHandler(handler, 'POST', '/api/layout', JSON.stringify({ layout: 'nope', width: 1, height: 1, positions: {} }), jsonHost);
  assert(badLayout.statusCode === 400, 'unknown layout name must be rejected');
  const foreign = await runHandler(handler, 'POST', '/api/layout', JSON.stringify({ layout: 'force', width: 1, height: 1, positions: {} }), { 'content-type': 'application/json' });
  assert(foreign.statusCode === 403, 'layout writes need a trusted Host header');
  await new Promise(r => setTimeout(r, 2300)); // save is debounced 2 s
  const onDisk = JSON.parse(fs.readFileSync(path.join(path.dirname(configPath), 'layout.json'), 'utf8'));
  assert(onDisk.count === 2 && onDisk.positions.Beta[1] === 2, 'expected layout.json written next to the config');

  const patch = await runHandler(handler, 'POST', '/api/config', JSON.stringify({ layout: 'rings', framing: 'left', safeArea: { top: 30, bottom: 90 }, rotate: { themes: ['aurora', 'metro'], everyMinutes: 30 }, maxFps: 0, idleFps: 0 }), { ...host, 'content-type': 'application/json' });
  assert(patch.statusCode === 200, `expected the new keys to validate, got ${patch.body}`);
  const cfgOut = JSON.parse(patch.body);
  assert(cfgOut.safeArea.right === 0 && cfgOut.safeArea.top === 30, 'safeArea fills missing sides with 0');
  const badRotate = await runHandler(handler, 'POST', '/api/config', JSON.stringify({ rotate: { themes: ['nope'] } }), { ...host, 'content-type': 'application/json' });
  assert(badRotate.statusCode === 400, 'rotate must reject unknown themes');
}

function runIgnorePathsNormalisation() {
  const v = path.join(path.sep, 'vault');
  const f = (...parts) => path.join(v, ...parts);
  // Trailing separators and either separator style mean the same folder.
  assert(isIgnoredPath(f('templates', 'a.md'), v, ['templates/'], false), 'trailing / must be trimmed');
  assert(isIgnoredPath(f('templates', 'a.md'), v, ['templates\\'], false), 'trailing \\ must be trimmed');
  assert(isIgnoredPath(f('Archive', 'Old', 'a.md'), v, ['Archive\\Old'], false), 'backslash prefix must match');
  assert(isIgnoredPath(f('Archive', 'Old', 'a.md'), v, ['Archive/Old/'], false), 'slash prefix must match');
  assert(isIgnoredPath(f('Archive', 'Old', 'a.md'), v, ['./Archive/Old'], false), 'leading ./ must be trimmed');
  assert(!isIgnoredPath(f('Archive', 'Older', 'a.md'), v, ['Archive/Old'], false), 'prefix must end at a segment boundary');
  assert(!isIgnoredPath(f('Archive', 'a.md'), v, ['Archive/Old'], false), 'a parent folder of the pattern is not ignored');
  // Case: insensitive on macOS/Windows, sensitive elsewhere.
  assert(isIgnoredPath(f('Templates', 'a.md'), v, ['templates'], true), 'case-insensitive match expected');
  assert(isIgnoredPath(f('sub', 'TEMPLATES', 'a.md'), v, ['Templates/'], true), 'case-insensitive segment match expected');
  assert(!isIgnoredPath(f('Templates', 'a.md'), v, ['templates'], false), 'case-sensitive mode must not fold case');
  assert(!isIgnoredPath(f('notes', 'a.md'), v, ['/', '  '], false), 'an empty pattern after trimming must match nothing');
}

async function runStaleParseDiscard(tmpRoot) {
  const vaultDir = path.join(tmpRoot, 'stale-vault');
  const file = path.join(vaultDir, 'Alpha.md');
  writeFile(file, '# Alpha\n[[Beta]]\n');
  const state = { cfg: sanitizePersistedConfig({ vaultPath: vaultDir }), entries: new Map() };
  // An add whose parse is still in flight when the unlink arrives must not
  // resurrect the note.
  const addP = applyFsEventToState(state, 'add', file);
  const unlinked = await applyFsEventToState(state, 'unlink', file);
  assert(unlinked === false, 'nothing to delete yet');
  assert((await addP) === false, 'a stale add must report no change');
  assert(!state.entries.has(file), 'a stale add must not resurrect an unlinked note');
  // Same for an unlinkDir of the parent folder.
  const nested = path.join(vaultDir, 'sub', 'Nested.md');
  writeFile(nested, '# Nested\n');
  const addNested = applyFsEventToState(state, 'add', nested);
  await applyFsEventToState(state, 'unlinkDir', path.join(vaultDir, 'sub'));
  await addNested;
  assert(!state.entries.has(nested), 'a stale add must not survive unlinkDir of its folder');
  // Two overlapping changes: the newest one wins and the older is dropped.
  const c1 = applyFsEventToState(state, 'change', file);
  writeFile(file, '# Alpha\n[[Gamma]]\n');
  const c2 = applyFsEventToState(state, 'change', file);
  const [r1, r2] = await Promise.all([c1, c2]);
  assert(r1 === false && r2 === true, `expected only the newest change to apply, got ${r1}/${r2}`);
  assert(state.entries.get(file).wikilinks[0] === 'Gamma', 'expected the newest parse to be kept');
  assert(state.fsPending.size === 0, 'pending map must not leak finished paths');
  // A plain sequential add still works.
  fs.rmSync(file);
  await applyFsEventToState(state, 'unlink', file);
  writeFile(file, '# Alpha again\n');
  assert((await applyFsEventToState(state, 'add', file)) === true && state.entries.has(file), 'a fresh add must apply');
}

async function runServerHardening(tmpRoot) {
  // Host parsing: bracketed IPv6 with and without a port; empty/malformed rejected.
  assert(isTrustedHost('[::1]:3000') && isTrustedHost('[::1]'), 'bracketed IPv6 loopback must be trusted');
  assert(isTrustedHost('LOCALHOST:3000') && isTrustedHost('127.0.0.1'), 'localhost/127.0.0.1 must be trusted');
  for (const bad of ['', '  ', '::1', '[::1', '[::1]x', '[::2]:3000', 'evil.example:3000', '127.0.0.1:abc', ':3000']) {
    assert(!isTrustedHost(bad), `Host ${JSON.stringify(bad)} must not be trusted`);
  }
  assert(isJsonContentType('application/json; charset=utf-8') && isJsonContentType('Application/JSON'), 'JSON with parameters must be accepted');
  assert(!isJsonContentType('application/jsonp') && !isJsonContentType('text/plain') && !isJsonContentType(undefined), 'non-JSON must be rejected');

  const vaultDir = path.join(tmpRoot, 'hardening-vault');
  writeFile(path.join(vaultDir, 'A.md'), '# A\nSome body text that is long enough for an excerpt.\n');
  const configPath = path.join(tmpRoot, 'hardening', 'config.json');
  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  writeJson(configPath, { vaultPath: vaultDir, port: 4322 });
  const state = {
    cfg: sanitizePersistedConfig({ vaultPath: vaultDir, port: 4322 }),
    configPath,
    outPath: path.join(tmpRoot, 'hardening', 'graph.json'),
    entries: await scanVaultEntries(vaultDir)
  };
  await rebuildGraphState(state);
  const handler = createRequestHandler(state);
  const host = { host: '127.0.0.1:4322' };
  const jsonHost = { ...host, 'content-type': 'application/json' };

  const emptyHost = await runHandler(handler, 'GET', '/api/tags', undefined, { host: '' });
  assert(emptyHost.statusCode === 403, `an empty Host header must be refused, got ${emptyHost.statusCode}`);
  const v6 = await runHandler(handler, 'GET', '/api/tags', undefined, { host: '[::1]:4322' });
  assert(v6.statusCode === 200, `a [::1] Host header must be accepted, got ${v6.statusCode}`);

  // Content-Type with a charset parameter.
  const charset = await runHandler(handler, 'POST', '/api/config', JSON.stringify({ hubLabels: true }),
    { ...host, 'content-type': 'application/json; charset=utf-8' });
  assert(charset.statusCode === 200, `JSON with charset must be accepted, got ${charset.statusCode} ${charset.body}`);

  // A hand edit of config.json not yet applied (debounced watcher) survives a POST.
  const onDisk = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  writeJson(configPath, { ...onDisk, accent: '#123456' });
  const merged = JSON.parse((await runHandler(handler, 'POST', '/api/config', JSON.stringify({ zoom: 1.5 }), jsonHost)).body);
  assert(merged.accent === '#123456' && merged.zoom === 1.5 && merged.hubLabels === true,
    `POST must merge onto the on-disk config, got accent=${merged.accent} zoom=${merged.zoom}`);
  // An invalid file on disk falls back to the in-memory config.
  fs.writeFileSync(configPath, '{ not json');
  const fallback = await runHandler(handler, 'POST', '/api/config', JSON.stringify({ zoom: 2 }), jsonHost);
  assert(fallback.statusCode === 200 && JSON.parse(fallback.body).accent === '#123456', 'invalid disk config must fall back to memory');

  // Frame protection on the settings page only; the wallpaper stays embeddable.
  const settings = await runHandler(handler, 'GET', '/settings.html', undefined, host);
  assert(settings.statusCode === 200, 'settings.html must be served');
  assert(/frame-ancestors 'self'/.test(settings.headers['Content-Security-Policy'] || ''), 'settings.html needs frame-ancestors \'self\'');
  assert(settings.headers['X-Frame-Options'] === 'SAMEORIGIN', 'settings.html needs X-Frame-Options: SAMEORIGIN');
  const wallpaper = await runHandler(handler, 'GET', '/', undefined, host);
  assert(wallpaper.statusCode === 200 && !wallpaper.headers['X-Frame-Options'], 'index.html must stay frameable by wallpaper hosts');

  // Note of the hour: the sorted list is cached per graph version.
  await runHandler(handler, 'GET', '/api/note-of-hour?hour=1', undefined, host);
  const cached = state.noteOfHourCache && state.noteOfHourCache.sorted;
  await runHandler(handler, 'GET', '/api/note-of-hour?hour=2', undefined, host);
  assert(cached && state.noteOfHourCache.sorted === cached, 'note-of-hour must reuse the sorted list within a graph version');

  // Custom presets: sanitized on read, capped, and vault-specific keys dropped.
  const presetsFile = path.join(path.dirname(configPath), 'custom-presets.json');
  const many = Array.from({ length: MAX_CUSTOM_PRESETS + 5 }, (_, i) => ({ name: `P${i}`, config: { zoom: 1 } }));
  writeJson(presetsFile, [
    null, 'junk', { name: '' }, { name: 'x'.repeat(61) },
    { name: 'Keep', config: { accent: '#abcdef', focusNote: 'Secret', tagColors: { a: '#000000' }, ignorePaths: ['x'], theme: 'nope', bogus: 1 } },
    { name: 'Keep', config: {} },
    ...many
  ]);
  const read = JSON.parse((await runHandler(handler, 'GET', '/api/custom-presets', undefined, host)).body);
  assert(read.length === MAX_CUSTOM_PRESETS, `expected the list capped at ${MAX_CUSTOM_PRESETS}, got ${read.length}`);
  assert(read[0].name === 'Keep' && read.filter(p => p.name === 'Keep').length === 1, 'bad entries dropped, duplicate names collapsed');
  assert(JSON.stringify(read[0].config) === JSON.stringify({ accent: '#abcdef' }), `bad/vault-specific keys must be dropped, got ${JSON.stringify(read[0].config)}`);
  assert(read[0].accent === '#abcdef', 'preset swatch must follow its config');
  const full = await runHandler(handler, 'POST', '/api/custom-presets', JSON.stringify({ name: 'One more', config: {} }), jsonHost);
  assert(full.statusCode === 400 && /too many/.test(JSON.parse(full.body).error), `expected the cap to refuse a new preset, got ${full.statusCode}`);
  const replace = await runHandler(handler, 'POST', '/api/custom-presets', JSON.stringify({ name: 'Keep', config: { focusNote: 'Secret', zoom: 2 } }), jsonHost);
  assert(replace.statusCode === 200, `replacing an existing preset must work at the cap, got ${replace.statusCode} ${replace.body}`);
  const replaced = JSON.parse(replace.body).find(p => p.name === 'Keep');
  assert(replaced && replaced.config.zoom === 2 && !('focusNote' in replaced.config), 'focusNote must not be stored in a preset');
  assert(sanitizeCustomPresets({}).length === 0, 'a non-array presets file reads as empty');

  // 413 over a real socket: the client must see the status, not a reset.
  const server = http.createServer(handler);
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  try {
    const port = server.address().port;
    const status = await new Promise((resolve, reject) => {
      const req = http.request({ host: '127.0.0.1', port, method: 'POST', path: '/api/config',
        headers: { 'content-type': 'application/json', host: `127.0.0.1:${port}` } }, res => {
        res.resume();
        resolve(res.statusCode);
      });
      req.on('error', reject);
      req.end(Buffer.alloc(3e6, 0x20));
    });
    assert(status === 413, `expected a 413 over a real socket, got ${status}`);
  } finally {
    await new Promise(r => server.close(r));
  }
}

async function runSymlinkFollow(tmpRoot) {
  const outside = path.join(tmpRoot, 'symlink-outside');
  writeFile(path.join(outside, 'Linked.md'), '# Linked\n');
  writeFile(path.join(outside, 'dir', 'InDir.md'), '# InDir\n');
  const vaultDir = path.join(tmpRoot, 'symlink-follow-vault');
  writeFile(path.join(vaultDir, 'Alpha.md'), '# Alpha\n');
  try {
    fs.symlinkSync(path.join(outside, 'Linked.md'), path.join(vaultDir, 'Linked.md'), 'file');
    fs.symlinkSync(path.join(outside, 'dir'), path.join(vaultDir, 'linkdir'), 'dir');
    fs.symlinkSync(path.join(outside, 'missing.md'), path.join(vaultDir, 'Broken.md'), 'file');
  } catch (e) {
    console.log(`note: skipping symlink-follow test (symlinks unavailable: ${e.message})`);
    return;
  }
  const entries = await scanVaultEntries(vaultDir);
  const names = Array.from(entries.values()).map(e => e.basename).sort();
  assert(JSON.stringify(names) === JSON.stringify(['Alpha', 'InDir', 'Linked']),
    `expected symlinked notes and folders to be scanned (broken links skipped), got [${names.join(', ')}]`);
  // The watcher path (applyFsEventToState) treats a symlinked note the same way.
  const state = { cfg: sanitizePersistedConfig({ vaultPath: vaultDir }), entries: new Map() };
  assert((await applyFsEventToState(state, 'add', path.join(vaultDir, 'Linked.md'))) === true, 'the watcher must accept a symlinked note');
}

async function main() {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'obsidian-live-wallpaper-smoke-'));
  try {
    runRendererCore();
    runNewCoreHelpers();
    runParserFuzz();
    runNewParserFeatures();
    runIndexDefaultsMatchParser();
    runThemesRegistry();
    runLayoutTargets();
    runConfigValidationThrows();
    runIgnorePathsUnit();
    runIgnorePathsNormalisation();
    runPresetsValidateAgainstSchema();
    runConfigExampleValidatesAgainstSchema(tmpRoot);
    await runHappyPath(tmpRoot);
    await runDuplicateBasenames(tmpRoot);
    await runGhostNodes(tmpRoot);
    await runConfigPatch(tmpRoot);
    await runIncrementalWatcher(tmpRoot);
    await runDocsRouteGuard();
    await run413BodyTooLarge(tmpRoot);
    await runIgnorePathsIntegration(tmpRoot);
    await runLiveWatcherWithIgnorePaths(tmpRoot);
    await runLiveWatcherDotAncestor(tmpRoot);
    await runSymlinkCycleGuard(tmpRoot);
    await runSymlinkFollow(tmpRoot);
    await runStaleParseDiscard(tmpRoot);
    await runServerHardening(tmpRoot);
    await runEaddrinuse(tmpRoot);
    await runEaddrinuseOwnInstance(tmpRoot);
    await runLinkResolution(tmpRoot);
    await runNewRoutes(tmpRoot);
    console.log('smoke: ok');
  } finally {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
}

main().catch(error => {
  console.error(`smoke: failed: ${error.message}`);
  process.exit(1);
});
