//! GIT-002 / GIT-004 / GIT-006 / GIT-007: the Source Control panel's back end: what one worktree
//! has changed, staging and unstaging by path, committing, and the remote actions (push, pull,
//! sync, fetch, fast-forward, force push with lease, publish, rebase from base). Every call names
//! the worktree it acts on, so one workspace's index is never touched from another's panel.
//! Reading status never touches the network: the ahead / behind counts come from the refs git
//! already has, so an unpublished branch is not checked against the remote over and over.

use crate::git::{command, native, run, Git};
use std::io::Write;
use std::path::{Component, Path};

/// One changed file. `status` is a single letter: M modified, A added, D deleted, R renamed
/// (`from` holds the old path), C copied, T type changed, U untracked, X unmerged.
#[derive(Clone, Debug, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Change {
    pub path: String,
    pub status: String,
    pub from: Option<String>,
}

/// A worktree's state as the panel shows it, from `git status --porcelain=v2 --branch -z`.
#[derive(Clone, Debug, Default, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Status {
    /// None while HEAD is detached.
    pub branch: Option<String>,
    pub upstream: Option<String>,
    pub ahead: u32,
    pub behind: u32,
    /// GIT-006: the branch differs from its upstream only by commits whose patches it already
    /// holds, as after a rebase, so a force push with lease loses nothing.
    pub rewritten: bool,
    /// The branch work rebases onto (origin's HEAD, else main or master); None without one.
    pub base: Option<String>,
    /// The commit HEAD points at; None before the first commit. VIEW-068 refreshes on a change.
    pub head: Option<String>,
    pub staged: Vec<Change>,
    pub changed: Vec<Change>,
    pub untracked: Vec<Change>,
    pub conflicts: Vec<Change>,
}

/// What a commit attempt came to: `id` is the new commit when it worked; otherwise `output` is
/// what git and its hooks printed, and `blocked` says a hook refused it.
#[derive(Clone, Debug, Default, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CommitOutcome {
    pub id: Option<String>,
    pub blocked: bool,
    pub output: String,
}

pub fn status(worktree: &Path) -> Result<Status, String> {
    // Every untracked file by name, not a collapsed folder, so each can be staged on its own.
    let out = command(&["status", "--porcelain=v2", "--branch", "--untracked-files=all", "-z"], Some(worktree)).output().map_err(|e| format!("could not run git: {e}"))?;
    if !out.status.success() {
        return Err(String::from_utf8_lossy(&out.stderr).trim().to_string());
    }
    let mut st = parse_status(&String::from_utf8_lossy(&out.stdout));
    if st.upstream.is_some() && st.behind > 0 {
        // Every upstream-only commit marked `-` has an identical patch in HEAD.
        st.rewritten = run(&["cherry", "HEAD", "@{upstream}"], Some(worktree)).is_ok_and(|t| !t.is_empty() && t.lines().all(|l| l.starts_with('-')));
    }
    st.base = Git::detect().ok().and_then(|g| g.default_branch(worktree));
    Ok(st)
}

/// Lines added and removed in one row of the branch summary.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, serde::Serialize)]
pub struct Lines {
    pub added: u64,
    pub removed: u64,
}

/// VIEW-068: the branch against the ref it is measured with: commits ahead and behind, and the
/// lines its commits changed since they parted, split into source, tests and generated files.
#[derive(Clone, Debug, Default, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Summary {
    pub against: String,
    pub ahead: u32,
    pub behind: u32,
    pub source: Lines,
    pub tests: Lines,
    pub generated: Lines,
}

#[derive(Debug, PartialEq, Eq)]
enum Kind {
    Source,
    Tests,
    Generated,
}

