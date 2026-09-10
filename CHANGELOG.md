# Changelog

## [1.1.1] - 2026-09-10

### Fixed
- **Node glow was not drawn.** The v1.1 refactor built a glow sprite per node but dropped the `drawImage` call, so every glow preset (and chromatic bloom, which lives in the same sprite) rendered flat. Restored. Sprites are now rasterised once per color at a fixed size and scaled on draw; the previous cache key included the per-frame breathing size, so each node allocated a fresh canvas every frame.
- **Glow breathing stopped once the layout settled.** It was gated on simulation activity; it now runs on a wall-clock ~30s cycle regardless of frame rate.
- **Live updates silently disabled whenever `ignorePaths` was non-empty** (which `config.example.json` ships with). The ignore callback fired on the vault root itself and chokidar discarded the whole watch. Added a real watcher test to `npm test`.
- **Directories with a dot in the name (e.g. `notes.v2`) were scanned but never watched.** The non-`.md` extension filter now only applies to files.
- `themes/` was missing from the npm `files` list, so `npx obsidian-live-wallpaper` 404'd every theme script.
- `ambientParticles` default documented as `true`/80 in README and the renderer's fallback defaults; the server default is `false`/40. Aligned.
- `package.json` version was still 1.0.0.

## [1.1.0] - 2026-07-09

