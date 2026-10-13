//! Orchestration mail and tasks (ORCH-001..006, ORCH-010, ORCH-011, ORCH-013): Runs, which pane is tied to which
//! Run, typed messages, and the batches `check` hands out until they are acknowledged. All of it
//! is one JSON value in the store; the command line reaches it through `cli::dispatch`.

use crate::cli::Fail;
use serde::{Deserialize, Serialize};
use serde_json::{json, Map, Value};
use std::collections::BTreeMap;

const KEY: &str = "orchestration.mail";
pub const KINDS: &[&str] = &["status", "dispatch", "worker_done", "merge_ready", "escalation", "handoff", "decision_gate", "question", "heartbeat"];

/// ORCH-004: an open terminal as a group send sees it: the agent Kolux detected in it (none for
/// a shell or an agent of unknown kind), whether it is quiet, and the folder it runs in.
#[derive(Clone, Debug)]
pub struct Peer {
    pub handle: String,
    pub agent: Option<String>,
    pub idle: bool,
    pub dir: String,
}

/// Do two folder spellings name the same place (slashes, a trailing slash and letter case aside)?
// ponytail: text compare, no disk lookup; links and short names count as different folders.
fn same_path(a: &str, b: &str) -> bool {
    let n = |s: &str| s.trim().replace('\\', "/").trim_end_matches('/').to_ascii_lowercase();
    n(a) == n(b)
}

#[derive(Default, Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(default, rename_all = "camelCase")]
pub struct Mail {
    pub runs: Vec<Run>,
    pub bindings: BTreeMap<String, Binding>,
    pub messages: Vec<Message>,
    pub deliveries: Vec<Delivery>,
    pub answers: BTreeMap<String, Value>,
    pub seq: u64,
    pub gates: Vec<Gate>,
    /// ORCH-030: when each receipt in `answers` was written, so old ones can be pruned.
    pub stamps: BTreeMap<String, u64>,
    /// ORCH-030: requests that take a while (a worker start) and have not finished, with when they
    /// began and the process that runs them.
    pub pending: BTreeMap<String, Value>,
}

/// ORCH-030: how long a finished request's receipt is kept for a retry to find.
pub const RECEIPT_TTL_MS: u64 = 7 * 24 * 3_600_000;
/// ORCH-030: unfinished requests the ledger tracks before it turns new changes away.
pub const MAX_PENDING: usize = 32;

fn wall_ms() -> u64 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0)
}

/// ORCH-028: a decision the coordinator still has to make, holding one task blocked meanwhile.
#[derive(Default, Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(default, rename_all = "camelCase")]
pub struct Gate {
    pub id: String,
    pub run: Option<String>,
    pub task: String,
    pub question: String,
    pub options: Vec<String>,
    pub status: String,
    pub resolution: Option<String>,
    pub created: u64,
    pub resolved: Option<u64>,
}

#[derive(Default, Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(default, rename_all = "camelCase")]
pub struct Run {
    pub id: String,
    pub objective: String,
    pub home: String,
    pub created: u64,
}

#[derive(Default, Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(default, rename_all = "camelCase")]
pub struct Binding {
    pub run: Option<String>,
    pub epoch: u64,
}

#[derive(Default, Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(default, rename_all = "camelCase")]
pub struct Message {
    pub id: String,
    pub to: String,
    pub run: Option<String>,
    pub from: String,
    pub subject: String,
    pub body: String,
    #[serde(rename = "type")]
    pub kind: String,
    pub priority: String,
    pub extras: Map<String, Value>,
    pub at: u64,
}

#[derive(Default, Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(default, rename_all = "camelCase")]
pub struct Delivery {
    pub id: String,
    pub reader: String,
    pub messages: Vec<String>,
    pub acked: bool,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Mode {
    Next,
    Peek,
    Unread,
    All,
}

/// Dispatch states after which a worker gets no more mail (ORCH-003).
const FINISHED: &[&str] = &["completed", "failed", "stopped", "abandoned", "released"];

fn args(message: impl Into<String>) -> Fail {
    Fail::new("invalid_arguments", message)
}

/// Who is calling (ORCH-001, CLI-039): the handle and secret pane key every Kolux terminal carries
/// must match a pane the runtime started itself. A shell outside Kolux (or a guessed key) is
/// nobody: `None`. The pane key decides: a handle the environment still names after it went stale
/// is worked out again from the key (CLI-034); a key the runtime never gave is no one.
/// `--from` may only name the calling terminal itself: another handle is refused, and so is any
/// handle from a shell whose own identity cannot be proven (fail closed).
pub fn caller_of(from: Option<&str>, pane: Option<(&str, &str)>, by_key: &dyn Fn(&str) -> Option<String>) -> Result<Option<String>, Fail> {
    let me = pane.and_then(|(_, k)| by_key(k));
    let Some(h) = from.map(str::trim).filter(|h| !h.is_empty()) else { return Ok(me) };
    match me {
        Some(me) if me == h => Ok(Some(me)),
        Some(me) => Err(Fail::new("caller_mismatch", format!("this command runs in {me}, so it cannot act as {h}: drop --from {h}, or run the command in {h} itself"))),
        None => Err(Fail {
            code: "unbound_caller",
            message: format!("--from {h} cannot be proven here: this shell is not a terminal Kolux started, so it has no identity to check it against"),
            data: json!({ "hint": "run the command inside a Kolux terminal; its KOLUX_TERMINAL_HANDLE and KOLUX_PANE_KEY say who is calling" }),
        }),
    }
}

pub(crate) fn finished(d: &Value) -> bool {
    FINISHED.contains(&d["status"].as_str().unwrap_or_default())
}

/// The handle of a dispatch's terminal, while it can still be that terminal: handles count up
/// again from term-1 when Kolux restarts, so one stamped by an earlier run of the app is no one.
fn terminal_of(d: &Value) -> Option<String> {
    if d["runtime"].as_u64().is_some_and(|r| r != u64::from(std::process::id())) {
        return None;
    }
    d["terminal"].as_u64().map(|t| crate::terminal::handle_of(t as u32))
}

/// The open dispatch whose worker runs in `pane`, if any.
fn own_dispatch<'a>(pane: &str, dispatches: &'a [Value]) -> Option<&'a Value> {
    dispatches.iter().rev().find(|d| !finished(d) && terminal_of(d).as_deref() == Some(pane))
}

/// ORCH-032: the nesting cap when nothing raises it: the coordinator plus one level of workers.
pub const DEFAULT_MAX_DEPTH: u32 = 1;

/// ORCH-032: the depth and cap a worker started from `pane` gets, or the refusal that tells the
/// caller to do the work itself. A coordinator (no dispatch of its own) takes the cap asked for
/// (`--max-depth`), else the configured one, else 1. A worker keeps the cap its coordinator gave it
/// and can only lower it. A dispatch stored before depth was recorded counts as one level down.
pub fn nest(pane: Option<&str>, dispatches: &[Value], asked: Option<u32>, configured: Option<u32>) -> Result<(u32, u32), Fail> {
    let own = pane.and_then(|p| own_dispatch(p, dispatches));
    let depth = own.map(|d| d["depth"].as_u64().unwrap_or(1) as u32).unwrap_or(0);
    let cap = match own {
        Some(d) => {
            let given = d["maxDepth"].as_u64().map(|c| c as u32).unwrap_or(DEFAULT_MAX_DEPTH);
            asked.map_or(given, |a| a.min(given))
        }
        None => asked.or(configured).unwrap_or(DEFAULT_MAX_DEPTH),
    };
    if depth + 1 > cap {
        return Err(Fail {
            code: "nesting_limit",
            message: format!("you are a worker {depth} level{} down and the nesting cap is {cap} level{} of workers: do this task yourself instead of starting another worker", if depth == 1 { "" } else { "s" }, if cap == 1 { "" } else { "s" }),
            data: json!({ "depth": depth, "maxDepth": cap }),
        });
    }
    Ok((depth + 1, cap))
}

/// ORCH-033: task `id` as Run `run` sees it. A task of another Run reads exactly as a missing one,
/// so Runs cannot be mapped from outside.
pub fn task_in(tasks: &[Value], id: &str, run: Option<&str>) -> Result<usize, Fail> {
    tasks.iter().position(|t| t["id"] == id && t["runId"].as_str() == run).ok_or_else(|| Fail::new("not_found", format!("no task {id}")))
}

/// ORCH-023: fences dispatch `id` off. Its worker can no longer report on it, and its task can be
/// handed on again; no process is stopped, no pane closes and nothing on disk changes. A dispatch
/// of another Run reads as missing. Abandoning twice answers the same.
pub fn abandon(tasks: &mut [Value], dispatches: &mut [Value], id: &str, run: Option<&str>, now: u64) -> Result<Value, Fail> {
    let d = dispatches.iter_mut().find(|d| d["id"] == id && d["runId"].as_str() == run).ok_or_else(|| Fail::new("not_found", format!("no dispatch {id}")))?;
    let was = d["status"].as_str().unwrap_or_default().to_string();
    if was != "abandoned" {
        if finished(d) {
            return Err(Fail::new("dispatch_finished", format!("{id} is already {was}; there is nothing to abandon")));
        }
        d["status"] = json!("abandoned");
        d["abandonedAt"] = json!(now);
    }
    let task = d["taskId"].as_str().unwrap_or_default().to_string();
    if let Some(t) = tasks.iter_mut().find(|t| t["id"] == task.as_str() && t["dispatchId"] == id && status(t) == "dispatched") {
        t["status"] = json!("ready");
        if let Some(o) = t.as_object_mut() {
            o.remove("dispatchId");
        }
    }
    let task_status = tasks.iter().find(|t| t["id"] == task.as_str()).map(|t| t["status"].clone()).unwrap_or(Value::Null);
    Ok(json!({ "dispatchId": id, "taskId": task, "status": "abandoned", "terminal": terminal_of(d), "terminalKept": true, "taskStatus": task_status, "mode": d["mode"] }))
}

/// ORCH-012: moves task `id` to `to`, its dispatch with it. Completing or failing a dispatched
/// task settles its worker the same way, which frees the slot it held; any other move fences the
/// worker off, so a task is never dispatched with no worker or with two. Only dispatch and
/// worker-start make a task dispatched. A worker whose dispatch was fenced off, or whose process
/// already ended, cannot settle the task from its terminal (`caller`).
#[allow(clippy::too_many_arguments)]
pub fn task_update(tasks: &mut [Value], dispatches: &mut [Value], id: &str, to: &str, result: Option<&str>, run: Option<&str>, caller: Option<&str>, now: u64) -> Result<Value, Fail> {
    if !TASK_STATES.contains(&to) {
        return Err(args(format!("--status takes one of {}", TASK_STATES.join(", "))));
    }
    if result.is_some_and(|r| r.len() > SPEC_MAX) {
        return Err(Fail::new("too_large", format!("the result is longer than the {SPEC_MAX} bytes Kolux stores")));
    }
    let i = task_in(tasks, id, run)?;
    if let Some(d) = dispatches.iter().rev().find(|d| d["taskId"] == id && d["runId"].as_str() == run && caller.is_some() && terminal_of(d).as_deref() == caller) {
        let did = d["id"].as_str().unwrap_or_default();
        if finished(d) {
            return Err(Fail::new("dispatch_finished", format!("{did} was {}: its worker can no longer change {id}", d["status"].as_str().unwrap_or_default())));
        }
        if !d["exitedAt"].is_null() {
            return Err(Fail::new("worker_exited", format!("{did}'s agent had already ended, so it cannot report {id} {to}; its Run was told and its terminal is kept to read")));
        }
    }
    let was = status(&tasks[i]).to_string();
    let open = tasks[i]["dispatchId"].as_str().map(str::to_string).filter(|_| was == "dispatched");
    if to == "dispatched" && open.is_none() {
        return Err(Fail::new("invalid_transition", format!("{id} is {was}; a task is dispatched only by orchestration dispatch or worker-start, so it always has one worker")));
    }
    let mut settled = Value::Null;
    if let (Some(did), true) = (&open, to != "dispatched") {
        if let Some(d) = dispatches.iter_mut().find(|d| d["id"] == did.as_str() && !finished(d)) {
            let s = if to == "completed" || to == "failed" { to } else { "abandoned" };
            d["status"] = json!(s);
            d["settledAt"] = json!(now);
            settled = json!(s);
        }
        if to != "completed" && to != "failed" {
            if let Some(o) = tasks[i].as_object_mut() {
                o.remove("dispatchId");
            }
        }
    }
    tasks[i]["status"] = json!(to);
    tasks[i]["updated"] = json!(now);
    if let Some(r) = result {
        tasks[i]["result"] = json!(r);
    }
    Ok(json!({ "taskId": id, "status": to, "previous": was, "result": tasks[i]["result"], "dispatchId": open, "dispatchStatus": settled }))
}

/// ORCH-015: what a done report or heartbeat on a dispatch does beyond being mail. From the terminal
/// the worker runs in, a heartbeat stamps the dispatch with when Kolux got it (never a time the
/// sender gives), and a done report settles its task: succeeded completes it and frees the tasks
/// waiting on it, failed fails it. From any other pane, or for a worker terminal of an earlier
/// start, it settles nothing and says why. A report that cannot be shown to settle its task fails.
/// Anything else is Null.
pub fn report(tasks: &mut [Value], dispatches: &mut [Value], from: &str, a: &Value, now: u64) -> Result<Value, Fail> {
    let text = |k: &str| a[k].as_str().map(str::trim).filter(|s| !s.is_empty());
    let kind = text("type").unwrap_or("status");
    let (true, Some(id)) = (kind == "worker_done" || kind == "heartbeat", text("dispatchId")) else {
        return Ok(Value::Null);
    };
    let Some(i) = dispatches.iter().position(|d| d["id"] == id) else {
        return Ok(Value::Null);
    };
    match terminal_of(&dispatches[i]) {
        Some(t) if t == from => {}
        Some(t) => return Ok(json!({ "dispatchId": id, "settles": false, "why": format!("{id} runs in {t}; only a report from {t} itself counts, so this one is mail only") })),
        None => return Ok(json!({ "dispatchId": id, "settles": false, "why": format!("{id}'s worker terminal is from an earlier start of Kolux, so this report cannot be vouched for and is mail only") })),
    }
    if kind == "heartbeat" {
        dispatches[i]["lastBeatAt"] = json!(now);
        return Ok(json!({ "dispatchId": id, "lastBeatAt": now }));
    }
    let task = dispatches[i]["taskId"].as_str().unwrap_or_default().to_string();
    let run = dispatches[i]["runId"].as_str().map(str::to_string);
    let unknown = |why: String| Fail::new("outcome_unknown", format!("Kolux could not settle {task} from this report, so its outcome is unknown: {why}"));
    let t = task_in(tasks, &task, run.as_deref()).map_err(|e| unknown(e.message))?;
    if tasks[t]["dispatchId"] != id {
        return Err(unknown(format!("{task} is no longer on {id}")));
    }
    let to = if text("outcome") == Some("succeeded") { "completed" } else { "failed" };
    let out = task_update(tasks, dispatches, &task, to, text("body").or(text("subject")), run.as_deref(), Some(from), now).map_err(|e| unknown(e.message))?;
    promote(tasks);
    Ok(out)
}

