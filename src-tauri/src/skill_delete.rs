//! SKILL-023: deleting skills is all or nothing, even across a crash. Each item (a skill folder, a
//! link to one, or its install receipt) is first renamed aside next to where it sits, with a
//! journal in the app's folder saying what moved where. Only once every item is aside is the
//! journal marked done and the set-aside copies removed. A failed rename puts everything back. At
//! startup an unfinished journal is finished: not yet done means every item goes back, done means
//! the removal is completed. The skills list (T-243) leaves set-aside items out.
//!
//! SKILL-022 (T-180): the Skills page's delete. A request names 1 to 512 skills by the path the
//! list showed and the change time it showed. Each is planned first: bundled and plugin skills, a
//! skill outside Kolux's skill folders, one no longer on disk and one changed since the list loaded
//! are blocked with that reason; the rest gather every folder and link that holds the same skill
//! across the scanned roots, plus its install receipt. Removing a link never touches what it points
//! at. Each skill is then deleted on its own, all or nothing, under the one lock skill installs and
//! updates share, and comes back as deleted, skipped, busy, partly removed or failed.

use crate::skills::{self, Places, SKILL_FILE};
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{Duration, UNIX_EPOCH};

const JOURNAL: &str = "skill-delete.json";
/// Items set aside start with this, so the skills list leaves them out.
const ASIDE: &str = ".kolux-deleting-";
/// A rename Windows refuses because another program holds a file is tried this often, this far apart.
const TRIES: u32 = 20;
const PAUSE: Duration = Duration::from_millis(100);
/// SKILL-022: the one lock skill deletes, installs and updates share, in the app's folder.
const LOCK: &str = "skill-op.lock";
/// A lock file older than this is a leftover, not an operation under way.
const STALE: Duration = Duration::from_secs(15 * 60);
/// SKILL-022: one delete request covers between 1 and this many skills.
pub const MAX_PICKS: usize = 512;
/// An install receipt sits next to the skill folder it belongs to, named after it.
const RECEIPT: &str = ".receipt.json";

#[derive(Serialize, Deserialize)]
struct Journal {
    done: bool,
    moves: Vec<(PathBuf, PathBuf)>,
}

#[derive(Debug, PartialEq, Eq)]
pub enum Outcome {
    Deleted,
    /// Everything is gone from the list, but these set-aside copies could not be removed yet; the
    /// next start tries again.
    Partly(Vec<PathBuf>),
}

/// The app folders whose skill lock this process holds right now.
static HELD: Mutex<Vec<PathBuf>> = Mutex::new(Vec::new());
#[cfg(test)]
static DIE_AFTER_ASIDE: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);

/// SKILL-017 / T-243: a folder or link set aside by an unfinished delete is not a skill.
pub fn is_set_aside(name: &str) -> bool {
    name.starts_with(ASIDE)
}

fn now_ms() -> u128 {
    std::time::SystemTime::now().duration_since(UNIX_EPOCH).map_or(0, |d| d.as_millis())
}

/// SKILL-022: held while a skill operation runs; dropping it lets the next one in.
pub struct OpLock {
    dir: PathBuf,
    /// False when the lock file belongs to someone else and must be left alone.
    owns_file: bool,
}

impl Drop for OpLock {
    fn drop(&mut self) {
        // A release that fails leaves the file naming this process; the next `lock` takes it back.
        if self.owns_file {
            let _ = std::fs::remove_file(self.dir.join(LOCK));
        }
        if let Ok(mut held) = HELD.lock() {
            held.retain(|d| d != &self.dir);
        }
    }
}

#[derive(Debug, PartialEq, Eq)]
pub enum LockError {
    /// Another skill operation is under way.
    Busy,
    /// The lock could not be written at all.
    Failed(String),
}

/// SKILL-022: the one lock skill deletes, installs and updates share. In this process a second
/// taker is turned away at once; across processes a lock file in the app's folder says who holds
/// it. A lock file naming this process while nothing here holds it is a release that failed, and
/// one older than fifteen minutes is a leftover: both are taken back, so skill operations never
/// stay stuck.
pub fn lock(app_dir: &Path) -> Result<OpLock, LockError> {
    let dir = app_dir.to_path_buf();
    {
        let mut held = HELD.lock().unwrap_or_else(std::sync::PoisonError::into_inner);
        if held.contains(&dir) {
            return Err(LockError::Busy);
        }
        held.push(dir.clone());
    }
    // From here the guard owns the in-process claim, so every early return releases it.
    let mut guard = OpLock { dir, owns_file: false };
    let file = app_dir.join(LOCK);
    let fail = |e: std::io::Error| LockError::Failed(format!("the skill lock could not be written ({e})"));
    std::fs::create_dir_all(app_dir).map_err(fail)?;
    let now = now_ms();
    let mine = format!("{} {now}", std::process::id());
    match std::fs::OpenOptions::new().write(true).create_new(true).open(&file) {
        Ok(mut f) => {
            guard.owns_file = true;
            f.write_all(mine.as_bytes()).map_err(fail)?;
        }
        Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => {
            let text = std::fs::read_to_string(&file).unwrap_or_default();
            let mut parts = text.split_whitespace();
            let pid = parts.next().and_then(|p| p.parse::<u32>().ok());
            let at = parts.next().and_then(|p| p.parse::<u128>().ok()).unwrap_or(0);
            if pid != Some(std::process::id()) && now.saturating_sub(at) <= STALE.as_millis() {
                return Err(LockError::Busy);
            }
            guard.owns_file = true;
            std::fs::write(&file, mine).map_err(fail)?;
        }
        Err(e) => return Err(fail(e)),
    }
    Ok(guard)
}