### Added
- **Glow breathing.** Nodes slowly pulse over ~30s cycles (`glowBreathing`, `glowBreathingSpeed`, `glowBreathingDepth`). Keeps the wallpaper feeling alive during long desktop sessions with zero performance cost.
- **Ambient environmental particles.** A separate particle system of free-floating motes (`ambientParticles`, `ambientParticleCount`, `ambientParticleSpeed`, `ambientParticleSize`) that drift independently of the graph structure. Adds atmospheric depth — like dust motes, fireflies, or slowly falling snow depending on the preset.
- **Chromatic light bleed (bloom).** Bright nodes bloom into hue-shifted outer halos (`chromaticBloom`, `chromaticBloomIntensity`) for a cinematic, photographic feel. Two-layer radial gradient: inner at base color, outer at +15° hue shift.
- **Depth parallax layers.** Nodes rendered in 2–4 depth tiers (`depthParallax`, `depthParallaxStrength`, `depthParallaxLayers`) with independent drift motion, saturation, alpha, size, and blur. Creates genuine 3D depth without WebGL — foreground nodes drift faster, background nodes are desaturated and slightly blurred.
- **Label visual integration.** Per-preset label styling via `labelStyle` object with four modes: `badge` (current dark rounded-rect), `glow` (shadow-blur text in node color), `minimal` (plain text, serif where appropriate), `inherit` (tinted to node's tag color). Plus `chromaticSplit` for Synthwave/Vapor pink+cyan offset labels. `fontStyle` per-preset overrides the global `labelFont`.
- **Four rendering themes** (`theme` config): `celestial` (star chart with diffraction spikes, orbital rings, rotating starfield, nebula washes), `wash` (watercolor pigment bleed, brush-stroke edges, paper texture), `sketch` (hand-drawn jittered arcs, notebook paper with ruled lines and red margin, graphite smudges), `stained-glass` (experimental — Voronoi-tessellated cells colored by tag with dark lead borders). Theme system is modular: each theme lives in its own JS file under `themes/`, registered via `themes/registry.js`, dispatched from `index.html`'s `draw()`.
- **Theme file serving.** Parser now serves `/themes/*` paths from the `themes/` directory with app cache TTL.
- **Config validation.** Full validation for all 14 new config options in `parser.js`, plus `validateLabelStyle()` for the nested label style object. `THEME_NAMES` and `LABEL_STYLE_MODES` enums.
- All 18 presets updated with per-preset defaults for every new option. Synthwave/Vapor ship with chromatic bloom + chromatic-split labels. Constellation ships with 4-layer depth parallax. Abyss ships with 100 ambient particles. Ink/Library/Parchment ship with minimal serif labels.

### Fixed
- **Missing `updateParticles` function.** Was accidentally dropped during the enhancement refactor; restored. Particles now animate correctly in all presets.
- **Glow sprite defaults.** `getGlowSprite()` now handles undefined `size`/`chromatic`/`chromaticIntensity` arguments, preventing non-finite radial gradient errors on call sites that pass only a color.
- **Chromatic bloom color shift.** Added `rgbToHsl()` helper to `index.html` so `hueShift()` works correctly for generating bloom-tinted outer glow colors.

### Changed
- `labelFontStack()` now respects `cfg.labelStyle.fontStyle` override before falling back to `cfg.labelFont`.
- `draw()` function delegates to theme renderers when `cfg.theme` is set to a non-default value and `window.THEMES[cfg.theme].draw` exists.

## [1.0.0] - 2026-06-19

First stable release.

### Fixed
- **Blank first-paint / blank synthetic render.** The viewport-cull quadtree was
  populated from the cached `__hasPoint` flag, which isn't set until the first
  `buildFramePoints` runs. The tree was first built during graph load (before any
  frame), so it started empty and every node was culled — a blank flash on first
  paint in live mode, and a permanently empty frame in synthetic/`oneshot` mode.
  It now builds from the live position check.
- **Flat/light presets rendered on black.** The canvas is opaque (`alpha:false`),
  so presets with `backgroundGradient: false` never painted `cfg.background` and
  showed solid black regardless of the configured color. Light, flat themes
  (e.g. Mist, Ink) were unusable. The base color is now filled every frame; the
  opaque gradient still overrides it for gradient presets.

### Added
- **Foundational build-out.** Vault parser + file watcher, d3 force-graph
  renderer on a fullscreen canvas, live updates over SSE, a settings page, and
  the six-phase large-vault performance work (worker-based simulation, glow
  sprite atlas, batched draws, static layer caching, viewport culling, adaptive
  frame rate). This project has never had a separate pre-1.0 release — see
  [`docs/theme-axes.md`](docs/theme-axes.md) for the preset design thinking.
- **Color by folder.** New `nodeColorMode: 'folder'` colors nodes by their
  top-level vault folder via a deterministic palette (the parser now emits each
  node's folder). Edges inherit node color across tag/age/folder modes.
- **Per-preset label fonts.** New `labelFont` (`sans` / `mono` / `serif`);
  Blueprint ships monospace, Ink / Library / Parchment ship serif.
- **Auto light/dark.** With `autoTheme` on, the renderer swaps to a preset's
  `lightAccent` / `lightBackground` (and drops glow) when the OS is in light mode,
  reacting live to the system preference.
- **Preset cross-fade.** Switching presets briefly fades the previous look out
  instead of cutting hard. Small slider tweaks still apply instantly.
- **Live config reload.** Editing `config.json` by hand now applies visual
  changes immediately (vaultPath/port still need a restart, and you're told so).
- **`npx` / CLI runner.** `npx obsidian-live-wallpaper --vault <path> [--port N]`
  scaffolds a config in the working directory and starts the server, so the
  wallpaper can run without cloning the repo. Also available as `olw`.
- **Unit tests for shared pure helpers** (`renderer-core.js`, used by both the
  browser renderer and Node tests), plus parser tag/wikilink edge-case tests and
  a reduced-motion render assertion.
- **Release automation & repo hygiene:** tag-triggered npm release workflow,
  CodeQL scanning, Dependabot, issue/PR templates, and a full preset gallery in
  the README.
- Friendlier failures: a helpful message when the port is in use, and a hint
  when no Markdown files are found under the vault path.
- **Respects `prefers-reduced-motion`.** When the OS requests reduced motion, the
  renderer drops drift, particles, and flares regardless of the active preset,
  and updates live if the setting changes.
- Render loop now pauses while the page is hidden (display asleep, Space
  switched, wallpaper covered), eliminating render work and saving battery.
- After the scene has been calm for 30s the loop steps down from 30fps to ~15fps,
  so a static wallpaper costs almost nothing; any change escalates back.
- Renderer smoke test (`npm run smoke:render`): boots the server against a
  throwaway vault and asserts in headless Chrome that representative presets draw
  nodes without uncaught JS errors. Skips cleanly when no Chrome is present, so
  `npm test` stays green on machines without a browser. Runs for real in CI.
- Cross-platform Chrome discovery (`scripts/find-chrome.js`) used by the
  screenshot and renderer-smoke tooling (macOS / Windows / Linux + Playwright /
  Puppeteer caches).
- Preset thumbnails for all 18 presets, so the settings preset picker shows a
  preview for every theme.
- GitHub Actions CI running the test suite on Node 20 and 22.

### Changed
- `drawEdges` groups edges with nested color→bucket maps instead of allocating a
  fresh string key per link every frame, reducing GC pressure on large vaults.
- The renderable-node ranking is cached and rebuilt only when the graph reloads,
  instead of re-sorting every node on each scene-tuning refresh (e.g. on resize).
- Vault scan guards against symlink cycles via resolved-realpath tracking.
- `scripts/screenshot-presets.js` finds Chrome cross-platform instead of
  assuming the macOS install path.
