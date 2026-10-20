//! CLI-022: `file open`, `file diff` and `file open-changed`. The command works out which files
//! in a worktree are meant and tells the window to open them; what opened and what was skipped
//! comes back in the answer.

use super::{pick_worktree, Ctx, Fail, Request};
use serde_json::{json, Map, Value};
use std::path::Path;

pub const OPEN: &str = "file.open";
pub const DIFF: &str = "file.diff";
pub const CHANGED: &str = "file.open-changed";

pub const COMMANDS: &[super::Command] = &[
    ("file open", OPEN, &["path", "worktree"]),
    ("file diff", DIFF, &["path", "worktree", "staged"]),
    ("file open-changed", CHANGED, &["worktree", "mode"]),
];

/// What open-changed opens: diffs (the default), editing tabs, or both.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Mode {
    Diff,
    Edit,
    Both,
}

/// `--mode`, checked before any lookup.
pub fn mode(v: Option<&str>) -> Result<Mode, Fail> {
    match v.map(str::trim) {
        None | Some("diff") => Ok(Mode::Diff),
        Some("edit") => Ok(Mode::Edit),
        Some("both") => Ok(Mode::Both),
        Some(other) => Err(Fail::args(format!("--mode takes diff, edit or both, not {other}"))),
    }
}

/// The parse-time rules: values that are present must not be blank, `--mode` is one of its three
/// words, and a path is needed for open and diff (bare or `--path`).
pub fn check(command: &str, flags: &Map<String, Value>) -> Result<Map<String, Value>, Fail> {
    let text = |k: &str| flags.get(k).and_then(Value::as_str);
    for k in ["path", "worktree", "mode"] {
        if text(k).is_some_and(|v| v.trim().is_empty()) {
            return Err(Fail::args(format!("--{k} cannot be empty")));
        }
    }
    if command == CHANGED {
        mode(text("mode"))?;
    } else if text("path").is_none() {
        return Err(Fail::args("a file path is required: kolux file open <path> (or --path <path>)"));
    }
    Ok(flags.iter().map(|(k, v)| (k.clone(), v.clone())).collect())
}

/// `/mnt/c/Users/x` as a WSL shell writes a Windows path, back to `C:/Users/x`.
pub fn windows_form(p: &str) -> String {
    let rest = p.strip_prefix("/mnt/").unwrap_or("");
    let mut it = rest.splitn(2, '/');
    match (it.next(), it.next()) {
        (Some(d), tail) if d.len() == 1 && d.chars().all(|c| c.is_ascii_alphabetic()) => format!("{}:/{}", d.to_ascii_uppercase(), tail.unwrap_or("")),
        _ => p.to_string(),
    }
}

/// Folder parts of `p` with `.` dropped and `..` applied; None when `..` climbs above the start.
fn parts(p: &str) -> Option<Vec<String>> {
    let mut out: Vec<String> = Vec::new();
    for seg in p.replace('\\', "/").split('/') {
        match seg {
            "" | "." => {}
            ".." => {
                out.pop()?;
            }
            s => out.push(s.to_string()),
        }
    }
    Some(out)
}

fn is_absolute(p: &str) -> bool {
    let b = p.as_bytes();
    p.starts_with('/') || p.starts_with('\\') || (b.len() >= 2 && b[0].is_ascii_alphabetic() && b[1] == b':')
}

/// Where `given` points, as a path inside `root`, relative to it with forward slashes.
/// A relative path is read from `cwd` when that is inside the worktree, else from its top.
/// The worktree's own top folder is refused: it is a folder, not a file.
pub fn inside(root: &str, cwd: &str, given: &str) -> Result<String, Fail> {
    let given = windows_form(given.trim());
    let root_parts = parts(&windows_form(root)).unwrap_or_default();
    let lower = |v: &[String]| v.iter().map(|s| s.to_lowercase()).collect::<Vec<_>>();
    let starts = |full: &[String]| full.len() >= root_parts.len() && lower(&full[..root_parts.len()]) == lower(&root_parts);
    let cwd_parts = parts(&windows_form(cwd)).unwrap_or_default();
    let full = if is_absolute(&given) {
        parts(&given)
    } else if starts(&cwd_parts) {
        parts(&format!("{}/{given}", windows_form(cwd)))
    } else {
        parts(&format!("{}/{given}", windows_form(root)))
    };
    let Some(full) = full.filter(|f| starts(f)) else {
        return Err(Fail::new("outside", format!("{given} is not inside the worktree {root}")));
    };
    let rel = &full[root_parts.len()..];
    if rel.is_empty() {
        return Err(Fail::new("not_a_file", format!("{given} is the worktree's top folder, not a file")));
    }
    Ok(rel.join("/"))
}

/// One changed file as the status panel reads it.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Row {
    pub path: String,
    pub status: String,
    pub staged: bool,
    pub conflict: bool,
}

