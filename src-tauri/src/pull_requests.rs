//! T-232-c (GIT-051): what the full pull request page reads and writes through gh: the page itself
//! (description, reviewers and their review states, reactions), its files, its checks, its review
//! threads, and the writes (close or reopen, rerun checks, reviewers, assignees, a reaction, a reply,
//! the merge). Every call is `gh api` against a plain host (the same gate as github.rs); request
//! bodies go to gh on standard input, never on its command line. Merging is an outward action: it is
//! refused unless the caller says the user confirmed it.

use crate::github::{full_name_ok, gh_json, host_allowed, login_ok, repo_path, s, COMMENT_MAX};
use crate::scm::{gh_program, gh_run, gh_words};
use serde_json::{json, Value};
use std::path::Path;

/// GitHub's limit on reviewers requested at once (people.ts keeps the same number).
const MAX_REVIEWERS: usize = 15;
/// A file's diff is cut at this many characters before it crosses to the page.
const PATCH_MAX: usize = 20_000;
/// One page of files, checks or comments (GitHub's largest page).
const PER_PAGE: usize = 100;
/// Files, reviews and review comments are read this many pages deep (500 each); past that the page
/// says it shows the first 500 (FIX-1, review FIX-SOON 2).
const PAGE_CAP: usize = 5;
/// The reactions GitHub accepts.
const REACTIONS: [&str; 8] = ["+1", "-1", "laugh", "confused", "heart", "hooray", "rocket", "eyes"];

#[derive(Clone, Debug, PartialEq, Eq, serde::Serialize)]
pub struct Label {
    pub name: String,
    pub color: String,
}

/// A requested or past reviewer; `state` is requested, approved, changes_requested, dismissed or commented.
#[derive(Clone, Debug, PartialEq, Eq, serde::Serialize)]
pub struct Reviewer {
    pub login: String,
    pub state: String,
}

#[derive(Clone, Debug, PartialEq, Eq, serde::Serialize)]
pub struct Reaction {
    pub content: String,
    pub count: u64,
}

#[derive(Clone, Debug, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PrPage {
    pub number: u64,
    pub title: String,
    pub body: String,
    /// open, closed or merged.
    pub state: String,
    pub draft: bool,
    pub url: String,
    pub author: String,
    pub head_ref: String,
    pub head_sha: String,
    pub base_ref: String,
    /// GitHub's word for whether it can merge: clean, blocked, behind, dirty, unstable, unknown...
    pub mergeable_state: String,
    pub labels: Vec<Label>,
    pub assignees: Vec<String>,
    pub reviewers: Vec<Reviewer>,
    pub reactions: Vec<Reaction>,
    pub additions: u64,
    pub deletions: u64,
    pub changed_files: u64,
    /// More reviews exist than were read (the page says the reviewer states may be stale).
    pub reviews_truncated: bool,
}

/// A pull request's files; `truncated` when GitHub has more than the page reads.
#[derive(Clone, Debug, PartialEq, Eq, serde::Serialize)]
pub struct PrFiles {
    pub files: Vec<PrFile>,
    pub truncated: bool,
}

/// A pull request's review threads; `truncated` when GitHub has more comments than the page reads.
#[derive(Clone, Debug, PartialEq, Eq, serde::Serialize)]
pub struct PrThreads {
    pub threads: Vec<PrThread>,
    pub truncated: bool,
}

#[derive(Clone, Debug, PartialEq, Eq, serde::Serialize)]
pub struct PrFile {
    pub filename: String,
    pub status: String,
    pub additions: u64,
    pub deletions: u64,
    pub patch: String,
}

#[derive(Clone, Debug, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PrCheck {
    pub id: u64,
    pub name: String,
    /// queued, in_progress or completed.
    pub status: String,
    /// success, failure, neutral, cancelled, skipped, timed_out, action_required or empty while running.
    pub conclusion: String,
    pub url: String,
    /// The workflow run the check belongs to (the number in its address), when it is a workflow job.
    pub run_id: Option<u64>,
}

#[derive(Clone, Debug, PartialEq, Eq, serde::Serialize)]
pub struct PrComment {
    pub id: u64,
    pub author: String,
    pub body: String,
    pub at: String,
}

/// One review thread: the comment it started with and the replies, in order.
#[derive(Clone, Debug, PartialEq, Eq, serde::Serialize)]
pub struct PrThread {
    pub id: u64,
    pub path: String,
    pub line: Option<u64>,
    pub comments: Vec<PrComment>,
}

fn n(v: &Value) -> u64 {
    v.as_u64().unwrap_or(0)
}

fn login(v: &Value) -> String {
    let l = s(&v["login"]);
    if login_ok(&l) {
        l
    } else {
        String::new()
    }
}

