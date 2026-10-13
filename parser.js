const fs = require('fs');
const path = require('path');
const http = require('http');
const zlib = require('zlib');
const chokidar = require('chokidar');

// Config path: --config <file> or OLW_CONFIG win over the package-local
// config.json, so `npm start` and the npx CLI can point at the same file.
function configPathFromArgs(argv = process.argv.slice(2), env = process.env) {
  const i = argv.indexOf('--config');
  if (i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('-')) return path.resolve(argv[i + 1]);
  if (env.OLW_CONFIG) return path.resolve(env.OLW_CONFIG);
  return path.join(__dirname, 'config.json');
}
const cfgPath = configPathFromArgs();
const OUT = path.join(__dirname, 'graph.json');
// DEFAULTS is canonical — clients fetch defaults via /api/defaults.
const DEFAULTS = {
  accent: '#7c5cff',
  background: '#0a0a0f',
  refreshMs: 5000,
  port: 3000,
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
  showUnresolvedLinks: true,
  fastHash: true,
  glowIntensity: 1,
  edgeStyle: 'line',
  nodeColorMode: 'tag',
  labelFont: 'sans',
  autoTheme: false,
  lightAccent: '#39407a',
  lightBackground: '#ece6d6',
  maxRenderedNodes: 5000,
  ignorePaths: [],
  tagColors: {},
  glowBreathing: true,
  glowBreathingSpeed: 1,
  glowBreathingDepth: 0.15,
  ambientParticles: false,
  ambientParticleCount: 40,
  ambientParticleSpeed: 0.3,
  ambientParticleSize: 1.5,
  chromaticBloom: true,
  chromaticBloomIntensity: 0.4,
  depthParallax: true,
  depthParallaxStrength: 0.5,
  depthParallaxLayers: 3,
  theme: 'default',
  labelStyle: {},
  // Composition
  layout: 'force',
  framing: 'center',
  zoom: 1,
  offsetX: 0,
  offsetY: 0,
  safeArea: { top: 0, right: 0, bottom: 0, left: 0 },
  // Colour
  palette: 'auto',
  recencyDays: 7,
  timeOfDay: 'off',
  tagShapes: false,
  // Texture
  grain: true,
  vignette: false,
  // Overlays and focus
  overlay: 'none',
  labelSource: 'hubs',
  focusNote: '',
  focusHops: 2,
  rotate: { themes: [], everyMinutes: 60 },
  // Performance
  maxFps: 30,
  idleFps: 10,
  renderer: 'auto'
};
const PUBLIC_FILES = new Map([
  ['/', path.join(__dirname, 'index.html')],
  ['/index.html', path.join(__dirname, 'index.html')],
  ['/settings.html', path.join(__dirname, 'settings.html')],
  ['/vendor/d3.min.js', path.join(__dirname, 'vendor', 'd3.min.js')],
  ['/worker.js', path.join(__dirname, 'worker.js')],
  ['/renderer-core.js', path.join(__dirname, 'renderer-core.js')],
  ['/layout-core.js', path.join(__dirname, 'layout-core.js')],
  ['/gl-renderer.js', path.join(__dirname, 'gl-renderer.js')],
  ['/presets.json', path.join(__dirname, 'presets.json')]
]);
const APP_ASSETS = new Set(['/worker.js', '/renderer-core.js', '/layout-core.js', '/gl-renderer.js']);
const DOCS_DIR = path.join(__dirname, 'docs');
const DOCS_ALLOWED_EXTS = new Set(['.png', '.gif', '.jpg', '.svg', '.md', '.txt']);
const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;
const MOTION_MODES = new Set(['still', 'light', 'balanced', 'showcase']);
const EDGE_STYLES = new Set(['line', 'curve', 'none']);
const NODE_COLOR_MODES = new Set(['tag', 'age', 'folder', 'recency']);
const LABEL_FONTS = new Set(['sans', 'mono', 'serif']);
const LABEL_STYLE_MODES = new Set(['badge', 'glow', 'minimal', 'inherit']);
const LAYOUTS = new Set(['force', 'rings', 'timeline', 'galaxy']);
const FRAMINGS = new Set(['center', 'fill', 'left', 'right', 'none']);
const PALETTES = new Set(['auto', 'aurora', 'riso', 'metro', 'pastel', 'earth', 'neon', 'viridis', 'mono']);
const TIME_OF_DAY = new Set(['off', 'tint', 'palette']);
const OVERLAYS = new Set(['none', 'clock', 'stats', 'note']);
const LABEL_SOURCES = new Set(['hubs', 'recent']);
const RENDERERS = new Set(['auto', 'canvas', 'webgl']);

