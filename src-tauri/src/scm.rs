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

/// GIT-065: whether a workspace's commits are on its remote, for the sidebar badge. `state` is
/// synced, ahead (`count` commits not pushed), unpublished (no upstream; `count` commits past the
/// base) or unknown (the count could not be read, which is never shown as synced).
#[derive(Clone, Debug, PartialEq, Eq, serde::Serialize)]
pub struct Pushed {
    pub path: String,
    pub state: &'static str,
    pub count: u32,
}

/// GIT-065: None while HEAD is detached. Reads only refs git already has, never the network.
pub fn pushed(worktree: &Path) -> Option<Pushed> {
    run(&["symbolic-ref", "-q", "HEAD"], Some(worktree)).ok()?;
    let count = |range: &str| run(&["rev-list", "--count", range], Some(worktree)).ok().and_then(|n| n.parse::<u32>().ok());
    let (state, n) = if run(&["rev-parse", "--verify", "-q", "@{upstream}"], Some(worktree)).is_ok() {
        match count("@{upstream}..HEAD") {
            Some(0) => ("synced", Some(0)),
            n => ("ahead", n),
        }
    } else {
        ("unpublished", Git::detect().ok().and_then(|g| g.default_branch(worktree)).and_then(|b| count(&format!("{b}..HEAD"))))
    };
    let path = worktree.display().to_string();
    Some(match n {
        Some(count) => Pushed { path, state, count },
        None => Pushed { path, state: "unknown", count: 0 },
    })
}

/// GIT-065: the badge for each listed workspace, read off the UI thread (the sidebar asks every
/// few seconds).
#[tauri::command]
pub async fn scm_pushed(worktrees: Vec<String>) -> Vec<Pushed> {
    tauri::async_runtime::spawn_blocking(move || worktrees.iter().filter_map(|w| pushed(Path::new(w))).collect()).await.unwrap_or_default()
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

/// CLI-021: every file `worktree` differs from `base` in, committed and uncommitted work together
/// (untracked files as `U`). Committed work counts from where the branch parted from the base, or
/// from the base itself when they share no history; with no base, only the uncommitted work.
pub fn changes(worktree: &Path, base: Option<&str>) -> Result<Vec<Change>, String> {
    let since = match base {
        Some(b) => run(&["merge-base", b, "HEAD"], Some(worktree)).unwrap_or_else(|_| b.to_string()),
        None => "HEAD".to_string(),
    };
    let mut out = Vec::new();
    let diff = run(&["diff", "--name-status", "--no-renames", "-z", &since, "--"], Some(worktree))?;
    let mut parts = diff.split('\0').filter(|s| !s.is_empty());
    while let (Some(st), Some(path)) = (parts.next(), parts.next()) {
        out.push(Change { path: path.to_string(), status: st.chars().take(1).collect(), from: None });
    }
    for path in run(&["ls-files", "--others", "--exclude-standard", "-z"], Some(worktree))?.split('\0').filter(|s| !s.is_empty()) {
        out.push(Change { path: path.to_string(), status: "U".into(), from: None });
    }
    out.sort_by(|a, b| a.path.cmp(&b.path));
    Ok(out)
}

/// CLI-021: would two committed tips merge cleanly? Never "clean" unless Git said so.
#[derive(Debug, PartialEq, Eq)]
pub enum Clash {
    Clean,
    Conflict(Vec<String>),
    Unverifiable(String),
}

pub fn clash(repo: &Path, a: &str, b: &str) -> Clash {
    match command(&["merge-tree", "--write-tree", "--name-only", "--no-messages", a, b], Some(repo)).output() {
        Err(e) => Clash::Unverifiable(format!("could not run git: {e}")),
        Ok(o) => clash_of(o.status.code(), &String::from_utf8_lossy(&o.stdout), &String::from_utf8_lossy(&o.stderr)),
    }
}

/// `git merge-tree --write-tree`: 0 merges cleanly, 1 conflicts (the tree id, then the files);
/// anything else (an old Git, unrelated histories, a missing commit) cannot be checked.
fn clash_of(code: Option<i32>, out: &str, err: &str) -> Clash {
    match code {
        Some(0) => Clash::Clean,
        Some(1) => Clash::Conflict(out.lines().skip(1).take_while(|l| !l.is_empty()).map(String::from).collect()),
        _ => Clash::Unverifiable(err.lines().next().map(str::trim).filter(|l| !l.is_empty()).unwrap_or("git could not check the merge").to_string()),
    }
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
    /// GIT-009: what kind of failure it was (see `failure_kind`); None when it worked.
    pub kind: Option<&'static str>,
    /// GIT-009: for a hook failure, what an agent is handed: the end of the hook's output with
    /// colour codes removed and a capped list of the files in the push.
    pub detail: Option<String>,
}

/// GIT-009: sorts a failed push, pull or fetch by what git and the remote printed: protected,
/// sign-in, network, submodule, non-fast-forward, hook (a remote hook, or a local pre-push hook
/// when `local_hook` says one ran) or other.
pub fn failure_kind(output: &str, local_hook: bool) -> &'static str {
    let t = output.to_lowercase();
    let any = |words: &[&str]| words.iter().any(|w| t.contains(w));
    if any(&["protected branch", "gh006", "gl-protected"]) {
        "protected"
    } else if any(&["authentication failed", "could not read username", "could not read password", "terminal prompts disabled", "permission denied (publickey", "invalid username or password", "returned error: 403", "returned error: 401"]) {
        "sign-in"
    } else if any(&["could not resolve host", "connection refused", "connection timed out", "timed out", "network is unreachable", "failed to connect", "connection reset"]) {
        "network"
    } else if t.contains("submodule") {
        "submodule"
    } else if any(&["non-fast-forward", "(fetch first)", "[rejected]", "stale info"]) {
        "non-fast-forward"
    } else if t.contains("hook declined") || local_hook {
        "hook"
    } else {
        "other"
    }
}

