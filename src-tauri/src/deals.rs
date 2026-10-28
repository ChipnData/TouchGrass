//! Store data shown inside the launcher: cross-store deals (CheapShark),
//! Epic's free games, and the PC Game Pass catalog. All public, no keys.

use crate::covers::{agent, get_json, urlencode};
use serde::Serialize;

// ---------------- CheapShark ----------------

/// Deals list, passed through to the UI. `sort` is a CheapShark sortBy value.
pub fn cheapshark_deals(store_id: Option<String>, sort: &str, page: u32, free_only: bool) -> Result<serde_json::Value, String> {
    let allowed = ["Deal Rating", "Savings", "Price", "Metacritic", "Reviews", "Release", "Recent", "Title"];
    let sort = if allowed.contains(&sort) { sort } else { "Deal Rating" };
    let mut url = format!(
        "https://www.cheapshark.com/api/1.0/deals?pageSize=60&pageNumber={page}&onSale=1&sortBy={}",
        urlencode(sort)
    );
    if let Some(s) = store_id.filter(|s| s.chars().all(|c| c.is_ascii_digit()) && !s.is_empty()) {
        url.push_str(&format!("&storeID={s}"));
    }
    if free_only {
        url.push_str("&upperPrice=0");
    }
    get_json(&agent(15), &url)
}

pub fn cheapshark_stores() -> Result<serde_json::Value, String> {
    get_json(&agent(15), "https://www.cheapshark.com/api/1.0/stores")
}

// ---------------- Epic free games ----------------

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EpicFree {
    pub title: String,
    pub image: Option<String>,
    /// "now" or "upcoming"
    pub status: String,
    pub starts: Option<String>,
    pub ends: Option<String>,
    pub slug: Option<String>,
}

fn free_window(promos: &serde_json::Value) -> Option<(String, String)> {
    promos
        .as_array()?
        .iter()
        .flat_map(|p| p["promotionalOffers"].as_array().cloned().unwrap_or_default())
        .find(|o| o["discountSetting"]["discountPercentage"].as_i64() == Some(0))
        .map(|o| {
            (
                o["startDate"].as_str().unwrap_or("").to_string(),
                o["endDate"].as_str().unwrap_or("").to_string(),
            )
        })
}

pub fn parse_epic_free(v: &serde_json::Value) -> Vec<EpicFree> {
    let mut out = Vec::new();
    for e in v["data"]["Catalog"]["searchStore"]["elements"].as_array().into_iter().flatten() {
        let Some(title) = e["title"].as_str() else { continue };
        let (status, window) = if let Some(w) = free_window(&e["promotions"]["promotionalOffers"]) {
            ("now", w)
        } else if let Some(w) = free_window(&e["promotions"]["upcomingPromotionalOffers"]) {
            ("upcoming", w)
        } else {
            continue;
        };
        let images = e["keyImages"].as_array().cloned().unwrap_or_default();
        let image = ["OfferImageTall", "DieselStoreFrontTall", "Thumbnail", "OfferImageWide", "DieselStoreFrontWide"]
            .iter()
            .find_map(|t| images.iter().find(|i| i["type"].as_str() == Some(t)))
            .and_then(|i| i["url"].as_str())
            .map(str::to_string);
        let slug = e["offerMappings"][0]["pageSlug"]
            .as_str()
            .or_else(|| e["catalogNs"]["mappings"][0]["pageSlug"].as_str())
            .or_else(|| e["productSlug"].as_str())
            .map(|s| s.trim_end_matches("/home").to_string())
            .filter(|s| !s.is_empty() && s != "[]");
        out.push(EpicFree {
            title: title.to_string(),
            image,
            status: status.into(),
            starts: Some(window.0).filter(|s| !s.is_empty()),
            ends: Some(window.1).filter(|s| !s.is_empty()),
            slug,
        });
    }
    out
}

pub fn epic_free() -> Result<Vec<EpicFree>, String> {
    let v = get_json(
        &agent(15),
        "https://store-site-backend-static-ipv4.ak.epicgames.com/freeGamesPromotions?locale=en-US&country=US&allowCountries=US",
    )?;
    Ok(parse_epic_free(&v))
}

// ---------------- PC Game Pass ----------------

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct GamePassGame {
    pub id: String,
    pub title: String,
    pub image: Option<String>,
}

const PC_GAME_PASS_LIST: &str = "fdd9e2a7-0fee-49f6-ad69-4354098401ff";

