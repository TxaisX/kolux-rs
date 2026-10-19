//! STAT-001 / STAT-007: agents report their own status through hooks Kolux looks after. Each hook
//! is a batch script Kolux writes once; the agent runs it on every event and the script POSTs the
//! event JSON to this loopback listener (COMPAT.md section 3.1 and 3.2). The listener turns the
//! event into a pane state and raises it to the window as `agent-status`. Claude Code's twelve
//! events and Codex's eight (STAT-008) are installed here; `status.rs` keeps each pane's session
//! (roster, permissions, interrupts, history; STAT-026, T-025-c) and resolves the state shown.

use base64::Engine as _;
use serde_json::{json, Value};
use std::collections::HashMap;
use std::io::{BufRead, BufReader, Write};
use std::net::{TcpListener, TcpStream};
use std::path::{Path, PathBuf};
use std::sync::atomic::Ordering;
use std::sync::Mutex;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, Manager};

// STAT-004 / STAT-005: which agents get hooks, removal, the shared install lock (T-152).
#[path = "agent_hooks/mod.rs"]
pub mod agent_hooks;

pub const EVENT: &str = "agent-status";
pub const TOKEN_HEADER: &str = "x-kolux-token";
pub const IDENTITY_HEADER: &str = "x-kolux-pane";
/// USAGE-021: the Claude config folder a status-line report's session runs under, if any.
pub const CONFIG_HEADER: &str = "x-kolux-config";
/// Kolux RS's own script folder under the home folder. DT-C1: not COMPAT's `~/.kolux/agent-hooks`
/// while the old app is installed beside this one, so neither overwrites the other's scripts.
pub const SCRIPT_DIR: &str = ".kolux-rs/agent-hooks";
pub const CLAUDE_SCRIPT: &str = "claude.cmd";
pub const CODEX_SCRIPT: &str = "codex.cmd";
/// STAT-040: the script Claude Code's status line feeds, and the user's own status line command
/// Kolux displaced, kept beside it and still run after Kolux's post.
pub const STATUS_SCRIPT: &str = "claude-status.cmd";
pub const STATUS_PREV: &str = "claude-status-prev.sh";
/// Raised with a `Usage` on every status-line report.
pub const USAGE_EVENT: &str = "claude-usage";
/// Store key: the rate-limit windows the last status-line report carried (JSON `Limit` list).
pub const LIMITS_KEY: &str = "claudeRateLimits";
/// The running Kolux's port and token, read by the script on every run (a pane outlives a restart).
pub const ENDPOINT_FILE: &str = "agent-hooks-endpoint.txt";
pub const HOOK_VERSION: u32 = 1;
/// Claude Code's events Kolux listens to. `PreCompact` is never installed (COMPAT 3.4).
pub const CLAUDE_EVENTS: [&str; 12] = [
    "SessionStart", "UserPromptSubmit", "Stop", "StopFailure", "SubagentStart", "SubagentStop", "TeammateIdle",
    "PreToolUse", "PostToolUse", "PostToolUseFailure", "PermissionRequest", "PostCompact",
];
const TOOL_EVENTS: [&str; 4] = ["PreToolUse", "PostToolUse", "PostToolUseFailure", "PermissionRequest"];
/// Codex's events Kolux listens to (COMPAT 3.4).
pub const CODEX_EVENTS: [&str; 8] = ["SessionStart", "UserPromptSubmit", "PreToolUse", "PermissionRequest", "PostToolUse", "SubagentStart", "SubagentStop", "Stop"];
/// Codex's own name for the tool that asks the user a question (COMPAT 3.5).
const CODEX_ASK_TOOL: &str = "request_user_input";
/// Time for Codex's app server to list a home's hooks; it is started hidden and ended afterwards.
const LIST_TIMEOUT: Duration = Duration::from_secs(15);
/// One Codex install at a time, so several launches write the trust table once (STAT-008).
static CODEX_INSTALL: Mutex<()> = Mutex::new(());
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
    /// USAGE-001: the boundary is a new agent process (Claude's start or resume), not a clear or a
    /// compact inside the running one. Its running time may start over, so the window's gauge
    /// forgets its reading without keeping a floor against late reports (marks FIX-2).
    #[serde(skip_serializing_if = "std::ops::Not::not")]
    pub fresh: bool,
    /// The file a write tool just finished with (VIEW-023: the card links to the newest one).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub wrote: Option<String>,
    /// Why a blocked state happened (STAT-022): `limit`, `signin` or `error`.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cause: Option<&'static str>,
    /// SAFE-001: the whole plan Claude asks to leave plan mode with; only on its exit-plan step.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub plan: Option<String>,
    /// SAFE-006: the plan was trimmed to fit its status update; the whole plan is in the terminal.
    #[serde(rename = "planCut", skip_serializing_if = "std::ops::Not::not")]
    pub plan_cut: bool,
    /// SESS-030: the agent's own session id (`session_id`), what its resume command takes.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub session: Option<String>,
    /// STAT-027: the question asked (every question, one per line), while the agent waits on it;
    /// the Board card's line shows it whole. The plan to review rides on `plan` alone (T-123-d).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ask: Option<String>,
}

/// STAT-027: Claude Code's tools that wait on the user's answer rather than run.
const QUESTION_TOOLS: [&str; 2] = ["AskUserQuestion", "ExitPlanMode"];
/// STAT-025: task-list bookkeeping tools; their input is never shown as what the agent is doing.
const LIST_TOOLS: [&str; 5] = ["TodoWrite", "TaskCreate", "TaskUpdate", "TaskList", "TaskGet"];
/// STAT-027: the longest question carried; a longer one is cut and says so.
const ASK_MAX: usize = 8000;

/// STAT-027: the text the agent waits on: the plan (ExitPlanMode's `plan`) or the questions
/// (AskUserQuestion's `questions`). The card's first line comes from it; only the questions ride on
/// `ask`, the plan is `plan`'s (status.rs sizes the whole update around it, SAFE-006).
fn ask_of(tool: Option<&str>, input: Option<&Value>) -> Option<String> {
    let input = input?;
    let text = match tool? {
        "ExitPlanMode" => input.get("plan")?.as_str()?.to_string(),
        "AskUserQuestion" => input.get("questions")?.as_array()?.iter().filter_map(|q| q.get("question").and_then(Value::as_str)).collect::<Vec<_>>().join("\n"),
        _ => return None,
    };
    let text = text.trim();
    if text.is_empty() {
        return None;
    }
    Some(if text.chars().count() > ASK_MAX { format!("{}\n… (cut)", text.chars().take(ASK_MAX).collect::<String>()) } else { text.to_string() })
}

/// What the card shows of a tool step: nothing for list bookkeeping, the question's first line,
/// else the input's one line (STAT-025, STAT-027).
fn step_detail(tool: Option<&str>, input: Option<&Value>, ask: Option<&str>) -> Option<String> {
    if tool.is_some_and(|t| LIST_TOOLS.contains(&t)) {
        return None;
    }
    match ask {
        Some(a) => a.lines().map(str::trim).find(|l| !l.is_empty()).map(|l| trim(l, 160)),
        None => tool_detail(input),
    }
}

/// STAT-022's three causes for Claude Code's failure kinds (the StopFailure `error` values): a
/// rate limit is the limit; authentication, an organisation that is not allowed and failed
/// verification are sign-in; everything else, known or not, is the provider's error.
pub fn stop_cause(error: &str) -> &'static str {
    match error {
        "rate_limit" => "limit",
        "authentication_failed" | "oauth_org_not_allowed" | "verification_required" => "signin",
        _ => "error",
    }
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
    let pick = ["command", "cmd", "file_path", "path", "pattern", "description", "prompt", "question"]
        .iter()
        .find_map(|k| input.get(*k).and_then(Value::as_str))
        .or_else(|| input.values().find_map(Value::as_str))?;
    Some(trim(&fold(pick), 160))
}

/// SAFE-001: the plan text of Claude's exit-plan tool call, when it carries one.
fn plan_of(tool: Option<&str>, input: Option<&Value>) -> Option<String> {
    (tool == Some("ExitPlanMode")).then(|| input?.get("plan")?.as_str().filter(|p| !p.trim().is_empty()).map(str::to_string)).flatten()
}

/// Claude Code's event mapping (COMPAT 3.5). `None` means the pane's state does not change.
pub fn claude_change(event: &Value) -> Option<Change> {
    let name = event.get("hook_event_name")?.as_str()?;
    // A sub-agent's events belong to the roster (STAT-026, status.rs), never to the lead's own state.
    if event.get("agent_id").and_then(Value::as_str).is_some_and(|a| !a.is_empty()) {
        return None;
    }
    let str_of = |k: &str| event.get(k).and_then(Value::as_str);
    let tool = str_of("tool_name").map(|t| trim(t, 60));
    let plain = |state: &'static str| Some(Change { state, ..Change::default() });
    let change = match name {
        "SessionStart" => matches!(str_of("source"), Some("startup" | "resume" | "clear"))
            .then_some(Change { state: "done", boundary: true, fresh: matches!(str_of("source"), Some("startup" | "resume")), ..Change::default() }),
        "UserPromptSubmit" => Some(Change {
            state: "working",
            prompt: str_of("prompt").or_else(|| str_of("user_prompt")).map(|p| trim(&fold(p), 16000)),
            ..Change::default()
        }),
        // The interrupted flag and "stays working while a child works" are the session's (status.rs).
        "Stop" => plain("done"),
        "StopFailure" => {
            // STAT-022: a failure report with no error attached is not a stop.
            let error = str_of("error")?;
            Some(Change { state: "blocked", cause: Some(stop_cause(error)), detail: str_of("error_details").map(|e| trim(&fold(e), 160)), ..Change::default() })
        }
        "PreToolUse" | "PermissionRequest" => {
            // STAT-027: a question, even one asked as a permission, is waiting with its text. The
            // exit-plan step asked as a permission stays a real permission (SAFE-001, SAFE-007): its
            // wait ends only when that tool finishes, never on unrelated tool work.
            let asks = tool.as_deref().is_some_and(|t| QUESTION_TOOLS.contains(&t));
            let text = ask_of(tool.as_deref(), event.get("tool_input"));
            let state = match (name, tool.as_deref()) {
                ("PermissionRequest", Some("AskUserQuestion")) => "waiting",
                ("PermissionRequest", _) => "permission",
                _ if asks => "waiting",
                _ => "working",
            };
            Some(Change {
                state,
                detail: step_detail(tool.as_deref(), event.get("tool_input"), text.as_deref()),
                plan: plan_of(tool.as_deref(), event.get("tool_input")),
                // T-123-d: a question rides whole on `ask`; the plan already rides on `plan`, never twice.
                ask: text.filter(|_| tool.as_deref() == Some("AskUserQuestion")),
                tool,
                ..Change::default()
            })
        }
        "PostToolUse" => Some(Change {
            state: "working",
            wrote: matches!(tool.as_deref(), Some("Write" | "Edit" | "MultiEdit" | "NotebookEdit"))
                .then(|| event.get("tool_input").and_then(|i| i.get("file_path")).and_then(Value::as_str).map(str::to_string))
                .flatten(),
            ..Change::default()
        }),
        "PostToolUseFailure" => plain("working"),
        "PostCompact" => (str_of("trigger") == Some("manual")).then_some(Change { state: "done", boundary: true, ..Change::default() }),
        // SubagentStart, SubagentStop and TeammateIdle feed the roster (status.rs); PreCompact is refused.
        _ => None,
    };
    change.map(|c| with_session(c, event))
}

