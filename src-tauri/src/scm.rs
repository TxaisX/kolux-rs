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
    /// GIT-015: the operation stopped part-way (merge, rebase, cherry-pick or revert); None
    /// when there is none.
    pub operation: Option<String>,
    /// GIT-015: conflicted files whose clash markers are gone, so they only need staging.
    pub resolved: Vec<String>,
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
    st.operation = operation(worktree);
    st.resolved = st
        .conflicts
        .iter()
        .filter(|c| matches!(c.status.as_str(), "UU" | "AA"))
        .filter(|c| std::fs::read_to_string(worktree.join(&c.path)).is_ok_and(|t| !t.lines().any(|l| l.starts_with("<<<<<<<"))))
        .map(|c| c.path.clone())
        .collect();
    Ok(st)
}

/// GIT-015: which operation is stopped part-way, from the markers git leaves in this worktree's
/// own git folder (a linked worktree has its own).
fn operation(worktree: &Path) -> Option<String> {
    const MARKS: [(&str, &str); 5] = [("rebase-merge", "rebase"), ("rebase-apply", "rebase"), ("MERGE_HEAD", "merge"), ("CHERRY_PICK_HEAD", "cherry-pick"), ("REVERT_HEAD", "revert")];
    let mut args = vec!["rev-parse"];
    for (mark, _) in MARKS {
        args.extend(["--git-path", mark]);
    }
    let out = run(&args, Some(worktree)).ok()?;
    out.lines().zip(MARKS).find(|(p, _)| worktree.join(p.trim()).exists()).map(|(_, (_, op))| op.to_string())
}

/// GIT-015: aborts whichever operation is in progress, putting the worktree back where it was
/// before it began.
pub fn abort(worktree: &Path) -> Result<(), String> {
    let op = operation(worktree).ok_or("Nothing to abort: no merge, rebase, cherry-pick or revert is in progress")?;
    run(&[op.as_str(), "--abort"], Some(worktree)).map(|_| ())
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
    /// GIT-011: how many files the branch's own commits touched since it parted from the base.
    pub files: u32,
    /// GIT-011: those files, the first `COMMITTED_CAP` of them.
    pub committed: Vec<Change>,
}

/// GIT-011: the most committed files sent to the window; the count stays whole.
const COMMITTED_CAP: usize = 1000;

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
    // ponytail: an enormous branch still counts every line; a time limit on the counting comes
    // when a real branch stalls the panel.
    s.committed = name_status(&run(&["diff", "--name-status", "-M", "-z", &range], Some(worktree))?);
    s.files = s.committed.len() as u32;
    s.committed.truncate(COMMITTED_CAP);
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
    #[serde(default)]
    pub title: Option<String>,
    /// GIT-025: the branch the pull request is for, so a hand link to another branch is flagged.
    #[serde(alias = "headRefName", default)]
    pub head: Option<String>,
    #[serde(alias = "isDraft", default)]
    pub draft: bool,
}

/// What every lookup asks gh for.
const PR_FIELDS: &str = "number,url,state,title,headRefName,isDraft";

/// The GitHub CLI, which carries the user's sign-in and works with GitHub Enterprise Server too.
/// GIT-060: a GitHub (or GitHub Enterprise) repository named by a remote. `api` is the REST
/// address (api.github.com, or `/api/v3` on an Enterprise host); `key` is one per project, so
/// checkouts with different remote forms group together.
#[derive(Clone, Debug, PartialEq, Eq, serde::Serialize)]
pub struct GhRepo {
    pub host: String,
    pub owner: String,
    pub name: String,
    pub api: String,
    pub key: String,
}

impl GhRepo {
    fn new(host: String, owner: &str, name: &str) -> Self {
        let api = if host.eq_ignore_ascii_case("github.com") { "https://api.github.com".into() } else { format!("https://{host}/api/v3") };
        let key = format!("{host}/{owner}/{name}").to_lowercase();
        GhRepo { host, owner: owner.to_string(), name: name.to_string(), api, key }
    }
}

/// The real host an SSH alias stands for, from `Host` / `HostName` lines; wildcard blocks and
/// `Include` are not followed.
// ponytail: plain Host blocks only; Include and Match come if someone's config needs them.
fn ssh_host(alias: &str, config: &str) -> Option<String> {
    let mut hit = false;
    for line in config.lines().map(str::trim) {
        let (key, rest) = line.split_once(|c: char| c.is_whitespace() || c == '=').unwrap_or((line, ""));
        let rest = rest.trim_start_matches(|c: char| c.is_whitespace() || c == '=').trim();
        if key.eq_ignore_ascii_case("host") {
            hit = rest.split_whitespace().any(|h| h == alias);
        } else if hit && key.eq_ignore_ascii_case("hostname") && !rest.is_empty() {
            return Some(rest.to_string());
        }
    }
    None
}

/// GIT-060: reads HTTPS, SSH (`ssh://` or `user@host:path`), `git://` and SSH-alias remotes.
/// `ssh_config` is the text of the user's SSH config, used only for SSH forms.
pub fn github_repo(url: &str, ssh_config: &str) -> Option<GhRepo> {
    let url = url.trim();
    let (host, path, ssh) = if let Some((scheme, rest)) = url.split_once("://") {
        let ssh = match scheme {
            "https" | "http" | "git" => false,
            "ssh" | "git+ssh" => true,
            _ => return None,
        };
        let (auth, path) = rest.split_once('/')?;
        let host = auth.rsplit('@').next()?.split(':').next()?;
        (host, path, ssh)
    } else {
        // scp form; one letter before the colon is a Windows drive, not a host.
        let (auth, path) = url.split_once(':')?;
        let host = auth.rsplit('@').next()?;
        if host.len() < 2 || host.contains(['/', '\\']) {
            return None;
        }
        (host, path, true)
    };
    let path = path.trim_end_matches('/');
    let path = path.strip_suffix(".git").unwrap_or(path);
    let (owner, name) = path.split_once('/')?;
    let ok = |s: &str| !s.is_empty() && s.chars().all(|c| c.is_ascii_alphanumeric() || "-_.".contains(c));
    if host.is_empty() || !ok(owner) || !ok(name) {
        return None;
    }
    let host = if ssh { ssh_host(host, ssh_config).unwrap_or_else(|| host.to_string()) } else { host.to_string() };
    Some(GhRepo::new(host, owner, name))
}

