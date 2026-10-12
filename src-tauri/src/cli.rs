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

#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub struct Request {
    pub id: String,
    pub token: String,
    pub command: String,
    /// The folder the command was run in: the default repo and the meaning of `current`.
    pub cwd: String,
    pub args: Value,
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

const HELP: &str = "kolux-dev: drive Kolux from a terminal\n\n  kolux-dev worktree create --name <name> [--repo <selector>] [--agent <id>] [--prompt <text>]\n      [--setup run|skip|inherit] [--base-branch <ref>] [--issue <number>] [--comment <text>]\n      [--parent-worktree <selector>] [--no-parent] [--run-hooks] [--activate] [--json]\n  kolux-dev worktree rm --worktree <selector> [--force] [--run-hooks] [--json]\n      (also: remove, delete)\n  kolux-dev orchestration worker-start (--task <id> | --spec <text>) (--agent <id> | --tier major|deep|build|light)\n      [--worktree current|<selector>|new-child|new-top-level] [--model <m>] [--effort <e>] [--name <n>]\n      [--repo <selector>] [--base-branch <ref>] [--display-name <d>] [--comment <c>] [--setup run|skip|inherit]\n      [--task-title <t>] [--deps <json list>] [--parent <task>] [--timeout-ms <ms>] [--json]\n\nSelectors: --repo id:|name:|path:   --worktree current|id:|name:|branch:|issue:|path:\n--json prints one envelope on stdout; without it, errors go to stderr; warnings about flags nothing\nacts on yet go to stderr and into the result's `warnings` list. Exit 0 worked, 1 any error.\n";

const SWITCHES: &[&str] = &["force", "activate", "run-hooks", "no-parent"];
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
            _ => return Err(Fail::args(format!("unknown command `{joined}`; run kolux-dev --help"))),
        };
        if command == "worktree.create" && flags.contains_key("parent-workspace") {
            return Err(Fail::args("--parent-workspace was retired; use --parent-worktree <selector>"));
        }
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
                    "retry-request" => "retryRequest",
                    other => other,
                };
                args.insert(key.to_string(), v.clone());
            }
            args.entry("setup").or_insert_with(|| Value::String("inherit".into()));
            args.entry("worktree").or_insert_with(|| Value::String(NEW_TOP.into()));
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

fn data_dir() -> PathBuf {
    let base = std::env::var_os("APPDATA").map(PathBuf::from).unwrap_or_else(std::env::temp_dir);
    base.join(DATA_DIR)
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
        _ => format!("removed {}", s("path")),
    }
}

