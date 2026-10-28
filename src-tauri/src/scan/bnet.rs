//! Battle.net: installed Blizzard/Activision games from the Windows uninstall
//! registry. Blizzard offers no public library API, so uninstalled games
//! can't be listed.

#[allow(unused_imports)]
use super::{Game, Launch};

/// Battle.net product codes used by `Battle.net.exe --exec="launch <code>"`.
/// Order matters: more specific names first.
#[cfg_attr(not(windows), allow(dead_code))]
const CODES: &[(&str, &str)] = &[
    ("world of warcraft classic", "WoWC"),
    ("world of warcraft", "WoW"),
    ("diablo iv", "Fen"),
    ("diablo iii", "D3"),
    ("diablo ii", "OSI"),
    ("diablo immortal", "ANBS"),
    ("overwatch", "Pro"),
    ("hearthstone", "WTCG"),
    ("heroes of the storm", "Hero"),
    ("starcraft ii", "S2"),
    ("starcraft", "S1"),
    ("warcraft iii", "W3"),
];

#[cfg_attr(not(windows), allow(dead_code))]
pub fn code_for(name: &str) -> Option<&'static str> {
    let n = name.to_lowercase();
    CODES.iter().find(|(k, _)| n.contains(k)).map(|(_, c)| *c)
}

#[cfg(not(windows))]
pub fn scan() -> Result<Option<Vec<Game>>, String> {
    Ok(None)
}

#[cfg(windows)]
pub fn scan() -> Result<Option<Vec<Game>>, String> {
    use super::reg;
    use std::collections::HashSet;
    use std::path::Path;

    let hklm = reg::hklm();
    let mut bnet_dir: Option<String> = None;
    let mut found: Vec<(String, String)> = Vec::new();
    for root in [
        r"SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall",
        r"SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall",
    ] {
        let Ok(k) = hklm.open_subkey(root) else { continue };
        for name in k.enum_keys().flatten() {
            let Ok(sub) = k.open_subkey(&name) else { continue };
            let dn: String = sub.get_value("DisplayName").unwrap_or_default();
            let us: String = sub.get_value("UninstallString").unwrap_or_default();
            let loc: String = sub.get_value("InstallLocation").unwrap_or_default();
            if dn == "Battle.net" {
                bnet_dir = Some(loc);
                continue;
            }
            if !dn.is_empty() && (us.contains("Battle.net") || us.contains("Blizzard Uninstaller")) {
                found.push((dn, loc));
            }
        }
    }

    let exe = bnet_dir
        .map(|d| Path::new(&d).join("Battle.net.exe"))
        .filter(|p| p.exists())
        .or_else(|| {
            let p = Path::new(r"C:\Program Files (x86)\Battle.net\Battle.net.exe");
            p.exists().then(|| p.to_path_buf())
        })
        .map(|p| p.to_string_lossy().into_owned());

    if exe.is_none() && found.is_empty() {
        return Ok(None);
    }

    let mut seen = HashSet::new();
    let games = found
        .into_iter()
        .filter(|(dn, _)| seen.insert(dn.to_lowercase()))
        .map(|(title, loc)| {
            let code = code_for(&title);
            let launch = match (code, exe.as_ref()) {
                (Some(c), Some(e)) => Launch::BnetExec { exe: e.clone(), code: c.into() },
                (Some(c), None) => Launch::Uri { uri: format!("battlenet://{c}") },
                // Unknown product code: open the Battle.net app so the user can hit Play.
                (None, Some(e)) => Launch::Exe { path: e.clone(), args: String::new(), cwd: None },
                (None, None) => Launch::Uri { uri: "battlenet://".into() },
            };
            Game {
                id: format!("bnet:{}", code.map(str::to_string).unwrap_or_else(|| title.to_lowercase())),
                source: "Battle.net".into(),
                title,
                installed: true,
                launch,
                install_dir: (!loc.is_empty()).then_some(loc),
                cover: None,
                playtime_min: None,
                last_played: None,
                store_url: None,
                size_bytes: None,
            }
        })
        .collect();
    Ok(Some(games))
}

#[cfg(test)]
mod tests {
    #[test]
    fn codes() {
        use super::code_for;
        assert_eq!(code_for("Diablo III"), Some("D3"));
        assert_eq!(code_for("Diablo IV"), Some("Fen"));
        assert_eq!(code_for("Diablo II: Resurrected"), Some("OSI"));
        assert_eq!(code_for("World of Warcraft Classic"), Some("WoWC"));
        assert_eq!(code_for("StarCraft II"), Some("S2"));
        assert_eq!(code_for("Overwatch"), Some("Pro"));
        assert_eq!(code_for("Call of Duty"), None);
    }
}
