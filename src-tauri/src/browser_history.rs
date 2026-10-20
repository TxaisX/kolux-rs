// T-238-b (BROW-004): what the address bar suggests. The pages a tab finished loading and the
// documents it previewed are kept in `browser-history.json` under the app's data folder; as the
// user types, the entries are ranked: a hit at the start of the site name beats one inside the
// site name, which beats one in the title, which beats one elsewhere in the address; pages
// visited often and lately rise within their tier, the visit bonus has a ceiling, and an old
// visit never lowers a score. The search entry for plain text is the pane's (address.ts), so the
// list here holds visited things only. Ranking is a scan over at most MAX_ENTRIES lowercase
// strings, so it stays quick on a large history.
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};

pub const FILE: &str = "browser-history.json";
/// The history keeps this many entries; beyond it the least-visited oldest entry goes.
pub const MAX_ENTRIES: usize = 5000;
/// The list the bar shows is this long at most.
pub const MAX_SUGGESTIONS: usize = 8;
/// The visit bonus stops growing here (BROW-004: "the visit bonus has a ceiling").
pub const VISIT_CEILING: u32 = 20;

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct Entry {
    pub url: String,
    #[serde(default)]
    pub title: String,
    #[serde(default)]
    pub visits: u32,
    /// Seconds since the Unix epoch of the last visit.
    #[serde(default)]
    pub last: u64,
    /// "page" for a web page, "document" for a previewed worktree document (BROW-039).
    #[serde(default)]
    pub kind: String,
    /// A document's full path, shown instead of its loopback address.
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub label: String,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct Suggestion {
    pub kind: String,
    pub url: String,
    pub title: String,
    pub label: String,
    pub score: u32,
}

/// Records a finished load. A new address becomes an entry; a known one counts another visit.
pub fn visit(entries: &mut Vec<Entry>, url: &str, title: &str, kind: &str, label: &str, now: u64) {
    if url.is_empty() || url == "about:blank" {
        return;
    }
    match entries.iter_mut().find(|e| e.url == url) {
        Some(e) => {
            e.visits = e.visits.saturating_add(1);
            e.last = now.max(e.last);
            if !title.is_empty() {
                e.title = title.to_string();
            }
            if !label.is_empty() {
                e.label = label.to_string();
            }
            e.kind = kind.to_string();
        }
        None => entries.push(Entry { url: url.to_string(), title: title.to_string(), visits: 1, last: now, kind: kind.to_string(), label: label.to_string() }),
    }
    trim(entries);
}

/// A page's title arrives after its load; the entry takes it.
pub fn retitle(entries: &mut [Entry], url: &str, title: &str) {
    if title.is_empty() {
        return;
    }
    if let Some(e) = entries.iter_mut().find(|e| e.url == url) {
        e.title = title.to_string();
    }
}

fn trim(entries: &mut Vec<Entry>) {
    while entries.len() > MAX_ENTRIES {
        let Some((i, _)) = entries.iter().enumerate().min_by_key(|(_, e)| (e.visits.min(VISIT_CEILING), e.last)) else { return };
        entries.remove(i);
    }
}

/// The site name of an address, as the user thinks of it: the host without a leading "www.".
pub fn site_of(url: &str) -> String {
    let host = tauri::Url::parse(url).ok().and_then(|u| u.host_str().map(str::to_lowercase)).unwrap_or_default();
    host.strip_prefix("www.").map(str::to_string).unwrap_or(host)
}

/// What the user typed, ready to match: lowercase, without a scheme or leading "www.".
pub fn needle(text: &str) -> String {
    let t = text.trim().to_lowercase();
    let t = t.strip_prefix("https://").or_else(|| t.strip_prefix("http://")).unwrap_or(&t);
    t.strip_prefix("www.").unwrap_or(t).to_string()
}

const TIER_SITE_START: u32 = 4000;
const TIER_SITE_INSIDE: u32 = 3000;
const TIER_TITLE: u32 = 2000;
const TIER_ELSEWHERE: u32 = 1000;
const DAY: u64 = 24 * 3600;

/// How recent and frequent a visit is, as a bonus that never goes below zero and never passes the
/// tier gap: at most VISIT_CEILING visits count, and the recency part only adds.
pub fn bonus(entry: &Entry, now: u64) -> u32 {
    let visits = entry.visits.min(VISIT_CEILING) * 10;
    let age = now.saturating_sub(entry.last);
    let recency = if age < DAY {
        100
    } else if age < 7 * DAY {
        60
    } else if age < 30 * DAY {
        30
    } else {
        0
    };
    visits + recency
}

/// An entry's score for the typed text; None when nothing matches.
pub fn score(entry: &Entry, needle: &str, now: u64) -> Option<u32> {
    if needle.is_empty() {
        return None;
    }
    let site = site_of(&entry.url);
    let title = entry.title.to_lowercase();
    let address = entry.url.to_lowercase();
    let label = entry.label.to_lowercase();
    let tier = if site.starts_with(needle) {
        TIER_SITE_START
    } else if site.contains(needle) {
        TIER_SITE_INSIDE
    } else if title.contains(needle) {
        TIER_TITLE
    } else if address.contains(needle) || label.contains(needle) {
        TIER_ELSEWHERE
    } else {
        return None;
    };
    Some(tier + bonus(entry, now))
}

/// The ranked list for typed text: strongest match first, ties by last visit, at most
/// MAX_SUGGESTIONS rows.
pub fn rank(entries: &[Entry], text: &str, now: u64) -> Vec<Suggestion> {
    let n = needle(text);
    let mut hits: Vec<(u32, &Entry)> = entries.iter().filter_map(|e| score(e, &n, now).map(|s| (s, e))).collect();
    hits.sort_by(|a, b| b.0.cmp(&a.0).then(b.1.last.cmp(&a.1.last)).then(a.1.url.cmp(&b.1.url)));
    hits.truncate(MAX_SUGGESTIONS);
    hits.into_iter()
        .map(|(score, e)| Suggestion { kind: if e.kind.is_empty() { "page".into() } else { e.kind.clone() }, url: e.url.clone(), title: e.title.clone(), label: e.label.clone(), score })
        .collect()
}

pub fn load(root: &Path) -> Vec<Entry> {
    std::fs::read(root.join(FILE)).ok().and_then(|b| serde_json::from_slice(&b).ok()).unwrap_or_default()
}

pub fn save(root: &Path, entries: &[Entry]) -> Result<(), String> {
    std::fs::create_dir_all(root).map_err(|e| e.to_string())?;
    let text = serde_json::to_vec(entries).map_err(|e| e.to_string())?;
    let tmp = root.join(format!("{FILE}.tmp"));
    std::fs::write(&tmp, text).map_err(|e| format!("{}: {e}", tmp.display()))?;
    std::fs::rename(&tmp, root.join(FILE)).map_err(|e| format!("{}: {e}", root.join(FILE).display()))
}

// ---- the live history: loaded once from the app's data folder, saved after each visit ----

static HISTORY: OnceLock<Mutex<Vec<Entry>>> = OnceLock::new();
/// The last address each tab finished loading, so a title that arrives later finds its entry.
static LAST: Mutex<Vec<(u32, String)>> = Mutex::new(Vec::new());

fn root() -> Option<PathBuf> {
    super::profiles::root().ok()
}

fn history() -> &'static Mutex<Vec<Entry>> {
    HISTORY.get_or_init(|| Mutex::new(root().map(|r| load(&r)).unwrap_or_default()))
}

