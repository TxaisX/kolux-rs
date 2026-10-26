//! EDIT-004 (T-177): unsaved editor text survives a quit or a crash. The text of an unsaved tab is
//! kept as a draft for each file in each worktree, in the state store, and is never written into the
//! real file. A draft remembers the hash of the disk copy it was typed over, so the window can tell
//! a draft over an unchanged file from one over a file that moved on (EDIT-003's banner). A
//! repeated or unreadable entry is tidied away on read instead of opening twice; removing a worktree
//! drops its drafts.

use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::sync::{Condvar, Mutex};
use std::time::Duration;

type Store<'a> = tauri::State<'a, Mutex<crate::state::Store>>;

const KEY: &str = "editorDrafts";
/// A draft bigger than this is not kept (the file itself is capped far below it when opened).
const MAX_DRAFT: usize = 8 * 1024 * 1024;

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct Draft {
    pub path: String,
    pub text: String,
    /// Hash of the disk copy the text was typed over; empty when unknown.
    #[serde(default)]
    pub base: String,
}

/// Worktree key -> file key -> draft. Keys compare the way Windows paths do: slash and case blind.
type All = BTreeMap<String, BTreeMap<String, Draft>>;

fn key(p: &str) -> String {
    let t = p.replace('\\', "/");
    let drive = t.len() > 2 && t.as_bytes()[1] == b':' && t.as_bytes()[0].is_ascii_alphabetic();
    let t = t.trim_end_matches('/').to_string();
    if drive { t.to_lowercase() } else { t }
}

/// Reads the stored drafts; an entry that cannot be read is dropped on its own, the rest stay.
fn parse(raw: Option<String>) -> All {
    let mut all = All::new();
    let Some(raw) = raw else { return all };
    let Ok(serde_json::Value::Object(wts)) = serde_json::from_str::<serde_json::Value>(&raw) else { return all };
    for (wt, files) in wts {
        let serde_json::Value::Object(files) = files else { continue };
        for (_, v) in files {
            let Ok(d) = serde_json::from_value::<Draft>(v) else { continue };
            if d.path.is_empty() {
                continue;
            }
            all.entry(key(&wt)).or_default().insert(key(&d.path), d);
        }
    }
    all
}

fn render(all: &All) -> String {
    serde_json::to_string(all).unwrap_or_else(|_| "{}".into())
}

fn set(all: &mut All, worktree: &str, d: Draft) -> Result<(), String> {
    if d.text.len() > MAX_DRAFT {
        return Err(format!("{} is too large to keep a draft of", d.path));
    }
    all.entry(key(worktree)).or_default().insert(key(&d.path), d);
    Ok(())
}

fn clear(all: &mut All, worktree: &str, path: &str) {
    let w = key(worktree);
    if let Some(files) = all.get_mut(&w) {
        files.remove(&key(path));
        if files.is_empty() {
            all.remove(&w);
        }
    }
}

/// EDIT-032: a moved file's draft follows it to the new path; a moved folder takes the drafts under it.
/// Row 135: a tab with no worktree keeps its draft under the file's own folder, so a draft whose
/// key is its file's folder (outside the worktree being renamed in) moves to the new folder too.
fn rename(all: &mut All, worktree: &str, from: &str, to: &str) {
    let f = key(from);
    let under = format!("{f}/");
    let named = key(worktree);
    let mut moved: Vec<(String, Draft)> = Vec::new();
    for (wt, files) in all.iter_mut() {
        let hit: Vec<String> = files.keys().filter(|k| **k == f || k.starts_with(&under)).cloned().collect();
        for k in hit {
            let Some(mut d) = files.remove(&k) else { continue };
            let rootless = *wt != named && *wt == folder(&k);
            let tail = d.path.chars().skip(from.chars().count()).collect::<String>();
            d.path = format!("{}{}", to.trim_end_matches(['/', '\\']), tail);
            moved.push((if rootless { folder(&key(&d.path)) } else { wt.clone() }, d));
        }
    }
    for (wt, d) in moved {
        all.entry(wt).or_default().insert(key(&d.path), d);
    }
    all.retain(|_, files| !files.is_empty());
}

