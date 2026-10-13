//! SKILL-023: deleting skills is all or nothing, even across a crash. Each item (a skill folder, a
//! link to one, or its install receipt) is first renamed aside next to where it sits, with a
//! journal in the app's folder saying what moved where. Only once every item is aside is the
//! journal marked done and the set-aside copies removed. A failed rename puts everything back. At
//! startup an unfinished journal is finished: not yet done means every item goes back, done means
//! the removal is completed. SKILL-022's delete (T-180) and the skills list (T-243) call in here.

use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::Duration;

const JOURNAL: &str = "skill-delete.json";
/// Items set aside start with this, so the skills list leaves them out.
const ASIDE: &str = ".kolux-deleting-";
/// A rename Windows refuses because another program holds a file is tried this often, this far apart.
const TRIES: u32 = 20;
const PAUSE: Duration = Duration::from_millis(100);

#[derive(Serialize, Deserialize)]
struct Journal {
    done: bool,
    moves: Vec<(PathBuf, PathBuf)>,
}

#[derive(Debug, PartialEq, Eq)]
#[cfg_attr(not(test), allow(dead_code))]
pub enum Outcome {
    Deleted,
    /// Everything is gone from the list, but these set-aside copies could not be removed yet; the
    /// next start tries again.
    Partly(Vec<PathBuf>),
}

static BUSY: Mutex<()> = Mutex::new(());
#[cfg(test)]
static DIE_AFTER_ASIDE: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);

/// SKILL-017 / T-243: a folder or link set aside by an unfinished delete is not a skill.
#[cfg_attr(not(test), allow(dead_code))]
pub fn is_set_aside(name: &str) -> bool {
    name.starts_with(ASIDE)
}

/// Deletes `items` together. Err means nothing changed (or another delete is under way).
#[cfg_attr(not(test), allow(dead_code))]
pub fn delete(app_dir: &Path, items: &[PathBuf]) -> Result<Outcome, String> {
    // One delete at a time: they share the journal. ponytail: a second one waits; SKILL-022's
    // "busy" outcome (T-180) can switch this to try_lock.
    let _one = BUSY.lock().unwrap_or_else(std::sync::PoisonError::into_inner);
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
}
