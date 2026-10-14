//! GIT-001 (T-033-b): the Source Control list, the diff tab and All Changes follow git state
//! through a folder watcher instead of a poll. One watch per worktree, shared by every caller that
//! asks for it (counted, so the last one to go stops it). A watch reads the working tree, the
//! worktree's own git folder (HEAD and index) and the shared refs; every change it counts restarts
//! a short quiet timer, and when the timer runs out (or a burst has gone on for a second) it reads
//! the status once and sends it to the window as `scm-status-<id>`, the same shape `scm_status`
//! returns. Behind it, a safety read every 30 s. A watch that cannot start (a network drive, a
//! junctioned path, no handle), or that later errors or overflows, goes back to reading every 4 s
//! for that worktree and says so once in the diagnostics log.
//!
//! The watcher is Windows' own folder-change reader (ReadDirectoryChangesW); the `notify` crate is
//! CC0-1.0 in every version, which the licence list refuses (T-033-b decision).

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::mpsc::{channel, RecvTimeoutError, Sender};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

/// How long the tree must stay quiet after a change before the status is read.
pub const QUIET: Duration = Duration::from_millis(250);
/// The longest a burst of changes can hold the read back.
pub const CAP: Duration = Duration::from_secs(1);
/// The safety read behind a working watch.
pub const SAFETY: Duration = Duration::from_secs(30);
/// The old poll, for a worktree whose watch could not start or broke.
pub const FALLBACK: Duration = Duration::from_secs(4);

/// Folder names whose changes never count, on any path segment: build output and package caches,
/// which git ignores in practice and which would keep the quiet timer from ever running out.
/// ponytail: a fixed list; the upgrade is `git check-ignore --stdin` cached per root (T-033-c).
pub const SKIP: [&str; 4] = ["target", "node_modules", "dist", ".venv"];

/// Where a changed path was reported from.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Spot {
    /// The worktree root; for a main checkout its `.git` folder is inside.
    Tree,
    /// A linked worktree's own git folder (outside the root).
    GitDir,
    /// The shared `refs` folder of a linked worktree's repository.
    Refs,
}

/// Whether a change at `rel` (relative to its spot, forward slashes) can move the status. Inside
/// git's folders only HEAD, the index and refs count: never objects, never `index.lock` churn,
/// never FETCH_HEAD or logs, so a fetch costs one read for its ref updates.
pub fn counts(spot: Spot, rel: &str) -> bool {
    let rel = rel.trim_start_matches('/');
    match spot {
        Spot::Refs => true,
        Spot::GitDir => rel == "HEAD" || rel == "index",
        Spot::Tree => {
            let mut segs = rel.split('/');
            let first = segs.next().unwrap_or_default();
            if first.eq_ignore_ascii_case(".git") {
                let rest = &rel[first.len()..].trim_start_matches('/');
                return *rest == "HEAD" || *rest == "index" || *rest == "refs" || rest.starts_with("refs/");
            }
            !rel.split('/').any(|s| SKIP.iter().any(|k| s.eq_ignore_ascii_case(k)))
        }
    }
}

/// The quiet timer: a change restarts it, a burst is cut off at `cap` after its first change.
#[derive(Debug)]
pub struct Debounce {
    quiet: Duration,
    cap: Duration,
    first: Option<Instant>,
    last: Option<Instant>,
}

impl Debounce {
    pub fn new(quiet: Duration, cap: Duration) -> Self {
        Debounce { quiet, cap, first: None, last: None }
    }
    pub fn hit(&mut self, now: Instant) {
        self.first.get_or_insert(now);
        self.last = Some(now);
    }
    /// How long until the pending read is due; None when nothing is pending.
    pub fn wait(&self, now: Instant) -> Option<Duration> {
        let (first, last) = (self.first?, self.last?);
        Some(((last + self.quiet).min(first + self.cap)).saturating_duration_since(now))
    }
    /// True (and cleared) when the pending read is due.
    pub fn take(&mut self, now: Instant) -> bool {
        if self.wait(now) == Some(Duration::ZERO) {
            self.first = None;
            self.last = None;
            true
        } else {
            false
        }
    }
}

