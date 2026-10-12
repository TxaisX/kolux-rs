//! Updates (APP-024, APP-025, APP-026, APP-027).
//!
//! The page owns the timetable (start-up, every 30 minutes, retries, offline, focus, wake: see
//! `src/update/schedule.ts`); this module owns the feed, the signed download and the install.
//! A found update downloads by itself and waits in memory; it installs when the user clicks
//! Restart to update, or when the app quits. The app never restarts itself to update.
//!
//! The feed is Kolux RS's own (OD-20): a Tauri update manifest at the latest release of the
//! releases repository. Every download is checked against the minisign public key below; there is
//! no switch that turns that off. Development copies and unpackaged copies never update
//! themselves; a development copy may be pointed at a test feed through two environment
//! variables, which release builds ignore.

use crate::state::Store;
use crate::terminal::Terminals;
use std::sync::Mutex;
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager, State};
use tauri_plugin_updater::{Update, UpdaterExt};

/// The update manifest of the newest published release (OD-20: Kolux RS's own feed).
pub const RELEASE_ENDPOINT: &str = "https://github.com/TxaisX/kolux-rs-releases/releases/latest/download/latest.json";
/// The minisign public key releases are signed with. The release job (scripts/release.mjs, T-091)
/// builds it in from the public half of the signing key; a build made without it says it cannot
/// update instead of accepting anything unsigned.
pub const RELEASE_PUBKEY: &str = match option_env!("KOLUX_RS_RELEASE_PUBKEY") {
    Some(k) => k,
    None => "",
};
/// A check that has not answered by then is dropped (APP-024 "a check that stalls").
pub const CHECK_TIMEOUT: Duration = Duration::from_secs(30);
/// Development copies only: a test feed and its key.
pub const ENV_ENDPOINT: &str = "KOLUX_RS_UPDATE_ENDPOINT";
pub const ENV_PUBKEY: &str = "KOLUX_RS_UPDATE_PUBKEY";
/// Release notes in the card are cut to this many lines (APP-027).
pub const NOTE_LINES: usize = 6;

const KEY_LAST_CHECK: &str = "update.lastCheckAt";
const KEY_DISMISSED: &str = "update.dismissedVersion";
const KEY_TIP_DONE: &str = "update.tipDone";

#[derive(Debug, Clone, PartialEq)]
pub struct Feed {
    pub endpoint: String,
    pub pubkey: String,
}

/// Where this copy reads updates from, or why it never updates itself.
/// `debug` is a development build; `installed` is true when the program sits in an installed
/// copy (the installer leaves its uninstaller beside it).
pub fn feed(debug: bool, installed: bool, env: impl Fn(&str) -> Option<String>) -> Result<Feed, String> {
    if debug {
        return match (env(ENV_ENDPOINT), env(ENV_PUBKEY)) {
            (Some(endpoint), Some(pubkey)) if !endpoint.trim().is_empty() && !pubkey.trim().is_empty() => {
                Ok(Feed { endpoint: endpoint.trim().into(), pubkey: pubkey.trim().into() })
            }
            _ => Err("This is a development copy of Kolux RS; it never updates itself.".into()),
        };
    }
    if !installed {
        return Err("This copy of Kolux RS was not installed, so it cannot install updates. Install it from the releases page to get updates.".into());
    }
    if RELEASE_PUBKEY.trim().is_empty() {
        return Err("This build has no update signing key, so it cannot check updates safely.".into());
    }
    Ok(Feed { endpoint: RELEASE_ENDPOINT.into(), pubkey: RELEASE_PUBKEY.into() })
}

fn installed_copy() -> bool {
    std::env::current_exe()
        .ok()
        .and_then(|p| p.parent().map(|d| d.join("uninstall.exe").is_file()))
        .unwrap_or(false)
}

fn this_feed() -> Result<Feed, String> {
    feed(cfg!(debug_assertions), installed_copy(), |k| std::env::var(k).ok())
}

