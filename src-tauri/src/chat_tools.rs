//! Native chat, the agent's steps (CHAT-012..CHAT-015; T-326): what a tool call is (its kind, a
//! short preview, its result), the per-file diff cards an edit or patch produces, and the plans an
//! agent writes. `chat.rs` reads the transcript and calls into here for every tool block.
//!
//! Inputs follow the public tool descriptions (PROVENANCE §5, 2026-10-13 T-326): Claude Code's
//! tools (`Read`/`Edit`/`Write`/`MultiEdit`/`Bash`/`Task`… with `file_path`, `old_string`,
//! `new_string`, `content`, `edits`, `command`, `run_in_background`, `description`, `todos`, `plan`)
//! as the Agent SDK reference lists them, `mcp__<server>__<tool>` names, and Codex's `shell`,
//! `exec_command`, `update_plan` and `apply_patch` with the patch grammar OpenAI publishes.

use serde_json::Value;

/// A diff card longer than this is cut short with a count of the lines left out (CHAT-014).
const MAX_DIFF_LINES: usize = 400;
/// Past this many old×new lines the line-by-line match is skipped: the card shows the old text
/// removed, then the new text added.
const MAX_DIFF_WORK: usize = 250_000;
/// A tool result longer than this is cut short before it crosses to the window.
// ponytail: a fixed cap per result; page long outputs from the file if people want all of them.
pub const MAX_OUTPUT: usize = 20_000;

/// One tool call, paired with its result once the result is written (CHAT-013).
#[derive(Clone, Debug, Default, PartialEq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Tool {
    /// The call's own id, which its result names.
    pub call: String,
    /// The tool's name as the agent calls it (the MCP tool's own name for an MCP call).
    pub name: String,
    /// The icon kind: `read`, `edit`, `shell`, `mcp`, `web`, `agent` or `other`.
    pub group: &'static str,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub server: Option<String>,
    /// The file's name, the command itself or the search term.
    pub preview: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub output: Option<String>,
    pub done: bool,
    pub failed: bool,
    /// A shell started to keep running in the background.
    pub background: bool,
    /// Edits and patches: one card per file (present, possibly empty, only for those tools).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub diffs: Option<Vec<FileDiff>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ended_at: Option<u64>,
}

/// One file's part of an edit (CHAT-014).
#[derive(Clone, Debug, PartialEq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileDiff {
    pub path: String,
    /// `added`, `deleted`, `renamed` or `edited`.
    pub change: &'static str,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub from: Option<String>,
    pub lines: Vec<DiffLine>,
    /// Lines left out past the card's limit.
    pub hidden: usize,
}

#[derive(Clone, Debug, PartialEq, serde::Serialize)]
pub struct DiffLine {
    /// `+`, `-`, ` ` (unchanged) or `@` (a gap between two parts of the file).
    pub sign: &'static str,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub old: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub new: Option<u32>,
    pub text: String,
}

/// What a tool block turns into.
pub enum Step {
    Tool(Tool),
    /// A plan, as Markdown; `per_turn` plans (a to-do list) replace the turn's earlier one.
    Plan { text: String, per_turn: bool },
}

pub fn cap(mut s: String, max: usize) -> String {
    if s.len() > max {
        let mut cut = max;
        while !s.is_char_boundary(cut) {
            cut -= 1;
        }
        let more = s[cut..].chars().count();
        s.truncate(cut);
        s.push_str(&format!("\n… {more} more characters"));
    }
    s
}

fn s<'a>(v: &'a Value, key: &str) -> &'a str {
    v.get(key).and_then(Value::as_str).unwrap_or("")
}

fn base(path: &str) -> String {
    path.rsplit(['/', '\\']).next().unwrap_or(path).to_string()
}

/// The first line of a command, kept short.
fn short(text: &str) -> String {
    let line = text.trim().lines().next().unwrap_or("").trim();
    if line.chars().count() > 120 {
        format!("{}…", line.chars().take(119).collect::<String>())
    } else {
        line.to_string()
    }
}

/// An MCP call or unknown tool: its first plain text argument stands for what it is working on.
fn first_text(input: &Value) -> String {
    input.as_object().and_then(|o| o.values().find_map(Value::as_str)).map(short).unwrap_or_default()
}

