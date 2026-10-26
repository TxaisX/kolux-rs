//! spec/09 P0 boxes AUTO-001, AUTO-004, AUTO-005: timetables, event triggers and the dialog's save.
//! Every call goes through the crate's pub API; the window is a recording closure and no agent starts.

use kolux_rs_lib::automations::{self as auto, Launch, KEY, RUNS_KEY};
use kolux_rs_lib::git::Git;
use kolux_rs_lib::projects;
use kolux_rs_lib::scm::{PolledPr, Pr};
use kolux_rs_lib::state::Store;
use serde_json::{json, Value};
use std::cell::RefCell;
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

/// Friday 9 October 2026, 12:00 UTC.
const FRI_NOON: i64 = 1_791_547_200_000;
const HOUR: i64 = 3_600_000;

fn scratch(tag: &str) -> PathBuf {
    let d = std::env::temp_dir().join(format!("kolux-rs-cards09-{tag}-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&d);
    std::fs::create_dir_all(&d).unwrap();
    d
}

fn seed_project(store: &Store, path: &Path) {
    store.set("projects", &json!([{ "id": "p1", "name": "repo", "path": path.to_string_lossy() }]).to_string()).unwrap();
}

fn form(ws: &Path, request: &str, schedule: Value) -> Value {
    json!({ "requestId": request, "name": "Morning", "prompt": "check", "provider": "claude", "projectId": "p1", "workspaceMode": "existing", "workspace": ws.to_string_lossy(), "schedule": schedule })
}

fn count(store: &Store) -> usize {
    auto::list(store).unwrap()["automations"].as_array().unwrap().len()
}

fn git_ok(dir: &Path, args: &[&str]) {
    assert!(std::process::Command::new("git").args(args).current_dir(dir).status().unwrap().success(), "git {args:?}");
}

/// A repository with one commit and a worktree `feat` beside it.
fn repo_with_branch(dir: &Path) -> (PathBuf, PathBuf) {
    let repo = dir.join("repo");
    std::fs::create_dir_all(&repo).unwrap();
    for args in [&["init", "-q", "-b", "main"][..], &["config", "user.email", "t@example.com"], &["config", "user.name", "t"], &["commit", "-q", "--allow-empty", "-m", "first"]] {
        git_ok(&repo, args);
    }
    let wt = dir.join("feat");
    git_ok(&repo, &["worktree", "add", "-q", "-b", "feat", &wt.to_string_lossy()]);
    (repo, wt)
}

fn pr(state: Option<&str>, draft: bool) -> Option<Pr> {
    state.map(|s| Pr { number: 7, url: "https://github.com/o/r/pull/7".into(), state: s.into(), title: Some("Fix".into()), head: Some("feat".into()), draft })
}

fn polled(path: &str, pr: Option<Pr>) -> PolledPr {
    PolledPr { path: path.into(), linked: false, pr, error: None }
}

/// The line `on_poll` builds for an opened pull request (automations.rs on_poll).
fn opened_line(p: &Pr) -> String {
    format!("Event: pull request #{} opened from {}: {} {}", p.number, p.head.as_deref().unwrap_or("its branch"), p.title.as_deref().unwrap_or("(no title)"), p.url)
}

fn event_row(id: &str, event: &str, ws: &Path) -> Value {
    json!({ "id": id, "name": id, "prompt": "review it", "provider": "claude", "projectId": "p1", "workspaceMode": "existing", "workspace": ws.to_string_lossy(), "trigger": { "kind": "event", "event": event }, "enabled": true })
}

// ---------------------------------------------------------------- AUTO-001

#[test]
fn auto001_box1_a_weekday_automation_saved_on_friday_afternoon_shows_monday_0900() {
    let dir = scratch("a001b1");
    let store = Store::open(&dir.join("db")).unwrap();
    seed_project(&store, &dir);
    let weekdays = json!({ "preset": "weekdays", "time": "09:00", "timezone": "America/Chicago" });
    // Friday 9 October 2026, 15:30 in Chicago (CDT, UTC-5) is 20:30 UTC.
    let fri_afternoon = FRI_NOON + 8 * HOUR + HOUR / 2;
    let made = auto::save_automation(&store, &form(&dir, "r1", weekdays.clone()), fri_afternoon).unwrap();
    assert_eq!(made["nextRunLabel"], json!("Monday 09:00"));
    // Monday 12 October 09:00 CDT is 14:00 UTC.
    assert_eq!(made["nextRunAt"], json!(FRI_NOON + 3 * 24 * HOUR + 2 * HOUR));
    assert_eq!(made["trigger"]["cron"], json!("0 9 * * 1-5"));
    // Saturday and Sunday never run: saved late on Saturday it still reads Monday 09:00.
    let saturday = FRI_NOON + 24 * HOUR + 10 * HOUR;
    let again = auto::save_automation(&store, &form(&dir, "r2", weekdays), saturday).unwrap();
    assert_eq!(again["nextRunLabel"], json!("Monday 09:00"));
}

#[test]
fn auto001_box2_a_cron_line_with_61_in_the_minute_field_is_refused_when_saving() {
    let dir = scratch("a001b2");
    let store = Store::open(&dir.join("db")).unwrap();
    seed_project(&store, &dir);
    let bad = json!({ "preset": "custom", "custom": "61 * * * *", "timezone": "UTC" });
    let said = auto::preview(&bad, FRI_NOON).unwrap_err();
    assert!(said.contains("minute field has 61; it takes 0 to 59"), "{said}");
    let refused = auto::save_automation(&store, &form(&dir, "r1", bad), FRI_NOON).unwrap_err();
    assert!(refused.contains("minute field has 61"), "{refused}");
    assert_eq!(count(&store), 0, "nothing written by the refused save");
}

#[test]
fn auto001_box3_a_cron_line_that_only_matches_29_february_shows_the_next_leap_year() {
    let dir = scratch("a001b3");
    let store = Store::open(&dir.join("db")).unwrap();
    seed_project(&store, &dir);
    let leap = json!({ "preset": "custom", "custom": "0 0 29 2 *", "timezone": "UTC" });
    let made = auto::save_automation(&store, &form(&dir, "r1", leap), FRI_NOON).unwrap();
    // 29 February 2028, 00:00 UTC.
    let expected = jiff::civil::date(2028, 2, 29).at(0, 0, 0, 0).to_zoned(jiff::tz::TimeZone::UTC).unwrap().timestamp().as_millisecond();
    assert_eq!(made["nextRunAt"], json!(expected));
    assert_eq!(made["nextRunLabel"], json!("29 Feb 2028 00:00"));
}

#[test]
fn auto001_box4_pausing_stops_the_launch_and_resuming_fires_the_following_due_time() {
    let dir = scratch("a001b4");
    let ws = dir.join("ws");
    std::fs::create_dir_all(&ws).unwrap();
    let store = Mutex::new(Store::open(&dir.join("db")).unwrap());
    seed_project(&store.lock().unwrap(), &ws);
    let hourly = json!({ "preset": "hourly", "time": "00:00", "timezone": "UTC" });
    let made = auto::save_automation(&store.lock().unwrap(), &form(&ws, "r1", hourly), FRI_NOON).unwrap();
    let id = made["id"].as_str().unwrap().to_string();
    let due = made["nextRunAt"].as_i64().unwrap();
    assert_eq!(due, FRI_NOON + HOUR);

    let git = Git::detect().unwrap();
    let said = RefCell::new(Vec::<(String, Value)>::new());
    let notify = |e: &str, v: Value| said.borrow_mut().push((e.to_string(), v));
    let yes = |_: &str| true;
    let l = Launch { git: &git, store: &store, claude_config: dir.join("claude.json"), installed: &yes, notify: &notify };
    let starts = || said.borrow().iter().filter(|(_, v)| v["kind"] == "start").count();

    // Paused: its due time passes and nothing launches.
    assert_eq!(auto::set_enabled(&store.lock().unwrap(), &id, false).unwrap()["enabled"], json!(false));
    assert!(auto::tick(&l, due + 1_000).unwrap().is_empty());
    assert_eq!(starts(), 0);
    assert!(auto::list(&store.lock().unwrap()).unwrap()["runs"].as_array().unwrap().is_empty());

    // Resumed: the upcoming time is worked out afresh; the old due time is not replayed, the next one fires.
    let resumed = auto::set_enabled(&store.lock().unwrap(), &id, true).unwrap();
    let next = resumed["nextRunAt"].as_i64().unwrap();
    assert_eq!(resumed["enabled"], json!(true));
    assert!(auto::tick(&l, next - 1).unwrap().is_empty(), "nothing before the following due time");
    assert_eq!(starts(), 0);
    let fired = auto::tick(&l, next + 1_000).unwrap();
    assert_eq!(fired.len(), 1);
    assert_eq!((fired[0]["automationId"].as_str(), fired[0]["trigger"].as_str(), fired[0]["status"].as_str()), (Some(id.as_str()), Some("schedule"), Some("dispatched")));
    assert_eq!(starts(), 1);
}

// ---------------------------------------------------------------- AUTO-004

#[test]
fn auto004_box1_a_draft_pull_request_opened_from_a_workspace_branch_starts_one_run_ending_with_its_line() {
    let dir = scratch("a004b1");
    let (repo, wt) = repo_with_branch(&dir);
    let store = Mutex::new(Store::open(&dir.join("db")).unwrap());
    seed_project(&store.lock().unwrap(), &repo);
    store.lock().unwrap().set(KEY, &json!([event_row("auto-1", "pr-opened", &repo)]).to_string()).unwrap();
    let git = Git::detect().unwrap();
    let said = RefCell::new(Vec::<(String, Value)>::new());
    let notify = |e: &str, v: Value| said.borrow_mut().push((e.to_string(), v));
    let yes = |_: &str| true;
    let l = Launch { git: &git, store: &store, claude_config: dir.join("claude.json"), installed: &yes, notify: &notify };

    // Two poll rounds, as the window feeds on_poll: no pull request yet, then a draft one open.
    let path = wt.to_string_lossy().to_string();
    let mut seen = HashMap::new();
    assert!(auto::pr_opened(&mut seen, &[polled(&path, None)]).is_empty());
    let opened = auto::pr_opened(&mut seen, &[polled(&path, pr(Some("OPEN"), true))]);
    assert_eq!(opened.len(), 1, "a draft counts as opened");
    let mut runs = Vec::new();
    for (folder, p) in &opened {
        runs.extend(auto::on_event(&l, "pr-opened", folder, &opened_line(p), FRI_NOON).unwrap());
    }
    assert_eq!(runs.len(), 1);
    let line = "Event: pull request #7 opened from feat: Fix https://github.com/o/r/pull/7";
    assert_eq!(runs[0]["eventDetail"], json!(line), "the run's marker carries the description");
    let start = said.borrow().iter().find(|(_, v)| v["kind"] == "start").cloned().expect("the agent start");
    let prompt = start.1["prompt"].as_str().unwrap();
    assert!(prompt.starts_with("review it") && prompt.ends_with(line), "{prompt}");
    assert_eq!(said.borrow().iter().filter(|(_, v)| v["kind"] == "start").count(), 1);
    // The run lands in the workspace the automation names, not in the worktree the event came from.
    assert_eq!(start.1["path"], json!(repo.to_string_lossy()));
    // Staying open is no new event.
    assert!(auto::pr_opened(&mut seen, &[polled(&path, pr(Some("OPEN"), true))]).is_empty());
}

#[test]
fn auto004_box2_the_same_event_twice_inside_five_minutes_is_a_single_run() {
    let dir = scratch("a004b2");
    let (repo, wt) = repo_with_branch(&dir);
    let store = Mutex::new(Store::open(&dir.join("db")).unwrap());
    seed_project(&store.lock().unwrap(), &repo);
    store.lock().unwrap().set(KEY, &json!([event_row("auto-1", "pr-opened", &repo)]).to_string()).unwrap();
    let git = Git::detect().unwrap();
    let notify = |_: &str, _: Value| {};
    let yes = |_: &str| true;
    let l = Launch { git: &git, store: &store, claude_config: dir.join("claude.json"), installed: &yes, notify: &notify };
    let path = wt.to_string_lossy().to_string();

    // The pull request opens, closes and opens again: two real events, two minutes apart.
    let mut seen = HashMap::new();
    let line = opened_line(&pr(Some("OPEN"), false).unwrap());
    auto::pr_opened(&mut seen, &[polled(&path, None)]);
    let first = auto::pr_opened(&mut seen, &[polled(&path, pr(Some("OPEN"), false))]);
    assert_eq!(auto::on_event(&l, "pr-opened", &first[0].0, &line, FRI_NOON).unwrap().len(), 1);
    assert!(auto::pr_opened(&mut seen, &[polled(&path, None)]).is_empty());
    let second = auto::pr_opened(&mut seen, &[polled(&path, pr(Some("OPEN"), false))]);
    assert_eq!(second.len(), 1, "the second event is a real one");
    assert!(auto::on_event(&l, "pr-opened", &second[0].0, &line, FRI_NOON + 2 * 60_000).unwrap().is_empty());
    let runs = auto::list(&store.lock().unwrap()).unwrap()["runs"].as_array().unwrap().clone();
    assert_eq!(runs.len(), 1, "a single run");
    // After the five minutes it listens again.
    assert_eq!(auto::on_event(&l, "pr-opened", &path, &line, FRI_NOON + 5 * 60_000 + 1).unwrap().len(), 1);
}

#[test]
fn auto004_box3_an_agent_an_automation_launched_completing_starts_no_agent_finished_automation() {
    let dir = scratch("a004b3");
    let (repo, wt) = repo_with_branch(&dir);
    let store = Mutex::new(Store::open(&dir.join("db")).unwrap());
    seed_project(&store.lock().unwrap(), &repo);
    let timed = json!({ "id": "auto-1", "name": "timed", "prompt": "go", "provider": "claude", "projectId": "p1", "workspaceMode": "existing", "workspace": repo.to_string_lossy(), "trigger": { "kind": "schedule", "cron": "0 * * * *", "timezone": "UTC" }, "enabled": true });
    store.lock().unwrap().set(KEY, &json!([timed, event_row("auto-2", "agent-finished", &repo)]).to_string()).unwrap();
    let git = Git::detect().unwrap();
    let notify = |_: &str, _: Value| {};
    let yes = |_: &str| true;
    let l = Launch { git: &git, store: &store, claude_config: dir.join("claude.json"), installed: &yes, notify: &notify };

    // The timed automation launches an agent; the window opens terminal 11 (hook pane 110) for it.
    let run = auto::run(&l, "auto-1", "manual").unwrap();
    assert_eq!(run["status"], json!("dispatched"));
    let claimed = auto::claim(&store.lock().unwrap(), 11, Some(110), &repo.to_string_lossy(), Some("claude")).unwrap();
    assert_eq!(claimed.as_deref(), run["id"].as_str());

    // That agent works, then finishes: an ordinary finish, which on_finish would turn into an event ...
    let mut seen = HashMap::new();
    assert!(!auto::agent_finished(&mut seen, 110, "working", false, false, false));
    assert!(auto::agent_finished(&mut seen, 110, "done", false, false, false));
    // ... except that the pane is a run's own, so on_finish stops before on_event (MIRROR automations.rs on_finish, `if own`).
    let runs: Vec<Value> = serde_json::from_str(&store.lock().unwrap().get(RUNS_KEY).unwrap().unwrap()).unwrap();
    assert!(auto::own_pane(&runs, Some(11), 110));
    // A pane the user opened is not one: its finish does start the listening automation.
    assert!(!auto::own_pane(&runs, Some(12), 120));
    let line = "Event: claude finished its work in feat";
    let started = auto::on_event(&l, "agent-finished", &wt.to_string_lossy(), line, FRI_NOON).unwrap();
    assert_eq!(started.iter().map(|r| r["automationId"].as_str().unwrap()).collect::<Vec<_>>(), ["auto-2"]);
}

#[test]
fn auto004_box3b_a_worktree_an_automation_made_never_sets_off_an_automation() {
    let dir = scratch("a004b3b");
    let (repo, wt) = repo_with_branch(&dir);
    let store = Mutex::new(Store::open(&dir.join("db")).unwrap());
    seed_project(&store.lock().unwrap(), &repo);
    store.lock().unwrap().set(KEY, &json!([event_row("auto-2", "agent-finished", &repo)]).to_string()).unwrap();
    let git = Git::detect().unwrap();
    let notify = |_: &str, _: Value| {};
    let yes = |_: &str| true;
    let l = Launch { git: &git, store: &store, claude_config: dir.join("claude.json"), installed: &yes, notify: &notify };
    let path = wt.to_string_lossy().to_string();
    projects::set_origin(&store.lock().unwrap(), &path, Some(&json!({ "madeBy": "automation", "automationId": "auto-1" }))).unwrap();
    assert!(auto::on_event(&l, "agent-finished", &path, "Event: claude finished its work in feat", FRI_NOON).unwrap().is_empty());
}

#[test]
fn auto004_box4_restarting_while_a_pull_request_is_already_open_starts_no_run() {
    // The window's memory of each branch's review state lives in the process, so a restart is an empty map.
    let path = "C:/work/feat";
    let mut before = HashMap::new();
    assert!(auto::pr_opened(&mut before, &[polled(path, None)]).is_empty());
    assert_eq!(auto::pr_opened(&mut before, &[polled(path, pr(Some("OPEN"), false))]).len(), 1, "while running, the step fires");
    // Restart: the first state learned is an open pull request, a starting point only.
    let mut after = HashMap::new();
    assert!(auto::pr_opened(&mut after, &[polled(path, pr(Some("OPEN"), false))]).is_empty());
    assert!(auto::pr_opened(&mut after, &[polled(path, pr(Some("OPEN"), true))]).is_empty());
    assert!(auto::pr_opened(&mut after, &[polled(path, pr(Some("OPEN"), false))]).is_empty());
}

// ---------------------------------------------------------------- AUTO-005

#[test]
fn auto005_box1_a_created_automation_is_listed_at_once_with_its_upcoming_run() {
    let dir = scratch("a005b1");
    let store = Store::open(&dir.join("db")).unwrap();
    seed_project(&store, &dir);
    assert_eq!(count(&store), 0);
    let weekdays = json!({ "preset": "weekdays", "time": "09:00", "timezone": "UTC" });
    let made = auto::save_automation(&store, &form(&dir, "r1", weekdays), FRI_NOON).unwrap();
    let listed = auto::list(&store).unwrap();
    let row = listed["automations"].as_array().unwrap().iter().find(|a| a["id"] == made["id"]).expect("listed straight away");
    assert_eq!((row["name"].as_str(), row["enabled"].as_bool()), (Some("Morning"), Some(true)));
    assert!(row["nextRunAt"].as_i64().is_some(), "with its upcoming run");
}

#[test]
fn auto005_box2_the_same_create_sent_twice_leaves_one_automation() {
    let dir = scratch("a005b2");
    let store = Store::open(&dir.join("db")).unwrap();
    seed_project(&store, &dir);
    let weekdays = json!({ "preset": "weekdays", "time": "09:00", "timezone": "UTC" });
    let first = auto::save_automation(&store, &form(&dir, "req-1", weekdays.clone()), FRI_NOON).unwrap();
    let second = auto::save_automation(&store, &form(&dir, "req-1", weekdays), FRI_NOON + 1_000).unwrap();
    assert_eq!(first["id"], second["id"]);
    assert_eq!(count(&store), 1);
}
