//! T-182: the app's life on the desktop.
//! APP-001: one copy runs. The first copy holds a named mutex for its whole life; a second launch
//! finds the running copy through its startup file, grants it foreground rights, asks it over the
//! command-line port to come to the front, raises its window itself as a second road, and ends
//! with `DUPLICATE_EXIT`, never zero.
//! APP-002: the terminals run in this process (no separate service to wait on); the window's own
//! fallback show at 5 s stays in lib.rs (SET-004), so nothing at startup can keep it hidden.
//! APP-006: the page decides whether a close needs confirming (unsaved editor text, running
//! agents); it tells this side it is alive as soon as the request reaches it. A page that says
//! nothing within `ASK_LIMIT` is gone or frozen past help, and the window is closed for it. Once
//! the main window is gone the quit has a hard deadline (`QUIT_HARD_LIMIT`): the final save and the
//! WebView2 wait get their turn, and then the process ends whatever is still hanging.
//! APP-011: a restart (plain, or to update) goes ahead only after a durable save point: the same
//! steps as the quit's final save, and a step that failed or timed out cancels the restart.
//! APP-020: a pane's search path takes in entries the stored user and system Path gained since the
//! app started, after what the process already had, nothing dropped or repeated.
//!
//! Until evidence/shell-T-182-lib.rs.patch lands lib.rs only declares this module; the patch wires
//! it in and removes the next line.
#![allow(dead_code)]

use serde_json::{json, Value};
use std::ffi::{OsStr, OsString};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;
use std::time::Duration;
use tauri::Manager;

use crate::final_save;
use crate::state::Store;
use crate::terminal::Terminals;

// ---------------------------------------------------------------- APP-001: one copy

/// The exit code of a launch that found Kolux already running (never zero: the launcher can tell).
pub const DUPLICATE_EXIT: i32 = 3;

/// How long a second launch waits for the running copy's startup file (the copy may itself be
/// starting), between tries; about six seconds in all.
pub const FORWARD_WAITS_MS: [u64; 6] = [0, 250, 500, 1000, 2000, 2000];

/// How long the running copy may take to answer the come-to-front request.
pub const FORWARD_ANSWER: Duration = Duration::from_secs(5);

/// How many times, 150 ms apart, the window is asked to come forward when the system refuses.
pub const RAISE_TRIES: usize = 5;
pub const RAISE_WAIT: Duration = Duration::from_millis(150);

/// The first copy's claim: the named mutex, held until this is dropped (the app keeps it in its
/// managed state, so for the life of the process).
pub struct Instance {
    #[cfg(windows)]
    handle: isize,
}

// SAFETY: the handle is an opaque kernel object identifier; closing it from any thread is fine.
unsafe impl Send for Instance {}
unsafe impl Sync for Instance {}

impl Drop for Instance {
    fn drop(&mut self) {
        #[cfg(windows)]
        if self.handle != 0 {
            // SAFETY: the handle came from CreateMutexW and is closed exactly once here.
            unsafe {
                windows_sys::Win32::Foundation::CloseHandle(self.handle as windows_sys::Win32::Foundation::HANDLE);
            }
        }
    }
}

pub enum Claim {
    First(Instance),
    Second,
}

/// The mutex name for this build: per identifier, so a lane or trial build never blocks the
/// installed app, and in the session-local namespace (one user's desktop).
pub fn mutex_name(identifier: &str) -> String {
    format!("Local\\{identifier}.instance")
}

pub fn claim(identifier: &str) -> Claim {
    claim_named(&mutex_name(identifier))
}

/// Claims `name`. A claim the system refuses outright (no handle at all) counts as first: a fault
/// in the mutex must never keep the only copy from starting.
#[cfg(windows)]
pub fn claim_named(name: &str) -> Claim {
    use windows_sys::Win32::Foundation::{CloseHandle, GetLastError, ERROR_ALREADY_EXISTS};
    use windows_sys::Win32::System::Threading::CreateMutexW;
    let wide: Vec<u16> = name.encode_utf16().chain(std::iter::once(0)).collect();
    // SAFETY: the name is NUL-terminated and outlives the call; a null handle is checked before use.
    unsafe {
        let handle = CreateMutexW(std::ptr::null(), 0, wide.as_ptr());
        if handle.is_null() {
            return Claim::First(Instance { handle: 0 });
        }
        if GetLastError() == ERROR_ALREADY_EXISTS {
            CloseHandle(handle);
            return Claim::Second;
        }
        Claim::First(Instance { handle: handle as isize })
    }
}