/// The diff of two texts, line by line, numbered from the start of the snippet.
pub fn diff_lines(old: &str, new: &str) -> Vec<DiffLine> {
    let a: Vec<&str> = old.lines().collect();
    let b: Vec<&str> = new.lines().collect();
    let (n, m) = (a.len(), b.len());
    let mut out = Vec::new();
    let (mut o, mut w) = (0u32, 0u32);
    let mut push = |out: &mut Vec<DiffLine>, sign: &'static str, text: &str| {
        let old = (sign != "+").then(|| {
            o += 1;
            o
        });
        let new = (sign != "-").then(|| {
            w += 1;
            w
        });
        out.push(DiffLine { sign, old, new, text: text.to_string() });
    };
    if n.saturating_mul(m) > MAX_DIFF_WORK {
        a.iter().for_each(|l| push(&mut out, "-", l));
        b.iter().for_each(|l| push(&mut out, "+", l));
        return out;
    }
    // lcs[i][j]: the longest common run of a[i..] and b[j..].
    let mut lcs = vec![vec![0u32; m + 1]; n + 1];
    for i in (0..n).rev() {
        for j in (0..m).rev() {
            lcs[i][j] = if a[i] == b[j] { lcs[i + 1][j + 1] + 1 } else { lcs[i + 1][j].max(lcs[i][j + 1]) };
        }
    }
    let (mut i, mut j) = (0, 0);
    while i < n || j < m {
        if i < n && j < m && a[i] == b[j] {
            push(&mut out, " ", a[i]);
            i += 1;
            j += 1;
        } else if i < n && (j == m || lcs[i + 1][j] >= lcs[i][j + 1]) {
            push(&mut out, "-", a[i]);
            i += 1;
        } else {
            push(&mut out, "+", b[j]);
            j += 1;
        }
    }
    out
}

fn card(path: &str, change: &'static str, from: Option<String>, mut lines: Vec<DiffLine>) -> FileDiff {
    let hidden = lines.len().saturating_sub(MAX_DIFF_LINES);
    lines.truncate(MAX_DIFF_LINES);
    FileDiff { path: path.to_string(), change, from, lines, hidden }
}

fn gap() -> DiffLine {
    DiffLine { sign: "@", old: None, new: None, text: String::new() }
}

/// CHAT-014: one card per file a Codex patch touches.
pub fn patch_cards(patch: &str) -> Vec<FileDiff> {
    struct Cur {
        path: String,
        change: &'static str,
        from: Option<String>,
        lines: Vec<DiffLine>,
        old: u32,
        new: u32,
    }
    let mut cards = Vec::new();
    let mut cur: Option<Cur> = None;
    let flush = |cur: &mut Option<Cur>, cards: &mut Vec<FileDiff>| {
        if let Some(c) = cur.take() {
            cards.push(card(&c.path, c.change, c.from, c.lines));
        }
    };
    let start = |path: &str, change| Some(Cur { path: path.trim().to_string(), change, from: None, lines: Vec::new(), old: 0, new: 0 });
    for line in patch.lines() {
        if let Some(p) = line.strip_prefix("*** Add File: ") {
            flush(&mut cur, &mut cards);
            cur = start(p, "added");
        } else if let Some(p) = line.strip_prefix("*** Delete File: ") {
            flush(&mut cur, &mut cards);
            cur = start(p, "deleted");
        } else if let Some(p) = line.strip_prefix("*** Update File: ") {
            flush(&mut cur, &mut cards);
            cur = start(p, "edited");
        } else if let Some(p) = line.strip_prefix("*** Move to: ") {
            if let Some(c) = cur.as_mut() {
                c.from = Some(std::mem::replace(&mut c.path, p.trim().to_string()));
                c.change = "renamed";
            }
        } else if line.starts_with("*** ") {
            // Begin Patch, End Patch, End of File.
        } else if let Some(c) = cur.as_mut() {
            if line.starts_with("@@") {
                if !c.lines.is_empty() {
                    c.lines.push(gap());
                }
                continue;
            }
            let (sign, text) = match line.chars().next() {
                Some('+') => ("+", &line[1..]),
                Some('-') => ("-", &line[1..]),
                Some(' ') => (" ", &line[1..]),
                _ => (" ", line),
            };
            let old = (sign != "+").then(|| {
                c.old += 1;
                c.old
            });
            let new = (sign != "-").then(|| {
                c.new += 1;
                c.new
            });
            c.lines.push(DiffLine { sign, old, new, text: text.to_string() });
        }
    }
    flush(&mut cur, &mut cards);
    cards
}

