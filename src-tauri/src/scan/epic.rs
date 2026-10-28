//! Epic Games: installed games from the launcher's local install manifests.

use super::{Game, Launch};
use std::path::{Path, PathBuf};

fn manifests_dir() -> PathBuf {
    let pd = std::env::var("PROGRAMDATA").unwrap_or_else(|_| r"C:\ProgramData".into());
    Path::new(&pd)
        .join("Epic")
        .join("EpicGamesLauncher")
        .join("Data")
        .join("Manifests")
}

pub fn scan() -> Result<Option<Vec<Game>>, String> {
    let dir = manifests_dir();
    if !dir.exists() {
        return Ok(None);
    }
    Ok(Some(scan_dir(&dir)))
}

fn enc(s: &str) -> String {
    crate::covers::urlencode(s)
}

pub fn scan_dir(dir: &Path) -> Vec<Game> {
    let mut games = Vec::new();
    let Ok(rd) = std::fs::read_dir(dir) else { return games };
    for e in rd.flatten() {
        let p = e.path();
        if p.extension().and_then(|x| x.to_str()) != Some("item") {
            continue;
        }
        let Ok(text) = std::fs::read_to_string(&p) else { continue };
        let Ok(v) = serde_json::from_str::<serde_json::Value>(&text) else { continue };
        let s = |k: &str| v[k].as_str().unwrap_or("").to_string();
        let app = s("AppName");
        let title = s("DisplayName");
        if app.is_empty() || title.is_empty() || v["bIsIncompleteInstall"].as_bool() == Some(true) {
            continue;
        }
        // Skip DLC (main game differs) and non-game items (Unreal Engine etc.).
        let main = s("MainGameAppName");
        if !main.is_empty() && main != app {
            continue;
        }
        if let Some(cats) = v["AppCategories"].as_array() {
            let is_game = cats.iter().any(|c| c.as_str() == Some("games"));
            if !cats.is_empty() && !is_game {
                continue;
            }
        }
        if app.starts_with("UE_") {
            continue;
        }
        let uri = format!(
            "com.epicgames.launcher://apps/{}%3A{}%3A{}?action=launch&silent=true",
            enc(&s("CatalogNamespace")),
            enc(&s("CatalogItemId")),
            enc(&app)
        );
        let loc = s("InstallLocation");
        games.push(Game {
            id: format!("epic:{app}"),
            source: "Epic".into(),
            title,
            installed: true,
            launch: Launch::Uri { uri },
            install_dir: (!loc.is_empty()).then_some(loc),
            cover: None,
            playtime_min: None,
            last_played: None,
            store_url: None,
            size_bytes: v["InstallSize"].as_u64(),
        });
    }
    games
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_manifests() {
        let d = tempfile::tempdir().unwrap();
        std::fs::write(
            d.path().join("a.item"),
            r#"{"DisplayName":"Alan Wake 2","AppName":"Dill","MainGameAppName":"Dill","CatalogNamespace":"dc9d2e595d0e4650b35d659f90d41059","CatalogItemId":"4f0c34d469e14ea0a8d5bed1a5d6ba8e","InstallLocation":"D:\\Epic\\AlanWake2","AppCategories":["public","games","applications"],"bIsIncompleteInstall":false,"InstallSize":90000}"#,
        )
        .unwrap();
        std::fs::write(
            d.path().join("dlc.item"),
            r#"{"DisplayName":"Some DLC","AppName":"DlcX","MainGameAppName":"Dill","AppCategories":["addons"]}"#,
        )
        .unwrap();
        let g = scan_dir(d.path());
        assert_eq!(g.len(), 1);
        match &g[0].launch {
            Launch::Uri { uri } => assert!(uri.contains("%3ADill?action=launch")),
            _ => panic!(),
        }
    }
}
