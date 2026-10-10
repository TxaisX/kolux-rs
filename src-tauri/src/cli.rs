//! The command line (PROJ-077, with the CLI-004 envelope and CLI-005 exit codes as its
//! foundation). The running app listens on a loopback port and writes the port and a token to
//! `cli.json` in its data folder; the `kolux-dev` program sends one JSON request per call and
//! prints the reply as text, or as the JSON envelope with `--json`. Exit status: 0 worked, 1
//! any error.

use crate::git::{Git, Worktree};
use crate::projects::{self, Project};
use crate::state::Store;
use crate::terminal::Terminals;
use serde_json::{json, Map, Value};
use std::io::{BufRead, BufReader, Write};
use std::net::{TcpListener, TcpStream};
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{Duration, Instant};

/// Where the app says how to reach it, inside its data folder.
pub const FILE: &str = "cli.json";
/// The event the front end gets when the CLI made or removed a workspace.
pub const EVENT: &str = "cli-workspace";
const DATA_DIR: &str = "com.txaisxiong.kolux-rs";
/// The environment value that tells the CLI which running app opened its terminal (CLI-007).
pub const APP_DIR_ENV: &str = "KOLUX_APP_DIR";

#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub struct Request {
    pub id: String,
    pub token: String,
    pub command: String,
    /// The folder the command was run in: the default repo and the meaning of `current`.
    pub cwd: String,
    pub args: Value,
    /// CLI-007: the Kolux terminal the call came from, read from its environment; the app checks
    /// the key against the one it gave that terminal (ORCH-001).
    #[serde(default)]
    pub pane: Option<Pane>,
}

#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub struct Pane {
    pub handle: String,
    pub key: String,
}

/// A refused or failed command: the error of the envelope (CLI-004).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Fail {
    pub code: &'static str,
    pub message: String,
    pub data: Value,
}

impl Fail {
    pub fn new(code: &'static str, message: impl Into<String>) -> Fail {
        Fail { code, message: message.into(), data: Value::Null }
    }
    fn args(message: impl Into<String>) -> Fail {
        Fail::new("invalid_arguments", message)
    }
}

impl From<String> for Fail {
    fn from(message: String) -> Fail {
        Fail::new("failed", message)
    }
}

/// The one object `--json` prints (CLI-004): request id, success flag, result or error, and the
/// runtime that answered in its metadata.
pub fn envelope(id: &str, runtime: &str, out: Result<Value, Fail>) -> Value {
    match out {
        Ok(result) => json!({ "requestId": id, "success": true, "result": result, "meta": { "runtimeId": runtime } }),
        Err(f) => json!({ "requestId": id, "success": false, "error": { "code": f.code, "message": f.message, "data": f.data }, "meta": { "runtimeId": runtime } }),
    }
}

// ---------------------------------------------------------------- the command line

/// A parsed call: the command's wire name, its flags as JSON, and whether `--json` was asked.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Parsed {
    pub command: String,
    pub args: Map<String, Value>,
}

const HELP: &str = "kolux-dev: drive Kolux from a terminal\n\n  kolux-dev worktree create --name <name> [--repo <selector>] [--agent <id>] [--prompt <text>]\n      [--setup run|skip|inherit] [--base-branch <ref>] [--issue <number>] [--comment <text>]\n      [--parent-worktree <selector>] [--no-parent] [--run-hooks] [--activate] [--json]\n  kolux-dev worktree rm --worktree <selector> [--force] [--run-hooks] [--json]\n      (also: remove, delete)\n  kolux-dev orchestration worker-start (--task <id> | --spec <text>) (--agent <id> | --tier major|deep|build|light)\n      [--worktree current|<selector>|new-child|new-top-level] [--model <m>] [--effort <e>] [--name <n>]\n      [--repo <selector>] [--base-branch <ref>] [--display-name <d>] [--comment <c>] [--setup run|skip|inherit]\n      [--task-title <t>] [--deps <json list>] [--parent <task>] [--timeout-ms <ms>] [--json]\n  kolux-dev orchestration run-create --objective <text> [--from <handle>] [--retry-request <id>] [--json]\n  kolux-dev orchestration run-use --id <run> [--from <handle>] [--takeover-legacy] [--retry-request <id>] [--json]\n  kolux-dev orchestration run-current [--from <handle>] [--json]\n  kolux-dev orchestration run-list [--limit <n>] [--cursor <c>] [--json]\n  kolux-dev orchestration run-show --id <run> [--json]\n  kolux-dev orchestration send --subject <s> [--to run:<id>|dispatch:<id>|<handle>] [--body <text>] [--type <kind>]\n      [--priority normal|high|urgent] [--thread-id <t>] [--payload <json>] [--task-id <id>] [--dispatch-id <id>]\n      [--outcome succeeded|failed] [--files-modified <a,b>] [--report-path <p>] [--phase <p>] [--run <run>] [--from <handle>]\n      [--retry-request <id>] [--json]\n  kolux-dev orchestration check [--terminal <handle>] [--run <run>] [--ack <delivery>] [--unread|--peek|--all]\n      [--types <kind,...>] [--format] [--wait] [--timeout-ms <ms>] [--json]\n  kolux-dev orchestration reply --id <message> --body <text> [--run <run>] [--from <handle>] [--retry-request <id>] [--json]\n  kolux-dev orchestration inbox [--limit <n>] [--terminal <handle>] [--full] [--json]\n  kolux-dev orchestration task-create --spec <text> [--task-title <t>] [--display-name <n>] [--deps <json list>]\n      [--parent <task>] [--run <run>] [--from <handle>] [--retry-request <id>] [--json]\n  kolux-dev orchestration task-list [--status <state>] [--ready] [--brief] [--run <run>] [--json]\n  kolux-dev orchestration dispatch --task <id> --to <handle> [--inject] [--dry-run] [--return-preamble] [--run <run>] [--json]\n  kolux-dev orchestration dispatch-show --task <id> [--preamble] [--json]\n\nSelectors: --repo id:|name:|path:   --worktree current|id:|name:|branch:|path:\n--json prints one envelope on stdout; without it, errors go to stderr. Exit 0 worked, 1 any error.\n";

const SWITCHES: &[&str] = &["force", "activate", "run-hooks", "no-parent", "takeover-legacy", "unread", "peek", "all", "format", "wait", "full", "ready", "brief", "inject", "dry-run", "return-preamble", "preamble"];
/// ORCH-001..006, ORCH-010, ORCH-011, ORCH-013 / CLI-030..032, CLI-034: the mail and task commands
/// and their flags. `--dispatch-capability` is accepted and unused until the dispatch pass (ORCH-067, T-155).
const MAIL: &[(&str, &str, &[&str])] = &[
    ("orchestration run-create", "orchestration.run-create", &["objective", "from", "retry-request"]),
    ("orchestration run-use", "orchestration.run-use", &["id", "from", "takeover-legacy", "retry-request"]),
    ("orchestration run-current", "orchestration.run-current", &["from"]),
    ("orchestration run-list", "orchestration.run-list", &["limit", "cursor"]),
    ("orchestration run-show", "orchestration.run-show", &["id"]),
    ("orchestration send", SEND, &["to", "run", "from", "subject", "body", "type", "priority", "thread-id", "payload", "task-id", "dispatch-id", "dispatch-capability", "retry-request", "outcome", "files-modified", "report-path", "phase"]),
    ("orchestration check", CHECK, &["terminal", "run", "ack", "unread", "peek", "all", "types", "format", "wait", "timeout-ms", "retry-request"]),
    ("orchestration reply", "orchestration.reply", &["id", "body", "run", "from", "retry-request"]),
    ("orchestration inbox", "orchestration.inbox", &["limit", "terminal", "full"]),
    ("orchestration task-create", "orchestration.task-create", &["spec", "task-title", "display-name", "deps", "parent", "run", "from", "retry-request"]),
    ("orchestration task-list", "orchestration.task-list", &["status", "ready", "brief", "run", "from"]),
    ("orchestration dispatch", "orchestration.dispatch", &["task", "to", "from", "run", "inject", "dry-run", "return-preamble", "retry-request"]),
    ("orchestration dispatch-show", "orchestration.dispatch-show", &["task", "preamble", "from"]),
];
const SEND: &str = "orchestration.send";
const CHECK: &str = "orchestration.check";
/// How long `check --wait` waits when no timeout is given, and how often it says it is alive.
const WAIT_DEFAULT_MS: u64 = 300_000;
const KEEPALIVE_MS: u64 = 15_000;

/// `--retry-request` becomes `retryRequest`.
fn camel(k: &str) -> String {
    let mut out = String::new();
    let mut up = false;
    for c in k.chars() {
        if c == '-' {
            up = true;
        } else if up {
            out.extend(c.to_uppercase());
            up = false;
        } else {
            out.push(c);
        }
    }
    out
}
const CREATE_FLAGS: &[&str] = &["name", "repo", "agent", "prompt", "setup", "base-branch", "issue", "comment", "parent-worktree", "no-parent", "run-hooks", "activate"];
const RM_FLAGS: &[&str] = &["worktree", "force", "run-hooks"];
const WORKER_START: &str = "orchestration.worker-start";
const WORKER_FLAGS: &[&str] = &["task", "spec", "task-title", "deps", "parent", "worktree", "name", "repo", "base-branch", "display-name", "comment", "setup", "agent", "model", "effort", "terminal", "tier", "retry-of", "timeout-ms", "run", "from", "retry-request"];
const TIERS: &[&str] = &["major", "deep", "build", "light"];
const NEW_TOP: &str = "new-top-level";
const NEW_CHILD: &str = "new-child";