/// Reviewers: everyone with a pending request ("requested"), then each past reviewer by their latest
/// review that decided something (approved, changes requested, dismissed), else "commented".
/// The pull request's author is never listed; a bad login is dropped.
pub fn reviewers_of(pull: &Value, reviews: &Value) -> Vec<Reviewer> {
    let author = login(&pull["user"]);
    let mut out: Vec<Reviewer> = Vec::new();
    for r in pull["requested_reviewers"].as_array().into_iter().flatten() {
        let l = login(r);
        if !l.is_empty() && !out.iter().any(|x| x.login == l) {
            out.push(Reviewer { login: l, state: "requested".into() });
        }
    }
    let mut past: Vec<Reviewer> = Vec::new();
    for r in reviews.as_array().into_iter().flatten() {
        let l = login(&r["user"]);
        if l.is_empty() || l == author || out.iter().any(|x| x.login == l) {
            continue;
        }
        let state = match s(&r["state"]).as_str() {
            "APPROVED" => "approved",
            "CHANGES_REQUESTED" => "changes_requested",
            "DISMISSED" => "dismissed",
            _ => "commented",
        };
        match past.iter_mut().find(|x| x.login == l) {
            // A later comment-only review never hides an earlier decision.
            Some(_) if state == "commented" => {}
            Some(x) => x.state = state.into(),
            None => past.push(Reviewer { login: l, state: state.into() }),
        }
    }
    out.extend(past);
    out
}

/// The page from GitHub's pull request, its reviews and its issue record (which carries the reactions).
pub fn page_of(pull: &Value, reviews: &Value, issue: &Value) -> Result<PrPage, String> {
    let number = n(&pull["number"]);
    if number == 0 {
        return Err("GitHub did not describe this pull request; refresh and try again.".into());
    }
    let state = if pull["merged"].as_bool() == Some(true) || !pull["merged_at"].is_null() { "merged".to_string() } else { s(&pull["state"]) };
    let labels = pull["labels"].as_array().into_iter().flatten().map(|l| Label { name: s(&l["name"]), color: s(&l["color"]) }).filter(|l| !l.name.is_empty()).collect();
    let assignees = pull["assignees"].as_array().into_iter().flatten().map(login).filter(|l| !l.is_empty()).collect();
    let reactions = REACTIONS
        .iter()
        .filter_map(|c| {
            let count = n(&issue["reactions"][*c]);
            (count > 0).then(|| Reaction { content: (*c).to_string(), count })
        })
        .collect();
    Ok(PrPage {
        number,
        title: s(&pull["title"]),
        body: s(&pull["body"]),
        state,
        draft: pull["draft"].as_bool() == Some(true),
        url: s(&pull["html_url"]),
        author: login(&pull["user"]),
        head_ref: s(&pull["head"]["ref"]),
        head_sha: s(&pull["head"]["sha"]),
        base_ref: s(&pull["base"]["ref"]),
        mergeable_state: s(&pull["mergeable_state"]),
        labels,
        assignees,
        reviewers: reviewers_of(pull, reviews),
        reactions,
        additions: n(&pull["additions"]),
        deletions: n(&pull["deletions"]),
        changed_files: n(&pull["changed_files"]),
        reviews_truncated: false,
    })
}

pub fn files_of(v: &Value) -> Vec<PrFile> {
    v.as_array()
        .into_iter()
        .flatten()
        .map(|f| PrFile {
            filename: s(&f["filename"]),
            status: s(&f["status"]),
            additions: n(&f["additions"]),
            deletions: n(&f["deletions"]),
            patch: s(&f["patch"]).chars().take(PATCH_MAX).collect(),
        })
        .filter(|f| !f.filename.is_empty())
        .collect()
}

/// The workflow run in a check's address (`.../actions/runs/<run>/job/<job>`).
pub fn run_id_of(url: &str) -> Option<u64> {
    let rest = url.split("/actions/runs/").nth(1)?;
    let digits: String = rest.chars().take_while(char::is_ascii_digit).collect();
    digits.parse().ok().filter(|n| *n > 0)
}

pub fn checks_of(v: &Value) -> Vec<PrCheck> {
    v["check_runs"]
        .as_array()
        .into_iter()
        .flatten()
        .map(|c| {
            let url = s(&c["html_url"]);
            PrCheck { id: n(&c["id"]), name: s(&c["name"]), status: s(&c["status"]), conclusion: s(&c["conclusion"]), run_id: run_id_of(&url), url }
        })
        .filter(|c| !c.name.is_empty())
        .collect()
}

/// Review comments grouped into threads: a comment that replies to another joins that comment's thread.
pub fn threads_of(v: &Value) -> Vec<PrThread> {
    let mut threads: Vec<PrThread> = Vec::new();
    for c in v.as_array().into_iter().flatten() {
        let id = n(&c["id"]);
        let comment = PrComment { id, author: login(&c["user"]), body: s(&c["body"]), at: s(&c["created_at"]) };
        let parent = n(&c["in_reply_to_id"]);
        if parent != 0 {
            if let Some(t) = threads.iter_mut().find(|t| t.comments.iter().any(|x| x.id == parent)) {
                t.comments.push(comment);
                continue;
            }
        }
        threads.push(PrThread { id, path: s(&c["path"]), line: c["line"].as_u64().or_else(|| c["original_line"].as_u64()), comments: vec![comment] });
    }
    threads
}

fn issue_path(host: &str, repo: &str, number: u64, tail: &str) -> Result<String, String> {
    if number == 0 {
        return Err("A pull request number is more than zero.".into());
    }
    Ok(format!("{}/{tail}", repo_path(host, repo)?))
}

fn pull_path(host: &str, repo: &str, number: u64, tail: &str) -> Result<String, String> {
    if number == 0 {
        return Err("A pull request number is more than zero.".into());
    }
    let base = format!("{}/pulls/{number}", repo_path(host, repo)?);
    Ok(if tail.is_empty() { base } else { format!("{base}/{tail}") })
}

