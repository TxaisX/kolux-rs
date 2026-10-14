//! Native chat, the transcript side (CHAT-002, CHAT-006, CHAT-007, CHAT-010; T-325). A Claude or
//! Codex pane keeps running in its terminal while the chat view rebuilds the conversation from the
//! transcript the agent writes on disk. This module finds that file (the location the agent's
//! hooks reported first, then the agent's own home folders), follows it as it grows (only new
//! lines after the first read, a half-written last line held back, a rotated or recreated file
//! re-attached), and turns each agent's native format into one list of plain messages with the
//! system noise taken out. Merging with hook messages, the live preview and the view itself live
//! in `src/chat/`.
//!
//! Formats (PROVENANCE §5, 2026-10-13): Claude Code writes one JSON event per line under
//! `<config>/projects/<cwd with every non-alphanumeric character as '-'>/<session>.jsonl`
//! (`type`, `uuid`, `timestamp`, `isSidechain`, `isMeta`, `message.{id, role, content,
//! stop_reason}`); Codex writes a session rollout under `<home>/sessions/YYYY/MM/DD/*.jsonl`
//! (`timestamp`, `type`, `payload`; the first line's payload carries the session's `cwd`).
//! Grok and omp readers wait for a public description of their files (T-420).

use std::collections::HashMap;
use std::fs;
use std::io::{Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant, SystemTime};

use serde_json::Value;

use crate::chat_tools::{cap, claude_step, codex_output, codex_step, Step, MAX_OUTPUT};

/// CHAT-002: the agents whose sessions can be shown as chat. Grok and omp are offered once their
/// readers exist (T-420); until then they stay terminals.
pub const SUPPORTED: [&str; 3] = ["claude", "openclaude", "codex"];
/// CHAT-006: a missing transcript shows an error only after this long.
const GIVE_UP: Duration = Duration::from_secs(60);
/// While attached, how often the file is checked for new lines (catches what a watcher misses).
const ATTACHED_POLL_MS: u64 = 1000;
/// A pasted image larger than this (as base64) is left out of the chat rather than shipped.
const MAX_IMAGE: usize = 4 * 1024 * 1024;

/// CHAT-002: the agent a pane's chat would read, from the agent actually credited with the program
/// running in the pane. A tab title or launch hint never unlocks chat, so it is not an input here.
pub fn chat_agent(credited: Option<&str>) -> Option<&'static str> {
    SUPPORTED.iter().copied().find(|a| Some(*a) == credited)
}

/// CHAT-006: how long to wait before looking again for a transcript not written yet: 1, 2, 4 and
/// 8 seconds, then every 10 seconds.
pub fn retry_after(attempt: u32) -> Duration {
    Duration::from_secs(match attempt {
        0 => 1,
        1 => 2,
        2 => 4,
        3 => 8,
        _ => 10,
    })
}

/// One message of the conversation as the chat shows it.
#[derive(Clone, Debug, PartialEq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Item {
    /// The transcript's own identity for the message, stable across reads.
    pub id: String,
    /// `user`, `assistant` or `status` (a single row such as an interrupted turn).
    pub role: &'static str,
    /// `text`, `command` (a slash command or skill the user typed), `interrupted`, `thought`
    /// (reasoning), `tool` (a call and its result), `plan` (Markdown), `compact` (the context was
    /// compacted) or `notice` (something the provider reported).
    pub kind: &'static str,
    pub text: String,
    /// Milliseconds since 1970, when the transcript says.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub at: Option<u64>,
    /// Pasted images that belong to this message, as data URLs.
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub images: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tool: Option<crate::chat_tools::Tool>,
    /// A notice's full text, shown behind Details.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub details: Option<String>,
}

impl Item {
    fn of(id: String, role: &'static str, kind: &'static str, text: String, at: Option<u64>) -> Self {
        Item { id, role, kind, text, at, images: Vec::new(), tool: None, details: None }
    }
}

#[derive(Clone, Copy, Debug, PartialEq)]
enum Format {
    Claude,
    Codex,
}

/// Turns transcript lines into items, keeping the conversation so a later line can extend one.
#[derive(Debug)]
pub struct Parser {
    format: Format,
    line_no: u64,
    items: Vec<Item>,
    index: HashMap<String, usize>,
    /// A turn has started and not ended, as far as the transcript says.
    pub open: bool,
    /// Counts the user's turns, so a turn's to-do list is one item that updates.
    turn: u32,
    /// Claude reply id → (part number, the last block was prose): prose and tool steps from the
    /// same message stay apart (CHAT-013).
    parts: HashMap<String, (u32, bool)>,
}

/// Envelopes an agent or Kolux injects into a user turn: never shown (CHAT-010).
const HIDDEN_TAGS: [&str; 13] = [
    "system-reminder",
    "task-notification",
    "local-command-stdout",
    "local-command-stderr",
    "local-command-caveat",
    "user-prompt-submit-hook",
    "command-message",
    "environment_context",
    "user_instructions",
    "turn_aborted",
    "ide_opened_file",
    "ide_selection",
    "permissions instructions",
];

/// Removes `<tag>…</tag>` blocks (an unclosed one runs to the end).
fn strip_tag(text: &str, tag: &str) -> String {
    let (open, close) = (format!("<{tag}>"), format!("</{tag}>"));
    let mut out = String::new();
    let mut rest = text;
    while let Some(i) = rest.find(&open) {
        out.push_str(&rest[..i]);
        rest = match rest[i..].find(&close) {
            Some(j) => &rest[i + j + close.len()..],
            None => "",
        };
    }
    out.push_str(rest);
    out
}

fn tag_body<'a>(text: &'a str, tag: &str) -> Option<&'a str> {
    let open = format!("<{tag}>");
    let start = text.find(&open)? + open.len();
    let end = text[start..].find(&format!("</{tag}>"))? + start;
    Some(text[start..end].trim())
}

/// Control characters out (line breaks and tabs stay), ANSI colour sequences included.
fn clean(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    let mut chars = text.chars().peekable();
    while let Some(c) = chars.next() {
        if c == '\u{1b}' {
            if chars.peek() == Some(&'[') {
                chars.next();
                for d in chars.by_ref() {
                    if d.is_ascii_alphabetic() {
                        break;
                    }
                }
            }
            continue;
        }
        if c.is_control() && c != '\n' && c != '\t' {
            continue;
        }
        out.push(c);
    }
    out
}

/// What a user's text says once the injected envelopes are gone: the words, or the short command
/// a skill or slash-command envelope stands for. `None` when nothing the user wrote is left.
fn user_words(raw: &str) -> Option<(&'static str, String)> {
    if let Some(name) = tag_body(raw, "command-name") {
        let args = tag_body(raw, "command-args").unwrap_or("");
        let line = if args.is_empty() { name.to_string() } else { format!("{name} {args}") };
        return Some(("command", clean(&line)));
    }
    let mut text = raw.to_string();
    for tag in HIDDEN_TAGS {
        text = strip_tag(&text, tag);
    }
    let text = clean(&text);
    let t = text.trim();
    // Codex sends the repository's AGENTS.md as a user message of its own.
    if t.is_empty() || t.starts_with("# AGENTS.md instructions") {
        return None;
    }
    Some(("text", t.to_string()))
}

