# Touch Grass

A lightweight game launcher for Windows. It puts every game you own in one place, along with your everyday apps and websites, and has a full-screen Big Screen mode for the couch. It's built with Tauri on Windows' built-in WebView2, so the installer is a few MB and it does no background polling: when it sits idle in the tray it uses no CPU.

## What it does

**Games**
- Finds installed games from **Steam, Epic, GOG, Battle.net, Xbox / PC Game Pass, EA, Ubisoft Connect, Amazon Games and Humble**.
- Custom games: any `.exe`, shortcut or `.bat`. Add one with **+**, **Ctrl+N**, or by dragging it onto the window.
- Steam playtime and last-played times come straight from Steam. Custom games have their playtime tracked.
- Optional: a Steam Web API key adds your *uninstalled* Steam games, and Play then becomes Install.
- **Cover art.** Steam art comes from Steam itself (no setup). Xbox art comes from the game. For everything else, add a free SteamGridDB key: Touch Grass fills in covers automatically, and the cover picker lets you browse alternatives or use your own picture.
- **Game details page:** playtime, last played, size, open folder, store page, uninstall, hide.
- **Collections:** make your own groups, such as "Couch co-op". They show as filters and as rows in Big Screen.
- **Now Playing:** shows which game is running, with a **Close game** button.
- Pinned games, hidden games, sorting (recent / recently added / A–Z / most played / by store), and "Surprise me" random pick.

**Programs**
- Scans the Start menu for apps. Browsers and common apps start switched on; tick on or off anything else under **Choose apps**.
- **Websites:** one-click tiles for Facebook, YouTube, Gmail and other sites, chosen from a ready-made list or by typing any address. Each site can open as a normal browser tab or as an **app window** with no tabs or address bar, which is simpler for anyone who finds browsers confusing.

**Store**
- **Stores:** opens each store's own app, or its website.
- **Deals:** live discounts across Steam, GOG, Humble, Epic, Fanatical and Green Man Gaming (prices from CheapShark). Games you already own are marked. Steam deals open in Steam.
- **Free games:** this week's and next week's Epic freebies, plus free-to-keep games on other stores.
- **Game Pass:** the full PC Game Pass catalog, searchable, with installed games marked.

**Big Screen** (F11, the TV button, the ☰ button on a controller, or holding **View + Menu** from anywhere)
- Full-screen, controller-first: Home (continue playing, recent, pinned, collections, recently added, apps), Games, Apps and Store.
- On-screen keyboard for search. LB/RB switch sections, X opens options, and ☰ opens the power menu.
- **Power menu:** Exit Big Screen, Sleep, Restart, Shut down, Sign out, Quit.

**Look & feel**
- Themes: **Meadow** (default), Picnic (light), Campfire, Lake, Night Sky, Sunset and High Contrast.
- Custom accent color, optional background picture with blur and dimming, and tile size.
- Export your theme to a file to share it, or import one someone sent you.

**Startup** (everything off by default)
- *Settings → Start with Windows.* When Windows starts, Touch Grass can open **in the tray**, **as a window**, or **straight into Big Screen** (console mode).

**Other**
- Tray icon with your 8 most recent games and a Big Screen shortcut.
- Global hotkey **Ctrl+Shift+Space**.
- Full keyboard and controller navigation everywhere.
- Backup and restore of all settings to one file.
- Automatic updates (see below).
- Moving from the old "Lumen" version: your settings, custom games and pins come across automatically.

## Limits worth knowing

- **Store apps are still required.** Steam, Epic, Battle.net and the others handle sign-in, DRM, downloads and updates. Touch Grass launches games through them.
- **Installed games only for most stores.** Epic, GOG, Battle.net, Xbox, EA, Ubisoft, Amazon and Humble have no public library API, so only installed games appear. Steam can show uninstalled games with a key.
- **Battle.net:** games with a known product code (WoW, Diablo II/III/IV, Overwatch, Hearthstone, StarCraft I/II, Warcraft III, Heroes) launch directly. Others, such as Call of Duty, open the Battle.net app.
- **EA:** games are found from their installer entries and started through their own exe, which hands off to the EA app. This hasn't been tested against every EA title.
- **Not yet supported:** itch.io and Rockstar. Add those games as custom games for now.
- **Controller summon (View + Menu)** works with Xbox-compatible controllers. PlayStation controllers work while Steam is running, because Steam presents them as Xbox controllers. Some exclusive-fullscreen games keep Touch Grass from appearing on top.
- **Close game** force-closes the game, so anything unsaved is lost. You'll always be asked first.
- Deals and Game Pass are shown for the **US store** and in USD.

## Build it

### With GitHub (no tools needed on your PC)
1. Upload this folder to your GitHub repository.
2. Go to **Actions → Build Windows installer → Run workflow**.
3. Download the **TouchGrass-windows** artifact when it finishes. It contains `Touch Grass_0.2.0_x64-setup.exe`.

### On your PC
1. Install **Rust** from https://rustup.rs (say yes to the Visual Studio C++ Build Tools).
2. Install **Node.js LTS** from https://nodejs.org.
3. Run `npm install`, then `npm run build`.
4. The installer is in `src-tauri\target\release\bundle\nsis\`.

Run `npm run dev` for live development.

## Automatic updates (optional)

Touch Grass checks `https://github.com/ChipnData/TouchGrass/releases/latest/download/latest.json` for new versions. To turn this on:

1. **Rename the repository to `TouchGrass`** (Settings → General → Repository name). If you use a different name or owner, change the address under `plugins.updater.endpoints` in `src-tauri/tauri.conf.json`.
2. **Make the repository public**, or create a separate public repository just for releases. A private repository's downloads can't be reached by the app.
3. **Add two secrets** (Settings → Secrets and variables → Actions → New repository secret):
   - `TAURI_SIGNING_PRIVATE_KEY`: the full contents of `touchgrass.key`
   - `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`: the password from `password.txt`
4. To publish a version: change `"version"` in `src-tauri/tauri.conf.json` (for example to `0.2.1`), then go to **Actions → Publish release → Run workflow**. Every installed copy offers the update on its next start.

Keep the key and password safe and **never upload them into the repository**. If they're lost, existing installs can't verify future updates, and everyone would need to reinstall once.

## Where things are stored
`%APPDATA%\com.touchgrass.launcher\data.json` holds settings, custom games, pins, collections, websites and themes. App icons are cached in `%LOCALAPPDATA%\com.touchgrass.launcher\`.

## Project layout
```
ui/                         Frontend (plain HTML/CSS/JS, no build step)
  css/app.css               Desktop styles and theme tokens
  css/bigscreen.css         Big Screen styles
  js/core.js                Shared state, helpers, cover art fallbacks
  js/themes.js              Theme system
  js/games.js               Library, actions, collections, scanning, art, now playing
  js/details.js             Game details and cover picker
  js/programs.js            Programs and websites
  js/store.js               Stores, deals, free games, Game Pass
  js/settings.js            Settings, updates, backup
  js/bigscreen.js           Big Screen mode
  js/input.js               Keyboard and controller input
  js/main.js                Start-up and wiring
src-tauri/src/
  lib.rs                    App setup, tray, hotkey, commands
  scan/                     One scanner per store (+ Valve KeyValues parser)
  covers.rs                 Steam art and SteamGridDB
  deals.rs                  CheapShark, Epic free games, Game Pass catalog
  programs.rs               Start-menu apps and icons
  system.rs                 Power, websites, running games, backup, migration
  controller.rs             View + Menu summon (XInput)
  launch.rs                 Launching games and links
  data.rs                   data.json
```
