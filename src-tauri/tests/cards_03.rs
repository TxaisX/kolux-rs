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

/// A real shell on a pty, with the console host's cursor query answered; `settle` waits until its output stops growing.
struct Shell {
    out: Arc<Mutex<Vec<u8>>>,
    session: PtySession,
    answered: usize,
}

impl Shell {
    fn start(dir: &str) -> Shell {
        let out = Arc::new(Mutex::new(Vec::<u8>::new()));
        let sink = out.clone();
        let session = PtySession::spawn_first(shell_commands(Some(dir), None), 120, 30, move |c| sink.lock().unwrap().extend_from_slice(c), |_| {}).expect("a shell starts");
        Shell { out, session, answered: 0 }
    }

    fn answer_cursor_queries(&mut self) {
        let seen = String::from_utf8_lossy(&self.out.lock().unwrap()).into_owned();
        let asked = seen.matches("\x1b[6n").count();
        while self.answered < asked {
            self.session.write(b"\x1b[1;1R").unwrap();
            self.answered += 1;
        }
    }

    /// Polls `check` (answering cursor queries) until it holds or `secs` pass; returns the last value seen.
    fn until(&mut self, secs: u64, mut check: impl FnMut(&Shell) -> bool) -> bool {
        let end = Instant::now() + Duration::from_secs(secs);
        while Instant::now() < end {
            std::thread::sleep(Duration::from_millis(200));
            self.answer_cursor_queries();
            if check(self) {
                return true;
            }
        }
        false
    }

    fn text(&self) -> String {
        String::from_utf8_lossy(&self.out.lock().unwrap()).into_owned()
    }
}

/// TERM-045 box 1: closing a pane whose shell runs a long program (a dev-server stand-in) would stop it, an idle shell would not.
/// `Terminals::busy` reads exactly `procs::has_children(pty pid)` for a plain shell (terminal.rs `busy`), which is what is asked here.
#[test]
fn term045_box1_a_shell_running_a_program_is_busy_and_an_idle_shell_is_not() {
    let ws = workspace("term045");
    let leaf = ws.file_name().unwrap().to_string_lossy().into_owned();
    let mut sh = Shell::start(&ws.to_string_lossy());
    assert!(sh.until(40, |s| s.text().contains(&leaf)), "the prompt names the folder: {:?}", sh.text());
    let pid = sh.session.pid().expect("the shell has a process id");
    // idle: the prompt is up and nothing runs under it (given a moment for start-up work to settle)
    let idle = sh.until(15, |_| kolux_rs_lib::procs::has_children(pid) == Some(false));
    assert!(idle, "an idle shell has no program of its own: {:?}", kolux_rs_lib::procs::has_children(pid));
    // busy: a long-running program (stands in for a dev server) is started in the shell
    let cmd: &[u8] = if cfg!(windows) { b"ping -n 60 127.0.0.1\r" } else { b"sleep 60\n" };
    sh.session.write(cmd).unwrap();
    let busy = sh.until(30, |_| kolux_rs_lib::procs::has_children(pid) == Some(true));
    assert!(busy, "a shell running a program is busy: {:?}", kolux_rs_lib::procs::has_children(pid));
    kolux_rs_lib::procs::kill_tree(pid);
    sh.session.kill();
    let _ = std::fs::remove_dir_all(&ws);
}

/// Runs git with identity and a quiet config so a scratch repo can commit.
fn git(dir: &std::path::Path, args: &[&str]) {
    let st = std::process::Command::new("git").current_dir(dir).args(["-c", "user.name=cards", "-c", "user.email=cards@example.invalid", "-c", "commit.gpgsign=false"]).args(args).output().expect("git runs");
    assert!(st.status.success(), "git {args:?}: {}", String::from_utf8_lossy(&st.stderr));
}

/// TERM-022 boxes 1-2: what the pane header's chip reads, in the shape the window receives.
#[test]
fn term022_the_head_the_chip_reads_is_the_branch_a_detached_commit_or_nothing() {
    use kolux_rs_lib::scm::head_of;
    let repo = workspace("term022-repo");
    git(&repo, &["init", "-q", "-b", "main"]);
    git(&repo, &["commit", "-q", "--allow-empty", "-m", "first"]);
    git(&repo, &["switch", "-q", "-c", "feature/x"]);
    let on_branch = head_of(&repo).expect("a repository has a head");
    assert_eq!(on_branch.branch.as_deref(), Some("feature/x"));
    let sha = on_branch.head.clone().expect("a commit");
    assert_eq!(sha.len(), 40);
    let json = serde_json::to_value(&on_branch).unwrap();
    assert_eq!(json, serde_json::json!({ "branch": "feature/x", "head": sha }));
    // detached: no branch, the commit it sits on
    git(&repo, &["switch", "-q", "--detach"]);
    let detached = head_of(&repo).unwrap();
    assert_eq!(detached.branch, None);
    assert_eq!(detached.head.as_deref(), Some(sha.as_str()));
    assert_eq!(serde_json::to_value(&detached).unwrap(), serde_json::json!({ "branch": null, "head": sha }));
    // a plain folder outside git has no head at all
    let plain = workspace("term022-plain");
    assert_eq!(head_of(&plain), None);
    let _ = std::fs::remove_dir_all(&repo);
    let _ = std::fs::remove_dir_all(&plain);
}
