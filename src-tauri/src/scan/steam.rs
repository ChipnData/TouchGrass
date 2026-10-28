//! Steam: installed games from appmanifest files, playtime/last-played from the
//! signed-in user's localconfig.vdf, and (optionally) uninstalled owned games
//! from the Steam Web API.

use super::{vdf, Game, Launch, ScanOpts};
use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::time::Duration;

pub struct SteamScan {
    pub found: bool,
    pub games: Vec<Game>,
    pub warnings: Vec<String>,
    pub steam_id: Option<String>,
}

const STEAMID64_BASE: u64 = 76_561_197_960_265_728;

/// Steam tools/runtimes that should never show up as games.
const SKIP_APPIDS: &[u64] = &[
    228980,  // Steamworks Common Redistributables
    1070560, // Steam Linux Runtime
    1391110, // Steam Linux Runtime - Soldier
    1628350, // Steam Linux Runtime - Sniper
    1493710, // Proton Experimental
    250820,  // SteamVR
];

pub fn steam_root() -> Option<PathBuf> {
    #[cfg(windows)]
    {
        use super::reg;
        let candidates = [
            reg::get_str(&reg::hkcu(), r"Software\Valve\Steam", "SteamPath"),
            reg::get_str(&reg::hklm(), r"SOFTWARE\WOW6432Node\Valve\Steam", "InstallPath"),
            Some(r"C:\Program Files (x86)\Steam".to_string()),
        ];
        for c in candidates.into_iter().flatten() {
            let p = PathBuf::from(c.replace('/', "\\"));
            if p.join("steamapps").exists() {
                return Some(p);
            }
        }
        None
    }
    #[cfg(not(windows))]
    {
        let home = std::env::var_os("HOME")?;
        [".steam/steam", ".local/share/Steam"]
            .iter()
            .map(|c| Path::new(&home).join(c))
            .find(|p| p.join("steamapps").exists())
    }
}

pub fn scan(opts: &ScanOpts) -> Result<SteamScan, String> {
    let Some(root) = steam_root() else {
        return Ok(SteamScan { found: false, games: vec![], warnings: vec![], steam_id: None });
    };
    let mut s = scan_root(&root);
    let steam_id = opts
        .steam_id
        .clone()
        .filter(|x| !x.trim().is_empty())
        .or_else(|| s.steam_id.clone());
    let key = opts.steam_api_key.as_deref().map(str::trim).filter(|k| !k.is_empty());
    if let (Some(key), Some(id)) = (key, steam_id.as_deref()) {
        match owned_games(key, id.trim()) {
            Ok(owned) => merge_owned(&mut s.games, owned),
            Err(e) => s.warnings.push(format!("Steam owned-games lookup failed: {e}")),
        }
    }
    Ok(s)
}

fn read_vdf(p: &Path) -> Option<vdf::Vdf> {
    std::fs::read_to_string(p).ok().map(|s| vdf::parse(&s))
}

fn library_dirs(root: &Path) -> Vec<PathBuf> {
    let mut libs = vec![root.to_path_buf()];
    if let Some(v) = read_vdf(&root.join("steamapps").join("libraryfolders.vdf")) {
        if let Some(lf) = v.get("libraryfolders") {
            for (_, entry) in lf.entries() {
                let path = match entry {
                    vdf::Vdf::Str(s) => Some(s.as_str()),
                    obj => obj.get_str("path"),
                };
                if let Some(p) = path {
                    libs.push(PathBuf::from(p));
                }
            }
        }
    }
    let mut seen = HashSet::new();
    libs.retain(|p| seen.insert(p.to_string_lossy().to_lowercase().replace('/', "\\")));
    libs
}

/// Returns (steamid64, account id) for the most recently signed-in user.
fn current_user(root: &Path) -> Option<(String, u64)> {
    let v = read_vdf(&root.join("config").join("loginusers.vdf"))?;
    let users = v.get("users")?;
    let pick = users
        .entries()
        .iter()
        .find(|(_, u)| u.get_str("MostRecent") == Some("1"))
        .or_else(|| users.entries().first())?;
    let id64: u64 = pick.0.parse().ok()?;
    Some((pick.0.clone(), id64.checked_sub(STEAMID64_BASE)?))
}