/// The `kolux-dev` program: parses, talks to the app, prints, and returns the exit status.
pub fn main(words: Vec<String>) -> i32 {
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
        let req = Request { id: id.clone(), token, command: parsed.command.clone(), cwd, args: Value::Object(parsed.args.clone()) };
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

/// The worktree of `project` the call was made from (the main checkout counts), the innermost
/// when folders nest; None when `cwd` is outside them all.
fn calling_worktree(ctx: &Ctx, project: &Project, cwd: &str) -> Result<Option<String>, Fail> {
    let store = ctx.store.lock().map_err(|e| e.to_string())?;
    let mut inside: Vec<String> = projects::list_workspaces(ctx.git, &store, project)?.into_iter().map(|w| w.path).filter(|p| under(p, cwd)).collect();
    inside.sort_by_key(|p| std::cmp::Reverse(p.len()));
    Ok(inside.into_iter().next())
}

const SELECTOR_FORMS: &str = "use current, id:, name:, branch:, issue: or path:";

/// The worktree `--worktree` means: `current` is the one the call was made in; `name:` matches
/// the typed name, the branch or the folder name; `branch:` and `path:` match exactly; `issue:`
/// matches the issue number recorded when the worktree was made (T-014-b-fix). `active` is the
/// window's choice and `identity:` has no definition, so both are refused (DT-C12).
fn pick_worktree(ctx: &Ctx, sel: &str, cwd: &str) -> Result<(Project, Worktree), Fail> {
    let store = ctx.store.lock().map_err(|e| e.to_string())?;
    let mut hits: Vec<(Project, Worktree)> = Vec::new();
    for p in projects::load_projects(&store) {
        for w in projects::list_workspaces(ctx.git, &store, &p)? {
            let folder = Path::new(&w.path).file_name().map(|f| f.to_string_lossy().to_string()).unwrap_or_default();
            let ok = match (sel, selector(sel)) {
                ("current", _) => under(&w.path, cwd),
                ("active", _) => return Err(Fail::args(format!("`active` is the window's choice, not known to the command line; {SELECTOR_FORMS}"))),
                (_, ("name", v)) => w.name.as_deref() == Some(v) || w.branch.as_deref() == Some(v) || folder == v,
                (_, ("branch", v)) => w.branch.as_deref() == Some(v),
                (_, ("path", v)) => under(&w.path, v) && under(v, &w.path),
                (_, ("id", v)) => v.split_once("::").is_some_and(|(id, path)| id == p.id && under(&w.path, path) && under(path, &w.path)),
                (_, ("issue", v)) => v.parse::<u64>().ok().is_some_and(|n| projects::origin(&store, &w.path).is_some_and(|o| o["issue"] == json!(n))),
                (_, (k, _)) => return Err(Fail::args(format!("{k}: selectors are not supported; {SELECTOR_FORMS}"))),
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
            // PROJ-038: a prompt with no agent named goes to the default agent, else the first
            // installed one in catalogue order; a worktree made with neither gets no agent tab.
            let agent = match text("agent") {
                Some(id) => Some(installed_agent(&id).map(|_| id)?),
                None if text("prompt").is_some() => Some(fallback_agent(ctx)?.id),
                None => None,
            };
            let project = pick_project(ctx, text("repo").as_deref(), &req.cwd)?;
            // Lineage: the worktree the call was made from, unless a flag says otherwise.
            let parent = if a["noParent"].as_bool().unwrap_or(false) {
                None
            } else if let Some(sel) = text("parentWorktree") {
                let (owner, w) = pick_worktree(ctx, &sel, &req.cwd)?;
                if owner.id != project.id {
                    return Err(Fail::args(format!("--parent-worktree {sel} is in project {}, not {}", owner.name, project.name)));
                }
                Some(w.path)
            } else {
                calling_worktree(ctx, &project, &req.cwd)?
            };
            let issue = text("issue").and_then(|v| v.parse::<u64>().ok());
            let made = projects::create_named(ctx.git, ctx.store, &project.id, &name, text("baseBranch").as_deref())?;
            let origin = json!({ "madeBy": "cli", "parent": parent, "cwd": req.cwd, "issue": issue, "comment": text("comment") });
            {
                let store = ctx.store.lock().map_err(|e| e.to_string())?;
                projects::set_origin(&store, &made.worktree.path, Some(&origin))?;
            }
            let activate = a["activate"].as_bool().unwrap_or(false);
            let mut result = serde_json::to_value(&made).map_err(|e| Fail::new("failed", e.to_string()))?;
            let obj = result.as_object_mut().expect("a workspace is an object");
            obj.insert("projectId".into(), json!(project.id));
            obj.insert("agent".into(), json!(agent));
            obj.insert("activated".into(), json!(activate));
            obj.extend(origin.as_object().expect("an origin is an object").clone());
            // ponytail: setup scripts (PROJ-033) and issue lookups (PROJ-037) are T-107; the
            // values are recorded and echoed, nothing runs on them yet, and the caller is told so
            // (T-014-b-fix) rather than left to think the scripts ran.
            let setup = text("setup").unwrap_or_else(|| "inherit".into());
            let mut warnings = Vec::new();
            if setup == "run" {
                warnings.push("--setup run: setup scripts do not run yet; the worktree was made without them");
            }
            if a["runHooks"].as_bool().unwrap_or(false) {
                warnings.push("--run-hooks: setup scripts do not run yet; the worktree was only activated");
            }
            if text("comment").is_some() {
                warnings.push("--comment: recorded with the worktree's origin, shown nowhere yet");
            }
            obj.insert("setup".into(), json!(setup));
            obj.insert("warnings".into(), json!(warnings));
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
            projects::remove_workspace(ctx.git, &project, &w.path, true)?;
            {
                let store = ctx.store.lock().map_err(|e| e.to_string())?;
                projects::set_origin(&store, &w.path, None)?;
                projects::set_name(&store, &w.path, None)?;
            }
            (ctx.notify)(json!({ "kind": "removed", "path": w.path }));
            let warnings: Vec<&str> = if a["runHooks"].as_bool().unwrap_or(false) { vec!["--run-hooks: teardown scripts do not run yet; the worktree was removed without them"] } else { vec![] };
            Ok(json!({ "path": w.path, "branch": w.branch, "name": w.name, "projectId": project.id, "warnings": warnings }))
        }
        WORKER_START => worker_start(ctx, req),
        other => Err(Fail::args(format!("unknown command {other}"))),
    }
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

fn next_id(list: &[Value], prefix: &str) -> String {
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

/// ORCH-018's shipped routing: the model and effort each tier means for a provider.
/// ponytail: the per-provider routing page in Settings is the card's other half.
fn route(agent: &str, tier: &str) -> Result<(String, Option<String>), Fail> {
    let hit = match (agent, tier) {
        ("claude", "major") => ("fable", Some("high")),
        ("claude", "deep") => ("opus", Some("high")),
        ("claude", "build") => ("sonnet", Some("medium")),
        ("claude", "light") => ("haiku", None),
        ("codex", "major") => ("gpt-5.6-sol", Some("high")),
        ("codex", "deep") => ("gpt-5.6-terra", Some("high")),
        ("codex", "build") => ("gpt-5.6-terra", Some("medium")),
        ("codex", "light") => ("gpt-5.6-luna", Some("low")),
        _ => return Err(Fail::new("no_route", format!("{agent} has no model route for the {tier} tier"))),
    };
    Ok((hit.0.to_string(), hit.1.map(str::to_string)))
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
    let agent_id = text("agent").map(Ok).unwrap_or_else(|| default_agent(ctx))?;
    let agent = installed_agent(&agent_id)?;
    let tier = text("tier");
    let (model, effort) = match &tier {
        Some(t) => {
            let (m, e) = route(&agent_id, t)?;
            (Some(m), e)
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
                let title = text("taskTitle").unwrap_or_else(|| spec.lines().next().unwrap_or_default().chars().take(60).collect());
                let deps: Vec<String> = text("deps").and_then(|d| serde_json::from_str(&d).ok()).unwrap_or_default();
                let created = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0);
                tasks.push(json!({ "id": next_id(&tasks, "task-"), "title": title, "spec": spec, "status": "pending", "deps": deps, "parent": text("parent"), "created": created }));
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
    let brief = task["spec"].as_str().unwrap_or_default().to_string();

    // The placement: the caller's worktree, one picked by selector, or a new one (agent-first).
    let placement = text("worktree").unwrap_or_else(|| NEW_TOP.into());
    let (project, worktree, created) = if placement == NEW_TOP || placement == NEW_CHILD {
        // ponytail: new-child is placed like new-top-level; lineage comes with the parent cards.
        let project = pick_project(ctx, text("repo").as_deref(), &req.cwd)?;
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
        (project, wt, true)
    } else {
        let (p, w) = pick_worktree(ctx, &placement, &req.cwd)?;
        (p, w, false)
    };

    // SAFE-023: the worktree (and its main repository) are trusted before the agent starts; best
    // effort, a failure never stops the worker.
    let trusted = match crate::trust::trust_folders(&ctx.claude_config, &agent_id, &[PathBuf::from(&worktree.path), PathBuf::from(&project.path)]) {
        Ok(_) => json!(true),
        Err(e) => json!(format!("not trusted: {e}")),
    };
    let since = Instant::now();
    if created {
        (ctx.notify)(json!({ "kind": "created", "projectId": project.id, "worktree": { "path": worktree.path, "branch": worktree.branch, "name": worktree.name, "isMain": false }, "agent": Value::Null, "prompt": "", "activate": false }));
    }
    (ctx.notify)(json!({ "kind": "start", "path": worktree.path, "branch": worktree.branch, "agent": agent_id, "prompt": brief, "extra": extra, "title": task["title"] }));
    let (terminal, ready) = wait_ready(ctx.terminals, Path::new(&worktree.path), since, timeout);
    let status = if ready { "ready" } else { "unknown" };

    let receipt = json!({
        "dispatchId": dispatch_id, "taskId": task_id, "status": status, "stage": "worker",
        "worktree": { "path": worktree.path, "branch": worktree.branch, "name": worktree.name, "projectId": project.id, "created": created },
        "placement": placement, "agent": agent_id, "program": agent.program, "model": model, "effort": effort, "tier": tier,
        "setup": "not_configured", "trust": trusted,
        "terminals": terminal.map(|id| vec![json!({ "id": id, "role": "worker" })]).unwrap_or_default(),
        "waitedMs": since.elapsed().as_millis() as u64,
        "hint": format!("kolux-dev worktree rm --worktree path:{} --force removes the worktree, its worker and all", worktree.path),
    });
    {
        let store = ctx.store.lock().map_err(|e| e.to_string())?;
        let mut dispatches = load_list(&store, DISPATCHES_KEY);
        dispatches.push(json!({ "id": dispatch_id, "taskId": task_id, "status": status, "worktree": worktree.path, "agent": agent_id, "model": model, "effort": effort, "tier": tier, "terminal": terminal, "created": since.elapsed().as_millis() as u64 }));
        save_list(&store, DISPATCHES_KEY, &dispatches)?;
    }
    if ready {
        Ok(receipt)
    } else {
        Err(Fail { code: "timeout", message: format!("the worker did not come up within {} ms; it may still be starting in the background ({dispatch_id} in {})", timeout.as_millis(), worktree.path), data: receipt })
    }
}

/// A token nobody outside this machine can guess: two hashes seeded from the OS's randomness.
pub(crate) fn token() -> String {
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
    let token = token();
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
        // T-014-b-fix: a prompt with no --agent goes to the app, which picks the agent (PROJ-038).
        assert_eq!(parse(&words("worktree create --name x --prompt hi")).1.unwrap().unwrap().args["prompt"], "hi");
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
        let req = Request { id: "r1".into(), token: "secret".into(), command: "x".into(), cwd: String::new(), args: json!({ "a": 1 }) };
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
        let req = |command: &str, cwd: &Path, args: Value| Request { id: "r".into(), token: String::new(), command: command.into(), cwd: cwd.display().to_string(), args };

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
        // T-014-b-fix: flags nobody acts on yet are named, not swallowed.
        let warned = child["warnings"].as_array().unwrap().iter().map(|w| w.as_str().unwrap().to_string()).collect::<Vec<_>>();
        assert_eq!(warned.len(), 1, "{warned:?}");
        assert!(warned[0].starts_with("--comment"), "{warned:?}");
        let child_path = child["path"].as_str().unwrap().to_string();
        let stored = projects::origin(&store.lock().unwrap(), &child_path).unwrap();
        assert_eq!(stored["parent"], json!(path.display().to_string()));
        assert_eq!(stored["cwd"], json!(dir.display().to_string()));
        let inside = dispatch(&ctx, &req("worktree.create", &path, json!({ "name": "grandchild" }))).unwrap();
        assert_eq!(inside["parent"], json!(path.display().to_string()), "called from inside cli one");
        let alone = dispatch(&ctx, &req("worktree.create", &path, json!({ "name": "alone", "noParent": true }))).unwrap();
        assert_eq!(alone["parent"], Value::Null);
        let from_elsewhere = dispatch(&ctx, &req("worktree.create", &dir, json!({ "name": "top", "repo": "name:repo", "setup": "run", "runHooks": true, "activate": true }))).unwrap();
        assert_eq!(from_elsewhere["parent"], Value::Null, "called from outside every worktree");
        let warned = from_elsewhere["warnings"].as_array().unwrap().iter().map(|w| w.as_str().unwrap().to_string()).collect::<Vec<_>>();
        assert_eq!(warned.len(), 2, "{warned:?}");
        assert!(warned[0].starts_with("--setup run"), "{warned:?}");
        assert!(warned[1].starts_with("--run-hooks"), "{warned:?}");
        let missing = dispatch(&ctx, &req("worktree.create", &repo, json!({ "name": "x", "parentWorktree": "name:nope" }))).unwrap_err();
        assert_eq!(missing.code, "not_found");
        // T-014-b-fix: the issue: selector finds the worktree made for that issue; the forms with
        // no meaning on the command line are refused with the accepted ones listed.
        let no_issue = dispatch(&ctx, &req("worktree.rm", &repo, json!({ "worktree": "issue:99", "force": true }))).unwrap_err();
        assert_eq!(no_issue.code, "not_found");
        for sel in ["identity:x", "active"] {
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
        dispatch(&ctx, &req("worktree.rm", &repo, json!({ "worktree": "name:cli one", "force": true }))).unwrap();
        assert!(!path.exists());
        assert_eq!(events.lock().unwrap().last().unwrap()["kind"], "removed");

        let two = dispatch(&ctx, &req("worktree.create", &repo, json!({ "name": "two" }))).unwrap();
        let two_path = PathBuf::from(two["path"].as_str().unwrap());
        dispatch(&ctx, &req("worktree.rm", &two_path, json!({ "worktree": "current" }))).unwrap();
        assert!(!two_path.exists());
        let main = dispatch(&ctx, &req("worktree.rm", &repo, json!({ "worktree": "current" }))).unwrap_err();
        assert!(main.message.contains("main checkout"));

        // ORCH-016: a worker start makes the task, the worktree and the start event, then waits
        // for the worker's terminal; with no window to open one, the wait runs out.
        let claude_installed = crate::agents::agent_list().iter().any(|a| a.id == "claude" && a.installed);
        let start = json!({ "spec": "add a test", "agent": "claude", "tier": "light", "worktree": "new-top-level", "setup": "inherit", "timeoutMs": "1" });
        let out = dispatch(&ctx, &req("orchestration.worker-start", &repo, start.clone())).unwrap_err();
        if claude_installed {
            assert_eq!(out.code, "timeout", "{}", out.message);
            assert_eq!(out.data["dispatchId"], "dispatch-1");
            assert_eq!(out.data["taskId"], "task-1");
            assert_eq!(out.data["model"], "haiku");
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
            assert_eq!(ev[n - 1]["prompt"], "add a test");
            assert_eq!(ev[n - 1]["extra"], json!(["--model", "haiku"]));
            assert_eq!(ev[n - 1]["path"], out.data["worktree"]["path"]);
            drop(ev);
            let tasks = store.lock().unwrap().get("orchestration.tasks").unwrap().unwrap();
            assert!(tasks.contains("\"dispatched\""), "{tasks}");
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
