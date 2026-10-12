//! ACCT-004: Claude connects once with a key that lasts a year.
//!
//! Kolux runs Claude Code's own `claude setup-token` out of sight (a hidden pseudo-terminal, so
//! no console window, never through the classic command prompt), picks the key out of what it
//! prints, and keeps it sealed (ACCT-009) with the date it was made and the marker that Claude
//! is in key mode. The key counts as good for twelve months; from 30 days before the end the
//! card warns and offers Renew. Every Claude pane started in key mode gets the key through
//! Claude Code's published `CLAUDE_CODE_OAUTH_TOKEN` variable. Only one setup runs at a time.

use crate::{secrets, state::Store};
use portable_pty::CommandBuilder;
use serde_json::Value;
use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{mpsc, Arc, Mutex};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Emitter, Manager};

pub const TOKEN_FIELD: &str = "claudeOauthToken";
pub const MODE_FIELD: &str = "claudeConnectionMode";
pub const CREATED_FIELD: &str = "claudeKeyCreatedAt";
pub const KEY_MODE: &str = "key";
/// Claude Code's published variable for a long-lived sign-in token.
pub const ENV: &str = "CLAUDE_CODE_OAUTH_TOKEN";
pub const EVENT: &str = "claude-key";
const DAY_MS: i64 = 86_400_000;
pub const VALID_DAYS: i64 = 365;
pub const WARN_DAYS: i64 = 30;
/// Kolux gives up on the setup after ten minutes.
pub const SETUP_LIMIT: Duration = Duration::from_secs(600);
const TOKEN_PREFIX: &str = "sk-ant-oat";
/// Store key: when a Claude usage limit that was reached lifts (ms since 1970). Written when a
/// pane stops on a usage limit (STAT-022, T-039); the card shows it until then (ACCT-013).
pub const LIMIT_KEY: &str = "claudeUsageLimitResetsAt";

/// ACCT-013: why a card needs attention, in plain words, with the reason the window maps to its
/// one fix. Reasons: browser-blocked, sign-in-refused, plan, not-found, smartscreen, usage-limit,
/// key-expiring, key-expired, install-failed, install-unavailable, unknown (and cancelled, which
/// is never shown).
#[derive(serde::Serialize, Debug, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Attention {
    pub reason: &'static str,
    pub message: String,
    /// A usage limit: when the agent can be used again.
    pub resets_at: Option<i64>,
}

impl Attention {
    pub fn new(reason: &'static str, message: impl Into<String>) -> Self {
        Attention { reason, message: message.into(), resets_at: None }
    }
}

/// Anything else that went wrong is shown for information only.
impl From<String> for Attention {
    fn from(message: String) -> Self {
        Attention::new("unknown", message)
    }
}

impl PartialEq<&str> for Attention {
    fn eq(&self, other: &&str) -> bool {
        self.message == *other
    }
}

impl std::fmt::Display for Attention {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(&self.message)
    }
}

/// The usage-limit notice while the limit lasts.
pub fn usage_limit(resets_at: Option<i64>, now: i64) -> Option<Attention> {
    let at = resets_at.filter(|t| *t > now)?;
    Some(Attention { resets_at: Some(at), ..Attention::new("usage-limit", "Claude's usage limit was reached.") })
}

pub fn now_ms() -> i64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis() as i64).unwrap_or(0)
}

/// Drops terminal control sequences (colours, cursor moves, window titles) from PTY output.
pub fn strip_ansi(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let mut it = s.chars().peekable();
    while let Some(c) = it.next() {
        if c != '\u{1b}' {
            if c == '\r' {
                out.push('\n');
            } else if !c.is_control() || c == '\n' {
                out.push(c);
            }
            continue;
        }
        match it.next() {
            // CSI: parameters up to a final byte in @..~. The console host places text by moving
            // the cursor, so a jump to a position starts a new line and a move right is a space;
            // otherwise two screen lines run together.
            Some('[') => {
                for d in it.by_ref() {
                    if ('@'..='~').contains(&d) {
                        match d {
                            'H' | 'f' => out.push('\n'),
                            'C' => out.push(' '),
                            _ => {}
                        }
                        break;
                    }
                }
            }
            // OSC: up to BEL or ESC \
            Some(']') => {
                while let Some(d) = it.next() {
                    if d == '\u{7}' {
                        break;
                    }
                    if d == '\u{1b}' {
                        it.next();
                        break;
                    }
                }
            }
            _ => {}
        }
    }
    out
}

