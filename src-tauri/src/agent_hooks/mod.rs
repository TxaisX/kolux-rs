//! STAT-004 / STAT-005 (T-152): which agents get Kolux's status hooks, and how Kolux puts them in
//! and takes them out without touching anything of the user's. Hooks go only to agents found on
//! this computer (one search of the program folders, plus a program the user set on the Agents
//! page) and switched on; a switched-off agent has Kolux's entries taken out; an agent that is
//! simply not found is left as it is, since another Kolux profile may rely on its hooks. Every
//! install holds a lock shared by all Kolux processes, and Claude Code's settings are copied to
//! `settings.json.bak-kolux` before Kolux first writes to them.
//!
//! A child of `hooks` so it shares that module's script and settings helpers.

use super::{claude_settings_file, home_dir, install_claude, is_my_command, status_command, write_atomic, write_claude_script, write_codex_script, write_json, write_status_script, SCRIPT_DIR, STATUS_PREV};
use serde_json::{json, Map, Value};
use std::fs;
use std::io::Write as _;
use std::path::{Path, PathBuf};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

/// The Settings key listing the agents switched off on the Agents page (SET-010).
pub const DISABLED_KEY: &str = "disabledAgents";
/// The copy of an agent's settings kept from before Kolux first wrote to them.
pub const BACKUP_SUFFIX: &str = ".bak-kolux";
const LOCK_FILE: &str = "install.lock";
/// A lock older than this was left by an install that crashed (the slowest step, Codex's
/// listing, gives up after 15 seconds).
const LOCK_STALE: Duration = Duration::from_secs(30);
const LOCK_WAIT: Duration = Duration::from_secs(35);

/// The agents whose hooks Kolux manages, by catalogue id.
pub const MANAGED: [&str; 2] = ["claude", "codex"];

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Plan {
    Install,
    Remove,
    /// Not found: its settings stay as they are; only Kolux's own scripts are refreshed.
    Leave,
}

/// What to do for each managed agent. `searched` is false when no program folder could be read,
/// and then nothing is installed.
pub fn plan(settings: &Value, installed: &[String], searched: bool) -> Vec<(&'static str, Plan)> {
    let off: Vec<&str> = settings.get(DISABLED_KEY).and_then(Value::as_array).map(|a| a.iter().filter_map(Value::as_str).collect()).unwrap_or_default();
    // STAT-002: with the status hooks switched off, every agent has Kolux's entries taken out.
    let all_off = !switch::on(settings);
    MANAGED
        .iter()
        .map(|&id| {
            let found = installed.iter().any(|i| i == id) || explicit(settings, id);
            (id, if all_off || off.contains(&id) { Plan::Remove } else if searched && found { Plan::Install } else { Plan::Leave })
        })
        .collect()
}

/// The program the user set for `id` on the Agents page exists and can run.
fn explicit(settings: &Value, id: &str) -> bool {
    settings
        .get(crate::agents::OPTIONS_FIELD)
        .and_then(|o| o.get(id))
        .and_then(|m| m.get("command"))
        .and_then(Value::as_str)
        .map(|c| c.trim().trim_matches('"'))
        .filter(|c| !c.is_empty())
        .is_some_and(|c| crate::agents::find_program(c).is_some())
}

/// One hook entry is Kolux's: its command, its argument list, or the command given as a list of
/// words runs a script from Kolux's folder (the older direct-command and argument-list forms).
pub fn names_mine(hook: &Value) -> bool {
    let any = |v: Option<&Value>| v.and_then(Value::as_array).is_some_and(|a| a.iter().filter_map(Value::as_str).any(is_my_command));
    hook.get("command").and_then(Value::as_str).is_some_and(is_my_command) || any(hook.get("command")) || any(hook.get("args"))
}

