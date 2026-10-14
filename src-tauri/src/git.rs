//! The git runner: every git operation goes through the `git` program on the user's path, run
//! with `std::process::Command`. Checked once at startup (`git --version`), never shelled through
//! a terminal. Worktrees are the unit of work: one branch in one folder of its own (PROJ-020).
//! GIT-067: removal deletes the branch only when no other worktree has it checked out and says
//! at which commit a kept branch was left, so it can be deleted later only while unmoved; moves
//! go through `git worktree move` so Git's records stay right; a base ref that is not a plain
//! ref spelling (leading dash, blanks, `..`) is never handed to git.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::{Duration, Instant};

/// PROJ-027: how long a worktree list, or a check made before a removal, may take before it is stopped.
pub const LIST_LIMIT: Duration = Duration::from_secs(30);
/// PROJ-027 (COMPAT): lengthens the worktree-add limit, in milliseconds.
pub const ADD_LIMIT_ENV: &str = "KOLUX_WORKTREE_ADD_TIMEOUT_MS";

/// PROJ-074: the hidden folder beside a workspace that the workspace is moved into when deleted.
pub fn trash_dir(dest: &Path) -> Option<PathBuf> {
    dest.parent().map(|p| p.join(".kolux-trash"))
}

/// PROJ-074: nanoseconds since 1970; a trash entry's name ends with the one it was moved at.
pub fn stamp_now() -> u128 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_nanos()).unwrap_or(0)
}

/// PROJ-074: moves `dest` into the trash beside it and gives its new place; None when it will not
/// move (Windows may hold a folder a moment after a program in it ended), and the caller then
/// deletes it where it is.
fn to_trash(dest: &Path) -> Option<PathBuf> {
    let trash = trash_dir(dest)?;
    std::fs::create_dir_all(&trash).ok()?;
    hide(&trash);
    let to = trash.join(format!("{}-{}", dest.file_name()?.to_string_lossy(), stamp_now()));
    for attempt in 0..6 {
        // another removal's background pass may just have deleted the emptied trash folder
        let _ = std::fs::create_dir_all(&trash);
        match std::fs::rename(dest, &to) {
            Ok(()) => return Some(to),
            Err(_) if attempt < 5 => std::thread::sleep(Duration::from_millis(250)),
            Err(_) => {}
        }
    }
    let _ = std::fs::remove_dir(&trash);
    None
}

#[cfg(windows)]
fn hide(dir: &Path) {
    use std::os::windows::ffi::OsStrExt;
    use windows_sys::Win32::Storage::FileSystem::{GetFileAttributesW, SetFileAttributesW, FILE_ATTRIBUTE_HIDDEN, INVALID_FILE_ATTRIBUTES};
    let wide: Vec<u16> = dir.as_os_str().encode_wide().chain(Some(0)).collect();
    // SAFETY: `wide` is a NUL-terminated UTF-16 path that outlives both calls.
    unsafe {
        let now = GetFileAttributesW(wide.as_ptr());
        if now != INVALID_FILE_ATTRIBUTES {
            SetFileAttributesW(wide.as_ptr(), now | FILE_ATTRIBUTE_HIDDEN);
        }
    }
}

#[cfg(not(windows))]
fn hide(_dir: &Path) {}

/// PROJ-074: deletes what an earlier run left in a trash folder, whatever it is named, then the
/// folder itself once empty. An entry moved there at or after `started` belongs to a removal
/// running now and is left to it; anything that will not delete waits for the next sweep.
pub fn sweep_trash(trash: &Path, started: u128) {
    if let Ok(entries) = std::fs::read_dir(trash) {
        for e in entries.flatten() {
            let name = e.file_name().to_string_lossy().to_string();
            let moved = name.rsplit('-').next().and_then(|n| n.parse::<u128>().ok());
            if moved.is_some_and(|m| m >= started) {
                continue;
            }
            let p = e.path();
            let _ = if p.is_dir() { std::fs::remove_dir_all(&p) } else { std::fs::remove_file(&p) };
        }
    }
    let _ = std::fs::remove_dir(trash);
}

/// PROJ-027: three minutes, or the variable's value held between three and thirty minutes.
pub fn add_limit_of(value: Option<&str>) -> Duration {
    let (least, most) = (180_000, 1_800_000);
    Duration::from_millis(value.and_then(|v| v.trim().parse::<u64>().ok()).map_or(least, |ms| ms.clamp(least, most)))
}

pub fn add_limit() -> Duration {
    add_limit_of(std::env::var(ADD_LIMIT_ENV).ok().as_deref())
}

/// PROJ-064: how a branch stands against its remote. With an upstream, `ahead` is the commits not
/// pushed to it; without one (or when it is gone), the commits on no remote at all.
#[derive(Clone, Debug, PartialEq, Eq, serde::Serialize)]
pub struct Push {
    pub ahead: u32,
    pub upstream: bool,
}

#[derive(Clone, Debug)]
pub struct Git {
    pub version: String,
}

/// One worktree of a repository, as `git worktree list --porcelain` reports it.
#[derive(Clone, Debug, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Worktree {
    pub path: String,
    pub branch: Option<String>,
    pub head: String,
    pub is_main: bool,
    /// The name the user typed when creating it (PROJ-021); the branch is shown when there is none.
    pub name: Option<String>,
    /// The workspace it was made from (PROJ-047), by path; the sidebar nests it there.
    pub parent: Option<String>,
    /// PROJ-070: set when Git has the worktree locked; the reason, empty when none was given.
    pub locked: Option<String>,
    /// PROJ-064: commits not pushed; set by the sidebar's list, None elsewhere.
    pub push: Option<Push>,
    /// The user hid it from the sidebar (PROJ-042); the main checkout never is.
    pub hidden: bool,
    /// PROJ-044: "main", "managed" (Kolux made it) or "external"; empty until the project's list sets it.
    pub kind: String,
    /// For an external worktree, where its visibility comes from (`visibility.rs`).
    pub source: Option<String>,
    /// AUTO-024: who made it, from Kolux's record of how it came to be ("app", "cli" or
    /// "automation"); none when Kolux has no record.
    pub made_by: Option<String>,
    /// VIEW-038: the issue or pull request number it is linked to, so the palette finds it by number.
    pub number: Option<u64>,
    /// EDIT-047: the comment it was made with (`worktree create --comment`); the palette shows it.
    pub comment: Option<String>,
}

/// GIT-063: what an unattended git is given, so it fails at once instead of waiting on a password
/// prompt no one can see, Git Credential Manager's window included. Saved credentials still work.
pub const NO_PROMPT: [(&str, &str); 2] = [("GIT_TERMINAL_PROMPT", "0"), ("GCM_INTERACTIVE", "never")];

#[cfg(test)]
thread_local! {
    /// Tests only: when set, every git this thread starts writes git's own trace2 event log to
    /// this file (inherited by anything that git starts in turn), so a test sees each process.
    pub(crate) static TRACE2: std::cell::RefCell<Option<PathBuf>> = const { std::cell::RefCell::new(None) };
    /// Tests only: when set, every git this thread starts reads only the repository's own config:
    /// an empty global file, no system file, and nothing the parent process injected (config
    /// pairs or a password helper), so a test's result never depends on this PC's git setup.
    pub(crate) static ISOLATED: std::cell::Cell<bool> = const { std::cell::Cell::new(false) };
}

/// Tests only: an empty file to stand in for the user's global git config.
#[cfg(test)]
pub(crate) fn empty_global_config() -> PathBuf {
    let path = std::env::temp_dir().join("kolux-rs-test-empty-gitconfig");
    if std::fs::metadata(&path).map(|m| m.len() != 0).unwrap_or(true) {
        let _ = std::fs::write(&path, "");
    }
    path
}

