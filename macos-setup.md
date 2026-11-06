# macOS Setup

## Plash configuration

1. Install [Plash](https://apps.apple.com/us/app/plash/id1494023538) from the Mac App Store.
2. Plash menu bar → **Add Website** → paste `http://127.0.0.1:3000`.
3. **Browsing Mode**: off (so clicks pass through to your desktop).
4. **Opacity**: 100%. **Invert colors**: off.
5. **Reload interval**: leave blank — the renderer updates itself live over a
   server-sent-events stream as your vault changes, with `refreshMs` in
   `config.json` only as a periodic fallback. No page reload needed.

## Autostart the parser

Save this as `~/Library/LaunchAgents/com.user.vaultwallpaper.plist`, edit the two paths, then run `launchctl load ~/Library/LaunchAgents/com.user.vaultwallpaper.plist`.

Find your node path first: run `which node` in Terminal and paste the result below.

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>com.user.vaultwallpaper</string>
  <key>ProgramArguments</key>
  <array>
    <string>PASTE_OUTPUT_OF_WHICH_NODE</string>
    <string>/Users/YOU/path/to/obsidian-live-wallpaper/parser.js</string>
  </array>
  <key>WorkingDirectory</key><string>/Users/YOU/path/to/obsidian-live-wallpaper</string>
  <key>RunAtLoad</key><true/>
  <!-- Restart only after a crash. A clean exit (for example "already running"
       when another copy holds the port) must not be restarted, or launchd
       relaunches it every 10 seconds forever. -->
  <key>KeepAlive</key><dict><key>SuccessfulExit</key><false/></dict>
  <key>StandardOutPath</key><string>/Users/YOU/Library/Logs/obsidian-live-wallpaper.log</string>
  <key>StandardErrorPath</key><string>/Users/YOU/Library/Logs/obsidian-live-wallpaper.log</string>
</dict></plist>
```

The server's output (startup lines, `graph: … nodes` after each edit, errors)
goes to `~/Library/Logs/obsidian-live-wallpaper.log`; open it in Console.app
or run `tail -f ~/Library/Logs/obsidian-live-wallpaper.log`.

**Common node paths:**
- Apple Silicon (M1/M2/M3/M4): `/opt/homebrew/bin/node`
- Intel Mac (Homebrew): `/usr/local/bin/node`
- nvm: `/Users/YOU/.nvm/versions/node/vXX.X.X/bin/node` (launchctl does not expand `~` — use the full absolute path)

## Troubleshooting

- **Blank wallpaper**: run `curl -s http://127.0.0.1:3000/graph.json | head -c 300` (or open that URL in a browser). If it doesn't answer, the server isn't running; if it answers with no nodes, check the server log (the terminal running it, or your launchd/pm2 log) for `vaultPath` or config errors. The graph is served from memory, so a `graph.json` file on disk isn't a reliable signal.
- **Plash shows "file not found"**: make sure the parser is running and the URL is `http://127.0.0.1:3000`, not a `file:///` path.
- **Nodes not updating**: confirm chokidar is watching by editing a note and checking the parser's terminal output.
- **Performance**: for large vaults (2000+ notes), lower `maxRenderedNodes` (the least important nodes are dropped first), lower `idleFps` (`0` holds the last frame once the layout settles) and `maxFps`, and try `"renderer": "webgl"` (`auto` only switches to WebGL above ~3,000 notes). `refreshMs` won't help: it is only the fallback polling interval used when the live update stream is unavailable.