/// Parses the words after the program name. The `--json` flag is reported even when the rest is
/// refused, so the refusal can be printed in the asked-for shape. `Ok(None)` means help was
/// printed to stdout.
pub fn parse(words: &[String]) -> (bool, Result<Option<Parsed>, Fail>) {
    let mut json = false;
    let mut help = false;
    let mut path: Vec<String> = Vec::new();
    let mut flags: Map<String, Value> = Map::new();
    let mut i = 0;
    let inner = (|| {
        while i < words.len() {
            let w = &words[i];
            i += 1;
            if let Some(flag) = w.strip_prefix("--") {
                let (name, inline) = match flag.split_once('=') {
                    Some((n, v)) => (n.to_string(), Some(v.to_string())),
                    None => (flag.to_string(), None),
                };
                match name.as_str() {
                    "json" => json = true,
                    "help" => help = true,
                    _ => {
                        let value = if SWITCHES.contains(&name.as_str()) {
                            Value::Bool(true)
                        } else if let Some(v) = inline {
                            Value::String(v)
                        } else if i < words.len() && !words[i].starts_with("--") {
                            i += 1;
                            Value::String(words[i - 1].clone())
                        } else {
                            return Err(Fail::args(format!("--{name} needs a value")));
                        };
                        if let Some(old) = flags.get(&name) {
                            if *old != value {
                                return Err(Fail::args(format!("--{name} was given twice with different values")));
                            }
                        }
                        flags.insert(name, value);
                    }
                }
            } else if w == "-h" || (w == "help" && path.is_empty()) {
                help = true;
            } else {
                path.push(w.clone());
            }
        }
        if help || path.is_empty() {
            return Ok(None);
        }
        let joined = path.join(" ");
        let (command, allowed) = match joined.as_str() {
            "worktree create" => ("worktree.create", CREATE_FLAGS),
            "worktree rm" | "worktree remove" | "worktree delete" => ("worktree.rm", RM_FLAGS),
            "orchestration worker-start" => (WORKER_START, WORKER_FLAGS),
            other if MAIL.iter().any(|(w, _, _)| *w == other) => MAIL.iter().find(|(w, _, _)| *w == other).map(|(_, c, f)| (*c, *f)).expect("found above"),
            _ => return Err(Fail::args(format!("unknown command `{joined}`; run kolux-dev --help"))),
        };
        if let Some(k) = flags.keys().find(|k| !allowed.contains(&k.as_str())) {
            return Err(Fail::args(format!("unknown flag --{k} for {joined}")));
        }
        let text = |k: &str| flags.get(k).and_then(Value::as_str);
        let empty = |k: &str| text(k).is_some_and(|v| v.trim().is_empty());
        let mut args = Map::new();
        if command == "worktree.create" {
            if text("name").map(str::trim).unwrap_or_default().is_empty() {
                return Err(Fail::args("--name is required"));
            }
            if text("prompt").is_some() && text("agent").is_none() {
                return Err(Fail::args("a prompt needs --agent to name who gets it"));
            }
            for k in ["agent", "prompt", "setup"] {
                if empty(k) {
                    return Err(Fail::args(format!("--{k} cannot be empty")));
                }
            }
            let setup = text("setup").unwrap_or("inherit");
            if !["run", "skip", "inherit"].contains(&setup) {
                return Err(Fail::args("--setup takes run, skip or inherit"));
            }
            if flags.contains_key("run-hooks") && setup == "skip" {
                return Err(Fail::args("--run-hooks runs the setup scripts; it cannot go with --setup skip"));
            }
            if flags.contains_key("no-parent") && flags.contains_key("parent-worktree") {
                return Err(Fail::args("--no-parent and --parent-worktree disagree; pass one of them"));
            }
            for (k, v) in &flags {
                let key = match k.as_str() {
                    "base-branch" => "baseBranch",
                    "parent-worktree" => "parentWorktree",
                    "no-parent" => "noParent",
                    "run-hooks" => "runHooks",
                    other => other,
                };
                args.insert(key.to_string(), v.clone());
            }
            args.insert("setup".into(), Value::String(setup.into()));
            if flags.contains_key("run-hooks") {
                args.insert("activate".into(), Value::Bool(true));
            }
        } else if command == WORKER_START {
            check_worker_start(&flags)?;
            for (k, v) in &flags {
                let key = match k.as_str() {
                    "task-title" => "taskTitle",
                    "base-branch" => "baseBranch",
                    "display-name" => "displayName",
                    "retry-of" => "retryOf",
                    "timeout-ms" => "timeoutMs",
                    "retry-request" => "retryRequest",
                    other => other,
                };
                args.insert(key.to_string(), v.clone());
            }
            args.entry("setup").or_insert_with(|| Value::String("inherit".into()));
            args.entry("worktree").or_insert_with(|| Value::String(NEW_TOP.into()));
        } else if command.starts_with("orchestration.") {
            for (k, v) in &flags {
                if v.as_str().is_some_and(|s| s.trim().is_empty()) && !["body", "from"].contains(&k.as_str()) {
                    return Err(Fail::args(format!("--{k} cannot be empty")));
                }
                args.insert(camel(k), v.clone());
            }
            let need = |k: &str, what: &str| if text(k).is_none() { Err(Fail::args(format!("--{k} is required{what}"))) } else { Ok(()) };
            match command {
                "orchestration.run-create" => need("objective", ": say what the Run is for")?,
                "orchestration.run-use" | "orchestration.run-show" => need("id", "")?,
                SEND => {
                    need("subject", "")?;
                    // CLI-031: refused here, before the sender is worked out.
                    let kind = text("type").map(str::trim).unwrap_or("status");
                    if ["worker_done", "heartbeat"].contains(&kind) && text("to").is_some_and(|t| t.trim().starts_with('@')) {
                        return Err(Fail::args("done reports and heartbeats go to exactly one dispatch, never to a group; send them to run:<id> or dispatch:<id>"));
                    }
                    if text("payload").is_some() {
                        if let Some(k) = ["task-id", "dispatch-id", "files-modified", "report-path", "phase"].into_iter().find(|k| flags.contains_key(*k)) {
                            return Err(Fail::args(format!("give the payload as flags (--{k}) or as --payload JSON, not both")));
                        }
                    }
                }
                "orchestration.reply" => {
                    need("id", "")?;
                    need("body", "")?
                }
                "orchestration.task-create" => need("spec", ": say what the task is")?,
                "orchestration.dispatch" => {
                    need("task", "")?;
                    need("to", ": name the agent terminal, like term-3")?
                }
                "orchestration.dispatch-show" => need("task", "")?,
                _ => {}
            }
            if ["unread", "peek", "all"].iter().filter(|k| flags.contains_key(**k)).count() > 1 {
                return Err(Fail::args("give one of --unread, --peek or --all"));
            }
            for k in ["limit", "timeout-ms"] {
                if text(k).is_some_and(|v| v.parse::<u64>().map(|n| n == 0).unwrap_or(true)) {
                    return Err(Fail::args(format!("--{k} takes a number above zero")));
                }
            }
        } else {
            if text("worktree").map(str::trim).unwrap_or_default().is_empty() {
                return Err(Fail::args("--worktree is required"));
            }
            for (k, v) in &flags {
                args.insert(if k == "run-hooks" { "runHooks".to_string() } else { k.clone() }, v.clone());
            }
        }
        Ok(Some(Parsed { command: command.to_string(), args }))
    })();
    (json, inner)
}


/// ORCH-016 / ORCH-018 / ORCH-019 / CLI-035: what a worker start must and must not combine,
/// checked before the app is asked so nothing is half made.
fn check_worker_start(flags: &Map<String, Value>) -> Result<(), Fail> {
    let text = |k: &str| flags.get(k).and_then(Value::as_str).map(str::trim).filter(|v| !v.is_empty());
    for k in ["task", "spec", "agent", "model", "effort", "terminal", "tier", "name", "worktree", "setup", "timeout-ms"] {
        if flags.contains_key(k) && text(k).is_none() {
            return Err(Fail::args(format!("--{k} cannot be empty")));
        }
    }
    match (text("task"), text("spec")) {
        (None, None) => return Err(Fail::args("give --task <id> for an existing task or --spec <text> for a new one")),
        (Some(_), Some(_)) => return Err(Fail::args("give one of --task or --spec, not both")),
        _ => {}
    }
    let (agent, terminal, tier) = (text("agent"), text("terminal"), text("tier"));
    if agent.is_none() && terminal.is_none() && tier.is_none() {
        return Err(Fail::args("say who runs it: --agent <id>, --tier major|deep|build|light, or --terminal <handle>"));
    }
    if let Some(t) = tier {
        if !TIERS.contains(&t) {
            return Err(Fail::args("--tier takes major, deep, build or light"));
        }
        if text("model").is_some() || text("effort").is_some() {
            return Err(Fail::args("a tier picks the model and effort; drop --model and --effort, or drop the tier"));
        }
    }
    if text("effort").is_some() && text("model").is_none() {
        return Err(Fail::args("--effort needs --model"));
    }
    if terminal.is_some() && (text("model").is_some() || text("effort").is_some() || tier.is_some()) {
        return Err(Fail::args("a reused terminal keeps its own model: --terminal cannot go with --model, --effort or --tier"));
    }
    let placement = text("worktree").unwrap_or(NEW_TOP);
    if placement != NEW_TOP && placement != NEW_CHILD {
        for k in ["name", "repo", "base-branch", "display-name", "comment"] {
            if flags.contains_key(k) {
                return Err(Fail::args(format!("--{k} shapes a new worktree; it cannot go with --worktree {placement}")));
            }
        }
    }
    if !["run", "skip", "inherit"].contains(&text("setup").unwrap_or("inherit")) {
        return Err(Fail::args("--setup takes run, skip or inherit"));
    }
    if let Some(ms) = text("timeout-ms") {
        if ms.parse::<u64>().map(|n| n == 0).unwrap_or(true) {
            return Err(Fail::args("--timeout-ms takes a number of milliseconds above zero"));
        }
    }
    if text("retry-of").is_some() && text("task").is_none() {
        return Err(Fail::args("--retry-of needs --task"));
    }
    if let Some(d) = text("deps") {
        if serde_json::from_str::<Vec<String>>(d).is_err() {
            return Err(Fail::args("--deps takes a JSON list of task ids, like [\"task-1\"]"));
        }
    }
    Ok(())
}

/// CLI-007: a terminal Kolux started names its own app folder in `KOLUX_APP_DIR`, so the CLI
/// reaches the copy of Kolux that opened it (a development or side-by-side build included);
/// anywhere else it is the installed app's folder.
fn data_dir() -> PathBuf {
    data_dir_of(std::env::var_os(APP_DIR_ENV), std::env::var_os("APPDATA"))
}

fn data_dir_of(own: Option<std::ffi::OsString>, appdata: Option<std::ffi::OsString>) -> PathBuf {
    match own.filter(|d| !d.is_empty()) {
        Some(d) => d.into(),
        None => appdata.map(PathBuf::from).unwrap_or_else(std::env::temp_dir).join(DATA_DIR),
    }
}