/// The user's SSH config text, empty when there is none.
fn ssh_config() -> String {
    let home = std::env::var_os("HOME").or_else(|| std::env::var_os("USERPROFILE"));
    home.and_then(|h| std::fs::read_to_string(Path::new(&h).join(".ssh").join("config")).ok()).unwrap_or_default()
}

/// GIT-060: `HOST/OWNER/REPO` for gh's `--repo`, from origin, so gh never has to guess the host
/// from a remote it cannot read (an SSH alias, an Enterprise host).
fn gh_repo_arg(worktree: &Path, ssh_config: &str) -> Option<String> {
    let url = run(&["remote", "get-url", "origin"], Some(worktree)).ok()?;
    github_repo(&url, ssh_config).map(|g| format!("{}/{}/{}", g.host, g.owner, g.name))
}

/// GIT-060: the worktree's GitHub repository, for grouping checkouts (the Tasks picker, T-231-b).
#[tauri::command]
pub fn scm_github_repo(worktree: String) -> Option<GhRepo> {
    let url = run(&["remote", "get-url", "origin"], Some(Path::new(&worktree))).ok()?;
    github_repo(&url, &ssh_config())
}

/// GIT-066: the signed-in gh login, read from gh's own config (no network); None without gh.
pub fn gh_login() -> Option<String> {
    let out = std::process::Command::new(gh_program().ok()?).args(["config", "get", "-h", "github.com", "user"]).output().ok()?;
    let login = String::from_utf8_lossy(&out.stdout).trim().to_string();
    (out.status.success() && !login.is_empty()).then_some(login)
}

fn gh_program() -> Result<std::path::PathBuf, String> {
    crate::agents::find_program("gh").ok_or_else(|| "The GitHub CLI (gh) is not installed; install it, then run gh auth login".to_string())
}

/// GIT-028: how long one gh call may take before Kolux gives up on it.
const GH_LIMIT: std::time::Duration = std::time::Duration::from_secs(30);

/// Runs gh in the worktree with every prompt off; `input` goes to standard input. A failure
/// carries what gh printed.
fn gh_run(program: &Path, worktree: &Path, args: &[&str], input: Option<&str>) -> Result<String, String> {
    gh_run_for(program, worktree, args, input, GH_LIMIT)
}

/// GIT-028: `gh_run` with a time limit; a gh that has not finished by then is stopped.
// ponytail: stopping gh.cmd leaves a child it started running until it ends; its output is dropped.
fn gh_run_for(program: &Path, worktree: &Path, args: &[&str], input: Option<&str>, limit: std::time::Duration) -> Result<String, String> {
    use std::io::Read;
    use std::process::Stdio;
    let mut cmd = std::process::Command::new(program);
    cmd.args(args);
    // A pull request link names its own repository; everything else is pointed at origin's.
    if args.first() != Some(&"api") && !args.iter().any(|a| a.starts_with("https://")) {
        if let Some(repo) = gh_repo_arg(worktree, &ssh_config()) {
            cmd.args(["--repo", &repo]);
        }
    }
    cmd.current_dir(worktree).envs(crate::git::NO_PROMPT).env("GH_PROMPT_DISABLED", "1").env("NO_COLOR", "1");
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
    // The pipes are drained on their own threads so a chatty gh never blocks on a full pipe.
    let drain = |pipe: Option<Box<dyn Read + Send>>| {
        let (tx, rx) = std::sync::mpsc::channel();
        std::thread::spawn(move || {
            let mut text = String::new();
            if let Some(mut p) = pipe {
                let _ = p.read_to_string(&mut text);
            }
            let _ = tx.send(text);
        });
        rx
    };
    let stdout = drain(child.stdout.take().map(|p| Box::new(p) as Box<dyn Read + Send>));
    let stderr = drain(child.stderr.take().map(|p| Box::new(p) as Box<dyn Read + Send>));
    let deadline = std::time::Instant::now() + limit;
    let code = loop {
        if let Some(code) = child.try_wait().map_err(|e| format!("gh did not finish: {e}"))? {
            break code;
        }
        if std::time::Instant::now() >= deadline {
            let _ = child.kill();
            let _ = child.wait();
            let secs = limit.as_secs();
            return Err(format!("gh did not answer within {secs} second{}; try again in a moment", if secs == 1 { "" } else { "s" }));
        }
        std::thread::sleep(std::time::Duration::from_millis(50));
    };
    let out = stdout.recv().unwrap_or_default();
    let err = stderr.recv().unwrap_or_default();
    let said = format!("{}\n{}", out.trim(), err.trim()).trim().to_string();
    if code.success() { Ok(out.trim().to_string()) } else { Err(plain(&said)) }
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
    match gh_run(gh, worktree, &["pr", "view", branch, "--json", PR_FIELDS], None) {
        Ok(text) => serde_json::from_str(&text).map(Some).map_err(|e| format!("gh answered in a form Kolux cannot read: {e}")),
        Err(e) if e.to_lowercase().contains("no pull requests found") => Ok(None),
        Err(e) => Err(gh_words(&e)),
    }
}

/// GIT-025: a pull request linked by hand, read through its link wherever its branch is.
pub fn pr_link(gh: &Path, worktree: &Path, url: &str) -> Result<Pr, String> {
    let url = url.trim();
    if !safe_pr_url(url) {
        return Err("Paste a pull request link, such as https://github.com/owner/repo/pull/12".into());
    }
    let text = gh_run(gh, worktree, &["pr", "view", url, "--json", PR_FIELDS], None).map_err(|e| gh_words(&e))?;
    serde_json::from_str(&text).map_err(|e| format!("gh answered in a form Kolux cannot read: {e}"))
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
    Ok(Pr { number, url: url.to_string(), state: "OPEN".into(), title: Some(title.trim().to_string()), head: Some(branch.clone()), draft })
}

/// GIT-026: finds pull-request links in a terminal's output. The unfinished end of a chunk is
/// carried into the next, so a link split across chunks is found once it is whole; each link
/// is reported once per terminal.
#[derive(Default)]
pub struct PrScan {
    carry: String,
    seen: std::collections::HashSet<String>,
}

