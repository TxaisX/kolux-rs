//! T-229-d (GIT-024 / GIT-025 / GIT-029 / GIT-030): the pull request pieces that sit around the
//! checks: finding a branch's pull request through the fork / renamed-branch / by-number
//! fallbacks, rerunning a check and reading its failing log, the AI-written title and
//! description, and reading and answering review comments. The argument builders and parsers are
//! pure so a stand-in runner proves them; only the thin commands at the end call gh or an agent.

use crate::scm::{self, Pr};
use serde::{Deserialize, Serialize};
use std::path::Path;

// ---- GIT-025: the lookup and its fallbacks -----------------------------------------------------

/// What the lookup knows about the branch besides its name.
#[derive(Clone, Debug, Default)]
pub struct Hints {
    pub branch: String,
    /// The branch's name on the remote when it differs from the local one (a renamed branch).
    pub remote_branch: Option<String>,
    /// The owner of the fork the branch was pushed to, when it is not the base repository.
    pub fork_owner: Option<String>,
    /// A pull request number known from elsewhere (a task, a printed link): the last resort.
    pub number: Option<u64>,
}

fn view(target: &str) -> Vec<String> {
    ["pr", "view", target, "--json", scm::PR_FIELDS].iter().map(|s| s.to_string()).collect()
}

/// The gh calls to try, in order: the branch itself, a differently named remote branch, the fork's
/// `owner:branch`, then the number.
pub fn lookup_plan(h: &Hints) -> Vec<Vec<String>> {
    let mut out = vec![view(&h.branch)];
    if let Some(r) = h.remote_branch.as_deref().filter(|r| !r.is_empty() && *r != h.branch) {
        out.push(view(r));
    }
    if let Some(o) = h.fork_owner.as_deref().filter(|o| !o.is_empty()) {
        out.push(view(&format!("{o}:{}", h.remote_branch.as_deref().unwrap_or(&h.branch))));
    }
    if let Some(n) = h.number {
        out.push(view(&n.to_string()));
    }
    out
}

/// Runs the plan with `ask` (gh in production, a stand-in in tests). "No pull requests found" moves
/// to the next step; any other failure stops, so a signed-out gh is never read as "no pull request".
pub fn find_with(mut ask: impl FnMut(&[String]) -> Result<String, String>, plan: &[Vec<String>]) -> Result<Option<Pr>, String> {
    for step in plan {
        match ask(step) {
            Ok(text) => return serde_json::from_str(&text).map(Some).map_err(|e| format!("gh answered in a form Kolux cannot read: {e}")),
            Err(e) if e.to_lowercase().contains("no pull requests found") => continue,
            Err(e) => return Err(scm::gh_words(&e)),
        }
    }
    Ok(None)
}

/// A closed or merged pull request on the default branch stays hidden unless it was linked on purpose.
pub fn shown_on(pr: &Pr, branch: &str, default_branch: &str, linked: bool) -> bool {
    linked || branch != default_branch || pr.state == "OPEN"
}

// ---- GIT-029: reruns, logs, fix with AI ---------------------------------------------------------

/// The workflow run (and job) a check's link points at: `.../actions/runs/<run>[/job/<job>]`.
pub fn run_id_of(link: &str) -> Option<(u64, Option<u64>)> {
    let rest = link.split("/actions/runs/").nth(1)?;
    let mut parts = rest.split(['/', '?', '#']);
    let run = parts.next()?.parse::<u64>().ok()?;
    let job = if parts.next() == Some("job") { parts.next().and_then(|j| j.parse::<u64>().ok()) } else { None };
    Some((run, job))
}

pub fn rerun_args(run: u64, failed_only: bool) -> Vec<String> {
    let mut a: Vec<String> = ["run", "rerun", &run.to_string()].iter().map(|s| s.to_string()).collect();
    if failed_only {
        a.push("--failed".into());
    }
    a
}

pub fn log_args(run: u64) -> Vec<String> {
    ["run", "view", &run.to_string(), "--log-failed"].iter().map(|s| s.to_string()).collect()
}

/// The final part of a log, cut at a line start, with a note when something was left out.
pub fn log_tail(log: &str, max: usize) -> String {
    if log.len() <= max {
        return log.to_string();
    }
    let mut from = log.len() - max;
    while !log.is_char_boundary(from) {
        from += 1;
    }
    let cut = log[from..].find('\n').map(|i| from + i + 1).unwrap_or(from);
    format!("[earlier output left out]\n{}", &log[cut..])
}

// ---- GIT-024: the AI-written title and description ----------------------------------------------

/// The linked issue as the prompt carries it; `title` alone is used when the issue could not be fetched.
#[derive(Clone, Debug, Default, Deserialize)]
pub struct Issue {
    pub number: u64,
    pub title: String,
    pub body: Option<String>,
}

pub const TEMPLATE_FILES: [&str; 4] = [".github/pull_request_template.md", ".github/PULL_REQUEST_TEMPLATE.md", "pull_request_template.md", "docs/pull_request_template.md"];

/// The repository's PR template, when it has one.
pub fn find_template(worktree: &Path) -> Option<String> {
    TEMPLATE_FILES.iter().find_map(|f| std::fs::read_to_string(worktree.join(f)).ok()).filter(|t| !t.trim().is_empty())
}

pub const PR_INSTRUCTIONS_MAX: usize = 2_000;

/// What the agent is asked: a title, then a plain-language description split into problem and
/// solution (or following the template's headings), mentioning and closing the linked issue.
pub fn pr_text_prompt(diff: &str, issue: Option<&Issue>, template: Option<&str>, instructions: &str) -> String {
    let mut p = String::from("Write a GitHub pull request for the changes below. Reply with the title on the first line, a blank line, then the description in markdown. ");
    match template {
        Some(t) => p.push_str(&format!("Fill in this repository's pull request template and keep every one of its headings:\n---\n{}\n---\n", t.trim())),
        None => p.push_str("Split the description into a short Problem section and a Solution section, in plain language.\n"),
    }
    if let Some(i) = issue {
        p.push_str(&format!("\nThe pull request is for issue #{}: {}\n", i.number, i.title.trim()));
        if let Some(b) = i.body.as_deref().filter(|b| !b.trim().is_empty()) {
            p.push_str(&format!("Issue description:\n{}\n", b.trim().chars().take(4_000).collect::<String>()));
        }
        p.push_str(&format!("Mention the issue and close it by number with the words \"Closes #{}\".\n", i.number));
    }
    let own: String = instructions.trim().chars().take(PR_INSTRUCTIONS_MAX).collect();
    if !own.is_empty() {
        p.push_str(&format!("\nInstructions from the user:\n{own}\n"));
    }
    p.push_str(&format!("\nChanges:\n{diff}"));
    p
}

