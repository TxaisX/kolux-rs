//! Terminal panes as the front end sees them: numbered sessions, output pushed as events, input
//! and resize taken as commands. Every open session is killed when the window goes away.

use crate::pty::{check_start_dir, inherited_noise, is_shell_program, program_command, shell_commands, start_dir, PtySession};
use base64::Engine as _;
use std::collections::{HashMap, HashSet};
use std::sync::{Arc, Condvar, Mutex};
use std::time::{Duration, Instant};
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
    /// CLI-024: what each session wrote, by line, for `kolux terminal read`.
    logs: HashMap<u32, OutputLog>,
    /// TERM-132: which sessions a program holds (alternate screen, mouse): `ALT | MOUSE` bits.
    owned: HashMap<u32, u8>,
    /// TERM-106: each session's output file, by pane key, replayed when the pane comes back after a restart.
    hist: HashMap<u32, History>,
    /// ACCT-054: how far each session's output has run ahead of its pane.
    flow: HashMap<u32, Arc<Flow>>,
}

/// ACCT-054: how far a session's output has run ahead of what its pane has drawn. Past
/// `FLOW_HIGH` unacknowledged bytes the reader thread stops reading the PTY (so the program blocks
/// on its own write) and goes on once the pane is down to `FLOW_LOW`; a pane that stops answering
/// (its webview busy, say) holds it `FLOW_WAIT` at most, so no program is ever stuck for good.
#[derive(Default)]
struct Flow {
    unacked: Mutex<u64>,
    drawn: Condvar,
    pauses: std::sync::atomic::AtomicU32,
}

const FLOW_HIGH: u64 = 512 * 1024;
const FLOW_LOW: u64 = 128 * 1024;
const FLOW_WAIT: Duration = Duration::from_secs(2);

impl Flow {
    /// Counts `bytes` just sent to the pane and, past the high mark, waits for it to catch up.
    fn sent(&self, bytes: u64) {
        self.sent_within(bytes, FLOW_WAIT);
    }

    fn sent_within(&self, bytes: u64, wait: Duration) {
        let Ok(mut n) = self.unacked.lock() else { return };
        *n += bytes;
        if *n < FLOW_HIGH {
            return;
        }
        self.pauses.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
        let deadline = Instant::now() + wait;
        while *n > FLOW_LOW {
            let left = deadline.saturating_duration_since(Instant::now());
            if left.is_zero() {
                // ponytail: a pane that never answers is taken as caught up; the next flood pauses again.
                *n = 0;
                break;
            }
            n = match self.drawn.wait_timeout(n, left) {
                Ok((guard, _)) => guard,
                Err(_) => return,
            };
        }
    }

    /// The pane drew `bytes` more.
    fn ack(&self, bytes: u64) {
        if let Ok(mut n) = self.unacked.lock() {
            *n = n.saturating_sub(bytes);
            if *n <= FLOW_LOW {
                self.drawn.notify_all();
            }
        }
    }

    /// The session is ending: a paused reader goes on at once.
    fn release(&self) {
        if let Ok(mut n) = self.unacked.lock() {
            *n = 0;
        }
        self.drawn.notify_all();
    }

    fn pauses(&self) -> u32 {
        self.pauses.load(std::sync::atomic::Ordering::Relaxed)
    }
}

/// ACCT-059: the memory profile for a machine with `total` bytes of memory, and the scrollback
/// lines each pane keeps under it. Pure, so the same machine gets the same caps every start.
pub fn profile_for(total: Option<u64>) -> (&'static str, u32) {
    const GIB: u64 = 1 << 30;
    match total {
        Some(t) if t < 8 * GIB => ("small", 2000),
        Some(t) if t >= 16 * GIB => ("large", 10000),
        _ => ("medium", 5000),
    }
}

/// ACCT-059: the machine's physical memory, in bytes.
fn total_memory() -> Option<u64> {
    #[cfg(windows)]
    {
        use windows_sys::Win32::System::SystemInformation::{GlobalMemoryStatusEx, MEMORYSTATUSEX};
        // SAFETY: the struct is zeroed with dwLength set, as GlobalMemoryStatusEx requires.
        unsafe {
            let mut m: MEMORYSTATUSEX = std::mem::zeroed();
            m.dwLength = std::mem::size_of::<MEMORYSTATUSEX>() as u32;
            (GlobalMemoryStatusEx(&mut m) != 0).then_some(m.ullTotalPhys)
        }
    }
    #[cfg(not(windows))]
    {
        None
    }
}

/// TERM-106: past this many bytes a pane's saved output is rewritten down to `HISTORY_KEEP`.
const HISTORY_CAP: u64 = 256 * 1024;
/// TERM-106: what a rewrite keeps (the newest bytes, from a line boundary), and the most a restore replays.
const HISTORY_KEEP: usize = 128 * 1024;

/// TERM-106: what a pane printed, kept on disk by pane key (`<app data>/history/<key>.log`) so a
/// reopened pane shows it above its new shell. Append-only, so a crash at any moment leaves a
/// usable copy; the rewrite past the cap goes through a temp file and a rename for the same reason.
/// ponytail: the file is opened per chunk; a kept handle only matters at thousands of chunks a second.
struct History {
    path: std::path::PathBuf,
    size: u64,
}

impl History {
    fn open(dir: &std::path::Path, key: u32) -> Option<History> {
        std::fs::create_dir_all(dir.join("history")).ok()?;
        let path = history_file(dir, key);
        let size = std::fs::metadata(&path).map(|m| m.len()).unwrap_or(0);
        Some(History { path, size })
    }