/// A list endpoint read page by page, at most PAGE_CAP pages of PER_PAGE: everything it has, and
/// whether it has more (one more page is asked for only when the last allowed page was full).
fn read_all(gh: &Path, host: &str, path: &str) -> Result<(Value, bool), String> {
    let mut all: Vec<Value> = Vec::new();
    for page in 1..=PAGE_CAP + 1 {
        let got = gh_json(gh, host, &format!("{path}?per_page={PER_PAGE}&page={page}"), &[])?;
        let items = got.as_array().cloned().unwrap_or_default();
        if page > PAGE_CAP {
            return Ok((Value::Array(all), !items.is_empty()));
        }
        let full = items.len() >= PER_PAGE;
        all.extend(items);
        if !full {
            break;
        }
    }
    Ok((Value::Array(all), false))
}

pub fn read_page(gh: &Path, host: &str, repo: &str, number: u64) -> Result<PrPage, String> {
    let pull = gh_json(gh, host, &pull_path(host, repo, number, "")?, &[])?;
    let (reviews, more) = read_all(gh, host, &pull_path(host, repo, number, "reviews")?)?;
    let issue = gh_json(gh, host, &issue_path(host, repo, number, &format!("issues/{number}"))?, &[])?;
    let mut page = page_of(&pull, &reviews, &issue)?;
    page.reviews_truncated = more;
    Ok(page)
}

pub fn read_files(gh: &Path, host: &str, repo: &str, number: u64) -> Result<PrFiles, String> {
    let (all, truncated) = read_all(gh, host, &pull_path(host, repo, number, "files")?)?;
    Ok(PrFiles { files: files_of(&all), truncated })
}

/// A commit id as GitHub prints it: 7 to 64 hex digits.
fn sha_ok(sha: &str) -> bool {
    sha.len() >= 7 && sha.len() <= 64 && sha.chars().all(|c| c.is_ascii_hexdigit())
}

pub fn read_checks(gh: &Path, host: &str, repo: &str, sha: &str) -> Result<Vec<PrCheck>, String> {
    if !sha_ok(sha) {
        return Err("This pull request's latest commit cannot be read.".into());
    }
    Ok(checks_of(&gh_json(gh, host, &format!("{}/commits/{sha}/check-runs?per_page={PER_PAGE}", repo_path(host, repo)?), &[])?))
}

pub fn read_threads(gh: &Path, host: &str, repo: &str, number: u64) -> Result<PrThreads, String> {
    let (all, truncated) = read_all(gh, host, &pull_path(host, repo, number, "comments")?)?;
    Ok(PrThreads { threads: threads_of(&all), truncated })
}

/// One write: `method` on `path`, the JSON body (when there is one) on standard input.
fn write(gh: &Path, host: &str, method: &str, path: &str, body: Option<Value>) -> Result<Value, String> {
    host_allowed(gh, host)?;
    let input = body.map(|b| b.to_string());
    let mut args = vec!["api", "-X", method, path, "--hostname", host];
    if input.is_some() {
        args.extend(["--input", "-"]);
    }
    let text = gh_run(gh, &std::env::temp_dir(), &args, input.as_deref()).map_err(|e| format!("{host}: {}", gh_words(&e)))?;
    Ok(serde_json::from_str(&text).unwrap_or(Value::Null))
}

/// Close or reopen a pull request.
pub fn set_state(gh: &Path, host: &str, repo: &str, number: u64, open: bool) -> Result<String, String> {
    let path = pull_path(host, repo, number, "")?;
    let v = write(gh, host, "PATCH", &path, Some(json!({ "state": if open { "open" } else { "closed" } })))?;
    Ok(if v["state"].is_string() { s(&v["state"]) } else { (if open { "open" } else { "closed" }).to_string() })
}

/// Rerun every job of a workflow run, or only its failed jobs.
pub fn rerun(gh: &Path, host: &str, repo: &str, run_id: u64, failed_only: bool) -> Result<(), String> {
    if run_id == 0 {
        return Err("This check has no workflow run to rerun.".into());
    }
    let path = format!("{}/actions/runs/{run_id}/{}", repo_path(host, repo)?, if failed_only { "rerun-failed-jobs" } else { "rerun" });
    write(gh, host, "POST", &path, None).map(|_| ())
}

fn logins_ok(list: &[String]) -> Result<(), String> {
    match list.iter().find(|l| !login_ok(l)) {
        Some(bad) => Err(format!("{bad} is not a GitHub login.")),
        None => Ok(()),
    }
}

/// Ask people for a review, or take a request back. More than fifteen asked at once is refused here
/// too (GitHub's limit); the page checks the total against the requests already there.
pub fn reviewers(gh: &Path, host: &str, repo: &str, number: u64, add: &[String], remove: &[String]) -> Result<(), String> {
    logins_ok(add)?;
    logins_ok(remove)?;
    if add.len() > MAX_REVIEWERS {
        return Err(format!("A pull request can have at most {MAX_REVIEWERS} reviewers."));
    }
    let path = pull_path(host, repo, number, "requested_reviewers")?;
    if !remove.is_empty() {
        write(gh, host, "DELETE", &path, Some(json!({ "reviewers": remove })))?;
    }
    if !add.is_empty() {
        write(gh, host, "POST", &path, Some(json!({ "reviewers": add })))?;
    }
    Ok(())
}

