//! ACCT-005: sign a Claude account in through the browser and keep it as a managed account.
//! ACCT-006: Claude sign-ins are renewed by default, with an opt-out.
//!
//! Every managed account gets a private Claude configuration folder of its own
//! (`<profile>\claude-accounts\<id>`). Kolux runs Claude Code's own `claude auth login` inside it,
//! hidden (the ConPTY runner of ACCT-004), and keeps the credentials that login wrote there, with
//! a sealed copy in the vault (`<profile>\vault\claude-<id>.json`, ACCT-009). A login that quits
//! early or leaves no new credentials adds nothing; a failed re-authentication puts the earlier
//! credentials back. New Claude panes run on the active account through `CLAUDE_CONFIG_DIR`,
//! unless the 1-year key (ACCT-004) is connected: key mode wins.
//!
//! ACCT-006 under OD-01 (DECISIONS.md, DT-A2): the opt-out ships switched on, so sign-in upkeep is
//! left to Claude Code itself, which refreshes its own sign-in in every pane it runs; Kolux sends
//! nothing to Anthropic's token service and never flags an account as needing re-auth for a
//! renewal. Kolux's own renewal (opt-out off) is T-043-d.
//! ponytail: the macOS keychain rules (ACCT-005) are a rule table in keychain.rs (T-043-e), not yet
//! called from here; wiring them in needs a Mac (T-043-f). This build keeps the credentials file.

use crate::claude_key::{run_hidden, Attention, Ended};
use crate::{secrets, state::Store};
use portable_pty::CommandBuilder;
use serde_json::Value;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager};

/// Store keys: the managed accounts, and which one new Claude panes use.
pub const LIST_KEY: &str = "claudeAccounts";
pub const ACTIVE_KEY: &str = "claudeActiveAccount";
/// Settings field of the ACCT-006 opt-out; absent means on (OD-01).
pub const UPKEEP_FIELD: &str = "claudeSignInUpkeepByClaudeCode";
pub const CONFIG_ENV: &str = "CLAUDE_CONFIG_DIR";
pub const CREDENTIALS: &str = ".credentials.json";
pub const FOLDER: &str = "claude-accounts";
pub const EVENT: &str = "claude-accounts";
pub const LOGIN_LIMIT: Duration = Duration::from_secs(600);
const STATUS_LIMIT: Duration = Duration::from_secs(20);

#[derive(serde::Serialize, serde::Deserialize, Debug, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Account {
    pub id: String,
    pub email: Option<String>,
    pub organization: Option<String>,
    /// The account's private Claude configuration folder: where it runs.
    pub config_dir: String,
    /// Milliseconds since 1970 of the last good sign-in.
    pub last_sign_in: i64,
    /// ACCT-012: Claude Code no longer reports this account signed in; Sign in again clears it.
    #[serde(default)]
    pub stale: bool,
}

/// ACCT-025: each listed account's live sign-in file and its sealed copy in the vault.
pub fn sign_in_files(store: &Store, profile: &Path) -> Vec<(PathBuf, PathBuf)> {
    load(store).into_iter().map(|a| (profile.join(FOLDER).join(&a.id).join(CREDENTIALS), profile.join(secrets::VAULT).join(format!("claude-{}.json", a.id)))).collect()
}

pub fn load(store: &Store) -> Vec<Account> {
    store.get(LIST_KEY).ok().flatten().and_then(|t| serde_json::from_str(&t).ok()).unwrap_or_default()
}

fn save(store: &Store, list: &[Account]) -> Result<(), String> {
    store.set(LIST_KEY, &serde_json::to_string(list).map_err(|e| e.to_string())?).map_err(|e| e.to_string())
}

pub fn active(store: &Store) -> Option<String> {
    store.get(ACTIVE_KEY).ok().flatten().filter(|id| load(store).iter().any(|a| &a.id == id))
}

/// ACCT-006 with OD-01: the opt-out is on unless the user turned it off.
pub fn upkeep_left_to_claude(settings: &Value) -> bool {
    settings.get(UPKEEP_FIELD).and_then(Value::as_bool).unwrap_or(true)
}

/// The variable a new pane gets for the managed account: only a Claude pane, only when the 1-year
/// key is not the connection (key mode wins), only with an active account.
pub fn pane_env(program: Option<&str>, key_mode: bool, active_dir: Option<String>) -> Option<(&'static str, String)> {
    if key_mode || crate::agents::credited_agent(program?) != Some("claude") {
        return None;
    }
    active_dir.map(|d| (CONFIG_ENV, d))
}