impl PrScan {
    pub fn feed(&mut self, chunk: &[u8]) -> Vec<String> {
        let text = std::mem::take(&mut self.carry) + &String::from_utf8_lossy(chunk);
        let is_url = |c: char| c.is_ascii_alphanumeric() || "-._~/:%?#=&+@".contains(c);
        let mut found = Vec::new();
        let mut rest = text.as_str();
        while let Some(at) = rest.find("https://") {
            let tail = &rest[at..];
            let end = tail.find(|c: char| !is_url(c));
            let Some(end) = end else {
                // The link runs to the end of the chunk: wait for the rest (a runaway is dropped).
                if tail.len() < 400 {
                    self.carry = tail.to_string();
                }
                return found;
            };
            if let Some(url) = pr_url_in(&tail[..end]) {
                if self.seen.insert(url.clone()) {
                    found.push(url);
                }
            }
            rest = &tail[end..];
        }
        // A link may start in the last few characters ("htt" before "ps://").
        let keep = rest.char_indices().rev().nth(6).map_or(0, |(i, _)| i);
        self.carry = rest[keep..].to_string();
        found
    }
}

/// GIT-026: `https://host/owner/repo/pull/<number>`, with anything after the number dropped.
fn pr_url_in(link: &str) -> Option<String> {
    let parts: Vec<&str> = link.strip_prefix("https://")?.split('/').collect();
    let number = parts.get(4).map(|n| n.split(['#', '?']).next().unwrap_or(""))?;
    let ok = parts.len() >= 5 && parts[..3].iter().all(|p| !p.is_empty()) && parts[3] == "pull" && !number.is_empty() && number.chars().all(|c| c.is_ascii_digit());
    ok.then(|| format!("https://{}/{}/{}/pull/{number}", parts[0], parts[1], parts[2]))
}

/// GIT-026: makes a printed link the workspace's linked pull request (the `scmLinkedPrs`
/// setting a hand link uses); false when it already was.
/// ponytail: a whole-settings write from the window in the same moment wins over this one.
pub fn link_printed(store: &crate::state::Store, dir: &str, url: &str) -> bool {
    let mut settings = store.settings();
    if settings["scmLinkedPrs"][dir] == url {
        return false;
    }
    if !settings["scmLinkedPrs"].is_object() {
        settings["scmLinkedPrs"] = serde_json::json!({});
    }
    settings["scmLinkedPrs"][dir] = url.into();
    store.save_settings(&settings).is_ok()
}

/// GIT-028: one of GitHub's API budgets as `gh api rate_limit` gives it; `reset` is in Unix seconds.
#[derive(Clone, Debug, PartialEq, Eq, serde::Serialize)]
pub struct Budget {
    pub name: String,
    pub limit: u64,
    pub remaining: u64,
    pub reset: u64,
}

/// GIT-028: the REST, search and GraphQL budgets left. Reading them costs no budget.
// ponytail: github.com's budget only; an Enterprise host would need its own --hostname read.
pub fn gh_budget(gh: &Path) -> Result<Vec<Budget>, String> {
    let text = gh_run(gh, &std::env::temp_dir(), &["api", "rate_limit"], None).map_err(|e| gh_words(&e))?;
    let v: serde_json::Value = serde_json::from_str(&text).map_err(|e| format!("gh answered in a form Kolux cannot read: {e}"))?;
    let read = |key: &str, name: &str| {
        let r = &v["resources"][key];
        Some(Budget { name: name.into(), limit: r["limit"].as_u64()?, remaining: r["remaining"].as_u64()?, reset: r["reset"].as_u64()? })
    };
    Ok([("core", "REST"), ("search", "Search"), ("graphql", "GraphQL")].iter().filter_map(|(k, n)| read(k, n)).collect())
}

#[tauri::command]
pub async fn scm_gh_budget() -> Result<Vec<Budget>, String> {
    tauri::async_runtime::spawn_blocking(|| gh_budget(&gh_program()?)).await.map_err(|e| e.to_string())?
}

/// GIT-033: what the merge box needs, read in one GraphQL call when the box is opened.
#[derive(Clone, Debug, Default, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MergeInfo {
    pub state: String,
    pub draft: bool,
    /// MERGEABLE, CONFLICTING or UNKNOWN (GitHub is still working it out).
    pub mergeable: String,
    /// GitHub's mergeStateStatus: CLEAN, BLOCKED, BEHIND, DIRTY, DRAFT, UNSTABLE, HAS_HOOKS or UNKNOWN.
    pub merge_state: String,
    pub review: Option<String>,
    /// The last commit's combined check state: SUCCESS, PENDING, EXPECTED, FAILURE or ERROR.
    pub checks: Option<String>,
    pub in_queue: bool,
    pub queue_enabled: bool,
    /// The method auto-merge will use, when it is on.
    pub auto_merge: Option<String>,
    /// The merge methods the repository permits, of merge, squash and rebase.
    pub methods: Vec<String>,
    pub auto_allowed: bool,
}

const MERGE_QUERY: &str = "query($owner:String!,$name:String!,$number:Int!){repository(owner:$owner,name:$name){mergeCommitAllowed squashMergeAllowed rebaseMergeAllowed autoMergeAllowed pullRequest(number:$number){state isDraft mergeable mergeStateStatus reviewDecision isInMergeQueue isMergeQueueEnabled autoMergeRequest{mergeMethod} commits(last:1){nodes{commit{statusCheckRollup{state}}}}}}}";

/// `host`, `owner`, `repo` and the number of a pull request link.
fn pr_parts(url: &str) -> Option<(String, String, String, u64)> {
    let clean = pr_url_in(url.trim())?;
    let parts: Vec<&str> = clean.strip_prefix("https://")?.split('/').collect();
    Some((parts[0].into(), parts[1].into(), parts[2].into(), parts[4].parse().ok()?))
}

