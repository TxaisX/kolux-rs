//! PROJ-051: when each workspace last saw activity, for the Recent sort. A project is stamped
//! when it is added and a workspace when it is made, so a newcomer starts at the top; the sidebar
//! stamps a workspace when it is shown and when its agent's state changes. Kept in the store.
// ponytail: the map keeps every folder ever stamped; prune it if it grows past a few thousand.
use crate::state::Store;
use std::collections::BTreeMap;
use std::sync::Mutex;

const KEY: &str = "workspaceActivity";

/// The same key the sidebar's `pathKey` makes: forward slashes, no trailing slash, lower case.
pub fn key(path: &str) -> String {
    path.replace('\\', "/").trim_end_matches('/').to_lowercase()
}

pub fn load(store: &Store) -> BTreeMap<String, u64> {
    store.get(KEY).ok().flatten().and_then(|s| serde_json::from_str(&s).ok()).unwrap_or_default()
}

pub fn touch(store: &Store, path: &str) -> Result<(), String> {
    let now = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0);
    let mut map = load(store);
    let at = map.entry(key(path)).or_insert(0);
    *at = (*at + 1).max(now); // two stamps in one millisecond still order
    store.set(KEY, &serde_json::to_string(&map).map_err(|e| e.to_string())?).map_err(|e| e.to_string())
}

type StoreState<'a> = tauri::State<'a, Mutex<Store>>;

#[tauri::command]
pub fn activity_get(store: StoreState<'_>) -> Result<BTreeMap<String, u64>, String> {
    Ok(load(&*store.lock().map_err(|e| e.to_string())?))
}

#[tauri::command]
pub fn activity_touch(store: StoreState<'_>, path: String) -> Result<(), String> {
    touch(&*store.lock().map_err(|e| e.to_string())?, &path)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn proj051_stamps_last_across_restarts_and_one_folder_has_one_key() {
        let dir = std::env::temp_dir().join(format!("kolux-rs-activity-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let s = Store::open(&dir).unwrap();
        touch(&s, "C:\\Repo\\Old\\").unwrap();
        touch(&s, "C:\\Repo\\New").unwrap();
        touch(&s, "c:/repo/old").unwrap();
        drop(s);
        let map = load(&Store::open(&dir).unwrap());
        assert_eq!(map.len(), 2, "both spellings of Old share a key: {map:?}");
        assert!(map["c:/repo/old"] > map["c:/repo/new"], "working in Old again moves it above New");
        let _ = std::fs::remove_dir_all(&dir);
    }
}