fn tool(call: &str, name: &str, group: &'static str, preview: String) -> Tool {
    Tool { call: call.to_string(), name: name.to_string(), group, preview, ..Tool::default() }
}

fn checklist<'a>(items: impl Iterator<Item = (&'a str, &'a str)>) -> String {
    items
        .map(|(text, status)| match status {
            "completed" => format!("- [x] {text}"),
            "in_progress" => format!("- [ ] **{text}**"),
            _ => format!("- [ ] {text}"),
        })
        .collect::<Vec<_>>()
        .join("\n")
}

/// A Claude Code `tool_use` block.
pub fn claude_step(call: &str, name: &str, input: &Value) -> Step {
    let file = || base(s(input, "file_path"));
    let t = match name {
        "Read" | "LS" => tool(call, name, "read", if name == "LS" { base(s(input, "path")) } else { file() }),
        "Glob" | "Grep" => tool(call, name, "read", short(s(input, "pattern"))),
        "Edit" => Tool { diffs: Some(vec![card(s(input, "file_path"), "edited", None, diff_lines(s(input, "old_string"), s(input, "new_string")))]), ..tool(call, name, "edit", file()) },
        "Write" => Tool { diffs: Some(vec![card(s(input, "file_path"), "added", None, diff_lines("", s(input, "content")))]), ..tool(call, name, "edit", file()) },
        "MultiEdit" => {
            let mut lines = Vec::new();
            for e in input.get("edits").and_then(Value::as_array).into_iter().flatten() {
                if !lines.is_empty() {
                    lines.push(gap());
                }
                lines.extend(diff_lines(s(e, "old_string"), s(e, "new_string")));
            }
            Tool { diffs: Some(vec![card(s(input, "file_path"), "edited", None, lines)]), ..tool(call, name, "edit", file()) }
        }
        // CHAT-014: a notebook edit stays a plain row.
        "NotebookEdit" => tool(call, name, "edit", base(s(input, "notebook_path"))),
        "Bash" => Tool { background: input.get("run_in_background").and_then(Value::as_bool) == Some(true), ..tool(call, name, "shell", short(s(input, "command"))) },
        "BashOutput" | "KillShell" | "KillBash" => tool(call, name, "shell", String::new()),
        "WebFetch" => tool(call, name, "web", short(s(input, "url"))),
        "WebSearch" => tool(call, name, "web", short(s(input, "query"))),
        "Task" | "Agent" => tool(call, if s(input, "subagent_type").is_empty() { name } else { s(input, "subagent_type") }, "agent", short(s(input, "description"))),
        "TodoWrite" => {
            let todos = input.get("todos").and_then(Value::as_array).cloned().unwrap_or_default();
            return Step::Plan { text: checklist(todos.iter().map(|t| (s(t, "content"), s(t, "status")))), per_turn: true };
        }
        "ExitPlanMode" => return Step::Plan { text: s(input, "plan").to_string(), per_turn: false },
        _ => match name.strip_prefix("mcp__").and_then(|r| r.split_once("__")) {
            Some((server, t)) => Tool { server: Some(server.to_string()), ..tool(call, t, "mcp", first_text(input)) },
            None => tool(call, name, "other", first_text(input)),
        },
    };
    Step::Tool(t)
}

/// An omp (oh-my-pi) `toolCall` block: `read`, `write`, `edit`, `bash` and the search tools take a
/// `path`, `content`, `command` or `pattern` argument (PROVENANCE §5, T-325-b: omp's public
/// message-types page shows `read` with `path` and `bash` as a tool name). The Claude shapes do the
/// work once the arguments are renamed; an `edit` whose arguments the docs do not describe is a
/// plain row without a diff card.
pub fn omp_step(call: &str, name: &str, args: &Value) -> Step {
    match name.to_ascii_lowercase().as_str() {
        "read" => claude_step(call, "Read", &serde_json::json!({ "file_path": s(args, "path") })),
        "write" => claude_step(call, "Write", &serde_json::json!({ "file_path": s(args, "path"), "content": s(args, "content") })),
        "edit" => Step::Tool(tool(call, name, "edit", base(s(args, "path")))),
        "bash" => claude_step(call, "Bash", &serde_json::json!({ "command": s(args, "command") })),
        "grep" | "find" | "glob" | "search" => Step::Tool(tool(call, name, "read", short(if s(args, "pattern").is_empty() { s(args, "path") } else { s(args, "pattern") }))),
        "ls" => Step::Tool(tool(call, name, "read", base(s(args, "path")))),
        _ => match name.strip_prefix("mcp__").and_then(|r| r.split_once("__")) {
            Some((server, t)) => Step::Tool(Tool { server: Some(server.to_string()), ..tool(call, t, "mcp", first_text(args)) }),
            None => Step::Tool(tool(call, name, "other", first_text(args))),
        },
    }
}