/// ACCT-024: the variables in the user's own per-agent settings that would sign a Claude pane in
/// past its managed account. An empty value blanks the variable and is fine; so is anything that is
/// not a sign-in, such as a custom endpoint. Windows compares names without case.
pub fn sign_in_overrides(own_env: &[(String, String)], windows: bool) -> Vec<String> {
    const SIGN_INS: [&str; 3] = ["ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN", crate::claude_key::ENV];
    own_env
        .iter()
        .filter(|(k, v)| !v.is_empty() && SIGN_INS.iter().any(|s| if windows { s.eq_ignore_ascii_case(k) } else { s == k }))
        .map(|(k, _)| k.clone())
        .collect()
}

fn text<'a>(v: &'a Value, keys: &[&str]) -> Option<&'a str> {
    keys.iter().find_map(|k| v.get(*k).and_then(Value::as_str)).filter(|s| !s.trim().is_empty())
}

/// Email and organisation from `claude auth status --json`; `None` when it is not signed in.
/// ponytail: the signed-in field names are not published; the common spellings are tried.
pub fn identity(json: &str) -> Option<(Option<String>, Option<String>)> {
    let v: Value = serde_json::from_str(json.trim()).ok()?;
    if v.get("loggedIn").and_then(Value::as_bool) != Some(true) {
        return None;
    }
    let account = v.get("account").unwrap_or(&Value::Null);
    let email = text(&v, &["email", "emailAddress"]).or_else(|| text(account, &["email", "emailAddress"]));
    let org = text(&v, &["orgName", "organizationName", "organization"])
        .or_else(|| v.get("organization").and_then(|o| text(o, &["name"])))
        .or_else(|| text(account, &["orgName", "organizationName"]));
    Some((email.map(str::to_string), org.map(str::to_string)))
}

/// The credentials a login left behind, if Kolux may keep them: present, and not the very ones
/// that were there before it.
pub fn fresh_credentials(before: Option<&str>, after: Option<String>) -> Option<String> {
    after.filter(|a| !a.trim().is_empty() && Some(a.as_str()) != before)
}

/// Keeps sign-in links and codes out of a message (ACCT-005, ACCT-011).
pub fn scrub(message: &str) -> String {
    message
        .split_whitespace()
        .map(|w| {
            if w.contains("://") {
                "[link removed]"
            } else if w.chars().filter(|c| c.is_ascii_alphanumeric()).count() >= 16 && w.chars().all(|c| c.is_ascii_alphanumeric() || "-_.#=".contains(c)) {
                "[code removed]"
            } else {
                w
            }
        })
        .collect::<Vec<_>>()
        .join(" ")
}

/// Why a login did not give Kolux an account, in plain words.
pub fn failure(ended: &Ended, output: &str) -> Attention {
    match ended {
        Ended::Cancelled => Attention::new("cancelled", "Sign-in cancelled."),
        Ended::TimedOut => Attention::new("browser-blocked", "The browser sign-in was not finished within 10 minutes."),
        Ended::NotStarted(e) => format!("Claude Code's sign-in could not start: {}", scrub(e)).into(),
        Ended::Exited(_) | Ended::Stopped => {
            let last = output.lines().map(str::trim).rfind(|l| !l.is_empty()).unwrap_or("");
            if last.is_empty() {
                Attention::new("sign-in-refused", "Claude Code's sign-in ended without signing in.")
            } else {
                Attention::new("sign-in-refused", format!("Claude Code's sign-in ended without signing in: {}", scrub(last)))
            }
        }
    }
}

fn read(path: &Path) -> Option<String> {
    fs::read_to_string(path).ok()
}

fn hide(cmd: &mut std::process::Command) {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
    }
    #[cfg(not(windows))]
    let _ = cmd;
}

/// `claude auth status --json` inside `dir` (None: Claude Code's own sign-in, as a plain pane
/// would see it), hidden, given up on after 20 s.
pub fn auth_status(program: &Path, dir: Option<&Path>) -> Option<String> {
    let mut cmd = std::process::Command::new(program);
    cmd.args(["auth", "status", "--json"]).env_remove(crate::claude_key::ENV);
    if let Some(dir) = dir {
        cmd.env(CONFIG_ENV, dir);
    }
    cmd.stdin(std::process::Stdio::null()).stdout(std::process::Stdio::piped()).stderr(std::process::Stdio::null());
    hide(&mut cmd);
    let mut child = cmd.spawn().ok()?;
    let deadline = std::time::Instant::now() + STATUS_LIMIT;
    loop {
        match child.try_wait() {
            Ok(Some(_)) => break,
            Ok(None) if std::time::Instant::now() < deadline => std::thread::sleep(Duration::from_millis(100)),
            _ => {
                let _ = child.kill();
                return None;
            }
        }
    }
    let mut out = String::new();
    std::io::Read::read_to_string(child.stdout.as_mut()?, &mut out).ok()?;
    Some(out)
}

