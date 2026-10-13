//! ONB-001..005: the first-run wizard's record in the store, so the wizard opens for a brand-new
//! profile, comes back on the screen it reached and never returns once closed. ONB-008: a record
//! from an older version is raised to this one on start (T-208); the close latch and its retry
//! toast live in the window (firstRun.ts closer).

use crate::state::Store;
use serde::{Deserialize, Serialize};
use std::sync::Mutex;
use tauri::State;

const KEY: &str = "onboarding";
/// COMPAT (ONB-007): the wizard version this record belongs to.
pub const VERSION: u32 = 7;
/// The four screens are 0..=3.
const LAST: i32 = 3;

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Onboarding {
    #[serde(default)]
    pub version: u32,
    /// The last screen finished, 0..=3; -1 when none.
    #[serde(default = "none_finished")]
    pub step: i32,
    /// Milliseconds since 1970 when the wizard closed; none while it is open.
    #[serde(default)]
    pub closed_at: Option<u64>,
    /// "completed" or "dismissed" once closed.
    #[serde(default)]
    pub outcome: Option<String>,
    /// Fields kept for the checklist and milestones (ONB-011, ONB-013), carried through untouched.
    #[serde(flatten)]
    pub rest: serde_json::Map<String, serde_json::Value>,
}

fn none_finished() -> i32 {
    -1
}

fn raw(store: &Store) -> Option<Onboarding> {
    store.get(KEY).ok().flatten().and_then(|s| serde_json::from_str(&s).ok())
}

/// ONB-008: progress held within the four screens, the version raised to this one, and a close
/// time filled in when an outcome has none. Fields this version does not read are kept as they are.
fn upgraded(mut rec: Onboarding, now: u64) -> Onboarding {
    rec.version = VERSION;
    rec.step = rec.step.clamp(-1, LAST);
    if rec.outcome.is_some() && rec.closed_at.is_none() {
        rec.closed_at = Some(now);
    }
    rec
}

fn load(store: &Store) -> Option<Onboarding> {
    raw(store).map(|r| upgraded(r, now_ms()))
}

fn save(store: &Store, rec: &Onboarding) -> Result<(), String> {
    store.set(KEY, &serde_json::to_string(rec).map_err(|e| e.to_string())?).map_err(|e| e.to_string())
}

/// ONB-001: the profile's first start opens a record; a profile with none counts as done (ONB-008).
pub fn first_start(store: &Store, starts: u64) -> Result<(), String> {
    match raw(store) {
        None if starts == 1 => save(store, &Onboarding { version: VERSION, step: -1, closed_at: None, outcome: None, rest: Default::default() }),
        Some(old) if upgraded(old.clone(), 0) != old => save(store, &upgraded(old, now_ms())),
        _ => Ok(()),
    }
}

/// Moving on from `step` stores it as the last screen finished; a closed record stays as it is.
fn stepped(mut rec: Onboarding, step: i32) -> Onboarding {
    if rec.closed_at.is_none() {
        rec.step = step.clamp(-1, LAST);
    }
    rec
}

fn closed(mut rec: Onboarding, outcome: &str, now: u64) -> Result<Onboarding, String> {
    if outcome != "completed" && outcome != "dismissed" {
        return Err(format!("{outcome} is not a way the first run ends"));
    }
    if rec.closed_at.is_none() {
        rec.closed_at = Some(now);
        rec.outcome = Some(outcome.into());
        if outcome == "completed" {
            rec.step = LAST;
        }
    }
    Ok(rec)
}

/// ONB-009: Onboarding in the help menu starts the wizard over on screen one; the close, the
/// outcome and the progress go, and of the checklist only its dismissed mark (ONB-013).
fn reopened(rec: Option<Onboarding>) -> Onboarding {
    let mut rec = rec.unwrap_or(Onboarding { version: VERSION, step: -1, closed_at: None, outcome: None, rest: Default::default() });
    rec.step = -1;
    rec.closed_at = None;
    rec.outcome = None;
    rec.rest.remove("checklistDismissed");
    rec
}

/// ONB-011: the three first-success milestones, kept in the record under "milestones".
const MILESTONES: [&str; 3] = ["aiConnected", "kitLaunched", "resultsOpened"];

/// ONB-011: a milestone's time is written at its first occurrence and never again. A profile with
/// no record (one from before the wizard, ONB-008) has had its firsts already, so nothing is kept.
fn mark(store: &Store, name: &str, now: u64) -> Result<(), String> {
    if !MILESTONES.contains(&name) {
        return Err(format!("{name} is not a first-run milestone"));
    }
    let Some(mut rec) = load(store) else { return Ok(()) };
    let times = rec.rest.entry("milestones").or_insert_with(|| serde_json::json!({}));
    if !times.is_object() {
        *times = serde_json::json!({});
    }
    let times = times.as_object_mut().expect("an object");
    if times.contains_key(name) {
        return Ok(());
    }
    times.insert(name.into(), now.into());
    save(store, &rec)
}

fn now_ms() -> u64 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0)
}

/// The record when the wizard should open (none closed it yet), else nothing.
#[tauri::command]
pub fn onboarding_get(store: State<'_, Mutex<Store>>) -> Result<Option<Onboarding>, String> {
    let store = store.lock().map_err(|e| e.to_string())?;
    Ok(load(&store).filter(|r| r.closed_at.is_none()))
}

#[tauri::command]
pub fn onboarding_step(store: State<'_, Mutex<Store>>, step: i32) -> Result<(), String> {
    let store = store.lock().map_err(|e| e.to_string())?;
    match load(&store) {
        Some(rec) => save(&store, &stepped(rec, step)),
        None => Ok(()),
    }
}

