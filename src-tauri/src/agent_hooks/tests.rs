use super::super::{install_claude, install_claude_hooks, install_codex_hooks, is_mine, write_codex_groups, write_script, CLAUDE_EVENTS, CODEX_EVENTS};
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
    // The status hooks switch is on (T-152-gate: it reads off until saved on).
    let none = json!({ "agentStatusHooks": true });
    assert_eq!(plan(&none, &ids(&["claude"]), true)[..2], [("claude", Plan::Install), ("codex", Plan::Leave)], "only Claude Code installed: only it gains hooks");
    assert_eq!(plan(&none, &ids(&["gemini", "amp"]), true)[2..], [("gemini", Plan::Install), ("antigravity", Plan::Leave), ("amp", Plan::Install)], "T-120-b: the vendors follow the same rule");
    let off = json!({ "agentStatusHooks": true, "disabledAgents": ["codex"] });
    assert_eq!(plan(&off, &ids(&["claude", "codex"]), true)[..2], [("claude", Plan::Install), ("codex", Plan::Remove)], "a switched-off agent has its hooks taken out");
    assert_eq!(plan(&off, &[], false)[..2], [("claude", Plan::Leave), ("codex", Plan::Remove)], "detection failed: nothing installed, nothing removed for being unfound");
    // A program the user set on the Agents page counts as found.
    let exe = std::env::current_exe().unwrap();
    let set = json!({ "agentStatusHooks": true, "agentOptions": { "codex": { "command": format!(" \"{}\" ", exe.display()) } } });
    assert_eq!(plan(&set, &[], true)[1], ("codex", Plan::Install));
    let gone = json!({ "agentStatusHooks": true, "agentOptions": { "codex": { "command": "C:/nowhere/codex.exe" } } });
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
    back_up(&file, &dir.join(BACKUP_RECORD)).unwrap();
    assert!(!backup_of(&file).exists(), "no file, nothing to keep");
    fs::write(&file, "{\"model\":\"opus\"}").unwrap();
    back_up(&file, &dir.join(BACKUP_RECORD)).unwrap();
    assert_eq!(backup_of(&file), dir.join("settings.json.bak-kolux"));
    assert_eq!(fs::read_to_string(backup_of(&file)).unwrap(), "{\"model\":\"opus\"}");
    fs::write(&file, "{\"model\":\"later\"}").unwrap();
    back_up(&file, &dir.join(BACKUP_RECORD)).unwrap();
    assert_eq!(fs::read_to_string(backup_of(&file)).unwrap(), "{\"model\":\"opus\"}", "the first copy is never replaced");
    // A copy that cannot be made stops the install.
    let folder = dir.join("odd.json");
    fs::create_dir_all(&folder).unwrap();
    assert!(back_up(&folder, &dir.join(BACKUP_RECORD)).unwrap_err().contains("hooks not installed"));
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

// ---- T-167-a: STAT-006 / STAT-030 / STAT-037 ----

use super::saved::{self, Row};

fn who(pane: u32) -> String {
    use base64::Engine as _;
    base64::engine::general_purpose::STANDARD.encode(json!({ "paneKey": pane, "terminal": 3, "hookVersion": 1 }).to_string())
}

fn row(pane: u32, state: &str, at: u64, session: Option<&str>) -> Row {
    Row { pane_key: pane, agent: "claude".into(), state: state.into(), at, session_id: session.map(str::to_owned), cwd: None, stop: None }
}