/// Takes `[Image #n]` markers out of a message whose images travel with it (CHAT-010).
fn drop_image_markers(text: &str) -> String {
    let mut out = String::new();
    let mut rest = text;
    while let Some(i) = rest.find("[Image #") {
        out.push_str(&rest[..i]);
        match rest[i..].find(']') {
            Some(j) => rest = &rest[i + j + 1..],
            None => {
                out.push_str(&rest[i..]);
                rest = "";
            }
        }
    }
    out.push_str(rest);
    out.trim().to_string()
}

fn str_at<'a>(v: &'a Value, key: &str) -> Option<&'a str> {
    v.get(key).and_then(Value::as_str)
}

fn image_url(block: &Value) -> Option<String> {
    // Claude: { type: image, source: { type: base64, media_type, data } }; Codex: { type: input_image, image_url }.
    let url = match str_at(block, "type")? {
        "image" => {
            let src = block.get("source")?;
            format!("data:{};base64,{}", str_at(src, "media_type").unwrap_or("image/png"), str_at(src, "data")?)
        }
        "input_image" => str_at(block, "image_url")?.to_string(),
        _ => return None,
    };
    (url.len() <= MAX_IMAGE && url.starts_with("data:image/")).then_some(url)
}

/// Claude Code's interrupt marker, written as a user line when a turn is cut short.
fn is_interrupt(text: &str) -> bool {
    text.trim_start().starts_with("[Request interrupted by user")
}

impl Parser {
    fn new(format: Format) -> Self {
        Parser { format, line_no: 0, items: Vec::new(), index: HashMap::new(), open: false, turn: 0, parts: HashMap::new() }
    }

    pub fn items(&self) -> &[Item] {
        &self.items
    }

    /// Adds or extends an item; returns its id.
    fn put(&mut self, item: Item, extend: bool) -> String {
        let id = item.id.clone();
        match self.index.get(&id) {
            Some(&i) if extend => {
                let old = &mut self.items[i];
                if !item.text.is_empty() {
                    if !old.text.is_empty() {
                        old.text.push_str("\n\n");
                    }
                    old.text.push_str(&item.text);
                }
                old.images.extend(item.images);
            }
            Some(&i) => self.items[i] = item,
            None => {
                self.index.insert(id.clone(), self.items.len());
                self.items.push(item);
            }
        }
        id
    }

    /// Reads one complete line; returns the ids of the items it added or changed.
    pub fn feed(&mut self, line: &str) -> Vec<String> {
        self.line_no += 1;
        let Ok(v) = serde_json::from_str::<Value>(line) else { return Vec::new() };
        match self.format {
            Format::Claude => self.claude(&v),
            Format::Codex => self.codex(&v),
        }
    }

    /// A tool block: a step row, or a plan.
    fn step(&mut self, step: Step, at: Option<u64>) -> String {
        match step {
            Step::Tool(t) => {
                let id = format!("tool-{}", t.call);
                self.put(Item { tool: Some(t), ..Item::of(id, "assistant", "tool", String::new(), at) }, false)
            }
            Step::Plan { text, per_turn } => {
                let id = if per_turn { format!("plan-turn-{}", self.turn) } else { format!("plan-{}", self.line_no) };
                // A to-do list keeps its first place in the turn and shows its latest version.
                let at = self.index.get(&id).and_then(|&i| self.items[i].at).or(at);
                self.put(Item::of(id, "assistant", "plan", text, at), false)
            }
        }
    }

    /// Pairs a result with its call (CHAT-013); a result for a call not shown is dropped.
    fn result(&mut self, call: &str, output: String, failed: bool, at: Option<u64>) -> Option<String> {
        let id = format!("tool-{call}");
        let item = &mut self.items[*self.index.get(&id)?];
        let tool = item.tool.as_mut()?;
        // Claude's Write says whether it made the file or replaced it.
        if let Some(d) = tool.diffs.as_mut().and_then(|d| d.first_mut()).filter(|d| d.change == "added" && tool.name == "Write") {
            if output.contains("updated") {
                d.change = "edited";
            }
        }
        tool.output = Some(cap(clean(&output).trim().to_string(), MAX_OUTPUT));
        tool.failed = failed;
        tool.done = true;
        tool.ended_at = at;
        Some(id)
    }

    fn notice(&mut self, text: &str, at: Option<u64>) -> Vec<String> {
        let text = clean(text).trim().to_string();
        let Some(first) = text.lines().next().filter(|l| !l.trim().is_empty()) else { return Vec::new() };
        let head: String = first.chars().take(200).collect();
        let details = (head != text).then(|| text.clone());
        vec![self.put(Item { details, ..Item::of(format!("notice-{}", self.line_no), "status", "notice", head, at) }, false)]
    }

    fn compacted(&mut self, at: Option<u64>) -> Vec<String> {
        vec![self.put(Item::of(format!("compact-{}", self.line_no), "status", "compact", "Context compacted".into(), at), false)]
    }

