//! STAT-006 / STAT-030 / STAT-037 (T-167-a): what the hooks reported, kept across a restart.
//! Every pane's last status is saved (with a version; rows past their expiry are dropped, and a
//! damaged save reads as empty). At the next start the save becomes this run's "restored" rows,
//! the events a hook could not deliver while Kolux was closed (the holding file the hook script
//! appends to) are folded onto them, and the result is saved again. Live sessions start fresh, so
//! a restored permission never blocks the first live event. At quit the agents that can still be
//! resumed (working, waiting on the user, or stopped on a limit, with their provider session id)
//! are recorded for every worktree, and a workspace's are recorded when it is put to sleep
//! (T-167-b). Showing restored rows on their panes, unconfirmed, is still open on T-167-b.

use super::super::identity;
use crate::status::{Agent, Session, Status};
use serde_json::Value;
use std::collections::HashMap;
use std::path::Path;
use std::sync::Mutex;

/// The state-store key holding the panes' last statuses.
pub const SAVED_KEY: &str = "agentStatusSaved";
/// The state-store key holding the agents that can be resumed, written at quit (STAT-037).
pub const RESUMABLE_KEY: &str = "agentResumable";
/// The holding file beside the endpoint file (`ENDPOINT_FILE`); the hook script appends one line
/// per event it could not deliver.
pub const SPOOL_FILE: &str = "agent-hooks-spool.txt";
pub const VERSION: u32 = 1;
/// A saved status older than this is not restored.
pub const EXPIRY_MS: u64 = 24 * 3600 * 1000;
/// A holding file larger than this is dropped unread.
const SPOOL_MAX: u64 = 32 << 20;

/// One pane's last status.
#[derive(Clone, Debug, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Row {
    pub pane_key: u32,
    pub agent: String,
    pub state: String,
    /// When the pane entered `state` (ms since the epoch).
    pub at: u64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub session_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cwd: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub stop: Option<Value>,
}

#[derive(serde::Serialize, serde::Deserialize)]
struct Saved {
    version: u32,
    rows: Vec<Row>,
}

/// This run's rows, by pane.
static LIVE: Mutex<Option<HashMap<u32, Row>>> = Mutex::new(None);
/// The rows the previous run left, after the holding file was folded onto them.
static RESTORED: Mutex<Vec<Row>> = Mutex::new(Vec::new());

fn now_ms() -> u64 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0)
}

/// The rows in a save: another version, or anything unreadable, reads as none; expired rows go.
pub fn parse(text: Option<&str>, now: u64) -> Vec<Row> {
    let Some(saved) = text.and_then(|t| serde_json::from_str::<Saved>(t).ok()) else { return Vec::new() };
    if saved.version != VERSION {
        return Vec::new();
    }
    saved.rows.into_iter().filter(|r| now.saturating_sub(r.at) < EXPIRY_MS).collect()
}

pub fn serialize(rows: &[Row]) -> String {
    serde_json::to_string(&Saved { version: VERSION, rows: rows.to_vec() }).unwrap_or_default()
}

fn agent_of(route: &str) -> Option<(Agent, &'static str)> {
    match route.trim_start_matches('/') {
        "claude" => Some((Agent::Claude, "claude")),
        "codex" => Some((Agent::Codex, "codex")),
        r => super::vendors::agent_of(r).or_else(|| super::more::agent_of(r)).map(|name| (Agent::Vendor, name)),
    }
}

/// The row a status makes, keeping the previous row's start time while the state holds.
pub fn row_of(agent: &str, status: &Status, event: &Value, prev: Option<&Row>, now: u64) -> Row {
    let text = |k: &str| event.get(k).and_then(Value::as_str).filter(|s| !s.is_empty()).map(str::to_owned);
    let state = status.change.state.to_owned();
    let at = prev.filter(|p| p.state == state).map_or(now, |p| p.at);
    Row {
        pane_key: status.pane_key,
        agent: agent.to_owned(),
        state,
        at,
        session_id: text("session_id").or_else(|| prev.and_then(|p| p.session_id.clone())),
        cwd: text("cwd").or_else(|| prev.and_then(|p| p.cwd.clone())),
        stop: status.stop.as_ref().and_then(|s| serde_json::to_value(s).ok()),
    }
}

