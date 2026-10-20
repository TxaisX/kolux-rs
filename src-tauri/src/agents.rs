//! The agents Kolux can start (SESS-001, SESS-027, SESS-051). An agent is "installed" when a
//! program that can run is found under its program name: on the search path a fresh shell would
//! get first (on Windows the machine and user Path values in the registry, expanded; T-007-a-fix),
//! then on this process's PATH, then in the usual install folders (npm's global bin, a Node version
//! manager's current version, `~/.local/bin`, the cargo and bun bins, WinGet's links, scoop's
//! shims), so an agent is still offered when Kolux was started from the desktop with a short PATH. A folder or a
//! plain file bearing the name does not count. Nothing is spawned to look: the folders are walked
//! directly, and a lookup that fails for any reason reads as "not installed".
//!
//! Each entry carries the start line its own command line expects; the no-prompt switches are
//! spelled exactly as COMPAT.md (SESS-027) records them. Ids are the stable ones of SESS-001; the
//! menu order is the catalogue numbering of SESS-001.

use std::path::{Path, PathBuf};

// ORCH-060: the session tab inventory (T-262).
#[path = "inventory.rs"]
pub mod inventory;

#[derive(Clone, Debug, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentInfo {
    /// Stable id the front end uses: `claude`, `codex`, ...
    pub id: String,
    /// What the menu shows.
    pub name: String,
    /// The program name that decides whether it is installed (SESS-051): the one that was found,
    /// else the first of the agent's names.
    pub program: String,
    /// Built-in start arguments (SESS-027, SESS-051).
    pub args: Vec<String>,
    pub installed: bool,
    /// Where the program was found, when it was.
    pub path: Option<String>,
    /// SESS-017: Kolux knows the agent's own documentation page (`install_page`).
    pub docs: bool,
}

/// id, name, program names (the first is the main one, the rest also count), fixed arguments.
type Entry = (&'static str, &'static str, &'static [&'static str], &'static [&'static str]);

/// DT-C46: what Codex starts with under Yolo: no approval prompts, but its sandbox still keeps writes
/// inside the project folder. Never the flag that turns the sandbox off.
const CODEX_YOLO: &[&str] = &["--sandbox", "workspace-write", "--ask-for-approval", "never"];

/// The 34 visible agents in SESS-001 order. Claude Agent Teams (SESS-042) is skipped
/// (DECISIONS.md), and OpenCode is retired (SESS-043).
pub const CATALOGUE: [Entry; 34] = [
    ("claude", "Claude Code", &["claude"], &["--permission-mode", "auto"]),
    ("openclaude", "OpenClaude", &["openclaude"], &[]),
    ("codex", "Codex", &["codex"], CODEX_YOLO),
    ("autohand", "Autohand Code", &["autohand"], &[]),
    ("ante", "Ante", &["ante"], &[]),
    // `traecli`, not `trae`: an unrelated tool ships a program with the near-identical name.
    ("trae", "Trae", &["traecli"], &[]),
    ("mimo-code", "MiMo Code", &["mimo"], &[]),
    ("pi", "Pi", &["pi"], &[]),
    ("omp", "OMP", &["omp"], &[]),
    ("prime-agent", "Prime Agent", &["prime-agent"], &[]),
    ("gemini", "Gemini CLI", &["gemini"], &[]),
    ("antigravity", "Antigravity", &["agy"], &[]),
    ("aider", "Aider", &["aider"], &[]),
    ("goose", "Goose", &["goose"], &[]),
    ("amp", "Amp", &["amp"], &[]),
    ("kilo", "Kilo Code", &["kilo"], &[]),
    // Kiro lands on its chat screen directly.
    ("kiro", "Kiro", &["kiro-cli"], &["chat", "--tui"]),
    ("crush", "Crush", &["crush"], &[]),
    ("aug", "Auggie", &["auggie"], &[]),
    ("cline", "Cline", &["cline"], &[]),
    ("codebuff", "Codebuff", &["codebuff"], &[]),
    // `--trust` so the first-run folder question cannot swallow a prompt; the full name because
    // the short alias clashes with the Windows command shell.
    ("command-code", "Command Code", &["command-code"], &["--trust"]),
    // `cn`: the plain word is a shell keyword.
    ("continue", "Continue", &["cn"], &[]),
    ("cursor", "Cursor", &["cursor-agent"], &[]),
    ("droid", "Droid", &["droid"], &[]),
    // `kimi-code` is the name its launcher turns into.
    ("kimi", "Kimi", &["kimi", "kimi-code"], &[]),
    // `mistral-vibe` is what older installs are called; both are the one agent.
    ("mistral-vibe", "Mistral Vibe", &["vibe", "mistral-vibe"], &[]),
    ("qwen-code", "Qwen Code", &["qwen"], &[]),
    ("rovo", "Rovo Dev", &["rovo"], &[]),
    // Hermes's full-screen interface rather than its plain line mode.
    ("hermes", "Hermes", &["hermes"], &["--tui"]),
    ("openclaw", "OpenClaw", &["openclaw"], &[]),
    ("copilot", "GitHub Copilot", &["copilot"], &[]),
    ("grok", "Grok", &["grok"], &[]),
    ("devin", "Devin", &["devin"], &[]),
];

/// The catalogue with each agent's installed state, in menu order.
pub fn catalogue() -> Vec<AgentInfo> {
    let dirs = search_dirs();
    CATALOGUE
        .iter()
        .map(|(id, name, programs, args)| {
            let found = programs.iter().find_map(|p| find_in(&dirs, p).map(|f| (*p, f)));
            AgentInfo {
                id: id.to_string(),
                name: name.to_string(),
                program: found.as_ref().map(|(p, _)| *p).unwrap_or(programs[0]).to_string(),
                args: args.iter().map(|a| a.to_string()).collect(),
                installed: found.is_some(),
                path: found.map(|(_, f)| f.display().to_string()),
                docs: install_page(id).is_some(),
            }
        })
        .collect()
}

/// Finds `name` the way the command line does, on the PATH and then in the usual install folders.
/// `None` when nothing runnable matches.
pub fn find_program(name: &str) -> Option<PathBuf> {
    let candidate = Path::new(name);
    if candidate.components().count() > 1 {
        return runnable(candidate).then(|| candidate.to_path_buf());
    }
    find_in(&search_dirs(), name)
}

/// Finds `name` in `dirs`, in order. On Windows each PATHEXT ending is tried (`claude` matches
/// `claude.exe` or `claude.cmd`, never a plain `claude`); elsewhere the file must be executable.
pub fn find_in(dirs: &[PathBuf], name: &str) -> Option<PathBuf> {
    let exts: Vec<String> = if cfg!(windows) {
        let raw = std::env::var("PATHEXT").unwrap_or_else(|_| ".COM;.EXE;.BAT;.CMD".into());
        let mut v: Vec<String> = raw.split(';').filter(|e| !e.is_empty()).map(|e| e.to_lowercase()).collect();
        if Path::new(name).extension().is_some() {
            v.insert(0, String::new());
        }
        v
    } else {
        vec![String::new()]
    };
    dirs.iter().find_map(|dir| exts.iter().map(|ext| dir.join(format!("{name}{ext}"))).find(|file| runnable(file)))
}

/// A file that can be run: an ordinary file (a folder never counts) which, outside Windows, has
/// an execute bit. On Windows the ending decided already (`find_in` only tries PATHEXT ones).
fn runnable(file: &Path) -> bool {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        return file.metadata().map(|m| m.is_file() && m.permissions().mode() & 0o111 != 0).unwrap_or(false);
    }
    #[allow(unreachable_code)]
    file.is_file()
}

