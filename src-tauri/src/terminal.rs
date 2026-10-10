//! Terminal panes as the front end sees them: numbered sessions, output pushed as events, input
//! and resize taken as commands. Every open session is killed when the window goes away.

use crate::pty::{program_command, shell_command, start_dir, PtySession};
use base64::Engine as _;
use std::collections::HashMap;
use std::sync::{Arc, Mutex};
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
    /// Sessions started with a program (an agent) rather than a shell (TERM-045).
    programs: std::collections::HashSet<u32>,
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
        let runs_program = program.as_deref().is_some_and(|p| !p.trim().is_empty());
        let mut command = match program.as_deref().map(str::trim).filter(|p| !p.is_empty()) {
            Some(p) => program_command(p, &args, cwd.as_deref()),
            None => shell_command(cwd.as_deref()),
        };
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
            },
            move |code| {
                // Drop the session so the PTY closes and the reader thread can finish.
                if let Ok(mut inner) = registry.lock() {
                    inner.sessions.remove(&id);
                    inner.dirs.remove(&id);
                    inner.programs.remove(&id);
                }
                let _ = exit_app.emit(EXIT_EVENT, ExitPayload { id, code });
            },
        )?;
        inner.sessions.insert(id, session);
        if runs_program {
            inner.programs.insert(id);
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
                Some(_) if inner.programs.contains(&id) => return true,
                Some(s) => s.pid(),
                None => return false,
            },
            Err(_) => return false,
        };
        pid.and_then(crate::procs::has_children).unwrap_or(false)
    }

    /// Ends one session. Its exit event follows from the waiter thread.
    pub fn kill(&self, id: u32) -> Result<(), String> {
        let mut inner = self.inner.lock().map_err(|e| e.to_string())?;
        inner.dirs.remove(&id);
        inner.programs.remove(&id);
        if let Some(mut s) = inner.sessions.remove(&id) {
            s.kill();
        }
        Ok(())
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

    /// Ends every session: the window is closing, nothing may be left running.
    pub fn kill_all(&self) {
        if let Ok(mut inner) = self.inner.lock() {
            inner.dirs.clear();
            inner.programs.clear();
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

#[tauri::command]
pub fn terminal_kill(terminals: tauri::State<'_, Terminals>, id: u32) -> Result<(), String> {
    terminals.kill(id)
}
