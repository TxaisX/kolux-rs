//! T-179 (BROW-020, BROW-021): the tabs' trails and the memory budget.
//!
//! BROW-020: each browser tab keeps a trail (the addresses it loaded, with the one it is on), written
//! to `browser-tabs.json` under the app's data folder as it changes. The pane keys survive a restart
//! (the saved layout keeps them), so a tab that opens again after a restart finds its trail by its
//! id and starts on the address it was on; a tab that is not on screen stays blank until it is shown
//! (only the selected page loads at once). The engine's own back/forward list does not survive a
//! restart, so Back and Forward fall back to the trail when the engine has nowhere to go. Trails
//! whose worktree folder is gone, and files of another shape (an older build), are dropped at load.
//!
//! BROW-021: past a budget of hidden worktrees holding live pages, the pages of the least recently
//! visited ones are unloaded (the page goes to about:blank, the trail stays, the tab is marked
//! pending); showing the tab again loads only that page. The active worktree is never counted; a
//! page with a download running or one an agent drove lately is spared.
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};

pub const FILE: &str = "browser-tabs.json";
const VERSION: u32 = 1;
/// How many addresses a tab's trail keeps (BROW-020: the saved history has a ceiling).
pub const TRAIL_CEILING: usize = 50;
/// How many hidden worktrees may hold live pages before the oldest are unloaded (BROW-021).
// ponytail: a fixed count, not a byte budget; make it a setting if ten worktrees prove too few or too many.
pub const BUDGET: usize = 3;
/// A page an agent drove within this long counts as under agent control and is never unloaded.
pub const DRIVEN_FOR: Duration = Duration::from_secs(10 * 60);
pub const BLANK: &str = "about:blank";

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct Trail {
    pub id: u32,
    #[serde(default)]
    pub worktree: Option<String>,
    #[serde(default)]
    pub urls: Vec<String>,
    #[serde(default)]
    pub at: usize,
    #[serde(default)]
    pub title: String,
}

impl Trail {
    pub fn new(id: u32) -> Self {
        Trail { id, ..Default::default() }
    }

    /// The address the tab is on, if it has one.
    pub fn current(&self) -> Option<&str> {
        self.urls.get(self.at).map(String::as_str)
    }
}

/// The tab finished loading `url`: a step back or forward along the trail moves the mark, the same
/// address again (a reload) changes nothing, anything else cuts the forward part and goes on the
/// end. about:blank is never a stop (an unloaded page is blank).
pub fn noted(t: &mut Trail, url: &str) {
    if url.is_empty() || url == BLANK {
        return;
    }
    if t.current() == Some(url) {
        return;
    }
    if t.at > 0 && t.urls.get(t.at - 1).is_some_and(|u| u == url) {
        t.at -= 1;
        return;
    }
    if t.urls.get(t.at + 1).is_some_and(|u| u == url) {
        t.at += 1;
        return;
    }
    if !t.urls.is_empty() {
        t.urls.truncate(t.at + 1);
    }
    t.urls.push(url.to_string());
    if t.urls.len() > TRAIL_CEILING {
        let extra = t.urls.len() - TRAIL_CEILING;
        t.urls.drain(..extra);
    }
    t.at = t.urls.len() - 1;
}

/// Back (-1) or forward (+1) along the trail when the engine has nowhere to go: the address to load.
pub fn step(t: &mut Trail, delta: i32) -> Option<String> {
    let to = t.at as i64 + delta as i64;
    if to < 0 || to as usize >= t.urls.len() {
        return None;
    }
    t.at = to as usize;
    t.current().map(str::to_string)
}

/// What a load keeps: trails with an address whose worktree (when they have one) still exists.
pub fn tidy(tabs: Vec<Trail>, exists: impl Fn(&str) -> bool) -> Vec<Trail> {
    tabs.into_iter().filter(|t| !t.urls.is_empty() && t.at < t.urls.len() && t.worktree.as_deref().is_none_or(&exists)).collect()
}

#[derive(Serialize, Deserialize)]
struct Saved {
    version: u32,
    tabs: Vec<Trail>,
}

/// The saved trails; a file of another shape or version (an older build) is as good as none.
pub fn load(dir: &Path) -> Vec<Trail> {
    let Ok(text) = std::fs::read_to_string(dir.join(FILE)) else { return Vec::new() };
    match serde_json::from_str::<Saved>(&text) {
        Ok(s) if s.version == VERSION => s.tabs,
        _ => Vec::new(),
    }
}