/// SESS-030, TERM-036: the event's `session_id`, if any, rides on the change (trimmed, at most 100
/// characters); a pane's resume command and Copy Session ID both read it.
fn with_session(mut change: Change, event: &Value) -> Change {
    change.session = event.get("session_id").and_then(Value::as_str).map(str::trim).filter(|s| !s.is_empty()).map(|s| trim(s, 100));
    change
}

/// Codex's event mapping (COMPAT 3.5, STAT-008). `None` means the pane's state does not change.
pub fn codex_change(event: &Value) -> Option<Change> {
    let name = event.get("hook_event_name")?.as_str()?;
    if event.get("agent_id").and_then(Value::as_str).is_some_and(|a| !a.is_empty()) {
        return None;
    }
    let str_of = |k: &str| event.get(k).and_then(Value::as_str);
    let tool = str_of("tool_name").map(|t| trim(t, 60));
    let plain = |state: &'static str| Some(Change { state, ..Change::default() });
    let change = match name {
        // Codex is working from the moment a session opens; the roster and transcript start over.
        "SessionStart" => Some(Change { state: "working", boundary: true, ..Change::default() }),
        "UserPromptSubmit" => Some(Change { state: "working", prompt: str_of("prompt").map(|p| trim(&fold(p), 16000)), ..Change::default() }),
        "PreToolUse" => Some(Change {
            state: if tool.as_deref() == Some(CODEX_ASK_TOOL) { "waiting" } else { "working" },
            detail: tool_detail(event.get("tool_input")),
            tool,
            ..Change::default()
        }),
        // The hook only reports; it never answers an approval (COMPAT 3.1).
        "PermissionRequest" => Some(Change { state: "permission", detail: tool_detail(event.get("tool_input")), tool, ..Change::default() }),
        "PostToolUse" => plain("working"),
        "Stop" => plain("done"),
        _ => None,
    };
    change.map(|c| with_session(c, event))
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
/// BROW-051: the local endpoint answers only Kolux's own tools. A request from a web page (one
/// carrying an Origin, Referer or Sec-Fetch header, which every browser adds and no tool does),
/// one whose Host names anything but this computer (DNS rebinding aims a name at 127.0.0.1) and
/// one without the token all get 404 with an empty body, so nothing about the endpoint is told.
pub fn gate(req: &Request, token: &str) -> Option<u16> {
    let h = &req.headers;
    if ["origin", "referer", "sec-fetch-site", "sec-fetch-mode", "sec-fetch-dest"].iter().any(|k| h.contains_key(*k)) {
        return Some(404);
    }
    if let Some(host) = h.get("host") {
        let name = host.rsplit_once(':').filter(|(_, port)| !port.is_empty() && port.bytes().all(|b| b.is_ascii_digit())).map_or(host.as_str(), |(n, _)| n);
        if !matches!(name, "127.0.0.1" | "localhost" | "[::1]") {
            return Some(404);
        }
    }
    (h.get(TOKEN_HEADER).map(String::as_str) != Some(token)).then_some(404)
}

pub fn answer(req: &Request, token: &str) -> (u16, Option<crate::status::Status>) {
    if req.headers.get(TOKEN_HEADER).map(String::as_str) != Some(token) {
        return (403, None);
    }
    let Some((pane_key, terminal)) = req.headers.get(IDENTITY_HEADER).and_then(|h| identity(h)) else { return (400, None) };
    let Ok(event) = serde_json::from_slice::<Value>(&req.body) else { return (400, None) };
    let (agent, event) = match req.path.as_str() {
        "/claude" => (crate::status::Agent::Claude, event),
        "/codex" => (crate::status::Agent::Codex, event),
        // T-120-b: Gemini CLI, Antigravity and Amp, each turned into the shape the rules read.
        p if agent_hooks::vendors::is_route(p) => match agent_hooks::vendors::normalize(p, &event) {
            Some(e) => (crate::status::Agent::Vendor, e),
            None => return (200, None),
        },
        _ => return (404, None),
    };
    (200, crate::status::report(pane_key, terminal, agent, &event))
}

/// SAFE-009: what the hook prints back to Claude. A Bash or PowerShell command that trips a
/// protected rule gets the PreToolUse ask block naming the rule; everything else (another tool or
/// event, Codex, a body that cannot be read) gets `{}`, no opinion, so Claude's own permission
/// flow carries on and Kolux never blocks by itself.
pub fn reply_body(path: &str, body: &[u8], settings: &Value) -> String {
    // T-120-b: Antigravity's PreToolUse hook must answer; "allow" hands the call to its own policy.
    if path == "/antigravity/PreToolUse" {
        return json!({ "decision": "allow" }).to_string();
    }
    let ask = || {
        if path != "/claude" {
            return None;
        }
        let event: Value = serde_json::from_slice(body).ok()?;
        if event.get("hook_event_name")?.as_str()? != "PreToolUse" || !matches!(event.get("tool_name")?.as_str()?, "Bash" | "PowerShell") {
            return None;
        }
        let base = crate::protected::Base::from_env(event.get("cwd").and_then(Value::as_str));
        let rule = crate::protected::check(event.get("tool_input")?.get("command")?.as_str()?, &base, settings)?;
        Some(json!({ "hookSpecificOutput": { "hookEventName": "PreToolUse", "permissionDecision": "ask", "permissionDecisionReason": crate::protected::reason(rule.name) } }).to_string())
    };
    ask().unwrap_or_else(|| "{}".into())
}

/// One rate-limit window as Claude Code's status line reports it (STAT-040), reset in ms.
#[derive(Clone, Debug, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Limit {
    pub kind: String,
    pub used_percent: f64,
    pub resets_at: Option<i64>,
}

/// What one status-line report says: the pane's context spent and window, in tokens, and the
/// account's windows. The fill is worked out by the window side (USAGE-005: the 200k cap).
#[derive(Clone, Debug, PartialEq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Usage {
    pub pane_key: u32,
    pub context_tokens: Option<u64>,
    pub context_window: Option<u64>,
    pub limits: Vec<Limit>,
    /// USAGE-001: the report's clock, so the window can throw away a report that turns up after a
    /// newer one. `session` is the session id with the terminal that ran it: a resume in a new
    /// terminal keeps the id but starts the running time over, so it is a new clock. A resume in
    /// the same terminal keeps the clock; its SessionStart is a `fresh` boundary, which the window
    /// answers by forgetting the reading without a floor. `at` is the session's running time in
    /// milliseconds. Both are none when either part is missing.
    pub session: Option<String>,
    pub at: Option<u64>,
    /// USAGE-034: the session's cost so far in US dollars (the report's cost.total_cost_usd); none
    /// when the report has none or a figure that is not a number of at least zero.
    pub cost_usd: Option<f64>,
    /// The config folder the report came from (USAGE-021); none for the default sign-in.
    #[serde(skip)]
    pub config_dir: Option<String>,
}

/// A status-line report: token-checked like a hook, then the figures. `Err` is the status code.
pub fn usage(req: &Request, token: &str) -> Result<Usage, u16> {
    if req.headers.get(TOKEN_HEADER).map(String::as_str) != Some(token) {
        return Err(403);
    }
    let (pane_key, terminal) = req.headers.get(IDENTITY_HEADER).and_then(|h| identity(h)).ok_or(400u16)?;
    let v: Value = serde_json::from_slice(&req.body).map_err(|_| 400u16)?;
    // At most 200 characters of the id, like the other fields this route passes on (marks FIX-2).
    let session = v["session_id"].as_str().map(str::trim).filter(|s| !s.is_empty()).map(|s| trim(s, 200)).zip(terminal).map(|(s, t)| format!("{s}@{t}"));
    let at = session.as_ref().and(v["cost"]["total_duration_ms"].as_u64());
    let cost_usd = v["cost"]["total_cost_usd"].as_f64().filter(|c| c.is_finite() && *c >= 0.0);
    let cw = &v["context_window"];
    let context_window = cw.get("context_window_size").and_then(Value::as_u64);
    // USAGE-005: the total it states, else input plus cache writes plus cache reads, else its
    // percentage applied to the window.
    let context_tokens = cw
        .get("total_input_tokens")
        .and_then(Value::as_u64)
        .or_else(|| {
            let c = cw.get("current_usage")?;
            let n = |k: &str| c.get(k).and_then(Value::as_u64);
            Some(n("input_tokens")? + n("cache_creation_input_tokens").unwrap_or(0) + n("cache_read_input_tokens").unwrap_or(0))
        })
        .or_else(|| Some((cw.get("used_percentage")?.as_f64()? / 100.0 * context_window? as f64).round() as u64));
    let context_window = context_tokens.and(context_window);
    let limits = v["rate_limits"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|l| {
            Some(Limit {
                kind: l.get("kind")?.as_str()?.to_string(),
                used_percent: l.get("percentUsed").or_else(|| l.get("used_percentage")).and_then(Value::as_f64)?,
                resets_at: l.get("resetsAt").or_else(|| l.get("resets_at")).and_then(when_ms),
            })
        })
        .collect();
    let config_dir = req.headers.get(CONFIG_HEADER).map(|h| h.trim().to_string()).filter(|h| !h.is_empty());
    Ok(Usage { pane_key, context_tokens, context_window, limits, session, at, cost_usd, config_dir })
}

/// USAGE-021: a report counts only when it comes from the folder the active account runs under;
/// none on both sides is the computer's default sign-in. Case and slash direction do not matter.
pub fn same_folder(active: Option<&str>, reported: Option<&str>) -> bool {
    let norm = |p: &str| p.trim().replace('\\', "/").trim_end_matches('/').to_ascii_lowercase();
    active.map(norm) == reported.map(norm)
}

/// USAGE-021: an update that carries one window leaves the other as it was.
pub fn merge_limits(mut old: Vec<Limit>, new: &[Limit]) -> Vec<Limit> {
    for l in new {
        match old.iter_mut().find(|o| o.kind == l.kind) {
            Some(o) => *o = l.clone(),
            None => old.push(l.clone()),
        }
    }
    old
}

/// When the soonest window that is used up lifts, in ms; none when nothing is used up.
pub fn exhausted(limits: &[Limit]) -> Option<i64> {
    limits.iter().filter(|l| l.used_percent >= 100.0).filter_map(|l| l.resets_at).min()
}

/// A time as ms since 1970: an ISO 8601 stamp (the status line's form), or a number in seconds
/// or ms.
pub fn when_ms(v: &Value) -> Option<i64> {
    if let Some(n) = v.as_f64() {
        return Some(if n < 1e12 { (n * 1000.0) as i64 } else { n as i64 });
    }
    iso_ms(v.as_str()?)
}

