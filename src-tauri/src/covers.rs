//! Optional cover-art lookup through SteamGridDB (free API key).

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

fn get(agent: &ureq::Agent, url: &str, key: &str) -> Result<serde_json::Value, String> {
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

/// Returns the URL of a 600x900 portrait cover for `title`, if one exists.
pub fn sgdb_cover(key: &str, title: &str) -> Result<Option<String>, String> {
    let agent = ureq::AgentBuilder::new().timeout(Duration::from_secs(10)).build();
    let base = "https://www.steamgriddb.com/api/v2";
    let search = get(&agent, &format!("{base}/search/autocomplete/{}", urlencode(title)), key)?;
    let Some(id) = search["data"][0]["id"].as_u64() else { return Ok(None) };
    let grids = get(&agent, &format!("{base}/grids/game/{id}?dimensions=600x900&types=static"), key)?;
    Ok(grids["data"][0]["url"].as_str().map(str::to_string))
}

#[cfg(test)]
mod tests {
    #[test]
    fn encodes() {
        assert_eq!(super::urlencode("Baldur's Gate 3"), "Baldur%27s%20Gate%203");
        assert_eq!(super::urlencode("a:b"), "a%3Ab");
    }
}