pub(crate) fn command(args: &[&str], cwd: Option<&Path>) -> Command {
    let mut cmd = Command::new("git");
    cmd.args(args);
    #[cfg(test)]
    TRACE2.with(|t| {
        if let Some(path) = &*t.borrow() {
            cmd.env("GIT_TRACE2_EVENT", path);
        }
    });
    #[cfg(test)]
    if ISOLATED.with(|i| i.get()) {
        cmd.env("GIT_CONFIG_GLOBAL", empty_global_config()).env("GIT_CONFIG_NOSYSTEM", "1");
        for v in ["GIT_CONFIG_COUNT", "GIT_CONFIG_PARAMETERS", "GIT_ASKPASS", "SSH_ASKPASS"] {
            cmd.env_remove(v);
        }
    }
    // GIT-001 (T-033-b): a status read never rewrites the index on its own (git's optional lock),
    // so the Source Control watcher is not woken by its own reads. Required locks are unaffected.
    cmd.env("GIT_OPTIONAL_LOCKS", "0");
    if let Some(dir) = cwd {
        cmd.current_dir(dir);
    }
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000; // no console flashes up behind the app
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    cmd
}

/// Runs git and returns its stdout byte for byte; a non-zero exit becomes an error carrying stderr.
pub(crate) fn output(args: &[&str], cwd: Option<&Path>) -> Result<Vec<u8>, String> {
    let out = command(args, cwd).output().map_err(|e| format!("could not run git: {e}"))?;
    finished(args, out.status, out.stdout, &out.stderr)
}

fn finished(args: &[&str], status: std::process::ExitStatus, stdout: Vec<u8>, stderr: &[u8]) -> Result<Vec<u8>, String> {
    if status.success() {
        Ok(stdout)
    } else {
        let err = String::from_utf8_lossy(stderr).trim().to_string();
        Err(if err.is_empty() { format!("git {} failed ({status})", args.join(" ")) } else { err })
    }
}

/// `output`, but git and whatever it started (a hook, a credential helper) are stopped once
/// `limit` has passed, so a step stalled on a cloud-synced folder ends with an error (PROJ-027).
pub(crate) fn output_within(args: &[&str], cwd: Option<&Path>, limit: Duration) -> Result<Vec<u8>, String> {
    use std::io::Read;
    use std::process::Stdio;
    let mut cmd = command(args, cwd);
    cmd.stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::piped());
    let mut child = cmd.spawn().map_err(|e| format!("could not run git: {e}"))?;
    #[cfg(windows)]
    let job = Job::holding(&child);
    // Each pipe is drained on its own thread, so a full pipe never stalls git.
    fn drain(pipe: Option<impl Read + Send + 'static>) -> std::sync::mpsc::Receiver<Vec<u8>> {
        let (tx, rx) = std::sync::mpsc::channel();
        if let Some(mut pipe) = pipe {
            std::thread::spawn(move || {
                let mut bytes = Vec::new();
                let _ = pipe.read_to_end(&mut bytes);
                let _ = tx.send(bytes);
            });
        }
        rx
    }
    let (out, err) = (drain(child.stdout.take()), drain(child.stderr.take()));
    let until = Instant::now() + limit;
    let status = loop {
        if let Some(status) = child.try_wait().map_err(|e| format!("could not run git: {e}"))? {
            break status;
        }
        if Instant::now() >= until {
            #[cfg(windows)]
            if let Some(job) = &job {
                job.stop();
            }
            stop_tree(&mut child);
            let what = args.iter().take(2).copied().collect::<Vec<_>>().join(" ");
            return Err(format!("git {what} did not finish within {} and was stopped. A folder kept in sync by OneDrive or a similar service can stall Git; try again, or use a folder outside it", spoken(limit)));
        }
        std::thread::sleep(Duration::from_millis(50));
    };
    // A program git left running may hold a pipe open; its output is not waited for past a second.
    let rest = |rx: &std::sync::mpsc::Receiver<Vec<u8>>| rx.recv_timeout(Duration::from_secs(1)).unwrap_or_default();
    finished(args, status, rest(&out), &rest(&err))
}

/// `run` with a limit (PROJ-027).
pub(crate) fn run_within(args: &[&str], cwd: Option<&Path>, limit: Duration) -> Result<String, String> {
    output_within(args, cwd, limit).map(|o| String::from_utf8_lossy(&o).trim().to_string())
}

/// "3 min" or "30 s".
fn spoken(d: Duration) -> String {
    let s = d.as_secs();
    if s >= 60 && s.is_multiple_of(60) { format!("{} min", s / 60) } else { format!("{s} s") }
}

/// Windows: git and everything it starts share one job, so a stall ends them all. A hook's shell
/// starts its programs outside git's process tree, where taskkill /T cannot find them.
#[cfg(windows)]
struct Job(windows_sys::Win32::Foundation::HANDLE);

#[cfg(windows)]
impl Job {
    fn holding(child: &std::process::Child) -> Option<Job> {
        use std::os::windows::io::AsRawHandle;
        use windows_sys::Win32::System::JobObjects::{AssignProcessToJobObject, CreateJobObjectW};
        // SAFETY: a new unnamed job, and the child's own process handle, which outlives this call.
        unsafe {
            let job = CreateJobObjectW(std::ptr::null(), std::ptr::null());
            if job.is_null() {
                return None;
            }
            let job = Job(job);
            (AssignProcessToJobObject(job.0, child.as_raw_handle() as _) != 0).then_some(job)
        }
    }

    fn stop(&self) {
        // SAFETY: the handle is this job's, open until drop.
        unsafe { windows_sys::Win32::System::JobObjects::TerminateJobObject(self.0, 1) };
    }
}

#[cfg(windows)]
impl Drop for Job {
    fn drop(&mut self) {
        // SAFETY: closed once, here; processes still running are left alone.
        unsafe { windows_sys::Win32::Foundation::CloseHandle(self.0) };
    }
}

/// Ends a git process and everything under it (on Windows a hook runs in a child shell).
fn stop_tree(child: &mut std::process::Child) {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        let mut kill = Command::new("taskkill");
        kill.args(["/T", "/F", "/PID", &child.id().to_string()]).creation_flags(0x0800_0000);
        let _ = kill.output();
    }
    let _ = child.kill();
    let _ = child.wait();
}

/// Runs git and returns its stdout, trimmed; a non-zero exit becomes an error carrying stderr.
pub(crate) fn run(args: &[&str], cwd: Option<&Path>) -> Result<String, String> {
    run_untrimmed(args, cwd).map(|s| s.trim().to_string())
}

/// `run` keeping leading spaces, which `git status --porcelain` lines carry meaning in.
fn run_untrimmed(args: &[&str], cwd: Option<&Path>) -> Result<String, String> {
    output(args, cwd).map(|o| String::from_utf8_lossy(&o).to_string())
}

/// GIT-062: the one readable line a failed git's stderr comes down to. The last `fatal:` line
/// wins, then the last `error:` line, then the last line that is not progress; None when only
/// progress was said. A `\r`-overwritten line counts as its last state.
pub fn failure_reason(log: &str) -> Option<String> {
    const PROGRESS: [&str; 9] = ["Cloning into", "remote: ", "Receiving objects", "Resolving deltas", "Updating files", "Checking out files", "Filtering content", "Enumerating objects", "Counting objects"];
    let lines: Vec<&str> = log.lines().map(|l| l.rsplit('\r').next().unwrap_or("").trim()).filter(|l| !l.is_empty()).collect();
    let tagged = |tag: &str| lines.iter().rev().find_map(|l| l.strip_prefix(tag)).map(str::trim);
    let line = tagged("fatal:").or_else(|| tagged("error:")).or_else(|| lines.iter().rev().copied().find(|l| !PROGRESS.iter().any(|p| l.starts_with(p))))?;
    let mut chars = line.chars();
    chars.next().map(|first| first.to_uppercase().chain(chars).collect())
}