fn now() -> u64 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0)
}

fn persist(entries: Vec<Entry>) {
    if let Some(r) = root() {
        std::thread::spawn(move || {
            let _ = save(&r, &entries);
        });
    }
}

/// A tab finished loading an address: a previewed document is kept by its path, a page by its
/// address (the title comes with `noted_title`).
pub fn noted_load(id: u32, url: &str) {
    let (kind, label, title) = match super::preview::of(url) {
        Some(v) => ("document", v["path"].as_str().unwrap_or_default().to_string(), v["file"].as_str().unwrap_or_default().to_string()),
        None => ("page", String::new(), String::new()),
    };
    if let Ok(mut l) = LAST.lock() {
        l.retain(|(t, _)| *t != id);
        l.push((id, url.to_string()));
    }
    let snapshot = {
        let Ok(mut h) = history().lock() else { return };
        visit(&mut h, url, &title, kind, &label, now());
        h.clone()
    };
    persist(snapshot);
}

pub fn noted_title(id: u32, title: &str) {
    let Some(url) = LAST.lock().ok().and_then(|l| l.iter().find(|(t, _)| *t == id).map(|(_, u)| u.clone())) else { return };
    let snapshot = {
        let Ok(mut h) = history().lock() else { return };
        retitle(&mut h, &url, title);
        h.clone()
    };
    persist(snapshot);
}

pub fn forget_tab(id: u32) {
    if let Ok(mut l) = LAST.lock() {
        l.retain(|(t, _)| *t != id);
    }
}