/// Where programs are looked for: the shell's search path, then every folder of this process's
/// PATH in order, then the usual install folders, each folder once. Folders that do not exist are
/// kept out so nothing is walked twice.
pub fn search_dirs() -> Vec<PathBuf> {
    let mut dirs = shell_path_dirs();
    dirs.extend(std::env::var_os("PATH").map(|p| std::env::split_paths(&p).collect::<Vec<_>>()).unwrap_or_default());
    dirs.extend(usual_dirs());
    let mut seen = std::collections::HashSet::new();
    dirs.into_iter()
        .filter(|d| !d.as_os_str().is_empty() && d.is_dir())
        .filter(|d| seen.insert(d.to_string_lossy().trim_end_matches(['\\', '/']).to_lowercase()))
        .collect()
}

#[cfg(windows)]
const MACHINE_ENVIRONMENT: &str = r"SYSTEM\CurrentControlSet\Control\Session Manager\Environment";

/// The search path a shell opened now would get: on Windows the machine Path then the user Path
/// from the registry, the way the system builds a new process's PATH, expanded. A read that
/// fails gives nothing and the process PATH stands alone. Elsewhere the process PATH is it.
fn shell_path_dirs() -> Vec<PathBuf> {
    #[cfg(windows)]
    {
        use windows_sys::Win32::System::Registry::{HKEY_CURRENT_USER, HKEY_LOCAL_MACHINE};
        let found: Vec<String> = [(HKEY_LOCAL_MACHINE, MACHINE_ENVIRONMENT), (HKEY_CURRENT_USER, "Environment")]
            .into_iter()
            .filter_map(|(root, key)| registry_string(root, key, "Path"))
            .collect();
        // STAT-004: an unreadable shell environment falls back to the inherited PATH, with a warning.
        if found.is_empty() {
            eprintln!("kolux-rs: the shell's search path could not be read; using the inherited PATH");
        }
        return found.iter().flat_map(|p| std::env::split_paths(p).collect::<Vec<_>>()).collect();
    }
    #[allow(unreachable_code)]
    Vec::new()
}

/// One string value from the registry, a `%VAR%` reference expanded. `None` when the key or the
/// value is missing, is not a string, or cannot be read.
#[cfg(windows)]
fn registry_string(root: windows_sys::Win32::System::Registry::HKEY, subkey: &str, value: &str) -> Option<String> {
    use windows_sys::Win32::Foundation::ERROR_MORE_DATA;
    use windows_sys::Win32::System::Registry::{RegGetValueW, RRF_RT_REG_SZ};
    let wide = |s: &str| s.encode_utf16().chain(std::iter::once(0)).collect::<Vec<u16>>();
    let (key, name) = (wide(subkey), wide(value));
    let mut bytes: u32 = 0;
    // SAFETY: the strings are NUL-terminated and outlive the calls; the first call only asks
    // the size, the second gets a buffer of that many bytes (the API expands %VAR%s when asked
    // for a plain string, and reports a bigger size with ERROR_MORE_DATA if the estimate fell
    // short, so the second call is retried once more with the size it names).
    unsafe {
        let ask = |buf: *mut u16, bytes: &mut u32| {
            RegGetValueW(root, key.as_ptr(), name.as_ptr(), RRF_RT_REG_SZ, std::ptr::null_mut(), buf.cast(), bytes)
        };
        if ask(std::ptr::null_mut(), &mut bytes) != 0 {
            return None;
        }
        let mut buf = vec![0u16; bytes as usize / 2 + 1];
        let mut got = (buf.len() * 2) as u32;
        let mut status = ask(buf.as_mut_ptr(), &mut got);
        if status == ERROR_MORE_DATA {
            buf = vec![0u16; got as usize / 2 + 1];
            got = (buf.len() * 2) as u32;
            status = ask(buf.as_mut_ptr(), &mut got);
        }
        if status != 0 {
            return None;
        }
        let len = buf.iter().position(|&c| c == 0).unwrap_or(buf.len());
        Some(String::from_utf16_lossy(&buf[..len]))
    }
}

fn env_dir(var: &str) -> Option<PathBuf> {
    std::env::var_os(var).filter(|v| !v.is_empty()).map(PathBuf::from)
}

/// The install folders agents land in when their installer does not touch the PATH that a
/// desktop-launched app sees.
fn usual_dirs() -> Vec<PathBuf> {
    let home = env_dir(if cfg!(windows) { "USERPROFILE" } else { "HOME" });
    let mut out = Vec::new();
    if let Some(h) = &home {
        for rel in [".local/bin", ".cargo/bin", ".bun/bin", ".volta/bin", ".npm-global/bin"] {
            out.push(h.join(rel));
        }
    }
    if cfg!(windows) {
        if let Some(app) = env_dir("APPDATA") {
            out.push(app.join("npm"));
            // nvm-windows: the version in use is a link folder (NVM_SYMLINK); else its newest version.
            out.extend(env_dir("NVM_SYMLINK"));
            out.extend(env_dir("NVM_HOME").or_else(|| Some(app.join("nvm"))).and_then(|n| newest_version_dir(&n)));
        }
        if let Some(local) = env_dir("LOCALAPPDATA") {
            out.push(local.join("Microsoft").join("WinGet").join("Links"));
            if let Ok(rd) = std::fs::read_dir(local.join("Programs")) {
                out.extend(rd.flatten().map(|e| e.path()));
            }
        }
        if let Some(h) = &home {
            out.push(h.join("scoop").join("shims"));
        }
        if let Some(pf) = env_dir("ProgramFiles") {
            out.push(pf.join("nodejs"));
        }
    } else {
        if let Some(h) = &home {
            // nvm: the default alias names the version in use; else the newest one installed.
            let versions = h.join(".nvm").join("versions").join("node");
            let default = std::fs::read_to_string(h.join(".nvm").join("alias").join("default"))
                .ok()
                .map(|s| versions.join(s.trim()).join("bin"))
                .filter(|d| d.is_dir());
            out.extend(default.or_else(|| newest_version_dir(&versions).map(|v| v.join("bin"))));
        }
        for p in ["/usr/local/bin", "/opt/homebrew/bin"] {
            out.push(PathBuf::from(p));
        }
    }
    out
}

/// The `vMAJOR.MINOR.PATCH` child of `parent` with the highest version (numeric, so `v20.1.0`
/// beats `v9.9.9`). `None` when there is none.
pub fn newest_version_dir(parent: &Path) -> Option<PathBuf> {
    let version = |name: &str| -> Option<(u64, u64, u64)> {
        let mut it = name.strip_prefix('v')?.split('.').map(|n| n.parse::<u64>().ok());
        Some((it.next()??, it.next()??, it.next()??))
    };
    std::fs::read_dir(parent)
        .ok()?
        .flatten()
        .filter(|e| e.path().is_dir())
        .filter_map(|e| version(&e.file_name().to_string_lossy()).map(|v| (v, e.path())))
        .max_by_key(|(v, _)| *v)
        .map(|(_, p)| p)
}

#[tauri::command]
pub fn agent_list() -> Vec<AgentInfo> {
    catalogue()
}

/// A start line built for one seat (SESS-051): the arguments after the program, and a prompt
/// that is typed in once the agent is ready (SESS-032) instead of being passed on the line.
#[derive(Clone, Debug, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StartLine {
    pub args: Vec<String>,
    pub typed: Option<String>,
    /// SET-027: the user's command in place of the agent's program, when one is set.
    pub program: Option<String>,
    /// SET-027: the user's default environment variables for this agent.
    pub env: Vec<(String, String)>,
    /// SESS-030 / TERM-107 (T-066-c): the line carries the agent's own resume form, so a restored
    /// tab comes back on its conversation; false marks it "restored without resume".
    pub resumed: bool,
}

