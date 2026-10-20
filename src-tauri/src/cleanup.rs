//! Workspace cleanup (ACCT-056, PROJ-080). Cleanup offers and removes only the workspaces Kolux
//! can show it made, by the origin record it keeps for each workspace it creates. A worktree
//! another tool made (Claude Code, a hand-run `git worktree add`) is never offered and never
//! removed here, even when the page asks for it by path. Nothing here forces: a workspace with
//! changes, a lock or another worktree inside it is left in place with the reason.

use crate::git::{Git, Worktree};
use crate::projects::{find_project, keeps_branch, kolux_made, load_origins, name_key, remove_check, remove_now, KeptBranch, Project};
use crate::state::Store;
use std::collections::HashMap;
use std::path::Path;
use std::sync::{mpsc, Arc, Condvar, Mutex, MutexGuard, OnceLock, PoisonError};
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tauri::{Manager, State};

type Origins = serde_json::Map<String, serde_json::Value>;

fn locked<T>(m: &Mutex<T>) -> MutexGuard<'_, T> {
    m.lock().unwrap_or_else(PoisonError::into_inner)
}

/// ACCT-056: the worktrees among `all` the dialog may offer: never the main checkout, and only
/// those with an origin record (the same test the launch sweep uses).
pub fn offerable(origins: &Origins, all: Vec<Worktree>) -> Vec<Worktree> {
    kolux_made(origins, all.into_iter().filter(|w| !w.is_main).collect())
}

/// Why cleanup must leave `path` in place, or `None` when Kolux can show it made it.
pub fn left_in_place(origins: &Origins, all: &[Worktree], path: &str) -> Option<String> {
    let Some(w) = all.iter().find(|w| name_key(&w.path) == name_key(path)) else {
        return Some("This is not a workspace of this project, so cleanup leaves it alone.".into());
    };
    if w.is_main {
        return Some("The main checkout is never cleaned up. Remove the project instead.".into());
    }
    if !origins.contains_key(&name_key(&w.path)) {
        return Some("Kolux did not create this workspace, so cleanup leaves it in place. Delete it from its own row if you want it gone.".into());
    }
    None
}

/// What one cleanup run did, path by path.
#[derive(Debug, Default, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Cleaned {
    pub removed: Vec<String>,
    pub left: Vec<Left>,
    /// PROJ-073: branches left behind by workspaces opened on an existing branch; the dialog
    /// turns them into one review list.
    pub kept: Vec<KeptBranch>,
}

#[derive(Debug, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Left {
    pub path: String,
    pub why: String,
}

/// Removes each of `paths` that Kolux made and that nothing refuses, one after another and without
/// force; every other path stays and is listed with its reason. A path is checked against the
/// project's list read at the start of the run, so a stale or invented path removes nothing.
pub fn remove_selected(git: &Git, store: &Mutex<Store>, terminals: &crate::terminal::Terminals, project: &Project, paths: &[String]) -> Cleaned {
    let mut out = Cleaned::default();
    let all = match git.worktrees(Path::new(&project.path)) {
        Ok(all) => all,
        Err(e) => {
            out.left = paths.iter().map(|p| Left { path: p.clone(), why: format!("The workspace list could not be read ({e}), so nothing was removed.") }).collect();
            return out;
        }
    };
    let origins = match store.lock() {
        Ok(store) => load_origins(&store),
        Err(_) => {
            out.left = paths.iter().map(|p| Left { path: p.clone(), why: "Kolux's records are locked up, so nothing was removed.".into() }).collect();
            return out;
        }
    };
    for path in paths {
        if let Some(why) = left_in_place(&origins, &all, path) {
            out.left.push(Left { path: path.clone(), why });
            continue;
        }
        let stamp = match remove_check(git, project, path) {
            Ok(check) => check.stamp,
            Err(why) => {
                out.left.push(Left { path: path.clone(), why });
                continue;
            }
        };
        match remove_now(git, store, terminals, project, path, false, &stamp) {
            Ok(kept) => {
                out.removed.push(path.clone());
                out.kept.extend(kept);
            }
            Err(why) => out.left.push(Left { path: path.clone(), why }),
        }
    }
    out
}

// ---- PROJ-080: the scan behind the dialog