/// Deletes `items` together. Err means nothing changed (or another skill operation is under way).
#[cfg_attr(not(test), allow(dead_code))]
pub fn delete(app_dir: &Path, items: &[PathBuf]) -> Result<Outcome, String> {
    let _one = lock(app_dir).map_err(|e| match e {
        LockError::Busy => "Another skill operation is under way; try again in a moment".to_string(),
        LockError::Failed(why) => format!("Nothing was deleted: {why}"),
    })?;
    delete_held(app_dir, items)
}

/// `delete` for a caller that already holds the lock.
fn delete_held(app_dir: &Path, items: &[PathBuf]) -> Result<Outcome, String> {
    // A record left by a delete that was only partly removed is finished first; while it cannot
    // be, no new delete starts, so its set-aside copies are never forgotten.
    if app_dir.join(JOURNAL).exists() {
        recover(app_dir);
        if app_dir.join(JOURNAL).exists() {
            return Err("Nothing was deleted: an earlier delete is still being cleared up; restart Kolux and try again".into());
        }
    }
    let stamp = format!("{}-{}", std::process::id(), std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map_or(0, |d| d.as_nanos()));
    let mut moves = Vec::new();
    for item in items {
        let (Some(parent), Some(name)) = (item.parent(), item.file_name()) else {
            return Err(format!("{} is not something that can be deleted", item.display()));
        };
        if std::fs::symlink_metadata(item).is_err() {
            return Err(format!("{} is no longer on disk; refresh the list", item.display()));
        }
        moves.push((item.clone(), parent.join(format!("{ASIDE}{stamp}-{}", name.to_string_lossy()))));
    }
    let mut journal = Journal { done: false, moves };
    write(app_dir, &journal)?;
    for (i, (from, aside)) in journal.moves.iter().enumerate() {
        if let Err(e) = rename(from, aside) {
            for (back, held) in journal.moves[..i].iter().rev() {
                let _ = rename(held, back);
            }
            let _ = std::fs::remove_file(app_dir.join(JOURNAL));
            return Err(format!("Nothing was deleted: {} could not be moved ({e})", from.display()));
        }
    }
    #[cfg(test)]
    if DIE_AFTER_ASIDE.load(std::sync::atomic::Ordering::SeqCst) {
        std::process::exit(9);
    }
    journal.done = true;
    write(app_dir, &journal)?;
    Ok(finish(app_dir, &journal))
}

/// At startup: an unfinished delete is undone (not yet done) or completed (done).
pub fn recover(app_dir: &Path) {
    let Ok(text) = std::fs::read_to_string(app_dir.join(JOURNAL)) else { return };
    let Ok(journal) = serde_json::from_str::<Journal>(&text) else { return };
    if journal.done {
        finish(app_dir, &journal);
        return;
    }
    let mut left = false;
    for (from, aside) in journal.moves.iter().rev() {
        if std::fs::symlink_metadata(aside).is_ok() && std::fs::symlink_metadata(from).is_err() {
            left |= rename(aside, from).is_err();
        }
    }
    if !left {
        let _ = std::fs::remove_file(app_dir.join(JOURNAL));
    }
}

fn finish(app_dir: &Path, journal: &Journal) -> Outcome {
    // T-441-c: only a path Kolux set aside itself is ever removed. The journal is read back at every
    // launch, so an entry naming anything else (a damaged or hand-edited file) is refused, logged and
    // left on disk; the journal stays so the refusal can be looked into.
    let ours = |a: &Path| a.file_name().and_then(|n| n.to_str()).is_some_and(|n| n.starts_with(ASIDE));
    let left: Vec<PathBuf> = journal
        .moves
        .iter()
        .map(|(_, aside)| aside)
        .filter(|a| {
            if !ours(a) {
                crate::diag::write(app_dir, &format!("skill delete: refused to remove {}, its name does not start with {ASIDE}", a.display()));
                return true;
            }
            remove(a).is_err()
        })
        .cloned()
        .collect();
    if left.is_empty() {
        let _ = std::fs::remove_file(app_dir.join(JOURNAL));
        Outcome::Deleted
    } else {
        Outcome::Partly(left)
    }
}

