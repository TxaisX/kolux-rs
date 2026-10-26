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
        Err(e) => {
            let aside = set_aside_at(store, key, &text, &T::default(), now_ms())?;
            eprintln!("{}", kept_note(key, &aside, &decode_kind(&e)));
            Ok(T::default())
        }
    }
}

/// For readers with no error path: the blob, or the default when the store itself cannot be read.
/// An unreadable blob is still kept aside before the default is handed back.
pub fn or_default<T: DeserializeOwned + Serialize + Default>(store: &Store, key: &str) -> T {
    load(store, key).unwrap_or_default()
}

/// What went wrong reading, by kind and place only: serde_json's own text can echo the input.
fn decode_kind(e: &serde_json::Error) -> String {
    format!("{:?} error at line {} column {}", e.classify(), e.line(), e.column())
}

/// The log line for a blob kept aside: the key, why it did not read (kind and place) and the copy's
/// name, never what was in it.
fn kept_note(key: &str, aside: &str, why: &str) -> String {
    format!("kolux-rs: {key} could not be read ({why}); its bytes are kept as {aside} and it starts fresh")
}

#[cfg(test)]
/// Test aid: a second connection that makes the store refuse any `.corrupt-` copy, as a full disk would.
pub(crate) fn refuse_copies(dir: &std::path::Path) {
    let conn = rusqlite::Connection::open(dir.join("state.db")).unwrap();
    conn.execute_batch("CREATE TRIGGER no_copies BEFORE INSERT ON kv WHEN NEW.key LIKE '%.corrupt-%' BEGIN SELECT RAISE(ABORT, 'disk full'); END;").unwrap();
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
/// Test aid: every value kept aside for `key`, read straight from the store's table. (It used to
/// probe the last 5 s of millisecond names one query each, so a PC slow enough to take 5 s over
/// the first call missed the copy on the second.)
pub(crate) fn asides(store: &Store, key: &str) -> Vec<String> {
    let conn = rusqlite::Connection::open(store.dir().join("state.db")).unwrap();
    let mut q = conn.prepare("SELECT value FROM kv WHERE key LIKE ?1 ORDER BY key").unwrap();
    q.query_map([format!("{key}.corrupt-%")], |r| r.get(0)).unwrap().map(Result::unwrap).collect()
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
        let why = decode_kind(&serde_json::from_str::<Vec<Value>>(&blob).unwrap_err());
        let kept = kept_note("demo.list", &aside, &why);
        assert!(kept.contains("demo.list") && kept.contains(&aside) && !kept.contains(secret), "{kept}");
        assert!(kept.contains("Data error at line 1 column 0"), "the decode error's kind and place are named: {kept}");
        let torn = serde_json::from_str::<Vec<Value>>(&format!("[\"{secret}\" nope")).unwrap_err();
        let torn_note = kept_note("demo.list", &aside, &decode_kind(&torn));
        assert!(torn_note.contains("Syntax error at line 1 column ") && !torn_note.contains(secret), "{torn_note}");
        // serde_json's own text can echo the input (a type mismatch quotes the value), so it is never used.
        let shaped = serde_json::from_str::<Vec<u8>>(&format!("[\"{secret}\"]")).unwrap_err();
        assert!(shaped.to_string().contains(secret), "this Display text does echo the input: {shaped}");
        let shaped_note = kept_note("demo.list", &aside, &decode_kind(&shaped));
        assert!(shaped_note.contains("Data error at line 1 column ") && !shaped_note.contains(secret), "{shaped_note}");
        store.set("demo.list", &blob).unwrap();
        refuse_copies(&dir);
        let failed = load::<Vec<Value>>(&store, "demo.list").unwrap_err();
        assert!(failed.contains("demo.list") && !failed.contains(secret), "{failed}");
        drop(store);
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn row193_reset_all_keeps_an_unread_mail_unread_so_the_original_is_never_overwritten() {
        use crate::orchestration::Mail;
        let (store, dir) = fresh("resetall");
        let broken = "{\"runs\": [{\"id\": \"run-9\"}], \"messages\": [tru";
        store.set("orchestration.mail", broken).unwrap();
        refuse_copies(&dir);
        let mut m = Mail::load(&store);
        assert!(m.unread);
        m.reset("all").unwrap();
        assert!(m.unread, "reset --all must not clear the unread mark");
        let refused = m.save(&store).unwrap_err();
        assert!(refused.message.contains("orchestration.mail") && refused.message.contains("nothing was saved over it"), "{}", refused.message);
        assert_eq!(store.get("orchestration.mail").unwrap().as_deref(), Some(broken), "the original is byte-identical");
        assert!(asides(&store, "orchestration.mail").is_empty());
        drop(store);
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn row193_when_starting_the_key_fresh_fails_the_copy_is_rolled_back_too() {
        use crate::orchestration::Mail;
        let (store, dir) = fresh("rollback");
        let broken = "{\"runs\": [{\"id\": \"run-9\"}], \"messages\": [tru";
        store.set("orchestration.mail", broken).unwrap();
        // The copy (first statement) is allowed; only the write to the original key aborts.
        let conn = rusqlite::Connection::open(dir.join("state.db")).unwrap();
        conn.execute_batch(
            "CREATE TRIGGER keep_orig_upd BEFORE UPDATE ON kv WHEN NEW.key = 'orchestration.mail' BEGIN SELECT RAISE(ABORT, 'locked'); END;
             CREATE TRIGGER keep_orig_ins BEFORE INSERT ON kv WHEN NEW.key = 'orchestration.mail' BEGIN SELECT RAISE(ABORT, 'locked'); END;",
        )
        .unwrap();
        let m = Mail::load(&store);
        assert!(m.unread, "a load whose reset could not land marks the mail unread");
        let copies: i64 = conn.query_row("SELECT count(*) FROM kv WHERE key LIKE '%.corrupt-%'", [], |r| r.get(0)).unwrap();
        assert_eq!(copies, 0, "the copy rolled back with the failed reset");
        assert!(asides(&store, "orchestration.mail").is_empty());
        assert_eq!(store.get("orchestration.mail").unwrap().as_deref(), Some(broken), "the original is byte-identical");
        assert!(m.save(&store).unwrap_err().message.contains("nothing was saved over it"));
        assert_eq!(store.get("orchestration.mail").unwrap().as_deref(), Some(broken));
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