/// A workspace with no commit and no file change for this many days has gone quiet.
pub const QUIET_DAYS: u64 = 7;
/// One repository's whole scan may take this long before the dialog stops waiting for it.
pub const SCAN_LIMIT: Duration = Duration::from_secs(60);

/// One workspace as the cleanup dialog lists it.
#[derive(Clone, Debug, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScanRow {
    pub path: String,
    pub branch: Option<String>,
    pub name: Option<String>,
    /// Whole days since the last commit or file change; none when the folder is gone or unreadable.
    pub idle_days: Option<u64>,
    /// Uncommitted and untracked changes.
    pub changes: usize,
    /// Everything on its branch is already in the base.
    pub merged: bool,
    /// A terminal is open in it.
    pub active: bool,
    pub locked: bool,
    /// The folder is gone while Git still lists it (removing it only tidies the record).
    pub missing: bool,
    /// Gone quiet: idle for QUIET_DAYS or more, merged, or missing.
    pub quiet: bool,
    /// Clean, inactive and quiet: ticked when the dialog opens.
    pub preselect: bool,
    /// Opened on an existing branch, so its branch stays when the workspace goes.
    pub keeps_branch: bool,
    /// Why the details could not be read (a slow or failing Git), if so; never preselected then.
    pub note: Option<String>,
}

/// What one scan of one project found.
#[derive(Clone, Debug, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Scan {
    pub project_id: String,
    pub rows: Vec<ScanRow>,
    /// Set when the workspace list itself could not be read, or the scan ran out of time.
    pub error: Option<String>,
    pub timed_out: bool,
    pub at_ms: u64,
}

fn now_ms() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map_or(0, |d| d.as_millis() as u64)
}

fn failed_scan(project_id: &str, error: String, timed_out: bool) -> Scan {
    Scan { project_id: project_id.to_string(), rows: Vec::new(), error: Some(error), timed_out, at_ms: now_ms() }
}

/// Is a terminal open in `path` or below it?
fn in_use(busy: &[String], path: &str) -> bool {
    let key = name_key(path);
    busy.iter().any(|b| {
        let b = name_key(b);
        b == key || b.starts_with(&format!("{key}{}", '\\'))
    })
}

fn scan_row(git: &Git, w: &Worktree, base: Option<&str>, busy: &[String], now_secs: u64, keeps: bool) -> ScanRow {
    let dir = Path::new(&w.path);
    let missing = !dir.exists();
    let mut note = None;
    let changes = if missing {
        0
    } else {
        match git.status_lines(dir) {
            Ok(lines) => lines.len(),
            Err(e) => {
                note = Some(format!("Its details could not be read: {e}"));
                0
            }
        }
    };
    let touched = if missing { None } else { std::fs::metadata(dir).and_then(|m| m.modified()).ok().and_then(|t| t.duration_since(UNIX_EPOCH).ok()).map(|d| d.as_secs()) };
    let last = [if missing { None } else { git.head_time(dir) }, touched].into_iter().flatten().max();
    let idle_days = last.map(|l| now_secs.saturating_sub(l) / 86_400);
    let merged = !missing && base.is_some_and(|b| git.merged_into(dir, b));
    let active = in_use(busy, &w.path);
    let locked = w.locked.is_some();
    let quiet = missing || merged || idle_days.is_some_and(|d| d >= QUIET_DAYS);
    let preselect = quiet && changes == 0 && note.is_none() && !active && !locked;
    ScanRow { path: w.path.clone(), branch: w.branch.clone(), name: w.name.clone(), idle_days, changes, merged, active, locked, missing, quiet, preselect, keeps_branch: keeps, note }
}

