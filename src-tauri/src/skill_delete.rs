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
/// SKILL-022: one delete request covers between 1 and this many skills.
pub const MAX_PICKS: usize = 512;
/// An install receipt sits next to the skill folder it belongs to, named after it.
const RECEIPT: &str = ".receipt.json";

#[derive(Serialize, Deserialize)]
struct Journal {
    done: bool,
    moves: Vec<(PathBuf, PathBuf)>,
    /// Set-aside copies an earlier, finished delete could not remove yet. They are carried into
    /// the next delete's record so that delete can start, and are only ever removed, never put back.
    #[serde(default)]
    left: Vec<PathBuf>,
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
    /// The open lock file holding the system's exclusive lock; closing it releases the lock.
    file: Option<std::fs::File>,
}

impl Drop for OpLock {
    fn drop(&mut self) {
        // The file stays on disk: removing it while another process waits to open it could let two
        // takers lock two different files. An unlocked file is free, whatever it says.
        if let Some(f) = self.file.take() {
            let _ = f.unlock();
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
/// taker is turned away at once; across processes the lock is the system's exclusive lock on a
/// file in the app's folder, so exactly one taker wins even when two try at the same moment. The
/// system drops the lock when its holder exits or crashes, so a lock is never left behind and
/// skill operations never stay stuck. The file also holds the pid and time of the last taker; on Windows the
/// system's lock keeps other programs from reading that text while the lock is held, so it is of use only once
/// the lock is free (or to a taker on another platform), and nothing here depends on it.
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
    let mut guard = OpLock { dir, file: None };
    let fail = |e: std::io::Error| LockError::Failed(format!("the skill lock could not be written ({e})"));
    std::fs::create_dir_all(app_dir).map_err(fail)?;
    let mut f = std::fs::OpenOptions::new().read(true).write(true).create(true).truncate(false).open(app_dir.join(LOCK)).map_err(fail)?;
    match f.try_lock() {
        Ok(()) => {}
        Err(std::fs::TryLockError::WouldBlock) => return Err(LockError::Busy),
        Err(std::fs::TryLockError::Error(e)) => return Err(fail(e)),
    }
    // Who took it last; the lock itself does not depend on this text, and on Windows no other program can
    // read it while the lock is held.
    let _ = f.set_len(0).and_then(|()| f.write_all(format!("{} {}", std::process::id(), now_ms()).as_bytes()));
    guard.file = Some(f);
    Ok(guard)
}

/// Deletes `items` together for a caller that holds the lock. Err means nothing changed.
fn delete_held(app_dir: &Path, items: &[PathBuf]) -> Result<Outcome, String> {
    // A record left by an earlier delete is finished first. If it was done and only its set-aside
    // copies are left (a file another program still holds), they are carried into this delete's
    // record, so they are never forgotten and never stop this delete. A record that was not done
    // and could not be put back is never written over.
    let mut carry = vec![];
    if app_dir.join(JOURNAL).exists() {
        let stuck = recover(app_dir);
        if app_dir.join(JOURNAL).exists() {
            match read(app_dir) {
                Some(old) if old.done => {
                    // FIX-4 (1): only entries that are what a delete here writes are carried. A refused
                    // entry (a copy that is not next to its original, or not named as a set-aside copy)
                    // would otherwise become a carried copy, which is checked by name alone, and be
                    // removed by this delete. It is dropped from the record and left on disk.
                    let (kept, refused): (Vec<_>, Vec<_>) = old.moves.into_iter().partition(|(from, aside)| aside_of(from, aside));
                    for (from, aside) in refused {
                        crate::diag::write(app_dir, &format!("skill delete: dropped {} from the record and left it alone, it is not a copy set aside from {}", aside.display(), from.display()));
                    }
                    let (kept_left, refused_left): (Vec<_>, Vec<_>) = old.left.into_iter().partition(|a| set_aside_name(a));
                    for a in refused_left {
                        crate::diag::write(app_dir, &format!("skill delete: dropped {} from the record and left it alone, it is not a copy this app set aside", a.display()));
                    }
                    carry = kept.into_iter().map(|(_, aside)| aside).chain(kept_left).filter(|a| std::fs::symlink_metadata(a).is_ok()).collect();
                }
                _ => {
                    // FIX-4 (2): the error names what is in the way and where, so the user can clear it.
                    let why = if stuck.is_empty() { format!("its record {} cannot be read; move that file away", app_dir.join(JOURNAL).display()) } else { stuck.join("; ") };
                    return Err(format!("Nothing was deleted: an earlier delete could not be cleared up: {why}"));
                }
            }
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
    let mut journal = Journal { done: false, moves, left: carry };
    write(app_dir, &journal)?;
    for (i, (from, aside)) in journal.moves.iter().enumerate() {
        if let Err(e) = rename(from, aside) {
            let mut stuck = false;
            for (back, held) in journal.moves[..i].iter().rev() {
                stuck |= put_back(held, back).is_err();
            }
            if stuck {
                // The not-done record stays, so the next start puts the rest back.
                return Err(format!("Nothing was deleted: {} could not be moved ({e}); what was already moved is put back at the next start", from.display()));
            }
            // The record goes back to what it was before: nothing, or only the carried copies.
            if journal.left.is_empty() {
                let _ = std::fs::remove_file(app_dir.join(JOURNAL));
            } else {
                let _ = write(app_dir, &Journal { done: true, moves: vec![], left: journal.left.clone() });
            }
            return Err(format!("Nothing was deleted: {} could not be moved ({e})", from.display()));
        }
    }
    #[cfg(test)]
    if DIE_AFTER_ASIDE.load(std::sync::atomic::Ordering::SeqCst) {
        std::process::exit(9);
    }
    journal.done = true;
    write(app_dir, &journal)?;
    // Only this delete's own copies decide its outcome; carried ones wait for the next try.
    let mine: Vec<PathBuf> = finish(app_dir, &journal).into_iter().filter(|a| journal.moves.iter().any(|(_, m)| m == a)).collect();
    Ok(if mine.is_empty() { Outcome::Deleted } else { Outcome::Partly(mine) })
}

fn read(app_dir: &Path) -> Option<Journal> {
    serde_json::from_str(&std::fs::read_to_string(app_dir.join(JOURNAL)).ok()?).ok()
}

/// What the start-up recovery did.
#[derive(Debug, PartialEq, Eq)]
pub enum Startup {
    /// The lock was taken and the record (if any) was dealt with.
    Recovered,
    /// Another running instance holds the lock; its delete may be under way, so nothing was touched.
    /// The next delete and the next start recover.
    Skipped,
    /// The lock file could not be opened at all, so no instance can be mid-delete: logged, and
    /// recovered anyway, or a hidden skill would stay hidden at every start.
    RecoveredUnlocked,
}

/// SKILL-023: what the app runs at start. An interrupted delete is undone or completed under the
/// skill lock, so a second instance never puts back a delete the first one is still running.
pub fn startup_recover(app_dir: &Path) -> Startup {
    let mut tried = false;
    loop {
        match lock(app_dir) {
            Ok(_one) => {
                recover(app_dir);
                return Startup::Recovered;
            }
            Err(LockError::Busy) => {
                crate::diag::write(app_dir, "skill delete: start-up recovery skipped, another instance holds the skill lock");
                return Startup::Skipped;
            }
            // Busy is the usual answer while another instance holds the lock, but Failed does not
            // rule one out: a backup or antivirus tool that opens the lock file without sharing, or
            // sets it read-only, makes a second instance's open fail while the first is mid-delete.
            // So one more try after a pause for a passing holder of the file; if it still fails,
            // recovery runs without the lock, because leaving the record would hide a skill at every
            // start. The only data that could then be put back or half-removed is what the other
            // instance's user chose to delete.
            Err(LockError::Failed(_)) if !tried => {
                tried = true;
                std::thread::sleep(PAUSE);
            }
            Err(LockError::Failed(why)) => {
                crate::diag::write(app_dir, &format!("skill delete: {why}; recovering without it"));
                recover(app_dir);
                return Startup::RecoveredUnlocked;
            }
        }
    }
}

/// `<pid>-<nanos>`: the stamp a delete puts between the prefix and the name (see `delete_held`).
fn stamped(s: &str) -> bool {
    let digits = |p: &str| !p.is_empty() && p.bytes().all(|b| b.is_ascii_digit());
    s.split_once('-').is_some_and(|(pid, nanos)| digits(pid) && digits(nanos))
}

/// The exact form of a set-aside copy's name, `.kolux-deleting-<pid>-<nanos>-<name>`, for an entry
/// with no original on record (a carried copy). `is_set_aside` is looser on purpose: the list hides
/// anything with the prefix.
fn set_aside_name(p: &Path) -> bool {
    p.file_name().and_then(|n| n.to_str()).and_then(|n| n.strip_prefix(ASIDE)).is_some_and(|rest| {
        let mut parts = rest.splitn(3, '-');
        matches!((parts.next(), parts.next(), parts.next()), (Some(pid), Some(nanos), Some(name)) if stamped(&format!("{pid}-{nanos}")) && !name.is_empty())
    })
}

/// An entry of the record is trusted only if it is exactly what a delete here would have written:
/// the set-aside copy sits next to the original and is named `.kolux-deleting-<pid>-<nanos>-<its name>`
/// (FIX-4: not merely ending in its name, so `...-xalpha` is not alpha's copy).
fn aside_of(from: &Path, aside: &Path) -> bool {
    let (Some(f), Some(a)) = (from.file_name().and_then(|n| n.to_str()), aside.file_name().and_then(|n| n.to_str())) else { return false };
    let same_parent = match (from.parent(), aside.parent()) {
        (Some(x), Some(y)) => same(x, y),
        _ => false,
    };
    same_parent && a.strip_prefix(ASIDE).and_then(|r| r.strip_suffix(f)).and_then(|r| r.strip_suffix('-')).is_some_and(stamped)
}

/// At startup: an unfinished delete is undone (not yet done) or completed (done). Returns one line
/// per entry that is in the way (also written to the log); empty when the record is cleared or done.
pub fn recover(app_dir: &Path) -> Vec<String> {
    let mut stuck = vec![];
    let Some(journal) = read(app_dir) else { return stuck };
    if journal.done {
        finish(app_dir, &journal);
        return stuck;
    }
    for (from, aside) in journal.moves.iter().rev() {
        if std::fs::symlink_metadata(aside).is_err() {
            continue; // never moved, or already put back
        }
        let why = if !aside_of(from, aside) {
            format!("{} is not a copy set aside from {}, so it is not put back; move or remove it", aside.display(), from.display())
        } else if std::fs::symlink_metadata(from).is_err() {
            match rename(aside, from) {
                Ok(()) => continue,
                Err(e) => format!("{} could not be put back as {} ({e}); close what holds it or move it by hand", aside.display(), from.display()),
            }
        } else {
            // Both are there: the original came back after the delete set the copy aside. Neither is
            // overwritten or removed; the record stays so this is looked into, not forgotten.
            format!("{} and its set-aside copy {} both exist; move or remove one of them", from.display(), aside.display())
        };
        crate::diag::write(app_dir, &format!("skill delete: {why}"));
        stuck.push(why);
    }
    if !stuck.is_empty() {
        return stuck;
    }
    if journal.left.is_empty() {
        let _ = std::fs::remove_file(app_dir.join(JOURNAL));
    } else {
        // Copies carried from an earlier finished delete are never put back, only removed.
        let rest = Journal { done: true, moves: vec![], left: journal.left };
        if write(app_dir, &rest).is_ok() {
            finish(app_dir, &rest);
        }
    }
    stuck
}

/// Removes every set-aside copy the record names; returns the ones still on disk. The record is
/// removed once none is left.
fn finish(app_dir: &Path, journal: &Journal) -> Vec<PathBuf> {
    // T-441-c: only a path Kolux set aside itself is ever removed. The journal is read back at every
    // launch, so an entry naming anything else (a damaged or hand-edited file) is refused, logged and
    // left on disk; the journal stays so the refusal can be looked into.
    // A move's copy must also sit next to its original and carry its name; a carried copy has no
    // original on record, so only its name's exact form can be checked.
    let candidates = journal.moves.iter().map(|(from, aside)| (aside, aside_of(from, aside))).chain(journal.left.iter().map(|a| (a, set_aside_name(a))));
    let left: Vec<PathBuf> = candidates
        .filter(|(a, ok)| {
            if !ok {
                crate::diag::write(app_dir, &format!("skill delete: refused to remove {}, it is not a copy this app set aside", a.display()));
                return true;
            }
            remove(a).is_err()
        })
        .map(|(a, _)| a.clone())
        .collect();
    if left.is_empty() {
        let _ = std::fs::remove_file(app_dir.join(JOURNAL));
    }
    left
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

#[cfg(test)]
thread_local! {
    /// Tests: every put-back on this thread fails, as when another program holds the moved item.
    static FAIL_PUT_BACK: std::cell::Cell<bool> = const { std::cell::Cell::new(false) };
}

/// Puts a set-aside item back where it was, after a later move in the same delete failed.
fn put_back(held: &Path, back: &Path) -> std::io::Result<()> {
    #[cfg(test)]
    if FAIL_PUT_BACK.with(std::cell::Cell::get) {
        return Err(std::io::Error::other("held by a test"));
    }
    rename(held, back)
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
    /// Links outside the skill folders that point at a folder this delete removes. They are never
    /// removed; afterwards each points at nothing.
    pub dangling: Vec<String>,
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
        let blocked = |why: &'static str| Planned { path: pick.path.clone(), blocked: Some(why), items: vec![], remains: None, dangling: vec![] };
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
        let mut outside_links = vec![];
        // One folder per real location: the same folder reached twice moves once.
        let mut folder = false;
        let mut links = HashSet::new();
        for occ in found.iter().filter(|f| skills::key(f) == k) {
            if is_link(occ) {
                // A link is removed only where it really sits inside a skills root; one reached
                // through a linked folder that lives elsewhere stays, and so does its content.
                let Some(parent) = occ.parent().filter(|p| places.deletable.iter().any(|r| inside(p, r))) else {
                    remains = Some(real(occ));
                    // Named by where it really sits, not by the way the list reached it.
                    if let (Some(up), Some(name)) = (occ.parent(), occ.file_name()) {
                        outside_links.push(skills::plain(&PathBuf::from(real(up)).join(name)));
                    }
                    continue;
                };
                // The same link reached twice moves once.
                if links.insert(format!("{}/{}", skills::key(parent), occ.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default())) {
                    items.push(Item { path: skills::plain(occ), kind: "link" });
                }
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
            out.push(Planned { remains, ..blocked("outside") });
            continue;
        }
        let mut dangling = vec![];
        if items.iter().any(|i| i.kind == "folder") {
            // The content goes with the folder, even when an outside link pointed at it; that link
            // stays and points at nothing, which the confirmation says.
            remains = None;
            outside_links.sort();
            outside_links.dedup();
            dangling = outside_links;
        } else {
            remains = remains.or_else(|| Some(real(me)));
        }
        out.push(Planned { path: pick.path.clone(), blocked: None, items, remains, dangling });
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
#[tauri::command]
pub async fn skills_delete_plan(workspace: Option<String>, picks: Vec<Pick>) -> Result<Vec<Planned>, String> {
    tauri::async_runtime::spawn_blocking(move || plan(&skills::places(&skills::Env::current(), workspace.as_deref().map(Path::new)), &picks)).await.map_err(|e| e.to_string())?
}

/// SKILL-022: deletes the chosen skills once the user confirmed; one outcome per skill.
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

    /// The journal's own tests take the lock and delete a hand-picked set, as `run` does per skill.
    fn delete(app_dir: &Path, items: &[PathBuf]) -> Result<Outcome, String> {
        let _one = lock(app_dir).map_err(|e| format!("{e:?}"))?;
        delete_held(app_dir, items)
    }

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
        write(&app, &Journal { done: true, moves: vec![(root.join("alpha"), aside)], left: vec![] }).unwrap();
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
        write(&app, &Journal { done: true, moves: vec![(root.join("x"), plain.clone()), (root.join("beta"), aside)], left: vec![] }).unwrap();
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
        assert!(!app.join(JOURNAL).exists(), "no record left");
        drop(lock(&app).expect("the lock is free again"));
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
        // A file left by a holder that is gone, whatever it says (here a fresh time and another
        // process): nobody holds the system lock, so it is taken at once.
        std::fs::write(app.join(LOCK), format!("4294967000 {}", now_ms())).unwrap();
        drop(lock(&app).expect("a lock nobody holds is taken back"));
        // A live holder elsewhere (its own open handle with the system lock): busy, file untouched.
        let other = std::fs::OpenOptions::new().read(true).write(true).open(app.join(LOCK)).unwrap();
        other.lock().unwrap();
        assert_eq!(lock(&app).err(), Some(LockError::Busy));
        assert!(app.join(LOCK).exists());
        drop(other);
        let l = lock(&app).expect("free once the other holder lets go");
        assert_eq!(lock(&app).err(), Some(LockError::Busy), "a second taker in this process waits its turn");
        drop(l);
        drop(lock(&app).expect("free again after the drop"));
    }

    /// The child half of the dead-holder test: takes the lock and dies holding it.
    #[test]
    #[ignore]
    fn fixsoon4_child_dies_holding_the_lock() {
        let Ok(dir) = std::env::var("KOLUX_FIXSOON4_DIR") else { return };
        std::mem::forget(lock(Path::new(&dir)).expect("the child takes the lock"));
        std::process::exit(9);
    }

    #[test]
    fn fixsoon4_a_lock_whose_holder_crashed_is_free_at_once() {
        let t = temp("fixsoon4");
        let app = t.join("app");
        let mut child = std::process::Command::new(std::env::current_exe().unwrap())
            .args(["--exact", "skill_delete::tests::fixsoon4_child_dies_holding_the_lock", "--ignored", "--nocapture"])
            .env("KOLUX_FIXSOON4_DIR", &app)
            .spawn()
            .unwrap();
        let pid = child.id();
        assert_eq!(child.wait().unwrap().code(), Some(9), "the child must die holding the lock");
        let text = std::fs::read_to_string(app.join(LOCK)).unwrap();
        assert!(text.starts_with(&format!("{pid} ")), "the file names the dead child {pid}: {text}");
        let began = std::time::Instant::now();
        drop(lock(&app).expect("a crashed holder's lock is taken back"));
        assert!(began.elapsed() < Duration::from_secs(1), "no waiting out a timeout: {:?}", began.elapsed());
    }

    #[test]
    fn fixsoon4_the_system_lock_admits_one_handle_at_a_time() {
        let t = temp("fixsoon4-race");
        let app = t.join("app");
        std::fs::create_dir_all(&app).unwrap();
        // Two handles on the one file, as two processes would hold: only one gets the system lock.
        let open = || std::fs::OpenOptions::new().read(true).write(true).create(true).truncate(false).open(app.join(LOCK)).unwrap();
        let (a, b) = (open(), open());
        let wins = [a.try_lock().is_ok(), b.try_lock().is_ok()];
        assert_eq!(wins.iter().filter(|w| **w).count(), 1, "{wins:?}");
        assert_eq!(lock(&app).err(), Some(LockError::Busy), "and the app's own taker is the third, turned away");
    }

    // FIX-SOON 3: a finished delete's leftovers never block later deletes.

    #[cfg(windows)]
    #[test]
    fn fixsoon3_a_leftover_that_cannot_be_removed_yet_is_carried_and_later_deletes_go_through() {
        use std::os::windows::fs::OpenOptionsExt;
        let t = temp("fixsoon3-a");
        let (app, root) = (t.join("app"), t.join("skills"));
        let alpha = skill(&root, "alpha");
        let beta = skill(&root, "beta");
        let old = skill(&root, ".kolux-deleting-1-2-old");
        write(&app, &Journal { done: true, moves: vec![(root.join("old"), old.clone())], left: vec![] }).unwrap();
        // Another program holds a file in the leftover, so it cannot be removed for now.
        let held = std::fs::OpenOptions::new().read(true).share_mode(0).open(old.join(SKILL_FILE)).unwrap();
        let at = places(&[&root], &[]);
        let done = run(&app, &at, &[pick(&alpha), pick(&beta)]).unwrap();
        assert_eq!(done.iter().map(|d| (d.outcome, d.note.clone())).collect::<Vec<_>>(), [("deleted", None), ("deleted", None)]);
        assert_eq!(names(&root), [".kolux-deleting-1-2-old"], "only the held leftover is on disk");
        let kept = read(&app).expect("the record still names the leftover");
        assert!(kept.done && kept.left.contains(&old), "carried: {:?}", kept.left);
        drop(held);
        recover(&app);
        assert!(names(&root).is_empty(), "the leftover goes at the next start");
        assert!(!app.join(JOURNAL).exists());
    }

    #[test]
    fn fixsoon3_a_crash_mid_delete_puts_its_own_items_back_and_still_removes_the_carried_copies() {
        let t = temp("fixsoon3-b");
        let (app, root) = (t.join("app"), t.join("skills"));
        let aside = skill(&root, ".kolux-deleting-3-4-alpha");
        let old = skill(&root, ".kolux-deleting-1-2-old");
        write(&app, &Journal { done: false, moves: vec![(root.join("alpha"), aside)], left: vec![old] }).unwrap();
        recover(&app);
        assert_eq!(names(&root), ["alpha"], "alpha is back, the carried copy is gone");
        assert!(!app.join(JOURNAL).exists());
    }

    #[test]
    fn fixsoon3_a_record_written_before_carried_copies_existed_is_still_finished() {
        let t = temp("fixsoon3-d");
        let (app, root) = (t.join("app"), t.join("skills"));
        let aside = skill(&root, ".kolux-deleting-1-2-alpha");
        std::fs::create_dir_all(&app).unwrap();
        std::fs::write(app.join(JOURNAL), serde_json::json!({ "done": true, "moves": [[root.join("alpha"), aside]] }).to_string()).unwrap();
        recover(&app);
        assert!(names(&root).is_empty());
        assert!(!app.join(JOURNAL).exists());
    }

    #[cfg(windows)]
    #[test]
    fn fixsoon3_a_failed_move_puts_the_record_back_to_the_carried_copies() {
        use std::os::windows::fs::OpenOptionsExt;
        let t = temp("fixsoon3-c");
        let (app, root) = (t.join("app"), t.join("skills"));
        let a = skill(&root, "alpha");
        let old = skill(&root, ".kolux-deleting-1-2-old");
        write(&app, &Journal { done: true, moves: vec![], left: vec![old.clone()] }).unwrap();
        let held = std::fs::OpenOptions::new().read(true).share_mode(0).open(old.join(SKILL_FILE)).unwrap();
        // The same item twice: the second move finds nothing, so the first is put back.
        let err = delete(&app, &[a.clone(), a]).unwrap_err();
        assert!(err.starts_with("Nothing was deleted"), "{err}");
        assert_eq!(names(&root), [".kolux-deleting-1-2-old", "alpha"]);
        let kept = read(&app).expect("the carried copy stays on record");
        assert!(kept.done && kept.moves.is_empty() && kept.left == [old], "{:?} {:?}", kept.moves, kept.left);
        drop(held);
        recover(&app);
        assert_eq!(names(&root), ["alpha"]);
        assert!(!app.join(JOURNAL).exists());
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

    #[test]
    fn fixb2_a_link_inside_a_junctioned_folder_outside_every_root_is_never_removed() {
        let t = temp("fixb2-a");
        let (app, root, repo, shared) = (t.join("app"), t.join("skills"), t.join("team-repo").join("skills"), t.join("shared"));
        let target = skill(&shared, "alpha");
        std::fs::create_dir_all(&root).unwrap();
        std::fs::create_dir_all(&repo).unwrap();
        // root/team is a junction to a folder outside every root; inside it, alpha links on again.
        link_dir(&repo.join("alpha"), &target);
        link_dir(&root.join("team"), &repo);
        let at = places(&[&root], &[]);
        let shown = root.join("team").join("alpha");
        let plan_of = plan(&at, &[pick(&shown)]).unwrap();
        assert!(plan_of[0].items.is_empty(), "nothing outside the roots is planned: {:?}", plan_of[0].items);
        assert_eq!(plan_of[0].blocked, Some("outside"));
        assert!(plan_of[0].remains.as_deref().is_some_and(|r| same(Path::new(r), &target)), "{:?}", plan_of[0].remains);
        let done = run(&app, &at, &[pick(&shown)]).unwrap();
        assert_eq!((done[0].outcome, done[0].note.as_deref()), ("skipped", Some("outside")));
        assert!(is_link(&repo.join("alpha")), "the link in the outside folder stays");
        assert_eq!(std::fs::read_to_string(target.join(SKILL_FILE)).unwrap(), "# alpha");
    }

    #[test]
    fn fixb2_a_link_whose_folder_really_sits_in_a_root_is_removed_once() {
        let t = temp("fixb2-b");
        let (app, root, elsewhere) = (t.join("app"), t.join("skills"), t.join("dev"));
        let target = skill(&elsewhere, "beta");
        std::fs::create_dir_all(root.join("team")).unwrap();
        let link = root.join("team").join("beta");
        link_dir(&link, &target);
        link_dir(&root.join("mirror"), &root.join("team"));
        let at = places(&[&root], &[]);
        let plan_of = plan(&at, &[pick(&link)]).unwrap();
        assert_eq!(kinds(&plan_of[0]), ["link"], "the link reached twice is one item: {:?}", plan_of[0].items);
        assert_eq!(run(&app, &at, &[pick(&link)]).unwrap()[0].outcome, "deleted");
        assert!(std::fs::symlink_metadata(&link).is_err());
        assert!(target.join(SKILL_FILE).is_file());
    }

    // Stand-in review of 921b6c7, FIX-BEFORE 2: a folder that is deleted is never called "stays".
    #[test]
    fn fix2_an_outside_link_back_into_a_root_never_says_the_deleted_folder_stays() {
        let t = temp("fix2-a");
        let (app, root, repo) = (t.join("app"), t.join("skills"), t.join("team-repo").join("skills"));
        let alpha = skill(&root, "alpha");
        std::fs::create_dir_all(&repo).unwrap();
        // root/team is a junction to a folder outside every root, and its alpha links back to root/alpha.
        link_dir(&repo.join("alpha"), &alpha);
        link_dir(&root.join("team"), &repo);
        let at = places(&[&root], &[]);
        let plan_of = plan(&at, &[pick(&alpha)]).unwrap();
        assert_eq!(kinds(&plan_of[0]), ["folder"], "{:?}", plan_of[0].items);
        assert_eq!(plan_of[0].remains, None, "the folder is deleted, so nothing stays");
        assert_eq!(plan_of[0].dangling.len(), 1, "the outside link is named as left pointing at nothing: {:?}", plan_of[0].dangling);
        assert!(same(Path::new(&plan_of[0].dangling[0]), &PathBuf::from(real(&repo)).join("alpha")), "{:?}", plan_of[0].dangling);
        assert_eq!(run(&app, &at, &[pick(&alpha)]).unwrap()[0].outcome, "deleted");
        assert!(std::fs::symlink_metadata(&alpha).is_err());
        assert!(is_link(&repo.join("alpha")), "the link outside the roots is never removed");
    }

    // Stand-in review of 921b6c7, FIX-SOON 3: a failed put-back keeps the record that can undo it.
    #[test]
    fn fix2_a_put_back_that_fails_keeps_the_not_done_record_and_the_next_start_restores_it() {
        let t = temp("fix2-b");
        let (app, root) = (t.join("app"), t.join("skills"));
        let a = skill(&root, "alpha");
        // The same item twice: the second move finds nothing, and putting the first back fails.
        FAIL_PUT_BACK.with(|f| f.set(true));
        let err = delete(&app, &[a.clone(), a.clone()]).unwrap_err();
        FAIL_PUT_BACK.with(|f| f.set(false));
        assert!(err.starts_with("Nothing was deleted") && err.contains("next start"), "{err}");
        let kept = read(&app).expect("the record that can put alpha back stays");
        assert!(!kept.done && kept.moves.len() == 2, "{:?} {:?}", kept.moves, kept.left);
        recover(&app);
        assert_eq!(names(&root), ["alpha"], "alpha is back");
        assert!(!app.join(JOURNAL).exists());
    }

    // Fix round 3 (stand-in review of 87d34ec).
    fn not_done_record(app: &Path, root: &Path) -> PathBuf {
        let aside = skill(root, ".kolux-deleting-1-2-alpha");
        write(app, &Journal { done: false, moves: vec![(root.join("alpha"), aside.clone())], left: vec![] }).unwrap();
        aside
    }

    fn log_of(app: &Path) -> String {
        std::fs::read_to_string(app.join("logs").join("kolux.log")).unwrap_or_default()
    }

    #[test]
    fn fix3_start_up_recovery_under_the_lock_puts_a_hidden_skill_back() {
        let t = temp("fix3-a");
        let (app, root) = (t.join("app"), t.join("skills"));
        not_done_record(&app, &root);
        assert_eq!(startup_recover(&app), Startup::Recovered);
        assert_eq!(names(&root), ["alpha"]);
        assert!(!app.join(JOURNAL).exists());
        assert!(lock(&app).is_ok(), "the lock is released again");
    }

    #[test]
    fn fix3_start_up_recovery_leaves_everything_alone_and_says_so_while_another_instance_holds_the_lock() {
        let t = temp("fix3-b");
        let (app, root) = (t.join("app"), t.join("skills"));
        let aside = not_done_record(&app, &root);
        // FIX-4 (6): the other instance is a second handle holding the system lock on the file, not
        // this process's own guard, so the Busy comes from the system lock as it would across processes.
        std::fs::create_dir_all(&app).unwrap();
        let other = std::fs::OpenOptions::new().read(true).write(true).create(true).truncate(false).open(app.join(LOCK)).unwrap();
        other.lock().unwrap();
        assert!(HELD.lock().unwrap().is_empty() || !HELD.lock().unwrap().contains(&app), "nothing in this process holds it");
        assert_eq!(startup_recover(&app), Startup::Skipped);
        assert_eq!(names(&root), [aside.file_name().unwrap().to_string_lossy().into_owned()], "nothing moved");
        assert!(app.join(JOURNAL).exists());
        assert!(log_of(&app).contains("skipped, another instance holds the skill lock"), "{}", log_of(&app));
    }

    #[test]
    fn fix3_start_up_recovery_logs_and_still_recovers_when_the_lock_cannot_be_opened() {
        let t = temp("fix3-c");
        let (app, root) = (t.join("app"), t.join("skills"));
        not_done_record(&app, &root);
        // A folder where the lock file should be: the lock can never be opened.
        std::fs::create_dir_all(app.join(LOCK)).unwrap();
        assert!(matches!(lock(&app), Err(LockError::Failed(_))));
        assert_eq!(startup_recover(&app), Startup::RecoveredUnlocked);
        assert_eq!(names(&root), ["alpha"], "the skill is not left hidden");
        assert!(!app.join(JOURNAL).exists());
        assert!(log_of(&app).contains("recovering without it"), "{}", log_of(&app));
    }

    #[test]
    fn fix3_a_set_aside_copy_whose_original_came_back_counts_as_stuck_and_nothing_is_overwritten() {
        let t = temp("fix3-d");
        let (app, root) = (t.join("app"), t.join("skills"));
        let aside = not_done_record(&app, &root);
        let back = skill(&root, "alpha");
        std::fs::write(back.join(SKILL_FILE), "# new alpha").unwrap();
        recover(&app);
        assert!(app.join(JOURNAL).exists(), "the record stays, so the hidden copy is not orphaned");
        assert_eq!(std::fs::read_to_string(back.join(SKILL_FILE)).unwrap(), "# new alpha");
        assert!(aside.join(SKILL_FILE).is_file(), "the hidden copy is untouched");
        assert!(log_of(&app).contains("both exist"), "{}", log_of(&app));
        // A later delete is refused rather than writing over the record, and (FIX-4) the error names
        // the cause and both paths instead of asking for a restart that would not help.
        let other = skill(&root, "beta");
        let err = delete(&app, &[other]).unwrap_err();
        assert!(err.starts_with("Nothing was deleted") && err.contains("both exist") && err.contains(&back.display().to_string()) && err.contains(&aside.display().to_string()), "{err}");
        assert!(!err.contains("restart"), "{err}");
        assert!(root.join("beta").is_dir());
        // Once the user clears the original, the next start puts the copy back.
        std::fs::remove_dir_all(&back).unwrap();
        recover(&app);
        assert_eq!(std::fs::read_to_string(root.join("alpha").join(SKILL_FILE)).unwrap(), "# .kolux-deleting-1-2-alpha");
        assert!(!app.join(JOURNAL).exists());
    }

    #[test]
    fn fix3_a_record_naming_a_copy_that_is_not_next_to_its_original_is_neither_moved_nor_removed() {
        let t = temp("fix3-e");
        let (app, root, other) = (t.join("app"), t.join("skills"), t.join("elsewhere"));
        let stray = skill(&other, ".kolux-deleting-1-2-alpha");
        // Not done: putting it back would move a folder from outside the skill folders into one.
        write(&app, &Journal { done: false, moves: vec![(root.join("alpha"), stray.clone())], left: vec![] }).unwrap();
        recover(&app);
        assert!(stray.is_dir() && !root.join("alpha").exists());
        assert!(app.join(JOURNAL).exists());
        // Done: removing it would delete a folder that is not the original's neighbour.
        write(&app, &Journal { done: true, moves: vec![(root.join("alpha"), stray.clone())], left: vec![] }).unwrap();
        recover(&app);
        assert!(stray.is_dir(), "kept");
        assert!(app.join(JOURNAL).exists());
        assert!(log_of(&app).contains("refused"), "{}", log_of(&app));
    }

    // Fix round 4 (stand-in review of 0a444d4).

    /// FIX-SOON 1: the fix3_e fixture, then a delete. The refused entry used to be carried into the
    /// new record's `left` list, which is checked by name alone, and removed from `elsewhere`.
    #[test]
    fn fix4_a_refused_record_entry_is_dropped_by_the_next_delete_and_nothing_outside_the_skill_folder_goes() {
        let t = temp("fix4-a");
        let (app, root, other) = (t.join("app"), t.join("skills"), t.join("elsewhere"));
        let stray = skill(&other, ".kolux-deleting-1-2-alpha");
        let plain = skill(&other, "plain");
        let beta = skill(&root, "beta");
        write(&app, &Journal { done: true, moves: vec![(root.join("alpha"), stray.clone())], left: vec![plain.clone()] }).unwrap();
        recover(&app);
        assert!(app.join(JOURNAL).exists(), "start-up refuses both entries and keeps the record");
        assert_eq!(delete(&app, &[beta]).unwrap(), Outcome::Deleted);
        assert_eq!(names(&other), [".kolux-deleting-1-2-alpha", "plain"], "nothing outside the skill folder was removed");
        assert!(names(&root).is_empty(), "the chosen skill is gone");
        assert!(!app.join(JOURNAL).exists(), "the refused entries are dropped, not carried");
        let log = log_of(&app);
        assert!(log.contains(&format!("dropped {} from the record", stray.display())) && log.contains(&format!("dropped {} from the record", plain.display())), "{log}");
    }

    /// FIX-SOON 2 (refused-entry case): the delete error names the entry and both paths.
    #[test]
    fn fix4_a_delete_behind_a_refused_not_done_record_names_the_paths() {
        let t = temp("fix4-b");
        let (app, root, other) = (t.join("app"), t.join("skills"), t.join("elsewhere"));
        let stray = skill(&other, ".kolux-deleting-1-2-alpha");
        let from = root.join("alpha");
        write(&app, &Journal { done: false, moves: vec![(from.clone(), stray.clone())], left: vec![] }).unwrap();
        let beta = skill(&root, "beta");
        let err = delete(&app, &[beta]).unwrap_err();
        assert!(err.starts_with("Nothing was deleted") && err.contains("not a copy set aside") && err.contains(&stray.display().to_string()) && err.contains(&from.display().to_string()), "{err}");
        assert!(root.join("beta").is_dir() && stray.is_dir());
    }

    /// FIX-SOON 2 (put-back case): the error says what could not be put back, and where.
    #[cfg(windows)]
    #[test]
    fn fix4_a_delete_behind_a_failed_put_back_names_the_copy_and_its_place() {
        use std::os::windows::fs::OpenOptionsExt;
        let t = temp("fix4-c");
        let (app, root) = (t.join("app"), t.join("skills"));
        let a = skill(&root, "alpha");
        FAIL_PUT_BACK.with(|f| f.set(true));
        assert!(delete(&app, &[a.clone(), a.clone()]).is_err());
        FAIL_PUT_BACK.with(|f| f.set(false));
        let aside = read(&app).expect("the not-done record stays").moves[0].1.clone();
        assert!(aside.is_dir(), "alpha is still set aside as {}", aside.display());
        // Another program holds a file in the copy, so the put-back at the next delete fails too.
        let held = std::fs::OpenOptions::new().read(true).share_mode(0).open(aside.join(SKILL_FILE)).unwrap();
        let beta = skill(&root, "beta");
        let err = delete(&app, &[beta]).unwrap_err();
        assert!(err.contains("could not be put back as") && err.contains(&a.display().to_string()) && err.contains(&aside.display().to_string()), "{err}");
        assert!(root.join("beta").is_dir() && aside.is_dir());
        drop(held);
        assert!(recover(&app).is_empty());
        assert_eq!(names(&root), ["alpha", "beta"]);
    }

    /// AFTER 2: a copy is the original's only when its name is exactly `.kolux-deleting-<pid>-<nanos>-<name>`.
    #[test]
    fn fix4_a_copy_named_after_a_longer_name_is_not_the_originals_copy() {
        let root = Path::new("C:\\s");
        let alpha = root.join("alpha");
        assert!(aside_of(&alpha, &root.join(".kolux-deleting-1-2-alpha")));
        assert!(aside_of(&alpha, &root.join(".kolux-deleting-4294967295-1760000000000000000-alpha")));
        assert!(!aside_of(&alpha, &root.join(".kolux-deleting-1-2-xalpha")), "ends with the name but is another skill's copy");
        assert!(!aside_of(&alpha, &root.join(".kolux-deleting-x-2-alpha")), "no stamp");
        assert!(!aside_of(&alpha, &root.join(".kolux-deleting-1-alpha")), "half a stamp");
        assert!(!aside_of(&alpha, &root.join(".kolux-deleting-1-2-alpha-x")));
        assert!(!aside_of(&alpha, &Path::new("C:\\t").join(".kolux-deleting-1-2-alpha")), "not next to the original");
        assert!(set_aside_name(&root.join(".kolux-deleting-1-2-old")) && set_aside_name(&root.join(".kolux-deleting-1-2-a-b")));
        assert!(!set_aside_name(&root.join(".kolux-deleting-1-2-")) && !set_aside_name(&root.join(".kolux-deleting-old")) && !set_aside_name(&root.join("plain")));
        // On disk: a not-done record naming xalpha's copy as alpha's is refused, and xalpha's copy is not renamed to alpha.
        let t = temp("fix4-d");
        let (app, skills) = (t.join("app"), t.join("skills"));
        let copy = skill(&skills, ".kolux-deleting-1-2-xalpha");
        write(&app, &Journal { done: false, moves: vec![(skills.join("alpha"), copy.clone())], left: vec![] }).unwrap();
        assert_eq!(recover(&app).len(), 1);
        assert_eq!(names(&skills), [".kolux-deleting-1-2-xalpha"], "not moved");
        assert!(app.join(JOURNAL).exists());
        // Done: not removed either.
        write(&app, &Journal { done: true, moves: vec![(skills.join("alpha"), copy.clone())], left: vec![] }).unwrap();
        recover(&app);
        assert!(copy.is_dir() && app.join(JOURNAL).exists());
    }

    /// AFTER 1: a passing holder of the lock file (a backup or antivirus tool) gets one retry before
    /// recovery runs without the lock.
    #[cfg(windows)]
    #[test]
    fn fix4_start_up_recovery_tries_the_lock_once_more_before_going_without_it() {
        use std::os::windows::fs::OpenOptionsExt;
        let t = temp("fix4-e");
        let (app, root) = (t.join("app"), t.join("skills"));
        not_done_record(&app, &root);
        let held = std::fs::OpenOptions::new().read(true).write(true).create(true).truncate(false).share_mode(0).open(app.join(LOCK)).unwrap();
        assert!(matches!(lock(&app), Err(LockError::Failed(_))), "the file cannot be opened while it is held without sharing");
        let gone = std::thread::spawn(move || {
            std::thread::sleep(PAUSE / 2);
            drop(held);
        });
        assert_eq!(startup_recover(&app), Startup::Recovered, "the second try gets the lock");
        gone.join().unwrap();
        assert_eq!(names(&root), ["alpha"]);
        assert!(!log_of(&app).contains("recovering without it"), "{}", log_of(&app));
    }

    #[test]
    fn fix3_a_link_only_delete_names_no_dangling_link() {
        let t = temp("fix3-f");
        let (app, root, elsewhere) = (t.join("app"), t.join("skills"), t.join("dev"));
        let target = skill(&elsewhere, "beta");
        std::fs::create_dir_all(&root).unwrap();
        let link = root.join("beta");
        link_dir(&link, &target);
        let at = places(&[&root], &[]);
        let plan_of = plan(&at, &[pick(&link)]).unwrap();
        assert!(plan_of[0].dangling.is_empty());
        assert_eq!(run(&app, &at, &[pick(&link)]).unwrap()[0].outcome, "deleted");
    }
}
