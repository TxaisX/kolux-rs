//! CLI-022: `file open`, `file diff` and `file open-changed`. The command works out which files
//! in a worktree are meant and tells the window to open them; what opened and what was skipped
//! comes back in the answer.

use super::{pick_worktree, Ctx, Fail, Request};
use serde_json::{json, Map, Value};
use std::path::Path;
use std::sync::{Condvar, Mutex};
use std::time::{Duration, Instant};

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

/// Row 386: `inside` reads the spelling only; this follows links the way the runtime file verbs
/// do (runtime::within), so a link inside the worktree that leads out of it is refused too.
fn followed_inside(root: &str, rel: &str) -> Result<(), Fail> {
    let r = Path::new(root);
    crate::orchestration::runtime::within(r, r, rel, false).map(|_| ())
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

/// T-250-c, row 65: the window says back whether it opened each file it was told about. Only a
/// file the window confirmed is listed as opened. One it refused is skipped with the window's reason;
/// one it never answered (or any file, when no window listens) is unconfirmed: handed over, outcome unknown.
pub struct Acks {
    st: Mutex<AckState>,
    cv: Condvar,
}

struct AckState {
    listening: bool,
    next: u64,
    done: Vec<(u64, Option<String>)>,
}

/// Why a file the window was told about is not confirmed open.
#[derive(Debug, PartialEq)]
pub enum Miss {
    Refused(String),
    Silent,
}

const SILENT: &str = "the window did not answer in time, so Kolux cannot say whether it opened";
const DEAF: &str = "no Kolux window is listening for file requests, so Kolux cannot say whether it opened";

pub static ACKS: Acks = Acks::new();
pub const WAIT: Duration = Duration::from_secs(3);

impl Default for Acks {
    fn default() -> Acks {
        Acks::new()
    }
}

impl Acks {
    pub const fn new() -> Acks {
        Acks { st: Mutex::new(AckState { listening: false, next: 0, done: Vec::new() }), cv: Condvar::new() }
    }
    fn lock(&self) -> std::sync::MutexGuard<'_, AckState> {
        self.st.lock().unwrap_or_else(|e| e.into_inner())
    }
    pub fn listen(&self, on: bool) {
        let mut g = self.lock();
        g.listening = on;
        if !on {
            g.done.clear();
        }
    }
    pub fn listening(&self) -> bool {
        self.lock().listening
    }
    pub fn next_id(&self) -> u64 {
        let mut g = self.lock();
        g.next += 1;
        g.next
    }
    /// The window's answer for one request: `None` = opened, `Some(why)` = could not.
    pub fn report(&self, id: u64, failed: Option<String>) {
        self.lock().done.push((id, failed));
        self.cv.notify_all();
    }
    /// Waits for every id to be answered (at most `within`); gives back the ids that failed or never answered.
    pub fn wait(&self, ids: &[u64], within: Duration) -> Vec<(u64, Miss)> {
        let end = Instant::now() + within;
        let mut g = self.lock();
        while !ids.iter().all(|i| g.done.iter().any(|d| d.0 == *i)) {
            let left = end.saturating_duration_since(Instant::now());
            if left.is_zero() {
                break;
            }
            g = self.cv.wait_timeout(g, left).unwrap_or_else(|e| e.into_inner()).0;
        }
        let out = ids
            .iter()
            .filter_map(|i| match g.done.iter().find(|d| d.0 == *i) {
                Some((_, Some(why))) => Some((*i, Miss::Refused(why.clone()))),
                Some((_, None)) => None,
                None => Some((*i, Miss::Silent)),
            })
            .collect();
        g.done.retain(|d| !ids.contains(&d.0));
        out
    }
}

/// Keeps as opened only what the window confirmed: a refusal moves to `skipped` with its reason, a
/// missing answer to `unconfirmed`.
pub fn settle(opened: Vec<(u64, Value)>, skipped: &mut Vec<Value>, unconfirmed: &mut Vec<Value>, misses: &[(u64, Miss)]) -> Vec<Value> {
    let mut kept = Vec::new();
    for (id, o) in opened {
        let row = |why: &str| json!({ "path": o["path"], "kind": o["kind"], "why": why });
        match misses.iter().find(|f| f.0 == id) {
            Some((_, Miss::Refused(why))) => skipped.push(row(why)),
            Some((_, Miss::Silent)) => unconfirmed.push(row(SILENT)),
            None => kept.push(o),
        }
    }
    kept
}

/// What the window said back about files it was told to open. With no window listening nothing is
/// waited for and nothing counts as opened.
pub fn confirm(acks: &Acks, within: Duration, opened: Vec<(u64, Value)>, skipped: &mut Vec<Value>, unconfirmed: &mut Vec<Value>) -> Vec<Value> {
    if !acks.listening() {
        unconfirmed.extend(opened.into_iter().map(|(_, o)| json!({ "path": o["path"], "kind": o["kind"], "why": DEAF })));
        return Vec::new();
    }
    let ids: Vec<u64> = opened.iter().map(|o| o.0).collect();
    let misses = acks.wait(&ids, within);
    settle(opened, skipped, unconfirmed, &misses)
}

