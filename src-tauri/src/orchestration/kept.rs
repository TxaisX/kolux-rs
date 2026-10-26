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
            let aside = set_aside_at(store, key, &text, &T::default(), now_ms())?;
            eprintln!("{}", kept_note(key, &aside));
            Ok(T::default())
        }
    }
}

/// For readers with no error path: the blob, or the default when the store itself cannot be read.
/// An unreadable blob is still kept aside before the default is handed back.
pub fn or_default<T: DeserializeOwned + Serialize + Default>(store: &Store, key: &str) -> T {
    load(store, key).unwrap_or_default()
}

/// The log line for a blob kept aside: the key and the copy's name, never what was in it.
fn kept_note(key: &str, aside: &str) -> String {
    format!("kolux-rs: {key} could not be read; its bytes are kept as {aside} and it starts fresh")
}

/// Copies `text` to a free `<key>.corrupt-<ms>[-n]` name (`ms` is the time, a seam for tests) and
/// starts `key` fresh, both in one transaction: either the copy and the reset both land or neither
/// does. An existing copy is never reused, so an earlier one is never replaced.
fn set_aside_at<T: Serialize>(store: &Store, key: &str, text: &str, fresh: &T, ms: u128) -> Result<String, String> {
    let base = format!("{key}.corrupt-{ms}");
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
/// Test aid: every value kept aside for `key` in the last few seconds.
pub(crate) fn asides(store: &Store, key: &str) -> Vec<String> {
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

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::Value;

    fn fresh(tag: &str) -> (Store, std::path::PathBuf) {
        let dir = std::env::temp_dir().join(format!("kolux-rs-kept-{tag}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        (Store::open(&dir).unwrap(), dir)
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
    /// Test aid: a second connection that makes the store refuse any `.corrupt-` copy, as a full disk would.
    fn refuse_copies(dir: &std::path::Path) {
        let conn = rusqlite::Connection::open(dir.join("state.db")).unwrap();
        conn.execute_batch("CREATE TRIGGER no_copies BEFORE INSERT ON kv WHEN NEW.key LIKE '%.corrupt-%' BEGIN SELECT RAISE(ABORT, 'disk full'); END;").unwrap();
    }

    #[test]
    fn row193_a_second_set_aside_in_the_same_millisecond_takes_a_free_name_and_the_first_copy_stays() {
        let (store, dir) = fresh("collide");
        store.set("demo.list", "first broken").unwrap();
        let a = set_aside_at(&store, "demo.list", "first broken", &Vec::<Value>::new(), 42).unwrap();
        store.set("demo.list", "second broken").unwrap();
        let b = set_aside_at(&store, "demo.list", "second broken", &Vec::<Value>::new(), 42).unwrap();
        store.set("demo.list", "third broken").unwrap();
        let c = set_aside_at(&store, "demo.list", "third broken", &Vec::<Value>::new(), 42).unwrap();
        assert_eq!((a.as_str(), b.as_str(), c.as_str()), ("demo.list.corrupt-42", "demo.list.corrupt-42-2", "demo.list.corrupt-42-3"));
        assert_eq!(store.get(&a).unwrap().as_deref(), Some("first broken"));
        assert_eq!(store.get(&b).unwrap().as_deref(), Some("second broken"));
        assert_eq!(store.get(&c).unwrap().as_deref(), Some("third broken"));
        drop(store);
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn row193_saves_never_touch_or_prune_a_kept_copy() {
        use crate::orchestration::Mail;
        let (store, dir) = fresh("noprune");
        let broken = "{\"runs\": [{\"id\": \"run-1\"}], \"messages\": [tru";
        store.set("orchestration.mail", broken).unwrap();
        let mut m = Mail::load(&store);
        for i in 1..=5 {
            m.seq = i;
            m.finish(&format!("k{i}"), Some(Value::from(i)));
            m.save(&store).unwrap();
            m = Mail::load(&store);
        }
        assert_eq!(asides(&store, "orchestration.mail"), vec![broken.to_string()], "five loads and saves later the copy is the same bytes, once");
        drop(store);
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn row193_when_the_copy_cannot_be_made_the_original_stays_and_the_save_is_refused() {
        use crate::orchestration::Mail;
        let (store, dir) = fresh("nocopy");
        let broken = "{\"runs\": [{\"id\": \"secret-run\"}], \"messages\": [tru";
        store.set("orchestration.mail", broken).unwrap();
        refuse_copies(&dir);
        let err = load::<Vec<Value>>(&store, "orchestration.mail").unwrap_err();
        assert!(err.contains("orchestration.mail") && err.contains("nothing was changed"), "{err}");
        assert_eq!(store.get("orchestration.mail").unwrap().as_deref(), Some(broken), "the original is byte-identical");
        let m = Mail::load(&store);
        assert!(m.unread, "a load that could not keep the blob aside marks the mail unread");
        let refused = m.save(&store).unwrap_err();
        assert!(refused.message.contains("orchestration.mail") && refused.message.contains("nothing was saved over it"), "{}", refused.message);
        assert_eq!(store.get("orchestration.mail").unwrap().as_deref(), Some(broken), "the refused save left the original alone");
        drop(store);
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn row193_the_messages_name_the_key_and_never_the_blob() {
        let secret = "SECRET-TOKEN-abc123";
        let (store, dir) = fresh("notice");
        let blob = format!("{{\"runs\": \"{secret}\" nope");
        store.set("demo.list", &blob).unwrap();
        let aside = set_aside_at(&store, "demo.list", &blob, &Vec::<Value>::new(), 7).unwrap();
        let kept = kept_note("demo.list", &aside);
        assert!(kept.contains("demo.list") && kept.contains(&aside) && !kept.contains(secret), "{kept}");
        store.set("demo.list", &blob).unwrap();
        refuse_copies(&dir);
        let failed = load::<Vec<Value>>(&store, "demo.list").unwrap_err();
        assert!(failed.contains("demo.list") && !failed.contains(secret), "{failed}");
        drop(store);
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn row193_a_clean_mail_round_trips_unchanged_and_keeps_nothing_aside() {
        use crate::orchestration::Mail;
        let (store, dir) = fresh("clean");
        let mut m = Mail { seq: 9, ..Mail::default() };
        m.finish("a|b|c", Some(Value::from("done")));
        m.save(&store).unwrap();
        let back = Mail::load(&store);
        assert_eq!(back, m);
        assert!(!back.unread && asides(&store, "orchestration.mail").is_empty());
        drop(store);
        let _ = std::fs::remove_dir_all(dir);
    }
}