/// Takes Kolux's entries out of one event's groups: a user hook sharing a group with Kolux's
/// stays, and a group left empty by the removal goes. True when something was taken out.
pub fn strip(groups: &mut Vec<Value>) -> bool {
    let mut changed = false;
    groups.retain_mut(|g| {
        if names_mine(g) {
            changed = true;
            return false;
        }
        let Some(hooks) = g.get_mut("hooks").and_then(Value::as_array_mut) else { return true };
        let n = hooks.len();
        hooks.retain(|h| !names_mine(h));
        if hooks.len() == n {
            return true;
        }
        changed = true;
        !hooks.is_empty()
    });
    changed
}

/// Clears Kolux's entries from every event not in `keep`; an event left empty by that goes.
pub fn clear_unused(hooks: &mut Map<String, Value>, keep: &[&str]) -> bool {
    let mut changed = false;
    hooks.retain(|event, groups| {
        if keep.contains(&event.as_str()) {
            return true;
        }
        let Some(list) = groups.as_array_mut() else { return true };
        if !strip(list) {
            return true;
        }
        changed = true;
        !list.is_empty()
    });
    changed
}

/// Takes every Kolux entry out of a `{"hooks": {...}}` file; a `hooks` object only Kolux filled
/// goes too, so the file reads as it did before the install.
pub fn remove_groups(root: &mut Value) -> bool {
    let Some(obj) = root.as_object_mut() else { return false };
    let Some(hooks) = obj.get_mut("hooks").and_then(Value::as_object_mut) else { return false };
    let changed = clear_unused(hooks, &[]);
    if changed && hooks.is_empty() {
        obj.remove("hooks");
    }
    changed
}

fn read_opt(file: &Path) -> Result<Option<String>, String> {
    match fs::read_to_string(file) {
        Ok(t) => Ok(Some(t)),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(format!("{}: {e}", file.display())),
    }
}

/// Takes Kolux's hooks and status line out of Claude Code's settings. The status line the user
/// had before Kolux comes back exactly as it was (T-152 (4): the whole slot kept in
/// `prev`'s `.json` sibling, `null` for none; an older install kept only the command, in `prev`);
/// with neither, the slot goes. When the result parses equal to the `.bak-kolux` copy, that copy's
/// bytes are written, so the file is byte for byte the one from before the install (T-152 (6)).
/// True when written.
pub fn remove_claude(file: &Path, prev: &Path) -> Result<bool, String> {
    let Some(text) = read_opt(file)? else { return Ok(false) };
    let mut s: Value = serde_json::from_str(&text).map_err(|e| format!("{} is not JSON ({e}); left alone", file.display()))?;
    let mut changed = remove_groups(&mut s);
    let slot = prev.with_extension("json");
    if s.get("statusLine").and_then(|l| l.get("command")).and_then(Value::as_str).is_some_and(is_my_command) {
        let exact = fs::read_to_string(&slot).ok().and_then(|t| serde_json::from_str::<Value>(&t).ok());
        match (exact, fs::read_to_string(prev).ok().map(|t| t.trim().to_string()).filter(|t| !t.is_empty())) {
            (Some(Value::Null), _) | (None, None) => {
                s.as_object_mut().map(|o| o.remove("statusLine"));
            }
            (Some(had), _) => s["statusLine"] = had,
            (None, Some(had)) => s["statusLine"]["command"] = json!(had),
        }
        changed = true;
    }
    if changed {
        let copy = fs::read(backup_of(file)).ok().filter(|b| serde_json::from_slice::<Value>(b).is_ok_and(|v| v == s));
        match copy {
            Some(bytes) => write_atomic(file, &bytes, Some(&text))?,
            None => write_json(file, &s, Some(&text))?,
        }
        let _ = fs::remove_file(prev);
        let _ = fs::remove_file(&slot);
    }
    Ok(changed)
}

