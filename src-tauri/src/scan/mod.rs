#![cfg_attr(not(windows), allow(dead_code))]
//! Library scanners for each store. Everything here reads local files or the
//! registry; only the optional Steam "owned games" lookup touches the network.

pub mod amazon;
pub mod bnet;
pub mod ea;
pub mod epic;
pub mod gog;
pub mod humble;
pub mod steam;
pub mod ubisoft;
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

impl Game {
    /// A minimal installed game; callers fill in the rest.
    pub fn basic(id: String, source: &str, title: String, launch: Launch, install_dir: Option<String>) -> Self {
        Game {
            id,
            source: source.into(),
            title,
            installed: true,
            launch,
            install_dir,
            cover: None,
            playtime_min: None,
            last_played: None,
            store_url: None,
            size_bytes: None,
        }
    }
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
    /// Stores whose app was found on this PC.
    pub sources: Vec<String>,
}

type Found = Result<Option<Vec<Game>>, String>;

pub fn scan_all(opts: ScanOpts) -> ScanResult {
    let mut res = ScanResult::default();

    // Xbox detection shells out to PowerShell and is the slowest part, so
    // everything runs in parallel.
    let (steam, others) = std::thread::scope(|s| {
        let named: Vec<(&str, std::thread::ScopedJoinHandle<Found>)> = vec![
            ("Xbox", s.spawn(xbox::scan)),
            ("Epic", s.spawn(epic::scan)),
            ("Battle.net", s.spawn(bnet::scan)),
            ("GOG", s.spawn(gog::scan)),
            ("Ubisoft", s.spawn(ubisoft::scan)),
            ("EA", s.spawn(ea::scan)),
            ("Amazon", s.spawn(amazon::scan)),
            ("Humble", s.spawn(humble::scan)),
        ];
        let steam = steam::scan(&opts);
        let others: Vec<(&str, Found)> = named
            .into_iter()
            .map(|(n, h)| (n, h.join().unwrap_or_else(|_| Err("scanner crashed".into()))))
            .collect();
        (steam, others)
    });

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
    for (name, r) in others {
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

    /// One "Programs and Features" entry.
    #[derive(Debug, Clone, Default)]
    pub struct Uninstall {
        pub key: String,
        pub name: String,
        pub publisher: String,
        pub location: String,
        pub uninstall: String,
        pub icon: String,
    }

    /// All uninstall entries (machine-wide 64/32-bit and per-user).
    pub fn uninstall_entries() -> Vec<Uninstall> {
        let mut out = Vec::new();
        let roots = [
            (hklm(), r"SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall"),
            (hklm(), r"SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall"),
            (hkcu(), r"SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall"),
        ];
        for (root, path) in roots.iter() {
            let Ok(k) = root.open_subkey(path) else { continue };
            for key in k.enum_keys().flatten() {
                let Ok(sub) = k.open_subkey(&key) else { continue };
                let get = |n: &str| sub.get_value::<String, _>(n).unwrap_or_default();
                out.push(Uninstall {
                    name: get("DisplayName"),
                    publisher: get("Publisher"),
                    location: get("InstallLocation"),
                    uninstall: get("UninstallString"),
                    icon: get("DisplayIcon"),
                    key,
                });
            }
        }
        out
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

fn base64(bytes: &[u8]) -> String {
    const T: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::with_capacity(bytes.len().div_ceil(3) * 4);
    for c in bytes.chunks(3) {
        let n = (c[0] as u32) << 16 | (*c.get(1).unwrap_or(&0) as u32) << 8 | *c.get(2).unwrap_or(&0) as u32;
        out.push(T[(n >> 18) as usize & 63] as char);
        out.push(T[(n >> 12) as usize & 63] as char);
        out.push(if c.len() > 1 { T[(n >> 6) as usize & 63] as char } else { '=' });
        out.push(if c.len() > 2 { T[n as usize & 63] as char } else { '=' });
    }
    out
}

/// Encodes a script for `powershell -EncodedCommand` (base64 of UTF-16LE).
pub fn encode_ps(script: &str) -> String {
    let bytes: Vec<u8> = script.encode_utf16().flat_map(|u| u.to_le_bytes()).collect();
    base64(&bytes)
}

/// Runs a PowerShell script hidden and returns its stdout.
pub fn run_powershell(script: &str) -> Result<String, String> {
    let out = hidden_command("powershell.exe")
        .args(["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-EncodedCommand"])
        .arg(encode_ps(script))
        .output()
        .map_err(|e| format!("couldn't run PowerShell: {e}"))?;
    Ok(String::from_utf8_lossy(&out.stdout).trim().trim_start_matches('\u{feff}').to_string())
}

/// Parses PowerShell's ConvertTo-Json output, which may be one object or a list.
pub fn json_list(text: &str) -> Result<Vec<serde_json::Value>, String> {
    if text.is_empty() {
        return Ok(vec![]);
    }
    match serde_json::from_str(text).map_err(|e| format!("unexpected output: {e}"))? {
        serde_json::Value::Array(a) => Ok(a),
        o @ serde_json::Value::Object(_) => Ok(vec![o]),
        _ => Ok(vec![]),
    }
}

/// Turns `"C:\Games\x.exe",0` into `C:\Games\x.exe`.
pub fn clean_icon_path(s: &str) -> String {
    let s = s.trim();
    let s = match s.rfind(',') {
        Some(i) if s[i + 1..].trim().parse::<i32>().is_ok() => &s[..i],
        _ => s,
    };
    s.trim().trim_matches('"').to_string()
}

#[cfg(test)]
mod tests {
    #[test]
    fn icon_paths() {
        assert_eq!(super::clean_icon_path(r#""C:\G\a.exe",0"#), r"C:\G\a.exe");
        assert_eq!(super::clean_icon_path(r"C:\G\a.exe"), r"C:\G\a.exe");
        assert_eq!(super::clean_icon_path(r"C:\G,x\a.exe"), r"C:\G,x\a.exe");
    }

    #[test]
    fn encodes_powershell() {
        // "hi" in UTF-16LE, base64-encoded.
        assert_eq!(super::encode_ps("hi"), "aABpAA==");
        assert_eq!(super::base64(b"Man"), "TWFu");
        assert_eq!(super::base64(b"Ma"), "TWE=");
    }
}
