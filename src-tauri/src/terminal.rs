//! Terminal panes as the front end sees them: numbered sessions, output pushed as events, input
//! and resize taken as commands. Every open session is killed when the window goes away.

use crate::pty::{program_command, shell_command, start_dir, PtySession};
use base64::Engine as _;
use std::collections::HashMap;
use std::sync::{Arc, Condvar, Mutex};
use std::time::Instant;
use tauri::{AppHandle, Emitter, Manager};

pub const OUTPUT_EVENT: &str = "terminal-output";
pub const EXIT_EVENT: &str = "terminal-exit";
/// CLI-024: the app asks the window for a pane's visible frame; the window answers with
/// `terminal_screen_reply`.
pub const SCREEN_EVENT: &str = "terminal-screen-request";
/// Lines kept per terminal for `kolux terminal read` (CLI-024); older ones are dropped.
pub const LOG_LINES: usize = 2000;
const SCREEN_WAIT: std::time::Duration = std::time::Duration::from_millis(1500);

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
    /// CLI-024: what each session wrote, by line, for `kolux terminal read`.
    logs: HashMap<u32, OutputLog>,
}

/// CLI-024: a terminal's output by line, each line numbered with a cursor that only grows, so a
/// reader carries on from where it left off. Escape sequences are stripped; `\r` overwrites keep
/// the last version of the line. Bounded to `LOG_LINES`: the oldest lines go when it is full.
#[derive(Default, Debug)]
pub struct OutputLog {
    lines: std::collections::VecDeque<String>,
    /// The cursor of the first kept line; 1 until something was dropped.
    oldest: u64,
    /// Bytes since the last line break: a prompt, a progress line, a question. Bytes, not text,
    /// because a UTF-8 character can arrive split across two PTY chunks.
    pending: Vec<u8>,
    dropped: bool,
    /// When the session last wrote anything (CLI-025's idle fallback for panes without hooks).
    written: Option<Instant>,
}

#[derive(serde::Serialize, Debug, PartialEq, Clone)]
pub struct Line {
    pub cursor: u64,
    pub text: String,
}

/// One read of the log (CLI-024).
#[derive(serde::Serialize, Debug, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub struct Read {
    pub lines: Vec<Line>,
    /// Text after the last line break, not yet a numbered line.
    pub pending: String,
    /// The cursor to read on from (the last line's number; 0 before any line).
    pub cursor: u64,
    /// The oldest cursor still kept.
    pub oldest: u64,
    /// Lines after the cursor asked for were dropped before this read.
    pub dropped: bool,
    /// More lines follow the ones returned (`limit` cut them).
    pub more: bool,
}

/// Drops CSI, OSC and two-byte escape sequences, control characters other than tab.
pub fn strip_ansi(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let mut it = s.chars().peekable();
    while let Some(c) = it.next() {
        match c {
            '\x1b' => match it.next() {
                Some('[') => {
                    let mut n = 0usize;
                    for d in it.by_ref() {
                        if ('@'..='~').contains(&d) {
                            // Cursor forward (`C`) and erase characters (`X`) leave a gap in the
                            // text; keep it as spaces so columns stay apart.
                            if matches!(d, 'C' | 'X') {
                                out.extend(std::iter::repeat_n(' ', n.max(1)));
                            }
                            break;
                        }
                        if let Some(v) = d.to_digit(10) {
                            n = n.saturating_mul(10).saturating_add(v as usize);
                        }
                    }
                }
                Some('(' | ')') => {
                    it.next();
                }
                Some(']') => {
                    let mut last = '\0';
                    for d in it.by_ref() {
                        if d == '\x07' || (last == '\x1b' && d == '\\') {
                            break;
                        }
                        last = d;
                    }
                }
                _ => {}
            },
            '\t' => out.push(c),
            c if c.is_control() => {}
            c => out.push(c),
        }
    }
    out
}

impl OutputLog {
    pub fn push(&mut self, chunk: &[u8]) {
        self.written = Some(Instant::now());
        self.pending.extend_from_slice(chunk);
        while let Some(i) = self.pending.iter().position(|b| *b == b'\n') {
            let rest = self.pending.split_off(i + 1);
            let raw = String::from_utf8_lossy(&std::mem::replace(&mut self.pending, rest)).into_owned();
            let line = raw.trim_end_matches(['\n', '\r']);
            // A carriage return redraws the line from its start: keep what was drawn last.
            let line = line.rsplit('\r').next().unwrap_or(line);
            if self.lines.is_empty() && self.oldest == 0 {
                self.oldest = 1;
            }
            self.lines.push_back(strip_ansi(line));
            while self.lines.len() > LOG_LINES {
                self.lines.pop_front();
                self.oldest += 1;
                self.dropped = true;
            }
        }
    }

