//! USAGE-012 / USAGE-013: token analytics read the logs Claude Code and Codex already keep on this
//! computer; nothing is sent anywhere. Tracking is opt-in per provider. A scan buckets every reply's
//! token counts by local day, session, model, working folder and prompt size; the last good scan is
//! saved and shown at once, a failed scan keeps it, and a second scan request joins the running one.
//! The log shapes were read from field names only (PROVENANCE.md section 5, 2026-10-12): unknown
//! fields are ignored, and a line or file that does not parse is skipped, never a crash.
use crate::state::Store;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::{Condvar, Mutex};

pub const PROVIDERS: [&str; 2] = ["claude", "codex"];
const KEY_TRACKING: &str = "token_tracking";
fn key_saved(provider: &str) -> String {
    format!("token_usage_{provider}")
}

/// One bucket: a local day, session, model, working folder and prompt-size band.
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Row {
    pub day: String,
    pub session: String,
    pub model: String,
    pub cwd: String,
    /// Largest prompt in the bucket: 0 up to 100k tokens, 1 up to 200k, 2 above.
    pub band: u8,
    /// Fresh input: not read from or written to the cache.
    pub input: u64,
    pub output: u64,
    pub cache_read: u64,
    /// All cache writes; `cache_write_1h` of them live an hour, the rest five minutes.
    pub cache_write: u64,
    pub cache_write_1h: u64,
    /// Thinking / reasoning tokens, already inside `output`.
    pub reasoning: u64,
    /// The latest reply's time, UTC milliseconds.
    pub last: u64,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Saved {
    pub scanned_at: u64,
    pub rows: Vec<Row>,
    /// Why the latest scan failed; the rows are then the last good ones.
    pub error: Option<String>,
}

/// One reply's counts before bucketing.
struct Turn {
    at: u64,
    session: String,
    model: String,
    cwd: String,
    input: u64,
    output: u64,
    cache_read: u64,
    cache_write: u64,
    cache_write_1h: u64,
    reasoning: u64,
}

fn n(v: &Value, key: &str) -> u64 {
    v.get(key).and_then(Value::as_u64).unwrap_or(0)
}
fn s<'a>(v: &'a Value, key: &str) -> Option<&'a str> {
    v.get(key).and_then(Value::as_str).filter(|t| !t.is_empty())
}
fn stem(name: &str) -> String {
    Path::new(name).file_stem().map(|s| s.to_string_lossy().into_owned()).unwrap_or_default()
}
fn records(text: &str) -> impl Iterator<Item = Value> + '_ {
    text.lines().filter_map(|l| serde_json::from_str::<Value>(l).ok()).filter(Value::is_object)
}

/// Adds turns into buckets keyed by local day, session, model, folder and prompt-size band.
fn bucket(turns: impl IntoIterator<Item = Turn>, tz: &jiff::tz::TimeZone) -> Vec<Row> {
    let mut rows: HashMap<(String, String, String, String, u8), Row> = HashMap::new();
    for t in turns {
        if t.input + t.output + t.cache_read + t.cache_write == 0 {
            continue;
        }
        let Some(day) = i64::try_from(t.at).ok().and_then(|ms| jiff::Timestamp::from_millisecond(ms).ok()).map(|ts| ts.to_zoned(tz.clone()).date().to_string()) else { continue };
        let prompt = t.input + t.cache_read + t.cache_write;
        let band = if prompt > 200_000 { 2 } else if prompt > 100_000 { 1 } else { 0 };
        let r = rows.entry((day.clone(), t.session.clone(), t.model.clone(), t.cwd.clone(), band)).or_insert_with(|| Row { day, session: t.session, model: t.model, cwd: t.cwd, band, ..Row::default() });
        r.input += t.input;
        r.output += t.output;
        r.cache_read += t.cache_read;
        r.cache_write += t.cache_write;
        r.cache_write_1h += t.cache_write_1h;
        r.reasoning += t.reasoning;
        r.last = r.last.max(t.at);
    }
    let mut out: Vec<Row> = rows.into_values().collect();
    out.sort_by(|a, b| (&a.day, a.last).cmp(&(&b.day, b.last)));
    out
}