/// ORCH-022: fences dispatch `id` off as stopped and hands back the terminal to end, when Kolux
/// still holds it. The worktree and every other terminal stay, and its task can be handed on
/// again. A terminal from an earlier start of Kolux reads as unverifiable, never as ended.
/// Stopping twice answers the same.
// ponytail: a terminal the user has typed into is ended like any other; ORCH-036 keeps it open.
pub fn stop(tasks: &mut [Value], dispatches: &mut [Value], id: &str, run: Option<&str>, now: u64) -> Result<(Value, Option<u32>), Fail> {
    let d = dispatches.iter_mut().find(|d| d["id"] == id && d["runId"].as_str() == run).ok_or_else(|| Fail::new("not_found", format!("no dispatch {id}")))?;
    let was = d["status"].as_str().unwrap_or_default().to_string();
    let term = terminal_of(d);
    let mut kill = None;
    if was != "stopped" {
        if finished(d) {
            return Err(Fail::new("dispatch_finished", format!("{id} is already {was}; there is no worker to stop")));
        }
        let process = if !d["exitedAt"].is_null() {
            "ended"
        } else if term.is_none() {
            "unverifiable"
        } else {
            kill = d["terminal"].as_u64().map(|t| t as u32);
            "ended"
        };
        d["status"] = json!("stopped");
        d["stoppedAt"] = json!(now);
        d["process"] = json!(process);
    }
    let task = d["taskId"].as_str().unwrap_or_default().to_string();
    let receipt = json!({ "dispatchId": id, "taskId": task, "status": "stopped", "terminal": term, "process": d["process"], "worktree": d["worktree"], "worktreeKept": true });
    if let Some(t) = tasks.iter_mut().find(|t| t["id"] == task.as_str() && t["dispatchId"] == id && status(t) == "dispatched") {
        t["status"] = json!("ready");
        if let Some(o) = t.as_object_mut() {
            o.remove("dispatchId");
        }
    }
    let mut receipt = receipt;
    receipt["taskStatus"] = tasks.iter().find(|t| t["id"] == task.as_str()).map(|t| t["status"].clone()).unwrap_or(Value::Null);
    Ok((receipt, kill))
}

/// ORCH-026: the terminal states worker-list can filter by. Release pending and release unknown
/// belong to worker-release, which is not built yet, so nothing is in them today.
pub const TERMINAL_STATES: [&str; 6] = ["active", "reclaimable", "retained", "release_pending", "release_unknown", "released"];

/// ORCH-026: what is left of a worker's terminal, apart from its task status. A kept worker stays
/// kept after its process ends or Kolux restarts (ORCH-025); a settled worker whose terminal is
/// gone has nothing left to clean up.
fn terminal_state(d: &Value, live: &dyn Fn(&str) -> bool) -> &'static str {
    if d["released"] == true {
        "released"
    } else if !finished(d) {
        "active"
    } else if d["retained"] == true {
        "retained"
    } else if terminal_of(d).is_some_and(|h| live(&h)) {
        "reclaimable"
    } else {
        "released"
    }
}

/// ORCH-026: the workers in one Run (or every Run), a page at a time. The cursor is opaque and
/// carries the scope it came from, so it cannot page another Run's list.
#[allow(clippy::too_many_arguments)]
pub fn worker_list(tasks: &[Value], dispatches: &[Value], run: Option<&str>, from: &str, state: Option<&str>, cursor: Option<&str>, limit: usize, live: &dyn Fn(&str) -> bool) -> Result<Value, Fail> {
    use base64::Engine;
    let b64 = base64::engine::general_purpose::URL_SAFE_NO_PAD;
    let scope = run.unwrap_or("*");
    let start = match cursor {
        None => 0,
        Some(c) => {
            let raw = b64.decode(c.trim()).ok().and_then(|b| String::from_utf8(b).ok()).ok_or_else(|| args("that cursor is not one worker-list gave out"))?;
            let (of, at) = raw.rsplit_once('|').ok_or_else(|| args("that cursor is not one worker-list gave out"))?;
            if of != scope {
                return Err(args("that cursor came from another Run's worker list; start again without --cursor"));
            }
            at.parse::<usize>().map_err(|_| args("that cursor is not one worker-list gave out"))?
        }
    };
    let rows: Vec<Value> = dispatches
        .iter()
        .filter(|d| run.is_none() || d["runId"].as_str() == run)
        .map(|d| {
            let ts = terminal_state(d, live);
            let handle = terminal_of(d);
            let id = d["id"].as_str().unwrap_or_default();
            let next = match (ts, &handle) {
                ("active", _) => Some(format!("{CLI} orchestration worker-stop --dispatch {id}")),
                // ponytail: worker-release (ORCH-024) is not built, so the way to free a settled
                // worker's terminal is closing it by hand; release replaces this once it lands.
                ("reclaimable" | "retained", Some(h)) => Some(format!("{CLI} terminal close --terminal {h}")),
                _ => None,
            };
            let task = tasks.iter().find(|t| t["id"] == d["taskId"]).map(|t| t["status"].clone()).unwrap_or(Value::Null);
            json!({ "dispatchId": d["id"], "taskId": d["taskId"], "taskStatus": task, "status": d["status"], "terminalState": ts, "terminal": handle, "worktree": d["worktree"], "agent": d["agent"], "runId": d["runId"], "lastBeatAt": d["lastBeatAt"], "next": next })
        })
        .filter(|w| state.is_none_or(|s| w["terminalState"] == s))
        .collect();
    let page: Vec<Value> = rows.iter().skip(start).take(limit).cloned().collect();
    let next = (start + limit < rows.len()).then(|| b64.encode(format!("{scope}|{}", start + limit)));
    Ok(json!({ "workers": page, "nextCursor": next, "total": rows.len(), "scope": { "run": run, "from": from } }))
}

/// ORCH-025: keep a settled worker's terminal open on purpose. The mark lives on the stored
/// dispatch, so it survives a restart; keeping twice does no harm.
pub fn retain(dispatches: &mut [Value], live: &dyn Fn(&str) -> bool, id: &str, run: Option<&str>) -> Result<Value, Fail> {
    let d = dispatches.iter_mut().find(|d| d["id"] == id && d["runId"].as_str() == run).ok_or_else(|| Fail::new("not_found", format!("no dispatch {id}")))?;
    let already = d["retained"] == true;
    if !already {
        match terminal_state(d, live) {
            "active" => return Err(Fail::new("dispatch_active", format!("{id} is still working; keep its terminal once it has settled, or stop it with worker-stop"))),
            "released" => return Err(Fail::new("terminal_gone", format!("{id}'s terminal is already gone, so there is nothing to keep"))),
            _ => d["retained"] = json!(true),
        }
    }
    Ok(json!({ "dispatchId": id, "taskId": d["taskId"], "terminal": terminal_of(d), "terminalState": "retained", "alreadyRetained": already }))
}

/// ORCH-040: the open dispatches tied to one worktree, by the folder they were started in or by a
/// live terminal that sits there.
pub fn workers_in(dispatches: &[Value], here: &dyn Fn(&str) -> bool, homed: &dyn Fn(&str) -> bool) -> Vec<Value> {
    dispatches
        .iter()
        .filter(|d| !finished(d))
        .filter_map(|d| {
            let t = terminal_of(d);
            let mine = d["worktree"].as_str().is_some_and(here) || t.as_deref().is_some_and(homed);
            mine.then(|| json!({ "dispatchId": d["id"], "taskId": d["taskId"], "runId": d["runId"], "status": d["status"], "agent": d["agent"], "terminal": t }))
        })
        .collect()
}

impl Mail {
    pub fn load(store: &crate::state::Store) -> Mail {
        store.get(KEY).ok().flatten().and_then(|s| serde_json::from_str(&s).ok()).unwrap_or_default()
    }

    pub fn save(&self, store: &crate::state::Store) -> Result<(), Fail> {
        let text = serde_json::to_string(self).map_err(|e| Fail::new("failed", e.to_string()))?;
        store.set(KEY, &text).map_err(|e| Fail::new("failed", e.to_string()))
    }

    fn next(&mut self, prefix: &str) -> String {
        self.seq += 1;
        format!("{prefix}-{}", self.seq)
    }

    pub fn bound(&self, pane: &str) -> Option<&str> {
        self.bindings.get(pane).and_then(|b| b.run.as_deref())
    }

    /// ORCH-033: the Run a pane acts in: the one it is tied to, else the Run of the dispatch its
    /// worker is on. A worker that makes a Run of its own acts in that one from then on.
    pub fn run_of(&self, pane: &str, dispatches: &[Value]) -> Option<String> {
        self.bound(pane).map(str::to_string).or_else(|| own_dispatch(pane, dispatches).and_then(|d| d["runId"].as_str().map(str::to_string)))
    }

    /// Goes up every time the pane is tied to a Run, so a check that started waiting before can
    /// tell it was fenced off.
    pub fn epoch(&self, pane: &str) -> u64 {
        self.bindings.get(pane).map(|b| b.epoch).unwrap_or(0)
    }

    fn bind(&mut self, pane: &str, run: &str) {
        let b = self.bindings.entry(pane.to_string()).or_default();
        b.run = Some(run.to_string());
        b.epoch += 1;
    }

    /// A retry request id makes a change safe to repeat: the same id hands back the first answer
    /// (ORCH-030). A change that fails leaves no receipt, so the same id later runs fresh.
    pub fn once(&mut self, key: Option<String>, f: impl FnOnce(&mut Mail) -> Result<Value, Fail>) -> Result<Value, Fail> {
        if let Some(v) = key.as_ref().and_then(|k| self.answers.get(k)) {
            return Ok(v.clone());
        }
        if key.is_some() {
            self.room()?;
        }
        let v = f(self)?;
        if let Some(k) = key {
            self.finish(&k, Some(v.clone()));
        }
        Ok(v)
    }

    fn room(&self) -> Result<(), Fail> {
        if self.pending.len() >= MAX_PENDING {
            return Err(Fail::new("busy", format!("{MAX_PENDING} earlier requests have not finished yet, so Kolux takes no new change until one does; ask about one with request-show")));
        }
        Ok(())
    }

    /// ORCH-030: a long request is under way; a retry with its id waits for it.
    pub fn begin(&mut self, key: &str, runtime: u64) -> Result<(), Fail> {
        self.room()?;
        self.pending.insert(key.to_string(), json!({ "at": wall_ms(), "runtime": runtime }));
        Ok(())
    }

    /// ORCH-030: the request is over: its receipt is kept (`Some`) or it left none, and finished
    /// receipts older than `RECEIPT_TTL_MS` are dropped.
    pub fn finish(&mut self, key: &str, answer: Option<Value>) {
        let now = wall_ms();
        self.pending.remove(key);
        if let Some(v) = answer {
            self.answers.insert(key.to_string(), v);
            self.stamps.insert(key.to_string(), now);
        }
        for k in self.answers.keys() {
            self.stamps.entry(k.clone()).or_insert(now);
        }
        let old: Vec<String> = self.stamps.iter().filter(|(_, at)| now.saturating_sub(**at) > RECEIPT_TTL_MS).map(|(k, _)| k.clone()).collect();
        for k in old {
            self.answers.remove(&k);
            self.stamps.remove(&k);
        }
    }

    /// ORCH-030: what became of the request this terminal sent with `--retry-request <id>`:
    /// completed (with its result), pending, or absent. It changes nothing. A pending request left
    /// by an earlier start of Kolux (`runtime` is this one's process id) is marked interrupted.
    pub fn request_show(&self, pane: &str, id: &str, runtime: u64) -> Value {
        let tail = format!("|{pane}|{id}");
        let command = |k: &str| k.strip_suffix(&tail).unwrap_or_default().to_string();
        if let Some((k, v)) = self.answers.iter().find(|(k, _)| k.ends_with(&tail)) {
            return json!({ "request": id, "state": "completed", "command": command(k), "result": v });
        }
        if let Some((k, p)) = self.pending.iter().find(|(k, _)| k.ends_with(&tail)) {
            let interrupted = p["runtime"].as_u64() != Some(runtime);
            return json!({ "request": id, "state": "pending", "command": command(k), "since": p["at"], "interrupted": interrupted });
        }
        json!({ "request": id, "state": "absent" })
    }

    fn run_view(&self, id: &str) -> Value {
        match self.runs.iter().find(|r| r.id == id) {
            Some(r) => json!({ "id": r.id, "objective": r.objective, "home": r.home, "created": r.created }),
            None => Value::Null,
        }
    }

    /// ORCH-001: a Run is a namespace with a home mailbox; making one schedules nothing.
    // ORCH-032: a worker's depth comes from its dispatch, so a Run made here leaves it as it was.
    pub fn run_create(&mut self, pane: &str, objective: &str, now: u64) -> Value {
        let id = self.next("run");
        self.runs.push(Run { id: id.clone(), objective: objective.to_string(), home: pane.to_string(), created: now });
        self.bind(pane, &id);
        json!({ "run": self.run_view(&id), "binding": { "terminal": pane, "runId": id } })
    }

    /// ORCH-002: points the pane at another Run; any waiter parked on the old one is fenced.
    // Runs left by an older install (ORCH-048) are a skip in DECISIONS.md, so none can be legacy;
    // --takeover-legacy is accepted for scripts that pass it and changes nothing.
    pub fn run_use(&mut self, pane: &str, id: &str) -> Result<Value, Fail> {
        if !self.runs.iter().any(|r| r.id == id) {
            return Err(Fail::new("not_found", format!("no Run {id}")));
        }
        self.bind(pane, id);
        Ok(json!({ "run": self.run_view(id), "binding": { "terminal": pane, "runId": id } }))
    }

    pub fn run_current(&self, pane: &str) -> Value {
        let run = self.bound(pane);
        json!({ "terminal": pane, "runId": run, "run": run.map(|r| self.run_view(r)) })
    }

    /// Newest first, `limit` at a time; the cursor is where the next page starts.
    pub fn run_list(&self, limit: usize, cursor: Option<&str>) -> Result<Value, Fail> {
        let start = match cursor {
            Some(c) => c.parse::<usize>().map_err(|_| args("that cursor is not one run-list gave out"))?,
            None => 0,
        };
        let runs: Vec<Value> = self.runs.iter().rev().skip(start).take(limit).map(|r| self.run_view(&r.id)).collect();
        let next = (start + limit < self.runs.len()).then(|| (start + limit).to_string());
        Ok(json!({ "runs": runs, "nextCursor": next, "total": self.runs.len() }))
    }

    pub fn run_show(&self, id: &str) -> Result<Value, Fail> {
        let mut v = self.run_view(id);
        let obj = v.as_object_mut().ok_or_else(|| Fail::new("not_found", format!("no Run {id}")))?;
        let terminals: Vec<&String> = self.bindings.iter().filter(|(_, b)| b.run.as_deref() == Some(id)).map(|(h, _)| h).collect();
        let mail: Vec<&Message> = self.messages.iter().filter(|m| m.run.as_deref() == Some(id)).collect();
        let acked = self.acked();
        obj.insert("terminals".into(), json!(terminals));
        obj.insert("messages".into(), json!(mail.len()));
        obj.insert("unacknowledged".into(), json!(mail.iter().filter(|m| !acked.contains(&m.id)).count()));
        Ok(v)
    }

    /// The mailboxes a pane reads: its own terminal box, its Run when it is tied to one, and the
    /// box of any active dispatch it is the worker of.
    pub fn boxes_of(&self, pane: &str, dispatches: &[Value]) -> Vec<String> {
        let mut boxes = vec![format!("term:{pane}")];
        if let Some(r) = self.bound(pane) {
            boxes.push(format!("run:{r}"));
        }
        for d in dispatches.iter().filter(|d| !finished(d) && terminal_of(d).as_deref() == Some(pane)) {
            boxes.push(format!("dispatch:{}", d["id"].as_str().unwrap_or_default()));
        }
        boxes
    }

