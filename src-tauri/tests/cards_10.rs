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

// SAFE-009..012: the hook's real answer (hooks::reply_body) fed PreToolUse payloads. Every command
// below is only ever a string handed to the matcher; nothing is run.

use kolux_rs_lib::hooks::reply_body;

fn pre_tool(tool: &str, command: &str) -> Vec<u8> {
    json!({ "hook_event_name": "PreToolUse", "session_id": "cards", "tool_name": tool, "cwd": r"G:\Temp\cards-v3\safe10\work", "tool_input": { "command": command } }).to_string().into_bytes()
}

/// The ask's reason when the hook asks, None when it answers `{}` (no opinion).
fn asks(command: &str, settings: &Value) -> Option<String> {
    let reply = reply_body("/claude", &pre_tool("Bash", command), settings);
    if reply == "{}" {
        return None;
    }
    let v: Value = serde_json::from_str(&reply).unwrap();
    let out = &v["hookSpecificOutput"];
    assert_eq!((out["hookEventName"].as_str(), out["permissionDecision"].as_str()), (Some("PreToolUse"), Some("ask")), "{command}: {reply}");
    Some(out["permissionDecisionReason"].as_str().unwrap().to_string())
}

fn assert_asks(commands: &[&str]) {
    for c in commands {
        assert!(asks(c, &json!({})).is_some(), "should ask: {c}");
    }
}

fn assert_runs(commands: &[&str]) {
    for c in commands {
        assert_eq!(asks(c, &json!({})), None, "should run: {c}");
    }
}

#[test]
fn safe009_box1_force_push_main_asks_with_the_kolux_reason_that_says_it_waits_and_stays_blocked_if_refused() {
    let _d = scratch("safe009a");
    let reason = asks("git push --force origin main", &json!({})).expect("asks");
    assert!(reason.contains("Force-push to main"), "{reason}");
    assert!(reason.contains("waits for you") && reason.contains("refuse to leave it unrun"), "{reason}");
}

#[test]
fn safe009_box2_the_working_tree_status_gets_the_neutral_answer() {
    let _d = scratch("safe009b");
    assert_eq!(reply_body("/claude", &pre_tool("Bash", "git status"), &json!({})), "{}");
}

#[test]
fn safe009_box3_switching_the_matching_rule_off_makes_the_very_next_force_push_neutral() {
    let _d = scratch("safe009c");
    assert!(asks("git push --force origin main", &json!({})).is_some());
    let off = json!({ "protectedOff": ["force-push"] });
    assert_eq!(reply_body("/claude", &pre_tool("Bash", "git push --force origin main"), &off), "{}");
}

#[test]
fn safe009_box4_a_garbled_hook_body_gets_the_neutral_answer() {
    let _d = scratch("safe009d");
    for body in [&b"not json {"[..], b"", b"{\"hook_event_name\":\"PreToolUse\",\"tool_name\":\"Bash\"", b"hook_event_name=PreToolUse&tool_name=%"] {
        assert_eq!(reply_body("/claude", body, &json!({})), "{}", "{}", String::from_utf8_lossy(body));
    }
}

#[test]
fn safe010_box1_plain_force_pushes_and_a_delete_of_main_ask() {
    let _d = scratch("safe010a");
    assert_asks(&["git push -f", "git push origin :main", "git push --force origin main"]);
}

#[test]
fn safe010_box2_the_at_sign_shorthand_for_the_current_branch_asks() {
    let _d = scratch("safe010b");
    assert_asks(&["git push -f origin @:main", "git push --force origin @"]);
}

#[test]
fn safe010_box3_feature_branch_force_pushes_and_ordinary_pushes_run() {
    let _d = scratch("safe010c");
    assert_runs(&["git push --force origin feature/login", "git push -f origin my-feature", "git push origin main", "git push origin @"]);
}

#[test]
fn safe010_box4_hard_reset_and_forced_clean_ask_soft_reset_and_dry_run_run() {
    let _d = scratch("safe010d");
    assert_asks(&["git reset --hard", "git clean -fdx"]);
    assert_runs(&["git reset --soft HEAD~1", "git clean -n"]);
}

