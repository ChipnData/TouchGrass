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

/// Path to Battle.net.exe, if installed.
#[cfg(windows)]
pub fn client_exe() -> Option<String> {
    use std::path::Path;
    super::reg::uninstall_entries()
        .into_iter()
        .find(|u| u.name == "Battle.net")
        .map(|u| Path::new(&u.location).join("Battle.net.exe"))
        .filter(|p| p.exists())
        .or_else(|| {
            let p = Path::new(r"C:\Program Files (x86)\Battle.net\Battle.net.exe");
            p.exists().then(|| p.to_path_buf())
        })
        .map(|p| p.to_string_lossy().into_owned())
}

#[cfg(not(windows))]
pub fn client_exe() -> Option<String> {
    None
}

#[cfg(not(windows))]
pub fn scan() -> super::Found {
    Ok(None)
}

#[cfg(windows)]
pub fn scan() -> super::Found {
    use std::collections::HashSet;

    let exe = client_exe();
    let found: Vec<(String, String)> = super::reg::uninstall_entries()
        .into_iter()
        .filter(|u| {
            !u.name.is_empty()
                && u.name != "Battle.net"
                && (u.uninstall.contains("Battle.net") || u.uninstall.contains("Blizzard Uninstaller"))
        })
        .map(|u| (u.name, u.location))
        .collect();

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
            let id = format!("bnet:{}", code.map(str::to_string).unwrap_or_else(|| title.to_lowercase()));
            Game::basic(id, "Battle.net", title, launch, (!loc.is_empty()).then_some(loc))
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