/// Removes terminal colour and cursor codes (ESC [ ... letter) from hook output.
fn plain(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    let mut chars = text.chars().peekable();
    while let Some(c) = chars.next() {
        if c == '\u{1b}' {
            if chars.peek() == Some(&'[') {
                chars.next();
                for n in chars.by_ref() {
                    if n.is_ascii_alphabetic() {
                        break;
                    }
                }
            }
            continue;
        }
        out.push(c);
    }
    out
}

/// GIT-009: the end of the hook output (40 lines at most) and the files the push carries (30 at
/// most), for the agent asked to fix it.
fn hook_detail(worktree: &Path, output: &str, against: Option<&str>) -> String {
    let text = plain(output);
    let lines: Vec<&str> = text.lines().collect();
    let tail = lines[lines.len().saturating_sub(40)..].join("\n");
    let range = format!("{}..HEAD", against.unwrap_or("HEAD~1"));
    let files: Vec<String> = run(&["diff", "--name-only", &range], Some(worktree)).unwrap_or_default().lines().map(String::from).collect();
    let mut shown: Vec<String> = files.iter().take(30).map(|f| format!("- {f}")).collect();
    if files.len() > 30 {
        shown.push(format!("- and {} more", files.len() - 30));
    }
    format!("{tail}\n\nFiles in this push:\n{}", shown.join("\n"))
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
        // GIT-005: the last step of commit then pull and push: the new commit is rebased onto
        // what the remote gained, then pushed.
        "pullpush" => vec![vec!["pull", "--rebase"], vec!["push"]],
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
            let pushing = args[0] == "push";
            let hooks = run(&["rev-parse", "--git-path", "hooks"], Some(worktree)).map(|d| worktree.join(native(&d))).ok();
            let local_hook = pushing && hooks.is_some_and(|d| d.join("pre-push").is_file());
            let kind = failure_kind(&output, local_hook);
            let detail = (kind == "hook").then(|| hook_detail(worktree, &output, st.upstream.as_deref().or(base.as_deref())));
            return Ok(ActionOutcome { ok: false, output: plain(output.trim()), kind: Some(kind), detail });
        }
    }
    Ok(ActionOutcome { ok: true, output: output.trim().to_string(), kind: None, detail: None })
}

