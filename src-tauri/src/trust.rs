//! SAFE-023 / SAFE-024: a new worktree is marked trusted in the agent's own configuration before
//! the agent starts, so its first prompt is never swallowed by a folder-trust menu.

use serde_json::{json, Value};
use std::path::{Path, PathBuf};
use std::sync::Mutex;

/// At most this many folders per launch (SAFE-024).
pub const MAX_PER_LAUNCH: usize = 12;

/// Writes happen one after another, so no mark can be lost to a sibling's rewrite.
static WRITE: Mutex<()> = Mutex::new(());

fn home_dir() -> PathBuf {
    std::env::var(if cfg!(windows) { "USERPROFILE" } else { "HOME" }).map(PathBuf::from).unwrap_or_else(|_| std::env::temp_dir())
}

/// Claude Code's user configuration: `.claude.json` under `CLAUDE_CONFIG_DIR`, else the home folder.
pub fn claude_config_file() -> PathBuf {
    std::env::var("CLAUDE_CONFIG_DIR").ok().filter(|d| !d.trim().is_empty()).map(PathBuf::from).unwrap_or_else(home_dir).join(".claude.json")
}

/// Claude's key for a folder: the real path on disk (letter case included) with forward slashes,
/// because Claude ignores an entry written with backslashes (SAFE-023).
pub fn claude_key(path: &Path) -> Result<String, String> {
    Ok(real_path(path)?.replace('\\', "/"))
}