/// The agent's answer as a (title, body) pair; a code fence or a "Title:" label is dropped.
pub fn parse_pr_text(answer: &str, issue: Option<u64>) -> Option<(String, String)> {
    let lines: Vec<&str> = answer.lines().filter(|l| !l.trim_start().starts_with("```")).collect();
    let at = lines.iter().position(|l| !l.trim().is_empty())?;
    let title = lines[at].trim().trim_start_matches('#').trim();
    let title = title.strip_prefix("Title:").or_else(|| title.strip_prefix("title:")).unwrap_or(title).trim().trim_matches('"');
    if title.is_empty() {
        return None;
    }
    let mut body = lines[at + 1..].join("\n").trim().to_string();
    if let Some(n) = issue {
        if !body.contains(&format!("#{n}")) {
            body = format!("{body}\n\nCloses #{n}").trim().to_string();
        }
    }
    Some((title.to_string(), body))
}

/// A bare base name that matches several remotes, none of them preferred, is not guessed.
pub fn pick_remote_base(name: &str, remotes_with_it: &[&str], preferred: Option<&str>) -> Result<String, String> {
    match remotes_with_it {
        [] => Err(format!("No remote has a branch {name}")),
        [one] => Ok(format!("{one}/{name}")),
        many => match preferred.filter(|p| many.contains(p)) {
            Some(p) => Ok(format!("{p}/{name}")),
            None => Err(format!("{name} exists on several remotes ({}); pick which one to compare against", many.join(", "))),
        },
    }
}

// ---- GIT-030: review comments ---------------------------------------------------------------------

#[derive(Clone, Debug, Default, PartialEq, Serialize)]
pub struct Comment {
    pub id: String,
    pub db_id: Option<u64>,
    pub author: String,
    pub bot: bool,
    pub body: String,
    pub at: String,
    /// The reactions it has, REST names (+1, heart, ...), only those with a count.
    pub reactions: Vec<Reaction>,
}

/// One reaction on a comment: its REST name, how many people gave it, and whether the viewer did.
#[derive(Clone, Debug, Default, PartialEq, Serialize)]
pub struct Reaction {
    pub content: String,
    pub count: u64,
    pub mine: bool,
}

#[derive(Clone, Debug, Default, PartialEq, Serialize)]
pub struct Thread {
    pub id: String,
    pub path: Option<String>,
    pub line: Option<u64>,
    pub resolved: bool,
    pub comments: Vec<Comment>,
    /// Comments beyond the first 100 that are not listed.
    pub more: u64,
}

#[derive(Clone, Debug, Default, PartialEq, Serialize)]
pub struct Review {
    pub threads: Vec<Thread>,
    pub talk: Vec<Comment>,
    pub talk_more: u64,
}

pub const COMMENT_CAP: usize = 100;

const REVIEW_QUERY: &str = "query($o:String!,$r:String!,$n:Int!){repository(owner:$o,name:$r){pullRequest(number:$n){comments(first:100){totalCount nodes{id databaseId body createdAt author{login __typename} reactionGroups{content viewerHasReacted reactors{totalCount}}}} reviewThreads(first:100){nodes{id isResolved path line comments(first:100){totalCount nodes{id databaseId body createdAt author{login __typename} reactionGroups{content viewerHasReacted reactors{totalCount}}}}}}}}}";

pub fn review_args(host: &str, owner: &str, repo: &str, number: u64) -> Vec<String> {
    ["api", "graphql", "--hostname", host, "-f", &format!("query={REVIEW_QUERY}"), "-f", &format!("o={owner}"), "-f", &format!("r={repo}"), "-F", &format!("n={number}")].iter().map(|s| s.to_string()).collect()
}

/// The GraphQL name of a REST reaction name (the inverse of `rest_reaction`).
fn graphql_reaction(rest: &str) -> Option<&'static str> {
    Some(match rest {
        "+1" => "THUMBS_UP",
        "-1" => "THUMBS_DOWN",
        "laugh" => "LAUGH",
        "confused" => "CONFUSED",
        "heart" => "HEART",
        "hooray" => "HOORAY",
        "rocket" => "ROCKET",
        "eyes" => "EYES",
        _ => return None,
    })
}

/// GraphQL names a reaction THUMBS_UP; the REST calls (and the buttons) say +1.
fn rest_reaction(graphql: &str) -> Option<&'static str> {
    Some(match graphql {
        "THUMBS_UP" => "+1",
        "THUMBS_DOWN" => "-1",
        "LAUGH" => "laugh",
        "CONFUSED" => "confused",
        "HEART" => "heart",
        "HOORAY" => "hooray",
        "ROCKET" => "rocket",
        "EYES" => "eyes",
        _ => return None,
    })
}

fn comment_of(v: &serde_json::Value, bots: &[String]) -> Comment {
    let login = v["author"]["login"].as_str().unwrap_or("ghost").to_string();
    let bot = v["author"]["__typename"] == "Bot" || bots.iter().any(|b| b.eq_ignore_ascii_case(&login));
    let reactions = v["reactionGroups"]
        .as_array()
        .map(|a| {
            a.iter()
                .filter_map(|g| {
                    let count = g["reactors"]["totalCount"].as_u64().unwrap_or(0);
                    let content = rest_reaction(g["content"].as_str()?)?;
                    (count > 0).then(|| Reaction { content: content.into(), count, mine: g["viewerHasReacted"] == true })
                })
                .collect()
        })
        .unwrap_or_default();
    Comment { id: v["id"].as_str().unwrap_or("").into(), db_id: v["databaseId"].as_u64(), author: login, bot, body: v["body"].as_str().unwrap_or("").into(), at: v["createdAt"].as_str().unwrap_or("").into(), reactions }
}

