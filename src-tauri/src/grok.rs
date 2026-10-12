//! ACCT-008: Grok connects by its own CLI login, a device code or a pasted xAI key.
//!
//! Kolux runs the Grok CLI's own `grok login` (browser) or `grok login --device-auth` (a link and
//! a one-time code) hidden. The CLI keeps its sign-in in `auth.json` in its home (`GROK_HOME`, else
//! `.grok` in the user's home; Grok's public authentication guide), so Kolux only looks for that
//! file and never reads it. The key route stores an xAI API key sealed in the settings field
//! `xaiApiKey` (ACCT-009) and hands it to new Grok panes as `XAI_API_KEY`. Grok itself prefers its
//! session over the key, and so does the card. Disconnect and Manage are T-202 (ACCT-015).

use crate::claude_key::{run_hidden, Attention, Ended};
use crate::{secrets, state::Store};
use portable_pty::CommandBuilder;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager};

pub const EVENT: &str = "grok";
pub const KEY_FIELD: &str = "xaiApiKey";
pub const KEY_ENV: &str = "XAI_API_KEY";
pub const HOME_ENV: &str = "GROK_HOME";
pub const LOGIN_LIMIT: Duration = Duration::from_secs(900);

/// The Grok CLI's home: `GROK_HOME`, else `.grok` in the user's home.
pub fn home(env: Option<&str>, user: Option<&Path>) -> Option<PathBuf> {
    match env.filter(|e| !e.trim().is_empty()) {
        Some(e) => Some(PathBuf::from(e)),
        None => user.map(|u| u.join(".grok")),
    }
}

/// How the card reports Grok: the CLI's own sign-in wins over a saved key (ACCT-008).
pub fn connection(cli_signed_in: bool, key_saved: bool) -> &'static str {
    if cli_signed_in {
        "cli"
    } else if key_saved {
        "key"
    } else {
        "none"
    }
}

pub fn login_command(program: &Path, device: bool) -> CommandBuilder {
    let mut cmd = CommandBuilder::new(program.as_os_str());
    cmd.arg("login");
    if device {
        cmd.arg("--device-auth");
    }
    cmd
}

/// Why a login left Grok signed out, with the device code kept out.
pub fn failure(ended: &Ended, output: &str, code: Option<&str>) -> Option<Attention> {
    let clean = |s: &str| {
        let s = crate::claude_accounts::scrub(s);
        match code {
            Some(c) if !c.is_empty() => s.replace(c, "[code removed]"),
            _ => s,
        }
    };
    Some(match ended {
        Ended::Cancelled => return None,
        Ended::TimedOut => Attention::new("browser-blocked", "The Grok sign-in was not finished within 15 minutes."),
        Ended::NotStarted(e) => format!("Grok's sign-in could not start: {}", clean(e)).into(),
        Ended::Exited(_) | Ended::Stopped => match output.lines().map(str::trim).rfind(|l| !l.is_empty()) {
            Some(last) => Attention::new("sign-in-refused", format!("Grok's sign-in ended without signing in: {}", clean(last))),
            None => Attention::new("sign-in-refused", "Grok's sign-in ended without signing in."),
        },
    })
}

/// The variable a new pane gets: only a Grok pane, only with a saved key.
pub fn pane_env(program: Option<&str>, key: Option<String>) -> Option<(&'static str, String)> {
    if crate::agents::credited_agent(program?) != Some("grok") {
        return None;
    }
    key.map(|k| (KEY_ENV, k))
}

