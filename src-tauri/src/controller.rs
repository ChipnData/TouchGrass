//! Summon Touch Grass with a controller: hold View + Menu (Back + Start) on
//! any Xbox-compatible pad, even while another app or game has focus.
//! Uses XInput directly; the browser's gamepad API only works while the
//! window is focused.

#[allow(unused_imports)]
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
#[allow(unused_imports)]
use tauri::{AppHandle, Emitter};

pub struct Summon {
    pub enabled: Arc<AtomicBool>,
}

#[cfg(not(windows))]
pub fn start(_app: AppHandle, _enabled: Arc<AtomicBool>) {}

#[cfg(windows)]
pub fn start(app: AppHandle, enabled: Arc<AtomicBool>) {
    use std::time::{Duration, Instant};
    use windows_sys::Win32::UI::Input::XboxController::{
        XInputGetState, XINPUT_GAMEPAD_BACK, XINPUT_GAMEPAD_START, XINPUT_STATE,
    };
    const ERROR_SUCCESS: u32 = 0;
    const COMBO: u16 = XINPUT_GAMEPAD_BACK | XINPUT_GAMEPAD_START;

    std::thread::spawn(move || {
        let mut connected = [false; 4];
        let mut last_probe = Instant::now().checked_sub(Duration::from_secs(10)).unwrap_or_else(Instant::now);
        let mut held_since: Option<Instant> = None;
        let mut fired = false;
        loop {
            std::thread::sleep(Duration::from_millis(if enabled.load(Ordering::Relaxed) { 100 } else { 1000 }));
            if !enabled.load(Ordering::Relaxed) {
                continue;
            }
            // Asking about empty controller slots is slow, so only re-check them every few seconds.
            let probe = last_probe.elapsed() > Duration::from_secs(3);
            if probe {
                last_probe = Instant::now();
            }
            let mut pressed = false;
            for (i, c) in connected.iter_mut().enumerate() {
                if !*c && !probe {
                    continue;
                }
                let mut st: XINPUT_STATE = unsafe { std::mem::zeroed() };
                let ok = unsafe { XInputGetState(i as u32, &mut st) } == ERROR_SUCCESS;
                *c = ok;
                if ok && st.Gamepad.wButtons & COMBO == COMBO {
                    pressed = true;
                }
            }
            match (pressed, held_since) {
                (true, None) => held_since = Some(Instant::now()),
                (true, Some(t)) if !fired && t.elapsed() > Duration::from_millis(600) => {
                    fired = true;
                    let _ = app.emit("controller-summon", ());
                    crate::bring_to_front(&app);
                }
                (false, _) => {
                    held_since = None;
                    fired = false;
                }
                _ => {}
            }
        }
    });
}
