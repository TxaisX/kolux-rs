//! spec/19 app lifecycle, Rust halves of the cards batch. APP-054 box 2: ending one of three real shell sessions
//! leaves the other two running. The window-side proofs are src/update/__cards__, src/status/__cards__/APP-054.test.ts
//! and src/settings/__cards__/APP-041-070.test.ts.

mod scratch_root;

use kolux_rs_lib::procs::{alive, wait_gone};
use kolux_rs_lib::pty::{shell_commands, PtySession};
use std::path::PathBuf;
use std::time::Duration;

fn scratch(tag: &str) -> PathBuf {
    let d = scratch_root::root().join("app19").join(format!("{tag}-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&d);
    std::fs::create_dir_all(&d).unwrap();
    std::fs::write(d.join(".kolux-rs-scratch"), "").unwrap();
    d
}

fn shell(dir: &std::path::Path) -> PtySession {
    PtySession::spawn_first(shell_commands(Some(&dir.to_string_lossy()), None), 120, 30, |_| {}, |_| {}).expect("a shell starts")
}

/// APP-054 box 2: Terminals::kill(id) removes that one session and calls its kill(); this is the session-level
/// behaviour it rests on, with three real shells: the one ended is gone, the other two are still running.
#[test]
fn app054_box2_ending_one_of_three_sessions_stops_only_that_one() {
    let dir = scratch("app054");
    let mut three: Vec<PtySession> = (0..3).map(|_| shell(&dir)).collect();
    let pids: Vec<u32> = three.iter().map(|s| s.pid().expect("the platform reports a pid")).collect();
    assert_eq!(pids.iter().collect::<std::collections::HashSet<_>>().len(), 3, "three different processes: {pids:?}");
    for p in &pids {
        assert_eq!(alive(*p), Some(true), "{p} runs before the end");
    }
    three[1].kill();
    let stuck = wait_gone(&[pids[1]], Duration::from_secs(10));
    assert!(stuck.is_empty(), "the ended session's process is gone: {stuck:?}");
    assert_eq!(alive(pids[1]), Some(false));
    std::thread::sleep(Duration::from_millis(500));
    assert_eq!(alive(pids[0]), Some(true), "the first keeps running");
    assert_eq!(alive(pids[2]), Some(true), "the third keeps running");
    for s in three.iter_mut() {
        s.kill();
    }
    let left = wait_gone(&pids, Duration::from_secs(10));
    assert!(left.is_empty(), "cleanup: {left:?}");
    let _ = std::fs::remove_dir_all(&dir);
}