    fn append(&mut self, chunk: &[u8]) {
        use std::io::Write as _;
        if let Ok(mut f) = std::fs::OpenOptions::new().create(true).append(true).open(&self.path) {
            if f.write_all(chunk).is_ok() {
                self.size += chunk.len() as u64;
            }
        }
        if self.size > HISTORY_CAP {
            self.compact();
        }
    }

    fn compact(&mut self) {
        let Ok(all) = std::fs::read(&self.path) else { return };
        let kept = trim_history(&all, HISTORY_KEEP);
        let tmp = self.path.with_extension("tmp");
        if std::fs::write(&tmp, kept).is_ok() && std::fs::rename(&tmp, &self.path).is_ok() {
            self.size = kept.len() as u64;
        }
    }
}

fn history_file(dir: &std::path::Path, key: u32) -> std::path::PathBuf {
    dir.join("history").join(format!("{key}.log"))
}

/// The newest `keep` bytes of `all`, from the next line boundary so no escape sequence is cut in two.
fn trim_history(all: &[u8], keep: usize) -> &[u8] {
    if all.len() <= keep {
        return all;
    }
    let from = all.len() - keep;
    match all[from..].iter().position(|b| *b == b'\n') {
        Some(i) => &all[from + i + 1..],
        None => &all[from..],
    }
}

/// TERM-106: removes the saved output of panes not in `keep`. A file not named by a pane key is
/// left alone (its owner is uncertain) and an empty list prunes nothing (the layout could not be read).
fn prune_history(dir: &std::path::Path, keep: &[u32]) {
    if keep.is_empty() {
        return;
    }
    let Ok(entries) = std::fs::read_dir(dir.join("history")) else { return };
    for e in entries.flatten() {
        let name = e.file_name();
        let Some(key) = name.to_str().and_then(|n| n.strip_suffix(".log")).and_then(|n| n.parse::<u32>().ok()) else { continue };
        if !keep.contains(&key) {
            let _ = std::fs::remove_file(e.path());
        }
    }
}

/// TERM-132: the program in the pane took the alternate screen (vim, less, a full-screen agent view).
pub const ALT: u8 = 1;
/// TERM-132: the program in the pane captures the mouse.
pub const MOUSE: u8 = 2;

/// TERM-132: which DEC private modes in `chunk` hand the pane to a program (alternate screen
/// 47/1047/1049, mouse 1000..1003) or back; the last one in the chunk wins.
/// ponytail: a sequence split across two chunks is missed; the program's next full sequence or
/// its exit sets the record straight.
pub fn screen_owner(prev: u8, chunk: &[u8]) -> u8 {
    let mut owned = prev;
    let mut i = 0;
    while i + 3 < chunk.len() {
        if chunk[i] != 0x1b || chunk[i + 1] != b'[' || chunk[i + 2] != b'?' {
            i += 1;
            continue;
        }
        let mut j = i + 3;
        let mut n: u32 = 0;
        while j < chunk.len() && chunk[j].is_ascii_digit() {
            n = n * 10 + u32::from(chunk[j] - b'0');
            j += 1;
        }
        if j < chunk.len() && matches!(chunk[j], b'h' | b'l') {
            let bit = match n {
                47 | 1047 | 1049 => ALT,
                1000..=1003 => MOUSE,
                _ => 0,
            };
            if chunk[j] == b'h' {
                owned |= bit;
            } else {
                owned &= !bit;
            }
        }
        i = j;
    }
    owned
}

