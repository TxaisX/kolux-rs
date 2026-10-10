//! STAT-001 / STAT-007: agents report their own status through hooks Kolux looks after. Each hook
//! is a batch script Kolux writes once; the agent runs it on every event and the script POSTs the
//! event JSON to this loopback listener (COMPAT.md section 3.1 and 3.2). The listener turns the
//! event into a pane state and raises it to the window as `agent-status`. Claude Code's twelve
//! events are installed here; Codex (T-025-b) and the sub-agent roster (T-025-c) build on it.

use base64::Engine as _;
use serde_json::{json, Value};
use std::collections::HashMap;
use std::io::{BufRead, BufReader, Write};
use std::net::{TcpListener, TcpStream};
use std::path::{Path, PathBuf};
use std::time::Duration;
use tauri::{AppHandle, Emitter};

pub const EVENT: &str = "agent-status";
pub const TOKEN_HEADER: &str = "x-kolux-token";
pub const IDENTITY_HEADER: &str = "x-kolux-pane";
/// Kolux RS's own script folder under the home folder. DT-C1: not COMPAT's `~/.kolux/agent-hooks`
/// while the old app is installed beside this one, so neither overwrites the other's scripts.
pub const SCRIPT_DIR: &str = ".kolux-rs/agent-hooks";
pub const CLAUDE_SCRIPT: &str = "claude.cmd";
/// The running Kolux's port and token, read by the script on every run (a pane outlives a restart).
pub const ENDPOINT_FILE: &str = "agent-hooks-endpoint.txt";
pub const HOOK_VERSION: u32 = 1;
/// Claude Code's events Kolux listens to. `PreCompact` is never installed (COMPAT 3.4).
pub const CLAUDE_EVENTS: [&str; 12] = [
    "SessionStart", "UserPromptSubmit", "Stop", "StopFailure", "SubagentStart", "SubagentStop", "TeammateIdle",
    "PreToolUse", "PostToolUse", "PostToolUseFailure", "PermissionRequest", "PostCompact",
];
const TOOL_EVENTS: [&str; 4] = ["PreToolUse", "PostToolUse", "PostToolUseFailure", "PermissionRequest"];
const MAX_BODY: usize = 4 << 20;

/// The listener the panes' hooks report to.
pub struct Hooks {
    pub port: u16,
    pub token: String,
    pub endpoint: PathBuf,
}

/// What one event changes about a pane (COMPAT 3.5). Trimmed per STAT-001.
#[derive(Clone, Debug, Default, PartialEq, serde::Serialize)]
pub struct Change {
    pub state: &'static str,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tool: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub detail: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub prompt: Option<String>,
    /// A session boundary: the agent started, resumed or cleared; earlier state is forgotten.
    pub boundary: bool,
}

#[derive(Clone, Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Status {
    pub pane_key: u32,
    pub terminal: Option<u32>,
    #[serde(flatten)]
    pub change: Change,
}

fn trim(s: &str, max: usize) -> String {
    let s = s.trim();
    if s.chars().count() <= max { s.to_string() } else { format!("{}…", s.chars().take(max).collect::<String>()) }
}

/// A multi-line prompt folded to one line (STAT-001).
fn fold(s: &str) -> String {
    s.split_whitespace().collect::<Vec<_>>().join(" ")
}

/// The one line of a tool's input worth showing: the command, the file, else the first string.
fn tool_detail(input: Option<&Value>) -> Option<String> {
    let input = input?.as_object()?;
    let pick = ["command", "file_path", "path", "pattern", "description", "prompt", "question"]
        .iter()
        .find_map(|k| input.get(*k).and_then(Value::as_str))
        .or_else(|| input.values().find_map(Value::as_str))?;
    Some(trim(&fold(pick), 160))
}