/// A live hook was answered: the pane's row is updated and, when it changed, the save rewritten.
pub fn note(app: &tauri::AppHandle, route: &str, body: &[u8], status: &Status) {
    use tauri::Manager as _;
    let Some((_, agent)) = agent_of(route) else { return };
    let event: Value = serde_json::from_slice(body).unwrap_or(Value::Null);
    let rows = {
        let mut live = LIVE.lock().unwrap_or_else(|p| p.into_inner());
        let live = live.get_or_insert_with(HashMap::new);
        let row = row_of(agent, status, &event, live.get(&status.pane_key), now_ms());
        if live.get(&status.pane_key) == Some(&row) {
            return;
        }
        live.insert(status.pane_key, row);
        live.values().cloned().collect::<Vec<_>>()
    };
    if let Ok(store) = app.state::<Mutex<crate::state::Store>>().lock() {
        if let Err(e) = store.set(SAVED_KEY, &serialize(&rows)) {
            eprintln!("kolux-rs: the agents' status could not be saved: {e}");
        }
    }
}

/// Folds the holding file's lines (`route|identity|config|event`) onto `rows`. Each pane's events
/// run through a fresh session of its own, never the live ones; a broken or partial line is
/// skipped.
pub fn replay(text: &str, rows: &mut Vec<Row>, now: u64) -> usize {
    let mut sessions: HashMap<u32, Session> = HashMap::new();
    let mut applied = 0;
    for line in text.lines() {
        let mut parts = line.splitn(4, '|');
        let (Some(route), Some(who), Some(_config), Some(body)) = (parts.next(), parts.next(), parts.next(), parts.next()) else { continue };
        let Some((agent, name)) = agent_of(route) else { continue };
        let Some((pane_key, terminal)) = identity(who) else { continue };
        let Ok(event) = serde_json::from_str::<Value>(body.trim()) else { continue };
        // T-120-b: a vendor's line holds its raw event, normalized as the listener would.
        let event = if agent == Agent::Vendor { match super::more::normalize_any(route, &event) { Some(e) => e, None => continue } } else { event };
        let session = sessions.entry(pane_key).or_default();
        let Some((change, child)) = session.apply(agent, &event) else { continue };
        let status = Status { pane_key, terminal, change, children: Vec::new(), stop: session.stop.clone(), reply: None, child, interrupted: false, monitoring: session.monitoring() };
        let at = rows.iter().position(|r| r.pane_key == pane_key);
        let row = row_of(name, &status, &event, at.map(|i| &rows[i]), now);
        match at {
            Some(i) => rows[i] = row,
            None => rows.push(row),
        }
        applied += 1;
    }
    applied
}

/// At start: the previous run's save, with the holding file folded on, becomes the restored rows
/// and the new save; the holding file goes. Never stops the launch.
pub fn startup(store: &crate::state::Store, dir: &Path) {
    let now = now_ms();
    let mut rows = parse(store.get(SAVED_KEY).ok().flatten().as_deref(), now);
    let spool = dir.join(SPOOL_FILE);
    let taken = dir.join(format!("{SPOOL_FILE}.replaying"));
    if std::fs::rename(&spool, &taken).is_ok() {
        let big = std::fs::metadata(&taken).map(|m| m.len() > SPOOL_MAX).unwrap_or(true);
        if big {
            eprintln!("kolux-rs: the agents' undelivered events were too many to replay; dropped");
        } else if let Ok(bytes) = std::fs::read(&taken) {
            let n = replay(&String::from_utf8_lossy(&bytes), &mut rows, now);
            eprintln!("kolux-rs: {n} agent event(s) sent while Kolux was closed were applied");
        }
        let _ = std::fs::remove_file(&taken);
    }
    if let Err(e) = store.set(SAVED_KEY, &serialize(&rows)) {
        eprintln!("kolux-rs: the agents' status could not be saved: {e}");
    }
    *RESTORED.lock().unwrap_or_else(|p| p.into_inner()) = rows;
}

/// A state an agent can be picked up from later: busy, waiting on the user, or stopped on a limit.
fn unfinished(state: &str) -> bool {
    matches!(state, "working" | "waiting" | "permission" | "blocked" | "queued")
}

/// STAT-037: the record at quit. Keyed by provider session: this run's rows replace earlier ones
/// for the same session, and a session that has since finished leaves the record.
pub fn resumable(earlier: Vec<Row>, live: impl IntoIterator<Item = Row>) -> Vec<Row> {
    let mut by_session: Vec<Row> = earlier;
    for row in live {
        let Some(id) = row.session_id.as_deref() else { continue };
        by_session.retain(|r| r.session_id.as_deref() != Some(id));
        by_session.push(row);
    }
    by_session.retain(|r| r.session_id.is_some() && unfinished(&r.state));
    by_session
}