// Themes are discovered from themes/*.js so the validator can never drift from
// what the renderer can load. Files starting with "_" are shared helpers, and
// registry.js is the loader stub. Each theme file registers THEMES[<basename>]
// and may declare `// @name` and `// @description` header lines for the UI.
const THEMES_DIR = path.join(__dirname, 'themes');
function discoverThemes(dir = THEMES_DIR) {
  const list = [{ id: 'default', name: 'Default', description: 'The classic glowing graph. Presets tune it.', dark: true }];
  let files;
  try { files = fs.readdirSync(dir); } catch (_) { return list; }
  for (const f of files.sort()) {
    if (!f.endsWith('.js') || f.startsWith('_') || f === 'registry.js') continue;
    const id = f.slice(0, -3);
    let head = '';
    try { head = fs.readFileSync(path.join(dir, f), 'utf8').slice(0, 2000); } catch (_) {}
    const name = (head.match(/@name\s+(.+)/) || [])[1];
    const description = (head.match(/@description\s+(.+)/) || [])[1];
    const dark = !/@light\b/.test(head);
    list.push({ id, name: name ? name.trim() : id, description: description ? description.trim() : '', dark });
  }
  return list;
}
const THEME_LIST = discoverThemes();
const THEME_NAMES = new Set(THEME_LIST.map(t => t.id));
// [[target]] / [[target|alias]] / [[target#heading]]. A leading "!" marks an
// embed; embeds of non-markdown files (images, PDFs, audio) are attachments,
// not note links, and must not become ghost nodes.
// Character classes exclude "[" so an unclosed "[[" can't make the scan
// quadratic (CodeQL js/polynomial-redos).
const WIKILINK = /(!?)\[\[([^[\]|#]+)(?:[|#][^[\]]*)?\]\]/g;
const NON_NOTE_EXT = /\.(png|jpe?g|gif|webp|svg|bmp|avif|heic|pdf|mp3|mp4|m4a|wav|ogg|webm|mov|canvas|excalidraw|base|csv|zip)$/i;
const FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n---/;
const TAGS_FLOW = /^tags:\s*\[([^\]]*)\]/m;
// [ \t] rather than \s so the pattern can't backtrack across newlines
// (CodeQL js/polynomial-redos on files with many "\n " repetitions).
const TAGS_BLOCK = /^tags:[ \t]*\r?\n((?:[ \t]*-[ \t]+\S[^\r\n]*(?:\r?\n|$))+)/m;
const TAGS_INLINE = /(?:^|\s)#([a-zA-Z][\w-/]*)/g;
// vendor/d3.min.js is pinned by npm version and never changes without a
// reinstall, so it's safe to cache long. worker.js/renderer-core.js are our
// own app code and can change on an upgrade — a much shorter TTL keeps a
// long-lived wallpaper-host browser view from running stale app JS for up to
// a day after the user updates.
const STATIC_CACHE_CONTROL = 'public, max-age=86400';
const APP_ASSET_CACHE_CONTROL = 'public, max-age=300';
const DYNAMIC_CACHE_CONTROL = 'no-cache';
const EVENT_HEADERS = {
  'Content-Type': 'text/event-stream',
  'Cache-Control': 'no-cache',
  Connection: 'keep-alive'
};
const MAX_BODY_BYTES = 1e6;

function noteId(basename, filePath, vaultPath, duplicatedBasenames) {
  if (!duplicatedBasenames.has(basename)) return basename;
  const rel = path.relative(vaultPath, filePath).replace(/\.md$/, '').replace(/\\/g, '/');
  return rel.includes('/') ? rel : './' + rel;
}

function failConfig(message, configPath = cfgPath) {
  console.error(`${configPath}: ${message}`);
  process.exit(1);
}

function requireString(value, key) {
  if (typeof value !== 'string' || value.trim() === '') {
    // Throw (not failConfig/process.exit) so callers control fatality: readConfigFile's
    // catch exits at startup, but reloadConfigFromDisk's catch must be able to just log
    // and ignore a bad live edit instead of killing the running server.
    throw new Error(`${key} is required and must be a non-empty string`);
  }
  return value;
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function validateHexColor(value, key) {
  if (typeof value !== 'string' || !HEX_COLOR.test(value)) {
    throw new Error(`${key} must be a 6-digit hex color like #7c5cff`);
  }
  return value;
}

function validateBoolean(value, key) {
  if (typeof value !== 'boolean') {
    throw new Error(`${key} must be a boolean`);
  }
  return value;
}

function validateEnum(value, key, allowed) {
  if (typeof value !== 'string' || !allowed.has(value)) {
    throw new Error(`${key} must be one of: ${Array.from(allowed).join(', ')}`);
  }
  return value;
}

function validateInteger(value, key, min, max) {
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(`${key} must be an integer between ${min} and ${max}`);
  }
  return value;
}

function validateNumber(value, key, min, max) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) {
    throw new Error(`${key} must be a number between ${min} and ${max}`);
  }
  return value;
}

function sanitizeTagColors(value) {
  if (value === undefined) return { ...DEFAULTS.tagColors };
  if (!isPlainObject(value)) {
    throw new Error('tagColors must be an object of tag -> hex color');
  }
  const sanitized = {};
  for (const [tag, color] of Object.entries(value)) {
    if (typeof tag !== 'string' || tag.trim() === '') {
      throw new Error('tagColors keys must be non-empty strings');
    }
    sanitized[tag] = validateHexColor(color, `tagColors.${tag}`);
  }
  return sanitized;
}

function validateIgnorePaths(value, key) {
  if (!Array.isArray(value)) throw new Error(`${key} must be an array of strings`);
  for (let i = 0; i < value.length; i++) {
    if (typeof value[i] !== 'string' || value[i].trim() === '')
      throw new Error(`${key}[${i}] must be a non-empty string`);
  }
  return value.slice();
}

function validateLabelStyle(value) {
  if (value === undefined) return {};
  if (!isPlainObject(value)) throw new Error('labelStyle must be an object');
  const s = {};
  if (value.mode !== undefined) {
    if (typeof value.mode !== 'string' || !LABEL_STYLE_MODES.has(value.mode))
      throw new Error(`labelStyle.mode must be one of: ${Array.from(LABEL_STYLE_MODES).join(', ')}`);
    s.mode = value.mode;
  }
  if (value.backgroundAlpha !== undefined) s.backgroundAlpha = validateNumber(value.backgroundAlpha, 'labelStyle.backgroundAlpha', 0, 0.9);
  if (value.glowColor !== undefined) {
    if (typeof value.glowColor !== 'string' || (value.glowColor !== 'accent' && value.glowColor !== 'node' && !HEX_COLOR.test(value.glowColor)))
      throw new Error('labelStyle.glowColor must be "accent", "node", or a hex color');
    s.glowColor = value.glowColor;
  }
  if (value.chromaticSplit !== undefined) s.chromaticSplit = validateBoolean(value.chromaticSplit, 'labelStyle.chromaticSplit');
  if (value.fontStyle !== undefined) s.fontStyle = validateEnum(value.fontStyle, 'labelStyle.fontStyle', LABEL_FONTS);
  return s;
}

function validateSafeArea(value, key) {
  if (!isPlainObject(value)) throw new Error(`${key} must be an object with top, right, bottom, left`);
  const out = {};
  for (const side of ['top', 'right', 'bottom', 'left']) {
    const v = value[side] === undefined ? 0 : value[side];
    out[side] = validateInteger(v, `${key}.${side}`, 0, 1000);
  }
  for (const k of Object.keys(value)) {
    if (!['top', 'right', 'bottom', 'left'].includes(k)) throw new Error(`${key}.${k} is not a known side`);
  }
  return out;
}

function validateString(value, key, maxLength) {
  if (typeof value !== 'string' || value.length > maxLength) {
    throw new Error(`${key} must be a string of at most ${maxLength} characters`);
  }
  return value.trim();
}

function validateRotate(value, key) {
  if (!isPlainObject(value)) throw new Error(`${key} must be an object like { "themes": [], "everyMinutes": 60 }`);
  const themes = value.themes === undefined ? [] : value.themes;
  if (!Array.isArray(themes) || themes.length > 32) throw new Error(`${key}.themes must be an array of up to 32 theme ids`);
  const out = { themes: themes.map((t, i) => validateEnum(t, `${key}.themes[${i}]`, THEME_NAMES)), everyMinutes: 60 };
  if (value.everyMinutes !== undefined) out.everyMinutes = validateInteger(value.everyMinutes, `${key}.everyMinutes`, 1, 1440);
  for (const k of Object.keys(value)) {
    if (k !== 'themes' && k !== 'everyMinutes') throw new Error(`${key}.${k} is not a known field`);
  }
  return out;
}

function isIgnoredPath(filePath, vaultPath, patterns) {
  if (!patterns || patterns.length === 0) return false;
  const rel = path.relative(vaultPath, filePath);
  if (!rel || rel.startsWith('..')) return true;
  for (const p of patterns) {
    if (rel === p || rel.startsWith(p + path.sep)) return true;
    if (rel.split(path.sep).includes(p)) return true;
  }
  return false;
}

// Single source of truth: each entry binds a validator, its args, and a
// default value. Used by sanitizePersistedConfig, sanitizeConfigPatch,
// and served to clients via /api/defaults so DEFAULTS never drifts.
const VALIDATORS = {
  accent:             { fn: validateHexColor },
  background:         { fn: validateHexColor },
  refreshMs:          { fn: validateInteger,  args: [1000, 60000] },
  linkOpacity:        { fn: validateNumber,   args: [0, 1] },
  nodeGlow:           { fn: validateBoolean },
  particles:          { fn: validateBoolean },
  particleSpeed:      { fn: validateNumber,   args: [0.1, 3] },
  particleDensity:    { fn: validateNumber,   args: [0.05, 1] },
  motionMode:         { fn: validateEnum,     args: [MOTION_MODES] },
  clusterByTag:       { fn: validateBoolean },
  clusterHalos:       { fn: validateBoolean },
  backgroundGradient: { fn: validateBoolean },
  hubLabels:          { fn: validateBoolean },
  hubLabelCount:      { fn: validateInteger,  args: [1, 50] },
  labelMinImportance: { fn: validateNumber,   args: [0, 1] },
  edgeColoring:       { fn: validateBoolean },
  depthOfField:       { fn: validateBoolean },
  noteFlare:          { fn: validateBoolean },
  autoScaleLargeVaults:{ fn: validateBoolean },
  showUnresolvedLinks:{ fn: validateBoolean },
  fastHash:           { fn: validateBoolean },
  glowIntensity:      { fn: validateNumber,   args: [0, 1] },
  edgeStyle:          { fn: validateEnum,     args: [EDGE_STYLES] },
  nodeColorMode:      { fn: validateEnum,     args: [NODE_COLOR_MODES] },
  labelFont:          { fn: validateEnum,     args: [LABEL_FONTS] },
  autoTheme:          { fn: validateBoolean },
  lightAccent:        { fn: validateHexColor },
  lightBackground:    { fn: validateHexColor },
  maxRenderedNodes:       { fn: validateInteger,  args: [100, 100000] },
  ignorePaths:            { fn: validateIgnorePaths },
  tagColors:              { fn: sanitizeTagColors },
  glowBreathing:          { fn: validateBoolean },
  glowBreathingSpeed:     { fn: validateNumber,   args: [0.1, 3] },
  glowBreathingDepth:     { fn: validateNumber,   args: [0, 0.4] },
  ambientParticles:       { fn: validateBoolean },
  ambientParticleCount:   { fn: validateInteger,  args: [0, 300] },
  ambientParticleSpeed:   { fn: validateNumber,   args: [0.05, 2] },
  ambientParticleSize:    { fn: validateNumber,   args: [0.5, 4] },
  chromaticBloom:         { fn: validateBoolean },
  chromaticBloomIntensity:{ fn: validateNumber,   args: [0, 1] },
  depthParallax:          { fn: validateBoolean },
  depthParallaxStrength:  { fn: validateNumber,   args: [0, 1] },
  depthParallaxLayers:    { fn: validateInteger,  args: [2, 4] },
  theme:                  { fn: validateEnum,     args: [THEME_NAMES] },
  labelStyle:             { fn: validateLabelStyle },
  layout:                 { fn: validateEnum,     args: [LAYOUTS] },
  framing:                { fn: validateEnum,     args: [FRAMINGS] },
  zoom:                   { fn: validateNumber,   args: [0.4, 3] },
  offsetX:                { fn: validateNumber,   args: [-1, 1] },
  offsetY:                { fn: validateNumber,   args: [-1, 1] },
  safeArea:               { fn: validateSafeArea },
  palette:                { fn: validateEnum,     args: [PALETTES] },
  recencyDays:            { fn: validateInteger,  args: [1, 365] },
  timeOfDay:              { fn: validateEnum,     args: [TIME_OF_DAY] },
  tagShapes:              { fn: validateBoolean },
  grain:                  { fn: validateBoolean },
  vignette:               { fn: validateBoolean },
  overlay:                { fn: validateEnum,     args: [OVERLAYS] },
  labelSource:            { fn: validateEnum,     args: [LABEL_SOURCES] },
  focusNote:              { fn: validateString,   args: [300] },
  focusHops:              { fn: validateInteger,  args: [1, 4] },
  rotate:                 { fn: validateRotate },
  maxFps:                 { fn: validateInteger,  args: [0, 60] },
  idleFps:                { fn: validateInteger,  args: [0, 30] },
  renderer:               { fn: validateEnum,     args: [RENDERERS] }
};

function sanitizePersistedConfig(raw) {
  if (!isPlainObject(raw)) {
    throw new Error('config root must be a JSON object');
  }
  const vaultPath = requireString(raw.vaultPath, 'vaultPath');
  const next = {
    vaultPath,
    port: raw.port === undefined ? DEFAULTS.port : validateInteger(raw.port, 'port', 1, 65535)
  };
  for (const [key, v] of Object.entries(VALIDATORS)) {
    next[key] = raw[key] !== undefined
      ? v.fn(raw[key], key, ...(v.args || []))
      : DEFAULTS[key];
  }
  if (!fs.existsSync(vaultPath)) {
    throw new Error(`vaultPath does not exist: ${vaultPath}`);
  }
  return next;
}

function sanitizeConfigPatch(raw) {
  if (!isPlainObject(raw)) {
    throw new Error('request body must be a JSON object');
  }
  const patch = {};
  for (const [key, value] of Object.entries(raw)) {
    const v = VALIDATORS[key];
    if (!v) {
      throw new Error(`unknown config key: ${key}`);
    }
    patch[key] = v.fn(value, key, ...(v.args || []));
  }
  return patch;
}

function readConfigFile(configPath = cfgPath) {
  try {
    const raw = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    return sanitizePersistedConfig(raw);
  } catch (e) {
    failConfig(e.message, configPath);
  }
}

function writeConfigFile(nextCfg, configPath = cfgPath) {
  const tmp = configPath + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(nextCfg, null, 2));
  fs.renameSync(tmp, configPath);
}