/// The command a sign-in runs: `claude auth login` with the account's folder.
pub fn login_command(program: &Path, dir: &Path) -> CommandBuilder {
    let mut cmd = CommandBuilder::new(program.as_os_str());
    cmd.args(["auth", "login"]);
    cmd.env(CONFIG_ENV, dir.as_os_str());
    // The login must not pick up the 1-year key.
    cmd.env_remove(crate::claude_key::ENV);
    cmd
}

/// One sign-in, new (`existing` = None) or again. Runs `login` (the hidden `claude auth login`
/// in `dir`), then `status` for who signed in. On success the account is listed and its
/// credentials sealed into the vault; on failure nothing partial is kept and an existing
/// account's earlier credentials are put back.
#[allow(clippy::too_many_arguments)]
pub fn sign_in(store: &Mutex<Store>, profile: &Path, id: &str, existing: bool, now: i64, login: impl FnOnce(&Path) -> (String, Ended), status: impl FnOnce(&Path) -> Option<String>) -> Result<Account, Attention> {
    let dir = profile.join(FOLDER).join(id);
    let creds = dir.join(CREDENTIALS);
    let vault = profile.join(secrets::VAULT).join(format!("claude-{id}.json"));
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let before = read(&creds);
    let undo = |before: &Option<String>| {
        if existing {
            let earlier = before.clone().or_else(|| secrets::read_file(&vault, profile).ok().flatten());
            if let Some(e) = earlier {
                let _ = fs::write(&creds, e);
            }
        } else {
            let _ = fs::remove_dir_all(&dir);
        }
    };
    let (output, ended) = login(&dir);
    let fresh = match ended {
        Ended::Exited(_) => fresh_credentials(before.as_deref(), read(&creds)),
        _ => None,
    };
    let Some(fresh) = fresh else {
        undo(&before);
        return Err(failure(&ended, &output));
    };
    let Some((email, organization)) = status(&dir).as_deref().and_then(identity) else {
        undo(&before);
        return Err(Attention::new("sign-in-refused", "Claude Code did not report a signed-in account after the browser step."));
    };
    if !existing {
        let twin = load(&*store.lock().map_err(|e| e.to_string())?).into_iter().find(|a| same_account(a, email.as_deref(), organization.as_deref()));
        if let Some(t) = twin {
            undo(&before);
            let who = [t.email, t.organization].into_iter().flatten().collect::<Vec<_>>().join(" · ");
            return Err(Attention::new("unknown", format!("{who} is already in the list, so nothing was added.")));
        }
    }
    if let Err(e) = secrets::write_file(&vault, &fresh) {
        undo(&before);
        return Err(format!("The sign-in could not be stored: {e}").into());
    }
    let account = Account { id: id.into(), email, organization, config_dir: dir.to_string_lossy().into_owned(), last_sign_in: now, stale: false };
    let store = store.lock().map_err(|e| e.to_string())?;
    let mut list = load(&store);
    match list.iter_mut().find(|a| a.id == id) {
        Some(a) => *a = account.clone(),
        None => list.push(account.clone()),
    }
    save(&store, &list)?;
    Ok(account)
}

