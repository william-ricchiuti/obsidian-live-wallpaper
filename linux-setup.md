# Linux Setup

Linux has no single wallpaper engine, but the parser and renderer work identically — you just need a way to pin a browser window behind your desktop. Pick the path that matches your desktop environment.

## Prerequisites

- [Node.js](https://nodejs.org) (v20.19 or newer)
- One of the wallpaper host options below

## Install

```bash
git clone https://github.com/william-ricchiuti/obsidian-live-wallpaper.git
cd obsidian-live-wallpaper
npm install
cp config.example.json config.json
```

Edit `config.json` and set `vaultPath` to your Obsidian vault:

```json
{
  "vaultPath": "/home/you/Documents/MyVault",
  "accent": "#7c5cff",
  "refreshMs": 5000
}
```

## Start the parser

```bash
npm start
```

Keep this terminal open (or run it as a background service — see below).

## Wallpaper host options

### KDE Plasma (HTML wallpaper plugin)

Plasma does not ship a web-page wallpaper type of its own; install one from the
KDE Store first.

1. Right-click your desktop → **Configure Desktop and Wallpaper** → **Get New Plugins…**
2. Search for **HTML Wallpaper** (updated for Plasma 6) and install it.
3. Set **Wallpaper Type** to **HTML Wallpaper** and paste `http://127.0.0.1:3000` as the URL.

### GNOME — Hidamari

[Hidamari](https://github.com/jeffshee/hidamari) is a video/web wallpaper app for GNOME.

1. Install from Flathub:
   ```bash
   flatpak install flathub io.github.jeffshee.Hidamari
   ```
2. Open Hidamari → **Web Page** mode → paste `http://127.0.0.1:3000`.
3. Hidamari will render the page behind your GNOME desktop.

### Tiling WMs / X11 — xwinwrap

[xwinwrap](https://github.com/ujjwal96/xwinwrap) pins any window behind all others on X11. Works with i3, bspwm, awesome, or any X11-based setup.

1. Build xwinwrap:
   ```bash
   sudo apt install xorg-dev build-essential   # Debian/Ubuntu
   git clone https://github.com/ujjwal96/xwinwrap.git
   cd xwinwrap && make && sudo make install
   ```
2. Launch with a browser:
   ```bash
   xwinwrap -fs -fdt -ni -b -nf -un -o 1.0 -- \
     firefox --kiosk http://127.0.0.1:3000 &
   ```
   Replace `firefox` with `chromium-browser` or `google-chrome` if preferred. The flags: `-fs` fullscreen, `-b` below all windows, `-ni` no input.

> **Note**: xwinwrap is X11-only. On Wayland compositors (Sway, Hyprland) there's no drop-in equivalent for web wallpapers yet — check your compositor's layer-shell wallpaper docs, or run a nested X11 session via Xwayland to use xwinwrap.

## Autostart the parser (optional)

The easy way: install the CLI globally, then let it register a systemd user
service for you (run this from the folder where you want the config file to live):

```bash
npm i -g obsidian-live-wallpaper
olw install --vault /home/you/path/to/your/vault
```

It writes the config, then `~/.config/systemd/user/obsidian-live-wallpaper-<id>.service`
(one per config file, so several vaults can coexist) with `Restart=on-failure`,
runs `systemctl --user daemon-reload` and `systemctl --user enable --now`, and
prints the wallpaper URL. Logs: `journalctl --user -u obsidian-live-wallpaper-<id> -f`.

- `olw install --dry-run …` prints the unit and the `systemctl` commands without doing anything.
- `olw uninstall` (add `--config <file>` if you used one) disables and removes it.
- `npx obsidian-live-wallpaper install --vault …` also works, but because npx
  runs from a temporary cache that can be cleared, it stops and asks you to
  install globally first (`--force` overrides that).

The manual options below do the same thing by hand.

### Option A: systemd user service

Save this as `~/.config/systemd/user/vault-wallpaper.service`:

```ini
[Unit]
Description=Obsidian Live Wallpaper parser
After=graphical-session.target

[Service]
Type=simple
WorkingDirectory=/home/you/path/to/obsidian-live-wallpaper
ExecStart=/usr/bin/node parser.js
Restart=on-failure
RestartSec=5

[Install]
WantedBy=default.target
```

Then enable it:

```bash
systemctl --user daemon-reload
systemctl --user enable --now vault-wallpaper
```

Check status with `systemctl --user status vault-wallpaper`.

**Finding your node path**: run `which node` and use the full path in `ExecStart` if `/usr/bin/node` doesn't work (e.g. nvm users might need `/home/you/.nvm/versions/node/vXX.X.X/bin/node`).

### Option B: pm2

```bash
npm install -g pm2
pm2 start parser.js --name vault-wallpaper --stop-exit-codes 0
pm2 save
pm2 startup
```

`--stop-exit-codes 0` keeps pm2 from restarting a clean exit (a second copy exits 0 when the wallpaper is already running). It is documented by pm2, but some older pm2 versions are reported to ignore it.

Follow the instructions pm2 prints to complete the startup hook.

## Troubleshooting

- **Blank wallpaper**: run `curl -s http://127.0.0.1:3000/graph.json | head -c 300` (or open that URL in a browser). If it doesn't answer, the server isn't running; if it answers with no nodes, check the server log (`pm2 logs`, your service manager's log, or the terminal running it) for `vaultPath` or config errors. The graph is served from memory, so a `graph.json` file on disk isn't a reliable signal.
- **Browser window covers desktop icons**: make sure your wallpaper host is pinning the window below all others. With xwinwrap, the `-b` flag handles this.
- **Nodes not updating**: edit a note in Obsidian and check the parser terminal for output like `graph: 42 nodes, 87 links`.
- **Wayland issues**: xwinwrap doesn't work on Wayland. Use KDE's HTML Wallpaper plugin, Hidamari for GNOME, or check your compositor's docs for layer-shell wallpaper support.
- **Performance**: for large vaults (2000+ notes), lower `maxRenderedNodes` (the least important nodes are dropped first), lower `idleFps` (`0` holds the last frame once the layout settles) and `maxFps`, and try `"renderer": "webgl"` (`auto` only switches to WebGL above ~3,000 notes). `refreshMs` won't help: it is only the fallback polling interval used when the live update stream is unavailable.
