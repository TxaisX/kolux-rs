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
use std::collections::BTreeMap;
use std::sync::{mpsc, Mutex};
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

const HELP: &str = "kolux-dev: drive Kolux from a terminal\n\n  kolux-dev worktree create --name <name> [--repo <selector>] [--agent <id>] [--prompt <text>]\n      [--setup run|skip|inherit] [--base-branch <ref>] [--issue <number>] [--comment <text>]\n      [--parent-worktree <selector>] [--no-parent] [--run-hooks] [--activate] [--json]\n  kolux-dev worktree rm --worktree <selector> [--force] [--run-hooks] [--json]\n      (also: remove, delete)\n  kolux-dev repo list | repo add --path <folder> | repo show [--repo <selector>] [--json]\n  kolux-dev repo set-base-ref --ref <ref> [--repo <selector>] [--json]\n  kolux-dev repo search-refs [--repo <selector>] [--query <text>] [--limit <n>] [--json]\n  kolux-dev project list [--json]\n  kolux-dev worktree list | worktree ps [--repo <selector>] [--limit <n>] [--json]\n  kolux-dev worktree show [--worktree <selector>] | worktree current [--json]\n  kolux-dev worktree changes | worktree overlap [--worktree <selector>] [--json]\n  kolux-dev orchestration worker-start (--task <id> | --spec <text>) (--agent <id> | --model <m> | --tier major|deep|build|light | --terminal <handle>)\n      [--worktree current|<selector>|new-child|new-top-level] [--model <m>] [--effort <e>] [--name <n>]\n      [--repo <selector>] [--base-branch <ref>] [--display-name <d>] [--comment <c>] [--setup run|skip|inherit]\n      [--task-title <t>] [--deps <json list>] [--parent <task>] [--timeout-ms <ms>] [--max-depth <n>] [--json]\n  kolux-dev orchestration run-create --objective <text> [--from <handle>] [--retry-request <id>] [--json]\n  kolux-dev orchestration run-use --id <run> [--from <handle>] [--takeover-legacy] [--retry-request <id>] [--json]\n  kolux-dev orchestration run-current [--from <handle>] [--json]\n  kolux-dev orchestration run-list [--limit <n>] [--cursor <c>] [--json]\n  kolux-dev orchestration run-show --id <run> [--json]\n  kolux-dev orchestration send --subject <s> [--to run:<id>|dispatch:<id>|<handle>] [--body <text>] [--type <kind>]\n      [--priority normal|high|urgent] [--thread-id <t>] [--payload <json>] [--task-id <id>] [--dispatch-id <id>]\n      [--outcome succeeded|failed] [--files-modified <a,b>] [--report-path <p>] [--phase <p>] [--run <run>] [--from <handle>]\n      [--retry-request <id>] [--json]\n  kolux-dev orchestration check [--terminal <handle>] [--run <run>] [--ack <delivery>] [--unread|--peek|--all]\n      [--types <kind,...>] [--format] [--wait] [--timeout-ms <ms>] [--json]\n  kolux-dev orchestration reply --id <message> --body <text> [--run <run>] [--from <handle>] [--retry-request <id>] [--json]\n  kolux-dev orchestration inbox [--limit <n>] [--terminal <handle>] [--full] [--json]\n  kolux-dev orchestration task-create --spec <text> [--task-title <t>] [--display-name <n>] [--deps <json list>]\n      [--parent <task>] [--run <run>] [--from <handle>] [--retry-request <id>] [--json]\n  kolux-dev orchestration task-list [--status <state>] [--ready] [--brief] [--run <run>] [--json]\n  kolux-dev orchestration dispatch --task <id> (--to <handle> [--inject] | --dry-run) [--return-preamble] [--run <run>]\n      [--max-depth <n>] [--json]\n  kolux-dev orchestration dispatch-show --task <id> [--preamble] [--json]\n  kolux-dev orchestration worker-abandon --dispatch <id> [--json]\n\nSelectors: --repo id:|name:|path:   --worktree active|current|id:<repo-id>::<path>|identity:|name:|branch:|issue:|path:\n--json prints one envelope on stdout; without it, errors go to stderr. Exit 0 worked, 1 any error.\n";

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
    // ponytail: task-update (CLI-034) comes with the guards that keep tasks and workers in step
    // (ORCH-012, T-071); ask (CLI-033) and the worker-list/show/read/stop/release/retain commands
    // (CLI-036) are T-089-b.
    ("orchestration dispatch", "orchestration.dispatch", &["task", "to", "from", "run", "inject", "dry-run", "return-preamble", "max-depth", "retry-request"]),
    ("orchestration dispatch-show", "orchestration.dispatch-show", &["task", "preamble", "from"]),
    ("orchestration worker-abandon", ABANDON, &["dispatch", "run", "from", "retry-request"]),
];
/// CLI-015..017: the repo, project and worktree lookups and their flags.
const QUERY: &[(&str, &str, &[&str])] = &[
    ("repo list", "repo.list", &[]),
    ("repo add", "repo.add", &["path"]),
    ("repo show", "repo.show", &["repo"]),
    ("repo set-base-ref", "repo.set-base-ref", &["repo", "ref"]),
    ("repo search-refs", "repo.search-refs", &["repo", "query", "limit"]),
    ("project list", "project.list", &[]),
    ("worktree list", "worktree.list", &["repo", "limit"]),
    ("worktree ps", "worktree.ps", &["repo", "limit"]),
    ("worktree show", "worktree.show", &["worktree"]),
    ("worktree current", "worktree.current", &[]),
    ("worktree changes", "worktree.changes", &["worktree"]),
    ("worktree overlap", "worktree.overlap", &["worktree"]),
];
const SEND: &str = "orchestration.send";
const ABANDON: &str = "orchestration.worker-abandon";
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
const WORKER_FLAGS: &[&str] = &["task", "spec", "task-title", "deps", "parent", "worktree", "name", "repo", "base-branch", "display-name", "comment", "setup", "agent", "model", "effort", "terminal", "tier", "retry-of", "timeout-ms", "max-depth", "run", "from", "retry-request"];
const TIERS: &[&str] = &["major", "deep", "build", "light"];
const NEW_TOP: &str = "new-top-level";
const NEW_CHILD: &str = "new-child";

type Command = (&'static str, &'static str, &'static [&'static str]);

/// Every command path with its wire name and flags, aliases included (CLI-003 suggests from it).
fn commands() -> Vec<Command> {
    let mut all: Vec<Command> = vec![
        ("worktree create", "worktree.create", CREATE_FLAGS),
        ("worktree rm", "worktree.rm", RM_FLAGS),
        ("worktree remove", "worktree.rm", RM_FLAGS),
        ("worktree delete", "worktree.rm", RM_FLAGS),
        ("orchestration worker-start", WORKER_START, WORKER_FLAGS),
    ];
    all.extend(QUERY.iter().copied());
    all.extend(MAIL.iter().copied());
    all
}
/// CLI-020: the verbs a typo is never pointed at from more than one edit away.
const DESTRUCTIVE: &[&str] = &["rm", "remove", "delete"];

/// Does some command take `--name`? (The retired `--parent-workspace` still takes its value.)
fn known_flag(name: &str) -> bool {
    name == "parent-workspace" || commands().iter().any(|c| c.2.contains(&name))
}

/// Edits between two words, when three or fewer; words over 32 characters are not measured.
fn near(a: &str, b: &str) -> Option<usize> {
    if a.chars().count() > 32 {
        return None;
    }
    let b: Vec<char> = b.chars().collect();
    let mut row: Vec<usize> = (0..=b.len()).collect();
    for (i, ca) in a.chars().enumerate() {
        let mut diag = row[0];
        row[0] = i + 1;
        for j in 0..b.len() {
            let up = row[j + 1];
            row[j + 1] = (diag + usize::from(ca != b[j])).min(row[j] + 1).min(up + 1);
            diag = up;
        }
    }
    Some(row[b.len()]).filter(|d| *d <= 3)
}

/// The nearest word to `typed`, the first on a tie; destructive words only from one edit away.
fn nearest<'a>(typed: &str, from: impl IntoIterator<Item = &'a str>) -> Option<&'a str> {
    from.into_iter().filter_map(|c| near(typed, c).filter(|d| *d == 1 || (*d > 1 && !DESTRUCTIVE.contains(&c))).map(|d| (d, c))).min_by_key(|(d, _)| *d).map(|(_, c)| c)
}

/// The words as one line to run again, quoting any word with a space in it.
fn line(words: &[String]) -> String {
    let quoted: Vec<String> = words.iter().map(|w| if w.contains(char::is_whitespace) { format!("\"{w}\"") } else { w.clone() }).collect();
    format!("kolux-dev {}", quoted.join(" "))
}

/// CLI-003: a command path nothing answers to. A wrong group is matched against group names, a
/// wrong verb against that group's verbs.
fn command_typo(words: &[String], path: &[String], at: &[usize], all: &[Command]) -> Fail {
    let joined = path.join(" ");
    let mut groups: Vec<&str> = Vec::new();
    for c in all {
        let g = c.0.split(' ').next().unwrap_or_default();
        if !groups.contains(&g) {
            groups.push(g);
        }
    }
    let verbs = |g: &str| all.iter().filter_map(|c| c.0.strip_prefix(g).and_then(|r| r.strip_prefix(' '))).collect::<Vec<_>>();
    let (unknown, fix): (&str, Option<Vec<String>>) = if !groups.contains(&path[0].as_str()) {
        let fix = nearest(&path[0], groups.iter().copied()).map(|g| {
            let fits = path.get(1).is_some_and(|v| verbs(g).contains(&v.as_str()));
            let mut p = vec![g.to_string()];
            if fits {
                p.push(path[1].clone());
            }
            p
        });
        (&path[0], fix)
    } else if path.len() == 1 {
        let mut f = Fail::args(format!("`{joined}` needs a command after it: {}", verbs(&path[0]).join(", ")));
        f.data = json!({ "unknown": joined, "command": joined, "suggestions": [], "nextSteps": ["kolux-dev --help"] });
        return f;
    } else if verbs(&path[0]).contains(&path[1].as_str()) {
        let mut f = Fail::args(format!("unknown command `{joined}`: `{}` is not part of {} {}", path[2], path[0], path[1]));
        f.data = json!({ "unknown": path[2], "command": joined, "suggestions": [], "nextSteps": ["kolux-dev --help"] });
        return f;
    } else {
        (&path[1], nearest(&path[1], verbs(&path[0])).map(|v| vec![path[0].clone(), v.to_string()]))
    };
    let said = fix.as_ref().map(|p| p.join(" "));
    let next: Vec<String> = match &fix {
        Some(p) if p.len() == 2 => {
            let mut w = words.to_vec();
            w[at[0]] = p[0].clone();
            w[at[1]] = p[1].clone();
            for &k in at.iter().skip(2).rev() {
                w.remove(k);
            }
            vec![line(&w)]
        }
        _ => vec!["kolux-dev --help".to_string()],
    };
    let tail = said.as_ref().map(|p| format!("; did you mean {p}?")).unwrap_or_else(|| "; run kolux-dev --help".into());
    let mut f = Fail::args(format!("unknown command `{joined}`: `{unknown}` is not a command word here{tail}"));
    f.data = json!({ "unknown": unknown, "command": joined, "suggestions": said.into_iter().collect::<Vec<_>>(), "nextSteps": next });
    f
}

/// CLI-003: a flag this command does not take: the nearest one it does, and the whole list.
fn flag_typo(words: &[String], spots: &[(String, usize)], command: &str, allowed: &[&str], k: &str) -> Fail {
    let mut takes: Vec<&str> = allowed.to_vec();
    takes.push("json");
    let listed: Vec<String> = takes.iter().map(|f| format!("--{f}")).collect();
    // The caller flag of check was renamed; only there is --from pointed at --terminal.
    let renamed = command == "orchestration check" && k == "from";
    let fix = if renamed { Some("terminal") } else { nearest(k, takes.iter().copied()) };
    let message = match fix {
        _ if renamed => format!("--from was renamed on {command}: name the terminal with --terminal <handle>"),
        Some(f) => format!("unknown flag --{k} for {command}; did you mean --{f}?"),
        None => format!("unknown flag --{k} for {command}"),
    };
    let next: Vec<String> = fix.and_then(|f| spots.iter().find(|(n, _)| n == k).map(|&(_, i)| (f, i))).map(|(f, i)| {
        let mut w = words.to_vec();
        w[i] = match w[i].split_once('=') {
            Some((_, v)) => format!("--{f}={v}"),
            None => format!("--{f}"),
        };
        line(&w)
    }).into_iter().collect();
    let mut f = Fail::args(message);
    f.data = json!({ "unknown": format!("--{k}"), "command": command, "suggestions": fix.map(|f| format!("--{f}")).into_iter().collect::<Vec<_>>(), "nextSteps": next, "flags": listed, "hint": format!("{command} takes: {}", listed.join(", ")) });
    f
}

