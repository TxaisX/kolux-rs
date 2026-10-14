//! STAT-026 (T-025-c): what Kolux keeps about each pane's agent between hook events (COMPAT 3.5,
//! the stored-status table): the lead's own state, the tool waiting on a permission, the roster of
//! sub-agents and teammates, whether background work outlives the turn, the interrupted flag, the
//! last reply and the last twenty states. `hooks.rs` turns one event into a `Change`; this module
//! folds it into the pane's `Session` and resolves the state the window is shown.

use crate::hooks::{claude_change, codex_change, Change};
use serde_json::Value;
use std::collections::{HashMap, VecDeque};
use std::sync::atomic::{AtomicI64, Ordering};
use std::sync::Mutex;
use std::time::Duration;

/// STAT-001: no more than 32 child agents per report.
const MAX_CHILDREN: usize = 32;
const MAX_HISTORY: usize = 20;
/// T-123-c: how many of a turn's tool ids are kept to tell a new step from a killed tool's late report.
const MAX_TOOLS: usize = 256;
/// STAT-028: how long after Ctrl+C or Escape a turn with no Stop is taken as interrupted.
const CANCEL_GRACE_MS: u64 = 3000;
/// STAT-032: a working reading with no hook event for this long is marked unverified.
const UNVERIFIED_MS: u64 = 30 * 60 * 1000;
/// STAT-034: the states a program may print in band; anything else is dropped.
const INBAND_STATES: [&str; 5] = ["working", "done", "permission", "waiting", "idle"];

/// The unverified window; a debug build takes `KOLUX_UNVERIFIED_MS` so a live proof need not wait
/// half an hour.
fn unverified_ms() -> u64 {
    #[cfg(debug_assertions)]
    if let Some(ms) = std::env::var("KOLUX_UNVERIFIED_MS").ok().and_then(|v| v.parse().ok()) {
        return ms;
    }
    UNVERIFIED_MS
}
/// STAT-029: how Claude Code opens the message it submits itself after a compaction.
const CONTINUATION: &str = "This session is being continued from a previous conversation";

/// Every pane's stored status, by pane key. ponytail: in memory only; a restart starts clean
/// (STAT-006's catch-up is its own card).
pub static SESSIONS: Mutex<Option<HashMap<u32, Session>>> = Mutex::new(None);
/// When the usage window the status line last saw used up lifts (ms), 0 for none (STAT-040); a
/// limit stop carries it (STAT-022).
pub static LIMIT_RESETS_AT: AtomicI64 = AtomicI64::new(0);

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Agent {
    Claude,
    Codex,
}

/// A sub-agent or teammate under a lead session.
#[derive(Clone, Debug, PartialEq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Child {
    pub id: String,
    pub kind: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub model: Option<String>,
    pub state: &'static str,
    #[serde(skip)]
    pending: Option<String>,
    pub started: u64,
}

/// One line of the pane's history: the state it entered, the prompt that began the turn, when.
#[derive(Clone, Debug, PartialEq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Entry {
    pub state: &'static str,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub prompt: Option<String>,
    pub started: u64,
    pub interrupted: bool,
}

/// Why the lead is stopped (STAT-022): the cause, the agent's own words, and when a limit lifts
/// (milliseconds since the epoch; T-039-b fills it from the status line's figures).
#[derive(Clone, Debug, PartialEq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Stop {
    pub cause: &'static str,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub detail: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub resets_at: Option<u64>,
}

/// What the window is told after an event: the resolved state plus the roster.
#[derive(Clone, Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Status {
    pub pane_key: u32,
    pub terminal: Option<u32>,
    #[serde(flatten)]
    pub change: Change,
    pub children: Vec<Child>,
    /// Attached while the session is stopped on a limit, a sign-in or an error, until a later
    /// turn reaches done (STAT-022).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub stop: Option<Stop>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reply: Option<String>,
    /// The child whose turn just ended, so its reply is announced on its own (STAT-026).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub child: Option<String>,
    pub interrupted: bool,
    /// STAT-024: the turn is over but Claude Code's background tasks are still going.
    pub monitoring: bool,
}

#[derive(Default, Debug)]
pub struct Session {
    /// The terminal the pane's hooks last reported for, so a keystroke can find the session.
    pub terminal: Option<u32>,
    /// The lead's own last state; `None` when Kolux holds nothing for it yet.
    own: Option<&'static str>,
    /// The tool the lead is waiting on a permission for; cleared only when that tool resumes.
    pending: Option<String>,
    pub children: Vec<Child>,
    /// Claude Code's background tasks were still in flight at the last Stop (STAT-024).
    background: bool,
    /// Ctrl+C or Escape was typed while working: the next Stop reads interrupted (STAT-028).
    cancelled: bool,
    /// When that keystroke came (ms), so a turn that never sends its Stop settles anyway.
    cancelled_at: u64,
    /// The current turn ended on a cancel; late tool events cannot bring it back to working.
    interrupted: bool,
    /// The tool ids the lead has started this turn, newest last (T-123-c).
    tools: Vec<String>,
    /// The tool ids already started when the cancel keystroke came: their own late reports say
    /// nothing about the turn, while a tool id outside this list proves the turn went on (T-123-c).
    killed: Vec<String>,
    prompt: Option<String>,
    pub reply: Option<String>,
    /// The stop the session is blocked on, kept until a turn reaches done (STAT-022).
    pub stop: Option<Stop>,
    pub history: VecDeque<Entry>,
    /// The quiet alert already went out for this silent spell (STAT-045).
    quiet_fired: bool,
    /// When the last hook (or in-band) signal came (ms), 0 before the first (STAT-032).
    seen: u64,
    /// The working reading has had no signal for the unverified window; the next one clears it.
    unverified: bool,
}

/// What the window is told when a working agent has printed nothing for too long (STAT-045).
#[derive(Clone, Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Quiet {
    pub pane_key: u32,
    pub minutes: u64,
}

fn now_ms() -> u64 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0)
}

fn trim(s: &str, max: usize) -> String {
    s.chars().take(max).collect()
}

fn str_of<'a>(event: &'a Value, key: &str) -> Option<&'a str> {
    event.get(key).and_then(Value::as_str).filter(|s| !s.is_empty())
}

