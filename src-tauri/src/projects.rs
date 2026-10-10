//! Projects and workspaces (PROJ-001, PROJ-007, PROJ-020, PROJ-021, PROJ-025, PROJ-028). A
//! project is a Git repository the user chose; a workspace is one of its worktrees. Projects are
//! saved in the state store; the workspaces folder and layout are user settings, and a project
//! may carry its own folder and base ref. The command line (PROJ-077) creates and removes
//! workspaces through the same functions. GIT-067: creations in one repository run one at a time,
//! a new worktree brings the include file's copies and kolux.yaml's shared folders along
//! (`include.rs`), and removal refuses uncommitted work unless forced.

use crate::creatures::creature_name;
use crate::git::{Git, Worktree};
use crate::names::safe_name;
use crate::state::Store;
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, OnceLock, PoisonError};
use tauri::State;

#[derive(Clone, Debug, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Project {
    pub id: String,
    pub name: String,
    pub path: String,
    /// This project's own workspaces folder (PROJ-025); relative means from the project root.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub workspaces_dir: Option<String>,
    /// The ref new workspaces start from (PROJ-028); none means the default branch Git reports.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub base: Option<String>,
}

/// A workspace just made (PROJ-028): the worktree, the ref it started from, and a note when
/// that ref was not the one saved for the project.
#[derive(Clone, Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Created {
    #[serde(flatten)]
    pub worktree: Worktree,
    pub base: String,
    pub note: Option<String>,
    /// GIT-067: include-file and shared-folder entries that could not be brought along.
    pub warnings: Vec<String>,
}

/// GIT-067: creations in one repository take turns; a failed one hands the turn on at once.
fn repo_turn(repo: &Path) -> Arc<Mutex<()>> {
    static TURNS: OnceLock<Mutex<HashMap<String, Arc<Mutex<()>>>>> = OnceLock::new();
    let key = repo.to_string_lossy().to_lowercase();
    TURNS.get_or_init(Default::default).lock().unwrap_or_else(PoisonError::into_inner).entry(key).or_default().clone()
}

/// Where a project's workspaces go and how they are laid out (PROJ-025).
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Place {
    pub root: PathBuf,
    /// Flat: every workspace straight under the root; nested: under a folder named after the project.
    pub flat: bool,
    /// What new branch names start with (PROJ-022), e.g. `txais-xiong/`; empty for none.
    pub prefix: String,
    /// Why the custom prefix is not used, when Git would refuse it.
    pub prefix_warning: Option<String>,
}

const PROJECTS_KEY: &str = "projects";
/// Typed workspace names by folder (PROJ-021): the branch and folder carry the cleaned form,
/// the row shows exactly what was typed.
const NAMES_KEY: &str = "workspaceNames";
/// Child workspace path (as `name_key` writes it) to its parent's path (PROJ-047).
const PARENTS_KEY: &str = "workspaceParents";
/// How each workspace came to be (CLI-018): who made it, its parent worktree, the calling folder,
/// an issue number and a comment, keyed like the names. Lineage views (PROJ-047) read it.
const ORIGINS_KEY: &str = "workspaceOrigins";
/// Per project id, the worktrees (as `name_key` writes them) already shown to the user (PROJ-041).
const SEEN_KEY: &str = "worktreesSeen";
/// Worktrees the user hid from the sidebar (PROJ-042), keyed like the names.
const HIDDEN_KEY: &str = "worktreesHidden";
pub(crate) const WORKSPACES_DIR_SETTING: &str = "workspacesDir";
/// "nested" (the default) or "flat" (PROJ-025).
const LAYOUT_SETTING: &str = "workspacesLayout";
/// Workspaces folders used before, newest first, so they can be picked again (PROJ-025).
const USED_DIRS_SETTING: &str = "workspacesDirsUsed";
/// PROJ-022: "user" (the Git user name, the default), "custom" or "none".
pub const PREFIX_SETTING: &str = "branchPrefix";
pub const PREFIX_CUSTOM_SETTING: &str = "branchPrefixCustom";

/// Compares two folders the way Windows does: same canonical path, letter case ignored.
fn same_folder(a: &Path, b: &Path) -> bool {
    let norm = |p: &Path| p.canonicalize().unwrap_or_else(|_| p.to_path_buf()).to_string_lossy().to_lowercase();
    norm(a) == norm(b)
}

pub fn load_projects(store: &Store) -> Vec<Project> {
    store.get(PROJECTS_KEY).ok().flatten().and_then(|s| serde_json::from_str(&s).ok()).unwrap_or_default()
}

fn save_projects(store: &Store, projects: &[Project]) -> Result<(), String> {
    store.set(PROJECTS_KEY, &serde_json::to_string(projects).map_err(|e| e.to_string())?).map_err(|e| e.to_string())
}

fn load_names(store: &Store) -> serde_json::Map<String, serde_json::Value> {
    store.get(NAMES_KEY).ok().flatten().and_then(|s| serde_json::from_str(&s).ok()).unwrap_or_default()
}

pub(crate) fn name_key(path: &str) -> String {
    path.replace('/', "\\").trim_end_matches('\\').to_lowercase()
}

/// Remembers (or with `None`, forgets) the typed name of the workspace at `path`.
pub fn set_name(store: &Store, path: &str, name: Option<&str>) -> Result<(), String> {
    let mut names = load_names(store);
    match name {
        Some(n) => names.insert(name_key(path), serde_json::Value::String(n.to_string())),
        None => names.remove(&name_key(path)),
    };
    store.set(NAMES_KEY, &serde_json::Value::Object(names).to_string()).map_err(|e| e.to_string())
}

/// Remembers (or with `None`, forgets) which workspace `path` was made from (PROJ-047).
pub fn set_parent(store: &Store, path: &str, parent: Option<&str>) -> Result<(), String> {
    let mut parents: serde_json::Map<String, serde_json::Value> = store.get(PARENTS_KEY).ok().flatten().and_then(|s| serde_json::from_str(&s).ok()).unwrap_or_default();
    match parent {
        Some(p) => parents.insert(name_key(path), serde_json::Value::String(p.to_string())),
        None => parents.remove(&name_key(path)),
    };
    store.set(PARENTS_KEY, &serde_json::Value::Object(parents).to_string()).map_err(|e| e.to_string())
}

/// Drops what Kolux remembers about a removed workspace, so a later one in the same folder starts
/// clean: its typed name, its parent and its origin.
pub fn forget_workspace(store: &Store, path: &str) -> Result<(), String> {
    set_name(store, path, None)?;
    set_parent(store, path, None)?;
    set_origin(store, path, None)
}

fn load_origins(store: &Store) -> serde_json::Map<String, serde_json::Value> {
    store.get(ORIGINS_KEY).ok().flatten().and_then(|s| serde_json::from_str(&s).ok()).unwrap_or_default()
}

/// Records (or with `None`, forgets) how the workspace at `path` came to be.
pub fn set_origin(store: &Store, path: &str, origin: Option<&serde_json::Value>) -> Result<(), String> {
    let mut all = load_origins(store);
    match origin {
        Some(o) => all.insert(name_key(path), o.clone()),
        None => all.remove(&name_key(path)),
    };
    store.set(ORIGINS_KEY, &serde_json::Value::Object(all).to_string()).map_err(|e| e.to_string())
}

fn load_map(store: &Store, key: &str) -> serde_json::Map<String, serde_json::Value> {
    store.get(key).ok().flatten().and_then(|s| serde_json::from_str(&s).ok()).unwrap_or_default()
}

/// PROJ-042: hides the worktree at `path` from the sidebar, or shows it again. The choice is
/// kept either way, so it wins over its source's visibility (`visibility.rs`).
pub fn set_hidden(store: &Store, path: &str, hidden: bool) -> Result<(), String> {
    let mut all = load_map(store, HIDDEN_KEY);
    all.insert(name_key(path), hidden.into());
    store.set(HIDDEN_KEY, &serde_json::Value::Object(all).to_string()).map_err(|e| e.to_string())
}

fn seen_of(store: &Store, project: &Project) -> Option<std::collections::HashSet<String>> {
    load_map(store, SEEN_KEY).get(&project.id).and_then(|v| v.as_array()).map(|a| a.iter().filter_map(|v| v.as_str().map(String::from)).collect())
}

fn save_seen<'a>(store: &Store, project: &Project, keys: impl IntoIterator<Item = &'a String>) -> Result<(), String> {
    let mut all = load_map(store, SEEN_KEY);
    all.insert(project.id.clone(), keys.into_iter().cloned().collect::<Vec<_>>().into());
    store.set(SEEN_KEY, &serde_json::Value::Object(all).to_string()).map_err(|e| e.to_string())
}

/// A worktree Kolux itself just made is never offered as new (PROJ-041), and its record makes it
/// managed wherever it sits (PROJ-044); a more detailed origin written by the caller is kept.
pub fn note_seen(store: &Store, project: &Project, path: &str) -> Result<(), String> {
    if origin(store, path).is_none() {
        set_origin(store, path, Some(&serde_json::json!({ "madeBy": "app" })))?;
    }
    match seen_of(store, project) {
        Some(mut seen) => {
            seen.insert(name_key(path));
            save_seen(store, project, &seen)
        }
        None => Ok(()), // the first scan takes everything there as seen
    }
}