pub fn merge_info(gh: &Path, worktree: &Path, url: &str) -> Result<MergeInfo, String> {
    let (host, owner, name, number) = pr_parts(url).ok_or("That is not a pull request link")?;
    let (q, o, n, k) = (format!("query={MERGE_QUERY}"), format!("owner={owner}"), format!("name={name}"), format!("number={number}"));
    let text = gh_run(gh, worktree, &["api", "graphql", "--hostname", &host, "-f", &q, "-F", &o, "-F", &n, "-F", &k], None).map_err(|e| gh_words(&e))?;
    let v: serde_json::Value = serde_json::from_str(&text).map_err(|e| format!("gh answered in a form Kolux cannot read: {e}"))?;
    let repo = &v["data"]["repository"];
    let pr = &repo["pullRequest"];
    if !pr.is_object() {
        return Err(format!("GitHub has no pull request #{number} in {owner}/{name}"));
    }
    let word = |x: &serde_json::Value| x.as_str().map(str::to_string);
    let methods = [("mergeCommitAllowed", "merge"), ("squashMergeAllowed", "squash"), ("rebaseMergeAllowed", "rebase")];
    Ok(MergeInfo {
        state: word(&pr["state"]).unwrap_or_default(),
        draft: pr["isDraft"].as_bool().unwrap_or(false),
        mergeable: word(&pr["mergeable"]).unwrap_or_else(|| "UNKNOWN".into()),
        merge_state: word(&pr["mergeStateStatus"]).unwrap_or_else(|| "UNKNOWN".into()),
        review: word(&pr["reviewDecision"]),
        checks: word(&pr["commits"]["nodes"][0]["commit"]["statusCheckRollup"]["state"]),
        in_queue: pr["isInMergeQueue"].as_bool().unwrap_or(false),
        queue_enabled: pr["isMergeQueueEnabled"].as_bool().unwrap_or(false),
        auto_merge: word(&pr["autoMergeRequest"]["mergeMethod"]).map(|m| if m == "MERGE" { "merge".into() } else { m.to_lowercase() }),
        methods: methods.iter().filter(|(f, _)| repo[*f].as_bool().unwrap_or(false)).map(|(_, m)| m.to_string()).collect(),
        auto_allowed: repo["autoMergeAllowed"].as_bool().unwrap_or(false),
    })
}

/// GIT-033: one merge-box action through gh. `queue` merges with no method, which gh turns
/// into joining the base branch's merge queue.
pub fn merge_act(gh: &Path, worktree: &Path, url: &str, action: &str, method: Option<&str>) -> Result<String, String> {
    pr_parts(url).ok_or("That is not a pull request link")?;
    let url = url.trim();
    let flag = match method {
        None => None,
        Some(m @ ("merge" | "squash" | "rebase")) => Some(format!("--{m}")),
        Some(m) => return Err(format!("{m} is not a merge method")),
    };
    let need = || flag.as_deref().ok_or("Pick a merge method first");
    let args: Vec<&str> = match action {
        "merge" => vec!["pr", "merge", url, need()?],
        "auto" => vec!["pr", "merge", url, "--auto", need()?],
        "disable-auto" => vec!["pr", "merge", url, "--disable-auto"],
        "queue" => vec!["pr", "merge", url],
        "ready" | "close" | "reopen" => vec!["pr", action, url],
        other => return Err(format!("{other} is not a pull request action")),
    };
    gh_run(gh, worktree, &args, None).map_err(|e| gh_words(&e))
}

#[tauri::command]
pub async fn scm_merge_info(worktree: String, url: String) -> Result<MergeInfo, String> {
    tauri::async_runtime::spawn_blocking(move || merge_info(&gh_program()?, Path::new(&worktree), &url)).await.map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn scm_merge(worktree: String, url: String, action: String, method: Option<String>) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || merge_act(&gh_program()?, Path::new(&worktree), &url, &action, method.as_deref())).await.map_err(|e| e.to_string())?
}

/// Only an https link to a pull request, with nothing a shell could read as an option.
fn safe_pr_url(url: &str) -> bool {
    url.starts_with("https://") && url.contains("/pull/") && !url.chars().any(|c| c.is_whitespace() || c == '"')
}

#[tauri::command]
pub async fn scm_pr(worktree: String, linked: Option<String>) -> Result<Option<Pr>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let dir = Path::new(&worktree);
        if let Some(url) = linked {
            return pr_link(&gh_program()?, dir, &url).map(Some);
        }
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

/// GIT-035: one ref drawn on a commit; `kind` is current, head (detached), branch, upstream,
/// base, remote or tag.
#[derive(Clone, Debug, PartialEq, Eq, serde::Serialize)]
pub struct Label {
    pub name: String,
    pub kind: &'static str,
}

/// GIT-035: one commit of the history; `outgoing` is here and not on the upstream, `incoming`
/// the other way round.
#[derive(Clone, Debug, PartialEq, Eq, serde::Serialize)]
pub struct Commit {
    pub hash: String,
    pub short: String,
    pub parents: Vec<String>,
    pub author: String,
    pub time: i64,
    pub subject: String,
    pub message: String,
    pub labels: Vec<Label>,
    pub outgoing: bool,
    pub incoming: bool,
}

/// The refs `git log --decorate=full` printed for one commit, sorted into kinds. A remote label
/// beside a local branch of the same name is left out, and so is a remote's HEAD.
fn labels(decor: &str, upstream: Option<&str>, base: Option<&str>) -> Vec<Label> {
    let mut out = Vec::new();
    for part in decor.split(", ").map(str::trim).filter(|p| !p.is_empty()) {
        let (name, kind) = if let Some(b) = part.strip_prefix("HEAD -> refs/heads/") {
            (b, "current")
        } else if part == "HEAD" {
            ("HEAD", "head")
        } else if let Some(t) = part.strip_prefix("tag: refs/tags/") {
            (t, "tag")
        } else if let Some(b) = part.strip_prefix("refs/heads/") {
            (b, "branch")
        } else if let Some(r) = part.strip_prefix("refs/remotes/") {
            if r.ends_with("/HEAD") {
                continue;
            }
            (r, "remote")
        } else {
            continue;
        };
        let kind = if kind == "remote" && Some(name) == upstream {
            "upstream"
        } else if (kind == "remote" && Some(name) == base) || (kind == "branch" && base.and_then(|b| b.split_once('/')).map(|(_, b)| b) == Some(name)) {
            "base"
        } else {
            kind
        };
        out.push(Label { name: name.to_string(), kind });
    }
    let locals: Vec<String> = out.iter().filter(|l| l.kind == "current" || l.kind == "branch" || (l.kind == "base" && !l.name.contains('/'))).map(|l| l.name.clone()).collect();
    out.retain(|l| !(matches!(l.kind, "remote" | "upstream" | "base") && l.name.split_once('/').is_some_and(|(_, rest)| locals.iter().any(|n| n == rest))));
    out
}

