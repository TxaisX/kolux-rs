//! STAT-025 (T-123-b): the last reply of an agent whose hook reports carry no reply text, read
//! from its own transcript. Claude Code's Stop carries `last_assistant_message`; Codex's does not,
//! and its session rollout (JSON lines under the Codex home's `sessions` folder) holds each
//! assistant message. Only the newest assistant message's text leaves this module: prompts, tool
//! calls, paths and every other field of the file are never returned, kept or logged.
//!
//! Field names are the public codex-rs protocol's; the fixtures in the tests are written here
//! from those names, not taken from any real session.

use serde_json::Value;
use std::io::{Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};

/// The end of the file that is read: the newest reply of any realistic turn fits in it.
const TAIL: u64 = 1 << 20;

/// The newest assistant reply in `text` (JSON lines in Codex's rollout shape). A `response_item`
/// whose payload is a `message` from the `assistant` role gives its `output_text` pieces joined
/// by a line break; an `event_msg` whose payload is an `agent_message` gives its `message`. The
/// last one wins; the user's lines, tool calls, reasoning and lines that are not JSON are skipped.
pub fn last_reply_in(text: &str) -> Option<String> {
    text.lines().rev().find_map(|l| reply_of(&serde_json::from_str::<Value>(l).ok()?))
}

fn reply_of(line: &Value) -> Option<String> {
    let kind = line.get("type").and_then(Value::as_str)?;
    let p = line.get("payload")?;
    let str_of = |k: &str| p.get(k).and_then(Value::as_str);
    let text = match (kind, str_of("type")?) {
        ("response_item", "message") if str_of("role") == Some("assistant") => p
            .get("content")?
            .as_array()?
            .iter()
            .filter(|c| c.get("type").and_then(Value::as_str) == Some("output_text"))
            .filter_map(|c| c.get("text").and_then(Value::as_str))
            .collect::<Vec<_>>()
            .join("\n"),
        ("event_msg", "agent_message") => str_of("message")?.to_string(),
        _ => return None,
    };
    let text = text.trim();
    (!text.is_empty()).then(|| text.to_string())
}

/// `last_reply_in` on the last `TAIL` bytes of the file at `path` (a partial first line is
/// dropped); a missing or unreadable file gives nothing.
pub fn last_reply(path: &Path) -> Option<String> {
    let mut f = std::fs::File::open(path).ok()?;
    let len = f.metadata().ok()?.len();
    let mut bytes = Vec::new();
    if len > TAIL {
        f.seek(SeekFrom::Start(len - TAIL)).ok()?;
        f.read_to_end(&mut bytes).ok()?;
        let cut = bytes.iter().position(|b| *b == b'\n')? + 1;
        bytes.drain(..cut);
    } else {
        f.read_to_end(&mut bytes).ok()?;
    }
    last_reply_in(&String::from_utf8_lossy(&bytes))
}

/// The rollout of the Codex session a Stop event names: its `transcript_path` when the event
/// carries one (only a `.jsonl` under a `sessions` folder is trusted, since the path arrives
/// over the hook port), else the newest `*-<session_id>.jsonl` under `home/sessions` (a resumed
/// session has one file per run; the newest run holds the newest reply).
pub fn codex_rollout(event: &Value, home: &Path) -> Option<PathBuf> {
    let str_of = |k: &str| event.get(k).and_then(Value::as_str).filter(|s| !s.is_empty());
    if let Some(p) = str_of("transcript_path").map(PathBuf::from).filter(|p| is_rollout(p)) {
        return Some(p);
    }
    let id = str_of("session_id")?;
    let suffix = format!("-{id}.jsonl");
    let mut found = Vec::new();
    jsonl_under(&home.join("sessions"), &suffix, &mut found);
    // The newest is the last by path: the day folders and the file names carry the time.
    found.into_iter().max()
}

fn is_rollout(p: &Path) -> bool {
    p.extension().is_some_and(|x| x == "jsonl") && p.components().any(|c| c.as_os_str() == "sessions")
}

