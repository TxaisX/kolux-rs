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
    /// The newest front-end sequence number accepted (calls arrive on a thread pool, out of order).
    last_seq: Option<u64>,
}

impl Through {
    /// Records the front end's call; the returned epoch belongs to this call.
    pub fn set(&mut self, on: bool) -> u64 {
        self.on = on;
        self.epoch += 1;
        self.epoch
    }

    /// Like `set`, but a call numbered `seq` that is not newer than the last numbered call is
    /// outdated and ignored (`None`); a call with no number (an older front end) is always accepted.
    pub fn submit(&mut self, on: bool, seq: Option<u64>) -> Option<u64> {
        if let Some(n) = seq {
            if self.last_seq.is_some_and(|last| n <= last) {
                return None;
            }
            self.last_seq = Some(n);
        }
        Some(self.set(on))
    }

    /// What every page container should be right now: enabled unless a drag is under way.
    pub fn pages_enabled(&self) -> bool {
        !self.on
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

/// The app says a drag started (`on`), is still going (`on` again) or ended (`!on`); `seq` grows
/// with each call so a call that overtakes an earlier one on the thread pool is not undone by it.
#[tauri::command]
pub async fn browser_drag_through(app: AppHandle, on: bool, seq: Option<u64>) -> Result<(), String> {
    let epoch = match STATE.lock() {
        Ok(mut s) => s.submit(on, seq),
        Err(_) => return Err("drag state unavailable".into()),
    };
    let Some(epoch) = epoch else { return Ok(()) };
    apply(&app);
    if on {
        let app = app.clone();
        std::thread::spawn(move || {
            std::thread::sleep(DEADMAN);
            let release = STATE.lock().map(|mut s| s.expire(epoch)).unwrap_or(false);
            if release {
                apply(&app);
            }
        });
    }
    Ok(())
}

/// Sets every open page's container to what the state says now. The state and the container list
/// are read when the job RUNS on the main thread, so whichever job runs last matches the latest
/// state, however the calls that queued them interleaved.
fn apply(app: &AppHandle) {
    let _ = app.run_on_main_thread(|| apply_now(&holder::containers(), &STATE, &mut set_enabled));
}

fn apply_now(all: &[isize], state: &Mutex<Through>, set: &mut impl FnMut(isize, bool)) {
    let enabled = state.lock().map(|s| s.pages_enabled()).unwrap_or(true);
    for &container in all {
        set(container, enabled);
    }
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
        fn GetWindowThreadProcessId(hwnd: *mut core::ffi::c_void, pid: *mut u32) -> u32;
    }
    #[link(name = "kernel32")]
    extern "system" {
        fn GetCurrentProcessId() -> u32;
    }
    if container == 0 {
        return;
    }
    let mut name = [0u16; 32];
    // SAFETY: `name` is a writable buffer of the length passed; a stale handle makes the call return 0.
    let n = unsafe { GetClassNameW(container as _, name.as_mut_ptr(), name.len() as i32) };
    let mut pid = 0u32;
    // SAFETY: `pid` is a writable u32; a stale handle leaves it 0.
    unsafe { GetWindowThreadProcessId(container as _, &mut pid) };
    // SAFETY: no arguments, no preconditions.
    let ours = pid != 0 && pid == unsafe { GetCurrentProcessId() };
    // A destroyed container's number can be reused by another app's window: never touch that.
    if n <= 0 || !is_page_class(&String::from_utf16_lossy(&name[..n as usize])) || !ours {
        holder::forget_container(container);
        return;
    }
    // SAFETY: the handle is a live web view container of this process checked above; EnableWindow only flips its enabled flag.
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

    #[test]
    fn t319c_a_numbered_call_that_is_not_newer_is_ignored() {
        let mut s = Through::default();
        assert!(s.submit(false, Some(5)).is_some());
        assert!(s.submit(true, Some(4)).is_none(), "an older start overtaken by its end is dropped");
        assert!(!s.on);
        assert!(s.submit(true, Some(5)).is_none(), "an equal number is a repeat");
        assert!(s.submit(true, Some(6)).is_some());
        assert!(s.on);
    }

    #[test]
    fn t319c_a_call_without_a_number_is_accepted() {
        let mut s = Through::default();
        assert!(s.submit(true, Some(9)).is_some());
        assert!(s.submit(false, None).is_some(), "an older front end sends no number");
        assert!(!s.on);
        assert!(s.submit(true, None).is_some());
        assert!(s.on);
    }

    #[test]
    fn t319c_the_last_main_thread_job_wins_whatever_order_the_jobs_run_in() {
        // start (on) then end (off) each set the state and queue a job; both jobs run after the end.
        let state = Mutex::new(Through::default());
        state.lock().unwrap().submit(true, Some(1));
        state.lock().unwrap().submit(false, Some(2));
        let mut seen = Vec::new();
        apply_now(&[10, 11], &state, &mut |_, e| seen.push(e)); // the end's job
        apply_now(&[10, 11], &state, &mut |_, e| seen.push(e)); // the start's job, run last
        assert_eq!(seen, [true; 4], "an ended drag leaves every page enabled");
    }

    #[test]
    fn t319c_a_job_run_after_a_late_start_disables_and_one_run_after_the_end_enables() {
        let state = Mutex::new(Through::default());
        let mut seen = Vec::new();
        state.lock().unwrap().submit(true, Some(1));
        apply_now(&[7], &state, &mut |_, e| seen.push(e));
        state.lock().unwrap().submit(false, Some(2));
        apply_now(&[7], &state, &mut |_, e| seen.push(e));
        assert_eq!(seen, [false, true]);
    }

    #[test]
    fn t319c_an_end_that_reaches_the_back_end_first_leaves_pages_enabled() {
        let state = Mutex::new(Through::default());
        state.lock().unwrap().submit(false, Some(2));
        assert!(state.lock().unwrap().submit(true, Some(1)).is_none());
        let mut seen = Vec::new();
        apply_now(&[3], &state, &mut |_, e| seen.push(e));
        assert_eq!(seen, [true]);
    }
}