/// The address bar's suggestions for typed text (BROW-004), strongest first.
#[allow(dead_code)] // registered by evidence/browser-T-238-b-lib.rs.patch (a coordinator patch)
#[tauri::command]
pub fn browser_suggest(text: String) -> Vec<Suggestion> {
    history().lock().map(|h| rank(&h, &text, now())).unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn entry(url: &str, title: &str, visits: u32, last: u64) -> Entry {
        Entry { url: url.into(), title: title.into(), visits, last, kind: "page".into(), label: String::new() }
    }

    const NOW: u64 = 1_800_000_000;

    #[test]
    fn github_sits_on_top_after_several_visits() {
        // BROW-004 acceptance: after several visits to github.com, "git" puts github.com first.
        let mut h = Vec::new();
        for _ in 0..3 {
            visit(&mut h, "https://github.com/", "GitHub", "page", "", NOW - 10);
        }
        visit(&mut h, "https://gitlab.com/x", "GitLab", "page", "", NOW - 5);
        visit(&mut h, "https://example.com/git-guide", "A git guide", "page", "", NOW);
        let r = rank(&h, "git", NOW);
        assert_eq!(r[0].url, "https://github.com/");
        assert_eq!(r[1].url, "https://gitlab.com/x");
        assert_eq!(r[2].url, "https://example.com/git-guide");
        assert_eq!(h[0].visits, 3);
    }

    #[test]
    fn site_start_beats_site_inside_beats_title_beats_elsewhere() {
        let h = vec![
            entry("https://docs.rs/rustls", "TLS docs", 20, NOW),        // elsewhere in the address
            entry("https://example.org/", "Why rust is nice", 20, NOW),  // title
            entry("https://therustbook.net/", "Book", 20, NOW),          // inside the site name
            entry("https://rust-lang.org/", "Rust", 1, NOW - 400 * DAY), // start of the site name, old, rare
        ];
        let got: Vec<String> = rank(&h, "rust", NOW).into_iter().map(|s| s.url).collect();
        assert_eq!(got, ["https://rust-lang.org/", "https://therustbook.net/", "https://example.org/", "https://docs.rs/rustls"]);
    }

    #[test]
    fn visit_bonus_has_a_ceiling_and_never_lowers() {
        let fresh = entry("https://a.com/", "", 1, NOW);
        let many = entry("https://b.com/", "", 1000, NOW);
        let capped = entry("https://c.com/", "", VISIT_CEILING, NOW);
        assert_eq!(bonus(&many, NOW), bonus(&capped, NOW));
        assert!(bonus(&many, NOW) > bonus(&fresh, NOW));
        let ancient = entry("https://d.com/", "", 0, 0);
        assert_eq!(bonus(&ancient, NOW), 0);
        assert_eq!(score(&ancient, "d.com", NOW), Some(TIER_SITE_START));
        // the bonus stays below the tier gap, so a popular title hit never passes a site hit
        assert!(bonus(&many, NOW) < TIER_SITE_INSIDE - TIER_TITLE);
    }

    #[test]
    fn typed_scheme_and_www_are_ignored_and_matching_is_case_blind() {
        let h = vec![entry("https://www.GitHub.com/", "GitHub", 1, NOW)];
        assert_eq!(site_of("https://www.GitHub.com/x"), "github.com");
        assert_eq!(needle("HTTPS://www.Git"), "git");
        assert_eq!(rank(&h, "https://git", NOW).len(), 1);
        assert_eq!(rank(&h, "GIT", NOW).len(), 1);
        assert!(rank(&h, "", NOW).is_empty());
        assert!(rank(&h, "zzz", NOW).is_empty());
    }

    #[test]
    fn list_is_short_and_blank_pages_are_not_kept() {
        let mut h = Vec::new();
        for i in 0..30 {
            visit(&mut h, &format!("https://site{i}.com/"), "", "page", "", NOW - i);
        }
        visit(&mut h, "about:blank", "", "page", "", NOW);
        visit(&mut h, "", "", "page", "", NOW);
        assert_eq!(h.len(), 30);
        assert_eq!(rank(&h, "site", NOW).len(), MAX_SUGGESTIONS);
        assert_eq!(rank(&h, "site", NOW)[0].url, "https://site0.com/"); // the latest of equals
    }

    #[test]
    fn documents_rank_by_their_path_and_keep_their_file_name() {
        let mut h = Vec::new();
        visit(&mut h, "http://127.0.0.1:4455/tok/README.md", "README.md", "document", "G:\\work\\README.md", NOW);
        let r = rank(&h, "work", NOW);
        assert_eq!(r.len(), 1);
        assert_eq!(r[0].kind, "document");
        assert_eq!(r[0].label, "G:\\work\\README.md");
        assert_eq!(r[0].score, TIER_ELSEWHERE + bonus(&h[0], NOW));
    }

    #[test]
    fn retitle_and_trim() {
        let mut h = Vec::new();
        visit(&mut h, "https://a.com/", "", "page", "", NOW);
        retitle(&mut h, "https://a.com/", "A site");
        retitle(&mut h, "https://a.com/", "");
        retitle(&mut h, "https://nope.com/", "x");
        assert_eq!(h[0].title, "A site");
        for i in 0..MAX_ENTRIES + 5 {
            visit(&mut h, &format!("https://n{i}.com/"), "", "page", "", NOW + i as u64);
        }
        assert_eq!(h.len(), MAX_ENTRIES);
        assert!(h.iter().all(|e| e.url != "https://a.com/" || e.visits > 1) || !h.iter().any(|e| e.url == "https://a.com/"));
    }

    #[test]
    fn history_survives_a_round_trip_and_a_bad_file() {
        let dir = std::env::temp_dir().join(format!("kolux-history-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        let mut h = Vec::new();
        visit(&mut h, "https://a.com/", "A", "page", "", NOW);
        save(&dir, &h).unwrap();
        assert_eq!(load(&dir), h);
        std::fs::write(dir.join(FILE), b"{not json").unwrap();
        assert!(load(&dir).is_empty());
        assert!(load(&dir.join("missing")).is_empty());
        let _ = std::fs::remove_dir_all(&dir);
    }
}
