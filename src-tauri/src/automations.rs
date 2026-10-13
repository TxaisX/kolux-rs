//! Automations (area 09): a saved prompt plus an agent that Kolux launches by itself. The list
//! and every automation's numbered runs live in the state store (`automations`,
//! `automations.runs`) as JSON rows, so the importer and the command line read the same shape.
//! T-086 gives the page its list, Run now, pause / resume and delete (AUTO-016, AUTO-019); T-085-a
//! the create / edit dialog's save and the timetable with its clock (AUTO-001, AUTO-005); event
//! triggers and the self-closing run tab are T-085-b (AUTO-004, AUTO-011), truthful completion
//! T-072 (AUTO-012). T-175: the grace window for a missed run (AUTO-007), the 100-run history cap
//! (AUTO-021) and refusing a target that is not ready (AUTO-022).

use crate::git::{Git, Worktree};
use crate::projects;
use crate::schedule;
use crate::state::Store;
use serde_json::{json, Value};
use std::path::{Path, PathBuf};
use std::sync::Mutex;

pub const KEY: &str = "automations";
pub const RUNS_KEY: &str = "automations.runs";
/// Told to the window whenever an automation or a run changes, so an open page updates itself.
pub const EVENT: &str = "automations-changed";
/// AUTO-007: how late a missed run may still start, in minutes; 0 is no grace.
pub const GRACE_MINUTES: [u64; 7] = [0, 30, 60, 180, 720, 1440, 2880];
/// AUTO-021: the runs each automation keeps.
const KEEP_RUNS: usize = 100;
/// A due time older than this was missed, not merely caught late by the half-minute clock.
const ON_TIME_MS: i64 = 120_000;
/// AUTO-004: what an event trigger can listen for, and how long an automation rests after an
/// event has started a run.
const EVENTS: [&str; 3] = ["pr-opened", "checks-failed", "agent-finished"];
const EVENT_REST_MS: i64 = 5 * 60_000;
/// AUTO-008: how long a precheck may take, in seconds; the first is the default.
pub const PRECHECK_SECONDS: [u64; 4] = [60, 120, 300, 600];
/// The end of a precheck's output kept with its skipped run.
const KEEP_OUTPUT: usize = 4000;

pub fn now_ms() -> u64 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0)
}

/// Reads a list. A value that is there but will not parse is an error, never an empty list:
/// AUTO-016 says a failed load must not claim that nothing was created.
fn load(store: &Store, key: &str) -> Result<Vec<Value>, String> {
    match store.get(key).map_err(|e| e.to_string())? {
        None => Ok(Vec::new()),
        Some(text) => serde_json::from_str::<Vec<Value>>(&text).map_err(|e| format!("the saved automations could not be read ({e})")),
    }
}

fn save(store: &Store, key: &str, list: &[Value]) -> Result<(), String> {
    store.set(key, &Value::Array(list.to_vec()).to_string()).map_err(|e| e.to_string())
}

/// Every automation and every run, for the page. Each automation also carries its timetable in
/// words, when it goes next in words, and the preset, time and day the dialog opens with.
pub fn list(store: &Store) -> Result<Value, String> {
    let now = now_ms() as i64;
    let autos: Vec<Value> = load(store, KEY)?
        .into_iter()
        .map(|a| {
            let why = problem(store, &a).map(|p| p.1);
            let mut a = decorate(a, now);
            a["problem"] = json!(why);
            a
        })
        .collect();
    Ok(match load(store, RUNS_KEY) {
        Ok(runs) => {
            // AUTO-013: a run whose worktree folder is gone opens its saved output instead.
            let runs: Vec<Value> = runs
                .into_iter()
                .map(|mut r| {
                    if r["worktree"].as_str().is_some_and(|w| !Path::new(w).exists()) {
                        r["worktreeGone"] = json!(true);
                    }
                    r
                })
                .collect();
            json!({ "automations": autos, "runs": runs })
        }
        Err(e) => json!({ "automations": autos, "runs": [], "runsError": e.replace("automations", "runs") }),
    })
}

fn decorate(mut a: Value, now: i64) -> Value {
    if a["trigger"]["kind"] != "schedule" {
        return a;
    }
    let line = a["trigger"]["cron"].as_str().unwrap_or_default().to_string();
    let tz = a["trigger"]["timezone"].as_str().unwrap_or_default().to_string();
    a["timetable"] = json!(schedule::describe(&line, &tz));
    if let (Some(at), Ok(zone)) = (a["nextRunAt"].as_i64(), schedule::zone(&tz)) {
        a["nextRunLabel"] = json!(schedule::when(at, now, &zone));
    }
    let (preset, time, day) = schedule::classify(&line).unwrap_or(("custom", String::new(), None));
    a["form"] = json!({ "preset": preset, "time": time, "day": day, "custom": if preset == "custom" { line } else { String::new() } });
    a
}

/// The machine's own zone, for a timetable saved without one.
fn local_zone() -> String {
    jiff::tz::TimeZone::system().iana_name().unwrap_or("UTC").to_string()
}

/// AUTO-001: what the dialog asks for (`preset` hourly, daily, weekdays, weekly or custom, with
/// `time` HH:MM, `day` 0-6 from Sunday, `custom` a cron line or RRULE, and `timezone`), checked
/// and turned into the saved trigger plus its upcoming run. A line that is malformed, too long or
/// can never come true is refused here, so it is refused when saving.
pub fn preview(input: &Value, now: i64) -> Result<Value, String> {
    let tz = input["timezone"].as_str().map(str::trim).filter(|t| !t.is_empty()).map(String::from).unwrap_or_else(local_zone);
    let zone = schedule::zone(&tz)?;
    let preset = input["preset"].as_str().unwrap_or("custom");
    let line = match preset {
        "custom" => schedule::normalize(input["custom"].as_str().unwrap_or_default()),
        p => schedule::preset_line(p, input["time"].as_str().unwrap_or_default(), input["day"].as_u64().map(|d| d as u8))?,
    };
    let next = schedule::parse(&line)?.next_after(now, &zone).ok_or("this timetable can never come true; no run falls in the next eight years")?;
    Ok(json!({ "trigger": { "kind": "schedule", "cron": line, "timezone": tz }, "timetable": schedule::describe(&line, &tz), "nextRunAt": next, "nextRunLabel": schedule::when(next, now, &zone) }))
}

/// The upcoming run of a saved automation from `now`, or none when it waits for events or its
/// timetable no longer reads.
fn next_run(a: &Value, now: i64) -> Option<i64> {
    let t = &a["trigger"];
    if t["kind"] != "schedule" {
        return None;
    }
    schedule::parse(t["cron"].as_str()?).ok()?.next_after(now, &schedule::zone(t["timezone"].as_str()?).ok()?)
}

/// After every run, and on resume, the upcoming time is worked out again from now, so an old time
/// is never mistaken for a missed one.
fn reschedule(store: &Store, id: &str, now: i64) -> Result<(), String> {
    let mut all = load(store, KEY)?;
    let i = position(&all, id)?;
    all[i]["nextRunAt"] = json!(next_run(&all[i], now));
    save(store, KEY, &all)
}

