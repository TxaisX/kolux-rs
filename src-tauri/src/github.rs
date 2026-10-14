//! Tasks' own GitHub reads (T-314): a repository's fork parent (GIT-055) and the people who can be
//! assigned, mentioned or asked for a review (GIT-053, GIT-054's people pickers). Every call goes
//! through gh, like the rest of Tasks (scm.rs).

use crate::scm::{gh_program, gh_run, gh_words};
use std::path::Path;

/// One person on a GitHub host, with their avatar address (empty when GitHub gave none, so the
/// page falls back to initials, which is also what GitHub Enterprise without avatars gets).
#[derive(Clone, Debug, Default, PartialEq, Eq, serde::Serialize)]
pub struct Person {
    pub login: String,
    pub avatar: String,
}

/// `owner/name` checked to plain GitHub names, and the host to a plain host name; anything else is
/// refused before gh sees it.
fn repo_path(host: &str, repo: &str) -> Result<String, String> {
    if host.is_empty() || !host.chars().all(|c| c.is_ascii_alphanumeric() || c == '.' || c == '-' || c == ':') {
        return Err("This repository's GitHub host cannot be read".into());
    }
    let plain = |p: &str| !p.is_empty() && p != "." && p != ".." && p.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_' || c == '.');
    match repo.split_once('/') {
        Some((o, n)) if plain(o) && plain(n) => Ok(format!("repos/{o}/{n}")),
        _ => Err("This repository's name cannot be read".into()),
    }
}

fn gh_json(gh: &Path, host: &str, path: &str, extra: &[&str]) -> Result<serde_json::Value, String> {
    let args: Vec<&str> = ["api", path, "--hostname", host].into_iter().chain(extra.iter().copied()).collect();
    let text = gh_run(gh, &std::env::temp_dir(), &args, None).map_err(|e| format!("{host}: {}", gh_words(&e)))?;
    serde_json::from_str(&text).map_err(|e| format!("gh answered in a form Kolux cannot read: {e}"))
}

/// GIT-055: the parent (`owner/name`) of a fork, from GitHub's repository record; None when the
/// repository is not a fork or its parent is gone.
pub fn parent_of(v: &serde_json::Value) -> Option<String> {
    if v["fork"].as_bool() != Some(true) {
        return None;
    }
    v["parent"]["full_name"].as_str().filter(|s| s.contains('/')).map(String::from)
}

/// GIT-055: the fork parent of `repo` on `host`.
pub fn repo_parent(gh: &Path, host: &str, repo: &str) -> Result<Option<String>, String> {
    Ok(parent_of(&gh_json(gh, host, &repo_path(host, repo)?, &[])?))
}

/// GIT-053: people from a GitHub user list, each once, in GitHub's order.
pub fn people_of(v: &serde_json::Value) -> Vec<Person> {
    let mut out: Vec<Person> = Vec::new();
    for u in v.as_array().into_iter().flatten() {
        let Some(login) = u["login"].as_str().filter(|l| !l.is_empty()) else { continue };
        if out.iter().all(|p| !p.login.eq_ignore_ascii_case(login)) {
            let avatar = u["avatar_url"].as_str().filter(|a| a.starts_with("https://")).unwrap_or("");
            out.push(Person { login: login.into(), avatar: avatar.into() });
        }
    }
    out
}

/// GIT-053: the people who can be assigned in `repo` (GitHub's assignees list, first 100), which
/// is who the mention, assignee and reviewer pickers offer.
// ponytail: one page of 100; recent editors of a PR's files join the reviewer list with T-232-c.
pub fn repo_people(gh: &Path, host: &str, repo: &str) -> Result<Vec<Person>, String> {
    let path = format!("{}/assignees", repo_path(host, repo)?);
    Ok(people_of(&gh_json(gh, host, &path, &["-X", "GET", "-f", "per_page=100"])?))
}

