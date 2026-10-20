//! ACCT-022, ACCT-028, ACCT-029: the three small credential and folder choices of the Accounts page.
//!
//! - ACCT-022: the Codex folder past sessions are read from. Empty means the standard folder
//!   (`CODEX_HOME`, else `.codex` in the user's home); [`sessions_home`] is what session history
//!   asks for the folder.
//! - ACCT-028: MiniMax usage tracking. A session cookie and an API key are kept sealed (the
//!   secrets module); the endpoint (overseas unless changed), the group id and the model names are
//!   plain settings. Saving or forgetting emits [`EVENT`] so usage refreshes at once.
//!   ponytail: MiniMax has no public usage reference in the allowed sources, so "detected" is read
//!   from the user's own Claude environment naming a MiniMax address (or a credential already
//!   saved), and the usage fetch itself is the usage lane's, listening for [`EVENT`].
//! - ACCT-029: the experimental choice to read the Gemini CLI's own sign-in; off unless turned on,
//!   and offered only where Gemini's folder exists. This module only keeps the choice.

use crate::secrets;
use crate::state::Store;
use serde_json::{json, Value};
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use tauri::{AppHandle, Emitter};

pub const EVENT: &str = "agent-creds";
pub const SESSIONS_HOME: &str = "codexSessionsHome";
pub const MINIMAX_COOKIE: &str = "minimaxCookie";
pub const MINIMAX_KEY: &str = "minimaxApiKey";
pub const MINIMAX_ENDPOINT: &str = "minimaxEndpoint";
pub const MINIMAX_GROUP: &str = "minimaxGroupId";
pub const MINIMAX_USAGE_MODEL: &str = "minimaxUsageModel";
pub const MINIMAX_MODELS: &str = "minimaxModelNames";
pub const GEMINI_CLI: &str = "geminiCliCredentials";
/// What the endpoint and the usage model start as.
pub const ENDPOINTS: [&str; 2] = ["overseas", "mainland"];
pub const DEFAULT_USAGE_MODEL: &str = "general";

fn text(settings: &Value, key: &str) -> Option<String> {
    settings.get(key).and_then(Value::as_str).map(str::trim).filter(|s| !s.is_empty()).map(str::to_string)
}

/// ACCT-022: the folder past Codex sessions are read from: the chosen one, else the standard one.
pub fn sessions_home(settings: &Value, codex_home_env: Option<&str>, user_home: Option<&Path>) -> Option<PathBuf> {
    text(settings, SESSIONS_HOME).map(PathBuf::from).or_else(|| crate::codex_accounts::user_dir(codex_home_env, user_home))
}

/// ACCT-028: MiniMax shows up where the user's Claude environment points at a MiniMax address, or
/// where a credential was already saved.
pub fn minimax_detected(base_url_env: Option<&str>, claude_settings: Option<&str>, saved: bool) -> bool {
    let named = |t: &str| t.to_ascii_lowercase().contains("minimax");
    saved || base_url_env.is_some_and(named) || claude_settings.is_some_and(named)
}

/// ACCT-029: Gemini counts as present where its own folder exists in the user's home.
pub fn gemini_detected(user_home: Option<&Path>) -> bool {
    user_home.is_some_and(|u| u.join(".gemini").is_dir())
}

#[derive(serde::Serialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Minimax {
    pub detected: bool,
    pub cookie_kept: bool,
    pub key_kept: bool,
    pub endpoint: String,
    pub group_id: String,
    pub usage_model: String,
    pub model_names: String,
}

#[derive(serde::Serialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct View {
    /// What the field holds; empty means the standard Codex folder.
    pub sessions_home: String,
    /// The folder history is actually read from, and whether it is there.
    pub sessions_folder: Option<String>,
    pub sessions_folder_found: bool,
    pub minimax: Minimax,
    pub gemini_detected: bool,
    pub gemini_enabled: bool,
}