    fn claude(&mut self, v: &Value) -> Vec<String> {
        let kind = str_at(v, "type").unwrap_or("");
        let at = str_at(v, "timestamp").and_then(crate::capture::parse_time);
        if kind == "system" {
            // CHAT-012: a compaction is a divider; warnings and errors are notices.
            if str_at(v, "subtype") == Some("compact_boundary") {
                return self.compacted(at);
            }
            if matches!(str_at(v, "level"), Some("warning" | "error")) {
                return self.notice(str_at(v, "content").unwrap_or(""), at);
            }
            return Vec::new();
        }
        // Subagent lines are summed up by their Task call's row (CHAT-015); meta lines are Claude's own notes.
        if !matches!(kind, "user" | "assistant") || v.get("isSidechain").and_then(Value::as_bool) == Some(true) || v.get("isMeta").and_then(Value::as_bool) == Some(true) {
            return Vec::new();
        }
        let msg = v.get("message").cloned().unwrap_or(Value::Null);
        let blocks: Vec<Value> = match msg.get("content") {
            Some(Value::String(s)) => vec![serde_json::json!({ "type": "text", "text": s })],
            Some(Value::Array(a)) => a.clone(),
            _ => Vec::new(),
        };
        let texts: Vec<&str> = blocks.iter().filter(|b| str_at(b, "type") == Some("text")).filter_map(|b| str_at(b, "text")).collect();
        let images: Vec<String> = blocks.iter().filter_map(image_url).collect();
        if kind == "user" {
            let id = str_at(v, "uuid").map(str::to_string).unwrap_or_else(|| format!("line-{}", self.line_no));
            // A tool's result rides in a user line; it belongs to the agent's turn (CHAT-013).
            let mut changed: Vec<String> = Vec::new();
            for b in blocks.iter().filter(|b| str_at(b, "type") == Some("tool_result")) {
                let out = match b.get("content") {
                    Some(Value::String(s)) => s.clone(),
                    Some(Value::Array(a)) => a.iter().filter_map(|x| str_at(x, "text")).collect::<Vec<_>>().join("\n"),
                    _ => String::new(),
                };
                let out = tag_body(&out, "tool_use_error").map(str::to_string).unwrap_or(out);
                let failed = b.get("is_error").and_then(Value::as_bool) == Some(true);
                changed.extend(self.result(str_at(b, "tool_use_id").unwrap_or(""), out, failed, at));
            }
            if texts.is_empty() && images.is_empty() {
                return changed;
            }
            let joined = texts.join("\n");
            if is_interrupt(&joined) {
                self.open = false;
                changed.push(self.put(Item::of(id, "status", "interrupted", "Interrupted".into(), at), false));
                return changed;
            }
            // The summary Claude writes after compacting is the agent's memory, not the user's words.
            if joined.trim_start().starts_with("This session is being continued from a previous conversation") {
                return changed;
            }
            let Some((word_kind, words)) = user_words(&joined) else { return changed };
            let words = if images.is_empty() { words } else { drop_image_markers(&words) };
            self.open = true;
            self.turn += 1;
            changed.push(self.put(Item { images, ..Item::of(id, "user", word_kind, words, at) }, false));
            return changed;
        }
        // Claude Code writes one line per content block, all under the reply's message id.
        let msg_id = str_at(&msg, "id").map(str::to_string).or_else(|| str_at(v, "uuid").map(str::to_string)).unwrap_or_else(|| format!("line-{}", self.line_no));
        if matches!(str_at(&msg, "stop_reason"), Some("end_turn" | "stop_sequence" | "max_tokens" | "refusal")) {
            self.open = false;
        }
        let mut changed = Vec::new();
        for b in &blocks {
            match str_at(b, "type").unwrap_or("") {
                "text" => {
                    let text = clean(str_at(b, "text").unwrap_or("")).trim().to_string();
                    if text.is_empty() {
                        continue;
                    }
                    let part = self.parts.entry(msg_id.clone()).or_insert((0, true));
                    if !part.1 {
                        *part = (part.0 + 1, true);
                    }
                    let id = if part.0 == 0 { msg_id.clone() } else { format!("{msg_id}#{}", part.0) };
                    changed.push(self.put(Item::of(id, "assistant", "text", text, at), true));
                }
                "thinking" => {
                    let text = clean(str_at(b, "thinking").unwrap_or("")).trim().to_string();
                    self.parts.entry(msg_id.clone()).or_insert((0, false)).1 = false;
                    if !text.is_empty() {
                        changed.push(self.put(Item::of(format!("thought-{}", self.line_no), "assistant", "thought", text, at), false));
                    }
                }
                "tool_use" => {
                    self.parts.entry(msg_id.clone()).or_insert((0, false)).1 = false;
                    let step = claude_step(str_at(b, "id").unwrap_or(""), str_at(b, "name").unwrap_or(""), b.get("input").unwrap_or(&Value::Null));
                    changed.push(self.step(step, at));
                }
                _ => {}
            }
        }
        changed
    }

    fn codex(&mut self, v: &Value) -> Vec<String> {
        let at = str_at(v, "timestamp").and_then(crate::capture::parse_time);
        if str_at(v, "type") == Some("compacted") {
            return self.compacted(at);
        }
        let Some(p) = v.get("payload") else { return Vec::new() };
        let ptype = str_at(p, "type").unwrap_or("");
        match str_at(v, "type").unwrap_or("") {
            "event_msg" => {
                match ptype {
                    "task_started" => self.open = true,
                    "task_complete" => self.open = false,
                    "turn_aborted" => {
                        self.open = false;
                        let id = format!("abort-{}", self.line_no);
                        return vec![self.put(Item::of(id, "status", "interrupted", "Interrupted".into(), at), false)];
                    }
                    "error" | "stream_error" => return self.notice(str_at(p, "message").unwrap_or(""), at),
                    _ => {}
                }
                Vec::new()
            }
            "response_item" => match ptype {
                "message" => {
                    let role = match str_at(p, "role") {
                        Some("user") => "user",
                        Some("assistant") => "assistant",
                        _ => return Vec::new(), // developer and system prompts stay hidden
                    };
                    let blocks = p.get("content").and_then(Value::as_array).cloned().unwrap_or_default();
                    let texts: Vec<&str> = blocks.iter().filter(|b| matches!(str_at(b, "type"), Some("input_text" | "output_text" | "text"))).filter_map(|b| str_at(b, "text")).collect();
                    let images: Vec<String> = blocks.iter().filter_map(image_url).collect();
                    let id = str_at(p, "id").map(str::to_string).unwrap_or_else(|| format!("line-{}", self.line_no));
                    let joined = texts.join("\n");
                    if role == "user" {
                        let Some((kind, words)) = user_words(&joined) else { return Vec::new() };
                        let words = if images.is_empty() { words } else { drop_image_markers(&words) };
                        if words.is_empty() && images.is_empty() {
                            return Vec::new();
                        }
                        self.turn += 1;
                        return vec![self.put(Item { images, ..Item::of(id, role, kind, words, at) }, false)];
                    }
                    let text = clean(&joined).trim().to_string();
                    if text.is_empty() {
                        return Vec::new();
                    }
                    vec![self.put(Item::of(id, role, "text", text, at), false)]
                }
                "reasoning" => {
                    let parts: Vec<&str> = p.get("summary").and_then(Value::as_array).into_iter().flatten().filter_map(|s| str_at(s, "text")).collect();
                    let text = clean(&parts.join("\n\n")).trim().to_string();
                    if text.is_empty() {
                        return Vec::new();
                    }
                    vec![self.put(Item::of(format!("thought-{}", self.line_no), "assistant", "thought", text, at), false)]
                }
                "function_call" | "custom_tool_call" => {
                    let args = str_at(p, "arguments").or_else(|| str_at(p, "input")).unwrap_or("");
                    let call = str_at(p, "call_id").map(str::to_string).unwrap_or_else(|| format!("line-{}", self.line_no));
                    let step = codex_step(&call, str_at(p, "name").unwrap_or(""), args);
                    vec![self.step(step, at)]
                }
                "function_call_output" | "custom_tool_call_output" => {
                    let (out, failed) = codex_output(p.get("output").unwrap_or(&Value::Null));
                    self.result(str_at(p, "call_id").unwrap_or(""), out, failed, at).into_iter().collect()
                }
                _ => Vec::new(),
            },
            _ => Vec::new(),
        }
    }
}

