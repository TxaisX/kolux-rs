//! ACCT-007: Codex connects with a ChatGPT sign-in or a device code.
//!
//! Every Codex account Kolux adds lives in a private Codex home of its own
//! (`<profile>\codex-accounts\<id>`). Kolux runs Codex's own `codex login` (browser) or
//! `codex login --device-auth` (a link and a one-time code to enter on any device) hidden, with
//! `CODEX_HOME` pointing at that home, so the user's usual Codex folder is never touched. The home
//! holds a `config.toml` that keeps the sign-in in the home's own `auth.json` (Codex's file
//! store), and Kolux keeps a sealed copy in the vault (`<profile>\vault\codex-<id>.json`, ACCT-009).
//! A login that fails is rolled back, but a home that already holds a working sign-in is never
//! deleted. The newly connected account becomes the active one: new Codex panes and the usage pill
//! run on it. Without a managed account, Codex's own system-default login is reported as it is.
//! T-138 (ACCT-019, ACCT-020): the list shows the system default first, then each account; any
//! row can be made active, an account can be removed (its home deleted, retried while Windows still
//! holds it), and the user's own Codex folder is only ever read, never mirrored or written.

use crate::claude_key::{run_hidden, Attention, Ended};
use crate::codex_usage::{sign_in_kind, SignIn};
use crate::{secrets, state::Store};
use base64::Engine;
use portable_pty::CommandBuilder;
use serde_json::Value;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager};

pub const LIST_KEY: &str = "codexAccounts";
pub const ACTIVE_KEY: &str = "codexActiveAccount";
pub const HOME_ENV: &str = "CODEX_HOME";
pub const FOLDER: &str = "codex-accounts";
pub const EVENT: &str = "codex-accounts";
pub const LOGIN_LIMIT: Duration = Duration::from_secs(900);
/// Keeps the sign-in in the home's own `auth.json` rather than the system keyring.
pub const HOME_CONFIG: &str = "cli_auth_credentials_store = \"file\"\n";

#[derive(serde::Serialize, serde::Deserialize, Debug, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Account {
    pub id: String,
    /// The ChatGPT account's email, when the sign-in names it.
    pub email: Option<String>,
    /// The account's private Codex home: where it runs.
    pub home: String,
    pub last_sign_in: i64,
    /// ACCT-012: Codex answered with a sign-in error for this account; Sign in again clears it.
    #[serde(default)]
    pub sign_in_error: bool,
    /// ACCT-019 (T-138-b): the user's own name for the account, so a personal and a business
    /// workspace on one email can be told apart. Kolux does not guess the kind: OpenAI does not
    /// document where a sign-in says it.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub label: Option<String>,
}

pub const LABEL_MAX: usize = 40;

