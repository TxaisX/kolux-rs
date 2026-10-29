//! T-573: installing the agents (Txais, 2026-10-28: every agent installable from Kolux, and installed by
//! the Kolux installer). One row per catalogue agent: the OFFICIAL Windows route from the tool's own
//! documentation (npm package name, winget id or install script URL), with the page it came from and the
//! day it was checked. No official Windows route means no row route: the agent reads as not installable
//! and the reason is in the comment. Never a third-party mirror (the tests hold the host and package set).
//!
//! `agents_install(id)` is the window's command; `--install-agents` is the installer's (`cli_main`).
//! A missing runtime (Node.js for npm, uv, Git) is installed first with the frozen winget line.

use std::ffi::OsString;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::time::{Duration, Instant};

use super::{catalogue, find_in, search_dirs, AgentInfo, CATALOGUE};

/// What an agent's route needs on the PC first.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum Runtime {
    Node,
    Uv,
    Git,
}

impl Runtime {
    /// (winget id, the program whose presence means it is installed, what the sentences call it)
    fn facts(self) -> (&'static str, &'static str, &'static str) {
        match self {
            Runtime::Node => ("OpenJS.NodeJS.LTS", "npm", "Node.js"),
            Runtime::Uv => ("astral-sh.uv", "uv", "uv"),
            Runtime::Git => ("Git.Git", "git", "Git"),
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Route {
    /// `npm install -g <args>`
    Npm(&'static [&'static str]),
    /// `winget install --exact --id <id> ...`
    Winget(&'static str),
    /// `uv tool install <package>`
    Uv(&'static str),
    /// The vendor's PowerShell line, copied from its documentation, run by `powershell -Command`.
    Script(&'static str),
}

pub struct Row {
    pub id: &'static str,
    pub route: Option<Route>,
    pub needs: Option<Runtime>,
}

const fn row(id: &'static str, route: Route, needs: Option<Runtime>) -> Row {
    Row { id, route: Some(route), needs }
}
const fn none(id: &'static str) -> Row {
    Row { id, route: None, needs: None }
}

const NODE: Option<Runtime> = Some(Runtime::Node);

/// One row per `CATALOGUE` id, in its order. Every doc page below was read on 2026-10-28.
pub const TABLE: [Row; 35] = [
    // https://code.claude.com/docs/en/setup (Windows PowerShell)
    row("claude", Route::Script("irm https://claude.ai/install.ps1 | iex"), None),
    // https://github.com/Twigpine/openclaude (README: npm install -g @twigpine/openclaude)
    row("openclaude", Route::Npm(&["@twigpine/openclaude@latest"]), NODE),
    // https://github.com/openai/codex (README: Windows PowerShell line; there is no winget package)
    row("codex", Route::Script("irm https://chatgpt.com/codex/install.ps1 | iex"), None),
    // https://docs.autohand.ai/guides/cli-quick-start
    row("autohand", Route::Npm(&["autohand-cli"]), NODE),
    // Ante: https://docs.antigma.ai says "Currently only macOS and Linux are supported". Not installable.
    none("ante"),
    // Trae: no official Trae CLI install page for Windows (only third-party write-ups). Not installable.
    none("trae"),
    // https://mimo.xiaomi.com/mimocode/install (installs mimo.exe into %USERPROFILE%\.mimocode\bin)
    row("mimo-code", Route::Script("irm https://mimo.xiaomi.com/install.ps1 | iex"), None),
    // https://github.com/earendil-works/pi (README npm route; its pi.dev PowerShell script asks questions)
    row("pi", Route::Npm(&["--ignore-scripts", "@earendil-works/pi-coding-agent"]), NODE),
    // https://github.com/can1357/oh-my-pi (README: PowerShell line)
    row("omp", Route::Script("irm https://omp.sh/install.ps1 | iex"), None),
    // https://github.com/PrimeIntellect-ai/prime-agent (README: PowerShell line)
    row("prime-agent", Route::Script("irm https://app.primeintellect.ai/prime-agent/install.ps1 | iex"), None),
    // https://geminicli.com/docs/ (npm install -g @google/gemini-cli)
    row("gemini", Route::Npm(&["@google/gemini-cli"]), NODE),
    // https://antigravity.google/docs/getting-started?tab=cli (Windows PowerShell)
    row("antigravity", Route::Script("irm https://antigravity.google/cli/install.ps1 | iex"), None),
    // https://aider.chat/docs/install.html (Windows PowerShell line; it brings its own uv)
    row("aider", Route::Script("irm https://aider.chat/install.ps1 | iex"), None),
    // https://goose-docs.ai/docs/getting-started/installation (Windows: download_cli.ps1 from the goose repo,
    // CONFIGURE=false so it does not ask questions; run as a script block so no file is written)
    row(
        "goose",
        Route::Script("$env:CONFIGURE='false'; & ([scriptblock]::Create((irm https://raw.githubusercontent.com/aaif-goose/goose/main/download_cli.ps1)))"),
        None,
    ),
    // https://ampcode.com/manual (its install.ps1 is headed "The installer for Amp CLI")
    row("amp", Route::Script("irm https://ampcode.com/install.ps1 | iex"), None),
    // https://kilo.ai/docs/code-with-ai/platforms/cli
    row("kilo", Route::Npm(&["@kilocode/cli"]), NODE),
    // https://kiro.dev/docs/cli/installation/ (Windows 11, PowerShell)
    row("kiro", Route::Script("irm 'https://cli.kiro.dev/install.ps1' | iex"), None),
    // https://github.com/charmbracelet/crush (README: winget install charmbracelet.crush)
    row("crush", Route::Winget("charmbracelet.crush"), None),
    // https://docs.augmentcode.com/cli/overview (npm install -g @augmentcode/auggie; Node 20+)
    row("aug", Route::Npm(&["@augmentcode/auggie"]), NODE),
    // https://docs.cline.bot/usage/cli-overview
    row("cline", Route::Npm(&["cline"]), NODE),
    // https://www.codebuff.com/docs/help/quick-start
    row("codebuff", Route::Npm(&["codebuff"]), NODE),
    // https://commandcode.ai/docs
    row("command-code", Route::Npm(&["command-code"]), NODE),
    // https://github.com/continuedev/continue (npm i -g @continuedev/cli; docs.continue.dev's CLI page was an empty redirect)
    row("continue", Route::Npm(&["@continuedev/cli"]), NODE),
    // https://cursor.com/docs/cli/overview (Windows PowerShell; installs cursor-agent)
    row("cursor", Route::Script("irm 'https://cursor.com/install?win32=true' | iex"), None),
    // https://docs.factory.ai/droid-cli (Windows PowerShell)
    row("droid", Route::Script("irm https://app.factory.ai/cli/windows | iex"), None),
    // https://www.kimi.com/code/docs/en/kimi-code-cli/guides/getting-started (Windows PowerShell; needs Git for Windows)
    row("kimi", Route::Script("irm https://code.kimi.com/kimi-code/install.ps1 | iex"), Some(Runtime::Git)),
    // https://github.com/mistralai/mistral-vibe (README: uv tool install mistral-vibe)
    row("mistral-vibe", Route::Uv("mistral-vibe"), Some(Runtime::Uv)),
    // https://github.com/QwenLM/qwen-code (README: npm install -g @qwen-code/qwen-code@latest; Node 22+)
    row("qwen-code", Route::Npm(&["@qwen-code/qwen-code@latest"]), NODE),
    // Rovo Dev: runs inside Atlassian's ACLI (`acli rovodev run`); ACLI is a manual download with no winget id
    // and there is no standalone `rovo` program. Not installable.
    none("rovo"),
    // https://github.com/NousResearch/hermes-agent (README: native Windows PowerShell line; it installs its own Git and uv)
    row("hermes", Route::Script("& ([scriptblock]::Create((irm https://hermes-agent.nousresearch.com/install.ps1))) -NonInteractive"), None),
    // https://docs.openclaw.ai/install (PowerShell; -NoOnboard skips the questions)
    row("openclaw", Route::Script("& ([scriptblock]::Create((iwr -useb https://openclaw.ai/install.ps1))) -NoOnboard"), None),
    // https://docs.github.com/en/copilot/how-tos/copilot-cli/set-up-copilot-cli/install-copilot-cli (WinGet)
    row("copilot", Route::Winget("GitHub.Copilot"), None),
    // https://x.ai/cli (Windows PowerShell)
    row("grok", Route::Script("irm https://x.ai/cli/install.ps1 | iex"), None),
    // https://docs.devin.ai/cli (Windows PowerShell; the script ends in an interactive `devin setup`, so success
    // is judged by the program being found afterwards, not by the exit code)
    row("devin", Route::Script("irm https://static.devin.ai/cli/setup.ps1 | iex"), None),
    // https://opencode.ai/docs/ (npm i -g opencode-ai)
    row("opencode", Route::Npm(&["opencode-ai"]), NODE),
];

fn row_of(id: &str) -> Option<&'static Row> {
    TABLE.iter().find(|r| r.id == id)
}

/// The command the tooltip shows (the human-readable form of the route); `None` when not installable.
pub fn install_text(id: &str) -> Option<String> {
    Some(match row_of(id)?.route? {
        Route::Npm(args) => format!("npm install -g {}", args.join(" ")),
        Route::Winget(w) => format!("winget install --exact --id {w}"),
        Route::Uv(p) => format!("uv tool install {p}"),
        Route::Script(s) => format!("powershell -Command \"{s}\""),
    })
}

/// The frozen winget line (arguments after `winget`).
fn winget_args(id: &str) -> Vec<String> {
    ["install", "--exact", "--id", id, "--silent", "--accept-package-agreements", "--accept-source-agreements"].iter().map(|s| s.to_string()).collect()
}

const LIMIT: Duration = Duration::from_secs(10 * 60);

/// A child's search path: the registry's machine and user Path first (so a program a winget install just
/// added is seen without a restart), then this process's PATH and the usual install folders.
fn child_path() -> OsString {
    std::env::join_paths(search_dirs()).unwrap_or_else(|_| std::env::var_os("PATH").unwrap_or_default())
}

/// Runs one program to its end: no window, no input, output to a temp file, `limit` as the deadline.
/// Ok(exit code) or Err(one sentence). The last line of the output goes to `tail`.
fn run(program: &Path, args: &[String], deadline: Instant, tail: &mut String) -> Result<Option<i32>, String> {
    static N: std::sync::atomic::AtomicU32 = std::sync::atomic::AtomicU32::new(0);
    let out = std::env::temp_dir().join(format!("kolux-agent-install-{}-{}.log", std::process::id(), N.fetch_add(1, std::sync::atomic::Ordering::Relaxed)));
    let file = std::fs::File::create(&out).map_err(|e| format!("Kolux could not make a temporary file ({e})."))?;
    let file2 = file.try_clone().map_err(|e| format!("Kolux could not make a temporary file ({e})."))?;
    let mut cmd = std::process::Command::new(program);
    cmd.args(args).env("PATH", child_path()).stdin(Stdio::null()).stdout(file).stderr(file2);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
    }
    let mut child = cmd.spawn().map_err(|e| format!("Kolux could not start {} ({e}).", program.display()))?;
    let result = loop {
        match child.try_wait() {
            Ok(Some(status)) => break Ok(status.code()),
            Ok(None) if Instant::now() >= deadline => {
                kill_tree(child.id());
                let _ = child.kill();
                let _ = child.wait();
                break Err("The install took longer than 10 minutes, so Kolux stopped it.".to_string());
            }
            Ok(None) => std::thread::sleep(Duration::from_millis(100)),
            Err(e) => break Err(format!("Kolux lost track of the installer ({e}).")),
        }
    };
    if let Ok(text) = std::fs::read_to_string(&out) {
        *tail = text.lines().rev().map(str::trim).find(|l| !l.is_empty()).unwrap_or("").chars().take(200).collect();
    }
    let _ = std::fs::remove_file(&out);
    result
}

fn kill_tree(pid: u32) {
    let mut c = std::process::Command::new("taskkill");
    c.args(["/T", "/F", "/PID", &pid.to_string()]).stdin(Stdio::null()).stdout(Stdio::null()).stderr(Stdio::null());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        c.creation_flags(0x0800_0000);
    }
    let _ = c.status();
}

fn program_path(name: &str) -> PathBuf {
    find_in(&search_dirs(), name).unwrap_or_else(|| PathBuf::from(name))
}

/// Installs `runtime` with winget unless it is there. `failed` remembers runtimes that already failed in this
/// run so a missing Node.js is tried once, not once per agent.
fn ensure_runtime(runtime: Runtime, deadline: Instant, failed: &mut Vec<(Runtime, String)>, tail: &mut String) -> Result<(), String> {
    let (winget_id, program, name) = runtime.facts();
    if find_in(&search_dirs(), program).is_some() {
        return Ok(());
    }
    if let Some((_, why)) = failed.iter().find(|(r, _)| *r == runtime) {
        return Err(why.clone());
    }
    let err = |why: String| format!("{name} is needed first and could not be installed: {why}");
    let outcome = match find_in(&search_dirs(), "winget") {
        None => Err("winget is not available on this PC.".to_string()),
        Some(w) => run(&w, &winget_args(winget_id), deadline, tail).and_then(|code| {
            // winget may exit nonzero for "already installed, nothing to do"; the program being there is the test.
            if find_in(&search_dirs(), program).is_some() {
                Ok(())
            } else {
                Err(format!("winget ended with code {}.", code.map(|c| c.to_string()).unwrap_or_else(|| "none".into())))
            }
        }),
    };
    outcome.map_err(|why| {
        let text = err(why);
        failed.push((runtime, text.clone()));
        text
    })
}

fn info_of(id: &str) -> Option<AgentInfo> {
    catalogue().into_iter().find(|a| a.id == id)
}

/// Installs one agent. Ok(refreshed info) when it is found afterwards (or already was); Err(one sentence).
fn install_one(id: &str, limit: Duration, failed: &mut Vec<(Runtime, String)>, tail: &mut String) -> Result<AgentInfo, String> {
    let info = info_of(id).ok_or_else(|| format!("Kolux does not know an agent called {id}."))?;
    if info.installed {
        return Ok(info);
    }
    let (route, needs) = row_of(id)
        .and_then(|r| r.route.map(|route| (route, r.needs)))
        .ok_or_else(|| format!("Kolux has no official Windows install for {}; its own page tells how.", info.name))?;
    let deadline = Instant::now() + limit;
    if let Some(rt) = needs {
        ensure_runtime(rt, deadline, failed, tail)?;
    }
    let (program, args): (PathBuf, Vec<String>) = match route {
        Route::Npm(a) => (program_path("npm"), ["install", "-g"].iter().chain(a.iter()).map(|s| s.to_string()).collect()),
        Route::Winget(w) => (find_in(&search_dirs(), "winget").ok_or("winget is not available on this PC.")?, winget_args(w)),
        Route::Uv(p) => (program_path("uv"), ["tool", "install", p].iter().map(|s| s.to_string()).collect()),
        Route::Script(s) => (
            program_path("powershell"),
            vec!["-NoProfile".into(), "-NonInteractive".into(), "-Command".into(), format!("$ProgressPreference='SilentlyContinue'; {s}")],
        ),
    };
    let code = run(&program, &args, deadline, tail)?;
    match info_of(id) {
        Some(a) if a.installed => Ok(a),
        _ => Err(format!("{} did not finish installing (the installer ended with code {}).", info.name, code.map(|c| c.to_string()).unwrap_or_else(|| "none".into()))),
    }
}

/// The window's command: install one agent and return its refreshed state.
#[tauri::command]
pub async fn agents_install(id: String) -> Result<AgentInfo, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let (mut failed, mut tail) = (Vec::new(), String::new());
        let result = install_one(&id, LIMIT, &mut failed, &mut tail);
        log_result(&id, &result.as_ref().map(|_| ()).map_err(String::clone), &tail);
        result
    })
    .await
    .map_err(|e| format!("The install stopped unexpectedly ({e})."))?
}