/// What a watch's worker hears.
#[derive(Debug)]
pub enum Signal {
    Change,
    /// The watch broke (an error, an overflow, the folder went away); the reason is logged.
    Broken(String),
    Stop,
}

/// Watching (safety read every 30 s) or reading every 4 s because the watch is gone.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Mode {
    Watching,
    Polling,
}

impl Mode {
    pub fn tick(self) -> Duration {
        match self {
            Mode::Watching => SAFETY,
            Mode::Polling => FALLBACK,
        }
    }
    /// The mode after the watch broke, and whether this is the first break (the one logged).
    pub fn broken(self) -> (Mode, bool) {
        (Mode::Polling, self == Mode::Watching)
    }
}

/// Where a worktree's state lives: its root, its own git folder and the repository's shared one.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Places {
    pub root: PathBuf,
    pub git_dir: PathBuf,
    pub common: PathBuf,
}

impl Places {
    /// The folders to watch: the root (recursive), and for a linked worktree its own git folder
    /// (HEAD, index) and the shared refs.
    pub fn watches(&self) -> Vec<(PathBuf, bool, Spot)> {
        let inner = self.root.join(".git");
        let same = |a: &Path, b: &Path| key(&a.to_string_lossy()) == key(&b.to_string_lossy());
        let mut out = vec![(self.root.clone(), true, Spot::Tree)];
        if !same(&self.git_dir, &inner) {
            out.push((self.git_dir.clone(), false, Spot::GitDir));
        }
        if !same(&self.common, &inner) {
            out.push((self.common.join("refs"), true, Spot::Refs));
        }
        out
    }
}

/// The same folder spelled with either slash or letter case maps to one key.
pub fn key(path: &str) -> String {
    path.replace('\\', "/").trim_end_matches('/').to_lowercase()
}

/// Asks git where the worktree holding `path` (a folder or a file in it) keeps its state.
pub fn places(path: &Path) -> Result<Places, String> {
    let dir = if path.is_file() { path.parent().unwrap_or(path) } else { path };
    let out = crate::git::run(&["rev-parse", "--path-format=absolute", "--show-toplevel", "--git-dir", "--git-common-dir"], Some(dir))?;
    let mut l = out.lines().map(|s| PathBuf::from(s.trim()));
    match (l.next(), l.next(), l.next()) {
        (Some(root), Some(git_dir), Some(common)) => Ok(Places { root, git_dir, common }),
        _ => Err(format!("{} is not inside a Git worktree", path.display())),
    }
}

/// Why a folder is not watched but read every 4 s: a network drive or a path that leads elsewhere
/// (a junction or a substituted drive), where change reports cannot be trusted.
pub fn unwatchable(root: &Path) -> Option<String> {
    #[cfg(windows)]
    {
        let drive: String = root.to_string_lossy().chars().take(3).collect();
        let wide: Vec<u16> = drive.encode_utf16().chain(Some(0)).collect();
        // SAFETY: a NUL-terminated wide string that outlives the call.
        if unsafe { windows_sys::Win32::Storage::FileSystem::GetDriveTypeW(wide.as_ptr()) } == 4 {
            return Some("it is on a network drive".into());
        }
    }
    let real = std::fs::canonicalize(root).map_err(|e| e.to_string()).ok()?;
    let real = real.to_string_lossy();
    let real = real.strip_prefix(r"\\?\").unwrap_or(&real);
    (key(real) != key(&root.to_string_lossy())).then(|| format!("its path leads to {real}"))
}

/// Splits a FILE_NOTIFY_INFORMATION chain into paths with forward slashes.
pub fn parse_notify(buf: &[u8]) -> Vec<String> {
    let mut out = Vec::new();
    let mut at = 0usize;
    let word = |b: &[u8], i: usize| b.get(i..i + 4).map(|w| u32::from_le_bytes([w[0], w[1], w[2], w[3]]) as usize);
    while let (Some(next), Some(len)) = (word(buf, at), word(buf, at + 8)) {
        let Some(name) = buf.get(at + 12..at + 12 + len) else { break };
        let wide: Vec<u16> = name.as_chunks::<2>().0.iter().map(|c| u16::from_le_bytes(*c)).collect();
        out.push(String::from_utf16_lossy(&wide).replace('\\', "/"));
        if next == 0 {
            break;
        }
        at += next;
    }
    out
}

/// One open watch, shared by every caller of the same worktree.
struct Watch {
    id: u64,
    refs: usize,
    tx: Sender<Signal>,
    stop: Arc<AtomicBool>,
    watching: bool,
}

static WATCHES: Mutex<BTreeMap<String, Watch>> = Mutex::new(BTreeMap::new());
static NEXT: AtomicU64 = AtomicU64::new(1);

#[derive(Clone, Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WatchStart {
    /// The event the status arrives on is `scm-status-<id>`.
    pub id: u64,
    pub worktree: String,
    /// False when the worktree is read every 4 s instead.
    pub watching: bool,
}

