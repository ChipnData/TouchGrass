//! Cover art: Steam's own store data (no key) and SteamGridDB (user's key).

use serde::Serialize;
use std::collections::HashMap;
use std::time::Duration;

pub fn urlencode(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for b in s.bytes() {
        match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => out.push(b as char),
            _ => out.push_str(&format!("%{b:02X}")),
        }
    }
    out
}

pub fn agent(secs: u64) -> ureq::Agent {
    ureq::AgentBuilder::new()
        .timeout(Duration::from_secs(secs))
        .user_agent("TouchGrass/0.2")
        .build()
}

pub fn get_json(agent: &ureq::Agent, url: &str) -> Result<serde_json::Value, String> {
    agent
        .get(url)
        .call()
        .map_err(|e| e.to_string())?
        .into_json()
        .map_err(|e| e.to_string())
}

// ---------------- Steam ----------------

#[derive(Debug, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct SteamArt {
    pub cover: Option<String>,
    pub header: Option<String>,
}

const STEAM_ASSET_BASE: &str = "https://shared.akamai.steamstatic.com/store_item_assets/";

/// Builds image URLs from one `store_items[]` entry of IStoreBrowseService/GetItems.
pub fn steam_art_from_item(item: &serde_json::Value) -> Option<(u64, SteamArt)> {
    let appid = item["appid"].as_u64()?;
    let a = &item["assets"];
    let fmt = a["asset_url_format"].as_str()?;
    let url = |key: &str| {
        a[key]
            .as_str()
            .filter(|f| !f.is_empty())
            .map(|f| format!("{STEAM_ASSET_BASE}{}", fmt.replace("${FILENAME}", f)))
    };
    Some((
        appid,
        SteamArt {
            cover: url("library_capsule").or_else(|| url("library_capsule_2x")),
            header: url("header").or_else(|| url("main_capsule")),
        },
    ))
}

/// Looks up real art URLs for Steam apps (batched; no API key needed).
pub fn steam_art(appids: &[u64]) -> Result<HashMap<u64, SteamArt>, String> {
    let agent = agent(20);
    let mut out = HashMap::new();
    for chunk in appids.chunks(50) {
        let ids: Vec<_> = chunk.iter().map(|id| serde_json::json!({ "appid": id })).collect();
        let input = serde_json::json!({
            "ids": ids,
            "context": { "language": "english", "country_code": "US" },
            "data_request": { "include_assets": true }
        });
        let url = format!(
            "https://api.steampowered.com/IStoreBrowseService/GetItems/v1/?input_json={}",
            urlencode(&input.to_string())
        );
        let v = get_json(&agent, &url)?;
        for item in v["response"]["store_items"].as_array().into_iter().flatten() {
            if let Some((id, art)) = steam_art_from_item(item) {
                out.insert(id, art);
            }
        }
    }
    Ok(out)
}

// ---------------- SteamGridDB ----------------

fn sgdb_get(agent: &ureq::Agent, url: &str, key: &str) -> Result<serde_json::Value, String> {
    agent
        .get(url)
        .set("Authorization", &format!("Bearer {key}"))
        .call()
        .map_err(|e| match e {
            ureq::Error::Status(401, _) => "SteamGridDB rejected the API key".to_string(),
            other => other.to_string(),
        })?
        .into_json()
        .map_err(|e| e.to_string())
}

const SGDB: &str = "https://www.steamgriddb.com/api/v2";

#[derive(Debug, Serialize)]
pub struct SgdbGame {
    pub id: u64,
    pub name: String,
    pub year: Option<i32>,
}

#[derive(Debug, Serialize)]
pub struct SgdbImage {
    pub url: String,
    pub thumb: String,
}

pub fn sgdb_search(key: &str, term: &str) -> Result<Vec<SgdbGame>, String> {
    let v = sgdb_get(&agent(10), &format!("{SGDB}/search/autocomplete/{}", urlencode(term)), key)?;
    Ok(v["data"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|g| {
            let year = g["release_date"].as_i64().map(|t| 1970 + (t / 31_556_952) as i32);
            Some(SgdbGame { id: g["id"].as_u64()?, name: g["name"].as_str()?.to_string(), year })
        })
        .take(8)
        .collect())
}

pub fn sgdb_grids(key: &str, game_id: u64) -> Result<Vec<SgdbImage>, String> {
    let v = sgdb_get(
        &agent(10),
        &format!("{SGDB}/grids/game/{game_id}?dimensions=600x900,342x482,660x930&types=static&nsfw=false"),
        key,
    )?;
    Ok(v["data"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|g| {
            let url = g["url"].as_str()?.to_string();
            let thumb = g["thumb"].as_str().unwrap_or(&url).to_string();
            Some(SgdbImage { url, thumb })
        })
        .take(30)
        .collect())
}

/// Best single portrait cover for `title`, used for automatic fills.
pub fn sgdb_cover(key: &str, title: &str) -> Result<Option<String>, String> {
    let Some(first) = sgdb_search(key, title)?.into_iter().next() else { return Ok(None) };
    Ok(sgdb_grids(key, first.id)?.into_iter().next().map(|i| i.url))
}

#[cfg(test)]
mod tests {
    #[test]
    fn encodes() {
        assert_eq!(super::urlencode("Baldur's Gate 3"), "Baldur%27s%20Gate%203");
        assert_eq!(super::urlencode("a:b"), "a%3Ab");
    }

    #[test]
    fn builds_steam_art_urls() {
        let item = serde_json::json!({
            "appid": 2623190,
            "assets": {
                "asset_url_format": "steam/apps/2623190/${FILENAME}?t=1753715775",
                "library_capsule_2x": "b52322f78cbdc7e6c267d873056abba7916f7ff3/library_600x900_2x.jpg",
                "header": "a7cee9165bb1bfc092c390c5cff215ce0e381dfc/header.jpg"
            }
        });
        let (id, art) = super::steam_art_from_item(&item).unwrap();
        assert_eq!(id, 2623190);
        assert_eq!(
            art.cover.unwrap(),
            "https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/2623190/b52322f78cbdc7e6c267d873056abba7916f7ff3/library_600x900_2x.jpg?t=1753715775"
        );
        assert!(art.header.unwrap().ends_with("header.jpg?t=1753715775"));
    }
}
