mod controller;
mod covers;
mod data;
mod deals;
mod launch;
mod programs;
mod scan;
mod system;

use serde::{Deserialize, Serialize};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Emitter, Manager, WindowEvent, Wry};
use tauri_plugin_autostart::{MacosLauncher, ManagerExt};
use tauri_plugin_dialog::DialogExt;
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState};
use tauri_plugin_updater::UpdaterExt;
use tauri_plugin_window_state::StateFlags;

const TRAY_ID: &str = "touchgrass-tray";

struct AppState {
    close_to_tray: AtomicBool,
    autostarted: bool,
    pending_update: Mutex<Option<tauri_plugin_updater::Update>>,
}

fn hotkey() -> Shortcut {
    Shortcut::new(Some(Modifiers::CONTROL | Modifiers::SHIFT), Code::Space)
}

fn show_main(app: &AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.unminimize();
        let _ = w.show();
        let _ = w.set_focus();
    }
}

/// Shows the window and pulls it in front of whatever has focus.
pub(crate) fn bring_to_front(app: &AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.unminimize();
        let _ = w.show();
        // Windows won't let a background app take focus directly; briefly
        // being "always on top" gets the window in front.
        let _ = w.set_always_on_top(true);
        let _ = w.set_focus();
        let _ = w.set_always_on_top(false);
    }
}

fn toggle_main(app: &AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let visible = w.is_visible().unwrap_or(false);
        let focused = w.is_focused().unwrap_or(false);
        let minimized = w.is_minimized().unwrap_or(false);
        if visible && focused && !minimized {
            let _ = w.hide();
        } else {
            bring_to_front(app);
            let _ = app.emit_to("main", "focus-search", ());
        }
    }
}

#[derive(Deserialize)]
struct TrayItem {
    id: String,
    title: String,
}

fn build_tray_menu(app: &AppHandle, items: &[TrayItem]) -> tauri::Result<Menu<Wry>> {
    let menu = Menu::new(app)?;
    menu.append(&MenuItem::with_id(app, "show", "Open Touch Grass", true, None::<&str>)?)?;
    menu.append(&MenuItem::with_id(app, "bigscreen", "Big Screen", true, None::<&str>)?)?;
    if !items.is_empty() {
        menu.append(&PredefinedMenuItem::separator(app)?)?;
        for it in items.iter().take(8) {
            let label: String = it.title.chars().take(40).collect();
            menu.append(&MenuItem::with_id(app, format!("game:{}", it.id), label, true, None::<&str>)?)?;
        }
    }
    menu.append(&PredefinedMenuItem::separator(app)?)?;
    menu.append(&MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?)?;
    Ok(menu)
}

fn e2s<E: std::fmt::Display>(e: E) -> String {
    e.to_string()
}

async fn blocking<T: Send + 'static>(f: impl FnOnce() -> Result<T, String> + Send + 'static) -> Result<T, String> {
    tauri::async_runtime::spawn_blocking(f).await.map_err(e2s)?
}

// ---------- data ----------

#[tauri::command]
fn load_data(app: AppHandle) -> serde_json::Value {
    data::read(&app)
}