impl Session {
    /// The state the pane shows: a child waiting on Txais first, then the lead's own needs, then
    /// working while the lead, any child or background work is busy, else the lead's last state.
    pub fn resolved(&self) -> &'static str {
        if self.children.iter().any(|c| c.state == "permission") {
            return "permission";
        }
        if self.children.iter().any(|c| c.state == "waiting") {
            return "waiting";
        }
        match self.own {
            Some(s @ ("permission" | "waiting" | "blocked" | "interrupted")) => s,
            _ if self.own == Some("working") || self.background || self.children.iter().any(|c| c.state == "working") => "working",
            Some(s) => s,
            None => "working",
        }
    }

    /// STAT-024: the turn has settled while background tasks run on; Kolux is watching them.
    pub fn monitoring(&self) -> bool {
        self.background && self.own == Some("done") && !self.children.iter().any(|c| c.state == "working")
    }

    /// One tick of the quiet alert: `silent` says the terminal has been past the threshold. Fires
    /// once per silent spell, only while working; output or any other state re-arms it (STAT-045).
    pub fn quiet(&mut self, silent: bool) -> bool {
        let quiet = silent && self.resolved() == "working";
        let fire = quiet && !self.quiet_fired;
        self.quiet_fired = quiet;
        fire
    }

    fn reset(&mut self) {
        let terminal = self.terminal;
        let history = std::mem::take(&mut self.history);
        *self = Session { terminal, history, ..Session::default() };
    }

    /// Folds one event in and says what the window should be told, or `None` when nothing changed.
    pub fn apply(&mut self, agent: Agent, event: &Value) -> Option<(Change, Option<String>)> {
        let name = event.get("hook_event_name")?.as_str()?;
        self.signal();
        let before = self.resolved();
        let mut announce = None;
        match (name, str_of(event, "agent_id")) {
            ("SubagentStart", id) => {
                let id = id.unwrap_or_default().to_string();
                let kind = trim(str_of(event, "agent_type").unwrap_or("agent"), 40);
                let model = str_of(event, "model").map(|m| trim(m, 120));
                match self.children.iter_mut().find(|c| c.id == id) {
                    Some(c) => {
                        c.state = "working";
                        c.kind = kind;
                    }
                    None => {
                        if self.children.len() >= MAX_CHILDREN {
                            // ponytail: the cap drops the oldest settled child; a full roster of live ones ignores the newcomer.
                            let i = self.children.iter().position(|c| c.state != "working")?;
                            self.children.remove(i);
                        }
                        self.children.push(Child { id, kind, model, state: "working", pending: None, started: now_ms() });
                    }
                }
            }
            ("SubagentStop", id) => {
                let id = id.unwrap_or_default();
                // A child already cleared away never comes back; a known one is finished and announced.
                let i = self.children.iter().position(|c| c.id == id)?;
                let gone = self.children.remove(i);
                self.reply = str_of(event, "last_assistant_message").map(clean_reply);
                // Announced by role (what a notification names, STAT-041); the id when there is none.
                announce = Some(if gone.kind.is_empty() { gone.id } else { gone.kind });
            }
            ("TeammateIdle", id) => {
                let who = str_of(event, "teammate_name").or(id).unwrap_or_default();
                if let Some(c) = self.children.iter_mut().find(|c| c.id == who || c.kind == who) {
                    c.state = "idle";
                    c.pending = None;
                }
            }
            (_, Some(id)) => {
                // A sub-agent's own tool events move that child only (never a child already gone).
                let c = self.children.iter_mut().find(|c| c.id == id)?;
                let tool = str_of(event, "tool_name").map(|t| trim(t, 60));
                let change = match agent {
                    Agent::Claude => claude_change(&strip_agent(event)),
                    Agent::Codex => codex_change(&strip_agent(event)),
                }?;
                match name {
                    "PermissionRequest" => {
                        c.pending = tool;
                        c.state = "permission";
                    }
                    "PreToolUse" | "PostToolUse" | "PostToolUseFailure" => {
                        if c.state == "permission" && c.pending != tool {
                            return None;
                        }
                        c.pending = None;
                        c.state = change.state;
                    }
                    _ => return None,
                }
            }
            (_, None) => return self.apply_lead(agent, name, event),
        }
        let after = self.resolved();
        if after != before {
            self.remember(after);
        }
        Some((Change { state: after, ..Change::default() }, announce))
    }

    fn apply_lead(&mut self, agent: Agent, name: &str, event: &Value) -> Option<(Change, Option<String>)> {
        // An automatic compact changes nothing; its own Stop closes the turn (STAT-029).
        if (name == "PostCompact" && str_of(event, "trigger") != Some("manual")) || (name == "SessionStart" && str_of(event, "source") == Some("compact")) {
            return None;
        }
        // STAT-029: the continuation message Claude Code submits after a compaction is not a turn,
        // so the card keeps the user's last real prompt; a prompt that only quotes it later counts.
        if name == "UserPromptSubmit" && agent == Agent::Claude && str_of(event, "prompt").is_some_and(|p| p.trim_start().starts_with(CONTINUATION)) {
            return None;
        }
        // T-123-c: Ctrl+C on a draft or Escape on a menu leaves the turn running. A tool step whose id
        // the lead never reported before the cancel proves it: the cancel is dropped inside the grace,
        // and a settled interrupt is undone, its misread history line with it.
        if self.fresh_tool(name, event) {
            self.cancelled = false;
            if self.interrupted {
                self.interrupted = false;
                self.own = Some("working");
                if self.history.back().is_some_and(|e| e.state == "interrupted" && e.interrupted) {
                    self.history.pop_back();
                }
            }
        }
        // Late events after an interrupt cannot revive the turn (STAT-028), nor stop it (STAT-022).
        if self.interrupted && !matches!(name, "UserPromptSubmit" | "SessionStart" | "PostCompact") {
            return None;
        }
        let mut change = match agent {
            Agent::Claude => claude_change(event),
            Agent::Codex => codex_change(event),
        }?;
        let before = self.resolved();
        if change.boundary {
            self.reset();
        }
        match name {
            "UserPromptSubmit" => {
                self.prompt = change.prompt.clone();
                self.pending = None;
                self.interrupted = false;
                self.cancelled = false;
                self.tools.clear();
                self.killed.clear();
                self.reply = None;
                self.own = Some("working");
            }
            "Stop" => {
                self.interrupted = std::mem::take(&mut self.cancelled);
                self.pending = None;
                self.reply = str_of(event, "last_assistant_message").map(clean_reply);
                // STAT-024: Claude Code's own lists of background tasks and session crons decide.
                let busy = |k: &str| event.get(k).and_then(Value::as_array).is_some_and(|t| !t.is_empty());
                self.background = busy("background_tasks") || busy("session_crons");
                self.own = Some(if self.interrupted { "interrupted" } else { "done" });
                self.stop = None;
            }
            "StopFailure" => {
                self.pending = None;
                // A failure after a Kolux cancel is the interruption, not a stop (STAT-022).
                if std::mem::take(&mut self.cancelled) {
                    self.interrupted = true;
                    self.own = Some("interrupted");
                } else {
                    // One episode keeps the first report's words, however many reports arrive.
                    if self.own != Some("blocked") || self.stop.is_none() {
                        let cause = change.cause.unwrap_or("error");
                        let resets_at = (cause == "limit").then(|| LIMIT_RESETS_AT.load(Ordering::Relaxed)).filter(|t| *t > crate::claude_key::now_ms()).map(|t| t as u64);
                        self.stop = Some(Stop { cause, detail: change.detail.clone(), resets_at });
                    }
                    self.own = Some("blocked");
                }
            }
            "PermissionRequest" => {
                // A question asked as a permission waits instead, and clears on later tool work (STAT-027).
                self.pending = change.tool.clone();
                self.own = Some(change.state);
            }
            "PostCompact" => {
                // STAT-029: the compacted turn is labelled by its summary.
                self.prompt = str_of(event, "compact_summary").map(|s| trim(&s.split_whitespace().collect::<Vec<_>>().join(" "), 200));
                self.own = Some(change.state);
            }
            "PreToolUse" | "PostToolUse" | "PostToolUseFailure" => {
                // A pending permission clears only when that same tool carries on. The event names the
                // tool even where the outgoing change does not (PostToolUse), SAFE-007.
                if self.own == Some("permission") && self.pending != str_of(event, "tool_name").map(|t| trim(t, 60)) {
                    return None;
                }
                if name == "PreToolUse" {
                    if let Some(id) = str_of(event, "tool_use_id") {
                        if self.tools.len() >= MAX_TOOLS {
                            self.tools.remove(0);
                        }
                        self.tools.push(trim(id, 80));
                    }
                }
                self.pending = None;
                self.own = Some(change.state);
            }
            _ => self.own = Some(change.state),
        }
        let after = self.resolved();
        // A new turn is a history line of its own, even when the word stays working.
        if after != before || change.boundary || name == "UserPromptSubmit" {
            self.remember(after);
        }
        change.state = after;
        Some((change, None))
    }

    fn remember(&mut self, state: &'static str) {
        self.history.push_back(Entry { state, prompt: self.prompt.clone(), started: now_ms(), interrupted: self.interrupted });
        while self.history.len() > MAX_HISTORY {
            self.history.pop_front();
        }
    }

    /// Ctrl+C or Escape while the lead itself works: the coming Stop is an interruption. Nothing is
    /// concluded while a child or background work is still going (STAT-028).
    pub fn cancel(&mut self) {
        if self.own == Some("working") && !self.background && !self.children.iter().any(|c| c.state == "working") {
            self.cancelled = true;
            self.cancelled_at = now_ms();
            self.killed.clone_from(&self.tools);
        }
    }

    /// T-123-c: a tool step carrying an id the lead had not started when the cancel came. The killed
    /// tool reporting late carries an id on the list; a step with no id at all proves nothing.
    fn fresh_tool(&self, name: &str, event: &Value) -> bool {
        matches!(name, "PreToolUse" | "PostToolUse" | "PostToolUseFailure") && str_of(event, "tool_use_id").is_some_and(|id| !self.killed.iter().any(|k| k == id))
    }

    /// STAT-032: a genuine signal from the agent: the unverified mark lifts and the window restarts.
    fn signal(&mut self) {
        self.seen = now_ms();
        self.unverified = false;
    }

    /// STAT-032: a working reading with no signal for the whole window is marked unverified, once
    /// per silent spell; a settled turn (done, blocked, ...) never is.
    fn settle_unverified(&mut self, now: u64) -> bool {
        if self.unverified || self.seen == 0 || self.resolved() != "working" || now.saturating_sub(self.seen) < unverified_ms() {
            return false;
        }
        self.unverified = true;
        true
    }

    /// STAT-034: a state the program printed in band. Only the lead's own state moves: the reply,
    /// the stop, the roster and background work are hook knowledge and stay (an in-band done keeps
    /// monitoring going), while an in-band working is a new turn that undoes an interrupt.
    pub fn inband(&mut self, state: &'static str) -> Change {
        self.signal();
        let before = self.resolved();
        if state == "working" {
            self.cancelled = false;
            self.interrupted = false;
            self.tools.clear();
            self.killed.clear();
        }
        self.pending = None;
        self.own = Some(state);
        let after = self.resolved();
        if before != after {
            self.remember(after);
        }
        Change { state: after, ..Change::default() }
    }

    /// STAT-028: a cancel keystroke a while back and still no Stop: the turn was interrupted.
    fn settle_cancel(&mut self, now: u64) -> bool {
        if !self.cancelled || self.own != Some("working") || now.saturating_sub(self.cancelled_at) < CANCEL_GRACE_MS {
            return false;
        }
        self.cancelled = false;
        self.interrupted = true;
        self.pending = None;
        self.own = Some("interrupted");
        self.remember("interrupted");
        true
    }

    /// VIEW-025: the approval was answered from a card; the lead is working until its hooks say otherwise.
    pub fn answered(&mut self) {
        self.pending = None;
        if self.own == Some("permission") {
            self.own = Some("working");
            let now = self.resolved();
            self.remember(now);
        }
    }
}