#[test]
fn safe011_box1_database_clients_given_a_drop_or_truncate_ask() {
    let _d = scratch("safe011a");
    assert_asks(&[
        r#"psql -c "DROP TABLE users""#,
        r#"echo "TRUNCATE TABLE users;" | psql"#,
        "dropdb myapp_production",
        "dropdb production",
    ]);
}

#[test]
fn safe011_box2_the_same_words_in_a_commit_message_or_a_text_search_run() {
    let _d = scratch("safe011b");
    assert_runs(&[r#"git commit -m "drop table users""#, r#"git commit -m "migration: drop table legacy_users""#, "grep -rn \"drop table\" migrations/", "rg -i 'drop table' migrations"]);
}

#[test]
fn safe012_box1_stripe_changes_ask_listening_and_listing_and_a_key_prefix_search_run() {
    let _d = scratch("safe012a");
    assert_asks(&["stripe subscriptions cancel sub_123", "stripe subscriptions cancel sub_123 --live"]);
    assert_runs(&["stripe listen", "stripe customers list", "grep -rn \"sk_live_\" src/"]);
}

#[test]
fn safe012_box2_terraform_apply_and_cdk_deploy_ask_terraform_plan_runs() {
    let _d = scratch("safe012b");
    assert_asks(&["terraform apply -auto-approve", "npx cdk deploy"]);
    assert_runs(&["terraform plan"]);
}

#[test]
fn safe012_box3_production_deploys_ask_a_deploy_without_the_flag_and_a_production_install_run() {
    let _d = scratch("safe012c");
    assert_asks(&["vercel --prod", "wrangler deploy --env production"]);
    assert_runs(&["vercel deploy", "npm install --production"]);
}

// SAFE-013 / SAFE-014 / SAFE-019 (batch 3). The cwd is a made-up workspace outside every temp root; nothing is touched on disk.
const WORK: &str = r"G:\Dev\fakeproj\app";

/// The machine's TEMP is G:\Temp, which holds the scratch home the safety rule forces; point the temp roots elsewhere (as text only, never created) so home is not mistaken for a temp folder.
fn temp_roots_elsewhere() {
    static ONCE: std::sync::Once = std::sync::Once::new();
    ONCE.call_once(|| {
        for k in ["TEMP", "TMP", "TMPDIR"] {
            std::env::set_var(k, r"G:\Temp\cards-v3-temp-roots");
        }
    });
}

fn asks_in(tool: &str, command: &str) -> Option<String> {
    temp_roots_elsewhere();
    let body = json!({ "hook_event_name": "PreToolUse", "session_id": "cards", "tool_name": tool, "cwd": WORK, "tool_input": { "command": command } }).to_string();
    let reply = reply_body("/claude", body.as_bytes(), &json!({}));
    if reply == "{}" {
        return None;
    }
    let v: Value = serde_json::from_str(&reply).unwrap();
    assert_eq!(v["hookSpecificOutput"]["permissionDecision"], "ask", "{command}: {reply}");
    Some(v["hookSpecificOutput"]["permissionDecisionReason"].as_str().unwrap().to_string())
}

fn must_ask(tool: &str, commands: &[&str], rule: &str) {
    for c in commands {
        let why = asks_in(tool, c).unwrap_or_else(|| panic!("should ask: {c}"));
        assert!(why.contains(rule), "{c}: names {rule}: {why}");
    }
}

fn must_run(tool: &str, commands: &[&str]) {
    for c in commands {
        assert_eq!(asks_in(tool, c), None, "should run: {c}");
    }
}

const OUTSIDE: &str = "Deleting folders outside the workspace";

#[test]
fn safe013_box1_root_documents_parent_here_git_folder_and_a_shell_variable_each_ask() {
    let _d = scratch("safe013a");
    must_ask("Bash", &["rm -rf /", r"rm -rf C:\Users\someone\Documents\old", "rm -rf ~/Documents/old", "rm -rf ..", "rm -rf .", "rm -rf .git", "rm -rf $TARGET"], OUTSIDE);
}

#[test]
fn safe013_box2_cd_to_home_bare_cd_popd_and_find_into_xargs_each_ask() {
    let _d = scratch("safe013b");
    must_ask("Bash", &["cd $HOME && rm -rf build", "cd && rm -rf build", "popd && rm -rf build", "find . -name node_modules | xargs rm -rf"], OUTSIDE);
}

#[test]
fn safe013_box3_remove_item_on_home_a_piped_listing_and_rd_on_documents_each_ask() {
    let _d = scratch("safe013c");
    must_ask("PowerShell", &[r"Remove-Item -Recurse -Force C:\Users\someone", "Get-ChildItem build | Remove-Item -Recurse", r"rd /s /q C:\Users\someone\Documents"], OUTSIDE);
}

#[test]
fn safe013_box4_deps_and_build_output_inside_the_worktree_and_a_tmp_scratch_folder_run() {
    let _d = scratch("safe013d");
    must_run("Bash", &["rm -rf node_modules dist", "rm -rf build/*", "cd packages/web && rm -rf dist", "rm -rf /tmp/scratch-folder"]);
    must_run("PowerShell", &["rd /s /q node_modules"]);
}

const TF: &str = "terraform apply -auto-approve";

fn utf16_b64(cmd: &str) -> String {
    use base64::Engine;
    base64::engine::general_purpose::STANDARD.encode(cmd.encode_utf16().flat_map(u16::to_le_bytes).collect::<Vec<u8>>())
}

#[test]
fn safe014_box1_bash_c_a_command_substitution_and_cmd_c_wrapping_a_dangerous_command_ask() {
    let _d = scratch("safe014a");
    must_ask("Bash", &["bash -c \"rm -rf /\"", "echo $(rm -rf /)", r"cmd /c rd /s /q C:\Users"], OUTSIDE);
}

#[test]
fn safe014_box2_powershell_switch_values_and_a_base64_command_are_seen_through() {
    let _d = scratch("safe014b");
    let infra = "Infrastructure changes";
    must_ask("Bash", &[
        &format!("powershell -ExecutionPolicy Bypass -Command \"{TF}\""),
        &format!("powershell -ep bypass -Command \"{TF}\""),
        &format!("powershell -WindowStyle Hidden -Command \"{TF}\""),
        &format!("powershell -of text -Command \"{TF}\""),
        &format!("powershell -EncodedCommand {}", utf16_b64(TF)),
    ], infra);
}

#[test]
fn safe014_box3_a_powershell_file_run_then_a_semicolon_then_terraform_apply_asks() {
    let _d = scratch("safe014c");
    must_ask("Bash", &[&format!("powershell -File deploy.ps1; {TF}")], "Infrastructure changes");
}

#[test]
fn safe014_box4_doubled_slash_cmd_and_run_together_switches_on_the_windows_folder_ask() {
    let _d = scratch("safe014d");
    must_ask("Bash", &[r"cmd //c rd /s /q C:\Windows", r"rd /s/q C:\Windows", r"del /q/s C:\Windows\system32\x.dll"], OUTSIDE);
}

#[test]
fn safe014_box5_wrapper_options_and_values_before_rm_on_a_system_folder_ask_and_timeout_length_is_skipped() {
    let _d = scratch("safe014e");
    must_ask("Bash", &["sudo -u root rm -rf /usr", "sudo -uroot rm -rf /usr", "nice -n 10 rm -rf /usr", "env -u NAME rm -rf /usr", "timeout 5 rm -rf /usr"], OUTSIDE);
    must_ask("Bash", &[&format!("timeout 30s {TF}")], "Infrastructure changes");
}

#[test]
fn safe014_box6_harmless_lookalikes_and_text_that_is_only_printed_run() {
    let _d = scratch("safe014f");
    must_run("Bash", &["sudo -u root ls build", "timeout 5 ls", "nice -n 10 echo hi", "powershell -ExecutionPolicy Bypass -Command \"Write-Host hi\"", "rd /s/q build", "echo \"rm -rf /\"", "echo 'rm -rf /'"]);
}

use kolux_rs_lib::protected_custom::{listen, protected_attempts};

/// Pauses `command` through the hook (cwd names the test, so parallel tests keep their rows apart) and returns the kept command text.
fn kept(cwd: &str, call: &str, command: &str) -> String {
    let body = json!({ "hook_event_name": "PreToolUse", "session_id": cwd, "tool_use_id": call, "cwd": cwd, "tool_name": "Bash", "tool_input": { "command": command } }).to_string();
    let reply = listen("/claude", body.as_bytes(), &json!({})).unwrap_or_else(|| panic!("should pause: {command}"));
    assert!(reply.contains("\"ask\""), "{reply}");
    protected_attempts().into_iter().find(|a| a.worktree == cwd).unwrap_or_else(|| panic!("no attempt kept for {command}")).command
}

#[test]
fn safe019_box1_a_live_stripe_key_in_a_paused_command_shows_only_prefix_four_dots_and_last_four() {
    let _d = scratch("safe019a");
    let key = format!("sk_live_{}ab12", "x".repeat(20));
    let shown = kept("G:/Dev/cards-safe019a", "t1", &format!("stripe refunds create --charge ch_1 --api-key {key}"));
    assert!(shown.contains("sk_live_....ab12"), "{shown}");
    assert!(!shown.contains(&key) && !shown.contains("xxxx"), "{shown}");
    let page = serde_json::to_string(&protected_attempts().into_iter().filter(|a| a.worktree == "G:/Dev/cards-safe019a").collect::<Vec<_>>()).unwrap();
    assert!(!page.contains(&key) && !page.contains("xxxx"), "{page}");
}

#[test]
fn safe019_box2_a_mysql_short_password_flag_a_token_flag_and_a_postgres_url_with_credentials_are_masked() {
    let _d = scratch("safe019b");
    let (pw, tok, url_pw) = (format!("pw{}", "q9".repeat(6)), format!("tk{}", "z7".repeat(8)), format!("up{}", "w3".repeat(5)));
    let cases = [
        (format!("mysql -u root -p{pw} -e \"DROP TABLE users\""), pw.clone()),
        (format!("stripe refunds create --charge ch_1 --token {tok}"), tok.clone()),
        (format!("psql postgres://dbadmin:{url_pw}@db.example.com:5432/app -c \"DROP TABLE users\""), url_pw.clone()),
    ];
    for (i, (cmd, secret)) in cases.iter().enumerate() {
        let shown = kept("G:/Dev/cards-safe019b", &format!("c{i}"), cmd);
        assert!(!shown.contains(secret.as_str()), "{secret} leaked: {shown}");
        assert!(shown.contains(kolux_rs_lib::protected::HIDDEN), "marked hidden: {shown}");
    }
    let page = serde_json::to_string(&protected_attempts().into_iter().filter(|a| a.worktree == "G:/Dev/cards-safe019b").collect::<Vec<_>>()).unwrap();
    assert!(cases.iter().all(|(_, s)| !page.contains(s.as_str())), "{page}");
}

#[test]
fn safe015_box1_force_push_switched_off_runs_with_no_prompt_and_switched_on_asks_again() {
    let _d = scratch("safe015a");
    let push = "git push --force origin main";
    let go = |settings: Value| reply_body("/claude", &pre_tool("Bash", push), &settings);
    // The settings the Safety page saves (src/settings/__cards__/SAFE-015.test.ts): off adds the id, on takes it out.
    assert!(go(json!({ "protectedOff": [] })).contains("\"ask\""));
    assert_eq!(go(json!({ "protectedOff": ["force-push"] })), "{}");
    assert!(go(json!({ "protectedOff": [] })).contains("Force-push to main"));
    // Another rule switched off leaves the force-push asking.
    assert!(go(json!({ "protectedOff": ["stripe"] })).contains("\"ask\""));
}

#[test]
fn safe015_box2_master_switch_off_means_no_protected_command_asks() {
    let _d = scratch("safe015b");
    temp_roots_elsewhere();
    let off = json!({ "protectedAsk": false });
    let every_rule = [
        "stripe refunds create --charge ch_1", "git push --force origin main", "dropdb production", "terraform apply -auto-approve",
        "vercel --prod", "rm -rf ~", "git reset --hard",
    ];
    for c in every_rule {
        assert!(reply_body("/claude", &pre_tool("Bash", c), &json!({})).contains("\"ask\""), "asks with the switch on: {c}");
        assert_eq!(reply_body("/claude", &pre_tool("Bash", c), &off), "{}", "master off: {c}");
    }
}