/// `YYYY-MM-DDTHH:MM:SS`, optional fraction, then `Z` or `+HH:MM`. Hand-rolled: nothing in the
/// tree parses dates and the status line's one form does not earn a crate.
fn iso_ms(s: &str) -> Option<i64> {
    let num = |a: usize, n: usize| s.get(a..a + n)?.parse::<i64>().ok();
    let (y, mo, d, h, mi, se) = (num(0, 4)?, num(5, 2)?, num(8, 2)?, num(11, 2)?, num(14, 2)?, num(17, 2)?);
    if !(1..=12).contains(&mo) || !(1..=31).contains(&d) {
        return None;
    }
    let mut rest = s.get(19..)?;
    let mut frac = 0;
    if let Some(after) = rest.strip_prefix('.') {
        let digits: String = after.chars().take_while(char::is_ascii_digit).collect();
        frac = format!("{digits:0<3}").get(..3)?.parse::<i64>().ok()?;
        rest = &after[digits.len()..];
    }
    let offset = match rest {
        "" | "Z" => 0,
        o => {
            let sign = match o.as_bytes()[0] { b'+' => 1, b'-' => -1, _ => return None };
            sign * (o.get(1..3)?.parse::<i64>().ok()? * 60 + o.get(4..6)?.parse::<i64>().ok()?) * 60
        }
    };
    // Days since 1970-01-01 from the civil date (Howard Hinnant's days_from_civil).
    let (y, mo) = if mo <= 2 { (y - 1, mo + 9) } else { (y, mo - 3) };
    let era = y.div_euclid(400);
    let yoe = y - era * 400;
    let doy = (153 * mo + 2) / 5 + d - 1;
    let days = era * 146_097 + yoe * 365 + yoe / 4 - yoe / 100 + doy - 719_468;
    Some((days * 86_400 + h * 3_600 + mi * 60 + se - offset) * 1_000 + frac)
}

/// STAT-040: keeps the figures and raises them. A report with only the context size leaves the
/// rate-limit figures alone; a window that is used up writes when it lifts for the Claude card
/// (`claudeUsageLimitResetsAt`) and for the next limit stop.
fn record_usage(app: &AppHandle, u: &Usage) {
    let mut u = u.clone();
    // FIX-2 (council FS-4): the windows this report itself carried, named before the merge with the
    // stored ones, so the pill takes only these as forecast readings stamped now.
    let carried: Vec<String> = u.limits.iter().map(|l| l.kind.clone()).collect();
    if !u.limits.is_empty() {
        if let Some(store) = app.try_state::<Mutex<crate::state::Store>>() {
            if let Ok(store) = store.lock() {
                let old = store.get(LIMITS_KEY).ok().flatten().and_then(|t| serde_json::from_str(&t).ok()).unwrap_or_default();
                u.limits = merge_limits(old, &u.limits);
                let _ = store.set(LIMITS_KEY, &json!(u.limits).to_string());
                if let Some(at) = exhausted(&u.limits) {
                    let _ = store.set(crate::claude_key::LIMIT_KEY, &at.to_string());
                }
            }
        }
        let lifts = exhausted(&u.limits);
        crate::status::LIMIT_RESETS_AT.store(lifts.unwrap_or(0), Ordering::Relaxed);
        if lifts.is_some() {
            let _ = app.emit(crate::claude_key::EVENT, ());
        }
    }
    let mut payload = json!(u);
    payload["carried"] = json!(carried);
    let _ = app.emit(USAGE_EVENT, payload);
}

/// The config folder the active Claude account runs under; none for the default sign-in.
fn active_config_dir(app: &AppHandle) -> Option<String> {
    let store = app.try_state::<Mutex<crate::state::Store>>()?;
    let store = store.lock().ok()?;
    crate::claude_accounts::active_dir(&store)
}

/// The rate-limit windows the last status-line report carried, for the usage pill at start.
#[tauri::command]
pub fn claude_usage(store: tauri::State<'_, Mutex<crate::state::Store>>) -> Result<Vec<Limit>, String> {
    let store = store.lock().map_err(|e| e.to_string())?;
    Ok(store.get(LIMITS_KEY).ok().flatten().and_then(|t| serde_json::from_str(&t).ok()).unwrap_or_default())
}

fn handle(mut stream: TcpStream, app: &AppHandle, token: &str) {
    stream.set_read_timeout(Some(Duration::from_secs(2))).ok();
    let mut reader = BufReader::new(&stream);
    let mut body = String::from("{}");
    let code = match parse_request(&mut reader) {
        Some(req) if gate(&req, token).is_some() => 404,
        Some(req) if req.path == "/claude-status" => match usage(&req, token) {
            // USAGE-021: a report from another config folder than the active account's is dropped.
            Ok(u) if same_folder(active_config_dir(app).as_deref(), u.config_dir.as_deref()) => {
                record_usage(app, &u);
                200
            }
            Ok(_) => 200,
            Err(code) => code,
        },
        Some(req) => {
            let (code, status) = answer(&req, token);
            if let Some(status) = status {
                crate::resume::on_stop(app, status.pane_key, status.stop.as_ref());
                agent_hooks::saved::note(app, &req.path, &req.body, &status);
                // AUTO-012: an automation run in this pane completes on its agent's real finish.
                crate::automations::follow(app, |s| crate::automations::on_status(s, status.terminal, status.pane_key, status.change.state, status.change.boundary, status.child.is_some(), crate::automations::now_ms()));
                let _ = app.emit(EVENT, status);
            }
            if code == 200 {
                // SAFE-009: the settings are read now, so a rule switched off applies to this command.
                let settings = app.try_state::<Mutex<crate::state::Store>>().and_then(|s| s.lock().ok().map(|s| s.settings())).unwrap_or_default();
                body = reply_body(&req.path, &req.body, &settings);
            }
            code
        }
        None => 400,
    };
    if code == 404 {
        body.clear();
    }
    let _ = write!(stream, "HTTP/1.1 {code} OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}", body.len());
    let _ = stream.flush();
}

