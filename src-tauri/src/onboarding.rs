//! ONB-001..005: the first-run wizard's record in the store, so the wizard opens for a brand-new
//! profile, comes back on the screen it reached and never returns once closed. ONB-008: a record
//! from an older version is raised to this one on start (T-208); the close latch and its retry
//! toast live in the window (firstRun.ts closer).

use crate::state::Store;
use serde::{Deserialize, Serialize};
use std::sync::Mutex;
use tauri::State;

const KEY: &str = "onboarding";
/// COMPAT (ONB-007): the wizard version this record belongs to.
pub const VERSION: u32 = 7;
/// The four screens are 0..=3.
const LAST: i32 = 3;

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Onboarding {
    #[serde(default)]
    pub version: u32,
    /// The last screen finished, 0..=3; -1 when none.
    #[serde(default = "none_finished")]
    pub step: i32,
    /// Milliseconds since 1970 when the wizard closed; none while it is open.
    #[serde(default)]
    pub closed_at: Option<u64>,
    /// "completed" or "dismissed" once closed.
    #[serde(default)]
    pub outcome: Option<String>,
    /// Fields kept for the checklist and milestones (ONB-011, ONB-013), carried through untouched.
    #[serde(flatten)]
    pub rest: serde_json::Map<String, serde_json::Value>,
}

fn none_finished() -> i32 {
    -1
}

fn raw(store: &Store) -> Option<Onboarding> {
    store.get(KEY).ok().flatten().and_then(|s| serde_json::from_str(&s).ok())
}

/// ONB-008: progress held within the four screens, the version raised to this one, and a close
/// time filled in when an outcome has none. Fields this version does not read are kept as they are.
fn upgraded(mut rec: Onboarding, now: u64) -> Onboarding {
    rec.version = VERSION;
    rec.step = rec.step.clamp(-1, LAST);
    if rec.outcome.is_some() && rec.closed_at.is_none() {
        rec.closed_at = Some(now);
    }
    rec
}

fn load(store: &Store) -> Option<Onboarding> {
    raw(store).map(|r| upgraded(r, now_ms()))
}

fn save(store: &Store, rec: &Onboarding) -> Result<(), String> {
    store.set(KEY, &serde_json::to_string(rec).map_err(|e| e.to_string())?).map_err(|e| e.to_string())
}

/// ONB-001: the profile's first start opens a record; a profile with none counts as done (ONB-008).
pub fn first_start(store: &Store, starts: u64) -> Result<(), String> {
    match raw(store) {
        None if starts == 1 => save(store, &Onboarding { version: VERSION, step: -1, closed_at: None, outcome: None, rest: Default::default() }),
        Some(old) if upgraded(old.clone(), 0) != old => save(store, &upgraded(old, now_ms())),
        _ => Ok(()),
    }
}

/// Moving on from `step` stores it as the last screen finished; a closed record stays as it is.
fn stepped(mut rec: Onboarding, step: i32) -> Onboarding {
    if rec.closed_at.is_none() {
        rec.step = step.clamp(-1, LAST);
    }
    rec
}

fn closed(mut rec: Onboarding, outcome: &str, now: u64) -> Result<Onboarding, String> {
    if outcome != "completed" && outcome != "dismissed" {
        return Err(format!("{outcome} is not a way the first run ends"));
    }
    if rec.closed_at.is_none() {
        rec.closed_at = Some(now);
        rec.outcome = Some(outcome.into());
        if outcome == "completed" {
            rec.step = LAST;
        } else {
            // ONB-006: closing as dismissed (Skip, Esc, the X or a backdrop click) also dismisses the
            // sidebar checklist.
            rec.rest.insert("checklistDismissed".into(), true.into());
        }
    }
    Ok(rec)
}

/// ONB-009: Onboarding in the help menu starts the wizard over on screen one; the close, the
/// outcome and the progress go, and of the checklist only its dismissed mark (ONB-013).
fn reopened(rec: Option<Onboarding>) -> Onboarding {
    let mut rec = rec.unwrap_or(Onboarding { version: VERSION, step: -1, closed_at: None, outcome: None, rest: Default::default() });
    rec.step = -1;
    rec.closed_at = None;
    rec.outcome = None;
    rec.rest.remove("checklistDismissed");
    rec
}

/// ONB-011: the three first-success milestones, kept in the record under "milestones".
const MILESTONES: [&str; 3] = ["aiConnected", "kitLaunched", "resultsOpened"];