/// A link goes without what it points at; a folder goes with its contents.
fn remove(path: &Path) -> std::io::Result<()> {
    let Ok(meta) = std::fs::symlink_metadata(path) else { return Ok(()) };
    if meta.is_dir() && !meta.file_type().is_symlink() {
        std::fs::remove_dir_all(path)
    } else {
        std::fs::remove_file(path).or_else(|_| std::fs::remove_dir(path))
    }
}

fn rename(from: &Path, to: &Path) -> std::io::Result<()> {
    let mut tries = 0;
    loop {
        match std::fs::rename(from, to) {
            Err(e) if e.kind() != std::io::ErrorKind::NotFound && tries + 1 < TRIES => {
                tries += 1;
                std::thread::sleep(PAUSE);
            }
            r => return r,
        }
    }
}

fn write(app_dir: &Path, journal: &Journal) -> Result<(), String> {
    let path = app_dir.join(JOURNAL);
    let tmp = path.with_extension("json.tmp");
    let fail = |e: std::io::Error| format!("Nothing was deleted: the delete record could not be written ({e})");
    std::fs::create_dir_all(app_dir).map_err(fail)?;
    std::fs::write(&tmp, serde_json::to_vec(journal).map_err(|e| e.to_string())?).map_err(fail)?;
    std::fs::rename(&tmp, &path).map_err(fail)
}

/// SKILL-022: one skill the user chose, by the path and change time the list showed.
#[derive(Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Pick {
    pub path: String,
    pub updated: Option<u64>,
}

/// One thing a delete removes: a skill folder, a link to one, or an install receipt.
#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Item {
    pub path: String,
    /// folder | link | receipt
    pub kind: &'static str,
}

/// What a delete would do with one chosen skill.
#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Planned {
    pub path: String,
    /// bundled | plugin | outside | gone | changed; None when it can go.
    pub blocked: Option<&'static str>,
    pub items: Vec<Item>,
    /// Where the skill's content stays when only links to it are removed.
    pub remains: Option<String>,
}

/// How the delete went for one chosen skill.
#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Done {
    pub path: String,
    /// deleted | skipped | busy | partly | failed
    pub outcome: &'static str,
    pub note: Option<String>,
}

/// The same path as written, ignoring slash direction, a trailing slash and (on Windows) case.
fn same(a: &Path, b: &Path) -> bool {
    let norm = |p: &Path| {
        let s = skills::plain(p).replace('/', "\\");
        let s = s.trim_end_matches('\\').to_string();
        if cfg!(windows) {
            s.to_lowercase()
        } else {
            s
        }
    };
    norm(a) == norm(b)
}

/// `p` is `root` or somewhere below it, both followed through links to where they really are.
fn inside(p: &Path, root: &Path) -> bool {
    let (p, r) = (skills::key(p), skills::key(root));
    let r = r.trim_end_matches(['\\', '/']);
    p == r || p.strip_prefix(r).is_some_and(|rest| rest.starts_with(['\\', '/']))
}

fn is_link(p: &Path) -> bool {
    std::fs::symlink_metadata(p).is_ok_and(|m| m.file_type().is_symlink())
}

fn changed_at(file: &Path) -> Option<u64> {
    std::fs::metadata(file).ok()?.modified().ok()?.duration_since(UNIX_EPOCH).ok().map(|d| d.as_millis() as u64)
}

fn real(p: &Path) -> String {
    skills::plain(&std::fs::canonicalize(p).unwrap_or_else(|_| p.to_path_buf()))
}

fn count_ok(n: usize) -> Result<(), String> {
    if n == 0 || n > MAX_PICKS {
        return Err(format!("A delete covers between 1 and {MAX_PICKS} skills; {n} were chosen"));
    }
    Ok(())
}