fn unreachable_fail(why: String) -> Fail {
    Fail { code: "app_unreachable", message: "Kolux is not running; start it first".into(), data: json!({ "detail": why }) }
}

/// Reads the app's reachability file: the port and the token.
fn read_endpoint(dir: &Path) -> Result<(u16, String), Fail> {
    let text = std::fs::read_to_string(dir.join(FILE)).map_err(|e| unreachable_fail(e.to_string()))?;
    let v: Value = serde_json::from_str(&text).map_err(|e| unreachable_fail(e.to_string()))?;
    match (v["port"].as_u64(), v["token"].as_str()) {
        (Some(p), Some(t)) => Ok((p as u16, t.to_string())),
        _ => Err(unreachable_fail(format!("{} has no port or token", dir.join(FILE).display()))),
    }
}

/// Sends one request and reads the envelope back. A reply with another id is refused (CLI-004).
pub fn call(port: u16, req: &Request) -> Result<Value, Fail> {
    let mut stream = TcpStream::connect(("127.0.0.1", port)).map_err(|e| unreachable_fail(e.to_string()))?;
    stream.set_read_timeout(Some(Duration::from_secs(300))).ok();
    let line = serde_json::to_string(req).map_err(|e| Fail::new("failed", e.to_string()))?;
    stream.write_all(line.as_bytes()).and_then(|_| stream.write_all(b"\n")).map_err(|e| unreachable_fail(e.to_string()))?;
    let mut reply = String::new();
    BufReader::new(stream).read_line(&mut reply).map_err(|e| Fail::new("failed", format!("the app did not answer: {e}")))?;
    let v: Value = serde_json::from_str(&reply).map_err(|e| Fail::new("failed", format!("malformed reply from the app: {e}")))?;
    if v["requestId"].as_str() != Some(&req.id) {
        return Err(Fail::new("failed", "the app answered another request"));
    }
    Ok(v)
}

fn request_id() -> String {
    let t = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_nanos()).unwrap_or(0);
    format!("{:x}-{:x}", std::process::id(), t)
}

/// What a success looks like without `--json`.
fn text_of(command: &str, r: &Value) -> String {
    let s = |k: &str| r[k].as_str().unwrap_or_default().to_string();
    match command {
        "worktree.create" => {
            let mut line = format!("created {} at {} (from {})", if s("name").is_empty() { s("branch") } else { s("name") }, s("path"), s("base"));
            if let Some(n) = r["note"].as_str() {
                line.push_str("\nnote: ");
                line.push_str(n);
            }
            line
        }
        WORKER_START => {
            let model = r["model"].as_str().map(|m| format!(", {m}")).unwrap_or_default();
            let term = r["terminals"][0]["id"].as_u64().map(|t| format!(" in terminal {t}")).unwrap_or_default();
            format!("worker {}: {} for {} in {} ({}{}){}", s("status"), s("dispatchId"), s("taskId"), r["worktree"]["path"].as_str().unwrap_or_default(), s("agent"), model, term)
        }
        "orchestration.run-create" | "orchestration.run-use" => format!("Run {}: {}\nthis terminal ({}) is tied to it", r["run"]["id"].as_str().unwrap_or_default(), r["run"]["objective"].as_str().unwrap_or_default(), r["binding"]["terminal"].as_str().unwrap_or_default()),
        "orchestration.run-current" => match r["runId"].as_str() {
            Some(id) => format!("{} is tied to Run {id}: {}", s("terminal"), r["run"]["objective"].as_str().unwrap_or_default()),
            None => format!("{} is not tied to a Run; run-create or run-use ties it", s("terminal")),
        },
        "orchestration.run-list" => {
            let mut out: Vec<String> = r["runs"].as_array().into_iter().flatten().map(|x| format!("{}  {}", x["id"].as_str().unwrap_or_default(), x["objective"].as_str().unwrap_or_default())).collect();
            if out.is_empty() {
                out.push("no Runs".into());
            }
            if let Some(c) = r["nextCursor"].as_str() {
                out.push(format!("more: --cursor {c}"));
            }
            out.join("\n")
        }
        "orchestration.run-show" => format!("Run {}: {}\nhome terminal {}; tied terminals {}\nmessages {} ({} not acknowledged)", s("id"), s("objective"), s("home"), r["terminals"], r["messages"], r["unacknowledged"]),
        "orchestration.reply" => format!("sent {} to {} on thread {}", r["messageIds"][0].as_str().unwrap_or_default(), s("to"), s("threadId")),
        "orchestration.inbox" => {
            let msgs = r["messages"].as_array().cloned().unwrap_or_default();
            let mut out = vec![if msgs.is_empty() { "no mail".to_string() } else { format!("{} newest message(s) for {}", msgs.len(), s("terminal")) }];
            mail_lines(&msgs, &mut out);
            out.join("\n")
        }
        "orchestration.task-create" => {
            let deps: Vec<&str> = r["deps"].as_array().into_iter().flatten().filter_map(Value::as_str).collect();
            if s("status") == "pending" { format!("{} is pending: it waits on {}", s("id"), deps.join(", ")) } else { format!("{} is {}", s("id"), s("status")) }
        }
        "orchestration.task-list" => {
            let rows = r["tasks"].as_array().cloned().unwrap_or_default();
            let mut out = Vec::new();
            for t in &rows {
                let g = |k: &str| t[k].as_str().unwrap_or_default().to_string();
                let deps: Vec<&str> = t["deps"].as_array().into_iter().flatten().filter_map(Value::as_str).collect();
                let waits = if deps.is_empty() { String::new() } else { format!(" (waits on {})", deps.join(", ")) };
                let worker = t["worker"]["dispatchId"].as_str().map(|d| format!(" [{d} in {}]", t["worker"]["terminal"].as_str().unwrap_or("?"))).unwrap_or_default();
                out.push(format!("{}  {}  {}{waits}{worker}", g("id"), g("status"), g("name")));
                if r["brief"] == true {
                    out.push(format!("  {}", g("spec")));
                }
            }
            if out.is_empty() {
                out.push(match r["runId"].as_str() { Some(run) => format!("no tasks in {run}"), None => "no tasks outside a Run".into() });
            }
            out.join("\n")
        }
        "orchestration.dispatch" => {
            let how = if s("mode") == "inject" { "the brief is typed in" } else { "context only, nothing typed" };
            let mut line = if r["dryRun"] == true {
                format!("dry run: would hand {} to {} ({}) as {}, {how}; {} is still {}", s("taskId"), s("to"), s("agent"), s("dispatchId"), s("taskId"), s("taskStatus"))
            } else {
                format!("{}: {} handed to {} ({}), {how}", s("dispatchId"), s("taskId"), s("to"), s("agent"))
            };
            if let Some(p) = r["preamble"].as_str() {
                line.push_str("\n\n");
                line.push_str(p);
            }
            line
        }
        "orchestration.dispatch-show" => {
            let mut line = format!("{}: {} on {} ({}), {}, {}", s("id"), s("taskId"), s("handle"), s("agent"), if s("mode").is_empty() { "worker" } else { r["mode"].as_str().unwrap_or_default() }, s("status"));
            if let Some(p) = r["preamble"].as_str() {
                line.push_str("\n\n");
                line.push_str(p);
            }
            line
        }
        SEND => format!("sent {} to {}", r["messageIds"].as_array().into_iter().flatten().filter_map(Value::as_str).collect::<Vec<_>>().join(", "), s("to")),
        CHECK => {
            let msgs = r["messages"].as_array().cloned().unwrap_or_default();
            let mut out = Vec::new();
            match (r["deliveryId"].as_str(), msgs.is_empty()) {
                (_, true) if r["timedOut"] == true => out.push("no mail before the timeout".to_string()),
                (_, true) => out.push("no mail".to_string()),
                (Some(d), false) => out.push(format!("delivery {d}: {} message(s); acknowledge with --ack {d}", msgs.len())),
                (None, false) => out.push(format!("{} message(s), {}", msgs.len(), s("mode"))),
            }
            mail_lines(&msgs, &mut out);
            out.join("\n")
        }
        _ => format!("removed {}", s("path")),
    }
}

/// One line per message, its body under it, and the command that answers it (ORCH-006).
fn mail_lines(msgs: &[Value], out: &mut Vec<String>) {
    for m in msgs {
        let g = |k: &str| m[k].as_str().unwrap_or_default();
        let p = m["priority"].as_str().unwrap_or("normal");
        let mark = if p == "normal" { String::new() } else { format!("[{}] ", p.to_uppercase()) };
        out.push(format!("{mark}{} from {} ({}): {}", g("id"), g("from"), g("type"), g("subject")));
        if !g("body").is_empty() {
            out.push(format!("  {}", g("body")));
        }
        if !g("reply").is_empty() {
            out.push(format!("  reply: {}", g("reply")));
        }
    }
}

/// ORCH-005: `check --wait` asks again until mail comes, the time is up, or the pane is tied
/// elsewhere (the app answers fenced), writing a keepalive line to standard error meanwhile.
fn wait_for_mail(port: u16, mut req: Request) -> Result<Value, Fail> {
    let ms = |v: Option<String>| v.and_then(|s| s.trim().parse::<u64>().ok()).filter(|n| *n > 0);
    let timeout = ms(req.args["timeoutMs"].as_str().map(str::to_string)).unwrap_or(WAIT_DEFAULT_MS);
    let every = ms(std::env::var("KOLUX_KEEPALIVE_INTERVAL_MS").ok()).or_else(|| ms(std::env::var("KOLUX_HEARTBEAT_INTERVAL_MS").ok())).unwrap_or(KEEPALIVE_MS);
    let start = Instant::now();
    let mut alive = start;
    loop {
        let mut env = call(port, &req)?;
        if env["success"] != Value::Bool(true) || env["result"]["messages"].as_array().is_some_and(|m| !m.is_empty()) {
            return Ok(env);
        }
        let elapsed = start.elapsed().as_millis() as u64;
        if elapsed >= timeout {
            env["result"]["timedOut"] = Value::Bool(true);
            return Ok(env);
        }
        if let Some(a) = req.args.as_object_mut() {
            a.remove("ack");
            a.entry("fence").or_insert_with(|| env["result"]["epoch"].clone());
        }
        if alive.elapsed().as_millis() as u64 >= every {
            eprintln!("{}", json!({ "_keepalive": true, "_heartbeat": true, "elapsedMs": elapsed, "deadlineMs": timeout }));
            alive = Instant::now();
        }
        std::thread::sleep(Duration::from_millis(500.min(timeout - elapsed)));
    }
}

