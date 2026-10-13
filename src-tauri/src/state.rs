//! The state store: SQLite for app state, one JSON file for user settings, both under the
//! profile folder. Everything the user sets up is saved as they go (LOOP.md stack; theme 9).
//! APP-048: writes are atomic, an unchanged value is not written again, a busy database is
//! waited on briefly, and a damaged settings file keeps its good entries. APP-050: the final save
//! at quit is a barrier (see `close` and `within`).

use rusqlite::{ffi, params, Connection};
use serde_json::{Map, Value};
use std::cell::Cell;
use std::fs;
use std::path::{Path, PathBuf};
use std::time::Duration;

/// How long quitting waits for the final save before it carries on without it (APP-050).
pub const QUIT_DEADLINE: Duration = Duration::from_secs(3);

/// SET-037's look field: a settings file that could not be read at all counts as an existing
/// install, which keeps the Classic look rather than a fresh profile's New.
const LOOK_FIELD: &str = "uiLook";

pub struct Store {
    conn: Connection,
    settings_path: PathBuf,
    /// Set by the final save at quit; nothing is written after it.
    closed: Cell<bool>,
}

impl Store {
    /// Opens (or creates) the store under `dir`. Creates the folder and the schema on first use.
    pub fn open(dir: &Path) -> rusqlite::Result<Store> {
        fs::create_dir_all(dir).map_err(|e| rusqlite::Error::InvalidPath(dir.join(e.to_string())))?;
        let conn = Connection::open(dir.join("state.db"))?;
        // Another writer (the command line, a second window) holding the database briefly is waited on.
        conn.busy_timeout(Duration::from_secs(5))?;
        conn.execute_batch(
            "PRAGMA journal_mode=WAL;
             CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value TEXT NOT NULL);",
        )?;
        Ok(Store { conn, settings_path: dir.join("settings.json"), closed: Cell::new(false) })
    }

    /// The profile folder the store lives in.
    pub fn dir(&self) -> PathBuf {
        self.settings_path.parent().map(Path::to_path_buf).unwrap_or_default()
    }

    pub fn get(&self, key: &str) -> rusqlite::Result<Option<String>> {
        self.conn
            .query_row("SELECT value FROM kv WHERE key = ?1", params![key], |r| r.get(0))
            .map(Some)
            .or_else(|e| if e == rusqlite::Error::QueryReturnedNoRows { Ok(None) } else { Err(e) })
    }

    /// Stores a value; the same value again is not written.
    pub fn set(&self, key: &str, value: &str) -> rusqlite::Result<()> {
        if self.closed.get() {
            return Err(rusqlite::Error::SqliteFailure(ffi::Error::new(ffi::SQLITE_READONLY), Some("Kolux RS is quitting".into())));
        }
        self.conn.execute(
            "INSERT INTO kv (key, value) VALUES (?1, ?2) ON CONFLICT(key) DO UPDATE SET value = excluded.value WHERE value IS NOT excluded.value",
            params![key, value],
        )?;
        Ok(())
    }

    /// The settings file as read, and whether it was damaged. Absent reads as an empty object;
    /// damaged keeps the entries that still parse.
    fn read_settings(&self) -> (Value, bool) {
        let Ok(bytes) = fs::read(&self.settings_path) else { return (serde_json::json!({}), false) };
        if let Ok(v @ Value::Object(_)) = serde_json::from_slice(&bytes) {
            return (v, false);
        }
        let mut kept = salvage(&String::from_utf8_lossy(&bytes));
        if kept.is_empty() {
            kept.insert(LOOK_FIELD.into(), "classic".into());
        }
        (Value::Object(kept), true)
    }

    /// User settings as JSON (see `read_settings`).
    pub fn settings(&self) -> Value {
        self.read_settings().0
    }

    /// APP-048: a damaged settings file is repaired at start: the damaged copy is kept beside it as
    /// settings.json.bad and the good entries are written back. Returns whether it was damaged.
    pub fn repair_settings(&self) -> std::io::Result<bool> {
        let (v, damaged) = self.read_settings();
        if damaged {
            fs::copy(&self.settings_path, self.settings_path.with_extension("json.bad"))?;
            self.save_settings(&v)?;
        }
        Ok(damaged)
    }

    /// Writes settings whole or not at all: to a temp file first, then renamed into place. The
    /// same settings again are not written.
    pub fn save_settings(&self, value: &Value) -> std::io::Result<()> {
        if self.closed.get() {
            return Err(std::io::Error::other("Kolux RS is quitting"));
        }
        if fs::read(&self.settings_path).ok().and_then(|b| serde_json::from_slice::<Value>(&b).ok()).as_ref() == Some(value) {
            return Ok(());
        }
        let tmp = self.settings_path.with_extension("json.tmp");
        fs::write(&tmp, serde_json::to_vec_pretty(value)?)?;
        fs::rename(&tmp, &self.settings_path)
    }

    /// APP-050: the final save. Called with the store locked, so a save in flight has finished;
    /// afterwards every write is refused. A leftover temporary file goes, then the database's
    /// journal is folded into it. Failures (a drive refusing writes) are ignored: quitting goes on.
    pub fn close(&self) {
        self.closed.set(true);
        let _ = fs::remove_file(self.settings_path.with_extension("json.tmp"));
        let _ = self.conn.execute_batch("PRAGMA wal_checkpoint(TRUNCATE);");
    }
}