/// ONB-011: a milestone's time is written at its first occurrence and never again. A profile with
/// no record (one from before the wizard, ONB-008) has had its firsts already, so nothing is kept.
fn mark(store: &Store, name: &str, now: u64) -> Result<(), String> {
    if !MILESTONES.contains(&name) {
        return Err(format!("{name} is not a first-run milestone"));
    }
    let Some(mut rec) = load(store) else { return Ok(()) };
    let times = rec.rest.entry("milestones").or_insert_with(|| serde_json::json!({}));
    if !times.is_object() {
        *times = serde_json::json!({});
    }
    let times = times.as_object_mut().expect("an object");
    if times.contains_key(name) {
        return Ok(());
    }
    times.insert(name.into(), now.into());
    save(store, &rec)
}

fn now_ms() -> u64 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0)
}

/// The record when the wizard should open (none closed it yet), else nothing.
#[tauri::command]
pub fn onboarding_get(store: State<'_, Mutex<Store>>) -> Result<Option<Onboarding>, String> {
    let store = store.lock().map_err(|e| e.to_string())?;
    Ok(load(&store).filter(|r| r.closed_at.is_none()))
}

#[tauri::command]
pub fn onboarding_step(store: State<'_, Mutex<Store>>, step: i32) -> Result<(), String> {
    let store = store.lock().map_err(|e| e.to_string())?;
    match load(&store) {
        Some(rec) => save(&store, &stepped(rec, step)),
        None => Ok(()),
    }
}

#[tauri::command]
pub fn onboarding_close(store: State<'_, Mutex<Store>>, outcome: String) -> Result<(), String> {
    let store = store.lock().map_err(|e| e.to_string())?;
    match load(&store) {
        Some(rec) => save(&store, &closed(rec, &outcome, now_ms())?),
        None => Ok(()),
    }
}

/// ONB-027 / ONB-022 / USAGE 012: what the guides remember on this profile: the startup tips
/// already shown, the Explore Kolux stops visited and the features tried. COMPAT (ONB-027): the
/// seen tips are data an importer brings across, so they keep their own plain list.
const GUIDE: &str = "guide";
/// The startup tips this build knows, newest first (ONB-027: newer tips come first).
pub const TIPS: &[&str] = &["cli", "palette"];
/// No list grows past this; an id past it is ignored.
const MAX_IDS: usize = 64;

#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Guide {
    #[serde(default)]
    pub tips_seen: Vec<String>,
    #[serde(default)]
    pub visited: Vec<String>,
    #[serde(default)]
    pub tried: Vec<String>,
    /// ONB-032: the contextual tours skipped or finished (COMPAT: the importer brings it across).
    #[serde(default)]
    pub tours_seen: Vec<String>,
    /// ONB-032: whether this profile gets tours by itself, decided once (tours_get) and never again.
    #[serde(default)]
    pub tours_auto: Option<bool>,
    /// ONB-042: each known feature's first use and running use count on this machine. Unknown
    /// features and damaged entries are dropped on load without notice.
    #[serde(default, deserialize_with = "features_de")]
    pub features: std::collections::BTreeMap<String, Use>,
}

/// ONB-042: one feature's record: when it was first used (ms since 1970) and how often.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct Use {
    pub first: u64,
    pub count: u64,
}

/// ONB-042: the fixed list of features whose use the profile keeps.
pub const FEATURES: &[&str] = &[
    "board", "palette", "browser", "browser-page", "tasks", "automations", "split", "workspace-create", "workspace-switch", "skill-setup",
    "kits", "kit-results", "editor", "diff", "notes", "pr", "ship", "commit", "push", "usage",
    "inbox", "artifacts", "settings", "shortcuts", "search", "file-find", "markdown", "floating", "layout", "zoom",
    "rename", "orchestration", "cli", "notifications", "default-agent", "setup-script", "second-repo", "explore", "setup-guide", "parallel",
];

fn features_de<'de, D: serde::Deserializer<'de>>(d: D) -> Result<std::collections::BTreeMap<String, Use>, D::Error> {
    let raw = <serde_json::Value as Deserialize>::deserialize(d)?;
    let serde_json::Value::Object(m) = raw else { return Ok(Default::default()) };
    Ok(m.into_iter().filter(|(k, _)| FEATURES.contains(&k.as_str())).filter_map(|(k, v)| serde_json::from_value::<Use>(v).ok().filter(|u| u.count > 0).map(|u| (k, u))).collect())
}

/// ONB-042: a use of `id`: the first time is written once, the count only goes up. The count is
/// raised here, under the store lock, so a late save from the window can never lower it.
fn used(mut g: Guide, id: &str, now: u64) -> Result<Guide, String> {
    if !FEATURES.contains(&id) {
        return Err(format!("{id} is not a feature Kolux keeps"));
    }
    let u = g.features.entry(id.into()).or_insert(Use { first: now, count: 0 });
    u.count = u.count.saturating_add(1);
    Ok(g)
}