pub fn dispatch(ctx: &Ctx, req: &Request) -> Result<Value, Fail> {
    dispatch_with(ctx, req, &ACKS, WAIT)
}

pub fn dispatch_with(ctx: &Ctx, req: &Request, acks: &Acks, within: Duration) -> Result<Value, Fail> {
    let a = &req.args;
    let text = |k: &str| a[k].as_str().map(str::trim).filter(|s| !s.is_empty());
    if req.command == CHANGED {
        mode(text("mode"))?;
    }
    let (_, w) = pick_worktree(ctx, text("worktree").unwrap_or("current"), &req.cwd)?;
    let root = w.path.clone();
    // The window moves to this worktree first, so the tab opens where the file lives.
    let tell = |mut v: Value| -> u64 {
        let id = acks.next_id();
        v["worktree"] = json!(root);
        v["branch"] = json!(w.branch);
        v["ack"] = json!(id);
        let _ = (ctx.front)();
        (ctx.notify)(v);
        id
    };
    let answered = |opened: Vec<(u64, Value)>, skipped: &mut Vec<Value>, unconfirmed: &mut Vec<Value>| confirm(acks, within, opened, skipped, unconfirmed);
    match req.command.as_str() {
        OPEN | DIFF => {
            let rel = inside(&root, &req.cwd, text("path").ok_or_else(|| Fail::args("a file path is required"))?)?;
            followed_inside(&root, &rel)?;
            let abs = absolute(&root, &rel);
            let diff = req.command == DIFF;
            // A diff of a deleted file is fine; an editing tab needs the file to be there.
            if !diff && !Path::new(&abs).is_file() {
                let why = if Path::new(&abs).is_dir() { "is a folder, not a file" } else { "does not exist" };
                return Err(Fail::new("not_found", format!("{rel} {why} in {root}")));
            }
            let staged = a["staged"].as_bool().unwrap_or(false);
            let id = tell(if diff { json!({ "kind": "file-diff", "path": abs, "staged": staged }) } else { json!({ "kind": "file-open", "path": abs }) });
            let (mut skipped, mut unconfirmed) = (Vec::new(), Vec::new());
            let opened = answered(vec![(id, json!({ "path": rel, "kind": if diff { "diff" } else { "edit" }, "staged": staged }))], &mut skipped, &mut unconfirmed);
            Ok(json!({ "worktree": root, "opened": opened, "skipped": skipped, "unconfirmed": unconfirmed }))
        }
        _ => {
            let how = mode(text("mode"))?;
            let st = crate::scm::status(Path::new(&root)).map_err(|e| Fail::new("failed", e))?;
            let plan = plan(&rows_of(&st), how);
            let mut opened = Vec::new();
            for rel in &plan.edit {
                let id = tell(json!({ "kind": "file-open", "path": absolute(&root, rel) }));
                opened.push((id, json!({ "path": rel, "kind": "edit" })));
            }
            for (rel, staged) in &plan.diff {
                let id = tell(json!({ "kind": "file-diff", "path": absolute(&root, rel), "staged": staged }));
                opened.push((id, json!({ "path": rel, "kind": "diff", "staged": staged })));
            }
            let mut skipped: Vec<Value> = plan.skipped.iter().map(|(p, m, why)| json!({ "path": p, "kind": m, "why": why })).collect();
            let mut unconfirmed = Vec::new();
            let opened = answered(opened, &mut skipped, &mut unconfirmed);
            Ok(json!({ "worktree": root, "mode": match how { Mode::Diff => "diff", Mode::Edit => "edit", Mode::Both => "both" }, "opened": opened, "skipped": skipped, "unconfirmed": unconfirmed }))
        }
    }
}

/// The window says it listens for file requests (and stops when it closes).
#[tauri::command]
pub fn cli_file_window(listening: bool) {
    ACKS.listen(listening);
}