/// AUTO-005: creates (no `id`) or edits an automation from the dialog. A create sent twice with
/// one `requestId` leaves one automation. Everything is checked before anything is written.
pub fn save_automation(store: &Store, input: &Value, now: i64) -> Result<Value, String> {
    let mut all = load(store, KEY)?;
    let request = input["requestId"].as_str().unwrap_or_default();
    if let Some(same) = all.iter().find(|a| !request.is_empty() && a["requestId"] == request) {
        return Ok(decorate(same.clone(), now));
    }
    let text = |k: &str| input[k].as_str().map(str::trim).unwrap_or_default().to_string();
    let name = text("name");
    if name.is_empty() {
        return Err("give the automation a name".into());
    }
    if text("prompt").is_empty() {
        return Err("write the prompt the agent starts with".into());
    }
    let provider = text("provider");
    if !["claude", "codex", "gemini"].contains(&provider.as_str()) {
        return Err("choose the agent: Claude Code, Codex or Gemini".into());
    }
    let project_id = text("projectId");
    let project = projects::load_projects(store).into_iter().find(|p| p.id == project_id).ok_or("choose a project that is in Kolux")?;
    let mode = text("workspaceMode");
    let workspace = match mode.as_str() {
        "existing" => {
            let w = text("workspace");
            let w = if w.is_empty() { project.path.clone() } else { w };
            if !Path::new(&w).is_dir() {
                return Err(format!("the workspace {w} is not there"));
            }
            json!(w)
        }
        "new-per-run" => Value::Null,
        _ => return Err("choose an existing workspace or a new one for every run".into()),
    };
    // AUTO-004: an event trigger has no timetable; going back to Schedule works the run out afresh.
    let timing = match input["trigger"]["kind"].as_str() {
        Some("event") => {
            let event = input["trigger"]["event"].as_str().unwrap_or_default();
            if !EVENTS.contains(&event) {
                return Err("choose the event: a pull request opens, checks fail, or an agent finishes".into());
            }
            json!({ "trigger": { "kind": "event", "event": event }, "nextRunAt": null })
        }
        _ => preview(&input["schedule"], now)?,
    };
    let g = &input["missedRunGraceMinutes"];
    let grace = match g.is_null() {
        true => None,
        false => Some(g.as_u64().or_else(|| g.as_str()?.trim().parse().ok()).filter(|g| GRACE_MINUTES.contains(g)).ok_or("a missed run may start late by none, 30 minutes, or 1, 3, 12, 24 or 48 hours")?),
    };
    let id = text("id");
    let i = if id.is_empty() {
        let n = all.iter().filter_map(|a| a["id"].as_str()?.strip_prefix("auto-")?.parse::<u64>().ok()).max().unwrap_or(0) + 1;
        all.push(json!({ "id": format!("auto-{n}"), "enabled": true, "requestId": request }));
        all.len() - 1
    } else {
        position(&all, &id)?
    };
    let grace = grace.unwrap_or_else(|| all[i]["missedRunGraceMinutes"].as_u64().unwrap_or(0));
    let t = &input["precheckTimeoutSeconds"];
    let limit = match t.is_null() {
        true => all[i]["precheckTimeoutSeconds"].as_u64().unwrap_or(PRECHECK_SECONDS[0]),
        false => t.as_u64().or_else(|| t.as_str()?.trim().parse().ok()).filter(|t| PRECHECK_SECONDS.contains(t)).ok_or("a precheck may take 1, 2, 5 or 10 minutes")?,
    };
    // Empty clears the precheck; left out on an edit keeps the old one.
    let precheck = match input["precheck"].is_null() {
        true => all[i]["precheck"].as_str().unwrap_or_default().to_string(),
        false => text("precheck"),
    };
    let row = &mut all[i];
    let enabled = input["enabled"].as_bool().unwrap_or(row["enabled"].as_bool().unwrap_or(true));
    for (k, v) in [
        ("name", json!(name)),
        ("prompt", input["prompt"].clone()),
        ("provider", json!(provider)),
        ("projectId", json!(project_id)),
        ("workspaceMode", json!(mode)),
        ("workspace", workspace),
        // Empty means the project's default branch (AUTO-005).
        ("baseBranch", json!(text("baseBranch"))),
        ("trigger", timing["trigger"].clone()),
        ("nextRunAt", timing["nextRunAt"].clone()),
        ("missedRunGraceMinutes", json!(grace)),
        ("precheck", json!(precheck)),
        ("precheckTimeoutSeconds", json!(limit)),
        ("enabled", json!(enabled)),
    ] {
        row[k] = v;
    }
    let out = row.clone();
    save(store, KEY, &all)?;
    Ok(decorate(out, now))
}

/// The clock (AUTO-001): starts every switched-on timed automation whose time has come. A paused
/// automation, or one waiting for events, is never started by it. AUTO-007: when Kolux was away
/// at the due time, the run still starts if the most recent due time is inside its grace window;
/// past it, one skipped entry says Kolux was not available and the timetable moves on, so a pile
/// of missed runs is never replayed. Returns the runs it began or logged.
pub fn tick(l: &Launch, now: i64) -> Result<Vec<Value>, String> {
    let due: Vec<Value> = {
        let store = l.store.lock().map_err(|e| e.to_string())?;
        load(&store, KEY)?.into_iter().filter(|a| a["enabled"] == true && a["trigger"]["kind"] == "schedule" && a["nextRunAt"].as_i64().is_some_and(|at| at <= now)).collect()
    };
    let mut started = Vec::new();
    for a in due {
        let id = a["id"].as_str().unwrap_or_default().to_string();
        let window = (a["missedRunGraceMinutes"].as_u64().unwrap_or(0) as i64 * 60_000).max(ON_TIME_MS);
        // Is there a due time between the window's start and now? Then the latest one is in it.
        if next_run(&a, now - window - 1).is_some_and(|t| t <= now) {
            started.push(run(l, &id, "schedule")?);
        } else {
            let store = l.store.lock().map_err(|e| e.to_string())?;
            started.push(skip(&store, &id, "schedule", "missed", "Kolux was not available at the due time, and the grace window has passed")?);
            reschedule(&store, &id, now)?;
            (l.notify)(EVENT, json!({ "id": id }));
        }
    }
    Ok(started)
}

/// AUTO-004: the folders whose pull request went from none to open since the last poll, drafts
/// included. The first state learned about a folder is only a starting point, so opening Kolux
/// never sets off a burst of runs; a failed lookup is no news, and a hand-linked pull request
/// (GIT-025) is not one opened from the branch.
pub fn pr_opened(seen: &mut std::collections::HashMap<String, bool>, polled: &[crate::scm::PolledPr]) -> Vec<(String, crate::scm::Pr)> {
    let mut out = Vec::new();
    for p in polled.iter().filter(|p| p.error.is_none() && !p.linked) {
        let open = p.pr.as_ref().filter(|pr| pr.state.eq_ignore_ascii_case("open"));
        if seen.insert(projects::name_key(&p.path), open.is_some()) == Some(false) {
            out.extend(open.map(|pr| (p.path.clone(), pr.clone())));
        }
    }
    out
}

/// AUTO-004: a happening in the worktree at `path` starts every switched-on automation of that
/// repo that listens for it, with `line` on the end of its prompt. Once an event has started a
/// run the automation ignores further events for five minutes, and a worktree an automation made
/// never sets one off, so no automation triggers itself. The run lands in the workspace the
/// automation names, not where the event came from. Returns the runs it began.
pub fn on_event(l: &Launch, event: &str, path: &str, line: &str, now: i64) -> Result<Vec<Value>, String> {
    let ids: Vec<String> = {
        let store = l.store.lock().map_err(|e| e.to_string())?;
        let mut all = load(&store, KEY)?;
        let projects = projects::load_projects(&store);
        let from_here = |a: &Value| {
            let Some(project) = projects.iter().find(|p| a["projectId"] == p.id.as_str()) else { return false };
            let listed = projects::list_workspaces(l.git, &store, project).unwrap_or_default();
            listed.iter().any(|w| projects::same_folder(Path::new(&w.path), Path::new(path)) && w.made_by.as_deref() != Some("automation"))
        };
        let ids: Vec<String> = all
            .iter()
            .filter(|a| a["enabled"] == true && a["trigger"]["kind"] == "event" && a["trigger"]["event"] == event)
            .filter(|a| a["lastEventAt"].as_i64().is_none_or(|t| now - t >= EVENT_REST_MS))
            .filter(|a| from_here(a))
            .filter_map(|a| a["id"].as_str().map(String::from))
            .collect();
        if ids.is_empty() {
            return Ok(Vec::new());
        }
        for a in all.iter_mut().filter(|a| ids.iter().any(|id| a["id"] == id.as_str())) {
            a["lastEventAt"] = json!(now);
        }
        save(&store, KEY, &all)?;
        ids
    };
    ids.iter().map(|id| run_with(l, id, "event", Some(line))).collect()
}

/// AUTO-004: fed every round of the window's pull request poll (GIT-027), so a new pull request
/// is spotted only while Kolux is already polling that branch.
pub fn on_poll(app: &tauri::AppHandle, polled: &[crate::scm::PolledPr]) {
    static SEEN: std::sync::OnceLock<Mutex<std::collections::HashMap<String, bool>>> = std::sync::OnceLock::new();
    let opened = pr_opened(&mut SEEN.get_or_init(Default::default).lock().unwrap_or_else(std::sync::PoisonError::into_inner), polled);
    for (path, pr) in opened {
        let line = format!("Event: pull request #{} opened from {}: {} {}", pr.number, pr.head.as_deref().unwrap_or("its branch"), pr.title.as_deref().unwrap_or("(no title)"), pr.url);
        if let Err(e) = launch_for(app, |l| on_event(l, "pr-opened", &path, &line, now_ms() as i64)) {
            eprintln!("automations event: {e}");
        }
    }
}

/// A run that never started, logged so the gap shows (AUTO-007, AUTO-022). AUTO-012: when the
/// automation's newest run was skipped for the same reason, that entry counts one more instead,
/// so an hour of five-minute refusals is one line, not twelve. A missed time is already one entry
/// per absence (AUTO-007), so two absences stay two.
fn skip(store: &Store, id: &str, trigger: &str, cause: &str, detail: &str) -> Result<Value, String> {
    let newest = load(store, RUNS_KEY)?.into_iter().filter(|r| r["automationId"] == id).max_by_key(|r| r["number"].as_u64().unwrap_or(0));
    if let Some(last) = newest.filter(|r| cause != "missed" && r["status"] == "skipped" && r["cause"] == cause && r["detail"] == detail && r["trigger"] == trigger) {
        let repeats = last["repeats"].as_u64().unwrap_or(1) + 1;
        return patch_run(store, last["id"].as_str().unwrap_or_default(), json!({ "repeats": repeats, "lastAt": now_ms() }));
    }
    let run = new_run(store, id, trigger)?;
    patch_run(store, run["id"].as_str().unwrap_or_default(), json!({ "status": "skipped", "cause": cause, "detail": detail }))
}

