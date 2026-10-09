//! Projects and workspaces (PROJ-001, PROJ-007, PROJ-020, PROJ-021, PROJ-025). A project is a
//! Git repository the user chose; a workspace is one of its worktrees. Projects are saved in the
//! state store; the workspaces folder is a user setting.

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
}

const PROJECTS_KEY: &str = "projects";
/// Typed workspace names by folder (PROJ-021): the branch and folder carry the cleaned form,
/// the row shows exactly what was typed.
const NAMES_KEY: &str = "workspaceNames";
const WORKSPACES_DIR_SETTING: &str = "workspacesDir";

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

/// The workspaces of a project as the sidebar lists them (PROJ-007): Git's list with the typed
/// names laid over, minus scratch worktrees a coding tool keeps for its own sub-agents, which
/// live under a dot-folder inside the main checkout (Claude Code's `.claude/worktrees/`).
pub fn list_workspaces(git: &Git, store: &Store, project: &Project) -> Result<Vec<Worktree>, String> {
    let names = load_names(store);
    let main = Path::new(&project.path);
    Ok(git
        .worktrees(main)?
        .into_iter()
        .filter(|w| !Path::new(&w.path).strip_prefix(main).is_ok_and(|rel| rel.components().any(|c| c.as_os_str().to_string_lossy().starts_with('.'))))
        .map(|mut w| {
            w.name = names.get(&name_key(&w.path)).and_then(|v| v.as_str()).map(String::from);
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

/// Where a new workspace of `project` named `safe` lives: `<root>\<project>\<safe>` (nested layout).
pub fn workspace_path(root: &Path, project: &Project, safe: &str) -> PathBuf {
    root.join(&project.name).join(safe)
}

pub fn create_workspace(git: &Git, root: &Path, project: &Project, typed_name: &str) -> Result<Worktree, String> {
    let base = safe_name(typed_name).ok_or_else(|| format!("\"{}\" leaves nothing usable for a branch name; use some letters or digits", typed_name.trim()))?;
    let repo = Path::new(&project.path);
    // PROJ-021: a name taken by a branch (local or on a remote) or a folder gets a number.
    let (safe, dest) = (1..)
        .map(|n| if n == 1 { base.clone() } else { format!("{base}-{n}") })
        .map(|s| {
            let d = workspace_path(root, project, &s);
            (s, d)
        })
        .find(|(s, d)| !d.exists() && !git.branch_taken(repo, s))
        .ok_or("no free name")?;
    if let Some(parent) = dest.parent() {
        std::fs::create_dir_all(parent).map_err(|e| format!("could not create {}: {e}", parent.display()))?;
    }
    git.worktree_add(repo, &dest, &safe, "HEAD")?;
    git.worktrees(repo)?
        .into_iter()
        .find(|w| same_folder(Path::new(&w.path), &dest))
        .ok_or_else(|| "the worktree was created but Git does not list it".to_string())
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

/// A workspace an agent launch makes for itself: a creature name nobody uses, branched from the
/// main checkout. The clock seeds the pick so launches do not always start at the same pair.
pub fn create_fresh_workspace(git: &Git, root: &Path, projects: &[Project], project: &Project) -> Result<Worktree, String> {
    let taken = names_in_use(git, projects);
    let seed = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0);
    let name = creature_name(&taken, seed);
    create_workspace(git, root, project, &name)
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

#[tauri::command]
pub fn workspace_preview(name: String) -> Option<String> {
    safe_name(&name)
}

#[tauri::command]
pub fn workspace_create(git: State<'_, Git>, store: StoreState<'_>, project_id: String, name: String) -> Result<Worktree, String> {
    let (project, root) = {
        let store = store.lock().map_err(|e| e.to_string())?;
        (find_project(&store, &project_id)?, workspaces_dir(&store))
    };
    let mut wt = create_workspace(&git, &root, &project, &name)?;
    let typed = name.trim();
    if typed != wt.branch.as_deref().unwrap_or_default() {
        let store = store.lock().map_err(|e| e.to_string())?;
        set_name(&store, &wt.path, Some(typed))?;
        wt.name = Some(typed.to_string());
    }
    Ok(wt)
}

#[tauri::command]
pub fn workspace_create_fresh(git: State<'_, Git>, store: StoreState<'_>, project_id: String) -> Result<Worktree, String> {
    let (projects, project, root) = {
        let store = store.lock().map_err(|e| e.to_string())?;
        (load_projects(&store), find_project(&store, &project_id)?, workspaces_dir(&store))
    };
    create_fresh_workspace(&git, &root, &projects, &project)
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
    set_name(&store, &path, None)
}

#[tauri::command]
pub fn workspaces_dir_get(store: StoreState<'_>) -> Result<String, String> {
    let store = store.lock().map_err(|e| e.to_string())?;
    Ok(workspaces_dir(&store).display().to_string())
}

#[tauri::command]
pub fn workspaces_dir_set(store: StoreState<'_>, path: String) -> Result<String, String> {
    let store = store.lock().map_err(|e| e.to_string())?;
    let mut settings = store.settings();
    let trimmed = path.trim();
    if trimmed.is_empty() {
        settings.as_object_mut().map(|o| o.remove(WORKSPACES_DIR_SETTING));
    } else {
        settings[WORKSPACES_DIR_SETTING] = serde_json::Value::String(trimmed.to_string());
    }
    store.save_settings(&settings).map_err(|e| e.to_string())?;
    Ok(workspaces_dir(&store).display().to_string())
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
        git_in(&dir, &["init", "-q", "-b", "main"]);
        git_in(&dir, &["config", "user.email", "t@example.com"]);
        git_in(&dir, &["config", "user.name", "t"]);
        fs::write(dir.join("a.txt"), "a").unwrap();
        git_in(&dir, &["add", "."]);
        git_in(&dir, &["commit", "-q", "-m", "first"]);
        dir
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

        assert!(create_workspace(&git, &root, &project, "???").unwrap_err().contains("nothing usable"));
        let wt = create_workspace(&git, &root, &project, "Fix login \u{1F525}").unwrap();
        assert_eq!(wt.branch.as_deref(), Some("fix-login-fire"));
        let expected = workspace_path(&root, &project, "fix-login-fire");
        assert!(expected.join("a.txt").is_file());
        let again = create_workspace(&git, &root, &project, "fix login fire").unwrap();
        assert_eq!(again.branch.as_deref(), Some("fix-login-fire-2"), "a taken name gets a number");
        git_in(&repo, &["update-ref", "refs/remotes/origin/fix-login-fire-3", "HEAD"]);
        let third = create_workspace(&git, &root, &project, "fix login fire").unwrap();
        assert_eq!(third.branch.as_deref(), Some("fix-login-fire-4"), "a name on a remote counts as taken");
        set_name(&store, &wt.path, Some("Fix login \u{1F525}")).unwrap();
        let listed = list_workspaces(&git, &store, &project).unwrap();
        assert_eq!(listed.iter().find(|w| w.path == wt.path).unwrap().name.as_deref(), Some("Fix login \u{1F525}"), "the typed name is shown");
        assert_eq!(listed.iter().find(|w| w.path == again.path).unwrap().name, None);
        for w in [&again, &third] {
            remove_workspace(&git, &project, &w.path).unwrap();
        }

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

        let first = create_fresh_workspace(&git, &root, &projects, &project).unwrap();
        let second = create_fresh_workspace(&git, &root, &projects, &project).unwrap();
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
