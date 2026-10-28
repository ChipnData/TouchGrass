//! EA app: installed games from the uninstall registry. EA has no public
//! library format, so games are found by their EA installer entries and
//! started through their own exe (which hands off to the EA app).

#[allow(unused_imports)]
use super::{Game, Launch};

/// Decides whether an uninstall entry is a game installed by the EA app.
#[cfg_attr(not(windows), allow(dead_code))]
pub fn is_ea_game(name: &str, publisher: &str, uninstall: &str) -> bool {
    let n = name.to_lowercase();
    if n.is_empty() || n == "ea app" || n.starts_with("ea desktop") || n.starts_with("origin") {
        return false;
    }
    publisher.to_lowercase().contains("electronic arts") && uninstall.contains("EAInstaller")
}

#[cfg(not(windows))]
pub fn scan() -> super::Found {
    Ok(None)
}

#[cfg(windows)]
pub fn scan() -> super::Found {
    use std::path::Path;
    let mut games = Vec::new();
    let mut seen = std::collections::HashSet::new();
    for u in super::reg::uninstall_entries() {
        if !is_ea_game(&u.name, &u.publisher, &u.uninstall) || !seen.insert(u.name.to_lowercase()) {
            continue;
        }
        let exe = super::clean_icon_path(&u.icon);
        if !exe.to_lowercase().ends_with(".exe") || !Path::new(&exe).exists() {
            continue;
        }
        let dir = (!u.location.is_empty()).then(|| u.location.trim_end_matches('\\').to_string());
        let id = format!("ea:{}", u.key.to_lowercase());
        games.push(Game::basic(
            id,
            "EA",
            u.name.clone(),
            Launch::Exe { path: exe, args: String::new(), cwd: dir.clone() },
            dir,
        ));
    }
    Ok((!games.is_empty()).then_some(games))
}

#[cfg(test)]
mod tests {
    #[test]
    fn detects() {
        use super::is_ea_game;
        assert!(is_ea_game("Battlefield 2042", "Electronic Arts", r#""C:\Program Files\Common Files\EAInstaller\Battlefield 2042\Cleanup.exe" uninstall_game"#));
        assert!(!is_ea_game("EA app", "Electronic Arts", "EAInstaller"));
        assert!(!is_ea_game("Some Tool", "Contoso", "EAInstaller"));
    }
}