/// Claude Code transcripts, as (file name, text). A reply is counted once by its message id, the
/// last piece written winning, so streamed pieces and turns copied into a fork are not added twice.
/// ponytail: which copy of a forked turn gets the credit, deleted originals and unchanged-file
/// skipping are T-170 (USAGE-016).
pub fn claude_rows(files: &[(String, String)], tz: &jiff::tz::TimeZone) -> Vec<Row> {
    let mut turns: HashMap<String, Turn> = HashMap::new();
    for (name, text) in files {
        for (i, v) in records(text).enumerate() {
            let Some(usage) = v.get("message").and_then(|m| m.get("usage")).filter(|u| u.is_object()) else { continue };
            let Some(at) = s(&v, "timestamp").and_then(crate::capture::parse_time) else { continue };
            let msg = &v["message"];
            let id = s(msg, "id").or_else(|| s(&v, "requestId")).or_else(|| s(&v, "uuid")).map(String::from).unwrap_or_else(|| format!("{name}:{i}"));
            let split = usage.get("cache_creation").filter(|c| c.is_object());
            let lifetimes = split.map(|c| n(c, "ephemeral_5m_input_tokens") + n(c, "ephemeral_1h_input_tokens")).unwrap_or(0);
            let cache_write = if usage.get("cache_creation_input_tokens").is_some_and(Value::is_u64) { n(usage, "cache_creation_input_tokens") } else { lifetimes };
            let output = n(usage, "output_tokens");
            let thinking = usage.get("output_tokens_details").map(|d| n(d, "thinking_tokens")).unwrap_or(0);
            turns.insert(
                id,
                Turn {
                    at,
                    session: s(&v, "sessionId").map(String::from).unwrap_or_else(|| stem(name)),
                    model: s(msg, "model").unwrap_or("unknown").into(),
                    cwd: s(&v, "cwd").unwrap_or_default().into(),
                    input: n(usage, "input_tokens"),
                    output,
                    cache_read: n(usage, "cache_read_input_tokens"),
                    cache_write,
                    cache_write_1h: split.map(|c| n(c, "ephemeral_1h_input_tokens")).unwrap_or(0).min(cache_write),
                    reasoning: thinking.min(output),
                },
            );
        }
    }
    bucket(turns.into_values(), tz)
}

/// Codex session logs, as (file name, text). A token event is counted by its own last-turn figures,
/// and only when the running total moved, so a repeated event adds nothing and the first event of a
/// resumed session is not taken as its whole history. Cached input is part of Codex's input count.
/// ponytail: forks, aliases and per-worktree credit are T-170 (USAGE-017).
pub fn codex_rows(files: &[(String, String)], tz: &jiff::tz::TimeZone) -> Vec<Row> {
    let mut turns = Vec::new();
    for (name, text) in files {
        let (mut session, mut model, mut cwd) = (None::<String>, "unknown".to_string(), String::new());
        let mut prev: Option<Value> = None;
        for (i, v) in records(text).enumerate() {
            let Some(p) = v.get("payload").filter(|p| p.is_object()) else { continue };
            if let Some(m) = s(p, "model") {
                model = m.into();
            }
            if let Some(c) = s(p, "cwd") {
                cwd = c.into();
            }
            if session.is_none() {
                session = s(p, "session_id").or_else(|| if i == 0 { s(p, "id") } else { None }).map(String::from);
            }
            let Some(info) = p.get("info").filter(|x| x.is_object()) else { continue };
            let Some(total) = info.get("total_token_usage").filter(|x| x.is_object()) else { continue };
            if prev.as_ref() == Some(total) {
                continue;
            }
            let last = match (info.get("last_token_usage").filter(|x| x.is_object()), &prev) {
                (Some(l), _) => l.clone(),
                // no last-turn figures: the step since the previous running total
                (None, Some(before)) => serde_json::json!({
                    "input_tokens": n(total, "input_tokens").saturating_sub(n(before, "input_tokens")),
                    "cached_input_tokens": n(total, "cached_input_tokens").saturating_sub(n(before, "cached_input_tokens")),
                    "output_tokens": n(total, "output_tokens").saturating_sub(n(before, "output_tokens")),
                    "reasoning_output_tokens": n(total, "reasoning_output_tokens").saturating_sub(n(before, "reasoning_output_tokens")),
                }),
                (None, None) => {
                    prev = Some(total.clone());
                    continue;
                }
            };
            prev = Some(total.clone());
            let Some(at) = s(&v, "timestamp").and_then(crate::capture::parse_time) else { continue };
            let (input, output) = (n(&last, "input_tokens"), n(&last, "output_tokens"));
            let cached = n(&last, "cached_input_tokens").min(input);
            turns.push(Turn {
                at,
                session: session.clone().unwrap_or_else(|| stem(name)),
                model: model.clone(),
                cwd: cwd.clone(),
                input: input - cached,
                output,
                cache_read: cached,
                cache_write: 0,
                cache_write_1h: 0,
                reasoning: n(&last, "reasoning_output_tokens").min(output),
            });
        }
    }
    bucket(turns, tz)
}

