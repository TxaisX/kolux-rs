//! APP-023: the landing screen's tool checks. Git, GitHub's `gh` (installed, signed in) and
//! GitLab's `glab` are probed on the search path with a time limit; the results are kept until a
//! manual refresh. Which projects GitHub or GitLab hosts is read fresh on every call, so adding one
//! brings a dismissed notice back. A dismissal is stored with the GitHub project set it was made under.
use crate::state::Store;
use serde::Serialize;
use std::io::Read;
use std::process::{Command, Stdio};
use std::sync::Mutex;
use std::time::{Duration, Instant};
use tauri::Manager;

/// A probe that runs past this is ended and its tool reported as unknown (no notice).
const PROBE_LIMIT: Duration = Duration::from_secs(6);
const KEY_DISMISSED: &str = "tool_notices_dismissed";

/// One tool's state: ok, missing (or, for gh's sign-in, signed out) or unknown (the probe hung).
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum Check {
    Ok,
    Missing,
    Unknown,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Probes {
    pub git: Check,
    pub gh: Check,
    pub gh_signed_in: Check,
    pub glab: Check,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Tools {
    #[serde(flatten)]
    pub probes: Probes,
    /// Ids of the registered projects with a GitHub (or GitLab) remote, sorted.
    pub github_projects: Vec<String>,
    pub gitlab_projects: Vec<String>,
    /// Notice id → the GitHub project set (ids joined by commas) it was dismissed under.
    pub dismissed: serde_json::Map<String, serde_json::Value>,
}

#[derive(Default)]
pub struct Cache(Mutex<Option<Probes>>);

/// How one probe went.
#[derive(Debug, PartialEq, Eq)]
pub enum Ran {
    /// It ended by itself: whether it exited 0, and its output.
    Exited(bool, String),
    /// Nothing by that name could be started from the search path.
    NotFound,
    /// It ran past its limit and was ended.
    Hung,
}

/// Runs `program args` found on the search path, ending it once it runs past `limit`.
/// ponytail: output is read after exit, fine for the few lines a version or status check prints.
pub fn probe(program: &str, args: &[&str], limit: Duration) -> Ran {
    let mut cmd = Command::new(program);
    cmd.args(args).stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::null());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
    }
    let Ok(mut child) = cmd.spawn() else { return Ran::NotFound };
    let start = Instant::now();
    loop {
        match child.try_wait() {
            Ok(Some(status)) => {
                let mut out = String::new();
                if let Some(mut s) = child.stdout.take() {
                    let _ = s.read_to_string(&mut out);
                }
                return Ran::Exited(status.success(), out);
            }
            Ok(None) if start.elapsed() < limit => std::thread::sleep(Duration::from_millis(50)),
            _ => {
                let _ = child.kill();
                let _ = child.wait();
                return Ran::Hung;
            }
        }
    }
}

/// A version check that fails or cannot start means missing; one that hung means unknown.
fn installed(program: &str, limit: Duration) -> Check {
    match probe(program, &["--version"], limit) {
        Ran::Exited(true, _) => Check::Ok,
        Ran::Exited(false, _) | Ran::NotFound => Check::Missing,
        Ran::Hung => Check::Unknown,
    }
}

/// Probes the three tools at once. `gh auth status` only reads the stored sign-in.
pub fn probe_all(limit: Duration) -> Probes {
    std::thread::scope(|s| {
        let git = s.spawn(|| installed("git", limit));
        let glab = s.spawn(|| installed("glab", limit));
        let gh = installed("gh", limit);
        let gh_signed_in = match (gh, probe("gh", &["auth", "status"], limit)) {
            (Check::Ok, Ran::Exited(true, _)) => Check::Ok,
            (Check::Ok, Ran::Exited(false, _)) => Check::Missing,
            _ => Check::Unknown,
        };
        Probes { git: git.join().unwrap_or(Check::Unknown), gh, gh_signed_in, glab: glab.join().unwrap_or(Check::Missing) }
    })
}