#[test]
fn stat_030_a_damaged_or_older_save_reads_as_empty_and_expired_rows_go() {
    let now = 10 * saved::EXPIRY_MS;
    assert!(saved::parse(None, now).is_empty());
    assert!(saved::parse(Some("{\"version\":1,\"rows\":[{\"paneKey\":"), now).is_empty(), "a save cut off mid-write");
    assert!(saved::parse(Some("[1,2,3]"), now).is_empty());
    assert!(saved::parse(Some(r#"{"version":0,"rows":[{"paneKey":1,"agent":"claude","state":"waiting","at":0}]}"#), now).is_empty(), "another version");
    let fresh = row(1, "waiting", now - 1000, Some("s1"));
    let old = row(2, "working", now - saved::EXPIRY_MS, None);
    assert_eq!(saved::parse(Some(&saved::serialize(&[fresh.clone(), old])), now), vec![fresh], "a row at its expiry is not restored");
}

#[test]
fn stat_006_held_events_are_replayed_in_order_and_broken_lines_skipped() {
    let ask = r#"{"hook_event_name":"PreToolUse","tool_name":"AskUserQuestion","session_id":"s7","cwd":"C:/w/a"}"#;
    let stop = r#"{"hook_event_name":"Stop","session_id":"s7"}"#;
    let text = [
        format!("claude|{}|C:\\cfg|{ask}", who(7)),
        "claude|garbage".to_string(),
        format!("claude|not-base64!|C:\\cfg|{stop}"),
        format!("claude|{}|C:\\cfg|{{\"hook_event_name\":\"Stop\",\"sess", who(8)),
        format!("claude-status|{}|C:\\cfg|{{}}", who(7)),
        String::new(),
        format!("claude|{}||{ask}", who(9)),
    ]
    .join("\r\n");
    let mut rows = vec![row(7, "working", 5, Some("s7")), row(4, "permission", 5, None)];
    assert_eq!(saved::replay(&text, &mut rows, 100), 2, "only whole lines apply");
    assert_eq!((rows[0].state.as_str(), rows[0].cwd.as_deref(), rows[0].at), ("waiting", Some("C:/w/a"), 100));
    assert_eq!(rows[1], row(4, "permission", 5, None), "a pane with nothing held keeps its row");
    assert_eq!((rows[2].pane_key, rows[2].state.as_str()), (9, "waiting"), "a pane with no saved row gains one");
    let later = format!("claude|{}|C:\\cfg|{stop}\n", who(7));
    saved::replay(&later, &mut rows, 200);
    assert_eq!((rows[0].state.as_str(), rows[0].session_id.as_deref()), ("done", Some("s7")), "a turn that finished while Kolux was closed reads done");
}

#[test]
fn stat_037_only_sessions_still_mid_task_are_recorded() {
    let earlier = vec![row(1, "working", 1, Some("a")), row(2, "waiting", 1, Some("b"))];
    let live = vec![row(5, "done", 9, Some("a")), row(6, "working", 9, Some("c")), row(7, "blocked", 9, Some("d")), row(8, "working", 9, None), row(9, "idle", 9, Some("e"))];
    let got = saved::resumable(earlier, live);
    let ids: Vec<_> = got.iter().map(|r| r.session_id.as_deref().unwrap()).collect();
    assert_eq!(ids, ["b", "c", "d"], "a finished session leaves the record; one without a session id cannot be resumed");
}

#[cfg(windows)]
mod script_runs {
    use super::*;
    use std::io::BufReader;
    use std::net::TcpListener;
    use std::process::{Command, Stdio};

    /// Runs the Claude hook script under cmd with delayed expansion ON (as a user's registry can
    /// set it) and only the given Kolux variables, feeding `event` on stdin.
    fn run(dir: &Path, env: &[(&str, String)], event: &str) -> std::process::Output {
        let script = dir.join("claude.cmd");
        fs::write(&script, super::super::super::claude_script()).unwrap();
        let mut cmd = Command::new("cmd");
        cmd.args(["/d", "/v:on", "/c"]).arg(&script).stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::piped());
        for (k, _) in std::env::vars() {
            if k.starts_with("KOLUX_") || k == "CLAUDE_CONFIG_DIR" {
                cmd.env_remove(k);
            }
        }
        cmd.envs(env.iter().map(|(k, v)| (*k, v.as_str())));
        let mut child = cmd.spawn().unwrap();
        child.stdin.take().unwrap().write_all(event.as_bytes()).unwrap();
        child.wait_with_output().unwrap()
    }

    const STOP: &str = r#"{"hook_event_name":"Stop","session_id":"s1","cwd":"C:/w"}"#;

    /// The script itself lives in a plain folder; only the data paths carry the awkward characters.
    fn scripts(name: &str) -> PathBuf {
        temp(&format!("scripts-{name}"))
    }

    #[test]
    fn stat_006_outside_kolux_the_hook_prints_nothing_and_succeeds() {
        let dir = scripts("outside");
        let out = run(&dir, &[], STOP);
        assert!(out.status.success() && out.stdout.is_empty() && out.stderr.is_empty(), "{out:?}");
        // A pane key alone (no identity, no address) is no Kolux pane either.
        let out = run(&dir, &[("KOLUX_PANE_KEY", "4".into())], STOP);
        assert!(out.status.success() && out.stdout.is_empty() && out.stderr.is_empty(), "{out:?}");
    }

    #[test]
    fn stat_006_an_event_kolux_cannot_take_waits_in_the_holding_file() {
        // Paths with every character that breaks a careless batch script.
        let data = temp("held ) & x!");
        let dir = scripts("held");
        let endpoint = data.join(super::super::super::ENDPOINT_FILE);
        let closed = TcpListener::bind("127.0.0.1:0").unwrap().local_addr().unwrap().port();
        fs::write(&endpoint, format!("{closed} tok\n")).unwrap();
        let env = |with_vars: bool| {
            let mut v = vec![("KOLUX_PANE_KEY", "7".to_string()), ("KOLUX_HOOK_IDENTITY", who(7)), ("KOLUX_HOOK_ENDPOINT", endpoint.display().to_string()), ("CLAUDE_CONFIG_DIR", "\"C:\\Users\\me\\cfg dir\\\"".to_string())];
            if with_vars {
                v.extend([("KOLUX_AGENT_HOOK_PORT", closed.to_string()), ("KOLUX_AGENT_HOOK_TOKEN", "tok".to_string())]);
            }
            v
        };
        let started = Instant::now();
        let out = run(&dir, &env(false), r#"{"hook_event_name":"PreToolUse","tool_name":"AskUserQuestion","session_id":"s1"}"#);
        assert!(out.status.success() && out.stdout.is_empty(), "{out:?}");
        assert!(started.elapsed() < Duration::from_secs(5), "a closed Kolux never holds the agent up: {:?}", started.elapsed());
        // Kolux took its endpoint file away as it quit: the pane's own variables name the address.
        fs::remove_file(&endpoint).unwrap();
        let out = run(&dir, &env(true), STOP);
        assert!(out.status.success() && out.stdout.is_empty(), "{out:?}");
        let held = fs::read_to_string(data.join(saved::SPOOL_FILE)).unwrap();
        let lines: Vec<_> = held.lines().filter(|l| !l.is_empty()).collect();
        assert_eq!(lines.len(), 2, "{held:?}");
        assert!(lines[0].starts_with(&format!("claude|{}|C:\\Users\\me\\cfg dir|{{", who(7))), "quotes and the trailing backslash are gone: {}", lines[0]);
        let mut rows = Vec::new();
        assert_eq!(saved::replay(&held, &mut rows, 1), 2);
        assert_eq!((rows[0].pane_key, rows[0].state.as_str()), (7, "done"));
        let leftovers = fs::read_dir(std::env::temp_dir()).unwrap().flatten().filter(|e| e.file_name().to_string_lossy().starts_with("kolux-rs-hook-7-")).count();
        assert_eq!(leftovers, 0, "the script's own temporary files are removed");
    }

    #[test]
    fn stat_006_a_running_kolux_gets_the_event_from_the_endpoint_file_alone() {
        let data = temp("live ) & y!");
        let dir = scripts("live");
        let endpoint = data.join(super::super::super::ENDPOINT_FILE);
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        fs::write(&endpoint, format!("{} sekrit\n", listener.local_addr().unwrap().port())).unwrap();
        let got = std::thread::spawn(move || {
            let (mut s, _) = listener.accept().unwrap();
            let req = super::super::super::parse_request(&mut BufReader::new(&s)).unwrap();
            let _ = write!(s, "HTTP/1.1 200 OK\r\nContent-Length: 2\r\nConnection: close\r\n\r\n{{}}");
            req
        });
        // An agent that strips the token variables: only the pane key, identity and endpoint file.
        let env = [("KOLUX_PANE_KEY", "7".to_string()), ("KOLUX_HOOK_IDENTITY", who(7)), ("KOLUX_HOOK_ENDPOINT", endpoint.display().to_string()), ("CLAUDE_CONFIG_DIR", "C:\\cfg!\\".to_string())];
        let out = run(&dir, &env, STOP);
        // SAFE-009: the Claude script hands Kolux's answer back to Claude on stdout.
        assert!(out.status.success() && out.stdout == b"{}", "{out:?}");
        let req = got.join().unwrap();
        assert_eq!(req.path, "/claude");
        assert_eq!(req.headers.get("x-kolux-token").map(String::as_str), Some("sekrit"));
        assert_eq!(req.headers.get("x-kolux-config").map(String::as_str), Some("C:\\cfg!"));
        assert_eq!(ev(String::from_utf8_lossy(&req.body).trim()), ev(STOP));
        assert!(!data.join(saved::SPOOL_FILE).exists(), "nothing is held once delivered");
    }
}

// ---- T-120-a: STAT-002 / STAT-003 ----

#[test]
fn stat_002_the_switch_off_takes_every_agent_out_and_off_is_the_default() {
    let ids = |v: &[&str]| v.iter().map(|s| s.to_string()).collect::<Vec<_>>();
    let found = ids(&["claude", "codex"]);
    assert!(!switch::on(&json!({})) && !switch::on(&json!({ "agentStatusHooks": "garbage" })), "never saved, or unreadable, reads as off (T-152-gate)");
    let off = json!({ "agentStatusHooks": false });
    assert!(!switch::on(&off));
    assert_eq!(plan(&off, &found, true)[..2], [("claude", Plan::Remove), ("codex", Plan::Remove)]);
    assert_eq!(plan(&off, &[], false)[..2], [("claude", Plan::Remove), ("codex", Plan::Remove)], "off even when no agent could be looked for");
    assert_eq!(plan(&json!({ "agentStatusHooks": true }), &found, true)[..2], [("claude", Plan::Install), ("codex", Plan::Install)]);
    assert!(plan(&off, &found, true).iter().all(|(_, p)| *p == Plan::Remove), "T-120-b: Gemini CLI, Antigravity and Amp come out too");
}

#[test]
fn stat_003_each_agent_reads_installed_partial_not_installed_or_error() {
    let dir = temp("inspect");
    let file = dir.join("settings.json");
    let events = ["Stop", "PreToolUse"];
    assert_eq!(switch::inspect(&file, &events), ("not installed", None), "no file at all");
    let mut s = json!({ "model": "opus" });
    install_claude_hooks(&mut s, MINE);
    let keep = |v: &Value, only: &[&str]| {
        let mut v = v.clone();
        v["hooks"].as_object_mut().unwrap().retain(|k, _| only.contains(&k.as_str()));
        v
    };
    fs::write(&file, keep(&s, &events).to_string()).unwrap();
    assert_eq!(switch::inspect(&file, &events), ("installed", None));
    fs::write(&file, keep(&s, &["Stop"]).to_string()).unwrap();
    assert_eq!(switch::inspect(&file, &events), ("partial", Some("no Kolux entry for PreToolUse".into())));
    fs::write(&file, keep(&s, &["Stop", "PreToolUse", "SessionStart"]).to_string()).unwrap();
    assert_eq!(switch::inspect(&file, &events), ("partial", Some("an old Kolux entry under SessionStart".into())), "an entry under an event Kolux no longer uses");
    fs::write(&file, r#"{"hooks":{"Stop":[{"hooks":[{"type":"command","command":"node mine.js"}]}]}}"#).unwrap();
    assert_eq!(switch::inspect(&file, &events).0, "not installed", "the user's own hooks are not Kolux's");
    fs::write(&file, "{ not json").unwrap();
    let (state, why) = switch::inspect(&file, &events);
    assert!(state == "error" && why.unwrap().contains("is not JSON"));
    assert_eq!(fs::read_to_string(&file).unwrap(), "{ not json", "an unreadable file is never rewritten");
}

#[test]
fn stat_002_off_clears_the_managed_codex_homes_too() {
    let profile = temp("managed");
    let home = profile.join(crate::codex_accounts::FOLDER).join("c1");
    fs::create_dir_all(&home).unwrap();
    let mut v = json!({ "hooks": { "Stop": [{ "hooks": [{ "type": "command", "command": "keep.cmd" }] }] } });
    install_codex_hooks(&mut v, MINE);
    fs::write(home.join("hooks.json"), v.to_string()).unwrap();
    assert_eq!(managed_codex_homes(&profile), vec![home.clone()]);
    remove_codex(&home).unwrap();
    let left: Value = serde_json::from_str(&fs::read_to_string(home.join("hooks.json")).unwrap()).unwrap();
    assert_eq!(left, json!({ "hooks": { "Stop": [{ "hooks": [{ "type": "command", "command": "keep.cmd" }] }] } }));
}

#[test]
fn t_152_gate_installing_stays_off_with_the_default_settings() {
    // A fresh profile's settings, the empty settings a failed read gives, and anything but a true.
    let dir = temp("gate");
    let fresh = crate::state::Store::open(&dir).unwrap().settings();
    for settings in [fresh, Value::Null, json!({}), json!({ switch::SWITCH_KEY: "true" }), json!({ switch::SWITCH_KEY: false })] {
        assert!(!switch::on(&settings), "{settings}");
    }
    assert!(switch::on(&json!({ switch::SWITCH_KEY: true })));
    let _ = fs::remove_dir_all(&dir);
}

/// A settings file shaped like a heavy user's own (T-152): another tool's hook under each of the
/// twelve events, a status line that is a command chain, a model line, skill overrides and an
/// allow list, two-space layout. Written from scratch; no real settings file is read.
fn shaped() -> String {
    let events: Map<String, Value> = CLAUDE_EVENTS
        .iter()
        .map(|e| (e.to_string(), json!([{ "hooks": [{ "type": "command", "command": format!("cmd /c \"G:\\some\\other\\{}.cmd\" || exit 0", e.to_lowercase()) }] }])))
        .collect();
    let skills: Map<String, Value> = (1..=12).map(|i| (format!("tool-skill-{i}"), json!(if i % 3 == 0 { "off" } else { "on" }))).collect();
    let v = json!({
        "model": "opus",
        "permissions": { "allow": ["Bash", "Read", "Edit(G:/Work/**)"], "defaultMode": "default" },
        "hooks": events,
        "statusLine": { "type": "command", "command": "sh -c \"cat >/tmp/line.json; sh G:/some/other/prev-line.sh </tmp/line.json; rm -f /tmp/line.json\"" },
        "skillOverrides": skills,
        "includeCoAuthoredBy": false
    });
    serde_json::to_string_pretty(&v).unwrap() + "\n"
}

#[test]
fn t_152_1_a_debug_build_writes_agent_settings_only_inside_the_temp_folder() {
    let dir = temp("t152-target");
    fs::write(dir.join(SCRATCH_MARKER), "").unwrap();
    let scratch = std::env::temp_dir();
    assert!(scratch_only(&dir.join("settings.json"), &scratch, &home_dir()).is_ok());
    let outside = std::env::current_dir().unwrap().join("settings.json");
    assert!(scratch_only(&outside, &scratch, &home_dir()).unwrap_err().contains("left alone"));
    let climbed = scratch.join("..").join(outside.parent().unwrap().strip_prefix(outside.ancestors().last().unwrap()).unwrap()).join("settings.json");
    assert!(scratch_only(&climbed, &scratch, &home_dir()).is_err(), "`..` cannot climb out of the temp folder");
    // Whatever this test process inherited, the resolved file is written only when it is scratch.
    let resolved = claude_settings_file();
    let profile = dir.join(PRODUCTION_ID);
    println!("resolved {} -> {:?}", resolved.display(), claude_target(&profile));
    assert_eq!(claude_target(&profile).is_ok(), scratch_only(&resolved, &scratch, &home_dir()).is_ok());
    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn t_152_b_2_a_scratch_settings_folder_needs_the_marker_not_only_the_temp_folder() {
    let scratch = std::env::temp_dir();
    let dir = temp("t152b-marker");
    let (bare, deep, other) = (dir.join("bare"), dir.join("marked").join("a").join("b"), dir.join("other"));
    for d in [&bare, &deep, &other] {
        fs::create_dir_all(d).unwrap();
    }
    // Under temp but no marker anywhere up to the temp folder: refused (TEMP=G:\ no longer admits all).
    let err = scratch_only(&bare.join("settings.json"), &scratch, &home_dir()).unwrap_err();
    assert!(err.contains(SCRATCH_MARKER) && err.contains("left alone"), "{err}");
    // The marker in the folder itself, or two folders up, admits it.
    fs::write(bare.join(SCRATCH_MARKER), "").unwrap();
    assert!(scratch_only(&bare.join("settings.json"), &scratch, &home_dir()).is_ok());
    fs::write(dir.join("marked").join(SCRATCH_MARKER), "").unwrap();
    assert!(scratch_only(&deep.join("settings.json"), &scratch, &home_dir()).is_ok(), "a marker two folders up counts");
    // `..` from a marked folder into an unmarked one, and letter-case spellings, resolve first.
    let climbed = bare.join("..").join("other").join("settings.json");
    assert!(scratch_only(&climbed, &scratch, &home_dir()).is_err(), "`..` out of a marked folder is refused");
    let upper = |p: &Path| PathBuf::from(p.to_string_lossy().to_uppercase());
    if cfg!(windows) {
        assert!(scratch_only(&upper(&bare).join("settings.json"), &scratch, &home_dir()).is_ok(), "case spelling of a marked folder");
        assert!(scratch_only(&upper(&other).join("settings.json"), &scratch, &home_dir()).is_err(), "case spelling of an unmarked folder");
    }
    // A marker above the scratch root does not count: with the root set lower, `dir`'s own
    // marker is outside it.
    fs::write(dir.join(SCRATCH_MARKER), "").unwrap();
    assert!(scratch_only(&other.join("settings.json"), &other, &home_dir()).is_err(), "a marker above the scratch root is ignored");
    // A missing folder fails closed.
    assert!(scratch_only(&dir.join("missing").join("settings.json"), &scratch, &home_dir()).is_err());
    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn t_152_b_2_test_dev_and_lane_runs_are_fenced_and_the_identifier_matches_the_app() {
    // This is a test build: every profile is fenced, the production one included.
    assert!(fenced(Path::new(r"C:\Users\me\AppData\Roaming\com.txaisxiong.kolux-rs")));
    assert!(fenced(Path::new(r"C:\Users\me\AppData\Roaming\com.txaisxiong.kolux-rs.hooks")));
    assert!(fenced(Path::new(r"G:\Temp\hooks-t152b\profile")));
    // The production identifier is the one the app is built with.
    let conf: Value = serde_json::from_str(include_str!("../../tauri.conf.json")).unwrap();
    assert_eq!(conf["identifier"], PRODUCTION_ID);
    // With the fence on, the user's own file (as this process resolves it) is refused unless it is
    // marked scratch; G:\Dev\claude-config holds no marker, so a run that inherited it stays out.
    let resolved = claude_settings_file();
    let scratch = std::env::temp_dir();
    assert_eq!(claude_target(Path::new(PRODUCTION_ID)).is_ok(), scratch_only(&resolved, &scratch, &home_dir()).is_ok());
}

#[test]
fn t_152_2_the_first_write_keeps_a_hashed_copy_and_a_failed_copy_stops_the_install() {
    let dir = temp("t152-backup");
    let (home, file) = (dir.join("home"), dir.join("settings.json"));
    let user = shaped();
    fs::write(&file, &user).unwrap();
    install_claude_at(&home, &file).unwrap();
    assert_eq!(fs::read_to_string(backup_of(&file)).unwrap(), user, "the copy is the file from before the install");
    let record = fs::read_to_string(target_dir(&home, &file).join(BACKUP_RECORD)).unwrap();
    let hashes: Vec<&str> = record.lines().map(|l| l.split_whitespace().next().unwrap()).collect();
    println!("{record}");
    assert_eq!(hashes.len(), 2);
    assert_eq!(hashes[0], hashes[1]);
    assert_eq!(hashes[0], sha256(&backup_of(&file)).unwrap());
    // A second install keeps the first copy.
    remove_claude(&file, &target_dir(&home, &file).join(STATUS_PREV)).unwrap();
    fs::write(&file, "{\"model\":\"sonnet\"}\n").unwrap();
    install_claude_at(&home, &file).unwrap();
    assert_eq!(fs::read_to_string(backup_of(&file)).unwrap(), user, "never replaced");
    // A copy that cannot be made: the settings file is left exactly as it was.
    let folder = dir.join("other").join("settings.json");
    fs::create_dir_all(&folder).unwrap();
    assert!(back_up(&folder, &dir.join(BACKUP_RECORD)).unwrap_err().contains("hooks not installed"));
    assert!(install_claude_at(&home, &folder).is_err());
    assert!(!backup_of(&folder).exists());
}

#[test]
fn t_152_3_only_kolux_entries_change_and_invalid_json_is_refused() {
    let dir = temp("t152-merge");
    let (home, file) = (dir.join("home"), dir.join("settings.json"));
    let older = "\"C:/Users/me/.kolux/agent-hooks/claude.cmd\" || exit 0";
    let mut user: Value = ev(&shaped());
    user["hooks"]["Stop"][0]["hooks"].as_array_mut().unwrap().push(json!({ "type": "command", "command": older }));
    let user_text = serde_json::to_string_pretty(&user).unwrap() + "\n";
    fs::write(&file, &user_text).unwrap();
    install_claude_at(&home, &file).unwrap();
    let after = ev(&fs::read_to_string(&file).unwrap());
    for e in CLAUDE_EVENTS {
        let groups = after["hooks"][e].as_array().unwrap();
        let theirs: Vec<&Value> = groups.iter().filter(|g| !is_mine(g)).collect();
        assert_eq!(theirs, user["hooks"][e].as_array().unwrap().iter().collect::<Vec<_>>(), "{e}: the user's groups untouched, the old app's entry included");
        assert_eq!(groups.iter().filter(|g| is_mine(g)).count(), 1, "{e}");
        assert!(groups.iter().filter(|g| is_mine(g)).all(|g| g.to_string().contains(".kolux-rs/agent-hooks")));
    }
    // Stripped of Kolux's entries both ways, the two files say the same thing.
    let strip_all = |v: &Value| {
        let mut v = v.clone();
        remove_groups(&mut v, true);
        v.as_object_mut().unwrap().remove("statusLine");
        v
    };
    assert_eq!(strip_all(&after), strip_all(&user));
    remove_claude(&file, &target_dir(&home, &file).join(STATUS_PREV)).unwrap();
    assert_eq!(ev(&fs::read_to_string(&file).unwrap()), user, "parsed equal once Kolux's entries are out");
    // Not JSON: refused, nothing written, no copy made.
    let bad = dir.join("bad").join("settings.json");
    fs::create_dir_all(bad.parent().unwrap()).unwrap();
    fs::write(&bad, "{ \"model\": \"opus\", ").unwrap();
    let err = install_claude_at(&home, &bad).unwrap_err();
    println!("{err}");
    assert!(err.contains("is not JSON") && err.contains("hooks not installed"));
    assert_eq!(fs::read_to_string(&bad).unwrap(), "{ \"model\": \"opus\", ");
    assert!(!backup_of(&bad).exists());
}

#[test]
fn t_152_4_the_users_status_line_still_runs_and_comes_back_exactly() {
    let dir = temp("t152-status");
    let (home, file) = (dir.join("home"), dir.join("settings.json"));
    let prev = target_dir(&home, &file).join(STATUS_PREV);
    let user = ev(&shaped());
    fs::write(&file, shaped()).unwrap();
    install_claude_at(&home, &file).unwrap();
    let line = ev(&fs::read_to_string(&file).unwrap())["statusLine"]["command"].as_str().unwrap().to_string();
    assert!(is_my_command(&line) && line.contains(&format!("sh \"{}\"", prev.to_string_lossy().replace('\\', "/"))), "Kolux's line feeds the user's own from the kept file");
    assert_eq!(fs::read_to_string(&prev).unwrap().trim_end(), user["statusLine"]["command"].as_str().unwrap(), "the user's command, as it was, is what runs");
    remove_claude(&file, &prev).unwrap();
    assert_eq!(ev(&fs::read_to_string(&file).unwrap())["statusLine"], user["statusLine"]);
    // A slot with no `type` and an odd extra comes back without the `type` Kolux set.
    fs::write(&file, "{\n  \"statusLine\": {\n    \"command\": \"  my line \",\n    \"padding\": 3\n  }\n}\n").unwrap();
    fs::remove_file(backup_of(&file)).unwrap();
    install_claude_at(&home, &file).unwrap();
    // Without the copy, so the kept slot alone puts it back.
    fs::remove_file(backup_of(&file)).unwrap();
    remove_claude(&file, &prev).unwrap();
    assert_eq!(fs::read_to_string(&file).unwrap(), "{\n  \"statusLine\": {\n    \"command\": \"  my line \",\n    \"padding\": 3\n  }\n}\n");
}

#[test]
fn t_152_5_a_file_changed_since_it_was_read_is_never_overwritten() {
    let dir = temp("t152-atomic");
    let file = dir.join("settings.json");
    let tmp = file.with_extension("json.kolux-rs-tmp");
    fs::write(&file, "{\"model\":\"opus\"}\n").unwrap();
    let err = write_atomic(&file, b"{}\n", Some("{\"model\":\"sonnet\"}\n")).unwrap_err();
    println!("kolux-rs: claude hooks: {err}");
    assert!(err.ends_with("changed since it was read; nothing written"));
    assert_eq!(fs::read_to_string(&file).unwrap(), "{\"model\":\"opus\"}\n", "the newer file stays");
    assert!(!tmp.exists(), "no temp file left");
    let fresh = dir.join("fresh.json");
    fs::write(&fresh, "{}").unwrap();
    assert!(write_atomic(&fresh, b"{\"a\":1}", None).is_err(), "a file that appeared after the read counts as changed");
    write_atomic(&file, b"{}\n", Some("{\"model\":\"opus\"}\n")).unwrap();
    assert_eq!(fs::read_to_string(&file).unwrap(), "{}\n");
    assert!(!tmp.exists());
}

#[test]
fn t_152_6_switching_off_gives_back_the_file_byte_for_byte_and_codex_is_not_written() {
    let dir = temp("t152-off");
    let home = dir.join("home");
    let compact = "{\"model\":\"opus\",\"statusLine\":{\"type\":\"command\",\"command\":\"x.sh\"},\"hooks\":{\"Stop\":[{\"hooks\":[{\"type\":\"command\",\"command\":\"notify.cmd\"}]}]}}";
    let crlf = shaped().replace('\n', "\r\n");
    for (name, user) in [("shaped", shaped()), ("compact", compact.to_string()), ("crlf", crlf)] {
        let file = dir.join(name).join("settings.json");
        fs::create_dir_all(file.parent().unwrap()).unwrap();
        fs::write(&file, &user).unwrap();
        install_claude_at(&home, &file).unwrap();
        assert_ne!(fs::read_to_string(&file).unwrap(), user, "{name}: installed");
        assert!(remove_claude(&file, &target_dir(&home, &file).join(STATUS_PREV)).unwrap());
        assert_eq!(fs::read(&file).unwrap(), user.as_bytes(), "{name}: byte for byte");
    }
    // Without the copy the layout still comes back (indent, line ends, final newline).
    let file = dir.join("shaped").join("settings.json");
    fs::remove_file(backup_of(&file)).unwrap();
    install_claude_at(&home, &file).unwrap();
    fs::remove_file(backup_of(&file)).unwrap();
    remove_claude(&file, &target_dir(&home, &file).join(STATUS_PREV)).unwrap();
    assert_eq!(fs::read_to_string(&file).unwrap(), shaped());
    // Codex: switching on writes nothing into any Codex home.
    assert_eq!(apply(&home, &dir.join("profile"), "codex", Plan::Install).unwrap(), "not written (Codex hooks wait for T-025-e)");
}


#[test]
fn t_152_5_an_install_on_a_file_changed_since_the_start_fails_and_writes_nothing() {
    let dir = temp("t152-install-race");
    let file = dir.join("settings.json");
    // Read at the start of the operation ...
    let read_first = shaped();
    // ... then Claude Code rewrote the file before Kolux's write.
    let newer = shaped().replace("\"opus\"", "\"sonnet\"");
    fs::write(&file, &newer).unwrap();
    let err = install_claude_from(&file, Some(read_first), MINE, "x").unwrap_err();
    println!("kolux-rs: claude hooks: {err}");
    assert!(err.ends_with("changed since it was read; nothing written"));
    assert_eq!(fs::read_to_string(&file).unwrap(), newer, "the target is untouched");
    assert!(!file.with_extension("json.kolux-rs-tmp").exists());
}

#[allow(clippy::permissions_set_readonly_false)]
fn read_only(file: &Path, on: bool) {
    let mut p = fs::metadata(file).unwrap().permissions();
    p.set_readonly(on);
    fs::set_permissions(file, p).unwrap();
}

#[test]
fn t_152_4_a_failed_install_after_the_status_line_save_leaves_his_line_for_the_next_off() {
    let dir = temp("t152-prev-first");
    let (home, file) = (dir.join("home"), dir.join("settings.json"));
    let prev = target_dir(&home, &file).join(STATUS_PREV);
    let user = shaped();
    fs::write(&file, &user).unwrap();
    // A settings file that cannot be replaced: install_claude fails after the status line save.
    read_only(&file, true);
    let err = install_claude_at(&home, &file).unwrap_err();
    println!("kolux-rs: claude hooks: {err}");
    let line = ev(&user)["statusLine"].clone();
    assert_eq!(fs::read_to_string(&prev).unwrap().trim_end(), line["command"].as_str().unwrap(), "saved before the install ran");
    assert_eq!(ev(&fs::read_to_string(prev.with_extension("json")).unwrap()), line);
    assert_eq!(fs::read_to_string(&file).unwrap(), user, "his line was never replaced");
    assert!(!file.with_extension("json.kolux-rs-tmp").exists(), "no temp file left");
    read_only(&file, false);
    read_only(&backup_of(&file), false);
    // The next "off": the status line is still his and the file is exactly as it was.
    remove_claude(&file, &prev).unwrap();
    assert_eq!(ev(&fs::read_to_string(&file).unwrap())["statusLine"], line);
    assert_eq!(fs::read_to_string(&file).unwrap(), user);
}

#[test]
fn t_152_6_a_codex_hooks_file_with_empty_hooks_comes_back_byte_for_byte() {
    let dir = temp("t152-codex-empty");
    let (home, profile) = (dir.join("home"), dir.join("profile"));
    let managed = profile.join(crate::codex_accounts::FOLDER).join("c1");
    let file = managed.join("hooks.json");
    let command = "\"C:\\Users\\me\\.kolux-rs\\agent-hooks\\codex.cmd\"";
    // T-152-b (4): the real managed-home path. A pane start installs into the managed home through
    // install_codex_home -> install_codex, whose file write is write_codex_groups (the Codex trust
    // step that follows needs the codex program and writes only config.toml, so it is left out
    // here); then the switch going off clears every managed home (apply Remove, what clear() runs).
    for text in ["{\"hooks\":{}}", "{\n  \"hooks\": {}\n}\n", "{}", "{\"model\":\"o3\"}\n"] {
        let _ = fs::remove_dir_all(&managed);
        fs::create_dir_all(&managed).unwrap();
        fs::write(&file, text).unwrap();
        let mut v: Value = serde_json::from_str(text).unwrap();
        assert!(write_codex_groups(&file, Some(text), &mut v, command).unwrap(), "{text}: Kolux's groups written");
        assert_eq!(switch::inspect(&file, &CODEX_EVENTS).0, "installed", "{text}");
        assert_eq!(fs::read_to_string(backup_of(&file)).unwrap(), text, "a copy from before the first write");
        apply(&home, &profile, "codex", Plan::Remove).unwrap();
        let back = fs::read_to_string(&file).unwrap();
        println!("{text:?} -> on -> off -> {back:?}");
        assert_eq!(back, text, "on then off gives back {text:?} byte for byte (an empty hooks object is kept, not turned into {{}})");
        assert!(!remove_codex(&managed).unwrap(), "nothing of Kolux's left: nothing written");
    }
    // With no copy to go by, a "hooks" object left empty stays: only the copy can say Kolux made it.
    let mut v = json!({ "hooks": { "Stop": [{ "hooks": [{ "type": "command", "command": command }] }] } });
    assert!(remove_groups(&mut v, false));
    assert_eq!(v, json!({ "hooks": {} }));
    let mut v = json!({ "hooks": { "Stop": [{ "hooks": [{ "type": "command", "command": command }] }] } });
    assert!(remove_groups(&mut v, true));
    assert_eq!(v, json!({}), "a hooks object Kolux created goes");
    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn t_152_b_4_a_claude_file_with_an_empty_hooks_object_installs_and_comes_back_byte_for_byte() {
    let dir = temp("t152b-claude-empty");
    let home = dir.join("home");
    for (i, text) in ["{\"hooks\":{}}", "{\n  \"model\": \"opus\",\n  \"hooks\": {}\n}\n"].into_iter().enumerate() {
        let file = dir.join(format!("c{i}")).join("settings.json");
        fs::create_dir_all(file.parent().unwrap()).unwrap();
        fs::write(&file, text).unwrap();
        install_claude_at(&home, &file).unwrap();
        assert_eq!(switch::inspect(&file, &CLAUDE_EVENTS).0, "installed");
        remove_claude(&file, &target_dir(&home, &file).join(STATUS_PREV)).unwrap();
        assert_eq!(fs::read_to_string(&file).unwrap(), text, "on then off gives back {text:?}");
    }
    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn t_152_b_3_the_kept_copy_is_checked_against_its_record_on_every_install() {
    let dir = temp("t152b-record");
    let (home, file) = (dir.join("home"), dir.join("settings.json"));
    let record = target_dir(&home, &file).join(BACKUP_RECORD);
    let user = shaped();
    fs::write(&file, &user).unwrap();
    install_claude_at(&home, &file).unwrap();
    let off = |f: &Path| remove_claude(f, &target_dir(&home, f).join(STATUS_PREV)).unwrap();
    off(&file);
    assert_eq!(fs::read_to_string(&file).unwrap(), user);
    // A missing record is rebuilt from the copy and the file as they are, both lines.
    fs::remove_file(&record).unwrap();
    install_claude_at(&home, &file).unwrap();
    let rebuilt = fs::read_to_string(&record).unwrap();
    println!("rebuilt record:\n{rebuilt}");
    let lines: Vec<&str> = rebuilt.lines().collect();
    assert_eq!(lines.len(), 2);
    assert!(lines[1].starts_with(&sha256(&backup_of(&file)).unwrap()) && lines[1].ends_with(&backup_of(&file).display().to_string()));
    assert!(lines[0].ends_with(&file.display().to_string()));
    off(&file);
    // A torn copy (truncated) is refused, naming both hashes and both paths; nothing is written.
    let whole = sha256(&backup_of(&file)).unwrap();
    fs::write(backup_of(&file), &user.as_bytes()[..user.len() / 2]).unwrap();
    let torn = sha256(&backup_of(&file)).unwrap();
    let before = fs::read(&file).unwrap();
    let err = install_claude_at(&home, &file).unwrap_err();
    println!("{err}");
    for part in [whole.as_str(), torn.as_str(), &backup_of(&file).display().to_string(), &record.display().to_string()] {
        assert!(err.contains(part), "{err} names {part}");
    }
    assert_eq!(fs::read(&file).unwrap(), before, "a refused install writes nothing");
    // A torn copy with no record is not trusted either: it is not JSON, so no record is rebuilt.
    fs::remove_file(&record).unwrap();
    assert!(install_claude_at(&home, &file).unwrap_err().contains("not JSON"));
    assert!(!record.exists());
    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn t_152_b_3_a_failed_record_write_leaves_no_copy_the_next_install_trusts() {
    let dir = temp("t152b-record-fail");
    let file = dir.join("settings.json");
    fs::write(&file, "{\"model\":\"opus\"}\n").unwrap();
    // The record's path is a folder, so writing it fails.
    let record = dir.join("record");
    fs::create_dir_all(&record).unwrap();
    let err = back_up(&file, &record).unwrap_err();
    println!("{err}");
    assert!(err.contains("hooks not installed"));
    assert!(!backup_of(&file).exists(), "no copy under the kept name");
    let left: Vec<String> = fs::read_dir(&dir).unwrap().flatten().map(|e| e.file_name().to_string_lossy().into_owned()).collect();
    assert!(left.iter().all(|n| !n.contains("bak-kolux")), "no temp copy left: {left:?}");
    // Once the record can be written, the copy is made, synced, recorded and verified next time.
    fs::remove_dir_all(&record).unwrap();
    let (a, b) = back_up(&file, &record).unwrap().unwrap();
    assert_eq!(a, b);
    assert_eq!(fs::read(backup_of(&file)).unwrap(), fs::read(&file).unwrap());
    assert!(back_up(&file, &record).unwrap().is_none(), "an existing copy matching its record is kept");
    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn t_152_b_5_a_save_between_read_and_write_is_merged_once_and_a_second_one_fails() {
    use super::super::BEFORE_REREAD;
    let dir = temp("t152b-retry");
    let home = dir.join("home");
    // Claude Code saving the file (a whole-file write) between Kolux's read and its rename.
    let save = |f: &Path, model: &'static str| -> Box<dyn FnOnce()> {
        let f = f.to_path_buf();
        Box::new(move || {
            let mut v: Value = ev(&fs::read_to_string(&f).unwrap());
            v["model"] = json!(model);
            fs::write(&f, serde_json::to_string_pretty(&v).unwrap()).unwrap();
        })
    };
    // One save: read again, merged once more, his save kept and Kolux's entries in.
    let file = dir.join("one").join("settings.json");
    fs::create_dir_all(file.parent().unwrap()).unwrap();
    fs::write(&file, shaped()).unwrap();
    BEFORE_REREAD.with(|c| c.borrow_mut().push(save(&file, "saved-once")));
    install_claude_at(&home, &file).unwrap();
    let after = ev(&fs::read_to_string(&file).unwrap());
    assert_eq!(after["model"], "saved-once", "his save is kept");
    assert_eq!(switch::inspect(&file, &CLAUDE_EVENTS).0, "installed", "and Kolux's entries are in");
    assert!(BEFORE_REREAD.with(|c| c.borrow().is_empty()));
    // Two saves: the second attempt fails as before, the file holds his second save, nothing of Kolux's.
    let file = dir.join("two").join("settings.json");
    fs::create_dir_all(file.parent().unwrap()).unwrap();
    fs::write(&file, shaped()).unwrap();
    BEFORE_REREAD.with(|c| c.borrow_mut().extend([save(&file, "saved-twice"), save(&file, "saved-first")]));
    let err = install_claude_at(&home, &file).unwrap_err();
    println!("kolux-rs: claude hooks: {err}");
    assert!(err.ends_with("changed since it was read; nothing written"), "{err}");
    let now = fs::read_to_string(&file).unwrap();
    assert_eq!(ev(&now)["model"], "saved-twice");
    assert_eq!(switch::inspect(&file, &CLAUDE_EVENTS).0, "not installed");
    assert!(!file.with_extension("json.kolux-rs-tmp").exists());
    let _ = fs::remove_dir_all(&dir);
}

/// The same whole-file save Claude Code makes, run between Kolux's read and its write.
fn save_between(f: &Path, model: &'static str) -> Box<dyn FnOnce()> {
    let f = f.to_path_buf();
    Box::new(move || {
        let mut v: Value = ev(&fs::read_to_string(&f).unwrap());
        v["model"] = json!(model);
        fs::write(&f, serde_json::to_string_pretty(&v).unwrap()).unwrap();
    })
}

#[test]
fn t_152_c_1_two_settings_files_in_one_home_keep_their_own_slot_and_record() {
    let dir = temp("t152c-targets");
    let home = dir.join("home");
    let (a, b) = (dir.join("a").join("settings.json"), dir.join("b").join("settings.json"));
    let line = |c: &str| {
        let mut v = ev(&shaped());
        v["statusLine"] = json!({ "type": "command", "command": c, "padding": 2 });
        serde_json::to_string_pretty(&v).unwrap() + "\n"
    };
    let (ua, ub) = (line("a-line.sh"), line("b-line.sh"));
    for (f, u) in [(&a, &ua), (&b, &ub)] {
        fs::create_dir_all(f.parent().unwrap()).unwrap();
        fs::write(f, u).unwrap();
    }
    let (ta, tb) = (target_dir(&home, &a), target_dir(&home, &b));
    println!("A {} -> {}\nB {} -> {}", a.display(), ta.display(), b.display(), tb.display());
    assert_ne!(ta, tb);
    assert!(ta.starts_with(home.join(SCRIPT_DIR).join(TARGETS)) && ta.file_name().unwrap().len() == 16);
    // Other spellings of A (`..`, letter case) are A's slot, not a new one.
    assert_eq!(target_dir(&home, &dir.join("b").join("..").join("a").join("settings.json")), ta);
    if cfg!(windows) {
        assert_eq!(target_dir(&home, &PathBuf::from(a.to_string_lossy().to_uppercase())), ta);
    }
    install_claude_at(&home, &a).unwrap();
    assert!(!tb.exists(), "installing A writes nothing of B's");
    install_claude_at(&home, &b).unwrap();
    let mine = |d: &Path| [d.join(STATUS_PREV), d.join(STATUS_PREV).with_extension("json"), d.join(BACKUP_RECORD)].map(|f| fs::read(f).ok());
    let b_had = mine(&tb);
    assert!(b_had.iter().all(Option::is_some), "B's slot and record are B's own");
    // Each file's status line runs its own saved line.
    let runs = |f: &Path, d: &Path| fs::read_to_string(f).unwrap().contains(&d.join(STATUS_PREV).to_string_lossy().replace('\\', "/"));
    assert!(runs(&a, &ta) && runs(&b, &tb));
    // A record names only its own file and copy.
    let ra = fs::read_to_string(ta.join(BACKUP_RECORD)).unwrap();
    assert!(ra.contains(&a.display().to_string()) && !ra.contains(&b.display().to_string()), "{ra}");
    // Off and on again for A never touches B's slot or record.
    remove_claude(&a, &ta.join(STATUS_PREV)).unwrap();
    assert_eq!(fs::read_to_string(&a).unwrap(), ua, "A comes back byte for byte");
    assert_eq!(mine(&tb), b_had);
    install_claude_at(&home, &a).unwrap();
    assert_eq!(mine(&tb), b_had);
    // B gets its own line back, not A's (one shared slot would have handed it A's).
    remove_claude(&b, &tb.join(STATUS_PREV)).unwrap();
    assert_eq!(fs::read_to_string(&b).unwrap(), ub, "B comes back byte for byte");
    remove_claude(&a, &ta.join(STATUS_PREV)).unwrap();
    assert_eq!(fs::read_to_string(&a).unwrap(), ua);
    // A record for A is not consulted for B: with B's record gone, a damaged copy of B is not
    // vouched for by A's record, which is still there.
    fs::remove_file(tb.join(BACKUP_RECORD)).unwrap();
    fs::write(backup_of(&b), "not json").unwrap();
    assert!(ta.join(BACKUP_RECORD).is_file());
    let err = back_up(&b, &tb.join(BACKUP_RECORD)).unwrap_err();
    assert!(err.contains("has no record") && err.contains(&tb.join(BACKUP_RECORD).display().to_string()), "{err}");
    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn t_152_c_3_on_with_two_saves_fails_whole_with_the_error_in_the_reply_and_off_retries_once() {
    use super::super::BEFORE_REREAD;
    let dir = temp("t152c-retry");
    let (home, file) = (dir.join("home"), dir.join("settings.json"));
    fs::write(&file, shaped()).unwrap();
    // On, saved twice in the gap: the install fails, the reply carries why, and the file is his.
    BEFORE_REREAD.with(|c| c.borrow_mut().extend([save_between(&file, "saved-twice"), save_between(&file, "saved-first")]));
    let reply = outcomes(vec![("claude", install_claude_at(&home, &file).map(|_| "installed"))]);
    println!("{}", json!(reply));
    assert_eq!(reply[0]["agent"], "claude");
    assert!(reply[0]["done"].is_null());
    assert!(reply[0]["error"].as_str().is_some_and(|e| e.ends_with(CHANGED)), "{reply:?}");
    assert_eq!(ev(&fs::read_to_string(&file).unwrap())["model"], "saved-twice");
    assert_eq!(switch::inspect(&file, &CLAUDE_EVENTS).0, "not installed", "the file agrees with the failure");
    // On again, then off with one save in the gap: read again once, and it succeeds.
    install_claude_at(&home, &file).unwrap();
    BEFORE_REREAD.with(|c| c.borrow_mut().push(save_between(&file, "saved-during-off")));
    assert!(remove_claude(&file, &target_dir(&home, &file).join(STATUS_PREV)).unwrap());
    assert!(BEFORE_REREAD.with(|c| c.borrow().is_empty()), "the save ran");
    let after = ev(&fs::read_to_string(&file).unwrap());
    assert_eq!(after["model"], "saved-during-off", "his save is kept");
    assert_eq!(switch::inspect(&file, &CLAUDE_EVENTS).0, "not installed");
    assert_eq!(after["statusLine"], ev(&shaped())["statusLine"], "his status line is back");
    // Off with two saves fails and writes nothing.
    install_claude_at(&home, &file).unwrap();
    BEFORE_REREAD.with(|c| c.borrow_mut().extend([save_between(&file, "off-twice"), save_between(&file, "off-first")]));
    let err = remove_claude(&file, &target_dir(&home, &file).join(STATUS_PREV)).unwrap_err();
    assert!(err.ends_with(CHANGED), "{err}");
    assert_eq!(switch::inspect(&file, &CLAUDE_EVENTS).0, "installed", "the file still has what the failed off left");
    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn t_152_c_4_a_hooked_file_without_its_copy_is_refused_and_nothing_is_written() {
    let dir = temp("t152c-hooked");
    let (home, file) = (dir.join("home"), dir.join("settings.json"));
    fs::write(&file, shaped()).unwrap();
    install_claude_at(&home, &file).unwrap();
    fs::remove_file(backup_of(&file)).unwrap();
    let record = target_dir(&home, &file).join(BACKUP_RECORD);
    let (had, record_had) = (fs::read(&file).unwrap(), fs::read(&record).unwrap());
    let err = install_claude_at(&home, &file).unwrap_err();
    println!("{err}");
    assert!(err.contains("already holds Kolux's hook entries") && err.contains(&file.display().to_string()), "{err}");
    assert_eq!(fs::read(&file).unwrap(), had, "the file is not written");
    assert!(!backup_of(&file).exists(), "no copy of a hooked file");
    assert_eq!(fs::read(&record).unwrap(), record_had, "the record is not written");
    // Kolux's status line alone counts as Kolux's entries too.
    let line = dir.join("line.json");
    fs::write(&line, r#"{"statusLine":{"type":"command","command":"C:/Users/me/.kolux-rs/agent-hooks/claude-status.cmd"}}"#).unwrap();
    assert!(back_up(&line, &dir.join("line.sha256")).unwrap_err().contains("already holds Kolux's hook entries"));
    assert!(!backup_of(&line).exists() && !dir.join("line.sha256").exists());
    let _ = fs::remove_dir_all(&dir);
}

fn one_var(name: &'static str, value: &'static str) -> impl Fn(&str) -> Option<std::ffi::OsString> {
    move |n| (n == name).then(|| value.into())
}

#[test]
fn t_152_c_5_a_temp_folder_too_wide_for_scratch_is_refused_and_lane_variables_fence() {
    let dir = temp("t152c-wide");
    let (home, cfg, bare) = (dir.join("home"), dir.join("cfg"), dir.join("bare"));
    for d in [&home, &cfg, &bare] {
        fs::create_dir_all(d).unwrap();
    }
    fs::write(cfg.join(SCRATCH_MARKER), "").unwrap();
    let file = cfg.join("settings.json");
    let away = std::env::current_dir().unwrap();
    assert!(!away.starts_with(&dir));
    assert!(scratch_only(&file, &dir, &away).is_ok(), "marked, below TEMP, home elsewhere");
    // A1: a TEMP that holds the home folder, or is it, is refused.
    let err = scratch_only(&file, &dir, &home).unwrap_err();
    println!("{err}");
    assert!(err.contains("holds the home folder") && err.contains("left alone"), "{err}");
    assert!(scratch_only(&file, &dir, &dir).unwrap_err().contains("holds the home folder"));
    // A1: a TEMP at a drive root is refused, marker or not.
    let root = dir.ancestors().last().unwrap();
    let err = scratch_only(&file, root, &away).unwrap_err();
    println!("{err}");
    assert!(err.contains("drive root"), "{err}");
    // A1: the marker must sit strictly below TEMP; one in TEMP itself admits nothing.
    fs::write(dir.join(SCRATCH_MARKER), "").unwrap();
    assert!(scratch_only(&bare.join("settings.json"), &dir, &away).is_err(), "a marker in TEMP itself");
    assert!(scratch_only(&dir.join("settings.json"), &dir, &away).is_err(), "a file directly in TEMP");
    assert!(scratch_only(&file, &dir, &away).is_ok());
    // A2: a release build with the production profile is fenced when a lane's app folder variables
    // name another folder, and not when they are unset, empty or name the production profile.
    let prod = Path::new(r"C:\Users\me\AppData\Roaming\com.txaisxiong.kolux-rs");
    let none = |_: &str| None;
    assert!(!fenced_by(prod, false, none), "the installed product");
    assert!(fenced_by(prod, false, one_var("KOLUX_APP_DIR", r"G:\Temp\hooks-t152c\profile")));
    assert!(fenced_by(prod, false, one_var("KOLUX_USER_DATA_PATH", r"G:\Temp\hooks-t152c\profile")));
    assert!(!fenced_by(prod, false, one_var("KOLUX_APP_DIR", r"C:\Users\me\AppData\Roaming\com.txaisxiong.kolux-rs")), "a pane of the installed app");
    assert!(!fenced_by(prod, false, one_var("KOLUX_USER_DATA_PATH", "")), "empty reads as unset");
    assert!(fenced_by(prod, true, none), "a test or debug build");
    assert!(fenced_by(Path::new(r"G:\Temp\x\profile"), false, none), "a lane profile");
    let _ = fs::remove_dir_all(&dir);
}

/// FIX-2 (S8): a settings file Kolux itself created on the first install (none was there) is
/// installed into again on every later start, and switching off deletes it instead of leaving `{}`.
#[test]
fn fix_2_s8_a_settings_file_kolux_created_installs_again_and_off_deletes_it() {
    let dir = temp("fix2-created");
    let (home, file) = (dir.join("home"), dir.join("cfg").join("settings.json"));
    fs::create_dir_all(file.parent().unwrap()).unwrap();
    let prev = target_dir(&home, &file).join(STATUS_PREV);
    for round in 0..2 {
        assert!(!file.exists());
        install_claude_at(&home, &file).unwrap();
        assert!(file.exists() && !backup_of(&file).exists(), "round {round}: created, with nothing to copy");
        let record = fs::read_to_string(target_dir(&home, &file).join(BACKUP_RECORD)).unwrap();
        assert!(record.lines().any(|l| l == format!("missing  {}", file.display())), "round {round}: {record}");
        // The next start: the file holds Kolux's entries and has no copy, which is right for it.
        install_claude_at(&home, &file).unwrap_or_else(|e| panic!("round {round}: a second start fails: {e}"));
        assert_eq!(switch::inspect(&file, &CLAUDE_EVENTS).0, "installed");
        assert!(remove_claude(&file, &prev).unwrap());
        assert!(!file.exists(), "round {round}: off leaves no file behind, not {:?}", fs::read_to_string(&file).ok());
    }
    let _ = fs::remove_dir_all(&dir);
}

/// FIX-2 (S8): keys the user put into a file Kolux created stay when the hooks go off; a file
/// that was the user's before the install is never deleted, even when it read `{}`.
#[test]
fn fix_2_s8_user_keys_in_a_created_file_stay_and_a_users_empty_file_stays() {
    let dir = temp("fix2-keys");
    let (home, file) = (dir.join("home"), dir.join("cfg").join("settings.json"));
    fs::create_dir_all(file.parent().unwrap()).unwrap();
    install_claude_at(&home, &file).unwrap();
    let mut v: Value = serde_json::from_str(&fs::read_to_string(&file).unwrap()).unwrap();
    v["model"] = json!("opus");
    fs::write(&file, serde_json::to_string_pretty(&v).unwrap()).unwrap();
    install_claude_at(&home, &file).unwrap();
    assert!(remove_claude(&file, &target_dir(&home, &file).join(STATUS_PREV)).unwrap());
    assert_eq!(ev(&fs::read_to_string(&file).unwrap()), json!({"model": "opus"}), "the user's key stays, Kolux's go");
    // A file of the user's that read `{}` before the install comes back as it was.
    let own = dir.join("own").join("settings.json");
    fs::create_dir_all(own.parent().unwrap()).unwrap();
    fs::write(&own, "{}\n").unwrap();
    install_claude_at(&home, &own).unwrap();
    assert!(remove_claude(&own, &target_dir(&home, &own).join(STATUS_PREV)).unwrap());
    assert_eq!(fs::read_to_string(&own).unwrap(), "{}\n", "the user's own file is never deleted");
    let _ = fs::remove_dir_all(&dir);
}
