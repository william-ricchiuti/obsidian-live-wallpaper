'use strict';
/* global require, module, setTimeout, clearTimeout, console */

// Live Wallpaper Bridge: hands obsidian-live-wallpaper Obsidian's own link and
// tag index (graph.json) and the note you have open (active.json). Both files
// are written into this plugin's folder inside the vault's config dir; the
// wallpaper server watches them. Plain CommonJS, no build step.
//
// Loadable outside Obsidian (the tests require it from Node): the 'obsidian'
// module only exists inside the app, so a stub Plugin base class stands in.

let obsidian = {};
try { obsidian = require('obsidian'); } catch { /* not inside Obsidian */ }

const Plugin = obsidian.Plugin || class {
  constructor(app, manifest) { this.app = app; this.manifest = manifest; }
  registerEvent() {}
};

const SCHEMA = 1;
const GRAPH_DEBOUNCE_MS = 1000;
const ACTIVE_DEBOUNCE_MS = 300;
// Same list as parser.js NON_NOTE_EXT: unresolved links to attachments are not
// ghost notes.
const NON_NOTE_EXT = /\.(png|jpe?g|gif|webp|svg|bmp|avif|heic|pdf|mp3|mp4|m4a|wav|ogg|webm|mov|canvas|excalidraw|base|csv|zip)$/i;

function basenameOf(filePath) {
  const name = filePath.slice(filePath.lastIndexOf('/') + 1);
  return name.replace(/\.md$/, '');
}

// Mirrors parser.js noteId(): the basename, or on a basename collision the
// vault-relative path without .md ('./'-prefixed at the vault root). Same ids
// in both sources keep the renderer's saved layout valid when switching.
function makeIdFor(files) {
  const counts = Object.create(null);
  for (const f of files) {
    const b = f.basename != null ? f.basename : basenameOf(f.path);
    counts[b] = (counts[b] || 0) + 1;
  }
  return f => {
    const b = f.basename != null ? f.basename : basenameOf(f.path);
    if (counts[b] <= 1) return b;
    const rel = f.path.replace(/\.md$/, '');
    return rel.includes('/') ? rel : './' + rel;
  };
}

