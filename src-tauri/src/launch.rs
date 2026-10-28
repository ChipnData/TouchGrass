//! Starting games and opening folders/links.

use crate::scan::{hidden_command, Launch};
use std::path::Path;
use std::process::Command;
use std::time::Instant;
use tauri::{AppHandle, Emitter};

/// Splits an argument string, honouring double quotes.
pub fn split_args(s: &str) -> Vec<String> {
    let mut out = Vec::new();
    let mut cur = String::new();
    let mut in_q = false;
    let mut has = false;
    for c in s.chars() {
        match c {
            '"' => {
                in_q = !in_q;
                has = true;
            }
            c if c.is_whitespace() && !in_q => {
                if has {
                    out.push(std::mem::take(&mut cur));
                    has = false;
                }
            }
            c => {
                cur.push(c);
                has = true;
            }
        }
    }
    if has {
        out.push(cur);
    }
    out
}

/// Hands a URI or path to the OS shell (Explorer on Windows).
pub fn shell_open(target: &str) -> Result<(), String> {
    #[cfg(windows)]
    let mut cmd = {
        let mut c = Command::new("explorer.exe");
        c.arg(target);
        c
    };
    #[cfg(not(windows))]
    let mut cmd = {
        let mut c = Command::new("xdg-open");
        c.arg(target);
        c
    };
    cmd.spawn().map(|_| ()).map_err(|e| e.to_string())
}

#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct SessionEnded {
    id: String,
    minutes: u64,
}

/// Launches a game. For directly-started programs with `track` set, emits a
/// `session-ended` event with the minutes played once the process exits.
pub fn launch(app: &AppHandle, id: String, launch: Launch, track: bool) -> Result<(), String> {
    match launch {
        Launch::Uri { uri } => {
            if uri.starts_with("https://") {
                return open_link(&uri);
            }
            open_uri(&uri)
        }
        Launch::BnetExec { exe, code } => {
            if Path::new(&exe).exists() {
                Command::new(&exe)
                    .arg(format!("--exec=launch {code}"))
                    .spawn()
                    .map(|_| ())
                    .map_err(|e| e.to_string())
            } else {
                shell_open(&format!("battlenet://{code}"))
            }
        }
        Launch::Exe { path, args, cwd } => {
            let p = Path::new(&path);
            if !p.exists() {
                return Err(format!("File not found: {path}"));
            }
            let is_exe = p
                .extension()
                .and_then(|e| e.to_str())
                .map(|e| e.eq_ignore_ascii_case("exe"))
                .unwrap_or(false);
            if !is_exe {
                // .lnk / .url / .bat and friends: let the shell decide.
                return shell_open(&path);
            }
            let dir = cwd
                .filter(|c| !c.trim().is_empty())
                .map(std::path::PathBuf::from)
                .or_else(|| p.parent().map(|d| d.to_path_buf()));
            let mut cmd = Command::new(&path);
            cmd.args(split_args(&args));
            if let Some(d) = dir {
                cmd.current_dir(d);
            }
            let mut child = cmd.spawn().map_err(|e| e.to_string())?;
            if track {
                let app = app.clone();
                std::thread::spawn(move || {
                    let start = Instant::now();
                    let _ = child.wait();
                    let minutes = start.elapsed().as_secs() / 60;
                    if minutes > 0 {
                        let _ = app.emit("session-ended", SessionEnded { id, minutes });
                    }
                });
            }
            Ok(())
        }
    }
}

/// Opens a folder in Explorer.
pub fn open_folder(path: &str) -> Result<(), String> {
    if !Path::new(path).is_dir() {
        return Err("Folder not found".into());
    }
    #[cfg(windows)]
    {
        // Avoid console flashes for explorer launched with a path.
        hidden_command("explorer.exe").arg(path).spawn().map(|_| ()).map_err(|e| e.to_string())
    }
    #[cfg(not(windows))]
    {
        let _ = hidden_command;
        shell_open(path)
    }
}

/// Store and app links that are safe to hand to the shell.
pub const ALLOWED_URIS: &[&str] = &[
    "steam://",
    "com.epicgames.launcher://",
    "battlenet://",
    "uplay://",
    "amazon-games://",
    "ms-windows-store://",
    "ms-settings:",
    r"shell:AppsFolder\",
];

/// Opens a store/app link (steam://, uplay://, shell:AppsFolder\..., etc.).
pub fn open_uri(uri: &str) -> Result<(), String> {
    if !ALLOWED_URIS.iter().any(|p| uri.starts_with(p)) || uri.contains('"') {
        return Err("Unsupported link".into());
    }
    shell_open(uri)
}

/// Opens an https link in the default browser.
pub fn open_link(url: &str) -> Result<(), String> {
    if !(url.starts_with("https://") || url.starts_with("http://")) || url.contains('"') {
        return Err("Only web links can be opened".into());
    }
    shell_open(url)
}

#[cfg(test)]
mod tests {
    #[test]
    fn splits() {
        assert_eq!(
            super::split_args(r#"-windowed "-config C:\My Games\x.ini" -fps 144"#),
            vec!["-windowed", r"-config C:\My Games\x.ini", "-fps", "144"]
        );
        assert!(super::split_args("   ").is_empty());
    }
}
