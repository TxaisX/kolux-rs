//! SAFE-023 / SAFE-024: a new worktree is marked trusted in the agent's own configuration before
//! the agent starts, so its first prompt is never swallowed by a folder-trust menu.

use serde_json::{json, Value};
use std::path::{Path, PathBuf};
use std::sync::Mutex;

/// At most this many folders per launch (SAFE-024).
pub const MAX_PER_LAUNCH: usize = 12;

/// Writes happen one after another, so no mark can be lost to a sibling's rewrite.
static WRITE: Mutex<()> = Mutex::new(());

/// Claude Code's user configuration: `.claude.json` under `CLAUDE_CONFIG_DIR`, else the home folder.
pub fn claude_config_file() -> PathBuf {
    std::env::var("CLAUDE_CONFIG_DIR")
        .ok()
        .filter(|d| !d.trim().is_empty())
        .or_else(|| std::env::var(if cfg!(windows) { "USERPROFILE" } else { "HOME" }).ok())
        .map(PathBuf::from)
        .unwrap_or_else(std::env::temp_dir)
        .join(".claude.json")
}

/// Claude's key for a folder: the real path on disk (letter case included) with forward slashes,
/// because Claude ignores an entry written with backslashes (SAFE-023).
pub fn claude_key(path: &Path) -> Result<String, String> {
    let real = path.canonicalize().map_err(|e| format!("{}: {e}", path.display()))?;
    let s = real.to_string_lossy();
    Ok(s.strip_prefix(r"\\?\").unwrap_or(&s).replace('\\', "/"))
}

/// Marks `paths` trusted in Claude's configuration `file` and says how many were new. A file
/// that cannot be parsed is left alone; nothing is written when every folder was trusted already.
pub fn trust_claude(file: &Path, paths: &[PathBuf]) -> Result<usize, String> {
    if paths.is_empty() {
        return Err("no folders to trust".into());
    }
    if paths.len() > MAX_PER_LAUNCH {
        return Err(format!("at most {MAX_PER_LAUNCH} folders can be trusted per launch, not {}", paths.len()));
    }
    let mut keys = paths.iter().map(|p| claude_key(p)).collect::<Result<Vec<_>, _>>()?;
    keys.sort();
    keys.dedup();
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
        // Whole file at once, then a rename: a crash mid-write can never leave Claude half a file.
        let text = serde_json::to_string_pretty(&doc).map_err(|e| e.to_string())?;
        if let Some(parent) = file.parent() {
            std::fs::create_dir_all(parent).map_err(|e| format!("{}: {e}", parent.display()))?;
        }
        let tmp = file.with_extension("json.kolux-tmp");
        std::fs::write(&tmp, text).map_err(|e| format!("{}: {e}", tmp.display()))?;
        std::fs::rename(&tmp, file).map_err(|e| format!("{}: {e}", file.display()))?;
    }
    Ok(added)
}

/// Every folder a launch will use, trusted for `agent` in one write before it starts.
/// ponytail: Claude only; Codex, Cursor and Copilot write their own files (T-017-b).
pub fn trust_folders(claude_config: &Path, agent: &str, paths: &[PathBuf]) -> Result<usize, String> {
    match agent {
        "claude" => trust_claude(claude_config, paths),
        _ => Ok(0),
    }
}

#[tauri::command]
pub fn trust_folders_cmd(agent: String, paths: Vec<String>) -> Result<usize, String> {
    trust_folders(&claude_config_file(), &agent, &paths.into_iter().map(PathBuf::from).collect::<Vec<_>>())
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
        assert_eq!(trust_folders(&file, "codex", std::slice::from_ref(&a)).unwrap(), 0, "other agents: nothing yet");
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
}