/// Scans in flight, by provider. A request for one already running waits for it and reads its result.
#[derive(Default)]
pub struct Flights {
    running: Mutex<HashSet<String>>,
    done: Condvar,
}

impl Flights {
    /// Runs `work` unless a run for `key` is in flight, in which case it waits for that one. True when it ran.
    pub fn run(&self, key: &str, work: impl FnOnce()) -> bool {
        let mut running = self.running.lock().unwrap_or_else(|e| e.into_inner());
        if running.contains(key) {
            while running.contains(key) {
                running = self.done.wait(running).unwrap_or_else(|e| e.into_inner());
            }
            return false;
        }
        running.insert(key.into());
        drop(running);
        struct Landed<'a>(&'a Flights, &'a str);
        impl Drop for Landed<'_> {
            fn drop(&mut self) {
                self.0.running.lock().unwrap_or_else(|e| e.into_inner()).remove(self.1);
                self.0.done.notify_all();
            }
        }
        let _landed = Landed(self, key);
        work();
        true
    }
}

/// The recorded choice, or, for an older profile that never recorded one, on when it has saved results.
pub fn tracking_of(choice: Option<bool>, has_saved: bool) -> bool {
    choice.unwrap_or(has_saved)
}

fn saved(store: &Store, provider: &str) -> Option<Saved> {
    store.get(&key_saved(provider)).ok().flatten().and_then(|t| serde_json::from_str(&t).ok())
}
fn choices(store: &Store) -> serde_json::Map<String, Value> {
    store.get(KEY_TRACKING).ok().flatten().and_then(|t| serde_json::from_str(&t).ok()).unwrap_or_default()
}

/// Every .jsonl file under `root`, any depth.
fn jsonl_under(root: &Path, out: &mut Vec<PathBuf>) {
    for e in std::fs::read_dir(root).into_iter().flatten().flatten() {
        let p = e.path();
        if e.file_type().is_ok_and(|t| t.is_dir()) {
            jsonl_under(&p, out);
        } else if p.extension().is_some_and(|x| x == "jsonl") {
            out.push(p);
        }
    }
}

/// The log folders a provider's scan reads.
fn roots(store: &Store, provider: &str) -> Vec<PathBuf> {
    if provider == "claude" {
        return crate::capture::claude_dir().map(|d| d.join("projects")).into_iter().collect();
    }
    let mut out: Vec<PathBuf> = std::env::var_os("USERPROFILE").or_else(|| std::env::var_os("HOME")).map(|h| PathBuf::from(h).join(".codex").join("sessions")).into_iter().collect();
    out.extend(crate::codex_accounts::load(store).into_iter().map(|a| PathBuf::from(a.home).join("sessions")));
    out
}

