// PROJ-069 (T-303): repositories are tidied quietly in the background. The only work is Git's own
// housekeeping: `git worktree prune` (forgets the records of worktree folders that are gone) and
// `git gc --auto`. Nothing here removes a branch, a worktree, a folder or a file, whatever its
// state (the data-loss rule); `tidy_repo` is the whole of what runs. A repository is tidied once a
// day at most, and only after a complete quiet period: no terminal open in any of its workspaces,
// nothing Kolux noted happening in them, and no change to its root folder or its .git for QUIET.
use crate::projects::{load_projects, name_key, seen_of};
use crate::state::Store;
use std::path::Path;
use std::sync::Mutex;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
use tauri::Manager;

/// The complete quiet period a repository waits out before it is tidied.
pub const QUIET: Duration = Duration::from_secs(30 * 60);
/// One repository is tidied this often at most.
pub const EVERY: Duration = Duration::from_secs(24 * 60 * 60);
/// How often the background pass looks.
pub const POLL: Duration = Duration::from_secs(5 * 60);

/// When each repository (by name key) was last tidied in this run.
static LAST: Mutex<Vec<(String, Instant)>> = Mutex::new(Vec::new());

/// Git's own housekeeping and nothing else: prune stale worktree records, then gc when Git itself
/// says it is worth it. Branches, worktrees, folders and files are never touched.
pub fn tidy_repo(repo: &Path) -> Result<(), String> {
    crate::git::run(&["worktree", "prune"], Some(repo))?;
    crate::git::run(&["gc", "--auto", "--quiet"], Some(repo))?;
    Ok(())
}

fn mtime_secs(path: &Path) -> Option<u64> {
    std::fs::metadata(path).and_then(|m| m.modified()).ok().and_then(|t| t.duration_since(UNIX_EPOCH).ok()).map(|d| d.as_secs())
}

/// Seconds since the repository's last sign of life: what Kolux noted (`noted_ms`, the newest
/// activity stamp of its workspaces) and the modification times of its root, its .git and the index.
pub fn quiet_secs(root: &str, noted_ms: Option<u64>, now_secs: u64) -> u64 {
    let root = Path::new(root);
    // ponytail: the root folder's and .git's own mtimes, not a walk; an edit deep in a subfolder shows
    // up through the index once Git looks at it. Walk the tree if that proves too coarse.
    let last = [mtime_secs(root), mtime_secs(&root.join(".git")), mtime_secs(&root.join(".git").join("index")), noted_ms.map(|ms| ms / 1000)]
        .into_iter()
        .flatten()
        .max();
    last.map_or(u64::MAX, |l| now_secs.saturating_sub(l))
}

/// Whether a repository is due: nothing is busy in it, the quiet period is complete, and it was
/// not tidied within EVERY.
pub fn due(quiet: u64, busy: bool, last: Option<Instant>, now: Instant) -> bool {
    !busy && quiet >= QUIET.as_secs() && last.is_none_or(|l| now.duration_since(l) >= EVERY)
}

/// Whether `path` is the repository or one of the workspaces whose keys are `mine`.
fn belongs(mine: &[String], path: &str) -> bool {
    let k = name_key(path);
    mine.iter().any(|m| k == *m || k.starts_with(&format!("{m}\\")))
}