/// The folder part of a file key.
fn folder(k: &str) -> String {
    k.rsplit_once('/').map(|(dir, _)| dir.to_string()).unwrap_or_default()
}

fn load(store: &Store<'_>) -> All {
    parse(store.lock().ok().and_then(|s| s.get(KEY).ok().flatten()))
}

/// After-list row 132: every change to the drafts reads, changes and writes them under this one
/// lock, so two commands running at once (two tabs typing) can never both read the old list and
/// have the later write drop the other tab's draft.
static ONE: Mutex<()> = Mutex::new(());

/// Load, change, save as one step (row 132); `read` and `write` are the stored text.
fn update_with(read: impl FnOnce() -> Option<String>, write: impl FnOnce(String) -> Result<(), String>, change: impl FnOnce(&mut All) -> Result<(), String>) -> Result<(), String> {
    let _one = ONE.lock().unwrap_or_else(std::sync::PoisonError::into_inner);
    let mut all = parse(read());
    change(&mut all)?;
    write(render(&all))
}

fn update(store: &Store<'_>, change: impl FnOnce(&mut All) -> Result<(), String>) -> Result<(), String> {
    update_with(
        || store.lock().ok().and_then(|s| s.get(KEY).ok().flatten()),
        |raw| store.lock().map_err(|_| "the state store is busy".to_string())?.set(KEY, &raw).map_err(|e| e.to_string()),
        change,
    )
}

#[tauri::command(async)]
pub fn editor_draft_set(store: Store<'_>, worktree: String, path: String, text: String, base: String) -> Result<(), String> {
    update(&store, |all| set(all, &worktree, Draft { path, text, base }))
}

#[tauri::command(async)]
pub fn editor_draft_clear(store: Store<'_>, worktree: String, path: String) -> Result<(), String> {
    update(&store, |all| {
        clear(all, &worktree, &path);
        Ok(())
    })
}

/// The drafts of one worktree, for the tabs it reopens.
#[tauri::command(async)]
pub fn editor_drafts_get(store: Store<'_>, worktree: String) -> Vec<Draft> {
    load(&store).remove(&key(&worktree)).map(|m| m.into_values().collect()).unwrap_or_default()
}

/// Removing a worktree discards its drafts.
#[tauri::command(async)]
pub fn editor_drafts_drop(store: Store<'_>, worktree: String) -> Result<(), String> {
    update(&store, |all| {
        all.remove(&key(&worktree));
        Ok(())
    })
}

#[tauri::command(async)]
pub fn editor_draft_rename(store: Store<'_>, worktree: String, from: String, to: String) -> Result<(), String> {
    update(&store, |all| {
        rename(all, &worktree, &from, &to);
        Ok(())
    })
}

/// After-list row 199: the window writes every unsaved tab's draft when asked, and says so.
pub const FLUSH_EVENT: &str = "editor-flush-request";
/// How long a reload waits for the window's answer; a window that is hung cannot answer, and the
/// reload is the cure for that, so it goes ahead after this.
const FLUSH_WAIT: Duration = Duration::from_millis(1500);

/// Requests made and answered, with the cue for the one waiting.
struct Flush {
    state: Mutex<(u64, u64)>,
    cue: Condvar,
}

impl Flush {
    const fn new() -> Self {
        Self { state: Mutex::new((0, 0)), cue: Condvar::new() }
    }

    /// Makes a request (`ask` gets its token) and waits for its answer; false when none came in time.
    fn ask_and_wait(&self, ask: impl FnOnce(u64), wait: Duration) -> bool {
        let token = {
            let mut s = self.state.lock().unwrap_or_else(std::sync::PoisonError::into_inner);
            s.0 += 1;
            s.0
        };
        ask(token);
        let s = self.state.lock().unwrap_or_else(std::sync::PoisonError::into_inner);
        let (s, _) = self.cue.wait_timeout_while(s, wait, |s| s.1 < token).unwrap_or_else(std::sync::PoisonError::into_inner);
        s.1 >= token
    }

    fn answer(&self, token: u64) {
        let mut s = self.state.lock().unwrap_or_else(std::sync::PoisonError::into_inner);
        s.1 = s.1.max(token);
        self.cue.notify_all();
    }
}

