'use strict';

// Flat config (ESLint 9+). `npm run lint` covers the plain .js files.
// The inline <script> blocks in index.html/settings.html are linted separately
// via eslint-plugin-html with `npm run lint:html` (not yet part of `lint` /
// prepublishOnly while the existing findings are worked down).
const js = require('@eslint/js');
const globals = require('globals');
const html = require('eslint-plugin-html');

// Globals published by renderer-core.js: in the browser it Object.assign()s its
// api onto window (see the bottom of that file), so index.html uses them bare.
const rendererCoreGlobals = Object.fromEntries([
  'clamp', 'truncateLabel', 'mixChannel', 'hashStr', 'hslToHex', 'graphHashFast', 'graphHashSlow',
  'PALETTES', 'hexToRgb', 'rgbToHex', 'mixHex', 'luminance', 'contrastRatio', 'ensureContrast',
  'timeOfDayTint', 'isDaytime', 'flowOffset', 'dayKey', 'configValueEqual'
].map(name => [name, 'readonly']));

// - ignoreRestSiblings: buildSafeConfig(cfg) does `const { vaultPath, port,
//   ...safe } = cfg` specifically to exclude those keys from the rest object;
//   they're intentionally "unused" bindings.
// - caughtErrors: 'none' + allowEmptyCatch: the codebase deliberately swallows
//   errors in several spots (e.g. `catch (_) {}` when closing a stream that
//   may already be closed) rather than treating every catch as a bug.
const sharedRules = {
  'no-unused-vars': ['error', { argsIgnorePattern: '^_', caughtErrors: 'none', ignoreRestSiblings: true }],
  'no-empty': ['error', { allowEmptyCatch: true }]
};

module.exports = [
  js.configs.recommended,
  {
    ignores: ['node_modules/**', 'vendor/**', 'docs/**']
  },
  {
    // Node/CommonJS: the server, CLI entry, dev/test scripts, and this config.
    files: ['parser.js', 'bin/cli.js', 'lib/**/*.js', 'scripts/**/*.js', 'eslint.config.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'commonjs',
      globals: { ...globals.node }
    },
    rules: sharedRules
  },
  {
    // Web worker: importScripts/self/postMessage, no module system. `d3` comes
    // from importScripts('/vendor/d3.min.js') at runtime, not a static import.
    files: ['worker.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'script',
      globals: { ...globals.worker, d3: 'readonly', LayoutCore: 'readonly' }
    },
    rules: sharedRules
  },
  {
    // Dual-environment UMD-style helpers (loaded as a <script> in the browser
    // or importScripts in the worker, required as CommonJS in Node tests).
    files: ['renderer-core.js', 'layout-core.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'script',
      globals: { ...globals.browser, ...globals.node }
    },
    rules: sharedRules
  },
  {
    // Browser-only classic scripts loaded by index.html. Themes register on
    // the shared THEMES object; the older hook-style themes (celestial, wash,
    // sketch, stained-glass) read the renderer's top-level globals directly.
    files: ['gl-renderer.js', 'themes/**/*.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'script',
      globals: {
        ...globals.browser,
        d3: 'readonly', THEMES: 'writable', SceneKit: 'writable',
        cfg: 'readonly', nodes: 'readonly', links: 'readonly', ctx: 'readonly', canvas: 'readonly',
        sceneTuning: 'readonly', tick: 'readonly', simAlpha: 'readonly', __cullFrame: 'readonly',
        __drawnNodes: 'writable', labelCandidates: 'readonly', ambientPool: 'readonly',
        nodeColor: 'readonly', edgeColor: 'readonly', hexToRGB: 'readonly', rgba: 'readonly',
        finiteNumber: 'readonly', hashStr: 'readonly', motionTime: 'readonly'
      }
    },
    rules: sharedRules
  },
  {
    // Inline <script> blocks in the two pages (classic scripts, browser only).
    files: ['index.html', 'settings.html'],
    plugins: { html },
    languageOptions: { ecmaVersion: 2022, sourceType: 'script', globals: { ...globals.browser } },
    rules: sharedRules
  },
  {
    // index.html loads, in order: vendor/d3, renderer-core.js, layout-core.js,
    // gl-renderer.js, themes/registry.js, themes/_scenekit.js, then its inline
    // script; theme files are injected later and register on THEMES. Its
    // top-level bindings are globals the hook-style themes read (cfg, nodes,
    // __cullFrame, ...), so only function-local unused vars are reported.
    files: ['index.html'],
    languageOptions: {
      globals: {
        ...rendererCoreGlobals,
        d3: 'readonly', LayoutCore: 'readonly', GLRenderer: 'readonly',
        THEMES: 'writable', SceneKit: 'readonly'
      }
    },
    rules: {
      'no-unused-vars': ['error', { vars: 'local', argsIgnorePattern: '^_', caughtErrors: 'none', ignoreRestSiblings: true }]
    }
  }
];