/// The `kolux-dev` program: parses, talks to the app, prints, and returns the exit status.
pub fn main(words: Vec<String>) -> i32 {
    let (json, parsed) = parse(&words);
    let id = request_id();
    let finish = |out: Result<(String, Value), Fail>| -> i32 {
        match (&out, json) {
            (Ok((command, env)), true) => {
                println!("{}", serde_json::to_string_pretty(env).unwrap_or_default());
                let _ = command;
                i32::from(env["success"] != Value::Bool(true))
            }
            (Ok((command, env)), false) => {
                if env["success"] == Value::Bool(true) {
                    println!("{}", text_of(command, &env["result"]));
                    0
                } else {
                    eprintln!("error: {}", env["error"]["message"].as_str().unwrap_or("the command failed"));
                    if let Some(h) = env["error"]["data"]["hint"].as_str() {
                        eprintln!("{h}");
                    }
                    1
                }
            }
            (Err(f), true) => {
                println!("{}", serde_json::to_string_pretty(&envelope(&id, "", Err(f.clone()))).unwrap_or_default());
                1
            }
            (Err(f), false) => {
                eprintln!("error: {}", f.message);
                if f.code == "invalid_arguments" {
                    eprintln!("run kolux-dev --help for the usage");
                }
                1
            }
        }
    };
    let parsed = match parsed {
        Ok(Some(p)) => p,
        Ok(None) => {
            print!("{HELP}");
            return 0;
        }
        Err(f) => return finish(Err(f)),
    };
    let run = || -> Result<(String, Value), Fail> {
        let (port, token) = read_endpoint(&data_dir())?;
        let cwd = std::env::current_dir().map(|p| p.display().to_string()).unwrap_or_default();
        let pane = match (std::env::var("KOLUX_TERMINAL_HANDLE"), std::env::var("KOLUX_PANE_KEY")) {
            (Ok(handle), Ok(key)) if !handle.is_empty() => Some(Pane { handle, key }),
            _ => None,
        };
        let req = Request { id: id.clone(), token, command: parsed.command.clone(), cwd, args: Value::Object(parsed.args.clone()), pane };
        if parsed.command == CHECK && parsed.args.contains_key("wait") {
            return Ok((parsed.command.clone(), wait_for_mail(port, req)?));
        }
        Ok((parsed.command.clone(), call(port, &req)?))
    };
    finish(run())
}

// ---------------------------------------------------------------- the app's side

/// What a command needs from the app: Git, the store, the open terminals, and a way to tell the
/// front end what changed.
pub struct Ctx<'a> {
    /// Claude's user configuration, where a new worktree is marked trusted (SAFE-023).
    pub claude_config: PathBuf,
    pub git: &'a Git,
    pub store: &'a Mutex<Store>,
    pub terminals: &'a Terminals,
    pub notify: &'a (dyn Fn(Value) + Sync),
}

fn lower(p: &Path) -> String {
    p.canonicalize().unwrap_or_else(|_| p.to_path_buf()).to_string_lossy().to_lowercase()
}

/// Is `cwd` the folder `dir` or inside it?
fn under(dir: &str, cwd: &str) -> bool {
    let (d, c) = (lower(Path::new(dir)), lower(Path::new(cwd)));
    c == d || c.strip_prefix(&d).is_some_and(|rest| rest.starts_with(['\\', '/']))
}

fn selector(s: &str) -> (&str, &str) {
    match s.split_once(':') {
        Some((p, v)) if ["id", "name", "path", "branch", "identity", "issue"].contains(&p) => (p, v.trim()),
        _ => ("name", s.trim()),
    }
}

/// The project a call means: `--repo` by id, name or path, else the one whose checkout or
/// worktree the call was made in.
fn pick_project(ctx: &Ctx, repo: Option<&str>, cwd: &str) -> Result<Project, Fail> {
    let store = ctx.store.lock().map_err(|e| e.to_string())?;
    let projects = projects::load_projects(&store);
    if let Some(sel) = repo {
        let (kind, v) = selector(sel);
        let hit = projects.iter().find(|p| match kind {
            "id" => p.id == v,
            "name" => p.name.eq_ignore_ascii_case(v),
            "path" => under(&p.path, v) || projects::list_workspaces(ctx.git, &store, p).map(|ws| ws.iter().any(|w| under(&w.path, v))).unwrap_or(false),
            _ => false,
        });
        return hit.cloned().ok_or_else(|| Fail::new("not_found", format!("no project matches --repo {sel}")));
    }
    for p in &projects {
        if under(&p.path, cwd) {
            return Ok(p.clone());
        }
        if projects::list_workspaces(ctx.git, &store, p).map(|ws| ws.iter().any(|w| under(&w.path, cwd))).unwrap_or(false) {
            return Ok(p.clone());
        }
    }
    Err(Fail { code: "not_found", message: format!("no project contains {cwd}"), data: json!({ "hint": "run it inside a project, or pass --repo name:<project>" }) })
}

/// The worktree `--worktree` means: `current` is the one the call was made in; `name:` matches
/// the typed name, the branch or the folder name; `branch:` and `path:` match exactly.
fn pick_worktree(ctx: &Ctx, sel: &str, cwd: &str) -> Result<(Project, Worktree), Fail> {
    let store = ctx.store.lock().map_err(|e| e.to_string())?;
    let mut hits: Vec<(Project, Worktree)> = Vec::new();
    for p in projects::load_projects(&store) {
        for w in projects::list_workspaces(ctx.git, &store, &p)? {
            let folder = Path::new(&w.path).file_name().map(|f| f.to_string_lossy().to_string()).unwrap_or_default();
            let ok = match (sel, selector(sel)) {
                ("current", _) => under(&w.path, cwd),
                ("active", _) => return Err(Fail::args("`active` is not known to the command line yet; use current, name:, branch: or path:")),
                (_, ("name", v)) => w.name.as_deref() == Some(v) || w.branch.as_deref() == Some(v) || folder == v,
                (_, ("branch", v)) => w.branch.as_deref() == Some(v),
                (_, ("path", v)) => under(&w.path, v) && under(v, &w.path),
                (_, ("id", v)) => v.split_once("::").is_some_and(|(id, path)| id == p.id && under(&w.path, path) && under(path, &w.path)),
                (_, (k, _)) => return Err(Fail::args(format!("{k}: selectors are not supported yet; use current, name:, branch: or path:"))),
            };
            if ok {
                hits.push((p.clone(), w));
            }
        }
    }
    match hits.len() {
        0 => Err(Fail::new("not_found", format!("no worktree matches --worktree {sel}"))),
        1 => Ok(hits.remove(0)),
        _ => Err(Fail { code: "ambiguous", message: format!("{} worktrees match --worktree {sel}; use path:", hits.len()), data: json!({ "paths": hits.iter().map(|(_, w)| w.path.clone()).collect::<Vec<_>>() }) }),
    }
}

/// Runs one request against the app and says what it did.
pub fn dispatch(ctx: &Ctx, req: &Request) -> Result<Value, Fail> {
    let a = &req.args;
    let text = |k: &str| a[k].as_str().map(str::trim).filter(|s| !s.is_empty()).map(str::to_string);
    match req.command.as_str() {
        "worktree.create" => {
            let name = text("name").ok_or_else(|| Fail::args("--name is required"))?;
            let agent = text("agent").map(|id| installed_agent(&id).map(|_| id)).transpose()?;
            if agent.is_none() && text("prompt").is_some() {
                return Err(Fail::args("a prompt needs --agent to name who gets it"));
            }
            let project = pick_project(ctx, text("repo").as_deref(), &req.cwd)?;
            let made = projects::create_named(ctx.git, ctx.store, &project.id, &name, text("baseBranch").as_deref())?;
            let activate = a["activate"].as_bool().unwrap_or(false);
            let mut result = serde_json::to_value(&made).map_err(|e| Fail::new("failed", e.to_string()))?;
            let obj = result.as_object_mut().expect("a workspace is an object");
            obj.insert("projectId".into(), json!(project.id));
            obj.insert("agent".into(), json!(agent));
            obj.insert("activated".into(), json!(activate));
            // ponytail: setup scripts, issues, comments and lineage are later cards; the values
            // are accepted and echoed, nothing runs on them yet.
            obj.insert("setup".into(), json!(text("setup").unwrap_or_else(|| "inherit".into())));
            (ctx.notify)(json!({ "kind": "created", "projectId": project.id, "worktree": made, "agent": agent, "prompt": text("prompt").unwrap_or_default(), "activate": activate }));
            Ok(result)
        }
        "worktree.rm" => {
            let sel = text("worktree").ok_or_else(|| Fail::args("--worktree is required"))?;
            let (project, w) = pick_worktree(ctx, &sel, &req.cwd)?;
            if w.is_main {
                return Err(Fail::new("failed", "the main checkout cannot be removed; remove the project instead"));
            }
            let shown = w.name.clone().or(w.branch.clone()).unwrap_or_else(|| w.path.clone());
            if !a["force"].as_bool().unwrap_or(false) && ctx.git.dirty(Path::new(&w.path))? {
                return Err(Fail { code: "dirty", message: format!("{shown} has uncommitted changes"), data: json!({ "hint": "add --force to remove it anyway, changes and all" }) });
            }
            ctx.terminals.kill_under(Path::new(&w.path));
            projects::remove_workspace(ctx.git, &project, &w.path)?;
            {
                let store = ctx.store.lock().map_err(|e| e.to_string())?;
                projects::forget_workspace(&store, &w.path)?;
            }
            (ctx.notify)(json!({ "kind": "removed", "path": w.path }));
            Ok(json!({ "path": w.path, "branch": w.branch, "name": w.name, "projectId": project.id }))
        }
        WORKER_START => worker_start(ctx, req),
        c if c.starts_with("orchestration.") => mail(ctx, req),
        other => Err(Fail::args(format!("unknown command {other}"))),
    }
}

// ---------------------------------------------------------------- mail (ORCH-001..005)

fn now_ms() -> u64 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0)
}