/// Lists the workspaces Kolux made in `project`, each with what decides whether cleanup may
/// offer it ticked. A repository whose list cannot be read gives an error and no rows. The store
/// is locked only to read two small records, never while Git works.
pub fn scan_project(git: &Git, store: &Mutex<Store>, project: &Project, busy: &[String], now_secs: u64) -> Scan {
    let repo = Path::new(&project.path);
    let all = match git.worktrees(repo) {
        Ok(all) => all,
        Err(e) => return failed_scan(&project.id, format!("The workspace list could not be read: {e}"), false),
    };
    let offered = {
        let Ok(store) = store.lock() else {
            return failed_scan(&project.id, "Kolux's records are locked up, so nothing was scanned.".into(), false);
        };
        let offered = offerable(&load_origins(&store), all);
        offered.into_iter().map(|w| (keeps_branch(&store, &w.path), w)).collect::<Vec<_>>()
    };
    let base = project.base.as_deref().map(str::trim).filter(|b| !b.is_empty()).map(str::to_string).or_else(|| git.default_branch(repo));
    let mut rows: Vec<ScanRow> = offered.iter().map(|(keeps, w)| scan_row(git, w, base.as_deref(), busy, now_secs, *keeps)).collect();
    rows.sort_by(|a, b| b.idle_days.cmp(&a.idle_days).then_with(|| a.path.cmp(&b.path)));
    Scan { project_id: project.id.clone(), rows, error: None, timed_out: false, at_ms: now_ms() }
}

struct Flight {
    done: Mutex<Option<Scan>>,
    cv: Condvar,
}

fn flights() -> &'static Mutex<HashMap<String, Arc<Flight>>> {
    static FLIGHTS: OnceLock<Mutex<HashMap<String, Arc<Flight>>>> = OnceLock::new();
    FLIGHTS.get_or_init(Mutex::default)
}

/// PROJ-080: runs `work` as the scan for `key`, unless one is already running: then this call
/// waits for that one and shares its result. The wait is capped at `limit`; past it the scan is
/// reported as timed out instead of holding anything up (the straggler's result is dropped).
pub fn scan_once(key: &str, limit: Duration, work: impl FnOnce() -> Scan + Send + 'static) -> Scan {
    let (flight, leader) = {
        let mut running = locked(flights());
        match running.get(key) {
            Some(f) => (f.clone(), false),
            None => {
                let f = Arc::new(Flight { done: Mutex::new(None), cv: Condvar::new() });
                running.insert(key.to_string(), f.clone());
                (f, true)
            }
        }
    };
    let timed_out = || failed_scan(key, format!("Scanning took longer than {} seconds, so Kolux stopped waiting for this project.", limit.as_secs().max(1)), true);
    if leader {
        let (tx, rx) = mpsc::channel();
        std::thread::spawn(move || {
            let _ = tx.send(work());
        });
        let scan = rx.recv_timeout(limit).unwrap_or_else(|_| timed_out());
        *locked(&flight.done) = Some(scan.clone());
        locked(flights()).remove(key);
        flight.cv.notify_all();
        scan
    } else {
        let mut done = locked(&flight.done);
        let deadline = std::time::Instant::now() + limit + Duration::from_secs(1);
        while done.is_none() {
            let left = deadline.saturating_duration_since(std::time::Instant::now());
            if left.is_zero() {
                break;
            }
            done = flight.cv.wait_timeout(done, left).unwrap_or_else(PoisonError::into_inner).0;
        }
        done.clone().unwrap_or_else(timed_out)
    }
}

/// The cleanup dialog's scan of one project; repeated calls join the one already running.
#[tauri::command(async)]
pub fn cleanup_scan(app: tauri::AppHandle, store: State<'_, Mutex<Store>>, project_id: String) -> Result<Scan, String> {
    let project = {
        let store = store.lock().map_err(|e| e.to_string())?;
        find_project(&store, &project_id)?
    };
    let key = project.id.clone();
    Ok(scan_once(&key, SCAN_LIMIT, move || {
        let busy: Vec<String> = app.state::<crate::terminal::Terminals>().list().into_iter().filter_map(|(_, _, dir)| dir).collect();
        let now = SystemTime::now().duration_since(UNIX_EPOCH).map_or(0, |d| d.as_secs());
        scan_project(&app.state::<Git>(), &app.state::<Mutex<Store>>(), &project, &busy, now)
    }))
}

// ---- PROJ-073: kept branches

/// What deleting one kept branch came to.
#[derive(Debug, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BranchResult {
    pub branch: String,
    pub deleted: bool,
    pub why: Option<String>,
}

fn commit_ok(commit: &str) -> bool {
    (7..=64).contains(&commit.len()) && commit.chars().all(|c| c.is_ascii_hexdigit())
}

