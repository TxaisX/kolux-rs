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

/// Registers the repository that holds `path`; an already-registered one is handed back, not
/// added again. New projects go first (the Recent order).
pub fn add_project(git: &Git, store: &Store, path: &Path) -> Result<Project, String> {
    let top = git.toplevel(path)?;
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
    let safe = safe_name(typed_name).ok_or_else(|| format!("\"{}\" leaves nothing usable for a branch name; use some letters or digits", typed_name.trim()))?;
    let dest = workspace_path(root, project, &safe);
    if dest.exists() {
        return Err(format!("the folder {} already exists", dest.display()));
    }
    let repo = Path::new(&project.path);
    if git.branch_exists(repo, &safe) {
        return Err(format!("a branch named {safe} already exists in {}", project.name));
    }
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
    git.worktrees(Path::new(&project.path))
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
    create_workspace(&git, &root, &project, &name)
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
    remove_workspace(&git, &project, &path)
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
        assert!(create_workspace(&git, &root, &project, "fix login fire").unwrap_err().contains("already exists"));

        assert!(remove_workspace(&git, &project, &project.path).unwrap_err().contains("main checkout"));
        remove_workspace(&git, &project, &wt.path).unwrap();
        assert!(!expected.exists());
        assert!(!git.branch_exists(&repo, "fix-login-fire"));
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