/// Everything the page shows, from the settings and what the machine says.
pub fn build_view(settings: &Value, kept: (bool, bool), minimax_seen: bool, gemini_seen: bool, codex_home_env: Option<&str>, user_home: Option<&Path>) -> View {
    let folder = sessions_home(settings, codex_home_env, user_home);
    let endpoint = text(settings, MINIMAX_ENDPOINT).filter(|e| ENDPOINTS.contains(&e.as_str())).unwrap_or_else(|| ENDPOINTS[0].into());
    View {
        sessions_home: text(settings, SESSIONS_HOME).unwrap_or_default(),
        sessions_folder_found: folder.as_deref().is_some_and(Path::is_dir),
        sessions_folder: folder.map(|f| f.to_string_lossy().into_owned()),
        minimax: Minimax {
            detected: minimax_seen || kept.0 || kept.1,
            cookie_kept: kept.0,
            key_kept: kept.1,
            endpoint,
            group_id: text(settings, MINIMAX_GROUP).unwrap_or_default(),
            usage_model: text(settings, MINIMAX_USAGE_MODEL).unwrap_or_else(|| DEFAULT_USAGE_MODEL.into()),
            model_names: text(settings, MINIMAX_MODELS).unwrap_or_default(),
        },
        gemini_detected: gemini_seen,
        gemini_enabled: settings.get(GEMINI_CLI).and_then(Value::as_bool) == Some(true),
    }
}

/// Sets (or, with `None`, removes) one plain settings field.
fn put(store: &Store, key: &str, value: Option<Value>) -> Result<(), String> {
    let mut settings = store.settings();
    if !settings.is_object() {
        settings = json!({});
    }
    match value {
        Some(v) => settings[key] = v,
        None => {
            settings.as_object_mut().map(|o| o.remove(key));
        }
    }
    store.save_settings(&settings).map_err(|e| e.to_string())
}

/// ACCT-028: the secret field a credential name stands for.
fn credential_field(name: &str) -> Result<&'static str, String> {
    match name {
        "cookie" => Ok(MINIMAX_COOKIE),
        "key" => Ok(MINIMAX_KEY),
        other => Err(format!("{other} is not a MiniMax credential (cookie or key)")),
    }
}

/// ACCT-022: the field holds a folder, or nothing (reset).
pub fn set_sessions_home(store: &Store, path: &str) -> Result<(), String> {
    let path = path.trim();
    put(store, SESSIONS_HOME, (!path.is_empty()).then(|| Value::from(path)))
}

/// ACCT-028: the endpoint must be one of the two known; empty text puts a field back to its start.
pub fn set_minimax_options(store: &Store, endpoint: &str, group_id: &str, usage_model: &str, model_names: &str) -> Result<(), String> {
    let endpoint = endpoint.trim();
    if !endpoint.is_empty() && !ENDPOINTS.contains(&endpoint) {
        return Err(format!("The MiniMax endpoint is {} or {}.", ENDPOINTS[0], ENDPOINTS[1]));
    }
    let keep = |v: &str| (!v.trim().is_empty()).then(|| Value::from(v.trim()));
    // The endpoint is written last: a refusal above changes nothing.
    put(store, MINIMAX_GROUP, keep(group_id))?;
    put(store, MINIMAX_USAGE_MODEL, keep(usage_model).filter(|m| m != DEFAULT_USAGE_MODEL))?;
    put(store, MINIMAX_MODELS, keep(model_names))?;
    put(store, MINIMAX_ENDPOINT, keep(endpoint).filter(|e| e != ENDPOINTS[0]))
}

fn view_now(store: &Store) -> View {
    let settings = store.settings();
    let kept = |k| secrets::read_setting(store, k).ok().flatten().is_some();
    let env = std::env::var(crate::codex_accounts::HOME_ENV).ok();
    let user = std::env::var_os("USERPROFILE").or_else(|| std::env::var_os("HOME")).map(PathBuf::from);
    let claude_dir = std::env::var_os("CLAUDE_CONFIG_DIR").map(PathBuf::from).or_else(|| user.as_ref().map(|u| u.join(".claude")));
    let claude_settings = claude_dir.and_then(|d| std::fs::read_to_string(d.join("settings.json")).ok());
    let minimax = minimax_detected(std::env::var("ANTHROPIC_BASE_URL").ok().as_deref(), claude_settings.as_deref(), false);
    build_view(&settings, (kept(MINIMAX_COOKIE), kept(MINIMAX_KEY)), minimax, gemini_detected(user.as_deref()), env.as_deref(), user.as_deref())
}