/// gh's GraphQL answer read into threads and the plain conversation; `bots` are author names the
/// user marked as bots, besides the ones GitHub says are.
pub fn parse_review(text: &str, bots: &[String]) -> Result<Review, String> {
    let v: serde_json::Value = serde_json::from_str(text).map_err(|e| format!("gh answered in a form Kolux cannot read: {e}"))?;
    let pr = &v["data"]["repository"]["pullRequest"];
    if pr.is_null() {
        return Err("That pull request could not be read".into());
    }
    let list = |x: &serde_json::Value| x["nodes"].as_array().map(|a| a.iter().take(COMMENT_CAP).map(|c| comment_of(c, bots)).collect::<Vec<_>>()).unwrap_or_default();
    let more = |x: &serde_json::Value| x["totalCount"].as_u64().unwrap_or(0).saturating_sub(COMMENT_CAP as u64);
    let threads = pr["reviewThreads"]["nodes"]
        .as_array()
        .map(|a| {
            a.iter()
                .map(|t| Thread { id: t["id"].as_str().unwrap_or("").into(), path: t["path"].as_str().map(String::from), line: t["line"].as_u64(), resolved: t["isResolved"] == true, comments: list(&t["comments"]), more: more(&t["comments"]) })
                .collect()
        })
        .unwrap_or_default();
    Ok(Review { threads, talk: list(&pr["comments"]), talk_more: more(&pr["comments"]) })
}

/// A comment is sent trimmed; a blank one is never sent.
pub fn clean_comment(text: &str) -> Result<String, String> {
    let t = text.trim();
    if t.is_empty() {
        Err("Write something first".into())
    } else {
        Ok(t.to_string())
    }
}

/// One thing the user does to a comment or thread.
#[derive(Clone, Debug, PartialEq)]
pub enum Act<'a> {
    /// Add to the conversation.
    Comment(&'a str),
    /// Reply inside a review thread to the comment with this database id.
    Reply(u64, &'a str),
    Edit(u64, &'a str),
    Delete(u64),
    Resolve(&'a str, bool),
    React(u64, &'a str),
    /// A reaction on a comment of the plain conversation (an issue comment, not a review comment).
    ReactTalk(u64, &'a str),
    /// Takes back the viewer's reaction: the comment's GraphQL node id and the REST name. GraphQL needs no reaction id.
    Unreact(&'a str, &'a str),
}

const REACTIONS: [&str; 8] = ["+1", "-1", "laugh", "confused", "heart", "hooray", "rocket", "eyes"];

/// The gh call for an action on pull request `number` of `owner/repo`.
pub fn act_args(host: &str, owner: &str, repo: &str, number: u64, act: &Act) -> Result<Vec<String>, String> {
    let s = |v: &[&str]| {
        let mut out = vec!["api".to_string(), "--hostname".to_string(), host.to_string()];
        out.extend(v[1..].iter().map(|x| x.to_string()));
        out
    };
    Ok(match act {
        Act::Comment(t) => s(&["api", &format!("repos/{owner}/{repo}/issues/{number}/comments"), "-f", &format!("body={}", clean_comment(t)?)]),
        Act::Reply(id, t) => s(&["api", &format!("repos/{owner}/{repo}/pulls/{number}/comments/{id}/replies"), "-f", &format!("body={}", clean_comment(t)?)]),
        Act::Edit(id, t) => s(&["api", "-X", "PATCH", &format!("repos/{owner}/{repo}/pulls/comments/{id}"), "-f", &format!("body={}", clean_comment(t)?)]),
        Act::Delete(id) => s(&["api", "-X", "DELETE", &format!("repos/{owner}/{repo}/pulls/comments/{id}")]),
        Act::Resolve(thread, on) => {
            let name = if *on { "resolveReviewThread" } else { "unresolveReviewThread" };
            s(&["api", "graphql", "-f", &format!("query=mutation($t:ID!){{{name}(input:{{threadId:$t}}){{thread{{isResolved}}}}}}"), "-f", &format!("t={thread}")])
        }
        Act::React(id, what) | Act::ReactTalk(id, what) => {
            if !REACTIONS.contains(what) {
                return Err(format!("{what} is not a reaction GitHub offers"));
            }
            let kind = if matches!(act, Act::ReactTalk(..)) { "issues" } else { "pulls" };
            s(&["api", &format!("repos/{owner}/{repo}/{kind}/comments/{id}/reactions"), "-f", &format!("content={what}")])
        }
        Act::Unreact(node, what) => {
            let content = graphql_reaction(what).ok_or_else(|| format!("{what} is not a reaction GitHub offers"))?;
            if node.trim().is_empty() {
                return Err("That comment has no id".into());
            }
            let q = "mutation($s:ID!,$c:ReactionContent!){removeReaction(input:{subjectId:$s,content:$c}){reaction{content}}}";
            s(&["api", "graphql", "-f", &format!("query={q}"), "-f", &format!("s={node}"), "-f", &format!("c={content}")])
        }
    })
}

// ---- the commands --------------------------------------------------------------------------------

fn parts_of(url: &str) -> Result<(String, String, String, u64), String> {
    scm::pr_parts(url).ok_or_else(|| "Paste a pull request link, such as https://github.com/owner/repo/pull/12".to_string())
}

/// GIT-025: the branch's pull request through the fallbacks.
#[tauri::command]
pub async fn scm_pr_find(worktree: String, remote_branch: Option<String>, fork_owner: Option<String>, number: Option<u64>, default_branch: Option<String>, linked: bool) -> Result<Option<Pr>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let dir = Path::new(&worktree);
        let branch = scm::status(dir)?.branch.ok_or("No branch is checked out here")?;
        let gh = scm::gh_program()?;
        let plan = lookup_plan(&Hints { branch: branch.clone(), remote_branch, fork_owner, number });
        let found = find_with(|a| scm::gh_run(&gh, dir, &a.iter().map(String::as_str).collect::<Vec<_>>(), None), &plan)?;
        Ok(found.filter(|pr| shown_on(pr, &branch, default_branch.as_deref().unwrap_or(""), linked)))
    })
    .await
    .map_err(|e| e.to_string())?
}

/// GIT-029: rerun the workflow a check belongs to (only its failed jobs when asked).
#[tauri::command]
pub async fn scm_check_rerun(worktree: String, link: String, failed_only: bool) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let (run, _) = run_id_of(&link).ok_or("This check has no workflow run to rerun")?;
        let a = rerun_args(run, failed_only);
        scm::gh_run(&scm::gh_program()?, Path::new(&worktree), &a.iter().map(String::as_str).collect::<Vec<_>>(), None)
    })
    .await
    .map_err(|e| e.to_string())?
}