/// What the worker does with a fresh status.
type Sink = Arc<dyn Fn(&crate::scm::Status) + Send + Sync>;
type Log = Arc<dyn Fn(&str) + Send + Sync>;

/// Starts (or joins) the watch of the worktree holding `path`.
pub fn watch(path: &Path, sink: impl Fn(u64) -> Sink, log: Log) -> Result<WatchStart, String> {
    let p = places(path)?;
    let k = key(&p.root.to_string_lossy());
    let worktree = p.root.to_string_lossy().to_string();
    let mut all = WATCHES.lock().unwrap_or_else(|e| e.into_inner());
    if let Some(w) = all.get_mut(&k) {
        w.refs += 1;
        return Ok(WatchStart { id: w.id, worktree, watching: w.watching });
    }
    let id = NEXT.fetch_add(1, Ordering::Relaxed);
    let (tx, rx) = channel();
    let stop = Arc::new(AtomicBool::new(false));
    let mut why = unwatchable(&p.root);
    if why.is_none() {
        for (dir, recursive, spot) in p.watches() {
            if let Err(e) = start_reader(&dir, recursive, spot, tx.clone(), stop.clone()) {
                why = Some(format!("{} could not be watched: {e}", dir.display()));
                stop.store(true, Ordering::Relaxed);
                break;
            }
        }
    }
    let mode = match &why {
        None => Mode::Watching,
        Some(w) => {
            log(&format!("source control: {worktree} is read every 4 s instead of watched: {w}"));
            Mode::Polling
        }
    };
    let root = p.root.clone();
    let send = sink(id);
    let wlog = log.clone();
    std::thread::Builder::new()
        .name(format!("scm-watch-{id}"))
        .spawn(move || worker(&root, mode, rx, send, wlog))
        .map_err(|e| e.to_string())?;
    let watching = mode == Mode::Watching;
    all.insert(k, Watch { id, refs: 1, tx, stop, watching });
    Ok(WatchStart { id, worktree, watching })
}

/// One caller is done with watch `id`; the last one stops it.
pub fn unwatch(id: u64) {
    let mut all = WATCHES.lock().unwrap_or_else(|e| e.into_inner());
    let Some(k) = all.iter().find(|(_, w)| w.id == id).map(|(k, _)| k.clone()) else { return };
    let w = all.get_mut(&k).expect("found above");
    w.refs -= 1;
    if w.refs == 0 {
        w.stop.store(true, Ordering::Relaxed);
        let _ = w.tx.send(Signal::Stop);
        all.remove(&k);
    }
}

/// Test seam and evidence harness: breaks watch `id` as an error or overflow would. False when no
/// such watch is open.
#[cfg(test)]
pub fn break_watch(id: u64, why: &str) -> bool {
    let all = WATCHES.lock().unwrap_or_else(|e| e.into_inner());
    all.values().find(|w| w.id == id).is_some_and(|w| {
        w.stop.store(true, Ordering::Relaxed);
        w.tx.send(Signal::Broken(why.to_string())).is_ok()
    })
}

