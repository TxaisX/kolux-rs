//! The agents Kolux can start (SESS-001, SESS-027, SESS-051). An agent is "installed" when its
//! program name resolves on the user's PATH, the same lookup a shell makes. Each entry carries
//! the start line its own command line expects; the no-prompt switches are spelled exactly as
//! COMPAT.md (SESS-027) records them.

use std::path::{Path, PathBuf};

#[derive(Clone, Debug, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentInfo {
    /// Stable id the front end uses: `claude`, `codex`.
    pub id: String,
    /// What the menu shows.
    pub name: String,
    /// The program name that decides whether it is installed (SESS-051).
    pub program: String,
    /// Built-in start arguments (SESS-027).
    pub args: Vec<String>,
    pub installed: bool,
    /// Where the program was found, when it was.
    pub path: Option<String>,
}

/// The catalogue, in menu order. Only the two agents the walking skeleton knows about; the rest of
/// the SESS-051 list comes with the catalogue task.
pub fn catalogue() -> Vec<AgentInfo> {
    let entries: [(&str, &str, &str, &[&str]); 2] = [
        ("claude", "Claude Code", "claude", &["--permission-mode", "auto"]),
        ("codex", "Codex", "codex", &["--dangerously-bypass-approvals-and-sandbox"]),
    ];
    entries
        .iter()
        .map(|(id, name, program, args)| {
            let found = find_program(program);
            AgentInfo {
                id: id.to_string(),
                name: name.to_string(),
                program: program.to_string(),
                args: args.iter().map(|a| a.to_string()).collect(),
                installed: found.is_some(),
                path: found.map(|p| p.display().to_string()),
            }
        })
        .collect()
}

/// Finds `name` the way the command line does: each PATH folder in order, and on Windows each
/// PATHEXT ending (`claude` matches `claude.exe` or `claude.cmd`). `None` when nothing matches.
pub fn find_program(name: &str) -> Option<PathBuf> {
    let candidate = Path::new(name);
    if candidate.components().count() > 1 {
        return candidate.is_file().then(|| candidate.to_path_buf());
    }
    let path = std::env::var_os("PATH")?;
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
    for dir in std::env::split_paths(&path) {
        if dir.as_os_str().is_empty() {
            continue;
        }
        for ext in &exts {
            let file = dir.join(format!("{name}{ext}"));
            if file.is_file() {
                return Some(file);
            }
        }
    }
    None
}

#[tauri::command]
pub fn agent_list() -> Vec<AgentInfo> {
    catalogue()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_program_on_the_path_is_found_and_a_made_up_one_is_not() {
        // Git is required by the app and checked at startup, so it is on every PC the tests run on.
        let git = find_program("git").expect("git on PATH");
        assert!(git.is_file());
        assert!(git.file_stem().unwrap().to_string_lossy().eq_ignore_ascii_case("git"));
        assert_eq!(find_program("kolux-rs-no-such-program-7f3a"), None);
    }

    #[test]
    fn the_catalogue_spells_the_no_prompt_switches_as_compat_records() {
        let list = catalogue();
        let claude = list.iter().find(|a| a.id == "claude").unwrap();
        assert_eq!(claude.name, "Claude Code");
        assert_eq!(claude.args, vec!["--permission-mode", "auto"]);
        let codex = list.iter().find(|a| a.id == "codex").unwrap();
        assert_eq!(codex.args, vec!["--dangerously-bypass-approvals-and-sandbox"]);
        assert_eq!(list[0].id, "claude", "the default agent is listed first");
        for a in &list {
            assert_eq!(a.installed, a.path.is_some());
        }
    }
}
