//! EDIT-004 (T-177): unsaved editor text survives a quit or a crash. The text of an unsaved tab is
//! kept as a draft for each file in each worktree, in the state store, and is never written into the
//! real file. A draft remembers the hash of the disk copy it was typed over, so the window can tell
//! a draft over an unchanged file from one over a file that moved on (EDIT-003's banner). A
//! repeated or unreadable entry is tidied away on read instead of opening twice; removing a worktree
//! drops its drafts.

use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::sync::Mutex;

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
fn rename(all: &mut All, worktree: &str, from: &str, to: &str) {
    let Some(files) = all.get_mut(&key(worktree)) else { return };
    let f = key(from);
    let under = format!("{f}/");
    let hit: Vec<String> = files.keys().filter(|k| **k == f || k.starts_with(&under)).cloned().collect();
    for k in hit {
        if let Some(mut d) = files.remove(&k) {
            let tail = d.path.chars().skip(from.chars().count()).collect::<String>();
            d.path = format!("{}{}", to.trim_end_matches(['/', '\\']), tail);
            files.insert(key(&d.path), d);
        }
    }
}

fn load(store: &Store<'_>) -> All {
    parse(store.lock().ok().and_then(|s| s.get(KEY).ok().flatten()))
}

fn save(store: &Store<'_>, all: &All) -> Result<(), String> {
    store.lock().map_err(|_| "the state store is busy".to_string())?.set(KEY, &render(all)).map_err(|e| e.to_string())
}

#[tauri::command(async)]
pub fn editor_draft_set(store: Store<'_>, worktree: String, path: String, text: String, base: String) -> Result<(), String> {
    let mut all = load(&store);
    set(&mut all, &worktree, Draft { path, text, base })?;
    save(&store, &all)
}

#[tauri::command(async)]
pub fn editor_draft_clear(store: Store<'_>, worktree: String, path: String) -> Result<(), String> {
    let mut all = load(&store);
    clear(&mut all, &worktree, &path);
    save(&store, &all)
}

/// The drafts of one worktree, for the tabs it reopens.
#[tauri::command(async)]
pub fn editor_drafts_get(store: Store<'_>, worktree: String) -> Vec<Draft> {
    load(&store).remove(&key(&worktree)).map(|m| m.into_values().collect()).unwrap_or_default()
}

/// Removing a worktree discards its drafts.
#[tauri::command(async)]
pub fn editor_drafts_drop(store: Store<'_>, worktree: String) -> Result<(), String> {
    let mut all = load(&store);
    all.remove(&key(&worktree));
    save(&store, &all)
}

#[tauri::command(async)]
pub fn editor_draft_rename(store: Store<'_>, worktree: String, from: String, to: String) -> Result<(), String> {
    let mut all = load(&store);
    rename(&mut all, &worktree, &from, &to);
    save(&store, &all)
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
    fn edit004_a_draft_past_the_cap_is_refused() {
        let mut all = All::new();
        assert!(set(&mut all, "C:/w", d("C:/w/big.txt", &"x".repeat(MAX_DRAFT + 1))).is_err());
        assert!(all.is_empty());
    }
}