#[cfg(not(windows))]
pub fn claim_named(_name: &str) -> Claim {
    Claim::First(Instance {})
}

/// What the startup file says about the running copy.
#[derive(Debug, PartialEq, Eq)]
pub struct Running {
    pub port: u16,
    pub token: String,
    pub pid: Option<u32>,
}

/// The running copy from the startup file's text (`cli.json`: port, token, pid). Anything short
/// of a port and a token is nothing to forward to.
pub fn running_from(text: &str) -> Option<Running> {
    let v: Value = serde_json::from_str(text).ok()?;
    let port = v["port"].as_u64().and_then(|p| u16::try_from(p).ok())?;
    let token = v["token"].as_str()?.to_string();
    Some(Running { port, token, pid: v["pid"].as_u64().and_then(|p| u32::try_from(p).ok()) })
}

pub fn read_running(dir: &Path) -> Option<Running> {
    std::fs::read_to_string(dir.join(crate::cli::FILE)).ok().and_then(|t| running_from(&t))
}

/// Waits for the running copy's startup file, trying once per entry of `waits` (sleeping that
/// long first), and gives up when the waits are spent.
pub fn wait_running(dir: &Path, waits: &[u64], mut sleep: impl FnMut(Duration)) -> Option<Running> {
    for ms in waits {
        if *ms > 0 {
            sleep(Duration::from_millis(*ms));
        }
        if let Some(r) = read_running(dir) {
            return Some(r);
        }
    }
    None
}

/// Lets `pid` take the foreground: a process the user just started has that right and may pass
/// it on, so the running copy's window really comes forward instead of flashing in the taskbar.
pub fn allow_foreground(pid: u32) {
    #[cfg(windows)]
    // SAFETY: a plain call with a process id; failure only means the window may flash.
    unsafe {
        windows_sys::Win32::UI::WindowsAndMessaging::AllowSetForegroundWindow(pid);
    }
    #[cfg(not(windows))]
    let _ = pid;
}

/// The visible top-level windows `pid` owns (a minimised window counts as visible).
#[cfg(windows)]
pub fn windows_of(pid: u32) -> Vec<isize> {
    use windows_sys::Win32::Foundation::{HWND, LPARAM};
    use windows_sys::Win32::UI::WindowsAndMessaging::{EnumWindows, GetWindowThreadProcessId, IsWindowVisible};
    unsafe extern "system" fn each(hwnd: HWND, lparam: LPARAM) -> i32 {
        // SAFETY: lparam is the pointer to `state` below, alive for the whole enumeration.
        let state = unsafe { &mut *(lparam as *mut (u32, Vec<isize>)) };
        let mut owner = 0u32;
        // SAFETY: plain window queries on a handle the system just handed over.
        unsafe {
            GetWindowThreadProcessId(hwnd, &mut owner);
            if owner == state.0 && IsWindowVisible(hwnd) != 0 {
                state.1.push(hwnd as isize);
            }
        }
        1
    }
    let mut state: (u32, Vec<isize>) = (pid, Vec::new());
    // SAFETY: the callback only reads `state` through the pointer, which outlives the call.
    unsafe {
        EnumWindows(Some(each), &mut state as *mut _ as LPARAM);
    }
    state.1
}

/// Restores and focuses the running copy's window by its process id, retrying briefly when the
/// system refuses to bring it forward. True once it is the foreground window.
#[cfg(windows)]
pub fn raise_by_pid(pid: u32, tries: usize, mut sleep: impl FnMut(Duration)) -> bool {
    use windows_sys::Win32::Foundation::HWND;
    use windows_sys::Win32::UI::WindowsAndMessaging::{GetForegroundWindow, IsIconic, SetForegroundWindow, ShowWindow, SW_RESTORE};
    for i in 0..tries {
        if i > 0 {
            sleep(RAISE_WAIT);
        }
        for h in windows_of(pid) {
            let hwnd = h as HWND;
            // SAFETY: plain window calls on handles enumerated a moment ago; a stale one just fails.
            unsafe {
                if IsIconic(hwnd) != 0 {
                    ShowWindow(hwnd, SW_RESTORE);
                }
                SetForegroundWindow(hwnd);
                if GetForegroundWindow() == hwnd {
                    return true;
                }
            }
        }
    }
    false
}