/// The profile folder kolux.log lives in (`KOLUX_APP_DIR` when a scratch run sets it).
fn log_dir() -> Option<PathBuf> {
    std::env::var_os("KOLUX_APP_DIR").filter(|v| !v.is_empty()).map(PathBuf::from).or_else(|| crate::resources::recovery::profile_dir("com.txaisxiong.kolux-rs"))
}

fn log(line: &str) {
    match log_dir() {
        Some(dir) => crate::diag::write(&dir, line),
        None => eprintln!("{line}"),
    }
}

fn log_result(id: &str, result: &Result<(), String>, tail: &str) {
    match result {
        Ok(()) => log(&format!("agent install {id}: ok")),
        Err(why) => {
            log(&format!("agent install {id}: failed: {why}"));
            if !tail.is_empty() {
                log(&format!("agent install {id}: last output: {tail}"));
            }
        }
    }
}

/// `--install-agents`: every installable agent not yet installed, one after another.
/// `KOLUX_INSTALL_AGENTS_ONLY=<id>` (test only) narrows it to one agent.
pub fn install_all(only: Option<&str>, limit: Duration) {
    let mut failed = Vec::new();
    for entry in CATALOGUE.iter().map(|e| e.0).filter(|id| only.is_none_or(|o| o == *id)) {
        let Some(info) = info_of(entry) else { continue };
        if info.installed || !info.installable {
            continue;
        }
        let mut tail = String::new();
        let result = install_one(entry, limit, &mut failed, &mut tail).map(|_| ());
        log_result(entry, &result, &tail);
    }
}