/// Every file under `root` (any depth) whose name ends with `suffix`.
fn jsonl_under(root: &Path, suffix: &str, out: &mut Vec<PathBuf>) {
    for e in std::fs::read_dir(root).into_iter().flatten().flatten() {
        let p = e.path();
        if e.file_type().is_ok_and(|t| t.is_dir()) {
            jsonl_under(&p, suffix, out);
        } else if p.file_name().and_then(|n| n.to_str()).is_some_and(|n| n.ends_with(suffix)) {
            out.push(p);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn line(v: Value) -> String {
        v.to_string()
    }
    fn assistant(parts: &[&str]) -> String {
        let content: Vec<Value> = parts.iter().map(|t| json!({ "type": "output_text", "text": t })).collect();
        line(json!({ "timestamp": "2026-10-13T01:00:00.000Z", "type": "response_item", "payload": { "type": "message", "role": "assistant", "content": content } }))
    }
    fn user(prompt: &str) -> String {
        line(json!({ "timestamp": "2026-10-13T01:00:00.000Z", "type": "response_item", "payload": { "type": "message", "role": "user", "content": [{ "type": "input_text", "text": prompt }] } }))
    }

    #[test]
    fn stat_025_the_newest_assistant_message_is_the_reply_and_only_its_text() {
        let meta = line(json!({ "type": "session_meta", "payload": { "id": "abc", "cwd": "C:/secret/project", "instructions": "system prompt text" } }));
        let call = line(json!({ "type": "response_item", "payload": { "type": "function_call", "name": "shell", "arguments": "{\"command\":[\"rm\",\"-rf\",\"x\"]}" } }));
        let text = [meta, user("the user's prompt, never shown"), assistant(&["first answer"]), call, user("second prompt"), assistant(&["Fixed the test.", "Both pass now."]), "not json {".into(), "".into()].join("\n");
        assert_eq!(last_reply_in(&text).as_deref(), Some("Fixed the test.\nBoth pass now."));
        // The newest assistant message wins even when it is followed by the user's next prompt.
        let later = format!("{text}\n{}", user("third prompt"));
        assert_eq!(last_reply_in(&later).as_deref(), Some("Fixed the test.\nBoth pass now."));
        // Nothing but prompts, tool calls and reasoning: no reply at all, never a prompt as one.
        let none = [user("only a prompt"), line(json!({ "type": "response_item", "payload": { "type": "reasoning", "summary": [{ "type": "summary_text", "text": "thinking" }] } }))].join("\n");
        assert_eq!(last_reply_in(&none), None);
        // The event form carries the same reply.
        let event = line(json!({ "type": "event_msg", "payload": { "type": "agent_message", "message": "  Done.  " } }));
        assert_eq!(last_reply_in(&format!("{text}\n{event}")).as_deref(), Some("Done."));
    }

    #[test]
    fn stat_025_the_rollout_is_found_by_session_id_or_the_trusted_transcript_path() {
        let dir = crate::test_dir::temp("transcript-find");
        let home: &Path = &dir;
        let day = home.join("sessions").join("2026").join("10").join("13");
        std::fs::create_dir_all(&day).unwrap();
        let older = day.join("rollout-2026-10-13T00-00-00-abc.jsonl");
        let newer = day.join("rollout-2026-10-13T01-00-00-abc.jsonl");
        let other = day.join("rollout-2026-10-13T02-00-00-xyz.jsonl");
        std::fs::write(&older, assistant(&["old reply"])).unwrap();
        std::fs::write(&other, assistant(&["another session"])).unwrap();
        std::fs::write(&newer, format!("{}\n{}", user("prompt"), assistant(&["new reply"]))).unwrap();
        let by_id = json!({ "hook_event_name": "Stop", "session_id": "abc" });
        let found = codex_rollout(&by_id, home).unwrap();
        assert_eq!((found.clone(), last_reply(&found).as_deref()), (newer.clone(), Some("new reply")));
        // A transcript_path the event carries is taken when it is a rollout; another file is not.
        let given = json!({ "hook_event_name": "Stop", "session_id": "abc", "transcript_path": older.to_string_lossy() });
        assert_eq!(codex_rollout(&given, home), Some(older));
        let stray = home.join("notes.jsonl");
        std::fs::write(&stray, assistant(&["not a session"])).unwrap();
        let bad = json!({ "hook_event_name": "Stop", "session_id": "abc", "transcript_path": stray.to_string_lossy() });
        assert_eq!(codex_rollout(&bad, home), Some(newer), "an untrusted path falls back to the session id");
        assert_eq!(codex_rollout(&json!({ "hook_event_name": "Stop", "session_id": "nope" }), home), None);
        assert_eq!(last_reply(&home.join("missing.jsonl")), None);
    }

    #[test]
    fn stat_025_a_long_file_is_read_from_its_end() {
        let dir = crate::test_dir::temp("transcript-tail");
        let path = dir.join("rollout-big-abc.jsonl");
        let filler = user(&"x".repeat(4000));
        let mut text = String::new();
        while text.len() < 2 * TAIL as usize {
            text.push_str(&filler);
            text.push('\n');
        }
        text.push_str(&assistant(&["the last word"]));
        std::fs::write(&path, text).unwrap();
        assert_eq!(last_reply(&path).as_deref(), Some("the last word"));
    }
}