/// One background pass: picks the repositories that are due while holding the store, then tidies
/// them with the store released (gc may take a while).
pub fn pass(app: &tauri::AppHandle) {
    let now = Instant::now();
    let now_secs = SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0);
    let busy: Vec<String> = app.state::<crate::terminal::Terminals>().list().into_iter().filter_map(|(_, _, dir)| dir).collect();
    let due_now: Vec<(String, String)> = {
        let store = app.state::<Mutex<Store>>();
        let Ok(store) = store.lock() else { return };
        let times = crate::activity::workspace_times(&store);
        let last = LAST.lock().unwrap_or_else(|e| e.into_inner());
        load_projects(&store)
            .into_iter()
            .filter(|p| !crate::folder_projects::is_folder(&store, &p.id))
            .filter_map(|p| {
                let key = name_key(&p.path);
                let mut mine = vec![key.clone()];
                mine.extend(seen_of(&store, &p).unwrap_or_default());
                let busy_here = busy.iter().any(|b| belongs(&mine, b));
                let noted = times.iter().filter(|(k, _)| belongs(&mine, k)).map(|(_, t)| *t).max();
                let tidied = last.iter().find(|(k, _)| *k == key).map(|(_, at)| *at);
                due(quiet_secs(&p.path, noted, now_secs), busy_here, tidied, now).then_some((key, p.path))
            })
            .collect()
    };
    for (key, path) in due_now {
        let _ = tidy_repo(Path::new(&path));
        let mut last = LAST.lock().unwrap_or_else(|e| e.into_inner());
        last.retain(|(k, _)| *k != key);
        last.push((key, Instant::now()));
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn git(repo: &Path, args: &[&str]) -> String {
        crate::git::run(args, Some(repo)).unwrap_or_else(|e| panic!("git {args:?}: {e}"))
    }

    fn scratch(name: &str) -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!("t303-tidy-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn t303_tidy_prunes_stale_records_only_and_keeps_dirty_worktrees_unmerged_branches_and_files() {
        let root = scratch("repo");
        let repo = root.join("main");
        fs::create_dir_all(&repo).unwrap();
        git(&repo, &["init", "-q", "-b", "main"]);
        git(&repo, &["-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "--allow-empty", "-m", "base"]);
        // A worktree with uncommitted and untracked changes on an unmerged branch.
        let dirty = root.join("dirty");
        git(&repo, &["worktree", "add", "-q", "-b", "feature", dirty.to_str().unwrap()]);
        fs::write(dirty.join("tracked.txt"), "a").unwrap();
        git(&dirty, &["add", "tracked.txt"]);
        git(&dirty, &["-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "-m", "work"]);
        fs::write(dirty.join("tracked.txt"), "changed").unwrap();
        fs::write(dirty.join("untracked.txt"), "new").unwrap();
        // An unmerged branch with no worktree, and a worktree whose folder is gone (a stale record).
        git(&repo, &["branch", "orphan", "feature"]);
        let gone = root.join("gone");
        git(&repo, &["worktree", "add", "-q", "-b", "gone-branch", gone.to_str().unwrap()]);
        fs::remove_dir_all(&gone).unwrap();
        assert!(git(&repo, &["worktree", "list", "--porcelain"]).contains("gone"), "the stale record is there before");

        tidy_repo(&repo).expect("tidy runs");

        assert_eq!(fs::read_to_string(dirty.join("tracked.txt")).unwrap(), "changed", "the uncommitted change stays");
        assert_eq!(fs::read_to_string(dirty.join("untracked.txt")).unwrap(), "new", "the untracked file stays");
        let list = git(&repo, &["worktree", "list", "--porcelain"]);
        assert!(list.contains("dirty"), "the dirty worktree is still registered: {list}");
        assert!(!list.contains(&gone.to_string_lossy().replace('\\', "/")), "only the stale record is pruned: {list}");
        let branches = git(&repo, &["branch", "--list"]);
        for b in ["feature", "orphan", "gone-branch", "main"] {
            assert!(branches.contains(b), "branch {b} survives tidy: {branches}");
        }
        assert_eq!(git(&dirty, &["status", "--porcelain"]).lines().count(), 2, "both changes are still there");
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn t303_a_repository_is_due_only_after_a_complete_quiet_period_and_once_a_day() {
        let now = Instant::now();
        let q = QUIET.as_secs();
        assert!(!due(q - 1, false, None, now), "still inside the quiet period");
        assert!(due(q, false, None, now), "the quiet period is complete");
        assert!(!due(q * 10, true, None, now), "a terminal in a workspace means activity");
        assert!(!due(q * 10, false, Some(now - Duration::from_secs(60)), now), "tidied an hour ago at most once a day");
        assert!(due(q * 10, false, Some(now - EVERY), now), "a day later it is due again");
    }

    #[test]
    fn t303_quiet_secs_counts_from_the_newest_sign_of_life() {
        let root = scratch("quiet");
        let now = SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_secs();
        let fresh = quiet_secs(root.to_str().unwrap(), None, now);
        assert!(fresh < 60, "a folder made just now is not quiet: {fresh}");
        assert!(quiet_secs(root.to_str().unwrap(), Some((now - 10) * 1000), now) < 60);
        assert_eq!(quiet_secs(root.to_str().unwrap(), Some((now + 5000) * 1000), now), 0, "a stamp in the future reads as now");
        assert_eq!(quiet_secs(root.join("missing").to_str().unwrap(), None, now), u64::MAX, "no sign at all is quiet forever");
        assert!(belongs(&["g:\\w\\repo".into()], "G:/w/repo/src") && !belongs(&["g:\\w\\repo".into()], "G:/w/repository"));
        let _ = fs::remove_dir_all(&root);
    }
}