/// ONB-033: every contextual tour id, built or planned; a seen entry for any other id (one an older
/// version saved) is dropped on load.
pub const TOURS: &[&str] = &["tasks", "automations", "parallel", "browser", "board", "floating", "create", "grid"];

/// Keeps the known ids of `v` once each, in order.
fn known(v: Vec<String>, ids: &[&str]) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    for t in v {
        if ids.contains(&t.as_str()) && !out.contains(&t) {
            out.push(t);
        }
    }
    out
}

/// The stored record; tips this build no longer knows are dropped and each tip counts once.
fn guide_load(store: &Store) -> Guide {
    let mut g: Guide = store.get(GUIDE).ok().flatten().and_then(|s| serde_json::from_str(&s).ok()).unwrap_or_default();
    g.tips_seen = known(std::mem::take(&mut g.tips_seen), TIPS);
    g.tours_seen = known(std::mem::take(&mut g.tours_seen), TOURS);
    g
}

/// ONB-032: the profile qualifies for automatic tours only when the first-run wizard is showing the
/// first time this is asked (a new profile); an existing profile never does. Decided once.
fn tours_decided(mut g: Guide, onboarding_open: bool) -> (Guide, bool) {
    let fresh = g.tours_auto.is_none();
    g.tours_auto.get_or_insert(onboarding_open);
    (g, fresh)
}

#[tauri::command]
pub fn tours_get(store: State<'_, Mutex<Store>>) -> Result<Guide, String> {
    let store = store.lock().map_err(|e| e.to_string())?;
    let open = load(&store).is_some_and(|r| r.closed_at.is_none());
    let (g, fresh) = tours_decided(guide_load(&store), open);
    if fresh {
        store.set(GUIDE, &serde_json::to_string(&g).map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
    }
    Ok(g)
}

/// `id` added once to `list` (tipsSeen, visited or tried).
fn marked(mut g: Guide, list: &str, id: &str) -> Result<Guide, String> {
    if list == "used" {
        return used(g, id, now_ms());
    }
    if id.is_empty() || id.len() > 40 || !id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-') {
        return Err(format!("{id:?} is not a guide id"));
    }
    let v = match list {
        "tipsSeen" if TIPS.contains(&id) => &mut g.tips_seen,
        "tipsSeen" => return Err(format!("{id} is not a startup tip")),
        "toursSeen" if TOURS.contains(&id) => &mut g.tours_seen,
        "toursSeen" => return Err(format!("{id} is not a tour")),
        "visited" => &mut g.visited,
        "tried" => &mut g.tried,
        _ => return Err(format!("{list} is not a guide list")),
    };
    if !v.iter().any(|x| x == id) && v.len() < MAX_IDS {
        v.push(id.into());
    }
    Ok(g)
}

/// ONB-013: what the newcomer checklist reads from the first-run record: whether the wizard was
/// closed (and how), the checklist's dismissed mark and the first-success milestones. None for a
/// profile with no record (one from before the wizard), which never gets the checklist.
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FirstRun {
    pub closed: bool,
    pub outcome: Option<String>,
    pub checklist_dismissed: bool,
    pub milestones: serde_json::Map<String, serde_json::Value>,
}

fn first_run(rec: Option<Onboarding>) -> Option<FirstRun> {
    let rec = rec?;
    let milestones = match rec.rest.get("milestones") {
        Some(serde_json::Value::Object(m)) => m.iter().filter(|(k, v)| MILESTONES.contains(&k.as_str()) && v.is_u64()).map(|(k, v)| (k.clone(), v.clone())).collect(),
        _ => Default::default(),
    };
    Some(FirstRun {
        closed: rec.closed_at.is_some(),
        outcome: rec.outcome,
        checklist_dismissed: rec.rest.get("checklistDismissed").and_then(|v| v.as_bool()).unwrap_or(false),
        milestones,
    })
}

/// The guide record as the window reads it: the stored lists plus the first-run view (ONB-013).
/// The view is read only; guide_mark never stores it.
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GuideView {
    #[serde(flatten)]
    pub guide: Guide,
    pub first_run: Option<FirstRun>,
}

#[tauri::command]
pub fn guide_get(store: State<'_, Mutex<Store>>) -> Result<GuideView, String> {
    let store = store.lock().map_err(|e| e.to_string())?;
    Ok(GuideView { guide: guide_load(&store), first_run: first_run(load(&store)) })
}