/// PROJ-041: the worktrees that appeared since the user last looked, made with plain Git or another
/// tool (scratch worktrees are already left out by `list_workspaces`). The first scan of a project
/// takes what is there as seen, so adding a project never floods the notice. One list per scan, so a
/// burst of new worktrees is one notice. Worktrees that went away are forgotten, so the same folder
/// made again later counts as new.
/// ponytail: the sidebar polls this every 5 s instead of watching folders (DT-O2); a watcher can feed
/// the same call if 5 s ever feels slow.
pub fn unseen(git: &Git, store: &Store, project: &Project) -> Result<Vec<Worktree>, String> {
    let list = list_workspaces(git, store, project)?;
    let keys: Vec<String> = list.iter().map(|w| name_key(&w.path)).collect();
    let Some(seen) = seen_of(store, project) else {
        save_seen(store, project, &keys)?;
        return Ok(Vec::new());
    };
    let kept: Vec<&String> = keys.iter().filter(|k| seen.contains(*k)).collect();
    if kept.len() != seen.len() {
        save_seen(store, project, kept)?;
    }
    Ok(list.into_iter().filter(|w| !w.is_main && !seen.contains(&name_key(&w.path))).collect())
}

/// The review is closed: everything listed now counts as seen.
pub fn mark_all_seen(git: &Git, store: &Store, project: &Project) -> Result<(), String> {
    let keys: Vec<String> = git.worktrees(Path::new(&project.path))?.iter().map(|w| name_key(&w.path)).collect();
    save_seen(store, project, &keys)
}

/// How the workspace at `path` came to be, when Kolux recorded it.
pub fn origin(store: &Store, path: &str) -> Option<serde_json::Value> {
    load_origins(store).remove(&name_key(path))
}

/// The workspaces of a project as the sidebar lists them (PROJ-007): Git's list with the typed
/// names and parents laid over, and kind, source and visibility from `visibility::apply`, which
/// also drops the scratch worktrees other coding tools keep under a dot-folder of the main checkout.
pub fn list_workspaces(git: &Git, store: &Store, project: &Project) -> Result<Vec<Worktree>, String> {
    let names = load_names(store);
    let parents: serde_json::Map<String, serde_json::Value> = store.get(PARENTS_KEY).ok().flatten().and_then(|s| serde_json::from_str(&s).ok()).unwrap_or_default();
    let hidden = load_map(store, HIDDEN_KEY);
    let all = git.worktrees(Path::new(&project.path))?;
    Ok(crate::visibility::apply(store, project, &hidden, all)?
        .into_iter()
        .map(|mut w| {
            w.name = names.get(&name_key(&w.path)).and_then(|v| v.as_str()).map(String::from);
            w.parent = parents.get(&name_key(&w.path)).and_then(|v| v.as_str()).map(String::from);
            w
        })
        .collect())
}

/// Registers the repository that holds `path`; an already-registered one is handed back, not
/// added again. New projects go first (the Recent order). Picking the main checkout or any folder
/// inside it makes the main checkout the project (PROJ-007).
/// PROJ-006: a linked worktree whose repository is already a project selects that project (the
/// match is on the main checkout, never the folder picked); otherwise the folder picked is added.
pub fn add_project(git: &Git, store: &Store, path: &Path) -> Result<Project, String> {
    let top = git.toplevel(path)?;
    let main = git.worktrees(&top)?.into_iter().find(|w| w.is_main).map(|w| PathBuf::from(w.path)).unwrap_or_else(|| top.clone());
    let mut projects = load_projects(store);
    if let Some(existing) = projects.iter().find(|p| same_folder(Path::new(&p.path), &main) || same_folder(Path::new(&p.path), &top)) {
        return Ok(existing.clone());
    }
    let name = top.file_name().map(|n| n.to_string_lossy().trim_end_matches(".git").to_string()).unwrap_or_else(|| top.display().to_string());
    let project = Project {
        workspaces_dir: None,
        base: None,
        id: format!("{}-{}", name.to_lowercase(), std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis()).unwrap_or(0)),
        name,
        path: top.display().to_string(),
    };
    // Projects already there keep their earlier visibility; this one follows the defaults (PROJ-042).
    crate::visibility::ensure(store, &projects)?;
    projects.insert(0, project.clone());
    save_projects(store, &projects)?;
    Ok(project)
}

/// The default workspaces root: `kolux-rs\workspaces` in the user's home folder. A different
/// name from the old app's folders, so the two never mix.
pub fn default_workspaces_dir() -> PathBuf {
    let home = std::env::var(if cfg!(windows) { "USERPROFILE" } else { "HOME" }).map(PathBuf::from).unwrap_or_else(|_| std::env::temp_dir());
    home.join("kolux-rs").join("workspaces")
}

pub const WORKSPACES_DIR_ENV: &str = "KOLUX_WORKSPACES_DIR";

pub(crate) fn non_blank(s: Option<&str>) -> Option<&str> {
    s.map(str::trim).filter(|s| !s.is_empty())
}

/// The global workspaces folder (SET-032, PROJ-026): the saved setting, else the environment
/// variable (which only moves the default, so a folder the user saved still wins), else the
/// default. Both values are trimmed and a blank one counts as not set.
pub fn resolve_workspaces_dir(env: Option<&str>, setting: Option<&str>) -> PathBuf {
    non_blank(setting).or(non_blank(env)).map(PathBuf::from).unwrap_or_else(default_workspaces_dir)
}

pub fn workspaces_dir(store: &Store) -> PathBuf {
    resolve_workspaces_dir(std::env::var(WORKSPACES_DIR_ENV).ok().as_deref(), store.settings()[WORKSPACES_DIR_SETTING].as_str())
}

/// The folder and layout for `project`'s workspaces (PROJ-025): the project's own folder when it
/// has one, else the global setting, else the default; a relative folder counts from the
/// project root (joining an absolute one leaves it as it is).
pub fn place_for(store: &Store, project: &Project) -> Place {
    let own = project.workspaces_dir.as_deref().map(str::trim).filter(|s| !s.is_empty()).map(PathBuf::from);
    let settings = store.settings();
    let user = || crate::git::run(&["config", "user.name"], Some(Path::new(&project.path))).ok();
    let (prefix, prefix_warning) = branch_prefix(settings[PREFIX_SETTING].as_str(), settings[PREFIX_CUSTOM_SETTING].as_str(), user, &|p| crate::git::run(&["check-ref-format", "--branch", &format!("{p}x")], None).is_ok());
    Place { root: Path::new(&project.path).join(own.unwrap_or_else(|| workspaces_dir(store))), flat: settings[LAYOUT_SETTING].as_str() == Some("flat"), prefix, prefix_warning }
}

/// PROJ-022 / SET-031: the branch prefix for `mode`. The Git user name (the default) is cleaned
/// like a typed name, and no user name means no prefix; custom text loses surrounding spaces and
/// trailing slashes (only slashes means none); a prefix Git refuses is not used, with a warning.
pub fn branch_prefix(mode: Option<&str>, custom: Option<&str>, user: impl Fn() -> Option<String>, git_ok: &dyn Fn(&str) -> bool) -> (String, Option<String>) {
    let p = match mode {
        Some("none") => return (String::new(), None),
        Some("custom") => custom.unwrap_or("").trim().trim_end_matches('/').to_string(),
        _ => user().and_then(|u| safe_name(&u)).unwrap_or_default(),
    };
    if p.is_empty() {
        return (String::new(), None);
    }
    let p = format!("{p}/");
    if git_ok(&p) {
        (p, None)
    } else {
        (String::new(), Some(format!("the branch prefix \"{p}\" is not a name Git accepts, so this branch has no prefix")))
    }
}

pub fn used_dirs(store: &Store) -> Vec<String> {
    store.settings()[USED_DIRS_SETTING].as_array().map(|a| a.iter().filter_map(|v| v.as_str().map(String::from)).collect()).unwrap_or_default()
}

/// Puts a folder the user chose at the front of the remembered list (ten kept).
pub fn remember_dir(store: &Store, dir: &str) -> Result<(), String> {
    let dir = dir.trim();
    if dir.is_empty() {
        return Ok(());
    }
    let mut used = vec![dir.to_string()];
    used.extend(used_dirs(store).into_iter().filter(|d| !d.eq_ignore_ascii_case(dir)));
    used.truncate(10);
    let mut settings = store.settings();
    settings[USED_DIRS_SETTING] = serde_json::Value::Array(used.into_iter().map(serde_json::Value::String).collect());
    store.save_settings(&settings).map_err(|e| e.to_string())
}

/// Where a new workspace of `project` named `safe` lives: `<root>\<project>\<safe>` nested (the
/// project folder named without a `.git` ending), or `<root>\<safe>` flat.
pub fn workspace_path(place: &Place, project: &Project, safe: &str) -> PathBuf {
    if place.flat {
        place.root.join(safe)
    } else {
        place.root.join(project.name.trim_end_matches(".git")).join(safe)
    }
}

/// PROJ-028: what a new workspace starts from. The ref chosen for this one wins and must exist;
/// else the project's saved base, falling back to the default branch with a note when it is
/// gone; else the default branch. No default at all stops the create. A base that tracks a
/// remote is fetched first; a full commit id is used as it is.
pub fn resolve_base(git: &Git, repo: &Path, project: &Project, chosen: Option<&str>) -> Result<(String, Option<String>), String> {
    let chosen = chosen.map(str::trim).filter(|s| !s.is_empty());
    let saved = project.base.as_deref().map(str::trim).filter(|s| !s.is_empty());
    let default = || git.default_branch(repo).ok_or_else(|| format!("no default branch was found in {}; set a base ref for the project", project.name));
    let (base, note) = match (chosen, saved) {
        (Some(c), _) if git.base_available(repo, c) => (c.to_string(), None),
        (Some(c), _) => return Err(format!("{c} is not a branch, tag or commit in {}", project.name)),
        (None, Some(s)) if git.base_available(repo, s) => (s.to_string(), None),
        (None, Some(s)) => {
            let d = default()?;
            let note = format!("the saved base {s} no longer exists in {}; this workspace started from {d} instead", project.name);
            (d, Some(note))
        }
        (None, None) => {
            let d = default()?;
            let _ = git.base_available(repo, &d); // the fetch, when the default tracks a remote
            (d, None)
        }
    };
    Ok((base, note))
}

