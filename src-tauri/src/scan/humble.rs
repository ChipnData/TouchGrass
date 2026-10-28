//! Humble App: installed games from the app's config.json.

use super::{Game, Launch};
use std::path::{Path, PathBuf};

fn config_path() -> Option<PathBuf> {
    let appdata = std::env::var_os("APPDATA")?;
    let p = Path::new(&appdata).join("Humble App").join("config.json");
    p.exists().then_some(p)
}

pub fn scan() -> super::Found {
    let Some(p) = config_path() else { return Ok(None) };
    let text = std::fs::read_to_string(&p).map_err(|e| e.to_string())?;
    parse(&text).map(Some)
}

pub fn parse(text: &str) -> Result<Vec<Game>, String> {
    let v: serde_json::Value = serde_json::from_str(text).map_err(|e| format!("couldn't read config: {e}"))?;
    let list = v["game-collection-4"].as_array().cloned().unwrap_or_default();
    let mut games = Vec::new();
    for e in list {
        let status = e["status"].as_str().unwrap_or("");
        if status != "downloaded" && status != "installed" {
            continue;
        }
        let s = |k: &str| e[k].as_str().unwrap_or("").to_string();
        let (exe_rel, machine, title) = (s("executablePath"), s("machineName"), s("gameName"));
        if exe_rel.is_empty() || title.is_empty() {
            continue;
        }
        let exe: PathBuf = if !s("filePath").is_empty() {
            Path::new(&s("filePath")).join(&exe_rel)
        } else {
            Path::new(&s("downloadFilePath")).join(&machine).join(&exe_rel)
        };
        let Some(dir) = exe.parent().map(|d| d.to_string_lossy().into_owned()) else { continue };
        if !Path::new(&dir).is_dir() {
            continue;
        }
        let id = if machine.is_empty() { title.to_lowercase() } else { machine };
        games.push(Game::basic(
            format!("humble:{id}"),
            "Humble",
            title,
            Launch::Exe { path: exe.to_string_lossy().into_owned(), args: String::new(), cwd: Some(dir.clone()) },
            Some(dir),
        ));
    }
    Ok(games)
}

#[cfg(test)]
mod tests {
    #[test]
    fn parses_config() {
        let d = tempfile::tempdir().unwrap();
        let g = d.path().join("dicey");
        std::fs::create_dir(&g).unwrap();
        let json = serde_json::json!({
            "game-collection-4": [
                {"gameName": "Dicey Dungeons", "machineName": "diceydungeons", "status": "installed",
                 "filePath": g.to_string_lossy(), "executablePath": "diceydungeons.exe"},
                {"gameName": "Not Here", "machineName": "x", "status": "available", "executablePath": "x.exe"}
            ]
        });
        let games = super::parse(&json.to_string()).unwrap();
        assert_eq!(games.len(), 1);
        assert_eq!(games[0].id, "humble:diceydungeons");
    }
}
