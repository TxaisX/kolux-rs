//! T-121 (STAT-012..016): the five vendors' events drive the dot, and each vendor's settings are
//! written next to the user's own entries and taken out again without a trace.

use super::*;
use crate::status::{Agent, Session};

fn state(s: &mut Session, path: &str, j: Value) -> Option<&'static str> {
    let e = normalize(path, &j)?;
    s.apply(Agent::Vendor, &e).map(|(c, _)| c.state)
}

#[test]
fn stat_012_cursor_events_drive_the_dot_and_its_hooks_are_answered() {
    let mut s = Session::default();
    assert_eq!(normalize("/cursor", &json!({"hook_event_name":"beforeSubmitPrompt","prompt":"fix it","conversation_id":"c1"})).unwrap(), json!({"hook_event_name":"UserPromptSubmit","prompt":"fix it","session_id":"c1"}));
    assert_eq!(state(&mut s, "/cursor", json!({"hook_event_name":"beforeSubmitPrompt","prompt":"fix it","conversation_id":"c1"})), Some("working"));
    assert_eq!(state(&mut s, "/cursor", json!({"hook_event_name":"beforeShellExecution","command":"ls"})), Some("working"));
    let shell = normalize("/cursor", &json!({"hook_event_name":"beforeShellExecution","command":"ls"})).unwrap();
    assert_eq!((shell["tool_name"].as_str(), shell["tool_input"]["command"].as_str()), (Some("Shell"), Some("ls")));
    assert_eq!(state(&mut s, "/cursor", json!({"hook_event_name":"preToolUse","tool_name":"Read","tool_input":{"path":"a.rs"}})), Some("working"));
    assert_eq!(state(&mut s, "/cursor", json!({"hook_event_name":"postToolUseFailure","tool_name":"Read"})), Some("working"));
    assert_eq!(state(&mut s, "/cursor", json!({"hook_event_name":"beforeMCPExecution","tool_name":"mcp_x"})), Some("working"));
    assert_eq!(normalize("/cursor", &json!({"hook_event_name":"afterAgentResponse","text":"Done."})), None, "COMPAT 3.5: the reply text alone ends nothing");
    assert_eq!(state(&mut s, "/cursor", json!({"hook_event_name":"stop","status":"completed"})), Some("done"));
    assert_eq!(state(&mut s, "/cursor", json!({"hook_event_name":"beforeSubmitPrompt","prompt":"again"})), Some("working"));
    assert_eq!(state(&mut s, "/cursor", json!({"hook_event_name":"stop","status":"aborted"})), Some("interrupted"), "a stop that is not completed is an interruption");
    assert_eq!(state(&mut s, "/cursor", json!({"hook_event_name":"sessionStart"})), Some("working"), "mapped though not installed");
    assert_eq!(state(&mut s, "/cursor", json!({"hook_event_name":"sessionEnd"})), Some("done"));
    assert_eq!(normalize("/cursor", &json!({"hook_event_name":"mystery"})), None);
    // COMPAT 3.1: the hooks that must answer get "continue" or "allow", the rest print nothing.
    assert_eq!(reply("/cursor", br#"{"hook_event_name":"beforeSubmitPrompt"}"#).as_deref(), Some(r#"{"continue":true}"#));
    for e in ["preToolUse", "beforeShellExecution", "beforeMCPExecution"] {
        assert_eq!(reply("/cursor", format!(r#"{{"hook_event_name":"{e}"}}"#).as_bytes()).as_deref(), Some(r#"{"permission":"allow"}"#), "{e}");
    }
    assert_eq!(reply("/cursor", br#"{"hook_event_name":"stop"}"#), None);
    assert_eq!(reply("/droid", br#"{"hook_event_name":"PreToolUse"}"#), None);
    assert_eq!(reply("/cursor", b"not json"), None);
}

#[test]
fn stat_013_droid_events_drive_the_dot_and_a_permission_waits() {
    let mut s = Session::default();
    assert_eq!(normalize("/droid", &json!({"hook_event_name":"SessionStart","session_id":"d1"})), None, "COMPAT 3.5: no change");
    assert_eq!(state(&mut s, "/droid", json!({"hook_event_name":"UserPromptSubmit","prompt":"go","session_id":"d1"})), Some("working"));
    assert_eq!(state(&mut s, "/droid", json!({"hook_event_name":"PreToolUse","tool_name":"Edit","tool_input":{"path":"a"}})), Some("working"));
    assert_eq!(state(&mut s, "/droid", json!({"hook_event_name":"PermissionRequest","tool_name":"Execute","tool_input":{"command":"rm"}})), Some("waiting"));
    assert_eq!(state(&mut s, "/droid", json!({"hook_event_name":"PostToolUse","tool_name":"Execute"})), Some("working"));
    assert_eq!(state(&mut s, "/droid", json!({"hook_event_name":"Notification","notification_type":"permission_prompt","message":"x"})), Some("waiting"));
    assert_eq!(normalize("/droid", &json!({"hook_event_name":"Notification","notification_type":"auth_success"})), None);
    assert_eq!(normalize("/droid", &json!({"hook_event_name":"SubagentStop"})), None);
    assert_eq!(state(&mut s, "/droid", json!({"hook_event_name":"Notification","notification_type":"idle_prompt"})), Some("done"));
    assert_eq!(state(&mut s, "/droid", json!({"hook_event_name":"UserPromptSubmit","prompt":"more"})), Some("working"));
    assert_eq!(state(&mut s, "/droid", json!({"hook_event_name":"Stop"})), Some("done"));
}

#[test]
fn stat_014_command_code_tool_events_and_stop() {
    let mut s = Session::default();
    assert_eq!(state(&mut s, "/command-code", json!({"hook_event_name":"PreToolUse","tool_name":"Bash","tool_input":{"command":"ls"},"session_id":"cc1"})), Some("working"));
    assert_eq!(normalize("/command-code", &json!({"hook_event_name":"PreToolUse","tool_name":"Bash","session_id":"cc1"})).unwrap()["session_id"], "cc1");
    assert_eq!(state(&mut s, "/command-code", json!({"hook_event_name":"PostToolUse","tool_name":"Bash"})), Some("working"));
    assert_eq!(state(&mut s, "/command-code", json!({"hook_event_name":"Stop"})), Some("done"));
    assert_eq!(normalize("/command-code", &json!({"hook_event_name":"SessionStart"})), None, "not installed, not read");
}

#[test]
fn stat_015_kimi_events_drive_the_dot_and_a_flagged_stop_is_an_interruption() {
    let mut s = Session::default();
    assert_eq!(state(&mut s, "/kimi", json!({"hook_event_name":"UserPromptSubmit","prompt":"go","session_id":"k1"})), Some("working"));
    assert_eq!(state(&mut s, "/kimi", json!({"hook_event_name":"PreToolUse","tool_name":"Shell"})), Some("working"));
    assert_eq!(state(&mut s, "/kimi", json!({"hook_event_name":"PostToolUseFailure","tool_name":"Shell","error":"x"})), Some("working"));
    assert_eq!(state(&mut s, "/kimi", json!({"hook_event_name":"PermissionRequest","tool_name":"Shell"})), Some("permission"));
    assert_eq!(state(&mut s, "/kimi", json!({"hook_event_name":"PostToolUse","tool_name":"Shell"})), Some("working"));
    assert_eq!(state(&mut s, "/kimi", json!({"hook_event_name":"Stop","last_assistant_message":"All done."})), Some("done"));
    assert_eq!(s.reply.as_deref(), Some("All done."));
    assert_eq!(state(&mut s, "/kimi", json!({"hook_event_name":"UserPromptSubmit","prompt":"more"})), Some("working"));
    assert_eq!(state(&mut s, "/kimi", json!({"hook_event_name":"Stop","interrupted":true})), Some("interrupted"));
    assert_eq!(state(&mut s, "/kimi", json!({"hook_event_name":"UserPromptSubmit","prompt":"again"})), Some("working"));
    assert_eq!(state(&mut s, "/kimi", json!({"hook_event_name":"StopFailure","error":"rate limit"})), Some("done"), "DT-C13: no cause is read for Kimi yet; a failed stop still ends the turn");
}

#[test]
fn stat_016_hermes_hook_points_drive_the_dot() {
    let mut s = Session::default();
    assert_eq!(state(&mut s, "/hermes", json!({"event":"on_session_start","session_id":"h1"})), Some("working"));
    assert_eq!(state(&mut s, "/hermes", json!({"event":"pre_llm_call","session_id":"h1","user_message":"fix"})), Some("working"));
    assert_eq!(normalize("/hermes", &json!({"event":"pre_llm_call","session_id":"h1","user_message":"fix"})).unwrap(), json!({"hook_event_name":"UserPromptSubmit","prompt":"fix","session_id":"h1"}));
    assert_eq!(state(&mut s, "/hermes", json!({"event":"pre_tool_call","tool_name":"terminal"})), Some("working"));
    assert_eq!(state(&mut s, "/hermes", json!({"event":"pre_approval_request","tool_name":"terminal"})), Some("waiting"));
    assert_eq!(state(&mut s, "/hermes", json!({"event":"post_approval_response","tool_name":"terminal"})), Some("working"));
    assert_eq!(state(&mut s, "/hermes", json!({"event":"post_tool_call","tool_name":"terminal"})), Some("working"));
    assert_eq!(state(&mut s, "/hermes", json!({"event":"post_llm_call","session_id":"h1","assistant_response":"Fixed."})), Some("done"));
    assert_eq!(s.reply.as_deref(), Some("Fixed."));
    assert_eq!(state(&mut s, "/hermes", json!({"event":"pre_llm_call","user_message":"more"})), Some("working"));
    assert_eq!(state(&mut s, "/hermes", json!({"event":"on_session_end","completed":false,"interrupted":true})), Some("interrupted"));
    assert_eq!(state(&mut s, "/hermes", json!({"event":"on_session_reset"})), None, "late events after an interrupt change nothing (STAT-028)");
    assert_eq!(normalize("/hermes", &json!({"event":"on_session_finalize"})).unwrap()["hook_event_name"], "Stop");
    assert_eq!(normalize("/hermes", &json!({"event":"mystery"})), None);
}

#[test]
fn routes_agents_and_scripts() {
    assert!(is_route("/cursor") && is_route("/droid") && is_route("/command-code") && is_route("/kimi") && is_route("/hermes"));
    assert!(!is_route("/claude") && !is_route("/gemini") && !is_route("/cursor/x"));
    assert_eq!((agent_of("cursor"), agent_of("/kimi"), agent_of("codex")), (Some("cursor"), Some("kimi"), None));
    assert!(manages("hermes") && !manages("amp"));
    let sh = kimi_script();
    assert!(sh.starts_with("#!/bin/sh\n") && !sh.contains('\r') && sh.contains("Written by Kolux RS") && sh.contains("/kimi\"") && sh.contains(SPOOL_FILE));
    assert!(!sh.contains("prompt\"") && !sh.contains("tool_input"), "the spooled line never holds the prompt or a tool's input");
    let py = hermes_plugin();
    assert!(py.starts_with("# Kolux RS status plugin for Hermes. Written by Kolux RS") && py.contains("def register(ctx)") && py.contains("/hermes"));
    for h in HERMES_HOOKS {
        assert!(py.contains(&format!("\"{h}\"")), "{h}");
    }
    assert_eq!(kimi_file_in(Path::new("H"), Some(PathBuf::from("K"))), Path::new("K").join("config.toml"));
    assert_eq!(kimi_file_in(Path::new("H"), None), Path::new("H").join(".kimi-code").join("config.toml"));
}

fn scratch(tag: &str) -> PathBuf {
    let d = std::env::temp_dir().join(format!("kolux-rs-vendors-more-{tag}-{}", std::process::id()));
    let _ = fs::remove_dir_all(&d);
    fs::create_dir_all(&d).unwrap();
    d
}

fn read(file: &Path) -> Value {
    serde_json::from_str(&fs::read_to_string(file).unwrap()).unwrap()
}

#[test]
fn stat_012_cursor_entries_sit_beside_the_users_and_leave_without_a_trace() {
    let home = scratch("cursor");
    let file = cursor_file(&home);
    fs::create_dir_all(file.parent().unwrap()).unwrap();
    let before = r#"{"version":1,"hooks":{"beforeShellExecution":[{"command":"./my-check.sh","timeout":5}]}}"#;
    fs::write(&file, before).unwrap();
    assert!(install_cursor(&home, &file).unwrap());
    assert!(!install_cursor(&home, &file).unwrap(), "a second install changes nothing");
    let v = read(&file);
    assert_eq!(v["version"], 1);
    assert_eq!(v["hooks"]["beforeShellExecution"][0]["command"], "./my-check.sh");
    assert!(v["hooks"]["beforeShellExecution"][1]["command"].as_str().unwrap().ends_with("cursor.cmd"), "a flat entry, not a group: {v}");
    assert_eq!(v["hooks"]["stop"][0]["timeout"], 10);
    assert_eq!(v["hooks"].as_object().unwrap().len(), 8);
    assert_eq!(switch::inspect(&file, &CURSOR_EVENTS).0, "installed");
    assert!(remove_hooks(&home, &file).unwrap());
    assert_eq!(fs::read_to_string(&file).unwrap(), before, "byte for byte the user's file again");
    assert!(!remove_hooks(&home, &file).unwrap());
    // A file Kolux created goes with the last entry; its version key does not keep it alive.
    let file = cursor_file(&scratch("cursor-new"));
    let home = file.parent().unwrap().parent().unwrap().to_path_buf();
    assert!(install_cursor(&home, &file).unwrap());
    assert_eq!(read(&file)["version"], 1);
    assert!(remove_hooks(&home, &file).unwrap());
    assert!(!file.exists(), "the file Kolux created is gone");
    fs::write(&file, r#"{"hooks":{"stop":"no"}}"#).unwrap();
    assert!(install_cursor(&home, &file).unwrap_err().contains("left alone"));
    let _ = fs::remove_dir_all(&home);
}

#[test]
fn stat_013_014_droid_and_command_code_take_claude_style_groups() {
    let home = scratch("droid-cc");
    let droid = droid_file(&home);
    fs::create_dir_all(droid.parent().unwrap()).unwrap();
    fs::write(&droid, r#"{"model":"x","hooks":{"PreToolUse":[{"matcher":"Edit","hooks":[{"type":"command","command":"lint"}]}]}}"#).unwrap();
    assert!(install_droid(&home, &droid).unwrap());
    let v = read(&droid);
    assert_eq!(v["model"], "x");
    assert_eq!(v["hooks"]["PreToolUse"].as_array().unwrap().len(), 2);
    assert_eq!(v["hooks"]["PreToolUse"][1]["matcher"], "*");
    assert!(v["hooks"]["PermissionRequest"][0]["hooks"][0]["command"].as_str().unwrap().ends_with("droid.cmd"));
    assert_eq!(v["hooks"]["Notification"][0]["hooks"][0]["timeout"], 10);
    assert_eq!(v["hooks"].as_object().unwrap().len(), 8);
    assert_eq!(switch::inspect(&droid, &DROID_EVENTS).0, "installed");
    assert!(remove_hooks(&home, &droid).unwrap());
    assert_eq!(read(&droid), json!({"model":"x","hooks":{"PreToolUse":[{"matcher":"Edit","hooks":[{"type":"command","command":"lint"}]}]}}));
    let cc = command_code_file(&home);
    assert_eq!(switch::inspect(&cc, &COMMAND_CODE_EVENTS).0, "not installed");
    assert!(install_command_code(&home, &cc).unwrap());
    let v = read(&cc);
    assert_eq!(v["hooks"].as_object().unwrap().keys().collect::<Vec<_>>(), ["PreToolUse", "PostToolUse", "Stop"]);
    assert!(v["hooks"]["Stop"][0].get("matcher").is_none());
    assert_eq!(switch::inspect(&cc, &COMMAND_CODE_EVENTS).0, "installed");
    assert!(remove_hooks(&home, &cc).unwrap());
    assert!(!cc.exists(), "the file Kolux created is gone");
    let names: Vec<String> = rows(&home).iter().map(|r| r["agent"].as_str().unwrap().to_string()).collect();
    assert_eq!(names, ["cursor", "droid", "command-code", "kimi", "hermes"]);
    let _ = fs::remove_dir_all(&home);
}

#[test]
fn stat_015_kimi_block_sits_between_markers_and_leaves_the_users_toml_as_it_was() {
    let home = scratch("kimi");
    let file = kimi_file_in(&home, None);
    fs::create_dir_all(file.parent().unwrap()).unwrap();
    let before = "[general]\ntheme = \"dark\"\n\n[[hooks]]\nevent = \"Stop\"\ncommand = \"notify\"\n";
    fs::write(&file, before).unwrap();
    assert!(install_kimi(&home, &file).unwrap());
    assert!(!install_kimi(&home, &file).unwrap(), "a second install changes nothing");
    let text = fs::read_to_string(&file).unwrap();
    assert!(text.starts_with(before), "the user's text stays as it was, the block after it");
    assert_eq!(text.matches(KIMI_START).count(), 1);
    assert!(text.ends_with(&(KIMI_END.to_owned() + "\n")));
    let doc: toml_edit::DocumentMut = text.parse().unwrap();
    let hooks = doc["hooks"].as_array_of_tables().unwrap();
    assert_eq!(hooks.len(), 8, "the user's table and Kolux's seven");
    let mine = hooks.iter().nth(1).unwrap();
    assert_eq!(mine.len(), 4, "only event, matcher, command, timeout: anything else stops Kimi loading the file");
    assert!(mine["command"].as_str().unwrap().starts_with("bash ") && mine["command"].as_str().unwrap().ends_with("/kimi.sh"), "{mine}");
    assert_eq!(mine["timeout"].as_integer(), Some(10));
    assert_eq!(inspect_kimi(&file).0, "installed");
    // A block from an older Kolux, under the agent's former name, is replaced.
    fs::write(&file, format!("{before}\n# >>> Kolux RS hooks (Kimi CLI) >>>\n[[hooks]]\nevent = \"Stop\"\ncommand = \"old\"\n# <<< Kolux RS hooks (Kimi CLI) <<<\n")).unwrap();
    assert!(install_kimi(&home, &file).unwrap());
    let text = fs::read_to_string(&file).unwrap();
    assert!(!text.contains("Kimi CLI") && !text.contains("\"old\"") && text.matches("[[hooks]]").count() == 8);
    assert!(remove_kimi(&home, &file).unwrap());
    assert_eq!(fs::read_to_string(&file).unwrap(), before, "byte for byte the user's file again");
    assert!(!remove_kimi(&home, &file).unwrap());
    assert_eq!(inspect_kimi(&file).0, "not installed");
    fs::write(&file, "this = is not toml =").unwrap();
    assert!(install_kimi(&home, &file).unwrap_err().contains("not TOML"));
    // A file Kolux created goes with its block.
    let file = kimi_file_in(&home, Some(home.join("kimi-home")));
    assert!(install_kimi(&home, &file).unwrap());
    assert!(fs::read_to_string(&file).unwrap().starts_with(KIMI_START));
    assert!(remove_kimi(&home, &file).unwrap());
    assert!(!file.exists());
    let _ = fs::remove_dir_all(&home);
}

#[test]
fn stat_016_hermes_plugin_files_are_kolux_s_alone_and_its_yaml_switch_is_read_not_written() {
    let home = scratch("hermes");
    let dir = home.join(".hermes").join("plugins").join(HERMES_PLUGIN);
    assert_eq!(inspect_hermes(&dir).0, "not installed");
    assert!(install_hermes(&dir).unwrap());
    assert!(!install_hermes(&dir).unwrap());
    assert_eq!(inspect_hermes(&dir).0, "installed");
    assert_eq!(fs::read_to_string(dir.join("__init__.py")).unwrap(), hermes_plugin());
    assert!(fs::read_to_string(dir.join("plugin.yaml")).unwrap().contains(&format!("name: {HERMES_PLUGIN}")));
    let config = home.join(".hermes").join("config.yaml");
    fs::write(&config, "model: x\nplugins:\n  disabled:\n    - other\n    - kolux-status\n").unwrap();
    assert_eq!(inspect_hermes(&dir).0, "disabled");
    fs::write(&config, "plugins:\n  disabled: [other, \"kolux-status\"]\n").unwrap();
    assert_eq!(inspect_hermes(&dir).0, "disabled");
    fs::write(&config, "plugins:\n  disabled:\n    - other\nmodel: kolux-status\n").unwrap();
    assert_eq!(inspect_hermes(&dir).0, "installed");
    assert!(!install_hermes(&dir).unwrap(), "no install touches config.yaml");
    assert_eq!(fs::read_to_string(&config).unwrap(), "plugins:\n  disabled:\n    - other\nmodel: kolux-status\n");
    assert!(remove_hermes(&dir).unwrap());
    assert!(!dir.exists(), "the plugin folder goes with Kolux's two files");
    fs::create_dir_all(&dir).unwrap();
    fs::write(dir.join("__init__.py"), "def register(ctx):\n    pass\n").unwrap();
    assert!(install_hermes(&dir).unwrap_err().contains("not Kolux's own plugin"));
    assert!(!remove_hermes(&dir).unwrap());
    assert!(dir.join("__init__.py").exists(), "the user's plugin stays");
    assert_eq!(inspect_hermes(&dir).0, "error");
    let _ = fs::remove_dir_all(&home);
}
