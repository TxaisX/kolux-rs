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
use std::sync::atomic::{AtomicBool, Ordering};

pub struct Store {
    conn: Connection,
    settings_path: PathBuf,
    /// T-441-b: the last read of settings.json failed and fell back to defaults, so a save built
    /// on what that read returned would wipe the file. Saves refuse until a read succeeds again.
    read_failed: AtomicBool,
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
        Ok(Store { conn, settings_path: dir.join("settings.json"), closed: Cell::new(false), recovered, read_failed: AtomicBool::new(false) })
    }

    /// APP-021: a store kept in memory when the profile's cannot be opened, so the launch goes on.
    pub fn in_memory(dir: &Path) -> rusqlite::Result<Store> {
        Ok(Store { conn: connect(Path::new(""))?, settings_path: dir.join("settings.json"), closed: Cell::new(false), recovered: None, read_failed: AtomicBool::new(false) })
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

    /// Several keys in one transaction: all of them land, or none do.
    pub fn set_all(&self, pairs: &[(&str, &str)]) -> rusqlite::Result<()> {
        let tx = self.conn.unchecked_transaction()?;
        for (k, v) in pairs {
            tx.execute("INSERT INTO kv (key, value) VALUES (?1, ?2) ON CONFLICT(key) DO UPDATE SET value = excluded.value", params![k, v])?;
        }
        tx.commit()
    }

    /// User settings as JSON. No file yet reads as an empty object; a file that cannot be read or
    /// is not a JSON object is an error, never an empty set (T-441).
    pub fn try_settings(&self) -> std::io::Result<serde_json::Value> {
        let read = self.read_file();
        self.read_failed.store(read.is_err(), Ordering::SeqCst);
        Ok(read?.map_or_else(|| serde_json::json!({}), |(_, v)| v))
    }

    /// The file's bytes and the object they hold; `None` when there is no file yet.
    fn read_file(&self) -> std::io::Result<Option<(Vec<u8>, serde_json::Value)>> {
        let bytes = match fs::read(&self.settings_path) {
            Ok(b) => b,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(None),
            Err(e) => return Err(e),
        };
        match serde_json::from_slice::<serde_json::Value>(&bytes) {
            Ok(v) if v.is_object() => Ok(Some((bytes, v))),
            Ok(_) => Err(std::io::Error::new(std::io::ErrorKind::InvalidData, "it is not a JSON object")),
            Err(e) => Err(std::io::Error::new(std::io::ErrorKind::InvalidData, e)),
        }
    }

    fn refused(&self, why: impl std::fmt::Display, kind: std::io::ErrorKind) -> std::io::Error {
        let bak = self.settings_path.with_extension("json.bak");
        std::io::Error::new(kind, format!("Kolux could not read {} ({why}), so it left the file untouched and saved nothing. The last good copy is {}.", self.settings_path.display(), bak.display()))
    }

    /// User settings for reading. An unreadable file reads as empty here so the app still starts on
    /// defaults; every save refuses until the file reads again, so the empty copy never lands on disk.
    pub fn settings(&self) -> serde_json::Value {
        self.try_settings().unwrap_or_else(|e| {
            eprintln!("kolux: settings.json could not be read, using defaults and saving nothing: {e}");
            serde_json::json!({})
        })
    }

    /// APP-048: a settings file that is not valid JSON is repaired at start. The damaged bytes are
    /// kept beside it as settings.json.bad first (an earlier .bad is moved aside to a timestamped
    /// name, never overwritten). When settings.json.bak (the last good copy, T-441) parses as a
    /// non-empty set, the file is rebuilt from it with the entries that still parse laid over it;
    /// otherwise the entries that still parse are written back (nothing readable at all keeps the
    /// Classic look of an existing install) and any unusable .bak is kept as
    /// settings.json.bak.pre-repair, since the next save replaces .bak. A file that cannot be read
    /// (no access) is left alone and saves keep refusing (T-441). Returns whether it was repaired.
    pub fn repair_settings(&self) -> std::io::Result<bool> {
        let bytes = match self.read_file() {
            Ok(_) => return Ok(false),
            Err(e) if e.kind() == std::io::ErrorKind::InvalidData => fs::read(&self.settings_path)?,
            Err(e) => return Err(e),
        };
        let salvaged = salvage(&String::from_utf8_lossy(&bytes));
        let bak = self.settings_path.with_extension("json.bak");
        let last_good = fs::read(&bak)
            .ok()
            .and_then(|b| serde_json::from_slice::<Value>(&b).ok())
            .and_then(|v| match v {
                Value::Object(o) if !o.is_empty() => Some(o),
                _ => None,
            });
        let kept = match last_good {
            Some(mut base) => {
                base.extend(salvaged);
                base
            }
            None => {
                if bak.exists() {
                    fs::copy(&bak, self.settings_path.with_extension("json.bak.pre-repair"))?;
                }
                let mut kept = salvaged;
                if kept.is_empty() {
                    kept.insert(LOOK_FIELD.into(), "classic".into());
                }
                kept
            }
        };
        let bad = self.settings_path.with_extension("json.bad");
        if bad.exists() {
            let stamp = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis()).unwrap_or(0);
            fs::rename(&bad, self.settings_path.with_extension(format!("json.bad-{stamp}")))?;
        }
        fs::copy(&self.settings_path, &bad)?;
        let tmp = self.settings_path.with_extension("json.tmp");
        let written = (|| {
            let mut f = fs::File::create(&tmp)?;
            std::io::Write::write_all(&mut f, &serde_json::to_vec_pretty(&Value::Object(kept))?)?;
            f.sync_all()?;
            drop(f);
            fs::rename(&tmp, &self.settings_path)
        })();
        if written.is_err() {
            let _ = fs::remove_file(&tmp);
        }
        written?;
        self.read_failed.store(false, Ordering::SeqCst);
        Ok(true)
    }

    /// Writes settings whole or not at all. Refuses while the file on disk cannot be read, and
    /// after a read that fell back to defaults (T-441-b: a read that failed once and worked on the
    /// retry would otherwise save the defaults over the real file). The bytes just read and checked
    /// become settings.json.bak, except that an empty set never replaces a backup, so the copy from
    /// before a wipe survives the saves after it. Both files are synced to disk; the new one is
    /// renamed into place.
    pub fn save_settings(&self, value: &serde_json::Value) -> std::io::Result<()> {
        if self.closed.get() {
            return Err(std::io::Error::other("Kolux RS is quitting"));
        }
        if self.read_failed.load(Ordering::SeqCst) {
            return Err(self.refused("an earlier read of it failed", std::io::ErrorKind::InvalidData));
        }
        let current = self.read_file().map_err(|e| self.refused(&e, e.kind()))?;
        let write_synced = |path: &Path, bytes: &[u8]| -> std::io::Result<()> {
            use std::io::Write;
            let mut f = fs::File::create(path)?;
            f.write_all(bytes)?;
            f.sync_all()
        };
        if let Some((bytes, old)) = current {
            // APP-048: the same settings again are not written.
            if &old == value {
                return Ok(());
            }
            let bak = self.settings_path.with_extension("json.bak");
            if !bak.exists() || old.as_object().is_some_and(|o| !o.is_empty()) {
                write_synced(&bak, &bytes)?;
            }
        }
        let tmp = self.settings_path.with_extension("json.tmp");
        write_synced(&tmp, &serde_json::to_vec_pretty(value)?)?;
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
            std::io::Write::write_all(&mut f, &serde_json::to_vec_pretty(&self.try_settings()?)?)?;
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

    /// Writes only the keys in `set` and drops those in `remove`, over what is on disk now, so a
    /// writer holding an older copy of the settings does not undo anyone else's keys. A failed read
    /// fails the patch; it is never laid over an empty set.
    pub fn patch_settings(&self, set: &serde_json::Map<String, serde_json::Value>, remove: &[String]) -> std::io::Result<()> {
        let now = self.try_settings().map_err(|e| self.refused(&e, e.kind()))?;
        self.save_settings(&patched(now, set, remove))
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

/// `value` with the keys in `set` laid over it and the keys in `remove` taken out.
pub fn patched(mut value: serde_json::Value, set: &serde_json::Map<String, serde_json::Value>, remove: &[String]) -> serde_json::Value {
    if !value.is_object() {
        value = serde_json::json!({});
    }
    if let Some(obj) = value.as_object_mut() {
        for k in remove {
            obj.remove(k);
        }
        for (k, v) in set {
            obj.insert(k.clone(), v.clone());
        }
    }
    value
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

    #[test]
    fn app048_a_truncated_settings_file_is_rebuilt_from_the_last_good_copy_and_survives_the_next_save() {
        // Council review of a08f2bb, B2: the repair used to write a stub that the next save then
        // copied over .bak, so every setting was lost.
        let dir = temp_dir("repair-bak");
        let s = Store::open(&dir).unwrap();
        let path = dir.join("settings.json");
        let full = serde_json::json!({ "theme": "new", "defaultAgent": "claude", "fontSize": 14, "uiLook": "new" });
        s.save_settings(&full).unwrap();
        let mut newer = full.clone();
        newer["fontSize"] = 15.into();
        s.save_settings(&newer).unwrap(); // .bak now holds `full`
        for (n, broken) in ["", r#"{"theme": "dusk", "defaultAg"#].into_iter().enumerate() {
            fs::write(&path, broken).unwrap();
            assert!(s.repair_settings().unwrap());
            let repaired = s.settings();
            assert_eq!(repaired["defaultAgent"], "claude", "pass {n}: rebuilt from the last good copy: {repaired}");
            assert_eq!(repaired["uiLook"], "new", "pass {n}: {repaired}");
            if n == 1 {
                assert_eq!(repaired["theme"], "dusk", "the entries that still parse win over the backup");
            }
            // One ordinary save afterwards (the layout write that follows every start).
            let mut next = repaired.clone();
            next["layout"] = format!("after-{n}").into();
            s.save_settings(&next).unwrap();
            let bak: Value = serde_json::from_slice(&fs::read(dir.join("settings.json.bak")).unwrap()).unwrap();
            assert_eq!(bak["defaultAgent"], "claude", "pass {n}: the full copy survives in .bak: {bak}");
            assert_eq!(s.settings()["defaultAgent"], "claude");
        }
        // Each damaged copy is kept: the newest as .bad, the earlier one under a timestamped name.
        let bads = fs::read_dir(&dir).unwrap().filter_map(|e| e.ok()).map(|e| e.file_name().to_string_lossy().into_owned()).filter(|n| n.starts_with("settings.json.bad")).count();
        assert_eq!(bads, 2);
        assert_eq!(fs::read_to_string(dir.join("settings.json.bad")).unwrap(), r#"{"theme": "dusk", "defaultAg"#);
        drop(s);
        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn app048_an_unusable_backup_is_kept_aside_before_the_repair() {
        let dir = temp_dir("repair-prerepair");
        let s = Store::open(&dir).unwrap();
        fs::write(dir.join("settings.json"), "\u{0}garbage").unwrap();
        fs::write(dir.join("settings.json.bak"), "{}").unwrap();
        assert!(s.repair_settings().unwrap());
        assert_eq!(s.settings(), serde_json::json!({ "uiLook": "classic" }));
        assert_eq!(fs::read_to_string(dir.join("settings.json.bak.pre-repair")).unwrap(), "{}");
        drop(s);
        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn t441_a_corrupt_settings_file_is_never_overwritten() {
        let dir = temp_dir("corrupt");
        let s = Store::open(&dir).unwrap();
        s.save_settings(&serde_json::json!({ "theme": "classic", "defaultAgent": "codex" })).unwrap();
        s.patch_settings(&serde_json::Map::from_iter([("theme".into(), serde_json::json!("new"))]), &[]).unwrap();
        // The backup holds the file as it was before the last save.
        let bak: serde_json::Value = serde_json::from_slice(&fs::read(dir.join("settings.json.bak")).unwrap()).unwrap();
        assert_eq!(bak["theme"], "classic");

        for planted in [&b"{\"theme\": \"new\", \"defaultAg"[..], b"", b"[1,2]"] {
            fs::write(dir.join("settings.json"), planted).unwrap();
            assert!(s.try_settings().is_err());
            assert_eq!(s.settings(), serde_json::json!({}), "reads fall back to defaults");
            let err = s.patch_settings(&serde_json::Map::from_iter([("uiLook".into(), serde_json::json!("new"))]), &[]).unwrap_err();
            assert!(err.to_string().contains("settings.json.bak"), "{err}");
            assert!(s.save_settings(&serde_json::json!({})).is_err());
            assert_eq!(fs::read(dir.join("settings.json")).unwrap(), planted, "the planted file is untouched");
            let bak: serde_json::Value = serde_json::from_slice(&fs::read(dir.join("settings.json.bak")).unwrap()).unwrap();
            assert_eq!(bak["theme"], "classic", "the last good copy is untouched");
        }
        drop(s);
        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn t441b_a_read_that_failed_is_never_saved_over_and_the_first_backup_is_kept() {
        let dir = temp_dir("t441b");
        let s = Store::open(&dir).unwrap();
        s.save_settings(&serde_json::json!({ "theme": "classic", "defaultAgent": "codex" })).unwrap();
        let good = fs::read(dir.join("settings.json")).unwrap();

        // A corrupt file: the patch fails loudly and neither file changes.
        fs::write(dir.join("settings.json"), b"{\"theme\": \"cla").unwrap();
        let bak_before = fs::read(dir.join("settings.json.bak")).ok();
        let set = serde_json::Map::from_iter([("uiLook".into(), serde_json::json!("new"))]);
        assert!(s.patch_settings(&set, &[]).is_err());
        assert_eq!(fs::read(dir.join("settings.json")).unwrap(), b"{\"theme\": \"cla");
        assert_eq!(fs::read(dir.join("settings.json.bak")).ok(), bak_before);

        // The read fails, the file is mended before the save: the save built on defaults is refused.
        let defaults = s.settings();
        assert_eq!(defaults, serde_json::json!({}));
        fs::write(dir.join("settings.json"), &good).unwrap();
        let err = s.save_settings(&defaults).unwrap_err();
        assert!(err.to_string().contains("an earlier read of it failed"), "{err}");
        assert_eq!(fs::read(dir.join("settings.json")).unwrap(), good, "the real file was not wiped");

        // A fresh read clears the refusal; patches work again and keep every key.
        s.patch_settings(&set, &[]).unwrap();
        let now = s.settings();
        assert_eq!((now["theme"].as_str(), now["uiLook"].as_str()), (Some("classic"), Some("new")));

        // Settings saved empty on purpose: the backup from before stays, through later saves too.
        s.save_settings(&serde_json::json!({})).unwrap();
        s.save_settings(&serde_json::json!({ "theme": "x" })).unwrap();
        let bak: serde_json::Value = serde_json::from_slice(&fs::read(dir.join("settings.json.bak")).unwrap()).unwrap();
        assert_eq!(bak["defaultAgent"], "codex", "the empty set never replaced the backup");
        drop(s);
        fs::remove_dir_all(&dir).unwrap();
    }

    /// T-441-b for lib.rs write_settings, which reads with settings() and saves under one store
    /// lock: the read that fell back to defaults sets read_failed on that same Store, so the save
    /// built on the defaults is refused even after the file reads again, and no other read can
    /// clear the flag in between while the lock is held.
    #[test]
    fn t441b_write_settings_shape_a_failed_read_then_a_good_one_saves_nothing() {
        let dir = temp_dir("t441b-write");
        let store = std::sync::Mutex::new(Store::open(&dir).unwrap());
        store.lock().unwrap().save_settings(&serde_json::json!({ "theme": "classic", "apiKey": "sealed" })).unwrap();
        let good = fs::read(dir.join("settings.json")).unwrap();
        fs::write(dir.join("settings.json"), b"{ half a file").unwrap();
        let set = serde_json::Map::from_iter([("uiLook".into(), serde_json::json!("new"))]);
        let s = store.lock().unwrap();
        let old = s.settings();
        fs::write(dir.join("settings.json"), &good).unwrap();
        let value = crate::secrets::keep_stored_secrets(&old, patched(old.clone(), &set, &[]));
        assert!(s.save_settings(&value).is_err(), "the save built on defaults is refused");
        assert_eq!(fs::read(dir.join("settings.json")).unwrap(), good, "the real file is kept");
        // The next write_settings reads the mended file and keeps every key.
        let old = s.settings();
        s.save_settings(&crate::secrets::keep_stored_secrets(&old, patched(old.clone(), &set, &[]))).unwrap();
        let now = s.settings();
        assert_eq!((now["theme"].as_str(), now["uiLook"].as_str()), (Some("classic"), Some("new")));
        drop(s);
        drop(store);
        fs::remove_dir_all(&dir).unwrap();
    }
}