/// One changed file on one side of the index (EDIT-027): `code` is git's status letter.
#[derive(Clone, Debug, PartialEq, Eq, serde::Serialize)]
pub struct Change {
    pub path: String,
    pub staged: bool,
    pub code: char,
}

/// Parses `git status --porcelain=v1 -z`. A file with staged and unstaged changes gives two
/// entries; an untracked file is an unstaged one with code `?`.
pub fn parse_status(text: &str, worktree: &Path) -> Vec<Change> {
    let mut list = Vec::new();
    let mut parts = text.split('\0');
    while let Some(entry) = parts.next() {
        let b = entry.as_bytes();
        if b.len() < 4 {
            continue;
        }
        let (x, y) = (b[0] as char, b[1] as char);
        if x == 'R' || x == 'C' {
            parts.next(); // the old name follows a rename or a copy
        }
        let path = worktree.join(native(&entry[3..])).to_string_lossy().into_owned();
        if !matches!(x, ' ' | '?' | '!') {
            list.push(Change { path: path.clone(), staged: true, code: x });
        }
        if !matches!(y, ' ' | '!') {
            list.push(Change { path, staged: false, code: y });
        }
    }
    list
}

/// Git's own path spelling (forward slashes, no `\\?\` prefix) turned back into a native path.
pub(crate) fn native(path: &str) -> String {
    if cfg!(windows) {
        path.replace('/', "\\")
    } else {
        path.to_string()
    }
}

impl Git {
    /// GIT-068: predicting a merge needs `git merge-tree --write-tree`, new in Git 2.38. Read from
    /// the version found once at startup, so an older Git is never probed for it again; a version
    /// that cannot be read is tried.
    pub fn predicts_merges(&self) -> bool {
        let mut n = self.version.trim_start_matches("git version ").split('.').map(|x| x.parse::<u32>().ok());
        match (n.next().flatten(), n.next().flatten()) {
            (Some(major), Some(minor)) => (major, minor) >= (2, 38),
            _ => true,
        }
    }

    /// Finds git on the path. Called once at startup; the version is shown to the user.
    pub fn detect() -> Result<Git, String> {
        let version = run(&["--version"], None).map_err(|e| format!("Git is not available: {e}"))?;
        Ok(Git { version })
    }

    /// The top-level folder of the repository that holds `path`, or an error if there is none.
    pub fn toplevel(&self, path: &Path) -> Result<PathBuf, String> {
        if !path.is_dir() {
            return Err(format!("{} is not a folder", path.display()));
        }
        // Someone who picks the .git folder itself meant the repository around it.
        let path = if path.file_name().is_some_and(|n| n == ".git") { path.parent().unwrap_or(path) } else { path };
        let top = run(&["rev-parse", "--show-toplevel"], Some(path))
            .map_err(|_| format!("{} is not inside a Git repository", path.display()))?;
        Ok(PathBuf::from(native(&top)))
    }

    pub fn worktrees(&self, repo: &Path) -> Result<Vec<Worktree>, String> {
        let text = run_within(&["worktree", "list", "--porcelain"], Some(repo), LIST_LIMIT)?;
        Ok(parse_worktrees(&text))
    }

    /// `git worktree add -b <branch> <dest> <base>`: a new branch in a folder of its own.
    pub fn worktree_add(&self, repo: &Path, dest: &Path, branch: &str, base: &str) -> Result<(), String> {
        let dest = dest.to_string_lossy();
        run_within(&["worktree", "add", "-b", branch, &dest, base], Some(repo), add_limit()).map(|_| ())
    }

    /// `git worktree add <dest> <branch>`: a folder on a branch that exists already (PROJ-030).
    pub fn worktree_add_existing(&self, repo: &Path, dest: &Path, branch: &str) -> Result<(), String> {
        run_within(&["worktree", "add", &dest.to_string_lossy(), branch], Some(repo), add_limit()).map(|_| ())
    }

    /// PROJ-064: how each of `branches` stands against its remote. One look at every branch's
    /// upstream; the commits on no remote are counted only for branches without one.
    pub fn push_states(&self, repo: &Path, branches: &[&str]) -> HashMap<String, Push> {
        let Ok(text) = run_within(&["for-each-ref", "--format=%(refname)%00%(upstream)%00%(upstream:track)", "refs/heads"], Some(repo), LIST_LIMIT) else {
            return HashMap::new();
        };
        let mut out = HashMap::new();
        for line in text.lines() {
            let mut f = line.trim_end_matches('\r').split('\0');
            let (Some(name), up, track) = (f.next().and_then(|r| r.strip_prefix("refs/heads/")), f.next().unwrap_or(""), f.next().unwrap_or("")) else { continue };
            if !branches.contains(&name) {
                continue;
            }
            let push = if !up.is_empty() && track != "[gone]" {
                let ahead = track.split("ahead ").nth(1).and_then(|r| r.split(|c: char| !c.is_ascii_digit()).next()).and_then(|n| n.parse().ok()).unwrap_or(0);
                Push { ahead, upstream: true }
            } else {
                let count = run_within(&["rev-list", "--count", &format!("refs/heads/{name}"), "--not", "--remotes"], Some(repo), LIST_LIMIT);
                let Some(ahead) = count.ok().and_then(|n| n.parse().ok()) else { continue };
                Push { ahead, upstream: false }
            };
            out.insert(name.to_string(), push);
        }
        out
    }

    /// Removes the worktree folder and then deletes its branch. The folder goes first; a branch
    /// that will not delete (never the case for `-D`) leaves a clear error rather than a half state.
    /// A branch another worktree still has checked out is kept: the result then carries the
    /// commit it points at, for `delete_branch_if_at` later.
    pub fn worktree_remove(&self, repo: &Path, dest: &Path, branch: Option<&str>) -> Result<Option<String>, String> {
        let dest_s = dest.to_string_lossy();
        // PROJ-074: the folder first moves into the hidden trash beside it, so the removal is done
        // at once; Git, finding it gone, only drops its records, and the files go in the background.
        let trashed = if dest.exists() { to_trash(dest) } else { None };
        let put_back = |e: String| match &trashed {
            Some(t) => match std::fs::rename(t, dest) {
                Ok(()) => {
                    if let Some(trash) = t.parent() {
                        let _ = std::fs::remove_dir(trash);
                    }
                    e
                }
                Err(f) => format!("{e}; moving the folder back from {} failed too: {f}", t.display()),
            },
            None => e,
        };
        // Windows may still hold the folder for a moment after a program in it was ended.
        let mut attempt = 0;
        loop {
            match run(&["worktree", "remove", "--force", &dest_s], Some(repo)) {
                Ok(_) => break,
                Err(e) if attempt < 5 && e.contains("Permission denied") => {
                    attempt += 1;
                    std::thread::sleep(std::time::Duration::from_millis(250));
                }
                // PROJ-072: on Windows Git cannot delete paths past its length limit; the folder is
                // deleted here (the standard library handles long paths) and Git, finding it gone,
                // drops the registration on the next pass.
                Err(e) if attempt < 5 && dest.exists() && e.to_lowercase().contains("too long") => {
                    attempt += 1;
                    std::fs::remove_dir_all(dest).map_err(|f| format!("{e}; deleting the folder directly failed too: {f}"))?;
                }
                Err(e) => return Err(put_back(e)),
            }
        }
        if let Some(t) = trashed {
            std::thread::spawn(move || {
                let _ = std::fs::remove_dir_all(&t);
                if let Some(trash) = t.parent() {
                    let _ = std::fs::remove_dir(trash);
                }
            });
        }
        // Git leaves the folder when something it does not track is still inside; this is a forced
        // delete of a workspace Kolux made, so what is left goes too.
        if dest.exists() {
            let _ = std::fs::remove_dir_all(dest);
        }
        if dest.exists() {
            return Err(format!("the folder {} is still there: something keeps it open", dest.display()));
        }
        if let Some(b) = branch {
            if self.checked_out_somewhere(repo, b)? {
                return run(&["rev-parse", "--verify", &format!("refs/heads/{b}")], Some(repo)).map(Some);
            }
            run(&["branch", "-D", b], Some(repo))?;
        }
        Ok(None)
    }