/// The one sign-in that may run, and what the last one left behind.
#[derive(Default)]
pub struct SignIns {
    running: Mutex<Option<String>>,
    in_browser: AtomicBool,
    cancel: Mutex<Option<Arc<AtomicBool>>>,
    attention: Mutex<Option<Attention>>,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AccountsView {
    pub accounts: Vec<Account>,
    pub active: Option<String>,
    /// The account id a sign-in is running for (a new one has no row yet).
    pub signing_in: Option<String>,
    pub in_browser: bool,
    pub attention: Option<Attention>,
    /// The 1-year key is the Claude connection, so it wins for new panes.
    pub key_mode: bool,
    pub upkeep_left_to_claude: bool,
}

#[tauri::command(async)]
pub fn claude_accounts(store: tauri::State<'_, Mutex<Store>>, sign_ins: tauri::State<'_, SignIns>) -> Result<AccountsView, String> {
    let store = store.lock().map_err(|e| e.to_string())?;
    let settings = store.settings();
    Ok(AccountsView {
        accounts: load(&store),
        active: active(&store),
        signing_in: sign_ins.running.lock().ok().and_then(|r| r.clone()),
        in_browser: sign_ins.in_browser.load(Ordering::SeqCst),
        attention: sign_ins.attention.lock().ok().and_then(|a| a.clone()),
        key_mode: settings.get(crate::claude_key::MODE_FIELD).and_then(Value::as_str) == Some(crate::claude_key::KEY_MODE),
        upkeep_left_to_claude: upkeep_left_to_claude(&settings),
    })
}

/// Add Account (`id` = None) or Sign in again (`id` = that account).
#[tauri::command]
pub fn claude_account_sign_in(app: AppHandle, sign_ins: tauri::State<'_, SignIns>, id: Option<String>) -> Result<(), String> {
    let existing = id.is_some();
    let id = id.unwrap_or_else(|| format!("{:x}", crate::claude_key::now_ms()));
    {
        let mut running = sign_ins.running.lock().map_err(|e| e.to_string())?;
        if running.is_some() {
            return Err("A Claude sign-in is already in progress; finish it in the browser or cancel it first.".into());
        }
        *running = Some(id.clone());
    }
    let set = |a: Option<Attention>| {
        if let Ok(mut g) = sign_ins.attention.lock() {
            *g = a;
        }
    };
    let program = crate::agents::find_program("claude");
    let refused = match &program {
        None => Some(Attention::new("not-found", "Claude Code is not installed, so there is nothing to sign in with.")),
        Some(p) if crate::claude_key::is_wrapper(p) => Some(Attention::new("install-unavailable", "The installed Claude launcher is a script wrapper Kolux cannot start directly. Install Claude Code's native build and try again.")),
        _ => None,
    };
    if let Some(r) = refused {
        set(Some(r));
        if let Ok(mut g) = sign_ins.running.lock() {
            *g = None;
        }
        let _ = app.emit(EVENT, ());
        return Ok(());
    }
    let program = program.unwrap_or_default();
    let profile = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let cancel = Arc::new(AtomicBool::new(false));
    if let Ok(mut c) = sign_ins.cancel.lock() {
        *c = Some(cancel.clone());
    }
    sign_ins.in_browser.store(false, Ordering::SeqCst);
    set(None);
    let _ = app.emit(EVENT, ());
    std::thread::spawn(move || {
        let browser_app = app.clone();
        let store = app.state::<Mutex<Store>>();
        let result = sign_in(
            &store,
            &profile,
            &id,
            existing,
            crate::claude_key::now_ms(),
            |dir| {
                run_hidden(
                    login_command(&program, dir),
                    LOGIN_LIMIT,
                    cancel,
                    move || {
                        browser_app.state::<SignIns>().in_browser.store(true, Ordering::SeqCst);
                        let _ = browser_app.emit(EVENT, ());
                    },
                    |_| false,
                )
            },
            |dir| auth_status(&program, Some(dir)),
        );
        let sign_ins = app.state::<SignIns>();
        if let Ok(mut g) = sign_ins.attention.lock() {
            *g = result.err().filter(|e| e.reason != "cancelled");
        }
        sign_ins.in_browser.store(false, Ordering::SeqCst);
        if let Ok(mut g) = sign_ins.running.lock() {
            *g = None;
        }
        let _ = app.emit(EVENT, ());
    });
    Ok(())
}

/// Stops the running sign-in, or (ACCT-002, ACCT-014: Check again) with nothing running wipes the
/// leftover needs-attention note; true when the note went, so the card is told to re-read.
fn cancel(s: &SignIns) -> bool {
    let running = s.running.lock().map(|r| r.is_some()).unwrap_or(false);
    match s.cancel.lock().ok().and_then(|c| c.clone()) {
        Some(flag) if running => {
            flag.store(true, Ordering::SeqCst);
            false
        }
        _ => {
            if let Ok(mut g) = s.attention.lock() {
                *g = None;
            }
            true
        }
    }
}

#[tauri::command]
pub fn claude_account_cancel(app: AppHandle, sign_ins: tauri::State<'_, SignIns>) {
    if cancel(&sign_ins) {
        let _ = app.emit(EVENT, ());
    }
}

/// ACCT-018: one account is one email (letter case and surrounding spaces ignored) in one
/// organisation; the same email in another organisation is another account.
pub fn same_account(a: &Account, email: Option<&str>, organization: Option<&str>) -> bool {
    let norm = |e: Option<&str>| e.map(|s| s.trim().to_lowercase()).filter(|s| !s.is_empty());
    norm(a.email.as_deref()).is_some() && norm(a.email.as_deref()) == norm(email) && a.organization.as_deref().map(str::trim) == organization.map(str::trim)
}

/// ACCT-016: `None` makes the system-default login the one new Claude panes use. Panes already
/// running keep the account they started on (ACCT-017): the choice is read only at launch.
pub fn activate(store: &Store, id: Option<&str>) -> Result<(), String> {
    if let Some(id) = id {
        if !load(store).iter().any(|a| a.id == id) {
            return Err("That Claude account is no longer listed.".into());
        }
    }
    store.set(ACTIVE_KEY, id.unwrap_or("")).map_err(|e| e.to_string())
}

#[tauri::command(async)]
pub fn claude_account_activate(app: AppHandle, store: tauri::State<'_, Mutex<Store>>, id: Option<String>) -> Result<(), String> {
    activate(&*store.lock().map_err(|e| e.to_string())?, id.as_deref())?;
    let _ = app.emit(EVENT, ());
    Ok(())
}

/// ACCT-016: takes the account off the list, deletes its private folder and sealed copy, and
/// hands new panes back to the system default when it was the active one. Only a folder inside
/// Kolux's own accounts folder is ever deleted.
pub fn remove(store: &Store, profile: &Path, id: &str) -> Result<(), String> {
    let mut list = load(store);
    let Some(at) = list.iter().position(|a| a.id == id) else {
        return Err("That Claude account is no longer listed.".into());
    };
    let gone = list.remove(at);
    save(store, &list)?;
    if store.get(ACTIVE_KEY).ok().flatten().as_deref() == Some(id) {
        store.set(ACTIVE_KEY, "").map_err(|e| e.to_string())?;
    }
    let dir = PathBuf::from(&gone.config_dir);
    if dir.starts_with(profile.join(FOLDER)) {
        crate::codex_accounts::remove_dir_patiently(&dir).map_err(|e| format!("The account was removed, but its folder could not be deleted: {e}"))?;
    }
    let _ = fs::remove_file(profile.join(secrets::VAULT).join(format!("claude-{id}.json")));
    Ok(())
}

#[tauri::command(async)]
pub fn claude_account_remove(app: AppHandle, store: tauri::State<'_, Mutex<Store>>, sign_ins: tauri::State<'_, SignIns>, id: String) -> Result<(), String> {
    if sign_ins.running.lock().map_err(|e| e.to_string())?.is_some() {
        return Err("Finish or cancel the sign-in first.".into());
    }
    let profile = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let result = remove(&*store.lock().map_err(|e| e.to_string())?, &profile, &id);
    let _ = app.emit(EVENT, ());
    result
}

/// Marks an account stale or fresh (ACCT-012); true when that changed anything.
pub fn mark_stale(store: &Store, id: &str, stale: bool) -> Result<bool, String> {
    let mut list = load(store);
    let Some(a) = list.iter_mut().find(|a| a.id == id && a.stale != stale) else {
        return Ok(false);
    };
    a.stale = stale;
    save(store, &list)?;
    Ok(true)
}

/// ACCT-012: asks Claude Code whether the active managed account is still signed in. Only when
/// Kolux, not Claude Code, looks after sign-ins (ACCT-006) and the 1-year key is not the
/// connection; an answer that never came leaves the account as it was.
#[tauri::command]
pub async fn claude_account_check(app: AppHandle) -> Result<(), String> {
    let target = {
        let store = app.state::<Mutex<Store>>();
        let store = store.lock().map_err(|e| e.to_string())?;
        let settings = store.settings();
        let key_mode = settings.get(crate::claude_key::MODE_FIELD).and_then(Value::as_str) == Some(crate::claude_key::KEY_MODE);
        if upkeep_left_to_claude(&settings) || key_mode {
            None
        } else {
            active(&store).zip(active_dir(&store))
        }
    };
    let (Some((id, dir)), Some(program)) = (target, crate::agents::find_program("claude")) else {
        return Ok(());
    };
    let answer = tauri::async_runtime::spawn_blocking(move || auth_status(&program, Some(Path::new(&dir)))).await.map_err(|e| e.to_string())?;
    let Some(answer) = answer else { return Ok(()) };
    let store = app.state::<Mutex<Store>>();
    let changed = mark_stale(&*store.lock().map_err(|e| e.to_string())?, &id, identity(&answer).is_none())?;
    if changed {
        let _ = app.emit(EVENT, ());
    }
    Ok(())
}

/// SET-030: what Claude Code's own sign-in on this PC says, as the card shows it.
#[derive(serde::Serialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct OwnSignIn {
    /// `signed-in`, `signed-out`, `not-installed` or `unknown` (no answer in time).
    pub state: &'static str,
    pub email: Option<String>,
}

