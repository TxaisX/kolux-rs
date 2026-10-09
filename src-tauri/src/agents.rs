//! The agents Kolux can start (SESS-001, SESS-027, SESS-051). An agent is "installed" when a
//! program that can run is found under its program name: on the PATH first, the same lookup a
//! shell makes, then in the usual install folders (npm's global bin, a Node version manager's
//! current version, `~/.local/bin`, the cargo and bun bins, WinGet's links, scoop's shims), so an
//! agent is still offered when Kolux was started from the desktop with a short PATH. A folder or a
//! plain file bearing the name does not count. Nothing is spawned to look: the folders are walked
//! directly, and a lookup that fails for any reason reads as "not installed".
//!
//! Each entry carries the start line its own command line expects; the no-prompt switches are
//! spelled exactly as COMPAT.md (SESS-027) records them. Ids are the stable ones of SESS-001; the
//! menu order is the catalogue numbering of SESS-001.

use std::path::{Path, PathBuf};

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
}

/// id, name, program names (the first is the main one, the rest also count), fixed arguments.
type Entry = (&'static str, &'static str, &'static [&'static str], &'static [&'static str]);

/// The 34 visible agents in SESS-001 order. Claude Agent Teams (SESS-042) is skipped
/// (DECISIONS.md), and OpenCode is retired (SESS-043).
pub const CATALOGUE: [Entry; 34] = [
    ("claude", "Claude Code", &["claude"], &["--permission-mode", "auto"]),
    ("openclaude", "OpenClaude", &["openclaude"], &[]),
    ("codex", "Codex", &["codex"], &["--dangerously-bypass-approvals-and-sandbox"]),
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

/// Where programs are looked for: every PATH folder in order, then the usual install folders,
/// each folder once. Folders that do not exist are kept out so nothing is walked twice.
pub fn search_dirs() -> Vec<PathBuf> {
    let mut dirs: Vec<PathBuf> = std::env::var_os("PATH").map(|p| std::env::split_paths(&p).collect()).unwrap_or_default();
    dirs.extend(usual_dirs());
    let mut seen = std::collections::HashSet::new();
    dirs.into_iter()
        .filter(|d| !d.as_os_str().is_empty() && d.is_dir())
        .filter(|d| seen.insert(d.to_string_lossy().trim_end_matches(['\\', '/']).to_lowercase()))
        .collect()
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
        assert_eq!(by("codex").args, vec!["--dangerously-bypass-approvals-and-sandbox"]);
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