/// What open-changed will open and what it leaves out, with the reason.
#[derive(Debug, Default, PartialEq, Eq)]
pub struct Plan {
    pub edit: Vec<String>,
    pub diff: Vec<(String, bool)>,
    pub skipped: Vec<(String, &'static str, &'static str)>,
}

/// Each file once (the working-tree side wins over the staged one); deleted files are skipped
/// for editing and unresolved conflicts for diffs.
pub fn plan(rows: &[Row], how: Mode) -> Plan {
    let mut seen: Vec<&Row> = Vec::new();
    for r in rows {
        match seen.iter().position(|s| s.path == r.path) {
            Some(i) if seen[i].staged && !r.staged => seen[i] = r,
            Some(_) => {}
            None => seen.push(r),
        }
    }
    let mut out = Plan::default();
    for r in seen {
        if matches!(how, Mode::Edit | Mode::Both) {
            if r.status == "D" {
                out.skipped.push((r.path.clone(), "edit", "deleted"));
            } else {
                out.edit.push(r.path.clone());
            }
        }
        if matches!(how, Mode::Diff | Mode::Both) {
            if r.conflict {
                out.skipped.push((r.path.clone(), "diff", "unresolved conflict"));
            } else {
                out.diff.push((r.path.clone(), r.staged));
            }
        }
    }
    out
}

fn rows_of(st: &crate::scm::Status) -> Vec<Row> {
    let take = |list: &[crate::scm::Change], staged: bool, conflict: bool| list.iter().map(|c| Row { path: c.path.clone(), status: c.status.clone(), staged, conflict }).collect::<Vec<_>>();
    let mut rows = take(&st.conflicts, false, true);
    rows.extend(take(&st.changed, false, false));
    rows.extend(take(&st.untracked, false, false));
    rows.extend(take(&st.staged, true, false));
    rows
}

fn absolute(root: &str, rel: &str) -> String {
    format!("{}/{rel}", root.replace('\\', "/").trim_end_matches('/'))
}

pub fn dispatch(ctx: &Ctx, req: &Request) -> Result<Value, Fail> {
    let a = &req.args;
    let text = |k: &str| a[k].as_str().map(str::trim).filter(|s| !s.is_empty());
    if req.command == CHANGED {
        mode(text("mode"))?;
    }
    let (_, w) = pick_worktree(ctx, text("worktree").unwrap_or("current"), &req.cwd)?;
    let root = w.path.clone();
    // The window moves to this worktree first, so the tab opens where the file lives.
    let tell = |mut v: Value| {
        v["worktree"] = json!(root);
        v["branch"] = json!(w.branch);
        let _ = (ctx.front)();
        (ctx.notify)(v);
    };
    match req.command.as_str() {
        OPEN | DIFF => {
            let rel = inside(&root, &req.cwd, text("path").ok_or_else(|| Fail::args("a file path is required"))?)?;
            let abs = absolute(&root, &rel);
            let diff = req.command == DIFF;
            // A diff of a deleted file is fine; an editing tab needs the file to be there.
            if !diff && !Path::new(&abs).is_file() {
                let why = if Path::new(&abs).is_dir() { "is a folder, not a file" } else { "does not exist" };
                return Err(Fail::new("not_found", format!("{rel} {why} in {root}")));
            }
            let staged = a["staged"].as_bool().unwrap_or(false);
            tell(if diff { json!({ "kind": "file-diff", "path": abs, "staged": staged }) } else { json!({ "kind": "file-open", "path": abs }) });
            Ok(json!({ "worktree": root, "opened": [{ "path": rel, "kind": if diff { "diff" } else { "edit" }, "staged": staged }], "skipped": [] }))
        }
        _ => {
            let how = mode(text("mode"))?;
            let st = crate::scm::status(Path::new(&root)).map_err(|e| Fail::new("failed", e))?;
            let plan = plan(&rows_of(&st), how);
            let mut opened = Vec::new();
            for rel in &plan.edit {
                tell(json!({ "kind": "file-open", "path": absolute(&root, rel) }));
                opened.push(json!({ "path": rel, "kind": "edit" }));
            }
            for (rel, staged) in &plan.diff {
                tell(json!({ "kind": "file-diff", "path": absolute(&root, rel), "staged": staged }));
                opened.push(json!({ "path": rel, "kind": "diff", "staged": staged }));
            }
            let skipped: Vec<Value> = plan.skipped.iter().map(|(p, m, why)| json!({ "path": p, "kind": m, "why": why })).collect();
            Ok(json!({ "worktree": root, "mode": match how { Mode::Diff => "diff", Mode::Edit => "edit", Mode::Both => "both" }, "opened": opened, "skipped": skipped }))
        }
    }
}

/// The lines `file ...` prints.
pub fn text_of(r: &Value) -> String {
    let list = |k: &str| r[k].as_array().cloned().unwrap_or_default();
    let mut out: Vec<String> = Vec::new();
    for o in list("opened") {
        out.push(format!("opened {} {}", o["kind"].as_str().unwrap_or("file"), o["path"].as_str().unwrap_or_default()));
    }
    for s in list("skipped") {
        out.push(format!("skipped {} {} ({})", s["kind"].as_str().unwrap_or("file"), s["path"].as_str().unwrap_or_default(), s["why"].as_str().unwrap_or_default()));
    }
    if out.is_empty() {
        out.push("nothing to open".into());
    }
    out.join("\n")
}