    /// ORCH-003: one typed message, routed by its recipient field only, or refused whole.
    pub fn send(&mut self, from: &str, a: &Value, dispatches: &[Value], live: &dyn Fn(&str) -> bool, now: u64) -> Result<Value, Fail> {
        let text = |k: &str| a[k].as_str().map(str::trim).filter(|s| !s.is_empty()).map(str::to_string);
        let subject = text("subject").ok_or_else(|| args("--subject is required"))?;
        let kind = text("type").unwrap_or_else(|| "status".into());
        if !KINDS.contains(&kind.as_str()) {
            return Err(args(format!("--type takes one of {}", KINDS.join(", "))));
        }
        let priority = text("priority").unwrap_or_else(|| "normal".into());
        if !["normal", "high", "urgent"].contains(&priority.as_str()) {
            return Err(args("--priority takes normal, high or urgent"));
        }
        let outcome = text("outcome");
        if outcome.as_deref().is_some_and(|o| o != "succeeded" && o != "failed") {
            return Err(args("--outcome takes succeeded or failed"));
        }
        if kind == "worker_done" && outcome.is_none() {
            return Err(args("a done report must say how it ended: --outcome succeeded or failed"));
        }
        // ORCH-023: a dispatch that was abandoned (or has otherwise finished) takes no more reports.
        if kind == "worker_done" || kind == "heartbeat" {
            if let Some(d) = text("dispatchId").and_then(|id| dispatches.iter().find(|d| d["id"] == id.as_str())).filter(|d| finished(d)) {
                let id = d["id"].as_str().unwrap_or_default();
                return Err(Fail::new("dispatch_finished", format!("{id} was {}: Kolux takes no more reports on it", d["status"].as_str().unwrap_or_default())));
            }
            // CLI-039, ORCH-015: a report from any other pane is still delivered as mail; only
            // `report` decides whether it settles anything.
        }
        let payload = text("payload").map(|p| serde_json::from_str::<Value>(&p)).transpose().map_err(|_| args("--payload takes JSON"))?;
        let named = text("run");
        if let Some(r) = &named {
            if !self.runs.iter().any(|x| &x.id == r) {
                return Err(Fail::new("not_found", format!("no Run {r}")));
            }
        }
        let run_exists = |id: &str| self.runs.iter().any(|x| x.id == id);
        let (to, run) = match text("to") {
            Some(t) if t.starts_with('@') => {
                if kind == "worker_done" || kind == "heartbeat" {
                    return Err(args("done reports and heartbeats never go to a group; send them to run:<id>"));
                }
                // ORCH-004: groups fan out in `post`, which hands each copy here with one handle.
                return Err(Fail::new("unsupported", format!("{t} is a group address; send it through post")));
            }
            Some(t) if t.starts_with("run:") => {
                let id = &t[4..];
                if !run_exists(id) {
                    return Err(Fail::new("not_found", format!("no Run {id}")));
                }
                (t.clone(), Some(id.to_string()))
            }
            Some(t) if t.starts_with("dispatch:") => {
                let id = &t[9..];
                let d = dispatches.iter().find(|d| d["id"] == id).ok_or_else(|| Fail::new("not_found", format!("no dispatch {id}")))?;
                let run = d["runId"].as_str().map(str::to_string);
                if finished(d) {
                    let home = run.as_ref().map(|r| format!("run:{r}")).unwrap_or_else(|| "its Run".into());
                    return Err(Fail { code: "dispatch_finished", message: format!("{id} has finished; write to {home} instead"), data: json!({ "hint": format!("--to {home}") }) });
                }
                (t.clone(), run)
            }
            Some(h) => {
                if !live(&h) {
                    return Err(Fail::new("not_found", format!("no open Kolux terminal is called {h}")));
                }
                (format!("term:{h}"), self.bound(&h).map(str::to_string))
            }
            None => {
                let own = dispatches.iter().find(|d| !finished(d) && terminal_of(d).as_deref() == Some(from)).and_then(|d| d["runId"].as_str());
                match named.as_deref().or(own) {
                    Some(r) => (format!("run:{r}"), Some(r.to_string())),
                    None => return Err(args("say who gets it: --to run:<id>, dispatch:<id> or a terminal handle")),
                }
            }
        };
        if let (Some(n), Some(r)) = (&named, &run) {
            if n != r {
                return Err(Fail::new("run_mismatch", format!("{to} belongs to {r}, not to the Run named with --run ({n})")));
            }
        }
        let mut extras = Map::new();
        for k in ["threadId", "taskId", "dispatchId", "outcome", "reportPath", "phase", "fromAgent"] {
            if let Some(v) = text(k) {
                extras.insert(k.into(), json!(v));
            }
        }
        if let Some(p) = payload {
            extras.insert("payload".into(), p);
        }
        if let Some(f) = text("filesModified") {
            extras.insert("filesModified".into(), json!(f.split(',').map(str::trim).filter(|s| !s.is_empty()).collect::<Vec<_>>()));
        }
        let id = self.next("msg");
        let body = a["body"].as_str().unwrap_or_default().to_string();
        self.messages.push(Message { id: id.clone(), to: to.clone(), run: run.clone(), from: from.to_string(), subject, body, kind, priority, extras, at: now });
        Ok(json!({ "messageIds": [id], "to": to, "runId": run }))
    }

    /// ORCH-004: a group address (@all, @idle, @worktree:<id>, @claude, @codex, @cursor, @droid)
    /// becomes one copy per matching agent terminal, never the sender's own, all on one thread, or
    /// nothing at all; any other address is one ordinary send to the open terminals in `peers`.
    pub fn post(&mut self, from: &str, a: &Value, dispatches: &[Value], peers: &[Peer], now: u64) -> Result<Value, Fail> {
        let live = |h: &str| peers.iter().any(|p| p.handle == h);
        let mut a = a.clone();
        // ORCH-009: the sender's agent, as Kolux detected it, names it in the banner.
        let sender = peers.iter().find(|p| p.handle == from).and_then(|p| p.agent.as_deref());
        match sender.and_then(|id| crate::agents::CATALOGUE.iter().find(|e| e.0 == id)) {
            Some(e) => a["fromAgent"] = json!(e.1),
            None => {
                if let Some(o) = a.as_object_mut() {
                    o.remove("fromAgent");
                }
            }
        }
        let Some(group) = a["to"].as_str().map(str::trim).filter(|t| t.starts_with('@')).map(str::to_string) else {
            return self.send(from, &a, dispatches, &live, now);
        };
        let kind = a["type"].as_str().map(str::trim).unwrap_or("status");
        if kind == "worker_done" || kind == "heartbeat" {
            return Err(args("done reports and heartbeats never go to a group; send them to run:<id>"));
        }
        if kind == "question" {
            return Err(args(format!("a question goes to exactly one recipient, not to the group {group}")));
        }
        let name = group[1..].to_ascii_lowercase();
        let agents = peers.iter().filter(|p| p.handle != from && p.agent.is_some());
        let to: Vec<&Peer> = match name.as_str() {
            "all" => agents.collect(),
            "idle" => agents.filter(|p| p.idle).collect(),
            "claude" | "codex" | "cursor" | "droid" => agents.filter(|p| p.agent.as_deref().is_some_and(|x| x.eq_ignore_ascii_case(&name))).collect(),
            w if w.starts_with("worktree:") && w.len() > 9 => {
                // A worktree id is "<project id>::<path>"; the bare path is taken too.
                let id = &group[10..];
                let path = id.rsplit_once("::").map_or(id, |(_, p)| p);
                agents.filter(|p| same_path(&p.dir, path)).collect()
            }
            _ => return Err(args(format!("Kolux knows no group {group}; use @all, @idle, @worktree:<id>, @claude, @codex, @cursor or @droid"))),
        };
        if to.is_empty() {
            return Err(Fail::new("not_found", format!("{group} matches no agent terminal right now")));
        }
        let thread = a["threadId"].as_str().map(str::trim).filter(|s| !s.is_empty()).map(str::to_string).unwrap_or_else(|| self.next("thread"));
        a["threadId"] = json!(thread);
        let keep = self.messages.len();
        let mut made = Vec::new();
        for p in to {
            a["to"] = json!(p.handle);
            match self.send(from, &a, dispatches, &live, now) {
                Ok(r) => made.push(json!({ "id": r["messageIds"][0], "to": r["to"] })),
                Err(e) => {
                    self.messages.truncate(keep);
                    return Err(e);
                }
            }
        }
        let ids: Vec<Value> = made.iter().map(|m| m["id"].clone()).collect();
        Ok(json!({ "messageIds": ids, "messages": made, "threadId": thread, "to": group }))
    }

    fn acked(&self) -> std::collections::HashSet<String> {
        self.deliveries.iter().filter(|d| d.acked).flat_map(|d| d.messages.iter().cloned()).collect()
    }

    fn view(m: &Message) -> Value {
        let mut v = json!({ "id": m.id, "from": m.from, "to": m.to, "runId": m.run, "subject": m.subject, "body": m.body, "type": m.kind, "priority": m.priority, "at": m.at });
        if let Some(o) = v.as_object_mut() {
            o.extend(m.extras.clone());
        }
        // ORCH-006: every delivered message carries the command that answers it.
        v["reply"] = json!(format!("{CLI} orchestration reply --id {} --body \"<your answer>\"", m.id));
        v
    }

    /// ORCH-005: the oldest batch not yet acknowledged, the same batch again until its delivery id
    /// is acknowledged; peek, unread and all only look.
    #[allow(clippy::too_many_arguments)]
    pub fn check(&mut self, pane: &str, reader: &str, boxes: &[String], mode: Mode, types: Option<&[String]>, ack: Option<&str>, fence: Option<u64>) -> Result<Value, Fail> {
        if fence.is_some_and(|e| e != self.epoch(pane)) {
            return Err(Fail::new("fenced", "this terminal was tied to another Run while the check waited; check again"));
        }
        if let Some(id) = ack {
            let d = self.deliveries.iter_mut().find(|d| d.id == id && d.reader == reader).ok_or_else(|| Fail::new("not_found", format!("no delivery {id} for {reader}")))?;
            d.acked = true;
        }
        let wanted = |m: &Message| boxes.contains(&m.to) && types.is_none_or(|t| t.contains(&m.kind));
        let acked = self.acked();
        let taken: std::collections::HashSet<&String> = self.deliveries.iter().flat_map(|d| d.messages.iter()).collect();
        let open = self.deliveries.iter().find(|d| !d.acked && d.reader == reader && d.messages.iter().all(|id| self.messages.iter().any(|m| &m.id == id && wanted(m))));
        let fresh: Vec<&Message> = self.messages.iter().filter(|m| wanted(m) && !taken.contains(&m.id)).collect();
        let pick = |ids: &[String]| -> Vec<Value> { self.messages.iter().filter(|m| ids.contains(&m.id)).map(Self::view).collect() };
        let (delivery, shown): (Option<String>, Vec<Value>) = match mode {
            Mode::Peek => {
                let mut v = open.map(|d| pick(&d.messages)).unwrap_or_default();
                v.extend(fresh.iter().map(|m| Self::view(m)));
                (None, v)
            }
            Mode::Unread => (None, self.messages.iter().filter(|m| wanted(m) && !acked.contains(&m.id)).map(Self::view).collect()),
            Mode::All => (None, self.messages.iter().filter(|m| wanted(m)).map(Self::view).collect()),
            Mode::Next => match open {
                Some(d) => (Some(d.id.clone()), pick(&d.messages)),
                None if fresh.is_empty() => (None, Vec::new()),
                None => {
                    let ids: Vec<String> = fresh.iter().map(|m| m.id.clone()).collect();
                    let shown = pick(&ids);
                    let id = self.next("dlv");
                    self.deliveries.push(Delivery { id: id.clone(), reader: reader.to_string(), messages: ids, acked: false });
                    (Some(id), shown)
                }
            },
        };
        let mode = format!("{mode:?}").to_lowercase();
        Ok(json!({ "deliveryId": delivery, "messages": shown, "terminal": reader, "mailboxes": boxes, "mode": mode, "epoch": self.epoch(pane), "acknowledged": ack }))
    }
}

/// ORCH-006: bodies longer than this are cut in `inbox` unless `--full` is given.
const SHORT_BODY: usize = 120;
/// ORCH-010: a task text bigger than this is turned away before anything is touched.
pub const SPEC_MAX: usize = 4 * 1024 * 1024;
/// ORCH-011: the compact form cuts each task text here.
const BRIEF_CHARS: usize = 160;
pub const TASK_STATES: &[&str] = &["pending", "ready", "dispatched", "completed", "failed", "blocked"];

/// `s` cut to at most `n` characters, an ellipsis marking the cut.
fn cut(s: &str, n: usize) -> String {
    if s.chars().count() <= n {
        s.to_string()
    } else {
        format!("{}\u{2026}", s.chars().take(n - 1).collect::<String>())
    }
}

impl Mail {
    /// ORCH-006: the answer goes to whoever sent `id`, on the thread of the message it answers.
    /// ORCH-033: only a message the caller could read (in its mailboxes, its Run, or its own) can be
    /// answered; any other reads as missing.
    #[allow(clippy::too_many_arguments)]
    pub fn reply(&mut self, from: &str, id: &str, body: &str, run: Option<&str>, boxes: &[String], mine: Option<&str>, now: u64) -> Result<Value, Fail> {
        let seen = |m: &Message| boxes.contains(&m.to) || m.from == from || (m.run.is_some() && m.run.as_deref() == mine);
        let m = self.messages.iter().find(|m| m.id == id && seen(m)).cloned().ok_or_else(|| Fail::new("not_found", format!("no message {id}")))?;
        if let Some(n) = run.filter(|n| m.run.as_deref() != Some(*n)) {
            return Err(Fail::new("run_mismatch", format!("{id} does not belong to the Run named with --run ({n})")));
        }
        let thread = m.extras.get("threadId").and_then(Value::as_str).unwrap_or(&m.id).to_string();
        let to = format!("term:{}", m.from);
        let subject = if m.subject.starts_with("Re: ") { m.subject.clone() } else { format!("Re: {}", m.subject) };
        let mut extras = Map::new();
        extras.insert("threadId".into(), json!(thread));
        extras.insert("inReplyTo".into(), json!(m.id));
        let new = self.next("msg");
        self.messages.push(Message { id: new.clone(), to: to.clone(), run: m.run.clone(), from: from.to_string(), subject, body: body.to_string(), kind: "status".into(), priority: "normal".into(), extras, at: now });
        Ok(json!({ "messageIds": [new], "to": to, "runId": m.run, "threadId": thread }))
    }