/// Follows one file as it grows. Only whole lines come out; a line still being written waits.
/// The most of a transcript the first read takes in (its newest part), so a very long session
/// opens quickly; paging back to older turns is T-334's.
pub const FIRST_READ_CAP: u64 = 8 * 1024 * 1024;

#[derive(Debug)]
pub struct Tail {
    pub path: PathBuf,
    offset: u64,
    partial: Vec<u8>,
    created: Option<SystemTime>,
    cap: u64,
    /// The read started inside a line (past the cap): drop bytes up to the first line end.
    skip_to_line: bool,
}

impl Tail {
    pub fn new(path: PathBuf) -> Self {
        Tail::with_cap(path, FIRST_READ_CAP)
    }

    pub fn with_cap(path: PathBuf, cap: u64) -> Self {
        Tail { path, offset: 0, partial: Vec::new(), created: None, cap, skip_to_line: false }
    }

    /// The complete lines added since the last read, and whether the file was replaced (rotated,
    /// truncated or recreated), in which case reading started over from its first line.
    pub fn read(&mut self) -> std::io::Result<(Vec<String>, bool)> {
        let meta = fs::metadata(&self.path)?;
        let created = meta.created().ok();
        let mut reset = false;
        if meta.len() < self.offset || (self.created.is_some() && created != self.created) {
            self.offset = 0;
            self.partial.clear();
            reset = true;
        }
        self.created = created;
        // A read from the start of a file longer than the cap takes only its newest `cap` bytes,
        // from the first whole line in them.
        if self.offset == 0 && meta.len() > self.cap {
            self.offset = meta.len() - self.cap;
            self.skip_to_line = true;
        }
        let mut buf = Vec::new();
        if meta.len() > self.offset {
            let mut f = fs::File::open(&self.path)?;
            f.seek(SeekFrom::Start(self.offset))?;
            f.take(meta.len() - self.offset).read_to_end(&mut buf)?;
            self.offset += buf.len() as u64;
        }
        if self.skip_to_line {
            match buf.iter().position(|b| *b == b'\n') {
                Some(i) => {
                    buf.drain(..=i);
                    self.skip_to_line = false;
                }
                None => buf.clear(),
            }
        }
        self.partial.extend(buf);
        let mut lines = Vec::new();
        while let Some(i) = self.partial.iter().position(|b| *b == b'\n') {
            let line: Vec<u8> = self.partial.drain(..=i).collect();
            let text = String::from_utf8_lossy(&line).trim_end_matches(['\r', '\n']).to_string();
            if !text.is_empty() {
                lines.push(text);
            }
        }
        Ok((lines, reset))
    }
}

/// Claude's project folder name for a working folder: every character that is not a letter or a
/// digit becomes `-`.
pub fn claude_folder(cwd: &str) -> String {
    cwd.chars().map(|c| if c.is_ascii_alphanumeric() { c } else { '-' }).collect()
}

fn home() -> Option<PathBuf> {
    std::env::var_os(if cfg!(windows) { "USERPROFILE" } else { "HOME" }).map(PathBuf::from)
}

fn env_of<'a>(pane_env: &'a [(String, String)], key: &str) -> Option<&'a str> {
    pane_env.iter().rev().find(|(k, _)| k.eq_ignore_ascii_case(key)).map(|(_, v)| v.as_str()).filter(|v| !v.trim().is_empty())
}

/// CHAT-007: the home folders to look in, in order. Claude (and OpenClaude, read the same way):
/// the config folder the pane was started with, then Kolux's own CLAUDE_CONFIG_DIR, then
/// `~/.claude`. Codex: the managed account's home the pane was started with, then CODEX_HOME,
/// then `~/.codex`.
pub fn homes(agent: &str, pane_env: &[(String, String)], process_env: impl Fn(&str) -> Option<String>, user_home: Option<PathBuf>) -> Vec<PathBuf> {
    let (key, dot) = match agent {
        "claude" | "openclaude" => (crate::claude_accounts::CONFIG_ENV, ".claude"),
        "codex" => (crate::codex_accounts::HOME_ENV, ".codex"),
        _ => return Vec::new(),
    };
    let mut out: Vec<PathBuf> = Vec::new();
    let candidates = [env_of(pane_env, key).map(PathBuf::from), process_env(key).filter(|v| !v.trim().is_empty()).map(PathBuf::from), user_home.map(|h| h.join(dot))];
    for c in candidates.into_iter().flatten() {
        if !out.contains(&c) {
            out.push(c);
        }
    }
    out
}

fn modified(p: &Path) -> Option<SystemTime> {
    fs::metadata(p).and_then(|m| m.modified()).ok()
}

fn newest(files: impl Iterator<Item = PathBuf>, since: SystemTime) -> Option<PathBuf> {
    files.filter_map(|p| modified(&p).filter(|m| *m >= since).map(|m| (m, p))).max_by_key(|(m, _)| *m).map(|(_, p)| p)
}

fn same_dir(a: &str, b: &str) -> bool {
    let norm = |s: &str| s.trim_end_matches(['\\', '/']).replace('/', "\\").to_ascii_lowercase();
    norm(a) == norm(b)
}

/// The first line of a Codex rollout names the folder the session runs in.
fn codex_cwd(path: &Path) -> Option<String> {
    let mut f = fs::File::open(path).ok()?;
    let mut head = vec![0u8; 64 * 1024];
    let n = f.read(&mut head).ok()?;
    let first = String::from_utf8_lossy(&head[..n]).lines().next()?.to_string();
    let v: Value = serde_json::from_str(&first).ok()?;
    v.pointer("/payload/cwd").and_then(Value::as_str).map(str::to_string)
}

fn jsonl_in(dir: &Path) -> impl Iterator<Item = PathBuf> {
    fs::read_dir(dir).into_iter().flatten().flatten().map(|e| e.path()).filter(|p| p.extension().is_some_and(|e| e == "jsonl"))
}

/// CHAT-007: the transcript of the session started in `cwd` at or after `since`, searched in each
/// home folder in turn.
pub fn find(agent: &str, homes: &[PathBuf], cwd: &str, since: SystemTime) -> Option<PathBuf> {
    for h in homes {
        let hit = match agent {
            "claude" | "openclaude" => newest(jsonl_in(&h.join("projects").join(claude_folder(cwd))), since),
            "codex" => {
                // sessions/YYYY/MM/DD: only day folders touched since the session began are opened.
                let mut files = Vec::new();
                let fresh = |p: &Path| modified(p).is_some_and(|m| m + Duration::from_secs(86_400) >= since);
                for y in fs::read_dir(h.join("sessions")).into_iter().flatten().flatten().map(|e| e.path()).filter(|p| fresh(p)) {
                    for m in fs::read_dir(&y).into_iter().flatten().flatten().map(|e| e.path()).filter(|p| fresh(p)) {
                        for d in fs::read_dir(&m).into_iter().flatten().flatten().map(|e| e.path()).filter(|p| fresh(p)) {
                            files.extend(jsonl_in(&d));
                        }
                    }
                }
                newest(files.into_iter().filter(|f| codex_cwd(f).is_some_and(|c| same_dir(&c, cwd))), since)
            }
            _ => None,
        };
        if hit.is_some() {
            return hit;
        }
    }
    None
}