static FLUSH: Flush = Flush::new();

/// Asks the window to write every unsaved tab's draft and waits for it (row 199); the interface
/// reload calls this first. Blocks up to the wait: call it off the main thread.
#[allow(dead_code)] // called by the recovery watch once evidence/editor-fix-199-recovery.rs.patch is applied
pub fn flush_before_reload(app: &tauri::AppHandle) -> bool {
    use tauri::Emitter;
    FLUSH.ask_and_wait(
        |token| {
            let _ = app.emit(FLUSH_EVENT, token);
        },
        FLUSH_WAIT,
    )
}

/// The window's answer: every unsaved tab's draft is written.
#[allow(dead_code)] // registered by evidence/editor-fix-199-lib.rs.patch
#[tauri::command]
pub fn editor_flush_ack(token: u64) {
    FLUSH.answer(token);
}

#[cfg(test)]
mod tests {
    use super::*;

    fn d(path: &str, text: &str) -> Draft {
        Draft { path: path.into(), text: text.into(), base: "h".into() }
    }

    #[test]
    fn edit001_a_draft_is_kept_per_file_per_worktree_and_replaced_not_duplicated() {
        let mut all = All::new();
        set(&mut all, "C:\\w", d("C:\\w\\a.md", "one")).unwrap();
        set(&mut all, "c:/w", d("c:/W/A.md", "two")).unwrap(); // the same file by another spelling
        set(&mut all, "C:\\w", d("C:\\w\\b.md", "b")).unwrap();
        set(&mut all, "C:\\other", d("C:\\other\\a.md", "x")).unwrap();
        let again = parse(Some(render(&all)));
        assert_eq!(again["c:/w"].len(), 2);
        assert_eq!(again["c:/w"]["c:/w/a.md"].text, "two");
        assert_eq!(again["c:/other"].len(), 1);
    }

    #[test]
    fn edit004_unreadable_entries_are_tidied_away_and_the_rest_come_back() {
        let raw = r#"{"C:/w":{"a":{"path":"C:/w/a.md","text":"keep","base":"h"},"b":{"nope":1},"c":{"path":"","text":"x"}},"C:/x":"junk"}"#;
        let all = parse(Some(raw.into()));
        assert_eq!(all.len(), 1);
        assert_eq!(all["c:/w"].len(), 1);
        assert_eq!(parse(Some("{not json".into())).len(), 0);
        assert_eq!(parse(None).len(), 0);
    }

    #[test]
    fn edit004_clearing_the_last_draft_removes_the_worktree_and_dropping_removes_them_all() {
        let mut all = All::new();
        set(&mut all, "C:/w", d("C:/w/a.md", "a")).unwrap();
        set(&mut all, "C:/w", d("C:/w/b.md", "b")).unwrap();
        clear(&mut all, "C:/w", "c:\\w\\A.MD");
        assert_eq!(all["c:/w"].len(), 1);
        clear(&mut all, "C:/w", "C:/w/b.md");
        assert!(all.is_empty());
        set(&mut all, "C:/w", d("C:/w/a.md", "a")).unwrap();
        all.remove(&key("C:\\w"));
        assert!(all.is_empty());
    }

    #[test]
    fn edit032_a_draft_follows_its_file_to_the_new_path() {
        let mut all = All::new();
        set(&mut all, "C:/w", d("C:/w/a.md", "typed")).unwrap();
        rename(&mut all, "C:/w", "C:/w/a.md", "C:/w/sub/b.md");
        assert!(!all["c:/w"].contains_key("c:/w/a.md"));
        let moved = &all["c:/w"]["c:/w/sub/b.md"];
        assert_eq!((moved.path.as_str(), moved.text.as_str()), ("C:/w/sub/b.md", "typed"));
    }

    #[test]
    fn edit032_a_moved_folder_takes_the_drafts_under_it_and_leaves_a_sibling_with_the_same_prefix() {
        let mut all = All::new();
        set(&mut all, "C:/w", d("C:/w/docs/a.md", "a")).unwrap();
        set(&mut all, "C:/w", d("C:/w/docs2/b.md", "b")).unwrap();
        rename(&mut all, "C:/w", r"C:\w\docs", "C:/w/old/docs");
        assert_eq!(all["c:/w"]["c:/w/old/docs/a.md"].path, "C:/w/old/docs/a.md");
        assert!(all["c:/w"].contains_key("c:/w/docs2/b.md"));
        assert_eq!(all["c:/w"].len(), 2);
    }

