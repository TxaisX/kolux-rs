//! ORCH-017 (T-172-d, coordinator default): worker-start never runs a setup script itself. It asks
//! the window (the "created" notice carries a setup request id) to run the trust gate and the
//! worktree's setup once, in the window's Setup tab, and waits here for the window's answer before
//! the agent starts. A setup that failed or did not finish in time makes the start fail at the
//! "setup" stage with its exit code; a declined trust question or a project without a setup script
//! lets the worker start, and the receipt says which.

use serde_json::{json, Value};
use std::collections::BTreeMap;
use std::sync::{Condvar, LazyLock, Mutex};
use std::time::{Duration, Instant};

/// How long a worker start waits for the window to report its setup. It stays under the CLI's
/// 300 s wait for an answer with the agent's own start wait (60 s by default) on top.
// ponytail: one fixed limit; a per-project limit if long setup scripts need more.
pub const LIMIT: Duration = Duration::from_secs(200);

#[derive(Default)]
struct Gates {
    open: BTreeMap<String, Option<Value>>,
}

static GATES: LazyLock<(Mutex<Gates>, Condvar)> = LazyLock::new(|| (Mutex::new(Gates::default()), Condvar::new()));

/// A worker start is about to ask the window for its setup under `request`.
pub fn open(request: &str) {
    let (m, _) = &*GATES;
    m.lock().unwrap_or_else(|e| e.into_inner()).open.insert(request.to_string(), None);
}

/// The window's answer for `request`. False when no start waits for it (an old or made-up id), so
/// nothing is recorded.
pub fn settle(request: &str, answer: Value) -> bool {
    let (m, cv) = &*GATES;
    let mut g = m.lock().unwrap_or_else(|e| e.into_inner());
    match g.open.get_mut(request) {
        Some(slot @ None) => {
            *slot = Some(answer);
            cv.notify_all();
            true
        }
        _ => false,
    }
}

/// Waits up to `limit` for the window's answer; the request is closed either way.
pub fn wait(request: &str, limit: Duration) -> Option<Value> {
    let (m, cv) = &*GATES;
    let end = Instant::now() + limit;
    let mut g = m.lock().unwrap_or_else(|e| e.into_inner());
    loop {
        if let Some(Some(v)) = g.open.get(request) {
            let v = v.clone();
            g.open.remove(request);
            return Some(v);
        }
        let now = Instant::now();
        if now >= end || !g.open.contains_key(request) {
            g.open.remove(request);
            return None;
        }
        g = cv.wait_timeout(g, end - now).unwrap_or_else(|e| e.into_inner()).0;
    }
}

/// What the window's answer (or its absence) means for the start: whether it failed at the setup
/// stage, and the receipt's `setup` value.
/// Window answers: `{ "result": "ran", "exitCode": n | null }`, `{ "result": "none" }` (no setup
/// script), `{ "result": "declined" }` (the trust question was answered Don't run), `{ "result":
/// "error", "message": m }` (the setup could not be started).
pub fn outcome(answer: Option<&Value>) -> (bool, Value) {
    let Some(a) = answer else {
        return (true, json!({ "result": "timed_out", "note": "the window did not report the setup script's end within the start's time limit; it may still be running in the workspace's Setup tab" }));
    };
    match a["result"].as_str() {
        Some("ran") => match a["exitCode"].as_i64() {
            Some(0) => (false, json!({ "result": "succeeded", "exitCode": 0 })),
            Some(n) => (true, json!({ "result": "failed", "exitCode": n })),
            None => (true, json!({ "result": "failed", "exitCode": Value::Null, "note": "Kolux could not learn how the setup script ended" })),
        },
        Some("none") => (false, json!("not_configured")),
        Some("declined") => (false, json!({ "result": "declined", "note": "the project's setup script was not trusted, so it did not run; the worker started without it" })),
        Some("error") => (true, json!({ "result": "failed", "exitCode": Value::Null, "note": a["message"].as_str().unwrap_or("the setup script could not be started") })),
        _ => (true, json!({ "result": "failed", "exitCode": Value::Null, "note": "the window gave an answer Kolux does not know" })),
    }
}

/// The window reports how the setup it ran for a worker start ended (T-172-d).
#[tauri::command]
pub fn worker_setup_settled(request: String, result: String, exit_code: Option<i64>, message: Option<String>) -> bool {
    settle(&request, json!({ "result": result, "exitCode": exit_code, "message": message }))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_start_waits_for_the_windows_answer_and_closes_the_request() {
        open("dispatch-t1");
        let t = std::thread::spawn(|| wait("dispatch-t1", Duration::from_secs(5)));
        std::thread::sleep(Duration::from_millis(50));
        assert!(settle("dispatch-t1", json!({ "result": "ran", "exitCode": 0 })));
        assert_eq!(t.join().unwrap(), Some(json!({ "result": "ran", "exitCode": 0 })));
        assert!(!settle("dispatch-t1", json!({ "result": "ran", "exitCode": 0 })), "a second answer finds no waiting start");
    }

    #[test]
    fn an_answer_for_no_waiting_start_is_ignored_and_a_silent_window_times_out() {
        assert!(!settle("dispatch-never", json!({ "result": "none" })));
        open("dispatch-t2");
        assert_eq!(wait("dispatch-t2", Duration::from_millis(30)), None);
        assert!(!settle("dispatch-t2", json!({ "result": "none" })), "a late answer after the timeout is not kept");
    }

    #[test]
    fn a_failed_setup_names_setup_as_the_failed_stage_with_its_exit_code() {
        assert_eq!(outcome(Some(&json!({ "result": "ran", "exitCode": 0 }))), (false, json!({ "result": "succeeded", "exitCode": 0 })));
        let (failed, v) = outcome(Some(&json!({ "result": "ran", "exitCode": 3 })));
        assert!(failed);
        assert_eq!(v, json!({ "result": "failed", "exitCode": 3 }));
        assert!(outcome(Some(&json!({ "result": "ran", "exitCode": null }))).0, "an end Kolux could not confirm is no success");
        assert!(outcome(Some(&json!({ "result": "error", "message": "no shell" }))).0);
        assert!(outcome(None).0, "a setup still running at the time limit fails the start at the setup stage");
    }

    #[test]
    fn no_script_or_a_declined_trust_question_lets_the_worker_start() {
        assert_eq!(outcome(Some(&json!({ "result": "none" }))), (false, json!("not_configured")));
        let (failed, v) = outcome(Some(&json!({ "result": "declined" })));
        assert!(!failed);
        assert_eq!(v["result"], "declined");
    }

    #[test]
    fn the_receipt_built_from_a_failed_setup_is_a_failed_start_at_the_setup_stage() {
        let mut receipt = json!({ "dispatchId": "dispatch-9", "taskId": "task-1", "status": "unknown", "stage": "worker", "worktree": { "path": "C:/w/x", "created": true }, "terminals": [] });
        let (failed, setup) = outcome(Some(&json!({ "result": "ran", "exitCode": 2 })));
        assert!(failed);
        crate::orchestration::start_failed(&mut receipt, "setup", setup);
        assert_eq!((receipt["status"].as_str(), receipt["stage"].as_str()), (Some("failed"), Some("setup")));
        assert_eq!(receipt["setup"]["exitCode"], 2);
    }
}