/// How an agent takes its opening prompt (SESS-051).
enum Route {
    /// As the last argument.
    Trailing,
    /// Behind an end-of-options `--`, so a prompt that starts with a dash or reads like a
    /// subcommand is still the task.
    DashDash,
    /// Behind a named switch.
    Flag(&'static str),
    /// Hermes's own query route: `chat --query <p> --tui`.
    Hermes,
    /// Typed in once the agent is ready; the agent starts bare.
    Typed,
}

fn route(id: &str) -> Route {
    match id {
        "claude" | "openclaude" | "codex" | "pi" | "omp" | "command-code" | "cursor" | "droid" => Route::Trailing,
        "trae" | "prime-agent" | "grok" => Route::DashDash,
        "mimo-code" => Route::Flag("--prompt"),
        "gemini" | "antigravity" => Route::Flag("--prompt-interactive"),
        // The one-letter interactive switch: plain `--prompt` quits once the task is done.
        "copilot" => Route::Flag("-i"),
        "hermes" => Route::Hermes,
        _ => Route::Typed,
    }
}

/// Hermes refuses a start line past about this many characters (SESS-005).
const HERMES_LIMIT: usize = 24_000;

/// The start line for agent `id`: its fixed arguments, then `extra` (the user's default
/// arguments and the seat's model choice), then the opening prompt by the agent's own route.
/// A blank prompt counts as none. Hermes's query and interface-mode arguments in `extra` give
/// way to Kolux's, and a Hermes line over the limit is refused.
#[cfg(test)]
pub fn start_args(id: &str, extra: &[String], prompt: &str) -> Result<StartLine, String> {
    line_for(id, None, true, extra, &[], prompt)
}

/// SESS-030: whether a start line opens a fresh conversation or brings a saved one back after a
/// quit or a crash. Only a restore ever carries a resume form, so a plain new tab never resumes.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Start<'a> {
    Fresh,
    /// The tab's last known session id, when the agent's own hook events supplied one.
    Restore(Option<&'a str>),
}

/// SESS-030 (council FIX-BEFORE on T-066-c): a session id that can safely follow a resume flag:
/// a letter or digit first, then letters, digits, `.`, `_`, `:` or `-`, 100 characters at
/// most. A leading dash would be read as an option (one that turns a sandbox off, say), a path
/// separator would load another transcript, and a space or a shell character such as `&` could
/// reach cmd.exe through an npm `.cmd` shim.
pub fn safe_session(sid: &str) -> bool {
    let mut chars = sid.chars();
    sid.len() <= 100 && chars.next().is_some_and(|c| c.is_ascii_alphanumeric()) && chars.all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | ':' | '-'))
}

/// SESS-030 (T-066, T-066-b): the agent's own resume command, as the arguments that follow its
/// standing start line. Each form comes from the tool's public command-line reference (the
/// installed `--help` for Claude Code and Codex, the vendor's documentation for the rest; the
/// pages are named in PROVENANCE.md and evidence/T-066-b.txt). Rules:
/// - only a known id resumes the agents whose bare form opens a pick-a-session screen or the
///   latest session wherever it ran (Claude Code, Codex, Copilot, Cursor, Gemini CLI, Devin, Droid,
///   Kimi, Pi, Mistral Vibe, Qwen Code, Hermes, Grok, Goose, Amp, Antigravity, OpenClaw); without
///   an id they start fresh at their prompt;
/// - Kiro and Aider also have a form that continues the folder's own last conversation and
///   starts fresh when the folder has none, so a restore uses it even without an id;
/// - an agent with no documented resume form comes back at its prompt (T-066-c lists them).
///
/// The arguments reach the program as a list through the pty layer. A session id comes from a
/// settings file or a hook event, so it is checked here, the one place every resume passes: only
/// an id that looks like one ([`safe_session`]) is used; anything else counts as no id.
pub fn resume_args(id: &str, session: Option<&str>) -> Vec<String> {
    let s = |v: &[&str]| v.iter().map(|a| a.to_string()).collect::<Vec<String>>();
    match (id, session.filter(|sid| safe_session(sid))) {
        ("claude", Some(sid)) => s(&["--resume", sid]),
        ("codex", Some(sid)) => s(&["resume", sid]),
        // `--resume` takes its value with `=` in these two: the bare flag means "pick one".
        ("copilot" | "cursor", Some(sid)) => vec![format!("--resume={sid}")],
        ("gemini" | "devin" | "droid" | "mistral-vibe" | "qwen-code" | "hermes" | "grok", Some(sid)) => s(&["--resume", sid]),
        ("antigravity", Some(sid)) => s(&["--conversation", sid]),
        ("kimi" | "pi", Some(sid)) => s(&["--session", sid]),
        ("goose", Some(sid)) => s(&["session", "--resume", "--session-id", sid]),
        ("amp", Some(sid)) => s(&["threads", "continue", sid]),
        ("openclaw", Some(sid)) => s(&["resume", sid]),
        ("kiro", Some(sid)) => s(&["--resume-id", sid]),
        // Folder-scoped continue forms (no id): Kiro's `chat --resume` and Aider's chat-history
        // restore pick up the folder's own last conversation and start fresh when there is none.
        ("kiro", None) => s(&["--resume"]),
        ("aider", _) => s(&["--restore-chat-history"]),
        _ => Vec::new(),
    }
}

/// SET-027: the built-in arguments that skip an agent's permission prompts; Manual leaves them out.
/// ponytail: only the agents whose CLI already starts this way here; the others' switches wait
/// with the no-prompt task in PLAN.md.
fn prompt_skips(id: &str) -> &'static [&'static str] {
    match id {
        "claude" => &["--permission-mode", "auto"],
        "codex" => CODEX_YOLO,
        _ => &[],
    }
}

/// `start_args` with the user's own default arguments (`own`, which replace the built-in ones and
/// are left alone by the permission mode) and the mode: `yolo` false drops the prompt-skipping ones.
/// `resume` (SESS-030) comes after `extra` and before the prompt.
fn line_for(id: &str, own: Option<&[String]>, yolo: bool, extra: &[String], resume: &[String], prompt: &str) -> Result<StartLine, String> {
    let (_, _, _, fixed) = CATALOGUE.iter().find(|e| e.0 == id).ok_or_else(|| format!("Unknown agent {id}"))?;
    let prompt = prompt.trim();
    let skips = if yolo { &[][..] } else { prompt_skips(id) };
    let mut args: Vec<String> = match own {
        Some(own) => own.to_vec(),
        None => fixed.iter().filter(|a| !skips.contains(a)).map(|a| a.to_string()).collect(),
    };
    let mut typed = None;
    match route(id) {
        Route::Hermes => {
            let mut keep = Vec::new();
            let mut it = extra.iter();
            while let Some(a) = it.next() {
                match a.as_str() {
                    "--query" | "-q" => {
                        it.next();
                    }
                    "--tui" | "--no-tui" => {}
                    _ => keep.push(a.clone()),
                }
            }
            if !prompt.is_empty() {
                args = vec!["chat".into(), "--query".into(), prompt.into(), "--tui".into()];
            }
            args.extend(keep);
            args.extend(resume.iter().cloned());
            let len = "hermes".len() + args.iter().map(|a| a.len() + 1).sum::<usize>();
            if len > HERMES_LIMIT {
                return Err(format!("Hermes's start line with this prompt is {len} characters, past the 24,000 it accepts; shorten the prompt."));
            }
        }
        r => {
            args.extend(extra.iter().cloned());
            args.extend(resume.iter().cloned());
            if !prompt.is_empty() {
                match r {
                    Route::Trailing => args.push(prompt.into()),
                    Route::DashDash => args.extend(["--".to_string(), prompt.into()]),
                    Route::Flag(f) => args.extend([f.to_string(), prompt.into()]),
                    Route::Typed => typed = Some(prompt.to_string()),
                    Route::Hermes => unreachable!(),
                }
            }
        }
    }
    Ok(StartLine { args, typed, program: None, env: Vec::new(), resumed: !resume.is_empty() })
}

