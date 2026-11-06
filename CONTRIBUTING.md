# Contributing

Thanks for your interest in improving Obsidian Live Wallpaper.

## Development setup

```bash
git clone https://github.com/william-ricchiuti/obsidian-live-wallpaper.git
cd obsidian-live-wallpaper
npm install
cp config.example.json config.json   # then set vaultPath
npm start
```

The architecture is three independent layers (see the README): `parser.js`
(Node watcher + HTTP server), `index.html` (d3 renderer on a canvas), and
`worker.js` (the force simulation, off the main thread). Keep them decoupled —
the renderer only talks to the server over HTTP (`/graph.json`, `/api/config`)
and the SSE stream (`/events`).

Node 20.19+ is required (chokidar 5's floor); `.nvmrc` pins 22 for development.

## Tests

```bash
npm test          # parser/server smoke + renderer smoke
npm run smoke         # parser & HTTP handler only (no browser needed)
npm run smoke:render  # renderer in headless Chrome (skips if no Chrome found)
npm run lint          # ESLint over the .js files and the inline scripts in the two HTML pages
npm run lint:html     # just the inline scripts in index.html/settings.html
```

`npm run smoke:render` looks for Chrome/Chromium automatically. To point it at a
specific binary, set `CHROME=/path/to/chrome`. When `CI` is set, or with
`OLW_REQUIRE_CHROME=1`, a missing Chrome fails the test instead of skipping it.
CI runs the full suite on Node 20.19, 22 and 24.

Please add or update a smoke assertion when you change parser behavior, the
config schema, or the render pipeline.

## Working with presets

Presets live in `presets.json`. Each must be placeable on the five theme axes in
`docs/theme-axes.md` and should differ from existing presets on at least two
axes. After adding or changing a preset, regenerate its thumbnail:

```bash
npm start                                   # in one terminal
node scripts/screenshot-presets.js new      # in another
```

Thumbnails are written to `docs/presets/<name>.png` and shown in the settings
preset picker.

Thumbnails are a maintainer tool: `scripts/` is not shipped in the npm package,
but `docs/presets/` is (the settings page serves the thumbnails at runtime).

## Updating the vendored D3

`vendor/d3.min.js` is the stock D3 bundle (currently 7.9.0), vendored so the
wallpaper works offline. To update it:

```bash
npm pack d3@7.9.0            # or the new version; downloads d3-<version>.tgz
tar -xzf d3-*.tgz package/dist/d3.min.js
mv package/dist/d3.min.js vendor/d3.min.js && rm -rf package d3-*.tgz
head -c 60 vendor/d3.min.js  # banner should show the new version
npm test                     # renderer smoke exercises the new bundle
```

Bump the version mentioned here and note it in `CHANGELOG.md`. Check D3's
release notes for API changes in `d3-force`, which `worker.js` and
`layout-core.js` rely on.

## Config schema

All configurable fields are defined once in the `VALIDATORS` table in
`parser.js`, which drives persisted-config validation, the live patch endpoint,
and the `/api/defaults` response. Add new options there (and to the `DEFAULTS`
block in both `parser.js` and `index.html`) rather than scattering validation.

## Pull requests

- Keep changes focused and described.
- Run `npm test` before opening the PR.
- For visual changes, include a before/after screenshot.