/// Takes Kolux's hooks out of one Codex home's `hooks.json`. The trust entries in `config.toml`
/// stay: they name hooks that no longer exist and Codex ignores them.
pub fn remove_codex(home: &Path) -> Result<bool, String> {
    let file = home.join("hooks.json");
    let Some(text) = read_opt(&file)? else { return Ok(false) };
    let mut v: Value = serde_json::from_str(&text).map_err(|e| format!("{} is not JSON ({e}); left alone", file.display()))?;
    let changed = remove_groups(&mut v);
    if changed {
        write_json(&file, &v, Some(&text))?;
    }
    Ok(changed)
}

/// `<file>.bak-kolux`.
pub fn backup_of(file: &Path) -> PathBuf {
    let mut name = file.as_os_str().to_owned();
    name.push(BACKUP_SUFFIX);
    PathBuf::from(name)
}

/// Keeps a copy of `file` from before Kolux's first install; a copy already there is never
/// replaced, and a missing file has nothing to keep. A copy that cannot be made, or that does not
/// hash the same as the file, stops the install. T-152 (2): a new copy returns the sha256 of the
/// file and of the copy, for the caller to record.
pub fn back_up(file: &Path) -> Result<Option<(String, String)>, String> {
    let copy = backup_of(file);
    if copy.exists() || !file.exists() {
        return Ok(None);
    }
    let refuse = |e: String| format!("could not keep a copy of {} ({e}); hooks not installed", file.display());
    fs::copy(file, &copy).map_err(|e| refuse(e.to_string()))?;
    let (a, b) = (sha256(file).map_err(refuse)?, sha256(&copy).map_err(refuse)?);
    if a != b {
        let _ = fs::remove_file(&copy);
        return Err(refuse(format!("the copy hashes {b}, the file {a}")));
    }
    Ok(Some((a, b)))
}

fn sha256(file: &Path) -> Result<String, String> {
    use sha2::{Digest, Sha256};
    let bytes = fs::read(file).map_err(|e| format!("{}: {e}", file.display()))?;
    Ok(Sha256::digest(&bytes).iter().map(|b| format!("{b:02x}")).collect())
}

/// The install lock, shared by every Kolux process through a file in Kolux's hook folder. A lock
/// left by a crashed install is cleared once stale; letting go removes the file only while it is
/// still this holder's, so a late release never frees a lock another process now holds.
pub struct Lock {
    file: PathBuf,
    token: String,
}

impl Lock {
    pub fn take(dir: &Path) -> Result<Lock, String> {
        Self::take_within(dir, LOCK_STALE, LOCK_WAIT)
    }

    pub fn take_within(dir: &Path, stale: Duration, wait: Duration) -> Result<Lock, String> {
        fs::create_dir_all(dir).map_err(|e| e.to_string())?;
        let file = dir.join(LOCK_FILE);
        let nanos = SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_nanos()).unwrap_or_default();
        let token = format!("{} {nanos}", std::process::id());
        let until = Instant::now() + wait;
        loop {
            match fs::OpenOptions::new().write(true).create_new(true).open(&file) {
                Ok(mut f) => {
                    f.write_all(token.as_bytes()).map_err(|e| e.to_string())?;
                    return Ok(Lock { file, token });
                }
                Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => {
                    let age = fs::metadata(&file).and_then(|m| m.modified()).ok().and_then(|t| t.elapsed().ok());
                    if age.is_some_and(|a| a >= stale) {
                        // ponytail: two waiters may both clear the same stale file; create_new still lets only one in.
                        let _ = fs::remove_file(&file);
                        continue;
                    }
                    if Instant::now() >= until {
                        return Err(format!("another Kolux is installing hooks ({} is held)", file.display()));
                    }
                    std::thread::sleep(Duration::from_millis(100));
                }
                Err(e) => return Err(format!("{}: {e}", file.display())),
            }
        }
    }
}

impl Drop for Lock {
    fn drop(&mut self) {
        if fs::read_to_string(&self.file).ok().as_deref() == Some(self.token.as_str()) {
            let _ = fs::remove_file(&self.file);
        }
    }
}

/// The record of the copy kept before the first install: the sha256 of the file and of the copy.
pub const BACKUP_RECORD: &str = "claude-settings.sha256";

