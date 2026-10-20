//! T-271 (SAFE-027): the floating workspace opens only in folders the user picked. Only a folder
//! chosen in the system folder picker joins the trusted list; no command takes a list from the
//! interface, and the list lives in the store, not in the settings file that settings sync writes,
//! so a list sent any other way is never read. At load the list is cleaned: blank entries dropped,
//! reachable ones put in their canonical form, unreachable ones (a drive unplugged for now) kept as
//! they are. The older single working-folder setting is moved in once, behind a marker; a blank old
//! value becomes the home folder. Everything fails closed: a folder that is not on the list, is not
//! reachable now, or a store that cannot be read, opens nothing.

use crate::state::Store;
use std::path::Path;
use std::sync::Mutex;

const TRUSTED_KEY: &str = "floating.trusted";
const MOVED_KEY: &str = "floating.legacyMoved";
/// The older single working-folder setting in the settings file (coordinator default name, T-271).
pub const LEGACY_SETTING: &str = "floatingCwd";

type Canon<'a> = &'a dyn Fn(&str) -> Option<String>;

/// A path as the user knows it: no `\\?\` prefix from canonicalising.
fn plain(p: &Path) -> String {
    let s = p.to_string_lossy();
    if let Some(rest) = s.strip_prefix(r"\\?\UNC\") {
        return format!(r"\\{rest}");
    }
    s.strip_prefix(r"\\?\").unwrap_or(&s).to_string()
}

/// The canonical form of a folder reachable now; None when it is missing, unreachable or a file.
pub fn canonical(p: &str) -> Option<String> {
    let c = std::fs::canonicalize(p).ok()?;
    c.is_dir().then(|| plain(&c))
}

/// Two entries name the same folder (Windows paths ignore case).
fn same(a: &str, b: &str) -> bool {
    if cfg!(windows) {
        a.to_lowercase() == b.to_lowercase()
    } else {
        a == b
    }
}

fn home() -> String {
    std::env::var("USERPROFILE").or_else(|_| std::env::var("HOME")).unwrap_or_default()
}

/// SAFE-027 at load: blank entries dropped, reachable ones canonical, unreachable ones kept as they are, none twice.
pub fn normalise(list: &[String], canon: Canon) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    for raw in list {
        let t = raw.trim();
        if t.is_empty() {
            continue;
        }
        let p = canon(t).unwrap_or_else(|| t.to_string());
        if !out.iter().any(|o| same(o, &p)) {
            out.push(p);
        }
    }
    out
}

/// The once-only move of the old single folder into the list (a blank old value is the home folder).
/// Returns true when the marker has to be set now; with the marker set it changes nothing, so an old
/// value written later (by settings sync, say) is never trusted.
pub fn migrate(list: &mut Vec<String>, legacy: Option<&str>, moved: bool, home: &str) -> bool {
    if moved {
        return false;
    }
    if let Some(v) = legacy {
        let v = if v.trim().is_empty() { home.trim() } else { v.trim() };
        if !v.is_empty() && !list.iter().any(|o| same(o, v)) {
            list.push(v.to_string());
        }
    }
    true
}

/// The folder's canonical form when it is on the list and reachable now; None otherwise. Only the
/// picked folder itself counts, not a folder inside it.
pub fn trusted_folder(list: &[String], folder: &str, canon: Canon) -> Option<String> {
    let want = canon(folder.trim())?;
    list.iter().any(|t| same(&canon(t).unwrap_or_else(|| t.clone()), &want)).then_some(want)
}

/// Where a floating terminal starts: the asked folder when it is trusted, else (nothing asked) the
/// most recently picked folder that is reachable; refused otherwise, with the reason the panel shows.
pub fn resolve_start(list: &[String], asked: Option<&str>, canon: Canon) -> Result<String, String> {
    match asked.map(str::trim).filter(|s| !s.is_empty()) {
        Some(a) => trusted_folder(list, a, canon).ok_or_else(|| format!("{a} is not a folder you picked for the floating workspace. Choose it with Pick folder first.")),
        None => list.iter().rev().find_map(|t| canon(t)).ok_or_else(|| "Pick a folder for the floating workspace first.".to_string()),
    }
}

