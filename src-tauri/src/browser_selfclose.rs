//! Row 954 (b, c): a page that gets its own tab destroyed anyway.
//!
//! `NO_CLOSE_SCRIPT` makes a tab's own `window.close()` a no-op, but a popup, a cross-origin frame
//! or a fresh about:blank frame can still call `close` on the tab's window. The engine then raises
//! its close request and wry answers by destroying the tab's window, leaving a dead page. The
//! request cannot be vetoed from the host side (wry's handler runs first and the event has no
//! "handled" flag), only observed, so the pane is told to build the tab again at its last address.
//! A page that does it in a loop gets the tab left closed until the user presses Retry.
//!
//! Two detectors feed the same decision, and whichever sees a destroy first wins: the engine's
//! close-request event, and (WebView2 documents no handler order, so the event may never run) the
//! probe, which on a missed answer asks whether the tab's container window still exists.

#![cfg_attr(not(windows), allow(dead_code))] // the close hook is Windows-only

use serde::Serialize;
use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, AtomicIsize, Ordering};
use std::sync::{Arc, LazyLock, Mutex};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter};

/// The tab destroyed itself; the pane of that tab builds it again, or says it stays closed.
pub const EVENT: &str = "browser-selfclosed";
/// A tab rebuilt this many times inside `WINDOW` is left closed the next time.
pub const MAX_REBUILDS: usize = 2;
pub const WINDOW: Duration = Duration::from_secs(10);
/// A page closing itself slowly enough to pass `WINDOW` still gets left closed after this many
/// rebuilds inside `LONG_WINDOW` (a page that does it every 5.1 s).
pub const MAX_REBUILDS_LONG: usize = 3;
pub const LONG_WINDOW: Duration = Duration::from_secs(300);

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Verdict {
    Reopen,
    LeaveClosed,
}

/// One tab's recent self-closes. Once a tab is left closed it stays so until the user presses Retry.
#[derive(Debug, Default)]
pub struct History {
    rebuilds: Vec<Instant>,
    left_closed: bool,
    refusals: u32,
}

impl History {
    /// The user pressed Retry (or opened a fresh tab on this id): the record starts over.
    pub fn reset(&mut self) {
        *self = History::default();
    }

    /// Close requests refused (answered LeaveClosed) since the last reset.
    #[cfg(test)]
    pub fn refusals(&self) -> u32 {
        self.refusals
    }
}

#[derive(Serialize, Clone)]
pub struct Payload {
    pub id: u32,
    pub reopen: bool,
}

/// Records a close request and says what to do about it: rebuild the tab, unless it was already
/// rebuilt `MAX_REBUILDS` times within `WINDOW` or `MAX_REBUILDS_LONG` times within `LONG_WINDOW`,
/// or was left closed before (only `reset` reopens it).
pub fn on_self_close(h: &mut History, now: Instant) -> Verdict {
    h.rebuilds.retain(|t| now.saturating_duration_since(*t) < LONG_WINDOW);
    let recent = h.rebuilds.iter().filter(|t| now.saturating_duration_since(**t) < WINDOW).count();
    if h.left_closed || recent >= MAX_REBUILDS || h.rebuilds.len() >= MAX_REBUILDS_LONG {
        h.left_closed = true;
        h.refusals += 1;
        return Verdict::LeaveClosed;
    }
    h.rebuilds.push(now);
    Verdict::Reopen
}

/// Why `browser_open` is called: a fresh tab, or a rebuild of a tab that had a page already.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Rebuild {
    Fresh,
    /// The pane rebuilt it on its own (a self-close, a dead page process).
    Auto,
    /// The user pressed Retry on the overlay.
    Retry,
    /// The pane came back from the saved layout (row 977): it reads its own saved profile row, and
    /// is no loop-guard rebuild: it never counts toward the self-close cap and never clears the record.
    Restore,
}

impl Rebuild {
    pub fn from_arg(arg: Option<&str>) -> Rebuild {
        match arg {
            Some("auto") => Rebuild::Auto,
            Some("retry") => Rebuild::Retry,
            Some("restore") => Rebuild::Restore,
            None => Rebuild::Fresh,
            // Fail closed: an unknown word is still a rebuild (keeps the profile, never takes focus, keeps the loop record).
            Some(_) => Rebuild::Auto,
        }
    }
    /// A rebuild keeps the tab's saved profile (row 954 c, H1). A restore reads the row itself, see `restores`.
    pub fn keeps_profile(self) -> bool {
        matches!(self, Rebuild::Auto | Rebuild::Retry)
    }
    /// A restore opens in the profile its own saved row names, or the default with a notice (row 977).
    pub fn restores(self) -> bool {
        self == Rebuild::Restore
    }
}