/// True when the command line asks for the installer's run.
pub fn wants_install(args: &[String]) -> bool {
    args.iter().any(|a| a == "--install-agents")
}

/// The binary's hook: `Some(exit code)` when the flag is there (never opens the window, always 0).
pub fn cli_main(args: &[String]) -> Option<i32> {
    if !wants_install(args) {
        return None;
    }
    let only = std::env::var("KOLUX_INSTALL_AGENTS_ONLY").ok().filter(|v| !v.is_empty());
    install_all(only.as_deref(), LIMIT);
    Some(0)
}

#[cfg(test)]
mod tests {
    use super::*;

    const HOSTS: &[&str] = &[
        "claude.ai", "chatgpt.com", "mimo.xiaomi.com", "omp.sh", "app.primeintellect.ai", "antigravity.google", "aider.chat",
        "raw.githubusercontent.com", "ampcode.com", "cli.kiro.dev", "cursor.com", "app.factory.ai", "code.kimi.com",
        "hermes-agent.nousresearch.com", "openclaw.ai", "x.ai", "static.devin.ai",
    ];
    const NPM: &[&str] = &[
        "@twigpine/openclaude@latest", "autohand-cli", "@earendil-works/pi-coding-agent", "@google/gemini-cli", "@kilocode/cli",
        "@augmentcode/auggie", "cline", "codebuff", "command-code", "@continuedev/cli", "@qwen-code/qwen-code@latest", "opencode-ai",
    ];
    const WINGET: &[&str] = &["charmbracelet.crush", "GitHub.Copilot", "OpenJS.NodeJS.LTS", "astral-sh.uv", "Git.Git"];
    const UV: &[&str] = &["mistral-vibe"];

