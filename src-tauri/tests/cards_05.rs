//! spec/05 views and navigation: the status a Board card is built from (VIEW-016, VIEW-023, VIEW-025).
//! Needs `status` and `hooks` public in lib.rs. Hook events are crafted by hand from the public hook
//! documentation; everything is in memory. The card's wording is proven on the TypeScript side
//! (src/board/__cards__), fed the same payload shapes these tests assert.

use kolux_rs_lib::status::{answer_keys, report, Agent, Session};
use serde_json::{json, Value};

fn ev(j: &str) -> Value {
    serde_json::from_str(j).unwrap()
}

fn status(pane: u32, agent: Agent, j: &str) -> Option<Value> {
    report(pane, None, agent, &ev(j)).map(|s| serde_json::to_value(s).unwrap())
}

const PROMPT: &str = r#"{"hook_event_name":"UserPromptSubmit","prompt":"fix the build"}"#;

#[test]
fn view016_a_file_edit_approval_names_the_tool_and_the_file_it_asks_for() {
    let pane = 9_105_161;
    assert_eq!(status(pane, Agent::Claude, PROMPT).unwrap()["state"], "working");
    let asked = status(pane, Agent::Claude, r#"{"hook_event_name":"PermissionRequest","tool_name":"Write","tool_input":{"file_path":"C:/x/hello.txt","content":"hi"}}"#).unwrap();
    assert_eq!((asked["state"].as_str(), asked["tool"].as_str(), asked["detail"].as_str()), (Some("permission"), Some("Write"), Some("C:/x/hello.txt")));
}

#[test]
fn view023_box1_a_usage_limit_stop_is_blocked_with_cause_limit_never_done() {
    let pane = 9_105_231;
    status(pane, Agent::Claude, PROMPT).unwrap();
    let stopped = status(pane, Agent::Claude, r#"{"hook_event_name":"StopFailure","error":"rate_limit","error_details":"5-hour limit"}"#).unwrap();
    assert_eq!(stopped["state"], "blocked");
    assert_eq!(stopped["stop"]["cause"], "limit");
    assert_eq!(stopped["stop"]["detail"], "5-hour limit");
}

#[test]
fn view023_box2_a_finish_carries_the_agents_last_message() {
    let pane = 9_105_232;
    status(pane, Agent::Claude, PROMPT).unwrap();
    let done = status(pane, Agent::Claude, r#"{"hook_event_name":"Stop","last_assistant_message":"All 14 tests pass.\n\nShipped the fix."}"#).unwrap();
    assert_eq!(done["state"], "done");
    assert!(done["reply"].as_str().is_some_and(|r| r.starts_with("All 14 tests pass.") && r.contains("Shipped the fix.")));
}

#[test]
fn view023_box3_each_write_reports_its_own_file_and_the_finish_names_none() {
    let pane = 9_105_233;
    status(pane, Agent::Claude, PROMPT).unwrap();
    let a = status(pane, Agent::Claude, r#"{"hook_event_name":"PostToolUse","tool_name":"Write","tool_input":{"file_path":"C:/w/a.ts"}}"#).unwrap();
    // A write is the only tool step that names a file: a command carrying a path in its input does not.
    let b = status(pane, Agent::Claude, r#"{"hook_event_name":"PostToolUse","tool_name":"Edit","tool_input":{"file_path":"C:/w/b.ts","old_string":"x"}}"#).unwrap();
    let done = status(pane, Agent::Claude, r#"{"hook_event_name":"Stop","last_assistant_message":"Done."}"#).unwrap();
    assert_eq!((a["wrote"].as_str(), b["wrote"].as_str()), (Some("C:/w/a.ts"), Some("C:/w/b.ts")));
    assert!(done.get("wrote").is_none(), "the finish carries no file; the window keeps the newest one it was told");
}

#[test]
fn view025_a_card_answer_types_the_agents_own_keys_and_the_pane_leaves_needs_you() {
    let mut s = Session::default();
    s.apply(Agent::Claude, &ev(PROMPT)).unwrap();
    let (asked, _) = s.apply(Agent::Claude, &ev(r#"{"hook_event_name":"PermissionRequest","tool_name":"Bash","tool_input":{"command":"cargo build"}}"#)).unwrap();
    assert_eq!((asked.state, asked.tool.as_deref()), ("permission", Some("Bash")));
    assert!(s.answerable(), "a hook permission naming its tool is what Approve and Deny answer");
    assert_eq!(s.answer_state(), "working", "the card leaves needs-you once answered");
    assert!(!s.answerable());
    // Approve is the first option (Yes), Deny is Esc for Claude Code; y / n for Codex.
    assert_eq!((answer_keys(Agent::Claude, true), answer_keys(Agent::Claude, false)), (Some("\r"), Some("\x1b")));
    assert_eq!((answer_keys(Agent::Codex, true), answer_keys(Agent::Codex, false)), (Some("y"), Some("n")));
    // The payload shape the TypeScript side is fed.
    assert_eq!(json!({"state": asked.state, "tool": asked.tool}), json!({"state": "permission", "tool": "Bash"}));
}