    /// `git worktree move`: the folder changes place and Git's own records follow.
    pub fn worktree_move(&self, repo: &Path, from: &Path, to: &Path) -> Result<(), String> {
        run(&["worktree", "move", &from.to_string_lossy(), &to.to_string_lossy()], Some(repo)).map(|_| ())
    }

    /// PROJ-068: `git worktree repair`: Git learns that the worktree now sits in `dir`.
    pub fn worktree_repair(&self, repo: &Path, dir: &Path) -> Result<(), String> {
        run_within(&["worktree", "repair", &dir.to_string_lossy()], Some(repo), LIST_LIMIT).map(|_| ())
    }

    fn checked_out_somewhere(&self, repo: &Path, branch: &str) -> Result<bool, String> {
        Ok(self.worktrees(repo)?.iter().any(|w| w.branch.as_deref() == Some(branch)))
    }

    /// Deletes a branch kept at removal, but only while it still points at `commit` and no
    /// worktree has it checked out. Ok(false) means it was left alone.
    pub fn delete_branch_if_at(&self, repo: &Path, branch: &str, commit: &str) -> Result<bool, String> {
        let at = run(&["rev-parse", "--verify", "--quiet", &format!("refs/heads/{branch}")], Some(repo))?;
        if at != commit || self.checked_out_somewhere(repo, branch)? {
            return Ok(false);
        }
        run(&["branch", "-D", branch], Some(repo)).map(|_| true)
    }

    /// PROJ-070: the checkout's uncommitted and untracked changes, one `git status --porcelain` line each.
    pub fn status_lines(&self, worktree: &Path) -> Result<Vec<String>, String> {
        output_within(&["status", "--porcelain"], Some(worktree), LIST_LIMIT).map(|o| String::from_utf8_lossy(&o).to_string()).map(|s| s.lines().filter(|l| !l.is_empty()).map(str::to_string).collect())
    }

    /// Does the checkout hold changes Git does not have yet (modified or untracked files, and
    /// work inside a submodule)?
    pub fn dirty(&self, worktree: &Path) -> Result<bool, String> {
        run_within(&["status", "--porcelain", "--ignore-submodules=none"], Some(worktree), LIST_LIMIT).map(|s| !s.is_empty())
    }

    /// Could `rev` be a ref spelling at all? Anything git might read as an option or a range is
    /// refused before any command runs.
    pub fn ref_ok(rev: &str) -> bool {
        !rev.is_empty() && !rev.starts_with('-') && !rev.contains("..") && !rev.chars().any(|c| c.is_whitespace() || c.is_control())
    }

    /// How many commits `base` has that the worktree's HEAD does not (ORCH-014's base drift).
    pub fn behind(&self, worktree: &Path, base: &str) -> Option<u32> {
        run(&["rev-list", "--count", &format!("HEAD..{base}")], Some(worktree)).ok()?.parse().ok()
    }

    /// Does `rev` name a commit here: a branch, tag, remote branch or id?
    pub fn rev_exists(&self, repo: &Path, rev: &str) -> bool {
        Self::ref_ok(rev) && run(&["rev-parse", "--verify", "--quiet", &format!("{rev}^{{commit}}")], Some(repo)).is_ok()
    }

    /// The branch new work starts from when nothing says otherwise (PROJ-028): origin's HEAD,
    /// else main or master, else the branch the main checkout is on.
    pub fn default_branch(&self, repo: &Path) -> Option<String> {
        let short = |args: &[&str]| run(args, Some(repo)).ok().filter(|s| !s.is_empty());
        short(&["symbolic-ref", "-q", "--short", "refs/remotes/origin/HEAD"])
            .or_else(|| ["main", "master"].into_iter().find(|b| self.rev_exists(repo, b)).map(String::from))
            .or_else(|| short(&["symbolic-ref", "-q", "--short", "HEAD"]))
    }

    /// Can a workspace start from `rev`? A ref that tracks a remote (`origin/x`, or a local
    /// branch with an upstream) is fetched first so it is fresh, and one the remote no longer
    /// has counts as gone; a full commit id is used as it is; being offline is not an error, the
    /// local copy serves.
    pub fn base_available(&self, repo: &Path, rev: &str) -> bool {
        if !Self::ref_ok(rev) {
            return false;
        }
        if rev.len() == 40 && rev.bytes().all(|b| b.is_ascii_hexdigit()) {
            return self.rev_exists(repo, rev);
        }
        let full = |r: &str| run(&["rev-parse", "--symbolic-full-name", r], Some(repo)).unwrap_or_default();
        let tracking = Some(full(rev)).filter(|f| f.starts_with("refs/remotes/")).unwrap_or_else(|| full(&format!("{rev}@{{upstream}}")));
        if let Some((remote, branch)) = tracking.strip_prefix("refs/remotes/").and_then(|r| r.split_once('/')) {
            if let Err(e) = run(&["fetch", "--quiet", remote, branch], Some(repo)) {
                if e.contains("couldn't find remote ref") {
                    return false;
                }
            }
        }
        self.rev_exists(repo, rev)
    }

    /// Is the name a local branch, or a branch on any remote (PROJ-021: a taken name gets a number)?
    pub fn branch_taken(&self, repo: &Path, branch: &str) -> bool {
        run(&["for-each-ref", "--format=%(refname)", &format!("refs/heads/{branch}"), &format!("refs/remotes/*/{branch}")], Some(repo)).is_ok_and(|s| !s.is_empty())
    }

    /// The worktree's markdown files, tracked and untracked, as full paths (EDIT-012). Git leaves
    /// out ignored files and never walks into a symlinked folder; the list stops at `cap`, and the
    /// flag says it did.
    pub fn markdown_files(&self, worktree: &Path, cap: usize) -> Result<(Vec<String>, bool), String> {
        let text = run(&["ls-files", "-z", "--cached", "--others", "--exclude-standard", "--deduplicate", "--", "*.md", "*.markdown"], Some(worktree))?;
        let mut names: Vec<&str> = text.split('\0').filter(|n| !n.is_empty()).collect();
        names.sort_unstable();
        let capped = names.len() > cap;
        Ok((names.into_iter().take(cap).map(|n| worktree.join(native(n)).to_string_lossy().into_owned()).collect(), capped))
    }

    /// Every file git knows in the worktree, tracked and untracked but not ignored, NUL-separated
    /// and relative to it: Quick Open's list when ripgrep is missing (EDIT-036).
    pub fn listed_files(&self, worktree: &Path) -> Result<String, String> {
        output(&["ls-files", "-z", "--cached", "--others", "--exclude-standard", "--deduplicate"], Some(worktree)).map(|o| String::from_utf8_lossy(&o).into_owned())
    }

    /// The worktree's changed files, staged and unstaged, for the diff picker (EDIT-027).
    pub fn changes(&self, worktree: &Path) -> Result<Vec<Change>, String> {
        let out = output(&["status", "--porcelain=v1", "-z", "--untracked-files=all"], Some(worktree))?;
        Ok(parse_status(&String::from_utf8_lossy(&out), worktree))
    }