/// GIT-035: the newest `limit` commits of HEAD and its upstream in topological order, so commits
/// the upstream gained later sit apart at the top instead of inside older history. Empty for a
/// repository with no commits.
pub fn history(worktree: &Path, limit: usize) -> Result<Vec<Commit>, String> {
    if run(&["rev-parse", "--verify", "-q", "HEAD"], Some(worktree)).is_err() {
        return Ok(Vec::new());
    }
    let st = status(worktree)?;
    let count = format!("-n{limit}");
    let mut args = vec!["log", "--topo-order", count.as_str(), "--decorate=full", "--format=%H%x1f%h%x1f%P%x1f%an%x1f%at%x1f%D%x1f%s%x1f%B%x1e", "HEAD"];
    if st.upstream.is_some() {
        args.push("@{upstream}");
    }
    let text = run(&args, Some(worktree))?;
    let set = |range: &str| run(&["rev-list", range], Some(worktree)).map(|t| t.lines().map(str::to_string).collect::<std::collections::HashSet<_>>()).unwrap_or_default();
    let (outgoing, incoming) = if st.upstream.is_some() { (set("@{upstream}..HEAD"), set("HEAD..@{upstream}")) } else { Default::default() };
    Ok(text
        .split('\x1e')
        .map(|r| r.trim_start_matches(['\n', '\r']))
        .filter(|r| !r.is_empty())
        .filter_map(|r| {
            let f: Vec<&str> = r.splitn(8, '\x1f').collect();
            (f.len() == 8).then(|| Commit {
                hash: f[0].to_string(),
                short: f[1].to_string(),
                parents: f[2].split_whitespace().map(str::to_string).collect(),
                author: f[3].to_string(),
                time: f[4].parse().unwrap_or(0),
                labels: labels(f[5], st.upstream.as_deref(), st.base.as_deref()),
                subject: f[6].to_string(),
                message: f[7].trim_end().to_string(),
                outgoing: outgoing.contains(f[0]),
                incoming: incoming.contains(f[0]),
            })
        })
        .collect())
}

/// GIT-035: the files one commit changed (against its first parent; a root commit adds all).
pub fn commit_files(worktree: &Path, hash: &str) -> Result<Vec<Change>, String> {
    if hash.is_empty() || !hash.chars().all(|c| c.is_ascii_hexdigit()) {
        return Err("That is not a commit id".into());
    }
    Ok(name_status(&run(&["diff-tree", "--no-commit-id", "-r", "--root", "-M", "--name-status", "-z", hash], Some(worktree))?))
}

/// `--name-status -z` output as changes; a rename or copy carries the name it came from.
fn name_status(text: &str) -> Vec<Change> {
    let mut parts = text.split('\0').filter(|p| !p.is_empty());
    let mut out = Vec::new();
    while let Some(code) = parts.next() {
        let letter = code.chars().next().unwrap_or('M').to_string();
        if letter == "R" || letter == "C" {
            let from = parts.next().unwrap_or_default().to_string();
            let path = parts.next().unwrap_or_default().to_string();
            out.push(Change { path, status: letter, from: Some(from) });
        } else if let Some(path) = parts.next() {
            out.push(Change { path: path.to_string(), status: letter, from: None });
        }
    }
    out
}

#[tauri::command]
pub async fn scm_history(worktree: String) -> Result<Vec<Commit>, String> {
    tauri::async_runtime::spawn_blocking(move || history(Path::new(&worktree), 200)).await.map_err(|e| e.to_string())?
}

