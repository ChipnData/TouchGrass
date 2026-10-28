# Lumen

A lightweight game launcher for Windows that puts your Steam, Epic, Battle.net, Xbox (PC Game Pass) and custom games in one place. It's built with Tauri on Windows' built-in WebView2, so the installer is a few MB rather than hundreds. Lumen does no background polling: when it's idle in the tray it uses no CPU.

## Features

**Library**
- Finds installed games automatically: Steam (all library folders), Epic, Battle.net and Xbox/Game Pass.
- Steam playtime and last-played times come straight from the Steam app, with no account setup.
- Optional: add a Steam Web API key to also see your *uninstalled* Steam games (Play becomes Install).
- Custom games: any `.exe`, shortcut (`.lnk`/`.url`) or `.bat`, with launch options. Add them with **+**, **Ctrl+N**, or by dragging files onto the window.
- Playtime is tracked for custom `.exe` games.
- Cover art: Steam art from your local Steam cache (falls back to Steam's CDN), Xbox art from the game's package. Other games get a generated tile, or real covers with a free SteamGridDB key. You can also pick any image yourself.

**Quality of life**
- Continue-playing hero, pinned games, hide games, and sorting (recent / A–Z / most played / by store).
- Filter chips per store, plus an "installed only" toggle.
- Type anywhere to search (matches initials too, e.g. `bg3`). Press Enter to launch the top match.
- Full keyboard navigation with arrow keys, Enter, Ctrl+D (pin) and the Menu key.
- Controller support (Xbox/PlayStation pads via Windows). Use D-pad or stick to move, A to play, B to go back, X for options, Y to pin, and LB/RB to switch store.
- Global hotkey **Ctrl+Shift+Space** shows or hides Lumen from anywhere.
- Tray icon whose menu lists your 8 most recent games for one-click launching.
- Optional: hide Lumen automatically when a game starts.
- "Surprise me" picks a random installed game.
- The library appears instantly from cache, and the rescan runs in the background.
- Only one copy runs; launching it again just brings the window forward.
- Remembers window size and position.

**Startup (your choice, off by default)**
- *Settings → Start with Windows*. This uses the standard per-user Run entry, so it also shows in Task Manager's Startup tab.
- *Start in the tray*: when started with Windows, Lumen sits in the tray instead of opening the window.

**Stores**
- Steam, Epic, Xbox and Battle.net storefronts open in Lumen's own store window, and sign-ins are remembered. There's also an "Open in browser" button for each.

## Limits

- **The store apps are still required.** Steam, Epic, Battle.net and the Xbox app handle sign-in, DRM, downloads and updates. Lumen launches games through them, and they can stay minimized in the tray.
- **Xbox and Battle.net show installed games only.** Neither offers a public API for your full owned library.
- **Epic shows installed games only** (no official public library API).
- **Battle.net**: games with a known product code (WoW, Diablo II/III/IV, Overwatch, Hearthstone, StarCraft I/II, Warcraft III, Heroes of the Storm) launch directly. Others, such as Call of Duty, open the Battle.net app on the game so you can press Play.
- **Xbox detection** covers modern PC Game Pass/GDK games, which are nearly all current titles. Some very old Microsoft Store titles may not appear; add those as custom games.
- **Playtime tracking** works for custom `.exe` games. Steam playtime comes from Steam itself. Epic, Battle.net and Xbox don't store playtime locally, so only last-launched times appear there.

## Build it

### Option A: let GitHub build it (no tools needed on your PC)
1. Create a new GitHub repository and upload this folder.
2. Go to **Actions → Build Windows installer → Run workflow**.
3. After about 10 minutes, download the **Lumen-windows** artifact. It contains `Lumen_0.1.0_x64-setup.exe`.

### Option B: build on your PC
1. Install **Rust** from https://rustup.rs (accept the defaults; it offers to install the Visual Studio C++ Build Tools, so say yes).
2. Install **Node.js LTS** from https://nodejs.org.
3. In this folder run:
   ```
   npm install
   npm run build
   ```
4. The installer is at `src-tauri\target\release\bundle\nsis\Lumen_0.1.0_x64-setup.exe`.

For development with live reload, run `npm run dev`.

Windows SmartScreen will warn about the installer because it isn't code-signed. Choose **More info → Run anyway**.

## Where things are stored
Settings, custom games, pins and playtime live in `%APPDATA%\com.lumen.launcher\data.json`. Delete it to reset Lumen.

## Project layout
```
ui/                    Frontend: index.html, style.css, app.js (no framework, no build step)
src-tauri/src/
  lib.rs               App setup: tray, hotkey, startup, windows, commands
  scan/steam.rs        Steam libraries, playtime, owned games (Web API)
  scan/epic.rs         Epic install manifests
  scan/bnet.rs         Battle.net games from the registry
  scan/xbox.rs         Game Pass / Xbox app games via PowerShell
  scan/vdf.rs          Valve KeyValues parser
  launch.rs            Launching games, opening folders and links
  covers.rs            SteamGridDB cover lookup
  data.rs              data.json read/write
```
