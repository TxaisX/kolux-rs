//! Projects and workspaces (PROJ-001, PROJ-007, PROJ-020, PROJ-021, PROJ-025, PROJ-028). A
//! project is a Git repository the user chose; a workspace is one of its worktrees. Projects are
//! saved in the state store; the workspaces folder and layout are user settings, and a project
//! may carry its own folder and base ref. The command line (PROJ-077) creates and removes
//! workspaces through the same functions.

use crate::creatures::creature_name;
use crate::git::{Git, Worktree};
use crate::names::safe_name;
use crate::state::Store;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
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
}

/// Where a project's workspaces go and how they are laid out (PROJ-025).
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Place {
    pub root: PathBuf,
    /// Flat: every workspace straight under the root; nested: under a folder named after the project.
    pub flat: bool,
}

const PROJECTS_KEY: &str = "projects";
/// Typed workspace names by folder (PROJ-021): the branch and folder carry the cleaned form,
/// the row shows exactly what was typed.
const NAMES_KEY: &str = "workspaceNames";
/// Child workspace path (as `name_key` writes it) to its parent's path (PROJ-047).
const PARENTS_KEY: &str = "workspaceParents";
const WORKSPACES_DIR_SETTING: &str = "workspacesDir";
/// "nested" (the default) or "flat" (PROJ-025).
const LAYOUT_SETTING: &str = "workspacesLayout";
/// Workspaces folders used before, newest first, so they can be picked again (PROJ-025).
const USED_DIRS_SETTING: &str = "workspacesDirsUsed";

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