    /// The pending bytes as text, minus a UTF-8 character still arriving at the end.
    fn pending_text(&self) -> &str {
        match std::str::from_utf8(&self.pending) {
            Ok(t) => t,
            Err(e) => std::str::from_utf8(&self.pending[..e.valid_up_to()]).unwrap_or_default(),
        }
    }

    /// The cursor to carry on from: the newest line's number, 0 before any line.
    pub fn cursor(&self) -> u64 {
        (self.oldest + self.lines.len() as u64).saturating_sub(1)
    }

    /// The lines after `after` (all of them when none is given). With `limit`, the first `limit`
    /// after a cursor (a reader pages forward), else the last `limit` (a reader wants the latest).
    pub fn read(&self, after: Option<u64>, limit: Option<usize>) -> Read {
        let from = after.unwrap_or(0);
        let oldest = self.oldest.max(1);
        let skip = (from + 1).saturating_sub(oldest) as usize;
        let mut lines: Vec<Line> = self.lines.iter().enumerate().skip(skip).map(|(i, t)| Line { cursor: self.oldest + i as u64, text: t.clone() }).collect();
        let mut more = false;
        if let Some(n) = limit {
            if lines.len() > n {
                more = true;
                if after.is_some() {
                    lines.truncate(n);
                } else {
                    lines.drain(..lines.len() - n);
                }
            }
        }
        let pending = if more && after.is_some() { String::new() } else { strip_ansi(self.pending_text().rsplit('\r').next().unwrap_or_default()) };
        let cursor = lines.last().map_or(if from < oldest { 0 } else { from.min(self.cursor()) }, |l| l.cursor);
        Read { lines, pending, cursor, oldest, dropped: self.dropped && from + 1 < self.oldest, more }
    }
}

/// CLI-024's screen round trip: the serve thread opens a slot, emits `SCREEN_EVENT`, and waits for
/// the window to fill it. ponytail: a Vec, there is never more than one request in flight.
static SCREENS: Mutex<Vec<(String, Option<Vec<String>>)>> = Mutex::new(Vec::new());
static SCREEN_READY: Condvar = Condvar::new();

pub fn screen_open(request: &str) {
    if let Ok(mut s) = SCREENS.lock() {
        s.push((request.to_string(), None));
    }
}

/// The rows the window answered with, or none when it did not answer in time.
pub fn screen_wait(request: &str) -> Option<Vec<String>> {
    let mut guard = SCREENS.lock().ok()?;
    let until = Instant::now() + SCREEN_WAIT;
    loop {
        let i = guard.iter().position(|(r, _)| r == request)?;
        if guard[i].1.is_some() {
            return guard.remove(i).1;
        }
        let left = until.saturating_duration_since(Instant::now());
        if left.is_zero() {
            guard.remove(i);
            return None;
        }
        guard = SCREEN_READY.wait_timeout(guard, left).ok()?.0;
    }
}

/// The window's answer to `SCREEN_EVENT`: the visible rows of that pane (CLI-024).
#[tauri::command]
pub fn terminal_screen_reply(request: String, rows: Vec<String>) {
    if let Ok(mut s) = SCREENS.lock() {
        if let Some(slot) = s.iter_mut().find(|(r, _)| *r == request) {
            slot.1 = Some(rows);
            SCREEN_READY.notify_all();
        }
    }
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
    /// TERM-098: the pane's own key, so output that arrives before the pane has learned its
    /// terminal id (the shell's first frame and its cursor question) is not dropped.
    pane: Option<u32>,
}

#[derive(serde::Serialize, Clone)]
struct ExitPayload {
    id: u32,
    code: Option<u32>,
}

/// ORCH-058: what `kill_under` did: how many sessions it ended, and the pids it could not show
/// gone in time (or could not check), which block a removal unless waived.
#[derive(Default, Debug, PartialEq)]
pub struct Stopped {
    pub ended: usize,
    pub stuck: Vec<u32>,
}

