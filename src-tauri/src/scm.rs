//! GIT-002 / GIT-004: the Source Control panel's back end: what one worktree has changed, staging
//! and unstaging by path, and committing. Every call names the worktree it acts on, so one
//! workspace's index is never touched from another's panel.

use crate::git::{command, native, run};
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
    Ok(parse_status(&String::from_utf8_lossy(&out.stdout)))
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
pub fn scm_stage(worktree: String, paths: Vec<String>, on: bool) -> Result<(), String> {
    stage(Path::new(&worktree), &paths, on)
}

#[tauri::command]
pub fn scm_commit(worktree: String, message: String) -> Result<CommitOutcome, String> {
    commit(Path::new(&worktree), &message)
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
        assert_eq!(detached, Status::default());
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
}