/// AUTO-022: what keeps an automation from running, as `(cause, reason)`, or none when it is
/// ready. The reason names the project, the worktree or the account that needs signing in.
fn problem(store: &Store, a: &Value) -> Option<(&'static str, String)> {
    let Some(project) = projects::load_projects(store).into_iter().find(|p| a["projectId"] == p.id.as_str()) else {
        return Some(("unavailable", "its project is no longer in Kolux".into()));
    };
    if a["workspaceMode"] != "new-per-run" {
        let path = a["workspace"].as_str().filter(|s| !s.is_empty()).unwrap_or(&project.path);
        if !Path::new(path).is_dir() {
            return Some(("unavailable", format!("its worktree {path} is gone")));
        }
    }
    let accounts = crate::cli_accounts::list(store);
    let stale = accounts["accounts"].as_array()?.iter().find(|x| x["agent"] == a["provider"] && x["active"] == true && x["needsSignIn"] == true)?;
    let agent = if a["provider"] == "codex" { "Codex" } else { "Claude" };
    Some(("signin", format!("the {agent} account {} needs signing in again", stale["email"].as_str().unwrap_or("in use"))))
}

fn in_progress(r: &Value) -> bool {
    ["pending", "dispatching", "dispatched"].contains(&r["status"].as_str().unwrap_or_default())
}

/// AUTO-021: keeps an automation's newest 100 runs; a run still in progress is never dropped.
fn prune(runs: &mut Vec<Value>, id: &str) {
    let extra = runs.iter().filter(|r| r["automationId"] == id).count().saturating_sub(KEEP_RUNS);
    let mut old: Vec<usize> = (0..runs.len()).filter(|&i| runs[i]["automationId"] == id && !in_progress(&runs[i])).collect();
    old.sort_by_key(|&i| runs[i]["number"].as_u64().unwrap_or(0));
    let gone: std::collections::HashSet<usize> = old.into_iter().take(extra).collect();
    let mut i = 0;
    runs.retain(|_| {
        i += 1;
        !gone.contains(&(i - 1))
    });
}

/// AUTO-021 on load: an old run without a number is given the next one, and a history saved too
/// large is cut down to each automation's newest 100.
pub fn tidy(store: &Store) -> Result<(), String> {
    let mut all = load(store, KEY)?;
    let mut runs = load(store, RUNS_KEY)?;
    let mut bare: Vec<usize> = (0..runs.len()).filter(|&i| runs[i]["number"].as_u64().is_none()).collect();
    bare.sort_by_key(|&i| runs[i]["at"].as_u64().unwrap_or(0));
    for i in bare {
        let id = runs[i]["automationId"].clone();
        let seen = runs.iter().filter(|r| r["automationId"] == id).filter_map(|r| r["number"].as_u64()).max().unwrap_or(0);
        let auto = all.iter_mut().find(|a| a["id"] == id);
        let number = seen.max(auto.as_ref().and_then(|a| a["lastRunNumber"].as_u64()).unwrap_or(0)) + 1;
        if let Some(a) = auto {
            a["lastRunNumber"] = json!(number);
        }
        runs[i]["number"] = json!(number);
    }
    // AUTO-012: a run an earlier start left queued or starting was never handed to an agent, so it
    // cannot finish now; one already dispatched stays, since Kolux cannot tell its agent was lost.
    // ponytail: reconnecting dispatched runs to their panes and closing the unfound ones after a
    // settling period need agent status (T-025), as does completing a run (T-072-b).
    for r in runs.iter_mut().filter(|r| r["status"] == "pending" || r["status"] == "dispatching") {
        r["status"] = json!("failed");
        r["detail"] = json!("Kolux closed before this run was handed to its agent");
    }
    let ids: std::collections::BTreeSet<String> = runs.iter().filter_map(|r| r["automationId"].as_str().map(String::from)).collect();
    for id in &ids {
        prune(&mut runs, id);
    }
    save(store, RUNS_KEY, &runs)?;
    save(store, KEY, &all)
}

fn position(list: &[Value], id: &str) -> Result<usize, String> {
    list.iter().position(|a| a["id"] == id).ok_or_else(|| format!("no automation {id}"))
}

/// AUTO-019: pausing stops future runs until resumed (the clock, `tick`, reads `enabled`).
pub fn set_enabled(store: &Store, id: &str, enabled: bool) -> Result<Value, String> {
    let mut all = load(store, KEY)?;
    let i = position(&all, id)?;
    all[i]["enabled"] = json!(enabled);
    if enabled {
        let next = next_run(&all[i], now_ms() as i64);
        all[i]["nextRunAt"] = json!(next);
    }
    save(store, KEY, &all)?;
    Ok(all[i].clone())
}

/// AUTO-019: an automation goes together with its run history.
pub fn delete(store: &Store, id: &str) -> Result<(), String> {
    let mut all = load(store, KEY)?;
    let i = position(&all, id)?;
    all.remove(i);
    let runs: Vec<Value> = load(store, RUNS_KEY)?.into_iter().filter(|r| r["automationId"] != id).collect();
    save(store, KEY, &all)?;
    save(store, RUNS_KEY, &runs)
}

/// AUTO-013: numbering is per automation, starts at 1 and only goes up (the highest number ever
/// handed out is kept on the automation, so deleting runs never reuses a number).
fn new_run(store: &Store, id: &str, trigger: &str) -> Result<Value, String> {
    let mut all = load(store, KEY)?;
    let i = position(&all, id)?;
    let mut runs = load(store, RUNS_KEY)?;
    let seen = runs.iter().filter(|r| r["automationId"] == id).filter_map(|r| r["number"].as_u64()).max().unwrap_or(0);
    let number = seen.max(all[i]["lastRunNumber"].as_u64().unwrap_or(0)) + 1;
    let n = runs.iter().filter_map(|r| r["id"].as_str()?.strip_prefix("run-")?.parse::<u64>().ok()).max().unwrap_or(0) + 1;
    let run = json!({ "id": format!("run-{n}"), "automationId": id, "number": number, "trigger": trigger, "status": "pending", "at": now_ms() });
    runs.push(run.clone());
    prune(&mut runs, id);
    all[i]["lastRunNumber"] = json!(number);
    save(store, RUNS_KEY, &runs)?;
    save(store, KEY, &all)?;
    Ok(run)
}

fn patch_run(store: &Store, run_id: &str, fields: Value) -> Result<Value, String> {
    let mut runs = load(store, RUNS_KEY)?;
    let i = runs.iter().position(|r| r["id"] == run_id).ok_or_else(|| format!("no run {run_id}"))?;
    if let (Some(row), Some(add)) = (runs[i].as_object_mut(), fields.as_object()) {
        for (k, v) in add {
            row.insert(k.clone(), v.clone());
        }
    }
    save(store, RUNS_KEY, &runs)?;
    Ok(runs[i].clone())
}

/// What a run needs from the app to start its agent.
pub struct Launch<'a> {
    pub git: &'a Git,
    pub store: &'a Mutex<Store>,
    pub claude_config: PathBuf,
    /// Is this agent id installed? (the catalogue's detection; injected so tests need no agent)
    pub installed: &'a dyn Fn(&str) -> bool,
    /// `(event, payload)` to the window: the start of a background tab, or a list change.
    pub notify: &'a dyn Fn(&str, Value),
}

/// AUTO-019 Run now: begins a run at once whatever the timetable or the switch says (a paused
/// automation runs too) and logs it as a manual run. The run is queued (`pending`) first, then
/// placed and handed to the window as a background tab (`dispatched`, AUTO-011), or ends as
/// skipped (`unavailable`) when its project or worktree vanishes on the way, or failed to dispatch
/// when the agent cannot start. AUTO-022: a target that is not ready refuses Run now with the
/// reason and leaves no run behind; a timed run is logged as skipped with it instead. AUTO-008: a
/// timed or event-started run first runs the automation's precheck in its target folder and is
/// skipped with the exit code and output when it fails; Run now never runs it.
pub fn run(l: &Launch, id: &str, trigger: &str) -> Result<Value, String> {
    run_with(l, id, trigger, None)
}