/// Add or remove assignees on an issue or a pull request (GitHub keeps both under issues).
pub fn assignees(gh: &Path, host: &str, repo: &str, number: u64, add: &[String], remove: &[String]) -> Result<(), String> {
    logins_ok(add)?;
    logins_ok(remove)?;
    let path = issue_path(host, repo, number, &format!("issues/{number}/assignees"))?;
    if !remove.is_empty() {
        write(gh, host, "DELETE", &path, Some(json!({ "assignees": remove })))?;
    }
    if !add.is_empty() {
        write(gh, host, "POST", &path, Some(json!({ "assignees": add })))?;
    }
    Ok(())
}

pub fn react(gh: &Path, host: &str, repo: &str, number: u64, content: &str) -> Result<(), String> {
    if !REACTIONS.contains(&content) {
        return Err(format!("GitHub has no reaction called {content}."));
    }
    let path = issue_path(host, repo, number, &format!("issues/{number}/reactions"))?;
    write(gh, host, "POST", &path, Some(json!({ "content": content }))).map(|_| ())
}

pub fn reply(gh: &Path, host: &str, repo: &str, number: u64, comment: u64, body: &str) -> Result<(), String> {
    if comment == 0 {
        return Err("Pick the comment to reply to.".into());
    }
    if body.trim().is_empty() {
        return Err("Write a reply first.".into());
    }
    if body.chars().count() > COMMENT_MAX {
        return Err(format!("A reply can be at most {COMMENT_MAX} characters."));
    }
    let path = pull_path(host, repo, number, &format!("comments/{comment}/replies"))?;
    write(gh, host, "POST", &path, Some(json!({ "body": body }))).map(|_| ())
}

/// Merge a pull request. Outward: nothing is sent unless `confirmed` (the page asks first), and the
/// merge is pinned to `sha`, the head commit the page showed: GitHub refuses (409) when someone has
/// pushed since, so commits the user never saw are never merged.
pub fn merge(gh: &Path, host: &str, repo: &str, number: u64, method: &str, confirmed: bool, sha: &str) -> Result<String, String> {
    if !confirmed {
        return Err("Merging changes the repository on GitHub; confirm it first.".into());
    }
    if !["merge", "squash", "rebase"].contains(&method) {
        return Err(format!("{method} is not a way to merge; use merge, squash or rebase."));
    }
    if !sha_ok(sha) {
        return Err("This pull request's latest commit cannot be read. Reload it before merging.".into());
    }
    let path = pull_path(host, repo, number, "merge")?;
    let v = write(gh, host, "PUT", &path, Some(json!({ "merge_method": method, "sha": sha }))).map_err(|e| {
        if e.contains("HTTP 409") || e.contains("Head branch was modified") {
            "The pull request changed. Reload it before merging.".to_string()
        } else {
            e
        }
    })?;
    if v["merged"].as_bool() == Some(false) {
        return Err(if s(&v["message"]).is_empty() { "GitHub did not merge it.".into() } else { s(&v["message"]) });
    }
    Ok(s(&v["sha"]))
}

async fn blocking<T: Send + 'static>(f: impl FnOnce(&Path) -> Result<T, String> + Send + 'static) -> Result<T, String> {
    tauri::async_runtime::spawn_blocking(move || f(&gh_program()?)).await.map_err(|e| e.to_string())?
}

fn repo_ok(repo: &str) -> Result<(), String> {
    if full_name_ok(repo) {
        Ok(())
    } else {
        Err("This repository's name cannot be read".into())
    }
}

#[tauri::command]
pub async fn pr_page(host: String, repo: String, number: u64) -> Result<PrPage, String> {
    blocking(move |gh| read_page(gh, &host, &repo, number)).await
}

#[tauri::command]
pub async fn pr_files(host: String, repo: String, number: u64) -> Result<PrFiles, String> {
    blocking(move |gh| read_files(gh, &host, &repo, number)).await
}

#[tauri::command]
pub async fn pr_checks(host: String, repo: String, sha: String) -> Result<Vec<PrCheck>, String> {
    blocking(move |gh| read_checks(gh, &host, &repo, &sha)).await
}

#[tauri::command]
pub async fn pr_threads(host: String, repo: String, number: u64) -> Result<PrThreads, String> {
    blocking(move |gh| read_threads(gh, &host, &repo, number)).await
}

#[tauri::command]
pub async fn pr_set_state(host: String, repo: String, number: u64, open: bool) -> Result<String, String> {
    blocking(move |gh| set_state(gh, &host, &repo, number, open)).await
}

#[tauri::command]
pub async fn pr_rerun(host: String, repo: String, run_id: u64, failed_only: bool) -> Result<(), String> {
    repo_ok(&repo)?;
    blocking(move |gh| rerun(gh, &host, &repo, run_id, failed_only)).await
}

#[tauri::command]
pub async fn pr_reviewers(host: String, repo: String, number: u64, add: Vec<String>, remove: Vec<String>) -> Result<(), String> {
    blocking(move |gh| reviewers(gh, &host, &repo, number, &add, &remove)).await
}