/// The key in the setup's (already cleaned) output: `sk-ant-oat…` followed by URL-safe characters.
pub fn extract_token(clean: &str) -> Option<String> {
    let start = clean.find(TOKEN_PREFIX)?;
    let token: String = clean[start..].chars().take_while(|c| c.is_ascii_alphanumeric() || *c == '-' || *c == '_').collect();
    (token.len() >= 40).then_some(token)
}

/// A "needs a Claude subscription" line. Seen partway through, it is never the final answer.
pub fn mentions_subscription(clean: &str) -> bool {
    let l = clean.to_lowercase();
    l.contains("subscription") && (l.contains("require") || l.contains("need"))
}

/// Whether the setup has shown its browser sign-in step yet (a web address in its output).
pub fn shows_browser_step(clean: &str) -> bool {
    clean.contains("https://")
}

#[derive(Debug, PartialEq)]
pub enum Outcome {
    Key(String),
    SubscriptionRequired,
    Failed(String),
    TimedOut,
    Cancelled,
}

/// What a finished setup amounted to. Only a key counts; a subscription line counts only when
/// no key followed it.
pub fn conclude(clean: &str, code: Option<u32>) -> Outcome {
    if let Some(t) = extract_token(clean) {
        return Outcome::Key(t);
    }
    if mentions_subscription(clean) {
        return Outcome::SubscriptionRequired;
    }
    Outcome::Failed(match code {
        Some(c) => format!("Claude's key setup ended (exit {c}) without a key"),
        None => "Claude's key setup ended without a key".into(),
    })
}

/// A launcher that would need a shell or the classic command prompt to start (`claude.cmd`,
/// a `.bat` or `.ps1` script). Kolux never starts one for the key setup.
pub fn is_wrapper(path: &Path) -> bool {
    path.extension()
        .and_then(|e| e.to_str())
        .map(|e| ["cmd", "bat", "ps1"].iter().any(|w| e.eq_ignore_ascii_case(w)))
        .unwrap_or(false)
}

#[derive(serde::Serialize, Debug, Default, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct KeyStatus {
    /// Claude is connected on the 1-year key.
    pub connected: bool,
    pub created_at: Option<i64>,
    pub expires_at: Option<i64>,
    pub days_left: Option<i64>,
    /// Inside the last 30 days (or past the end): the card warns and offers Renew.
    pub renew_due: bool,
    pub expired: bool,
    /// A setup is running right now.
    pub setting_up: bool,
    /// The running setup has shown its browser step.
    pub in_browser: bool,
    /// Why the card needs attention, in plain words; never a link or a code.
    pub attention: Option<Attention>,
}

/// The card's figures from the settings fields at `now`.
pub fn status_at(settings: &Value, has_token: bool, now: i64) -> KeyStatus {
    let key_mode = settings.get(MODE_FIELD).and_then(Value::as_str) == Some(KEY_MODE);
    if !(key_mode && has_token) {
        return KeyStatus::default();
    }
    let created = settings.get(CREATED_FIELD).and_then(Value::as_i64);
    let mut s = KeyStatus { connected: true, created_at: created, ..Default::default() };
    if let Some(c) = created {
        let end = c + VALID_DAYS * DAY_MS;
        let left = (end - now).div_euclid(DAY_MS);
        s.expires_at = Some(end);
        s.days_left = Some(left.max(0));
        s.expired = now >= end;
        s.renew_due = end - now <= WARN_DAYS * DAY_MS;
    }
    s
}

/// The variable a new pane gets: only a Claude pane, only in key mode, only with a key.
pub fn pane_env(program: Option<&str>, settings: &Value, token: Option<String>) -> Option<(&'static str, String)> {
    let program = program?;
    if crate::agents::credited_agent(program) != Some("claude") {
        return None;
    }
    if settings.get(MODE_FIELD).and_then(Value::as_str) != Some(KEY_MODE) {
        return None;
    }
    token.filter(|t| !t.is_empty()).map(|t| (ENV, t))
}