/// The pane a call came from, when the runtime can vouch for it.
fn caller(ctx: &Ctx, req: &Request) -> Result<Option<String>, Fail> {
    let pane = req.pane.as_ref().map(|p| (p.handle.as_str(), p.key.as_str()));
    crate::orchestration::caller_of(req.args["from"].as_str(), pane, &|h, k| ctx.terminals.verify(h, k), &|h| ctx.terminals.live(h))
}

/// Runs, sends and checks. Everything that ties, sends or reads needs a pane the runtime knows;
/// a shell outside Kolux is turned away rather than tied to a guess (ORCH-001).
fn mail(ctx: &Ctx, req: &Request) -> Result<Value, Fail> {
    use crate::orchestration::{Mail, Mode};
    let a = &req.args;
    let text = |k: &str| a[k].as_str().map(str::trim).filter(|s| !s.is_empty()).map(str::to_string);
    let pane = caller(ctx, req)?;
    let need = || {
        pane.clone().ok_or_else(|| Fail { code: "unbound_caller", message: "this needs a Kolux terminal: run it inside one, or name one with --from <handle>".into(), data: json!({ "hint": "a shell Kolux did not start has no KOLUX_TERMINAL_HANDLE and KOLUX_PANE_KEY" }) })
    };
    let store = ctx.store.lock().map_err(|e| e.to_string())?;
    let mut m = Mail::load(&store);
    let retry = text("retryRequest").map(|r| format!("{}|{}|{r}", req.command, pane.clone().unwrap_or_default()));
    let out = match req.command.as_str() {
        "orchestration.run-create" => {
            let p = need()?;
            let objective = text("objective").ok_or_else(|| Fail::args("--objective is required"))?;
            m.once(retry, |m| Ok(m.run_create(&p, &objective, now_ms())))?
        }
        "orchestration.run-use" => {
            let p = need()?;
            let id = text("id").ok_or_else(|| Fail::args("--id is required"))?;
            m.once(retry, |m| m.run_use(&p, &id))?
        }
        "orchestration.run-current" => m.run_current(&need()?),
        "orchestration.run-list" => m.run_list(text("limit").and_then(|l| l.parse().ok()).unwrap_or(20).min(100), text("cursor").as_deref())?,
        "orchestration.run-show" => m.run_show(&text("id").ok_or_else(|| Fail::args("--id is required"))?)?,
        SEND => {
            let p = need()?;
            let dispatches = load_list(&store, DISPATCHES_KEY);
            m.once(retry, |m| m.send(&p, a, &dispatches, &|h| ctx.terminals.live(h), now_ms()))?
        }
        CHECK => {
            let p = need()?;
            let dispatches = load_list(&store, DISPATCHES_KEY);
            let (reader, boxes) = match (text("terminal"), text("run")) {
                (Some(t), _) => (t.clone(), m.boxes_of(&t, &dispatches)),
                (None, Some(r)) => {
                    m.run_show(&r)?;
                    (format!("run:{r}"), vec![format!("run:{r}")])
                }
                (None, None) => (p.clone(), m.boxes_of(&p, &dispatches)),
            };
            let mode = if a["peek"] == true { Mode::Peek } else if a["unread"] == true { Mode::Unread } else if a["all"] == true { Mode::All } else { Mode::Next };
            let types: Option<Vec<String>> = text("types").map(|t| t.split(',').map(|s| s.trim().to_string()).filter(|s| !s.is_empty()).collect());
            if let Some(bad) = types.iter().flatten().find(|t| !crate::orchestration::KINDS.contains(&t.as_str())) {
                return Err(Fail::args(format!("--types does not know {bad}")));
            }
            m.check(&p, &reader, &boxes, mode, types.as_deref(), text("ack").as_deref(), a["fence"].as_u64())?
        }
        "orchestration.reply" => {
            let p = need()?;
            let id = text("id").ok_or_else(|| Fail::args("--id is required"))?;
            let body = a["body"].as_str().unwrap_or_default().to_string();
            let run = text("run");
            m.once(retry, |m| m.reply(&p, &id, &body, run.as_deref(), now_ms()))?
        }
        "orchestration.inbox" => {
            let reader = match text("terminal") {
                Some(t) => t,
                None => need()?,
            };
            let boxes = m.boxes_of(&reader, &load_list(&store, DISPATCHES_KEY));
            m.inbox(&reader, &boxes, text("limit").and_then(|l| l.parse().ok()).unwrap_or(20).min(200), a["full"] == true)
        }
        "orchestration.task-create" | "orchestration.task-list" | "orchestration.dispatch" | "orchestration.dispatch-show" => tasks(ctx, &store, &mut m, req, pane.as_deref(), retry)?,
        other => return Err(Fail::args(format!("unknown command {other}"))),
    };
    m.save(&store)?;
    Ok(out)
}

/// ORCH-010, ORCH-011, ORCH-013: tasks in a Run, and handing one to an agent terminal that is
/// already open. A task belongs to the Run named with --run, else to the caller's tied Run.
fn tasks(ctx: &Ctx, store: &Store, m: &mut crate::orchestration::Mail, req: &Request, pane: Option<&str>, retry: Option<String>) -> Result<Value, Fail> {
    use crate::orchestration as o;
    let a = &req.args;
    let text = |k: &str| a[k].as_str().map(str::trim).filter(|s| !s.is_empty()).map(str::to_string);
    let named = text("run");
    if let Some(r) = &named {
        m.run_show(r)?;
    }
    let run = named.clone().or_else(|| pane.and_then(|p| m.bound(p)).map(str::to_string));
    let mut tasks = load_list(store, TASKS_KEY);
    o::promote(&mut tasks);
    let mut dispatches = load_list(store, DISPATCHES_KEY);
    let out = match req.command.as_str() {
        "orchestration.task-create" => m.once(retry, |_| o::task_create(&mut tasks, a, run.clone(), now_ms()))?,
        "orchestration.task-list" => o::task_list(&tasks, &dispatches, run.as_deref(), a, &|h| ctx.terminals.live(h))?,
        "orchestration.dispatch" => {
            let task = text("task").ok_or_else(|| Fail::args("--task is required"))?;
            let to = text("to").ok_or_else(|| Fail::args("--to is required"))?;
            let tid = to.strip_prefix("term-").and_then(|n| n.parse::<u32>().ok()).filter(|_| ctx.terminals.live(&to)).ok_or_else(|| Fail::new("not_found", format!("no open Kolux terminal is called {to}")))?;
            let (i, agent) = o::dispatch_check(&tasks, &dispatches, &task, &to, pane, &|h| pane_agent(ctx, h))?;
            if let (Some(n), Some(r)) = (&named, tasks[i]["runId"].as_str()) {
                if n != r {
                    return Err(Fail::new("run_mismatch", format!("{task} belongs to {r}, not to the Run named with --run ({n})")));
                }
            }
            let id = next_id(&dispatches, "dispatch-");
            let run = tasks[i]["runId"].as_str().map(str::to_string).or(run);
            let behind = ctx.terminals.dir_of(&to).and_then(|d| {
                let p = projects::load_projects(store).into_iter().find(|p| projects::list_workspaces(ctx.git, store, p).is_ok_and(|ws| ws.iter().any(|w| same_dir(&w.path, &d))))?;
                drift(ctx.git, &p, &d)
            });
            let brief = o::brief(&tasks[i], &o::Brief { dispatch: &id, run: run.as_deref(), coordinator: pane, behind });
            let mode = if a["inject"] == true { "inject" } else { "context" };
            let mut plan = json!({ "dispatchId": id, "taskId": task, "to": to, "agent": agent, "runId": run, "mode": mode });
            if a["returnPreamble"] == true {
                plan["preamble"] = json!(brief);
            }
            if a["dryRun"] == true {
                plan["dryRun"] = json!(true);
                plan["taskStatus"] = tasks[i]["status"].clone();
                return Ok(plan);
            }
            m.once(retry, |_| {
                if mode == "inject" {
                    type_brief(ctx.terminals, tid, &brief)?;
                }
                dispatches.push(json!({ "id": id, "runtime": std::process::id(), "runId": run, "taskId": task, "status": "running", "terminal": tid, "agent": agent, "mode": mode, "brief": brief, "created": now_ms() }));
                tasks[i]["status"] = json!("dispatched");
                tasks[i]["dispatchId"] = json!(id);
                Ok(plan.clone())
            })?
        }
        "orchestration.dispatch-show" => {
            let task = text("task").ok_or_else(|| Fail::args("--task is required"))?;
            let mut v = dispatches.iter().rev().find(|d| d["taskId"] == task).cloned().ok_or_else(|| Fail::new("not_found", format!("{task} has not been dispatched")))?;
            let brief = v.as_object_mut().and_then(|o| o.remove("brief"));
            v["handle"] = json!(v["terminal"].as_u64().map(|t| crate::terminal::handle_of(t as u32)));
            if a["preamble"] == true {
                v["preamble"] = brief.unwrap_or_default();
            }
            v
        }
        other => return Err(Fail::args(format!("unknown command {other}"))),
    };
    save_list(store, TASKS_KEY, &tasks)?;
    save_list(store, DISPATCHES_KEY, &dispatches)?;
    Ok(out)
}

/// ORCH-013: the agent Kolux started in pane `h`, once it is up; a shell, or a program Kolux does
/// not know, is none.
fn pane_agent(ctx: &Ctx, h: &str) -> Option<String> {
    let p = ctx.terminals.program_of(h, SETTLE)?;
    let stem = Path::new(&p).file_stem()?.to_string_lossy().to_lowercase();
    crate::agents::agent_list().into_iter().find(|x| x.id == stem || x.program.eq_ignore_ascii_case(&stem)).map(|x| x.id)
}

fn same_dir(a: &str, b: &str) -> bool {
    Path::new(a).canonicalize().ok().is_some_and(|x| Path::new(b).canonicalize().ok() == Some(x))
}

/// ORCH-014: how many commits the worktree at `dir` is behind its project's base, when it is.
fn drift(git: &Git, project: &Project, dir: &str) -> Option<(u32, String)> {
    let base = project.base.clone().filter(|b| !b.trim().is_empty()).or_else(|| git.default_branch(Path::new(&project.path)))?;
    git.behind(Path::new(dir), &base).filter(|n| *n > 0).map(|n| (n, base))
}