/// TERM-116: the snapshot text for a bug report. Every value and screen line goes through the
/// diagnostics scrub (tokens, key=value secrets) and the home folder reads `~`.
pub fn diagnostics_text(head: &[(&str, String)], screen: &[String], home: Option<&str>) -> String {
    let mask = |s: &str| {
        let s = match home.filter(|h| !h.is_empty()) {
            Some(h) => s.replace(h, "~"),
            None => s.to_string(),
        };
        crate::diag::scrub(&s)
    };
    let mut out = String::from("Kolux terminal diagnostics\n");
    for (k, v) in head {
        out.push_str(&format!("{k}: {}\n", mask(v)));
    }
    out.push_str("\nscreen:\n");
    for line in screen {
        out.push_str(&mask(line));
        out.push('\n');
    }
    out
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

/// GIT-063: an agent pane (automation runs start theirs the same way) gets git's prompts turned
/// off, so a remote that wants a password fails the command instead of stalling the agent; a shell
/// keeps prompting. Set before the user's own variables, which can turn them back on.
fn unattended(command: &mut portable_pty::CommandBuilder, is_program: bool) {
    if is_program {
        for (k, v) in crate::git::NO_PROMPT {
            command.env(k, v);
        }
    }
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
    /// The window pane the session runs in (CHAT-006 finds a pane's program by it).
    pane: Option<u32>,
    /// CLAUDE_CONFIG_DIR / CODEX_HOME as the program was started with them.
    home_env: Vec<(String, String)>,
    /// The folder the program started in (None: the app's own folder).
    cwd: Option<String>,
}

/// What a pane's program session is, for the chat view (CHAT-002, CHAT-006).
pub struct PaneRun {
    pub agent: Option<&'static str>,
    /// When the program started, on the wall clock.
    pub started: std::time::SystemTime,
    /// The program has printed something (it is past launching).
    pub wrote: bool,
    pub alive: bool,
    /// CLAUDE_CONFIG_DIR / CODEX_HOME as the program was started with them (CHAT-007).
    pub home_env: Vec<(String, String)>,
    /// The folder the program started in (None: the app's own folder).
    pub cwd: Option<String>,
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
    pub fn spawn(&self, app: AppHandle, cols: u16, rows: u16, cwd: Option<String>, program: Option<String>, args: Vec<String>, own_env: Vec<(String, String)>, env: Vec<(String, String)>, pane_key: Option<u32>, shell: Option<(String, Vec<String>)>) -> Result<u32, String> {
        // TERM-115: a pane's Ctrl+C must reach its program. Windows hands "ignore Ctrl+C" down to
        // every child a process starts, and this app is itself started with CREATE_NEW_PROCESS_GROUP
        // (by `kolux-dev`, and by the dev runner), so its shells never saw the interrupt: the pty got
        // the byte, the shell kept running. Cleared once, before the first shell starts.
        #[cfg(windows)]
        {
            static CTRL_C: std::sync::Once = std::sync::Once::new();
            // SAFETY: a documented call on this process's own console state; no pointers are passed.
            CTRL_C.call_once(|| unsafe {
                windows_sys::Win32::System::Console::SetConsoleCtrlHandler(None, 0);
            });
        }
        // CHAT-007: the agent home folders the program really got; Kolux's account variable (applied last) wins.
        let home_env: Vec<(String, String)> = own_env.iter().chain(env.iter()).filter(|(k, _)| k == crate::claude_accounts::CONFIG_ENV || k == crate::codex_accounts::HOME_ENV).cloned().collect();
        let chat_cwd = cwd.clone();
        // ACCT-049: checked before the lock, so a drive that does not answer holds up only this pane.
        if let Some(dir) = cwd.as_deref() {
            check_start_dir(dir, program.as_deref().map(str::trim).is_some_and(|p| !p.is_empty() && !is_shell_program(p)))?;
        }
        let mut inner = self.inner.lock().map_err(|e| e.to_string())?;
        inner.next_id += 1;
        let id = inner.next_id;
        let out_app = app.clone();
        // APP-041: each session's start and end go to the app's own log (no arguments: they may carry secrets).
        let log_dir = app.path().app_data_dir().ok();
        let exit_dir = log_dir.clone();
        let history = pane_key.and_then(|k| log_dir.as_deref().and_then(|d| History::open(d, k)));
        let label = program.clone().unwrap_or_else(|| "shell".to_string());
        let exit_app = app;
        let registry = self.inner.clone();
        let out_registry = self.inner.clone();
        // Council MERGE 51: a shell (a chosen default shell too, SET-026) stays a plain terminal, not a program session.
        let is_program = program.as_deref().map(str::trim).is_some_and(|p| !p.is_empty() && !is_shell_program(p));
        // GIT-026: a pull-request link printed in any pane, hidden or parked ones too, attaches to its workspace.
        let mut prs = crate::scm::PrScan::default();
        let link_dir = cwd.clone();
        // ACCT-046: a program runs as asked; a shell pane has a line of fallbacks behind the
        // chosen default shell (SET-026), when there is one.
        let mut commands = match program.as_deref().map(str::trim).filter(|p| !p.is_empty()) {
            Some(p) => vec![program_command(p, &args, cwd.as_deref())],
            None => shell_commands(cwd.as_deref(), shell),
        };
        let key = crate::cli::secret();
        let strip_key = crate::claude_key::strip_inherited(program.as_deref(), &env);
        for command in commands.iter_mut() {
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
                // CLI-007 / ORCH-054: the pane reaches the Kolux that opened it, so the other-build
                // override (COMPAT 7) it may have inherited from the shell that started Kolux, stripped
                // above with the rest of the noise (CLI-010), is pointed at this app's own folder.
                command.env("KOLUX_USER_DATA_PATH", &dir);
                command.env(crate::cli::APP_DIR_ENV, dir);
            }
            unattended(command, is_program);
            // ACCT-024: a Claude pane not handed the 1-year key drops one Kolux itself was started
            // with (Claude Code prefers the variable over its own login).
            if strip_key {
                command.env_remove(crate::claude_key::ENV);
            }
            // SET-027: the user's variables for this agent; Kolux's account variable below wins.
            for (k, v) in &own_env {
                command.env(k, v);
            }
            for (k, v) in &env {
                command.env(k, v);
            }
        }
        let flow = Arc::new(Flow::default());
        let out_flow = flow.clone();
        let session = PtySession::spawn_first(
            commands,
            cols.max(2),
            rows.max(1),
            move |chunk| {
                let data = base64::engine::general_purpose::STANDARD.encode(chunk);
                let _ = out_app.emit(OUTPUT_EVENT, OutputPayload { id, data, pane: pane_key });
                if let Some(dir) = link_dir.as_deref() {
                    for url in prs.feed(chunk) {
                        let linked = out_app.state::<Mutex<crate::state::Store>>().lock().is_ok_and(|s| crate::scm::link_printed(&s, dir, &url));
                        if linked {
                            let _ = out_app.emit("settings-saved", ());
                        }
                    }
                }
                if let Ok(mut inner) = out_registry.lock() {
                    inner.logs.entry(id).or_default().push(chunk);
                    if let Some(h) = inner.hist.get_mut(&id) {
                        h.append(chunk);
                    }
                    if chunk.contains(&0x1b) {
                        let prev = inner.owned.get(&id).copied().unwrap_or(0);
                        let now = screen_owner(prev, chunk);
                        if now != prev {
                            inner.owned.insert(id, now);
                        }
                    }
                    if is_program {
                        if let Some(m) = inner.marks.get_mut(&id) {
                            m.last_output = Some(Instant::now());
                        }
                    }
                }
                // ACCT-054: after the bookkeeping, so no lock is held while the pane catches up.
                out_flow.sent(chunk.len() as u64);
            },
            move |code| {
                // Drop the session so the PTY closes and the reader thread can finish. A session
                // still listed ended by itself: Kolux's own kills take it off the list first.
                let mut by_itself = false;
                let mut tail = None;
                if let Ok(mut inner) = registry.lock() {
                    // AUTO-014: keep the end of a followed run's output before the log goes.
                    tail = inner.logs.get(&id).map(|l| crate::automations::screen_text(&l.read(None, Some(crate::automations::RUN_OUTPUT_LINES))));
                    by_itself = inner.sessions.remove(&id).is_some();
                    inner.dirs.remove(&id);
                    inner.marks.remove(&id);
                    inner.keys.remove(&id);
                    inner.ended.insert(id);
                    inner.logs.remove(&id);
                    inner.owned.remove(&id);
                    inner.hist.remove(&id);
                    if let Some(f) = inner.flow.remove(&id) {
                        f.release();
                    }
                }
                crate::activity::terminal_ended(id);
                // AUTO-012: an automation run followed in this pane is over with it.
                crate::automations::follow(&exit_app, |s| {
                    let run = crate::automations::pane_ended(s, id, code, crate::automations::now_ms())?;
                    if let (Some(r), Some((text, cut))) = (&run, &tail) {
                        crate::automations::keep_output(s, r, text, *cut)?;
                    }
                    Ok(run)
                });
                // ORCH-027: a worker's agent that died mid-task tells its coordinator.
                if by_itself && is_program {
                    if let Ok(store) = exit_app.state::<Mutex<crate::state::Store>>().lock() {
                        let _ = crate::cli::worker_exited(&store, id, code, crate::automations::now_ms());
                    }
                }
                if let Some(d) = &exit_dir {
                    crate::diag::write(d, &format!("terminal {id} exited ({code:?})"));
                }
                let _ = exit_app.emit(EXIT_EVENT, ExitPayload { id, code });
            },
        )?;
        inner.sessions.insert(id, session);
        inner.flow.insert(id, flow);
        if let Some(d) = &log_dir {
            crate::diag::write(d, &format!("terminal {id} started ({label})"));
        }
        inner.keys.insert(id, key);
        if let Some(h) = history {
            inner.hist.insert(id, h);
        }
        if is_program {
            let agent = program.as_deref().and_then(crate::agents::credited_agent);
            inner.marks.insert(id, Mark { started: Instant::now(), last_output: None, program: program.unwrap_or_default().trim().to_string(), agent, pane: pane_key, home_env, cwd: chat_cwd });
        }
        if let Some(dir) = cwd {
            inner.dirs.insert(id, dir);
        }
        Ok(id)
    }

    /// The newest program session started in window pane `pane` (CHAT-002, CHAT-006).
    pub fn of_pane(&self, pane: u32) -> Option<PaneRun> {
        let inner = self.inner.lock().ok()?;
        let (id, m) = inner.marks.iter().filter(|(_, m)| m.pane == Some(pane)).max_by_key(|(id, _)| **id)?;
        let started = std::time::SystemTime::now().checked_sub(m.started.elapsed()).unwrap_or(std::time::UNIX_EPOCH);
        Some(PaneRun { agent: m.agent, started, wrote: m.last_output.is_some(), alive: !inner.ended.contains(id), home_env: m.home_env.clone(), cwd: m.cwd.clone() })
    }

    /// ACCT-046: the program session `id` actually started.
    pub fn started(&self, id: u32) -> Option<String> {
        self.inner.lock().ok()?.sessions.get(&id).map(|s| s.program().to_string())
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

    /// Council D2 MERGE 31 item 1: the registry lock is held only to find the session's writer; the
    /// write itself (which blocks for as long as the program takes to read, ~12 KB/s into ConPTY)
    /// runs under that writer's own lock, so other panes' ack, resize and kill never wait on it.
    pub fn write(&self, id: u32, data: &str) -> Result<(), String> {
        let writer = self.inner.lock().map_err(|e| e.to_string())?.sessions.get(&id).ok_or("no such terminal")?.writer()?;
        crate::pty::write_shared(&writer, data.as_bytes())
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
                // TERM-132: while a program holds the screen or the mouse the shell is never idle.
                Some(_) if inner.marks.contains_key(&id) || inner.owned.get(&id).is_some_and(|o| *o != 0) => return true,
                Some(s) => s.pid(),
                None => return false,
            },
            Err(_) => return false,
        };
        pid.and_then(crate::procs::has_children).unwrap_or(false)
    }


    /// TERM-116: what Kolux knows about session `id`, as label/value pairs; `None` when it is gone.
    pub fn describe(&self, id: u32) -> Option<Vec<(&'static str, String)>> {
        let inner = self.inner.lock().ok()?;
        let s = inner.sessions.get(&id)?;
        let mut out = vec![("session", id.to_string()), ("pid", s.pid().map_or("unknown".to_string(), |p| p.to_string()))];
        if let Some(d) = inner.dirs.get(&id) {
            out.push(("folder", d.clone()));
        }
        match inner.marks.get(&id) {
            Some(m) => {
                out.push(("program", m.program.clone()));
                out.push(("agent", m.agent.unwrap_or("none").to_string()));
                out.push(("started", format!("{} s ago", m.started.elapsed().as_secs())));
                out.push(("last output", m.last_output.map_or("never".to_string(), |t| format!("{} s ago", t.elapsed().as_secs()))));
            }
            None => out.push(("program", "shell".to_string())),
        }
        let owned = inner.owned.get(&id).copied().unwrap_or(0);
        let screen = match (owned & ALT != 0, owned & MOUSE != 0) {
            (true, true) => "full-screen program with the mouse",
            (true, false) => "full-screen program",
            (false, true) => "program with the mouse",
            (false, false) => "shell",
        };
        out.push(("screen", screen.to_string()));
        out.push(("lines logged", inner.logs.get(&id).map_or(0, |l| l.lines.len()).to_string()));
        out.push(("output paused", inner.flow.get(&id).map_or(0, |f| f.pauses()).to_string()));
        Some(out)
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
        inner.hist.remove(&id);
        if let Some(f) = inner.flow.remove(&id) {
            f.release();
        }
        if let Some(mut s) = inner.sessions.remove(&id) {
            s.kill();
        }
        Ok(())
    }

    /// ACCT-054: the pane drew `bytes` more of session `id`'s output.
    pub fn ack(&self, id: u32, bytes: u64) {
        let flow = self.inner.lock().ok().and_then(|i| i.flow.get(&id).cloned());
        if let Some(f) = flow {
            f.ack(bytes);
        }
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
        // ACCT-050: a shell credits the agent the user started in it by hand.
        inner.sessions.contains_key(&id).then(|| inner.marks.get(&id).and_then(|m| m.agent).or_else(|| crate::foreground::found(id)))
    }

    /// ACCT-050: every shell session (no program of Kolux's own) with its process id and
    /// foreground process group.
    pub fn shells(&self) -> Vec<(u32, Option<u32>, Option<i32>)> {
        let Ok(inner) = self.inner.lock() else { return Vec::new() };
        inner.sessions.iter().filter(|(id, _)| !inner.marks.contains_key(id)).map(|(id, s)| (*id, s.pid(), s.foreground_group())).collect()
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
        ids.into_iter().filter_map(|id| Some((handle_of(id), inner.dirs.get(&id).cloned()?, inner.marks.get(&id).map(|m| m.program.clone())))).collect()
    }

    /// CLI-023 (T-262-c): every open session with the folder it started in and the program it
    /// runs. A plain shell given no folder started in the home folder (as the PTY falls back), and
    /// its program is the shell that actually started (a fallback when the chosen one did not).
    pub fn every(&self) -> Vec<(String, Option<String>, Option<String>)> {
        let home = crate::pty::home_dir().map(|h| h.to_string_lossy().into_owned());
        let Ok(inner) = self.inner.lock() else { return Vec::new() };
        let mut ids: Vec<u32> = inner.sessions.keys().copied().collect();
        ids.sort_unstable();
        ids.into_iter()
            .map(|id| {
                let mark = inner.marks.get(&id);
                let dir = inner.dirs.get(&id).cloned().or_else(|| mark.is_none().then(|| home.clone()).flatten());
                let program = mark.map(|m| m.program.clone()).or_else(|| inner.sessions.get(&id).map(|s| s.program().to_string()));
                (handle_of(id), dir, program)
            })
            .collect()
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
        crate::automations::QUITTING.store(true, std::sync::atomic::Ordering::SeqCst);
        if let Ok(mut inner) = self.inner.lock() {
            inner.dirs.clear();
            inner.keys.clear();
            inner.hist.clear();
            for (_, f) in inner.flow.drain() {
                f.release();
            }
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
    /// ACCT-046: the program the pane actually started (it names a fallback shell).
    pub program: Option<String>,
    pub account: Option<String>,
}

/// TERM-115: async for the same reason as `terminal_write`: starting a console host can take a
/// while on a loaded machine and must not hold the window's thread.
#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn terminal_spawn(app: AppHandle, terminals: tauri::State<'_, Terminals>, store: tauri::State<'_, std::sync::Mutex<crate::state::Store>>, cols: u16, rows: u16, cwd: Option<String>, start: Option<String>, program: Option<String>, args: Option<Vec<String>>, env: Option<Vec<(String, String)>>, pane_key: Option<u32>, account: Option<String>) -> Result<Spawned, String> {
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
    let pinned = resumed.is_some();
    #[allow(clippy::type_complexity)]
    let (env, cap, account, hooks_on, plain): (Vec<(String, String)>, bool, Option<String>, bool, Option<serde_json::Value>) = {
        let store = store.lock().map_err(|e| e.to_string())?;
        let settings = store.settings();
        // SET-026: a plain new terminal opens in the chosen default shell; the search for it on
        // PATH runs after the lock is let go (council), with the settings read here.
        let plain = program.is_none().then(|| settings.clone());
        let used = codex.then(|| account.clone().or_else(|| crate::codex_accounts::active_account(&store).map(|a| a.id))).flatten();
        let codex_home = resumed.or_else(|| crate::codex_accounts::active_home(&store));
        let token = crate::secrets::read_setting(&store, crate::claude_key::TOKEN_FIELD).ok().flatten();
        let key_mode = settings.get(crate::claude_key::MODE_FIELD).and_then(serde_json::Value::as_str) == Some(crate::claude_key::KEY_MODE);
        let env: Vec<(String, String)> = crate::claude_key::pane_env(program.as_deref(), &settings, token)
            .or_else(|| crate::claude_accounts::pane_env(program.as_deref(), key_mode, crate::claude_accounts::active_dir(&store)))
            // ACCT-007: a Codex pane runs in the active Codex account's private home.
            .or_else(|| crate::codex_accounts::pane_env(program.as_deref(), codex_home))
            // ACCT-008: a Grok pane gets the saved xAI key; Grok itself prefers its own sign-in.
            .or_else(|| crate::grok::pane_env(program.as_deref(), crate::secrets::read_setting(&store, crate::grok::KEY_FIELD).ok().flatten()))
            .map(|(k, v)| (k.to_string(), v))
            .into_iter()
            .collect();
        (env, crate::cap::on(&settings), used, crate::hooks::agent_hooks::switch::on(&settings), plain)
    };
    let shell = plain.and_then(|s| crate::pty::default_shell(&s));
    // ACCT-024: on a managed Claude account, the user's own settings may not sign the pane in.
    if env.iter().any(|(k, _)| k == crate::claude_accounts::CONFIG_ENV) {
        let found = crate::claude_accounts::sign_in_overrides(&env_own, cfg!(windows));
        if !found.is_empty() {
            return Err(format!("This Claude pane runs on your managed account, but your Claude settings set {}. Remove those overrides in Settings > Agents and open it again.", found.join(", ")));
        }
    }
    let mut env = env;
    // ACCT-024: a Codex pane waits (about two seconds) for the chosen account's sign-in.
    // ponytail: blocks one async worker while it waits; a timer-based wait if panes queue up.
    if let Some(i) = env.iter().position(|(k, _)| k == crate::codex_accounts::HOME_ENV).filter(|_| !pinned) {
        let active = || store.lock().ok().and_then(|s| crate::codex_accounts::active_home(&s));
        let signed_in = |h: &str| std::path::Path::new(h).join("auth.json").is_file();
        match crate::codex_accounts::ready_home(active, signed_in, crate::codex_accounts::SIGN_IN_WAIT, std::time::Duration::from_millis(100))? {
            Some(home) => env[i].1 = home,
            None => drop(env.remove(i)),
        }
    }
    // USAGE-006: the 200k cap, added at start so the pane's saved start line stays free of it.
    let mut args = args.unwrap_or_default();
    if cap {
        crate::cap::apply(program.as_deref(), &mut args, &mut env, crate::cap::env_set());
    }
    // STAT-008: a managed Codex home gets Kolux's hooks (and their trust) before Codex reads it,
    // unless the status hooks are switched off (STAT-002).
    if let Some((_, home)) = env.iter().find(|(k, _)| k == crate::codex_accounts::HOME_ENV) {
        // ACCT-021: the user's own Codex settings first; a failed copy never stops the launch.
        let user = std::env::var_os("USERPROFILE").or_else(|| std::env::var_os("HOME")).map(std::path::PathBuf::from);
        let own = crate::codex_accounts::user_dir(std::env::var(crate::codex_accounts::HOME_ENV).ok().as_deref(), user.as_deref());
        if let Some(own) = own.filter(|o| o.as_path() != std::path::Path::new(home)) {
            if let Err(e) = crate::codex_accounts::sync_settings(&own, std::path::Path::new(home)) {
                eprintln!("kolux-rs: codex settings: {e}");
            }
        }
        if hooks_on {
            crate::hooks::install_codex_home(std::path::Path::new(home));
        }
    }
    let agent = program.as_deref().and_then(crate::agents::credited_agent);
    let dir = cwd.clone();
    let id = terminals.spawn(app.clone(), cols, rows, cwd, program, args, env_own, env, pane_key, shell)?;
    // AUTO-012: an automation run dispatched to this worktree for this agent is followed here.
    if let Some(dir) = dir {
        crate::automations::follow(&app, |s| crate::automations::claim(s, id, pane_key, &dir, agent));
    }
    Ok(Spawned { id, program: terminals.started(id), account })
}

