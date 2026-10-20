use super::*;
use crate::status::{Agent, Session};

fn state(s: &mut Session, m: &mut Memory, path: &str, j: Value) -> Option<&'static str> {
    let e = normalize_with(m, path, &j)?;
    s.apply(Agent::Vendor, &e).map(|(c, _)| c.state)
}

/// A folder under the temp dir (a scratch folder under the lane's scratch env), emptied first.
fn scratch(tag: &str) -> PathBuf {
    let d = std::env::temp_dir().join(format!("kolux-rs-more-{tag}-{}", std::process::id()));
    let _ = fs::remove_dir_all(&d);
    fs::create_dir_all(&d).unwrap();
    d
}

fn read(file: &Path) -> String {
    fs::read_to_string(file).unwrap()
}

#[test]
fn t_121_routes_and_agents() {
    assert_eq!(agent_of("/cursor"), Some("cursor"));
    assert_eq!(agent_of("droid"), Some("droid"));
    assert_eq!(agent_of("/kimi"), Some("kimi"));
    assert!(!is_route("/gemini") && !is_route("/claude"));
    assert_eq!(normalize_any("/gemini", &json!({"hook_event_name":"BeforeAgent","prompt":"p"})).unwrap()["hook_event_name"], "UserPromptSubmit", "other vendors still go to their own rules");
    assert!(change(&json!({"hook_event_name":"Stop"})).is_none(), "an event of another vendor is not this module's");
}

#[test]
fn stat_012_cursor_events_drive_the_dot() {
    let (mut s, mut m) = (Session::default(), Memory::default());
    let p = "/cursor";
    assert_eq!(normalize_with(&mut m, p, &json!({"hook_event_name":"sessionStart","conversation_id":"c1"})), None, "session start is not hooked and changes nothing");
    assert_eq!(state(&mut s, &mut m, p, json!({"hook_event_name":"beforeSubmitPrompt","conversation_id":"c1","prompt":"fix it"})), Some("working"));
    assert_eq!(state(&mut s, &mut m, p, json!({"hook_event_name":"preToolUse","conversation_id":"c1","tool_name":"Read","tool_input":{"path":"a.rs"}})), Some("working"));
    assert_eq!(state(&mut s, &mut m, p, json!({"hook_event_name":"beforeShellExecution","conversation_id":"c1","command":"ls","cwd":"x"})), Some("working"), "a shell step is working and never asks");
    assert_eq!(state(&mut s, &mut m, p, json!({"hook_event_name":"beforeMCPExecution","conversation_id":"c1","tool_name":"search","tool_input":{}})), Some("working"));
    assert_eq!(state(&mut s, &mut m, p, json!({"hook_event_name":"postToolUseFailure","conversation_id":"c1","tool_name":"Read"})), Some("working"));
    assert_eq!(normalize_with(&mut m, p, &json!({"hook_event_name":"afterAgentResponse","conversation_id":"c1","text":"early"})), None, "a reply before the turn stopped done is not a done");
    assert_eq!(state(&mut s, &mut m, p, json!({"hook_event_name":"stop","conversation_id":"c1","status":"completed"})), Some("done"));
    assert_eq!(state(&mut s, &mut m, p, json!({"hook_event_name":"afterAgentResponse","conversation_id":"c1","text":"All fixed."})), Some("done"));
    assert_eq!(s.reply.as_deref(), Some("All fixed."));
    // A new prompt forgets the completed stop.
    assert_eq!(state(&mut s, &mut m, p, json!({"hook_event_name":"beforeSubmitPrompt","conversation_id":"c1","prompt":"again"})), Some("working"));
    assert_eq!(normalize_with(&mut m, p, &json!({"hook_event_name":"afterAgentResponse","conversation_id":"c1","text":"x"})), None);
    for status in ["aborted", "error"] {
        assert_eq!(state(&mut s, &mut m, p, json!({"hook_event_name":"stop","conversation_id":"c1","status":status})), Some("interrupted"), "{status}");
        assert_eq!(s.resolved(), "interrupted");
        assert_eq!(normalize_with(&mut m, p, &json!({"hook_event_name":"afterAgentResponse","conversation_id":"c1","text":"x"})), None, "an interrupted turn's reply is no done");
        assert_eq!(state(&mut s, &mut m, p, json!({"hook_event_name":"beforeSubmitPrompt","conversation_id":"c1","prompt":"go"})), Some("working"));
    }
    let e = normalize_with(&mut m, p, &json!({"hook_event_name":"sessionEnd","conversation_id":"c1","reason":"user_close"})).unwrap();
    assert_eq!(e["hook_event_name"], "Stop");
    assert_eq!(e["session_id"], "c1");
    assert_eq!(e[MARK], "cursor");
}