/// VIEW-025: the keys that answer an approval at the agent's own prompt. Claude Code's dialog
/// takes Enter for its first option (Yes) and Esc for No; Codex's approval modal takes y and n.
pub fn answer_keys(agent: Agent, approve: bool) -> &'static str {
    match (agent, approve) {
        (Agent::Claude, true) => "\r",
        (Agent::Claude, false) => "\x1b",
        (Agent::Codex, true) => "y",
        (Agent::Codex, false) => "n",
    }
}

/// VIEW-025: approve or deny what `pane_key`'s agent is asking by typing the answer into its terminal.
#[tauri::command]
pub fn agent_answer(terminals: tauri::State<'_, crate::terminal::Terminals>, pane_key: u32, agent: String, approve: bool) -> Result<(), String> {
    let agent = match agent.as_str() {
        "claude" => Agent::Claude,
        "codex" => Agent::Codex,
        _ => return Err("not an agent pane".into()),
    };
    let terminal = with_sessions(|s| s.get(&pane_key).and_then(|x| x.terminal)).ok_or("no session for this pane")?;
    terminals.write(terminal, answer_keys(agent, approve))?;
    with_sessions(|s| {
        if let Some(x) = s.get_mut(&pane_key) {
            x.answered();
        }
    });
    Ok(())
}

/// STAT-025: Unicode line and paragraph separators become line breaks, and a run of blank lines
/// longer than two is cut to two.
fn clean_reply(s: &str) -> String {
    let s = s.replace(['\u{2028}', '\u{2029}'], "\n");
    let mut blank = 0;
    let lines: Vec<&str> = s
        .lines()
        .filter(|l| {
            blank = if l.trim().is_empty() { blank + 1 } else { 0 };
            blank <= 2
        })
        .collect();
    trim(lines.join("\n").trim(), 8000)
}

fn strip_agent(event: &Value) -> Value {
    let mut e = event.clone();
    if let Some(o) = e.as_object_mut() {
        o.remove("agent_id");
    }
    e
}

fn with_sessions<T>(f: impl FnOnce(&mut HashMap<u32, Session>) -> T) -> T {
    let mut guard = SESSIONS.lock().unwrap_or_else(|p| p.into_inner());
    f(guard.get_or_insert_with(HashMap::new))
}

/// SAFE-006: the most characters one status update carrying a plan may take.
pub const PLAN_STATUS_MAX: usize = 16_000;

/// SAFE-006: trims the plan to the longest prefix that keeps the whole update within
/// PLAN_STATUS_MAX characters and marks it cut; the one-line summary is never touched. When even an
/// empty plan would not fit, the plan is left out, so no review is offered.
pub fn fit_plan(mut s: Status) -> Status {
    let size = |s: &Status| serde_json::to_string(s).map_or(usize::MAX, |t| t.chars().count());
    if s.change.plan.is_none() || size(&s) <= PLAN_STATUS_MAX {
        return s;
    }
    let plan = s.change.plan.take().unwrap_or_default();
    let ends: Vec<usize> = plan.char_indices().map(|(i, _)| i).collect();
    s.change.plan_cut = true;
    let fits = |s: &mut Status, n: usize| {
        s.change.plan = Some(plan[..ends.get(n).copied().unwrap_or(plan.len())].to_string());
        size(s) <= PLAN_STATUS_MAX
    };
    if !fits(&mut s, 0) {
        s.change.plan = None;
        s.change.plan_cut = false;
        return s;
    }
    // The whole plan did not fit, so the longest fit is shorter than it; `lo` always fits.
    let (mut lo, mut hi) = (0, ends.len().saturating_sub(1));
    while lo < hi {
        let mid = (lo + hi).div_ceil(2);
        if fits(&mut s, mid) {
            lo = mid;
        } else {
            hi = mid - 1;
        }
    }
    fits(&mut s, lo);
    s
}

/// Folds an event into the pane's session and builds what the window is told.
pub fn report(pane_key: u32, terminal: Option<u32>, agent: Agent, event: &Value) -> Option<Status> {
    with_sessions(|s| {
        let session = s.entry(pane_key).or_default();
        session.terminal = terminal.or(session.terminal);
        let (change, child) = session.apply(agent, event)?;
        crate::activity::note(pane_key, change.state);
        Some(fit_plan(status_of(pane_key, terminal, session, change, child)))
    })
}

fn status_of(pane_key: u32, terminal: Option<u32>, session: &Session, change: Change, child: Option<String>) -> Status {
    Status { pane_key, terminal, change, children: session.children.clone(), stop: session.stop.clone(), reply: session.reply.clone(), child, interrupted: session.interrupted, monitoring: session.monitoring() }
}

/// STAT-028: the turns cancelled with Ctrl+C or Escape that never sent a Stop, now interrupted.
pub fn settle_cancels() -> Vec<Status> {
    let now = now_ms();
    with_sessions(|s| {
        s.iter_mut()
            .filter_map(|(key, session)| {
                session.settle_cancel(now).then(|| {
                    crate::activity::note(*key, "interrupted");
                    status_of(*key, session.terminal, session, Change { state: "interrupted", ..Change::default() }, None)
                })
            })
            .collect()
    })
}

/// The panes whose hooks last reported for `terminal`.
pub fn panes_of(terminal: u32) -> Vec<u32> {
    with_sessions(|s| s.iter().filter(|(_, x)| x.terminal == Some(terminal)).map(|(k, _)| *k).collect())
}

