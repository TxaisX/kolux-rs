//! Terminal panes as the front end sees them: numbered sessions, output pushed as events, input
//! and resize taken as commands. Every open session is killed when the window goes away.

use crate::pty::{check_start_dir, inherited_noise, is_shell_program, program_command, shell_commands, start_dir, PtySession};
use base64::Engine as _;
use std::collections::{HashMap, HashSet};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, Manager};

pub const OUTPUT_EVENT: &str = "terminal-output";
pub const EXIT_EVENT: &str = "terminal-exit";

#[derive(Default, Clone)]
pub struct Terminals {
    inner: Arc<Mutex<Inner>>,
    /// CLI-023: where each terminal sits in the window (worktree pane, tab, title, in view), as the
    /// window last reported it, plus the command-line requests it could not open.
    layout: Arc<Mutex<Vec<serde_json::Value>>>,
}

#[derive(Default)]
struct Inner {
    next_id: u32,
    sessions: HashMap<u32, PtySession>,
    /// The folder each session was started in, so a workspace can close its shells before its
    /// folder is deleted.
    dirs: HashMap<u32, String>,
    /// When each program session started and last wrote, so a worker start can tell when its
    /// agent has come up (ORCH-016). Shells are not marked.
    marks: HashMap<u32, Mark>,
    /// CLI-007 / ORCH-001: each session secret pane key, put in its environment as
    /// `KOLUX_PANE_KEY` next to its handle, so a command run inside it can prove which pane it is.
    keys: HashMap<u32, String>,
    /// CLI-027: sessions whose process has ended, so a close can confirm the program is gone.
    ended: HashSet<u32>,
}

/// APP-020 on macOS and Linux: the login shell's environment (its search path above all), read once
/// at startup in the background so the window never waits for it. A terminal opened before it
/// arrives gets the app's own environment.
static LOGIN_ENV: std::sync::OnceLock<Vec<(String, String)>> = std::sync::OnceLock::new();
/// What the shell prints before its environment, so whatever a profile script prints is skipped.
const ENV_MARK: &str = "__KOLUX_LOGIN_ENV__";
/// Variables that describe the reading shell itself, not the user's setup.
const SHELL_OWN: [&str; 4] = ["PWD", "OLDPWD", "SHLVL", "_"];

/// Starts reading the login shell's environment (macOS and Linux only).
pub fn read_login_env() {
    if cfg!(unix) {
        std::thread::spawn(|| {
            let shell = std::env::var("SHELL").ok().filter(|s| !s.trim().is_empty()).unwrap_or_else(|| "/bin/sh".into());
            if let Some(env) = login_env(std::path::Path::new(&shell), Duration::from_secs(10)) {
                let _ = LOGIN_ENV.set(env);
            }
        });
    }
}

/// Runs `shell` as a login shell that prints its environment, giving up after `limit` (a profile
/// script that hangs never holds anything up).
pub fn login_env(shell: &std::path::Path, limit: Duration) -> Option<Vec<(String, String)>> {
    use std::io::Read as _;
    let mut child = std::process::Command::new(shell)
        .args(["-l", "-c", &format!("printf '%s\\n' {ENV_MARK}; env")])
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::null())
        .spawn()
        .ok()?;
    let mut stdout = child.stdout.take()?;
    let (tx, rx) = std::sync::mpsc::channel();
    std::thread::spawn(move || {
        let mut out = String::new();
        let _ = stdout.read_to_string(&mut out);
        let _ = tx.send(out);
    });
    let out = rx.recv_timeout(limit).ok();
    let _ = child.kill();
    let _ = child.wait();
    let env = parse_env(&out?);
    (!env.is_empty()).then_some(env)
}

/// The variables `env` printed after the mark. A line that does not start a new NAME=value goes
/// with the value before it (a value with line breaks in it).
pub fn parse_env(out: &str) -> Vec<(String, String)> {
    let Some(start) = out.find(&format!("{ENV_MARK}\n")) else { return vec![] };
    let mut env: Vec<(String, String)> = Vec::new();
    for line in out[start + ENV_MARK.len() + 1..].lines() {
        let named = line.split_once('=').filter(|(k, _)| !k.is_empty() && !k.starts_with(|c: char| c.is_ascii_digit()) && k.chars().all(|c| c.is_ascii_alphanumeric() || c == '_'));
        match (named, env.last_mut()) {
            (Some((k, v)), _) => env.push((k.to_string(), v.to_string())),
            (None, Some((_, v))) => {
                v.push('\n');
                v.push_str(line);
            }
            (None, None) => {}
        }
    }
    env.retain(|(k, _)| !SHELL_OWN.contains(&k.as_str()));
    env
}

