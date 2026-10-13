use super::super::{install_claude_hooks, install_codex_hooks, is_mine, write_script, CLAUDE_EVENTS};
use super::*;
use serde_json::json;

fn ev(j: &str) -> Value {
    serde_json::from_str(j).unwrap()
}

fn temp(name: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!("kolux-rs-agent-hooks-{name}-{}", std::process::id()));
    let _ = fs::remove_dir_all(&dir);
    fs::create_dir_all(&dir).unwrap();
    dir
}

const MINE: &str = "\"C:/Users/me/.kolux-rs/agent-hooks/claude.cmd\" || exit 0";

#[test]
fn stat_004_hooks_go_only_to_found_agents_and_leave_switched_off_ones() {
    let ids = |v: &[&str]| v.iter().map(|s| s.to_string()).collect::<Vec<_>>();
    let none = json!({});
    assert_eq!(plan(&none, &ids(&["claude"]), true), vec![("claude", Plan::Install), ("codex", Plan::Leave)], "only Claude Code installed: only it gains hooks");
    let off = json!({ "disabledAgents": ["codex"] });
    assert_eq!(plan(&off, &ids(&["claude", "codex"]), true), vec![("claude", Plan::Install), ("codex", Plan::Remove)], "a switched-off agent has its hooks taken out");
    assert_eq!(plan(&off, &[], false), vec![("claude", Plan::Leave), ("codex", Plan::Remove)], "detection failed: nothing installed, nothing removed for being unfound");
    // A program the user set on the Agents page counts as found.
    let exe = std::env::current_exe().unwrap();
    let set = json!({ "agentOptions": { "codex": { "command": format!(" \"{}\" ", exe.display()) } } });
    assert_eq!(plan(&set, &[], true)[1], ("codex", Plan::Install));
    let gone = json!({ "agentOptions": { "codex": { "command": "C:/nowhere/codex.exe" } } });
    assert_eq!(plan(&gone, &[], true)[1], ("codex", Plan::Leave));
}

#[test]
fn stat_005_kolux_entries_are_spotted_in_every_form() {
    assert!(names_mine(&json!({ "type": "command", "command": MINE })));
    assert!(names_mine(&json!({ "command": ["C:\\Users\\me\\.kolux-rs\\agent-hooks\\claude.cmd"] })), "the command as a list of words");
    assert!(names_mine(&json!({ "command": "cmd.exe", "args": ["/c", "C:/Users/me/.kolux-rs/agent-hooks/claude.cmd"] })), "the argument-list form");
    assert!(!names_mine(&json!({ "command": "node guard.js", "args": ["--fast"] })));
    assert!(!names_mine(&json!({ "command": "C:/Users/me/.kolux/agent-hooks/claude-hook.cmd" })), "the old app's entries stay its own while both apps are installed (DT-C1)");
}

#[test]
fn stat_005_a_user_hook_beside_kolux_in_one_group_survives_and_leftovers_are_cleared() {
    let mut s = ev(&format!(
        r#"{{"model":"opus","hooks":{{
        "PreToolUse":[{{"matcher":"*","hooks":[{{"type":"command","command":"node mine.js"}},{{"type":"command","command":{m}}}]}}],
        "PreCompact":[{{"hooks":[{{"type":"command","command":{m}}}]}}],
        "Setup":[{{"hooks":[{{"type":"command","command":"setup.cmd"}},{{"type":"command","command":{m}}}]}}]}}}}"#,
        m = json!(MINE)
    ));
    assert!(install_claude_hooks(&mut s, MINE));
    let hooks = s["hooks"].as_object().unwrap();
    let pre = hooks["PreToolUse"].as_array().unwrap();
    assert_eq!(pre.iter().filter(|g| is_mine(g)).count(), 1, "exactly one Kolux entry");
    assert!(pre.iter().any(|g| g["hooks"] == json!([{ "type": "command", "command": "node mine.js" }])), "the user's hook nested beside Kolux's stays: {pre:?}");
    assert!(!hooks.contains_key("PreCompact"), "a leftover Kolux entry under an event Kolux no longer uses is cleared");
    assert_eq!(hooks["Setup"], json!([{ "hooks": [{ "type": "command", "command": "setup.cmd" }] }]), "only Kolux's part of a user group goes");
    assert!(!install_claude_hooks(&mut s, MINE), "a second install changes nothing");
    for e in CLAUDE_EVENTS {
        assert_eq!(s["hooks"][e].as_array().unwrap().iter().filter(|g| is_mine(g)).count(), 1, "{e}");
    }
    let mut c = json!({ "hooks": { "Stop": [{ "hooks": [{ "command": "notify.cmd" }, { "command": "C:\\Users\\me\\.kolux-rs\\agent-hooks\\codex.cmd" }] }] } });
    install_codex_hooks(&mut c, "\"C:\\Users\\me\\.kolux-rs\\agent-hooks\\codex.cmd\"");
    assert!(c["hooks"]["Stop"].as_array().unwrap().iter().any(|g| g["hooks"] == json!([{ "command": "notify.cmd" }])));
}