/// Claude Code's event mapping (COMPAT 3.5). `None` means the pane's state does not change.
pub fn claude_change(event: &Value) -> Option<Change> {
    let name = event.get("hook_event_name")?.as_str()?;
    // A sub-agent's events belong to the roster (STAT-026, T-025-c), never to the lead's own state.
    if event.get("agent_id").and_then(Value::as_str).is_some_and(|a| !a.is_empty()) {
        return None;
    }
    let str_of = |k: &str| event.get(k).and_then(Value::as_str);
    let tool = str_of("tool_name").map(|t| trim(t, 60));
    let plain = |state: &'static str| Some(Change { state, ..Change::default() });
    match name {
        "SessionStart" => matches!(str_of("source"), Some("startup" | "resume" | "clear")).then_some(Change { state: "done", boundary: true, ..Change::default() }),
        "UserPromptSubmit" => Some(Change {
            state: "working",
            prompt: str_of("prompt").or_else(|| str_of("user_prompt")).map(|p| trim(&fold(p), 16000)),
            ..Change::default()
        }),
        // ponytail: the interrupted flag (Txais cancelled the turn) and "stays working while a child
        // works" arrive with the roster (T-025-c).
        "Stop" => plain("done"),
        "StopFailure" => Some(Change {
            state: "blocked",
            detail: str_of("error").or_else(|| str_of("error_type")).or_else(|| str_of("message")).map(|e| trim(&fold(e), 160)),
            ..Change::default()
        }),
        "PreToolUse" => Some(Change {
            state: if matches!(tool.as_deref(), Some("AskUserQuestion" | "ExitPlanMode")) { "waiting" } else { "working" },
            detail: tool_detail(event.get("tool_input")),
            tool,
            ..Change::default()
        }),
        "PostToolUse" | "PostToolUseFailure" => plain("working"),
        "PermissionRequest" => Some(Change { state: "permission", detail: tool_detail(event.get("tool_input")), tool, ..Change::default() }),
        "PostCompact" => (str_of("trigger") == Some("manual")).then_some(Change { state: "done", boundary: true, ..Change::default() }),
        // SubagentStart, SubagentStop and TeammateIdle feed the roster (T-025-c); PreCompact is refused.
        _ => None,
    }
}

/// One HTTP request as the hook scripts send it: a request line, headers, a body.
pub struct Request {
    pub path: String,
    pub headers: HashMap<String, String>,
    pub body: Vec<u8>,
}

pub fn parse_request(r: &mut impl BufRead) -> Option<Request> {
    let mut line = String::new();
    r.read_line(&mut line).ok()?;
    let path = line.split_whitespace().nth(1)?.to_string();
    let mut headers = HashMap::new();
    loop {
        line.clear();
        r.read_line(&mut line).ok()?;
        let l = line.trim_end_matches(['\r', '\n']);
        if l.is_empty() {
            break;
        }
        if let Some((k, v)) = l.split_once(':') {
            headers.insert(k.trim().to_ascii_lowercase(), v.trim().to_string());
        }
    }
    let len: usize = headers.get("content-length").and_then(|v| v.parse().ok()).unwrap_or(0);
    if len > MAX_BODY {
        return None;
    }
    let mut body = vec![0; len];
    r.read_exact(&mut body).ok()?;
    Some(Request { path, headers, body })
}

/// The pane behind an identity header: base64 JSON with `paneKey` (and `terminal`), as Kolux put
/// it into the pane's environment (DT-C2).
pub fn identity(header: &str) -> Option<(u32, Option<u32>)> {
    let raw = base64::engine::general_purpose::STANDARD.decode(header.trim()).ok()?;
    let v: Value = serde_json::from_slice(&raw).ok()?;
    let pane = v.get("paneKey")?.as_u64()? as u32;
    Some((pane, v.get("terminal").and_then(Value::as_u64).map(|t| t as u32)))
}

/// Answers one hook: `(status code, the status to raise)`.
pub fn answer(req: &Request, token: &str) -> (u16, Option<Status>) {
    if req.headers.get(TOKEN_HEADER).map(String::as_str) != Some(token) {
        return (403, None);
    }
    let Some((pane_key, terminal)) = req.headers.get(IDENTITY_HEADER).and_then(|h| identity(h)) else { return (400, None) };
    let Ok(event) = serde_json::from_slice::<Value>(&req.body) else { return (400, None) };
    let change = match req.path.as_str() {
        "/claude" => claude_change(&event),
        _ => return (404, None),
    };
    (200, change.map(|change| Status { pane_key, terminal, change }))
}

fn handle(mut stream: TcpStream, app: &AppHandle, token: &str) {
    stream.set_read_timeout(Some(Duration::from_secs(2))).ok();
    let mut reader = BufReader::new(&stream);
    let code = match parse_request(&mut reader) {
        Some(req) => {
            let (code, status) = answer(&req, token);
            if let Some(status) = status {
                let _ = app.emit(EVENT, status);
            }
            code
        }
        None => 400,
    };
    let _ = write!(stream, "HTTP/1.1 {code} OK\r\nContent-Length: 2\r\nConnection: close\r\n\r\n{{}}");
    let _ = stream.flush();
}