    /// ORCH-028: a gate on a task of Run `run`, which turns the task blocked. Choices are a JSON
    /// list of strings; a task with a supervised worker still at work, or one that has finished,
    /// cannot be held, and then nothing is made.
    pub fn gate_create(&mut self, run: Option<&str>, tasks: &mut [Value], dispatches: &[Value], a: &Value, now: u64) -> Result<Value, Fail> {
        let text = |k: &str| a[k].as_str().map(str::trim).filter(|s| !s.is_empty()).map(str::to_string);
        let task = text("task").ok_or_else(|| args("--task is required"))?;
        let question = text("question").ok_or_else(|| args("--question is required: say what needs deciding"))?;
        let options = match text("options") {
            Some(o) => parse_deps(&o).ok_or_else(|| args("--options takes a JSON list of strings, like [\"yes\",\"no\"]"))?,
            None => Vec::new(),
        };
        // CLI-037: a gate is the coordinator's, so it needs the Run this terminal is attached to.
        if run.is_none() {
            return Err(Fail::new("no_run", "no Run is attached to this terminal, so there is no coordinator to hold the gate: attach one with orchestration run-create --objective <text> or run-use --id <run>, or name it with --run"));
        }
        let i = task_in(tasks, &task, run)?;
        if let Some(d) = dispatches.iter().find(|d| d["taskId"] == task.as_str() && !finished(d)) {
            let id = d["id"].as_str().unwrap_or_default();
            return Err(Fail::new("worker_active", format!("{task} has a supervised worker at work ({id}); a gate cannot hold it until that worker finishes or is abandoned")));
        }
        let was = status(&tasks[i]).to_string();
        if !["pending", "ready", "blocked"].contains(&was.as_str()) {
            return Err(Fail::new("invalid_state", format!("{task} is {was}; only a pending or ready task can be held by a gate")));
        }
        tasks[i]["status"] = json!("blocked");
        let g = Gate { id: self.next("gate"), run: run.map(str::to_string), task, question, options, status: "pending".into(), resolution: None, created: now, resolved: None };
        let mut v = json!(g);
        v["taskStatus"] = json!("blocked");
        self.gates.push(g);
        Ok(v)
    }

    /// ORCH-028: settles an open gate of Run `run`; a gate of another Run reads as missing. Once no
    /// open gate holds the task any more it goes back to pending, and so on to ready when nothing
    /// else holds it.
    pub fn gate_resolve(&mut self, run: Option<&str>, tasks: &mut [Value], a: &Value, now: u64) -> Result<Value, Fail> {
        let text = |k: &str| a[k].as_str().map(str::trim).filter(|s| !s.is_empty()).map(str::to_string);
        let id = text("id").ok_or_else(|| args("--id is required"))?;
        let resolution = text("resolution").ok_or_else(|| args("--resolution is required: say what was decided"))?;
        let g = self.gates.iter_mut().find(|g| g.id == id && g.run.as_deref() == run).ok_or_else(|| Fail::new("not_found", format!("no gate {id}")))?;
        if g.status != "pending" {
            return Err(Fail::new("gate_closed", format!("{id} is already {}", g.status)));
        }
        g.status = "resolved".into();
        g.resolution = Some(resolution);
        g.resolved = Some(now);
        let mut v = json!(g);
        let task = g.task.clone();
        if !self.gates.iter().any(|g| g.task == task && g.run.as_deref() == run && g.status == "pending") {
            if let Some(t) = tasks.iter_mut().find(|t| t["id"] == task.as_str() && t["runId"].as_str() == run && status(t) == "blocked") {
                t["status"] = json!("pending");
            }
            promote(tasks);
        }
        v["taskStatus"] = tasks.iter().find(|t| t["id"] == task.as_str() && t["runId"].as_str() == run).map(|t| t["status"].clone()).unwrap_or(Value::Null);
        Ok(v)
    }

    /// ORCH-028: the gates of Run `run`, oldest first, narrowed by task and state.
    // ponytail: no gate times out yet (gate-create takes no deadline), so "timeout" lists nothing
    // until one does.
    pub fn gate_list(&self, run: Option<&str>, a: &Value) -> Result<Value, Fail> {
        let text = |k: &str| a[k].as_str().map(str::trim).filter(|s| !s.is_empty());
        let want = text("status");
        if want.is_some_and(|s| !["pending", "resolved", "timeout"].contains(&s)) {
            return Err(args("--status takes pending, resolved or timeout"));
        }
        let gates: Vec<Value> = self.gates.iter().filter(|g| g.run.as_deref() == run && want.is_none_or(|s| g.status == s) && text("task").is_none_or(|t| g.task == t)).map(|g| json!(g)).collect();
        Ok(json!({ "runId": run, "gates": gates }))
    }

    /// ORCH-029: a question to one recipient (by default the caller's Run), or, with `resume`, the
    /// state of one this terminal already asked: still open, or answered by the first reply to it.
    /// A group address is refused and nothing is made.
    pub fn ask(&mut self, from: &str, a: &Value, dispatches: &[Value], peers: &[Peer], now: u64) -> Result<Value, Fail> {
        let text = |k: &str| a[k].as_str().map(str::trim).filter(|s| !s.is_empty()).map(str::to_string);
        let id = match (text("question"), text("resume")) {
            (Some(_), Some(_)) => return Err(args("give --question or --resume, not both")),
            (None, None) => return Err(args("--question is required (or --resume <message> to wait on one already asked)")),
            (Some(q), None) => {
                let options: Vec<String> = text("options").map(|o| o.split(',').map(|s| s.trim().to_string()).filter(|s| !s.is_empty()).collect()).unwrap_or_default();
                let to = text("to").or_else(|| self.run_of(from, dispatches).map(|r| format!("run:{r}")));
                let mut q = json!({ "to": to, "run": a["run"], "subject": q, "type": "question" });
                if !options.is_empty() {
                    q["payload"] = json!(json!({ "options": options }).to_string());
                }
                let r = self.post(from, &q, dispatches, peers, now)?;
                return Ok(json!({ "status": "open", "messageId": r["messageIds"][0], "to": r["to"], "runId": r["runId"], "options": options }));
            }
            (None, Some(id)) if text("options").is_some() => return Err(args(format!("--options goes with --question; {id} keeps the choices it was asked with"))),
            (None, Some(id)) => id,
        };
        let q = self.messages.iter().find(|m| m.id == id && m.from == from && m.kind == "question").ok_or_else(|| Fail::new("not_found", format!("no question {id} was asked from this terminal")))?;
        Ok(match self.messages.iter().find(|m| m.extras.get("inReplyTo").and_then(Value::as_str) == Some(id.as_str())) {
            Some(r) => json!({ "status": "answered", "messageId": id, "answer": r.body, "answeredBy": r.from, "answerId": r.id }),
            None => json!({ "status": "open", "messageId": id, "to": q.to, "runId": q.run }),
        })
    }

    /// ORCH-031: clears one scope. "tasks" drops the gates (the caller drops tasks and workers),
    /// "messages" the mail but not the delivery positions, so nothing is handed out again; "all"
    /// everything. Ids keep counting up, so nothing cleared is ever named again.
    pub fn reset(&mut self, scope: &str) -> Result<(), Fail> {
        match scope {
            "tasks" => self.gates.clear(),
            "messages" => self.messages.clear(),
            "all" => *self = Mail { seq: self.seq, ..Mail::default() },
            _ => return Err(args("give exactly one of --all, --tasks or --messages")),
        }
        Ok(())
    }

    /// ORCH-006: the newest mail in `boxes`, newest first, bodies cut unless `full`; it only reads.
    pub fn inbox(&self, reader: &str, boxes: &[String], limit: usize, full: bool) -> Value {
        let shown: Vec<Value> = self
            .messages
            .iter()
            .rev()
            .filter(|m| boxes.contains(&m.to))
            .take(limit)
            .map(|m| {
                let mut v = Self::view(m);
                if !full {
                    v["body"] = json!(cut(&m.body, SHORT_BODY));
                }
                v
            })
            .collect();
        json!({ "terminal": reader, "mailboxes": boxes, "messages": shown, "full": full })
    }
}

// ---------------------------------------------------------------- tasks (ORCH-010, ORCH-011, ORCH-013)

fn status(t: &Value) -> &str {
    t["status"].as_str().unwrap_or_default()
}

/// ORCH-010: every pending task whose dependencies have all completed turns ready.
pub fn promote(tasks: &mut [Value]) {
    let done: std::collections::HashSet<String> = tasks.iter().filter(|t| status(t) == "completed").filter_map(|t| t["id"].as_str().map(str::to_string)).collect();
    for t in tasks.iter_mut() {
        let free = t["deps"].as_array().into_iter().flatten().all(|d| d.as_str().is_some_and(|d| done.contains(d)));
        if status(t) == "pending" && free {
            t["status"] = json!("ready");
        }
    }
}

/// ORCH-010: a new task in `run`; ready at once unless it waits on unfinished tasks. Bad or
/// unknown dependencies, an unknown parent and an oversized text are refused with nothing made.
/// A list of task ids, as JSON or as PowerShell leaves it with the quotes stripped (`[a, b]`).
pub fn parse_deps(s: &str) -> Option<Vec<String>> {
    if let Ok(v) = serde_json::from_str::<Vec<String>>(s) {
        return Some(v);
    }
    let inner = s.trim().strip_prefix('[')?.strip_suffix(']')?;
    Some(inner.split(',').map(|d| d.trim().trim_matches('"').to_string()).filter(|d| !d.is_empty()).collect())
}


pub fn task_create(tasks: &mut Vec<Value>, a: &Value, run: Option<String>, now: u64) -> Result<Value, Fail> {
    let text = |k: &str| a[k].as_str().map(str::trim).filter(|s| !s.is_empty()).map(str::to_string);
    let spec = a["spec"].as_str().filter(|s| !s.trim().is_empty()).ok_or_else(|| args("--spec is required"))?;
    if spec.len() > SPEC_MAX {
        return Err(Fail::new("too_large", format!("the task text is {} bytes; Kolux stores at most {SPEC_MAX}", spec.len())));
    }
    let deps: Vec<String> = match text("deps") {
        None => Vec::new(),
        Some(d) => parse_deps(&d).ok_or_else(|| args("--deps takes a JSON list of task ids, like [\"task-1\"]"))?,
    };
    let known = |id: &str| tasks.iter().any(|t| t["id"] == id);
    if let Some(bad) = deps.iter().find(|d| !known(d)) {
        return Err(Fail::new("not_found", format!("no task {bad} to wait on")));
    }
    if let Some(p) = text("parent").filter(|p| !known(p)) {
        return Err(Fail::new("not_found", format!("no parent task {p}")));
    }
    let id = crate::cli::next_id(tasks, "task-");
    tasks.push(json!({ "id": id, "runId": run, "title": text("taskTitle"), "displayName": text("displayName"), "spec": spec, "status": "pending", "deps": deps, "parent": text("parent"), "created": now }));
    promote(tasks);
    Ok(tasks.last().cloned().unwrap_or_default())
}

/// ORCH-011: the tasks of `run` (or of no Run), filtered, with the worker holding each one while
/// that worker's terminal is still open.
pub fn task_list(tasks: &[Value], dispatches: &[Value], run: Option<&str>, a: &Value, live: &dyn Fn(&str) -> bool) -> Result<Value, Fail> {
    let want = a["status"].as_str();
    if want.is_some_and(|s| !TASK_STATES.contains(&s)) {
        return Err(args(format!("--status takes one of {}", TASK_STATES.join(", "))));
    }
    let (ready, brief) = (a["ready"] == true, a["brief"] == true);
    let rows: Vec<Value> = tasks
        .iter()
        .filter(|t| t["runId"].as_str() == run && want.is_none_or(|s| status(t) == s) && (!ready || status(t) == "ready"))
        .map(|t| {
            let spec = t["spec"].as_str().unwrap_or_default();
            let folded = spec.split_whitespace().collect::<Vec<_>>().join(" ");
            let name = t["displayName"].as_str().or(t["title"].as_str()).map(str::to_string).unwrap_or_else(|| cut(&folded, 60));
            let holder = dispatches.iter().rev().find(|d| d["taskId"] == t["id"] && !finished(d) && terminal_of(d).is_some_and(|h| live(&h)));
            json!({
                "id": t["id"], "name": name, "title": t["title"], "status": t["status"], "deps": t["deps"], "parent": t["parent"], "runId": t["runId"],
                "spec": if brief { cut(&folded, BRIEF_CHARS) } else { spec.to_string() },
                "worker": holder.map(|d| json!({ "dispatchId": d["id"], "terminal": terminal_of(d) })),
            })
        })
        .collect();
    Ok(json!({ "runId": run, "tasks": rows, "brief": brief }))
}

/// ORCH-013: may `task` go to the agent in terminal `to`? Gives the task index and the agent.
/// The codes and messages are fixed so scripts can match on them.
/// The task is looked up in `run` only (ORCH-033). A context-only dispatch to the caller's own pane
/// is allowed when `own_ok`: the caller still has nesting budget (ORCH-032).
#[allow(clippy::too_many_arguments)]
pub fn dispatch_check(tasks: &[Value], dispatches: &[Value], task: &str, to: &str, caller: Option<&str>, run: Option<&str>, own_ok: bool, agent_of: &dyn Fn(&str) -> Option<String>) -> Result<(usize, String), Fail> {
    let i = task_in(tasks, task, run)?;
    match status(&tasks[i]) {
        "ready" => {}
        "pending" => return Err(Fail::new("task_waiting", format!("{task} is still waiting on its dependencies"))),
        "dispatched" => return Err(Fail::new("task_taken", format!("{task} already has a worker ({})", tasks[i]["dispatchId"].as_str().unwrap_or("?")))),
        s => return Err(Fail::new("task_not_ready", format!("{task} is {s}, not ready"))),
    }
    if caller == Some(to) && !own_ok {
        return Err(Fail::new("own_pane", "a coordinator cannot hand a task to its own pane"));
    }
    let agent = agent_of(to).ok_or_else(|| Fail::new("not_an_agent", format!("{to} is not running an agent Kolux recognises, or the agent has not finished starting")))?;
    if let Some(d) = dispatches.iter().find(|d| !finished(d) && terminal_of(d).as_deref() == Some(to)) {
        return Err(Fail::new("busy", format!("{to} is already working on {}", d["id"].as_str().unwrap_or("?"))));
    }
    Ok((i, agent))
}

/// The command name a brief tells workers to run (ORCH-014).
// ponytail: WSL workers, who need the exact path instead, do not exist yet (SESS-048 is not in
// the plan); the name is the plain one until they do.
pub const CLI: &str = if cfg!(debug_assertions) { "kolux-dev" } else { "kolux" };
/// Everything after this line in a brief is the task text.
pub const DIVIDER: &str = "---------------- task ----------------";

/// What a worker's brief is tied to (ORCH-014).
pub struct Brief<'a> {
    pub dispatch: &'a str,
    pub run: Option<&'a str>,
    /// Where reports go when there is no Run: the coordinator's pane.
    pub coordinator: Option<&'a str>,
    /// Commits the worktree is behind its base, and the base's name.
    pub behind: Option<(u32, String)>,
    /// ORCH-032: how many more levels of workers this worker may start (0: none).
    pub levels_left: u32,
}

