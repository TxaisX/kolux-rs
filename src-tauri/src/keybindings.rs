//! The shortcuts file the user owns: `~/.kolux/keybindings.json` (COMPAT.md section 4.1,
//! SET-011). This side only finds the file, creates it empty when it is missing and reads it.
//! It never writes over a file it cannot parse. Which chord fires which action is decided in the
//! page (`src/keys`), because that is where the keys are pressed.

use serde::Serialize;
use std::fs;
use std::path::{Path, PathBuf};

pub const FILE_NAME: &str = "keybindings.json";

/// What an empty file looks like: version 1, no overrides anywhere. The defaults are built in,
/// so a fresh file lists none of them (COMPAT.md 4.1 "created empty").
const EMPTY: &str = "{\n  \"version\": 1,\n  \"keybindings\": {},\n  \"platforms\": {\n    \"darwin\": {},\n    \"linux\": {},\n    \"win32\": {}\n  }\n}\n";

#[derive(Serialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct KeybindingsFile {
    pub path: String,
    /// The file parsed as a JSON object, or null when it could not be read or parsed
    /// (`error` says why, and the page falls back to the defaults).
    pub value: Option<serde_json::Value>,
    /// True when this read created the file because it was missing.
    pub created: bool,
    pub error: Option<String>,
}

/// `<home>/.kolux/keybindings.json`: the user's home, not the app's profile folder, so the file
/// is shared with the old app and survives an uninstall.
pub fn path_under(home: &Path) -> PathBuf {
    home.join(".kolux").join(FILE_NAME)
}

/// Reads the file, creating it empty first when it does not exist. A file that will not parse,
/// or is not a JSON object, is reported and left exactly as it was.
pub fn read(home: &Path) -> KeybindingsFile {
    let path = path_under(home);
    let shown = path.display().to_string();
    let mut created = false;
    if !path.exists() {
        if let Err(e) = create_empty(&path) {
            return KeybindingsFile { path: shown, value: None, created: false, error: Some(format!("Could not create the shortcuts file: {e}")) };
        }
        created = true;
    }
    let text = match fs::read_to_string(&path) {
        Ok(t) => t,
        Err(e) => return KeybindingsFile { path: shown, value: None, created, error: Some(format!("Could not read the shortcuts file: {e}")) },
    };
    match serde_json::from_str::<serde_json::Value>(&text) {
        Ok(v) if v.is_object() => KeybindingsFile { path: shown, value: Some(v), created, error: None },
        Ok(_) => KeybindingsFile { path: shown, value: None, created, error: Some("The shortcuts file is not a JSON object; the default shortcuts are in use and the file was left alone.".into()) },
        Err(e) => KeybindingsFile { path: shown, value: None, created, error: Some(format!("The shortcuts file could not be read as JSON ({e}); the default shortcuts are in use and the file was left alone.")) },
    }
}

/// Writes the empty file through a temporary file, so a crash never leaves half a file behind.
fn create_empty(path: &Path) -> std::io::Result<()> {
    if let Some(dir) = path.parent() {
        fs::create_dir_all(dir)?;
    }
    let tmp = path.with_extension("json.tmp");
    fs::write(&tmp, EMPTY)?;
    fs::rename(&tmp, path)
}

#[tauri::command]
pub fn keybindings_read(app: tauri::AppHandle) -> Result<KeybindingsFile, String> {
    use tauri::Manager;
    let home = app.path().home_dir().map_err(|e| e.to_string())?;
    Ok(read(&home))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_home(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("kolux-rs-keys-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn a_missing_file_is_created_empty_in_the_home_folder() {
        let home = temp_home("missing");
        let first = read(&home);
        let path = home.join(".kolux").join("keybindings.json");
        assert_eq!(first.path, path.display().to_string());
        assert!(first.created);
        assert_eq!(first.error, None);
        let v = first.value.unwrap();
        assert_eq!(v["version"], 1);
        assert_eq!(v["keybindings"], serde_json::json!({}));
        assert_eq!(v["platforms"]["win32"], serde_json::json!({}));
        assert!(!path.with_extension("json.tmp").exists());
        // The second read finds the file and does not claim to have created it.
        let second = read(&home);
        assert!(!second.created);
        assert_eq!(second.value, Some(v));
        fs::remove_dir_all(&home).unwrap();
    }

    #[test]
    fn a_broken_file_is_reported_and_never_written_over() {
        let home = temp_home("broken");
        let path = path_under(&home);
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        let broken = "{ \"version\": 1, \"keybindings\": { \"terminal.clear\": null, }";
        fs::write(&path, broken).unwrap();
        let got = read(&home);
        assert!(!got.created);
        assert_eq!(got.value, None);
        assert!(got.error.as_deref().unwrap().contains("default shortcuts are in use"));
        assert_eq!(fs::read_to_string(&path).unwrap(), broken);
        fs::remove_dir_all(&home).unwrap();
    }

    #[test]
    fn a_file_that_is_not_an_object_is_reported() {
        let home = temp_home("array");
        let path = path_under(&home);
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(&path, "[1, 2]").unwrap();
        let got = read(&home);
        assert_eq!(got.value, None);
        assert!(got.error.as_deref().unwrap().contains("not a JSON object"));
        assert_eq!(fs::read_to_string(&path).unwrap(), "[1, 2]");
        fs::remove_dir_all(&home).unwrap();
    }

    #[test]
    fn overrides_come_back_as_written() {
        let home = temp_home("overrides");
        let path = path_under(&home);
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(&path, "{\"version\":1,\"keybindings\":{\"terminal.clear\":null},\"platforms\":{\"win32\":{\"worktree.palette\":\"Mod+Shift+P\"}}}").unwrap();
        let got = read(&home);
        let v = got.value.unwrap();
        assert_eq!(v["keybindings"]["terminal.clear"], serde_json::Value::Null);
        assert_eq!(v["platforms"]["win32"]["worktree.palette"], "Mod+Shift+P");
        fs::remove_dir_all(&home).unwrap();
    }
}
