//! SESS-001: which agents count as installed. Needs `agents` public in lib.rs.
//! The scenarios change the process environment, so they run one at a time. The shell search path
//! Kolux reads from the registry (Windows) is the real one; every scenario therefore compares
//! against a baseline taken under the same environment before it adds anything.

use kolux_rs_lib::agents::{catalogue, AgentInfo};
use std::path::{Path, PathBuf};
use std::sync::Mutex;

static ENV: Mutex<()> = Mutex::new(());

const VARS: [&str; 7] = ["PATH", "USERPROFILE", "HOME", "APPDATA", "LOCALAPPDATA", "NVM_SYMLINK", "NVM_HOME"];

fn scratch(tag: &str) -> PathBuf {
    let d = std::env::temp_dir().join(format!("kolux-rs-cards02-{tag}-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&d);
    std::fs::create_dir_all(&d).unwrap();
    d
}

/// Runs `body` with PATH and the home folders pointed into scratch folders, then puts them back.
fn with_env(path_dir: &Path, home: &Path, body: impl FnOnce()) {
    let _lock = ENV.lock().unwrap_or_else(|e| e.into_inner());
    let saved: Vec<_> = VARS.iter().map(|v| (*v, std::env::var_os(v))).collect();
    std::env::set_var("PATH", path_dir);
    for v in ["USERPROFILE", "HOME"] {
        std::env::set_var(v, home);
    }
    std::env::set_var("APPDATA", home.join("AppData").join("Roaming"));
    std::env::set_var("LOCALAPPDATA", home.join("AppData").join("Local"));
    std::env::remove_var("NVM_SYMLINK");
    std::env::remove_var("NVM_HOME");
    let outcome = std::panic::catch_unwind(std::panic::AssertUnwindSafe(body));
    for (v, old) in saved {
        match old {
            Some(o) => std::env::set_var(v, o),
            None => std::env::remove_var(v),
        }
    }
    if let Err(p) = outcome {
        std::panic::resume_unwind(p);
    }
}

fn homes(tag: &str) -> (PathBuf, PathBuf) {
    let home = scratch(&format!("{tag}-home"));
    std::fs::create_dir_all(home.join("AppData").join("Roaming")).unwrap();
    std::fs::create_dir_all(home.join("AppData").join("Local")).unwrap();
    (scratch(&format!("{tag}-empty")), home)
}

/// A runnable file for `program` in `dir`: `.exe` on Windows, an executable file elsewhere.
fn put_program(dir: &Path, program: &str) -> PathBuf {
    std::fs::create_dir_all(dir).unwrap();
    let file = dir.join(if cfg!(windows) { format!("{program}.exe") } else { program.to_string() });
    std::fs::write(&file, b"stand-in").unwrap();
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&file, std::fs::Permissions::from_mode(0o755)).unwrap();
    }
    file
}

/// `n` agents that are missing in `base`, the preferred ids first; programs without a dot, all different.
fn missing(base: &[AgentInfo], prefer: &[&str], n: usize) -> Vec<AgentInfo> {
    let mut pool: Vec<&AgentInfo> = base.iter().filter(|a| !a.installed && !a.program.contains('.')).collect();
    pool.sort_by_key(|a| prefer.iter().position(|p| *p == a.id).unwrap_or(usize::MAX));
    let mut out: Vec<AgentInfo> = Vec::new();
    for a in pool {
        if out.len() < n && out.iter().all(|o| o.program != a.program) {
            out.push(a.clone());
        }
    }
    assert_eq!(out.len(), n, "not enough agents missing on this machine");
    out
}

fn installed_ids(list: &[AgentInfo]) -> Vec<String> {
    list.iter().filter(|a| a.installed).map(|a| a.id.clone()).collect()
}

#[test]
fn sess001_box1_putting_two_agents_on_the_path_makes_exactly_those_two_installed() {
    let (empty, home) = homes("b1");
    let bin = scratch("b1-bin");
    with_env(&empty, &home, || {
        let base = catalogue();
        assert_eq!(base.len(), 34, "the catalogue lists 34 agents");
        let two = missing(&base, &["claude", "codex"], 2);
        for a in &two {
            put_program(&bin, &a.program);
        }
        std::env::set_var("PATH", &bin);
        let after = catalogue();
        let mut added: Vec<String> = installed_ids(&after).into_iter().filter(|id| !installed_ids(&base).contains(id)).collect();
        added.sort();
        let mut wanted: Vec<String> = two.iter().map(|a| a.id.clone()).collect();
        wanted.sort();
        assert_eq!(added, wanted, "exactly the two agents that were put there became installed");
        for a in &two {
            let got = after.iter().find(|x| x.id == a.id).unwrap();
            assert!(got.installed && got.path.as_deref().is_some_and(|p| Path::new(p).starts_with(&bin)), "{got:?}");
        }
        assert_eq!(after.iter().filter(|x| x.installed).count(), installed_ids(&base).len() + 2);
    });
    for d in [empty, home, bin] {
        let _ = std::fs::remove_dir_all(d);
    }
}

#[test]
fn sess001_box2_an_agent_only_in_the_default_install_folder_is_found_with_a_path_that_lacks_it() {
    let (empty, home) = homes("b2");
    with_env(&empty, &home, || {
        let base = catalogue();
        let one = missing(&base, &["claude"], 1).remove(0);
        let usual = home.join(".local").join("bin");
        put_program(&usual, &one.program);
        let after = catalogue();
        let got = after.iter().find(|x| x.id == one.id).unwrap();
        assert!(got.installed, "{got:?}");
        assert!(got.path.as_deref().is_some_and(|p| Path::new(p).starts_with(&usual)), "found in the default folder: {got:?}");
        assert_eq!(installed_ids(&after).len(), installed_ids(&base).len() + 1, "only that one agent appeared");
    });
    for d in [empty, home] {
        let _ = std::fs::remove_dir_all(d);
    }
}

#[test]
fn sess001_box3_a_file_that_cannot_run_or_a_folder_named_after_an_agent_is_not_offered() {
    let (empty, home) = homes("b3");
    let bin = scratch("b3-bin");
    with_env(&empty, &home, || {
        let base = catalogue();
        let three = missing(&base, &["claude", "codex", "gemini"], 3);
        // A: an ordinary file named after the agent, no run ending (Windows) / no execute bit (elsewhere).
        std::fs::write(bin.join(&three[0].program), b"not a program").unwrap();
        // B: a folder bearing the name (with the ending a program would have on Windows).
        std::fs::create_dir(bin.join(if cfg!(windows) { format!("{}.exe", three[1].program) } else { three[1].program.clone() })).unwrap();
        // C: control, a real program in the same folder.
        put_program(&bin, &three[2].program);
        std::env::set_var("PATH", &bin);
        let after = catalogue();
        let state = |id: &str| after.iter().find(|x| x.id == id).unwrap().installed;
        assert!(!state(&three[0].id), "{}: a plain file is not a program", three[0].id);
        assert!(!state(&three[1].id), "{}: a folder is not a program", three[1].id);
        assert!(state(&three[2].id), "{}: the same folder is searched, so a real program shows", three[2].id);
    });
    for d in [empty, home, bin] {
        let _ = std::fs::remove_dir_all(d);
    }
}
