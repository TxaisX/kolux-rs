//! PROJ-030 (the pull-request half): open a GitHub pull request as a workspace. The pull request's
//! head is fetched into a remote-tracking branch; a local branch of the same name is reused only
//! when it already points at the pull request's latest commit, and a pull request from a fork gets
//! a remote named after the fork's owner, with a number added when that name is taken.

use crate::git::{run, Git};
use crate::projects::{Created, Place, Project};
use crate::names::safe_name;
use std::path::Path;
use std::sync::PoisonError;

/// The gh fields Kolux reads for a pull request it may open as a workspace.
pub const PR_HEAD_FIELDS: &str = "number,title,url,headRefName,headRefOid,isCrossRepository,headRepositoryOwner,headRepository";

/// A pull request's head, as `gh pr list / view --json PR_HEAD_FIELDS` gives it.
#[derive(Clone, Debug, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PrHead {
    pub number: u64,
    pub title: String,
    pub url: String,
    pub head_ref_name: String,
    pub head_ref_oid: String,
    #[serde(default)]
    pub is_cross_repository: bool,
    #[serde(default)]
    pub head_repository_owner: Option<Login>,
    #[serde(default)]
    pub head_repository: Option<RepoName>,
}

#[derive(Clone, Debug, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub struct Login {
    pub login: String,
}

#[derive(Clone, Debug, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub struct RepoName {
    pub name: String,
}

/// Reads gh's answer: one pull request (`gh pr view`) or a list (`gh pr list`).
pub fn parse_heads(text: &str) -> Result<Vec<PrHead>, String> {
    let text = text.trim();
    if text.starts_with('[') {
        serde_json::from_str(text)
    } else {
        serde_json::from_str::<PrHead>(text).map(|h| vec![h])
    }
    .map_err(|e| format!("gh answered in a form Kolux cannot read: {e}"))
}

/// The open pull requests of the project's repository, newest first as gh lists them.
pub fn list(gh: &Path, repo: &Path) -> Result<Vec<PrHead>, String> {
    let text = crate::scm::gh_run(gh, repo, &["pr", "list", "--state", "open", "--limit", "50", "--json", PR_HEAD_FIELDS], None).map_err(|e| crate::scm::gh_words(&e))?;
    parse_heads(&text)
}

/// One pull request by its number.
pub fn view(gh: &Path, repo: &Path, number: u64) -> Result<PrHead, String> {
    let n = number.to_string();
    let text = crate::scm::gh_run(gh, repo, &["pr", "view", &n, "--json", PR_HEAD_FIELDS], None).map_err(|e| crate::scm::gh_words(&e))?;
    parse_heads(&text)?.into_iter().next().ok_or_else(|| format!("gh said nothing about pull request #{number}"))
}

/// The fork's address in the same form as origin's: origin's `owner/name` swapped for the fork's.
/// None when origin is not a GitHub-shaped address.
pub fn fork_url(origin: &str, owner: &str, name: &str) -> Option<String> {
    let origin = origin.trim();
    let gh = crate::scm::github_repo(origin, "")?;
    let tail = format!("{}/{}", gh.owner, gh.name);
    let at = origin.rfind(&tail)?;
    Some(format!("{}{owner}/{name}{}", &origin[..at], &origin[at + tail.len()..]))
}

/// The remote to fetch a fork's branch from: `wanted` when it is free or already points at `url`,
/// else `wanted-2`, `wanted-3`... (the first free one, or one already pointing at `url`).
pub fn remote_for(repo: &Path, wanted: &str, url: &str) -> Result<String, String> {
    let have: Vec<String> = run(&["remote"], Some(repo))?.lines().map(str::to_string).collect();
    let base = safe_name(wanted).unwrap_or_else(|| "fork".to_string());
    for n in 1.. {
        let name = if n == 1 { base.clone() } else { format!("{base}-{n}") };
        if !have.contains(&name) {
            run(&["remote", "add", &name, url], Some(repo))?;
            return Ok(name);
        }
        if run(&["remote", "get-url", &name], Some(repo)).is_ok_and(|u| u.trim() == url) {
            return Ok(name);
        }
    }
    unreachable!("1.. never ends")
}