    #[test]
    fn every_catalogue_agent_has_a_row_in_catalogue_order() {
        assert_eq!(TABLE.len(), CATALOGUE.len());
        for (row, entry) in TABLE.iter().zip(CATALOGUE.iter()) {
            assert_eq!(row.id, entry.0);
        }
        let none: Vec<&str> = TABLE.iter().filter(|r| r.route.is_none()).map(|r| r.id).collect();
        assert_eq!(none, ["ante", "trae", "rovo"], "the agents with no official Windows route");
    }

    #[test]
    fn rows_use_only_official_hosts_and_packages() {
        for r in &TABLE {
            match r.route {
                None => {}
                Some(Route::Npm(args)) => {
                    let pkg = args.last().unwrap();
                    assert!(NPM.contains(pkg), "{}: npm package {pkg}", r.id);
                    assert!(args[..args.len() - 1].iter().all(|a| *a == "--ignore-scripts"), "{}: npm flags", r.id);
                    assert_eq!(r.needs, NODE, "{}: npm needs Node", r.id);
                }
                Some(Route::Winget(w)) => assert!(WINGET.contains(&w), "{}: winget id {w}", r.id),
                Some(Route::Uv(p)) => {
                    assert!(UV.contains(&p), "{}: uv package {p}", r.id);
                    assert_eq!(r.needs, Some(Runtime::Uv));
                }
                Some(Route::Script(s)) => {
                    let urls: Vec<&str> = s.split("https://").skip(1).collect();
                    assert!(!urls.is_empty(), "{}: a script row names its URL", r.id);
                    for rest in urls {
                        let host = rest.split(['/', '?', '\'', ')', ' ']).next().unwrap();
                        assert!(HOSTS.contains(&host), "{}: host {host}", r.id);
                    }
                    assert!(!s.contains("http://"), "{}: plain http", r.id);
                }
            }
        }
        for rt in [Runtime::Node, Runtime::Uv, Runtime::Git] {
            assert!(WINGET.contains(&rt.facts().0));
        }
    }

