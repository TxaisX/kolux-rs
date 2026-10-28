//! BROW-045: browser session profiles. A profile is a separate engine data folder (cookies, web
//! storage, logins) a tab can run in; `default` is the engine's own folder and cannot be deleted.
//! The store is one JSON file under the app's data folder, read and written whole (ponytail: a
//! handful of rows; a database when profiles carry more than a label).
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::{Component, Path, PathBuf};
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

#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
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

/// Row 954 (c): the profile a tab opens in, and the saved row to match. A handed-over profile (the
/// command line, a profile change) wins; a REBUILD with none keeps the saved row. Every other open
/// persists what it resolved, the default included (clears the row), so a reused tab id never
/// inherits an old tab's profile on its first rebuild.
pub fn resolve_open(store: &mut Store, page: u32, given: Option<String>, rebuild: bool) -> Option<String> {
    let keep_saved = given.is_none() && rebuild;
    let want = given.or_else(|| rebuild.then(|| tab_profile(store, page))).filter(|p| p != DEFAULT);
    // A saved row naming a profile that is gone falls through to the default and clears the row.
    if keep_saved && want.as_deref().is_none_or(|p| get(store, p).is_some()) {
        return want;
    }
    if set_tab(store, page, want.as_deref().unwrap_or(DEFAULT)).is_err() {
        store.tabs.remove(&page.to_string());
        return None;
    }
    want
}

/// What a pane's open does to the saved store, under the store lock: resolves the profile (see
/// `resolve_open`), saves the row change and answers the profile plus whether it spoofs the identity.
pub fn open_tab(root: &Path, page: u32, given: Option<String>, rebuild: bool) -> (Option<String>, bool) {
    let (out, _) = edit(root, |s| {
        let profile = resolve_open(s, page, given, rebuild);
        let spoof = profile.as_deref().is_none_or(|p| spoofs(s, p));
        (profile, spoof)
    });
    out
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

/// after-list 153: removes a deleted profile's engine data folder. Refuses an id that is not one
/// plain folder name and any folder (a link included) that does not resolve to a place below
/// `<root>/browser-profiles`. `Ok(false)` when there was no folder.
pub fn remove_data(root: &Path, id: &str) -> Result<bool, String> {
    let dir = data_dir(root, id).ok_or_else(|| "the default profile has no data folder of its own".to_string())?;
    let mut parts = Path::new(id).components();
    if id.contains(['/', '\\', ':']) || !matches!((parts.next(), parts.next()), (Some(Component::Normal(_)), None)) {
        return Err(format!("{id:?} is not a profile folder name"));
    }
    if std::fs::symlink_metadata(&dir).is_err() {
        return Ok(false);
    }
    let base = root.join("browser-profiles").canonicalize().map_err(|e| e.to_string())?;
    let real = dir.canonicalize().map_err(|e| e.to_string())?;
    if real == base || !real.starts_with(&base) {
        return Err(format!("{} is outside the profiles folder; left alone", dir.display()));
    }
    std::fs::remove_dir_all(&real).map_err(|e| format!("{}: {e}", real.display()))?;
    Ok(true)
}

/// Which profile each open tab's page runs in, and which deleted profiles still wait for their
/// last tab to close before the data folder can go (the engine holds the folder while a page uses it).
#[derive(Default)]
pub struct Live {
    open: HashMap<u32, String>,
    doomed: Vec<String>,
}

impl Live {
    pub fn opened(&mut self, page: u32, profile: &str) {
        self.open.insert(page, profile.to_string());
    }
    pub fn closed(&mut self, page: u32) {
        self.open.remove(&page);
    }
    pub fn doom(&mut self, profile: &str) {
        if !self.doomed.iter().any(|d| d == profile) {
            self.doomed.push(profile.to_string());
        }
    }
    /// The doomed profiles no open tab uses any more; they leave the waiting list.
    pub fn due(&mut self) -> Vec<String> {
        let (idle, busy): (Vec<String>, Vec<String>) = std::mem::take(&mut self.doomed).into_iter().partition(|d| !self.open.values().any(|p| p == d));
        self.doomed = busy;
        idle
    }
}

static LIVE: OnceLock<Mutex<Live>> = OnceLock::new();

fn live<R>(f: impl FnOnce(&mut Live) -> R) -> Option<R> {
    LIVE.get_or_init(Default::default).lock().ok().map(|mut l| f(&mut l))
}

/// A page opened in `profile` (the default is not recorded: it has no folder to remove).
pub fn page_opened(page: u32, profile: &str) {
    if profile != DEFAULT {
        live(|l| l.opened(page, profile));
    }
}

/// A page closed: a deleted profile it was the last user of loses its data folder now.
pub fn page_closed(page: u32) {
    live(|l| l.closed(page));
    sweep();
}

/// A profile was deleted: its data folder goes now, or as soon as the last open tab using it closes.
pub fn forget_data(id: &str) {
    live(|l| l.doom(id));
    sweep();
}

/// Removes the data folder of every doomed profile no open tab uses; one that cannot go yet
/// (the engine may still hold it a moment) waits for the next open or close.
fn sweep() {
    let Some(due) = live(Live::due) else { return };
    if due.is_empty() {
        return;
    }
    let Ok(root) = root() else { return };
    for id in due {
        if remove_data(&root, &id).is_err() {
            live(|l| l.doom(&id));
        }
    }
}

fn read_file(root: &Path) -> Store {
    std::fs::read(root.join(FILE)).ok().and_then(|b| serde_json::from_slice(&b).ok()).unwrap_or_default()
}

/// Row 954 (e): one lock for every read-change-write of the store file; held load to save, never across an await.
static STORE_LOCK: Mutex<()> = Mutex::new(());

fn store_lock() -> std::sync::MutexGuard<'static, ()> {
    STORE_LOCK.lock().unwrap_or_else(|e| e.into_inner())
}