pub fn save(dir: &Path, tabs: &[Trail]) -> std::io::Result<()> {
    std::fs::create_dir_all(dir)?;
    let text = serde_json::to_string_pretty(&Saved { version: VERSION, tabs: tabs.to_vec() }).map_err(std::io::Error::other)?;
    let tmp = dir.join(format!("{FILE}.tmp"));
    std::fs::write(&tmp, text)?;
    std::fs::rename(&tmp, dir.join(FILE))
}

// ---- the budget (BROW-021) ----

/// One open tab as the budget sees it.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Page {
    pub id: u32,
    pub worktree: Option<String>,
    /// When the tab was last on screen (the pane's report; higher is later).
    pub seen: u64,
    /// Whether the page is loaded (not blank, not waiting to load).
    pub live: bool,
    /// A download running, or an agent driving the page: never unloaded.
    pub spared: bool,
}

/// The pages to unload: hidden worktrees (all but the one whose tab was on screen last) holding a
/// live page count toward `budget`; past it, the least recently visited ones give up their live,
/// unspared pages. Tabs without a worktree are neither counted nor unloaded.
pub fn to_unload(pages: &[Page], budget: usize) -> Vec<u32> {
    let active = pages.iter().filter(|p| p.worktree.is_some()).max_by_key(|p| p.seen).and_then(|p| p.worktree.clone());
    let mut seen: HashMap<&str, u64> = HashMap::new();
    for p in pages {
        if let Some(w) = p.worktree.as_deref() {
            if p.live && active.as_deref() != Some(w) {
                let e = seen.entry(w).or_insert(0);
                *e = (*e).max(p.seen);
            }
        }
    }
    if seen.len() <= budget {
        return Vec::new();
    }
    let mut order: Vec<(&str, u64)> = seen.into_iter().collect();
    order.sort_by(|a, b| a.1.cmp(&b.1).then(a.0.cmp(b.0)));
    let oldest: HashSet<&str> = order.iter().take(order.len() - budget).map(|(w, _)| *w).collect();
    pages.iter().filter(|p| p.live && !p.spared && p.worktree.as_deref().is_some_and(|w| oldest.contains(w))).map(|p| p.id).collect()
}

// ---- the live state ----

/// The trails read from disk at start, each taken once by the tab that opens with its id.
static SAVED: OnceLock<Mutex<Vec<Trail>>> = OnceLock::new();
static LIVE: Mutex<Vec<Trail>> = Mutex::new(Vec::new());
/// Tabs whose page is blank until shown: what to load then.
static PENDING: Mutex<Vec<(u32, String)>> = Mutex::new(Vec::new());
static DRIVEN: Mutex<Vec<(u32, Instant)>> = Mutex::new(Vec::new());

fn root() -> Option<PathBuf> {
    super::profiles::root().ok()
}

fn saved() -> &'static Mutex<Vec<Trail>> {
    SAVED.get_or_init(|| Mutex::new(root().map(|r| tidy(load(&r), |w| Path::new(w).is_dir())).unwrap_or_default()))
}

fn persist() {
    let Some(r) = root() else { return };
    let mut all = LIVE.lock().map(|l| l.clone()).unwrap_or_default();
    all.extend(saved().lock().map(|s| s.clone()).unwrap_or_default());
    std::thread::spawn(move || {
        let _ = save(&r, &all);
    });
}

fn with_live<R>(id: u32, f: impl FnOnce(&mut Trail) -> R) -> Option<R> {
    let mut l = LIVE.lock().ok()?;
    l.iter_mut().find(|t| t.id == id).map(f)
}

/// How a tab opens.
pub struct Opening {
    /// The address the web view starts on.
    pub url: String,
    /// The saved title, when the tab came back from a restart (the tab strip shows it before the page loads).
    pub title: Option<String>,
}

/// A tab opens at `url`: a tab that was open at the last quit comes back on its trail instead,
/// blank until shown when it is not the one on screen.
pub fn opening(id: u32, url: &str, shown: bool) -> Opening {
    let restored = saved().lock().ok().and_then(|mut s| s.iter().position(|t| t.id == id).map(|i| s.remove(i)));
    let mut trail = restored.unwrap_or_else(|| Trail::new(id));
    let title = (!trail.title.is_empty()).then(|| trail.title.clone());
    let url = match trail.current() {
        Some(at) if !shown => {
            if let Ok(mut p) = PENDING.lock() {
                p.retain(|(t, _)| *t != id);
                p.push((id, at.to_string()));
            }
            BLANK.to_string()
        }
        Some(at) => at.to_string(),
        None => {
            trail = Trail::new(id);
            url.to_string()
        }
    };
    if let Ok(mut l) = LIVE.lock() {
        l.retain(|t| t.id != id);
        l.push(trail);
    }
    persist();
    Opening { url, title }
}