#[tauri::command]
fn save_data(app: AppHandle, data: serde_json::Value) -> Result<(), String> {
    data::write(&app, &data)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct LaunchContext {
    autostarted: bool,
    version: String,
}

#[tauri::command]
fn launch_context(app: AppHandle, state: tauri::State<AppState>) -> LaunchContext {
    LaunchContext { autostarted: state.autostarted, version: app.package_info().version.to_string() }
}

// ---------- library ----------

#[tauri::command]
async fn scan_library(opts: scan::ScanOpts) -> Result<scan::ScanResult, String> {
    blocking(move || Ok(scan::scan_all(opts))).await
}

#[tauri::command]
fn launch_game(app: AppHandle, id: String, launch: scan::Launch, track: bool) -> Result<(), String> {
    launch::launch(&app, id, launch, track)
}

#[tauri::command]
fn open_folder(path: String) -> Result<(), String> {
    launch::open_folder(&path)
}

#[tauri::command]
fn open_link(url: String) -> Result<(), String> {
    launch::open_link(&url)
}

#[tauri::command]
fn open_uri(uri: String) -> Result<(), String> {
    launch::open_uri(&uri)
}

#[tauri::command]
async fn running_games(dirs: Vec<system::WatchDir>) -> Result<Vec<system::Running>, String> {
    blocking(move || Ok(system::running_games(dirs))).await
}

#[tauri::command]
async fn close_game(pids: Vec<u32>) -> Result<usize, String> {
    blocking(move || Ok(system::close_processes(pids))).await
}

// ---------- art ----------

#[tauri::command]
async fn steam_art(appids: Vec<u64>) -> Result<std::collections::HashMap<u64, covers::SteamArt>, String> {
    blocking(move || covers::steam_art(&appids)).await
}

#[tauri::command]
async fn sgdb_cover(key: String, title: String) -> Result<Option<String>, String> {
    blocking(move || covers::sgdb_cover(key.trim(), &title)).await
}

#[tauri::command]
async fn sgdb_search(key: String, term: String) -> Result<Vec<covers::SgdbGame>, String> {
    blocking(move || covers::sgdb_search(key.trim(), &term)).await
}

#[tauri::command]
async fn sgdb_grids(key: String, game_id: u64) -> Result<Vec<covers::SgdbImage>, String> {
    blocking(move || covers::sgdb_grids(key.trim(), game_id)).await
}

// ---------- store ----------

#[tauri::command]
fn open_store_app(store: String) -> Result<(), String> {
    system::open_store_app(&store)
}

#[tauri::command]
async fn deals(store_id: Option<String>, sort: String, page: u32, free_only: bool) -> Result<serde_json::Value, String> {
    blocking(move || deals::cheapshark_deals(store_id, &sort, page, free_only)).await
}

#[tauri::command]
async fn deal_stores() -> Result<serde_json::Value, String> {
    blocking(deals::cheapshark_stores).await
}

#[tauri::command]
async fn epic_free() -> Result<Vec<deals::EpicFree>, String> {
    blocking(deals::epic_free).await
}

#[tauri::command]
async fn gamepass() -> Result<Vec<deals::GamePassGame>, String> {
    blocking(deals::gamepass).await
}

// ---------- programs & websites ----------

#[tauri::command]
async fn scan_programs(app: AppHandle) -> Result<Vec<programs::Program>, String> {
    let dir = app.path().app_cache_dir().map_err(e2s)?.join("program-icons");
    blocking(move || programs::scan(&dir)).await
}

#[tauri::command]
fn launch_program(id: String) -> Result<(), String> {
    launch::open_uri(&format!(r"shell:AppsFolder\{id}"))
}

#[tauri::command]
fn open_website(url: String, app_window: bool) -> Result<(), String> {
    system::open_website(&url, app_window)
}

// ---------- files ----------

#[tauri::command]
async fn pick_file(app: AppHandle, kind: String) -> Option<String> {
    let dlg = app.dialog().file();
    let dlg = match kind.as_str() {
        "image" => dlg.set_title("Choose an image").add_filter("Images", &["png", "jpg", "jpeg", "webp", "gif"]),
        "backup" => dlg.set_title("Choose a backup").add_filter("Touch Grass backup", &["json"]),
        "theme" => dlg.set_title("Choose a theme").add_filter("Touch Grass theme", &["json"]),
        _ => dlg.set_title("Choose a game").add_filter("Games", &["exe", "lnk", "url", "bat", "cmd"]),
    };
    dlg.blocking_pick_file().and_then(|p| p.into_path().ok()).map(|p| p.to_string_lossy().into_owned())
}

/// Asks where to save, then writes `content` (JSON) there.
#[tauri::command]
async fn save_json_file(app: AppHandle, default_name: String, content: serde_json::Value) -> Result<bool, String> {
    let Some(path) = app
        .dialog()
        .file()
        .set_file_name(&default_name)
        .add_filter("JSON", &["json"])
        .blocking_save_file()
        .and_then(|p| p.into_path().ok())
    else {
        return Ok(false);
    };
    system::export_backup(&content, &path).map(|_| true)
}

#[tauri::command]
fn read_json_file(path: String, kind: String) -> Result<serde_json::Value, String> {
    if kind == "backup" {
        return system::read_backup(std::path::Path::new(&path));
    }
    let text = std::fs::read_to_string(&path).map_err(e2s)?;
    serde_json::from_str(&text).map_err(|_| "That file couldn't be read".to_string())
}

// ---------- window & system ----------

#[tauri::command]
fn set_fullscreen(app: AppHandle, on: bool) -> Result<(), String> {
    let w = app.get_webview_window("main").ok_or("no window")?;
    w.set_fullscreen(on).map_err(e2s)?;
    if on {
        let _ = w.set_focus();
    }
    Ok(())
}

#[tauri::command]
fn power(action: String) -> Result<(), String> {
    system::power(&action)
}

#[tauri::command]
fn get_autostart(app: AppHandle) -> bool {
    app.autolaunch().is_enabled().unwrap_or(false)
}

#[tauri::command]
fn set_autostart(app: AppHandle, enabled: bool) -> Result<bool, String> {
    let al = app.autolaunch();
    if enabled { al.enable() } else { al.disable() }.map_err(e2s)?;
    Ok(al.is_enabled().unwrap_or(false))
}

#[tauri::command]
fn set_close_to_tray(state: tauri::State<AppState>, enabled: bool) {
    state.close_to_tray.store(enabled, Ordering::SeqCst);
}

#[tauri::command]
fn set_controller_summon(state: tauri::State<controller::Summon>, enabled: bool) {
    state.enabled.store(enabled, Ordering::SeqCst);
}

#[tauri::command]
fn set_hotkey(app: AppHandle, enabled: bool) -> Result<(), String> {
    let gs = app.global_shortcut();
    let k = hotkey();
    let registered = gs.is_registered(k);
    if enabled && !registered {
        gs.register(k).map_err(|e| format!("Couldn't register Ctrl+Shift+Space (another app may own it): {e}"))?;
    } else if !enabled && registered {
        gs.unregister(k).map_err(e2s)?;
    }
    Ok(())
}

#[tauri::command]
fn update_tray(app: AppHandle, items: Vec<TrayItem>) -> Result<(), String> {
    let menu = build_tray_menu(&app, &items).map_err(e2s)?;
    if let Some(tray) = app.tray_by_id(TRAY_ID) {
        tray.set_menu(Some(menu)).map_err(e2s)?;
    }
    Ok(())
}

#[tauri::command]
fn hide_main(app: AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.hide();
    }
}