/// Settings fields of the Agents page (SET-027).
pub const OPTIONS_FIELD: &str = "agentOptions";
pub const PERMISSIONS_FIELD: &str = "agentPermissions";

/// Splits typed arguments on spaces, keeping a "double-quoted part" together.
pub fn split_args(typed: &str) -> Vec<String> {
    let (mut out, mut cur, mut quoted, mut any) = (Vec::new(), String::new(), false, false);
    for c in typed.chars() {
        match c {
            '"' => {
                quoted = !quoted;
                any = true;
            }
            c if c.is_whitespace() && !quoted => {
                if any {
                    out.push(std::mem::take(&mut cur));
                    any = false;
                }
            }
            c => {
                cur.push(c);
                any = true;
            }
        }
    }
    if any {
        out.push(cur);
    }
    out
}

/// `NAME=value` lines; blank lines and lines with no name are skipped.
pub fn parse_env(typed: &str) -> Vec<(String, String)> {
    typed.lines().filter_map(|l| l.trim().split_once('=')).filter(|(k, _)| !k.trim().is_empty()).map(|(k, v)| (k.trim().to_string(), v.trim().to_string())).collect()
}

/// SESS-029: what Claude Code starts with when nothing was picked for it: its top model at high effort.
const CLAUDE_UNPICKED: [&str; 4] = ["--model", "opus", "--effort", "high"];

/// Whether a list of arguments already names a model or an effort.
fn names_model(args: &[String]) -> bool {
    args.iter().any(|a| ["--model", "--effort"].iter().any(|f| a == f || a.starts_with(&format!("{f}="))))
}

/// The start line with the saved Agents page options applied: the permission mode (anything but
/// `manual` is Yolo), and this agent's command, default arguments and environment. `picked` says
/// the user chose the model in the lineup (even "Program default"); otherwise Claude Code gets
/// its top model at high effort unless its own or the extra arguments already name one.
/// The command path goes through `start_line_as`; this plain form is the tests's shorthand.
#[cfg(test)]
pub fn start_line(settings: &serde_json::Value, id: &str, extra: &[String], prompt: &str, picked: bool) -> Result<StartLine, String> {
    start_line_as(settings, id, extra, prompt, picked, Start::Fresh)
}

/// `start_line` for a fresh tab or a restored one (SESS-030): a restore adds the agent's own
/// resume form after the extra arguments. The restore path passes no resume of its own (T-066-c),
/// so the form is only ever added here, once.
pub fn start_line_as(settings: &serde_json::Value, id: &str, extra: &[String], prompt: &str, picked: bool, start: Start<'_>) -> Result<StartLine, String> {
    let yolo = settings.get(PERMISSIONS_FIELD).and_then(|v| v.as_str()) != Some("manual");
    let resume = match start {
        Start::Fresh => Vec::new(),
        Start::Restore(session) => resume_args(id, session),
    };
    let mine = settings.get(OPTIONS_FIELD).and_then(|o| o.get(id));
    let field = |k: &str| mine.and_then(|m| m.get(k)).and_then(|v| v.as_str()).map(str::trim).filter(|v| !v.is_empty());
    let own = field("args").map(split_args);
    let mut extra = extra.to_vec();
    if !picked && id == "claude" && !names_model(own.as_deref().unwrap_or(&[])) && !names_model(&extra) {
        extra.splice(0..0, CLAUDE_UNPICKED.iter().map(|a| a.to_string()));
    }
    let mut line = line_for(id, own.as_deref(), yolo, &extra, &resume, prompt)?;
    line.program = field("command").map(str::to_string);
    line.env = field("env").map(parse_env).unwrap_or_default();
    Ok(line)
}

/// The agent credited with a running program, from its command line (SESS-051): letter case,
/// the folder part and Windows endings are ignored; second names count; Codex and Grok builds
/// named `codex-…` / `grok-…` count; a program run through a script interpreter is credited by
/// its entry script's name or folder. A running `claude` is always Claude Code itself.
// ponytail: no per-agent entry-script table; under an interpreter any path part equal to a
// program name, or a package folder such as `claude-code`, credits the agent. Widen if a
// foreground poll is ever built (DT-C11: there is none; the pane's own program and the hooks
// decide who is in front).
// Callers: `tools::credited_program` (the one reader of a spawn program: the pane mark, the account
// and key variables, the peers list, the inventory and the context cap all go through it) and
// `foreground.rs` (a running process's image name or command line). Nothing else calls it; a test
// in tools.rs fails if another file does.
pub fn credited_agent(command_line: &str) -> Option<&'static str> {
    let line = command_line.trim_start();
    let (first, rest) = match line.strip_prefix('"').and_then(|r| r.split_once('"')) {
        Some((q, rest)) => (q, rest),
        None => line.split_once(char::is_whitespace).unwrap_or((line, "")),
    };
    if first.is_empty() {
        return None;
    }
    let name = program_stem(first);
    if let Some(id) = credited_name(&name, false) {
        return Some(id);
    }
    const INTERPRETERS: [&str; 6] = ["node", "bun", "deno", "python", "python3", "pwsh"];
    if !INTERPRETERS.contains(&name.as_str()) {
        return None;
    }
    rest.split_whitespace()
        .flat_map(|w| w.split(['\\', '/']))
        .find_map(|part| credited_name(&program_stem(part), true))
}

/// The bare lower-case name of a program word: no folder, no quotes, no program/script ending.
fn program_stem(word: &str) -> String {
    let base = word.trim_matches('"').rsplit(['\\', '/']).next().unwrap_or("").to_ascii_lowercase();
    for ext in [".exe", ".cmd", ".bat", ".com", ".ps1", ".js", ".mjs", ".cjs", ".py"] {
        if let Some(stem) = base.strip_suffix(ext) {
            return stem.to_string();
        }
    }
    base
}

/// The catalogue id whose program names cover `stem`; with `packages`, `<name>-…` also counts
/// for every agent (an entry script's package folder), else only for Codex and Grok builds.
fn credited_name(stem: &str, packages: bool) -> Option<&'static str> {
    if stem.is_empty() {
        return None;
    }
    CATALOGUE.iter().find_map(|(id, _, names, _)| {
        let dashed = packages || matches!(*id, "codex" | "grok");
        names.iter().any(|n| *n == stem || (dashed && stem.strip_prefix(*n).is_some_and(|r| r.starts_with('-')))).then_some(*id)
    })
}