/// GIT-029: the failing part of a check's log, trimmed to its final part.
#[tauri::command]
pub async fn scm_check_log(worktree: String, link: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let (run, _) = run_id_of(&link).ok_or("This check has no workflow run to read")?;
        let a = log_args(run);
        let out = scm::gh_run(&scm::gh_program()?, Path::new(&worktree), &a.iter().map(String::as_str).collect::<Vec<_>>(), None)?;
        Ok(log_tail(&out, 60_000))
    })
    .await
    .map_err(|e| e.to_string())?
}

/// GIT-024: the title and description an agent writes for the branch against `base`. Needs a real
/// agent, so its live run is pending; the prompt and the parsing are unit tested.
#[tauri::command]
#[allow(clippy::too_many_arguments)] // a Tauri command takes its arguments one by one
pub async fn scm_pr_text(worktree: String, base: String, command: Option<String>, instructions: Option<String>, issue: Option<Issue>, use_template: bool, agent: Option<String>, model: Option<String>, effort: Option<String>) -> Result<(String, String), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let dir = Path::new(&worktree);
        // A base given with its remote (origin/main) is used as is; a bare name must match one remote.
        let base = base.trim().to_string();
        let against = if base.contains('/') && crate::git::run(&["rev-parse", "--verify", "--quiet", &base], Some(dir)).is_ok() {
            base.clone()
        } else {
            let refs = crate::git::run(&["for-each-ref", "--format=%(refname:short)", &format!("refs/remotes/*/{base}")], Some(dir))?;
            let remotes: Vec<&str> = refs.lines().filter_map(|l| l.strip_suffix(&format!("/{base}"))).collect();
            // Several remotes carry it: only an explicit pick (origin/main) settles it.
            pick_remote_base(&base, &remotes, None)?
        };
        let diff = crate::git::run(&["diff", "--no-color", "--no-ext-diff", &format!("{against}...HEAD")], Some(dir))?;
        if diff.trim().is_empty() {
            return Err(format!("There is nothing ahead of {base} to describe"));
        }
        let template = if use_template { find_template(dir) } else { None };
        let prompt = pr_text_prompt(&scm::trim_diff(&diff, scm::MESSAGE_BUDGET), issue.as_ref(), template.as_deref(), instructions.as_deref().unwrap_or(""));
        let limit = std::time::Duration::from_secs(180);
        // GIT-018 / GIT-022: the same writer the commit messages use (custom command, else the chosen agent).
        let writer = scm::writers::WriterArg { agent, model, effort, command };
        let answer = scm::writers::ask(&writer, &prompt, dir, &worktree, limit)?;
        parse_pr_text(&answer, issue.as_ref().map(|i| i.number)).ok_or_else(|| "The agent returned no title".to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

/// GIT-030: the pull request's review threads and conversation.
#[tauri::command]
pub async fn scm_review_read(worktree: String, url: String, bots: Vec<String>) -> Result<Review, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let (h, o, r, n) = parts_of(&url)?;
        let a = review_args(&h, &o, &r, n);
        let text = scm::gh_run(&scm::gh_program()?, Path::new(&worktree), &a.iter().map(String::as_str).collect::<Vec<_>>(), None)?;
        parse_review(&text, &bots)
    })
    .await
    .map_err(|e| e.to_string())?
}

/// GIT-030: add, reply, edit, delete, resolve or react; every change lands on GitHub.
/// `kind` is comment, reply, edit, delete, resolve, unresolve, react, react_talk or unreact (id is the node id, text the reaction).
#[tauri::command]
pub async fn scm_review_act(worktree: String, url: String, kind: String, id: String, text: Option<String>) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let (h, o, r, n) = parts_of(&url)?;
        let t = text.unwrap_or_default();
        let num = || id.parse::<u64>().map_err(|_| "That comment has no id".to_string());
        let act = match kind.as_str() {
            "comment" => Act::Comment(&t),
            "reply" => Act::Reply(num()?, &t),
            "edit" => Act::Edit(num()?, &t),
            "delete" => Act::Delete(num()?),
            "resolve" => Act::Resolve(&id, true),
            "unresolve" => Act::Resolve(&id, false),
            "react" => Act::React(num()?, &t),
            "react_talk" => Act::ReactTalk(num()?, &t),
            "unreact" => Act::Unreact(&id, &t),
            other => return Err(format!("Unknown action {other}")),
        };
        let a = act_args(&h, &o, &r, n, &act)?;
        scm::gh_run(&scm::gh_program()?, Path::new(&worktree), &a.iter().map(String::as_str).collect::<Vec<_>>(), None)
    })
    .await
    .map_err(|e| e.to_string())?
}

/// GIT-031: the agent session of the workspace that review comments go to: the newest open
/// session started in that folder that runs an agent (a plain shell is not one).
pub fn pick_agent(sessions: &[(String, String, Option<String>)], worktree: &str) -> Result<String, String> {
    let norm = |p: &str| p.replace('\\', "/").trim_end_matches('/').to_lowercase();
    let want = norm(worktree);
    let mut agents: Vec<&(String, String, Option<String>)> = sessions.iter().filter(|(_, dir, prog)| prog.is_some() && norm(dir) == want).collect();
    agents.pop().map(|(h, _, _)| h.clone()).ok_or_else(|| "No agent is running in this workspace. Start one there, or copy the text and paste it into the agent you use.".to_string())
}

/// What a finished send tells the person: delivered (the agent began its turn or queued the text)
/// is success; text left in the box or not submitted is a failure, so nothing is marked as sent.
pub fn delivery_verdict(result: &Result<serde_json::Value, String>) -> Result<String, String> {
    let v = result.as_ref().map_err(|e| e.clone())?;
    let receipt = v["receipt"].as_str().unwrap_or("unknown");
    if v["enterHeld"].as_bool() == Some(true) || receipt == "not_submitted" {
        return Err("The text reached the agent's box but was not submitted. Press Enter in that terminal, or send it again.".to_string());
    }
    if v["delivered"].as_bool() == Some(false) {
        return Err("The agent did not take the text.".to_string());
    }
    Ok(receipt.to_string())
}