/// Opens the listener on a loopback port and writes the endpoint file; hooks answer on a thread.
pub fn serve(app: AppHandle, data_dir: &Path) -> Result<Hooks, String> {
    let listener = TcpListener::bind("127.0.0.1:0").map_err(|e| e.to_string())?;
    let port = listener.local_addr().map_err(|e| e.to_string())?.port();
    let token = crate::cli::secret();
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
/// system curl inside 1.5 s, always exits 0. It prints Kolux's answer, which is `{}` or the
/// PreToolUse ask of a protected command (SAFE-009); nothing when Kolux cannot be reached.
pub fn claude_script() -> String {
    script("Claude Code (STAT-001, STAT-007, SAFE-009)", "claude", true)
}

/// The Codex hook script (STAT-008): the same, posting to Kolux's Codex path, answer discarded.
pub fn codex_script() -> String {
    script("Codex (STAT-008)", "codex", false)
}

/// The status-line script (STAT-040): the same guards and post, to the status route.
pub fn status_script() -> String {
    script("Claude Code's status line (STAT-040)", "claude-status", false)
}

/// The `statusLine` command (STAT-040). Claude Code runs it through a POSIX shell on Windows
/// too, so it keeps stdin in a file, posts it with the script, then feeds the user's own status
/// line (`prev`, the command Kolux displaced, when that file exists) from the same file, so what
/// the user had keeps drawing.
pub fn status_command(script: &str, prev: &str) -> String {
    format!("k=\"${{TMPDIR:-/tmp}}/kolux-rs-status-$$\"; cat >\"$k\"; \"{script}\" <\"$k\" >/dev/null 2>&1; [ -f \"{prev}\" ] && sh \"{prev}\" <\"$k\"; rm -f \"$k\"; exit 0")
}

/// STAT-006: outside a Kolux pane the script leaves before reading stdin; the address comes from
/// the endpoint file (agents that strip the token variables included), else the variables; the
/// event is posted with the system curl inside 1.5 s; one Kolux cannot take or answer it is
/// appended, one whole line, to the holding file beside the endpoint file (`spool`), for the next
/// start. Delayed expansion is off, the agent's home path loses quotes and a trailing backslash,
/// and no parenthesised block holds a path, so `!`, `&` and `)` in paths change nothing.
/// `prints` (SAFE-009): Kolux's answer goes to stdout for the agent to read instead of to NUL.
///
/// FIX-2 (S7, COMPAT 3.1): the held line is `route|identity|config|` (KR) and a small JSON object
/// of only the fields the status rules read, made by Windows PowerShell (every Windows has it):
/// the event, tool and session names, a few short flags and ids, `cwd`, whether the background
/// lists were empty, and the time it was held. The tool's input and output, the prompt and the
/// reply never reach the file. It runs only when Kolux cannot take the event.
///
/// hooks FIX-3: an event PowerShell 5.1 cannot parse (keys that differ only in case, for one) is
/// still held as a minimal pick, the event and session names found by a pattern that takes only
/// name characters; one with no event name is dropped. The append is tried again (up to 20 times,
/// 100 ms apart) while another hook holds the file.
///
/// hooks FIX-4: the pattern looks only at top-level keys before the first nested `{` (the key
/// must follow the opening brace or a comma, so it is never text inside a string), so a word from
/// the tool's input never becomes the held event or session name: an event whose nested object
/// comes first is dropped. Only a sharing violation (another writer holds the file) is tried
/// again; any other failure, a missing holding folder for one, gives up at once.
pub(crate) const SPOOL_LINE: &str = concat!(
    r#"%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe -NoProfile -NonInteractive -Command ""#,
    r#"$ErrorActionPreference='Stop'; try { $t=[IO.File]::ReadAllText($env:KF,[Text.Encoding]::UTF8); $o=[ordered]@{}; $ok=$true; "#,
    r#"try { $e=ConvertFrom-Json -InputObject $t; "#,
    r#"foreach ($k in 'hook_event_name','tool_name','session_id','agent_id','agent_type','model','source','trigger','error','is_interrupt','cwd','conversationId','fullyIdle') "#,
    r#"{ $v=$e.$k; if ($v -is [string]) { $o[$k]=$v.Substring(0,[Math]::Min($v.Length,300)) } elseif ($v -is [bool]) { $o[$k]=$v } }; "#,
    r#"$n=$e.toolCall.name; if ($n -is [string]) { $o['toolCall']=@{name=$n.Substring(0,[Math]::Min($n.Length,300))} }; "#,
    r#"foreach ($k in 'background_tasks','session_crons') { if ($null -ne $e.$k -and @($e.$k).Count -gt 0) { $o[$k]=@(1) } } } "#,
    r#"catch { $o.Clear(); $q=[char]34; foreach ($k in 'hook_event_name','session_id') "#,
    r#"{ $m=[regex]::Match($t,'^\s*\{(?:[^{]*?,)?\s*'+$q+$k+$q+'\s*:\s*'+$q+'([\w.:-]{1,200})'+$q); if ($m.Success) { $o[$k]=$m.Groups[1].Value } }; $ok=$o.Contains('hook_event_name') }; "#,
    r#"if ($ok) { $o['spooled_at']=[DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds(); "#,
    r#"$l=$env:KR + (ConvertTo-Json -InputObject $o -Compress -Depth 3) + [char]13 + [char]10; "#,
    r#"for ($i=0; $i -lt 20; $i++) { try { [IO.File]::AppendAllText($env:KS, $l, (New-Object Text.UTF8Encoding $false)); break } "#,
    r#"catch { $x=$_.Exception; if ($x.InnerException) { $x=$x.InnerException }; if ($x.HResult -ne -2147024864) { break }; Start-Sleep -Milliseconds 100 } } } } catch { }""#,
    r#" <NUL >NUL 2>&1"#
);

fn script(agent: &str, route: &str, prints: bool) -> String {
    let head = format!("rem Kolux RS agent hook for {agent}. Written by Kolux RS; edits are overwritten.");
    let (out, after) = if prints { ("", "2>NUL") } else { ("-o NUL ", ">NUL 2>&1") };
    let post = format!("%SystemRoot%\\System32\\curl.exe -s -m 1.5 --connect-timeout 0.5 --noproxy \"*\" -X POST -H \"Content-Type: application/json\" -H \"X-Kolux-Token: %KT%\" -H \"X-Kolux-Pane: %KOLUX_HOOK_IDENTITY%\" -H \"X-Kolux-Config: %KC%\" --data-binary \"@%KF%\" {out}\"http://127.0.0.1:%KP%/{route}\" {after}");
    // A status-line reading is only worth its moment: it is never held for later.
    let spool = route != "claude-status";
    let record = format!("set \"KR={route}|%KOLUX_HOOK_IDENTITY%|%KC%|\"");
    let keep = format!("for %%d in (\"%KE%\") do set \"KS=%%~dpd{}\"", agent_hooks::saved::SPOOL_FILE);
    let mut lines = vec![
        "@echo off",
        head.as_str(),
        "setlocal DisableDelayedExpansion",
        "rem Outside a Kolux pane there is nothing to report: leave before reading stdin.",
        "if \"%KOLUX_PANE_KEY%\"==\"\" exit /b 0",
        "if \"%KOLUX_HOOK_IDENTITY%\"==\"\" exit /b 0",
        "set \"KP=%KOLUX_AGENT_HOOK_PORT%\"",
        "set \"KT=%KOLUX_AGENT_HOOK_TOKEN%\"",
        "set \"KE=%KOLUX_HOOK_ENDPOINT%\"",
        "rem The endpoint file names the Kolux running now, so a pane outlives a Kolux restart.",
        "if defined KE if exist \"%KE%\" for /f \"usebackq tokens=1,2\" %%a in (\"%KE%\") do (set \"KP=%%a\" & set \"KT=%%b\")",
        "set \"KC=%CLAUDE_CONFIG_DIR%\"",
        // FIX-2: an unset variable's `%KC:...%` is not empty text but a broken line that stops
        // the whole script, so the edits run only on lines reached when KC is set.
        "if not defined KC goto config",
        "set \"KC=%KC:\"=%\"",
        "if not defined KC goto config",
        "if \"%KC:~-1%\"==\"\\\" set \"KC=%KC:~0,-1%\"",
        ":config",
        "set \"KN=%TIME::=%\"",
        "set \"KN=%KN:.=%\"",
        "set \"KN=%KN:,=%\"",
        "set \"KN=%KN: =%\"",
        ":name",
        "set \"KF=%TEMP%\\kolux-rs-hook-%KOLUX_PANE_KEY%-%KN%-%RANDOM%.json\"",
        "if exist \"%KF%\" goto name",
        "%SystemRoot%\\System32\\more.com >\"%KF%\"",
        "if not defined KP goto spool",
        "if not defined KT goto spool",
        post.as_str(),
        "if not errorlevel 1 goto done",
        ":spool",
    ];
    if spool {
        lines.extend([
            "rem Kolux is closed or not answering: the event waits, one whole line, for the next start.",
            "if not defined KE goto done",
            "for %%z in (\"%KF%\") do if %%~zz==0 goto done",
            keep.as_str(),
            record.as_str(),
            "rem Only what the status needs is held: never the tool's input or output, the prompt or the reply.",
            SPOOL_LINE,
        ]);
    }
    lines.extend([":done", "del \"%KF%\" >NUL 2>&1", "exit /b 0", ""]);
    lines.join("\r\n")
}

/// Writes the script under `home` (only when it changed) and returns its path with forward slashes.
pub fn write_claude_script(home: &Path) -> Result<String, String> {
    write_script(home, CLAUDE_SCRIPT, &claude_script())
}

pub fn write_codex_script(home: &Path) -> Result<String, String> {
    write_script(home, CODEX_SCRIPT, &codex_script())
}

pub fn write_status_script(home: &Path) -> Result<String, String> {
    write_script(home, STATUS_SCRIPT, &status_script())
}

fn write_script(home: &Path, name: &str, script: &str) -> Result<String, String> {
    let dir = home.join(SCRIPT_DIR);
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let file = dir.join(name);
    let old = std::fs::read_to_string(&file).ok();
    if old.as_deref() != Some(script) {
        // STAT-005: a file of the user's under Kolux's name is never overwritten.
        if old.is_some_and(|o| !o.contains("Written by Kolux RS")) {
            return Err(format!("{} is not Kolux's own script; left alone", file.display()));
        }
        std::fs::write(&file, script).map_err(|e| e.to_string())?;
    }
    Ok(file.to_string_lossy().replace('\\', "/"))
}

/// Claude Code's user settings: `~/.claude/settings.json`, or the one in `CLAUDE_CONFIG_DIR`
/// (COMPAT 3.4); without the override it is not beside `~/.claude.json`.
pub fn claude_settings_file() -> PathBuf {
    match std::env::var("CLAUDE_CONFIG_DIR").ok().filter(|d| !d.trim().is_empty()) {
        Some(_) => crate::trust::claude_config_file().with_file_name("settings.json"),
        None => home_dir().join(".claude").join("settings.json"),
    }
}

fn is_my_command(command: &str) -> bool {
    command.replace('\\', "/").contains(SCRIPT_DIR)
}

fn is_mine(group: &Value) -> bool {
    group.get("hooks").and_then(Value::as_array).is_some_and(|hs| {
        hs.iter().any(agent_hooks::names_mine)
    })
}

/// Puts exactly one Kolux RS group under each of the twelve events, leaving every other entry
/// (another tool's hooks, the user's own) as it is. True when `settings` changed.
pub fn install_claude_hooks(settings: &mut Value, command: &str) -> bool {
    install_groups(settings, &CLAUDE_EVENTS, &TOOL_EVENTS, command, 10)
}

/// STAT-040: Kolux's command takes the `statusLine` slot, keeping padding and whatever else is
/// set there. Returns whether `settings` changed and the command found in the slot when it was
/// somebody else's, so the caller can keep it running after Kolux's post.
pub fn install_claude_status(settings: &mut Value, command: &str) -> (bool, Option<String>) {
    if !settings.is_object() {
        *settings = json!({});
    }
    let slot = settings.as_object_mut().unwrap().entry("statusLine").or_insert_with(|| json!({}));
    if !slot.is_object() {
        *slot = json!({});
    }
    let had = slot.get("command").and_then(Value::as_str).map(str::to_string);
    if had.as_deref() == Some(command) {
        return (false, None);
    }
    let displaced = had.filter(|c| !is_my_command(c) && !c.trim().is_empty());
    slot["type"] = json!("command");
    slot["command"] = json!(command);
    (true, displaced)
}

/// The same for Codex's `hooks.json` (STAT-008): one Kolux group per event, after the user's own.
pub fn install_codex_hooks(file: &mut Value, command: &str) -> bool {
    install_groups(file, &CODEX_EVENTS, &[], command, 10)
}

/// One Kolux group under each of `events`; a stale one is replaced where it stands, a new one
/// goes last. `matched` events get the match-everything matcher (COMPAT 3.4).
/// `timeout` is in the agent's own unit (seconds for Claude Code and Codex, ms for Gemini CLI).
fn install_groups(root: &mut Value, events: &[&str], matched: &[&str], command: &str, timeout: u64) -> bool {
    let before = root.clone();
    if !root.is_object() {
        *root = json!({});
    }
    let hooks = root.as_object_mut().unwrap().entry("hooks").or_insert_with(|| json!({}));
    if !hooks.is_object() {
        *hooks = json!({});
    }
    for event in events {
        let groups = hooks.as_object_mut().unwrap().entry(*event).or_insert_with(|| json!([]));
        if !groups.is_array() {
            *groups = json!([]);
        }
        let groups = groups.as_array_mut().unwrap();
        let hook = json!([{ "type": "command", "command": command, "timeout": timeout }]);
        let mine = if matched.contains(event) { json!({ "matcher": "*", "hooks": hook }) } else { json!({ "hooks": hook }) };
        match groups.iter().position(is_mine) {
            Some(i) => {
                // STAT-005: only Kolux's own hooks go; a user hook sharing their group stays.
                agent_hooks::strip(groups);
                groups.insert(i.min(groups.len()), mine);
            }
            None => groups.push(mine),
        }
    }
    agent_hooks::clear_unused(hooks.as_object_mut().unwrap(), events);
    *root != before
}

fn indent_of(text: &str) -> usize {
    text.lines().find_map(|l| { let n = l.len() - l.trim_start_matches(' ').len(); (n > 0).then_some(n) }).unwrap_or(2)
}

/// Installs the Claude hooks and the status line into `file` (created when missing, never
/// rewritten when unreadable): whether it changed, and the status-line command displaced.
#[cfg(test)]
pub fn install_claude(file: &Path, command: &str, status: &str) -> Result<(bool, Option<String>), String> {
    let text = match std::fs::read_to_string(file) {
        Ok(t) => Some(t),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => None,
        Err(e) => return Err(e.to_string()),
    };
    install_claude_from(file, text, command, status)
}

/// `install_claude` on the text read at the start of the whole operation (`None`: no file then):
/// if the file no longer holds those bytes when the new one is about to replace it (Claude Code
/// rewrites its settings on its own), nothing is written and the install fails (T-152 (5)).
pub fn install_claude_from(file: &Path, text: Option<String>, command: &str, status: &str) -> Result<(bool, Option<String>), String> {
    let original: Value = serde_json::from_str(text.as_deref().unwrap_or("{}")).map_err(|e| format!("{} is not JSON ({e}); hooks not installed", file.display()))?;
    let mut settings = original.clone();
    let hooks = install_claude_hooks(&mut settings, command);
    let (line, displaced) = install_claude_status(&mut settings, status);
    if !(hooks || line) {
        return Ok((false, None));
    }
    // T-152 (3): with Kolux's hook entries and the status line slot it takes set aside, the new
    // file must say exactly what the old one did; anything else is a bug and nothing is written.
    let rest = |v: &Value| {
        let mut v = v.clone();
        // T-152-b (4): a "hooks" object the user had, even an empty one, is part of his file.
        agent_hooks::remove_groups(&mut v, original.get("hooks").is_none());
        v.as_object_mut().map(|o| o.remove("statusLine"));
        v
    };
    if rest(&settings) != rest(&original) {
        return Err(format!("{}: the install would change more than Kolux's entries; hooks not installed", file.display()));
    }
    write_json(file, &settings, text.as_deref())?;
    Ok((true, displaced))
}

/// Pretty JSON laid out like `before` (its indent, line ends and final newline; two spaces and a
/// final newline for a new file), so a file Kolux rewrites keeps the user's layout.
pub(crate) fn render(value: &Value, before: Option<&str>) -> Result<Vec<u8>, String> {
    let indent = " ".repeat(before.map_or(2, indent_of));
    let mut out = Vec::new();
    let mut ser = serde_json::Serializer::with_formatter(&mut out, serde_json::ser::PrettyFormatter::with_indent(indent.as_bytes()));
    serde::Serialize::serialize(value, &mut ser).map_err(|e| e.to_string())?;
    if before.is_none_or(|t| t.ends_with('\n')) {
        out.push(b'\n');
    }
    // A newline inside a JSON string is written `\n`, so every raw one here is a line end.
    if before.is_some_and(|t| t.contains("\r\n")) {
        out = String::from_utf8(out).map_err(|e| e.to_string())?.replace('\n', "\r\n").into_bytes();
    }
    Ok(out)
}

fn write_json(file: &Path, value: &Value, before: Option<&str>) -> Result<(), String> {
    write_atomic(file, &render(value, before)?, before)
}

/// The end of the error `write_atomic` gives when the file changed since Kolux read it.
pub(crate) const CHANGED: &str = "changed since it was read; nothing written";

// Tests put a change to the file here; write_atomic makes it just before its re-read, as if
// Claude Code had saved the file between Kolux's read and its rename.
#[cfg(test)]
thread_local! {
    pub(crate) static BEFORE_REREAD: std::cell::RefCell<Vec<Box<dyn FnOnce()>>> = std::cell::RefCell::new(Vec::new());
}

/// T-152 (5): `bytes` replace `file` through a temp file in the same folder, written and synced to
/// disk, then renamed over it, but only while `file` still holds `before` (`None`: it did not
/// exist): a file changed since Kolux read it is left as it is and nothing is written.
///
/// T-152-b (5): one race is left. A save that lands between the re-read below and the rename is
/// overwritten; the window is one syscall, and Claude Code's own saves are whole-file renames, so
/// the loser is at most one of its saves (PROVENANCE.md, T-152-b).
pub(crate) fn write_atomic(file: &Path, bytes: &[u8], before: Option<&str>) -> Result<(), String> {
    if let Some(parent) = file.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let tmp = file.with_extension("json.kolux-rs-tmp");
    let written = std::fs::File::create(&tmp).and_then(|mut f| f.write_all(bytes).and_then(|_| f.sync_all()));
    // STAT-005: the rewritten file keeps the permissions the user's had.
    if let Ok(meta) = std::fs::metadata(file) {
        let _ = std::fs::set_permissions(&tmp, meta.permissions());
    }
    #[cfg(test)]
    if let Some(change) = BEFORE_REREAD.with(|c| c.borrow_mut().pop()) {
        change();
    }
    let now = match std::fs::read(file) {
        Ok(b) => Some(b),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => None,
        Err(e) => {
            let _ = std::fs::remove_file(&tmp);
            return Err(format!("{}: {e}", file.display()));
        }
    };
    if let Err(e) = written {
        let _ = std::fs::remove_file(&tmp);
        return Err(format!("{}: {e}", tmp.display()));
    }
    if now.as_deref() != before.map(str::as_bytes) {
        let _ = std::fs::remove_file(&tmp);
        return Err(format!("{} {CHANGED}", file.display()));
    }
    std::fs::rename(&tmp, file).map_err(|e| {
        let _ = std::fs::remove_file(&tmp);
        format!("{}: {e}; nothing written", file.display())
    })
}

/// `SessionStart` -> `session_start`: the label Codex uses in its trust keys.
fn snake(event: &str) -> String {
    let mut out = String::new();
    for (i, c) in event.chars().enumerate() {
        if c.is_uppercase() && i > 0 {
            out.push('_');
        }
        out.extend(c.to_lowercase());
    }
    out
}

/// Two paths name the same file: slashes and, on Windows, letter case do not count.
fn same_path(a: &str, b: &str) -> bool {
    let norm = |p: &str| {
        let p = p.strip_prefix(r"\\?\").unwrap_or(p).replace('\\', "/");
        if cfg!(windows) { p.to_lowercase() } else { p }
    };
    norm(a) == norm(b)
}

/// Codex's own view of a home's hooks, through `hooks/list` on its app server (DT-C3): the keys
/// and fingerprints its trust table wants. `None` when Codex is missing or does not answer.
fn codex_listing(home: &Path) -> Option<Vec<Value>> {
    let program = crate::agents::find_program("codex")?;
    let mut child = crate::codex_usage::app_server(&program, home).ok()?;
    let (tx, rx) = std::sync::mpsc::channel::<Value>();
    let out = child.stdout.take()?;
    std::thread::spawn(move || {
        for line in BufReader::new(out).lines().map_while(Result::ok) {
            if let Ok(v) = serde_json::from_str::<Value>(&line) {
                if tx.send(v).is_err() {
                    break;
                }
            }
        }
    });
    let mut stdin = child.stdin.take();
    let mut send = |m: Value| {
        if let Some(s) = stdin.as_mut() {
            let _ = writeln!(s, "{m}");
            let _ = s.flush();
        }
    };
    send(json!({ "id": 1, "method": "initialize", "params": { "clientInfo": { "name": "kolux-rs", "title": "Kolux RS", "version": env!("CARGO_PKG_VERSION") } } }));
    let deadline = Instant::now() + LIST_TIMEOUT;
    let mut listing = None;
    while listing.is_none() {
        let Ok(msg) = rx.recv_timeout(deadline.saturating_duration_since(Instant::now())) else { break };
        match msg.get("id").and_then(Value::as_i64) {
            Some(1) => {
                send(json!({ "method": "initialized" }));
                send(json!({ "id": 2, "method": "hooks/list", "params": { "cwds": [home.to_string_lossy()] } }));
            }
            // One entry per working folder, each with its hooks; Kolux reads them all together.
            Some(2) => {
                let data = msg.get("result").and_then(|r| r.get("data")).and_then(Value::as_array);
                listing = data.map(|d| d.iter().filter_map(|c| c.get("hooks").and_then(Value::as_array)).flatten().cloned().collect());
            }
            _ => {}
        }
    }
    child.stdin = stdin;
    crate::codex_usage::finish(child);
    listing
}

/// Marks Kolux's own entries of `hooks_file` trusted in `doc` with the fingerprints Codex listed
/// (STAT-008): `[hooks.state."<key>"] trusted_hash`. Nothing else in the table is touched; another
/// tool's hooks, and Kolux's entries in any other file, are left as they are. Gives back how many.
pub fn apply_trust(doc: &mut toml_edit::DocumentMut, listing: &[Value], hooks_file: &str) -> usize {
    let mut n = 0;
    for hook in listing {
        let s = |k: &str| hook.get(k).and_then(Value::as_str);
        let (Some(key), Some(hash), Some(command), Some(source)) = (s("key"), s("currentHash"), s("command"), s("sourcePath")) else { continue };
        if !is_my_command(command) || !same_path(source, hooks_file) {
            continue;
        }
        let hooks = doc.as_table_mut().entry("hooks").or_insert(toml_edit::table());
        let Some(hooks) = hooks.as_table_mut() else { continue };
        hooks.set_implicit(true);
        let state = hooks.entry("state").or_insert(toml_edit::table());
        let Some(state) = state.as_table_mut() else { continue };
        state.set_implicit(true);
        let Some(entry) = state.entry(key).or_insert(toml_edit::table()).as_table_mut() else { continue };
        entry.insert("trusted_hash", toml_edit::value(hash));
        n += 1;
    }
    n
}

/// The write half of `install_codex`: Kolux's groups into one Codex home's `hooks.json`, read as
/// `text`. T-152-b (4): before Kolux's first write a copy of the file is kept (and on every write
/// checked against its record), so removal gives back its exact bytes. True when written.
pub(crate) fn write_codex_groups(file: &Path, text: Option<&str>, hooks: &mut Value, command: &str) -> Result<bool, String> {
    let changed = install_codex_hooks(hooks, command);
    if changed {
        agent_hooks::back_up(file, &agent_hooks::codex_record(file))?;
        write_json(file, hooks, text)?;
    }
    Ok(changed)
}

/// Installs Kolux's hooks into `home/hooks.json` (after the user's own entries) and marks them
/// trusted in `home/config.toml` with Codex's own fingerprints (STAT-008). An unreadable or
/// unparsable file is left alone. When trust cannot be set, `hooks.json` goes back exactly as it
/// was (or away, when Kolux created it). True when something was written.
pub fn install_codex(home: &Path, command: &str) -> Result<bool, String> {
    install_codex_with(home, command, codex_listing)
}

/// `install_codex` with Codex's own listing passed in, so a test can make it fail without
/// starting Codex (hooks FIX-4).
pub(crate) fn install_codex_with(home: &Path, command: &str, listing: impl FnOnce(&Path) -> Option<Vec<Value>>) -> Result<bool, String> {
    let _one = CODEX_INSTALL.lock().map_err(|e| e.to_string())?;
    let file = home.join("hooks.json");
    let config = home.join("config.toml");
    let read = |f: &Path| match std::fs::read_to_string(f) {
        Ok(t) => Ok(Some(t)),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(format!("{}: {e}", f.display())),
    };
    let text = read(&file)?;
    let mut hooks: Value = serde_json::from_str(text.as_deref().unwrap_or("{}")).map_err(|e| format!("{} is not JSON ({e}); left alone", file.display()))?;
    let mut doc: toml_edit::DocumentMut = read(&config)?.unwrap_or_default().parse().map_err(|e| format!("{} is not valid TOML ({e}); left alone", config.display()))?;
    let changed = write_codex_groups(&file, text.as_deref(), &mut hooks, command)?;
    let real = crate::trust::real_path(&file)?;
    // Several launches write trust once: an unchanged file whose entries are all in the table is done.
    let state = doc.get("hooks").and_then(|h| h.get("state")).and_then(toml_edit::Item::as_table);
    let trusted = |event: &str| {
        let groups = hooks.get("hooks").and_then(|h| h.get(event)).and_then(Value::as_array)?;
        let index = groups.iter().position(is_mine)?;
        state?.get(&format!("{real}:{}:{index}:0", snake(event)))?.get("trusted_hash")
    };
    if !changed && CODEX_EVENTS.iter().all(|e| trusted(e).is_some()) {
        return Ok(false);
    }
    // hooks FIX-3: a file Kolux had just created goes with its `created` record, so no stray
    // record stays in the Codex home. hooks FIX-4: the file first, the record only once the file
    // is gone, so a file that cannot be removed (held open, say) keeps the record that names it as
    // Kolux's, and the next start does not refuse it as someone else's file with Kolux's entries.
    // hooks FIX-5 (stand-in review AFTER 1): only while the file still holds what Kolux wrote. A
    // save by the user or another tool while Codex was asked is kept, and the error says so; the
    // rewrite goes through the same atomic write as the install, so it never leaves half a file.
    // Nothing written (the entries were already in): nothing to put back.
    let wrote = if changed { Some(String::from_utf8(render(&hooks, text.as_deref())?).map_err(|e| e.to_string())?) } else { None };
    let restore = || -> Result<(), String> {
        let Some(wrote) = wrote.as_deref() else { return Ok(()) };
        match &text {
            Some(t) => write_atomic(&file, t.as_bytes(), Some(wrote)),
            None => {
                // hooks FIX-6 (stand-in review AFTER 2): a file the user deleted in the window is
                // what the rollback wanted; only the record saying Kolux created it is left to drop.
                let now = match std::fs::read(&file) {
                    Ok(now) => Some(now),
                    Err(e) if e.kind() == std::io::ErrorKind::NotFound => None,
                    Err(e) => return Err(format!("{} could not be read back ({e}); its record stays, so the next start still knows it as Kolux's", file.display())),
                };
                if let Some(now) = now {
                    if now != wrote.as_bytes() {
                        return Err(format!("{} {CHANGED}", file.display()));
                    }
                    std::fs::remove_file(&file).map_err(|e| format!("{} could not be removed ({e}); its record stays, so the next start still knows it as Kolux's", file.display()))?;
                }
                let record = agent_hooks::codex_record(&file);
                if agent_hooks::was_created(&record, &file) {
                    let _ = std::fs::remove_file(record);
                }
                Ok(())
            }
        }
    };
    let listing = listing(home);
    let n = listing.as_deref().map(|l| apply_trust(&mut doc, l, &real)).unwrap_or(0);
    if n < CODEX_EVENTS.len() {
        let why = match listing {
            Some(_) => format!("Codex listed {n} of {} Kolux hooks in {}", CODEX_EVENTS.len(), file.display()),
            None => format!("Codex could not list the hooks of {}", home.display()),
        };
        return Err(match restore() {
            Ok(()) => format!("{why}; the file is back as it was"),
            Err(e) => format!("{why}; {e}"),
        });
    }
    if let Err(e) = crate::trust::write_whole(&config, &doc.to_string()) {
        // hooks FIX-5 (stand-in review AFTER 2): a rollback that fails too never hides the trust error.
        return Err(match restore() {
            Ok(()) => e,
            Err(r) => format!("{e}; {r}"),
        });
    }
    Ok(true)
}

/// The script and one Codex home's entries; problems go to stderr, never in the way of a pane.
pub fn install_codex_home(home: &Path) {
    match write_codex_script(&home_dir()) {
        Ok(path) => {
            // Codex runs the command through cmd.exe; the native separators are what was verified.
            let command = format!("\"{}\"", if cfg!(windows) { path.replace('/', "\\") } else { path });
            if let Err(e) = install_codex(home, &command) {
                eprintln!("kolux-rs: codex hooks: {e}");
            }
        }
        Err(e) => eprintln!("kolux-rs: codex hook script: {e}"),
    }
}

fn home_dir() -> PathBuf {
    std::env::var(if cfg!(windows) { "USERPROFILE" } else { "HOME" }).map(PathBuf::from).unwrap_or_else(|_| std::env::temp_dir())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ev(json: &str) -> Value {
        serde_json::from_str(json).unwrap()
    }

    #[test]
    fn the_session_id_rides_along_so_a_pane_can_be_resumed_later() {
        // SESS-030: both agents name their session in every event; a pane remembers the newest.
        let c = claude_change(&ev(r#"{"hook_event_name":"SessionStart","source":"resume","session_id":"11111111-aaaa"}"#)).unwrap();
        assert_eq!(c.session.as_deref(), Some("11111111-aaaa"));
        let x = codex_change(&ev(r#"{"hook_event_name":"Stop","session_id":"thr_22"}"#)).unwrap();
        assert_eq!(x.session.as_deref(), Some("thr_22"));
        assert_eq!(claude_change(&ev(r#"{"hook_event_name":"Stop"}"#)).unwrap().session, None);
        assert_eq!(claude_change(&ev(r#"{"hook_event_name":"Stop","session_id":""}"#)).unwrap().session, None);
    }

    #[test]
    fn every_change_names_its_session_when_the_event_does() {
        // TERM-036: Copy Session ID needs the agent's own session id, which every hook event carries.
        let stop = claude_change(&ev(r#"{"hook_event_name":"Stop","session_id":"0b3c-9f"}"#)).unwrap();
        assert_eq!(stop.session.as_deref(), Some("0b3c-9f"));
        assert_eq!(claude_change(&ev(r#"{"hook_event_name":"Stop"}"#)).unwrap().session, None);
        assert_eq!(claude_change(&ev(r#"{"hook_event_name":"Stop","session_id":"  "}"#)).unwrap().session, None);
        let codex = codex_change(&ev(r#"{"hook_event_name":"SessionStart","session_id":"019a-c"}"#)).unwrap();
        assert_eq!(codex.session.as_deref(), Some("019a-c"));
        assert!(serde_json::to_string(&stop).unwrap().contains(r#""session":"0b3c-9f""#));
    }

    #[test]
    fn a_start_or_resume_is_a_fresh_boundary_a_clear_is_not() {
        // USAGE-001 (marks FIX-2): a start or a resume is a new agent process, whose running time
        // may start over on the same clock, so the window forgets the reading without a floor; a
        // clear keeps the process, so its floor stays.
        let c = |j: &str| claude_change(&ev(j)).unwrap();
        let from = |source: &str| c(&format!(r#"{{"hook_event_name":"SessionStart","source":"{source}"}}"#));
        let flags = |source: &str| {
            let ch = from(source);
            (ch.boundary, ch.fresh)
        };
        assert_eq!(flags("startup"), (true, true));
        assert_eq!(flags("resume"), (true, true));
        assert_eq!(flags("clear"), (true, false));
        let manual = c(r#"{"hook_event_name":"PostCompact","trigger":"manual"}"#);
        assert_eq!((manual.boundary, manual.fresh), (true, false));
        assert!(!serde_json::to_value(from("clear")).unwrap().as_object().unwrap().contains_key("fresh"));
        assert_eq!(serde_json::to_value(from("resume")).unwrap()["fresh"], true);
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
        // SAFE-001: the exit-plan step carries the whole plan on both events; nothing else does.
        let plan = "# Plan\n\n1. Read it";
        let pre = c(&format!(r#"{{"hook_event_name":"PreToolUse","tool_name":"ExitPlanMode","tool_input":{{"plan":{}}}}}"#, json!(plan))).unwrap();
        let ask = c(&format!(r#"{{"hook_event_name":"PermissionRequest","tool_name":"ExitPlanMode","tool_input":{{"plan":{}}}}}"#, json!(plan))).unwrap();
        assert_eq!((pre.plan.as_deref(), ask.plan.as_deref()), (Some(plan), Some(plan)));
        assert_eq!(c(r#"{"hook_event_name":"PermissionRequest","tool_name":"Bash","tool_input":{"command":"ls","plan":"x"}}"#).unwrap().plan, None);
        assert_eq!(c(r#"{"hook_event_name":"PermissionRequest","tool_name":"ExitPlanMode","tool_input":{"plan":"  "}}"#).unwrap().plan, None);
        let perm = c(r#"{"hook_event_name":"PermissionRequest","tool_name":"Write","tool_input":{"file_path":"C:/x/hello.txt","content":"hi"}}"#).unwrap();
        assert_eq!((perm.state, perm.tool.as_deref(), perm.detail.as_deref()), ("permission", Some("Write"), Some("C:/x/hello.txt")));
        assert_eq!(c(r#"{"hook_event_name":"PostToolUse","tool_name":"Write"}"#).unwrap().state, "working");
        let w = c(r#"{"hook_event_name":"PostToolUse","tool_name":"Edit","tool_input":{"file_path":"C:/x/b.ts","old_string":"a"}}"#).unwrap();
        assert_eq!((w.state, w.wrote.as_deref()), ("working", Some("C:/x/b.ts")));
        assert_eq!(c(r#"{"hook_event_name":"PostToolUse","tool_name":"Bash","tool_input":{"file_path":"C:/x/b.ts"}}"#).unwrap().wrote, None);
        assert_eq!(c(r#"{"hook_event_name":"PostToolUseFailure","tool_name":"Write"}"#).unwrap().state, "working");
        assert_eq!(c(r#"{"hook_event_name":"Stop"}"#).unwrap().state, "done");
        // STAT-022: the failure's error names the cause; details ride along; no error, no stop.
        let b = c(r#"{"hook_event_name":"StopFailure","error":"rate_limit","error_details":"resets at 3pm"}"#).unwrap();
        assert_eq!((b.state, b.cause, b.detail.as_deref()), ("blocked", Some("limit"), Some("resets at 3pm")));
        for e in ["authentication_failed", "oauth_org_not_allowed", "verification_required"] {
            assert_eq!(c(&format!(r#"{{"hook_event_name":"StopFailure","error":"{e}"}}"#)).unwrap().cause, Some("signin"), "{e}");
        }
        for e in ["overloaded", "server_error", "billing_error", "something_new"] {
            assert_eq!(c(&format!(r#"{{"hook_event_name":"StopFailure","error":"{e}"}}"#)).unwrap().cause, Some("error"), "{e}");
        }
        assert!(c(r#"{"hook_event_name":"StopFailure"}"#).is_none(), "a failure report with no error attached is not a stop");
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
    fn codex_events_map_to_pane_states() {
        let c = |j: &str| codex_change(&ev(j));
        let start = c(r#"{"hook_event_name":"SessionStart","source":"startup"}"#).unwrap();
        assert_eq!((start.state, start.boundary), ("working", true));
        let p = c(r#"{"hook_event_name":"UserPromptSubmit","prompt":" run the\n tests "}"#).unwrap();
        assert_eq!((p.state, p.prompt.as_deref()), ("working", Some("run the tests")));
        let run = c(r#"{"hook_event_name":"PreToolUse","tool_name":"exec_command","tool_input":{"cmd":"cargo test","workdir":"."}}"#).unwrap();
        assert_eq!((run.state, run.tool.as_deref(), run.detail.as_deref()), ("working", Some("exec_command"), Some("cargo test")));
        let ask = c(r#"{"hook_event_name":"PreToolUse","tool_name":"request_user_input","tool_input":{"questions":[{"question":"Which one?"}]}}"#).unwrap();
        assert_eq!((ask.state, ask.tool.as_deref()), ("waiting", Some("request_user_input")));
        let perm = c(r#"{"hook_event_name":"PermissionRequest","tool_name":"exec_command","tool_input":{"cmd":"rm -rf dist"}}"#).unwrap();
        assert_eq!((perm.state, perm.detail.as_deref()), ("permission", Some("rm -rf dist")));
        assert_eq!(c(r#"{"hook_event_name":"PostToolUse","tool_name":"exec_command"}"#).unwrap().state, "working");
        assert_eq!(c(r#"{"hook_event_name":"Stop","last_assistant_message":"done"}"#).unwrap().state, "done");
        // A sub-agent's events and the roster events never move the lead's own state.
        assert!(c(r#"{"hook_event_name":"Stop","agent_id":"a1"}"#).is_none());
        assert!(c(r#"{"hook_event_name":"SubagentStart","agent_id":""}"#).is_none());
        assert!(c(r#"{"hook_event_name":"SubagentStop"}"#).is_none());
        assert!(codex_script().contains("%KP%/codex\" >NUL") && !codex_script().contains("/claude"));
    }

    /// SAFE-009: a protected shell command makes the hook answer Claude's PreToolUse with an ask;
    /// everything else, a garbled body included, gets the neutral `{}` so Claude carries on.
    #[test]
    fn safe009_a_protected_command_asks_and_everything_else_is_neutral() {
        let s = json!({});
        let pre = |tool: &str, cmd: &str| format!(r#"{{"hook_event_name":"PreToolUse","tool_name":"{tool}","tool_input":{{"command":"{cmd}"}}}}"#);
        let ask = reply_body("/claude", pre("Bash", "git push --force origin main").as_bytes(), &s);
        let v: Value = serde_json::from_str(&ask).unwrap();
        let out = &v["hookSpecificOutput"];
        assert_eq!((out["hookEventName"].as_str(), out["permissionDecision"].as_str()), (Some("PreToolUse"), Some("ask")));
        assert!(out["permissionDecisionReason"].as_str().unwrap().contains("Force-push to main"));
        assert_ne!(reply_body("/claude", pre("PowerShell", "git reset --hard").as_bytes(), &s), "{}", "PowerShell is read too");
        assert_eq!(reply_body("/claude", pre("Bash", "git status").as_bytes(), &s), "{}");
        assert_eq!(reply_body("/claude", pre("Write", "git push -f").as_bytes(), &s), "{}", "only shells are inspected");
        assert_eq!(reply_body("/claude", br#"{"hook_event_name":"PostToolUse","tool_name":"Bash","tool_input":{"command":"git push -f"}}"#, &s), "{}");
        assert_eq!(reply_body("/claude", b"not json {", &s), "{}", "a garbled body fails open");
        assert_eq!(reply_body("/codex", pre("Bash", "git push -f").as_bytes(), &s), "{}", "Codex is not guarded");
        let body = br#"{"hook_event_name":"PreToolUse","tool_name":"Bash","cwd":"/home/me/app","tool_input":{"command":"rm -rf .git"}}"#;
        assert!(reply_body("/claude", body, &json!({})).contains("Deleting folders outside the workspace"), "SAFE-013 through the hook, judged against cwd");
        let off = json!({ "protectedOff": ["force-push"] });
        assert_eq!(reply_body("/claude", pre("Bash", "git push -f").as_bytes(), &off), "{}", "a switched-off rule asks no more");
        // The Claude script prints the answer for Claude to read; Codex's still discards it.
        assert!(claude_script().contains("%KP%/claude\" 2>NUL") && !claude_script().contains("-o NUL"));
        assert!(codex_script().contains("-o NUL"));
    }

    #[test]
    fn codex_hooks_go_last_and_are_replaced_in_place() {
        let mut file = ev(r#"{"description":"mine","hooks":{
            "PreToolUse":[{"matcher":"exec_command","hooks":[{"type":"command","command":"lint.cmd"}]}],
            "Stop":[{"hooks":[{"type":"command","command":"\"C:\\Users\\t\\.kolux-rs\\agent-hooks\\codex.cmd\"","timeout":3}]},{"hooks":[{"type":"command","command":"notify.cmd"}]}]}}"#);
        let cmd = r#""C:\Users\t\.kolux-rs\agent-hooks\codex.cmd""#;
        assert!(install_codex_hooks(&mut file, cmd));
        assert!(!install_codex_hooks(&mut file, cmd), "a second install changes nothing");
        let hooks = file["hooks"].as_object().unwrap();
        assert_eq!(hooks.len(), 8);
        let pre = hooks["PreToolUse"].as_array().unwrap();
        assert_eq!(pre[0]["matcher"], "exec_command", "the user's group stays first");
        assert_eq!(pre[1], json!({ "hooks": [{ "type": "command", "command": cmd, "timeout": 10 }] }));
        let stop = hooks["Stop"].as_array().unwrap();
        assert_eq!((stop.len(), stop[0]["hooks"][0]["timeout"].as_u64(), stop[1]["hooks"][0]["command"].as_str()), (2, Some(10), Some("notify.cmd")));
        assert_eq!(file["description"], "mine");
        assert_eq!(snake("UserPromptSubmit"), "user_prompt_submit");
    }

    #[test]
    fn trust_entries_come_from_codex_listing() {
        let file = r"C:\Users\t\.codex\hooks.json";
        let mine = r#""C:\Users\t\.kolux-rs\agent-hooks\codex.cmd""#;
        let listing = vec![
            json!({ "key": format!("{file}:stop:1:0"), "eventName": "stop", "command": mine, "currentHash": "sha256:aa", "trustStatus": "untrusted", "sourcePath": file }),
            json!({ "key": format!("{file}:stop:0:0"), "eventName": "stop", "command": "notify.cmd", "currentHash": "sha256:bb", "trustStatus": "untrusted", "sourcePath": file }),
            json!({ "key": "ponytail@ponytail:hooks/x.json:stop:0:0", "eventName": "stop", "command": mine, "currentHash": "sha256:cc", "trustStatus": "untrusted", "sourcePath": r"C:\Users\t\.codex\.tmp\x.json" }),
            json!({ "key": format!("{file}:session_start:0:0"), "eventName": "sessionStart", "command": mine, "currentHash": "sha256:dd", "trustStatus": "trusted", "sourcePath": "c:/users/t/.codex/hooks.json" }),
        ];
        let mut doc: toml_edit::DocumentMut = "model = \"gpt-5\"\n\n[projects.\"G:\\\\x\"]\ntrust_level = \"trusted\"\n".parse().unwrap();
        assert_eq!(apply_trust(&mut doc, &listing, file), 2);
        let text = doc.to_string();
        assert!(text.starts_with("model = \"gpt-5\"\n"), "{text}");
        assert!(text.contains("[hooks.state.") && text.contains(":stop:1:0"), "{text}");
        assert!(!text.contains("sha256:bb") && !text.contains("sha256:cc"), "another tool's hooks and another file's entries stay as they are: {text}");
        assert!(!text.contains("[hooks]\n") && !text.contains("[hooks.state]\n"), "no empty headers: {text}");
        let again: toml_edit::DocumentMut = text.parse().unwrap();
        assert_eq!(again["projects"]["G:\\x"]["trust_level"].as_str(), Some("trusted"));
        let state = &again["hooks"]["state"];
        assert_eq!(state[format!("{file}:stop:1:0").as_str()]["trusted_hash"].as_str(), Some("sha256:aa"));
        assert_eq!(state[format!("{file}:session_start:0:0").as_str()]["trusted_hash"].as_str(), Some("sha256:dd"));
    }

    #[test]
    fn brow051_the_endpoint_answers_only_kolux_tools_never_a_web_page_or_another_host() {
        let id = base64::engine::general_purpose::STANDARD.encode(r#"{"paneKey":7,"terminal":3,"hookVersion":1}"#);
        let req = |extra: &str| {
            let raw = format!("POST /claude HTTP/1.1\r\nHost: 127.0.0.1:4321\r\nX-Kolux-Token: tok\r\nX-Kolux-Pane: {id}\r\n{extra}Content-Length: 2\r\n\r\n{{}}");
            parse_request(&mut raw.as_bytes()).unwrap()
        };
        // Kolux's own hook script: curl with the token, no web headers.
        assert_eq!(gate(&req(""), "tok"), None);
        // Anything a web page sends carries an Origin or a Sec-Fetch header; a page's GET through
        // an <img> or <script> tag carries no Origin but still the Sec-Fetch ones.
        assert_eq!(gate(&req("Origin: http://127.0.0.1:1424\r\n"), "tok"), Some(404));
        assert_eq!(gate(&req("Sec-Fetch-Mode: no-cors\r\nSec-Fetch-Site: cross-site\r\n"), "tok"), Some(404));
        assert_eq!(gate(&req("Referer: http://127.0.0.1:1424/\r\n"), "tok"), Some(404));
        // A Host naming anything but this computer: DNS rebinding points a name at 127.0.0.1.
        let mut rebound = req("");
        rebound.headers.insert("host".into(), "evil.example:4321".into());
        assert_eq!(gate(&rebound, "tok"), Some(404));
        for ok in ["localhost", "localhost:4321", "127.0.0.1", "[::1]:4321", "[::1]"] {
            rebound.headers.insert("host".into(), ok.into());
            assert_eq!(gate(&rebound, "tok"), None, "{ok}");
        }
        // The bare endpoint, a wrong token or no token: refused the same way, nothing described.
        let mut bare = req("");
        bare.headers.remove(TOKEN_HEADER);
        assert_eq!(gate(&bare, "tok"), Some(404));
        assert_eq!(gate(&req(""), "other"), Some(404));
        let plain = parse_request(&mut "GET / HTTP/1.1\r\nHost: 127.0.0.1:4321\r\n\r\n".as_bytes()).unwrap();
        assert_eq!(gate(&plain, "tok"), Some(404));
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
        let st = status_command("C:/u/.kolux-rs/agent-hooks/claude-status.cmd", "C:/u/.kolux-rs/agent-hooks/claude-status-prev.sh");
        assert_eq!(install_claude(&file, x, &st).unwrap(), (true, None));
        let v: Value = serde_json::from_str(&std::fs::read_to_string(&file).unwrap()).unwrap();
        assert_eq!(v["hooks"]["Stop"][0]["hooks"][0]["command"], x);
        assert_eq!(v["statusLine"]["command"], st, "STAT-040: the status line is installed beside the hooks");
        std::fs::write(&file, "{\n    \"env\": {\n        \"A\": \"1\"\n    }\n}\n").unwrap();
        assert!(install_claude(&file, x, &st).unwrap().0);
        let text = std::fs::read_to_string(&file).unwrap();
        assert!(text.starts_with("{\n    \"env\": {\n        \"A\": \"1\"\n    },\n    \"hooks\""), "{text}");
        assert!(!install_claude(&file, x, &st).unwrap().0);
        std::fs::write(&file, "not json").unwrap();
        assert!(install_claude(&file, x, &st).is_err());
        assert_eq!(std::fs::read_to_string(&file).unwrap(), "not json", "an unreadable file is left alone");
        let script = write_claude_script(&dir).unwrap();
        assert!(script.ends_with(".kolux-rs/agent-hooks/claude.cmd") && !script.contains('\\'));
        let body = std::fs::read_to_string(&script).unwrap();
        assert!(body.starts_with("@echo off\r\n") && body.contains("curl.exe -s -m 1.5") && body.ends_with("exit /b 0\r\n"));
        let status = write_status_script(&dir).unwrap();
        assert!(status.ends_with(".kolux-rs/agent-hooks/claude-status.cmd"));
        let text = std::fs::read_to_string(&status).unwrap();
        assert!(text.contains("%KP%/claude-status\"") && text.contains("set \"KC=%CLAUDE_CONFIG_DIR%\"") && text.contains("-H \"X-Kolux-Config: %KC%\""), "{text}");
        assert!(!text.contains(agent_hooks::saved::SPOOL_FILE), "a status-line reading is never held for later");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn the_status_line_takes_the_slot_and_chains_the_one_it_displaced() {
        // STAT-040: Kolux's command keeps stdin in a file, posts it, then feeds the user's own
        // status line from the same file; the displaced command is handed back for that file.
        let st = status_command("C:/u/.kolux-rs/agent-hooks/claude-status.cmd", "C:/u/.kolux-rs/agent-hooks/claude-status-prev.sh");
        assert!(st.contains("cat >\"$k\"") && st.contains("\"C:/u/.kolux-rs/agent-hooks/claude-status.cmd\" <\"$k\"") && st.contains("sh \"C:/u/.kolux-rs/agent-hooks/claude-status-prev.sh\" <\"$k\""), "{st}");
        let mut s = ev(r#"{"statusLine":{"type":"command","command":"node ~/line.js","padding":0}}"#);
        assert_eq!(install_claude_status(&mut s, &st), (true, Some("node ~/line.js".into())));
        assert_eq!(s["statusLine"], json!({ "type": "command", "command": st, "padding": 0 }), "padding and the rest stay");
        assert_eq!(install_claude_status(&mut s, &st), (false, None), "a second install changes nothing");
        // A stale Kolux RS command (another home) is replaced and not chained; an empty slot is filled.
        let mut stale = ev(r#"{"statusLine":{"type":"command","command":"k=1; \"C:/old/.kolux-rs/agent-hooks/claude-status.cmd\""}}"#);
        assert_eq!(install_claude_status(&mut stale, &st), (true, None));
        let mut none = ev(r#"{"env":{}}"#);
        assert_eq!(install_claude_status(&mut none, &st), (true, None));
        assert_eq!(none["statusLine"]["type"], "command");
        assert_eq!(none["env"], json!({}));
    }

    #[test]
    fn a_status_line_report_carries_the_sessions_cost() {
        // USAGE-034: the status line's cost.total_cost_usd is the session's total so far, in US dollars.
        let u = |body: &str| {
            let id = base64::engine::general_purpose::STANDARD.encode(r#"{"paneKey":4,"terminal":2,"hookVersion":1}"#);
            let raw = format!("POST /claude-status HTTP/1.1\r\nX-Kolux-Token: tok\r\nX-Kolux-Pane: {id}\r\nContent-Length: {}\r\n\r\n{body}", body.len());
            usage(&parse_request(&mut raw.as_bytes()).unwrap(), "tok").unwrap()
        };
        assert_eq!(u(r#"{"cost":{"total_cost_usd":3.1475},"context_window":{"context_window_size":200000,"total_input_tokens":5000}}"#).cost_usd, Some(3.1475));
        assert_eq!(u(r#"{"cost":{"total_cost_usd":0}}"#).cost_usd, Some(0.0));
        // Missing, not a number, or a broken figure: no cost, so the window keeps its last one.
        assert_eq!(u(r#"{"context_window":{"context_window_size":200000}}"#).cost_usd, None);
        assert_eq!(u(r#"{"cost":{"total_cost_usd":"3.15"}}"#).cost_usd, None);
        assert_eq!(u(r#"{"cost":{"total_cost_usd":-1.5}}"#).cost_usd, None);
        // It rides in the event the window listens to, under the name the window reads.
        let v = json!(u(r#"{"cost":{"total_cost_usd":2.5}}"#));
        assert_eq!(v["costUsd"], json!(2.5));
        assert!(json!(u(r#"{}"#))["costUsd"].is_null());
    }

    #[test]
    fn a_status_line_report_carries_its_clock() {
        // USAGE-001 (marks FIX-1): the report's clock is its session id with the terminal that ran
        // it, and `at` is the session's running time. A resume in a new terminal keeps the session
        // id but starts the running time over, so it must read as a new clock, never as a late
        // report of the old one (stand-in review of lane/marks ee2bfbc, FIX-SOON 5).
        let id = |j: &str| base64::engine::general_purpose::STANDARD.encode(j);
        let post = |pane: &str, body: &str| {
            let raw = format!("POST /claude-status HTTP/1.1\r\nX-Kolux-Token: tok\r\nX-Kolux-Pane: {pane}\r\nContent-Length: {}\r\n\r\n{body}", body.len());
            usage(&parse_request(&mut raw.as_bytes()).unwrap(), "tok").unwrap()
        };
        let t2 = id(r#"{"paneKey":4,"terminal":2,"hookVersion":1}"#);
        let t5 = id(r#"{"paneKey":4,"terminal":5,"hookVersion":1}"#);
        let body = r#"{"session_id":"0b3c-9f","cost":{"total_duration_ms":61000},"context_window":{"context_window_size":200000,"total_input_tokens":5000}}"#;
        let u = post(&t2, body);
        assert_eq!((u.session.as_deref(), u.at), (Some("0b3c-9f@2"), Some(61_000)));
        let resumed = post(&t5, r#"{"session_id":"0b3c-9f","cost":{"total_duration_ms":900}}"#);
        assert_eq!((resumed.session.as_deref(), resumed.at), (Some("0b3c-9f@5"), Some(900)));
        assert_ne!(resumed.session, u.session, "the resumed process is a new clock");
        // No terminal in the identity, or no usable session id: no clock, so arrival order rules.
        let bare = post(&id(r#"{"paneKey":4,"hookVersion":1}"#), body);
        assert_eq!((bare.session, bare.at), (None, None));
        let blank = post(&t2, r#"{"session_id":"  ","cost":{"total_duration_ms":5}}"#);
        assert_eq!((blank.session, blank.at), (None, None));
        // An over-long session id is cut at 200 characters plus the ellipsis `trim` adds, and the
        // terminal still follows (stand-in review of lane/marks 54b27f5e, AFTER 2).
        let long = "x".repeat(250);
        let cut = post(&t2, &format!(r#"{{"session_id":"{long}","cost":{{"total_duration_ms":7}}}}"#));
        let want = format!("{}…@2", "x".repeat(200));
        assert_eq!((cut.session.as_deref(), cut.at), (Some(want.as_str()), Some(7)));
        // Exactly 200 is kept whole.
        let kept = post(&t2, &format!(r#"{{"session_id":"{}","cost":{{"total_duration_ms":8}}}}"#, "y".repeat(200)));
        assert_eq!(kept.session, Some(format!("{}@2", "y".repeat(200))));
        // The names the window's listener reads.
        let j = serde_json::to_value(&u).unwrap();
        assert_eq!((j["session"].as_str(), j["at"].as_u64(), j["paneKey"].as_u64()), (Some("0b3c-9f@2"), Some(61_000), Some(4)));
    }

    #[test]
    fn a_status_line_report_is_checked_and_read() {
        // STAT-040: the token is checked; the figures come out as Kolux keeps them (ms resets);
        // a report with only the context size carries no limits.
        let id = base64::engine::general_purpose::STANDARD.encode(r#"{"paneKey":4,"terminal":2,"hookVersion":1}"#);
        let body = r#"{"model":{"id":"claude-fable-5-1"},"context_window":{"context_window_size":200000,"total_input_tokens":50000,"used_percentage":25},"rate_limits":[{"kind":"five_hour","percentUsed":40,"resetsAt":"2026-10-12T20:00:00Z"},{"kind":"seven_day","percentUsed":100.0,"resetsAt":"2026-10-12T20:00:00.5+02:00"},{"kind":"odd"}]}"#;
        let raw = format!("POST /claude-status HTTP/1.1\r\nX-Kolux-Token: tok\r\nX-Kolux-Pane: {id}\r\nContent-Length: {}\r\n\r\n{body}", body.len());
        let req = parse_request(&mut raw.as_bytes()).unwrap();
        let u = usage(&req, "tok").unwrap();
        assert_eq!((u.pane_key, u.context_tokens, u.context_window), (4, Some(50_000), Some(200_000)));
        assert_eq!(u.limits, vec![
            Limit { kind: "five_hour".into(), used_percent: 40.0, resets_at: Some(1_791_835_200_000) },
            Limit { kind: "seven_day".into(), used_percent: 100.0, resets_at: Some(1_791_828_000_500) },
        ]);
        assert_eq!(exhausted(&u.limits), Some(1_791_828_000_500));
        assert_eq!(u.config_dir, None, "no config header: the computer's default sign-in");
        assert_eq!(usage(&req, "other"), Err(403));
        // USAGE-021: the report names the config folder its session runs under; a report from a
        // different folder than the active account's is dropped, a one-window update keeps the
        // other window as it was.
        let raw = format!("POST /claude-status HTTP/1.1\r\nX-Kolux-Token: tok\r\nX-Kolux-Pane: {id}\r\nX-Kolux-Config: C:\\u\\.kolux-rs\\claude-accounts\\a\\\r\nContent-Length: {}\r\n\r\n{body}", body.len());
        let u = usage(&parse_request(&mut raw.as_bytes()).unwrap(), "tok").unwrap();
        assert_eq!(u.config_dir.as_deref(), Some("C:\\u\\.kolux-rs\\claude-accounts\\a\\"));
        assert!(same_folder(Some("c:/u/.kolux-rs/claude-accounts/a"), u.config_dir.as_deref()));
        assert!(same_folder(None, None));
        assert!(!same_folder(None, u.config_dir.as_deref()), "a managed-account report while the default sign-in is active");
        assert!(!same_folder(Some("C:/u/.kolux-rs/claude-accounts/b"), u.config_dir.as_deref()));
        let old = vec![Limit { kind: "five_hour".into(), used_percent: 10.0, resets_at: None }, Limit { kind: "seven_day".into(), used_percent: 20.0, resets_at: Some(5) }];
        let merged = merge_limits(old.clone(), &[Limit { kind: "five_hour".into(), used_percent: 50.0, resets_at: Some(9) }]);
        assert_eq!(merged, vec![Limit { kind: "five_hour".into(), used_percent: 50.0, resets_at: Some(9) }, old[1].clone()]);
        assert_eq!(merge_limits(vec![], &old), old);
        assert_eq!(merge_limits(old.clone(), &[]), old);
        let only = format!("POST /claude-status HTTP/1.1\r\nX-Kolux-Token: tok\r\nX-Kolux-Pane: {id}\r\nContent-Length: 76\r\n\r\n{{\"context_window\":{{\"context_window_size\":200000,\"total_input_tokens\":30000}}}}");
        let u = usage(&parse_request(&mut only.as_bytes()).unwrap(), "tok").unwrap();
        assert_eq!((u.context_tokens, u.context_window, u.limits.len()), (Some(30_000), Some(200_000), 0));
        // USAGE-005: tokens are the stated total, else input plus cache writes plus cache reads,
        // else the stated percentage applied to the window.
        let read = |body: &str| {
            let raw = format!("POST /claude-status HTTP/1.1\r\nX-Kolux-Token: tok\r\nX-Kolux-Pane: {id}\r\nContent-Length: {}\r\n\r\n{body}", body.len());
            usage(&parse_request(&mut raw.as_bytes()).unwrap(), "tok").unwrap()
        };
        let u = read(r#"{"context_window":{"context_window_size":1000000,"current_usage":{"input_tokens":1000,"cache_creation_input_tokens":20000,"cache_read_input_tokens":79000}}}"#);
        assert_eq!((u.context_tokens, u.context_window), (Some(100_000), Some(1_000_000)));
        let u = read(r#"{"context_window":{"context_window_size":200000,"used_percentage":42}}"#);
        assert_eq!((u.context_tokens, u.context_window), (Some(84_000), Some(200_000)));
        let u = read(r#"{"context_window":{"used_percentage":42}}"#);
        assert_eq!((u.context_tokens, u.context_window), (None, None), "a percentage with no window is no reading");
        assert_eq!(when_ms(&json!(1_700_000_000)), Some(1_700_000_000_000), "seconds become ms");
        assert_eq!(when_ms(&json!(1_700_000_000_000i64)), Some(1_700_000_000_000));
        assert_eq!(when_ms(&json!("2000-02-29T00:00:00Z")), Some(951_782_400_000));
        assert_eq!(when_ms(&json!("soon")), None);
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
