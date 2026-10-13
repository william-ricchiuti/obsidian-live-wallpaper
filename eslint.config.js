'use strict';

// Flat config (ESLint 9+). Scoped to plain .js files — index.html/settings.html
// inline <script> blocks aren't linted (would need eslint-plugin-html; not worth
// the extra dependency for a couple of small inline scripts).
const js = require('@eslint/js');
const globals = require('globals');

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
    files: ['parser.js', 'bin/cli.js', 'scripts/**/*.js', 'eslint.config.js'],
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
  }
];