/// Names an account (trimmed, at most LABEL_MAX characters); a blank name clears it.
pub fn set_label(store: &Store, id: &str, label: &str) -> Result<(), String> {
    let mut list = load(store);
    let Some(a) = list.iter_mut().find(|a| a.id == id) else {
        return Err("That Codex account is no longer listed.".into());
    };
    let name: String = label.trim().chars().take(LABEL_MAX).collect();
    a.label = Some(name.trim_end().to_string()).filter(|n| !n.is_empty());
    store.set(LIST_KEY, &serde_json::to_string(&list).map_err(|e| e.to_string())?).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn codex_account_label(app: AppHandle, store: tauri::State<'_, Mutex<Store>>, id: String, label: String) -> Result<(), String> {
    set_label(&*store.lock().map_err(|e| e.to_string())?, &id, &label)?;
    let _ = app.emit(EVENT, ());
    Ok(())
}

pub fn load(store: &Store) -> Vec<Account> {
    store.get(LIST_KEY).ok().flatten().and_then(|t| serde_json::from_str(&t).ok()).unwrap_or_default()
}

/// The active account, if it is still listed and its home is on disk.
pub fn active_account(store: &Store) -> Option<Account> {
    let id = store.get(ACTIVE_KEY).ok().flatten()?;
    load(store).into_iter().find(|a| a.id == id).filter(|a| PathBuf::from(&a.home).is_dir())
}

/// Flags or clears an account's sign-in error (ACCT-012); true when that changed anything.
pub fn mark_sign_in_error(store: &Store, id: &str, error: bool) -> Result<bool, String> {
    let mut list = load(store);
    let Some(a) = list.iter_mut().find(|a| a.id == id && a.sign_in_error != error) else {
        return Ok(false);
    };
    a.sign_in_error = error;
    store.set(LIST_KEY, &serde_json::to_string(&list).map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
    Ok(true)
}

/// ACCT-025: each listed account's live sign-in file and its sealed copy in the vault.
pub fn sign_in_files(store: &Store, profile: &Path) -> Vec<(PathBuf, PathBuf)> {
    load(store).into_iter().map(|a| (Path::new(&a.home).join("auth.json"), profile.join(secrets::VAULT).join(format!("codex-{}.json", a.id)))).collect()
}

/// The active account's home, if it is still listed and on disk.
pub fn active_home(store: &Store) -> Option<String> {
    active_account(store).map(|a| a.home)
}

/// ACCT-024: how long a new Codex pane waits for the chosen account's sign-in to be in place.
pub const SIGN_IN_WAIT: Duration = Duration::from_secs(2);

/// ACCT-024: the Codex home a new pane runs in. `active` reads the chosen account's home and is
/// asked again every `step`, so an account changed while the pane waits wins. No sign-in after
/// `wait`: the system-default login (`None`), or, when the choice changed and the new one has no
/// sign-in either, an error asking the user to open the pane again.
pub fn ready_home(active: impl FnMut() -> Option<String>, signed_in: impl Fn(&str) -> bool, wait: Duration, step: Duration) -> Result<Option<String>, String> {
    let started = std::time::Instant::now();
    ready_home_by(active, signed_in, || started.elapsed() >= wait, || std::thread::sleep(step))
}

/// ACCT-024 (FIX-4): `ready_home` with its clock and its pause handed in, so a test counts polls
/// instead of watching the wall clock (a loaded machine slowed the timed version into a false fail).
/// `out_of_time` says the wait is over; `pause` waits one step.
fn ready_home_by(mut active: impl FnMut() -> Option<String>, signed_in: impl Fn(&str) -> bool, mut out_of_time: impl FnMut() -> bool, mut pause: impl FnMut()) -> Result<Option<String>, String> {
    let first = active();
    let mut home = first.clone();
    loop {
        match home.as_deref() {
            None => return Ok(None),
            Some(h) if signed_in(h) => return Ok(home),
            _ if out_of_time() => break,
            _ => pause(),
        }
        home = active();
    }
    if home == first {
        Ok(None)
    } else {
        Err("The Codex account changed while this pane was starting, and the new one is not signed in yet. Open it again.".into())
    }
}

/// ACCT-023: the home a resumed pane runs on. `None` when its account is no longer listed (the
/// pane is stale, never moved to another account), `Some(None)` while the home is not on disk yet.
pub fn resume_home(accounts: &[Account], id: &str) -> Option<Option<String>> {
    let a = accounts.iter().find(|a| a.id == id)?;
    Some(PathBuf::from(&a.home).is_dir().then(|| a.home.clone()))
}

/// ACCT-023: waits about two seconds for the resumed account's home, then gives up with a
/// try-again message rather than carrying on as another account.
pub fn wait_home(store: &Mutex<Store>, id: &str) -> Result<String, String> {
    for _ in 0..20 {
        let listed = store.lock().map(|s| resume_home(&load(&s), id)).map_err(|e| e.to_string())?;
        match listed {
            None => return Err("The Codex account this session ran on is no longer listed, so it was not resumed on another one. Pick an account in Settings and start it again.".into()),
            Some(Some(home)) => return Ok(home),
            Some(None) => std::thread::sleep(Duration::from_millis(100)),
        }
    }
    Err("That account's Codex sign-in is not in place yet; try again in a moment.".into())
}

/// The variable a new pane gets: only a Codex pane, only with an active account.
pub fn pane_env(program: Option<&str>, home: Option<String>) -> Option<(&'static str, String)> {
    if crate::agents::credited_agent(program?) != Some("codex") {
        return None;
    }
    home.map(|h| (HOME_ENV, h))
}

/// How plain Codex is signed in (ACCT-007): ChatGPT, an API key, an API key with a custom
/// provider, or signed out. Looks in `CODEX_HOME`, then `.codex` in the user's home.
pub fn system_default(codex_home_env: Option<&str>, user_home: Option<&Path>) -> &'static str {
    let home = codex_home_env.map(str::trim).filter(|h| !h.is_empty()).map(PathBuf::from).or_else(|| user_home.map(|u| u.join(".codex")));
    let Some(home) = home else { return "signed-out" };
    match sign_in_kind(&home.join("auth.json")) {
        Some(SignIn::ChatGpt) => "chatgpt",
        Some(SignIn::ApiKey) => "api-key",
        None if custom_provider(&fs::read_to_string(home.join("config.toml")).unwrap_or_default()) => "custom-provider",
        None => "signed-out",
    }
}

/// A top-level `model_provider` other than OpenAI's: the key then comes from that provider's
/// own settings. ponytail: a line scan, not a TOML parser; only the top-level key counts.
/// A top-level `key = value` of a config.toml (before the first table), quotes and comment removed.
fn top_level(config: &str, key: &str) -> Option<String> {
    for line in config.lines().map(str::trim) {
        if line.starts_with('[') {
            return None;
        }
        if let Some(v) = line.strip_prefix(key).map(str::trim_start).and_then(|r| r.strip_prefix('=')) {
            return Some(v.split('#').next().unwrap_or("").trim().trim_matches(|c| c == '"' || c == '\'').to_string());
        }
    }
    None
}

fn custom_provider(config: &str) -> bool {
    top_level(config, "model_provider").is_some_and(|v| !v.is_empty() && v != "openai")
}

/// SET-030: an account home's config.toml no longer agrees with what Kolux wrote there: the
/// sign-in is not kept in the home's own file any more, or another model provider took over.
pub fn config_drift(home: &Path) -> bool {
    let config = fs::read_to_string(home.join("config.toml")).unwrap_or_default();
    top_level(&config, "cli_auth_credentials_store").as_deref() != Some("file") || custom_provider(&config)
}

/// The link and the one-time code of a device sign-in, only once both have been printed.
pub fn device_prompt(clean: &str) -> Option<(String, String)> {
    let words = || clean.split_whitespace().map(|w| w.trim_matches(|c: char| !c.is_ascii_alphanumeric() && c != '/' && c != ':' && c != '-' && c != '.' && c != '_'));
    let link = words().find(|w| w.starts_with("https://"))?.trim_end_matches('.').to_string();
    let code = words().find(|w| {
        let parts: Vec<&str> = w.split('-').collect();
        parts.len() >= 2 && parts.iter().all(|p| p.len() >= 4 && p.chars().all(|c| c.is_ascii_uppercase() || c.is_ascii_digit()))
    })?;
    Some((link, code.to_string()))
}

/// The email in a ChatGPT sign-in's identity token, if it carries one.
/// ponytail: the token's claims are not published; `email` is the standard OpenID claim.
pub fn email(auth: &str) -> Option<String> {
    let v: Value = serde_json::from_str(auth).ok()?;
    let token = v.get("tokens")?.get("id_token")?.as_str()?;
    let payload = token.split('.').nth(1)?;
    let bytes = base64::engine::general_purpose::URL_SAFE_NO_PAD.decode(payload.trim_end_matches('=')).ok()?;
    let claims: Value = serde_json::from_slice(&bytes).ok()?;
    claims.get("email").and_then(Value::as_str).filter(|e| e.contains('@')).map(str::to_string)
}

/// Why a login gave Kolux no account, with links and the code kept out.
pub fn failure(ended: &Ended, output: &str, code: Option<&str>) -> Attention {
    let clean = |s: &str| {
        let s = crate::claude_accounts::scrub(s);
        match code {
            Some(c) if !c.is_empty() => s.replace(c, "[code removed]"),
            _ => s,
        }
    };
    match ended {
        Ended::Cancelled => Attention::new("cancelled", "Sign-in cancelled."),
        Ended::TimedOut => Attention::new("browser-blocked", "The Codex sign-in was not finished within 15 minutes."),
        Ended::NotStarted(e) => format!("Codex's sign-in could not start: {}", clean(e)).into(),
        // SET-030: Codex refusing the command line itself is no sign-in problem.
        Ended::Exited(_) if bad_arguments(output) => Attention::new("unknown", "This Codex version did not accept Kolux's sign-in command; update Codex and try again."),
        Ended::Exited(_) | Ended::Stopped => match output.lines().map(str::trim).rfind(|l| !l.is_empty()) {
            Some(last) => Attention::new("sign-in-refused", format!("Codex's sign-in ended without signing in: {}", clean(last))),
            None => Attention::new("sign-in-refused", "Codex's sign-in ended without signing in."),
        },
    }
}

/// Codex's command-line parser rejecting what it was given (its usual usage-error wording).
pub fn bad_arguments(output: &str) -> bool {
    let o = output.to_lowercase();
    ["unexpected argument", "unrecognized subcommand", "unrecognized option", "for more information, try '--help'"].iter().any(|k| o.contains(k))
}

/// The command a sign-in runs: `codex login` (or with `--device-auth`) inside `home`.
pub fn login_command(program: &Path, home: &Path, device: bool) -> CommandBuilder {
    let mut cmd = CommandBuilder::new(program.as_os_str());
    cmd.arg("login");
    if device {
        cmd.arg("--device-auth");
    }
    cmd.env(HOME_ENV, home.as_os_str());
    cmd
}

/// One sign-in, into a fresh private home or again into a listed account's own (ACCT-012). On
/// success a new account is listed and made active, a listed one updated in place, and the
/// sign-in sealed into the vault; only a sign-in the login changed counts. On failure the home is
/// removed, unless it already holds a working sign-in.
pub fn sign_in(store: &Mutex<Store>, profile: &Path, id: &str, now: i64, login: impl FnOnce(&Path) -> (String, Ended, Option<String>)) -> Result<Account, Attention> {
    let home = profile.join(FOLDER).join(id);
    let auth = home.join("auth.json");
    fs::create_dir_all(&home).map_err(|e| e.to_string())?;
    fs::write(home.join("config.toml"), HOME_CONFIG).map_err(|e| e.to_string())?;
    // ACCT-019: only a home with no sign-in file at all is removed; one that cannot be read (a
    // locked file) may still hold a working sign-in.
    let roll_back = || {
        if !auth.exists() {
            let _ = fs::remove_dir_all(&home);
        }
    };
    let before = fs::read_to_string(&auth).ok();
    let (output, ended, code) = login(&home);
    let signed_in = matches!(ended, Ended::Exited(_)) && sign_in_kind(&auth) == Some(SignIn::ChatGpt) && fs::read_to_string(&auth).ok() != before;
    if !signed_in {
        roll_back();
        return Err(failure(&ended, &output, code.as_deref()));
    }
    let text = fs::read_to_string(&auth).map_err(|e| e.to_string())?;
    if let Err(e) = secrets::write_file(&profile.join(secrets::VAULT).join(format!("codex-{id}.json")), &text) {
        return Err(format!("The sign-in could not be stored: {e}").into());
    }
    let account = Account { id: id.into(), email: email(&text), home: home.to_string_lossy().into_owned(), last_sign_in: now, sign_in_error: false, label: None };
    let store = store.lock().map_err(|e| e.to_string())?;
    let mut list = load(&store);
    match list.iter_mut().find(|a| a.id == id) {
        Some(a) => *a = Account { label: a.label.take(), ..account.clone() },
        None => {
            list.push(account.clone());
            store.set(ACTIVE_KEY, id).map_err(|e| e.to_string())?;
        }
    }
    store.set(LIST_KEY, &serde_json::to_string(&list).map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
    Ok(account)
}

#[derive(Default)]
pub struct SignIns {
    /// "browser" or "device" while a sign-in runs.
    running: Mutex<Option<String>>,
    /// ACCT-019: when each account's sign-in file was first seen missing.
    missing_since: Mutex<std::collections::HashMap<String, std::time::Instant>>,
    in_browser: AtomicBool,
    device: Mutex<Option<(String, String)>>,
    cancel: Mutex<Option<Arc<AtomicBool>>>,
    attention: Mutex<Option<Attention>>,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CodexView {
    pub accounts: Vec<Account>,
    pub active: Option<String>,
    /// `chatgpt`, `api-key`, `custom-provider` or `signed-out`: plain Codex's own login.
    pub system_default: String,
    pub signing_in: Option<String>,
    pub in_browser: bool,
    pub device_link: Option<String>,
    pub device_code: Option<String>,
    pub attention: Option<Attention>,
    /// Ids of accounts whose home's config.toml has drifted (SET-030).
    pub drifted: Vec<String>,
    /// ACCT-019: accounts whose sign-in file has been gone for longer than the grace period.
    pub missing: Vec<String>,
    /// ACCT-021: why the user's Codex settings cannot be copied into the accounts, if they cannot.
    pub settings_warning: Option<String>,
}

#[tauri::command]
pub fn codex_accounts(store: tauri::State<'_, Mutex<Store>>, sign_ins: tauri::State<'_, SignIns>) -> Result<CodexView, String> {
    let store = store.lock().map_err(|e| e.to_string())?;
    let env = std::env::var(HOME_ENV).ok();
    let user = std::env::var_os("USERPROFILE").or_else(|| std::env::var_os("HOME")).map(PathBuf::from);
    let device = sign_ins.device.lock().ok().and_then(|d| d.clone());
    let accounts = load(&store);
    let active = store.get(ACTIVE_KEY).ok().flatten().filter(|id| accounts.iter().any(|a| &a.id == id));
    let drifted = accounts.iter().filter(|a| config_drift(Path::new(&a.home))).map(|a| a.id.clone()).collect();
    let missing = match sign_ins.missing_since.lock() {
        Ok(mut seen) => accounts.iter().filter(|a| missing_now(&mut seen, &a.id, Path::new(&a.home).join("auth.json").exists(), std::time::Instant::now())).map(|a| a.id.clone()).collect(),
        Err(_) => Vec::new(),
    };
    let settings_warning = user_dir(env.as_deref(), user.as_deref()).and_then(|u| user_settings(&u).err());
    Ok(CodexView {
        settings_warning,
        drifted,
        missing,
        accounts,
        active,
        system_default: system_default(env.as_deref(), user.as_deref()).into(),
        signing_in: sign_ins.running.lock().ok().and_then(|r| r.clone()),
        in_browser: sign_ins.in_browser.load(Ordering::SeqCst),
        device_link: device.as_ref().map(|d| d.0.clone()),
        device_code: device.map(|d| d.1),
        attention: sign_ins.attention.lock().ok().and_then(|a| a.clone()),
    })
}

/// Connect (browser) or Sign in with a code (`device` = true): adds a Codex account, or signs
/// the listed account `again` in once more (ACCT-012).
#[tauri::command]
pub fn codex_account_sign_in(app: AppHandle, sign_ins: tauri::State<'_, SignIns>, device: bool, again: Option<String>) -> Result<(), String> {
    if again.is_none() {
        let env = std::env::var(HOME_ENV).ok();
        let user = std::env::var_os("USERPROFILE").or_else(|| std::env::var_os("HOME")).map(PathBuf::from);
        if user_custom_provider(env.as_deref(), user.as_deref()) {
            return Err(CUSTOM_PROVIDER_REFUSAL.into());
        }
    }
    {
        let mut running = sign_ins.running.lock().map_err(|e| e.to_string())?;
        if running.is_some() {
            return Err("A Codex sign-in is already in progress; finish it or cancel it first.".into());
        }
        *running = Some(if device { "device" } else { "browser" }.into());
    }
    let finish = |app: &AppHandle, attention: Option<Attention>| {
        let s = app.state::<SignIns>();
        if let Ok(mut g) = s.attention.lock() {
            *g = attention;
        }
        s.in_browser.store(false, Ordering::SeqCst);
        if let Ok(mut g) = s.device.lock() {
            *g = None;
        }
        if let Ok(mut g) = s.running.lock() {
            *g = None;
        }
        let _ = app.emit(EVENT, ());
    };
    let program = match crate::agents::find_program("codex") {
        Some(p) if !crate::claude_key::is_wrapper(&p) => p,
        Some(_) => {
            finish(&app, Some(Attention::new("install-unavailable", "The installed Codex launcher is a script wrapper Kolux cannot start directly. Install Codex's native build and try again.")));
            return Ok(());
        }
        None => {
            finish(&app, Some(Attention::new("not-found", "Codex is not installed, so there is nothing to sign in with.")));
            return Ok(());
        }
    };
    let profile = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let cancel = Arc::new(AtomicBool::new(false));
    if let Ok(mut c) = sign_ins.cancel.lock() {
        *c = Some(cancel.clone());
    }
    if let Ok(mut g) = sign_ins.attention.lock() {
        *g = None;
    }
    let _ = app.emit(EVENT, ());
    std::thread::spawn(move || {
        let store = app.state::<Mutex<Store>>();
        let id = again.unwrap_or_else(|| format!("{:x}", crate::claude_key::now_ms()));
        let result = sign_in(&store, &profile, &id, crate::claude_key::now_ms(), |home| {
            let seen: Arc<Mutex<Option<(String, String)>>> = Arc::default();
            let peek = seen.clone();
            let peek_app = app.clone();
            let browser_app = app.clone();
            let (out, ended) = run_hidden(
                login_command(&program, home, device),
                LOGIN_LIMIT,
                cancel,
                move || {
                    if !device {
                        browser_app.state::<SignIns>().in_browser.store(true, Ordering::SeqCst);
                        let _ = browser_app.emit(EVENT, ());
                    }
                },
                move |clean| {
                    // The device view waits until both the link and the code are known.
                    if device {
                        if let Some(found) = device_prompt(clean) {
                            let mut s = peek.lock().unwrap_or_else(|p| p.into_inner());
                            if s.as_ref() != Some(&found) {
                                *s = Some(found.clone());
                                if let Ok(mut g) = peek_app.state::<SignIns>().device.lock() {
                                    *g = Some(found);
                                }
                                let _ = peek_app.emit(EVENT, ());
                            }
                        }
                    }
                    false
                },
            );
            let code = seen.lock().ok().and_then(|s| s.as_ref().map(|d| d.1.clone()));
            (out, ended, code)
        });
        finish(&app, result.err().filter(|e| e.reason != "cancelled"));
    });
    Ok(())
}

#[tauri::command]
pub fn codex_account_cancel(app: AppHandle, sign_ins: tauri::State<'_, SignIns>) {
    // ACCT-002: with nothing running, Cancel wipes a leftover needs-attention state.
    let running = sign_ins.running.lock().map(|r| r.is_some()).unwrap_or(false);
    match sign_ins.cancel.lock().ok().and_then(|c| c.clone()) {
        Some(flag) if running => flag.store(true, Ordering::SeqCst),
        _ => {
            if let Ok(mut g) = sign_ins.attention.lock() {
                *g = None;
            }
            let _ = app.emit(EVENT, ());
        }
    }
}

/// ACCT-019: a sign-in file missing for a moment (Codex rewriting it) is not yet a warning.
pub const MISSING_GRACE: Duration = Duration::from_secs(30);
pub fn missing_now(seen: &mut std::collections::HashMap<String, std::time::Instant>, id: &str, present: bool, now: std::time::Instant) -> bool {
    if present {
        seen.remove(id);
        return false;
    }
    now.duration_since(*seen.entry(id.into()).or_insert(now)) >= MISSING_GRACE
}

pub const CUSTOM_PROVIDER_REFUSAL: &str = "Your Codex settings send Codex to a custom model provider, so a ChatGPT account cannot be added. Stay on the system default, or switch Codex's model_provider back to OpenAI first. Your settings were not changed.";

/// The user's own Codex settings (CODEX_HOME, else .codex in the user's home) name a custom
/// model provider. Read only.
pub fn user_custom_provider(codex_home_env: Option<&str>, user_home: Option<&Path>) -> bool {
    let home = codex_home_env.map(str::trim).filter(|h| !h.is_empty()).map(PathBuf::from).or_else(|| user_home.map(|u| u.join(".codex")));
    home.is_some_and(|h| custom_provider(&fs::read_to_string(h.join("config.toml")).unwrap_or_default()))
}

/// ACCT-021: the user's own Codex settings folder: CODEX_HOME, else .codex in the user's home.
pub fn user_dir(codex_home_env: Option<&str>, user_home: Option<&Path>) -> Option<PathBuf> {
    codex_home_env.map(str::trim).filter(|h| !h.is_empty()).map(PathBuf::from).or_else(|| user_home.map(|u| u.join(".codex")))
}

/// ACCT-021: the user's Codex settings, or the plain reason they cannot be copied.
fn user_settings(user: &Path) -> Result<toml_edit::DocumentMut, String> {
    let text = match fs::read_to_string(user.join("config.toml")) {
        Ok(t) => t,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Err("Codex has no settings file (config.toml) yet, so the accounts run on Codex's defaults.".into()),
        Err(e) => return Err(format!("Codex's settings file could not be read (antivirus or another program may have it locked), so the accounts keep the settings they had: {e}")),
    };
    if text.trim().is_empty() {
        return Err("Codex's settings file is empty, so the accounts run on Codex's defaults.".into());
    }
    text.parse().map_err(|_| "Codex's settings file is not valid TOML, so the accounts keep the settings they had.".to_string())
}

/// ACCT-021: before a launch, the user's Codex settings are copied into an account's home. The
/// home keeps Kolux's sign-in line, the project trust Codex wrote there and Kolux's hook trust
/// (the home's entry wins). True when the home's file changed; an error is the warning to show,
/// and the home is then left as it was.
/// ponytail: a trust entry Codex writes between the last read and the rename is lost; the file is
/// read again just before writing and the copy redone up to three times, a file lock if that shows.
pub fn sync_settings(user: &Path, home: &Path) -> Result<bool, String> {
    let mut doc = user_settings(user)?;
    doc["cli_auth_credentials_store"] = toml_edit::value("file");
    let file = home.join("config.toml");
    for _ in 0..3 {
        let old = fs::read_to_string(&file).unwrap_or_default();
        let mine: toml_edit::DocumentMut = old.parse().unwrap_or_default();
        let mut out = doc.clone();
        for key in ["projects", "hooks"] {
            let Some(kept) = mine.get(key).and_then(toml_edit::Item::as_table) else { continue };
            if !out.get(key).is_some_and(toml_edit::Item::is_table) {
                out[key] = toml_edit::table();
            }
            let into = out[key].as_table_mut().expect("a table was just put here");
            for (k, v) in kept.iter() {
                into.insert(k, v.clone());
            }
        }
        let text = out.to_string();
        if text == old {
            return Ok(false);
        }
        if fs::read_to_string(&file).unwrap_or_default() != old {
            continue;
        }
        crate::trust::write_whole(&file, &text)?;
        return Ok(true);
    }
    Err("Codex kept changing this account's settings file, so the copy was skipped this time.".into())
}

/// Deletes a folder, retrying for about two seconds while Windows still holds a file in it.
pub fn remove_dir_patiently(dir: &Path) -> std::io::Result<()> {
    let mut tries = 0;
    loop {
        match fs::remove_dir_all(dir) {
            Ok(()) => return Ok(()),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(()),
            Err(e) if tries >= 10 => return Err(e),
            Err(_) => {
                tries += 1;
                std::thread::sleep(Duration::from_millis(200));
            }
        }
    }
}

/// None makes Codex's own login the one new Codex panes use.
pub fn activate(store: &Store, id: Option<&str>) -> Result<(), String> {
    if let Some(id) = id {
        if !load(store).iter().any(|a| a.id == id) {
            return Err("That Codex account is no longer listed.".into());
        }
    }
    store.set(ACTIVE_KEY, id.unwrap_or("")).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn codex_account_activate(app: AppHandle, store: tauri::State<'_, Mutex<Store>>, id: Option<String>) -> Result<(), String> {
    activate(&*store.lock().map_err(|e| e.to_string())?, id.as_deref())?;
    let _ = app.emit(EVENT, ());
    Ok(())
}

/// Takes the account off the list, deletes its home (only one inside Kolux's own folder) and
/// sealed copy, and hands new panes back to the system default when it was the active one.
pub fn remove(store: &Store, profile: &Path, id: &str) -> Result<(), String> {
    let mut list = load(store);
    let Some(at) = list.iter().position(|a| a.id == id) else {
        return Err("That Codex account is no longer listed.".into());
    };
    let gone = list.remove(at);
    store.set(LIST_KEY, &serde_json::to_string(&list).map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
    if store.get(ACTIVE_KEY).ok().flatten().as_deref() == Some(id) {
        store.set(ACTIVE_KEY, "").map_err(|e| e.to_string())?;
    }
    let home = PathBuf::from(&gone.home);
    if home.starts_with(profile.join(FOLDER)) {
        remove_dir_patiently(&home).map_err(|e| format!("The account was removed, but its Codex home could not be deleted: {e}"))?;
    }
    let _ = fs::remove_file(profile.join(secrets::VAULT).join(format!("codex-{id}.json")));
    Ok(())
}

#[tauri::command]
pub fn codex_account_remove(app: AppHandle, store: tauri::State<'_, Mutex<Store>>, sign_ins: tauri::State<'_, SignIns>, id: String) -> Result<(), String> {
    if sign_ins.running.lock().map_err(|e| e.to_string())?.is_some() {
        return Err("Finish or cancel the sign-in first.".into());
    }
    let profile = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let result = remove(&*store.lock().map_err(|e| e.to_string())?, &profile, &id);
    let _ = app.emit(EVENT, ());
    result
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_resumed_pane_gets_its_own_home_or_none() {
        let on_disk = temp("resume");
        let acct = |id: &str, home: &Path| Account { id: id.into(), email: None, home: home.to_string_lossy().into_owned(), last_sign_in: 0, sign_in_error: false, label: None };
        let accounts = [acct("a", &on_disk), acct("b", &on_disk.join("missing"))];
        assert_eq!(resume_home(&accounts, "a"), Some(Some(on_disk.to_string_lossy().into_owned())));
        assert_eq!(resume_home(&accounts, "b"), Some(None));
        assert_eq!(resume_home(&accounts, "gone"), None);
        let _ = fs::remove_dir_all(&*on_disk);
    }

    // ACCT-021: the user's settings reach the account's home; the sign-in line, the trust Codex
    // wrote for a project and Kolux's hook trust stay; a later edit is picked up next time.
    #[test]
    fn the_users_codex_settings_are_copied_without_touching_trust() {
        let dir = crate::test_dir::temp("codex-sync");
        let (user, home) = (dir.join("user"), dir.join("home"));
        fs::create_dir_all(&user).unwrap();
        fs::create_dir_all(&home).unwrap();
        fs::write(user.join("config.toml"), "model = \"o3\"\n[projects.'C:\\work']\ntrust_level = \"untrusted\"\n[tui]\nnotifications = true\n").unwrap();
        fs::write(home.join("config.toml"), format!("{HOME_CONFIG}[projects.'C:\\work']\ntrust_level = \"trusted\"\n[projects.'D:\\x']\ntrust_level = \"trusted\"\n[hooks.state]\nk = 1\n")).unwrap();
        assert_eq!(sync_settings(&user, &home), Ok(true));
        let doc: toml_edit::DocumentMut = fs::read_to_string(home.join("config.toml")).unwrap().parse().unwrap();
        assert_eq!(doc["model"].as_str(), Some("o3"));
        assert_eq!(doc["cli_auth_credentials_store"].as_str(), Some("file"));
        assert_eq!(doc["projects"]["C:\\work"]["trust_level"].as_str(), Some("trusted"), "the home's trust entry wins");
        assert_eq!(doc["projects"]["D:\\x"]["trust_level"].as_str(), Some("trusted"));
        assert_eq!(doc["hooks"]["state"]["k"].as_integer(), Some(1));
        assert_eq!(doc["tui"]["notifications"].as_bool(), Some(true));
        assert!(!config_drift(&home));
        assert_eq!(sync_settings(&user, &home), Ok(false), "nothing new: the file is left as it is");
        fs::write(user.join("config.toml"), "model = \"o4\"\n").unwrap();
        assert_eq!(sync_settings(&user, &home), Ok(true));
        let doc: toml_edit::DocumentMut = fs::read_to_string(home.join("config.toml")).unwrap().parse().unwrap();
        assert_eq!((doc["model"].as_str(), doc["projects"]["D:\\x"]["trust_level"].as_str()), (Some("o4"), Some("trusted")));
    }

    // ACCT-021: a missing, empty, unreadable or broken settings file is a plain warning and the
    // home is left alone, so the launch goes on.
    #[test]
    fn a_settings_file_that_cannot_be_copied_is_a_warning_and_the_home_is_kept() {
        let dir = crate::test_dir::temp("codex-sync-bad");
        let (user, home) = (dir.join("user"), dir.join("home"));
        fs::create_dir_all(&user).unwrap();
        fs::create_dir_all(&home).unwrap();
        fs::write(home.join("config.toml"), HOME_CONFIG).unwrap();
        let warn = |w: &str| sync_settings(&user, &home).unwrap_err().contains(w);
        assert!(warn("no settings file"));
        fs::write(user.join("config.toml"), " \n").unwrap();
        assert!(warn("is empty"));
        fs::write(user.join("config.toml"), "model = \n").unwrap();
        assert!(warn("not valid TOML"));
        fs::remove_file(user.join("config.toml")).unwrap();
        fs::create_dir_all(user.join("config.toml")).unwrap();
        assert!(warn("could not be read"));
        assert_eq!(fs::read_to_string(home.join("config.toml")).unwrap(), HOME_CONFIG);
        assert_eq!(user_dir(Some(" "), Some(&dir)), Some(dir.join(".codex")));
        assert_eq!(user_dir(Some("E:\\c"), Some(&dir)), Some(PathBuf::from("E:\\c")));
    }

    fn temp(name: &str) -> crate::test_dir::TempDir {
        crate::test_dir::temp(&format!("codex-acct-{name}"))
    }

    fn token(email: &str) -> String {
        let claims = base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(format!(r#"{{"email":"{email}"}}"#));
        format!(r#"{{"OPENAI_API_KEY":null,"tokens":{{"id_token":"h.{claims}.s","access_token":"fake"}}}}"#)
    }

    #[test]
    fn device_prompt_waits_for_both_the_link_and_the_code() {
        assert_eq!(device_prompt("Follow these steps to sign in:\n1. Open this link: https://auth.example.com/device"), None);
        let both = "1. Open this link in your browser:\n   https://auth.example.com/device\n2. Enter this one-time code: ABCD-12345\n";
        assert_eq!(device_prompt(both), Some(("https://auth.example.com/device".into(), "ABCD-12345".into())));
        assert_eq!(device_prompt("https://x.example.com/a and Codex-CLI words"), None, "mixed-case words are not a code");
        // The console host places lines with cursor moves, not line breaks (seen live).
        let placed = crate::claude_key::strip_ansi("\u{1b}[4;1H   https://auth.example.com/device\u{1b}[6;1H2. Enter this one-time code\u{1b}[7;1H\u{1b}[3CWXYZ-6789");
        assert_eq!(device_prompt(&placed), Some(("https://auth.example.com/device".into(), "WXYZ-6789".into())));
    }

    #[test]
    fn a_home_whose_config_no_longer_keeps_the_sign_in_in_its_file_has_drifted() {
        let d = temp("drift");
        let home = d.as_path();
        assert!(config_drift(home), "no config.toml at all");
        fs::write(home.join("config.toml"), HOME_CONFIG).unwrap();
        assert!(!config_drift(home), "what Kolux wrote");
        fs::write(home.join("config.toml"), "model = \"o3\"\ncli_auth_credentials_store = 'file' # kept\n[tui]\n").unwrap();
        assert!(!config_drift(home), "other keys and a comment are fine");
        fs::write(home.join("config.toml"), "cli_auth_credentials_store = \"keyring\"\n").unwrap();
        assert!(config_drift(home));
        fs::write(home.join("config.toml"), "[x]\ncli_auth_credentials_store = \"file\"\n").unwrap();
        assert!(config_drift(home), "inside a table it is not the top-level setting");
        fs::write(home.join("config.toml"), format!("{HOME_CONFIG}model_provider = \"ollama\"\n")).unwrap();
        assert!(config_drift(home));
    }

    #[test]
    fn a_codex_that_rejects_its_arguments_is_not_a_refused_sign_in() {
        let clap = "error: unexpected argument '--device-auth' found\n\nUsage: codex login\n\nFor more information, try '--help'.\n";
        let a = failure(&Ended::Exited(Some(2)), clap, None);
        assert_eq!((a.reason, a.message.contains("did not accept")), ("unknown", true));
        assert_eq!(failure(&Ended::Exited(Some(1)), "Login was not completed\n", None).reason, "sign-in-refused");
    }

    #[test]
    fn the_system_default_login_is_read_truthfully() {
        let user = temp("default");
        let codex = user.join(".codex");
        fs::create_dir_all(&codex).unwrap();
        assert_eq!(system_default(None, Some(&user)), "signed-out");
        fs::write(codex.join("config.toml"), "model_provider = \"ollama\"\n[profiles.x]\n").unwrap();
        assert_eq!(system_default(None, Some(&user)), "custom-provider");
        fs::write(codex.join("config.toml"), "[model_providers.x]\nmodel_provider = \"x\"\n").unwrap();
        assert_eq!(system_default(None, Some(&user)), "signed-out", "only the top-level key counts");
        fs::write(codex.join("auth.json"), r#"{"OPENAI_API_KEY":"k","tokens":null}"#).unwrap();
        assert_eq!(system_default(None, Some(&user)), "api-key");
        fs::write(codex.join("auth.json"), token("a@example.com")).unwrap();
        assert_eq!(system_default(None, Some(&user)), "chatgpt");
        let env = temp("default-env");
        assert_eq!(system_default(env.to_str(), Some(&user)), "signed-out", "CODEX_HOME wins over ~/.codex");
    }

    #[test]
    fn removing_the_active_account_hands_codex_back_to_the_system_default() {
        let profile = temp("remove");
        let store = Mutex::new(Store::open(&profile).unwrap());
        let ok = |email: &'static str| move |home: &Path| {
            fs::write(home.join("auth.json"), token(email)).unwrap();
            (String::new(), Ended::Exited(Some(0)), None)
        };
        sign_in(&store, &profile, "c1", 1, ok("kim@example.com")).unwrap();
        sign_in(&store, &profile, "c2", 2, ok("kim@example.com")).unwrap();
        let s = store.lock().unwrap();
        assert_eq!(load(&s).len(), 2, "one email can be two accounts (a personal and a business workspace)");
        assert_eq!(active_account(&s).unwrap().id, "c2");
        remove(&s, &profile, "c2").unwrap();
        assert!(active_account(&s).is_none() && active_home(&s).is_none(), "the system default takes over");
        assert!(!profile.join(FOLDER).join("c2").exists() && !profile.join("vault").join("codex-c2.json").exists());
        activate(&s, Some("c1")).unwrap();
        assert!(activate(&s, Some("c2")).is_err());
        assert_eq!(active_account(&s).unwrap().id, "c1", "a failed change keeps the earlier choice");
        activate(&s, None).unwrap();
        assert!(active_account(&s).is_none());
    }

    #[test]
    fn two_sign_ins_on_one_email_can_be_named_apart_and_keep_their_names() {
        let profile = temp("label");
        let store = Mutex::new(Store::open(&profile).unwrap());
        let ok = |email: &'static str| move |home: &Path| {
            fs::write(home.join("auth.json"), token(email)).unwrap();
            (String::new(), Ended::Exited(Some(0)), None)
        };
        sign_in(&store, &profile, "c1", 1, ok("kim@example.com")).unwrap();
        sign_in(&store, &profile, "c2", 2, ok("kim@example.com")).unwrap();
        {
            let s = store.lock().unwrap();
            set_label(&s, "c1", "  Personal  ").unwrap();
            set_label(&s, "c2", &"W".repeat(80)).unwrap();
            let list = load(&s);
            assert_eq!(list[0].label.as_deref(), Some("Personal"), "trimmed");
            assert_eq!(list[1].label.as_ref().map(|l| l.chars().count()), Some(LABEL_MAX), "capped");
            assert!(set_label(&s, "gone", "x").is_err());
        }
        sign_in(&store, &profile, "c1", 3, ok("kim.new@example.com")).unwrap();
        let s = store.lock().unwrap();
        assert_eq!(load(&s)[0].label.as_deref(), Some("Personal"), "signing in again keeps the name");
        set_label(&s, "c1", "   ").unwrap();
        assert_eq!(load(&s)[0].label, None, "a blank name clears it");
    }

    #[test]
    fn a_missing_sign_in_file_warns_only_after_the_grace_period() {
        let mut seen = std::collections::HashMap::new();
        let t0 = std::time::Instant::now();
        assert!(!missing_now(&mut seen, "c1", false, t0));
        assert!(!missing_now(&mut seen, "c1", false, t0 + Duration::from_secs(5)));
        assert!(missing_now(&mut seen, "c1", false, t0 + MISSING_GRACE));
        assert!(!missing_now(&mut seen, "c1", true, t0 + MISSING_GRACE), "back again: no warning");
        assert!(!missing_now(&mut seen, "c1", false, t0 + MISSING_GRACE * 2), "the clock starts over");
    }

    #[test]
    fn a_custom_model_provider_in_the_users_settings_refuses_a_chatgpt_account() {
        let user = temp("provider");
        fs::create_dir_all(user.join(".codex")).unwrap();
        assert!(!user_custom_provider(None, Some(&user)));
        fs::write(user.join(".codex").join("config.toml"), r#"model_provider = "azure""#).unwrap();
        assert!(user_custom_provider(None, Some(&user)));
        let before = fs::read(user.join(".codex").join("config.toml")).unwrap();
        assert!(!user_custom_provider(Some(&user.join("elsewhere").to_string_lossy()), Some(&user)), "CODEX_HOME wins");
        assert_eq!(fs::read(user.join(".codex").join("config.toml")).unwrap(), before, "read only");
    }

    #[test]
    fn disconnect_deletes_only_what_kolux_made_for_the_account() {
        let profile = temp("disconnect");
        let own_user = temp("remove-own");
        let own = own_user.join(".codex");
        fs::create_dir_all(&own).unwrap();
        fs::write(own.join("auth.json"), token("me@example.com")).unwrap();
        let before = fs::read(own.join("auth.json")).unwrap();
        let store = Mutex::new(Store::open(&profile).unwrap());
        for (id, who) in [("c1", "kim@example.com"), ("c2", "lee@example.com")] {
            sign_in(&store, &profile, id, 7, |home| {
                fs::write(home.join("auth.json"), token(who)).unwrap();
                ("Successfully logged in".into(), Ended::Exited(Some(0)), None)
            })
            .unwrap();
        }
        let s = store.lock().unwrap();
        // An entry that points at the user's own folder is unlisted, never deleted.
        let mut list = load(&s);
        list.push(Account { id: "mine".into(), email: None, home: own.parent().unwrap().to_string_lossy().into_owned(), last_sign_in: 1, sign_in_error: false, label: None });
        s.set(LIST_KEY, &serde_json::to_string(&list).unwrap()).unwrap();
        assert_eq!(active_account(&s).map(|a| a.id), Some("c2".into()));
        remove(&s, &profile, "c2").unwrap();
        assert!(!profile.join(FOLDER).join("c2").exists() && !profile.join("vault").join("codex-c2.json").exists());
        assert_eq!(active_account(&s), None, "the removed account is no longer active");
        assert!(profile.join(FOLDER).join("c1").is_dir() && profile.join("vault").join("codex-c1.json").is_file());
        remove(&s, &profile, "mine").unwrap();
        assert_eq!(load(&s).iter().map(|a| a.id.as_str()).collect::<Vec<_>>(), ["c1"]);
        assert_eq!(fs::read(own.join("auth.json")).unwrap(), before, "the user's own Codex login is untouched");
        assert_eq!(system_default(None, own.parent()), "chatgpt");
        assert!(remove(&s, &profile, "c2").is_err());
    }

    #[test]
    fn a_new_sign_in_lands_in_its_own_home_and_becomes_active() {
        let profile = temp("ok");
        let store = Mutex::new(Store::open(&profile).unwrap());
        let a = sign_in(&store, &profile, "c1", 7, |home| {
            assert!(home.ends_with("codex-accounts/c1") || home.ends_with("codex-accounts\\c1"));
            assert!(fs::read_to_string(home.join("config.toml")).unwrap().contains("\"file\""));
            fs::write(home.join("auth.json"), token("kim@example.com")).unwrap();
            ("Successfully logged in".into(), Ended::Exited(Some(0)), None)
        })
        .unwrap();
        assert_eq!(a.email.as_deref(), Some("kim@example.com"));
        let s = store.lock().unwrap();
        assert_eq!(active_home(&s), Some(a.home.clone()));
        let vault = fs::read_to_string(profile.join("vault").join("codex-c1.json")).unwrap();
        assert!(!vault.contains("kim@example.com") && !vault.contains("fake"), "the kept copy is sealed");
        assert_eq!(pane_env(Some("codex"), active_home(&s)), Some((HOME_ENV, a.home)));
        assert_eq!(pane_env(Some("claude"), active_home(&s)), None);
    }

    #[test]
    fn signing_in_again_updates_the_account_in_place_and_clears_its_error() {
        let profile = temp("again");
        let store = Mutex::new(Store::open(&profile).unwrap());
        let ok = |email: &'static str| move |home: &Path| {
            fs::write(home.join("auth.json"), token(email)).unwrap();
            (String::new(), Ended::Exited(Some(0)), None)
        };
        sign_in(&store, &profile, "c1", 1, ok("kim@example.com")).unwrap();
        sign_in(&store, &profile, "c2", 2, ok("lee@example.com")).unwrap();
        {
            let s = store.lock().unwrap();
            assert!(mark_sign_in_error(&s, "c1", true).unwrap());
            assert!(!mark_sign_in_error(&s, "c1", true).unwrap(), "no change, no write");
            assert_eq!(active_account(&s).unwrap().id, "c2");
        }
        // a login that leaves the old sign-in untouched does not count, and keeps the home
        let e = sign_in(&store, &profile, "c1", 3, |_| (String::new(), Ended::Exited(Some(0)), None)).unwrap_err();
        assert_eq!(e.reason, "sign-in-refused");
        assert!(profile.join(FOLDER).join("c1").join("auth.json").exists());
        sign_in(&store, &profile, "c1", 4, ok("kim2@example.com")).unwrap();
        let s = store.lock().unwrap();
        let list = load(&s);
        assert_eq!(list.len(), 2, "updated in place, not added");
        assert!(!list[0].sign_in_error && list[0].email.as_deref() == Some("kim2@example.com") && list[0].last_sign_in == 4);
        assert_eq!(active_account(&s).unwrap().id, "c2", "signing in again does not change the active account");
    }

    #[test]
    fn a_failed_sign_in_keeps_nothing_but_never_deletes_a_working_home() {
        let profile = temp("fail");
        let store = Mutex::new(Store::open(&profile).unwrap());
        let e = sign_in(&store, &profile, "c2", 1, |_| ("Enter this one-time code: WXYZ-9876\nError: device code expired".into(), Ended::Exited(Some(1)), Some("WXYZ-9876".into()))).unwrap_err();
        assert!(!e.message.contains("WXYZ-9876") && !e.message.contains("https://"), "{e}");
        assert!(!profile.join(FOLDER).join("c2").exists());
        let e = sign_in(&store, &profile, "c3", 1, |home| {
            fs::write(home.join("auth.json"), token("kim@example.com")).unwrap();
            (String::new(), Ended::Cancelled, None)
        })
        .unwrap_err();
        assert_eq!(e, "Sign-in cancelled.");
        assert!(profile.join(FOLDER).join("c3").join("auth.json").exists(), "a home with a working sign-in stays");
        assert!(load(&store.lock().unwrap()).is_empty());
    }

    #[test]
    fn acct_024_a_codex_pane_waits_for_the_chosen_sign_in() {
        use std::cell::{Cell, RefCell};
        // FIX-4: no wall clock. The wait is counted in polls: it runs out after `budget` pauses, and a
        // pause takes no time, so a loaded machine cannot change what these cases see.
        let pauses = Cell::new(0u32);
        let budget = 50;
        let wait = |signed: &dyn Fn(&str) -> bool, active: &mut dyn FnMut() -> Option<String>| {
            pauses.set(0);
            ready_home_by(&mut *active, signed, || pauses.get() >= budget, || pauses.set(pauses.get() + 1))
        };
        // already signed in: no wait
        assert_eq!(wait(&|h| h == "a", &mut || Some("a".into())), Ok(Some("a".into())));
        assert_eq!(pauses.get(), 0);
        // no managed account: the system default, at once
        assert_eq!(wait(&|_| false, &mut || None), Ok(None));
        assert_eq!(pauses.get(), 0);
        // the sign-in lands while waiting (on the fifth look, so after four pauses)
        let n = RefCell::new(0);
        assert_eq!(wait(&|_| { *n.borrow_mut() += 1; *n.borrow() > 4 }, &mut || Some("a".into())), Ok(Some("a".into())));
        assert_eq!(pauses.get(), 4);
        // never lands: the pane starts on the system-default login instead of hanging, after exactly the budget
        assert_eq!(wait(&|_| false, &mut || Some("a".into())), Ok(None));
        assert_eq!(pauses.get(), budget);
        // the account is changed while waiting: the new one wins
        let calls = RefCell::new(0);
        let mut switching = || { *calls.borrow_mut() += 1; Some(if *calls.borrow() > 2 { "b" } else { "a" }.to_string()) };
        assert_eq!(wait(&|h| h == "b", &mut switching), Ok(Some("b".into())));
        // one choice after another without a sign-in: not started, asked to open it again
        let calls = RefCell::new(0);
        let mut switching = || { *calls.borrow_mut() += 1; Some(if *calls.borrow() > 2 { "b" } else { "a" }.to_string()) };
        assert!(wait(&|_| false, &mut switching).unwrap_err().contains("Open it again"));
        assert_eq!(pauses.get(), budget);
        // the real-clock wrapper with no time to wait: a sign-in that is there is taken, one that is not gives the system default, nothing sleeps
        let none = Duration::ZERO;
        assert_eq!(ready_home(|| Some("a".into()), |h| h == "a", none, none), Ok(Some("a".into())));
        assert_eq!(ready_home(|| Some("a".into()), |_| false, none, none), Ok(None));
        assert_eq!(ready_home(|| None, |_| false, none, none), Ok(None));
    }
}
