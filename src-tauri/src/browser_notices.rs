//! after-list 719 (T-272-b): a permission or download notice raised while a tab's pane is being
//! built or rebuilt is held for it. The pane is not listening yet, so an event sent then is lost;
//! the notice waits here, newest `CAP` per tab, and the pane's `browser_pane_ready` call sends
//! the held ones in order. A tab that is not being built (no entry) sends at once, as before.

use serde_json::Value;
use std::collections::{HashMap, VecDeque};
use std::sync::{LazyLock, Mutex};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter};

/// Notices kept per tab; the oldest is dropped past it.
pub const CAP: usize = 32;
/// A pane that has not said it is up after this long is treated as up (an older front end never
/// says), so notices are never held for good.
pub const BUILD_MAX: Duration = Duration::from_secs(15);

/// One held notice: the event it was raised as, and what it carried. A `key` makes a newer notice
/// of the same event replace the older one (a download's progress), so a busy tab holds its latest state.
#[derive(Debug, Clone, PartialEq)]
pub struct Held {
    pub event: &'static str,
    pub key: Option<String>,
    pub payload: Value,
}

/// Tabs whose pane is not up yet, each with its held notices, oldest first.
#[derive(Debug, Default)]
pub struct Pending {
    building: HashMap<u32, (Instant, VecDeque<Held>)>,
}

impl Pending {
    /// The tab's page is being opened: from here its notices wait for the pane.
    pub fn opening(&mut self, id: u32, now: Instant) {
        self.building.entry(id).or_insert_with(|| (now, VecDeque::new()));
    }

    /// Holds the notice when the tab's pane is not up; otherwise answers what to send now (the
    /// notice itself, plus anything held if the pane took longer than `BUILD_MAX`).
    pub fn hold(&mut self, id: u32, held: Held, now: Instant) -> Vec<Held> {
        let Some((since, queue)) = self.building.get_mut(&id) else { return vec![held] };
        if now.saturating_duration_since(*since) > BUILD_MAX {
            let mut all: Vec<Held> = std::mem::take(queue).into();
            all.push(held);
            self.building.remove(&id);
            return all;
        }
        if let Some(key) = &held.key {
            if let Some(old) = queue.iter_mut().find(|h| h.event == held.event && h.key.as_ref() == Some(key)) {
                *old = held;
                return Vec::new();
            }
        }
        if queue.len() >= CAP {
            queue.pop_front();
        }
        queue.push_back(held);
        Vec::new()
    }

    /// The pane is up: its held notices, oldest first, and later ones send at once.
    pub fn ready(&mut self, id: u32) -> Vec<Held> {
        self.building.remove(&id).map(|(_, q)| Vec::from(q)).unwrap_or_default()
    }

    /// The tab closed: whatever it held goes with it.
    pub fn closed(&mut self, id: u32) {
        self.building.remove(&id);
    }

    #[cfg(test)]
    fn held(&self, id: u32) -> usize {
        self.building.get(&id).map_or(0, |b| b.1.len())
    }
}

static PENDING: LazyLock<Mutex<Pending>> = LazyLock::new(|| Mutex::new(Pending::default()));

fn with<R>(f: impl FnOnce(&mut Pending) -> R) -> Option<R> {
    PENDING.lock().ok().map(|mut p| f(&mut p))
}

pub fn opening(id: u32) {
    with(|p| p.opening(id, Instant::now()));
}

pub fn closed(id: u32) {
    with(|p| p.closed(id));
}

/// Raises a notice for tab `id`: held while its pane is being built, sent to the window otherwise.
pub fn send(app: &AppHandle, id: u32, event: &'static str, payload: Value, key: Option<String>) {
    for h in with(|p| p.hold(id, Held { event, key, payload }, Instant::now())).unwrap_or_default() {
        let _ = app.emit(h.event, h.payload);
    }
}

/// The pane of tab `id` is up and listening: sends what was held for it, oldest first. Answers how many.
#[tauri::command]
pub fn browser_pane_ready(app: AppHandle, id: u32) -> usize {
    let held = with(|p| p.ready(id)).unwrap_or_default();
    let n = held.len();
    for h in held {
        let _ = app.emit(h.event, h.payload);
    }
    n
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn t0() -> Instant {
        Instant::now()
    }

    fn note(text: &str) -> Held {
        Held { event: "browser-permission", key: None, payload: json!({ "id": 1, "text": text }) }
    }

    #[test]
    fn after719_a_tab_not_being_built_sends_at_once() {
        let mut p = Pending::default();
        assert_eq!(p.hold(1, note("camera"), t0()), vec![note("camera")]);
        assert_eq!(p.held(1), 0);
    }

    #[test]
    fn after719_a_notice_raised_while_the_pane_is_built_waits_and_drains_in_order() {
        let mut p = Pending::default();
        p.opening(1, t0());
        assert!(p.hold(1, note("camera"), t0()).is_empty());
        assert!(p.hold(1, note("microphone"), t0()).is_empty());
        assert_eq!(p.hold(2, note("other tab"), t0()), vec![note("other tab")], "another tab is not held");
        assert_eq!(p.ready(1), vec![note("camera"), note("microphone")]);
        assert_eq!(p.hold(1, note("later"), t0()), vec![note("later")], "after ready a notice sends at once");
        assert!(p.ready(1).is_empty(), "a second ready finds nothing");
    }

    #[test]
    fn after719_the_list_is_capped_and_the_oldest_goes() {
        let mut p = Pending::default();
        p.opening(1, t0());
        for n in 0..CAP + 5 {
            p.hold(1, note(&n.to_string()), t0());
        }
        let got = p.ready(1);
        assert_eq!(got.len(), CAP);
        assert_eq!(got.first(), Some(&note("5")));
        assert_eq!(got.last(), Some(&note(&(CAP + 4).to_string())));
    }

    #[test]
    fn after719_a_keyed_notice_replaces_its_older_self() {
        let mut p = Pending::default();
        p.opening(1, t0());
        let d = |received: u64| Held { event: "browser-download", key: Some("d7".into()), payload: json!({ "received": received }) };
        p.hold(1, d(10), t0());
        p.hold(1, note("camera"), t0());
        p.hold(1, d(99), t0());
        assert_eq!(p.held(1), 2);
        assert_eq!(p.ready(1), vec![d(99), note("camera")]);
    }

    #[test]
    fn after719_closing_the_tab_drops_what_it_held_and_a_rebuild_starts_empty() {
        let mut p = Pending::default();
        p.opening(1, t0());
        p.hold(1, note("camera"), t0());
        p.closed(1);
        assert_eq!(p.held(1), 0);
        assert!(p.ready(1).is_empty());
        p.opening(1, t0());
        assert!(p.ready(1).is_empty(), "the rebuilt tab starts with nothing held");
    }

    #[test]
    fn after719_opening_again_keeps_what_is_already_held() {
        let mut p = Pending::default();
        p.opening(1, t0());
        p.hold(1, note("camera"), t0());
        p.opening(1, t0());
        assert_eq!(p.held(1), 1);
    }

    #[test]
    fn after719_a_pane_that_never_says_it_is_up_stops_holding_after_the_limit() {
        let mut p = Pending::default();
        let start = t0();
        p.opening(1, start);
        p.hold(1, note("camera"), start);
        let late = start + BUILD_MAX + Duration::from_secs(1);
        assert_eq!(p.hold(1, note("microphone"), late), vec![note("camera"), note("microphone")]);
        assert_eq!(p.hold(1, note("after"), late), vec![note("after")], "the tab sends at once from then on");
    }
}