fn localconfig_path(root: &Path, account: Option<u64>) -> Option<PathBuf> {
    let ud = root.join("userdata");
    if let Some(a) = account {
        let p = ud.join(a.to_string()).join("config").join("localconfig.vdf");
        if p.exists() {
            return Some(p);
        }
    }
    // Fall back to the most recently modified profile.
    std::fs::read_dir(&ud)
        .ok()?
        .flatten()
        .map(|e| e.path().join("config").join("localconfig.vdf"))
        .filter(|p| p.exists())
        .max_by_key(|p| p.metadata().and_then(|m| m.modified()).ok())
}

pub fn cdn_cover(appid: u64) -> String {
    format!("https://shared.steamstatic.com/store_item_assets/steam/apps/{appid}/library_600x900.jpg")
}

fn local_cover(root: &Path, appid: u64) -> Option<String> {
    let lc = root.join("appcache").join("librarycache");
    let direct = [
        lc.join(format!("{appid}_library_600x900.jpg")),
        lc.join(appid.to_string()).join("library_600x900.jpg"),
    ];
    if let Some(p) = direct.iter().find(|p| p.exists()) {
        return Some(p.to_string_lossy().into_owned());
    }
    // Newer clients nest art in a hashed subfolder.
    std::fs::read_dir(lc.join(appid.to_string()))
        .ok()?
        .flatten()
        .map(|e| e.path().join("library_600x900.jpg"))
        .find(|p| p.exists())
        .map(|p| p.to_string_lossy().into_owned())
}

pub fn scan_root(root: &Path) -> SteamScan {
    let user = current_user(root);
    let mut stats: HashMap<u64, (Option<u64>, Option<u64>)> = HashMap::new();
    if let Some(lc) = localconfig_path(root, user.as_ref().map(|u| u.1)).and_then(|p| read_vdf(&p)) {
        if let Some(apps) = lc.path(&["UserLocalConfigStore", "Software", "Valve", "Steam", "apps"]) {
            for (id, a) in apps.entries() {
                if let Ok(id) = id.parse::<u64>() {
                    let last = a.get_u64("LastPlayed").filter(|&t| t > 0);
                    let play = a.get_u64("Playtime").filter(|&m| m > 0);
                    stats.insert(id, (last, play));
                }
            }
        }
    }

    let mut games = Vec::new();
    let mut seen = HashSet::new();
    for lib in library_dirs(root) {
        let apps_dir = lib.join("steamapps");
        let Ok(rd) = std::fs::read_dir(&apps_dir) else { continue };
        for e in rd.flatten() {
            let name = e.file_name().to_string_lossy().to_string();
            if !(name.starts_with("appmanifest_") && name.ends_with(".acf")) {
                continue;
            }
            let Some(v) = read_vdf(&e.path()) else { continue };
            let Some(a) = v.get("AppState") else { continue };
            let Some(appid) = a.get_u64("appid") else { continue };
            let Some(title) = a.get_str("name").map(str::to_string) else { continue };
            if SKIP_APPIDS.contains(&appid)
                || title.starts_with("Proton ")
                || title.starts_with("Steamworks")
                || !seen.insert(appid)
            {
                continue;
            }
            let flags = a.get_u64("StateFlags").unwrap_or(4);
            let (last, play) = stats.get(&appid).copied().unwrap_or((None, None));
            games.push(Game {
                id: format!("steam:{appid}"),
                source: "Steam".into(),
                title,
                installed: flags & 4 != 0,
                launch: Launch::Uri { uri: format!("steam://rungameid/{appid}") },
                install_dir: a
                    .get_str("installdir")
                    .map(|d| apps_dir.join("common").join(d).to_string_lossy().into_owned()),
                cover: Some(local_cover(root, appid).unwrap_or_else(|| cdn_cover(appid))),
                playtime_min: play,
                last_played: last,
                store_url: Some(format!("https://store.steampowered.com/app/{appid}")),
                size_bytes: a.get_u64("SizeOnDisk"),
            });
        }
    }
    SteamScan { found: true, games, warnings: vec![], steam_id: user.map(|u| u.0) }
}

