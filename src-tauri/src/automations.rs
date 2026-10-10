//! Automations (area 09): a saved prompt plus an agent that Kolux launches by itself. The list
//! and every automation's numbered runs live in the state store (`automations`,
//! `automations.runs`) as JSON rows, so the importer and the command line read the same shape.
//! T-086 gives the page its list, Run now, pause / resume and delete (AUTO-016, AUTO-019); T-085-a
//! the create / edit dialog's save and the timetable with its clock (AUTO-001, AUTO-005); event
//! triggers and the self-closing run tab are T-085-b (AUTO-004, AUTO-011), truthful completion
//! T-072 (AUTO-012).

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
    let autos: Vec<Value> = load(store, KEY)?.into_iter().map(|a| decorate(a, now)).collect();
    Ok(json!({ "automations": autos, "runs": load(store, RUNS_KEY)? }))
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
    let timing = preview(&input["schedule"], now)?;
    let id = text("id");
    let i = if id.is_empty() {
        let n = all.iter().filter_map(|a| a["id"].as_str()?.strip_prefix("auto-")?.parse::<u64>().ok()).max().unwrap_or(0) + 1;
        all.push(json!({ "id": format!("auto-{n}"), "enabled": true, "requestId": request }));
        all.len() - 1
    } else {
        position(&all, &id)?
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
        ("enabled", json!(enabled)),
    ] {
        row[k] = v;
    }
    let out = row.clone();
    save(store, KEY, &all)?;
    Ok(decorate(out, now))
}

/// The clock (AUTO-001): starts every switched-on timed automation whose time has come. A paused
/// automation, or one waiting for events, is never started by it. A due time more than two minutes
/// old was missed while Kolux was away; it is moved on, not run (the grace window is AUTO-007,
/// T-175). Returns the runs it began.
pub fn tick(l: &Launch, now: i64) -> Result<Vec<Value>, String> {
    let due: Vec<(String, i64)> = {
        let store = l.store.lock().map_err(|e| e.to_string())?;
        load(&store, KEY)?.iter().filter(|a| a["enabled"] == true && a["trigger"]["kind"] == "schedule").filter_map(|a| Some((a["id"].as_str()?.to_string(), a["nextRunAt"].as_i64()?))).filter(|(_, at)| *at <= now).collect()
    };
    let mut started = Vec::new();
    for (id, at) in due {
        if now - at > 120_000 {
            reschedule(&*l.store.lock().map_err(|e| e.to_string())?, &id, now)?;
            (l.notify)(EVENT, json!({ "id": id }));
        } else {
            started.push(run(l, &id, "schedule")?);
        }
    }
    Ok(started)
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
/// skipped (`unavailable`) when its project or workspace is gone, or failed to dispatch when the
/// agent cannot start. The precheck (AUTO-008, T-192) is never run for a manual run.
pub fn run(l: &Launch, id: &str, trigger: &str) -> Result<Value, String> {
    let (auto, run) = {
        let store = l.store.lock().map_err(|e| e.to_string())?;
        let run = new_run(&store, id, trigger)?;
        let all = load(&store, KEY)?;
        (all[position(&all, id)?].clone(), run)
    };
    let run_id = run["id"].as_str().unwrap_or_default().to_string();
    (l.notify)(EVENT, json!({ "runId": run_id }));
    let outcome = place_and_start(l, &auto);
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

enum Stop {
    Skipped(String),
    Failed(String),
}

fn folder_name(path: &str) -> String {
    Path::new(path).file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_else(|| path.to_string())
}

/// Finds or makes the run's workspace and asks the window to start the agent there.
fn place_and_start(l: &Launch, auto: &Value) -> Result<(Worktree, String), Stop> {
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
        projects::create_fresh_from(l.git, l.store, &project.id, base).map_err(Stop::Failed)?
    } else {
        let path = auto["workspace"].as_str().filter(|s| !s.is_empty()).unwrap_or(&project.path).to_string();
        if !Path::new(&path).is_dir() {
            return Err(Stop::Skipped(format!("its workspace {path} is gone")));
        }
        Worktree { name: None, branch: None, head: String::new(), is_main: path == project.path, path, parent: None, hidden: false }
    };
    let _ = crate::trust::trust_folders(&l.claude_config, &agent, &[PathBuf::from(&wt.path), PathBuf::from(&project.path)]);
    if new_per_run {
        (l.notify)(crate::cli::EVENT, json!({ "kind": "created", "projectId": project.id, "worktree": { "path": wt.path, "branch": wt.branch, "name": wt.name, "isMain": false }, "agent": Value::Null, "prompt": "", "activate": false }));
    }
    (l.notify)(crate::cli::EVENT, json!({ "kind": "start", "path": wt.path, "branch": wt.branch, "agent": agent, "prompt": auto["prompt"], "extra": [], "title": auto["name"] }));
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
    std::thread::spawn(move || loop {
        std::thread::sleep(std::time::Duration::from_secs(30));
        if let Err(e) = launch_for(&app, |l| tick(l, now_ms() as i64)) {
            eprintln!("automations clock: {e}");
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

    #[test]
    fn a_broken_saved_list_is_an_error_not_an_empty_one() {
        let dir = temp("broken");
        let store = Store::open(&dir).unwrap();
        assert_eq!(list(&store).unwrap()["automations"], json!([]));
        store.set(KEY, "{not json").unwrap();
        assert!(list(&store).unwrap_err().contains("could not be read"));
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

        // A project that is gone: skipped as unavailable, never a launch.
        let before = said.borrow().len();
        let gone = run(&l, "auto-2", "manual").unwrap();
        assert_eq!((gone["status"].as_str(), gone["cause"].as_str(), gone["number"].as_u64()), (Some("skipped"), Some("unavailable"), Some(1)));
        assert!(said.borrow()[before..].iter().all(|(e, _)| e == EVENT));

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
            let autos = json!([row("due", true, FRI_NOON), row("paused", false, FRI_NOON), row("missed", true, FRI_NOON - 3_600_000), row("later", true, FRI_NOON + 60_000)]);
            s.set(KEY, &autos.to_string()).unwrap();
        }
        let git = Git::detect().unwrap();
        let notify = |_: &str, _: Value| {};
        let yes = |_: &str| true;
        let l = Launch { git: &git, store: &store, claude_config: dir.join("claude.json"), installed: &yes, notify: &notify };
        let started = tick(&l, FRI_NOON + 5_000).unwrap();
        assert_eq!(started.len(), 1);
        assert_eq!((started[0]["automationId"].as_str(), started[0]["trigger"].as_str()), (Some("due"), Some("schedule")));
        let after = list(&store.lock().unwrap()).unwrap();
        let next = |id: &str| after["automations"].as_array().unwrap().iter().find(|a| a["id"] == id).unwrap()["nextRunAt"].as_i64();
        assert!(next("due").unwrap() > FRI_NOON + 5_000, "a run moves the time on");
        assert!(next("missed").unwrap() > FRI_NOON + 5_000, "a missed time is moved on, not run");
        assert_eq!(next("paused"), Some(FRI_NOON));
        assert_eq!(after["runs"].as_array().unwrap().len(), 1);
        drop(l);
        drop(store);
        let _ = std::fs::remove_dir_all(&dir);
    }
}
