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
the renderer only knows about `graph.json`, `/api/config`, and the SSE stream.

## Tests

```bash
npm test          # parser/server smoke + renderer smoke
npm run smoke         # parser & HTTP handler only (no browser needed)
npm run smoke:render  # renderer in headless Chrome (skips if no Chrome found)
```

`npm run smoke:render` looks for Chrome/Chromium automatically. To point it at a
specific binary, set `CHROME=/path/to/chrome`. CI runs the full suite on Node
18, 20, and 22.

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

## Config schema

All configurable fields are defined once in the `VALIDATORS` table in
`parser.js`, which drives persisted-config validation, the live patch endpoint,
and the `/api/defaults` response. Add new options there (and to the `DEFAULTS`
block in both `parser.js` and `index.html`) rather than scattering validation.

## Pull requests

- Keep changes focused and described.
- Run `npm test` before opening the PR.
- For visual changes, include a before/after screenshot.
