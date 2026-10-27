//! Row 917: the provider-neutral identity of a repository, the key of its per-repository AI switch.
//! A normalized remote URL (origin first, else the first remote), or the repository root path when
//! there is no remote, or the folder path for a folder workspace. One id for every remote form, so
//! GitHub, GitLab and self-hosted remotes work alike.

use crate::git::run;
use serde::Serialize;
use std::path::Path;

#[derive(Debug, Serialize, PartialEq, Eq)]
pub struct RepoIdentity {
    pub id: String,
    /// `owner/name` when the remote is GitHub: the key the switch was saved under before ids, read as a fallback.
    pub legacy: Option<String>,
}

/// A local path as an id: forward slashes, no trailing slash, no `.git`.
fn path_id(p: &str) -> Option<String> {
    let p = p.trim().replace('\\', "/");
    let p = p.trim_end_matches('/');
    let p = p.strip_suffix(".git").unwrap_or(p).trim_end_matches('/');
    (!p.is_empty()).then(|| p.to_string())
}

/// `host/path` for a remote URL: host lowercased, no scheme, credentials, port, `.git` or trailing
/// slash; https, ssh://, scp-style and git:// forms of one repository agree. The path keeps its case
/// because some providers are case-sensitive and two paths must never be merged. An SSH alias reads
/// as the host it stands for. None when the URL names no host and path.
pub fn remote_id(url: &str, ssh_config: &str) -> Option<String> {
    let url = url.trim();
    let (host, path, ssh) = if let Some((scheme, rest)) = url.split_once("://") {
        if scheme.eq_ignore_ascii_case("file") {
            return path_id(rest);
        }
        let (auth, path) = rest.split_once('/')?;
        let host = auth.rsplit('@').next()?;
        let host = if host.starts_with('[') { host.split_inclusive(']').next()? } else { host.split(':').next()? };
        (host, path, matches!(scheme.to_ascii_lowercase().as_str(), "ssh" | "git+ssh"))
    } else {
        match url.split_once(':') {
            Some((auth, path)) if auth.len() > 1 && !auth.contains(['/', '\\']) => (auth.rsplit('@').next()?, path, true),
            _ => return path_id(url),
        }
    };
    let path = path.trim_matches('/');
    let path = path.strip_suffix(".git").unwrap_or(path).trim_end_matches('/');
    if host.is_empty() || path.is_empty() {
        return None;
    }
    let host = if ssh { super::ssh_host(host, ssh_config).unwrap_or_else(|| host.to_string()) } else { host.to_string() };
    Some(format!("{}/{}", host.to_lowercase(), path))
}

fn not_a_repository(err: &str) -> bool {
    err.to_lowercase().contains("not a git repository")
}

/// The remote the id is read from: origin, else the first remote. Ok(None) means a repository with no
/// remote; Err(not a repository) means a folder.
fn remote_url(worktree: &Path) -> Result<Option<String>, String> {
    if let Ok(url) = run(&["remote", "get-url", "origin"], Some(worktree)) {
        return Ok(Some(url));
    }
    let names = run(&["remote"], Some(worktree))?;
    match names.lines().map(str::trim).find(|n| !n.is_empty()) {
        Some(name) => run(&["remote", "get-url", name], Some(worktree)).map(Some),
        None => Ok(None),
    }
}

/// The repository's own root (the main checkout, so every linked worktree agrees), as an id.
fn root_id(worktree: &Path) -> Result<String, String> {
    let common = run(&["rev-parse", "--git-common-dir"], Some(worktree))?;
    let common = Path::new(&common);
    let dir = if common.is_absolute() { common.to_path_buf() } else { worktree.join(common) };
    let root = if dir.file_name().is_some_and(|n| n == ".git") { dir.parent().unwrap_or(&dir).to_path_buf() } else { dir };
    // `..` from a subfolder (`../.git`) is cleaned by canonical form only when the path exists; fold it by hand otherwise.
    let text = root.to_string_lossy().replace('\\', "/");
    let mut parts: Vec<&str> = Vec::new();
    for seg in text.split('/') {
        match seg {
            "." => {}
            ".." if parts.last().is_some_and(|l| *l != ".." && !l.ends_with(':') && !l.is_empty()) => {
                parts.pop();
            }
            s => parts.push(s),
        }
    }
    path_id(&parts.join("/")).ok_or_else(|| "the repository root has no path".to_string())
}