#[tauri::command]
pub async fn pr_assignees(host: String, repo: String, number: u64, add: Vec<String>, remove: Vec<String>) -> Result<(), String> {
    blocking(move |gh| assignees(gh, &host, &repo, number, &add, &remove)).await
}

#[tauri::command]
pub async fn pr_react(host: String, repo: String, number: u64, content: String) -> Result<(), String> {
    blocking(move |gh| react(gh, &host, &repo, number, &content)).await
}

#[tauri::command]
pub async fn pr_reply(host: String, repo: String, number: u64, comment: u64, body: String) -> Result<(), String> {
    blocking(move |gh| reply(gh, &host, &repo, number, comment, &body)).await
}

#[tauri::command]
pub async fn pr_merge(host: String, repo: String, number: u64, method: String, confirmed: bool, sha: String) -> Result<String, String> {
    blocking(move |gh| merge(gh, &host, &repo, number, &method, confirmed, &sha)).await
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    /// A stand-in gh: keeps every call's arguments and request body; call n answers with answer<n>.json
    /// when there is one, else answer.json. Never Txais's real GitHub.
    fn stand_in(name: &str, answer: &Value) -> (std::path::PathBuf, crate::test_dir::TempDir) {
        let dir = crate::test_dir::temp(name);
        fs::write(dir.join("answer.json"), answer.to_string()).unwrap();
        let gh = if cfg!(windows) {
            let f = dir.join("gh.cmd");
            fs::write(&f, "@echo off\r\necho %*>>\"%~dp0calls.txt\"\r\nmore >>\"%~dp0body.txt\"\r\nset /a n=0\r\nif exist \"%~dp0n.txt\" set /p n=<\"%~dp0n.txt\"\r\nset /a n+=1\r\n>\"%~dp0n.txt\" echo %n%\r\nif exist \"%~dp0answer%n%.json\" (type \"%~dp0answer%n%.json\") else (type \"%~dp0answer.json\")\r\n").unwrap();
            f
        } else {
            let f = dir.join("gh");
            fs::write(&f, "#!/bin/sh\nd=\"$(dirname \"$0\")\"\necho \"$*\" >> \"$d/calls.txt\"\ncat >> \"$d/body.txt\"\necho >> \"$d/body.txt\"\nn=$(( $(cat \"$d/n.txt\" 2>/dev/null || echo 0) + 1 ))\necho $n > \"$d/n.txt\"\nif [ -f \"$d/answer$n.json\" ]; then cat \"$d/answer$n.json\"; else cat \"$d/answer.json\"; fi\n").unwrap();
            #[cfg(unix)]
            {
                use std::os::unix::fs::PermissionsExt;
                fs::set_permissions(&f, fs::Permissions::from_mode(0o755)).unwrap();
            }
            f
        };
        (gh, dir)
    }

    fn calls(dir: &std::path::Path) -> String {
        fs::read_to_string(dir.join("calls.txt")).unwrap_or_default()
    }

    fn body(dir: &std::path::Path) -> Value {
        serde_json::from_str(fs::read_to_string(dir.join("body.txt")).unwrap().trim()).unwrap()
    }

    fn pull() -> Value {
        json!({
            "number": 7, "title": "Fix login", "body": "Closes #3", "state": "open", "merged": false, "merged_at": null, "draft": true,
            "html_url": "https://github.com/acme/app/pull/7", "user": { "login": "ana" }, "mergeable_state": "blocked",
            "head": { "ref": "fix-login", "sha": "abc1234" }, "base": { "ref": "main" },
            "labels": [{ "name": "bug", "color": "d73a4a" }, { "name": "" }],
            "assignees": [{ "login": "bo" }, { "login": "bad login" }],
            "requested_reviewers": [{ "login": "cy" }],
            "additions": 10, "deletions": 2, "changed_files": 3
        })
    }

    #[test]
    fn the_page_reads_state_reviewers_reactions_and_drops_bad_logins() {
        let reviews = json!([
            { "user": { "login": "dee" }, "state": "CHANGES_REQUESTED" },
            { "user": { "login": "dee" }, "state": "COMMENTED" },
            { "user": { "login": "eve" }, "state": "APPROVED" },
            { "user": { "login": "eve" }, "state": "DISMISSED" },
            { "user": { "login": "cy" }, "state": "APPROVED" },
            { "user": { "login": "ana" }, "state": "COMMENTED" },
            { "user": { "login": "fay" }, "state": "COMMENTED" }
        ]);
        let issue = json!({ "reactions": { "+1": 2, "heart": 0, "rocket": 1 } });
        let p = page_of(&pull(), &reviews, &issue).unwrap();
        assert_eq!((p.number, p.state.as_str(), p.draft, p.author.as_str()), (7, "open", true, "ana"));
        assert_eq!((p.head_ref.as_str(), p.head_sha.as_str(), p.base_ref.as_str(), p.mergeable_state.as_str()), ("fix-login", "abc1234", "main", "blocked"));
        assert_eq!(p.labels, vec![Label { name: "bug".into(), color: "d73a4a".into() }]);
        assert_eq!(p.assignees, vec!["bo".to_string()]);
        let who: Vec<(&str, &str)> = p.reviewers.iter().map(|r| (r.login.as_str(), r.state.as_str())).collect();
        // a pending request wins over the same person's past review; a later comment keeps an earlier decision; the author is not a reviewer
        assert_eq!(who, vec![("cy", "requested"), ("dee", "changes_requested"), ("eve", "dismissed"), ("fay", "commented")]);
        assert_eq!(p.reactions, vec![Reaction { content: "+1".into(), count: 2 }, Reaction { content: "rocket".into(), count: 1 }]);
        assert_eq!((p.additions, p.deletions, p.changed_files), (10, 2, 3));
        let mut merged = pull();
        merged["merged"] = json!(true);
        merged["state"] = json!("closed");
        assert_eq!(page_of(&merged, &json!([]), &json!({})).unwrap().state, "merged");
        assert!(page_of(&json!({}), &json!([]), &json!({})).is_err());
    }

    #[test]
    fn files_checks_and_threads_are_read_from_githubs_answers() {
        let files = files_of(&json!([{ "filename": "a.rs", "status": "modified", "additions": 3, "deletions": 1, "patch": "x".repeat(PATCH_MAX + 5) }, { "status": "added" }]));
        assert_eq!(files.len(), 1);
        assert_eq!(files[0].patch.chars().count(), PATCH_MAX);

        assert_eq!(run_id_of("https://github.com/acme/app/actions/runs/123456/job/789"), Some(123456));
        assert_eq!(run_id_of("https://github.com/acme/app/runs/55"), None);
        let checks = checks_of(&json!({ "check_runs": [
            { "id": 1, "name": "build", "status": "completed", "conclusion": "failure", "html_url": "https://github.com/acme/app/actions/runs/42/job/9" },
            { "id": 2, "name": "lint", "status": "in_progress", "conclusion": null, "html_url": "https://ci.example/x" },
            { "id": 3 }
        ] }));
        assert_eq!(checks.len(), 2);
        assert_eq!((checks[0].run_id, checks[0].conclusion.as_str()), (Some(42), "failure"));
        assert_eq!((checks[1].run_id, checks[1].conclusion.as_str()), (None, ""));

        let threads = threads_of(&json!([
            { "id": 10, "path": "a.rs", "line": 4, "body": "why?", "user": { "login": "ana" }, "created_at": "2026-10-01T00:00:00Z" },
            { "id": 11, "path": "b.rs", "line": null, "original_line": 9, "body": "nit", "user": { "login": "bo" }, "created_at": "2026-10-01T00:01:00Z" },
            { "id": 12, "path": "a.rs", "in_reply_to_id": 10, "body": "because", "user": { "login": "bo" }, "created_at": "2026-10-01T00:02:00Z" },
            { "id": 13, "path": "a.rs", "in_reply_to_id": 12, "body": "ok", "user": { "login": "ana" }, "created_at": "2026-10-01T00:03:00Z" }
        ]));
        assert_eq!(threads.len(), 2);
        assert_eq!(threads[0].comments.iter().map(|c| c.id).collect::<Vec<_>>(), vec![10, 12, 13]);
        assert_eq!((threads[1].path.as_str(), threads[1].line), ("b.rs", Some(9)));
    }

    #[test]
    fn reading_the_page_asks_for_the_pull_its_reviews_and_its_issue_record() {
        let (gh, dir) = stand_in("pr-page-reads", &pull());
        fs::write(dir.join("answer2.json"), "[]").unwrap();
        fs::write(dir.join("answer3.json"), "{\"reactions\":{\"eyes\":1}}").unwrap();
        let p = read_page(&gh, "github.com", "acme/app", 7).unwrap();
        assert_eq!(p.reactions, vec![Reaction { content: "eyes".into(), count: 1 }]);
        let c = calls(&dir);
        assert!(c.contains("api repos/acme/app/pulls/7 --hostname github.com"), "{c}");
        assert!(c.replace('"', "").contains("api repos/acme/app/pulls/7/reviews?per_page=100&page=1 --hostname github.com"), "{c}");
        assert!(c.contains("api repos/acme/app/issues/7 --hostname github.com"), "{c}");
        assert!(read_page(&gh, "github.com", "acme/../app", 7).is_err());
        assert!(read_page(&gh, "github.com", "acme/app", 0).is_err());
        assert!(read_checks(&gh, "github.com", "acme/app", "not a sha").is_err());
    }

    #[test]
    fn close_reopen_and_rerun_send_the_right_calls_and_refuse_nonsense() {
        let (gh, dir) = stand_in("pr-state-rerun", &json!({ "state": "closed" }));
        assert_eq!(set_state(&gh, "github.com", "acme/app", 7, false).unwrap(), "closed");
        assert!(calls(&dir).contains("api -X PATCH repos/acme/app/pulls/7 --hostname github.com --input -"));
        assert_eq!(body(&dir), json!({ "state": "closed" }));

        let (gh, dir) = stand_in("pr-rerun", &json!({}));
        rerun(&gh, "github.com", "acme/app", 42, true).unwrap();
        rerun(&gh, "github.com", "acme/app", 42, false).unwrap();
        let c = calls(&dir);
        assert!(c.contains("api -X POST repos/acme/app/actions/runs/42/rerun-failed-jobs --hostname github.com"), "{c}");
        assert!(c.contains("api -X POST repos/acme/app/actions/runs/42/rerun --hostname github.com"), "{c}");
        assert!(!c.contains("--input"), "a rerun has no body: {c}");
        let (gh, dir) = stand_in("pr-rerun-refused", &json!({}));
        assert!(rerun(&gh, "github.com", "acme/app", 0, true).is_err());
        assert!(!dir.join("calls.txt").exists());
    }

    #[test]
    fn reviewers_and_assignees_go_on_stdin_and_bad_logins_send_nothing() {
        let (gh, dir) = stand_in("pr-people", &json!({}));
        reviewers(&gh, "github.com", "acme/app", 7, &["cy".into(), "dee".into()], &["eve".into()]).unwrap();
        let c = calls(&dir);
        assert!(c.contains("api -X DELETE repos/acme/app/pulls/7/requested_reviewers --hostname github.com --input -"), "{c}");
        assert!(c.contains("api -X POST repos/acme/app/pulls/7/requested_reviewers --hostname github.com --input -"), "{c}");
        assert!(!c.contains("cy"), "logins go on stdin: {c}");
        assign_check(&gh, &dir);

        let (gh, dir) = stand_in("pr-people-refused", &json!({}));
        assert!(reviewers(&gh, "github.com", "acme/app", 7, &["bad login".into()], &[]).is_err());
        let sixteen: Vec<String> = (0..16).map(|i| format!("u{i}")).collect();
        assert!(reviewers(&gh, "github.com", "acme/app", 7, &sixteen, &[]).unwrap_err().contains("15"));
        let fifteen: Vec<String> = (0..15).map(|i| format!("u{i}")).collect();
        assert!(reviewers(&gh, "github.com", "acme/app", 7, &fifteen, &[]).is_ok());
        assert!(assignees(&gh, "github.com", "acme/app", 7, &["a/b".into()], &[]).is_err());
        assert_eq!(calls(&dir).lines().count(), 1, "only the fifteen were sent");
    }

    fn assign_check(gh: &Path, dir: &Path) {
        assignees(gh, "github.com", "acme/app", 9, &["ana".into()], &["bo".into()]).unwrap();
        let c = calls(dir);
        assert!(c.contains("api -X DELETE repos/acme/app/issues/9/assignees --hostname github.com --input -"), "{c}");
        assert!(c.contains("api -X POST repos/acme/app/issues/9/assignees --hostname github.com --input -"), "{c}");
    }

    #[test]
    fn a_reaction_and_a_reply_are_checked_before_they_are_sent() {
        let (gh, dir) = stand_in("pr-react-reply", &json!({}));
        react(&gh, "github.com", "acme/app", 7, "+1").unwrap();
        assert!(calls(&dir).contains("api -X POST repos/acme/app/issues/7/reactions --hostname github.com --input -"));
        assert!(react(&gh, "github.com", "acme/app", 7, "thumbsup").is_err());
        reply(&gh, "github.com", "acme/app", 7, 10, "Because \"x\"").unwrap();
        let c = calls(&dir);
        assert!(c.contains("api -X POST repos/acme/app/pulls/7/comments/10/replies --hostname github.com --input -"), "{c}");
        assert!(!c.contains("Because"), "the text goes on stdin: {c}");
        assert!(reply(&gh, "github.com", "acme/app", 7, 0, "x").is_err());
        assert!(reply(&gh, "github.com", "acme/app", 7, 10, "  ").is_err());
        assert!(reply(&gh, "github.com", "acme/app", 7, 10, &"x".repeat(COMMENT_MAX + 1)).is_err());
        assert_eq!(calls(&dir).lines().count(), 2, "only the two good ones were sent");
    }

    #[test]
    fn merging_is_refused_until_the_user_confirmed_it() {
        let (gh, dir) = stand_in("pr-merge", &json!({ "merged": true, "sha": "deadbeef" }));
        assert!(merge(&gh, "github.com", "acme/app", 7, "squash", false, "abc1234").unwrap_err().contains("confirm"));
        assert!(merge(&gh, "github.com", "acme/app", 7, "fast-forward", true, "abc1234").is_err());
        let long = "a".repeat(65);
        for bad in ["", "xyz1234", "abc12", long.as_str()] {
            assert!(merge(&gh, "github.com", "acme/app", 7, "squash", true, bad).unwrap_err().contains("Reload"), "{bad}");
        }
        assert!(!dir.join("calls.txt").exists(), "nothing reached gh without a confirmation");
        assert_eq!(merge(&gh, "github.com", "acme/app", 7, "squash", true, "abc1234").unwrap(), "deadbeef");
        assert!(calls(&dir).contains("api -X PUT repos/acme/app/pulls/7/merge --hostname github.com --input -"));
        // FIX-1 (review FIX-BEFORE 3): the merge is pinned to the head commit the page showed
        assert_eq!(body(&dir), json!({ "merge_method": "squash", "sha": "abc1234" }));

        let (gh, _keep) = stand_in("pr-merge-not", &json!({ "merged": false, "message": "Pull Request is not mergeable" }));
        assert!(merge(&gh, "github.com", "acme/app", 7, "merge", true, "abc1234").unwrap_err().contains("not mergeable"));
    }

    /// A stand-in gh that fails: prints `said` on standard error and exits 1, keeping the call and body.
    fn failing_stand_in(name: &str, said: &str) -> (std::path::PathBuf, crate::test_dir::TempDir) {
        let dir = crate::test_dir::temp(name);
        let gh = if cfg!(windows) {
            let f = dir.join("gh.cmd");
            fs::write(&f, format!("@echo off\r\necho %*>>\"%~dp0calls.txt\"\r\nmore >>\"%~dp0body.txt\"\r\necho {said} 1>&2\r\nexit /b 1\r\n")).unwrap();
            f
        } else {
            let f = dir.join("gh");
            fs::write(&f, format!("#!/bin/sh\nd=\"$(dirname \"$0\")\"\necho \"$*\" >> \"$d/calls.txt\"\ncat >> \"$d/body.txt\"\necho '{said}' >&2\nexit 1\n")).unwrap();
            #[cfg(unix)]
            {
                use std::os::unix::fs::PermissionsExt;
                fs::set_permissions(&f, fs::Permissions::from_mode(0o755)).unwrap();
            }
            f
        };
        (gh, dir)
    }

    #[test]
    fn a_merge_after_someone_pushed_reads_as_changed_and_other_failures_stay_as_they_are() {
        let (gh, dir) = failing_stand_in("pr-merge-409", "gh: Head branch was modified. Review and try the merge again. (HTTP 409)");
        assert_eq!(merge(&gh, "github.com", "acme/app", 7, "squash", true, "abc1234").unwrap_err(), "The pull request changed. Reload it before merging.");
        assert!(calls(&dir).contains("api -X PUT repos/acme/app/pulls/7/merge"));
        let (gh, _keep) = failing_stand_in("pr-merge-500", "gh: Server Error (HTTP 500)");
        let e = merge(&gh, "github.com", "acme/app", 7, "squash", true, "abc1234").unwrap_err();
        assert!(e.contains("HTTP 500") && !e.contains("changed"), "{e}");
    }

    fn file_items(n: usize) -> Vec<Value> {
        (0..n).map(|i| json!({ "filename": format!("f{i}.rs"), "status": "modified", "additions": 1, "deletions": 0, "patch": "x" })).collect()
    }

    #[test]
    fn files_past_a_hundred_are_read_page_by_page_and_a_cap_says_so() {
        // 100 on the first page, 3 on the second: all 103, nothing cut, two calls.
        let (gh, dir) = stand_in("pr-files-103", &json!(file_items(100)));
        fs::write(dir.join("answer2.json"), json!(file_items(3)).to_string()).unwrap();
        let got = read_files(&gh, "github.com", "acme/app", 7).unwrap();
        assert_eq!((got.files.len(), got.truncated), (103, false));
        let c = calls(&dir).replace('"', "");
        assert!(c.contains("pulls/7/files?per_page=100&page=1") && c.contains("pulls/7/files?per_page=100&page=2"), "{c}");
        assert_eq!(c.lines().count(), 2, "{c}");

        // every page full: five pages are read, one more is asked for, and the answer says there is more.
        let (gh, dir) = stand_in("pr-files-cap", &json!(file_items(100)));
        let got = read_files(&gh, "github.com", "acme/app", 7).unwrap();
        assert_eq!((got.files.len(), got.truncated), (PAGE_CAP * PER_PAGE, true));
        assert_eq!(calls(&dir).lines().count(), PAGE_CAP + 1);

        // exactly five full pages and then nothing: not cut.
        let (gh, dir) = stand_in("pr-files-exact", &json!(file_items(100)));
        fs::write(dir.join(format!("answer{}.json", PAGE_CAP + 1)), "[]").unwrap();
        let got = read_files(&gh, "github.com", "acme/app", 7).unwrap();
        assert_eq!((got.files.len(), got.truncated), (PAGE_CAP * PER_PAGE, false));
    }

    #[test]
    fn reviews_and_review_comments_past_a_hundred_are_read_too() {
        let many_reviews: Vec<Value> = (0..100).map(|i| json!({ "user": { "login": format!("u{i}") }, "state": "APPROVED" })).collect();
        let (gh, dir) = stand_in("pr-reviews-101", &pull());
        fs::write(dir.join("answer2.json"), json!(many_reviews).to_string()).unwrap();
        fs::write(dir.join("answer3.json"), json!([{ "user": { "login": "late" }, "state": "CHANGES_REQUESTED" }]).to_string()).unwrap();
        fs::write(dir.join("answer4.json"), "{}").unwrap();
        let p = read_page(&gh, "github.com", "acme/app", 7).unwrap();
        assert!(p.reviewers.iter().any(|r| r.login == "late" && r.state == "changes_requested"), "{:?}", p.reviewers);
        assert!(!p.reviews_truncated);
        assert_eq!(p.reviewers.len(), 102, "cy requested + 100 + late");

        let comments: Vec<Value> = (0..100).map(|i| json!({ "id": i + 1, "path": "a.rs", "line": 1, "body": "c", "user": { "login": "ana" }, "created_at": "t" })).collect();
        let (gh, dir) = stand_in("pr-comments-cap", &json!(comments));
        let got = read_threads(&gh, "github.com", "acme/app", 7).unwrap();
        assert!(got.truncated);
        assert_eq!(calls(&dir).lines().count(), PAGE_CAP + 1);
    }
}
