//! ORCH-060: the session tab inventory. One authoritative list of the session tabs that are open,
//! each with the agent Kolux started in it and where the window shows it, published by the
//! runtime through one call (`session_tabs`) so the command line, the agents' runtime calls and
//! the app read the same list instead of each composing its own.
//!
//! The list is the live session set (a tab exists while its session does) joined with the
//! window's latest placement report: a window row for a session that has closed adds nothing,
//! and a session the window has not placed yet is listed with no placement.
// ponytail: the command line's terminal list, its worktree list and its peer list still compose
// their own rows from the same two sources; switching them onto `tabs` is the cli lane's hunk in
// the T-262 handoff (they live in cli.rs, which this lane does not edit).

use serde::Serialize;
use serde_json::Value;

use crate::terminal::Terminals;

/// Where the window shows a tab: its pane (a cell of its worktree's grid, counted from 1), its tab
/// inside that pane (counted from 1), and whether it is the one in view.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Placement {
    pub pane: u64,
    pub tab: u64,
    pub shown: bool,
}

/// One session tab.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Tab {
    /// The terminal handle (`term-<n>`).
    pub handle: String,
    /// The agent Kolux started in the tab (none for a shell; a tab title plays no part).
    pub agent: Option<&'static str>,
    /// The program line Kolux started, when it started one.
    pub program: Option<String>,
    /// The folder the session was started in.
    pub cwd: Option<String>,
    /// The name the tab shows.
    pub title: Option<String>,
    /// Where the window shows it, once the window has reported it.
    pub placement: Option<Placement>,
}

/// The agent a program line was credited to, quoted or not.
fn agent_of(program: Option<&str>) -> Option<&'static str> {
    let p = program.map(str::trim).filter(|p| !p.is_empty())?;
    if p.starts_with('"') {
        super::credited_agent(p)
    } else {
        super::credited_agent(&format!("\"{p}\"")).or_else(|| super::credited_agent(p))
    }
}

/// Joins the live sessions (handle, start folder, program, in handle order) with the window's
/// placement rows.
pub fn compose(sessions: Vec<(String, Option<String>, Option<String>)>, layout: &[Value]) -> Vec<Tab> {
    sessions
        .into_iter()
        .map(|(handle, cwd, program)| {
            let at = layout.iter().find(|r| r["handle"] == handle.as_str());
            let placement = at.and_then(|r| Some(Placement { pane: r["cell"].as_u64()?, tab: r["tab"].as_u64()?, shown: r["shown"].as_bool().unwrap_or(false) }));
            let title = at.and_then(|r| r["title"].as_str()).map(str::to_string);
            Tab { agent: agent_of(program.as_deref()), handle, program, cwd, title, placement }
        })
        .collect()
}

/// The inventory as the runtime holds it right now.
pub fn tabs(terminals: &Terminals) -> Vec<Tab> {
    compose(terminals.every(), &terminals.layout())
}

/// ORCH-060: the session tab inventory, for the app and for anything that asks the runtime.
#[tauri::command]
pub fn session_tabs(terminals: tauri::State<'_, Terminals>) -> Vec<Tab> {
    tabs(&terminals)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    /// A placement row exactly as the window sends it (App.tsx `reportLayout`).
    fn row(handle: &str, cell: u64, tab: u64, title: &str, shown: bool) -> Value {
        json!({ "handle": handle, "dir": "C:/w/a", "cell": cell, "tab": tab, "title": title, "custom": null, "shown": shown, "ask": null })
    }

    fn session(handle: &str, program: Option<&str>) -> (String, Option<String>, Option<String>) {
        (handle.to_string(), Some("C:/w/a".to_string()), program.map(str::to_string))
    }

    #[test]
    fn orch060_open_three_tabs_lists_three_and_closing_one_lists_two() {
        let mut sessions = vec![session("term-1", None), session("term-2", Some("claude --permission-mode auto")), session("term-3", None)];
        let mut layout = vec![row("term-1", 1, 1, "pwsh", false), row("term-2", 1, 2, "Claude", true), row("term-3", 2, 1, "pwsh", true)];
        let three = compose(sessions.clone(), &layout);
        assert_eq!(three.len(), 3);
        assert_eq!(three.iter().map(|t| t.handle.as_str()).collect::<Vec<_>>(), ["term-1", "term-2", "term-3"]);
        assert_eq!((three[1].agent, three[0].agent), (Some("claude"), None), "the agent comes from the program Kolux started, a shell has none");
        assert_eq!(three[1].placement, Some(Placement { pane: 1, tab: 2, shown: true }));
        assert_eq!(three[2].placement, Some(Placement { pane: 2, tab: 1, shown: true }));

        // Close term-2: its session ends and the window stops reporting it.
        sessions.remove(1);
        layout.remove(1);
        let two = compose(sessions, &layout);
        assert_eq!(two.iter().map(|t| t.handle.as_str()).collect::<Vec<_>>(), ["term-1", "term-3"]);
    }

    #[test]
    fn orch060_the_live_sessions_decide_what_is_listed_not_a_stale_window_report() {
        // The window still reports term-2, but its session has already closed: not listed.
        let layout = vec![row("term-1", 1, 1, "pwsh", true), row("term-2", 1, 2, "old", false)];
        let tabs = compose(vec![session("term-1", None), session("term-4", None)], &layout);
        assert_eq!(tabs.iter().map(|t| t.handle.as_str()).collect::<Vec<_>>(), ["term-1", "term-4"]);
        assert_eq!(tabs[1].placement, None, "a session the window has not placed yet has no placement");
        // A request the window could not open (no handle) is never a tab.
        assert!(compose(vec![], &[json!({ "ask": "a1", "error": "no folder" })]).is_empty());
        // Through the runtime's own state: no session open, whatever the window last said.
        let t = Terminals::default();
        t.set_layout(layout);
        assert!(super::tabs(&t).is_empty());
    }

    #[test]
    fn orch060_an_agent_started_from_a_quoted_path_is_credited() {
        let tabs = compose(vec![session("term-1", Some(r#""C:\Program Files\nodejs\codex.cmd" --sandbox workspace-write"#)), session("term-2", Some("  "))], &[]);
        assert_eq!((tabs[0].agent, tabs[1].agent), (Some("codex"), None));
    }
}