// Pure graph builder (exported for tests).
//   files:           [{ path, basename, stat: { mtime } }] (TFile-like, markdown only)
//   resolvedLinks:   { sourcePath: { destPath: count } }
//   unresolvedLinks: { sourcePath: { linktext: count } }
//   getTags(file):   tags with or without '#', frontmatter first (getAllTags order)
// Returns { nodes, links }; nodes carry `path` (the server strips it).
function buildPluginGraph({ files, resolvedLinks, unresolvedLinks, getTags }) {
  const list = (files || []).filter(f => f && typeof f.path === 'string' && f.path.endsWith('.md'))
    .slice()
    .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  const idFor = makeIdFor(list);
  const pathToId = new Map();
  const nodes = [];
  // Tags are case-insensitive in Obsidian; the first spelling met in path
  // order names the tag (same rule as parser.js).
  const tagSpelling = new Map();
  const canonicalTag = t => {
    const key = t.toLowerCase();
    if (!tagSpelling.has(key)) tagSpelling.set(key, t);
    return tagSpelling.get(key);
  };
  for (const f of list) {
    const id = idFor(f);
    pathToId.set(f.path, id);
    const basename = f.basename != null ? f.basename : basenameOf(f.path);
    const node = { id };
    if (basename !== id) node.label = basename;
    let raw;
    try { raw = (getTags && getTags(f)) || []; } catch { raw = []; }
    const tags = [];
    for (const t of raw) {
      if (typeof t !== 'string') continue;
      const v = t.replace(/^#/, '').trim();
      if (!v) continue;
      const c = canonicalTag(v);
      if (!tags.includes(c)) tags.push(c);
    }
    if (tags.length) node.tag = tags[0];
    if (tags.length > 1) node.tags = tags;
    const mtime = f.stat && Number(f.stat.mtime);
    if (mtime > 0) node.mtime = mtime;
    const slash = f.path.indexOf('/');
    if (slash > 0) node.folder = f.path.slice(0, slash);
    node.path = f.path;
    nodes.push(node);
  }

  const links = [];
  const linkSet = new Set();
  const addLink = (s, t) => {
    if (s === t) return;
    const key = s + '\0' + t;
    if (linkSet.has(key)) return;
    linkSet.add(key);
    links.push({ source: s, target: t });
  };
  const ghostIds = new Set();
  const realIds = new Set(pathToId.values());
  for (const f of list) {
    const sourceId = pathToId.get(f.path);
    const resolved = resolvedLinks && resolvedLinks[f.path];
    if (resolved) {
      for (const dest of Object.keys(resolved)) {
        const targetId = pathToId.get(dest); // non-markdown destinations aren't in the map
        if (targetId !== undefined) addLink(sourceId, targetId);
      }
    }
    const unresolved = unresolvedLinks && unresolvedLinks[f.path];
    if (unresolved) {
      for (const text of Object.keys(unresolved)) {
        let target = String(text).trim();
        if (!target || NON_NOTE_EXT.test(target)) continue;
        target = target.replace(/\.md$/i, '');
        if (!target) continue;
        if (!realIds.has(target) && !ghostIds.has(target)) {
          ghostIds.add(target);
          nodes.push({ id: target, ghost: true });
        }
        addLink(sourceId, target);
      }
    }
  }
  return { nodes, links };
}

class LiveWallpaperBridge extends Plugin {
  onload() {
    this.graphTimer = null;
    this.activeTimer = null;
    this.lastGraphBody = null;
    this.app.workspace.onLayoutReady(() => {
      this.scheduleGraph(0);
      this.scheduleActive(0);
    });
    // 'resolved' fires once every file's links are resolved, at startup and
    // again after edits.
    this.registerEvent(this.app.metadataCache.on('resolved', () => this.scheduleGraph()));
    this.registerEvent(this.app.vault.on('rename', () => { this.scheduleGraph(); this.scheduleActive(); }));
    this.registerEvent(this.app.vault.on('delete', () => { this.scheduleGraph(); this.scheduleActive(); }));
    this.registerEvent(this.app.workspace.on('file-open', () => this.scheduleActive()));
  }

  onunload() {
    if (this.graphTimer) clearTimeout(this.graphTimer);
    if (this.activeTimer) clearTimeout(this.activeTimer);
    this.graphTimer = this.activeTimer = null;
  }

  outDir() {
    return (this.manifest && this.manifest.dir) || `${this.app.vault.configDir}/plugins/live-wallpaper-bridge`;
  }

  scheduleGraph(delay = GRAPH_DEBOUNCE_MS) {
    if (this.graphTimer) clearTimeout(this.graphTimer);
    this.graphTimer = setTimeout(() => {
      this.graphTimer = null;
      this.writeGraph().catch(e => console.error('live-wallpaper-bridge: graph write failed', e));
    }, delay);
  }

  scheduleActive(delay = ACTIVE_DEBOUNCE_MS) {
    if (this.activeTimer) clearTimeout(this.activeTimer);
    this.activeTimer = setTimeout(() => {
      this.activeTimer = null;
      this.writeActive().catch(e => console.error('live-wallpaper-bridge: active write failed', e));
    }, delay);
  }

  async writeGraph() {
    const { metadataCache, vault } = this.app;
    const getAllTags = obsidian.getAllTags;
    const graph = buildPluginGraph({
      files: vault.getMarkdownFiles(),
      resolvedLinks: metadataCache.resolvedLinks,
      unresolvedLinks: metadataCache.unresolvedLinks,
      getTags: file => {
        const cache = metadataCache.getFileCache(file);
        return cache && getAllTags ? getAllTags(cache) : [];
      }
    });
    const body = JSON.stringify({ nodes: graph.nodes, links: graph.links });
    // Nothing changed since the last write: leave the file (and its
    // generatedAt) alone. Every edit changes a note's mtime, so a real edit
    // always writes.
    if (body === this.lastGraphBody) return;
    const json = JSON.stringify({ schema: SCHEMA, generatedAt: Date.now(), source: 'obsidian', nodes: graph.nodes, links: graph.links });
    await this.ensureDir();
    await vault.adapter.write(`${this.outDir()}/graph.json`, json);
    this.lastGraphBody = body;
  }

  async writeActive() {
    const { vault, workspace } = this.app;
    const file = workspace.getActiveFile();
    let id = null;
    if (file && file.extension === 'md') {
      id = makeIdFor(vault.getMarkdownFiles())(file);
    }
    const json = JSON.stringify({ path: file ? file.path : null, id, at: Date.now() });
    await this.ensureDir();
    await vault.adapter.write(`${this.outDir()}/active.json`, json);
  }

  async ensureDir() {
    const adapter = this.app.vault.adapter;
    const dir = this.outDir();
    if (!(await adapter.exists(dir))) await adapter.mkdir(dir);
  }
}

module.exports = LiveWallpaperBridge;
module.exports.default = LiveWallpaperBridge;
module.exports.buildPluginGraph = buildPluginGraph;