/// Which row of the summary a changed path counts in.
/// ponytail: names only (lock files, minified files, snapshots, a `generated` folder); reading
/// `linguist-generated` from .gitattributes comes when a repository needs it.
fn kind(path: &str) -> Kind {
    let parts: Vec<&str> = path.split('/').collect();
    let file = parts.last().copied().unwrap_or("");
    const LOCKS: [&str; 10] = ["Cargo.lock", "pnpm-lock.yaml", "package-lock.json", "yarn.lock", "bun.lockb", "poetry.lock", "Gemfile.lock", "composer.lock", "go.sum", "uv.lock"];
    if LOCKS.contains(&file) || [".min.js", ".min.css", ".map", ".snap"].iter().any(|e| file.ends_with(e)) || file.contains(".generated.") || parts.iter().any(|p| ["generated", "__generated__", "__snapshots__"].contains(p)) {
        return Kind::Generated;
    }
    let dirs = &parts[..parts.len().saturating_sub(1)];
    if dirs.iter().any(|p| ["test", "tests", "__tests__", "spec", "specs"].contains(p)) || [".test.", ".spec."].iter().any(|m| file.contains(m)) || file.starts_with("test_") || file.split('.').next().is_some_and(|stem| stem.ends_with("_test")) {
        return Kind::Tests;
    }
    Kind::Source
}

/// VIEW-068: a base pinned for the repository wins; otherwise the branch's upstream when
/// `upstream` is on and there is one, else the default branch. Lines count the commits since the
/// branch parted from that ref, so the ref's own new commits show only as "behind".
pub fn summary(worktree: &Path, pinned: Option<&str>, upstream: bool) -> Result<Summary, String> {
    let st = status(worktree)?;
    let pinned = pinned.map(str::trim).filter(|p| !p.is_empty() && run(&["rev-parse", "--verify", "-q", &format!("{p}^{{commit}}")], Some(worktree)).is_ok());
    let against = pinned.map(String::from).or(if upstream { st.upstream.clone() } else { None }).or(st.base.clone()).ok_or("no base branch to compare with")?;
    let range = format!("{against}...HEAD");
    let counts = run(&["rev-list", "--left-right", "--count", &range], Some(worktree))?;
    let mut n = counts.split_whitespace().map(|x| x.parse::<u32>().unwrap_or(0));
    let (behind, ahead) = (n.next().unwrap_or(0), n.next().unwrap_or(0));
    let mut s = Summary { against, ahead, behind, ..Summary::default() };
    for line in run(&["diff", "--numstat", "--no-renames", "-z", &range], Some(worktree))?.split('\0').filter(|l| !l.is_empty()) {
        let mut f = line.splitn(3, '\t');
        let (Some(a), Some(r), Some(path)) = (f.next(), f.next(), f.next()) else { continue };
        // A binary file shows "-" for both counts and adds no lines.
        let row = match kind(path) {
            Kind::Source => &mut s.source,
            Kind::Tests => &mut s.tests,
            Kind::Generated => &mut s.generated,
        };
        row.added += a.parse().unwrap_or(0);
        row.removed += r.parse().unwrap_or(0);
    }
    Ok(s)
}

/// What a remote action came to: `ok`, and everything git printed either way.
#[derive(Clone, Debug, Default, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ActionOutcome {
    pub ok: bool,
    pub output: String,
}