#[tauri::command]
pub fn guide_mark(store: State<'_, Mutex<Store>>, list: String, id: String) -> Result<Guide, String> {
    let store = store.lock().map_err(|e| e.to_string())?;
    let g = marked(guide_load(&store), &list, &id)?;
    store.set(GUIDE, &serde_json::to_string(&g).map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
    Ok(g)
}

/// ONB-027 / ONB-028: whether this build's `kolux` launcher sits beside the app, and whether a
/// terminal outside Kolux finds it (its folder is on PATH). Another program called kolux on PATH
/// does not count.
#[derive(Clone, Copy, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CliStatus {
    pub installed: bool,
    pub on_path: bool,
}

fn same_dir(a: &std::path::Path, b: &std::path::Path) -> bool {
    let norm = |p: &std::path::Path| {
        let p = std::fs::canonicalize(p).unwrap_or_else(|_| p.to_path_buf());
        let s = p.to_string_lossy().trim_end_matches(['\\', '/']).to_string();
        if cfg!(windows) {
            s.to_lowercase()
        } else {
            s
        }
    };
    norm(a) == norm(b)
}

/// How long the whole PATH may take to answer before the folders still looking are passed over
/// (council: a PATH entry on a drive that is offline froze the window while it was looked up).
const PATH_ENTRY_WAIT: std::time::Duration = std::time::Duration::from_secs(1);

/// A PATH folder that did not answer in time is not asked again for this long.
const DEAD_FOR: std::time::Duration = std::time::Duration::from_secs(300);

/// What is known about one PATH folder's lookup: still running, or late the last time.
#[derive(Default)]
struct Probe {
    busy: bool,
    dead_at: Option<std::time::Instant>,
}

/// Shared by every check, so reopening the guide never starts a second lookup of a folder whose
/// first one has not come back, and a folder that was late is skipped for a while.
fn probes() -> &'static Mutex<std::collections::HashMap<String, Probe>> {
    static P: std::sync::OnceLock<Mutex<std::collections::HashMap<String, Probe>>> = std::sync::OnceLock::new();
    P.get_or_init(Default::default)
}

/// Takes the folder's one lookup slot; false while a lookup runs or the folder is marked dead.
fn claim(key: &str) -> bool {
    let mut m = probes().lock().unwrap_or_else(|e| e.into_inner());
    let p = m.entry(key.to_string()).or_default();
    if p.busy || p.dead_at.is_some_and(|t| t.elapsed() < DEAD_FOR) {
        return false;
    }
    p.busy = true;
    true
}

fn settle(key: &str, dead: bool) {
    let mut m = probes().lock().unwrap_or_else(|e| e.into_inner());
    let p = m.entry(key.to_string()).or_default();
    if dead {
        p.dead_at = Some(std::time::Instant::now());
    } else {
        p.busy = false;
    }
}

/// A folder's spelling compared as text: separators one way, no trailing one, case folded on Windows.
fn text_key(p: &std::path::Path) -> String {
    let s = p.to_string_lossy().replace('/', "\\");
    let s = s.trim_end_matches('\\');
    if cfg!(windows) {
        s.to_lowercase()
    } else {
        s.to_string()
    }
}

/// A PATH folder on another computer is never looked up (doing so signs in to it with the user's
/// credentials); a folder spelled like the CLI's own counts without a lookup; the rest are asked
/// through `same` at once, each on its own thread, under one deadline `wait` for the whole list.
fn cli_status_in(dir: &std::path::Path, path: &std::ffi::OsStr, wait: std::time::Duration, same: fn(&std::path::Path, &std::path::Path) -> bool) -> CliStatus {
    let names: &[&str] = if cfg!(windows) { &["kolux.exe", "kolux.cmd"] } else { &["kolux"] };
    let installed = names.iter().any(|n| dir.join(n).is_file());
    if !installed {
        return CliStatus { installed, on_path: false };
    }
    let own = text_key(dir);
    let local: Vec<std::path::PathBuf> = std::env::split_paths(path).filter(|p| !p.as_os_str().is_empty() && !crate::links::host_path(&p.to_string_lossy(), &[])).collect();
    if local.iter().any(|p| text_key(p) == own) {
        return CliStatus { installed, on_path: true };
    }
    let deadline = std::time::Instant::now() + wait;
    let (tx, rx) = std::sync::mpsc::channel();
    let mut asked: Vec<String> = vec![];
    for p in local {
        let key = text_key(&p);
        if asked.contains(&key) || !claim(&key) {
            continue;
        }
        asked.push(key.clone());
        let (tx, d) = (tx.clone(), dir.to_path_buf());
        std::thread::spawn(move || {
            let r = same(&p, &d);
            settle(&key, false);
            let _ = tx.send((key, r));
        });
    }
    drop(tx);
    let mut on_path = false;
    while !asked.is_empty() {
        match rx.recv_timeout(deadline.saturating_duration_since(std::time::Instant::now())) {
            Ok((key, r)) => {
                asked.retain(|k| *k != key);
                if r {
                    on_path = true;
                    break;
                }
            }
            Err(_) => break,
        }
    }
    if !on_path {
        for key in asked {
            settle(&key, true);
        }
    }
    CliStatus { installed, on_path }
}