/// Parses the words after the program name. The `--json` flag is reported even when the rest is
/// refused, so the refusal can be printed in the asked-for shape. `Ok(None)` means help was
/// printed to stdout.
pub fn parse(words: &[String]) -> (bool, Result<Option<Parsed>, Fail>) {
    let mut json = false;
    let mut help = false;
    let mut path: Vec<String> = Vec::new();
    let mut flags: Map<String, Value> = Map::new();
    let mut spots: Vec<(String, usize)> = Vec::new();
    let mut at: Vec<usize> = Vec::new();
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
                        spots.push((name.clone(), i - 1));
                        // CLI-003: a flag no command takes has no value to take, so a typo ahead
                        // of the command words never swallows one of them.
                        let value = if SWITCHES.contains(&name.as_str()) || (inline.is_none() && !known_flag(&name)) {
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
                at.push(i - 1);
            }
        }
        if help || path.is_empty() {
            return Ok(None);
        }
        let joined = path.join(" ");
        let all = commands();
        // A flag no command takes left its would-be value among the words; the first two still
        // name the command it was typed against.
        let lead = path.iter().take(2).cloned().collect::<Vec<_>>().join(" ");
        let stray = flags.keys().any(|k| !known_flag(k));
        let Some(&(joined, command, allowed)) = all.iter().find(|c| c.0 == joined).or_else(|| all.iter().find(|c| stray && c.0 == lead)) else {
            return Err(command_typo(words, &path, &at, &all));
        };
        if command == "worktree.create" && flags.contains_key("parent-workspace") {
            return Err(Fail::args("--parent-workspace was retired; use --parent-worktree <selector>"));
        }
        if let Some(k) = flags.keys().find(|k| !allowed.contains(&k.as_str())) {
            return Err(flag_typo(words, &spots, joined, allowed, k));
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
            for k in ["agent", "prompt", "setup", "parent-worktree"] {
                if empty(k) {
                    return Err(Fail::args(format!("--{k} cannot be empty")));
                }
            }
            if text("issue").is_some_and(|v| v.trim().parse::<u64>().map_or(true, |n| n == 0)) {
                return Err(Fail::args("--issue takes a GitHub issue number"));
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
                    "max-depth" => "maxDepth",
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
                    if !flags.contains_key("dry-run") {
                        need("to", ": name the agent terminal, like term-3")?
                    }
                }
                "orchestration.dispatch-show" => need("task", "")?,
                ABANDON => need("dispatch", ": name the dispatch, like dispatch-2")?,
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
            max_depth(text("max-depth"))?;
        } else if QUERY.iter().any(|(_, c, _)| *c == command) {
            for (k, v) in &flags {
                if v.as_str().is_some_and(|s| s.trim().is_empty()) {
                    return Err(Fail::args(format!("--{k} cannot be empty")));
                }
                args.insert(camel(k), v.clone());
            }
            match command {
                "repo.add" if text("path").is_none() => return Err(Fail::args("--path is required: the folder of a Git repository")),
                "repo.set-base-ref" if text("ref").is_none() => return Err(Fail::args("--ref is required: the branch, tag or commit new worktrees start from")),
                _ => {}
            }
            if text("limit").is_some_and(|v| v.parse::<u64>().map(|n| n == 0).unwrap_or(true)) {
                return Err(Fail::args("--limit takes a number above zero"));
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
/// ORCH-032: `--max-depth` takes whole numbers of 1 or more.
fn max_depth(v: Option<&str>) -> Result<(), Fail> {
    if v.is_some_and(|v| v.trim().parse::<u32>().map_or(true, |n| n == 0)) {
        return Err(Fail::args("--max-depth takes a whole number of 1 or more"));
    }
    Ok(())
}

fn check_worker_start(flags: &Map<String, Value>) -> Result<(), Fail> {
    let text = |k: &str| flags.get(k).and_then(Value::as_str).map(str::trim).filter(|v| !v.is_empty());
    for k in ["task", "spec", "agent", "model", "effort", "terminal", "tier", "name", "worktree", "setup", "timeout-ms"] {
        if flags.contains_key(k) && text(k).is_none() {
            return Err(Fail::args(format!("--{k} cannot be empty")));
        }
    }
    max_depth(flags.get("max-depth").map(|v| v.as_str().unwrap_or_default()))?;
    match (text("task"), text("spec")) {
        (None, None) => return Err(Fail::args("give --task <id> for an existing task or --spec <text> for a new one")),
        (Some(_), Some(_)) => return Err(Fail::args("give one of --task or --spec, not both")),
        _ => {}
    }
    let (agent, terminal, tier) = (text("agent"), text("terminal"), text("tier"));
    if text("effort").is_some() && text("model").is_none() {
        return Err(Fail::args("--effort needs --model"));
    }
    if agent.is_none() && terminal.is_none() && tier.is_none() && text("model").is_none() {
        return Err(Fail::args("say who runs it: --agent <id>, --model <name>, --tier major|deep|build|light, or --terminal <handle>"));
    }
    if let Some(t) = tier {
        if !TIERS.contains(&t) {
            return Err(Fail::args("--tier takes major, deep, build or light"));
        }
        if text("model").is_some() || text("effort").is_some() {
            return Err(Fail::args("a tier picks the model and effort; drop --model and --effort, or drop the tier"));
        }
    }
    if terminal.is_some() && (text("model").is_some() || text("effort").is_some() || tier.is_some()) {
        return Err(Fail::args("a reused terminal keeps its own model: --terminal cannot go with --model, --effort or --tier"));
    }
    let placement = text("worktree").unwrap_or(NEW_TOP);
    if terminal.is_some() && (placement == NEW_TOP || placement == NEW_CHILD) {
        return Err(Fail::args("a reused terminal stays in its worktree: name it with --worktree current or a selector"));
    }
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
        if crate::orchestration::parse_deps(d).is_none() {
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
    if let Some(t) = query_text(command, r) {
        return t;
    }
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
            let how = if s("launch") == "reused_terminal" { ", reused" } else { "" };
            let mut line = format!("worker {}: {} for {} in {} ({}{}){}{how}", s("status"), s("dispatchId"), s("taskId"), r["worktree"]["path"].as_str().unwrap_or_default(), s("agent"), model, term);
            if let Some(h) = r["reveal"].as_str() {
                line.push_str(&format!("\n{h}"));
            }
            line
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
            let mut line = if r["dryRun"] == true && r["to"].is_null() {
                format!("dry run: the opening text for {} ({} is still {}); nothing was handed on", s("taskId"), s("taskId"), s("taskStatus"))
            } else if r["dryRun"] == true {
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
        ABANDON => {
            let term = if s("terminal").is_empty() { "its terminal".to_string() } else { s("terminal") };
            format!("{} abandoned: its worker can no longer report on it; {term} stays open; {} is {}", s("dispatchId"), s("taskId"), s("taskStatus"))
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
        _ if r["branchKept"] == true => format!("removed {}; branch {} kept", s("path"), s("branch")),
        _ => format!("removed {}", s("path")),
    }
}

/// One line per message, its body under it, and the command that answers it (ORCH-006).
/// ORCH-009: each message as a banner: a HIGH or URGENT tag, its kind and id, the sender (agent
/// name and handle), subject, body, payload and the reply command, then its own dividing line.
fn mail_lines(msgs: &[Value], out: &mut Vec<String>) {
    for m in msgs {
        let g = |k: &str| m[k].as_str().unwrap_or_default();
        let tag = match g("priority") {
            "high" => "[HIGH] ",
            "urgent" => "[URGENT] ",
            _ => "",
        };
        let from = match g("fromAgent") {
            "" => g("from").to_string(),
            name => format!("{name} ({})", g("from")),
        };
        out.push(format!("{tag}{} {} from {from}: {}", g("type"), g("id"), g("subject")));
        out.extend(g("body").lines().map(|l| format!("  {l}")));
        if !m["payload"].is_null() {
            out.push(format!("  payload: {}", m["payload"]));
        }
        if !g("reply").is_empty() {
            out.push(format!("  reply: {}", g("reply")));
        }
        out.push("-".repeat(60));
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
                if let Some(h) = f.data["hint"].as_str() {
                    eprintln!("{h}");
                }
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
        let mut args = parsed.args.clone();
        if json && parsed.command == "worktree.ps" {
            // ORCH-040: only a JSON poll may get the short "unchanged" answer; text is always whole.
            args.insert("json".into(), json!(true));
        }
        let req = Request { id: id.clone(), token, command: parsed.command.clone(), cwd, args: Value::Object(args), pane };
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

const REPO_FORMS: &str = "id:<repo-id>, name:<name> or path:<folder>";
const WORKTREE_FORMS: &str = "active, current, id:<repo-id>::<path>, identity:<repo-id>::<path>, name:<name>, branch:<branch>, issue:<number> or path:<folder>";

/// CLI-009: a selector's kind and value. A bare value is refused, never guessed: `42` could be
/// an issue, a name or an id.
fn selector<'a>(s: &'a str, flag: &str, kinds: &[&str], forms: &str) -> Result<(&'a str, &'a str), Fail> {
    match s.trim().split_once(':') {
        Some((k, v)) if kinds.contains(&k) && !v.trim().is_empty() => Ok((k, v.trim())),
        Some(("folder", _)) => Err(Fail::args("folder: selectors need folder workspaces, which are not built yet")),
        _ => Err(Fail { code: "invalid_arguments", message: format!("\"{s}\" is not a selector for --{flag}; it takes {forms}"), data: json!({ "value": s, "accepted": forms }) }),
    }
}

/// The project a call means: `--repo` by id, name or path, else the one whose checkout or
/// worktree the call was made in.
fn pick_project(ctx: &Ctx, repo: Option<&str>, cwd: &str) -> Result<Project, Fail> {
    let store = ctx.store.lock().map_err(|e| e.to_string())?;
    let projects = projects::load_projects(&store);
    if let Some(sel) = repo {
        let (kind, v) = selector(sel, "repo", &["id", "name", "path"], REPO_FORMS)?;
        let mut hits: Vec<&Project> = projects
            .iter()
            .filter(|p| match kind {
                "id" => p.id == v,
                "name" => p.name.eq_ignore_ascii_case(v),
                _ => under(&p.path, v) || projects::list_workspaces(ctx.git, &store, p).map(|ws| ws.iter().any(|w| under(&w.path, v))).unwrap_or(false),
            })
            .collect();
        return match hits.len() {
            0 => Err(Fail::new("not_found", format!("no project matches --repo {sel}"))),
            1 => Ok(hits.remove(0).clone()),
            n => Err(Fail { code: "ambiguous", message: format!("{n} projects match --repo {sel}; use id:"), data: json!({ "ids": hits.iter().map(|p| p.id.clone()).collect::<Vec<_>>() }) }),
        };
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

/// The worktree of `project` the call was made from (the main checkout counts), the innermost
/// when folders nest; None when `cwd` is outside them all.
fn calling_worktree(ctx: &Ctx, project: &Project, cwd: &str) -> Result<Option<String>, Fail> {
    let store = ctx.store.lock().map_err(|e| e.to_string())?;
    let mut inside: Vec<String> = projects::list_workspaces(ctx.git, &store, project)?.into_iter().map(|w| w.path).filter(|p| under(p, cwd)).collect();
    inside.sort_by_key(|p| std::cmp::Reverse(p.len()));
    Ok(inside.into_iter().next())
}

/// The worktree `--worktree` means (CLI-009): `current` and `active` are the innermost one the
/// call was made in; `name:` matches the typed name, the branch or the folder name; `branch:`
/// and `path:` match exactly; `issue:` is the GitHub issue it was made for; `id:` and
/// `identity:` are `<repo-id>::<path>` as the listings print it.
fn pick_worktree(ctx: &Ctx, sel: &str, cwd: &str) -> Result<(Project, Worktree), Fail> {
    pick_in(ctx, sel, cwd, false)
}

/// `parent`: a parent selector, which also takes `worktree:<repo-id>::<path>`.
// ponytail: identity: is the id form until worktrees carry an identity of their own (hosts are local only).
fn pick_in(ctx: &Ctx, sel: &str, cwd: &str, parent: bool) -> Result<(Project, Worktree), Fail> {
    let here = ["current", "active"].contains(&sel.trim());
    let kinds: &[&str] = if parent { &["id", "identity", "worktree", "name", "branch", "issue", "path"] } else { &["id", "identity", "name", "branch", "issue", "path"] };
    let (kind, v) = if here { ("current", cwd) } else { selector(sel, "worktree", kinds, WORKTREE_FORMS)? };
    let store = ctx.store.lock().map_err(|e| e.to_string())?;
    let mut hits: Vec<(Project, Worktree)> = Vec::new();
    for p in projects::load_projects(&store) {
        for w in projects::list_workspaces(ctx.git, &store, &p)? {
            let folder = Path::new(&w.path).file_name().map(|f| f.to_string_lossy().to_string()).unwrap_or_default();
            let same = |x: &str| under(&w.path, x) && under(x, &w.path);
            let ok = match kind {
                "current" => under(&w.path, v),
                "name" => w.name.as_deref() == Some(v) || w.branch.as_deref() == Some(v) || folder == v,
                "branch" => w.branch.as_deref() == Some(v),
                "path" => same(v),
                "issue" => v.parse::<u64>().is_ok_and(|n| projects::origin(&store, &w.path).and_then(|o| o["issue"].as_u64()) == Some(n)),
                _ => v.split_once("::").is_some_and(|(id, path)| id == p.id && same(path)),
            };
            if ok {
                hits.push((p.clone(), w));
            }
        }
    }
    if kind == "current" {
        hits.sort_by_key(|(_, w)| std::cmp::Reverse(w.path.len()));
        hits.truncate(1);
        if hits.is_empty() {
            return Err(Fail { code: "not_found", message: format!("{cwd} is not inside a worktree of any project"), data: json!({ "hint": "run it inside a worktree's folder, or name one with --worktree id:|name:|branch:|path:" }) });
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
            // Lineage: the worktree the call was made from, unless a flag says otherwise.
            let parent = if a["noParent"].as_bool().unwrap_or(false) {
                None
            } else if let Some(sel) = text("parentWorktree") {
                let (owner, w) = pick_in(ctx, &sel, &req.cwd, true)?;
                if owner.id != project.id {
                    return Err(Fail::args(format!("--parent-worktree {sel} is in project {}, not {}", owner.name, project.name)));
                }
                Some(w.path)
            } else {
                calling_worktree(ctx, &project, &req.cwd)?
            };
            let issue = text("issue").and_then(|v| v.parse::<u64>().ok());
            let made = projects::create_named(ctx.git, ctx.store, &project.id, &name, text("baseBranch").as_deref(), None)?;
            // The calling terminal, when the runtime vouches for it; a shell outside Kolux records none.
            let terminal = caller(ctx, req).ok().flatten();
            let pane_key = terminal.as_ref().and(req.pane.as_ref()).map(|p| p.key.clone());
            let origin = json!({ "madeBy": "cli", "parent": parent, "cwd": req.cwd, "issue": issue, "comment": text("comment"), "terminal": terminal, "paneKey": pane_key });
            {
                let store = ctx.store.lock().map_err(|e| e.to_string())?;
                projects::set_origin(&store, &made.worktree.path, Some(&origin))?;
                // PROJ-047: the sidebar nests it under its parent.
                if let Some(p) = &parent {
                    projects::set_parent(&store, &made.worktree.path, Some(p))?;
                }
            }
            let activate = a["activate"].as_bool().unwrap_or(false);
            let mut result = serde_json::to_value(&made).map_err(|e| Fail::new("failed", e.to_string()))?;
            let obj = result.as_object_mut().expect("a workspace is an object");
            obj.insert("projectId".into(), json!(project.id));
            obj.insert("agent".into(), json!(agent));
            obj.insert("activated".into(), json!(activate));
            obj.extend(origin.as_object().expect("an origin is an object").clone());
            // ponytail: setup scripts (PROJ-033) and issue lookups (PROJ-037) are T-107; the
            // values are recorded and echoed, nothing runs on them yet.
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
            // CLI-020: --force forces only the checkout's removal; the branch is kept.
            let keep = a["force"].as_bool().unwrap_or(false) || projects::keeps_branch(&*ctx.store.lock().map_err(|e| e.to_string())?, &w.path);
            projects::remove_worktree(ctx.git, &project, &w.path, true, keep)?;
            {
                let store = ctx.store.lock().map_err(|e| e.to_string())?;
                projects::forget_workspace(&store, &w.path)?;
            }
            (ctx.notify)(json!({ "kind": "removed", "path": w.path }));
            Ok(json!({ "path": w.path, "branch": w.branch, "name": w.name, "projectId": project.id, "branchKept": keep && w.branch.is_some() }))
        }
        WORKER_START => worker_start(ctx, req),
        c if QUERY.iter().any(|(_, w, _)| *w == c) => query(ctx, req),
        c if c.starts_with("orchestration.") => mail(ctx, req),
        other => Err(Fail::args(format!("unknown command {other}"))),
    }
}

// ---------------------------------------------------------------- repos, projects, worktrees (CLI-015..017)

fn repo_row(p: &Project) -> Value {
    json!({ "id": p.id, "selector": format!("id:{}", p.id), "name": p.name, "path": p.path, "baseRef": p.base })
}

/// A worktree as the listings show it: its selector id, lineage both ways, and its repo.
fn worktree_row(p: &Project, w: &Worktree, all: &[Worktree]) -> Value {
    let id = format!("{}::{}", p.id, w.path);
    let children: Vec<&str> = all.iter().filter(|c| c.parent.as_deref().is_some_and(|x| same_dir(x, &w.path))).map(|c| c.path.as_str()).collect();
    json!({ "id": id, "selector": format!("id:{id}"), "repoId": p.id, "repo": p.name, "path": w.path, "name": w.name, "branch": w.branch, "head": w.head, "isMain": w.is_main, "kind": w.kind, "parent": w.parent, "children": children })
}

/// Which hosts a listing looked at, so an empty one is never read as the whole picture.
// ponytail: local only; remote hosts were dropped (CLI-051), so nothing is ever left out.
/// ORCH-040: how long `worktree ps` reuses a repo's scan, and how long it waits on one before it
/// shows the last known worktrees instead.
const SCAN_FRESH: Duration = Duration::from_millis(1500);
const SCAN_SLOW: Duration = Duration::from_secs(3);

/// One repo's latest `git worktree list` for ps, and the last one that worked.
#[derive(Default)]
struct Scan {
    at: Option<Instant>,
    got: Option<Result<Vec<Worktree>, String>>,
    last_ok: Option<Vec<Worktree>>,
    running: bool,
}
static SCANS: Mutex<BTreeMap<String, Scan>> = Mutex::new(BTreeMap::new());
/// The snapshot each terminal's last JSON ps was given, keyed by its pane key.
static POLLS: Mutex<BTreeMap<String, u64>> = Mutex::new(BTreeMap::new());

/// What ps shows for one repo: its worktrees, how they were got, and why they may be stale. A
/// failed or slow scan never comes back empty-handed: the last list that worked is shown.
fn scan(repo: &str) -> (Vec<Worktree>, Value) {
    let key = repo.to_lowercase();
    let read = |s: &Scan, cached: bool| match &s.got {
        Some(Ok(v)) => (v.clone(), json!({ "scan": if cached { "cached" } else { "scanned" }, "cached": cached })),
        Some(Err(e)) => (s.last_ok.clone().unwrap_or_default(), json!({ "scan": "degraded", "cached": cached, "error": e.trim() })),
        None => (Vec::new(), json!({ "scan": "degraded", "cached": cached, "error": "the first scan has not finished" })),
    };
    let slow = |s: &Scan| (s.last_ok.clone().unwrap_or_default(), json!({ "scan": "degraded", "cached": true, "error": "the scan is slow; showing the last known worktrees" }));
    {
        let mut scans = SCANS.lock().unwrap_or_else(|e| e.into_inner());
        let s = scans.entry(key.clone()).or_default();
        if s.running {
            return slow(s);
        }
        if s.at.is_some_and(|t| t.elapsed() < SCAN_FRESH) {
            return read(s, true);
        }
        s.running = true;
    }
    let (tx, rx) = mpsc::channel();
    let (k, path) = (key.clone(), repo.to_string());
    std::thread::spawn(move || {
        let got = crate::git::run(&["worktree", "list", "--porcelain"], Some(Path::new(&path))).map(|t| crate::git::parse_worktrees(&t));
        let mut scans = SCANS.lock().unwrap_or_else(|e| e.into_inner());
        let s = scans.entry(k).or_default();
        if let Ok(v) = &got {
            s.last_ok = Some(v.clone());
        }
        (s.at, s.got, s.running) = (Some(Instant::now()), Some(got), false);
        let _ = tx.send(());
    });
    let done = rx.recv_timeout(SCAN_SLOW).is_ok();
    let scans = SCANS.lock().unwrap_or_else(|e| e.into_inner());
    if done {
        read(&scans[&key], false)
    } else {
        slow(&scans[&key])
    }
}

/// ORCH-040: `worktree ps`, one row per worktree with sessions or open workers, and a scope line.
fn ps(ctx: &Ctx, req: &Request, only: Option<Project>, limit: Option<usize>) -> Result<Value, Fail> {
    let lock = || ctx.store.lock().map_err(|e| Fail::from(e.to_string()));
    let listed = projects::load_projects(&*lock()?);
    let (mut lists, mut repos) = (Vec::new(), Vec::new());
    for p in listed.into_iter().filter(|p| only.as_ref().is_none_or(|o| o.id == p.id)) {
        let (all, mut how) = scan(&p.path);
        let all = projects::decorate(&*lock()?, &p, all)?;
        how["repoId"] = json!(p.id);
        how["name"] = json!(p.name);
        lists.push((p, all, how["scan"] == "degraded"));
        repos.push(how);
    }
    // Each open session goes to the innermost worktree its folder is in.
    let sessions = ctx.terminals.sessions();
    let home = |dir: &str| lists.iter().flat_map(|(_, all, _)| all).filter(|w| under(&w.path, dir)).max_by_key(|w| w.path.len()).map(|w| w.path.clone());
    let homes: Vec<Option<String>> = sessions.iter().map(|(_, dir, _)| home(dir)).collect();
    let dispatches = load_list(&*lock()?, DISPATCHES_KEY);
    let mut rows = Vec::new();
    for (p, all, degraded) in &lists {
        for w in all {
            let here = |h: &Option<String>| h.as_deref() == Some(w.path.as_str());
            let mine: Vec<Value> = sessions.iter().zip(&homes).filter(|(_, h)| here(h)).map(|((handle, _, program), _)| json!({ "terminal": handle, "program": program })).collect();
            let homed = |t: &str| sessions.iter().zip(&homes).any(|((handle, _, _), h)| handle == t && here(h));
            let workers = crate::orchestration::workers_in(&dispatches, &|d| lower(Path::new(d)) == lower(Path::new(&w.path)), &homed);
            if mine.is_empty() && workers.is_empty() {
                continue;
            }
            let mut row = worktree_row(p, w, all);
            row["sessions"] = json!(mine);
            row["workers"] = json!(workers);
            row["degraded"] = json!(degraded);
            rows.push(row);
        }
    }
    let worktrees: usize = lists.iter().map(|(_, all, _)| all.len()).sum();
    let scope = json!({ "repos": repos, "worktrees": worktrees, "shown": rows.len(), "machine": "this computer only", "hosts": hosts() });
    let truncated = limit.is_some_and(|n| rows.len() > n);
    rows.truncate(limit.unwrap_or(usize::MAX));
    let mut out = json!({ "worktrees": rows, "truncated": truncated, "hosts": hosts(), "scope": scope });
    // A terminal polling with --json gets the full snapshot once, then a tiny answer while it holds.
    if let (true, Some(pane)) = (req.args["json"] == true, &req.pane) {
        use std::hash::{Hash, Hasher};
        let mut h = std::collections::hash_map::DefaultHasher::new();
        json!([out["worktrees"], out["truncated"], repos.iter().map(|r| &r["error"]).collect::<Vec<_>>()]).to_string().hash(&mut h);
        let snap = h.finish();
        let seen = POLLS.lock().unwrap_or_else(|e| e.into_inner()).insert(pane.key.clone(), snap);
        if seen == Some(snap) {
            return Ok(json!({ "unchanged": true, "snapshot": format!("{snap:016x}") }));
        }
        out["snapshot"] = json!(format!("{snap:016x}"));
    }
    Ok(out)
}

fn hosts() -> Value {
    json!({ "covered": ["local"], "leftOut": [] })
}

/// The ref a repo's worktrees are measured against: its saved base while that exists, else the
/// default branch. Only reads: unlike a create, nothing is fetched.
fn base_of(ctx: &Ctx, p: &Project) -> Option<String> {
    let repo = Path::new(&p.path);
    p.base.as_deref().map(str::trim).filter(|b| !b.is_empty() && ctx.git.rev_exists(repo, b)).map(String::from).or_else(|| ctx.git.default_branch(repo))
}

fn change_rows(list: &[crate::scm::Change]) -> Vec<Value> {
    list.iter().map(|c| json!({ "path": c.path, "status": c.status })).collect()
}

/// CLI-021: the siblings in the same repo (hidden ones too) whose changes share a file with this
/// worktree's, each with a clash prediction from the committed tips; siblings whose changes could
/// not be read are listed apart, and then the scan is not complete.
fn overlap(ctx: &Ctx, p: &Project, w: &Worktree) -> Result<Value, Fail> {
    let base = base_of(ctx, p);
    let mine: Vec<String> = crate::scm::changes(Path::new(&w.path), base.as_deref())?.into_iter().map(|c| c.path).collect();
    let listed = ctx.git.worktrees(Path::new(&p.path));
    let complete = listed.is_ok();
    let (mut siblings, mut unreadable, mut checked) = (Vec::new(), Vec::new(), 0);
    for s in listed.unwrap_or_default().into_iter().filter(|s| !same_dir(&s.path, &w.path)) {
        let theirs = if Path::new(&s.path).is_dir() { crate::scm::changes(Path::new(&s.path), base.as_deref()) } else { Err("its folder is missing".to_string()) };
        let theirs = match theirs {
            Ok(t) => t,
            Err(why) => {
                unreadable.push(json!({ "path": s.path, "branch": s.branch, "why": why }));
                continue;
            }
        };
        checked += 1;
        // ponytail: a linear scan per sibling; fine for the dozens of files a worktree touches.
        let shared: Vec<String> = theirs.into_iter().map(|c| c.path).filter(|f| mine.contains(f)).collect();
        if shared.is_empty() {
            continue;
        }
        let (clash, conflicts, why) = match crate::scm::clash(Path::new(&p.path), &w.head, &s.head) {
            crate::scm::Clash::Clean => ("clean", Vec::new(), None),
            crate::scm::Clash::Conflict(files) => ("conflict", files, None),
            crate::scm::Clash::Unverifiable(why) => ("unverifiable", Vec::new(), Some(why)),
        };
        siblings.push(json!({ "path": s.path, "branch": s.branch, "files": shared, "clash": clash, "conflicts": conflicts, "why": why }));
    }
    let complete = complete && unreadable.is_empty();
    Ok(json!({ "worktree": w.path, "branch": w.branch, "base": base, "files": mine.len(), "siblings": siblings, "checked": checked, "unreadable": unreadable, "complete": complete, "hosts": hosts() }))
}

fn query(ctx: &Ctx, req: &Request) -> Result<Value, Fail> {
    let a = &req.args;
    let text = |k: &str| a[k].as_str().map(str::trim).filter(|s| !s.is_empty()).map(str::to_string);
    let limit = text("limit").and_then(|l| l.parse::<usize>().ok());
    let lock = || ctx.store.lock().map_err(|e| Fail::from(e.to_string()));
    match req.command.as_str() {
        "repo.list" | "project.list" => {
            let rows: Vec<Value> = projects::load_projects(&*lock()?).iter().map(repo_row).collect();
            Ok(if req.command == "repo.list" { json!({ "repos": rows }) } else { json!({ "projects": rows }) })
        }
        "repo.add" => {
            let path = text("path").ok_or_else(|| Fail::args("--path is required"))?;
            let p = projects::add_project(ctx.git, &*lock()?, &Path::new(&req.cwd).join(path))?;
            (ctx.notify)(json!({ "kind": "repo", "projectId": p.id }));
            Ok(repo_row(&p))
        }
        "repo.show" => {
            let p = pick_project(ctx, text("repo").as_deref(), &req.cwd)?;
            let count = projects::list_workspaces(ctx.git, &*lock()?, &p)?.len();
            let mut row = repo_row(&p);
            row["base"] = json!(base_of(ctx, &p));
            row["worktrees"] = json!(count);
            Ok(row)
        }
        "repo.set-base-ref" => {
            let r = text("ref").ok_or_else(|| Fail::args("--ref is required"))?;
            let p = pick_project(ctx, text("repo").as_deref(), &req.cwd)?;
            if !ctx.git.base_available(Path::new(&p.path), &r) {
                return Err(Fail::new("not_found", format!("{r} is not a branch, tag or commit in {}", p.name)));
            }
            let p = projects::set_base(&*lock()?, &p.id, Some(&r))?;
            (ctx.notify)(json!({ "kind": "repo", "projectId": p.id }));
            Ok(repo_row(&p))
        }
        "repo.search-refs" => {
            let p = pick_project(ctx, text("repo").as_deref(), &req.cwd)?;
            let q = text("query").unwrap_or_default().to_lowercase();
            let out = crate::git::run(&["for-each-ref", "--format=%(refname)", "refs/heads", "refs/remotes", "refs/tags"], Some(Path::new(&p.path)))?;
            let refs: Vec<Value> = out
                .lines()
                .filter_map(|full| {
                    let (kind, name) = [("branch", "refs/heads/"), ("remote", "refs/remotes/"), ("tag", "refs/tags/")].into_iter().find_map(|(k, pre)| full.strip_prefix(pre).map(|n| (k, n)))?;
                    (!name.ends_with("/HEAD") && name.to_lowercase().contains(&q)).then(|| json!({ "name": name, "kind": kind }))
                })
                .take(limit.unwrap_or(20))
                .collect();
            Ok(json!({ "repoId": p.id, "refs": refs }))
        }
        "worktree.ps" => ps(ctx, req, text("repo").map(|r| pick_project(ctx, Some(&r), &req.cwd)).transpose()?, limit),
        "worktree.list" => {
            let only = text("repo").map(|r| pick_project(ctx, Some(&r), &req.cwd)).transpose()?;
            let mut lists = Vec::new();
            {
                let store = lock()?;
                for p in projects::load_projects(&store).into_iter().filter(|p| only.as_ref().is_none_or(|o| o.id == p.id)) {
                    let all = projects::list_workspaces(ctx.git, &store, &p)?;
                    lists.push((p, all));
                }
            }
            let mut rows: Vec<Value> = lists.iter().flat_map(|(p, all)| all.iter().map(move |w| worktree_row(p, w, all))).collect();
            let truncated = limit.is_some_and(|n| rows.len() > n);
            rows.truncate(limit.unwrap_or(usize::MAX));
            Ok(json!({ "worktrees": rows, "truncated": truncated, "hosts": hosts() }))
        }
        "worktree.changes" | "worktree.overlap" => {
            let (p, w) = pick_worktree(ctx, &text("worktree").unwrap_or_else(|| "current".into()), &req.cwd)?;
            if req.command == "worktree.overlap" {
                return overlap(ctx, &p, &w);
            }
            let base = base_of(ctx, &p);
            let files = crate::scm::changes(Path::new(&w.path), base.as_deref())?;
            Ok(json!({ "worktree": w.path, "branch": w.branch, "base": base, "files": change_rows(&files) }))
        }
        "worktree.show" | "worktree.current" => {
            let sel = if req.command == "worktree.current" { "current".to_string() } else { text("worktree").unwrap_or_else(|| "current".into()) };
            let (p, w) = pick_worktree(ctx, &sel, &req.cwd)?;
            let all = projects::list_workspaces(ctx.git, &*lock()?, &p)?;
            Ok(worktree_row(&p, &w, &all))
        }
        other => Err(Fail::args(format!("unknown command {other}"))),
    }
}

/// The text of the lookups above, one line per row.
fn query_text(command: &str, r: &Value) -> Option<String> {
    let s = |v: &Value, k: &str| v[k].as_str().unwrap_or_default().to_string();
    let repo = |v: &Value| format!("{}  {}  ({}{})", s(v, "name"), s(v, "path"), s(v, "selector"), v["baseRef"].as_str().map(|b| format!(", base {b}")).unwrap_or_default());
    let label = |v: &Value| v["name"].as_str().or(v["branch"].as_str()).unwrap_or("(detached)").to_string();
    let rows = |k: &str| r[k].as_array().cloned().unwrap_or_default();
    Some(match command {
        "repo.list" | "project.list" => {
            let list = rows(if command == "repo.list" { "repos" } else { "projects" });
            if list.is_empty() {
                "no repos yet; add one with kolux-dev repo add --path <folder>".into()
            } else {
                list.iter().map(repo).collect::<Vec<_>>().join("\n")
            }
        }
        "repo.add" => format!("added {}", repo(r)),
        "repo.set-base-ref" => format!("{}: new worktrees start from {}", s(r, "name"), s(r, "baseRef")),
        "repo.show" => format!("{}\nbase {}; {} worktree(s)", repo(r), r["base"].as_str().unwrap_or("none found"), r["worktrees"]),
        "repo.search-refs" => {
            let list = rows("refs");
            if list.is_empty() {
                "no refs match".into()
            } else {
                list.iter().map(|x| format!("{:<7} {}", s(x, "kind"), s(x, "name"))).collect::<Vec<_>>().join("\n")
            }
        }
        "worktree.list" | "worktree.ps" => {
            let mut out: Vec<String> = rows("worktrees")
                .iter()
                .map(|w| {
                    let mut line = format!("{}  [{}]  {}  ({}){}", label(w), w["branch"].as_str().unwrap_or("detached"), s(w, "path"), s(w, "selector"), if w["degraded"] == true { "  [last known]" } else { "" });
                    for x in w["workers"].as_array().into_iter().flatten() {
                        line.push_str(&format!("\n    worker {} on {} · {}{}", s(x, "dispatchId"), s(x, "taskId"), s(x, "status"), x["terminal"].as_str().map(|t| format!(" ({t})")).unwrap_or_default()));
                    }
                    if let Some(list) = w["sessions"].as_array().filter(|l| !l.is_empty()) {
                        line.push_str(&format!("\n    {}", list.iter().map(|x| format!("{} {}", s(x, "terminal"), x["program"].as_str().unwrap_or("shell"))).collect::<Vec<_>>().join(", ")));
                    }
                    line
                })
                .collect();
            if out.is_empty() {
                out.push(if command == "worktree.ps" { "no sessions or workers are running".into() } else { "no worktrees".into() });
            }
            if r["truncated"] == true {
                out.push("(more rows; raise --limit)".into());
            }
            if r["unchanged"] == true {
                return Some(format!("no change since this terminal's last ps (snapshot {})", s(r, "snapshot")));
            }
            if let Some(scope) = r.get("scope") {
                let repos = scope["repos"].as_array().cloned().unwrap_or_default();
                let n = |v: &Value| v.as_u64().unwrap_or(0);
                let mut line = format!("scope: {} repo{}, {} worktrees, {} with work", repos.len(), if repos.len() == 1 { "" } else { "s" }, n(&scope["worktrees"]), n(&scope["shown"]));
                for x in repos.iter().filter(|x| x["scan"] == "degraded") {
                    line.push_str(&format!("; {}: last known list ({})", s(x, "name"), s(x, "error")));
                }
                out.push(line + "; this computer only");
            }
            out.push("hosts covered: local; none left out".into());
            out.join("\n")
        }
        "worktree.changes" => {
            let mut out = vec![match r["base"].as_str() {
                Some(b) => format!("{} against {b}:", s(r, "worktree")),
                None => format!("{}: no base branch found, so only uncommitted work is shown:", s(r, "worktree")),
            }];
            let list = rows("files");
            out.extend(list.iter().map(|f| format!("  {} {}", s(f, "status"), s(f, "path"))));
            if list.is_empty() {
                out.push("  nothing changed".into());
            }
            out.join("\n")
        }
        "worktree.overlap" => {
            let mut out = vec![format!("{} touches {} file(s) against {}", s(r, "worktree"), r["files"], r["base"].as_str().unwrap_or("no base"))];
            for sib in rows("siblings") {
                let clash = match sib["clash"].as_str().unwrap_or_default() {
                    "clean" => "committed work merges cleanly".to_string(),
                    "conflict" => format!("committed work would conflict in {}", sib["conflicts"].as_array().map(|c| c.iter().filter_map(Value::as_str).collect::<Vec<_>>().join(", ")).unwrap_or_default()),
                    _ => format!("merge unverifiable: {}", sib["why"].as_str().unwrap_or("git could not check it")),
                };
                let files: Vec<String> = sib["files"].as_array().map(|f| f.iter().filter_map(Value::as_str).map(String::from).collect()).unwrap_or_default();
                out.push(format!("  {} [{}] also touches {}; {clash}", s(&sib, "path"), sib["branch"].as_str().unwrap_or("detached"), files.join(", ")));
            }
            for u in rows("unreadable") {
                out.push(format!("  could not read the changes of {}: {}", s(&u, "path"), s(&u, "why")));
            }
            if rows("siblings").is_empty() {
                out.push(if r["complete"] == true { "  no other worktree touches these files".into() } else { "  could not verify that no other worktree touches these files".into() });
            } else if r["complete"] != true {
                out.push("  the scan was incomplete; other overlaps may be missing".into());
            }
            out.join("\n")
        }
        "worktree.show" | "worktree.current" => {
            let mut out = vec![format!("{}  [{}]  {}", label(r), r["branch"].as_str().unwrap_or("detached"), s(r, "path")), format!("selector {}", s(r, "selector"))];
            if let Some(p) = r["parent"].as_str() {
                out.push(format!("parent {p}"));
            }
            for c in rows("children") {
                out.push(format!("child {}", c.as_str().unwrap_or_default()));
            }
            out.join("\n")
        }
        _ => return None,
    })
}

// ---------------------------------------------------------------- mail (ORCH-001..005)

fn now_ms() -> u64 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0)
}

/// The pane a call came from, when the runtime can vouch for it.
fn caller(ctx: &Ctx, req: &Request) -> Result<Option<String>, Fail> {
    let pane = req.pane.as_ref().map(|p| (p.handle.as_str(), p.key.as_str()));
    crate::orchestration::caller_of(req.args["from"].as_str(), pane, &|k| ctx.terminals.by_key(k))
}

fn unbound() -> Fail {
    Fail { code: "unbound_caller", message: "who is calling cannot be told: this needs the identity of a Kolux terminal, so run it inside one".into(), data: json!({ "hint": "a shell Kolux did not start has no KOLUX_TERMINAL_HANDLE and KOLUX_PANE_KEY" }) }
}

/// Runs, sends and checks. Everything that ties, sends or reads needs a pane the runtime knows;
/// a shell outside Kolux is turned away rather than tied to a guess (ORCH-001).
fn mail(ctx: &Ctx, req: &Request) -> Result<Value, Fail> {
    use crate::orchestration::{Mail, Mode};
    let a = &req.args;
    let text = |k: &str| a[k].as_str().map(str::trim).filter(|s| !s.is_empty()).map(str::to_string);
    let pane = caller(ctx, req)?;
    let need = || pane.clone().ok_or_else(unbound);
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
            let peers = peers(ctx);
            m.once(retry, |m| m.post(&p, a, &dispatches, &peers, now_ms()))?
        }
        CHECK => {
            let p = need()?;
            let dispatches = load_list(&store, DISPATCHES_KEY);
            let (reader, boxes) = match (text("terminal"), text("run")) {
                (Some(t), _) => {
                    seen_from(&m, &p, &t, &dispatches)?;
                    (t.clone(), m.boxes_of(&t, &dispatches))
                }
                (None, Some(r)) => {
                    m.run_show(&r)?;
                    in_run(&m, &p, &r, &dispatches)?;
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
            let dispatches = load_list(&store, DISPATCHES_KEY);
            let (boxes, mine) = (m.boxes_of(&p, &dispatches), m.run_of(&p, &dispatches));
            m.once(retry, |m| m.reply(&p, &id, &body, run.as_deref(), &boxes, mine.as_deref(), now_ms()))?
        }
        "orchestration.inbox" => {
            let p = need()?;
            let dispatches = load_list(&store, DISPATCHES_KEY);
            let reader = match text("terminal") {
                Some(t) => {
                    seen_from(&m, &p, &t, &dispatches)?;
                    t
                }
                None => p,
            };
            let boxes = m.boxes_of(&reader, &dispatches);
            m.inbox(&reader, &boxes, text("limit").and_then(|l| l.parse().ok()).unwrap_or(20).min(200), a["full"] == true)
        }
        "orchestration.task-create" | "orchestration.task-list" | "orchestration.dispatch" | "orchestration.dispatch-show" | ABANDON => tasks(ctx, &store, &mut m, req, pane.as_deref(), retry)?,
        other => return Err(Fail::args(format!("unknown command {other}"))),
    };
    m.save(&store)?;
    Ok(out)
}

/// ORCH-033: a pane reads another pane's mail only when both act in the same Run; any other
/// terminal reads as one that is not there.
fn seen_from(m: &crate::orchestration::Mail, me: &str, other: &str, dispatches: &[Value]) -> Result<(), Fail> {
    let mine = m.run_of(me, dispatches);
    if other == me || (mine.is_some() && m.run_of(other, dispatches) == mine) {
        return Ok(());
    }
    Err(Fail::new("not_found", format!("no open Kolux terminal is called {other}")))
}

/// ORCH-033: reading a Run's mail, and any change in a Run, needs the pane to act in that Run.
fn in_run(m: &crate::orchestration::Mail, me: &str, run: &str, dispatches: &[Value]) -> Result<(), Fail> {
    if m.run_of(me, dispatches).as_deref() == Some(run) {
        return Ok(());
    }
    Err(Fail::new("not_bound", format!("this terminal is not in {run}; read its summary with {} orchestration run-show --id {run}", crate::orchestration::CLI)))
}

/// ORCH-032: the cap a call asks for (`--max-depth`) and the configured one (`orchestrationMaxDepth`
/// in settings, whole numbers of 1 or more).
fn caps(store: &Store, a: &Value) -> (Option<u32>, Option<u32>) {
    let asked = a["maxDepth"].as_str().and_then(|v| v.trim().parse().ok()).or(a["maxDepth"].as_u64().map(|n| n as u32)).filter(|n| *n >= 1);
    let configured = store.settings()["orchestrationMaxDepth"].as_u64().filter(|n| *n >= 1).map(|n| n as u32);
    (asked, configured)
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
    let mut tasks = load_list(store, TASKS_KEY);
    o::promote(&mut tasks);
    let mut dispatches = load_list(store, DISPATCHES_KEY);
    // ORCH-033: a pane acts in its own Run; another Run can be named to read it, never to change it.
    let own = pane.and_then(|p| m.run_of(p, &dispatches));
    let run = named.clone().or_else(|| own.clone());
    let caps = caps(store, a);
    let changes = req.command != "orchestration.task-list" && req.command != "orchestration.dispatch-show" && a["dryRun"] != true;
    if let (true, Some(n), Some(p)) = (changes, &named, pane) {
        in_run(m, p, n, &dispatches)?;
    }
    let out = match req.command.as_str() {
        "orchestration.task-create" => {
            // CLI-034: the creator is the calling terminal; with none known the command fails closed.
            let me = pane.ok_or_else(unbound)?.to_string();
            m.once(retry, |_| {
                let mut t = o::task_create(&mut tasks, a, run.clone(), now_ms())?;
                t["createdBy"] = json!(me);
                if let Some(last) = tasks.last_mut() {
                    last["createdBy"] = json!(me);
                }
                Ok(t)
            })?
        }
        "orchestration.task-list" => o::task_list(&tasks, &dispatches, run.as_deref(), a, &|h| ctx.terminals.live(h))?,
        "orchestration.dispatch" => {
            let task = text("task").ok_or_else(|| Fail::args("--task is required"))?;
            // CLI-034: a dry run needs no recipient; it only shows the opening text.
            let to = text("to");
            let (i, agent, tid) = match &to {
                Some(to) => {
                    let tid = to.strip_prefix("term-").and_then(|n| n.parse::<u32>().ok()).filter(|_| ctx.terminals.live(to)).ok_or_else(|| Fail::new("not_found", format!("no open Kolux terminal is called {to}")))?;
                    // ORCH-032: handing work on from a worker counts as a level of nesting, except a
                    // context-only dispatch to the worker's own pane while budget remains.
                    let nested = o::nest(pane, &dispatches, caps.0, caps.1);
                    let own_ok = a["inject"] != true && nested.is_ok();
                    if Some(to.as_str()) != pane || a["inject"] == true {
                        nested.clone()?;
                    }
                    let (i, agent) = o::dispatch_check(&tasks, &dispatches, &task, to, pane, run.as_deref(), own_ok, &|h| pane_agent(ctx, h))?;
                    (i, Some(agent), Some(tid))
                }
                None if a["dryRun"] == true => (o::task_in(&tasks, &task, run.as_deref())?, None, None),
                None => return Err(Fail::args("--to is required")),
            };
            let (depth, cap) = o::nest(pane, &dispatches, caps.0, caps.1).unwrap_or((1, caps.0.or(caps.1).unwrap_or(o::DEFAULT_MAX_DEPTH)));
            let id = next_id(&dispatches, "dispatch-");
            let run = tasks[i]["runId"].as_str().map(str::to_string).or(run);
            let behind = to.as_deref().and_then(|t| ctx.terminals.dir_of(t)).and_then(|d| {
                let p = projects::load_projects(store).into_iter().find(|p| projects::list_workspaces(ctx.git, store, p).is_ok_and(|ws| ws.iter().any(|w| same_dir(&w.path, &d))))?;
                drift(ctx.git, &p, &d)
            });
            let brief = o::brief(&tasks[i], &o::Brief { dispatch: &id, run: run.as_deref(), coordinator: pane, behind, levels_left: cap.saturating_sub(depth) });
            let mode = if a["inject"] == true { "inject" } else { "context" };
            let mut plan = json!({ "dispatchId": id, "taskId": task, "to": to, "agent": agent, "runId": run, "mode": mode });
            if a["returnPreamble"] == true || a["dryRun"] == true {
                plan["preamble"] = json!(brief);
            }
            if a["dryRun"] == true {
                plan["dryRun"] = json!(true);
                plan["taskStatus"] = tasks[i]["status"].clone();
                return Ok(plan);
            }
            m.once(retry, |_| {
                if let (Some(tid), "inject") = (tid, mode) {
                    type_brief(ctx.terminals, tid, &brief)?;
                }
                dispatches.push(json!({ "id": id, "runtime": std::process::id(), "runId": run, "taskId": task, "status": "running", "terminal": tid, "agent": agent, "mode": mode, "depth": depth, "maxDepth": cap, "brief": brief, "created": now_ms() }));
                tasks[i]["status"] = json!("dispatched");
                tasks[i]["dispatchId"] = json!(id);
                Ok(plan.clone())
            })?
        }
        "orchestration.dispatch-show" => {
            let task = text("task").ok_or_else(|| Fail::args("--task is required"))?;
            let mut v = dispatches.iter().rev().find(|d| d["taskId"] == task && d["runId"].as_str() == run.as_deref()).cloned().ok_or_else(|| Fail::new("not_found", format!("{task} has not been dispatched")))?;
            let brief = v.as_object_mut().and_then(|o| o.remove("brief"));
            v["handle"] = json!(v["terminal"].as_u64().map(|t| crate::terminal::handle_of(t as u32)));
            if a["preamble"] == true {
                v["preamble"] = brief.unwrap_or_default();
            }
            v
        }
        ABANDON => {
            let id = text("dispatch").ok_or_else(|| Fail::args("--dispatch is required"))?;
            m.once(retry, |_| o::abandon(&mut tasks, &mut dispatches, &id, run.as_deref(), now_ms()))?
        }
        other => return Err(Fail::args(format!("unknown command {other}"))),
    };
    save_list(store, TASKS_KEY, &tasks)?;
    save_list(store, DISPATCHES_KEY, &dispatches)?;
    Ok(out)
}

/// ORCH-013: the agent Kolux started in pane `h`, once it is up; a shell, or a program Kolux does
/// not know, is none.
/// ORCH-004: every open terminal with the agent Kolux started in it (none for a shell; a pane title
/// plays no part) and whether it has been quiet for `IDLE`.
fn peers(ctx: &Ctx) -> Vec<crate::orchestration::Peer> {
    let credited = |p: &str| match p.starts_with('"') {
        true => crate::agents::credited_agent(p),
        false => crate::agents::credited_agent(&format!("\"{p}\"")),
    };
    ctx.terminals
        .sessions()
        .into_iter()
        .map(|(handle, dir, program)| {
            let agent = program.as_deref().filter(|p| !p.trim().is_empty()).and_then(credited).map(str::to_string);
            let idle = ctx.terminals.program_of(&handle, IDLE).is_some();
            crate::orchestration::Peer { handle, agent, idle, dir }
        })
        .collect()
}

/// The agent Kolux started in the calling pane. Unlike `pane_agent` it does not wait for the pane
/// to go quiet: the caller is busy echoing and running this very command.
fn own_agent(ctx: &Ctx, h: &str) -> Option<String> {
    peers(ctx).into_iter().find(|p| p.handle == h).and_then(|p| p.agent)
}

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
/// ORCH-004: an agent that has written nothing for this long counts as idle for @idle.
// ponytail: output quiet stands in for the idle detector of the STAT status cards.
const IDLE: Duration = Duration::from_secs(3);
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
/// ORCH-016 / CLI-035: an open terminal in the named worktree, running the coordinator's own agent,
/// takes the task instead of a new one; the brief is typed in as `dispatch --inject` would type it.
/// Everything that can turn the start away is checked before a task is made.
fn reuse(ctx: &Ctx, req: &Request, to: &str) -> Result<Value, Fail> {
    let a = &req.args;
    let text = |k: &str| a[k].as_str().map(str::trim).filter(|s| !s.is_empty()).map(str::to_string);
    let tid = to.strip_prefix("term-").and_then(|n| n.parse::<u32>().ok()).filter(|_| ctx.terminals.live(to)).ok_or_else(|| Fail::new("not_found", format!("no open Kolux terminal is called {to}")))?;
    let (_, w) = pick_worktree(ctx, &text("worktree").unwrap_or_else(|| "current".into()), &req.cwd)?;
    if !ctx.terminals.dir_of(to).is_some_and(|d| same_dir(&d, &w.path)) {
        return Err(Fail::new("wrong_worktree", format!("{to} is not running in {}", w.path)));
    }
    let theirs = pane_agent(ctx, to).ok_or_else(|| Fail::new("not_an_agent", format!("{to} is not running an agent Kolux recognises, or the agent has not finished starting")))?;
    let mine = caller(ctx, req)?.and_then(|h| own_agent(ctx, &h));
    if let Some(other) = [text("agent"), mine].into_iter().flatten().find(|m| *m != theirs) {
        return Err(Fail::new("agent_mismatch", format!("{to} runs {theirs}; a worker runs the coordinator's own agent ({other})")));
    }
    let sub = |command: &str, mut args: Value| {
        for k in ["run", "from", "retryRequest", "maxDepth"] {
            if !a[k].is_null() {
                args[k] = a[k].clone();
            }
        }
        Request { command: command.into(), args, ..req.clone() }
    };
    let task = match text("task") {
        Some(t) => t,
        None => {
            let mut make = json!({ "spec": a["spec"] });
            for k in ["taskTitle", "displayName", "deps", "parent"] {
                if !a[k].is_null() {
                    make[k] = a[k].clone();
                }
            }
            mail(ctx, &sub("orchestration.task-create", make))?["id"].as_str().unwrap_or_default().to_string()
        }
    };
    let plan = mail(ctx, &sub("orchestration.dispatch", json!({ "task": task, "to": to, "inject": true }))).map_err(|mut e| {
        if text("task").is_none() {
            e.message = format!("{}; {task} was made: hand it on with {} orchestration dispatch --task {task} --to <handle> --inject", e.message, crate::orchestration::CLI);
        }
        e
    })?;
    Ok(json!({
        "dispatchId": plan["dispatchId"], "taskId": task, "status": "ready", "stage": "worker", "launch": "reused_terminal",
        "agent": theirs, "runId": plan["runId"], "worktree": { "path": w.path, "branch": w.branch, "name": w.name },
        "terminals": [{ "id": tid, "role": "worker" }],
    }))
}

fn worker_start(ctx: &Ctx, req: &Request) -> Result<Value, Fail> {
    let a = &req.args;
    let text = |k: &str| a[k].as_str().map(str::trim).filter(|s| !s.is_empty()).map(str::to_string);
    if let Some(to) = text("terminal") {
        return reuse(ctx, req, &to);
    }
    let default = {
        let store = ctx.store.lock().map_err(|e| e.to_string())?;
        store.settings()["defaultAgent"].as_str().filter(|s| !s.is_empty()).unwrap_or("claude").to_string()
    };
    let coordinator = caller(ctx, req).ok().flatten();
    // ORCH-032: a worker may start another only inside the nesting cap; ORCH-033: in its own Run.
    let (depth, cap, run_id) = {
        let store = ctx.store.lock().map_err(|e| e.to_string())?;
        let dispatches = load_list(&store, DISPATCHES_KEY);
        let (asked, configured) = caps(&store, a);
        let (depth, cap) = crate::orchestration::nest(coordinator.as_deref(), &dispatches, asked, configured)?;
        (depth, cap, coordinator.as_deref().and_then(|p| crate::orchestration::Mail::load(&store).run_of(p, &dispatches)))
    };
    let tier = text("tier");
    // ORCH-018: a tier runs on the coordinator's own agent, when Kolux started one in its pane.
    let agent_id = match &tier {
        Some(_) => crate::orchestration::tier_agent(text("agent").as_deref(), coordinator.as_deref().and_then(|h| own_agent(ctx, h)).as_deref(), &default)?,
        // ORCH-019: with no tier the worker takes the coordinator's own agent unless one is named.
        None => text("agent").or_else(|| coordinator.as_deref().and_then(|h| own_agent(ctx, h))).unwrap_or(default),
    };
    if let (None, Some(m)) = (&tier, text("model")) {
        crate::routing::model_fits(&agent_id, &m).map_err(Fail::args)?;
    }
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
                let i = crate::orchestration::task_in(&tasks, &id, run_id.as_deref())?;
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
                let deps: Vec<String> = text("deps").and_then(|d| crate::orchestration::parse_deps(&d)).unwrap_or_default();
                let created = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0);
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
            Some(name) => projects::create_named(ctx.git, ctx.store, &project.id, &name, text("baseBranch").as_deref(), None)?.worktree,
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
    let behind = drift(ctx.git, &project, &worktree.path);
    let brief = crate::orchestration::brief(&task, &crate::orchestration::Brief { dispatch: &dispatch_id, run: run_id.as_deref(), coordinator: coordinator.as_deref(), behind, levels_left: cap - depth });

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
        "launch": "new_terminal",
        "hint": format!("{} worktree rm --worktree path:{} --force removes the worktree, its worker and all", crate::orchestration::CLI, worktree.path),
        // CLI-035: the worker runs in a background tab; this is where to find it.
        "reveal": format!("open {} under {} in the Kolux sidebar to see the worker", worktree.name.clone().or(worktree.branch.clone()).unwrap_or_else(|| worktree.path.clone()), project.name),
    });
    {
        let store = ctx.store.lock().map_err(|e| e.to_string())?;
        let mut dispatches = load_list(&store, DISPATCHES_KEY);
        dispatches.push(json!({ "id": dispatch_id, "runtime": std::process::id(), "runId": run_id, "taskId": task_id, "status": status, "worktree": worktree.path, "agent": agent_id, "model": model, "effort": effort, "tier": tier, "terminal": terminal, "depth": depth, "maxDepth": cap, "brief": brief, "created": since.elapsed().as_millis() as u64 }));
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
    fn cli003_typos_get_safe_suggestions_before_the_app_is_asked() {
        let fail = |s: &str| parse(&words(s)).1.unwrap_err();
        // A wrong group: the nearest group, and the full path when the verb fits it.
        let f = fail("worktre list");
        assert!(f.message.contains("`worktre`") && f.message.contains("worktree list"), "{}", f.message);
        assert_eq!(f.data["nextSteps"], json!(["kolux-dev worktree list"]));
        assert_eq!(f.data["unknown"], "worktre");
        // A wrong verb: rm only from one edit away; a harmless typo never lands on it.
        assert!(fail("worktree rmm --worktree name:x").message.contains("did you mean worktree rm?"));
        let lst = fail("worktree lst");
        assert!(lst.message.contains("worktree list") && !lst.message.contains(" rm"), "{}", lst.message);
        assert!(!fail("worktree rmx2").message.contains("rm?"), "two edits from rm");
        assert!(fail("worktree delet --worktree name:x").message.contains("worktree delete"), "aliases are suggested too");
        // A wrong flag: the nearest flag of that command, and the list of its flags.
        let flag = fail("worktree show --worktre name:x");
        assert!(flag.message.contains("unknown flag --worktre for worktree show") && flag.message.contains("did you mean --worktree?"), "{}", flag.message);
        assert_eq!(flag.data["flags"], json!(["--worktree", "--json"]));
        assert!(flag.data["hint"].as_str().unwrap().contains("--worktree"));
        assert_eq!(flag.data["nextSteps"], json!(["kolux-dev worktree show --worktree name:x"]));
        let long = fail(&format!("worktree list --{}", "x".repeat(40)));
        assert_eq!(long.data["suggestions"], json!([]));
        assert_eq!(long.data["flags"], json!(["--repo", "--limit", "--json"]));
        // The renamed caller flag is pointed at --terminal, and only on check.
        let renamed = fail("orchestration check --from term-1");
        assert!(renamed.message.contains("--terminal") && renamed.message.contains("renamed"), "{}", renamed.message);
        assert!(!fail("orchestration inbox --from term-1").message.contains("renamed"));
        // A wrong flag ahead of the group is reported against the full path, and the call ends there.
        let (json, r) = parse(&words("--jso worktree --json list"));
        assert!(json);
        let f = r.unwrap_err();
        assert!(f.message.contains("--jso") && f.message.contains("worktree list"), "{}", f.message);
        assert_eq!(f.data["command"], "worktree list");
        assert_eq!(main(words("--jso worktree --json list")), 1);
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
        assert!(refused("worktree create --name x --parent-workspace name:a").contains("retired"));
        assert!(refused("worktree create --name x --parent-worktree").contains("needs a value"));
        assert!(refused("worktree create --name x --parent-worktree=").contains("empty"));
        assert!(refused("worktree create --name x --issue abc").contains("issue number"));
        assert!(refused("worktree create --name x --issue 0").contains("issue number"));
        assert_eq!(parse(&words("worktree create --name x --issue 12 --no-parent")).1.unwrap().unwrap().args["noParent"], true);
        assert!(refused("worktree rm").contains("--worktree"));
        assert!(refused("worktree frobnicate").contains("unknown command"));
        assert!(parse(&words("--help")).1.unwrap().is_none());
        assert!(parse(&words("help worktree")).1.unwrap().is_none());
    }

    #[test]
    fn tasks_need_a_known_creator_and_a_dry_run_needs_no_recipient() {
        let dir = std::env::temp_dir().join(format!("kolux-rs-dry-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        let git_ = Git::detect().unwrap();
        let store = Mutex::new(Store::open(&dir.join("data")).unwrap());
        let notify = |_: Value| {};
        let terminals = Terminals::default();
        let ctx = Ctx { claude_config: dir.join(".claude.json"), git: &git_, store: &store, terminals: &terminals, notify: &notify };
        let req = |command: &str, args: Value| Request { id: "r".into(), token: String::new(), command: command.into(), cwd: dir.display().to_string(), args, pane: None };
        // CLI-034: outside any Kolux terminal there is no creator, so nothing is made.
        let orphan = dispatch(&ctx, &req("orchestration.task-create", json!({ "spec": "add a test" }))).unwrap_err();
        assert_eq!(orphan.code, "unbound_caller");
        save_list(&store.lock().unwrap(), TASKS_KEY, &[json!({ "id": "task-1", "spec": "add a test", "status": "ready", "deps": [] })]).unwrap();
        let plan = dispatch(&ctx, &req("orchestration.dispatch", json!({ "task": "task-1", "dryRun": true }))).unwrap();
        assert_eq!(plan["dryRun"], true);
        assert!(plan["preamble"].as_str().unwrap().ends_with("add a test"), "{}", plan["preamble"]);
        assert_eq!(plan["to"], Value::Null);
        let list = dispatch(&ctx, &req("orchestration.task-list", json!({}))).unwrap();
        assert_eq!(list["tasks"][0]["status"], "ready");
        assert!(load_list(&store.lock().unwrap(), DISPATCHES_KEY).is_empty());
        // CLI-035: reusing a terminal that is not open is refused before any task is made.
        let gone = dispatch(&ctx, &req("orchestration.worker-start", json!({ "spec": "x", "terminal": "term-9", "worktree": "current" }))).unwrap_err();
        assert_eq!(gone.code, "not_found", "{}", gone.message);
        assert_eq!(load_list(&store.lock().unwrap(), TASKS_KEY).len(), 1);
        drop(ctx);
        let _ = std::fs::remove_dir_all(&dir);
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
        // ORCH-032, ORCH-023: the nesting cap takes whole numbers of 1 or more; abandon names a dispatch.
        assert!(refused("orchestration dispatch --task task-1 --to term-3 --max-depth 0").contains("--max-depth"));
        assert!(refused("orchestration worker-start --spec x --agent claude --max-depth two").contains("--max-depth"));
        assert!(refused("orchestration worker-abandon").contains("--dispatch"));
        let (_, p) = parse(&words("orchestration worker-abandon --dispatch dispatch-2"));
        assert_eq!(p.unwrap().unwrap().args["dispatch"], "dispatch-2");
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
        // ORCH-019: a model alone says who runs it, on the coordinator's own agent.
        let (_, p) = parse(&words("orchestration worker-start --spec x --model opus --effort high"));
        assert_eq!(p.unwrap().unwrap().args["model"], "opus");
        let refused = |s: &str| parse(&words(s)).1.unwrap_err().message;
        assert!(refused("orchestration worker-start --agent claude").contains("--spec"));
        assert!(refused("orchestration worker-start --task t --spec x --agent claude").contains("one of"));
        assert!(refused("orchestration worker-start --spec x").contains("--agent"));
        assert!(refused("orchestration worker-start --spec x --agent claude --worktree current --base-branch main").contains("--base-branch"));
        assert!(refused("orchestration worker-start --spec x --agent claude --worktree name:other --name n").contains("--name"));
        assert!(refused("orchestration worker-start --spec x --agent claude --effort high").contains("--model"));
        assert!(refused("orchestration worker-start --spec x --effort high").contains("--effort needs --model"));
        assert!(refused("orchestration worker-start --spec x --tier deep --model opus").contains("tier"));
        assert!(refused("orchestration worker-start --spec x --tier huge").contains("major, deep, build or light"));
        assert!(refused("orchestration worker-start --spec x --terminal t1 --model opus").contains("--terminal"));
        assert!(refused("orchestration worker-start --spec x --agent claude --timeout-ms soon").contains("--timeout-ms"));
        assert!(refused("orchestration worker-start --spec x --agent claude --retry-of d1").contains("--task"));
        // CLI-035 / ORCH-016: a reused terminal needs its worktree named, and not a new one.
        assert!(refused("orchestration worker-start --spec x --terminal term-2").contains("--worktree"));
        assert!(refused("orchestration worker-start --spec x --terminal term-2 --worktree new-child").contains("--worktree"));
        assert!(parse(&words("orchestration worker-start --spec x --terminal term-2 --worktree current")).1.is_ok());
        assert!(parse(&words("orchestration worker-start --spec x --agent claude --deps [task-1,task-2]")).1.is_ok());
        // CLI-034: a dry run needs no recipient.
        assert!(parse(&words("orchestration dispatch --task task-1 --dry-run")).1.is_ok());
        assert!(refused("orchestration dispatch --task task-1").contains("--to"));
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
    fn repos_projects_and_worktrees_are_listed_and_picked_by_selector() {
        let refused = |s: &str| parse(&words(s)).1.unwrap_err().message;
        let (_, p) = parse(&words("repo search-refs --repo name:x --query de --limit 5"));
        assert_eq!(p.unwrap().unwrap().command, "repo.search-refs");
        assert!(refused("repo set-base-ref --repo name:x").contains("--ref"));
        assert!(refused("repo add").contains("--path"));
        assert!(refused("worktree list --limit 0").contains("above zero"));
        assert!(refused("worktree current --worktree name:a").contains("unknown flag"));

        let dir = std::env::temp_dir().join(format!("kolux-rs-cli117-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        let repo = dir.join("repo");
        let other = dir.join("other");
        for r in [&repo, &other] {
            std::fs::create_dir_all(r).unwrap();
            git(&["init", "-q", "-b", "main"], r);
            git(&["-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "--allow-empty", "-m", "one"], r);
        }
        git(&["branch", "develop"], &repo);
        git(&["checkout", "-q", "develop"], &repo);
        git(&["-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "--allow-empty", "-m", "on develop"], &repo);
        git(&["checkout", "-q", "main"], &repo);
        let git_ = Git::detect().unwrap();
        let store = Mutex::new(Store::open(&dir.join("data")).unwrap());
        projects::add_project(&git_, &store.lock().unwrap(), &repo).unwrap();
        {
            let s = store.lock().unwrap();
            let mut settings = s.settings();
            settings["workspacesDir"] = json!(dir.join("ws").display().to_string());
            settings["branchPrefix"] = json!("none");
            s.save_settings(&settings).unwrap();
        }
        let notify = |_: Value| {};
        let terminals = Terminals::default();
        let ctx = Ctx { claude_config: dir.join(".claude.json"), git: &git_, store: &store, terminals: &terminals, notify: &notify };
        let req = |command: &str, cwd: &Path, args: Value| Request { id: "r".into(), token: String::new(), command: command.into(), cwd: cwd.display().to_string(), args, pane: None };

        // CLI-015: a relative path counts from the folder the command ran in.
        let added = dispatch(&ctx, &req("repo.add", &dir, json!({ "path": "other" }))).unwrap();
        assert_eq!(added["name"], "other");
        let repos = dispatch(&ctx, &req("repo.list", &dir, json!({}))).unwrap();
        assert_eq!(repos["repos"].as_array().unwrap().len(), 2);
        // CLI-016: the projects the app shows.
        let listed = dispatch(&ctx, &req("project.list", &dir, json!({}))).unwrap();
        assert_eq!(listed["projects"].as_array().unwrap().len(), 2);
        let id = repos["repos"].as_array().unwrap().iter().find(|r| r["name"] == "repo").unwrap()["id"].as_str().unwrap().to_string();
        let shown = dispatch(&ctx, &req("repo.show", &dir, json!({ "repo": format!("id:{id}") }))).unwrap();
        assert_eq!(shown["name"], "repo");
        let refs = dispatch(&ctx, &req("repo.search-refs", &repo, json!({ "query": "DEV" }))).unwrap();
        assert_eq!(refs["refs"], json!([{ "name": "develop", "kind": "branch" }]));
        assert!(dispatch(&ctx, &req("repo.set-base-ref", &repo, json!({ "ref": "nope" }))).unwrap_err().message.contains("nope"));
        dispatch(&ctx, &req("repo.set-base-ref", &repo, json!({ "repo": "name:repo", "ref": "develop" }))).unwrap();
        let made = dispatch(&ctx, &req("worktree.create", &repo, json!({ "name": "same", "issue": "7" }))).unwrap();
        let develop = Command::new("git").args(["rev-parse", "develop"]).current_dir(&repo).output().unwrap();
        assert_eq!(made["head"], String::from_utf8_lossy(&develop.stdout).trim(), "the new worktree starts from the new base");
        let path = PathBuf::from(made["path"].as_str().unwrap());
        dispatch(&ctx, &req("worktree.create", &other, json!({ "name": "same" }))).unwrap();

        // CLI-017: one repo's worktrees, with lineage and the hosts covered.
        let list = dispatch(&ctx, &req("worktree.list", &dir, json!({ "repo": "name:repo" }))).unwrap();
        let rows = list["worktrees"].as_array().unwrap();
        assert_eq!(rows.len(), 2);
        assert!(rows.iter().all(|r| r["repoId"] == json!(id)));
        assert_eq!(rows[0]["children"], json!([made["path"]]));
        assert_eq!(list["hosts"], json!({ "covered": ["local"], "leftOut": [] }));
        let capped = dispatch(&ctx, &req("worktree.list", &dir, json!({ "limit": "1" }))).unwrap();
        assert_eq!((capped["worktrees"].as_array().unwrap().len(), &capped["truncated"]), (1, &json!(true)));

        // CLI-009: current and active mean the worktree around the folder; issue: finds the link.
        let inner = path.join("src");
        std::fs::create_dir_all(&inner).unwrap();
        for sel in [None, Some("active")] {
            let args = sel.map(|s| json!({ "worktree": s })).unwrap_or(json!({}));
            let cmd = if sel.is_some() { "worktree.show" } else { "worktree.current" };
            assert_eq!(dispatch(&ctx, &req(cmd, &inner, args)).unwrap()["path"], made["path"]);
        }
        assert_eq!(dispatch(&ctx, &req("worktree.show", &dir, json!({ "worktree": "issue:7" }))).unwrap()["path"], made["path"]);
        let wid = rows[1]["id"].as_str().unwrap().to_string();
        for form in [format!("id:{wid}"), format!("identity:{wid}")] {
            assert_eq!(dispatch(&ctx, &req("worktree.show", &dir, json!({ "worktree": form }))).unwrap()["path"], made["path"]);
        }
        let outside = dispatch(&ctx, &req("worktree.current", &dir, json!({}))).unwrap_err();
        assert!(outside.data["hint"].as_str().unwrap().contains("--worktree"), "{:?}", outside.data);
        let bare = dispatch(&ctx, &req("worktree.show", &dir, json!({ "worktree": "42" }))).unwrap_err();
        assert_eq!(bare.code, "invalid_arguments");
        assert!(bare.message.contains("\"42\"") && bare.message.contains("name:") && bare.message.contains("path:"), "{}", bare.message);
        assert!(dispatch(&ctx, &req("repo.show", &dir, json!({ "repo": "repo" }))).unwrap_err().message.contains("id:"));
        let twice = dispatch(&ctx, &req("worktree.show", &dir, json!({ "worktree": "name:same" }))).unwrap_err();
        assert_eq!(twice.code, "ambiguous");
        // ps: no Kolux terminal is open in a test.
        assert_eq!(dispatch(&ctx, &req("worktree.ps", &dir, json!({}))).unwrap()["worktrees"], json!([]));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_worktree_lists_its_changes_and_the_siblings_that_touch_them() {
        let (_, p) = parse(&words("worktree overlap --worktree name:one --json"));
        assert_eq!(p.unwrap().unwrap().command, "worktree.overlap");
        assert!(parse(&words("worktree changes --repo name:x")).1.unwrap_err().message.contains("unknown flag"));

        let dir = std::env::temp_dir().join(format!("kolux-rs-cli118-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        let repo = dir.join("repo");
        std::fs::create_dir_all(&repo).unwrap();
        let commit = |cwd: &Path, file: &str, text: &str| {
            std::fs::write(cwd.join(file), text).unwrap();
            git(&["add", "-A"], cwd);
            git(&["-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "-m", file], cwd);
        };
        git(&["init", "-q", "-b", "main"], &repo);
        commit(&repo, "a.txt", "base\n");
        let git_ = Git::detect().unwrap();
        let store = Mutex::new(Store::open(&dir.join("data")).unwrap());
        projects::add_project(&git_, &store.lock().unwrap(), &repo).unwrap();
        {
            let s = store.lock().unwrap();
            let mut settings = s.settings();
            settings["workspacesDir"] = json!(dir.join("ws").display().to_string());
            settings["branchPrefix"] = json!("none");
            s.save_settings(&settings).unwrap();
        }
        let notify = |_: Value| {};
        let terminals = Terminals::default();
        let ctx = Ctx { claude_config: dir.join(".claude.json"), git: &git_, store: &store, terminals: &terminals, notify: &notify };
        let req = |command: &str, cwd: &Path, args: Value| Request { id: "r".into(), token: String::new(), command: command.into(), cwd: cwd.display().to_string(), args, pane: None };
        let make = |name: &str| PathBuf::from(dispatch(&ctx, &req("worktree.create", &repo, json!({ "name": name }))).unwrap()["path"].as_str().unwrap());
        let (one, two, quiet) = (make("one"), make("two"), make("quiet"));
        commit(&one, "a.txt", "one\n");
        std::fs::write(one.join("new.txt"), "untracked\n").unwrap();
        commit(&two, "a.txt", "two\n");
        commit(&quiet, "q.txt", "elsewhere\n");

        // changes: committed and uncommitted work together, against the base.
        let ch = dispatch(&ctx, &req("worktree.changes", &one, json!({}))).unwrap();
        assert_eq!(ch["base"], "main");
        assert_eq!(ch["files"], json!([{ "path": "a.txt", "status": "M" }, { "path": "new.txt", "status": "U" }]));

        // overlap: the sibling that edits the same file, and a predicted clash on the committed tips.
        let ov = dispatch(&ctx, &req("worktree.overlap", &one, json!({}))).unwrap();
        let sib = ov["siblings"].as_array().unwrap();
        assert_eq!(sib.len(), 1, "{ov}");
        assert!(same_dir(sib[0]["path"].as_str().unwrap(), &two.display().to_string()));
        assert_eq!((&sib[0]["files"], &sib[0]["clash"]), (&json!(["a.txt"]), &json!("conflict")));
        assert_eq!(ov["complete"], true);

        // A sibling with no history in common: the merge cannot be checked, so it is never clean.
        let orphan = dir.join("ws").join("orphan");
        git(&["worktree", "add", "-q", "--orphan", "-b", "orphan", &orphan.display().to_string()], &repo);
        commit(&orphan, "a.txt", "unrelated\n");
        // A sibling whose folder is gone: its changes cannot be read, so the scan is incomplete.
        let gone = make("gone");
        std::fs::remove_dir_all(&gone).unwrap();
        let ov = dispatch(&ctx, &req("worktree.overlap", &one, json!({ "worktree": "name:one" }))).unwrap();
        let un = ov["siblings"].as_array().unwrap().iter().find(|s| s["branch"] == "orphan").cloned().unwrap();
        assert_eq!(un["clash"], "unverifiable", "{un}");
        assert_eq!(ov["complete"], false);
        assert_eq!(ov["unreadable"].as_array().unwrap().len(), 1);
        let text = text_of("worktree.overlap", &ov);
        assert!(text.contains("unverifiable") && text.contains("could not"), "{text}");
        let _ = std::fs::remove_dir_all(&dir);
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
            settings["branchPrefix"] = json!("none");
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
        // CLI-018 lineage: called from the main checkout, the parent is the main checkout.
        assert_eq!(made["madeBy"], "cli");
        assert_eq!(made["parent"], json!(repo.display().to_string()));
        let child = dispatch(&ctx, &req("worktree.create", &dir, json!({ "name": "child", "repo": "name:repo", "parentWorktree": "name:cli one", "issue": "12", "comment": "from a test" }))).unwrap();
        assert_eq!(child["parent"], json!(path.display().to_string()));
        assert_eq!(child["issue"], 12);
        assert_eq!(child["comment"], "from a test");
        let child_path = child["path"].as_str().unwrap().to_string();
        let stored = projects::origin(&store.lock().unwrap(), &child_path).unwrap();
        assert_eq!(stored["parent"], json!(path.display().to_string()));
        assert_eq!(stored["cwd"], json!(dir.display().to_string()));
        assert_eq!(stored["terminal"], Value::Null, "a call from outside Kolux records no terminal");
        assert!(store.lock().unwrap().get("workspaceParents").unwrap().unwrap().contains("child"), "the sidebar nests it (PROJ-047)");
        let inside = dispatch(&ctx, &req("worktree.create", &path, json!({ "name": "grandchild" }))).unwrap();
        assert_eq!(inside["parent"], json!(path.display().to_string()), "called from inside cli one");
        let alone = dispatch(&ctx, &req("worktree.create", &path, json!({ "name": "alone", "noParent": true }))).unwrap();
        assert_eq!(alone["parent"], Value::Null);
        let from_elsewhere = dispatch(&ctx, &req("worktree.create", &dir, json!({ "name": "top", "repo": "name:repo" }))).unwrap();
        assert_eq!(from_elsewhere["parent"], Value::Null, "called from outside every worktree");
        let missing = dispatch(&ctx, &req("worktree.create", &repo, json!({ "name": "x", "parentWorktree": "name:nope" }))).unwrap_err();
        assert_eq!(missing.code, "not_found");
        for n in ["child", "grandchild", "alone", "top"] {
            dispatch(&ctx, &req("worktree.rm", &repo, json!({ "worktree": format!("name:{n}"), "force": true }))).unwrap();
        }
        assert!(projects::origin(&store.lock().unwrap(), &child_path).is_none(), "the origin goes with the worktree");

        let outside = dispatch(&ctx, &req("worktree.create", &dir, json!({ "name": "nowhere" }))).unwrap_err();
        assert_eq!(outside.code, "not_found");
        let unknown = dispatch(&ctx, &req("worktree.create", &repo, json!({ "name": "x", "agent": "nobody" }))).unwrap_err();
        assert!(unknown.message.contains("nobody"));

        std::fs::write(path.join("junk.txt"), "x").unwrap();
        let dirty = dispatch(&ctx, &req("worktree.rm", &repo, json!({ "worktree": "name:cli one" }))).unwrap_err();
        assert_eq!(dirty.code, "dirty");
        assert!(path.exists());
        let forced = dispatch(&ctx, &req("worktree.rm", &repo, json!({ "worktree": "name:cli one", "force": true }))).unwrap();
        assert!(!path.exists());
        // CLI-020: --force removes the checkout and never the branch.
        assert_eq!(forced["branchKept"], true);
        let branch = format!("refs/heads/{}", forced["branch"].as_str().unwrap());
        assert!(Command::new("git").args(["rev-parse", "--verify", &branch]).current_dir(&repo).output().unwrap().status.success(), "the branch stays");
        assert_eq!(events.lock().unwrap().last().unwrap()["kind"], "removed");

        let two = dispatch(&ctx, &req("worktree.create", &repo, json!({ "name": "two" }))).unwrap();
        let two_path = PathBuf::from(two["path"].as_str().unwrap());
        assert_eq!(dispatch(&ctx, &req("worktree.rm", &two_path, json!({ "worktree": "current" }))).unwrap()["branchKept"], false, "a plain rm takes the branch it made");
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
        assert_eq!(handle.code, "not_found");
        let _ = std::fs::remove_dir_all(&dir);
    }
    #[test]
    fn worktree_ps_sums_up_workers_and_keeps_the_last_list_when_a_scan_fails() {
        let dir = std::env::temp_dir().join(format!("kolux-rs-cli129-{}", std::process::id()));
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
            settings["branchPrefix"] = json!("none");
            s.save_settings(&settings).unwrap();
        }
        let notify = |_: Value| {};
        let terminals = Terminals::default();
        let ctx = Ctx { claude_config: dir.join(".claude.json"), git: &git_, store: &store, terminals: &terminals, notify: &notify };
        let req = |command: &str, args: Value| Request { id: "r".into(), token: String::new(), command: command.into(), cwd: repo.display().to_string(), args, pane: None };
        let mut open = Vec::new();
        for n in ["a", "b", "c", "d"] {
            let made = dispatch(&ctx, &req("worktree.create", json!({ "name": n, "setup": "skip" }))).unwrap();
            open.push(json!({ "id": format!("d-{n}"), "runId": "run-1", "taskId": format!("t-{n}"), "status": "running", "worktree": made["path"], "agent": "claude" }));
        }
        open.push(json!({ "id": "d-old", "taskId": "t-old", "status": "completed", "worktree": open[0]["worktree"], "agent": "claude" }));
        save_list(&store.lock().unwrap(), DISPATCHES_KEY, &open).unwrap();

        // ORCH-040: one row per worktree with its workers, a row cap and a scope line.
        let ps = dispatch(&ctx, &req("worktree.ps", json!({ "limit": "3" }))).unwrap();
        let rows = ps["worktrees"].as_array().unwrap();
        assert_eq!(rows.len(), 3);
        assert_eq!(ps["truncated"], true);
        assert_eq!(rows[0]["workers"].as_array().unwrap().len(), 1, "a finished dispatch is not counted: {}", rows[0]);
        assert_eq!(ps["scope"]["worktrees"], 5);
        assert_eq!(ps["scope"]["shown"], 4);
        assert_eq!(ps["scope"]["repos"][0]["scan"], "scanned");
        let text = query_text("worktree.ps", &ps).unwrap();
        assert!(text.contains("worker d-") && text.contains("scope: 1 repo, 5 worktrees, 4 with work"), "{text}");
        // An immediate repeat reuses the scan instead of running git again.
        let again = dispatch(&ctx, &req("worktree.ps", json!({}))).unwrap();
        assert_eq!(again["scope"]["repos"][0]["scan"], "cached");

        // A repeated JSON poll from the same terminal gets a tiny answer when nothing changed.
        let poll = |json_: bool| Request { pane: Some(Pane { handle: "term-1".into(), key: "k1".into() }), ..req("worktree.ps", json!({ "json": json_ })) };
        let first = dispatch(&ctx, &poll(true)).unwrap();
        assert!(first["worktrees"].is_array() && first["snapshot"].is_string());
        let second = dispatch(&ctx, &poll(true)).unwrap();
        assert_eq!(second["unchanged"], true);
        assert_eq!(second["snapshot"], first["snapshot"]);
        assert!(second.get("worktrees").is_none());
        assert!(dispatch(&ctx, &poll(false)).unwrap()["worktrees"].is_array(), "text output is always the full list");

        // Break the repo: the last list stays, marked degraded, and the failure is remembered.
        std::thread::sleep(SCAN_FRESH + Duration::from_millis(100));
        std::fs::rename(repo.join(".git"), dir.join("git-aside")).unwrap();
        let broken = dispatch(&ctx, &req("worktree.ps", json!({}))).unwrap();
        assert_eq!(broken["worktrees"].as_array().unwrap().len(), 4, "{broken}");
        assert_eq!(broken["worktrees"][0]["degraded"], true);
        assert_eq!(broken["scope"]["repos"][0]["scan"], "degraded");
        assert!(broken["scope"]["repos"][0]["error"].is_string());
        assert!(query_text("worktree.ps", &broken).unwrap().contains("last known"));
        let polled = dispatch(&ctx, &req("worktree.ps", json!({}))).unwrap();
        assert_eq!(polled["scope"]["repos"][0]["scan"], "degraded");
        assert_eq!(polled["scope"]["repos"][0]["cached"], true, "the failure is remembered: {}", polled["scope"]);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn mail_reads_as_a_banner() {
        let msgs = vec![
            json!({ "id": "msg-3", "from": "term-2", "fromAgent": "Claude Code", "type": "status", "priority": "urgent", "subject": "stop", "body": "halt now", "payload": { "n": 1 }, "reply": "kolux orchestration reply --id msg-3 --body x" }),
            json!({ "id": "msg-4", "from": "term-5", "type": "question", "priority": "normal", "subject": "which?", "body": "", "reply": "kolux orchestration reply --id msg-4 --body y" }),
        ];
        let mut out = Vec::new();
        mail_lines(&msgs, &mut out);
        let text = out.join("\n");
        assert!(text.contains("[URGENT]") && text.contains("Claude Code (term-2)") && text.contains("payload: {\"n\":1}"), "{text}");
        assert!(text.contains("--id msg-3") && text.contains("from term-5") && !text.contains("[NORMAL]"), "{text}");
        assert_eq!(out.iter().filter(|l| l.starts_with("----")).count(), 2, "each message ends with its own divider");
    }
}