/// TERM-045: for each id, whether closing it would stop a live program.
#[tauri::command]
pub fn terminal_busy(terminals: tauri::State<'_, Terminals>, ids: Vec<u32>) -> Vec<bool> {
    ids.into_iter().map(|id| terminals.busy(id)).collect()
}

/// TERM-115: async, so a pipe write that blocks (a program not reading its input) holds a
/// runtime worker, never the window's thread; typing elsewhere stays responsive.
#[tauri::command]
pub async fn terminal_write(app: AppHandle, terminals: tauri::State<'_, Terminals>, id: u32, data: String) -> Result<(), String> {
    // STAT-028: Ctrl+C or Escape on its own, while the agent works, marks the coming Stop interrupted.
    if data == "\x03" || data == "\x1b" {
        crate::status::cancel(id);
    }
    // USAGE-007: the user's own typing after a limit stop cancels the resume.
    crate::resume::user_typed(&app, id);
    terminals.write(id, &data)
}


/// TERM-116: a snapshot of one session for a bug report, secrets and the home folder masked.
#[tauri::command]
pub fn terminal_diagnostics(app: AppHandle, terminals: tauri::State<'_, Terminals>, id: u32, cols: u16, rows: u16, renderer: String, screen: Vec<String>) -> Result<String, String> {
    let mut head = terminals.describe(id).ok_or_else(|| format!("terminal {id} is not running"))?;
    head.push(("app", app.package_info().version.to_string()));
    head.push(("size", format!("{cols}x{rows}, {renderer}")));
    let home = std::env::var("USERPROFILE").or_else(|_| std::env::var("HOME")).ok();
    Ok(diagnostics_text(&head, &screen, home.as_deref()))
}

