//! spec/03 terminals: TERM-040 start folders and TERM-041 one new-tab command per agent.
//! Needs `pty` and `agents` public in lib.rs. The shell is a real one; it runs with the scratch
//! home the lane's environment gives the test process.

use kolux_rs_lib::agents::CATALOGUE;
use kolux_rs_lib::pty::{shell_commands, start_dir, PtySession};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

/// Starts the default shell in `dir`, waits until its output holds `leaf` (the prompt names the folder), and kills it.
fn shell_prompt_names(dir: &str, leaf: &str) -> Result<String, String> {
    let out = Arc::new(Mutex::new(Vec::<u8>::new()));
    let sink = out.clone();
    let mut session = PtySession::spawn_first(shell_commands(Some(dir), None), 120, 30, move |c| sink.lock().unwrap().extend_from_slice(c), |_| {})?;
    let end = Instant::now() + Duration::from_secs(40);
    let mut seen = String::new();
    let mut answered = 0;
    while Instant::now() < end {
        std::thread::sleep(Duration::from_millis(200));
        seen = String::from_utf8_lossy(&out.lock().unwrap()).into_owned();
        // the console host asks where the cursor is and waits for the answer, as the window's terminal gives it
        let asked = seen.matches("\x1b[6n").count();
        while answered < asked {
            session.write(b"\x1b[1;1R").unwrap();
            answered += 1;
        }
        if seen.contains(leaf) {
            break;
        }
    }
    session.kill();
    if seen.contains(leaf) { Ok(seen) } else { Err(format!("no prompt naming {leaf}: {seen:?}")) }
}

fn workspace(tag: &str) -> std::path::PathBuf {
    let d = std::env::temp_dir().join(format!("kolux-rs-cards03-{tag}-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&d);
    std::fs::create_dir_all(&d).unwrap();
    d
}

/// TERM-040 box 2: a requested start folder that does not exist opens the terminal in the workspace folder.
#[test]
fn term040_box2_a_missing_start_folder_opens_the_shell_in_the_workspace_folder() {
    let ws = workspace("term040-ws");
    let leaf = ws.file_name().unwrap().to_string_lossy().into_owned();
    let ws_s = ws.to_string_lossy().into_owned();
    // the decision
    assert_eq!(start_dir(&ws_s, Some("no-such-folder-cards03")), ws_s);
    assert_eq!(start_dir(&ws_s, Some("  ")), ws_s);
    assert_eq!(start_dir(&ws_s, None), ws_s);
    // an existing relative folder is kept, so the fallback is not just "always the workspace"
    let sub = ws.join("sub-cards03");
    std::fs::create_dir_all(&sub).unwrap();
    assert_eq!(start_dir(&ws_s, Some("sub-cards03")), sub.to_string_lossy());
    // the effect: the shell started where start_dir says shows the workspace folder as its working folder
    let start = start_dir(&ws_s, Some("no-such-folder-cards03"));
    shell_prompt_names(&start, &leaf).expect("the shell opened in the workspace folder");
    // and the control: a shell started in the existing sub folder shows that folder, not the workspace leaf alone
    let inner = start_dir(&ws_s, Some("sub-cards03"));
    shell_prompt_names(&inner, "sub-cards03").expect("an existing start folder is kept");
    let _ = std::fs::remove_dir_all(&ws);
}

/// TERM-040: a folder outside the workspace (absolute) is kept when it exists.
#[test]
fn term040_an_existing_absolute_folder_outside_the_workspace_is_kept() {
    let ws = workspace("term040-in");
    let other = workspace("term040-out");
    let other_s = other.to_string_lossy().into_owned();
    assert_eq!(start_dir(&ws.to_string_lossy(), Some(&other_s)), other_s);
    let _ = std::fs::remove_dir_all(&ws);
    let _ = std::fs::remove_dir_all(&other);
}

/// TERM-041 box 2: every agent the app can list has its own `tab.newAgent.<id>` command, and none has a key.
#[test]
fn term041_box2_every_catalogue_agent_has_an_unbound_new_tab_command() {
    let actions = std::fs::read_to_string(std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../src/keys/actions.ts")).unwrap();
    let line = actions.lines().find(|l| l.contains("tab.newAgent.${id}")).expect("the per-agent command line");
    assert!(line.contains(r#""tabs", [])"#), "the per-agent command takes no key: {line}");
    for (id, _, _, _) in CATALOGUE.iter() {
        assert!(actions.contains(&format!("[\"{id}\", \"")), "no new-tab command for agent {id}");
    }
}
