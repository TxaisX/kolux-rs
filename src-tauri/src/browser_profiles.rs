//! BROW-045: browser session profiles. A profile is a separate engine data folder (cookies, web
//! storage, logins) a tab can run in; `default` is the engine's own folder and cannot be deleted.
//! The store is one JSON file under the app's data folder, read and written whole (ponytail: a
//! handful of rows; a database when profiles carry more than a label).
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};

pub const DEFAULT: &str = "default";
pub const SCOPES: &[&str] = &["isolated", "imported"];
const FILE: &str = "browser-profiles.json";

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Profile {
    pub id: String,
    pub label: String,
    /// `isolated` (fresh folder) or `imported` (meant to carry the system browser's identity over;
    /// the import itself is BROW-030's).
    pub scope: String,
    /// Whether the tab presents a plain browser identity (on unless `--no-ua-spoof`).
    #[serde(rename = "uaSpoof")]
    pub ua_spoof: bool,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
pub struct Store {
    #[serde(default)]
    pub profiles: Vec<Profile>,
    /// page id -> profile id, for tabs moved off the default.
    #[serde(default)]
    pub tabs: HashMap<String, String>,
}

fn default_profile() -> Profile {
    Profile { id: DEFAULT.into(), label: "Default".into(), scope: "isolated".into(), ua_spoof: true }
}

/// Every profile, the default first.
pub fn list(store: &Store) -> Vec<Profile> {
    let mut out = vec![default_profile()];
    out.extend(store.profiles.iter().filter(|p| p.id != DEFAULT).cloned());
    out
}

pub fn get(store: &Store, id: &str) -> Option<Profile> {
    list(store).into_iter().find(|p| p.id == id)
}

fn slug(label: &str) -> String {
    let s: String = label.to_lowercase().chars().map(|c| if c.is_ascii_alphanumeric() { c } else { '-' }).collect();
    let s = s.trim_matches('-').to_string();
    if s.is_empty() { "profile".into() } else { s.chars().take(32).collect() }
}

pub fn create(store: &mut Store, label: &str, scope: Option<&str>, ua_spoof: bool) -> Result<Profile, String> {
    let label = label.trim();
    if label.is_empty() {
        return Err("--label is required".into());
    }
    let scope = scope.unwrap_or("isolated");
    if !SCOPES.contains(&scope) {
        return Err(format!("--scope {scope} is not one of {}", SCOPES.join("|")));
    }
    let base = slug(label);
    let mut id = base.clone();
    let mut n = 2;
    while get(store, &id).is_some() {
        id = format!("{base}-{n}");
        n += 1;
    }
    let p = Profile { id, label: label.to_string(), scope: scope.to_string(), ua_spoof };
    store.profiles.push(p.clone());
    Ok(p)
}

/// Destructive: the profile's row goes and its tabs fall back to the default (the engine folder
/// on disk is left for the next start to clear). The default profile is refused.
pub fn delete(store: &mut Store, id: &str) -> Result<Profile, String> {
    if id == DEFAULT {
        return Err("the default profile cannot be deleted".into());
    }
    let at = store.profiles.iter().position(|p| p.id == id).ok_or_else(|| format!("no profile is called {id}"))?;
    let p = store.profiles.remove(at);
    store.tabs.retain(|_, v| v != id);
    Ok(p)
}

pub fn set_tab(store: &mut Store, page: u32, id: &str) -> Result<Profile, String> {
    let p = get(store, id).ok_or_else(|| format!("no profile is called {id}"))?;
    if id == DEFAULT {
        store.tabs.remove(&page.to_string());
    } else {
        store.tabs.insert(page.to_string(), id.to_string());
    }
    Ok(p)
}

pub fn tab_profile(store: &Store, page: u32) -> String {
    store.tabs.get(&page.to_string()).cloned().unwrap_or_else(|| DEFAULT.into())
}

/// A copy of a profile (label "<label> copy"); with a page, that tab moves to the copy.
pub fn clone_profile(store: &mut Store, id: &str, page: Option<u32>) -> Result<Profile, String> {
    let from = get(store, id).ok_or_else(|| format!("no profile is called {id}"))?;
    let p = create(store, &format!("{} copy", from.label), Some(&from.scope), from.ua_spoof)?;
    if let Some(page) = page {
        set_tab(store, page, &p.id)?;
    }
    Ok(p)
}

/// The engine's data folder for a profile: none for the default (the engine's own).
pub fn data_dir(root: &Path, id: &str) -> Option<PathBuf> {
    (id != DEFAULT && !id.is_empty()).then(|| root.join("browser-profiles").join(id))
}

pub fn load(root: &Path) -> Store {
    std::fs::read(root.join(FILE)).ok().and_then(|b| serde_json::from_slice(&b).ok()).unwrap_or_default()
}

pub fn save(root: &Path, store: &Store) -> Result<(), String> {
    std::fs::create_dir_all(root).map_err(|e| e.to_string())?;
    let text = serde_json::to_vec_pretty(store).map_err(|e| e.to_string())?;
    std::fs::write(root.join(FILE), text).map_err(|e| format!("{}: {e}", root.join(FILE).display()))
}

/// The app's data folder, told by the app once a browser tab reports (the command line has no app
/// handle); `KOLUX_APP_DIR` serves a terminal Kolux started.
static ROOT: OnceLock<Mutex<Option<PathBuf>>> = OnceLock::new();

pub fn set_root(path: PathBuf) {
    if let Ok(mut r) = ROOT.get_or_init(|| Mutex::new(None)).lock() {
        *r = Some(path);
    }
}

pub fn root() -> Result<PathBuf, String> {
    if let Some(p) = ROOT.get().and_then(|r| r.lock().ok()).and_then(|r| r.clone()) {
        return Ok(p);
    }
    std::env::var_os(crate::cli::APP_DIR_ENV).map(PathBuf::from).ok_or_else(|| "the app's data folder is not known yet; open a browser tab first".to_string())
}

/// BROW-025: the sign-in hosts where a profile in its normal mode shows desktop Firefox, with no
/// client hints, so Google's embedded-browser block lets the sign-in through. Exact hosts only:
/// Google's app subdomains (mail.google.com) and lookalikes (accounts.google.com.example.net) keep
/// the pane's own identity.
pub const SIGN_IN_HOSTS: &[&str] = &["accounts.google.com", "accounts.youtube.com"];

/// The Firefox release the sign-in hosts are shown. ponytail: a fixed ESR number; bump it when
/// Google starts calling it outdated.
const FIREFOX: u32 = 140;

/// The request headers that carry client hints; the Firefox identity sends none of them.
pub const CLIENT_HINTS: &[&str] = &["sec-ch-ua", "sec-ch-ua-mobile", "sec-ch-ua-platform", "sec-ch-ua-platform-version", "sec-ch-ua-full-version", "sec-ch-ua-full-version-list", "sec-ch-ua-arch", "sec-ch-ua-bitness", "sec-ch-ua-model", "sec-ch-ua-wow64", "sec-ch-ua-form-factors"];

/// Desktop Firefox on this platform, as its own user agent reads.
pub fn firefox_identity() -> String {
    let platform = if cfg!(windows) {
        "Windows NT 10.0; Win64; x64"
    } else if cfg!(target_os = "macos") {
        "Macintosh; Intel Mac OS X 10.15"
    } else {
        "X11; Linux x86_64"
    };
    format!("Mozilla/5.0 ({platform}; rv:{FIREFOX}.0) Gecko/20100101 Firefox/{FIREFOX}.0")
}

/// Whether an address is on one of the sign-in hosts (web addresses only, any letter case, a
/// trailing dot ignored).
pub fn sign_in_host(url: &str) -> bool {
    let Ok(u) = tauri::Url::parse(url.trim()) else { return false };
    matches!(u.scheme(), "https" | "http") && u.host_str().map(|h| h.trim_end_matches('.').to_ascii_lowercase()).is_some_and(|h| SIGN_IN_HOSTS.contains(&h.as_str()))
}

/// Whether a page at `url` shows the Firefox identity: only on a sign-in host, and only in a
/// profile that is not in native mode. Asked again at every navigation, redirects included.
pub fn firefox_at(url: &str, ua_spoof: bool) -> bool {
    ua_spoof && sign_in_host(url)
}

/// Whether a profile is in its normal mode (Firefox on the sign-in hosts); an unknown profile is.
pub fn spoofs(store: &Store, id: &str) -> bool {
    get(store, id).is_none_or(|p| p.ua_spoof)
}

/// The page script that hides the client hints from the sign-in hosts' own script (Firefox has no
/// `navigator.userAgentData`); every other page keeps them.
pub fn no_hints_script() -> String {
    let hosts = serde_json::to_string(SIGN_IN_HOSTS).unwrap_or_default();
    format!("(() => {{ if (!{hosts}.includes(location.hostname.toLowerCase().replace(/\\.$/, \"\"))) return; try {{ Object.defineProperty(Navigator.prototype, \"userAgentData\", {{ get: () => undefined, configurable: true }}); }} catch (_) {{}} }})();")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn brow025_only_the_sign_in_hosts_get_the_firefox_identity() {
        for u in ["https://accounts.google.com/v3/signin/identifier?x=1", "https://ACCOUNTS.Google.com./ServiceLogin", "https://accounts.youtube.com/accounts/SetSID", "http://accounts.google.com/"] {
            assert!(firefox_at(u, true), "{u}");
            // Native mode: the stock identity everywhere, sign-in hosts included.
            assert!(!firefox_at(u, false), "{u}");
        }
        // App subdomains, lookalikes, other schemes and plain text keep the pane's own identity.
        for u in ["https://mail.google.com/", "https://www.google.com/", "https://www.youtube.com/", "https://accounts.google.com.example.net/", "https://evil-accounts.google.com/", "https://accounts.google.co.uk/", "https://example.net/?next=https://accounts.google.com/", "file://accounts.google.com/x", "accounts.google.com"] {
            assert!(!firefox_at(u, true), "{u}");
        }
        // A redirect chain is asked hop by hop: in at the sign-in host, out again at the app.
        let hops = ["https://www.youtube.com/signin", "https://accounts.google.com/ServiceLogin", "https://accounts.youtube.com/accounts/SetSID", "https://www.youtube.com/"];
        assert_eq!(hops.map(|u| firefox_at(u, true)), [false, true, true, false]);
    }

    #[test]
    fn brow025_the_identity_is_desktop_firefox_for_this_platform_and_hints_go() {
        let ua = firefox_identity();
        assert!(ua.starts_with("Mozilla/5.0 (") && ua.ends_with(&format!("Gecko/20100101 Firefox/{FIREFOX}.0")), "{ua}");
        assert!(!ua.contains("Chrome") && !ua.contains("Edg") && !ua.contains("Mobile"), "{ua}");
        #[cfg(windows)]
        assert!(ua.contains("(Windows NT 10.0; Win64; x64; rv:"), "{ua}");
        assert!(CLIENT_HINTS.contains(&"sec-ch-ua") && CLIENT_HINTS.iter().all(|h| h.starts_with("sec-ch-ua")));
        let script = no_hints_script();
        assert!(SIGN_IN_HOSTS.iter().all(|h| script.contains(&format!("\"{h}\""))) && script.contains("userAgentData"), "{script}");
    }

    #[test]
    fn brow025_native_mode_is_the_profile_s_choice_and_the_default_spoofs() {
        let mut s = Store::default();
        create(&mut s, "Plain", None, false).unwrap();
        create(&mut s, "Work", None, true).unwrap();
        assert!(spoofs(&s, DEFAULT));
        assert!(!spoofs(&s, "plain"));
        assert!(spoofs(&s, "work"));
        assert!(spoofs(&s, "gone"));
        // A copy keeps the mode it was copied from.
        let c = clone_profile(&mut s, "plain", None).unwrap();
        assert!(!spoofs(&s, &c.id));
    }

    #[test]
    fn brow045_the_default_leads_the_list_and_cannot_go() {
        let mut s = Store::default();
        assert_eq!(list(&s).len(), 1);
        let work = create(&mut s, "Work", None, true).unwrap();
        assert_eq!((work.id.as_str(), work.scope.as_str()), ("work", "isolated"));
        let again = create(&mut s, "Work", Some("imported"), false).unwrap();
        assert_eq!(again.id, "work-2");
        assert_eq!(list(&s).iter().map(|p| p.id.as_str()).collect::<Vec<_>>(), ["default", "work", "work-2"]);
        assert_eq!(delete(&mut s, DEFAULT).unwrap_err(), "the default profile cannot be deleted");
        assert_eq!(create(&mut s, " ", None, true).unwrap_err(), "--label is required");
        assert!(create(&mut s, "x", Some("shared"), true).unwrap_err().contains("isolated|imported"));
    }

    #[test]
    fn brow045_tabs_move_between_profiles_and_a_deleted_profile_frees_them() {
        let mut s = Store::default();
        create(&mut s, "Work", None, true).unwrap();
        assert_eq!(tab_profile(&s, 4), "default");
        set_tab(&mut s, 4, "work").unwrap();
        assert_eq!(tab_profile(&s, 4), "work");
        let copy = clone_profile(&mut s, "work", Some(5)).unwrap();
        assert_eq!((copy.id.as_str(), copy.label.as_str()), ("work-copy", "Work copy"));
        assert_eq!(tab_profile(&s, 5), "work-copy");
        set_tab(&mut s, 5, DEFAULT).unwrap();
        assert_eq!(tab_profile(&s, 5), "default");
        assert_eq!(set_tab(&mut s, 4, "nope").unwrap_err(), "no profile is called nope");
        delete(&mut s, "work").unwrap();
        assert_eq!(tab_profile(&s, 4), "default");
        assert_eq!(data_dir(Path::new("C:/d"), DEFAULT), None);
        assert_eq!(data_dir(Path::new("C:/d"), "work-copy"), Some(PathBuf::from("C:/d").join("browser-profiles").join("work-copy")));
    }

    #[test]
    fn brow045_the_store_survives_a_round_trip() {
        let dir = std::env::temp_dir().join(format!("kolux-profiles-{}", std::process::id()));
        let mut s = Store::default();
        create(&mut s, "Work", None, false).unwrap();
        set_tab(&mut s, 7, "work").unwrap();
        save(&dir, &s).unwrap();
        let back = load(&dir);
        assert_eq!(list(&back), list(&s));
        assert_eq!(tab_profile(&back, 7), "work");
        let _ = std::fs::remove_dir_all(&dir);
        assert_eq!(load(&dir).profiles.len(), 0);
    }
}