/// What one look at the transcript tells the window.
#[derive(Clone, Debug, PartialEq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatRead {
    /// `loading`, `ready`, `empty` or `error`.
    pub state: &'static str,
    /// The items below replace everything the view holds (first read, or the file was replaced).
    pub reset: bool,
    /// New or changed items, in transcript order; an item whose id the view holds replaces it.
    pub items: Vec<Item>,
    /// A turn is under way (the transcript says so and the agent's process is still alive).
    pub open: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    /// When to look again.
    pub retry_ms: u64,
}

/// One chat view's hold on a transcript.
pub struct Follow {
    agent: &'static str,
    cwd: String,
    homes: Vec<PathBuf>,
    since: SystemTime,
    tail: Option<Tail>,
    parser: Parser,
    opened: Instant,
    attempts: u32,
    next_try: Instant,
    sent_first: bool,
}

impl Follow {
    pub fn new(agent: &'static str, cwd: String, homes: Vec<PathBuf>, since: SystemTime, now: Instant) -> Self {
        let format = if agent == "codex" { Format::Codex } else { Format::Claude };
        Follow { agent, cwd, homes, since, tail: None, parser: Parser::new(format), opened: now, attempts: 0, next_try: now, sent_first: false }
    }

    fn missing(&mut self, now: Instant, working: bool) -> ChatRead {
        let wait = retry_after(self.attempts);
        self.attempts += 1;
        self.next_try = now + wait;
        // A session known to be working keeps loading until its transcript is flushed.
        let late = now.duration_since(self.opened) >= GIVE_UP && !working;
        ChatRead {
            state: if late { "error" } else { "loading" },
            reset: false,
            items: Vec::new(),
            open: false,
            error: late.then(|| "This session's conversation could not be found on this computer yet. The terminal still shows everything.".to_string()),
            retry_ms: wait.as_millis() as u64,
        }
    }

    /// One look. `hint` is the transcript location the agent's hooks reported, used before any
    /// folder search; `alive` says the agent's process is still running; `working` that its hooks
    /// say it is mid-turn.
    pub fn poll(&mut self, now: Instant, hint: Option<PathBuf>, alive: bool, working: bool) -> ChatRead {
        if let Some(h) = hint.filter(|h| self.tail.as_ref().is_none_or(|t| &t.path != h)) {
            if h.exists() {
                self.attach(h);
            }
        }
        if self.tail.is_none() {
            if now < self.next_try && self.attempts > 0 {
                return ChatRead { state: "loading", reset: false, items: Vec::new(), open: false, error: None, retry_ms: self.next_try.duration_since(now).as_millis() as u64 };
            }
            match find(self.agent, &self.homes, &self.cwd, self.since) {
                Some(p) => self.attach(p),
                None => return self.missing(now, working),
            }
        }
        let Some(tail) = self.tail.as_mut() else { return self.missing(now, working) };
        let (lines, replaced) = match tail.read() {
            Ok(r) => r,
            Err(_) => {
                // Gone (renamed, or deleted to be recreated): look for it again from scratch.
                self.tail = None;
                self.attempts = 0;
                return self.missing(now, working);
            }
        };
        if replaced {
            self.parser = Parser::new(self.parser.format);
        }
        let mut changed: Vec<String> = Vec::new();
        for line in &lines {
            for id in self.parser.feed(line) {
                if !changed.contains(&id) {
                    changed.push(id);
                }
            }
        }
        let reset = replaced || !self.sent_first;
        self.sent_first = true;
        let items: Vec<Item> = if reset { self.parser.items().to_vec() } else { self.parser.items().iter().filter(|i| changed.contains(&i.id)).cloned().collect() };
        ChatRead {
            state: if self.parser.items().is_empty() { "empty" } else { "ready" },
            reset,
            items,
            open: self.parser.open && alive,
            error: None,
            retry_ms: ATTACHED_POLL_MS,
        }
    }

    fn attach(&mut self, path: PathBuf) {
        self.tail = Some(Tail::new(path));
        self.parser = Parser::new(self.parser.format);
        self.sent_first = false;
    }
}

/// Every open chat view's follower, by pane key.
pub static FOLLOWS: Mutex<Option<HashMap<u32, Arc<Mutex<Follow>>>>> = Mutex::new(None);

/// What the window needs to decide whether a pane can show chat (CHAT-002).
#[derive(Clone, Debug, PartialEq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Support {
    /// The supported agent credited with the pane's program, none otherwise.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub agent: Option<&'static str>,
    /// The pane's program has not printed anything yet.
    pub launching: bool,
    /// A home folder for the agent's transcripts exists on this computer.
    pub readable: bool,
}

fn support_of(run: Option<crate::terminal::PaneRun>) -> Support {
    let Some(run) = run else { return Support { agent: None, launching: true, readable: false } };
    let agent = chat_agent(run.agent);
    let readable = agent.is_some_and(|a| homes(a, &run.home_env, |k| std::env::var(k).ok(), home()).iter().any(|h| h.is_dir()));
    Support { agent, launching: !run.wrote, readable }
}