/// Reads one provider's logs. None of its folders being there is a failure, so saved figures stay.
fn scan(roots: &[PathBuf], provider: &str) -> Result<Vec<Row>, String> {
    let present: Vec<&PathBuf> = roots.iter().filter(|r| r.is_dir()).collect();
    if present.is_empty() {
        return Err(if provider == "claude" { "its projects folder is not there" } else { "its sessions folder is not there" }.into());
    }
    let mut paths = Vec::new();
    for r in present {
        jsonl_under(r, &mut paths);
    }
    let files: Vec<(String, String)> = paths.iter().filter_map(|p| std::fs::read_to_string(p).ok().map(|t| (p.file_name().unwrap_or_default().to_string_lossy().into_owned(), t))).collect();
    let tz = jiff::tz::TimeZone::system();
    Ok(if provider == "claude" { claude_rows(&files, &tz) } else { codex_rows(&files, &tz) })
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Usage {
    pub tracking: serde_json::Map<String, Value>,
    pub claude: Option<Saved>,
    pub codex: Option<Saved>,
}

/// What opening the page shows at once: the tracking choices and the saved results.
#[tauri::command]
pub fn token_usage(store: tauri::State<'_, Mutex<Store>>) -> Result<Usage, String> {
    let s = store.lock().map_err(|e| e.to_string())?;
    let (claude, codex) = (saved(&s, "claude"), saved(&s, "codex"));
    let picked = choices(&s);
    let tracking = PROVIDERS.iter().map(|p| (p.to_string(), Value::Bool(tracking_of(picked.get(*p).and_then(Value::as_bool), if *p == "claude" { claude.is_some() } else { codex.is_some() })))).collect();
    Ok(Usage { tracking, claude, codex })
}

#[tauri::command]
pub fn token_tracking_set(store: tauri::State<'_, Mutex<Store>>, provider: String, on: bool) -> Result<(), String> {
    if !PROVIDERS.contains(&provider.as_str()) {
        return Err(format!("unknown provider {provider}"));
    }
    let s = store.lock().map_err(|e| e.to_string())?;
    let mut all = choices(&s);
    all.insert(provider, Value::Bool(on));
    s.set(KEY_TRACKING, &Value::Object(all).to_string()).map_err(|e| e.to_string())
}

/// Rescans one provider and saves the result; a failed scan keeps the last good rows and says why.
#[tauri::command]
pub async fn token_usage_scan(app: tauri::AppHandle, provider: String) -> Result<Saved, String> {
    use tauri::Manager;
    if !PROVIDERS.contains(&provider.as_str()) {
        return Err(format!("unknown provider {provider}"));
    }
    tauri::async_runtime::spawn_blocking(move || {
        let store = app.state::<Mutex<Store>>();
        app.state::<Flights>().run(&provider, || {
            let dirs = match store.lock() {
                Ok(s) => roots(&s, &provider),
                Err(_) => return,
            };
            let result = scan(&dirs, &provider);
            let Ok(s) = store.lock() else { return };
            let before = saved(&s, &provider);
            let next = match result {
                Ok(rows) => Saved { scanned_at: crate::artifacts::now_ms(), rows, error: None },
                Err(e) => Saved { error: Some(e), ..before.unwrap_or_default() },
            };
            let _ = s.set(&key_saved(&provider), &serde_json::to_string(&next).unwrap_or_default());
        });
        let s = store.lock().map_err(|e| e.to_string())?;
        Ok(saved(&s, &provider).unwrap_or_default())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;
    use jiff::tz::TimeZone;
    use serde_json::json;

    fn file(name: &str, lines: &[Value]) -> (String, String) {
        (name.into(), lines.iter().map(|l| l.to_string()).collect::<Vec<_>>().join("\n"))
    }
    // Invented records with the observed field names; no value comes from a real log.
    fn reply(id: &str, at: &str, usage: Value) -> Value {
        json!({ "type": "assistant", "timestamp": at, "sessionId": "s-1", "cwd": "C:/work/app", "uuid": format!("u-{id}"),
                "message": { "id": id, "model": "claude-model-x", "role": "assistant", "usage": usage } })
    }

    #[test]
    fn claude_replies_count_once_per_message_and_split_cache_writes() {
        let u1 = json!({ "input_tokens": 10, "output_tokens": 5, "cache_read_input_tokens": 100, "cache_creation_input_tokens": 40,
                         "cache_creation": { "ephemeral_5m_input_tokens": 10, "ephemeral_1h_input_tokens": 30 }, "output_tokens_details": { "thinking_tokens": 2 } });
        let u1_more = json!({ "input_tokens": 10, "output_tokens": 7, "cache_read_input_tokens": 100, "cache_creation_input_tokens": 40,
                              "cache_creation": { "ephemeral_5m_input_tokens": 10, "ephemeral_1h_input_tokens": 30 } });
        let u2 = json!({ "input_tokens": 1, "output_tokens": 1, "cache_creation_input_tokens": 5, "cache_creation": { "ephemeral_1h_input_tokens": 9 } });
        let lines = [
            reply("m1", "2026-03-01T10:00:00Z", u1),
            json!({ "type": "user", "timestamp": "2026-03-01T10:00:01Z", "message": { "role": "user" } }),
            reply("m1", "2026-03-01T10:00:02Z", u1_more), // a later streamed piece of the same reply
            reply("m2", "2026-03-01T11:00:00Z", u2),
            json!("not an object"),
        ];
        let mut text = file("s-1.jsonl", &lines);
        text.1.push_str("\n{broken json\n");
        // A forked copy repeats m1 in another file: still counted once.
        let fork = file("s-2.jsonl", &[reply("m1", "2026-03-01T10:00:02Z", json!({ "input_tokens": 10, "output_tokens": 7, "cache_read_input_tokens": 100, "cache_creation_input_tokens": 40 }))]);
        let rows = claude_rows(&[text, fork], &TimeZone::UTC);
        let sum = |f: fn(&Row) -> u64| rows.iter().map(f).sum::<u64>();
        assert_eq!(sum(|r| r.input), 11);
        assert_eq!(sum(|r| r.output), 8);
        assert_eq!(sum(|r| r.cache_read), 100);
        assert_eq!(sum(|r| r.cache_write), 45);
        // m1's fork copy names no lifetimes; m2's 1-hour count above its total is cut back to the total.
        assert_eq!(sum(|r| r.cache_write_1h), 5);
        assert!(rows.iter().all(|r| r.day == "2026-03-01" && r.model == "claude-model-x"));
    }

    #[test]
    fn days_follow_the_local_calendar() {
        let u = json!({ "input_tokens": 1, "output_tokens": 1 });
        let lines = [reply("a", "2026-03-01T23:30:00Z", u.clone()), reply("b", "2026-03-02T00:30:00Z", u)];
        let utc = claude_rows(&[file("s.jsonl", &lines)], &TimeZone::UTC);
        let mut days: Vec<_> = utc.iter().map(|r| r.day.clone()).collect();
        days.sort();
        assert_eq!(days, ["2026-03-01", "2026-03-02"]);
        let east = TimeZone::fixed(jiff::tz::offset(2));
        let local = claude_rows(&[file("s.jsonl", &lines)], &east);
        assert_eq!(local.len(), 1);
        assert_eq!(local[0].day, "2026-03-02");
    }

    #[test]
    fn prompt_size_bands_feed_long_context_prices() {
        let big = json!({ "input_tokens": 50_000, "output_tokens": 1, "cache_read_input_tokens": 160_000 });
        let mid = json!({ "input_tokens": 150_000, "output_tokens": 1 });
        let rows = claude_rows(&[file("s.jsonl", &[reply("a", "2026-03-01T01:00:00Z", big), reply("b", "2026-03-01T02:00:00Z", mid)])], &TimeZone::UTC);
        let mut bands: Vec<_> = rows.iter().map(|r| r.band).collect();
        bands.sort();
        assert_eq!(bands, [1, 2]);
    }

    fn event(at: &str, total: Value, last: Value) -> Value {
        json!({ "timestamp": at, "type": "event", "payload": { "info": { "total_token_usage": total, "last_token_usage": last } } })
    }
    fn counts(input: u64, cached: u64, output: u64, reasoning: u64) -> Value {
        json!({ "input_tokens": input, "cached_input_tokens": cached, "output_tokens": output, "reasoning_output_tokens": reasoning, "total_tokens": input + output })
    }

    #[test]
    fn codex_counts_each_token_event_once_and_never_takes_a_running_total_as_history() {
        let lines = [
            json!({ "timestamp": "2026-03-01T09:00:00Z", "type": "meta", "payload": { "session_id": "cx-1", "cwd": "C:/work/app", "model": "codex-model-y" } }),
            // a resumed session: the first running total holds earlier history, only its last turn counts
            event("2026-03-01T09:01:00Z", counts(1000, 800, 100, 10), counts(30, 20, 5, 1)),
            event("2026-03-01T09:01:01Z", counts(1000, 800, 100, 10), counts(30, 20, 5, 1)), // repeated event
            event("2026-03-01T09:02:00Z", counts(1100, 850, 120, 12), counts(100, 50, 20, 2)),
            json!({ "timestamp": "2026-03-01T09:03:00Z", "type": "event", "payload": { "info": null } }),
        ];
        let rows = codex_rows(&[file("rollout.jsonl", &lines)], &TimeZone::UTC);
        assert_eq!(rows.len(), 1);
        let r = &rows[0];
        assert_eq!((r.session.as_str(), r.model.as_str(), r.cwd.as_str()), ("cx-1", "codex-model-y", "C:/work/app"));
        // cached input is part of input: fresh 10 + 50, cache 20 + 50
        assert_eq!((r.input, r.cache_read, r.output, r.reasoning), (60, 70, 25, 3));
    }

    #[test]
    fn a_second_scan_request_joins_the_running_one() {
        let flights = Flights::default();
        let calls = std::sync::atomic::AtomicU32::new(0);
        std::thread::scope(|s| {
            let a = s.spawn(|| {
                flights.run("claude", || {
                    calls.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
                    std::thread::sleep(std::time::Duration::from_millis(300));
                })
            });
            std::thread::sleep(std::time::Duration::from_millis(50));
            let b = flights.run("claude", || {
                calls.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
            });
            assert!(a.join().unwrap());
            assert!(!b);
        });
        assert_eq!(calls.load(std::sync::atomic::Ordering::SeqCst), 1);
        assert!(flights.run("claude", || {}), "a later request starts a new scan");
    }

    #[test]
    fn an_older_profile_with_saved_results_keeps_tracking() {
        assert!(!tracking_of(None, false));
        assert!(tracking_of(None, true));
        assert!(!tracking_of(Some(false), true));
        assert!(tracking_of(Some(true), false));
    }
}