/// GIT-007: one remote action against the branch's own remote, never a target of its own:
/// `publish` pushes to origin and makes it the upstream, `force` always carries a lease, `sync`
/// is pull then push, `ff` pulls fast-forward only, `rebase` fetches and rebases onto the base
/// branch, and the rest are git's plain forms, so the user's own pull and push settings apply.
/// The output of every step is kept; a failing step stops the rest.
pub fn remote(worktree: &Path, action: &str) -> Result<ActionOutcome, String> {
    let st = status(worktree)?;
    let branch = st.branch.clone().ok_or("no branch checked out")?;
    let base = st.base.clone();
    let steps: Vec<Vec<&str>> = match action {
        "push" => vec![vec!["push"]],
        "pull" => vec![vec!["pull"]],
        "sync" => vec![vec!["pull"], vec!["push"]],
        "fetch" => vec![vec!["fetch"]],
        "ff" => vec![vec!["pull", "--ff-only"]],
        "force" => vec![vec!["push", "--force-with-lease"]],
        "publish" => vec![vec!["push", "--set-upstream", "origin", &branch]],
        "rebase" => vec![vec!["fetch"], vec!["rebase", base.as_deref().ok_or("no base branch to rebase from")?]],
        other => return Err(format!("unknown remote action {other}")),
    };
    let mut output = String::new();
    for args in steps {
        let out = command(&args, Some(worktree)).output().map_err(|e| format!("could not run git: {e}"))?;
        output.push_str(String::from_utf8_lossy(&out.stdout).trim());
        output.push_str(String::from_utf8_lossy(&out.stderr).trim());
        output.push('\n');
        if !out.status.success() {
            return Ok(ActionOutcome { ok: false, output: output.trim().to_string() });
        }
    }
    Ok(ActionOutcome { ok: true, output: output.trim().to_string() })
}

/// Parses porcelain v2 with NUL separators, so names with spaces, quotes or non-ASCII letters
/// come through as they are. A file changed in both the index and the tree is in both lists.
pub fn parse_status(text: &str) -> Status {
    let mut st = Status::default();
    let mut items = text.split('\0').filter(|s| !s.is_empty());
    let change = |path: &str, letter: char, from: Option<&str>| Change { path: path.to_string(), status: letter.to_string(), from: from.map(String::from) };
    while let Some(item) = items.next() {
        if let Some(rest) = item.strip_prefix("# ") {
            match rest.split_once(' ') {
                Some(("branch.oid", oid)) if oid != "(initial)" => st.head = Some(oid.to_string()),
                Some(("branch.head", head)) if head != "(detached)" => st.branch = Some(head.to_string()),
                Some(("branch.upstream", up)) => st.upstream = Some(up.to_string()),
                Some(("branch.ab", ab)) => {
                    for part in ab.split_whitespace() {
                        if let Some(n) = part.strip_prefix('+') {
                            st.ahead = n.parse().unwrap_or(0);
                        } else if let Some(n) = part.strip_prefix('-') {
                            st.behind = n.parse().unwrap_or(0);
                        }
                    }
                }
                _ => {}
            }
            continue;
        }
        let (kind, rest) = item.split_at(1);
        let rest = rest.trim_start();
        match kind {
            "?" => st.untracked.push(change(rest, 'U', None)),
            "1" | "2" | "u" => {
                let fields = if kind == "1" { 9 } else if kind == "2" { 10 } else { 11 };
                let mut parts = rest.splitn(fields - 1, ' ');
                let xy = parts.next().unwrap_or("..");
                let path = parts.last().unwrap_or("");
                let from = if kind == "2" { items.next() } else { None };
                let (x, y) = (xy.chars().next().unwrap_or('.'), xy.chars().nth(1).unwrap_or('.'));
                if kind == "u" {
                    st.conflicts.push(change(path, 'X', None));
                    continue;
                }
                if x != '.' {
                    st.staged.push(change(path, x, from));
                }
                if y != '.' {
                    st.changed.push(change(path, y, None));
                }
            }
            _ => {}
        }
    }
    st
}

/// GIT-002: paths are relative to the worktree and must stay inside it; anything else is refused
/// before git sees it. A folder covers every file beneath it (git does that itself).
fn check_paths(paths: &[String]) -> Result<(), String> {
    if paths.is_empty() {
        return Err("nothing to stage".into());
    }
    for p in paths {
        let path = Path::new(p);
        let inside = !p.trim().is_empty() && path.components().all(|c| matches!(c, Component::Normal(_) | Component::CurDir));
        if !inside {
            return Err(format!("{p} is outside this workspace"));
        }
    }
    Ok(())
}

