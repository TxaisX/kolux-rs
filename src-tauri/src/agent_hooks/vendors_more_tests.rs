//! T-121 (STAT-012..016) and T-122 (STAT-017..021): the nine vendors' events drive the dot, and each vendor's settings are
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
    // COMPAT 3.1: beforeSubmitPrompt, which must answer, gets "continue". FIX-1 (council FIX-SOON 4): the three
    // before-tool events get NO answer, since Cursor's docs do not say whether "allow" skips its own approval
    // prompt; no output fails open there (failClosed is false by default), so Cursor asks as it would without Kolux.
    assert_eq!(reply("/cursor", br#"{"hook_event_name":"beforeSubmitPrompt"}"#).as_deref(), Some(r#"{"continue":true}"#));
    for e in ["preToolUse", "beforeShellExecution", "beforeMCPExecution"] {
        assert_eq!(reply("/cursor", format!(r#"{{"hook_event_name":"{e}"}}"#).as_bytes()), None, "{e}: never answered");
    }
    for e in CURSOR_EVENTS.iter().chain(["sessionStart", "sessionEnd"].iter()) {
        let r = reply("/cursor", format!(r#"{{"hook_event_name":"{e}","tool_name":"Shell","command":"rm -rf x"}}"#).as_bytes());
        assert!(!r.as_deref().unwrap_or("").contains("allow"), "{e}: no Cursor reply ever carries allow: {r:?}");
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
    assert!(!is_route("/claude") && !is_route("/gemini") && !is_route("/cursor/x") && !is_route("/grok/x"));
    assert!(is_route("/copilot") && is_route("/copilot/preToolUse") && is_route("/grok") && is_route("/devin/Stop") && is_route("/pi"));
    assert_eq!((agent_of("/copilot/preToolUse"), agent_of("devin/Stop"), agent_of("/mimo-code")), (Some("copilot"), Some("devin"), None));
    assert!(manages("pi") && !manages("mimo-code") && !manages("omp"));
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

#[test]
fn fix_1_hermes_and_pi_post_on_loopback_past_any_proxy_with_a_digits_only_port() {
    // Council FIX-BEFORE 1: Python's default opener honours HTTP_PROXY and the Windows system proxy, 127.0.0.1 included.
    let py = hermes_plugin();
    assert!(py.contains("urllib.request.build_opener(urllib.request.ProxyHandler({}), _NoRedirect())"), "an opener with no proxies at all and no redirects: {py}");
    assert!(!py.contains("urlopen("), "never the default opener");
    assert!(py.contains("import re") && py.contains(r#"re.fullmatch(r"[0-9]{1,5}", port)"#), "a port that is not 1-5 digits is refused");
    // FIX-2 (council AFTER 1): build_opener's default HTTPRedirectHandler would re-send the token and pane name to a
    // 301/302/303/307/308 Location target; a handler whose redirect_request returns None refuses every redirect.
    assert!(py.contains("class _NoRedirect(urllib.request.HTTPRedirectHandler):"), "{py}");
    assert!(py.contains("    def redirect_request(self, req, fp, code, msg, headers, newurl):\n        return None\n"), "{py}");
    // Council FIX-SOON 3: fetch honours HTTP_PROXY under Bun, and under Node with NODE_USE_ENV_PROXY; a port such as
    // `1@host` can no longer turn 127.0.0.1 into userinfo.
    let js = pi_extension();
    assert!(js.contains("import http from \"node:http\";"));
    assert!(js.contains(r#"http.request({ host: "127.0.0.1", port: Number(port), path: "/pi", method: "POST", agent: false,"#), "{js}");
    // FIX-2 (council FIX-SOON 1): from Node 24.5, NODE_USE_ENV_PROXY=1 points http.globalAgent at HTTP_PROXY, so the request
    // gets its own agent (`agent: false`); a port of 65536-99999 passes the digits check but makes http.request throw
    // ERR_SOCKET_BAD_PORT at once, so the bound is checked and the request sits in try/catch.
    assert!(js.contains(r#"if (!/^\d{1,5}$/.test(port) || Number(port) > 65535 || !token) return;"#), "{js}");
    assert!(js.contains("  try {\n    const req = http.request(") && js.contains("    req.end(data);\n  } catch {}\n"), "{js}");
    assert_eq!(js.matches("http.request(").count(), 1, "one request, inside the try: {js}");
    assert!(!js.contains("fetch(") && !js.contains("http://"), "no fetch and no URL string to bend");
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
    // FIX-2: the user's permission hook stays alone; Kolux never adds one of its own there.
    assert_eq!(v["hooks"]["beforeShellExecution"], json!([{"command":"./my-check.sh","timeout":5}]), "{v}");
    assert!(v["hooks"]["stop"][0]["command"].as_str().unwrap().ends_with("cursor.cmd"), "a flat entry, not a group: {v}");
    assert_eq!(v["hooks"]["stop"][0]["timeout"], 10);
    assert_eq!(v["hooks"].as_object().unwrap().len(), 6, "the user's beforeShellExecution and Kolux's five state events: {v}");
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
fn fix_2_cursor_hooks_file_names_no_permission_event_and_an_older_file_loses_them() {
    // Council FIX-BEFORE 1 (option 1): Cursor's permission hooks (preToolUse, beforeShellExecution, beforeMCPExecution) block
    // the action on any answer outside their schema, and a hook meant to print nothing still printed `{}` on the wire. So
    // Kolux never installs one: the pane's state comes from beforeSubmitPrompt, the two post-tool events, afterAgentResponse
    // and stop, and Kolux never answers a permission hook.
    const PERMISSION: [&str; 3] = ["preToolUse", "beforeShellExecution", "beforeMCPExecution"];
    const STATE: [&str; 5] = ["afterAgentResponse", "beforeSubmitPrompt", "postToolUse", "postToolUseFailure", "stop"];
    for e in PERMISSION {
        assert!(!CURSOR_EVENTS.contains(&e), "{e} is a permission hook: never installed");
    }
    let home = scratch("cursor-fix2");
    let file = cursor_file(&home);
    assert!(install_cursor(&home, &file).unwrap());
    let v = read(&file);
    let mut keys: Vec<&str> = v["hooks"].as_object().unwrap().keys().map(String::as_str).collect();
    keys.sort_unstable();
    assert_eq!(keys, STATE, "the written file names the five state events and no permission event: {v}");
    assert!(!install_cursor(&home, &file).unwrap(), "a second on changes nothing");
    // A file FIX-1 wrote still carries Kolux under the three permission events, one of them beside the user's own entry:
    // the next on takes the three out and leaves the user's entry alone.
    let mine = v["hooks"]["stop"][0].clone();
    assert!(mine["command"].as_str().unwrap().ends_with("cursor.cmd"), "{mine}");
    let mut old = v.clone();
    let hooks = old["hooks"].as_object_mut().unwrap();
    hooks.insert("preToolUse".into(), json!([mine]));
    hooks.insert("beforeMCPExecution".into(), json!([mine]));
    hooks.insert("beforeShellExecution".into(), json!([{"command":"./my-check.sh","timeout":5}, mine]));
    fs::write(&file, serde_json::to_string_pretty(&old).unwrap()).unwrap();
    assert!(install_cursor(&home, &file).unwrap(), "the next on changes the FIX-1 file");
    let v = read(&file);
    assert!(v["hooks"].get("preToolUse").is_none() && v["hooks"].get("beforeMCPExecution").is_none(), "Kolux's permission entries are gone: {v}");
    assert_eq!(v["hooks"]["beforeShellExecution"], json!([{"command":"./my-check.sh","timeout":5}]), "the user's own entry stays, alone: {v}");
    for e in STATE {
        assert!(v["hooks"][e].as_array().unwrap().iter().any(names_mine), "{e} still drives the dot: {v}");
    }
    assert_eq!(switch::inspect(&file, &CURSOR_EVENTS).0, "installed");
    assert!(!install_cursor(&home, &file).unwrap());
    // The same file with no user's entry: off takes every Kolux entry, the three included, and the file Kolux made goes.
    let home2 = scratch("cursor-fix2-off");
    let file2 = cursor_file(&home2);
    assert!(install_cursor(&home2, &file2).unwrap());
    let mut old = read(&file2);
    for e in PERMISSION {
        old["hooks"].as_object_mut().unwrap().insert(e.into(), json!([mine]));
    }
    fs::write(&file2, serde_json::to_string_pretty(&old).unwrap()).unwrap();
    assert!(remove_hooks(&home2, &file2).unwrap());
    assert!(!file2.exists(), "off leaves nothing of a file Kolux made, whatever events an older Kolux added");
    // Whatever Cursor still sends from an older file, reply() has nothing for a permission event.
    for e in PERMISSION {
        assert_eq!(reply("/cursor", format!(r#"{{"hook_event_name":"{e}","tool_name":"Shell","command":"rm -rf x"}}"#).as_bytes()), None, "{e}");
    }
    let _ = fs::remove_dir_all(&home);
    let _ = fs::remove_dir_all(&home2);
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
    assert_eq!(names[..5], ["cursor", "droid", "command-code", "kimi", "hermes"]);
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

// ---- T-122 (STAT-017..021): Copilot CLI, Grok, Devin and Pi ----

#[test]
fn stat_017_copilot_events_ride_the_route_and_an_error_ends_the_turn_only_when_it_cannot_recover() {
    let mut s = Session::default();
    assert_eq!(state(&mut s, "/copilot/sessionStart", json!({"sessionId":"c1","source":"startup"})), Some("working"));
    assert_eq!(normalize("/copilot/userPromptSubmitted", &json!({"sessionId":"c1","prompt":"go"})).unwrap(), json!({"hook_event_name":"UserPromptSubmit","prompt":"go","session_id":"c1"}));
    assert_eq!(state(&mut s, "/copilot/userPromptSubmitted", json!({"sessionId":"c1","prompt":"go"})), Some("working"));
    let t = normalize("/copilot/preToolUse", &json!({"toolName":"bash","toolArgs":{"command":"ls"}})).unwrap();
    assert_eq!((t["tool_name"].as_str(), t["tool_input"]["command"].as_str()), (Some("bash"), Some("ls")));
    assert_eq!(state(&mut s, "/copilot/preToolUse", json!({"toolName":"bash"})), Some("working"));
    assert_eq!(state(&mut s, "/copilot/postToolUseFailure", json!({"toolName":"bash","error":"x"})), Some("working"));
    assert_eq!(state(&mut s, "/copilot/errorOccurred", json!({"recoverable":true,"errorContext":"tool_execution"})), Some("working"));
    assert_eq!(state(&mut s, "/copilot/notification", json!({"notification_type":"permission_prompt","message":"x"})), Some("waiting"));
    for e in ["subagentStart", "subagentStop", "preCompact"] {
        assert_eq!(normalize(&format!("/copilot/{e}"), &json!({"sessionId":"c1"})), None, "{e}: registered, changes nothing");
    }
    assert_eq!(state(&mut s, "/copilot/agentStop", json!({"stopReason":"end_turn"})), Some("done"));
    // The VS Code shape names the event in the body, Pascal-case, snake-case fields.
    assert_eq!(state(&mut s, "/copilot", json!({"hook_event_name":"UserPromptSubmit","session_id":"c1","prompt":"more"})), Some("working"));
    assert_eq!(state(&mut s, "/copilot", json!({"hook_event_name":"PermissionRequest","tool_name":"bash","tool_input":{}})), Some("permission"));
    assert_eq!(state(&mut s, "/copilot/errorOccurred", json!({"recoverable":false})), Some("done"), "an error Copilot cannot recover from ends the turn");
    assert_eq!(state(&mut s, "/copilot/userPromptSubmitted", json!({"prompt":"x"})), Some("working"));
    assert_eq!(state(&mut s, "/copilot/sessionEnd", json!({"reason":"user_exit"})), Some("done"));
    assert_eq!(normalize("/copilot", &json!({"sessionId":"c1"})), None, "no event name anywhere");
}

#[test]
fn stat_018_grok_events_drive_the_dot_and_routine_notices_change_nothing() {
    let mut s = Session::default();
    assert_eq!(normalize("/grok", &json!({"hookEventName":"SessionStart","sessionId":"g1"})), None, "COMPAT 3.5: no change");
    assert_eq!(state(&mut s, "/grok", json!({"hookEventName":"UserPromptSubmit","sessionId":"g1","prompt":"go"})), Some("working"));
    let t = normalize("/grok", &json!({"hookEventName":"PreToolUse","sessionId":"g1","toolName":"bash","toolInput":{"command":"ls"}})).unwrap();
    assert_eq!((t["session_id"].as_str(), t["tool_name"].as_str(), t["tool_input"]["command"].as_str()), (Some("g1"), Some("bash"), Some("ls")));
    assert_eq!(state(&mut s, "/grok", json!({"hookEventName":"PreToolUse","toolName":"bash"})), Some("working"));
    assert_eq!(state(&mut s, "/grok", json!({"hookEventName":"PostToolUseFailure","toolName":"bash"})), Some("working"));
    assert_eq!(normalize("/grok", &json!({"hookEventName":"Notification","message":"bash wants to run"})), None, "a routine notice keeps the pane working and never notifies");
    assert_eq!(state(&mut s, "/grok", json!({"hookEventName":"StopFailure"})), Some("done"));
    assert_eq!(state(&mut s, "/grok", json!({"hook_event_name":"UserPromptSubmit","prompt":"x"})), Some("working"));
    assert_eq!(state(&mut s, "/grok", json!({"hookEventName":"SessionEnd"})), Some("done"));
}

#[test]
fn stat_019_devin_events_drive_the_dot_and_a_flagged_stop_is_an_interruption() {
    let mut s = Session::default();
    assert_eq!(normalize("/devin/SessionStart", &json!({"session_id":"d1","source":"startup"})), None, "Devin's session start is ignored");
    assert_eq!(state(&mut s, "/devin/UserPromptSubmit", json!({"session_id":"d1","prompt":"go"})), Some("working"));
    assert_eq!(state(&mut s, "/devin/PreToolUse", json!({"tool_name":"exec","tool_input":{"command":"ls"}})), Some("working"));
    assert_eq!(state(&mut s, "/devin/PermissionRequest", json!({"tool_name":"exec","tool_input":{}})), Some("waiting"));
    assert_eq!(state(&mut s, "/devin/PostToolUse", json!({"tool_name":"exec"})), Some("working"));
    assert_eq!(state(&mut s, "/devin/PostCompaction", json!({"summary":"..."})), Some("working"));
    assert_eq!(state(&mut s, "/devin/Stop", json!({"stop_hook_active":false})), Some("done"));
    assert_eq!(state(&mut s, "/devin", json!({"hook_event_name":"UserPromptSubmit","prompt":"more"})), Some("working"));
    assert_eq!(state(&mut s, "/devin/Stop", json!({"interrupted":true})), Some("interrupted"));
    assert_eq!(state(&mut s, "/devin/UserPromptSubmit", json!({"prompt":"x"})), Some("working"));
    assert_eq!(state(&mut s, "/devin/SessionEnd", json!({"reason":"complete"})), Some("done"));
}

#[test]
fn stat_021_pi_extension_events_drive_the_dot() {
    let mut s = Session::default();
    assert_eq!(state(&mut s, "/pi", json!({"event":"session_start"})), Some("working"));
    assert_eq!(normalize("/pi", &json!({"event":"before_agent_start","prompt":"go"})).unwrap()["prompt"], "go");
    assert_eq!(state(&mut s, "/pi", json!({"event":"before_agent_start","prompt":"go"})), Some("working"));
    assert_eq!(state(&mut s, "/pi", json!({"event":"tool_execution_start","tool_name":"bash"})), Some("working"));
    assert_eq!(state(&mut s, "/pi", json!({"event":"tool_execution_end","tool_name":"bash"})), Some("working"));
    assert_eq!(normalize("/pi", &json!({"event":"agent_end"})), None, "Pi's doc: agent_end is not a final-idle signal");
    assert_eq!(state(&mut s, "/pi", json!({"event":"agent_settled"})), Some("done"));
    assert_eq!(state(&mut s, "/pi", json!({"event":"before_agent_start","prompt":"x"})), Some("working"));
    assert_eq!(state(&mut s, "/pi", json!({"event":"session_shutdown"})), Some("done"));
    let js = pi_extension();
    assert!(js.starts_with("// Kolux RS status extension for Pi. Written by Kolux RS") && js.contains("export default function (pi)") && js.contains("pi.on(event") && js.contains("path: \"/pi\""));
    for e in PI_EVENTS {
        assert!(js.contains(&format!("\"{e}\"")), "{e}");
    }
}

#[test]
fn stat_017_018_copilot_and_grok_own_files_come_and_go() {
    let home = scratch("own");
    let copilot = copilot_file_in(&home, None);
    assert_eq!(copilot, home.join(".copilot").join("hooks").join("kolux.json"));
    assert_eq!(copilot_file_in(&home, Some(PathBuf::from("C"))), Path::new("C").join("hooks").join("kolux.json"));
    assert_eq!(inspect_copilot(&copilot).0, "not installed");
    assert!(install_copilot(&home, &copilot).unwrap());
    assert!(!install_copilot(&home, &copilot).unwrap());
    let v = read(&copilot);
    assert_eq!((v["version"].as_i64(), v["disableAllHooks"].as_bool()), (Some(1), Some(false)));
    assert_eq!(v["hooks"].as_object().unwrap().keys().map(String::as_str).collect::<Vec<_>>(), COPILOT_EVENTS.to_vec());
    let entry = &v["hooks"]["preToolUse"][0];
    assert_eq!((entry["type"].as_str(), entry["timeoutSec"].as_i64(), entry.get("bash"), entry.get("command")), (Some("command"), Some(5), None, None));
    let ps = entry["powershell"].as_str().unwrap();
    assert!(ps.starts_with("& '") && ps.ends_with("' preToolUse") && ps.contains(SCRIPT_DIR) && ps.contains(COPILOT_SCRIPT), "{ps}");
    assert!(home.join(SCRIPT_DIR).join(COPILOT_SCRIPT).exists());
    assert_eq!(inspect_copilot(&copilot).0, "installed");
    let mut off = v.clone();
    off["disableAllHooks"] = json!(true);
    fs::write(&copilot, off.to_string()).unwrap();
    assert_eq!(inspect_copilot(&copilot).0, "disabled");
    assert!(install_copilot(&home, &copilot).unwrap(), "switching on clears the switch in Kolux's file");
    assert_eq!(inspect_copilot(&copilot).0, "installed");
    assert!(remove_copilot(&copilot).unwrap());
    assert!(!copilot.exists() && !copilot.parent().unwrap().exists());
    assert!(!remove_copilot(&copilot).unwrap());
    fs::create_dir_all(copilot.parent().unwrap()).unwrap();
    fs::write(&copilot, r#"{"hooks":{"preToolUse":[{"type":"command","bash":"mine.sh"}]}}"#).unwrap();
    assert!(install_copilot(&home, &copilot).unwrap_err().contains("not Kolux's"));
    assert!(remove_copilot(&copilot).unwrap_err().contains("not Kolux's"));
    assert_eq!(inspect_copilot(&copilot).0, "error");
    // Grok: Claude-style groups with no matcher, in Kolux's own file; gone without a trace.
    let grok = grok_file_in(&home, None);
    assert_eq!(grok, home.join(".grok").join("hooks").join("kolux-status.json"));
    assert_eq!(grok_file_in(&home, Some(PathBuf::from("G"))), Path::new("G").join("hooks").join("kolux-status.json"));
    assert!(install_grok(&home, &grok).unwrap());
    let g = read(&grok);
    assert_eq!(g["hooks"].as_object().unwrap().len(), 9);
    assert_eq!(g["hooks"]["PreToolUse"][0].get("matcher"), None, "Grok's matcher is a regex; none means every tool");
    assert!(g["hooks"]["PreToolUse"][0]["hooks"][0]["command"].as_str().unwrap().contains(GROK_SCRIPT));
    assert_eq!(switch::inspect(&grok, &GROK_EVENTS).0, "installed");
    assert!(remove_grok(&home, &grok).unwrap());
    assert!(!grok.exists() && !grok.parent().unwrap().exists(), "the file Kolux created goes, and the empty hooks folder with it");
    // FIX-1 (council AFTER 2): an empty COPILOT_HOME or GROK_HOME is unset, never a path relative to the current folder.
    assert_eq!(home_var(Some(std::ffi::OsString::new())), None);
    assert_eq!(home_var(Some("C".into())), Some(PathBuf::from("C")));
    assert_eq!(home_var(None), None);
    let names: Vec<String> = rows(&home).iter().map(|r| r["agent"].as_str().unwrap().to_string()).collect();
    assert_eq!(names, ["cursor", "droid", "command-code", "kimi", "hermes", "copilot", "grok", "devin", "pi"]);
    let _ = fs::remove_dir_all(&home);
}

#[test]
fn stat_019_devin_block_keeps_the_users_comments_and_leaves_as_it_came() {
    let home = scratch("devin");
    let file = devin_file(&home);
    let user = "{\n  // my model\n  \"model\": \"x\", /* keep */\n  \"url\": \"https://a/b\"\n}\n";
    fs::create_dir_all(file.parent().unwrap()).unwrap();
    fs::write(&file, user).unwrap();
    assert!(install_devin(&home, &file).unwrap());
    assert!(!install_devin(&home, &file).unwrap());
    let text = fs::read_to_string(&file).unwrap();
    assert!(text.starts_with(&format!("{{\n  {DEVIN_START}\n  \"hooks\": {{")) && text.ends_with(user.trim_start_matches('{')), "{text}");
    let v: Value = serde_json::from_str(&strip_comments(&text)).unwrap();
    assert_eq!(v["hooks"].as_object().unwrap().len(), 8);
    assert_eq!(v["hooks"]["PreToolUse"][0]["matcher"], "*");
    assert!(v["hooks"]["Stop"][0]["hooks"][0]["command"].as_str().unwrap().ends_with(" Stop"));
    assert_eq!((v["model"].as_str(), v["url"].as_str()), (Some("x"), Some("https://a/b")));
    assert_eq!(inspect_devin(&file).0, "installed");
    assert!(remove_devin(&home, &file).unwrap());
    assert_eq!(fs::read_to_string(&file).unwrap(), user, "byte for byte");
    assert!(!remove_devin(&home, &file).unwrap());
    assert_eq!(inspect_devin(&file).0, "not installed");
    fs::write(&file, "{\n  \"hooks\": {}\n}\n").unwrap();
    assert!(install_devin(&home, &file).unwrap_err().contains("hooks of its own"));
    fs::write(&file, "not json").unwrap();
    assert!(install_devin(&home, &file).unwrap_err().contains("not JSON"));
    // FIX-1 (council FIX-SOON 2): comments become spaces, byte for byte, so an index in the stripped text is one in the file.
    let c = "{\"a\": \"// not a comment\", // c\n \"b\": 1 /* x */}";
    assert_eq!(strip_comments(c), "{\"a\": \"// not a comment\",     \n \"b\": 1        }");
    assert_eq!(strip_comments(c).len(), c.len());
    assert_eq!(strip_comments("// é {\r\n{}"), "       \r\n{}", "a multibyte char is as many spaces as it has bytes; CR stays");
    // Created from nothing: gone again at removal.
    let home2 = scratch("devin2");
    let file2 = devin_file(&home2);
    assert!(install_devin(&home2, &file2).unwrap());
    let v: Value = serde_json::from_str(&strip_comments(&fs::read_to_string(&file2).unwrap())).unwrap();
    assert_eq!(v.as_object().unwrap().keys().collect::<Vec<_>>(), ["hooks"]);
    assert!(remove_devin(&home2, &file2).unwrap());
    assert!(!file2.exists() && !file2.parent().unwrap().exists(), "the file and the empty devin folder Kolux made go");
    let _ = fs::remove_dir_all(&home);
    let _ = fs::remove_dir_all(&home2);
}

#[test]
fn fix_1_devin_block_leaves_crlf_one_line_and_blank_line_files_byte_for_byte() {
    // Council FIX-SOON 1 and 2: the text around the block is never reshaped, whatever its line ends or layout,
    // and a `{` inside a leading comment is not the opening brace.
    let cases: [(&str, &str); 6] = [
        ("{\r\n  \"a\": 1\r\n}\r\n", "crlf"),
        ("{}", "empty one-line"),
        ("{\"a\":1}", "minified"),
        ("{\n\n  \"a\": 1\n}\n", "blank line after the brace"),
        ("// Devin {v2}\n{\n  \"a\": 1\n}\n", "a brace inside a leading comment"),
        ("{ // top\n  \"a\": 1 }\n", "a comment on the brace's line"),
    ];
    for (i, (user, why)) in cases.into_iter().enumerate() {
        // Its own home each time: the copy kept before the first write belongs to one user file.
        let home = scratch(&format!("devin-exact-{i}"));
        let file = devin_file(&home);
        fs::create_dir_all(file.parent().unwrap()).unwrap();
        fs::write(&file, user).unwrap();
        assert!(install_devin(&home, &file).unwrap(), "{why}");
        assert!(!install_devin(&home, &file).unwrap(), "{why}: a second install changes nothing");
        let text = fs::read_to_string(&file).unwrap();
        let v: Value = serde_json::from_str(&strip_comments(&text)).unwrap_or_else(|e| panic!("{why}: {e}\n{text}"));
        assert_eq!(v["hooks"].as_object().unwrap().len(), 8, "{why}");
        assert_eq!(v.get("a").is_some(), user.contains("\"a\""), "{why}: the user's key stays");
        if user.contains("\r\n") {
            assert!(!text.replace("\r\n", "").contains('\n'), "{why}: every line end is CRLF\n{text:?}");
        }
        assert_eq!(strip_devin(&text), (user.to_string(), true), "{why}: the block alone comes out");
        assert_eq!(inspect_devin(&file).0, "installed", "{why}");
        assert!(remove_devin(&home, &file).unwrap(), "{why}");
        assert_eq!(fs::read_to_string(&file).unwrap(), user, "{why}: byte for byte");
        let _ = fs::remove_dir_all(&home);
    }
}

#[test]
fn stat_021_pi_extension_file_is_kolux_s_alone() {
    let home = scratch("pi");
    let file = pi_file(&home);
    assert_eq!(file, home.join(".pi").join("agent").join("extensions").join(PI_EXTENSION));
    assert_eq!(inspect_pi(&file).0, "not installed");
    assert!(install_pi(&file).unwrap());
    assert!(!install_pi(&file).unwrap());
    assert_eq!(fs::read_to_string(&file).unwrap(), pi_extension());
    assert_eq!(inspect_pi(&file).0, "installed");
    fs::write(&file, "// Written by Kolux RS (older)\n").unwrap();
    assert_eq!(inspect_pi(&file).0, "partial");
    assert!(install_pi(&file).unwrap());
    assert!(remove_pi(&file).unwrap());
    assert!(!file.exists() && !file.parent().unwrap().exists(), "the file and the empty extensions folder Kolux made go");
    fs::create_dir_all(file.parent().unwrap()).unwrap();
    fs::write(&file, "export default function (pi) {}\n").unwrap();
    assert!(install_pi(&file).unwrap_err().contains("not Kolux's own"));
    assert!(!remove_pi(&file).unwrap());
    assert!(file.exists(), "the user's extension stays");
    assert_eq!(inspect_pi(&file).0, "error");
    let _ = fs::remove_dir_all(&home);
}