pub fn create_workspace(git: &Git, place: &Place, project: &Project, typed_name: &str, start: Option<&str>) -> Result<Created, String> {
    // SESS-036: a name that cleans up to nothing becomes "workspace" (numbered when taken).
    let base = safe_name(typed_name).unwrap_or_else(|| "workspace".to_string());
    let repo = Path::new(&project.path);
    let turn = repo_turn(repo);
    let _turn = turn.lock().unwrap_or_else(PoisonError::into_inner);
    let (from, note) = resolve_base(git, repo, project, start)?;
    // PROJ-021: a name taken by a branch (local or on a remote) or a folder gets a number.
    let (safe, dest) = (1..)
        .map(|n| if n == 1 { base.clone() } else { format!("{base}-{n}") })
        .map(|s| {
            let d = workspace_path(place, project, &s);
            (s, d)
        })
        .find(|(s, d)| !d.exists() && !git.branch_taken(repo, &format!("{}{s}", place.prefix)))
        .ok_or("no free name")?;
    if let Some(parent) = dest.parent() {
        std::fs::create_dir_all(parent).map_err(|e| format!("could not create {}: {e}", parent.display()))?;
    }
    git.worktree_add(repo, &dest, &format!("{}{safe}", place.prefix), &from)?;
    let mut warnings: Vec<String> = place.prefix_warning.iter().cloned().collect();
    warnings.extend(crate::include::bring_along(repo, &dest));
    let worktree = git
        .worktrees(repo)?
        .into_iter()
        .find(|w| same_folder(Path::new(&w.path), &dest))
        .ok_or_else(|| "the worktree was created but Git does not list it".to_string())?;
    Ok(Created { worktree, base: from, note, warnings })
}

/// Every workspace folder name and branch in use across all registered projects (SESS-023 and
/// PROJ-023: a generated name never repeats one in use anywhere).
pub fn names_in_use(git: &Git, projects: &[Project]) -> Vec<String> {
    let mut names = Vec::new();
    for p in projects {
        for w in git.worktrees(Path::new(&p.path)).unwrap_or_default() {
            if let Some(folder) = Path::new(&w.path).file_name() {
                names.push(folder.to_string_lossy().to_string());
            }
            if let Some(branch) = w.branch {
                names.push(branch);
            }
        }
    }
    names
}

/// Every creature name ever handed out (SESS-023): a retired worktree's name is never reused.
const RETIRED_KEY: &str = "creatureNamesUsed";

pub fn retired_names(store: &Store) -> Vec<String> {
    store.get(RETIRED_KEY).ok().flatten().and_then(|v| serde_json::from_str(&v).ok()).unwrap_or_default()
}

