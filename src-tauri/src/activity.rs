//! USAGE-011: Kolux's own activity counts for the Stats & Usage page: agents started, time agents
//! spent working and pull requests created, with the date counting began. They are worked out from
//! the hook-fed pane states (`status.rs`), kept on this computer under one store key, saved in
//! batches and once more at quit.

use crate::state::Store;
use std::collections::HashMap;
use std::sync::Mutex;

pub const KEY: &str = "activityCounts";

#[derive(Clone, Debug, Default, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Counts {
    /// When counting began, in milliseconds.
    pub since: u64,
    /// Agent turns started: one per stretch from a prompt to the turn's end.
    pub agents_started: u64,
    pub working_ms: u64,
    /// Pull requests Kolux made (Source Control's Create pull request); linking one is not counted.
    pub prs_created: u64,
}

/// One pane's open turn and the start of its current working stretch.
#[derive(Default)]
struct Open {
    turn: bool,
    since: Option<u64>,
}

#[derive(Default)]
pub struct Activity {
    counts: Counts,
    open: HashMap<u32, Open>,
    dirty: bool,
    /// The save at quit went out; nothing still pending may follow it.
    closed: bool,
}

impl Activity {
    /// The counts saved last run, or a fresh start dated `now` (to be saved).
    pub fn load(saved: Option<&str>, now: u64) -> Activity {
        match saved.and_then(|t| serde_json::from_str::<Counts>(t).ok()).filter(|c| c.since > 0) {
            Some(counts) => Activity { counts, ..Activity::default() },
            None => Activity { counts: Counts { since: now, ..Counts::default() }, dirty: true, ..Activity::default() },
        }
    }

    /// A pane's resolved state changed. Working opens a turn once (a repeated working state, as
    /// after a reconnect, starts nothing); waiting, permission and blocked close the working stretch
    /// but keep the turn; done and interrupted end it.
    pub fn note(&mut self, pane: u32, state: &str, now: u64) {
        let o = self.open.entry(pane).or_default();
        if state == "working" {
            if !o.turn {
                o.turn = true;
                self.counts.agents_started += 1;
                self.dirty = true;
            }
            o.since.get_or_insert(now);
            return;
        }
        if let Some(start) = o.since.take() {
            self.counts.working_ms += now.saturating_sub(start);
            self.dirty = true;
        }
        if matches!(state, "done" | "interrupted") {
            o.turn = false;
        }
    }

    /// Kolux made a pull request.
    pub fn pr_created(&mut self) {
        self.counts.prs_created += 1;
        self.dirty = true;
    }

    /// The pane closed: any turn it had open ends now.
    pub fn end(&mut self, pane: u32, now: u64) {
        self.note(pane, "done", now);
        self.open.remove(&pane);
    }

    /// The counts as of `now`, open working stretches included.
    pub fn snapshot(&self, now: u64) -> Counts {
        let live: u64 = self.open.values().filter_map(|o| o.since).map(|s| now.saturating_sub(s)).sum();
        Counts { working_ms: self.counts.working_ms + live, ..self.counts.clone() }
    }

    /// What to write now, if anything. A batched save writes only changed counts and never after
    /// the save at quit; the save at quit closes every open turn first and always writes.
    pub fn take_save(&mut self, at_quit: bool, now: u64) -> Option<String> {
        if self.closed {
            return None;
        }
        if at_quit {
            let panes: Vec<u32> = self.open.keys().copied().collect();
            for pane in panes {
                self.end(pane, now);
            }
            self.closed = true;
        } else if !self.dirty {
            return None;
        }
        self.dirty = false;
        serde_json::to_string(&self.counts).ok()
    }
}

static ACTIVITY: Mutex<Option<Activity>> = Mutex::new(None);

fn with<T>(f: impl FnOnce(&mut Activity) -> T) -> T {
    let mut guard = ACTIVITY.lock().unwrap_or_else(|p| p.into_inner());
    f(guard.get_or_insert_with(Activity::default))
}

fn now_ms() -> u64 {
    crate::artifacts::now_ms()
}

/// Reads last run's counts; called once at start, before any pane reports.
pub fn start(store: &Store) {
    let saved = store.get(KEY).ok().flatten();
    with(|a| *a = Activity::load(saved.as_deref(), now_ms()));
}