/// Deletes each ticked kept branch with force, one after another and one at a time, but only
/// while the branch still points at the commit it had when the workspace went and no workspace
/// has it open; a branch that moved since the question was shown is refused.
pub fn delete_kept(git: &Git, project: &Project, items: &[KeptBranch]) -> Vec<BranchResult> {
    static ONE_AT_A_TIME: Mutex<()> = Mutex::new(());
    let _turn = locked(&ONE_AT_A_TIME);
    let repo = Path::new(&project.path);
    items
        .iter()
        .map(|k| {
            let refuse = |why: &str| BranchResult { branch: k.branch.clone(), deleted: false, why: Some(why.to_string()) };
            if !Git::ref_ok(&k.branch) || !commit_ok(&k.commit) {
                return refuse("That is not a branch Kolux can delete.");
            }
            if crate::git::run(&["show-ref", "--verify", "--quiet", &format!("refs/heads/{}", k.branch)], Some(repo)).is_err() {
                return refuse("The branch is already gone.");
            }
            match git.delete_branch_if_at(repo, &k.branch, &k.commit) {
                Ok(true) => BranchResult { branch: k.branch.clone(), deleted: true, why: None },
                Ok(false) => refuse("The branch has moved since you were asked, or a workspace has it open, so Kolux left it."),
                Err(e) => refuse(&format!("The branch could not be deleted: {e}")),
            }
        })
        .collect()
}

/// The toast's Delete and the review list's Delete ticked: the branches a removed workspace left.
#[tauri::command(async)]
pub fn branch_delete_kept(git: State<'_, Git>, store: State<'_, Mutex<Store>>, project_id: String, items: Vec<KeptBranch>) -> Result<Vec<BranchResult>, String> {
    let project = {
        let store = store.lock().map_err(|e| e.to_string())?;
        find_project(&store, &project_id)?
    };
    Ok(delete_kept(&git, &project, &items))
}