/// How many watches are open (tests and the evidence harness).
#[cfg(test)]
pub fn open_count() -> usize {
    WATCHES.lock().map(|a| a.len()).unwrap_or(0)
}

/// When each read began, per root (tests: a read's own length varies with load, its start does not).
#[cfg(test)]
pub static STARTS: Mutex<Vec<(PathBuf, Instant)>> = Mutex::new(Vec::new());

/// Waits on the signals, reads the status when a change has settled or a tick is due, and sends it.
fn worker(root: &Path, mut mode: Mode, rx: std::sync::mpsc::Receiver<Signal>, send: Sink, log: Log) {
    let mut deb = Debounce::new(QUIET, CAP);
    let mut last = Instant::now();
    loop {
        let now = Instant::now();
        let until_tick = (last + mode.tick()).saturating_duration_since(now);
        let wait = deb.wait(now).map_or(until_tick, |d| d.min(until_tick));
        match rx.recv_timeout(wait) {
            Ok(Signal::Change) => deb.hit(Instant::now()),
            Ok(Signal::Broken(why)) => {
                let (next, first) = mode.broken();
                if first {
                    log(&format!("source control: the watch on {} stopped ({why}); reading it every 4 s instead", root.display()));
                    deb.hit(Instant::now()); // read now: changes may have been missed
                }
                mode = next;
            }
            Ok(Signal::Stop) | Err(RecvTimeoutError::Disconnected) => return,
            Err(RecvTimeoutError::Timeout) => {}
        }
        let now = Instant::now();
        let changed = deb.take(now);
        if changed || now >= last + mode.tick() {
            last = now;
            #[cfg(test)]
            STARTS.lock().unwrap_or_else(|e| e.into_inner()).push((root.to_path_buf(), now));
            if let Ok(st) = crate::scm::status(root) {
                send(&st);
            }
        }
    }
}

/// Debug builds only: `KOLUX_DEV_INJECT=watch-error` breaks every watch on its first change, so
/// the fall-back read can be shown live.
fn injected_break() -> bool {
    cfg!(debug_assertions) && std::env::var("KOLUX_DEV_INJECT").is_ok_and(|v| v == "watch-error")
}

