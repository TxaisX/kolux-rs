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
use std::time::Duration;

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

const HELP: &str = "kolux-dev: drive Kolux from a terminal\n\n  kolux-dev worktree create --name <name> [--repo <selector>] [--agent <id>] [--prompt <text>]\n      [--setup run|skip|inherit] [--base-branch <ref>] [--issue <number>] [--comment <text>]\n      [--parent-worktree <selector>] [--no-parent] [--run-hooks] [--activate] [--json]\n  kolux-dev worktree rm --worktree <selector> [--force] [--run-hooks] [--json]\n      (also: remove, delete)\n\nSelectors: --repo id:|name:|path:   --worktree current|id:|name:|branch:|path:\n--json prints one envelope on stdout; without it, errors go to stderr. Exit 0 worked, 1 any error.\n";

const SWITCHES: &[&str] = &["force", "activate", "run-hooks", "no-parent"];
const CREATE_FLAGS: &[&str] = &["name", "repo", "agent", "prompt", "setup", "base-branch", "issue", "comment", "parent-worktree", "no-parent", "run-hooks", "activate"];
const RM_FLAGS: &[&str] = &["worktree", "force", "run-hooks"];

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
        _ => format!("removed {}", s("path")),
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
        let req = Request { id: id.clone(), token, command: parsed.command.clone(), cwd, args: Value::Object(parsed.args.clone()) };
        Ok((parsed.command.clone(), call(port, &req)?))
    };
    finish(run())
}

// ---------------------------------------------------------------- the app's side

/// What a command needs from the app: Git, the store, the open terminals, and a way to tell the
/// front end what changed.
pub struct Ctx<'a> {
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
            let agent = match text("agent") {
                Some(id) => {
                    let known = crate::agents::agent_list().into_iter().find(|x| x.id == id).ok_or_else(|| Fail::args(format!("Kolux knows no agent `{id}`")))?;
                    if !known.installed {
                        return Err(Fail::new("failed", format!("{} is not installed", known.name)));
                    }
                    Some(id)
                }
                None => None,
            };
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
                projects::set_name(&store, &w.path, None)?;
            }
            (ctx.notify)(json!({ "kind": "removed", "path": w.path }));
            Ok(json!({ "path": w.path, "branch": w.branch, "name": w.name, "projectId": project.id }))
        }
        other => Err(Fail::args(format!("unknown command {other}"))),
    }
}

/// A token nobody outside this machine can guess: two hashes seeded from the OS's randomness.
fn token() -> String {
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
            dispatch(&Ctx { git: &git, store: &store, terminals: &terminals, notify: &notify }, req)
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
        let ctx = Ctx { git: &git_, store: &store, terminals: &terminals, notify: &notify };
        let req = |command: &str, cwd: &Path, args: Value| Request { id: "r".into(), token: String::new(), command: command.into(), cwd: cwd.display().to_string(), args };

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
        let _ = std::fs::remove_dir_all(&dir);
    }
}
