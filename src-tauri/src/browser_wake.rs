//! T-283 (BROW-010): pages are checked again after the computer wakes.
//!
//! One watcher for the whole app notices a wake and sends one signal that every browser pane
//! hears; each pane then checks its own page with the probe it already runs (T-074) and gets a
//! fresh automatic reload, so a page lost during sleep is rebuilt rather than left blank, and one
//! page that cannot recover does not stop the others (each pane acts on its own).
//!
//! A wake is seen as a jump of the wall clock across one short sleep of the watcher's thread: the
//! thread does not run while the computer sleeps, the wall clock does. A clock set forward by hand
//! reads as a wake too, which costs only one extra check of each page.

use std::sync::OnceLock;
use std::time::{Duration, SystemTime};
use tauri::{AppHandle, Emitter};

pub const WAKE_EVENT: &str = "browser-wake";
/// How often the watcher looks at the clock.
pub const TICK: Duration = Duration::from_secs(5);
/// How much later than one tick the clock may be before it counts as a wake (a busy computer
/// delays a thread by seconds, never by this much).
pub const SLACK: Duration = Duration::from_secs(25);

/// Whether the wall clock moved past one tick plus the slack between `before` and `now`; a clock
/// set back never counts.
pub fn woke(before: SystemTime, now: SystemTime, tick: Duration) -> bool {
    now.duration_since(before).is_ok_and(|d| d > tick + SLACK)
}

static WATCHING: OnceLock<()> = OnceLock::new();

/// Starts the one watcher (later calls do nothing).
pub fn watch(app: &AppHandle) {
    WATCHING.get_or_init(|| {
        let app = app.clone();
        let _ = std::thread::Builder::new().name("browser-wake".into()).spawn(move || loop {
            let before = SystemTime::now();
            std::thread::sleep(TICK);
            if woke(before, SystemTime::now(), TICK) {
                let _ = app.emit(WAKE_EVENT, ());
            }
        });
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn brow010_a_long_jump_of_the_clock_across_one_tick_is_a_wake() {
        let t = SystemTime::UNIX_EPOCH + Duration::from_secs(1_000_000);
        assert!(!woke(t, t + TICK, TICK), "an ordinary tick");
        assert!(!woke(t, t + TICK + SLACK, TICK), "a busy computer at the edge");
        assert!(woke(t, t + TICK + SLACK + Duration::from_secs(1), TICK));
        assert!(woke(t, t + Duration::from_secs(8 * 3600), TICK), "a night's sleep");
        assert!(!woke(t, t - Duration::from_secs(3600), TICK), "a clock set back is no wake");
    }
}