#[test]
fn stat_012_cursor_memory_is_bounded() {
    let mut m = Memory::default();
    for i in 0..(MEMORY_CAP + 50) {
        normalize_with(&mut m, "/cursor", &json!({"hook_event_name":"stop","conversation_id":format!("c{i}"),"status":"completed"}));
    }
    assert_eq!(m.done.len(), MEMORY_CAP);
}

#[test]
fn stat_013_droid_notices_by_type_and_wording() {
    let (mut s, mut m) = (Session::default(), Memory::default());
    let p = "/droid";
    for ignored in ["SessionStart", "SubagentStop", "SessionEnd", "PreCompact"] {
        assert_eq!(normalize_with(&mut m, p, &json!({"hook_event_name":ignored,"session_id":"d1"})), None, "{ignored}");
    }
    assert_eq!(state(&mut s, &mut m, p, json!({"hook_event_name":"UserPromptSubmit","session_id":"d1","prompt":"go"})), Some("working"));
    assert_eq!(state(&mut s, &mut m, p, json!({"hook_event_name":"PreToolUse","session_id":"d1","tool_name":"Execute","tool_input":{"command":"ls"}})), Some("working"));
    assert_eq!(state(&mut s, &mut m, p, json!({"hook_event_name":"Notification","session_id":"d1","notification_type":"permission_prompt","message":"Droid needs your permission to use Execute"})), Some("permission"));
    assert_eq!(s.resolved(), "permission");
    assert_eq!(state(&mut s, &mut m, p, json!({"hook_event_name":"PostToolUse","session_id":"d1","tool_name":"Execute"})), Some("working"), "the tool the permission was for clears it");
    assert_eq!(s.resolved(), "working");
    assert_eq!(state(&mut s, &mut m, p, json!({"hook_event_name":"Notification","session_id":"d1","message":"Droid needs your permission to use Edit"})), Some("permission"), "an untyped notice by its wording");
    assert_eq!(state(&mut s, &mut m, p, json!({"hook_event_name":"PostToolUse","session_id":"d1","tool_name":"Execute"})), Some("working"));
    assert_eq!(normalize_with(&mut m, p, &json!({"hook_event_name":"Notification","session_id":"d1","notification_type":"auth_success","message":"Signed in"})), None, "other notices are ignored");
    assert_eq!(normalize_with(&mut m, p, &json!({"hook_event_name":"Notification","session_id":"d1","message":"Something happened"})), None);
    assert_eq!(state(&mut s, &mut m, p, json!({"hook_event_name":"Notification","session_id":"d1","notification_type":"elicitation_dialog","message":"Which branch?"})), Some("waiting"));
    assert_eq!(s.resolved(), "waiting");
    assert_eq!(state(&mut s, &mut m, p, json!({"hook_event_name":"Notification","session_id":"d1","notification_type":"idle_prompt","message":"Droid is waiting for your input"})), Some("done"), "idle is done");
    assert_eq!(s.resolved(), "done");
}

#[test]
fn stat_013_droid_never_reads_ctrl_c_as_an_interruption() {
    let (mut s, mut m) = (Session::default(), Memory::default());
    assert_eq!(state(&mut s, &mut m, "/droid", json!({"hook_event_name":"UserPromptSubmit","session_id":"d2","prompt":"go"})), Some("working"));
    s.cancel();
    assert_eq!(state(&mut s, &mut m, "/droid", json!({"hook_event_name":"Stop","session_id":"d2"})), Some("done"));
    assert_eq!(s.resolved(), "done");
    // The same keystroke before a Codex stop still reads interrupted (the rule is Droid's alone).
    let mut c = Session::default();
    c.apply(Agent::Codex, &json!({"hook_event_name":"UserPromptSubmit","prompt":"go"}));
    c.cancel();
    assert_eq!(c.apply(Agent::Codex, &json!({"hook_event_name":"Stop"})).map(|(x, _)| x.state), Some("interrupted"));
}