/// Stores a fresh key: sealed, with its creation date and the key-mode marker.
pub fn keep(store: &Store, token: &str, now: i64) -> Result<(), String> {
    secrets::write_setting(store, TOKEN_FIELD, token)?;
    let mut settings = store.settings();
    settings[MODE_FIELD] = Value::String(KEY_MODE.into());
    settings[CREATED_FIELD] = Value::from(now);
    store.save_settings(&settings).map_err(|e| e.to_string())
}

/// Forgets the key and leaves key mode.
pub fn forget(store: &Store) -> Result<(), String> {
    let mut settings = store.settings();
    if let Some(obj) = settings.as_object_mut() {
        obj.remove(TOKEN_FIELD);
        obj.remove(CREATED_FIELD);
        if obj.get(MODE_FIELD).and_then(Value::as_str) == Some(KEY_MODE) {
            obj.remove(MODE_FIELD);
        }
    }
    store.save_settings(&settings).map_err(|e| e.to_string())
}

/// How a hidden run ended.
#[derive(Debug, PartialEq)]
pub enum Ended {
    /// The program ended by itself (its exit code when known).
    Exited(Option<u32>),
    /// `stop` saw what it was waiting for; the program was stopped.
    Stopped,
    TimedOut,
    Cancelled,
    NotStarted(String),
}

/// Runs `cmd` in a hidden pseudo-terminal (no console window, never the command prompt) until it
/// ends, `stop` accepts what it printed so far, it runs past `limit` or it is cancelled.
/// `on_browser` fires once when a browser step shows. Returns the output with colours removed.
/// Shared by the key setup (ACCT-004) and the managed-account sign-ins (ACCT-005).
pub fn run_hidden(cmd: CommandBuilder, limit: Duration, cancel: Arc<AtomicBool>, on_browser: impl Fn() + Send + 'static, stop: impl Fn(&str) -> bool) -> (String, Ended) {
    let output = Arc::new(Mutex::new(String::new()));
    let sink = output.clone();
    let (tx, rx) = mpsc::channel::<Option<u32>>();
    // Wide enough that a key or a link never wraps onto a second line.
    let session = crate::pty::PtySession::spawn(
        cmd,
        400,
        40,
        move |chunk| {
            if let Ok(mut o) = sink.lock() {
                o.push_str(&String::from_utf8_lossy(chunk));
            }
        },
        move |code| {
            let _ = tx.send(code);
        },
    );
    let mut session = match session {
        Ok(s) => s,
        Err(e) => return (String::new(), Ended::NotStarted(e.to_string())),
    };
    let deadline = Instant::now() + limit;
    let mut told = false;
    let mut answered = 0;
    let clean = || strip_ansi(&output.lock().map(|o| o.clone()).unwrap_or_default());
    let ended = loop {
        match rx.recv_timeout(Duration::from_millis(200)) {
            Ok(code) => {
                // Let the reader drain what was printed last.
                std::thread::sleep(Duration::from_millis(300));
                break Ended::Exited(code);
            }
            Err(mpsc::RecvTimeoutError::Disconnected) => break Ended::Exited(None),
            Err(mpsc::RecvTimeoutError::Timeout) => {}
        }
        // The console host asks where the cursor is (ESC [6n) and waits for the answer a
        // terminal would give; with no one drawing, Kolux answers for it.
        let asked = output.lock().map(|o| o.matches("\u{1b}[6n").count()).unwrap_or(0);
        while answered < asked {
            let _ = session.write(b"\x1b[1;1R");
            answered += 1;
        }
        let now = clean();
        if stop(&now) {
            break Ended::Stopped;
        }
        if !told && shows_browser_step(&now) {
            told = true;
            on_browser();
        }
        if cancel.load(Ordering::SeqCst) {
            break Ended::Cancelled;
        }
        if Instant::now() >= deadline {
            break Ended::TimedOut;
        }
    };
    session.kill();
    (clean(), ended)
}

/// Runs the key setup until it prints a key, ends, runs past `limit` or is cancelled.
pub fn run_setup(cmd: CommandBuilder, limit: Duration, cancel: Arc<AtomicBool>, on_browser: impl Fn() + Send + 'static) -> Outcome {
    let (out, ended) = run_hidden(cmd, limit, cancel, on_browser, |now| extract_token(now).is_some());
    match ended {
        Ended::Exited(code) => conclude(&out, code),
        Ended::Stopped => conclude(&out, None),
        Ended::TimedOut => Outcome::TimedOut,
        Ended::Cancelled => Outcome::Cancelled,
        Ended::NotStarted(e) => Outcome::Failed(format!("Claude's key setup could not start: {e}")),
    }
}

