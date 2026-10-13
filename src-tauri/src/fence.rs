// ACCT-055: the app window reads and writes files only inside the user's projects and their
// worktrees, plus single files the user picked in Kolux's own Open a file dialog (granted
// exactly, never their folder). Network shares and drive roots are never a root, and every path
// is resolved through its links first, so a link inside a project cannot reach outside it.
use crate::git::Git;
use crate::state::Store;
use std::collections::VecDeque;
use std::path::{Component, Path, PathBuf, Prefix};
use std::sync::Mutex;
use std::time::{Duration, Instant};

/// At most this many picked files are granted; the oldest grant goes first.
pub const GRANT_CAP: usize = 100;
/// ponytail: worktree folders are read from Git at most this often on a miss; a worktree added
/// outside Kolux opens after this delay at worst.
const TREES_FRESH: Duration = Duration::from_secs(3);

#[derive(Default)]
pub struct Fence {
    grants: Mutex<VecDeque<PathBuf>>,
    trees: Mutex<Option<(Instant, Vec<PathBuf>)>>,
}

/// A network share: `\\server\share`, `//server/share` or, once resolved, `\\?\UNC\...`.
fn is_share(p: &Path) -> bool {
    let s = p.to_string_lossy();
    if s.starts_with("//") || (s.starts_with("\\\\") && !s.starts_with("\\\\?\\") && !s.starts_with("\\\\.\\")) {
        return true;
    }
    matches!(p.components().next(), Some(Component::Prefix(x)) if matches!(x.kind(), Prefix::UNC(..) | Prefix::VerbatimUNC(..)))
}

fn is_drive_root(p: &Path) -> bool {
    p.parent().is_none()
}

/// The path with every link resolved; a file that does not exist yet resolves through its folder.
fn resolve(p: &Path) -> Option<PathBuf> {
    p.canonicalize().ok().or_else(|| Some(p.parent()?.canonicalize().ok()?.join(p.file_name()?)))
}

fn refused(p: &Path) -> String {
    format!("Kolux opens files only from your projects and their worktrees, or a file you picked: {} is outside them", p.display())
}

fn share(p: &Path) -> String {
    format!("Kolux does not open files from other computers' shares: {}", p.display())
}

/// `path` as given, so callers keep their own spelling rather than the long resolved form, once
/// its resolved form is inside one of `roots` or, with `exact` set, is one of the granted files.
pub fn check(path: &Path, roots: &[PathBuf], grants: &[PathBuf], exact: bool) -> Result<PathBuf, String> {
    if is_share(path) {
        return Err(share(path));
    }
    let real = resolve(path).ok_or_else(|| refused(path))?;
    if is_share(&real) {
        return Err(share(path));
    }
    let inside = roots.iter().filter_map(|r| r.canonicalize().ok()).any(|r| !is_share(&r) && !is_drive_root(&r) && real.starts_with(&r));
    let granted = exact && grants.contains(&real);
    if inside || granted {
        Ok(path.to_path_buf())
    } else {
        Err(refused(path))
    }
}

impl Fence {
    /// Grants one picked file exactly; folders, drive roots and shares are never granted.
    pub fn grant(&self, path: &Path) -> Result<(), String> {
        let real = path.canonicalize().map_err(|e| format!("{}: {e}", path.display()))?;
        if is_share(&real) || is_drive_root(&real) || real.is_dir() {
            return Err(refused(path));
        }
        let mut g = self.grants.lock().map_err(|e| e.to_string())?;
        g.retain(|x| *x != real);
        g.push_back(real);
        while g.len() > GRANT_CAP {
            g.pop_front();
        }
        Ok(())
    }