#[test]
fn stat_015_kimi_events_and_a_rate_limit_failure_is_blocked() {
    let (mut s, mut m) = (Session::default(), Memory::default());
    let p = "/kimi";
    assert_eq!(state(&mut s, &mut m, p, json!({"hook_event_name":"UserPromptSubmit","session_id":"k1","prompt":"go"})), Some("working"));
    assert_eq!(state(&mut s, &mut m, p, json!({"hook_event_name":"PreToolUse","session_id":"k1","tool_name":"Shell","tool_input":{"command":"ls"}})), Some("working"));
    assert_eq!(state(&mut s, &mut m, p, json!({"hook_event_name":"PermissionRequest","session_id":"k1","tool_name":"Shell","tool_input":{"command":"rm x"}})), Some("permission"));
    assert_eq!(state(&mut s, &mut m, p, json!({"hook_event_name":"PostToolUseFailure","session_id":"k1","tool_name":"Shell"})), Some("working"));
    assert_eq!(state(&mut s, &mut m, p, json!({"hook_event_name":"Stop","session_id":"k1"})), Some("done"));
    let e = normalize_with(&mut m, p, &json!({"hook_event_name":"StopFailure","session_id":"k1","error_type":"rate_limit","message":"Too many requests"})).unwrap();
    let c = change(&e).unwrap().unwrap();
    assert_eq!((c.state, c.cause, c.detail.as_deref(), c.session.as_deref()), ("blocked", Some("limit"), Some("Too many requests"), Some("k1")));
    assert_eq!(s.apply(Agent::Vendor, &e).map(|(c, _)| c.state), Some("blocked"));
    assert_eq!(s.resolved(), "blocked", "a limit failure is never done");
    let e = normalize_with(&mut m, p, &json!({"hook_event_name":"StopFailure","session_id":"k1","error":"server error"})).unwrap();
    assert_eq!(change(&e).unwrap().unwrap().cause, Some("error"));
    assert_eq!(normalize_with(&mut m, p, &json!({"hook_event_name":"Notification","session_id":"k1"})), None);
}

#[test]
fn stat_012_cursor_install_keeps_the_users_entries_and_removal_gives_back_the_bytes() {
    let home = scratch("cursor");
    let file = cursor_file(&home);
    fs::create_dir_all(file.parent().unwrap()).unwrap();
    let original = "{\n  \"version\": 1,\n  \"hooks\": {\n    \"stop\": [\n      {\n        \"command\": \"./mine.sh\"\n      }\n    ],\n    \"afterFileEdit\": [\n      {\n        \"command\": \"./fmt.sh\"\n      }\n    ]\n  }\n}\n";
    fs::write(&file, original).unwrap();
    assert!(install_cursor(&home, &file).unwrap());
    let v: Value = serde_json::from_str(&read(&file)).unwrap();
    assert_eq!(v["version"], 1);
    assert_eq!(v["hooks"]["stop"][0]["command"], "./mine.sh", "the user's entry stays first");
    assert!(names_mine(&v["hooks"]["stop"][1]));
    assert_eq!(v["hooks"]["afterFileEdit"][0]["command"], "./fmt.sh");
    assert!(CURSOR_EVENTS.iter().all(|e| v["hooks"][e].as_array().unwrap().iter().filter(|h| names_mine(h)).count() == 1));
    assert!(v["hooks"].get("sessionStart").is_none() && v["hooks"].get("sessionEnd").is_none());
    assert!(home.join(SCRIPT_DIR_FOR_TESTS).join(CURSOR_SCRIPT).is_file());
    assert!(!install_cursor(&home, &file).unwrap(), "a second install changes nothing");
    assert_eq!(inspect_cursor(&file).0, "installed");
    assert!(remove_cursor(&home, &file).unwrap());
    assert_eq!(read(&file), original, "removal gives back the user's bytes");
    assert_eq!(inspect_cursor(&file).0, "not installed");
    assert!(!remove_cursor(&home, &file).unwrap());
}