/// Runs `work` on its own thread and waits for it at most `deadline`; true when it finished.
/// A stalled drive therefore cannot hold quitting longer than the deadline (APP-050).
pub fn within(deadline: Duration, work: impl FnOnce() + Send + 'static) -> bool {
    let (tx, rx) = std::sync::mpsc::channel();
    std::thread::spawn(move || {
        work();
        let _ = tx.send(());
    });
    rx.recv_timeout(deadline).is_ok()
}

/// The top-level entries of a damaged settings object that still parse, each on its own.
fn salvage(text: &str) -> Map<String, Value> {
    let mut out = Map::new();
    let Some(body) = text.trim_start_matches('\u{feff}').trim_start().strip_prefix('{') else { return out };
    let (mut depth, mut in_str, mut esc, mut start, mut ended) = (0i32, false, false, 0usize, false);
    let mut members = Vec::new();
    for (i, c) in body.bytes().enumerate() {
        if in_str {
            if esc {
                esc = false;
            } else if c == b'\\' {
                esc = true;
            } else if c == b'"' {
                in_str = false;
            }
            continue;
        }
        match c {
            b'"' => in_str = true,
            b'{' | b'[' => depth += 1,
            b']' => depth -= 1,
            b'}' if depth == 0 => {
                members.push(&body[start..i]);
                ended = true;
                break;
            }
            b'}' => depth -= 1,
            b',' if depth == 0 => {
                members.push(&body[start..i]);
                start = i + 1;
            }
            _ => {}
        }
    }
    if !ended {
        members.push(&body[start..]); // a file cut short
    }
    for m in members {
        if let Ok(Value::Object(one)) = serde_json::from_str(&format!("{{{m}}}")) {
            out.extend(one);
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_dir(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("kolux-rs-test-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        dir
    }

    #[test]
    fn values_survive_reopening() {
        let dir = temp_dir("kv");
        {
            let s = Store::open(&dir).unwrap();
            assert_eq!(s.get("starts").unwrap(), None);
            s.set("starts", "1").unwrap();
            s.set("starts", "2").unwrap();
        }
        let s = Store::open(&dir).unwrap();
        assert_eq!(s.get("starts").unwrap().as_deref(), Some("2"));
        drop(s); // Windows will not delete a folder while SQLite holds the db open
        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn settings_round_trip_and_default_to_empty() {
        let dir = temp_dir("settings");
        let s = Store::open(&dir).unwrap();
        assert_eq!(s.settings(), serde_json::json!({}));
        s.save_settings(&serde_json::json!({ "theme": "classic" })).unwrap();
        assert_eq!(s.settings()["theme"], "classic");
        assert!(!dir.join("settings.json.tmp").exists());
        drop(s);
        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn app048_unchanged_values_are_not_written_again_and_real_changes_are() {
        let dir = temp_dir("unchanged");
        let s = Store::open(&dir).unwrap();
        s.set("k", "1").unwrap();
        let before = s.conn.total_changes();
        s.set("k", "1").unwrap();
        assert_eq!(s.conn.total_changes(), before, "the same value is not written");
        s.set("k", "2").unwrap();
        assert_eq!(s.conn.total_changes(), before + 1, "a real change is");
        s.save_settings(&serde_json::json!({ "a": 1 })).unwrap();
        let at = fs::metadata(dir.join("settings.json")).unwrap().modified().unwrap();
        std::thread::sleep(Duration::from_millis(30));
        s.save_settings(&serde_json::json!({ "a": 1 })).unwrap();
        assert_eq!(fs::metadata(dir.join("settings.json")).unwrap().modified().unwrap(), at, "same settings, no write");
        s.save_settings(&serde_json::json!({ "a": 2 })).unwrap();
        assert_eq!(s.settings()["a"], 2);
        drop(s);
        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn app048_a_briefly_busy_database_is_waited_on() {
        let dir = temp_dir("busy");
        let s = Store::open(&dir).unwrap();
        let other = Connection::open(dir.join("state.db")).unwrap();
        other.execute_batch("BEGIN IMMEDIATE; INSERT INTO kv VALUES ('x', 'held');").unwrap();
        let t = std::thread::spawn(move || {
            std::thread::sleep(Duration::from_millis(300));
            other.execute_batch("COMMIT;").unwrap();
        });
        s.set("y", "after").expect("waits for the other writer instead of failing");
        t.join().unwrap();
        assert_eq!(s.get("x").unwrap().as_deref(), Some("held"));
        drop(s);
        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn app048_a_damaged_settings_file_keeps_its_good_entries_and_is_written_back() {
        let dir = temp_dir("repair");
        let s = Store::open(&dir).unwrap();
        let path = dir.join("settings.json");
        fs::write(&path, r#"{ "theme": "dusk", "quietMinutes": tru, "nested": { "a": [1, "}"] }, "font": "Cascadia"#).unwrap();
        assert!(s.repair_settings().unwrap());
        assert_eq!(s.settings(), serde_json::json!({ "theme": "dusk", "nested": { "a": [1, "}"] } }));
        assert!(dir.join("settings.json.bad").exists(), "the damaged copy is kept");
        assert!(!s.repair_settings().unwrap(), "the repaired copy reads cleanly");
        // Nothing readable at all: an existing install, so the Classic look.
        fs::write(&path, "\u{0}\u{0}garbage").unwrap();
        assert!(s.repair_settings().unwrap());
        assert_eq!(s.settings(), serde_json::json!({ "uiLook": "classic" }));
        // A missing file is a fresh profile, not damage.
        fs::remove_file(&path).unwrap();
        assert!(!s.repair_settings().unwrap());
        assert_eq!(s.settings(), serde_json::json!({}));
        drop(s);
        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn app050_the_final_save_waits_for_one_in_flight_then_refuses_more() {
        use std::sync::{Arc, Mutex};
        let dir = temp_dir("close");
        let store = Arc::new(Mutex::new(Store::open(&dir).unwrap()));
        fs::write(dir.join("settings.json.tmp"), "left over").unwrap();
        // A save in flight holds the store for a moment.
        let busy = store.clone();
        let (go, ready) = std::sync::mpsc::channel();
        let t = std::thread::spawn(move || {
            let s = busy.lock().unwrap();
            go.send(()).unwrap();
            std::thread::sleep(Duration::from_millis(200));
            s.set("layout", "last").unwrap();
        });
        ready.recv().unwrap();
        let fin = store.clone();
        assert!(within(QUIT_DEADLINE, move || fin.lock().unwrap().close()));
        t.join().unwrap();
        let s = store.lock().unwrap();
        assert_eq!(s.get("layout").unwrap().as_deref(), Some("last"), "the save in flight finished first");
        assert!(s.set("layout", "later").is_err(), "nothing is written after the final save");
        assert!(s.save_settings(&serde_json::json!({ "a": 1 })).is_err());
        assert!(!dir.join("settings.json.tmp").exists(), "leftover temporary file cleared");
        drop(s);
        drop(store);
        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn app050_a_stuck_final_save_does_not_hold_quitting_past_the_deadline() {
        let started = std::time::Instant::now();
        assert!(!within(Duration::from_millis(200), || std::thread::sleep(Duration::from_secs(30))));
        assert!(started.elapsed() < Duration::from_secs(2));
    }
}
