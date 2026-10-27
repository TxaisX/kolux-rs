//! Which worktrees the sidebar shows (PROJ-042, PROJ-044, SET-032). Kolux's own records make a
//! worktree managed wherever it sits; every other one is external and takes its visibility from its
//! source: made by GSD, Claude Code's worktree folder, an extra root folder the user added, or anywhere
//! else.
//! Each source has a global choice (hidden unless shown) and a project may hold its own, which the
//! global choice never overwrites. A worktree the user showed or hid by hand keeps that.
//! GSD has no folder of its own: its executors run in Claude Code's isolation worktrees and leave
//! `gsd-spawn-toplevel` in the worktree's own Git folder (GSD's public reference
//! `references/worktree-path-safety.md`), so that file is what marks a worktree as GSD's.

use crate::git::Worktree;
use crate::projects::{name_key, non_blank, origin, workspaces_dir, Project, WORKSPACES_DIR_ENV, WORKSPACES_DIR_SETTING};
use crate::state::Store;
use serde_json::{json, Map, Value};
use std::path::Path;

const KEY: &str = "worktreeVisibility";
pub const MAX_ROOTS: usize = 32;
pub const CLAUDE: &str = "claude";
pub const GSD: &str = "gsd";
pub const OTHER: &str = "other";

/// One source as the visibility lists show it.
#[derive(Clone, Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Source {
    pub key: String,
    pub label: String,
    /// The global choice: shown or not.
    pub global: bool,
    /// The project's own choice, when it has one.
    pub own: Option<bool>,
    /// For an extra root folder, its path.
    pub root: Option<String>,
}

fn save(store: &Store, v: &Value) -> Result<(), String> {
    store.set(KEY, &v.to_string()).map_err(|e| format!("could not save the visibility choice: {e}"))
}

/// The choices, made on first use. Projects already there keep showing worktrees made elsewhere, as
/// they did before this choice existed (PROJ-042); projects added later start with them hidden.
pub fn ensure(store: &Store, projects: &[Project]) -> Result<Value, String> {
    let v: Value = crate::orchestration::kept::load(store, KEY)?;
    if v.is_object() {
        return Ok(v);
    }
    let own: Map<String, Value> = projects.iter().map(|p| (p.id.clone(), json!({ OTHER: true }))).collect();
    let v = json!({ "global": {}, "roots": [], "projects": own });
    save(store, &v)?;
    Ok(v)
}

fn roots(v: &Value) -> Vec<String> {
    v["roots"].as_array().map(|a| a.iter().filter_map(|r| r.as_str().map(String::from)).collect()).unwrap_or_default()
}

fn root_key(path: &str) -> String {
    format!("root:{}", name_key(path))
}

fn under(path: &str, base: &str) -> bool {
    let (p, b) = (name_key(path), name_key(base));
    p == b || p.strip_prefix(&b).is_some_and(|rest| rest.starts_with('\\'))
}

/// GSD's mark: `gsd-spawn-toplevel` in the Git folder the worktree's `.git` file points at.
fn made_by_gsd(path: &str) -> bool {
    let Ok(link) = std::fs::read_to_string(Path::new(path).join(".git")) else { return false };
    link.trim().strip_prefix("gitdir:").is_some_and(|dir| Path::new(path).join(dir.trim()).join("gsd-spawn-toplevel").is_file())
}

/// The global choice for `source` (shown?), then the project's own over it.
fn shown(v: &Value, project: &Project, source: &str) -> bool {
    v["projects"][&project.id][source].as_bool().or_else(|| v["global"][source].as_bool()).unwrap_or(false)
}

/// The workspaces folder for `project` when the user set one (on the project, in settings or with
/// KOLUX_WORKSPACES_DIR); the built-in default does not count.
fn chosen_root(store: &Store, project: &Project) -> Option<String> {
    let own = non_blank(project.workspaces_dir.as_deref()).map(String::from);
    let set = non_blank(store.settings()[WORKSPACES_DIR_SETTING].as_str()).is_some() || non_blank(std::env::var(WORKSPACES_DIR_ENV).ok().as_deref()).is_some();
    let dir = own.map(std::path::PathBuf::from).or_else(|| set.then(|| workspaces_dir(store)))?;
    Some(Path::new(&project.path).join(dir).display().to_string())
}

/// The choices for a listing, which only reads: when they cannot be read or first made (an unreadable
/// record the keep-aside could not copy, or a refused first-use save), external worktrees stay hidden.
/// Only this log line (once per run) says so; no settings notice covers it (by design, coordinator default).
fn read_choices(store: &Store) -> Value {
    static LOGGED: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);
    ensure(store, &crate::projects::load_projects(store)).unwrap_or_else(|e| {
        if !LOGGED.swap(true, std::sync::atomic::Ordering::Relaxed) {
            eprintln!("kolux-rs: the worktree visibility choices could not be read or created ({e}); worktrees made outside Kolux stay hidden until that works");
        }
        Value::Null
    })
}

