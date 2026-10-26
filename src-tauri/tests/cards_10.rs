//! spec/10 P0 boxes SAFE-023, SAFE-024 (folder trust) and the status half of SAFE-001 (plan review button).
//! Every trust file lives under the scratch root G:\Temp\cards-v3\; nothing here touches a real agent home.

use kolux_rs_lib::status::{report, Agent};
use kolux_rs_lib::trust::{claude_config_file, claude_key, trust_folders};
use serde_json::{json, Value};
use std::path::{Path, PathBuf};

const ROOT: &str = r"G:\Temp\cards-v3";

fn norm(p: &Path) -> String {
    p.to_string_lossy().replace('\\', "/").to_lowercase()
}

/// A fresh folder under the scratch root; refuses to run when the agent homes are not redirected there.
fn scratch(tag: &str) -> PathBuf {
    for var in ["CLAUDE_CONFIG_DIR", "CODEX_HOME", "USERPROFILE", "HOME"] {
        let v = std::env::var(var).unwrap_or_default();
        assert!(norm(Path::new(&v)).starts_with(&norm(Path::new(ROOT))), "{var} must point under {ROOT}, not {v}");
    }
    let d = Path::new(ROOT).join("safe10").join(format!("{tag}-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&d);
    std::fs::create_dir_all(&d).unwrap();
    std::fs::write(d.join(".kolux-rs-scratch"), "").unwrap();
    d
}

fn folders(dir: &Path, names: &[&str]) -> Vec<PathBuf> {
    names
        .iter()
        .map(|n| {
            let p = dir.join(n);
            std::fs::create_dir_all(&p).unwrap();
            p
        })
        .collect()
}

fn doc(file: &Path) -> Value {
    serde_json::from_str(&std::fs::read_to_string(file).unwrap()).unwrap()
}

#[test]
fn safe023_box2_launching_again_in_the_same_folder_leaves_the_trust_file_byte_for_byte_alone() {
    let d = scratch("b2");
    // The path Kolux resolves for Claude's configuration is the redirected one.
    let resolved = claude_config_file();
    assert!(norm(&resolved).starts_with(&norm(Path::new(ROOT))), "{resolved:?} is not under the scratch root");
    assert!(resolved.ends_with(".claude.json"));
    let file = d.join(".claude.json");
    std::fs::write(&file, r#"{"userID":"u1","projects":{"G:/Elsewhere":{"hasTrustDialogAccepted":true,"allowedTools":["Bash"]}}}"#).unwrap();
    let wt = folders(&d, &["Fresh-Worktree"]);

    assert_eq!(trust_folders(&file, "claude", &wt).unwrap(), 1, "first launch records the folder");
    let key = claude_key(&wt[0]).unwrap();
    assert!(key.ends_with("/Fresh-Worktree") && !key.contains('\\'), "{key}");
    assert_eq!(doc(&file)["projects"][&key]["hasTrustDialogAccepted"], true);

    let bytes = std::fs::read(&file).unwrap();
    let stamp = std::fs::metadata(&file).unwrap().modified().unwrap();
    let siblings = std::fs::read_dir(&d).unwrap().count();
    // Second launch, also spelled in lower case and with backslashes: still the same folder.
    let again = [wt[0].clone(), PathBuf::from(wt[0].to_string_lossy().to_lowercase().replace('/', "\\"))];
    assert_eq!(trust_folders(&file, "claude", &again).unwrap(), 0, "nothing new to record");
    assert_eq!(std::fs::read(&file).unwrap(), bytes, "the file's bytes did not change");
    assert_eq!(std::fs::metadata(&file).unwrap().modified().unwrap(), stamp, "the file was not even rewritten");
    assert_eq!(std::fs::read_dir(&d).unwrap().count(), siblings, "no backup or temp file appeared");

    let after = doc(&file);
    assert_eq!(after["projects"].as_object().unwrap().len(), 2, "no duplicate entry");
    assert_eq!(after["projects"]["G:/Elsewhere"]["allowedTools"], json!(["Bash"]), "every other project and setting kept");
    assert_eq!(after["userID"], "u1");
    assert!(norm(&file).starts_with(&norm(Path::new(ROOT))), "the file written lies under the scratch root");
}

#[test]
fn safe024_box1_six_worktrees_are_covered_by_one_call_and_one_write() {
    let d = scratch("b1");
    let file = d.join(".claude.json");
    let wts = folders(&d, &["w1", "w2", "w3", "w4", "w5", "w6"]);
    assert_eq!(trust_folders(&file, "claude", &wts).unwrap(), 6, "one call records all six");
    let projects = doc(&file)["projects"].as_object().unwrap().clone();
    assert_eq!(projects.len(), 6);
    for w in &wts {
        assert_eq!(projects[&claude_key(w).unwrap()]["hasTrustDialogAccepted"], true);
    }
    // One write: the file was made once and nothing was replaced, so no backup of an older version exists.
    let mut names: Vec<String> = std::fs::read_dir(&d).unwrap().map(|e| e.unwrap().file_name().to_string_lossy().to_string()).collect();
    names.sort();
    assert!(names.iter().all(|n| !n.ends_with(".bak-kolux")), "{names:?}");
    assert!(norm(&file).starts_with(&norm(Path::new(ROOT))), "the file written lies under the scratch root");
}

#[test]
fn safe024_box2_thirteen_folders_are_refused_before_any_path_is_worked_out() {
    let d = scratch("b2cap");
    let file = d.join(".claude.json");
    // None of these exist: working a path out would fail with that path's name in the error.
    let thirteen: Vec<PathBuf> = (0..13).map(|i| d.join(format!("never-made-{i}"))).collect();
    let err = trust_folders(&file, "claude", &thirteen).unwrap_err();
    assert!(err.contains("12") && err.contains("13"), "{err}");
    assert!(!err.contains("never-made"), "no folder path was looked at: {err}");
    assert!(!file.exists(), "a refused batch writes nothing");
    // Twelve is the most that goes through.
    let twelve = folders(&d, &["a", "b", "c", "d", "e", "f", "g", "h", "i", "j", "k", "l"]);
    assert_eq!(trust_folders(&file, "claude", &twelve).unwrap(), 12);
    assert!(norm(&file).starts_with(&norm(Path::new(ROOT))), "the file written lies under the scratch root");
}

fn status(pane: u32, j: &str) -> Value {
    let event: Value = serde_json::from_str(j).unwrap();
    serde_json::to_value(report(pane, None, Agent::Claude, &event).expect("the event changes the pane's state")).unwrap()
}

const PROMPT: &str = r#"{"hook_event_name":"UserPromptSubmit","prompt":"plan the refactor"}"#;

#[test]
fn safe001_box1_the_status_carries_the_plan_while_claude_waits_and_drops_it_once_it_is_approved() {
    let plan = "# Plan\n\n1. Read the code\n2. Fix it";
    let pre = |name: &str| json!({ "hook_event_name": name, "tool_name": "ExitPlanMode", "tool_input": { "plan": plan } }).to_string();
    // Either event on its own is enough: the PreToolUse path ...
    let first = 9_110_001;
    status(first, PROMPT);
    let w = status(first, &pre("PreToolUse"));
    assert_eq!((w["state"].as_str(), w["tool"].as_str(), w["plan"].as_str()), (Some("waiting"), Some("ExitPlanMode"), Some(plan)));
    // ... and the PermissionRequest path.
    let second = 9_110_002;
    status(second, PROMPT);
    let p = status(second, &pre("PermissionRequest"));
    assert_eq!((p["state"].as_str(), p["tool"].as_str(), p["plan"].as_str()), (Some("permission"), Some("ExitPlanMode"), Some(plan)));
    // Approved in the terminal instead: Claude finishes the exit-plan step, the pane is working and the plan is gone.
    let done = status(second, r#"{"hook_event_name":"PostToolUse","tool_name":"ExitPlanMode"}"#);
    assert_eq!(done["state"], "working");
    assert!(done.get("plan").is_none_or(|v| v.is_null()), "{done}");
}

#[test]
fn safe001_box2_a_shell_permission_carries_no_plan() {
    let pane = 9_110_003;
    status(pane, PROMPT);
    let s = status(pane, r#"{"hook_event_name":"PermissionRequest","tool_name":"Bash","tool_input":{"command":"rm -rf build","plan":"smuggled"}}"#);
    assert_eq!((s["state"].as_str(), s["tool"].as_str()), (Some("permission"), Some("Bash")));
    assert!(s.get("plan").is_none_or(|v| v.is_null()), "{s}");
}