/// The command a Codex shell call runs, as the user would type it: `["bash", "-lc", "ls"]` is `ls`.
fn command_line(cmd: &Value) -> String {
    match cmd {
        Value::String(c) => c.clone(),
        Value::Array(parts) => {
            let parts: Vec<&str> = parts.iter().filter_map(Value::as_str).collect();
            if parts.len() >= 3 && parts[parts.len() - 2].starts_with('-') {
                parts[parts.len() - 1].to_string()
            } else {
                parts.join(" ")
            }
        }
        _ => String::new(),
    }
}

/// A Codex `function_call` (arguments as JSON text) or `custom_tool_call` (free text input).
pub fn codex_step(call: &str, name: &str, args: &str) -> Step {
    let input: Value = serde_json::from_str(args).unwrap_or(Value::Null);
    let patch = |text: &str| Tool { diffs: Some(patch_cards(text)), ..tool(call, "apply_patch", "edit", patch_cards(text).first().map(|c| base(&c.path)).unwrap_or_default()) };
    let t = match name {
        "apply_patch" => patch(if input.is_object() { s(&input, "input") } else { args }),
        "shell" | "exec_command" | "local_shell" | "shell_command" => {
            let cmd = input.get("command").or_else(|| input.get("cmd")).cloned().unwrap_or(Value::Null);
            if let Some(p) = cmd.as_array().filter(|a| a.first().and_then(Value::as_str) == Some("apply_patch")).and_then(|a| a.get(1)).and_then(Value::as_str) {
                patch(p)
            } else {
                tool(call, name, "shell", short(&command_line(&cmd)))
            }
        }
        "update_plan" => {
            let plan = input.get("plan").and_then(Value::as_array).cloned().unwrap_or_default();
            return Step::Plan { text: checklist(plan.iter().map(|p| (s(p, "step"), s(p, "status")))), per_turn: true };
        }
        "view_image" => tool(call, name, "read", base(s(&input, "path"))),
        "web_search" => tool(call, name, "web", short(s(&input, "query"))),
        _ => match name.split_once("__") {
            Some((server, t)) => Tool { server: Some(server.to_string()), ..tool(call, t, "mcp", first_text(&input)) },
            None => tool(call, name, "other", first_text(&input)),
        },
    };
    Step::Tool(t)
}