#[tauri::command]
pub fn agent_creds_view(store: tauri::State<'_, Mutex<Store>>) -> Result<View, String> {
    Ok(view_now(&*store.lock().map_err(|e| e.to_string())?))
}

/// ACCT-022: an empty path is Reset.
#[tauri::command]
pub fn codex_sessions_home_set(app: AppHandle, store: tauri::State<'_, Mutex<Store>>, path: String) -> Result<(), String> {
    set_sessions_home(&*store.lock().map_err(|e| e.to_string())?, &path)?;
    let _ = app.emit(EVENT, ());
    Ok(())
}

/// ACCT-028: saves one credential (`cookie` or `key`), sealed; usage refreshes right after.
#[tauri::command]
pub fn minimax_credential_set(app: AppHandle, store: tauri::State<'_, Mutex<Store>>, field: String, value: String) -> Result<(), String> {
    let (field, value) = (credential_field(&field)?, value.trim());
    if value.is_empty() {
        return Err("Type or paste the MiniMax credential first.".into());
    }
    secrets::write_setting(&*store.lock().map_err(|e| e.to_string())?, field, value)?;
    let _ = app.emit(EVENT, ());
    Ok(())
}

/// ACCT-028: forgets one credential; usage clears right after.
#[tauri::command]
pub fn minimax_credential_forget(app: AppHandle, store: tauri::State<'_, Mutex<Store>>, field: String) -> Result<(), String> {
    secrets::clear_setting(&*store.lock().map_err(|e| e.to_string())?, credential_field(&field)?)?;
    let _ = app.emit(EVENT, ());
    Ok(())
}

#[tauri::command]
pub fn minimax_options_set(app: AppHandle, store: tauri::State<'_, Mutex<Store>>, endpoint: String, group_id: String, usage_model: String, model_names: String) -> Result<(), String> {
    set_minimax_options(&*store.lock().map_err(|e| e.to_string())?, &endpoint, &group_id, &usage_model, &model_names)?;
    let _ = app.emit(EVENT, ());
    Ok(())
}