/// Opens the listener on a loopback port and writes the endpoint file; hooks answer on a thread.
pub fn serve(app: AppHandle, data_dir: &Path) -> Result<Hooks, String> {
    let listener = TcpListener::bind("127.0.0.1:0").map_err(|e| e.to_string())?;
    let port = listener.local_addr().map_err(|e| e.to_string())?.port();
    let token = crate::cli::token();
    let endpoint = data_dir.join(ENDPOINT_FILE);
    std::fs::write(&endpoint, format!("{port} {token}\n")).map_err(|e| e.to_string())?;
    let t = token.clone();
    std::thread::spawn(move || {
        // ponytail: one hook at a time; each is answered in well under its script's 1.5 s limit.
        for stream in listener.incoming().flatten() {
            handle(stream, &app, &t);
        }
    });
    Ok(Hooks { port, token, endpoint })
}

impl Hooks {
    /// The variables a pane's programs (and their hooks) see (COMPAT 5.5; DT-C2 for the identity).
    pub fn pane_env(&self, pane_key: u32, terminal: u32) -> Vec<(String, String)> {
        let identity = json!({ "paneKey": pane_key, "terminal": terminal, "hookVersion": HOOK_VERSION });
        vec![
            ("KOLUX_AGENT_HOOK_PORT".into(), self.port.to_string()),
            ("KOLUX_AGENT_HOOK_TOKEN".into(), self.token.clone()),
            ("KOLUX_PANE_KEY".into(), pane_key.to_string()),
            ("KOLUX_TERMINAL_HANDLE".into(), terminal.to_string()),
            ("KOLUX_HOOK_ENDPOINT".into(), self.endpoint.to_string_lossy().into_owned()),
            ("KOLUX_HOOK_IDENTITY".into(), base64::engine::general_purpose::STANDARD.encode(identity.to_string())),
        ]
    }
}

/// The Claude hook script (COMPAT 3.2): guards first, reads the endpoint file, posts stdin with the
/// system curl inside 1.5 s, always exits 0.
pub fn claude_script() -> String {
    [
        "@echo off",
        "rem Kolux RS agent hook for Claude Code (STAT-001, STAT-007). Written by Kolux RS; edits are overwritten.",
        "rem Outside a Kolux pane there is nothing to report: leave before reading stdin.",
        "if \"%KOLUX_PANE_KEY%\"==\"\" exit /b 0",
        "if \"%KOLUX_AGENT_HOOK_PORT%\"==\"\" exit /b 0",
        "if \"%KOLUX_AGENT_HOOK_TOKEN%\"==\"\" exit /b 0",
        "setlocal",
        "set \"KP=%KOLUX_AGENT_HOOK_PORT%\"",
        "set \"KT=%KOLUX_AGENT_HOOK_TOKEN%\"",
        "rem The endpoint file names the Kolux running now, so a pane outlives a Kolux restart.",
        "if not \"%KOLUX_HOOK_ENDPOINT%\"==\"\" if exist \"%KOLUX_HOOK_ENDPOINT%\" for /f \"usebackq tokens=1,2\" %%a in (\"%KOLUX_HOOK_ENDPOINT%\") do (set \"KP=%%a\" & set \"KT=%%b\")",
        "%SystemRoot%\\System32\\more.com | %SystemRoot%\\System32\\curl.exe -s -m 1.5 --connect-timeout 0.5 --noproxy \"*\" -X POST -H \"Content-Type: application/json\" -H \"X-Kolux-Token: %KT%\" -H \"X-Kolux-Pane: %KOLUX_HOOK_IDENTITY%\" --data-binary @- -o NUL \"http://127.0.0.1:%KP%/claude\" >NUL 2>&1",
        "exit /b 0",
        "",
    ]
    .join("\r\n")
}

/// Writes the script under `home` (only when it changed) and returns its path with forward slashes.
pub fn write_claude_script(home: &Path) -> Result<String, String> {
    let dir = home.join(SCRIPT_DIR);
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let file = dir.join(CLAUDE_SCRIPT);
    let script = claude_script();
    if std::fs::read_to_string(&file).ok().as_deref() != Some(script.as_str()) {
        std::fs::write(&file, script).map_err(|e| e.to_string())?;
    }
    Ok(file.to_string_lossy().replace('\\', "/"))
}

/// Claude Code's user settings: `settings.json` beside `.claude.json` (COMPAT 3.4).
pub fn claude_settings_file() -> PathBuf {
    crate::trust::claude_config_file().with_file_name("settings.json")
}