    #[test]
    fn the_winget_line_is_the_frozen_one() {
        assert_eq!(winget_args("Git.Git").join(" "), "install --exact --id Git.Git --silent --accept-package-agreements --accept-source-agreements");
    }

    #[test]
    fn the_tooltip_text_names_the_route() {
        assert_eq!(install_text("cline").as_deref(), Some("npm install -g cline"));
        assert_eq!(install_text("pi").as_deref(), Some("npm install -g --ignore-scripts @earendil-works/pi-coding-agent"));
        assert_eq!(install_text("crush").as_deref(), Some("winget install --exact --id charmbracelet.crush"));
        assert_eq!(install_text("mistral-vibe").as_deref(), Some("uv tool install mistral-vibe"));
        assert!(install_text("claude").unwrap().contains("https://claude.ai/install.ps1"));
        assert_eq!(install_text("ante"), None);
        assert_eq!(install_text("nope"), None);
    }

    #[test]
    fn the_catalogue_reports_installable_and_the_command() {
        let all = catalogue();
        assert_eq!(all.len(), 35);
        for a in &all {
            assert_eq!(a.installable, a.install.is_some(), "{}", a.id);
        }
        assert_eq!(all.iter().filter(|a| !a.installable).map(|a| a.id.as_str()).collect::<Vec<_>>(), ["ante", "trae", "rovo"]);
    }