#[cfg(windows)]
fn start_reader(dir: &Path, recursive: bool, spot: Spot, tx: Sender<Signal>, stop: Arc<AtomicBool>) -> Result<(), String> {
    use windows_sys::Win32::Foundation::{CloseHandle, GetLastError, HANDLE, INVALID_HANDLE_VALUE, WAIT_TIMEOUT};
    use windows_sys::Win32::Storage::FileSystem::*;
    use windows_sys::Win32::System::Threading::{CreateEventW, ResetEvent, WaitForSingleObject};
    use windows_sys::Win32::System::IO::{CancelIoEx, GetOverlappedResult, OVERLAPPED};

    struct Owned(HANDLE);
    // SAFETY: a kernel handle may be used and closed from any thread.
    unsafe impl Send for Owned {}
    impl Drop for Owned {
        fn drop(&mut self) {
            // SAFETY: the handle came from CreateFileW / CreateEventW and is closed once.
            unsafe { CloseHandle(self.0) };
        }
    }
    let wide: Vec<u16> = dir.as_os_str().to_string_lossy().encode_utf16().chain(Some(0)).collect();
    // SAFETY: a NUL-terminated wide path; the flags open a folder for overlapped change reads.
    let h = unsafe { CreateFileW(wide.as_ptr(), FILE_LIST_DIRECTORY, FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE, std::ptr::null(), OPEN_EXISTING, FILE_FLAG_BACKUP_SEMANTICS | FILE_FLAG_OVERLAPPED, std::ptr::null_mut()) };
    if h == INVALID_HANDLE_VALUE {
        // SAFETY: plain thread-local error read.
        return Err(format!("could not open the folder (error {})", unsafe { GetLastError() }));
    }
    let h = Owned(h);
    // SAFETY: a manual-reset, unnamed event.
    let ev = unsafe { CreateEventW(std::ptr::null(), 1, 0, std::ptr::null()) };
    if ev.is_null() {
        return Err("could not make a wait event".into());
    }
    let ev = Owned(ev);
    let filter = FILE_NOTIFY_CHANGE_FILE_NAME | FILE_NOTIFY_CHANGE_DIR_NAME | FILE_NOTIFY_CHANGE_SIZE | FILE_NOTIFY_CHANGE_LAST_WRITE | FILE_NOTIFY_CHANGE_CREATION;
    let label = dir.display().to_string();
    std::thread::Builder::new()
        .name("scm-watch-reader".into())
        .spawn(move || {
            let (h, ev) = (h, ev);
            let mut buf = vec![0u32; 64 * 1024]; // 256 KB, DWORD-aligned as the call needs
            let bytes = buf.len() * 4;
            let broke = |why: String| drop(tx.send(Signal::Broken(why)));
            loop {
                let mut ov: OVERLAPPED = unsafe { std::mem::zeroed() };
                ov.hEvent = ev.0;
                // SAFETY: the buffer and the OVERLAPPED stay put until the read completes or is
                // cancelled below, both before this iteration ends.
                unsafe { ResetEvent(ev.0) };
                let ok = unsafe { ReadDirectoryChangesW(h.0, buf.as_mut_ptr().cast(), bytes as u32, i32::from(recursive), filter, std::ptr::null_mut(), &mut ov, None) };
                if ok == 0 {
                    return broke(format!("{label}: the change read failed (error {})", unsafe { GetLastError() }));
                }
                let mut n = 0u32;
                loop {
                    // SAFETY: waits on our own event.
                    if unsafe { WaitForSingleObject(ev.0, 500) } != WAIT_TIMEOUT {
                        break;
                    }
                    if stop.load(Ordering::Relaxed) {
                        // SAFETY: cancels our pending read, then waits for it to finish with the buffer.
                        unsafe {
                            CancelIoEx(h.0, &ov);
                            GetOverlappedResult(h.0, &ov, &mut n, 1);
                        }
                        return;
                    }
                }
                // SAFETY: the read has signalled; collects its byte count.
                if unsafe { GetOverlappedResult(h.0, &ov, &mut n, 0) } == 0 {
                    let e = unsafe { GetLastError() };
                    return broke(if e == windows_sys::Win32::Foundation::ERROR_NOTIFY_ENUM_DIR { format!("{label}: too many changes at once") } else { format!("{label}: error {e}") });
                }
                if stop.load(Ordering::Relaxed) {
                    return;
                }
                if n == 0 {
                    return broke(format!("{label}: too many changes at once"));
                }
                // SAFETY: the first n bytes of the buffer were written by the read.
                let raw = unsafe { std::slice::from_raw_parts(buf.as_ptr().cast::<u8>(), n as usize) };
                if parse_notify(raw).iter().any(|p| counts(spot, p)) {
                    if injected_break() {
                        return broke("injected for testing".into());
                    }
                    if tx.send(Signal::Change).is_err() {
                        return;
                    }
                }
            }
        })
        .map(|_| ())
        .map_err(|e| e.to_string())
}