/// SKILL-022: what deleting `picks` would remove, skill by skill, without changing anything.
pub fn plan(places: &Places, picks: &[Pick]) -> Result<Vec<Planned>, String> {
    count_ok(picks.len())?;
    let mut found: Vec<PathBuf> = vec![];
    // A root handed in twice (or two roots that are one folder) is read once.
    let mut roots = HashSet::new();
    for root in places.deletable.iter().filter(|r| roots.insert(skills::key(r))) {
        found.extend(skills::occurrences(root)?);
    }
    let mut out = vec![];
    let mut taken: HashSet<String> = HashSet::new();
    for pick in picks {
        let blocked = |why: &'static str| Planned { path: pick.path.clone(), blocked: Some(why), items: vec![], remains: None };
        if pick.path.starts_with("kolux:") {
            out.push(blocked("bundled"));
            continue;
        }
        let file = PathBuf::from(&pick.path);
        let Some(dir) = file.parent().filter(|_| file.file_name().is_some_and(|n| n == SKILL_FILE)) else {
            out.push(blocked("outside"));
            continue;
        };
        if places.plugin.iter().any(|r| inside(dir, r)) {
            out.push(blocked("plugin"));
            continue;
        }
        if std::fs::symlink_metadata(&file).is_err() {
            out.push(blocked("gone"));
            continue;
        }
        // The list may show a skill by any path that reaches it; one that resolves to a folder found
        // in the roots is the same skill.
        let Some(me) = found.iter().find(|f| same(f, dir)).or_else(|| found.iter().find(|f| skills::key(f) == skills::key(dir))) else {
            out.push(blocked("outside"));
            continue;
        };
        if changed_at(&file) != pick.updated {
            out.push(blocked("changed"));
            continue;
        }
        let k = skills::key(me);
        if !taken.insert(k.clone()) {
            continue; // the same skill chosen twice is planned once
        }
        let mut items = vec![];
        let mut remains = None;
        // One folder per real location: the same folder reached twice moves once.
        let mut folder = false;
        for occ in found.iter().filter(|f| skills::key(f) == k) {
            if is_link(occ) {
                items.push(Item { path: skills::plain(occ), kind: "link" });
            } else if places.deletable.iter().any(|r| inside(occ, r)) {
                if std::mem::replace(&mut folder, true) {
                    continue;
                }
                items.push(Item { path: skills::plain(occ), kind: "folder" });
                let receipt = occ.with_file_name(format!("{}{RECEIPT}", occ.file_name().map(|n| n.to_string_lossy()).unwrap_or_default()));
                if receipt.is_file() {
                    items.push(Item { path: skills::plain(&receipt), kind: "receipt" });
                }
            } else {
                // Reached through a linked folder: the content lives outside the skill folders.
                remains = Some(real(occ));
            }
        }
        if items.is_empty() {
            out.push(blocked("outside"));
            continue;
        }
        if !items.iter().any(|i| i.kind == "folder") {
            remains = remains.or_else(|| Some(real(me)));
        }
        out.push(Planned { path: pick.path.clone(), blocked: None, items, remains });
    }
    Ok(out)
}

/// SKILL-022: deletes `picks` skill by skill under the shared lock, each all or nothing.
pub fn run(app_dir: &Path, places: &Places, picks: &[Pick]) -> Result<Vec<Done>, String> {
    count_ok(picks.len())?;
    let every = |outcome: &'static str, note: String| picks.iter().map(|p| Done { path: p.path.clone(), outcome, note: Some(note.clone()) }).collect();
    let _one = match lock(app_dir) {
        Ok(l) => l,
        Err(LockError::Busy) => return Ok(every("busy", "Another skill operation is under way; try again in a moment".into())),
        Err(LockError::Failed(why)) => return Ok(every("failed", format!("Nothing was deleted: {why}"))),
    };
    let planned = plan(places, picks)?;
    let mut out = vec![];
    for p in planned {
        if let Some(why) = p.blocked {
            out.push(Done { path: p.path, outcome: "skipped", note: Some(why.into()) });
            continue;
        }
        let items: Vec<PathBuf> = p.items.iter().map(|i| PathBuf::from(&i.path)).collect();
        out.push(match delete_held(app_dir, &items) {
            Ok(Outcome::Deleted) => Done { path: p.path, outcome: "deleted", note: None },
            Ok(Outcome::Partly(left)) => {
                let n = left.len();
                Done { path: p.path, outcome: "partly", note: Some(format!("{n} hidden staged {} left over; Kolux clears {} at the next start", if n == 1 { "copy is" } else { "copies are" }, if n == 1 { "it" } else { "them" })) }
            }
            Err(e) => Done { path: p.path, outcome: "failed", note: Some(e) },
        });
    }
    skills::forget_scans();
    Ok(out)
}

/// SKILL-022: the confirmation's facts for the chosen skills; changes nothing.
#[allow(dead_code)] // registered by the coordinator's lib.rs hunk (evidence/skills-T-180-lib.patch)
#[tauri::command]
pub async fn skills_delete_plan(workspace: Option<String>, picks: Vec<Pick>) -> Result<Vec<Planned>, String> {
    tauri::async_runtime::spawn_blocking(move || plan(&skills::places(&skills::Env::current(), workspace.as_deref().map(Path::new)), &picks)).await.map_err(|e| e.to_string())?
}

