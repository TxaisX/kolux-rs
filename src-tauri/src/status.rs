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
    /// The current turn ended on a cancel; late tool events cannot bring it back to working.
    interrupted: bool,
    /// The next UserPromptSubmit is the automatic continuation after a compact: ignored.
    skip_prompt: bool,
    prompt: Option<String>,
    pub reply: Option<String>,
    /// The stop the session is blocked on, kept until a turn reaches done (STAT-022).
    pub stop: Option<Stop>,
    pub history: VecDeque<Entry>,
    /// The quiet alert already went out for this silent spell (STAT-045).
    quiet_fired: bool,
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
                self.reply = str_of(event, "last_assistant_message").map(|m| trim(m, 8000));
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
        // An automatic compact changes nothing, but the prompt Claude re-submits after it is not a turn.
        if (name == "PostCompact" && str_of(event, "trigger") != Some("manual")) || (name == "SessionStart" && str_of(event, "source") == Some("compact")) {
            self.skip_prompt = true;
            return None;
        }
        if name == "UserPromptSubmit" && std::mem::take(&mut self.skip_prompt) {
            return None;
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
                self.reply = None;
                self.own = Some("working");
            }
            "Stop" => {
                self.interrupted = std::mem::take(&mut self.cancelled);
                self.pending = None;
                self.reply = str_of(event, "last_assistant_message").map(|m| trim(m, 8000));
                self.background = event.get("background_tasks").and_then(Value::as_array).is_some_and(|t| !t.is_empty());
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
                self.pending = change.tool.clone();
                self.own = Some("permission");
            }
            "PreToolUse" | "PostToolUse" | "PostToolUseFailure" => {
                // A pending permission clears only when that same tool carries on.
                if self.own == Some("permission") && self.pending != change.tool {
                    return None;
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
        }
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
        Some(fit_plan(Status { pane_key, terminal, change, children: session.children.clone(), stop: session.stop.clone(), reply: session.reply.clone(), child, interrupted: session.interrupted }))
    })
}

/// The panes whose hooks last reported for `terminal`.
pub fn panes_of(terminal: u32) -> Vec<u32> {
    with_sessions(|s| s.iter().filter(|(_, x)| x.terminal == Some(terminal)).map(|(k, _)| *k).collect())
}

/// The terminal `pane_key`'s hooks last reported for.
pub fn terminal_of(pane_key: u32) -> Option<u32> {
    with_sessions(|s| s.get(&pane_key).and_then(|x| x.terminal))
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
        assert_eq!(state(&mut s, r#"{"hook_event_name":"UserPromptSubmit","prompt":"<continuation>"}"#), None);
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
}