/// The identity of `worktree`: see the module note. Err when git fails in a way that does not say "not a repository".
pub fn identity(worktree: &Path, ssh_config: &str) -> Result<RepoIdentity, String> {
    let folder = || path_id(&worktree.to_string_lossy()).ok_or_else(|| "empty folder path".to_string());
    let url = match remote_url(worktree) {
        Ok(u) => u,
        Err(e) if not_a_repository(&e) => return Ok(RepoIdentity { id: folder()?, legacy: None }),
        Err(e) => return Err(e),
    };
    if let Some(id) = url.as_deref().and_then(|u| remote_id(u, ssh_config)) {
        let legacy = url.as_deref().and_then(|u| super::github_repo(u, ssh_config)).map(|g| format!("{}/{}", g.owner, g.name));
        return Ok(RepoIdentity { id, legacy });
    }
    Ok(RepoIdentity { id: root_id(worktree)?, legacy: None })
}

#[tauri::command]
pub async fn scm_repo_id(worktree: String) -> Result<RepoIdentity, String> {
    identity(Path::new(&worktree), &super::ssh_config())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::path::PathBuf;

    fn scratch(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("kolux-rs-repoid-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn repo(name: &str) -> PathBuf {
        let dir = scratch(name);
        run(&["init", "-q", "-b", "main"], Some(&dir)).unwrap();
        dir
    }

    fn forward(p: &Path) -> String {
        p.to_string_lossy().replace('\\', "/")
    }

    #[test]
    fn row917_every_remote_form_of_one_repository_gives_the_same_id() {
        let same = [
            "https://github.com/Acme/app.git",
            "https://github.com/Acme/app",
            "https://github.com/Acme/app/",
            "https://GitHub.com/Acme/app.git/",
            "https://user:s3cr%40t@github.com/Acme/app.git",
            "https://x-access-token:abc@github.com:443/Acme/app.git",
            "http://github.com/Acme/app.git",
            "git@github.com:Acme/app.git",
            "git@github.com:Acme/app",
            "git@GITHUB.com:/Acme/app.git",
            "ssh://git@github.com/Acme/app.git",
            "ssh://git@github.com:22/Acme/app.git",
            "ssh://git@github.com:2222/Acme/app/",
            "git://github.com/Acme/app.git",
            "  https://github.com/Acme/app.git\n",
        ];
        for u in same {
            assert_eq!(remote_id(u, "").as_deref(), Some("github.com/Acme/app"), "{u}");
        }
    }

    #[test]
    fn row917_other_hosts_other_paths_and_other_case_are_other_ids() {
        let id = |u: &str| remote_id(u, "").unwrap();
        assert_ne!(id("https://github.com/acme/app"), id("https://gitlab.com/acme/app"));
        assert_ne!(id("https://github.com/acme/app"), id("https://github.com/acme/other"));
        // Path case is kept: other providers are case-sensitive, so two paths are never merged.
        assert_ne!(id("https://git.example.org/Acme/app"), id("https://git.example.org/acme/app"));
        assert_eq!(id("git@gitlab.com:group/sub/team/app.git"), "gitlab.com/group/sub/team/app");
        assert_eq!(id("https://gitlab.example.org:8443/group/sub/app.git"), "gitlab.example.org/group/sub/app");
        assert_eq!(id("ssh://git@bitbucket.org/team/app.git"), "bitbucket.org/team/app");
    }

    #[test]
    fn row917_an_ssh_alias_reads_as_the_host_it_stands_for() {
        let config = "Host work-gh\n  HostName github.com\n  User git\n";
        assert_eq!(remote_id("git@work-gh:Acme/app.git", config).as_deref(), Some("github.com/Acme/app"));
        assert_eq!(remote_id("ssh://git@work-gh/Acme/app.git", config).as_deref(), Some("github.com/Acme/app"));
        // https never goes through the SSH config.
        assert_eq!(remote_id("https://work-gh/Acme/app.git", config).as_deref(), Some("work-gh/Acme/app"));
    }

    #[test]
    fn row917_a_remote_that_names_no_repository_gives_no_id() {
        for u in ["", "   ", "https://github.com", "https://github.com/", "git@github.com:", "https:///o/r"] {
            assert_eq!(remote_id(u, ""), None, "{u:?}");
        }
        // A remote that is a local path reads as that path, with forward slashes and no .git.
        assert_eq!(remote_id("C:\\work\\origin.git", "").as_deref(), Some("C:/work/origin"));
        assert_eq!(remote_id("/srv/git/origin.git/", "").as_deref(), Some("/srv/git/origin"));
    }

    #[test]
    fn row917_a_gitlab_repository_gets_an_id_and_no_github_key() {
        let dir = repo("gitlab");
        run(&["remote", "add", "origin", "git@gitlab.com:group/sub/app.git"], Some(&dir)).unwrap();
        let got = identity(&dir, "").unwrap();
        assert_eq!(got, RepoIdentity { id: "gitlab.com/group/sub/app".into(), legacy: None });
    }

    #[test]
    fn row917_a_github_repository_also_carries_its_old_owner_name_key() {
        let dir = repo("github");
        run(&["remote", "add", "origin", "https://github.com/Acme/app.git"], Some(&dir)).unwrap();
        let got = identity(&dir, "").unwrap();
        assert_eq!(got, RepoIdentity { id: "github.com/Acme/app".into(), legacy: Some("Acme/app".into()) });
    }

    #[test]
    fn row917_origin_wins_over_other_remotes_else_the_first_remote_is_used() {
        let dir = repo("origin-first");
        run(&["remote", "add", "alpha", "https://gitlab.com/a/first.git"], Some(&dir)).unwrap();
        run(&["remote", "add", "origin", "https://gitlab.com/o/origin.git"], Some(&dir)).unwrap();
        assert_eq!(identity(&dir, "").unwrap().id, "gitlab.com/o/origin");
        let no_origin = repo("first-remote");
        run(&["remote", "add", "upstream", "https://gitlab.com/u/up.git"], Some(&no_origin)).unwrap();
        run(&["remote", "add", "zeta", "https://gitlab.com/z/last.git"], Some(&no_origin)).unwrap();
        assert_eq!(identity(&no_origin, "").unwrap().id, "gitlab.com/u/up");
    }

    #[test]
    fn row917_no_remote_uses_the_repository_root_path_for_every_worktree() {
        let dir = repo("no-remote");
        fs::write(dir.join("a.txt"), "x").unwrap();
        run(&["add", "."], Some(&dir)).unwrap();
        run(&["-c", "user.email=t@example.com", "-c", "user.name=t", "commit", "-q", "-m", "first"], Some(&dir)).unwrap();
        let want = identity(&dir, "").unwrap();
        assert_eq!(want.legacy, None);
        assert!(want.id.ends_with(&format!("kolux-rs-repoid-no-remote-{}", std::process::id())), "{}", want.id);
        assert!(!want.id.contains('\\') && !want.id.ends_with('/') && !want.id.contains(".git"), "{}", want.id);
        let linked = scratch("no-remote-linked").join("wt");
        run(&["worktree", "add", "-q", "-b", "side", &linked.to_string_lossy()], Some(&dir)).unwrap();
        assert_eq!(identity(&linked, "").unwrap(), want, "a linked worktree is the same repository");
        let sub = dir.join("deep");
        fs::create_dir_all(&sub).unwrap();
        assert_eq!(identity(&sub, "").unwrap(), want, "a subfolder is the same repository");
    }

    #[test]
    fn row917_a_folder_workspace_is_its_own_path() {
        let dir = scratch("plain-folder");
        let got = identity(&dir, "").unwrap();
        assert_eq!(got, RepoIdentity { id: forward(&dir), legacy: None });
    }

    #[test]
    fn row917_a_git_failure_is_an_error_not_a_path() {
        let missing = std::env::temp_dir().join(format!("kolux-rs-repoid-missing-{}", std::process::id()));
        let _ = fs::remove_dir_all(&missing);
        assert!(identity(&missing, "").is_err(), "an unreadable directory must not read as a folder id");
    }
}