/// A Codex tool result: the text and whether the command failed. The output is either the text
/// itself or `{ output, metadata: { exit_code } }`; a plain text result may begin with its exit code.
pub fn codex_output(raw: &Value) -> (String, bool) {
    let text = match raw {
        Value::String(t) => t.clone(),
        other => other.get("content").and_then(Value::as_str).map(str::to_string).unwrap_or_else(|| other.to_string()),
    };
    if let Ok(v) = serde_json::from_str::<Value>(&text) {
        if let Some(out) = v.get("output").and_then(Value::as_str) {
            let code = v.pointer("/metadata/exit_code").and_then(Value::as_i64).unwrap_or(0);
            return (out.to_string(), code != 0);
        }
    }
    let code = text.lines().take(3).find_map(|l| l.strip_prefix("Exit code: ").or_else(|| l.strip_prefix("Process exited with code ")).and_then(|c| c.trim().parse::<i64>().ok()));
    (text, code.is_some_and(|c| c != 0))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn signs(lines: &[DiffLine]) -> String {
        lines.iter().map(|l| l.sign).collect()
    }

    #[test]
    fn an_edit_diffs_line_by_line_with_numbers_from_the_snippet() {
        let d = diff_lines("a\nb\nc", "a\nB\nc\nd");
        assert_eq!(signs(&d), " -+ +");
        assert_eq!(d.iter().map(|l| (l.sign, l.old, l.new)).collect::<Vec<_>>(), vec![(" ", Some(1), Some(1)), ("-", Some(2), None), ("+", None, Some(2)), (" ", Some(3), Some(3)), ("+", None, Some(4))]);
    }

    #[test]
    fn a_codex_patch_touching_two_files_gives_two_cards() {
        let p = "*** Begin Patch\n*** Update File: src/a.rs\n*** Move to: src/b.rs\n@@ fn main\n keep\n-old\n+new\n*** Add File: notes.md\n+hello\n*** Delete File: gone.txt\n*** End Patch";
        let cards = patch_cards(p);
        assert_eq!(cards.iter().map(|c| (c.path.as_str(), c.change)).collect::<Vec<_>>(), vec![("src/b.rs", "renamed"), ("notes.md", "added"), ("gone.txt", "deleted")]);
        assert_eq!(cards[0].from.as_deref(), Some("src/a.rs"));
        assert_eq!(signs(&cards[0].lines), " -+");
        let Step::Tool(t) = codex_step("c1", "apply_patch", p) else { panic!("an edit") };
        assert_eq!((t.group, t.diffs.as_ref().map(Vec::len)), ("edit", Some(3)));
    }

    #[test]
    fn a_long_diff_is_cut_short_with_a_count_of_hidden_lines() {
        let text: String = (0..450).map(|i| format!("line {i}\n")).collect();
        let Step::Tool(t) = claude_step("t1", "Write", &json!({ "file_path": "C:/w/big.txt", "content": text })) else { panic!() };
        let c = &t.diffs.unwrap()[0];
        assert_eq!((c.lines.len(), c.hidden, c.change, t.preview.as_str()), (400, 50, "added", "big.txt"));
    }

    #[test]
    fn calls_get_their_kind_and_a_short_preview() {
        let kind = |name: &str, input: Value| match claude_step("x", name, &input) {
            Step::Tool(t) => (t.group, t.name, t.server, t.preview, t.background),
            Step::Plan { .. } => ("plan", String::new(), None, String::new(), false),
        };
        assert_eq!(kind("Read", json!({ "file_path": "/repo/src/main.rs" })).3, "main.rs");
        assert_eq!(kind("Bash", json!({ "command": "npm test\nmore", "run_in_background": true })), ("shell", "Bash".into(), None, "npm test".into(), true));
        assert_eq!(kind("mcp__github__create_issue", json!({ "title": "Bug" })), ("mcp", "create_issue".into(), Some("github".into()), "Bug".into(), false));
        assert_eq!(kind("WebSearch", json!({ "query": "tauri" })).0, "web");
        assert_eq!(kind("Task", json!({ "description": "Check tests", "subagent_type": "reviewer" })), ("agent", "reviewer".into(), None, "Check tests".into(), false));
        assert_eq!(kind("TodoWrite", json!({ "todos": [] })).0, "plan");
        assert!(matches!(claude_step("x", "NotebookEdit", &json!({})), Step::Tool(Tool { diffs: None, .. })), "notebook edits stay a plain row");
        let Step::Tool(sh) = codex_step("c", "shell", &json!({ "command": ["bash", "-lc", "cargo build"] }).to_string()) else { panic!() };
        assert_eq!((sh.group, sh.preview.as_str()), ("shell", "cargo build"));
        let Step::Plan { text, per_turn } = codex_step("c", "update_plan", &json!({ "plan": [{ "step": "Read", "status": "completed" }, { "step": "Fix", "status": "in_progress" }] }).to_string()) else { panic!() };
        assert_eq!((text.as_str(), per_turn), ("- [x] Read\n- [ ] **Fix**", true));
    }

    #[test]
    fn codex_results_say_when_the_command_failed() {
        assert_eq!(codex_output(&json!(json!({ "output": "boom", "metadata": { "exit_code": 2 } }).to_string())), ("boom".to_string(), true));
        assert!(!codex_output(&json!("Exit code: 0\nWall time: 1s\nOutput:\nok")).1);
        assert!(codex_output(&json!("Exit code: 1\nOutput:\nerr")).1);
        assert_eq!(cap("abcdef".into(), 3), "abc\n… 3 more characters");
    }
}