impl Terminals {
    /// Starts a pane. With no `program` it runs the user's shell; with one (an agent such as
    /// `claude`) it runs that program directly with `args`, in `cwd`.
    #[allow(clippy::too_many_arguments)]
    pub fn spawn(&self, app: AppHandle, cols: u16, rows: u16, cwd: Option<String>, program: Option<String>, args: Vec<String>, own_env: Vec<(String, String)>, env: Vec<(String, String)>, pane_key: Option<u32>) -> Result<u32, String> {
        let mut inner = self.inner.lock().map_err(|e| e.to_string())?;
        inner.next_id += 1;
        let id = inner.next_id;
        let out_app = app.clone();
        // APP-041: each session's start and end go to the app's own log (no arguments: they may carry secrets).
        let log_dir = app.path().app_data_dir().ok();
        let exit_dir = log_dir.clone();
        let label = program.clone().unwrap_or_else(|| "shell".to_string());
        let exit_app = app;
        let registry = self.inner.clone();
        let out_registry = self.inner.clone();
        let is_program = program.as_deref().map(str::trim).is_some_and(|p| !p.is_empty());
        let mut command = match program.as_deref().map(str::trim).filter(|p| !p.is_empty()) {
            Some(p) => program_command(p, &args, cwd.as_deref()),
            None => shell_command(cwd.as_deref()),
        };
        // STAT-001: the pane's programs and their hooks know which pane to report for. Set first:
        // the hooks find their pane by KOLUX_HOOK_IDENTITY and only check that KOLUX_PANE_KEY is set,
        // so the command line's handle and pane key below (CLI-007, ORCH-013) take those two names.
        if let (Some(pane), Some(hooks)) = (pane_key, exit_app.try_state::<crate::hooks::Hooks>()) {
            for (k, v) in hooks.pane_env(pane, id) {
                command.env(k, v);
            }
        }
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
            // CLI-007 / ORCH-054: the pane reaches the Kolux that opened it, so the other-build
            // override (COMPAT 7) it may have inherited from the shell that started Kolux is
            // pointed at this app's own folder too.
            command.env("KOLUX_USER_DATA_PATH", &dir);
            command.env(crate::cli::APP_DIR_ENV, dir);
        }
        // SET-027: the user's variables for this agent; Kolux's account variable below wins.
        for (k, v) in own_env {
            command.env(k, v);
        }
        for (k, v) in env {
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
                let _ = out_app.emit(OUTPUT_EVENT, OutputPayload { id, data, pane: pane_key });
                if let Ok(mut inner) = out_registry.lock() {
                    inner.logs.entry(id).or_default().push(chunk);
                    if is_program {
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
                    inner.logs.remove(&id);
                }
                if let Some(d) = &exit_dir {
                    crate::diag::write(d, &format!("terminal {id} exited ({code:?})"));
                }
                let _ = exit_app.emit(EXIT_EVENT, ExitPayload { id, code });
            },
        )?;
        inner.sessions.insert(id, session);
        if let Some(d) = &log_dir {
            crate::diag::write(d, &format!("terminal {id} started ({label})"));
        }
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

    /// CLI-024: what session `id` wrote after `cursor` (none for an open session that wrote nothing yet).
    pub fn read(&self, id: u32, cursor: Option<u64>, limit: Option<usize>) -> Option<Read> {
        let inner = self.inner.lock().ok()?;
        if !inner.sessions.contains_key(&id) {
            return None;
        }
        Some(inner.logs.get(&id).map(|l| l.read(cursor, limit)).unwrap_or_else(|| Read { oldest: 1, ..Read::default() }))
    }

