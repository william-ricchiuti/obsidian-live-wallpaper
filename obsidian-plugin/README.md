# Live Wallpaper Bridge (Obsidian plugin)

A small companion plugin for [obsidian-live-wallpaper](../README.md). It gives the
wallpaper server Obsidian's own view of your vault instead of the server's regex scan:

- **graph.json**: every note, its resolved links (Obsidian's own link resolution),
  unresolved links as ghost nodes, and tags from Obsidian's metadata cache.
- **active.json**: the note you have open, so the wallpaper can highlight it
  (`highlightActiveNote`).

Both files are written to this plugin's own folder,
`<vault>/.obsidian/plugins/live-wallpaper-bridge/`. Nothing leaves your machine and the
plugin makes no network requests. The wallpaper server watches the files. With
`graphSource: "auto"` (the default) it uses the plugin's graph while it is fresh, and falls
back to its own scan when notes changed while Obsidian was closed, until the plugin
writes again.

## Install (manual)

1. Create the folder `<your vault>/.obsidian/plugins/live-wallpaper-bridge/`.
2. Copy `main.js` and `manifest.json` from this directory into it.
3. In Obsidian open **Settings → Community plugins**, turn off Restricted mode if it is on,
   click the reload icon next to "Installed plugins", and enable **Live Wallpaper Bridge**.
4. Within a couple of seconds `graph.json` and `active.json` appear in that folder, and the
   wallpaper settings page shows "Live graph source: Obsidian plugin".

The server only looks for the plugin under `.obsidian`. If you changed Obsidian's config
folder (Settings → Files and links → "Override config folder"), it won't find the files.

## Notes

- No build step and no dependencies: `main.js` is plain CommonJS that only uses the
  `obsidian` module Obsidian provides.
- It only uses the vault adapter, so it loads on mobile too, but the wallpaper server
  runs on desktop.
- Listing it in Obsidian's community plugin directory is a separate step (its own repo with
  a release carrying `main.js` and `manifest.json`, then a PR to
  `obsidianmd/obsidian-releases`). Until then, install it by hand as above.