#[derive(Default)]
pub struct GrokSignIn {
    /// "browser" or "device" while a sign-in runs.
    running: Mutex<Option<String>>,
    in_browser: AtomicBool,
    device: Mutex<Option<(String, String)>>,
    cancel: Mutex<Option<Arc<AtomicBool>>>,
    attention: Mutex<Option<Attention>>,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GrokView {
    /// "cli", "key" or "none".
    connection: &'static str,
    signing_in: Option<String>,
    in_browser: bool,
    device_link: Option<String>,
    device_code: Option<String>,
    attention: Option<Attention>,
}

fn cli_home() -> Option<PathBuf> {
    let user = std::env::var_os("USERPROFILE").or_else(|| std::env::var_os("HOME")).map(PathBuf::from);
    home(std::env::var(HOME_ENV).ok().as_deref(), user.as_deref())
}

fn cli_signed_in() -> bool {
    cli_home().is_some_and(|h| h.join("auth.json").is_file())
}

#[tauri::command]
pub fn grok_status(store: tauri::State<'_, Mutex<Store>>, s: tauri::State<'_, GrokSignIn>) -> Result<GrokView, String> {
    // A value the old app sealed cannot be opened here and counts as missing (COMPAT 5.4).
    let key_saved = secrets::read_setting(&*store.lock().map_err(|e| e.to_string())?, KEY_FIELD).ok().flatten().is_some();
    let device = s.device.lock().ok().and_then(|d| d.clone());
    Ok(GrokView {
        connection: connection(cli_signed_in(), key_saved),
        signing_in: s.running.lock().ok().and_then(|r| r.clone()),
        in_browser: s.in_browser.load(Ordering::SeqCst),
        device_link: device.as_ref().map(|d| d.0.clone()),
        device_code: device.map(|d| d.1),
        attention: s.attention.lock().ok().and_then(|a| a.clone()),
    })
}

fn finish(app: &AppHandle, attention: Option<Attention>) {
    let s = app.state::<GrokSignIn>();
    if let Ok(mut g) = s.attention.lock() {
        *g = attention;
    }
    s.in_browser.store(false, Ordering::SeqCst);
    if let Ok(mut g) = s.device.lock() {
        *g = None;
    }
    if let Ok(mut g) = s.cancel.lock() {
        *g = None;
    }
    if let Ok(mut g) = s.running.lock() {
        *g = None;
    }
    let _ = app.emit(EVENT, ());
}

/// Connect (the CLI's browser login) or Sign in with a code (`device` = true).
#[tauri::command]
pub fn grok_sign_in(app: AppHandle, s: tauri::State<'_, GrokSignIn>, device: bool) -> Result<(), String> {
    {
        let mut running = s.running.lock().map_err(|e| e.to_string())?;
        if running.is_some() {
            return Err("A Grok sign-in is already in progress; finish it or cancel it first.".into());
        }
        *running = Some(if device { "device" } else { "browser" }.into());
    }
    let Some(program) = crate::agents::find_program("grok") else {
        finish(&app, Some(Attention::new("not-found", "Grok is not installed, so there is nothing to sign in with.")));
        return Ok(());
    };
    let cancel = Arc::new(AtomicBool::new(false));
    if let Ok(mut c) = s.cancel.lock() {
        *c = Some(cancel.clone());
    }
    if let Ok(mut g) = s.attention.lock() {
        *g = None;
    }
    let _ = app.emit(EVENT, ());
    std::thread::spawn(move || {
        let seen: Arc<Mutex<Option<String>>> = Arc::default();
        let peek = seen.clone();
        let peek_app = app.clone();
        let browser_app = app.clone();
        let (out, ended) = run_hidden(
            login_command(&program, device),
            LOGIN_LIMIT,
            cancel,
            move || {
                if !device {
                    browser_app.state::<GrokSignIn>().in_browser.store(true, Ordering::SeqCst);
                    let _ = browser_app.emit(EVENT, ());
                }
            },
            move |clean| {
                if device {
                    if let Some(found) = crate::codex_accounts::device_prompt(clean) {
                        let mut s = peek.lock().unwrap_or_else(|p| p.into_inner());
                        if s.as_deref() != Some(found.1.as_str()) {
                            *s = Some(found.1.clone());
                            if let Ok(mut g) = peek_app.state::<GrokSignIn>().device.lock() {
                                *g = Some(found);
                            }
                            let _ = peek_app.emit(EVENT, ());
                        }
                    }
                }
                false
            },
        );
        // Only the CLI's own sign-in file counts, whatever the login printed.
        let attention = if cli_signed_in() { None } else { failure(&ended, &out, seen.lock().ok().and_then(|c| c.clone()).as_deref()) };
        finish(&app, attention);
    });
    Ok(())
}

/// Cancel ends the running login; with nothing running it wipes a leftover needs-attention state.
#[tauri::command]
pub fn grok_cancel(app: AppHandle, s: tauri::State<'_, GrokSignIn>) {
    match s.cancel.lock().ok().and_then(|c| c.clone()) {
        Some(flag) => flag.store(true, Ordering::SeqCst),
        None => finish(&app, None),
    }
}

/// The key route: stores the xAI key sealed, once. The key is never sent back to the page.
#[tauri::command]
pub fn grok_key_set(app: AppHandle, store: tauri::State<'_, Mutex<Store>>, key: String) -> Result<(), String> {
    let key = key.trim();
    if key.is_empty() {
        return Err("Type or paste an xAI API key first.".into());
    }
    secrets::write_setting(&*store.lock().map_err(|e| e.to_string())?, KEY_FIELD, key)?;
    let _ = app.emit(EVENT, ());
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_cli_home_follows_grok_home_then_the_user_folder() {
        let user = Path::new("C:/Users/me");
        assert_eq!(home(Some("D:/g"), Some(user)), Some(PathBuf::from("D:/g")));
        assert_eq!(home(Some("  "), Some(user)), Some(user.join(".grok")));
        assert_eq!(home(None, Some(user)), Some(user.join(".grok")));
        assert_eq!(home(None, None), None);
    }

    #[test]
    fn a_cli_sign_in_wins_over_a_saved_key() {
        assert_eq!(connection(true, true), "cli");
        assert_eq!(connection(false, true), "key");
        assert_eq!(connection(true, false), "cli");
        assert_eq!(connection(false, false), "none");
    }

    #[test]
    fn the_real_device_prompt_is_read_and_its_code_kept_out_of_failures() {
        // What `grok login --device-auth` 1.0.50 printed, verbatim.
        let out = "To sign in, open this URL in your browser:\n\n  https://accounts.x.ai/oauth2/device?user_code=8EMT-BJ57\n\nConfirm this code in your browser:\n\n  8EMT-BJ57\n\nOnly continue with a code you requested. Don't share it with anyone.\n\nWaiting for authorization...\nexpired: 8EMT-BJ57\n";
        let (link, code) = crate::codex_accounts::device_prompt(out).expect("prompt");
        assert_eq!(link, "https://accounts.x.ai/oauth2/device?user_code=8EMT-BJ57");
        assert_eq!(code, "8EMT-BJ57");
        let a = failure(&Ended::Exited(Some(1)), out, Some(&code)).expect("attention");
        assert_eq!(a.reason, "sign-in-refused");
        assert!(!a.message.contains("8EMT-BJ57"), "{}", a.message);
        assert!(failure(&Ended::Cancelled, out, None).is_none());
        assert_eq!(failure(&Ended::TimedOut, "", None).unwrap().reason, "browser-blocked");
    }

    #[test]
    fn only_a_grok_pane_gets_the_key() {
        assert_eq!(pane_env(Some("grok"), Some("xai-1".into())), Some((KEY_ENV, "xai-1".into())));
        assert_eq!(pane_env(Some("claude"), Some("xai-1".into())), None);
        assert_eq!(pane_env(Some("grok"), None), None);
        assert_eq!(pane_env(None, Some("xai-1".into())), None);
    }
}