fn name_key(path: &str) -> String {
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
/// clean: its typed name and its parent.
pub fn forget_workspace(store: &Store, path: &str) -> Result<(), String> {
    set_name(store, path, None)?;
    set_parent(store, path, None)
}

/// The workspaces of a project as the sidebar lists them (PROJ-007): Git's list with the typed
/// names and parents laid over, minus scratch worktrees a coding tool keeps for its own sub-agents, which
/// live under a dot-folder inside the main checkout (Claude Code's `.claude/worktrees/`).
pub fn list_workspaces(git: &Git, store: &Store, project: &Project) -> Result<Vec<Worktree>, String> {
    let names = load_names(store);
    let parents: serde_json::Map<String, serde_json::Value> = store.get(PARENTS_KEY).ok().flatten().and_then(|s| serde_json::from_str(&s).ok()).unwrap_or_default();
    let main = Path::new(&project.path);
    Ok(git
        .worktrees(main)?
        .into_iter()
        .filter(|w| !Path::new(&w.path).strip_prefix(main).is_ok_and(|rel| rel.components().any(|c| c.as_os_str().to_string_lossy().starts_with('.'))))
        .map(|mut w| {
            w.name = names.get(&name_key(&w.path)).and_then(|v| v.as_str()).map(String::from);
            w.parent = parents.get(&name_key(&w.path)).and_then(|v| v.as_str()).map(String::from);
            w
        })
        .collect())
}

/// Registers the repository that holds `path`; an already-registered one is handed back, not
/// added again. New projects go first (the Recent order). The project's folder is the main
/// checkout, whichever of its worktrees was picked (PROJ-007: chosen on purpose, never the
/// first one listed by chance; Git lists the main checkout first).
pub fn add_project(git: &Git, store: &Store, path: &Path) -> Result<Project, String> {
    let picked = git.toplevel(path)?;
    let top = git.worktrees(&picked)?.into_iter().find(|w| w.is_main).map(|w| PathBuf::from(w.path)).unwrap_or(picked);
    let mut projects = load_projects(store);
    if let Some(existing) = projects.iter().find(|p| same_folder(Path::new(&p.path), &top)) {
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

pub fn workspaces_dir(store: &Store) -> PathBuf {
    store.settings()[WORKSPACES_DIR_SETTING].as_str().filter(|s| !s.trim().is_empty()).map(PathBuf::from).unwrap_or_else(default_workspaces_dir)
}

/// The folder and layout for `project`'s workspaces (PROJ-025): the project's own folder when it
/// has one, else the global setting, else the default; a relative folder counts from the
/// project root (joining an absolute one leaves it as it is).
pub fn place_for(store: &Store, project: &Project) -> Place {
    let own = project.workspaces_dir.as_deref().map(str::trim).filter(|s| !s.is_empty()).map(PathBuf::from);
    Place { root: Path::new(&project.path).join(own.unwrap_or_else(|| workspaces_dir(store))), flat: store.settings()[LAYOUT_SETTING].as_str() == Some("flat") }
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
    let base = safe_name(typed_name).ok_or_else(|| format!("\"{}\" leaves nothing usable for a branch name; use some letters or digits", typed_name.trim()))?;
    let repo = Path::new(&project.path);
    let (from, note) = resolve_base(git, repo, project, start)?;
    // PROJ-021: a name taken by a branch (local or on a remote) or a folder gets a number.
    let (safe, dest) = (1..)
        .map(|n| if n == 1 { base.clone() } else { format!("{base}-{n}") })
        .map(|s| {
            let d = workspace_path(place, project, &s);
            (s, d)
        })
        .find(|(s, d)| !d.exists() && !git.branch_taken(repo, s))
        .ok_or("no free name")?;
    if let Some(parent) = dest.parent() {
        std::fs::create_dir_all(parent).map_err(|e| format!("could not create {}: {e}", parent.display()))?;
    }
    git.worktree_add(repo, &dest, &safe, &from)?;
    let worktree = git
        .worktrees(repo)?
        .into_iter()
        .find(|w| same_folder(Path::new(&w.path), &dest))
        .ok_or_else(|| "the worktree was created but Git does not list it".to_string())?;
    Ok(Created { worktree, base: from, note })
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
    create_workspace(git, place, project, &name, base).map(|c| c.worktree)
}

pub fn remove_workspace(git: &Git, project: &Project, worktree_path: &str) -> Result<(), String> {
    let repo = Path::new(&project.path);
    let target = git.worktrees(repo)?.into_iter().find(|w| same_folder(Path::new(&w.path), Path::new(worktree_path))).ok_or_else(|| format!("{worktree_path} is not a worktree of {}", project.name))?;
    if target.is_main {
        return Err("the main checkout cannot be removed; remove the project instead".to_string());
    }
    git.worktree_remove(repo, Path::new(&target.path), target.branch.as_deref())
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

#[tauri::command]
pub fn workspace_list(git: State<'_, Git>, store: StoreState<'_>, project_id: String) -> Result<Vec<Worktree>, String> {
    let store = store.lock().map_err(|e| e.to_string())?;
    let project = find_project(&store, &project_id)?;
    list_workspaces(&git, &store, &project)
}

/// What a typed name becomes (PROJ-021 / PROJ-025): the branch, and the folder it would get in
/// the project; none when the name has nothing usable.
#[derive(serde::Serialize)]
pub struct Preview {
    pub branch: String,
    pub folder: String,
}

#[tauri::command]
pub fn workspace_preview(store: StoreState<'_>, name: String, project_id: Option<String>) -> Result<Option<Preview>, String> {
    let Some(branch) = safe_name(&name) else { return Ok(None) };
    let store = store.lock().map_err(|e| e.to_string())?;
    let folder = match project_id.filter(|id| !id.is_empty()) {
        Some(id) => {
            let project = find_project(&store, &id)?;
            workspace_path(&place_for(&store, &project), &project, &branch).display().to_string()
        }
        None => String::new(),
    };
    Ok(Some(Preview { branch, folder }))
}

/// Makes a workspace in a registered project and keeps the typed name (the sidebar's Create and
/// `kolux-dev worktree create` both come through here).
pub fn create_named(git: &Git, store: &Mutex<Store>, project_id: &str, name: &str, base: Option<&str>) -> Result<Created, String> {
    let (project, place) = {
        let store = store.lock().map_err(|e| e.to_string())?;
        let project = find_project(&store, project_id)?;
        let place = place_for(&store, &project);
        (project, place)
    };
    let mut made = create_workspace(git, &place, &project, name, base)?;
    let typed = name.trim();
    if typed != made.worktree.branch.as_deref().unwrap_or_default() {
        let store = store.lock().map_err(|e| e.to_string())?;
        set_name(&store, &made.worktree.path, Some(typed))?;
        made.worktree.name = Some(typed.to_string());
    }
    Ok(made)
}

#[tauri::command]
pub fn workspace_create(git: State<'_, Git>, store: StoreState<'_>, project_id: String, name: String, base: Option<String>) -> Result<Created, String> {
    create_named(&git, &store, &project_id, &name, base.as_deref())
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
pub fn workspace_remove(git: State<'_, Git>, store: StoreState<'_>, terminals: State<'_, crate::terminal::Terminals>, project_id: String, path: String) -> Result<(), String> {
    let project = {
        let store = store.lock().map_err(|e| e.to_string())?;
        find_project(&store, &project_id)?
    };
    // A shell still sitting in the folder would keep Windows from deleting it.
    terminals.kill_under(Path::new(&path));
    remove_workspace(&git, &project, &path)?;
    let store = store.lock().map_err(|e| e.to_string())?;
    forget_workspace(&store, &path)
}

/// The global workspaces settings as the sidebar shows them (PROJ-025).
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PlaceInfo {
    /// The folder in use (the default when nothing is set).
    pub dir: String,
    pub flat: bool,
    pub used: Vec<String>,
}

fn place_info(store: &Store) -> PlaceInfo {
    PlaceInfo { dir: workspaces_dir(store).display().to_string(), flat: store.settings()[LAYOUT_SETTING].as_str() == Some("flat"), used: used_dirs(store) }
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
    let mut settings = store.settings();
    let trimmed = dir.trim();
    if trimmed.is_empty() {
        settings.as_object_mut().map(|o| o.remove(WORKSPACES_DIR_SETTING));
    } else {
        settings[WORKSPACES_DIR_SETTING] = serde_json::Value::String(trimmed.to_string());
    }
    settings[LAYOUT_SETTING] = serde_json::Value::String(if flat { "flat" } else { "nested" }.to_string());
    store.save_settings(&settings).map_err(|e| e.to_string())?;
    remember_dir(&store, trimmed)?;
    Ok(place_info(&store))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
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
        Place { root: root.to_path_buf(), flat: false }
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
    fn create_and_remove_workspace_through_the_project() {
        let git = Git::detect().unwrap();
        let profile = temp("profile2");
        let store = Store::open(&profile).unwrap();
        let repo = temp_repo("repo2");
        let root = temp("root2");
        let project = add_project(&git, &store, &repo).unwrap();
        let place = nested(&root);

        assert!(create_workspace(&git, &place, &project, "???", None).unwrap_err().contains("nothing usable"));
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
            remove_workspace(&git, &project, &w.path).unwrap();
            forget_workspace(&store, &w.path).unwrap();
        }
        assert!(store.get("workspaceParents").unwrap().unwrap() == "{}");

        assert!(remove_workspace(&git, &project, &project.path).unwrap_err().contains("main checkout"));
        remove_workspace(&git, &project, &wt.path).unwrap();
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
        remove_workspace(&git, &project, &first.path).unwrap();
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
    fn a_picked_worktree_registers_its_main_checkout_and_scratch_worktrees_stay_hidden() {
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
        assert!(same_folder(Path::new(&project.path), &repo), "picked a linked worktree, got the main checkout: {}", project.path);
        let names: Vec<_> = list_workspaces(&git, &store, &project).unwrap().into_iter().map(|w| (w.branch.unwrap_or_default(), w.is_main)).collect();
        assert_eq!(names, vec![("main".to_string(), true), ("zeta".to_string(), false)], "a tool's scratch worktree is not listed");

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
        remove_workspace(&git, &project, &made.worktree.path).unwrap();
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
            remove_workspace(&git, &project, &m.worktree.path).unwrap();
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
}
