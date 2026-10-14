//! USAGE-011: Kolux's own activity counts for the Stats & Usage page: agents started, time agents
//! spent working and pull requests created, with the date counting began. They are worked out from
//! the hook-fed pane states (`status.rs`), kept on this computer under one store key, saved in
//! batches and once more at quit.
//!
//! PROJ-051 (second half of this file): when each workspace last saw activity, for the Recent sort. A project is stamped
//! when it is added and a workspace when it is made, so a newcomer starts at the top; the sidebar
//! stamps a workspace when it is shown and when its agent's state changes. Kept in the store.
// ponytail: the map keeps every folder ever stamped; prune it if it grows past a few thousand.

use crate::state::Store;
use std::collections::{BTreeMap, HashMap};
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

/// VIEW-013: how far back the Floor timeline reaches; "today" never needs more than a day.
pub const TIMELINE_MS: u64 = 26 * 3_600_000;
/// The state changes one pane keeps for the timeline.
const TIMELINE_MARKS: usize = 500;

/// VIEW-013: one change of a pane's state, as the Floor timeline draws it.
#[derive(Clone, Debug, PartialEq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Mark {
    pub at: u64,
    pub state: String,
}

/// One pane's lane on the Floor: its state changes, oldest first, and when it closed.
#[derive(Clone, Debug, Default, PartialEq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Track {
    pub pane: u32,
    pub marks: Vec<Mark>,
    pub ended: Option<u64>,
    /// T-260-c FIX-1: the terminal whose exit ended the lane; only its late states are dropped.
    #[serde(skip)]
    pub ended_terminal: Option<u32>,
    /// The terminal the pane runs in and whether that terminal is still open (filled by the command).
    pub terminal: Option<u32>,
    pub live: bool,
}