/// ORCH-013's inject: the brief goes in as one bracketed paste, so its line breaks do not send it
/// early, then Enter submits it.
fn type_brief(terminals: &Terminals, id: u32, brief: &str) -> Result<(), Fail> {
    terminals.write(id, &format!("\u{1b}[200~{brief}\u{1b}[201~")).map_err(|e| Fail::new("failed", e))?;
    std::thread::sleep(Duration::from_millis(300));
    terminals.write(id, "\r").map_err(|e| Fail::new("failed", e))
}

// ---------------------------------------------------------------- worker start (ORCH-016)

const TASKS_KEY: &str = "orchestration.tasks";
const DISPATCHES_KEY: &str = "orchestration.dispatches";
/// Readiness: the agent has written something and is still running this long after (ORCH-016).
/// ponytail: an idle detector comes with the status cards (STAT); first output is the honest
/// floor until then.
const SETTLE: Duration = Duration::from_millis(1000);
const DEFAULT_TIMEOUT: Duration = Duration::from_secs(60);

fn load_list(store: &Store, key: &str) -> Vec<Value> {
    store.get(key).ok().flatten().and_then(|v| serde_json::from_str(&v).ok()).unwrap_or_default()
}

fn save_list(store: &Store, key: &str, list: &[Value]) -> Result<(), Fail> {
    store.set(key, &Value::Array(list.to_vec()).to_string()).map_err(|e| Fail::new("failed", e.to_string()))
}

pub(crate) fn next_id(list: &[Value], prefix: &str) -> String {
    let n = list.iter().filter_map(|t| t["id"].as_str()?.strip_prefix(prefix)?.parse::<u64>().ok()).max().unwrap_or(0);
    format!("{prefix}{}", n + 1)
}

fn installed_agent(id: &str) -> Result<crate::agents::AgentInfo, Fail> {
    let known = crate::agents::agent_list().into_iter().find(|x| x.id == id).ok_or_else(|| Fail::args(format!("Kolux knows no agent `{id}`")))?;
    if !known.installed {
        return Err(Fail::new("failed", format!("{} is not installed", known.name)));
    }
    Ok(known)
}

/// The start-line arguments a model and effort add for an agent.
fn model_args(agent: &str, model: Option<&str>, effort: Option<&str>) -> Result<Vec<String>, Fail> {
    let mut extra = Vec::new();
    if let Some(m) = model {
        extra.extend(["--model".to_string(), m.to_string()]);
    }
    match (agent, effort) {
        (_, None) => {}
        ("claude", Some(e)) => extra.extend(["--effort".to_string(), e.to_string()]),
        ("codex", Some(e)) => extra.extend(["-c".to_string(), format!("model_reasoning_effort={e}")]),
        (a, Some(_)) => return Err(Fail::new("unsupported", format!("an effort level is only known for Claude Code and Codex, not {a}"))),
    }
    Ok(extra)
}

/// Waits for the worker's terminal in `dir`: ready once it has written and is still there
/// `SETTLE` later; gives up at `timeout`. Returns the terminal seen (if any) and readiness.
fn wait_ready(terminals: &Terminals, dir: &Path, since: Instant, timeout: Duration) -> (Option<u32>, bool) {
    let mut seen = None;
    while since.elapsed() < timeout {
        if let Some((id, last)) = terminals.program_in(dir, since) {
            seen = Some(id);
            if last.is_some_and(|t| t.elapsed() >= SETTLE) {
                return (seen, true);
            }
        }
        std::thread::sleep(Duration::from_millis(100));
    }
    (seen, false)
}

/// `kolux orchestration worker-start` (ORCH-016): the task (made or found), the worktree (made or
/// found), the agent's start in a background tab, and a wait for it to come up.
fn worker_start(ctx: &Ctx, req: &Request) -> Result<Value, Fail> {
    let a = &req.args;
    let text = |k: &str| a[k].as_str().map(str::trim).filter(|s| !s.is_empty()).map(str::to_string);
    if text("terminal").is_some() {
        return Err(Fail::new("unsupported", "terminal handles are not known to the command line yet; use --agent or --tier"));
    }
    let default = {
        let store = ctx.store.lock().map_err(|e| e.to_string())?;
        store.settings()["defaultAgent"].as_str().filter(|s| !s.is_empty()).unwrap_or("claude").to_string()
    };
    let coordinator = caller(ctx, req).ok().flatten();
    let tier = text("tier");
    // ORCH-018: a tier runs on the coordinator's own agent, when Kolux started one in its pane.
    let agent_id = match &tier {
        Some(_) => crate::orchestration::tier_agent(text("agent").as_deref(), coordinator.as_deref().and_then(|h| pane_agent(ctx, h)).as_deref(), &default)?,
        None => text("agent").unwrap_or(default),
    };
    let agent = installed_agent(&agent_id)?;
    // ORCH-018 / SET-028: a tier means the model and effort picked for it in model routing.
    let (model, effort) = match &tier {
        Some(t) => {
            let settings = ctx.store.lock().map_err(|e| e.to_string())?.settings();
            crate::routing::route(&settings, &agent_id, t).map_err(|m| Fail::new("no_route", m))?
        }
        None => (text("model"), text("effort")),
    };
    let extra = model_args(&agent_id, model.as_deref(), effort.as_deref())?;
    let timeout = text("timeoutMs").and_then(|ms| ms.parse().ok()).map(Duration::from_millis).unwrap_or(DEFAULT_TIMEOUT);

    // The task: found by id, or made from the brief (ORCH-016's text form creates it).
    let (task, dispatch_id) = {
        let store = ctx.store.lock().map_err(|e| e.to_string())?;
        let mut tasks = load_list(&store, TASKS_KEY);
        let dispatches = load_list(&store, DISPATCHES_KEY);
        let dispatch_id = next_id(&dispatches, "dispatch-");
        let idx = match (text("task"), text("spec")) {
            (Some(id), _) => {
                let i = tasks.iter().position(|t| t["id"] == id).ok_or_else(|| Fail::new("not_found", format!("no task {id}")))?;
                match tasks[i]["status"].as_str().unwrap_or_default() {
                    "dispatched" => return Err(Fail::new("failed", format!("{id} already has a worker ({})", tasks[i]["dispatchId"].as_str().unwrap_or("?")))),
                    "completed" => return Err(Fail::new("failed", format!("{id} is already completed"))),
                    _ => i,
                }
            }
            (None, Some(spec)) => {
                if spec.len() > crate::orchestration::SPEC_MAX {
                    return Err(Fail::new("too_large", format!("the task text is {} bytes; Kolux stores at most {}", spec.len(), crate::orchestration::SPEC_MAX)));
                }
                let title = text("taskTitle").unwrap_or_else(|| spec.lines().next().unwrap_or_default().chars().take(60).collect());
                let deps: Vec<String> = text("deps").and_then(|d| serde_json::from_str(&d).ok()).unwrap_or_default();
                let created = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0);
                let run_id = caller(ctx, req).ok().flatten().and_then(|p| crate::orchestration::Mail::load(&store).bound(&p).map(str::to_string));
                tasks.push(json!({ "id": next_id(&tasks, "task-"), "runId": run_id, "title": title, "spec": spec, "status": "pending", "deps": deps, "parent": text("parent"), "created": created }));
                tasks.len() - 1
            }
            (None, None) => return Err(Fail::args("give --task <id> or --spec <text>")),
        };
        tasks[idx]["status"] = json!("dispatched");
        tasks[idx]["dispatchId"] = json!(dispatch_id);
        save_list(&store, TASKS_KEY, &tasks)?;
        (tasks[idx].clone(), dispatch_id)
    };
    let task_id = task["id"].as_str().unwrap_or_default().to_string();

    // The placement: the caller's worktree, one picked by selector, or a new one (agent-first).
    let placement = text("worktree").unwrap_or_else(|| NEW_TOP.into());
    let (project, worktree, created) = if placement == NEW_TOP || placement == NEW_CHILD {
        // PROJ-047: new-child is a new worktree whose parent is the worktree the call came from;
        // called from outside one of the project's worktrees it has no parent (top level).
        let project = pick_project(ctx, text("repo").as_deref(), &req.cwd)?;
        let parent = if placement == NEW_CHILD { pick_worktree(ctx, "current", &req.cwd).ok().filter(|(p, _)| p.id == project.id).map(|(_, w)| w.path) } else { None };
        let wt = match text("name") {
            Some(name) => projects::create_named(ctx.git, ctx.store, &project.id, &name, text("baseBranch").as_deref())?.worktree,
            None => projects::create_fresh(ctx.git, ctx.store, &project.id)?,
        };
        let wt = match text("displayName") {
            Some(shown) => {
                let store = ctx.store.lock().map_err(|e| e.to_string())?;
                projects::set_name(&store, &wt.path, Some(&shown))?;
                Worktree { name: Some(shown), ..wt }
            }
            None => wt,
        };
        let wt = match parent {
            Some(parent) => {
                let store = ctx.store.lock().map_err(|e| e.to_string())?;
                projects::set_parent(&store, &wt.path, Some(&parent))?;
                Worktree { parent: Some(parent), ..wt }
            }
            None => wt,
        };
        (project, wt, true)
    } else {
        let (p, w) = pick_worktree(ctx, &placement, &req.cwd)?;
        (p, w, false)
    };

    // ORCH-014: the worker's brief: how to report, beat and ask, any base drift, then the task.
    let run_id = {
        let store = ctx.store.lock().map_err(|e| e.to_string())?;
        coordinator.as_deref().and_then(|p| crate::orchestration::Mail::load(&store).bound(p).map(str::to_string))
    };
    let behind = drift(ctx.git, &project, &worktree.path);
    let brief = crate::orchestration::brief(&task, &crate::orchestration::Brief { dispatch: &dispatch_id, run: run_id.as_deref(), coordinator: coordinator.as_deref(), behind });

    // SAFE-023: the worktree (and its main repository) are trusted before the agent starts; best
    // effort, a failure never stops the worker.
    let trusted = match crate::trust::trust_folders(&ctx.claude_config, &agent_id, &[PathBuf::from(&worktree.path), PathBuf::from(&project.path)]) {
        Ok(_) => json!(true),
        Err(e) => json!(format!("not trusted: {e}")),
    };
    let since = Instant::now();
    if created {
        (ctx.notify)(json!({ "kind": "created", "projectId": project.id, "worktree": { "path": worktree.path, "branch": worktree.branch, "name": worktree.name, "isMain": false, "parent": worktree.parent }, "agent": Value::Null, "prompt": "", "activate": false }));
    }
    (ctx.notify)(json!({ "kind": "start", "path": worktree.path, "branch": worktree.branch, "agent": agent_id, "prompt": brief, "extra": extra, "title": task["title"] }));
    let (terminal, ready) = wait_ready(ctx.terminals, Path::new(&worktree.path), since, timeout);
    let status = if ready { "ready" } else { "unknown" };

    let receipt = json!({
        "dispatchId": dispatch_id, "taskId": task_id, "status": status, "stage": "worker",
        "worktree": { "path": worktree.path, "branch": worktree.branch, "name": worktree.name, "projectId": project.id, "created": created, "parent": worktree.parent },
        "placement": placement, "agent": agent_id, "program": agent.program, "model": model, "effort": effort, "tier": tier,
        "setup": "not_configured", "trust": trusted,
        "terminals": terminal.map(|id| vec![json!({ "id": id, "role": "worker" })]).unwrap_or_default(),
        "waitedMs": since.elapsed().as_millis() as u64,
        "hint": format!("kolux-dev worktree rm --worktree path:{} --force removes the worktree, its worker and all", worktree.path),
    });
    {
        let store = ctx.store.lock().map_err(|e| e.to_string())?;
        let mut dispatches = load_list(&store, DISPATCHES_KEY);
        dispatches.push(json!({ "id": dispatch_id, "runtime": std::process::id(), "runId": run_id, "taskId": task_id, "status": status, "worktree": worktree.path, "agent": agent_id, "model": model, "effort": effort, "tier": tier, "terminal": terminal, "brief": brief, "created": since.elapsed().as_millis() as u64 }));
        save_list(&store, DISPATCHES_KEY, &dispatches)?;
    }
    if ready {
        Ok(receipt)
    } else {
        Err(Fail { code: "timeout", message: format!("the worker did not come up within {} ms; it may still be starting in the background ({dispatch_id} in {})", timeout.as_millis(), worktree.path), data: receipt })
    }
}

