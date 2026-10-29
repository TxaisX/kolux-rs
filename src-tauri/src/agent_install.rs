//! T-573: installing the agents (Txais, 2026-10-28: every agent installable from Kolux, and installed by
//! the Kolux installer). One row per catalogue agent: the OFFICIAL Windows route from the tool's own
//! documentation (npm package name, winget id or install script URL), with the page it came from and the
//! day it was checked. No official Windows route means no row route: the agent reads as not installable
//! and the reason is in the comment. Never a third-party mirror (the tests hold the host and package set).
//!
//! `agents_install(id)` is the window's command; `--install-agents` is the installer's (`cli_main`).
//! A missing runtime (Node.js for npm, uv, Git) is installed first with the frozen winget line.
//! T-576: the audit list that holds each route to its official source is `agent_install_official.rs`
//! (test only); installs run one at a time across the app; the install-all pass has a 45-minute cap, a
//! runtime install its own 10-minute deadline, and a silent or update install never raises a Windows
//! admin prompt (Node.js and Git are machine-wide installers).

use std::ffi::OsString;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::time::{Duration, Instant};

use super::{catalogue, find_in, search_dirs, AgentInfo, CATALOGUE};

// T-576: the reviewed allow-list the tests hold the table to (test only; not part of the program).
#[cfg(test)]
#[path = "agent_install_official.rs"]
mod agent_install_official;

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

    /// True when the installer is machine-wide and Windows asks for admin permission (T-576, checked with
    /// `winget show --scope user` on 2026-10-28: Node.js has no per-user installer; uv is a portable zip that
    /// takes `--scope user`; Git is kept on the default route).
    fn machine_scope(self) -> bool {
        !matches!(self, Runtime::Uv)
    }
}

/// Who is waiting for the install (T-576).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Mode {
    /// The person is at the screen (the window's Install button, or an interactive installer): a runtime
    /// install may raise Windows' admin prompt.
    Interactive,
    /// A silent or update install: never start a machine-wide runtime install.
    Silent,
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
    /// The route ends in an interactive step (T-576: Devin's script finishes with `devin setup`, which waits for a
    /// login). The run is ended as soon as the agent is found on the PC, instead of waiting for that step.
    pub ends_when_found: bool,
}

const fn row(id: &'static str, route: Route, needs: Option<Runtime>) -> Row {
    Row { id, route: Some(route), needs, ends_when_found: false }
}
const fn row_ends_when_found(id: &'static str, route: Route, needs: Option<Runtime>) -> Row {
    Row { id, route: Some(route), needs, ends_when_found: true }
}
const fn none(id: &'static str) -> Row {
    Row { id, route: None, needs: None, ends_when_found: false }
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
    // winget show Sourcegraph.Amp (checked 2026-10-28): publisher Sourcegraph, Inc., homepage https://ampcode.com/
    row("amp", Route::Winget("Sourcegraph.Amp"), None),
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
    // https://github.com/continuedev/continue (npm i -g @continuedev/cli; docs.continue.dev's CLI page was an empty redirect).
    // Its repo is read-only and unmaintained (checked 2026-10-28). Kept as a coordinator default; Txais may overrule.
    row("continue", Route::Npm(&["@continuedev/cli"]), NODE),
    // https://cursor.com/docs/cli/overview (Windows PowerShell; installs cursor-agent)
    row("cursor", Route::Script("irm 'https://cursor.com/install?win32=true' | iex"), None),
    // https://docs.factory.com/cli/getting-started/quickstart (Windows PowerShell)
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
    // Grok CLI: xAI documents only a macOS/Linux install script, so not installable (T-576 review). No x.ai docs page
    // shows install.ps1 (x.ai/cli answers 403 to a script; checked 2026-10-28). The file does exist on x.ai itself and
    // starts "# Grok CLI installer for PowerShell - https://x.ai/cli/install.ps1 ... Usage: irm https://x.ai/cli/install.ps1 | iex",
    // so the coordinator may turn this row back on if a docs page is found.
    none("grok"),
    // https://docs.devin.ai/cli (Windows PowerShell). The script ends in `devin setup`, a full-screen menu
    // ("select / confirm / esc") that waits for a person; a live run on 2026-10-28 sat there until the 10-minute
    // deadline and opened no browser. So the run is ended as soon as devin.exe is found (the script has put it
    // in %LOCALAPPDATA%\devin\cli\bin and on the user PATH by then; T-576).
    row_ends_when_found("devin", Route::Script("irm https://static.devin.ai/cli/setup.ps1 | iex"), None),
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

/// The frozen line for a runtime: uv is a portable zip, so it is installed for this user only (no admin prompt).
fn runtime_winget_args(runtime: Runtime) -> Vec<String> {
    let mut args = winget_args(runtime.facts().0);
    if !runtime.machine_scope() {
        args.extend(["--scope".to_string(), "user".to_string()]);
    }
    args
}

/// One agent's time limit.
const LIMIT: Duration = Duration::from_secs(10 * 60);
/// A runtime install (Node.js, uv, Git) has its own deadline, apart from the agent that needed it.
const RUNTIME_LIMIT: Duration = Duration::from_secs(10 * 60);
/// The whole install-all pass.
pub const TOTAL_LIMIT: Duration = Duration::from_secs(45 * 60);

/// One install at a time across the app (T-576): a window click and an install-all pass never run two npm
/// installs together. A caller that finds it held waits.
static INSTALL_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());