/// Async and off the async workers, so the check never holds the window's thread or a worker.
#[tauri::command]
pub async fn cli_status() -> Result<CliStatus, String> {
    tauri::async_runtime::spawn_blocking(|| {
        let exe = std::env::current_exe().map_err(|e| e.to_string())?;
        let dir = exe.parent().ok_or("the app has no folder")?;
        Ok(cli_status_in(dir, &std::env::var_os("PATH").unwrap_or_default(), PATH_ENTRY_WAIT, same_dir))
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub fn onboarding_reopen(store: State<'_, Mutex<Store>>) -> Result<(), String> {
    let store = store.lock().map_err(|e| e.to_string())?;
    save(&store, &reopened(load(&store)))
}

#[tauri::command]
pub fn onboarding_milestone(store: State<'_, Mutex<Store>>, name: String) -> Result<(), String> {
    let store = store.lock().map_err(|e| e.to_string())?;
    mark(&store, &name, now_ms())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn this_source_file_holds_no_shell_expansion_of_an_account_id() {
        // FIX-1 (council d2 FB1): a backtick in a shell heredoc once ran a command and wrote its
        // account-id output into a comment here. The needles are built at run time so this test
        // does not find itself.
        let src = include_str!("onboarding.rs");
        for needle in [["uid", "="].concat(), ["gid", "="].concat(), ["groups", "=1"].concat()] {
            assert!(!src.contains(&needle), "onboarding.rs holds {needle:?}: shell expansion damage");
        }
        assert!(src.contains(&["a use of `", "id`:"].concat()), "the ONB-042 comment keeps its original wording");
    }

    #[test]
    fn guide_lists_keep_each_id_once_and_drop_unknown_tips() {
        let (s, dir) = store("guide");
        s.set(GUIDE, r#"{"tipsSeen":["old-tip","cli","cli"],"visited":["agents"]}"#).unwrap();
        let g = guide_load(&s);
        assert_eq!(g.tips_seen, ["cli"], "an unknown tip from older data is dropped on load, a repeat counts once");
        assert_eq!(g.visited, ["agents"]);
        let g = marked(g, "tipsSeen", "palette").unwrap();
        let g = marked(g, "tipsSeen", "palette").unwrap();
        assert_eq!(g.tips_seen, ["cli", "palette"]);
        assert!(marked(g.clone(), "tipsSeen", "nope").is_err());
        assert!(marked(g.clone(), "other", "x").is_err());
        assert!(marked(g.clone(), "tried", "../x").is_err());
        assert_eq!(marked(g, "tried", "usage").unwrap().tried, ["usage"]);
        drop(s);
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn automatic_tours_are_decided_once_and_old_tour_entries_drop() {
        let (g, fresh) = tours_decided(Guide::default(), false);
        assert!(fresh && g.tours_auto == Some(false), "an existing profile (no wizard showing) never gets automatic tours");
        let (g, fresh) = tours_decided(g, true);
        assert!(!fresh && g.tours_auto == Some(false), "the decision is not taken again later");
        assert_eq!(tours_decided(Guide::default(), true).0.tours_auto, Some(true), "a new profile qualifies");
        let (s, dir) = store("tours");
        s.set(GUIDE, r#"{"toursSeen":["retired-tour","tasks","tasks"]}"#).unwrap();
        assert_eq!(guide_load(&s).tours_seen, ["tasks"]);
        let g = marked(guide_load(&s), "toursSeen", "parallel").unwrap();
        assert_eq!(g.tours_seen, ["tasks", "parallel"]);
        assert!(marked(g, "toursSeen", "nope").is_err());
        drop(s);
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn the_cli_counts_on_path_only_when_its_own_folder_is_there() {
        let dir = std::env::temp_dir().join(format!("kolux-rs-onb-cli-{}", std::process::id()));
        let other = dir.join("other");
        std::fs::create_dir_all(&other).unwrap();
        let launcher = if cfg!(windows) { "kolux.exe" } else { "kolux" };
        let path = |ps: &[&std::path::Path]| std::env::join_paths(ps).unwrap();
        let check = |d: &std::path::Path, p: &std::ffi::OsStr| cli_status_in(d, p, PATH_ENTRY_WAIT, same_dir);
        assert_eq!(check(&dir, &path(&[&dir])), CliStatus { installed: false, on_path: false });
        std::fs::write(other.join(launcher), "").unwrap();
        assert_eq!(check(&dir, &path(&[&other])), CliStatus { installed: false, on_path: false }, "another kolux on PATH is not this build's");
        std::fs::write(dir.join(launcher), "").unwrap();
        assert_eq!(check(&dir, &path(&[&other])), CliStatus { installed: true, on_path: false }, "installed but missing from PATH");
        let spelled = std::path::PathBuf::from(format!("{}{}", dir.display(), std::path::MAIN_SEPARATOR));
        assert_eq!(check(&dir, &path(&[&other, &spelled])), CliStatus { installed: true, on_path: true });
        std::fs::remove_dir_all(dir).unwrap();
    }

    /// Council: a PATH folder on a drive that does not answer is passed over after the wait, so
    /// the check still finishes and still finds the CLI's own folder after it.
    #[test]
    fn a_path_folder_that_does_not_answer_is_passed_over() {
        let dir = std::env::temp_dir().join(format!("kolux-rs-onb-dead-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join(if cfg!(windows) { "kolux.exe" } else { "kolux" }), "").unwrap();
        // Stands in for a lookup on an offline drive: the "dead" folder never answers in time.
        fn slow(p: &std::path::Path, d: &std::path::Path) -> bool {
            if p.ends_with("dead") {
                std::thread::sleep(std::time::Duration::from_secs(5));
            }
            same_dir(p, d)
        }
        let dead = std::path::PathBuf::from("Z:/offline/dead");
        let wait = std::time::Duration::from_millis(200);
        let start = std::time::Instant::now();
        let path = std::env::join_paths([dead.as_path(), dir.as_path()]).unwrap();
        assert_eq!(cli_status_in(&dir, &path, wait, slow), CliStatus { installed: true, on_path: true });
        let path = std::env::join_paths([dead.as_path()]).unwrap();
        assert_eq!(cli_status_in(&dir, &path, wait, slow), CliStatus { installed: true, on_path: false });
        assert!(start.elapsed() < std::time::Duration::from_secs(3), "the dead folder held the check for {:?}", start.elapsed());
        std::fs::remove_dir_all(dir).unwrap();
    }

    /// Lookups `spy` was asked for a folder on another computer, and for one of the w2 dead folders.
    static HOST_ASKED: std::sync::atomic::AtomicUsize = std::sync::atomic::AtomicUsize::new(0);
    static DEAD_ASKED: std::sync::atomic::AtomicUsize = std::sync::atomic::AtomicUsize::new(0);

    fn spy(p: &std::path::Path, d: &std::path::Path) -> bool {
        // judged by the test host's name, not by host_path, so a form host_path misses still counts
        if p.to_string_lossy().contains("x.invalid") {
            HOST_ASKED.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
        }
        if p.to_string_lossy().contains("w2-dead") {
            DEAD_ASKED.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
            std::thread::sleep(std::time::Duration::from_secs(5));
        }
        same_dir(p, d)
    }

    /// Council FB 2: a PATH folder on a share is never looked up (that signs in to the share).
    #[test]
    fn a_path_folder_on_another_computer_is_never_looked_up() {
        let dir = std::env::temp_dir().join(format!("kolux-rs-onb-unc-{}", std::process::id()));
        let other = dir.join("other");
        std::fs::create_dir_all(&other).unwrap();
        std::fs::write(dir.join(if cfg!(windows) { "kolux.exe" } else { "kolux" }), "").unwrap();
        let shares = [r"\\x.invalid\bin", r"\\?\UNC\x.invalid\bin", "//x.invalid/bin", r"\??\UNC\x.invalid\bin", r"\??\unc\x.invalid\s"].map(std::path::PathBuf::from);
        let mut entries: Vec<&std::path::Path> = shares.iter().map(|p| p.as_path()).collect();
        entries.push(&other);
        let path = std::env::join_paths(entries).unwrap();
        assert_eq!(cli_status_in(&dir, &path, PATH_ENTRY_WAIT, spy), CliStatus { installed: true, on_path: false });
        assert_eq!(HOST_ASKED.load(std::sync::atomic::Ordering::SeqCst), 0, "a share on PATH was looked up");
        std::fs::remove_dir_all(dir).unwrap();
    }

    /// Council FS 1: dead folders share one deadline, and one still looking is not asked again.
    #[test]
    fn dead_path_folders_share_one_deadline_and_are_not_asked_twice() {
        let dir = std::env::temp_dir().join(format!("kolux-rs-onb-dead3-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join(if cfg!(windows) { "kolux.exe" } else { "kolux" }), "").unwrap();
        let dead = ["Z:/offline/w2-dead-1", "Z:/offline/w2-dead-2", "Z:/offline/w2-dead-3"].map(std::path::PathBuf::from);
        let path = std::env::join_paths(dead.iter()).unwrap();
        let wait = std::time::Duration::from_millis(300);
        let start = std::time::Instant::now();
        assert_eq!(cli_status_in(&dir, &path, wait, spy), CliStatus { installed: true, on_path: false });
        assert!(start.elapsed() < wait * 2, "three dead folders took {:?}", start.elapsed());
        let asked = DEAD_ASKED.load(std::sync::atomic::Ordering::SeqCst);
        assert_eq!(asked, 3);
        // Opening the guide again: the dead folders are skipped, no new lookup thread starts.
        let again = std::time::Instant::now();
        assert_eq!(cli_status_in(&dir, &path, wait, spy), CliStatus { installed: true, on_path: false });
        assert!(again.elapsed() < wait, "the second check waited {:?}", again.elapsed());
        assert_eq!(DEAD_ASKED.load(std::sync::atomic::Ordering::SeqCst), asked);
        std::fs::remove_dir_all(dir).unwrap();
    }

    fn store(tag: &str) -> (Store, std::path::PathBuf) {
        let dir = std::env::temp_dir().join(format!("kolux-rs-onb-{tag}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        (Store::open(&dir).unwrap(), dir)
    }

    #[test]
    fn only_the_first_start_opens_the_wizard() {
        let (s, dir) = store("first");
        first_start(&s, 2).unwrap();
        assert_eq!(load(&s), None, "an older profile has no record and never sees the wizard");
        first_start(&s, 1).unwrap();
        assert_eq!(load(&s), Some(Onboarding { version: VERSION, step: -1, closed_at: None, outcome: None, rest: Default::default() }));
        save(&s, &stepped(load(&s).unwrap(), 1)).unwrap();
        first_start(&s, 1).unwrap();
        assert_eq!(load(&s).unwrap().step, 1, "an existing record is kept");
        s.set(KEY, "{ not json").unwrap();
        assert_eq!(load(&s), None);
        drop(s);
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn steps_stay_in_the_four_screens_and_a_close_is_final() {
        let open = Onboarding { version: VERSION, step: -1, closed_at: None, outcome: None, rest: Default::default() };
        assert_eq!(stepped(open.clone(), 9).step, 3);
        assert_eq!(stepped(open.clone(), 1).step, 1);
        let done = closed(stepped(open.clone(), 1), "completed", 50).unwrap();
        assert_eq!((done.step, done.closed_at, done.outcome.as_deref()), (3, Some(50), Some("completed")));
        assert_eq!(stepped(done.clone(), 0), done);
        assert_eq!(closed(done.clone(), "dismissed", 60).unwrap(), done);
        let skipped = closed(stepped(open.clone(), 1), "dismissed", 70).unwrap();
        assert_eq!((skipped.step, skipped.outcome.as_deref()), (1, Some("dismissed")));
        assert_eq!(skipped.rest.get("checklistDismissed"), Some(&serde_json::Value::Bool(true)), "Skip dismisses the sidebar checklist");
        assert_eq!(done.rest.get("checklistDismissed"), None, "a completed close keeps the checklist");
        assert_eq!(first_run(Some(skipped.clone())).map(|v| v.checklist_dismissed), Some(true));
        assert!(closed(open, "maybe", 1).unwrap_err().contains("maybe"));
    }

    #[test]
    fn an_older_record_is_brought_up_to_date_on_start() {
        let (s, dir) = store("upgrade");
        s.set(KEY, r#"{"version":5,"step":9,"outcome":"dismissed","checklist":[true]}"#).unwrap();
        first_start(&s, 4).unwrap();
        let rec = load(&s).unwrap();
        assert_eq!((rec.version, rec.step, rec.outcome.as_deref()), (VERSION, 3, Some("dismissed")));
        assert!(rec.closed_at.is_some(), "an outcome with no close time gets one");
        let raw = s.get(KEY).unwrap().unwrap();
        assert!(raw.contains(r#""version":7"#) && raw.contains(r#""checklist":[true]"#), "the raised version is stored, the rest kept: {raw}");
        s.set(KEY, r#"{"version":6}"#).unwrap();
        assert_eq!(load(&s), Some(Onboarding { version: VERSION, step: -1, closed_at: None, outcome: None, rest: Default::default() }), "missing fields read as nothing finished");
        drop(s);
        std::fs::remove_dir_all(dir).unwrap();
    }
    #[test]
    fn reopening_starts_over_and_keeps_the_rest() {
        let done = Onboarding { version: VERSION, step: 3, closed_at: Some(9), outcome: Some("completed".into()), rest: serde_json::from_str(r#"{"checklist":[true],"checklistDismissed":true,"milestones":{"aiConnected":5}}"#).unwrap() };
        let back = reopened(Some(done));
        assert_eq!((back.step, back.closed_at, back.outcome), (-1, None, None));
        assert_eq!(serde_json::Value::Object(back.rest), serde_json::json!({"checklist":[true],"milestones":{"aiConnected":5}}), "only the dismissed mark goes");
        assert_eq!(reopened(None), Onboarding { version: VERSION, step: -1, closed_at: None, outcome: None, rest: Default::default() }, "a profile with no record gets a fresh one");
    }

    #[test]
    fn the_checklist_view_comes_from_the_first_run_record() {
        assert_eq!(first_run(None), None, "a profile from before the wizard gets no checklist");
        let open = Onboarding { version: VERSION, step: 1, closed_at: None, outcome: None, rest: Default::default() };
        assert_eq!(first_run(Some(open)), Some(FirstRun { closed: false, outcome: None, checklist_dismissed: false, milestones: Default::default() }));
        let rest = serde_json::from_str(r#"{"checklistDismissed":true,"milestones":{"aiConnected":5,"kitLaunched":"soon","lunch":7}}"#).unwrap();
        let done = Onboarding { version: VERSION, step: 3, closed_at: Some(9), outcome: Some("dismissed".into()), rest };
        let v = first_run(Some(done)).unwrap();
        assert!(v.closed && v.checklist_dismissed && v.outcome.as_deref() == Some("dismissed"));
        assert_eq!(serde_json::Value::Object(v.milestones), serde_json::json!({"aiConnected":5}), "unknown names and non-times are dropped");
        let bad = Onboarding { version: VERSION, step: 3, closed_at: Some(9), outcome: None, rest: serde_json::from_str(r#"{"milestones":[1],"checklistDismissed":"yes"}"#).unwrap() };
        let v = first_run(Some(bad)).unwrap();
        assert!(!v.checklist_dismissed && v.milestones.is_empty(), "a damaged record reads as nothing done, not dismissed");
        let wire = serde_json::to_value(GuideView { guide: Guide::default(), first_run: None }).unwrap();
        assert!(wire.get("tried").is_some() && wire.get("firstRun").is_some(), "the view keeps the record's own fields beside firstRun: {wire}");
    }

    #[test]
    fn feature_uses_keep_the_first_time_and_only_count_up() {
        let g = used(Guide::default(), "split", 10).unwrap();
        let g = used(g, "split", 20).unwrap();
        assert_eq!(g.features["split"], Use { first: 10, count: 2 }, "the first time stays, the count goes up");
        assert!(used(g.clone(), "lunch", 30).unwrap_err().contains("lunch"));
        assert_eq!(marked(g, "used", "board").unwrap().features["board"].count, 1, "guide_mark's used list records a use");
        assert!(FEATURES.len() >= 35 && FEATURES.len() <= 45, "roughly forty features");
    }

    #[test]
    fn unknown_or_damaged_feature_entries_are_dropped_on_load() {
        let (s, dir) = store("features");
        s.set(GUIDE, r#"{"tried":["usage"],"features":{"split":{"first":5,"count":3},"teleport":{"first":1,"count":1},"board":{"first":"x"},"palette":7,"tasks":{"first":2,"count":0}}}"#).unwrap();
        let g = guide_load(&s);
        assert_eq!(g.tried, ["usage"], "the rest of the record survives a damaged entry");
        assert_eq!(g.features.keys().collect::<Vec<_>>(), ["split"], "unknown, damaged and zero-count entries go");
        s.set(GUIDE, r#"{"features":[1,2]}"#).unwrap();
        assert!(guide_load(&s).features.is_empty());
        drop(s);
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn a_milestone_is_written_once() {
        let dir = crate::test_dir::temp("onb-mile");
        let s = Store::open(&dir).unwrap();
        assert_eq!(mark(&s, "aiConnected", 10), Ok(()), "no record: nothing is written");
        assert_eq!(load(&s), None);
        first_start(&s, 1).unwrap();
        mark(&s, "aiConnected", 10).unwrap();
        mark(&s, "aiConnected", 20).unwrap();
        mark(&s, "kitLaunched", 30).unwrap();
        save(&s, &closed(load(&s).unwrap(), "completed", 40).unwrap()).unwrap();
        mark(&s, "resultsOpened", 50).unwrap();
        let rec = load(&s).unwrap();
        assert_eq!(rec.rest["milestones"], serde_json::json!({"aiConnected":10,"kitLaunched":30,"resultsOpened":50}), "the first time stays, a closed wizard still records");
        assert!(mark(&s, "lunch", 60).unwrap_err().contains("lunch"));
    }
}