#[cfg(not(windows))]
pub fn raise_by_pid(_pid: u32, _tries: usize, _sleep: impl FnMut(Duration)) -> bool {
    false
}

/// What a second launch did for the running copy.
#[derive(Debug, Default, PartialEq, Eq)]
pub struct Forwarded {
    /// The running copy's startup file was found.
    pub found: bool,
    /// The running copy answered the come-to-front request.
    pub answered: bool,
    /// This launch itself got the window to the foreground.
    pub raised: bool,
}

impl Forwarded {
    pub fn line(&self) -> String {
        match (self.found, self.answered, self.raised) {
            (false, _, _) => "second launch: the running copy's startup file never appeared; exiting (APP-001)".into(),
            (true, a, r) => format!("second launch: forwarded to the running copy (answered: {a}, raised: {r}); exiting (APP-001)"),
        }
    }
}

/// The whole second-launch road: wait for the running copy's startup file, grant it the
/// foreground, ask it to come to the front, and raise its window as well.
pub fn forward_to(dir: &Path) -> Forwarded {
    let Some(running) = wait_running(dir, &FORWARD_WAITS_MS, std::thread::sleep) else { return Forwarded::default() };
    if let Some(pid) = running.pid {
        allow_foreground(pid);
    }
    let req = crate::cli::Request {
        id: format!("open-{}", std::process::id()),
        token: running.token.clone(),
        command: "app.open".into(),
        cwd: std::env::current_dir().map(|d| d.to_string_lossy().into_owned()).unwrap_or_default(),
        args: json!({}),
        pane: None,
        cli: env!("CARGO_PKG_VERSION").into(),
        arrived: None,
    };
    let answered = crate::cli::call_within(running.port, &req, FORWARD_ANSWER).is_ok();
    let raised = running.pid.is_some_and(|pid| raise_by_pid(pid, RAISE_TRIES, std::thread::sleep));
    Forwarded { found: true, answered, raised }
}

/// Called first thing in setup, before any window exists: the first copy keeps its claim in the
/// app's managed state; a second launch forwards and ends with `DUPLICATE_EXIT`.
pub fn claim_or_forward<R: tauri::Runtime>(app: &tauri::App<R>) {
    match claim(&app.config().identifier) {
        Claim::First(instance) => {
            app.manage(instance);
        }
        Claim::Second => {
            if let Ok(dir) = app.path().app_data_dir() {
                let did = forward_to(&dir);
                crate::diag::write(&dir, &did.line());
            }
            std::process::exit(DUPLICATE_EXIT);
        }
    }
}

// ---------------------------------------------------------------- APP-006: closing and quitting

/// How long the page has to say it is alive after a close request before the window is closed
/// for it (a dead or crashed page would otherwise keep the app open forever).
pub const ASK_LIMIT: Duration = Duration::from_secs(10);

/// Once the main window is gone, the process ends by this deadline whatever still hangs.
pub const QUIT_HARD_LIMIT: Duration = Duration::from_secs(15);

/// The quit's hard deadline: enough for the final save and the WebView2 wait with room to spare.
pub fn quit_deadline() -> Duration {
    QUIT_HARD_LIMIT.max(final_save::QUIT_DEADLINE + crate::tools::WEBVIEW_EXIT_WAIT + Duration::from_secs(2))
}

/// Close requests so far, and the latest one the page answered.
static CLOSE_SEQ: AtomicU64 = AtomicU64::new(0);
static ALIVE_SEQ: AtomicU64 = AtomicU64::new(0);

/// A new close request's number.
pub fn close_next() -> u64 {
    CLOSE_SEQ.fetch_add(1, Ordering::SeqCst) + 1
}

/// The page answered: every request up to the latest counts as answered.
pub fn mark_alive() {
    ALIVE_SEQ.store(CLOSE_SEQ.load(Ordering::SeqCst), Ordering::SeqCst);
}

pub fn answered(seq: u64) -> bool {
    ALIVE_SEQ.load(Ordering::SeqCst) >= seq
}