/// The record written at the last quit or sleep; another version or a damaged one reads as none.
fn record(store: &crate::state::Store) -> Vec<Row> {
    store.get(RESUMABLE_KEY).ok().flatten().and_then(|t| serde_json::from_str::<Saved>(&t).ok()).filter(|s| s.version == VERSION).map(|s| s.rows).unwrap_or_default()
}

/// A folder as compared here: forward slashes, no trailing slash, and on Windows any case.
fn folder(p: &str) -> String {
    let p = p.replace('\\', "/");
    let p = p.trim_end_matches('/');
    if cfg!(windows) {
        p.to_lowercase()
    } else {
        p.to_owned()
    }
}

/// Takes out of `rows` (and returns) the rows whose folder is one of `paths` or below one; a row
/// with no folder stays, since it cannot be placed.
#[cfg_attr(not(test), allow(dead_code))] // live once evidence/hooks-T-167-b-projects.rs.patch lands
pub fn sleeping(rows: &mut Vec<Row>, paths: &[String]) -> Vec<Row> {
    let roots: Vec<String> = paths.iter().map(|p| folder(p)).filter(|p| !p.is_empty()).collect();
    let asleep = |r: &Row| r.cwd.as_deref().map(folder).is_some_and(|c| roots.iter().any(|root| c == *root || c.starts_with(&format!("{root}/"))));
    let (taken, kept): (Vec<Row>, Vec<Row>) = std::mem::take(rows).into_iter().partition(asleep);
    *rows = kept;
    taken
}

/// STAT-037 at sleep (T-167-b): before a workspace's terminals are ended, the agents in it that
/// can be resumed join the record (provider session details first), then their rows are cleared
/// from this run's and the previous run's rows and the save is rewritten without them.
#[cfg_attr(not(test), allow(dead_code))] // live once evidence/hooks-T-167-b-projects.rs.patch lands
pub fn at_sleep(store: &crate::state::Store, paths: &[String]) {
    let (mut taken, kept) = {
        let mut live = LIVE.lock().unwrap_or_else(|p| p.into_inner());
        let live = live.get_or_insert_with(HashMap::new);
        let mut rows: Vec<Row> = live.values().cloned().collect();
        let taken = sleeping(&mut rows, paths);
        live.retain(|_, r| !taken.contains(r));
        (taken, rows)
    };
    let restored = sleeping(&mut RESTORED.lock().unwrap_or_else(|p| p.into_inner()), paths);
    if taken.is_empty() && restored.is_empty() {
        return;
    }
    taken.sort_by_key(|r| r.at);
    let rows = resumable(resumable(record(store), restored), taken);
    if let Err(e) = store.set(RESUMABLE_KEY, &serialize(&rows)) {
        eprintln!("kolux-rs: the agents to resume could not be recorded: {e}");
    }
    if let Err(e) = store.set(SAVED_KEY, &serialize(&kept)) {
        eprintln!("kolux-rs: the agents' status could not be saved: {e}");
    }
}

/// Called as Kolux quits, before the terminals are ended.
pub fn at_quit(store: &crate::state::Store) {
    let earlier: Vec<Row> = record(store);
    let live: Vec<Row> = LIVE.lock().unwrap_or_else(|p| p.into_inner()).as_ref().map(|m| m.values().cloned().collect()).unwrap_or_default();
    let restored = RESTORED.lock().unwrap_or_else(|p| p.into_inner()).clone();
    // The previous run's rows (no pane of theirs exists now) still count until this run's own
    // events say otherwise.
    let rows = resumable(resumable(earlier, restored), live);
    if let Err(e) = store.set(RESUMABLE_KEY, &serialize(&rows)) {
        eprintln!("kolux-rs: the agents to resume could not be recorded: {e}");
    }
}

/// The rows the previous run left (STAT-030), for the panes to show unconfirmed (T-167-b).
#[tauri::command]
pub fn agent_status_saved() -> Vec<Row> {
    RESTORED.lock().unwrap_or_else(|p| p.into_inner()).clone()
}

/// The agents recorded for resuming at the last quit (STAT-037; the offer itself is T-066).
#[tauri::command]
pub fn agent_resumable(store: tauri::State<'_, Mutex<crate::state::Store>>) -> Result<Vec<Row>, String> {
    let store = store.lock().map_err(|e| e.to_string())?;
    Ok(store.get(RESUMABLE_KEY).map_err(|e| e.to_string())?.and_then(|t| serde_json::from_str::<Saved>(&t).ok()).filter(|s| s.version == VERSION).map(|s| s.rows).unwrap_or_default())
}