/// SKILL-022: deletes the chosen skills once the user confirmed; one outcome per skill.
#[allow(dead_code)] // registered by the coordinator's lib.rs hunk (evidence/skills-T-180-lib.patch)
#[tauri::command]
pub async fn skills_delete(app: tauri::AppHandle, workspace: Option<String>, picks: Vec<Pick>) -> Result<Vec<Done>, String> {
    use tauri::Manager;
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    tauri::async_runtime::spawn_blocking(move || run(&dir, &skills::places(&skills::Env::current(), workspace.as_deref().map(Path::new)), &picks)).await.map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_dir::temp;

    fn skill(root: &Path, name: &str) -> PathBuf {
        let d = root.join(name);
        std::fs::create_dir_all(&d).unwrap();
        std::fs::write(d.join("SKILL.md"), format!("# {name}")).unwrap();
        d
    }

    fn names(root: &Path) -> Vec<String> {
        let mut v: Vec<String> = std::fs::read_dir(root).unwrap().map(|e| e.unwrap().file_name().to_string_lossy().into_owned()).collect();
        v.sort();
        v
    }

    #[test]
    fn skill023_a_delete_removes_the_skills_and_their_receipts_and_leaves_no_record() {
        let t = temp("skill023-a");
        let (app, root) = (t.join("app"), t.join("skills"));
        let a = skill(&root, "alpha");
        let b = skill(&root, "beta");
        skill(&root, "gamma");
        let receipt = root.join("alpha.receipt.json");
        std::fs::write(&receipt, "{}").unwrap();
        assert_eq!(delete(&app, &[a, b, receipt]), Ok(Outcome::Deleted));
        assert_eq!(names(&root), ["gamma"]);
        assert!(!app.join(JOURNAL).exists());
    }

    #[test]
    fn skill023_a_missing_item_changes_nothing() {
        let t = temp("skill023-b");
        let (app, root) = (t.join("app"), t.join("skills"));
        let a = skill(&root, "alpha");
        let err = delete(&app, &[a, root.join("gone")]).unwrap_err();
        assert!(err.contains("no longer on disk"), "{err}");
        assert_eq!(names(&root), ["alpha"]);
    }

    #[test]
    fn skill023_set_aside_items_are_not_skills() {
        assert!(is_set_aside(".kolux-deleting-12-34-alpha"));
        assert!(!is_set_aside("alpha"));
    }

    /// The child half of the crash test: sets the skills aside, then the process dies before the
    /// delete completes (exit without unwinding, like a kill).
    #[test]
    #[ignore]
    fn skill023_child_dies_mid_delete() {
        let Ok(dir) = std::env::var("KOLUX_SKILL023_DIR") else { return };
        let t = PathBuf::from(dir);
        DIE_AFTER_ASIDE.store(true, std::sync::atomic::Ordering::SeqCst);
        let _ = delete(&t.join("app"), &[t.join("skills/alpha"), t.join("skills/beta")]);
    }

    #[test]
    fn skill023_killed_after_setting_aside_the_skills_come_back_on_restart() {
        let t = temp("skill023-c");
        let (app, root) = (t.join("app"), t.join("skills"));
        skill(&root, "alpha");
        skill(&root, "beta");
        let status = std::process::Command::new(std::env::current_exe().unwrap())
            .args(["--exact", "skill_delete::tests::skill023_child_dies_mid_delete", "--ignored", "--nocapture"])
            .env("KOLUX_SKILL023_DIR", &*t.0)
            .status()
            .unwrap();
        assert_eq!(status.code(), Some(9), "the child must die mid-delete");
        let mid = names(&root);
        assert!(mid.len() == 2 && mid.iter().all(|n| is_set_aside(n)), "both set aside: {mid:?}");
        recover(&app);
        assert_eq!(names(&root), ["alpha", "beta"]);
        assert_eq!(std::fs::read_to_string(root.join("alpha/SKILL.md")).unwrap(), "# alpha");
        assert!(!app.join(JOURNAL).exists());
    }

    #[test]
    fn skill023_a_done_delete_left_half_removed_is_completed_on_restart() {
        let t = temp("skill023-d");
        let (app, root) = (t.join("app"), t.join("skills"));
        let aside = skill(&root, ".kolux-deleting-1-2-alpha");
        write(&app, &Journal { done: true, moves: vec![(root.join("alpha"), aside)] }).unwrap();
        recover(&app);
        assert!(names(&root).is_empty());
        assert!(!app.join(JOURNAL).exists());
    }

    #[test]
    fn t441c_a_journal_naming_a_plain_folder_never_deletes_it() {
        let t = temp("t441c-plain");
        let (app, root) = (t.join("app"), t.join("skills"));
        let plain = skill(&root, "alpha");
        let aside = skill(&root, ".kolux-deleting-1-2-beta");
        write(&app, &Journal { done: true, moves: vec![(root.join("x"), plain.clone()), (root.join("beta"), aside)] }).unwrap();
        recover(&app);
        assert_eq!(names(&root), vec!["alpha".to_string()], "the plain folder is kept, the set-aside one goes");
        assert!(plain.join("SKILL.md").exists());
        assert!(app.join(JOURNAL).exists(), "the journal is kept for a look");
        assert!(std::fs::read_to_string(app.join("logs").join("kolux.log")).unwrap_or_default().contains("refused to remove"));
    }

    #[test]
    fn skill023_a_failed_rename_puts_back_what_moved() {
        let t = temp("skill023-e");
        let (app, root) = (t.join("app"), t.join("skills"));
        let a = skill(&root, "alpha");
        let b = skill(&root, "beta");
        // A second delete of the same item: alpha is moved first, then cannot be found the second
        // time, so the first move is rolled back.
        let err = delete(&app, &[a.clone(), b, a]).unwrap_err();
        assert!(err.starts_with("Nothing was deleted"), "{err}");
        assert_eq!(names(&root), ["alpha", "beta"]);
        assert!(!app.join(JOURNAL).exists());
    }

    #[cfg(windows)]
    #[test]
    fn skill023_a_briefly_locked_skill_file_is_retried_and_deleted() {
        use std::os::windows::fs::OpenOptionsExt;
        let t = temp("skill023-f");
        let (app, root) = (t.join("app"), t.join("skills"));
        let a = skill(&root, "alpha");
        let held = std::fs::OpenOptions::new().read(true).share_mode(0).open(a.join("SKILL.md")).unwrap();
        assert!(std::fs::rename(&a, root.join("probe")).is_err(), "the lock must block a rename");
        let hold = std::thread::spawn(move || {
            std::thread::sleep(Duration::from_millis(400));
            drop(held);
        });
        assert_eq!(delete(&app, &[a]), Ok(Outcome::Deleted));
        hold.join().unwrap();
        assert!(names(&root).is_empty());
    }

    // SKILL-022 (T-180)

    fn link_dir(link: &Path, target: &Path) {
        #[cfg(windows)]
        {
            let ok = std::process::Command::new("cmd").args(["/C", "mklink", "/J"]).arg(link).arg(target).output().unwrap().status.success();
            assert!(ok, "could not make a junction");
        }
        #[cfg(not(windows))]
        std::os::unix::fs::symlink(target, link).unwrap();
    }

    fn pick(dir: &Path) -> Pick {
        let file = dir.join(SKILL_FILE);
        Pick { path: skills::plain(&file), updated: changed_at(&file) }
    }

    fn places(deletable: &[&Path], plugin: &[&Path]) -> Places {
        Places { deletable: deletable.iter().map(|p| p.to_path_buf()).collect(), plugin: plugin.iter().map(|p| p.to_path_buf()).collect() }
    }

    #[test]
    fn skill022_a_bundled_or_plugin_skill_is_blocked_and_only_the_home_skill_goes() {
        let t = temp("skill022-a");
        let (app, home, plug) = (t.join("app"), t.join("home"), t.join("plugin"));
        let alpha = skill(&home, "alpha");
        let p = skill(&plug, "planner");
        let at = places(&[&home], &[&plug]);
        let picks = [pick(&alpha), Pick { path: "kolux:orchestration".into(), updated: None }, pick(&p)];
        let plan = plan(&at, &picks).unwrap();
        assert_eq!(plan.iter().map(|p| p.blocked).collect::<Vec<_>>(), [None, Some("bundled"), Some("plugin")]);
        assert_eq!(plan[0].items, [Item { path: skills::plain(&alpha), kind: "folder" }]);
        assert_eq!(plan[0].remains, None);
        let done = run(&app, &at, &picks).unwrap();
        assert_eq!(done.iter().map(|d| d.outcome).collect::<Vec<_>>(), ["deleted", "skipped", "skipped"]);
        assert_eq!(done[1].note.as_deref(), Some("bundled"));
        assert!(names(&home).is_empty(), "the home skill is gone");
        assert!(p.join(SKILL_FILE).is_file(), "the plugin's skill stays");
        assert!(!app.join(JOURNAL).exists() && !app.join(LOCK).exists(), "no record and no lock left");
    }

    #[test]
    fn skill022_a_skill_changed_on_disk_before_confirming_is_reported_and_left_alone() {
        let t = temp("skill022-b");
        let (app, home) = (t.join("app"), t.join("home"));
        let alpha = skill(&home, "alpha");
        let mut seen = pick(&alpha);
        seen.updated = seen.updated.map(|ms| ms - 5_000); // the list loaded before the last change
        let at = places(&[&home], &[]);
        assert_eq!(plan(&at, std::slice::from_ref(&seen)).unwrap()[0].blocked, Some("changed"));
        let done = run(&app, &at, &[seen]).unwrap();
        assert_eq!((done[0].outcome, done[0].note.as_deref()), ("skipped", Some("changed")));
        assert_eq!(std::fs::read_to_string(alpha.join(SKILL_FILE)).unwrap(), "# alpha");
    }

    #[test]
    fn skill022_deleting_a_link_removes_the_link_and_keeps_the_folder_it_points_at() {
        let t = temp("skill022-c");
        let (app, home, elsewhere) = (t.join("app"), t.join("home"), t.join("dev"));
        let target = skill(&elsewhere, "beta");
        std::fs::create_dir_all(&home).unwrap();
        let link = home.join("beta");
        link_dir(&link, &target);
        let at = places(&[&home], &[]);
        let plan = plan(&at, &[pick(&link)]).unwrap();
        assert_eq!(plan[0].items, [Item { path: skills::plain(&link), kind: "link" }]);
        assert!(plan[0].remains.as_deref().is_some_and(|r| same(Path::new(r), &target)), "names where the content stays: {:?}", plan[0].remains);
        assert_eq!(run(&app, &at, &[pick(&link)]).unwrap()[0].outcome, "deleted");
        assert!(std::fs::symlink_metadata(&link).is_err(), "the link is gone");
        assert_eq!(std::fs::read_to_string(target.join(SKILL_FILE)).unwrap(), "# beta", "the target folder remains");
    }

    #[test]
    fn skill022_a_skill_and_a_link_to_it_in_another_root_go_together() {
        let t = temp("skill022-d");
        let (app, claude, shared) = (t.join("app"), t.join("claude"), t.join("shared"));
        let alpha = skill(&claude, "alpha");
        std::fs::create_dir_all(&shared).unwrap();
        link_dir(&shared.join("alpha"), &alpha);
        std::fs::write(claude.join("alpha.receipt.json"), "{}").unwrap();
        let at = places(&[&claude, &shared], &[]);
        let plan = plan(&at, &[pick(&alpha)]).unwrap();
        let kinds: Vec<&str> = plan[0].items.iter().map(|i| i.kind).collect();
        assert_eq!(kinds, ["folder", "receipt", "link"], "{:?}", plan[0].items);
        assert_eq!(plan[0].remains, None);
        assert_eq!(run(&app, &at, &[pick(&alpha)]).unwrap()[0].outcome, "deleted");
        assert!(names(&claude).is_empty() && names(&shared).is_empty());
    }

    #[test]
    fn skill022_gone_and_outside_skills_are_blocked_and_a_request_holds_1_to_512() {
        let t = temp("skill022-e");
        let (home, stray) = (t.join("home"), t.join("stray"));
        let alpha = skill(&home, "alpha");
        let lost = pick(&alpha);
        std::fs::remove_dir_all(&alpha).unwrap();
        let out = skill(&stray, "omega");
        let at = places(&[&home], &[]);
        let plan_of = plan(&at, &[lost, pick(&out)]).unwrap();
        assert_eq!(plan_of.iter().map(|p| p.blocked).collect::<Vec<_>>(), [Some("gone"), Some("outside")]);
        assert!(plan(&at, &[]).unwrap_err().contains("between 1 and 512"));
        let many: Vec<Pick> = (0..=MAX_PICKS).map(|i| Pick { path: format!("kolux:{i}"), updated: None }).collect();
        assert!(plan(&at, &many).is_err());
        assert_eq!(plan(&at, &many[..MAX_PICKS]).unwrap().len(), MAX_PICKS);
    }

    #[test]
    fn skill022_two_skills_with_one_name_are_chosen_one_by_one() {
        let t = temp("skill022-f");
        let (app, a, b) = (t.join("app"), t.join("claude"), t.join("codex"));
        let one = skill(&a, "review");
        let two = skill(&b, "review");
        let at = places(&[&a, &b], &[]);
        assert_eq!(run(&app, &at, &[pick(&two)]).unwrap()[0].outcome, "deleted");
        assert!(one.join(SKILL_FILE).is_file() && !two.exists());
    }

    #[test]
    fn skill022_a_delete_while_another_skill_operation_runs_is_busy_and_changes_nothing() {
        let t = temp("skill022-g");
        let (app, home) = (t.join("app"), t.join("home"));
        let alpha = skill(&home, "alpha");
        let at = places(&[&home], &[]);
        let held = lock(&app).unwrap();
        let done = run(&app, &at, &[pick(&alpha)]).unwrap();
        assert_eq!(done[0].outcome, "busy");
        assert!(alpha.join(SKILL_FILE).is_file());
        drop(held);
        assert_eq!(run(&app, &at, &[pick(&alpha)]).unwrap()[0].outcome, "deleted");
    }

    #[test]
    fn skill022_a_lock_left_behind_is_taken_back_and_a_live_one_is_respected() {
        let t = temp("skill022-h");
        let app = t.join("app");
        std::fs::create_dir_all(&app).unwrap();
        // A release that failed in this process: the file names us, nothing here holds it.
        std::fs::write(app.join(LOCK), format!("{} {}", std::process::id(), now_ms())).unwrap();
        drop(lock(&app).expect("our own leftover is taken back"));
        assert!(!app.join(LOCK).exists());
        // Another process's lock, fresh: busy, and its file is left alone.
        std::fs::write(app.join(LOCK), format!("4294967000 {}", now_ms())).unwrap();
        assert_eq!(lock(&app).err(), Some(LockError::Busy));
        assert!(app.join(LOCK).exists());
        // The same, from long ago: a leftover, taken back.
        std::fs::write(app.join(LOCK), "4294967000 1000").unwrap();
        let l = lock(&app).expect("a stale lock is taken back");
        assert_eq!(lock(&app).err(), Some(LockError::Busy), "a second taker in this process waits its turn");
        drop(l);
        assert!(!app.join(LOCK).exists());
    }

    #[test]
    fn skill022_set_aside_copies_are_not_listed_for_delete() {
        let t = temp("skill022-i");
        let home = t.join("home");
        skill(&home, "alpha");
        skill(&home, ".kolux-deleting-1-2-beta");
        let found = skills::occurrences(&home).unwrap();
        assert_eq!(found.len(), 1);
        assert!(found[0].ends_with("alpha"));
    }

    // Council d2 review of 950ba36, FIX-BEFORE 1 and 2.

    fn env(home: &Path) -> skills::Env {
        skills::Env { home: home.to_path_buf(), claude: None, codex: None, grok: None, hermes: None, local_app_data: Some(home.join("AppData").join("Local")), windows: true }
    }

    fn kinds(p: &Planned) -> Vec<&'static str> {
        p.items.iter().map(|i| i.kind).collect()
    }

    #[test]
    fn fixb1_the_home_folder_opened_as_the_workspace_counts_a_skill_once_and_deletes_it() {
        let t = temp("fixb1-a");
        let (app, home) = (t.join("app"), t.join("home"));
        let root = home.join(".claude").join("skills");
        let alpha = skill(&root, "alpha");
        std::fs::write(root.join("alpha.receipt.json"), "{}").unwrap();
        let at = skills::places(&env(&home), Some(&home));
        let keys: Vec<String> = at.deletable.iter().map(|p| skills::key(p)).collect();
        assert_eq!(keys.iter().collect::<HashSet<_>>().len(), keys.len(), "each deletable root once: {:?}", at.deletable);
        let plan_of = plan(&at, &[pick(&alpha)]).unwrap();
        assert_eq!(kinds(&plan_of[0]), ["folder", "receipt"], "{:?}", plan_of[0].items);
        // The same root handed in twice still plans one folder.
        let twice = places(&[&root, &root], &[]);
        assert_eq!(kinds(&plan(&twice, &[pick(&alpha)]).unwrap()[0]), ["folder", "receipt"]);
        let done = run(&app, &at, &[pick(&alpha)]).unwrap();
        assert_eq!((done[0].outcome, done[0].note.as_deref()), ("deleted", None));
        assert!(names(&root).is_empty());
    }

    #[test]
    fn fixb1_a_skills_root_that_is_a_junction_to_another_counts_a_skill_once_and_deletes_it() {
        let t = temp("fixb1-b");
        let (app, home) = (t.join("app"), t.join("home"));
        let claude = home.join(".claude").join("skills");
        let alpha = skill(&claude, "alpha");
        std::fs::create_dir_all(home.join(".agents")).unwrap();
        let shared = home.join(".agents").join("skills");
        link_dir(&shared, &claude);
        let at = skills::places(&env(&home), None);
        let plan_of = plan(&at, &[pick(&alpha)]).unwrap();
        assert_eq!(kinds(&plan_of[0]), ["folder"], "{:?}", plan_of[0].items);
        // Picked through the junctioned root: the same one folder.
        let via = plan(&at, &[pick(&shared.join("alpha"))]).unwrap();
        assert_eq!((via[0].blocked, kinds(&via[0])), (None, vec!["folder"]), "{:?}", via[0]);
        assert_eq!(run(&app, &at, &[pick(&alpha)]).unwrap()[0].outcome, "deleted");
        assert!(names(&claude).is_empty());
        assert!(is_link(&shared), "the root junction itself stays");
    }

    #[test]
    fn fixb1_a_folder_reached_twice_inside_one_root_is_taken_once() {
        let t = temp("fixb1-c");
        let (app, root) = (t.join("app"), t.join("skills"));
        let alpha = skill(&root.join("team"), "alpha");
        link_dir(&root.join("mirror"), &root.join("team"));
        let at = places(&[&root], &[]);
        assert_eq!(kinds(&plan(&at, &[pick(&alpha)]).unwrap()[0]), ["folder"]);
        assert_eq!(run(&app, &at, &[pick(&alpha)]).unwrap()[0].outcome, "deleted");
        assert!(names(&root.join("team")).is_empty());
    }
}
