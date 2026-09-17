# Windows Setup

## Prerequisites

- [Node.js](https://nodejs.org) (v20+)
- [Lively Wallpaper](https://www.rocksdanister.com/lively/) — free, open-source wallpaper engine from the Microsoft Store or GitHub

## Install

```powershell
git clone https://github.com/william-ricchiuti/obsidian-live-wallpaper.git
cd obsidian-live-wallpaper
npm install
copy config.example.json config.json
```

Edit `config.json` and set `vaultPath` to your Obsidian vault. Use forward slashes or escaped backslashes:

```json
{
  "vaultPath": "C:/Users/You/Documents/MyVault",
  "accent": "#7c5cff",
  "refreshMs": 5000
}
```

## Start the parser

```powershell
npm start
```

Keep this terminal open (or run it as a background service — see below).

## Set up Lively Wallpaper

1. Open Lively Wallpaper.
2. Click the **+** button → **Open URL** → paste `http://127.0.0.1:3000`.
3. Lively will render the local wallpaper server as your desktop wallpaper.

### Recommended Lively settings

- **Playback**: keep running (so the animation stays alive)
- **Input forwarding**: off (clicks pass through to desktop)
- **Pause rule**: set to "Nothing" so the wallpaper stays active

## Autostart the parser (optional)

### Option A: Task Scheduler

1. Open **Task Scheduler** → Create Basic Task.
2. **Trigger**: At logon.
3. **Action**: Start a program.
   - **Program**: `node` (or the full path, e.g. `C:\Program Files\nodejs\node.exe`)
   - **Arguments**: `parser.js`
   - **Start in**: `C:\Users\You\path\to\obsidian-live-wallpaper`
4. Check "Open the Properties dialog" → under General, check **Run whether user is logged on or not** if you want it truly background.

### Option B: pm2

```powershell
npm install -g pm2
pm2 start parser.js --name vault-wallpaper
pm2 save
pm2 startup
```

## Troubleshooting

- **Blank wallpaper**: check that `graph.json` exists in the project folder. If not, the parser isn't running or `vaultPath` is wrong.
- **Lively shows a white page**: make sure the parser is running and Lively is pointed at `http://127.0.0.1:3000`.
- **Backslash paths not working**: use forward slashes (`C:/Users/...`) in `config.json` — Node.js handles them fine on Windows.
- **Nodes not updating**: edit a note in Obsidian and check the parser terminal for output like `graph: 42 nodes, 87 links`.
- **Performance**: if your vault is 2000+ notes, increase `refreshMs` to 10000 in `config.json`.