/// The window's answer to one file request: `failed` names why it could not open it.
#[tauri::command]
pub fn cli_file_result(id: u64, failed: Option<String>) {
    ACKS.report(id, failed);
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
    for u in list("unconfirmed") {
        out.push(format!("unconfirmed {} {} ({})", u["kind"].as_str().unwrap_or("file"), u["path"].as_str().unwrap_or_default(), u["why"].as_str().unwrap_or_default()));
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
    fn row386_a_link_inside_the_worktree_that_leads_out_of_it_is_refused() {
        let dir = crate::test_dir::temp("row386-link");
        let root = dir.join("wt");
        std::fs::create_dir_all(root.join("src")).unwrap();
        std::fs::create_dir_all(dir.join("secret")).unwrap();
        std::fs::write(dir.join("secret").join("x.txt"), "s").unwrap();
        std::fs::write(root.join("src").join("a.rs"), "a").unwrap();
        #[cfg(windows)]
        let made = std::process::Command::new("cmd").args(["/C", "mklink", "/J"]).arg(root.join("out")).arg(dir.join("secret")).output().unwrap().status.success();
        #[cfg(unix)]
        let made = std::os::unix::fs::symlink(dir.join("secret"), root.join("out")).is_ok();
        assert!(made, "a directory junction or link needs no admin rights");
        let r = root.to_string_lossy().to_string();
        let rel = inside(&r, &r, "out/x.txt").unwrap();
        assert_eq!(rel, "out/x.txt", "by its spelling the path is inside");
        assert_eq!(followed_inside(&r, &rel).unwrap_err().code, "outside", "followed, it leads out");
        followed_inside(&r, "src/a.rs").unwrap();
        followed_inside(&r, "src/not-made-yet.rs").unwrap();
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

    #[test]
    fn t250c_a_file_the_window_refused_is_skipped_and_one_it_never_answered_is_unconfirmed_never_opened() {
        let acks = Acks::new();
        let (a, b, c) = (acks.next_id(), acks.next_id(), acks.next_id());
        acks.report(a, None);
        acks.report(b, Some("that worktree is not in the window".to_string()));
        let misses = acks.wait(&[a, b, c], Duration::from_millis(30));
        assert_eq!(misses, vec![(b, Miss::Refused("that worktree is not in the window".to_string())), (c, Miss::Silent)]);
        let mut skipped = vec![json!({ "path": "gone.txt", "kind": "edit", "why": "deleted" })];
        let mut unconfirmed = Vec::new();
        let opened = settle(vec![(a, json!({ "path": "a.rs", "kind": "diff" })), (b, json!({ "path": "b.rs", "kind": "diff" })), (c, json!({ "path": "c.rs", "kind": "edit" }))], &mut skipped, &mut unconfirmed, &misses);
        assert_eq!(opened, vec![json!({ "path": "a.rs", "kind": "diff" })]);
        assert_eq!(skipped.len(), 2);
        assert_eq!(skipped[1], json!({ "path": "b.rs", "kind": "diff", "why": "that worktree is not in the window" }));
        assert_eq!(unconfirmed, vec![json!({ "path": "c.rs", "kind": "edit", "why": SILENT })]);
        // The answers were taken: a second wait on the same ids sees none.
        assert_eq!(acks.wait(&[a], Duration::from_millis(10)).len(), 1);
    }

    /// Row 65: what the command reports for each answer the window can give.
    #[test]
    fn row65_confirm_reports_opened_only_for_what_the_window_confirmed() {
        let files = |acks: &Acks| -> Vec<(u64, Value)> { ["a.rs", "b.rs", "c.rs"].iter().map(|p| (acks.next_id(), json!({ "path": p, "kind": "diff" }))).collect() };
        // No window listens: nothing is waited for and nothing is opened.
        let acks = Acks::new();
        let (mut skipped, mut unconfirmed) = (Vec::new(), Vec::new());
        let t = Instant::now();
        let opened = confirm(&acks, Duration::from_secs(5), files(&acks), &mut skipped, &mut unconfirmed);
        assert!(opened.is_empty() && skipped.is_empty() && t.elapsed() < Duration::from_secs(1));
        assert_eq!(unconfirmed.len(), 3);
        assert_eq!(unconfirmed[0]["why"], DEAF);
        // A listening window opens one, refuses one (file vanished) and is silent on the third.
        acks.listen(true);
        let list = files(&acks);
        acks.report(list[0].0, None);
        acks.report(list[1].0, Some("the file is gone".to_string()));
        let (mut skipped, mut unconfirmed) = (Vec::new(), Vec::new());
        let opened = confirm(&acks, Duration::from_millis(30), list, &mut skipped, &mut unconfirmed);
        assert_eq!(opened, vec![json!({ "path": "a.rs", "kind": "diff" })]);
        assert_eq!(skipped, vec![json!({ "path": "b.rs", "kind": "diff", "why": "the file is gone" })]);
        assert_eq!(unconfirmed, vec![json!({ "path": "c.rs", "kind": "diff", "why": SILENT })]);
        // The printed answer carries all three outcomes, and an unconfirmed file is never called opened.
        let r = json!({ "opened": opened, "skipped": skipped, "unconfirmed": unconfirmed });
        assert_eq!(text_of(&r), format!("opened diff a.rs\nskipped diff b.rs (the file is gone)\nunconfirmed diff c.rs ({SILENT})"));
    }

    #[test]
    fn t250c_a_late_answer_is_waited_for_and_a_window_that_stops_listening_clears_the_answers() {
        let acks = std::sync::Arc::new(Acks::new());
        assert!(!acks.listening());
        acks.listen(true);
        let id = acks.next_id();
        let t = {
            let acks = acks.clone();
            std::thread::spawn(move || {
                std::thread::sleep(Duration::from_millis(40));
                acks.report(id, None);
            })
        };
        assert!(acks.wait(&[id], Duration::from_secs(5)).is_empty());
        t.join().unwrap();
        acks.report(99, None);
        acks.listen(false);
        assert!(!acks.listening());
        assert_eq!(acks.wait(&[99], Duration::from_millis(5)).len(), 1);
    }
}
