//! STAT-002 / STAT-003 (T-120-a): the one switch for every agent's status hooks, and what the
//! `kolux agent hooks` commands report. Off, `sync` takes Kolux's entries out of every agent and
//! nothing puts them back at launch; on, they return. Off is the default (T-152-gate): no saved or an
//! unreadable value installs nothing, and turning it on is the user's recorded approval. The
//! commands answer from the files themselves, so they work whether or not Kolux is open.

use super::{clear, codex_home, names_mine, read_opt, sync};
use crate::hooks::{claude_settings_file, CLAUDE_EVENTS, CODEX_EVENTS};
use serde_json::{json, Map, Value};
use std::path::Path;

/// The Settings key; only a saved `true` turns the hooks on.
pub const SWITCH_KEY: &str = "agentStatusHooks";

pub fn on(settings: &Value) -> bool {
    settings.get(SWITCH_KEY) == Some(&Value::Bool(true))
}

/// A group (or a bare entry) that runs one of Kolux's scripts.
fn ours(group: &Value) -> bool {
    names_mine(group) || group.get("hooks").and_then(Value::as_array).is_some_and(|hs| hs.iter().any(names_mine))
}

/// One agent's install state from its hooks file: installed (every event Kolux manages has its
/// entry), partial (some are missing, or an old Kolux entry sits under an event it no longer uses),
/// not installed, or error. A file that cannot be read or parsed is reported, never rewritten.
pub fn inspect(file: &Path, events: &[&str]) -> (&'static str, Option<String>) {
    let text = match read_opt(file) {
        Ok(Some(t)) => t,
        Ok(None) => return ("not installed", None),
        Err(e) => return ("error", Some(e)),
    };
    let v: Value = match serde_json::from_str(&text) {
        Ok(v) => v,
        Err(e) => return ("error", Some(format!("{} is not JSON ({e}); left alone", file.display()))),
    };
    let empty = Map::new();
    let hooks = v.get("hooks").and_then(Value::as_object).unwrap_or(&empty);
    let has = |event: &str| hooks.get(event).and_then(Value::as_array).is_some_and(|gs| gs.iter().any(ours));
    let missing: Vec<&str> = events.iter().copied().filter(|e| !has(e)).collect();
    let stale: Vec<&str> = hooks.keys().map(String::as_str).filter(|e| !events.contains(e) && has(e)).collect();
    match (missing.len(), stale.is_empty()) {
        (0, true) => ("installed", None),
        (n, true) if n == events.len() => ("not installed", None),
        _ => {
            let mut why = Vec::new();
            if !missing.is_empty() {
                why.push(format!("no Kolux entry for {}", missing.join(", ")));
            }
            if !stale.is_empty() {
                why.push(format!("an old Kolux entry under {}", stale.join(", ")));
            }
            ("partial", Some(why.join("; ")))
        }
    }
}

fn row(agent: &str, name: &str, file: &Path, events: &[&str]) -> Value {
    let (state, reason) = inspect(file, events);
    json!({ "agent": agent, "name": name, "state": state, "file": file.display().to_string(), "reason": reason })
}

/// `kolux agent hooks status`: the switch and one entry per agent Kolux manages.
pub fn report(settings: &Value) -> Value {
    let mut agents = vec![row("claude", "Claude Code", &claude_settings_file(), &CLAUDE_EVENTS)];
    if let Some(home) = codex_home() {
        agents.push(row("codex", "Codex", &home.join("hooks.json"), &CODEX_EVENTS));
    }
    json!({ "on": on(settings), "agents": agents })
}

/// `kolux agent hooks on|off`: saves the choice in the profile at `dir`, brings every agent in
/// line with it, and reports. ponytail: the settings file is read and written without the app's
/// lock; a change saved from the window in the same instant could be lost.
pub fn set(dir: &Path, want: bool) -> Result<Value, String> {
    let store = crate::state::Store::open(dir).map_err(|e| format!("{}: {e}", dir.display()))?;
    let mut set = Map::new();
    set.insert(SWITCH_KEY.into(), Value::Bool(want));
    store.patch_settings(&set, &[]).map_err(|e| format!("{}: {e}", dir.display()))?;
    let settings = store.settings();
    drop(store);
    let outcomes = super::outcomes(if want { sync(&settings, dir) } else { clear(dir) });
    let mut out = report(&settings);
    out["changed"] = json!(outcomes);
    Ok(out)
}

/// `kolux agent hooks prepare-codex`: Kolux's Codex hooks and their trust, in the Codex home this
/// shell uses, before Codex is first started there.
pub fn prepare_codex(settings: &Value) -> Result<Value, String> {
    if !on(settings) {
        return Err("agent status hooks are off; run kolux agent hooks on first".into());
    }
    // T-152 (6): the user's own Codex home is not written while T-025-e is off the cutline.
    let home = codex_home().ok_or("no Codex home could be found")?;
    Err(format!("Kolux does not write Codex hooks into {} yet (T-025-e); nothing changed", home.display()))
}