#[tauri::command]
fn quit_app(app: AppHandle) {
    app.exit(0);
}

// ---------- updates ----------

#[derive(Serialize)]
struct UpdateInfo {
    version: String,
    notes: Option<String>,
}

#[tauri::command]
async fn check_update(app: AppHandle, state: tauri::State<'_, AppState>) -> Result<Option<UpdateInfo>, String> {
    let update = app.updater().map_err(e2s)?.check().await.map_err(e2s)?;
    let info = update.as_ref().map(|u| UpdateInfo { version: u.version.clone(), notes: u.body.clone() });
    *state.pending_update.lock().map_err(e2s)? = update;
    Ok(info)
}

#[tauri::command]
async fn install_update(app: AppHandle, state: tauri::State<'_, AppState>) -> Result<(), String> {
    let update = state.pending_update.lock().map_err(e2s)?.take().ok_or("No update waiting")?;
    update.download_and_install(|_, _| {}, || {}).await.map_err(e2s)?;
    app.restart();
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let summon_flag = Arc::new(AtomicBool::new(true));
    tauri::Builder::default()
        // Must be first: a second launch just focuses the running one.
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| bring_to_front(app)))
        .plugin(tauri_plugin_autostart::init(MacosLauncher::LaunchAgent, Some(vec!["--minimized"])))
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(
            tauri_plugin_window_state::Builder::default()
                .with_state_flags(StateFlags::all().difference(StateFlags::VISIBLE | StateFlags::FULLSCREEN))
                .build(),
        )
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, shortcut, event| {
                    if shortcut == &hotkey() && event.state() == ShortcutState::Pressed {
                        toggle_main(app);
                    }
                })
                .build(),
        )
        .manage(AppState {
            close_to_tray: AtomicBool::new(true),
            autostarted: std::env::args().any(|a| a == "--minimized"),
            pending_update: Mutex::new(None),
        })
        .manage(controller::Summon { enabled: summon_flag.clone() })
        .setup(move |app| {
            let handle = app.handle().clone();
            system::migrate_from_lumen(&data::path(&handle));
            let saved = data::read(&handle);

            app.state::<AppState>()
                .close_to_tray
                .store(data::setting_bool(&saved, "closeToTray", true), Ordering::SeqCst);
            summon_flag.store(data::setting_bool(&saved, "controllerSummon", true), Ordering::SeqCst);
            controller::start(handle.clone(), summon_flag.clone());

            if data::setting_bool(&saved, "hotkey", true) {
                let _ = app.global_shortcut().register(hotkey());
            }

            let menu = build_tray_menu(&handle, &[])?;
            let mut tray = TrayIconBuilder::with_id(TRAY_ID)
                .tooltip("Touch Grass")
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| {
                    let id = event.id().as_ref();
                    match id {
                        "show" => bring_to_front(app),
                        "bigscreen" => {
                            bring_to_front(app);
                            let _ = app.emit_to("main", "enter-bigscreen", ());
                        }
                        "quit" => app.exit(0),
                        other => {
                            if let Some(game) = other.strip_prefix("game:") {
                                let _ = app.emit_to("main", "tray-launch", game.to_string());
                            }
                        }
                    }
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        bring_to_front(tray.app_handle());
                    }
                });
            if let Some(icon) = app.default_window_icon() {
                tray = tray.icon(icon.clone());
            }
            tray.build(app)?;

            // Started by Windows at sign-in: follow the user's chosen startup mode.
            let autostarted = app.state::<AppState>().autostarted;
            let mode = saved["settings"]["startupMode"].as_str().map(str::to_string).unwrap_or_else(|| {
                if data::setting_bool(&saved, "startMinimized", true) { "tray".into() } else { "window".into() }
            });
            if !(autostarted && mode == "tray") {
                show_main(&handle);
            }
            Ok(())
        })
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                if window.label() == "main"
                    && window.state::<AppState>().close_to_tray.load(Ordering::SeqCst)
                {
                    api.prevent_close();
                    let _ = window.hide();
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            load_data,
            save_data,
            launch_context,
            scan_library,
            launch_game,
            open_folder,
            open_link,
            open_uri,
            running_games,
            close_game,
            steam_art,
            sgdb_cover,
            sgdb_search,
            sgdb_grids,
            open_store_app,
            deals,
            deal_stores,
            epic_free,
            gamepass,
            scan_programs,
            launch_program,
            open_website,
            pick_file,
            save_json_file,
            read_json_file,
            set_fullscreen,
            power,
            get_autostart,
            set_autostart,
            set_close_to_tray,
            set_controller_summon,
            set_hotkey,
            update_tray,
            hide_main,
            quit_app,
            check_update,
            install_update
        ])
        .run(tauri::generate_context!())
        .expect("error while running Touch Grass");
}