/// `restore` (SESS-030) marks a tab brought back after a quit or a crash; `session` is its last
/// known session id. Both are left out for a plain new tab, which never carries a resume form.
#[tauri::command]
pub fn agent_start_line(store: tauri::State<'_, std::sync::Mutex<crate::state::Store>>, id: String, extra: Vec<String>, prompt: String, picked: Option<bool>, restore: Option<bool>, session: Option<String>) -> Result<StartLine, String> {
    let settings = store.lock().map_err(|e| e.to_string())?.settings();
    let start = if restore.unwrap_or(false) { Start::Restore(session.as_deref().map(str::trim).filter(|s| !s.is_empty())) } else { Start::Fresh };
    start_line_as(&settings, &id, &extra, &prompt, picked.unwrap_or(false), start)
}

/// ACCT-013 "Open install page": the agent's own install page in the default browser. Only these
/// fixed addresses are ever opened.
pub fn install_page(agent: &str) -> Option<&'static str> {
    // SESS-017 (T-201-c): each address checked against the agent's own site or repository on
    // 2026-10-13. Trae has none yet: no official TRAE CLI page could be found (T-201-d).
    match agent {
        "claude" => Some("https://code.claude.com/docs/en/setup"),
        "codex" => Some("https://developers.openai.com/codex/cli"),
        "grok" => Some("https://x.ai/cli"),
        "openclaude" => Some("https://github.com/Twigpine/openclaude"),
        "autohand" => Some("https://docs.autohand.ai/guides/cli-quick-start"),
        "ante" => Some("https://docs.antigma.ai/"),
        "mimo-code" => Some("https://mimo.xiaomi.com/mimocode/install"),
        "pi" => Some("https://github.com/earendil-works/pi"),
        "omp" => Some("https://github.com/can1357/oh-my-pi"),
        "prime-agent" => Some("https://github.com/PrimeIntellect-ai/prime-agent"),
        "gemini" => Some("https://geminicli.com/docs/"),
        "antigravity" => Some("https://antigravity.google/docs/getting-started?tab=cli"),
        "aider" => Some("https://aider.chat/docs/install.html"),
        "goose" => Some("https://goose-docs.ai/docs/getting-started/installation"),
        "amp" => Some("https://ampcode.com/docs"),
        "kilo" => Some("https://kilo.ai/docs/code-with-ai/platforms/cli"),
        "kiro" => Some("https://kiro.dev/docs/cli/"),
        "crush" => Some("https://github.com/charmbracelet/crush"),
        "aug" => Some("https://docs.augmentcode.com/cli/overview"),
        "cline" => Some("https://docs.cline.bot/usage/cli-overview"),
        "codebuff" => Some("https://www.codebuff.com/docs/help/quick-start"),
        "command-code" => Some("https://commandcode.ai/docs"),
        "continue" => Some("https://docs.continue.dev/cli/overview"),
        "cursor" => Some("https://cursor.com/docs/cli/overview"),
        "droid" => Some("https://docs.factory.com/droid-cli/quickstart"),
        "kimi" => Some("https://www.kimi.com/code/docs/en/kimi-code-cli/guides/getting-started"),
        "mistral-vibe" => Some("https://github.com/mistralai/mistral-vibe"),
        "qwen-code" => Some("https://github.com/QwenLM/qwen-code"),
        "rovo" => Some("https://support.atlassian.com/rovo/docs/install-and-run-rovo-dev-cli-on-your-device/"),
        "hermes" => Some("https://github.com/NousResearch/hermes-agent"),
        "openclaw" => Some("https://docs.openclaw.ai/"),
        "copilot" => Some("https://docs.github.com/en/copilot/how-tos/copilot-cli/set-up-copilot-cli/install-copilot-cli"),
        "devin" => Some("https://docs.devin.ai/cli"),
        _ => None,
    }
}