/// T-152 (1): the only Claude settings file Kolux writes is the one `CLAUDE_CONFIG_DIR` (or the
/// home folder) resolves to. A debug build (tests, `tauri dev`, evidence runs) writes it only
/// inside the temp folder, so a run that inherited the user's own variables can never reach his file.
pub fn claude_target() -> Result<PathBuf, String> {
    let file = claude_settings_file();
    if cfg!(debug_assertions) {
        scratch_only(&file, &std::env::temp_dir())?;
    }
    Ok(file)
}

/// `file`'s folder lies inside `scratch` (both resolved, so `..` and letter case cannot slip past).
pub fn scratch_only(file: &Path, scratch: &Path) -> Result<(), String> {
    let inside = match (file.parent().map(fs::canonicalize), fs::canonicalize(scratch)) {
        (Some(Ok(dir)), Ok(scratch)) => dir.starts_with(&scratch),
        _ => false,
    };
    if inside {
        Ok(())
    } else {
        Err(format!("a debug build writes agent settings only under {}; {} left alone", scratch.display(), file.display()))
    }
}

/// Claude Code's scripts, hooks and status line, after its settings were copied once.
fn install_claude_all(home: &Path) -> Result<(), String> {
    install_claude_at(home, &claude_target()?)
}

pub fn install_claude_at(home: &Path, file: &Path) -> Result<(), String> {
    let path = write_claude_script(home)?;
    let status = write_status_script(home)?;
    let dir = home.join(SCRIPT_DIR);
    let prev = dir.join(STATUS_PREV);
    let status = status_command(&status, &prev.to_string_lossy().replace('\\', "/"));
    // T-152 (3): a file that is not JSON is refused before anything is written, the copy included.
    let had: Option<Value> = read_opt(file)?.map(|t| serde_json::from_str(&t)).transpose().map_err(|e| format!("{} is not JSON ({e}); hooks not installed", file.display()))?;
    if let Some((original, copy)) = back_up(file)? {
        let record = format!("{original}  {}\n{copy}  {}\n", file.display(), backup_of(file).display());
        fs::write(dir.join(BACKUP_RECORD), &record).map_err(|e| format!("claude settings copy record: {e}"))?;
        eprintln!("kolux-rs: claude hooks: kept a copy before the first write: sha256 original {original}, backup {copy}");
    }
    // T-152 (4): the status line slot as the user had it (`null`: none), put back whole on removal.
    if let Some(s) = had {
        let slot = s.get("statusLine").cloned().unwrap_or(Value::Null);
        if !slot.get("command").and_then(Value::as_str).is_some_and(is_my_command) {
            fs::write(prev.with_extension("json"), slot.to_string()).map_err(|e| format!("claude status line: {e}"))?;
        }
    }
    // The status line the user had keeps running from this file (STAT-040).
    if let (_, Some(displaced)) = install_claude(file, &format!("\"{path}\" || exit 0"), &status)? {
        fs::write(&prev, format!("{displaced}\n")).map_err(|e| format!("claude status line: {e}"))?;
    }
    Ok(())
}

fn codex_home() -> Option<PathBuf> {
    crate::trust::codex_config_file().parent().map(Path::to_path_buf)
}

/// The private Codex homes of the accounts Kolux manages (ACCT-007), which get Kolux's hooks as a
/// pane starts in them.
fn managed_codex_homes(profile: &Path) -> Vec<PathBuf> {
    fs::read_dir(profile.join(crate::codex_accounts::FOLDER)).map(|d| d.flatten().map(|e| e.path()).filter(|p| p.is_dir()).collect()).unwrap_or_default()
}