/// PROJ-037: an issue, as `gh issue view --json number,title,url` gives it.
#[derive(Clone, Debug, PartialEq, Eq, serde::Deserialize)]
pub struct Issue {
    pub number: u64,
    pub title: String,
    pub url: String,
}

pub fn parse_issue(text: &str) -> Result<Issue, String> {
    serde_json::from_str(text.trim()).map_err(|e| format!("gh answered in a form Kolux cannot read: {e}"))
}

/// One issue of the project's repository by its number.
pub fn issue(gh: &Path, repo: &Path, number: u64) -> Result<Issue, String> {
    let n = number.to_string();
    let text = crate::scm::gh_run(gh, repo, &["issue", "view", &n, "--json", "number,title,url"], None).map_err(|e| crate::scm::gh_words(&e))?;
    parse_issue(&text)
}

/// PROJ-037: whether any remote in `remotes` (`git config --get-regexp` lines: key, then the
/// address as the user wrote it) is the GitHub repository `host/owner/name`.
pub fn has_repo(remotes: &str, host: &str, owner: &str, name: &str) -> bool {
    let want = format!("{host}/{owner}/{name}").to_lowercase();
    remotes.lines().filter_map(|l| l.split_once(' ')).any(|(_, url)| crate::scm::github_repo(url, "").is_some_and(|g| g.key == want))
}

/// The remote addresses of the repository at `repo` as written (an insteadOf rewrite is not
/// applied, so a mirror still counts as the repository it stands in for).
pub fn remotes(repo: &Path) -> String {
    run(&["config", "--get-regexp", r"^remote\..*\.url$"], Some(repo)).unwrap_or_default()
}

fn sha(repo: &Path, r: &str) -> Option<String> {
    run(&["rev-parse", "--verify", "--quiet", &format!("{r}^{{commit}}")], Some(repo)).ok().map(|s| s.trim().to_string())
}