/// The tab finished loading `url` (BROW-020: the trail follows the page).
pub fn noted_load(id: u32, url: &str) {
    if with_live(id, |t| noted(t, url)).is_some() {
        persist();
    }
}

pub fn noted_title(id: u32, title: &str) {
    if with_live(id, |t| t.title = title.to_string()).is_some() {
        persist();
    }
}

/// The pane says which worktree the tab belongs to.
pub fn placed(id: u32, worktree: Option<String>) {
    let changed = with_live(id, |t| {
        let changed = t.worktree != worktree;
        t.worktree = worktree;
        changed
    });
    if changed == Some(true) {
        persist();
    }
}

/// Back or forward when the engine has nowhere to go: the trail's address to load, if any.
pub fn step_tab(id: u32, delta: i32) -> Option<String> {
    let url = with_live(id, |t| step(t, delta)).flatten();
    if url.is_some() {
        persist();
    }
    url
}

/// The tab is shown: the address to load now, if its page was left blank for later.
pub fn take_pending(id: u32) -> Option<String> {
    let mut p = PENDING.lock().ok()?;
    let i = p.iter().position(|(t, _)| *t == id)?;
    Some(p.remove(i).1)
}

/// The page is loaded now (not blank, not waiting).
pub fn is_live(id: u32) -> bool {
    let pending = PENDING.lock().is_ok_and(|p| p.iter().any(|(t, _)| *t == id));
    !pending && with_live(id, |t| t.current().is_some()).unwrap_or(false)
}

/// The budget takes the tab's page: it is marked pending at its address (the trail stays) and the
/// caller sends the web view to about:blank. None when there is nothing to unload.
pub fn unloading(id: u32) -> Option<String> {
    let at = with_live(id, |t| t.current().map(str::to_string)).flatten()?;
    let mut p = PENDING.lock().ok()?;
    p.retain(|(t, _)| *t != id);
    p.push((id, at.clone()));
    Some(at)
}

/// An agent's command reached this tab (BROW-021: such a page is spared for a while).
pub fn drove(id: u32) {
    if let Ok(mut d) = DRIVEN.lock() {
        d.retain(|(t, _)| *t != id);
        d.push((id, Instant::now()));
    }
}

pub fn driven(id: u32) -> bool {
    DRIVEN.lock().is_ok_and(|d| d.iter().any(|(t, when)| *t == id && when.elapsed() < DRIVEN_FOR))
}

/// The tab closed: its trail, pending load and agent mark go.
pub fn forget(id: u32) {
    if let Ok(mut l) = LIVE.lock() {
        l.retain(|t| t.id != id);
    }
    if let Ok(mut p) = PENDING.lock() {
        p.retain(|(t, _)| *t != id);
    }
    if let Ok(mut d) = DRIVEN.lock() {
        d.retain(|(t, _)| *t != id);
    }
    persist();
}

#[cfg(test)]
mod tests {
    use super::*;

    fn trail(urls: &[&str], at: usize) -> Trail {
        Trail { id: 1, worktree: None, urls: urls.iter().map(|u| u.to_string()).collect(), at, title: String::new() }
    }

    #[test]
    fn trail_follows_loads_back_forward_and_reloads() {
        let mut t = Trail::new(1);
        noted(&mut t, "about:blank");
        assert!(t.urls.is_empty(), "blank is no stop");
        noted(&mut t, "https://a.com/");
        noted(&mut t, "https://b.com/");
        noted(&mut t, "https://c.com/");
        assert_eq!((t.urls.len(), t.at), (3, 2));
        noted(&mut t, "https://c.com/"); // a reload
        assert_eq!((t.urls.len(), t.at), (3, 2));
        noted(&mut t, "https://b.com/"); // the engine went back
        assert_eq!(t.at, 1);
        noted(&mut t, "https://c.com/"); // and forward
        assert_eq!(t.at, 2);
        noted(&mut t, "https://b.com/");
        noted(&mut t, "https://d.com/"); // a new address from the middle cuts the forward part
        assert_eq!(t.urls, ["https://a.com/", "https://b.com/", "https://d.com/"]);
        assert_eq!(t.at, 2);
    }

    #[test]
    fn trail_has_a_ceiling() {
        let mut t = Trail::new(1);
        for i in 0..(TRAIL_CEILING + 10) {
            noted(&mut t, &format!("https://x.com/{i}"));
        }
        assert_eq!(t.urls.len(), TRAIL_CEILING);
        assert_eq!(t.urls[0], "https://x.com/10", "the oldest went");
        assert_eq!(t.current(), Some("https://x.com/59"));
    }

