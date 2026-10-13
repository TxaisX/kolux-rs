//! The command line (PROJ-077, with the CLI-004 envelope and CLI-005 exit codes as its
//! foundation). The running app listens on a loopback port and writes the port and a token to
//! `cli.json` in its data folder; the `kolux-dev` program sends one JSON request per call and
//! prints the reply as text, or as the JSON envelope with `--json`. Exit status: 0 worked, 1
//! any error.

use crate::cli_accounts;
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

#[path = "automations_cli.rs"]
mod automations_cli;
#[path = "local_cli.rs"]
mod local_cli;

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
    /// CLI-038: the version of the command line that sent it, so an app older than the CLI turns
    /// an orchestration change away before running it. Empty from a CLI that predates the field.
    #[serde(default)]
    pub cli: String,
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

const HELP: &str = "kolux-dev: drive Kolux from a terminal\n\n  kolux-dev --version\n  kolux-dev worktree create --name <name> [--repo <selector>] [--agent <id>] [--prompt <text>]\n      [--setup run|skip|inherit] [--base-branch <ref>] [--issue <number>, the name defaulting to its title] [--comment <text>]\n      [--parent-worktree <selector>] [--no-parent] [--run-hooks] [--activate] [--json]\n  kolux-dev worktree rm --worktree <selector> [--force] [--run-hooks] [--json]\n      (also: remove, delete)\n  kolux-dev open [--json]\n      start Kolux, or bring its window to the front, and wait until it answers\n  kolux-dev repo list | repo add --path <folder> | repo show [--repo <selector>] [--json]\n  kolux-dev repo set-base-ref --ref <ref> [--repo <selector>] [--json]\n  kolux-dev repo search-refs [--repo <selector>] [--query <text>] [--limit <n>] [--json]\n  kolux-dev project list [--json]\n  kolux-dev worktree list | worktree ps [--repo <selector>] [--limit <n>] [--json]\n  kolux-dev worktree show [--worktree <selector>] | worktree current [--json]\n  kolux-dev worktree changes | worktree overlap [--worktree <selector>] [--json]\n  kolux-dev orchestration worker-start (--task <id> | --spec <text>) (--agent <id> | --model <m> | --tier major|deep|build|light | --terminal <handle>)\n      [--worktree current|<selector>|new-child|new-top-level] [--model <m>] [--effort <e>] [--name <n>]\n      [--repo <selector>] [--base-branch <ref>] [--display-name <d>] [--comment <c>] [--setup run|skip|inherit]\n      [--task-title <t>] [--deps <json list>] [--parent <task>] [--timeout-ms <ms>] [--max-depth <n>] [--json]\n  kolux-dev orchestration run-create --objective <text> [--from <handle>] [--retry-request <id>] [--json]\n  kolux-dev orchestration run-use --id <run> [--from <handle>] [--takeover-legacy] [--retry-request <id>] [--json]\n  kolux-dev orchestration run-current [--from <handle>] [--json]\n  kolux-dev orchestration run-list [--limit <n>] [--cursor <c>] [--json]\n  kolux-dev orchestration run-show --id <run> [--json]\n  kolux-dev orchestration send --subject <s> [--to run:<id>|dispatch:<id>|<handle>] [--body <text>] [--type <kind>]\n      [--priority normal|high|urgent] [--thread-id <t>] [--payload <json>] [--task-id <id>] [--dispatch-id <id>]\n      [--outcome succeeded|failed] [--files-modified <a,b>] [--report-path <p>] [--phase <p>] [--run <run>] [--from <handle>]\n      [--retry-request <id>] [--json]\n  kolux-dev orchestration check [--terminal <handle>] [--run <run>] [--ack <delivery>] [--unread|--peek|--all]\n      [--types <kind,...>] [--format] [--wait] [--timeout-ms <ms>] [--json]\n  kolux-dev orchestration reply --id <message> --body <text> [--run <run>] [--from <handle>] [--retry-request <id>] [--json]\n  kolux-dev orchestration inbox [--limit <n>] [--terminal <handle>] [--full] [--json]\n  kolux-dev orchestration ask (--question <text> [--options <a,b>] [--to <who>] | --resume <message>) [--timeout-ms <ms>] [--json]\n  kolux-dev orchestration gate-create --task <id> --question <text> [--options <json list>] [--json]\n  kolux-dev orchestration gate-resolve --id <gate> --resolution <text> [--json]\n  kolux-dev orchestration gate-list [--task <id>] [--status pending|resolved|timeout] [--run <run>] [--json]\n  kolux-dev orchestration task-create --spec <text> [--task-title <t>] [--display-name <n>] [--deps <json list>]\n      [--parent <task>] [--run <run>] [--from <handle>] [--retry-request <id>] [--json]\n  kolux-dev orchestration task-list [--status <state>] [--ready] [--brief] [--run <run>] [--json]\n  kolux-dev orchestration task-update --id <task> --status pending|ready|dispatched|completed|failed|blocked\n      [--result <text>] [--run <run>] [--retry-request <id>] [--json]\n  kolux-dev orchestration dispatch --task <id> (--to <handle> [--inject] | --dry-run) [--return-preamble] [--run <run>]\n      [--max-depth <n>] [--json]\n  kolux-dev orchestration dispatch-show --task <id> [--preamble] [--json]\n  kolux-dev orchestration request-show --request <uuid> [--json]\n      what became of a change whose answer was lost (its --retry-request id)\n  kolux-dev account add [--agent claude|codex] [--json]\n      (runs the agent's own login in this terminal; Codex uses a device code)\n  kolux-dev account list [--json]\n  kolux-dev orchestration worker-abandon --dispatch <id> [--json]\n  kolux-dev orchestration worker-stop --dispatch <id> [--json]\n      (ends the worker's agent terminal; its worktree and other terminals stay)\n  kolux-dev orchestration reset (--all | --tasks | --messages) [--json]\n  kolux-dev terminal list [--worktree <selector>] [--limit <n>] [--include-visual-layouts] [--json]\n  kolux-dev terminal show --terminal <handle> [--json]\n  kolux-dev terminal create [--worktree active|<selector>] [--command <text>] [--title <t>] [--focus] [--json]\n  kolux-dev terminal split --terminal <handle> [--direction vertical|horizontal] [--command <text>] [--json]\n  kolux-dev terminal rename --terminal <handle> [--title <t>] [--json]\n      without --title the default name comes back\n  kolux-dev terminal switch --terminal <handle> [--json]   (also: focus)\n  kolux-dev terminal close (--terminal <handle> [--tab] | --worktree <selector> --all) [--json] (it replaces stop)\n  kolux-dev automations list [--json]\n  kolux-dev automations show <id> [--json]\n  kolux-dev automations runs <id> [--limit <n>] [--json]\n  kolux-dev automations create --name <n> --trigger hourly|daily|weekdays|weekly|<cron line or RRULE> --prompt <text>\n      [--provider claude|codex|gemini] [--time HH:MM] [--day 0-6, Sunday 0] [--timezone <IANA zone>]\n      [--repo <selector> | --workspace <selector>] [--workspace-mode existing|new-per-run]
      [--missed-run-grace-minutes 0|30|60|180|720|1440|2880]\n      [--precheck <command>] [--precheck-timeout 60|120|300|600] [--enabled | --disabled] [--json]\n      (--schedule is another name for --trigger)\n  kolux-dev automations edit <id> [the create flags; --time, --day and --timezone go with --trigger] [--json]\n  kolux-dev automations remove <id> [--json]\n  kolux-dev automations run <id> [--json]\n  kolux-dev agent-context [--json]   (every command, its flags and its usage; works with the app closed)\n  kolux-dev skills list [--json]\n  kolux-dev skills get <topic> [--full | --references | --reference <name>] [--topic <topic>] [--json]\n      (also: show; skills commands work with the app closed)\n  kolux-dev skills coverage [--json]\n      (which installed agents have the orchestration skill for the whole computer)\n  kolux-dev claude-teams [claude arguments]   (Claude Code with Agent Teams, in a Kolux terminal; not on Windows)\n\nSelectors: --repo id:|name:|path:   --worktree active|current|id:<repo-id>::<path>|identity:|name:|branch:|issue:|path:\n--json prints one envelope on stdout; without it, errors go to stderr; warnings about flags nothing
acts on yet go to stderr and into the result's `warnings` list. Exit 0 worked, 1 any error.\n";

const SWITCHES: &[&str] = &["force", "activate", "run-hooks", "no-parent", "takeover-legacy", "unread", "peek", "all", "format", "wait", "full", "ready", "brief", "inject", "dry-run", "return-preamble", "preamble", "tasks", "messages", "enabled", "disabled", "references", "focus", "include-visual-layouts", "tab"];
/// switch; stop is the old word for close, kept out of the help.
const TERMINAL: &[(&str, &str, &[&str])] = &[
    ("terminal list", "terminal.list", &["worktree", "limit", "include-visual-layouts"]),
    ("terminal show", "terminal.show", &["terminal"]),
    ("terminal create", "terminal.create", &["worktree", "command", "title", "focus"]),
    ("terminal split", "terminal.split", &["terminal", "direction", "command"]),
    ("terminal rename", "terminal.rename", &["terminal", "title"]),
    ("terminal switch", "terminal.switch", &["terminal"]),
    ("terminal focus", "terminal.switch", &["terminal"]),
    ("terminal close", "terminal.close", &["terminal", "tab", "worktree", "all"]),
    ("terminal stop", "terminal.close", &["terminal", "tab", "worktree", "all"]),
];
/// CLI-027: what the retired word says.
const STOP_GONE: &str = "terminal stop was replaced by terminal close: use kolux-dev terminal close --worktree <selector> --all, or --terminal <handle>";
/// ORCH-001..006, ORCH-010, ORCH-011, ORCH-013 / CLI-030..032, CLI-034: the mail and task commands
/// and their flags. `--dispatch-capability` is accepted and unused until the dispatch pass (ORCH-067, T-155).
const MAIL: &[(&str, &str, &[&str])] = &[
    ("orchestration run-create", "orchestration.run-create", &["objective", "from", "retry-request"]),
    ("orchestration run-use", "orchestration.run-use", &["id", "from", "takeover-legacy", "retry-request"]),
    ("orchestration run-current", "orchestration.run-current", &["from"]),
    ("orchestration run-list", "orchestration.run-list", &["limit", "cursor"]),
    ("orchestration run-show", "orchestration.run-show", &["id"]),
    // ORCH-030: what became of a request sent with --retry-request.
    ("orchestration request-show", "orchestration.request-show", &["request", "from"]),
    ("orchestration send", SEND, &["to", "run", "from", "subject", "body", "type", "priority", "thread-id", "payload", "task-id", "dispatch-id", "dispatch-capability", "retry-request", "outcome", "files-modified", "report-path", "phase"]),
    ("orchestration check", CHECK, &["terminal", "run", "ack", "unread", "peek", "all", "types", "format", "wait", "timeout-ms", "retry-request"]),
    ("orchestration reply", "orchestration.reply", &["id", "body", "run", "from", "retry-request"]),
    ("orchestration inbox", "orchestration.inbox", &["limit", "terminal", "full"]),
    ("orchestration ask", ASK, &["question", "resume", "options", "timeout-ms", "to", "run", "from", "retry-request"]),
    ("orchestration gate-create", "orchestration.gate-create", &["task", "question", "options", "run", "from", "retry-request"]),
    ("orchestration gate-resolve", "orchestration.gate-resolve", &["id", "resolution", "run", "from", "retry-request"]),
    ("orchestration gate-list", "orchestration.gate-list", &["task", "status", "run", "from"]),
    ("orchestration reset", RESET, &["all", "tasks", "messages"]),
    ("orchestration task-create", "orchestration.task-create", &["spec", "task-title", "display-name", "deps", "parent", "run", "from", "retry-request"]),
    ("orchestration task-list", "orchestration.task-list", &["status", "ready", "brief", "run", "from"]),
    ("orchestration task-update", UPDATE, &["id", "status", "result", "run", "from", "retry-request"]),
    // ponytail: ask's older hand-back with exit status 75 (CLI-033) and the
    // worker-list/show/read/release/retain commands (CLI-036) are T-089-b.
    ("orchestration dispatch", "orchestration.dispatch", &["task", "to", "from", "run", "inject", "dry-run", "return-preamble", "max-depth", "retry-request"]),
    ("orchestration dispatch-show", "orchestration.dispatch-show", &["task", "preamble", "from"]),
    ("orchestration worker-abandon", ABANDON, &["dispatch", "run", "from", "retry-request"]),
    ("orchestration worker-stop", STOP, &["dispatch", "run", "from", "retry-request"]),
];
/// CLI-038: the orchestration changes. Each carries a request id that lasts, so a change whose
/// answer was lost can be sent again and still take effect no more than once.
const CHANGES: &[&str] = &["orchestration.run-create", "orchestration.run-use", SEND, "orchestration.reply", "orchestration.task-create", "orchestration.dispatch", WORKER_START];
const VERSION: &str = env!("CARGO_PKG_VERSION");
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
const UPDATE: &str = "orchestration.task-update";
const STOP: &str = "orchestration.worker-stop";
const CHECK: &str = "orchestration.check";
const ASK: &str = "orchestration.ask";
const RESET: &str = "orchestration.reset";
const SCOPES: [&str; 3] = ["all", "tasks", "messages"];
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
const OPEN_FLAGS: &[&str] = &[];
/// How long `open` waits for an app it started to answer.
const OPEN_LIMIT: Duration = Duration::from_secs(60);

type Command = (&'static str, &'static str, &'static [&'static str]);