/// APP-020: a new terminal's search path: the app's own, then every folder the stored Windows path
/// (`fresh`) gained since the app started, so a CLI installed while it runs is found by name; Node
/// version-manager folders (`managers` names the ones set in the environment) go ahead of the rest,
/// so the runtime the user chose wins over a system-wide one.
fn terminal_path(current: &str, fresh: Option<String>, managers: &[String]) -> String {
    let merged = crate::install::merge_path(current, &fresh.unwrap_or_default());
    let key = |d: &str| d.trim_end_matches(['\\', '/']).replace('/', "\\").to_lowercase();
    let managed = |d: &str| {
        let k = key(d);
        managers.iter().any(|m| key(m) == k) || [r"\fnm_multishells\", r"\volta\", r"\.volta\", r"\nvs\", r"\.nvm\", r"\nvm\"].iter().any(|p| format!("{k}\\").contains(p))
    };
    let (first, rest): (Vec<&str>, Vec<&str>) = merged.split(';').partition(|d| managed(d));
    first.into_iter().chain(rest).collect::<Vec<_>>().join(";")
}

/// The Node version-manager folders the environment names (nvm-windows, Volta).
fn node_managers() -> Vec<String> {
    let var = |v: &str| std::env::var(v).ok().filter(|s| !s.is_empty());
    [var("NVM_SYMLINK"), var("NVM_HOME"), var("VOLTA_HOME").map(|h| format!(r"{h}\bin"))].into_iter().flatten().collect()
}

/// `dir` at the front of a search path (CLI-007).
fn cli_first(dir: &std::path::Path, path: Option<std::ffi::OsString>) -> std::ffi::OsString {
    let rest: Vec<std::path::PathBuf> = path.map(|p| std::env::split_paths(&p).collect()).unwrap_or_default();
    std::env::join_paths(std::iter::once(dir.to_path_buf()).chain(rest)).unwrap_or_else(|_| dir.as_os_str().to_os_string())
}

/// The handle a terminal is known by on the command line (`KOLUX_TERMINAL_HANDLE`).
pub fn handle_of(id: u32) -> String {
    format!("term-{id}")
}

fn id_of(handle: &str) -> Option<u32> {
    handle.strip_prefix("term-")?.parse().ok()
}

#[derive(Clone)]
struct Mark {
    started: Instant,
    last_output: Option<Instant>,
    /// The program the session runs (ORCH-013 tells agents from other programs by it).
    program: String,
    /// The agent the program is credited as (`claude`, `codex`), none for another program.
    agent: Option<&'static str>,
}

/// One chunk of program output, base64 so split multi-byte characters survive the trip.
#[derive(serde::Serialize, Clone)]
struct OutputPayload {
    id: u32,
    data: String,
}

#[derive(serde::Serialize, Clone)]
struct ExitPayload {
    id: u32,
    code: Option<u32>,
}

impl Terminals {
    /// Starts a pane. With no `program` it runs the user's shell; with one (an agent such as
    /// `claude`) it runs that program directly with `args`, in `cwd`.
    #[allow(clippy::too_many_arguments)]
    pub fn spawn(&self, app: AppHandle, cols: u16, rows: u16, cwd: Option<String>, program: Option<String>, args: Vec<String>, own_env: Vec<(String, String)>, env: Vec<(String, String)>, pane_key: Option<u32>) -> Result<u32, String> {
        // ACCT-049: checked before the lock, so a drive that does not answer holds up only this pane.
        if let Some(dir) = cwd.as_deref() {
            check_start_dir(dir, program.as_deref().map(str::trim).is_some_and(|p| !p.is_empty() && !is_shell_program(p)))?;
        }
        let mut inner = self.inner.lock().map_err(|e| e.to_string())?;
        inner.next_id += 1;
        let id = inner.next_id;
        let out_app = app.clone();
        let exit_app = app;
        let registry = self.inner.clone();
        let out_registry = self.inner.clone();
        let is_program = program.as_deref().map(str::trim).is_some_and(|p| !p.is_empty());
        // ACCT-046: a program runs as asked; an automatic shell has a line of fallbacks.
        let mut commands = match program.as_deref().map(str::trim).filter(|p| !p.is_empty()) {
            Some(p) => vec![program_command(p, &args, cwd.as_deref())],
            None => shell_commands(cwd.as_deref()),
        };
        let key = crate::cli::secret();
        let (fresh, managers) = (crate::install::fresh_path(""), node_managers());
        let login = LOGIN_ENV.get();
        let current = login.and_then(|e| e.iter().find(|(k, _)| k == "PATH")).map(|(_, v)| v.clone()).unwrap_or_else(|| std::env::var("PATH").unwrap_or_default());
        for command in commands.iter_mut() {
            // APP-020 on macOS and Linux: what the login shell sets (read at startup), so tools set up
            // in a profile script are found the same as in a terminal outside Kolux.
            for (k, v) in login.into_iter().flatten() {
                command.env(k, v);
            }
            // ACCT-048: an ordinary terminal's environment: none of Kolux's own runtime or build
            // variables, no conda activation that came along only in part, no prompt-theme wizard.
            for (k, _) in std::env::vars_os() {
                if k.to_str().is_some_and(inherited_noise) {
                    command.env_remove(k);
                }
            }
            command.env("POWERLEVEL9K_DISABLE_CONFIGURATION_WIZARD", "true");
            // STAT-001: the pane's programs and their hooks know which pane to report for. Set first:
            // the hooks find their pane by KOLUX_HOOK_IDENTITY and only check that KOLUX_PANE_KEY is set,
            // so the command line's handle and pane key below (CLI-007, ORCH-013) take those two names.
            if let (Some(pane), Some(hooks)) = (pane_key, exit_app.try_state::<crate::hooks::Hooks>()) {
                for (k, v) in hooks.pane_env(pane, id) {
                    command.env(k, v);
                }
            }
            command.env("KOLUX_TERMINAL_HANDLE", handle_of(id));
            command.env("KOLUX_PANE_KEY", &key);
            // APP-020: the search path the app started with, plus the folders added to the stored path
            // since, so tools installed since the app started are found by name. (The terminal
            // library alone would keep only the stored path and drop the app's own folders.)
            command.env("PATH", terminal_path(&current, fresh.clone(), &managers));
            // CLI-007: the CLI that ships with this copy of Kolux comes first, ahead of any older one
            // registered system-wide, and it is told which app folder to call. An installed copy keeps
            // its CLI in the bin folder of the install (CLI-006); a development build runs kolux-dev
            // from its own folder. ponytail: the Linux `kolux` launcher folder lands with that build.
            if let Some(dir) = std::env::current_exe().ok().and_then(|e| e.parent().map(std::path::Path::to_path_buf)) {
                let bin = dir.join("bin");
                let dir = if bin.join(if cfg!(windows) { "kolux.exe" } else { "kolux" }).is_file() { bin } else { dir };
                let path = cli_first(&dir, command.get_env("PATH").map(std::ffi::OsStr::to_os_string));
                command.env("PATH", path);
            }
            if let Ok(dir) = tauri::Manager::path(&out_app).app_data_dir() {
                command.env(crate::cli::APP_DIR_ENV, dir);
            }
            // CLI-010: a Kolux started from another copy's terminal inherits that copy's data-folder
            // override, which would send this pane's commands to the other app.
            command.env_remove("KOLUX_USER_DATA_PATH");
            // SET-027: the user's variables for this agent; Kolux's account variable below wins.
            for (k, v) in &own_env {
                command.env(k, v);
            }
            for (k, v) in &env {
                // A pane on a managed Claude account must not be overridden by a 1-year key that
                // Kolux itself was started with (Claude Code prefers the variable).
                if k == crate::claude_accounts::CONFIG_ENV {
                    command.env_remove(crate::claude_key::ENV);
                }
                command.env(k, v);
            }
        }
        let session = PtySession::spawn_first(
            commands,
            cols.max(2),
            rows.max(1),
            move |chunk| {
                let data = base64::engine::general_purpose::STANDARD.encode(chunk);
                let _ = out_app.emit(OUTPUT_EVENT, OutputPayload { id, data });
                if is_program {
                    if let Ok(mut inner) = out_registry.lock() {
                        if let Some(m) = inner.marks.get_mut(&id) {
                            m.last_output = Some(Instant::now());
                        }
                    }
                }
            },
            move |code| {
                // Drop the session so the PTY closes and the reader thread can finish.
                if let Ok(mut inner) = registry.lock() {
                    inner.sessions.remove(&id);
                    inner.dirs.remove(&id);
                    inner.marks.remove(&id);
                    inner.keys.remove(&id);
                    inner.ended.insert(id);
                }
                let _ = exit_app.emit(EXIT_EVENT, ExitPayload { id, code });
            },
        )?;
        inner.sessions.insert(id, session);
        inner.keys.insert(id, key);
        if is_program {
            let agent = program.as_deref().and_then(crate::agents::credited_agent);
            inner.marks.insert(id, Mark { started: Instant::now(), last_output: None, program: program.unwrap_or_default().trim().to_string(), agent });
        }
        if let Some(dir) = cwd {
            inner.dirs.insert(id, dir);
        }
        Ok(id)
    }

    /// ACCT-046: the program session `id` actually started.
    pub fn started(&self, id: u32) -> Option<String> {
        self.inner.lock().ok()?.sessions.get(&id).map(|s| s.program().to_string())
    }

    pub fn write(&self, id: u32, data: &str) -> Result<(), String> {
        let mut inner = self.inner.lock().map_err(|e| e.to_string())?;
        inner.sessions.get_mut(&id).ok_or("no such terminal")?.write(data.as_bytes())
    }

    pub fn resize(&self, id: u32, cols: u16, rows: u16) -> Result<(), String> {
        let inner = self.inner.lock().map_err(|e| e.to_string())?;
        inner.sessions.get(&id).ok_or("no such terminal")?.resize(cols.max(2), rows.max(1))
    }

    /// TERM-045: whether closing session `id` would stop a live program: one started as the pane's
    /// program (an agent) is live while it runs; a shell is live while it has a program of its own
    /// running. A session that has ended, or a check that fails, reads as idle (fails open).
    pub fn busy(&self, id: u32) -> bool {
        let pid = match self.inner.lock() {
            Ok(inner) => match inner.sessions.get(&id) {
                Some(_) if inner.marks.contains_key(&id) => return true,
                Some(s) => s.pid(),
                None => return false,
            },
            Err(_) => return false,
        };
        pid.and_then(crate::procs::has_children).unwrap_or(false)
    }

    /// APP-054: every session with its process id and the folder it was started in.
    pub fn list(&self) -> Vec<(u32, Option<u32>, Option<String>)> {
        match self.inner.lock() {
            Ok(inner) => inner.sessions.iter().map(|(id, s)| (*id, s.pid(), inner.dirs.get(id).cloned())).collect(),
            Err(_) => Vec::new(),
        }
    }

    /// Ends one session. Its exit event follows from the waiter thread.
    pub fn kill(&self, id: u32) -> Result<(), String> {
        let mut inner = self.inner.lock().map_err(|e| e.to_string())?;
        inner.dirs.remove(&id);
        inner.marks.remove(&id);
        inner.keys.remove(&id);
        if let Some(mut s) = inner.sessions.remove(&id) {
            s.kill();
        }
        Ok(())
    }

    /// The program session started in `dir` itself since `since`, with when it last wrote, so a
    /// worker start can wait for its agent (ORCH-016).
    pub fn program_in(&self, dir: &std::path::Path, since: Instant) -> Option<(u32, Option<Instant>)> {
        let inner = self.inner.lock().ok()?;
        let same = |d: &str| std::path::Path::new(d).canonicalize().ok() == dir.canonicalize().ok();
        inner.marks.iter().filter(|(id, m)| m.started >= since && inner.dirs.get(id).is_some_and(|d| same(d))).map(|(id, m)| (*id, m.last_output)).next()
    }

    /// What session `id` runs: `None` when it is gone, `Some(None)` for a shell (the foreground
    /// cannot be told), `Some(Some(agent))` for a program Kolux started (USAGE-007).
    pub fn program(&self, id: u32) -> Option<Option<&'static str>> {
        let inner = self.inner.lock().ok()?;
        inner.sessions.contains_key(&id).then(|| inner.marks.get(&id).and_then(|m| m.agent))
    }

    /// How long the program in `id` has printed nothing (since it started, when it never has), for
    /// the quiet alert (STAT-045). `None` for a shell or a gone session.
    pub fn silence(&self, id: u32) -> Option<std::time::Duration> {
        let inner = self.inner.lock().ok()?;
        inner.marks.get(&id).map(|m| m.last_output.unwrap_or(m.started).elapsed())
    }

    /// Ends every session that was started in `dir` or a folder under it, and waits (briefly) for
    /// the programs to be gone, so the folder can be deleted. Returns how many were ended.
    pub fn kill_under(&self, dir: &std::path::Path) -> usize {
        let ids = self.under(dir);
        for id in &ids {
            let _ = self.kill(*id);
        }
        if !ids.is_empty() {
            std::thread::sleep(std::time::Duration::from_millis(300));
        }
        ids.len()
    }

    /// PROJ-072: the sessions started in `dir` or a folder inside it that are still running.
    pub fn under(&self, dir: &std::path::Path) -> Vec<u32> {
        let wanted = |d: &str| {
            let d = std::path::Path::new(d);
            let same = |a: &std::path::Path, b: &std::path::Path| a.canonicalize().ok() == b.canonicalize().ok();
            same(d, dir) || d.ancestors().skip(1).any(|a| same(a, dir))
        };
        match self.inner.lock() {
            Ok(inner) => inner.dirs.iter().filter(|(id, d)| !inner.ended.contains(id) && wanted(d)).map(|(id, _)| *id).collect(),
            Err(_) => Vec::new(),
        }
    }

    /// The open terminal whose secret is `key` (ORCH-001: a pane the runtime saw), by its handle.
    pub fn by_key(&self, key: &str) -> Option<String> {
        if key.is_empty() {
            return None;
        }
        let inner = self.inner.lock().ok()?;
        inner.keys.iter().find(|(_, k)| k.as_str() == key).map(|(id, _)| handle_of(*id))
    }

    /// ORCH-013: the program a terminal was started with, once it has written and then been quiet
    /// for `settle` (fully started; part of a banner is not enough). Shells have none: what is
    /// typed into a shell, or a pane title, proves nothing.
    // ponytail: quiet after first output stands in for an idle detector (the STAT status cards).
    pub fn program_of(&self, handle: &str, settle: std::time::Duration) -> Option<String> {
        let id = id_of(handle)?;
        let inner = self.inner.lock().ok()?;
        let m = inner.marks.get(&id).filter(|_| inner.sessions.contains_key(&id))?;
        m.last_output.filter(|t| t.elapsed() >= settle)?;
        Some(m.program.clone())
    }

    /// CLI-017: every open session as (handle, the folder it started in, its program; none for a shell).
    pub fn sessions(&self) -> Vec<(String, String, Option<String>)> {
        self.every().into_iter().filter_map(|(h, dir, program)| Some((h, dir?, program))).collect()
    }

    /// CLI-023: every open session, a shell started in the home folder (no folder) included.
    pub fn every(&self) -> Vec<(String, Option<String>, Option<String>)> {
        let Ok(inner) = self.inner.lock() else { return Vec::new() };
        let mut ids: Vec<u32> = inner.sessions.keys().copied().collect();
        ids.sort_unstable();
        ids.into_iter().map(|id| (handle_of(id), inner.dirs.get(&id).cloned(), inner.marks.get(&id).map(|m| m.program.clone()))).collect()
    }

    /// CLI-023: the window's latest report of its panes and tabs.
    pub fn layout(&self) -> Vec<serde_json::Value> {
        self.layout.lock().map(|l| l.clone()).unwrap_or_default()
    }

    pub fn set_layout(&self, rows: Vec<serde_json::Value>) {
        if let Ok(mut l) = self.layout.lock() {
            *l = rows;
        }
    }

    /// CLI-027: ends a session and waits up to three seconds for its process to be gone; true only
    /// once that is confirmed. A session that had already ended counts as stopped.
    pub fn close(&self, handle: &str) -> bool {
        let Some(id) = id_of(handle) else { return false };
        if !self.live(handle) {
            return true;
        }
        let _ = self.kill(id);
        let until = Instant::now() + Duration::from_secs(3);
        while Instant::now() < until {
            if self.inner.lock().map(|mut i| i.ended.remove(&id)).unwrap_or(false) {
                return true;
            }
            std::thread::sleep(Duration::from_millis(50));
        }
        false
    }

    /// The folder terminal `handle` was started in (ORCH-014 checks it for base drift).
    pub fn dir_of(&self, handle: &str) -> Option<String> {
        let id = id_of(handle)?;
        self.inner.lock().ok()?.dirs.get(&id).cloned()
    }

    /// Is `handle` an open terminal?
    pub fn live(&self, handle: &str) -> bool {
        let Some(id) = id_of(handle) else { return false };
        self.inner.lock().map(|i| i.sessions.contains_key(&id)).unwrap_or(false)
    }

    /// Ends every session: the window is closing, nothing may be left running.
    pub fn kill_all(&self) {
        if let Ok(mut inner) = self.inner.lock() {
            inner.dirs.clear();
            inner.keys.clear();
            for (_, mut s) in inner.sessions.drain() {
                s.kill();
            }
        }
    }
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub fn terminal_spawn(app: AppHandle, terminals: tauri::State<'_, Terminals>, store: tauri::State<'_, std::sync::Mutex<crate::state::Store>>, cols: u16, rows: u16, cwd: Option<String>, start: Option<String>, program: Option<String>, args: Option<Vec<String>>, env: Option<Vec<(String, String)>>, pane_key: Option<u32>) -> Result<Spawned, String> {
    // TERM-040: `cwd` is the workspace folder; `start` may ask for a folder relative to it.
    let cwd = cwd.map(|w| start_dir(&w, start.as_deref()));
    // ACCT-004: a Claude pane in key mode is handed the 1-year key; nothing else ever is.
    // ACCT-005: otherwise a Claude pane runs on the active managed account's own folder.
    let env_own = env.unwrap_or_default();
    let (env, cap): (Vec<(String, String)>, bool) = {
        let store = store.lock().map_err(|e| e.to_string())?;
        let settings = store.settings();
        let token = crate::secrets::read_setting(&store, crate::claude_key::TOKEN_FIELD).ok().flatten();
        let key_mode = settings.get(crate::claude_key::MODE_FIELD).and_then(serde_json::Value::as_str) == Some(crate::claude_key::KEY_MODE);
        let env: Vec<(String, String)> = crate::claude_key::pane_env(program.as_deref(), &settings, token)
            .or_else(|| crate::claude_accounts::pane_env(program.as_deref(), key_mode, crate::claude_accounts::active_dir(&store)))
            // ACCT-007: a Codex pane runs in the active Codex account's private home.
            .or_else(|| crate::codex_accounts::pane_env(program.as_deref(), crate::codex_accounts::active_home(&store)))
            // ACCT-008: a Grok pane gets the saved xAI key; Grok itself prefers its own sign-in.
            .or_else(|| crate::grok::pane_env(program.as_deref(), crate::secrets::read_setting(&store, crate::grok::KEY_FIELD).ok().flatten()))
            .map(|(k, v)| (k.to_string(), v))
            .into_iter()
            .collect();
        (env, crate::cap::on(&settings))
    };
    // USAGE-006: the 200k cap, added at start so the pane's saved start line stays free of it.
    let mut env = env;
    let mut args = args.unwrap_or_default();
    if cap {
        crate::cap::apply(program.as_deref(), &mut args, &mut env, crate::cap::env_set());
    }
    // STAT-008: a managed Codex home gets Kolux's hooks (and their trust) before Codex reads it.
    if let Some((_, home)) = env.iter().find(|(k, _)| k == crate::codex_accounts::HOME_ENV) {
        crate::hooks::install_codex_home(std::path::Path::new(home));
    }
    let id = terminals.spawn(app, cols, rows, cwd, program, args, env_own, env, pane_key)?;
    Ok(Spawned { id, program: terminals.started(id) })
}

/// A started pane: its id and the program that runs in it (ACCT-046 names a fallback shell).
#[derive(serde::Serialize)]
pub struct Spawned {
    id: u32,
    program: Option<String>,
}

/// TERM-045: for each id, whether closing it would stop a live program.
#[tauri::command]
pub fn terminal_busy(terminals: tauri::State<'_, Terminals>, ids: Vec<u32>) -> Vec<bool> {
    ids.into_iter().map(|id| terminals.busy(id)).collect()
}

#[tauri::command]
pub fn terminal_write(app: AppHandle, terminals: tauri::State<'_, Terminals>, id: u32, data: String) -> Result<(), String> {
    // STAT-028: Ctrl+C or Escape on its own, while the agent works, marks the coming Stop interrupted.
    if data == "\x03" || data == "\x1b" {
        crate::status::cancel(id);
    }
    // USAGE-007: the user's own typing after a limit stop cancels the resume.
    crate::resume::user_typed(&app, id);
    terminals.write(id, &data)
}

#[tauri::command]
pub fn terminal_resize(terminals: tauri::State<'_, Terminals>, id: u32, cols: u16, rows: u16) -> Result<(), String> {
    terminals.resize(id, cols, rows)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// APP-020 on macOS and Linux: what the login shell printed before the mark (a profile banner)
    /// is skipped, a value with a line break stays one value, and the reading shell's own variables
    /// are dropped.
    #[test]
    fn app020_the_login_shells_environment_is_read_after_the_mark_with_multi_line_values() {
        let out = "Welcome to the box!
A=1
__KOLUX_LOGIN_ENV__
PATH=/opt/homebrew/bin:/usr/bin
PWD=/home/me
FUNC=() {  echo hi
}
SHLVL=2
_=/usr/bin/env
HOME=/home/me
";
        let env = parse_env(out);
        let want: Vec<(String, String)> = [("PATH", "/opt/homebrew/bin:/usr/bin"), ("FUNC", "() {  echo hi\n}"), ("HOME", "/home/me")]
            .iter()
            .map(|(k, v)| (k.to_string(), v.to_string()))
            .collect();
        assert_eq!(env, want);
        // no mark (the shell failed before printing it): nothing is taken from the output
        assert!(parse_env("PATH=/bin\n").is_empty());
    }

    /// The reader runs a real login shell and never waits past its limit.
    #[cfg(unix)]
    #[test]
    fn app020_the_login_shell_is_read_within_its_limit() {
        let env = login_env(std::path::Path::new("/bin/sh"), Duration::from_secs(10)).expect("sh prints its environment");
        assert!(env.iter().any(|(k, _)| k == "PATH"));
    }

    /// APP-020: a new terminal gets the app's own search path plus every folder the stored Windows
    /// path gained since (a CLI installed while the app runs), Node version managers ahead of the rest.
    #[test]
    fn app020_new_terminals_take_folders_added_since_the_app_started_node_managers_first() {
        let current = r"C:\stub;C:\Windows;C:\Program Files\nodejs";
        let fresh = Some(r"C:\Windows;C:\Program Files\nodejs;C:\Users\me\AppData\Local\fnm_multishells\123;C:\new\tool".to_string());
        let p = terminal_path(current, fresh, &[]);
        assert_eq!(p, r"C:\Users\me\AppData\Local\fnm_multishells\123;C:\stub;C:\Windows;C:\Program Files\nodejs;C:\new\tool");
        // nvm-windows names its active folder in NVM_SYMLINK; a folder named that way comes first too
        let p = terminal_path(r"C:\Windows;C:\nvm4w\nodejs", None, &[r"c:\NVM4W\nodejs\".to_string()]);
        assert_eq!(p, r"C:\nvm4w\nodejs;C:\Windows");
        // the stored path cannot be read: the app's own path stands, nothing lost
        assert_eq!(terminal_path(r"C:\a;C:\b", None, &[]), r"C:\a;C:\b");
    }

    #[test]
    fn the_bundled_cli_folder_comes_first_on_the_search_path() {
        let dir = std::path::Path::new("D:\\app");
        let rest = std::env::join_paths(["C:\\old\\kolux", "C:\\Windows"]).unwrap();
        let path = cli_first(dir, Some(rest));
        let parts: Vec<_> = std::env::split_paths(&path).collect();
        assert_eq!(parts, ["D:\\app", "C:\\old\\kolux", "C:\\Windows"].map(std::path::PathBuf::from));
        assert_eq!(std::env::split_paths(&cli_first(dir, None)).count(), 1);
    }
}

/// CLI-023: the window reports which terminal sits in which pane and tab.
#[tauri::command]
pub fn terminal_layout(terminals: tauri::State<'_, Terminals>, rows: Vec<serde_json::Value>) {
    terminals.set_layout(rows);
}

#[tauri::command]
pub fn terminal_kill(terminals: tauri::State<'_, Terminals>, id: u32) -> Result<(), String> {
    terminals.kill(id)
}