pub fn note(pane: u32, state: &str) {
    with(|a| a.note(pane, state, now_ms()));
}

/// The terminal ended: the panes its hooks reported for end their turns.
pub fn terminal_ended(terminal: u32) {
    let panes = crate::status::panes_of(terminal);
    with(|a| panes.into_iter().for_each(|p| a.end(p, now_ms())));
}

/// Writes the counts when they changed (every few seconds) or at quit.
pub fn save(store: &Mutex<Store>, at_quit: bool) {
    // the lock is held through the write, so a batched save in flight finishes before the one at quit
    let mut guard = ACTIVITY.lock().unwrap_or_else(|p| p.into_inner());
    let Some(text) = guard.get_or_insert_with(Activity::default).take_save(at_quit, now_ms()) else { return };
    if let Ok(s) = store.lock() {
        let _ = s.set(KEY, &text);
    }
}

/// Kolux made a pull request (scm.rs pr_create).
pub fn pr_created() {
    with(|a| a.pr_created());
}

#[tauri::command]
pub fn activity_counts() -> Counts {
    with(|a| a.snapshot(now_ms()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn usage_011_two_turns_with_a_reconnect_count_two() {
        let mut a = Activity::load(None, 1);
        a.note(7, "working", 1_000);
        a.note(7, "working", 2_000); // the same turn restated after a reconnect
        a.note(7, "done", 4_000);
        a.note(7, "working", 10_000);
        a.note(7, "working", 11_000);
        a.note(7, "done", 13_000);
        assert_eq!((a.counts.agents_started, a.counts.working_ms), (2, 6_000));
    }

    #[test]
    fn usage_011_waiting_closes_a_stretch_without_starting_another_turn() {
        let mut a = Activity::load(None, 1);
        a.note(1, "working", 0);
        a.note(1, "permission", 1_000);
        a.note(1, "waiting", 50_000); // waiting adds no working time
        a.note(1, "working", 60_000);
        a.note(1, "blocked", 61_000);
        a.note(1, "working", 70_000);
        a.note(1, "interrupted", 72_000);
        assert_eq!((a.counts.agents_started, a.counts.working_ms), (1, 4_000));
        assert_eq!(a.snapshot(99_000).working_ms, 4_000, "nothing open");
    }

    #[test]
    fn usage_011_closing_a_pane_ends_its_turn_and_open_time_shows_live() {
        let mut a = Activity::load(None, 1);
        a.note(1, "working", 0);
        a.note(2, "working", 0);
        assert_eq!(a.snapshot(5_000).working_ms, 10_000);
        a.end(1, 5_000);
        a.note(1, "working", 6_000); // a new pane on the same key is a new turn
        assert_eq!(a.counts.agents_started, 3);
    }

    #[test]
    fn usage_011_a_pull_request_kolux_creates_is_counted_and_saved() {
        let mut a = Activity::load(Some(r#"{"since":5,"agentsStarted":2,"workingMs":9,"prsCreated":3}"#), 7);
        assert!(a.take_save(false, 8).is_none());
        a.pr_created();
        assert_eq!(a.snapshot(9).prs_created, 4);
        let saved = a.take_save(false, 10).expect("a new pull request is saved with the next batch");
        assert_eq!(Activity::load(Some(&saved), 11).counts.prs_created, 4);
    }

    #[test]
    fn usage_011_counts_survive_a_restart_and_the_quit_save_is_last() {
        let mut a = Activity::load(None, 42);
        assert!(a.take_save(false, 42).is_some(), "a fresh start is saved with its date");
        assert!(a.take_save(false, 43).is_none(), "nothing changed, nothing written");
        a.note(1, "working", 100);
        a.counts.prs_created = 1;
        let at_quit = a.take_save(true, 400).unwrap();
        a.note(1, "working", 500);
        assert!(a.take_save(false, 600).is_none(), "a save still pending never follows the one at quit");
        let back = Activity::load(Some(&at_quit), 9_999);
        assert_eq!(back.counts, Counts { since: 42, agents_started: 1, working_ms: 300, prs_created: 1 });
        assert!(Activity::load(Some("not json"), 7).counts.since == 7, "unreadable counts start again");
    }
}