#[tauri::command]
pub fn scm_commit_files(worktree: String, hash: String) -> Result<Vec<Change>, String> {
    commit_files(Path::new(&worktree), &hash)
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
                    st.conflicts.push(Change { path: path.to_string(), status: xy.to_string(), from: None });
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
pub fn scm_abort(worktree: String) -> Result<(), String> {
    abort(Path::new(&worktree))
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
    #[test]
    fn a_gh_call_that_hangs_gives_up_after_its_time_limit() {
        let tools = std::env::temp_dir().join(format!("kolux-gh-hang-{}", std::process::id()));
        fs::create_dir_all(&tools).unwrap();
        let gh = if cfg!(windows) {
            let f = tools.join("gh.cmd");
            fs::write(&f, "@echo off\r\nping -n 30 127.0.0.1 >nul\r\necho late\r\n").unwrap();
            f
        } else {
            let f = tools.join("gh");
            fs::write(&f, "#!/bin/sh\nsleep 30\necho late\n").unwrap();
            std::process::Command::new("chmod").args(["+x", f.to_str().unwrap()]).status().unwrap();
            f
        };
        let started = std::time::Instant::now();
        let err = gh_run_for(&gh, &tools, &["pr", "view"], None, std::time::Duration::from_secs(1)).unwrap_err();
        assert!(started.elapsed() < std::time::Duration::from_secs(10), "took {:?}", started.elapsed());
        assert!(err.contains("did not answer within 1 second"), "{err}");
        let _ = fs::remove_dir_all(&tools);
    }

    fn stand_in_gh(dir: &Path) -> PathBuf {
        fs::create_dir_all(dir).unwrap();
        if cfg!(windows) {
            let file = dir.join("gh.cmd");
            let script = [
                "@echo off",
                "echo %*>>\"%~dp0calls.txt\"",
                "if \"%2\"==\"create\" goto create",
                "echo %3| findstr /b \"https\" >nul && goto linked",
                "if exist \"%~dp0made\" (",
                "  echo {\"number\":7,\"url\":\"https://github.com/o/r/pull/7\",\"state\":\"OPEN\"}",
                "  exit /b 0",
                ")",
                "echo no pull requests found for branch \"feat\" 1>&2",
                "exit /b 1",
                ":linked",
                "echo {\"number\":12,\"url\":\"https://github.com/o/r/pull/12\",\"state\":\"MERGED\",\"title\":\"Other work\",\"headRefName\":\"other\",\"isDraft\":false}",
                "exit /b 0",
                ":create",
                "more > \"%~dp0body.txt\"",
                "type nul > \"%~dp0made\"",
                "echo https://github.com/o/r/pull/7",
            ];
            fs::write(&file, script.join("\r\n")).unwrap();
            file
        } else {
            let file = dir.join("gh");
            let script = "#!/bin/sh\nd=$(dirname \"$0\")\necho \"$*\" >> \"$d/calls.txt\"\ncase \"$3\" in https*) echo '{\"number\":12,\"url\":\"https://github.com/o/r/pull/12\",\"state\":\"MERGED\",\"title\":\"Other work\",\"headRefName\":\"other\",\"isDraft\":false}'; exit 0;; esac\nif [ \"$2\" = create ]; then cat > \"$d/body.txt\"; touch \"$d/made\"; echo https://github.com/o/r/pull/7; exit 0; fi\nif [ -f \"$d/made\" ]; then echo '{\"number\":7,\"url\":\"https://github.com/o/r/pull/7\",\"state\":\"OPEN\"}'; exit 0; fi\necho 'no pull requests found for branch \"feat\"' >&2\nexit 1\n";
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
    fn a_pull_request_linked_by_hand_is_read_through_its_link_with_its_branch() {
        let dir = temp_repo("prlink");
        let tools = std::env::temp_dir().join(format!("kolux-rs-scm-prlink-gh-{}", std::process::id()));
        let _ = fs::remove_dir_all(&tools);
        let gh = stand_in_gh(&tools);
        let pr = pr_link(&gh, &dir, "https://github.com/o/r/pull/12").unwrap();
        assert_eq!((pr.number, pr.state.as_str(), pr.title.as_deref(), pr.head.as_deref(), pr.draft), (12, "MERGED", Some("Other work"), Some("other"), false));
        assert!(fs::read_to_string(tools.join("calls.txt")).unwrap().contains("headRefName"), "the branch is asked for, so a mismatch can be flagged");
        assert!(pr_link(&gh, &dir, "file:///C:/Windows/notepad.exe").unwrap_err().contains("pull request link"));
        let _ = fs::remove_dir_all(&tools);
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn history_marks_outgoing_and_incoming_commits_and_keeps_its_labels_tidy() {
        let empty = std::env::temp_dir().join(format!("kolux-rs-scm-hist-empty-{}", std::process::id()));
        let _ = fs::remove_dir_all(&empty);
        fs::create_dir_all(&empty).unwrap();
        run(&["init", "-q", "-b", "main"], Some(&empty)).unwrap();
        assert!(history(&empty, 50).unwrap().is_empty(), "a repository with no commits has no history");

        let bare = std::env::temp_dir().join(format!("kolux-rs-scm-hist-bare-{}", std::process::id()));
        let _ = fs::remove_dir_all(&bare);
        fs::create_dir_all(&bare).unwrap();
        run(&["init", "-q", "--bare", "-b", "main"], Some(&bare)).unwrap();
        let dir = temp_repo("hist");
        run(&["remote", "add", "origin", &bare.to_string_lossy().replace('\\', "/")], Some(&dir)).unwrap();
        run(&["push", "-q", "-u", "origin", "main"], Some(&dir)).unwrap();
        run(&["remote", "set-head", "origin", "main"], Some(&dir)).unwrap();
        run(&["tag", "v1"], Some(&dir)).unwrap();
        let names = |c: &Commit| {
            let mut n = c.labels.iter().map(|l| format!("{}:{}", l.kind, l.name)).collect::<Vec<_>>();
            n.sort();
            n
        };

        // main and origin/main on one commit: the remote label says nothing new and is left out.
        let h = history(&dir, 50).unwrap();
        assert_eq!(names(&h[0]), vec!["current:main", "tag:v1"]);

        // One commit only on the remote (incoming) and one only here (outgoing).
        commit_file(&dir, "two.txt", "2\n");
        run(&["push", "-q"], Some(&dir)).unwrap();
        run(&["reset", "-q", "--hard", "HEAD~1"], Some(&dir)).unwrap();
        fs::write(dir.join("three.txt"), "3\n").unwrap();
        run(&["add", "."], Some(&dir)).unwrap();
        run(&["commit", "-q", "-m", "feat: three", "-m", "A longer body that explains the change."], Some(&dir)).unwrap();
        let h = history(&dir, 50).unwrap();
        let by = |s: &str| h.iter().find(|c| c.subject == s).unwrap_or_else(|| panic!("no {s}"));
        assert_eq!((by("feat: three").outgoing, by("feat: three").incoming), (true, false));
        assert_eq!((by("two.txt").outgoing, by("two.txt").incoming), (false, true));
        assert_eq!((by("first").outgoing, by("first").incoming), (false, false));
        assert!(by("feat: three").message.contains("A longer body"));
        assert_eq!(names(by("feat: three")), vec!["current:main"]);
        assert_eq!(names(by("two.txt")), vec!["upstream:origin/main"]);
        assert_eq!(names(by("first")), vec!["tag:v1"]);
        assert_eq!(h.last().unwrap().subject, "first", "the shared root comes last");
        assert_eq!(h.len(), 3);

        // On a feature branch the local copy of the base reads as the base.
        run(&["checkout", "-q", "-b", "feat"], Some(&dir)).unwrap();
        assert_eq!(names(&history(&dir, 50).unwrap()[0]), vec!["base:main", "current:feat"]);

        // The selected commit's files.
        let files = commit_files(&dir, &by("feat: three").hash).unwrap();
        assert_eq!(paths(&files), vec!["three.txt"]);
        assert_eq!(files[0].status, "A");
        assert!(commit_files(&dir, "HEAD; rm -rf").is_err(), "only a commit id is accepted");
        let _ = fs::remove_dir_all(&dir);
        let _ = fs::remove_dir_all(&bare);
        let _ = fs::remove_dir_all(&empty);
    }

    #[test]
    fn github_repositories_are_read_from_every_remote_form() {
        let ssh = "# work account\nHost gh-work other-alias\n  HostName github.com\n  User git\n\nHost *\n  ServerAliveInterval 30\n";
        let r = |url: &str| github_repo(url, ssh).map(|g| (g.host, g.owner, g.name));
        let want = Some(("github.com".to_string(), "o".to_string(), "r".to_string()));
        for url in ["https://github.com/o/r", "https://github.com/o/r.git", "https://github.com/o/r/", "https://user@github.com/o/r.git", "http://github.com/o/r", "ssh://git@github.com/o/r.git", "ssh://git@github.com:22/o/r.git", "git@github.com:o/r.git", "github.com:o/r", "git://github.com/o/r.git", "git@gh-work:o/r.git", "ssh://git@other-alias/o/r"] {
            assert_eq!(r(url), want, "{url}");
        }
        // An HTTPS host is never an SSH alias.
        assert_eq!(r("https://gh-work/o/r").map(|x| x.0), Some("gh-work".to_string()));
        // GitHub Enterprise keeps its host and uses its own API address.
        let ghe = github_repo("git@ghe.corp.example:Team/App.git", ssh).unwrap();
        assert_eq!((ghe.host.as_str(), ghe.owner.as_str(), ghe.name.as_str()), ("ghe.corp.example", "Team", "App"));
        assert_eq!(ghe.api, "https://ghe.corp.example/api/v3");
        assert_eq!(github_repo("https://github.com/o/r", "").unwrap().api, "https://api.github.com");
        // Two checkouts of one project share a key, whatever form or case their remote uses.
        assert_eq!(github_repo("git@gh-work:O/R.git", ssh).unwrap().key, github_repo("https://github.com/o/r", "").unwrap().key);
        // Local paths and odd shapes are not GitHub repositories.
        for url in ["G:/Temp/x/remote.git", "C:\\repo\\r.git", "/srv/git/r.git", "file:///srv/o/r.git", "https://github.com/o", "https://github.com/o/r/pull/3", "", "git@github.com:o/r b.git"] {
            assert_eq!(r(url), None, "{url}");
        }

        // gh is pointed at the resolved repository, so an alias remote still finds its pull request.
        let dir = temp_repo("ghrepo");
        assert_eq!(gh_repo_arg(&dir, ssh), None, "no origin, no repository");
        run(&["remote", "add", "origin", "git@gh-work:o/r.git"], Some(&dir)).unwrap();
        assert_eq!(gh_repo_arg(&dir, ssh).as_deref(), Some("github.com/o/r"));
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
    fn git011_the_branch_row_counts_files_against_the_base_and_lists_the_committed_ones() {
        let repo = temp_repo("git011");
        run(&["checkout", "-q", "-b", "feat"], Some(&repo)).unwrap();
        // Three commits that touch five files read 3 ahead and 5 files changed.
        fs::write(repo.join("a.txt"), "a\n").unwrap();
        fs::write(repo.join("b.txt"), "b\n").unwrap();
        commit_file(&repo, "c.txt", "c\n");
        commit_file(&repo, "d.txt", "d\n");
        fs::write(repo.join("a.txt"), "a2\n").unwrap();
        commit_file(&repo, "README.md", "changed\n");
        let s = summary(&repo, None, false).unwrap();
        assert_eq!((s.ahead, s.files), (3, 5));
        let mut names = paths(&s.committed);
        names.sort();
        assert_eq!(names, ["README.md", "a.txt", "b.txt", "c.txt", "d.txt"]);
        assert_eq!(s.committed.iter().find(|c| c.path == "README.md").unwrap().status, "M");
        assert_eq!(s.committed.iter().find(|c| c.path == "d.txt").unwrap().status, "A");
        // Pointing the base at another branch changes the counts and the committed files.
        run(&["branch", "mid", "HEAD~1"], Some(&repo)).unwrap();
        let s = summary(&repo, Some("mid"), false).unwrap();
        assert_eq!((s.against.as_str(), s.ahead, s.files), ("mid", 1, 2));
        let mut names = paths(&s.committed);
        names.sort();
        assert_eq!(names, ["README.md", "a.txt"]);
        let _ = fs::remove_dir_all(&repo);
    }

    #[test]
    fn git015_conflicts_name_their_clash_and_abort_puts_the_repository_back() {
        let repo = temp_repo("git015");
        run(&["checkout", "-q", "-b", "other"], Some(&repo)).unwrap();
        commit_file(&repo, "README.md", "theirs\n");
        commit_file(&repo, "new.txt", "theirs\n");
        run(&["checkout", "-q", "main"], Some(&repo)).unwrap();
        commit_file(&repo, "README.md", "ours\n");
        commit_file(&repo, "new.txt", "ours\n");
        let before = run(&["rev-parse", "HEAD"], Some(&repo)).unwrap();
        assert!(abort(&repo).unwrap_err().contains("Nothing"));
        assert!(run(&["merge", "other"], Some(&repo)).is_err());
        let st = status(&repo).unwrap();
        assert_eq!(st.operation.as_deref(), Some("merge"));
        let mut clashes: Vec<(&str, &str)> = st.conflicts.iter().map(|c| (c.path.as_str(), c.status.as_str())).collect();
        clashes.sort();
        assert_eq!(clashes, [("README.md", "UU"), ("new.txt", "AA")]);
        assert!(st.resolved.is_empty());
        // A file fixed by hand reads as resolved here before it is staged.
        fs::write(repo.join("README.md"), "both\n").unwrap();
        assert_eq!(status(&repo).unwrap().resolved, ["README.md"]);
        // Abort puts the repository back where it was before the merge.
        abort(&repo).unwrap();
        let st = status(&repo).unwrap();
        assert_eq!((st.operation.clone(), st.conflicts.len(), st.changed.len()), (None, 0, 0));
        assert_eq!(run(&["rev-parse", "HEAD"], Some(&repo)).unwrap(), before);
        // A rebase is aborted as a rebase.
        run(&["checkout", "-q", "other"], Some(&repo)).unwrap();
        let other = run(&["rev-parse", "HEAD"], Some(&repo)).unwrap();
        assert!(run(&["rebase", "main"], Some(&repo)).is_err());
        assert_eq!(status(&repo).unwrap().operation.as_deref(), Some("rebase"));
        abort(&repo).unwrap();
        let st = status(&repo).unwrap();
        assert_eq!((st.operation, st.branch.as_deref()), (None, Some("other")));
        assert_eq!(run(&["rev-parse", "HEAD"], Some(&repo)).unwrap(), other);
        let _ = fs::remove_dir_all(&repo);
    }

    #[test]
    fn git026_a_pull_request_link_printed_in_a_terminal_attaches_once_even_split_across_chunks() {
        let mut scan = PrScan::default();
        assert!(scan.feed(b"Creating pull request for feat into main\r\n\r\nhttps://github.com/o/r/pu").is_empty());
        assert_eq!(scan.feed(b"ll/42\r\n"), ["https://github.com/o/r/pull/42"]);
        // The same link printed again is handled once.
        assert!(scan.feed(b"see https://github.com/o/r/pull/42 again\n").is_empty());
        // Colour codes around a link, an Enterprise host, and a path after the number.
        assert_eq!(scan.feed(b"\x1b[36mhttps://git.example.com/team/app/pull/7/files\x1b[0m\n"), ["https://git.example.com/team/app/pull/7"]);
        // Links that are not a pull request's.
        assert!(scan.feed(b"https://github.com/o/r/issues/3 https://github.com/o/r/pull/ https://github.com/o/pull/9 \n").is_empty());
        // A link split inside its scheme.
        assert!(scan.feed(b"htt").is_empty());
        assert_eq!(scan.feed(b"ps://github.com/o/r/pull/8 "), ["https://github.com/o/r/pull/8"]);
        // The link becomes the workspace's linked pull request, once, beside other settings.
        let dir = std::env::temp_dir().join(format!("kolux-rs-scm-git026-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        let store = crate::state::Store::open(&dir).unwrap();
        store.save_settings(&serde_json::json!({ "uiLook": "classic", "scmLinkedPrs": { "C:/other": "https://github.com/o/r/pull/1" } })).unwrap();
        assert!(link_printed(&store, "C:/ws", "https://github.com/o/r/pull/42"));
        assert!(!link_printed(&store, "C:/ws", "https://github.com/o/r/pull/42"));
        let s = store.settings();
        assert_eq!(s["scmLinkedPrs"]["C:/ws"], "https://github.com/o/r/pull/42");
        assert_eq!(s["scmLinkedPrs"]["C:/other"], "https://github.com/o/r/pull/1");
        assert_eq!(s["uiLook"], "classic");
        drop(store);
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn git033_merge_state_and_actions_go_through_gh_for_the_pull_requests_own_repository() {
        let tools = std::env::temp_dir().join(format!("kolux-rs-scm-git033-{}", std::process::id()));
        let _ = fs::remove_dir_all(&tools);
        fs::create_dir_all(&tools).unwrap();
        let answer = r#"{"data":{"repository":{"mergeCommitAllowed":false,"squashMergeAllowed":true,"rebaseMergeAllowed":false,"autoMergeAllowed":true,"pullRequest":{"state":"OPEN","isDraft":false,"mergeable":"MERGEABLE","mergeStateStatus":"BLOCKED","reviewDecision":null,"isInMergeQueue":false,"isMergeQueueEnabled":false,"autoMergeRequest":{"mergeMethod":"SQUASH"},"commits":{"nodes":[{"commit":{"statusCheckRollup":{"state":"PENDING"}}}]}}}}}"#;
        fs::write(tools.join("answer.json"), answer).unwrap();
        let gh = if cfg!(windows) {
            let f = tools.join("gh.cmd");
            fs::write(&f, "@echo off\r\necho %*>>\"%~dp0calls.txt\"\r\nif \"%1\"==\"api\" type \"%~dp0answer.json\"\r\n").unwrap();
            f
        } else {
            let f = tools.join("gh");
            fs::write(&f, "#!/bin/sh\necho \"$*\" >> \"$(dirname \"$0\")/calls.txt\"\n[ \"$1\" = api ] && cat \"$(dirname \"$0\")/answer.json\"\nexit 0\n").unwrap();
            std::process::Command::new("chmod").args(["+x", f.to_str().unwrap()]).status().unwrap();
            f
        };
        let url = "https://git.example.com/o/r/pull/42";
        let m = merge_info(&gh, &tools, url).unwrap();
        assert_eq!((m.state.as_str(), m.draft, m.mergeable.as_str(), m.merge_state.as_str()), ("OPEN", false, "MERGEABLE", "BLOCKED"));
        assert_eq!((m.review.clone(), m.checks.as_deref(), m.in_queue, m.queue_enabled), (None, Some("PENDING"), false, false));
        assert_eq!((m.auto_merge.as_deref(), m.methods.clone(), m.auto_allowed), (Some("squash"), vec!["squash".to_string()], true));
        for (action, method) in [("auto", Some("squash")), ("merge", Some("rebase")), ("disable-auto", None), ("queue", None), ("ready", None), ("close", None), ("reopen", None)] {
            merge_act(&gh, &tools, url, action, method).unwrap();
        }
        assert!(merge_act(&gh, &tools, url, "merge", None).unwrap_err().contains("merge method"));
        assert!(merge_act(&gh, &tools, url, "delete", None).is_err());
        assert!(merge_act(&gh, &tools, "https://x/o/r/issues/1", "close", None).is_err());
        let calls = fs::read_to_string(tools.join("calls.txt")).unwrap();
        let calls: Vec<&str> = calls.lines().map(str::trim).collect();
        assert!(calls[0].starts_with("api graphql --hostname git.example.com "), "{}", calls[0]);
        assert!(calls[0].contains("owner=o") && calls[0].contains("name=r") && calls[0].contains("number=42") && !calls[0].contains("--repo"), "{}", calls[0]);
        let rest: Vec<String> = calls[1..].iter().map(|c| c.to_string()).collect();
        assert_eq!(
            rest,
            [
                format!("pr merge {url} --auto --squash"),
                format!("pr merge {url} --rebase"),
                format!("pr merge {url} --disable-auto"),
                format!("pr merge {url}"),
                format!("pr ready {url}"),
                format!("pr close {url}"),
                format!("pr reopen {url}"),
            ]
        );
        let _ = fs::remove_dir_all(&tools);
    }

    #[test]
    fn git028_the_github_budget_reads_rest_search_and_graphql_from_gh() {
        let tools = std::env::temp_dir().join(format!("kolux-rs-scm-git028-{}", std::process::id()));
        let _ = fs::remove_dir_all(&tools);
        fs::create_dir_all(&tools).unwrap();
        let answer = r#"{"resources":{"core":{"limit":5000,"used":20,"remaining":4980,"reset":1760000000},"search":{"limit":30,"used":30,"remaining":0,"reset":1760000060},"graphql":{"limit":5000,"used":1,"remaining":4999,"reset":1760003600},"code_search":{"limit":10,"remaining":10,"reset":1}},"rate":{"limit":5000}}"#;
        fs::write(tools.join("answer.json"), answer).unwrap();
        let gh = if cfg!(windows) {
            let f = tools.join("gh.cmd");
            fs::write(&f, "@echo off\r\necho %*>>\"%~dp0calls.txt\"\r\ntype \"%~dp0answer.json\"\r\n").unwrap();
            f
        } else {
            let f = tools.join("gh");
            fs::write(&f, "#!/bin/sh\necho \"$*\" >> \"$(dirname \"$0\")/calls.txt\"\ncat \"$(dirname \"$0\")/answer.json\"\n").unwrap();
            std::process::Command::new("chmod").args(["+x", f.to_str().unwrap()]).status().unwrap();
            f
        };
        let b = gh_budget(&gh).unwrap();
        let rows: Vec<(&str, u64, u64, u64)> = b.iter().map(|x| (x.name.as_str(), x.limit, x.remaining, x.reset)).collect();
        assert_eq!(rows, [("REST", 5000, 4980, 1760000000), ("Search", 30, 0, 1760000060), ("GraphQL", 5000, 4999, 1760003600)]);
        assert_eq!(fs::read_to_string(tools.join("calls.txt")).unwrap().trim(), "api rate_limit");
        // A budget gh leaves out is left out, not shown as zero.
        fs::write(tools.join("answer.json"), r#"{"resources":{"core":{"limit":60,"remaining":59,"reset":5}}}"#).unwrap();
        assert_eq!(gh_budget(&gh).unwrap().len(), 1);
        let _ = fs::remove_dir_all(&tools);
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