/// Release notes as a few plain lines: headings and empty lines go, list markers are stripped,
/// and the list is cut to `NOTE_LINES` (APP-027).
pub fn clean_notes(body: Option<&str>) -> Vec<String> {
    let Some(body) = body else { return Vec::new() };
    body.lines()
        .map(str::trim)
        .filter(|l| !l.is_empty() && !l.starts_with('#') && !l.starts_with("<!--"))
        .filter(|l| !l.chars().all(|c| c == '-' || c == '=' || c == '*' || c == '_'))
        .map(|l| {
            let l = l.strip_prefix("- ").or_else(|| l.strip_prefix("* ")).or_else(|| l.strip_prefix("+ ")).unwrap_or(l);
            l.trim().to_string()
        })
        .filter(|l| !l.is_empty())
        .take(NOTE_LINES)
        .collect()
}

#[derive(Debug, Clone, serde::Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Info {
    pub version: String,
    pub current_version: String,
    pub notes: Vec<String>,
    pub date: Option<String>,
}

fn info_of(u: &Update) -> Info {
    Info {
        version: u.version.clone(),
        current_version: u.current_version.clone(),
        notes: clean_notes(u.body.as_deref()),
        date: u.date.map(|d| d.to_string()),
    }
}

/// The update found by the last check, and the one that finished downloading.
#[derive(Default)]
pub struct Updates {
    pending: Mutex<Option<Update>>,
    ready: Mutex<Option<(Update, Vec<u8>)>>,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Status {
    enabled: bool,
    reason: Option<String>,
    current_version: String,
    last_check_at: Option<u64>,
    dismissed_version: Option<String>,
    tip_done: bool,
    ready: Option<Info>,
}

#[tauri::command]
pub fn update_status(app: AppHandle, store: State<'_, Mutex<Store>>, updates: State<'_, Updates>) -> Result<Status, String> {
    let feed = this_feed();
    let store = store.lock().map_err(|e| e.to_string())?;
    let get = |k: &str| store.get(k).ok().flatten();
    Ok(Status {
        enabled: feed.is_ok(),
        reason: feed.err(),
        current_version: app.package_info().version.to_string(),
        last_check_at: get(KEY_LAST_CHECK).and_then(|v| v.parse().ok()),
        dismissed_version: get(KEY_DISMISSED).filter(|v| !v.is_empty()),
        tip_done: get(KEY_TIP_DONE).as_deref() == Some("1"),
        ready: updates.ready.lock().map_err(|e| e.to_string())?.as_ref().map(|(u, _)| info_of(u)),
    })
}

/// Remembers the dismissed version or that the reassurance tip is done.
#[tauri::command]
pub fn update_mark(store: State<'_, Mutex<Store>>, key: String, value: String) -> Result<(), String> {
    let key = match key.as_str() {
        "dismissedVersion" => KEY_DISMISSED,
        "tipDone" => KEY_TIP_DONE,
        _ => return Err(format!("unknown update mark: {key}")),
    };
    store.lock().map_err(|e| e.to_string())?.set(key, &value).map_err(|e| e.to_string())
}

fn now_ms() -> u64 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0)
}

/// One check against the feed. `None` means this copy is up to date.
#[tauri::command]
pub async fn update_check(app: AppHandle) -> Result<Option<Info>, String> {
    let feed = this_feed()?;
    let url = feed.endpoint.parse().map_err(|e| format!("bad update address: {e}"))?;
    let found = app
        .updater_builder()
        .endpoints(vec![url])
        .map_err(|e| e.to_string())?
        .pubkey(feed.pubkey)
        .timeout(CHECK_TIMEOUT)
        .build()
        .map_err(|e| e.to_string())?
        .check()
        .await
        .map_err(|e| e.to_string())?;
    if let Ok(store) = app.state::<Mutex<Store>>().lock() {
        let _ = store.set(KEY_LAST_CHECK, &now_ms().to_string());
    }
    let updates = app.state::<Updates>();
    let info = found.as_ref().map(info_of);
    *updates.pending.lock().map_err(|e| e.to_string())? = found;
    Ok(info)
}

#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct Progress {
    version: String,
    received: u64,
    total: Option<u64>,
}

