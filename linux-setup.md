# Linux Setup

Linux has no single wallpaper engine, but the parser and renderer work identically — you just need a way to pin a browser window behind your desktop. Pick the path that matches your desktop environment.

## Prerequisites

- [Node.js](https://nodejs.org) (v20+)
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

### KDE Plasma (native support)

KDE Plasma can use a web page as a wallpaper with no extra software.

1. Right-click your desktop → **Configure Desktop and Wallpaper**.
2. Set **Wallpaper Type** to **Web Page**.
3. Paste `http://127.0.0.1:3000` as the URL.

That's it — KDE handles the rest.

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
pm2 start parser.js --name vault-wallpaper
pm2 save
pm2 startup
```

Follow the instructions pm2 prints to complete the startup hook.

## Troubleshooting

- **Blank wallpaper**: check that `graph.json` exists in the project folder. If not, the parser isn't running or `vaultPath` is wrong.
- **Browser window covers desktop icons**: make sure your wallpaper host is pinning the window below all others. With xwinwrap, the `-b` flag handles this.
- **Nodes not updating**: edit a note in Obsidian and check the parser terminal for output like `graph: 42 nodes, 87 links`.
- **Wayland issues**: xwinwrap doesn't work on Wayland. Use KDE's native web wallpaper, Hidamari for GNOME, or check your compositor's docs for layer-shell wallpaper support.
- **Performance**: if your vault is 2000+ notes, increase `refreshMs` to 10000 in `config.json`.