/// Stages (`on`) or unstages the paths in this worktree's index. The list goes to git on its
/// standard input, NUL separated and taken literally, so any number of names fits and a name
/// holding `*` or `[` matches only itself.
pub fn stage(worktree: &Path, paths: &[String], on: bool) -> Result<(), String> {
    check_paths(paths)?;
    let args: &[&str] = if on { &["--literal-pathspecs", "add", "--pathspec-from-file=-", "--pathspec-file-nul"] } else { &["--literal-pathspecs", "restore", "--staged", "--pathspec-from-file=-", "--pathspec-file-nul"] };
    let mut child = command(args, Some(worktree)).stdin(std::process::Stdio::piped()).stdout(std::process::Stdio::piped()).stderr(std::process::Stdio::piped()).spawn().map_err(|e| format!("could not run git: {e}"))?;
    let input = paths.iter().map(|p| format!("{p}\0")).collect::<String>();
    child.stdin.take().ok_or("git has no input")?.write_all(input.as_bytes()).map_err(|e| e.to_string())?;
    let out = child.wait_with_output().map_err(|e| e.to_string())?;
    if out.status.success() {
        Ok(())
    } else {
        Err(String::from_utf8_lossy(&out.stderr).trim().to_string())
    }
}

/// GIT-004: commits what is staged with `message`. A refusal by a hook (one is installed and git
/// said no) comes back as blocked, with everything the hook printed.
pub fn commit(worktree: &Path, message: &str) -> Result<CommitOutcome, String> {
    if message.trim().is_empty() {
        return Err("a commit needs a message".into());
    }
    let mut child = command(&["commit", "--quiet", "-F", "-"], Some(worktree)).stdin(std::process::Stdio::piped()).stdout(std::process::Stdio::piped()).stderr(std::process::Stdio::piped()).spawn().map_err(|e| format!("could not run git: {e}"))?;
    child.stdin.take().ok_or("git has no input")?.write_all(message.as_bytes()).map_err(|e| e.to_string())?;
    let out = child.wait_with_output().map_err(|e| e.to_string())?;
    let output = format!("{}{}", String::from_utf8_lossy(&out.stdout), String::from_utf8_lossy(&out.stderr)).trim().to_string();
    if out.status.success() {
        let id = run(&["rev-parse", "--short", "HEAD"], Some(worktree))?;
        return Ok(CommitOutcome { id: Some(id), blocked: false, output });
    }
    Ok(CommitOutcome { id: None, blocked: has_commit_hook(worktree), output })
}

/// Is a hook installed that can refuse a commit? (`core.hooksPath` is honoured by git itself.)
fn has_commit_hook(worktree: &Path) -> bool {
    let Ok(dir) = run(&["rev-parse", "--git-path", "hooks"], Some(worktree)) else { return false };
    let dir = worktree.join(native(&dir));
    ["pre-commit", "prepare-commit-msg", "commit-msg", "pre-merge-commit"].iter().any(|h| dir.join(h).is_file())
}

#[tauri::command]
pub fn scm_status(worktree: String) -> Result<Status, String> {
    status(Path::new(&worktree))
}

#[tauri::command]
pub fn scm_summary(worktree: String, pinned: Option<String>, upstream: bool) -> Result<Summary, String> {
    summary(Path::new(&worktree), pinned.as_deref(), upstream)
}

#[tauri::command]
pub fn scm_stage(worktree: String, paths: Vec<String>, on: bool) -> Result<(), String> {
    stage(Path::new(&worktree), &paths, on)
}

#[tauri::command]
pub fn scm_commit(worktree: String, message: String) -> Result<CommitOutcome, String> {
    commit(Path::new(&worktree), &message)
}