/// A token nobody outside this machine can guess: two hashes seeded from the OS's randomness.
pub(crate) fn secret() -> String {
    use std::hash::{BuildHasher, Hasher};
    let seed = std::collections::hash_map::RandomState::new();
    let mut h = seed.build_hasher();
    h.write_u64(u64::from(std::process::id()));
    format!("{:016x}{:016x}", h.finish(), std::collections::hash_map::RandomState::new().build_hasher().finish())
}

/// Answers requests on `listener` one at a time until the listener is dropped.
pub fn serve_loop(listener: TcpListener, token: &str, runtime: &str, handle: impl Fn(&Request) -> Result<Value, Fail>) {
    // ponytail: one request at a time; a parallel accept loop if agents ever queue up on it.
    for stream in listener.incoming().flatten() {
        let mut stream = stream;
        stream.set_read_timeout(Some(Duration::from_secs(10))).ok();
        let mut line = String::new();
        if BufReader::new(&stream).read_line(&mut line).is_err() {
            continue;
        }
        let (id, out) = match serde_json::from_str::<Request>(&line) {
            Ok(req) if req.token != token => (req.id, Err(Fail::new("unauthorized", "the token does not match this app; is cli.json stale?"))),
            Ok(req) => (req.id.clone(), handle(&req)),
            Err(e) => (String::new(), Err(Fail::args(format!("malformed request: {e}")))),
        };
        let reply = envelope(&id, runtime, out).to_string();
        let _ = stream.write_all(reply.as_bytes()).and_then(|_| stream.write_all(b"\n"));
    }
}