pub fn own_sign_in(answer: Option<&str>) -> OwnSignIn {
    match answer {
        None => OwnSignIn { state: "unknown", email: None },
        Some(a) => match identity(a) {
            Some((email, _)) => OwnSignIn { state: "signed-in", email },
            None => OwnSignIn { state: "signed-out", email: None },
        },
    }
}

/// Claude Code's own sign-in, only when that is what new Claude panes run on: not in key mode
/// and with no active managed account (null otherwise; those report on their own cards).
#[tauri::command]
pub async fn claude_own_sign_in(app: AppHandle) -> Result<Option<OwnSignIn>, String> {
    {
        let store = app.state::<Mutex<Store>>();
        let store = store.lock().map_err(|e| e.to_string())?;
        let key_mode = store.settings().get(crate::claude_key::MODE_FIELD).and_then(Value::as_str) == Some(crate::claude_key::KEY_MODE);
        if key_mode || active_dir(&store).is_some() {
            return Ok(None);
        }
    }
    let Some(program) = crate::agents::find_program("claude") else {
        return Ok(Some(OwnSignIn { state: "not-installed", email: None }));
    };
    let answer = tauri::async_runtime::spawn_blocking(move || auth_status(&program, None)).await.map_err(|e| e.to_string())?;
    Ok(Some(own_sign_in(answer.as_deref())))
}

