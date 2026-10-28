//! The app's single JSON data file (settings, custom games, favorites,
//! playtime, cached library) in %APPDATA%\com.lumen.launcher\data.json.

use serde_json::{json, Value};
use std::path::PathBuf;
use tauri::{AppHandle, Manager};

pub fn path(app: &AppHandle) -> PathBuf {
    app.path()
        .app_config_dir()
        .unwrap_or_else(|_| PathBuf::from("."))
        .join("data.json")
}

pub fn read(app: &AppHandle) -> Value {
    std::fs::read_to_string(path(app))
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_else(|| json!({}))
}

pub fn write(app: &AppHandle, v: &Value) -> Result<(), String> {
    let p = path(app);
    if let Some(dir) = p.parent() {
        std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    }
    let tmp = p.with_extension("json.tmp");
    let text = serde_json::to_string_pretty(v).map_err(|e| e.to_string())?;
    std::fs::write(&tmp, text).map_err(|e| e.to_string())?;
    std::fs::rename(&tmp, &p).map_err(|e| e.to_string())
}

pub fn setting_bool(v: &Value, key: &str, default: bool) -> bool {
    v["settings"][key].as_bool().unwrap_or(default)
}