#[derive(Debug, PartialEq, Eq)]
pub enum Verdict {
    /// The window is already gone: nothing to do.
    Nothing,
    /// The page answered; it is asking or has decided. The window stays.
    Stay,
    /// Nothing from the page within the limit: it is gone or frozen; close for it.
    Destroy,
}

/// After `ASK_LIMIT`: what the watchdog does with a window still open.
pub fn close_verdict(answered: bool, window_gone: bool) -> Verdict {
    if window_gone {
        Verdict::Nothing
    } else if answered {
        Verdict::Stay
    } else {
        Verdict::Destroy
    }
}

/// A close request reached the main window: the page gets it (Tauri forwards the event to the
/// page's own listener), and a watchdog closes the window for a page that never answers.
pub fn close_requested<R: tauri::Runtime>(window: &tauri::Window<R>) {
    let seq = close_next();
    let app = window.app_handle().clone();
    std::thread::spawn(move || {
        std::thread::sleep(ASK_LIMIT);
        let main = app.get_webview_window("main");
        if close_verdict(answered(seq), main.is_none()) == Verdict::Destroy {
            if let Ok(dir) = app.path().app_data_dir() {
                crate::diag::write(&dir, &format!("close: the page did not answer within {} s; closing the window for it (APP-006)", ASK_LIMIT.as_secs()));
            }
            if let Some(w) = main {
                let _ = w.destroy();
            }
        }
    });
}

/// The page's word that it received the close request and is deciding (or asking).
#[tauri::command]
pub fn close_alive() {
    mark_alive();
}

/// The main window is gone (Windows, Linux): the quit is under way, and ends by the deadline
/// however the final save or the WebView2 wait behave.
pub fn quit_watchdog<R: tauri::Runtime>(app: &tauri::AppHandle<R>) {
    if cfg!(target_os = "macos") {
        return;
    }
    let dir = app.path().app_data_dir().ok();
    std::thread::spawn(move || {
        std::thread::sleep(quit_deadline());
        if let Some(dir) = dir {
            crate::diag::write(&dir, &format!("quit: still running {} s after the window closed; exiting now (APP-006)", quit_deadline().as_secs()));
        }
        std::process::exit(0);
    });
}

// ---------------------------------------------------------------- APP-011: the save point

/// The final save's steps (T-075 / APP-050), shared by the quit and the restart's save point:
/// the activity counts, the agents mid-task, sign-ins cancelled, and the renewed sign-ins sealed.
pub fn quit_steps(app: &tauri::AppHandle) -> Vec<final_save::Step> {
    let seal = |app: tauri::AppHandle, files: fn(&Store, &Path) -> Vec<(PathBuf, PathBuf)>| {
        move || {
            if let (Ok(profile), Ok(store)) = (app.path().app_data_dir(), app.state::<Mutex<Store>>().lock()) {
                let pairs = files(&store, &profile);
                drop(store);
                let _ = crate::secrets::save_changed(&pairs, &profile);
            }
        }
    };
    let (a1, a2) = (app.clone(), app.clone());
    vec![
        // USAGE-011: open turns end and the counts are written; no batched save follows.
        final_save::step("activity counts", move || crate::activity::save(&a1.state::<Mutex<Store>>(), true)),
        // STAT-037: the agents still mid-task are recorded before their terminals end.
        final_save::step("agent status", move || {
            if let Ok(store) = a2.state::<Mutex<Store>>().lock() {
                crate::hooks::agent_hooks::saved::at_quit(&store);
            }
        }),
        // ACCT-015: no sign-in or install keeps running after Kolux quits.
        final_save::step("sign-ins cancelled", || {
            crate::claude_key::cancel_all(Duration::from_secs(2));
        }),
        // ACCT-025: sign-ins the agents renewed are sealed again, Codex's then Claude's.
        final_save::step("codex sign-in sealed", seal(app.clone(), crate::codex_accounts::sign_in_files)),
        final_save::step("claude sign-in sealed", seal(app.clone(), crate::claude_accounts::sign_in_files)),
    ]
}