#[test]
fn stat_005_removal_gives_back_the_users_file() {
    let dir = temp("remove");
    let file = dir.join("settings.json");
    let prev = dir.join("prev.sh");
    let user = "{\n    \"model\": \"opus\",\n    \"statusLine\": {\n        \"type\": \"command\",\n        \"command\": \"my-line.sh\",\n        \"padding\": 1\n    },\n    \"hooks\": {\n        \"Stop\": [\n            {\n                \"hooks\": [\n                    {\n                        \"type\": \"command\",\n                        \"command\": \"notify.cmd\"\n                    }\n                ]\n            }\n        ]\n    }\n}\n";
    fs::write(&file, user).unwrap();
    let status = "k=x; \"C:/Users/me/.kolux-rs/agent-hooks/claude-status.cmd\" <\"$k\"";
    let (changed, displaced) = install_claude(&file, MINE, status).unwrap();
    assert!(changed && displaced.as_deref() == Some("my-line.sh"));
    fs::write(&prev, "my-line.sh\n").unwrap();
    assert!(remove_claude(&file, &prev).unwrap());
    assert_eq!(fs::read_to_string(&file).unwrap(), user, "hooks, status line, key order and four-space layout all as the user had them");
    assert!(!prev.exists());
    assert!(!remove_claude(&file, &prev).unwrap(), "nothing of Kolux's left to take out");
    // Kolux made the whole hooks object and status line: both go.
    fs::write(&file, "{\"model\":\"opus\"}").unwrap();
    install_claude(&file, MINE, status).unwrap();
    remove_claude(&file, &prev).unwrap();
    assert_eq!(ev(&fs::read_to_string(&file).unwrap()), json!({ "model": "opus" }));
    // An unreadable file is reported and never rewritten.
    fs::write(&file, "{ not json").unwrap();
    assert!(remove_claude(&file, &prev).unwrap_err().contains("left alone"));
    assert_eq!(fs::read_to_string(&file).unwrap(), "{ not json");
    // Codex: Kolux's groups go, the user's stay.
    fs::write(dir.join("hooks.json"), r#"{"hooks":{"Stop":[{"hooks":[{"command":"notify.cmd"}]},{"hooks":[{"command":"\"C:\\Users\\me\\.kolux-rs\\agent-hooks\\codex.cmd\""}]}],"SessionStart":[{"hooks":[{"command":"\"C:\\Users\\me\\.kolux-rs\\agent-hooks\\codex.cmd\""}]}]}}"#).unwrap();
    assert!(remove_codex(&dir).unwrap());
    assert_eq!(ev(&fs::read_to_string(dir.join("hooks.json")).unwrap()), json!({ "hooks": { "Stop": [{ "hooks": [{ "command": "notify.cmd" }] }] } }));
}

#[test]
fn claude_settings_are_copied_once_before_the_first_install() {
    let dir = temp("backup");
    let file = dir.join("settings.json");
    back_up(&file).unwrap();
    assert!(!backup_of(&file).exists(), "no file, nothing to keep");
    fs::write(&file, "{\"model\":\"opus\"}").unwrap();
    back_up(&file).unwrap();
    assert_eq!(backup_of(&file), dir.join("settings.json.bak-kolux"));
    assert_eq!(fs::read_to_string(backup_of(&file)).unwrap(), "{\"model\":\"opus\"}");
    fs::write(&file, "{\"model\":\"later\"}").unwrap();
    back_up(&file).unwrap();
    assert_eq!(fs::read_to_string(backup_of(&file)).unwrap(), "{\"model\":\"opus\"}", "the first copy is never replaced");
    // A copy that cannot be made stops the install.
    let folder = dir.join("odd.json");
    fs::create_dir_all(&folder).unwrap();
    assert!(back_up(&folder).unwrap_err().contains("hooks not installed"));
}

#[test]
fn stat_005_one_install_at_a_time_across_processes() {
    let dir = temp("lock");
    let held = Lock::take_within(&dir, Duration::from_secs(30), Duration::ZERO).unwrap();
    assert!(Lock::take_within(&dir, Duration::from_secs(30), Duration::from_millis(250)).is_err(), "a second install waits, then gives up");
    drop(held);
    let again = Lock::take_within(&dir, Duration::from_secs(30), Duration::ZERO).unwrap();
    // A late release never frees a lock another process now holds.
    fs::write(dir.join(LOCK_FILE), "4242 other").unwrap();
    drop(again);
    assert_eq!(fs::read_to_string(dir.join(LOCK_FILE)).unwrap(), "4242 other");
    // A lock left by a crashed install is cleared once stale.
    let after = Lock::take_within(&dir, Duration::ZERO, Duration::from_millis(250)).unwrap();
    drop(after);
    assert!(!dir.join(LOCK_FILE).exists());
}

#[test]
fn stat_005_a_users_file_under_a_kolux_script_name_is_never_overwritten() {
    let home = temp("script");
    let dir = home.join(SCRIPT_DIR);
    fs::create_dir_all(&dir).unwrap();
    fs::write(dir.join("claude.cmd"), "@echo my own\r\n").unwrap();
    assert!(write_script(&home, "claude.cmd", "rem Kolux RS agent hook for x. Written by Kolux RS; edits are overwritten.").unwrap_err().contains("left alone"));
    assert_eq!(fs::read_to_string(dir.join("claude.cmd")).unwrap(), "@echo my own\r\n");
    fs::write(dir.join("codex.cmd"), "rem old. Written by Kolux RS; edits are overwritten.").unwrap();
    write_script(&home, "codex.cmd", "rem new. Written by Kolux RS; edits are overwritten.").unwrap();
    assert!(fs::read_to_string(dir.join("codex.cmd")).unwrap().starts_with("rem new"), "Kolux's own older script is refreshed");
}

#[cfg(unix)]
#[test]
fn stat_005_the_files_permissions_are_kept() {
    use std::os::unix::fs::PermissionsExt;
    let dir = temp("perm");
    let file = dir.join("settings.json");
    fs::write(&file, "{}").unwrap();
    fs::set_permissions(&file, fs::Permissions::from_mode(0o600)).unwrap();
    install_claude(&file, MINE, "x").unwrap();
    assert_eq!(fs::metadata(&file).unwrap().permissions().mode() & 0o777, 0o600);
}