/// Council D2 MERGE 31 item 1: `async` so the registry lock is taken off the main thread; the
/// window keeps drawing while another pane's paste is in flight.
#[tauri::command(async)]
pub fn terminal_resize(terminals: tauri::State<'_, Terminals>, id: u32, cols: u16, rows: u16) -> Result<(), String> {
    terminals.resize(id, cols, rows)
}

/// ACCT-054: the pane drew `bytes` more of session `id`'s output.
/// Council D2 MERGE 31 item 1: `async` for the same reason as `terminal_resize`.
#[tauri::command(async)]
pub fn terminal_ack(terminals: tauri::State<'_, Terminals>, id: u32, bytes: u64) {
    terminals.ack(id, bytes)
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MemoryProfile {
    pub profile: &'static str,
    pub total_mb: u64,
    pub scrollback: u32,
}

/// ACCT-059: the memory profile this machine gets, and the scrollback each pane keeps under it.
#[tauri::command]
pub fn terminal_memory_profile() -> MemoryProfile {
    let total = total_memory();
    let (profile, scrollback) = profile_for(total);
    MemoryProfile { profile, total_mb: total.unwrap_or(0) >> 20, scrollback }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Council D2 MERGE 31 item 1: a pane whose program takes its input slowly (ConPTY reads a
    /// paste at ~12 KB/s) must not hold the registry while the write blocks, or every other
    /// pane's ack, resize and kill wait behind it on the main thread.
    #[test]
    fn merge31_slow_write_to_one_pane_does_not_block_another_panes_bookkeeping() {
        /// A program that takes 600 ms to read whatever it is given.
        struct Slow;
        impl std::io::Write for Slow {
            fn write(&mut self, buf: &[u8]) -> std::io::Result<usize> {
                std::thread::sleep(Duration::from_millis(600));
                Ok(buf.len())
            }
            fn flush(&mut self) -> std::io::Result<()> {
                Ok(())
            }
        }
        let t = Arc::new(Terminals::default());
        {
            let mut inner = t.inner.lock().unwrap();
            inner.sessions.insert(1, PtySession::fake(Box::new(Slow)));
            inner.sessions.insert(2, PtySession::fake(Box::new(std::io::sink())));
            inner.flow.insert(2, Arc::new(Flow::default()));
        }
        let slow = Arc::clone(&t);
        let paste = std::thread::spawn(move || slow.write(1, &"x".repeat(70_000)));
        std::thread::sleep(Duration::from_millis(100));
        let start = Instant::now();
        t.write(2, "y").expect("the other pane's key goes through");
        t.ack(2, 1);
        assert_eq!(t.resize(2, 80, 24), Err("session already closed".to_string()), "a fake has no PTY to resize, but the call returns at once");
        assert!(t.inner.lock().unwrap().sessions.contains_key(&2), "the registry itself is free");
        let waited = start.elapsed();
        assert!(waited < Duration::from_millis(300), "pane 2's bookkeeping waited {waited:?} behind pane 1's 600 ms write");
        paste.join().unwrap().expect("the slow write still completes");
    }

    #[test]
    fn acct_054_a_flood_pauses_the_reader_until_the_pane_acknowledges_and_a_silent_pane_only_for_the_wait() {
        let flow = Arc::new(Flow::default());
        // Below the high mark nothing waits.
        let t = Instant::now();
        flow.sent_within(FLOW_HIGH - 1, Duration::from_secs(5));
        assert!(t.elapsed() < Duration::from_millis(500));
        assert_eq!(flow.pauses(), 0);
        // Over it the reader waits until the pane has drawn down to the low mark.
        let acker = flow.clone();
        let h = std::thread::spawn(move || {
            std::thread::sleep(Duration::from_millis(100));
            acker.ack(FLOW_HIGH);
        });
        let t = Instant::now();
        flow.sent_within(1, Duration::from_secs(5));
        let took = t.elapsed();
        h.join().unwrap();
        assert!(took >= Duration::from_millis(90) && took < Duration::from_secs(4), "{took:?}");
        assert_eq!(flow.pauses(), 1);
        assert_eq!(*flow.unacked.lock().unwrap(), 0);
        // A pane that never answers holds the reader for the wait only, then counts as caught up.
        let t = Instant::now();
        flow.sent_within(FLOW_HIGH, Duration::from_millis(100));
        assert!(t.elapsed() >= Duration::from_millis(90));
        assert_eq!(*flow.unacked.lock().unwrap(), 0);
        assert_eq!(flow.pauses(), 2);
        // release() lets a paused reader go at once.
        let releaser = flow.clone();
        let h = std::thread::spawn(move || {
            std::thread::sleep(Duration::from_millis(50));
            releaser.release();
        });
        let t = Instant::now();
        flow.sent_within(FLOW_HIGH, Duration::from_secs(5));
        h.join().unwrap();
        assert!(t.elapsed() < Duration::from_secs(4));
    }

    #[test]
    fn acct_059_the_memory_profile_scales_with_the_machine_and_is_the_same_for_the_same_machine() {
        const GIB: u64 = 1 << 30;
        assert_eq!(profile_for(Some(4 * GIB)), ("small", 2000));
        assert_eq!(profile_for(Some(8 * GIB)), ("medium", 5000));
        assert_eq!(profile_for(Some(15 * GIB)), ("medium", 5000));
        assert_eq!(profile_for(Some(16 * GIB)), ("large", 10000));
        assert_eq!(profile_for(Some(64 * GIB)), ("large", 10000));
        assert_eq!(profile_for(None), ("medium", 5000));
        assert!(profile_for(Some(4 * GIB)).1 < profile_for(Some(64 * GIB)).1);
        assert_eq!(profile_for(total_memory()), profile_for(total_memory()));
    }

    #[test]
    fn term_106_saved_output_keeps_the_newest_lines_within_the_cap_and_prunes_only_known_keys() {
        let dir = std::env::temp_dir().join(format!("kolux-rs-t068-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        let mut h = History::open(&dir, 7).expect("history folder");
        let line = vec![b'x'; 1023];
        for _ in 0..300 {
            h.append(&line);
            h.append(b"\n");
        }
        let bytes = std::fs::read(history_file(&dir, 7)).unwrap();
        assert!(bytes.len() as u64 <= HISTORY_CAP, "capped: {}", bytes.len());
        assert!(bytes.len() >= HISTORY_KEEP / 2, "kept the newest half: {}", bytes.len());
        assert!(bytes.ends_with(b"xxx\n"));
        // The cut lands on a line boundary, never inside an escape sequence.
        assert_eq!(bytes[0], b'x');
        assert_eq!(trim_history(b"ab\ncd\nef", 4), b"ef");
        assert_eq!(trim_history(b"abc", 10), b"abc");
        // Panes gone from the layout lose their saved output; a name that is not a pane key and an
        // empty keep-list (the layout could not be read) prune nothing.
        std::fs::write(history_file(&dir, 8), b"old").unwrap();
        std::fs::write(dir.join("history").join("notes.log"), b"keep").unwrap();
        prune_history(&dir, &[]);
        assert!(history_file(&dir, 8).exists());
        prune_history(&dir, &[7]);
        assert!(!history_file(&dir, 8).exists());
        assert!(history_file(&dir, 7).exists());
        assert!(dir.join("history").join("notes.log").exists());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn term_132_a_program_that_takes_the_screen_or_the_mouse_owns_the_pane_until_it_gives_it_back() {
        // vim enters the alternate screen; the shell is not idle until vim leaves it.
        let on = screen_owner(0, b"\x1b[?1049h\x1b[22;0;0t\x1b[?1h\x1b=");
        assert_eq!(on, ALT);
        assert_eq!(screen_owner(on, b"some drawing"), ALT);
        assert_eq!(screen_owner(on, b"\x1b[?1049l\x1b[23;0;0t"), 0);
        // less uses the older 47/1047 pair; a mouse capture counts on its own.
        assert_eq!(screen_owner(0, b"\x1b[?47h"), ALT);
        assert_eq!(screen_owner(ALT, b"\x1b[?1047l"), 0);
        assert_eq!(screen_owner(0, b"\x1b[?1000h\x1b[?1006h"), MOUSE);
        assert_eq!(screen_owner(ALT | MOUSE, b"\x1b[?1000l"), ALT);
        // The last word in a chunk wins: enter then leave in one burst is free again.
        assert_eq!(screen_owner(0, b"\x1b[?1049h...\x1b[?1049l$ "), 0);
    }

    #[test]
    fn term_116_diagnostics_carry_no_token_and_no_home_path() {
        let text = diagnostics_text(
            &[("session", "7".to_string()), ("folder", r"C:\Users\pat\code\app".to_string())],
            &["$ curl -H 'Authorization: Bearer sk-live-1234567890abcdef' https://api.example.com".to_string(), r"C:\Users\pat\code\app> ".to_string()],
            Some(r"C:\Users\pat"),
        );
        assert!(!text.contains("sk-live-1234567890abcdef"), "{text}");
        assert!(!text.contains(r"C:\Users\pat"), "{text}");
        assert!(text.contains("folder: ~\\code\\app"), "{text}");
        assert!(text.contains("~\\code\\app> "), "{text}");
        assert!(text.contains("session: 7"), "{text}");
    }

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
        let s = PtySession::spawn(shell_commands(Some(&dir.to_string_lossy()), None).remove(0), 80, 24, |_| {}, |_| {}).expect("spawn a shell in the folder");
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

    /// T-262-c (CLI-023): a plain shell given no folder lists the home folder it started in and
    /// the shell program that started; the CLI-017 session list keeps leaving it out.
    #[test]
    fn t262c_a_plain_shell_lists_its_start_folder_and_program() {
        let t = Terminals::default();
        let mut cmd = shell_commands(None, None);
        let s = PtySession::spawn(cmd.remove(0), 80, 24, |_| {}, |_| {}).expect("spawn a shell");
        let started = s.program().to_string();
        t.inner.lock().unwrap().sessions.insert(7, s);
        let every = t.every();
        let home = crate::pty::home_dir().map(|h| h.to_string_lossy().into_owned());
        assert!(home.is_some(), "this account has a home folder");
        assert_eq!(every, vec![(handle_of(7), home, Some(started))]);
        assert!(t.sessions().is_empty(), "a shell with no folder is not a worktree session");
        t.inner.lock().unwrap().sessions.remove(&7).unwrap().kill();
    }

    #[test]
    fn only_agent_panes_have_git_prompts_turned_off() {
        let mut agent = crate::pty::program_command("claude", &[], None);
        unattended(&mut agent, true);
        assert_eq!(agent.get_env("GIT_TERMINAL_PROMPT").and_then(|v| v.to_str()), Some("0"));
        assert_eq!(agent.get_env("GCM_INTERACTIVE").and_then(|v| v.to_str()), Some("never"));
        let mut shell = crate::pty::shell_commands(None, None).remove(0);
        let before = shell.get_env("GIT_TERMINAL_PROMPT").map(|v| v.to_os_string());
        unattended(&mut shell, false);
        assert_eq!(shell.get_env("GIT_TERMINAL_PROMPT").map(|v| v.to_os_string()), before, "a shell still prompts");
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

/// TERM-106: what pane `pane_key` printed before the last restart, base64 (empty when nothing was saved).
#[tauri::command]
pub fn terminal_history(app: AppHandle, pane_key: u32) -> Result<String, String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let bytes = std::fs::read(history_file(&dir, pane_key)).unwrap_or_default();
    Ok(base64::engine::general_purpose::STANDARD.encode(trim_history(&bytes, HISTORY_KEEP)))
}

/// TERM-106: a tab closed on purpose is not brought back, so its saved output goes with it.
#[tauri::command]
pub fn terminal_forget_history(app: AppHandle, pane_key: u32) -> Result<(), String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let _ = std::fs::remove_file(history_file(&dir, pane_key));
    Ok(())
}

/// TERM-106: after a start, the saved output of panes no longer in the layout is removed in the background.
#[tauri::command]
pub fn terminal_prune_history(app: AppHandle, keep: Vec<u32>) -> Result<(), String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    std::thread::spawn(move || prune_history(&dir, &keep));
    Ok(())
}

/// TERM-106: what the pane itself wrote around the replay (the reset, the note, the push) goes into
/// the file too, so the file stays a transcript of what the terminal processed and replays true.
#[tauri::command]
pub fn terminal_history_append(app: AppHandle, pane_key: u32, data: String) -> Result<(), String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let bytes = base64::engine::general_purpose::STANDARD.decode(data).map_err(|e| e.to_string())?;
    if let Some(mut h) = History::open(&dir, pane_key) {
        h.append(&bytes);
    }
    Ok(())
}
