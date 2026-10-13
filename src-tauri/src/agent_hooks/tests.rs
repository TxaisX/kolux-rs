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
        assert!(out.status.success() && out.stdout.is_empty(), "{out:?}");
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
fn stat_002_the_switch_off_takes_every_agent_out_and_on_is_the_default() {
    let ids = |v: &[&str]| v.iter().map(|s| s.to_string()).collect::<Vec<_>>();
    let found = ids(&["claude", "codex"]);
    assert!(switch::on(&json!({})) && switch::on(&json!({ "agentStatusHooks": "garbage" })), "never saved, or unreadable, reads as on");
    let off = json!({ "agentStatusHooks": false });
    assert!(!switch::on(&off));
    assert_eq!(plan(&off, &found, true), vec![("claude", Plan::Remove), ("codex", Plan::Remove)]);
    assert_eq!(plan(&off, &[], false), vec![("claude", Plan::Remove), ("codex", Plan::Remove)], "off even when no agent could be looked for");
    assert_eq!(plan(&json!({ "agentStatusHooks": true }), &found, true), vec![("claude", Plan::Install), ("codex", Plan::Install)]);
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
    for settings in [fresh, Value::Null, json!({}), json!({ INSTALL_KEY: "true" }), json!({ INSTALL_KEY: false })] {
        assert!(!install_allowed(&settings), "{settings}");
    }
    assert!(install_allowed(&json!({ INSTALL_KEY: true })));
    let _ = fs::remove_dir_all(&dir);
}