#[cfg(test)]
mod tests {
    use super::*;

    fn row(path: &str, status: &str, staged: bool, conflict: bool) -> Row {
        Row { path: path.into(), status: status.into(), staged, conflict }
    }

    #[test]
    fn cli022_the_mode_is_one_of_three_words_and_diff_when_left_out() {
        assert_eq!(mode(None).unwrap(), Mode::Diff);
        assert_eq!(mode(Some("edit")).unwrap(), Mode::Edit);
        assert_eq!(mode(Some("both")).unwrap(), Mode::Both);
        assert!(mode(Some("tabs")).unwrap_err().message.contains("--mode takes diff, edit or both"));
    }

    #[test]
    fn cli022_a_relative_path_opens_from_the_current_folder_inside_the_worktree_else_from_its_top() {
        assert_eq!(inside("C:/w/repo", "C:/w/repo", "src/a.rs").unwrap(), "src/a.rs");
        assert_eq!(inside("C:/w/repo", "C:/w/repo/src", "a.rs").unwrap(), "src/a.rs");
        assert_eq!(inside("C:/w/repo", "C:/elsewhere", "src/a.rs").unwrap(), "src/a.rs");
        assert_eq!(inside("C:/w/repo", "C:/w/repo/src", "../README.md").unwrap(), "README.md");
        assert_eq!(inside("C:/w/repo", "C:/w/repo", "..\\x.txt").unwrap_err().code, "outside");
    }

    #[test]
    fn cli022_an_absolute_path_inside_the_worktree_opens_as_the_matching_path_and_the_top_folder_is_refused() {
        assert_eq!(inside("C:\\w\\repo", "C:\\elsewhere", "C:\\w\\Repo\\src\\a.rs").unwrap(), "src/a.rs");
        assert_eq!(inside("C:/w/repo", "C:/x", "/mnt/c/w/repo/src/a.rs").unwrap(), "src/a.rs");
        assert_eq!(inside("C:/w/repo", "C:/x", "C:/w/repo-two/a.rs").unwrap_err().code, "outside");
        let top = inside("C:/w/repo", "C:/w/repo", "C:/w/repo/").unwrap_err();
        assert_eq!(top.code, "not_a_file");
        assert!(top.message.contains("top folder"), "{}", top.message);
        assert_eq!(inside("C:/w/repo", "C:/w/repo/src", "..").unwrap_err().code, "not_a_file");
    }

    #[test]
    fn cli022_open_changed_skips_deleted_files_for_editing_and_conflicts_for_diffs() {
        let rows = [row("gone.txt", "D", false, false), row("a.rs", "M", false, false), row("clash.rs", "X", false, true), row("s.rs", "M", true, false), row("s.rs", "M", false, false)];
        let d = plan(&rows, Mode::Diff);
        assert_eq!(d.diff, vec![("gone.txt".to_string(), false), ("a.rs".to_string(), false), ("s.rs".to_string(), false)]);
        assert_eq!(d.skipped, vec![("clash.rs".to_string(), "diff", "unresolved conflict")]);
        assert!(d.edit.is_empty());
        let e = plan(&rows, Mode::Edit);
        assert_eq!(e.edit, vec!["a.rs", "clash.rs", "s.rs"]);
        assert_eq!(e.skipped, vec![("gone.txt".to_string(), "edit", "deleted")]);
        let b = plan(&rows, Mode::Both);
        assert_eq!((b.edit.len(), b.diff.len(), b.skipped.len()), (3, 3, 2));
    }

    #[test]
    fn cli022_the_answer_lists_what_opened_and_what_was_skipped() {
        let r = json!({ "opened": [{ "path": "a.rs", "kind": "diff" }], "skipped": [{ "path": "gone.txt", "kind": "edit", "why": "deleted" }] });
        assert_eq!(text_of(&r), "opened diff a.rs\nskipped edit gone.txt (deleted)");
        assert_eq!(text_of(&json!({})), "nothing to open");
    }

    #[test]
    fn cli022_the_parse_checks_refuse_a_missing_path_a_blank_value_and_a_bad_mode_before_any_lookup() {
        let f = |v: Value| v.as_object().unwrap().clone();
        assert!(check(OPEN, &f(json!({}))).unwrap_err().message.contains("file path is required"));
        assert!(check(OPEN, &f(json!({ "path": "a.rs", "worktree": " " }))).unwrap_err().message.contains("--worktree cannot be empty"));
        assert!(check(CHANGED, &f(json!({ "mode": "x" }))).is_err());
        assert!(check(CHANGED, &f(json!({}))).is_ok());
        assert!(check(DIFF, &f(json!({ "path": "a.rs", "staged": true }))).is_ok());
    }
}