/// ORCH-014: the text a worker gets: how to report done, beat, ask and look for mail, each a
/// one-line command that runs in any shell, then the task text last. The commands need no
/// `--from`: run in the worker's pane, its KOLUX_TERMINAL_HANDLE ties them to that pane.
// ponytail: questions go out as mail plus `check --wait` until the ask command lands (ORCH-029,
// T-190); the dispatch pass joins these commands with ORCH-067 (T-155-b). Every worker
// is an agent: dispatch turns shells away and a reused terminal must run the coordinator's own
// agent (ORCH-016), so the bare-shell "exit after reporting" line has no worker to go to.
pub fn brief(task: &Value, b: &Brief) -> String {
    let id = task["id"].as_str().unwrap_or_default();
    let to = b.run.map(|r| format!(" --to run:{r}")).or_else(|| b.coordinator.map(|c| format!(" --to {c}"))).unwrap_or_default();
    let tie = format!("{to} --task-id {id} --dispatch-id {}", b.dispatch);
    let send = |kind: &str, subject: &str, body: &str| format!("  {CLI} orchestration send --type {kind} --subject \"{id} {subject}\" --body \"{body}\"{tie}\n");
    let run = b.run.map(|r| format!(", Run {r}")).unwrap_or_default();
    let mut s = format!("Kolux task {id} ({}{run}). You are a Kolux worker; a coordinator handed you this task.\n\n", b.dispatch);
    s += "When you finish, report it with one of these, then stop and wait at your prompt:\n";
    s += &send("worker_done --outcome succeeded", "done", "what you did");
    s += &send("worker_done --outcome failed", "failed", "what went wrong");
    s += "About every five minutes while you work, send a heartbeat:\n";
    s += &send("heartbeat", "working", "what you are doing now");
    s += "To ask the coordinator something, use Kolux, not your own question tool, then wait for the answer:\n";
    s += &send("question", "question", "your question");
    s += &format!("  {CLI} orchestration check --wait\n");
    s += &format!("Look for new mail between steps, at least every few minutes:\n  {CLI} orchestration check\n");
    if b.levels_left > 0 {
        let more = if b.levels_left == 1 { "one more level".to_string() } else { format!("{} more levels", b.levels_left) };
        s += &format!("\nYou may hand a separate part of this task to a sub-worker ({more} allowed below you); it reports to you:\n  {CLI} orchestration worker-start --spec \"<that part>\" --tier build --worktree new-child\n");
    }
    if let Some((n, base)) = b.behind.as_ref().filter(|(n, _)| *n > 0) {
        let commits = if *n == 1 { "commit" } else { "commits" };
        s += &format!("\nBase drift: this worktree is {n} {commits} behind {base}. Bring {base} in before you build on it, or say in your report why you did not.\n");
    }
    format!("{s}\n{DIVIDER}\n{}", task["spec"].as_str().unwrap_or_default())
}