/// GIT-021: a branch's pull request as `gh pr view --json number,url,state` gives it; `state`
/// is OPEN, MERGED or CLOSED.
#[derive(Clone, Debug, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub struct Pr {
    pub number: u64,
    pub url: String,
    pub state: String,
}

/// The GitHub CLI, which carries the user's sign-in and works with GitHub Enterprise Server too.
fn gh_program() -> Result<std::path::PathBuf, String> {
    crate::agents::find_program("gh").ok_or_else(|| "The GitHub CLI (gh) is not installed; install it, then run gh auth login".to_string())
}

/// Runs gh in the worktree with every prompt off; `input` goes to standard input. A failure
/// carries what gh printed.
// ponytail: no time limit yet; a stuck gh holds only this call. GIT-028's limits come with T-176-b.
fn gh_run(program: &Path, worktree: &Path, args: &[&str], input: Option<&str>) -> Result<String, String> {
    use std::process::Stdio;
    let mut cmd = std::process::Command::new(program);
    cmd.args(args).current_dir(worktree).envs(crate::git::NO_PROMPT).env("GH_PROMPT_DISABLED", "1").env("NO_COLOR", "1");
    cmd.stdin(if input.is_some() { Stdio::piped() } else { Stdio::null() }).stdout(Stdio::piped()).stderr(Stdio::piped());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x0800_0000);
    }
    let mut child = cmd.spawn().map_err(|e| format!("could not run gh: {e}"))?;
    if let (Some(text), Some(mut pipe)) = (input, child.stdin.take()) {
        pipe.write_all(text.as_bytes()).map_err(|e| format!("could not hand gh the description: {e}"))?;
    }
    let out = child.wait_with_output().map_err(|e| format!("gh did not finish: {e}"))?;
    let said = format!("{}\n{}", String::from_utf8_lossy(&out.stdout).trim(), String::from_utf8_lossy(&out.stderr).trim()).trim().to_string();
    if out.status.success() { Ok(String::from_utf8_lossy(&out.stdout).trim().to_string()) } else { Err(plain(&said)) }
}

/// GIT-023: gh's failures in the words the panel shows.
pub fn gh_words(said: &str) -> String {
    let low = said.to_lowercase();
    if low.contains("known github host") || low.contains("not a github") {
        "This remote's host is not supported; pull requests need a GitHub remote".into()
    } else if low.contains("gh auth login") || low.contains("not logged in") || low.contains("authentication") {
        "Sign in to GitHub first: run gh auth login".into()
    } else {
        said.trim().to_string()
    }
}

/// GIT-021 / GIT-023: the branch's pull request, None when it has none. Err when gh cannot
/// say (signed out, offline, another host), so creation is refused rather than risking a second.
pub fn pr_find(gh: &Path, worktree: &Path, branch: &str) -> Result<Option<Pr>, String> {
    match gh_run(gh, worktree, &["pr", "view", branch, "--json", "number,url,state"], None) {
        Ok(text) => serde_json::from_str(&text).map(Some).map_err(|e| format!("gh answered in a form Kolux cannot read: {e}")),
        Err(e) if e.to_lowercase().contains("no pull requests found") => Ok(None),
        Err(e) => Err(gh_words(&e)),
    }
}