#[cfg(not(windows))]
fn start_reader(_dir: &Path, _recursive: bool, _spot: Spot, _tx: Sender<Signal>, _stop: Arc<AtomicBool>) -> Result<(), String> {
    Err("folder watching is only built for Windows".into())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::AtomicUsize;

    #[test]
    fn git_folder_counts_only_head_index_and_refs() {
        for rel in [".git/HEAD", ".git/index", ".git/refs/heads/main", ".git/refs/remotes/origin/x", ".git/refs"] {
            assert!(counts(Spot::Tree, rel), "{rel}");
        }
        for rel in [".git/index.lock", ".git/objects/ab/cdef", ".git/objects", ".git/FETCH_HEAD", ".git/logs/HEAD", ".git/ORIG_HEAD", ".git/config", ".git/COMMIT_EDITMSG"] {
            assert!(!counts(Spot::Tree, rel), "{rel}");
        }
        assert!(counts(Spot::GitDir, "HEAD") && counts(Spot::GitDir, "index"));
        assert!(!counts(Spot::GitDir, "index.lock") && !counts(Spot::GitDir, "logs/HEAD") && !counts(Spot::GitDir, "ORIG_HEAD"));
        assert!(counts(Spot::Refs, "heads/feature"));
    }

    #[test]
    fn build_folders_never_count_on_any_segment() {
        for rel in ["target/debug/x.rlib", "src-tauri/target/debug/deps/a.d", "web/node_modules/react/index.js", "pkg/dist/app.js", ".venv/lib/site.py", "a/Node_Modules/b"] {
            assert!(!counts(Spot::Tree, rel), "{rel}");
        }
        for rel in ["src/main.rs", "targets.md", "distance/a.txt", "README.md", "a b/ü.txt"] {
            assert!(counts(Spot::Tree, rel), "{rel}");
        }
    }

    #[test]
    fn debounce_waits_for_quiet_and_caps_a_burst() {
        let t0 = Instant::now();
        let ms = Duration::from_millis;
        let mut d = Debounce::new(ms(250), ms(1000));
        assert_eq!(d.wait(t0), None);
        assert!(!d.take(t0));
        d.hit(t0);
        assert_eq!(d.wait(t0 + ms(100)), Some(ms(150)));
        d.hit(t0 + ms(200)); // a second change restarts the quiet timer
        assert!(!d.take(t0 + ms(300)));
        assert!(d.take(t0 + ms(450)));
        assert_eq!(d.wait(t0 + ms(460)), None, "cleared once taken");
        // A change every 100 ms never goes quiet; the read still comes at 1 s.
        let b = t0 + ms(2000);
        let mut fired = None;
        for i in 0..30u64 {
            let now = b + ms(i * 100);
            if d.take(now) {
                fired = Some(i);
                break;
            }
            d.hit(now);
        }
        assert_eq!(fired, Some(10));
    }

    #[test]
    fn a_broken_watch_polls_every_4_s_and_logs_once() {
        assert_eq!(Mode::Watching.tick(), SAFETY);
        let (m, first) = Mode::Watching.broken();
        assert_eq!((m, first), (Mode::Polling, true));
        assert_eq!(m.tick(), FALLBACK);
        assert_eq!(m.broken(), (Mode::Polling, false));
    }

    #[test]
    fn notify_records_parse_into_forward_slash_paths() {
        let mut buf = Vec::new();
        let rec = |name: &str, act: u32, last: bool| {
            let w: Vec<u8> = name.encode_utf16().flat_map(|c| c.to_le_bytes()).collect();
            let mut r = Vec::new();
            let len = 12 + w.len();
            let pad = (4 - len % 4) % 4;
            r.extend((if last { 0 } else { (len + pad) as u32 }).to_le_bytes());
            r.extend(act.to_le_bytes());
            r.extend((w.len() as u32).to_le_bytes());
            r.extend(w);
            r.extend(vec![0; pad]);
            r
        };
        buf.extend(rec(r"src\main.rs", 3, false));
        buf.extend(rec(r".git\index", 1, false));
        buf.extend(rec("ü.txt", 2, true));
        assert_eq!(parse_notify(&buf), ["src/main.rs", ".git/index", "ü.txt"]);
        assert!(parse_notify(&[1, 2, 3]).is_empty());
    }

    #[test]
    fn linked_worktree_watches_its_git_folder_and_shared_refs() {
        let main = Places { root: "G:/r".into(), git_dir: "G:/r/.git".into(), common: "G:/r/.git".into() };
        assert_eq!(main.watches().len(), 1);
        let linked = Places { root: "G:/w".into(), git_dir: "G:/r/.git/worktrees/w".into(), common: "G:/r/.git".into() };
        let w = linked.watches();
        assert_eq!(w.iter().map(|(_, r, s)| (*r, *s)).collect::<Vec<_>>(), [(true, Spot::Tree), (false, Spot::GitDir), (true, Spot::Refs)]);
        assert_eq!(w[2].0, PathBuf::from("G:/r/.git").join("refs"));
    }

    /// A one-commit repo under KOLUX_TEST_REPOS (the temp folder when unset), removed afterwards.
    fn repo(name: &str) -> crate::test_dir::TempDir {
        let base = std::env::var_os("KOLUX_TEST_REPOS").map(PathBuf::from).unwrap_or_else(std::env::temp_dir);
        let dir = crate::test_dir::TempDir(base.join(format!("scm-watch-{name}-{}", std::process::id())));
        let _ = std::fs::remove_dir_all(&*dir);
        std::fs::create_dir_all(&*dir).unwrap();
        let git = |a: &[&str]| assert!(crate::git::command(a, Some(&dir)).output().unwrap().status.success(), "{a:?}");
        git(&["init", "-q", "-b", "main"]);
        git(&["config", "user.email", "t@example.com"]);
        git(&["config", "user.name", "t"]);
        std::fs::write(dir.join("a.txt"), "one\n").unwrap();
        git(&["add", "."]);
        git(&["commit", "-q", "--no-verify", "-m", "first"]);
        dir
    }

    /// Waits up to `limit` for `f` to hold.
    fn until(limit: Duration, f: impl Fn() -> bool) -> bool {
        let end = Instant::now() + limit;
        while Instant::now() < end {
            if f() {
                return true;
            }
            std::thread::sleep(Duration::from_millis(20));
        }
        f()
    }

    #[cfg(windows)]
    #[test]
    fn a_real_repo_reports_tree_and_index_changes_but_not_build_folders() {
        let dir = repo("live");
        std::fs::create_dir_all(dir.join("crate")).unwrap();
        let seen = Arc::new(Mutex::new(Vec::<crate::scm::Status>::new()));
        let s = seen.clone();
        let logs = Arc::new(AtomicUsize::new(0));
        let l = logs.clone();
        let w = watch(&dir, move |_| { let s = s.clone(); Arc::new(move |st: &crate::scm::Status| s.lock().unwrap().push(st.clone())) as Sink }, Arc::new(move |_: &str| { l.fetch_add(1, Ordering::Relaxed); })).unwrap();
        assert!(w.watching);
        let n = || seen.lock().unwrap().len();
        std::thread::sleep(Duration::from_millis(300));
        // A build folder churns: nothing is read.
        std::fs::create_dir_all(dir.join("target/debug")).unwrap();
        for i in 0..50 {
            std::fs::write(dir.join(format!("target/debug/f{i}")), "x").unwrap();
        }
        // A nested build folder made and deleted again (cargo build / cargo clean in crate/): the
        // parent folder's own "modified" records must not count either.
        for _ in 0..5 {
            std::fs::create_dir_all(dir.join("crate/target/debug")).unwrap();
            std::fs::write(dir.join("crate/target/debug/x"), "x").unwrap();
            std::fs::remove_dir_all(dir.join("crate/target")).unwrap();
        }
        std::thread::sleep(Duration::from_millis(800));
        assert_eq!(n(), 0, "build-folder churn must not read the status");
        // A working-tree edit: one read, after the quiet time, with the change in it.
        let t = Instant::now();
        std::fs::write(dir.join("a.txt"), "two\n").unwrap();
        assert!(until(Duration::from_secs(10), || n() >= 1), "a read after an edit");
        assert!(t.elapsed() >= QUIET);
        assert!(until(Duration::from_secs(10), || seen.lock().unwrap().last().is_some_and(|s| s.changed.len() == 1)));
        // Staging from outside moves the index: another read, now staged.
        assert!(crate::git::command(&["add", "a.txt"], Some(&dir)).output().unwrap().status.success());
        assert!(until(Duration::from_secs(10), || seen.lock().unwrap().last().is_some_and(|s| s.staged.len() == 1)));
        // The read itself must not move the index into another read (git status runs without optional locks).
        // How long one read takes right now: on a loaded PC it is seconds, and the windows scale with it.
        let r = Instant::now();
        crate::scm::status(&dir).unwrap();
        let window = QUIET + CAP + r.elapsed() * 2;
        let mut after = n();
        let settle = Instant::now() + Duration::from_secs(30);
        loop {
            std::thread::sleep(window); // let the add settle: no new read for a whole window
            if n() == after || Instant::now() > settle { break; }
            after = n();
        }
        std::thread::sleep(window);
        assert_eq!(n(), after, "reading the status must not trigger itself");
        // A second caller shares the watch; the last to leave stops it.
        let again = watch(&dir, |_| Arc::new(|_: &crate::scm::Status| {}) as Sink, Arc::new(|_: &str| {})).unwrap();
        assert_eq!(again.id, w.id);
        let before = open_count();
        unwatch(w.id);
        assert_eq!(open_count(), before);
        unwatch(w.id);
        assert_eq!(open_count(), before - 1);
        assert_eq!(logs.load(Ordering::Relaxed), 0);
    }

    #[cfg(windows)]
    #[test]
    fn a_reader_whose_folder_is_deleted_reports_the_break() {
        let dir = repo("gone");
        let sub = dir.join("watched");
        std::fs::create_dir_all(&sub).unwrap();
        let (tx, rx) = channel();
        let stop = Arc::new(AtomicBool::new(false));
        start_reader(&sub, true, Spot::Refs, tx, stop.clone()).unwrap();
        std::thread::sleep(Duration::from_millis(200));
        assert!(until(Duration::from_secs(5), || std::fs::remove_dir_all(&sub).is_ok() || !sub.exists()));
        let mut broke = false;
        let end = Instant::now() + Duration::from_secs(5);
        while Instant::now() < end {
            match rx.recv_timeout(Duration::from_millis(200)) {
                Ok(Signal::Broken(_)) => {
                    broke = true;
                    break;
                }
                Ok(_) | Err(RecvTimeoutError::Timeout) => {}
                Err(RecvTimeoutError::Disconnected) => break,
            }
        }
        stop.store(true, Ordering::Relaxed);
        assert!(broke, "deleting the watched folder must be reported, not go quiet");
    }

    #[cfg(windows)]
    #[test]
    fn a_broken_watch_falls_back_to_reading_every_4_s_and_says_so_once() {
        let dir = repo("fallback");
        let seen = Arc::new(Mutex::new(Vec::<Instant>::new()));
        let s = seen.clone();
        let logs = Arc::new(Mutex::new(Vec::<String>::new()));
        let l = logs.clone();
        let w = watch(&dir, move |_| { let s = s.clone(); Arc::new(move |_: &crate::scm::Status| s.lock().unwrap().push(Instant::now())) as Sink }, Arc::new(move |m: &str| l.lock().unwrap().push(m.to_string()))).unwrap();
        assert!(w.watching);
        std::thread::sleep(Duration::from_millis(1000));
        let broke = Instant::now();
        assert!(break_watch(w.id, "test seam"));
        assert!(break_watch(w.id, "test seam again"));
        let after = || seen.lock().unwrap().iter().filter(|t| **t >= broke).copied().collect::<Vec<_>>();
        assert!(until(Duration::from_secs(30), || after().len() >= 3), "a read at once after the break, then every 4 s with no change at all");
        // Read starts, not finish times: a read is several git commands, 0.3 s alone but up to 5 s with
        // the full suite and other builds beside it.
        let t: Vec<Duration> = STARTS.lock().unwrap().iter().filter(|(r, at)| *at >= broke && std::fs::canonicalize(r).ok() == std::fs::canonicalize(&*dir).ok()).map(|(_, at)| *at - broke).collect();
        assert!(t.len() >= 3, "{t:?}");
        assert!(t[0] < Duration::from_secs(1), "read at once: {t:?}");
        for g in [t[1] - t[0], t[2] - t[1]] {
            assert!(g >= Duration::from_millis(3900) && g <= Duration::from_secs(6), "every 4 s: {t:?}");
        }
        let l = logs.lock().unwrap().clone();
        assert_eq!(l.len(), 1, "said once: {l:?}");
        assert!(l[0].contains("reading it every 4 s instead") && l[0].contains("test seam"));
        unwatch(w.id);
    }
}