#[tauri::command]
pub fn open_install_page(agent: String) -> Result<(), String> {
    let url = install_page(&agent).ok_or_else(|| format!("No install page is known for {agent}."))?;
    #[cfg(windows)]
    let opener = "explorer.exe";
    #[cfg(target_os = "macos")]
    let opener = "open";
    #[cfg(all(unix, not(target_os = "macos")))]
    let opener = "xdg-open";
    std::process::Command::new(opener).arg(url).spawn().map(|_| ()).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_dir(tag: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("kolux-rs-agents-{tag}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn runnable_file(path: &Path) {
        std::fs::write(path, b"").unwrap();
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o755)).unwrap();
        }
    }


    fn s(v: &[&str]) -> Vec<String> {
        v.iter().map(|x| x.to_string()).collect()
    }

    #[test]
    fn sess_017_every_catalogue_agent_but_trae_links_to_its_own_page() {
        for (id, ..) in CATALOGUE {
            let page = install_page(id);
            assert_eq!(page.is_some(), id != "trae", "{id}");
            assert!(page.is_none_or(|p| p.starts_with("https://") && !p.contains(' ')), "{id}: {page:?}");
        }
        assert!(catalogue().iter().all(|a| a.docs == install_page(&a.id).is_some()));
    }

    #[test]
    fn set027_options_and_permission_mode_shape_the_start_line() {
        let none = serde_json::json!({});
        let yolo = start_line(&none, "claude", &[], "go", true).unwrap();
        assert_eq!(yolo.args, s(&["--permission-mode", "auto", "go"]));
        assert_eq!((yolo.program, yolo.env.len()), (None, 0));
        // Manual drops the prompt-skipping arguments and keeps the rest
        let manual = serde_json::json!({ "agentPermissions": "manual" });
        assert_eq!(start_line(&manual, "claude", &[], "go", true).unwrap().args, s(&["go"]));
        assert_eq!(start_line(&manual, "codex", &[], "", false).unwrap().args, Vec::<String>::new());
        assert_eq!(start_line(&manual, "kiro", &[], "", false).unwrap().args, s(&["chat", "--tui"]));
        // the user's own arguments replace the built-in ones, whatever the mode
        let own = serde_json::json!({ "agentPermissions": "manual", "agentOptions": { "claude": { "args": "--model opus --append-system-prompt \"be brief\"", "command": " C:/tools/claude.exe ", "env": "A=1\n\n=x\nB = two words\nnot a pair" } } });
        let line = start_line(&own, "claude", &s(&["--x"]), "go", false).unwrap();
        assert_eq!(line.args, s(&["--model", "opus", "--append-system-prompt", "be brief", "--x", "go"]));
        assert_eq!(line.program.as_deref(), Some("C:/tools/claude.exe"));
        assert_eq!(line.env, vec![("A".to_string(), "1".to_string()), ("B".to_string(), "two words".to_string())]);
        // a blank override counts as none
        let blank = serde_json::json!({ "agentOptions": { "codex": { "args": "  ", "command": "" } } });
        let codex = start_line(&blank, "codex", &[], "", false).unwrap();
        assert_eq!((codex.args, codex.program), (s(CODEX_YOLO), None));
        assert_eq!(split_args(r#"a "" b"#), s(&["a", "", "b"]));
    }

    #[test]
    fn sess029_unpicked_claude_gets_its_top_model_at_high_effort() {
        let none = serde_json::json!({});
        let line = start_line(&none, "claude", &[], "go", false).unwrap();
        assert_eq!(line.args, s(&["--permission-mode", "auto", "--model", "opus", "--effort", "high", "go"]));
        // an effort or a model already named, in the user's own arguments or the extra ones, wins
        let own = serde_json::json!({ "agentOptions": { "claude": { "args": "--effort=low" } } });
        assert_eq!(start_line(&own, "claude", &[], "", false).unwrap().args, s(&["--effort=low"]));
        assert_eq!(start_line(&none, "claude", &s(&["--model", "haiku"]), "", false).unwrap().args, s(&["--permission-mode", "auto", "--model", "haiku"]));
        // a pick in the lineup, even the program's own default, adds nothing; other agents get no model flag
        assert_eq!(start_line(&none, "claude", &[], "", true).unwrap().args, s(&["--permission-mode", "auto"]));
        assert_eq!(start_line(&none, "gemini", &[], "", false).unwrap().args.iter().filter(|a| a.as_str() == "--model").count(), 0);
    }

    #[test]
    fn sess051_trailing_prompt_comes_after_the_fixed_and_model_arguments() {
        let line = start_args("claude", &s(&["--model", "haiku"]), "Fix the build").unwrap();
        assert_eq!(line.args, s(&["--permission-mode", "auto", "--model", "haiku", "Fix the build"]));
        assert_eq!(line.typed, None);
        let codex = start_args("codex", &[], "Review").unwrap();
        assert_eq!(codex.args, s(&["--sandbox", "workspace-write", "--ask-for-approval", "never", "Review"]));
        assert_eq!(start_args("command-code", &[], "go").unwrap().args, s(&["--trust", "go"]));
    }

    #[test]
    fn dt_c46_codex_under_yolo_is_sandboxed_and_never_bypassed() {
        // every saved mode (no value, the two the Agents page writes, and any other one) and with or without a prompt
        let modes = [serde_json::json!({}), serde_json::json!({ "agentPermissions": "manual" }), serde_json::json!({ "agentPermissions": "auto" }), serde_json::json!({ "agentPermissions": "yolo" })];
        for set in &modes {
            for prompt in ["", "Review"] {
                let line = start_line(set, "codex", &[], prompt, false).unwrap();
                assert!(!line.args.iter().any(|a| a.contains("dangerously-bypass")), "{set} {prompt:?}: {:?}", line.args);
            }
        }
        assert!(!catalogue().iter().find(|a| a.id == "codex").unwrap().args.iter().any(|a| a.contains("dangerously-bypass")));
        // Yolo: exactly the sandbox and no-approval flags, then the prompt; Manual: neither
        let yolo = serde_json::json!({ "agentPermissions": "yolo" });
        assert_eq!(start_line(&yolo, "codex", &[], "Review", false).unwrap().args, s(&["--sandbox", "workspace-write", "--ask-for-approval", "never", "Review"]));
        let manual = serde_json::json!({ "agentPermissions": "manual" });
        assert_eq!(start_line(&manual, "codex", &[], "Review", false).unwrap().args, s(&["Review"]));
    }

    #[test]
    fn sess051_grok_trae_and_prime_agent_get_an_end_of_options_dash_before_the_prompt() {
        assert_eq!(start_args("grok", &[], "--help me out").unwrap().args, s(&["--", "--help me out"]));
        assert_eq!(start_args("trae", &[], "run").unwrap().args, s(&["--", "run"]));
        assert_eq!(start_args("prime-agent", &[], "chat").unwrap().args, s(&["--", "chat"]));
    }

    #[test]
    fn sess051_flag_routes_copilot_interactive_gemini_antigravity_prompt_interactive_mimo_prompt() {
        assert_eq!(start_args("copilot", &[], "Tidy up").unwrap().args, s(&["-i", "Tidy up"]));
        assert_eq!(start_args("gemini", &[], "Tidy up").unwrap().args, s(&["--prompt-interactive", "Tidy up"]));
        assert_eq!(start_args("antigravity", &[], "Tidy up").unwrap().args, s(&["--prompt-interactive", "Tidy up"]));
        assert_eq!(start_args("mimo-code", &[], "Tidy up").unwrap().args, s(&["--prompt", "Tidy up"]));
    }

    #[test]
    fn sess051_hermes_takes_its_query_route_once_and_refuses_an_overlong_line() {
        let line = start_args("hermes", &s(&["--no-tui", "--query", "old", "-x"]), "Explain").unwrap();
        assert_eq!(line.args, s(&["chat", "--query", "Explain", "--tui", "-x"]));
        assert_eq!(line.typed, None);
        assert_eq!(start_args("hermes", &s(&["-x"]), "").unwrap().args, s(&["--tui", "-x"]));
        let long = "x".repeat(24_000);
        let err = start_args("hermes", &[], &long).unwrap_err();
        assert!(err.contains("24,000"), "{err}");
        assert!(start_args("claude", &[], &long).is_ok(), "only Hermes has the limit");
    }

    #[test]
    fn sess051_typed_route_starts_bare_and_hands_the_prompt_over_for_later() {
        let aider = start_args("aider", &s(&["--model", "x"]), "Add tests").unwrap();
        assert_eq!(aider.args, s(&["--model", "x"]));
        assert_eq!(aider.typed.as_deref(), Some("Add tests"));
        let kiro = start_args("kiro", &[], "Hi").unwrap();
        assert_eq!(kiro.args, s(&["chat", "--tui"]));
        assert_eq!(kiro.typed.as_deref(), Some("Hi"));
        for id in ["ante", "devin", "kimi", "mistral-vibe", "continue"] {
            assert!(start_args(id, &[], "p").unwrap().typed.is_some(), "{id} is typed in");
        }
    }

    #[test]
    fn sess051_a_blank_prompt_counts_as_none_and_an_unknown_agent_is_refused() {
        let line = start_args("grok", &[], "   ").unwrap();
        assert_eq!(line.args, Vec::<String>::new());
        assert_eq!(line.typed, None);
        assert_eq!(start_args("aider", &[], "\n\t").unwrap().typed, None);
        assert!(start_args("nope", &[], "p").is_err());
    }

    #[test]
    fn sess051_foreground_matching_ignores_case_folder_and_windows_endings() {
        assert_eq!(credited_agent("CLAUDE.EXE"), Some("claude"));
        assert_eq!(credited_agent(r"C:\Users\t\AppData\Roaming\npm\codex.cmd --foo"), Some("codex"));
        assert_eq!(credited_agent(r#""C:\Program Files\Claude\claude.exe" --permission-mode auto"#), Some("claude"));
        assert_eq!(credited_agent("codex-x86_64-pc-windows-msvc.exe"), Some("codex"));
        assert_eq!(credited_agent("grok-cli"), Some("grok"));
        assert_eq!(credited_agent("kimi-code"), Some("kimi"), "second names count");
        assert_eq!(credited_agent("mistral-vibe.cmd"), Some("mistral-vibe"));
        assert_eq!(credited_agent("cn"), Some("continue"));
        assert_eq!(credited_agent("kiro"), None, "plain kiro is not Kiro");
        assert_eq!(credited_agent("powershell.exe"), None);
        assert_eq!(credited_agent("claude-teams"), None, "only Codex and Grok builds match by prefix");
        assert_eq!(credited_agent(""), None);
    }

    #[test]
    fn sess051_an_agent_run_through_an_interpreter_is_credited_by_its_entry_script() {
        assert_eq!(credited_agent(r"node C:\Users\t\AppData\Roaming\npm\node_modules\@anthropic-ai\claude-code\cli.js"), Some("claude"));
        assert_eq!(credited_agent("python -m aider --model x"), Some("aider"));
        assert_eq!(credited_agent("node /usr/lib/node_modules/@openai/codex/bin/codex.js"), Some("codex"));
        assert_eq!(credited_agent("node build.js"), None);
    }

    #[test]
    fn only_a_runnable_file_counts_not_a_plain_file_or_a_folder() {
        let dir = temp_dir("find");
        let exe = if cfg!(windows) { "kiro-cli.exe" } else { "kiro-cli" };
        runnable_file(&dir.join(exe));
        std::fs::write(dir.join("claude"), b"not a program").unwrap(); // no ending / no exec bit
        std::fs::create_dir(dir.join("codex.exe")).unwrap(); // a folder named like a program
        std::fs::create_dir(dir.join("gemini")).unwrap();
        let dirs = vec![dir.join("missing-folder"), dir.clone()];
        assert_eq!(find_in(&dirs, "kiro-cli"), Some(dir.join(exe)));
        assert_eq!(find_in(&dirs, "codex"), None);
        assert_eq!(find_in(&dirs, "gemini"), None);
        if cfg!(windows) {
            assert_eq!(find_in(&dirs, "claude"), None, "a plain file without a PATHEXT ending is not a program");
        }
        assert_eq!(find_in(&[], "kiro-cli"), None);
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn a_program_on_the_path_is_found_and_a_made_up_one_is_not() {
        // Git is required by the app and checked at startup, so it is on every PC the tests run on.
        let git = find_program("git").expect("git on PATH");
        assert!(git.is_file());
        assert!(git.file_stem().unwrap().to_string_lossy().eq_ignore_ascii_case("git"));
        assert_eq!(find_program("kolux-rs-no-such-program-7f3a"), None);
        assert!(search_dirs().iter().all(|d| d.is_dir()));
    }

    #[cfg(windows)]
    #[test]
    fn the_shell_search_path_comes_from_the_registry_expanded_and_is_walked() {
        // T-007-a-fix: the machine Path is a REG_EXPAND_SZ holding %SystemRoot%\system32; it
        // must come back expanded. A value that does not exist reads as nothing.
        use windows_sys::Win32::System::Registry::{HKEY_CURRENT_USER, HKEY_LOCAL_MACHINE};
        let machine = registry_string(HKEY_LOCAL_MACHINE, MACHINE_ENVIRONMENT, "Path").expect("machine Path");
        assert!(!machine.contains('%'), "not expanded: {machine}");
        assert!(machine.to_lowercase().contains("system32"), "{machine}");
        assert!(registry_string(HKEY_CURRENT_USER, "Environment", "Path").is_some());
        assert_eq!(registry_string(HKEY_CURRENT_USER, "Environment", "kolux-rs-no-such-value-7f3a"), None);
        let shell = shell_path_dirs();
        assert!(shell.iter().any(|d| d.to_string_lossy().to_lowercase().ends_with("system32")));
        let walked = search_dirs();
        for d in shell.iter().filter(|d| d.is_dir()) {
            assert!(walked.contains(d), "{} from the shell PATH is not walked", d.display());
        }
    }

    #[test]
    fn the_newest_node_version_folder_is_picked_numerically() {
        let dir = temp_dir("nvm");
        for v in ["v9.9.9", "v18.20.4", "v20.10.0", "vNext", "elevate.cmd"] {
            std::fs::create_dir(dir.join(v)).unwrap();
        }
        assert_eq!(newest_version_dir(&dir), Some(dir.join("v20.10.0")));
        assert_eq!(newest_version_dir(&dir.join("none")), None);
        std::fs::remove_dir_all(&dir).unwrap();
    }

    /// SESS-030 (T-066-b): every agent with a documented resume form, the arguments a restore with a
    /// known id adds after its standing start line; the fixed arguments stay in front.
    const RESUMED: [(&str, &[&str]); 19] = [
        ("claude", &["--resume", "sid"]),
        ("codex", &["resume", "sid"]),
        ("copilot", &["--resume=sid"]),
        ("cursor", &["--resume=sid"]),
        ("gemini", &["--resume", "sid"]),
        ("devin", &["--resume", "sid"]),
        ("droid", &["--resume", "sid"]),
        ("mistral-vibe", &["--resume", "sid"]),
        ("qwen-code", &["--resume", "sid"]),
        ("hermes", &["--resume", "sid"]),
        ("grok", &["--resume", "sid"]),
        ("antigravity", &["--conversation", "sid"]),
        ("kimi", &["--session", "sid"]),
        ("pi", &["--session", "sid"]),
        ("goose", &["session", "--resume", "--session-id", "sid"]),
        ("amp", &["threads", "continue", "sid"]),
        ("openclaw", &["resume", "sid"]),
        ("kiro", &["--resume-id", "sid"]),
        ("aider", &["--restore-chat-history"]),
    ];

    #[test]
    fn sess030_every_wired_agent_resumes_on_its_own_form_after_its_standing_line() {
        let none = serde_json::json!({});
        for (id, form) in RESUMED {
            let plain = start_line(&none, id, &[], "", true).unwrap().args;
            let restored = start_line_as(&none, id, &[], "", true, Start::Restore(Some("sid"))).unwrap().args;
            let mut want = plain.clone();
            want.extend(s(form));
            assert_eq!(restored, want, "{id}: the resume form follows the standing start line");
            // The user's own extra arguments (model choice, defaults) stay in front of the resume.
            let with_extra = start_line_as(&none, id, &s(&["--x"]), "", true, Start::Restore(Some("sid"))).unwrap().args;
            assert_eq!(with_extra, [plain.clone(), s(&["--x"]), s(form)].concat(), "{id}: extra before resume");
        }
        // Kiro keeps its fixed `chat --tui` in front of the resume; Hermes its `--tui`.
        assert_eq!(start_line_as(&none, "kiro", &[], "", true, Start::Restore(Some("sid"))).unwrap().args, s(&["chat", "--tui", "--resume-id", "sid"]));
        assert_eq!(start_line_as(&none, "hermes", &[], "", true, Start::Restore(Some("sid"))).unwrap().args, s(&["--tui", "--resume", "sid"]));
        // Claude Code keeps its permission mode and the unpicked model in front (T-066 shape).
        assert_eq!(
            start_line_as(&none, "claude", &[], "", false, Start::Restore(Some("sid"))).unwrap().args,
            s(&["--permission-mode", "auto", "--model", "opus", "--effort", "high", "--resume", "sid"])
        );
    }

    #[test]
    fn sess030_without_a_session_id_only_the_folder_scoped_forms_resume() {
        let none = serde_json::json!({});
        for (id, _) in RESUMED {
            let plain = start_line(&none, id, &[], "", true).unwrap().args;
            let restored = start_line_as(&none, id, &[], "", true, Start::Restore(None)).unwrap().args;
            match id {
                // Kiro's `chat --resume` and Aider's history restore pick up the folder's own last
                // conversation and start fresh when there is none.
                "kiro" => assert_eq!(restored, s(&["chat", "--tui", "--resume"])),
                "aider" => assert_eq!(restored, s(&["--restore-chat-history"])),
                // Everyone else would open a picker or someone else's latest session: start fresh.
                _ => assert_eq!(restored, plain, "{id}: no id, no resume"),
            }
        }
        assert!(resume_args("claude", None).is_empty(), "Claude Code's bare --resume opens its pick-a-session screen");
        assert!(resume_args("codex", None).is_empty());
    }

    #[test]
    fn sess030_a_plain_new_tab_never_carries_a_resume_form() {
        let none = serde_json::json!({});
        for (id, form) in RESUMED {
            let fresh = start_line_as(&none, id, &[], "", true, Start::Fresh).unwrap().args;
            assert_eq!(fresh, start_line(&none, id, &[], "", true).unwrap().args, "{id}: Fresh is the plain line");
            let first = form[0].split('=').next().unwrap();
            assert!(!fresh.iter().any(|a| a == first || a.starts_with(&format!("{first}="))), "{id}: no resume word on a new tab");
        }
        // The command's defaults: no `restore` means Fresh even when a session id is passed along.
        let fresh = start_line_as(&none, "gemini", &[], "", true, Start::Fresh).unwrap().args;
        assert_eq!(fresh, Vec::<String>::new());
    }

    #[test]
    fn sess030_an_id_or_folder_with_a_space_stays_one_argument_for_the_pty() {
        // The pty layer quotes each argument for the shell (pty.rs program_command), so the id is
        // one list element here, unquoted, spaces intact; the folder is the pane's cwd, never an argument.
        let none = serde_json::json!({});
        // Real ids (UUIDs, dated names) stay one list element, unquoted.
        let sid = "0b6c7e3a-4f2d-4b8e-9a51-2d3c4e5f6a7b";
        assert_eq!(resume_args("copilot", Some(sid)), vec![format!("--resume={sid}")]);
        assert_eq!(resume_args("gemini", Some("run_2026.10.13:a")), s(&["--resume", "run_2026.10.13:a"]));
        let line = start_line_as(&none, "devin", &[], "", true, Start::Restore(Some(sid))).unwrap().args;
        assert_eq!(line, s(&["--resume", sid]));
        assert!(line.iter().all(|a| !a.contains('"')), "no quotes added here");
        // A blank id counts as none.
        assert!(resume_args("gemini", Some("")).is_empty());
    }

    #[test]
    fn sess030_a_session_id_that_is_not_an_id_never_reaches_the_command_line() {
        // Council FIX-BEFORE (T-066-c): option injection, a transcript path, cmd.exe shim
        // characters, a space and an over-long id all count as no id, so the agent starts plain.
        let none = serde_json::json!({});
        let long = "a".repeat(101);
        for bad in ["x&calc", "--foo", "-c", "--dangerously-bypass-approvals-and-sandbox", "C:\\a.jsonl", "a/b", "a b", "a|b", "a^b", "\"a\"", "%PATH%", "", ".hidden", long.as_str()] {
            assert!(!safe_session(bad), "{bad}");
            for id in ["claude", "codex", "copilot", "gemini", "goose", "openclaw"] {
                assert!(resume_args(id, Some(bad)).is_empty(), "{id} {bad}");
                let line = start_line_as(&none, id, &[], "", true, Start::Restore(Some(bad))).unwrap();
                assert!(!line.resumed && line.args.iter().all(|a| a != bad && !a.ends_with(&format!("={bad}"))), "{id} {bad}: {:?}", line.args);
            }
            // The folder-scoped forms fall back to their no-id form, never the bad text.
            assert!(start_line_as(&none, "kiro", &[], "", true, Start::Restore(Some(bad))).unwrap().args.iter().all(|a| a != bad || bad.is_empty()));
        }
        assert!(safe_session(&"a".repeat(100)));
        assert!(safe_session("9f:2.x_y-z"));
    }

    #[test]
    fn sess030_a_restore_carries_its_resume_once_and_says_so() {
        // T-066-c: the restore path passes no resume of its own; the line carries it exactly once
        // and `resumed` drives the pane's "restored" / "restored without resume" mark (TERM-107).
        let none = serde_json::json!({});
        let claude = start_line_as(&none, "claude", &[], "", true, Start::Restore(Some("sid"))).unwrap();
        assert_eq!(claude.args, s(&["--permission-mode", "auto", "--resume", "sid"]));
        assert!(claude.resumed);
        let codex = start_line_as(&none, "codex", &[], "", true, Start::Restore(Some("sid"))).unwrap();
        assert_eq!(codex.args.iter().filter(|a| a.as_str() == "resume").count(), 1);
        assert!(codex.resumed);
        let copilot = start_line_as(&none, "copilot", &[], "", true, Start::Restore(Some("sid"))).unwrap();
        assert_eq!(copilot.args, s(&["--resume=sid"]));
        assert!(copilot.resumed);
        // Folder-scoped forms resume with no id; the id-only agents do not, and say so.
        assert!(start_line_as(&none, "aider", &[], "", true, Start::Restore(None)).unwrap().resumed);
        assert!(start_line_as(&none, "kiro", &[], "", true, Start::Restore(None)).unwrap().resumed);
        for id in ["claude", "codex", "gemini", "copilot"] {
            assert!(!start_line_as(&none, id, &[], "", true, Start::Restore(None)).unwrap().resumed, "{id}");
        }
        // An agent with no documented form is restored without resume even with an id.
        assert!(!start_line_as(&none, "crush", &[], "", true, Start::Restore(Some("sid"))).unwrap().resumed);
        // A plain new tab never resumes, even with a session id at hand.
        assert!(!start_line_as(&none, "claude", &[], "", true, Start::Fresh).unwrap().resumed);
    }

    #[test]
    fn sess030_the_restore_path_has_no_line_for_a_plain_shell() {
        // T-066-c: the restore loop asks only for tabs that name a catalogue agent; a plain shell
        // has no agent id, and an id outside the catalogue is refused, so its saved line stays.
        let none = serde_json::json!({});
        for id in ["shell", "", "pwsh", "cmd"] {
            assert!(start_line_as(&none, id, &[], "", true, Start::Restore(Some("sid"))).is_err(), "{id}");
        }
    }

    #[test]
    fn sess030_agents_without_a_documented_resume_form_come_back_at_their_prompt() {
        let none = serde_json::json!({});
        for id in ["crush", "cline", "aug", "trae", "openclaude", "autohand", "ante", "mimo-code", "omp", "prime-agent", "kilo", "codebuff", "command-code", "continue", "rovo"] {
            assert!(resume_args(id, Some("sid")).is_empty(), "{id}: no resume form wired");
            let plain = start_line(&none, id, &[], "", true).unwrap().args;
            assert_eq!(start_line_as(&none, id, &[], "", true, Start::Restore(Some("sid"))).unwrap().args, plain, "{id}: restored at its prompt");
        }
        // The resume form never lands inside an opening prompt's place: it comes before the prompt.
        let grok = start_line_as(&none, "grok", &[], "go", true, Start::Restore(Some("sid"))).unwrap().args;
        assert_eq!(grok, s(&["--resume", "sid", "--", "go"]));
    }

    #[test]
    fn the_catalogue_has_the_34_agents_in_sess_001_order_with_their_start_lines() {
        let list = catalogue();
        assert_eq!(list.len(), 34);
        let ids: Vec<&str> = list.iter().map(|a| a.id.as_str()).collect();
        assert_eq!(&ids[..3], &["claude", "openclaude", "codex"]);
        assert_eq!(ids[33], "devin");
        assert_eq!(ids.iter().collect::<std::collections::HashSet<_>>().len(), 34, "every id once");
        let by = |id: &str| list.iter().find(|a| a.id == id).unwrap();
        assert_eq!(by("claude").args, vec!["--permission-mode", "auto"]);
        assert_eq!(by("codex").args, vec!["--sandbox", "workspace-write", "--ask-for-approval", "never"]);
        assert_eq!(by("kiro").args, vec!["chat", "--tui"]);
        assert_eq!(by("command-code").args, vec!["--trust"]);
        assert_eq!(by("hermes").args, vec!["--tui"]);
        assert_eq!(by("trae").program, "traecli");
        assert_eq!(by("continue").program, "cn");
        assert_eq!(by("cursor").program, "cursor-agent");
        let names: Vec<&str> = CATALOGUE.iter().find(|e| e.0 == "mistral-vibe").unwrap().2.to_vec();
        assert_eq!(names, vec!["vibe", "mistral-vibe"]);
        for a in &list {
            assert_eq!(a.installed, a.path.is_some());
        }
    }
}