/// Starts listening for the command line and writes `cli.json` so it can find the app.
pub fn serve(app: tauri::AppHandle, dir: &Path) -> std::io::Result<()> {
    use tauri::{Emitter, Manager};
    let listener = TcpListener::bind(("127.0.0.1", 0))?;
    let port = listener.local_addr()?.port();
    let token = secret();
    let runtime = std::process::id().to_string();
    std::fs::write(dir.join(FILE), json!({ "port": port, "token": token, "pid": std::process::id() }).to_string())?;
    std::thread::spawn(move || {
        serve_loop(listener, &token, &runtime, |req| {
            let store = app.state::<Mutex<Store>>();
            let git = app.state::<Git>();
            let terminals = app.state::<Terminals>();
            let notify = |v: Value| {
                let _ = app.emit(EVENT, v);
            };
            dispatch(&Ctx { claude_config: crate::trust::claude_config_file(), git: &git, store: &store, terminals: &terminals, notify: &notify }, req)
        });
    });
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::process::Command;

    fn words(s: &str) -> Vec<String> {
        s.split(' ').map(String::from).collect()
    }

    #[test]
    fn the_command_line_is_checked_before_the_app_is_asked() {
        let (json, p) = parse(&words("worktree create --name one --agent claude --prompt=hi --json"));
        let p = p.unwrap().unwrap();
        assert!(json);
        assert_eq!(p.command, "worktree.create");
        assert_eq!(p.args["name"], "one");
        assert_eq!(p.args["prompt"], "hi");
        assert_eq!(p.args["setup"], "inherit");
        let (_, p) = parse(&words("worktree delete --worktree name:one --force"));
        let p = p.unwrap().unwrap();
        assert_eq!(p.command, "worktree.rm");
        assert_eq!(p.args["force"], true);
        let refused = |s: &str| parse(&words(s)).1.unwrap_err().message;
        assert!(refused("worktree create --name x --prompt hi").contains("--agent"));
        assert!(refused("worktree create --name x --name y").contains("twice"));
        assert!(refused("worktree create --name x --bogus 1").contains("--bogus"));
        assert!(refused("worktree create --name x --setup later").contains("run, skip or inherit"));
        assert!(refused("worktree create --name x --no-parent --parent-worktree name:a").contains("disagree"));
        assert!(refused("worktree rm").contains("--worktree"));
        assert!(refused("worktree frobnicate").contains("unknown command"));
        assert!(parse(&words("--help")).1.unwrap().is_none());
        assert!(parse(&words("help worktree")).1.unwrap().is_none());
    }

    #[test]
    fn a_kolux_terminal_reaches_the_app_that_opened_it() {
        let own = data_dir_of(Some("D:\\lane\\app".into()), Some("C:\\roaming".into()));
        assert_eq!(own, PathBuf::from("D:\\lane\\app"));
        let installed = data_dir_of(None, Some("C:\\roaming".into()));
        assert_eq!(installed, PathBuf::from("C:\\roaming").join(DATA_DIR));
        assert_eq!(data_dir_of(Some("".into()), Some("C:\\roaming".into())), installed);
    }

    #[test]
    fn mail_commands_are_checked_before_the_app_is_asked() {
        let (json, p) = parse(&words("orchestration send --subject hi --to run:run-1 --type worker_done --outcome succeeded --files-modified a,b --retry-request r1 --json"));
        let p = p.unwrap().unwrap();
        assert!(json);
        assert_eq!(p.command, "orchestration.send");
        assert_eq!(p.args["filesModified"], "a,b");
        assert_eq!(p.args["retryRequest"], "r1");
        let (_, p) = parse(&words("orchestration check --wait --timeout-ms 40000 --types status,question"));
        let p = p.unwrap().unwrap();
        assert_eq!(p.args["wait"], true);
        assert_eq!(p.args["timeoutMs"], "40000");
        let (_, p) = parse(&words("orchestration run-use --id run-1 --takeover-legacy"));
        assert_eq!(p.unwrap().unwrap().args["takeoverLegacy"], true);
        let refused = |s: &str| parse(&words(s)).1.unwrap_err().message;
        assert!(refused("orchestration run-create").contains("--objective"));
        assert!(refused("orchestration send --to run:run-1").contains("--subject"));
        assert!(refused("orchestration check --peek --all").contains("one of"));
        // CLI-031: refused here, before the sender is worked out.
        assert!(refused("orchestration send --subject hi --type heartbeat --to @all").contains("never to a group"));
        assert!(refused("orchestration send --subject hi --type worker_done --outcome failed --to @worktree:w1").contains("never to a group"));
        assert!(refused("orchestration send --subject hi --to run:run-1 --task-id t1 --payload {}").contains("not both"));
        assert!(refused("orchestration check --timeout-ms 0").contains("above zero"));
        assert!(refused("orchestration run-list --bogus 1").contains("--bogus"));
        assert!(refused("orchestration run-show").contains("--id"));
        let (_, p) = parse(&words("orchestration dispatch --task task-1 --to term-3 --dry-run --return-preamble"));
        let p = p.unwrap().unwrap();
        assert_eq!(p.command, "orchestration.dispatch");
        assert_eq!((&p.args["dryRun"], &p.args["returnPreamble"]), (&json!(true), &json!(true)));
        let (_, p) = parse(&words("orchestration task-create --spec b --deps [\"task-1\"] --display-name B"));
        assert_eq!(p.unwrap().unwrap().args["displayName"], "B");
        assert_eq!(parse(&words("orchestration inbox --limit 5 --full")).1.unwrap().unwrap().args["full"], true);
        assert!(refused("orchestration reply --id msg-1").contains("--body"));
        assert!(refused("orchestration dispatch --task task-1").contains("--to"));
        assert!(refused("orchestration task-create").contains("--spec"));
        assert!(refused("orchestration dispatch-show").contains("--task"));
        assert!(refused("orchestration task-list --inject").contains("--inject"));
    }

    #[test]
    fn worker_start_is_checked_before_the_app_is_asked() {
        let (json, p) = parse(&words("orchestration worker-start --spec=add_a_test --agent claude --json"));
        let p = p.unwrap().unwrap();
        assert!(json);
        assert_eq!(p.command, "orchestration.worker-start");
        assert_eq!(p.args["spec"], "add_a_test");
        assert_eq!(p.args["worktree"], "new-top-level");
        assert_eq!(p.args["setup"], "inherit");
        let (_, p) = parse(&words("orchestration worker-start --task task-1 --tier light --worktree current --timeout-ms 5000 --task-title T"));
        let p = p.unwrap().unwrap();
        assert_eq!(p.args["timeoutMs"], "5000");
        assert_eq!(p.args["taskTitle"], "T");
        let refused = |s: &str| parse(&words(s)).1.unwrap_err().message;
        assert!(refused("orchestration worker-start --agent claude").contains("--spec"));
        assert!(refused("orchestration worker-start --task t --spec x --agent claude").contains("one of"));
        assert!(refused("orchestration worker-start --spec x").contains("--agent"));
        assert!(refused("orchestration worker-start --spec x --agent claude --worktree current --base-branch main").contains("--base-branch"));
        assert!(refused("orchestration worker-start --spec x --agent claude --worktree name:other --name n").contains("--name"));
        assert!(refused("orchestration worker-start --spec x --agent claude --effort high").contains("--model"));
        assert!(refused("orchestration worker-start --spec x --tier deep --model opus").contains("tier"));
        assert!(refused("orchestration worker-start --spec x --tier huge").contains("major, deep, build or light"));
        assert!(refused("orchestration worker-start --spec x --terminal t1 --model opus").contains("--terminal"));
        assert!(refused("orchestration worker-start --spec x --agent claude --timeout-ms soon").contains("--timeout-ms"));
        assert!(refused("orchestration worker-start --spec x --agent claude --retry-of d1").contains("--task"));
        assert!(refused("orchestration worker-start --spec x --agent claude --deps nope").contains("--deps"));
    }

    #[test]
    fn requests_cross_the_loopback_port_with_the_token() {
        let listener = TcpListener::bind(("127.0.0.1", 0)).unwrap();
        let port = listener.local_addr().unwrap().port();
        std::thread::spawn(move || serve_loop(listener, "secret", "rt-1", |req| Ok(json!({ "echo": req.args }))));
        let req = Request { id: "r1".into(), token: "secret".into(), command: "x".into(), cwd: String::new(), args: json!({ "a": 1 }), pane: None };
        let v = call(port, &req).unwrap();
        assert_eq!(v["success"], true);
        assert_eq!(v["requestId"], "r1");
        assert_eq!(v["result"]["echo"]["a"], 1);
        assert_eq!(v["meta"]["runtimeId"], "rt-1");
        let bad = Request { token: "wrong".into(), ..req };
        let v = call(port, &bad).unwrap();
        assert_eq!(v["success"], false);
        assert_eq!(v["error"]["code"], "unauthorized");
    }

    fn git(args: &[&str], cwd: &Path) {
        let out = Command::new("git").args(args).current_dir(cwd).output().unwrap();
        assert!(out.status.success(), "git {:?}: {}", args, String::from_utf8_lossy(&out.stderr));
    }

    #[test]
    fn create_and_remove_a_worktree_from_the_command_line() {
        let dir = std::env::temp_dir().join(format!("kolux-rs-cli-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        let repo = dir.join("repo");
        std::fs::create_dir_all(&repo).unwrap();
        git(&["init", "-q", "-b", "main"], &repo);
        git(&["-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "--allow-empty", "-m", "one"], &repo);
        let git_ = Git::detect().unwrap();
        let store = Mutex::new(Store::open(&dir.join("data")).unwrap());
        projects::add_project(&git_, &store.lock().unwrap(), &repo).unwrap();
        {
            let s = store.lock().unwrap();
            let mut settings = s.settings();
            settings["workspacesDir"] = json!(dir.join("ws").display().to_string());
            s.save_settings(&settings).unwrap();
        }
        let events = Mutex::new(Vec::<Value>::new());
        let notify = |v: Value| events.lock().unwrap().push(v);
        let terminals = Terminals::default();
        let ctx = Ctx { claude_config: dir.join(".claude.json"), git: &git_, store: &store, terminals: &terminals, notify: &notify };
        let req = |command: &str, cwd: &Path, args: Value| Request { id: "r".into(), token: String::new(), command: command.into(), cwd: cwd.display().to_string(), args, pane: None };

        let made = dispatch(&ctx, &req("worktree.create", &repo, json!({ "name": "cli one", "setup": "skip" }))).unwrap();
        let path = PathBuf::from(made["path"].as_str().unwrap());
        assert!(path.join(".git").exists(), "{}", path.display());
        assert_eq!(made["name"], "cli one");
        assert_eq!(made["branch"], "cli-one");
        assert_eq!(events.lock().unwrap()[0]["kind"], "created");

        let outside = dispatch(&ctx, &req("worktree.create", &dir, json!({ "name": "nowhere" }))).unwrap_err();
        assert_eq!(outside.code, "not_found");
        let unknown = dispatch(&ctx, &req("worktree.create", &repo, json!({ "name": "x", "agent": "nobody" }))).unwrap_err();
        assert!(unknown.message.contains("nobody"));

        std::fs::write(path.join("junk.txt"), "x").unwrap();
        let dirty = dispatch(&ctx, &req("worktree.rm", &repo, json!({ "worktree": "name:cli one" }))).unwrap_err();
        assert_eq!(dirty.code, "dirty");
        assert!(path.exists());
        dispatch(&ctx, &req("worktree.rm", &repo, json!({ "worktree": "name:cli one", "force": true }))).unwrap();
        assert!(!path.exists());
        assert_eq!(events.lock().unwrap()[1]["kind"], "removed");

        let two = dispatch(&ctx, &req("worktree.create", &repo, json!({ "name": "two" }))).unwrap();
        let two_path = PathBuf::from(two["path"].as_str().unwrap());
        dispatch(&ctx, &req("worktree.rm", &two_path, json!({ "worktree": "current" }))).unwrap();
        assert!(!two_path.exists());
        let main = dispatch(&ctx, &req("worktree.rm", &repo, json!({ "worktree": "current" }))).unwrap_err();
        assert!(main.message.contains("main checkout"));

        // ORCH-016: a worker start makes the task, the worktree and the start event, then waits
        // for the worker's terminal; with no window to open one, the wait runs out.
        let claude_installed = crate::agents::agent_list().iter().any(|a| a.id == "claude" && a.installed);
        // SET-028: the light tier was given Sonnet at low effort in settings, so the worker runs on it.
        store.lock().unwrap().save_settings(&json!({ "modelRouting": { "claude": { "light": { "model": "sonnet", "effort": "low" } } } })).unwrap();
        let start = json!({ "spec": "add a test", "agent": "claude", "tier": "light", "worktree": "new-top-level", "setup": "inherit", "timeoutMs": "1" });
        let out = dispatch(&ctx, &req("orchestration.worker-start", &repo, start.clone())).unwrap_err();
        if claude_installed {
            assert_eq!(out.code, "timeout", "{}", out.message);
            assert_eq!(out.data["dispatchId"], "dispatch-1");
            assert_eq!(out.data["taskId"], "task-1");
            assert_eq!(out.data["model"], "sonnet");
            assert_eq!(out.data["effort"], "low");
            assert_eq!(out.data["setup"], "not_configured");
            let wt = PathBuf::from(out.data["worktree"]["path"].as_str().unwrap());
            assert!(wt.join(".git").exists());
            // SAFE-023: the new worktree and the main repository are trusted before the start.
            assert_eq!(out.data["trust"], true, "{}", out.data["trust"]);
            let conf: serde_json::Value = serde_json::from_str(&std::fs::read_to_string(dir.join(".claude.json")).unwrap()).unwrap();
            assert_eq!(conf["projects"][crate::trust::claude_key(&wt).unwrap()]["hasTrustDialogAccepted"], true);
            assert_eq!(conf["projects"][crate::trust::claude_key(&repo).unwrap()]["hasTrustDialogAccepted"], true);
            let ev = events.lock().unwrap();
            let n = ev.len();
            assert_eq!(ev[n - 2]["kind"], "created");
            assert_eq!(ev[n - 1]["kind"], "start");
            // ORCH-014: the worker gets its brief, the task text last.
            let prompt = ev[n - 1]["prompt"].as_str().unwrap();
            assert!(prompt.contains("--type worker_done") && prompt.contains("--dispatch-id dispatch-1") && prompt.ends_with(&format!("{}\nadd a test", crate::orchestration::DIVIDER)), "{prompt}");
            assert_eq!(ev[n - 1]["extra"], json!(["--model", "sonnet", "--effort", "low"]));
            assert_eq!(ev[n - 1]["path"], out.data["worktree"]["path"]);
            drop(ev);
            let tasks = store.lock().unwrap().get("orchestration.tasks").unwrap().unwrap();
            assert!(tasks.contains("\"dispatched\""), "{tasks}");
            // PROJ-047: a new-child worker called from inside that worktree is listed under it.
            let child = dispatch(&ctx, &req("orchestration.worker-start", &wt, json!({ "spec": "a child", "agent": "claude", "worktree": "new-child", "setup": "inherit", "timeoutMs": "1" }))).unwrap_err();
            assert_eq!(child.code, "timeout", "{}", child.message);
            let child_path = child.data["worktree"]["path"].as_str().unwrap().to_string();
            assert_eq!(child.data["worktree"]["parent"], out.data["worktree"]["path"]);
            let project = projects::load_projects(&store.lock().unwrap()).remove(0);
            let listed = projects::list_workspaces(&git_, &store.lock().unwrap(), &project).unwrap();
            assert_eq!(listed.iter().find(|w| w.path == child_path).unwrap().parent.as_ref(), out.data["worktree"]["path"].as_str().map(String::from).as_ref());
            dispatch(&ctx, &req("worktree.rm", &repo, json!({ "worktree": format!("path:{child_path}"), "force": true }))).unwrap();
            assert_eq!(store.lock().unwrap().get("workspaceParents").unwrap().unwrap(), "{}", "removing the child forgets its parent");
            let again = dispatch(&ctx, &req("orchestration.worker-start", &repo, json!({ "task": "task-1", "agent": "claude", "worktree": "current", "setup": "inherit", "timeoutMs": "1" }))).unwrap_err();
            assert!(again.message.contains("already"), "{}", again.message);
            let gone = dispatch(&ctx, &req("orchestration.worker-start", &repo, json!({ "task": "task-9", "agent": "claude", "worktree": "current", "setup": "inherit", "timeoutMs": "1" }))).unwrap_err();
            assert_eq!(gone.code, "not_found");
            dispatch(&ctx, &req("worktree.rm", &repo, json!({ "worktree": format!("path:{}", wt.display()), "force": true }))).unwrap();
        } else {
            assert!(out.message.contains("not installed"));
        }
        let handle = dispatch(&ctx, &req("orchestration.worker-start", &repo, json!({ "spec": "x", "terminal": "t1", "worktree": "current", "setup": "inherit" }))).unwrap_err();
        assert_eq!(handle.code, "unsupported");
        let _ = std::fs::remove_dir_all(&dir);
    }
}