/// A child's search path: the registry's machine and user Path first (so a program a winget install just
/// added is seen without a restart), then this process's PATH and the usual install folders.
fn child_path() -> OsString {
    std::env::join_paths(search_dirs()).unwrap_or_else(|_| std::env::var_os("PATH").unwrap_or_default())
}

/// How often `run` asks whether it can stop early.
const EARLY_CHECK: Duration = Duration::from_secs(2);

/// Runs one program to its end: no window, no input, output to a temp file, `limit` as the deadline.
/// Ok(exit code) or Err(one sentence). The last line of the output goes to `tail`.
/// `done_early`, when given, is asked every couple of seconds; once it says yes the whole process tree is
/// ended and the result is Ok(None) (no exit code).
fn run(program: &Path, args: &[String], deadline: Instant, tail: &mut String, done_early: Option<&dyn Fn() -> bool>) -> Result<Option<i32>, String> {
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
    let mut next_check = Instant::now() + EARLY_CHECK;
    let result = loop {
        match child.try_wait() {
            Ok(Some(status)) => break Ok(status.code()),
            Ok(None) if asks_to_stop(done_early, &mut next_check) => {
                kill_tree(child.id());
                let _ = child.kill();
                let _ = child.wait();
                break Ok(None);
            }
            Ok(None) if Instant::now() >= deadline => {
                kill_tree(child.id());
                let _ = child.kill();
                let _ = child.wait();
                break Err("The install took longer than its time limit, so Kolux stopped it.".to_string());
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

/// True when `done_early` exists, it is time to ask, and it says yes.
fn asks_to_stop(done_early: Option<&dyn Fn() -> bool>, next_check: &mut Instant) -> bool {
    match done_early {
        Some(f) if Instant::now() >= *next_check => {
            *next_check = Instant::now() + EARLY_CHECK;
            f()
        }
        _ => false,
    }
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

/// What one install-all pass (or one window click) carries between agents.
struct Ctx {
    mode: Mode,
    /// One agent's time limit.
    limit: Duration,
    /// When the whole pass must be over (`None` for a single window click).
    total_end: Option<Instant>,
    /// Runtimes that already failed in this run, so a missing Node.js is tried once, not once per agent.
    failed: Vec<(Runtime, String)>,
    /// The last output line of the last program run.
    tail: String,
}

impl Ctx {
    fn new(mode: Mode, limit: Duration, total_end: Option<Instant>) -> Self {
        Ctx { mode, limit, total_end, failed: Vec::new(), tail: String::new() }
    }
    /// A deadline never later than the whole pass's.
    fn clamp(&self, deadline: Instant) -> Instant {
        match self.total_end {
            Some(end) if end < deadline => end,
            _ => deadline,
        }
    }
}

/// The sentence for a runtime that a silent or update install must not start (it would raise an admin prompt).
fn silent_refusal(runtime: Runtime, mode: Mode) -> Option<String> {
    (mode == Mode::Silent && runtime.machine_scope()).then(|| format!("needs {} (install it, then use Install in Kolux)", runtime.facts().2))
}

/// Installs `runtime` with winget unless it is there. It has its own deadline (`RUNTIME_LIMIT`), apart from
/// the agent that needed it. A silent install never starts a machine-wide one.
fn ensure_runtime(runtime: Runtime, ctx: &mut Ctx) -> Result<(), String> {
    let (_, program, name) = runtime.facts();
    if find_in(&search_dirs(), program).is_some() {
        return Ok(());
    }
    if let Some((_, why)) = ctx.failed.iter().find(|(r, _)| *r == runtime) {
        return Err(why.clone());
    }
    let remember = |ctx: &mut Ctx, text: String| {
        ctx.failed.push((runtime, text.clone()));
        text
    };
    if let Some(text) = silent_refusal(runtime, ctx.mode) {
        return Err(remember(ctx, text));
    }
    let deadline = ctx.clamp(Instant::now() + RUNTIME_LIMIT);
    let outcome = match find_in(&search_dirs(), "winget") {
        None => Err("winget is not available on this PC.".to_string()),
        Some(w) => run(&w, &runtime_winget_args(runtime), deadline, &mut ctx.tail, None).and_then(|code| {
            // winget may exit nonzero for "already installed, nothing to do"; the program being there is the test.
            if find_in(&search_dirs(), program).is_some() {
                Ok(())
            } else {
                Err(format!("winget ended with code {}.", code.map(|c| c.to_string()).unwrap_or_else(|| "none".into())))
            }
        }),
    };
    outcome.map_err(|why| {
        let text = format!("{name} is needed first and could not be installed: {why}");
        remember(ctx, text)
    })
}

fn info_of(id: &str) -> Option<AgentInfo> {
    catalogue().into_iter().find(|a| a.id == id)
}

/// Installs one agent, alone: it waits for any other install in this app first.
/// Ok(refreshed info) when it is found afterwards (or already was); Err(one sentence).
fn install_one(id: &str, ctx: &mut Ctx) -> Result<AgentInfo, String> {
    let _one_at_a_time = INSTALL_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let info = info_of(id).ok_or_else(|| format!("Kolux does not know an agent called {id}."))?;
    if info.installed {
        return Ok(info);
    }
    let (route, needs) = row_of(id)
        .and_then(|r| r.route.map(|route| (route, r.needs)))
        .ok_or_else(|| format!("Kolux has no official Windows install for {}; its own page tells how.", info.name))?;
    if let Some(rt) = needs {
        ensure_runtime(rt, ctx)?;
    }
    let deadline = ctx.clamp(Instant::now() + ctx.limit);
    let (program, args): (PathBuf, Vec<String>) = match route {
        Route::Npm(a) => (program_path("npm"), ["install", "-g"].iter().chain(a.iter()).map(|s| s.to_string()).collect()),
        Route::Winget(w) => (find_in(&search_dirs(), "winget").ok_or("winget is not available on this PC.")?, winget_args(w)),
        Route::Uv(p) => (program_path("uv"), ["tool", "install", p].iter().map(|s| s.to_string()).collect()),
        Route::Script(s) => (
            program_path("powershell"),
            ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command"]
                .iter()
                .map(|a| a.to_string())
                .chain(std::iter::once(format!("$ProgressPreference='SilentlyContinue'; {s}")))
                .collect(),
        ),
    };
    let found = || info_of(id).is_some_and(|a| a.installed);
    let ends_early = row_of(id).is_some_and(|r| r.ends_when_found);
    let code = run(&program, &args, deadline, &mut ctx.tail, if ends_early { Some(&found) } else { None })?;
    match info_of(id) {
        Some(a) if a.installed => Ok(a),
        _ => Err(format!("{} did not finish installing (the installer ended with code {}).", info.name, code.map(|c| c.to_string()).unwrap_or_else(|| "none".into()))),
    }
}

/// The window's command: install one agent and return its refreshed state.
#[tauri::command]
pub async fn agents_install(id: String) -> Result<AgentInfo, String> {
    tauri::async_runtime::spawn_blocking(move || {
        // A click: the person is at the screen, so a runtime install may raise Windows' admin prompt.
        let mut ctx = Ctx::new(Mode::Interactive, LIMIT, None);
        let result = install_one(&id, &mut ctx);
        log_result(&id, &result.as_ref().map(|_| ()).map_err(String::clone), &ctx.tail);
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

/// The line for an agent the pass did not reach before the total time ran out.
const OUT_OF_TIME: &str = "skipped, the 45-minute install time ran out";

/// Walks `ids` one after another; once `total_end` has passed, the rest are reported as skipped, not tried.
/// `step` returns the result and the last output line; `report` gets both.
fn pass(ids: &[&str], total_end: Instant, mut step: impl FnMut(&str) -> (Result<(), String>, String), mut report: impl FnMut(&str, &Result<(), String>, &str)) {
    for id in ids {
        let (result, tail) = if Instant::now() >= total_end { (Err(OUT_OF_TIME.to_string()), String::new()) } else { step(id) };
        report(id, &result, &tail);
    }
}

/// `--install-agents`: every installable agent not yet installed, one after another, within `total`.
/// `KOLUX_INSTALL_AGENTS_ONLY=<id>` (test only) narrows it to one agent.
pub fn install_all(only: Option<&str>, mode: Mode, limit: Duration, total: Duration) {
    let ids: Vec<&str> = CATALOGUE
        .iter()
        .map(|e| e.0)
        .filter(|id| only.is_none_or(|o| o == *id))
        .filter(|id| info_of(id).is_some_and(|a| !a.installed && a.installable))
        .collect();
    let total_end = Instant::now() + total;
    let mut ctx = Ctx::new(mode, limit, Some(total_end));
    pass(
        &ids,
        total_end,
        |id| {
            ctx.tail.clear();
            let result = install_one(id, &mut ctx).map(|_| ());
            (result, ctx.tail.clone())
        },
        log_result,
    );
}

/// True when the command line asks for the installer's run.
pub fn wants_install(args: &[String]) -> bool {
    args.iter().any(|a| a == "--install-agents")
}

/// `--interactive` (the installer passes it when the person is at the screen): a runtime install may raise
/// Windows' admin prompt. Without it the run is silent.
pub fn mode_of(args: &[String]) -> Mode {
    if args.iter().any(|a| a == "--interactive") {
        Mode::Interactive
    } else {
        Mode::Silent
    }
}

/// The binary's hook: `Some(exit code)` when the flag is there (never opens the window, always 0).
pub fn cli_main(args: &[String]) -> Option<i32> {
    if !wants_install(args) {
        return None;
    }
    let only = std::env::var("KOLUX_INSTALL_AGENTS_ONLY").ok().filter(|v| !v.is_empty());
    install_all(only.as_deref(), mode_of(args), LIMIT, TOTAL_LIMIT);
    Some(0)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_catalogue_agent_has_a_row_in_catalogue_order() {
        assert_eq!(TABLE.len(), CATALOGUE.len());
        for (row, entry) in TABLE.iter().zip(CATALOGUE.iter()) {
            assert_eq!(row.id, entry.0);
        }
        let none: Vec<&str> = TABLE.iter().filter(|r| r.route.is_none()).map(|r| r.id).collect();
        assert_eq!(none, ["ante", "trae", "rovo", "grok"], "the agents with no official Windows route");
    }

    #[test]
    fn npm_rows_need_node_and_uv_rows_need_uv() {
        for r in &TABLE {
            match r.route {
                Some(Route::Npm(_)) => assert_eq!(r.needs, NODE, "{}: npm needs Node", r.id),
                Some(Route::Uv(_)) => assert_eq!(r.needs, Some(Runtime::Uv), "{}", r.id),
                _ => {}
            }
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
        assert_eq!(all.iter().filter(|a| !a.installable).map(|a| a.id.as_str()).collect::<Vec<_>>(), ["ante", "trae", "rovo", "grok"]);
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

    fn ctx(mode: Mode) -> Ctx {
        Ctx::new(mode, LIMIT, None)
    }

    #[test]
    fn an_unknown_or_uninstallable_agent_gets_one_plain_sentence() {
        let mut c = ctx(Mode::Interactive);
        let e = install_one("nope", &mut c).unwrap_err();
        assert_eq!(e, "Kolux does not know an agent called nope.");
        // ante is never on this PC's PATH in a test run unless someone installed it; skip the check then.
        if !info_of("ante").unwrap().installed {
            let e = install_one("ante", &mut c).unwrap_err();
            assert!(e.starts_with("Kolux has no official Windows install for Ante"), "{e}");
        }
    }

    #[test]
    fn a_silent_install_never_starts_a_machine_wide_runtime() {
        assert_eq!(silent_refusal(Runtime::Node, Mode::Silent).as_deref(), Some("needs Node.js (install it, then use Install in Kolux)"));
        assert_eq!(silent_refusal(Runtime::Git, Mode::Silent).as_deref(), Some("needs Git (install it, then use Install in Kolux)"));
        // uv is per-user, so a silent install may install it; an interactive one may install any
        assert_eq!(silent_refusal(Runtime::Uv, Mode::Silent), None);
        for rt in [Runtime::Node, Runtime::Uv, Runtime::Git] {
            assert_eq!(silent_refusal(rt, Mode::Interactive), None);
        }
    }

    #[test]
    fn uv_is_installed_for_this_user_and_the_others_on_the_frozen_line() {
        assert_eq!(runtime_winget_args(Runtime::Uv).join(" "), "install --exact --id astral-sh.uv --silent --accept-package-agreements --accept-source-agreements --scope user");
        assert_eq!(runtime_winget_args(Runtime::Node), winget_args("OpenJS.NodeJS.LTS"));
        assert_eq!(runtime_winget_args(Runtime::Git), winget_args("Git.Git"));
    }

    #[test]
    fn the_installer_flag_picks_the_mode() {
        let a = |v: &[&str]| v.iter().map(|s| s.to_string()).collect::<Vec<_>>();
        assert_eq!(mode_of(&a(&["--install-agents"])), Mode::Silent);
        assert_eq!(mode_of(&a(&["--install-agents", "--interactive"])), Mode::Interactive);
    }

    #[test]
    fn a_pass_skips_the_rest_once_the_total_time_ran_out() {
        let mut tried = Vec::new();
        let mut lines = Vec::new();
        pass(&["a", "b"], Instant::now() - Duration::from_secs(1), |id| { tried.push(id.to_string()); (Ok(()), String::new()) }, |id, r, _| lines.push(format!("{id}: {r:?}")));
        assert!(tried.is_empty());
        assert_eq!(lines, ["a: Err(\"skipped, the 45-minute install time ran out\")", "b: Err(\"skipped, the 45-minute install time ran out\")"]);
        let mut tried = Vec::new();
        pass(&["a", "b"], Instant::now() + Duration::from_secs(60), |id| { tried.push(id.to_string()); (Ok(()), String::new()) }, |_, _, _| {});
        assert_eq!(tried, ["a", "b"]);
    }

    #[test]
    fn the_total_time_also_cuts_one_agents_deadline() {
        let end = Instant::now() + Duration::from_secs(5);
        let c = Ctx::new(Mode::Silent, LIMIT, Some(end));
        assert_eq!(c.clamp(Instant::now() + Duration::from_secs(600)), end);
        let far = Instant::now() + Duration::from_secs(1);
        assert_eq!(Ctx::new(Mode::Silent, LIMIT, None).clamp(far), far);
        assert_eq!(TOTAL_LIMIT, Duration::from_secs(45 * 60));
        assert_eq!(RUNTIME_LIMIT, Duration::from_secs(10 * 60));
    }

    #[test]
    fn installs_run_one_at_a_time() {
        let held = INSTALL_LOCK.lock().unwrap();
        let (tx, rx) = std::sync::mpsc::channel();
        let t = std::thread::spawn(move || {
            let _g = INSTALL_LOCK.lock().unwrap_or_else(|e| e.into_inner());
            tx.send(()).unwrap();
        });
        assert!(rx.recv_timeout(Duration::from_millis(300)).is_err(), "a second install waits while one runs");
        drop(held);
        assert!(rx.recv_timeout(Duration::from_secs(5)).is_ok());
        t.join().unwrap();
    }

    #[test]
    fn a_program_that_waits_for_a_person_is_ended_once_the_agent_is_found() {
        let mut tail = String::new();
        let started = Instant::now();
        let asked = std::cell::Cell::new(0);
        let found = || {
            asked.set(asked.get() + 1);
            asked.get() >= 2
        };
        let r = run(&program_path("powershell"), &["-NoProfile".into(), "-Command".into(), "Start-Sleep 60".into()], Instant::now() + Duration::from_secs(50), &mut tail, Some(&found));
        assert_eq!(r, Ok(None));
        assert_eq!(asked.get(), 2);
        assert!(started.elapsed() < Duration::from_secs(20), "{:?}", started.elapsed());
        assert!(row_of("devin").unwrap().ends_when_found);
        assert_eq!(TABLE.iter().filter(|r| r.ends_when_found).count(), 1, "only devin ends early");
    }

    #[test]
    fn a_runaway_program_is_stopped_at_the_deadline() {
        let mut tail = String::new();
        let started = Instant::now();
        let r = run(&program_path("powershell"), &["-NoProfile".into(), "-Command".into(), "Start-Sleep 30".into()], Instant::now() + Duration::from_millis(500), &mut tail, None);
        assert_eq!(r, Err("The install took longer than its time limit, so Kolux stopped it.".to_string()));
        assert!(started.elapsed() < Duration::from_secs(10));
    }
}