pub fn remember_retired(store: &Store, name: &str) -> Result<(), String> {
    let mut names = retired_names(store);
    if !names.iter().any(|n| n.eq_ignore_ascii_case(name)) {
        names.push(name.to_string());
        store.set(RETIRED_KEY, &serde_json::to_string(&names).map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// A creature name in use nowhere, now or before (SESS-023).
pub fn fresh_name(git: &Git, store: &Store, projects: &[Project], seed: u64) -> String {
    let mut taken = names_in_use(git, projects);
    taken.extend(retired_names(store));
    creature_name(&taken, seed)
}

/// A workspace an agent launch makes for itself: a creature name nobody uses, branched from the
/// main checkout, or from `base` when given (AUTO-005). The clock seeds the pick so launches do
/// not always start at the same pair.
pub fn create_fresh_workspace(git: &Git, store: &Store, place: &Place, projects: &[Project], project: &Project, base: Option<&str>) -> Result<Worktree, String> {
    let seed = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0);
    let name = fresh_name(git, store, projects, seed);
    remember_retired(store, &name)?;
    let made = create_workspace(git, place, project, &name, base)?.worktree;
    note_seen(store, project, &made.path)?;
    Ok(made)
}

/// GIT-067: uncommitted work (submodule work included) stops the removal unless `force`; the
/// branch goes with the folder unless another worktree still has it checked out.
#[cfg(test)]
pub fn remove_workspace(git: &Git, project: &Project, worktree_path: &str, force: bool) -> Result<(), String> {
    remove_worktree(git, project, worktree_path, force, false)
}

/// PROJ-030: a workspace opened on a branch that already existed keeps that branch when it goes.
pub fn keeps_branch(store: &Store, path: &str) -> bool {
    origin(store, path).is_some_and(|o| o["existingBranch"] == true)
}

/// `remove_workspace`, keeping the branch when `keep_branch`.
pub fn remove_worktree(git: &Git, project: &Project, worktree_path: &str, force: bool, keep_branch: bool) -> Result<(), String> {
    let repo = Path::new(&project.path);
    let target = git.worktrees(repo)?.into_iter().find(|w| same_folder(Path::new(&w.path), Path::new(worktree_path))).ok_or_else(|| format!("{worktree_path} is not a worktree of {}", project.name))?;
    if target.is_main {
        return Err("the main checkout cannot be removed; remove the project instead".to_string());
    }
    if !force && git.dirty(Path::new(&target.path))? {
        return Err(format!("{} has uncommitted changes", target.branch.as_deref().unwrap_or(worktree_path)));
    }
    crate::include::unlink_shared(repo, Path::new(&target.path));
    git.worktree_remove(repo, Path::new(&target.path), target.branch.as_deref().filter(|_| !keep_branch)).map(|_| ())
}

/// PROJ-030: a workspace on a branch that exists already, locally or only on a remote (Git then
/// makes the local branch that tracks it). The folder takes `folder` when given, else the
/// branch's name, numbered when taken; the branch itself never changes and is kept at removal.
pub fn open_branch_workspace(git: &Git, place: &Place, project: &Project, branch: &str, folder: Option<&str>) -> Result<Created, String> {
    let branch = branch.trim();
    let repo = Path::new(&project.path);
    if branch.is_empty() || !git.branch_taken(repo, branch) {
        return Err(format!("there is no branch {branch} in {}", project.name));
    }
    let base = safe_name(folder.map(str::trim).filter(|f| !f.is_empty()).unwrap_or(branch)).ok_or("that folder name leaves nothing usable; use some letters or digits")?;
    let turn = repo_turn(repo);
    let _turn = turn.lock().unwrap_or_else(PoisonError::into_inner);
    let dest = (1..)
        .map(|n| workspace_path(place, project, &if n == 1 { base.clone() } else { format!("{base}-{n}") }))
        .find(|d| !d.exists())
        .ok_or("no free folder")?;
    if let Some(parent) = dest.parent() {
        std::fs::create_dir_all(parent).map_err(|e| format!("could not create {}: {e}", parent.display()))?;
    }
    crate::git::run(&["worktree", "add", &dest.to_string_lossy(), branch], Some(repo))?;
    let warnings = crate::include::bring_along(repo, &dest);
    let worktree = git.worktrees(repo)?.into_iter().find(|w| same_folder(Path::new(&w.path), &dest)).ok_or_else(|| "the worktree was created but Git does not list it".to_string())?;
    Ok(Created { worktree, base: branch.to_string(), note: None, warnings })
}

/// The branches a workspace can be opened on (PROJ-030): local ones, then remote ones by their
/// short name (`origin/feat-x`), without the remotes' HEAD pointers.
pub fn branches(repo: &Path) -> Result<Vec<String>, String> {
    let out = crate::git::run(&["for-each-ref", "--format=%(refname)", "refs/heads", "refs/remotes"], Some(repo))?;
    Ok(out.lines().filter(|l| !l.ends_with("/HEAD")).filter_map(|l| l.strip_prefix("refs/heads/").or_else(|| l.strip_prefix("refs/remotes/"))).map(str::to_string).collect())
}

#[tauri::command]
pub fn workspace_branches(store: StoreState<'_>, project_id: String) -> Result<Vec<String>, String> {
    let project = find_project(&*store.lock().map_err(|e| e.to_string())?, &project_id)?;
    branches(Path::new(&project.path))
}

#[tauri::command]
pub fn workspace_open_branch(git: State<'_, Git>, store: StoreState<'_>, project_id: String, branch: String, folder: Option<String>, parent: Option<String>) -> Result<Created, String> {
    let (project, place) = {
        let store = store.lock().map_err(|e| e.to_string())?;
        let project = find_project(&store, &project_id)?;
        let place = place_for(&store, &project);
        (project, place)
    };
    let mut made = open_branch_workspace(&git, &place, &project, &branch, folder.as_deref())?;
    let store = store.lock().map_err(|e| e.to_string())?;
    set_origin(&store, &made.worktree.path, Some(&serde_json::json!({ "madeBy": "app", "existingBranch": true })))?;
    note_seen(&store, &project, &made.worktree.path)?;
    if let Some(parent) = non_blank(parent.as_deref()) {
        set_parent(&store, &made.worktree.path, Some(parent))?;
        made.worktree.parent = Some(parent.to_string());
    }
    Ok(made)
}

fn find_project(store: &Store, id: &str) -> Result<Project, String> {
    load_projects(store).into_iter().find(|p| p.id == id).ok_or_else(|| "that project is no longer registered".to_string())
}

type StoreState<'a> = State<'a, Mutex<Store>>;

#[tauri::command]
pub fn git_version(git: State<'_, Git>) -> String {
    git.version.clone()
}

#[tauri::command]
pub fn project_list(store: StoreState<'_>) -> Result<Vec<Project>, String> {
    let store = store.lock().map_err(|e| e.to_string())?;
    Ok(load_projects(&store))
}

#[tauri::command]
pub fn project_add(git: State<'_, Git>, store: StoreState<'_>, path: String) -> Result<Project, String> {
    let store = store.lock().map_err(|e| e.to_string())?;
    add_project(&git, &store, Path::new(path.trim()))
}

/// PROJ-041: the new worktrees made outside Kolux, for the sidebar's count line.
#[tauri::command]
pub fn workspace_unseen(git: State<'_, Git>, store: StoreState<'_>, project_id: String) -> Result<Vec<Worktree>, String> {
    let store = store.lock().map_err(|e| e.to_string())?;
    let project = find_project(&store, &project_id)?;
    unseen(&git, &store, &project)
}

#[tauri::command]
pub fn workspace_seen(git: State<'_, Git>, store: StoreState<'_>, project_id: String) -> Result<(), String> {
    let store = store.lock().map_err(|e| e.to_string())?;
    let project = find_project(&store, &project_id)?;
    mark_all_seen(&git, &store, &project)
}

/// SET-032 / PROJ-042: the visibility sources, with the global choice and `project_id`'s own.
#[tauri::command]
pub fn visibility_get(store: StoreState<'_>, project_id: Option<String>) -> Result<Vec<crate::visibility::Source>, String> {
    let store = store.lock().map_err(|e| e.to_string())?;
    let project = project_id.map(|id| find_project(&store, &id)).transpose()?;
    Ok(crate::visibility::sources(&store, project.as_ref()))
}

/// Sets the global choice for a source, or a project's own (`show` empty: back to the global).
#[tauri::command]
pub fn visibility_set(store: StoreState<'_>, project_id: Option<String>, source: String, show: Option<bool>) -> Result<(), String> {
    crate::visibility::set_choice(&*store.lock().map_err(|e| e.to_string())?, project_id.as_deref(), &source, show)
}

#[tauri::command]
pub fn visibility_root_add(store: StoreState<'_>, path: String) -> Result<(), String> {
    crate::visibility::add_root(&*store.lock().map_err(|e| e.to_string())?, &path)
}

#[tauri::command]
pub fn visibility_root_remove(store: StoreState<'_>, path: String) -> Result<(), String> {
    crate::visibility::remove_root(&*store.lock().map_err(|e| e.to_string())?, &path)
}

/// PROJ-042: hide a worktree from the sidebar, or show it again.
#[tauri::command]
pub fn workspace_hide(store: StoreState<'_>, path: String, hidden: bool) -> Result<(), String> {
    set_hidden(&*store.lock().map_err(|e| e.to_string())?, &path, hidden)
}

#[tauri::command]
pub fn workspace_list(git: State<'_, Git>, store: StoreState<'_>, project_id: String) -> Result<Vec<Worktree>, String> {
    let store = store.lock().map_err(|e| e.to_string())?;
    let project = find_project(&store, &project_id)?;
    list_workspaces(&git, &store, &project)
}

/// What a typed name becomes (PROJ-021 / PROJ-025): the branch, and the folder it would get in
/// the project; `branch` (Advanced) names the branch instead of the name (SESS-037).
#[derive(serde::Serialize)]
pub struct Preview {
    pub branch: String,
    pub folder: String,
}

#[tauri::command]
pub fn workspace_preview(store: StoreState<'_>, name: String, project_id: Option<String>, branch: Option<String>) -> Result<Option<Preview>, String> {
    let typed = non_blank(branch.as_deref()).unwrap_or(&name);
    let branch = safe_name(typed).unwrap_or_else(|| "workspace".to_string());
    let store = store.lock().map_err(|e| e.to_string())?;
    let folder = match project_id.filter(|id| !id.is_empty()) {
        Some(id) => {
            let project = find_project(&store, &id)?;
            let place = place_for(&store, &project);
            let folder = workspace_path(&place, &project, &branch).display().to_string();
            return Ok(Some(Preview { branch: format!("{}{branch}", place.prefix), folder }));
        }
        None => String::new(),
    };
    Ok(Some(Preview { branch, folder }))
}

/// Makes a workspace in a registered project and keeps the typed name (the sidebar's Create and
/// `kolux-dev worktree create` both come through here). `branch` (the composer's Advanced) names
/// the branch in place of the name (SESS-037).
pub fn create_named(git: &Git, store: &Mutex<Store>, project_id: &str, name: &str, base: Option<&str>, branch: Option<&str>) -> Result<Created, String> {
    let (project, place) = {
        let store = store.lock().map_err(|e| e.to_string())?;
        let project = find_project(&store, project_id)?;
        let place = place_for(&store, &project);
        (project, place)
    };
    let mut made = create_workspace(git, &place, &project, non_blank(branch).unwrap_or(name), base)?;
    note_seen(&*store.lock().map_err(|e| e.to_string())?, &project, &made.worktree.path)?;
    let typed = name.trim();
    if typed != made.worktree.branch.as_deref().unwrap_or_default() {
        let store = store.lock().map_err(|e| e.to_string())?;
        set_name(&store, &made.worktree.path, Some(typed))?;
        made.worktree.name = Some(typed.to_string());
    }
    Ok(made)
}

#[tauri::command]
pub fn workspace_create(git: State<'_, Git>, store: StoreState<'_>, project_id: String, name: String, base: Option<String>, branch: Option<String>, parent: Option<String>) -> Result<Created, String> {
    let mut made = create_named(&git, &store, &project_id, &name, base.as_deref(), branch.as_deref())?;
    // SESS-037: the parent picked in the composer (PROJ-047 nests it there).
    if let Some(parent) = non_blank(parent.as_deref()) {
        set_parent(&*store.lock().map_err(|e| e.to_string())?, &made.worktree.path, Some(parent))?;
        made.worktree.parent = Some(parent.to_string());
    }
    Ok(made)
}

/// A fresh creature-named workspace in project `project_id`. The store stays locked while Git
/// works so two launches at once never pick one name.
pub fn create_fresh(git: &Git, store: &Mutex<Store>, project_id: &str) -> Result<Worktree, String> {
    create_fresh_from(git, store, project_id, None)
}

/// As `create_fresh`, cut from `base` (a ref) when given, else the project's base (AUTO-005).
pub fn create_fresh_from(git: &Git, store: &Mutex<Store>, project_id: &str, base: Option<&str>) -> Result<Worktree, String> {
    let store = store.lock().map_err(|e| e.to_string())?;
    let project = find_project(&store, project_id)?;
    let place = place_for(&store, &project);
    create_fresh_workspace(git, &store, &place, &load_projects(&store), &project, base)
}

#[tauri::command]
pub fn workspace_create_fresh(git: State<'_, Git>, store: StoreState<'_>, project_id: String) -> Result<Worktree, String> {
    create_fresh(&git, &store, &project_id)
}

/// PROJ-025 / PROJ-028: a project's own workspaces folder and base ref; empty clears either.
#[tauri::command]
pub fn project_set(store: StoreState<'_>, project_id: String, workspaces_dir: String, base: String) -> Result<Project, String> {
    let store = store.lock().map_err(|e| e.to_string())?;
    let mut projects = load_projects(&store);
    let project = projects.iter_mut().find(|p| p.id == project_id).ok_or("that project is no longer registered")?;
    let clean = |s: &str| Some(s.trim().to_string()).filter(|s| !s.is_empty());
    project.workspaces_dir = clean(&workspaces_dir);
    project.base = clean(&base);
    let project = project.clone();
    save_projects(&store, &projects)?;
    remember_dir(&store, &workspaces_dir)?;
    Ok(project)
}

#[tauri::command]
pub fn workspace_remove(git: State<'_, Git>, store: StoreState<'_>, terminals: State<'_, crate::terminal::Terminals>, project_id: String, path: String, force: bool) -> Result<(), String> {
    let project = {
        let store = store.lock().map_err(|e| e.to_string())?;
        find_project(&store, &project_id)?
    };
    if !force && git.dirty(Path::new(&path))? {
        return Err(format!("{} has uncommitted changes", Path::new(&path).file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or(path)));
    }
    // A shell still sitting in the folder would keep Windows from deleting it.
    terminals.kill_under(Path::new(&path));
    let keep = keeps_branch(&*store.lock().map_err(|e| e.to_string())?, &path);
    remove_worktree(&git, &project, &path, force, keep)?;
    let store = store.lock().map_err(|e| e.to_string())?;
    forget_workspace(&store, &path)
}

/// The global workspaces settings as the sidebar shows them (PROJ-025).
#[derive(serde::Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct PlaceInfo {
    /// The folder in use (the default when nothing is set).
    pub dir: String,
    pub flat: bool,
    pub used: Vec<String>,
    /// True while KOLUX_WORKSPACES_DIR supplies the folder (nothing saved), so the field can say so.
    pub from_env: bool,
}

fn place_info(store: &Store) -> PlaceInfo {
    let settings = store.settings();
    let saved = non_blank(settings[WORKSPACES_DIR_SETTING].as_str()).is_some();
    let from_env = !saved && non_blank(std::env::var(WORKSPACES_DIR_ENV).ok().as_deref()).is_some();
    PlaceInfo { dir: workspaces_dir(store).display().to_string(), flat: settings[LAYOUT_SETTING].as_str() == Some("flat"), used: used_dirs(store), from_env }
}

#[tauri::command]
pub fn workspaces_place_get(store: StoreState<'_>) -> Result<PlaceInfo, String> {
    let store = store.lock().map_err(|e| e.to_string())?;
    Ok(place_info(&store))
}

/// An empty folder means the default, which does not count as a choice (it is not remembered).
#[tauri::command]
pub fn workspaces_place_set(store: StoreState<'_>, dir: String, flat: bool) -> Result<PlaceInfo, String> {
    let store = store.lock().map_err(|e| e.to_string())?;
    set_place(&store, &dir, flat)
}

/// An absolute folder is made right away (so a folder that cannot be made is a failed save the
/// user can retry, SET-032); a relative one counts from each project root, so it is only saved.
fn set_place(store: &Store, dir: &str, flat: bool) -> Result<PlaceInfo, String> {
    let mut settings = store.settings();
    let trimmed = dir.trim();
    if trimmed.is_empty() {
        settings.as_object_mut().map(|o| o.remove(WORKSPACES_DIR_SETTING));
    } else {
        if Path::new(trimmed).is_absolute() {
            std::fs::create_dir_all(trimmed).map_err(|e| format!("{trimmed} cannot be made: {e}"))?;
        }
        settings[WORKSPACES_DIR_SETTING] = serde_json::Value::String(trimmed.to_string());
    }
    settings[LAYOUT_SETTING] = serde_json::Value::String(if flat { "flat" } else { "nested" }.to_string());
    store.save_settings(&settings).map_err(|e| e.to_string())?;
    remember_dir(store, trimmed)?;
    Ok(place_info(store))
}

/// SESS-025: the handoff note of one agent launched side by side: `<repo>/.kolux/handoffs/<name>.md`
/// (COMPAT.md: one Markdown note per worktree, in the project's hidden Kolux folder, named after the
/// worktree). It is made before the agent starts, holding the headings the agent keeps current; an
/// existing note is never overwritten, so a relaunch keeps what the last agent wrote.
// ponytail: the notes sit untracked in the main checkout; add `.kolux/` to the repo's ignore list
// if they ever clutter its status.
pub fn prepare_handoff(repo: &Path, name: &str) -> Result<PathBuf, String> {
    use std::io::Write;
    let file = safe_name(name).ok_or_else(|| format!("{name} cannot name a handoff note"))?;
    let dir = repo.join(".kolux").join("handoffs");
    std::fs::create_dir_all(&dir).map_err(|e| format!("cannot make {}: {e}", dir.display()))?;
    let path = dir.join(format!("{file}.md"));
    let note = format!("# Handoff: {name}\n\n## Files added\n\n## Files updated\n\n## Files removed\n\n## Left to do\n");
    match std::fs::OpenOptions::new().write(true).create_new(true).open(&path) {
        Ok(mut f) => f.write_all(note.as_bytes()).map_err(|e| e.to_string())?,
        Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => {}
        Err(e) => return Err(format!("cannot write {}: {e}", path.display())),
    }
    Ok(path)
}

/// SESS-025: makes (or keeps) the handoff note `name` under `root` (the project's main checkout,
/// or the chooser's folder outside any project); its path.
#[tauri::command]
pub fn handoff_note_prepare(root: String, name: String) -> Result<String, String> {
    prepare_handoff(Path::new(&root), &name).map(|p| p.to_string_lossy().into_owned())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    #[test]
    fn sess025_handoff_note_is_made_once_and_never_overwritten() {
        let repo = temp("handoff");
        let path = prepare_handoff(&repo, "gentle-squid").unwrap();
        assert_eq!(path, repo.join(".kolux").join("handoffs").join("gentle-squid.md"));
        let text = fs::read_to_string(&path).unwrap();
        for heading in ["## Files added", "## Files updated", "## Files removed", "## Left to do"] {
            assert!(text.contains(heading), "{heading} in {text}");
        }
        fs::write(&path, "kept").unwrap();
        assert_eq!(prepare_handoff(&repo, "gentle-squid").unwrap(), path);
        assert_eq!(fs::read_to_string(&path).unwrap(), "kept");
        let odd = prepare_handoff(&repo, "../escape").unwrap();
        assert_eq!(odd.parent().unwrap(), repo.join(".kolux").join("handoffs"));
        assert!(prepare_handoff(&repo, "///").is_err());
    }
    use std::process::Command;

    fn temp(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("kolux-rs-proj-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn git_in(dir: &Path, args: &[&str]) {
        let ok = Command::new("git").args(args).current_dir(dir).output().unwrap().status.success();
        assert!(ok, "git {args:?} in {}", dir.display());
    }

    fn temp_repo(name: &str) -> PathBuf {
        let dir = temp(name);
        init_repo(&dir);
        dir
    }

    fn init_repo(dir: &Path) {
        fs::create_dir_all(dir).unwrap();
        git_in(dir, &["init", "-q", "-b", "main"]);
        git_in(dir, &["config", "user.email", "t@example.com"]);
        git_in(dir, &["config", "user.name", "t"]);
        fs::write(dir.join("a.txt"), "a").unwrap();
        git_in(dir, &["add", "."]);
        git_in(dir, &["commit", "-q", "-m", "first"]);
    }

    fn rev(dir: &Path, r: &str) -> String {
        String::from_utf8(Command::new("git").args(["rev-parse", r]).current_dir(dir).output().unwrap().stdout).unwrap().trim().to_string()
    }

    fn nested(root: &Path) -> Place {
        Place { root: root.to_path_buf(), flat: false, prefix: String::new(), prefix_warning: None }
    }

    #[test]
    fn add_project_dedupes_and_rejects_non_repos() {
        let git = Git::detect().unwrap();
        let profile = temp("profile");
        let store = Store::open(&profile).unwrap();
        let repo = temp_repo("repo");
        let p1 = add_project(&git, &store, &repo).unwrap();
        fs::create_dir_all(repo.join("deep").join("er")).unwrap();
        let p2 = add_project(&git, &store, &repo.join("deep").join("er")).unwrap();
        assert_eq!(p1, p2, "same repository registers once");
        assert_eq!(load_projects(&store).len(), 1);
        let plain = temp("plain");
        assert!(add_project(&git, &store, &plain).unwrap_err().contains("not inside a Git repository"));
        drop(store);
        for d in [profile, repo, plain] {
            fs::remove_dir_all(d).unwrap();
        }
    }

    #[test]
    fn a_linked_worktree_selects_its_repository_or_is_added_itself() {
        let git = Git::detect().unwrap();
        let repo = temp_repo("link-a");
        let linked = temp("link-wt").join("w");
        git_in(&repo, &["worktree", "add", "-q", "-b", "side", &linked.to_string_lossy()]);
        // PROJ-006: A is a project already → picking A's linked worktree gives A, no duplicate.
        let profile = temp("link-p1");
        let store = Store::open(&profile).unwrap();
        let a = add_project(&git, &store, &repo).unwrap();
        assert_eq!(add_project(&git, &store, &linked).unwrap(), a);
        assert_eq!(load_projects(&store).len(), 1);
        drop(store);
        // A not added → the linked worktree folder itself becomes the project.
        let profile2 = temp("link-p2");
        let store = Store::open(&profile2).unwrap();
        let w = add_project(&git, &store, &linked).unwrap();
        assert!(same_folder(Path::new(&w.path), &linked), "{} is the folder picked", w.path);
        drop(store);
        git_in(&repo, &["worktree", "remove", "--force", &linked.to_string_lossy()]);
        for d in [profile, profile2, repo] {
            fs::remove_dir_all(d).unwrap();
        }
    }

    #[test]
    fn the_branch_prefix_is_the_user_name_custom_text_or_nothing() {
        let ok = |p: &str| crate::git::run(&["check-ref-format", "--branch", &format!("{p}x")], None).is_ok();
        let user = || Some("Txais Xiong".to_string());
        assert_eq!(branch_prefix(None, None, user, &ok), ("txais-xiong/".into(), None), "the user name by default");
        assert_eq!(branch_prefix(Some("user"), None, || None, &ok), (String::new(), None), "no user name: the bare name");
        assert_eq!(branch_prefix(Some("custom"), Some(" tx// "), user, &ok).0, "tx/");
        assert_eq!(branch_prefix(Some("custom"), Some("tx"), user, &ok).0, "tx/");
        assert_eq!(branch_prefix(Some("custom"), Some("///"), user, &ok), (String::new(), None), "only slashes: none");
        assert_eq!(branch_prefix(Some("none"), Some("tx"), user, &ok), (String::new(), None));
        let (p, warn) = branch_prefix(Some("custom"), Some("a b"), user, &ok);
        assert!(p.is_empty() && warn.unwrap().contains("not a name Git accepts"), "Git refuses spaces");
        // The prefix goes on the branch only; the folder keeps the bare name.
        let git = Git::detect().unwrap();
        let profile = temp("prefix");
        let store = Store::open(&profile).unwrap();
        let repo = temp_repo("prefix-r");
        let root = temp("prefix-root");
        let project = add_project(&git, &store, &repo).unwrap();
        let place = Place { prefix: "tx/".into(), ..nested(&root) };
        let made = create_workspace(&git, &place, &project, "Fix login", None).unwrap();
        assert_eq!(made.worktree.branch.as_deref(), Some("tx/fix-login"));
        assert!(same_folder(Path::new(&made.worktree.path), &workspace_path(&place, &project, "fix-login")));
        let bad = Place { prefix_warning: Some("w".into()), ..nested(&root) };
        assert_eq!(create_workspace(&git, &bad, &project, "two", None).unwrap().warnings, vec!["w".to_string()]);
        drop(store);
        for d in [profile, repo, root] {
            let _ = fs::remove_dir_all(d);
        }
    }

    #[test]
    fn a_workspace_opens_on_an_existing_branch_and_keeps_it() {
        let git = Git::detect().unwrap();
        let profile = temp("open-b");
        let store = Store::open(&profile).unwrap();
        let repo = temp_repo("open-r");
        let root = temp("open-root");
        git_in(&repo, &["checkout", "-q", "-b", "feat/x"]);
        fs::write(repo.join("b.txt"), "b").unwrap();
        git_in(&repo, &["add", "."]);
        git_in(&repo, &["commit", "-q", "-m", "earlier work"]);
        git_in(&repo, &["checkout", "-q", "main"]);
        let tip = rev(&repo, "feat/x");
        let project = add_project(&git, &store, &repo).unwrap();
        assert!(branches(&repo).unwrap().contains(&"feat/x".to_string()));
        assert!(open_branch_workspace(&git, &nested(&root), &project, "nope", None).unwrap_err().contains("no branch nope"));
        // PROJ-030: a different folder name still checks out feat/x itself, with its commits.
        let made = open_branch_workspace(&git, &nested(&root), &project, "feat/x", Some("Review X")).unwrap();
        assert_eq!(made.worktree.branch.as_deref(), Some("feat/x"));
        assert_eq!(rev(Path::new(&made.worktree.path), "HEAD"), tip);
        assert!(made.worktree.path.replace(std::path::MAIN_SEPARATOR, "/").ends_with("/review-x"), "{}", made.worktree.path);
        set_origin(&store, &made.worktree.path, Some(&serde_json::json!({ "existingBranch": true }))).unwrap();
        assert!(keeps_branch(&store, &made.worktree.path));
        remove_worktree(&git, &project, &made.worktree.path, false, keeps_branch(&store, &made.worktree.path)).unwrap();
        assert_eq!(rev(&repo, "feat/x"), tip, "the branch stays when the workspace goes");
        drop(store);
        for d in [profile, repo, root] {
            let _ = fs::remove_dir_all(d);
        }
    }

    #[test]
    fn own_worktrees_are_managed_and_outside_ones_follow_the_visibility_choice() {
        use crate::visibility as vis;
        let git = Git::detect().unwrap();
        let profile = temp("vis");
        let store = Store::open(&profile).unwrap();
        let repo = temp_repo("vis-r");
        let root = temp("vis-root");
        let side = temp("vis-side");
        let p = |d: &Path| d.to_string_lossy().to_string();
        store.save_settings(&serde_json::json!({ "workspacesDir": p(&root) })).unwrap();
        // A fresh profile: a project added now starts with worktrees made elsewhere hidden.
        let project = add_project(&git, &store, &repo).unwrap();
        let made = create_fresh_workspace(&git, &store, &nested(&root), &load_projects(&store), &project, None).unwrap();
        let hand = root.join("by-hand");
        let claude = repo.join(".claude").join("worktrees").join("agent-1");
        let scratch = repo.join(".tool").join("x");
        let away = side.join("away");
        for (b, d) in [("hand", &hand), ("cc", &claude), ("scr", &scratch), ("away", &away)] {
            git_in(&repo, &["worktree", "add", "-q", "-b", b, &p(d)]);
        }
        let look = |store: &Store, project: &Project| -> Vec<(String, String, Option<String>, bool)> {
            list_workspaces(&git, store, project).unwrap().into_iter().map(|w| (w.branch.clone().unwrap_or_default(), w.kind.clone(), w.source.clone(), w.hidden)).collect()
        };
        let row = |rows: &[(String, String, Option<String>, bool)], b: &str| rows.iter().find(|r| r.0 == b).cloned();
        let rows = look(&store, &project);
        assert_eq!(row(&rows, "main").unwrap().1, "main");
        let mine = row(&rows, made.branch.as_deref().unwrap()).unwrap();
        assert_eq!((mine.1.as_str(), mine.3), ("managed", false), "Kolux's own is managed and shown");
        assert_eq!(row(&rows, "hand"), Some(("hand".into(), "external".into(), Some("other".into()), true)), "by hand inside the workspaces folder is external");
        assert_eq!(row(&rows, "cc"), Some(("cc".into(), "external".into(), Some("claude".into()), true)));
        assert_eq!(row(&rows, "away"), Some(("away".into(), "external".into(), Some("other".into()), true)));
        assert!(row(&rows, "scr").is_none(), "another tool's scratch folder is never listed");
        // Moved workspaces folder: Kolux's own record still makes it managed.
        store.save_settings(&serde_json::json!({ "workspacesDir": p(&side.join("elsewhere")) })).unwrap();
        assert_eq!(row(&look(&store, &project), made.branch.as_deref().unwrap()).unwrap().1, "managed");
        // A base folder set on purpose beats the scratch rule.
        store.save_settings(&serde_json::json!({ "workspacesDir": p(&repo.join(".tool")) })).unwrap();
        assert_eq!(row(&look(&store, &project), "scr").map(|r| r.2), Some(Some("other".into())));
        store.save_settings(&serde_json::json!({ "workspacesDir": p(&root) })).unwrap();
        // Global and per-project choices; the global never overwrites the project's own.
        vis::set_choice(&store, None, "other", Some(true)).unwrap();
        assert!(!row(&look(&store, &project), "hand").unwrap().3);
        vis::set_choice(&store, Some(&project.id), "other", Some(false)).unwrap();
        vis::set_choice(&store, None, "other", Some(false)).unwrap();
        vis::set_choice(&store, None, "other", Some(true)).unwrap();
        assert!(row(&look(&store, &project), "hand").unwrap().3, "the project's own choice stays");
        let src = vis::sources(&store, Some(&project));
        let other = src.iter().find(|s| s.key == "other").unwrap();
        assert_eq!((other.global, other.own), (true, Some(false)), "the override shows the global value it replaces");
        vis::set_choice(&store, Some(&project.id), "other", None).unwrap();
        assert!(!row(&look(&store, &project), "hand").unwrap().3, "reset: back to the global choice");
        // Extra root folders start hidden, at most 32, each mistake its own error.
        vis::add_root(&store, &p(&side)).unwrap();
        let r = row(&look(&store, &project), "away").unwrap();
        assert!(r.2.as_deref().unwrap().starts_with("root:") && r.3, "{r:?}");
        assert!(vis::add_root(&store, "relative\\folder").unwrap_err().contains("not a folder"));
        assert!(vis::add_root(&store, &p(&side)).unwrap_err().contains("already"));
        for i in 1..32 {
            let d = side.join(format!("r{i}"));
            fs::create_dir_all(&d).unwrap();
            vis::add_root(&store, &p(&d)).unwrap();
        }
        let d = side.join("r32");
        fs::create_dir_all(&d).unwrap();
        assert!(vis::add_root(&store, &p(&d)).unwrap_err().contains("at most 32"));
        // One worktree shown by hand wins over its source's choice.
        set_hidden(&store, &p(&claude), false).unwrap();
        assert!(!row(&look(&store, &project), "cc").unwrap().3);
        // A profile that had projects before this choice existed keeps showing them.
        let profile2 = temp("vis-old");
        let old = Store::open(&profile2).unwrap();
        let project2 = add_project(&git, &old, &repo).unwrap();
        old.set("worktreeVisibility", "null").unwrap();
        assert!(!row(&look(&old, &project2), "hand").unwrap().3, "an earlier project keeps its earlier behaviour");
        assert!(row(&look(&old, &project2), "cc").unwrap().3, "Claude Code's scratch stayed hidden before, and still does");
        drop(store);
        drop(old);
        for d in [&hand, &claude, &scratch, &away] {
            let _ = git.worktree_remove(&repo, d, None);
        }
        for d in [profile, profile2, repo, root, side] {
            let _ = fs::remove_dir_all(d);
        }
    }

    #[test]
    fn worktrees_made_outside_kolux_are_noticed_once_and_can_be_hidden() {
        let git = Git::detect().unwrap();
        let profile = temp("unseen");
        let store = Store::open(&profile).unwrap();
        let repo = temp_repo("unseen-r");
        let side = temp("unseen-side");
        let root = temp("unseen-root");
        git_in(&repo, &["worktree", "add", "-q", "-b", "before", &side.join("before").to_string_lossy()]);
        let project = add_project(&git, &store, &repo).unwrap();
        assert!(unseen(&git, &store, &project).unwrap().is_empty(), "the first scan takes what is there as seen");
        // Three made at once with plain Git: one list, so one notice.
        for n in ["a", "b", "c"] {
            git_in(&repo, &["worktree", "add", "-q", "-b", n, &side.join(n).to_string_lossy()]);
        }
        // One Kolux makes itself is not offered.
        create_fresh_workspace(&git, &store, &nested(&root), &load_projects(&store), &project, None).unwrap();
        let fresh: Vec<_> = unseen(&git, &store, &project).unwrap().into_iter().map(|w| w.branch.unwrap()).collect();
        assert_eq!(fresh.len(), 3, "{fresh:?}");
        assert!(fresh.iter().all(|b| ["a", "b", "c"].contains(&b.as_str())));
        mark_all_seen(&git, &store, &project).unwrap();
        assert!(unseen(&git, &store, &project).unwrap().is_empty());
        // Gone and made again: new again.
        git_in(&repo, &["worktree", "remove", &side.join("a").to_string_lossy()]);
        assert!(unseen(&git, &store, &project).unwrap().is_empty());
        git_in(&repo, &["worktree", "add", "-q", &side.join("a").to_string_lossy(), "a"]);
        assert_eq!(unseen(&git, &store, &project).unwrap().len(), 1);
        // PROJ-042: hide one, show it again; the main checkout is never hidden. (Worktrees made
        // elsewhere start hidden in a new project, so show them first.)
        crate::visibility::set_choice(&store, None, "other", Some(true)).unwrap();
        let b = side.join("b").to_string_lossy().to_string();
        let hidden = |store: &Store| list_workspaces(&git, store, &project).unwrap().into_iter().filter(|w| w.hidden).map(|w| w.branch.unwrap()).collect::<Vec<_>>();
        set_hidden(&store, &b, true).unwrap();
        set_hidden(&store, &project.path, true).unwrap();
        assert_eq!(hidden(&store), vec!["b".to_string()]);
        set_hidden(&store, &b, false).unwrap();
        assert!(hidden(&store).is_empty());
        drop(store);
        for d in [profile, repo, side, root] {
            let _ = fs::remove_dir_all(d);
        }
    }

    #[test]
    fn sess037_the_advanced_branch_name_wins_and_the_typed_name_stays_the_label() {
        let git = Git::detect().unwrap();
        let profile = temp("profile-sess037");
        let store = Store::open(&profile).unwrap();
        let repo = temp_repo("repo-sess037");
        let root = temp("root-sess037");
        let mut settings = store.settings();
        settings["branchPrefix"] = serde_json::json!("none");
        settings[WORKSPACES_DIR_SETTING] = serde_json::json!(root.to_string_lossy());
        store.save_settings(&settings).unwrap();
        let project = add_project(&git, &store, &repo).unwrap();
        let store = Mutex::new(store);
        let made = create_named(&git, &store, &project.id, "Fix login", None, Some("feat/x")).unwrap().worktree;
        assert_eq!(made.branch.as_deref(), Some("feat-x"));
        assert_eq!(made.name.as_deref(), Some("Fix login"));
        let plain = create_named(&git, &store, &project.id, "Fix login", None, None).unwrap().worktree;
        assert_eq!(plain.branch.as_deref(), Some("fix-login"));
        assert_eq!(plain.name.as_deref(), Some("Fix login"));
    }

    #[test]
    fn create_and_remove_workspace_through_the_project() {
        let git = Git::detect().unwrap();
        let profile = temp("profile2");
        let store = Store::open(&profile).unwrap();
        let repo = temp_repo("repo2");
        let root = temp("root2");
        let project = add_project(&git, &store, &repo).unwrap();
        let place = nested(&root);

        // SESS-036: a name that cleans up to nothing becomes "workspace".
        let blank = create_workspace(&git, &place, &project, "???", None).unwrap().worktree;
        assert_eq!(blank.branch.as_deref(), Some("workspace"));
        let wt = create_workspace(&git, &place, &project, "Fix login \u{1F525}", None).unwrap().worktree;
        assert_eq!(wt.branch.as_deref(), Some("fix-login-fire"));
        let expected = workspace_path(&place, &project, "fix-login-fire");
        assert!(expected.join("a.txt").is_file());
        let again = create_workspace(&git, &place, &project, "fix login fire", None).unwrap().worktree;
        assert_eq!(again.branch.as_deref(), Some("fix-login-fire-2"), "a taken name gets a number");
        git_in(&repo, &["update-ref", "refs/remotes/origin/fix-login-fire-3", "HEAD"]);
        let third = create_workspace(&git, &place, &project, "fix login fire", None).unwrap().worktree;
        assert_eq!(third.branch.as_deref(), Some("fix-login-fire-4"), "a name on a remote counts as taken");
        set_name(&store, &wt.path, Some("Fix login \u{1F525}")).unwrap();
        let listed = list_workspaces(&git, &store, &project).unwrap();
        assert_eq!(listed.iter().find(|w| w.path == wt.path).unwrap().name.as_deref(), Some("Fix login \u{1F525}"), "the typed name is shown");
        assert_eq!(listed.iter().find(|w| w.path == again.path).unwrap().name, None);
        // PROJ-047: a workspace made from another one is listed with that parent, and removing it
        // forgets the link so a later workspace in the same folder starts at the top level.
        set_parent(&store, &third.path, Some(&wt.path)).unwrap();
        let listed = list_workspaces(&git, &store, &project).unwrap();
        assert_eq!(listed.iter().find(|w| w.path == third.path).unwrap().parent.as_deref(), Some(wt.path.as_str()));
        assert_eq!(listed.iter().find(|w| w.path == again.path).unwrap().parent, None);
        for w in [&again, &third] {
            remove_workspace(&git, &project, &w.path, false).unwrap();
            forget_workspace(&store, &w.path).unwrap();
        }
        assert!(store.get("workspaceParents").unwrap().unwrap() == "{}");

        assert!(remove_workspace(&git, &project, &project.path, false).unwrap_err().contains("main checkout"));
        remove_workspace(&git, &project, &wt.path, false).unwrap();
        assert!(!expected.exists());
        assert!(!git.branch_taken(&repo, "fix-login-fire"));
        drop(store);
        for d in [profile, repo, root] {
            fs::remove_dir_all(d).unwrap();
        }
    }

    #[test]
    fn a_fresh_workspace_gets_a_creature_name_that_is_not_in_use() {
        let git = Git::detect().unwrap();
        let profile = temp("profile4");
        let store = Store::open(&profile).unwrap();
        let repo = temp_repo("repo4");
        let root = temp("root4");
        let project = add_project(&git, &store, &repo).unwrap();
        let projects = load_projects(&store);

        let first = create_fresh_workspace(&git, &store, &nested(&root), &projects, &project, None).unwrap();
        let second = create_fresh_workspace(&git, &store, &nested(&root), &projects, &project, None).unwrap();
        let name_of = |w: &Worktree| Path::new(&w.path).file_name().unwrap().to_string_lossy().to_string();
        assert_ne!(name_of(&first), name_of(&second), "two launches never share a name");
        for w in [&first, &second] {
            let name = name_of(w);
            assert!(name.split('-').count() == 2, "adjective-creature: {name}");
            assert_eq!(w.branch.as_deref(), Some(name.as_str()), "the branch carries the same name");
            assert!(Path::new(&w.path).join("a.txt").is_file(), "a real checkout");
        }
        let in_use = names_in_use(&git, &projects);
        assert!(in_use.contains(&name_of(&first)) && in_use.contains(&name_of(&second)));
        // SESS-023: a retired name never comes back, even from the same seed.
        remove_workspace(&git, &project, &first.path, false).unwrap();
        assert!(!names_in_use(&git, &projects).contains(&name_of(&first)));
        for seed in [0u64, 7, 4242] {
            assert_ne!(fresh_name(&git, &store, &projects, seed), name_of(&first), "seed {seed}");
        }
        let x = fresh_name(&git, &store, &projects, 0);
        remember_retired(&store, &x).unwrap();
        assert_ne!(fresh_name(&git, &store, &projects, 0), x);

        drop(store);
        for d in [profile, repo, root] {
            fs::remove_dir_all(d).unwrap();
        }
    }

    #[test]
    fn new_workspaces_bring_listed_files_along_and_removal_refuses_dirty_work_unless_forced() {
        let git = Git::detect().unwrap();
        let profile = temp("profile8");
        let store = Store::open(&profile).unwrap();
        let repo = temp_repo("repo8");
        fs::write(repo.join(".gitignore"), ".env\nnode_modules/\n").unwrap();
        fs::write(repo.join("tracked.txt"), "committed\n").unwrap();
        fs::write(repo.join(".worktreeinclude"), "# bring these\n.env\n*.log\nmissing.txt\ntracked.txt\n").unwrap();
        fs::write(repo.join("kolux.yaml"), "worktree:\n  sharedDirectories:\n    - node_modules/\n    - src\n    - ../out\n").unwrap();
        fs::create_dir_all(repo.join("src")).unwrap();
        fs::write(repo.join("src").join("a.txt"), "a").unwrap();
        git_in(&repo, &["add", "."]);
        git_in(&repo, &["commit", "-q", "-m", "setup"]);
        fs::write(repo.join(".env"), "SECRET=1\n").unwrap();
        fs::write(repo.join("tracked.txt"), "edited in main\n").unwrap();
        let project = add_project(&git, &store, &repo).unwrap();
        let place = Place { root: temp("ws8"), flat: true, prefix: String::new(), prefix_warning: None };

        let made = create_workspace(&git, &place, &project, "feat", None).unwrap();
        let dest = PathBuf::from(&made.worktree.path);
        assert_eq!(fs::read_to_string(dest.join(".env")).unwrap(), "SECRET=1\n", "the ignored file came along");
        assert_eq!(fs::read_to_string(dest.join("tracked.txt")).unwrap().trim_end(), "committed", "a tracked file is never copied over (the checkout may add CR)");
        assert_eq!(made.warnings.len(), 3, "{:?}", made.warnings);
        assert!(made.warnings[0].contains("`*.log`") && made.warnings[1].contains("`missing.txt`") && made.warnings[2].contains("`src` is not git-ignored"), "{:?}", made.warnings);
        // the shared folder is one folder seen from both places
        fs::write(repo.join("node_modules").join("dep.js"), "1").unwrap();
        assert_eq!(fs::read_to_string(dest.join("node_modules").join("dep.js")).unwrap(), "1");
        assert!(!dest.join("out").exists());
        let status = Command::new("git").args(["status", "--porcelain"]).current_dir(&dest).output().unwrap().stdout;
        assert!(!git.dirty(&dest).unwrap(), "linked and copied files are ignored, so the worktree starts clean: {}", String::from_utf8_lossy(&status));

        fs::write(dest.join("work.txt"), "unsaved").unwrap();
        let err = remove_workspace(&git, &project, &made.worktree.path, false).unwrap_err();
        assert!(err.contains("feat has uncommitted changes"), "{err}");
        assert!(dest.join("work.txt").is_file(), "nothing was lost");
        remove_workspace(&git, &project, &made.worktree.path, true).unwrap();
        assert!(!dest.exists() && !git.branch_taken(&repo, "feat"));
        assert!(repo.join("node_modules").join("dep.js").is_file(), "removing the link left the shared folder alone");

        drop(store);
        for d in [profile, repo, place.root] {
            fs::remove_dir_all(d).unwrap();
        }
    }

    #[test]
    fn a_picked_worktree_is_added_itself_and_scratch_worktrees_stay_hidden() {
        let git = Git::detect().unwrap();
        let profile = temp("profile5");
        let store = Store::open(&profile).unwrap();
        let repo = temp_repo("repo5");
        let side = temp("side5");
        let zeta = side.join("zeta");
        git.worktree_add(&repo, &zeta, "zeta", "HEAD").unwrap();
        let scratch = repo.join(".claude").join("worktrees").join("scratch");
        git.worktree_add(&repo, &scratch, "scratch", "HEAD").unwrap();

        let project = add_project(&git, &store, &zeta).unwrap();
        assert!(same_folder(Path::new(&project.path), &zeta), "PROJ-006: A not added, so the picked worktree folder itself is the project: {}", project.path);
        crate::visibility::set_choice(&store, None, "other", Some(true)).unwrap();
        let names: Vec<_> = list_workspaces(&git, &store, &project).unwrap().into_iter().filter(|w| !w.hidden).map(|w| (w.branch.unwrap_or_default(), w.is_main)).collect();
        assert_eq!(names, vec![("main".to_string(), true), ("zeta".to_string(), false)], "Claude Code's scratch worktree stays hidden");

        drop(store);
        git.worktree_remove(&repo, &scratch, Some("scratch")).unwrap();
        git.worktree_remove(&repo, &zeta, Some("zeta")).unwrap();
        for d in [profile, repo, side] {
            fs::remove_dir_all(d).unwrap();
        }
    }

    #[test]
    fn workspaces_live_where_the_project_or_the_layout_says() {
        let git = Git::detect().unwrap();
        let profile = temp("profile6");
        let store = Store::open(&profile).unwrap();
        let outer = temp("repo6");
        let repo = outer.join("app.git");
        init_repo(&repo);
        let mut project = add_project(&git, &store, &repo).unwrap();
        // the default: the global folder, nested under the project's name without its .git ending
        let place = place_for(&store, &project);
        assert!(!place.flat);
        assert_eq!(workspace_path(&place, &project, "x"), workspaces_dir(&store).join("app").join("x"));
        // a folder set for one project wins, a relative one resolved from the project root
        project.workspaces_dir = Some("ws".into());
        let place = place_for(&store, &project);
        assert_eq!(workspace_path(&place, &project, "x"), repo.join("ws").join("app").join("x"));
        // the flat layout puts every workspace side by side
        let mut settings = store.settings();
        settings[LAYOUT_SETTING] = "flat".into();
        store.save_settings(&settings).unwrap();
        let place = place_for(&store, &project);
        assert!(place.flat);
        assert_eq!(workspace_path(&place, &project, "x"), repo.join("ws").join("x"));
        let made = create_workspace(&git, &place, &project, "x", None).unwrap();
        assert!(same_folder(Path::new(&made.worktree.path), &repo.join("ws").join("x")), "{}", made.worktree.path);
        remove_workspace(&git, &project, &made.worktree.path, false).unwrap();
        // folders used before are remembered, newest first, once each
        remember_dir(&store, "D:\\one").unwrap();
        remember_dir(&store, "D:\\two").unwrap();
        remember_dir(&store, "D:\\one").unwrap();
        assert_eq!(used_dirs(&store), vec!["D:\\one".to_string(), "D:\\two".to_string()]);
        drop(store);
        for d in [profile, outer] {
            fs::remove_dir_all(d).unwrap();
        }
    }

    #[test]
    fn a_workspace_starts_from_the_chosen_ref_then_the_saved_base_then_the_default() {
        let git = Git::detect().unwrap();
        let profile = temp("profile7");
        let store = Store::open(&profile).unwrap();
        let repo = temp_repo("repo7");
        let root = temp("root7");
        let mut project = add_project(&git, &store, &repo).unwrap();
        let first = rev(&repo, "HEAD");
        git_in(&repo, &["checkout", "-q", "-b", "dev"]);
        fs::write(repo.join("b.txt"), "b").unwrap();
        git_in(&repo, &["add", "."]);
        git_in(&repo, &["commit", "-q", "-m", "second"]);
        let second = rev(&repo, "HEAD");
        git_in(&repo, &["checkout", "-q", "main"]);
        let place = nested(&root);

        // nothing chosen, nothing saved: the default branch
        assert_eq!(resolve_base(&git, &repo, &project, None).unwrap(), ("main".to_string(), None));
        // chosen for this one workspace: a branch, or a full commit id used as is
        assert_eq!(resolve_base(&git, &repo, &project, Some("dev")).unwrap().0, "dev");
        assert_eq!(resolve_base(&git, &repo, &project, Some(&second)).unwrap().0, second);
        assert!(resolve_base(&git, &repo, &project, Some("nope")).unwrap_err().contains("not a branch, tag or commit"));
        // the project's saved base, then the fallback with a note once it is gone
        project.base = Some("dev".into());
        assert_eq!(resolve_base(&git, &repo, &project, None).unwrap(), ("dev".to_string(), None));
        project.base = Some("gone".into());
        let (base, note) = resolve_base(&git, &repo, &project, None).unwrap();
        assert_eq!(base, "main");
        assert!(note.as_deref().is_some_and(|n| n.contains("gone") && n.contains("main")), "{note:?}");
        // and the checkout really begins there
        let made = create_workspace(&git, &place, &project, "from dev", Some("dev")).unwrap();
        assert_eq!((made.base.as_str(), made.note.as_deref()), ("dev", None));
        assert_eq!(rev(Path::new(&made.worktree.path), "HEAD"), second);
        let fallen = create_workspace(&git, &place, &project, "from saved", None).unwrap();
        assert_eq!(rev(Path::new(&fallen.worktree.path), "HEAD"), first);
        assert!(fallen.note.is_some());
        for m in [&made, &fallen] {
            remove_workspace(&git, &project, &m.worktree.path, false).unwrap();
        }
        drop(store);
        for d in [profile, repo, root] {
            fs::remove_dir_all(d).unwrap();
        }
    }

    #[test]
    fn workspaces_dir_setting_falls_back_to_default() {
        let profile = temp("profile3");
        let store = Store::open(&profile).unwrap();
        assert_eq!(workspaces_dir(&store), default_workspaces_dir());
        store.save_settings(&serde_json::json!({ "workspacesDir": "D:\\ws" })).unwrap();
        assert_eq!(workspaces_dir(&store), PathBuf::from("D:\\ws"));
        store.save_settings(&serde_json::json!({ "workspacesDir": "  " })).unwrap();
        assert_eq!(workspaces_dir(&store), default_workspaces_dir());
        drop(store);
        fs::remove_dir_all(profile).unwrap();
    }

    #[test]
    fn env_var_moves_the_default_but_a_setting_still_wins() {
        // PROJ-026 / SET-032: KOLUX_WORKSPACES_DIR is trimmed, ignored when blank, and only
        // replaces the default, never a folder the user saved.
        assert_eq!(resolve_workspaces_dir(Some("  D:\\wt  "), None), PathBuf::from("D:\\wt"));
        assert_eq!(resolve_workspaces_dir(Some("   "), None), default_workspaces_dir());
        assert_eq!(resolve_workspaces_dir(None, None), default_workspaces_dir());
        assert_eq!(resolve_workspaces_dir(Some("D:\\wt"), Some("E:\\mine")), PathBuf::from("E:\\mine"));
        assert_eq!(resolve_workspaces_dir(Some("D:\\wt"), Some(" ")), PathBuf::from("D:\\wt"));
    }

    #[test]
    fn saving_a_folder_that_cannot_be_made_fails_and_keeps_the_old_one() {
        let profile = temp("profile-place");
        let store = Store::open(&profile).unwrap();
        let bad = profile.join("file-not-folder");
        fs::write(&bad, "x").unwrap();
        let err = set_place(&store, &bad.join("ws").display().to_string(), false).unwrap_err();
        assert!(err.contains("cannot be made"), "{err}");
        assert_eq!(store.settings()[WORKSPACES_DIR_SETTING], serde_json::Value::Null, "the failed folder is not saved");
        assert!(used_dirs(&store).is_empty(), "nor remembered");
        let good = profile.join("ws").join("deep");
        let info = set_place(&store, &good.display().to_string(), true).unwrap();
        assert!(good.is_dir() && info.flat && info.dir == good.display().to_string() && info.used == vec![good.display().to_string()]);
        drop(store);
        fs::remove_dir_all(profile).unwrap();
    }
}