/// The trusted list as stored, cleaned and with the old setting moved in once; writes back only what
/// changed. A stored list that cannot be read trusts nothing and is left as it is (never wiped).
pub fn load(store: &Store, canon: Canon, home: &str) -> Vec<String> {
    let raw = store.get(TRUSTED_KEY).ok().flatten();
    let mut list: Vec<String> = match &raw {
        None => Vec::new(),
        Some(s) => match serde_json::from_str(s) {
            Ok(l) => l,
            Err(_) => return Vec::new(),
        },
    };
    let before = list.clone();
    let moved = store.get(MOVED_KEY).ok().flatten().is_some();
    let settings = store.settings();
    let legacy = settings.get(LEGACY_SETTING).map(|v| v.as_str().unwrap_or(""));
    let mark = migrate(&mut list, legacy, moved, home);
    let list = normalise(&list, canon);
    let json = serde_json::to_string(&list).unwrap_or_else(|_| "[]".into());
    let mut pairs: Vec<(&str, &str)> = Vec::new();
    if list != before {
        pairs.push((TRUSTED_KEY, &json));
    }
    if mark {
        pairs.push((MOVED_KEY, "1"));
    }
    if !pairs.is_empty() {
        let _ = store.set_all(&pairs);
    }
    list
}

/// A folder the system picker returned joins the list (canonical, once). The only way in.
fn trust_picked(store: &Store, folder: &str, canon: Canon, home: &str) -> Result<String, String> {
    let c = canon(folder).ok_or_else(|| format!("{folder} cannot be opened"))?;
    let mut list = load(store, canon, home);
    if !list.iter().any(|t| same(t, &c)) {
        list.push(c.clone());
        let json = serde_json::to_string(&list).map_err(|e| e.to_string())?;
        store.set(TRUSTED_KEY, &json).map_err(|e| e.to_string())?;
    }
    Ok(c)
}

/// SAFE-027: the folders the floating workspace may open in.
#[tauri::command]
pub fn floating_trusted(store: tauri::State<'_, Mutex<Store>>) -> Result<Vec<String>, String> {
    let s = store.lock().map_err(|e| e.to_string())?;
    Ok(load(&s, &canonical, &home()))
}

/// SAFE-027: shows the system folder picker; the folder chosen there is trusted and returned (none when cancelled).
#[tauri::command]
pub async fn floating_pick(app: tauri::AppHandle, store: tauri::State<'_, Mutex<Store>>) -> Result<Option<String>, String> {
    use tauri_plugin_dialog::DialogExt;
    let Some(chosen) = app.dialog().file().set_title("Choose a folder for the floating workspace").blocking_pick_folder() else { return Ok(None) };
    let path = chosen.into_path().map_err(|e| e.to_string())?;
    let s = store.lock().map_err(|e| e.to_string())?;
    trust_picked(&s, &plain(&path), &canonical, &home()).map(Some)
}

