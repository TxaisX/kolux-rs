//! The state store: SQLite for app state, one JSON file for user settings, both under the
//! profile folder. Everything the user sets up is saved as they go (LOOP.md stack; theme 9).

use rusqlite::{params, Connection};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};

pub struct Store {
    conn: Connection,
    settings_path: PathBuf,
    /// T-441-b: the last read of settings.json failed and fell back to defaults, so a save built
    /// on what that read returned would wipe the file. Saves refuse until a read succeeds again.
    read_failed: AtomicBool,
}

impl Store {
    /// Opens (or creates) the store under `dir`. Creates the folder and the schema on first use.
    pub fn open(dir: &Path) -> rusqlite::Result<Store> {
        fs::create_dir_all(dir).map_err(|e| rusqlite::Error::InvalidPath(dir.join(e.to_string())))?;
        let conn = Connection::open(dir.join("state.db"))?;
        conn.execute_batch(
            "PRAGMA journal_mode=WAL;
             CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value TEXT NOT NULL);",
        )?;
        Ok(Store { conn, settings_path: dir.join("settings.json"), read_failed: AtomicBool::new(false) })
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

    pub fn set(&self, key: &str, value: &str) -> rusqlite::Result<()> {
        self.conn.execute(
            "INSERT INTO kv (key, value) VALUES (?1, ?2) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
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
            Ok(v) if v.is_object() => Ok(Some((bytes, crate::import::without_retired(v)))), // HID-036
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

    /// Writes settings whole or not at all. Refuses while the file on disk cannot be read, and
    /// after a read that fell back to defaults (T-441-b: a read that failed once and worked on the
    /// retry would otherwise save the defaults over the real file). The bytes just read and checked
    /// become settings.json.bak, except that an empty set never replaces a backup, so the copy from
    /// before a wipe survives the saves after it. Both files are synced to disk; the new one is
    /// renamed into place.
    pub fn save_settings(&self, value: &serde_json::Value) -> std::io::Result<()> {
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
            let bak = self.settings_path.with_extension("json.bak");
            if !bak.exists() || old.as_object().is_some_and(|o| !o.is_empty()) {
                write_synced(&bak, &bytes)?;
            }
        }
        let tmp = self.settings_path.with_extension("json.tmp");
        write_synced(&tmp, &serde_json::to_vec_pretty(&crate::import::without_retired(value.clone()))?)?; // HID-036: never written back
        fs::rename(&tmp, &self.settings_path)
    }

    /// Writes only the keys in `set` and drops those in `remove`, over what is on disk now, so a
    /// writer holding an older copy of the settings does not undo anyone else's keys. A failed read
    /// fails the patch; it is never laid over an empty set.
    pub fn patch_settings(&self, set: &serde_json::Map<String, serde_json::Value>, remove: &[String]) -> std::io::Result<()> {
        let now = self.try_settings().map_err(|e| self.refused(&e, e.kind()))?;
        self.save_settings(&patched(now, set, remove))
    }
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