/// Whether a teardown (restart, restart to update, reload) may go ahead after the save point
/// `report`: a step that failed or timed out cancels it; with the snapshot short (`snapshot_ok`
/// false) the last durable save stands, unless unsaved editor drafts would be lost.
pub fn restart_allowed(report: &final_save::Report, snapshot_ok: bool, unsaved_drafts: usize) -> Result<(), String> {
    let short: Vec<&str> = report.failed.iter().chain(report.timed_out.iter()).copied().collect();
    if !short.is_empty() {
        return Err(format!("The restart was cancelled: the save point did not finish ({}). Nothing was changed.", short.join(", ")));
    }
    if !snapshot_ok && unsaved_drafts > 0 {
        return Err(format!(
            "The restart was cancelled: the current state could not be saved and {} unsaved {} would be lost. The drafts stay where they are.",
            unsaved_drafts,
            if unsaved_drafts == 1 { "draft" } else { "drafts" }
        ));
    }
    Ok(())
}

/// Runs the save point and says whether the teardown may go ahead.
pub fn save_point(app: &tauri::AppHandle, unsaved_drafts: usize) -> Result<final_save::Report, String> {
    let report = final_save::run(final_save::QUIT_DEADLINE, quit_steps(app));
    if let Ok(dir) = app.path().app_data_dir() {
        crate::diag::write(&dir, &format!("save point: {} (APP-011)", report.line()));
    }
    restart_allowed(&report, true, unsaved_drafts).map(|()| report)
}

/// Restart Kolux: the page flushes its pending layout write first and says how many editor drafts
/// are unsaved; the save point runs; a save point that falls short refuses the restart and nothing
/// changes. Otherwise the shells end and the app starts again.
#[tauri::command]
pub fn app_restart(app: tauri::AppHandle, unsaved: Option<usize>) -> Result<(), String> {
    save_point(&app, unsaved.unwrap_or(0))?;
    final_save::begin();
    app.state::<Terminals>().kill_all();
    app.restart();
}

// ---------------------------------------------------------------- APP-020: the search path

/// `current`'s entries in order, then every entry of `stored` (the user's and system's stored
/// Path, read now) that is not already there: a tool installed since the app started is found
/// without a restart, and nothing the process had is dropped or moved.
pub fn merged_path(current: Option<&OsStr>, stored: &[String]) -> OsString {
    let key = |p: &Path| p.to_string_lossy().trim_end_matches(['\\', '/']).to_lowercase();
    let mut out: Vec<PathBuf> = current.map(|p| std::env::split_paths(p).collect()).unwrap_or_default();
    let mut seen: std::collections::HashSet<String> = out.iter().map(|p| key(p)).collect();
    for entry in stored.iter().flat_map(|s| std::env::split_paths(s).collect::<Vec<_>>()) {
        if entry.as_os_str().is_empty() {
            continue;
        }
        if seen.insert(key(&entry)) {
            out.push(entry);
        }
    }
    std::env::join_paths(out).unwrap_or_else(|_| current.map(OsStr::to_os_string).unwrap_or_default())
}

/// Windows: the system Path then the user Path as stored now (expanded). Elsewhere: nothing.
pub fn stored_paths() -> Vec<String> {
    #[cfg(windows)]
    {
        use windows_sys::Win32::System::Registry::{HKEY_CURRENT_USER, HKEY_LOCAL_MACHINE};
        return [(HKEY_LOCAL_MACHINE, r"SYSTEM\CurrentControlSet\Control\Session Manager\Environment"), (HKEY_CURRENT_USER, "Environment")]
            .into_iter()
            .filter_map(|(root, key)| registry_string(root, key, "Path"))
            .collect();
    }
    #[allow(unreachable_code)]
    Vec::new()
}

/// A pane's PATH: what the process has, then whatever the stored Path gained since.
pub fn fresh_path(current: Option<OsString>) -> OsString {
    merged_path(current.as_deref(), &stored_paths())
}