/// GIT-021: creates the branch's pull request against `base` on origin, pushing unpushed work
/// first. An open one the branch already has is returned instead of a second being made. The
/// head must still be checked out and ahead of the base, with no uncommitted tracked change.
pub fn pr_create(gh: &Path, worktree: &Path, title: &str, body: &str, base: &str, draft: bool) -> Result<Pr, String> {
    let st = status(worktree)?;
    let branch = st.branch.clone().ok_or("No branch is checked out here; check out the head branch first")?;
    let base = base.trim().trim_start_matches("origin/");
    if base.is_empty() || base == branch {
        return Err(format!("{branch} is the base branch; move to a feature branch first"));
    }
    if !st.staged.is_empty() || !st.changed.is_empty() || !st.conflicts.is_empty() {
        return Err("Commit or stash the changes to tracked files first".into());
    }
    let remote_base = format!("refs/remotes/origin/{base}");
    if run(&["rev-parse", "--verify", "-q", &remote_base], Some(worktree)).is_err() {
        let local = run(&["rev-parse", "--verify", "-q", &format!("refs/heads/{base}")], Some(worktree)).is_ok();
        return Err(if local { format!("{base} is only on this computer; publish it, then create the pull request") } else { format!("origin has no branch {base}; pick another base") });
    }
    // Counted again now, not taken from the panel's last refresh.
    let ahead = run(&["rev-list", "--count", &format!("{remote_base}..HEAD")], Some(worktree)).ok().and_then(|n| n.parse::<u32>().ok()).unwrap_or(0);
    if ahead == 0 {
        return Err(format!("No commits ahead of {base}; there is nothing to review"));
    }
    if title.trim().is_empty() {
        return Err("Write a title first".into());
    }
    match pr_find(gh, worktree, &branch)? {
        Some(pr) if pr.state == "OPEN" => return Ok(pr),
        Some(pr) if pr.state == "MERGED" => return Err(format!("Pull request #{} for {branch} is already merged", pr.number)),
        _ => {}
    }
    let push: Vec<&str> = if st.upstream.is_none() { vec!["push", "--set-upstream", "origin", &branch] } else { vec!["push"] };
    if st.upstream.is_none() || st.ahead > 0 {
        let out = command(&push, Some(worktree)).envs(crate::git::NO_PROMPT).output().map_err(|e| format!("could not run git: {e}"))?;
        if !out.status.success() {
            return Err(format!("Push failed, so no pull request was made: {}", plain(String::from_utf8_lossy(&out.stderr).trim())));
        }
    }
    let mut args = vec!["pr", "create", "--title", title.trim(), "--body-file", "-", "--base", base, "--head", &branch];
    if draft {
        args.push("--draft");
    }
    let said = gh_run(gh, worktree, &args, Some(body)).map_err(|e| gh_words(&e))?;
    let url = said.lines().rev().map(str::trim).find(|l| l.contains("/pull/")).ok_or_else(|| format!("gh did not say where the pull request is: {said}"))?;
    let number = url.rsplit('/').next().and_then(|n| n.parse().ok()).ok_or_else(|| format!("gh gave a link without a number: {url}"))?;
    Ok(Pr { number, url: url.to_string(), state: "OPEN".into() })
}

/// Only an https link to a pull request, with nothing a shell could read as an option.
fn safe_pr_url(url: &str) -> bool {
    url.starts_with("https://") && url.contains("/pull/") && !url.chars().any(|c| c.is_whitespace() || c == '"')
}

#[tauri::command]
pub async fn scm_pr(worktree: String) -> Result<Option<Pr>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let dir = Path::new(&worktree);
        let branch = status(dir)?.branch.ok_or("No branch is checked out here")?;
        pr_find(&gh_program()?, dir, &branch)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn scm_pr_create(worktree: String, title: String, body: String, base: String, draft: bool) -> Result<Pr, String> {
    tauri::async_runtime::spawn_blocking(move || pr_create(&gh_program()?, Path::new(&worktree), &title, &body, &base, draft)).await.map_err(|e| e.to_string())?
}