pub fn parse_products(v: &serde_json::Value) -> Vec<GamePassGame> {
    v["Products"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|p| {
            let id = p["ProductId"].as_str()?.to_string();
            let lp = &p["LocalizedProperties"][0];
            let title = lp["ProductTitle"].as_str()?.to_string();
            let imgs = lp["Images"].as_array().cloned().unwrap_or_default();
            let image = ["Poster", "BoxArt"]
                .iter()
                .find_map(|k| imgs.iter().find(|i| i["ImagePurpose"].as_str() == Some(k)))
                .and_then(|i| i["Uri"].as_str())
                .map(|u| {
                    let u = if u.starts_with("//") { format!("https:{u}") } else { u.to_string() };
                    format!("{u}?w=300")
                });
            Some(GamePassGame { id, title, image })
        })
        .collect()
}

pub fn gamepass() -> Result<Vec<GamePassGame>, String> {
    let a = agent(20);
    let list = get_json(
        &a,
        &format!("https://catalog.gamepass.com/sigls/v2?id={PC_GAME_PASS_LIST}&language=en-us&market=US"),
    )?;
    let ids: Vec<String> = list
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|x| x["id"].as_str().map(str::to_string))
        .collect();
    if ids.is_empty() {
        return Err("Game Pass catalog came back empty".into());
    }
    let chunks: Vec<Vec<String>> = ids.chunks(20).map(|c| c.to_vec()).collect();
    let mut games = Vec::new();
    // A few requests at a time keeps it quick without hammering the service.
    for group in chunks.chunks(6) {
        let results: Vec<Result<Vec<GamePassGame>, String>> = std::thread::scope(|s| {
            let hs: Vec<_> = group
                .iter()
                .map(|c| {
                    let a = a.clone();
                    s.spawn(move || {
                        let url = format!(
                            "https://displaycatalog.mp.microsoft.com/v7.0/products?bigIds={}&market=US&languages=en-us&MS-CV=DGU1mcuYo0WMMp%2BF.1",
                            c.join(",")
                        );
                        get_json(&a, &url).map(|v| parse_products(&v))
                    })
                })
                .collect();
            hs.into_iter().map(|h| h.join().unwrap_or_else(|_| Err("crashed".into()))).collect()
        });
        for r in results {
            games.extend(r?);
        }
    }
    games.sort_by(|x, y| x.title.to_lowercase().cmp(&y.title.to_lowercase()));
    Ok(games)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn epic_free_parsing() {
        let v = serde_json::json!({"data":{"Catalog":{"searchStore":{"elements":[
            {"title":"Free Now Game","keyImages":[{"type":"OfferImageTall","url":"https://img/tall.jpg"}],
             "offerMappings":[{"pageSlug":"free-now-game"}],
             "promotions":{"promotionalOffers":[{"promotionalOffers":[{"startDate":"2026-10-23T15:00:00.000Z","endDate":"2026-10-30T15:00:00.000Z","discountSetting":{"discountPercentage":0}}]}],"upcomingPromotionalOffers":[]}},
            {"title":"Next Week","keyImages":[],"productSlug":"next-week/home",
             "promotions":{"promotionalOffers":[],"upcomingPromotionalOffers":[{"promotionalOffers":[{"startDate":"2026-10-30T15:00:00.000Z","endDate":"2026-11-06T15:00:00.000Z","discountSetting":{"discountPercentage":0}}]}]}},
            {"title":"Just On Sale","promotions":{"promotionalOffers":[{"promotionalOffers":[{"discountSetting":{"discountPercentage":50}}]}]}},
            {"title":"No Promo","promotions":null}
        ]}}}});
        let f = parse_epic_free(&v);
        assert_eq!(f.len(), 2);
        assert_eq!(f[0].status, "now");
        assert_eq!(f[0].slug.as_deref(), Some("free-now-game"));
        assert_eq!(f[0].image.as_deref(), Some("https://img/tall.jpg"));
        assert_eq!(f[1].status, "upcoming");
        assert_eq!(f[1].slug.as_deref(), Some("next-week"));
    }

    #[test]
    fn gamepass_products() {
        let v = serde_json::json!({"Products":[{"ProductId":"9NBLGGH4R315","LocalizedProperties":[{"ProductTitle":"Forza Horizon 5",
            "Images":[{"ImagePurpose":"BoxArt","Uri":"//store-images.s-microsoft.com/a"},{"ImagePurpose":"Poster","Uri":"//store-images.s-microsoft.com/p"}]}]}]});
        let g = parse_products(&v);
        assert_eq!(g[0].title, "Forza Horizon 5");
        assert_eq!(g[0].image.as_deref(), Some("https://store-images.s-microsoft.com/p?w=300"));
    }
}
