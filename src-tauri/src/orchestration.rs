//! Orchestration mail and tasks (ORCH-001..006, ORCH-010, ORCH-011, ORCH-013): Runs, which pane is tied to which
//! Run, typed messages, and the batches `check` hands out until they are acknowledged. All of it
//! is one JSON value in the store; the command line reaches it through `cli::dispatch`.

use crate::cli::Fail;
use serde::{Deserialize, Serialize};
use serde_json::{json, Map, Value};
use std::collections::BTreeMap;

const KEY: &str = "orchestration.mail";
pub const KINDS: &[&str] = &["status", "dispatch", "worker_done", "merge_ready", "escalation", "handoff", "decision_gate", "question", "heartbeat"];

#[derive(Default, Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(default, rename_all = "camelCase")]
pub struct Mail {
    pub runs: Vec<Run>,
    pub bindings: BTreeMap<String, Binding>,
    pub messages: Vec<Message>,
    pub deliveries: Vec<Delivery>,
    pub answers: BTreeMap<String, Value>,
    pub seq: u64,
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

/// Who is calling (ORCH-001): `--from` names an open Kolux terminal; otherwise the handle and
/// secret pane key every Kolux terminal carries must match a pane the runtime started itself. A
/// shell outside Kolux (or a guessed key) is nobody: `None`.
/// The pane key decides: a handle the environment still names after it went stale is worked out
/// again from the key (CLI-034); a key the runtime never gave is no one.
pub fn caller_of(from: Option<&str>, pane: Option<(&str, &str)>, by_key: &dyn Fn(&str) -> Option<String>, live: &dyn Fn(&str) -> bool) -> Result<Option<String>, Fail> {
    if let Some(h) = from.map(str::trim).filter(|h| !h.is_empty()) {
        return if live(h) { Ok(Some(h.to_string())) } else { Err(Fail::new("not_found", format!("no open Kolux terminal is called {h}"))) };
    }
    Ok(pane.and_then(|(_, k)| by_key(k)))
}

fn finished(d: &Value) -> bool {
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

    /// A retry request id makes a change safe to repeat: the same id hands back the first answer.
    pub fn once(&mut self, key: Option<String>, f: impl FnOnce(&mut Mail) -> Result<Value, Fail>) -> Result<Value, Fail> {
        if let Some(v) = key.as_ref().and_then(|k| self.answers.get(k)) {
            return Ok(v.clone());
        }
        let v = f(self)?;
        if let Some(k) = key {
            self.answers.insert(k, v.clone());
        }
        Ok(v)
    }

    fn run_view(&self, id: &str) -> Value {
        match self.runs.iter().find(|r| r.id == id) {
            Some(r) => json!({ "id": r.id, "objective": r.objective, "home": r.home, "created": r.created }),
            None => Value::Null,
        }
    }

    /// ORCH-001: a Run is a namespace with a home mailbox; making one schedules nothing.
    // ponytail: nesting depth (ORCH-032) is T-155; a new Run leaves it alone because there is none.
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
                // ponytail: group addresses (ORCH-004) fan out with T-190; refused until then.
                return Err(Fail::new("unsupported", format!("group addresses such as {t} arrive later; name a run:, dispatch: or terminal handle")));
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
        for k in ["threadId", "taskId", "dispatchId", "outcome", "reportPath", "phase"] {
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
    pub fn reply(&mut self, from: &str, id: &str, body: &str, run: Option<&str>, now: u64) -> Result<Value, Fail> {
        let m = self.messages.iter().find(|m| m.id == id).cloned().ok_or_else(|| Fail::new("not_found", format!("no message {id}")))?;
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
// ponytail: a context-only dispatch to the caller itself inside the nesting budget (ORCH-032,
// T-155) is refused with the rest of own_pane until that budget exists.
pub fn dispatch_check(tasks: &[Value], dispatches: &[Value], task: &str, to: &str, caller: Option<&str>, agent_of: &dyn Fn(&str) -> Option<String>) -> Result<(usize, String), Fail> {
    let i = tasks.iter().position(|t| t["id"] == task).ok_or_else(|| Fail::new("not_found", format!("no task {task}")))?;
    match status(&tasks[i]) {
        "ready" => {}
        "pending" => return Err(Fail::new("task_waiting", format!("{task} is still waiting on its dependencies"))),
        "dispatched" => return Err(Fail::new("task_taken", format!("{task} already has a worker ({})", tasks[i]["dispatchId"].as_str().unwrap_or("?")))),
        s => return Err(Fail::new("task_not_ready", format!("{task} is {s}, not ready"))),
    }
    if caller == Some(to) {
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
}

/// ORCH-014: the text a worker gets: how to report done, beat, ask and look for mail, each a
/// one-line command that runs in any shell, then the task text last. The commands need no
/// `--from`: run in the worker's pane, its KOLUX_TERMINAL_HANDLE ties them to that pane.
// ponytail: questions go out as mail plus `check --wait` until the ask command lands (ORCH-029,
// T-190); the dispatch pass joins these commands with ORCH-067 (T-155); the sub-worker section,
// shown only while nesting budget remains, comes with that budget (ORCH-032, T-155). Every worker
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

    #[test]
    fn a_pane_is_tied_only_when_the_runtime_knows_it() {
        let by_key = |k: &str| (k == "s3cret").then(|| "term-1".to_string());
        assert_eq!(caller_of(None, Some(("term-1", "s3cret")), &by_key, &live).unwrap().as_deref(), Some("term-1"));
        // CLI-034: a stale handle is worked out again from the pane key.
        assert_eq!(caller_of(None, Some(("term-5", "s3cret")), &by_key, &live).unwrap().as_deref(), Some("term-1"));
        assert_eq!(caller_of(None, Some(("term-1", "guess")), &by_key, &live).unwrap(), None);
        assert_eq!(caller_of(None, None, &by_key, &live).unwrap(), None);
        assert_eq!(caller_of(Some("term-4"), None, &by_key, &live).unwrap().as_deref(), Some("term-4"));
        assert_eq!(caller_of(Some("nope"), None, &by_key, &live).unwrap_err().code, "not_found");
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
        assert_eq!(refused(&mut m, json!({ "to": "@all", "subject": "hi" })).code, "unsupported");
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
        let r = m.reply("term-8", &id, "on it", None, 3).unwrap();
        assert_eq!(r["to"], "term:term-1");
        let boxes1 = m.boxes_of("term-1", &[]);
        let back = m.check("term-1", "term-1", &boxes1, Mode::Next, None, None, None).unwrap();
        assert_eq!(back["messages"][0]["threadId"], id.as_str());
        assert_eq!(back["messages"][0]["subject"], "Re: go");
        assert_eq!(back["messages"][0]["body"], "on it");
        assert_eq!(m.reply("term-8", "msg-99", "x", None, 4).unwrap_err().code, "not_found");
        assert_eq!(m.reply("term-8", &id, "x", Some("run-9"), 4).unwrap_err().code, "run_mismatch");
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
        let code = |t: &str, to: &str| dispatch_check(&tasks, &d, t, to, Some("term-1"), &agent).unwrap_err().code;
        assert_eq!(code("task-2", "term-5"), "task_waiting");
        assert_eq!(code("task-1", "term-1"), "own_pane");
        assert_eq!(code("task-1", "term-4"), "not_an_agent");
        assert_eq!(code("task-1", "term-6"), "busy");
        assert_eq!(code("task-7", "term-5"), "not_found");
        assert_eq!(dispatch_check(&tasks, &d, "task-1", "term-5", Some("term-1"), &agent).unwrap(), (0, "claude".to_string()));
        let b = brief(&tasks[0], &Brief { dispatch: "dispatch-2", run: Some("run-1"), coordinator: Some("term-1"), behind: None });
        assert!(b.contains("task-1") && b.contains("dispatch-2") && b.ends_with('a'), "{b}");
    }

    #[test]
    fn a_brief_says_how_to_report_ask_and_keep_in_touch() {
        let task = json!({ "id": "task-4", "spec": "Fix the login bug.\nThen run the tests." });
        let b = brief(&task, &Brief { dispatch: "dispatch-7", run: Some("run-2"), coordinator: Some("term-1"), behind: None });
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
        let b = brief(&task, &Brief { dispatch: "dispatch-7", run: None, coordinator: Some("term-1"), behind: Some((2, "main".into())) });
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
}