    /// `check` against the projects in the store, then, on a miss, their worktrees too.
    pub fn allow(&self, path: &str, store: &Mutex<Store>, git: &Git, exact: bool) -> Result<PathBuf, String> {
        let projects = crate::projects::load_projects(&*store.lock().map_err(|e| e.to_string())?);
        let mut roots: Vec<PathBuf> = projects.iter().map(|p| PathBuf::from(&p.path)).collect();
        let grants: Vec<PathBuf> = self.grants.lock().map_err(|e| e.to_string())?.iter().cloned().collect();
        let path = Path::new(path);
        if let Ok(p) = check(path, &roots, &grants, exact) {
            return Ok(p);
        }
        let mut trees = self.trees.lock().map_err(|e| e.to_string())?;
        if !trees.as_ref().is_some_and(|(at, _)| at.elapsed() < TREES_FRESH) {
            let all = projects.iter().flat_map(|p| git.worktrees(Path::new(&p.path)).unwrap_or_default()).map(|w| PathBuf::from(w.path)).collect();
            *trees = Some((Instant::now(), all));
        }
        roots.extend(trees.as_ref().map(|(_, t)| t.clone()).unwrap_or_default());
        check(path, &roots, &grants, exact)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    struct Temp(PathBuf);
    impl Drop for Temp {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }
    fn temp(name: &str) -> Temp {
        let d = std::env::temp_dir().join(format!("krs-fence-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&d);
        fs::create_dir_all(d.join("project/src")).unwrap();
        fs::create_dir_all(d.join("outside")).unwrap();
        fs::write(d.join("project/src/a.txt"), "a").unwrap();
        fs::write(d.join("outside/picked.txt"), "p").unwrap();
        fs::write(d.join("outside/other.txt"), "o").unwrap();
        Temp(d)
    }

    #[test]
    fn acct_055_files_outside_every_project_are_refused() {
        let t = temp("outside");
        let roots = [t.0.join("project")];
        assert!(check(&t.0.join("project/src/a.txt"), &roots, &[], true).is_ok());
        assert!(check(&t.0.join("project/src/new.md"), &roots, &[], true).is_ok(), "a new file inside a project can be saved");
        assert!(check(&t.0.join("outside/other.txt"), &roots, &[], true).is_err());
        assert!(check(&t.0.join("project/../outside/other.txt"), &roots, &[], true).is_err(), "dot-dot does not climb out");
        assert!(check(Path::new(r"\\server\share\x.txt"), &roots, &[], true).is_err());
        assert!(check(Path::new("//server/share/x.txt"), &roots, &[], true).is_err());
        let drive = t.0.ancestors().last().unwrap().to_path_buf();
        assert!(check(&t.0.join("outside/other.txt"), &[drive], &[], true).is_err(), "a drive root is never a root");
    }

    #[test]
    fn acct_055_a_picked_file_grants_only_itself() {
        let t = temp("grant");
        let f = Fence::default();
        f.grant(&t.0.join("outside/picked.txt")).unwrap();
        assert!(f.grant(&t.0.join("outside")).is_err(), "a folder is never granted");
        let grants: Vec<PathBuf> = f.grants.lock().unwrap().iter().cloned().collect();
        let roots = [t.0.join("project")];
        assert!(check(&t.0.join("outside/picked.txt"), &roots, &grants, true).is_ok());
        assert!(check(&t.0.join("outside/other.txt"), &roots, &grants, true).is_err(), "the picked file's folder stays closed");
        assert!(check(&t.0.join("outside/picked.txt"), &roots, &grants, false).is_err(), "listing and diffs need a project");
        for i in 0..GRANT_CAP + 5 {
            let p = t.0.join(format!("outside/g{i}.txt"));
            fs::write(&p, "").unwrap();
            f.grant(&p).unwrap();
        }
        assert_eq!(f.grants.lock().unwrap().len(), GRANT_CAP);
        assert!(!f.grants.lock().unwrap().contains(&t.0.join("outside/picked.txt").canonicalize().unwrap()), "the oldest grant went first");
    }

    #[cfg(windows)]
    #[test]
    fn acct_055_a_link_inside_a_project_does_not_reach_outside() {
        let t = temp("link");
        let link = t.0.join("project").join("link");
        let made = std::process::Command::new("cmd").args(["/C", "mklink", "/J"]).arg(&link).arg(t.0.join("outside")).output().is_ok_and(|o| o.status.success());
        if !made {
            eprintln!("no junction made; link rule not checked");
            return;
        }
        assert!(check(&link.join("other.txt"), &[t.0.join("project")], &[], true).is_err());
        let _ = fs::remove_dir(&link);
    }
}
