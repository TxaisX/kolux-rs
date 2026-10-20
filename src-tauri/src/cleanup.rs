//! Workspace cleanup (ACCT-056, PROJ-080). Cleanup offers and removes only the workspaces Kolux
//! can show it made, by the origin record it keeps for each workspace it creates. A worktree
//! another tool made (Claude Code, a hand-run `git worktree add`) is never offered and never
//! removed here, even when the page asks for it by path. Nothing here forces: a workspace with
//! changes, a lock or another worktree inside it is left in place with the reason.

use crate::git::{Git, Worktree};
use crate::projects::{find_project, kolux_made, load_origins, name_key, remove_check, remove_now, Project};
use crate::state::Store;
use std::path::Path;
use std::sync::Mutex;
use tauri::State;

type Origins = serde_json::Map<String, serde_json::Value>;

/// ACCT-056: the worktrees among `all` the dialog may offer: never the main checkout, and only
/// those with an origin record (the same test the launch sweep uses).
// T-162: the scan on the dialog lists what this returns; until it lands only the tests call it.
#[cfg_attr(not(test), allow(dead_code))]
pub fn offerable(origins: &Origins, all: Vec<Worktree>) -> Vec<Worktree> {
    kolux_made(origins, all.into_iter().filter(|w| !w.is_main).collect())
}

/// Why cleanup must leave `path` in place, or `None` when Kolux can show it made it.
pub fn left_in_place(origins: &Origins, all: &[Worktree], path: &str) -> Option<String> {
    let Some(w) = all.iter().find(|w| name_key(&w.path) == name_key(path)) else {
        return Some("This is not a workspace of this project, so cleanup leaves it alone.".into());
    };
    if w.is_main {
        return Some("The main checkout is never cleaned up. Remove the project instead.".into());
    }
    if !origins.contains_key(&name_key(&w.path)) {
        return Some("Kolux did not create this workspace, so cleanup leaves it in place. Delete it from its own row if you want it gone.".into());
    }
    None
}

/// What one cleanup run did, path by path.
#[derive(Debug, Default, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Cleaned {
    pub removed: Vec<String>,
    pub left: Vec<Left>,
}

#[derive(Debug, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Left {
    pub path: String,
    pub why: String,
}

/// Removes each of `paths` that Kolux made and that nothing refuses, one after another and without
/// force; every other path stays and is listed with its reason. A path is checked against the
/// project's list read at the start of the run, so a stale or invented path removes nothing.
pub fn remove_selected(git: &Git, store: &Mutex<Store>, terminals: &crate::terminal::Terminals, project: &Project, paths: &[String]) -> Cleaned {
    let mut out = Cleaned::default();
    let all = match git.worktrees(Path::new(&project.path)) {
        Ok(all) => all,
        Err(e) => {
            out.left = paths.iter().map(|p| Left { path: p.clone(), why: format!("The workspace list could not be read ({e}), so nothing was removed.") }).collect();
            return out;
        }
    };
    let origins = match store.lock() {
        Ok(store) => load_origins(&store),
        Err(_) => {
            out.left = paths.iter().map(|p| Left { path: p.clone(), why: "Kolux's records are locked up, so nothing was removed.".into() }).collect();
            return out;
        }
    };
    for path in paths {
        if let Some(why) = left_in_place(&origins, &all, path) {
            out.left.push(Left { path: path.clone(), why });
            continue;
        }
        let stamp = match remove_check(git, project, path) {
            Ok(check) => check.stamp,
            Err(why) => {
                out.left.push(Left { path: path.clone(), why });
                continue;
            }
        };
        match remove_now(git, store, terminals, project, path, false, &stamp) {
            Ok(()) => out.removed.push(path.clone()),
            Err(why) => out.left.push(Left { path: path.clone(), why }),
        }
    }
    out
}

