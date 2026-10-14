//! APP-023: the landing screen's tool checks. Git, GitHub's `gh` (installed, signed in) and
//! GitLab's `glab` are probed on the search path with a time limit; the results are kept until a
//! manual refresh. Which projects GitHub or GitLab hosts is read fresh on every call, so adding one
//! brings a dismissed notice back. A dismissal is stored with the GitHub project set it was made under.
//! SESS-039: which outside editors (VS Code, Cursor, Zed, Sublime Text, NeoVim, the JetBrains IDEs)
//! are installed, for opening a worktree in one; the open itself is `links::editor_open`.
use crate::state::Store;
use serde::Serialize;
use std::io::Read;
use std::path::PathBuf;
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

/// SESS-039: an outside editor a worktree can be opened in. `console` editors (NeoVim) run in a
/// console window of their own; the rest are windowed apps or their command-line launchers.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Editor {
    pub id: String,
    pub name: String,
    pub path: String,
    pub console: bool,
}

/// id, name, the command-line names on the search path, the install-relative files to try
/// under each program folder, and whether it runs in a console.
type Known = (&'static str, &'static str, &'static [&'static str], &'static [&'static str], bool);

const EDITORS: &[Known] = &[
    ("vscode", "VS Code", &["code"], &["Microsoft VS Code/bin/code.cmd"], false),
    ("cursor", "Cursor", &["cursor"], &["cursor/resources/app/bin/cursor.cmd"], false),
    ("zed", "Zed", &["zed"], &["Zed/bin/zed.exe"], false),
    ("sublime", "Sublime Text", &["subl"], &["Sublime Text/subl.exe", "Sublime Text 3/subl.exe"], false),
    ("nvim", "NeoVim", &["nvim"], &["Neovim/bin/nvim.exe"], true),
];

/// JetBrains IDEs: id, name, the Toolbox's command-line script name, the launcher in the
/// install's own `bin` folder (SESS-039: located beside the install, not on the search path).
const JETBRAINS: &[(&str, &str, &str, &str)] = &[
    ("idea", "IntelliJ IDEA", "idea", "idea64.exe"),
    ("pycharm", "PyCharm", "pycharm", "pycharm64.exe"),
    ("webstorm", "WebStorm", "webstorm", "webstorm64.exe"),
    ("rider", "Rider", "rider", "rider64.exe"),
    ("goland", "GoLand", "goland", "goland64.exe"),
    ("clion", "CLion", "clion", "clion64.exe"),
    ("phpstorm", "PhpStorm", "phpstorm", "phpstorm64.exe"),
    ("rustrover", "RustRover", "rustrover", "rustrover64.exe"),
];

/// The launcher `exe` inside `<root>/JetBrains/<install>/bin` or `<root>/<install>/bin` (the
/// Toolbox's per-user installs), the install folder that sorts last (the newest version) winning.
pub fn jetbrains_launcher(roots: &[PathBuf], exe: &str) -> Option<PathBuf> {
    let mut found: Vec<PathBuf> = Vec::new();
    for root in roots {
        for parent in [root.join("JetBrains"), root.clone()] {
            let Ok(rd) = std::fs::read_dir(&parent) else { continue };
            found.extend(rd.flatten().map(|e| e.path().join("bin").join(exe)).filter(|p| p.is_file()));
        }
    }
    found.sort_by_key(|p| p.to_string_lossy().to_lowercase());
    found.pop()
}

/// SESS-039: the editors found, in a fixed order: each by its command-line name on `dirs`,
/// then at its usual place under one of `roots` (the program folders).
pub fn editors_in(dirs: &[PathBuf], roots: &[PathBuf]) -> Vec<Editor> {
    let at = |rels: &[&str]| roots.iter().flat_map(|r| rels.iter().map(move |rel| r.join(rel))).find(|p| p.is_file());
    let mut out = Vec::new();
    for (id, name, programs, rels, console) in EDITORS {
        if let Some(p) = programs.iter().find_map(|p| crate::agents::find_in(dirs, p)).or_else(|| at(rels)) {
            out.push(Editor { id: id.to_string(), name: name.to_string(), path: p.display().to_string(), console: *console });
        }
    }
    for (id, name, script, exe) in JETBRAINS {
        if let Some(p) = crate::agents::find_in(dirs, script).or_else(|| jetbrains_launcher(roots, exe)) {
            out.push(Editor { id: id.to_string(), name: name.to_string(), path: p.display().to_string(), console: false });
        }
    }
    out
}

/// The program folders an editor installs under on this machine.
#[allow(dead_code)] // T-304: reached through editors_list, registered by the coordinator's hunk
fn program_roots() -> Vec<PathBuf> {
    let mut v: Vec<PathBuf> = ["ProgramFiles", "ProgramFiles(x86)"].iter().filter_map(std::env::var_os).map(PathBuf::from).collect();
    v.extend(std::env::var_os("LOCALAPPDATA").map(|l| PathBuf::from(l).join("Programs")));
    v
}

