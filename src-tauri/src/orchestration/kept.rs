//! A saved blob that no longer reads is never saved over (after-list row 193, T-173-c follow-up).
//!
//! Every store blob used to load as "read it, or start empty", and the next save then wrote the
//! empty value over whatever was there: one unreadable blob (a half-written value, or a layout this
//! build does not know) was a silent wipe. Here an unreadable blob is first kept aside, byte for
//! byte, under `<key>.corrupt-<ms>` in the same transaction that starts the key fresh, so nothing
//! is lost and the next read does not keep it aside a second time. A store that cannot be read at
//! all is an error, never an empty value.

use crate::state::Store;
use serde::{de::DeserializeOwned, Serialize};

fn now_ms() -> u128 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis()).unwrap_or(0)
}

/// The blob under `key`. No blob, or a cleared (`null`) one, is the default. A blob that does not
/// read is kept aside first (see the module note); the error cases leave the store untouched.
pub fn load<T: DeserializeOwned + Serialize + Default>(store: &Store, key: &str) -> Result<T, String> {
    let text = store.get(key).map_err(|e| format!("{key} could not be read ({e}); nothing was changed"))?;
    let Some(text) = text.filter(|t| t.trim() != "null") else { return Ok(T::default()) };
    match serde_json::from_str(&text) {
        Ok(v) => Ok(v),
        Err(_) => {
            set_aside(store, key, &text, &T::default())?;
            Ok(T::default())
        }
    }
}

/// For readers with no error path: the blob, or the default when the store itself cannot be read.
/// An unreadable blob is still kept aside before the default is handed back.
pub fn or_default<T: DeserializeOwned + Serialize + Default>(store: &Store, key: &str) -> T {
    load(store, key).unwrap_or_default()
}

/// Copies `text` to a free `<key>.corrupt-<ms>[-n]` name and starts `key` fresh, both in one
/// transaction: either the copy and the reset both land or neither does.
fn set_aside<T: Serialize>(store: &Store, key: &str, text: &str, fresh: &T) -> Result<String, String> {
    let base = format!("{key}.corrupt-{}", now_ms());
    let mut aside = base.clone();
    let mut n = 1;
    while store.get(&aside).map_err(|e| format!("{key} could not be kept aside ({e}); nothing was changed"))?.is_some() {
        n += 1;
        aside = format!("{base}-{n}");
    }
    let fresh = serde_json::to_string(fresh).map_err(|e| e.to_string())?;
    store.set_all(&[(aside.as_str(), text), (key, fresh.as_str())]).map_err(|e| format!("{key} could not be kept aside ({e}); nothing was changed"))?;
    Ok(aside)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::Value;

    fn fresh(tag: &str) -> (Store, std::path::PathBuf) {
        let dir = std::env::temp_dir().join(format!("kolux-rs-kept-{tag}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        (Store::open(&dir).unwrap(), dir)
    }

    fn asides(store: &Store, key: &str) -> Vec<String> {
        let base = |ms: u128| format!("{key}.corrupt-{ms}");
        // The aside name carries the time it was made; look back over the last few seconds.
        let now = now_ms();
        let mut out = Vec::new();
        for ms in now.saturating_sub(5_000)..=now {
            for n in 1..4 {
                let k = if n == 1 { base(ms) } else { format!("{}-{n}", base(ms)) };
                if let Some(v) = store.get(&k).unwrap() {
                    out.push(v);
                }
            }
        }
        out
    }

    #[test]
    fn row193_an_unreadable_blob_is_kept_aside_byte_for_byte_and_the_key_starts_fresh() {
        let (store, dir) = fresh("aside");
        let broken = "{\"runs\": [tru\u{0}\u{fffd} half written";
        store.set("demo.list", broken).unwrap();
        let got: Vec<Value> = load(&store, "demo.list").unwrap();
        assert!(got.is_empty());
        assert_eq!(asides(&store, "demo.list"), vec![broken.to_string()], "the original bytes survive under a corrupt- name");
        assert_eq!(store.get("demo.list").unwrap().as_deref(), Some("[]"), "the key starts fresh, so a second read keeps nothing aside again");
        let again: Vec<Value> = load(&store, "demo.list").unwrap();
        assert!(again.is_empty());
        assert_eq!(asides(&store, "demo.list").len(), 1);
        // A second unreadable blob in the same millisecond window gets its own name, never the first one's.
        store.set("demo.list", "{oops").unwrap();
        let _: Vec<Value> = load(&store, "demo.list").unwrap();
        let mut kept = asides(&store, "demo.list");
        kept.sort();
        assert_eq!(kept, vec![broken.to_string(), "{oops".to_string()]);
        drop(store);
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn row193_unreadable_orchestration_mail_survives_the_next_save() {
        use crate::orchestration::Mail;
        let (store, dir) = fresh("mail");
        let broken = "{\"runs\": [{\"id\": \"run-1\", \"objective\": \"ship\"}], \"messages\": [tru";
        store.set("orchestration.mail", broken).unwrap();
        let mut m = Mail::load(&store);
        assert!(!m.unread && m.runs.is_empty(), "an unreadable blob is kept aside, then the mail starts fresh");
        m.seq = 7;
        m.save(&store).unwrap();
        assert_eq!(asides(&store, "orchestration.mail"), vec![broken.to_string()], "the save did not wipe the original bytes");
        assert_eq!(Mail::load(&store).seq, 7);
        // A mail that was loaded from a store that could not be read refuses to be saved over it.
        let blind = Mail { unread: true, ..Mail::default() };
        assert!(blind.save(&store).unwrap_err().message.contains("could not be read"));
        assert_eq!(Mail::load(&store).seq, 7, "the refused save changed nothing");
        drop(store);
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn row193_absent_cleared_and_readable_blobs_are_left_alone() {
        let (store, dir) = fresh("plain");
        let none: Vec<Value> = load(&store, "demo.list").unwrap();
        assert!(none.is_empty() && store.get("demo.list").unwrap().is_none(), "reading writes nothing");
        store.set("demo.list", "null").unwrap();
        let cleared: Vec<Value> = load(&store, "demo.list").unwrap();
        assert!(cleared.is_empty() && asides(&store, "demo.list").is_empty());
        store.set("demo.list", "[1,2]").unwrap();
        let read: Vec<Value> = or_default(&store, "demo.list");
        assert_eq!(read, vec![Value::from(1), Value::from(2)]);
        assert!(asides(&store, "demo.list").is_empty());
        drop(store);
        let _ = std::fs::remove_dir_all(dir);
    }
}