/// The folder's real path on disk (letter case included), without the `\\?\` prefix.
pub(crate) fn real_path(path: &Path) -> Result<String, String> {
    let real = path.canonicalize().map_err(|e| format!("{}: {e}", path.display()))?;
    let s = real.to_string_lossy();
    Ok(s.strip_prefix(r"\\?\").unwrap_or(&s).to_string())
}

/// The batch rules (SAFE-024): something to trust, at most `MAX_PER_LAUNCH`, each folder real;
/// the keys come back sorted with duplicates dropped.
fn checked_keys(paths: &[PathBuf], key: fn(&Path) -> Result<String, String>) -> Result<Vec<String>, String> {
    if paths.is_empty() {
        return Err("no folders to trust".into());
    }
    if paths.len() > MAX_PER_LAUNCH {
        return Err(format!("at most {MAX_PER_LAUNCH} folders can be trusted per launch, not {}", paths.len()));
    }
    let mut keys = paths.iter().map(|p| key(p)).collect::<Result<Vec<_>, _>>()?;
    keys.sort();
    keys.dedup();
    Ok(keys)
}

/// Whole file at once, then a rename: a crash mid-write can never leave an agent half a file.
pub(crate) fn write_whole(file: &Path, text: &str) -> Result<(), String> {
    if let Some(parent) = file.parent() {
        std::fs::create_dir_all(parent).map_err(|e| format!("{}: {e}", parent.display()))?;
    }
    let tmp = file.with_extension("kolux-tmp");
    std::fs::write(&tmp, text).map_err(|e| format!("{}: {e}", tmp.display()))?;
    std::fs::rename(&tmp, file).map_err(|e| format!("{}: {e}", file.display()))
}

/// Marks `paths` trusted in Claude's configuration `file` and says how many were new. A file
/// that cannot be parsed is left alone; nothing is written when every folder was trusted already.
pub fn trust_claude(file: &Path, paths: &[PathBuf]) -> Result<usize, String> {
    let keys = checked_keys(paths, claude_key)?;
    let _guard = WRITE.lock().map_err(|e| e.to_string())?;
    let mut doc: Value = match std::fs::read_to_string(file) {
        Ok(text) => serde_json::from_str(&text).map_err(|e| format!("{} is not valid JSON ({e}); left untouched", file.display()))?,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => json!({}),
        Err(e) => return Err(format!("{}: {e}", file.display())),
    };
    if !doc.is_object() {
        return Err(format!("{} does not hold a JSON object; left untouched", file.display()));
    }
    if !doc["projects"].is_object() {
        doc["projects"] = json!({});
    }
    let mut added = 0;
    for key in &keys {
        let entry = &mut doc["projects"][key.as_str()];
        if entry["hasTrustDialogAccepted"] == json!(true) {
            continue;
        }
        if !entry.is_object() {
            *entry = json!({});
        }
        entry["hasTrustDialogAccepted"] = json!(true);
        added += 1;
    }
    if added > 0 {
        write_whole(file, &serde_json::to_string_pretty(&doc).map_err(|e| e.to_string())?)?;
    }
    Ok(added)
}


/// Codex's configuration: `config.toml` under `CODEX_HOME`, else `~/.codex`.
pub fn codex_config_file() -> PathBuf {
    std::env::var("CODEX_HOME")
        .ok()
        .filter(|d| !d.trim().is_empty())
        .map(PathBuf::from)
        .unwrap_or_else(|| home_dir().join(".codex"))
        .join("config.toml")
}

/// Codex's key for a folder: the real path, lower-cased on Windows (what Codex itself writes
/// and looks up).
pub fn codex_key(path: &Path) -> Result<String, String> {
    let real = real_path(path)?;
    Ok(if cfg!(windows) { real.to_ascii_lowercase() } else { real })
}

/// Marks `paths` trusted in Codex's `file` (`[projects."<key>"] trust_level = "trusted"`) and
/// says how many were new; everything else in the file stays byte for byte.
pub fn trust_codex(file: &Path, paths: &[PathBuf]) -> Result<usize, String> {
    let keys = checked_keys(paths, codex_key)?;
    let _guard = WRITE.lock().map_err(|e| e.to_string())?;
    let text = match std::fs::read_to_string(file) {
        Ok(text) => text,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => String::new(),
        Err(e) => return Err(format!("{}: {e}", file.display())),
    };
    let mut doc: toml_edit::DocumentMut = text.parse().map_err(|e| format!("{} is not valid TOML ({e}); left untouched", file.display()))?;
    let fresh = !doc.contains_key("projects");
    let projects = doc.as_table_mut().entry("projects").or_insert(toml_edit::table());
    let projects = projects.as_table_mut().ok_or_else(|| format!("{}: projects is not a table; left untouched", file.display()))?;
    if fresh {
        // `[projects."key"]` headers only, the way Codex writes them, never a bare `[projects]`.
        projects.set_implicit(true);
    }
    let mut added = 0;
    for key in &keys {
        let entry = projects.entry(key).or_insert(toml_edit::table());
        let table = entry.as_table_like_mut().ok_or_else(|| format!("{}: projects.{key} is not a table; left untouched", file.display()))?;
        if table.get("trust_level").and_then(|v| v.as_str()) == Some("trusted") {
            continue;
        }
        table.insert("trust_level", toml_edit::value("trusted"));
        added += 1;
    }
    if added > 0 {
        write_whole(file, &doc.to_string())?;
    }
    Ok(added)
}

/// Every folder a launch will use, trusted for `agent` in one write before it starts.
/// ponytail: Claude and Codex; Cursor and Copilot keep their trust in files whose shape no public
/// source describes, so they get nothing and their own prompt stays with the user (DT-C17).
pub fn trust_folders(claude_config: &Path, agent: &str, paths: &[PathBuf]) -> Result<usize, String> {
    match agent {
        "claude" => trust_claude(claude_config, paths),
        "codex" => trust_codex(&codex_config_file(), paths),
        _ => Ok(0),
    }
}

/// SAFE-023 (T-443): the folders of `paths` that are worktrees Kolux made itself (it keeps a record
/// of each one it creates). Any other folder, the project's own main checkout included, is never
/// trusted ahead of time and keeps the agent's own trust prompt.
pub fn made_by_kolux(store: &std::sync::Mutex<crate::state::Store>, paths: &[PathBuf]) -> Vec<PathBuf> {
    let Ok(store) = store.lock() else { return Vec::new() };
    paths.iter().filter(|p| crate::projects::origin(&store, &p.to_string_lossy()).is_some()).cloned().collect()
}

/// The window's pre-trust before a launch: only the Kolux-made worktrees among `paths` are trusted.
#[tauri::command]
pub fn trust_folders_cmd(store: tauri::State<'_, std::sync::Mutex<crate::state::Store>>, agent: String, paths: Vec<String>) -> Result<usize, String> {
    let paths: Vec<PathBuf> = paths.into_iter().map(PathBuf::from).collect();
    trust_folders(&claude_config_file(), &agent, &made_by_kolux(&store, &paths))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp(tag: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("kolux-rs-trust-{tag}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&d);
        std::fs::create_dir_all(&d).unwrap();
        d
    }

    #[test]
    fn new_folders_are_trusted_once_and_everything_else_is_kept() {
        let d = temp("keep");
        let (a, b) = (d.join("MixedCase"), d.join("other"));
        std::fs::create_dir_all(&a).unwrap();
        std::fs::create_dir_all(&b).unwrap();
        let file = d.join(".claude.json");
        std::fs::write(&file, r#"{"userID":"u1","projects":{"G:/Elsewhere":{"hasTrustDialogAccepted":true,"allowedTools":["Bash"]}}}"#).unwrap();
        let lower = PathBuf::from(a.to_string_lossy().to_lowercase());
        assert_eq!(trust_claude(&file, &[lower.clone(), b.clone(), a.clone()]).unwrap(), 2, "the same folder twice counts once");
        let doc: Value = serde_json::from_str(&std::fs::read_to_string(&file).unwrap()).unwrap();
        let key = claude_key(&a).unwrap();
        assert!(!key.contains('\\') && !key.starts_with(r"\\?\"), "{key}");
        assert!(key.ends_with("/MixedCase"), "{key}");
        assert_eq!(doc["projects"][&key]["hasTrustDialogAccepted"], true);
        assert_eq!(doc["projects"][claude_key(&b).unwrap()]["hasTrustDialogAccepted"], true);
        assert_eq!(doc["projects"]["G:/Elsewhere"]["allowedTools"], json!(["Bash"]));
        assert_eq!(doc["userID"], "u1");
        // SAFE-023: trusting again changes nothing at all.
        let before = std::fs::read(&file).unwrap();
        assert_eq!(trust_claude(&file, std::slice::from_ref(&a)).unwrap(), 0);
        assert_eq!(std::fs::read(&file).unwrap(), before);
        // A folder whose entry exists without the flag gets only the flag.
        let mut doc = doc;
        doc["projects"][claude_key(&b).unwrap()] = json!({ "allowedTools": ["Read"] });
        std::fs::write(&file, doc.to_string()).unwrap();
        assert_eq!(trust_claude(&file, std::slice::from_ref(&b)).unwrap(), 1);
        let doc: Value = serde_json::from_str(&std::fs::read_to_string(&file).unwrap()).unwrap();
        assert_eq!(doc["projects"][claude_key(&b).unwrap()], json!({ "allowedTools": ["Read"], "hasTrustDialogAccepted": true }));
        assert_eq!(trust_folders(&file, "copilot", std::slice::from_ref(&a)).unwrap(), 0, "other agents: nothing yet");
        let _ = std::fs::remove_dir_all(&d);
    }

    #[test]
    fn a_missing_file_is_made_and_a_broken_one_is_left_alone() {
        let d = temp("files");
        let a = d.join("wt");
        std::fs::create_dir_all(&a).unwrap();
        let missing = d.join("none").join(".claude.json");
        assert_eq!(trust_claude(&missing, std::slice::from_ref(&a)).unwrap(), 1);
        let doc: Value = serde_json::from_str(&std::fs::read_to_string(&missing).unwrap()).unwrap();
        assert_eq!(doc["projects"][claude_key(&a).unwrap()]["hasTrustDialogAccepted"], true);
        let broken = d.join(".claude.json");
        std::fs::write(&broken, "{not json").unwrap();
        assert!(trust_claude(&broken, std::slice::from_ref(&a)).unwrap_err().contains("untouched"));
        assert_eq!(std::fs::read_to_string(&broken).unwrap(), "{not json");
        let _ = std::fs::remove_dir_all(&d);
    }

    #[test]
    fn the_batch_is_capped_before_any_path_is_worked_out() {
        let d = temp("cap");
        let file = d.join(".claude.json");
        let many: Vec<PathBuf> = (0..13).map(|i| d.join(format!("nowhere-{i}"))).collect();
        assert!(trust_claude(&file, &many).unwrap_err().contains("12"));
        assert!(trust_claude(&file, &[]).unwrap_err().contains("no folders"));
        assert!(!file.exists(), "a refused batch writes nothing");
        assert!(trust_claude(&file, &many[..1]).unwrap_err().contains("nowhere-0"), "a folder that does not exist cannot be trusted");
        let _ = std::fs::remove_dir_all(&d);
    }

    #[test]
    fn codex_entries_are_added_under_projects_and_the_rest_of_the_file_is_kept() {
        let d = temp("codex");
        let a = d.join("Repo");
        std::fs::create_dir_all(&a).unwrap();
        let file = d.join("config.toml");
        let given = "model = \"gpt\"\n\n[desktop]\nx = 1\n\n[projects.'g:\\other']\ntrust_level = \"trusted\"\n";
        std::fs::write(&file, given).unwrap();
        assert_eq!(trust_codex(&file, &[a.clone(), a.clone()]).unwrap(), 1, "the same folder twice counts once");
        let text = std::fs::read_to_string(&file).unwrap();
        assert!(text.starts_with(given), "{text}");
        let key = codex_key(&a).unwrap();
        assert!(!key.starts_with(r"\\?\") && key.ends_with("repo") == cfg!(windows), "{key}");
        let doc: toml_edit::DocumentMut = text.parse().unwrap();
        assert_eq!(doc["projects"][key.as_str()]["trust_level"].as_str(), Some("trusted"));
        assert_eq!(doc["projects"]["g:\\other"]["trust_level"].as_str(), Some("trusted"));
        // Trusting again changes nothing at all.
        let before = std::fs::read(&file).unwrap();
        assert_eq!(trust_codex(&file, std::slice::from_ref(&a)).unwrap(), 0);
        assert_eq!(std::fs::read(&file).unwrap(), before);
        assert_eq!(trust_folders(&file, "cursor", std::slice::from_ref(&a)).unwrap(), 0, "other agents: nothing yet");
        // A missing file is made; a broken one is left alone.
        let missing = d.join("none").join("config.toml");
        assert_eq!(trust_codex(&missing, std::slice::from_ref(&a)).unwrap(), 1);
        let doc: toml_edit::DocumentMut = std::fs::read_to_string(&missing).unwrap().parse().unwrap();
        assert_eq!(doc["projects"][key.as_str()]["trust_level"].as_str(), Some("trusted"));
        std::fs::write(&file, "[broken").unwrap();
        assert!(trust_codex(&file, std::slice::from_ref(&a)).unwrap_err().contains("untouched"));
        assert_eq!(std::fs::read_to_string(&file).unwrap(), "[broken");
        let _ = std::fs::remove_dir_all(&d);
    }

    #[test]
    fn t443_only_worktrees_kolux_made_are_trusted_ahead_of_time() {
        let d = temp("made");
        let (made, main, other) = (d.join("wt-made"), d.join("main"), d.join("elsewhere"));
        for f in [&made, &main, &other] {
            std::fs::create_dir_all(f).unwrap();
        }
        let store = std::sync::Mutex::new(crate::state::Store::open(&d.join("profile")).unwrap());
        crate::projects::set_origin(&store.lock().unwrap(), &made.to_string_lossy(), Some(&json!({ "madeBy": "app" }))).unwrap();
        let picked = made_by_kolux(&store, &[made.clone(), main.clone(), other.clone()]);
        assert_eq!(picked, vec![made.clone()], "the main checkout and a folder made elsewhere are left out");
        let file = d.join(".claude.json");
        assert_eq!(trust_folders(&file, "claude", &picked).unwrap(), 1);
        let doc: Value = serde_json::from_str(&std::fs::read_to_string(&file).unwrap()).unwrap();
        assert_eq!(doc["projects"][claude_key(&made).unwrap()]["hasTrustDialogAccepted"], true);
        assert!(doc["projects"].get(claude_key(&main).unwrap()).is_none());
        assert!(doc["projects"].get(claude_key(&other).unwrap()).is_none());
        drop(store);
        let _ = std::fs::remove_dir_all(&d);
    }
}