/// Runs `job` on a blocking worker, never the window's thread (the chat commands touch the disk).
async fn off_main<T: Send + 'static>(job: impl FnOnce() -> T + Send + 'static) -> Result<T, String> {
    tauri::async_runtime::spawn_blocking(job).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn chat_support(terminals: tauri::State<'_, crate::terminal::Terminals>, pane_key: u32) -> Result<Support, String> {
    let run = terminals.of_pane(pane_key);
    off_main(move || support_of(run)).await
}

/// CHAT-006: one look at the pane's transcript; the window calls it again after `retryMs`.
#[tauri::command]
pub async fn chat_read(terminals: tauri::State<'_, crate::terminal::Terminals>, pane_key: u32) -> Result<ChatRead, String> {
    let run = terminals.of_pane(pane_key).ok_or("This pane is not running an agent.")?;
    off_main(move || read_pane(pane_key, run)).await?
}

fn read_pane(pane_key: u32, run: crate::terminal::PaneRun) -> Result<ChatRead, String> {
    let agent = chat_agent(run.agent).ok_or("This pane's program cannot be shown as chat.")?;
    let hint = crate::status::transcript_of(pane_key).map(PathBuf::from);
    let working = crate::status::working(pane_key);
    let now = Instant::now();
    // The map's lock is held only to find or make the pane's follower; the read itself holds just
    // that follower's lock, so a long first read never stalls another pane's chat.
    let mut guard = FOLLOWS.lock().unwrap_or_else(|p| p.into_inner());
    let follow = guard.get_or_insert_with(HashMap::new).entry(pane_key).or_insert_with(|| {
        // A little slack: the agent may have created its file a moment before Kolux noted the start.
        let since = run.started - Duration::from_secs(5);
        // The folder the program really started in (TERM-040 may have moved it below the workspace).
        let cwd = run.cwd.clone().or_else(|| std::env::current_dir().ok().map(|d| d.to_string_lossy().into_owned())).unwrap_or_default();
        Arc::new(Mutex::new(Follow::new(agent, cwd, homes(agent, &run.home_env, |k| std::env::var(k).ok(), home()), since, now)))
    });
    let follow = Arc::clone(follow);
    drop(guard);
    let mut follow = follow.lock().unwrap_or_else(|p| p.into_inner());
    Ok(follow.poll(now, hint, run.alive, working))
}

/// The chat view closed: its next open reads the transcript from the start again.
#[tauri::command]
pub async fn chat_close(pane_key: u32) {
    // Only the map entry goes; a read still running finishes on its own copy and is dropped.
    let mut guard = FOLLOWS.lock().unwrap_or_else(|p| p.into_inner());
    if let Some(f) = guard.as_mut() {
        f.remove(&pane_key);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_dir::temp;
    use serde_json::json;
    use std::io::Write;

    fn feed(p: &mut Parser, lines: &[Value]) {
        for l in lines {
            p.feed(&l.to_string());
        }
    }
    fn texts(p: &Parser) -> Vec<(String, String)> {
        p.items().iter().map(|i| (i.role.to_string(), i.text.clone())).collect()
    }
    fn user(uuid: &str, content: Value) -> Value {
        json!({ "type": "user", "uuid": uuid, "timestamp": "2026-03-01T10:00:00Z", "message": { "role": "user", "content": content } })
    }
    fn reply(id: &str, uuid: &str, block: Value, stop: Option<&str>) -> Value {
        json!({ "type": "assistant", "uuid": uuid, "timestamp": "2026-03-01T10:00:05Z", "message": { "id": id, "role": "assistant", "content": [block], "stop_reason": stop } })
    }

    #[test]
    fn only_supported_agents_credited_with_the_pane_unlock_chat() {
        assert_eq!(chat_agent(Some("claude")), Some("claude"));
        assert_eq!(chat_agent(Some("codex")), Some("codex"));
        assert_eq!(chat_agent(Some("openclaude")), Some("openclaude"));
        assert_eq!(chat_agent(Some("aider")), None);
        assert_eq!(chat_agent(None), None, "a shell has no credited agent; its title never counts");
    }

    #[test]
    fn a_missing_transcript_is_looked_for_after_1_2_4_8_then_every_10_seconds() {
        let waits: Vec<u64> = (0..7).map(|a| retry_after(a).as_secs()).collect();
        assert_eq!(waits, vec![1, 2, 4, 8, 10, 10, 10]);
    }

    #[test]
    fn a_half_written_last_line_waits_until_it_is_complete() {
        let d = temp("chat-partial");
        let f = d.join("t.jsonl");
        fs::write(&f, "{\"a\":1}\n{\"b\":").unwrap();
        let mut t = Tail::new(f.clone());
        assert_eq!(t.read().unwrap(), (vec!["{\"a\":1}".to_string()], false));
        fs::OpenOptions::new().append(true).open(&f).unwrap().write_all(b"2}\r\n").unwrap();
        assert_eq!(t.read().unwrap(), (vec!["{\"b\":2}".to_string()], false), "only the newly completed line, not the first again");
        assert_eq!(t.read().unwrap(), (vec![], false));
    }

    #[test]
    fn a_transcript_past_the_cap_opens_on_its_newest_whole_lines_then_follows() {
        let d = temp("chat-cap");
        let f = d.join("t.jsonl");
        // 40 lines of 10 bytes; a 35-byte cap lands inside line 37, so lines 38..=40 come back.
        let body: String = (1..=40).map(|i| format!("{{\"n\":{i:03}}}\n")).collect();
        assert_eq!(body.len(), 400);
        fs::write(&f, &body).unwrap();
        let mut t = Tail::with_cap(f.clone(), 35);
        let (lines, reset) = t.read().unwrap();
        assert!(!reset);
        assert_eq!(lines, vec!["{\"n\":038}", "{\"n\":039}", "{\"n\":040}"], "no torn first line, only the newest whole lines");
        fs::OpenOptions::new().append(true).open(&f).unwrap().write_all(b"{\"n\":041}\n").unwrap();
        assert_eq!(t.read().unwrap(), (vec!["{\"n\":041}".to_string()], false), "after the first read it follows as before");
        // The real cap is far above a normal session, which is still read whole.
        const { assert!(FIRST_READ_CAP >= 8 * 1024 * 1024) };
        let mut whole = Tail::new(f.clone());
        assert_eq!(whole.read().unwrap().0.len(), 41);
    }

    #[test]
    fn a_truncated_or_recreated_transcript_is_read_again_from_its_start() {
        let d = temp("chat-rotate");
        let f = d.join("t.jsonl");
        fs::write(&f, "{\"a\":1}\n{\"a\":2}\n").unwrap();
        let mut t = Tail::new(f.clone());
        assert_eq!(t.read().unwrap().0.len(), 2);
        fs::write(&f, "{\"z\":1}\n").unwrap();
        assert_eq!(t.read().unwrap(), (vec!["{\"z\":1}".to_string()], true));
        fs::remove_file(&f).unwrap();
        assert!(t.read().is_err(), "a deleted file is reported so the follower looks for it again");
    }

    #[test]
    fn claude_turns_come_out_once_in_order_without_injected_envelopes() {
        let mut p = Parser::new(Format::Claude);
        feed(&mut p, &[
            json!({ "type": "permission-mode", "mode": "x", "sessionId": "s" }),
            user("u0", json!("<system-reminder>internal note</system-reminder>")),
            json!({ "type": "user", "uuid": "u-meta", "isMeta": true, "message": { "role": "user", "content": "Caveat: meta" } }),
            user("u1", json!([{ "type": "text", "text": "<system-reminder>hidden</system-reminder>Fix the login\u{7} bug" }])),
            reply("m1", "a1", json!({ "type": "thinking", "thinking": "hmm" }), None),
            reply("m1", "a2", json!({ "type": "text", "text": "Looking now." }), None),
            reply("m1", "a3", json!({ "type": "text", "text": "Done." }), Some("end_turn")),
            json!({ "type": "assistant", "isSidechain": true, "uuid": "x", "message": { "id": "side", "content": [{ "type": "text", "text": "subagent words" }] } }),
            user("u2", json!("<command-name>/review</command-name>\n<command-message>review</command-message>\n<command-args>src</command-args>")),
            user("u3", json!("<local-command-stdout>output</local-command-stdout>")),
        ]);
        assert_eq!(texts(&p), vec![
            ("user".into(), "Fix the login bug".into()),
            ("assistant".into(), "hmm".into()),
            ("assistant".into(), "Looking now.\n\nDone.".into()),
            ("user".into(), "/review src".into()),
        ]);
        assert_eq!(p.items()[1].kind, "thought");
        assert_eq!(p.items()[3].kind, "command");
        assert_eq!(p.items()[0].at, Some(1_772_359_200_000));
    }

    #[test]
    fn claude_tool_calls_pair_with_their_results_and_stay_apart_from_prose() {
        let mut p = Parser::new(Format::Claude);
        let result = |uuid: &str, call: &str, text: &str, err: bool| user(uuid, json!([{ "type": "tool_result", "tool_use_id": call, "content": text, "is_error": err }]));
        feed(&mut p, &[
            user("u1", json!("tidy up")),
            reply("m1", "a1", json!({ "type": "text", "text": "First a look." }), None),
            reply("m1", "a2", json!({ "type": "tool_use", "id": "t1", "name": "Bash", "input": { "command": "ls" } }), Some("tool_use")),
            reply("m1", "a3", json!({ "type": "tool_use", "id": "t2", "name": "Edit", "input": { "file_path": "/r/a.txt", "old_string": "x", "new_string": "y" } }), Some("tool_use")),
        ]);
        assert!(p.items()[2].tool.as_ref().is_some_and(|t| !t.done), "a call with no result yet stays in progress");
        feed(&mut p, &[
            result("r1", "t1", "a.txt", false),
            result("r2", "t2", "<tool_use_error>String to replace not found</tool_use_error>", true),
            reply("m1", "a4", json!({ "type": "text", "text": "All set." }), Some("end_turn")),
            json!({ "type": "system", "subtype": "compact_boundary", "uuid": "s1" }),
            user("u2", json!("This session is being continued from a previous conversation that ran out of context.")),
            reply("m2", "a5", json!({ "type": "tool_use", "id": "t3", "name": "TodoWrite", "input": { "todos": [{ "content": "Test", "status": "pending" }] } }), None),
        ]);
        let kinds: Vec<(&str, &str)> = p.items().iter().map(|i| (i.kind, i.id.as_str())).collect();
        assert_eq!(kinds, vec![("text", "u1"), ("text", "m1"), ("tool", "tool-t1"), ("tool", "tool-t2"), ("text", "m1#1"), ("compact", "compact-8"), ("plan", "plan-turn-1")]);
        let bash = p.items()[2].tool.as_ref().unwrap();
        assert_eq!((bash.group, bash.preview.as_str(), bash.output.as_deref(), bash.done, bash.failed), ("shell", "ls", Some("a.txt"), true, false));
        let edit = p.items()[3].tool.as_ref().unwrap();
        assert_eq!((edit.failed, edit.output.as_deref()), (true, Some("String to replace not found")), "a refused edit keeps the agent's error");
        assert_eq!(p.items()[6].text, "- [ ] Test");
    }

    #[test]
    fn codex_reasoning_tools_patches_and_errors_become_rows() {
        let mut p = Parser::new(Format::Codex);
        let line = |t: &str, payload: Value| json!({ "timestamp": "2026-03-01T10:00:00Z", "type": t, "payload": payload }).to_string();
        let patch = "*** Begin Patch\n*** Update File: a.rs\n-x\n+y\n*** Add File: b.rs\n+z\n*** End Patch";
        for l in [
            line("event_msg", json!({ "type": "task_started" })),
            line("response_item", json!({ "type": "reasoning", "summary": [{ "type": "summary_text", "text": "Plan the fix" }] })),
            line("response_item", json!({ "type": "function_call", "name": "shell", "arguments": json!({ "command": ["bash", "-lc", "cargo test"] }).to_string(), "call_id": "c1" })),
            line("response_item", json!({ "type": "function_call_output", "call_id": "c1", "output": json!({ "output": "1 failed", "metadata": { "exit_code": 101 } }).to_string() })),
            line("response_item", json!({ "type": "custom_tool_call", "name": "apply_patch", "input": patch, "call_id": "c2" })),
            line("event_msg", json!({ "type": "error", "message": "Rate limited\nretry in 20s" })),
            json!({ "timestamp": "2026-03-01T10:00:09Z", "type": "compacted", "payload": { "message": "" } }).to_string(),
        ] {
            p.feed(&l);
        }
        let kinds: Vec<&str> = p.items().iter().map(|i| i.kind).collect();
        assert_eq!(kinds, vec!["thought", "tool", "tool", "notice", "compact"]);
        let sh = p.items()[1].tool.as_ref().unwrap();
        assert_eq!((sh.preview.as_str(), sh.failed, sh.output.as_deref()), ("cargo test", true, Some("1 failed")));
        assert_eq!(p.items()[2].tool.as_ref().unwrap().diffs.as_ref().unwrap().len(), 2, "a patch touching two files gives two cards");
        assert_eq!((p.items()[3].text.as_str(), p.items()[3].details.as_deref()), ("Rate limited", Some("Rate limited\nretry in 20s")));
    }

    #[test]
    fn a_pasted_image_rejoins_its_message_and_its_marker_leaves_the_text() {
        let mut p = Parser::new(Format::Claude);
        feed(&mut p, &[user("u1", json!([{ "type": "text", "text": "[Image #1] what is this?" }, { "type": "image", "source": { "type": "base64", "media_type": "image/png", "data": "iVBORw0KGgo=" } }]))]);
        let i = &p.items()[0];
        assert_eq!(i.text, "what is this?");
        assert_eq!(i.images, vec!["data:image/png;base64,iVBORw0KGgo=".to_string()]);
    }

    #[test]
    fn the_transcript_opens_and_closes_turns_and_an_interrupt_is_one_status_row() {
        let mut p = Parser::new(Format::Claude);
        feed(&mut p, &[user("u1", json!("go"))]);
        assert!(p.open);
        feed(&mut p, &[reply("m1", "a1", json!({ "type": "text", "text": "ok" }), Some("end_turn"))]);
        assert!(!p.open);
        feed(&mut p, &[user("u2", json!("again")), user("u3", json!([{ "type": "text", "text": "[Request interrupted by user]" }]))]);
        assert!(!p.open);
        let last = p.items().last().unwrap();
        assert_eq!((last.role, last.kind, last.text.as_str()), ("status", "interrupted", "Interrupted"));
    }

    #[test]
    fn codex_rollouts_drop_instructions_and_environment_and_track_turns() {
        let mut p = Parser::new(Format::Codex);
        let line = |t: &str, payload: Value| json!({ "timestamp": "2026-03-01T10:00:00Z", "type": t, "payload": payload });
        feed(&mut p, &[
            line("session_meta", json!({ "id": "s", "cwd": "C:\\work" })),
            line("response_item", json!({ "type": "message", "role": "developer", "content": [{ "type": "input_text", "text": "system prompt" }] })),
            line("response_item", json!({ "type": "message", "role": "user", "content": [{ "type": "input_text", "text": "# AGENTS.md instructions for C:\\work\n..." }] })),
            line("response_item", json!({ "type": "message", "role": "user", "content": [{ "type": "input_text", "text": "<environment_context>\n<cwd>C:\\work</cwd>\n</environment_context>" }] })),
            line("event_msg", json!({ "type": "task_started" })),
            line("response_item", json!({ "type": "message", "role": "user", "content": [{ "type": "input_text", "text": "Add a test" }] })),
            line("event_msg", json!({ "type": "user_message", "message": "Add a test" })),
            line("response_item", json!({ "type": "message", "role": "assistant", "id": "msg_1", "content": [{ "type": "output_text", "text": "Added." }] })),
        ]);
        assert!(p.open);
        feed(&mut p, &[line("event_msg", json!({ "type": "task_complete" }))]);
        assert!(!p.open);
        assert_eq!(texts(&p), vec![("user".into(), "Add a test".into()), ("assistant".into(), "Added.".into())]);
        feed(&mut p, &[line("event_msg", json!({ "type": "task_started" })), line("event_msg", json!({ "type": "turn_aborted", "reason": "interrupted" }))]);
        assert_eq!(p.items().last().unwrap().kind, "interrupted");
        assert!(!p.open);
    }

    #[test]
    fn claude_is_looked_for_in_the_panes_config_folder_before_the_default_home() {
        let d = temp("chat-homes");
        let custom = d.join("custom");
        let user_home = d.join("me");
        let env = vec![("CLAUDE_CONFIG_DIR".to_string(), custom.to_string_lossy().to_string())];
        let hs = homes("claude", &env, |_| None, Some(user_home.clone()));
        assert_eq!(hs, vec![custom.clone(), user_home.join(".claude")]);
        let cwd = "C:\\work\\my app";
        assert_eq!(claude_folder(cwd), "C--work-my-app");
        let since = SystemTime::now() - Duration::from_secs(5);
        let default_dir = user_home.join(".claude").join("projects").join("C--work-my-app");
        fs::create_dir_all(&default_dir).unwrap();
        fs::write(default_dir.join("old.jsonl"), "{}\n").unwrap();
        let custom_dir = custom.join("projects").join("C--work-my-app");
        fs::create_dir_all(&custom_dir).unwrap();
        fs::write(custom_dir.join("s1.jsonl"), "{}\n").unwrap();
        assert_eq!(find("claude", &hs, cwd, since), Some(custom_dir.join("s1.jsonl")));
        assert_eq!(find("claude", &hs, cwd, SystemTime::now() + Duration::from_secs(60)), None, "a file older than the session is someone else's conversation");
        let codex = homes("codex", &[("CODEX_HOME".into(), "C:\\acct".into())], |k| (k == "CODEX_HOME").then(|| "C:\\env".to_string()), None);
        assert_eq!(codex, vec![PathBuf::from("C:\\acct"), PathBuf::from("C:\\env")], "the managed account's home first, then CODEX_HOME");
    }

    #[test]
    fn codex_is_found_by_the_folder_its_session_runs_in() {
        let d = temp("chat-codex");
        let day = d.join("sessions").join("2026").join("10").join("13");
        fs::create_dir_all(&day).unwrap();
        fs::write(day.join("rollout-a.jsonl"), json!({ "type": "session_meta", "payload": { "cwd": "C:\\other" } }).to_string() + "\n").unwrap();
        fs::write(day.join("rollout-b.jsonl"), json!({ "type": "session_meta", "payload": { "cwd": "c:/work/" } }).to_string() + "\n").unwrap();
        let since = SystemTime::now() - Duration::from_secs(5);
        assert_eq!(find("codex", std::slice::from_ref(&d.0), "C:\\work", since), Some(day.join("rollout-b.jsonl")));
    }

    #[test]
    fn a_transcript_written_late_loads_without_an_error_and_a_missing_one_errors_after_a_minute() {
        let d = temp("chat-late");
        let cwd = "C:\\late";
        let start = Instant::now();
        let mut f = Follow::new("claude", cwd.into(), vec![d.0.clone()], SystemTime::now() - Duration::from_secs(5), start);
        let mut t = start;
        for _ in 0..3 {
            let r = f.poll(t, None, true, false);
            assert_eq!(r.state, "loading");
            t += Duration::from_millis(r.retry_ms);
        }
        let dir = d.join("projects").join(claude_folder(cwd));
        fs::create_dir_all(&dir).unwrap();
        fs::write(dir.join("s.jsonl"), user("u1", json!("hello")).to_string() + "\n").unwrap();
        let r = f.poll(t, None, true, false);
        assert_eq!((r.state, r.reset, r.items.len(), r.open), ("ready", true, 1, true));
        // the agent's process ended mid-turn: the turn no longer shows as working
        let r = f.poll(t + Duration::from_secs(1), None, false, false);
        assert_eq!((r.items.len(), r.open), (0, false));

        let mut gone = Follow::new("claude", "C:\\never".into(), vec![d.0.clone()], SystemTime::now(), start);
        let mut t = start;
        let mut states = Vec::new();
        while t < start + Duration::from_secs(70) {
            let r = gone.poll(t, None, true, false);
            states.push((t.duration_since(start).as_secs(), r.state));
            t += Duration::from_millis(r.retry_ms.max(1));
        }
        assert!(states.iter().all(|(s, st)| (*s < 60) == (*st == "loading")), "{states:?}");
        assert_eq!(states.last().unwrap().1, "error");
        let r = gone.poll(start + Duration::from_secs(80), None, true, true);
        assert_eq!(r.state, "loading", "a session known to be working keeps loading");
    }

    #[test]
    fn the_hook_reported_transcript_is_used_before_any_search_and_a_recreated_file_is_followed() {
        let d = temp("chat-hint");
        let hinted = d.join("elsewhere.jsonl");
        fs::write(&hinted, user("u1", json!("from the hook's file")).to_string() + "\n").unwrap();
        let start = Instant::now();
        let mut f = Follow::new("claude", "C:\\nowhere".into(), vec![], SystemTime::now(), start);
        let r = f.poll(start, Some(hinted.clone()), true, false);
        assert_eq!(r.items[0].text, "from the hook's file");
        fs::remove_file(&hinted).unwrap();
        let r = f.poll(start + Duration::from_secs(1), None, true, false);
        assert_eq!(r.state, "loading");
        fs::write(&hinted, user("u9", json!("recreated")).to_string() + "\n").unwrap();
        let r = f.poll(start + Duration::from_secs(3), Some(hinted), true, false);
        assert_eq!((r.reset, r.items.len(), r.items[0].text.as_str()), (true, 1, "recreated"));
    }
}