#[derive(Serialize)]
pub struct Sent {
    pub terminal: String,
    pub receipt: String,
}

/// GIT-031: send text to the workspace's agent through the orchestration send (send-once: a
/// repeat joins the first), the same path `kolux terminal send` takes. No second terminal writer.
#[tauri::command]
pub async fn scm_review_send(app: tauri::AppHandle, worktree: String, text: String) -> Result<Sent, String> {
    use tauri::Manager;
    tauri::async_runtime::spawn_blocking(move || {
        let terminals = app.state::<crate::terminal::Terminals>();
        let terminal = pick_agent(&terminals.sessions(), &worktree)?;
        let store = app.state::<std::sync::Mutex<crate::state::Store>>();
        let git = app.state::<crate::git::Git>();
        let notify = |_: serde_json::Value| {};
        let front = || -> Result<(), String> { Ok(()) };
        let ctx = crate::cli::Ctx { claude_config: crate::trust::claude_config_file(), git: &git, store: &store, terminals: &terminals, notify: &notify, front: &front };
        let req = crate::cli::Request {
            id: format!("review-send-{terminal}"),
            token: String::new(),
            command: "terminal.send".to_string(),
            cwd: worktree.clone(),
            args: serde_json::json!({ "terminal": terminal, "text": text, "enter": true }),
            pane: None,
            cli: env!("CARGO_PKG_VERSION").to_string(),
            arrived: None,
        };
        let out = crate::cli::dispatch(&ctx, &req).map_err(|f| f.message);
        let receipt = delivery_verdict(&out)?;
        Ok(Sent { terminal, receipt })
    })
    .await
    .map_err(|e| e.to_string())?
}

#[derive(Serialize, Debug, PartialEq)]
pub struct Conflicts {
    /// conflicts, clean or unknown
    pub state: String,
    pub files: Vec<String>,
    pub base: String,
    pub note: String,
    /// the text that asks the workspace's agent to resolve them (only when there are conflicts)
    pub prompt: Option<String>,
}

/// GIT-032: what a local trial merge of the branch with the pull request's base says.
pub fn conflicts_of(c: scm::Clash, base: &str) -> Conflicts {
    let prompt = if let scm::Clash::Conflict(f) = &c { Some(resolve_prompt(base, f)) } else { None };
    let (state, files, note) = match c {
        scm::Clash::Clean => ("clean", Vec::new(), "The branch merges with the base without conflicts here (as of your last fetch).".to_string()),
        scm::Clash::Conflict(f) => ("conflicts", f, format!("These files conflict with {base}. Fix them before the checks can run and the pull request can merge.")),
        scm::Clash::Unverifiable(why) => ("unknown", Vec::new(), format!("Kolux could not try the merge: {why}")),
    };
    Conflicts { state: state.to_string(), files, base: base.to_string(), note, prompt }
}

/// GIT-032: the prompt that asks the workspace's agent to resolve the conflicts. The agent merges the base
/// in itself; Kolux never resolves, commits or pushes for it.
pub fn resolve_prompt(base: &str, files: &[String]) -> String {
    let list = if files.is_empty() { String::new() } else { format!(" Files that conflict: {}.", files.join(", ")) };
    format!("This branch's pull request has merge conflicts with {base}.{list} Merge origin/{base} into this branch, resolve the conflicts keeping the intent of both sides, run the tests, and commit the merge. Do not push; tell me when it is done.")
}

/// After-list row 267: the trial merge runs against the base as the remote has it now, not as of
/// the last fetch. Only `origin/<base>` moves; false when the fetch failed (offline, no such branch).
fn fetch_base(dir: &Path, base: &str) -> bool {
    crate::git::run(&["fetch", "--quiet", "origin", &format!("+refs/heads/{base}:refs/remotes/origin/{base}")], Some(dir)).is_ok()
}

/// GIT-032: does the branch conflict with the pull request's base? Local trial merge, no push, no change.
#[tauri::command]
pub async fn scm_pr_conflicts(worktree: String, url: String) -> Result<Conflicts, String> {
    tauri::async_runtime::spawn_blocking(move || {
        parts_of(&url)?;
        let dir = Path::new(&worktree);
        let base = scm::gh_run(&scm::gh_program()?, dir, &["pr", "view", &url, "--json", "baseRefName", "--jq", ".baseRefName"], None)?.trim().to_string();
        if base.is_empty() {
            return Err("GitHub did not name the pull request's base branch".to_string());
        }
        fetch_base(dir, &base); // offline: the last fetched base is used, as the note says
        let c = scm::clash(dir, "HEAD", &format!("origin/{base}"));
        Ok(conflicts_of(c, &base))
    })
    .await
    .map_err(|e| e.to_string())?
}

// ---- GIT-034: the open pull requests of a stack ------------------------------------------------

/// One open pull request as the stack view needs it.
#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct StackRow {
    pub number: u64,
    pub head: String,
    pub base: String,
    pub state: String,
    pub url: String,
    pub title: String,
}

/// The open pull requests and the repository's trunk branch.
#[derive(Clone, Debug, Serialize)]
pub struct StackList {
    pub trunk: String,
    pub prs: Vec<StackRow>,
}

/// The rows of `gh pr list --json number,url,headRefName,baseRefName,state,title`; drafts stay in (they still sit in a stack).
pub fn stack_rows(text: &str) -> Result<Vec<StackRow>, String> {
    let v: serde_json::Value = serde_json::from_str(text).map_err(|e| format!("gh answered in a form Kolux cannot read: {e}"))?;
    let s = |x: &serde_json::Value, k: &str| x[k].as_str().unwrap_or_default().to_string();
    Ok(v.as_array()
        .map(|a| {
            a.iter()
                .filter_map(|r| {
                    let number = r["number"].as_u64()?;
                    let (head, base) = (s(r, "headRefName"), s(r, "baseRefName"));
                    (!head.is_empty() && !base.is_empty()).then(|| StackRow { number, head, base, state: s(r, "state"), url: s(r, "url"), title: s(r, "title") })
                })
                .collect()
        })
        .unwrap_or_default())
}

