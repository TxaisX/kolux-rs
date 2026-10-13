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
    /// APP-049: what opening did about a damaged state file, for the log; None when it was sound.
    pub recovered: Option<String>,
}

/// The damage errors a state file can show; anything else (busy, no access) is not damage.
fn damaged(e: &rusqlite::Error) -> bool {
    matches!(e.sqlite_error_code(), Some(rusqlite::ErrorCode::NotADatabase | rusqlite::ErrorCode::DatabaseCorrupt))
}

/// Opens a state file and checks it; a failed check is reported as corruption.
fn connect(db: &Path) -> rusqlite::Result<Connection> {
    let conn = if db.as_os_str().is_empty() { Connection::open_in_memory()? } else { Connection::open(db)? };
    // Another writer (the command line, a second window) holding the database briefly is waited on.
    conn.busy_timeout(Duration::from_secs(5))?;
    conn.execute_batch(
        "PRAGMA journal_mode=WAL;
         CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value TEXT NOT NULL);",
    )?;
    let check: String = conn.query_row("PRAGMA quick_check", [], |r| r.get(0))?;
    if check != "ok" {
        return Err(rusqlite::Error::SqliteFailure(ffi::Error::new(ffi::SQLITE_CORRUPT), Some(check)));
    }
    Ok(conn)
}

/// APP-049: a sound store with entries is copied to state.db.bak, the last good copy a damaged
/// file comes back from. An empty store never replaces it. Failures only cost the backup.
/// ponytail: taken at each launch, so changes since the last launch are not in it.
fn back_up(conn: &Connection, dir: &Path) {
    let has: bool = conn.query_row("SELECT EXISTS (SELECT 1 FROM kv)", [], |r| r.get(0)).unwrap_or(false);
    if !has {
        return;
    }
    let tmp = dir.join("state.db.bak.tmp");
    let _ = fs::remove_file(&tmp);
    if conn.execute("VACUUM INTO ?1", params![tmp.to_string_lossy()]).is_ok() {
        let _ = fs::rename(&tmp, dir.join("state.db.bak"));
    }
}

/// APP-049: the state file is damaged. It is copied aside (with its journal) before anything is
/// restored; then the last good copy replaces it, or a fresh store starts when there is none.
/// When it cannot be copied aside or replaced, the session runs on an in-memory copy of the backup
/// and the damaged file is never written.
fn recover(dir: &Path, why: &rusqlite::Error) -> rusqlite::Result<(Connection, String)> {
    let db = dir.join("state.db");
    let bak = dir.join("state.db.bak");
    let side = |name: &str| dir.join(name);
    let aside = fs::copy(&db, side("state.db.bad")).and_then(|_| {
        if side("state.db-wal").exists() {
            fs::copy(side("state.db-wal"), side("state.db.bad-wal"))?;
        }
        fs::remove_file(&db)
    });
    if let Err(e) = aside {
        let conn = connect(Path::new(""))?;
        if bak.exists() {
            conn.execute("ATTACH DATABASE ?1 AS bak", params![bak.to_string_lossy()])?;
            conn.execute_batch("INSERT OR REPLACE INTO kv SELECT key, value FROM bak.kv; DETACH DATABASE bak;")?;
        }
        return Ok((conn, format!("state.db is damaged ({why}) and could not be kept aside ({e}); this session runs on the last good copy and its changes are not saved, so the damaged file stays as it was")));
    }
    let _ = fs::remove_file(side("state.db-wal"));
    let _ = fs::remove_file(side("state.db-shm"));
    if bak.exists() && fs::copy(&bak, &db).is_ok() {
        if let Ok(conn) = connect(&db) {
            return Ok((conn, format!("state.db was damaged ({why}); it is kept as state.db.bad and the last good copy (state.db.bak) was restored")));
        }
        let _ = fs::remove_file(&db);
    }
    Ok((connect(&db)?, format!("state.db was damaged ({why}); it is kept as state.db.bad and no good copy existed, so a fresh store was started")))
}