/// Downloads the update the last check found and checks its signature. The bytes wait in memory
/// until Restart to update or quit.
#[tauri::command]
pub async fn update_download(app: AppHandle) -> Result<Info, String> {
    let updates = app.state::<Updates>();
    if let Some((u, _)) = updates.ready.lock().map_err(|e| e.to_string())?.as_ref() {
        return Ok(info_of(u));
    }
    let update = updates.pending.lock().map_err(|e| e.to_string())?.clone().ok_or("There is no update to download; check again.")?;
    let version = update.version.clone();
    let mut received = 0u64;
    let emitter = app.clone();
    let bytes = update
        .download(
            |chunk, total| {
                received += chunk as u64;
                let _ = emitter.emit("update-progress", Progress { version: version.clone(), received, total });
            },
            || {},
        )
        .await
        .map_err(|e| e.to_string())?;
    let info = info_of(&update);
    *updates.ready.lock().map_err(|e| e.to_string())? = Some((update, bytes));
    Ok(info)
}

/// Restart to update: the shells end, the installer runs and starts the new version.
#[tauri::command]
pub fn update_restart(app: AppHandle) -> Result<(), String> {
    let ready = app.state::<Updates>().ready.lock().map_err(|e| e.to_string())?.take();
    let Some((update, bytes)) = ready else { return Err("No update is ready.".into()) };
    app.state::<Terminals>().kill_all();
    // On Windows this starts the installer and ends this process.
    update.install(&bytes).map_err(|e| e.to_string())?;
    app.restart();
}

/// Called as the app quits: a downloaded update installs now and does not reopen the app.
pub fn install_on_quit(app: &AppHandle) {
    let ready = app.state::<Updates>().ready.lock().ok().and_then(|mut r| r.take());
    if let Some((update, bytes)) = ready {
        let _ = update.restart_after_install(false).install(&bytes);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn env_with(pairs: &[(&str, &str)]) -> impl Fn(&str) -> Option<String> {
        let pairs: Vec<(String, String)> = pairs.iter().map(|(k, v)| (k.to_string(), v.to_string())).collect();
        move |k| pairs.iter().find(|(pk, _)| pk == k).map(|(_, v)| v.clone())
    }

    #[test]
    fn development_copy_never_updates_without_a_test_feed() {
        let e = feed(true, true, env_with(&[])).unwrap_err();
        assert!(e.contains("development copy"), "{e}");
        // Only one of the two variables is not enough.
        assert!(feed(true, true, env_with(&[(ENV_ENDPOINT, "http://127.0.0.1:1/latest.json")])).is_err());
        assert!(feed(true, true, env_with(&[(ENV_ENDPOINT, " "), (ENV_PUBKEY, "k")])).is_err());
    }

    #[test]
    fn development_copy_takes_a_test_feed() {
        let f = feed(true, false, env_with(&[(ENV_ENDPOINT, "http://127.0.0.1:9/latest.json "), (ENV_PUBKEY, "abc")])).unwrap();
        assert_eq!(f, Feed { endpoint: "http://127.0.0.1:9/latest.json".into(), pubkey: "abc".into() });
    }

    #[test]
    fn release_builds_ignore_the_test_feed_and_need_an_installed_copy() {
        let env = env_with(&[(ENV_ENDPOINT, "http://127.0.0.1:9/latest.json"), (ENV_PUBKEY, "abc")]);
        let e = feed(false, false, &env).unwrap_err();
        assert!(e.contains("not installed"), "{e}");
        match feed(false, true, &env) {
            Ok(f) => assert_eq!(f.endpoint, RELEASE_ENDPOINT, "a release build must never read the test feed"),
            Err(e) => assert!(e.contains("signing key"), "{e}"),
        }
    }

    #[test]
    fn notes_drop_headings_and_blank_lines_and_are_cut_short() {
        let body = "## What's new\n\n- First\n* Second\n\n### Fixes\n+ Third\nFourth plain line\n---\n- Fifth\n- Sixth\n- Seventh\n";
        assert_eq!(clean_notes(Some(body)), vec!["First", "Second", "Third", "Fourth plain line", "Fifth", "Sixth"]);
        assert_eq!(clean_notes(Some("# Only a heading\n\n")), Vec::<String>::new());
        assert_eq!(clean_notes(None), Vec::<String>::new());
        // The release job's hidden source marker never shows as a note.
        assert_eq!(clean_notes(Some("- Ship it\n<!-- kolux-rs-source: abc123 -->\n")), vec!["Ship it"]);
    }
}