#[derive(Default)]
pub struct Activity {
    counts: Counts,
    open: HashMap<u32, Open>,
    /// VIEW-013: each pane's recent state changes, kept in memory only.
    tracks: BTreeMap<u32, Track>,
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
    /// `terminal` is the terminal the state came from, when known. T-260-c FIX-1: a state from the
    /// terminal that ended the pane's lane (a hook still in flight), or from an unknown terminal
    /// after the end, changes nothing at all: no mark, no turn, no working stretch.
    pub fn note(&mut self, pane: u32, terminal: Option<u32>, state: &str, now: u64) {
        if !self.mark(pane, terminal, state, now) {
            return;
        }
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

    /// VIEW-013: a state change on the pane's timeline; a repeat of the current state adds nothing.
    /// Marks older than the reach go, except the last of them, which says what the pane was doing
    /// when the reach begins.
    /// False when the state is dropped: the lane ended and the state comes from the terminal that
    /// ended it or from an unknown one. A state from another terminal (TERM-111 Restart, or Enter
    /// after exit, on the same pane key) reopens the lane.
    fn mark(&mut self, pane: u32, terminal: Option<u32>, state: &str, now: u64) -> bool {
        self.trim(now);
        let t = self.tracks.entry(pane).or_insert_with(|| Track { pane, ..Track::default() });
        if t.ended.is_some() {
            if terminal.is_none() || terminal == t.ended_terminal {
                return false;
            }
            t.ended = None;
            t.ended_terminal = None;
        }
        if t.marks.last().is_some_and(|m| m.state == state) {
            return true;
        }
        t.marks.push(Mark { at: now, state: state.to_string() });
        let cut = now.saturating_sub(TIMELINE_MS);
        let old = t.marks.iter().take_while(|m| m.at < cut).count();
        let drop = old.saturating_sub(1).max(t.marks.len().saturating_sub(TIMELINE_MARKS));
        t.marks.drain(..drop);
        true
    }

    /// VIEW-013: every pane's lane as of `now`; a pane that closed before the reach is left out.
    pub fn timeline(&mut self, now: u64) -> Vec<Track> {
        self.trim(now);
        self.tracks.values().cloned().collect()
    }

    /// T-260-c: a lane that closed before the reach goes as marks and ends are written, so lanes
    /// do not pile up while the Floor is never opened.
    fn trim(&mut self, now: u64) {
        let cut = now.saturating_sub(TIMELINE_MS);
        self.tracks.retain(|_, t| t.ended.is_none_or(|e| e >= cut));
    }

    /// Kolux made a pull request.
    pub fn pr_created(&mut self) {
        self.counts.prs_created += 1;
        self.dirty = true;
    }

    /// The pane closed with its terminal: any turn it had open ends now. The trim of old closed
    /// lanes runs in the mark the closing "done" goes through.
    pub fn end(&mut self, pane: u32, terminal: Option<u32>, now: u64) {
        self.note(pane, terminal, "done", now);
        self.open.remove(&pane);
        if let Some(t) = self.tracks.get_mut(&pane) {
            if t.ended.is_none() {
                // a second close keeps the first time and terminal
                t.ended = Some(now);
                t.ended_terminal = terminal;
            }
        }
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
                self.end(pane, None, now); // the app is quitting: no terminal outlives it
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

/// A pane state from `terminal` (the terminal the pane's hooks last reported for, when known).
// Called from status.rs once evidence/automations-FIX-1-status.patch lands (hooks lane owns status.rs).
pub fn note_from(pane: u32, terminal: Option<u32>, state: &str) {
    with(|a| a.note(pane, terminal, state, now_ms()));
}

/// The call shape status.rs uses until that patch lands: the terminal is unknown, so a state that
/// arrives after the pane's lane ended is dropped and a Restart on the same key does not reopen it
/// yet. Remove this once no caller is left.
#[allow(dead_code)]
pub fn note(pane: u32, state: &str) {
    note_from(pane, None, state);
}

/// The terminal ended: the panes its hooks reported for end their turns.
pub fn terminal_ended(terminal: u32) {
    let panes = crate::status::panes_of(terminal);
    with(|a| panes.into_iter().for_each(|p| a.end(p, Some(terminal), now_ms())));
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

// ---- PROJ-051: workspace activity times for the Recent sort ----

const WORKSPACE_KEY: &str = "workspaceActivity";

/// The same key the sidebar's `pathKey` makes: forward slashes, no trailing slash, lower case.
pub fn key(path: &str) -> String {
    path.replace('\\', "/").trim_end_matches('/').to_lowercase()
}

pub fn workspace_times(store: &Store) -> BTreeMap<String, u64> {
    store.get(WORKSPACE_KEY).ok().flatten().and_then(|s| serde_json::from_str(&s).ok()).unwrap_or_default()
}

pub fn touch(store: &Store, path: &str) -> Result<(), String> {
    let now = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0);
    let mut map = workspace_times(store);
    let at = map.entry(key(path)).or_insert(0);
    *at = (*at + 1).max(now); // two stamps in one millisecond still order
    store.set(WORKSPACE_KEY, &serde_json::to_string(&map).map_err(|e| e.to_string())?).map_err(|e| e.to_string())
}

type StoreState<'a> = tauri::State<'a, Mutex<Store>>;

#[tauri::command]
pub fn activity_get(store: StoreState<'_>) -> Result<BTreeMap<String, u64>, String> {
    Ok(workspace_times(&*store.lock().map_err(|e| e.to_string())?))
}

/// VIEW-013: the Floor timeline's lanes. A lane whose terminal is no longer open is not live: the
/// page shows its quiet stretches as unverifiable rather than idle.
#[tauri::command]
pub fn activity_timeline(terminals: tauri::State<'_, crate::terminal::Terminals>) -> Vec<Track> {
    let mut lanes = with(|a| a.timeline(now_ms()));
    for l in &mut lanes {
        l.terminal = crate::status::terminal_of(l.pane);
        l.live = l.ended.is_none() && l.terminal.is_some_and(|t| terminals.started(t).is_some());
    }
    lanes
}

#[tauri::command]
pub fn activity_touch(store: StoreState<'_>, path: String) -> Result<(), String> {
    touch(&*store.lock().map_err(|e| e.to_string())?, &path)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn view013_each_pane_keeps_its_state_changes_for_the_floor_and_old_ones_go() {
        let mut a = Activity::load(None, 1);
        let h = 3_600_000;
        a.note(3, Some(3), "working", 10 * h);
        a.note(3, Some(3), "working", 10 * h + 5); // a restated state adds nothing
        a.note(3, Some(3), "permission", 11 * h);
        a.note(3, Some(3), "working", 11 * h + 300_000); // blocked on approval for 5 minutes
        a.note(4, Some(4), "waiting", 12 * h);
        a.end(4, Some(4), 13 * h);
        let lanes = a.timeline(13 * h);
        let marks: Vec<(u64, &str)> = lanes[0].marks.iter().map(|m| (m.at, m.state.as_str())).collect();
        assert_eq!(marks, vec![(10 * h, "working"), (11 * h, "permission"), (11 * h + 300_000, "working")]);
        assert_eq!((lanes[1].pane, lanes[1].ended), (4, Some(13 * h)));
        // A day later (the reach starts at 11:00:00.001): pane 3's older changes go but the last one
        // before the reach stays (it says what the pane was
        // doing when the reach begins); pane 4 closed before the reach and leaves the Floor.
        a.note(3, Some(3), "done", 37 * h + 1);
        let lanes = a.timeline(40 * h);
        assert_eq!(lanes.len(), 1);
        let marks: Vec<(u64, &str)> = lanes[0].marks.iter().map(|m| (m.at, m.state.as_str())).collect();
        assert_eq!(marks, vec![(11 * h, "permission"), (11 * h + 300_000, "working"), (37 * h + 1, "done")]);
        // T-260-c: a state reported after the pane closed never reopens its lane.
        a.end(3, Some(3), 40 * h);
        a.note(3, Some(3), "working", 40 * h + 1);
        assert_eq!(a.timeline(40 * h + 2)[0].ended, Some(40 * h));
    }

    #[test]
    fn t260c_ended_lanes_go_as_they_are_written_and_a_late_state_changes_nothing() {
        let mut a = Activity::load(None, 1);
        let h = 3_600_000;
        a.note(1, Some(1), "working", h);
        a.end(1, Some(1), 2 * h);
        // A hook still in flight after the pane closed: no mark, no reopened lane.
        a.note(1, Some(1), "working", 2 * h + 50);
        a.note(1, Some(1), "done", 2 * h + 60);
        assert_eq!(a.tracks[&1].ended, Some(2 * h));
        assert_eq!(a.tracks[&1].marks.last().map(|m| m.state.as_str()), Some("done"));
        // Past the reach, another pane's mark drops the closed lane without the Floor ever reading.
        a.note(2, Some(2), "working", 2 * h + TIMELINE_MS + 1);
        assert!(!a.tracks.contains_key(&1));
        // Two more lanes close; a mark a day and more later drops both.
        a.note(3, Some(3), "working", 30 * h);
        a.end(2, Some(2), 60 * h);
        a.end(3, Some(3), 60 * h + 1);
        assert_eq!(a.tracks.keys().copied().collect::<Vec<_>>(), vec![2, 3]);
        a.note(5, Some(5), "working", 2 * 60 * h);
        assert_eq!(a.tracks.keys().copied().collect::<Vec<_>>(), vec![5]);
    }

    // T-260-c FIX-1 tests go through these two, so the same scenarios can be run on the old code.
    fn hook(a: &mut Activity, pane: u32, term: Option<u32>, state: &str, now: u64) {
        a.note(pane, term, state, now);
    }

    fn close(a: &mut Activity, pane: u32, term: Option<u32>, now: u64) {
        a.end(pane, term, now);
    }

    fn last(a: &Activity, pane: u32) -> Option<(u64, &str)> {
        a.tracks[&pane].marks.last().map(|m| (m.at, m.state.as_str()))
    }

    #[test]
    fn t260c_fix1_a_restart_on_the_same_key_reopens_the_lane_and_the_ended_terminal_changes_nothing() {
        let mut a = Activity::load(None, 1);
        let h = 3_600_000;
        hook(&mut a, 7, Some(3), "working", h);
        close(&mut a, 7, Some(3), 2 * h);
        // A hook still in flight from terminal 3, and a state from no known terminal: dropped.
        hook(&mut a, 7, Some(3), "working", 2 * h + 10);
        hook(&mut a, 7, None, "working", 2 * h + 20);
        assert_eq!((a.tracks[&7].ended, last(&a, 7)), (Some(2 * h), Some((2 * h, "done"))));
        // TERM-111 Restart (or Enter after exit) runs a new terminal 4 on the same pane key.
        hook(&mut a, 7, Some(4), "working", 3 * h);
        assert_eq!((a.tracks[&7].ended, last(&a, 7)), (None, Some((3 * h, "working"))));
        assert_eq!(a.timeline(3 * h + 1)[0].ended, None, "the Floor shows lane 7 open again");
        close(&mut a, 7, Some(4), 4 * h);
        assert_eq!(a.tracks[&7].ended, Some(4 * h));
    }

    #[test]
    fn t260c_fix1_a_late_state_from_the_ended_terminal_leaves_the_counts_alone() {
        let mut a = Activity::load(None, 1);
        hook(&mut a, 1, Some(3), "working", 0);
        close(&mut a, 1, Some(3), 1_000);
        let before = a.snapshot(1_000);
        assert_eq!((before.agents_started, before.working_ms), (1, 1_000));
        hook(&mut a, 1, Some(3), "working", 1_050);
        assert_eq!(a.snapshot(500_000), before, "no extra turn and no stretch left running");
        hook(&mut a, 1, Some(3), "done", 1_100);
        assert!(!a.open.contains_key(&1), "a late done leaves no open entry behind");
        assert_eq!(a.take_save(true, 900_000).map(|s| Activity::load(Some(&s), 1).counts), Some(before), "the quit save banks nothing extra");
    }

    #[test]
    fn t260c_fix1_a_second_close_keeps_the_first_time_and_adds_no_mark() {
        let mut a = Activity::load(None, 1);
        let h = 3_600_000;
        hook(&mut a, 2, Some(5), "working", h);
        close(&mut a, 2, Some(5), 2 * h);
        close(&mut a, 2, Some(5), 3 * h);
        let marks: Vec<(u64, &str)> = a.tracks[&2].marks.iter().map(|m| (m.at, m.state.as_str())).collect();
        assert_eq!((a.tracks[&2].ended, marks), (Some(2 * h), vec![(h, "working"), (2 * h, "done")]));
    }

    #[test]
    fn t260c_fix1_closing_a_pane_alone_drops_lanes_that_closed_before_the_reach() {
        let mut a = Activity::load(None, 1);
        let h = 3_600_000;
        hook(&mut a, 1, Some(1), "working", h);
        close(&mut a, 1, Some(1), 2 * h);
        hook(&mut a, 2, Some(2), "working", 2 * h);
        // The only write past the reach is pane 2's close; no other mark and no Floor read.
        close(&mut a, 2, Some(2), 2 * h + TIMELINE_MS + 1);
        assert_eq!(a.tracks.keys().copied().collect::<Vec<_>>(), vec![2]);
    }

    #[test]
    fn usage_011_two_turns_with_a_reconnect_count_two() {
        let mut a = Activity::load(None, 1);
        a.note(7, Some(7), "working", 1_000);
        a.note(7, Some(7), "working", 2_000); // the same turn restated after a reconnect
        a.note(7, Some(7), "done", 4_000);
        a.note(7, Some(7), "working", 10_000);
        a.note(7, Some(7), "working", 11_000);
        a.note(7, Some(7), "done", 13_000);
        assert_eq!((a.counts.agents_started, a.counts.working_ms), (2, 6_000));
    }

    #[test]
    fn usage_011_waiting_closes_a_stretch_without_starting_another_turn() {
        let mut a = Activity::load(None, 1);
        a.note(1, Some(1), "working", 0);
        a.note(1, Some(1), "permission", 1_000);
        a.note(1, Some(1), "waiting", 50_000); // waiting adds no working time
        a.note(1, Some(1), "working", 60_000);
        a.note(1, Some(1), "blocked", 61_000);
        a.note(1, Some(1), "working", 70_000);
        a.note(1, Some(1), "interrupted", 72_000);
        assert_eq!((a.counts.agents_started, a.counts.working_ms), (1, 4_000));
        assert_eq!(a.snapshot(99_000).working_ms, 4_000, "nothing open");
    }

    #[test]
    fn usage_011_closing_a_pane_ends_its_turn_and_open_time_shows_live() {
        let mut a = Activity::load(None, 1);
        a.note(1, Some(1), "working", 0);
        a.note(2, Some(2), "working", 0);
        assert_eq!(a.snapshot(5_000).working_ms, 10_000);
        a.end(1, Some(1), 5_000);
        a.note(1, Some(11), "working", 6_000); // a new program on the same key (its own terminal) is a new turn
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
        a.note(1, Some(1), "working", 100);
        a.counts.prs_created = 1;
        let at_quit = a.take_save(true, 400).unwrap();
        a.note(1, Some(1), "working", 500);
        assert!(a.take_save(false, 600).is_none(), "a save still pending never follows the one at quit");
        let back = Activity::load(Some(&at_quit), 9_999);
        assert_eq!(back.counts, Counts { since: 42, agents_started: 1, working_ms: 300, prs_created: 1 });
        assert!(Activity::load(Some("not json"), 7).counts.since == 7, "unreadable counts start again");
    }

    #[test]
    fn proj051_stamps_last_across_restarts_and_one_folder_has_one_key() {
        let dir = std::env::temp_dir().join(format!("kolux-rs-activity-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let s = Store::open(&dir).unwrap();
        touch(&s, "C:\\Repo\\Old\\").unwrap();
        touch(&s, "C:\\Repo\\New").unwrap();
        touch(&s, "c:/repo/old").unwrap();
        drop(s);
        let map = workspace_times(&Store::open(&dir).unwrap());
        assert_eq!(map.len(), 2, "both spellings of Old share a key: {map:?}");
        assert!(map["c:/repo/old"] > map["c:/repo/new"], "working in Old again moves it above New");
        let _ = std::fs::remove_dir_all(&dir);
    }
}