/// Opens a pull request in the browser.
#[tauri::command]
pub fn scm_open_pr(url: String) -> Result<(), String> {
    if !safe_pr_url(&url) {
        return Err("That is not a pull request link".into());
    }
    #[cfg(windows)]
    let opener = "explorer.exe";
    #[cfg(target_os = "macos")]
    let opener = "open";
    #[cfg(all(unix, not(target_os = "macos")))]
    let opener = "xdg-open";
    std::process::Command::new(opener).arg(url).spawn().map(|_| ()).map_err(|e| e.to_string())
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

    /// A stand-in for gh: `pr view` finds nothing until `pr create` has run, every call is noted
    /// in calls.txt and the description read from standard input lands in body.txt.
    fn stand_in_gh(dir: &Path) -> PathBuf {
        fs::create_dir_all(dir).unwrap();
        if cfg!(windows) {
            let file = dir.join("gh.cmd");
            let script = [
                "@echo off",
                "echo %*>>\"%~dp0calls.txt\"",
                "if \"%2\"==\"create\" goto create",
                "if exist \"%~dp0made\" (",
                "  echo {\"number\":7,\"url\":\"https://github.com/o/r/pull/7\",\"state\":\"OPEN\"}",
                "  exit /b 0",
                ")",
                "echo no pull requests found for branch \"feat\" 1>&2",
                "exit /b 1",
                ":create",
                "more > \"%~dp0body.txt\"",
                "type nul > \"%~dp0made\"",
                "echo https://github.com/o/r/pull/7",
            ];
            fs::write(&file, script.join("\r\n")).unwrap();
            file
        } else {
            let file = dir.join("gh");
            let script = "#!/bin/sh\nd=$(dirname \"$0\")\necho \"$*\" >> \"$d/calls.txt\"\nif [ \"$2\" = create ]; then cat > \"$d/body.txt\"; touch \"$d/made\"; echo https://github.com/o/r/pull/7; exit 0; fi\nif [ -f \"$d/made\" ]; then echo '{\"number\":7,\"url\":\"https://github.com/o/r/pull/7\",\"state\":\"OPEN\"}'; exit 0; fi\necho 'no pull requests found for branch \"feat\"' >&2\nexit 1\n";
            fs::write(&file, script).unwrap();
            #[cfg(unix)]
            {
                use std::os::unix::fs::PermissionsExt;
                fs::set_permissions(&file, fs::Permissions::from_mode(0o755)).unwrap();
            }
            file
        }
    }

    #[test]
    fn a_pull_request_is_made_once_after_the_branch_is_pushed_and_states_that_cannot_have_one_are_refused() {
        let bare = std::env::temp_dir().join(format!("kolux-rs-scm-pr-bare-{}", std::process::id()));
        let _ = fs::remove_dir_all(&bare);
        fs::create_dir_all(&bare).unwrap();
        run(&["init", "-q", "--bare", "-b", "main"], Some(&bare)).unwrap();
        let dir = temp_repo("pr");
        run(&["remote", "add", "origin", &bare.to_string_lossy().replace('\\', "/")], Some(&dir)).unwrap();
        run(&["push", "-q", "-u", "origin", "main"], Some(&dir)).unwrap();
        run(&["remote", "set-head", "origin", "main"], Some(&dir)).unwrap();
        let tools = std::env::temp_dir().join(format!("kolux-rs-scm-pr-gh-{}", std::process::id()));
        let _ = fs::remove_dir_all(&tools);
        let gh = stand_in_gh(&tools);
        let calls = || fs::read_to_string(tools.join("calls.txt")).unwrap_or_default();

        // GIT-023: on the default branch there is nothing to compare.
        let err = pr_create(&gh, &dir, "Title", "", "main", false).unwrap_err();
        assert!(err.contains("feature branch"), "{err}");

        run(&["checkout", "-q", "-b", "feat"], Some(&dir)).unwrap();
        let err = pr_create(&gh, &dir, "Title", "", "main", false).unwrap_err();
        assert!(err.contains("No commits"), "{err}");
        commit_file(&dir, "feat.txt", "f\n");

        // GIT-021: uncommitted tracked changes block it; a base only on this computer says what to do.
        fs::write(dir.join("README.md"), "changed\n").unwrap();
        let err = pr_create(&gh, &dir, "Title", "", "main", false).unwrap_err();
        assert!(err.contains("Commit or stash"), "{err}");
        run(&["checkout", "--", "README.md"], Some(&dir)).unwrap();
        run(&["branch", "only-here", "main"], Some(&dir)).unwrap();
        let err = pr_create(&gh, &dir, "Title", "", "only-here", false).unwrap_err();
        assert!(err.contains("only on this computer"), "{err}");
        assert!(calls().is_empty(), "nothing reached gh while the branch could not have a PR");

        // None yet; creating pushes the unpublished branch first, then hands gh the title, base,
        // head and draft flag, with the description on standard input.
        assert_eq!(pr_find(&gh, &dir, "feat").unwrap(), None);
        let pr = pr_create(&gh, &dir, "Add feat", "Why:\nbecause", "origin/main", true).unwrap();
        assert_eq!((pr.number, pr.url.as_str(), pr.state.as_str()), (7, "https://github.com/o/r/pull/7", "OPEN"));
        assert!(run(&["rev-parse", "--verify", "refs/heads/feat"], Some(&bare)).is_ok(), "the branch was pushed first");
        let said = calls();
        assert!(said.contains("pr create") && said.contains("--draft") && said.contains("--base main") && said.contains("--head feat"), "{said}");
        assert!(fs::read_to_string(tools.join("body.txt")).unwrap().contains("because"));

        // A second create links the PR the branch already has instead of making another.
        assert_eq!(pr_create(&gh, &dir, "Add feat", "", "main", false).unwrap().number, 7);
        assert_eq!(calls().matches("pr create").count(), 1);

        // gh's own failures come back in plain words.
        assert!(gh_words("none of the git remotes configured for this repository point to a known GitHub host").contains("not supported"));
        assert!(gh_words("To get started with GitHub CLI, please run:  gh auth login").contains("Sign in"));
        let _ = fs::remove_dir_all(&tools);
        let _ = fs::remove_dir_all(&bare);
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn only_a_plain_https_pull_request_link_is_opened() {
        assert!(safe_pr_url("https://github.com/o/r/pull/7"));
        assert!(safe_pr_url("https://git.example.com/o/r/pull/12"));
        assert!(!safe_pr_url("file:///C:/Windows/System32/calc.exe"));
        assert!(!safe_pr_url("https://github.com/o/r/pull/7 --flag"));
        assert!(!safe_pr_url("https://github.com/o/r/issues/7"));
    }

    #[test]
    fn push_failures_are_sorted_by_kind() {
        let kind = |text: &str| failure_kind(text, false);
        assert_eq!(kind("remote: error: GH006: Protected branch update failed for refs/heads/main.\n ! [remote rejected] main -> main (protected branch hook declined)"), "protected");
        assert_eq!(kind("fatal: Authentication failed for 'https://github.com/a/b.git/'"), "sign-in");
        assert_eq!(kind("fatal: could not read Username for 'https://github.com': terminal prompts disabled"), "sign-in");
        assert_eq!(kind("git@github.com: Permission denied (publickey).\nfatal: Could not read from remote repository."), "sign-in");
        assert_eq!(kind("fatal: unable to access 'https://github.com/a/b.git/': Could not resolve host: github.com"), "network");
        assert_eq!(kind(" ! [rejected]        main -> main (fetch first)\nerror: failed to push some refs"), "non-fast-forward");
        assert_eq!(kind("The following submodule paths contain changes that can\nnot be found on any remote:\n  lib"), "submodule");
        assert_eq!(kind(" ! [remote rejected] main -> main (pre-receive hook declined)"), "hook");
        assert_eq!(failure_kind("lint: 2 problems\nerror: failed to push some refs to 'origin'", true), "hook");
        assert_eq!(kind("error: something odd"), "other");
    }

    #[test]
    fn a_failing_pre_push_hook_hands_its_output_and_files_to_an_agent_and_commit_then_pull_and_push_works() {
        let bare = std::env::temp_dir().join(format!("kolux-rs-scm-hook-{}", std::process::id()));
        let _ = fs::remove_dir_all(&bare);
        fs::create_dir_all(&bare).unwrap();
        run(&["init", "-q", "--bare", "-b", "main"], Some(&bare)).unwrap();
        let dir = temp_repo("hook");
        run(&["remote", "add", "origin", &bare.to_string_lossy().replace('\\', "/")], Some(&dir)).unwrap();
        run(&["push", "-q", "-u", "origin", "main"], Some(&dir)).unwrap();
        commit_file(&dir, "login.ts", "x\n");
        let hook = dir.join(".git").join("hooks").join("pre-push");
        fs::write(&hook, "#!/bin/sh\nprintf '\\033[31mlint: 2 problems in login.ts\\033[0m\\n' >&2\nexit 1\n").unwrap();
        let out = remote(&dir, "push").unwrap();
        assert!(!out.ok);
        assert_eq!(out.kind, Some("hook"), "{}", out.output);
        let detail = out.detail.unwrap();
        assert!(detail.contains("lint: 2 problems in login.ts"), "{detail}");
        assert!(!detail.contains('\u{1b}'), "colour codes are removed: {detail:?}");
        assert!(!out.output.contains(char::from(27)), "and from the notice");
        assert!(detail.contains("Files in this push:\n- login.ts"), "{detail}");

        // Commit then pull (rebasing onto the remote) and push: the commit lands on the remote.
        fs::remove_file(&hook).unwrap();
        commit_file(&dir, "two.txt", "2\n");
        let done = remote(&dir, "pullpush").unwrap();
        assert!(done.ok, "{}", done.output);
        assert_eq!((done.kind, counts(&dir).1), (None, 0));
        let _ = fs::remove_dir_all(&dir);
        let _ = fs::remove_dir_all(&bare);
    }

    #[test]
    fn the_sidebar_badge_counts_unpushed_commits_and_never_calls_an_unreadable_count_synced() {
        let state = |dir: &Path| pushed(dir).map(|p| (p.state, p.count));
        let bare = std::env::temp_dir().join(format!("kolux-rs-scm-pushed-{}", std::process::id()));
        let _ = fs::remove_dir_all(&bare);
        fs::create_dir_all(&bare).unwrap();
        run(&["init", "-q", "--bare", "-b", "main"], Some(&bare)).unwrap();
        let dir = temp_repo("pushed");
        run(&["remote", "add", "origin", &bare.to_string_lossy().replace('\\', "/")], Some(&dir)).unwrap();
        run(&["push", "-q", "-u", "origin", "main"], Some(&dir)).unwrap();
        assert_eq!(state(&dir), Some(("synced", 0)));
        commit_file(&dir, "one.txt", "1\n");
        commit_file(&dir, "two.txt", "2\n");
        assert_eq!(state(&dir), Some(("ahead", 2)), "two commits not pushed");
        run(&["push", "-q"], Some(&dir)).unwrap();
        assert_eq!(state(&dir), Some(("synced", 0)), "pushing clears it");

        // A branch never published counts what it holds past the base.
        run(&["switch", "-q", "-c", "feature"], Some(&dir)).unwrap();
        commit_file(&dir, "three.txt", "3\n");
        assert_eq!(state(&dir), Some(("unpublished", 1)));
        // The base cannot be read: it cannot be checked, never synced.
        run(&["remote", "set-head", "origin", "main"], Some(&dir)).unwrap();
        let origin_main = dir.join(".git").join("refs").join("remotes").join("origin").join("main");
        fs::write(&origin_main, "0123456789012345678901234567890123456789\n").unwrap();
        assert_eq!(state(&dir), Some(("unknown", 0)));

        run(&["switch", "-q", "--detach"], Some(&dir)).unwrap();
        assert_eq!(state(&dir), None, "a detached HEAD has no branch to push");
        let _ = fs::remove_dir_all(&dir);
        let _ = fs::remove_dir_all(&bare);
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
