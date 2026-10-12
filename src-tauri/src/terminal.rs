//! Terminal panes as the front end sees them: numbered sessions, output pushed as events, input
//! and resize taken as commands. Every open session is killed when the window goes away.

use crate::pty::{program_command, shell_command, start_dir, PtySession};
use base64::Engine as _;
use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::Instant;
use tauri::{AppHandle, Emitter};

pub const OUTPUT_EVENT: &str = "terminal-output";
pub const EXIT_EVENT: &str = "terminal-exit";

#[derive(Default, Clone)]
pub struct Terminals {
    inner: Arc<Mutex<Inner>>,
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
    pub fn spawn(&self, app: AppHandle, cols: u16, rows: u16, cwd: Option<String>, program: Option<String>, args: Vec<String>, own_env: Vec<(String, String)>, env: Option<(&str, String)>) -> Result<u32, String> {
        let mut inner = self.inner.lock().map_err(|e| e.to_string())?;
        inner.next_id += 1;
        let id = inner.next_id;
        let out_app = app.clone();
        let exit_app = app;
        let registry = self.inner.clone();
        let out_registry = self.inner.clone();
        let is_program = program.as_deref().map(str::trim).is_some_and(|p| !p.is_empty());
        let mut command = match program.as_deref().map(str::trim).filter(|p| !p.is_empty()) {
            Some(p) => program_command(p, &args, cwd.as_deref()),
            None => shell_command(cwd.as_deref()),
        };
        let key = crate::cli::secret();
        command.env("KOLUX_TERMINAL_HANDLE", handle_of(id));
        command.env("KOLUX_PANE_KEY", &key);
        // CLI-007: the CLI that ships with this copy of Kolux comes first, ahead of any older one
        // registered system-wide, and it is told which app folder to call. ponytail: the folder
        // is the app's own; the release launcher (CLI-006, T-185) and the Linux `kolux` launcher
        // folder land with the packaged build.
        if let Some(dir) = std::env::current_exe().ok().and_then(|e| e.parent().map(std::path::Path::to_path_buf)) {
            let path = cli_first(&dir, command.get_env("PATH").map(std::ffi::OsStr::to_os_string));
            command.env("PATH", path);
        }
        if let Ok(dir) = tauri::Manager::path(&out_app).app_data_dir() {
            command.env(crate::cli::APP_DIR_ENV, dir);
        }
        // SET-027: the user's variables for this agent; Kolux's account variable below wins.
        for (k, v) in own_env {
            command.env(k, v);
        }
        if let Some((k, v)) = env {
            // A pane on a managed Claude account must not be overridden by a 1-year key that
            // Kolux itself was started with (Claude Code prefers the variable).
            if k == crate::claude_accounts::CONFIG_ENV {
                command.env_remove(crate::claude_key::ENV);
            }
            command.env(k, v);
        }
        let session = PtySession::spawn(
            command,
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
                }
                let _ = exit_app.emit(EXIT_EVENT, ExitPayload { id, code });
            },
        )?;
        inner.sessions.insert(id, session);
        inner.keys.insert(id, key);
        if is_program {
            inner.marks.insert(id, Mark { started: Instant::now(), last_output: None, program: program.unwrap_or_default().trim().to_string() });
        }
        if let Some(dir) = cwd {
            inner.dirs.insert(id, dir);
        }
        Ok(id)
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

    /// Ends every session that was started in `dir` or a folder under it, and waits (briefly) for
    /// the programs to be gone, so the folder can be deleted. Returns how many were ended.
    pub fn kill_under(&self, dir: &std::path::Path) -> usize {
        let wanted = |d: &str| {
            let d = std::path::Path::new(d);
            let same = |a: &std::path::Path, b: &std::path::Path| a.canonicalize().ok() == b.canonicalize().ok();
            same(d, dir) || d.ancestors().skip(1).any(|a| same(a, dir))
        };
        let ids: Vec<u32> = match self.inner.lock() {
            Ok(inner) => inner.dirs.iter().filter(|(_, d)| wanted(d)).map(|(id, _)| *id).collect(),
            Err(_) => return 0,
        };
        for id in &ids {
            let _ = self.kill(*id);
        }
        if !ids.is_empty() {
            std::thread::sleep(std::time::Duration::from_millis(300));
        }
        ids.len()
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
        let Ok(inner) = self.inner.lock() else { return Vec::new() };
        let mut ids: Vec<u32> = inner.sessions.keys().copied().collect();
        ids.sort_unstable();
        ids.into_iter().filter_map(|id| Some((handle_of(id), inner.dirs.get(&id)?.clone(), inner.marks.get(&id).map(|m| m.program.clone())))).collect()
    }

    /// The folder terminal `handle` was started in (ORCH-014 checks it for base drift).
    pub fn dir_of(&self, handle: &str) -> Option<String> {
        let id = id_of(handle)?;
        self.inner.lock().ok()?.dirs.get(&id).cloned()
    }

    /// Is `handle` an open terminal? (`--from` names one explicitly.)
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
pub fn terminal_spawn(app: AppHandle, terminals: tauri::State<'_, Terminals>, store: tauri::State<'_, std::sync::Mutex<crate::state::Store>>, cols: u16, rows: u16, cwd: Option<String>, start: Option<String>, program: Option<String>, args: Option<Vec<String>>, env: Option<Vec<(String, String)>>) -> Result<u32, String> {
    // TERM-040: `cwd` is the workspace folder; `start` may ask for a folder relative to it.
    let cwd = cwd.map(|w| start_dir(&w, start.as_deref()));
    // ACCT-004: a Claude pane in key mode is handed the 1-year key; nothing else ever is.
    // ACCT-005: otherwise a Claude pane runs on the active managed account's own folder.
    let env_own = env.unwrap_or_default();
    let env = {
        let store = store.lock().map_err(|e| e.to_string())?;
        let settings = store.settings();
        let token = crate::secrets::read_setting(&store, crate::claude_key::TOKEN_FIELD).ok().flatten();
        let key_mode = settings.get(crate::claude_key::MODE_FIELD).and_then(serde_json::Value::as_str) == Some(crate::claude_key::KEY_MODE);
        crate::claude_key::pane_env(program.as_deref(), &settings, token)
            .or_else(|| crate::claude_accounts::pane_env(program.as_deref(), key_mode, crate::claude_accounts::active_dir(&store)))
            // ACCT-007: a Codex pane runs in the active Codex account's private home.
            .or_else(|| crate::codex_accounts::pane_env(program.as_deref(), crate::codex_accounts::active_home(&store)))
            // ACCT-008: a Grok pane gets the saved xAI key; Grok itself prefers its own sign-in.
            .or_else(|| crate::grok::pane_env(program.as_deref(), crate::secrets::read_setting(&store, crate::grok::KEY_FIELD).ok().flatten()))
    };
    terminals.spawn(app, cols, rows, cwd, program, args.unwrap_or_default(), env_own, env)
}

/// TERM-045: for each id, whether closing it would stop a live program.
#[tauri::command]
pub fn terminal_busy(terminals: tauri::State<'_, Terminals>, ids: Vec<u32>) -> Vec<bool> {
    ids.into_iter().map(|id| terminals.busy(id)).collect()
}

#[tauri::command]
pub fn terminal_write(terminals: tauri::State<'_, Terminals>, id: u32, data: String) -> Result<(), String> {
    terminals.write(id, &data)
}

#[tauri::command]
pub fn terminal_resize(terminals: tauri::State<'_, Terminals>, id: u32, cols: u16, rows: u16) -> Result<(), String> {
    terminals.resize(id, cols, rows)
}

#[cfg(test)]
mod tests {
    use super::*;

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

#[tauri::command]
pub fn terminal_kill(terminals: tauri::State<'_, Terminals>, id: u32) -> Result<(), String> {
    terminals.kill(id)
}