/// AUTO-004: an event-started run carries the happening's line (`eventDetail`, the marker's
/// tooltip) and has it on the end of the agent's prompt.
fn run_with(l: &Launch, id: &str, trigger: &str, event: Option<&str>) -> Result<Value, String> {
    let marked = |store: &Store, run: Value| match event {
        Some(line) => patch_run(store, run["id"].as_str().unwrap_or_default(), json!({ "eventDetail": line })),
        None => Ok(run),
    };
    let (mut auto, run) = {
        let store = l.store.lock().map_err(|e| e.to_string())?;
        let all = load(&store, KEY)?;
        let auto = all[position(&all, id)?].clone();
        if let Some((cause, why)) = problem(&store, &auto) {
            if trigger == "manual" {
                return Err(format!("Run now is blocked: {why}"));
            }
            let out = marked(&store, skip(&store, id, trigger, cause, &why)?)?;
            reschedule(&store, id, now_ms() as i64)?;
            drop(store);
            (l.notify)(EVENT, json!({ "runId": out["id"] }));
            return Ok(out);
        }
        let run = marked(&store, new_run(&store, id, trigger)?)?;
        (auto, run)
    };
    if let Some(line) = event {
        auto["prompt"] = json!(format!("{}

{line}", auto["prompt"].as_str().unwrap_or_default()));
    }
    let check = auto["precheck"].as_str().map(str::trim).unwrap_or_default();
    if trigger != "manual" && !check.is_empty() {
        let dir = match auto["workspaceMode"] == "new-per-run" {
            true => {
                let store = l.store.lock().map_err(|e| e.to_string())?;
                projects::load_projects(&store).into_iter().find(|p| auto["projectId"] == p.id.as_str()).map(|p| p.path).unwrap_or_default()
            }
            false => auto["workspace"].as_str().unwrap_or_default().to_string(),
        };
        let limit = std::time::Duration::from_secs(auto["precheckTimeoutSeconds"].as_u64().unwrap_or(PRECHECK_SECONDS[0]));
        // ponytail: the clock runs automations one after another, so a slow precheck holds up the
        // next due run by up to its limit; give each run its own thread if that ever matters.
        if let Some(fields) = run_precheck(check, Path::new(&dir), limit) {
            let store = l.store.lock().map_err(|e| e.to_string())?;
            reschedule(&store, id, now_ms() as i64)?;
            let out = patch_run(&store, run["id"].as_str().unwrap_or_default(), fields)?;
            drop(store);
            (l.notify)(EVENT, json!({ "runId": out["id"] }));
            return Ok(out);
        }
    }
    let run_id = run["id"].as_str().unwrap_or_default().to_string();
    (l.notify)(EVENT, json!({ "runId": run_id }));
    let outcome = place_and_start(l, &auto, &run_id);
    let fields = match outcome {
        Ok((wt, project_id)) => json!({ "status": "dispatched", "worktree": wt.path, "worktreeName": wt.name.clone().or(wt.branch.clone()).unwrap_or_else(|| folder_name(&wt.path)), "projectId": project_id }),
        Err(Stop::Skipped(why)) => json!({ "status": "skipped", "cause": "unavailable", "detail": why }),
        Err(Stop::Failed(why)) => json!({ "status": "failed", "detail": why }),
    };
    let done = {
        let store = l.store.lock().map_err(|e| e.to_string())?;
        reschedule(&store, id, now_ms() as i64)?;
        patch_run(&store, &run_id, fields)?
    };
    (l.notify)(EVENT, json!({ "runId": run_id }));
    Ok(done)
}

/// AUTO-008: runs a precheck command in `dir` (PowerShell on Windows, `sh` elsewhere, never a
/// window on screen) and stops it, with everything it started, at `limit`. None when it exits 0;
/// otherwise the skipped run's fields, with the exit code and the end of what it printed.
fn run_precheck(cmd: &str, dir: &Path, limit: std::time::Duration) -> Option<Value> {
    use std::process::{Command, Stdio};
    let log = std::env::temp_dir().join(format!("kolux-precheck-{}-{}.log", std::process::id(), now_ms()));
    let skipped = |exit: Value, timed_out: bool, output: String, detail: String| Some(json!({ "status": "skipped", "cause": "precheck", "exitCode": exit, "timedOut": timed_out, "output": output, "detail": detail }));
    let file = match std::fs::File::create(&log) {
        Ok(f) => f,
        Err(e) => return skipped(Value::Null, false, String::new(), format!("the precheck could not start: {e}")),
    };
    let mut c = if cfg!(windows) { Command::new("powershell.exe") } else { Command::new("sh") };
    if cfg!(windows) {
        c.args(["-NoProfile", "-NonInteractive", "-Command", cmd]);
    } else {
        c.args(["-c", cmd]);
    }
    // GIT-063: a precheck runs unattended too, so git fails rather than waits on a password.
    c.current_dir(dir).stdin(Stdio::null()).envs(crate::git::NO_PROMPT);
    if let Ok(copy) = file.try_clone() {
        c.stdout(copy).stderr(file);
    }
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        c.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
    }
    let mut child = match c.spawn() {
        Ok(ch) => ch,
        Err(e) => {
            let _ = std::fs::remove_file(&log);
            return skipped(Value::Null, false, String::new(), format!("the precheck could not start in {}: {e}", dir.display()));
        }
    };
    let began = std::time::Instant::now();
    let status = loop {
        if let Ok(Some(s)) = child.try_wait() {
            break Some(s);
        }
        if began.elapsed() >= limit {
            #[cfg(windows)]
            {
                use std::os::windows::process::CommandExt;
                let _ = Command::new("taskkill").args(["/T", "/F", "/PID", &child.id().to_string()]).creation_flags(0x0800_0000).output();
            }
            let _ = child.kill();
            let _ = child.wait();
            break None;
        }
        std::thread::sleep(std::time::Duration::from_millis(100));
    };
    let output = keep_tail(&String::from_utf8_lossy(&std::fs::read(&log).unwrap_or_default()));
    let _ = std::fs::remove_file(&log);
    match status {
        Some(s) if s.success() => None,
        Some(s) => {
            let code = s.code();
            let said = code.map(|c| format!("the precheck ended with exit code {c}, so the run was skipped")).unwrap_or_else(|| "the precheck was stopped, so the run was skipped".into());
            skipped(json!(code), false, output, said)
        }
        None => {
            let secs = limit.as_secs();
            let words = if secs >= 60 { format!("{} minute{}", secs / 60, if secs >= 120 { "s" } else { "" }) } else { format!("{secs} second{}", if secs == 1 { "" } else { "s" }) };
            skipped(Value::Null, true, output, format!("the precheck passed its {words} limit and was stopped, so the run was skipped"))
        }
    }
}

/// The last 4,000 characters, where a failing command's error usually is.
fn keep_tail(s: &str) -> String {
    let n = s.chars().count();
    s.chars().skip(n.saturating_sub(KEEP_OUTPUT)).collect()
}

enum Stop {
    Skipped(String),
    Failed(String),
}

fn folder_name(path: &str) -> String {
    Path::new(path).file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_else(|| path.to_string())
}

/// Finds or makes the run's workspace and asks the window to start the agent there.
fn place_and_start(l: &Launch, auto: &Value, run_id: &str) -> Result<(Worktree, String), Stop> {
    let agent = auto["provider"].as_str().unwrap_or_default().to_string();
    if !(l.installed)(&agent) {
        return Err(Stop::Failed(format!("{agent} is not installed")));
    }
    let project_id = auto["projectId"].as_str().unwrap_or_default().to_string();
    let project = {
        let store = l.store.lock().map_err(|e| Stop::Failed(e.to_string()))?;
        projects::load_projects(&store).into_iter().find(|p| p.id == project_id)
    }
    .ok_or_else(|| Stop::Skipped("its project is no longer in Kolux".into()))?;
    let new_per_run = auto["workspaceMode"] == "new-per-run";
    let wt = if new_per_run {
        // AUTO-005: cut from the chosen base; empty means the project's default branch.
        let base = auto["baseBranch"].as_str().map(str::trim).filter(|b| !b.is_empty());
        let wt = projects::create_fresh_from(l.git, l.store, &project.id, base).map_err(Stop::Failed)?;
        // AUTO-024: marked as made by an automation, so the sidebar can hide or tag it. A failed
        // record costs only the marker, never the run.
        if let Ok(store) = l.store.lock() {
            let _ = projects::set_origin(&store, &wt.path, Some(&json!({ "madeBy": "automation", "automationId": auto["id"] })));
        }
        wt
    } else {
        let path = auto["workspace"].as_str().filter(|s| !s.is_empty()).unwrap_or(&project.path).to_string();
        if !Path::new(&path).is_dir() {
            return Err(Stop::Skipped(format!("its worktree {path} is gone")));
        }
        Worktree { name: None, branch: None, head: String::new(), is_main: path == project.path, path, parent: None, locked: None, hidden: false, kind: String::new(), source: None, made_by: None }
    };
    let _ = crate::trust::trust_folders(&l.claude_config, &agent, &[PathBuf::from(&wt.path), PathBuf::from(&project.path)]);
    if new_per_run {
        (l.notify)(crate::cli::EVENT, json!({ "kind": "created", "projectId": project.id, "worktree": { "path": wt.path, "branch": wt.branch, "name": wt.name, "isMain": false }, "agent": Value::Null, "prompt": "", "activate": false }));
    }
    (l.notify)(crate::cli::EVENT, json!({ "kind": "start", "path": wt.path, "branch": wt.branch, "agent": agent, "prompt": auto["prompt"], "extra": [], "title": auto["name"], "runId": run_id }));
    Ok((wt, project.id))
}

// ---------------------------------------------------------------- the window's commands

type StoreState<'a> = tauri::State<'a, Mutex<Store>>;

#[tauri::command]
pub fn automations_list(store: StoreState<'_>) -> Result<Value, String> {
    list(&*store.lock().map_err(|e| e.to_string())?)
}

#[tauri::command]
pub fn automation_set_enabled(app: tauri::AppHandle, store: StoreState<'_>, id: String, enabled: bool) -> Result<Value, String> {
    use tauri::Emitter;
    let out = set_enabled(&*store.lock().map_err(|e| e.to_string())?, &id, enabled)?;
    let _ = app.emit(EVENT, json!({ "id": id }));
    Ok(out)
}

#[tauri::command]
pub fn automation_preview(input: Value) -> Result<Value, String> {
    preview(&input, now_ms() as i64)
}

#[tauri::command]
pub fn automation_save(app: tauri::AppHandle, store: StoreState<'_>, input: Value) -> Result<Value, String> {
    use tauri::Emitter;
    let out = save_automation(&*store.lock().map_err(|e| e.to_string())?, &input, now_ms() as i64)?;
    let _ = app.emit(EVENT, json!({ "id": out["id"] }));
    Ok(out)
}

fn launch_for<R>(app: &tauri::AppHandle, f: impl FnOnce(&Launch) -> R) -> R {
    use tauri::{Emitter, Manager};
    let store = app.state::<Mutex<Store>>();
    let git = app.state::<Git>();
    let notify = |event: &str, v: Value| {
        let _ = app.emit(event, v);
    };
    let installed = |id: &str| crate::agents::agent_list().iter().any(|a| a.id == id && a.installed);
    f(&Launch { git: &git, store: &store, claude_config: crate::trust::claude_config_file(), installed: &installed, notify: &notify })
}

/// Starts the clock: it looks for due automations about once a minute (every 30 seconds, so a run
/// begins within its minute) for as long as the app runs.
pub fn start_clock(app: tauri::AppHandle) {
    std::thread::spawn(move || {
        // AUTO-021: a history saved too large is cut down as Kolux loads it.
        if let Err(e) = launch_for(&app, |l| tidy(&*l.store.lock().map_err(|e| e.to_string())?)) {
            eprintln!("automations history: {e}");
        }
        loop {
            std::thread::sleep(std::time::Duration::from_secs(30));
            if let Err(e) = launch_for(&app, |l| tick(l, now_ms() as i64)) {
                eprintln!("automations clock: {e}");
            }
        }
    });
}

#[tauri::command]
pub fn automation_delete(app: tauri::AppHandle, store: StoreState<'_>, id: String) -> Result<(), String> {
    use tauri::Emitter;
    delete(&*store.lock().map_err(|e| e.to_string())?, &id)?;
    let _ = app.emit(EVENT, json!({ "id": id }));
    Ok(())
}

#[tauri::command]
pub async fn automation_run_now(app: tauri::AppHandle, id: String) -> Result<Value, String> {
    // Git may take a moment for a new-per-run worktree; off the window's thread.
    tauri::async_runtime::spawn_blocking(move || launch_for(&app, |l| run(l, &id, "manual")))
    .await
    .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::RefCell;

    fn temp(name: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("kolux-rs-auto-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&d);
        std::fs::create_dir_all(&d).unwrap();
        d
    }

    fn seed(store: &Store, ws: &Path) {
        let projects = json!([{ "id": "p1", "name": "repo", "path": ws.to_string_lossy() }]);
        store.set("projects", &projects.to_string()).unwrap();
        let autos = json!([
            { "id": "auto-1", "name": "Nightly", "prompt": "check", "provider": "claude", "projectId": "p1", "workspaceMode": "existing", "workspace": ws.to_string_lossy(), "enabled": false },
            { "id": "auto-2", "name": "Gone", "prompt": "x", "provider": "claude", "projectId": "nope", "workspaceMode": "existing", "enabled": true },
        ]);
        store.set(KEY, &autos.to_string()).unwrap();
    }

    fn polled(path: &str, state: Option<&str>) -> crate::scm::PolledPr {
        let pr = state.map(|st| crate::scm::Pr { number: 7, url: "https://github.com/o/r/pull/7".into(), state: st.into(), title: Some("Fix".into()), head: Some("feat".into()), draft: true });
        crate::scm::PolledPr { path: path.into(), linked: false, pr, error: None }
    }

    #[test]
    fn auto004_a_pull_request_counts_as_opened_only_on_the_step_from_none_to_open() {
        let mut seen = std::collections::HashMap::new();
        // The first state Kolux learns is a starting point: an open one at start-up never fires.
        assert!(pr_opened(&mut seen, &[polled("C:/a", Some("OPEN")), polled("C:/b", None)]).is_empty());
        assert!(pr_opened(&mut seen, &[polled("C:/a", Some("OPEN"))]).is_empty());
        // None to open fires once, drafts included; staying open does not fire again.
        let fired = pr_opened(&mut seen, &[polled("c:/B/", Some("OPEN"))]);
        assert_eq!(fired.iter().map(|(p, pr)| (p.as_str(), pr.number)).collect::<Vec<_>>(), [("c:/B/", 7)]);
        assert!(pr_opened(&mut seen, &[polled("C:/b", Some("OPEN"))]).is_empty());
        // A failed lookup is no news; a hand-linked pull request is not one opened from the branch.
        let mut e = polled("C:/c", None);
        e.error = Some("rate limited".into());
        assert!(pr_opened(&mut seen, &[polled("C:/c", None), e, polled("C:/c", Some("OPEN"))]).len() == 1);
        let mut l = polled("C:/d", None);
        assert!(pr_opened(&mut seen, std::slice::from_ref(&l)).is_empty());
        l.linked = true;
        l.pr = polled("C:/d", Some("OPEN")).pr;
        assert!(pr_opened(&mut seen, &[l]).is_empty());
    }

    #[test]
    fn auto004_an_event_starts_one_run_with_its_line_on_the_prompt_then_rests_five_minutes() {
        let dir = temp("a004");
        let repo = dir.join("repo");
        std::fs::create_dir_all(&repo).unwrap();
        for args in [&["init", "-q", "-b", "main"][..], &["config", "user.email", "t@example.com"], &["config", "user.name", "t"], &["commit", "-q", "--allow-empty", "-m", "first"]] {
            assert!(std::process::Command::new("git").args(args).current_dir(&repo).status().unwrap().success());
        }
        let wt = dir.join("feat");
        assert!(std::process::Command::new("git").args(["worktree", "add", "-q", "-b", "feat"]).arg(&wt).current_dir(&repo).status().unwrap().success());
        let store = Mutex::new(Store::open(&dir.join("db")).unwrap());
        let ev = json!({ "kind": "event", "event": "pr-opened" });
        {
            let s = store.lock().unwrap();
            s.set("projects", &json!([{ "id": "p1", "name": "repo", "path": repo.to_string_lossy() }, { "id": "p2", "name": "other", "path": dir.to_string_lossy() }]).to_string()).unwrap();
            let row = |id: &str, project: &str, trigger: &Value, on: bool| json!({ "id": id, "name": id, "prompt": "review it", "provider": "claude", "projectId": project, "workspaceMode": "existing", "workspace": repo.to_string_lossy(), "trigger": trigger, "enabled": on });
            s.set(KEY, &json!([row("auto-1", "p1", &ev, true), row("auto-2", "p1", &ev, false), row("auto-3", "p2", &ev, true), row("auto-4", "p1", &json!({ "kind": "schedule", "cron": "0 * * * *", "timezone": "UTC" }), true), row("auto-5", "p1", &json!({ "kind": "event", "event": "checks-failed" }), true)]).to_string()).unwrap();
        }
        let git = Git::detect().unwrap();
        let said = RefCell::new(Vec::<(String, Value)>::new());
        let notify = |e: &str, v: Value| said.borrow_mut().push((e.to_string(), v));
        let yes = |_: &str| true;
        let l = Launch { git: &git, store: &store, claude_config: dir.join("claude.json"), installed: &yes, notify: &notify };
        let line = "Event: pull request #7 opened from feat: Fix https://github.com/o/r/pull/7";
        let path = wt.to_string_lossy().to_string();
        let started = on_event(&l, "pr-opened", &path, line, FRI_NOON).unwrap();
        // Only the switched-on automation of that repo listening for that event runs.
        assert_eq!(started.iter().map(|r| r["automationId"].as_str().unwrap()).collect::<Vec<_>>(), ["auto-1"]);
        assert_eq!((started[0]["trigger"].as_str(), started[0]["status"].as_str(), started[0]["eventDetail"].as_str()), (Some("event"), Some("dispatched"), Some(line)));
        let start = said.borrow().iter().find(|(e, v)| e == crate::cli::EVENT && v["kind"] == "start").cloned().expect("a start");
        assert!(start.1["prompt"].as_str().unwrap().ends_with(line), "{}", start.1["prompt"]);
        // AUTO-013: the window learns which run the pane belongs to, so View run finds it.
        assert_eq!(start.1["runId"], started[0]["id"]);
        assert!(start.1["prompt"].as_str().unwrap().starts_with("review it"));
        // Another event inside five minutes is ignored; after that it runs again.
        assert!(on_event(&l, "pr-opened", &path, line, FRI_NOON + 4 * 60_000).unwrap().is_empty());
        assert_eq!(on_event(&l, "pr-opened", &path, line, FRI_NOON + 5 * 60_000 + 1).unwrap().len(), 1);
        // A folder that is not one of the project's worktrees starts nothing.
        assert!(on_event(&l, "pr-opened", &dir.join("elsewhere").to_string_lossy(), line, FRI_NOON + 20 * 60_000).unwrap().is_empty());
        // A worktree an automation made never sets off an automation (no automation triggers itself).
        projects::set_origin(&store.lock().unwrap(), &path, Some(&json!({ "madeBy": "automation", "automationId": "auto-9" }))).unwrap();
        assert!(on_event(&l, "pr-opened", &path, line, FRI_NOON + 40 * 60_000).unwrap().is_empty());
        drop(l);
        drop(store);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn auto004_saving_an_event_drops_the_timetable_and_going_back_works_it_out_afresh() {
        let dir = temp("a004s");
        let store = Store::open(&dir.join("db")).unwrap();
        seed(&store, &dir);
        let base = json!({ "name": "Review", "prompt": "look", "provider": "claude", "projectId": "p1", "workspaceMode": "existing", "workspace": dir.to_string_lossy(), "schedule": { "preset": "hourly", "time": "00:15", "timezone": "UTC" } });
        let mut ev = base.clone();
        ev["trigger"] = json!({ "kind": "event", "event": "pr-opened" });
        let saved = save_automation(&store, &ev, FRI_NOON).unwrap();
        assert_eq!((saved["trigger"].clone(), saved["nextRunAt"].clone()), (json!({ "kind": "event", "event": "pr-opened" }), Value::Null));
        let mut back = base.clone();
        back["id"] = saved["id"].clone();
        let timed = save_automation(&store, &back, FRI_NOON).unwrap();
        assert_eq!((timed["trigger"]["kind"].as_str(), timed["nextRunAt"].as_i64()), (Some("schedule"), Some(FRI_NOON + 15 * 60_000)));
        ev["trigger"]["event"] = json!("lunch");
        assert!(save_automation(&store, &ev, FRI_NOON).unwrap_err().contains("event"));
        drop(store);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_broken_saved_list_is_an_error_not_an_empty_one() {
        let dir = temp("broken");
        let store = Store::open(&dir).unwrap();
        assert_eq!(list(&store).unwrap()["automations"], json!([]));
        store.set(KEY, "{not json").unwrap();
        assert!(list(&store).unwrap_err().contains("could not be read"));
        // AUTO-018: history that cannot be read leaves the automations readable and says so,
        // so the page shows the run count as unknown rather than 0.
        store.set(KEY, "[]").unwrap();
        store.set(RUNS_KEY, "{not json").unwrap();
        let out = list(&store).unwrap();
        assert_eq!((out["automations"].clone(), out["runs"].clone()), (json!([]), json!([])));
        assert!(out["runsError"].as_str().unwrap().contains("could not be read"));
        // AUTO-013: a run whose worktree folder is gone says so, so the page opens its saved output.
        let here = dir.to_string_lossy().to_string();
        store.set(RUNS_KEY, &json!([{ "id": "r1", "worktree": here }, { "id": "r2", "worktree": dir.join("gone").to_string_lossy() }, { "id": "r3" }]).to_string()).unwrap();
        let runs = list(&store).unwrap()["runs"].clone();
        assert_eq!((runs[0].get("worktreeGone"), &runs[1]["worktreeGone"], runs[2].get("worktreeGone")), (None, &json!(true), None));
        drop(store);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn auto024_a_run_that_makes_its_own_worktree_marks_it_made_by_an_automation() {
        let dir = temp("a024");
        let repo = dir.join("repo");
        std::fs::create_dir_all(&repo).unwrap();
        for args in [&["init", "-q", "-b", "main"][..], &["config", "user.email", "t@example.com"], &["config", "user.name", "t"], &["commit", "-q", "--allow-empty", "-m", "first"]] {
            assert!(std::process::Command::new("git").args(args).current_dir(&repo).status().unwrap().success());
        }
        let store = Mutex::new(Store::open(&dir.join("db")).unwrap());
        {
            let s = store.lock().unwrap();
            s.set("projects", &json!([{ "id": "p1", "name": "repo", "path": repo.to_string_lossy(), "workspacesDir": dir.join("wts").to_string_lossy() }]).to_string()).unwrap();
            s.set(KEY, &json!([{ "id": "auto-9", "name": "Sweep", "prompt": "tidy", "provider": "claude", "projectId": "p1", "workspaceMode": "new-per-run", "enabled": false }]).to_string()).unwrap();
        }
        let git = Git::detect().unwrap();
        let notify = |_: &str, _: Value| {};
        let yes = |_: &str| true;
        let l = Launch { git: &git, store: &store, claude_config: dir.join("claude.json"), installed: &yes, notify: &notify };
        assert_eq!(run(&l, "auto-9", "manual").unwrap()["status"], json!("dispatched"));
        let s = store.lock().unwrap();
        let project = projects::load_projects(&s)[0].clone();
        let listed = projects::list_workspaces(&git, &s, &project).unwrap();
        let made = listed.iter().find(|w| !w.is_main).expect("the run's worktree");
        assert_eq!(made.made_by.as_deref(), Some("automation"));
        // A worktree made by hand is not tagged.
        assert_eq!(listed.iter().find(|w| w.is_main).unwrap().made_by.as_deref(), None);
        drop(s);
        drop(store);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn run_now_on_a_paused_automation_starts_a_manual_run_and_numbers_only_go_up() {
        let dir = temp("run");
        let ws = dir.join("ws");
        std::fs::create_dir_all(&ws).unwrap();
        let store = Mutex::new(Store::open(&dir.join("db")).unwrap());
        seed(&store.lock().unwrap(), &ws);
        let git = Git::detect().unwrap();
        let said = RefCell::new(Vec::<(String, Value)>::new());
        let notify = |e: &str, v: Value| said.borrow_mut().push((e.to_string(), v));
        let yes = |_: &str| true;
        let l = Launch { git: &git, store: &store, claude_config: dir.join("claude.json"), installed: &yes, notify: &notify };

        let first = run(&l, "auto-1", "manual").unwrap();
        assert_eq!((first["number"].as_u64(), first["status"].as_str(), first["trigger"].as_str()), (Some(1), Some("dispatched"), Some("manual")));
        let start = said.borrow().iter().find(|(e, v)| e == crate::cli::EVENT && v["kind"] == "start").cloned().expect("a start for the window");
        assert_eq!((start.1["agent"].as_str(), start.1["prompt"].as_str(), start.1["title"].as_str()), (Some("claude"), Some("check"), Some("Nightly")));
        // The paused automation stays paused.
        assert_eq!(list(&store.lock().unwrap()).unwrap()["automations"][0]["enabled"], json!(false));

        // Deleting history never hands a number out twice.
        store.lock().unwrap().set(RUNS_KEY, "[]").unwrap();
        assert_eq!(run(&l, "auto-1", "manual").unwrap()["number"], json!(2));

        // A project that is gone: Run now is refused with the reason, never a launch (AUTO-022).
        let before = said.borrow().len();
        assert!(run(&l, "auto-2", "manual").unwrap_err().contains("project"));
        assert_eq!(said.borrow().len(), before);

        // An agent that is not installed: failed to dispatch.
        let no = |_: &str| false;
        let l2 = Launch { installed: &no, ..l };
        assert_eq!(run(&l2, "auto-1", "manual").unwrap()["status"], json!("failed"));
        drop(l2);
        drop(store);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn pause_and_delete_take_their_runs_with_them() {
        let dir = temp("del");
        let store = Store::open(&dir).unwrap();
        seed(&store, &dir);
        new_run(&store, "auto-1", "manual").unwrap();
        new_run(&store, "auto-2", "manual").unwrap();
        assert_eq!(set_enabled(&store, "auto-2", false).unwrap()["enabled"], json!(false));
        delete(&store, "auto-1").unwrap();
        let after = list(&store).unwrap();
        assert_eq!(after["automations"].as_array().unwrap().len(), 1);
        assert!(after["runs"].as_array().unwrap().iter().all(|r| r["automationId"] == "auto-2"));
        assert!(delete(&store, "auto-1").is_err());
        drop(store);
        let _ = std::fs::remove_dir_all(&dir);
    }

    // Friday 9 October 2026, 12:00 UTC.
    const FRI_NOON: i64 = 1_791_547_200_000;

    fn form(ws: &Path, schedule: Value) -> Value {
        json!({ "requestId": "r1", "name": "Morning", "prompt": "check", "provider": "claude", "projectId": "p1", "workspaceMode": "existing", "workspace": ws.to_string_lossy(), "schedule": schedule })
    }

    #[test]
    fn saving_checks_everything_and_a_doubled_create_makes_one_automation() {
        let dir = temp("save");
        let store = Store::open(&dir.join("db")).unwrap();
        seed(&store, &dir);
        let weekdays = json!({ "preset": "weekdays", "time": "09:00", "timezone": "UTC" });
        let mut bad = form(&dir, weekdays.clone());
        bad["name"] = json!("  ");
        assert!(save_automation(&store, &bad, FRI_NOON).unwrap_err().contains("name"));
        bad = form(&dir, json!({ "preset": "custom", "custom": "61 * * * *", "timezone": "UTC" }));
        assert!(save_automation(&store, &bad, FRI_NOON).is_err());
        bad = form(&dir, json!({ "preset": "custom", "custom": "0 0 30 2 *", "timezone": "UTC" }));
        assert!(save_automation(&store, &bad, FRI_NOON).unwrap_err().contains("never"));
        bad = form(&dir, weekdays.clone());
        bad["projectId"] = json!("nope");
        assert!(save_automation(&store, &bad, FRI_NOON).is_err());
        assert_eq!(list(&store).unwrap()["automations"].as_array().unwrap().len(), 2, "nothing written by a refused save");

        let made = save_automation(&store, &form(&dir, weekdays.clone()), FRI_NOON).unwrap();
        assert_eq!((made["id"].as_str(), made["enabled"].as_bool()), (Some("auto-3"), Some(true)));
        assert_eq!(made["nextRunLabel"], json!("Monday 09:00"));
        assert_eq!(made["form"]["preset"], json!("weekdays"));
        let again = save_automation(&store, &form(&dir, weekdays), FRI_NOON).unwrap();
        assert_eq!(again["id"], made["id"]);
        assert_eq!(list(&store).unwrap()["automations"].as_array().unwrap().len(), 3);

        let mut edit = form(&dir, json!({ "preset": "custom", "custom": "0 0 29 2 *", "timezone": "UTC" }));
        edit["id"] = json!("auto-3");
        edit["requestId"] = json!("r2");
        let leap = save_automation(&store, &edit, FRI_NOON).unwrap();
        assert_eq!(leap["nextRunLabel"], json!("29 Feb 2028 00:00"));
        drop(store);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn the_clock_starts_what_is_due_leaves_paused_ones_and_moves_a_missed_time_on() {
        let dir = temp("tick");
        let ws = dir.join("ws");
        std::fs::create_dir_all(&ws).unwrap();
        let store = Mutex::new(Store::open(&dir.join("db")).unwrap());
        let every = json!({ "kind": "schedule", "cron": "* * * * *", "timezone": "UTC" });
        {
            let s = store.lock().unwrap();
            seed(&s, &ws);
            let base = json!({ "prompt": "check", "provider": "claude", "projectId": "p1", "workspaceMode": "existing", "workspace": ws.to_string_lossy(), "trigger": every });
            let row = |id: &str, enabled: bool, at: i64| {
                let mut r = base.clone();
                r["id"] = json!(id);
                r["name"] = json!(id);
                r["enabled"] = json!(enabled);
                r["nextRunAt"] = json!(at);
                r
            };
            let mut autos = json!([row("due", true, FRI_NOON), row("paused", false, FRI_NOON), row("missed", true, FRI_NOON - 5_400_000), row("later", true, FRI_NOON + 60_000)]);
            // Half past every hour: 11:30 was missed and nothing has fallen due since.
            autos[2]["trigger"]["cron"] = json!("30 * * * *");
            s.set(KEY, &autos.to_string()).unwrap();
        }
        let git = Git::detect().unwrap();
        let notify = |_: &str, _: Value| {};
        let yes = |_: &str| true;
        let l = Launch { git: &git, store: &store, claude_config: dir.join("claude.json"), installed: &yes, notify: &notify };
        let started = tick(&l, FRI_NOON + 5_000).unwrap();
        assert_eq!(started.iter().filter(|r| r["status"] == "dispatched").count(), 1);
        assert_eq!((started[0]["automationId"].as_str(), started[0]["trigger"].as_str()), (Some("due"), Some("schedule")));
        let after = list(&store.lock().unwrap()).unwrap();
        let next = |id: &str| after["automations"].as_array().unwrap().iter().find(|a| a["id"] == id).unwrap()["nextRunAt"].as_i64();
        assert!(next("due").unwrap() > FRI_NOON + 5_000, "a run moves the time on");
        assert!(next("missed").unwrap() > FRI_NOON + 5_000, "a missed time is moved on, not run");
        assert_eq!(next("paused"), Some(FRI_NOON));
        let runs = after["runs"].as_array().unwrap();
        assert_eq!(runs.len(), 2, "the run that began and one skipped entry for the missed time");
        assert!(runs.iter().any(|r| r["automationId"] == "missed" && r["cause"] == "missed"));
        drop(l);
        drop(store);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_precheck_gates_timed_runs_never_run_now_and_has_a_limit() {
        let dir = temp("precheck");
        let ws = dir.join("ws");
        std::fs::create_dir_all(&ws).unwrap();
        let store = Mutex::new(Store::open(&dir.join("db")).unwrap());
        {
            let s = store.lock().unwrap();
            seed(&s, &ws);
            let mut f = form(&ws, json!({ "preset": "hourly", "time": "00:15", "timezone": "UTC" }));
            f["precheck"] = json!("echo x > ran.txt; echo nope; exit 1");
            f["precheckTimeoutSeconds"] = json!(90);
            assert!(save_automation(&s, &f, FRI_NOON).unwrap_err().contains("10 minutes"));
            f["precheckTimeoutSeconds"] = Value::Null;
            let made = save_automation(&s, &f, FRI_NOON).unwrap();
            assert_eq!((made["id"].as_str(), made["precheckTimeoutSeconds"].as_u64()), (Some("auto-3"), Some(60)), "60 seconds when none is chosen");
        }
        let git = Git::detect().unwrap();
        let notify = |_: &str, _: Value| {};
        let yes = |_: &str| true;
        let l = Launch { git: &git, store: &store, claude_config: dir.join("claude.json"), installed: &yes, notify: &notify };

        // A timed run: the precheck runs in the worktree, exits 1, and the run is skipped with its output.
        let skipped = run(&l, "auto-3", "schedule").unwrap();
        assert_eq!((skipped["status"].as_str(), skipped["cause"].as_str(), skipped["exitCode"].as_i64()), (Some("skipped"), Some("precheck"), Some(1)), "{skipped}");
        assert!(skipped["output"].as_str().unwrap().contains("nope"));
        assert!(ws.join("ran.txt").exists(), "it ran in the target worktree");
        std::fs::remove_file(ws.join("ran.txt")).unwrap();

        // Run now never runs the precheck: the agent launches.
        assert_eq!(run(&l, "auto-3", "manual").unwrap()["status"], json!("dispatched"));
        assert!(!ws.join("ran.txt").exists());

        // Exit 0 lets the timed run go on.
        {
            let s = store.lock().unwrap();
            let mut autos = load(&s, KEY).unwrap();
            autos[2]["precheck"] = json!("exit 0");
            save(&s, KEY, &autos).unwrap();
        }
        assert_eq!(run(&l, "auto-3", "schedule").unwrap()["status"], json!("dispatched"));

        // Past its limit it is stopped and the run reads timed out.
        let began = std::time::Instant::now();
        let out = run_precheck("sleep 20", &ws, std::time::Duration::from_millis(1500)).unwrap();
        assert!(began.elapsed() < std::time::Duration::from_secs(10), "stopped at the limit");
        assert_eq!((out["timedOut"].as_bool(), out["cause"].as_str()), (Some(true), Some("precheck")));
        assert!(out["detail"].as_str().unwrap().contains("limit"));
        assert!(run_precheck("exit 0", &ws, std::time::Duration::from_secs(30)).is_none());

        // Up to 4,000 characters of what it printed are kept: the end, where the error is.
        let long = format!("{}END", "x".repeat(5000));
        let kept = keep_tail(&long);
        assert_eq!(kept.chars().count(), 4000);
        assert!(kept.ends_with("END"));
        drop(l);
        drop(store);
        let _ = std::fs::remove_dir_all(&dir);
    }

    fn runs_of(store: &Mutex<Store>, id: &str) -> Vec<Value> {
        let all = list(&store.lock().unwrap()).unwrap();
        all["runs"].as_array().unwrap().iter().filter(|r| r["automationId"] == id).cloned().collect()
    }

    #[test]
    fn a_missed_time_runs_late_inside_its_grace_window_and_is_logged_once_past_it() {
        let dir = temp("grace");
        let ws = dir.join("ws");
        std::fs::create_dir_all(&ws).unwrap();
        let store = Mutex::new(Store::open(&dir.join("db")).unwrap());
        let hourly = json!({ "kind": "schedule", "cron": "0 * * * *", "timezone": "UTC" });
        {
            let s = store.lock().unwrap();
            seed(&s, &ws);
            let mut f = form(&ws, json!({ "preset": "hourly", "time": "09:00", "timezone": "UTC" }));
            f["missedRunGraceMinutes"] = json!(45);
            assert!(save_automation(&s, &f, FRI_NOON).unwrap_err().contains("30 minutes"));
            f["missedRunGraceMinutes"] = json!(180);
            assert_eq!(save_automation(&s, &f, FRI_NOON).unwrap()["missedRunGraceMinutes"], json!(180));
            let row = |id: &str, grace: u64| json!({ "id": id, "name": id, "prompt": "check", "provider": "claude", "projectId": "p1", "workspaceMode": "existing", "workspace": ws.to_string_lossy(), "trigger": hourly, "enabled": true, "nextRunAt": FRI_NOON, "missedRunGraceMinutes": grace });
            s.set(KEY, &json!([row("late", 30), row("strict", 0)]).to_string()).unwrap();
        }
        let git = Git::detect().unwrap();
        let notify = |_: &str, _: Value| {};
        let yes = |_: &str| true;
        let l = Launch { git: &git, store: &store, claude_config: dir.join("claude.json"), installed: &yes, notify: &notify };

        // Kolux shut over noon and back at 12:20: 30 minutes of grace runs late, none skips.
        let started = tick(&l, FRI_NOON + 20 * 60_000).unwrap();
        assert_eq!(started.iter().filter(|r| r["status"] == "dispatched").map(|r| r["automationId"].as_str().unwrap()).collect::<Vec<_>>(), ["late"]);
        let strict = runs_of(&store, "strict");
        assert_eq!(strict.len(), 1);
        assert_eq!((strict[0]["status"].as_str(), strict[0]["cause"].as_str()), (Some("skipped"), Some("missed")));
        assert!(strict[0]["detail"].as_str().unwrap().contains("not available"));

        // Shut for three hours more with no grace: a single skipped entry, never one per hour.
        tick(&l, FRI_NOON + 200 * 60_000).unwrap();
        tick(&l, FRI_NOON + 200 * 60_000 + 30_000).unwrap();
        let strict = runs_of(&store, "strict");
        assert_eq!(strict.len(), 2);
        assert!(strict.iter().all(|r| r["status"] == "skipped"));
        let next = list(&store.lock().unwrap()).unwrap()["automations"][1]["nextRunAt"].as_i64();
        assert_eq!(next, Some(FRI_NOON + 4 * 3_600_000), "the timetable carries on");
        drop(l);
        drop(store);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn history_keeps_the_newest_100_runs_and_never_drops_one_in_progress() {
        let dir = temp("cap");
        let ws = dir.join("ws");
        std::fs::create_dir_all(&ws).unwrap();
        let store = Mutex::new(Store::open(&dir.join("db")).unwrap());
        seed(&store.lock().unwrap(), &ws);
        let git = Git::detect().unwrap();
        let notify = |_: &str, _: Value| {};
        // Not installed: every run fails to start, so it is finished at once.
        let no = |_: &str| false;
        let l = Launch { git: &git, store: &store, claude_config: dir.join("claude.json"), installed: &no, notify: &notify };
        new_run(&store.lock().unwrap(), "auto-1", "manual").unwrap(); // #1 stays queued: in progress
        for _ in 0..104 {
            run(&l, "auto-1", "manual").unwrap();
        }
        let numbers = || {
            let mut n: Vec<u64> = runs_of(&store, "auto-1").iter().map(|r| r["number"].as_u64().unwrap()).collect();
            n.sort();
            n
        };
        let mut want: Vec<u64> = vec![1];
        want.extend(7..=105);
        assert_eq!(numbers(), want, "the run in progress stays past the cap");
        patch_run(&store.lock().unwrap(), "run-1", json!({ "status": "completed" })).unwrap();
        assert!(numbers().contains(&1), "it finishes and stays listed");
        assert_eq!(run(&l, "auto-1", "manual").unwrap()["number"], json!(106));
        assert_eq!(numbers(), (7..=106).collect::<Vec<u64>>());
        drop(l);
        drop(store);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn loading_numbers_old_runs_and_cuts_an_oversized_history() {
        let dir = temp("tidy");
        let store = Store::open(&dir).unwrap();
        seed(&store, &dir);
        let mut runs: Vec<Value> = (1..=120u64).map(|i| json!({ "id": format!("run-{i}"), "automationId": "auto-1", "number": i, "status": "failed", "at": i })).collect();
        runs.push(json!({ "id": "run-121", "automationId": "auto-2", "status": "skipped", "at": 5 }));
        store.set(RUNS_KEY, &Value::Array(runs).to_string()).unwrap();
        tidy(&store).unwrap();
        let all = list(&store).unwrap();
        let mine: Vec<u64> = all["runs"].as_array().unwrap().iter().filter(|r| r["automationId"] == "auto-1").map(|r| r["number"].as_u64().unwrap()).collect();
        assert_eq!(mine, (21..=120).collect::<Vec<u64>>());
        let other: Vec<&Value> = all["runs"].as_array().unwrap().iter().filter(|r| r["automationId"] == "auto-2").collect();
        assert_eq!(other[0]["number"], json!(1), "an old run without a number is given one");
        assert_eq!(new_run(&store, "auto-2", "manual").unwrap()["number"], json!(2));
        assert_eq!(new_run(&store, "auto-1", "manual").unwrap()["number"], json!(121));
        drop(store);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn auto012_the_same_refusal_again_and_again_is_one_entry_with_a_count() {
        let dir = temp("repeat");
        let ws = dir.join("ws");
        std::fs::create_dir_all(&ws).unwrap();
        let store = Mutex::new(Store::open(&dir.join("db")).unwrap());
        seed(&store.lock().unwrap(), &ws);
        let git = Git::detect().unwrap();
        let notify = |_: &str, _: Value| {};
        let yes = |_: &str| true;
        let l = Launch { git: &git, store: &store, claude_config: dir.join("claude.json"), installed: &yes, notify: &notify };
        // Every five minutes for an hour, with auto-2's project gone.
        for k in 0..12 {
            {
                let s = store.lock().unwrap();
                let mut autos = load(&s, KEY).unwrap();
                autos[1]["trigger"] = json!({ "kind": "schedule", "cron": "*/5 * * * *", "timezone": "UTC" });
                autos[1]["nextRunAt"] = json!(FRI_NOON + k * 300_000);
                save(&s, KEY, &autos).unwrap();
            }
            tick(&l, FRI_NOON + k * 300_000 + 5_000).unwrap();
        }
        let gone = runs_of(&store, "auto-2");
        assert_eq!(gone.len(), 1, "{gone:?}");
        assert_eq!((gone[0]["status"].as_str(), gone[0]["cause"].as_str(), gone[0]["repeats"].as_u64()), (Some("skipped"), Some("unavailable"), Some(12)));
        // A different reason starts a new entry.
        {
            let s = store.lock().unwrap();
            skip(&s, "auto-2", "schedule", "missed", "Kolux was not available").unwrap();
        }
        assert_eq!(runs_of(&store, "auto-2").len(), 2);
        drop(l);
        drop(store);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn auto012_after_a_restart_a_run_never_handed_on_is_closed_and_a_running_one_is_kept() {
        let dir = temp("restart");
        let store = Store::open(&dir.join("db")).unwrap();
        seed(&store, &dir);
        let runs = json!([
            { "id": "run-1", "automationId": "auto-1", "number": 1, "status": "pending", "at": 1 },
            { "id": "run-2", "automationId": "auto-1", "number": 2, "status": "dispatching", "at": 2 },
            { "id": "run-3", "automationId": "auto-1", "number": 3, "status": "dispatched", "at": 3 },
        ]);
        store.set(RUNS_KEY, &runs.to_string()).unwrap();
        tidy(&store).unwrap();
        let got = load(&store, RUNS_KEY).unwrap();
        let st: Vec<&str> = got.iter().map(|r| r["status"].as_str().unwrap()).collect();
        assert_eq!(st, ["failed", "failed", "dispatched"], "Kolux cannot tell a running agent was lost, so it stays dispatched");
        assert!(got[0]["detail"].as_str().unwrap().contains("closed before"), "{}", got[0]);
        drop(store);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn run_now_refuses_a_target_that_is_not_ready_and_the_clock_logs_it_skipped() {
        let dir = temp("ready");
        let ws = dir.join("gone-ws");
        std::fs::create_dir_all(&ws).unwrap();
        let store = Mutex::new(Store::open(&dir.join("db")).unwrap());
        seed(&store.lock().unwrap(), &ws);
        let git = Git::detect().unwrap();
        let notify = |_: &str, _: Value| {};
        let yes = |_: &str| true;
        let l = Launch { git: &git, store: &store, claude_config: dir.join("claude.json"), installed: &yes, notify: &notify };

        std::fs::remove_dir_all(&ws).unwrap();
        let why = run(&l, "auto-1", "manual").unwrap_err();
        assert!(why.contains("worktree") && why.contains("gone-ws"), "{why}");
        assert!(runs_of(&store, "auto-1").is_empty(), "a refused Run now leaves no run behind");
        let shown = list(&store.lock().unwrap()).unwrap();
        assert!(shown["automations"][0]["problem"].as_str().unwrap().contains("worktree"));
        assert!(shown["automations"][1]["problem"].as_str().unwrap().contains("project"));

        // A due time passes with the project removed: one skipped entry marked unavailable.
        {
            let s = store.lock().unwrap();
            let mut autos = load(&s, KEY).unwrap();
            autos[1]["trigger"] = json!({ "kind": "schedule", "cron": "0 * * * *", "timezone": "UTC" });
            autos[1]["nextRunAt"] = json!(FRI_NOON);
            save(&s, KEY, &autos).unwrap();
        }
        tick(&l, FRI_NOON + 5_000).unwrap();
        let gone = runs_of(&store, "auto-2");
        assert_eq!(gone.len(), 1);
        assert_eq!((gone[0]["status"].as_str(), gone[0]["cause"].as_str()), (Some("skipped"), Some("unavailable")));

        // The agent's account needs signing in again: named, and Run now is blocked.
        std::fs::create_dir_all(&ws).unwrap();
        {
            let s = store.lock().unwrap();
            let acct = json!([{ "id": "a1", "email": "me@example.com", "organization": null, "configDir": "c", "lastSignIn": 0, "stale": true }]);
            s.set(crate::claude_accounts::LIST_KEY, &acct.to_string()).unwrap();
            s.set(crate::claude_accounts::ACTIVE_KEY, "a1").unwrap();
        }
        let why = run(&l, "auto-1", "manual").unwrap_err();
        assert!(why.contains("me@example.com") && why.contains("sign"), "{why}");
        assert!(runs_of(&store, "auto-1").is_empty());
        drop(l);
        drop(store);
        let _ = std::fs::remove_dir_all(&dir);
    }
}
