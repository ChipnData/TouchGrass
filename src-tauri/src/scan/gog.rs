//! GOG: installed games from the uninstall registry (`<id>_is1`, publisher
//! GOG.com) plus each game's `goggame-<id>.info` play task. GOG games are
//! DRM-free, so they launch directly without GOG Galaxy.

#[allow(unused_imports)]
use super::{Game, Launch};
use std::path::Path;

/// Reads the primary play task from `goggame-<id>.info`.
/// Returns None for DLC (rootGameId differs) or when there's nothing to run.
pub fn play_task(game_id: &str, dir: &Path) -> Option<Launch> {
    let text = std::fs::read_to_string(dir.join(format!("goggame-{game_id}.info"))).ok()?;
    let v: serde_json::Value = serde_json::from_str(text.trim_start_matches('\u{feff}')).ok()?;
    if let Some(root) = v["rootGameId"].as_str() {
        if !root.is_empty() && root != game_id {
            return None;
        }
    }
    let tasks = v["playTasks"].as_array()?;
    let t = tasks
        .iter()
        .find(|t| t["isPrimary"].as_bool() == Some(true))
        .or_else(|| tasks.first())?;
    match t["type"].as_str() {
        Some("URLTask") => {
            let link = t["link"].as_str()?;
            link.starts_with("https://").then(|| Launch::Uri { uri: link.to_string() })
        }
        _ => {
            let rel = t["path"].as_str()?.replace('/', "\\");
            let path = dir.join(&rel);
            let cwd = t["workingDir"]
                .as_str()
                .filter(|w| !w.is_empty())
                .map(|w| dir.join(w.replace('/', "\\")).to_string_lossy().into_owned());
            Some(Launch::Exe {
                path: path.to_string_lossy().into_owned(),
                args: t["arguments"].as_str().unwrap_or("").to_string(),
                cwd,
            })
        }
    }
}

#[cfg(not(windows))]
pub fn scan() -> super::Found {
    Ok(None)
}

#[cfg(windows)]
pub fn scan() -> super::Found {
    let mut games = Vec::new();
    let mut seen = std::collections::HashSet::new();
    for u in super::reg::uninstall_entries() {
        if u.publisher != "GOG.com" || u.key.starts_with("GOGPACK") {
            continue;
        }
        let Some(id) = u.key.strip_suffix("_is1").filter(|i| i.chars().all(|c| c.is_ascii_digit())) else {
            continue;
        };
        let dir = Path::new(&u.location);
        if !dir.is_dir() || !seen.insert(id.to_string()) {
            continue;
        }
        let Some(launch) = play_task(id, dir) else { continue };
        games.push(Game::basic(format!("gog:{id}"), "GOG", u.name.clone(), launch, Some(u.location.clone())));
    }
    let has_galaxy = super::reg::get_str(&super::reg::hklm(), r"SOFTWARE\WOW6432Node\GOG.com\GalaxyClient\paths", "client").is_some();
    if games.is_empty() && !has_galaxy {
        return Ok(None);
    }
    Ok(Some(games))
}

/// GOG Galaxy's exe, if installed.
#[cfg(windows)]
pub fn galaxy_exe() -> Option<String> {
    use super::reg;
    let dir = reg::get_str(&reg::hklm(), r"SOFTWARE\WOW6432Node\GOG.com\GalaxyClient\paths", "client")
        .or_else(|| reg::get_str(&reg::hklm(), r"SOFTWARE\GOG.com\GalaxyClient\paths", "client"))?;
    let p = Path::new(&dir).join("GalaxyClient.exe");
    p.exists().then(|| p.to_string_lossy().into_owned())
}

#[cfg(not(windows))]
pub fn galaxy_exe() -> Option<String> {
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_play_task_and_skips_dlc() {
        let d = tempfile::tempdir().unwrap();
        std::fs::write(
            d.path().join("goggame-1207658924.info"),
            r#"{"gameId":"1207658924","rootGameId":"1207658924","playTasks":[{"isPrimary":true,"type":"FileTask","path":"bin/witcher.exe","workingDir":"bin","arguments":"-fast"}]}"#,
        )
        .unwrap();
        match play_task("1207658924", d.path()) {
            Some(Launch::Exe { path, args, cwd }) => {
                assert!(path.ends_with("witcher.exe"));
                assert_eq!(args, "-fast");
                assert!(cwd.unwrap().ends_with("bin"));
            }
            other => panic!("{other:?}"),
        }
        std::fs::write(
            d.path().join("goggame-2.info"),
            r#"{"gameId":"2","rootGameId":"1207658924","playTasks":[]}"#,
        )
        .unwrap();
        assert!(play_task("2", d.path()).is_none());
    }
}