    #[test]
    fn back_and_forward_walk_the_trail_when_the_engine_cannot() {
        let mut t = trail(&["https://a.com/", "https://b.com/", "https://c.com/"], 2);
        assert_eq!(step(&mut t, -1).as_deref(), Some("https://b.com/"));
        assert_eq!(step(&mut t, -1).as_deref(), Some("https://a.com/"));
        assert_eq!(step(&mut t, -1), None, "nothing before the first");
        assert_eq!(step(&mut t, 1).as_deref(), Some("https://b.com/"));
        noted(&mut t, "https://b.com/"); // the load that follows changes nothing
        assert_eq!(t.at, 1);
        assert_eq!(step(&mut t, 1).as_deref(), Some("https://c.com/"));
        assert_eq!(step(&mut t, 1), None);
    }

    #[test]
    fn load_tidies_gone_worktrees_bad_marks_and_older_builds() {
        let dir = std::env::temp_dir().join(format!("kolux-session-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        let here = dir.to_string_lossy().to_string();
        let tabs = vec![
            Trail { id: 1, worktree: Some(here.clone()), urls: vec!["https://a.com/".into()], at: 0, title: "A".into() },
            Trail { id: 2, worktree: Some(dir.join("gone").to_string_lossy().to_string()), urls: vec!["https://b.com/".into()], at: 0, title: String::new() },
            Trail { id: 3, worktree: None, urls: vec![], at: 0, title: String::new() },
            Trail { id: 4, worktree: None, urls: vec!["https://d.com/".into()], at: 5, title: String::new() },
            Trail { id: 5, worktree: None, urls: vec!["https://e.com/".into()], at: 0, title: String::new() },
        ];
        save(&dir, &tabs).unwrap();
        let kept = tidy(load(&dir), |w| Path::new(w).is_dir());
        assert_eq!(kept.iter().map(|t| t.id).collect::<Vec<_>>(), [1, 5], "a gone worktree, an empty trail and a bad mark are dropped");
        assert_eq!(kept[0].title, "A");
        // another build's file: ignored, not read as ours
        std::fs::write(dir.join(FILE), r#"{"version":0,"tabs":[{"id":9,"urls":["https://z.com/"]}]}"#).unwrap();
        assert!(load(&dir).is_empty());
        std::fs::write(dir.join(FILE), "not json").unwrap();
        assert!(load(&dir).is_empty());
        let _ = std::fs::remove_dir_all(&dir);
    }

    fn page(id: u32, wt: &str, seen: u64, live: bool, spared: bool) -> Page {
        Page { id, worktree: Some(wt.to_string()), seen, live, spared }
    }

    #[test]
    fn oldest_hidden_worktrees_give_up_their_pages_past_the_budget() {
        // ten worktrees visited in turn: w10 is active, w1..w9 hidden; budget 3 keeps w7..w9
        let pages: Vec<Page> = (1..=10).map(|i| page(i, &format!("w{i}"), i as u64, true, false)).collect();
        assert_eq!(to_unload(&pages, 3), [1, 2, 3, 4, 5, 6]);
        // visiting w2 again moves it to the front: it is active now, w10 is hidden but recent
        let mut again = pages.clone();
        again[1].seen = 11;
        assert_eq!(to_unload(&again, 3), [1, 3, 4, 5, 6, 7]);
        // under the budget nothing goes
        assert!(to_unload(&pages[6..], 3).is_empty());
    }

    #[test]
    fn active_spared_and_empty_worktrees_are_left_alone() {
        let pages = vec![
            page(1, "w1", 1, true, true),  // an agent drives it: spared, but its worktree still counts
            page(2, "w1", 1, true, false), // the same worktree's other page goes
            page(3, "w2", 2, false, false), // unloaded already: holds no live page, not counted
            page(4, "w3", 3, true, false),
            page(5, "w4", 4, true, false),
            page(6, "w5", 5, true, false), // active
            Page { id: 7, worktree: None, seen: 0, live: true, spared: false },
        ];
        assert_eq!(to_unload(&pages, 2), [2], "w1, w3, w4 hold live pages: one over the budget of 2, the oldest (w1) gives up its unspared page");
        assert_eq!(to_unload(&pages, 1), [2, 4]);
        assert!(to_unload(&pages, 3).is_empty());
    }

    #[test]
    fn save_round_trip() {
        let dir = std::env::temp_dir().join(format!("kolux-session-rt-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        let tabs = vec![trail(&["https://a.com/", "https://b.com/"], 1)];
        save(&dir, &tabs).unwrap();
        assert_eq!(load(&dir), tabs);
        assert!(load(&dir.join("nowhere")).is_empty());
        let _ = std::fs::remove_dir_all(&dir);
    }
}
