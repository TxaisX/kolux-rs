//! after-list 746 (T-319-c, BROW-052): a drag that starts in the app crosses browser pages.
//!
//! Every page is a child web view in its own container window, and that window takes the pointer
//! (and the system's drag-and-drop hit test) from the app underneath, so a drag from a tab, a pane
//! splitter or a sidebar file stopped at the page's edge. While the app says a drag is under way,
//! each page's container is disabled: the system skips a disabled window when it looks for what is
//! under the pointer, so the app's own view receives the drag, and the page keeps showing as it was.
//!
//! A drag that ends any way at all must give the pages back: the front end ends the state on drop,
//! cancel, Esc, pointer-up and blur, tells the back end again at start-up, and renews it while a
//! drag lasts; the back end lets go on its own when no renewal arrives within `DEADMAN`. A page
//! that is made while a drag is under way is disabled as it appears (`settle`).

use std::sync::{LazyLock, Mutex};
use std::time::Duration;
use tauri::AppHandle;

use super::holder;

/// The window class of the container wry makes for every child web view; no other window is touched.
pub const PAGE_CLASS: &str = "WRY_WEBVIEW";
/// Pages are given back when a drag has not been renewed for this long (the front end renews every 20 s).
pub const DEADMAN: Duration = Duration::from_secs(60);

/// Whether pages let the pointer through, and which call said so last (a later call outdates an
/// earlier call's dead-man timer).
#[derive(Debug, Default, PartialEq)]
pub struct Through {
    on: bool,
    epoch: u64,
}

impl Through {
    /// Records the front end's call; the returned epoch belongs to this call.
    pub fn set(&mut self, on: bool) -> u64 {
        self.on = on;
        self.epoch += 1;
        self.epoch
    }

    /// The dead-man timer of call `epoch` fired: true when it is still the latest call and pages are
    /// still let through, in which case they are given back.
    pub fn expire(&mut self, epoch: u64) -> bool {
        if self.on && self.epoch == epoch {
            self.on = false;
            true
        } else {
            false
        }
    }
}

static STATE: LazyLock<Mutex<Through>> = LazyLock::new(Mutex::default);

/// Pages let the pointer through right now.
pub fn is_through() -> bool {
    STATE.lock().map(|s| s.on).unwrap_or(false)
}

/// Only a web view's container is ever disabled, never the app's own window.
pub fn is_page_class(name: &str) -> bool {
    name == PAGE_CLASS
}

/// The app says a drag started (`on`), is still going (`on` again) or ended (`!on`).
#[tauri::command]
pub async fn browser_drag_through(app: AppHandle, on: bool) -> Result<(), String> {
    let epoch = match STATE.lock() {
        Ok(mut s) => s.set(on),
        Err(_) => return Err("drag state unavailable".into()),
    };
    apply(&app, !on);
    if on {
        let app = app.clone();
        std::thread::spawn(move || {
            std::thread::sleep(DEADMAN);
            let release = STATE.lock().map(|mut s| s.expire(epoch)).unwrap_or(false);
            if release {
                apply(&app, true);
            }
        });
    }
    Ok(())
}

/// Enables or disables every open page's container (on the main thread, which owns the windows).
fn apply(app: &AppHandle, enabled: bool) {
    let all = holder::containers();
    let _ = app.run_on_main_thread(move || {
        for container in all {
            set_enabled(container, enabled);
        }
    });
}

/// A page just made (main thread): it follows a drag that is already under way.
pub fn settle(container: isize) {
    if is_through() {
        set_enabled(container, false);
    }
}

#[cfg(windows)]
fn set_enabled(container: isize, enabled: bool) {
    use windows_sys::Win32::UI::WindowsAndMessaging::GetClassNameW;
    #[link(name = "user32")]
    extern "system" {
        fn EnableWindow(hwnd: *mut core::ffi::c_void, enable: i32) -> i32;
    }
    if container == 0 {
        return;
    }
    let mut name = [0u16; 32];
    // SAFETY: `name` is a writable buffer of the length passed; a stale handle makes the call return 0.
    let n = unsafe { GetClassNameW(container as _, name.as_mut_ptr(), name.len() as i32) };
    if n <= 0 || !is_page_class(&String::from_utf16_lossy(&name[..n as usize])) {
        return;
    }
    // SAFETY: the handle is a live web view container checked above; EnableWindow only flips its enabled flag.
    unsafe { EnableWindow(container as _, i32::from(enabled)) };
}

#[cfg(not(windows))]
fn set_enabled(_container: isize, _enabled: bool) {}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn t319c_a_drag_started_lets_pages_through_and_an_end_gives_them_back() {
        let mut s = Through::default();
        assert!(!s.on);
        s.set(true);
        assert!(s.on);
        s.set(false);
        assert!(!s.on);
    }

    #[test]
    fn t319c_a_silent_drag_is_given_back_by_its_dead_man_timer() {
        let mut s = Through::default();
        let first = s.set(true);
        assert!(s.expire(first), "nothing renewed it, so pages are given back");
        assert!(!s.on);
    }

    #[test]
    fn t319c_a_renewed_drag_outlives_the_older_timer() {
        let mut s = Through::default();
        let first = s.set(true);
        let renewed = s.set(true);
        assert!(!s.expire(first), "the older timer is outdated");
        assert!(s.on);
        assert!(s.expire(renewed));
    }

    #[test]
    fn t319c_an_ended_drag_is_not_ended_twice_by_its_timer() {
        let mut s = Through::default();
        let first = s.set(true);
        s.set(false);
        assert!(!s.expire(first));
    }

    #[test]
    fn t319c_only_a_web_view_container_is_ever_disabled() {
        assert!(is_page_class("WRY_WEBVIEW"));
        assert!(!is_page_class("Chrome_WidgetWin_1"));
        assert!(!is_page_class("TauriWindow"));
        assert!(!is_page_class(""));
    }

    #[test]
    fn t319c_the_dead_man_wait_outlasts_the_front_end_renewal() {
        assert!(DEADMAN >= Duration::from_secs(40));
    }
}