fn is_mine(group: &Value) -> bool {
    group.get("hooks").and_then(Value::as_array).is_some_and(|hs| {
        hs.iter().any(|h| h.get("command").and_then(Value::as_str).is_some_and(|c| c.contains(SCRIPT_DIR)))
    })
}

/// Puts exactly one Kolux RS group under each of the twelve events, leaving every other entry
/// (another tool's hooks, the user's own) as it is. True when `settings` changed.
pub fn install_claude_hooks(settings: &mut Value, command: &str) -> bool {
    let before = settings.clone();
    if !settings.is_object() {
        *settings = json!({});
    }
    let hooks = settings.as_object_mut().unwrap().entry("hooks").or_insert_with(|| json!({}));
    if !hooks.is_object() {
        *hooks = json!({});
    }
    for event in CLAUDE_EVENTS {
        let groups = hooks.as_object_mut().unwrap().entry(event).or_insert_with(|| json!([]));
        if !groups.is_array() {
            *groups = json!([]);
        }
        let groups = groups.as_array_mut().unwrap();
        let hook = json!([{ "type": "command", "command": command, "timeout": 10 }]);
        // Tool events match every tool (COMPAT 3.4); the others take no matcher.
        let mine = if TOOL_EVENTS.contains(&event) { json!({ "matcher": "*", "hooks": hook }) } else { json!({ "hooks": hook }) };
        match groups.iter().position(is_mine) {
            Some(i) => {
                groups.retain(|g| !is_mine(g));
                groups.insert(i.min(groups.len()), mine);
            }
            None => groups.push(mine),
        }
    }
    *settings != before
}

fn indent_of(text: &str) -> usize {
    text.lines().find_map(|l| { let n = l.len() - l.trim_start_matches(' ').len(); (n > 0).then_some(n) }).unwrap_or(2)
}

/// Installs the Claude hooks into `file` (created when missing, never rewritten when unreadable).
pub fn install_claude(file: &Path, command: &str) -> Result<bool, String> {
    let text = match std::fs::read_to_string(file) {
        Ok(t) => t,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => "{}".to_string(),
        Err(e) => return Err(e.to_string()),
    };
    let mut settings: Value = serde_json::from_str(&text).map_err(|e| format!("{} is not JSON ({e}); hooks not installed", file.display()))?;
    if !install_claude_hooks(&mut settings, command) {
        return Ok(false);
    }
    let indent = " ".repeat(indent_of(&text));
    let mut out = Vec::new();
    let mut ser = serde_json::Serializer::with_formatter(&mut out, serde_json::ser::PrettyFormatter::with_indent(indent.as_bytes()));
    serde::Serialize::serialize(&settings, &mut ser).map_err(|e| e.to_string())?;
    out.push(b'\n');
    if let Some(parent) = file.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let tmp = file.with_extension("json.kolux-rs-tmp");
    std::fs::write(&tmp, out).map_err(|e| e.to_string())?;
    std::fs::rename(&tmp, file).map_err(|e| e.to_string())?;
    Ok(true)
}