/// Whether opening a tab hands the keyboard back to the app's view. A rebuild or a restore never
/// does, and neither does a tab opened hidden (`shown` false, row 978): focus goes only to a tab
/// the user can see and just opened.
pub fn focuses_after_open(rebuild: Rebuild, shown: Option<bool>) -> bool {
    rebuild == Rebuild::Fresh && shown != Some(false)
}

/// What a probe that got no answer means, given whether the tab's container window still exists
/// (`None`: not known).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Miss {
    /// The container is gone: the tab was destroyed, treat as a self-close.
    SelfClose,
    /// The window is there (or unknown): the page died, the existing crash path decides.
    Crash,
}

pub fn missed_probe(container_alive: Option<bool>) -> Miss {
    match container_alive {
        Some(false) => Miss::SelfClose,
        _ => Miss::Crash,
    }
}

/// One built engine of a tab. A rebuilt tab gets a new one, so what happened to the old engine
/// (its destroy, the failures that follow it) never touches the new one.
#[derive(Debug, Default)]
pub struct Engine {
    destroyed: AtomicBool,
    container: AtomicIsize,
}

impl Engine {
    /// Marks this engine destroyed; true only for the first caller (the dedupe between detectors).
    pub fn mark_destroyed(&self) -> bool {
        !self.destroyed.swap(true, Ordering::SeqCst)
    }
    pub fn destroyed(&self) -> bool {
        self.destroyed.load(Ordering::SeqCst)
    }
    pub fn set_container(&self, hwnd: isize) {
        self.container.store(hwnd, Ordering::SeqCst);
    }
    pub fn container(&self) -> Option<isize> {
        Some(self.container.load(Ordering::SeqCst)).filter(|h| *h != 0)
    }
}

static HISTORIES: LazyLock<Mutex<HashMap<u32, History>>> = LazyLock::new(Mutex::default);
static ENGINES: LazyLock<Mutex<HashMap<u32, Arc<Engine>>>> = LazyLock::new(Mutex::default);

/// A page is being built for tab `id`: a new engine record becomes the tab's current one, and
/// the tab's history starts over unless this is the pane's own rebuild.
pub fn register(id: u32, rebuild: Rebuild) -> Arc<Engine> {
    // Only the pane's own automatic rebuild (and a restore, which no page can ask for) keeps the record; Retry and a fresh tab start over.
    if let Ok(mut all) = HISTORIES.lock() {
        match (rebuild, all.get_mut(&id)) {
            (Rebuild::Auto | Rebuild::Restore, _) => {}
            (_, Some(h)) => h.reset(),
            _ => {}
        }
    }
    let e = Arc::new(Engine::default());
    if let Ok(mut all) = ENGINES.lock() {
        all.insert(id, e.clone());
    }
    e
}

/// The tab's current engine record.
pub fn current(id: u32) -> Option<Arc<Engine>> {
    ENGINES.lock().ok()?.get(&id).cloned()
}

/// The tab was closed on purpose: whatever its engine raises from here on is not a self-close.
pub fn closed(id: u32) {
    if let Some(e) = current(id) {
        e.mark_destroyed();
    }
}

/// `engine` of tab `id` saw its window destroyed (by either detector): decide and tell the pane.
/// Ignored when this engine was already handled, or is no longer the tab's current one.
pub fn destroyed(app: &AppHandle, id: u32, engine: &Arc<Engine>) {
    if !engine.mark_destroyed() || !current(id).is_some_and(|c| Arc::ptr_eq(&c, engine)) {
        return;
    }
    let verdict = match HISTORIES.lock() {
        Ok(mut all) => on_self_close(all.entry(id).or_default(), Instant::now()),
        Err(_) => Verdict::LeaveClosed,
    };
    let _ = app.emit_to("main", EVENT, Payload { id, reopen: verdict == Verdict::Reopen });
}