    /// The two texts of a file's diff (EDIT-027): unstaged compares the index with the working
    /// file, staged compares HEAD with the index. Git's checkout filters are applied, so line ends
    /// match the working file. A side the file is not on (new, deleted, untracked) is empty.
    pub fn diff_sides(&self, file: &Path, staged: bool) -> Result<(String, String), String> {
        let (old, new) = self.diff_bytes(file, staged)?;
        let text = |b: Vec<u8>| String::from_utf8(b).map_err(|_| format!("{} is not UTF-8 text", file.display()));
        Ok((text(old)?, text(new)?))
    }

    /// The same two sides as bytes, for images in All Changes (EDIT-029).
    pub fn diff_bytes(&self, file: &Path, staged: bool) -> Result<(Vec<u8>, Vec<u8>), String> {
        let dir = file.parent().filter(|d| !d.as_os_str().is_empty()).ok_or_else(|| format!("{} is not a file path", file.display()))?;
        let name = file.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
        // ponytail: any failure to read a side counts as "not there"; tell the two apart if a real error ever hides behind it
        let show = |rev: &str| output(&["cat-file", "--filters", &format!("{rev}:./{name}")], Some(dir)).unwrap_or_default();
        let index = show("");
        if staged {
            return Ok((show("HEAD"), index));
        }
        let work = match std::fs::read(file) {
            Ok(b) => b,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Vec::new(),
            Err(e) => return Err(format!("{}: {e}", file.display())),
        };
        Ok((index, work))
    }

    /// Every change of the worktree with its size and identity, for All Changes (EDIT-029).
    pub fn change_entries(&self, worktree: &Path) -> Result<Vec<Entry>, String> {
        let changes = self.changes(worktree)?;
        let (staged, unstaged) = (diff_stats(worktree, true)?, diff_stats(worktree, false)?);
        Ok(changes
            .into_iter()
            .map(|c| {
                let rel = Path::new(&c.path).strip_prefix(worktree).map(|r| r.to_string_lossy().replace('\\', "/")).unwrap_or_default();
                let disk = std::fs::metadata(&c.path).ok().map(|m| format!("{}-{:?}", m.len(), m.modified().ok())).unwrap_or_default();
                if c.code == '?' {
                    let (lines, binary) = whole_file(&c.path);
                    return Entry { path: c.path, staged: false, code: c.code, lines, binary, stamp: disk };
                }
                let s = (if c.staged { &staged } else { &unstaged }).get(&rel).cloned().unwrap_or_default();
                let stamp = if c.staged { s.ids } else { format!("{}|{disk}", s.ids) };
                Entry { path: c.path, staged: c.staged, code: c.code, lines: s.lines, binary: s.binary, stamp }
            })
            .collect())
    }
}

/// A changed file in All Changes (EDIT-029): `lines` is added plus removed lines (none for a
/// binary file), and `stamp` changes whenever the change does, so a section reuses what it
/// fetched only while its change is the same.
#[derive(Clone, Debug, serde::Serialize)]
pub struct Entry {
    pub path: String,
    pub staged: bool,
    pub code: char,
    pub lines: Option<u64>,
    pub binary: bool,
    pub stamp: String,
}

#[derive(Clone)]
struct Stat {
    lines: Option<u64>,
    binary: bool,
    ids: String,
    code: char,
}

impl Default for Stat {
    fn default() -> Self {
        Stat { lines: None, binary: false, ids: String::new(), code: 'M' }
    }
}

/// `git diff [--cached] --numstat` and `--raw` by path (relative to the top, with forward slashes).
fn diff_stats(worktree: &Path, cached: bool) -> Result<std::collections::HashMap<String, Stat>, String> {
    diff_stats_with(worktree, if cached { &["--cached"] } else { &[] })
}

/// GIT-038 (T-033-c): every file that differs between the commit `since` (the base's snapshot)
/// and the working tree, untracked files included, in the shape All Changes already reads.
pub fn base_entries(worktree: &Path, since: &str) -> Result<Vec<Entry>, String> {
    let stats = diff_stats_with(worktree, &[since, "--"])?;
    let mut rels: Vec<&String> = stats.keys().collect();
    rels.sort();
    let mut out: Vec<Entry> = rels
        .into_iter()
        .map(|rel| {
            let s = &stats[rel];
            let path = worktree.join(native(rel)).to_string_lossy().into_owned();
            let disk = std::fs::metadata(&path).ok().map(|m| format!("{}-{:?}", m.len(), m.modified().ok())).unwrap_or_default();
            Entry { path, staged: false, code: s.code, lines: s.lines, binary: s.binary, stamp: format!("{since}:{}|{disk}", s.ids) }
        })
        .collect();
    let untracked = output(&["ls-files", "--others", "--exclude-standard", "-z"], Some(worktree))?;
    for rel in String::from_utf8_lossy(&untracked).split('\0').filter(|r| !r.is_empty()) {
        let path = worktree.join(native(rel)).to_string_lossy().into_owned();
        let disk = std::fs::metadata(&path).ok().map(|m| format!("{}-{:?}", m.len(), m.modified().ok())).unwrap_or_default();
        let (lines, binary) = whole_file(&path);
        out.push(Entry { path, staged: false, code: '?', lines, binary, stamp: disk });
    }
    Ok(out)
}

/// The two texts of a file against the base snapshot `since`: what the base had, and the working
/// file (empty when the file is new there, or gone here).
pub fn base_sides(file: &Path, since: &str) -> Result<(String, String), String> {
    let dir = file.parent().filter(|d| !d.as_os_str().is_empty()).ok_or_else(|| format!("{} is not a file path", file.display()))?;
    let name = file.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
    let old = output(&["cat-file", "--filters", &format!("{since}:./{name}")], Some(dir)).unwrap_or_default();
    let work = match std::fs::read(file) {
        Ok(b) => b,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Vec::new(),
        Err(e) => return Err(format!("{}: {e}", file.display())),
    };
    let text = |b: Vec<u8>| String::from_utf8(b).map_err(|_| format!("{} is not UTF-8 text", file.display()));
    Ok((text(old)?, text(work)?))
}

/// Line count and binary-ness of a file git has no diff for (untracked).
fn whole_file(path: &str) -> (Option<u64>, bool) {
    // ponytail: an untracked file is read whole for its line count; cap the read if huge untracked files get common
    let bytes = std::fs::read(path).unwrap_or_default();
    let binary = bytes.iter().take(8000).any(|&b| b == 0);
    let lines = (!binary).then(|| bytes.iter().filter(|&&b| b == b'\n').count() as u64 + u64::from(bytes.last().is_some_and(|&b| b != b'\n')));
    (lines, binary)
}

/// `git diff <extra> --numstat` and `--raw` by path (relative to the top, with forward slashes).
fn diff_stats_with(worktree: &Path, extra: &[&str]) -> Result<std::collections::HashMap<String, Stat>, String> {
    let mut map: std::collections::HashMap<String, Stat> = std::collections::HashMap::new();
    let with = |args: &[&str]| -> Vec<String> { args.iter().chain(extra.iter()).map(|s| s.to_string()).collect() };
    let args = with(&["diff", "--numstat", "-z", "--no-renames"]);
    let numstat = output(&args.iter().map(String::as_str).collect::<Vec<_>>(), Some(worktree))?;
    for rec in String::from_utf8_lossy(&numstat).split('\0') {
        let mut f = rec.splitn(3, '\t');
        if let (Some(a), Some(r), Some(p)) = (f.next(), f.next(), f.next()) {
            let s = map.entry(p.to_string()).or_default();
            s.binary = a == "-";
            s.lines = a.parse::<u64>().ok().zip(r.parse::<u64>().ok()).map(|(a, r)| a + r);
        }
    }
    let args = with(&["diff", "--raw", "-z", "--no-abbrev", "--no-renames"]);
    let raw = output(&args.iter().map(String::as_str).collect::<Vec<_>>(), Some(worktree))?;
    let text = String::from_utf8_lossy(&raw);
    let mut parts = text.split('\0');
    while let (Some(head), Some(p)) = (parts.next(), parts.next()) {
        let ids: Vec<&str> = head.split(' ').collect();
        if ids.len() >= 4 {
            let s = map.entry(p.to_string()).or_default();
            s.ids = format!("{}-{}", ids[2], ids[3]);
            s.code = ids.get(4).and_then(|c| c.chars().next()).unwrap_or('M');
        }
    }
    Ok(map)
}