// All tags on a note, in order: frontmatter first, then inline #tags. The
// first one is the note's primary tag (used for clustering and colour); the
// rest are kept so every tag is counted and can be coloured in settings.
function extractTags(content) {
  const out = [];
  const add = t => {
    const v = String(t).trim().replace(/['"#]/g, '');
    if (v && !out.includes(v)) out.push(v);
  };
  const fm = content.match(FRONTMATTER);
  if (fm) {
    const flow = fm[1].match(TAGS_FLOW);
    if (flow) flow[1].split(',').forEach(add);
    const block = fm[1].match(TAGS_BLOCK);
    if (block) {
      for (const line of block[1].split(/\r?\n/)) {
        const m = line.match(/^\s*-\s+(.+)/);
        if (m) add(m[1]);
      }
    }
  }
  const body = fm ? content.slice(fm[0].length) : content;
  TAGS_INLINE.lastIndex = 0;
  let m;
  while ((m = TAGS_INLINE.exec(body)) !== null) add(m[1]);
  return out;
}

function extractTag(content) {
  const tags = extractTags(content);
  return tags.length ? tags[0] : null;
}

function extractWikilinks(content) {
  const result = [];
  WIKILINK.lastIndex = 0;
  let match;
  while ((match = WIKILINK.exec(content)) !== null) {
    let target = match[2].trim();
    if (!target) continue;
    if (NON_NOTE_EXT.test(target)) continue; // attachment link or embed, not a note
    if (match[1] === '!' && /\.[a-z0-9]{1,6}$/i.test(target) && !/\.md$/i.test(target)) continue;
    target = target.replace(/\.md$/i, '');
    result.push(target);
  }
  return result;
}

// Plain-text excerpt for the "note of the hour" overlay: no frontmatter,
// headings markers, links collapsed to their text, whitespace squashed.
function noteExcerpt(content, maxLength = 220) {
  let text = content.replace(FRONTMATTER, '');
  text = text
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/!\[\[[^\]]*\]\]/g, ' ')
    .replace(/\[\[([^\]|#]+)(?:[|#]([^\]]*))?\]\]/g, (_, a, b) => b || a)
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[#>*_`~|-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return text.length > maxLength ? text.slice(0, maxLength - 1).replace(/\s+\S*$/, '') + '…' : text;
}

function isMarkdownPath(filePath) {
  return typeof filePath === 'string' && filePath.endsWith('.md');
}

function hasHiddenSegment(filePath, vaultPath) {
  const rel = path.relative(vaultPath, filePath);
  if (!rel || rel.startsWith('..')) return true;
  return rel.split(path.sep).some(part => part.startsWith('.'));
}

// True when filePath is not vaultPath itself and not a descendant of it. Used
// instead of a raw filePath.startsWith(vaultPath) string check, which would
// incorrectly match an unrelated sibling directory that happens to share the
// prefix (e.g. vaultPath "/vault" matching "/vault-notes/x.md").
function isOutsideVault(filePath, vaultPath) {
  const rel = path.relative(vaultPath, filePath);
  return rel === '..' || rel.startsWith('..' + path.sep);
}

async function parseMarkdownEntry(filePath) {
  try {
    const stat = await fs.promises.stat(filePath);
    const basename = path.basename(filePath, '.md');
    const content = await fs.promises.readFile(filePath, 'utf8');
    return {
      path: filePath,
      basename,
      mtimeMs: stat.mtimeMs,
      tags: extractTags(content),
      get tag() { return this.tags.length ? this.tags[0] : null; },
      wikilinks: extractWikilinks(content)
    };
  } catch (e) {
    // ENOENT is expected churn (a file can vanish between being listed and
    // read, especially mid-scan on a large vault); anything else — permission
    // errors, encoding issues, other I/O failures — is unexpected, so log it
    // rather than let the note silently disappear from the graph.
    if (e.code !== 'ENOENT') {
      console.warn(`note: skipped ${filePath} (${e.code || e.message})`);
    }
    return null;
  }
}

// Runs `fn` over `items` with at most `limit` in flight at once. Used so
// scanning a large vault doesn't try to open tens of thousands of file
// descriptors concurrently.
async function mapWithConcurrency(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

const SCAN_CONCURRENCY = 64;

async function collectMarkdownFiles(vaultPath, patterns) {
  const files = [];
  // Track resolved real directory paths so a symlink cycle (e.g. a folder that
  // links back to an ancestor) can't drive the walk into infinite recursion.
  const visitedDirs = new Set();
  async function walk(dir) {
    let realDir;
    try { realDir = await fs.promises.realpath(dir); }
    catch (_) { return; }
    if (visitedDirs.has(realDir)) return;
    visitedDirs.add(realDir);
    let dirEntries;
    try { dirEntries = await fs.promises.readdir(dir, { withFileTypes: true }); }
    catch (_) { return; }
    for (const entry of dirEntries) {
      if (entry.name.startsWith('.')) continue;
      const fullPath = path.join(dir, entry.name);
      if (isIgnoredPath(fullPath, vaultPath, patterns)) continue;
      if (entry.isDirectory()) {
        await walk(fullPath);
      } else if (entry.isFile() && entry.name.endsWith('.md')) {
        files.push(fullPath);
      }
    }
  }
  await walk(vaultPath);
  return files;
}

// Async + concurrency-limited so scanning a large vault (the project targets
// vaults with tens of thousands of notes) doesn't block the event loop for
// seconds at a time the way a fully synchronous readdirSync/readFileSync walk
// would.
async function scanVaultEntries(vaultPath, ignorePaths) {
  const patterns = ignorePaths || [];
  const files = await collectMarkdownFiles(vaultPath, patterns);
  const parsed = await mapWithConcurrency(files, SCAN_CONCURRENCY, parseMarkdownEntry);
  const entries = new Map();
  for (let i = 0; i < files.length; i++) {
    if (parsed[i]) entries.set(files[i], parsed[i]);
  }
  return entries;
}

function materializeGraph(entries, vaultPath, options = {}) {
  const showUnresolved = options.showUnresolvedLinks !== undefined
    ? options.showUnresolvedLinks
    : DEFAULTS.showUnresolvedLinks;
  const raw = Array.from(entries.values())
    .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
    .map(entry => ({ basename: entry.basename, filePath: entry.path, entry }));
  const basenameCounts = {};
  for (const item of raw) {
    basenameCounts[item.basename] = (basenameCounts[item.basename] || 0) + 1;
  }
  const duplicatedBasenames = new Set(
    Object.entries(basenameCounts)
      .filter(([, count]) => count > 1)
      .map(([basename]) => basename)
  );

  const files = {};
  const tags = {};
  const allTags = {};
  const basenameToIds = {};
  // Obsidian resolves links case-insensitively, so index lower-cased names too.
  const lowerToIds = {};
  const relPathToId = {};
  for (const { basename, filePath, entry } of raw) {
    const id = noteId(basename, filePath, vaultPath, duplicatedBasenames);
    files[id] = {
      path: filePath,
      basename,
      wikilinks: entry.wikilinks,
      mtimeMs: entry.mtimeMs
    };
    const entryTags = entry.tags || (entry.tag ? [entry.tag] : []);
    if (entryTags.length) { tags[id] = entryTags[0]; allTags[id] = entryTags; }
    if (!basenameToIds[basename]) basenameToIds[basename] = [];
    basenameToIds[basename].push(id);
    const lower = basename.toLowerCase();
    if (!lowerToIds[lower]) lowerToIds[lower] = [];
    lowerToIds[lower].push(id);
    relPathToId[path.relative(vaultPath, filePath).replace(/\.md$/, '').replace(/\\/g, '/').toLowerCase()] = id;
  }
  // Resolve a [[link]] target to note ids: exact basename, then a vault-relative
  // path ([[Folder/Note]]), then the last path segment, then case-insensitively.
  const resolveTarget = target => {
    if (basenameToIds[target]) return basenameToIds[target];
    if (target.includes('/')) {
      const byPath = relPathToId[target.replace(/^\/+/, '').toLowerCase()];
      if (byPath) return [byPath];
      const last = target.slice(target.lastIndexOf('/') + 1);
      if (basenameToIds[last]) return basenameToIds[last];
      if (lowerToIds[last.toLowerCase()]) return lowerToIds[last.toLowerCase()];
    }
    return lowerToIds[target.toLowerCase()] || null;
  };

  if (duplicatedBasenames.size > 0) {
    const names = Array.from(duplicatedBasenames).sort().join(', ');
    console.log(`note: ${duplicatedBasenames.size} duplicate basename${duplicatedBasenames.size === 1 ? '' : 's'} resolved with folder prefix (${names})`);
  }

  const nodes = Object.keys(files).map(id => {
    const node = { id };
    if (files[id].basename !== id) node.label = files[id].basename;
    if (tags[id]) node.tag = tags[id];
    if (allTags[id] && allTags[id].length > 1) node.tags = allTags[id];
    if (files[id].mtimeMs) node.mtime = files[id].mtimeMs;
    // Top-level folder under the vault, for `nodeColorMode: 'folder'`. Omitted
    // for notes at the vault root (they color as the accent).
    const rel = path.relative(vaultPath, files[id].path);
    const sepIdx = rel.indexOf(path.sep);
    if (sepIdx > 0) node.folder = rel.slice(0, sepIdx);
    return node;
  });
  const nodeSet = new Set(nodes.map(node => node.id));
  const links = [];
  const linkSet = new Set();
  const ghostIds = new Set();
  for (const [sourceId, file] of Object.entries(files)) {
    for (const targetBasename of file.wikilinks) {
      const targetIds = resolveTarget(targetBasename) || (nodeSet.has(targetBasename) ? [targetBasename] : []);
      if (targetIds.length === 0 && showUnresolved && targetBasename.length > 0) {
        if (!ghostIds.has(targetBasename)) {
          ghostIds.add(targetBasename);
          nodes.push({ id: targetBasename, ghost: true });
          nodeSet.add(targetBasename);
        }
        const key = sourceId + '\0' + targetBasename;
        if (!linkSet.has(key)) {
          linkSet.add(key);
          links.push({ source: sourceId, target: targetBasename });
        }
        continue;
      }
      for (const targetId of targetIds) {
        if (targetId === sourceId) continue;
        const key = sourceId + '\0' + targetId;
        if (!linkSet.has(key)) {
          linkSet.add(key);
          links.push({ source: sourceId, target: targetId });
        }
      }
    }
  }

  const discoveredTags = {};
  for (const list of Object.values(allTags)) {
    for (const tag of list) discoveredTags[tag] = (discoveredTags[tag] || 0) + 1;
  }

  return {
    nodes,
    links,
    tagged: Object.keys(tags).length,
    discoveredTags
  };
}

function serializeGraph(result) {
  return JSON.stringify({ nodes: result.nodes, links: result.links });
}

async function writeGraphFile(graphJson, outPath = OUT) {
  const tmp = outPath + '.tmp';
  await fs.promises.writeFile(tmp, graphJson);
  await fs.promises.rename(tmp, outPath);
}

async function buildGraph(vaultPath, outPath = OUT, options = {}) {
  const entries = await scanVaultEntries(vaultPath, options.ignorePaths);
  const result = materializeGraph(entries, vaultPath, options);
  await writeGraphFile(serializeGraph(result), outPath);
  return result;
}

function buildSafeConfig(cfg) {
  const { vaultPath, port, ...safe } = cfg;
  return safe;
}

function defaultHeaders(contentType, cacheControl) {
  return {
    'Content-Type': contentType,
    'Cache-Control': cacheControl,
    'Cross-Origin-Opener-Policy': 'same-origin',
    'Cross-Origin-Embedder-Policy': 'require-corp',
    'Cross-Origin-Resource-Policy': 'same-origin',
    // Never let a browser sniff a JSON or text response (some carry note
    // text) into HTML.
    'X-Content-Type-Options': 'nosniff'
  };
}

// Every dynamic API response is JSON. A dedicated helper with a literal
// content type (plus nosniff) makes that explicit: some payloads carry text
// from vault files, and it must never be interpreted as HTML.
function serveJson(res, value) {
  const headers = defaultHeaders('application/json; charset=utf-8', DYNAMIC_CACHE_CONTROL);
  for (const [name, v] of Object.entries(headers)) res.setHeader(name, v);
  // Set literally so static analysis can see this response is never HTML.
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.statusCode = 200;
  res.end(JSON.stringify(value));
}

function serveFile(res, filePath, cacheControl = STATIC_CACHE_CONTROL) {
  const ext = path.extname(filePath);
  const mime = {
    '.html': 'text/html',
    '.json': 'application/json',
    '.js': 'application/javascript',
    '.css': 'text/css',
    '.png': 'image/png',
    '.gif': 'image/gif',
    '.svg': 'image/svg+xml'
  }[ext] || 'application/octet-stream';
  try {
    const stat = fs.statSync(filePath);
    res.writeHead(200, { ...defaultHeaders(mime, cacheControl), 'Content-Length': String(stat.size) });
    const stream = fs.createReadStream(filePath, { highWaterMark: 64 * 1024 });
    stream.pipe(res);
    stream.on('error', () => {
      if (!res.writableEnded) {
        res.destroy();
      }
    });
  } catch (e) {
    if (!res.writableEnded) {
      res.writeHead(404, defaultHeaders('text/plain', DYNAMIC_CACHE_CONTROL));
      res.end('Not found');
    }
  }
}

// The server only ever binds to 127.0.0.1, so a normal cross-origin browser
// request can't reach it — but DNS rebinding can trick a browser into sending
// a request with an attacker-controlled hostname to what it still resolves as
// 127.0.0.1. Checking the Host header on state-changing routes is a cheap
// extra layer of defense against that on top of the loopback bind.
const TRUSTED_HOSTS = new Set(['127.0.0.1', 'localhost', '::1', '[::1]']);

function isTrustedHost(hostHeader) {
  if (typeof hostHeader !== 'string') return false;
  const hostname = hostHeader.split(':')[0].toLowerCase();
  return TRUSTED_HOSTS.has(hostname);
}

function readBody(req, res) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let bytes = 0;
    let tooLarge = false;
    req.on('data', chunk => {
      if (tooLarge) return;
      // chunk is a Buffer; .length is bytes. Accumulating into a '' string
      // instead and checking .length there would count UTF-16 code units, not
      // bytes — undercounting the real size of multibyte (e.g. UTF-8) input.
      bytes += chunk.length;
      if (bytes > MAX_BODY_BYTES) {
        tooLarge = true;
        res.writeHead(413, defaultHeaders('application/json', DYNAMIC_CACHE_CONTROL));
        res.end(JSON.stringify({ error: 'request body too large' }));
        req.destroy();
        reject(new Error('request body too large'));
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function broadcastEvent(state, event, payload) {
  if (!state.eventClients || state.eventClients.size === 0) return;
  const body = `event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`;
  for (const client of state.eventClients) {
    try {
      client.write(body);
    } catch (e) {
      state.eventClients.delete(client);
    }
  }
}

// The server answers /graph.json from memory, so graph.json on disk is only a
// cold-start fallback and a debugging aid. It is written on the first build and
// on shutdown, not on every edit (that used to cost a full disk write per save).
async function rebuildGraphState(state, options = {}) {
  const result = materializeGraph(state.entries, state.cfg.vaultPath, {
    showUnresolvedLinks: state.cfg.showUnresolvedLinks
  });
  state.discoveredTags = result.discoveredTags;
  state.graphJson = serializeGraph(result);
  // Content hash, not the version counter: versions restart at 1 when the
  // server restarts, so a version-based ETag could match different content.
  state.graphEtag = `"g${hashString(state.graphJson).toString(36)}-${state.graphJson.length}"`;
  state.graphGzip = null; // compressed lazily per version
  state.graphVersion = (state.graphVersion || 0) + 1;
  state.realNoteIds = result.nodes.filter(n => !n.ghost).map(n => n.id);
  if (options.writeToDisk === true && state.outPath) {
    await writeGraphFile(state.graphJson, state.outPath);
  }
  const ghostCount = result.nodes.filter(node => node.ghost).length;
  const ghostMsg = ghostCount > 0 ? `, ${ghostCount} unresolved` : '';
  console.log(`graph: ${result.nodes.length} nodes, ${result.links.length} links, ${result.tagged} tagged${ghostMsg}`);
  return result;
}

async function applyFsEventToState(state, event, filePath) {
  if (typeof filePath !== 'string') return false;
  if (isOutsideVault(filePath, state.cfg.vaultPath)) return false;

  if (event === 'unlinkDir') {
    let removed = false;
    for (const existingPath of state.entries.keys()) {
      if (existingPath === filePath || existingPath.startsWith(filePath + path.sep)) {
        state.entries.delete(existingPath);
        removed = true;
      }
    }
    return removed;
  }

  if (!isMarkdownPath(filePath) || hasHiddenSegment(filePath, state.cfg.vaultPath)
      || isIgnoredPath(filePath, state.cfg.vaultPath, state.cfg.ignorePaths)) {
    return false;
  }

  if (event === 'unlink') {
    return state.entries.delete(filePath);
  }

  if (event !== 'add' && event !== 'change') {
    return false;
  }

  let stat;
  try {
    stat = await fs.promises.stat(filePath);
  } catch (_) {
    return false;
  }
  if (!stat.isFile()) return false;

  const nextEntry = await parseMarkdownEntry(filePath);
  if (!nextEntry) return false;
  const prev = state.entries.get(filePath);
  state.entries.set(filePath, nextEntry);
  if (!prev) return true;
  const prevTags = prev.tags || (prev.tag ? [prev.tag] : []);
  const nextTags = nextEntry.tags || [];
  return prev.mtimeMs !== nextEntry.mtimeMs
    || prevTags.length !== nextTags.length
    || prevTags.some((t, i) => t !== nextTags[i])
    || prev.basename !== nextEntry.basename
    || prev.wikilinks.length !== nextEntry.wikilinks.length
    || prev.wikilinks.some((link, index) => link !== nextEntry.wikilinks[index]);
}

function hashString(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

// Reads at most `limit` bytes: an excerpt never needs a whole (possibly huge) file.
async function readHead(filePath, limit) {
  const fh = await fs.promises.open(filePath, 'r');
  try {
    const buf = Buffer.alloc(limit);
    const { bytesRead } = await fh.read(buf, 0, limit, 0);
    return buf.subarray(0, bytesRead).toString('utf8');
  } finally {
    await fh.close();
  }
}

async function pickNoteOfHour(state, hourParam) {
  const ids = state.realNoteIds || [];
  const entries = state.entries ? Array.from(state.entries.values()) : [];
  if (!entries.length) return { title: '', excerpt: '', folder: '', mtime: 0 };
  const hourKey = /^\d{1,10}$/.test(hourParam || '') ? hourParam : String(Math.floor(Date.now() / 3600000));
  // Sort by path so the pick is stable regardless of Map insertion order.
  const sorted = entries.slice().sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  // Prefer notes with some body text; try a few candidates before giving up.
  for (let attempt = 0; attempt < 8; attempt++) {
    const entry = sorted[hashString(hourKey + ':' + attempt) % sorted.length];
    let content;
    try { content = await readHead(entry.path, 64 * 1024); } catch (_) { continue; }
    const excerpt = noteExcerpt(content);
    if (excerpt.length < 24 && attempt < 7) continue;
    const rel = path.relative(state.cfg.vaultPath, entry.path);
    const sep = rel.lastIndexOf(path.sep);
    return {
      title: entry.basename,
      excerpt,
      folder: sep > 0 ? rel.slice(0, sep).replace(/\\/g, '/') : '',
      mtime: entry.mtimeMs || 0,
      noteCount: ids.length || entries.length
    };
  }
  return { title: '', excerpt: '', folder: '', mtime: 0 };
}

// Custom presets live in a sidecar file next to the config, not in browser
// localStorage (which is per-origin, so it was lost whenever the port changed).
function customPresetsPath(state) {
  return path.join(path.dirname(state.configPath || cfgPath), 'custom-presets.json');
}
function readCustomPresets(state) {
  try {
    const list = JSON.parse(fs.readFileSync(customPresetsPath(state), 'utf8'));
    return Array.isArray(list) ? list : [];
  } catch (_) {
    return [];
  }
}
async function handleCustomPresets(state, req, res, requestUrl) {
  const json = (code, body) => {
    res.writeHead(code, defaultHeaders('application/json', DYNAMIC_CACHE_CONTROL));
    res.end(JSON.stringify(body));
  };
  if (!isTrustedHost(req.headers.host)) return json(403, { error: 'untrusted Host header' });
  if (req.method === 'GET') return json(200, readCustomPresets(state));
  try {
    if (req.method === 'POST') {
      if (req.headers['content-type'] !== 'application/json') return json(415, { error: 'Content-Type must be application/json' });
      const body = JSON.parse(await readBody(req, res));
      const name = validateString(body && body.name, 'name', 60);
      if (!name) throw new Error('name is required');
      const config = sanitizeConfigPatch(body.config || {});
      const list = readCustomPresets(state).filter(p => p.name !== name);
      list.push({ name, description: 'Custom preset', accent: config.accent || state.cfg.accent, background: config.background || state.cfg.background, custom: true, config });
      writeConfigFile(list, customPresetsPath(state));
      return json(200, list);
    }
    if (req.method === 'DELETE') {
      const name = requestUrl.searchParams.get('name') || '';
      const list = readCustomPresets(state).filter(p => p.name !== name);
      writeConfigFile(list, customPresetsPath(state));
      return json(200, list);
    }
    return json(405, { error: 'method not allowed' });
  } catch (e) {
    if (!res.writableEnded) json(400, { error: e.message });
  }
}

function createRequestHandler(state) {
  if (!state.eventClients) state.eventClients = new Set();
  if (!state.safeConfig) state.safeConfig = buildSafeConfig(state.cfg);
  if (!state.graphVersion) state.graphVersion = 1;
  if (!state.configVersion) state.configVersion = 1;

  return async (req, res) => {
    if (req.method === 'OPTIONS') {
      res.writeHead(204, defaultHeaders('text/plain', DYNAMIC_CACHE_CONTROL));
      res.end();
      return;
    }

    const requestUrl = new URL(req.url, 'http://127.0.0.1');
    const url = requestUrl.pathname;

    if (url === '/favicon.ico') {
      res.writeHead(204, defaultHeaders('text/plain', DYNAMIC_CACHE_CONTROL));
      res.end();
      return;
    }

    if (url === '/events' && req.method === 'GET') {
      res.writeHead(200, { ...defaultHeaders('text/event-stream', DYNAMIC_CACHE_CONTROL), ...EVENT_HEADERS });
      res.write(`event: hello\ndata: ${JSON.stringify({ graphVersion: state.graphVersion, configVersion: state.configVersion })}\n\n`);
      state.eventClients.add(res);
      req.on('close', () => state.eventClients.delete(res));
      return;
    }

    if (url === '/api/state' && req.method === 'GET') {
      serveJson(res, {
        graphVersion: state.graphVersion,
        configVersion: state.configVersion
      });
      return;
    }

    if (url === '/api/config' && req.method === 'GET') {
      serveJson(res, state.safeConfig);
      return;
    }

    if (url === '/api/defaults' && req.method === 'GET') {
      serveJson(res, buildSafeConfig({ ...DEFAULTS }));
      return;
    }

    if (url === '/api/themes' && req.method === 'GET') {
      serveJson(res, THEME_LIST);
      return;
    }

    // One note per clock hour, picked deterministically so every screen agrees.
    // Reads the file on demand rather than shipping excerpts in graph.json.
    if (url === '/api/note-of-hour' && req.method === 'GET') {
      // Returns note text, so it gets the same DNS-rebinding guard as writes.
      if (!isTrustedHost(req.headers.host)) {
        res.writeHead(403, defaultHeaders('application/json', DYNAMIC_CACHE_CONTROL));
        res.end(JSON.stringify({ error: 'untrusted Host header' }));
        return;
      }
      const note = await pickNoteOfHour(state, requestUrl.searchParams.get('hour'));
      // Note text is only ever sent as JSON (with nosniff); the renderer
      // inserts it with HTML escaping.
      res.writeHead(200, defaultHeaders('application/json; charset=utf-8', DYNAMIC_CACHE_CONTROL));
      res.end(JSON.stringify(note));
      return;
    }

    if (url === '/api/custom-presets') {
      await handleCustomPresets(state, req, res, requestUrl);
      return;
    }

    if (url === '/api/config' && req.method === 'POST') {
      if (!isTrustedHost(req.headers.host)) {
        res.writeHead(403, defaultHeaders('application/json', DYNAMIC_CACHE_CONTROL));
        res.end(JSON.stringify({ error: 'untrusted Host header' }));
        return;
      }
      if (req.headers['content-type'] !== 'application/json') {
        res.writeHead(415, defaultHeaders('application/json', DYNAMIC_CACHE_CONTROL));
        res.end(JSON.stringify({ error: 'Content-Type must be application/json' }));
        return;
      }
      try {
        const body = JSON.parse(await readBody(req, res));
        const patch = sanitizeConfigPatch(body);
        const updated = { ...state.cfg, ...patch, vaultPath: state.cfg.vaultPath, port: state.cfg.port };
        writeConfigFile(updated, state.configPath);
        state.cfg = updated;
        state.safeConfig = buildSafeConfig(updated);
        state.configVersion += 1;
        serveJson(res, state.safeConfig);
        broadcastEvent(state, 'config', { version: state.configVersion });
        if (Object.prototype.hasOwnProperty.call(patch, 'ignorePaths') && state.onIgnorePathsChanged) {
          await state.onIgnorePathsChanged();
        } else if (Object.prototype.hasOwnProperty.call(patch, 'showUnresolvedLinks')) {
          await rebuildGraphState(state);
          broadcastEvent(state, 'graph', { version: state.graphVersion });
        }
      } catch (e) {
        if (!res.writableEnded) {
          res.writeHead(400, defaultHeaders('application/json', DYNAMIC_CACHE_CONTROL));
          res.end(JSON.stringify({ error: e.message }));
        }
      }
      return;
    }

    if (url === '/api/tags' && req.method === 'GET') {
      serveJson(res, state.discoveredTags || {});
      return;
    }

    if (url === '/graph.json' && req.method === 'GET') {
      const graphJson = state.graphJson || (state.outPath && fs.existsSync(state.outPath)
        ? fs.readFileSync(state.outPath, 'utf8')
        : JSON.stringify({ nodes: [], links: [] }));
      // ETag per graph version: a client that already has this version gets a
      // 304 instead of re-downloading a multi-megabyte graph.
      const etag = state.graphJson ? state.graphEtag || `"g${hashString(graphJson).toString(36)}-${graphJson.length}"` : `"g0-${graphJson.length}"`;
      if (req.headers['if-none-match'] === etag) {
        res.writeHead(304, { ...defaultHeaders('application/json', DYNAMIC_CACHE_CONTROL), ETag: etag });
        res.end();
        return;
      }
      const headers = { ...defaultHeaders('application/json', DYNAMIC_CACHE_CONTROL), ETag: etag, Vary: 'Accept-Encoding' };
      if (graphJson.length > 8192 && /\bgzip\b/.test(req.headers['accept-encoding'] || '')) {
        if (!state.graphGzip || state.graphGzipFor !== etag) {
          state.graphGzip = zlib.gzipSync(graphJson, { level: 6 });
          state.graphGzipFor = etag;
        }
        res.writeHead(200, { ...headers, 'Content-Encoding': 'gzip', 'Content-Length': String(state.graphGzip.length) });
        res.end(state.graphGzip);
        return;
      }
      res.writeHead(200, headers);
      res.end(graphJson);
      return;
    }

    if (url.startsWith('/docs/') && req.method === 'GET') {
      // The real guard is the containment check below (abs stays under
      // DOCS_DIR); `url` is already a normalized URL pathname (the WHATWG URL
      // parser collapses ".." segments before this handler ever sees it), so
      // stripping ".." here again would just risk mangling a legitimate
      // filename without adding any actual protection.
      const rel = url.slice('/docs/'.length);
      const abs = path.join(DOCS_DIR, rel);
      if (
        (abs === DOCS_DIR || abs.startsWith(DOCS_DIR + path.sep)) &&
        DOCS_ALLOWED_EXTS.has(path.extname(abs)) &&
        fs.existsSync(abs) &&
        fs.statSync(abs).isFile()
      ) {
        serveFile(res, abs);
        return;
      }
    }

    // /themes/* — serve theme JS files from the themes/ directory
    if (url.startsWith('/themes/')) {
      const rel = url.slice('/themes/'.length);
      if (!rel || rel.includes('/') || rel.includes('\\')) {
        res.writeHead(404, defaultHeaders('text/plain', DYNAMIC_CACHE_CONTROL));
        res.end('Not found');
        return;
      }
      const abs = path.join(__dirname, 'themes', rel);
      if (fs.existsSync(abs) && fs.statSync(abs).isFile()) {
        serveFile(res, abs, APP_ASSET_CACHE_CONTROL);
        return;
      }
    }

    const filePath = PUBLIC_FILES.get(url);
    if (!filePath) {
      res.writeHead(404, defaultHeaders('text/plain', DYNAMIC_CACHE_CONTROL));
      res.end('Not found');
      return;
    }
    const cacheControl = path.extname(filePath) === '.html' ? DYNAMIC_CACHE_CONTROL
      : APP_ASSETS.has(url) ? APP_ASSET_CACHE_CONTROL
      : STATIC_CACHE_CONTROL;
    serveFile(res, filePath, cacheControl);
  };
}

async function startApp(options = {}) {
  const configPath = options.configPath || cfgPath;
  const outPath = options.outPath || path.join(path.dirname(configPath), 'graph.json');
  if (!fs.existsSync(configPath)) {
    console.error('Missing config.json. Run: cp config.example.json config.json');
    process.exit(1);
  }

  const cfg = readConfigFile(configPath);
  const state = {
    cfg,
    safeConfig: buildSafeConfig(cfg),
    configPath,
    outPath,
    discoveredTags: {},
    entries: await scanVaultEntries(cfg.vaultPath, cfg.ignorePaths),
    graphJson: '',
    graphVersion: 0,
    configVersion: 1,
    eventClients: new Set()
  };

  const server = http.createServer(createRequestHandler(state));

  const rebuild = async () => {
    const result = await rebuildGraphState(state);
    broadcastEvent(state, 'graph', { version: state.graphVersion });
    return result;
  };

  try {
    await rebuild();
    await writeGraphFile(state.graphJson, state.outPath).catch(() => {});
  } catch (e) {
    console.error(`startup failed: ${e.message}`);
    process.exit(1);
  }

  if (state.entries.size === 0) {
    console.log(`note: no .md files found under ${state.cfg.vaultPath} — double-check vaultPath; the graph stays empty until notes appear.`);
  }

  // Live-reload config.json when it is edited by hand. (The settings page pushes
  // changes via POST; this covers manual edits.) Visual fields apply immediately;
  // vaultPath/port changes are noted as needing a restart. Atomic saves replace
  // the file inode, so chokidar is used rather than fs.watch on the file itself.
  function reloadConfigFromDisk() {
    let next;
    try {
      next = sanitizePersistedConfig(JSON.parse(fs.readFileSync(state.configPath, 'utf8')));
    } catch (e) {
      console.error(`config.json change ignored: ${e.message}`);
      return;
    }
    if (next.vaultPath !== state.cfg.vaultPath || next.port !== state.cfg.port) {
      console.log('note: vaultPath/port change in config.json needs a restart to take effect.');
    }
    const merged = { ...next, vaultPath: state.cfg.vaultPath, port: state.cfg.port };
    const nextSafe = buildSafeConfig(merged);
    if (JSON.stringify(nextSafe) === JSON.stringify(state.safeConfig)) return; // echo of our own write / no change
    const unresolvedChanged = merged.showUnresolvedLinks !== state.cfg.showUnresolvedLinks;
    const ignoreChanged = JSON.stringify(merged.ignorePaths) !== JSON.stringify(state.cfg.ignorePaths);
    state.cfg = merged;
    state.safeConfig = nextSafe;
    state.configVersion += 1;
    broadcastEvent(state, 'config', { version: state.configVersion });
    if (ignoreChanged) state.onIgnorePathsChanged().catch(e => console.error(`rescan failed: ${e.message}`));
    else if (unresolvedChanged) rebuild().catch(e => console.error(`build failed: ${e.message}`));
    console.log('config.json reloaded');
  }

  const CONFIG_DEBOUNCE_MS = 200;
  let cfgDebounce = null;
  const configWatcher = chokidar.watch(state.configPath, { ignoreInitial: true });
  configWatcher.on('all', () => {
    if (cfgDebounce) clearTimeout(cfgDebounce);
    cfgDebounce = setTimeout(reloadConfigFromDisk, CONFIG_DEBOUNCE_MS);
  }).on('error', e => console.error('config watcher error:', e.message));

  let debounceTimer = null;
  const DEBOUNCE_MS = 400;
  const debouncedRebuild = () => {
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      debounceTimer = null;
      rebuild().catch(e => console.error(`build failed: ${e.message}`));
    }, DEBOUNCE_MS);
  };

  const AWAIT_WRITE_FINISH_MS = 300;
  // The vault watcher is (re)created from the current ignorePaths. Changing
  // ignorePaths in settings or config.json closes it, rescans the vault and
  // starts a new one, so the scan and the watcher never disagree.
  function createVaultWatcher() {
    // Skip dotfiles/dot-directories, and any *file* whose extension is not .md.
    // The extension check must not fire on directories (e.g. "notes.v2"), or
    // chokidar silently never descends into them while the scan still does.
    const chokidarIgnores = [
      /(^|[/\\])\./,
      (filePath, stats) => {
        // chokidar calls this once without stats and again with them; only
        // decide when we know it is a file (applyFsEventToState filters .md anyway).
        if (!stats || !stats.isFile()) return false;
        return path.extname(filePath).toLowerCase() !== '.md';
      },
    ];
    const ignorePaths = state.cfg.ignorePaths ? state.cfg.ignorePaths.slice() : [];
    if (ignorePaths.length) {
      const vaultRoot = path.resolve(state.cfg.vaultPath);
      chokidarIgnores.push(filePath => {
        // chokidar calls the ignore callback on the watch root itself first;
        // isIgnoredPath treats an empty relative path as outside the vault, so
        // guard the root explicitly or the whole watch is discarded.
        if (path.resolve(filePath) === vaultRoot) return false;
        return isIgnoredPath(filePath, vaultRoot, ignorePaths);
      });
    }
    const w = chokidar.watch(state.cfg.vaultPath, {
      ignoreInitial: true,
      ignored: chokidarIgnores,
      awaitWriteFinish: { stabilityThreshold: AWAIT_WRITE_FINISH_MS }
    });
    w.on('all', (event, filePath) => {
      applyFsEventToState(state, event, filePath)
        .then(changed => { if (changed) debouncedRebuild(); })
        .catch(e => console.error(`watch update failed: ${e.message}`));
    }).on('error', e => {
      console.error('watcher error:', e.message);
    });
    return w;
  }
  let watcher = createVaultWatcher();
  state.onIgnorePathsChanged = async () => {
    try { await watcher.close(); } catch (_) {}
    state.entries = await scanVaultEntries(state.cfg.vaultPath, state.cfg.ignorePaths);
    await rebuild();
    watcher = createVaultWatcher();
    console.log('ignorePaths changed: vault rescanned');
  };

  server.listen(state.cfg.port, '127.0.0.1', () => {
    console.log(`wallpaper:  http://127.0.0.1:${state.cfg.port}`);
    console.log(`settings:   http://127.0.0.1:${state.cfg.port}/settings.html`);
  });

  server.on('error', e => {
    if (e.code === 'EADDRINUSE') {
      console.error(`Port ${state.cfg.port} is already in use. Another instance may be running, or pick a different port:`);
      console.error(`  • edit "port" in ${path.basename(state.configPath)}, or`);
      console.error(`  • start with a free port, e.g. --port ${state.cfg.port + 1}`);
    } else {
      console.error(`server error: ${e.message}`);
    }
    process.exit(1);
  });

  let shuttingDown = false;
  async function shutdown() {
    if (shuttingDown) return; // a second SIGINT/SIGTERM while already closing is a no-op
    shuttingDown = true;
    if (debounceTimer) clearTimeout(debounceTimer);
    if (cfgDebounce) clearTimeout(cfgDebounce);
    for (const client of state.eventClients) {
      try { client.end(); } catch (_) {}
    }
    try { await watcher.close(); } catch (_) {}
    try { await configWatcher.close(); } catch (_) {}
    if (state.graphJson && state.outPath) {
      try { await writeGraphFile(state.graphJson, state.outPath); } catch (_) {}
    }
    server.close(() => process.exit(0));
    // Fallback in case server.close()'s callback never fires (e.g. a lingering
    // keep-alive connection). unref'd so this timer alone never keeps the
    // process alive longer than everything else already would.
    setTimeout(() => process.exit(0), 2000).unref();
  }
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  return { server, get watcher() { return watcher; }, configWatcher, state, rebuild };
}

if (require.main === module) {
  startApp().catch(e => {
    console.error(`startup failed: ${e.message}`);
    process.exit(1);
  });
}

module.exports = {
  DEFAULTS,
  VALIDATORS,
  sanitizePersistedConfig,
  sanitizeConfigPatch,
  extractTag,
  extractTags,
  extractWikilinks,
  noteExcerpt,
  discoverThemes,
  THEME_LIST,
  configPathFromArgs,
  noteId,
  buildGraph,
  createRequestHandler,
  readConfigFile,
  writeConfigFile,
  startApp,
  scanVaultEntries,
  materializeGraph,
  applyFsEventToState,
  rebuildGraphState,
  isIgnoredPath
};
