//! ONB-001..005: the first-run wizard's record in the store, so the wizard opens for a brand-new
//! profile, comes back on the screen it reached and never returns once closed. The close latch,
//! the retry toast and the older wizards' progress (ONB-007 rest, ONB-008) are T-208.

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
    pub version: u32,
    /// The last screen finished, 0..=3; -1 when none.
    pub step: i32,
    /// Milliseconds since 1970 when the wizard closed; none while it is open.
    #[serde(default)]
    pub closed_at: Option<u64>,
    /// "completed" or "dismissed" once closed.
    #[serde(default)]
    pub outcome: Option<String>,
}

fn load(store: &Store) -> Option<Onboarding> {
    store.get(KEY).ok().flatten().and_then(|s| serde_json::from_str(&s).ok())
}

fn save(store: &Store, rec: &Onboarding) -> Result<(), String> {
    store.set(KEY, &serde_json::to_string(rec).map_err(|e| e.to_string())?).map_err(|e| e.to_string())
}

/// ONB-001: the profile's first start opens a record; a profile with none counts as done (ONB-008).
pub fn first_start(store: &Store, starts: u64) -> Result<(), String> {
    if starts == 1 && load(store).is_none() {
        save(store, &Onboarding { version: VERSION, step: -1, closed_at: None, outcome: None })?;
    }
    Ok(())
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
        assert_eq!(load(&s), Some(Onboarding { version: VERSION, step: -1, closed_at: None, outcome: None }));
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
        let open = Onboarding { version: VERSION, step: -1, closed_at: None, outcome: None };
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
}