impl Store {
    /// Opens (or creates) the store under `dir`. Creates the folder and the schema on first use.
    pub fn open(dir: &Path) -> rusqlite::Result<Store> {
        fs::create_dir_all(dir).map_err(|e| rusqlite::Error::InvalidPath(dir.join(e.to_string())))?;
        // A zero-byte file opens as an empty store: missing, not damaged (APP-049).
        let (conn, recovered) = match connect(&dir.join("state.db")) {
            Ok(conn) => {
                back_up(&conn, dir);
                (conn, None)
            }
            Err(e) if damaged(&e) => recover(dir, &e).map(|(c, why)| (c, Some(why)))?,
            Err(e) => return Err(e),
        };
        Ok(Store { conn, settings_path: dir.join("settings.json"), closed: Cell::new(false), recovered })
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

    /// APP-011: a durable save point before a restart, an update or a reload: the settings are
    /// written out again and flushed to the drive, and the database's journal is folded into it.
    /// Any failure comes back, so the action that asked for it is cancelled.
    pub fn save_point(&self) -> std::io::Result<()> {
        if self.closed.get() {
            return Err(std::io::Error::other("Kolux RS is quitting"));
        }
        let tmp = self.settings_path.with_extension("json.tmp");
        let written = (|| {
            let mut f = fs::File::create(&tmp)?;
            std::io::Write::write_all(&mut f, &serde_json::to_vec_pretty(&self.settings())?)?;
            f.sync_all()?;
            drop(f);
            fs::rename(&tmp, &self.settings_path)
        })();
        if written.is_err() {
            let _ = fs::remove_file(&tmp);
        }
        written?;
        self.conn.execute_batch("PRAGMA wal_checkpoint(FULL);").map_err(std::io::Error::other)
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

    /// A profile whose state.db holds "a" = "1" in its backup copy and "a" = "2" in the live file.
    fn app049_profile(name: &str) -> PathBuf {
        let dir = temp_dir(name);
        Store::open(&dir).unwrap().set("a", "1").unwrap();
        let s = Store::open(&dir).unwrap();
        assert!(dir.join("state.db.bak").exists(), "a good store with entries is backed up at open");
        s.set("a", "2").unwrap();
        drop(s);
        dir
    }

    fn app049_corrupt(dir: &Path) -> Vec<u8> {
        let junk = vec![b'x'; 4096];
        fs::write(dir.join("state.db"), &junk).unwrap();
        let _ = fs::remove_file(dir.join("state.db-wal"));
        let _ = fs::remove_file(dir.join("state.db-shm"));
        junk
    }

    #[test]
    fn app049_a_damaged_state_file_is_kept_aside_and_the_backup_comes_back() {
        let dir = app049_profile("app049-restore");
        let junk = app049_corrupt(&dir);
        let s = Store::open(&dir).unwrap();
        assert_eq!(s.get("a").unwrap().as_deref(), Some("1"), "the setup comes back from the backup copy");
        assert!(s.recovered.as_deref().unwrap_or("").contains("state.db.bad"), "the recovery is reported: {:?}", s.recovered);
        assert_eq!(fs::read(dir.join("state.db.bad")).unwrap(), junk, "the damaged file is kept aside as it was");
        s.set("b", "3").unwrap();
        drop(s);
        let s = Store::open(&dir).unwrap();
        assert_eq!(s.get("b").unwrap().as_deref(), Some("3"), "the restored store saves as usual");
        assert!(s.recovered.is_none());
        drop(s);
        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn app049_a_damaged_file_that_cannot_be_kept_aside_is_never_overwritten() {
        let dir = app049_profile("app049-frozen");
        let junk = app049_corrupt(&dir);
        // A folder where the aside copy would go makes the copy impossible.
        fs::create_dir_all(dir.join("state.db.bad")).unwrap();
        let s = Store::open(&dir).unwrap();
        assert_eq!(s.get("a").unwrap().as_deref(), Some("1"), "the session still starts from the backup copy");
        assert!(s.recovered.as_deref().unwrap_or("").contains("not saved"), "the frozen session is reported: {:?}", s.recovered);
        s.set("b", "3").unwrap();
        s.save_point().unwrap();
        s.close();
        drop(s);
        assert_eq!(fs::read(dir.join("state.db")).unwrap(), junk, "the damaged file is left exactly as it was");
        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn app049_an_empty_state_file_counts_as_missing() {
        let dir = app049_profile("app049-empty");
        fs::write(dir.join("state.db"), b"").unwrap();
        let _ = fs::remove_file(dir.join("state.db-wal"));
        let s = Store::open(&dir).unwrap();
        assert!(s.recovered.is_none(), "an empty file is not damage");
        assert_eq!(s.get("a").unwrap(), None, "it starts fresh");
        assert!(!dir.join("state.db.bad").exists());
        drop(s);
        let bak = Connection::open(dir.join("state.db.bak")).unwrap();
        let a: String = bak.query_row("SELECT value FROM kv WHERE key = 'a'", [], |r| r.get(0)).unwrap();
        assert_eq!(a, "1", "the backup copy is not replaced by an empty store");
        drop(bak);
        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn app011_a_save_point_writes_the_settings_out_and_fails_when_they_cannot_be_written() {
        let dir = temp_dir("savepoint");
        let s = Store::open(&dir).unwrap();
        s.save_settings(&serde_json::json!({ "quietMinutes": 7 })).unwrap();
        s.set("starts", "1").unwrap();
        s.save_point().unwrap();
        assert_eq!(s.settings()["quietMinutes"], 7, "the settings are the same after the save point");
        let file = dir.join("settings.json");
        let mut perms = fs::metadata(&file).unwrap().permissions();
        perms.set_readonly(true);
        fs::set_permissions(&file, perms.clone()).unwrap();
        assert!(s.save_point().is_err(), "a settings file that cannot be written fails the save point");
        assert!(!dir.join("settings.json.tmp").exists(), "no temporary file is left behind");
        #[allow(clippy::permissions_set_readonly_false)]
        perms.set_readonly(false);
        fs::set_permissions(&file, perms).unwrap();
        s.close();
        assert!(s.save_point().is_err(), "after the final save no save point is taken");
        drop(s);
        fs::remove_dir_all(&dir).unwrap();
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