/// Opens pull request `pr` as a workspace of `project`. `fork` is the fork's address for a
/// pull request from another repository (None: its head is on origin). The folder takes `folder`
/// when given, else the head branch's name, numbered when taken. The bool says whether a local
/// branch that existed before was reused (it then stays when the workspace is removed).
pub fn open(git: &Git, place: &Place, project: &Project, pr: &PrHead, fork: Option<&str>, folder: Option<&str>, overtaken: &dyn Fn() -> bool) -> Result<(Created, bool), String> {
    let repo = Path::new(&project.path);
    let head = pr.head_ref_name.trim();
    if head.is_empty() {
        return Err(format!("pull request #{} names no head branch", pr.number));
    }
    let turn = crate::projects::repo_turn(repo);
    let _turn = turn.lock().unwrap_or_else(PoisonError::into_inner);
    if overtaken() {
        return Err(crate::projects::OVERTAKEN.to_string());
    }
    let remote = match fork {
        Some(url) => remote_for(repo, pr.head_repository_owner.as_ref().map_or("fork", |o| o.login.as_str()), url)?,
        None => "origin".to_string(),
    };
    let tracking = format!("refs/remotes/{remote}/{head}");
    run(&["fetch", "--quiet", &remote, &format!("+refs/heads/{head}:{tracking}")], Some(repo)).map_err(|e| format!("could not fetch pull request #{} from {remote}: {e}", pr.number))?;
    let latest = if pr.head_ref_oid.is_empty() { sha(repo, &tracking).unwrap_or_default() } else { pr.head_ref_oid.clone() };
    // A local branch of the head's name is reused only when it is at the pull request's head.
    let local = sha(repo, &format!("refs/heads/{head}"));
    let reuse = local.as_deref() == Some(latest.as_str());
    let branch = if reuse || local.is_none() {
        head.to_string()
    } else {
        let stem = format!("{head}-pr-{}", pr.number);
        (1..).map(|n| if n == 1 { stem.clone() } else { format!("{stem}-{n}") }).find(|b| sha(repo, &format!("refs/heads/{b}")).is_none()).unwrap_or(stem)
    };
    let stem = safe_name(folder.map(str::trim).filter(|f| !f.is_empty()).unwrap_or(head)).unwrap_or_else(|| format!("pr-{}", pr.number));
    let dest = (1..)
        .map(|n| crate::projects::workspace_path(place, project, &if n == 1 { stem.clone() } else { format!("{stem}-{n}") }))
        .find(|d| !d.exists())
        .ok_or("no free folder")?;
    if let Some(parent) = dest.parent() {
        std::fs::create_dir_all(parent).map_err(|e| format!("could not create {}: {e}", parent.display()))?;
    }
    let dest_s = dest.to_string_lossy().to_string();
    if reuse {
        run(&["worktree", "add", &dest_s, &branch], Some(repo))?;
    } else {
        run(&["worktree", "add", "-b", &branch, &dest_s, &latest], Some(repo))?;
        run(&["branch", &format!("--set-upstream-to={remote}/{head}"), &branch], Some(repo))?;
    }
    let warnings = crate::include::bring_along(repo, &dest);
    if overtaken() {
        crate::include::unlink_shared(repo, &dest);
        let _ = git.worktree_remove(repo, &dest, (!reuse).then_some(branch.as_str()));
        return Err(crate::projects::OVERTAKEN.to_string());
    }
    let note = match (reuse, local.is_some()) {
        (true, _) => Some(format!("reused the local branch {branch}, already at the pull request's head")),
        (false, true) => Some(format!("the local branch {head} is not at the pull request's head, so it was left alone and {branch} made")),
        (false, false) => None,
    };
    let worktree = git.worktrees(repo)?.into_iter().find(|w| crate::projects::same_folder(Path::new(&w.path), &dest)).ok_or_else(|| "the worktree was created but Git does not list it".to_string())?;
    Ok((Created { worktree, base: format!("pull request #{}", pr.number), note, warnings }, reuse))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::path::PathBuf;
    use std::process::Command;

    fn temp(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("kolux-rs-prco-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn git_in(dir: &Path, args: &[&str]) -> String {
        let out = Command::new("git").args(args).current_dir(dir).output().unwrap();
        assert!(out.status.success(), "git {args:?} in {}: {}", dir.display(), String::from_utf8_lossy(&out.stderr));
        String::from_utf8_lossy(&out.stdout).trim().to_string()
    }

    fn commit(dir: &Path, file: &str) -> String {
        fs::write(dir.join(file), file).unwrap();
        git_in(dir, &["add", "."]);
        git_in(dir, &["commit", "-q", "-m", file]);
        git_in(dir, &["rev-parse", "HEAD"])
    }

    /// A recorded `gh pr list --json PR_HEAD_FIELDS` answer (the fields gh documents for pr list).
    const LISTED: &str = r#"[{"headRefName":"feat/login","headRefOid":"OID1","headRepository":{"id":"R_1","name":"app"},"headRepositoryOwner":{"id":"U_1","login":"txais"},"isCrossRepository":false,"number":12,"title":"Fix the login page","url":"https://github.com/txais/app/pull/12"},{"headRefName":"main","headRefOid":"OID2","headRepository":{"id":"R_2","name":"app-fork"},"headRepositoryOwner":{"id":"U_2","login":"Someone"},"isCrossRepository":true,"number":13,"title":"Docs","url":"https://github.com/txais/app/pull/13"}]"#;

    #[test]
    fn gh_answers_are_read_as_pull_request_heads() {
        let heads = parse_heads(LISTED).unwrap();
        assert_eq!(heads.len(), 2);
        assert_eq!((heads[0].number, heads[0].head_ref_name.as_str(), heads[0].is_cross_repository), (12, "feat/login", false));
        assert_eq!(heads[1].head_repository_owner.as_ref().unwrap().login, "Someone");
        assert_eq!(heads[1].head_repository.as_ref().unwrap().name, "app-fork");
        let one = parse_heads(r#"{"number":5,"title":"t","url":"u","headRefName":"x","headRefOid":"y"}"#).unwrap();
        assert_eq!(one[0].number, 5);
        assert!(parse_heads("not json").is_err());
    }

    #[test]
    fn a_forks_address_follows_origins_form() {
        assert_eq!(fork_url("https://github.com/txais/app.git", "someone", "app-fork").as_deref(), Some("https://github.com/someone/app-fork.git"));
        assert_eq!(fork_url("git@github.com:txais/app.git", "someone", "app").as_deref(), Some("git@github.com:someone/app.git"));
        assert_eq!(fork_url("https://github.com/txais/app", "o", "n").as_deref(), Some("https://github.com/o/n"));
        assert_eq!(fork_url("C:/repos/app", "o", "n"), None);
    }

    #[test]
    fn proj037_the_project_is_the_one_with_a_remote_at_the_item_repository() {
        let remotes = "remote.origin.url https://github.com/Acme/App.git\nremote.fork.url git@github.com:me/app.git\n";
        assert!(has_repo(remotes, "github.com", "acme", "app"), "case does not matter");
        assert!(has_repo(remotes, "github.com", "me", "app"), "any remote counts");
        assert!(!has_repo(remotes, "github.com", "acme", "other"));
        assert!(!has_repo(remotes, "ghe.corp.example", "acme", "app"), "the host counts");
        assert!(!has_repo("", "github.com", "acme", "app"));
        let issue = parse_issue(r#"{"number":34,"title":"Crash on save","url":"https://github.com/acme/app/issues/34"}"#).unwrap();
        assert_eq!((issue.number, issue.title.as_str()), (34, "Crash on save"));
        assert!(parse_issue("not json").unwrap_err().contains("cannot read"));
    }

    #[test]
    fn proj030_a_clashing_remote_name_gets_a_suffix() {
        let repo = temp("remote");
        git_in(&repo, &["init", "-q", "-b", "main"]);
        git_in(&repo, &["remote", "add", "someone", "https://example.com/other.git"]);
        assert_eq!(remote_for(&repo, "Someone", "https://example.com/fork.git").unwrap(), "someone-2");
        // Asked again, the remote already pointing at the fork is reused, not a third made.
        assert_eq!(remote_for(&repo, "Someone", "https://example.com/fork.git").unwrap(), "someone-2");
        assert_eq!(remote_for(&repo, "fresh", "https://example.com/f.git").unwrap(), "fresh");
        assert_eq!(git_in(&repo, &["remote", "get-url", "someone"]), "https://example.com/other.git", "the old remote is untouched");
        let _ = fs::remove_dir_all(repo);
    }

    #[test]
    fn proj030_a_local_pr_branch_is_reused_only_at_the_pr_head() {
        let git = Git::detect().unwrap();
        let remote = temp("origin");
        git_in(&remote, &["init", "-q", "--bare", "-b", "main"]);
        let repo = temp("repo");
        git_in(&repo, &["init", "-q", "-b", "main"]);
        git_in(&repo, &["config", "user.email", "t@example.com"]);
        git_in(&repo, &["config", "user.name", "t"]);
        commit(&repo, "a.txt");
        let url = remote.to_string_lossy().to_string();
        git_in(&repo, &["remote", "add", "origin", &url]);
        git_in(&repo, &["push", "-q", "origin", "main"]);
        // The pull request's branch is on origin, one commit ahead of a local copy that lags.
        git_in(&repo, &["checkout", "-q", "-b", "feat/login"]);
        let old = commit(&repo, "b.txt");
        git_in(&repo, &["push", "-q", "origin", "feat/login"]);
        let tip = commit(&repo, "c.txt");
        git_in(&repo, &["push", "-q", "origin", "feat/login"]);
        git_in(&repo, &["reset", "-q", "--hard", &old]);
        git_in(&repo, &["checkout", "-q", "main"]);
        let root = temp("root");
        let project = Project { id: "p".into(), name: "repo".into(), path: repo.to_string_lossy().to_string(), workspaces_dir: None, base: None };
        let place = Place { root: root.clone(), flat: false, prefix: String::new(), prefix_warning: None, refresh: false };
        let pr = PrHead { number: 12, title: "Fix the login page".into(), url: "https://github.com/t/r/pull/12".into(), head_ref_name: "feat/login".into(), head_ref_oid: tip.clone(), is_cross_repository: false, head_repository_owner: None, head_repository: None };
        // Lagging local branch: left alone, a new branch made at the head.
        let (made, reused) = open(&git, &place, &project, &pr, None, None, &|| false).unwrap();
        assert!(!reused);
        assert_eq!(made.worktree.branch.as_deref(), Some("feat/login-pr-12"));
        assert_eq!(git_in(Path::new(&made.worktree.path), &["rev-parse", "HEAD"]), tip);
        assert_eq!(git_in(&repo, &["rev-parse", "feat/login"]), old, "the lagging branch is not moved");
        assert_eq!(git_in(&repo, &["rev-parse", "--abbrev-ref", "feat/login-pr-12@{upstream}"]), "origin/feat/login");
        assert!(made.note.unwrap().contains("not at the pull request's head"));
        // A local branch at the head is reused as it is.
        git_in(&repo, &["branch", "-f", "feat/login", &tip]);
        let (again, reused) = open(&git, &place, &project, &pr, None, Some("second look"), &|| false).unwrap();
        assert!(reused);
        assert_eq!(again.worktree.branch.as_deref(), Some("feat/login"));
        assert!(again.worktree.path.ends_with("second-look"));
        // From a fork: the head comes through a remote named after the fork's owner.
        let fork = temp("fork");
        git_in(&fork, &["clone", "-q", "--bare", &url, "."]);
        let pr2 = PrHead { number: 13, head_ref_name: "feat/login".into(), head_ref_oid: tip.clone(), is_cross_repository: true, head_repository_owner: Some(Login { login: "someone".into() }), ..pr.clone() };
        git_in(&repo, &["remote", "add", "someone", "https://example.com/elsewhere.git"]);
        let fork_s = fork.to_string_lossy().to_string();
        git_in(&repo, &["worktree", "remove", "--force", &again.worktree.path]);
        git_in(&repo, &["branch", "-f", "feat/login", &old]);
        let (forked, _) = open(&git, &place, &project, &pr2, Some(&fork_s), None, &|| false).unwrap();
        assert_eq!(git_in(&repo, &["remote", "get-url", "someone-2"]), fork_s);
        assert_eq!(forked.worktree.branch.as_deref(), Some("feat/login-pr-13"));
        assert_eq!(git_in(&repo, &["rev-parse", "--abbrev-ref", "feat/login-pr-13@{upstream}"]), "someone-2/feat/login");
        // Overtaken after Git made it: the folder goes and so does the branch it made.
        let asked = std::cell::Cell::new(0);
        let late = || {
            asked.set(asked.get() + 1);
            asked.get() > 1
        };
        let pr3 = PrHead { number: 14, ..pr.clone() };
        assert_eq!(open(&git, &place, &project, &pr3, None, Some("gone"), &late).unwrap_err(), crate::projects::OVERTAKEN);
        assert!(sha(&repo, "refs/heads/feat/login-pr-14").is_none());
        for d in [remote, repo, root, fork] {
            let _ = fs::remove_dir_all(d);
        }
    }
}