/// ACCT-029: off unless turned on.
#[tauri::command]
pub fn gemini_cli_credentials_set(app: AppHandle, store: tauri::State<'_, Mutex<Store>>, on: bool) -> Result<(), String> {
    put(&*store.lock().map_err(|e| e.to_string())?, GEMINI_CLI, on.then(|| Value::Bool(true)))?;
    let _ = app.emit(EVENT, ());
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn store(tag: &str) -> (crate::test_dir::TempDir, Store) {
        let dir = crate::test_dir::temp(tag);
        let store = Store::open(&dir).unwrap();
        (dir, store)
    }

    // ACCT-022: an empty field is the standard folder, a custom path wins, Reset empties the field.
    #[test]
    fn acct_022_an_empty_field_means_the_standard_codex_folder() {
        let (dir, store) = store("creds-sessions");
        let user = dir.join("home");
        let view = |s: &Store| build_view(&s.settings(), (false, false), false, false, None, Some(&user));
        assert_eq!(view(&store).sessions_home, "");
        assert_eq!(view(&store).sessions_folder, Some(user.join(".codex").to_string_lossy().into_owned()));
        assert_eq!(sessions_home(&json!({}), Some("E:\\own"), Some(&user)), Some(PathBuf::from("E:\\own")));
        std::fs::create_dir_all(dir.join("elsewhere")).unwrap();
        set_sessions_home(&store, &format!("  {}  ", dir.join("elsewhere").display())).unwrap();
        let v = view(&store);
        assert_eq!((v.sessions_home.as_str(), v.sessions_folder_found), (dir.join("elsewhere").to_str().unwrap(), true));
        assert_eq!(sessions_home(&store.settings(), None, Some(&user)), Some(dir.join("elsewhere")));
        set_sessions_home(&store, "   ").unwrap();
        let v = view(&store);
        assert_eq!((v.sessions_home.as_str(), v.sessions_folder_found), ("", false), "Reset empties the field; the standard folder is not there in this fixture");
        assert!(store.settings().get(SESSIONS_HOME).is_none());
    }

    // ACCT-028: the credentials are kept sealed and forgotten again; the options start at their
    // defaults and a refused endpoint changes nothing; the section shows only where MiniMax is seen.
    #[test]
    fn acct_028_minimax_credentials_are_kept_sealed_and_forgotten() {
        let (dir, store) = store("creds-minimax");
        let view = |s: &Store, seen: bool| {
            let kept = |k| secrets::read_setting(s, k).ok().flatten().is_some();
            build_view(&s.settings(), (kept(MINIMAX_COOKIE), kept(MINIMAX_KEY)), seen, false, None, Some(&dir))
        };
        let v = view(&store, false).minimax;
        assert_eq!((v.detected, v.cookie_kept, v.key_kept), (false, false, false), "not seen: no section");
        assert_eq!((v.endpoint.as_str(), v.usage_model.as_str(), v.group_id.as_str()), ("overseas", "general", ""));
        assert!(view(&store, true).minimax.detected);
        secrets::write_setting(&store, credential_field("key").unwrap(), "mm-key-SECRET").unwrap();
        let v = view(&store, false).minimax;
        assert_eq!((v.detected, v.cookie_kept, v.key_kept), (true, false, true), "a saved credential keeps the section on screen");
        let disk = std::fs::read_to_string(dir.join("settings.json")).unwrap();
        assert!(!disk.contains("mm-key-SECRET"), "never in the clear on disk");
        assert!(serde_json::to_string(&view(&store, false)).unwrap().find("SECRET").is_none(), "the page never receives a secret");
        secrets::clear_setting(&store, credential_field("key").unwrap()).unwrap();
        assert!(!view(&store, false).minimax.key_kept);
        assert!(credential_field("token").is_err());
        set_minimax_options(&store, "mainland", " g-42 ", "coding", "m1, m2").unwrap();
        let v = view(&store, false).minimax;
        assert_eq!((v.endpoint.as_str(), v.group_id.as_str(), v.usage_model.as_str(), v.model_names.as_str()), ("mainland", "g-42", "coding", "m1, m2"));
        let before = store.settings();
        assert!(set_minimax_options(&store, "moon", "x", "x", "x").is_err());
        assert_eq!(store.settings(), before, "a refused endpoint changes nothing");
        set_minimax_options(&store, "", "", "", "").unwrap();
        let v = view(&store, false).minimax;
        assert_eq!((v.endpoint.as_str(), v.usage_model.as_str(), v.group_id.as_str()), ("overseas", "general", ""));
    }

    #[test]
    fn acct_028_minimax_is_seen_where_the_users_claude_environment_names_it() {
        assert!(minimax_detected(Some("https://api.minimax.io/anthropic"), None, false));
        assert!(minimax_detected(None, Some("{\"env\":{\"ANTHROPIC_BASE_URL\":\"https://API.MiniMaxi.com/anthropic\"}}"), false));
        assert!(!minimax_detected(Some("https://api.anthropic.com"), Some("{}"), false));
        assert!(minimax_detected(None, None, true));
    }

    // ACCT-029: off on a fresh profile, remembered when switched on, back to off when switched off;
    // offered only where Gemini's folder exists.
    #[test]
    fn acct_029_gemini_credentials_are_off_until_turned_on_and_only_offered_where_gemini_is() {
        let (dir, store) = store("creds-gemini");
        let view = |s: &Store| build_view(&s.settings(), (false, false), false, gemini_detected(Some(&dir)), None, Some(&dir));
        assert!(!view(&store).gemini_enabled && !view(&store).gemini_detected, "a fresh profile: off, and no Gemini folder yet");
        std::fs::create_dir_all(dir.join(".gemini")).unwrap();
        assert!(view(&store).gemini_detected);
        put(&store, GEMINI_CLI, Some(Value::Bool(true))).unwrap();
        assert!(view(&store).gemini_enabled);
        put(&store, GEMINI_CLI, None).unwrap();
        assert!(!view(&store).gemini_enabled && store.settings().get(GEMINI_CLI).is_none());
        assert!(!build_view(&json!({ "geminiCliCredentials": "yes" }), (false, false), false, true, None, None).gemini_enabled, "only a true counts");
    }
}