/// Every command path with its wire name and flags, aliases included (CLI-003 suggests from it).
fn commands() -> Vec<Command> {
    let mut all: Vec<Command> = vec![
        ("worktree create", "worktree.create", CREATE_FLAGS),
        ("worktree rm", "worktree.rm", RM_FLAGS),
        ("worktree remove", "worktree.rm", RM_FLAGS),
        ("worktree delete", "worktree.rm", RM_FLAGS),
        ("orchestration worker-start", WORKER_START, WORKER_FLAGS),
        ("account add", cli_accounts::ADD, &["agent"] as &[&str]),
        ("account list", cli_accounts::LIST, &[] as &[&str]),
        ("open", "app.open", OPEN_FLAGS),
    ];
    all.extend(QUERY.iter().copied());
    all.extend(MAIL.iter().copied());
    all.extend(TERMINAL.iter().copied());
    all.extend(automations_cli::COMMANDS.iter().copied());
    all.extend(local_cli::COMMANDS.iter().copied());
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
            if w == "--" && path.is_empty() {
                continue;
            }
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
        // CLI-028 / CLI-043: an automation id, or a skill topic, may be given bare after the verb.
        if let Some(flag) = local_cli::bare(&path) {
            let v = Value::String(path.pop().unwrap_or_default());
            at.pop();
            if flags.get(flag).is_some_and(|old| *old != v) {
                return Err(Fail::args(format!("the {flag} was given twice with different values")));
            }
            flags.insert(flag.into(), v);
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
            if command.starts_with("account.") && k != "agent" {
                // ACCT-031 / CLI-014: environments, pairing codes and remote targets are refused.
                return Err(Fail::args(format!("account commands always run on this machine; --{k} is not taken")));
            }
            return Err(flag_typo(words, &spots, joined, allowed, k));
        }
        let text = |k: &str| flags.get(k).and_then(Value::as_str);
        let empty = |k: &str| text(k).is_some_and(|v| v.trim().is_empty());
        let mut args = Map::new();
        if command == "worktree.create" {
            if text("name").map(str::trim).unwrap_or_default().is_empty() && text("issue").map(str::trim).unwrap_or_default().is_empty() {
                return Err(Fail::args("--name is required (or --issue, to name it after the issue)"));
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
        } else if command == cli_accounts::ADD {
            let agent = text("agent").unwrap_or("claude").trim().to_lowercase();
            if agent.is_empty() {
                return Err(Fail::args("--agent cannot be empty; name claude or codex, or leave it out for Claude"));
            }
            if !cli_accounts::AGENTS.contains(&agent.as_str()) {
                return Err(Fail::args(format!("account add signs in claude or codex, not {agent}")));
            }
            args.insert("agent".into(), Value::String(agent));
        } else if command == cli_accounts::LIST {
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
                    // CLI-006: Windows PowerShell 5.1 drops the double quotes inside JSON it hands to a
                    // program; say so rather than send something else.
                    if let Some(p) = text("payload").filter(|p| serde_json::from_str::<Value>(p).is_err()) {
                        return Err(Fail::args(if quotes_lost(p) {
                            "--payload lost its double quotes on the way in, which Windows PowerShell 5.1 does to JSON passed to a program; escape each inner quote as \\\" or run the command from PowerShell 7 (pwsh)"
                        } else {
                            "--payload takes JSON"
                        }));
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
                RESET if SCOPES.iter().filter(|k| flags.contains_key(**k)).count() != 1 => return Err(Fail::args("reset needs exactly one scope: --all, --tasks or --messages")),
                ASK => match (text("question").is_some(), text("resume").is_some()) {
                    (true, true) => return Err(Fail::args("give --question or --resume, not both")),
                    (false, false) => return Err(Fail::args("--question is required (or --resume <message> to wait on one already asked)")),
                    _ => {}
                },
                "orchestration.gate-create" => {
                    need("task", "")?;
                    need("question", ": say what needs deciding")?
                }
                "orchestration.gate-resolve" => {
                    need("id", "")?;
                    need("resolution", ": say what was decided")?
                }
                "orchestration.task-create" => need("spec", ": say what the task is")?,
                "orchestration.dispatch" => {
                    need("task", "")?;
                    if !flags.contains_key("dry-run") {
                        need("to", ": name the agent terminal, like term-3")?
                    }
                }
                "orchestration.dispatch-show" => need("task", "")?,
                ABANDON | STOP => need("dispatch", ": name the dispatch, like dispatch-2")?,
                "orchestration.request-show" => need("request", ": the --retry-request id of the change")?,
                UPDATE => {
                    need("id", ": name the task, like task-2")?;
                    need("status", ": one of pending, ready, dispatched, completed, failed, blocked")?
                }
                _ => {}
            }
            for k in ["retry-request", "request"] {
                if text(k).is_some_and(|v| !is_uuid(v.trim())) {
                    return Err(Fail::args(format!("--{k} takes the UUID a lost change printed, like 1b4e28ba-2fa1-4d3b-a3f5-ef19b5a7633a; it is only for exact recovery")));
                }
            }
            if command != RESET && ["unread", "peek", "all"].iter().filter(|k| flags.contains_key(**k)).count() > 1 {
                return Err(Fail::args("give one of --unread, --peek or --all"));
            }
            for k in ["limit", "timeout-ms"] {
                if text(k).is_some_and(|v| v.parse::<u64>().map(|n| n == 0).unwrap_or(true)) {
                    return Err(Fail::args(format!("--{k} takes a number above zero")));
                }
            }
            max_depth(text("max-depth"))?;
        } else if command.starts_with("automations.") {
            args = automations_cli::check(command, &flags)?;
        } else if local_cli::COMMANDS.iter().any(|c| c.1 == command) {
            args = flags.clone();
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
        } else if command.starts_with("terminal.") {
            check_terminal(joined, command, &flags)?;
            for (k, v) in &flags {
                args.insert(camel(k), v.clone());
            }
            if joined == "terminal stop" {
                args.insert("note".into(), json!(STOP_GONE));
            }
        } else if command == "worktree.rm" {
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


/// CLI-023, CLI-026, CLI-027: what a terminal command needs, checked before the app is asked.
fn check_terminal(joined: &str, command: &str, flags: &Map<String, Value>) -> Result<(), Fail> {
    let has = |k: &str| flags.contains_key(k);
    let text = |k: &str| flags.get(k).and_then(Value::as_str).map(str::trim);
    if let Some(k) = flags.keys().find(|k| k.as_str() != "title" && text(k).is_some_and(str::is_empty)) {
        return Err(Fail::args(format!("--{k} cannot be empty")));
    }
    if joined == "terminal stop" && !has("terminal") && !has("all") {
        return Err(Fail::args(STOP_GONE));
    }
    match command {
        "terminal.show" | "terminal.split" | "terminal.rename" | "terminal.switch" if !has("terminal") => {
            return Err(Fail::args("--terminal is required: the handle terminal list prints, like term-3"));
        }
        "terminal.close" => {
            if has("tab") && !has("terminal") {
                return Err(Fail::args("--tab closes the whole tab of --terminal <handle>; name the terminal"));
            }
            if has("all") != has("worktree") {
                return Err(Fail::args("--worktree and --all go together: --worktree <selector> --all closes every terminal in that worktree"));
            }
            match (has("terminal"), has("all")) {
                (true, true) => return Err(Fail::args("give --terminal <handle> or --worktree <selector> --all, not both")),
                (false, false) => return Err(Fail::args("say what to close: --terminal <handle> (add --tab for its whole tab) or --worktree <selector> --all")),
                _ => {}
            }
        }
        _ => {}
    }
    if text("direction").is_some_and(|d| !["horizontal", "vertical"].contains(&d)) {
        return Err(Fail::args("--direction takes horizontal or vertical"));
    }
    if text("limit").is_some_and(|v| v.parse::<u64>().map(|n| n == 0).unwrap_or(true)) {
        return Err(Fail::args("--limit takes a number above zero"));
    }
    Ok(())
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
    // COMPAT 7: KOLUX_USER_DATA_PATH points the command at another build's data folder.
    if let Some(d) = std::env::var_os("KOLUX_USER_DATA_PATH").filter(|d| !d.is_empty()) {
        return d.into();
    }
    data_dir_of(std::env::var_os(APP_DIR_ENV), std::env::var_os("APPDATA"))
}

fn data_dir_of(own: Option<std::ffi::OsString>, appdata: Option<std::ffi::OsString>) -> PathBuf {
    match own.filter(|d| !d.is_empty()) {
        Some(d) => d.into(),
        None => appdata.map(PathBuf::from).unwrap_or_else(std::env::temp_dir).join(DATA_DIR),
    }
}

/// CLI-004: when the app cannot be reached, text mode suggests starting it, unless the error
/// already carries its own recovery or the command was `open` itself.
fn open_first(f: &Fail, command: &str) -> Option<String> {
    (f.code == "app_unreachable" && command != "app.open" && f.data["hint"].is_null()).then(|| format!("run {} open to start it, then try again", crate::orchestration::CLI))
}

/// CLI-010: the one failure that means the app is down, with the command that fixes it.
fn unreachable_fail(why: String) -> Fail {
    Fail { code: "app_unreachable", message: format!("Kolux is not running; start it with `{} open` first", crate::orchestration::CLI), data: json!({ "detail": why }) }
}

/// The request reached the app, but its answer did not come back: the change may have happened.
fn lost(code: &'static str, message: String) -> Fail {
    Fail { code, message, data: json!({}) }
}

/// "0.2.0" is newer than "0.1.9"; a missing version is the oldest.
fn newer(a: &str, b: &str) -> bool {
    let v = |s: &str| s.split('.').map(|p| p.trim().parse::<u64>().unwrap_or(0)).collect::<Vec<_>>();
    !a.trim().is_empty() && v(a) > v(b)
}

/// CLI-038: a random version-4 UUID.
fn uuid() -> String {
    let h = format!("{}{}", secret(), secret());
    let variant = ['8', '9', 'a', 'b'][usize::from(h.as_bytes()[16] % 4)];
    format!("{}-{}-4{}-{variant}{}-{}", &h[0..8], &h[8..12], &h[13..16], &h[17..20], &h[20..32])
}

fn is_uuid(s: &str) -> bool {
    s.len() == 36 && s.char_indices().all(|(i, c)| if [8, 13, 18, 23].contains(&i) { c == '-' } else { c.is_ascii_hexdigit() })
}

/// JSON whose double quotes Windows PowerShell 5.1 removed: braces or brackets and no quote left.
fn quotes_lost(s: &str) -> bool {
    let t = s.trim();
    (t.starts_with('{') || t.starts_with('[')) && !t.contains('"') && t.len() > 2
}

/// The words of a command line as they could be typed again.
fn retype(words: &[String]) -> String {
    words.iter().map(|w| if w.is_empty() || w.contains(|c: char| c.is_whitespace() || c == '"' || c == '\'') { format!("'{}'", w.replace('\'', "''")) } else { w.clone() }).collect::<Vec<_>>().join(" ")
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
    stream.write_all(line.as_bytes()).and_then(|_| stream.write_all(b"\n")).map_err(|e| lost("lost_result", format!("the connection to Kolux dropped while sending: {e}")))?;
    let mut reply = String::new();
    // CLI-010: a slow answer is not the app being down.
    match BufReader::new(stream).read_line(&mut reply) {
        Err(e) if matches!(e.kind(), std::io::ErrorKind::TimedOut | std::io::ErrorKind::WouldBlock) => return Err(lost("timeout", "Kolux is running but did not answer within 300 s; it may still be working".into())),
        Err(e) => return Err(lost("lost_result", format!("the connection to Kolux dropped before its answer came: {e}"))),
        Ok(0) => return Err(lost("lost_result", "the connection to Kolux closed before its answer came".into())),
        Ok(_) => {}
    }
    let mut v: Value = serde_json::from_str(&reply).map_err(|e| Fail::new("failed", format!("malformed reply from the app: {e}")))?;
    if v["requestId"].as_str() != Some(&req.id) {
        return Err(Fail::new("failed", "the app answered another request"));
    }
    // CLI-010: an app that does not know a command this CLI knows is older, and says so.
    let app = v["meta"]["appVersion"].as_str().unwrap_or_default().to_string();
    if v["error"]["code"] == "invalid_arguments" && v["error"]["message"].as_str().is_some_and(|m| m.starts_with("unknown command")) && app != VERSION {
        let shown = if app.is_empty() { "an older version".to_string() } else { app.clone() };
        v["error"] = json!({ "code": "version_gap", "message": format!("the running Kolux ({shown}) does not know {}; this command line is {VERSION}. Update Kolux, or restart it if it is already updated", req.command), "data": { "appVersion": app, "cliVersion": VERSION } });
    }
    Ok(v)
}

/// CLI-011: asks a running app to come forward; when none answers, starts it once and asks again
/// until it answers or `limit` has passed since the start.
pub fn open(send: &dyn Fn() -> Result<Value, Fail>, launch: &dyn Fn() -> Result<(), Fail>, limit: Duration) -> Result<Value, Fail> {
    match send() {
        Err(f) if f.code == "app_unreachable" => {}
        answered => return answered,
    }
    launch()?;
    let until = Instant::now() + limit;
    loop {
        match send() {
            Ok(mut env) => {
                if let Some(r) = env["result"].as_object_mut() {
                    r.insert("started".into(), json!(true));
                }
                return Ok(env);
            }
            Err(f) if f.code != "app_unreachable" => return Err(f),
            Err(f) if Instant::now() >= until => {
                return Err(Fail { code: "app_unreachable", message: format!("Kolux was started but did not answer within {} s", limit.as_secs()), data: f.data });
            }
            Err(_) => std::thread::sleep(Duration::from_millis(250)),
        }
    }
}

/// Starts the app detached from this terminal: KOLUX_APP_EXECUTABLE, else the app program
/// beside this one (both are built and installed side by side).
/// ponytail: on Linux and macOS the app is only spawned, not put in its own session.
fn launch_app() -> Result<(), Fail> {
    let exe = match std::env::var_os("KOLUX_APP_EXECUTABLE").filter(|e| !e.is_empty()) {
        Some(e) => PathBuf::from(e),
        None => {
            // CLI-006: an installed CLI sits in the install's bin folder, one level below the app.
            let me = std::env::current_exe().map_err(|e| Fail::new("launch_failed", e.to_string()))?;
            let name = if cfg!(windows) { "kolux-rs.exe" } else { "kolux-rs" };
            let beside = me.with_file_name(name);
            match me.parent().and_then(Path::parent).map(|p| p.join(name)) {
                Some(up) if !beside.is_file() && up.is_file() => up,
                _ => beside,
            }
        }
    };
    let mut cmd = std::process::Command::new(&exe);
    cmd.stdin(std::process::Stdio::null()).stdout(std::process::Stdio::null()).stderr(std::process::Stdio::null());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        // DETACHED_PROCESS | CREATE_NEW_PROCESS_GROUP: closing this terminal or Ctrl+C here leaves the app running.
        cmd.creation_flags(0x0000_0008 | 0x0000_0200);
    }
    cmd.spawn().map(drop).map_err(|e| Fail::new("launch_failed", format!("could not start Kolux from {}: {e}", exe.display())))
}

fn request_id() -> String {
    let t = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_nanos()).unwrap_or(0);
    format!("{:x}-{:x}", std::process::id(), t)
}

/// What a success looks like without `--json`.
fn text_of(command: &str, r: &Value) -> String {
    if let Some(t) = local_cli::text(command, r) {
        return t;
    }
    if let Some(t) = automations_cli::text(command, r) {
        return t;
    }
    if let Some(t) = query_text(command, r).or_else(|| terminal_text(command, r)) {
        return t;
    }
    let s = |k: &str| r[k].as_str().unwrap_or_default().to_string();
    match command {
        c if c.starts_with("account.") => cli_accounts::text(c, r),
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
        "orchestration.request-show" => match s("state").as_str() {
            "completed" => format!("request {} completed and took effect ({}); a retry with it hands back the same result", s("request"), s("command")),
            "pending" if r["interrupted"] == true => format!("request {} ({}) was cut short when Kolux stopped; its outcome is unknown, so check before trying again", s("request"), s("command")),
            "pending" => format!("request {} ({}) is still under way", s("request"), s("command")),
            _ => format!("request {} is absent: Kolux has no record of it, so a retry runs it fresh", s("request")),
        },
        "orchestration.reply" => format!("sent {} to {} on thread {}", r["messageIds"][0].as_str().unwrap_or_default(), s("to"), s("threadId")),
        ASK => match s("status").as_str() {
            "answered" => format!("answer from {} (to {}): {}", s("answeredBy"), s("messageId"), s("answer")),
            _ => format!("question {id} is still open (asked of {}); wait again with: {} orchestration ask --resume {id}", s("to"), crate::orchestration::CLI, id = s("messageId")),
        },
        "orchestration.gate-create" => {
            let choices: Vec<&str> = r["options"].as_array().into_iter().flatten().filter_map(Value::as_str).collect();
            let choices = if choices.is_empty() { String::new() } else { format!(" (choices: {})", choices.join(", ")) };
            format!("{} holds {}, now blocked: {}{choices}", s("id"), s("task"), s("question"))
        }
        "orchestration.gate-resolve" => format!("{} resolved: {}; {} is {}", s("id"), s("resolution"), s("task"), s("taskStatus")),
        "orchestration.gate-list" => {
            let mut out: Vec<String> = Vec::new();
            for g in r["gates"].as_array().into_iter().flatten() {
                let f = |k: &str| g[k].as_str().unwrap_or_default().to_string();
                out.push(format!("{}  {}  {}  {}", f("id"), f("status"), f("task"), f("question")));
                if let Some(res) = g["resolution"].as_str() {
                    out.push(format!("  decided: {res}"));
                }
            }
            if out.is_empty() {
                out.push("no gates".into());
            }
            out.join("\n")
        }
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
        UPDATE => {
            let mut line = format!("{} is {} (was {})", s("taskId"), s("status"), s("previous"));
            if !s("dispatchStatus").is_empty() {
                line += &format!("; {} settled as {}", s("dispatchId"), s("dispatchStatus"));
            }
            line
        }
        STOP => {
            let term = if s("terminal").is_empty() { "its terminal".to_string() } else { s("terminal") };
            let how = match r["process"].as_str() {
                Some("unverifiable") => format!("Kolux has lost touch with {term}, so whether its agent ended cannot be verified"),
                _ => format!("its agent terminal {term} has ended"),
            };
            format!("{} stopped: {how}; the worktree {} stays; {} is {}", s("dispatchId"), s("worktree"), s("taskId"), s("taskStatus"))
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
        "orchestration.reset" => format!("cleared {}: {} task(s), {} dispatch(es), {} message(s), {} run(s)", s("scope"), r["tasks"], r["dispatches"], r["messages"], r["runs"]),
        "app.open" if r["started"] == Value::Bool(true) => "Kolux started and is ready".into(),
        "app.open" => "Kolux is ready; its window is in front".into(),
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
/// ORCH-029: `ask` waits the same way for the answer, resuming its own question each time, and
/// leaves the question open when the time is up.
fn wait_for_mail(port: u16, mut req: Request) -> Result<Value, Fail> {
    let ms = |v: Option<String>| v.and_then(|s| s.trim().parse::<u64>().ok()).filter(|n| *n > 0);
    let timeout = ms(req.args["timeoutMs"].as_str().map(str::to_string)).unwrap_or(WAIT_DEFAULT_MS);
    let every = ms(std::env::var("KOLUX_KEEPALIVE_INTERVAL_MS").ok()).or_else(|| ms(std::env::var("KOLUX_HEARTBEAT_INTERVAL_MS").ok())).unwrap_or(KEEPALIVE_MS);
    let start = Instant::now();
    let mut alive = start;
    loop {
        let mut env = call(port, &req)?;
        let ask = req.command == ASK;
        let done = if ask { env["result"]["status"] != "open" } else { env["result"]["messages"].as_array().is_some_and(|m| !m.is_empty()) };
        if env["success"] != Value::Bool(true) || done {
            return Ok(env);
        }
        let elapsed = start.elapsed().as_millis() as u64;
        if elapsed >= timeout {
            env["result"]["timedOut"] = Value::Bool(true);
            return Ok(env);
        }
        if let Some(a) = req.args.as_object_mut() {
            if ask {
                for k in ["question", "options", "to", "run", "retryRequest"] {
                    a.remove(k);
                }
                a.insert("resume".into(), env["result"]["messageId"].clone());
            } else {
                a.remove("ack");
                a.entry("fence").or_insert_with(|| env["result"]["epoch"].clone());
            }
        }
        if alive.elapsed().as_millis() as u64 >= every {
            eprintln!("{}", json!({ "_keepalive": true, "_heartbeat": true, "elapsedMs": elapsed, "deadlineMs": timeout }));
            alive = Instant::now();
        }
        std::thread::sleep(Duration::from_millis(500.min(timeout - elapsed)));
    }
}

/// ORCH-041: Claude Code with Agent Teams turned on, in the Kolux terminal it is run from; every
/// argument after `claude-teams` goes to Claude untouched. Windows is not supported, and outside a
/// Kolux terminal there is no pane for the team, so both refuse with exit status 1.
// ponytail: teammates always run in-process; the native-panes mode needs Kolux to answer Agent
// Teams' tmux calls (ORCH-042).
fn claude_teams(rest: &[String]) -> i32 {
    if let Err(why) = teams_allowed(cfg!(windows), std::env::var("KOLUX_TERMINAL_HANDLE").ok().filter(|h| !h.is_empty()).is_some()) {
        eprintln!("error: {why}");
        return 1;
    }
    match std::process::Command::new("claude").args(["--teammate-mode", "in-process"]).args(rest).env("CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS", "1").status() {
        Ok(s) => s.code().unwrap_or(1),
        Err(e) => {
            eprintln!("error: Claude Code could not be started ({e}); is it installed and on PATH?");
            1
        }
    }
}

fn teams_allowed(windows: bool, in_kolux: bool) -> Result<(), &'static str> {
    if windows {
        return Err("Claude Agent Teams is not supported on Windows yet; start Claude Code itself instead");
    }
    if !in_kolux {
        return Err("claude-teams has to run in a Kolux terminal: outside one there is no pane for the team");
    }
    Ok(())
}

/// CLI-001: `--version` or `-v` asks for the version only when nothing else is typed.
fn version_only(words: &[String]) -> bool {
    matches!(words, [w] if w == "--version" || w == "-v")
}

/// CLI-001: the command words of a help request, the way `parse` reads them: flags and their
/// values, `help` and `-h` are left out.
fn help_path(words: &[String]) -> Vec<String> {
    let mut path = Vec::new();
    let mut i = 0;
    while i < words.len() {
        let w = &words[i];
        i += 1;
        if let Some(flag) = w.strip_prefix("--") {
            let takes = !flag.contains('=') && !SWITCHES.contains(&flag) && known_flag(flag);
            if takes && i < words.len() && !words[i].starts_with("--") {
                i += 1;
            }
        } else if !w.is_empty() && w != "-h" && !(w == "help" && path.is_empty()) {
            path.push(w.clone());
        }
    }
    path
}

/// The global options, listed under every help.
const GLOBAL: &str = "Global options (every command): --help or -h prints help for the words before it; --json prints one envelope on stdout.\n";

/// CLI-001: help for a group or a command, cut from the usage list (an entry is a usage line and
/// the indented lines under it). An alias shows the command it stands for. A path nothing answers
/// to gets the closest help there is, a suggestion and exit status 1.
fn help(path: &[String]) -> (String, i32) {
    let (title, rest) = HELP.split_once("\n\n").unwrap_or((HELP, ""));
    let (body, footer) = rest.rsplit_once("\n\n").unwrap_or((rest, ""));
    let mut entries: Vec<String> = Vec::new();
    for l in body.lines() {
        match entries.last_mut() {
            Some(e) if !l.starts_with("  kolux-dev ") => {
                e.push('\n');
                e.push_str(l);
            }
            _ => entries.push(l.to_string()),
        }
    }
    // The command paths an entry's first line names, e.g. "repo list | repo add --path <folder>".
    let names = |e: &str| -> Vec<String> {
        let first = e.lines().next().unwrap_or("").trim_start().trim_start_matches("kolux-dev ");
        first.split(" | ").map(|seg| seg.split(' ').take_while(|w| !w.is_empty() && w.chars().all(|c| c.is_ascii_lowercase() || c == '-') && !w.starts_with('-')).collect::<Vec<_>>().join(" ")).filter(|n| !n.is_empty()).collect()
    };
    let all = commands();
    let typed = path.join(" ");
    // An alias answers with the command it stands for: the first path with the same wire name.
    let want = all.iter().find(|c| c.0 == typed).and_then(|c| all.iter().find(|d| d.1 == c.1)).map_or(typed.clone(), |c| c.0.to_string());
    let page = |want: &str| -> Option<String> {
        let hits: Vec<&String> = entries.iter().filter(|e| names(e).iter().any(|n| n == want || n.starts_with(&format!("{want} ")))).collect();
        (!hits.is_empty()).then(|| format!("kolux-dev {want}\n\n{}\n\n{footer}\n{GLOBAL}", hits.iter().map(|e| e.as_str()).collect::<Vec<_>>().join("\n")))
    };
    if path.is_empty() {
        return (format!("{title}\n\n{body}\n\n{footer}\n{GLOBAL}"), 0);
    }
    if let Some(text) = page(&want) {
        return (text, 0);
    }
    // The nearest command in the group typed, else the nearest group or one-word command.
    let group = &path[0];
    let in_group: Vec<&str> = all.iter().filter_map(|c| c.0.strip_prefix(&format!("{group} "))).collect();
    let tops: Vec<&str> = all.iter().map(|c| c.0.split(' ').next().unwrap_or("")).collect();
    let guess = match (in_group.is_empty(), path.get(1)) {
        (false, Some(verb)) => nearest(verb, in_group.iter().copied()).map(|v| format!("{group} {v}")),
        _ => nearest(group, tops.iter().copied()).map(String::from),
    };
    let base = guess.as_deref().and_then(|g| page(g.split(' ').next().unwrap_or(g))).or_else(|| page(group)).unwrap_or_else(|| help(&[]).0);
    let tip = guess.map_or(String::new(), |g| format!("; did you mean kolux-dev {g}?"));
    (format!("no command or group is called kolux-dev {typed}{tip}\n\n{base}"), 1)
}

/// The `kolux-dev` program: parses, talks to the app, prints, and returns the exit status.
pub fn main(words: Vec<String>) -> i32 {
    // APP-059 Compat: the CLI reports the same version as the app and the update manifest.
    if version_only(&words) {
        println!("{}", env!("CARGO_PKG_VERSION"));
        return 0;
    }
    if words.first().map(String::as_str) == Some("claude-teams") {
        return claude_teams(&words[1..]);
    }
    let (json, parsed) = parse(&words);
    let id = request_id();
    let finish = |out: Result<(String, Value), Fail>| -> i32 {
        if let Ok((_, env)) = &out {
            for w in env["result"]["warnings"].as_array().into_iter().flatten().filter_map(Value::as_str) {
                eprintln!("warning: {w}");
            }
        }
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
    let mut parsed = match parsed {
        Ok(Some(p)) => p,
        Ok(None) => {
            let (text, code) = help(&help_path(&words));
            if code == 0 {
                print!("{text}");
            } else {
                eprint!("{text}");
            }
            return code;
        }
        Err(f) => return finish(Err(f)),
    };
    // CLI-042 / CLI-043: these answer from the program itself, so the app may be closed.
    if let Some(out) = local_cli::run(&parsed) {
        return finish(out.map(|v| (parsed.command.clone(), envelope(&id, "", Ok(v)))));
    }
    if !json && parsed.command == "terminal.list" {
        parsed.args.insert("includeVisualLayouts".into(), Value::Bool(true));
    }
    let retry_word = CHANGES.contains(&parsed.command.as_str()).then(|| {
        let id = parsed.args.get("retryRequest").and_then(Value::as_str).map(str::to_string).unwrap_or_else(uuid);
        parsed.args.insert("retryRequest".into(), json!(id));
        id
    });
    let retry_hint = |mut f: Fail| -> Fail {
        if let (Some(id), "lost_result" | "timeout") = (&retry_word, f.code) {
            let mut again: Vec<String> = Vec::new();
            let mut skip = false;
            for w in &words {
                if std::mem::take(&mut skip) {
                    continue;
                }
                if w == "--retry-request" {
                    skip = true;
                } else if !w.starts_with("--retry-request=") {
                    again.push(w.clone());
                }
            }
            let cmd = format!("{} {} --retry-request {id}", crate::orchestration::CLI, retype(&again));
            f.message = format!("{}. It may have taken effect; run this to finish it without doing it twice", f.message);
            f.data = json!({ "hint": cmd, "retryRequest": id });
        }
        f
    };
    let run = || -> Result<(String, Value), Fail> {
        let cwd = std::env::current_dir().map(|p| p.display().to_string()).unwrap_or_default();
        let pane = match (std::env::var("KOLUX_TERMINAL_HANDLE"), std::env::var("KOLUX_PANE_KEY")) {
            (Ok(handle), Ok(key)) if !handle.is_empty() => Some(Pane { handle, key }),
            _ => None,
        };
        if parsed.command == cli_accounts::ADD {
            let (port, token) = read_endpoint(&data_dir())?;
            let ask = |command: &str, args: Value| -> Result<Value, Fail> {
                let r = Request { id: request_id(), token: token.clone(), command: command.into(), cwd: cwd.clone(), args, pane: None, cli: VERSION.into() };
                let env = call(port, &r)?;
                if env["success"] == Value::Bool(true) {
                    return Ok(env["result"].clone());
                }
                Err(Fail::new("failed", env["error"]["message"].as_str().unwrap_or("the app refused the sign-in")))
            };
            let agent = parsed.args["agent"].as_str().unwrap_or("claude").to_string();
            cli_accounts::installed(&agent)?;
            let out = cli_accounts::add(&agent, ask, |temp| cli_accounts::run_login(&agent, temp));
            return Ok((parsed.command.clone(), envelope(&id, "", out)));
        }
        let mut args = parsed.args.clone();
        if json && parsed.command == "worktree.ps" {
            // ORCH-040: only a JSON poll may get the short "unchanged" answer; text is always whole.
            args.insert("json".into(), json!(true));
        }
        if (parsed.command == CHECK && parsed.args.contains_key("wait")) || parsed.command == ASK {
            let (port, token) = read_endpoint(&data_dir())?;
            let req = Request { id: id.clone(), token, command: parsed.command.clone(), cwd, args: Value::Object(args), pane, cli: VERSION.into() };
            return Ok((parsed.command.clone(), wait_for_mail(port, req)?));
        }
        let send = || {
            let (port, token) = read_endpoint(&data_dir())?;
            call(port, &Request { id: id.clone(), token, command: parsed.command.clone(), cwd: cwd.clone(), args: Value::Object(args.clone()), pane: pane.clone(), cli: VERSION.into() })
        };
        let env = if parsed.command == "app.open" { open(&send, &launch_app, OPEN_LIMIT)? } else { send()? };
        Ok((parsed.command.clone(), env))
    };
    let out = run().map_err(retry_hint);
    let advice = out.as_ref().err().and_then(|f| open_first(f, &parsed.command)).filter(|_| !json);
    let code = finish(out);
    if let Some(a) = advice {
        eprintln!("{a}");
    }
    code
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
    /// Shows the window, restored and in front.
    pub front: &'a (dyn Fn() -> Result<(), String> + Sync),
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
        // A project whose folder is gone or unreadable has no worktrees to match; it must not stop
        // every other lookup.
        for w in projects::list_workspaces(ctx.git, &store, &p).unwrap_or_default() {
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
            // PROJ-038: a prompt with no agent named goes to the default agent, else the first
            // installed one in catalogue order; a worktree made with neither gets no agent tab.
            let agent = match text("agent") {
                Some(id) => Some(installed_agent(&id).map(|_| id)?),
                None if text("prompt").is_some() => Some(fallback_agent(ctx)?.id),
                None => None,
            };
            let project = pick_project(ctx, text("repo").as_deref(), &req.cwd)?;
            // PROJ-037: --issue with no --name names the worktree after the issue's title.
            let issue = text("issue").and_then(|v| v.parse::<u64>().ok());
            let name = match (text("name"), issue) {
                (Some(n), _) => n,
                (None, Some(n)) => crate::pr_checkout::issue(&crate::scm::gh_program().map_err(|e| Fail::new("failed", e))?, Path::new(&project.path), n).map_err(|e| Fail::new("failed", e))?.title,
                (None, None) => return Err(Fail::args("--name is required")),
            };
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
            // PROJ-033: the window runs the setup script in a Setup tab unless it is skipped;
            // --run-hooks runs it as --setup run does. Issue lookups (PROJ-037) are T-107-c.
            let mut setup = text("setup").unwrap_or_else(|| "inherit".into());
            if a["runHooks"].as_bool().unwrap_or(false) {
                setup = "run".into();
            }
            obj.insert("setup".into(), json!(setup));
            obj.insert("warnings".into(), json!([]));
            (ctx.notify)(json!({ "kind": "created", "projectId": project.id, "worktree": made, "agent": agent, "prompt": text("prompt").unwrap_or_default(), "activate": activate, "setup": setup }));
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
            let warnings: Vec<&str> = if a["runHooks"].as_bool().unwrap_or(false) { vec!["--run-hooks: teardown scripts do not run yet; the worktree was removed without them"] } else { vec![] };
            Ok(json!({ "path": w.path, "branch": w.branch, "name": w.name, "projectId": project.id, "branchKept": keep && w.branch.is_some(), "warnings": warnings }))
        }
        "app.open" => {
            (ctx.front)()?;
            Ok(json!({ "ready": true, "started": false, "pid": std::process::id() }))
        }
        WORKER_START => worker_start_once(ctx, req),
        c if QUERY.iter().any(|(_, w, _)| *w == c) => query(ctx, req),
        c if c.starts_with("orchestration.") => mail(ctx, req),
        c if c.starts_with("account.") => cli_accounts::dispatch(ctx, req),
        c if c.starts_with("automations.") => automations_cli::dispatch(ctx, req),
        c if c.starts_with("terminal.") => terminal_cmd(ctx, req),
        other => Err(Fail::args(format!("unknown command {other}"))),
    }
}

// ---------------------------------------------------------------- terminals (CLI-023, CLI-026, CLI-027)

/// How long a terminal command waits for the window to act on it.
const PANE_WAIT: Duration = Duration::from_secs(15);

fn no_terminal(h: &str) -> Fail {
    Fail { code: "not_found", message: format!("no open terminal is {h}"), data: json!({ "hint": "kolux-dev terminal list prints the handles" }) }
}

/// CLI-026: one-shot forms of a startup command (exec, print, review, help) stay in the background.
fn one_shot(command: &str) -> bool {
    command.split_whitespace().skip(1).any(|w| ["exec", "review", "help", "-p", "--print", "--help", "-h"].contains(&w))
}

/// CLI-023: every open terminal with its worktree and where the window shows it: its pane (a cell
/// of the worktree's grid, counted from 1), its tab inside that pane, and whether it is in view.
fn terminal_rows(ctx: &Ctx) -> Result<Vec<Value>, Fail> {
    let mut trees: Vec<(String, Option<String>)> = Vec::new();
    {
        let store = ctx.store.lock().map_err(|e| e.to_string())?;
        for p in projects::load_projects(&store) {
            trees.extend(projects::list_workspaces(ctx.git, &store, &p).unwrap_or_default().into_iter().map(|w| (w.path, w.branch)));
        }
    }
    let layout = ctx.terminals.layout();
    Ok(ctx
        .terminals
        .every()
        .into_iter()
        .map(|(handle, dir, program)| {
            let at = layout.iter().find(|r| r["handle"] == handle.as_str()).cloned().unwrap_or(Value::Null);
            let home = dir.as_deref().and_then(|d| trees.iter().filter(|(w, _)| under(w, d)).max_by_key(|(w, _)| w.len()));
            json!({ "handle": handle, "title": at["title"], "worktree": home.map(|h| h.0.clone()), "branch": home.and_then(|h| h.1.clone()), "cwd": dir, "program": program, "host": "local", "pane": at["cell"], "tab": at["tab"], "shown": at["shown"].as_bool().unwrap_or(false) })
        })
        .collect())
}

/// CLI-023: worktree, then pane, then the tabs inside it, each in window order.
fn layouts(rows: &[Value]) -> Value {
    let mut out: Vec<Value> = Vec::new();
    for r in rows {
        let i = out.iter().position(|w| w["worktree"] == r["worktree"]).unwrap_or_else(|| {
            out.push(json!({ "worktree": r["worktree"], "panes": [] }));
            out.len() - 1
        });
        let panes = out[i]["panes"].as_array_mut().expect("panes is a list");
        let j = panes.iter().position(|p| p["pane"] == r["pane"]).unwrap_or_else(|| {
            panes.push(json!({ "pane": r["pane"], "tabs": [] }));
            panes.len() - 1
        });
        panes[j]["tabs"].as_array_mut().expect("tabs is a list").push(json!({ "tab": r["tab"], "handle": r["handle"], "title": r["title"], "shown": r["shown"] }));
    }
    for w in &mut out {
        let panes = w["panes"].as_array_mut().expect("panes is a list");
        panes.sort_by_key(|p| p["pane"].as_u64().unwrap_or(u64::MAX));
        for p in panes {
            p["tabs"].as_array_mut().expect("tabs is a list").sort_by_key(|t| t["tab"].as_u64().unwrap_or(u64::MAX));
        }
    }
    Value::Array(out)
}

/// Waits for the window's layout to show what found looks for.
fn await_layout(ctx: &Ctx, what: &str, found: impl Fn(&Value) -> Option<Result<Value, Fail>>) -> Result<Value, Fail> {
    let until = Instant::now() + PANE_WAIT;
    loop {
        if let Some(out) = ctx.terminals.layout().iter().find_map(&found) {
            return out;
        }
        if Instant::now() >= until {
            return Err(Fail { code: "timeout", message: format!("the window did not {what} within 15 seconds"), data: json!({ "hint": "it may still happen; kolux-dev terminal list shows what is open" }) });
        }
        std::thread::sleep(Duration::from_millis(100));
    }
}

/// The pane the window opened for request ask, or why it could not.
fn await_pane(ctx: &Ctx, ask: &str) -> Result<Value, Fail> {
    await_layout(ctx, "open the terminal", |r| {
        (r["ask"] == ask).then(|| r["error"].as_str().map_or(Ok(r.clone()), |e| Err(Fail::new("failed", e)))).filter(|out| out.is_err() || r["handle"].is_string())
    })
}

fn terminal_cmd(ctx: &Ctx, req: &Request) -> Result<Value, Fail> {
    let a = &req.args;
    let text = |k: &str| a[k].as_str().map(str::trim).filter(|s| !s.is_empty()).map(str::to_string);
    let live = |h: &str| if ctx.terminals.live(h) { Ok(()) } else { Err(no_terminal(h)) };
    let handle = text("terminal").unwrap_or_default();
    match req.command.as_str() {
        "terminal.list" => {
            let only = text("worktree").map(|s| pick_worktree(ctx, &s, &req.cwd)).transpose()?;
            let mut rows: Vec<Value> = terminal_rows(ctx)?.into_iter().filter(|r| only.as_ref().is_none_or(|(_, w)| r["worktree"].as_str().is_some_and(|x| same_dir(x, &w.path)))).collect();
            let total = rows.len();
            if let Some(n) = text("limit").and_then(|l| l.parse::<usize>().ok()) {
                rows.truncate(n);
            }
            let mut out = json!({ "terminals": rows, "truncated": total > rows.len(), "scope": only.map(|(_, w)| w.path), "hosts": hosts() });
            if a["includeVisualLayouts"] == true {
                out["layouts"] = layouts(&rows);
            }
            Ok(out)
        }
        "terminal.show" => terminal_rows(ctx)?.into_iter().find(|r| r["handle"] == handle.as_str()).ok_or_else(|| no_terminal(&handle)),
        "terminal.create" => {
            let (_, w) = pick_worktree(ctx, &text("worktree").unwrap_or_else(|| "current".into()), &req.cwd)?;
            crate::pty::check_start_dir(&w.path, false)?;
            let command = text("command");
            let asked = a["focus"] == true;
            let quiet = command.as_deref().is_some_and(one_shot);
            let focus = asked && !quiet;
            (ctx.notify)(json!({ "kind": "terminal-create", "path": w.path, "branch": w.branch, "command": command, "title": text("title"), "focus": focus, "ask": req.id }));
            let row = await_pane(ctx, &req.id)?;
            if focus {
                (ctx.front)()?;
            }
            let note = (asked && quiet).then_some("a one-shot command stays in the background, so it was not brought into view");
            Ok(json!({ "handle": row["handle"], "worktree": w.path, "branch": w.branch, "command": command, "title": row["title"], "pane": row["cell"], "tab": row["tab"], "focused": focus, "note": note }))
        }
        "terminal.split" => {
            live(&handle)?;
            let direction = text("direction").unwrap_or_else(|| "vertical".into());
            let dir = if direction == "horizontal" { "down" } else { "right" };
            (ctx.notify)(json!({ "kind": "terminal-split", "handle": handle, "dir": dir, "command": text("command"), "ask": req.id }));
            let row = await_pane(ctx, &req.id)?;
            Ok(json!({ "handle": row["handle"], "from": handle, "direction": direction, "pane": row["cell"], "tab": row["tab"], "focused": false }))
        }
        "terminal.rename" => {
            live(&handle)?;
            let title = text("title");
            (ctx.notify)(json!({ "kind": "terminal-rename", "handle": handle, "title": title }));
            let want = json!(title);
            let row = await_layout(ctx, "rename the terminal", |r| (r["handle"] == handle.as_str() && r["custom"] == want).then(|| Ok(r.clone())))?;
            Ok(json!({ "handle": handle, "title": row["title"], "default": title.is_none() }))
        }
        "terminal.switch" => {
            live(&handle)?;
            (ctx.notify)(json!({ "kind": "terminal-switch", "handle": handle }));
            (ctx.front)()?;
            let row = await_layout(ctx, "bring the terminal into view", |r| (r["handle"] == handle.as_str() && r["shown"] == true).then(|| Ok(r.clone())))?;
            Ok(json!({ "handle": handle, "title": row["title"], "shown": true }))
        }
        "terminal.close" => {
            let rows = terminal_rows(ctx)?;
            let of = |r: &Value| r["handle"].as_str().unwrap_or_default().to_string();
            let targets: Vec<String> = if handle.is_empty() {
                let (_, w) = pick_worktree(ctx, &text("worktree").unwrap_or_default(), &req.cwd)?;
                rows.iter().filter(|r| r["worktree"].as_str().is_some_and(|x| same_dir(x, &w.path))).map(of).collect()
            } else {
                let row = rows.iter().find(|r| r["handle"] == handle.as_str()).ok_or_else(|| no_terminal(&handle))?;
                if a["tab"] == true && !row["pane"].is_null() {
                    rows.iter().filter(|r| r["cwd"] == row["cwd"] && r["pane"] == row["pane"]).map(of).collect()
                } else {
                    vec![handle.clone()]
                }
            };
            // The terminal this command runs in is left open: closing it would cut off the answer.
            let me = caller(ctx, req).ok().flatten();
            let (mine, targets): (Vec<String>, Vec<String>) = targets.into_iter().partition(|h| me.as_deref() == Some(h.as_str()));
            if targets.is_empty() && !mine.is_empty() && !handle.is_empty() {
                return Err(Fail::args(format!("{handle} is the terminal this command runs in; close it from another terminal or from the window")));
            }
            let (closed, alive): (Vec<String>, Vec<String>) = targets.iter().cloned().partition(|h| ctx.terminals.close(h));
            (ctx.notify)(json!({ "kind": "terminal-close", "handles": targets }));
            let out = json!({ "closed": closed, "notConfirmed": alive, "leftOpen": mine, "note": a["note"] });
            if !alive.is_empty() {
                return Err(Fail { code: "failed", message: format!("{} terminal(s) may still be running: {}", alive.len(), alive.join(", ")), data: out });
            }
            Ok(out)
        }
        other => Err(Fail::args(format!("unknown command {other}"))),
    }
}

/// The readable form of the terminal commands' answers.
fn terminal_text(command: &str, r: &Value) -> Option<String> {
    let s = |v: &Value, k: &str| v[k].as_str().unwrap_or_default().to_string();
    let list = |k: &str| r[k].as_array().cloned().unwrap_or_default().iter().filter_map(|h| h.as_str().map(String::from)).collect::<Vec<_>>();
    let mut lines: Vec<String> = Vec::new();
    match command {
        "terminal.list" => {
            let rows = r["terminals"].as_array().cloned().unwrap_or_default();
            if rows.is_empty() {
                lines.push(format!("no terminals open in {}", r["scope"].as_str().unwrap_or("any worktree")));
            } else if let Some(trees) = r["layouts"].as_array() {
                for w in trees {
                    lines.push(w["worktree"].as_str().unwrap_or("(outside every worktree)").to_string());
                    for p in w["panes"].as_array().into_iter().flatten() {
                        lines.push(p["pane"].as_u64().map_or("  (not in the window yet)".into(), |n| format!("  pane {n}")));
                        for t in p["tabs"].as_array().into_iter().flatten() {
                            lines.push(format!("    {}  {}{}", s(t, "handle"), s(t, "title"), if t["shown"] == true { "  (in view)" } else { "" }));
                        }
                    }
                }
            } else {
                lines.extend(rows.iter().map(|t| format!("{}  {}  {}", s(t, "handle"), s(t, "title"), t["worktree"].as_str().unwrap_or("-"))));
            }
            if r["truncated"] == true {
                lines.push("(more not shown; raise --limit)".into());
            }
            lines.push("hosts covered: local; none left out".into());
        }
        "terminal.show" => {
            lines.push(format!("{}  {}", s(r, "handle"), s(r, "title")));
            lines.push(format!("worktree {} · pane {} tab {} · host {}{}", r["worktree"].as_str().unwrap_or("none"), r["pane"], r["tab"], s(r, "host"), if r["shown"] == true { " · in view" } else { "" }));
        }
        "terminal.create" => lines.push(format!("opened {} in {}{}", s(r, "handle"), s(r, "worktree"), if r["focused"] == true { " and brought it into view" } else { " in the background" })),
        "terminal.split" => lines.push(format!("split {}: {} opened {}", s(r, "from"), s(r, "handle"), if s(r, "direction") == "horizontal" { "below it" } else { "beside it" })),
        "terminal.rename" => lines.push(if r["default"] == true { format!("{} has its default name back: {}", s(r, "handle"), s(r, "title")) } else { format!("{} is now called {}", s(r, "handle"), s(r, "title")) }),
        "terminal.switch" => lines.push(format!("{} is in view", s(r, "handle"))),
        "terminal.close" => {
            let closed = list("closed");
            lines.push(if closed.is_empty() { "nothing was open there to close".into() } else { format!("closed and confirmed stopped: {}", closed.join(", ")) });
            let mine = list("leftOpen");
            if !mine.is_empty() {
                lines.push(format!("left open: {} (the terminal this command runs in)", mine.join(", ")));
            }
        }
        _ => return None,
    }
    if let Some(n) = r["note"].as_str() {
        lines.push(format!("note: {n}"));
    }
    Some(lines.join("\n"))
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
        let forecast = if ctx.git.predicts_merges() {
            crate::scm::clash(Path::new(&p.path), &w.head, &s.head)
        } else {
            crate::scm::Clash::Unverifiable(format!("{} is older than 2.38, which predicting a merge needs", ctx.git.version))
        };
        let (clash, conflicts, why) = match forecast {
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
        "orchestration.request-show" => m.request_show(&pane.clone().unwrap_or_default(), &text("request").ok_or_else(|| Fail::args("--request is required"))?, u64::from(std::process::id())),
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
        RESET => {
            let scope = SCOPES.into_iter().find(|k| a[*k] == true).ok_or_else(|| Fail::args("reset needs exactly one scope: --all, --tasks or --messages"))?;
            reset(&store, &mut m, scope)?
        }
        ASK => {
            let p = need()?;
            let dispatches = load_list(&store, DISPATCHES_KEY);
            let peers = peers(ctx);
            m.once(retry, |m| m.ask(&p, a, &dispatches, &peers, now_ms()))?
        }
        "orchestration.task-create" | "orchestration.task-list" | "orchestration.dispatch" | "orchestration.dispatch-show" | ABANDON | UPDATE | STOP | "orchestration.gate-create" | "orchestration.gate-resolve" | "orchestration.gate-list" => tasks(ctx, &store, &mut m, req, pane.as_deref(), retry)?,
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

/// CLI-038: clears one scope of orchestration state, and the remembered answers of its changes.
fn reset(store: &Store, m: &mut crate::orchestration::Mail, scope: &str) -> Result<Value, Fail> {
    let (mut tasks, mut dispatches, mut messages, mut runs) = (0, 0, 0, 0);
    if scope != "messages" {
        tasks = load_list(store, TASKS_KEY).len();
        dispatches = load_list(store, DISPATCHES_KEY).len();
        save_list(store, TASKS_KEY, &[])?;
        save_list(store, DISPATCHES_KEY, &[])?;
    }
    if scope != "tasks" {
        messages = m.messages.len();
        m.messages.clear();
        m.deliveries.clear();
    }
    if scope == "all" {
        runs = m.runs.len();
        m.runs.clear();
        m.bindings.clear();
    }
    let of_tasks = ["orchestration.task-create|", "orchestration.dispatch|", "orchestration.worker-start|"];
    let of_messages = ["orchestration.send|", "orchestration.reply|"];
    m.answers.retain(|k, _| match scope {
        "tasks" => !of_tasks.iter().any(|p| k.starts_with(p)),
        "messages" => !of_messages.iter().any(|p| k.starts_with(p)),
        _ => false,
    });
    // ORCH: the mail side's own reset (gates for tasks; everything for all), after the counts.
    m.reset(scope)?;
    Ok(json!({ "scope": scope, "tasks": tasks, "dispatches": dispatches, "messages": messages, "runs": runs }))
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
    let changes = !["orchestration.task-list", "orchestration.dispatch-show", "orchestration.gate-list"].contains(&req.command.as_str()) && a["dryRun"] != true;
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
        UPDATE => {
            let id = text("id").ok_or_else(|| Fail::args("--id is required"))?;
            let to = text("status").ok_or_else(|| Fail::args("--status is required"))?;
            let result = a["result"].as_str().map(str::to_string);
            m.once(retry, |_| {
                let out = o::task_update(&mut tasks, &mut dispatches, &id, &to, result.as_deref(), run.as_deref(), pane, now_ms())?;
                o::promote(&mut tasks);
                Ok(out)
            })?
        }
        STOP => {
            let id = text("dispatch").ok_or_else(|| Fail::args("--dispatch is required"))?;
            m.once(retry, |_| {
                let (mut receipt, kill) = o::stop(&mut tasks, &mut dispatches, &id, run.as_deref(), now_ms())?;
                // ORCH-022: the agent terminal ends while the store is held, so its exit is never
                // taken for a worker that died by itself.
                if let Some(tid) = kill {
                    let ended = ctx.terminals.live(&crate::terminal::handle_of(tid)) && ctx.terminals.kill(tid).is_ok();
                    if !ended {
                        receipt["process"] = json!("unverifiable");
                        if let Some(d) = dispatches.iter_mut().find(|d| d["id"] == id.as_str()) {
                            d["process"] = json!("unverifiable");
                        }
                    }
                }
                Ok(receipt)
            })?
        }
        "orchestration.gate-create" => m.once(retry, |m| m.gate_create(run.as_deref(), &mut tasks, &dispatches, a, now_ms()))?,
        "orchestration.gate-resolve" => m.once(retry, |m| m.gate_resolve(run.as_deref(), &mut tasks, a, now_ms()))?,
        "orchestration.gate-list" => m.gate_list(run.as_deref(), a)?,
        other => return Err(Fail::args(format!("unknown command {other}"))),
    };
    // ORCH-012: a task and its dispatch change together or not at all.
    let (t, d) = (Value::Array(tasks).to_string(), Value::Array(dispatches).to_string());
    store.set_all(&[(TASKS_KEY, &t), (DISPATCHES_KEY, &d)]).map_err(|e| Fail::new("failed", e.to_string()))?;
    Ok(out)
}

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

/// ORCH-027: a worker's own terminal ended by itself (not closed by Kolux) before the worker
/// reported done: one high-priority escalation to its Run, its subject naming the task by title
/// (or id), so the coordinator can retry or reassign it. The dispatch is stamped so it never sends
/// twice. A dispatch with no Run, from an earlier start of Kolux, or already settled sends nothing.
pub(crate) fn worker_exited(store: &Store, terminal: u32, code: Option<u32>, now: u64) -> Option<Value> {
    let me = u64::from(std::process::id());
    let mut dispatches = load_list(store, DISPATCHES_KEY);
    let d = dispatches.iter_mut().rev().find(|d| d["terminal"].as_u64() == Some(u64::from(terminal)) && d["runtime"].as_u64() == Some(me))?;
    let (id, task_id) = (d["id"].as_str()?.to_string(), d["taskId"].as_str().unwrap_or_default().to_string());
    let run = d["runId"].as_str()?.to_string();
    if !d["exitedAt"].is_null() || crate::orchestration::finished(d) {
        return None;
    }
    let mut mail = crate::orchestration::Mail::load(store);
    if mail.messages.iter().any(|m| m.kind == "worker_done" && m.extras.get("dispatchId").and_then(Value::as_str) == Some(id.as_str())) {
        return None;
    }
    d["exitedAt"] = json!(now);
    let worktree = d["worktree"].as_str().unwrap_or_default().to_string();
    let tasks = load_list(store, TASKS_KEY);
    let title = tasks.iter().find(|t| t["id"] == task_id.as_str()).and_then(|t| t["title"].as_str()).filter(|t| !t.trim().is_empty()).unwrap_or(&task_id).to_string();
    let how = code.map(|c| format!("with exit code {c}")).unwrap_or_else(|| "without an exit code".into());
    let body = format!(
        "The worker on {task_id} ({id}, in {worktree}) ended {how} before it reported done. Retry it with `{cli} orchestration worker-start --retry-of {id} --task {task_id}`, or hand the task to someone else.",
        cli = crate::orchestration::CLI
    );
    let a = json!({ "to": format!("run:{run}"), "subject": format!("Worker ended: {title}"), "body": body, "type": "escalation", "priority": "high", "taskId": task_id, "dispatchId": id });
    let sent = mail.send(&crate::terminal::handle_of(terminal), &a, &dispatches, &|_| false, now).ok()?;
    mail.save(store).ok()?;
    save_list(store, DISPATCHES_KEY, &dispatches).ok()?;
    Some(json!({ "dispatchId": id, "messageIds": sent["messageIds"] }))
}

pub(crate) fn next_id(list: &[Value], prefix: &str) -> String {
    let n = list.iter().filter_map(|t| t["id"].as_str()?.strip_prefix(prefix)?.parse::<u64>().ok()).max().unwrap_or(0);
    format!("{prefix}{}", n + 1)
}

/// The settings' default agent id (`claude` when none is set).
fn default_agent(ctx: &Ctx) -> Result<String, Fail> {
    let store = ctx.store.lock().map_err(|e| e.to_string())?;
    Ok(store.settings()["defaultAgent"].as_str().filter(|s| !s.is_empty()).unwrap_or("claude").to_string())
}

/// PROJ-038's fallback when no agent is named: the default agent when it is installed, else the
/// first installed one in catalogue order.
fn fallback_agent(ctx: &Ctx) -> Result<crate::agents::AgentInfo, Fail> {
    let wanted = default_agent(ctx)?;
    let list = crate::agents::agent_list();
    let hit = list.iter().find(|x| x.id == wanted && x.installed).or_else(|| list.iter().find(|x| x.installed));
    hit.cloned().ok_or_else(|| Fail::new("failed", "no agent is installed to take the prompt; install one or pass --agent"))
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

/// ORCH-030: a worker start with `--retry-request` is entered in the ledger while it runs, so a
/// repeat with the same id waits for the first and hands back its receipt instead of starting a
/// second worker. A start turned away leaves no receipt; one that timed out keeps its outcome. A
/// start left pending by an earlier run of Kolux is over (its terminals went with it): it runs fresh.
fn worker_start_once(ctx: &Ctx, req: &Request) -> Result<Value, Fail> {
    let Some(id) = req.args["retryRequest"].as_str().map(str::trim).filter(|s| !s.is_empty()) else { return worker_start(ctx, req) };
    let key = format!("{}|{}|{id}", req.command, caller(ctx, req)?.unwrap_or_default());
    let me = u64::from(std::process::id());
    let until = Instant::now() + Duration::from_secs(300);
    loop {
        let store = ctx.store.lock().map_err(|e| e.to_string())?;
        let mut m = crate::orchestration::Mail::load(&store);
        if let Some(v) = m.answers.get(&key) {
            return match v.get("timedOut") {
                Some(f) => Err(Fail { code: "timeout", message: f["message"].as_str().unwrap_or_default().to_string(), data: f["data"].clone() }),
                None => Ok(v.clone()),
            };
        }
        if m.pending.get(&key).is_some_and(|p| p["runtime"].as_u64() == Some(me)) {
            drop(store);
            if Instant::now() > until {
                return Err(Fail::new("pending", format!("the start with request {id} is still under way; ask with {} orchestration request-show --request {id}", crate::orchestration::CLI)));
            }
            std::thread::sleep(Duration::from_millis(250));
            continue;
        }
        m.begin(&key, me)?;
        m.save(&store)?;
        break;
    }
    let out = worker_start(ctx, req);
    let store = ctx.store.lock().map_err(|e| e.to_string())?;
    let mut m = crate::orchestration::Mail::load(&store);
    let kept = match &out {
        Ok(v) => Some(v.clone()),
        Err(f) if f.code == "timeout" => Some(json!({ "timedOut": { "message": f.message, "data": f.data } })),
        Err(_) => None,
    };
    m.finish(&key, kept);
    m.save(&store)?;
    out
}

fn worker_start(ctx: &Ctx, req: &Request) -> Result<Value, Fail> {
    let a = &req.args;
    let text = |k: &str| a[k].as_str().map(str::trim).filter(|s| !s.is_empty()).map(str::to_string);
    if let Some(to) = text("terminal") {
        return reuse(ctx, req, &to);
    }
    let default = default_agent(ctx)?;
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
            // CLI-038: an app older than the CLI turns a change away before it runs.
            Ok(req) if CHANGES.contains(&req.command.as_str()) && newer(&req.cli, VERSION) => {
                (req.id, Err(Fail { code: "version_gap", message: format!("this Kolux ({VERSION}) is older than the command line ({}); update Kolux before sending orchestration changes", req.cli), data: json!({ "appVersion": VERSION, "cliVersion": req.cli }) }))
            }
            Ok(req) => (req.id.clone(), handle(&req)),
            Err(e) => (String::new(), Err(Fail::args(format!("malformed request: {e}")))),
        };
        let mut reply = envelope(&id, runtime, out);
        reply["meta"]["appVersion"] = json!(VERSION);
        let reply = reply.to_string();
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
            // A change made for another view names its own event (the Automations page's, CLI-029).
            let notify = |v: Value| {
                if v["kind"] == "accounts" {
                    let _ = app.emit(crate::claude_accounts::EVENT, ());
                    let _ = app.emit(crate::codex_accounts::EVENT, ());
                } else {
                    let _ = match v["emit"].as_str() {
                        Some(event) => app.emit(event, v["payload"].clone()),
                        None => app.emit(EVENT, v),
                    };
                }
            };
            let front = || -> Result<(), String> {
                let w = app.get_webview_window("main").ok_or("the Kolux window is gone")?;
                let _ = w.unminimize();
                w.show().and_then(|_| w.set_focus()).map_err(|e| e.to_string())
            };
            dispatch(&Ctx { claude_config: crate::trust::claude_config_file(), git: &git, store: &store, terminals: &terminals, notify: &notify, front: &front }, req)
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

    /// CLI-023, CLI-026, CLI-027: the terminal words, their flags, focus as switch and stop as a
    /// hidden close that says what replaced it.
    #[test]
    fn the_terminal_commands_are_checked_before_the_app_is_asked() {
        let ok = |s: &str| parse(&words(s)).1.unwrap().unwrap();
        let refused = |s: &str| parse(&words(s)).1.unwrap_err().message;
        let p = ok("terminal list --worktree name:a --limit 2 --include-visual-layouts");
        assert_eq!((p.command.as_str(), &p.args["worktree"], &p.args["limit"], &p.args["includeVisualLayouts"]), ("terminal.list", &json!("name:a"), &json!("2"), &json!(true)));
        let p = ok("terminal create --worktree active --command codex --title Review --focus");
        assert_eq!((p.command.as_str(), &p.args["command"], &p.args["focus"]), ("terminal.create", &json!("codex"), &json!(true)));
        assert_eq!(ok("terminal focus --terminal term-3").command, "terminal.switch");
        assert_eq!(ok("terminal rename --terminal term-3").args.get("title"), None);
        assert_eq!(ok("terminal split --terminal term-3 --direction horizontal").args["direction"], "horizontal");
        assert!(refused("terminal split --terminal term-3 --direction sideways").contains("horizontal or vertical"));
        assert!(refused("terminal show").contains("--terminal is required"));
        assert!(refused("terminal close").contains("say what to close"));
        assert!(refused("terminal close --all").contains("go together"));
        assert!(refused("terminal close --tab --worktree name:a --all").contains("--tab"));
        assert!(refused("terminal close --terminal term-1 --worktree name:a --all").contains("not both"));
        assert_eq!(ok("terminal close --terminal term-1 --tab").args["tab"], true);
        assert!(refused("terminal list --limit 0").contains("above zero"));
        assert!(refused("terminal create --colour red").contains("unknown flag"));
        // the old word: hidden, still explains itself, and with a target it closes with a note
        assert!(refused("terminal stop").contains("replaced by terminal close"));
        let p = ok("terminal stop --worktree name:a --all");
        assert_eq!(p.command, "terminal.close");
        assert!(p.args["note"].as_str().unwrap().contains("terminal close"));
        assert!(!HELP.contains("terminal stop") && HELP.contains("terminal close"));
        assert!(one_shot("codex exec fix it") && one_shot("claude -p hi") && !one_shot("codex") && !one_shot("claude --model opus"));
    }

    /// CLI-023: the readable listing nests tabs under their pane, worktree by worktree, and an
    /// empty one says what it looked at.
    #[test]
    fn the_terminal_listing_draws_panes_with_their_tabs() {
        let row = |h: &str, wt: &str, pane: u64, tab: u64, shown: bool| json!({ "handle": h, "title": format!("T {h}"), "worktree": wt, "pane": pane, "tab": tab, "shown": shown });
        let rows = vec![row("term-4", "C:/a", 2, 1, false), row("term-2", "C:/a", 1, 2, true), row("term-1", "C:/a", 1, 1, false), row("term-9", "C:/b", 1, 1, true)];
        let out = json!({ "terminals": rows, "layouts": layouts(&rows), "hosts": hosts() });
        let text = terminal_text("terminal.list", &out).unwrap();
        assert_eq!(text, "C:/a\n  pane 1\n    term-1  T term-1\n    term-2  T term-2  (in view)\n  pane 2\n    term-4  T term-4\nC:/b\n  pane 1\n    term-9  T term-9  (in view)\nhosts covered: local; none left out");
        let empty = terminal_text("terminal.list", &json!({ "terminals": [], "scope": "C:/a" })).unwrap();
        assert!(empty.starts_with("no terminals open in C:/a") && empty.ends_with("none left out"));
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
        // T-014-b-fix: a prompt with no --agent goes to the app, which picks the agent (PROJ-038).
        assert_eq!(parse(&words("worktree create --name x --prompt hi")).1.unwrap().unwrap().args["prompt"], "hi");
        assert!(refused("worktree create --name x --name y").contains("twice"));
        assert!(refused("worktree create --name x --bogus 1").contains("--bogus"));
        assert!(refused("worktree create --name x --setup later").contains("run, skip or inherit"));
        // PROJ-037: --issue alone is enough; the app names the worktree after the issue's title.
        assert!(refused("worktree create --agent claude").contains("--name is required (or --issue"));
        assert_eq!(parse(&words("worktree create --issue 7")).1.unwrap().unwrap().args["issue"], "7");
        assert!(refused("worktree create --name x --no-parent --parent-worktree name:a").contains("disagree"));
        assert!(refused("worktree create --name x --parent-workspace name:a").contains("retired"));
        assert!(refused("worktree create --name x --parent-worktree").contains("needs a value"));
        assert!(refused("worktree create --name x --parent-worktree=").contains("empty"));
        assert!(refused("worktree create --name x --issue abc").contains("issue number"));
        assert!(refused("worktree create --name x --issue 0").contains("issue number"));
        assert_eq!(parse(&words("worktree create --name x --issue 12 --no-parent")).1.unwrap().unwrap().args["noParent"], true);
        assert!(refused("worktree rm").contains("--worktree"));
        assert!(refused("worktree frobnicate").contains("unknown command"));
        assert_eq!(parse(&words("open --json")).1.unwrap().unwrap().command, "app.open");
        assert!(refused("open --name x").contains("unknown flag --name"));
        assert!(parse(&words("--help")).1.unwrap().is_none());
        assert!(parse(&words("help worktree")).1.unwrap().is_none());
    }

    #[test]
    fn help_answers_on_every_level_of_the_command_tree() {
        let h = |s: &str| help(&help_path(&words(s)));
        // The overview: every group, and the global options.
        let (all, code) = h("--help");
        assert_eq!(code, 0);
        assert!(all.contains("Global options") && all.contains("--help") && all.contains("--json"), "{all}");
        assert_eq!(h(""), h("help"));
        // A group lists its commands and nothing else.
        let (wt, code) = h("worktree --help");
        assert_eq!(code, 0);
        for verb in ["list", "show", "current", "create", "rm", "ps", "changes", "overlap"] {
            assert!(wt.contains(&format!("worktree {verb}")), "worktree help lacks {verb}: {wt}");
        }
        assert!(!wt.contains("orchestration send") && wt.contains("Global options"), "{wt}");
        assert_eq!(h("help worktree"), h("worktree --help"), "help <path> and <path> --help agree");
        // A command, with its flags and its global options; an alias finds the command it stands for.
        let (create, code) = h("worktree create --name x --help");
        assert_eq!(code, 0);
        assert!(create.contains("--base-branch") && !create.contains("worktree rm"), "{create}");
        assert_eq!(h("worktree delete --help"), h("worktree rm --help"));
        assert_eq!(h("skills show -h"), h("skills get -h"));
        // Every command can be found from its own group's help.
        for (path, _, _) in commands() {
            let group = path.split(' ').next().unwrap();
            let (text, code) = h(&format!("help {group}"));
            assert_eq!(code, 0, "{group}");
            assert!(text.contains(path.rsplit(' ').next().unwrap()), "{path} is missing from the {group} help");
            assert_eq!(h(&format!("help {path}")).1, 0, "{path}");
        }
        // A path nothing answers to: the closest help, a suggestion, exit 1.
        let (typo, code) = h("help worktree craete");
        assert_eq!(code, 1);
        assert!(typo.contains("did you mean kolux-dev worktree create") && typo.contains("worktree list"), "{typo}");
        let (typo, code) = h("help wrktree");
        assert_eq!(code, 1);
        assert!(typo.contains("did you mean kolux-dev worktree"), "{typo}");
        let (none, code) = h("help zzzzzzzzzz");
        assert_eq!(code, 1);
        assert!(none.contains("Global options"), "the overview when nothing is close");
        // Flag values are not taken for command words.
        assert_eq!(help_path(&words("--repo name:x worktree list --help")), vec!["worktree".to_string(), "list".to_string()]);
    }

    #[test]
    fn the_version_flag_counts_only_on_its_own_and_a_leading_double_dash_is_ignored() {
        assert!(version_only(&words("--version")) && version_only(&words("-v")));
        assert!(!version_only(&words("--version --json")) && !version_only(&words("worktree list -v")));
        assert_eq!(parse(&words("-- skills list")).1.unwrap().unwrap().command, parse(&words("skills list")).1.unwrap().unwrap().command);
    }

    #[test]
    fn the_skill_guides_name_only_commands_and_flags_that_exist() {
        let paths: Vec<&str> = commands().iter().map(|c| c.0).collect();
        let groups: Vec<&str> = paths.iter().map(|p| p.split(' ').next().unwrap()).collect();
        for (name, text) in local_cli::guides() {
            let w: Vec<&str> = text.split(|c: char| c.is_whitespace() || "`'\"()[]|".contains(c)).filter(|s| !s.is_empty()).collect();
            for i in 0..w.len() {
                if (w[i] == "kolux" || w[i] == "kolux-dev") && i + 1 < w.len() && groups.contains(&w[i + 1]) {
                    let one = w[i + 1];
                    let two = w.get(i + 2).map(|v| format!("{one} {v}")).unwrap_or_default();
                    assert!(paths.contains(&one) || paths.contains(&two.as_str()), "{name} names kolux {two}, which is not a command");
                }
                if let Some(flag) = w[i].strip_prefix("--") {
                    let flag = flag.split('=').next().unwrap().trim_end_matches(|c: char| !c.is_ascii_alphanumeric());
                    assert!(flag.is_empty() || ["json", "help", "version"].contains(&flag) || known_flag(flag) || SWITCHES.contains(&flag), "{name} names --{flag}, which no command takes");
                }
            }
        }
    }

    #[test]
    fn account_commands_assume_claude_and_refuse_what_they_cannot_honour() {
        let ok = |s: &str| parse(&words(s)).1.unwrap().unwrap();
        let refused = |s: &str| parse(&words(s)).1.unwrap_err().message;
        let p = ok("account add");
        assert_eq!((p.command.as_str(), p.args["agent"].as_str()), ("account.add", Some("claude")), "Claude when --agent is left out");
        assert_eq!(ok("account add --agent codex").args["agent"], "codex");
        assert_eq!(ok("account add --agent Codex").args["agent"], "codex");
        assert_eq!(ok("account list").command, "account.list");
        assert!(parse(&words("account list --json")).0);
        assert!(refused("account add --agent=").contains("empty"), "an empty --agent is refused, not Claude");
        assert!(refused("account add --agent grok").contains("claude or codex"));
        for flag in ["--environment work", "--pairing-code 1234", "--remote box", "--target box"] {
            assert!(refused(&format!("account add {flag}")).contains("this machine"), "{flag}");
            assert!(refused(&format!("account list {flag}")).contains("this machine"), "{flag}");
        }
        assert!(refused("account list --agent claude").contains("--agent"));
    }

    #[test]
    fn tasks_need_a_known_creator_and_a_dry_run_needs_no_recipient() {
        let dir = std::env::temp_dir().join(format!("kolux-rs-dry-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        let git_ = Git::detect().unwrap();
        let store = Mutex::new(Store::open(&dir.join("data")).unwrap());
        let notify = |_: Value| {};
        let terminals = Terminals::default();
        let ctx = Ctx { claude_config: dir.join(".claude.json"), git: &git_, store: &store, terminals: &terminals, notify: &notify, front: &|| Ok(()) };
        let req = |command: &str, args: Value| Request { id: "r".into(), token: String::new(), command: command.into(), cwd: dir.display().to_string(), args, pane: None, cli: String::new() };
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
        let (json, p) = parse(&words("orchestration send --subject hi --to run:run-1 --type worker_done --outcome succeeded --files-modified a,b --retry-request 1b4e28ba-2fa1-4d3b-a3f5-ef19b5a7633a --json"));
        let p = p.unwrap().unwrap();
        assert!(json);
        assert_eq!(p.command, "orchestration.send");
        assert_eq!(p.args["filesModified"], "a,b");
        assert_eq!(p.args["retryRequest"], "1b4e28ba-2fa1-4d3b-a3f5-ef19b5a7633a");
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
        assert!(refused("orchestration worker-stop").contains("--dispatch"));
        assert!(refused("orchestration task-update --status completed").contains("--id"));
        assert!(refused("orchestration task-update --id task-1").contains("--status"));
        let (_, p) = parse(&words("orchestration task-update --id task-1 --status completed --result green"));
        let p = p.unwrap().unwrap();
        assert_eq!((p.command.as_str(), p.args["result"].as_str()), ("orchestration.task-update", Some("green")));
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
        // ORCH-029 / ORCH-028: ask and the gate commands are known and checked before the app is asked.
        assert_eq!(parse(&words("orchestration ask --question hi --options a,b --timeout-ms 1000")).1.unwrap().unwrap().command, "orchestration.ask");
        assert!(refused("orchestration ask").contains("--question"));
        assert!(refused("orchestration ask --question hi --resume msg-1").contains("not both"));
        assert_eq!(parse(&words("orchestration gate-create --task t --question q")).1.unwrap().unwrap().command, "orchestration.gate-create");
        assert_eq!(parse(&words("orchestration gate-resolve --id gate-1 --resolution yes")).1.unwrap().unwrap().command, "orchestration.gate-resolve");
        assert_eq!(parse(&words("orchestration gate-list --status timeout --run run-1")).1.unwrap().unwrap().command, "orchestration.gate-list");
        // ORCH-041: Windows refuses first, then a shell outside Kolux.
        assert!(teams_allowed(true, true).unwrap_err().contains("not supported on Windows"));
        assert!(teams_allowed(false, false).unwrap_err().contains("Kolux terminal"));
        assert!(teams_allowed(false, true).is_ok());
        // ORCH-031: exactly one scope.
        assert_eq!(parse(&words("orchestration reset --tasks")).1.unwrap().unwrap().command, "orchestration.reset");
        assert!(refused("orchestration reset").contains("exactly one"));
        assert!(refused("orchestration reset --tasks --all").contains("exactly one"));
        // ORCH-065: every orchestration command has its line in the help.
        for (name, _, _) in commands().iter().filter(|c| c.0.starts_with("orchestration ")) {
            assert!(HELP.contains(&format!("kolux-dev {name} ")), "{name} has no help line");
        }
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
    fn an_app_that_cannot_be_reached_is_met_with_the_open_advice() {
        let down = unreachable_fail("no endpoint file".into());
        assert!(open_first(&down, "worktree.list").unwrap().contains("kolux-dev open"));
        assert!(open_first(&down, "app.open").is_none(), "open itself is not told to run open");
        let mut own = down.clone();
        own.data["hint"] = json!("kolux-dev orchestration run-use --id run-1 picks it up again");
        assert!(open_first(&own, "orchestration.send").is_none(), "its own recovery wins");
        assert!(open_first(&Fail::new("failed", "x"), "worktree.list").is_none());
    }

    #[test]
    fn open_starts_the_app_only_when_none_answers_and_gives_up_after_the_limit() {
        use std::cell::Cell;
        let down = || Fail::new("app_unreachable", "down");
        let up = || Ok(json!({ "success": true, "result": { "ready": true, "started": false } }));
        let launches = Cell::new(0);
        let launch = || {
            launches.set(launches.get() + 1);
            Ok(())
        };
        // Already running: brought forward, nothing started.
        let v = open(&up, &launch, Duration::from_secs(5)).unwrap();
        assert_eq!((v["result"]["started"].clone(), launches.get()), (json!(false), 0));
        // Closed: started once, then answers on the third try.
        let tries = Cell::new(0);
        let late = || {
            tries.set(tries.get() + 1);
            if tries.get() < 3 { Err(down()) } else { up() }
        };
        let v = open(&late, &launch, Duration::from_secs(5)).unwrap();
        assert_eq!((v["result"]["started"].clone(), launches.get(), tries.get()), (json!(true), 1, 3));
        // Never answers: an error naming the limit, after one start.
        let e = open(&|| Err(down()), &launch, Duration::ZERO).unwrap_err();
        assert!(e.message.contains("did not answer within 0 s") && launches.get() == 2, "{}", e.message);
        // Another failure is reported as it is, without starting anything.
        let e = open(&|| Err(Fail::new("unauthorized", "stale")), &launch, Duration::ZERO).unwrap_err();
        assert_eq!((e.code, launches.get()), ("unauthorized", 2));
    }

    #[test]
    fn requests_cross_the_loopback_port_with_the_token() {
        let listener = TcpListener::bind(("127.0.0.1", 0)).unwrap();
        let port = listener.local_addr().unwrap().port();
        std::thread::spawn(move || serve_loop(listener, "secret", "rt-1", |req| Ok(json!({ "echo": req.args }))));
        let req = Request { id: "r1".into(), token: "secret".into(), command: "x".into(), cwd: String::new(), args: json!({ "a": 1 }), pane: None, cli: String::new() };
        let v = call(port, &req).unwrap();
        assert_eq!(v["success"], true);
        assert_eq!(v["requestId"], "r1");
        assert_eq!(v["result"]["echo"]["a"], 1);
        assert_eq!(v["meta"]["runtimeId"], "rt-1");
        let bad = Request { token: "wrong".into(), ..req.clone() };
        let v = call(port, &bad).unwrap();
        assert_eq!(v["success"], false);
        assert_eq!(v["error"]["code"], "unauthorized");
        // CLI-038: every answer says the app's version, and a change from a newer CLI is turned away.
        assert_eq!(v["meta"]["appVersion"], VERSION);
        let future = Request { command: SEND.into(), cli: "999.0.0".into(), ..req.clone() };
        assert_eq!(call(port, &future).unwrap()["error"]["code"], "version_gap");
        let same = Request { command: SEND.into(), cli: VERSION.into(), ..req.clone() };
        assert_eq!(call(port, &same).unwrap()["success"], true);
        let asking = Request { command: CHECK.into(), cli: "999.0.0".into(), ..req };
        assert_eq!(call(port, &asking).unwrap()["success"], true);
    }

    #[test]
    fn an_app_that_does_not_know_a_command_is_a_version_gap_and_a_lost_answer_is_not_app_down() {
        let listener = TcpListener::bind(("127.0.0.1", 0)).unwrap();
        let port = listener.local_addr().unwrap().port();
        // An older app: it has never heard of the command and does not say its version.
        std::thread::spawn(move || {
            for (n, s) in listener.incoming().flatten().enumerate() {
                let mut s = s;
                let mut line = String::new();
                BufReader::new(&s).read_line(&mut line).unwrap();
                let id = serde_json::from_str::<Value>(&line).unwrap()["id"].as_str().unwrap().to_string();
                if n == 0 {
                    let out = json!({ "requestId": id, "success": false, "error": { "code": "invalid_arguments", "message": "unknown command orchestration.reset" }, "meta": { "runtimeId": "old" } });
                    writeln!(s, "{out}").unwrap();
                }
                // The second request: the app reads it and closes without answering.
            }
        });
        let req = Request { id: "r1".into(), token: "t".into(), command: "orchestration.reset".into(), cwd: String::new(), args: json!({}), pane: None, cli: VERSION.into() };
        let v = call(port, &req).unwrap();
        assert_eq!(v["error"]["code"], "version_gap", "{v}");
        assert!(v["error"]["message"].as_str().unwrap().contains("Update Kolux"), "{v}");
        let e = call(port, &req).unwrap_err();
        assert_eq!(e.code, "lost_result", "{}", e.message);
        // Nothing listening is the one case that means the app is down, with the command that opens it.
        let closed = TcpListener::bind(("127.0.0.1", 0)).unwrap().local_addr().unwrap().port();
        let down = call(closed, &req).unwrap_err();
        assert_eq!(down.code, "app_unreachable");
        assert!(down.message.contains(&format!("{} open", crate::orchestration::CLI)), "{}", down.message);
    }

    #[test]
    fn retry_ids_are_uuids_and_lost_quotes_are_spotted() {
        let id = uuid();
        assert!(is_uuid(&id), "{id}");
        assert_eq!(&id[14..15], "4");
        assert_ne!(uuid(), id);
        assert!(!is_uuid("r1") && !is_uuid("1b4e28ba-2fa1-4d3b-a3f5-ef19b5a7633g") && !is_uuid("1b4e28ba2fa1-4d3b-a3f5-ef19b5a7633a-"));
        assert!(newer("0.2.0", "0.1.9") && newer("1.0.0", "0.99.0") && !newer("0.1.0", "0.1.0") && !newer("", "0.1.0"));
        assert!(quotes_lost("{files:[a,b]}") && quotes_lost("[a,b]") && !quotes_lost(r#"{"a":1}"#) && !quotes_lost("{}"));
        assert_eq!(retype(&words("orchestration send --body two words")), "orchestration send --body two words");
        assert_eq!(retype(&["--body".into(), "two words".into(), "it's".into()]), "--body 'two words' 'it''s'");

        let refused = |s: &str| parse(&words(s)).1.unwrap_err().message;
        assert!(refused("orchestration task-create --spec x --retry-request r1").contains("UUID"));
        assert!(refused("orchestration request-show").contains("--request"));
        assert!(refused("orchestration request-show --request abc").contains("UUID"));
        assert!(refused("orchestration reset").contains("exactly one scope"));
        assert!(refused("orchestration reset --tasks --messages").contains("exactly one scope"));
        assert!(refused("orchestration send --to run:r --subject s --payload {files:[a,b]}").contains("PowerShell 5.1"));
        assert!(refused("orchestration send --to run:r --subject s --payload nope").contains("takes JSON"));
        let p = parse(&words("orchestration reset --messages")).1.unwrap().unwrap();
        assert_eq!((p.command.as_str(), &p.args["messages"]), ("orchestration.reset", &json!(true)));
        let p = parse(&words(&format!("orchestration request-show --request {id}"))).1.unwrap().unwrap();
        assert_eq!(p.args["request"], id.as_str());
    }

    #[test]
    fn a_lost_change_can_be_looked_up_and_each_scope_reset_on_its_own() {
        use crate::orchestration::Mail;
        let dir = std::env::temp_dir().join(format!("kolux-rs-cli038-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        let git_ = Git::detect().unwrap();
        let store = Mutex::new(Store::open(&dir.join("data")).unwrap());
        let notify = |_: Value| {};
        let terminals = Terminals::default();
        let ctx = Ctx { claude_config: dir.join(".claude.json"), git: &git_, store: &store, terminals: &terminals, notify: &notify, front: &|| Ok(()) };
        let req = |command: &str, args: Value| Request { id: "r".into(), token: String::new(), command: command.into(), cwd: dir.display().to_string(), args, pane: None, cli: String::new() };
        let done = "1b4e28ba-2fa1-4d3b-a3f5-ef19b5a7633a";
        let sent = "2b4e28ba-2fa1-4d3b-a3f5-ef19b5a7633a";
        {
            let s = store.lock().unwrap();
            let mut m = Mail::load(&s);
            m.answers.insert(format!("orchestration.task-create||{done}"), json!({ "id": "task-1" }));
            m.answers.insert(format!("orchestration.send||{sent}"), json!({ "messageIds": ["m1"] }));
            m.save(&s).unwrap();
            save_list(&s, TASKS_KEY, &[json!({ "id": "task-1" })]).unwrap();
            save_list(&s, DISPATCHES_KEY, &[json!({ "id": "d-1" })]).unwrap();
        }
        let show = |id: &str| dispatch(&ctx, &req("orchestration.request-show", json!({ "request": id }))).unwrap();
        let v = show(done);
        assert_eq!((&v["state"], &v["command"], &v["result"]["id"]), (&json!("completed"), &json!("orchestration.task-create"), &json!("task-1")), "{v}");
        assert!(text_of("orchestration.request-show", &v).contains("took effect"));
        assert_eq!(show("3b4e28ba-2fa1-4d3b-a3f5-ef19b5a7633a")["state"], "absent");

        let v = dispatch(&ctx, &req("orchestration.reset", json!({ "tasks": true }))).unwrap();
        assert_eq!((&v["tasks"], &v["dispatches"], &v["messages"]), (&json!(1), &json!(1), &json!(0)), "{v}");
        assert!(load_list(&store.lock().unwrap(), TASKS_KEY).is_empty() && load_list(&store.lock().unwrap(), DISPATCHES_KEY).is_empty());
        assert_eq!(show(done)["state"], "absent");
        assert_eq!(show(sent)["state"], "completed", "a tasks reset leaves the messages' answers");
        assert!(text_of("orchestration.reset", &v).starts_with("cleared tasks"));
        dispatch(&ctx, &req("orchestration.reset", json!({ "messages": true }))).unwrap();
        assert_eq!(show(sent)["state"], "absent");
        let e = dispatch(&ctx, &req("orchestration.reset", json!({}))).unwrap_err();
        assert!(e.message.contains("exactly one scope"));
        drop(ctx);
        let _ = std::fs::remove_dir_all(&dir);
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
        let ctx = Ctx { claude_config: dir.join(".claude.json"), git: &git_, store: &store, terminals: &terminals, notify: &notify, front: &|| Ok(()) };
        let req = |command: &str, cwd: &Path, args: Value| Request { id: "r".into(), token: String::new(), command: command.into(), cwd: cwd.display().to_string(), args, pane: None, cli: String::new() };

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
        let ctx = Ctx { claude_config: dir.join(".claude.json"), git: &git_, store: &store, terminals: &terminals, notify: &notify, front: &|| Ok(()) };
        let req = |command: &str, cwd: &Path, args: Value| Request { id: "r".into(), token: String::new(), command: command.into(), cwd: cwd.display().to_string(), args, pane: None, cli: String::new() };
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

        // GIT-068: with a Git older than 2.38 (read once at startup) the clash is unverifiable and
        // merge-tree is not tried, even for the sibling that would conflict.
        let old = Git { version: "git version 2.37.1".into() };
        let ctx = Ctx { claude_config: dir.join(".claude.json"), git: &old, store: &store, terminals: &terminals, notify: &notify, front: &|| Ok(()) };
        let ov = dispatch(&ctx, &req("worktree.overlap", &one, json!({ "worktree": "name:one" }))).unwrap();
        let s2 = ov["siblings"].as_array().unwrap().iter().find(|s| s["branch"] == "two").cloned().unwrap();
        assert_eq!(s2["clash"], "unverifiable", "{s2}");
        assert!(s2["why"].as_str().unwrap().contains("older than 2.38"), "{s2}");
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
        let ctx = Ctx { claude_config: dir.join(".claude.json"), git: &git_, store: &store, terminals: &terminals, notify: &notify, front: &|| Ok(()) };
        let req = |command: &str, cwd: &Path, args: Value| Request { id: "r".into(), token: String::new(), command: command.into(), cwd: cwd.display().to_string(), args, pane: None, cli: String::new() };

        let made = dispatch(&ctx, &req("worktree.create", &repo, json!({ "name": "cli one", "setup": "skip" }))).unwrap();
        let path = PathBuf::from(made["path"].as_str().unwrap());
        assert!(path.join(".git").exists(), "{}", path.display());
        assert_eq!(made["name"], "cli one");
        assert_eq!(made["branch"], "cli-one");
        assert_eq!(made["agent"], Value::Null, "no prompt, no agent asked: none is picked");
        assert_eq!(made["warnings"], json!([]), "nothing inert was passed");
        assert_eq!(events.lock().unwrap()[0]["kind"], "created");
        // CLI-018 lineage: called from the main checkout, the parent is the main checkout.
        assert_eq!(made["madeBy"], "cli");
        assert_eq!(made["parent"], json!(repo.display().to_string()));
        let child = dispatch(&ctx, &req("worktree.create", &dir, json!({ "name": "child", "repo": "name:repo", "parentWorktree": "name:cli one", "issue": "12", "comment": "from a test" }))).unwrap();
        assert_eq!(child["parent"], json!(path.display().to_string()));
        assert_eq!(child["issue"], 12);
        assert_eq!(child["comment"], "from a test");
        // EDIT-047: the comment is no longer inert: the worktree palette shows it and finds the worktree by it.
        assert_eq!(child["warnings"], json!([]));
        let child_path = child["path"].as_str().unwrap().to_string();
        {
            let st = store.lock().unwrap();
            let project = projects::load_projects(&st).into_iter().next().unwrap();
            let listed = projects::list_workspaces(&git_, &st, &project).unwrap();
            let row = listed.iter().find(|w| projects::same_folder(Path::new(&w.path), Path::new(&child_path))).unwrap();
            assert_eq!((row.comment.as_deref(), row.number), (Some("from a test"), Some(12)));
        }
        let stored = projects::origin(&store.lock().unwrap(), &child_path).unwrap();
        assert_eq!(stored["parent"], json!(path.display().to_string()));
        assert_eq!(stored["cwd"], json!(dir.display().to_string()));
        assert_eq!(stored["terminal"], Value::Null, "a call from outside Kolux records no terminal");
        assert!(store.lock().unwrap().get("workspaceParents").unwrap().unwrap().contains("child"), "the sidebar nests it (PROJ-047)");
        let inside = dispatch(&ctx, &req("worktree.create", &path, json!({ "name": "grandchild" }))).unwrap();
        assert_eq!(inside["parent"], json!(path.display().to_string()), "called from inside cli one");
        let alone = dispatch(&ctx, &req("worktree.create", &path, json!({ "name": "alone", "noParent": true }))).unwrap();
        assert_eq!(alone["parent"], Value::Null);
        let from_elsewhere = dispatch(&ctx, &req("worktree.create", &dir, json!({ "name": "top", "repo": "name:repo", "setup": "run", "runHooks": true, "activate": true }))).unwrap();
        assert_eq!(from_elsewhere["parent"], Value::Null, "called from outside every worktree");
        assert_eq!(from_elsewhere["warnings"], json!([]), "T-107-b: --setup and --run-hooks act now (PROJ-033)");
        let missing = dispatch(&ctx, &req("worktree.create", &repo, json!({ "name": "x", "parentWorktree": "name:nope" }))).unwrap_err();
        assert_eq!(missing.code, "not_found");
        // T-014-b-fix: the issue: selector finds the worktree made for that issue; the forms with
        // no meaning on the command line are refused with the accepted ones listed. (DT-C12 refused
        // `identity:` and `active` too; T-117-a, CLI-009, defines both, so they are no longer refused
        // and an unknown identity is simply not found.)
        let no_issue = dispatch(&ctx, &req("worktree.rm", &repo, json!({ "worktree": "issue:99", "force": true }))).unwrap_err();
        assert_eq!(no_issue.code, "not_found");
        let unknown = dispatch(&ctx, &req("worktree.rm", &repo, json!({ "worktree": "identity:x", "force": true }))).unwrap_err();
        assert_eq!(unknown.code, "not_found");
        for sel in ["nope:x", "42"] {
            let refused = dispatch(&ctx, &req("worktree.rm", &repo, json!({ "worktree": sel, "force": true }))).unwrap_err();
            assert_eq!(refused.code, "invalid_arguments", "{sel}");
            assert!(refused.message.contains("issue:") && refused.message.contains("branch:"), "{sel}: {}", refused.message);
        }
        let by_issue = dispatch(&ctx, &req("worktree.rm", &repo, json!({ "worktree": "issue:12", "force": true }))).unwrap();
        assert_eq!(by_issue["path"], json!(child_path));
        for n in ["grandchild", "alone"] {
            dispatch(&ctx, &req("worktree.rm", &repo, json!({ "worktree": format!("name:{n}"), "force": true }))).unwrap();
        }
        let top = dispatch(&ctx, &req("worktree.rm", &repo, json!({ "worktree": "name:top", "force": true, "runHooks": true }))).unwrap();
        assert!(top["warnings"][0].as_str().unwrap().starts_with("--run-hooks"), "{}", top["warnings"]);
        assert!(projects::origin(&store.lock().unwrap(), &child_path).is_none(), "the origin goes with the worktree");

        let outside = dispatch(&ctx, &req("worktree.create", &dir, json!({ "name": "nowhere" }))).unwrap_err();
        assert_eq!(outside.code, "not_found");
        let unknown = dispatch(&ctx, &req("worktree.create", &repo, json!({ "name": "x", "agent": "nobody" }))).unwrap_err();
        assert!(unknown.message.contains("nobody"));
        // T-014-b-fix, PROJ-038: a prompt with no --agent goes to the default agent when it is
        // installed, else to the first installed one in catalogue order; none installed is an error.
        let list = crate::agents::agent_list();
        let wanted = list.iter().find(|x| x.id == "claude" && x.installed).or_else(|| list.iter().find(|x| x.installed)).map(|x| x.id.clone());
        let prompted = dispatch(&ctx, &req("worktree.create", &repo, json!({ "name": "prompted", "prompt": "say hi" })));
        match wanted {
            Some(id) => {
                let made = prompted.unwrap();
                assert_eq!(made["agent"], json!(id));
                let ev = events.lock().unwrap();
                let last = ev.last().unwrap();
                assert_eq!(last["agent"], json!(id));
                assert_eq!(last["prompt"], "say hi");
                drop(ev);
                dispatch(&ctx, &req("worktree.rm", &repo, json!({ "worktree": "name:prompted", "force": true }))).unwrap();
            }
            None => {
                let err = prompted.unwrap_err();
                assert!(err.message.contains("installed"), "{}", err.message);
            }
        }

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
        let ctx = Ctx { claude_config: dir.join(".claude.json"), git: &git_, store: &store, terminals: &terminals, notify: &notify, front: &|| Ok(()) };
        let req = |command: &str, args: Value| Request { id: "r".into(), token: String::new(), command: command.into(), cwd: repo.display().to_string(), args, pane: None, cli: VERSION.into() };
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

    #[test]
    fn a_worker_whose_terminal_dies_mid_task_escalates_once_to_its_run() {
        let dir = std::env::temp_dir().join(format!("kolux-rs-cli172-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let store = Store::open(&dir.join("data")).unwrap();
        let mut mail = crate::orchestration::Mail::default();
        let run = mail.run_create("term-1", "ship it", 1)["binding"]["runId"].as_str().unwrap().to_string();
        let me = u64::from(std::process::id());
        let tasks = vec![json!({ "id": "task-1", "title": "Fix the login page", "status": "dispatched" }), json!({ "id": "task-2", "status": "dispatched" }), json!({ "id": "task-3", "title": "Done already", "status": "dispatched" })];
        let ds = vec![
            json!({ "id": "dispatch-1", "runtime": me, "runId": run, "taskId": "task-1", "status": "ready", "terminal": 7, "worktree": "w1" }),
            json!({ "id": "dispatch-2", "runtime": me, "runId": run, "taskId": "task-2", "status": "ready", "terminal": 8, "worktree": "w2" }),
            json!({ "id": "dispatch-3", "runtime": me, "runId": run, "taskId": "task-3", "status": "ready", "terminal": 9, "worktree": "w3" }),
            json!({ "id": "dispatch-old", "runtime": me + 1, "runId": run, "taskId": "task-1", "status": "ready", "terminal": 7, "worktree": "w1" }),
        ];
        save_list(&store, TASKS_KEY, &tasks).unwrap();
        save_list(&store, DISPATCHES_KEY, &ds).unwrap();
        mail.send(&crate::terminal::handle_of(9), &json!({ "to": format!("run:{run}"), "subject": "done", "type": "worker_done", "outcome": "succeeded", "dispatchId": "dispatch-3" }), &ds, &|_| true, 2).unwrap();
        mail.save(&store).unwrap();

        // The terminal ends by itself: one escalation to the Run, named by the task title.
        let sent = worker_exited(&store, 7, Some(1), 5).unwrap();
        assert_eq!(sent["dispatchId"], "dispatch-1");
        assert!(worker_exited(&store, 7, Some(1), 6).is_none(), "one escalation per worker exit");
        // No title: the task id. A worker that already reported done, or an unknown terminal: nothing.
        worker_exited(&store, 8, None, 7).unwrap();
        assert!(worker_exited(&store, 9, Some(0), 8).is_none());
        assert!(worker_exited(&store, 42, Some(0), 8).is_none());

        let mail = crate::orchestration::Mail::load(&store);
        let esc: Vec<_> = mail.messages.iter().filter(|x| x.kind == "escalation").collect();
        assert_eq!(esc.len(), 2);
        assert_eq!((esc[0].to.clone(), esc[0].priority.as_str()), (format!("run:{run}"), "high"));
        assert!(esc[0].subject.contains("Fix the login page"), "{}", esc[0].subject);
        assert!(esc[0].body.contains("exit code 1") && esc[0].body.contains("--retry-of dispatch-1 --task task-1"), "{}", esc[0].body);
        assert!(esc[1].subject.contains("task-2"), "{}", esc[1].subject);
        let after = load_list(&store, DISPATCHES_KEY);
        assert!(after[0]["exitedAt"].is_u64() && after[3]["exitedAt"].is_null(), "an earlier start's dispatch on the same number is left alone");
        drop(store);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn request_show_reads_the_ledger_and_a_worker_start_retry_never_starts_twice() {
        let refused = |s: &str| parse(&words(s)).1.unwrap_err().message;
        assert!(refused("orchestration request-show").contains("--request"));
        let dir = std::env::temp_dir().join(format!("kolux-rs-cli173-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let git_ = Git::detect().unwrap();
        let store = Mutex::new(Store::open(&dir.join("data")).unwrap());
        let notify = |_: Value| {};
        let terminals = Terminals::default();
        let ctx = Ctx { claude_config: dir.join(".claude.json"), git: &git_, store: &store, terminals: &terminals, notify: &notify, front: &|| Ok(()) };
        let req = |command: &str, args: Value| Request { id: "r".into(), token: String::new(), command: command.into(), cwd: dir.display().to_string(), args, pane: None, cli: String::new() };
        let show = |id: &str| dispatch(&ctx, &req("orchestration.request-show", json!({ "request": id }))).unwrap();
        assert_eq!(show("never-sent")["state"], "absent");
        {
            let s = store.lock().unwrap();
            let mut m = crate::orchestration::Mail::load(&s);
            m.finish("orchestration.worker-start||w1", Some(json!({ "dispatchId": "dispatch-7", "status": "ready" })));
            m.finish("orchestration.worker-start||w2", Some(json!({ "timedOut": { "message": "the worker did not come up", "data": { "dispatchId": "dispatch-8" } } })));
            m.begin("orchestration.worker-start||w3", u64::from(std::process::id()) + 1).unwrap();
            m.save(&s).unwrap();
        }
        assert_eq!((show("w1")["state"].as_str(), show("w1")["command"].as_str()), (Some("completed"), Some(WORKER_START)));
        assert_eq!(show("w3")["interrupted"], true);
        // The same id hands back the first start's receipt, or its timeout, and starts nothing.
        let again = dispatch(&ctx, &req(WORKER_START, json!({ "spec": "x", "agent": "no-such-agent", "retryRequest": "w1" }))).unwrap();
        assert_eq!(again["dispatchId"], "dispatch-7");
        let late = dispatch(&ctx, &req(WORKER_START, json!({ "spec": "x", "agent": "no-such-agent", "retryRequest": "w2" }))).unwrap_err();
        assert_eq!((late.code, late.data["dispatchId"].as_str()), ("timeout", Some("dispatch-8")));
        // A start left pending by an earlier run of Kolux runs fresh; turned away, it leaves no receipt.
        let fresh = dispatch(&ctx, &req(WORKER_START, json!({ "spec": "x", "agent": "no-such-agent", "retryRequest": "w3" }))).unwrap_err();
        assert!(fresh.message.contains("no-such-agent"), "{}", fresh.message);
        assert_eq!(show("w3")["state"], "absent");
        drop(ctx);
        drop(store);
        let _ = std::fs::remove_dir_all(&dir);
    }
}
