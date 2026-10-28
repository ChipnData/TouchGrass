mod covers;
mod data;
mod launch;
mod scan;

use serde::Deserialize;
use std::sync::atomic::{AtomicBool, Ordering};
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Emitter, Manager, WebviewUrl, WebviewWindowBuilder, WindowEvent, Wry};
use tauri_plugin_autostart::{MacosLauncher, ManagerExt};
use tauri_plugin_dialog::DialogExt;
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState};
use tauri_plugin_window_state::StateFlags;

const TRAY_ID: &str = "lumen-tray";

struct AppState {
    close_to_tray: AtomicBool,
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

fn toggle_main(app: &AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let visible = w.is_visible().unwrap_or(false);
        let focused = w.is_focused().unwrap_or(false);
        let minimized = w.is_minimized().unwrap_or(false);
        if visible && focused && !minimized {
            let _ = w.hide();
        } else {
            show_main(app);
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
    menu.append(&MenuItem::with_id(app, "show", "Open Lumen", true, None::<&str>)?)?;
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

// ---------- commands ----------

#[tauri::command]
fn load_data(app: AppHandle) -> serde_json::Value {
    data::read(&app)
}

#[tauri::command]
fn save_data(app: AppHandle, data: serde_json::Value) -> Result<(), String> {
    data::write(&app, &data)
}

#[tauri::command]
async fn scan_library(opts: scan::ScanOpts) -> Result<scan::ScanResult, String> {
    tauri::async_runtime::spawn_blocking(move || scan::scan_all(opts))
        .await
        .map_err(|e| e.to_string())
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

/// Opens a storefront in Lumen's store window (sign-ins are remembered).
#[tauri::command]
fn open_store(app: AppHandle, url: String, title: String) -> Result<(), String> {
    let parsed: tauri::Url = url.parse().map_err(|_| "Bad store link".to_string())?;
    let host = parsed.host_str().unwrap_or("");
    let allowed = ["store.steampowered.com", "store.epicgames.com", "www.xbox.com", "shop.battle.net"];
    if parsed.scheme() != "https" || !allowed.contains(&host) {
        return Err("Not a supported store".into());
    }
    let win_title = format!("{title} — Lumen");
    if let Some(w) = app.get_webview_window("store") {
        w.navigate(parsed).map_err(|e| e.to_string())?;
        let _ = w.set_title(&win_title);
        let _ = w.unminimize();
        let _ = w.show();
        let _ = w.set_focus();
        return Ok(());
    }
    WebviewWindowBuilder::new(&app, "store", WebviewUrl::External(parsed))
        .title(win_title)
        .inner_size(1280.0, 860.0)
        .min_inner_size(800.0, 560.0)
        .build()
        .map(|_| ())
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn pick_file(app: AppHandle, kind: String) -> Option<String> {
    let dlg = app.dialog().file();
    let dlg = if kind == "image" {
        dlg.set_title("Choose cover art").add_filter("Images", &["png", "jpg", "jpeg", "webp"])
    } else {
        dlg.set_title("Choose a game").add_filter("Games", &["exe", "lnk", "url", "bat", "cmd"])
    };
    dlg.blocking_pick_file()
        .and_then(|p| p.into_path().ok())
        .map(|p| p.to_string_lossy().into_owned())
}

#[tauri::command]
async fn sgdb_cover(key: String, title: String) -> Result<Option<String>, String> {
    tauri::async_runtime::spawn_blocking(move || covers::sgdb_cover(key.trim(), &title))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
fn get_autostart(app: AppHandle) -> bool {
    app.autolaunch().is_enabled().unwrap_or(false)
}

#[tauri::command]
fn set_autostart(app: AppHandle, enabled: bool) -> Result<bool, String> {
    let al = app.autolaunch();
    if enabled { al.enable() } else { al.disable() }.map_err(|e| e.to_string())?;
    Ok(al.is_enabled().unwrap_or(false))
}

#[tauri::command]
fn set_close_to_tray(state: tauri::State<AppState>, enabled: bool) {
    state.close_to_tray.store(enabled, Ordering::SeqCst);
}

#[tauri::command]
fn set_hotkey(app: AppHandle, enabled: bool) -> Result<(), String> {
    let gs = app.global_shortcut();
    let k = hotkey();
    let registered = gs.is_registered(k);
    if enabled && !registered {
        gs.register(k).map_err(|e| format!("Couldn't register Ctrl+Shift+Space (another app may own it): {e}"))?;
    } else if !enabled && registered {
        gs.unregister(k).map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
fn update_tray(app: AppHandle, items: Vec<TrayItem>) -> Result<(), String> {
    let menu = build_tray_menu(&app, &items).map_err(|e| e.to_string())?;
    if let Some(tray) = app.tray_by_id(TRAY_ID) {
        tray.set_menu(Some(menu)).map_err(|e| e.to_string())?;
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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        // Must be first: a second launch just focuses the running one.
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| show_main(app)))
        .plugin(tauri_plugin_autostart::init(MacosLauncher::LaunchAgent, Some(vec!["--minimized"])))
        .plugin(tauri_plugin_dialog::init())
        .plugin(
            tauri_plugin_window_state::Builder::default()
                .with_state_flags(StateFlags::all().difference(StateFlags::VISIBLE))
                .with_denylist(&["store"])
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
        .manage(AppState { close_to_tray: AtomicBool::new(true) })
        .setup(|app| {
            let handle = app.handle().clone();
            let saved = data::read(&handle);

            app.state::<AppState>()
                .close_to_tray
                .store(data::setting_bool(&saved, "closeToTray", true), Ordering::SeqCst);

            if data::setting_bool(&saved, "hotkey", true) {
                let _ = app.global_shortcut().register(hotkey());
            }

            let menu = build_tray_menu(&handle, &[])?;
            let mut tray = TrayIconBuilder::with_id(TRAY_ID)
                .tooltip("Lumen")
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| {
                    let id = event.id().as_ref();
                    match id {
                        "show" => show_main(app),
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
                        show_main(tray.app_handle());
                    }
                });
            if let Some(icon) = app.default_window_icon() {
                tray = tray.icon(icon.clone());
            }
            tray.build(app)?;

            // Started by Windows at sign-in: stay in the tray if the user asked for that.
            let autostarted = std::env::args().any(|a| a == "--minimized");
            let stay_hidden = autostarted && data::setting_bool(&saved, "startMinimized", true);
            if !stay_hidden {
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
            scan_library,
            launch_game,
            open_folder,
            open_link,
            open_store,
            pick_file,
            sgdb_cover,
            get_autostart,
            set_autostart,
            set_close_to_tray,
            set_hotkey,
            update_tray,
            hide_main,
            quit_app
        ])
        .run(tauri::generate_context!())
        .expect("error while running Lumen");
}
