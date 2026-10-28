//! Ubisoft Connect: installed games from the launcher's registry key.

#[allow(unused_imports)]
use super::{Game, Launch};

#[cfg(not(windows))]
pub fn scan() -> super::Found {
    Ok(None)
}

#[cfg(windows)]
pub fn scan() -> super::Found {
    use std::path::Path;
    let hklm = super::reg::hklm();
    let key = hklm
        .open_subkey(r"SOFTWARE\WOW6432Node\Ubisoft\Launcher\Installs")
        .or_else(|_| hklm.open_subkey(r"SOFTWARE\Ubisoft\Launcher\Installs"));
    let Ok(installs) = key else { return Ok(None) };
    let mut games = Vec::new();
    for id in installs.enum_keys().flatten() {
        let Ok(sub) = installs.open_subkey(&id) else { continue };
        let Ok(dir) = sub.get_value::<String, _>("InstallDir") else { continue };
        let dir = dir.replace('/', "\\");
        let trimmed = dir.trim_end_matches('\\');
        if !Path::new(trimmed).is_dir() {
            continue;
        }
        let title = Path::new(trimmed)
            .file_name()
            .map(|n| n.to_string_lossy().into_owned())
            .unwrap_or_else(|| id.clone());
        games.push(Game::basic(
            format!("ubisoft:{id}"),
            "Ubisoft",
            title,
            Launch::Uri { uri: format!("uplay://launch/{id}/0") },
            Some(trimmed.to_string()),
        ));
    }
    Ok(Some(games))
}