/// The host a `git remote -v` listing points at: "github", "gitlab" or none.
pub fn host_of(remotes: &str) -> Option<&'static str> {
    let text = remotes.to_ascii_lowercase();
    if text.contains("github.com") {
        Some("github")
    } else if text.contains("gitlab") {
        Some("gitlab")
    } else {
        None
    }
}

fn hosted(store: &Store) -> (Vec<String>, Vec<String>) {
    let (mut hub, mut lab) = (Vec::new(), Vec::new());
    for p in crate::projects::load_projects(store) {
        let Ran::Exited(true, text) = probe("git", &["-C", &p.path, "remote", "-v"], PROBE_LIMIT) else { continue };
        match host_of(&text) {
            Some("github") => hub.push(p.id),
            Some(_) => lab.push(p.id),
            None => {}
        }
    }
    hub.sort();
    lab.sort();
    (hub, lab)
}

fn dismissed(store: &Store) -> serde_json::Map<String, serde_json::Value> {
    store.get(KEY_DISMISSED).ok().flatten().and_then(|t| serde_json::from_str(&t).ok()).unwrap_or_default()
}

#[tauri::command]
pub async fn tools_check(app: tauri::AppHandle, refresh: bool) -> Result<Tools, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let cache = app.state::<Cache>();
        let cached = cache.0.lock().map_err(|e| e.to_string())?.clone().filter(|_| !refresh);
        let probes = match cached {
            Some(p) => p,
            None => {
                let p = probe_all(PROBE_LIMIT);
                *cache.0.lock().map_err(|e| e.to_string())? = Some(p.clone());
                p
            }
        };
        let store = app.state::<Mutex<Store>>();
        let s = store.lock().map_err(|e| e.to_string())?;
        let (github_projects, gitlab_projects) = hosted(&s);
        Ok(Tools { probes, github_projects, gitlab_projects, dismissed: dismissed(&s) })
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Hides one notice until the GitHub project set differs from `under`.
#[tauri::command]
pub fn tools_dismiss(store: tauri::State<'_, Mutex<Store>>, id: String, under: String) -> Result<(), String> {
    let s = store.lock().map_err(|e| e.to_string())?;
    let mut all = dismissed(&s);
    all.insert(id, serde_json::Value::String(under));
    s.set(KEY_DISMISSED, &serde_json::Value::Object(all).to_string()).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_missing_program_reports_missing() {
        assert_eq!(probe("kolux-no-such-tool-xyz", &["--version"], PROBE_LIMIT), Ran::NotFound);
        assert_eq!(installed("kolux-no-such-tool-xyz", PROBE_LIMIT), Check::Missing);
    }

    #[test]
    fn a_hanging_probe_is_ended_within_its_limit() {
        let start = Instant::now();
        let (prog, args): (&str, &[&str]) = if cfg!(windows) { ("ping", &["-n", "30", "127.0.0.1"]) } else { ("sleep", &["30"]) };
        assert_eq!(probe(prog, args, Duration::from_millis(500)), Ran::Hung);
        assert!(start.elapsed() < Duration::from_secs(5), "took {:?}", start.elapsed());
    }

    #[test]
    fn a_failed_version_check_counts_as_not_installed() {
        // git with an unknown option exits non-zero: the same outcome as a broken glab.
        let r = probe("git", &["--no-such-option-kolux"], PROBE_LIMIT);
        assert!(matches!(r, Ran::Exited(false, _)));
        assert_eq!(installed("git", PROBE_LIMIT), Check::Ok);
    }

    #[test]
    fn remotes_name_their_host() {
        assert_eq!(host_of("origin\thttps://github.com/owner/app.git (fetch)\n"), Some("github"));
        assert_eq!(host_of("origin\tgit@GitHub.com:owner/app.git (push)"), Some("github"));
        assert_eq!(host_of("up\thttps://gitlab.example.org/team/app.git (fetch)"), Some("gitlab"));
        assert_eq!(host_of("origin\thttps://example.org/app.git (fetch)"), None);
        assert_eq!(host_of(""), None);
    }
}
