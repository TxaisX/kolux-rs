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
    /// Every other key this repository is known by (other remotes, its root path, their old GitHub keys): an "off" saved under any of them still counts.
    pub also: Vec<String>,
}

#[tauri::command]
pub fn scm_repo_id_of(text: String) -> String {
    typed_id(&text, &super::ssh_config())
}

/// A local path as an id: forward slashes, no trailing slash, no `.git`, lowercased on Windows only.
fn path_id(p: &str) -> Option<String> {
    let p = p.trim().replace('\\', "/");
    let p = p.trim_end_matches('/');
    let p = p.strip_suffix(".git").unwrap_or(p).trim_end_matches('/');
    // Windows paths are case-insensitive; elsewhere the case is kept.
    (!p.is_empty()).then(|| if cfg!(windows) { p.to_lowercase() } else { p.to_string() })
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
    // `ssh://host/~/r` and `host:r` both mean r under the login's home.
    let path = path.strip_prefix("~/").unwrap_or(path);
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

/// The repository root as an id, from `git rev-parse --git-common-dir` read in `worktree`: always
/// absolute (a relative gitdir is resolved against `worktree`, `..` folded), the main checkout so
/// every linked worktree agrees, and the same text whether git said `.git` or the full path.
fn root_from(worktree: &Path, common: &str) -> Option<String> {
    let common = common.trim().replace('\\', "/");
    let common = Path::new(&common);
    let dir = if common.is_absolute() || common.has_root() { common.to_path_buf() } else { worktree.join(common) };
    let text = dir.to_string_lossy().replace('\\', "/");
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
    let folded = parts.join("/");
    let folded = folded.trim_end_matches('/');
    let root = match folded.strip_suffix("/.git") {
        Some(parent) => parent,
        None => folded,
    };
    path_id(root)
}

fn root_id(worktree: &Path) -> Result<String, String> {
    let common = run(&["rev-parse", "--git-common-dir"], Some(worktree))?;
    root_from(worktree, &common).ok_or_else(|| "the repository root has no path".to_string())
}

/// The identity of `worktree`: see the module note. The primary id is origin's, else the first
/// remote's, else the root path; `also` holds every other remote, the root path and their old
/// GitHub keys, so a switch saved under any of them survives a remote being added or origin changed.
/// Err when git fails in a way that does not say "not a repository".
pub fn identity(worktree: &Path, ssh_config: &str) -> Result<RepoIdentity, String> {
    let folder = || path_id(&worktree.to_string_lossy()).ok_or_else(|| "empty folder path".to_string());
    let names = match run(&["remote"], Some(worktree)) {
        Ok(n) => n,
        Err(e) if not_a_repository(&e) => return Ok(RepoIdentity { id: folder()?, legacy: None, also: Vec::new() }),
        Err(e) => return Err(e),
    };
    let mut names: Vec<&str> = names.lines().map(str::trim).filter(|n| !n.is_empty()).collect();
    if let Some(i) = names.iter().position(|n| *n == "origin") {
        names.swap(0, i);
    }
    // (id, old GitHub key) per remote, origin first. An origin that exists but cannot be read is an error, never a quiet switch to another remote.
    let mut remotes: Vec<(String, Option<String>)> = Vec::new();
    for (i, name) in names.iter().enumerate() {
        let url = match run(&["remote", "get-url", name], Some(worktree)) {
            Ok(u) => u,
            Err(e) if i == 0 && *name == "origin" => return Err(e),
            Err(_) => continue,
        };
        if let Some(id) = remote_id(&url, ssh_config) {
            let legacy = super::github_repo(&url, ssh_config).map(|g| format!("{}/{}", g.owner, g.name));
            if !remotes.iter().any(|(r, _)| *r == id) {
                remotes.push((id, legacy));
            }
        }
    }
    let root = root_id(worktree);
    let mut rest: Vec<String> = Vec::new();
    let (id, legacy) = if remotes.is_empty() {
        (root?, None)
    } else {
        if let Ok(r) = root {
            rest.push(r);
        }
        let (id, legacy) = remotes.remove(0);
        (id, legacy)
    };
    for (rid, rlegacy) in remotes {
        rest.extend([rid]);
        rest.extend(rlegacy);
    }
    let mut also: Vec<String> = Vec::new();
    for k in rest {
        if k != id && legacy.as_deref() != Some(k.as_str()) && !also.contains(&k) {
            also.push(k);
        }
    }
    Ok(RepoIdentity { id, legacy, also })
}

/// A repository typed or pasted in Settings as the id `identity` would resolve for it: a URL or
/// scp form through `remote_id`, a path through the path rules, `host/owner/name` with its host
/// lowercased. Anything else (the old `owner/name`) is kept as typed.
pub fn typed_id(text: &str, ssh_config: &str) -> String {
    let t = text.trim();
    let drive = t.as_bytes().get(1) == Some(&b':') && t.as_bytes()[0].is_ascii_alphabetic();
    if t.contains(':') && !drive {
        return remote_id(t, ssh_config).unwrap_or_else(|| t.to_string());
    }
    if drive || t.starts_with('/') || t.starts_with('\\') {
        return path_id(t).unwrap_or_else(|| t.to_string());
    }
    let t = t.replace('\\', "/");
    let t = t.trim_matches('/');
    let t = t.strip_suffix(".git").unwrap_or(t).trim_end_matches('/');
    match t.split_once('/') {
        Some((first, rest)) if first.contains('.') => format!("{}/{}", first.to_lowercase(), rest),
        _ => t.to_string(),
    }
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

    /// Windows paths are case-insensitive, so their ids are lowercased there and nowhere else.
    fn fold(s: &str) -> String {
        if cfg!(windows) { s.to_lowercase() } else { s.to_string() }
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
        assert_eq!(remote_id("C:\\work\\origin.git", "").as_deref(), Some(fold("C:/work/origin").as_str()));
        assert_eq!(remote_id("/srv/git/origin.git/", "").as_deref(), Some("/srv/git/origin"));
    }

    #[test]
    fn row917_a_gitlab_repository_gets_an_id_and_no_github_key() {
        let dir = repo("gitlab");
        run(&["remote", "add", "origin", "git@gitlab.com:group/sub/app.git"], Some(&dir)).unwrap();
        let got = identity(&dir, "").unwrap();
        assert_eq!((got.id.as_str(), got.legacy.as_deref()), ("gitlab.com/group/sub/app", None));
    }

    #[test]
    fn row917_a_github_repository_also_carries_its_old_owner_name_key() {
        let dir = repo("github");
        run(&["remote", "add", "origin", "https://github.com/Acme/app.git"], Some(&dir)).unwrap();
        let got = identity(&dir, "").unwrap();
        assert_eq!((got.id.as_str(), got.legacy.as_deref()), ("github.com/Acme/app", Some("Acme/app")));
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
        assert_eq!(identity(&linked, "").unwrap().id, want.id, "a linked worktree is the same repository");
        let sub = dir.join("deep");
        fs::create_dir_all(&sub).unwrap();
        assert_eq!(identity(&sub, "").unwrap().id, want.id, "a subfolder is the same repository");
    }

    #[test]
    fn row917_a_folder_workspace_is_its_own_path() {
        let dir = scratch("plain-folder");
        let got = identity(&dir, "").unwrap();
        assert_eq!((got.id, got.legacy, got.also), (fold(&forward(&dir)), None, Vec::<String>::new()));
    }

    #[test]
    fn row917_a_git_failure_is_an_error_not_a_path() {
        let missing = std::env::temp_dir().join(format!("kolux-rs-repoid-missing-{}", std::process::id()));
        let _ = fs::remove_dir_all(&missing);
        assert!(identity(&missing, "").is_err(), "an unreadable directory must not read as a folder id");
    }

    // ---- row 917 review fixes ----

    #[test]
    fn row917r_ssh_home_relative_and_scp_forms_agree() {
        assert_eq!(remote_id("ssh://git@host.example/~/team/app.git", "").as_deref(), Some("host.example/team/app"));
        assert_eq!(remote_id("git@host.example:team/app.git", "").as_deref(), Some("host.example/team/app"));
        assert_eq!(remote_id("git@host.example:~/team/app", "").as_deref(), Some("host.example/team/app"));
    }

    #[test]
    fn row917r_the_root_id_is_absolute_and_the_same_from_a_relative_or_absolute_gitdir() {
        let repo = Path::new("/w/Repo");
        let want = Some(fold("/w/Repo"));
        assert_eq!(root_from(repo, ".git"), want);
        assert_eq!(root_from(&repo.join("deep").join("er"), "../../.git"), want);
        assert_eq!(root_from(&repo.join("deep"), "/w/Repo/.git"), want);
        assert_eq!(root_from(&repo.join("deep"), "/w/Repo/.git/"), want);
        assert_eq!(root_from(Path::new("/srv"), "/srv/bare.git"), Some("/srv/bare".to_string()));
        if cfg!(windows) {
            assert_eq!(root_from(Path::new("C:/W/Repo"), "C:/w/repo/.git"), root_from(Path::new("c:/w/repo"), ".git"));
        }
    }

    #[test]
    fn row917r_windows_path_case_does_not_make_a_second_id() {
        let a = remote_id("C:/Work/Origin.git", "");
        let b = remote_id("c:/work/origin.git", "");
        assert_eq!(a == b, cfg!(windows));
        assert_eq!(typed_id("C:\\Work\\Repo\\", ""), fold("C:/Work/Repo"));
    }

    #[test]
    fn row917r_adding_a_remote_keeps_the_root_id_as_another_key_of_the_repository() {
        let dir = repo("add-remote");
        let before = identity(&dir, "").unwrap();
        assert!(before.also.is_empty());
        run(&["remote", "add", "origin", "https://gitlab.com/g/app.git"], Some(&dir)).unwrap();
        let after = identity(&dir, "").unwrap();
        assert_eq!(after.id, "gitlab.com/g/app");
        assert!(after.also.contains(&before.id), "{:?} should hold {}", after.also, before.id);
    }

    #[test]
    fn row917r_switching_origin_keeps_the_old_remote_as_another_key() {
        let dir = repo("switch-origin");
        run(&["remote", "add", "origin", "https://github.com/Acme/app.git"], Some(&dir)).unwrap();
        let old = identity(&dir, "").unwrap();
        run(&["remote", "rename", "origin", "old"], Some(&dir)).unwrap();
        run(&["remote", "add", "origin", "https://gitlab.com/g/app.git"], Some(&dir)).unwrap();
        let now = identity(&dir, "").unwrap();
        assert_eq!(now.id, "gitlab.com/g/app", "origin is the primary id");
        assert!(now.also.contains(&old.id), "{:?} should hold {}", now.also, old.id);
        assert!(now.also.contains(&"Acme/app".to_string()), "the old remote's GitHub key too: {:?}", now.also);
    }

    #[test]
    fn row917r_a_typed_entry_saves_under_the_id_a_repository_resolves() {
        let dir = repo("typed");
        run(&["remote", "add", "origin", "git@gitlab.com:Team/App"], Some(&dir)).unwrap();
        let resolved = identity(&dir, "").unwrap().id;
        for typed in ["https://GitLab.com/Team/App.git", "git@gitlab.com:Team/App.git", "ssh://git@gitlab.com/Team/App/", "GitLab.com/Team/App.git/", "gitlab.com/Team/App"] {
            assert_eq!(typed_id(typed, ""), resolved, "{typed}");
        }
        assert_eq!(typed_id("  Acme/app  ", ""), "Acme/app", "the old owner/name form is left as typed");
        assert_eq!(typed_id("/srv/work/Repo/", ""), fold("/srv/work/Repo"));
    }
}