/// What the card says for each way a setup can end without a key.
pub fn attention_for(outcome: &Outcome) -> Option<Attention> {
    match outcome {
        Outcome::Key(_) | Outcome::Cancelled => None,
        Outcome::SubscriptionRequired => Some(Attention::new("plan", "The 1-year key needs a paid Claude subscription on the account you approved.")),
        Outcome::TimedOut => Some(Attention::new("browser-blocked", "The browser step was not finished within 10 minutes.")),
        Outcome::Failed(m) => Some(Attention::new("sign-in-refused", m.clone())),
    }
}

/// The one setup that may be running, and what the last one left behind.
#[derive(Default)]
pub struct KeySetup {
    running: AtomicBool,
    in_browser: AtomicBool,
    cancel: Mutex<Option<Arc<AtomicBool>>>,
    attention: Mutex<Option<Attention>>,
}

impl KeySetup {
    fn attention(&self) -> Option<Attention> {
        self.attention.lock().ok().and_then(|a| a.clone())
    }
    fn set_attention(&self, a: Option<Attention>) {
        if let Ok(mut g) = self.attention.lock() {
            *g = a;
        }
    }
}

fn status(store: &Store, setup: &KeySetup) -> KeyStatus {
    let has = secrets::read_setting(store, TOKEN_FIELD).ok().flatten().is_some();
    let mut s = status_at(&store.settings(), has, now_ms());
    s.setting_up = setup.running.load(Ordering::SeqCst);
    s.in_browser = s.setting_up && setup.in_browser.load(Ordering::SeqCst);
    let limit = store.get(LIMIT_KEY).ok().flatten().and_then(|t| t.parse().ok());
    s.attention = setup.attention().or_else(|| usage_limit(limit, now_ms()));
    s
}

#[tauri::command]
pub fn claude_key_status(store: tauri::State<'_, Mutex<Store>>, setup: tauri::State<'_, KeySetup>) -> Result<KeyStatus, String> {
    let store = store.lock().map_err(|e| e.to_string())?;
    Ok(status(&store, &setup))
}

/// Starts the hidden key setup (Connect or Renew). A second request while one runs is refused.
#[tauri::command]
pub fn claude_key_connect(app: AppHandle, setup: tauri::State<'_, KeySetup>) -> Result<(), String> {
    if setup.running.swap(true, Ordering::SeqCst) {
        return Err("A Claude key setup is already in progress; finish it in the browser or cancel it first.".into());
    }
    let program = match crate::agents::find_program("claude") {
        Some(p) => p,
        None => {
            setup.running.store(false, Ordering::SeqCst);
            setup.set_attention(Some(Attention::new("not-found", "Claude Code is not installed, so there is nothing to run the key setup with.")));
            let _ = app.emit(EVENT, ());
            return Ok(());
        }
    };
    if is_wrapper(&program) {
        // Never retried through the command prompt (ACCT-004).
        setup.running.store(false, Ordering::SeqCst);
        let name = program.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
        setup.set_attention(Some(Attention::new("install-unavailable", format!("The installed Claude launcher ({name}) is a script wrapper Kolux cannot start directly. Install Claude Code's native build and connect again."))));
        let _ = app.emit(EVENT, ());
        return Ok(());
    }
    let cancel = Arc::new(AtomicBool::new(false));
    if let Ok(mut c) = setup.cancel.lock() {
        *c = Some(cancel.clone());
    }
    setup.in_browser.store(false, Ordering::SeqCst);
    setup.set_attention(None);
    let _ = app.emit(EVENT, ());
    let mut cmd = CommandBuilder::new(program.as_os_str());
    cmd.arg("setup-token");
    // The setup must not pick up a key from an earlier one.
    cmd.env_remove(ENV);
    std::thread::spawn(move || {
        let browser_app = app.clone();
        let outcome = run_setup(cmd, SETUP_LIMIT, cancel, move || {
            browser_app.state::<KeySetup>().in_browser.store(true, Ordering::SeqCst);
            let _ = browser_app.emit(EVENT, ());
        });
        let setup = app.state::<KeySetup>();
        let mut attention = attention_for(&outcome);
        if let Outcome::Key(token) = &outcome {
            let store = app.state::<Mutex<Store>>();
            let kept = store.lock().map_err(|e| e.to_string()).and_then(|s| keep(&s, token, now_ms()));
            if let Err(e) = kept {
                attention = Some(format!("The key could not be stored: {e}").into());
            }
        }
        setup.set_attention(attention);
        setup.in_browser.store(false, Ordering::SeqCst);
        setup.running.store(false, Ordering::SeqCst);
        let _ = app.emit(EVENT, ());
    });
    Ok(())
}