/// SAFE-027: the folder a floating terminal or agent starts in, or the refusal (fails closed).
#[tauri::command]
pub fn floating_start(store: tauri::State<'_, Mutex<Store>>, asked: Option<String>) -> Result<String, String> {
    let s = store.lock().map_err(|_| "The trusted folders could not be read.".to_string())?;
    let list = load(&s, &canonical, &home());
    resolve_start(&list, asked.as_deref(), &canonical)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn s(v: &[&str]) -> Vec<String> {
        v.iter().map(|x| x.to_string()).collect()
    }

    #[test]
    fn t271_load_drops_blanks_canonicalises_reachable_and_keeps_unreachable() {
        let d = crate::test_dir::temp("t271-norm");
        let real = d.join("Work");
        std::fs::create_dir_all(&real).unwrap();
        let canon_real = canonical(real.to_str().unwrap()).unwrap();
        assert!(!canon_real.starts_with(r"\\?\"), "no verbatim prefix: {canon_real}");
        let gone = r"Q:\unplugged\project";
        let dotted = format!("{}{}..{}Work", real.display(), std::path::MAIN_SEPARATOR, std::path::MAIN_SEPARATOR);
        let list = s(&["", "   ", &dotted, gone, real.to_str().unwrap(), gone]);
        assert_eq!(normalise(&list, &canonical), vec![canon_real.clone(), gone.to_string()]);
    }

    #[test]
    fn t271_the_old_folder_moves_in_once_and_a_blank_one_is_home() {
        let mut l = Vec::new();
        assert!(migrate(&mut l, Some("C:/old"), false, "C:/Users/me"));
        assert_eq!(l, s(&["C:/old"]));
        // The marker is set: a later old value (settings sync) is never added.
        assert!(!migrate(&mut l, Some("C:/sneaky"), true, "C:/Users/me"));
        assert_eq!(l, s(&["C:/old"]));
        let mut b = Vec::new();
        assert!(migrate(&mut b, Some("  "), false, "C:/Users/me"));
        assert_eq!(b, s(&["C:/Users/me"]));
        // No old setting at all still sets the marker, so one arriving later is not moved in.
        let mut n = Vec::new();
        assert!(migrate(&mut n, None, false, "C:/Users/me"));
        assert!(n.is_empty());
    }

    #[test]
    fn t271_a_list_sent_through_settings_is_ignored_and_the_store_list_survives_reload() {
        let d = crate::test_dir::temp("t271-store");
        let picked = d.join("picked");
        let other = d.join("other");
        std::fs::create_dir_all(&picked).unwrap();
        std::fs::create_dir_all(&other).unwrap();
        let home = d.join("home");
        std::fs::create_dir_all(&home).unwrap();
        {
            let store = Store::open(&d).unwrap();
            // Settings sync writes whatever it likes into the settings file, including lists and the old key.
            store.save_settings(&serde_json::json!({ "floatingTrusted": [other.to_str().unwrap()], "floatingWorkspaceTrusted": [other.to_str().unwrap()], "floatingCwd": "" })).unwrap();
            let first = load(&store, &canonical, home.to_str().unwrap());
            // Only the old blank setting moved in, as the home folder; the sent lists never count.
            assert_eq!(first, vec![canonical(home.to_str().unwrap()).unwrap()]);
            let p = trust_picked(&store, picked.to_str().unwrap(), &canonical, home.to_str().unwrap()).unwrap();
            assert_eq!(p, canonical(picked.to_str().unwrap()).unwrap());
            // A later old value and a later list from sync change nothing.
            store.save_settings(&serde_json::json!({ "floatingTrusted": [other.to_str().unwrap()], "floatingCwd": other.to_str().unwrap() })).unwrap();
            // An entry whose drive is unplugged for now is kept at reload.
            let mut l = load(&store, &canonical, home.to_str().unwrap());
            l.push(r"Q:\unplugged".into());
            store.set(TRUSTED_KEY, &serde_json::to_string(&l).unwrap()).unwrap();
        }
        let store = Store::open(&d).unwrap();
        let again = load(&store, &canonical, home.to_str().unwrap());
        assert_eq!(again.len(), 3, "{again:?}");
        assert!(again.iter().any(|t| t == r"Q:\unplugged"));
        assert!(!again.iter().any(|t| same(t, &canonical(other.to_str().unwrap()).unwrap())));
        assert!(resolve_start(&again, other.to_str(), &canonical).is_err());
        drop(store);
    }

    #[test]
    fn t271_a_stored_list_that_cannot_be_read_trusts_nothing_and_is_not_wiped() {
        let d = crate::test_dir::temp("t271-bad");
        let store = Store::open(&d).unwrap();
        store.set(TRUSTED_KEY, "{not json").unwrap();
        assert!(load(&store, &canonical, "C:/Users/me").is_empty());
        assert_eq!(store.get(TRUSTED_KEY).unwrap().as_deref(), Some("{not json"));
        assert!(resolve_start(&[], None, &canonical).is_err());
        drop(store);
    }

    #[test]
    fn t271_the_floating_workspace_refuses_every_folder_the_user_did_not_pick() {
        let d = crate::test_dir::temp("t271-refuse");
        let picked = d.join("picked");
        let inside = picked.join("inside");
        let other = d.join("other");
        for f in [&inside, &other] {
            std::fs::create_dir_all(f).unwrap();
        }
        let list = vec![canonical(picked.to_str().unwrap()).unwrap(), r"Q:\unplugged".to_string()];
        let ok = resolve_start(&list, picked.to_str(), &canonical).unwrap();
        assert_eq!(ok, list[0]);
        // Case and a trailing separator do not matter on Windows.
        if cfg!(windows) {
            assert!(resolve_start(&list, Some(&format!("{}\\", picked.to_str().unwrap().to_uppercase())), &canonical).is_ok());
        }
        // Another folder, a folder inside the picked one, a missing one and a file are all refused.
        let file = d.join("f.txt");
        std::fs::write(&file, "x").unwrap();
        for bad in [other.to_str().unwrap(), inside.to_str().unwrap(), r"C:\no\such\folder-t271", file.to_str().unwrap(), "..", r"Q:\unplugged"] {
            let e = resolve_start(&list, Some(bad), &canonical).unwrap_err();
            assert!(e.contains("not a folder you picked"), "{bad}: {e}");
        }
        // Nothing asked: the most recent reachable pick; an empty list opens nothing.
        assert_eq!(resolve_start(&list, None, &canonical).unwrap(), list[0]);
        assert_eq!(resolve_start(&list, Some("  "), &canonical).unwrap(), list[0]);
        assert_eq!(resolve_start(&[], None, &canonical).unwrap_err(), "Pick a folder for the floating workspace first.");
        assert!(resolve_start(&s(&[r"Q:\unplugged"]), None, &canonical).is_err());
    }
}