/// ORCH-018: the agent a tier runs on: the coordinator's own when Kolux knows it, else the one
/// named, else the default. Naming another agent than the coordinator's is turned away.
pub fn tier_agent(named: Option<&str>, coordinator: Option<&str>, default: &str) -> Result<String, Fail> {
    match (named, coordinator) {
        (Some(n), Some(c)) if n != c => Err(args(format!("a tier runs on the coordinator's own agent ({c}); drop --agent {n}, or name a model instead of a tier"))),
        (Some(n), _) => Ok(n.to_string()),
        (None, Some(c)) => Ok(c.to_string()),
        (None, None) => Ok(default.to_string()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn live(h: &str) -> bool {
        h.starts_with("term-")
    }

    fn ids(v: &Value) -> Vec<String> {
        v["messages"].as_array().unwrap().iter().map(|m| m["id"].as_str().unwrap().to_string()).collect()
    }

    /// ORCH-034: the store (state.db and the companion files SQLite adds beside it) opens to the
    /// current user alone, the way the app folder is set at every launch.
    #[cfg(windows)]
    #[test]
    fn the_orchestration_store_opens_to_the_current_user_only() {
        let dir = std::env::temp_dir().join(format!("kolux-rs-orch-private-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let store = crate::state::Store::open(&dir).unwrap();
        crate::secrets::restrict_to_user(&dir, &dir);
        let mut m = Mail::default();
        m.begin("orchestration.worker-start||r1", 1).unwrap();
        m.save(&store).unwrap();
        let user = std::env::var("USERNAME").unwrap().to_lowercase();
        let files: Vec<_> = std::fs::read_dir(&dir).unwrap().flatten().map(|e| e.path()).filter(|p| p.to_string_lossy().contains("state.db")).collect();
        assert!(!files.is_empty());
        for path in std::iter::once(dir.clone()).chain(files) {
            let out = std::process::Command::new("icacls").arg(&path).output().unwrap();
            let text = String::from_utf8_lossy(&out.stdout).replace(&path.to_string_lossy().to_string(), "").to_lowercase();
            let aces: Vec<&str> = text.lines().map(str::trim).filter(|l| l.contains(":(")).collect();
            assert!(!aces.is_empty() && aces.iter().all(|a| a.contains(&format!("\\{user}:"))), "{} is open to more than {user}: {aces:?}", path.display());
        }
        drop(store);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_pane_is_tied_only_when_the_runtime_knows_it() {
        let by_key = |k: &str| (k == "s3cret").then(|| "term-1".to_string());
        assert_eq!(caller_of(None, Some(("term-1", "s3cret")), &by_key).unwrap().as_deref(), Some("term-1"));
        // CLI-034: a stale handle is worked out again from the pane key.
        assert_eq!(caller_of(None, Some(("term-5", "s3cret")), &by_key).unwrap().as_deref(), Some("term-1"));
        assert_eq!(caller_of(None, Some(("term-1", "guess")), &by_key).unwrap(), None);
        assert_eq!(caller_of(None, None, &by_key).unwrap(), None);
        // CLI-039: --from may name the calling terminal itself, never another one, and never
        // from a shell whose identity cannot be proven.
        assert_eq!(caller_of(Some("term-1"), Some(("term-1", "s3cret")), &by_key).unwrap().as_deref(), Some("term-1"));
        let other = caller_of(Some("term-4"), Some(("term-1", "s3cret")), &by_key).unwrap_err();
        assert_eq!(other.code, "caller_mismatch");
        assert!(other.message.contains("term-1") && other.message.contains("term-4"), "{}", other.message);
        assert_eq!(caller_of(Some("term-4"), None, &by_key).unwrap_err().code, "unbound_caller");
        assert_eq!(caller_of(Some("term-1"), Some(("term-1", "guess")), &by_key).unwrap_err().code, "unbound_caller");
    }

    #[test]
    fn a_run_binds_its_pane_and_a_retry_hands_back_the_first_answer() {
        let mut m = Mail::default();
        let first = m.once(Some("k1".into()), |m| Ok(m.run_create("term-1", "ship it", 5))).unwrap();
        let again = m.once(Some("k1".into()), |m| Ok(m.run_create("term-1", "ship it", 6))).unwrap();
        assert_eq!(first, again);
        assert_eq!(m.runs.len(), 1);
        let id = first["run"]["id"].as_str().unwrap();
        assert_eq!(m.run_current("term-1")["runId"], id);
        assert_eq!(m.run_current("term-2")["runId"], Value::Null);
        assert_eq!(first["binding"]["terminal"], "term-1");
    }

    #[test]
    fn receipts_answer_retries_say_how_a_request_went_and_expire() {
        let mut m = Mail::default();
        let key = |c: &str, id: &str| Some(format!("{c}|term-1|{id}"));
        let first = m.once(key("orchestration.run-create", "r1"), |m| Ok(m.run_create("term-1", "ship it", 5))).unwrap();
        let shown = m.request_show("term-1", "r1", 7);
        assert_eq!((shown["state"].as_str(), shown["command"].as_str()), (Some("completed"), Some("orchestration.run-create")));
        assert_eq!(shown["result"], first);
        assert_eq!(m.request_show("term-1", "nope", 7)["state"], "absent");
        assert_eq!(m.request_show("term-2", "r1", 7)["state"], "absent", "another terminal's request is not this one's");

        // Turned away before it took effect: no receipt, so the same id runs fresh.
        assert!(m.once(key("orchestration.send", "r2"), |_| Err(args("no such task"))).is_err());
        assert_eq!(m.request_show("term-1", "r2", 7)["state"], "absent");
        assert!(m.once(key("orchestration.send", "r2"), |_| Ok(json!({ "ok": true }))).is_ok());

        // A long request is pending until it finishes; one left by an earlier start says so.
        let w = key("orchestration.worker-start", "w1").unwrap();
        m.begin(&w, 7).unwrap();
        assert_eq!(m.request_show("term-1", "w1", 7)["state"], "pending");
        assert_eq!(m.request_show("term-1", "w1", 8)["interrupted"], true);
        m.finish(&w, Some(json!({ "dispatchId": "dispatch-1" })));
        assert_eq!(m.request_show("term-1", "w1", 7)["result"]["dispatchId"], "dispatch-1");

        // A full ledger of unfinished requests turns new changes away rather than losing track.
        for n in 0..MAX_PENDING {
            m.begin(&format!("orchestration.worker-start|term-1|p{n}"), 7).unwrap();
        }
        assert_eq!(m.once(key("orchestration.send", "r3"), |_| Ok(json!({}))).unwrap_err().code, "busy");
        assert_eq!(m.begin("orchestration.worker-start|term-1|one-more", 7).unwrap_err().code, "busy");
        assert_eq!(m.request_show("term-1", "r3", 7)["state"], "absent");
        for n in 0..MAX_PENDING {
            m.finish(&format!("orchestration.worker-start|term-1|p{n}"), None);
        }

        // Old finished receipts are pruned when the next one is written.
        m.stamps.insert(key("orchestration.run-create", "r1").unwrap(), 1);
        m.once(key("orchestration.send", "r4"), |_| Ok(json!({}))).unwrap();
        assert_eq!(m.request_show("term-1", "r1", 7)["state"], "absent");
        assert_eq!(m.request_show("term-1", "r4", 7)["state"], "completed");
    }

    #[test]
    fn runs_switch_page_newest_first_and_show() {
        let mut m = Mail::default();
        let a = m.run_create("term-1", "one", 1)["run"]["id"].as_str().unwrap().to_string();
        let b = m.run_create("term-1", "two", 2)["run"]["id"].as_str().unwrap().to_string();
        assert_eq!(m.bound("term-1"), Some(b.as_str()));
        m.run_use("term-1", &a).unwrap();
        assert_eq!(m.run_current("term-1")["runId"], a);
        assert_eq!(m.run_use("term-1", "run-99").unwrap_err().code, "not_found");
        let page = m.run_list(1, None).unwrap();
        assert_eq!(page["runs"][0]["id"], b);
        let next = m.run_list(1, page["nextCursor"].as_str()).unwrap();
        assert_eq!(next["runs"][0]["id"], a);
        assert_eq!(next["nextCursor"], Value::Null);
        assert!(m.run_list(1, Some("x")).is_err());
        assert_eq!(m.run_show(&a).unwrap()["objective"], "one");
    }

    #[test]
    fn check_repeats_the_oldest_batch_until_it_is_acknowledged() {
        let mut m = Mail::default();
        let run = m.run_create("term-1", "o", 1)["run"]["id"].as_str().unwrap().to_string();
        let to = format!("run:{run}");
        let s1 = m.send("term-2", &json!({ "to": to, "subject": "first" }), &[], &live, 2).unwrap();
        m.send("term-2", &json!({ "to": to, "subject": "second", "priority": "urgent" }), &[], &live, 3).unwrap();
        assert_eq!(s1["messageIds"].as_array().unwrap().len(), 1);
        let boxes = m.boxes_of("term-1", &[]);
        let peek = m.check("term-1", "term-1", &boxes, Mode::Peek, None, None, None).unwrap();
        assert_eq!(peek["deliveryId"], Value::Null);
        assert_eq!(ids(&peek).len(), 2);
        assert!(m.deliveries.is_empty());
        let one = m.check("term-1", "term-1", &boxes, Mode::Next, None, None, None).unwrap();
        assert_eq!(ids(&one).len(), 2);
        assert_eq!(one["messages"][0]["subject"], "first");
        let two = m.check("term-1", "term-1", &boxes, Mode::Next, None, None, None).unwrap();
        assert_eq!(one["deliveryId"], two["deliveryId"]);
        assert_eq!(ids(&one), ids(&two));
        m.send("term-2", &json!({ "to": to, "subject": "third", "type": "question" }), &[], &live, 4).unwrap();
        let d = one["deliveryId"].as_str().unwrap().to_string();
        let after = m.check("term-1", "term-1", &boxes, Mode::Next, Some(&["status".to_string()]), Some(&d), None).unwrap();
        assert!(ids(&after).is_empty());
        assert_eq!(ids(&m.check("term-1", "term-1", &boxes, Mode::Unread, None, None, None).unwrap()).len(), 1);
        assert_eq!(ids(&m.check("term-1", "term-1", &boxes, Mode::All, None, None, None).unwrap()).len(), 3);
        assert_eq!(m.check("term-1", "term-1", &boxes, Mode::Next, None, Some("dlv-99"), None).unwrap_err().code, "not_found");
    }

    #[test]
    fn a_waiter_is_fenced_when_its_pane_is_tied_elsewhere() {
        let mut m = Mail::default();
        let before = m.epoch("term-1");
        m.run_create("term-1", "o", 1);
        let boxes = m.boxes_of("term-1", &[]);
        assert_eq!(m.check("term-1", "term-1", &boxes, Mode::Next, None, None, Some(before)).unwrap_err().code, "fenced");
        let now = m.epoch("term-1");
        assert!(m.check("term-1", "term-1", &boxes, Mode::Next, None, None, Some(now)).is_ok());
    }

    #[test]
    fn send_refuses_what_it_cannot_route() {
        let mut m = Mail::default();
        let run = m.run_create("term-1", "o", 1)["run"]["id"].as_str().unwrap().to_string();
        let refused = |m: &mut Mail, a: Value| m.send("term-2", &a, &[], &live, 2).unwrap_err();
        assert!(refused(&mut m, json!({ "to": format!("run:{run}"), "subject": "done", "type": "worker_done" })).message.contains("--outcome"));
        assert!(refused(&mut m, json!({ "to": "@all", "subject": "beat", "type": "heartbeat" })).message.contains("group"));
        assert_eq!(refused(&mut m, json!({ "to": "run:run-9", "subject": "hi" })).code, "not_found");
        assert_eq!(refused(&mut m, json!({ "subject": "hi" })).code, "invalid_arguments");
        assert_eq!(refused(&mut m, json!({ "to": format!("run:{run}"), "subject": "hi", "type": "gossip" })).code, "invalid_arguments");
        assert_eq!(refused(&mut m, json!({ "to": format!("run:{run}"), "subject": "hi", "payload": "{nope" })).code, "invalid_arguments");
        assert!(m.messages.is_empty());
        let d = vec![json!({ "id": "dispatch-1", "status": "completed", "runId": run, "terminal": 7 }), json!({ "id": "dispatch-2", "status": "ready", "runId": run, "terminal": 8 })];
        let gone = m.send("term-2", &json!({ "to": "dispatch:dispatch-1", "subject": "hi" }), &d, &live, 2).unwrap_err();
        assert_eq!(gone.code, "dispatch_finished");
        assert!(gone.message.contains(&format!("run:{run}")));
        let other = m.run_create("term-3", "p", 3)["run"]["id"].as_str().unwrap().to_string();
        let mismatch = m.send("term-2", &json!({ "to": "dispatch:dispatch-2", "run": other, "subject": "hi" }), &d, &live, 2).unwrap_err();
        assert_eq!(mismatch.code, "run_mismatch");
        assert!(m.messages.is_empty());
        // A worker inside an active dispatch that names no one writes to its Run.
        let r = m.send("term-8", &json!({ "subject": "progress", "type": "heartbeat" }), &d, &live, 4).unwrap();
        assert_eq!(r["to"], format!("run:{run}"));
        assert_eq!(m.boxes_of("term-8", &d), vec!["term:term-8".to_string(), "dispatch:dispatch-2".to_string()]);
        let ok = m.send("term-2", &json!({ "to": "term-8", "subject": "hi", "filesModified": "a.rs, b.rs", "outcome": "succeeded", "type": "worker_done" }), &d, &live, 5).unwrap();
        assert_eq!(ok["to"], "term:term-8");
        assert_eq!(m.messages.last().unwrap().extras["filesModified"], json!(["a.rs", "b.rs"]));
    }

    #[test]
    fn a_reply_goes_back_on_the_thread_and_inbox_only_reads() {
        let mut m = Mail::default();
        m.run_create("term-1", "o", 1);
        let sent = m.send("term-1", &json!({ "to": "term-8", "subject": "go", "body": "start" }), &[], &live, 2).unwrap();
        let id = sent["messageIds"][0].as_str().unwrap().to_string();
        let boxes8 = m.boxes_of("term-8", &[]);
        let got = m.check("term-8", "term-8", &boxes8, Mode::Next, None, None, None).unwrap();
        assert_eq!(got["messages"][0]["reply"], format!("{CLI} orchestration reply --id {id} --body \"<your answer>\""));
        let r = m.reply("term-8", &id, "on it", None, &boxes8, None, 3).unwrap();
        assert_eq!(r["to"], "term:term-1");
        let boxes1 = m.boxes_of("term-1", &[]);
        let back = m.check("term-1", "term-1", &boxes1, Mode::Next, None, None, None).unwrap();
        assert_eq!(back["messages"][0]["threadId"], id.as_str());
        assert_eq!(back["messages"][0]["subject"], "Re: go");
        assert_eq!(back["messages"][0]["body"], "on it");
        assert_eq!(m.reply("term-8", "msg-99", "x", None, &boxes8, None, 4).unwrap_err().code, "not_found");
        assert_eq!(m.reply("term-8", &id, "x", Some("run-9"), &boxes8, None, 4).unwrap_err().code, "run_mismatch");
        for i in 0..7 {
            m.send("term-1", &json!({ "to": "term-8", "subject": format!("n{i}"), "body": "x".repeat(300) }), &[], &live, 10 + i).unwrap();
        }
        let before = m.deliveries.clone();
        let five = m.inbox("term-8", &boxes8, 5, false);
        assert_eq!(five["messages"].as_array().unwrap().len(), 5);
        assert_eq!(five["messages"][0]["subject"], "n6");
        assert!(five["messages"][0]["body"].as_str().unwrap().chars().count() <= 120);
        assert_eq!(m.inbox("term-8", &boxes8, 5, true)["messages"][0]["body"].as_str().unwrap().len(), 300);
        assert_eq!(m.deliveries, before);
    }

    #[test]
    fn tasks_wait_on_their_dependencies_and_list_per_run() {
        let mut tasks = Vec::new();
        let a = task_create(&mut tasks, &json!({ "spec": "build a" }), Some("run-1".into()), 1).unwrap();
        let aid = a["id"].as_str().unwrap().to_string();
        assert_eq!(a["status"], "ready");
        let b = task_create(&mut tasks, &json!({ "spec": "b", "deps": format!("[\"{aid}\"]") }), Some("run-1".into()), 2).unwrap();
        assert_eq!(b["status"], "pending");
        // CLI-034: PowerShell strips the quotes out of a JSON list; the ids still arrive.
        assert_eq!(parse_deps(&format!("[{aid}, task-9]")), Some(vec![aid.clone(), "task-9".to_string()]));
        assert_eq!(parse_deps("[]"), Some(vec![]));
        assert_eq!(parse_deps("task-1"), None);
        assert_eq!(task_create(&mut tasks, &json!({ "spec": "x", "deps": "[\"missing\"]" }), None, 3).unwrap_err().code, "not_found");
        assert_eq!(task_create(&mut tasks, &json!({ "spec": "x", "deps": "nope" }), None, 3).unwrap_err().code, "invalid_arguments");
        assert_eq!(task_create(&mut tasks, &json!({ "spec": "x".repeat(SPEC_MAX + 1) }), None, 3).unwrap_err().code, "too_large");
        assert_eq!(tasks.len(), 2);
        tasks[0]["status"] = json!("completed");
        promote(&mut tasks);
        assert_eq!(tasks[1]["status"], "ready");
        let long = format!("word  {}\n\tend", "y ".repeat(1000));
        task_create(&mut tasks, &json!({ "spec": long, "displayName": "Long one" }), Some("run-1".into()), 4).unwrap();
        task_create(&mut tasks, &json!({ "spec": "elsewhere" }), Some("run-2".into()), 5).unwrap();
        let none = |_: &str| false;
        let all = task_list(&tasks, &[], Some("run-1"), &json!({ "brief": true }), &none).unwrap();
        let rows = all["tasks"].as_array().unwrap();
        assert_eq!(rows.len(), 3);
        let compact = rows[2]["spec"].as_str().unwrap();
        assert!(compact.chars().count() <= 160 && compact.chars().count() > 150, "{compact}");
        assert!(!compact.contains('\n') && !compact.contains("  "));
        assert_eq!(rows[2]["name"], "Long one");
        assert_eq!(rows[1]["name"], "b");
        let ready = task_list(&tasks, &[], Some("run-1"), &json!({ "ready": true }), &none).unwrap();
        assert_eq!(ready["tasks"].as_array().unwrap().len(), 2);
        assert!(task_list(&tasks, &[], None, &json!({ "status": "odd" }), &none).is_err());
        let d = vec![json!({ "id": "dispatch-1", "taskId": "task-2", "status": "running", "terminal": 8 })];
        let held = task_list(&tasks, &d, Some("run-1"), &json!({}), &live).unwrap();
        assert_eq!(held["tasks"][1]["worker"]["terminal"], "term-8");
        assert_eq!(held["tasks"][1]["worker"]["dispatchId"], "dispatch-1");
        let gone = task_list(&tasks, &d, Some("run-1"), &json!({}), &none).unwrap();
        assert_eq!(gone["tasks"][1]["worker"], Value::Null);
        let before_restart = vec![json!({ "id": "dispatch-1", "taskId": "task-2", "status": "running", "terminal": 8, "runtime": u64::from(std::process::id()) + 1 })];
        assert_eq!(task_list(&tasks, &before_restart, Some("run-1"), &json!({}), &live).unwrap()["tasks"][1]["worker"], Value::Null);
    }

    #[test]
    fn dispatch_turns_away_what_it_must() {
        let mut tasks = Vec::new();
        task_create(&mut tasks, &json!({ "spec": "a" }), None, 1).unwrap();
        task_create(&mut tasks, &json!({ "spec": "b", "deps": "[\"task-1\"]" }), None, 2).unwrap();
        let agent = |h: &str| (h == "term-5" || h == "term-6").then(|| "claude".to_string());
        let d = vec![json!({ "id": "dispatch-1", "taskId": "task-9", "status": "running", "terminal": 6 })];
        let code = |t: &str, to: &str| dispatch_check(&tasks, &d, t, to, Some("term-1"), None, false, &agent).unwrap_err().code;
        assert_eq!(code("task-2", "term-5"), "task_waiting");
        assert_eq!(code("task-1", "term-1"), "own_pane");
        assert_eq!(code("task-1", "term-4"), "not_an_agent");
        assert_eq!(code("task-1", "term-6"), "busy");
        assert_eq!(code("task-7", "term-5"), "not_found");
        assert_eq!(dispatch_check(&tasks, &d, "task-1", "term-5", Some("term-1"), None, false, &agent).unwrap(), (0, "claude".to_string()));
        let b = brief(&tasks[0], &Brief { dispatch: "dispatch-2", run: Some("run-1"), coordinator: Some("term-1"), behind: None, levels_left: 0 });
        assert!(b.contains("task-1") && b.contains("dispatch-2") && b.ends_with('a'), "{b}");
    }

    #[test]
    fn a_brief_says_how_to_report_ask_and_keep_in_touch() {
        let task = json!({ "id": "task-4", "spec": "Fix the login bug.\nThen run the tests." });
        let b = brief(&task, &Brief { dispatch: "dispatch-7", run: Some("run-2"), coordinator: Some("term-1"), behind: None, levels_left: 0 });
        let line = |needle: &str| b.lines().find(|l| l.contains(needle)).unwrap_or_else(|| panic!("no {needle} in {b}")).to_string();
        // The done, heartbeat and question commands are one line each and carry this dispatch.
        for kind in ["--type worker_done --outcome succeeded", "--type heartbeat", "--type question"] {
            let l = line(kind);
            assert!(l.trim_start().starts_with(CLI) && l.contains("--dispatch-id dispatch-7") && l.contains("--to run:run-2") && l.contains("--task-id task-4"), "{l}");
            assert_eq!(l.matches('"').count() % 2, 0, "unbalanced quotes: {l}");
        }
        assert!(b.contains("five minutes") && b.contains("orchestration check") && b.contains("not your own question tool"), "{b}");
        assert!(b.contains("wait at your prompt"), "{b}");
        assert!(!b.contains("behind"), "no drift section when the worktree is up to date: {b}");
        // The task text comes last, after the divider.
        let (head, tail) = b.rsplit_once(DIVIDER).expect("divider");
        assert_eq!(tail.trim_start_matches('\n'), "Fix the login bug.\nThen run the tests.");
        assert!(head.contains("worker_done"));
        // Without a Run, reports go to the coordinator's pane; drift names the base and the count.
        let b = brief(&task, &Brief { dispatch: "dispatch-7", run: None, coordinator: Some("term-1"), behind: Some((2, "main".into())), levels_left: 0 });
        assert!(line_of(&b, "worker_done").contains("--to term-1"), "{b}");
        assert!(b.contains("2 commits behind main"), "{b}");
        assert!(b.find("behind").unwrap() < b.find(DIVIDER).unwrap());
    }

    fn line_of(b: &str, needle: &str) -> String {
        b.lines().find(|l| l.contains(needle)).unwrap_or_default().to_string()
    }

    #[test]
    fn a_tier_runs_on_the_coordinators_own_agent() {
        assert_eq!(tier_agent(None, Some("codex"), "claude").unwrap(), "codex");
        assert_eq!(tier_agent(None, None, "claude").unwrap(), "claude");
        assert_eq!(tier_agent(Some("codex"), Some("codex"), "claude").unwrap(), "codex");
        assert_eq!(tier_agent(Some("codex"), None, "claude").unwrap(), "codex");
        assert_eq!(tier_agent(Some("codex"), Some("claude"), "claude").unwrap_err().code, "invalid_arguments");
    }
    #[test]
    fn orch032_workers_nest_only_inside_the_cap() {
        // A coordinator (no dispatch of its own) starts level 1 under the default cap of 1.
        assert_eq!(nest(Some("term-1"), &[], None, None).unwrap(), (1, 1));
        let w1 = vec![json!({ "id": "dispatch-1", "status": "running", "terminal": 2, "depth": 1, "maxDepth": 1 })];
        let no = nest(Some("term-2"), &w1, None, None).unwrap_err();
        assert_eq!(no.code, "nesting_limit");
        assert!(no.message.contains("do this task yourself"), "{}", no.message);
        // A worker cannot raise the cap it was given; a coordinator can, by flag or by setting.
        assert_eq!(nest(Some("term-2"), &w1, Some(5), None).unwrap_err().code, "nesting_limit");
        assert_eq!(nest(Some("term-1"), &[], Some(2), None).unwrap(), (1, 2));
        assert_eq!(nest(Some("term-1"), &[], None, Some(3)).unwrap(), (1, 3));
        let w2 = vec![json!({ "id": "dispatch-1", "status": "running", "terminal": 2, "depth": 1, "maxDepth": 2 }), json!({ "id": "dispatch-2", "status": "running", "terminal": 3, "depth": 2, "maxDepth": 2 })];
        assert_eq!(nest(Some("term-2"), &w2, None, None).unwrap(), (2, 2));
        assert_eq!(nest(Some("term-3"), &w2, None, None).unwrap_err().code, "nesting_limit");
        // A dispatch stored before depth was recorded counts as one level down, under the default cap.
        let old = vec![json!({ "id": "dispatch-1", "status": "running", "terminal": 2 })];
        assert_eq!(nest(Some("term-2"), &old, None, None).unwrap_err().code, "nesting_limit");
        // A finished dispatch no longer makes its pane a worker.
        let done = vec![json!({ "id": "dispatch-1", "status": "abandoned", "terminal": 2, "depth": 1, "maxDepth": 1 })];
        assert_eq!(nest(Some("term-2"), &done, None, None).unwrap(), (1, 1));
        // The brief offers sub-workers only while levels remain.
        let task = json!({ "id": "task-1", "spec": "x" });
        let with = brief(&task, &Brief { dispatch: "dispatch-3", run: Some("run-1"), coordinator: Some("term-1"), behind: None, levels_left: 1 });
        assert!(with.contains("sub-worker") && with.contains("orchestration worker-start"), "{with}");
        let without = brief(&task, &Brief { dispatch: "dispatch-3", run: Some("run-1"), coordinator: Some("term-1"), behind: None, levels_left: 0 });
        assert!(!without.contains("sub-worker"), "{without}");
        // ORCH-013: a context-only dispatch to the caller's own pane is allowed inside the budget only.
        let mut tasks = Vec::new();
        task_create(&mut tasks, &json!({ "spec": "a" }), None, 1).unwrap();
        let agent = |_: &str| Some("claude".to_string());
        assert!(dispatch_check(&tasks, &[], "task-1", "term-1", Some("term-1"), None, true, &agent).is_ok());
        assert_eq!(dispatch_check(&tasks, &[], "task-1", "term-1", Some("term-1"), None, false, &agent).unwrap_err().code, "own_pane");
    }

    #[test]
    fn orch012_task_update_keeps_tasks_and_workers_in_step() {
        let mut m = Mail::default();
        let run = m.run_create("term-1", "o", 1)["run"]["id"].as_str().unwrap().to_string();
        let r = Some(run.as_str());
        let me = std::process::id();
        let mut tasks = Vec::new();
        task_create(&mut tasks, &json!({ "spec": "a" }), Some(run.clone()), 1).unwrap();
        task_create(&mut tasks, &json!({ "spec": "b" }), Some(run.clone()), 1).unwrap();
        task_create(&mut tasks, &json!({ "spec": "c" }), Some(run.clone()), 1).unwrap();
        for (i, t) in tasks.iter_mut().take(2).enumerate() {
            t["status"] = json!("dispatched");
            t["dispatchId"] = json!(format!("dispatch-{}", i + 1));
        }
        let mut d = vec![
            json!({ "id": "dispatch-1", "runId": run, "taskId": "task-1", "status": "running", "terminal": 2, "runtime": me }),
            json!({ "id": "dispatch-2", "runId": run, "taskId": "task-2", "status": "running", "terminal": 3, "runtime": me }),
        ];
        // Unknown states, other Runs' tasks and a hand-made dispatched state are turned away.
        assert!(task_update(&mut tasks, &mut d, "task-1", "done", None, r, None, 5).unwrap_err().message.contains("pending, ready, dispatched, completed, failed, blocked"));
        assert_eq!(task_update(&mut tasks, &mut d, "task-1", "completed", None, Some("run-9"), None, 5).unwrap_err().code, "not_found");
        assert_eq!(task_update(&mut tasks, &mut d, "task-3", "dispatched", None, r, None, 5).unwrap_err().code, "invalid_transition");
        // A worker whose process already ended cannot claim the task done.
        d[0]["exitedAt"] = json!(4);
        assert_eq!(task_update(&mut tasks, &mut d, "task-1", "completed", None, r, Some("term-2"), 5).unwrap_err().code, "worker_exited");
        assert_eq!((tasks[0]["status"].as_str(), d[0]["status"].as_str()), (Some("dispatched"), Some("running")));
        d[0].as_object_mut().unwrap().remove("exitedAt");
        // Completing a dispatched task settles its worker in the same change.
        let done = task_update(&mut tasks, &mut d, "task-1", "completed", Some("all green"), r, Some("term-1"), 6).unwrap();
        assert_eq!((done["status"].as_str(), done["previous"].as_str(), done["dispatchStatus"].as_str()), (Some("completed"), Some("dispatched"), Some("completed")));
        assert_eq!((tasks[0]["status"].as_str(), tasks[0]["result"].as_str(), d[0]["status"].as_str()), (Some("completed"), Some("all green"), Some("completed")));
        assert!(finished(&d[0]), "its worker slot is free");
        assert_eq!(task_update(&mut tasks, &mut d, "task-1", "dispatched", None, r, None, 7).unwrap_err().code, "invalid_transition");
        // Sending a dispatched task back fences its worker, so it never has two.
        let back = task_update(&mut tasks, &mut d, "task-2", "ready", None, r, None, 8).unwrap();
        assert_eq!(back["dispatchStatus"], "abandoned");
        assert_eq!((tasks[1]["status"].as_str(), tasks[1].get("dispatchId")), (Some("ready"), None));
        // ...and that worker can no longer settle it.
        assert_eq!(task_update(&mut tasks, &mut d, "task-2", "completed", None, r, Some("term-3"), 9).unwrap_err().code, "dispatch_finished");
        assert_eq!(tasks[1]["status"], "ready");
        // Every task is still either dispatched to exactly one open worker or held by none.
        for t in &tasks {
            let open = d.iter().filter(|x| x["taskId"] == t["id"] && !finished(x)).count();
            assert_eq!(open, usize::from(t["status"] == "dispatched"), "{t}");
        }
    }

    #[test]
    fn orch022_stopping_a_worker_ends_its_terminal_and_keeps_its_worktree() {
        let mut m = Mail::default();
        let run = m.run_create("term-1", "o", 1)["run"]["id"].as_str().unwrap().to_string();
        let r = Some(run.as_str());
        let mut tasks = Vec::new();
        task_create(&mut tasks, &json!({ "spec": "a" }), Some(run.clone()), 1).unwrap();
        task_create(&mut tasks, &json!({ "spec": "b" }), Some(run.clone()), 1).unwrap();
        tasks[0]["status"] = json!("dispatched");
        tasks[0]["dispatchId"] = json!("dispatch-1");
        let mut d = vec![
            json!({ "id": "dispatch-1", "runId": run, "taskId": "task-1", "status": "running", "terminal": 4, "runtime": std::process::id(), "worktree": "W" }),
            json!({ "id": "dispatch-2", "runId": run, "taskId": "task-2", "status": "running", "terminal": 5, "runtime": 1, "worktree": "V" }),
        ];
        assert_eq!(stop(&mut tasks, &mut d, "dispatch-1", Some("run-9"), 5).unwrap_err().code, "not_found");
        let (got, kill) = stop(&mut tasks, &mut d, "dispatch-1", r, 5).unwrap();
        assert_eq!(kill, Some(4), "only the worker's own terminal is ended");
        assert_eq!((got["status"].as_str(), got["worktree"].as_str(), got["worktreeKept"].as_bool()), (Some("stopped"), Some("W"), Some(true)));
        assert_eq!((d[0]["status"].as_str(), tasks[0]["status"].as_str()), (Some("stopped"), Some("ready")));
        // Stopping twice answers the same and ends nothing more.
        let (again, kill) = stop(&mut tasks, &mut d, "dispatch-1", r, 6).unwrap();
        assert_eq!((again["status"].as_str(), kill), (Some("stopped"), None));
        // A terminal Kolux has lost touch with is reported as unverifiable, never as ended.
        let (lost, kill) = stop(&mut tasks, &mut d, "dispatch-2", r, 7).unwrap();
        assert_eq!((lost["process"].as_str(), kill), (Some("unverifiable"), None));
        // A worker that already finished has nothing to stop.
        d[0]["status"] = json!("completed");
        assert_eq!(stop(&mut tasks, &mut d, "dispatch-1", r, 8).unwrap_err().code, "dispatch_finished");
    }

    #[test]
    fn orch023_an_abandoned_dispatch_takes_no_more_reports() {
        let mut m = Mail::default();
        let run = m.run_create("term-1", "o", 1)["run"]["id"].as_str().unwrap().to_string();
        let mut tasks = Vec::new();
        task_create(&mut tasks, &json!({ "spec": "a" }), Some(run.clone()), 1).unwrap();
        tasks[0]["status"] = json!("dispatched");
        tasks[0]["dispatchId"] = json!("dispatch-1");
        let mut d = vec![json!({ "id": "dispatch-1", "runId": run, "taskId": "task-1", "status": "running", "terminal": 2, "mode": "context" })];
        // Another Run cannot abandon it: the id reads as missing.
        assert_eq!(abandon(&mut tasks, &mut d, "dispatch-1", Some("run-9"), 5).unwrap_err().code, "not_found");
        let r = abandon(&mut tasks, &mut d, "dispatch-1", Some(&run), 5).unwrap();
        assert_eq!((r["status"].as_str(), r["terminal"].as_str(), r["terminalKept"].as_bool()), (Some("abandoned"), Some("term-2"), Some(true)));
        assert_eq!(d[0]["status"], "abandoned");
        // Its task can be handed on again.
        assert_eq!(tasks[0]["status"], "ready");
        assert!(tasks[0].get("dispatchId").is_none());
        // Abandoning again answers the same; the worker's done report and heartbeat are turned away.
        assert_eq!(abandon(&mut tasks, &mut d, "dispatch-1", Some(&run), 6).unwrap()["status"], "abandoned");
        let to = format!("run:{run}");
        for kind in [json!({ "type": "worker_done", "outcome": "succeeded" }), json!({ "type": "heartbeat" })] {
            let mut a = json!({ "to": to, "subject": "task-1 done", "taskId": "task-1", "dispatchId": "dispatch-1" });
            a.as_object_mut().unwrap().extend(kind.as_object().unwrap().clone());
            let no = m.send("term-2", &a, &d, &live, 7).unwrap_err();
            assert_eq!(no.code, "dispatch_finished", "{}", no.message);
            assert!(no.message.contains("abandoned"), "{}", no.message);
        }
        assert!(m.messages.is_empty());
        // Ordinary mail still goes through.
        assert!(m.send("term-2", &json!({ "to": to, "subject": "note" }), &d, &live, 8).is_ok());
    }

    #[test]
    fn cli039_a_report_on_a_dispatch_comes_only_from_its_worker() {
        let mut m = Mail::default();
        let run = m.run_create("term-1", "work", 1)["run"]["id"].as_str().unwrap().to_string();
        let d = vec![json!({ "id": "dispatch-1", "runId": run, "taskId": "task-1", "status": "running", "terminal": 2 })];
        let to = format!("run:{run}");
        for kind in [json!({ "type": "worker_done", "outcome": "succeeded" }), json!({ "type": "heartbeat" })] {
            let mut a = json!({ "to": to, "subject": "task-1 done", "taskId": "task-1", "dispatchId": "dispatch-1" });
            a.as_object_mut().unwrap().extend(kind.as_object().unwrap().clone());
            // ORCH-015: another pane's report is delivered as mail, but it settles nothing.
            let (mut t, mut dd) = (vec![json!({ "id": "task-1", "runId": run, "status": "dispatched", "dispatchId": "dispatch-1" })], d.clone());
            assert!(m.send("term-3", &a, &d, &live, 2).is_ok());
            let no = report(&mut t, &mut dd, "term-3", &a, 2).unwrap();
            assert_eq!(no["settles"], false, "{no}");
            assert!(no["why"].as_str().unwrap().contains("term-2"), "{no}");
            assert_eq!((t[0]["status"].as_str(), dd[0].get("lastBeatAt")), (Some("dispatched"), None));
            assert!(m.send("term-2", &a, &d, &live, 3).is_ok(), "its own worker reports");
        }
        // A dispatch whose worker terminal belongs to an earlier start cannot be vouched for.
        let mut old = vec![json!({ "id": "dispatch-1", "runId": run, "taskId": "task-1", "status": "running", "terminal": 2, "runtime": u64::from(std::process::id()) + 1 })];
        let a = json!({ "to": to, "subject": "done", "type": "worker_done", "outcome": "succeeded", "dispatchId": "dispatch-1" });
        let mut t = vec![json!({ "id": "task-1", "runId": run, "status": "dispatched", "dispatchId": "dispatch-1" })];
        assert!(report(&mut t, &mut old, "term-2", &a, 4).unwrap()["why"].as_str().unwrap().contains("earlier start"));
        assert_eq!(t[0]["status"], "dispatched");
    }

    #[test]
    fn orch015_a_done_report_settles_its_task_and_a_heartbeat_keeps_the_worker_alive() {
        let mut m = Mail::default();
        let run = m.run_create("term-1", "work", 1)["run"]["id"].as_str().unwrap().to_string();
        let mut tasks = vec![
            json!({ "id": "task-1", "runId": run, "status": "dispatched", "dispatchId": "dispatch-1", "deps": [] }),
            json!({ "id": "task-2", "runId": run, "status": "pending", "deps": ["task-1"] }),
            json!({ "id": "task-3", "runId": run, "status": "dispatched", "dispatchId": "dispatch-2", "deps": [] }),
        ];
        let mut d = vec![
            json!({ "id": "dispatch-1", "runId": run, "taskId": "task-1", "status": "running", "terminal": 2 }),
            json!({ "id": "dispatch-2", "runId": run, "taskId": "task-3", "status": "running", "terminal": 3 }),
        ];
        let to = format!("run:{run}");
        // A heartbeat from the worker's own terminal is stamped with when Kolux got it.
        let beat = json!({ "to": to, "subject": "working", "type": "heartbeat", "dispatchId": "dispatch-1" });
        assert_eq!(report(&mut tasks, &mut d, "term-2", &beat, 50).unwrap()["lastBeatAt"], 50);
        assert_eq!(d[0]["lastBeatAt"], 50);
        let rows = worker_list(&tasks, &d, Some(&run), "named", None, None, 50, &live).unwrap();
        assert_eq!(rows["workers"].as_array().unwrap().iter().find(|w| w["dispatchId"] == "dispatch-1").unwrap()["lastBeatAt"], 50);
        // The coordinator writing one on the worker's behalf: delivered as mail, settles nothing.
        let done = json!({ "to": to, "subject": "task-1 done", "type": "worker_done", "outcome": "succeeded", "dispatchId": "dispatch-1", "filesModified": "a.rs" });
        assert!(m.send("term-1", &done, &d, &live, 60).is_ok());
        assert_eq!(report(&mut tasks, &mut d, "term-1", &done, 60).unwrap()["settles"], false);
        assert_eq!((tasks[0]["status"].as_str(), d[0]["status"].as_str(), tasks[1]["status"].as_str()), (Some("dispatched"), Some("running"), Some("pending")));
        // The worker's own succeeded report completes the task and frees the one waiting on it.
        let own = report(&mut tasks, &mut d, "term-2", &done, 70).unwrap();
        assert_eq!((own["status"].as_str(), own["dispatchStatus"].as_str()), (Some("completed"), Some("completed")), "{own}");
        assert_eq!((tasks[0]["status"].as_str(), tasks[0]["result"].as_str(), tasks[1]["status"].as_str()), (Some("completed"), Some("task-1 done"), Some("ready")));
        // Once settled, a replayed report or a late heartbeat is turned away and changes nothing.
        for again in [&done, &beat] {
            assert_eq!(m.send("term-2", again, &d, &live, 80).unwrap_err().code, "dispatch_finished");
        }
        assert_eq!(d[0]["lastBeatAt"], 50);
        // A failed report fails its task; a report on a task already handed to another dispatch
        // is not taken, never read as success.
        let failed = json!({ "to": to, "subject": "tests red", "body": "two tests fail", "type": "worker_done", "outcome": "failed", "dispatchId": "dispatch-2" });
        tasks[2]["dispatchId"] = json!("dispatch-9");
        assert_eq!(report(&mut tasks, &mut d, "term-3", &failed, 90).unwrap_err().code, "outcome_unknown");
        tasks[2]["dispatchId"] = json!("dispatch-2");
        report(&mut tasks, &mut d, "term-3", &failed, 91).unwrap();
        assert_eq!((tasks[2]["status"].as_str(), tasks[2]["result"].as_str(), d[1]["status"].as_str()), (Some("failed"), Some("two tests fail"), Some("failed")));
        // Ordinary mail, and a report naming no dispatch, settle nothing.
        assert!(report(&mut tasks, &mut d, "term-2", &json!({ "subject": "hi" }), 92).unwrap().is_null());
        assert!(report(&mut tasks, &mut d, "term-2", &json!({ "subject": "x", "type": "worker_done", "outcome": "succeeded" }), 92).unwrap().is_null());
    }

    #[test]
    fn orch033_one_run_cannot_reach_into_another() {
        let mut m = Mail::default();
        let a = m.run_create("term-1", "A", 1)["run"]["id"].as_str().unwrap().to_string();
        let b = m.run_create("term-5", "B", 2)["run"]["id"].as_str().unwrap().to_string();
        // A worker acts in the Run of the dispatch it works on.
        let d = vec![json!({ "id": "dispatch-1", "runId": a, "taskId": "task-1", "status": "running", "terminal": 2 })];
        assert_eq!(m.run_of("term-2", &d).as_deref(), Some(a.as_str()));
        assert_eq!(m.run_of("term-5", &d).as_deref(), Some(b.as_str()));
        assert_eq!(m.run_of("term-7", &d), None);
        let mut tasks = Vec::new();
        task_create(&mut tasks, &json!({ "spec": "A's" }), Some(a.clone()), 1).unwrap();
        // From Run B, Run A's task reads exactly as a missing one.
        assert_eq!(task_in(&tasks, "task-1", Some(&b)).unwrap_err(), task_in(&[], "task-1", Some(&b)).unwrap_err());
        assert_eq!(task_in(&tasks, "task-1", Some(&a)).unwrap(), 0);
        let agent = |_: &str| Some("claude".to_string());
        assert_eq!(dispatch_check(&tasks, &[], "task-1", "term-6", Some("term-5"), Some(&b), false, &agent).unwrap_err().code, "not_found");
        assert!(dispatch_check(&tasks, &[], "task-1", "term-6", Some("term-1"), Some(&a), false, &agent).is_ok());
        // A message in Run A cannot be answered from Run B, the same as a missing one.
        let sent = m.send("term-2", &json!({ "to": format!("run:{a}"), "subject": "q" }), &d, &live, 3).unwrap();
        let id = sent["messageIds"][0].as_str().unwrap().to_string();
        let boxes_b = m.boxes_of("term-5", &d);
        let no = m.reply("term-5", &id, "x", None, &boxes_b, Some(&b), 4).unwrap_err();
        assert_eq!((no.code, no.message.clone()), ("not_found", format!("no message {id}")));
        let boxes_a = m.boxes_of("term-1", &d);
        assert!(m.reply("term-1", &id, "x", None, &boxes_a, Some(&a), 4).is_ok());
    }

    fn peer(h: &str, agent: Option<&str>, idle: bool, dir: &str) -> Peer {
        Peer { handle: h.into(), agent: agent.map(str::to_string), idle, dir: dir.into() }
    }

    #[test]
    fn a_group_send_fans_out_on_one_thread() {
        let mut m = Mail::default();
        let peers = vec![
            peer("term-1", Some("claude"), true, "G:/r"),
            peer("term-2", Some("codex"), true, "G:/r/wt"),
            peer("term-3", Some("claude"), false, "G:/r"),
            peer("term-4", None, true, "G:/r"),
        ];
        let sent = |m: &mut Mail, to: &str| -> Vec<String> {
            let r = m.post("term-1", &json!({ "to": to, "subject": "hi" }), &[], &peers, 2).unwrap();
            assert!(r.get("deliveryId").is_none() && r.get("deliveries").is_none(), "a receipt carries no delivery bookkeeping");
            let ids: Vec<String> = r["messageIds"].as_array().unwrap().iter().map(|v| v.as_str().unwrap().to_string()).collect();
            let thread = r["threadId"].as_str().unwrap();
            let mut to: Vec<String> = m.messages.iter().filter(|x| ids.contains(&x.id)).inspect(|x| assert_eq!(x.extras["threadId"], thread)).map(|x| x.to.clone()).collect();
            to.sort();
            to
        };
        // The sender and the shell are never part of it; titles play no part, only the detected agent.
        assert_eq!(sent(&mut m, "@all"), ["term:term-2", "term:term-3"]);
        assert_eq!(sent(&mut m, "@idle"), ["term:term-2"], "the sender is idle but never gets its own copy");
        assert_eq!(sent(&mut m, "@claude"), ["term:term-3"]);
        assert_eq!(sent(&mut m, "@CODEX"), ["term:term-2"]);
        assert_eq!(sent(&mut m, "@worktree:p-1::G:/r/wt"), ["term:term-2"]);
        assert_eq!(sent(&mut m, "@worktree:G:/r/wt/"), ["term:term-2"]);
        let given = m.post("term-1", &json!({ "to": "@all", "subject": "x", "threadId": "t-9" }), &[], &peers, 3).unwrap();
        assert_eq!(given["threadId"], "t-9");
        let no = |m: &mut Mail, a: Value| m.post("term-1", &a, &[], &peers, 4).unwrap_err();
        let unknown = no(&mut m, json!({ "to": "@nobody", "subject": "x" }));
        assert!(unknown.message.contains("@nobody"), "{}", unknown.message);
        assert!(no(&mut m, json!({ "to": "@cursor", "subject": "x" })).message.contains("no agent"));
        assert!(no(&mut m, json!({ "to": "@all", "subject": "x", "type": "question" })).message.contains("one recipient"));
        assert!(no(&mut m, json!({ "to": "@all", "subject": "x", "type": "heartbeat" })).message.contains("group"));
        let before = m.messages.len();
        assert!(no(&mut m, json!({ "to": "@all", "subject": "x", "priority": "loud" })).message.contains("--priority"));
        assert_eq!(m.messages.len(), before, "a refused group send leaves nothing behind");
        // One-to-one sends still go through post.
        assert!(m.post("term-1", &json!({ "to": "term-4", "subject": "x" }), &[], &peers, 5).is_ok());
        assert_eq!(m.post("term-1", &json!({ "to": "term-7", "subject": "x" }), &[], &peers, 5).unwrap_err().code, "not_found");
    }

    #[test]
    fn a_gate_holds_its_task_until_it_is_resolved() {
        let mut m = Mail::default();
        let mut tasks = vec![
            json!({ "id": "task-1", "status": "ready", "runId": "run-1", "deps": [] }),
            json!({ "id": "task-2", "status": "dispatched", "runId": "run-1", "deps": [] }),
            json!({ "id": "task-3", "status": "ready", "runId": "run-2", "deps": [] }),
            json!({ "id": "task-4", "status": "ready", "deps": [] }),
        ];
        let d = vec![json!({ "id": "dispatch-1", "taskId": "task-2", "status": "ready", "runId": "run-1" })];
        let g = m.gate_create(Some("run-1"), &mut tasks, &d, &json!({ "task": "task-1", "question": "ship it?", "options": r#"["yes","no"]"# }), 1).unwrap();
        assert_eq!(tasks[0]["status"], "blocked");
        assert_eq!(g["options"], json!(["yes", "no"]));
        assert_eq!(g["status"], "pending");
        let id = g["id"].as_str().unwrap().to_string();
        let count = |m: &Mail, run: &str, status: &str| m.gate_list(Some(run), &json!({ "status": status })).unwrap()["gates"].as_array().unwrap().len();
        assert_eq!(count(&m, "run-1", "pending"), 1);
        assert_eq!(count(&m, "run-2", "pending"), 0, "a gate belongs to its own Run");
        assert_eq!(m.gate_resolve(Some("run-2"), &mut tasks, &json!({ "id": id, "resolution": "yes" }), 2).unwrap_err().code, "not_found");
        let r = m.gate_resolve(Some("run-1"), &mut tasks, &json!({ "id": id, "resolution": "yes" }), 3).unwrap();
        assert_eq!((r["status"].as_str(), r["resolution"].as_str()), (Some("resolved"), Some("yes")));
        assert_eq!(tasks[0]["status"], "ready");
        assert!(m.gate_resolve(Some("run-1"), &mut tasks, &json!({ "id": id, "resolution": "no" }), 4).unwrap_err().message.contains("already"));
        assert_eq!(count(&m, "run-1", "resolved"), 1);
        assert!(m.gate_list(Some("run-1"), &json!({ "status": "open" })).is_err());
        // Nothing is left behind when the gate cannot be opened.
        let before = (m.gates.len(), tasks.clone());
        let no = |m: &mut Mail, tasks: &mut Vec<Value>, a: Value| m.gate_create(Some("run-1"), tasks, &d, &a, 5).unwrap_err();
        assert!(no(&mut m, &mut tasks, json!({ "task": "task-1", "question": "q", "options": "yes,no" })).message.contains("JSON"));
        assert!(no(&mut m, &mut tasks, json!({ "task": "task-2", "question": "q" })).message.contains("worker"));
        assert_eq!(no(&mut m, &mut tasks, json!({ "task": "task-3", "question": "q" })).code, "not_found");
        assert!(no(&mut m, &mut tasks, json!({ "task": "task-1" })).message.contains("--question"));
        // CLI-037: with no Run attached, even a task that has no Run of its own is not held.
        let lone = m.gate_create(None, &mut tasks, &d, &json!({ "task": "task-4", "question": "q" }), 5).unwrap_err();
        assert_eq!(lone.code, "no_run");
        assert!(lone.message.contains("run-create"), "{}", lone.message);
        assert_eq!((m.gates.len(), tasks.clone()), before);
    }

    #[test]
    fn a_question_waits_for_its_reply_and_can_be_resumed() {
        let mut m = Mail::default();
        let run = m.run_create("term-1", "o", 1)["run"]["id"].as_str().unwrap().to_string();
        let peers = vec![peer("term-1", Some("claude"), true, "G:/r"), peer("term-2", Some("claude"), true, "G:/r/w")];
        let q = m.ask("term-2", &json!({ "question": "tabs or spaces?", "options": "tabs, spaces", "to": format!("run:{run}") }), &[], &peers, 2).unwrap();
        assert_eq!(q["status"], "open");
        let id = q["messageId"].as_str().unwrap().to_string();
        let msg = m.messages.iter().find(|x| x.id == id).unwrap();
        assert_eq!((msg.kind.as_str(), msg.to.clone()), ("question", format!("run:{run}")));
        assert_eq!(msg.extras["payload"]["options"], json!(["tabs", "spaces"]));
        assert_eq!(m.ask("term-2", &json!({ "resume": id }), &[], &peers, 3).unwrap()["status"], "open");
        let boxes = m.boxes_of("term-1", &[]);
        m.reply("term-1", &id, "spaces", None, &boxes, Some(&run), 4).unwrap();
        let a = m.ask("term-2", &json!({ "resume": id }), &[], &peers, 5).unwrap();
        assert_eq!((a["status"].as_str(), a["answer"].as_str(), a["answeredBy"].as_str()), (Some("answered"), Some("spaces"), Some("term-1")));
        let n = m.messages.len();
        assert!(m.ask("term-2", &json!({ "question": "x", "to": "@all" }), &[], &peers, 6).unwrap_err().message.contains("one recipient"));
        assert_eq!(m.messages.len(), n, "no question is made for a group");
        assert!(m.ask("term-2", &json!({ "question": "x", "resume": id }), &[], &peers, 6).unwrap_err().message.contains("not both"));
        assert!(m.ask("term-2", &json!({ "resume": id, "options": "a,b" }), &[], &peers, 6).unwrap_err().message.contains("--options"));
        assert_eq!(m.ask("term-1", &json!({ "resume": id }), &[], &peers, 6).unwrap_err().code, "not_found", "only the asker resumes its question");
    }

    #[test]
    fn a_reset_clears_only_its_scope() {
        let mut m = Mail::default();
        let run = m.run_create("term-1", "o", 1)["run"]["id"].as_str().unwrap().to_string();
        let peers = vec![peer("term-1", Some("claude"), true, "G:/r")];
        let mut tasks = vec![json!({ "id": "task-1", "status": "ready", "runId": run, "deps": [] })];
        m.gate_create(Some(&run), &mut tasks, &[], &json!({ "task": "task-1", "question": "q" }), 2).unwrap();
        m.post("term-1", &json!({ "subject": "hi", "to": format!("run:{run}") }), &[], &peers, 3).unwrap();
        let boxes = m.boxes_of("term-1", &[]);
        let first = m.check("term-1", "term-1", &boxes, Mode::Next, None, None, None).unwrap();
        assert_eq!(first["messages"].as_array().unwrap().len(), 1);
        m.reset("tasks").unwrap();
        assert!(m.gates.is_empty());
        assert_eq!((m.runs.len(), m.messages.len()), (1, 1), "the tasks scope keeps Runs and mail");
        m.reset("messages").unwrap();
        assert!(m.messages.is_empty());
        assert_eq!((m.runs.len(), m.deliveries.len()), (1, 1), "the messages scope keeps Runs and delivery positions");
        let seq = m.seq;
        m.reset("all").unwrap();
        assert_eq!((m.runs.len(), m.deliveries.len(), m.bindings.len()), (0, 0, 0));
        assert_eq!(m.seq, seq, "ids keep counting up, so nothing cleared is named again");
        assert!(m.reset("everything").is_err());
    }
    #[test]
    fn orch026_worker_list_shows_terminal_accounting_apart_from_task_status() {
        let me = std::process::id();
        let tasks = vec![json!({ "id": "task-1", "status": "dispatched" }), json!({ "id": "task-2", "status": "completed" })];
        let d = vec![
            json!({ "id": "dispatch-1", "runId": "run-1", "taskId": "task-1", "status": "running", "terminal": 4, "runtime": me, "worktree": "W" }),
            json!({ "id": "dispatch-2", "runId": "run-1", "taskId": "task-2", "status": "completed", "terminal": 5, "runtime": me }),
            json!({ "id": "dispatch-3", "runId": "run-1", "taskId": "task-2", "status": "stopped", "terminal": 6, "runtime": me }),
            json!({ "id": "dispatch-4", "runId": "run-1", "taskId": "task-2", "status": "completed", "terminal": 7, "runtime": 1, "retained": true }),
            json!({ "id": "dispatch-5", "runId": "run-2", "taskId": "task-9", "status": "failed", "terminal": 8, "runtime": me }),
            // A very old record, from before dispatches carried a runtime or a status.
            json!({ "id": "dispatch-6", "runId": "run-1", "taskId": "task-1" }),
        ];
        let live = |h: &str| ["term-4", "term-5", "term-8"].contains(&h);
        let all = |run, state, cursor, limit| worker_list(&tasks, &d, run, "named", state, cursor, limit, &live);
        let got = all(Some("run-1"), None, None, 100).unwrap();
        let states: Vec<(&str, &str)> = got["workers"].as_array().unwrap().iter().map(|w| (w["dispatchId"].as_str().unwrap(), w["terminalState"].as_str().unwrap())).collect();
        assert_eq!(states, [("dispatch-1", "active"), ("dispatch-2", "reclaimable"), ("dispatch-3", "released"), ("dispatch-4", "retained"), ("dispatch-6", "active")]);
        assert_eq!((got["scope"]["run"].as_str(), got["scope"]["from"].as_str()), (Some("run-1"), Some("named")));
        let w = &got["workers"][0];
        assert_eq!((w["taskStatus"].as_str(), w["status"].as_str(), w["terminal"].as_str(), w["worktree"].as_str()), (Some("dispatched"), Some("running"), Some("term-4"), Some("W")));
        assert_eq!(w["next"].as_str(), Some(format!("{CLI} orchestration worker-stop --dispatch dispatch-1").as_str()));
        assert_eq!(got["workers"][1]["next"].as_str(), Some(format!("{CLI} terminal close --terminal term-5").as_str()));
        assert!(got["workers"][2]["next"].is_null(), "nothing is left to clean up after a released worker");
        assert!(got["workers"][4]["status"].is_null() && got["workers"][4]["worktree"].is_null(), "an old record lists in the current shape");
        // Only settled workers not yet released are reclaimable.
        let r = all(Some("run-1"), Some("reclaimable"), None, 100).unwrap();
        assert_eq!(r["workers"].as_array().unwrap().len(), 1);
        // No Run in scope: every Run's workers.
        assert_eq!(worker_list(&tasks, &d, None, "all", None, None, 100, &live).unwrap()["workers"].as_array().unwrap().len(), 6);
        // Pages: an opaque cursor carries on, and one from another Run's list is turned away.
        let p1 = all(Some("run-1"), None, None, 2).unwrap();
        let c = p1["nextCursor"].as_str().unwrap().to_string();
        assert!(!c.contains("run-1"), "the cursor is opaque");
        let p2 = all(Some("run-1"), None, Some(&c), 2).unwrap();
        assert_eq!(p2["workers"][0]["dispatchId"], "dispatch-3");
        assert_eq!(all(Some("run-2"), None, Some(&c), 2).unwrap_err().code, "invalid_arguments");
        assert_eq!(all(Some("run-1"), None, Some("nonsense"), 2).unwrap_err().code, "invalid_arguments");
        let last = all(Some("run-1"), None, Some(p2["nextCursor"].as_str().unwrap()), 2).unwrap();
        assert!(last["nextCursor"].is_null());
    }

    #[test]
    fn orch025_keeping_a_settled_worker_lasts_and_lists_apart() {
        let me = std::process::id();
        let mut d = vec![
            json!({ "id": "dispatch-1", "runId": "run-1", "taskId": "task-1", "status": "completed", "terminal": 4, "runtime": me }),
            json!({ "id": "dispatch-2", "runId": "run-1", "taskId": "task-2", "status": "running", "terminal": 5, "runtime": me }),
        ];
        let live = |h: &str| h == "term-4" || h == "term-5";
        assert_eq!(retain(&mut d, &live, "dispatch-1", Some("run-9")).unwrap_err().code, "not_found");
        assert_eq!(retain(&mut d, &live, "dispatch-2", Some("run-1")).unwrap_err().code, "dispatch_active");
        let r = retain(&mut d, &live, "dispatch-1", Some("run-1")).unwrap();
        assert_eq!((r["terminalState"].as_str(), r["alreadyRetained"].as_bool()), (Some("retained"), Some(false)));
        assert_eq!(d[0]["retained"], true, "the mark is on the stored record, so it outlives a restart");
        assert_eq!(retain(&mut d, &live, "dispatch-1", Some("run-1")).unwrap()["alreadyRetained"], true);
        // After a restart the terminal handle means no one, yet the worker still lists as kept.
        d[0]["runtime"] = json!(1);
        let got = worker_list(&[], &d, Some("run-1"), "tied", Some("retained"), None, 100, &|_| false).unwrap();
        assert_eq!(got["workers"][0]["dispatchId"], "dispatch-1");
        // A worker whose terminal is already gone has nothing to keep.
        d.push(json!({ "id": "dispatch-3", "runId": "run-1", "taskId": "task-3", "status": "stopped", "terminal": 9, "runtime": 1 }));
        assert_eq!(retain(&mut d, &live, "dispatch-3", Some("run-1")).unwrap_err().code, "terminal_gone");
    }
}