#[tauri::command]
pub fn claude_key_cancel(app: AppHandle, setup: tauri::State<'_, KeySetup>) {
    // ACCT-002: with nothing running, Cancel wipes a leftover needs-attention state.
    if !setup.running.load(Ordering::SeqCst) {
        setup.set_attention(None);
        let _ = app.emit(EVENT, ());
        return;
    }
    if let Ok(c) = setup.cancel.lock() {
        if let Some(flag) = c.as_ref() {
            flag.store(true, Ordering::SeqCst);
        }
    }
}

#[tauri::command]
pub fn claude_key_disconnect(app: AppHandle, store: tauri::State<'_, Mutex<Store>>, setup: tauri::State<'_, KeySetup>) -> Result<(), String> {
    forget(&*store.lock().map_err(|e| e.to_string())?)?;
    setup.set_attention(None);
    let _ = app.emit(EVENT, ());
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn a_usage_limit_shows_its_reset_time_only_while_it_lasts_and_setups_name_their_reason() {
        let a = usage_limit(Some(5_000), 1_000).unwrap();
        assert_eq!((a.reason, a.resets_at), ("usage-limit", Some(5_000)));
        assert_eq!(usage_limit(Some(1_000), 1_000), None, "a limit that has lifted is gone");
        assert_eq!(usage_limit(None, 1_000), None);
        assert_eq!(attention_for(&Outcome::SubscriptionRequired).unwrap().reason, "plan");
        assert_eq!(attention_for(&Outcome::TimedOut).unwrap().reason, "browser-blocked");
        assert_eq!(attention_for(&Outcome::Failed("x".into())).unwrap().reason, "sign-in-refused");
        assert_eq!(attention_for(&Outcome::Cancelled), None);
        assert_eq!(Attention::from("odd".to_string()).reason, "unknown");
    }

    const KEY: &str = "sk-ant-oat01-AbCdEfGhIjKlMnOpQrStUvWxYz0123456789_-abcdefghijkl";

    #[test]
    fn picks_the_key_out_of_coloured_output() {
        let raw = format!("\u{1b}[32m✓ Long-lived authentication token created successfully!\u{1b}[0m\r\n\r\nYour OAuth token (valid for 1 year):\r\n\r\n\u{1b}[1m{KEY}\u{1b}[22m\r\n\u{1b}]0;claude\u{7}Store this token securely.");
        let clean = strip_ansi(&raw);
        assert_eq!(extract_token(&clean).as_deref(), Some(KEY));
        assert_eq!(conclude(&clean, Some(0)), Outcome::Key(KEY.into()));
        assert_eq!(extract_token("sk-ant-oat01-short"), None);
    }

    #[test]
    fn a_subscription_line_partway_is_not_the_answer() {
        let partway = format!("Checking: this requires a Claude subscription...\n{KEY}\n");
        assert_eq!(conclude(&partway, Some(0)), Outcome::Key(KEY.into()));
        assert_eq!(conclude("Error: a Claude subscription is required\n", Some(1)), Outcome::SubscriptionRequired);
        assert!(matches!(conclude("something else\n", Some(1)), Outcome::Failed(_)));
    }

    #[test]
    fn wrappers_are_refused() {
        assert!(is_wrapper(Path::new(r"C:\npm\claude.cmd")));
        assert!(is_wrapper(Path::new(r"C:\x\claude.PS1")));
        assert!(!is_wrapper(Path::new(r"C:\Users\x\.local\bin\claude.exe")));
    }

    #[test]
    fn twelve_months_with_a_thirty_day_warning() {
        let now = 1_800_000_000_000_i64;
        let mode = |days_ago: i64| json!({ MODE_FIELD: "key", CREATED_FIELD: now - days_ago * DAY_MS });
        let fresh = status_at(&mode(0), true, now);
        assert!(fresh.connected && !fresh.renew_due && !fresh.expired);
        assert_eq!(fresh.expires_at, Some(now + 365 * DAY_MS));
        assert!(!status_at(&mode(334), true, now).renew_due, "31 days left: no warning yet");
        let edge = status_at(&mode(335), true, now);
        assert!(edge.renew_due && !edge.expired, "30 days left: warning");
        let backdated = status_at(&mode(340), true, now);
        assert!(backdated.renew_due && !backdated.expired);
        assert_eq!(backdated.days_left, Some(25));
        let gone = status_at(&mode(366), true, now);
        assert!(gone.expired && gone.renew_due && gone.days_left == Some(0));
        assert!(!status_at(&mode(0), false, now).connected, "no key, not connected");
        assert!(!status_at(&json!({ CREATED_FIELD: now }), true, now).connected, "not in key mode");
    }

    #[test]
    fn only_claude_panes_in_key_mode_get_the_key() {
        let key_mode = json!({ MODE_FIELD: "key" });
        assert_eq!(pane_env(Some("claude"), &key_mode, Some(KEY.into())), Some((ENV, KEY.to_string())));
        assert_eq!(pane_env(Some(r"C:\bin\claude.exe"), &key_mode, Some(KEY.into())), Some((ENV, KEY.to_string())));
        assert_eq!(pane_env(Some("codex"), &key_mode, Some(KEY.into())), None);
        assert_eq!(pane_env(None, &key_mode, Some(KEY.into())), None, "a shell never gets it");
        assert_eq!(pane_env(Some("claude"), &json!({ MODE_FIELD: "account" }), Some(KEY.into())), None);
        assert_eq!(pane_env(Some("claude"), &key_mode, None), None);
    }

    #[test]
    fn keep_and_forget_round_trip_sealed() {
        let dir = std::env::temp_dir().join(format!("kolux-key-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        let store = Store::open(&dir).unwrap();
        keep(&store, KEY, 42).unwrap();
        let raw = std::fs::read_to_string(dir.join("settings.json")).unwrap();
        assert!(!raw.contains(KEY), "the key is never in the clear");
        assert_eq!(secrets::read_setting(&store, TOKEN_FIELD).unwrap().as_deref(), Some(KEY));
        let s = store.settings();
        assert_eq!(s[MODE_FIELD], "key");
        assert_eq!(s[CREATED_FIELD], 42);
        forget(&store).unwrap();
        let s = store.settings();
        assert!(s.get(TOKEN_FIELD).is_none() && s.get(MODE_FIELD).is_none() && s.get(CREATED_FIELD).is_none());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[cfg(windows)]
    fn ps(script: &str) -> CommandBuilder {
        let mut c = CommandBuilder::new("powershell.exe");
        c.args(["-NoProfile", "-NonInteractive", "-Command", script]);
        c
    }

    #[cfg(windows)]
    #[test]
    fn a_hidden_run_reads_the_key_and_one_that_hangs_times_out() {
        let printed = ps(&format!("Write-Output 'This requires a Claude subscription'; Write-Output 'Open https://example.invalid/x'; Start-Sleep -Milliseconds 600; Write-Output '{KEY}'; Start-Sleep 20"));
        let seen = Arc::new(AtomicBool::new(false));
        let flag = seen.clone();
        let started = Instant::now();
        let out = run_setup(printed, Duration::from_secs(15), Arc::new(AtomicBool::new(false)), move || flag.store(true, Ordering::SeqCst));
        assert_eq!(out, Outcome::Key(KEY.into()));
        assert!(seen.load(Ordering::SeqCst), "the browser step was noticed");
        assert!(started.elapsed() < Duration::from_secs(12), "a key ends the run without waiting for the program");
        let out = run_setup(ps("Start-Sleep 30"), Duration::from_secs(2), Arc::new(AtomicBool::new(false)), || {});
        assert_eq!(out, Outcome::TimedOut);
        let cancel = Arc::new(AtomicBool::new(true));
        assert_eq!(run_setup(ps("Start-Sleep 30"), Duration::from_secs(10), cancel, || {}), Outcome::Cancelled);
    }
}
