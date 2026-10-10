//! Orchestration mail (ORCH-001, ORCH-002, ORCH-003, ORCH-005): Runs, which pane is tied to which
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
pub fn caller_of(from: Option<&str>, pane: Option<(&str, &str)>, verify: &dyn Fn(&str, &str) -> bool, live: &dyn Fn(&str) -> bool) -> Result<Option<String>, Fail> {
    if let Some(h) = from.map(str::trim).filter(|h| !h.is_empty()) {
        return if live(h) { Ok(Some(h.to_string())) } else { Err(Fail::new("not_found", format!("no open Kolux terminal is called {h}"))) };
    }
    Ok(pane.filter(|(h, k)| verify(h, k)).map(|(h, _)| h.to_string()))
}

fn finished(d: &Value) -> bool {
    FINISHED.contains(&d["status"].as_str().unwrap_or_default())
}

fn terminal_of(d: &Value) -> Option<String> {
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
        let verify = |h: &str, k: &str| h == "term-1" && k == "s3cret";
        assert_eq!(caller_of(None, Some(("term-1", "s3cret")), &verify, &live).unwrap().as_deref(), Some("term-1"));
        assert_eq!(caller_of(None, Some(("term-1", "guess")), &verify, &live).unwrap(), None);
        assert_eq!(caller_of(None, None, &verify, &live).unwrap(), None);
        assert_eq!(caller_of(Some("term-4"), None, &verify, &live).unwrap().as_deref(), Some("term-4"));
        assert_eq!(caller_of(Some("nope"), None, &verify, &live).unwrap_err().code, "not_found");
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
}
