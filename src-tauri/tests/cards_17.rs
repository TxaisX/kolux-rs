//! spec/17 P0 boxes SET-032 and SET-030 (Rust halves): the real projects/Store/Git code on real folders under
//! G:\Temp\cards-v3\set17\, and the real claude_accounts reader run against a fake `claude` program in scratch.
//! The TS halves are src/projects/__cards__/SET-032.test.ts and src/settings/__cards__/SET-030.test.ts.

use kolux_rs_lib::claude_accounts::{auth_status, own_sign_in};
use kolux_rs_lib::git::Git;
use kolux_rs_lib::projects::{add_project, create_workspace, place_from, resolve_workspaces_dir, workspace_path, workspaces_dir, Project};
use kolux_rs_lib::state::Store;
use serde_json::{json, Value};
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::Mutex;

const ROOT: &str = r"G:\Temp\cards-v3";
/// KOLUX_WORKSPACES_DIR is process-wide: every test that makes a worktree holds this.
static ENV: Mutex<()> = Mutex::new(());

fn norm(p: &Path) -> String {
    p.to_string_lossy().replace('\\', "/").trim_end_matches('/').to_lowercase()
}

/// A fresh folder under the scratch root; refuses to run when the agent homes are not redirected there.
fn scratch(tag: &str) -> PathBuf {
    for var in ["CLAUDE_CONFIG_DIR", "CODEX_HOME", "USERPROFILE", "HOME"] {
        let v = std::env::var(var).unwrap_or_default();
        assert!(norm(Path::new(&v)).starts_with(&norm(Path::new(ROOT))), "{var} must point under {ROOT}, not {v}");
    }
    let d = Path::new(ROOT).join("set17").join(format!("{tag}-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&d);
    std::fs::create_dir_all(&d).unwrap();
    std::fs::write(d.join(".kolux-rs-scratch"), "").unwrap();
    d
}

fn repo_in(parent: &Path, name: &str) -> PathBuf {
    let dir = parent.join(name);
    std::fs::create_dir_all(&dir).unwrap();
    for args in [vec!["init", "-q"], vec!["-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "--allow-empty", "-m", "init"]] {
        assert!(Command::new("git").args(&args).current_dir(&dir).status().unwrap().success(), "git {args:?}");
    }
    dir
}

fn same(a: &str, b: &Path) -> bool {
    a.replace('\\', "/").trim_end_matches('/').eq_ignore_ascii_case(b.to_string_lossy().replace('\\', "/").trim_end_matches('/'))
}

fn make(git: &Git, project: &Project, settings: &Value, name: &str) -> String {
    let place = place_from(project, settings);
    create_workspace(git, &place, project, name, None).unwrap().worktree.path
}

#[test]
fn set032_box1_a_folder_browsed_to_gets_the_next_worktree_at_folder_repo_name() {
    let _env = ENV.lock().unwrap_or_else(|e| e.into_inner());
    std::env::remove_var("KOLUX_WORKSPACES_DIR");
    let git = Git::detect().unwrap();
    let d = scratch("s32b1");
    let profile = d.join("profile");
    let folder = d.join("wt");
    let store = Store::open(&profile).unwrap();
    let app = add_project(&git, &store, &repo_in(&d.join("repos"), "app")).unwrap();
    // MIRROR src/projects.rs set_place (2359-2375): the two settings the page's workspaces_place_set {dir, flat:false} writes.
    let mut saved = store.settings();
    saved["workspacesDir"] = json!(folder.to_string_lossy());
    saved["workspacesLayout"] = json!("nested");
    store.save_settings(&saved).unwrap();
    drop(store);
    // The next worktree: read back from disk, as after a restart.
    let settings = Store::open(&profile).unwrap().settings();
    assert!(same(&workspaces_dir(&Store::open(&profile).unwrap()).to_string_lossy(), &folder));
    let path = make(&git, &app, &settings, "next");
    assert!(same(&path, &folder.join("app").join("next")), "{path}");
    assert!(Path::new(&path).join(".git").exists(), "a real checkout is there");
    // A second one lands beside it, in the same repo sub-folder.
    let second = make(&git, &app, &settings, "after");
    assert!(same(&second, &folder.join("app").join("after")), "{second}");
    // The very folder of the box: D:/wt, typed with a forward slash, names a path without touching the drive.
    #[cfg(windows)]
    {
        let far = Project { id: "far".into(), name: "app".into(), path: "C:\\repos\\app".into(), workspaces_dir: None, base: None, display_name: None };
        let place = place_from(&far, &json!({ "workspacesDir": "D:/wt", "workspacesLayout": "nested" }));
        assert!(same(&workspace_path(&place, &far, "next").to_string_lossy(), Path::new("D:/wt/app/next")));
    }
    let _ = std::fs::remove_dir_all(&d);
}

#[test]
fn set032_box2_kolux_workspaces_dir_sets_the_folder_when_nothing_is_saved_and_a_saved_folder_still_wins() {
    let _env = ENV.lock().unwrap_or_else(|e| e.into_inner());
    let git = Git::detect().unwrap();
    let d = scratch("s32b2");
    let from_env = d.join("from-env");
    let saved_dir = d.join("saved");
    let store = Store::open(&d.join("profile")).unwrap();
    let app = add_project(&git, &store, &repo_in(&d.join("repos"), "app")).unwrap();
    // "Launch with the variable": it is read when the worktree is made, with no Settings page involved.
    std::env::set_var("KOLUX_WORKSPACES_DIR", &from_env);
    let nothing_saved = store.settings();
    assert!(nothing_saved["workspacesDir"].is_null());
    assert!(same(&workspaces_dir(&store).to_string_lossy(), &from_env));
    let path = make(&git, &app, &nothing_saved, "n1");
    assert!(same(&path, &from_env.join("app").join("n1")), "{path}");
    assert!(Path::new(&path).join(".git").exists());
    // A blank value is not a folder.
    assert_ne!(resolve_workspaces_dir(Some("   "), None), PathBuf::from("   "));
    // The variable only moves the default: a folder the user saved is used instead.
    let saved = json!({ "workspacesDir": saved_dir.to_string_lossy() });
    let other = make(&git, &app, &saved, "n2");
    assert!(same(&other, &saved_dir.join("app").join("n2")), "{other}");
    std::env::remove_var("KOLUX_WORKSPACES_DIR");
    let _ = std::fs::remove_dir_all(&d);
}

fn fake_claude(dir: &Path, status_json: &str) -> PathBuf {
    #[cfg(windows)]
    let (name, body) = ("claude.cmd", format!("@echo off\r\necho {status_json}\r\n"));
    #[cfg(not(windows))]
    let (name, body) = ("claude", format!("#!/bin/sh\necho '{status_json}'\n"));
    let p = dir.join(name);
    std::fs::write(&p, body).unwrap();
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&p, std::fs::Permissions::from_mode(0o755)).unwrap();
    }
    p
}

#[test]
fn set030_box1_a_claude_that_reports_signed_out_is_read_as_signed_out_by_the_real_status_reader() {
    let d = scratch("s30b1");
    let program = fake_claude(&d, r#"{"loggedIn":true,"email":"sam@example.com"}"#);
    let before = own_sign_in(auth_status(&program, None).as_deref());
    assert_eq!(serde_json::to_value(&before).unwrap(), json!({ "state": "signed-in", "email": "sam@example.com" }));
    // Signed out from its own CLI: the same program now answers the way a signed-out `claude auth status --json` does.
    fake_claude(&d, r#"{"loggedIn":false,"authMethod":"none"}"#);
    let after = own_sign_in(auth_status(&program, None).as_deref());
    assert_eq!(serde_json::to_value(&after).unwrap(), json!({ "state": "signed-out", "email": null }));
    save_replay("SET-030-replay.json", "signedIn", serde_json::to_value(&before).unwrap());
    save_replay("SET-030-replay.json", "signedOut", serde_json::to_value(&after).unwrap());
    let _ = std::fs::remove_dir_all(&d);
}

#[test]
fn set030_box2_the_auto_resume_switch_is_off_by_default_and_on_after_a_restart() {
    let d = scratch("s30b2");
    let profile = d.join("profile");
    let first = Store::open(&profile).unwrap();
    assert_ne!(first.settings()["claudeResumeAfterLimit"], json!(true), "off unless the user turns it on");
    // What the page sends when the switch is turned on (src/settings/__cards__/SET-030.test.ts asserts this exact patch).
    let set = serde_json::Map::from_iter([("claudeResumeAfterLimit".to_string(), json!(true))]);
    first.patch_settings(&set, &[]).unwrap();
    drop(first);
    // Restart: a new Store on the same folder.
    let restarted = Store::open(&profile).unwrap().settings();
    assert_eq!(restarted["claudeResumeAfterLimit"], json!(true));
    save_replay("SET-030-replay.json", "restarted", restarted);
    let _ = std::fs::remove_dir_all(&d);
}

static REPLAY: Mutex<()> = Mutex::new(());

/// Keeps a produced value in evidence/cards-<file> for the TS half to run against.
fn save_replay(file: &str, key: &str, value: Value) {
    let path = Path::new(env!("CARGO_MANIFEST_DIR")).join("..").join("evidence").join(format!("cards-{file}"));
    let _guard = REPLAY.lock().unwrap_or_else(|e| e.into_inner());
    let mut doc: Value = std::fs::read(&path).ok().and_then(|b| serde_json::from_slice(&b).ok()).unwrap_or(json!({}));
    doc[key] = value;
    std::fs::write(&path, serde_json::to_string_pretty(&doc).unwrap() + "\n").unwrap();
}
