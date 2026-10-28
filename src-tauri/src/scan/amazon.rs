//! Amazon Games (Prime Gaming): installed games from the app's local SQLite
//! database.

use super::{Game, Launch};
use std::path::{Path, PathBuf};

fn db_path() -> Option<PathBuf> {
    let local = std::env::var_os("LOCALAPPDATA")?;
    let p = Path::new(&local)
        .join("Amazon Games")
        .join("Data")
        .join("Games")
        .join("Sql")
        .join("GameInstallInfo.sqlite");
    p.exists().then_some(p)
}

pub fn scan() -> super::Found {
    match db_path() {
        Some(p) => read_db(&p).map(Some),
        None => Ok(None),
    }
}

/// Reads installed games. The database is copied first so a running Amazon
/// Games app (which keeps it open) can't block us.
pub fn read_db(path: &Path) -> Result<Vec<Game>, String> {
    let tmp = std::env::temp_dir().join(format!("touchgrass-amazon-{}.sqlite", std::process::id()));
    std::fs::copy(path, &tmp).map_err(|e| e.to_string())?;
    let result = (|| {
        let conn = rusqlite::Connection::open_with_flags(&tmp, rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY)
            .map_err(|e| e.to_string())?;
        let mut stmt = conn
            .prepare("SELECT Id, ProductTitle, InstallDirectory FROM DbSet WHERE Installed = 1")
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?, r.get::<_, String>(2)?)))
            .map_err(|e| e.to_string())?;
        let mut games = Vec::new();
        for (id, title, dir) in rows.flatten() {
            if !Path::new(&dir).is_dir() {
                continue;
            }
            let title = title.replace(['™', '®'], "").trim().to_string();
            games.push(Game::basic(
                format!("amazon:{id}"),
                "Amazon",
                title,
                Launch::Uri { uri: format!("amazon-games://play/{id}") },
                Some(dir),
            ));
        }
        Ok(games)
    })();
    let _ = std::fs::remove_file(&tmp);
    result
}

#[cfg(test)]
mod tests {
    #[test]
    fn reads_db() {
        let d = tempfile::tempdir().unwrap();
        let db = d.path().join("g.sqlite");
        let game_dir = d.path().join("Game");
        std::fs::create_dir(&game_dir).unwrap();
        let c = rusqlite::Connection::open(&db).unwrap();
        c.execute_batch("CREATE TABLE DbSet (Id TEXT, ProductTitle TEXT, InstallDirectory TEXT, Installed INTEGER);").unwrap();
        c.execute("INSERT INTO DbSet VALUES ('amzn1.adg.product.x', 'Fallout 76™', ?1, 1)", [game_dir.to_string_lossy()]).unwrap();
        c.execute("INSERT INTO DbSet VALUES ('amzn1.adg.product.y', 'Gone', 'C:/nope', 1)", []).unwrap();
        drop(c);
        let g = super::read_db(&db).unwrap();
        assert_eq!(g.len(), 1);
        assert_eq!(g[0].title, "Fallout 76");
    }
}