fn owned_games(key: &str, steam_id: &str) -> Result<Vec<Game>, String> {
    let url = format!(
        "https://api.steampowered.com/IPlayerService/GetOwnedGames/v1/?key={}&steamid={}&include_appinfo=1&include_played_free_games=1&format=json",
        crate::covers::urlencode(key),
        crate::covers::urlencode(steam_id)
    );
    let agent = ureq::AgentBuilder::new().timeout(Duration::from_secs(15)).build();
    let v: serde_json::Value = agent
        .get(&url)
        .call()
        .map_err(|e| e.to_string())?
        .into_json()
        .map_err(|e| e.to_string())?;
    let list = v["response"]["games"].as_array().cloned().unwrap_or_default();
    Ok(list
        .into_iter()
        .filter_map(|g| {
            let appid = g["appid"].as_u64()?;
            let title = g["name"].as_str()?.to_string();
            Some(Game {
                id: format!("steam:{appid}"),
                source: "Steam".into(),
                title,
                installed: false,
                launch: Launch::Uri { uri: format!("steam://install/{appid}") },
                install_dir: None,
                cover: Some(cdn_cover(appid)),
                playtime_min: g["playtime_forever"].as_u64().filter(|&m| m > 0),
                last_played: g["rtime_last_played"].as_u64().filter(|&t| t > 0),
                store_url: Some(format!("https://store.steampowered.com/app/{appid}")),
                size_bytes: None,
            })
        })
        .collect())
}

fn merge_owned(games: &mut Vec<Game>, owned: Vec<Game>) {
    let mut index: HashMap<String, usize> =
        games.iter().enumerate().map(|(i, g)| (g.id.clone(), i)).collect();
    for o in owned {
        if SKIP_APPIDS.iter().any(|a| o.id == format!("steam:{a}")) {
            continue;
        }
        match index.get(&o.id) {
            Some(&i) => {
                let g = &mut games[i];
                g.playtime_min = g.playtime_min.max(o.playtime_min);
                g.last_played = g.last_played.max(o.last_played);
            }
            None => {
                index.insert(o.id.clone(), games.len());
                games.push(o);
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    #[test]
    fn scans_fake_steam_install() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().join("Steam");
        let lib2 = dir.path().join("Lib2");
        fs::create_dir_all(root.join("steamapps")).unwrap();
        fs::create_dir_all(lib2.join("steamapps")).unwrap();
        fs::create_dir_all(root.join("config")).unwrap();
        fs::create_dir_all(root.join("userdata/12345/config")).unwrap();
        fs::write(
            root.join("steamapps/libraryfolders.vdf"),
            format!(
                "\"libraryfolders\"\n{{\n \"0\" {{ \"path\" \"{}\" }}\n \"1\" {{ \"path\" \"{}\" }}\n}}",
                root.display(),
                lib2.display()
            ),
        )
        .unwrap();
        fs::write(
            root.join("steamapps/appmanifest_1086940.acf"),
            "\"AppState\" { \"appid\" \"1086940\" \"name\" \"Baldur's Gate 3\" \"StateFlags\" \"4\" \"installdir\" \"Baldurs Gate 3\" \"SizeOnDisk\" \"1000\" }",
        )
        .unwrap();
        fs::write(
            lib2.join("steamapps/appmanifest_228980.acf"),
            "\"AppState\" { \"appid\" \"228980\" \"name\" \"Steamworks Common Redistributables\" \"StateFlags\" \"4\" }",
        )
        .unwrap();
        fs::write(
            lib2.join("steamapps/appmanifest_1245620.acf"),
            "\"AppState\" { \"appid\" \"1245620\" \"name\" \"ELDEN RING\" \"StateFlags\" \"4\" \"installdir\" \"ELDEN RING\" }",
        )
        .unwrap();
        let id64 = STEAMID64_BASE + 12345;
        fs::write(
            root.join("config/loginusers.vdf"),
            format!("\"users\" {{ \"{id64}\" {{ \"AccountName\" \"me\" \"MostRecent\" \"1\" }} }}"),
        )
        .unwrap();
        fs::write(
            root.join("userdata/12345/config/localconfig.vdf"),
            "\"UserLocalConfigStore\" { \"Software\" { \"Valve\" { \"Steam\" { \"apps\" { \"1086940\" { \"LastPlayed\" \"1761600000\" \"Playtime\" \"8520\" } } } } } }",
        )
        .unwrap();

        let s = scan_root(&root);
        assert_eq!(s.steam_id.as_deref(), Some(id64.to_string().as_str()));
        assert_eq!(s.games.len(), 2, "{:?}", s.games);
        let bg3 = s.games.iter().find(|g| g.id == "steam:1086940").unwrap();
        assert_eq!(bg3.playtime_min, Some(8520));
        assert_eq!(bg3.last_played, Some(1761600000));
        assert!(bg3.installed);
        assert!(s.games.iter().any(|g| g.title == "ELDEN RING"));
    }
}