/// STAT-032: the panes whose working reading just went the whole window without a signal, each
/// once per spell; the payload names the window in minutes.
// Called from the lib.rs 2 s tick (T-124 hunk, RE-APPLY ON MERGE); drop the allow once that lands.
#[allow(dead_code)]
pub fn settle_unverified() -> Vec<Quiet> {
    let now = now_ms();
    let minutes = unverified_ms() / 60_000;
    with_sessions(|s| s.iter_mut().filter_map(|(key, session)| session.settle_unverified(now).then_some(Quiet { pane_key: *key, minutes })).collect())
}

/// STAT-034: the state an OSC 9999 payload carries: the whole sequence (ESC ] 9999 ; json, then
/// BEL or ESC \) or just the text after "9999;" as a terminal parser hands it over. A malformed
/// payload or an unknown state gives None.
pub fn parse_inband(bytes: &[u8]) -> Option<&'static str> {
    let body = bytes.strip_prefix(b"\x1b]").unwrap_or(bytes);
    let body = body.strip_prefix(b"9999;").unwrap_or(body);
    let body = body.strip_suffix(b"\x07").or_else(|| body.strip_suffix(b"\x1b\\")).unwrap_or(body);
    let v: Value = serde_json::from_slice(body).ok()?;
    let state = v.get("state").or_else(|| v.get("status"))?.as_str()?;
    INBAND_STATES.into_iter().find(|s| *s == state)
}

/// STAT-034: a status a program printed in band; the window's terminal parser hands the payload
/// over (and never draws the sequence). True when the pane's status moved.
// Listed in lib.rs's generate_handler (T-124 hunk, RE-APPLY ON MERGE); drop the allow once that lands.
#[allow(dead_code)]
#[tauri::command]
pub fn status_inband(app: tauri::AppHandle, pane_key: u32, data: String) -> bool {
    let Some(state) = parse_inband(data.as_bytes()) else {
        return false;
    };
    let status = with_sessions(|s| {
        let session = s.entry(pane_key).or_default();
        let change = session.inband(state);
        crate::activity::note(pane_key, change.state);
        status_of(pane_key, session.terminal, session, change, None)
    });
    tauri::Emitter::emit(&app, crate::hooks::EVENT, status).is_ok()
}

/// The terminal `pane_key`'s hooks last reported for.
pub fn terminal_of(pane_key: u32) -> Option<u32> {
    with_sessions(|s| s.get(&pane_key).and_then(|x| x.terminal))
}

/// CLI-025: the newest history entry's time and count across `terminal`'s panes, and whether one
/// is working; a prompt taken changes the first. None when no pane's hooks report for it.
pub fn activity(terminal: u32) -> Option<((u64, usize), bool)> {
    with_sessions(|s| {
        let panes: Vec<&Session> = s.values().filter(|x| x.terminal == Some(terminal)).collect();
        if panes.is_empty() {
            return None;
        }
        let newest = panes.iter().flat_map(|x| x.history.iter().map(|e| e.started)).max().unwrap_or(0);
        let count = panes.iter().map(|x| x.history.len()).sum();
        Some(((newest, count), panes.iter().any(|x| x.resolved() == "working")))
    })
}

/// CLI-025: the state `terminal` shows, the neediest of its panes' states; none when no pane's
/// hooks report for it.
pub fn state_of(terminal: u32) -> Option<&'static str> {
    const ORDER: [&str; 6] = ["permission", "waiting", "blocked", "interrupted", "working", "done"];
    with_sessions(|s| {
        s.values().filter(|x| x.terminal == Some(terminal)).map(Session::resolved).min_by_key(|r| ORDER.iter().position(|o| o == r).unwrap_or(ORDER.len()))
    })
}

/// The panes currently blocked on a usage limit (USAGE-007's pick-up when the switch goes on).
pub fn limit_stops() -> Vec<(u32, Stop)> {
    with_sessions(|s| s.iter().filter(|(_, x)| x.own == Some("blocked")).filter_map(|(k, x)| x.stop.clone().filter(|st| st.cause == "limit").map(|st| (*k, st))).collect())
}

/// A cancel keystroke typed into `terminal` (STAT-028).
pub fn cancel(terminal: u32) {
    with_sessions(|s| {
        for session in s.values_mut().filter(|x| x.terminal == Some(terminal)) {
            session.cancel();
        }
    });
}

/// STAT-045: the panes whose working agent has been silent for `threshold`, each once per spell;
/// `silence(terminal)` is how long since that terminal last wrote. `None` (the alert is off)
/// re-arms every session and fires nothing.
pub fn quiet_check(threshold: Option<Duration>, silence: impl Fn(u32) -> Option<Duration>) -> Vec<u32> {
    with_sessions(|s| {
        let mut fired = Vec::new();
        for (key, session) in s.iter_mut() {
            let silent = threshold.is_some_and(|t| session.terminal.and_then(&silence).is_some_and(|d| d >= t));
            if session.quiet(silent) {
                fired.push(*key);
            }
        }
        fired
    })
}