#[tauri::command]
pub async fn github_repo_parent(host: String, repo: String) -> Result<Option<String>, String> {
    tauri::async_runtime::spawn_blocking(move || repo_parent(&gh_program()?, &host, &repo)).await.map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn github_people(host: String, repo: String) -> Result<Vec<Person>, String> {
    tauri::async_runtime::spawn_blocking(move || repo_people(&gh_program()?, &host, &repo)).await.map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use std::fs;

    #[test]
    fn a_fork_names_its_parent_and_a_plain_repository_has_none() {
        assert_eq!(parent_of(&json!({"fork": true, "parent": {"full_name": "up/stream"}})), Some("up/stream".into()));
        assert_eq!(parent_of(&json!({"fork": false, "parent": {"full_name": "up/stream"}})), None);
        assert_eq!(parent_of(&json!({"fork": true})), None, "a fork whose parent is gone has no parent");
        assert_eq!(parent_of(&json!({"fork": true, "parent": {"full_name": ""}})), None);
    }

    #[test]
    fn people_come_once_each_and_a_missing_avatar_falls_back_to_none() {
        let got = people_of(&json!([
            {"login": "txais", "avatar_url": "https://avatars.example/u/1"},
            {"login": "TXAIS", "avatar_url": "https://avatars.example/u/1"},
            {"login": "ghe-user"},
            {"login": "", "avatar_url": "https://x"},
            {"login": "odd", "avatar_url": "javascript:alert(1)"}
        ]));
        assert_eq!(got.iter().map(|p| p.login.as_str()).collect::<Vec<_>>(), ["txais", "ghe-user", "odd"]);
        assert_eq!(got[0].avatar, "https://avatars.example/u/1");
        assert_eq!(got[1].avatar, "", "GitHub Enterprise without avatars falls back cleanly");
        assert_eq!(got[2].avatar, "", "only https avatars are kept");
        assert!(people_of(&json!({"message": "Not Found"})).is_empty());
    }

    #[test]
    fn odd_hosts_and_repository_names_never_reach_gh() {
        assert_eq!(repo_path("github.com", "o/r").unwrap(), "repos/o/r");
        for (h, r) in [("github.com", "o"), ("github.com", "../r"), ("github.com", "o/r/x"), ("github.com", "o/.."), ("git hub", "o/r"), ("", "o/r"), ("github.com", "o/r?x=1")] {
            assert!(repo_path(h, r).is_err(), "{h} {r}");
        }
    }

    #[test]
    fn the_parent_and_people_reads_ask_gh_for_the_right_addresses() {
        let dir = crate::test_dir::temp("github-reads");
        let gh = if cfg!(windows) {
            let f = dir.join("gh.cmd");
            fs::write(
                &f,
                "@echo off\r\necho %*>>\"%~dp0calls.txt\"\r\necho %2| findstr assignees >nul && goto people\r\necho {\"fork\":true,\"parent\":{\"full_name\":\"up/stream\"}}\r\nexit /b 0\r\n:people\r\necho [{\"login\":\"ana\",\"avatar_url\":\"https://a/1\"}]\r\nexit /b 0\r\n",
            )
            .unwrap();
            f
        } else {
            let f = dir.join("gh");
            fs::write(&f, "#!/bin/sh\necho \"$*\" >> \"$(dirname \"$0\")/calls.txt\"\ncase \"$2\" in *assignees*) echo '[{\"login\":\"ana\",\"avatar_url\":\"https://a/1\"}]';; *) echo '{\"fork\":true,\"parent\":{\"full_name\":\"up/stream\"}}';; esac\n").unwrap();
            #[cfg(unix)]
            {
                use std::os::unix::fs::PermissionsExt;
                fs::set_permissions(&f, fs::Permissions::from_mode(0o755)).unwrap();
            }
            f
        };
        assert_eq!(repo_parent(&gh, "github.com", "me/fork").unwrap(), Some("up/stream".into()));
        assert_eq!(repo_people(&gh, "github.com", "up/stream").unwrap(), vec![Person { login: "ana".into(), avatar: "https://a/1".into() }]);
        let calls = fs::read_to_string(dir.join("calls.txt")).unwrap();
        assert!(calls.contains("api repos/me/fork --hostname github.com"), "{calls}");
        // cmd.exe quoting may wrap the field in quotes, so the field is checked on its own.
        assert!(calls.contains("api repos/up/stream/assignees --hostname github.com -X GET -f ") && calls.contains("per_page=100"), "{calls}");
        assert!(repo_parent(&gh, "github.com", "bad").is_err());
    }
}
