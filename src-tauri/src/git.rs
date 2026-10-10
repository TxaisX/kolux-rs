//! The git runner: every git operation goes through the `git` program on the user's path, run
//! with `std::process::Command`. Checked once at startup (`git --version`), never shelled through
//! a terminal. Worktrees are the unit of work: one branch in one folder of its own (PROJ-020).
//! GIT-067: removal deletes the branch only when no other worktree has it checked out and says
//! at which commit a kept branch was left, so it can be deleted later only while unmoved; moves
//! go through `git worktree move` so Git's records stay right; a base ref that is not a plain
//! ref spelling (leading dash, blanks, `..`) is never handed to git.

use std::path::{Path, PathBuf};
use std::process::Command;

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
}

pub(crate) fn command(args: &[&str], cwd: Option<&Path>) -> Command {
    let mut cmd = Command::new("git");
    cmd.args(args);
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

/// Runs git and returns its stdout, trimmed; a non-zero exit becomes an error carrying stderr.
pub(crate) fn run(args: &[&str], cwd: Option<&Path>) -> Result<String, String> {
    run_untrimmed(args, cwd).map(|s| s.trim().to_string())
}

/// `run` keeping leading spaces, which `git status --porcelain` lines carry meaning in.
fn run_untrimmed(args: &[&str], cwd: Option<&Path>) -> Result<String, String> {
    let out = command(args, cwd).output().map_err(|e| format!("could not run git: {e}"))?;
    if out.status.success() {
        Ok(String::from_utf8_lossy(&out.stdout).to_string())
    } else {
        let err = String::from_utf8_lossy(&out.stderr).trim().to_string();
        Err(if err.is_empty() { format!("git {} failed ({})", args.join(" "), out.status) } else { err })
    }
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
        let text = run(&["worktree", "list", "--porcelain"], Some(repo))?;
        Ok(parse_worktrees(&text))
    }

    /// `git worktree add -b <branch> <dest> <base>`: a new branch in a folder of its own.
    pub fn worktree_add(&self, repo: &Path, dest: &Path, branch: &str, base: &str) -> Result<(), String> {
        let dest = dest.to_string_lossy();
        run(&["worktree", "add", "-b", branch, &dest, base], Some(repo)).map(|_| ())
    }

    /// Removes the worktree folder and then deletes its branch. The folder goes first; a branch
    /// that will not delete (never the case for `-D`) leaves a clear error rather than a half state.
    /// A branch another worktree still has checked out is kept: the result then carries the
    /// commit it points at, for `delete_branch_if_at` later.
    pub fn worktree_remove(&self, repo: &Path, dest: &Path, branch: Option<&str>) -> Result<Option<String>, String> {
        let dest_s = dest.to_string_lossy();
        // Windows may still hold the folder for a moment after a program in it was ended.
        let mut attempt = 0;
        loop {
            match run(&["worktree", "remove", "--force", &dest_s], Some(repo)) {
                Ok(_) => break,
                Err(e) if attempt < 5 && e.contains("Permission denied") => {
                    attempt += 1;
                    std::thread::sleep(std::time::Duration::from_millis(250));
                }
                Err(e) => return Err(e),
            }
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
    pub fn changes(&self, worktree: &Path) -> Result<Vec<String>, String> {
        run_untrimmed(&["status", "--porcelain"], Some(worktree)).map(|s| s.lines().filter(|l| !l.is_empty()).map(str::to_string).collect())
    }

    /// Does the checkout hold changes Git does not have yet (modified or untracked files, and
    /// work inside a submodule)?
    pub fn dirty(&self, worktree: &Path) -> Result<bool, String> {
        run(&["status", "--porcelain", "--ignore-submodules=none"], Some(worktree)).map(|s| !s.is_empty())
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
            out.push(Worktree { path, branch, head, is_main: i == 0, name: None, parent: None, locked });
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

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
    fn removal_keeps_a_branch_in_use_elsewhere_moves_keep_records_and_bad_refs_never_run() {
        let git = Git::detect().unwrap();
        let repo = temp_repo("keep");
        let side = std::env::temp_dir().join(format!("kolux-rs-git-keep-ws-{}", std::process::id()));
        let _ = fs::remove_dir_all(&side);
        let (a, b, c) = (side.join("a"), side.join("b"), side.join("c"));
        git.worktree_add(&repo, &a, "shared", "HEAD").unwrap();
        // a second worktree on the same branch (git allows it only when forced)
        run(&["worktree", "add", "--force", &b.to_string_lossy(), "shared"], Some(&repo)).unwrap();
        let head = run(&["rev-parse", "HEAD"], Some(&repo)).unwrap();

        // GIT-067: moving goes through git, so the list follows the folder
        git.worktree_move(&repo, &a, &c).unwrap();
        assert!(!a.exists() && c.join("README.md").is_file());
        assert!(git.worktrees(&repo).unwrap().iter().any(|w| PathBuf::from(&w.path).canonicalize().unwrap() == c.canonicalize().unwrap()), "git lists the moved folder");

        // the branch is in use by b, so removing c keeps it, and says where it stood
        assert_eq!(git.worktree_remove(&repo, &c, Some("shared")).unwrap().as_deref(), Some(head.as_str()));
        assert!(git.branch_taken(&repo, "shared"), "kept: b still has it checked out");
        assert!(!git.delete_branch_if_at(&repo, "shared", &head).unwrap(), "never while a worktree has it");
        assert!(git.branch_taken(&repo, "shared"));
        // nobody uses it any more: the kept branch goes, but only while unmoved
        assert_eq!(git.worktree_remove(&repo, &b, None).unwrap(), None);
        fs::write(repo.join("README.md"), "more\n").unwrap();
        run(&["commit", "-q", "-am", "second"], Some(&repo)).unwrap();
        run(&["branch", "-f", "shared", "HEAD"], Some(&repo)).unwrap();
        assert!(!git.delete_branch_if_at(&repo, "shared", &head).unwrap(), "moved since removal: left alone");
        assert!(git.branch_taken(&repo, "shared"));
        let now = run(&["rev-parse", "HEAD"], Some(&repo)).unwrap();
        assert!(git.delete_branch_if_at(&repo, "shared", &now).unwrap());
        assert!(!git.branch_taken(&repo, "shared"));

        // submodule-less dirty check still sees untracked files; malformed refs never reach git
        assert!(!git.dirty(&repo).unwrap());
        fs::write(repo.join("new.txt"), "x").unwrap();
        assert!(git.dirty(&repo).unwrap());
        for bad in ["--upload-pack=evil", "-x", "main master", "a..b", "", "ma\tin"] {
            assert!(!Git::ref_ok(bad) && !git.base_available(&repo, bad) && !git.rev_exists(&repo, bad), "{bad:?}");
        }
        assert!(git.base_available(&repo, "HEAD~1") && git.base_available(&repo, "main"));

        fs::remove_dir_all(&side).unwrap();
        fs::remove_dir_all(&repo).unwrap();
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