#[tauri::command]
pub fn scm_remote(worktree: String, action: String) -> Result<ActionOutcome, String> {
    remote(Path::new(&worktree), &action)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::path::PathBuf;

    fn temp_repo(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("kolux-rs-scm-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        run(&["init", "-q", "-b", "main"], Some(&dir)).unwrap();
        run(&["config", "user.email", "test@example.com"], Some(&dir)).unwrap();
        run(&["config", "user.name", "Kolux RS test"], Some(&dir)).unwrap();
        run(&["config", "core.autocrlf", "false"], Some(&dir)).unwrap();
        fs::write(dir.join("README.md"), "hello\n").unwrap();
        run(&["add", "."], Some(&dir)).unwrap();
        run(&["commit", "-q", "-m", "first"], Some(&dir)).unwrap();
        dir
    }

    fn paths(list: &[Change]) -> Vec<&str> {
        list.iter().map(|c| c.path.as_str()).collect()
    }

    fn commit_file(dir: &Path, name: &str, text: &str) {
        fs::write(dir.join(name), text).unwrap();
        run(&["add", "."], Some(dir)).unwrap();
        run(&["commit", "-q", "-m", name], Some(dir)).unwrap();
    }

    fn counts(dir: &Path) -> (Option<String>, u32, u32, bool) {
        let st = status(dir).unwrap();
        (st.upstream, st.ahead, st.behind, st.rewritten)
    }

    #[test]
    fn remote_actions_move_commits_through_a_bare_remote_and_rebased_work_offers_a_lease() {
        let bare = std::env::temp_dir().join(format!("kolux-rs-scm-bare-{}", std::process::id()));
        let _ = fs::remove_dir_all(&bare);
        fs::create_dir_all(&bare).unwrap();
        run(&["init", "-q", "--bare", "-b", "main"], Some(&bare)).unwrap();
        let bare_url = bare.to_string_lossy().replace('\\', "/");
        let dir = temp_repo("remote");
        run(&["remote", "add", "origin", &bare_url], Some(&dir)).unwrap();
        run(&["push", "-q", "-u", "origin", "main"], Some(&dir)).unwrap();
        run(&["remote", "set-head", "origin", "main"], Some(&dir)).unwrap();
        let st = status(&dir).unwrap();
        assert_eq!((st.upstream.as_deref(), st.ahead, st.behind, st.base.as_deref()), (Some("origin/main"), 0, 0, Some("origin/main")));

        // Two local commits: push moves them and the count falls to zero (GIT-007 acceptance).
        commit_file(&dir, "one.txt", "1\n");
        commit_file(&dir, "two.txt", "2\n");
        assert_eq!(counts(&dir), (Some("origin/main".into()), 2, 0, false));
        assert!(remote(&dir, "push").unwrap().ok);
        assert_eq!(counts(&dir), (Some("origin/main".into()), 0, 0, false));

        // A new branch has no upstream until publish sets origin as its upstream.
        run(&["checkout", "-q", "-b", "feat"], Some(&dir)).unwrap();
        commit_file(&dir, "feat.txt", "f\n");
        assert_eq!(counts(&dir), (None, 0, 0, false));
        assert!(remote(&dir, "publish").unwrap().ok);
        assert_eq!(counts(&dir), (Some("origin/feat".into()), 0, 0, false));

        // Main moves on the remote; rebasing feat onto it leaves the upstream with only
        // already-held patches, so force push with lease is the next step, not pull.
        let other = std::env::temp_dir().join(format!("kolux-rs-scm-other-{}", std::process::id()));
        let _ = fs::remove_dir_all(&other);
        run(&["clone", "-q", &bare_url, &other.to_string_lossy()], None).unwrap();
        run(&["config", "user.email", "test@example.com"], Some(&other)).unwrap();
        run(&["config", "user.name", "Kolux RS test"], Some(&other)).unwrap();
        commit_file(&other, "main2.txt", "m\n");
        run(&["push", "-q"], Some(&other)).unwrap();
        assert!(remote(&dir, "rebase").unwrap().ok, "rebase from base");
        assert_eq!(counts(&dir), (Some("origin/feat".into()), 2, 1, true));
        assert!(remote(&dir, "force").unwrap().ok);
        assert_eq!(counts(&dir), (Some("origin/feat".into()), 0, 0, false));

        // A genuinely new commit on the remote is not "rewritten": nothing offers to force over it.
        run(&["fetch", "-q"], Some(&other)).unwrap();
        run(&["checkout", "-q", "-b", "feat", "origin/feat"], Some(&other)).unwrap();
        commit_file(&other, "theirs.txt", "t\n");
        run(&["push", "-q"], Some(&other)).unwrap();
        commit_file(&dir, "mine.txt", "i\n");
        assert!(remote(&dir, "fetch").unwrap().ok);
        assert_eq!(counts(&dir), (Some("origin/feat".into()), 1, 1, false));

        // Status never goes to the network: with the remote gone it still answers at once, and
        // only an explicit fetch reports the trouble.
        run(&["remote", "set-url", "origin", &format!("{bare_url}-missing")], Some(&dir)).unwrap();
        let t = std::time::Instant::now();
        for _ in 0..3 {
            status(&dir).unwrap();
        }
        assert!(t.elapsed() < std::time::Duration::from_secs(3), "status took {:?}", t.elapsed());
        let fetched = remote(&dir, "fetch").unwrap();
        assert!(!fetched.ok && !fetched.output.is_empty(), "{fetched:?}");
        assert_eq!(remote(&dir, "nope").unwrap_err(), "unknown remote action nope");
        let _ = fs::remove_dir_all(&dir);
        let _ = fs::remove_dir_all(&other);
        let _ = fs::remove_dir_all(&bare);
    }

    #[test]
    fn porcelain_v2_is_sorted_into_sections_with_awkward_names_kept_whole() {
        let text = "# branch.oid e2b3\0# branch.head main\0# branch.upstream origin/main\0# branch.ab +2 -1\0\
            1 .M N... 100644 100644 100644 7898 7898 keep.txt\0\
            2 R. N... 100644 100644 100644 6178 6178 R100 new.txt\0old.txt\0\
            1 MM N... 100644 100644 100644 f2ad b680 sub/with space.txt\0\
            1 D. N... 100644 000000 000000 f2ad 0000 gone.txt\0\
            u UU N... 100644 100644 100644 100644 1111 2222 3333 both.txt\0\
            ? a[1].txt\0? sub/ünï \"q\".txt\0";
        let st = parse_status(text);
        assert_eq!(st.branch.as_deref(), Some("main"));
        assert_eq!(st.upstream.as_deref(), Some("origin/main"));
        assert_eq!((st.ahead, st.behind), (2, 1));
        assert_eq!(paths(&st.staged), ["new.txt", "sub/with space.txt", "gone.txt"]);
        assert_eq!(st.staged[0], Change { path: "new.txt".into(), status: "R".into(), from: Some("old.txt".into()) });
        assert_eq!(st.staged[2].status, "D");
        assert_eq!(paths(&st.changed), ["keep.txt", "sub/with space.txt"], "a file changed in both places is in both lists");
        assert_eq!(paths(&st.untracked), ["a[1].txt", "sub/ünï \"q\".txt"]);
        assert_eq!(paths(&st.conflicts), ["both.txt"]);
        let detached = parse_status("# branch.oid e2b3\0# branch.head (detached)\0");
        assert_eq!(detached, Status { head: Some("e2b3".into()), ..Status::default() });
        assert_eq!(parse_status("# branch.oid (initial)\0# branch.head main\0").head, None);
    }

    #[test]
    fn staging_covers_folders_takes_names_literally_and_stays_inside_the_worktree() {
        let repo = temp_repo("stage");
        fs::create_dir_all(repo.join("sub")).unwrap();
        for f in ["sub/a.txt", "sub/b.txt", "sub/c.txt", "a[1].txt", "a1.txt"] {
            fs::write(repo.join(f), "x\n").unwrap();
        }
        // GIT-002: a folder covers every file beneath it.
        stage(&repo, &["sub".into()], true).unwrap();
        let st = status(&repo).unwrap();
        assert_eq!(paths(&st.staged), ["sub/a.txt", "sub/b.txt", "sub/c.txt"]);
        assert_eq!(paths(&st.untracked), ["a1.txt", "a[1].txt"]);
        // A name with wildcard characters never drags in other files.
        stage(&repo, &["a[1].txt".into()], true).unwrap();
        let st = status(&repo).unwrap();
        assert_eq!(paths(&st.staged), ["a[1].txt", "sub/a.txt", "sub/b.txt", "sub/c.txt"]);
        assert_eq!(paths(&st.untracked), ["a1.txt"]);
        // Unstaging a folder takes its files back out of the index, nothing else.
        stage(&repo, &["sub".into()], false).unwrap();
        let st = status(&repo).unwrap();
        assert_eq!(paths(&st.staged), ["a[1].txt"]);
        assert_eq!(st.untracked.len(), 4);
        // Paths that would leave the worktree are refused before git runs.
        for bad in ["../elsewhere", "C:\\Windows", "/etc", "sub/../../x", ""] {
            let err = stage(&repo, &[bad.to_string()], true).unwrap_err();
            assert!(err.contains("outside this workspace"), "{bad}: {err}");
        }
        assert!(stage(&repo, &[], true).unwrap_err().contains("nothing"));
        fs::remove_dir_all(&repo).unwrap();
    }

    #[test]
    fn two_thousand_files_are_staged_in_one_call() {
        let repo = temp_repo("many");
        fs::create_dir_all(repo.join("many")).unwrap();
        let names: Vec<String> = (0..2000).map(|i| format!("many/file-{i:04}.txt")).collect();
        for n in &names {
            fs::write(repo.join(n), "x\n").unwrap();
        }
        stage(&repo, &names, true).unwrap();
        let st = status(&repo).unwrap();
        assert_eq!(st.staged.len(), 2000);
        assert!(st.untracked.is_empty());
        fs::remove_dir_all(&repo).unwrap();
    }

    #[test]
    fn commit_takes_the_staged_work_and_a_refusing_hook_shows_as_blocked() {
        let repo = temp_repo("commit");
        fs::write(repo.join("README.md"), "hello\nworld\n").unwrap();
        fs::write(repo.join("later.txt"), "not yet\n").unwrap();
        assert!(commit(&repo, "  ").unwrap_err().contains("message"));
        stage(&repo, &["README.md".into()], true).unwrap();
        let done = commit(&repo, "Say world\n\nTwo lines.").unwrap();
        assert!(done.id.is_some() && !done.blocked, "{done:?}");
        assert_eq!(run(&["log", "-1", "--format=%B"], Some(&repo)).unwrap(), "Say world\n\nTwo lines.");
        let st = status(&repo).unwrap();
        assert!(st.staged.is_empty() && st.changed.is_empty(), "the sections clear");
        assert_eq!(paths(&st.untracked), ["later.txt"], "the unstaged file was left alone");
        // GIT-004: a pre-commit hook that exits 1 blocks the commit and its words come back.
        let hook = repo.join(".git").join("hooks").join("pre-commit");
        fs::create_dir_all(hook.parent().unwrap()).unwrap();
        fs::write(&hook, "#!/bin/sh\necho 'nope, said the hook'\nexit 1\n").unwrap();
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            fs::set_permissions(&hook, fs::Permissions::from_mode(0o755)).unwrap();
        }
        stage(&repo, &["later.txt".into()], true).unwrap();
        let refused = commit(&repo, "Blocked").unwrap();
        assert!(refused.id.is_none() && refused.blocked, "{refused:?}");
        assert!(refused.output.contains("nope, said the hook"), "{}", refused.output);
        assert_eq!(run(&["log", "--format=%s"], Some(&repo)).unwrap(), "Say world\nfirst", "nothing was committed");
        fs::remove_dir_all(&repo).unwrap();
    }

    #[test]
    fn the_branch_summary_counts_lines_against_the_base_split_into_source_tests_and_generated() {
        let repo = temp_repo("summary");
        run(&["checkout", "-q", "-b", "feat"], Some(&repo)).unwrap();
        // VIEW-068: commit 10 added lines and the total shows +10.
        fs::create_dir_all(repo.join("src")).unwrap();
        commit_file(&repo, "src/a.rs", &"line\n".repeat(10));
        let s = summary(&repo, None, false).unwrap();
        assert_eq!((s.against.as_str(), s.ahead, s.behind), ("main", 1, 0));
        assert_eq!((s.source, s.tests, s.generated), (Lines { added: 10, removed: 0 }, Lines::default(), Lines::default()));
        // Tests and generated files are their own rows, and the rows add up to the total.
        fs::create_dir_all(repo.join("tests")).unwrap();
        commit_file(&repo, "tests/it.rs", "a\nb\n");
        commit_file(&repo, "src/a.test.ts", "c\n");
        commit_file(&repo, "Cargo.lock", &"x\n".repeat(1500));
        fs::write(repo.join("src/a.rs"), "line\n".repeat(7)).unwrap();
        commit_file(&repo, "README.md", "hello\nworld\n");
        let s = summary(&repo, None, false).unwrap();
        assert_eq!(s.ahead, 5);
        assert_eq!(s.source, Lines { added: 8, removed: 0 }, "README +1, src/a.rs a new file of 7 lines against main");
        assert_eq!(s.tests, Lines { added: 3, removed: 0 });
        assert_eq!(s.generated, Lines { added: 1500, removed: 0 });
        // Main moving on shows as behind; the comparison is against the merge base, so main's
        // own new lines are not counted as this branch's.
        run(&["checkout", "-q", "main"], Some(&repo)).unwrap();
        commit_file(&repo, "other.txt", "o\n");
        run(&["checkout", "-q", "feat"], Some(&repo)).unwrap();
        let s = summary(&repo, None, false).unwrap();
        assert_eq!((s.ahead, s.behind, s.source.added), (5, 1, 8));
        // A pinned base wins, even with the upstream setting on; without an upstream the base is used.
        let first = run(&["rev-list", "--max-parents=0", "HEAD"], Some(&repo)).unwrap();
        run(&["branch", "pinned", first.trim()], Some(&repo)).unwrap();
        assert_eq!(summary(&repo, Some("pinned"), true).unwrap().against, "pinned");
        assert_eq!(summary(&repo, None, true).unwrap().against, "main");
        // With an upstream and the setting on, the summary measures against the upstream.
        run(&["remote", "add", "origin", &repo.display().to_string()], Some(&repo)).unwrap();
        run(&["update-ref", "refs/remotes/origin/feat", "HEAD~1"], Some(&repo)).unwrap();
        run(&["branch", "-q", "--set-upstream-to=origin/feat"], Some(&repo)).unwrap();
        let s = summary(&repo, None, true).unwrap();
        assert_eq!((s.against.as_str(), s.ahead, s.behind, s.source), ("origin/feat", 1, 0, Lines { added: 1, removed: 3 }));
        assert_eq!(status(&repo).unwrap().head, Some(run(&["rev-parse", "HEAD"], Some(&repo)).unwrap().trim().to_string()));
        let _ = fs::remove_dir_all(&repo);
    }

    #[test]
    fn paths_are_sorted_into_tests_generated_or_source() {
        for p in ["tests/a.rs", "src/__tests__/x.ts", "a/spec/b.rb", "src/x.test.tsx", "src/x.spec.js", "pkg/x_test.go", "py/test_x.py"] {
            assert_eq!(kind(p), Kind::Tests, "{p}");
        }
        for p in ["Cargo.lock", "web/pnpm-lock.yaml", "package-lock.json", "yarn.lock", "go.sum", "a/b.min.js", "x/__snapshots__/a.snap", "src/generated/api.ts"] {
            assert_eq!(kind(p), Kind::Generated, "{p}");
        }
        for p in ["src/main.rs", "README.md", "src/contest.ts", "testing.md", "latest/x.rs"] {
            assert_eq!(kind(p), Kind::Source, "{p}");
        }
    }
}