/// The probe of tab `id` got no answer: if the tab's container window is gone, that is a destroy.
pub fn probe_missed(app: &AppHandle, id: u32, container_alive: impl Fn(isize) -> bool) {
    let Some(e) = current(id) else { return };
    if missed_probe(e.container().map(container_alive)) == Miss::SelfClose {
        destroyed(app, id, &e);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn at(s: u64) -> Instant {
        // A fixed origin far enough from the clock's zero that earlier instants exist.
        static BASE: LazyLock<Instant> = LazyLock::new(Instant::now);
        *BASE + Duration::from_secs(s)
    }

    fn at_ms(ms: u64) -> Instant {
        at(0) + Duration::from_millis(ms)
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
        // The ruling's 0 / 5 / 11 s: the rebuild at 0 is 11 s old by the third request, so it reopens.
        let mut h = History::default();
        assert_eq!(on_self_close(&mut h, at(0)), Verdict::Reopen);
        assert_eq!(on_self_close(&mut h, at(5)), Verdict::Reopen);
        assert_eq!(on_self_close(&mut h, at(11)), Verdict::Reopen);
    }

    #[test]
    fn row_954c_a_tab_left_closed_stays_closed_until_retry() {
        let mut h = History::default();
        on_self_close(&mut h, at(0));
        on_self_close(&mut h, at(1));
        assert_eq!(on_self_close(&mut h, at(2)), Verdict::LeaveClosed);
        assert_eq!(on_self_close(&mut h, at(20)), Verdict::LeaveClosed, "time alone does not reopen it");
        assert_eq!(on_self_close(&mut h, at(4000)), Verdict::LeaveClosed);
        assert_eq!(h.refusals(), 3, "every refusal is recorded");
    }

    #[test]
    fn row_954c_retry_starts_the_record_over() {
        let mut h = History::default();
        on_self_close(&mut h, at(0));
        on_self_close(&mut h, at(1));
        assert_eq!(on_self_close(&mut h, at(2)), Verdict::LeaveClosed);
        h.reset();
        assert_eq!(h.refusals(), 0);
        assert_eq!(on_self_close(&mut h, at(3)), Verdict::Reopen);
        assert_eq!(on_self_close(&mut h, at(4)), Verdict::Reopen);
        assert_eq!(on_self_close(&mut h, at(5)), Verdict::LeaveClosed);
    }

    #[test]
    fn row_954c_a_page_closing_every_5_1_seconds_is_left_closed_within_a_minute() {
        let mut h = History::default();
        let mut closed_at = None;
        for n in 0..12u64 {
            if on_self_close(&mut h, at_ms(n * 5100)) == Verdict::LeaveClosed {
                closed_at = Some(n * 5100);
                break;
            }
        }
        let t = closed_at.expect("a 5.1 s cadence must reach LeaveClosed");
        assert!(t <= 60_000, "left closed at {t} ms");
        assert_eq!(t, 3 * 5100, "the third rebuild inside five minutes is the last");
        assert_eq!(on_self_close(&mut h, at_ms(60_000)), Verdict::LeaveClosed);
    }

    #[test]
    fn row_954c_rebuilds_older_than_five_minutes_do_not_count_toward_the_long_limit() {
        let mut h = History::default();
        for t in [0, 100, 200] {
            assert_eq!(on_self_close(&mut h, at(t)), Verdict::Reopen);
        }
        assert_eq!(on_self_close(&mut h, at(301)), Verdict::Reopen, "the rebuild at 0 is over five minutes old");
        assert_eq!(on_self_close(&mut h, at(302)), Verdict::LeaveClosed, "100, 200 and 301 are three inside five minutes");
    }

    #[test]
    fn row_954c_only_the_users_retry_or_a_fresh_tab_resets_the_record() {
        assert_eq!(Rebuild::from_arg(None), Rebuild::Fresh);
        assert_eq!(Rebuild::from_arg(Some("auto")), Rebuild::Auto);
        assert_eq!(Rebuild::from_arg(Some("retry")), Rebuild::Retry);
        assert!(Rebuild::Auto.keeps_profile() && Rebuild::Retry.keeps_profile() && !Rebuild::Fresh.keeps_profile());
    }

    #[test]
    fn row_954c_register_resets_for_fresh_and_retry_but_not_for_an_automatic_rebuild() {
        let id = 9_001;
        HISTORIES.lock().unwrap().insert(id, {
            let mut h = History::default();
            for s in 0..3 {
                on_self_close(&mut h, at(s));
            }
            h
        });
        register(id, Rebuild::Auto);
        assert_eq!(HISTORIES.lock().unwrap()[&id].refusals(), 1, "an automatic rebuild keeps the record");
        register(id, Rebuild::Retry);
        assert!(HISTORIES.lock().unwrap().get(&id).is_none_or(|h| h.refusals() == 0), "Retry clears it");
        let id = 9_002;
        HISTORIES.lock().unwrap().insert(id, {
            let mut h = History::default();
            for s in 0..3 {
                on_self_close(&mut h, at(s));
            }
            h
        });
        register(id, Rebuild::Fresh);
        assert!(HISTORIES.lock().unwrap().get(&id).is_none_or(|h| h.refusals() == 0), "a fresh tab on a reused id starts clean");
    }

    #[test]
    fn row_954d_an_unknown_rebuild_word_is_an_automatic_rebuild_not_a_fresh_open() {
        assert_eq!(Rebuild::from_arg(None), Rebuild::Fresh);
        assert_eq!(Rebuild::from_arg(Some("auto")), Rebuild::Auto);
        assert_eq!(Rebuild::from_arg(Some("retry")), Rebuild::Retry);
        assert_eq!(Rebuild::from_arg(Some("")), Rebuild::Auto);
        assert_eq!(Rebuild::from_arg(Some("fresh")), Rebuild::Auto);
        assert_eq!(Rebuild::from_arg(Some("RETRY")), Rebuild::Auto);
    }

    #[test]
    fn row_954c_a_rebuild_never_takes_the_keyboard_and_a_users_open_does() {
        assert!(focuses_after_open(Rebuild::Fresh, Some(true)));
        assert!(!focuses_after_open(Rebuild::Auto, Some(true)), "a hidden or shown rebuild must not focus");
        assert!(!focuses_after_open(Rebuild::Retry, Some(true)));
    }

    #[test]
    fn row_978_a_tab_opened_hidden_and_a_restore_never_take_the_keyboard() {
        assert!(focuses_after_open(Rebuild::Fresh, None), "no word on shown means a tab the user sees");
        assert!(!focuses_after_open(Rebuild::Fresh, Some(false)), "a tab opened behind the user keeps focus where it was");
        for kind in [Rebuild::Fresh, Rebuild::Auto, Rebuild::Retry, Rebuild::Restore] {
            assert!(!focuses_after_open(kind, Some(false)), "{kind:?} hidden");
        }
        assert!(!focuses_after_open(Rebuild::Restore, Some(true)), "a restored tab is not one the user just clicked");
        assert!(!focuses_after_open(Rebuild::Restore, None));
    }

    #[test]
    fn row_977_restore_is_its_own_word_and_not_a_loop_guard_rebuild() {
        assert_eq!(Rebuild::from_arg(Some("restore")), Rebuild::Restore);
        assert!(Rebuild::Restore.restores());
        assert!(!Rebuild::Auto.restores() && !Rebuild::Retry.restores() && !Rebuild::Fresh.restores());
        assert!(!Rebuild::Restore.keeps_profile(), "restore reads the row itself, it is not a rebuild");
    }

    #[test]
    fn row_977_a_restore_neither_counts_toward_the_cap_nor_clears_the_loop_record() {
        let id = 9_003;
        HISTORIES.lock().unwrap().insert(id, {
            let mut h = History::default();
            for s in 0..3 {
                on_self_close(&mut h, at(s));
            }
            h
        });
        register(id, Rebuild::Restore);
        assert_eq!(HISTORIES.lock().unwrap()[&id].refusals(), 1, "a restore keeps a left-closed tab's record: a page cannot clear it by asking");
    }

    #[test]
    fn row_954c_a_missed_probe_with_the_container_gone_is_a_self_close() {
        assert_eq!(missed_probe(Some(false)), Miss::SelfClose);
        assert_eq!(missed_probe(Some(true)), Miss::Crash, "a live container is the existing crash path");
        assert_eq!(missed_probe(None), Miss::Crash, "no recorded container is the existing crash path");
    }

    #[test]
    fn row_954c_the_second_detector_for_the_same_destroy_is_ignored() {
        let e = Engine::default();
        assert!(e.mark_destroyed(), "the first detector wins");
        assert!(!e.mark_destroyed(), "the second is ignored");
        assert!(e.destroyed());
    }

    #[test]
    fn row_954c_a_destroyed_engine_does_not_mark_the_rebuilt_one() {
        let id = 9_003;
        let a = register(id, Rebuild::Fresh);
        assert!(a.mark_destroyed());
        let b = register(id, Rebuild::Auto);
        assert!(a.destroyed(), "the old engine stays marked, so its late ProcessFailed stays hidden");
        assert!(!b.destroyed(), "a failure in the rebuilt tab is always reported");
        assert!(Arc::ptr_eq(&current(id).unwrap(), &b));
        closed(id);
        assert!(b.destroyed(), "a deliberate close silences the engine it closed");
    }

    #[test]
    fn row_954c_the_engine_remembers_its_own_container() {
        let e = Engine::default();
        assert_eq!(e.container(), None);
        e.set_container(0x1234);
        assert_eq!(e.container(), Some(0x1234));
    }
}