#[test]
fn stat_012_cursor_file_kolux_created_goes_and_bad_shapes_are_left_alone() {
    let home = scratch("cursor-new");
    let file = cursor_file(&home);
    assert!(install_cursor(&home, &file).unwrap());
    assert_eq!(serde_json::from_str::<Value>(&read(&file)).unwrap()["version"], 1);
    assert!(remove_cursor(&home, &file).unwrap());
    assert!(!file.exists(), "a file Kolux created goes with its entries");
    for bad in ["[1]", "{\"hooks\": 3}", "{\"hooks\": {\"stop\": {}}}", "not json"] {
        fs::write(&file, bad).unwrap();
        assert!(install_cursor(&home, &file).unwrap_err().contains("left alone"), "{bad}");
        assert_eq!(read(&file), bad);
    }
}

#[test]
fn stat_013_droid_install_goes_where_droid_reads_and_removal_gives_back_the_bytes() {
    let home = scratch("droid");
    let dir = home.join(".factory");
    fs::create_dir_all(&dir).unwrap();
    // Without hooks.json: the hooks key of settings.json, beside the user's other settings.
    let settings = dir.join("settings.json");
    let original = "{\n  \"model\": \"x\",\n  \"hooks\": {\n    \"PreToolUse\": [\n      {\n        \"matcher\": \"Execute\",\n        \"hooks\": [\n          {\n            \"type\": \"command\",\n            \"command\": \"./guard.sh\"\n          }\n        ]\n      }\n    ]\n  }\n}\n";
    fs::write(&settings, original).unwrap();
    assert_eq!(droid_file(&home), settings);
    assert!(install_droid(&home, &settings).unwrap());
    let v: Value = serde_json::from_str(&read(&settings)).unwrap();
    assert_eq!(v["model"], "x");
    assert_eq!(v["hooks"]["PreToolUse"][0]["hooks"][0]["command"], "./guard.sh");
    assert_eq!(v["hooks"]["PreToolUse"][1]["matcher"], "*");
    assert_eq!(v["hooks"]["Stop"][0]["hooks"][0]["timeout"], 10);
    assert!(v["hooks"].get("PermissionRequest").is_none(), "an event Factory does not document is not installed");
    assert!(!install_droid(&home, &settings).unwrap());
    assert_eq!(inspect_droid(&home).0, "installed");
    // STAT-013: hooks switched off globally make the install partial.
    let mut off = v.clone();
    off["hooksDisabled"] = json!(true);
    fs::write(&settings, serde_json::to_string_pretty(&off).unwrap()).unwrap();
    let (st, why) = inspect_droid(&home);
    assert_eq!(st, "partial");
    assert!(why.unwrap().contains("hooksDisabled"));
    fs::write(&settings, serde_json::to_string_pretty(&v).unwrap()).unwrap();
    assert!(remove_droid(&home, &settings).unwrap());
    assert_eq!(read(&settings), original);

    // With hooks.json: events sit at its top level.
    let hooks = dir.join("hooks.json");
    let user = "{\n  \"Stop\": [\n    {\n      \"hooks\": [\n        {\n          \"type\": \"command\",\n          \"command\": \"./done.sh\"\n        }\n      ]\n    }\n  ]\n}\n";
    fs::write(&hooks, user).unwrap();
    assert_eq!(droid_file(&home), hooks);
    assert!(install_droid(&home, &hooks).unwrap());
    let h: Value = serde_json::from_str(&read(&hooks)).unwrap();
    assert!(h.get("hooks").is_none(), "no wrapper in hooks.json");
    assert_eq!(h["Stop"][0]["hooks"][0]["command"], "./done.sh");
    assert!(DROID_EVENTS.iter().all(|e| h[e].is_array()));
    assert_eq!(read(&settings), original, "settings.json is not touched while hooks.json is read");
    assert_eq!(inspect_droid(&home).0, "installed");
    assert!(remove_droid(&home, &hooks).unwrap());
    assert_eq!(read(&hooks), user);
}

