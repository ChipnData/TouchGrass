//! Library scanners for each store. Everything here reads local files or the
//! registry; only the optional Steam "owned games" lookup touches the network.

pub mod bnet;
pub mod epic;
pub mod steam;
pub mod vdf;
pub mod xbox;

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum Launch {
    /// A URI handed to the shell (steam://, com.epicgames.launcher://, shell:AppsFolder\...).
    Uri { uri: String },
    /// A program started directly.
    Exe {
        path: String,
        #[serde(default)]
        args: String,
        #[serde(default)]
        cwd: Option<String>,
    },
    /// Battle.net: `Battle.net.exe --exec="launch <code>"`.
    BnetExec { exe: String, code: String },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Game {
    pub id: String,
    pub source: String,
    pub title: String,
    pub installed: bool,
    pub launch: Launch,
    pub install_dir: Option<String>,
    /// Local file path or https URL.
    pub cover: Option<String>,
    pub playtime_min: Option<u64>,
    /// Unix seconds.
    pub last_played: Option<u64>,
    pub store_url: Option<String>,
    pub size_bytes: Option<u64>,
}

#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScanOpts {
    pub steam_api_key: Option<String>,
    pub steam_id: Option<String>,
}

#[derive(Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScanResult {
    pub games: Vec<Game>,
    pub warnings: Vec<String>,
    /// Steam ID of the most recently signed-in Steam account, if found.
    pub steam_id: Option<String>,
    pub sources: Vec<String>,
}

pub fn scan_all(opts: ScanOpts) -> ScanResult {
    let mut res = ScanResult::default();

    // Xbox detection shells out to PowerShell and is the slowest part, so it
    // runs alongside the others.
    let (xbox, others) = std::thread::scope(|s| {
        let x = s.spawn(xbox::scan);
        let steam = steam::scan(&opts);
        let epic = epic::scan();
        let bnet = bnet::scan();
        (x.join().unwrap_or_else(|_| Err("Xbox scan crashed".into())), (steam, epic, bnet))
    });
    let (steam, epic, bnet) = others;

    match steam {
        Ok(s) => {
            if s.found {
                res.sources.push("Steam".into());
            }
            res.steam_id = s.steam_id;
            res.games.extend(s.games);
            res.warnings.extend(s.warnings);
        }
        Err(e) => res.warnings.push(format!("Steam: {e}")),
    }
    for (name, r) in [("Epic", epic), ("Battle.net", bnet), ("Xbox", xbox)] {
        match r {
            Ok(Some(g)) => {
                res.sources.push(name.into());
                res.games.extend(g);
            }
            Ok(None) => {}
            Err(e) => res.warnings.push(format!("{name}: {e}")),
        }
    }
    res.games
        .sort_by(|a, b| a.title.to_lowercase().cmp(&b.title.to_lowercase()));
    res
}

/// Registry helpers (Windows only).
#[cfg(windows)]
pub mod reg {
    use winreg::enums::{HKEY_CURRENT_USER, HKEY_LOCAL_MACHINE};
    use winreg::RegKey;

    pub fn hkcu() -> RegKey {
        RegKey::predef(HKEY_CURRENT_USER)
    }
    pub fn hklm() -> RegKey {
        RegKey::predef(HKEY_LOCAL_MACHINE)
    }
    pub fn get_str(root: &RegKey, path: &str, name: &str) -> Option<String> {
        root.open_subkey(path).ok()?.get_value::<String, _>(name).ok()
    }
}

/// Builds a `Command` that never flashes a console window on Windows.
pub fn hidden_command(program: &str) -> std::process::Command {
    #[allow(unused_mut)]
    let mut cmd = std::process::Command::new(program);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    cmd
}