/// Lays kind, source and visibility over Git's list and drops tools' scratch worktrees: those under
/// a dot-folder of the main checkout other than Claude Code's, unless the user's own workspaces
/// folder holds them.
pub fn apply(store: &Store, project: &Project, hidden_by_hand: &Map<String, Value>, list: Vec<Worktree>) -> Result<Vec<Worktree>, String> {
    let v = read_choices(store);
    let extra = roots(&v);
    let chosen = chosen_root(store, project);
    // The scratch folders sit in the main checkout even when the project is a linked worktree (PROJ-006).
    let main = list.iter().find(|w| w.is_main).map(|w| w.path.clone()).unwrap_or_else(|| project.path.clone());
    let claude = Path::new(&main).join(".claude").join("worktrees").display().to_string();
    Ok(list
        .into_iter()
        .filter_map(|mut w| {
            let by_hand = hidden_by_hand.get(&name_key(&w.path)).and_then(Value::as_bool);
            if w.is_main {
                w.kind = "main".into();
                return Some(w);
            }
            if origin(store, &w.path).is_some() {
                w.kind = "managed".into();
                w.hidden = by_hand.unwrap_or(false);
                return Some(w);
            }
            let in_chosen = chosen.as_deref().is_some_and(|c| under(&w.path, c));
            let source = if made_by_gsd(&w.path) {
                GSD.to_string()
            } else if in_chosen {
                OTHER.to_string()
            } else if under(&w.path, &claude) {
                CLAUDE.to_string()
            } else if Path::new(&w.path).strip_prefix(&main).is_ok_and(|rel| rel.components().any(|c| c.as_os_str().to_string_lossy().starts_with('.'))) {
                return None;
            } else if let Some(r) = extra.iter().find(|r| under(&w.path, r)) {
                root_key(r)
            } else {
                OTHER.to_string()
            };
            w.kind = "external".into();
            w.hidden = by_hand.unwrap_or_else(|| !shown(&v, project, &source));
            w.source = Some(source);
            Some(w)
        })
        .collect())
}

/// The sources with their global choice and, for `project`, its own.
pub fn sources(store: &Store, project: Option<&Project>) -> Vec<Source> {
    let v = read_choices(store);
    let mut out = vec![(CLAUDE.to_string(), "Made by Claude Code".to_string(), None), (GSD.to_string(), "Made by GSD".to_string(), None), (OTHER.to_string(), "Elsewhere on disk".to_string(), None)];
    out.extend(roots(&v).into_iter().map(|r| (root_key(&r), r.clone(), Some(r))));
    out.into_iter()
        .map(|(key, label, root)| Source { global: v["global"][&key].as_bool().unwrap_or(false), own: project.and_then(|p| v["projects"][&p.id][&key].as_bool()), key, label, root })
        .collect()
}

/// Sets (or with `None`, clears back to the global) the choice for `source`, globally or for one project.
pub fn set_choice(store: &Store, project_id: Option<&str>, source: &str, show: Option<bool>) -> Result<(), String> {
    let mut v = ensure(store, &crate::projects::load_projects(store))?;
    let slot = match project_id {
        Some(id) => {
            if !v["projects"][id].is_object() {
                v["projects"][id] = json!({});
            }
            &mut v["projects"][id]
        }
        None => &mut v["global"],
    };
    let map = slot.as_object_mut().ok_or("the visibility choices are damaged")?;
    match show {
        Some(s) => map.insert(source.to_string(), s.into()),
        None => map.remove(source),
    };
    save(store, &v)
}

/// Adds an extra root folder; it starts hidden. Each mistake has its own message.
pub fn add_root(store: &Store, path: &str) -> Result<(), String> {
    let path = path.trim();
    if path.is_empty() || !Path::new(path).is_absolute() || !Path::new(path).is_dir() {
        return Err(format!("\"{path}\" is not a folder on this computer"));
    }
    let mut v = ensure(store, &crate::projects::load_projects(store))?;
    let mut list = roots(&v);
    if list.iter().any(|r| name_key(r) == name_key(path)) {
        return Err(format!("{path} is already in the list"));
    }
    if list.len() >= MAX_ROOTS {
        return Err(format!("at most {MAX_ROOTS} folders can be listed; remove one first"));
    }
    list.push(path.to_string());
    v["roots"] = list.into();
    v["global"][root_key(path)] = false.into();
    save(store, &v)
}

pub fn remove_root(store: &Store, path: &str) -> Result<(), String> {
    let mut v = ensure(store, &crate::projects::load_projects(store))?;
    let list: Vec<String> = roots(&v).into_iter().filter(|r| name_key(r) != name_key(path)).collect();
    v["roots"] = list.into();
    let key = root_key(path);
    if let Some(g) = v["global"].as_object_mut() {
        g.remove(&key);
    }
    if let Some(ps) = v["projects"].as_object_mut() {
        for own in ps.values_mut().filter_map(Value::as_object_mut) {
            own.remove(&key);
        }
    }
    save(store, &v)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn card13_visibility_choices_that_could_not_be_kept_aside_are_never_saved_over() {
        let dir = std::env::temp_dir().join(format!("kolux-rs-vis-c13-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        let store = Store::open(&dir).unwrap();
        let broken = "{\"global\": {\"claude\": true";
        store.set(KEY, broken).unwrap();
        crate::orchestration::kept::refuse_copies(&dir);
        assert!(ensure(&store, &[]).unwrap_err().contains(KEY));
        assert_eq!(store.get(KEY).unwrap().as_deref(), Some(broken), "the blob is byte-identical");
        drop(store);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn card13b_listing_worktrees_degrades_when_the_choices_cannot_be_kept_aside() {
        let dir = std::env::temp_dir().join(format!("kolux-rs-vis-c13b-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        let store = Store::open(&dir).unwrap();
        let broken = "{\"global\": {\"claude\": true";
        store.set(KEY, broken).unwrap();
        crate::orchestration::kept::refuse_copies(&dir);
        let project = Project { id: "p".into(), name: "p".into(), path: dir.display().to_string(), workspaces_dir: None, base: None, display_name: None };
        assert!(apply(&store, &project, &Map::new(), Vec::new()).unwrap().is_empty());
        assert_eq!(store.get(KEY).unwrap().as_deref(), Some(broken), "the blob is byte-identical");
        drop(store);
        let _ = std::fs::remove_dir_all(&dir);
    }
}