/// GIT-034: the open pull requests of the repository the worktree belongs to, for the stack view.
#[tauri::command]
pub async fn scm_stack_prs(worktree: String) -> Result<StackList, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let dir = Path::new(&worktree);
        let gh = scm::gh_program()?;
        let text = scm::gh_run(&gh, dir, &["pr", "list", "--state", "open", "--limit", "100", "--json", "number,url,headRefName,baseRefName,state,title"], None)?;
        let trunk = scm::gh_run(&gh, dir, &["repo", "view", "--json", "defaultBranchRef", "--jq", ".defaultBranchRef.name"], None).map(|t| t.trim().to_string()).ok().filter(|t| !t.is_empty()).unwrap_or_else(|| "main".to_string());
        Ok(StackList { trunk, prs: stack_rows(&text)? })
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn row267_the_conflict_check_fetches_the_base_first() {
        let root = std::env::temp_dir().join(format!("kolux-rs-pr267-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        let up = root.join("up");
        std::fs::create_dir_all(&up).unwrap();
        let g = |args: &[&str], dir: &Path| crate::git::run(&[&["-c", "user.name=t", "-c", "user.email=t@t", "-c", "commit.gpgsign=false"][..], args].concat(), Some(dir)).unwrap();
        g(&["init", "-q", "-b", "main"], &up);
        g(&["commit", "-q", "--allow-empty", "-m", "one"], &up);
        g(&["clone", "-q", up.to_str().unwrap(), "down"], &root);
        g(&["commit", "-q", "--allow-empty", "-m", "two"], &up);
        let down = root.join("down");
        assert_ne!(g(&["rev-parse", "origin/main"], &down), g(&["rev-parse", "HEAD"], &up), "stale before");
        assert!(fetch_base(&down, "main"));
        assert_eq!(g(&["rev-parse", "origin/main"], &down), g(&["rev-parse", "HEAD"], &up));
        assert!(!fetch_base(&down, "no-such-branch"));
        let _ = std::fs::remove_dir_all(&root);
    }

    fn pr_json(n: u64) -> String {
        format!("{{\"number\":{n},\"url\":\"https://github.com/o/r/pull/{n}\",\"state\":\"OPEN\"}}")
    }

    #[test]
    fn the_lookup_tries_the_branch_then_a_renamed_remote_branch_then_the_fork_then_the_number() {
        let h = Hints { branch: "feat".into(), remote_branch: Some("feature-x".into()), fork_owner: Some("me".into()), number: Some(42) };
        let plan = lookup_plan(&h);
        let targets: Vec<&str> = plan.iter().map(|p| p[2].as_str()).collect();
        assert_eq!(targets, ["feat", "feature-x", "me:feature-x", "42"]);
        assert_eq!(lookup_plan(&Hints { branch: "feat".into(), remote_branch: Some("feat".into()), ..Default::default() }).len(), 1);
    }

    #[test]
    fn a_fallback_finds_the_pull_request_when_the_branch_name_does_not() {
        let plan = lookup_plan(&Hints { branch: "feat".into(), remote_branch: Some("renamed".into()), fork_owner: None, number: Some(9) });
        let mut asked = Vec::new();
        let got = find_with(
            |a| {
                asked.push(a[2].clone());
                if a[2] == "renamed" { Ok(pr_json(5)) } else { Err("no pull requests found for branch".into()) }
            },
            &plan,
        );
        assert_eq!(got.unwrap().unwrap().number, 5);
        assert_eq!(asked, ["feat", "renamed"]);
        // By number as the last resort.
        let by_number = find_with(|a| if a[2] == "9" { Ok(pr_json(9)) } else { Err("no pull requests found".into()) }, &plan).unwrap();
        assert_eq!(by_number.unwrap().number, 9);
        // Nothing anywhere is None; a signed-out gh stops the lookup with its words instead.
        assert!(find_with(|_| Err("no pull requests found".into()), &plan).unwrap().is_none());
        let err = find_with(|_| Err("To authenticate, run gh auth login".into()), &plan).unwrap_err();
        assert!(err.contains("gh auth login"), "{err}");
    }

    #[test]
    fn a_closed_pull_request_on_the_default_branch_stays_hidden_unless_linked() {
        let pr = |state: &str| Pr { number: 1, url: "u".into(), state: state.into(), title: None, head: None, draft: false };
        assert!(!shown_on(&pr("CLOSED"), "main", "main", false));
        assert!(!shown_on(&pr("MERGED"), "main", "main", false));
        assert!(shown_on(&pr("MERGED"), "main", "main", true));
        assert!(shown_on(&pr("MERGED"), "feat", "main", false));
        assert!(shown_on(&pr("OPEN"), "main", "main", false));
    }

    #[test]
    fn a_check_link_names_its_run_and_the_calls_rerun_and_read_it() {
        assert_eq!(run_id_of("https://github.com/o/r/actions/runs/123/job/456"), Some((123, Some(456))));
        assert_eq!(run_id_of("https://github.com/o/r/actions/runs/123"), Some((123, None)));
        assert_eq!(run_id_of("https://ci.example/build/9"), None);
        assert_eq!(rerun_args(123, true), ["run", "rerun", "123", "--failed"]);
        assert_eq!(rerun_args(123, false), ["run", "rerun", "123"]);
        assert_eq!(log_args(123), ["run", "view", "123", "--log-failed"]);
    }

    #[test]
    fn a_log_is_cut_to_its_final_part_at_a_line_start() {
        let log: String = (0..100).map(|i| format!("line {i:03}\n")).collect();
        let t = log_tail(&log, 100);
        assert!(t.starts_with("[earlier output left out]\nline "), "{t}");
        assert!(t.ends_with("line 099\n"));
        assert!(t.len() < 160);
        assert_eq!(log_tail("short", 100), "short");
    }

    #[test]
    fn the_pull_request_prompt_follows_the_template_and_closes_the_issue_by_number() {
        let issue = Issue { number: 12, title: "Crash on save".into(), body: Some("It crashes.".into()) };
        let p = pr_text_prompt("diff --git a b", Some(&issue), Some("## Summary\n\n## Testing"), "Be brief");
        assert!(p.contains("keep every one of its headings") && p.contains("## Testing"));
        assert!(p.contains("issue #12: Crash on save") && p.contains("It crashes.") && p.contains("Closes #12"));
        assert!(p.contains("Be brief") && p.ends_with("diff --git a b"));
        let plain = pr_text_prompt("d", None, None, "  ");
        assert!(plain.contains("Problem section and a Solution section") && !plain.contains("Instructions from the user"));
        // An issue that could not be fetched still names its saved title.
        let saved = Issue { number: 3, title: "Saved title".into(), body: None };
        assert!(pr_text_prompt("d", Some(&saved), None, "").contains("#3: Saved title"));
    }

    #[test]
    fn the_agents_answer_becomes_a_title_and_a_description_that_closes_the_issue() {
        let (t, b) = parse_pr_text("```\nTitle: Fix the save crash\n\n## Problem\nIt crashed.\n\n## Solution\nGuarded.\n```", Some(12)).unwrap();
        assert_eq!(t, "Fix the save crash");
        assert!(b.starts_with("## Problem") && b.ends_with("Closes #12"));
        let (_, kept) = parse_pr_text("Fix\n\nCloses #12 already", Some(12)).unwrap();
        assert_eq!(kept.matches("Closes #12").count(), 1);
        assert!(parse_pr_text("  \n\n", None).is_none());
    }

    #[test]
    fn a_bare_base_on_several_remotes_is_not_guessed() {
        assert_eq!(pick_remote_base("main", &["origin"], None).unwrap(), "origin/main");
        assert_eq!(pick_remote_base("main", &["origin", "up"], Some("up")).unwrap(), "up/main");
        let err = pick_remote_base("main", &["origin", "up"], None).unwrap_err();
        assert!(err.contains("several remotes"), "{err}");
        assert!(pick_remote_base("main", &["origin", "up"], Some("other")).is_err());
        assert!(pick_remote_base("main", &[], None).is_err());
    }

    #[test]
    fn review_threads_and_the_conversation_are_read_with_bots_set_apart_and_long_threads_capped() {
        let json = r#"{"data":{"repository":{"pullRequest":{
            "comments":{"totalCount":1,"nodes":[{"id":"IC1","databaseId":1,"body":"Looks good","createdAt":"2026-10-19T10:00:00Z","author":{"login":"ann","__typename":"User"},"reactionGroups":[{"content":"THUMBS_UP","viewerHasReacted":true,"reactors":{"totalCount":2}},{"content":"HEART","viewerHasReacted":false,"reactors":{"totalCount":0}},{"content":"ROCKET","viewerHasReacted":false,"reactors":{"totalCount":1}}]}]},
            "reviewThreads":{"nodes":[{"id":"T1","isResolved":false,"path":"src/a.ts","line":7,"comments":{"totalCount":103,"nodes":[
              {"id":"C1","databaseId":11,"body":"Rename this","createdAt":"2026-10-19T11:00:00Z","author":{"login":"bob","__typename":"User"}},
              {"id":"C2","databaseId":12,"body":"CI note","createdAt":"2026-10-19T11:01:00Z","author":{"login":"ci-helper","__typename":"User"}},
              {"id":"C3","databaseId":13,"body":"Auto","createdAt":"2026-10-19T11:02:00Z","author":{"login":"dependabot","__typename":"Bot"}}]}}]}}}}}"#;
        let r = parse_review(json, &["CI-Helper".to_string()]).unwrap();
        assert_eq!(r.talk.len(), 1);
        assert_eq!(r.talk[0].reactions, [Reaction { content: "+1".into(), count: 2, mine: true }, Reaction { content: "rocket".into(), count: 1, mine: false }]);
        assert!(r.threads[0].comments[0].reactions.is_empty());
        assert_eq!(r.threads[0].path.as_deref(), Some("src/a.ts"));
        assert_eq!(r.threads[0].line, Some(7));
        assert_eq!(r.threads[0].more, 3);
        let bots: Vec<bool> = r.threads[0].comments.iter().map(|c| c.bot).collect();
        assert_eq!(bots, [false, true, true]);
        assert!(parse_review("{\"data\":{\"repository\":{\"pullRequest\":null}}}", &[]).is_err());
    }

    #[test]
    fn a_blank_comment_is_never_sent_and_the_text_is_trimmed_first() {
        assert!(act_args("h.com", "o", "r", 7, &Act::Comment("   \n ")).is_err());
        assert!(act_args("h.com", "o", "r", 7, &Act::Reply(5, "")).is_err());
        let a = act_args("h.com", "o", "r", 7, &Act::Reply(5, "  thanks \n")).unwrap();
        assert_eq!(a, ["api", "--hostname", "h.com", "repos/o/r/pulls/7/comments/5/replies", "-f", "body=thanks"]);
    }

    #[test]
    fn each_comment_action_is_the_right_github_call() {
        let a = |act: Act| act_args("h.com", "o", "r", 7, &act).unwrap();
        assert_eq!(a(Act::Comment("hi"))[3], "repos/o/r/issues/7/comments");
        assert_eq!(a(Act::Edit(5, "x")), ["api", "--hostname", "h.com", "-X", "PATCH", "repos/o/r/pulls/comments/5", "-f", "body=x"]);
        assert_eq!(a(Act::Delete(5)), ["api", "--hostname", "h.com", "-X", "DELETE", "repos/o/r/pulls/comments/5"]);
        let resolve = a(Act::Resolve("T1", true));
        assert!(resolve[5].contains("resolveReviewThread") && resolve[7] == "t=T1");
        assert!(a(Act::Resolve("T1", false))[5].contains("unresolveReviewThread"));
        assert_eq!(a(Act::React(5, "heart"))[5], "content=heart");
        assert_eq!(a(Act::React(5, "heart"))[3], "repos/o/r/pulls/comments/5/reactions");
        assert_eq!(a(Act::ReactTalk(5, "+1"))[3], "repos/o/r/issues/comments/5/reactions");
        assert!(act_args("h.com", "o", "r", 7, &Act::React(5, "banana")).is_err());
    }

    #[test]
    fn git_030_a_reaction_can_be_taken_back_by_its_comment_node_id() {
        let a = |id: &str, what: &str| act_args("h.com", "o", "r", 7, &Act::Unreact(id, what));
        let ok = a("IC_9", "+1").unwrap();
        assert_eq!(ok[..4], ["api", "--hostname", "h.com", "graphql"]);
        assert!(ok[5].starts_with("query=mutation") && ok[5].contains("removeReaction"));
        assert_eq!((ok[7].as_str(), ok[9].as_str()), ("s=IC_9", "c=THUMBS_UP"));
        assert!(a("IC_9", "banana").is_err());
        assert!(a("  ", "heart").is_err());
        for r in REACTIONS {
            assert_eq!(rest_reaction(graphql_reaction(r).unwrap()), Some(r), "{r} round-trips");
        }
    }

    #[test]
    fn the_template_is_read_from_the_usual_places() {
        let dir = std::env::temp_dir().join(format!("kolux-rs-prreview-tpl-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(dir.join(".github")).unwrap();
        assert!(find_template(&dir).is_none());
        std::fs::write(dir.join(".github/pull_request_template.md"), "## What\n").unwrap();
        assert_eq!(find_template(&dir).as_deref(), Some("## What\n"));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn git_031_the_review_text_goes_to_the_newest_agent_of_the_workspace() {
        let s = vec![
            ("term-1".to_string(), r"G:\w\a".to_string(), Some("claude".to_string())),
            ("term-2".to_string(), "G:/w/a/".to_string(), None),
            ("term-3".to_string(), "g:/W/A".to_string(), Some("codex".to_string())),
            ("term-4".to_string(), "G:/w/b".to_string(), Some("claude".to_string())),
        ];
        assert_eq!(pick_agent(&s, "G:/w/a").unwrap(), "term-3");
        assert_eq!(pick_agent(&s, "G:/w/b").unwrap(), "term-4");
        let none = pick_agent(&s, "G:/w/c").unwrap_err();
        assert!(none.starts_with("No agent is running"), "{none}");
        // a plain shell alone is not an agent
        assert!(pick_agent(&[("term-2".to_string(), "G:/w/a".to_string(), None)], "G:/w/a").is_err());
    }

    #[test]
    fn git_031_only_a_submitted_send_counts_as_sent() {
        use serde_json::json;
        assert_eq!(delivery_verdict(&Ok(json!({"delivered": true, "receipt": "turn_began"}))).unwrap(), "turn_began");
        assert_eq!(delivery_verdict(&Ok(json!({"delivered": true, "receipt": "queued"}))).unwrap(), "queued");
        assert!(delivery_verdict(&Ok(json!({"delivered": true, "receipt": "not_submitted"}))).is_err());
        assert!(delivery_verdict(&Ok(json!({"delivered": true, "enterHeld": true, "receipt": "unknown"}))).is_err());
        assert!(delivery_verdict(&Ok(json!({"delivered": false}))).is_err());
        assert_eq!(delivery_verdict(&Err("no terminal".to_string())).unwrap_err(), "no terminal");
    }

    #[test]
    fn git_031_a_send_to_a_missing_terminal_fails_in_words() {
        let dir = std::env::temp_dir().join(format!("kolux-review-send-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let git = crate::git::Git::detect().unwrap();
        let store = std::sync::Mutex::new(crate::state::Store::open(&dir.join("data")).unwrap());
        let terminals = crate::terminal::Terminals::default();
        let notify = |_: serde_json::Value| {};
        let front = || -> Result<(), String> { Ok(()) };
        let ctx = crate::cli::Ctx { claude_config: dir.join(".claude.json"), git: &git, store: &store, terminals: &terminals, notify: &notify, front: &front };
        let req = crate::cli::Request {
            id: "t".into(),
            token: String::new(),
            command: "terminal.send".into(),
            cwd: dir.to_string_lossy().into_owned(),
            args: serde_json::json!({"terminal": "term-9", "text": "hello", "enter": true}),
            pane: None,
            cli: env!("CARGO_PKG_VERSION").to_string(),
            arrived: None,
        };
        let out = crate::cli::dispatch(&ctx, &req).map_err(|f| f.message);
        let err = delivery_verdict(&out).unwrap_err();
        assert!(!err.is_empty(), "a missing terminal must say why");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn git_032_conflicts_are_listed_and_the_resolve_prompt_names_them() {
        let c = conflicts_of(scm::Clash::Conflict(vec!["a.rs".into(), "b/c.ts".into()]), "main");
        assert_eq!(c.state, "conflicts");
        assert_eq!(c.files, vec!["a.rs", "b/c.ts"]);
        assert!(c.note.contains("before the checks can run"), "{}", c.note);
        assert_eq!(conflicts_of(scm::Clash::Clean, "main").state, "clean");
        let u = conflicts_of(scm::Clash::Unverifiable("no git".into()), "main");
        assert_eq!((u.state.as_str(), u.note.contains("no git")), ("unknown", true));
        let p = c.prompt.clone().unwrap();
        assert!(conflicts_of(scm::Clash::Clean, "main").prompt.is_none());
        assert!(p.contains("a.rs, b/c.ts") && p.contains("origin/main") && p.contains("Do not push"), "{p}");
        assert!(!resolve_prompt("dev", &[]).contains("Files that conflict"));
    }

    #[test]
    fn git034_the_open_list_becomes_stack_rows_and_skips_rows_without_a_branch() {
        let text = r#"[{"number":1,"url":"https://github.com/o/r/pull/1","headRefName":"a","baseRefName":"main","state":"OPEN","title":"A"},{"number":2,"url":"u","headRefName":"","baseRefName":"a","state":"OPEN","title":"x"},{"number":3,"url":"https://github.com/o/r/pull/3","headRefName":"b","baseRefName":"a","state":"OPEN","title":"B"}]"#;
        let rows = stack_rows(text).unwrap();
        assert_eq!(rows.iter().map(|r| (r.number, r.head.as_str(), r.base.as_str())).collect::<Vec<_>>(), [(1, "a", "main"), (3, "b", "a")]);
        assert_eq!(rows[1].title, "B");
        assert!(stack_rows("{}").unwrap().is_empty());
        assert!(stack_rows("nope").unwrap_err().contains("cannot read"));
    }
}