    #[test]
    fn the_flag_is_found_anywhere_and_nothing_else_matches() {
        let a = |v: &[&str]| v.iter().map(|s| s.to_string()).collect::<Vec<_>>();
        assert!(wants_install(&a(&["--install-agents"])));
        assert!(wants_install(&a(&["--x", "--install-agents"])));
        assert!(!wants_install(&a(&[])));
        assert!(!wants_install(&a(&["--install-agent", "--terminal-service"])));
        assert_eq!(cli_main(&a(&["--terminal-service"])), None);
    }

    #[test]
    fn an_unknown_or_uninstallable_agent_gets_one_plain_sentence() {
        let (mut failed, mut tail) = (Vec::new(), String::new());
        let e = install_one("nope", LIMIT, &mut failed, &mut tail).unwrap_err();
        assert_eq!(e, "Kolux does not know an agent called nope.");
        // ante is never on this PC's PATH in a test run unless someone installed it; skip the check then.
        if !info_of("ante").unwrap().installed {
            let e = install_one("ante", LIMIT, &mut failed, &mut tail).unwrap_err();
            assert!(e.starts_with("Kolux has no official Windows install for Ante"), "{e}");
        }
    }

    #[test]
    fn a_runaway_program_is_stopped_at_the_deadline() {
        let mut tail = String::new();
        let started = Instant::now();
        let r = run(&program_path("powershell"), &["-NoProfile".into(), "-Command".into(), "Start-Sleep 30".into()], Instant::now() + Duration::from_millis(500), &mut tail);
        assert_eq!(r, Err("The install took longer than 10 minutes, so Kolux stopped it.".to_string()));
        assert!(started.elapsed() < Duration::from_secs(10));
    }
}