/// At start: the script and Claude's settings entries. Never stops the launch; problems go to stderr.
pub fn install_all() {
    let home = std::env::var(if cfg!(windows) { "USERPROFILE" } else { "HOME" }).map(PathBuf::from).unwrap_or_else(|_| std::env::temp_dir());
    match write_claude_script(&home) {
        Ok(path) => {
            if let Err(e) = install_claude(&claude_settings_file(), &format!("\"{path}\" || exit 0")) {
                eprintln!("kolux-rs: claude hooks: {e}");
            }
        }
        Err(e) => eprintln!("kolux-rs: claude hook script: {e}"),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ev(json: &str) -> Value {
        serde_json::from_str(json).unwrap()
    }

    #[test]
    fn claude_events_map_to_pane_states() {
        let c = |j: &str| claude_change(&ev(j));
        let start = c(r#"{"hook_event_name":"SessionStart","source":"startup"}"#).unwrap();
        assert_eq!((start.state, start.boundary), ("done", true));
        assert!(c(r#"{"hook_event_name":"SessionStart","source":"compact"}"#).is_none());
        let p = c(r#"{"hook_event_name":"UserPromptSubmit","prompt":"  fix the\n  build  "}"#).unwrap();
        assert_eq!((p.state, p.prompt.as_deref()), ("working", Some("fix the build")));
        let t = c(r#"{"hook_event_name":"PreToolUse","tool_name":"Bash","tool_input":{"command":"ls -la","description":"list"}}"#).unwrap();
        assert_eq!((t.state, t.tool.as_deref(), t.detail.as_deref()), ("working", Some("Bash"), Some("ls -la")));
        assert_eq!(c(r#"{"hook_event_name":"PreToolUse","tool_name":"AskUserQuestion","tool_input":{}}"#).unwrap().state, "waiting");
        assert_eq!(c(r#"{"hook_event_name":"PreToolUse","tool_name":"ExitPlanMode"}"#).unwrap().state, "waiting");
        let perm = c(r#"{"hook_event_name":"PermissionRequest","tool_name":"Write","tool_input":{"file_path":"C:/x/hello.txt","content":"hi"}}"#).unwrap();
        assert_eq!((perm.state, perm.tool.as_deref(), perm.detail.as_deref()), ("permission", Some("Write"), Some("C:/x/hello.txt")));
        assert_eq!(c(r#"{"hook_event_name":"PostToolUse","tool_name":"Write"}"#).unwrap().state, "working");
        assert_eq!(c(r#"{"hook_event_name":"PostToolUseFailure","tool_name":"Write"}"#).unwrap().state, "working");
        assert_eq!(c(r#"{"hook_event_name":"Stop"}"#).unwrap().state, "done");
        let b = c(r#"{"hook_event_name":"StopFailure","error":"rate limit reached"}"#).unwrap();
        assert_eq!((b.state, b.detail.as_deref()), ("blocked", Some("rate limit reached")));
        let m = c(r#"{"hook_event_name":"PostCompact","trigger":"manual"}"#).unwrap();
        assert_eq!((m.state, m.boundary), ("done", true));
        assert!(c(r#"{"hook_event_name":"PostCompact","trigger":"auto"}"#).is_none());
        // The roster's events and a refused one leave the lead's state alone; so does a sub-agent's event.
        for e in ["SubagentStart", "SubagentStop", "TeammateIdle", "PreCompact"] {
            assert!(c(&format!(r#"{{"hook_event_name":"{e}"}}"#)).is_none(), "{e}");
        }
        assert!(c(r#"{"hook_event_name":"Stop","agent_id":"abc"}"#).is_none());
        // STAT-001 trimming: a long tool name and a long prompt are cut.
        let long = "x".repeat(100);
        assert_eq!(c(&format!(r#"{{"hook_event_name":"PreToolUse","tool_name":"{long}"}}"#)).unwrap().tool.unwrap().chars().count(), 61);
    }

    #[test]
    fn a_hook_request_is_parsed_and_checked() {
        let id = base64::engine::general_purpose::STANDARD.encode(r#"{"paneKey":7,"terminal":3,"hookVersion":1}"#);
        let body = r#"{"hook_event_name":"PermissionRequest","tool_name":"Write"}"#;
        let raw = format!("POST /claude HTTP/1.1\r\nHost: 127.0.0.1\r\nX-Kolux-Token: tok\r\nX-Kolux-Pane: {id}\r\nContent-Length: {}\r\n\r\n{body}", body.len());
        let req = parse_request(&mut raw.as_bytes()).unwrap();
        assert_eq!(req.path, "/claude");
        let (code, status) = answer(&req, "tok");
        let status = status.unwrap();
        assert_eq!((code, status.pane_key, status.terminal, status.change.state), (200, 7, Some(3), "permission"));
        assert_eq!(answer(&req, "other").0, 403);
        let mut bad = parse_request(&mut raw.as_bytes()).unwrap();
        bad.path = "/nope".into();
        assert_eq!(answer(&bad, "tok").0, 404);
        bad.path = "/claude".into();
        bad.headers.remove(IDENTITY_HEADER);
        assert_eq!(answer(&bad, "tok").0, 400);
        // A no-change event still answers 200 with nothing to raise.
        let quiet = format!("POST /claude HTTP/1.1\r\nX-Kolux-Token: tok\r\nX-Kolux-Pane: {id}\r\nContent-Length: 32\r\n\r\n{{\"hook_event_name\":\"PreCompact\"}}");
        let (code, status) = answer(&parse_request(&mut quiet.as_bytes()).unwrap(), "tok");
        assert!(code == 200 && status.is_none());
    }

    #[test]
    fn the_settings_get_one_kolux_group_per_event_and_keep_everything_else() {
        let mut s = ev(r#"{"permissions":{"allow":["Bash"]},"hooks":{
            "PreToolUse":[{"matcher":"Bash|PowerShell","hooks":[{"type":"command","command":"node guard.js","timeout":5}]},
                          {"matcher":"*","hooks":[{"type":"command","command":"C:/Users/me/.kolux/agent-hooks/claude-hook.cmd || echo {","timeout":10}]},
                          {"matcher":"*","hooks":[{"type":"command","command":"C:/old/.kolux-rs/agent-hooks/claude.cmd || exit 0","timeout":10}]}],
            "Stop":[{"hooks":[{"type":"command","command":"C:/Users/me/.kolux/agent-hooks/claude-hook.cmd || echo {","timeout":10}]}],
            "PreCompact":[{"hooks":[{"type":"command","command":"other"}]}]}}"#);
        let cmd = "\"C:/Users/me/.kolux-rs/agent-hooks/claude.cmd\" || exit 0";
        assert!(install_claude_hooks(&mut s, cmd));
        let hooks = s["hooks"].as_object().unwrap();
        for e in CLAUDE_EVENTS {
            let groups = hooks[e].as_array().unwrap();
            assert_eq!(groups.iter().filter(|g| is_mine(g)).count(), 1, "{e}");
            let mine = groups.iter().find(|g| is_mine(g)).unwrap();
            assert_eq!(mine["hooks"][0]["command"], cmd);
            assert_eq!(mine.get("matcher").is_some(), TOOL_EVENTS.contains(&e), "{e}");
        }
        let pre = hooks["PreToolUse"].as_array().unwrap();
        assert_eq!(pre.len(), 3);
        assert_eq!(pre[0]["matcher"], "Bash|PowerShell");
        assert!(pre[1]["hooks"][0]["command"].as_str().unwrap().contains(".kolux/agent-hooks"));
        assert_eq!(pre[2]["hooks"][0]["command"], cmd, "a stale Kolux RS path is replaced in place");
        assert_eq!(hooks["Stop"].as_array().unwrap().len(), 2);
        assert_eq!(hooks["PreCompact"].as_array().unwrap().len(), 1, "PreCompact is never installed");
        assert_eq!(s["permissions"]["allow"][0], "Bash");
        assert!(!install_claude_hooks(&mut s, cmd), "a second install changes nothing");
    }

    #[test]
    fn the_settings_file_keeps_its_indent_and_is_created_when_missing() {
        let dir = std::env::temp_dir().join(format!("kolux-rs-hooks-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        let file = dir.join("settings.json");
        let x = "\"C:/u/.kolux-rs/agent-hooks/claude.cmd\" || exit 0";
        assert!(install_claude(&file, x).unwrap());
        let v: Value = serde_json::from_str(&std::fs::read_to_string(&file).unwrap()).unwrap();
        assert_eq!(v["hooks"]["Stop"][0]["hooks"][0]["command"], x);
        std::fs::write(&file, "{\n    \"env\": {\n        \"A\": \"1\"\n    }\n}\n").unwrap();
        assert!(install_claude(&file, x).unwrap());
        let text = std::fs::read_to_string(&file).unwrap();
        assert!(text.starts_with("{\n    \"env\": {\n        \"A\": \"1\"\n    },\n    \"hooks\""), "{text}");
        assert!(!install_claude(&file, x).unwrap());
        std::fs::write(&file, "not json").unwrap();
        assert!(install_claude(&file, x).is_err());
        assert_eq!(std::fs::read_to_string(&file).unwrap(), "not json", "an unreadable file is left alone");
        let script = write_claude_script(&dir).unwrap();
        assert!(script.ends_with(".kolux-rs/agent-hooks/claude.cmd") && !script.contains('\\'));
        let body = std::fs::read_to_string(&script).unwrap();
        assert!(body.starts_with("@echo off\r\n") && body.contains("curl.exe -s -m 1.5") && body.ends_with("exit /b 0\r\n"));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_pane_gets_the_hook_variables_with_a_decodable_identity() {
        let h = Hooks { port: 5, token: "t".into(), endpoint: PathBuf::from("e.txt") };
        let env = h.pane_env(9, 4);
        let get = |k: &str| env.iter().find(|(n, _)| n == k).map(|(_, v)| v.as_str()).unwrap();
        assert_eq!((get("KOLUX_AGENT_HOOK_PORT"), get("KOLUX_PANE_KEY"), get("KOLUX_TERMINAL_HANDLE")), ("5", "9", "4"));
        assert_eq!(identity(get("KOLUX_HOOK_IDENTITY")), Some((9, Some(4))));
    }
}