#[test]
fn stat_015_kimi_block_goes_after_the_users_settings_and_comes_out_byte_for_byte() {
    let home = scratch("kimi");
    let file = kimi_file(&home);
    fs::create_dir_all(file.parent().unwrap()).unwrap();
    for original in ["default_model = \"k2\"\n\n[[hooks]]\nevent = \"Stop\"\ncommand = \"notify\"\n", "default_model = \"k2\"", "# only a comment\r\n"] {
        fs::write(&file, original).unwrap();
        assert!(install_kimi(&home, &file).unwrap());
        let text = read(&file);
        assert!(text.starts_with(original), "the user's settings come first, untouched");
        assert_eq!(text.matches("# >>> kolux").count(), 1);
        assert!(KIMI_EVENTS.iter().all(|e| text.contains(&format!("event = \"{e}\""))));
        assert!(text.contains("timeout = 10") && text.contains(KIMI_END));
        assert!(!install_kimi(&home, &file).unwrap(), "a second install never doubles the block");
        assert_eq!(inspect_kimi(&file).0, "installed");
        assert!(remove_kimi(&home, &file).unwrap());
        assert_eq!(read(&file), original, "removal restores the bytes");
        assert_eq!(inspect_kimi(&file).0, "not installed");
        let _ = fs::remove_file(backup_of(&file));
        let _ = fs::remove_file(target_dir(&home, &file).join(BACKUP_RECORD));
    }
}

#[test]
fn stat_015_kimi_recovers_a_lost_end_line_and_replaces_a_former_name_block() {
    let home = scratch("kimi-edit");
    let file = kimi_file(&home);
    fs::create_dir_all(file.parent().unwrap()).unwrap();
    let user = "a = 1\n";
    fs::write(&file, user).unwrap();
    install_kimi(&home, &file).unwrap();
    let text = read(&file);
    // A hand edit deleted the end line, and the user added a setting after the block.
    let edited = format!("{}[ui]\ntheme = \"dark\"\n", text.replace(&format!("{KIMI_END}\n"), ""));
    fs::write(&file, &edited).unwrap();
    assert_eq!(inspect_kimi(&file).0, "partial");
    assert!(remove_kimi(&home, &file).unwrap());
    assert_eq!(read(&file), "a = 1\n[ui]\ntheme = \"dark\"\n", "the block went, the user's later lines stayed");
    // A block under the former name is taken as Kolux's and replaced, not doubled.
    let path = home.join(SCRIPT_DIR_FOR_TESTS).join(KIMI_SCRIPT).to_string_lossy().replace('\\', "/");
    let old = format!("a = 1\n# >>> kolux hooks >>>\n[[hooks]]\nevent = \"Stop\"\ncommand = {}\n# <<< kolux hooks <<<\n", toml_str(&quoted(&path)));
    fs::write(&file, &old).unwrap();
    assert!(install_kimi(&home, &file).unwrap());
    let text = read(&file);
    assert_eq!(text.matches("# >>> kolux").count(), 1);
    assert!(text.contains(KIMI_BEGIN));
    assert!(remove_kimi(&home, &file).unwrap());
    assert_eq!(read(&file), "a = 1\n");
    // A plain hooks key would clash with the tables: left alone.
    fs::write(&file, "hooks = []\n").unwrap();
    assert!(install_kimi(&home, &file).unwrap_err().contains("left alone"));
    assert_eq!(read(&file), "hooks = []\n");
}

#[test]
fn stat_015_kimi_file_kolux_created_goes_and_its_script_prints_nothing() {
    let home = scratch("kimi-new");
    let file = kimi_file(&home);
    assert!(install_kimi(&home, &file).unwrap());
    assert!(remove_kimi(&home, &file).unwrap());
    assert!(!file.exists());
    assert_eq!(script("kimi", "kimi", false), read(&home.join(SCRIPT_DIR_FOR_TESTS).join(KIMI_SCRIPT)));
    assert_ne!(script("kimi", "kimi", false), script("kimi", "kimi", true), "the printing variant differs, and Kimi gets the silent one");
}

#[test]
fn t_121_rows_name_each_agent() {
    let home = scratch("rows");
    let rows = rows(&home);
    assert_eq!(rows.iter().map(|r| r["agent"].as_str().unwrap()).collect::<Vec<_>>(), ["cursor", "droid", "kimi"]);
    assert!(rows.iter().all(|r| r["state"] == "not installed"));
    install_cursor(&home, &cursor_file(&home)).unwrap();
    install_droid(&home, &droid_file(&home)).unwrap();
    install_kimi(&home, &kimi_file(&home)).unwrap();
    assert!(super::rows(&home).iter().all(|r| r["state"] == "installed"), "{:?}", super::rows(&home));
}

const SCRIPT_DIR_FOR_TESTS: &str = super::super::super::SCRIPT_DIR;