/// Parses `git worktree list --porcelain`: blank-line separated blocks, the first is the main
/// checkout. `branch refs/heads/x` is absent for a detached head.
pub fn parse_worktrees(text: &str) -> Vec<Worktree> {
    let mut out = Vec::new();
    for (i, block) in text.split("\n\n").enumerate() {
        let mut path = None;
        let mut head = String::new();
        let mut branch = None;
        let mut locked = None;
        for line in block.lines() {
            let line = line.trim_end_matches('\r');
            if let Some(p) = line.strip_prefix("worktree ") {
                path = Some(native(p));
            } else if let Some(h) = line.strip_prefix("HEAD ") {
                head = h.to_string();
            } else if let Some(b) = line.strip_prefix("branch ") {
                branch = Some(b.strip_prefix("refs/heads/").unwrap_or(b).to_string());
            } else if line == "locked" {
                locked = Some(String::new());
            } else if let Some(r) = line.strip_prefix("locked ") {
                locked = Some(r.to_string());
            }
        }
        if let Some(path) = path {
            out.push(Worktree { path, branch, head, is_main: i == 0, name: None, parent: None, locked, push: None, hidden: false, kind: String::new(), source: None, made_by: None, number: None, comment: None });
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    #[test]
    fn an_unattended_git_fails_fast_on_a_remote_that_wants_a_password() {
        use std::io::{Read, Write};
        // A remote that answers every request with "who are you?" and nothing else.
        let server = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let port = server.local_addr().unwrap().port();
        std::thread::spawn(move || {
            for mut conn in server.incoming().flatten().take(8) {
                let mut buf = [0u8; 4096];
                let _ = conn.read(&mut buf);
                let _ = conn.write_all(b"HTTP/1.1 401 Unauthorized\r\nWWW-Authenticate: Basic realm=\"private\"\r\nContent-Length: 0\r\nConnection: close\r\n\r\n");
            }
        });
        // Only NO_PROMPT is under test: a config pair or password helper the parent shell injected
        // (credential.interactive, GIT_ASKPASS) would change git's words, so they are left out.
        ISOLATED.with(|i| i.set(true));
        let began = std::time::Instant::now();
        let url = format!("http://127.0.0.1:{port}/private.git");
        let mut cmd = command(&["-c", "credential.helper=", "ls-remote", &url], None);
        cmd.envs(NO_PROMPT).stdin(std::process::Stdio::null());
        let out = cmd.output().unwrap();
        let said = String::from_utf8_lossy(&out.stderr).to_lowercase();
        assert!(!out.status.success());
        assert!(said.contains("terminal prompts disabled"), "{said}");
        assert!(began.elapsed() < std::time::Duration::from_secs(10));
    }

    #[test]
    fn git038_base_entries_list_every_difference_from_the_snapshot_and_the_sides_read_against_it() {
        let dir = temp_repo("base");
        run(&["config", "core.autocrlf", "false"], Some(&dir)).unwrap();
        fs::write(dir.join("a.txt"), "one\ntwo\n").unwrap();
        run(&["add", "."], Some(&dir)).unwrap();
        run(&["commit", "-q", "-m", "a"], Some(&dir)).unwrap();
        let since = run(&["rev-parse", "HEAD"], Some(&dir)).unwrap().trim().to_string();
        // A committed change, a working-tree change, a new untracked file, a deletion.
        fs::write(dir.join("a.txt"), "one\ntwo\nthree\n").unwrap();
        run(&["commit", "-q", "-am", "a again"], Some(&dir)).unwrap();
        fs::write(dir.join("README.md"), "hello\nworld\n").unwrap();
        fs::write(dir.join("new.txt"), "fresh").unwrap();
        let entries = base_entries(&dir, &since).unwrap();
        let rel = |e: &Entry| Path::new(&e.path).strip_prefix(&dir).unwrap().to_string_lossy().replace('\\', "/");
        let got: Vec<(String, char, Option<u64>, bool)> = entries.iter().map(|e| (rel(e), e.code, e.lines, e.staged)).collect();
        assert_eq!(got, vec![("README.md".to_string(), 'M', Some(1), false), ("a.txt".to_string(), 'M', Some(1), false), ("new.txt".to_string(), '?', Some(1), false)]);
        assert!(entries[0].stamp.starts_with(&format!("{since}:")), "{}", entries[0].stamp);
        assert_eq!(base_sides(&dir.join("README.md"), &since).unwrap(), ("hello\n".to_string(), "hello\nworld\n".to_string()));
        assert_eq!(base_sides(&dir.join("new.txt"), &since).unwrap(), (String::new(), "fresh".to_string()));
        fs::remove_file(dir.join("a.txt")).unwrap();
        let entries = base_entries(&dir, &since).unwrap();
        assert_eq!(entries.iter().map(|e| (rel(e), e.code)).collect::<Vec<_>>(), vec![("README.md".to_string(), 'M'), ("a.txt".to_string(), 'D'), ("new.txt".to_string(), '?')]);
        assert_eq!(base_sides(&dir.join("a.txt"), &since).unwrap(), ("one\ntwo\n".to_string(), String::new()));
        let _ = fs::remove_dir_all(&dir);
    }

    fn temp_repo(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("kolux-rs-git-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        run(&["init", "-q", "-b", "main"], Some(&dir)).unwrap();
        run(&["config", "user.email", "test@example.com"], Some(&dir)).unwrap();
        run(&["config", "user.name", "Kolux RS test"], Some(&dir)).unwrap();
        fs::write(dir.join("README.md"), "hello\n").unwrap();
        run(&["add", "."], Some(&dir)).unwrap();
        run(&["commit", "-q", "-m", "first"], Some(&dir)).unwrap();
        dir
    }

    /// PROJ-027: a stalled step is stopped at its limit with an error that says so, and the add
    /// limit is three minutes unless the variable lengthens it, held between three and thirty.
    #[test]
    fn a_stalled_git_step_is_stopped_at_its_limit() {
        assert_eq!(add_limit_of(None), Duration::from_secs(180));
        assert_eq!(add_limit_of(Some("60000")), Duration::from_secs(180));
        assert_eq!(add_limit_of(Some(" 600000 ")), Duration::from_secs(600));
        assert_eq!(add_limit_of(Some("99999999")), Duration::from_secs(1800));
        assert_eq!(add_limit_of(Some("soon")), Duration::from_secs(180));
        let repo = temp_repo("stall");
        // A hook that never ends stands in for a folder whose sync service holds every file.
        fs::create_dir_all(repo.join(".git").join("hooks")).unwrap();
        // The hook leaves a mark if it outlives the stop, so the test also proves it was ended.
        fs::write(repo.join(".git").join("hooks").join("post-checkout"), "#!/bin/sh\nsleep 3\necho late > ../stall-late\nsleep 60\n").unwrap();
        let late = repo.with_file_name("stall-late");
        let _ = fs::remove_file(&late);
        let dest = repo.with_extension("ws");
        let started = Instant::now();
        let err = run_within(&["worktree", "add", "-b", "stuck", &dest.to_string_lossy(), "HEAD"], Some(&repo), Duration::from_secs(1)).unwrap_err();
        assert!(started.elapsed() < Duration::from_secs(8), "stopped after {:?}", started.elapsed());
        assert!(err.contains("git worktree add did not finish within 1 s"), "{err}");
        std::thread::sleep(Duration::from_secs(4));
        assert!(!late.exists(), "the hook kept running after the stop");
        // A step that finishes in time gives its output as before.
        assert_eq!(run_within(&["rev-parse", "--abbrev-ref", "HEAD"], Some(&repo), Duration::from_secs(30)).unwrap(), "main");
        assert!(run_within(&["rev-parse", "--verify", "nope"], Some(&repo), Duration::from_secs(30)).is_err());
        let _ = fs::remove_dir_all(&dest);
        let _ = fs::remove_dir_all(&repo);
    }

    /// PROJ-064: commits not pushed, in sync after a push, and unpublished without an upstream.
    #[test]
    fn push_states_count_commits_not_pushed() {
        let git = Git::detect().unwrap();
        let repo = temp_repo("push");
        let remote = repo.with_extension("remote");
        let _ = fs::remove_dir_all(&remote);
        run(&["init", "-q", "--bare", &remote.to_string_lossy()], None).unwrap();
        run(&["remote", "add", "origin", &remote.to_string_lossy()], Some(&repo)).unwrap();
        run(&["push", "-q", "-u", "origin", "main"], Some(&repo)).unwrap();
        let state = |b: &str| git.push_states(&repo, &[b]).get(b).cloned();
        assert_eq!(state("main"), Some(Push { ahead: 0, upstream: true }));
        for n in ["two", "three"] {
            fs::write(repo.join(n), n).unwrap();
            run(&["add", "."], Some(&repo)).unwrap();
            run(&["commit", "-q", "-m", n], Some(&repo)).unwrap();
        }
        assert_eq!(state("main"), Some(Push { ahead: 2, upstream: true }));
        run(&["push", "-q"], Some(&repo)).unwrap();
        assert_eq!(state("main"), Some(Push { ahead: 0, upstream: true }));
        run(&["switch", "-q", "-c", "side"], Some(&repo)).unwrap();
        fs::write(repo.join("side"), "s").unwrap();
        run(&["add", "."], Some(&repo)).unwrap();
        run(&["commit", "-q", "-m", "side"], Some(&repo)).unwrap();
        assert_eq!(state("side"), Some(Push { ahead: 1, upstream: false }));
        // Only the branches asked about are looked at.
        assert_eq!(git.push_states(&repo, &["side"]).len(), 1);
        let _ = fs::remove_dir_all(&remote);
        let _ = fs::remove_dir_all(&repo);
    }

    #[test]
    fn t315_a_failed_clone_comes_down_to_its_last_fatal_line_without_progress() {
        // A real clone into a folder that exists and is not empty.
        ISOLATED.with(|i| i.set(true));
        let src = temp_repo("t315-src");
        let dest = std::env::temp_dir().join(format!("kolux-rs-git-t315-dest-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dest);
        fs::create_dir_all(&dest).unwrap();
        fs::write(dest.join("keep.txt"), "mine\n").unwrap();
        let out = command(&["clone", "--progress", "--", &native(&src.to_string_lossy()), &native(&dest.to_string_lossy())], None).output().unwrap();
        assert!(!out.status.success());
        let reason = failure_reason(&String::from_utf8_lossy(&out.stderr)).unwrap();
        assert!(reason.starts_with("Destination path") && reason.contains("already exists"), "{reason}");
        // A clone that fails part-way: progress (with \r redraws) and trailing fragments never show.
        let log = "Cloning into 'x'...\nremote: Enumerating objects: 5, done.\nReceiving objects:  10% (1/9)\rReceiving objects:  40% (4/9)\nerror: RPC failed; curl 56 recv failure\nfatal: early EOF\nfatal: fetch-pack: invalid index-pack output\nremote: \n";
        assert_eq!(failure_reason(log).as_deref(), Some("Fetch-pack: invalid index-pack output"));
        assert_eq!(failure_reason("error: cannot lock ref\nReceiving objects: 100%").as_deref(), Some("Cannot lock ref"));
        assert_eq!(failure_reason("warning: could not find UI helper\n").as_deref(), Some("Warning: could not find UI helper"));
        assert_eq!(failure_reason("Cloning into 'x'...\nReceiving objects:  3%\r"), None);
        let _ = fs::remove_dir_all(&src);
        let _ = fs::remove_dir_all(&dest);
    }

    #[test]
    fn merge_predictions_need_git_2_38() {
        let g = |v: &str| Git { version: v.into() }.predicts_merges();
        assert!(!g("git version 2.37.1") && !g("git version 1.9.5.msysgit.1"));
        assert!(g("git version 2.38.0") && g("git version 2.55.0.windows.3") && g("git version 3.0.0"));
        // A version that cannot be read is tried; merge-tree itself then says whether it can.
        assert!(g("something else"));
    }

    #[test]
    fn detects_git_and_rejects_plain_folders() {
        let git = Git::detect().unwrap();
        assert!(git.version.starts_with("git version"));
        let plain = std::env::temp_dir().join(format!("kolux-rs-plain-{}", std::process::id()));
        fs::create_dir_all(&plain).unwrap();
        let err = git.toplevel(&plain).unwrap_err();
        assert!(err.contains("not inside a Git repository"), "{err}");
        assert!(git.toplevel(&plain.join("missing")).unwrap_err().contains("not a folder"));
        fs::remove_dir_all(&plain).unwrap();
    }

    #[test]
    fn worktree_add_then_remove_round_trip() {
        let git = Git::detect().unwrap();
        let repo = temp_repo("wt");
        fs::create_dir_all(repo.join("src")).unwrap();
        let top = git.toplevel(&repo.join("src")).unwrap();
        assert_eq!(top.canonicalize().unwrap(), repo.canonicalize().unwrap(), "a subfolder resolves to the repository root");
        assert_eq!(git.toplevel(&repo.join(".git")).unwrap().canonicalize().unwrap(), repo.canonicalize().unwrap(), "the .git folder itself means the repository");

        let before = git.worktrees(&repo).unwrap();
        assert_eq!(before.len(), 1);
        assert!(before[0].is_main);
        assert_eq!(before[0].branch.as_deref(), Some("main"));

        let dest = std::env::temp_dir().join(format!("kolux-rs-git-wt-ws-{}", std::process::id())).join("fix-login");
        let _ = fs::remove_dir_all(dest.parent().unwrap());
        git.worktree_add(&repo, &dest, "fix-login", "HEAD").unwrap();
        assert!(dest.join("README.md").is_file(), "worktree folder has the files");
        assert!(git.branch_taken(&repo, "fix-login"));
        let list = git.worktrees(&repo).unwrap();
        assert_eq!(list.len(), 2);
        let added = list.iter().find(|w| !w.is_main).unwrap();
        assert_eq!(added.branch.as_deref(), Some("fix-login"));
        assert_eq!(PathBuf::from(&added.path).canonicalize().unwrap(), dest.canonicalize().unwrap());

        assert_eq!(git.worktree_remove(&repo, &dest, Some("fix-login")).unwrap(), None);
        assert!(!dest.exists(), "folder is gone");
        assert!(!git.branch_taken(&repo, "fix-login"), "branch is gone");
        assert_eq!(git.worktrees(&repo).unwrap().len(), 1);

        fs::remove_dir_all(dest.parent().unwrap()).unwrap();
        fs::remove_dir_all(&repo).unwrap();
    }

    #[test]
    fn proj074_a_deleted_workspace_goes_to_the_hidden_trash_and_is_cleared_in_the_background() {
        let git = Git::detect().unwrap();
        let repo = temp_repo("trash");
        let root = std::env::temp_dir().join(format!("kolux-rs-git-trash-ws-{}", std::process::id()));
        let _ = fs::remove_dir_all(&root);
        let dest = root.join("big");
        git.worktree_add(&repo, &dest, "big", "HEAD").unwrap();
        fs::write(dest.join("built.bin"), vec![0u8; 1 << 20]).unwrap();
        let trash = trash_dir(&dest).unwrap();
        assert_eq!(trash, root.join(".kolux-trash"));
        // the folder leaves its place at once and Git forgets it; the trash empties shortly after
        assert_eq!(git.worktree_remove(&repo, &dest, Some("big")).unwrap(), None);
        assert!(!dest.exists());
        assert_eq!(git.worktrees(&repo).unwrap().len(), 1);
        assert!(!git.branch_taken(&repo, "big"));
        let until = Instant::now() + Duration::from_secs(10);
        while trash.exists() && Instant::now() < until {
            std::thread::sleep(Duration::from_millis(50));
        }
        assert!(!trash.exists(), "the background pass clears the trash and then the trash folder itself");
        // a removal Git refuses (a locked worktree) puts the folder back where Git expects it
        git.worktree_add(&repo, &dest, "kept", "HEAD").unwrap();
        fs::write(dest.join("work.txt"), "mine").unwrap();
        run(&["worktree", "lock", &dest.to_string_lossy()], Some(&repo)).unwrap();
        assert!(git.worktree_remove(&repo, &dest, Some("kept")).is_err());
        assert_eq!(fs::read_to_string(dest.join("work.txt")).unwrap(), "mine");
        assert!(git.worktrees(&repo).unwrap().iter().any(|w| PathBuf::from(&w.path).canonicalize().ok() == dest.canonicalize().ok()));
        assert!(!trash.exists(), "an empty trash folder is not left behind");
        run(&["worktree", "unlock", &dest.to_string_lossy()], Some(&repo)).unwrap();
        // the sweep clears what an earlier run left, whatever its name, and only inside the trash;
        // what a removal running now has just moved there waits for that removal
        let started = stamp_now();
        fs::create_dir_all(trash.join("left-from-before")).unwrap();
        fs::write(trash.join("left-from-before").join("f"), "x").unwrap();
        fs::create_dir_all(trash.join(format!("old-{}", started - 1))).unwrap();
        let fresh = trash.join(format!("new-{}", started + 1_000_000_000));
        fs::create_dir_all(&fresh).unwrap();
        fs::write(root.join("beside.txt"), "x").unwrap();
        sweep_trash(&trash, started);
        assert!(!trash.join("left-from-before").exists() && !trash.join(format!("old-{}", started - 1)).exists());
        assert!(fresh.exists() && root.join("beside.txt").exists() && dest.join("work.txt").exists());
        sweep_trash(&trash, u128::MAX);
        assert!(!trash.exists());
        git.worktree_remove(&repo, &dest, Some("kept")).unwrap();
        let _ = fs::remove_dir_all(&root);
        fs::remove_dir_all(&repo).unwrap();
    }

    #[test]
    fn markdown_files_skip_ignored_ones_and_stop_at_the_cap() {
        let git = Git::detect().unwrap();
        let repo = temp_repo("md");
        fs::create_dir_all(repo.join("docs")).unwrap();
        fs::create_dir_all(repo.join("build")).unwrap();
        fs::write(repo.join("docs").join("guide.md"), "x").unwrap();
        fs::write(repo.join("build").join("out.md"), "x").unwrap();
        fs::write(repo.join("notes.txt"), "x").unwrap();
        fs::write(repo.join(".gitignore"), "build/\n").unwrap();
        let (files, capped) = git.markdown_files(&repo, 10).unwrap();
        let names: Vec<String> = files.iter().map(|f| PathBuf::from(f).strip_prefix(&repo).unwrap().to_string_lossy().replace('\\', "/")).collect();
        assert_eq!(names, ["README.md", "docs/guide.md"]);
        assert!(!capped);
        let (one, capped) = git.markdown_files(&repo, 1).unwrap();
        assert_eq!((one.len(), capped), (1, true));
        fs::remove_dir_all(&repo).unwrap();
    }

    #[test]
    fn changes_list_both_sides_and_diff_sides_read_head_index_and_disk() {
        let git = Git::detect().unwrap();
        let repo = temp_repo("diff");
        run(&["config", "core.autocrlf", "false"], Some(&repo)).unwrap(); // the line ends as written
        fs::write(repo.join("README.md"), "hello staged\n").unwrap();
        run(&["add", "README.md"], Some(&repo)).unwrap();
        fs::write(repo.join("README.md"), "hello staged and more\n").unwrap();
        fs::write(repo.join("new.txt"), "fresh\n").unwrap();
        let rel = |c: &Change| (PathBuf::from(&c.path).strip_prefix(&repo).unwrap().to_string_lossy().into_owned(), c.staged, c.code);
        let list: Vec<_> = git.changes(&repo).unwrap().iter().map(rel).collect();
        assert_eq!(list, [("README.md".into(), true, 'M'), ("README.md".into(), false, 'M'), ("new.txt".into(), false, '?')]);
        let readme = repo.join("README.md");
        assert_eq!(git.diff_sides(&readme, true).unwrap(), ("hello\n".into(), "hello staged\n".into()));
        assert_eq!(git.diff_sides(&readme, false).unwrap(), ("hello staged\n".into(), "hello staged and more\n".into()));
        assert_eq!(git.diff_sides(&repo.join("new.txt"), false).unwrap(), (String::new(), "fresh\n".into()));

        fs::write(repo.join("blob.bin"), [0u8, 1, 2, 0]).unwrap();
        let sizes = |git: &Git| git.change_entries(&repo).unwrap().into_iter().map(|e| (e.lines, e.binary, e.stamp)).collect::<Vec<_>>();
        let before = sizes(&git);
        assert_eq!(before.iter().map(|(l, b, _)| (*l, *b)).collect::<Vec<_>>(), [(Some(2), false), (Some(2), false), (None, true), (Some(1), false)]);
        assert!(before.iter().all(|(_, _, s)| !s.is_empty()), "every change has an identity");
        fs::write(repo.join("README.md"), "hello staged and more, again\n").unwrap();
        let after = sizes(&git);
        assert_eq!(after[0].2, before[0].2, "the staged change is the same");
        assert_ne!(after[1].2, before[1].2, "the unstaged change is not");
        fs::remove_dir_all(&repo).unwrap();
    }

    #[test]
    fn status_parsing_skips_a_renames_old_name() {
        let list = parse_status("R  b.txt\0a.txt\0 D gone.txt\0", Path::new("r"));
        let got: Vec<_> = list.iter().map(|c| (c.path.ends_with("b.txt") || c.path.ends_with("gone.txt"), c.staged, c.code)).collect();
        assert_eq!(got, [(true, true, 'R'), (true, false, 'D')]);
    }

    #[test]
    fn parses_porcelain_output_with_detached_head() {
        let text = "worktree C:/r\nHEAD aaaa\nbranch refs/heads/main\n\nworktree C:/r-wt/x\nHEAD bbbb\ndetached\n";
        let list = parse_worktrees(text);
        assert_eq!(list.len(), 2);
        assert!(list[0].is_main);
        assert_eq!(list[0].branch.as_deref(), Some("main"));
        assert_eq!(list[1].branch, None);
        assert_eq!(list[1].head, "bbbb");
        assert!(list[1].path.ends_with("x"));
    }
}