/// The editors installed here.
#[allow(dead_code)] // T-304: reached through editors_list and links::editor_open
pub fn editors() -> Vec<Editor> {
    editors_in(&crate::agents::search_dirs(), &program_roots())
}

/// SESS-039: the outside editors this machine has, for the "Open in" rows.
// T-304: registered by the coordinator's lib.rs hunk; unused until then.
#[allow(dead_code)]
#[tauri::command]
pub async fn editors_list() -> Result<Vec<Editor>, String> {
    tauri::async_runtime::spawn_blocking(editors).await.map_err(|e| e.to_string())
}

/// The facts the Agent Teams picker entry depends on (T-191-b): native Windows and WSL never offer
/// it, and it starts through the Kolux command line found on the system search path.
#[derive(Serialize, Clone, Debug, PartialEq, Eq)]
pub struct TeamsHost {
    pub windows: bool,
    pub wsl: bool,
    pub cli: Option<String>,
}

/// The host facts from the platform, the WSL markers and the found command line.
pub fn teams_host_from(windows: bool, distro: Option<&str>, osrelease: &str, cli: Option<PathBuf>) -> TeamsHost {
    let wsl = !windows && (distro.is_some_and(|d| !d.is_empty()) || osrelease.to_lowercase().contains("microsoft"));
    let cli = if windows || wsl { None } else { cli.map(|p| p.to_string_lossy().into_owned()) };
    TeamsHost { windows, wsl, cli }
}

/// T-191-b: whether this machine may offer Claude Agent Teams, for the picker.
// T-191-b: registered by the coordinator's lib.rs hunk; unused until then.
#[allow(dead_code)]
#[tauri::command]
pub async fn teams_host() -> Result<TeamsHost, String> {
    tauri::async_runtime::spawn_blocking(|| {
        let distro = std::env::var("WSL_DISTRO_NAME").ok();
        let osrelease = std::fs::read_to_string("/proc/sys/kernel/osrelease").unwrap_or_default();
        // CLI-007: run by its bare name, which a Kolux pane finds first on its own search path.
        let cli = if cfg!(windows) { None } else { crate::agents::find_program(crate::orchestration::CLI).map(|_| PathBuf::from(crate::orchestration::CLI)) };
        teams_host_from(cfg!(windows), distro.as_deref(), &osrelease, cli)
    })
    .await
    .map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn t191b_agent_teams_is_offered_only_off_windows_and_wsl_with_the_command_line_found() {
        let cli = || Some(PathBuf::from("/usr/local/bin/kolux"));
        let linux = teams_host_from(false, None, "6.8.0-generic", cli());
        assert_eq!(linux, TeamsHost { windows: false, wsl: false, cli: Some("/usr/local/bin/kolux".into()) });
        assert!(teams_host_from(false, Some("Ubuntu"), "", cli()).wsl);
        let wsl = teams_host_from(false, None, "5.15.153.1-microsoft-standard-WSL2", cli());
        assert!(wsl.wsl && wsl.cli.is_none());
        let win = teams_host_from(true, None, "", cli());
        assert!(win.windows && !win.wsl && win.cli.is_none());
        assert_eq!(teams_host_from(false, Some(""), "6.8.0", None).cli, None);
    }

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

    fn touch(p: &std::path::Path) {
        std::fs::create_dir_all(p.parent().unwrap()).unwrap();
        std::fs::write(p, "").unwrap();
    }

    #[cfg(windows)]
    #[test]
    fn sess039_editors_are_found_on_the_path_and_jetbrains_launchers_beside_their_install() {
        let base = std::env::temp_dir().join(format!("krs-editors-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&base);
        let (bin, pf, local) = (base.join("bin"), base.join("pf"), base.join("local"));
        touch(&bin.join("code.cmd"));
        touch(&pf.join("Neovim/bin/nvim.exe"));
        touch(&pf.join("JetBrains/IntelliJ IDEA 2024.1/bin/idea64.exe"));
        touch(&pf.join("JetBrains/IntelliJ IDEA 2025.2/bin/idea64.exe"));
        touch(&local.join("PyCharm Community/bin/pycharm64.exe"));
        // a launcher not in its install's bin folder does not count
        touch(&pf.join("JetBrains/WebStorm 2025.1/webstorm64.exe"));
        let found = editors_in(std::slice::from_ref(&bin), &[pf.clone(), local.clone()]);
        let ids: Vec<&str> = found.iter().map(|e| e.id.as_str()).collect();
        assert_eq!(ids, ["vscode", "nvim", "idea", "pycharm"]);
        assert!(found[0].path.ends_with("code.cmd") && !found[0].console);
        assert!(found[1].console, "NeoVim runs in a console window");
        assert!(found[2].path.contains("2025.2"), "the newest install wins: {}", found[2].path);
        assert!(found[3].path.contains("PyCharm Community"));
        // nothing installed: nothing offered
        assert!(editors_in(&[], &[base.join("empty")]).is_empty());
        let _ = std::fs::remove_dir_all(&base);
    }
}