#[tauri::command]
pub fn onboarding_close(store: State<'_, Mutex<Store>>, outcome: String) -> Result<(), String> {
    let store = store.lock().map_err(|e| e.to_string())?;
    match load(&store) {
        Some(rec) => save(&store, &closed(rec, &outcome, now_ms())?),
        None => Ok(()),
    }
}

#[tauri::command]
pub fn onboarding_reopen(store: State<'_, Mutex<Store>>) -> Result<(), String> {
    let store = store.lock().map_err(|e| e.to_string())?;
    save(&store, &reopened(load(&store)))
}

#[tauri::command]
pub fn onboarding_milestone(store: State<'_, Mutex<Store>>, name: String) -> Result<(), String> {
    let store = store.lock().map_err(|e| e.to_string())?;
    mark(&store, &name, now_ms())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn store(tag: &str) -> (Store, std::path::PathBuf) {
        let dir = std::env::temp_dir().join(format!("kolux-rs-onb-{tag}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        (Store::open(&dir).unwrap(), dir)
    }

    #[test]
    fn only_the_first_start_opens_the_wizard() {
        let (s, dir) = store("first");
        first_start(&s, 2).unwrap();
        assert_eq!(load(&s), None, "an older profile has no record and never sees the wizard");
        first_start(&s, 1).unwrap();
        assert_eq!(load(&s), Some(Onboarding { version: VERSION, step: -1, closed_at: None, outcome: None, rest: Default::default() }));
        save(&s, &stepped(load(&s).unwrap(), 1)).unwrap();
        first_start(&s, 1).unwrap();
        assert_eq!(load(&s).unwrap().step, 1, "an existing record is kept");
        s.set(KEY, "{ not json").unwrap();
        assert_eq!(load(&s), None);
        drop(s);
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn steps_stay_in_the_four_screens_and_a_close_is_final() {
        let open = Onboarding { version: VERSION, step: -1, closed_at: None, outcome: None, rest: Default::default() };
        assert_eq!(stepped(open.clone(), 9).step, 3);
        assert_eq!(stepped(open.clone(), 1).step, 1);
        let done = closed(stepped(open.clone(), 1), "completed", 50).unwrap();
        assert_eq!((done.step, done.closed_at, done.outcome.as_deref()), (3, Some(50), Some("completed")));
        assert_eq!(stepped(done.clone(), 0), done);
        assert_eq!(closed(done.clone(), "dismissed", 60).unwrap(), done);
        let skipped = closed(stepped(open.clone(), 1), "dismissed", 70).unwrap();
        assert_eq!((skipped.step, skipped.outcome.as_deref()), (1, Some("dismissed")));
        assert!(closed(open, "maybe", 1).unwrap_err().contains("maybe"));
    }

    #[test]
    fn an_older_record_is_brought_up_to_date_on_start() {
        let (s, dir) = store("upgrade");
        s.set(KEY, r#"{"version":5,"step":9,"outcome":"dismissed","checklist":[true]}"#).unwrap();
        first_start(&s, 4).unwrap();
        let rec = load(&s).unwrap();
        assert_eq!((rec.version, rec.step, rec.outcome.as_deref()), (VERSION, 3, Some("dismissed")));
        assert!(rec.closed_at.is_some(), "an outcome with no close time gets one");
        let raw = s.get(KEY).unwrap().unwrap();
        assert!(raw.contains(r#""version":7"#) && raw.contains(r#""checklist":[true]"#), "the raised version is stored, the rest kept: {raw}");
        s.set(KEY, r#"{"version":6}"#).unwrap();
        assert_eq!(load(&s), Some(Onboarding { version: VERSION, step: -1, closed_at: None, outcome: None, rest: Default::default() }), "missing fields read as nothing finished");
        drop(s);
        std::fs::remove_dir_all(dir).unwrap();
    }
    #[test]
    fn reopening_starts_over_and_keeps_the_rest() {
        let done = Onboarding { version: VERSION, step: 3, closed_at: Some(9), outcome: Some("completed".into()), rest: serde_json::from_str(r#"{"checklist":[true],"checklistDismissed":true,"milestones":{"aiConnected":5}}"#).unwrap() };
        let back = reopened(Some(done));
        assert_eq!((back.step, back.closed_at, back.outcome), (-1, None, None));
        assert_eq!(serde_json::Value::Object(back.rest), serde_json::json!({"checklist":[true],"milestones":{"aiConnected":5}}), "only the dismissed mark goes");
        assert_eq!(reopened(None), Onboarding { version: VERSION, step: -1, closed_at: None, outcome: None, rest: Default::default() }, "a profile with no record gets a fresh one");
    }

    #[test]
    fn a_milestone_is_written_once() {
        let dir = crate::test_dir::temp("onb-mile");
        let s = Store::open(&dir).unwrap();
        assert_eq!(mark(&s, "aiConnected", 10), Ok(()), "no record: nothing is written");
        assert_eq!(load(&s), None);
        first_start(&s, 1).unwrap();
        mark(&s, "aiConnected", 10).unwrap();
        mark(&s, "aiConnected", 20).unwrap();
        mark(&s, "kitLaunched", 30).unwrap();
        save(&s, &closed(load(&s).unwrap(), "completed", 40).unwrap()).unwrap();
        mark(&s, "resultsOpened", 50).unwrap();
        let rec = load(&s).unwrap();
        assert_eq!(rec.rest["milestones"], serde_json::json!({"aiConnected":10,"kitLaunched":30,"resultsOpened":50}), "the first time stays, a closed wizard still records");
        assert!(mark(&s, "lunch", 60).unwrap_err().contains("lunch"));
    }
}