/// The pane's last twenty states, oldest first (COMPAT 3.5 stored status: History).
#[tauri::command]
pub fn agent_history(pane_key: u32) -> Vec<Entry> {
    with_sessions(|s| s.get(&pane_key).map(|x| x.history.iter().cloned().collect()).unwrap_or_default())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ev(json: &str) -> Value {
        serde_json::from_str(json).unwrap()
    }
    fn state(s: &mut Session, json: &str) -> Option<&'static str> {
        s.apply(Agent::Claude, &ev(json)).map(|(c, _)| c.state)
    }

    #[test]
    fn a_plan_too_long_for_one_status_is_cut_to_the_longest_fit_and_says_so() {
        // SAFE-006: the update carrying the plan stays within 16,000 characters; the summary stays.
        let status = |plan: &str, detail: &str, cut: bool| Status {
            pane_key: 1,
            terminal: Some(2),
            change: Change { state: "permission", tool: Some("ExitPlanMode".into()), detail: Some(detail.into()), plan: Some(plan.into()), plan_cut: cut, ..Change::default() },
            children: vec![],
            stop: None,
            reply: None,
            child: None,
            interrupted: false,
            monitoring: false,
        };
        let size = |s: &Status| serde_json::to_string(s).unwrap().chars().count();
        let long = "1. Read the é file. ".repeat(2000);
        assert_eq!(long.chars().count(), 40_000);
        let cut = fit_plan(status(&long, "Exit plan mode", false));
        let kept = cut.change.plan.clone().unwrap();
        assert!(cut.change.plan_cut && long.starts_with(&kept) && size(&cut) <= PLAN_STATUS_MAX);
        assert_eq!(cut.change.detail.as_deref(), Some("Exit plan mode"));
        assert!(serde_json::to_string(&cut).unwrap().contains(r#""planCut":true"#));
        let one_more: String = long.chars().take(kept.chars().count() + 1).collect();
        assert!(size(&status(&one_more, "Exit plan mode", true)) > PLAN_STATUS_MAX, "the longest fit");
        let short = fit_plan(status("# Plan", "Exit plan mode", false));
        assert_eq!((short.change.plan.as_deref(), short.change.plan_cut), (Some("# Plan"), false));
        assert!(!serde_json::to_string(&short).unwrap().contains("planCut"));
        let crowded = fit_plan(status("# Plan", &"x".repeat(PLAN_STATUS_MAX), false));
        assert_eq!((crowded.change.plan, crowded.change.plan_cut, crowded.change.detail.map(|d| d.len())), (None, false, Some(PLAN_STATUS_MAX)));
    }

    #[test]
    fn an_answer_from_a_card_clears_the_pending_permission_and_types_the_agents_own_keys() {
        let mut s = Session::default();
        assert_eq!(state(&mut s, r#"{"hook_event_name":"PermissionRequest","tool_name":"Write"}"#), Some("permission"));
        s.answered();
        assert_eq!(s.resolved(), "working");
        // Another tool carrying on is no longer refused as "a different tool than the pending one".
        assert_eq!(state(&mut s, r#"{"hook_event_name":"PreToolUse","tool_name":"Bash"}"#), Some("working"));
        assert_eq!(s.history.back().map(|e| e.state), Some("working"));
        assert_eq!((answer_keys(Agent::Claude, true), answer_keys(Agent::Claude, false)), ("\r", "\x1b"));
        assert_eq!((answer_keys(Agent::Codex, true), answer_keys(Agent::Codex, false)), ("y", "n"));
    }

    #[test]
    fn the_lead_stays_working_while_a_child_works_and_a_teammate_waiting_raises_needs_you() {
        let mut s = Session::default();
        assert_eq!(state(&mut s, r#"{"hook_event_name":"UserPromptSubmit","prompt":"review"}"#), Some("working"));
        assert_eq!(state(&mut s, r#"{"hook_event_name":"SubagentStart","agent_id":"a1","agent_type":"code-reviewer","model":"opus"}"#), Some("working"));
        assert_eq!((s.children[0].kind.as_str(), s.children[0].model.as_deref()), ("code-reviewer", Some("opus")));
        // The lead ends its turn: still working, the child is live.
        assert_eq!(state(&mut s, r#"{"hook_event_name":"Stop","last_assistant_message":"handed off"}"#), Some("working"));
        assert_eq!(s.reply.as_deref(), Some("handed off"));
        // The child asks for permission: needs you; unrelated progress by the lead does not clear it.
        assert_eq!(state(&mut s, r#"{"hook_event_name":"PermissionRequest","agent_id":"a1","tool_name":"Bash"}"#), Some("permission"));
        assert_eq!(state(&mut s, r#"{"hook_event_name":"PreToolUse","agent_id":"a1","tool_name":"Read"}"#), None);
        assert_eq!(s.resolved(), "permission");
        // The teammate goes idle: cleared, and the lead's done shows through... unless the lead is done: it is.
        assert_eq!(state(&mut s, r#"{"hook_event_name":"TeammateIdle","teammate_name":"a1"}"#), Some("done"));
        assert_eq!(s.children[0].state, "idle");
        // A teammate going idle never ends a working lead, even with nothing stored for it.
        let mut fresh = Session::default();
        fresh.apply(Agent::Claude, &ev(r#"{"hook_event_name":"SubagentStart","agent_id":"t1","agent_type":"tester"}"#));
        assert_eq!(state(&mut fresh, r#"{"hook_event_name":"TeammateIdle","teammate_name":"t1"}"#), Some("working"));
    }

    #[test]
    fn the_quiet_alert_fires_once_per_silent_spell_and_only_while_working() {
        let mut s = Session::default();
        assert_eq!(state(&mut s, r#"{"hook_event_name":"UserPromptSubmit","prompt":"go"}"#), Some("working"));
        assert!(s.quiet(true), "the first check over the threshold fires");
        assert!(!s.quiet(true), "the same silent spell fires nothing more");
        assert!(!s.quiet(false), "fresh output restarts the clock");
        assert!(s.quiet(true), "a new spell fires again");
        assert_eq!(state(&mut s, r#"{"hook_event_name":"Stop","last_assistant_message":"done"}"#), Some("done"));
        assert!(!s.quiet(true), "a finished agent is never quiet");
        assert_eq!(state(&mut s, r#"{"hook_event_name":"UserPromptSubmit","prompt":"more"}"#), Some("working"));
        assert!(s.quiet(true), "leaving working cancelled the spell, so the next turn's silence counts anew");
    }

    #[test]
    fn a_child_stop_announces_its_own_reply_and_a_gone_child_never_returns() {
        let mut s = Session::default();
        state(&mut s, r#"{"hook_event_name":"UserPromptSubmit","prompt":"go"}"#);
        state(&mut s, r#"{"hook_event_name":"SubagentStart","agent_id":"a1","agent_type":"worker"}"#);
        state(&mut s, r#"{"hook_event_name":"Stop"}"#);
        let (c, child) = s.apply(Agent::Claude, &ev(r#"{"hook_event_name":"SubagentStop","agent_id":"a1","agent_type":"worker","last_assistant_message":"child done"}"#)).unwrap();
        assert_eq!((c.state, child.as_deref(), s.reply.as_deref()), ("done", Some("worker"), Some("child done")));
        assert!(s.children.is_empty());
        // Late events from the finished child change nothing and do not re-add it.
        assert_eq!(state(&mut s, r#"{"hook_event_name":"PreToolUse","agent_id":"a1","tool_name":"Bash"}"#), None);
        assert_eq!(state(&mut s, r#"{"hook_event_name":"SubagentStop","agent_id":"a1"}"#), None);
        assert!(s.children.is_empty());
        // The roster is capped at 32 live children.
        for i in 0..40 {
            state(&mut s, &format!(r#"{{"hook_event_name":"SubagentStart","agent_id":"c{i}","agent_type":"w"}}"#));
        }
        assert_eq!(s.children.len(), MAX_CHILDREN);
    }

    #[test]
    fn a_failure_stops_the_session_with_its_cause_until_a_later_turn_finishes() {
        // STAT-022: the cause stays attached while blocked, a second report in the episode changes
        // nothing, and a turn that reaches done drops it.
        let mut s = Session::default();
        state(&mut s, r#"{"hook_event_name":"UserPromptSubmit","prompt":"go"}"#);
        assert_eq!(state(&mut s, r#"{"hook_event_name":"StopFailure","error":"rate_limit","error_details":"5-hour limit"}"#), Some("blocked"));
        assert_eq!(s.stop, Some(Stop { cause: "limit", detail: Some("5-hour limit".into()), resets_at: None }));
        // T-039-b: the reset time the status line last reported rides on a limit stop, when it is
        // still ahead; a stop for another cause never carries it.
        let ahead = crate::claude_key::now_ms() + 3_600_000;
        LIMIT_RESETS_AT.store(ahead, std::sync::atomic::Ordering::Relaxed);
        let mut t = Session::default();
        state(&mut t, r#"{"hook_event_name":"StopFailure","error":"rate_limit"}"#);
        assert_eq!(t.stop.as_ref().and_then(|x| x.resets_at), Some(ahead as u64));
        let mut t = Session::default();
        state(&mut t, r#"{"hook_event_name":"StopFailure","error":"server_error"}"#);
        assert_eq!(t.stop.as_ref().and_then(|x| x.resets_at), None);
        LIMIT_RESETS_AT.store(ahead - 7_200_000, std::sync::atomic::Ordering::Relaxed);
        let mut t = Session::default();
        state(&mut t, r#"{"hook_event_name":"StopFailure","error":"rate_limit"}"#);
        assert_eq!(t.stop.as_ref().and_then(|x| x.resets_at), None, "a reset already past is no reset");
        LIMIT_RESETS_AT.store(0, std::sync::atomic::Ordering::Relaxed);
        assert_eq!(state(&mut s, r#"{"hook_event_name":"StopFailure","error":"rate_limit"}"#), Some("blocked"));
        assert_eq!(s.stop.as_ref().map(|t| t.detail.as_deref()), Some(Some("5-hour limit")), "the first report's words stay");
        assert_eq!(s.history.iter().filter(|e| e.state == "blocked").count(), 1, "one episode, one history line");
        assert_eq!(state(&mut s, r#"{"hook_event_name":"UserPromptSubmit","prompt":"again"}"#), Some("working"));
        assert!(s.stop.is_some(), "still attached until the turn finishes");
        assert_eq!(state(&mut s, r#"{"hook_event_name":"Stop"}"#), Some("done"));
        assert_eq!(s.stop, None);
        // A failure report without an error attached, and one after a Kolux cancel, never stop the session.
        state(&mut s, r#"{"hook_event_name":"UserPromptSubmit","prompt":"more"}"#);
        assert_eq!(state(&mut s, r#"{"hook_event_name":"StopFailure"}"#), None);
        assert_eq!(s.resolved(), "working");
        s.cancel();
        assert_eq!(state(&mut s, r#"{"hook_event_name":"StopFailure","error":"server_error"}"#), Some("interrupted"));
        assert_eq!(s.stop, None);
        // A sign-in failure reads as such, and a session boundary forgets the stop.
        state(&mut s, r#"{"hook_event_name":"UserPromptSubmit","prompt":"x"}"#);
        state(&mut s, r#"{"hook_event_name":"StopFailure","error":"authentication_failed"}"#);
        assert_eq!(s.stop.as_ref().map(|t| t.cause), Some("signin"));
        state(&mut s, r#"{"hook_event_name":"SessionStart","source":"startup"}"#);
        assert_eq!(s.stop, None);
    }

    #[test]
    fn stop_after_a_kolux_cancel_reads_interrupted_and_late_events_cannot_revive_it() {
        let mut s = Session::default();
        state(&mut s, r#"{"hook_event_name":"UserPromptSubmit","prompt":"long job"}"#);
        state(&mut s, r#"{"hook_event_name":"PreToolUse","tool_name":"Bash"}"#);
        s.cancel();
        assert_eq!(state(&mut s, r#"{"hook_event_name":"Stop"}"#), Some("interrupted"));
        assert_eq!(state(&mut s, r#"{"hook_event_name":"PostToolUse","tool_name":"Bash"}"#), None);
        assert_eq!(s.resolved(), "interrupted");
        // A new prompt starts a clean turn that ends done.
        assert_eq!(state(&mut s, r#"{"hook_event_name":"UserPromptSubmit","prompt":"again"}"#), Some("working"));
        assert_eq!(state(&mut s, r#"{"hook_event_name":"Stop"}"#), Some("done"));
        // No cancel is concluded while a child is still working.
        state(&mut s, r#"{"hook_event_name":"UserPromptSubmit","prompt":"team"}"#);
        state(&mut s, r#"{"hook_event_name":"SubagentStart","agent_id":"k","agent_type":"w"}"#);
        s.cancel();
        assert_eq!(state(&mut s, r#"{"hook_event_name":"SubagentStop","agent_id":"k"}"#), Some("working"));
        assert_eq!(state(&mut s, r#"{"hook_event_name":"Stop"}"#), Some("done"));
        let states: Vec<_> = s.history.iter().map(|e| (e.state, e.interrupted)).collect();
        assert_eq!(states, [("working", false), ("interrupted", true), ("working", false), ("done", false), ("working", false), ("done", false)]);
        assert_eq!(s.history[0].prompt.as_deref(), Some("long job"));
    }

    #[test]
    fn a_plan_approved_in_the_terminal_ends_the_wait_when_its_tool_finishes() {
        // SAFE-007: Claude's PostToolUse names its tool, so the plan's own wait ends there.
        let mut s = Session::default();
        state(&mut s, r#"{"hook_event_name":"UserPromptSubmit","prompt":"plan it"}"#);
        assert_eq!(state(&mut s, r#"{"hook_event_name":"PermissionRequest","tool_name":"ExitPlanMode","tool_input":{"plan":"1. a"}}"#), Some("permission"));
        assert_eq!(state(&mut s, r#"{"hook_event_name":"PostToolUse","tool_name":"Read"}"#), None);
        assert_eq!(state(&mut s, r#"{"hook_event_name":"PostToolUse","tool_name":"ExitPlanMode","tool_input":{"plan":"1. a"}}"#), Some("working"));
    }

    #[test]
    fn a_permission_clears_only_when_the_same_tool_resumes_and_background_work_keeps_working() {
        let mut s = Session::default();
        state(&mut s, r#"{"hook_event_name":"UserPromptSubmit","prompt":"edit"}"#);
        assert_eq!(state(&mut s, r#"{"hook_event_name":"PermissionRequest","tool_name":"Write"}"#), Some("permission"));
        assert_eq!(state(&mut s, r#"{"hook_event_name":"PostToolUse","tool_name":"Read"}"#), None);
        assert_eq!(state(&mut s, r#"{"hook_event_name":"PreToolUse","tool_name":"Write"}"#), Some("working"));
        // Background shells outlive the turn: working until a Stop with none in flight.
        assert_eq!(state(&mut s, r#"{"hook_event_name":"Stop","background_tasks":[{"id":"b1","type":"shell","status":"running","description":"npm test"}]}"#), Some("working"));
        assert_eq!(state(&mut s, r#"{"hook_event_name":"Stop","background_tasks":[]}"#), Some("done"));
        // The prompt Claude re-submits after an automatic compact is not a new turn.
        assert_eq!(state(&mut s, r#"{"hook_event_name":"PostCompact","trigger":"auto"}"#), None);
        assert_eq!(state(&mut s, r#"{"hook_event_name":"UserPromptSubmit","prompt":"This session is being continued from a previous conversation that ran out of context."}"#), None);
        assert_eq!(state(&mut s, r#"{"hook_event_name":"UserPromptSubmit","prompt":"real"}"#), Some("working"));
        assert_eq!(s.history.len(), 5);
        for _ in 0..30 {
            state(&mut s, r#"{"hook_event_name":"Stop"}"#);
            state(&mut s, r#"{"hook_event_name":"UserPromptSubmit","prompt":"x"}"#);
        }
        assert_eq!(s.history.len(), MAX_HISTORY);
    }

    #[test]
    fn codex_children_follow_their_own_tool_events() {
        let mut s = Session::default();
        s.apply(Agent::Codex, &ev(r#"{"hook_event_name":"SessionStart"}"#));
        s.apply(Agent::Codex, &ev(r#"{"hook_event_name":"SubagentStart","agent_id":"x","agent_type":"explorer","model":"gpt-5"}"#));
        let c = |s: &mut Session, j: &str| s.apply(Agent::Codex, &ev(j)).map(|(c, _)| c.state);
        assert_eq!(c(&mut s, r#"{"hook_event_name":"Stop"}"#), Some("working"));
        assert_eq!(c(&mut s, r#"{"hook_event_name":"PreToolUse","agent_id":"x","tool_name":"request_user_input"}"#), Some("waiting"));
        assert_eq!(c(&mut s, r#"{"hook_event_name":"PostToolUse","agent_id":"x","tool_name":"request_user_input"}"#), Some("working"));
        assert_eq!(c(&mut s, r#"{"hook_event_name":"SubagentStop","agent_id":"x"}"#), Some("done"));
        // A boundary wipes the roster.
        s.apply(Agent::Codex, &ev(r#"{"hook_event_name":"SubagentStart","agent_id":"y","agent_type":"w"}"#));
        c(&mut s, r#"{"hook_event_name":"SessionStart"}"#);
        assert!(s.children.is_empty());
    }

    #[test]
    fn stat_024_background_work_after_the_turn_is_monitoring_until_its_list_empties() {
        let mut s = Session::default();
        state(&mut s, r#"{"hook_event_name":"UserPromptSubmit","prompt":"run the soak test"}"#);
        assert!(!s.monitoring(), "a turn still going is working, not monitoring");
        assert_eq!(state(&mut s, r#"{"hook_event_name":"Stop","background_tasks":[{"id":"b1","type":"shell","status":"running","command":"npm run soak"}]}"#), Some("working"));
        assert!(s.monitoring(), "the turn settled while the shell runs on");
        // A scheduled session task keeps it watched too.
        assert_eq!(state(&mut s, r#"{"hook_event_name":"Stop","background_tasks":[],"session_crons":[{"id":"c1","schedule":"0 9 * * 1-5","recurring":true,"prompt":"check"}]}"#), Some("working"));
        assert!(s.monitoring());
        // Work woken by the background task is a turn of its own, not monitoring.
        assert_eq!(state(&mut s, r#"{"hook_event_name":"PreToolUse","tool_name":"Bash","tool_input":{"command":"cat soak.log"}}"#), Some("working"));
        assert!(!s.monitoring());
        assert_eq!(state(&mut s, r#"{"hook_event_name":"Stop","background_tasks":[],"session_crons":[]}"#), Some("done"));
        assert!(!s.monitoring());
        // No cancel is concluded while background work runs (STAT-028).
        state(&mut s, r#"{"hook_event_name":"Stop","background_tasks":[{"id":"b2","type":"shell","status":"running"}]}"#);
        s.cancel();
        assert!(!s.settle_cancel(now_ms() + CANCEL_GRACE_MS));
    }

    #[test]
    fn stat_025_the_reply_keeps_line_breaks_and_shortens_blank_runs_and_list_tools_show_no_input() {
        let mut s = Session::default();
        state(&mut s, r#"{"hook_event_name":"UserPromptSubmit","prompt":"fix it"}"#);
        let (c, _) = s.apply(Agent::Claude, &ev(r#"{"hook_event_name":"PreToolUse","tool_name":"Edit","tool_input":{"file_path":"src/main.rs","old_string":"a","new_string":"b"}}"#)).unwrap();
        assert_eq!((c.tool.as_deref(), c.detail.as_deref()), (Some("Edit"), Some("src/main.rs")));
        let (c, _) = s.apply(Agent::Claude, &ev(r#"{"hook_event_name":"PreToolUse","tool_name":"TodoWrite","tool_input":{"todos":[{"content":"secret plan step"}]}}"#)).unwrap();
        assert_eq!((c.tool.as_deref(), c.detail), (Some("TodoWrite"), None));
        let reply = format!("Fixed.\u{2028}Tests pass.\u{2029}Next{}end", "\n".repeat(11));
        let stop = serde_json::json!({"hook_event_name":"Stop","last_assistant_message":reply});
        s.apply(Agent::Claude, &stop);
        assert_eq!(s.reply.as_deref(), Some("Fixed.\nTests pass.\nNext\n\n\nend"));
    }

    #[test]
    fn stat_027_waiting_carries_the_plan_or_the_question_and_clears_when_tool_work_resumes() {
        let mut s = Session::default();
        state(&mut s, r#"{"hook_event_name":"UserPromptSubmit","prompt":"plan the refactor"}"#);
        let (c, _) = s.apply(Agent::Claude, &ev(r#"{"hook_event_name":"PreToolUse","tool_name":"ExitPlanMode","tool_input":{"plan":"Refactor auth\n1. Extract the token check"}}"#)).unwrap();
        assert_eq!((c.state, c.ask.as_deref(), c.detail.as_deref()), ("waiting", Some("Refactor auth\n1. Extract the token check"), Some("Refactor auth")));
        assert_eq!(state(&mut s, r#"{"hook_event_name":"PreToolUse","tool_name":"Edit","tool_input":{"file_path":"auth.rs"}}"#), Some("working"));
        // A question asked as a permission waits, and clears on any later tool step.
        let (c, _) = s.apply(Agent::Claude, &ev(r#"{"hook_event_name":"PermissionRequest","tool_name":"AskUserQuestion","tool_input":{"questions":[{"question":"Which framework?","header":"Framework","options":[]}]}}"#)).unwrap();
        assert_eq!((c.state, c.ask.as_deref()), ("waiting", Some("Which framework?")));
        assert_eq!(state(&mut s, r#"{"hook_event_name":"PostToolUse","tool_name":"Read"}"#), Some("working"));
        // A real permission still waits for its own tool.
        assert_eq!(state(&mut s, r#"{"hook_event_name":"PermissionRequest","tool_name":"Bash","tool_input":{"command":"rm -rf build"}}"#), Some("permission"));
        assert_eq!(state(&mut s, r#"{"hook_event_name":"PostToolUse","tool_name":"Read"}"#), None);
        // A plan past the limit is cut and says so.
        let long = serde_json::json!({"hook_event_name":"PreToolUse","tool_name":"ExitPlanMode","tool_input":{"plan":"x".repeat(9000)}});
        let ask = crate::hooks::claude_change(&long).unwrap().ask.unwrap();
        assert!(ask.ends_with("… (cut)") && ask.chars().count() == 8000 + "\n… (cut)".chars().count());
    }

    #[test]
    fn stat_028_a_cancel_with_no_stop_settles_interrupted_and_late_events_cannot_revive_it() {
        let mut s = Session::default();
        state(&mut s, r#"{"hook_event_name":"UserPromptSubmit","prompt":"long job"}"#);
        s.cancel();
        assert!(!s.settle_cancel(s.cancelled_at + CANCEL_GRACE_MS - 1), "the Stop gets its moment first");
        assert!(s.settle_cancel(s.cancelled_at + CANCEL_GRACE_MS));
        assert_eq!((s.resolved(), s.interrupted), ("interrupted", true));
        assert!(!s.settle_cancel(u64::MAX), "settled once");
        assert_eq!(state(&mut s, r#"{"hook_event_name":"PreToolUse","tool_name":"Bash"}"#), None);
        assert_eq!(state(&mut s, r#"{"hook_event_name":"Stop"}"#), None);
        assert_eq!(s.resolved(), "interrupted");
        assert_eq!(s.history.back().map(|e| (e.state, e.interrupted)), Some(("interrupted", true)));
    }

    #[test]
    fn stat_028_rest_a_tool_step_after_a_draft_clearing_cancel_keeps_the_turn_working() {
        // T-123-c: Ctrl+C on a non-empty input box only clears the draft (Esc also closes menus), so the
        // turn goes on. A tool step the lead never reported before the cancel proves it inside the grace.
        let mut s = Session::default();
        state(&mut s, r#"{"hook_event_name":"UserPromptSubmit","prompt":"long build"}"#);
        state(&mut s, r#"{"hook_event_name":"PreToolUse","tool_name":"Bash","tool_use_id":"tu1"}"#);
        s.cancel();
        // (c) the tool that started before the cancel reporting back says nothing about the turn.
        assert_eq!(state(&mut s, r#"{"hook_event_name":"PostToolUse","tool_name":"Bash","tool_use_id":"tu1"}"#), Some("working"));
        assert!(s.cancelled, "the killed tool's own report cannot clear the cancel");
        // (a) a new tool step inside the grace clears the cancel; nothing settles and the Stop is a plain done.
        assert_eq!(state(&mut s, r#"{"hook_event_name":"PreToolUse","tool_name":"Read","tool_use_id":"tu2"}"#), Some("working"));
        assert!(!s.cancelled);
        assert!(!s.settle_cancel(u64::MAX), "nothing left to settle");
        assert_eq!(state(&mut s, r#"{"hook_event_name":"Stop"}"#), Some("done"));
        assert!(!s.interrupted);
    }

    #[test]
    fn stat_028_rest_a_settled_interrupt_is_undone_by_a_tool_step_it_never_saw_before_the_cancel() {
        // T-123-c: prompt, Ctrl+C on a draft, a Bash step longer than the grace: the settle reads
        // interrupted, then the PreToolUse at +5 s revives the turn and its Stop reads done.
        let mut s = Session::default();
        state(&mut s, r#"{"hook_event_name":"UserPromptSubmit","prompt":"long build"}"#);
        state(&mut s, r#"{"hook_event_name":"PreToolUse","tool_name":"Bash","tool_use_id":"tu1"}"#);
        s.cancel();
        assert!(s.settle_cancel(s.cancelled_at + 5_000));
        assert_eq!(s.resolved(), "interrupted");
        // (c) the pre-cancel tool reporting late stays ignored, settled or not.
        assert_eq!(state(&mut s, r#"{"hook_event_name":"PostToolUse","tool_name":"Bash","tool_use_id":"tu1"}"#), None);
        assert_eq!(state(&mut s, r#"{"hook_event_name":"PostToolUseFailure","tool_name":"Bash","tool_use_id":"tu1","error":"killed"}"#), None);
        assert_eq!((s.resolved(), s.interrupted), ("interrupted", true));
        // A step with no id at all is not proof of a new tool (the late-event rule keeps it out).
        assert_eq!(state(&mut s, r#"{"hook_event_name":"PreToolUse","tool_name":"Bash"}"#), None);
        // (b) a tool id never seen before the cancel revives the turn to working; the misread line is dropped.
        assert_eq!(state(&mut s, r#"{"hook_event_name":"PreToolUse","tool_name":"Read","tool_use_id":"tu2"}"#), Some("working"));
        assert_eq!((s.resolved(), s.interrupted, s.cancelled), ("working", false, false));
        assert_eq!(state(&mut s, r#"{"hook_event_name":"PostToolUse","tool_name":"Read","tool_use_id":"tu2"}"#), Some("working"));
        assert_eq!(state(&mut s, r#"{"hook_event_name":"Stop","last_assistant_message":"built"}"#), Some("done"));
        assert_eq!(s.reply.as_deref(), Some("built"));
        let states: Vec<_> = s.history.iter().map(|e| (e.state, e.interrupted)).collect();
        assert_eq!(states, [("working", false), ("done", false)], "one turn, never interrupted");
        // A second cancel in the same turn takes every tool seen so far as in flight: a later Post for tu2 proves nothing.
        state(&mut s, r#"{"hook_event_name":"UserPromptSubmit","prompt":"again"}"#);
        state(&mut s, r#"{"hook_event_name":"PreToolUse","tool_name":"Bash","tool_use_id":"tu3"}"#);
        s.cancel();
        assert_eq!(state(&mut s, r#"{"hook_event_name":"PostToolUse","tool_name":"Bash","tool_use_id":"tu3"}"#), Some("working"));
        assert!(s.cancelled);
        assert_eq!(state(&mut s, r#"{"hook_event_name":"Stop"}"#), Some("interrupted"), "a Stop while the cancel stands is still an interruption");
    }

    #[test]
    fn stat_032_a_working_reading_with_no_signal_for_the_window_is_unverified_until_the_next_one() {
        let mut s = Session::default();
        assert!(!s.settle_unverified(u64::MAX), "nothing reported yet is nothing to doubt");
        assert_eq!(state(&mut s, r#"{"hook_event_name":"UserPromptSubmit","prompt":"go"}"#), Some("working"));
        let seen = s.seen;
        assert!(!s.settle_unverified(seen + UNVERIFIED_MS - 1), "inside the window the reading holds");
        assert!(s.settle_unverified(seen + UNVERIFIED_MS), "30 minutes of silence marks it");
        assert!(!s.settle_unverified(seen + 2 * UNVERIFIED_MS), "once per silent spell");
        // The next genuine signal brings the row back to life and restarts the window.
        assert_eq!(state(&mut s, r#"{"hook_event_name":"PreToolUse","tool_name":"Bash","tool_use_id":"t1"}"#), Some("working"));
        assert!(!s.unverified);
        assert!(!s.settle_unverified(s.seen + UNVERIFIED_MS - 1));
        assert!(s.settle_unverified(s.seen + UNVERIFIED_MS));
        // A settled turn is never doubted, however long it sits.
        assert_eq!(state(&mut s, r#"{"hook_event_name":"Stop","last_assistant_message":"ok"}"#), Some("done"));
        assert!(!s.settle_unverified(s.seen + 10 * UNVERIFIED_MS));
        assert_eq!(UNVERIFIED_MS, 30 * 60 * 1000);
    }

    #[test]
    fn stat_034_an_in_band_status_moves_the_pane_without_erasing_what_only_hooks_know() {
        // The byte sequence a script prints: ESC ] 9999 ; payload BEL, or ESC \ as the terminator.
        assert_eq!(parse_inband(b"\x1b]9999;{\"state\":\"working\"}\x07"), Some("working"));
        assert_eq!(parse_inband(b"\x1b]9999;{\"status\":\"done\"}\x1b\\"), Some("done"));
        // What xterm's OSC handler hands over is the text after "9999;".
        assert_eq!(parse_inband(b"{\"state\":\"permission\"}"), Some("permission"));
        assert_eq!(parse_inband(b"\x1b]9999;{\"state\":\"working\"\x07"), None, "malformed payload");
        assert_eq!(parse_inband(b"\x1b]9999;{\"state\":\"exploding\"}\x07"), None, "unknown state");
        assert_eq!(parse_inband(b"\x1b]9999;plain text\x07"), None);

        let mut s = Session::default();
        assert_eq!(state(&mut s, r#"{"hook_event_name":"UserPromptSubmit","prompt":"go"}"#), Some("working"));
        assert_eq!(state(&mut s, r#"{"hook_event_name":"Stop","last_assistant_message":"built","background_tasks":[{"id":"b1","type":"shell","status":"running","description":"npm test"}]}"#), Some("working"));
        assert!(s.monitoring());
        // An in-band done keeps the monitoring, the reply and the stored roster.
        assert_eq!(s.inband("done").state, "working");
        assert!(s.monitoring(), "monitoring is hook knowledge; the in-band done does not end it");
        assert_eq!(s.reply.as_deref(), Some("built"));
        // An in-band working is a new turn: it undoes an interrupt and reads working.
        s.own = Some("working");
        s.background = false;
        s.cancel();
        assert!(s.settle_cancel(s.cancelled_at + CANCEL_GRACE_MS));
        assert_eq!(s.resolved(), "interrupted");
        assert_eq!(s.inband("working").state, "working");
        assert!(!s.interrupted);
        assert_eq!(s.history.back().map(|e| e.state), Some("working"));
        // A state change is remembered once; the same state again is not.
        let len = s.history.len();
        assert_eq!(s.inband("working").state, "working");
        assert_eq!(s.history.len(), len);
        assert_eq!(s.inband("waiting").state, "waiting");
        assert_eq!(s.history.len(), len + 1);
    }

    #[test]
    fn stat_029_boundaries_settle_quietly_and_the_compact_summary_labels_the_turn() {
        let mut s = Session::default();
        state(&mut s, r#"{"hook_event_name":"UserPromptSubmit","prompt":"build it"}"#);
        state(&mut s, r#"{"hook_event_name":"Stop","last_assistant_message":"built"}"#);
        // /clear is a boundary: done, and the finished turn stays in history.
        let (c, _) = s.apply(Agent::Claude, &ev(r#"{"hook_event_name":"SessionStart","source":"clear"}"#)).unwrap();
        assert!(c.boundary && c.state == "done");
        assert!(s.history.iter().any(|e| e.state == "done" && e.prompt.as_deref() == Some("build it")));
        // A manual compact settles a row stuck on working into a quiet done, labelled by its summary.
        state(&mut s, r#"{"hook_event_name":"UserPromptSubmit","prompt":"stuck"}"#);
        let (c, _) = s.apply(Agent::Claude, &ev(r#"{"hook_event_name":"PostCompact","trigger":"manual","compact_summary":"Refactored the auth\n module."}"#)).unwrap();
        assert!(c.boundary && c.state == "done");
        assert_eq!(s.history.back().and_then(|e| e.prompt.as_deref()), Some("Refactored the auth module."));
        // The continuation Claude submits after compacting is not a turn; a prompt quoting it later is.
        state(&mut s, r#"{"hook_event_name":"UserPromptSubmit","prompt":"real prompt"}"#);
        assert_eq!(state(&mut s, r#"{"hook_event_name":"UserPromptSubmit","prompt":"  This session is being continued from a previous conversation that ran out of context."}"#), None);
        assert_eq!(s.prompt.as_deref(), Some("real prompt"));
        assert_eq!(state(&mut s, r#"{"hook_event_name":"UserPromptSubmit","prompt":"why does it say This session is being continued from a previous conversation?"}"#), Some("working"));
        // Codex has no such message: the same words from Codex are a prompt.
        let mut x = Session::default();
        let codex = x.apply(Agent::Codex, &ev(r#"{"hook_event_name":"UserPromptSubmit","prompt":"This session is being continued from a previous conversation"}"#));
        assert_eq!(codex.map(|(c, _)| c.state), Some("working"));
    }
}
