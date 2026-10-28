//! PC-level actions: power, websites, store apps, running-game detection,
//! backups, and moving data over from the old "Lumen" name.

use crate::launch::{open_link, open_uri, shell_open};
use crate::scan::hidden_command;
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

// ---------------- power ----------------

pub fn power(action: &str) -> Result<(), String> {
    let spawn = |prog: &str, args: &[&str]| {
        hidden_command(prog).args(args).spawn().map(|_| ()).map_err(|e| e.to_string())
    };
    match action {
        "shutdown" => spawn("shutdown.exe", &["/s", "/t", "0"]),
        "restart" => spawn("shutdown.exe", &["/r", "/t", "0"]),
        "signout" => spawn("shutdown.exe", &["/l"]),
        // True sleep (rundll32's SetSuspendState hibernates on many PCs).
        "sleep" => spawn(
            "powershell.exe",
            &[
                "-NoProfile",
                "-Command",
                "Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.Application]::SetSuspendState('Suspend', $false, $false)",
            ],
        ),
        _ => Err("Unknown power action".into()),
    }
}

// ---------------- websites ----------------

#[cfg(windows)]
fn edge_exe() -> Option<String> {
    use crate::scan::reg;
    let from_reg = reg::get_str(&reg::hklm(), r"SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\msedge.exe", "");
    from_reg
        .into_iter()
        .chain([r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe".to_string(), r"C:\Program Files\Microsoft\Edge\Application\msedge.exe".to_string()])
        .find(|p| Path::new(p).exists())
}

#[cfg(not(windows))]
fn edge_exe() -> Option<String> {
    None
}

/// Opens a website in the default browser, or as a borderless "app window"
/// (Edge app mode: no tabs or address bar), which is simpler for some people.
pub fn open_website(url: &str, app_window: bool) -> Result<(), String> {
    if !(url.starts_with("https://") || url.starts_with("http://")) || url.contains('"') {
        return Err("That doesn't look like a web address".into());
    }
    if app_window {
        if let Some(edge) = edge_exe() {
            return std::process::Command::new(edge)
                .arg(format!("--app={url}"))
                .spawn()
                .map(|_| ())
                .map_err(|e| e.to_string());
        }
    }
    open_link(url)
}

// ---------------- store apps ----------------

/// Opens a store's own app. Returns Err if that app isn't available.
pub fn open_store_app(store: &str) -> Result<(), String> {
    match store {
        "Steam" => open_uri("steam://url/StoreFrontPage"),
        "Epic" => open_uri("com.epicgames.launcher://store"),
        "Xbox" => open_uri(r"shell:AppsFolder\Microsoft.GamingApp_8wekyb3d8bbwe!Microsoft.Xbox.App"),
        "Battle.net" => match crate::scan::bnet::client_exe() {
            Some(exe) => std::process::Command::new(exe).spawn().map(|_| ()).map_err(|e| e.to_string()),
            None => open_uri("battlenet://"),
        },
        "GOG" => match crate::scan::gog::galaxy_exe() {
            Some(exe) => std::process::Command::new(exe).spawn().map(|_| ()).map_err(|e| e.to_string()),
            None => Err("GOG Galaxy isn't installed".into()),
        },
        "Ubisoft" => open_uri("uplay://"),
        "Amazon" => open_uri("amazon-games://"),
        _ => Err("This store has no app to open".into()),
    }
}

// ---------------- running games ----------------

#[derive(Debug, Deserialize)]
pub struct WatchDir {
    pub id: String,
    pub dir: String,
}

#[derive(Debug, Serialize)]
pub struct Running {
    pub id: String,
    pub pids: Vec<u32>,
}

fn norm_dir(d: &str) -> String {
    let mut s = d.replace('/', "\\").to_lowercase();
    if !s.ends_with('\\') {
        s.push('\\');
    }
    s
}

/// Which of the given games have a process running from their install folder.
pub fn running_games(dirs: Vec<WatchDir>) -> Vec<Running> {
    use sysinfo::{ProcessRefreshKind, ProcessesToUpdate, System, UpdateKind};
    let mut sys = System::new();
    sys.refresh_processes_specifics(
        ProcessesToUpdate::All,
        true,
        ProcessRefreshKind::nothing().with_exe(UpdateKind::OnlyIfNotSet),
    );
    let watch: Vec<(String, String)> = dirs
        .into_iter()
        .filter(|w| w.dir.len() > 3) // never match a whole drive
        .map(|w| (w.id, norm_dir(&w.dir)))
        .collect();
    let mut out: Vec<Running> = Vec::new();
    for (pid, p) in sys.processes() {
        let Some(exe) = p.exe() else { continue };
        let exe = exe.to_string_lossy().replace('/', "\\").to_lowercase();
        if let Some((id, _)) = watch.iter().find(|(_, d)| exe.starts_with(d.as_str())) {
            match out.iter_mut().find(|r| &r.id == id) {
                Some(r) => r.pids.push(pid.as_u32()),
                None => out.push(Running { id: id.clone(), pids: vec![pid.as_u32()] }),
            }
        }
    }
    out
}

/// Force-closes the given processes.
pub fn close_processes(pids: Vec<u32>) -> usize {
    use sysinfo::{Pid, ProcessRefreshKind, ProcessesToUpdate, System};
    let pids: Vec<Pid> = pids.into_iter().map(Pid::from_u32).collect();
    let mut sys = System::new();
    sys.refresh_processes_specifics(ProcessesToUpdate::Some(&pids), true, ProcessRefreshKind::nothing());
    pids.iter().filter_map(|p| sys.process(*p)).filter(|p| p.kill()).count()
}

// ---------------- backups & migration ----------------

pub fn export_backup(data: &serde_json::Value, path: &Path) -> Result<(), String> {
    let text = serde_json::to_string_pretty(data).map_err(|e| e.to_string())?;
    std::fs::write(path, text).map_err(|e| e.to_string())
}

pub fn read_backup(path: &Path) -> Result<serde_json::Value, String> {
    let text = std::fs::read_to_string(path).map_err(|e| e.to_string())?;
    let v: serde_json::Value = serde_json::from_str(&text).map_err(|_| "That file isn't a Touch Grass backup".to_string())?;
    if !v.is_object() || !(v.get("settings").is_some() || v.get("custom").is_some()) {
        return Err("That file isn't a Touch Grass backup".into());
    }
    Ok(v)
}

/// Copies data.json from the app's previous name (Lumen) on first run.
pub fn migrate_from_lumen(new_data: &Path) {
    if new_data.exists() {
        return;
    }
    let Some(roaming) = new_data.parent().and_then(|p| p.parent()) else { return };
    let old: PathBuf = roaming.join("com.lumen.launcher").join("data.json");
    if old.exists() {
        if let Some(dir) = new_data.parent() {
            let _ = std::fs::create_dir_all(dir);
        }
        let _ = std::fs::copy(old, new_data);
    }
}

#[allow(dead_code)]
pub fn open_target(t: &str) -> Result<(), String> {
    shell_open(t)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn dir_normalising() {
        assert_eq!(norm_dir("C:/Games/Elden Ring"), "c:\\games\\elden ring\\");
        assert_eq!(norm_dir("D:\\X\\"), "d:\\x\\");
    }

    #[test]
    fn finds_own_process() {
        let me = std::env::current_exe().unwrap();
        let dir = me.parent().unwrap().to_string_lossy().into_owned();
        let r = running_games(vec![WatchDir { id: "me".into(), dir }]);
        assert!(r.iter().any(|x| x.id == "me" && x.pids.contains(&std::process::id())));
    }

    #[test]
    fn migrates() {
        let d = tempfile::tempdir().unwrap();
        let old = d.path().join("com.lumen.launcher");
        std::fs::create_dir_all(&old).unwrap();
        std::fs::write(old.join("data.json"), "{\"settings\":{}}").unwrap();
        let new = d.path().join("com.touchgrass.launcher").join("data.json");
        migrate_from_lumen(&new);
        assert!(new.exists());
    }

    #[test]
    fn rejects_bad_backup() {
        let d = tempfile::tempdir().unwrap();
        let p = d.path().join("b.json");
        std::fs::write(&p, "[1,2]").unwrap();
        assert!(read_backup(&p).is_err());
        std::fs::write(&p, "{\"settings\":{},\"custom\":[]}").unwrap();
        assert!(read_backup(&p).is_ok());
    }
}