/// A read of the store, never torn by a writer mid-save.
pub fn load(root: &Path) -> Store {
    let _g = store_lock();
    read_file(root)
}

/// Loads the store, lets `f` change it and saves it when it changed, all under the store lock, so two
/// writers (panes opening together, the command line) never overwrite each other's rows. The save
/// result comes back beside `f`'s own.
pub fn edit<R>(root: &Path, f: impl FnOnce(&mut Store) -> R) -> (R, Result<(), String>) {
    let _g = store_lock();
    let mut store = read_file(root);
    let before = store.clone();
    let out = f(&mut store);
    let saved = if store == before { Ok(()) } else { save(root, &store) };
    (out, saved)
}

pub fn save(root: &Path, store: &Store) -> Result<(), String> {
    std::fs::create_dir_all(root).map_err(|e| e.to_string())?;
    let text = serde_json::to_vec_pretty(store).map_err(|e| e.to_string())?;
    let (file, tmp) = (root.join(FILE), root.join(format!("{FILE}.tmp")));
    std::fs::write(&tmp, text).and_then(|()| std::fs::rename(&tmp, &file)).map_err(|e| format!("{}: {e}", file.display()))
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
    fn row_954c_a_rebuilt_tab_keeps_its_saved_profile_and_a_new_tab_does_not_inherit_one() {
        let mut s = Store::default();
        create(&mut s, "Work", None, true).unwrap();
        set_tab(&mut s, 4, "work").unwrap();
        assert_eq!(resolve_open(&mut s, 4, None, true), Some("work".into()), "a rebuild keeps the saved profile");
        assert_eq!(tab_profile(&s, 4), "work", "a rebuild leaves the row alone");
        assert_eq!(resolve_open(&mut s, 4, Some("other".into()), true), None, "an unknown handed-over profile falls back to the default");
        assert_eq!(tab_profile(&s, 4), DEFAULT);
        assert_eq!(resolve_open(&mut s, 9, None, true), None, "a rebuilt tab with no saved row stays default");
        set_tab(&mut s, 4, "work").unwrap();
        assert_eq!(resolve_open(&mut s, 4, None, false), None, "a new tab with a reused id starts in the default");
    }

    #[test]
    fn row_954d_a_fresh_default_open_clears_a_reused_ids_stale_profile_for_every_rebuild() {
        let mut s = Store::default();
        create(&mut s, "Work", None, true).unwrap();
        // Session 1: tab 5 ran in "work" and was closed last; the row stays behind.
        set_tab(&mut s, 5, "work").unwrap();
        // Session 2 reuses id 5 in the default.
        assert_eq!(resolve_open(&mut s, 5, None, false), None);
        assert_eq!(tab_profile(&s, 5), DEFAULT, "the fresh default open cleared the stale row");
        assert_eq!(resolve_open(&mut s, 5, None, true), None, "the automatic rebuild stays default");
        assert_eq!(resolve_open(&mut s, 5, None, true), None, "a crash Retry stays default");
    }

    #[test]
    fn row_954d_a_fresh_open_in_a_profile_is_what_a_rebuild_then_keeps() {
        let mut s = Store::default();
        create(&mut s, "Work", None, true).unwrap();
        assert_eq!(resolve_open(&mut s, 5, Some("work".into()), false), Some("work".into()));
        assert_eq!(resolve_open(&mut s, 5, None, true), Some("work".into()));
        assert_eq!(resolve_open(&mut s, 5, None, true), Some("work".into()), "a Retry too");
        assert_eq!(resolve_open(&mut s, 5, Some("default".into()), false), None, "an explicit default open clears the row");
        assert_eq!(resolve_open(&mut s, 5, None, true), None);
    }

    #[test]
    fn row_954e_panes_opening_together_never_bring_back_each_others_stale_rows() {
        let dir = scratch("race");
        let tabs: Vec<u32> = (1..=24).collect();
        for _ in 0..40 {
            // Session 1 left a "work" row for every tab; session 2 restores them all in the default at once.
            let mut s = Store::default();
            create(&mut s, "Work", None, true).unwrap();
            for t in &tabs {
                set_tab(&mut s, *t, "work").unwrap();
            }
            save(&dir, &s).unwrap();
            let gate = std::sync::Arc::new(std::sync::Barrier::new(tabs.len()));
            let joins: Vec<_> = tabs
                .iter()
                .map(|t| {
                    let (dir, gate, t) = (dir.clone(), gate.clone(), *t);
                    std::thread::spawn(move || {
                        gate.wait();
                        open_tab(&dir, t, None, false)
                    })
                })
                .collect();
            for j in joins {
                assert_eq!(j.join().unwrap(), (None, true));
            }
            let left = load(&dir).tabs;
            assert!(left.is_empty(), "stale rows survived the parallel opens: {left:?}");
        }
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn row_954e_edit_saves_only_a_changed_store_and_hands_back_the_save_result() {
        let dir = scratch("edit");
        let (made, saved) = edit(&dir, |s| create(s, "Work", None, true).map(|p| p.id));
        assert_eq!((made, saved), (Ok("work".to_string()), Ok(())));
        assert_eq!(load(&dir).profiles.len(), 1);
        let before = std::fs::metadata(dir.join(FILE)).unwrap().modified().unwrap();
        let (n, saved) = edit(&dir, |s| s.profiles.len());
        assert_eq!((n, saved), (1, Ok(())));
        assert_eq!(std::fs::metadata(dir.join(FILE)).unwrap().modified().unwrap(), before, "an unchanged store is not rewritten");
        assert!(!dir.join(format!("{FILE}.tmp")).exists());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn row_954e_a_saved_row_naming_a_deleted_profile_rebuilds_in_the_default_and_is_cleared() {
        let mut s = Store::default();
        create(&mut s, "Work", None, true).unwrap();
        set_tab(&mut s, 7, "work").unwrap();
        // The profile goes but its row survives (a lost update, a hand edit).
        s.profiles.clear();
        assert_eq!(resolve_open(&mut s, 7, None, true), None, "a rebuild of a tab whose profile is gone runs in the default");
        assert_eq!(tab_profile(&s, 7), DEFAULT, "the dead row is cleared");
        create(&mut s, "Work", None, true).unwrap();
        set_tab(&mut s, 7, "work").unwrap();
        assert_eq!(resolve_open(&mut s, 7, None, true), Some("work".into()), "a live profile is still kept");
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

    fn scratch(tag: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("kolux-prof153-{tag}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn after153_deleting_a_profile_removes_its_data_folder_and_only_that() {
        let root = scratch("rm");
        let mine = root.join("browser-profiles").join("work");
        let other = root.join("browser-profiles").join("home");
        for d in [&mine, &other] {
            std::fs::create_dir_all(d.join("EBWebView")).unwrap();
            std::fs::write(d.join("EBWebView").join("Cookies"), b"x").unwrap();
        }
        assert_eq!(remove_data(&root, "work"), Ok(true));
        assert!(!mine.exists(), "the deleted profile's folder is gone");
        assert!(other.join("EBWebView").join("Cookies").exists(), "another profile is untouched");
        assert_eq!(remove_data(&root, "work"), Ok(false), "no folder is not an error");
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn after153_a_path_outside_the_profiles_root_is_refused() {
        let root = scratch("out");
        std::fs::create_dir_all(root.join("browser-profiles")).unwrap();
        let outside = root.join("precious");
        std::fs::create_dir_all(&outside).unwrap();
        for id in ["..", "../precious", "..\\precious", "a/b", "C:evil", "", DEFAULT] {
            assert!(remove_data(&root, id).is_err(), "{id:?} must be refused");
        }
        assert!(outside.exists() && root.join("browser-profiles").exists());
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn after153_a_link_out_of_the_root_is_not_followed() {
        let root = scratch("link");
        let base = root.join("browser-profiles");
        std::fs::create_dir_all(&base).unwrap();
        let outside = root.join("precious");
        std::fs::create_dir_all(&outside).unwrap();
        std::fs::write(outside.join("keep"), b"x").unwrap();
        #[cfg(windows)]
        let made = std::process::Command::new("cmd").args(["/C", "mklink", "/J"]).arg(base.join("evil")).arg(&outside).output().map(|o| o.status.success()).unwrap_or(false);
        #[cfg(unix)]
        let made = std::os::unix::fs::symlink(&outside, base.join("evil")).is_ok();
        if made {
            assert!(remove_data(&root, "evil").is_err());
            assert!(outside.join("keep").exists(), "the link's target is untouched");
        }
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn after153_a_profile_in_use_waits_for_its_last_tab_to_close() {
        let mut l = Live::default();
        l.opened(3, "work");
        l.opened(4, "work");
        l.doom("work");
        assert!(l.due().is_empty(), "two tabs still use it");
        l.closed(3);
        assert!(l.due().is_empty(), "one tab still uses it");
        l.closed(4);
        assert_eq!(l.due(), vec!["work".to_string()]);
        assert!(l.due().is_empty(), "it is handed out once");
        l.doom("home");
        assert_eq!(l.due(), vec!["home".to_string()], "an idle profile is due at once");
    }
}
