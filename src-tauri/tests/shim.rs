//! CLI-006: the kolux.cmd shim, run for real by cmd. A copy of cmd.exe stands in for kolux.exe,
//! so `/c exit N` shows the exit status coming back through the shim.
#![cfg(windows)]

use std::path::{Path, PathBuf};
use std::process::Command;

fn folder(name: &str, with_exe: bool) -> PathBuf {
    let dir = std::env::temp_dir().join(format!("kolux-shim-{name}-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).unwrap();
    std::fs::copy(Path::new(env!("CARGO_MANIFEST_DIR")).join("cli").join("kolux.cmd"), dir.join("kolux.cmd")).unwrap();
    if with_exe {
        let cmd = PathBuf::from(std::env::var_os("SystemRoot").unwrap()).join("System32").join("cmd.exe");
        std::fs::copy(cmd, dir.join("kolux.exe")).unwrap();
    }
    dir
}

fn shim(dir: &Path, args: &[&str]) -> (Option<i32>, String) {
    let out = Command::new(dir.join("kolux.cmd")).args(args).output().unwrap();
    (out.status.code(), String::from_utf8_lossy(&out.stderr).into_owned())
}

#[test]
fn the_shim_passes_the_call_on_and_returns_its_exit_status() {
    let dir = folder("pass", true);
    assert_eq!(shim(&dir, &["/c", "exit 7"]).0, Some(7));
    assert_eq!(shim(&dir, &["/c", "exit 0"]).0, Some(0));
    let _ = std::fs::remove_dir_all(dir);
}

#[test]
fn the_shim_declines_send_and_reply_with_status_2() {
    let dir = folder("refuse", true);
    for verb in ["send", "reply", "Reply"] {
        let (code, err) = shim(&dir, &["orchestration", verb, "--id", "m1", "--body", "hi"]);
        assert_eq!(code, Some(2), "{verb}");
        assert!(err.contains("kolux.exe orchestration"), "{err}");
    }
    let _ = std::fs::remove_dir_all(dir);
}

#[test]
fn a_shim_without_its_launcher_fails_with_status_1() {
    let dir = folder("missing", false);
    let (code, err) = shim(&dir, &["status"]);
    assert_eq!(code, Some(1));
    assert!(err.contains("kolux.exe is missing"), "{err}");
    let _ = std::fs::remove_dir_all(dir);
}
