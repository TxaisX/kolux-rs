//! Row 954 (b): a page that gets its own tab destroyed anyway.
//!
//! `NO_CLOSE_SCRIPT` makes a tab's own `window.close()` a no-op, but a popup, a cross-origin frame
//! or a fresh about:blank frame can still call `close` on the tab's window. The engine then raises
//! its close request and wry answers by destroying the tab's window, leaving a dead page. The
//! request cannot be vetoed from the host side (wry's handler runs first and the event has no
//! "handled" flag), only observed, so the pane is told to build the tab again at its last address.
//! A page that does it in a loop gets the tab left closed instead.

#![cfg_attr(not(windows), allow(dead_code))] // the close hook is Windows-only

use serde::Serialize;
use std::collections::HashMap;
use std::sync::{LazyLock, Mutex};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter};

/// The tab destroyed itself; the pane of that tab builds it again, or says it stays closed.
pub const EVENT: &str = "browser-selfclosed";
/// A tab rebuilt this many times inside `WINDOW` is left closed the next time.
pub const MAX_REBUILDS: usize = 2;
pub const WINDOW: Duration = Duration::from_secs(10);
/// A process-failed report this soon after a close request belongs to that close, not to a crash.
pub const SETTLE: Duration = Duration::from_secs(2);

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Verdict {
    Reopen,
    LeaveClosed,
}

/// One tab's recent self-closes: when it was last rebuilt, and when its engine last asked to close.
#[derive(Debug, Default)]
pub struct History {
    rebuilds: Vec<Instant>,
    last_request: Option<Instant>,
}

#[derive(Serialize, Clone)]
pub struct Payload {
    pub id: u32,
    pub reopen: bool,
}

/// Records a close request and says what to do about it: rebuild the tab, unless it was already
/// rebuilt `MAX_REBUILDS` times within `WINDOW` (a page closing itself in a loop).
pub fn on_self_close(h: &mut History, now: Instant) -> Verdict {
    h.last_request = Some(now);
    h.rebuilds.retain(|t| now.saturating_duration_since(*t) < WINDOW);
    if h.rebuilds.len() >= MAX_REBUILDS {
        return Verdict::LeaveClosed;
    }
    h.rebuilds.push(now);
    Verdict::Reopen
}

/// Whether the tab's engine asked to close within `SETTLE` before `now`.
pub fn settling(h: &History, now: Instant) -> bool {
    h.last_request.is_some_and(|t| now.saturating_duration_since(t) < SETTLE)
}

static HISTORIES: LazyLock<Mutex<HashMap<u32, History>>> = LazyLock::new(Mutex::default);

/// The engine of tab `id` asked to close its window (it is being destroyed): decide and tell the pane.
pub fn requested(app: &AppHandle, id: u32) {
    let verdict = match HISTORIES.lock() {
        Ok(mut all) => on_self_close(all.entry(id).or_default(), Instant::now()),
        Err(_) => Verdict::LeaveClosed,
    };
    let _ = app.emit(EVENT, Payload { id, reopen: verdict == Verdict::Reopen });
}

/// True while a failure report for tab `id` is just the aftermath of its own close request.
pub fn aftermath(id: u32) -> bool {
    HISTORIES.lock().map(|all| all.get(&id).is_some_and(|h| settling(h, Instant::now()))).unwrap_or(false)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn at(s: u64) -> Instant {
        // A fixed origin far enough from the clock's zero that earlier instants exist.
        static BASE: LazyLock<Instant> = LazyLock::new(Instant::now);
        *BASE + Duration::from_secs(s)
    }

    #[test]
    fn row_954b_the_first_two_close_requests_in_ten_seconds_rebuild_the_tab() {
        let mut h = History::default();
        assert_eq!(on_self_close(&mut h, at(0)), Verdict::Reopen);
        assert_eq!(on_self_close(&mut h, at(3)), Verdict::Reopen);
    }

    #[test]
    fn row_954b_a_tab_rebuilt_twice_in_ten_seconds_is_left_closed() {
        let mut h = History::default();
        on_self_close(&mut h, at(0));
        on_self_close(&mut h, at(3));
        assert_eq!(on_self_close(&mut h, at(6)), Verdict::LeaveClosed);
        assert_eq!(on_self_close(&mut h, at(9)), Verdict::LeaveClosed, "a refusal does not restart the count");
    }

    #[test]
    fn row_954b_old_rebuilds_age_out_of_the_window() {
        let mut h = History::default();
        on_self_close(&mut h, at(0));
        on_self_close(&mut h, at(5));
        // The rebuild at 0 is 11 s old, only the one at 5 counts.
        assert_eq!(on_self_close(&mut h, at(11)), Verdict::Reopen);
        // Now rebuilds at 5 and 11 are both inside 10 s of 14.
        assert_eq!(on_self_close(&mut h, at(14)), Verdict::LeaveClosed);
    }

    #[test]
    fn row_954b_a_tab_left_closed_may_be_rebuilt_once_the_window_has_passed() {
        let mut h = History::default();
        on_self_close(&mut h, at(0));
        on_self_close(&mut h, at(1));
        assert_eq!(on_self_close(&mut h, at(2)), Verdict::LeaveClosed);
        assert_eq!(on_self_close(&mut h, at(20)), Verdict::Reopen);
    }

    #[test]
    fn row_954b_a_failure_report_just_after_a_close_request_is_its_aftermath() {
        let mut h = History::default();
        assert!(!settling(&h, at(0)), "no request yet");
        on_self_close(&mut h, at(10));
        assert!(settling(&h, at(11)));
        assert!(!settling(&h, at(12)), "SETTLE has passed");
    }
}
