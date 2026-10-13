//! The state store: SQLite for app state, one JSON file for user settings, both under the
//! profile folder. Everything the user sets up is saved as they go (LOOP.md stack; theme 9).

use rusqlite::{params, Connection};
use std::fs;
use std::path::{Path, PathBuf};

pub struct Store {
    conn: Connection,
    settings_path: PathBuf,
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
        Ok(Store { conn, settings_path: dir.join("settings.json") })
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
        let bytes = match fs::read(&self.settings_path) {
            Ok(b) => b,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(serde_json::json!({})),
            Err(e) => return Err(e),
        };
        match serde_json::from_slice::<serde_json::Value>(&bytes) {
            Ok(v) if v.is_object() => Ok(v),
            Ok(_) => Err(std::io::Error::new(std::io::ErrorKind::InvalidData, "it is not a JSON object")),
            Err(e) => Err(std::io::Error::new(std::io::ErrorKind::InvalidData, e)),
        }
    }

    /// User settings for reading. An unreadable file reads as empty here so the app still starts on
    /// defaults; every save refuses until the file reads again, so the empty copy never lands on disk.
    pub fn settings(&self) -> serde_json::Value {
        self.try_settings().unwrap_or_else(|e| {
            eprintln!("kolux: settings.json could not be read, using defaults and saving nothing: {e}");
            serde_json::json!({})
        })
    }

    /// Writes settings whole or not at all. Refuses while the file on disk cannot be read, so a
    /// writer that saw defaults never wipes the real file; keeps the last good file as
    /// settings.json.bak; syncs the new file to disk before renaming it into place.
    pub fn save_settings(&self, value: &serde_json::Value) -> std::io::Result<()> {
        if let Err(e) = self.try_settings() {
            let bak = self.settings_path.with_extension("json.bak");
            return Err(std::io::Error::new(
                e.kind(),
                format!("Kolux could not read {} ({e}), so it left the file untouched and saved nothing. The last good copy is {}.", self.settings_path.display(), bak.display()),
            ));
        }
        let tmp = self.settings_path.with_extension("json.tmp");
        {
            use std::io::Write;
            let mut f = fs::File::create(&tmp)?;
            f.write_all(&serde_json::to_vec_pretty(value)?)?;
            f.sync_all()?;
        }
        if self.settings_path.exists() {
            fs::copy(&self.settings_path, self.settings_path.with_extension("json.bak"))?;
        }
        fs::rename(&tmp, &self.settings_path)
    }

    /// Writes only the keys in `set` and drops those in `remove`, over what is on disk now, so a
    /// writer holding an older copy of the settings does not undo anyone else's keys.
    pub fn patch_settings(&self, set: &serde_json::Map<String, serde_json::Value>, remove: &[String]) -> std::io::Result<()> {
        self.save_settings(&patched(self.settings(), set, remove))
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
}