/// A registry string value, expanded; None when missing, not a string, or unreadable.
#[cfg(windows)]
fn registry_string(root: windows_sys::Win32::System::Registry::HKEY, subkey: &str, value: &str) -> Option<String> {
    use windows_sys::Win32::Foundation::ERROR_MORE_DATA;
    use windows_sys::Win32::System::Registry::{RegGetValueW, RRF_RT_REG_SZ};
    let wide = |s: &str| s.encode_utf16().chain(std::iter::once(0)).collect::<Vec<u16>>();
    let (key, name) = (wide(subkey), wide(value));
    let mut bytes: u32 = 0;
    // SAFETY: the strings are NUL-terminated and outlive the calls; the first call asks the size,
    // the second fills a buffer of that size, retried once if the expanded value grew (ERROR_MORE_DATA).
    unsafe {
        let ask = |buf: *mut u16, bytes: &mut u32| RegGetValueW(root, key.as_ptr(), name.as_ptr(), RRF_RT_REG_SZ, std::ptr::null_mut(), buf.cast(), bytes);
        if ask(std::ptr::null_mut(), &mut bytes) != 0 {
            return None;
        }
        let mut buf = vec![0u16; bytes as usize / 2 + 1];
        let mut got = (buf.len() * 2) as u32;
        let mut status = ask(buf.as_mut_ptr(), &mut got);
        if status == ERROR_MORE_DATA {
            buf = vec![0u16; got as usize / 2 + 1];
            got = (buf.len() * 2) as u32;
            status = ask(buf.as_mut_ptr(), &mut got);
        }
        if status != 0 {
            return None;
        }
        let len = buf.iter().position(|&c| c == 0).unwrap_or(buf.len());
        Some(String::from_utf16_lossy(&buf[..len]))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp(name: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("kolux-rs-lifecycle-{}-{name}", std::process::id()));
        let _ = std::fs::remove_dir_all(&d);
        std::fs::create_dir_all(&d).unwrap();
        d
    }

    #[test]
    fn app001_the_duplicate_exit_code_is_never_zero_and_the_name_carries_the_identifier() {
        assert_ne!(DUPLICATE_EXIT, 0);
        assert_eq!(mutex_name("com.txaisxiong.kolux-rs.shell"), "Local\\com.txaisxiong.kolux-rs.shell.instance");
        assert_ne!(mutex_name("a"), mutex_name("b"), "a lane build never blocks the installed app");
    }

    #[cfg(windows)]
    #[test]
    fn app001_a_second_claim_is_refused_until_the_first_copy_lets_go() {
        let name = format!("Local\\kolux-rs-test-{}.instance", std::process::id());
        let first = match claim_named(&name) {
            Claim::First(i) => i,
            Claim::Second => panic!("the first claim must win"),
        };
        assert!(matches!(claim_named(&name), Claim::Second), "a second launch is told the app runs");
        drop(first);
        assert!(matches!(claim_named(&name), Claim::First(_)), "after the first copy ends the name is free again");
    }

    #[test]
    fn app001_the_running_copy_is_read_from_the_startup_file() {
        assert_eq!(running_from(r#"{"port":1425,"token":"t","pid":42}"#), Some(Running { port: 1425, token: "t".into(), pid: Some(42) }));
        assert_eq!(running_from(r#"{"port":1425,"token":"t"}"#), Some(Running { port: 1425, token: "t".into(), pid: None }), "an older file without a pid still forwards");
        assert_eq!(running_from(r#"{"port":1425}"#), None, "no token: nothing to forward to");
        assert_eq!(running_from("not json"), None);
        assert_eq!(running_from(r#"{"port":70000,"token":"t"}"#), None, "a port that fits no socket");
    }

    #[test]
    fn app001_the_forward_waits_for_a_starting_copy_then_gives_up() {
        let dir = temp("forward");
        let mut slept = Vec::new();
        assert_eq!(wait_running(&dir, &[0, 10, 20], |d| slept.push(d.as_millis())), None);
        assert_eq!(slept, vec![10, 20], "every wait is spent before giving up");
        let file = dir.join(crate::cli::FILE);
        let mut tries = 0;
        let got = wait_running(&dir, &[0, 10, 20, 40], |_| {
            tries += 1;
            if tries == 2 {
                std::fs::write(&file, r#"{"port":1425,"token":"tok","pid":7}"#).unwrap();
            }
        });
        assert_eq!(got.map(|r| r.pid), Some(Some(7)), "the file written mid-wait is found on the next try");
        assert_eq!(tries, 2, "found: no further waits");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn app001_forwarded_lines_say_what_happened() {
        assert!(Forwarded::default().line().contains("never appeared"));
        assert!(Forwarded { found: true, answered: true, raised: false }.line().contains("answered: true, raised: false"));
    }

    #[cfg(windows)]
    #[test]
    fn app001_a_process_with_no_window_is_not_raised() {
        // A pid nobody owns: enumeration finds nothing and every try is spent.
        let mut waits = 0;
        assert!(!raise_by_pid(u32::MAX - 7, 3, |_| waits += 1));
        assert_eq!(waits, 2);
    }

    #[test]
    fn app006_a_silent_page_is_closed_for_and_an_answering_one_stays() {
        assert_eq!(close_verdict(false, false), Verdict::Destroy, "a frozen or crashed page cannot hold the window open");
        assert_eq!(close_verdict(true, false), Verdict::Stay, "the page is asking: the user decides");
        assert_eq!(close_verdict(false, true), Verdict::Nothing, "already closed by the page itself");
        assert_eq!(close_verdict(true, true), Verdict::Nothing);
    }

    #[test]
    fn app006_the_page_answers_the_latest_request() {
        let a = close_next();
        assert!(!answered(a), "nothing yet");
        mark_alive();
        assert!(answered(a));
        let b = close_next();
        assert!(!answered(b), "a new request needs its own answer");
        assert!(answered(a));
        mark_alive();
        assert!(answered(b));
    }

    #[test]
    fn app006_the_quit_deadline_covers_the_final_save_and_the_webview_wait() {
        let d = quit_deadline();
        assert!(d > final_save::QUIT_DEADLINE + crate::tools::WEBVIEW_EXIT_WAIT, "{d:?}");
        assert!(d <= Duration::from_secs(20), "a quit that takes longer than this is a hang: {d:?}");
        assert!(ASK_LIMIT < d);
    }

    #[test]
    fn app011_a_restart_goes_ahead_only_after_a_whole_save_point() {
        let ok = final_save::Report { finished: vec!["activity counts", "agent status"], ..Default::default() };
        assert_eq!(restart_allowed(&ok, true, 3), Ok(()), "all saved: unsaved drafts are on disk already (EDIT-004)");
        let failed = final_save::Report { finished: vec!["activity counts"], failed: vec!["agent status"], ..Default::default() };
        let err = restart_allowed(&failed, true, 0).unwrap_err();
        assert!(err.contains("cancelled") && err.contains("agent status") && err.contains("Nothing was changed"), "{err}");
        let slow = final_save::Report { timed_out: vec!["codex sign-in sealed"], ..Default::default() };
        assert!(restart_allowed(&slow, true, 0).unwrap_err().contains("codex sign-in sealed"), "a stalled step is as good as a failed one");
        assert_eq!(restart_allowed(&ok, false, 0), Ok(()), "snapshot short, nothing unsaved: the last durable save stands");
        let err = restart_allowed(&ok, false, 2).unwrap_err();
        assert!(err.contains("2 unsaved drafts") && err.contains("stay where they are"), "{err}");
        assert!(restart_allowed(&ok, false, 1).unwrap_err().contains("1 unsaved draft would"));
    }

    #[cfg(windows)]
    #[test]
    fn app020_entries_the_stored_path_gained_since_start_are_added_after_what_the_process_had() {
        let current = OsString::from("C:\\first;C:\\Users\\me\\.cargo\\bin;C:\\Windows");
        let stored = vec!["C:\\Windows;C:\\Program Files\\NewTool\\".to_string(), "c:\\users\\me\\.cargo\\bin;C:\\Users\\me\\AppData\\Local\\Programs\\agent;".to_string()];
        let merged = merged_path(Some(current.as_os_str()), &stored);
        let got: Vec<String> = std::env::split_paths(&merged).map(|p| p.to_string_lossy().into_owned()).collect();
        assert_eq!(got, ["C:\\first", "C:\\Users\\me\\.cargo\\bin", "C:\\Windows", "C:\\Program Files\\NewTool\\", "C:\\Users\\me\\AppData\\Local\\Programs\\agent"]);
        assert_eq!(merged_path(None, &["C:\\only".into()]), OsString::from("C:\\only"), "no process PATH at all: the stored one alone");
        assert_eq!(merged_path(Some(current.as_os_str()), &[]), current, "nothing stored: unchanged");
    }

    #[cfg(windows)]
    #[test]
    fn app020_the_stored_path_is_read_from_the_registry() {
        let stored = stored_paths();
        assert_eq!(stored.len(), 2, "the system Path and the user Path");
        assert!(stored[0].to_lowercase().contains("windows"), "{}", stored[0]);
    }
}