/// The cleanup dialog's Remove: only the ticked workspaces Kolux made, nothing forced.
#[tauri::command(async)]
pub fn cleanup_remove(git: State<'_, Git>, store: State<'_, Mutex<Store>>, terminals: State<'_, crate::terminal::Terminals>, project_id: String, paths: Vec<String>) -> Result<Cleaned, String> {
    let project = {
        let store = store.lock().map_err(|e| e.to_string())?;
        find_project(&store, &project_id)?
    };
    Ok(remove_selected(&git, &store, &terminals, &project, &paths))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::projects::set_origin;
    use std::fs;
    use std::path::PathBuf;
    use std::process::Command;

    fn temp(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("kolux-rs-cleanup-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn git_in(dir: &Path, args: &[&str]) {
        let out = Command::new("git").args(args).current_dir(dir).output().unwrap();
        assert!(out.status.success(), "git {args:?} in {}: {}", dir.display(), String::from_utf8_lossy(&out.stderr));
    }

    /// A repo with a Kolux-made workspace `ours` and one made behind Kolux's back, `theirs`.
    fn repo_with_two(name: &str) -> (PathBuf, PathBuf, Store, Project) {
        let base = temp(name);
        let repo = base.join("r");
        fs::create_dir_all(&repo).unwrap();
        git_in(&repo, &["init", "-q", "-b", "main"]);
        git_in(&repo, &["config", "user.email", "t@example.com"]);
        git_in(&repo, &["config", "user.name", "t"]);
        fs::write(repo.join("a.txt"), "a").unwrap();
        git_in(&repo, &["add", "."]);
        git_in(&repo, &["commit", "-q", "-m", "first"]);
        for w in ["ours", "theirs"] {
            git_in(&repo, &["worktree", "add", "-q", &base.join(w).to_string_lossy(), "-b", w]);
        }
        let store = Store::open(&base.join("db")).unwrap();
        set_origin(&store, &base.join("ours").to_string_lossy(), Some(&serde_json::json!({ "madeBy": "app" }))).unwrap();
        let project = Project { id: "p".into(), name: "r".into(), path: repo.to_string_lossy().into_owned(), workspaces_dir: None, base: None, display_name: None };
        (base, repo, store, project)
    }

    #[test]
    fn acct056_cleanup_offers_only_the_workspaces_kolux_can_show_it_made() {
        let (base, repo, store, _) = repo_with_two("offer");
        let git = Git::detect().unwrap();
        let all = git.worktrees(&repo).unwrap();
        assert_eq!(all.len(), 3);
        let offered = offerable(&load_origins(&store), all);
        assert_eq!(offered.len(), 1, "{offered:?}");
        assert!(name_key(&offered[0].path).ends_with("ours"));
        drop(store);
        let _ = fs::remove_dir_all(&base);
    }

    #[test]
    fn acct056_a_workspace_kolux_did_not_create_is_left_in_place_even_when_asked_for_by_path() {
        let (base, repo, store, project) = repo_with_two("remove");
        let git = Git::detect().unwrap();
        let store = Mutex::new(store);
        let terminals = crate::terminal::Terminals::default();
        let ours = base.join("ours").to_string_lossy().into_owned();
        let theirs = base.join("theirs").to_string_lossy().into_owned();
        let main = repo.to_string_lossy().into_owned();
        let invented = base.join("nowhere").to_string_lossy().into_owned();
        let got = remove_selected(&git, &store, &terminals, &project, &[theirs.clone(), main.clone(), invented.clone(), ours.clone()]);
        assert_eq!(got.removed, vec![ours.clone()], "{got:?}");
        assert_eq!(got.left.len(), 3, "{got:?}");
        assert!(got.left[0].why.contains("did not create"), "{got:?}");
        assert!(got.left[1].why.contains("main checkout"), "{got:?}");
        assert!(got.left[2].why.contains("not a workspace"), "{got:?}");
        assert!(!Path::new(&ours).exists(), "the workspace Kolux made went");
        assert!(Path::new(&theirs).join("a.txt").exists(), "the one it did not make stays on disk");
        let left: Vec<String> = git.worktrees(&repo).unwrap().iter().map(|w| name_key(&w.path)).collect();
        assert!(left.iter().any(|p| p.ends_with("theirs")), "and in Git's list: {left:?}");
        drop(store);
        let _ = fs::remove_dir_all(&base);
    }

    #[test]
    fn acct056_cleanup_never_forces_so_a_made_workspace_with_changes_stays_with_its_reason() {
        let (base, _repo, store, project) = repo_with_two("dirty");
        let git = Git::detect().unwrap();
        let store = Mutex::new(store);
        let ours = base.join("ours");
        fs::write(ours.join("new.txt"), "unsaved work").unwrap();
        let got = remove_selected(&git, &store, &crate::terminal::Terminals::default(), &project, &[ours.to_string_lossy().into_owned()]);
        assert!(got.removed.is_empty(), "{got:?}");
        assert!(got.left[0].why.contains("uncommitted"), "{got:?}");
        assert!(ours.join("new.txt").exists());
        drop(store);
        let _ = fs::remove_dir_all(&base);
    }

    #[test]
    fn acct056_a_failed_scan_removes_nothing() {
        let (base, _repo, store, mut project) = repo_with_two("failed");
        let git = Git::detect().unwrap();
        let store = Mutex::new(store);
        project.path = base.join("not-a-repo").to_string_lossy().into_owned();
        let ours = base.join("ours").to_string_lossy().into_owned();
        let got = remove_selected(&git, &store, &crate::terminal::Terminals::default(), &project, std::slice::from_ref(&ours));
        assert!(got.removed.is_empty(), "{got:?}");
        assert!(got.left[0].why.contains("could not be read"), "{got:?}");
        assert!(Path::new(&ours).exists());
        drop(store);
        let _ = fs::remove_dir_all(&base);
    }
}