/// The cleanup dialog's Remove: only the ticked workspaces Kolux made, nothing forced.
#[tauri::command(async)]
pub fn cleanup_remove(git: State<'_, Git>, store: State<'_, Mutex<Store>>, terminals: State<'_, crate::terminal::Terminals>, project_id: String, paths: Vec<String>) -> Result<Cleaned, String> {
    let project = {
        let store = store.lock().map_err(|e| e.to_string())?;
        find_project(&store, &project_id)?
    };
    Ok(remove_selected(&git, &store, &terminals, &project, &paths))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::projects::set_origin;
    use std::fs;
    use std::path::PathBuf;
    use std::process::Command;

    fn temp(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("kolux-rs-cleanup-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn git_in(dir: &Path, args: &[&str]) {
        let out = Command::new("git").args(args).current_dir(dir).output().unwrap();
        assert!(out.status.success(), "git {args:?} in {}: {}", dir.display(), String::from_utf8_lossy(&out.stderr));
    }

    /// A repo with a Kolux-made workspace `ours` and one made behind Kolux's back, `theirs`.
    fn repo_with_two(name: &str) -> (PathBuf, PathBuf, Store, Project) {
        let base = temp(name);
        let repo = base.join("r");
        fs::create_dir_all(&repo).unwrap();
        git_in(&repo, &["init", "-q", "-b", "main"]);
        git_in(&repo, &["config", "user.email", "t@example.com"]);
        git_in(&repo, &["config", "user.name", "t"]);
        fs::write(repo.join("a.txt"), "a").unwrap();
        git_in(&repo, &["add", "."]);
        git_in(&repo, &["commit", "-q", "-m", "first"]);
        for w in ["ours", "theirs"] {
            git_in(&repo, &["worktree", "add", "-q", &base.join(w).to_string_lossy(), "-b", w]);
        }
        let store = Store::open(&base.join("db")).unwrap();
        set_origin(&store, &base.join("ours").to_string_lossy(), Some(&serde_json::json!({ "madeBy": "app" }))).unwrap();
        let project = Project { id: "p".into(), name: "r".into(), path: repo.to_string_lossy().into_owned(), workspaces_dir: None, base: None, display_name: None };
        (base, repo, store, project)
    }

    #[test]
    fn acct056_cleanup_offers_only_the_workspaces_kolux_can_show_it_made() {
        let (base, repo, store, _) = repo_with_two("offer");
        let git = Git::detect().unwrap();
        let all = git.worktrees(&repo).unwrap();
        assert_eq!(all.len(), 3);
        let offered = offerable(&load_origins(&store), all);
        assert_eq!(offered.len(), 1, "{offered:?}");
        assert!(name_key(&offered[0].path).ends_with("ours"));
        drop(store);
        let _ = fs::remove_dir_all(&base);
    }

    #[test]
    fn acct056_a_workspace_kolux_did_not_create_is_left_in_place_even_when_asked_for_by_path() {
        let (base, repo, store, project) = repo_with_two("remove");
        let git = Git::detect().unwrap();
        let store = Mutex::new(store);
        let terminals = crate::terminal::Terminals::default();
        let ours = base.join("ours").to_string_lossy().into_owned();
        let theirs = base.join("theirs").to_string_lossy().into_owned();
        let main = repo.to_string_lossy().into_owned();
        let invented = base.join("nowhere").to_string_lossy().into_owned();
        let got = remove_selected(&git, &store, &terminals, &project, &[theirs.clone(), main.clone(), invented.clone(), ours.clone()]);
        assert_eq!(got.removed, vec![ours.clone()], "{got:?}");
        assert_eq!(got.left.len(), 3, "{got:?}");
        assert!(got.left[0].why.contains("did not create"), "{got:?}");
        assert!(got.left[1].why.contains("main checkout"), "{got:?}");
        assert!(got.left[2].why.contains("not a workspace"), "{got:?}");
        assert!(!Path::new(&ours).exists(), "the workspace Kolux made went");
        assert!(Path::new(&theirs).join("a.txt").exists(), "the one it did not make stays on disk");
        let left: Vec<String> = git.worktrees(&repo).unwrap().iter().map(|w| name_key(&w.path)).collect();
        assert!(left.iter().any(|p| p.ends_with("theirs")), "and in Git's list: {left:?}");
        drop(store);
        let _ = fs::remove_dir_all(&base);
    }

    #[test]
    fn acct056_cleanup_never_forces_so_a_made_workspace_with_changes_stays_with_its_reason() {
        let (base, _repo, store, project) = repo_with_two("dirty");
        let git = Git::detect().unwrap();
        let store = Mutex::new(store);
        let ours = base.join("ours");
        fs::write(ours.join("new.txt"), "unsaved work").unwrap();
        let got = remove_selected(&git, &store, &crate::terminal::Terminals::default(), &project, &[ours.to_string_lossy().into_owned()]);
        assert!(got.removed.is_empty(), "{got:?}");
        assert!(got.left[0].why.contains("uncommitted"), "{got:?}");
        assert!(ours.join("new.txt").exists());
        drop(store);
        let _ = fs::remove_dir_all(&base);
    }

    #[test]
    fn acct056_a_failed_scan_removes_nothing() {
        let (base, _repo, store, mut project) = repo_with_two("failed");
        let git = Git::detect().unwrap();
        let store = Mutex::new(store);
        project.path = base.join("not-a-repo").to_string_lossy().into_owned();
        let ours = base.join("ours").to_string_lossy().into_owned();
        let got = remove_selected(&git, &store, &crate::terminal::Terminals::default(), &project, std::slice::from_ref(&ours));
        assert!(got.removed.is_empty(), "{got:?}");
        assert!(got.left[0].why.contains("could not be read"), "{got:?}");
        assert!(Path::new(&ours).exists());
        drop(store);
        let _ = fs::remove_dir_all(&base);
    }

    fn commit_in(dir: &Path, file: &str) {
        fs::write(dir.join(file), file).unwrap();
        git_in(dir, &["add", "."]);
        git_in(dir, &["-c", "user.email=t@example.com", "-c", "user.name=t", "commit", "-q", "-m", file]);
    }

    fn secs_now() -> u64 {
        SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_secs()
    }

    fn row<'a>(scan: &'a Scan, tail: &str) -> &'a ScanRow {
        scan.rows.iter().find(|r| name_key(&r.path).ends_with(tail)).unwrap_or_else(|| panic!("no row {tail}: {scan:?}"))
    }

    #[test]
    fn proj080_idle_clean_workspaces_come_preselected_and_only_kolux_made_ones_are_listed() {
        let (base, _repo, store, project) = repo_with_two("scan-idle");
        let git = Git::detect().unwrap();
        let store = Mutex::new(store);
        // ours has a commit of its own, so it is not merged and not quiet today ...
        commit_in(&base.join("ours"), "own.txt");
        let today = scan_project(&git, &store, &project, &[], secs_now());
        assert_eq!(today.rows.len(), 1, "the main checkout and the one Kolux did not make are not listed: {today:?}");
        assert!(!row(&today, "ours").quiet && !row(&today, "ours").preselect, "{today:?}");
        // ... and a month later it has gone quiet, is clean and inactive: ticked.
        let later = scan_project(&git, &store, &project, &[], secs_now() + 30 * 86_400);
        let r = row(&later, "ours");
        assert!(r.quiet && r.preselect && !r.merged && r.changes == 0 && r.idle_days.unwrap() >= 29, "{r:?}");
        assert_eq!(r.branch.as_deref(), Some("ours"));
        drop(store);
        let _ = fs::remove_dir_all(&base);
    }

    #[test]
    fn proj080_merged_dirty_and_busy_workspaces_are_marked_and_not_preselected_when_not_safe() {
        let (base, _repo, store, project) = repo_with_two("scan-flags");
        let git = Git::detect().unwrap();
        let store = Mutex::new(store);
        let ours = base.join("ours");
        // Branched from main and never committed to: everything is in main already.
        let merged = scan_project(&git, &store, &project, &[], secs_now());
        assert!(row(&merged, "ours").merged && row(&merged, "ours").quiet && row(&merged, "ours").preselect, "{merged:?}");
        fs::write(ours.join("wip.txt"), "x").unwrap();
        let dirty = scan_project(&git, &store, &project, &[], secs_now());
        assert!(row(&dirty, "ours").changes == 1 && row(&dirty, "ours").quiet && !row(&dirty, "ours").preselect, "{dirty:?}");
        fs::remove_file(ours.join("wip.txt")).unwrap();
        let busy = scan_project(&git, &store, &project, &[ours.join("src").to_string_lossy().into_owned()], secs_now());
        assert!(row(&busy, "ours").active && !row(&busy, "ours").preselect, "a terminal inside the folder counts: {busy:?}");
        drop(store);
        let _ = fs::remove_dir_all(&base);
    }

    #[test]
    fn proj080_a_list_that_cannot_be_read_gives_an_error_not_rows() {
        let (base, _repo, store, mut project) = repo_with_two("scan-fail");
        project.path = base.join("not-a-repo").to_string_lossy().into_owned();
        let scan = scan_project(&Git::detect().unwrap(), &Mutex::new(store), &project, &[], secs_now());
        assert!(scan.rows.is_empty() && scan.error.as_deref().is_some_and(|e| e.contains("could not be read")), "{scan:?}");
        let _ = fs::remove_dir_all(&base);
    }

    #[test]
    fn proj080_two_scans_in_quick_succession_run_the_work_once() {
        use std::sync::atomic::{AtomicUsize, Ordering};
        static RUNS: AtomicUsize = AtomicUsize::new(0);
        let work = || {
            RUNS.fetch_add(1, Ordering::SeqCst);
            std::thread::sleep(Duration::from_millis(400));
            failed_scan("join", "slow".into(), false)
        };
        let first = std::thread::spawn(move || scan_once("join", Duration::from_secs(10), work));
        std::thread::sleep(Duration::from_millis(100));
        let second = scan_once("join", Duration::from_secs(10), work);
        let first = first.join().unwrap();
        assert_eq!(RUNS.load(Ordering::SeqCst), 1, "the second call joined the first");
        assert_eq!(first.error, second.error);
        // Once it has finished a new call starts a new scan.
        scan_once("join", Duration::from_secs(10), || failed_scan("join", "again".into(), false));
        assert!(locked(flights()).get("join").is_none());
    }

    #[test]
    fn proj080_a_scan_that_hangs_times_out_for_that_project_only() {
        let hung = scan_once("hung", Duration::from_millis(150), || {
            std::thread::sleep(Duration::from_secs(2));
            failed_scan("hung", "late".into(), false)
        });
        assert!(hung.timed_out && hung.rows.is_empty() && hung.error.as_deref().is_some_and(|e| e.contains("stopped waiting")), "{hung:?}");
        let other = scan_once("fine", Duration::from_secs(5), || failed_scan("fine", "ok".into(), false));
        assert!(!other.timed_out, "{other:?}");
    }

    #[test]
    fn proj073_a_workspace_on_an_existing_branch_goes_and_its_branch_stays_until_asked() {
        let (base, repo, store, project) = repo_with_two("kept");
        let git = Git::detect().unwrap();
        // ours counts as opened on an existing branch
        set_origin(&store, &base.join("ours").to_string_lossy(), Some(&serde_json::json!({ "madeBy": "app", "existingBranch": true }))).unwrap();
        let store = Mutex::new(store);
        let ours = base.join("ours").to_string_lossy().into_owned();
        let got = remove_selected(&git, &store, &crate::terminal::Terminals::default(), &project, std::slice::from_ref(&ours));
        assert_eq!(got.removed, vec![ours.clone()], "{got:?}");
        assert_eq!(got.kept.len(), 1, "{got:?}");
        assert_eq!(got.kept[0].branch, "ours");
        assert!(!Path::new(&ours).exists(), "the folder went");
        let exists = |b: &str| crate::git::run(&["show-ref", "--verify", "--quiet", &format!("refs/heads/{b}")], Some(&repo)).is_ok();
        assert!(exists("ours"), "the branch stayed");
        // Choosing delete in the toast removes it.
        let done = delete_kept(&git, &project, &got.kept);
        assert!(done[0].deleted, "{done:?}");
        assert!(!exists("ours"));
        drop(store);
        let _ = fs::remove_dir_all(&base);
    }

    #[test]
    fn proj073_a_branch_that_moved_since_the_toast_is_refused_and_a_checked_out_one_stays() {
        let (base, repo, store, project) = repo_with_two("moved");
        let git = Git::detect().unwrap();
        let old = crate::git::run(&["rev-parse", "refs/heads/theirs"], Some(&repo)).unwrap();
        // the branch moves on (a commit in the workspace that still has it open)
        commit_in(&base.join("theirs"), "more.txt");
        let stale = vec![KeptBranch { branch: "theirs".into(), commit: old }];
        let got = delete_kept(&git, &project, &stale);
        assert!(!got[0].deleted && got[0].why.as_deref().is_some_and(|w| w.contains("moved")), "{got:?}");
        // even with the right commit, a branch a workspace has checked out is left
        let now = crate::git::run(&["rev-parse", "refs/heads/theirs"], Some(&repo)).unwrap();
        let open = delete_kept(&git, &project, &[KeptBranch { branch: "theirs".into(), commit: now }]);
        assert!(!open[0].deleted, "{open:?}");
        // an invented or option-like name is refused before git runs
        let bad = delete_kept(&git, &project, &[KeptBranch { branch: "--all".into(), commit: "abcdef0".into() }, KeptBranch { branch: "nope".into(), commit: "abcdef0".into() }]);
        assert!(bad.iter().all(|r| !r.deleted), "{bad:?}");
        assert!(bad[1].why.as_deref().is_some_and(|w| w.contains("already gone")), "{bad:?}");
        drop(store);
        let _ = fs::remove_dir_all(&base);
    }

    #[test]
    fn proj074_a_trash_folder_left_behind_is_cleared_by_the_next_launch_sweep() {
        let (base, _repo, store, project) = repo_with_two("sweep");
        let git = Git::detect().unwrap();
        let origins = load_origins(&store);
        let store = Mutex::new(store);
        // a run ended before its background pass finished: one trash folder, plus a folder that is not trash
        fs::create_dir_all(base.join(".kolux-trash-ab-cd-old/deep")).unwrap();
        fs::write(base.join(".kolux-trash-ab-cd-old/deep/f.txt"), "x").unwrap();
        fs::create_dir_all(base.join("keep-me")).unwrap();
        let folders = crate::projects::trash_folders(&store, &git, std::slice::from_ref(&project), &origins);
        assert!(folders.iter().any(|f| name_key(&f.to_string_lossy()) == name_key(&base.to_string_lossy())), "the parent of a workspace Kolux made is swept: {folders:?}");
        let gone: Vec<_> = folders.iter().flat_map(|f| crate::git::sweep_trash(f)).collect();
        assert_eq!(gone.len(), 1, "{gone:?}");
        assert!(!base.join(".kolux-trash-ab-cd-old").exists() && base.join("keep-me").exists() && base.join("ours").exists());
        drop(store);
        let _ = fs::remove_dir_all(&base);
    }
}