fn apply(home: &Path, profile: &Path, id: &str, plan: Plan) -> Result<&'static str, String> {
    let prev = home.join(SCRIPT_DIR).join(STATUS_PREV);
    match (id, plan) {
        ("claude", Plan::Install) => install_claude_all(home).map(|_| "installed"),
        ("claude", Plan::Remove) => remove_claude(&claude_target()?, &prev).map(|_| "removed"),
        // T-152 (6): the user's own Codex home is not written while T-025-e is off the cutline;
        // its script is still refreshed for the managed homes a pane starts in.
        ("codex", Plan::Install) => Ok("not written (Codex hooks wait for T-025-e)"),
        ("codex", Plan::Remove) => {
            for h in codex_home().into_iter().chain(managed_codex_homes(profile)) {
                remove_codex(&h)?;
            }
            Ok("removed")
        }
        _ => Ok("left as it was"),
    }
}

/// At start, and whenever an agent is switched on or off: Kolux's scripts are refreshed, then
/// each managed agent is installed, cleared or left by `plan`. Never stops the launch; each
/// agent's outcome is returned and problems also go to stderr. `profile` is Kolux's data folder.
/// T-152-gate (STAT-002): while the status hooks switch is off it does nothing and writes nothing.
pub fn sync(settings: &Value, profile: &Path) -> Vec<(&'static str, Result<&'static str, String>)> {
    if !switch::on(settings) {
        eprintln!("kolux-rs: agent hooks: switched off, nothing installed or changed");
        return Vec::new();
    }
    let home = home_dir();
    let _lock = match Lock::take(&home.join(SCRIPT_DIR)) {
        Ok(l) => l,
        Err(e) => {
            eprintln!("kolux-rs: agent hooks: {e}");
            return Vec::new();
        }
    };
    for refresh in [write_claude_script, write_status_script, write_codex_script] {
        if let Err(e) = refresh(&home) {
            eprintln!("kolux-rs: agent hook script: {e}");
        }
    }
    let searched = !crate::agents::search_dirs().is_empty();
    if !searched {
        eprintln!("kolux-rs: agent hooks: no program folder could be searched, so no hooks were installed");
    }
    let installed: Vec<String> = if searched { crate::agents::catalogue().into_iter().filter(|a| a.installed).map(|a| a.id).collect() } else { Vec::new() };
    plan(settings, &installed, searched)
        .into_iter()
        .map(|(id, p)| {
            let out = apply(&home, profile, id, p);
            match &out {
                Ok(what) => eprintln!("kolux-rs: {id} hooks: {what}"),
                Err(e) => eprintln!("kolux-rs: {id} hooks: {e}"),
            }
            (id, out)
        })
        .collect()
}

/// STAT-002: the user switched the status hooks off: Kolux's own entries come out of every agent
/// (the user's own hooks stay), and nothing else is written, not even Kolux's scripts.
pub fn clear(profile: &Path) -> Vec<(&'static str, Result<&'static str, String>)> {
    let home = home_dir();
    let _lock = match Lock::take(&home.join(SCRIPT_DIR)) {
        Ok(l) => l,
        Err(e) => {
            eprintln!("kolux-rs: agent hooks: {e}");
            return Vec::new();
        }
    };
    MANAGED.iter().map(|&id| (id, apply(&home, profile, id, Plan::Remove))).collect()
}

/// STAT-004: the Agents page switched an agent on or off; the hooks follow in the background.
/// `clear` is the status hooks switch just turned off (STAT-002), which takes Kolux's entries out.
#[tauri::command]
pub fn agent_hooks_sync(store: tauri::State<'_, std::sync::Mutex<crate::state::Store>>, clear: Option<bool>) -> Result<(), String> {
    let (settings, profile) = store.lock().map(|s| (s.settings(), s.dir())).map_err(|e| e.to_string())?;
    let off = clear == Some(true) && !switch::on(&settings);
    std::thread::spawn(move || if off { self::clear(&profile) } else { sync(&settings, &profile) });
    Ok(())
}

/// T-152-gate: the Claude Code settings file the hooks go into, shown beside the switch.
#[tauri::command]
pub fn agent_hooks_file() -> String {
    crate::hooks::claude_settings_file().display().to_string()
}

pub mod saved;
pub mod switch;

#[cfg(test)]
mod tests;
