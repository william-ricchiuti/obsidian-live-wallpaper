const fs = require('fs');
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
  extractWikilinks,
  isIgnoredPath,
  startApp
} = require('../parser.js');
const core = require('../renderer-core.js');

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
      this.headers = headers;
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
  writeJson(configPath, { vaultPath: vaultDir, port: 3998, ignorePaths: ['templates', '.obsidian'] });

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

async function main() {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'obsidian-live-wallpaper-smoke-'));
  try {
    runRendererCore();
    runParserFuzz();
    runConfigValidationThrows();
    runIgnorePathsUnit();
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
    await runSymlinkCycleGuard(tmpRoot);
    await runEaddrinuse(tmpRoot);
    console.log('smoke: ok');
  } finally {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
}

main().catch(error => {
  console.error(`smoke: failed: ${error.message}`);
  process.exit(1);
});