/// The active account's folder for a new pane, if it is still there.
pub fn active_dir(store: &Store) -> Option<String> {
    let id = active(store)?;
    load(store).into_iter().find(|a| a.id == id).map(|a| a.config_dir).filter(|d| PathBuf::from(d).is_dir())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    // ACCT-014: Check again routes to Cancel; with nothing running it wipes the stale note.
    #[test]
    fn an_idle_cancel_clears_the_note_and_a_running_one_only_flags() {
        let s = SignIns::default();
        *s.attention.lock().unwrap() = Some(Attention::new("not-found", "x"));
        assert!(cancel(&s));
        assert!(s.attention.lock().unwrap().is_none());
        let flag = Arc::new(AtomicBool::new(false));
        *s.running.lock().unwrap() = Some("new".into());
        *s.cancel.lock().unwrap() = Some(flag.clone());
        *s.attention.lock().unwrap() = Some(Attention::new("plan", "x"));
        assert!(!cancel(&s));
        assert!(flag.load(Ordering::SeqCst) && s.attention.lock().unwrap().is_some());
    }

    const CREDS: &str = r#"{"claudeAiOauth":{"accessToken":"fake-access","refreshToken":"fake-refresh"}}"#;
    const SIGNED_IN: &str = r#"{"loggedIn":true,"authMethod":"claude.ai","email":"sam@example.com","orgName":"Example Org"}"#;

    /// The folder goes when the test ends, after the store in it has closed.
    fn profile(tag: &str) -> (crate::test_dir::TempDir, Mutex<Store>) {
        let dir = crate::test_dir::temp(&format!("claude-accounts-{tag}"));
        let store = Store::open(&dir).unwrap();
        (dir, Mutex::new(store))
    }

    fn writes(creds: &'static str, ended: Ended) -> impl FnOnce(&Path) -> (String, Ended) {
        move |dir| {
            fs::write(dir.join(CREDENTIALS), creds).unwrap();
            ("Opening https://claude.ai/oauth/authorize?code=abc123def456ghi789 in your browser".into(), ended)
        }
    }

    #[test]
    fn the_same_account_is_not_added_twice_but_another_organisation_is() {
        let (dir, store) = profile("twice");
        sign_in(&store, &dir, "a1", false, 7, writes(CREDS, Ended::Exited(Some(0))), |_| Some(SIGNED_IN.into())).unwrap();
        let again = r#"{"loggedIn":true,"authMethod":"claude.ai","email":"  SAM@Example.com ","orgName":"Example Org"}"#;
        let err = sign_in(&store, &dir, "a2", false, 8, writes(CREDS, Ended::Exited(Some(0))), |_| Some(again.into())).unwrap_err();
        assert_eq!(err.message, "sam@example.com · Example Org is already in the list, so nothing was added.");
        assert_eq!(load(&store.lock().unwrap()).len(), 1);
        assert!(!dir.join(FOLDER).join("a2").exists(), "the second folder is not kept");
        let other = r#"{"loggedIn":true,"authMethod":"claude.ai","email":"sam@example.com","orgName":"Second Org"}"#;
        sign_in(&store, &dir, "a3", false, 9, writes(CREDS, Ended::Exited(Some(0))), |_| Some(other.into())).unwrap();
        assert_eq!(load(&store.lock().unwrap()).len(), 2, "one email in two organisations is two accounts");
    }

    #[test]
    fn removing_the_active_account_goes_back_to_the_system_default() {
        let (dir, store) = profile("remove");
        let other = r#"{"loggedIn":true,"authMethod":"claude.ai","email":"lee@example.com","orgName":"Example Org"}"#;
        sign_in(&store, &dir, "a1", false, 7, writes(CREDS, Ended::Exited(Some(0))), |_| Some(SIGNED_IN.into())).unwrap();
        sign_in(&store, &dir, "a2", false, 8, writes(CREDS, Ended::Exited(Some(0))), |_| Some(other.into())).unwrap();
        let s = store.lock().unwrap();
        activate(&s, Some("a2")).unwrap();
        assert_eq!(active(&s).as_deref(), Some("a2"));
        assert!(activate(&s, Some("gone")).is_err());
        assert_eq!(active(&s).as_deref(), Some("a2"), "a failed change keeps the earlier choice");
        remove(&s, &dir, "a2").unwrap();
        assert_eq!(active(&s), None, "the system default takes over");
        assert!(!dir.join(FOLDER).join("a2").exists() && !dir.join("vault").join("claude-a2.json").exists());
        assert_eq!(load(&s).len(), 1);
        activate(&s, Some("a1")).unwrap();
        activate(&s, None).unwrap();
        assert_eq!(active(&s), None, "the system default can be picked again");
        assert!(remove(&s, &dir, "a2").is_err());
        drop(s);
    }

    #[test]
    fn a_finished_sign_in_is_listed_with_email_and_organisation_and_sealed() {
        let (dir, store) = profile("ok");
        let a = sign_in(&store, &dir, "a1", false, 7, writes(CREDS, Ended::Exited(Some(0))), |_| Some(SIGNED_IN.into())).unwrap();
        assert_eq!(a.email.as_deref(), Some("sam@example.com"));
        assert_eq!(a.organization.as_deref(), Some("Example Org"));
        let vault = fs::read_to_string(dir.join("vault").join("claude-a1.json")).unwrap();
        assert!(!vault.contains("fake-refresh"), "the kept copy is sealed");
        assert_eq!(load(&store.lock().unwrap()), vec![a.clone()]);
        assert_eq!(active(&store.lock().unwrap()), None, "adding does not change the active account");
    }

    #[test]
    fn a_stale_account_is_marked_once_and_a_new_sign_in_clears_it() {
        let (dir, store) = profile("stale");
        sign_in(&store, &dir, "a1", false, 7, writes(CREDS, Ended::Exited(Some(0))), |_| Some(SIGNED_IN.into())).unwrap();
        {
            let s = store.lock().unwrap();
            assert!(mark_stale(&s, "a1", true).unwrap());
            assert!(!mark_stale(&s, "a1", true).unwrap(), "no change, no write");
            assert!(!mark_stale(&s, "gone", true).unwrap());
            assert!(load(&s)[0].stale);
        }
        // an older record without the field reads as fresh
        assert!(!serde_json::from_str::<Account>(r#"{"id":"x","email":null,"organization":null,"configDir":"d","lastSignIn":1}"#).unwrap().stale);
        sign_in(&store, &dir, "a1", true, 8, writes(r#"{"claudeAiOauth":{"accessToken":"fake-2"}}"#, Ended::Exited(Some(0))), |_| Some(SIGNED_IN.into())).unwrap();
        assert!(!load(&store.lock().unwrap())[0].stale, "Sign in again clears it");
    }

    #[test]
    fn a_cancelled_or_empty_sign_in_keeps_nothing() {
        let (dir, store) = profile("cancel");
        let err = sign_in(&store, &dir, "a1", false, 7, writes(CREDS, Ended::Cancelled), |_| Some(SIGNED_IN.into())).unwrap_err();
        assert_eq!(err, "Sign-in cancelled.");
        let err = sign_in(&store, &dir, "a2", false, 7, |_| ("Login failed: see https://claude.ai/x?code=abcdefghijklmnopqrstu".into(), Ended::Exited(Some(1))), |_| Some(SIGNED_IN.into())).unwrap_err();
        assert!(!err.message.contains("https://") && !err.message.contains("abcdefghijklmnopqrstu"), "no link or code in the error: {err}");
        assert_eq!(err.reason, "sign-in-refused", "a refused sign-in offers Try again");
        assert!(load(&store.lock().unwrap()).is_empty());
        assert!(!dir.join(FOLDER).join("a1").exists() && !dir.join(FOLDER).join("a2").exists(), "no partial folder left");
    }

    #[test]
    fn a_failed_re_authentication_puts_the_earlier_credentials_back() {
        let (dir, store) = profile("reauth");
        let a = sign_in(&store, &dir, "a1", false, 7, writes(CREDS, Ended::Exited(Some(0))), |_| Some(SIGNED_IN.into())).unwrap();
        let creds = Path::new(&a.config_dir).join(CREDENTIALS);
        // The login wipes the file and gives up partway.
        let err = sign_in(&store, &dir, "a1", true, 9, |d| {
            fs::remove_file(d.join(CREDENTIALS)).unwrap();
            (String::new(), Ended::Exited(Some(1)))
        }, |_| None);
        assert!(err.is_err());
        assert_eq!(fs::read_to_string(&creds).unwrap(), CREDS, "earlier credentials restored");
        // The same credentials as before are never taken as a new sign-in.
        assert!(sign_in(&store, &dir, "a1", true, 9, writes(CREDS, Ended::Exited(Some(0))), |_| Some(SIGNED_IN.into())).is_err());
        assert_eq!(load(&store.lock().unwrap())[0].last_sign_in, 7, "the row is unchanged");
    }

    #[test]
    fn claude_codes_own_sign_in_is_reported_as_signed_in_signed_out_or_unknown() {
        assert_eq!(own_sign_in(Some(SIGNED_IN)), OwnSignIn { state: "signed-in", email: Some("sam@example.com".into()) });
        assert_eq!(own_sign_in(Some(r#"{"loggedIn":false}"#)).state, "signed-out");
        assert_eq!(own_sign_in(Some("")).state, "signed-out", "an empty answer is not a sign-in");
        assert_eq!(own_sign_in(None).state, "unknown", "no answer in time is not reported as signed out");
    }

    #[test]
    fn identity_needs_a_signed_in_status() {
        assert_eq!(identity(SIGNED_IN), Some((Some("sam@example.com".into()), Some("Example Org".into()))));
        assert_eq!(identity(r#"{"loggedIn":false,"authMethod":"none","apiProvider":"firstParty"}"#), None);
        assert_eq!(identity(r#"{"loggedIn":true,"account":{"emailAddress":"x@y.z"},"organization":{"name":"Org"}}"#), Some((Some("x@y.z".into()), Some("Org".into()))));
        assert_eq!(identity("not json"), None);
    }

    #[test]
    fn key_mode_wins_and_only_claude_panes_get_the_account() {
        let d = Some(r"C:\p\claude-accounts\a1".to_string());
        assert_eq!(pane_env(Some("claude"), false, d.clone()), Some((CONFIG_ENV, d.clone().unwrap())));
        assert_eq!(pane_env(Some("claude"), true, d.clone()), None, "the 1-year key wins");
        assert_eq!(pane_env(Some("codex"), false, d.clone()), None);
        assert_eq!(pane_env(None, false, d), None);
        assert_eq!(pane_env(Some("claude"), false, None), None);
    }

    #[test]
    fn upkeep_is_left_to_claude_code_unless_turned_off() {
        assert!(upkeep_left_to_claude(&json!({})));
        assert!(!upkeep_left_to_claude(&json!({ UPKEEP_FIELD: false })));
    }

    #[test]
    fn acct_024_own_settings_that_sign_in_are_named() {
        let env = |pairs: &[(&str, &str)]| pairs.iter().map(|(k, v)| (k.to_string(), v.to_string())).collect::<Vec<_>>();
        let found = sign_in_overrides(&env(&[("ANTHROPIC_API_KEY", "sk-made-up"), ("ANTHROPIC_BASE_URL", "https://proxy.example"), ("ANTHROPIC_AUTH_TOKEN", "")]), false);
        assert_eq!(found, vec!["ANTHROPIC_API_KEY".to_string()], "an endpoint is fine, a blanked token is fine");
        assert_eq!(sign_in_overrides(&env(&[("anthropic_auth_token", "t")]), true), vec!["anthropic_auth_token".to_string()], "Windows names ignore case");
        assert!(sign_in_overrides(&env(&[("anthropic_auth_token", "t")]), false).is_empty(), "elsewhere names are exact");
        assert_eq!(sign_in_overrides(&env(&[("CLAUDE_CODE_OAUTH_TOKEN", "t")]), false).len(), 1);
    }
}