    /// How long session `id` has written nothing (shells included); none when it never wrote.
    pub fn quiet_for(&self, id: u32) -> Option<std::time::Duration> {
        let inner = self.inner.lock().ok()?;
        inner.logs.get(&id).and_then(|l| l.written).map(|t| t.elapsed())
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

    /// ORCH-058: ends every session started in `dir` or a folder under it, each with the processes
    /// it started, and waits up to three seconds for them to be shown gone, so the folder can be
    /// deleted. A record with no process behind it (stale) is swept and never counts as stuck.
    pub fn kill_under(&self, dir: &std::path::Path) -> Stopped {
        let wanted = |d: &str| {
            let d = std::path::Path::new(d);
            let same = |a: &std::path::Path, b: &std::path::Path| a.canonicalize().ok() == b.canonicalize().ok();
            same(d, dir) || d.ancestors().skip(1).any(|a| same(a, dir))
        };
        let found: Vec<(u32, Option<u32>)> = match self.inner.lock() {
            Ok(inner) => inner.dirs.iter().filter(|(_, d)| wanted(d)).map(|(id, _)| (*id, inner.sessions.get(id).and_then(PtySession::pid))).collect(),
            Err(_) => return Stopped::default(),
        };
        for (id, pid) in &found {
            // The tree first: a dev server the shell started holds the folder as much as the shell.
            if let Some(pid) = pid {
                crate::procs::kill_tree(*pid);
            }
            let _ = self.kill(*id);
        }
        let pids: Vec<u32> = found.iter().filter_map(|(_, p)| *p).collect();
        Stopped { ended: found.len(), stuck: crate::procs::wait_gone(&pids, std::time::Duration::from_secs(3)) }
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

/// What `terminal_spawn` answers: the session id and, for a Codex pane, the managed account it
/// runs on (ACCT-023: the pane remembers it; none for Codex's own sign-in).
#[derive(serde::Serialize)]
pub struct Spawned {
    pub id: u32,
    pub account: Option<String>,
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub fn terminal_spawn(app: AppHandle, terminals: tauri::State<'_, Terminals>, store: tauri::State<'_, std::sync::Mutex<crate::state::Store>>, cols: u16, rows: u16, cwd: Option<String>, start: Option<String>, program: Option<String>, args: Option<Vec<String>>, env: Option<Vec<(String, String)>>, pane_key: Option<u32>, account: Option<String>) -> Result<Spawned, String> {
    // TERM-040: `cwd` is the workspace folder; `start` may ask for a folder relative to it.
    let cwd = cwd.map(|w| start_dir(&w, start.as_deref()));
    // ACCT-023: a resumed Codex pane runs on the account it began on, or not at all.
    let codex = program.as_deref().and_then(crate::agents::credited_agent) == Some("codex");
    let resumed = match account.as_deref().filter(|_| codex) {
        Some(id) => Some(crate::codex_accounts::wait_home(&store, id)?),
        None => None,
    };
    // ACCT-004: a Claude pane in key mode is handed the 1-year key; nothing else ever is.
    // ACCT-005: otherwise a Claude pane runs on the active managed account's own folder.
    let env_own = env.unwrap_or_default();
    let (env, cap, account): (Vec<(String, String)>, bool, Option<String>) = {
        let store = store.lock().map_err(|e| e.to_string())?;
        let settings = store.settings();
        let used = codex.then(|| account.clone().or_else(|| crate::codex_accounts::active_account(&store).map(|a| a.id))).flatten();
        let codex_home = resumed.or_else(|| crate::codex_accounts::active_home(&store));
        let token = crate::secrets::read_setting(&store, crate::claude_key::TOKEN_FIELD).ok().flatten();
        let key_mode = settings.get(crate::claude_key::MODE_FIELD).and_then(serde_json::Value::as_str) == Some(crate::claude_key::KEY_MODE);
        let env: Vec<(String, String)> = crate::claude_key::pane_env(program.as_deref(), &settings, token)
            .or_else(|| crate::claude_accounts::pane_env(program.as_deref(), key_mode, crate::claude_accounts::active_dir(&store)))
            // ACCT-007: a Codex pane runs in the active Codex account's private home.
            .or_else(|| crate::codex_accounts::pane_env(program.as_deref(), codex_home))
            .map(|(k, v)| (k.to_string(), v))
            .into_iter()
            .collect();
        (env, crate::cap::on(&settings), used)
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
    Ok(Spawned { id, account })
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

    fn cursors(r: &Read) -> Vec<u64> {
        r.lines.iter().map(|l| l.cursor).collect()
    }

    #[test]
    fn log_numbers_lines_and_pages_by_cursor() {
        let mut log = OutputLog::default();
        assert_eq!(log.read(None, None), Read { oldest: 1, ..Read::default() });
        log.push(b"one\r\ntwo\n\x1b[32mgreen\x1b[0m three\nprom");
        log.push(b"pt> ");
        let all = log.read(None, None);
        assert_eq!(all.lines.iter().map(|l| l.text.as_str()).collect::<Vec<_>>(), ["one", "two", "green three"]);
        assert_eq!((all.cursor, all.pending.as_str(), all.dropped, all.more), (3, "prompt> ", false, false));
        let later = log.read(Some(2), None);
        assert_eq!((cursors(&later), later.cursor), (vec![3], 3));
        let nothing = log.read(Some(3), None);
        assert_eq!((cursors(&nothing), nothing.cursor, nothing.pending.as_str()), (vec![], 3, "prompt> "));
        // The last two without a cursor, the first two after one: both say more remains.
        let last = log.read(None, Some(2));
        assert_eq!((cursors(&last), last.more), (vec![2, 3], true));
        log.push(b"four\n");
        let page = log.read(Some(1), Some(2));
        assert_eq!((cursors(&page), page.cursor, page.more, page.pending.as_str()), (vec![2, 3], 3, true, ""));
        // A progress line redrawn with carriage returns keeps its last drawing.
        log.push(b"10%\r50%\r100%\n");
        assert_eq!(log.read(Some(4), None).lines[0].text, "100%");
        // A character split across two chunks is whole once both arrived, and not shown half-way.
        let bytes = "\u{2588}>\n".as_bytes();
        log.push(&bytes[..2]);
        assert_eq!(log.read(Some(5), None).pending, "");
        log.push(&bytes[2..]);
        assert_eq!(log.read(Some(5), None).lines[0].text, "\u{2588}>");
    }

    #[test]
    fn log_drops_the_oldest_lines_and_says_so() {
        let mut log = OutputLog::default();
        for i in 1..=(LOG_LINES as u64 + 5) {
            log.push(format!("line {i}\n").as_bytes());
        }
        let r = log.read(None, Some(1));
        assert_eq!((r.oldest, r.cursor, r.dropped, r.lines[0].text.as_str()), (6, LOG_LINES as u64 + 5, true, "line 2005"));
        // A cursor older than what is kept: dropped; one inside what is kept: not.
        assert!(log.read(Some(3), None).dropped);
        assert_eq!(log.read(Some(3), None).lines[0].cursor, 6);
        assert!(!log.read(Some(5), None).dropped);
        assert!(!log.read(Some(100), None).dropped);
    }

    #[test]
    fn strip_ansi_keeps_text_only() {
        assert_eq!(strip_ansi("\x1b]0;title\x07a\x1b[1;31mb\x1b[0m\tc\x1b(Bd\x07"), "ab\tcd");
        // Cursor moves and erases that make a gap keep it, so columns do not run together.
        assert_eq!(strip_ansi("A\x1b[5CB\x1b[CC\x1b[2XD"), "A     B C  D");
    }

    #[test]
    fn screen_reply_wakes_the_waiter_and_a_missing_reply_times_out() {
        screen_open("r1");
        let t = std::thread::spawn(|| screen_wait("r1"));
        std::thread::sleep(std::time::Duration::from_millis(50));
        terminal_screen_reply("r1".into(), vec!["row".into()]);
        assert_eq!(t.join().unwrap(), Some(vec!["row".to_string()]));
        terminal_screen_reply("nobody".into(), vec![]);
        screen_open("r2");
        assert_eq!(screen_wait("r2"), None);
        assert!(SCREENS.lock().unwrap().is_empty());
    }

    /// ORCH-058: the shells in a worktree are ended and shown gone before its folder is deleted,
    /// and a record with no process behind it never blocks.
    #[test]
    fn orch058_kill_under_ends_the_shells_in_a_folder_so_it_can_be_deleted() {
        let dir = std::env::temp_dir().join(format!("kolux-orch058-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let t = Terminals::default();
        let s = PtySession::spawn(shell_command(Some(&dir.to_string_lossy())), 80, 24, |_| {}, |_| {}).expect("spawn a shell in the folder");
        let pid = s.pid().expect("the platform reports the shell's pid");
        {
            let mut inner = t.inner.lock().unwrap();
            inner.sessions.insert(1, s);
            inner.dirs.insert(1, dir.to_string_lossy().into_owned());
            // A stale record: the folder above, with no session behind it.
            inner.dirs.insert(2, std::env::temp_dir().to_string_lossy().into_owned());
        }
        std::thread::sleep(std::time::Duration::from_millis(700));
        let stopped = t.kill_under(&dir);
        assert_eq!((stopped.ended, stopped.stuck.as_slice()), (1, &[][..]), "the shell ended and was shown gone");
        assert_eq!(crate::procs::alive(pid), Some(false));
        assert!(t.inner.lock().unwrap().sessions.is_empty());
        std::fs::remove_dir_all(&dir).expect("the folder is free once its shell is gone");
        let stale = t.kill_under(&std::env::temp_dir());
        assert_eq!((stale.ended, stale.stuck.len()), (1, 0), "a stale record is swept without blocking");
        assert!(t.inner.lock().unwrap().dirs.is_empty());
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

#[tauri::command]
pub fn terminal_kill(terminals: tauri::State<'_, Terminals>, id: u32) -> Result<(), String> {
    terminals.kill(id)
}