    #[test]
    fn row132_drafts_written_by_many_commands_at_once_are_all_kept() {
        // A shared stored text standing in for the state store; each read and write yields so the
        // threads interleave the way two tabs' draft commands do.
        let stored: std::sync::Arc<Mutex<Option<String>>> = std::sync::Arc::new(Mutex::new(None));
        let threads: Vec<_> = (0..8)
            .map(|t| {
                let stored = stored.clone();
                std::thread::spawn(move || {
                    for i in 0..25 {
                        update_with(
                            || {
                                let got = stored.lock().unwrap().clone();
                                std::thread::yield_now();
                                got
                            },
                            |raw| {
                                std::thread::yield_now();
                                *stored.lock().unwrap() = Some(raw);
                                Ok(())
                            },
                            |all| set(all, "C:/w", d(&format!("C:/w/t{t}-{i}.md"), "typed")),
                        )
                        .unwrap();
                    }
                })
            })
            .collect();
        threads.into_iter().for_each(|h| h.join().unwrap());
        let all = parse(stored.lock().unwrap().clone());
        assert_eq!(all["c:/w"].len(), 8 * 25);
    }

    #[test]
    fn row135_a_rootless_tabs_draft_follows_its_file_to_the_new_folder() {
        let mut all = All::new();
        // A tab opened with no worktree keeps its draft under the file's folder.
        set(&mut all, r"C:\loose", d(r"C:\loose\a.md", "typed")).unwrap();
        set(&mut all, "C:/w", d("C:/w/b.md", "b")).unwrap();
        rename(&mut all, "C:/w", r"C:\loose\a.md", "C:/loose/sub/a2.md");
        assert!(!all.contains_key("c:/loose"), "the old folder keeps no orphan: {all:?}");
        assert_eq!(all["c:/loose/sub"]["c:/loose/sub/a2.md"].text, "typed");
        // A draft inside the worktree being renamed in stays under that worktree.
        rename(&mut all, "C:/w", "C:/w/b.md", "C:/w/deep/b.md");
        assert_eq!(all["c:/w"]["c:/w/deep/b.md"].text, "b");
    }

    #[test]
    fn row199_a_reload_waits_for_the_windows_answer_and_goes_ahead_when_none_comes() {
        let flush = std::sync::Arc::new(Flush::new());
        // The window answers a moment after being asked: the wait ends with a yes.
        let f = flush.clone();
        assert!(flush.ask_and_wait(
            move |token| {
                std::thread::spawn(move || {
                    std::thread::sleep(Duration::from_millis(30));
                    f.answer(token);
                });
            },
            Duration::from_secs(5)
        ));
        // A hung window never answers: the wait runs out and says so.
        let t = std::time::Instant::now();
        assert!(!flush.ask_and_wait(|_| (), Duration::from_millis(60)));
        assert!(t.elapsed() >= Duration::from_millis(60));
        // An answer that came before the wait began still counts (the window was quick).
        let f = flush.clone();
        assert!(flush.ask_and_wait(move |token| f.answer(token), Duration::from_millis(10)));
        // An old answer does not satisfy a newer request.
        let f = flush.clone();
        assert!(!flush.ask_and_wait(move |token| f.answer(token - 1), Duration::from_millis(20)));
    }

    #[test]
    fn row132_a_refused_change_writes_nothing() {
        let mut wrote = false;
        let got = update_with(|| None, |_| { wrote = true; Ok(()) }, |all| set(all, "C:/w", d("C:/w/big.txt", &"x".repeat(MAX_DRAFT + 1))));
        assert!(got.is_err());
        assert!(!wrote);
    }

    #[test]
    fn edit004_a_draft_past_the_cap_is_refused() {
        let mut all = All::new();
        assert!(set(&mut all, "C:/w", d("C:/w/big.txt", &"x".repeat(MAX_DRAFT + 1))).is_err());
        assert!(all.is_empty());
    }
}
