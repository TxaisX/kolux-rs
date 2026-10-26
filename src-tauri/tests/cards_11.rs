//! spec/11 P0 boxes GIT-001..GIT-007 (batch 1): the Source Control back end against real `git`.
//! Every repository is a fresh `git init` under the scratch root G:\Temp\cards-v3\, every "remote" a
//! local bare repository beside it; git's own config files are replaced by empty scratch files.

use kolux_rs_lib::scm::{commit, discard_paths, remote, stage, status, Change, Status};
use serde_json::{json, Value};
use std::path::{Path, PathBuf};
use std::process::Command;

const ROOT: &str = r"G:\Temp\cards-v3";

fn norm(p: &Path) -> String {
    p.to_string_lossy().replace('\\', "/").to_lowercase()
}

/// A fresh folder under the scratch root; refuses to run when the agent homes are not redirected there,
/// and points git away from the user's config before any repository exists.
fn scratch(tag: &str) -> PathBuf {
    for var in ["CLAUDE_CONFIG_DIR", "CODEX_HOME", "USERPROFILE", "HOME"] {
        let v = std::env::var(var).unwrap_or_default();
        assert!(norm(Path::new(&v)).starts_with(&norm(Path::new(ROOT))), "{var} must point under {ROOT}, not {v}");
    }
    let base = Path::new(ROOT).join("git11");
    std::fs::create_dir_all(&base).unwrap();
    static ONCE: std::sync::Once = std::sync::Once::new();
    ONCE.call_once(|| {
        let empty = base.join("empty.gitconfig");
        std::fs::write(&empty, "").unwrap();
        std::env::set_var("GIT_CONFIG_GLOBAL", &empty);
        std::env::set_var("GIT_CONFIG_SYSTEM", &empty);
        std::env::set_var("GIT_CONFIG_NOSYSTEM", "1");
        std::env::set_var("GIT_TERMINAL_PROMPT", "0");
        for (k, v) in [("GIT_AUTHOR_NAME", "Card Tester"), ("GIT_COMMITTER_NAME", "Card Tester"), ("GIT_AUTHOR_EMAIL", "card@example.invalid"), ("GIT_COMMITTER_EMAIL", "card@example.invalid")] {
            std::env::set_var(k, v);
        }
    });
    let d = base.join(format!("{tag}-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&d);
    std::fs::create_dir_all(&d).unwrap();
    std::fs::write(d.join(".kolux-rs-scratch"), "").unwrap();
    d
}

/// Real git in `dir` (always a scratch repository); stdout trimmed, panics on failure.
fn g(dir: &Path, args: &[&str]) -> String {
    assert!(norm(dir).starts_with(&norm(Path::new(ROOT))), "git would run outside the scratch root: {dir:?}");
    let out = Command::new("git").args(args).current_dir(dir).output().unwrap();
    assert!(out.status.success(), "git {args:?}: {}", String::from_utf8_lossy(&out.stderr));
    String::from_utf8_lossy(&out.stdout).trim().to_string()
}

fn write(dir: &Path, rel: &str, text: &str) {
    let p = dir.join(rel);
    std::fs::create_dir_all(p.parent().unwrap()).unwrap();
    std::fs::write(p, text).unwrap();
}

/// A repo on `main` with one commit.
fn repo(d: &Path, name: &str) -> PathBuf {
    let w = d.join(name);
    std::fs::create_dir_all(&w).unwrap();
    g(&w, &["init", "-q", "-b", "main"]);
    write(&w, "seed.txt", "seed\n");
    g(&w, &["add", "."]);
    g(&w, &["commit", "-q", "-m", "seed"]);
    w
}

/// A repo whose origin is a local bare repository, main pushed and tracking.
fn with_origin(d: &Path) -> (PathBuf, PathBuf) {
    let bare = d.join("origin.git");
    std::fs::create_dir_all(&bare).unwrap();
    g(&bare, &["init", "-q", "--bare", "-b", "main"]);
    let w = repo(d, "work");
    g(&w, &["remote", "add", "origin", &bare.to_string_lossy()]);
    g(&w, &["push", "-q", "-u", "origin", "main"]);
    (w, bare)
}

fn paths(rows: &[Change]) -> Vec<String> {
    rows.iter().map(|c| c.path.clone()).collect()
}

/// The status as the window receives it, minus the commit id (it differs every run).
fn snapshot(st: &Status) -> Value {
    let mut v = serde_json::to_value(st).unwrap();
    v.as_object_mut().unwrap().remove("head");
    v
}

static STATES: std::sync::Mutex<()> = std::sync::Mutex::new(());

/// Writes the real statuses the TS proofs replay; callers hold the STATES lock.
fn save_states(key: &str, states: Value) {
    let file = Path::new(env!("CARGO_MANIFEST_DIR")).join("../evidence/cards-GIT-states.json");
    let mut all: Value = std::fs::read_to_string(&file).ok().and_then(|t| serde_json::from_str(&t).ok()).unwrap_or(json!({}));
    all[key] = states;
    std::fs::write(&file, serde_json::to_string_pretty(&all).unwrap() + "\n").unwrap();
}

#[test]
fn git001_box1_an_edited_a_staged_and_a_new_file_make_three_sections_with_the_right_counts_and_lines() {
    let d = scratch("g1b1");
    let w = repo(&d, "w");
    write(&w, "a.txt", "one\ntwo\nthree\n");
    write(&w, "b.txt", "x\ny\n");
    g(&w, &["add", "."]);
    g(&w, &["commit", "-q", "-m", "files"]);
    write(&w, "a.txt", "one\nTWO\nthree\nfour\nfive\n"); // edited, not staged: +3 -1
    write(&w, "b.txt", "x\ny\nz\n"); // staged: +1
    g(&w, &["add", "b.txt"]);
    write(&w, "c.txt", "1\n2\n3\n4\n"); // new: +4
    let st = status(&w).unwrap();
    assert_eq!(paths(&st.staged), ["b.txt"]);
    assert_eq!(paths(&st.changed), ["a.txt"]);
    assert_eq!(paths(&st.untracked), ["c.txt"]);
    assert_eq!((st.staged[0].status.as_str(), st.changed[0].status.as_str(), st.untracked[0].status.as_str()), ("M", "M", "U"));
    assert_eq!(st.lines.staged.get("b.txt"), Some(&[1, 0]));
    assert_eq!(st.lines.changed.get("a.txt"), Some(&[3, 1]));
    assert_eq!(st.lines.untracked.get("c.txt"), Some(&[4, 0]));
    assert!(st.conflicts.is_empty());
}

#[test]
fn git002_box1_staging_a_folder_stages_all_three_files_beneath_it_and_a_wildcard_name_matches_only_itself() {
    let d = scratch("g2b1");
    let w = repo(&d, "w");
    for f in ["dir/one.txt", "dir/sub/two.txt", "dir/three.txt", "[x]a.txt", "other.txt", "xa.txt"] {
        write(&w, f, "n\n");
    }
    stage(&w, &["dir".to_string()], true).unwrap();
    let st = status(&w).unwrap();
    let mut staged = paths(&st.staged);
    staged.sort();
    assert_eq!(staged, ["dir/one.txt", "dir/sub/two.txt", "dir/three.txt"].iter().map(|s| s.to_string()).collect::<std::collections::BTreeSet<_>>().into_iter().collect::<Vec<_>>());
    assert!(st.untracked.iter().all(|c| !c.path.starts_with("dir")), "nothing under dir is left unstaged");
    // Paths are literal: a name with wildcard characters stages only itself.
    stage(&w, &["[x]a.txt".to_string()], true).unwrap();
    let st = status(&w).unwrap();
    assert!(paths(&st.staged).contains(&"[x]a.txt".to_string()));
    assert!(!paths(&st.staged).contains(&"xa.txt".to_string()) && !paths(&st.staged).contains(&"other.txt".to_string()));
    // A folder unstages as one, and a path beyond the worktree is refused.
    stage(&w, &["dir".to_string()], false).unwrap();
    assert!(!paths(&status(&w).unwrap().staged).iter().any(|p| p.starts_with("dir/")));
    assert!(stage(&w, &["../outside.txt".to_string()], true).is_err());
}

#[test]
fn git002_box2_two_thousand_files_are_all_staged_with_no_error() {
    let d = scratch("g2b2");
    let w = repo(&d, "w");
    let names: Vec<String> = (0..2000).map(|i| format!("bulk/file-with-a-fairly-long-name-to-grow-the-command-line-{i:04}.txt")).collect();
    for n in &names {
        write(&w, n, "x\n");
    }
    stage(&w, &names, true).unwrap();
    let st = status(&w).unwrap();
    assert!(st.untracked.is_empty() && st.changed.is_empty());
    assert_eq!(st.staged.len(), 2000);
    assert_eq!(g(&w, &["diff", "--cached", "--name-only"]).lines().count(), 2000, "git's index holds every one");
    // Unstaging the same 2,000 also works.
    stage(&w, &names, false).unwrap();
    assert_eq!(g(&w, &["diff", "--cached", "--name-only"]).lines().count(), 0);
}

#[test]
fn git003_box1_discarding_an_untracked_file_removes_it_for_good() {
    let d = scratch("g3b1");
    let w = repo(&d, "w");
    write(&w, "notes.txt", "scribble\n");
    assert!(w.join("notes.txt").exists());
    discard_paths(&w, &["notes.txt".to_string()]).unwrap();
    assert!(!w.join("notes.txt").exists());
    assert!(status(&w).unwrap().untracked.is_empty());
    assert!(g(&w, &["log", "--all", "--format=%H", "--", "notes.txt"]).is_empty(), "no commit holds it: nothing to recover");
    // A deleted tracked file comes back, a modified one loses its edits.
    std::fs::remove_file(w.join("seed.txt")).unwrap();
    discard_paths(&w, &["seed.txt".to_string()]).unwrap();
    assert_eq!(std::fs::read_to_string(w.join("seed.txt")).unwrap(), "seed\n");
    write(&w, "seed.txt", "edited\n");
    discard_paths(&w, &["seed.txt".to_string()]).unwrap();
    assert_eq!(std::fs::read_to_string(w.join("seed.txt")).unwrap(), "seed\n");
}

fn link(target: &Path, at: &Path) -> std::io::Result<()> {
    #[cfg(windows)]
    return if target.is_dir() { std::os::windows::fs::symlink_dir(target, at) } else { std::os::windows::fs::symlink_file(target, at) };
    #[cfg(unix)]
    return std::os::unix::fs::symlink(target, at);
}

#[test]
fn git003_box3_discarding_a_changed_symbolic_link_leaves_the_file_beyond_the_repository_alone() {
    let d = scratch("g3b3");
    let w = repo(&d, "w");
    g(&w, &["config", "core.symlinks", "true"]);
    let (outside, other, outdir) = (d.join("outside.txt"), d.join("other.txt"), d.join("outdir"));
    std::fs::write(&outside, "precious\n").unwrap();
    std::fs::write(&other, "other\n").unwrap();
    std::fs::create_dir_all(&outdir).unwrap();
    std::fs::write(outdir.join("keep.txt"), "keep\n").unwrap();
    link(&outside, &w.join("ln")).expect("SYMLINK-UNAVAILABLE: creating a symbolic link needs developer mode or elevation");
    g(&w, &["add", "ln"]);
    g(&w, &["commit", "-q", "-m", "link"]);
    // Change the link: it now points at another file beyond the repository.
    std::fs::remove_file(w.join("ln")).unwrap();
    link(&other, &w.join("ln")).unwrap();
    assert_eq!(status(&w).unwrap().changed.len(), 1, "the link shows as changed");
    // An untracked link aimed at a folder beyond the repository.
    link(&outdir, &w.join("dirlink")).unwrap();
    discard_paths(&w, &["ln".to_string(), "dirlink".to_string()]).unwrap();
    assert_eq!(std::fs::read_to_string(&outside).unwrap(), "precious\n");
    assert_eq!(std::fs::read_to_string(&other).unwrap(), "other\n");
    assert_eq!(std::fs::read_to_string(outdir.join("keep.txt")).unwrap(), "keep\n");
    assert!(std::fs::symlink_metadata(w.join("dirlink")).is_err(), "the untracked link itself is gone");
    let st = status(&w).unwrap();
    assert!(st.changed.is_empty() && st.untracked.is_empty(), "the tracked link is back as committed");
}

#[test]
fn git004_box1_staged_file_and_a_message_make_exactly_one_new_commit_and_a_clean_panel() {
    let d = scratch("g4b1");
    let w = repo(&d, "w");
    let before: u32 = g(&w, &["rev-list", "--count", "HEAD"]).parse().unwrap();
    write(&w, "f.txt", "hello\n");
    stage(&w, &["f.txt".to_string()], true).unwrap();
    let out = commit(&w, "Add f").unwrap();
    assert!(out.id.is_some() && !out.blocked);
    let after: u32 = g(&w, &["rev-list", "--count", "HEAD"]).parse().unwrap();
    assert_eq!(after, before + 1);
    assert_eq!(g(&w, &["log", "-1", "--format=%s"]), "Add f");
    let st = status(&w).unwrap();
    assert!(st.staged.is_empty() && st.changed.is_empty() && st.untracked.is_empty());
    assert!(commit(&w, "  \n").is_err(), "a blank message is refused");
}

#[test]
fn git004_box3_a_pre_commit_hook_that_exits_1_blocks_the_commit_and_what_it_printed_comes_back() {
    let d = scratch("g4b3");
    let w = repo(&d, "w");
    let hook = w.join(".git/hooks/pre-commit");
    std::fs::write(&hook, "#!/bin/sh\necho \"lint: forbidden word found in f.txt\"\nexit 1\n").unwrap();
    write(&w, "f.txt", "hello\n");
    stage(&w, &["f.txt".to_string()], true).unwrap();
    let before = g(&w, &["rev-list", "--count", "HEAD"]);
    let out = commit(&w, "Add f").unwrap();
    assert!(out.id.is_none() && out.blocked, "{out:?}");
    assert!(out.output.contains("lint: forbidden word found in f.txt"), "{:?}", out.output);
    assert_eq!(g(&w, &["rev-list", "--count", "HEAD"]), before, "nothing was committed");
    assert_eq!(paths(&status(&w).unwrap().staged), ["f.txt"], "the work stays staged");
}

#[test]
fn git006_box1_and_2_a_new_branch_walks_edit_stage_commit_publish_and_a_rebase_is_a_rewrite() {
    let _lock = STATES.lock().unwrap_or_else(|e| e.into_inner());
    let d = scratch("g6");
    let (w, _bare) = with_origin(&d);
    g(&w, &["switch", "-q", "-c", "feat"]);
    write(&w, "seed.txt", "seed\nmore\n");
    let edited = status(&w).unwrap(); // edit: changed, nothing staged
    assert_eq!((edited.changed.len(), edited.staged.len(), edited.upstream.clone()), (1, 0, None));
    stage(&w, &["seed.txt".to_string()], true).unwrap();
    let staged = status(&w).unwrap();
    assert_eq!((staged.staged.len(), staged.changed.len()), (1, 0));
    assert!(commit(&w, "Extend seed").unwrap().id.is_some());
    let committed = status(&w).unwrap(); // clean, never pushed
    assert!(committed.staged.is_empty() && committed.upstream.is_none() && committed.branch.as_deref() == Some("feat"));
    assert!(remote(&w, "publish").unwrap().ok);
    let published = status(&w).unwrap();
    assert_eq!((published.upstream.as_deref(), published.ahead, published.behind, published.rewritten), (Some("origin/feat"), 0, 0, false));
    // Rebase onto a base that moved: same patches, new ids.
    g(&w, &["switch", "-q", "main"]);
    write(&w, "base.txt", "base moved\n");
    g(&w, &["add", "."]);
    g(&w, &["commit", "-q", "-m", "base moves"]);
    g(&w, &["push", "-q", "origin", "main"]);
    g(&w, &["switch", "-q", "feat"]);
    g(&w, &["rebase", "-q", "main"]);
    let rebased = status(&w).unwrap();
    assert!(rebased.rewritten, "{rebased:?}");
    assert!(rebased.ahead > 0 && rebased.behind > 0);
    assert!(remote(&w, "force").unwrap().ok);
    let forced = status(&w).unwrap();
    assert_eq!((forced.ahead, forced.behind, forced.rewritten), (0, 0, false));
    save_states("git006", json!({ "edited": snapshot(&edited), "staged": snapshot(&staged), "committed": snapshot(&committed), "published": snapshot(&published), "rebased": snapshot(&rebased), "forced": snapshot(&forced) }));
}

#[test]
fn git007_box1_two_local_commits_are_two_to_push_and_pushing_brings_the_counts_to_zero() {
    let _lock = STATES.lock().unwrap_or_else(|e| e.into_inner());
    let d = scratch("g7");
    let (w, bare) = with_origin(&d);
    write(&w, "one.txt", "1\n");
    g(&w, &["add", "."]);
    g(&w, &["commit", "-q", "-m", "one"]);
    write(&w, "two.txt", "2\n");
    g(&w, &["add", "."]);
    g(&w, &["commit", "-q", "-m", "two"]);
    let two = status(&w).unwrap();
    assert_eq!((two.ahead, two.behind, two.upstream.as_deref()), (2, 0, Some("origin/main")));
    let out = remote(&w, "push").unwrap();
    assert!(out.ok, "{out:?}");
    let zero = status(&w).unwrap();
    assert_eq!((zero.ahead, zero.behind), (0, 0));
    assert_eq!(g(&bare, &["rev-parse", "main"]), g(&w, &["rev-parse", "HEAD"]), "origin holds both commits");
    save_states("git007", json!({ "two": snapshot(&two), "zero": snapshot(&zero) }));
}
